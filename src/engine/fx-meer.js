import { clamp, expMap, dbToGain } from '../lib/emitter.js';
import { komma, hz, pct, ms, teken, db } from '../lib/notatie.js';
import { startDrempel, zetHellingen } from './overgang.js';
import { Lfo, lfoDelingVan, vormVan, LFO_VORMEN } from './fx-lfo.js';

/**
 * Meer effecten voor de racks, overgenomen uit Clay's filter app
 * (`~/Projects/filter app/effects.js` en `worklets.js`, 9 sep 2026). Daar
 * klassieke scripts op `window.FX` met `{ params, build(), apply(k, v) }`;
 * hier hetzelfde geluid in het contract van fx.js (EFFECTEN): parameters
 * 0..1, de schaling in code, `eenheid` met DEZELFDE formule als zet(), een
 * staarttijd, en vernietig() die oscillatoren, bronnen en worklets stopt.
 * fx.js zet ze achter zijn eigen zeven in EFFECTEN. Wat waar vandaan komt en
 * wat er gemeten is: docs/EFFECTEN.md.
 *
 * Regels die hier bijten (CLAUDE.md):
 *   - een parameter verandert klikvrij: setTargetAtTime, of voor alles met
 *     een vertraging de TWEE KOPPEN van de delay (een vertraging verschuiven
 *     laat de toonhoogte glijden). Een andere vorm (distortion) of golf
 *     (tremolo) is ook een tweede pad waar naartoe gevloeid wordt;
 *   - tijd alleen van ctx.currentTime; op de maat via de klok van het deck;
 *   - een worklet laadt pas bij gebruik en één keer per AudioContext. Is hij
 *     er (nog) niet, dan klinkt het effect droog en gooit het niets;
 *   - geen setValueCurveAtTime; overgangen zijn hellingen na startDrempel.
 */

const TAU = 0.02;
/** Twee koppen of twee vormen: zo lang vloeien ze in elkaar over (na startDrempel). */
const KOP_FADE = 0.05;
/** Een worklet die later binnenkomt, vloeit zo lang in (ook in fx-s10.js: één getal). */
export const WORKLET_FADE = 0.05;

// ---- eenheden ----------------------------------------------------------------
// Zelfde stijl als fx.js: komma, kHz boven 1000, een echte min (src/lib/notatie.js).

const hzLfo = (f) => (f < 10 ? `${komma(f, 2)} Hz` : `${komma(f, 1)} Hz`);
/** De andere parameter van hetzelfde effect, voor eenheden die ervan afhangen. */
const andere = (lees, p, std) => clamp(lees?.(p) ?? std);
export const mengNaar = (doel, t, droog, nat, now) => {
  doel(droog.gain, Math.cos(t * Math.PI / 2), now);
  doel(nat.gain, Math.sin(t * Math.PI / 2), now);
};

// ---- hulpstukken -------------------------------------------------------------

/** Lineair naar `naar` in `duur`, na startDrempel. Twee paden met (bijna) hetzelfde signaal: lineair telt op tot 1. */
export function lineair(param, naar, ctx, duur) {
  const nu = ctx.currentTime, wacht = startDrempel(ctx);
  try { zetHellingen(param, (van) => [van, naar], nu, duur, wacht); }
  catch (_) { try { param.setTargetAtTime(naar, nu, duur / 3); } catch (__) { try { param.value = naar; } catch (___) {} } }
  return nu + wacht + duur;
}

/** Direct zetten (een pad dat niet klinkt), zonder een lopende overgang te laten winnen. */
export function direct(param, v, nu) {
  try { param.cancelScheduledValues?.(nu); param.setValueAtTime(v, nu); } catch (_) { try { param.value = v; } catch (__) {} }
}

/**
 * Een doelwaarde: glijden (setTargetAtTime), behalve tijdens het bouwen (de
 * klok is nog niet verder): dan meteen, zodat het effect vanaf de eerste
 * sample klinkt zoals zijn knoppen staan in plaats van vanaf de standaard
 * van Web Audio (een lowpass begint op 350 Hz) naar zijn stand te glijden.
 */
export function zetter(ctx) {
  const gebouwd = ctx.currentTime;
  return (param, v, now) => {
    if (ctx.currentTime <= gebouwd) direct(param, v, now);
    else { try { param.setTargetAtTime(v, now, TAU); } catch (_) { try { param.value = v; } catch (__) {} } }
  };
}

/**
 * Twee paden, één hoorbaar; een nieuwe stand gaat op het stille pad en daar
 * wordt naartoe gevloeid. Het patroon van de delay (fx.js), los gemaakt:
 *   - tijdens het bouwen (de klok is nog niet verder) beide paden meteen goed;
 *   - loopt er nog een overgang, dan alleen de LAATSTE stand onthouden en die
 *     pakken zodra hij klaar is (twee overgangen over elkaar klikken);
 *   - lineair, niet equal-power: beide paden dragen hetzelfde signaal (met een
 *     iets andere vertraging of vorm), en lineair kan nooit boven 1 uitkomen,
 *     ook niet in een feedbacklus (flanger).
 * Anders dan de delay ook als de audio stilstaat: dan is de overgang klaar
 * zodra de klok weer loopt; er klinkt intussen toch niets.
 *
 * @param paden     [{ g: GainNode, ... }, { g, ... }] — g is de uitgang van het pad
 * @param zetPad    (pad, stand, nu) => void: de stand direct op een (stil) pad zetten
 * @param gelijk    (a, b) => boolean
 */
export function wisselaar(ctx, paden, zetPad, gelijk, fade = KOP_FADE) {
  let actief = 0, klaarOm = -Infinity, wachtend = null, timer = null, weg = false;
  const stand = [null, null];
  const gebouwd = ctx.currentTime;
  paden[0].g.gain.value = 1;
  paden[1].g.gain.value = 0;
  function zet(s) {
    if (weg) return;
    const nu = ctx.currentTime;
    if (nu <= gebouwd) {
      for (let k = 0; k < 2; k++) { zetPad(paden[k], s, nu); stand[k] = s; }
      wachtend = null;
      return;
    }
    if (nu < klaarOm) {
      wachtend = s;
      timer ??= setTimeout(() => {
        timer = null;
        const w = wachtend;
        wachtend = null;
        if (w) zet(w);
      }, (klaarOm - nu) * 1000 + 5);
      return;
    }
    // Wat nu binnenkomt is nieuwer dan wat er nog wachtte: de timer mag dat
    // niet alsnog zetten (hij vuurt pas ná klaarOm, en daartussen kan dit).
    wachtend = null;
    if (stand[actief] && gelijk(stand[actief], s)) return;
    const stil = 1 - actief;
    zetPad(paden[stil], s, nu);
    stand[stil] = s;
    lineair(paden[actief].g.gain, 0, ctx, fade);
    klaarOm = lineair(paden[stil].g.gain, 1, ctx, fade) + 0.005;
    actief = stil;
  }
  return {
    zet,
    get actief() { return actief; },
    stand: () => stand[actief],
    vernietig() { weg = true; clearTimeout(timer); timer = null; wachtend = null; },
  };
}

