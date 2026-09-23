import { resolveTarget } from '../control/mapping.js';
import { metaOf } from '../control/actions.js';
import { GROEPEN, LAAGNAAM } from '../control/lagen.js';
import { esc } from './dom.js';

/**
 * Het balkje dat zegt wat de knoppen NU doen. De APC heeft geen scherm; bij
 * elke mapjewissel komt hier kort in beeld welk mapje open staat en wat de
 * acht knoppen in dat mapje doen. Zo hoef je niets te onthouden.
 */

const DUUR = 2500;

/** "Track 3 FX plek 2" -> "FX plek 2": het tracknummer staat al in de kop. */
const kort = (label) => String(label ?? '').replace(/^Track \d+ /, '');

export function opzetMapjeBalk({ lagen, mapping, vars }) {
  const el = document.createElement('div');
  el.className = 'mapje-balk hidden';
  document.body.append(el);
  let timer = null;

  lagen.on('change', ({ groep, id }) => {
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
    el.innerHTML = `<div class="mapje-kop">${esc(g?.naam ?? groep)}: <b>${esc(LAAGNAAM[id] ?? id)}</b></div>`
      + (knoppen ? `<div class="mapje-knoppen">${knoppen}</div>` : '');
    el.classList.remove('hidden');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.add('hidden'), DUUR);
  });
  return { el };
}
