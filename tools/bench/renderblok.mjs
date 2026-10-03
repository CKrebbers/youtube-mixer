/**
 * Het audiopad van acht streamende decks: hoe zwaar, en maakt het afval?
 *
 * Draait de ECHTE worklet (`src/engine/stream-lezer.js`, dus ook
 * `renderBlok()` uit de streamkern) in een nagebouwde AudioWorkletGlobalScope:
 * `sampleRate`, `currentFrame`, `AudioWorkletProcessor` met een `port`, en
 * `registerProcessor`. Acht decks, blok voor blok zoals de audiothread ze
 * afwerkt, met een draaiboek dat alle paden raakt: loops (en hun naad),
 * seeks en hotcues (segmentwissel met overgang), tempowissels, pauze/play,
 * een gat (pagina weg en later terug) en het trackeinde.
 *
 * Gemeten per variant:
 *   uitvoer    FNV-1a over de bits van alle blokken: gelijk = bit voor bit
 *              dezelfde audio als de referentie
 *   CPU        thread-CPU-tijd per seconde audio, voor acht decks samen
 *              (minimum en mediaan over de rondes; de machine is vaak druk)
 *   blokken/s  process()-aanroepen per seconde CPU
 *   per stap   p50/p99/max van één stap = acht decks één blok verder (µs);
 *              het budget van een blok van 128 frames op 48 kHz is 2667 µs
 *   afval      bytes per blok uit v8 `total_allocated_bytes`, het aantal
 *              garbage collections tijdens de run (klein = scavenge), en de
 *              heap na een volledige GC ten opzichte van ervoor
 *   harnas     dezelfde meting met een lege processor: wat het harnas zelf
 *              kost en alloceert (de vloer)
 * Met --profiel ook WAAR er gealloceerd wordt (V8's sampling heap profiler,
 * inclusief wat een scavenge al opruimde), per functie in de engine.
 *
 * STEMS (docs/STEMS.md, 3 okt): de worklet heeft vier uitgangen, het harnas
 * geeft er dus vier (zoals Chrome met numberOfOutputs 4). Naast stereo meet
 * hij dezelfde acht decks met twee en vier stems (4 en 8 kanalen per frame,
 * één renderBlok per paar). Paar 0 van het stems-materiaal IS het
 * stereomateriaal, de andere paren zijn ervan afgeleid (R/L, −L/−R, L/L):
 * de hash gaat over uitgang 0, en moet dus voor alle varianten gelijk zijn.
 *
 *   nice -n 10 node --expose-gc tools/bench/renderblok.mjs [--sec 60] [--rondes 3]
 *                    [--ref <commit>] [--ref-stems] [--profiel] [--stems 2,4 | 0]
 *
 * `--ref-stems`: meet de ref ook met stems. Alleen voor een commit die al
 * stems kan (fdab6fc of later); een oudere worklet leest 8 kanalen als stereo.
 *
 * `--ref <commit>` haalt stream-kern.js en stream-lezer.js van die commit uit
 * git (alleen lezen, naar een tijdelijke map) en meet die ernaast, om de
 * beurt met de werkmap. Zonder --expose-gc zet het script de vlag zelf.
 */
import v8 from 'node:v8';
import vm from 'node:vm';
import os from 'node:os';
import { PerformanceObserver, performance, constants as perfConst } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SR = 48000, Q = 128, DECKS = 8;
const HIER = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HIER, '..', '..');

const arg = (naam, standaard) => {
  const i = process.argv.indexOf(naam);
  if (i < 0) return standaard;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const SEC = Number(arg('--sec', 60));
const RONDES = Number(arg('--rondes', 3));
const REF = arg('--ref', null);
const PROFIEL = !!arg('--profiel', false);
// Welke stem-varianten erbij (aantal stems); 0 = alleen stereo.
const STEMS = String(arg('--stems', '2,4')).split(',').map(Number).filter((n) => n === 2 || n === 4);
const REF_STEMS = !!arg('--ref-stems', false);
const UIT = 4;                                  // uitgangen van de worklet (UITGANGEN)

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

// ---- nagebouwde AudioWorkletGlobalScope -------------------------------------

let geregistreerd = null;
globalThis.sampleRate = SR;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    const uit = [];
    this.port = { onmessage: null, uit, postMessage: (m) => { uit.push(m); } };
  }
};
globalThis.registerProcessor = (_naam, klasse) => { geregistreerd = klasse; };