/**
 * Een vertraging met twee leeskoppen (de delay in fx.js): `basis` in
 * seconden, en optioneel een LFO (`mod`, −1..1) die per kop met `diepte`
 * seconden op delayTime komt. Een nieuwe basis of diepte gaat op de stille
 * kop: zo glijdt de toonhoogte nooit door het verzetten zelf, alleen door de LFO.
 */
export function tweeKoppen(ctx, ingang, uitgang, { max = 0.1, mod = null } = {}) {
  const koppen = [0, 1].map(() => {
    const d = ctx.createDelay(max);
    const g = ctx.createGain();
    ingang.connect(d).connect(g).connect(uitgang);
    let diep = null;
    if (mod) {
      diep = ctx.createGain();
      diep.gain.value = 0;
      mod.connect(diep).connect(d.delayTime);
    }
    return { d, g, diep };
  });
  const w = wisselaar(ctx, koppen, (kop, s, nu) => {
    direct(kop.d.delayTime, s.basis, nu);
    if (kop.diep) direct(kop.diep.gain, s.diepte, nu);
  }, (a, b) => Math.abs(a.basis - b.basis) < 1e-7 && Math.abs(a.diepte - b.diepte) < 1e-8);
  return {
    zet: (basis, diepte = 0) => w.zet({ basis, diepte }),
    vernietig: w.vernietig,
    koppen,
    // Voor de tests: welke kop klinkt en wat hij doet.
    _kop: () => ({ actief: w.actief, stand: w.stand(), tijden: koppen.map((k) => k.d.delayTime.value),
      diepten: koppen.map((k) => k.diep?.gain.value ?? 0), gains: koppen.map((k) => k.g.gain.value) }),
  };
}

/** Een LFO als oscillator (vrij lopend, chorus/flanger/vibrato: de fase doet er niet toe). */
export function oscillator(ctx, type, f) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  try { o.start(); } catch (_) {}
  return o;
}

/**
 * Een net gebouwd effect op zijn standaard zetten (tijdens het bouwen: direct).
 * bouwKeten zet daarna wat het rack wil; zonder dit stond een effect dat los
 * gebouwd werd op de waarden van Web Audio (gain 1, een lowpass op 350 Hz).
 */
export function opStandaard(effect, ctx, inst) {
  for (const p of effect.params) inst.zet(p, effect.standaard[p], ctx.currentTime);
  return inst;
}

// ---- worklets ------------------------------------------------------------------

/**
 * De effect-worklets één keer per AudioContext laden, pas als een effect ze
 * nodig heeft (zoals bron.js en klankschaal.js). Geeft een belofte van
 * true/false, of null als deze context geen worklets kan (de mock in Node).
 * Mislukt het laden, dan mag een volgend effect het opnieuw proberen.
 */
const modules = new WeakMap();
/** Contexten waarvoor de module al geladen is: daar komt de node meteen, niet een microtaak later. */
const geladen = new WeakSet();
export function laadFxWorklet(ctx) {
  if (!ctx?.audioWorklet?.addModule || typeof AudioWorkletNode === 'undefined') return null;
  let p = modules.get(ctx);
  if (!p) {
    p = Promise.resolve()
      .then(() => ctx.audioWorklet.addModule(new URL('./fx-worklet.js', import.meta.url)))
      .then(() => { geladen.add(ctx); return true; }, () => { modules.delete(ctx); return false; });
    modules.set(ctx, p);
  }
  return p;
}

/**
 * Een worklet-node maken zodra de module er is, en hem dan pas aanhaken. Is
 * de module al geladen (een eerder effect), dan meteen, tijdens het bouwen:
 * `klaar(node, true)`, en dan klinkt het effect vanaf het begin zoals het
 * hoort. Anders later, `klaar(node, false)`: dan vloeit het effect in. Tot
 * dan (en als het nooit lukt) blijft het wat het zonder is. Wordt het effect
 * intussen opgeruimd, dan komt er geen node meer.
 */
export function metWorklet(ctx, naam, opties, klaar) {
  const w = { node: null, weg: false };
  const maak = (meteen) => {
    if (w.weg || w.node) return;
    let node;
    try { node = new AudioWorkletNode(ctx, naam, opties); } catch (_) { return; }
    // Een fout in de worklet = stil effect: melden via de context (worklet-fout.js, WORKLET_FOUT; spoor A).
    node.onprocessorerror = (e) => { try { ctx.dispatchEvent?.(new CustomEvent('varve-workletfout', { detail: { wat: `effect ${String(naam).replace(/^varve-fx-/, '')}`, reden: String(e?.message || ''), hint: 'het effect is stil; kies het opnieuw' } })); } catch (_) {} };
    w.node = node;
    try { klaar(node, meteen); } catch (_) {}
  };
  const p = laadFxWorklet(ctx);
  if (p && geladen.has(ctx)) maak(true);
  else if (p) p.then((ok) => { if (ok) maak(false); });
  w.stop = () => {
    w.weg = true;
    if (!w.node) return;
    // 'stop' en meteen de poort dicht: het bericht komt nog aan (in Chrome gemeten, spoor A), en een open
    // poort hield de processor in leven (hij rekende door na het losmaken).
    try { w.node.port.postMessage('stop'); } catch (_) {}
    try { w.node.port.onmessage = null; w.node.port.close(); } catch (_) {}
    try { w.node.disconnect(); } catch (_) {}
  };
  return w;
}

/**
 * Een ingang die in INLOOP open gaat, voor alles met een geheugen (een
 * vertraging, de vooruitblik van de compressor, de lijn van de toonhoogte).
 * Een nieuwe keten begint met een LEEG geheugen: zonder dit begint de
 * vertraagde kopie na een rackwissel abrupt, midden in een golf (gemeten in
 * Chrome: chorus ×21, compressor ×23 boven de gewone tweede afgeleide).
 */
