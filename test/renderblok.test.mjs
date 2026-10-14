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
// @alleen: afvalmeting (0 GC over 12 000 blokken) en een gouden hash; telt bytes per bericht (test/alles.mjs draait hem na de pool, zonder iets ernaast)
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
const { PAGINA, UITGANGEN } = await import('../src/engine/stream-kern.js');

// ---- materiaal: 20 s, twee tonen en ruis, 16 bit stereo ----------------------

const DUUR = 20;
const paginas = new Map();
// Stems (docs/STEMS.md): hetzelfde materiaal als vier stereoparen naast
// elkaar (8 kanalen): paar 0 = (L, R) precies het stereomateriaal, paar 1 =
// (R, L), paar 2 = (−L, −R), paar 3 = (L, L). Dan moet uitgang 0 de gouden
// hash geven, en zijn de andere drie uitgangen exact af te leiden van uitgang 0.
const paginas8 = new Map();
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
  const pcm8 = new Int16Array(n * 8);
  for (let i = 0; i < n; i++) {
    const l = pcm[2 * i], r = pcm[2 * i + 1], o = 8 * i;
    pcm8[o] = l; pcm8[o + 1] = r; pcm8[o + 2] = r; pcm8[o + 3] = l;
    pcm8[o + 4] = -l; pcm8[o + 5] = -r; pcm8[o + 6] = l; pcm8[o + 7] = l;
  }
  for (let p = 0; p * PAGINA * 8 < pcm8.length; p++) paginas8.set(p, pcm8.slice(p * PAGINA * 8, (p + 1) * PAGINA * 8));
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

/**
 * De node heeft altijd vier uitgangen van twee kanalen (zoals Chrome ze
 * geeft met numberOfOutputs 4); stereo speelt op uitgang 0, de rest is stil.
 * `kanalen` 8 = vier stems.
 */
