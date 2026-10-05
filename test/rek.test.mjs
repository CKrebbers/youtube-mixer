// Keylock en toon verschuiven (docs/KEYLOCK.md): de rekenkern van het rekpad
// (src/engine/rek-kern.js) met de ECHTE Signalsmith-WASM (vendor/), zonder
// browser. Wat docs/KEYLOCK.md §4.8 vraagt: de toon blijft staan, transponeren
// klopt, de hoorbare positie (klikken) binnen 1 ms van de segmentformule, een
// geplande sprong klinkt op T op volle sterkte, tempo en loop lopen door zonder
// te zoeken, de loop rolt uit met zijn naad, stems blijven samen, en een bestand
// op 44,1 kHz in een context van 48 kHz houdt zijn toon. Afval: test/renderblok.
// Draai met: node test/rek.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };

const { default: fabriek } = await import('../src/engine/vendor/signalsmith-stretch.js');
const RK = await import('../src/engine/rek-kern.js');
const { PAGINA, positieOp, positieIn } = await import('../src/engine/stream-kern.js');
const { Rekker, leesInvoer, rekToon, wilRek, rekUitLatStandaard, rekPlanT, BLOK, REK_MARGE } = RK;

const SR = 48000;

/** Pagina's (Int16, `kanalen` per frame) uit een functie f(frame, kanaal) → −1..1. */
function maakPaginas(duur, sr, kanalen, f) {
  const n = Math.round(duur * sr);
  const pcm = new Int16Array(n * kanalen);
  for (let i = 0; i < n; i++) for (let c = 0; c < kanalen; c++) pcm[i * kanalen + c] = Math.round(Math.max(-1, Math.min(1, f(i, c))) * 32767);
  const paginas = new Map();
  for (let p = 0; p * PAGINA * kanalen < pcm.length; p++) paginas.set(p, pcm.slice(p * PAGINA * kanalen, (p + 1) * PAGINA * kanalen));
  return { paginas, totaal: n };
}

/** Een Rekker draaien van t0 tot t1 (audioklok), de uitvoer van kanaal 0 en 1 (of alle) terug. */
function draai(r, b, t0, t1, bijBlok = null) {
  const blokken = Math.round((t1 - t0) * SR / BLOK);
  const uit = Array.from({ length: r.kanalen }, () => new Float32Array(blokken * BLOK));
  for (let k = 0; k < blokken; k++) {
    b.t0 = t0 + (k * BLOK) / SR;
    bijBlok?.(b.t0, r);
    const ja = r.blok(b);
    for (let c = 0; c < r.kanalen; c++) {
      const u = r.uit[c];
      for (let i = 0; i < BLOK; i++) uit[c][k * BLOK + i] = ja && b.t0 + i / SR >= r.geldig ? u[i] : 0;
    }
  }
  return uit;
}

/** Frequentie van een sinus uit nuldoorgangen (lineair geïnterpoleerd), over x[van..tot). */
function freq(x, van, tot, sr = SR) {
  let eerste = null, laatste = null, n = 0;
  for (let i = van + 1; i < tot; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]);
      if (eerste === null) eerste = t; else { laatste = t; n++; }
    }
  }
  return n > 0 ? (n * sr) / (laatste - eerste) : 0;
}
const cent = (f, ref) => 1200 * Math.log2(f / ref);
const rms = (x, van, tot) => { let s = 0; for (let i = van; i < tot; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, tot - van)); };

async function nieuweRekker(kanalen = 2) {
  const r = new Rekker(await fabriek(), SR);
  r.configureer(kanalen);
  return r;
}
const seg = (P, R, extra = {}) => ({ T: 0, P, R, loop: null, speelt: true, rem: null, rek: { keylock: true, toon: 0 }, ...extra });

