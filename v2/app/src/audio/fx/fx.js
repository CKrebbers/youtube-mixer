import { clamp, expMap } from '../../kern/emitter.js';
import { hz, pct } from './notatie.js';
import { leesRack, schrijfRack, resolveMacros, rackVanEffect, LEEG_RACK, stuurPlekken, isPlekDoel, isModDoel, isNatDoel } from './rack.js';
import { ModBank } from './modulatie.js';
import { startDrempel, houdVast, zetHellingen } from '../overgang.js';
import { MEER_EFFECTEN, inloop } from './fx-meer.js';
import { S10_EFFECTEN } from './fx-s10.js';
import { fxKlokVan, isMaatklok, volgKlok } from './klok.js';

// Herkomst: v1 youtube-mixer/src/engine/fx.js @ e27018f. Anders in v2 (src/audio/fx/):
//   - de klok is de MAATKLOK van de engine (setKlok(klok, { vertraging })), niet een fxKlok per deck;
//     het rekenwerk van de effecten krijgt dezelfde momentopname als in v1 (klok.js), en de slot
//     herankert zelf op het event 'verander' van de klok;
//   - een slot kan LUI zijn: het rack staat er (knoppen, namen, standen) maar de keten wordt pas
//     gebouwd als hij iets moet doen (mix > 0 en aan; een bus: na wek()). Zolang er niets gebouwd
//     is, raakt de slot het signaal niet aan: bit voor bit het pad van plak 1;
//   - de droge weg en de uitgang mogen van buiten komen (de strip: naFilter is de droge weg, de
//     fader de uitgang), zodat er zonder effect geen enkele node extra in het pad staat;
//   - timers houden Node niet in leven (unref) en vernietig() ruimt de slot zelf op.

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
 *   - Wisselen gaat dus via een kruisfade tussen twee COMPLETE ketens. (v1:
 *     equal-power; v2: cos^1,5 / sin^1,5, zie wisselPunten: twee ketens die op
 *     elkaar lijken telden equal-power halverwege op tot +3 dB.)
 *   - Hergebruik geen nodes. "Zelfde delay, andere parameters" lijkt zuinig en
 *     is de bron van de helft van je toekomstige klikken.
 *   - Ruim de oude keten pas op na kruisfade PLUS staarttijd. Eerder afkappen
 *     hoor je harder dan de klik die je probeerde te vermijden.
 *
 * Alle parameters zijn genormaliseerd 0..1. De schaling zit hier, in code.
 */

export const FADE = 0.04;      // 40 ms kruisfade
const TIJD_FADE = 0.08;        // delaytijd wisselen: iets langer, echo's zijn lang
/** Gate zonder maat: zo snel gaat de poort open (na startDrempel, zie overgang.js). */
const GATE_OPEN = 0.005;

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
 * Hoe dicht bij `nu` een start op de audioklok nog op tijd komt; wat
 * daarbinnen valt start te laat, en dan hoor je hem naast de tel. Staat in
 * overgang.js, omdat kruisfades en de kill dezelfde drempel nodig hebben.
 */
export { startDrempel };

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
 * Het moment om op de "1" te starten (een sectie in de sampler): de tel van
 * het anker plus `tellenTotEen` tellen; ligt die "1" binnen de drempel, dan
 * de maat erna. Een klok zonder maat (geen `tellenTotEen`): op de tel, zoals
 * startOpDeTel. Gerekend met de lengte van de volgende tel; ligt er binnen
 * deze maat een stukgrens van de tempokaart, dan herankert de sampler daar
 * toch (Deck._heranker meldt de wissel).
 */
