import { clamp, expMap, dbToGain } from '../lib/emitter.js';

export const EQ_MIN_DB = -30;   // onder deze waarde snappen we naar 'kill'
export const EQ_MAX_DB = 8;

/**
 * Kanaalstrip van één deck.
 *
 *   source -> trim -> EQ(low,mid,high) -> HPF -> LPF -> fader -> xfade -> master
 *                                                                  `-> analyser (tap)
 *
 * De filtersectie is bipolair: één HPF en één LPF in serie. In het midden staan
 * beide buiten het hoorbare bereik, dus effectief bypass. Dat is goedkoper en
 * stabieler dan een filtertype live omschakelen (dat klikt).
 */
export function createDeckChain(ctx) {
  const trim = ctx.createGain();

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

  return { input: trim, trim, eqLow, eqMid, eqHigh, hpf, lpf, fader, xfade, analyser, output: xfade };
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
 * Een parameter vasthouden waar hij NU is: een lopende kill-overgang
 * (hieronder) wordt daar afgebroken, en wat erna komt begint op die plek.
 * Zonder dat liepen de resterende hellingen van de kill na een knopdraai
 * gewoon door, of begon een tweede kill vanaf het verkeerde punt.
 */
function houdVast(param, now) {
  try {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues?.(now);
  } catch (_) {}
}

/**
 * EQ-knop 0..1, midden = 0 dB. Onderste 3% = kill. Staat de band op kill
 * (schakelaar of drukknop), dan blijft hij weg: de knopstand wordt onthouden
 * (in deck.ui) maar pas weer hoorbaar als de kill eraf gaat.
 */
export function setEqBand(param, norm, now, kill = false) {
  const db = kill ? EQ_KILL_DB : eqDb(norm);
  houdVast(param, now);
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
 * Als losse lineaire hellingen, NIET als setValueCurveAtTime: in Chrome
 * (gemeten op 153, offline én realtime) houdt cancelAndHoldAtTime MIDDEN in
 * een lopende curve niet vast, maar speelt het afgekapte stuk opnieuw af
 * vanaf het begin van de curve. Kill aan en binnen 5 ms weer uit, of een
 * knopdraai in die 5 ms, gaf zo een sprong van tientallen dB (0,45 -> 1,0 in
 * amplitude, in één sample). Midden in een lineaire helling houdt Chrome wel
 * netjes vast. Tussen de punten interpoleert een helling lineair in dB,
 * precies zoals een curve dat doet: dezelfde vorm. En een helling kan nooit
 * de NotSupportedError van een overlappende curve geven.
 */
export function killEqBand(param, norm, kill, now) {
  const naar = kill ? EQ_KILL_DB : eqDb(norm);
  try {
    houdVast(param, now);
    const van = param.value;
    const ga = dbToGain(van), gb = dbToGain(naar), vloer = dbToGain(EQ_KILL_DB);
    // Het beginpunt vastleggen: een helling begint anders bij het vorige
    // ingeplande punt, en dat kan lang geleden zijn (dan springt hij).
    param.setValueAtTime(van, now);
    for (let i = 1; i < KILL_N; i++) {
      const s = (1 - Math.cos(Math.PI * i / (KILL_N - 1))) / 2;
      const db = i === KILL_N - 1 ? naar : 20 * Math.log10(Math.max(vloer, ga + (gb - ga) * s));
      param.linearRampToValueAtTime(db, now + KILL_FADE * i / (KILL_N - 1));
    }
  } catch (_) {
    // Laatste vangnet: nooit de aanroeper laten struikelen.
    try { param.setTargetAtTime(naar, now, KILL_FADE / 3); } catch (__) { try { param.value = naar; } catch (___) {} }
  }
}

/** Bipolaire filterknop 0..1. Midden = bypass, links = LPF omlaag, rechts = HPF omhoog. */
export function setBipolarFilter(hpf, lpf, norm, now) {
  const t = clamp(norm);
  const d = (t - 0.5) * 2; // -1..1
  if (d < 0) {
    const depth = -d;
    lpf.frequency.setTargetAtTime(expMap(1 - depth, 250, 22050), now, 0.01);
    lpf.Q.setTargetAtTime(0.7 + depth * 6, now, 0.01);
    hpf.frequency.setTargetAtTime(20, now, 0.01);
    hpf.Q.setTargetAtTime(0.7, now, 0.01);
  } else {
    const depth = d;
    hpf.frequency.setTargetAtTime(expMap(depth, 20, 9000), now, 0.01);
    hpf.Q.setTargetAtTime(0.7 + depth * 6, now, 0.01);
    lpf.frequency.setTargetAtTime(22050, now, 0.01);
    lpf.Q.setTargetAtTime(0.7, now, 0.01);
  }
}

/**
 * Master: gain -> soft limiter -> analyser -> out.
 * Let op: een DynamicsCompressor is geen echte look-ahead limiter. Hij vangt
 * pieken af, maar hij is geen excuus om je gainstaging te verwaarlozen.
 */
export function createMasterChain(ctx) {
  const gain = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;             // zie createDeckChain; de vormlagen lezen deze uit
  analyser.smoothingTimeConstant = 0;

  gain.connect(limiter).connect(analyser).connect(ctx.destination);
  return { input: gain, gain, limiter, analyser };
}

/** Equal-power crossfader. x=0 volledig A, x=1 volledig B. */
export function xfaderGains(x, curve = 'smooth') {
  const t = clamp(x);
  if (curve === 'sharp') {
    return { a: t <= 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 8), b: t >= 0.5 ? 1 : Math.max(0, 1 - (0.5 - t) * 8) };
  }
  return { a: Math.cos(t * Math.PI / 2), b: Math.cos((1 - t) * Math.PI / 2) };
}

export const faderGain = (norm) => dbToGain(norm <= 0.001 ? -70 : (1 - clamp(norm)) * -45);
