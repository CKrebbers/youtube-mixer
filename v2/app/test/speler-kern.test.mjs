// @alleen: afvalmeting (0 GC's over 20.000 blokken; telt de heap, dus niets ernaast)
// De afspeelmotor zonder Web Audio: de kern (speler-kern.js) blok voor blok,
// de worklet in een nagebouwde AudioWorkletGlobalScope, en speler.js tegen een
// nep-AudioWorkletNode. Draai: node --test test/speler-kern.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import {
  PAGINA, OVERVLOEI, OVERVLOEI_SPRONG, OVERVLOEI_WET, GAT_FADE, MAX_SEGMENTEN,
  maakKern, laadBron, planSegmenten, leegBron, renderBlok,
} from '../src/audio/speler-kern.js';

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

const SR = 48000, Q = 128;
const FADE_N = Math.round(OVERVLOEI * SR);            // 192 samples (start, stop)
const SPRONG_N = Math.round(OVERVLOEI_SPRONG * SR);   // 480 samples (sprong)
const TAU = 2 * Math.PI;

// ---- hulp --------------------------------------------------------------------

/** Pagina's uit een functie per frame: Int16 (exact, geen afronding van ons). */
function paginas(frames, fnL, fnR = fnL) {
  const uit = [];
  for (let van = 0; van < frames; van += PAGINA) {
    const n = Math.min(PAGINA, frames - van);
    const p = new Int16Array(2 * n);
    for (let i = 0; i < n; i++) { p[2 * i] = fnL(van + i); p[2 * i + 1] = fnR(van + i); }
    uit.push(p);
  }
  return uit;
}
const q16 = (x) => Math.round(x * 32767);

/** Een sinus als bron, en zijn exacte waarde op een plek (seconden). */
function sinus(f, sr, sec, amp = 0.5) {
  const frames = Math.round(sec * sr);
  return {
    sr, frames,
    paginas: paginas(frames, (n) => q16(amp * Math.sin(TAU * f * n / sr)), (n) => q16(amp * Math.cos(TAU * f * n / sr))),
    L: (p) => (p < 0 || p >= frames / sr ? 0 : amp * Math.sin(TAU * f * p) * 32767 / 32768),
    R: (p) => (p < 0 || p >= frames / sr ? 0 : amp * Math.cos(TAU * f * p) * 32767 / 32768),
  };
}

/** `blokken` blokken renderen vanaf frame `start`; `voor(b, frame)` vóór elk blok. */
function render(k, blokken, { start = 0, voor = null } = {}) {
  const L = new Float32Array(blokken * Q), R = new Float32Array(blokken * Q);
  const bl = new Float32Array(Q), br = new Float32Array(Q);
  for (let b = 0; b < blokken; b++) {
    const f = start + b * Q;
    if (voor) voor(b, f);
    k.klok[0] = f;
    renderBlok(k, bl, br, Q);
    L.set(bl, b * Q); R.set(br, b * Q);
  }
  return { L, R };
}

/** Eerste sample i (vanaf 0) met i / SR ≥ T: daar gaat een segment in. */
const sampleVan = (T) => { let i = Math.floor(T * SR) - 2; while (i / SR < T) i++; return i; };
// De wet van de overvloei (OVERVLOEI_WET): j samples na het ingaan, aan = de nieuwe, uit = de oude.
const wet = (w) => (OVERVLOEI_WET === 'gelijk' ? w : Math.sin(w * Math.PI / 2));
const aan = (j) => wet(Math.min(1, j / FADE_N));
const uit = (j) => wet(1 - Math.min(1, j / FADE_N));
const wFade = aan;
const aanS = (j) => wet(Math.min(1, j / SPRONG_N));
const uitS = (j) => wet(1 - Math.min(1, j / SPRONG_N));

function grootsteStap(y, van, tot) {
  let m = 0;
  for (let i = Math.max(1, van); i < tot; i++) { const d = Math.abs(y[i] - y[i - 1]); if (d > m) m = d; }
  return m;
}
function grootsteFout(y, van, tot, verwacht) {
  let m = 0;
  for (let i = van; i < tot; i++) { const d = Math.abs(y[i] - verwacht(i)); if (d > m) m = d; }
  return m;
}

