// De uitleg van de actions van spoor S4 ('combi', docs/werkruimte/S4.md): { kort, lang }
// zoals beschrijf() in apc-beschrijf.js, of null (dan beschrijft apc-beschrijf.js hem zelf).
// Puur: geen DOM, geen bus (apc.html en maschine.html laden dit statisch).

import { wie } from '../wie.js';

// Zelfde namen als STEM_LABELS in actions.js (hier los, zodat apc.html de bus niet hoeft te laden).
const STEM = { vocals: 'zang', inst: 'rest', drums: 'drums', bass: 'bas', other: 'overig' };

export default function combi(action) {
  let m;
  if ((m = /^track\.([^.]+)\.send\.(a|b)\.hold$/.exec(action))) {
    const echo = m[2] === 'a';
    return { kort: echo ? 'echo-worp' : 'galm-worp',
      lang: `${echo ? 'echo' : 'galm'} vol open zolang je drukt (een worp); loslaten = terug naar de stand van ervoor — ${wie(m[1])}` };
  }
  // Bestaande actions zonder uitleg die de stukken van S4 gebruiken (fx-matrix, mix-extra).
  if ((m = /^track\.([^.]+)\.fx\.knob\.(\d)\.hold$/.exec(action))) {
    return { kort: `worp fx ${m[2]}`, lang: `plek ${m[2]} van het effect-rack vol open zolang je drukt (een worp); loslaten = terug — ${wie(m[1])}` };
  }
  if ((m = /^track\.([^.]+)\.xfade\.(a|b|thru)$/.exec(action))) {
    return m[2] === 'thru'
      ? { kort: 'thru', lang: `crossfader: thru (los van de crossfader, altijd hoorbaar) — ${wie(m[1])}` }
      : { kort: `kant ${m[2].toUpperCase()}`, lang: `crossfader: kant ${m[2].toUpperCase()} — ${wie(m[1])}` };
  }
  if ((m = /^track\.([^.]+)\.fx\.mix\.hold$/.exec(action))) {
    return { kort: 'fx nat', lang: `het effect helemaal nat zolang je drukt; loslaten = de mix van ervoor — ${wie(m[1])}` };
  }
  if ((m = /^track\.([^.]+)\.stem\.(\w+)\.solo$/.exec(action))) {
    const s = STEM[m[2]] ?? m[2];
    return { kort: `solo ${s}`, lang: `alleen ${s} zolang je drukt: de andere stems weg, loslaten = terug — ${wie(m[1])}` };
  }
  if ((m = /^super\.(\d+)$/.exec(action))) {
    return { kort: `super ${m[1]}`, lang: `superknop ${m[1]}: één knop die meer dingen tegelijk beweegt, elk met zijn eigen bereik en curve (wat hij beweegt staat in je werkruimte)` };
  }
  if ((m = /^super\.(\d+)\.hold$/.exec(action))) {
    return { kort: `super ${m[1]} vol`, lang: `superknop ${m[1]} helemaal open zolang je drukt; loslaten = terug naar waar hij stond` };
  }
  if ((m = /^super\.(\d+)\.vast(A|B)$/.exec(action))) {
    return { kort: `leg vast ${m[2]}`, lang: `superknop ${m[1]}: leg de stand van nu vast als ${m[2] === 'A' ? 'begin (A, knop dicht)' : 'eind (B, knop open)'}; daarna schuift de knop tussen A en B (alleen op het scherm)` };
  }
  if ((m = /^send\.(a|b)\.rack\.(next|prev)$/.exec(action))) {
    return { kort: `${m[1] === 'a' ? 'echo' : 'galm'}-rack ${m[2] === 'next' ? '▶' : '◀'}`,
      lang: `${m[2] === 'next' ? 'volgend' : 'vorig'} rack op de ${m[1] === 'a' ? 'echo' : 'galm'}-bus (send ${m[1].toUpperCase()}), met een kruisfade` };
  }
  if ((m = /^layer\.houd\.([\w-]+)$/.exec(action))) {
    return { kort: `houd ${m[1]}`, lang: `houd-mapje ${m[1]}: zolang je deze knop vasthoudt doen andere knoppen (ook op een ander apparaat) iets anders` };
  }
  return null;
}
