import { clamp, expMap } from '../lib/emitter.js';
import { leesRack, schrijfRack, resolveMacros, rackVanEffect, LEEG_RACK } from './rack.js';

/**
 * De insert-slot: één effectketen per deck, klikvrij verwisselbaar.
 *
 * Dit is stap 1 van de effect-racks, en bewust nog zonder rack-data. Eerst het
 * mechanisme bewijzen met je oren; pas daarna komt er JSON omheen. Wat hier al
 * wél goed moet staan, want later is het duur:
 *
 *   - Verander NOOIT de bedrading van een keten waar signaal doorheen loopt.
 *     `disconnect()` is niet sample-accuraat; staat er op dat moment signaal op,
 *     dan hoor je een klik. Of je hem hoort hangt af van het niveau — daarom is
 *     dit een bug die je pas op het podium tegenkomt.
 *   - Wisselen gaat dus via een equal-power kruisfade tussen twee COMPLETE
 *     ketens. Lineair kruisfaden geeft een dip in het midden, want dry en wet
 *     van hetzelfde signaal zijn maximaal gecorreleerd.
 *   - Hergebruik geen nodes. "Zelfde delay, andere parameters" lijkt zuinig en
 *     is de bron van de helft van je toekomstige klikken.
 *   - Ruim de oude keten pas op na kruisfade PLUS staarttijd. Eerder afkappen
 *     hoor je harder dan de klik die je probeerde te vermijden.
 *
 * Alle parameters zijn genormaliseerd 0..1. De schaling zit hier, in code.
 */

export const FADE = 0.04;      // 40 ms kruisfade
const TIJD_FADE = 0.08;        // delaytijd wisselen: iets langer, echo's zijn lang

/**
 * Muzikale delingen. Een rack slaat een DELING op, nooit seconden — anders
 * klopt hij niet meer zodra het tempo verandert.
 */
export const DELINGEN = [
  { id: '1/1', tellen: 4 }, { id: '1/2', tellen: 2 }, { id: '1/4', tellen: 1 },
  { id: '1/8', tellen: 0.5 }, { id: '3/16', tellen: 0.75 }, { id: '1/16', tellen: 0.25 },
];
export const delingVan = (t) => DELINGEN[Math.min(DELINGEN.length - 1,
  Math.max(0, Math.round(clamp(t) * (DELINGEN.length - 1))))];

/**
 * Wat een tempo-gesynchroniseerd effect van buiten nodig heeft.
 *
 * `beatLengte` is de HOORBARE tellengte (grid gedeeld door de rate), en
 * `ankerCtx` is het moment op de audioklok waarop de eerstvolgende tel valt.
 * Zonder dat tweede loopt je gate wel op tempo maar op de verkeerde tel, en
 * dat is net zo waardeloos als helemaal niet synchroon.
 */
export const GEEN_KLOK = () => null;

/**
 * Hoe dicht bij `nu` een start op de audioklok nog op tijd komt. Wat binnen
 * de uitgangsbuffer valt (of binnen het blok dat de audiothread al rendert)
 * start te laat, en dan hoor je hem naast de tel. Plus 3 ms marge voor het
 * bericht naar de audiothread.
 */
export const startDrempel = (ctx) => Math.max(ctx.baseLatency ?? 0, 128 / ctx.sampleRate) + 0.003;

/**
 * Het moment om op de tel te starten: het anker van de klok, of — als dat al
 * binnen de drempel ligt — de eerstvolgende tel daarna. Zonder klok: nu.
 */
export function startOpDeTel(ctx, k) {
  const nu = ctx.currentTime;
  if (!k || !Number.isFinite(k.ankerCtx)) return nu;
  let t = k.ankerCtx;
  const grens = nu + startDrempel(ctx);
  if (t < grens) t = k.beatLengte > 0 ? t + Math.ceil((grens - t) / k.beatLengte) * k.beatLengte : nu;
  return t;
}

/**
 * Echotijden op de maat, van kort naar lang: knop rechts = langer, net als in
 * milliseconden. Los van DELINGEN (gate), die van lang naar kort loopt.
 */
export const ECHO_DELINGEN = [
  { id: '1/16', tellen: 0.25 }, { id: '1/8', tellen: 0.5 }, { id: '3/16', tellen: 0.75 },
  { id: '1/4', tellen: 1 }, { id: '3/8', tellen: 1.5 }, { id: '1/2', tellen: 2 },
  { id: '3/4', tellen: 3 }, { id: '1/1', tellen: 4 },
];
export const echoDelingVan = (t) => ECHO_DELINGEN[Math.min(ECHO_DELINGEN.length - 1,
  Math.max(0, Math.round(clamp(t) * (ECHO_DELINGEN.length - 1))))];

// ---- eenheden --------------------------------------------------------------
// Wat een 0..1-waarde in het echt IS. Rekent met precies dezelfde formule als
// zet() hieronder; wijkt een van de twee af, dan liegt het scherm.

const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.', ',')} kHz` : `${Math.round(f)} Hz`);
const pct = (v) => `${Math.round(v * 100)}%`;
const filterStand = (t) => {
  const d = t * 2 - 1;
  if (Math.abs(d) < 0.02) return 'open';
  return d < 0 ? `LP ${hz(expMap(1 + d, 200, 22050))}` : `HP ${hz(expMap(d, 20, 9000))}`;
};
const crushStappen = (t) => Math.max(1, Math.round(Math.pow(2, 1 + (1 - t) * 6)));
const CURVE_N = 33;

/** Equal-power curve van a naar b. */
function fadeCurve(van, naar) {
  const c = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    const t = i / (CURVE_N - 1);
    c[i] = van * Math.cos(t * Math.PI / 2) + naar * Math.cos((1 - t) * Math.PI / 2);
  }
  return c;
}

/**
 * Een doelwaarde zetten op een parameter waar mogelijk nog een curve op loopt.
 *
 * Web Audio weigert `setTargetAtTime` als het overlapt met een lopende
 * `setValueCurveAtTime` — en gooit dan een NotSupportedError die je hele
 * aanroepketen meeneemt. Dat gebeurt precies wanneer je aan de mix draait vlak
 * nadat je van effect gewisseld bent, oftewel: tijdens het spelen.
 *
 * `cancelAndHoldAtTime` breekt de curve netjes af op zijn huidige waarde.
 * Kent de browser hem niet, dan vallen we terug; en faalt het alsnog, dan
 * zetten we de waarde hard in plaats van de aanroeper te laten struikelen.
 */