/** Frequentie uit nuldoorgangen (opgaand, lineair geïnterpoleerd). */
function frequentie(y, van, tot, sr = SR) {
  const tijden = [];
  for (let i = van + 1; i < tot; i++) if (y[i - 1] < 0 && y[i] >= 0) tijden.push(i - 1 + y[i - 1] / (y[i - 1] - y[i]));
  return (tijden.length - 1) / ((tijden[tijden.length - 1] - tijden[0]) / sr);
}

function kernMet(bron) {
  const k = maakKern(SR);
  laadBron(k, bron.sr, bron.frames, bron.paginas);
  return k;
}

// ---- 1. de bron, op de juiste plek -------------------------------------------

test('1. sinus 440 Hz, R=1: uitvoer = bron, op de plek P op T (na de inloop van 4 ms)', () => {
  const s = sinus(440, SR, 4.2);
  assert.ok(s.paginas.length >= 3, 'over pagina-grenzen');
  const k = kernMet(s);
  const T = 0.1, P = 0.512345;
  planSegmenten(k, [{ T, P, R: 1, speelt: true }]);
  const { L, R } = render(k, Math.ceil(2.5 * SR / Q));
  const iT = sampleVan(T);
  const plek = (i) => P + (i / SR - T);
  assert.equal(grootsteFout(L, 0, iT + 1, () => 0), 0, 'vóór T en op T stil (inloop begint op 0)');
  const fL = grootsteFout(L, iT + FADE_N + 1, L.length, (i) => s.L(plek(i)));
  const fR = grootsteFout(R, iT + FADE_N + 1, R.length, (i) => s.R(plek(i)));
  assert.ok(fL < 2e-4 && fR < 2e-4, `fout na de inloop ${fL.toExponential(2)} / ${fR.toExponential(2)}`);
  const fIn = grootsteFout(L, iT, iT + FADE_N + 1, (i) => wFade(i - iT) * s.L(plek(i)));
  assert.ok(fIn < 2e-4, `inloop = sin(w·π/2) × bron (${fIn.toExponential(2)})`);
  // Over een paginagrens heen (frame 65536 en 131072 van de bron).
  const grens = sampleVan(T + (2 * PAGINA / SR - P));
  assert.ok(grootsteFout(L, grens - 50, grens + 50, (i) => s.L(plek(i))) < 2e-4, 'paginagrens naadloos');
});

// ---- 2. sample-exact ---------------------------------------------------------

test('2. segmentwissel sample-exact midden in een blok (naadloos én met overvloei)', () => {
  // Een helling: Catmull-Rom geeft een rechte lijn exact, dus de uitvoer IS de plek.
  const frames = 40000, nul = 15000;
  const k = maakKern(SR);
  laadBron(k, SR, frames, paginas(frames, (n) => n - nul, (n) => nul - n));
  const waarde = (plek) => (plek * SR - nul) / 32768;
  const P1 = 0.1;
  const T2 = (20 * Q + 77) / SR;                       // sample 77 van blok 20
  const P2 = P1 + T2;                                  // sluit aan
  const T3 = (40 * Q + 33.4) / SR;                     // tussen twee samples: gaat in op sample 34
  const P3 = 0.6;                                      // sprong
  planSegmenten(k, [{ T: 0, P: P1, R: 1, speelt: true }, { T: T2, P: P2, R: 2, speelt: true }, { T: T3, P: P3, R: 1, speelt: true }]);
  const { L } = render(k, 60);
  const i2 = 20 * Q + 77, i3 = 40 * Q + 34;
  const lijn1 = (i) => P1 + i / SR, lijn2 = (i) => P2 + (i / SR - T2) * 2, lijn3 = (i) => P3 + (i / SR - T3);
  for (let i = FADE_N + 1; i < i2; i++) assert.ok(Math.abs(L[i] - waarde(lijn1(i))) < 1e-6, `lijn 1 op ${i}`);
  for (let i = i2; i < i3; i++) assert.ok(Math.abs(L[i] - waarde(lijn2(i))) < 1e-6, `lijn 2 op ${i}`);
  assert.ok(Math.abs((L[i2 + 1] - L[i2]) - 2 * (L[i2 - 1] - L[i2 - 2])) < 1e-6, 'vanaf sample 77 twee keer zo snel');
  // De sprong: op sample 34 klinkt nog alleen het oude, daarna de overvloei.
  assert.ok(Math.abs(L[i3 - 1] - waarde(lijn2(i3 - 1))) < 1e-6, 'sample 33: alleen oud');
  assert.ok(Math.abs(L[i3] - waarde(lijn2(i3))) < 1e-6, 'sample 34: oud × 1, nieuw × 0');
  for (const j of [1, 2, 50, 96, 191, 300, 479]) {
    const a = uitS(j), b = aanS(j);
    const v = a * waarde(lijn2(i3 + j)) + b * waarde(lijn3(i3 + j));
    assert.ok(Math.abs(L[i3 + j] - v) < 1e-6, `overvloei op ${j}: ${L[i3 + j]} ≠ ${v}`);
  }
  for (let i = i3 + SPRONG_N; i < 60 * Q; i++) assert.ok(Math.abs(L[i] - waarde(lijn3(i))) < 1e-6, `lijn 3 op ${i}`);
});

