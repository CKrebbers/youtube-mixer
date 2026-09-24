// Synthetisch materiaal met een bekend antwoord, door DEZELFDE keten als de
// library (48 kHz -> ffmpeg -> 4410 Hz -> toon.mjs). Schrijft synth.txt.
//
//   node tools/toonsoort/synth.mjs
//
// Wat erin zit: alle 24 toonsoorten (cadens), mineur tegenover relatief
// majeur, stemmingen (432 Hz, +25 en -45 cent), nul-proeven (atonaal, alleen
// drums, ruis, een drone) en een modulatie voor de kaart.
import { writeFileSync } from 'node:fs';
import * as T from './toon.mjs';
import { leesPcm, SR, fmt } from './lees.mjs';
import { VARIANTEN, PROFIELNAMEN, bereid } from './varianten.mjs';

const BR = 48000;

// ---- klankopwekking ----------------------------------------------------------------

function zaadRnd(z) { let s = z >>> 0 || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }

// Eén cyclus met 8 harmonischen (1/h): een zachte zaagtand. Opzoektabel, geen sin per sample.
const TAB = 4096;
const zaag = new Float32Array(TAB + 1);
for (let i = 0; i <= TAB; i++) { let v = 0; for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * h * i / TAB) / h; zaag[i] = v * 0.55; }
const sinus = new Float32Array(TAB + 1);
for (let i = 0; i <= TAB; i++) sinus[i] = Math.sin(2 * Math.PI * i / TAB);

function toon(x, van, duur, f, amp, tab = zaag, { aan = 0.02, uit = 0.15 } = {}) {
  const a = Math.round(van * BR), n = Math.round(duur * BR);
  let fase = Math.random() * TAB;
  const stap = f * TAB / BR;
  for (let i = 0; i < n && a + i < x.length; i++) {
    const t = i / BR;
    const env = Math.min(1, t / aan) * Math.min(1, (duur - t) / uit);
    const j = fase | 0, fr = fase - j;
    x[a + i] += amp * env * (tab[j] + fr * (tab[j + 1] - tab[j]));
    fase += stap; if (fase >= TAB) fase -= TAB;
  }
}

const freq = (midi, cent = 0) => 440 * 2 ** ((midi - 69 + cent / 100) / 12);

/** Drums: kick op elke tel, hihat op de achtsten, snare op 2 en 4. */
function drums(x, duur, bpm, rnd, sterkte = 0.6) {
  const p = 60 / bpm;
  for (let t = 0; t < duur - 0.3; t += p / 2) {
    const a = Math.round(t * BR);
    const tel = Math.round(t / p * 2);
    const heel = tel % 2 === 0;
    for (let i = 0; i < 0.25 * BR && a + i < x.length; i++) {
      const s = i / BR;
      let v = 0.35 * (rnd() * 2 - 1) * Math.exp(-s / 0.015);                         // hihat
      if (heel) v += Math.sin(2 * Math.PI * (50 * s + 2.2 * (1 - Math.exp(-s / 0.03)) * 20)) * Math.exp(-s / 0.18);   // kick
      if (heel && (tel / 2) % 2 === 1) v += 0.6 * (rnd() * 2 - 1) * Math.exp(-s / 0.07);  // snare
      x[a + i] += sterkte * v;
    }
  }
}

// Akkoorden als (trap in halve tonen t.o.v. tonica, soort). Majeur: I IV V vi; mineur: i iv V VI.
const MAJ = [0, 4, 7], MIN = [0, 3, 7];
const REEKSEN = {
  'I-IV-V-I':      [[0, MAJ], [5, MAJ], [7, MAJ], [0, MAJ]],
  'I-V-vi-IV':     [[0, MAJ], [7, MAJ], [9, MIN], [5, MAJ]],
  'i-iv-V-i':      [[0, MIN], [5, MIN], [7, MAJ], [0, MIN]],          // harmonisch mineur (leidtoon)
  'i-iv-v-i':      [[0, MIN], [5, MIN], [7, MIN], [0, MIN]],          // natuurlijk mineur, dezelfde tonen als relatief majeur
  'i-VI-III-VII':  [[0, MIN], [8, MAJ], [3, MAJ], [10, MAJ]],         // Am F C G: de beruchte dubbelzinnige
};
const TOONLADDER = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10] };