export function zetDoel(param, waarde, ctx, tau = 0.01) {
  const nu = ctx.currentTime;
  try {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(nu);
    else param.cancelScheduledValues?.(nu);
  } catch (_) {}
  try {
    param.setTargetAtTime(waarde, nu, tau);
  } catch (_) {
    try { param.value = waarde; } catch (__) {}
  }
}

/**
 * Een equal-power curve van `van` naar `naar`, ook als er nog een loopt.
 *
 * cancelScheduledValues haalt alleen weg wat op of na `nu` BEGINT; een curve
 * die al loopt blijft staan, en een nieuwe erbovenop gooit NotSupportedError.
 * Twee keer snel van rack wisselen (binnen de 40 ms van een kruisfade) deed
 * precies dat — en het oude vangnet gooide dezelfde fout nog eens. Nu eerst
 * de lopende curve afbreken op zijn huidige waarde, en vanaf daar verder.
 */
function zetCurve(param, van, naar, ctx, duur = FADE) {
  const nu = ctx.currentTime;
  try {
    if (param.cancelAndHoldAtTime) { param.cancelAndHoldAtTime(nu); van = param.value; }
    else param.cancelScheduledValues?.(nu);
    param.setValueCurveAtTime(fadeCurve(van, naar), nu, duur);
  } catch (_) {
    // Laatste vangnet: nooit de aanroeper laten struikelen.
    try { param.setTargetAtTime(naar, nu, duur / 3); } catch (__) { try { param.value = naar; } catch (___) {} }
  }
}

// ---- effecten --------------------------------------------------------------
// Elk effect levert in/uit, een setter per parameter, en zijn staarttijd. Die
// staarttijd is geen sier: hij bepaalt wanneer de oude keten weg mag.

