import { clamp, expMap, dbToGain } from '../lib/emitter.js';
import { komma, hz, pct, ms, teken, db } from '../lib/notatie.js';
import {
  zetter, wisselaar, tweeKoppen, oscillator, opStandaard, metWorklet, lineair, direct, inloop,
  curveVan, compVan, mengNaar, BEREIK, WORKLET_FADE,
} from './fx-meer.js';
import { Lfo, LFO_DELINGEN } from './fx-lfo.js';

/**
 * Zeven effecten van spoor S10 (docs/EFFECTEN-MEER.md), in het contract van
 * fx.js (EFFECTEN): parameters 0..1, de schaling hier, `eenheid` met DEZELFDE
 * formule als zet(), een staarttijd, vernietig(). fx.js zet ze achter de
 * effecten uit de filter app.
 *
 *   kam          resonante kamfilter (worklet: Kam in fx-kern.js)
 *   klinker      formant-/vocaalfilter: a e i o u
 *   freqschuif   frequentieschuif (worklet: Freqschuif)
 *   band         tape: wow, flutter en zachte verzadiging
 *   kanteling    tilt-EQ
 *   aanslag      transient-shaper (worklet: Aanslag)
 *   duiker       ducker op de maat (de LFO van tremolo, met een duikgolf)
 *
 * Dezelfde regels als fx-meer.js: klikvrij (glijden, twee koppen voor
 * vertragingen), inloop voor alles met geheugen, een worklet pas bij gebruik
 * (tot dan droog), geen setValueCurveAtTime, tijd alleen van de audioklok.
 */

const bip = (t) => clamp(t) * 2 - 1;

