import { clamp, expMap, dbToGain } from '../lib/emitter.js';
import { houdVast, zetHellingen } from './overgang.js';
import { UITGANGEN } from './stream-kern.js';

export const EQ_MIN_DB = -30;   // onder deze waarde snappen we naar 'kill'
export const EQ_MAX_DB = 8;

/**
 * Kanaalstrip van één deck.
 *
 *   source -> trim -> EQ(low,mid,high) -> HPF -> LPF -> fader -> xfade -> master
 *                                                                  `-> analyser (tap)
 *   stream uitgang k -> stemIn[k] -> trim     (k = 0..3, één per stem)
 *
 * De filtersectie is bipolair: één HPF en één LPF in serie. In het midden staan
 * beide buiten het hoorbare bereik, dus effectief bypass. Dat is goedkoper en
 * stabieler dan een filtertype live omschakelen (dat klikt).
 *
 * STEMS (docs/STEMS.md): de streamende bron heeft vier uitgangen, en elk
 * gaat via een eigen versterking (`stemIn`) naar trim. Daar zit het niveau en
 * de kill per stem, VÓÓR de EQ: de EQ, het filter en het effect werken op de
 * som, zoals op elke DJ-mixer met stems. Zonder stems staan ze alle vier op 1
 * en draagt uitgang 0 de hele mix (de andere drie zijn stil): bit voor bit het
 * oude pad. `input` blijft trim, voor de BufferBron. Het filter, de sends en
 * de cue per stem (de stemkanalen) komen er pas bij als ze gebruikt worden:
 * zie maakStemFilter hieronder en deck.js.
 */
export function createDeckChain(ctx) {
  const trim = ctx.createGain();
  const stemIn = [];
  for (let k = 0; k < UITGANGEN; k++) {
    const g = ctx.createGain();
    g.connect(trim);
    stemIn.push(g);
  }

  const eqLow = ctx.createBiquadFilter();
  eqLow.type = 'lowshelf'; eqLow.frequency.value = 200;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = 'peaking'; eqMid.frequency.value = 1000; eqMid.Q.value = 0.9;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = 'highshelf'; eqHigh.frequency.value = 4000;

  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 20; hpf.Q.value = 0.7;

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 22050; lpf.Q.value = 0.7;

  const fader = ctx.createGain();
  const xfade = ctx.createGain();

  // 2048: bins van 23,4 Hz op 48 kHz, zodat 40–200 Hz (de bas) zeven bins
  // krijgt in plaats van drie. Geen smoothing in de node: die werkt per
  // uitleesbeurt, dus op de framerate. Gladmaken doet src/analysis/features.js
  // in seconden (regel 3). piek() leest het tijdsignaal en merkt hier niets van.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;

  trim.connect(eqLow).connect(eqMid).connect(eqHigh)
      .connect(hpf).connect(lpf).connect(fader).connect(xfade);
  xfade.connect(analyser); // tap, loopt nergens heen

  return { input: trim, trim, stemIn, eqLow, eqMid, eqHigh, hpf, lpf, fader, xfade, analyser, output: xfade };
}

/**
 * Het filter van één stemkanaal (docs/STEMS.md §5, 5 okt): een bipolair filter
 * als een CORRECTIE naast de droge weg, die zelf blijft zoals hij is:
 *
 *   stemIn[k] ---------------------------------------------> trim   (x, ongewijzigd)
 *          |-> filterIn (g) -> highpass -> lowpass ---------> trim   (H(g·x))
 *          `-> tegen (−g) ------------------------------------> trim   (−g·x)
 *
 * Samen x + H(g·x) − g·x: met g = 0 precies x (twee stille takken, Chrome
 * rekent de filters dan niet), met g = 1 de gefilterde stem. Van 0 naar 1 in
 * 5 ms (killVersterking) is dezelfde overgang als een kruisfade tussen droog
 * en gefilterd. Wie de stem NA zijn filter wil (sends, cue), verbindt stemIn,
 * lowpass en tegen alle drie (deck.js).
 *
 * Gemaakt pas als het filter van die stem voor het eerst uit het midden gaat:
 * twee takken die STIL beginnen erbij, zoals een nieuwe keten in de
 * insert-slot (fx.js, zetRack). De droge weg wordt niet aangeraakt en er gaat
 * nooit iets los. Een deck zonder stems, of met alle stemfilters in het
 * midden, heeft er geen enkele node van.
 */
