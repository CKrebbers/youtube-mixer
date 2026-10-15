// De uitleg van de actions van spoor S1 ('precisie', docs/werkruimte/S1.md): { kort, lang }
// zoals beschrijf() in apc-beschrijf.js, of null (dan beschrijft apc-beschrijf.js hem zelf).
// Puur: geen DOM, geen bus (apc.html en maschine.html laden dit statisch mee).

import { wie as wieIn, wieMet } from '../wie.js';

// Hier heet de tweede track "vorige focus" en de maatgever kort "maatgever" (zo staat het in S1).
const NAMEN = wieMet({ '{maatgever}': 'maatgever', '{tweede}': 'vorige focus', '{R}': 'vorige focus' });
const wie = (t) => wieIn(t, NAMEN);

const SPRONG = { quarter: ['¼', '¼ tel'], half: ['½', '½ tel'], beat: ['1', '1 tel'] };

export default (action) => {
  if (action === 'layer.device.uitlijn') {
    return { kort: 'uitlijn', lang: 'mapje uitlijn: de acht device knobs worden fasemeters (knop k = track k, midden = gelijk met de maatgever, draaien = duwen, ⇧ = fijn); Device ◀ ▶ = jog, On/Off = op de 1' };
  }
  const m = /^track\.([^.]+)\.(.+)$/.exec(action);
  if (!m) return null;
  const [, t, rest] = m;
  const w = wie(t);
  const r = (kort, lang) => ({ kort, lang: `${lang} — ${w}` });
  if (rest === 'phase.offset') return r('fase', 'fase t.o.v. de maatgever: midden = gelijk, de ring toont ±½ tel; draaien duwt de track (één tik = 1/127 tel, 3,8 ms op 124 bpm), fasebehoudend');
  if (rest === 'phase.offset.fine') return r('fase fijn', 'fase fijn: de ring toont ±1/16 tel; één tik = 1/1016 tel (0,48 ms op 124 bpm)');
  let s;
  if ((s = /^jog\.(fine\.)?(back|fwd)$/.exec(rest))) {
    const fijn = !!s[1], terug = s[2] === 'back';
    return r(`jog ${fijn ? 'fijn ' : ''}${terug ? '◀' : '▶'}`,
      `jog ${terug ? 'terug' : 'vooruit'}: ${fijn ? '1/64' : '1/16'} tel (zonder grid ${fijn ? 1 : 5} ms); spelend fasebehoudend en in de loop, in pauze een gewone sprong (het cuepunt blijft staan)`);
  }
  if ((s = /^nudge\.fine\.(back|fwd)$/.exec(rest))) {
    return r(s[1] === 'back' ? '−1 ms' : '+1 ms', `precies 1 ms ${s[1] === 'back' ? 'terug' : 'vooruit'} duwen (wat je hoort)`);
  }
  if ((s = /^beatjump\.(quarter|half|beat)\.(back|fwd)$/.exec(rest))) {
    const [kort, lang] = SPRONG[s[1]];
    const terug = s[2] === 'back';
    return r(`${terug ? '−' : '+'}${kort}`, `beatjump ${lang} ${terug ? 'terug' : 'vooruit'} (vaste lengte, los van de beatjump-lengte van Bank ◀ ▶; in een loop schuift de loop mee)`);
  }
  if (rest === 'bar.align') return r('op de 1', 'op de 1: springt −2…+2 tellen zodat de "1" op die van de maatgever valt (sync zet de tel, niet de maat); alleen met twee zekere grids; lampje = staat goed');
  if (rest === 'bend.amount') return r('bend %', 'bend-sterkte: hoe hard Nudge ± duwt zolang je drukt, 1–16% (standaard 4%)');
  if (rest === 'duoklik') return r('duoklik', 'duoklik aan/uit: in de koptelefoon een hoge tik op de tellen van deze track en een lage op die van de maatgever; hoor je een flam, duw dan tot het één tik is');
  return null;
};