export const INLOOP = 0.03;
export function inloop(ctx) {
  const g = ctx.createGain();
  g.gain.value = 0;
  lineair(g.gain, 1, ctx, INLOOP);
  return g;
}

// ---- distortion ------------------------------------------------------------------

export const SOORTEN = ['zacht', 'hard', 'fuzz', 'vouw'];
const soortVan = (t) => SOORTEN[Math.min(SOORTEN.length - 1, Math.max(0, Math.round(clamp(t) * (SOORTEN.length - 1))))];
/** Driehoeksvouw tussen −1 en 1 (filter app: 'fold'). */
const vouw = (u) => { const v = (((u + 1) % 4) + 4) % 4; return v < 2 ? v - 1 : 3 - v; };
export const VORMFN = {
  zacht: Math.tanh,
  hard: (u) => Math.max(-1, Math.min(1, u)),
  fuzz: (u) => Math.sign(u) * (1 - Math.exp(-Math.abs(u))),
  vouw,
};
/** Voorversterking bij drive 1, als in de filter app (k = 60·drive): zacht 1 + k/2, hard en fuzz 1 + k, vouw 1 + k/6. */
const DRIVE_MAX = { zacht: 30, hard: 60, fuzz: 60, vouw: 10 };
const voorVan = (soort, t) => 1 + DRIVE_MAX[soort] * clamp(t);
/**
 * De vorm is VAST per soort en beslaat invoer × voorversterking in
 * [−BEREIK, BEREIK]; drive is een gain ervoor. Zo is drive een AudioParam die
 * glijdt in plaats van een nieuwe curve per knopstap (een curve vervangen is
 * een sprong). 16385 punten: 0 valt precies op een punt.
 */
export const BEREIK = 128;
const CURVE_N = 16385;
const curves = new Map();
export function curveVan(soort) {
  if (!curves.has(soort)) {
    const f = VORMFN[soort], c = new Float32Array(CURVE_N);
    for (let i = 0; i < CURVE_N; i++) c[i] = f(BEREIK * (2 * i / (CURVE_N - 1) - 1));
    curves.set(soort, c);
  }
  return curves.get(soort);
}
/**
 * Gelijke luidheid bij elke drive (NIET in de filter app: daar werd elke
 * draai aan drive tot ~13 dB harder). Ijkpunt: een sinus met piek 0,3 (rms
 * −13,5 dBFS, zo luid als een nummer op −14 LUFS) komt er even luid (rms) uit
 * als hij erin ging. Zachter materiaal wordt bij veel drive iets luider,
 * harder iets zachter: dat is wat vervormen doet.
 */
const COMP_IJK = 0.3;
const compCache = new Map();
export function compVan(soort, g) {
  const sleutel = `${soort}|${g.toFixed(4)}`;
  let c = compCache.get(sleutel);
  if (c === undefined) {
    const f = VORMFN[soort], M = 512;
    let s = 0;
    for (let i = 0; i < M; i++) { const y = f(g * COMP_IJK * Math.sin(2 * Math.PI * (i + 0.5) / M)); s += y * y; }
    c = Math.min(4, (COMP_IJK / Math.SQRT2) / Math.max(1e-6, Math.sqrt(s / M)));
    if (compCache.size > 4096) compCache.clear();
    compCache.set(sleutel, c);
  }
  return c;
}
const toonDist = (t) => expMap(t, 300, 20000);
const trimDb = (t) => -12 + 24 * clamp(t);

const distortion = {
  id: 'distortion',
  naam: 'Distortion',
  params: ['drive', 'soort', 'toon', 'niveau', 'meng'],
  standaard: { drive: 0.4, soort: 0, toon: 0.713, niveau: 0.5, meng: 1 },
  eenheid: {
    drive: (t, lees) => db(20 * Math.log10(voorVan(soortVan(andere(lees, 'soort', 0)), t))),
    soort: (t) => soortVan(t),
    toon: (t) => hz(toonDist(t)),
    niveau: (t) => db(trimDb(t)),
    meng: pct,
  },
  trappen: { soort: SOORTEN.length },
  bipolair: ['niveau'],
  /*
   *   in ─┬─► droog ──────────────────────────────────────────────┐
   *       ├─► voor_0 ─► vorm_0 ─► comp_0 ─► g_0 ─┐                 ├─► uit
   *       └─► voor_1 ─► vorm_1 ─► comp_1 ─► g_1 ─┴─► toon ─► niveau ─► nat
   *
   * Twee vormers: een andere soort gaat op de stille en daar wordt naartoe
   * gevloeid. Zonder oversampling: Chrome's 2x/4x vertraagt de vormer 128/192
   * samples (gemeten), en met de mix-knop van het rack is dat een kamfilter
   * over het droge signaal. De prijs is aliasing bij hoge drive.
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    const som = ctx.createGain(), niveau = ctx.createGain();
    const toon = ctx.createBiquadFilter();
    toon.type = 'lowpass';
    toon.Q.value = -3.01;      // Q is hier in dB: −3 = geen bult bij de afsnijfrequentie
    ingang.connect(droog).connect(uitgang);
    som.connect(toon).connect(niveau).connect(nat).connect(uitgang);
    const staat = { drive: 0.4, soort: 'zacht' };
    const vormers = [0, 1].map(() => {
      const voor = ctx.createGain(), vorm = ctx.createWaveShaper(), comp = ctx.createGain(), g = ctx.createGain();
      vorm.oversample = 'none';
      ingang.connect(voor).connect(vorm).connect(comp).connect(g).connect(som);
      return { voor, vorm, comp, g, soort: null };
    });
    /** Drive van nu op een vormer: glijdend als hij (misschien) klinkt, anders direct. */
    const zetDrive = (v, nu, glij) => {
      const g = voorVan(v.soort, staat.drive), a = g / BEREIK, c = compVan(v.soort, g);
      if (glij) { doel(v.voor.gain, a, nu); doel(v.comp.gain, c, nu); }
      else { direct(v.voor.gain, a, nu); direct(v.comp.gain, c, nu); }
    };
    const w = wisselaar(ctx, vormers, (v, soort, nu) => {
      if (v.soort !== soort) { v.vorm.curve = curveVan(soort); v.soort = soort; }
      zetDrive(v, nu, false);
    }, (a, b) => a === b, 0.03);
    w.zet(staat.soort);
    return opStandaard(distortion, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'drive') {
          staat.drive = t;
          for (const vm of vormers) if (vm.soort) zetDrive(vm, now, true);
        } else if (naam === 'soort') {
          staat.soort = soortVan(t);
          w.zet(staat.soort);
        } else if (naam === 'toon') doel(toon.frequency, toonDist(t), now);
        else if (naam === 'niveau') doel(niveau.gain, dbToGain(trimDb(t)), now);
        else if (naam === 'meng') mengNaar(doel, t, droog, nat, now);
      },
      staart: () => 0,
      vernietig: () => w.vernietig(),
      _n: { vormers, toon, niveau, droog, nat, staat, wissel: w },
    });
  },
};