async function laadLezer(pad) {
  geregistreerd = null;
  await import(pathToFileURL(pad).href);
  if (!geregistreerd) throw new Error(`${pad} registreerde geen processor`);
  return geregistreerd;
}

/** De vloer: wat het harnas zelf kost, zonder audio. */
class LegeLezer extends globalThis.AudioWorkletProcessor {
  constructor() { super(); this.port.onmessage = () => {}; }
  process() { return true; }
}

// ---- materiaal ----------------------------------------------------------------

/**
 * Hetzelfde materiaal als `paren` stereoparen naast elkaar (stems.wav):
 * paar 0 = (L, R), 1 = (R, L), 2 = (−L, −R), 3 = (L, L).
 */
function maakStems(pcm, paren) {
  const n = pcm.length / 2, ch = paren * 2, uit = new Int16Array(n * ch);
  for (let i = 0; i < n; i++) {
    const l = pcm[2 * i], r = pcm[2 * i + 1], o = ch * i;
    const v = [l, r, r, l, -l, -r, l, l];
    for (let c = 0; c < ch; c++) uit[o + c] = v[c];
  }
  return uit;
}

/** Een vaste track: twee sinussen en ruis, 16 bit stereo, zoals de ingest hem levert. */
function maakTrack(sec) {
  const n = sec * SR;
  const pcm = new Int16Array(n * 2);
  let x = 20260925;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const ruis = ((x >>> 8) / 16777216 - 0.5) * 0.1;
    const l = 0.4 * Math.sin(2 * Math.PI * 55 * i / SR) + 0.2 * Math.sin(2 * Math.PI * 331 * i / SR) + ruis;
    const r = 0.3 * Math.sin(2 * Math.PI * 82.5 * i / SR) + 0.25 * Math.sin(2 * Math.PI * 517 * i / SR) - ruis;
    pcm[2 * i] = Math.round(l * 32767);
    pcm[2 * i + 1] = Math.round(r * 32767);
  }
  return pcm;
}

const RATES = [1, 1.0004, 0.97, 1.03, 1.08, 0.92, 1, 1.16];
// Tellen op 124 bpm (0,484 s), van een zestiende tot twee maten, en één krom.
const LUSSEN = [0.484, 0.242, 0.968, 0.121, 1.935, 0.0605, 0.3017, 3.871];

/**
 * Per deck een lijst { blok, event }: berichten zoals de hoofdthread ze
 * stuurt, met segmenten die de hoofdthread zo zou uitrekenen (positieOp op
 * zijn eigen klok). Alles vooraf gemaakt: tijdens de meting maakt het harnas
 * geen berichten aan.
 */
function maakScenario({ positieOp, PAGINA }, { blokken, duur, paginas, kanalen = 2 }) {
  const draaiboek = [];
  for (let d = 0; d < DECKS; d++) {
    const ev = [];
    let id = 0, rate = RATES[d], loop = null;
    let seg = { T: 0, P: 0, R: 1, loop: null, speelt: false };
    const stuur = (blok, m) => ev.push({ blok, event: { data: m } });
    // `laat`: het bericht komt later aan dan T (drukke hoofdthread); de
    // worklet rekent dan vanaf T door.
    const segment = (blok, P, speelt, laat = 0) => {
      seg = { T: (blok * Q) / SR - laat, P, R: rate, loop, speelt };
      stuur(blok, { type: 'segment', seg, id: ++id });
    };
    const binnen = (p) => (p > duur - 12 ? 3 + (p % 20) : p);
    stuur(0, { type: 'bron', duur, sr: SR, kanalen });
    for (const [i, data] of paginas) stuur(0, { type: 'pagina', i, data });
    // Deck 0 begint op een heel frame op rate 1 (het exacte pad), deck 6 op rate 1 ertussen.
    segment(0, 5 + d * 7.1 + (d === 6 ? 0.123456789 / SR : 0), true);
    const tik = Math.round(((1.3 + 0.17 * d) * SR) / Q);
    let stap = 0, seeks = 0;
    for (let b = tik; b < blokken; b += tik) {
      const T = (b * Q) / SR;
      const pos = Math.min(positieOp(seg, T), duur);
      if (!loop && pos >= duur - 0.5) { segment(b, 10, true); continue; }    // einde: terug naar een hotcue
      switch (stap++ % 8) {
        case 0: {
          seeks++;
          // Deck 5 springt om de andere seek vlak voor het einde: het einde-pad.
          const doel = d === 5 && seeks % 2 === 1 ? duur - 0.3 : binnen(pos + 9.37);
          if (d === 5 && seeks % 2 === 1) loop = null;
          segment(b, doel, seg.speelt, 0.003);
          break;
        }
        case 1: loop = { start: pos, end: pos + LUSSEN[d] }; segment(b, pos, seg.speelt); break;
        case 2: rate = RATES[d] * (1 + 0.02 * ((stap % 3) - 1)); segment(b, pos, seg.speelt); break;
        case 3: loop = null; segment(b, pos, seg.speelt); break;
        case 4: segment(b, pos, false); break;
        case 5: segment(b, pos, true); break;
        case 6: loop = null; segment(b, 20 + d, true, 0.002); break;       // hotcue
        case 7: {
          // Een gat: de pagina vóór ons verdwijnt en komt 40 blokken later terug.
          const i = Math.floor((pos * SR) / PAGINA) + 1;
          if (paginas.has(i)) {
            stuur(b, { type: 'weg', i });
            if (b + 40 < blokken) stuur(b + 40, { type: 'pagina', i, data: paginas.get(i) });
          }
          break;
        }
      }
    }
    ev.sort((a, b) => a.blok - b.blok);        // stabiel: volgorde binnen een blok blijft
    draaiboek.push(ev);
  }
  return draaiboek;
}