export const EFFECTEN = [
  {
    id: 'delay',
    naam: 'Delay',
    params: ['tijd', 'feedback', 'toon', 'sync'],
    standaard: { tijd: 0.35, feedback: 0.45, toon: 0.6, sync: 0 },
    eenheid: {
      // Op de maat betekent dezelfde knop een deling in plaats van ms.
      tijd: (t, lees) => ((lees?.('sync') ?? 0) >= 0.5 ? `${echoDelingVan(t).id} tel` : `${Math.round(expMap(t, 0.02, 1.2) * 1000)} ms`),
      feedback: (t) => pct(t * 0.92),
      toon: (t) => hz(expMap(t, 300, 16000)),
      sync: (t) => (t >= 0.5 ? 'op de maat' : 'vrij'),
    },
    trappen: { sync: 2 },
    /*
     * Twee leeskoppen op hetzelfde signaal, in plaats van één delay waarvan
     * je de tijd verschuift.
     *
     * Verschuif je delayTime, dan leest de delay zijn geheugen met een andere
     * snelheid uit en glijdt de toonhoogte van alles wat al in de echo zit:
     * het doppler-gejank van een tapedelay. Hier niet: beide koppen krijgen
     * steeds hetzelfde signaal, dus ook de stille kop heeft een geldige
     * geschiedenis. Een nieuwe tijd gaat op de stille kop, en daar
     * kruisfaden we naartoe. Ableton noemt dit "Fade"; het andere heet daar
     * "Repitch".
     *
     *   in ─► som ─┬─► kop 1 ─► g1 ─┐
     *              └─► kop 2 ─► g2 ─┴─► uit ─► toon ─► fb ─► som
     */
    bouw(ctx, { klok = GEEN_KLOK } = {}) {
      const ingang = ctx.createGain();
      const uitgang = ctx.createGain();
      const som = ctx.createGain();
      const koppen = [ctx.createDelay(2.0), ctx.createDelay(2.0)];
      const gains = [ctx.createGain(), ctx.createGain()];
      const mix = ctx.createGain();
      const fb = ctx.createGain();
      const toon = ctx.createBiquadFilter();
      toon.type = 'lowpass';
      // Standaard Q is 1 dB: een bult van 12% boven 1 in de feedbacklus. Met
      // feedback op 92% is de lus dan 1,03 en zwelt een echo aan in plaats
      // van uit te sterven. Negatief = geen piek. Zie ook de reverb.
      toon.Q.value = -6;

      // Let op: een lus MOET een DelayNode bevatten, anders mute de browser het
      // hele lusgedeelte. En delayTime in een lus wordt geklemd op minimaal één
      // render quantum (128 samples, ~2,7 ms bij 48 kHz).
      ingang.connect(som);
      for (let k = 0; k < 2; k++) som.connect(koppen[k]).connect(gains[k]).connect(mix);
      mix.connect(uitgang);
      mix.connect(toon).connect(fb).connect(som);
      gains[0].gain.value = 1;
      gains[1].gain.value = 0;

      // knop = stand van de tijdknop; tijd = de seconden die daaruit volgen.
      const staat = { knop: 0.35, sync: false, tijd: 0.35, feedback: 0.45, tel: null };
      let actief = 0;              // welke kop je hoort
      let klaarOm = 0;             // audiokloktijd waarop de lopende fade af is
      let wachtend = null;         // laatste tijd die nog moet, als je snel draait
      let timer = null;

      const wissel = (sec) => {
        const nu = ctx.currentTime;
        if (nu < klaarOm) {
          // Twee fades over elkaar klikken. Onthoud alleen de laatste stand
          // en pak die zodra deze fade klaar is.
          wachtend = sec;
          timer ??= setTimeout(() => {
            timer = null;
            const w = wachtend;
            wachtend = null;
            if (w !== null) wissel(w);
          }, (klaarOm - nu) * 1000 + 5);
          return;
        }
        if (Math.abs(koppen[actief].delayTime.value - sec) < 1e-4) return;
        const nieuw = 1 - actief;
        koppen[nieuw].delayTime.cancelScheduledValues?.(nu);
        koppen[nieuw].delayTime.setValueAtTime(sec, nu);
        zetCurve(gains[actief].gain, 1, 0, ctx, TIJD_FADE);
        zetCurve(gains[nieuw].gain, 0, 1, ctx, TIJD_FADE);
        actief = nieuw;
        klaarOm = nu + TIJD_FADE + 0.005;
      };

      /*
       * Op de maat: tellen × de hoorbare tellengte van de klok. Is er even
       * geen klok (de maat-track staat stil), dan de laatst bekende tel —
       * terugvallen op een vast tempo zou de echo midden in een set laten
       * verspringen. Nooit een tel gezien: 120 bpm.
       */
      const seconden = () => {
        if (!staat.sync) return expMap(staat.knop, 0.02, 1.2);
        const k = klok();
        if (k?.beatLengte > 0) staat.tel = k.beatLengte;
        return Math.min(1.99, Math.max(0.003, (staat.tel ?? 0.5) * echoDelingVan(staat.knop).tellen));
      };

      let eerste = true;
      const zetTijd = () => {
        const sec = seconden();
        staat.tijd = sec;
        // Bij het bouwen, of zolang de audio niet loopt, klinkt er niets:
        // dan beide koppen meteen goed. Een fade wachten op een klok die
        // stilstaat zou nooit klaar zijn.
        if (eerste || (ctx.state && ctx.state !== 'running')) {
          eerste = false;
          for (const k of koppen) k.delayTime.value = sec;
          wachtend = null;
        } else {
          wissel(sec);
        }
      };

      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'tijd') {
            staat.knop = t;
            zetTijd();
          } else if (naam === 'sync') {
            staat.sync = t >= 0.5;
            zetTijd();
          } else if (naam === 'feedback') {
            // Geklemd onder 1: zelfoscillatie blaast je set op.
            staat.feedback = t * 0.92;
            fb.gain.setTargetAtTime(staat.feedback, now, 0.02);
          } else if (naam === 'toon') {
            toon.frequency.setTargetAtTime(expMap(t, 300, 16000), now, 0.02);
          }
        },
        // Hoe lang blijft er nog iets klinken als de invoer stopt?
        staart: () => Math.min(8, staat.tijd * (staat.feedback > 0.05
          ? Math.log(0.001) / Math.log(staat.feedback) : 1)),
        // Tempo, seek of een andere maat-track: op de maat opnieuw uitrekenen.
        // Via wissel(), dus met kruisfade en zonder doppler.
        heranker: () => { if (staat.sync) zetTijd(); },
        vernietig: () => { clearTimeout(timer); timer = null; wachtend = null; },
        // Voor de tests: welke kop klinkt en op welke tijd.
        _kop: () => ({ actief, tijden: koppen.map((k) => k.delayTime.value), gains: gains.map((g) => g.gain.value) }),
      };
    },
  },
  {
    id: 'filter',
    naam: 'Filter',
    params: ['freq', 'reso'],
    standaard: { freq: 0.5, reso: 0.2 },
    eenheid: { freq: filterStand, reso: (t) => `Q ${(0.7 + t * 12).toFixed(1).replace('.', ',')}` },
    bipolair: ['freq'],
    bouw(ctx) {
      const ingang = ctx.createGain();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 20;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 22050;
      const uitgang = ctx.createGain();
      ingang.connect(hp).connect(lp).connect(uitgang);
      // Beide onthouden: resonantie verzetten mag de frequentie niet terug
      // naar het midden gooien (dat deed hij tot 23 september 2026).
      let reso = 0.2, freq = 0.5;
      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'reso') reso = t;
          if (naam === 'freq') freq = t;
          if (naam === 'freq' || naam === 'reso') {
            const d = freq * 2 - 1;
            const q = 0.7 + reso * 12;
            if (d < 0) {
              lp.frequency.setTargetAtTime(expMap(1 + d, 200, 22050), now, 0.01);
              lp.Q.setTargetAtTime(q, now, 0.01);
              hp.frequency.setTargetAtTime(20, now, 0.01);
            } else {
              hp.frequency.setTargetAtTime(expMap(d, 20, 9000), now, 0.01);
              hp.Q.setTargetAtTime(q, now, 0.01);
              lp.frequency.setTargetAtTime(22050, now, 0.01);
            }
          }
        },
        staart: () => 0,
      };
    },
  },
  {
    id: 'crush',
    naam: 'Bitcrush',
    params: ['bits', 'toon'],
    standaard: { bits: 0.6, toon: 1 },
    eenheid: {
      bits: (t) => `${Math.log2(2 * crushStappen(t) + 1).toFixed(1).replace('.', ',')} bit`,
      toon: (t) => hz(expMap(t, 600, 20000)),
    },
    bouw(ctx) {
      const ingang = ctx.createGain();
      const vorm = ctx.createWaveShaper();
      const toon = ctx.createBiquadFilter(); toon.type = 'lowpass'; toon.frequency.value = 22050;
      const uitgang = ctx.createGain();
      ingang.connect(vorm).connect(toon).connect(uitgang);
      // Aliasing is hier een feature, dus geen oversampling.
      vorm.oversample = 'none';
      const trap = (stappen) => {
        const n = 1024, c = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * 2 - 1;
          c[i] = Math.round(x * stappen) / stappen;
        }
        return c;
      };
      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'bits') vorm.curve = trap(crushStappen(t));
          else if (naam === 'toon') toon.frequency.setTargetAtTime(expMap(t, 600, 20000), now, 0.02);
        },
        staart: () => 0,
      };
    },
  },
  {
    id: 'gate',
    naam: 'Gate',
    params: ['deling', 'vorm', 'diepte'],
    standaard: { deling: 0.6, vorm: 0.5, diepte: 1 },
    eenheid: {
      deling: (t) => delingVan(t).id,
      vorm: (t) => `${Math.round((0.1 + t * 0.8) * 100)}% open`,
      diepte: pct,
    },
    trappen: { deling: DELINGEN.length },
    /**
     * Ritmische gate op het beatgrid.
     *
     * Een blokgolf als AudioBuffer, loopend, rechtstreeks op de gain van het
     * signaal. Dat is sample-accuraat: je start hem op een tijd van de
     * audioklok en daarna loopt hij precies mee. Een gate die op tempo loopt
     * maar op de verkeerde tel begint is waardeloos — vandaar het anker.
     */
    bouw(ctx, { klok = GEEN_KLOK } = {}) {
      const ingang = ctx.createGain();
      const poort = ctx.createGain();
      const uitgang = ctx.createGain();
      ingang.connect(poort).connect(uitgang);
      poort.gain.value = 1;

      let bron = null;
      let cyclus = null;        // { buf, n, vorm, diepte }: de laatst gebouwde buffer
      const staat = { deling: 0.6, vorm: 0.5, diepte: 1 };

      /** Eén cyclus van n samples: open, dan dicht. `vorm` verschuift de verhouding. */
      const maakBuffer = (n) => {
        const sr = ctx.sampleRate;
        const buf = ctx.createBuffer(1, n, sr);
        const d = buf.getChannelData(0);
        const open = Math.max(1, Math.round(n * (0.1 + staat.vorm * 0.8)));
        const helling = Math.max(2, Math.round(n * 0.02));   // zachte randen, anders klikt het
        for (let i = 0; i < n; i++) {
          let v;
          if (i < open) v = 1;
          else v = 1 - staat.diepte;
          if (i < helling) v = (1 - staat.diepte) + (v - (1 - staat.diepte)) * (i / helling);
          if (i >= open && i < open + helling) {
            const t = (i - open) / helling;
            v = 1 * (1 - t) + (1 - staat.diepte) * t;
          }
          d[i] = v;
        }
        return buf;
      };

      /*
       * Opnieuw op de tel zetten — bij seek, hotcue, sync, tempo, grid.
       *
       * Tot 23 september 2026 stopte dit de oude puls meteen en zette het de
       * poort hard op 0 tot de nieuwe op de volgende tel begon: een klik en
       * tot een tel stilte, bij elke beweging van de tempofader opnieuw. Nu
       * loopt de oude puls door TOT het moment dat de nieuwe begint, en
       * wordt alles op de audioklok ingepland in plaats van nu gezet.
       */
      const herstart = () => {
        const k = klok();
        const nu = ctx.currentTime;
        const oud = bron;
        bron = null;
        if (!k || !k.beatLengte) {
          // Geen maat: poort open. De oude puls pas stoppen als de poort
          // weer 1 is, anders klikt het.
          poort.gain.cancelScheduledValues?.(nu);
          poort.gain.setValueAtTime(oud ? 0 : poort.gain.value, nu);
          poort.gain.linearRampToValueAtTime(1, nu + 0.005);
          if (oud) { try { oud.stop(nu + 0.006); } catch (_) {} }
          return;
        }
        const periode = k.beatLengte * delingVan(staat.deling).tellen;
        if (!(periode > 0.005)) return;
        const start = startOpDeTel(ctx, k);
        /*
         * Een periode valt bijna nooit op een hele sample (1/16 op 124 bpm is
         * 5806,45 samples). Afronden liet de gate 4,7 ms per minuut uit de
         * maat lopen. Daarom speelt de buffer met een snelheid die de
         * periode EXACT maakt: n samples in `periode` seconden. Diezelfde
         * snelheid maakt de buffer herbruikbaar bij een kleine tempowijziging
         * (tot 10%); alleen deling, vorm en diepte bouwen hem opnieuw.
         */
        const exact = periode * ctx.sampleRate;
        if (!cyclus || cyclus.vorm !== staat.vorm || cyclus.diepte !== staat.diepte
          || Math.abs(exact / cyclus.n - 1) > 0.1) {
          const n = Math.max(64, Math.round(exact));
          cyclus = { buf: maakBuffer(n), n, vorm: staat.vorm, diepte: staat.diepte };
        }
        const src = ctx.createBufferSource();
        src.buffer = cyclus.buf;
        src.playbackRate.value = cyclus.n / exact;
        src.loop = true;
        src.connect(poort.gain);
        // De gain van de poort wordt volledig door de buffer bepaald — vanaf
        // `start`. Tot dan draait de oude puls, of (eerste keer) staat hij open.
        poort.gain.cancelScheduledValues?.(nu);
        poort.gain.setValueAtTime(oud ? 0 : 1, nu);
        poort.gain.setValueAtTime(0, start);
        try { src.start(start); } catch (_) { src.start(); }
        if (oud) { try { oud.stop(start); } catch (_) {} }
        bron = src;
      };

      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (!(naam in staat)) return;
          const oud = staat[naam];
          staat[naam] = t;
          // Deling, vorm en diepte zitten allemaal in de buffer, dus opnieuw
          // opbouwen. Gebeurt alleen als je eraan draait, niet per frame.
          if (Math.abs(oud - t) > 1e-6) herstart();
        },
        heranker: herstart,
        staart: () => 0,
        vernietig: () => { if (bron) { try { bron.stop(); } catch (_) {} bron = null; } },
      };
    },
  },
  {
    id: 'phaser',
    naam: 'Phaser',
    params: ['snelheid', 'diepte', 'feedback'],
    standaard: { snelheid: 0.35, diepte: 0.6, feedback: 0.3 },
    eenheid: {
      snelheid: (t) => `${expMap(t, 0.03, 6).toFixed(2).replace('.', ',')} Hz`,
      diepte: pct,
      feedback: (t) => pct(t * 0.75),
    },
    bouw(ctx) {
      const ingang = ctx.createGain();
      const uitgang = ctx.createGain();
      const nat = ctx.createGain();
      const fb = ctx.createGain();
      const traps = [];
      for (let i = 0; i < 6; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = 400 * Math.pow(1.8, i);
        ap.Q.value = 0.7;
        traps.push(ap);
      }
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.4;
      const diepte = ctx.createGain(); diepte.gain.value = 800;
      lfo.connect(diepte);
      for (const ap of traps) diepte.connect(ap.frequency);
      try { lfo.start(); } catch (_) {}

      let vorige = ingang;
      for (const ap of traps) { vorige.connect(ap); vorige = ap; }
      vorige.connect(nat).connect(uitgang);
      ingang.connect(uitgang);          // het droge deel hoort erbij: dat maakt de notch
      // Feedback moet een vertraging bevatten, anders mute de browser de lus.
      const vert = ctx.createDelay(0.05);
      vert.delayTime.value = 0.004;
      nat.connect(vert).connect(fb).connect(traps[0]);
      fb.gain.value = 0.3;

      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'snelheid') lfo.frequency.setTargetAtTime(expMap(t, 0.03, 6), now, 0.05);
          else if (naam === 'diepte') diepte.gain.setTargetAtTime(t * 1800, now, 0.05);
          else if (naam === 'feedback') fb.gain.setTargetAtTime(t * 0.75, now, 0.02);
        },
        staart: () => 0.05,
        vernietig: () => { try { lfo.stop(); } catch (_) {} },
      };
    },
  },
  {
    id: 'ringmod',
    naam: 'Ringmod',
    params: ['toon', 'meng'],
    standaard: { toon: 0.3, meng: 0.5 },
    eenheid: { toon: (t) => hz(expMap(t, 20, 3000)), meng: pct },
    bouw(ctx) {
      const ingang = ctx.createGain();
      const uitgang = ctx.createGain();
      const nat = ctx.createGain();
      const droog = ctx.createGain();
      // Een gain met waarde 0 waar een oscillator op staat, IS vermenigvuldigen:
      // verbindingen naar een AudioParam worden bij zijn eigen waarde opgeteld.
      const ring = ctx.createGain();
      ring.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 200;
      osc.connect(ring.gain);
      try { osc.start(); } catch (_) {}

      ingang.connect(ring).connect(nat).connect(uitgang);
      ingang.connect(droog).connect(uitgang);
      nat.gain.value = 0.5; droog.gain.value = 0.5;

      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'toon') osc.frequency.setTargetAtTime(expMap(t, 20, 3000), now, 0.02);
          else if (naam === 'meng') {
            nat.gain.setTargetAtTime(Math.cos((1 - t) * Math.PI / 2), now, 0.01);
            droog.gain.setTargetAtTime(Math.cos(t * Math.PI / 2), now, 0.01);
          }
        },
        staart: () => 0,
        vernietig: () => { try { osc.stop(); } catch (_) {} },
      };
    },
  },
  {
    id: 'reverb',
    naam: 'Reverb',
    params: ['grootte', 'toon', 'meng', 'freeze'],
    standaard: { grootte: 0.55, toon: 0.5, meng: 0.5, freeze: 0 },
    eenheid: {
      grootte: (t) => `${expMap(t, 0.4, 30).toFixed(1).replace('.', ',')} s`,
      toon: (t) => hz(expMap(t, 1200, 16000)),
      meng: pct,
      freeze: (t) => (t >= 0.5 ? 'vast' : 'uit'),
    },
    trappen: { freeze: 2 },
    /*
     * Algoritmische galm: een feedback delay network (FDN).
     *
     * Acht vertragingslijnen die in een lus in elkaar overlopen via een
     * Householder-matrix (y = x - 2/N·Σx). Die matrix is verliesloos: alle
     * energie blijft in de lus, en hoe snel de galm uitsterft bepaalt alleen
     * de gain per lijn. Dat maakt FREEZE één handeling: invoer dicht, gain op
     * (bijna) 1, demping open — en de galm hangt, zo lang als je wilt.
     *
     * Waarom geen ConvolverNode: die klinkt mooi, maar zijn staart is een
     * bestand met een einde. Vasthouden kan dan niet.
     *
     * De lijnen bewegen een fractie van een milliseconde (modulatie). Zonder
     * dat gaat een FDN metalig ringen op aangehouden tonen, en aangehouden
     * tonen zijn precies dit repertoire.
     *
     *   in ─► mono ─► predelay ─► ±in ─┐
     *                                   ▼
     *            ┌── lijn_i ─► demping_i ─► g_i ─┬─► lijn_i (terug)
     *            │                               ├─► Σ·(-2/N) ─► alle lijnen
     *            │                               └─► L of R ─► nat
     *   in ─────────────────────────────────────────────────── droog ─► uit
     */
    bouw(ctx) {
      const N = 8;
      // Onderling ondeelbare lengtes (ms), anders vallen echo's samen en hoor je een toon.
      const LENGTES = [29.7, 37.1, 41.1, 43.7, 53.9, 61.3, 67.9, 73.1];
      const ingang = ctx.createGain();
      const uitgang = ctx.createGain();
      const droog = ctx.createGain();
      const nat = ctx.createGain();
      const mono = ctx.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      mono.channelInterpretation = 'speakers';
      const invoer = ctx.createGain();           // dicht bij freeze
      const voor = ctx.createDelay(0.2);
      voor.delayTime.value = 0.018;
      const som = ctx.createGain();
      som.gain.value = -2 / N;
      const links = ctx.createGain(), rechts = ctx.createGain();
      const stereo = ctx.createChannelMerger(2);

      ingang.connect(droog).connect(uitgang);
      ingang.connect(mono).connect(invoer).connect(voor);
      links.connect(stereo, 0, 0);
      rechts.connect(stereo, 0, 1);
      stereo.connect(nat).connect(uitgang);
      links.gain.value = rechts.gain.value = 0.5;   // vier lijnen per kant

      const lijnen = LENGTES.map((ms, i) => {
        const d = ctx.createDelay(0.2);
        d.delayTime.value = ms / 1000;
        const demping = ctx.createBiquadFilter();
        demping.type = 'lowpass';
        // Q is bij een Web Audio-lowpass een piek in DECIBEL, geen factor.
        // Alles boven ~-3 dB geeft een bultje boven 1 bij de afsnijfrequentie,
        // en in een lus die duizenden keren rondgaat groeit dat bultje tot de
        // galm aanzwelt in plaats van uitsterft. Gemeten, op 23 september 2026.
        demping.Q.value = -6;
        const g = ctx.createGain();
        const injectie = ctx.createGain();
        injectie.gain.value = i % 2 ? -0.35 : 0.35;
        voor.connect(injectie).connect(d);
        d.connect(demping).connect(g);
        g.connect(d);                             // eigen lus (diagonaal van de matrix)
        g.connect(som);                           // en naar de rest via -2/N
        som.connect(d);
        g.connect(i % 2 ? rechts : links);
        return { d, demping, g, s: ms / 1000 };
      });

      // Modulatie: vier trage oscillatoren, elk op twee lijnen in tegenfase.
      const lfos = [];
      for (let k = 0; k < 4; k++) {
        const lfo = ctx.createOscillator();
        lfos.push(lfo);
        lfo.frequency.value = 0.11 + k * 0.07;
        const diep = ctx.createGain(); diep.gain.value = 0.00035;
        const tegen = ctx.createGain(); tegen.gain.value = -0.00035;
        lfo.connect(diep).connect(lijnen[k].d.delayTime);
        lfo.connect(tegen).connect(lijnen[k + 4].d.delayTime);
        try { lfo.start(); } catch (_) {}
      }

      const staat = { rt60: 3, toon: 6000, vast: false };
      const pasToe = (now) => {
        for (const l of lijnen) {
          // RT60: na zoveel seconden is het 60 dB zachter. Per rondgang van
          // lengte s is de gain dan 10^(-3·s/RT60).
          const g = staat.vast ? 0.9998 : Math.pow(10, (-3 * l.s) / staat.rt60);
          l.g.gain.setTargetAtTime(g, now, 0.05);
          l.demping.frequency.setTargetAtTime(staat.vast ? 20000 : staat.toon, now, 0.05);
        }
        invoer.gain.setTargetAtTime(staat.vast ? 0 : 1, now, 0.05);
      };

      return {
        in: ingang, out: uitgang,
        zet(naam, v, now) {
          const t = clamp(v);
          if (naam === 'grootte') staat.rt60 = expMap(t, 0.4, 30);
          else if (naam === 'toon') staat.toon = expMap(t, 1200, 16000);
          else if (naam === 'freeze') staat.vast = t >= 0.5;
          else if (naam === 'meng') {
            nat.gain.setTargetAtTime(Math.cos((1 - t) * Math.PI / 2), now, 0.02);
            droog.gain.setTargetAtTime(Math.cos(t * Math.PI / 2), now, 0.02);
            return;
          } else return;
          pasToe(now);
        },
        // Bevroren houdt hij oneindig vast; de opruiming wacht dan niet eeuwig.
        staart: () => (staat.vast ? 1 : Math.min(30, staat.rt60)),
        vernietig: () => { for (const o of lfos) { try { o.stop(); } catch (_) {} } },
        _staat: () => ({ ...staat, gains: lijnen.map((l) => l.g.gain.value), invoer: invoer.gain.value }),
      };
    },
  },
];