// ---- 1. puur ------------------------------------------------------------------------
console.log('puur');
{
  ok('rekToon: keylock = alleen de toon; zonder keylock ook de pitch; ander bestands-sr telt mee',
    rekToon({ keylock: true, toon: 2 }, 1.08, SR, SR) === 2 && Math.abs(rekToon({ keylock: false, toon: 0 }, 2, SR, SR) - 12) < 1e-12
    && Math.abs(rekToon({ keylock: true, toon: 0 }, 1, 44100, 48000) - 12 * Math.log2(44100 / 48000)) < 1e-12);
  ok('wilRek: keylock of een toon, nooit een rem, niet zonder rek', wilRek(seg(0, 1)) && wilRek(seg(0, 1, { rek: { keylock: false, toon: -1 } }))
    && !wilRek(seg(0, 1, { rek: { keylock: false, toon: 0 } })) && !wilRek(seg(0, 1, { rem: { a: -1 } })) && !wilRek(seg(0, 1, { rek: null })));
  ok('uitvoerlatentie vóór de meting: 4320 frames op 48 kHz (standaard, gespreid; gemeten hieronder)', rekUitLatStandaard(SR) === 4320);
  ok('rekPlanT: het eerste T ≥ vroegst met T − uitLat op een blokgrens', (() => {
    const T = rekPlanT(1.2345, 4320, SR);
    const k = (T * SR - 4320) / 128;
    return T >= 1.2345 && T - 1.2345 < 128 / SR + 1e-12 && Math.abs(k - Math.round(k)) < 1e-6;
  })());
  ok('positieIn: tot T het vorige segment, zonder vorig stil op P, daarna het nieuwe',
    positieIn({ T: 2, P: 50, R: 1, speelt: true }, { T: 0, P: 10, R: 1, speelt: true }, 1.5) === 11.5
    && positieIn({ T: 2, P: 50, R: 1, speelt: true }, null, 1.5) === 50 && positieIn({ T: 2, P: 50, R: 1, speelt: true }, null, 3) === 51);

  // leesInvoer: hele frames, loop uitgerold met de naad, gat en grenzen = stilte.
  const { paginas, totaal } = maakPaginas(3, SR, 2, (i, c) => (c === 0 ? 1 : -1) * ((i % 1000) / 1000));
  const L = new Float32Array(4000), R = new Float32Array(4000);
  leesInvoer(seg(0, 1), paginas, 999, 3, [L, R], 2, SR, totaal);
  ok('hele frames, beide kanalen', Math.abs(L[0] - 0.999) < 1e-4 && L[1] === 0 && Math.abs(R[2] + 0.001) < 1e-4);
  leesInvoer(seg(0, 1), paginas, -2, 4, [L, R], 2, SR, totaal);
  ok('vóór het begin: stilte', L[0] === 0 && L[1] === 0 && Math.abs(L[2]) < 1e-9);
  leesInvoer(seg(0, 1), paginas, totaal - 1, 3, [L, R], 2, SR, totaal);
  ok('na het einde: stilte', L[1] === 0 && L[2] === 0);
  const zonderPag = new Map(paginas); zonderPag.delete(1);
  leesInvoer(seg(0, 1), zonderPag, PAGINA - 1, 3, [L, R], 2, SR, totaal);
  ok('een gat (pagina ontbreekt): stilte, geen herhaling', L[0] !== 0 && L[1] === 0 && L[2] === 0);
  const lp = { start: 1, end: 1.5 };
  const a = SR, b = 1.5 * SR, nd = Math.round(0.005 * SR);
  leesInvoer(seg(1, 1, { loop: lp }), paginas, b - nd - 5, nd + 15, [L, R], 2, SR, totaal);
  const ruw = (v) => ((v % 1000) / 1000);
  ok('vóór de naad: het frame zelf', Math.abs(L[0] - ruw(b - nd - 5)) < 1e-4);
  ok('in de naad: equal-power naar wat er vóór het loopbegin staat', (() => {
    const i = 5 + nd / 2, v = b - nd + nd / 2, rest = b - v, w = 1 - rest / nd;
    const verwacht = ruw(v) * Math.cos(w * Math.PI / 2) + ruw(a - rest) * Math.sin(w * Math.PI / 2);
    return Math.abs(L[i] - verwacht) < 1e-4;
  })());
  ok('voorbij het einde: weer vanaf het loopbegin (uitgerold, geen sprong in de telling)', Math.abs(L[5 + nd] - ruw(a)) < 1e-4 && Math.abs(L[5 + nd + 3] - ruw(a + 3)) < 1e-4);
}

