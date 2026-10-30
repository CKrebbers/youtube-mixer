/**
 * Kaart (kaart.html): de APC40 en de Maschine zoals ze voor je liggen, met op elke knop wat hij NU doet en
 * de kleur die hij nu heeft. Wat je net aanraakte licht op. De twee Maschine-schermen staan erbij.
 * Rekenen doet src/control/kaart.js (dezelfde regels als de lampjes); dit bestand tekent alleen.
 * Clay, 30 okt: vier vensters tegelijk om het te leren en te bouwen; dit is er één van.
 */
import { kaartVan, welkeControl } from '../../control/kaart.js';
import { PALET, KLEUR } from '../../control/apparaten/apc40mk2.js';
import { BREED, HOOG } from '../../control/maschine-scherm.js';
import { verbind } from './verbind.js';

const GERAAKT_MS = 1500;
const TEKEN_MS = 66;

// ---- waar elke control ligt: [kolom, rij, breed, hoog] op een raster ---------------------------------

const APC = new Map();
const zet = (kaart, id, k, r, b = 1, h = 1) => kaart.set(id, [k, r, b, h]);
for (let c = 1; c <= 8; c++) {
  zet(APC, `tk${c}`, c, 1);
  for (let r = 1; r <= 5; r++) zet(APC, `pad${r}-${c}`, c, 7 - r);
  zet(APC, `stop${c}`, c, 7);
  zet(APC, `sel${c}`, c, 8);
  zet(APC, `act${c}`, c, 9);
  zet(APC, `solo${c}`, c, 10);
  zet(APC, `rec${c}`, c, 11);
  zet(APC, `ab${c}`, c, 12);
  zet(APC, `fader${c}`, c, 13, 1, 3);
}
for (let r = 1; r <= 5; r++) zet(APC, `scene${r}`, 9, r + 1);
zet(APC, 'stopall', 9, 7); zet(APC, 'mastersel', 9, 8); zet(APC, 'master', 9, 13, 1, 3);
[[1, 1], [2, 1], [3, 1], [4, 1], [5, 2], [6, 2], [7, 2], [8, 2]].forEach(([d, r], i) => zet(APC, `dk${d}`, 11 + (i % 4), r));
[['devL', 'devR', 'bankL', 'bankR'], ['devOn', 'lock', 'clipdev', 'detail'], ['pan', 'sends', 'user', 'metro'],
  ['play', 'record', 'session', 'bank'], ['up', 'down', 'left', 'right'], ['shift', 'tap', 'nudgeM', 'nudgeP'], ['tempo', 'cue', 'voet']]
  .forEach((rij, r) => rij.forEach((id, k) => zet(APC, id, 11 + k, 3 + r)));
zet(APC, 'xf', 11, 14, 4, 1);

const MSC = new Map();
for (let k = 1; k <= 8; k++) { zet(MSC, `f${k}`, 2 + k, 1); zet(MSC, `enc${k}`, 2 + k, 4); }
[['control', 'step'], ['browse', 'sampling'], ['browseL', 'browseR'], ['all', 'auto'], ['volume', 'swing'], ['tempo', 'noteRepeat'],
  ['navL', 'navR'], ['enter', 'wiel']].forEach((rij, r) => rij.forEach((id, k) => zet(MSC, id, 1 + k, 1 + r)));