export const effectVan = (id) => EFFECTEN.find((e) => e.id === id) || null;

/** Een parameterwaarde zoals een mens hem leest: "350 ms", "LP 2,1 kHz", "45%". */
/** @param lees  optioneel (param) => waarde van de andere parameters van hetzelfde effect */
export function toonWaarde(type, param, v, lees = null) {
  const f = effectVan(type)?.eenheid?.[param];
  return f ? f(clamp(v), lees) : `${Math.round(clamp(v) * 100)}%`;
}

// ---- ketens ----------------------------------------------------------------

/**
 * Een effectketen uit een rack-beschrijving.
 *
 * Effecten in serie; een slot dat uit staat of dat we niet kennen wordt
 * overgeslagen in de bedrading maar blijft wél in de beschrijving bestaan.
 * Zo sloopt een rack met een onbekend effect niets en klinkt hij alleen anders.
 */
export function bouwKeten(ctx, chain, klok = GEEN_KLOK) {
  const ingang = ctx.createGain();
  const uitgang = ctx.createGain();
  const slots = new Map();
  let vorige = ingang;

  for (const spec of chain || []) {
    const effect = effectVan(spec.type);
    if (!effect || spec.bypass) continue;
    const inst = effect.bouw(ctx, { klok });
    vorige.connect(inst.in);
    vorige = inst.out;
    slots.set(spec.slot, { inst, effect, spec });
    const now = ctx.currentTime;
    for (const naam of effect.params) {
      inst.zet(naam, spec.params?.[naam] ?? effect.standaard?.[naam] ?? 0.5, now);
    }
  }
  vorige.connect(uitgang);

  return {
    in: ingang, out: uitgang, slots,
    zet(target, v, now) {
      const punt = target.indexOf('.');
      if (punt < 0) return false;
      const s = slots.get(target.slice(0, punt));
      if (!s) return false;
      s.inst.zet(target.slice(punt + 1), v, now);
      return true;
    },
    // De langste staart telt: daarop wacht de opruiming.
    staart() {
      let t = 0;
      for (const s of slots.values()) t = Math.max(t, s.inst.staart());
      return t;
    },
    /** Opnieuw op de tel zetten: na seek, hotcue, loop, tempo- of gridwijziging. */
    heranker() {
      for (const s of slots.values()) s.inst.heranker?.();
    },
    /**
     * Echt opruimen. Losmaken is niet genoeg: een oscillator of lopende bron
     * houdt zijn hele eiland aan nodes in leven, en elke rackwissel of
     * ketenwijziging in de editor lekte zo een complete keten.
     */
    vernietig() {
      for (const s of slots.values()) s.inst.vernietig?.();
    },
  };
}