// ---- draaien ----------------------------------------------------------------

const LEEG = [];

/**
 * Speelt het draaiboek af op acht verse processors, `blokken` blokken lang.
 * Met `tijden` (Float64Array) wordt elke stap van acht blokken getimed;
 * met `hash` komt er een FNV-1a over de bits van alle uitvoer terug.
 */
function draai(Lezer, draaiboek, blokken, { tijden = null, hash = false } = {}) {
  const decks = [], uits = [], bits = [], wijzer = new Int32Array(DECKS);
  for (let d = 0; d < DECKS; d++) {
    decks.push(new Lezer());
    // Vier uitgangen, zoals Chrome ze geeft; de hash gaat over uitgang 0.
    const uit = Array.from({ length: UIT }, () => [new Float32Array(Q), new Float32Array(Q)]);
    uits.push(uit);
    bits.push([new Uint32Array(uit[0][0].buffer), new Uint32Array(uit[0][1].buffer)]);
  }
  let h = 0x811c9dc5 | 0;
  for (let b = 0; b < blokken; b++) {
    globalThis.currentFrame = b * Q;
    const t0 = tijden ? performance.now() : 0;
    for (let d = 0; d < DECKS; d++) {
      const ev = draaiboek[d];
      let w = wijzer[d];
      while (w < ev.length && ev[w].blok === b) decks[d].port.onmessage(ev[w++].event);
      wijzer[d] = w;
      decks[d].process(LEEG, uits[d], null);
    }
    if (tijden) tijden[b] = performance.now() - t0;
    if (hash) {
      for (let d = 0; d < DECKS; d++) {
        for (let k = 0; k < 2; k++) {
          const u = bits[d][k];
          for (let i = 0; i < Q; i++) h = Math.imul(h ^ u[i], 0x01000193);
        }
      }
    }
  }
  let eindes = 0;
  for (const n of decks) eindes += n.port.uit.filter((m) => m.type === 'einde').length;
  return { hash: (h >>> 0).toString(16).padStart(8, '0'), eindes };
}