// ---- 3. tempowissel ----------------------------------------------------------

test('3. aansluitende tempowissel (R 1 → 1,05): geen overvloei, geen sprong in de afgeleide', () => {
  const s = sinus(440, SR, 3);
  const k = kernMet(s);
  const P = 0.3, T2 = (100 * Q + 61) / SR, P2 = P + T2;
  planSegmenten(k, [{ T: 0, P, R: 1, speelt: true }, { T: T2, P: P2, R: 1.05, speelt: true }]);
  const { L } = render(k, 200);
  const i2 = 100 * Q + 61;
  const f = grootsteFout(L, i2 - 500, L.length, (i) => s.L(i < i2 ? P + i / SR : P2 + (i / SR - T2) * 1.05));
  assert.ok(f < 2e-4, `uitvoer volgt de lijn zonder overvloei (${f.toExponential(2)})`);
  const rond = grootsteStap(L, i2 - 64, i2 + 64);
  const elders = grootsteStap(L, i2 + 2000, L.length);
  assert.ok(rond <= elders * 1.001, `stap rond de wissel ${rond.toFixed(5)} ≤ elders ${elders.toFixed(5)}`);
});

// ---- 4. sprong ---------------------------------------------------------------

test('4. sprong in P: 10 ms equal-gain overvloeien, geen stap groter dan bij gewoon spelen', () => {
  const s = sinus(440, SR, 3);
  const k = kernMet(s);
  const P = 0.2, T2 = (120 * Q + 5) / SR;
  const P2 = 1.7 + 0.5 / 440;                          // een halve periode verder: tegenfase
  planSegmenten(k, [{ T: 0, P, R: 1, speelt: true }, { T: T2, P: P2, R: 1, speelt: true }]);
  const { L } = render(k, 240);
  const i2 = 120 * Q + 5;
  const oud = (i) => s.L(P + i / SR), nieuw = (i) => s.L(P2 + (i / SR - T2));
  assert.ok(Math.abs(oud(i2) - nieuw(i2)) > 0.3, 'zonder overvloei zou dit een tik zijn');
  const f = grootsteFout(L, i2, i2 + SPRONG_N, (i) => {
    const j = i - i2;
    return uitS(j) * oud(i) + aanS(j) * nieuw(i);
  });
  assert.ok(f < 2e-4, `overvloei: oud leest door (${f.toExponential(2)})`);
  assert.ok(grootsteFout(L, i2 + SPRONG_N, L.length, nieuw) < 2e-4, 'na 10 ms alleen nieuw');
  const gewoon = grootsteStap(L, 1000, i2 - 10);
  const rond = grootsteStap(L, i2 - 10, i2 + SPRONG_N + 10);
  assert.ok(rond <= gewoon * 1.25, `stap in de overvloei ${rond.toFixed(4)} ≤ 1,25 × gewoon ${gewoon.toFixed(4)}`);
});

// ---- 5. start en stop --------------------------------------------------------