// ---- de slot ---------------------------------------------------------------

export class InsertSlot {
  constructor(ctx) {
    this.ctx = ctx;
    this.in = ctx.createGain();
    this.out = ctx.createGain();
    this.dry = ctx.createGain();
    this.in.connect(this.dry).connect(this.out);

    this.rack = LEEG_RACK();
    this.standen = {};        // plek -> 0..1. SESSIETOESTAND, gaat nergens heen.
    this.glijden = {};        // plek -> { van, naar, t0, duur } zolang het geluid nog onderweg is
    this._glijTimer = null;
    this._toegepast = new Map();   // target -> laatst doorgegeven waarde
    this.keten = null;        // { node, gain }
    this.oud = [];
    this.mix = 0;
    this.bypass = false;
    this.opgeruimd = 0;
    this.fouten = [];
    this.klok = GEEN_KLOK;
    // Waar dit rack vandaan komt, bijvoorbeeld zijn id in de library. De
    // engine kijkt er niet naar; hij bewaart het alleen, en vergeet het zodra
    // er een ANDER rack in komt. Zo weet de buitenwereld of "bewaar" over een
    // bestaand rack heen mag, of dat er intussen iets anders klinkt.
    this.herkomst = null;
  }

  /**
   * De klokvoorziening aanhangen. Het deck weet waar de tel ligt; het effect
   * niet. Zo hoeft geen enkel effect iets van een deck of een grid te weten.
   */
  setKlok(fn) { this.klok = fn || GEEN_KLOK; }

