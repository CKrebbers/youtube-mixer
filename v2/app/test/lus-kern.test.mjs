/**
 * Een lus in de afspeelkern: terugvouwen, de naad (LOOP_NAAD lineair naar wat vóór la staat),
 * aan- en uitzetten zonder sprong, en lus + tempo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakKern, laadBron, planSegmenten, renderBlok, PAGINA, LOOP_NAAD } from '../src/audio/speler-kern.js';

const SR = 48000, Q = 128;
const q16 = (x) => Math.round(x * 32767);
/** Een bron uit een functie van de tijd (s) -> pagina's. */
function bron(fn, sec) {
  const frames = Math.round(sec * SR), paginas = [];
  for (let p = 0; p * PAGINA < frames; p++) {
    const n = Math.min(PAGINA, frames - p * PAGINA), a = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) { const v = q16(fn((p * PAGINA + i) / SR)); a[2 * i] = v; a[2 * i + 1] = v; }
    paginas.push(a);
  }
  return { frames, paginas, fn };
}
function render(k, blokken) {
  const L = new Float32Array(blokken * Q), l = new Float32Array(Q), r = new Float32Array(Q);
  for (let b = 0; b < blokken; b++) { k.klok[0] = b * Q; renderBlok(k, l, r, Q); L.set(l, b * Q); }
  return L;
}
const waar = (f) => q16(f) / 32767 * 32767 / 32768;   // de Int16-waarde zoals de kern hem schaalt

test('terugvouwen: na lb klinkt la, sample voor sample (buiten de naad)', () => {
  const b = bron((t) => 0.5 * Math.sin(2 * Math.PI * 220 * t), 4);
  const k = maakKern(SR);
  laadBron(k, SR, b.frames, b.paginas);
  const la = 1.0, lb = 1.5;
  planSegmenten(k, [{ T: 0, P: 0.9, R: 1, speelt: true, la, lb }]);
  const L = render(k, Math.round(2.2 * SR / Q));
  const plek = (i) => { const p = 0.9 + i / SR; return p >= lb ? la + ((p - la) % (lb - la)) : p; };
  let fout = 0;
  for (let i = 400; i < L.length; i++) {
    const p = plek(i), inNaad = ((p - la) % (lb - la)) > (lb - la) - LOOP_NAAD - 1 / SR;
    if (inNaad) continue;
    fout = Math.max(fout, Math.abs(L[i] - b.fn(p)));
  }
  assert.ok(fout < 2e-4, `buiten de naad volgt hij de teruggevouwen plek (${fout.toExponential(2)})`);
});

test('de naad: geen tik bij het terugvouwen (stap ≤ 1,25× een gewone stap), ook als einde en begin ver uiteen liggen', () => {
  // Een toon met een trage golf eronder: einde en begin liggen ver uit elkaar (zonder naad een sprong).
  const b = bron((t) => 0.4 * Math.sin(2 * Math.PI * 110 * t) + 0.4 * Math.sin(2 * Math.PI * 0.9 * t), 4);
  const k = maakKern(SR);
  laadBron(k, SR, b.frames, b.paginas);
  planSegmenten(k, [{ T: 0, P: 1.0, R: 1, speelt: true, la: 1.0, lb: 1.5 }]);
  const L = render(k, Math.round(2 * SR / Q));
  const stap = (van, tot) => { let m = 0; for (let i = van + 1; i < tot; i++) m = Math.max(m, Math.abs(L[i] - L[i - 1])); return m; };
  const naad = Math.round(0.5 * SR);
  const gewoon = stap(2000, naad - 2 * LOOP_NAAD * SR);
  const rond = stap(naad - LOOP_NAAD * SR - 10, naad + 50);
  assert.ok(rond <= gewoon * 1.25, `stap rond de naad ${rond.toFixed(4)} ≤ 1,25 × ${gewoon.toFixed(4)}`);
  // Zonder naad zou dit een tik zijn.
  assert.ok(Math.abs(b.fn(1.5 - 1e-5) - b.fn(1.0)) > 0.3);
});

test('lus vanaf 0: geen naad (er staat niets vóór), wel terugvouwen', () => {
  const b = bron((t) => 0.5 * Math.sin(2 * Math.PI * 100 * t), 2);
  const k = maakKern(SR);
  laadBron(k, SR, b.frames, b.paginas);
  planSegmenten(k, [{ T: 0, P: 0, R: 1, speelt: true, la: 0, lb: 0.25 }]);
  const L = render(k, Math.round(0.6 * SR / Q));
  const i = Math.round(0.3 * SR);
  assert.ok(Math.abs(L[i] - b.fn(0.05)) < 2e-4);
});

test('een lus aanzetten waar je bent en weer uit: geen sprong, geen overvloei', () => {
  const b = bron((t) => 0.5 * Math.sin(2 * Math.PI * 330 * t), 4);
  const k = maakKern(SR);
  laadBron(k, SR, b.frames, b.paginas);
  const T1 = 0.5, T2 = 1.4;
  // Op T1 een lus [1.4, 1.9) (de plek is 1.5: binnen de lus); op T2 eraf: plek = waar hij in de lus is.
  const inLus = (t) => { const p = 1.0 + t; return 1.4 + ((p - 1.4) % 0.5); };
  planSegmenten(k, [{ T: 0, P: 1.0, R: 1, speelt: true }, { T: T1, P: 1.5, R: 1, speelt: true, la: 1.4, lb: 1.9 }, { T: T2, P: inLus(T2), R: 1, speelt: true }]);
  const L = render(k, Math.round(2 * SR / Q));
  const plek = (i) => { const t = i / SR; if (t < T2) return t < T1 ? 1 + t : inLus(t); return inLus(T2) + (t - T2); };
  let fout = 0;
  for (let i = 400; i < L.length; i++) {
    const p = plek(i);
    const t = i / SR;
    if (t >= T1 && t < T2 && ((p - 1.4) % 0.5) > 0.5 - LOOP_NAAD - 1e-4) continue;   // de naad zelf
    fout = Math.max(fout, Math.abs(L[i] - b.fn(p)));
  }
  assert.ok(fout < 2e-4, `aan en uit zonder overvloei (${fout.toExponential(2)})`);
});

test('lus op een ander tempo: R = 1,1 vouwt op dezelfde plekken', () => {
  const b = bron((t) => 0.5 * Math.sin(2 * Math.PI * 200 * t), 4);
  const k = maakKern(SR);
  laadBron(k, SR, b.frames, b.paginas);
  planSegmenten(k, [{ T: 0, P: 2.0, R: 1.1, speelt: true, la: 2.0, lb: 2.3 }]);
  const L = render(k, Math.round(1.5 * SR / Q));
  let fout = 0;
  for (let i = 400; i < L.length; i++) {
    const r = ((i / SR) * 1.1) % 0.3;
    if (r > 0.3 - LOOP_NAAD - 1e-4) continue;
    fout = Math.max(fout, Math.abs(L[i] - b.fn(2.0 + r)));
  }
  assert.ok(fout < 3e-4, `${fout.toExponential(2)}`);
});