test('5. start en stop klikvrij: via 4 ms in en uit, daarna precies stil', () => {
  const s = sinus(440, SR, 3);
  const k = kernMet(s);
  const T1 = (10 * Q + 17) / SR, P = 0.25 + 0.25 / 440;   // begint op een top: zonder inloop een tik
  const T2 = (200 * Q + 90) / SR;
  planSegmenten(k, [{ T: 0, P: 0, R: 1, speelt: false }, { T: T1, P, R: 1, speelt: true }, { T: T2, P: 0, R: 1, speelt: false }]);
  const { L } = render(k, 300);
  const i1 = 10 * Q + 17, i2 = 200 * Q + 90;
  const lijn = (i) => s.L(P + (i / SR - T1));
  assert.equal(grootsteFout(L, 0, i1 + 1, () => 0), 0, 'stil vóór de start');
  assert.ok(grootsteFout(L, i1, i1 + FADE_N, (i) => wFade(i - i1) * lijn(i)) < 2e-4, 'inloop');
  assert.ok(grootsteFout(L, i2, i2 + FADE_N, (i) => uit(i - i2) * lijn(i)) < 2e-4, 'uitloop: leest door');
  assert.equal(grootsteFout(L, i2 + FADE_N, L.length, () => 0), 0, 'daarna precies 0');
  const gewoon = grootsteStap(L, i1 + 1000, i2 - 10);
  assert.ok(grootsteStap(L, i1 - 5, i1 + FADE_N + 5) <= gewoon * 1.1, 'start zonder tik');
  assert.ok(grootsteStap(L, i2 - 5, i2 + FADE_N + 5) <= gewoon * 1.1, 'stop zonder tik');
  // Opnieuw starten vanuit stil, in een ander blok: weer een inloop.
  const k2 = kernMet(s);
  planSegmenten(k2, [{ T: 0, P, R: 1, speelt: true }]);
  const { L: L2 } = render(k2, 5);
  assert.equal(L2[0], 0, 'een start op t = 0 begint ook op 0');
});

// ---- 6. stilte ---------------------------------------------------------------

test('6. ontbrekende pagina = stilte (met uit- en invloeien), buiten het nummer = stilte', () => {
  const s = sinus(440, SR, 4);
  s.paginas[1] = undefined;                            // frames 65536 … 131071
  const k = kernMet(s);
  planSegmenten(k, [{ T: 0, P: 0, R: 1, speelt: true }]);
  const { L } = render(k, Math.ceil(3.5 * SR / Q));
  const marge = Math.ceil(GAT_FADE * SR) + 4;
  const a = PAGINA, b = 2 * PAGINA;
  assert.equal(grootsteFout(L, a + 2, b - 2, () => 0), 0, 'in het gat precies stil: geen herhaling');
  assert.ok(grootsteFout(L, FADE_N + 1, a - 2 * marge, (i) => s.L(i / SR)) < 2e-4, 'vóór het gat de bron');
  assert.ok(grootsteFout(L, b + 2 * marge, 3 * PAGINA, (i) => s.L(i / SR)) < 2e-4, 'na het gat de bron');
  const gewoon = grootsteStap(L, 1000, a - 2 * marge);
  assert.ok(grootsteStap(L, a - 2 * marge, a + 10) <= gewoon * 1.25, 'uitvloeien vóór het gat');
  assert.ok(grootsteStap(L, b - 10, b + 2 * marge) <= gewoon * 1.25, 'invloeien na het gat');

  // Buiten het nummer: plek < 0 en plek ≥ frames / sr.
  const kort = sinus(440, SR, 0.5);
  const k2 = kernMet(kort);
  planSegmenten(k2, [{ T: 0, P: -0.05, R: 1, speelt: true }]);
  const { L: L2 } = render(k2, Math.ceil(0.8 * SR / Q));
  const nul = sampleVan(0.05), eind = sampleVan(0.55);
  assert.equal(grootsteFout(L2, 0, nul, () => 0), 0, 'vóór het begin stil');
  assert.ok(grootsteFout(L2, nul + 1, eind - 2, (i) => kort.L(i / SR - 0.05)) < 2e-4, 'het nummer');
  assert.equal(grootsteFout(L2, eind + 1, L2.length, () => 0), 0, 'na het einde stil');
});

// ---- 7. andere samplerate ----------------------------------------------------

