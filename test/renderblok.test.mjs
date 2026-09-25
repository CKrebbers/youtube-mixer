// Het audiopad zonder afval (ROADMAP 22): de ECHTE worklet (stream-lezer.js,
// dus ook renderBlok uit de streamkern) in een nagebouwde
// AudioWorkletGlobalScope, acht decks tegelijk, blok voor blok.
//
// Waarom: een garbage collection draait op de audiothread zelf, en een pauze
// daar is een tik. Vóór de ombouw maakte renderBlok ~12,7 kB afval per blok.
//
// Hoe gemeten, zonder dat het wankelt onder belasting: geen tijd, maar de
// heap. Na opwarmen (V8 moet het pad geoptimaliseerd hebben; tot dan maakt de
// interpreter van elke double een object) een venster van duizenden blokken:
// gc, heap lezen, blokken draaien, heap weer lezen, en v8.GCProfiler zegt of
// er tussendoor een GC was. Onder belasting is V8 soms later klaar met
// optimaliseren; dan telt het volgende venster. Een echte allocatie per blok
// haalt in GEEN venster de drempel (12 000 blokken × ≥ 12 bytes = 140 kB).
//
// Draai met: node test/renderblok.test.mjs
import v8 from 'node:v8';
import vm from 'node:vm';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

// ---- nagebouwde AudioWorkletGlobalScope ------------------------------------

const SR = 48000, Q = 128, DECKS = 8;
let Lezer = null;
globalThis.sampleRate = SR;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    const uit = [];
    this.port = { onmessage: null, uit, postMessage: (m) => { uit.push(m); } };
  }
};
globalThis.registerProcessor = (_naam, klasse) => { Lezer = klasse; };
await import('../src/engine/stream-lezer.js');
const { PAGINA } = await import('../src/engine/stream-kern.js');

// ---- materiaal: 20 s, twee tonen en ruis, 16 bit stereo ----------------------

const DUUR = 20;
const paginas = new Map();
{
  const n = DUUR * SR;
  const pcm = new Int16Array(n * 2);
  let x = 20260925;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const ruis = ((x >>> 8) / 16777216 - 0.5) * 0.1;
    pcm[2 * i] = Math.round((0.4 * Math.sin(2 * Math.PI * 55 * i / SR) + 0.2 * Math.sin(2 * Math.PI * 331 * i / SR) + ruis) * 32767);
    pcm[2 * i + 1] = Math.round((0.3 * Math.sin(2 * Math.PI * 82.5 * i / SR) + 0.25 * Math.sin(2 * Math.PI * 517 * i / SR) - ruis) * 32767);
  }
  for (let p = 0; p * PAGINA * 2 < pcm.length; p++) paginas.set(p, pcm.slice(p * PAGINA * 2, (p + 1) * PAGINA * 2));
}
const GAT = 6;                                         // deze pagina ontbreekt: een gat
const grens = (GAT * PAGINA) / SR;                     // waar het gat begint, in s

/**
 * Acht decks die samen elk pad raken, zonder berichten: exact (rate 1 op een
 * heel frame), cubisch, loops met hun naad (kort, krom, vanaf 1 ms), een loop
 * die tegen het gat aan loopt (uit- en invloeien bij elke herhaling), een
 * deck dat voorbij het trackeinde staat en een deck dat stilstaat.
 */
const DECK_SEGS = [
  { P: 1, R: 1, loop: null },
  { P: 2.5, R: 1.0004, loop: null },
  { P: 4, R: 0.97, loop: { start: 4, end: 4.121 } },
  { P: 0.001, R: 1.08, loop: { start: 0.001, end: 0.0615 } },
  { P: grens - 0.2, R: 1.16, loop: { start: grens - 0.2, end: grens + 0.05 } },
  { P: DUUR - 0.05, R: 1, loop: null },                 // na 50 ms voorbij het einde
  { P: 9, R: 1, loop: null, speelt: false },
  { P: 12, R: 0.92, loop: { start: 12, end: 12.3017 } },
];

function maakDecks() {
  const decks = [], uits = [];
  for (let d = 0; d < DECKS; d++) {
    const n = new Lezer();
    n.port.onmessage({ data: { type: 'bron', duur: DUUR, sr: SR } });
    for (const [i, data] of paginas) if (i !== GAT) n.port.onmessage({ data: { type: 'pagina', i, data } });
    const s = DECK_SEGS[d];
    n.port.onmessage({ data: { type: 'segment', id: 1, seg: { T: 0, P: s.P, R: s.R, loop: s.loop, speelt: s.speelt ?? true } } });
    decks.push(n);
    uits.push([[new Float32Array(Q), new Float32Array(Q)]]);
  }
  return { decks, uits, blok: 0 };
}

/**
 * Berichten vooraf gemaakt (het harnas mag in het venster zelf niets
 * aanmaken): om de zoveel blokken per deck een nieuw segment, zoals de
 * hoofdthread ze stuurt, zodat ook de overgang (vorig/wisselT) meedoet.
 */
function maakBerichten(van, stappen, elke) {
  const lijst = [];
  for (let d = 0; d < DECKS; d++) {
    const ev = [];
    for (let b = van + 7 * d + 1; b < van + stappen; b += elke) {
      const s = DECK_SEGS[(d + b) % DECKS];
      ev.push({ blok: b, event: { data: { type: 'segment', id: b, seg: { T: (b * Q) / SR - 0.002, P: s.P + (b % 5) * 0.37, R: s.R, loop: s.loop, speelt: (b % 3) !== 0 } } } });
    }
    lijst.push(ev);
  }
  return lijst;
}

const LEEG = [];
const wijzer = new Int32Array(DECKS);
let h = 0;