// ---- chorus ------------------------------------------------------------------------

const snelChorus = (t) => expMap(t, 0.05, 10);
const vertChorus = (t) => expMap(t, 0.003, 0.04);
/** Uitslag van de LFO in seconden: diepte × vertraging × 0,6 (filter app). */
const uitslagChorus = (diepte, vert) => clamp(diepte) * vert * 0.6;

const chorus = {
  id: 'chorus',
  naam: 'Chorus',
  params: ['snelheid', 'diepte', 'vertraging', 'meng'],
  standaard: { snelheid: 0.52, diepte: 0.4, vertraging: 0.69, meng: 0.5 },
  eenheid: {
    snelheid: (t) => hzLfo(snelChorus(t)),
    diepte: (t, lees) => `±${ms(uitslagChorus(t, vertChorus(andere(lees, 'vertraging', 0.69))))}`,
    vertraging: (t) => ms(vertChorus(t)),
    meng: pct,
  },
  /*
   * Twee stemmen (filter app): vertraging × 1 en × 1,35, elk met een eigen LFO
   * (sinus op de snelheid, driehoek op × 1,23, in tegenfase), een halve kant
   * links en rechts. Elke stem is een vertraging met twee koppen.
   *
   *   in ─┬─► droog ─────────────────────────────────────────┐
   *       └─► inloop ─┬─► stem 1 (koppen, lfo 1) ─► pan −½ ─► ½ ─┤
   *                   └─► stem 2 (koppen, lfo 2) ─► pan +½ ─► ½ ─┴─► nat ─► uit
   *
   * De stemmen tellen voor de helft: in de filter app werd de bas met de mix
   * in het midden 6 dB luider.
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    nat.connect(uitgang);
    const zacht = inloop(ctx);
    ingang.connect(zacht);
    const staat = { snelheid: 0.8, diepte: 0.4, vertraging: 0.018 };
    const stemmen = [
      { lfo: oscillator(ctx, 'sine', 0.8), factor: 1, richting: 1, pan: -0.5 },
      { lfo: oscillator(ctx, 'triangle', 0.8 * 1.23), factor: 1.35, richting: -1, pan: 0.5 },
    ].map((s) => {
      const p = ctx.createStereoPanner();
      p.pan.value = s.pan;
      const half = ctx.createGain();
      half.gain.value = 0.5;
      p.connect(half).connect(nat);
      return { ...s, koppen: tweeKoppen(ctx, zacht, p, { max: 0.1, mod: s.lfo }) };
    });
    const pasToe = () => {
      const u = uitslagChorus(staat.diepte, staat.vertraging);
      for (const s of stemmen) s.koppen.zet(staat.vertraging * s.factor, s.richting * u);
    };
    pasToe();
    return opStandaard(chorus, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'snelheid') {
          doel(stemmen[0].lfo.frequency, snelChorus(t), now);
          doel(stemmen[1].lfo.frequency, snelChorus(t) * 1.23, now);
        } else if (naam === 'diepte') { staat.diepte = t; pasToe(); }
        else if (naam === 'vertraging') { staat.vertraging = vertChorus(t); pasToe(); }
        else if (naam === 'meng') mengNaar(doel, t, droog, nat, now);
      },
      // Geen terugkoppeling: na de langste vertraging is het stil.
      staart: () => staat.vertraging * 1.35 + uitslagChorus(staat.diepte, staat.vertraging) + 0.005,
      vernietig: () => { for (const s of stemmen) { try { s.lfo.stop(); } catch (_) {} s.koppen.vernietig(); } },
      _n: { stemmen, droog, nat, staat },
    });
  },
};

// ---- flanger -----------------------------------------------------------------------

/**
 * Een DelayNode in een lus wordt in Chrome geklemd op één render quantum
 * (128 samples, 2,67 ms bij 48 kHz). De zwaai blijft daarom boven
 * FLANGER_MIN; in de filter app zakte hij eronder en bleef hij daar hangen.
 */
const FLANGER_MIN = 0.0028;
const snelFlanger = (t) => expMap(t, 0.02, 10);
const vertFlanger = (t) => expMap(t, 0.003, 0.015);
const uitslagFlanger = (diepte, vert) => clamp(diepte) * (vert - FLANGER_MIN);
const fbFlanger = (t) => (clamp(t) * 2 - 1) * 0.95;

const flanger = {
  id: 'flanger',
  naam: 'Flanger',
  params: ['snelheid', 'diepte', 'vertraging', 'feedback', 'meng'],
  standaard: { snelheid: 0.44, diepte: 0.7, vertraging: 0.3, feedback: 0.76, meng: 0.5 },
  eenheid: {
    snelheid: (t) => hzLfo(snelFlanger(t)),
    diepte: (t, lees) => {
      const b = vertFlanger(andere(lees, 'vertraging', 0.3)), u = uitslagFlanger(t, b);
      return `${komma((b - u) * 1000, 1)}–${komma((b + u) * 1000, 1)} ms`;
    },
    vertraging: (t) => ms(vertFlanger(t)),
    feedback: (t) => `${teken(Math.round(fbFlanger(t) * 100))}${pct(Math.abs(fbFlanger(t)))}`,
    meng: pct,
  },
  bipolair: ['feedback'],
  /*
   *   in ─┬─► droog ─────────────────────────────────────────────────────┐
   *       └─► inloop ─► inLus ─► som ─► koppen (lfo) ─► mix ─┬─► nat ───┴─► uit
   *                               ▲                            │
   *                               └────────── fb ◄─────────────┘
   *
   * inLus = √(1 − fb²): een kam met terugkoppeling g versterkt ruis met
   * 1/(1 − g²); zo blijft hij bij elke feedback even luid (de pieken op de
   * resonanties niet). Dat deed de filter app niet.
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    const inLus = ctx.createGain(), som = ctx.createGain(), mix = ctx.createGain(), fb = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    ingang.connect(inloop(ctx)).connect(inLus).connect(som);
    const lfo = oscillator(ctx, 'sine', 0.3);
    const koppen = tweeKoppen(ctx, som, mix, { max: 0.03, mod: lfo });
    mix.connect(nat).connect(uitgang);
    mix.connect(fb).connect(som);
    const staat = { diepte: 0.7, vertraging: vertFlanger(0.3), fb: 0 };
    fb.gain.value = 0;
    const pasToe = () => koppen.zet(staat.vertraging, uitslagFlanger(staat.diepte, staat.vertraging));
    pasToe();
    return opStandaard(flanger, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'snelheid') doel(lfo.frequency, snelFlanger(t), now);
        else if (naam === 'diepte') { staat.diepte = t; pasToe(); }
        else if (naam === 'vertraging') { staat.vertraging = vertFlanger(t); pasToe(); }
        else if (naam === 'feedback') {
          staat.fb = fbFlanger(t);
          doel(fb.gain, staat.fb, now);
          doel(inLus.gain, Math.sqrt(1 - staat.fb * staat.fb), now);
        } else if (naam === 'meng') mengNaar(doel, t, droog, nat, now);
      },
      // Uitsterven tot −60 dB: zoveel rondgangen van de langste vertraging.
      staart: () => {
        const d = staat.vertraging + uitslagFlanger(staat.diepte, staat.vertraging), g = Math.abs(staat.fb);
        return Math.min(4, g > 0.01 ? d * Math.log(0.001) / Math.log(g) : d) + 0.005;
      },
      vernietig: () => { try { lfo.stop(); } catch (_) {} koppen.vernietig(); },
      _n: { koppen, lfo, fb, inLus, droog, nat, staat },
    });
  },
};

// ---- vibrato -----------------------------------------------------------------------

const snelVibrato = (t) => expMap(t, 0.1, 15);
/** Uitslag in seconden (filter app: × 0,008). */
const uitslagVibrato = (t) => clamp(t) * 0.008;
/**
 * De basis volgt de diepte (filter app: vast 10 ms): zo vertraagt een ondiepe
 * vibrato het nummer niet 10 ms t.o.v. de andere tracks. Op 0 helemaal niet.
 */
const basisVibrato = (u) => (u > 0 ? u + 0.0005 : 0);

const vibrato = {
  id: 'vibrato',
  naam: 'Vibrato',
  params: ['snelheid', 'diepte'],
  standaard: { snelheid: 0.78, diepte: 0.3 },
  eenheid: {
    snelheid: (t) => hzLfo(snelVibrato(t)),
    diepte: (t) => `±${ms(uitslagVibrato(t))}`,
  },
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const lfo = oscillator(ctx, 'sine', 5);
    const koppen = tweeKoppen(ctx, ingang.connect(inloop(ctx)), uitgang, { max: 0.02, mod: lfo });
    let u = uitslagVibrato(0.3);
    koppen.zet(basisVibrato(u), u);
    return opStandaard(vibrato, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'snelheid') doel(lfo.frequency, snelVibrato(t), now);
        else if (naam === 'diepte') { u = uitslagVibrato(t); koppen.zet(basisVibrato(u), u); }
      },
      staart: () => basisVibrato(u) + u + 0.005,
      vernietig: () => { try { lfo.stop(); } catch (_) {} koppen.vernietig(); },
      _n: { koppen, lfo },
    });
  },
};