test('7. nummer op 44100 in een context op 48000: toonhoogte en plek kloppen', () => {
  const s = sinus(1000, 44100, 3);
  const k = kernMet(s);
  planSegmenten(k, [{ T: 0, P: 0.1, R: 1, speelt: true }, { T: 1.5, P: 1.6, R: 1.05, speelt: true }]);
  const { L } = render(k, Math.ceil(2.8 * SR / Q));
  const f1 = frequentie(L, 1000, sampleVan(1.5) - 10);
  const f2 = frequentie(L, sampleVan(1.5) + 10, L.length - 10);
  assert.ok(Math.abs(f1 - 1000) < 0.05, `R = 1: ${f1.toFixed(3)} Hz`);
  assert.ok(Math.abs(f2 - 1050) < 0.05, `R = 1,05: ${f2.toFixed(3)} Hz`);
  const fout = grootsteFout(L, FADE_N + 1, sampleVan(1.5), (i) => s.L(0.1 + i / SR));
  assert.ok(fout < 2e-3, `plek in seconden, niet in frames (${fout.toExponential(2)})`);
});

// ---- 9 en 10. herplannen en laat aankomen ------------------------------------

test('9. herplanning op dezelfde lijn is bit voor bit gelijk aan niet herplannen', () => {
  const s = sinus(523.25, 44100, 4);
  const lijnen = [{ T: 0.01, P: 1.3, R: 1.02, speelt: true }];
  const T2 = 0.8;
  lijnen.push({ T: T2, P: 1.3 + (T2 - 0.01) * 1.02, R: 0.97, speelt: true });
  const lijn = (t) => (t < T2 ? lijnen[0] : lijnen[1]);
  const opLijn = (t) => { const l = lijn(t); return { T: t, P: l.P + (t - l.T) * l.R, R: l.R, speelt: true }; };

  const a = kernMet(s);
  planSegmenten(a, lijnen);
  const uitA = render(a, 400);

  const b = kernMet(s);
  planSegmenten(b, lijnen);
  let keer = 0;
  const uitB = render(b, 400, {
    voor: (blok, frame) => {
      if (blok % 3 !== 1) return;
      const nu = frame / SR;
      // Zoals de engine het stuurt: T = "nu" op de hoofdthread, dus een paar ms
      // in het verleden; soms ook vooruit; de tempowissel steeds opnieuw mee.
      const T = nu - (blok % 2 ? 0.004 : -0.002) - 0.0001 * (blok % 7);
      // Vóór de start van de lijn: het hele plan opnieuw (de lijn terugrekenen
      // zou hem eerder laten beginnen, dat is een ander plan).
      const segs = T < lijnen[0].T ? [...lijnen] : [opLijn(T)];
      if (T >= lijnen[0].T && T < T2) segs.push(lijnen[1]);
      planSegmenten(b, segs);
      keer++;
    },
  });
  assert.ok(keer > 100, `${keer} keer herpland`);
  let verschil = 0;
  for (let i = 0; i < uitA.L.length; i++) if (uitA.L[i] !== uitB.L[i] || uitA.R[i] !== uitB.R[i]) verschil++;
  assert.equal(verschil, 0, `${verschil} samples anders`);
});