zet(MSC, 'masterwiel', 1, 9, 2, 1);
['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((g, i) => zet(MSC, `groep${g}`, 3 + (i % 4), 5 + Math.floor(i / 4)));
[['restart', 'stapL', 'stapR', 'grid'], ['play', 'rec', 'erase', 'shift']].forEach((rij, r) => rij.forEach((id, k) => zet(MSC, id, 3 + k, 8 + r)));
[['scene', 'pattern'], ['padMode', 'navigate'], ['duplicate', 'select'], ['solo', 'mute']].forEach((rij, r) => rij.forEach((id, k) => zet(MSC, id, 7 + k, 5 + r)));
for (let p = 1; p <= 16; p++) zet(MSC, `pad${p}`, 9 + ((p - 1) % 4), 8 - Math.floor((p - 1) / 4), 1, 1);

// ---- tekenen ---------------------------------------------------------------------------------------

const hex = (naam) => (naam && naam !== 'uit' ? PALET[KLEUR[naam] ?? 0] : null);
/** Een lichte kleur (wit, geel, lichtgroen) krijgt donkere letters. */
const isLicht = (h) => !!h && (0.299 * parseInt(h.slice(1, 3), 16) + 0.587 * parseInt(h.slice(3, 5), 16) + 0.114 * parseInt(h.slice(5, 7), 16)) > 150;

/** Eén apparaat als raster van knoppen. Geeft een functie die de stand bijwerkt. */
function bouwApparaat(wortel, plaatsen, apparaat) {
  const els = new Map();
  for (const c of apparaat.controls.values()) {
    const p = plaatsen.get(c.id);
    if (!p) continue;
    const el = document.createElement('div');
    el.className = `ctl s-${c.soort} led-${c.led}${p[2] > p[3] && c.soort === 'fader' ? ' liggend' : ''}`;
    el.style.gridArea = `${p[1]} / ${p[0]} / span ${p[3]} / span ${p[2]}`;
    el.innerHTML = '<i></i><b></b>';
    wortel.append(el);
    els.set(c.id, { el, b: el.querySelector('b'), i: el.querySelector('i'), vorige: '' });
  }
  return (kaart, geraakt, nu) => {
    for (const [id, x] of kaart) {
      const e = els.get(id);
      if (!e) continue;
      const kleur = hex(x.kleur);
      const v = x.v ?? 0;
      const vers = (geraakt.get(id) ?? -Infinity) > nu - GERAAKT_MS;
      const sleutel = `${x.label}|${kleur}|${x.aan}|${x.v === null ? '' : v.toFixed(2)}|${vers}|${x.laag}`;
      if (sleutel === e.vorige) continue;
      e.vorige = sleutel;
      e.b.textContent = x.label ?? '';
      e.el.title = `${x.naam}${x.actie ? ` · ${x.actie}` : ''}`;
      e.el.classList.toggle('leeg', !x.actie);
      e.el.classList.toggle('aan', x.aan);
      e.el.classList.toggle('laag', x.laag);
      e.el.classList.toggle('geraakt', vers);
      e.el.classList.toggle('licht', isLicht(kleur));
      e.el.style.setProperty('--kleur', kleur ?? 'transparent');
      e.el.style.setProperty('--v', x.v === null ? '0' : String(v));
    }
  };
}

/** Een 1-bit Maschine-scherm (256 × 64, rij voor rij, hoogste bit links) op een canvas. */
function tekenScherm(cv, buf, vorig) {
  if (!buf || buf === vorig.buf) return;
  vorig.buf = buf;
  const g = cv.getContext('2d');
  const beeld = g.createImageData(BREED, HOOG);
  for (let i = 0; i < BREED * HOOG; i++) {
    const aan = (buf[i >> 3] >> (7 - (i & 7))) & 1;
    const o = i * 4;
    beeld.data[o] = aan ? 230 : 14; beeld.data[o + 1] = aan ? 236 : 16; beeld.data[o + 2] = aan ? 255 : 20; beeld.data[o + 3] = 255;
  }
  g.putImageData(beeld, 0, 0);
}

const $ = (s) => document.querySelector(s);
const apcEl = $('#apc'), mscEl = $('#maschine');
const kopApc = $('#kop-apc'), kopMsc = $('#kop-maschine');
const schermen = [$('#scherm0'), $('#scherm1')];
for (const cv of schermen) { cv.width = BREED; cv.height = HOOG; }

function lagenTekst(ind) {
  const open = (ind.open ?? []).map((l) => l.replace(/^ruimte\./, '').replace(/^pads\./, 'pads: '));
  return `${ind.actief?.naam ?? '—'}${open.length ? ` · ${open.join(' · ')}` : ''}${ind.shift ? ' · SHIFT' : ''}`;
}

verbind(({ bus, ctl, opstelling }) => {
  for (const el of document.querySelectorAll('.ctl')) el.remove();   // de schermen blijven staan
  const tekenApc = bouwApparaat(apcEl, APC, ctl.apc.apparaat);
  const tekenMsc = bouwApparaat(mscEl, MSC, ctl.maschine.apparaat);
  const scherm = [{ buf: null }, { buf: null }];
  const geraakt = new Map();
  // Wat je aanraakt: de bus zegt welke actie, de indeling op welke knop die nu ligt.
  const weg = bus.on('actie', (a) => {
    const ind = a.bron === 'apc' ? ctl.apc : a.bron === 'maschine' ? ctl.maschine : null;
    const c = ind ? welkeControl(ind, a.id) : null;
    if (c) geraakt.set(`${a.bron}:${c}`, performance.now());
  });
  const metVoorvoegsel = (pre) => ({ get: (id) => geraakt.get(`${pre}:${id}`) });
  const timer = setInterval(() => {
    const nu = performance.now();
    tekenApc(kaartVan(ctl.apc), metVoorvoegsel('apc'), nu);
    tekenMsc(kaartVan(ctl.maschine), metVoorvoegsel('maschine'), nu);
    kopApc.textContent = lagenTekst(ctl.apc);
    kopMsc.textContent = `${lagenTekst(ctl.maschine)}${ctl.maschineScherm ? '' : ' · (geen Maschine: zo zou hij eruitzien)'}`;
    const bufs = opstelling.schermen();
    schermen.forEach((cv, i) => tekenScherm(cv, bufs[i], scherm[i]));
  }, TEKEN_MS);
  return () => { weg(); clearInterval(timer); };
}, $('#hint'));

