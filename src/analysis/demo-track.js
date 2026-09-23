/**
 * Synthetische testtrack, zodat je de mixer kunt testen zonder eerst de
 * ingest-pipeline te bouwen. 124 BPM, 32 beats, duidelijk herkenbare kick/bass/hats
 * zodat je hoort wat EQ en filter doen.
 */
export function renderDemoTrack(ctx, { bpm = 124, bars = 8, seed = 0 } = {}) {
  const spb = 60 / bpm;
  const dur = bars * 4 * spb;
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.ceil(dur * sr), sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);

  let s = seed * 9781 + 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const rootHz = seed ? 55 * Math.pow(2, 3 / 12) : 55;

  for (let i = 0; i < buf.length; i++) {
    const t = i / sr;
    const beat = t / spb;
    const inBeat = beat % 1;

    // kick: 4-to-the-floor, pitch-envelope
    const kEnv = Math.exp(-inBeat * 14);
    const kFreq = 45 + 110 * Math.exp(-inBeat * 45);
    const kick = Math.sin(2 * Math.PI * kFreq * inBeat * spb) * kEnv * 0.9;

    // bas: offbeat achtsten
    const eighth = (beat * 2) % 1;
    const bEnv = Math.exp(-eighth * 6) * (Math.floor(beat * 2) % 2 ? 1 : 0.25);
    const bass = (Math.sin(2 * Math.PI * rootHz * t) * 0.6 + Math.sin(4 * Math.PI * rootHz * t) * 0.2) * bEnv * 0.5;

    // hats: offbeat ruis
    const hEnv = Math.exp(-((beat * 2 + 0.5) % 1) * 40);
    const hat = (rnd() * 2 - 1) * hEnv * 0.18;

    // pad: zachte akkoordlaag zodat mids en highs iets te doen hebben
    const pad = (Math.sin(2 * Math.PI * rootHz * 4 * t) + Math.sin(2 * Math.PI * rootHz * 6 * t) * 0.7) * 0.06
              * (0.6 + 0.4 * Math.sin(2 * Math.PI * t / (bars * 4 * spb)));

    const v = kick + bass + hat + pad;
    L[i] = Math.tanh(v * 0.9);
    R[i] = Math.tanh((v - hat * 0.4 + pad * 0.3) * 0.9);
  }
  return buf;
}