test('10. T in het verleden: het segment geldt meteen, op de lijn (niet vanaf P)', () => {
  const s = sinus(440, SR, 6);
  const k = kernMet(s);
  // 100 blokken stil, dan komt een start binnen met T 5 ms geleden.
  const { L: stil } = render(k, 100);
  assert.equal(grootsteFout(stil, 0, stil.length, () => 0), 0);
  const f1 = 100 * Q, T1 = f1 / SR - 0.005, P1 = 2;
  planSegmenten(k, [{ T: T1, P: P1, R: 1, speelt: true }]);
  const { L } = render(k, 200, { start: f1 });
  const lijn1 = (i) => s.L(P1 + ((f1 + i) / SR - T1));
  assert.ok(grootsteFout(L, 0, FADE_N, (i) => wFade(i) * lijn1(i)) < 2e-4, 'inloop op de lijn, vanaf het eerste sample');
  assert.ok(grootsteFout(L, FADE_N, L.length, lijn1) < 2e-4, 'op de lijn, 5 ms verder dan P');
  // Tijdens het spelen een sprong met T 4 ms geleden: overvloeien naar de lijn.
  const f2 = f1 + 200 * Q, T2 = f2 / SR - 0.004, P2 = 4.5;
  planSegmenten(k, [{ T: T2, P: P2, R: 1.1, speelt: true }]);
  const { L: M } = render(k, 100, { start: f2 });
  const lijn2 = (i) => s.L(P2 + ((f2 + i) / SR - T2) * 1.1);
  const fv = grootsteFout(M, 0, SPRONG_N, (i) => uitS(i) * lijn1(200 * Q + i) + aanS(i) * lijn2(i));
  assert.ok(fv < 2e-4, `overvloei van de oude lijn naar de nieuwe (${fv.toExponential(2)})`);
  assert.ok(grootsteFout(M, SPRONG_N, M.length, lijn2) < 2e-4, 'daarna op de nieuwe lijn');
  // Twee segmenten tegelijk in het verleden: alleen het laatste telt (geen sprong heen en terug).
  const f3 = f2 + 100 * Q, nu = f3 / SR;
  const op = (t) => P2 + (t - T2) * 1.1;
  planSegmenten(k, [{ T: nu - 0.01, P: 9, R: 1, speelt: true }, { T: nu - 0.002, P: op(nu - 0.002), R: 1.1, speelt: true }]);
  const { L: N } = render(k, 50, { start: f3 });
  assert.ok(grootsteFout(N, 0, N.length, (i) => s.L(op((f3 + i) / SR))) < 2e-4, 'de lijn loopt gewoon door');
});

// ---- de worklet --------------------------------------------------------------

test('worklet: laad/plan/leeg, fout één keer melden en stil, stop = process() false', async () => {
  let Klasse = null;
  globalThis.sampleRate = SR;
  globalThis.currentFrame = 0;
  globalThis.AudioWorkletProcessor = class {
    constructor() { const uit = []; this.port = { onmessage: null, uit, postMessage: (m) => uit.push(m) }; }
  };
  globalThis.registerProcessor = (naam, k) => { assert.equal(naam, 'varve-speler'); Klasse = k; };
  await import('../src/audio/speler-worklet.js');
  const w = new Klasse();
  const zend = (m) => w.port.onmessage({ data: m });
  const uit = [[new Float32Array(Q), new Float32Array(Q)]];
  const blok = () => { const r = w.process([], uit); globalThis.currentFrame += Q; return r; };
  const s = sinus(440, SR, 1);
  zend({ type: 'laad', sr: s.sr, frames: s.frames, paginas: s.paginas });
  zend({ type: 'plan', segmenten: [{ T: 0, P: 0.1, R: 1, speelt: true }] });
  for (let i = 0; i < 5; i++) assert.equal(blok(), true);
  assert.ok(Math.abs(uit[0][0][100] - s.L(0.1 + (4 * Q + 100) / SR)) < 2e-4, 'speelt op currentFrame');
  // Een kapot bericht: één melding, daarna stilte.
  zend({ type: 'laad', sr: SR });                          // geen frames: laadBron gooit
  zend({ type: 'plan', segmenten: [{ T: 0, P: 0.1, R: 1, speelt: true }] });
  blok(); blok();
  assert.equal(w.port.uit.filter((m) => m.type === 'fout').length, 1, 'één melding');
  assert.ok(uit[0][0].every((x) => x === 0) && uit[0][1].every((x) => x === 0), 'stil na een fout');
  // Een nieuwe laad herstelt.
  zend({ type: 'laad', sr: s.sr, frames: s.frames, paginas: sinus(440, SR, 1).paginas });
  zend({ type: 'plan', segmenten: [{ T: 0, P: 0.2, R: 1, speelt: true }] });
  blok(); blok();
  assert.ok(uit[0][0].some((x) => x !== 0), 'speelt weer');
  // Een fout ín process(): gevangen, gemeld, stil.
  w.kern.bronPag = null;
  assert.equal(blok(), true);
  assert.equal(w.port.uit.filter((m) => m.type === 'fout').length, 2);
  assert.ok(uit[0][0].every((x) => x === 0), 'stil na een fout in process()');
  zend({ type: 'stop' });
  assert.equal(blok(), false, 'na stop geeft process() false');
  assert.equal(w.port.onmessage, null);
});

// ---- speler.js -----------------------------------------------------------------