  /** Alle gesynchroniseerde effecten opnieuw op de tel zetten. */
  heranker() { this.keten?.node.heranker(); }

  get effectId() { return this.rack.chain?.[0]?.type ?? null; }
  get rackNaam() { return this.rack.name; }
  get nodeAantal() { return this.oud.length + (this.keten ? 1 : 0); }
  get plekken() { return (this.rack.macros || []).map((m) => m.place).sort((a, b) => a - b); }

  _niveaus() {
    const m = this.bypass ? 0 : clamp(this.mix);
    return { dry: Math.cos(m * Math.PI / 2), wet: Math.cos((1 - m) * Math.PI / 2) };
  }

  _pasNiveausToe() {
    const { dry, wet } = this._niveaus();
    zetDoel(this.dry.gain, dry, this.ctx);
    if (this.keten) zetDoel(this.keten.gain.gain, wet, this.ctx);
  }

  setMix(v) { this.mix = clamp(v); this._pasNiveausToe(); }
  setBypass(aan) { this.bypass = !!aan; this._pasNiveausToe(); }

  /**
   * Een heel rack laden, zonder klik.
   *
   * Nieuwe keten volledig opbouwen terwijl de oude speelt, equal-power
   * kruisfaden, en de oude pas opruimen na fade plus staarttijd.
   */
  zetRack(data, { behoudStanden = false, herkomst } = {}) {
    const { rack, fouten } = leesRack(data, { bekendType: (t) => !!effectVan(t) });
    this.rack = rack;
    // Bewerken (behoudStanden) is hetzelfde rack, dus dezelfde herkomst.
    // Al het andere is een ander rack: dan weten we niet meer waar het vandaan komt.
    this.herkomst = herkomst !== undefined ? herkomst : (behoudStanden ? this.herkomst : null);
    this.fouten = fouten;

    // Standen terug naar de defaults van dit rack. De live stand is
    // sessietoestand en reist niet mee met het rack. In de editor wil je dat
    // juist wél: daar pas je de keten aan terwijl je aan een knop zit.
    const vorigeStanden = this.standen;
    this.standen = {};
    // Nieuwe keten: alles opnieuw doorgeven, en een glijbeweging van het
    // vorige rack hoort daar niet meer bij.
    this.glijden = {};
    this._toegepast.clear();
    for (const m of rack.macros) {
      this.standen[m.place] = behoudStanden && m.place in vorigeStanden
        ? vorigeStanden[m.place] : (m.default ?? 0);
    }

    const nieuw = bouwKeten(this.ctx, rack.chain, () => this.klok());
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.in.connect(nieuw.in);
    nieuw.out.connect(gain).connect(this.out);

    const vorige = this.keten;
    this.keten = { node: nieuw, gain };
    this._pasMacrosToe();

    const { wet } = this._niveaus();
    zetCurve(gain.gain, 0, wet, this.ctx);
    if (vorige) {
      zetCurve(vorige.gain.gain, vorige.gain.gain.value, 0, this.ctx);
      this.oud.push(vorige);
      setTimeout(() => this._ruimOp(vorige), (FADE + vorige.node.staart()) * 1000 + 50);
    }
    return { fouten };
  }