/** Een worklet-effect: droog tot de worklet er is, dan vloeit hij naar de meng (zoals pitch in fx-meer.js). */
function workletMeng(ctx, naam, ingang, droog, nat, staat, init) {
  return metWorklet(ctx, naam,
    { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' },
    (node, meteen) => {
      init(node);
      ingang.connect(inloop(ctx)).connect(node);
      node.connect(nat);
      staat.geladen = true;
      const d = Math.cos(staat.meng * Math.PI / 2), w = Math.sin(staat.meng * Math.PI / 2);
      if (meteen) { droog.gain.value = d; nat.gain.value = w; }
      else { lineair(droog.gain, d, ctx, WORKLET_FADE); lineair(nat.gain, w, ctx, WORKLET_FADE); }
    });
}

// ---- kam ------------------------------------------------------------------------------

export const toonKam = (t) => expMap(t, 30, 2000);
export const fbKam = (t) => bip(t) * 0.97;
/** Demping: de afsnijfrequentie in de lus, van helder (20 kHz) naar dof (500 Hz). */
export const dempKam = (t) => expMap(t, 20000, 500);

const kam = {
  id: 'kam',
  naam: 'Kam',
  params: ['toon', 'feedback', 'demping', 'meng'],
  standaard: { toon: 0.45, feedback: 0.85, demping: 0.3, meng: 0.5 },
  eenheid: {
    toon: (t) => hz(toonKam(t)),
    feedback: (t) => `${teken(Math.round(fbKam(t) * 100))}${Math.abs(Math.round(fbKam(t) * 100))}%`,
    demping: (t) => hz(dempKam(t)),
    meng: pct,
  },
  bipolair: ['feedback'],
  /*
   *   in ─┬─► droog ──────────────────────────────┐
   *       └─► inloop ─► kam (worklet) ─► nat ─────┴─► uit
   *
   * Negatieve feedback = de oneven harmonischen (een octaaf lager, holler).
   * De toon GLIJDT (20 ms): bewuste uitzondering op de twee koppen, zie
   * docs/EFFECTEN-MEER.md keuze 10.
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    nat.connect(uitgang);
    droog.gain.value = 1; nat.gain.value = 0;
    const staat = { toon: toonKam(0.45), fb: fbKam(0.85), demping: dempKam(0.3), meng: 0.5, geladen: false };
    const w = workletMeng(ctx, 'varve-fx-kam', ingang, droog, nat, staat, (node) => {
      node.parameters.get('toon').value = staat.toon;
      node.parameters.get('fb').value = staat.fb;
      node.parameters.get('demping').value = staat.demping;
    });
    const p = (n) => w.node?.parameters.get(n);
    return opStandaard(kam, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'toon') { staat.toon = toonKam(t); if (w.node) doel(p('toon'), staat.toon, now); }
        else if (naam === 'feedback') { staat.fb = fbKam(t); if (w.node) doel(p('fb'), staat.fb, now); }
        else if (naam === 'demping') { staat.demping = dempKam(t); if (w.node) doel(p('demping'), staat.demping, now); }
        else if (naam === 'meng') { staat.meng = t; if (staat.geladen) mengNaar(doel, t, droog, nat, now); }
      },
      // Rondgangen tot −60 dB: (1/toon) · ln(0,001) / ln|fb|, hooguit 10 s (30 Hz op 97%: 7,6 s).
      staart: () => {
        const f = Math.abs(staat.fb);
        return f > 0.01 ? Math.min(10, (1 / staat.toon) * Math.log(0.001) / Math.log(f)) + 0.005 : 1 / staat.toon + 0.005;
      },
      vernietig: () => w.stop(),
      _n: { w, droog, nat, staat },
    });
  },
};

// ---- klinker (formanten) -------------------------------------------------------------------

/** Drie formanten per klinker (Hz) en hun niveau (dB), stem van een man (Peterson & Barney, afgerond). */
export const KLINKERS = [
  { naam: 'a', f: [730, 1090, 2440], db: [0, -5, -16] },
  { naam: 'e', f: [530, 1840, 2480], db: [0, -10, -14] },
  { naam: 'i', f: [270, 2290, 3010], db: [0, -16, -18] },
  { naam: 'o', f: [570, 840, 2410], db: [0, -6, -22] },
  { naam: 'u', f: [300, 870, 2240], db: [0, -10, -26] },
];
/** Formant k bij knop t (0..1 over a e i o u), en het niveau: log-interpolatie tussen buren. */
export function formantVan(t, k) {
  const p = clamp(t) * (KLINKERS.length - 1), i = Math.min(KLINKERS.length - 2, Math.floor(p)), u = p - i;
  const a = KLINKERS[i], b = KLINKERS[i + 1];
  return { f: a.f[k] * Math.pow(b.f[k] / a.f[k], u), db: a.db[k] + (b.db[k] - a.db[k]) * u };
}
export const klinkerNaam = (t) => KLINKERS[Math.round(clamp(t) * (KLINKERS.length - 1))].naam;
export const qKlinker = (t) => expMap(t, 3, 20);
export const schuifKlinker = (t) => expMap(t, 0.5, 2);
/**
 * Make-up: nat × 1,2·Q, hooguit ×8. Drie smalle banden laten op een vol nummer veel weg: met
 * √Q · 0,9 was de klinker 10 (Q 3) tot 18 dB (Q 20) zachter dan droog (gemeten in Chrome, ruis +
 * tonen). Prijs: een toon precies op een formant komt tot +18 dB boven zichzelf (de limiter vangt het).
 */
export const natKlinker = (q) => Math.min(8, 1.2 * q);

const klinker = {
  id: 'klinker',
  naam: 'Klinker',
  params: ['klinker', 'reso', 'schuif', 'meng'],
  standaard: { klinker: 0, reso: 0.4, schuif: 0.5, meng: 1 },
  eenheid: {
    klinker: (t) => `${klinkerNaam(t)} · ${hz(formantVan(t, 0).f)}`,
    reso: (t) => `Q ${komma(qKlinker(t), 1)}`,
    schuif: (t) => `×${komma(schuifKlinker(t), 2)}`,
    meng: pct,
  },
  bipolair: ['schuif'],
  /*
   *   in ─┬─► droog ───────────────────────────────────────┐
   *       ├─► bp 1 ─► g 1 ─┐                               │
   *       ├─► bp 2 ─► g 2 ─┼─► som ─► nat ─────────────────┴─► uit
   *       └─► bp 3 ─► g 3 ─┘
   * Geen lus, geen geheugen: geen inloop nodig. Alles glijdt (τ 20 ms).
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain(), som = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    som.connect(nat).connect(uitgang);
    const banden = [0, 1, 2].map(() => {
      const bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass';
      ingang.connect(bp).connect(g).connect(som);
      return { bp, g };
    });
    const staat = { klinker: 0, q: qKlinker(0.4), schuif: 1 };
    const pasToe = (now) => {
      banden.forEach((b, k) => {
        const { f, db: niveau } = formantVan(staat.klinker, k);
        doel(b.bp.frequency, Math.min(ctx.sampleRate * 0.45, f * staat.schuif), now);
        doel(b.bp.Q, staat.q, now);
        doel(b.g.gain, dbToGain(niveau), now);
      });
      doel(som.gain, natKlinker(staat.q), now);
    };
    return opStandaard(klinker, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'klinker') { staat.klinker = t; pasToe(now); }
        else if (naam === 'reso') { staat.q = qKlinker(t); pasToe(now); }
        else if (naam === 'schuif') { staat.schuif = schuifKlinker(t); pasToe(now); }
        else if (naam === 'meng') mengNaar(doel, t, droog, nat, now);
      },
      // Een smalle bandpass rinkelt na: −60 dB na 6,9·Q/(π·f), de laagste formant telt.
      staart: () => Math.min(1, 6.91 * staat.q / (Math.PI * 240 * staat.schuif)) + 0.005,
      _n: { banden, som, droog, nat, staat },
    });
  },
};

// ---- frequentieschuif ------------------------------------------------------------------------

/** −1000..+1000 Hz, fijn rond 0 (kwadratisch): de eerste tientallen Hz zijn de interessantste. */
export const schuifHz = (t) => { const b = bip(t); return Math.sign(b) * 1000 * b * b; };

const freqschuif = {
  id: 'freqschuif',
  naam: 'Frequentieschuif',
  params: ['schuif', 'meng'],
  standaard: { schuif: 0.6, meng: 0.5 },
  eenheid: {
    schuif: (t) => { const f = schuifHz(t); return `${teken(Math.round(f))}${Math.abs(Math.round(f))} Hz`; },
    meng: pct,
  },
  bipolair: ['schuif'],
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    nat.connect(uitgang);
    droog.gain.value = 1; nat.gain.value = 0;
    const staat = { hz: schuifHz(0.6), meng: 0.5, geladen: false };
    const w = workletMeng(ctx, 'varve-fx-freqschuif', ingang, droog, nat, staat, (node) => {
      node.parameters.get('hz').value = staat.hz;
    });
    return opStandaard(freqschuif, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'schuif') { staat.hz = schuifHz(t); if (w.node) doel(w.node.parameters.get('hz'), staat.hz, now); }
        else if (naam === 'meng') { staat.meng = t; if (staat.geladen) mengNaar(doel, t, droog, nat, now); }
      },
      // De traagste allpass-trap (a² = 0,9975 in z⁻²) klinkt na tot −60 dB in ~11 000 samples (0,23 s).
      staart: () => 0.25,
      vernietig: () => w.stop(),
      _n: { w, droog, nat, staat },
    });
  },
};

