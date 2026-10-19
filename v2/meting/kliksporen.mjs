/**
 * Maakt de kliksporen voor de vergelijking met djay (M13) in v2/meting/djay/:
 *   a-124.wav     lage klik (150 Hz), 124 bpm, eerste tel op 0,30 s, "1" harder
 *   b-128.wav     hoge klik (3 kHz),  128 bpm, eerste tel op 0,11 s
 *   c-zwerft.wav  hoge klik, rond 128 bpm maar het tempo zwerft ±0,4% met een periode van
 *                 40 s (zoals een live opname): blijft sync erop, of loopt hij weg?
 *   grids.json    de echte tellen per spoor (de waarheid, ook voor een v2-grid)
 * 3 minuten elk, 48 kHz stereo 16-bit. Deterministisch.
 *
 *   node v2/meting/kliksporen.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP = join(dirname(fileURLToPath(import.meta.url)), 'djay');
const SR = 48000, DUUR = 180;

function spoor(tellen, f, luid = (k) => (k % 4 === 0 ? 0.6 : 0.4)) {
  const n = SR * DUUR, x = new Float32Array(n);
  tellen.forEach((t, k) => {
    const a = Math.round(t * SR);
    for (let i = 0; i < 0.03 * SR && a + i < n; i++) x[a + i] += luid(k) * Math.sin(2 * Math.PI * f * i / SR) * Math.exp(-i / (0.006 * SR));
  });
  return x;
}

function wavStereo(x) {
  const buf = Buffer.alloc(44 + x.length * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + x.length * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(x.length * 4, 40);
  for (let i = 0; i < x.length; i++) { const v = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))); buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4); }
  return buf;
}

const regelmatig = (bpm, anker) => { const t = []; for (let k = 0; anker + k * 60 / bpm < DUUR - 0.1; k++) t.push(anker + k * 60 / bpm); return t; };
function zwervend(bpm, anker) {
  // tempo(t) = bpm·(1 + 0,004·sin(2πt/40)): tellen door de fase op te tellen.
  const t = [anker]; let fase = 0, x = anker; const dt = 1e-4;
  while (x < DUUR - 0.1) { fase += (bpm / 60) * (1 + 0.004 * Math.sin(2 * Math.PI * x / 40)) * dt; x += dt; if (fase >= 1) { fase -= 1; t.push(x); } }
  return t;
}

mkdirSync(MAP, { recursive: true });
const A = regelmatig(124, 0.30), B = regelmatig(128, 0.11), C = zwervend(128, 0.11);
writeFileSync(join(MAP, 'a-124.wav'), wavStereo(spoor(A, 150)));
writeFileSync(join(MAP, 'b-128.wav'), wavStereo(spoor(B, 3000)));
writeFileSync(join(MAP, 'c-zwerft.wav'), wavStereo(spoor(C, 3000)));
// Grids voor v2: a en b exact (één stuk); c als tempokaart van stukken van 4 tellen.
const kaart = (tellen) => tellen.filter((_, i) => i % 4 === 0 && i + 4 < tellen.length).map((t, j) => ({ van: t, bpm: 60 * 4 / (tellen[j * 4 + 4] - t), anker: t, maat: t }));
writeFileSync(join(MAP, 'grids.json'), JSON.stringify({
  'a-124': { stukken: [{ van: 0, bpm: 124, anker: 0.30, maat: 0.30 }], slot: true, tellen: A.length },
  'b-128': { stukken: [{ van: 0, bpm: 128, anker: 0.11, maat: 0.11 }], slot: true, tellen: B.length },
  'c-zwerft': { stukken: kaart(C), slot: true, tellen: C.length },
}));
console.log(`kliksporen in ${MAP}: a ${A.length}, b ${B.length}, c ${C.length} tellen`);
