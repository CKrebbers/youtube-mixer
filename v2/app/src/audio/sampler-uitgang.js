/**
 * De uitgang van de sampler: per pad een ingang, samen door één volume naar de master (vóór de
 * limiter, zoals v1). Het volume glijdt (zetDoel), nooit een sprong.
 */
import { zetDoel, faderGain } from './strip.js';

export function maakSamplerUitgang(ctx, mixer) {
  const volume = new GainNode(ctx, { gain: faderGain(0.8) });
  volume.connect(mixer.in);
  const pads = [];
  let stand = 0.8;
  return {
    pad(k) { if (!pads[k]) { pads[k] = new GainNode(ctx, { gain: 1 }); pads[k].connect(volume); } return pads[k]; },
    zet(v) { stand = Math.min(1, Math.max(0, v)); zetDoel(volume.gain, faderGain(stand), ctx.currentTime, 0.02); },
    lees() { return stand; },
  };
}