// ---- tremolo en autopan: een LFO, vrij of op de maat ---------------------------------

const snelTremolo = (t) => expMap(t, 0.1, 30);
const snelAutopan = (t) => expMap(t, 0.05, 20);
/** Op de maat is de snelheidsknop een deling, vrij is hij Hz (zoals de tijd van de delay). */
const lfoSnelheid = (snel) => (t, lees) => ((andere(lees, 'sync', 1) >= 0.5) ? lfoDelingVan(t).id : hzLfo(snel(t)));

/** Gemeenschappelijk: een Lfo aan de knoppen snelheid/vorm/sync. */
function lfoKnoppen(ctx, klok, snel, standaard) {
  const lfo = new Lfo(ctx, { klok });
  const staat = { snelheid: standaard.snelheid, vorm: standaard.vorm, sync: standaard.sync };
  const pasToe = () => lfo.zet({
    sync: staat.sync >= 0.5, hz: snel(staat.snelheid),
    tellen: lfoDelingVan(staat.snelheid).tellen, vorm: vormVan(staat.vorm),
  });
  return {
    lfo, staat, pasToe,
    zet(naam, t) {
      if (!(naam in staat)) return false;
      staat[naam] = t;
      pasToe();
      return true;
    },
  };
}

const tremolo = {
  id: 'tremolo',
  naam: 'Tremolo',
  params: ['snelheid', 'diepte', 'vorm', 'sync'],
  standaard: { snelheid: 0.5, diepte: 0.8, vorm: 0, sync: 1 },
  eenheid: {
    snelheid: lfoSnelheid(snelTremolo),
    diepte: pct,
    vorm: (t) => vormVan(t),
    sync: (t) => (t >= 0.5 ? 'op de maat' : 'vrij'),
  },
  trappen: { vorm: LFO_VORMEN.length, sync: 2 },
  /*
   * gain = (1 − d/2) + d/2 · golf: tussen 1 − d en 1, vol op de tel (filter
   * app: dezelfde formule). Diepte en golf zijn twee AudioParams, dus diepte
   * glijdt zonder dat de golf opnieuw begint.
   *
   *   in ─► poort ─► uit          lfo ─► diep (d/2) ─► poort.gain
   */
  bouw(ctx, { klok = () => null } = {}) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const poort = ctx.createGain(), diep = ctx.createGain();
    ingang.connect(poort).connect(uitgang);
    const k = lfoKnoppen(ctx, klok, snelTremolo, tremolo.standaard);
    k.lfo.uit.connect(diep).connect(poort.gain);
    poort.gain.value = 0.6;
    diep.gain.value = 0.4;
    k.pasToe();
    return opStandaard(tremolo, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (k.zet(naam, t)) return;
        if (naam === 'diepte') {
          doel(poort.gain, 1 - t / 2, now);
          doel(diep.gain, t / 2, now);
        }
      },
      heranker: () => k.lfo.heranker(),
      staart: () => 0,
      vernietig: () => k.lfo.vernietig(),
      _n: { lfo: k.lfo, poort, diep },
    });
  },
};