// ---- 2. de toon -------------------------------------------------------------------------
console.log('\nde toon (sinus 440 Hz)');
const SINUS = maakPaginas(30, SR, 2, (i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / SR));
const bv = (p, extra = {}) => ({ paginas: p.paginas, frames: BLOK, t0: 0, trackRate: SR, totaal: p.totaal, stride: 2, ...extra });
for (const R of [0.92, 1, 1.08]) {
  const r = await nieuweRekker();
  r.zet(seg(2, R), false, 0, SR);
  const uit = draai(r, bv(SINUS), 0, 3);
  const f = freq(uit[0], SR, 3 * SR);
  ok(`keylock op ${R}: de toon blijft 440 Hz`, Math.abs(cent(f, 440)) < 1, `${f.toFixed(2)} Hz, ${cent(f, 440).toFixed(2)} ct`);
}
for (const [toon, R, keylock] of [[2, 1, true], [-1, 1.08, true], [1, 1.08, false]]) {
  const r = await nieuweRekker();
  r.zet(seg(2, R, { rek: { keylock, toon } }), false, 0, SR);
  const uit = draai(r, bv(SINUS), 0, 3);
  const f = freq(uit[0], SR, 3 * SR);
  const doel = 440 * Math.pow(2, toon / 12) * (keylock ? 1 : R);
  ok(`toon ${toon > 0 ? '+' : ''}${toon} op ${R}${keylock ? ' met keylock' : ' zonder keylock (de pitch telt mee, K8)'}: binnen 5 cent`,
    Math.abs(cent(f, doel)) < 5, `${f.toFixed(2)} Hz tegen ${doel.toFixed(2)}`);
}
{
  // Een bestand op 44,1 kHz in een context van 48 kHz: dezelfde toon.
  const s44 = maakPaginas(10, 44100, 2, (i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100));
  const r = await nieuweRekker();
  r.zet(seg(2, 1.05), false, 0, 44100);
  const uit = draai(r, bv(s44, { trackRate: 44100 }), 0, 3);
  const f = freq(uit[0], SR, 3 * SR);
  ok('bestand op 44,1 kHz in een context van 48 kHz, keylock op 1,05: 440 Hz', Math.abs(cent(f, 440)) < 1, `${f.toFixed(2)} Hz`);
}

// ---- 3. de hoorbare positie (klikken om de 0,5 s, zoals controle 2) -------------------------
console.log('\nde hoorbare positie');
const KLIK_ELKE = 0.5;
const KLIKKEN = maakPaginas(40, SR, 2, (i) => (i % (KLIK_ELKE * SR) < 24 ? 0.9 : 0));
/** Begin van elke klik in de uitvoer (drempel), in seconden audioklok vanaf t0. */
function klikken(x, t0, drempel = 0.3) {
  const uit = [];
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) >= drempel && Math.abs(x[i - 1]) < drempel) { uit.push(t0 + i / SR); i += 2000; }
  return uit;
}
/** Wanneer de segmentformule klik k laat horen (tracktijd k·0,5). */
const verwachtOp = (s, x) => s.T + (x - s.P) / s.R;
for (const R of [0.92, 1, 1.08]) {
  const r = await nieuweRekker();
  const s = seg(3.21, R, { T: 0 });
  r.zet(s, false, 0, SR);
  const uit = draai(r, bv(KLIKKEN), 0, 12);
  const t = klikken(uit[0], 0).filter((x) => x > r.geldig + 0.05);
  const afw = t.map((x) => { const p = positieOp(s, x); const k = Math.round(p / KLIK_ELKE) * KLIK_ELKE; return x - verwachtOp(s, k); });
  const max = Math.max(...afw.map(Math.abs));
  ok(`keylock op ${R}: elke klik binnen 1 ms van de segmentformule (${t.length} klikken)`, t.length >= 15 && max < 0.001, `grootste ${(max * 1000).toFixed(3)} ms`);
}