test('speler.js: één addModule per context, kopieën, transfer, positie(t), fouten, vernietig', async () => {
  const gestuurd = [];
  globalThis.AudioWorkletNode = class {
    constructor(ctx, naam, opties) {
      this.naam = naam; this.opties = opties; this.verbonden = true;
      this.port = { onmessage: null, postMessage: (m, transfer) => gestuurd.push({ m: structuredClone(m), transfer }), close() { this.dicht = true; } };
    }
    disconnect() { this.verbonden = false; }
  };
  let modules = 0;
  const ctx = { currentTime: 0, audioWorklet: { addModule: async (url) => { modules++; assert.match(url, /speler-worklet\.js$/); } } };
  const { Speler, paginasUit } = await import('../src/audio/speler.js');
  const [a, b] = await Promise.all([Speler.maak(ctx), Speler.maak(ctx)]);
  await Speler.maak(ctx);
  assert.equal(modules, 1, 'worklet één keer geladen');
  assert.equal(a.node.naam, 'varve-speler');
  assert.deepEqual(a.node.opties.outputChannelCount, [2]);

  // paginasUit: mono wordt stereo, pagina's van PAGINA frames, elk een eigen buffer.
  const mono = new Float32Array(PAGINA + 10).map((_, i) => (i % 3) / 4 - 0.25);
  mono[5] = 2; mono[6] = -2;
  const pu = paginasUit({ sr: 44100, kanalen: [mono] });
  assert.equal(pu.frames, PAGINA + 10);
  assert.equal(pu.paginas.length, 2);
  assert.equal(pu.paginas[1].length, 20);
  assert.equal(pu.paginas[0][10], pu.paginas[0][11], 'mono op beide kanalen');
  assert.equal(pu.paginas[0][10], 32767, 'geklemd op 1');
  assert.equal(pu.paginas[0][12], -32768, 'geklemd op −1');
  assert.notEqual(pu.paginas[0].buffer, pu.paginas[1].buffer);
  const ab = { sampleRate: 48000, numberOfChannels: 2, length: 4,
    getChannelData: (c) => Float32Array.from(c ? [0, -0.5, 0, 0] : [0.5, 0, 0, 0]) };
  const pb = paginasUit(ab);
  assert.equal(pb.sr, 48000);
  assert.deepEqual([...pb.paginas[0].slice(0, 4)], [q16(0.5), 0, 0, -16384]);

  a.laad(pu);
  const laad = gestuurd.at(-1);
  assert.equal(laad.m.type, 'laad');
  assert.equal(laad.transfer.length, 2, 'beide buffers overgedragen');

  // plan: gewone kopieën, getoetst; positie() met dezelfde formule.
  const segs = [{ T: 1, P: 10, R: 1.5, speelt: true, extra: () => 1 }, { T: 3, P: 13, R: 1, speelt: false }];
  a.plan(segs);
  assert.deepEqual(gestuurd.at(-1).m, { type: 'plan', segmenten: [{ T: 1, P: 10, R: 1.5, speelt: true }, { T: 3, P: 13, R: 1, speelt: false }] });
  assert.equal(a.positie(0.5), 10, 'vóór het eerste segment: zijn P');
  assert.equal(a.positie(2), 11.5);
  assert.equal(a.positie(4), 13, 'stil: P');
  a.plan([{ T: 2, P: 20, R: 1, speelt: true }]);         // vervangt vanaf 2
  assert.equal(a.positie(1.5), 10.75, 'wat vóór 2 gold blijft');
  assert.equal(a.positie(5), 23, 'het segment op 3 is vervangen');
  assert.throws(() => a.plan([{ T: 0, P: 0, R: 0, speelt: true }]), RangeError);
  assert.throws(() => a.plan([{ T: 2, P: 0, R: 1, speelt: true }, { T: 1, P: 0, R: 1, speelt: true }]), RangeError);
  assert.throws(() => a.plan([{ T: NaN, P: 0, R: 1, speelt: true }]), TypeError);
  assert.throws(() => a.plan(new Array(MAX_SEGMENTEN + 1).fill({ T: 0, P: 0, R: 1, speelt: true })), RangeError);
  assert.throws(() => a.laad({ sr: 48000, kanalen: 1, frames: 10, paginas: [] }), RangeError);

  // Fouten: van de worklet en processorerror naar onfout.
  const fouten = [];
  a.onfout = (m) => fouten.push(m);
  a.node.port.onmessage({ data: { type: 'fout', bericht: 'kapot' } });
  a.node.onprocessorerror({});
  assert.equal(fouten.length, 2);
  assert.match(fouten[0], /kapot/);

  a.leeg();
  assert.equal(gestuurd.at(-1).m.type, 'leeg');
  assert.equal(a.positie(5), null, 'leeg: geen plek');
  a.vernietig();
  a.vernietig();
  assert.equal(gestuurd.filter((g) => g.m.type === 'stop').length, 1, 'stop één keer');
  assert.equal(a.node.verbonden, false);
  assert.throws(() => a.plan([{ T: 0, P: 0, R: 1, speelt: true }]), /vernietigd/);
  b.vernietig();
});