/** `stappen` keer acht decks één blok verder; met `hash` een FNV-1a over de bits. */
function draai(w, stappen, berichten = null, hash = false) {
  wijzer.fill(0);
  for (let s = 0; s < stappen; s++, w.blok++) {
    globalThis.currentFrame = w.blok * Q;
    for (let d = 0; d < DECKS; d++) {
      if (berichten) {
        const ev = berichten[d];
        let k = wijzer[d];
        while (k < ev.length && ev[k].blok === w.blok) w.decks[d].port.onmessage(ev[k++].event);
        wijzer[d] = k;
      }
      w.decks[d].process(LEEG, w.uits[d], null);
      if (hash) {
        for (let c = 0; c < 2; c++) {
          const u = new Uint32Array(w.uits[d][0][c].buffer);
          for (let i = 0; i < Q; i++) h = Math.imul(h ^ u[i], 0x01000193);
        }
      }
    }
  }
}

/** Heapgroei (bytes) en aantal GC's over één venster. */
function venster(w, stappen, berichten = null) {
  globalThis.gc();
  globalThis.gc();
  const prof = new v8.GCProfiler();
  prof.start();
  const h0 = process.memoryUsage().heapUsed;
  draai(w, stappen, berichten);
  const h1 = process.memoryUsage().heapUsed;
  const gcs = prof.stop().statistics.length;
  return { bytes: h1 - h0, gcs };
}

// ---- 1. uitvoer: bit voor bit die van vóór de ombouw -------------------------

console.log('uitvoer');
{
  const w = maakDecks();
  h = 0x811c9dc5 | 0;
  draai(w, 3000, maakBerichten(0, 3000, 53), true);
  const hash = (h >>> 0).toString(16).padStart(8, '0');
  const eindes = w.decks.reduce((n, d) => n + d.port.uit.filter((m) => m.type === 'einde').length, 0);
  // Gemeten met de streamkern en worklet van 47412e4, vóór de ombouw zonder
  // afval. Verandert het geluid bewust (een rem, andere interpolatie), dan
  // hier de nieuwe hash; zonder die bedoeling is een andere hash een fout.
  ok(`acht decks, 3000 blokken met overgangen, naden, een gat en het einde: hash ${hash} = die van vóór de ombouw`, hash === '9dfaeb73');
  ok(`trackeinde gemeld (${eindes}x), één keer per segment`, eindes > 0);

  // Het kladblok ontstaat bij het eerste blok. Een eerste blok van 0 frames
  // (een vers exemplaar van de module, dus nog geen klad) mag niet vallen.
  const vers = await import('../src/engine/stream-kern.js?leeg');
  let r = 'fout';
  try {
    r = vers.renderBlok({ seg: { T: 0, P: 1, R: 1, loop: null, speelt: true }, paginas, uit: [new Float32Array(0), new Float32Array(0)],
      frames: 0, t0: 0, ctxRate: SR, trackRate: SR, duur: DUUR });
  } catch (e) { r = e.message; }
  ok('een eerste blok van 0 frames geeft niets en valt niet', r === null);
}

// ---- 2. afval ------------------------------------------------------------------

console.log('\nafval');
{
  const w = maakDecks();
  draai(w, 4000, maakBerichten(0, 4000, 41));          // opwarmen, met alle paden en overgangen

  const STAPPEN = 1500, BLOKKEN = STAPPEN * DECKS;
  // Bytes per venster. De meting zelf (het object van memoryUsage) is ~250;
  // één object van 16 bytes per loop-herhaling (~100 in een venster) zit er
  // al boven. Gemeten 24 sep: 256.
  const DREMPEL = 1024;
  const beter = (a, b) => !a || b.gcs < a.gcs || (b.gcs === a.gcs && b.bytes < a.bytes);
  let beste = null, pogingen = 0;
  for (; pogingen < 30; pogingen++) {
    const r = venster(w, STAPPEN);
    if (beter(beste, r)) beste = r;
    if (r.gcs === 0 && r.bytes < DREMPEL) break;
  }
  console.log(`      stabiel: ${beste.bytes} bytes over ${BLOKKEN} blokken, ${beste.gcs} GC's (venster ${pogingen + 1})`);
  ok(beste.gcs ? `stabiele toestand: ${beste.gcs} GC's in het schoonste venster (er is afval)`
    : `stabiele toestand: ${(beste.bytes / BLOKKEN).toFixed(3)} bytes per blok, geen GC`,
  beste.gcs === 0 && beste.bytes < DREMPEL);

  // Met berichten: een bericht mag iets kosten (dat maakt de browser toch al
  // aan, en 'einde' gaat terug als object), een blok niet. Gemeten 24 sep:
  // ~4 bytes per bericht, dat zijn de einde-meldingen.
  let besteB = null, n = 0;
  for (pogingen = 0; pogingen < 30; pogingen++) {
    const ber = maakBerichten(w.blok, STAPPEN, 37);
    n = ber.reduce((s, ev) => s + ev.length, 0);
    const r = venster(w, STAPPEN, ber);
    if (beter(besteB, r)) besteB = r;
    if (r.gcs === 0 && r.bytes < DREMPEL + 16 * n) break;
  }
  console.log(`      met ${n} segmentwissels: ${besteB.bytes} bytes, ${besteB.gcs} GC's (venster ${pogingen + 1})`);
  ok(besteB.gcs ? `met segmentwissels: ${besteB.gcs} GC's in het schoonste venster (er is afval)`
    : `met segmentwissels (overgang): ${(besteB.bytes / n).toFixed(1)} bytes per bericht, geen GC`,
  besteB.gcs === 0 && besteB.bytes < DREMPEL + 16 * n);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