/**
 * Een stuk in `tonica` (toonklasse, 0 = C) met een akkoordenreeks. Akkoord in
 * octaaf 3-4, bas een octaaf onder de grondtoon, een melodie uit de toonladder,
 * en naar keuze drums en ruis. `cent` = stemming (−31,77 = A 432).
 */
function stuk({ tonica, reeks, duur = 24, cent = 0, akkoordSec = 2, metDrums = true, ruis = 0.02, melodie = true, zaad = 1 }) {
  const rnd = zaadRnd(zaad);
  const x = new Float32Array(Math.round(duur * BR));
  const R = REEKSEN[reeks];
  const mineur = reeks.startsWith('i');
  let i = 0;
  for (let t = 0; t < duur; t += akkoordSec, i++) {
    const [trap, soort] = R[i % R.length];
    const grond = 48 + ((tonica + trap) % 12);          // C3..B3
    for (const iv of soort) toon(x, t, akkoordSec, freq(grond + iv, cent + (rnd() - 0.5) * 6), 0.12);
    toon(x, t, akkoordSec, freq(grond + 12 + soort[1], cent), 0.08);   // terts erboven
    toon(x, t, akkoordSec, freq(grond - 12, cent), 0.22, zaag);        // bas
    if (melodie) {
      const ladder = TOONLADDER[mineur ? 'min' : 'maj'];
      for (let m = 0; m < 4; m++) {
        const noot = 72 + tonica + ladder[Math.floor(rnd() * 7)];
        toon(x, t + m * akkoordSec / 4, akkoordSec / 4, freq(noot > 84 ? noot - 12 : noot, cent), 0.07, sinus, { aan: 0.01, uit: 0.08 });
      }
    }
  }
  if (metDrums) drums(x, duur, 120, rnd);
  for (let k = 0; k < x.length; k++) x[k] += ruis * (rnd() * 2 - 1);
  return x;
}

/** Nul-materiaal. */
function atonaal(duur = 24, zaad = 5) {
  const rnd = zaadRnd(zaad);
  const x = new Float32Array(Math.round(duur * BR));
  for (let t = 0; t < duur; t += 2) {
    const grond = 48 + Math.floor(rnd() * 12);
    const soort = rnd() < 0.5 ? MAJ : MIN;
    for (const iv of soort) toon(x, t, 2, freq(grond + iv), 0.12);
    toon(x, t, 2, freq(grond - 12), 0.22);
    for (let m = 0; m < 4; m++) toon(x, t + m / 2, 0.5, freq(72 + Math.floor(rnd() * 12)), 0.07, sinus);
  }
  drums(x, duur, 120, rnd);
  return x;
}
function alleenDrums(duur = 24) { const x = new Float32Array(duur * BR); drums(x, duur, 124, zaadRnd(9), 0.8); return x; }
function ruis(duur = 24) {
  const rnd = zaadRnd(11), x = new Float32Array(duur * BR);
  let b = 0;
  for (let k = 0; k < x.length; k++) { b = 0.98 * b + 0.02 * (rnd() * 2 - 1); x[k] = 3 * b + 0.05 * (rnd() * 2 - 1); }   // bruinig + wit
  return x;
}
function drone(duur = 40) {
  const x = new Float32Array(duur * BR);
  toon(x, 0, duur, freq(45), 0.25, zaag, { aan: 2, uit: 2 });   // A2
  toon(x, 0, duur, freq(52), 0.18, zaag, { aan: 2, uit: 2 });   // E3
  toon(x, 0, duur, freq(57), 0.10, zaag, { aan: 2, uit: 2 });   // A3
  const rnd = zaadRnd(3);
  for (let k = 0; k < x.length; k++) x[k] += 0.02 * (rnd() * 2 - 1);
  return x;
}
function modulatie() {
  const delen = [
    stuk({ tonica: 0, reeks: 'I-V-vi-IV', duur: 90, zaad: 21 }),                 // C majeur
    stuk({ tonica: 3, reeks: 'I-IV-V-I', duur: 90, zaad: 22 }),                  // Es majeur
    new Float32Array(60 * BR),                                                   // stilte
    stuk({ tonica: 6, reeks: 'i-iv-V-i', duur: 90, zaad: 23, metDrums: false }), // Fis mineur
  ];
  const x = new Float32Array(delen.reduce((a, d) => a + d.length, 0));
  let o = 0;
  for (const d of delen) { x.set(d, o); o += d.length; }
  return x;
}