const autopan = {
  id: 'autopan',
  naam: 'Autopan',
  params: ['snelheid', 'diepte', 'vorm', 'sync'],
  standaard: { snelheid: 0.45, diepte: 0.8, vorm: 0, sync: 1 },
  eenheid: {
    snelheid: lfoSnelheid(snelAutopan),
    diepte: pct,
    vorm: (t) => vormVan(t),
    sync: (t) => (t >= 0.5 ? 'op de maat' : 'vrij'),
  },
  trappen: { vorm: LFO_VORMEN.length, sync: 2 },
  /*
   * pan = −d · golf: links op de tel. Een StereoPanner op een stereosignaal
   * legt de ene kant bij de andere (Web Audio), zoals in de filter app.
   */
  bouw(ctx, { klok = () => null } = {}) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const pan = ctx.createStereoPanner(), diep = ctx.createGain();
    ingang.connect(pan).connect(uitgang);
    const k = lfoKnoppen(ctx, klok, snelAutopan, autopan.standaard);
    k.lfo.uit.connect(diep).connect(pan.pan);
    pan.pan.value = 0;
    diep.gain.value = -0.8;
    k.pasToe();
    return opStandaard(autopan, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (k.zet(naam, t)) return;
        if (naam === 'diepte') doel(diep.gain, -t, now);
      },
      heranker: () => k.lfo.heranker(),
      staart: () => 0,
      vernietig: () => k.lfo.vernietig(),
      _n: { lfo: k.lfo, pan, diep },
    });
  },
};

// ---- auto-wah -------------------------------------------------------------------------

const voorWah = (t) => 1 + 12 * clamp(t);
const basisWah = (t) => expMap(t, 60, 3000);
/** Hoeveel octaven de omhullende het filter omhoog mag duwen: tot 4, en nooit boven 20 kHz. */
const WAH_TOP = 20000;
const octavenWah = (t, basis) => Math.max(0, Math.min(4 * clamp(t), Math.log2(WAH_TOP / basis)));
const qWah = (t) => expMap(t, 0.5, 20);
/**
 * Een bandpass laat van breedbandig materiaal maar een smalle band door: in
 * de filter app was de wah op meng 1 7 (Q 0,5) tot 21 dB (Q 20) zachter dan
 * droog, gemeten op roze ruis. Nat × √(2Q), hooguit × 4: nu 5–9 dB, en een
 * toon precies op de piek komt hooguit 12 dB boven zichzelf uit.
 */
const natWah = (q) => Math.min(4, Math.sqrt(2 * q));
const aanzetWah = (t) => expMap(t, 0.001, 0.3);
const vervalWah = (t) => expMap(t, 0.01, 1);
/** Omhullende × gevoel, zacht begrensd op 1: zo loopt het filter nooit tegen Nyquist (de filter app wel). */
let wahCurve = null;
function wahVorm() {
  if (!wahCurve) {
    const n = 1025;
    wahCurve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = 2 * i / (n - 1) - 1; wahCurve[i] = x > 0 ? Math.tanh(2.5 * x) / Math.tanh(2.5) : 0; }
  }
  return wahCurve;
}