// ---- 4. een geplande sprong (hotcue met keylock, K3) ---------------------------------------
console.log('\neen geplande sprong');
{
  const r = await nieuweRekker();
  const s0 = seg(3.0, 1.04);
  r.zet(s0, false, 0, SR);
  ok('de gemeten uitvoerlatentie is wat de hoofdthread vooraf aanneemt', r.uitLat === rekUitLatStandaard(SR));
  const T = rekPlanT(2 + r.uitLat / SR + REK_MARGE, r.uitLat, SR);
  // De sprong: op T naar 20,48 s (een klik op 20,5: 20 ms na het doel).
  const sprong = { ...seg(20.48, 1.04), T };
  const uit = draai(r, bv(KLIKKEN), 0, 4, (t0) => { if (Math.abs(t0 - 2) < 1e-9) r.zet(sprong, true, t0, SR); });
  let eerste;
  for (let i = Math.round((T - 0.01) * SR); i < uit[0].length; i++) if (Math.abs(uit[0][i]) >= 0.3) { eerste = i / SR; break; }
  const verwacht = T + 0.02 / 1.04;
  ok('de klik 20 ms na het doel klinkt op T + 20 ms (exact; de eerste sample boven de drempel)', eerste !== undefined && Math.abs(eerste - verwacht) < 0.0002,
    `${eerste ? ((eerste - verwacht) * 1000).toFixed(3) : '?'} ms`);
  const i = Math.round(eerste * SR);
  const piek = Math.max(...Array.from(uit[0].subarray(i, i + 30)).map(Math.abs));
  ok('… op volle sterkte (niet ingezwollen)', piek > 0.8 * 0.9, `piek ${piek.toFixed(3)}`);
  const voor = klikken(uit[0], 0).filter((x) => x > r.geldig + 0.05 && x < T - 0.01);
  ok('tot T het oude segment (zijn klikken op de oude plek)', voor.length >= 2 && voor.every((x) => {
    const p = positieOp(s0, x); return Math.abs(x - verwachtOp(s0, Math.round(p / KLIK_ELKE) * KLIK_ELKE)) < 0.001;
  }));
}

// ---- 5. doorlopen zonder zoeken: tempo, toon, loop -------------------------------------------
console.log('\ndoorlopen');
{
  const r = await nieuweRekker();
  const s0 = seg(5, 1);
  r.zet(s0, false, 0, SR);
  let s = s0;
  const tempo = [[1.5, 1.05], [2.5, 0.96], [3.2, 1.0]];
  const uit = draai(r, bv(SINUS), 0, 5, (t0) => {
    for (const [tw, R] of tempo) if (Math.abs(t0 - Math.round(tw * SR / BLOK) * BLOK / SR) < 1e-9) {
      const p = positieOp(s, t0);
      s = { ...seg(p, R), T: t0 };
      r.zet(s, false, t0, SR);
    }
  });
  ok('tempo 1,00 → 1,05 → 0,96 → 1,00: één keer gezocht (het begin), geen gat', r.zoeken === 1, `${r.zoeken}x`);
  let minRms = Infinity;
  for (let k = Math.round(0.3 * SR); k < 5 * SR - 2400; k += 2400) minRms = Math.min(minRms, rms(uit[0], k, k + 2400));
  ok('… de sinus blijft overal op sterkte (geen dip)', minRms > 0.3, `kleinste rms ${minRms.toFixed(3)}`);
  ok('… en op 440 Hz', Math.abs(cent(freq(uit[0], Math.round(3.5 * SR), 5 * SR - 100), 440)) < 1);
}
{
  // Een loop van één tel (124 bpm): de invoer rolt uit, geen zoeken bij de naad, periode klopt.
  const r = await nieuweRekker();
  const len = 60 / 124;
  const s = seg(10, 1.05, { loop: { start: 10, end: 10 + len } });
  r.zet(s, false, 0, SR);
  const uit = draai(r, bv(KLIKKEN), 0, 8);
  const t = klikken(uit[0], 0).filter((x) => x > r.geldig + 0.05);
  const verwacht = t.map((x) => { const p = positieOp(s, x); const k = Math.round(p / KLIK_ELKE) * KLIK_ELKE; return Math.abs(p - k) < 0.002; });
  ok(`een loop van één tel op 1,05: geen enkele keer gezocht na het begin`, r.zoeken === 1, `${r.zoeken}x`);
  ok(`… elke klik op de plek die de gevouwen positie zegt (${t.length} klikken)`, t.length >= 8 && verwacht.every(Boolean));
  // Loop eraf (T = nu): doorlopen, niet zoeken.
  const r2 = await nieuweRekker();
  let s2 = s;
  r2.zet(s2, false, 0, SR);
  draai(r2, bv(KLIKKEN), 0, 4, (t0) => {
    if (Math.abs(t0 - Math.round(2.9 * SR / BLOK) * BLOK / SR) < 1e-9) {
      s2 = { ...s2, T: t0, P: positieOp(s2, t0), loop: null };
      r2.zet(s2, false, t0, SR);
    }
  });
  ok('loop eraf terwijl hij al rondging: doorlopen (verschoven telling), niet zoeken', r2.zoeken === 1, `${r2.zoeken}x`);
}