// ---- meten ---------------------------------------------------------------------

const regels = [];
const zeg = (s = '') => { regels.push(s); console.log(s); };

async function meet(x) {
  const pcm = await leesPcm(x, SR);
  return bereid(pcm, SR);
}

const sleutel = (tonica, mineur) => (mineur ? 12 : 0) + tonica;
Math.random = zaadRnd(77);   // de fasen van de oscillatoren: herhaalbaar

zeg('Toonsoort — synthetische proef (tools/toonsoort/synth.mjs)');
zeg(`Keten: 48 kHz mono -> ffmpeg -> ${SR} Hz -> FFT ${T.STANDAARD.N}, hop ${T.STANDAARD.hop} -> stemming -> halve tonen -> chroma -> profiel.`);
zeg(`Varianten: ${VARIANTEN.map((v) => v.naam).join(', ')}. Profielen: ${PROFIELNAMEN.join(', ')}.`);
zeg('');

// 1. Alle 24 toonsoorten, cadens, met drums.
zeg('== 1. Alle 24 toonsoorten (I-IV-V-I / i-iv-V-i, 24 s, drums + melodie + ruis) ==');
const score = {};
const zekerheden = {};
for (let mineur = 0; mineur < 2; mineur++) {
  for (let t = 0; t < 12; t++) {
    const verwacht = sleutel(t, mineur);
    const b = await meet(stuk({ tonica: t, reeks: mineur ? 'i-iv-V-i' : 'I-IV-V-I', zaad: 100 + t + 12 * mineur }));
    for (const v of VARIANTEN) {
      const { C } = T.chroma(b.hs[v.hs], v.chroma);
      for (const p of PROFIELNAMEN) {
        const r = T.toonsoortVan(C, 0, b.frames, b.ok, p);
        const s = `${v.naam}/${p}`;
        score[s] = score[s] || { goed: 0, relatief: 0, anders: 0 };
        if (r.k === verwacht) score[s].goed++;
        else if (r.k === T.relatief(verwacht)) score[s].relatief++;
        else score[s].anders++;
        (zekerheden[s] = zekerheden[s] || []).push(r);
      }
    }
  }
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
zeg('variant/profiel                 goed  relatief  anders   zekerheid min/med   toon med  marge-ander med');
for (const [s, v] of Object.entries(score)) {
  const rs = zekerheden[s];
  const z = rs.map((r) => r.zekerheid).sort((a, b) => a - b);
  zeg(`${s.padEnd(30)} ${String(v.goed).padStart(4)}/24 ${String(v.relatief).padStart(6)} ${String(v.anders).padStart(8)}     ${fmt(z[0])} / ${fmt(med(z))}`
    + `       ${fmt(med(rs.map((r) => r.toon)))}      ${fmt(med(rs.map((r) => r.margeAnder)))}`);
}
zeg('');

// 2. Mineur tegenover relatief majeur: de reeksen die dezelfde tonen delen.
zeg('== 2. Mineur tegenover relatief majeur (tonica A of C, 24 s) ==');
const paren = [
  ['C: I-V-vi-IV (pop)', 0, 'I-V-vi-IV', 0],
  ['Am: i-iv-V-i (leidtoon G♯)', 9, 'i-iv-V-i', 1],
  ['Am: i-iv-v-i (natuurlijk, geen G♯)', 9, 'i-iv-v-i', 1],
  ['Am: i-VI-III-VII (Am F C G)', 9, 'i-VI-III-VII', 1],
];
const hoofd = VARIANTEN.find((v) => v.hoofd);
zeg(`(variant ${hoofd.naam}; per profiel: gevonden [zekerheid, marge tot ander Camelot-getal])`);
for (const [label, t, reeks, mineur] of paren) {
  const b = await meet(stuk({ tonica: t, reeks, zaad: 300 + t }));
  const { C } = T.chroma(b.hs[hoofd.hs], hoofd.chroma);
  const uit = PROFIELNAMEN.map((p) => {
    const r = T.toonsoortVan(C, 0, b.frames, b.ok, p);
    return `${p} ${T.kort(r.k)} [${fmt(r.zekerheid)}, ${fmt(r.margeAnder)}]`;
  });
  zeg(`${label.padEnd(36)} verwacht ${T.kort(sleutel(t, mineur)).padEnd(3)}  ${uit.join('  ')}`);
}
zeg('');

// 3. Stemming.
zeg('== 3. Stemming (C majeur I-V-vi-IV en A mineur i-iv-V-i, 24 s) ==');
for (const [label, cent] of [['A = 440', 0], ['A = 432 (−31,8 cent)', 1200 * Math.log2(432 / 440)], ['+25 cent', 25], ['−45 cent', -45]]) {
  for (const [t, reeks, mineur] of [[0, 'I-V-vi-IV', 0], [9, 'i-iv-V-i', 1]]) {
    const b = await meet(stuk({ tonica: t, reeks, cent, zaad: 400 + t }));
    const { C } = T.chroma(b.hs[hoofd.hs], hoofd.chroma);
    const r = T.toonsoortVan(C, 0, b.frames, b.ok, 'edma');
    // Ter vergelijking: zonder stemmingscorrectie (raster op 440).
    const zonder = T.chroma(T.halveTonen(b.sp, 0, hoofd.bereikOpties), hoofd.chroma).C;
    const r0 = T.toonsoortVan(zonder, 0, b.frames, b.ok, 'edma');
    zeg(`${label.padEnd(22)} ${T.kort(sleutel(t, mineur)).padEnd(3)}  stemming gemeten ${fmt(b.sp.stemming, 1).padStart(6)} cent (echt ${fmt(cent, 1).padStart(6)}, R ${fmt(b.sp.stemmingR)})`
      + `  edma: ${T.kort(r.k).padEnd(3)} zekerheid ${fmt(r.zekerheid)}  |  zonder correctie: ${T.kort(r0.k).padEnd(3)} zekerheid ${fmt(r0.zekerheid)}`);
  }
}
zeg('');

// 4. Nul-proeven: hier hoort "geen" of een lage zekerheid.
zeg('== 4. Nul-proeven (hoort onzeker te zijn), met een schone cadens ter vergelijking ==');
zeg('[zekerheid = toon × beslist]; onderaan per regel de oude tijd-nul (blokken van 4 s getransponeerd) met edma');
for (const [label, x] of [['C majeur I-IV-V-I (ter vergelijking)', stuk({ tonica: 0, reeks: 'I-IV-V-I', zaad: 500 })],
  ['atonaal (willekeurige drieklanken)', atonaal()], ['atonaal, ander zaad', atonaal(24, 6)], ['alleen drums', alleenDrums()],
  ['ruis', ruis()], ['drone A-E-A (geen terts)', drone()]]) {
  const b = await meet(x);
  const { C } = T.chroma(b.hs[hoofd.hs], hoofd.chroma);
  const uit = PROFIELNAMEN.map((p) => {
    const r = T.toonsoortVan(C, 0, b.frames, b.ok, p);
    return `${p} ${T.kort(r.k)} [${fmt(r.zekerheid)} = ${fmt(r.toon)} × ${fmt(r.beslist)}]`;
  });
  zeg(`${label.padEnd(36)} ${uit.join('  ')}`);
  const oud = T.toonsoortVan(C, 0, b.frames, b.ok, 'edma', { nul: 'gedraaid' });
  zeg(`${''.padEnd(36)} oude nul, edma: ${T.kort(oud.k)} [${fmt(oud.zekerheid)} = ${fmt(oud.toon)} × ${fmt(oud.beslist)}], p97 van de nul r = ${fmt(oud.nulR97)} tegen echt ${fmt(oud.r)}`);
}
zeg('');

// 5. Modulatie voor de kaart.
zeg('== 5. Kaart: 90 s C majeur, 90 s Es majeur, 60 s stilte, 90 s Fis mineur ==');
zeg('verwacht: 0-90 C (8B), 90-180 E♭ (5B), 180-240 geen/stil, 240-330 F♯m (11A)');
{
  const b = await meet(modulatie());
  const { C } = T.chroma(b.hs[hoofd.hs], hoofd.chroma);
  for (const p of ['temperley05', 'temperley', 'edma', 'krumhansl']) {
    const k = T.kaart(C, b.ok, b.frameRate, p);
    zeg(`${p.padEnd(11)} ${k.map((s) => `${fmt(s.van, 0)}-${fmt(s.tot, 0)} ${s.stil ? 'stil' : `${T.kort(s.k)} ${T.camelot(s.k)} (${fmt(s.zekerheid)})`}`).join(' | ')}`);
  }
}
zeg('');

// 6. Een mix waarin elk stuk anders gestemd is: stemming per stuk (kaartPerStuk).
zeg('== 6. Stemming per stuk: 80 s C majeur op 440, 80 s C majeur op +45 cent, 80 s Es majeur op −40 cent ==');
zeg('verwacht: C [0], C [+45], E♭ [−40]. Met één stemming voor alles (het gemiddelde) kan een stuk');
zeg('meer dan 50 cent van die stemming af liggen en een halve toon verkeerd heten.');
{
  const delen = [
    stuk({ tonica: 0, reeks: 'I-V-vi-IV', duur: 80, zaad: 61 }),
    stuk({ tonica: 0, reeks: 'I-IV-V-I', duur: 80, cent: 45, zaad: 62 }),
    stuk({ tonica: 3, reeks: 'I-IV-V-I', duur: 80, cent: -40, zaad: 63 }),
  ];
  const x = new Float32Array(delen.reduce((a, d) => a + d.length, 0));
  let o = 0;
  for (const d of delen) { x.set(d, o); o += d.length; }
  const b = await meet(x);
  zeg(`stemming van het geheel: ${fmt(b.sp.stemming, 1)} cent (R ${fmt(b.sp.stemmingR)})`);
  const { C } = T.chroma(b.hs[hoofd.hs], hoofd.chroma);
  const heel = T.kaart(C, b.ok, b.frameRate, 'temperley05');
  zeg(`één stemming  ${heel.map((s) => `${fmt(s.van, 0)}-${fmt(s.tot, 0)} ${T.kort(s.k)} ${T.camelot(s.k)} (${fmt(s.zekerheid)})`).join(' | ')}`);
  const per = T.kaartPerStuk(b.sp, hoofd.bereikOpties, hoofd.chroma, b.ok, 'temperley05');
  zeg(`per stuk      ${per.map((s) => `${fmt(s.van, 0)}-${fmt(s.tot, 0)} ${T.kort(s.k)} ${T.camelot(s.k)} [${fmt(s.stemming, 0)} ct] (${fmt(s.zekerheid)})`).join(' | ')}`);
}

writeFileSync(new URL('./synth.txt', import.meta.url), regels.join('\n') + '\n');