const threadCpu = () => { const u = process.threadCpuUsage(); return u.user + u.system; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

async function tel(fn) {
  let klein = 0, groot = 0, overig = 0;
  const obs = new PerformanceObserver((lijst) => {
    for (const e of lijst.getEntries()) {
      const k = e.detail?.kind ?? e.kind;
      if (k === perfConst.NODE_PERFORMANCE_GC_MINOR) klein++;
      else if (k === perfConst.NODE_PERFORMANCE_GC_MAJOR) groot++;
      else overig++;
    }
  });
  obs.observe({ entryTypes: ['gc'] });
  globalThis.gc();
  globalThis.gc();
  const heap0 = process.memoryUsage().heapUsed;
  const a0 = v8.getHeapStatistics().total_allocated_bytes;
  fn();
  const a1 = v8.getHeapStatistics().total_allocated_bytes;
  await new Promise((r) => setTimeout(r, 20));        // gc-meldingen komen asynchroon
  obs.disconnect();
  globalThis.gc();
  globalThis.gc();
  const heap1 = process.memoryUsage().heapUsed;
  return { bytes: a1 - a0, klein, groot, overig, heapGroei: heap1 - heap0 };
}

/**
 * `verwacht` = de bytes die de afvalmeting zag. Het interval schaalt mee
 * (hooguit ~200 000 monsters): met 64 bytes en 2 GB afval werd het profiel
 * een string te lang voor V8, en liep --profiel op 60 s vast.
 */
async function profiel(fn, bestanden, verwacht = 0) {
  const s = new Session();
  s.connect();
  await s.post('HeapProfiler.enable');
  await s.post('HeapProfiler.startSampling', {
    samplingInterval: Math.max(64, Math.ceil(verwacht / 200000)),
    includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
  });
  fn();
  const { profile } = await s.post('HeapProfiler.stopSampling');
  await s.post('HeapProfiler.disable');
  s.disconnect();
  const per = new Map();
  let totaal = 0;
  const loop = (n) => {
    const { functionName, url, lineNumber } = n.callFrame;
    totaal += n.selfSize;
    if (bestanden.some((b) => url.endsWith(b)) && n.selfSize) {
      const k = `${functionName || '(anoniem)'} ${url.split('/').pop()}:${lineNumber + 1}`;
      per.set(k, (per.get(k) || 0) + n.selfSize);
    }
    n.children.forEach(loop);
  };
  loop(profile.head);
  return { totaal, per: [...per].sort((a, b) => b[1] - a[1]) };
}

// ---- hoofdprogramma -----------------------------------------------------------

function haalRef(commit) {
  // realpath: op macOS is de tmp-map een symlink (/var -> /private/var), en het
  // profiel noemt de echte naam; anders vond --profiel de ref-bestanden niet.
  const map = realpathSync(mkdtempSync(join(os.tmpdir(), 'varve-bench-')));
  for (const f of ['stream-kern.js', 'stream-lezer.js']) {
    writeFileSync(join(map, f), execFileSync('git', ['show', `${commit}:src/engine/${f}`], { cwd: ROOT }));
  }
  return map;
}

const kern = await import(pathToFileURL(join(ROOT, 'src/engine/stream-kern.js')).href);
const varianten = [];
let refMap = null;
try {
  if (REF) {
    refMap = haalRef(REF);
    const refLezer = await laadLezer(join(refMap, 'stream-lezer.js'));
    varianten.push({ naam: `ref ${REF}`, Lezer: refLezer, map: refMap, kanalen: 2 });
    if (REF_STEMS) for (const n of STEMS) varianten.push({ naam: `ref ${n} stems`, Lezer: refLezer, map: refMap, kanalen: 2 * n });
  }
  const werkLezer = await laadLezer(join(ROOT, 'src/engine/stream-lezer.js'));
  varianten.push({ naam: 'werkmap', Lezer: werkLezer, map: join(ROOT, 'src/engine'), kanalen: 2 });
  for (const n of STEMS) varianten.push({ naam: `werkmap ${n} stems`, Lezer: werkLezer, map: join(ROOT, 'src/engine'), kanalen: 2 * n });
  varianten.push({ naam: 'harnas (leeg)', Lezer: LegeLezer, leeg: true, kanalen: 2 });

  const duur = 120;
  const pcm = maakTrack(duur);
  const pagineer = (bron, ch) => {
    const m = new Map();
    for (let p = 0; p * kern.PAGINA * ch < bron.length; p++) m.set(p, bron.slice(p * kern.PAGINA * ch, (p + 1) * kern.PAGINA * ch));
    return m;
  };
  const blokken = Math.ceil((SEC * SR) / Q);
  // Eén draaiboek per aantal kanalen: dezelfde segmenten en gaten, andere pagina's.
  const draaiboeken = new Map();
  for (const ch of new Set(varianten.map((v) => v.kanalen))) {
    const paginas = pagineer(ch === 2 ? pcm : maakStems(pcm, ch / 2), ch);
    draaiboeken.set(ch, maakScenario(kern, { blokken, duur, paginas, kanalen: ch }));
  }
  for (const v of varianten) v.draaiboek = draaiboeken.get(v.kanalen);
  const draaiboek = draaiboeken.get(2);
  const berichten = draaiboek.reduce((n, ev) => n + ev.filter((e) => e.event.data.type === 'segment').length, 0);

  console.log(`audiopad: ${DECKS} decks × ${SEC} s = ${blokken * DECKS} blokken van ${Q} frames, ${berichten} segmentwissels`
    + (STEMS.length ? `; ook met ${STEMS.join(' en ')} stems (één renderBlok per paar)` : ''));
  console.log(`node ${process.version}, ${os.cpus()[0].model}, belasting ${os.loadavg().map((x) => x.toFixed(1)).join(' / ')} op ${os.cpus().length} kernen\n`);

  // 1. Uitvoer: bit voor bit, en opwarmen (JIT) in één keer.
  for (const v of varianten) {
    const r = draai(v.Lezer, v.draaiboek, blokken, { hash: true });
    v.hash = r.hash; v.eindes = r.eindes;
  }
  const ref = varianten[0];
  console.log('uitvoer (FNV-1a over alle bits van uitgang 0)');
  for (const v of varianten.filter((x) => !x.leeg)) {
    console.log(`  ${v.naam.padEnd(16)} ${v.hash}  eindes gemeld: ${v.eindes}${v === ref ? '' : v.hash === ref.hash ? '  = gelijk aan ' + ref.naam : '  ≠ ANDERS dan ' + ref.naam}`);
  }

  // 2. Snelheid: om de beurt, zodat een drukke periode alle varianten raakt.
  const tijden = new Float64Array(blokken);
  for (const v of varianten) { v.cpu = []; v.stappen = []; }
  for (let r = 0; r < RONDES; r++) {
    for (const v of varianten) {
      const c0 = threadCpu();
      draai(v.Lezer, v.draaiboek, blokken, { tijden });
      v.cpu.push((threadCpu() - c0) / 1000);
      v.stappen.push(Float64Array.from(tijden));
    }
  }
  console.log(`\nsnelheid (${RONDES} rondes; CPU = thread-tijd voor ${SEC} s audio, 8 decks)`);
  for (const v of varianten) {
    const min = Math.min(...v.cpu), med = pct(v.cpu, 0.5);
    const beste = v.stappen[v.cpu.indexOf(min)].map((x) => x * 1000);
    console.log(`  ${v.naam.padEnd(16)} CPU min ${(min / SEC).toFixed(1).padStart(6)} ms/s (${(min / SEC / 10).toFixed(2)}% van een kern)  mediaan ${(med / SEC).toFixed(1).padStart(6)} ms/s`
      + `  ${(min * 1000 / (blokken * DECKS)).toFixed(1).padStart(5)} µs per deck-blok`
      + `  ${Math.round((blokken * DECKS) / (min / 1000)).toLocaleString('nl-NL').padStart(10)} blokken/s`
      + `  per stap p50 ${pct(beste, 0.5).toFixed(0).padStart(4)}  p99 ${pct(beste, 0.99).toFixed(0).padStart(4)}  max ${Math.max(...beste).toFixed(0).padStart(5)} µs`);
  }

  // 3. Afval.
  console.log('\nafval (één run, zonder timing)');
  for (const v of varianten) {
    const a = await tel(() => draai(v.Lezer, v.draaiboek, blokken));
    v.afval = a;
    console.log(`  ${v.naam.padEnd(16)} ${(a.bytes / (blokken * DECKS)).toFixed(1).padStart(8)} bytes/blok  (${(a.bytes / 1e6).toFixed(1)} MB in totaal)`
      + `  GC tijdens de run: ${a.klein} klein, ${a.groot} groot${a.overig ? `, ${a.overig} overig` : ''}`
      + `  heap na GC: ${a.heapGroei >= 0 ? '+' : ''}${(a.heapGroei / 1024).toFixed(0)} kB`);
  }

  // 4. Waar.
  if (PROFIEL) {
    console.log('\nwaar er gealloceerd wordt (sampling heap profiler, incl. wat een GC al opruimde)');
    for (const v of varianten.filter((x) => !x.leeg)) {
      const p = await profiel(() => draai(v.Lezer, v.draaiboek, blokken),
        [join(v.map, 'stream-kern.js'), join(v.map, 'stream-lezer.js')].map((f) => pathToFileURL(f).href), v.afval.bytes);
      const inEngine = p.per.reduce((n, [, b]) => n + b, 0);
      console.log(`  ${v.naam}: ${(inEngine / (blokken * DECKS)).toFixed(1)} bytes/blok in stream-kern/stream-lezer (van ${(p.totaal / (blokken * DECKS)).toFixed(1)} in totaal)`);
      for (const [k, b] of p.per.slice(0, 10)) console.log(`    ${(b / (blokken * DECKS)).toFixed(1).padStart(8)} bytes/blok  ${k}`);
    }
  }
} finally {
  if (refMap) rmSync(refMap, { recursive: true, force: true });
}