const autowah = {
  id: 'autowah',
  naam: 'Auto-wah',
  params: ['gevoel', 'basis', 'bereik', 'reso', 'aanzet', 'verval', 'meng'],
  standaard: { gevoel: 0.6, basis: 0.365, bereik: 0.6, reso: 0.674, aanzet: 0.404, verval: 0.588, meng: 0.5 },
  eenheid: {
    gevoel: (t) => `×${komma(voorWah(t), 1)}`,
    basis: (t) => hz(basisWah(t)),
    bereik: (t, lees) => `${komma(octavenWah(t, basisWah(andere(lees, 'basis', 0.365))), 1)} oct`,
    reso: (t) => `Q ${komma(qWah(t), 1)}`,
    aanzet: (t) => ms(aanzetWah(t)),
    verval: (t) => ms(vervalWah(t)),
    meng: pct,
  },
  /*
   *   in ─┬─► droog ──────────────────────────────┐
   *       ├─► bandpass ─► √(2Q) ─► nat ───────────┴─► uit
   *       └─► omhullende (worklet) ─► gevoel ─► vorm ─► bereik ─► aan ─► bandpass.detune
   *
   * Zonder worklet (nog niet geladen, of de context kan het niet) staat het
   * filter stil op de basis: een wah-pedaal in rust. Komt hij later binnen,
   * dan vloeit de omhullende in (`aan` van 0 naar 1); was hij er al, dan is
   * hij er meteen.
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    const bp = ctx.createBiquadFilter(), terug = ctx.createGain();
    bp.type = 'bandpass';      // bij een bandpass is Q een gewone Q, geen dB
    ingang.connect(droog).connect(uitgang);
    ingang.connect(bp).connect(terug).connect(nat).connect(uitgang);
    const gevoel = ctx.createGain(), vorm = ctx.createWaveShaper(), bereik = ctx.createGain(), aan = ctx.createGain();
    vorm.curve = wahVorm();
    aan.gain.value = 0;
    gevoel.connect(vorm).connect(bereik).connect(aan).connect(bp.detune);
    const staat = { basis: basisWah(0.365), bereik: 0.6, aanzet: aanzetWah(0.404), verval: vervalWah(0.588), q: qWah(0.674) };
    bp.frequency.value = staat.basis;
    bp.Q.value = staat.q;
    terug.gain.value = natWah(staat.q);
    const zetBereik = (now) => doel(bereik.gain, 1200 * octavenWah(staat.bereik, staat.basis), now);
    const omh = metWorklet(ctx, 'varve-fx-omhullende',
      { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' },
      (node, meteen) => {
        node.parameters.get('aanzet').value = staat.aanzet;
        node.parameters.get('verval').value = staat.verval;
        ingang.connect(node);
        node.connect(gevoel);
        if (meteen) aan.gain.value = 1;
        else lineair(aan.gain, 1, ctx, WORKLET_FADE);
      });
    return opStandaard(autowah, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'gevoel') doel(gevoel.gain, voorWah(t), now);
        else if (naam === 'basis') { staat.basis = basisWah(t); doel(bp.frequency, staat.basis, now); zetBereik(now); }
        else if (naam === 'bereik') { staat.bereik = t; zetBereik(now); }
        else if (naam === 'reso') {
          staat.q = qWah(t);
          doel(bp.Q, staat.q, now);
          doel(terug.gain, natWah(staat.q), now);
        }
        else if (naam === 'aanzet' || naam === 'verval') {
          staat[naam] = naam === 'aanzet' ? aanzetWah(t) : vervalWah(t);
          if (omh.node) doel(omh.node.parameters.get(naam), staat[naam], now);
        } else if (naam === 'meng') mengNaar(doel, t, droog, nat, now);
      },
      // Een smalle bandpass rinkelt na: −60 dB na 6,9·Q/(π·f) seconden, op zijn laagst.
      staart: () => Math.min(2, 6.91 * staat.q / (Math.PI * staat.basis)) + 0.005,
      vernietig: () => omh.stop(),
      _n: { bp, terug, gevoel, bereik, aan, droog, nat, omh, staat },
    });
  },
};

// ---- pitch shift ------------------------------------------------------------------------

const halveTonen = (t) => Math.round(clamp(t) * 48 - 24);

const pitch = {
  id: 'pitch',
  naam: 'Pitch',
  params: ['interval', 'meng'],
  standaard: { interval: 31 / 48, meng: 0.5 },
  eenheid: {
    interval: (t) => `${teken(halveTonen(t))}${Math.abs(halveTonen(t))} ht`,
    meng: pct,
  },
  trappen: { interval: 49 },
  bipolair: ['interval'],
  /*
   * De granulaire toonhoogte van de filter app (fx-kern.js), als worklet. Tot
   * hij geladen is klinkt het effect helemaal droog (ook met meng op 1: niets
   * horen is erger dan niets veranderen), daarna vloeit het naar de meng. Was
   * de module er al (een eerder effect), dan klinkt hij meteen.
   * Vertraging ~45 ms gemiddeld (een halve korrel).
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    nat.connect(uitgang);
    droog.gain.value = 1;
    nat.gain.value = 0;
    const staat = { st: 7, meng: 0.5, geladen: false };
    const w = metWorklet(ctx, 'varve-fx-toonhoogte',
      { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' },
      (node, meteen) => {
        node.parameters.get('halvetonen').value = staat.st;
        // De lijn begint leeg: een inloop, anders begint de eerste korrel abrupt.
        ingang.connect(inloop(ctx)).connect(node);
        node.connect(nat);
        staat.geladen = true;
        if (meteen) {
          droog.gain.value = Math.cos(staat.meng * Math.PI / 2);
          nat.gain.value = Math.sin(staat.meng * Math.PI / 2);
        } else {
          lineair(droog.gain, Math.cos(staat.meng * Math.PI / 2), ctx, WORKLET_FADE);
          lineair(nat.gain, Math.sin(staat.meng * Math.PI / 2), ctx, WORKLET_FADE);
        }
      });
    return opStandaard(pitch, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'interval') {
          staat.st = halveTonen(t);
          if (w.node) doel(w.node.parameters.get('halvetonen'), staat.st, now);
        } else if (naam === 'meng') {
          staat.meng = t;
          if (staat.geladen) mengNaar(doel, t, droog, nat, now);
        }
      },
      staart: () => 0.1,
      vernietig: () => w.stop(),
      _n: { w, droog, nat, staat },
    });
  },
};

// ---- compressor ----------------------------------------------------------------------

const drempelDb = (t) => -60 + 60 * clamp(t);
const ratioComp = (t) => expMap(t, 1, 20);
const aanzetComp = (t) => expMap(t, 0.001, 1);
const vervalComp = (t) => expMap(t, 0.01, 1);
const makeupDb = (t) => -12 + 24 * clamp(t);
const KNIE = 12;
/** Chrome's DynamicsCompressor kijkt 6 ms vooruit (pre-delay), dus zoveel later komt alles eruit. */
export const compLatentie = (sr) => Math.floor(0.006 * sr) / sr;

/**
 * De make-up gain die Chrome's DynamicsCompressor ZELF toepast (Web Audio-spec,
 * Chromium dynamics_compressor_kernel.cc): (1 / curve(1))^0,6, met de knie als
 * exponentiële kromme waarvan k zo gekozen is dat de helling aan het eind van
 * de knie 1/ratio is. Gemeten in Chrome: drempel −24, knie 12, ratio 4 geeft
 * +8,21 dB; dit rekent +8,21. Die delen we eruit: onder de drempel komt het
 * signaal er even luid uit als het erin ging, en `makeup` is echt wat erbij komt.
 */
export function chromeMakeup(dbDrempel, dbKnie, ratio) {
  const lin2db = (x) => 20 * Math.log10(x), db2lin = (d) => Math.pow(10, d / 20);
  const linT = db2lin(dbDrempel);
  const knie = (x, k) => (x < linT ? x : linT + (1 - Math.exp(-k * (x - linT))) / k);
  const helling = (x, k) => {
    if (x < linT) return 1;
    const x2 = x * 1.001;
    return (lin2db(knie(x2, k)) - lin2db(knie(x, k))) / (lin2db(x2) - lin2db(x));
  };
  const xk = db2lin(dbDrempel + dbKnie);
  let mn = 0.1, mx = 10000, k = 5;
  for (let i = 0; i < 15; i++) {
    if (helling(xk, k) < 1 / ratio) mx = k; else mn = k;
    k = Math.sqrt(mn * mx);
  }
  const ykDb = lin2db(knie(xk, k));
  const vol = 1 < xk ? knie(1, k) : db2lin(ykDb + (0 - (dbDrempel + dbKnie)) / ratio);
  return Math.pow(1 / vol, 0.6);
}

const compressor = {
  id: 'compressor',
  naam: 'Compressor',
  params: ['drempel', 'ratio', 'aanzet', 'verval', 'makeup', 'meng'],
  standaard: { drempel: 0.6, ratio: 0.4628, aanzet: 0.3333, verval: 0.699, makeup: 0.75, meng: 1 },
  eenheid: {
    drempel: (t) => db(drempelDb(t)),
    ratio: (t) => `${komma(ratioComp(t), 1)}:1`,
    aanzet: (t) => ms(aanzetComp(t)),
    verval: (t) => ms(vervalComp(t)),
    makeup: (t) => db(makeupDb(t)),
    meng: pct,
  },
  bipolair: ['makeup'],
  /*
   *   in ─► inloop ─┬─► vertraging (6 ms) ─► droog ─────────────────────┐
   *                 ├─► compressor 0 ─► chrome⁻¹ ─► g_0 ─┐               │
   *                 └─► compressor 1 ─► chrome⁻¹ ─► g_1 ─┴─► makeup ─► nat ─┴─► uit
   *
   * Het droge pad wacht even lang als de compressor, anders is meng een
   * kamfilter (parallel comprimeren). De mix-knop van het rack heeft die
   * vertraging NIET: gebruik voor parallel de eigen meng.
   *
   * Twee compressoren: Chrome rekent zijn curve (en zijn eigen make-up) per
   * blok van 128 samples uit drempel en ratio, dus die verzetten terwijl er
   * geluid is geeft trapjes (gemeten: ×800 boven de gewone tweede afgeleide).
   * Een nieuwe drempel of ratio gaat op de stille compressor, die hetzelfde
   * signaal krijgt en dus meteen goed staat, en daar wordt naartoe gevloeid.
   * Aanzet en verval veranderen alleen hoe snel hij reageert: die glijden op allebei.
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain(), makeup = ctx.createGain();
    const zacht = inloop(ctx);
    ingang.connect(zacht);
    const wacht = ctx.createDelay(0.05);
    wacht.delayTime.value = compLatentie(ctx.sampleRate);
    zacht.connect(wacht).connect(droog).connect(uitgang);
    makeup.connect(nat).connect(uitgang);
    const paden = [0, 1].map(() => {
      const comp = ctx.createDynamicsCompressor(), terug = ctx.createGain(), g = ctx.createGain();
      comp.knee.value = KNIE;
      zacht.connect(comp).connect(terug).connect(g).connect(makeup);
      return { comp, terug, g };
    });
    const staat = { drempel: -24, ratio: 4, makeup: 6 };
    makeup.gain.value = dbToGain(staat.makeup);
    const w = wisselaar(ctx, paden, (pad, st, nu) => {
      direct(pad.comp.threshold, st.drempel, nu);
      direct(pad.comp.ratio, st.ratio, nu);
      direct(pad.terug.gain, 1 / chromeMakeup(st.drempel, KNIE, st.ratio), nu);
    }, (a, b) => a.drempel === b.drempel && a.ratio === b.ratio);
    const curve = () => w.zet({ drempel: staat.drempel, ratio: staat.ratio });
    curve();
    const actief = () => paden[w.actief].comp;
    return opStandaard(compressor, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'drempel') { staat.drempel = drempelDb(t); curve(); }
        else if (naam === 'ratio') { staat.ratio = ratioComp(t); curve(); }
        else if (naam === 'aanzet') for (const p of paden) doel(p.comp.attack, aanzetComp(t), now);
        else if (naam === 'verval') for (const p of paden) doel(p.comp.release, vervalComp(t), now);
        else if (naam === 'makeup') { staat.makeup = makeupDb(t); doel(makeup.gain, dbToGain(staat.makeup), now); }
        else if (naam === 'meng') mengNaar(doel, t, droog, nat, now);
      },
      staart: () => compLatentie(ctx.sampleRate) + 0.005,
      vernietig: () => w.vernietig(),
      _n: { paden, wissel: w, get comp() { return actief(); }, get terug() { return paden[w.actief].terug; }, makeup, wacht, droog, nat, staat },
    });
  },
};

// ---- stereo-verbreder ----------------------------------------------------------------

const breedteZij = (t) => 2 * clamp(t);
const haasTijd = (t) => 0.025 * clamp(t);

const widener = {
  id: 'widener',
  naam: 'Breedte',
  params: ['breedte', 'haas'],
  standaard: { breedte: 0.75, haas: 0 },
  eenheid: {
    breedte: (t) => pct(breedteZij(t)),
    haas: (t) => (haasTijd(t) < 0.00005 ? 'uit' : ms(haasTijd(t))),
  },
  /*
   * Twee manieren, de filter app had alleen de tweede:
   *   - breedte: midden/zijkant. Zijkant × 0..2 (100% = onveranderd, 0% =
   *     mono). Mono blijft hetzelfde (L + R verandert niet), dus ook op een
   *     mono-PA klinkt er niets weg. Op een mono stem doet dit niets;
   *   - haas: het rechterkanaal 0..25 ms later (filter app). Werkt ook op een
   *     mono stem, maar is een kamfilter als je naar mono optelt. Verzetten
   *     gaat met twee koppen (geen glijdende toon).
   */
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    // Inloop: met haas begint het rechterkanaal anders abrupt na de vertraging.
    ingang.connect(inloop(ctx)).connect(split);
    const mono = (g = 1) => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.channelCount = 1;
      n.channelCountMode = 'explicit';
      return n;
    };
    const midden = mono(), zij = mono(), zijW = mono(1), zijMin = mono(-1), links = mono(), rechts = mono(), rechtsUit = mono();
    const lm = mono(0.5), rm = mono(0.5), ls = mono(0.5), rs = mono(-0.5);
    split.connect(lm, 0); split.connect(ls, 0);
    split.connect(rm, 1); split.connect(rs, 1);
    lm.connect(midden); rm.connect(midden);
    ls.connect(zij); rs.connect(zij);
    zij.connect(zijW);
    zijW.connect(zijMin);
    midden.connect(links); zijW.connect(links);
    midden.connect(rechts); zijMin.connect(rechts);
    links.connect(merge, 0, 0);
    const koppen = tweeKoppen(ctx, rechts, rechtsUit, { max: 0.03 });
    rechtsUit.connect(merge, 0, 1);
    merge.connect(uitgang);
    let haas = 0;
    koppen.zet(0);
    return opStandaard(widener, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'breedte') doel(zijW.gain, breedteZij(t), now);
        else if (naam === 'haas') { haas = haasTijd(t); koppen.zet(haas); }
      },
      staart: () => haas + 0.005,
      vernietig: () => koppen.vernietig(),
      _n: { zijW, koppen },
    });
  },
};

/** In de volgorde van de kiezer, na de zeven van fx.js. */
export const MEER_EFFECTEN = [distortion, chorus, flanger, vibrato, tremolo, autopan, autowah, pitch, compressor, widener];
