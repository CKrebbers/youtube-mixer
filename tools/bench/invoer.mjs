// Het invoerpad zonder browser: wat kost één MIDI-bericht in parseMessage + Mapping.handle,
// en wat kost één LED-tik aan mapping-werk (actieveRegels + resolveTarget per regel)?
// Met de echte standaardmapping (mappings/apc40mk2.json), echte Lagen, een nep-bus
// (invoke doet niets, read geeft een vaste stand). Zie docs/verslagen/2026-10-14/controller-invoer.md.
//
// Gebruik:  node tools/bench/invoer.mjs [wortel]      wortel = een andere versie (bv. een uitgepakte git archive)
//           node tools/bench/invoer.mjs --vergelijk <wortel-voor> [<wortel-na>]
//
// Uitvoer per geval: µs per bericht (mediaan van 7 rondes) en bytes afval per bericht (heap-groei met gc uit).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);

async function meet(wortel) {
  const imp = (p) => import(pathToFileURL(join(wortel, p)).href);
  const { Mapping } = await imp('src/control/mapping.js');
  const { Lagen } = await imp('src/control/lagen.js');
  const { parseMessage } = await imp('src/control/midi.js');
  const { resolveTarget } = await imp('src/control/mapping.js');
  const doc = JSON.parse(readFileSync(join(wortel, 'mappings/apc40mk2.json'), 'utf8'));
  const lagen = new Lagen();
  let stand = 0.5;
  const m = new Mapping({ read: () => stand, invoke: (id, v) => { if (typeof v === 'number') stand = v; }, vars: () => ({ focus: 1 }), lagen: () => lagen.actief() });
  m.laadStandaard(doc);

  const N = 20000;
  const berichten = {
    fader: Array.from({ length: N }, (_, i) => [0xb0 | (i % 8), 7, (i * 3) % 128]),
    ringknop: Array.from({ length: N }, (_, i) => [0xb0, 48 + (i % 8), (i * 5) % 128]),
    deviceknop: Array.from({ length: N }, (_, i) => [0xb0, 16 + (i % 8), (i * 5) % 128]),
    pad: Array.from({ length: N }, (_, i) => (i % 2 ? [0x80, 32 + ((i >> 1) % 8), 0] : [0x90, 32 + ((i >> 1) % 8), 127])),
  };
  const uit = {};
  const ronde = (fn, n) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) fn(i);
    return Number(process.hrtime.bigint() - t0) / 1000 / n;   // µs per stuk
  };
  const mediaan = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const afval = (fn, n) => {
    globalThis.gc?.();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < n; i++) fn(i);
    const h1 = process.memoryUsage().heapUsed;
    return Math.max(0, Math.round((h1 - h0) / n));
  };
  for (const [naam, lijst] of Object.entries(berichten)) {
    const bytes = lijst.map((b) => new Uint8Array(b));
    const fn = (i) => m.handle(parseMessage(bytes[i % N]));
    for (let w = 0; w < 3; w++) ronde(fn, N);
    uit[naam] = { us: Math.round(mediaan(Array.from({ length: 7 }, () => ronde(fn, N))) * 100) / 100, bytes: afval(fn, 2000) };
  }
  // Met shift vast en in een open mapje (grid-modus klank): dezelfde pads.
  lagen.zet('grid', 'klank');
  m.handle(parseMessage(new Uint8Array([0x90, 98, 127])));
  {
    const bytes = berichten.pad.map((b) => new Uint8Array(b));
    const fn = (i) => m.handle(parseMessage(bytes[i % N]));
    for (let w = 0; w < 3; w++) ronde(fn, N);
    uit['pad (shift, mapje klank)'] = { us: Math.round(mediaan(Array.from({ length: 7 }, () => ronde(fn, N))) * 100) / 100, bytes: afval(fn, 2000) };
  }
  m.handle(parseMessage(new Uint8Array([0x80, 98, 0])));
  lagen.zet('grid', 'hotcues');
  // Wat de LED-laag per tik aan de mapping vraagt: de regels van nu, en per regel het doel.
  {
    const vars = { focus: 1 };
    const fn = () => { let n = 0; for (const r of m.actieveRegels().values()) { n += resolveTarget(r.action, vars).length; } return n; };
    for (let w = 0; w < 20; w++) fn();
    const us = mediaan(Array.from({ length: 7 }, () => ronde(fn, 200)));
    uit['LED-tik: actieveRegels + resolveTarget'] = { us: Math.round(us * 100) / 100, bytes: afval(fn, 200) };
  }
  return uit;
}

const tabel = (rijen) => rijen.map((r) => `| ${r.join(' | ')} |`).join('\n');
if (args[0] === '--vergelijk') {
  const voorW = resolve(args[1]), naW = resolve(args[2] || HIER);
  const voor = await meet(voorW), na = await meet(naW);
  console.log(tabel([['geval', 'vóór µs', 'na µs', 'vóór bytes', 'na bytes'], ['---', '---', '---', '---', '---'],
    ...Object.keys(voor).map((k) => [k, voor[k].us, na[k]?.us, voor[k].bytes, na[k]?.bytes])]));
} else {
  const uit = await meet(resolve(args[0] || HIER));
  for (const [k, v] of Object.entries(uit)) console.log(`${k.padEnd(42)} ${String(v.us).padStart(8)} µs  ${String(v.bytes).padStart(6)} bytes`);
}