export function maakStemFilter(ctx, stemIn, trim) {
  const filterIn = ctx.createGain();
  filterIn.gain.value = 0;
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 20; hpf.Q.value = 0.7;
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 22050; lpf.Q.value = 0.7;
  const tegen = ctx.createGain();
  tegen.gain.value = 0;
  stemIn.connect(filterIn).connect(hpf).connect(lpf).connect(trim);
  stemIn.connect(tegen).connect(trim);
  return { filterIn, hpf, lpf, tegen };
}

/** Zo diep gaat een kill (knop in de onderste 3%, of de kill-schakelaar). */
export const EQ_KILL_DB = -70;
/** Zo lang doet een kill-schakelaar erover, heen en terug. */
export const KILL_FADE = 0.005;

/** EQ-knop 0..1 naar dB: midden = 0 dB, onderste 3% = kill. */
export function eqDb(norm) {
  const t = clamp(norm);
  if (t < 0.03) return EQ_KILL_DB;
  if (t <= 0.5) return EQ_MIN_DB * (1 - t / 0.5);
  return EQ_MAX_DB * ((t - 0.5) / 0.5);
}

/**
 * EQ-knop 0..1, midden = 0 dB. Onderste 3% = kill. Staat de band op kill
 * (schakelaar of drukknop), dan blijft hij weg: de knopstand wordt onthouden
 * (in deck.ui) maar pas weer hoorbaar als de kill eraf gaat.
 *
 * Eerst vasthouden (overgang.js): een lopende kill-overgang wordt daar
 * afgebroken, en het doel begint op die plek. Zonder dat liepen de
 * resterende hellingen van de kill na een knopdraai gewoon door.
 */
export function setEqBand(param, norm, now, kill = false) {
  const db = kill ? EQ_KILL_DB : eqDb(norm);
  try { houdVast(param, now); } catch (_) {}
  try { param.setTargetAtTime(db, now, 0.01); } catch (_) { try { param.value = db; } catch (__) {} }
}

const KILL_N = 33;

/**
 * Kill aan of uit: de band in KILL_FADE naar EQ_KILL_DB, of terug naar de
 * knopstand. In dB, maar zo dat de AMPLITUDE een zachte S volgt: een rechte
 * lijn in dB doet bijna alle amplitude in het eerste (heen) of laatste
 * (terug) stukje, en dat is een tik. Ook als er nog een overgang loopt
 * (snel achter elkaar drukken, of aan de knop draaien): eerst vasthouden,
 * dan vanaf daar.
 *
 * Als losse lineaire hellingen, NIET als setValueCurveAtTime, en pas na
 * `wacht` (de deck geeft startDrempel mee): waarom staat in overgang.js. Een
 * curve gaf in Chrome bij kill aan en binnen 5 ms weer uit, of een knopdraai
 * in die 5 ms, een sprong van 0,45 -> 1,0 in amplitude in één sample; zonder
 * wacht kon een renderthread die voorliep de hele kill tot één stap maken.
 * Tussen de punten interpoleert een helling lineair in dB, precies zoals een
 * curve dat doet: dezelfde vorm.
 */
export function killEqBand(param, norm, kill, now, wacht = 0) {
  const naar = kill ? EQ_KILL_DB : eqDb(norm);
  try {
    zetHellingen(param, (van) => {
      const ga = dbToGain(van), gb = dbToGain(naar), vloer = dbToGain(EQ_KILL_DB);
      return Array.from({ length: KILL_N }, (_, i) => {
        if (i === 0) return van;
        if (i === KILL_N - 1) return naar;
        const s = (1 - Math.cos(Math.PI * i / (KILL_N - 1))) / 2;
        return 20 * Math.log10(Math.max(vloer, ga + (gb - ga) * s));
      });
    }, now, KILL_FADE, wacht);
  } catch (_) {
    // Laatste vangnet: nooit de aanroeper laten struikelen.
    try { param.setTargetAtTime(naar, now, KILL_FADE / 3); } catch (__) { try { param.value = naar; } catch (___) {} }
  }
}

/**
 * Een versterking (een gain in amplitude, zoals stemIn) klikvrij naar
 * `naar`: in KILL_FADE, als een zachte S in amplitude, na `wacht` (de deck
 * geeft startDrempel mee). Dezelfde vorm en dezelfde regels als killEqBand,
 * maar hier IS de parameter al amplitude, dus de punten liggen direct op de
 * S. Lineaire hellingen tussen de punten, NOOIT setValueCurveAtTime (zie
 * overgang.js); een lopende overgang wordt vastgehouden en gaat van daar.
 */