// ---- band (tape) ------------------------------------------------------------------------------

/** Wow: een trage golf (0,2–3 Hz) met een uitslag tot ±4 ms; flutter: 7 Hz, tot ±0,15 ms. */
export const WOW_MAX = 0.004, FLUTTER_MAX = 0.00015, FLUTTER_HZ = 7;
export const snelWow = (t) => expMap(t, 0.2, 3);
export const voorBand = (t) => 1 + 10 * clamp(t);
export const toonBand = (t) => expMap(t, 2000, 20000);
const basisVan = (u) => (u > 0 ? u + 0.0005 : 0);

const band = {
  id: 'band',
  naam: 'Band',
  params: ['drive', 'wow', 'snelheid', 'flutter', 'toon', 'meng'],
  standaard: { drive: 0.3, wow: 0.3, snelheid: 0.4, flutter: 0.3, toon: 0.6, meng: 1 },
  eenheid: {
    drive: (t) => db(20 * Math.log10(voorBand(t))),
    wow: (t) => `±${ms(clamp(t) * WOW_MAX)}`,
    snelheid: (t) => `${komma(snelWow(t), 2)} Hz`,
    flutter: (t) => `±${komma(clamp(t) * FLUTTER_MAX * 1000, 3)} ms`,
    toon: (t) => hz(toonBand(t)),
    meng: pct,
  },
  /*
   *   in ─┬─► droog ──────────────────────────────────────────────────────────────────┐
   *       └─► inloop ─► wow (koppen, lfo) ─► flutter (koppen, lfo) ─► voor ─► tanh ─► comp ─► toon ─► nat ─┴─► uit
   *
   * Twee vibrato-trappen na elkaar (elk met twee koppen: een andere diepte gaat op
   * de stille kop), dan dezelfde zachte vormer als de distortion met gelijke
   * luidheid (`compVan`). Het nat loopt een paar ms achter (de basis van de
   * vertraging): met meng ½ een zachte kam. Standaard meng 1, zoals een bandmachine.
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    const lfoWow = oscillator(ctx, 'sine', 0.5), lfoFlut = oscillator(ctx, 'triangle', FLUTTER_HZ);
    const tussen = ctx.createGain(), naFlut = ctx.createGain();
    const wow = tweeKoppen(ctx, ingang.connect(inloop(ctx)), tussen, { max: 0.02, mod: lfoWow });
    const flut = tweeKoppen(ctx, tussen, naFlut, { max: 0.005, mod: lfoFlut });
    const voor = ctx.createGain(), vorm = ctx.createWaveShaper(), comp = ctx.createGain();
    const toon = ctx.createBiquadFilter();
    vorm.oversample = 'none';
    vorm.curve = curveVan('zacht');
    toon.type = 'lowpass';
    toon.Q.value = -3.01;
    naFlut.connect(voor).connect(vorm).connect(comp).connect(toon).connect(nat).connect(uitgang);
    const staat = { uw: 0, uf: 0 };
    const zetKoppen = () => { wow.zet(basisVan(staat.uw), staat.uw); flut.zet(basisVan(staat.uf), staat.uf); };
    return opStandaard(band, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'drive') {
          const g = voorBand(t);
          doel(voor.gain, g / BEREIK, now);
          doel(comp.gain, compVan('zacht', g), now);
        } else if (naam === 'wow') { staat.uw = t * WOW_MAX; zetKoppen(); }
        else if (naam === 'snelheid') doel(lfoWow.frequency, snelWow(t), now);
        else if (naam === 'flutter') { staat.uf = t * FLUTTER_MAX; zetKoppen(); }
        else if (naam === 'toon') doel(toon.frequency, toonBand(t), now);
        else if (naam === 'meng') mengNaar(doel, t, droog, nat, now);
      },
      staart: () => basisVan(staat.uw) + staat.uw + basisVan(staat.uf) + staat.uf + 0.005,
      vernietig: () => {
        for (const o of [lfoWow, lfoFlut]) { try { o.stop(); } catch (_) {} }
        wow.vernietig(); flut.vernietig();
      },
      _n: { wow, flut, voor, comp, toon, droog, nat, staat },
    });
  },
};

// ---- kanteling (tilt-EQ) ----------------------------------------------------------------------

export const TILT_DB = 6;
export const kantelDb = (t) => bip(t) * TILT_DB;
export const middenKanteling = (t) => expMap(t, 200, 5000);

const kanteling = {
  id: 'kanteling',
  naam: 'Kanteling',
  params: ['kanteling', 'midden'],
  standaard: { kanteling: 0.5, midden: 0.5 },
  eenheid: {
    kanteling: (t) => (Math.abs(kantelDb(t)) < 0.05 ? 'vlak' : `${db(kantelDb(t))} hoog`),
    midden: (t) => hz(middenKanteling(t)),
  },
  bipolair: ['kanteling'],
  /*
   * Lage en hoge shelf rond hetzelfde midden, tegengesteld: +x dB hoog = −x dB laag.
   * Rechts = helderder, links = warmer. Geen lus, geen geheugen.
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const laag = ctx.createBiquadFilter(), hoog = ctx.createBiquadFilter();
    laag.type = 'lowshelf'; hoog.type = 'highshelf';
    ingang.connect(laag).connect(hoog).connect(uitgang);
    return opStandaard(kanteling, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'kanteling') { const g = kantelDb(t); doel(hoog.gain, g, now); doel(laag.gain, -g, now); }
        else if (naam === 'midden') { const f = middenKanteling(t); doel(laag.frequency, f, now); doel(hoog.frequency, f, now); }
      },
      staart: () => 0,
      _n: { laag, hoog },
    });
  },
};

// ---- aanslag (transient-shaper) ---------------------------------------------------------------

const aanslag = {
  id: 'aanslag',
  naam: 'Aanslag',
  params: ['aanval', 'sustain'],
  standaard: { aanval: 0.5, sustain: 0.5 },
  eenheid: {
    aanval: (t) => `${teken(Math.round(bip(t) * 100))}${Math.abs(Math.round(bip(t) * 100))}%`,
    sustain: (t) => `${teken(Math.round(bip(t) * 100))}${Math.abs(Math.round(bip(t) * 100))}%`,
  },
  bipolair: ['aanval', 'sustain'],
  /*
   *   in ─┬─► droog (1, tot de worklet er is) ─────────┐
   *       └─► inloop ─► aanslag (worklet) ─► nat ──────┴─► uit
   * Geen vooruitblik, dus geen vertraging: als hij er is gaat droog naar 0 en nat naar 1.
   * Op 50 / 50 doet hij niets (gain 0 dB).
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    nat.connect(uitgang);
    droog.gain.value = 1; nat.gain.value = 0;
    const staat = { aanval: 0, sustain: 0, meng: 1, geladen: false };
    const w = workletMeng(ctx, 'varve-fx-aanslag', ingang, droog, nat, staat, (node) => {
      node.parameters.get('aanval').value = staat.aanval;
      node.parameters.get('sustain').value = staat.sustain;
    });
    return opStandaard(aanslag, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'aanval' || naam === 'sustain') {
          staat[naam] = bip(t);
          if (w.node) doel(w.node.parameters.get(naam), staat[naam], now);
        }
      },
      staart: () => 0.005,
      vernietig: () => w.stop(),
      _n: { w, droog, nat, staat },
    });
  },
};

// ---- duiker (ducker op de maat) ---------------------------------------------------------------

export const DUIK_DELINGEN = ['1/1', '1/2', '1/4', '1/8', '1/16'];
export const duikDelingVan = (t) => DUIK_DELINGEN[Math.min(DUIK_DELINGEN.length - 1, Math.max(0, Math.round(clamp(t) * (DUIK_DELINGEN.length - 1))))];
export const DUIK_HERSTEL = ['kort', 'middel', 'lang'];
const herstelVan = (t) => Math.min(DUIK_HERSTEL.length - 1, Math.max(0, Math.round(clamp(t) * (DUIK_HERSTEL.length - 1))));

const duiker = {
  id: 'duiker',
  naam: 'Duiker',
  params: ['diepte', 'deling', 'herstel'],
  standaard: { diepte: 0.6, deling: 0.5, herstel: 0.5 },
  eenheid: {
    diepte: (t) => (clamp(t) < 0.005 ? 'uit' : db(20 * Math.log10(Math.max(1e-3, 1 - clamp(t))))),
    deling: (t) => duikDelingVan(t),
    herstel: (t) => DUIK_HERSTEL[herstelVan(t)],
  },
  trappen: { deling: DUIK_DELINGEN.length, herstel: DUIK_HERSTEL.length },
  /*
   * Het pompen van een sidechain, maar op de klok in plaats van op een kick:
   * gain = 1 − d/2 + d/2 · golf, met een golf die op de tel op −1 staat en dan
   * herstelt (fx-lfo.js, DUIK_TAU). Op elke tel 1 − d. Altijd op de maat
   * (de klok van het deck); zonder klok de laatst bekende tel, zoals tremolo.
   */
  bouw(ctx, { klok = () => null } = {}) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const poort = ctx.createGain(), diep = ctx.createGain();
    ingang.connect(poort).connect(uitgang);
    // Op 1/2 en 1/1 duikt hij op de "1" (en de 3), niet op een willekeurige tel (review S10).
    const lfo = new Lfo(ctx, { klok, opDeEen: true });
    lfo.uit.connect(diep).connect(poort.gain);
    const staat = { deling: '1/4', herstel: 1 };
    const pasToe = () => lfo.zet({ sync: true, tellen: LFO_DELINGEN.find((d) => d.id === staat.deling).tellen, vorm: `duik${staat.herstel + 1}` });
    poort.gain.value = 0.7; diep.gain.value = 0.3;
    pasToe();
    return opStandaard(duiker, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'diepte') { doel(poort.gain, 1 - t / 2, now); doel(diep.gain, t / 2, now); }
        else if (naam === 'deling') { const d = duikDelingVan(t); if (d !== staat.deling) { staat.deling = d; pasToe(); } }
        else if (naam === 'herstel') { const h = herstelVan(t); if (h !== staat.herstel) { staat.herstel = h; pasToe(); } }
      },
      heranker: () => lfo.heranker(),
      staart: () => 0,
      vernietig: () => lfo.vernietig(),
      _n: { lfo, poort, diep, staat },
    });
  },
};

/** In de volgorde van de kiezer, achter de effecten uit de filter app. */
export const S10_EFFECTEN = [kam, klinker, freqschuif, band, kanteling, aanslag, duiker];