function maakDecks(kanalen = 2) {
  const decks = [], uits = [];
  const pag = kanalen === 8 ? paginas8 : paginas;
  // De klok terug op 0: het eerste segment komt dan op 0 binnen (invloeien
  // vanaf 0), ook als er eerder in dit bestand al decks gedraaid hebben.
  globalThis.currentFrame = 0;
  for (let d = 0; d < DECKS; d++) {
    const n = new Lezer();
    n.port.onmessage({ data: { type: 'bron', duur: DUUR, sr: SR, kanalen } });
    for (const [i, data] of pag) if (i !== GAT) n.port.onmessage({ data: { type: 'pagina', i, data } });
    const s = DECK_SEGS[d];
    n.port.onmessage({ data: { type: 'segment', id: 1, seg: { T: 0, P: s.P, R: s.R, loop: s.loop, speelt: s.speelt ?? true } } });
    decks.push(n);
    uits.push(Array.from({ length: UITGANGEN }, () => [new Float32Array(Q), new Float32Array(Q)]));
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

/**
 * `stappen` keer acht decks één blok verder; met `hash` een FNV-1a over de
 * bits van uitgang 0; `controle(uit)` na elk blok (niet in een afvalvenster).
 */
function draai(w, stappen, berichten = null, hash = false, controle = null) {
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
      if (controle) controle(w.uits[d]);
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
  ok('stereo: uitgang 1–3 stil', w.uits.every((u) => u.slice(1).every((o) => o[0].every((v) => v === 0) && o[1].every((v) => v === 0))));
}

// ---- 1b. stems: vier paren, uitgang 0 bit voor bit, de rest exact ernaast ----

console.log('\nstems: acht decks × vier paren');
{
  const w = maakDecks(8);
  h = 0x811c9dc5 | 0;
  let mis = 0, klinkt = 0;
  draai(w, 3000, maakBerichten(0, 3000, 53), true, (u) => {
    const [o0, o1, o2, o3] = u;
    for (let i = 0; i < Q; i++) {
      const l = o0[0][i], r = o0[1][i];
      if (o1[0][i] !== r || o1[1][i] !== l || o2[0][i] !== -l || o2[1][i] !== -r || o3[0][i] !== l || o3[1][i] !== l) mis++;
      if (l !== 0) klinkt++;
    }
  });
  const hash = (h >>> 0).toString(16).padStart(8, '0');
  const eindes = w.decks.reduce((n, d) => n + d.port.uit.filter((m) => m.type === 'einde').length, 0);
  ok(`8 kanalen, 3000 blokken met dezelfde overgangen: uitgang 0 (paar 0) hash ${hash} = de gouden`, hash === '9dfaeb73');
  ok(`uitgang 1–3 sample voor sample het paar dat erin zit (R/L, −L/−R, L/L): ${mis} afwijkingen over ${klinkt} klinkende frames`, mis === 0 && klinkt > 100000);
  ok(`trackeinde ${eindes}x, één keer per segment (van paar 0, niet per paar)`, eindes === 38);
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

// ---- 3. de rem (vinylstop): ook zonder afval ----------------------------------
// Een remmend segment heeft een extra veld (rem: { a }) en een extra term in
// positieOp, en dooft in zijn laatste stuk uit (remUit). Ook dat mag per blok
// niets aanmaken. De berichten: dezelfde decks, maar elk segment remt, in
// 0,1–2 s, zodat een venster remmen, uitdoven én stilstand bevat, in loops,
// tegen het gat en voorbij het einde. Hierboven staat de gouden hash: die
// gaat over segmenten zonder rem en is dus niet veranderd.

console.log('\nrem');
{
  const remBerichten = (van, stappen, elke) => {
    const lijst = maakBerichten(van, stappen, elke);
    for (const ev of lijst) for (const { blok: b, event } of ev) {
      const seg = event.data.seg;
      seg.rem = { a: -seg.R / (0.1 + (b % 7) * 0.3) };
    }
    return lijst;
  };
  const w = maakDecks();
  draai(w, 4000, remBerichten(0, 4000, 41));           // opwarmen, ook met de rem
  const STAPPEN = 1500, DREMPEL = 1024;
  const beter = (a, b) => !a || b.gcs < a.gcs || (b.gcs === a.gcs && b.bytes < a.bytes);
  let beste = null, n = 0, pogingen = 0;
  for (; pogingen < 30; pogingen++) {
    const ber = remBerichten(w.blok, STAPPEN, 37);
    n = ber.reduce((s, ev) => s + ev.length, 0);
    const r = venster(w, STAPPEN, ber);
    if (beter(beste, r)) beste = r;
    if (r.gcs === 0 && r.bytes < DREMPEL + 16 * n) break;
  }
  console.log(`      ${n} remsegmenten: ${beste.bytes} bytes, ${beste.gcs} GC's (venster ${pogingen + 1})`);
  ok(beste.gcs ? `remmende decks: ${beste.gcs} GC's in het schoonste venster (er is afval)`
    : `remmende decks: ${(beste.bytes / n).toFixed(1)} bytes per bericht, geen GC`,
  beste.gcs === 0 && beste.bytes < DREMPEL + 16 * n);
}

// ---- 4. stems: acht decks × vier paren, ook zonder afval ---------------------
// Vier renderBlok-aanroepen per deck per blok, elk met een eigen staat, en
// uitgangen zonder paar op nul: niets daarvan mag per blok iets aanmaken.

console.log('\nstems: afval');
{
  const w = maakDecks(8);
  draai(w, 4000, maakBerichten(0, 4000, 41));          // opwarmen
  const STAPPEN = 1500, BLOKKEN = STAPPEN * DECKS, DREMPEL = 1024;
  const beter = (a, b) => !a || b.gcs < a.gcs || (b.gcs === a.gcs && b.bytes < a.bytes);
  let beste = null, pogingen = 0;
  for (; pogingen < 30; pogingen++) {
    const r = venster(w, STAPPEN);
    if (beter(beste, r)) beste = r;
    if (r.gcs === 0 && r.bytes < DREMPEL) break;
  }
  console.log(`      stabiel: ${beste.bytes} bytes over ${BLOKKEN} blokken (× 4 paren), ${beste.gcs} GC's (venster ${pogingen + 1})`);
  ok(beste.gcs ? `stems, stabiel: ${beste.gcs} GC's in het schoonste venster (er is afval)`
    : `stems, stabiel: ${(beste.bytes / BLOKKEN).toFixed(3)} bytes per blok (vier paren), geen GC`,
  beste.gcs === 0 && beste.bytes < DREMPEL);
  let besteB = null, n = 0;
  for (pogingen = 0; pogingen < 30; pogingen++) {
    const ber = maakBerichten(w.blok, STAPPEN, 37);
    n = ber.reduce((s, ev) => s + ev.length, 0);
    const r = venster(w, STAPPEN, ber);
    if (beter(besteB, r)) besteB = r;
    if (r.gcs === 0 && r.bytes < DREMPEL + 16 * n) break;
  }
  console.log(`      met ${n} segmentwissels: ${besteB.bytes} bytes, ${besteB.gcs} GC's (venster ${pogingen + 1})`);
  ok(besteB.gcs ? `stems met segmentwissels: ${besteB.gcs} GC's in het schoonste venster (er is afval)`
    : `stems met segmentwissels: ${(besteB.bytes / n).toFixed(1)} bytes per bericht, geen GC`,
  besteB.gcs === 0 && besteB.bytes < DREMPEL + 16 * n);
}

// ---- 5. keylock (het rekpad, docs/KEYLOCK.md): ook zonder afval ---------------
// Acht decks door de Signalsmith-stretcher (rek-kern.js): toon, tempo, loops
// en een gat, met berichten die het rekpad laten doorlopen (tempo, T = nu),
// gepland laten springen (T in de toekomst) en terug naar renderBlok en weer
// erheen laten wisselen (keylock uit en aan). Een bericht mag iets kosten, een
// blok niet.

console.log('\nkeylock: afval');
{
  const rekVan = (d, b) => ({ keylock: (d + b) % 5 !== 0, toon: ((d + b) % 3) - 1 });
  const w = maakDecks();
  // Elk deck meteen een segment met keylock, en wachten tot de WASM er is.
  for (let d = 0; d < DECKS; d++) {
    const s = DECK_SEGS[d];
    w.decks[d].port.onmessage({ data: { type: 'segment', id: 2, seg: { T: 0, P: s.P, R: s.R, loop: s.loop, speelt: s.speelt ?? true, rem: null, rek: rekVan(d, 0) } } });
  }
  for (let i = 0; i < 400 && !w.decks.every((d) => d.rek); i++) await new Promise((r) => setTimeout(r, 5));
  ok('acht stretchers geladen', w.decks.every((d) => d.rek));
  // Elk segment in de vorm die de StreamBron stuurt (één letterlijk object met
  // alle zeven velden, rek: null of { keylock, toon }): de worklet ziet dan één
  // vorm, zoals in de browser.
  const rekBerichten = (van, stappen, elke) => {
    const lijst = maakBerichten(van, stappen, elke);
    lijst.forEach((ev, d) => {
      for (const e of ev) {
        const o = e.event.data.seg, b = e.blok;
        let T = o.T, P = o.P;
        if ((b % 4) === 2) { T = (b * Q) / SR + 0.1; e.event.data.gepland = true; }
        if ((b % 4) === 3) { T = (b * Q) / SR; P = DECK_SEGS[(d + b) % DECKS].P; }
        e.event.data.seg = { T, P, R: o.R, loop: o.loop, speelt: o.speelt, rem: null, rek: (b % 4) === 1 ? null : rekVan(d, b) };
      }
    });
    return lijst;
  };
  draai(w, 4000, rekBerichten(0, 4000, 41));          // opwarmen, met alle paden en overgangen
  const inB = w.decks.filter((d) => d.inB || d.naarB).length;
  const STAPPEN = 1500, BLOKKEN = STAPPEN * DECKS, DREMPEL = 1024;
  const beter = (a, b) => !a || b.gcs < a.gcs || (b.gcs === a.gcs && b.bytes < a.bytes);
  let beste = null, pogingen = 0;
  for (; pogingen < 30; pogingen++) {
    const r = venster(w, STAPPEN);
    if (beter(beste, r)) beste = r;
    if (r.gcs === 0 && r.bytes < DREMPEL) break;
  }
  console.log(`      stabiel (${inB} decks op het rekpad): ${beste.bytes} bytes over ${BLOKKEN} blokken, ${beste.gcs} GC's (venster ${pogingen + 1})`);
  ok(beste.gcs ? `keylock, stabiel: ${beste.gcs} GC's in het schoonste venster (er is afval)`
    : `keylock, stabiel: ${(beste.bytes / BLOKKEN).toFixed(3)} bytes per blok, geen GC`,
  inB > 0 && beste.gcs === 0 && beste.bytes < DREMPEL);
  // Per bericht mag het rekpad meer kosten dan renderBlok: een sprong is een
  // `_seek(n, rate)` en een andere toon `_setTransposeSemitones`, en een WASM-
  // functie met een niet-geheel getal als argument pakt dat in (gemeten 48 bytes
  // per aanroep). Eén keer per sprong of toonwissel, nooit per blok.
  const PER_BERICHT = 64;
  let besteB = null, n = 0;
  for (pogingen = 0; pogingen < 30; pogingen++) {
    const ber = rekBerichten(w.blok, STAPPEN, 37);
    n = ber.reduce((s, ev) => s + ev.length, 0);
    const r = venster(w, STAPPEN, ber);
    if (beter(besteB, r)) besteB = r;
    if (r.gcs === 0 && r.bytes < DREMPEL + PER_BERICHT * n) break;
  }
  console.log(`      met ${n} wissels (tempo, geplande sprong, keylock uit en aan): ${besteB.bytes} bytes, ${besteB.gcs} GC's (venster ${pogingen + 1})`);
  ok(besteB.gcs ? `keylock met wissels: ${besteB.gcs} GC's in het schoonste venster (er is afval)`
    : `keylock met wissels: ${(besteB.bytes / n).toFixed(1)} bytes per bericht (zoeken en toon in de WASM), geen GC`,
  besteB.gcs === 0 && besteB.bytes < DREMPEL + PER_BERICHT * n);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