  /** Terug naar het standaardrack (één delay), altijd opnieuw — ook als er al een delay staat. */
  standaard() { this.zetRack(rackVanEffect(effectVan('delay'))); }

  /** Eén effect erin, als rack met één macro per parameter. */
  zetEffect(id, { params = null } = {}) {
    const effect = effectVan(id);
    if (!effect) return false;
    if (this.effectId === id) return true;
    const rack = rackVanEffect(effect);
    if (params) Object.assign(rack.chain[0].params, params);
    this.zetRack(rack);
    return true;
  }

  _ruimOp(keten) {
    const i = this.oud.indexOf(keten);
    if (i < 0) return;
    this.oud.splice(i, 1);
    keten.node.vernietig?.();
    try {
      this.in.disconnect(keten.node.in);
      keten.node.out.disconnect();
      keten.gain.disconnect();
    } catch (_) {}
    this.opgeruimd++;
  }

  /**
   * Alleen de macro's vervangen, de keten laten staan.
   *
   * Voor de editor: schuif je aan een bereik of een curve, dan hoeft er geen
   * enkele node opnieuw gebouwd te worden. Alleen de getallen veranderen, en
   * je hoort het meteen zonder kruisfade.
   */
  bewerkMacros(macros) {
    const { rack, fouten } = leesRack({ ...schrijfRack(this.rack), macros },
      { bekendType: (t) => !!effectVan(t) });
    this.rack.macros = rack.macros;
    this.fouten = fouten;
    for (const m of rack.macros) if (!(m.place in this.standen)) this.standen[m.place] = m.default ?? 0;
    for (const k of Object.keys(this.standen)) {
      if (!rack.macros.some((m) => m.place === Number(k))) { delete this.standen[k]; delete this.glijden[k]; }
    }
    // Koppelingen veranderd: wat we eerder doorgaven zegt niets meer over
    // wat de effecten nu hebben. Alles opnieuw.
    this._toegepast.clear();
    this._pasMacrosToe();
    return { fouten };
  }

  /**
   * Waar het GELUID van plek n nu is. Zonder glijden is dat de knopstand;
   * met glijden ligt het ergens tussen waar hij vandaan kwam en de knop.
   * Afgeleid van de audioklok (regel 3), niet van een teller.
   */
  plekEffectief(n) {
    const g = this.glijden[n];
    if (!g) return this.leesPlek(n);
    const t = (this.ctx.currentTime - g.t0) / g.duur;
    return t >= 1 ? g.naar : g.van + (g.naar - g.van) * Math.max(0, t);
  }

