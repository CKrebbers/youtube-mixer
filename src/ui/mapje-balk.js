import { resolveTarget } from '../control/mapping.js';
import { metaOf } from '../control/actions.js';
import { GROEPEN, LAAGNAAM } from '../control/lagen.js';
import { esc } from './dom.js';

/**
 * Het balkje dat zegt wat de knoppen NU doen. De APC heeft geen scherm; bij
 * elke mapjewissel komt hier kort in beeld welk mapje open staat en wat de
 * acht knoppen in dat mapje doen. Zo hoef je niets te onthouden.
 *
 * De grid-modus (Shift + Metronome) is geen kort mapje maar een toestand:
 * zolang hij aan staat blijft zijn uitleg staan, en na elk ander mapje komt
 * hij terug. `body.gridmodus` laat de rest van het scherm meedoen (de
 * onset-streepjes in de zoom, stap C).
 */

const DUUR = 2500;

/** "Track 3 FX plek 2" -> "FX plek 2": het tracknummer staat al in de kop. */
const kort = (label) => String(label ?? '').replace(/^Track \d+ /, '');

export function opzetMapjeBalk({ lagen, mapping, vars }) {
  const el = document.createElement('div');
  el.className = 'mapje-balk hidden';
  document.body.append(el);
  let timer = null;
  let volg = null;        // houdt het tracknummer bij zolang de grid-modus aan is
  let getoond = null;

  const gridAan = () => lagen.stand?.edit === 'aan';
  const gridTekst = () => {
    const nr = vars()?.focus ?? '?';
    const k = [['scene 1', 'tel 1 hier'], ['2', '×2'], ['3', '½'], ['4', 'halve tel'], ['5', 'nieuw stuk'],
      ['nudge', '±5 ms (shift ±1)'], ['cue level', 'bpm ±0,01 (shift ±0,1)'], ['tap', 'tikken'], ['lock', 'slot']];
    return `<div class="mapje-kop"><b>GRID-MODUS</b> — track ${esc(nr)} · uit met Shift + Metronome</div>`
      + `<div class="mapje-knoppen">${k.map(([a, b]) => `<span><b>${esc(a)}</b> ${esc(b)}</span>`).join('')}</div>`;
  };
  const toonGrid = () => {
    const html = gridTekst();
    if (html !== getoond) { el.innerHTML = html; getoond = html; }
    el.classList.remove('hidden');
  };
  const naDuur = () => { if (gridAan()) toonGrid(); else el.classList.add('hidden'); };

  lagen.on('change', ({ groep, id }) => {
    if (groep === 'edit') {
      const aan = gridAan();
      document.body.classList.toggle('gridmodus', aan);
      clearTimeout(timer);
      timer = null;
      clearInterval(volg);
      if (aan) {
        toonGrid();
        // Focus wisselen verandert het mapje niet, het nummer in de kop wel.
        // Niet over een ander mapje heen dat net even in beeld is (timer loopt).
        volg = setInterval(() => { if (gridAan() && !timer) toonGrid(); }, 250);
      } else {
        getoond = null;
        el.classList.add('hidden');
      }
      return;
    }
    const g = GROEPEN[groep];
    // De regels van dit mapje, in de volgorde van de knoppen op het apparaat.
    const regels = [...mapping.rules.values()]
      .filter((r) => r.laag === id && !r.shift)
      .sort((a, b) => Number(a.in.split(':')[2]) - Number(b.in.split(':')[2]));
    let knoppen = '';
    if (groep === 'device') {
      const v = vars();
      knoppen = regels.map((r, i) => `<span><b>${i + 1}</b> ${esc(kort(metaOf(resolveTarget(r.action, v))?.label ?? r.action))}</span>`).join('');
    } else if (groep === 'top' && regels[0]) {
      knoppen = `<span>${esc(kort(metaOf(resolveTarget(regels[0].action, vars()))?.label ?? ''))} — per track, knop 1–8</span>`;
    }
    getoond = null;
    el.innerHTML = `<div class="mapje-kop">${esc(g?.naam ?? groep)}: <b>${esc(LAAGNAAM[id] ?? id)}</b></div>`
      + (knoppen ? `<div class="mapje-knoppen">${knoppen}</div>` : '');
    el.classList.remove('hidden');
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; naDuur(); }, DUUR);
  });
  return { el };
}
