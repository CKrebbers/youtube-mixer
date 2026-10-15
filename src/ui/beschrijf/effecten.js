// De uitleg van de actions van spoor S10 ('effecten', docs/EFFECTEN-MEER.md): { kort, lang }
// zoals beschrijf() in apc-beschrijf.js, of null. Puur: geen DOM, geen bus.

import { wie } from '../wie.js';

export default function effecten(action) {
  let m;
  if ((m = /^track\.([^.]+)\.fx\.xy\.(x|y)$/.exec(action))) {
    return { kort: `fx xy ${m[2]}`, lang: `XY-pad van het effect-rack, ${m[2] === 'x' ? 'links–rechts' : 'onder–boven'}: de knop die het rack daarvoor kiest (anders knop ${m[2] === 'x' ? 1 : 2}) — ${wie(m[1])}` };
  }
  if ((m = /^master\.fx\.xy\.(x|y)$/.exec(action))) {
    return { kort: `master xy ${m[1]}`, lang: `XY-pad van het master-rack, ${m[1] === 'x' ? 'links–rechts' : 'onder–boven'}: de knop die het rack daarvoor kiest (anders knop ${m[1] === 'x' ? 1 : 2})` };
  }
  return null;
}
