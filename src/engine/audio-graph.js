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

/** EQ-knop 0..1, midden = 0 dB. Onderste 3% = kill. */
export function setEqBand(param, norm, now) {
  const t = clamp(norm);
  let db;
  if (t <= 0.5) db = EQ_MIN_DB * (1 - t / 0.5);
  else db = EQ_MAX_DB * ((t - 0.5) / 0.5);
  if (t < 0.03) db = -70;
  param.setTargetAtTime(db, now, 0.01);
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
