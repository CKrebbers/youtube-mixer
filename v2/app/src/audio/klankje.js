/**
 * Een zacht bevestigingsklankje (Hybride: geluid is bevestiging). Een sinus met een korte, zachte
 * omhullende op de master; elke ruimte heeft zijn eigen toon (engine/acties-hybride.js). Twee nodes
 * per klankje, alleen bij een wissel (niet op het audiopad van een worklet). Hellingen met
 * setTargetAtTime (nooit setValueCurveAtTime).
 */
export const NIVEAU = 0.05;
export const DUUR = 0.45;

export function klankje(ctx, uit, hz, { niveau = NIVEAU, duur = DUUR } = {}) {
  if (!ctx || !uit || !(hz > 20)) return;
  const t = ctx.currentTime + 0.01;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = hz;
  g.gain.value = 0;
  g.gain.setTargetAtTime(niveau, t, 0.008);
  g.gain.setTargetAtTime(0, t + 0.06, duur / 5);
  osc.connect(g).connect(uit);
  osc.start(t);
  osc.stop(t + duur + 0.1);
  osc.onended = () => { try { g.disconnect(); } catch (_) { /* al los */ } };
}