  _effectieveStanden() {
    const uit = {};
    for (const m of this.rack.macros || []) uit[m.place] = this.plekEffectief(m.place);
    return uit;
  }

  /**
   * Alle macro's opnieuw doorrekenen naar parameterwaarden.
   *
   * Alleen wat veranderd is gaat naar de effecten. Tijdens glijden komt dit
   * dertig keer per seconde langs, en een gate die bij elke aanroep zijn
   * buffer opnieuw bouwt of een delay die bij elke aanroep kruisfadet,
   * wil je alleen als er echt iets verschoof.
   */
  _pasMacrosToe() {
    if (!this.keten) return;
    const waarden = resolveMacros(this.rack, this._effectieveStanden());
    const now = this.ctx.currentTime;
    for (const [target, v] of waarden) {
      const vorig = this._toegepast.get(target);
      if (vorig !== undefined && Math.abs(vorig - v) < 0.0005) continue;
      this._toegepast.set(target, v);
      this.keten.node.zet(target, v, now);
    }
  }

  /**
   * Knop op plek n. Dit is waar `track.1.fx.knob.n` op uitkomt.
   *
   * Heeft de knop een glijtijd, dan staat de KNOP meteen op v (soft-takeover
   * moet weten waar je hand is), maar het geluid glijdt er vanaf zijn huidige
   * plek naartoe. `direct` slaat dat over: de editor wil bij DICHT/OPEN
   * meteen horen wat hij instelt.
   */
  setPlek(n, v, { direct = false } = {}) {
    const macro = this.rack.macros?.find((m) => m.place === n);
    if (!macro) return false;
    const naar = clamp(v);
    if (macro.glide > 0 && !direct) {
      this.glijden[n] = { van: this.plekEffectief(n), naar, t0: this.ctx.currentTime, duur: macro.glide };
      this._startGlijden();
    } else {
      delete this.glijden[n];
    }
    this.standen[n] = naar;
    this._pasMacrosToe();
    return true;
  }

  /**
   * De tussenstanden doorgeven zolang er iets glijdt. De timer bepaalt alleen
   * HOE VAAK er doorgegeven wordt; WAAR het geluid is komt van de audioklok.
   * Loopt de audio niet, dan staat die klok stil en glijdt er dus ook niets.
   */
  _startGlijden() {
    if (this._glijTimer) return;
    this._glijTimer = setInterval(() => {
      const nu = this.ctx.currentTime;
      for (const [n, g] of Object.entries(this.glijden)) if (nu - g.t0 >= g.duur) delete this.glijden[n];
      this._pasMacrosToe();
      if (!Object.keys(this.glijden).length) { clearInterval(this._glijTimer); this._glijTimer = null; }
    }, 33);
  }

  /** Glijdt plek n nog? Voor het scherm en straks de LED-ring. */
  glijdt(n) { return !!this.glijden[n]; }

  leesPlek(n) {
    const macro = this.rack.macros?.find((m) => m.place === n);
    if (!macro) return null;
    return this.standen[n] ?? macro.default ?? 0;
  }

  plekNaam(n) { return this.rack.macros?.find((m) => m.place === n)?.label ?? null; }
  plekBipolair(n) { return !!this.rack.macros?.find((m) => m.place === n)?.bipolar; }

  /** Het rack zoals het opgeslagen moet worden — zonder de live standen. */
  naarJSON() { return schrijfRack(this.rack); }

  /**
   * De eigen stand van een parameter zetten, zonder de keten opnieuw te bouwen.
   * Stuurt een knop deze parameter, dan wint de knop en verandert er hoorbaar
   * niets — de stand is dan alleen wat hij doet als je die koppeling weghaalt.
   */
  zetParam(slot, param, v) {
    const node = this.rack.chain?.find((n) => n.slot === slot);
    if (!node) return false;
    node.params = { ...(node.params || {}), [param]: clamp(v) };
    const target = `${slot}.${param}`;
    this._toegepast.delete(target);
    if (this.keten && !resolveMacros(this.rack, this._effectieveStanden()).has(target)) {
      this.keten.node.zet(target, clamp(v), this.ctx.currentTime);
    }
    return true;
  }

  /** Wat de parameter NU doet: de knop die hem stuurt, anders zijn eigen stand. */
  paramWaarde(slot, param) {
    const target = `${slot}.${param}`;
    const gestuurd = resolveMacros(this.rack, this._effectieveStanden());
    if (gestuurd.has(target)) return gestuurd.get(target);
    const node = this.rack.chain?.find((n) => n.slot === slot);
    return node?.params?.[param] ?? effectVan(node?.type)?.standaard?.[param] ?? 0.5;
  }

  /**
   * Welke plekken sturen deze parameter, en welke wint? Twee plekken op één
   * parameter mag; de hoogste wint. Dat moet je kunnen ZIEN, anders lijkt
   * de lagere knop kapot.
   */
  stuurders(slot, param) {
    const target = `${slot}.${param}`;
    const plekken = (this.rack.macros || [])
      .filter((m) => (m.links || []).some((l) => l.target === target))
      .map((m) => m.place).sort((a, b) => a - b);
    return { plekken, wint: plekken.length ? plekken[plekken.length - 1] : null };
  }

  /** Alleen de naam: geen nieuwe keten, geen kruisfade. */
  hernoem(naam) { this.rack.name = String(naam || '').trim() || this.rack.name; }

  /**
   * Alle doelen die een macro kan aansturen, voor de keuzelijst in de editor.
   * Onbekende of uitgeschakelde slots staan er ook in: je mag er alvast naar
   * wijzen, ze doen pas iets als het slot aan staat.
   */
  doelen() {
    const uit = [];
    for (const node of this.rack.chain || []) {
      const effect = effectVan(node.type);
      const params = effect ? effect.params : Object.keys(node.params || {});
      for (const p of params) {
        uit.push({ target: `${node.slot}.${p}`, slot: node.slot, param: p,
          effect: effect?.naam ?? node.type, uit: !!node.bypass });
      }
    }
    return uit;
  }
}
