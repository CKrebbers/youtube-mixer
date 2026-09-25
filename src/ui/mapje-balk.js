import { resolveTarget } from '../control/mapping.js';
import { metaOf } from '../control/actions.js';
import { GROEPEN, LAAGNAAM } from '../control/lagen.js';
import apc from '../control/devices/apc40mk2.js';
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

/**
 * Een grid-mapje per RIJ: wat de vijf rijen doen, met shift erbij. Alleen als
 * elke kolom in die rij hetzelfde doet voor zijn eigen track (kolom 3 =
 * `track.3.…`), zoals hotcues, loops en klank; anders (sampler, video) is er
 * geen rij-uitleg. Bij klank: "1 kill hoog zolang je drukt · shift: aan/uit".
 */
export function gridRijen(regels, id) {
  const per = new Map(regels.filter((r) => r.laag === id).map((r) => [`${r.in}${r.shift ? '#shift' : ''}`, r]));
  const rest = (r, kolom) => r && new RegExp(`^track\\.${kolom}\\.(.+)$`).exec(r.action)?.[1];
  const zelfde = (rij, sh) => {
    const lijst = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => rest(per.get(`note:0:${apc.gridNote(k, rij)}${sh}`), k));
    return lijst[0] && lijst.every((x) => x === lijst[0]) ? lijst[0] : null;
  };
  const uit = [];
  for (let rij = 1; rij <= 5; rij++) {
    const gewoon = zelfde(rij, '');
    if (!gewoon) continue;
    const metShift = zelfde(rij, '#shift');
    uit.push({ rij, gewoon: `track.1.${gewoon}`, shift: metShift ? `track.1.${metShift}` : null });
  }
  return uit;
}

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
      // Genummerd: alleen de draaiknoppen (cc 16–23 = device knob 1–8), op hun
      // eigen nummer. Knoppen in het mapje (◀ ▶, On/Off, Bank) apart, zonder
      // nummer: anders stond er in het mapje vorm "8 vorige vorm".
      const naam = (r) => esc(kort(metaOf(resolveTarget(r.action, v))?.label ?? r.action));
      knoppen = regels.filter((r) => r.in.startsWith('cc:'))
        .map((r) => `<span><b>${Number(r.in.split(':')[2]) - 15}</b> ${naam(r)}</span>`).join('')
        + regels.filter((r) => !r.in.startsWith('cc:')).map((r) => `<span>${naam(r)}</span>`).join('');
    } else if (groep === 'grid') {
      // Per rij, voor elke kolom (= track) gelijk. Rij 1 is de bovenste.
      const label = (a) => esc(kort(metaOf(a)?.label ?? a));
      knoppen = gridRijen([...mapping.rules.values()], id)
        .map((x) => `<span><b>${x.rij}</b> ${label(x.gewoon)}${x.shift ? ` <i>· shift: ${label(x.shift)}</i>` : ''}</span>`).join('');
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