export function killVersterking(param, naar, now, wacht = 0) {
  try {
    zetHellingen(param, (van) => Array.from({ length: KILL_N }, (_, i) => {
      if (i === 0) return van;
      if (i === KILL_N - 1) return naar;
      const s = (1 - Math.cos(Math.PI * i / (KILL_N - 1))) / 2;
      return van + (naar - van) * s;
    }), now, KILL_FADE, wacht);
  } catch (_) {
    // Laatste vangnet: nooit de aanroeper laten struikelen.
    try { param.setTargetAtTime(naar, now, KILL_FADE / 3); } catch (__) { try { param.value = naar; } catch (___) {} }
  }
}

/**
 * Wat de bipolaire filterknop 0..1 op de twee filters zet: [hpf-frequentie,
 * hpf-Q, lpf-frequentie, lpf-Q]. Midden = bypass, links = LPF omlaag,
 * rechts = HPF omhoog. Eén plek voor de draaiknop en voor het glijden
 * (Deck.glide), zodat die twee nooit uit elkaar lopen.
 */
export function filterDoelen(norm) {
  const d = (clamp(norm) - 0.5) * 2; // -1..1
  if (d < 0) return [20, 0.7, expMap(1 + d, 250, 22050), 0.7 - d * 6];
  return [expMap(d, 20, 9000), 0.7 + d * 6, 22050, 0.7];
}

/**
 * Een stemfilter staat "in het midden" binnen deze afstand van 0,5: een
 * knop met MIDI-stappen (1/127) landt nooit precies op 0,5, en dan zou een
 * stem nooit meer langs zijn filter lopen. ±0,004 = 63 en 64 van 127.
 */
export const STEM_MIDDEN = 0.004;
export const stemFilterOpen = (norm) => Math.abs(clamp(norm) - 0.5) <= STEM_MIDDEN;

/**
 * Wat twee bipolaire filterknoppen samen op één paar filters zetten (de stem
 * zelf en, bij vier stems, de groepsknop `inst`): per KANT wint het sterkste
 * filter. Highpass: de hoogste frequentie (met zijn Q); lowpass: de laagste.
 * Staat er één in het midden, dan is het precies de andere (filterDoelen),
 * dus de groepsknop alleen is één filter op drums + bas + overig samen (dezelfde
 * instelling op elk lid, en filters zijn lineair). Tegenover elkaar (de stem
 * lowpass, de groep highpass) wordt het een bandfilter.
 */
export function stemFilterDoelen(eigen, groep = 0.5) {
  const a = filterDoelen(stemFilterOpen(eigen) ? 0.5 : eigen);
  const b = filterDoelen(stemFilterOpen(groep) ? 0.5 : groep);
  const hoog = a[0] >= b[0] ? a : b, laag = a[2] <= b[2] ? a : b;
  return [hoog[0], hoog[1], laag[2], laag[3]];
}

/** Bipolaire filterknop 0..1. Midden = bypass, links = LPF omlaag, rechts = HPF omhoog. */
export function setBipolarFilter(hpf, lpf, norm, now) {
  const [hf, hq, lf, lq] = filterDoelen(norm);
  lpf.frequency.setTargetAtTime(lf, now, 0.01);
  lpf.Q.setTargetAtTime(lq, now, 0.01);
  hpf.frequency.setTargetAtTime(hf, now, 0.01);
  hpf.Q.setTargetAtTime(hq, now, 0.01);
}

/**
 * Master: gain -> insert-rack -> limiter (vooruitblik, true peak) -> analyser -> out.
 * Sinds 5 okt in master.js (docs/MASTER.md); de limiter is geen
 * DynamicsCompressor meer, maar ook geen excuus om je gainstaging te
 * verwaarlozen.
 *
 * `uit` is waar de zaal heen gaat: de uitgang zelf, of met een koptelefoon
 * (koptelefoon.js) kanaal 1/2 van een uitgang met vier kanalen.
 */
export { createMasterChain } from './master.js';

/** Equal-power crossfader. x=0 volledig A, x=1 volledig B. */
export function xfaderGains(x, curve = 'smooth') {
  const t = clamp(x);
  if (curve === 'sharp') {
    return { a: t <= 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 8), b: t >= 0.5 ? 1 : Math.max(0, 1 - (0.5 - t) * 8) };
  }
  return { a: Math.cos(t * Math.PI / 2), b: Math.cos((1 - t) * Math.PI / 2) };
}

export const faderGain = (norm) => dbToGain(norm <= 0.001 ? -70 : (1 - clamp(norm)) * -45);