// ---- 6. stems: vier paren samen -------------------------------------------------------------------
console.log('\nstems');
{
  const freqs = [220, 330, 440, 550];
  const st = maakPaginas(10, SR, 8, (i, c) => 0.4 * Math.sin(2 * Math.PI * freqs[c >> 1] * i / SR));
  const r = await nieuweRekker(8);
  r.zet(seg(2, 1.07), false, 0, SR);
  const uit = draai(r, bv(st, { stride: 8 }), 0, 3);
  const gemeten = [0, 2, 4, 6].map((c) => freq(uit[c], SR, 3 * SR));
  ok('acht kanalen in één stretcher: elk paar houdt zijn toon (keylock 1,07)', gemeten.every((f, k) => Math.abs(cent(f, freqs[k])) < 1),
    gemeten.map((f) => f.toFixed(1)).join(', '));
}

// ---- 7. de worklet: twee paden ---------------------------------------------------------------
console.log('\nde worklet (stream-lezer.js, nagebouwde AudioWorkletGlobalScope)');
globalThis.sampleRate = SR;
globalThis.currentFrame = 0;
let Lezer = null;
globalThis.AudioWorkletProcessor = class {
  constructor() { const uit = []; this.port = { onmessage: null, uit, postMessage: (m) => { uit.push(m); } }; }
};
globalThis.registerProcessor = (_naam, k) => { Lezer = k; };
await import('../src/engine/stream-lezer.js');
const { UITGANGEN, SEGMENT_FADE } = await import('../src/engine/stream-kern.js');
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

/** Een worklet-deck: bron + pagina's, en een klok die blok voor blok loopt. */
function maakDeck(pag, kanalen = 2, duur = 30) {
  const d = new Lezer();
  d.port.onmessage({ data: { type: 'bron', duur, sr: SR, kanalen } });
  for (const [i, data] of pag.paginas) d.port.onmessage({ data: { type: 'pagina', i, data } });
  d.uitgangen = Array.from({ length: UITGANGEN }, () => [new Float32Array(BLOK), new Float32Array(BLOK)]);
  d.klok = 0;
  d.id = 0;
  return d;
}
const nu = (d) => (d.klok * BLOK) / SR;
function stuur(d, seg, gepland = false) {
  globalThis.currentFrame = d.klok * BLOK;
  d.port.onmessage({ data: { type: 'segment', id: ++d.id, seg, ...(gepland ? { gepland: true } : {}) } });
}
/** `sec` seconden draaien; de uitvoer van uitgang k (L) terug. */
function speel(d, sec, k = 0, alles = false) {
  const n = Math.round(sec * SR / BLOK);
  const uit = alles ? Array.from({ length: UITGANGEN }, () => new Float32Array(n * BLOK)) : [new Float32Array(n * BLOK)];
  for (let b = 0; b < n; b++, d.klok++) {
    globalThis.currentFrame = d.klok * BLOK;
    d.process([], d.uitgangen, null);
    if (alles) for (let j = 0; j < UITGANGEN; j++) uit[j].set(d.uitgangen[j][0], b * BLOK);
    else uit[0].set(d.uitgangen[k][0], b * BLOK);
  }
  return alles ? uit : uit[0];
}
async function totRek(d) {
  for (let i = 0; i < 200 && !d.rek; i++) await wacht(5);
  return d.rek;
}
/** Kleinste rms over vensters van 1 ms, tussen twee tijden (s, vanaf het begin van x). */
function minVenster(x, van, tot) {
  let m = Infinity;
  for (let i = Math.round(van * SR); i + 48 <= Math.round(tot * SR); i += 24) m = Math.min(m, rms(x, i, i + 48));
  return m;
}
const KL = { keylock: true, toon: 0 };
const sg = (d, P, R, extra = {}) => ({ T: nu(d), P, R, loop: null, speelt: true, rem: null, rek: null, ...extra });

