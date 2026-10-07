import { groepKleur } from '../engine/secties.js';
import { SECTIE_VELDEN } from './plan-model.js';

/*
 * De tijdlijnstrook van het planvenster (docs/PLAN.md): per stap een balk op
 * zijn plek in de set, de overgangen, de secties als banden in de groepskleur
 * en de gekozen in/uit. Tekent op een 2D-context die je meegeeft; geen DOM,
 * geen staat van het venster (zo is hij in Node te toetsen met een nep-context).
 */

/** Kleur per soort overgang. */
export const KLEUR = { blend: '#4ad9c4', filter: '#ffbe3c', ambient: '#c48cff' };

/** Seconden als m:ss (of u:mm:ss); '–' zonder getal. */
export const mmss = (s) => {
  if (!Number.isFinite(s)) return '–';
  const t = Math.max(0, Math.round(s)), u = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return u ? `${u}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};

/**
 * De strook tekenen.
 * @param g        2D-context (al geschaald op devicePixelRatio)
 * @param v        de voorspelling ({ stappen, totaal }, tijdlijn.js)
 * @param w, h     breedte en hoogte in CSS-pixels
 * @param gekozen  id van de gekozen stap, of null
 * @param live     { stap, setTijd } uit de automaat, of null
 * @returns banden: [{ id, sectie, groep, x0, x1 }] (voor de console en de headless proef)
 */
export function tekenStrook(g, { v, w, h, gekozen = null, live = null }) {
  const banden = [], strepen = [];
  g.clearRect(0, 0, w, h);
  const tot = Math.max(1, v.totaal), pad = 10, sx = (t) => pad + (t / tot) * (w - 2 * pad);
  const baan = (i) => (i % 2 ? 40 : 12);
  g.font = '11px system-ui';
  v.stappen.forEach((r, i) => {
    const x0 = sx(r.start), x1 = sx(r.start + r.duur), y = baan(i);
    g.fillStyle = r.ontbreekt ? '#3a1d1d' : '#1b242d';
    g.fillRect(x0, y, Math.max(2, x1 - x0), 24);
    if (!r.ontbreekt && r.secties) tekenBanden(g, r, y, sx, banden, strepen);
    if (r.overgang && r.overlap > 0) {
      g.fillStyle = (KLEUR[r.overgang.gekozen] || '#888') + '55';
      g.fillRect(x0, 8, Math.max(2, sx(r.start + r.overlap) - x0), 60);
    } else if (r.overgang?.gekozen === 'filter') {
      g.fillStyle = KLEUR.filter;
      g.fillRect(x0 - 1, 8, 2, 60);
    }
    const isGekozen = gekozen === r.id, speelt = live?.stap === r.id;
    g.strokeStyle = speelt ? '#4ad9c4' : isGekozen ? '#dfe7ee' : '#2c3844';
    g.lineWidth = speelt || isGekozen ? 2 : 1;
    g.strokeRect(x0 + 0.5, y + 0.5, Math.max(2, x1 - x0) - 1, 23);
    g.save();
    g.beginPath(); g.rect(x0 + 3, y, Math.max(0, x1 - x0 - 6), 24); g.clip();
    // Een donkere rand om de letters: leesbaar op de gekleurde banden.
    g.strokeStyle = '#0d1217'; g.lineWidth = 3; g.lineJoin = 'round';
    g.strokeText(`${i + 1} ${r.titel}`, x0 + 5, y + 15);
    g.fillStyle = '#dfe7ee';
    g.fillText(`${i + 1} ${r.titel}`, x0 + 5, y + 15);
    g.restore();
  });
  // De witte strepen van in en uit in een tweede ronde, bovenop alles: de
  // volgende stap begint vaak precies op een uit, en zijn overgang en banden
  // zouden er anders overheen verven.
  g.fillStyle = '#ffffff';
  for (const [x, y] of strepen) g.fillRect(x - 1, y - 3, 2, 30);
  // Tijd onderaan, en de afspeelkop.
  g.fillStyle = '#8a96a2';
  const stap = tot > 3600 ? 600 : tot > 1200 ? 300 : 60;
  for (let t = 0; t <= tot; t += stap) g.fillText(mmss(t), sx(t) + 2, h - 3);
  if (live && Number.isFinite(live.setTijd)) {
    const x = sx(live.setTijd);
    g.fillStyle = '#4ad9c4';
    g.fillRect(x - 1, 0, 2, h);
  }
  return banden;
}

/**
 * De secties van één stap in zijn balk: per sectie (voor zover in het
 * gespeelde stuk) een band in de groepskleur, onderaan een vol streepje.
 * Een gekozen in of uit: een witte streep op haar begin (in `strepen`; die
 * tekent tekenStrook als laatste).
 */
function tekenBanden(g, r, y, sx, banden, strepen) {
  const st = r.secties;
  const opSet = (t) => sx(r.start + (t - r.van));
  st.forEach((x, k) => {
    const a = Math.max(r.van, x.van), b = Math.min(r.tot, st[k + 1]?.van ?? r.duurNummer ?? r.tot);
    if (!(b > a)) return;
    const xa = opSet(a), xb = opSet(b), kleur = groepKleur(x.groep);
    g.fillStyle = `${kleur}59`;
    g.fillRect(xa, y, Math.max(1, xb - xa), 24);
    g.fillStyle = kleur;
    g.fillRect(xa, y + 20, Math.max(1, xb - xa - 1), 4);
    banden.push({ id: r.id, sectie: k + 1, groep: x.groep, x0: xa, x1: xb });
  });
  for (const veld of SECTIE_VELDEN) {
    const t = st[(r.stap[veld]?.sectie ?? 0) - 1]?.van;
    if (!Number.isFinite(t) || t < r.van - 0.01 || t > r.tot + 0.01) continue;
    strepen.push([opSet(t), y]);
  }
}