// ---- 8. afvalvrij (als laatste: de rest heeft dan niets meer nodig) -------------

test('8. afvalvrij: 20.000 blokken met wisselende plannen, 0 GC tijdens het renderen', () => {
  const s = sinus(440, 44100, 9);
  s.paginas[2] = undefined;                               // ook het gat-pad
  const s2 = sinus(330, SR, 5);
  const k = kernMet(s);
  const L = new Float32Array(Q), R = new Float32Array(Q);
  let zaad = 12345;
  const toeval = () => { zaad ^= zaad << 13; zaad ^= zaad >>> 17; zaad ^= zaad << 5; return (zaad >>> 0) / 4294967296; };
  let frame = 0, plek = 0.3, tempo = 1;
  const VENSTER = 400;

  /** Plannen voor het volgende venster: sprongen, tempo, stop, start, T in het verleden. */
  function plannen(venster) {
    const nu = frame / SR, lengte = VENSTER * Q / SR;
    if (venster % 9 === 4) { laadBron(k, s2.sr, s2.frames, s2.paginas); plek = 0.5; }
    else if (venster % 9 === 8) { laadBron(k, s.sr, s.frames, s.paginas); plek = 0.5; }
    else if (venster % 13 === 6) leegBron(k);
    const segs = [];
    let T = nu - 0.003;                                   // de eerste ligt in het verleden
    for (let j = 0; j < 8; j++) {
      const soort = toeval();
      if (soort < 0.3) plek = 0.2 + toeval() * 4;          // sprong
      else if (soort < 0.6) { plek += 0; tempo = 0.5 + toeval() * 1.5; } // tempo (sluit aan)
      segs.push({ T, P: plek, R: tempo, speelt: soort < 0.9 });
      const dt = toeval() * lengte / 8 + 0.0005;
      if (soort < 0.9) plek += dt * tempo;
      T += dt;
    }
    planSegmenten(k, segs);
  }
  function draai(blokken) {
    for (let b = 0; b < blokken; b++) { k.klok[0] = frame; renderBlok(k, L, R, Q); frame += Q; }
  }

  // Opwarmen: tot V8 het pad geoptimaliseerd heeft maakt de interpreter van elke double een object.
  for (let v = 0; v < 30; v++) { plannen(v); draai(VENSTER); }

  // Heapgroei per venster: de meting zelf (memoryUsage, GCProfiler) kost ~256
  // bytes, en de eerste vensters na het opwarmen ook zonder renderBlok ~3 kB
  // (gemeten met een lege lus). Een echte allocatie per blok (≥ 16 bytes) is
  // ≥ 6400 bytes per venster: de MEDIAAN moet daar ver onder blijven.
  const groei = [];
  let gcs = 0, blokken = 0;
  for (let v = 30; blokken < 20000; v++) {
    plannen(v);
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const h0 = process.memoryUsage().heapUsed;
    draai(VENSTER);
    const h1 = process.memoryUsage().heapUsed;
    gcs += prof.stop().statistics.length;
    groei.push(h1 - h0);
    blokken += VENSTER;
  }
  assert.equal(gcs, 0, `${gcs} GC's tijdens ${blokken} blokken`);
  groei.sort((a, b) => a - b);
  const mediaan = groei[groei.length >> 1];
  assert.ok(mediaan <= 512, `heapgroei per venster van ${VENSTER} blokken: mediaan ${mediaan} bytes`);
});