{
  // Keylock aan terwijl hij speelt op 1,08: A speelt door tot B geldig is, geen gat, dan 440 Hz.
  const d = maakDeck(SINUS);
  stuur(d, sg(d, 2, 1.08));
  const a = speel(d, 0.5);
  ok('zonder keylock: renderBlok, de toon schuift mee (475,2 Hz)', Math.abs(cent(freq(a, 2400, a.length), 440 * 1.08)) < 1);
  stuur(d, sg(d, positieOp({ T: 0, P: 2, R: 1.08, speelt: true }, nu(d)), 1.08, { rek: KL }));
  const r = await totRek(d);
  ok('een segment met keylock: de stretcher laadt en meldt zijn uitvoerlatentie', !!r && d.port.uit.some((m) => m.type === 'rek' && m.uitLat === r.uitLat && m.sr === SR));
  const t1 = nu(d);
  const x = speel(d, 1);
  ok('keylock aan tijdens het spelen: geen gat (A speelt tot B geldig is)', minVenster(x, 0, 1) > 0.3, `kleinste 1 ms-rms ${minVenster(x, 0, 1).toFixed(3)}`);
  ok('… na ~95 ms op het rekpad: 440 Hz', d.inB && Math.abs(cent(freq(x, Math.round(0.3 * SR), x.length), 440)) < 1,
    `${freq(x, Math.round(0.3 * SR), x.length).toFixed(2)} Hz, wissel na ${((d.bVan - t1) * 1000).toFixed(1)} ms`);
}
{
  // Op tempo 1,00 zijn A en B bijna gelijk, maar de stretcher draait soms de
  // polariteit om: zonder keuze gaf de overgang een dip tot −15 dB (KEYLOCK.md
  // §2). Gemeten tegen dezelfde run zonder wissel, in vensters van 2 ms rond
  // het moment van de overgang.
  const muziek = maakPaginas(20, SR, 2, (i, c) => 0.3 * Math.sin(2 * Math.PI * 110 * i / SR + c) + 0.2 * Math.sin(2 * Math.PI * 1234.5 * i / SR)
    + 0.15 * Math.sin(2 * Math.PI * 333 * i / SR) * Math.sin(2 * Math.PI * 0.7 * i / SR));
  /**
   * Een run: A, dan (blok 75) keylock aan, dan (blok 225) uit. Met `wissel`
   * false: alleen A. `omgekeerd`: de stretcher geeft alles met het andere
   * teken (wat Signalsmith op echte muziek soms doet): dan moet de worklet dat
   * zien en B omkeren.
   */
  async function run(P, wissel, omgekeerd = false) {
    const d = maakDeck(muziek);
    d.port.onmessage({ data: { type: 'segment', id: 0, seg: sg(d, P, 1, { rek: KL }) } });
    const rk = await totRek(d);
    if (omgekeerd) {
      const echt = rk.blok.bind(rk);
      rk.blok = (b) => { const j = echt(b); for (const u of rk.uit) for (let i = 0; i < b.frames; i++) u[i] = -u[i]; return j; };
    }
    d.klok = 0;
    stuur(d, sg(d, P, 1));
    const a = speel(d, 75 * BLOK / SR);
    stuur(d, sg(d, P + nu(d), 1, { rek: wissel ? KL : null }));
    const b = speel(d, 150 * BLOK / SR);
    const bVan = d.bVan, teken = d.bTeken;
    stuur(d, sg(d, P + nu(d), 1, { rek: null }));
    const c = speel(d, 75 * BLOK / SR);
    const x = new Float32Array(a.length + b.length + c.length);
    x.set(a); x.set(b, a.length); x.set(c, a.length + b.length);
    return { x, bVan, teken, aTeken: d.aTeken };
  }
  let slechtste = Infinity, keer = 0;
  for (const [P, omgekeerd] of [[3, false], [4.2, false], [7.77, true], [11.1, false], [13.37, true]]) {
    const ref = (await run(P, false)).x;
    const w = await run(P, true, omgekeerd);
    if (w.teken < 0) keer++;
    for (const t of [w.bVan, (225 * BLOK) / SR]) {
      for (let i = Math.round((t - 0.004) * SR); i < Math.round((t + 0.012) * SR); i += 48) {
        slechtste = Math.min(slechtste, rms(w.x, i, i + 96) / rms(ref, i, i + 96));
      }
    }
  }
  ok(`keylock aan en uit op 1,00: geen dip dieper dan −3 dB tegen dezelfde run zonder wissel`,
    slechtste > Math.pow(10, -3 / 20), `diepste ${(20 * Math.log10(slechtste)).toFixed(1)} dB`);
  ok('een omgekeerde stretcher wordt gezien en omgekeerd (bTeken −1), alleen daar', keer === 2, `${keer} van de 2`);
  {
    // Zonder keuze (teken vast op +1) zou die omgekeerde wissel wél dippen: de test meet iets.
    const ref = (await run(7.77, false)).x;
    const d = maakDeck(muziek);
    d.port.onmessage({ data: { type: 'segment', id: 0, seg: sg(d, 7.77, 1, { rek: KL }) } });
    const rk = await totRek(d);
    const echt = rk.blok.bind(rk);
    rk.blok = (b) => { const j = echt(b); for (const u of rk.uit) for (let i = 0; i < b.frames; i++) u[i] = -u[i]; d.tekenB = false; d.bTeken = 1; return j; };
    d.klok = 0;
    stuur(d, sg(d, 7.77, 1));
    const a = speel(d, 75 * BLOK / SR);
    stuur(d, sg(d, 7.77 + nu(d), 1, { rek: KL }));
    const x = speel(d, 150 * BLOK / SR);
    let diep = Infinity;
    for (let i = Math.round((d.bVan - 0.004) * SR) - a.length; i < Math.round((d.bVan + 0.012) * SR) - a.length; i += 48) {
      diep = Math.min(diep, rms(x, i, i + 96) / rms(ref, a.length + i, a.length + i + 96));
    }
    ok('… ter controle: zonder keuze dipt diezelfde wissel wel', diep < Math.pow(10, -6 / 20), `${(20 * Math.log10(diep)).toFixed(1)} dB`);
  }
}
{
  // Pauze in het rekpad: uitvloeien in 4 ms, dan stil, en de stretcher rekent niet meer.
  const d = maakDeck(SINUS);
  stuur(d, sg(d, 2, 1.05, { rek: KL }));
  await totRek(d);
  d.klok = 0;
  stuur(d, sg(d, 2, 1.05, { rek: KL }));
  speel(d, 0.5);
  stuur(d, { ...sg(d, 2.5, 1.05, { rek: KL }), speelt: false });
  const x = speel(d, 0.1);
  ok('pauze met keylock: binnen 4 ms uitgevloeid, daarna stil', rms(x, Math.round(0.006 * SR), x.length) === 0 && rms(x, 0, 96) > 0.1);
  ok('… en de stretcher ligt stil (geen rekenwerk in pauze)', !d.inB && !d.rek.loopt);
  // Geplande start vanuit stilte (play met keylock): stil tot T, dan op T de muziek.
  const T = rekPlanT(nu(d) + d.rek.uitLat / SR + REK_MARGE, d.rek.uitLat, SR);
  stuur(d, { ...sg(d, 20.48, 1.05, { rek: KL }), T }, true);
  const t0 = nu(d);
  const y = speel(d, 0.5);
  ok('play met keylock (gepland op T): tot T stil', rms(y, 0, Math.round((T - t0) * SR) - 1) === 0);
  ok('… vanaf T klinkt hij (op sterkte na de 4 ms invloeien)', rms(y, Math.round((T - t0 + 0.01) * SR), Math.round((T - t0 + 0.05) * SR)) > 0.3);
}
{
  // Een geplande sprong via berichten (hotcue): de klik 20 ms na het doel op T + 20 ms.
  const d = maakDeck(KLIKKEN, 2, 40);
  stuur(d, sg(d, 3.1, 1.0, { rek: KL }));
  await totRek(d);
  d.klok = 0;
  stuur(d, sg(d, 3.1, 1.0, { rek: KL }));
  speel(d, 0.6);
  const T = rekPlanT(nu(d) + d.rek.uitLat / SR + REK_MARGE, d.rek.uitLat, SR);
  stuur(d, { ...sg(d, 20.48, 1.0, { rek: KL }), T }, true);
  const t0 = nu(d);
  const x = speel(d, 0.5);
  let k;
  for (let i = Math.round((T - t0 - 0.01) * SR); i < x.length; i++) if (Math.abs(x[i]) >= 0.3) { k = t0 + i / SR; break; }
  ok('hotcue met keylock via de worklet: de klik op T + 20 ms (exact)', k !== undefined && Math.abs(k - (T + 0.02)) < 0.0002, k ? `${((k - T - 0.02) * 1000).toFixed(3)} ms` : 'geen klik');
}
{
  // Trackeinde in het rekpad; een rem gaat via renderBlok (de toon zakt, zoals vinyl).
  const d = maakDeck(SINUS, 2, 30);
  stuur(d, sg(d, 29.5, 1.05, { rek: KL }));
  await totRek(d);
  d.klok = 0;
  stuur(d, sg(d, 29.5, 1.05, { rek: KL }));
  speel(d, 0.8);
  ok('trackeinde met keylock: één keer "einde" (met het segment-id)', d.port.uit.filter((m) => m.type === 'einde').length === 1
    && d.port.uit.find((m) => m.type === 'einde').id === d.id);
  const e = maakDeck(SINUS);
  stuur(e, sg(e, 2, 1, { rek: KL }));
  await totRek(e);
  e.klok = 0;
  stuur(e, sg(e, 2, 1, { rek: KL }));
  speel(e, 0.4);
  stuur(e, sg(e, 2.4, 1, { rek: KL, rem: { a: -1 / 2 } }));
  const x = speel(e, 0.6);
  ok('een rem met keylock: terug naar renderBlok, de toon zakt', !e.inB && freq(x, Math.round(0.4 * SR), x.length) < 440 * 0.85);
}
{
  // Stems door het rekpad: elke uitgang zijn eigen stem, op zijn eigen toon.
  const freqs = [220, 330, 440, 550];
  const st = maakPaginas(10, SR, 8, (i, c) => 0.4 * Math.sin(2 * Math.PI * freqs[c >> 1] * i / SR));
  const d = maakDeck(st, 8, 10);
  stuur(d, sg(d, 2, 0.94, { rek: KL }));
  await totRek(d);
  d.klok = 0;
  stuur(d, sg(d, 2, 0.94, { rek: KL }));
  const x = speel(d, 1, 0, true);
  const f = x.map((u) => freq(u, Math.round(0.3 * SR), u.length));
  ok('stems met keylock: vier uitgangen, elk zijn stem op zijn toon', f.every((v, k) => Math.abs(cent(v, freqs[k])) < 1), f.map((v) => v.toFixed(1)).join(', '));
}

// ---- 8. de worklet-bron noemt document niet ----------------------------------------------------------
{
  const bron = readFileSync(new URL('../src/engine/rek-kern.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');      // zonder commentaar
  ok('rek-kern.js: geen DOM, geen Web Audio, geen tijd van buiten', !/document\.|window\.|AudioContext|Date\.now|performance\.now/.test(bron));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