export function startOpDeEen(ctx, k) {
  const per = k?.perMaat, tot = k?.tellenTotEen;
  if (!k || !Number.isFinite(k.ankerCtx) || !(k.beatLengte > 0) || !(per > 0) || !Number.isInteger(tot)) return startOpDeTel(ctx, k);
  const grens = ctx.currentTime + startDrempel(ctx);
  const maat = per * k.beatLengte;
  let t = k.ankerCtx + tot * k.beatLengte;
  if (t < grens) t += Math.ceil((grens - t) / maat) * maat;
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
// zet() hieronder; wijkt een van de twee af, dan liegt het scherm. hz en pct: src/lib/notatie.js.

const filterStand = (t) => {
  const d = t * 2 - 1;
  if (Math.abs(d) < 0.02) return 'open';
  return d < 0 ? `LP ${hz(expMap(1 + d, 200, 22050))}` : `HP ${hz(expMap(d, 20, 9000))}`;
};
const crushStappen = (t) => Math.max(1, Math.round(Math.pow(2, 1 + (1 - t) * 6)));
const OVERGANG_N = 33;

/**
 * Equal-power van `van` naar `naar` in OVERGANG_N punten; het eerste is
 * precies `van`, het laatste precies `naar`.
 */
function fadePunten(van, naar) {
  const p = new Array(OVERGANG_N);
  for (let i = 0; i < OVERGANG_N; i++) {
    const t = i / (OVERGANG_N - 1);
    p[i] = van * Math.cos(t * Math.PI / 2) + naar * Math.cos((1 - t) * Math.PI / 2);
  }
  p[0] = van; p[OVERGANG_N - 1] = naar;
  return p;
}

/**
 * De wet van een RACKWISSEL (v2, gemeten in tools/proef-fx.mjs): cos^1,5 / sin^1,5 in plaats van
 * equal-power. Twee ketens die (bijna) hetzelfde geven (de editor die de keten opnieuw bouwt, een
 * sjabloon dat op het vorige lijkt) telden equal-power halverwege op tot √2 = +3 dB: een sample-stap
 * van 1,27× de gewone (grens 1,25). Met de macht 1,5 is dat hooguit 1,19× (+1,5 dB), en twee ketens
 * die niets met elkaar te maken hebben zakken halverwege hooguit 1,5 dB (equal-power: 0, lineair: 3).
 * Zelfde regel als droog/nat per effect in S10 (lineair, want "equal-power gaf +3 dB halverwege bij
 * een effect dat op zijn ingang lijkt"), maar hier weten we niet vooraf hoe veel de ketens op
 * elkaar lijken. De twee koppen van de delay houden equal-power (v1, gemeten).
 */
export const WISSEL_MACHT = 1.5;
function wisselPunten(van, naar) {
  const p = new Array(OVERGANG_N);
  for (let i = 0; i < OVERGANG_N; i++) {
    const t = i / (OVERGANG_N - 1);
    p[i] = van * Math.pow(Math.cos(t * Math.PI / 2), WISSEL_MACHT) + naar * Math.pow(Math.sin(t * Math.PI / 2), WISSEL_MACHT);
  }
  p[0] = van; p[OVERGANG_N - 1] = naar;
  return p;
}

/**
 * Een doelwaarde zetten op een parameter waar mogelijk nog een overgang
 * loopt: de kruisfade van een effectwissel, of een vorige zetDoel. Dat
 * gebeurt precies wanneer je aan de mix draait vlak nadat je van effect
 * gewisseld bent, oftewel: tijdens het spelen.
 *
 * Eerst vasthouden waar hij nu is, dan vanaf daar naar het doel. Dat gaat
 * netjes omdat hier alleen hellingen en setTargetAtTime lopen, NOOIT een
 * setValueCurveAtTime (zie overgang.js): bovenop een lopende curve gooit
 * setTargetAtTime een NotSupportedError die je hele aanroepketen meeneemt,
 * en een curve afbreken met cancelAndHoldAtTime gaf in Chrome een sprong.
 * Direct op `nu`, zonder drempel: een setTargetAtTime die te laat
 * binnenkomt begint gewoon vanaf waar de parameter dan is (gemeten: 300
 * knopstappen in realtime, geen sprong). Faalt het alsnog, dan zetten we de
 * waarde hard in plaats van de aanroeper te laten struikelen.
 */
export function zetDoel(param, waarde, ctx, tau = 0.01) {
  const nu = ctx.currentTime;
  try { houdVast(param, nu); } catch (_) {}
  try {
    param.setTargetAtTime(waarde, nu, tau);
  } catch (_) {
    try { param.value = waarde; } catch (__) {}
  }
}

/**
 * Een equal-power overgang naar `naar` in `duur`, vanaf waar de parameter
 * nu is, ook als er nog een overgang loopt (twee rackwissels binnen 40 ms,
 * of aan de mix draaien vlak na een wissel). Als beginpunt plus lineaire
 * hellingen en pas na `startDrempel`, NIET als setValueCurveAtTime: waarom
 * staat in overgang.js. Geeft het moment op de audioklok waarop hij klaar is.
 */
function zetOvergang(param, naar, ctx, duur = FADE, punten = fadePunten) {
  const nu = ctx.currentTime, wacht = startDrempel(ctx);
  try {
    zetHellingen(param, (van) => punten(van, naar), nu, duur, wacht);
  } catch (_) {
    // Laatste vangnet: nooit de aanroeper laten struikelen.
    try { param.setTargetAtTime(naar, nu, duur / 3); } catch (__) { try { param.value = naar; } catch (___) {} }
  }
  return nu + wacht + duur;
}

// ---- effecten --------------------------------------------------------------
// Elk effect levert in/uit, een setter per parameter, en zijn staarttijd. Die
// staarttijd is geen sier: hij bepaalt wanneer de oude keten weg mag.

export const EFFECTEN = [
  {
    id: 'delay',
    naam: 'Delay',
    // Zijn uitgang is alleen de echo: droog/nat per effect wordt dan een stuur (S10, zetNat).
    alleenNat: true,
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
      // Een nieuwe keten begint met een LEEG geheugen: zonder inloop begint de eerste
      // echo na een rackwissel abrupt, midden in een golf (gemeten door het spoor
      // effecten: ×46 boven de gewone tweede afgeleide). Zie inloop() in fx-meer.js.
      ingang.connect(inloop(ctx)).connect(som);
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
          timer?.unref?.();
          return;
        }
        // Een stand die nog op een fade wachtte is hiermee achterhaald: zonder dit
        // zette een (in een verborgen tabblad geknepen) timer hem er later alsnog over.
        wachtend = null;
        if (Math.abs(koppen[actief].delayTime.value - sec) < 1e-4) return;
        const nieuw = 1 - actief;
        koppen[nieuw].delayTime.cancelScheduledValues?.(nu);
        koppen[nieuw].delayTime.setValueAtTime(sec, nu);
        zetOvergang(gains[actief].gain, 0, ctx, TIJD_FADE);
        // De fade begint pas na startDrempel: klaar is hij dus ook later.
        klaarOm = zetOvergang(gains[nieuw].gain, 1, ctx, TIJD_FADE) + 0.005;
        actief = nieuw;
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
      let bronGain = null;      // eigen gain per puls: zo kan een puls uitvloeien (zonder maat)
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
        const oud = bron, oudGain = bronGain;
        bron = null;
        bronGain = null;
        if (!k || !k.beatLengte) {
          /*
           * Geen maat: poort open, in GATE_OPEN (5 ms). Als de kill
           * (overgang.js): vasthouden, en de helling pas na startDrempel. Op
           * `nu` viel hij samen tot één stap, want de renderthread loopt tot
           * ~7,5 ms voor (VERBETERINGEN ronde 4). De puls telt bij de poort
           * op (intrinsiek 0 + puls), dus tegelijk vloeit zijn eigen gain
           * naar 0: samen gaat het zacht van de puls naar open. Pas als dat
           * klaar is stopt de oude bron; eerder stoppen, terwijl hij nog
           * meetelt, is een sprong in de gain.
           */
          const wacht = startDrempel(ctx);
          try {
            zetHellingen(poort.gain, (van) => [van, 1], nu, GATE_OPEN, wacht);
            if (oudGain) zetHellingen(oudGain.gain, (van) => [van, 0], nu, GATE_OPEN, wacht);
          } catch (_) {
            // Laatste vangnet: nooit de aanroeper laten struikelen.
            try { poort.gain.setTargetAtTime(1, nu, GATE_OPEN / 3); } catch (__) {}
          }
          if (oud) { try { oud.stop(nu + wacht + GATE_OPEN + 0.001); } catch (_) {} }
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
        const g = ctx.createGain();
        src.connect(g).connect(poort.gain);
        src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (_) {} };
        // De gain van de poort wordt volledig door de buffer bepaald — vanaf
        // `start`. Tot dan draait de oude puls, of (eerste keer) staat hij open.
        poort.gain.cancelScheduledValues?.(nu);
        poort.gain.setValueAtTime(oud ? 0 : 1, nu);
        poort.gain.setValueAtTime(0, start);
        try { src.start(start); } catch (_) { src.start(); }
        if (oud) { try { oud.stop(start); } catch (_) {} }
        bron = src;
        bronGain = g;
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
        vernietig: () => { if (bron) { try { bron.stop(); } catch (_) {} bron = null; bronGain = null; } },
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
  // Distortion, chorus, flanger, vibrato, tremolo, autopan, auto-wah, pitch,
  // compressor en breedte: uit Clay's filter app (fx-meer.js, docs/EFFECTEN.md).
  ...MEER_EFFECTEN,
  // Kam, klinker, frequentieschuif, band, kanteling, aanslag en duiker (spoor S10,
  // fx-s10.js, docs/EFFECTEN-MEER.md).
  ...S10_EFFECTEN,
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
export function bouwKeten(ctx, chain, klok = GEEN_KLOK, { natSlots = null } = {}) {
  const ingang = ctx.createGain();
  const uitgang = ctx.createGain();
  const slots = new Map();
  let vorige = ingang;

  for (const spec of chain || []) {
    const effect = effectVan(spec.type);
    if (!effect || spec.bypass) continue;
    const inst = effect.bouw(ctx, { klok });
    // Droog/nat per effect (S10): alleen als het rack erom vraagt (`meng`, of een
    // knop of modulator op `<slot>._nat`). Anders de oude bedrading, bit voor bit.
    let nat = null;
    if (spec.meng !== undefined || natSlots?.has(spec.slot)) {
      const som = ctx.createGain(), droog = ctx.createGain(), natG = ctx.createGain();
      vorige.connect(droog).connect(som);
      let stuur = null;
      if (effect.alleenNat) { stuur = ctx.createGain(); vorige.connect(stuur).connect(inst.in); }
      else vorige.connect(inst.in);
      inst.out.connect(natG).connect(som);
      nat = { droog, nat: natG, stuur, stand: null };
      zetNat(nat, spec.meng ?? 1, ctx, true);
      vorige = som;
    } else {
      vorige.connect(inst.in);
      vorige = inst.out;
    }
    slots.set(spec.slot, { inst, effect, spec, nat });
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
      const param = target.slice(punt + 1);
      if (param === '_nat') { if (s.nat) zetNat(s.nat, v, ctx, false); return !!s.nat; }
      s.inst.zet(param, v, now);
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

/**
 * Droog/nat van één effect (S10), equal-power: droog = cos, nat = sin. Bij het
 * bouwen direct (er klinkt nog niets), daarna glijdend (zetDoel).
 */
function zetNat(n, v, ctx, direct) {
  const m = clamp(v);
  if (n.stand !== null && Math.abs(n.stand - m) < 1e-6) return;
  n.stand = m;
  // Een effect dat alleen nat geluid geeft (de delay: `alleenNat`) krijgt een STUUR: hoeveel er
  // de echo in gaat, het droge blijft vol en wat er al in de echo zit rolt door (een dub-worp).
  // De andere: LINEAIR, geen equal-power. Hun uitgang lijkt op de ingang (filter, kanteling, crush):
  // equal-power gaf daar halverwege tot +4 dB (gemeten in review S10); lineair is daar vlak, en
  // hooguit −3 dB halverwege bij een effect dat er niet op lijkt.
  const d = n.stuur ? 1 : 1 - m, w = m;
  const doel = n.stuur ?? n.nat;
  if (direct) { n.droog.gain.value = d; doel.gain.value = w; }
  else { zetDoel(n.droog.gain, d, ctx); zetDoel(doel.gain, w, ctx); }
}

/** Welke slots een droog/nat-pad nodig hebben: `meng` in de keten, of een doel `<slot>._nat`. */
function natSlotsVan(rack) {
  const uit = new Set();
  for (const n of rack.chain || []) if (n.meng !== undefined) uit.add(n.slot);
  const doel = (t) => { if (isNatDoel(t)) uit.add(t.slice(0, t.indexOf('.'))); };
  for (const m of rack.macros || []) for (const l of m.links || []) doel(l.target);
  // Een onbekende modulator (ongeschonden uit een nieuwere versie) kan doelen in een andere vorm hebben.
  for (const m of rack.mods || []) if (Array.isArray(m?.doelen)) for (const d of m.doelen) if (typeof d?.target === 'string') doel(d.target);
  return uit;
}

/** Hoe vaak modulators doorgerekend worden (ms): dezelfde tik als glijden; 8 ms voor snelle op de maat. */
export const MOD_TIK = 33, MOD_TIK_FIJN = 8;

// ---- de slot ---------------------------------------------------------------

export class InsertSlot {
  /**
   * @param opties.droog     een bestaande GainNode als droge weg (zijn gain = het droge deel); dan ook `uit`
   * @param opties.uit       waar droog en nat samenkomen (met `droog`)
   * @param opties.lui       false (v1: meteen bouwen), 'mix' (pas bij mix > 0 en aan) of 'wek' (pas na wek())
   * @param opties.bijIngang (in) => void: één keer, vlak vóór de eerste keten: verbind het signaal met `in`
   * @param opties.bijKeten  (gain) => void: bij elke nieuwe keten, met zijn uitgang (bv. naar een meter)
   */
  constructor(ctx, { droog = null, uit = null, lui = false, bijIngang = null, bijKeten = null } = {}) {
    this.ctx = ctx;
    this.in = ctx.createGain();
    if (droog) {
      if (!uit) throw new TypeError('InsertSlot: een eigen droge weg vraagt ook een uitgang');
      this.dry = droog;
      this.out = uit;
      this._eigenPad = false;
    } else {
      this.out = ctx.createGain();
      this.dry = ctx.createGain();
      this.in.connect(this.dry).connect(this.out);
      this._eigenPad = true;
    }
    this.lui = lui === 'mix' || lui === 'wek' ? lui : false;
    this._gewekt = false;
    this._bijIngang = bijIngang;
    this._bijKeten = bijKeten;
    this._ingangKlaar = !bijIngang;
    this._klokAf = null;
    this._timers = new Set();
    this.weg = false;

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
    // Modulators (S10): alleen als het rack ze heeft. De meter (voor de volger) pas als een volger hem nodig heeft.
    this._mods = null;
    this._modTimer = null;
    this._meter = null;
    this._meterBuf = null;
    this._modUit = null;       // de laatste offsets, voor paramWaarde
    this._droogDoel = 1;       // de droge weg begint open (gain 1) en wordt pas aangeraakt als dat anders moet
  }

  /**
   * De klok aanhangen: de maatklok van de engine (src/kern/klok.js; zie klok.js hier: de
   * effecten krijgen er de momentopname van v1 uit), of een functie die zelf een momentopname
   * geeft (v1, de tests). `vertraging()`: zoveel loopt het signaal in deze slot achter op de klok
   * (in een strip en op een bus 0). Geen effect weet iets van een track of een grid.
   */
  setKlok(klok, { vertraging = () => 0 } = {}) {
    this._klokAf?.();
    this._klokAf = null;
    this.klok = klok ? fxKlokVan(klok, this.ctx, { vertraging }) : GEEN_KLOK;
    // De maatklok meldt zelf als hij verandert: dan opnieuw op de tel (geen herankeren per deck meer).
    if (isMaatklok(klok)) this._klokAf = volgKlok(klok, this.ctx, () => this.heranker(), { vertraging });
  }

  /** Een timer die Node niet in leven houdt en die vernietig() opruimt. */
  _later(fn, ms) {
    const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
    t?.unref?.();
    this._timers.add(t);
    return t;
  }

  /** Alle gesynchroniseerde effecten opnieuw op de tel zetten. */
  heranker() { this.keten?.node.heranker(); }

  get effectId() { return this.rack.chain?.[0]?.type ?? null; }
  get rackNaam() { return this.rack.name; }
  get nodeAantal() { return this.oud.length + (this.keten ? 1 : 0); }
  get plekken() { return (this.rack.macros || []).map((m) => m.place).sort((a, b) => a - b); }

  /** Staat er een effect in dat iets doet (een bekend type dat aan staat)? Zonder: helemaal droog. */
  get heeftEffect() { return (this.rack.chain || []).some((n) => !n.bypass && !n.onbekend && effectVan(n.type)); }

  /** Mag de keten er nu zijn (lui: pas als hij iets moet doen)? */
  _magBouwen() {
    if (this.weg || !this.heeftEffect) return false;
    if (!this.lui) return true;
    if (this.bypass) return false;
    return this.lui === 'wek' ? this._gewekt : this.mix > 0;
  }

  /** Een luie bus (lui: 'wek') wakker maken: de keten wordt gebouwd. */
  wek() { if (this._gewekt) return; this._gewekt = true; this._bouwAlsNodig(); }
  get gewekt() { return this._gewekt; }

  _bouwAlsNodig() { if (!this.keten && this._magBouwen()) this._bouwKeten(); }

  _niveaus() {
    const m = this.bypass || !this.heeftEffect ? 0 : clamp(this.mix);
    // Op de uiteinden precies 0 en 1: cos(π/2) is 6e-17, en dan lekte een "dichte" kant toch mee.
    if (m === 0) return { dry: 1, wet: 0 };
    if (m === 1) return { dry: 0, wet: 1 };
    return { dry: Math.cos(m * Math.PI / 2), wet: Math.cos((1 - m) * Math.PI / 2) };
  }

  _pasNiveausToe() {
    const { wet } = this._niveaus();
    this._zetDroog();
    if (this.keten) zetDoel(this.keten.gain.gain, wet, this.ctx);
  }

  setMix(v) { if (this.weg) return; this.mix = clamp(v); this._pasNiveausToe(); this._bouwAlsNodig(); }
  setBypass(aan) { if (this.weg) return; this.bypass = !!aan; this._pasNiveausToe(); this._bouwAlsNodig(); }

  /**
   * Een heel rack laden, zonder klik.
   *
   * Nieuwe keten volledig opbouwen terwijl de oude speelt, kruisfaden
   * (wisselPunten), en de oude pas opruimen na fade plus staarttijd. Lui: het
   * rack staat er meteen (knoppen, standen), de keten pas als hij iets doet.
   */
  zetRack(data, { behoudStanden = false, herkomst } = {}) {
    if (!behoudStanden) this._modsOud = null;
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

    this._zetMods(rack, { behoud: behoudStanden });
    // Droog: zonder effect helemaal (ook als de mix open staat), anders volgens de mix.
    this._zetDroog();
    if (this._magBouwen()) this._bouwKeten();
    else this._pensioen();
    return { fouten };
  }

  /**
   * De keten van het rack van nu bouwen en erin laten vloeien; een vorige keten vloeit eruit en
   * wordt na fade plus staart opgeruimd (v1 zetRack). Lui: pas als hij iets moet doen.
   */
  _bouwKeten() {
    if (!this._ingangKlaar) { this._ingangKlaar = true; this._bijIngang?.(this.in); }
    const rack = this.rack;
    const nieuw = bouwKeten(this.ctx, rack.chain, () => this.klok(), { natSlots: natSlotsVan(rack) });
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.in.connect(nieuw.in);
    nieuw.out.connect(gain).connect(this.out);
    this._bijKeten?.(gain);

    const vorige = this.keten;
    this.keten = { node: nieuw, gain };
    this._toegepast.clear();
    this._pasMacrosToe();

    const { wet } = this._niveaus();
    zetOvergang(gain.gain, wet, this.ctx, FADE, wisselPunten);
    if (vorige) this._laatGaan(vorige);
  }

  /** Geen keten meer (een leeg rack, of lui en niets te doen): de huidige vloeit eruit. */
  _pensioen() {
    const vorige = this.keten;
    this.keten = null;
    if (vorige) this._laatGaan(vorige);
  }

  _laatGaan(vorige) {
    // Opruimen na fade plus staart, en de fade begint pas na startDrempel.
    const klaar = zetOvergang(vorige.gain.gain, 0, this.ctx, FADE, wisselPunten) - this.ctx.currentTime;
    this.oud.push(vorige);
    this._later(() => this._ruimOp(vorige), (klaar + vorige.node.staart()) * 1000 + 50);
  }

  /** Het droge deel: alleen een nieuwe stand als hij anders is (zonder effect blijft de droge weg onaangeroerd). */
  _zetDroog() {
    const { dry } = this._niveaus();
    if (this._droogDoel === dry) return;
    this._droogDoel = dry;
    zetDoel(this.dry.gain, dry, this.ctx);
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

  /**
   * De modulators van dit rack aan (of uit). Een timer van MOD_TIK ms zolang er
   * iets te moduleren is; de waarde komt van de audioklok (regel 3).
   */
  _zetMods(rack, { behoud = false, kaart = null } = {}) {
    // Bewerken (editor, zetRack met behoudStanden) houdt de stand van elke modulator die dezelfde
    // soort bleef: anders sprong een vrije LFO bij elke schuifbeweging terug naar zijn begin.
    const bank = rack.mods?.length ? new ModBank(rack.mods, behoud ? this._modsOud ?? this._mods : null, kaart) : null;
    this._modsOud = bank;
    this._mods = bank?.actief ? bank : null;
    this._modUit = null;
    if (this._mods?.volgt && !this._meter) {
      this._meter = this.ctx.createAnalyser();
      this._meter.fftSize = 1024;
      this._meterBuf = new Float32Array(this._meter.fftSize);
      this.in.connect(this._meter);
    }
    // Snelle modulators op de maat (een periode of stap korter dan 250 ms): een fijnere tik, anders
    // vouwt een 1/32-LFO (17 Hz op 128 bpm) op 30 Hz bemonstering en vallen stappen tot 33 ms te laat.
    const tik = this._mods?.snel ? MOD_TIK_FIJN : MOD_TIK;
    if (this._modTimer && (!this._mods || this._modTikMs !== tik)) { clearInterval(this._modTimer); this._modTimer = null; }
    if (this._mods && !this._modTimer) {
      this._modTikMs = tik;
      this._modTimer = setInterval(() => this._modTik(), tik);
      this._modTimer?.unref?.();
    }
  }

  /** De rms van wat er IN het rack gaat (voor de volger), op de hoofdthread, zonder afval. */
  _niveau() {
    if (!this._meter) return 0;
    this._meter.getFloatTimeDomainData(this._meterBuf);
    let s = 0;
    for (let i = 0; i < this._meterBuf.length; i++) s += this._meterBuf[i] * this._meterBuf[i];
    return Math.sqrt(s / this._meterBuf.length);
  }

  _modTik() {
    if (!this._mods || !this.keten) return;
    // Staat de klok stil, dan staat de modulatie stil: niets te doen.
    const t = this.ctx.currentTime;
    if (t === this._modT) return;
    this._modT = t;
    this._pasMacrosToe();
  }

  /** Modulators per stuk: { soort, waarde } (voor de editor). */
  modStanden() {
    if (!this._mods || !this._modUit) return [];
    return this._mods.mods.map((m, i) => ({ soort: m?.soort ?? null, waarde: this._modUit.ruw[i] ?? 0 }));
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
   * De slot weg (de strip of de mixer gaat weg): timers en de klok los, elke keten vernietig()
   * (oscillatoren, bronnen, worklets stoppen) en los. De droge weg en de uitgang van buiten zijn
   * van de eigenaar en blijven staan. Daarna doet de slot niets meer.
   */
  vernietig() {
    if (this.weg) return;
    this.weg = true;
    this._klokAf?.();
    this._klokAf = null;
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    clearInterval(this._modTimer); this._modTimer = null;
    clearInterval(this._glijTimer); this._glijTimer = null;
    for (const k of [...this.oud, ...(this.keten ? [this.keten] : [])]) {
      try { k.node.vernietig?.(); } catch (_) {}
      try { k.node.out.disconnect(); } catch (_) {}
      try { k.gain.disconnect(); } catch (_) {}
      try { this.in.disconnect(k.node.in); } catch (_) {}
    }
    this.oud = [];
    this.keten = null;
    try { this._meter?.disconnect(); } catch (_) {}
    try { this.in.disconnect(); } catch (_) {}
    if (this._eigenPad) { try { this.dry.disconnect(); } catch (_) {} try { this.out.disconnect(); } catch (_) {} }
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
    // wat de effecten nu hebben. Alles opnieuw, en wat niet meer gestuurd wordt
    // terug naar zijn eigen stand (anders bleef het op de laatste gestuurde waarde).
    const vorige = [...this._toegepast.keys()];
    this._toegepast.clear();
    this._pasMacrosToe();
    this._herstelLos(vorige);
    return { fouten };
  }

  /**
   * Doelen die net nog gestuurd werden (door een knop of modulator) en nu niet meer: hun eigen
   * stand terug naar het effect. Zonder dit bleef een parameter na het weghalen van een
   * modulator op zijn laatste gemoduleerde waarde staan, terwijl het scherm de eigen stand toonde
   * (review S10). Bestond vóór S10 al bij het weghalen van een koppeling.
   */
  _herstelLos(vorige) {
    if (!this.keten) return;
    const nu = this._waardenNu();
    for (const t of vorige) {
      if (nu.has(t)) continue;
      const v = this._eigenStand(t);
      if (v !== null) this.keten.node.zet(t, this._opTrap(t, clamp(v)), this.ctx.currentTime);
    }
  }

  /**
   * Alleen de modulators vervangen (S10), de keten laten staan. Vraagt een
   * nieuwe modulator een droog/nat-pad dat er nog niet is (`<slot>._nat`), dan
   * moet de keten opnieuw: dat zegt de terugwaarde (`opnieuw`), de editor doet
   * dan zetRack met behoudStanden.
   */
  bewerkMods(mods, { kaart = null } = {}) {
    const { rack, fouten } = leesRack({ ...schrijfRack(this.rack), mods },
      { bekendType: (t) => !!effectVan(t) });
    this.rack.mods = rack.mods;
    const nodig = natSlotsVan(this.rack);
    const er = new Set([...(this.keten?.node.slots || new Map())].filter(([, s]) => s.nat).map(([k]) => k));
    const opnieuw = [...nodig].some((k) => !er.has(k) && this.keten?.node.slots?.has(k));
    this._zetMods(this.rack, { behoud: true, kaart });
    const vorige = [...this._toegepast.keys()];
    this._toegepast.clear();
    this._pasMacrosToe();
    this._herstelLos(vorige);
    return { fouten, opnieuw };
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
   * Alle parameterwaarden van nu: knopstanden (met glijden), modulators als
   * offset op knoppen en parameters (S10), knoppen die knoppen sturen (S10),
   * en dan de koppelingen. Geeft een Map target → 0..1 van alles wat gestuurd wordt.
   */
  _waardenNu() {
    const eigen = this._effectieveStanden();
    if (!this._mods && !this._heeftPlekLinks()) return resolveMacros(this.rack, eigen);
    const { diepte } = stuurPlekken(this.rack, eigen);
    let mod = null;
    if (this._mods) {
      mod = this._mods.bereken(this.ctx.currentTime, this.klok(), () => this._niveau(), diepte);
      this._modUit = mod;
      for (const [k, off] of mod.plek) if (k in eigen) eigen[k] = clamp(eigen[k] + off);
    }
    const { standen } = stuurPlekken(this.rack, eigen);
    const waarden = resolveMacros(this.rack, standen);
    if (mod) {
      for (const [target, off] of mod.keten) {
        const basis = waarden.has(target) ? waarden.get(target) : this._eigenStand(target);
        if (basis !== null) waarden.set(target, clamp(basis + off));
      }
    }
    return waarden;
  }

  _heeftPlekLinks() {
    for (const m of this.rack.macros || []) for (const l of m.links || []) if (isPlekDoel(l.target) || isModDoel(l.target)) return true;
    return false;
  }

  /** De eigen stand van een doel in de keten (geen knop erop): wat het rack zegt, anders de standaard. */
  _eigenStand(target) {
    const punt = target.indexOf('.');
    const node = this.rack.chain?.find((n) => n.slot === target.slice(0, punt));
    if (!node) return null;
    const param = target.slice(punt + 1);
    if (param === '_nat') return node.meng ?? 1;
    return node.params?.[param] ?? effectVan(node.type)?.standaard?.[param] ?? 0.5;
  }

  /**
   * Alle macro's opnieuw doorrekenen naar parameterwaarden.
   *
   * Alleen wat veranderd is gaat naar de effecten. Tijdens glijden komt dit
   * dertig keer per seconde langs, en een gate die bij elke aanroep zijn
   * buffer opnieuw bouwt of een delay die bij elke aanroep kruisfadet,
   * wil je alleen als er echt iets verschoof. Een parameter met trappen
   * (soort, sync, deling) telt pas als hij een trap verder is: een modulator
   * die eroverheen schuift wisselt dan alleen op de trap.
   */
  _pasMacrosToe() {
    if (!this.keten) return;
    const waarden = this._waardenNu();
    const now = this.ctx.currentTime;
    for (const [target, ruw] of waarden) {
      const v = this._opTrap(target, ruw);
      const vorig = this._toegepast.get(target);
      if (vorig !== undefined && Math.abs(vorig - v) < 0.0005) continue;
      this._toegepast.set(target, v);
      this.keten.node.zet(target, v, now);
    }
  }

  _opTrap(target, v) {
    const punt = target.indexOf('.');
    const s = this.keten?.node.slots?.get(target.slice(0, punt));
    const n = s?.effect.trappen?.[target.slice(punt + 1)];
    return n > 1 ? Math.round(v * (n - 1)) / (n - 1) : v;
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
    this._glijTimer?.unref?.();
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
    if (param === '_nat') {
      // Droog/nat van één effect (S10): staat in `meng` van de keten. Is er nog geen droog/nat-pad,
      // dan geeft dit false en moet de keten opnieuw (natOntbreekt, de editor doet zetRack).
      node.meng = clamp(v);
      this._toegepast.delete(`${slot}._nat`);
      if (this.keten && !this._waardenNu().has(`${slot}._nat`)) return this.keten.node.zet(`${slot}._nat`, node.meng, this.ctx.currentTime);
      return !this.natOntbreekt();
    }
    node.params = { ...(node.params || {}), [param]: clamp(v) };
    const target = `${slot}.${param}`;
    this._toegepast.delete(target);
    if (this.keten && !this._waardenNu().has(target)) {
      this.keten.node.zet(target, clamp(v), this.ctx.currentTime);
    }
    return true;
  }

  /** Wat de parameter NU doet: de knop die hem stuurt, anders zijn eigen stand. */
  paramWaarde(slot, param) {
    const target = `${slot}.${param}`;
    // Met modulators: wat er het laatst naar het effect ging (de modulatie zit erin).
    if (this._mods && this._toegepast.has(target)) return this._toegepast.get(target);
    const gestuurd = this._mods ? null : this._waardenNu();
    if (gestuurd?.has(target)) return gestuurd.get(target);
    if (this._mods) { const w = this._waardenNu(); if (w.has(target)) return w.get(target); }
    const node = this.rack.chain?.find((n) => n.slot === slot);
    if (param === '_nat') return node?.meng ?? 1;
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

  /**
   * Vraagt het rack een droog/nat-pad (S10: `meng`, of een knop of modulator op `<slot>._nat`) dat
   * de keten van nu niet heeft? Dan moet de keten opnieuw gebouwd worden (zetRack met behoudStanden).
   */
  natOntbreekt() {
    if (!this.keten) return false;
    for (const k of natSlotsVan(this.rack)) {
      const s = this.keten.node.slots.get(k);
      if (s && !s.nat) return true;
    }
    return false;
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
      // Hoeveel van dit effect je hoort (droog/nat per effect, S10).
      if (effect) uit.push({ target: `${node.slot}._nat`, slot: node.slot, param: '_nat', effect: effect.naam, uit: !!node.bypass, soort: 'nat' });
    }
    return uit;
  }

  /** Doelen buiten de keten (S10): andere knoppen en de diepte van een modulator. */
  andereDoelen(vanPlek = null) {
    const uit = [];
    for (const m of this.rack.macros || []) if (m.place !== vanPlek) uit.push({ target: `plek.${m.place}`, soort: 'plek', naam: `knop ${m.place} (${m.label})` });
    (this.rack.mods || []).forEach((m, i) => uit.push({ target: `mod.${i + 1}.diepte`, soort: 'mod', naam: `diepte van modulator ${i + 1} (${m?.soort ?? '?'})` }));
    return uit;
  }
}
