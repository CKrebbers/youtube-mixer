#!/usr/bin/env node
/**
 * Keylock-proef: Signalsmith Stretch 1.3.2 op Clay's eigen muziek.
 * Zie docs/KEYLOCK.md voor wat eruit kwam en tools/README.md voor gebruik.
 *
 *   node tools/keylock/proef.mjs haal        npm-pakket ophalen naar tools/keylock/pakket/ (niet in git)
 *   node tools/keylock/proef.mjs info        bestanden, grootte, licentie, latentie per preset, geheugen
 *   node tools/keylock/proef.mjs controle    toonhoogte, hoorbare positie, klankkleur op 1,00, springen, tempowissel
 *   node tools/keylock/proef.mjs meet        rekentijd per seconde audio, per blok, en acht decks
 *   node tools/keylock/proef.mjs luister     luisterbestanden naar tools/keylock/uit/<nummer>/
 *   node tools/keylock/proef.mjs alles       info + controle + meet + luister
 *   node tools/keylock/proef.mjs acht        alleen de acht decks (gevoelig voor belasting, los te herhalen)
 *
 * Leest ALLEEN uit media/ en media/library.db van de hoofdmap (ook vanuit een
 * worktree; VARVE_MEDIA wijst een andere map aan). Schrijft alleen in
 * tools/keylock/uit/ en tools/keylock/pakket/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import {
  VERSIE, PAKKET, PAKKET_MAP, HIER, controleerTarball, pakketInfo, laadFabriek, Kern, PRESETS,
  StretchSpeler, arrayBron, loopArrayBron, laadProcessor, maakProcessor, leesStuk, leesPaginas,
} from './kern.mjs';
import { renderBlok, leesWavKop, maakWav, PAGINA } from '../../src/engine/stream-kern.js';
import { Beatgrid } from '../../src/engine/beatgrid.js';

const SR = 48000;
const Q = 128;                          // render-quantum van Web Audio
const BUDGET_US = (Q / SR) * 1e6;       // 2667 µs per quantum
const UIT = path.join(HIER, 'uit');

// ---- waar de media staan ------------------------------------------------------

function mediaMap() {
  if (process.env.VARVE_MEDIA) return process.env.VARVE_MEDIA;
  try {
    const git = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HIER, encoding: 'utf8' }).trim();
    return path.join(path.dirname(git), 'media');
  } catch (_) { return path.join(HIER, '..', '..', 'media'); }
}
const MEDIA = mediaMap();

/**
 * De fragmenten. `van` in seconden tracktijd; gekozen op een scan van RMS en
 * klappen (niet op het gehoor). Andere plek: --van <s> (geldt dan voor alle).
 */
const FRAGMENTEN = [
  { id: 'mOzW9KQKfzA', naam: 'sakamoto', van: 300, soort: 'piano, polyfoon, aangehouden (Best of Ryuichi Sakamoto)' },
  { id: '1W1-nPXEVKk', naam: 'zoned-out', van: 100, soort: 'ambient, pads en drones (Ambient2K)' },
  { id: 'f3a7DiCsm8k', naam: 'adriana', van: 340, loop: 1160, soort: 'het album, grid 140-150 bpm (ADRIANA)' },
  { id: 'tiktok-7031697544472251694', naam: 'no-surprises', van: 20, soort: 'zang (No Surprises, lennonstella)' },
];
const DUUR = Number(arg('--duur') ?? 40);
const VAN = arg('--van') !== null ? Number(arg('--van')) : null;

function arg(naam) { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; }

function titels() {
  try {
    const db = new DatabaseSync(path.join(MEDIA, 'library.db'), { readOnly: true });
    const m = new Map(db.prepare('SELECT id, titel, uploader, duur FROM tracks').all().map((r) => [r.id, r]));
    db.close();
    return m;
  } catch (_) { return new Map(); }
}

function openTrack(id) {
  const bestand = path.join(MEDIA, id, 'audio.wav');
  const fd = fs.openSync(bestand, 'r');
  const b = Buffer.alloc(65536);
  fs.readSync(fd, b, 0, b.length, 0);
  fs.closeSync(fd);
  const kop = leesWavKop(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  return { bestand, kop, duur: kop.dataLengte / 4 / kop.sampleRate };
}

/** Een stuk track als bron voor de stretcher, met marge ervoor en erachter. */
function trackBron(t, van, duur) {
  const basis = Math.round((van - 2) * SR);
  const { L, R } = leesStuk(t.bestand, t.kop, basis, Math.round((duur * 1.2 + 4) * SR));
  return { bron: arrayBron(L, R, basis), L, R, basis };
}

// ---- renderen ------------------------------------------------------------------

/** Zoals nu: renderBlok uit de streamkern, pitch schuift mee met de rate. */
function renderHuidig(t, van, duur, R) {
  const p0 = Math.floor(((van - 1) * SR) / PAGINA), p1 = Math.floor(((van + duur + 1) * SR) / PAGINA);
  const paginas = leesPaginas(t.bestand, t.kop, p0, p1, PAGINA);
  const n = Math.ceil((duur / R) * SR / Q) * Q;
  const L = new Float32Array(n), Rr = new Float32Array(n);
  const seg = { T: 0, P: van, R, loop: null, speelt: true };
  const bl = [new Float32Array(Q), new Float32Array(Q)];
  const staat = { env: 1 };
  for (let i = 0; i < n; i += Q) {
    renderBlok({ seg, paginas, uit: bl, frames: Q, t0: i / SR, ctxRate: SR, trackRate: SR, duur: t.duur, staat });
    L.set(bl[0], i); Rr.set(bl[1], i);
  }
  return [L, Rr];
}

/** Zoals nu, met een loop: renderBlok met seg.loop (LOOP_NAAD inbegrepen). */
function renderLoopHuidig(t, loop, sec, R) {
  const p0 = Math.floor(((loop.start - 1) * SR) / PAGINA), p1 = Math.floor(((loop.end + 1) * SR) / PAGINA);
  const paginas = leesPaginas(t.bestand, t.kop, p0, p1, PAGINA);
  const n = Math.ceil(sec * SR / Q) * Q;
  const L = new Float32Array(n), Rr = new Float32Array(n);
  const seg = { T: 0, P: loop.start, R, loop, speelt: true };
  const bl = [new Float32Array(Q), new Float32Array(Q)];
  const staat = { env: 1 };
  for (let i = 0; i < n; i += Q) {
    renderBlok({ seg, paginas, uit: bl, frames: Q, t0: i / SR, ctxRate: SR, trackRate: SR, duur: t.duur, staat });
    L.set(bl[0], i); Rr.set(bl[1], i);
  }
  return [L, Rr];
}

/** Het grid van een nummer uit de library (alleen lezen). */
function grid(id) {
  const db = new DatabaseSync(path.join(MEDIA, 'library.db'), { readOnly: true });
  const r = db.prepare('SELECT grid_json FROM tracks WHERE id = ?').get(id);
  db.close();
  return Beatgrid.van(JSON.parse(r.grid_json));
}

/**
 * Hoe lang opwarmen vóór het eerste blok. Controle 4: met één blok (120 ms)
 * klinkt een klik exact op tijd en op volle sterkte; met uitLat (60 ms) is
 * de sterkte goed maar valt een klik 2,5 ms te vroeg.
 */
const voorrolVan = (k) => k.blok / k.sr;

/** Met keylock (optie A): StretchSpeler, rate R, toon in halve tonen. */
async function renderStretch(fabriek, bron, van, duur, R, { semitonen = 0, preset = 'standaard', formant = false } = {}) {
  const k = await Kern.maak(fabriek, { preset });
  if (formant) k.formant(0, true, 0);
  const sp = new StretchSpeler(k, bron);
  sp.zet({ T: 0, P: van, R });
  sp.toon(semitonen);
  sp.voorrol(0, voorrolVan(k));
  const n = Math.ceil((duur / R) * SR / Q) * Q;
  const L = new Float32Array(n), Rr = new Float32Array(n);
  for (let i = 0; i < n; i += Q) sp.blok(i / SR, L, Rr, Q, i);
  return [L, Rr];
}

/**
 * Alle luisterbestanden 3 dB zachter, het origineel ook: keylock verandert de
 * pieken (tot +1,5 dB boven een origineel dat de ingest al op -1,5 dB zette),
 * en in 16-bit zou dat klemmen. In de app is het float tot aan de limiter.
 */
const LUISTER_GAIN = 10 ** (-3 / 20);

function schrijfWav(bestand, [L, R], fade = 0.005) {
  for (let i = 0; i < L.length; i++) { L[i] *= LUISTER_GAIN; R[i] *= LUISTER_GAIN; }
  const f = Math.round(fade * SR);
  for (let i = 0; i < f; i++) { const g = i / f; L[i] *= g; R[i] *= g; L[L.length - 1 - i] *= g; R[R.length - 1 - i] *= g; }
  fs.mkdirSync(path.dirname(bestand), { recursive: true });
  fs.writeFileSync(bestand, Buffer.from(maakWav([L, R], SR)));
}

// ---- meetgereedschap --------------------------------------------------------------

/** Frequentie van een sinus uit nuldoorgangen met interpolatie. */
function frequentie(x, van, tot) {
  let eerste = null, laatste = null, n = 0;
  for (let i = van + 1; i < tot; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]);
      if (eerste === null) eerste = t; else { laatste = t; n++; }
    }
  }
  return n > 0 ? (n * SR) / (laatste - eerste) : NaN;
}

function sinus(f, sec, amp = 0.5) {
  const n = Math.round(sec * SR), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
  return L;
}

/** Klikken: een korte toonstoot (5 ms, 2 kHz, Hann) elke `om` seconden, op ruis van -60 dB. */
function klikken(sec, om = 0.5, eerste = 0.5) {
  const n = Math.round(sec * SR), L = new Float32Array(n);
  let zaad = 1;
  for (let i = 0; i < n; i++) { zaad = (zaad * 16807) % 2147483647; L[i] = 0.001 * (zaad / 2147483647 - 0.5); }
  const lengte = Math.round(0.005 * SR);
  const tijden = [];
  for (let t = eerste; t < sec - 0.2; t += om) {
    const a = Math.round(t * SR);
    tijden.push(a / SR + 0.0025);                 // midden van de stoot
    for (let j = 0; j < lengte; j++) L[a + j] += 0.8 * Math.sin((2 * Math.PI * 2000 * j) / SR) * Math.sin((Math.PI * j) / lengte) ** 2;
  }
  return { L, tijden };
}

/** Piek van de omhullende (1 ms glad) binnen ±zoek rond verwacht, in seconden. */
function piekRond(x, verwacht, zoek = 0.1) {
  const a = Math.max(0, Math.round((verwacht - zoek) * SR)), b = Math.min(x.length, Math.round((verwacht + zoek) * SR));
  const w = Math.round(0.001 * SR);
  let best = -1, bestI = a, som = 0;
  for (let i = a; i < b; i++) {
    som += x[i] * x[i];
    if (i - w >= a) som -= x[i - w] * x[i - w];
    if (som > best) { best = som; bestI = i - w / 2; }
  }
  return bestI / SR;
}

const BANDEN = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Octaafband (RBJ-bandpass, 0 dB piek), voor de klankkleur per band. */
function bandpass(x, f0) {
  const w = (2 * Math.PI * f0) / SR, alfa = Math.sin(w) / (2 * Math.SQRT2);
  const a0 = 1 + alfa, b0 = alfa / a0, b2 = -alfa / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alfa) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// ---- info ----------------------------------------------------------------------

function haal() {
  fs.mkdirSync(PAKKET_MAP, { recursive: true });
  const naam = execFileSync('npm', ['pack', `signalsmith-stretch@${VERSIE}`, '--pack-destination', PAKKET_MAP, '--silent'],
    { encoding: 'utf8' }).trim().split('\n').pop();
  const tgz = path.join(PAKKET_MAP, naam);
  const h = controleerTarball(tgz);
  execFileSync('tar', ['xzf', tgz, '-C', PAKKET_MAP]);
  console.log(`opgehaald: ${path.relative(process.cwd(), tgz)}\nintegriteit klopt: ${h.slice(0, 30)}…\nuitgepakt: ${path.relative(process.cwd(), PAKKET)}`);
}

async function info() {
  const i = pakketInfo();
  console.log(`\n== info ==\nsignalsmith-stretch ${i.versie}, licentie in package.json: ${i.licentie}, LICENSE-bestand in het pakket: ${i.licentieBestand ? 'ja' : 'NEE'}`);
  for (const b of i.bestanden) console.log(`  ${b.naam.padEnd(26)} ${(b.bytes / 1024).toFixed(1)} KB`);
  console.log(`  WASM: ${(i.wasmBase64 / 1024).toFixed(1)} KB base64 in het .mjs = ${(i.wasmBytes / 1024).toFixed(1)} KB binair`);
  const fabriek = laadFabriek();
  console.log('\npreset                 blok      interval  invoerlat  uitvoerlat samen      geheugen/instantie');
  for (const naam of Object.keys(PRESETS)) {
    const k = await Kern.maak(fabriek, { preset: naam });
    const ms = (n) => `${(n / 48).toFixed(1)} ms`.padEnd(10);
    console.log(`  ${naam.padEnd(20)} ${ms(k.blok)} ${ms(k.interval)} ${ms(k.inLat)} ${ms(k.uitLat)} ${ms(k.inLat + k.uitLat)} ${(k.geheugen / 1024).toFixed(0)} KB`);
  }
  console.log('  (Signalsmith noemt 120/30 "default" en 100/40 gespreid "cheaper".)');
}

// ---- controle -------------------------------------------------------------------

async function controle() {
  const fabriek = laadFabriek();
  console.log('\n== controle 1: toonhoogte (sinus 440 Hz) ==');
  const s = sinus(440, 6);
  const sBron = arrayBron(s, s, 0);
  const gevallen = [
    ['keylock 0,92', 0.92, 0, 440], ['keylock 1,08', 1.08, 0, 440], ['keylock 1,00', 1, 0, 440],
    ['toon +2 op 1,00', 1, 2, 440 * 2 ** (2 / 12)], ['toon -1 op 1,00', 1, -1, 440 * 2 ** (-1 / 12)],
    ['toon +1 op 1,08', 1.08, 1, 440 * 2 ** (1 / 12)],
  ];
  for (const [naam, R, st, verwacht] of gevallen) {
    const [L] = await renderStretch(fabriek, sBron, 1, 4, R, { semitonen: st });
    const f = frequentie(L, SR, 3 * SR);
    console.log(`  ${naam.padEnd(18)} ${f.toFixed(2)} Hz (verwacht ${verwacht.toFixed(2)}, ${(1200 * Math.log2(f / verwacht)).toFixed(2)} cent)`);
  }
  {
    // Zoals nu (renderBlok) ter vergelijking: pitch schuift mee.
    const paginas = new Map();
    const pcm = new Int16Array(s.length * 2);
    for (let i = 0; i < s.length; i++) pcm[i * 2] = pcm[i * 2 + 1] = Math.round(s[i] * 32767);
    for (let p = 0; p * PAGINA < s.length; p++) paginas.set(p, pcm.subarray(p * PAGINA * 2, Math.min(pcm.length, (p + 1) * PAGINA * 2)));
    const seg = { T: 0, P: 1, R: 1.08, loop: null, speelt: true };
    const bl = [new Float32Array(Q), new Float32Array(Q)], L = new Float32Array(3 * SR);
    for (let i = 0; i < L.length; i += Q) { renderBlok({ seg, paginas, uit: bl, frames: Q, t0: i / SR, ctxRate: SR, trackRate: SR, duur: 6 }); L.set(bl[0].subarray(0, Math.min(Q, L.length - i)), i); }
    console.log(`  zoals nu, rate 1,08  ${frequentie(L, 0, 2 * SR).toFixed(2)} Hz (pitch mee: ${(440 * 1.08).toFixed(2)})`);
  }

  console.log('\n== controle 2: hoorbare positie (regel 3 over de draadgrens) ==');
  console.log('  Klik op tracktijd x moet klinken op audiokloktijd T + (x - P) / R. Afwijking in ms:');
  const { L: kl, tijden } = klikken(30);
  const kBron = arrayBron(kl, kl, 0);
  for (const [naam, R, st, preset] of [['1,00', 1, 0, 'standaard'], ['0,92', 0.92, 0, 'standaard'], ['1,08', 1.08, 0, 'standaard'],
    ['1,00 toon +2', 1, 2, 'standaard'], ['1,08 goedkoper-gespreid', 1.08, 0, 'goedkoper-gespreid'], ['1,08 kort', 1.08, 0, 'kort']]) {
    const P = 0.3;
    const [L] = await renderStretch(fabriek, kBron, P, 25, R, { semitonen: st, preset });
    const afw = [];
    for (const x of tijden) {
      if (x < P + 0.1 || x > P + 24) continue;
      const verwacht = (x - P) / R;
      afw.push((piekRond(L, verwacht) - verwacht) * 1000);
    }
    const gem = afw.reduce((a, b) => a + b, 0) / afw.length;
    const max = Math.max(...afw.map(Math.abs));
    console.log(`  rate ${naam.padEnd(24)} gemiddeld ${gem.toFixed(2).padStart(6)} ms, grootste ${max.toFixed(2)} ms (${afw.length} klikken)`);
  }

  console.log('\n== controle 3: kleur zonder tempowijziging (keylock aan, rate 1,00, toon 0) ==');
  console.log('  Energie per octaafband t.o.v. het origineel (dB), 8 s; en het golfvormverschil:');
  console.log(`  ${''.padEnd(14)} ${BANDEN.map((f) => (f < 1000 ? `${f}` : `${f / 1000}k`).padStart(6)).join('')}   golfvorm`);
  for (const fr of FRAGMENTEN.slice(0, 4)) {
    const t = openTrack(fr.id);
    const van = VAN ?? fr.van;
    const { bron, L: oL, basis } = trackBron(t, van, 12);
    const [L] = await renderStretch(fabriek, bron, van, 10, 1);
    const o = Math.round(van * SR) - basis;
    const orig = oL.subarray(o + SR, o + 9 * SR), uit = L.subarray(SR, 9 * SR);
    let sig = 0, fout = 0;
    for (let i = 0; i < orig.length; i++) { sig += orig[i] ** 2; fout += (uit[i] - orig[i]) ** 2; }
    const banden = BANDEN.map((f) => db(rms(bandpass(uit, f), 0, uit.length) / rms(bandpass(orig, f), 0, orig.length)).toFixed(1).padStart(6));
    console.log(`  ${fr.naam.padEnd(14)} ${banden.join('')}   ${db(Math.sqrt(fout / sig)).toFixed(1)} dB`);
  }
  console.log('  (golfvorm rond 0 dB of hoger = de fase is anders, niet dat het slechter klinkt:');
  console.log('   een phase vocoder bouwt de golf opnieuw op. Keylock op 1,00 is dus niet "uit".)');

  console.log('\n== controle 4: springen met keylock (hotcue, play, seek) ==');
  console.log('  Klik precies op het doel. Wanneer klinkt hij, en op welke sterkte?');
  // Speelt vanaf 0,30 s (tussen de klikken) en springt op 2,00 s audioklok naar
  // de klik op 10,5025 s (midden van de stoot).
  const c0 = 2.0, doelX = tijden.find((x) => x > 10) - 0.0025 - 0.02;   // 20 ms vóór de stoot
  // Eén stretcher die al speelt en op c0 het bericht krijgt; T = c0 + `plan`.
  const lopend = (planVan) => async () => {
    const k = await Kern.maak(fabriek, {});
    const sp = new StretchSpeler(k, kBron);
    sp.zet({ T: 0, P: 0.3, R: 1 }); sp.voorrol(0, voorrolVan(k));
    const plan = planVan(k);
    const L = new Float32Array(4 * SR), R = new Float32Array(4 * SR);
    for (let i = 0; i < L.length; i += Q) { const t0 = i / SR; if (Math.abs(t0 - c0) < 1e-9) sp.zet({ T: c0 + plan, P: doelX, R: 1 }); sp.blok(t0, L, R, Q, i); }
    return { L, T: c0 + plan };
  };
  for (const [naam, maak] of [
    ['ter plekke seeken, T = nu', lopend(() => 0)],
    ['gepland seeken, T = nu + uitLat + blok', lopend((k) => (k.uitLat + Q) / SR)],
    ...[0, 1, 2].map((j) => [`verse stretcher, opwarmen ${['0', 'uitLat', 'blok'][j]}`, async () => {
      const k = await Kern.maak(fabriek, {});
      const voor = [0, k.uitLat, k.blok][j] / SR;
      const sp = new StretchSpeler(k, kBron);
      sp.zet({ T: c0, P: doelX, R: 1 });
      if (voor > 0) sp.voorrol(c0, voor); else { k.reset(); sp.eind = null; }
      const L = new Float32Array(4 * SR), R = new Float32Array(4 * SR);
      for (let i = Math.round(c0 * SR); i < L.length; i += Q) sp.blok(i / SR, L, R, Q, i);
      return { L, T: c0 };
    }]),
  ]) {
    const { L, T } = await maak();
    const verwacht = T + 0.02 + 0.0025;
    const piek = piekRond(L, verwacht + 0.05, 0.12);
    const a = Math.round(verwacht * SR), x = Math.round((doelX + 0.02 + 0.0025) * SR);
    const sterkte = db(rms(L, a - 120, a + 120) / rms(kl, x - 120, x + 120));
    console.log(`  ${naam.padEnd(40)} latentie ${((T - c0) * 1000).toFixed(0).padStart(3)} ms, klik op ${((piek - verwacht) * 1000).toFixed(1).padStart(6)} ms, sterkte ${sterkte.toFixed(1)} dB`);
  }

  // Op muziek: na de sprong tegen een stretcher die er al doorheen speelde.
  console.log('\n  Op muziek (sakamoto): energie na de sprong t.o.v. een stretcher die er al doorheen speelde, per 5 ms:');
  const t = openTrack(FRAGMENTEN[0].id);
  const van = VAN ?? FRAGMENTEN[0].van;
  const { bron } = trackBron(t, van, 25);
  const c = 3.0;                                  // het moment van de sprong (T)
  const doorlopend = await (async () => {
    const sp = new StretchSpeler(await Kern.maak(fabriek, {}), bron);
    sp.zet({ T: 0, P: van, R: 1 }); sp.voorrol(0, 0.3);
    const L = new Float32Array(6 * SR), R = new Float32Array(6 * SR);
    for (let i = 0; i < L.length; i += Q) sp.blok(i / SR, L, R, Q, i);
    return L;
  })();
  const varianten = [
    ...[0, 1, 2].map((j) => [`verse stretcher, opwarmen ${['0', 'uitLat', 'blok'][j]}`, async () => {
      const k = await Kern.maak(fabriek, {});
      const voor = [0, k.uitLat, k.blok][j] / SR;
      const sp = new StretchSpeler(k, bron);
      sp.zet({ T: 0, P: van, R: 1 });
      if (voor > 0) sp.voorrol(c, voor); else { k.reset(); sp.eind = null; }
      const L = new Float32Array(6 * SR), R = new Float32Array(6 * SR);
      for (let i = Math.round(c * SR); i < L.length; i += Q) sp.blok(i / SR, L, R, Q, i);
      return L;
    }]),
    ['gepland seeken (speelde elders)', async () => {
      const k = await Kern.maak(fabriek, {});
      const sp = new StretchSpeler(k, bron);
      sp.zet({ T: 0, P: van + 12, R: 1 }); sp.voorrol(0, voorrolVan(k));
      // Bericht één blok vóór het laatste moment: marge voor de berichtvertraging.
      const bericht = c - (k.uitLat + 2 * Q) / SR;
      let gezet = false;
      const L = new Float32Array(6 * SR), R = new Float32Array(6 * SR);
      for (let i = 0; i < L.length; i += Q) {
        const t0 = i / SR;
        if (!gezet && t0 >= bericht) { sp.zet({ T: c, P: van + c, R: 1 }); gezet = true; }
        sp.blok(t0, L, R, Q, i);
      }
      return L;
    }],
  ];
  for (const [naam, maak] of varianten) {
    const L = await maak();
    const regel = [];
    for (let m = 0; m < 60; m += 5) {
      const a = Math.round((c + m / 1000) * SR), b = a + Math.round(0.005 * SR);
      regel.push(db(rms(L, a, b) / rms(doorlopend, a, b)).toFixed(1).padStart(6));
    }
    console.log(`  ${naam.padEnd(34)} ${regel.join(' ')}  dB (0-60 ms)`);
  }

  console.log('\n== controle 5: tempo wijzigen tijdens keylock, zonder plannen (T = nu) ==');
  console.log('  Afwijking van de hoorbare positie (ms, min/max over 12 wisselmomenten), per tijdvak na de wissel:');
  const { L: kl2, tijden: t2 } = klikken(20, 0.3);
  const kBron2 = arrayBron(kl2, kl2, 0);
  for (const [R0, R1] of [[1, 1.08], [1, 0.92], [1, 1.04], [1.04, 1]]) {
    const punten = [];
    for (let kk = 0; kk < 12; kk++) {
      const k = await Kern.maak(fabriek, {});
      const sp = new StretchSpeler(k, kBron2);
      const s0 = { T: 0, P: 0.3, R: R0 };
      sp.zet(s0); sp.voorrol(0, voorrolVan(k));
      const cw = Math.round((3.0 + kk * 0.025) * SR / Q) * Q / SR;
      const s1 = { T: cw, P: s0.P + cw * R0, R: R1 };
      const L = new Float32Array(6 * SR), R = new Float32Array(6 * SR);
      for (let i = 0; i < L.length; i += Q) { const t0 = i / SR; if (Math.abs(t0 - cw) < 1e-9) sp.zet(s1); sp.blok(t0, L, R, Q, i); }
      for (const x of t2) {
        const tv = x <= s1.P ? (x - s0.P) / s0.R : cw + (x - s1.P) / s1.R;
        if (tv < cw - 0.2 || tv > cw + 1.2) continue;
        punten.push([tv - cw, (piekRond(L, tv, 0.03) - tv) * 1000]);
      }
    }
    const vakken = [[-0.2, 0], [0, 0.03], [0.03, 0.06], [0.06, 0.09], [0.09, 0.15], [0.15, 0.6], [0.6, 1.2]];
    const rij = vakken.map(([a, b]) => {
      const v = punten.filter((p) => p[0] >= a && p[0] < b).map((p) => p[1]);
      return `${(a * 1000).toFixed(0)}..${(b * 1000).toFixed(0)}: ${v.length ? `${Math.min(...v).toFixed(1)}/${Math.max(...v).toFixed(1)}` : '-'}`;
    });
    console.log(`  ${`${R0} -> ${R1}`.padEnd(11)} ${rij.join('  ')}`);
  }
  console.log('  (verwacht: binnen de eerste uitLat hooguit uitLat × ΔR, daarna weer ±0,5 ms)');
}

// ---- meten ------------------------------------------------------------------------

/** CPU-tijd van DEZE thread in µs: telt niet mee als een ander proces de kern heeft. */
const threadCpu = () => { const u = process.threadCpuUsage(); return u.user + u.system; };

/**
 * Meten op een drukke machine. De rekenlast per quantum is deterministisch
 * (zelfde invoer, zelfde toestand), dus: `herhaal` keer draaien en per
 * quantum het MINIMUM nemen. Wat een ander proces of de GC erbij deed valt
 * dan weg. Het gemiddelde komt uit de CPU-tijd van de thread (beste run).
 */
async function meetReeks(maakStap, { sec, opwarm = 3, herhaal = 3 }) {
  const n = Math.round((sec + opwarm) * SR / Q), start = Math.round(opwarm * SR / Q);
  const min = new Float64Array(n - start).fill(Infinity);
  let cpuMin = Infinity;
  for (let h = 0; h < herhaal; h++) {
    const stap = await maakStap();
    let c0 = 0;
    for (let i = 0; i < n; i++) {
      if (i === start) c0 = threadCpu();
      const a = performance.now();
      stap(i * Q / SR);
      const d = (performance.now() - a) * 1000;
      if (i >= start && d < min[i - start]) min[i - start] = d;
    }
    cpuMin = Math.min(cpuMin, threadCpu() - c0);
  }
  return { min, msPerSec: cpuMin / 1000 / sec };
}

async function meetEen(maakSpeler, { sec = 20, opwarm = 3, herhaal = 3 } = {}) {
  const L = new Float32Array(Q), R = new Float32Array(Q);
  const { min, msPerSec } = await meetReeks(async () => { const sp = await maakSpeler(); return (t0) => sp(t0, L, R); }, { sec, opwarm, herhaal });
  let som = 0; for (const x of min) som += x;
  // Quanta waarin een STFT-blok valt: alles boven 5× de mediaan (niet-gespreid).
  const p50 = pct(min, 0.5);
  const blok = [...min].filter((x) => x > Math.max(40, 5 * p50));
  return {
    msPerSec, kern: msPerSec / 10, p50, p99: pct(min, 0.99), max: Math.max(...min), gem: som / min.length,
    blokMediaan: blok.length ? pct(blok, 0.5) : null, blokDeel: blok.length / min.length,
  };
}

function regelMeting(naam, r) {
  return `  ${naam.padEnd(36)} ${r.msPerSec.toFixed(1).padStart(6)} ms/s  ${r.kern.toFixed(2).padStart(5)} %  `
    + `p50 ${r.p50.toFixed(0).padStart(4)}  p99 ${r.p99.toFixed(0).padStart(5)}  max ${r.max.toFixed(0).padStart(5)} µs`
    + (r.blokMediaan ? `  blokquantum ${r.blokMediaan.toFixed(0).padStart(5)} µs (${(100 * r.blokDeel).toFixed(1)}%)` : '');
}

async function meet() {
  const fabriek = laadFabriek();
  const fr = FRAGMENTEN[0];
  const t = openTrack(fr.id);
  const van = VAN ?? fr.van;
  const { bron } = trackBron(t, van, 40);
  const sec = Number(arg('--sec') ?? 20);

  const speler = (R, semitonen = 0, preset = 'standaard', formant = false) => async () => {
    const k = await Kern.maak(fabriek, { preset });
    if (formant) k.formant(0, true, 0);
    const sp = new StretchSpeler(k, bron);
    sp.zet({ T: 0, P: van, R }); sp.toon(semitonen); sp.voorrol(0, voorrolVan(k));
    return (t0, L, Rr) => sp.blok(t0, L, Rr, Q);
  };

  console.log(`\n  belasting van de machine (load average 1/5/15 min): ${os.loadavg().map((x) => x.toFixed(1)).join(' / ')} op ${os.cpus().length} kernen`);
  console.log(`\n== meten: één stereodeck, ${sec} s audio na 3 s opwarmen, ${fr.naam} vanaf ${van} s, 3× (minimum per quantum) ==`);
  console.log(`  budget per quantum van 128 frames: ${BUDGET_US.toFixed(0)} µs; ms/s en % = CPU-tijd van de thread, van één kern`);
  console.log(`  blokquantum = mediaan van de quanta waarin een STFT-blok valt (niet gespreid rekent alles daar)`);
  {
    const p0 = Math.floor(((van - 1) * SR) / PAGINA), p1 = Math.floor(((van + sec * 1.1 + 5) * SR) / PAGINA);
    const paginas = leesPaginas(t.bestand, t.kop, p0, p1, PAGINA);
    const huidig = (R) => async () => {
      const seg = { T: 0, P: van, R, loop: null, speelt: true }; const staat = { env: 1 };
      return (t0, L, Rr) => renderBlok({ seg, paginas, uit: [L, Rr], frames: Q, t0, ctxRate: SR, trackRate: SR, duur: t.duur, staat });
    };
    console.log(regelMeting('zoals nu (renderBlok) 1,08', await meetEen(huidig(1.08), { sec })));
  }
  const rijen = [
    ['keylock 1,00', 1, 0], ['keylock 0,92', 0.92, 0], ['keylock 0,95', 0.95, 0], ['keylock 1,05', 1.05, 0], ['keylock 1,08', 1.08, 0],
    ['toon -2', 1, -2], ['toon -1', 1, -1], ['toon +1', 1, 1], ['toon +2', 1, 2],
  ];
  const uitkomst = {};
  for (const preset of ['standaard', 'standaard-gespreid', 'goedkoper', 'goedkoper-gespreid', 'kort']) {
    console.log(`  -- ${preset} --`);
    const lijst = preset === 'standaard' ? rijen : rijen.filter(([n]) => n === 'keylock 1,08' || n === 'toon +2' || n === 'keylock 0,92');
    for (const [naam, R, st] of lijst) {
      const r = await meetEen(speler(R, st, preset), { sec });
      uitkomst[`${preset}|${naam}`] = r;
      console.log(regelMeting(naam, r));
    }
    if (preset === 'standaard') console.log(regelMeting('toon +2 met formantbehoud', await meetEen(speler(1, 2, 'standaard', true), { sec })));
  }

  // De schil van Signalsmith zelf (optie C): constant seeken, allocaties per blok.
  console.log('  -- hun AudioWorkletProcessor (optie C), nagebootst --');
  const Klasse = laadProcessor();
  for (const [naam, config, R, st] of [
    ['standaard, keylock 1,08', null, 1.08, 0], ['standaard, toon +2', null, 1, 2],
    ['cheaper, keylock 1,08', { blockMs: 0, preset: 'cheaper' }, 1.08, 0],
    ['standaard gespreid, keylock 1,08', { blockMs: 120, intervalMs: 30, splitComputation: true }, 1.08, 0],
  ]) {
    const r = await meetEen(async () => {
      globalThis.currentTime = 0;
      const p = await maakProcessor(Klasse);
      if (config) p.roep('configure', config);
      const { L, R: Rk } = leesStuk(t.bestand, t.kop, Math.round(van * SR), Math.round((sec * 1.2 + 5) * SR));
      p.roep('addBuffers', [L, Rk]);
      p.roep('schedule', { active: true, input: 0, output: 0, rate: R, semitones: st });
      const uit = [[new Float32Array(Q), new Float32Array(Q)]];
      return (t0) => { globalThis.currentTime = t0; p.process([[]], uit, {}); };
    }, { sec });
    console.log(regelMeting(naam, r));
  }

  // Op een M1 onder belasting zet macOS een gewone thread soms op een
  // efficiëntiekern (2-3× trager). Chrome's audiothread is realtime en krijgt
  // een prestatiekern. Daarom ook: de snelste van 15 losse seconden.
  console.log('\n== meten: snelste seconde van 15 (benadert een prestatiekern) ==');
  {
    const p0 = Math.floor(((van - 1) * SR) / PAGINA), p1 = Math.floor(((van + 25) * SR) / PAGINA);
    const paginas = leesPaginas(t.bestand, t.kop, p0, p1, PAGINA);
    const L = new Float32Array(Q), Rr = new Float32Array(Q);
    const snelste = async (naam, maak) => {
      const stap = await maak();
      const per = SR / Q;
      for (let i = 0; i < 3 * per; i++) stap(i * Q / SR);      // opwarmen (JIT)
      const s = [];
      for (let r = 0; r < 15; r++) {
        const c = threadCpu();
        for (let i = 0; i < per; i++) stap((3 + r) + i * Q / SR);
        s.push((threadCpu() - c) / 1000);
      }
      s.sort((a, b) => a - b);
      console.log(`  ${naam.padEnd(36)} snelste ${s[0].toFixed(1).padStart(5)} ms/s (${(s[0] / 10).toFixed(2)}% van een kern), mediaan ${s[7].toFixed(1)} ms/s`);
      return s[0];
    };
    await snelste('zoals nu (renderBlok) 1,08', async () => {
      const seg = { T: 0, P: van, R: 1.08, loop: null, speelt: true }; const staat = { env: 1 };
      return (t0) => renderBlok({ seg, paginas, uit: [L, Rr], frames: Q, t0, ctxRate: SR, trackRate: SR, duur: t.duur, staat });
    });
    for (const preset of ['standaard', 'standaard-gespreid', 'goedkoper', 'goedkoper-gespreid', 'kort']) {
      await snelste(`${preset}, keylock 1,08`, async () => { const f = await speler(1.08, 0, preset)(); return (t0) => f(t0, L, Rr); });
    }
  }

  // Opwarmen (verse stretcher bij een sprong): wat kost dat in één keer?
  console.log('\n== meten: opwarmen bij een sprong (in één keer; minimum en mediaan van 25) ==');
  for (const preset of ['standaard', 'goedkoper', 'kort']) {
    const k0 = await Kern.maak(fabriek, { preset });
    const regel = [];
    for (const [wat, voor] of [['uitLat', k0.uitLat], ['blok', k0.blok]]) {
      const tijden = [];
      for (let i = 0; i < 30; i++) {
        const k = await Kern.maak(fabriek, { preset });
        const sp = new StretchSpeler(k, bron);
        sp.zet({ T: 0, P: van + i * 0.37, R: 1.05 });
        const a = performance.now();
        sp.voorrol(0, voor / SR);
        tijden.push((performance.now() - a) * 1000);
      }
      regel.push(`${wat} (${(voor / 48).toFixed(0)} ms): min ${Math.min(...tijden.slice(5)).toFixed(0)} µs, mediaan ${pct(tijden.slice(5), 0.5).toFixed(0)} µs`);
    }
    console.log(`  ${preset.padEnd(12)} ${regel.join('   ')}`);
  }

  await achtDecks(fabriek, sec);
  console.log(`\n  belasting na afloop: ${os.loadavg().map((x) => x.toFixed(1)).join(' / ')}`);
  return uitkomst;
}

/** Acht decks tegelijk, per quantum opgeteld: wat de audiothread moet halen. */
async function achtDecks(fabriek, sec) {
  console.log(`\n== meten: acht decks tegelijk (${sec} s), som per quantum ==`);
  const bronnen = [];
  for (const fr of FRAGMENTEN) {
    const t = openTrack(fr.id);
    for (const extra of [0, 17]) {
      const van = Math.min(t.duur - sec * 1.2 - 5, (VAN ?? fr.van) + extra);
      bronnen.push({ ...trackBron(t, van, sec + 5), van });
    }
  }
  const rates = [0.92, 0.95, 0.97, 1, 1.02, 1.05, 1.08, 1];
  const tonen = [0, 0, 0, 2, 0, 0, 0, -1];
  console.log('  (3×, minimum per quantum; % = van het budget van 2667 µs per quantum)');
  for (const [naam, preset, gelijk] of [
    ['standaard, verspreid gestart', 'standaard', false], ['standaard, alle blokken tegelijk', 'standaard', true],
    ['standaard-gespreid, tegelijk', 'standaard-gespreid', true],
    ['goedkoper, verspreid gestart', 'goedkoper', false], ['goedkoper-gespreid, tegelijk', 'goedkoper-gespreid', true],
  ]) {
    const L = new Float32Array(Q), R = new Float32Array(Q);
    const { min: m, msPerSec } = await meetReeks(async () => {
      const decks = [];
      for (let d = 0; d < 8; d++) {
        const k = await Kern.maak(fabriek, { preset });
        const sp = new StretchSpeler(k, bronnen[d].bron);
        sp.zet({ T: 0, P: bronnen[d].van, R: rates[d] }); sp.toon(tonen[d]);
        // Verspreid: elk deck een ander aantal quanta opgewarmd, zodat de
        // STFT-blokken niet in hetzelfde quantum vallen. Tegelijk: allemaal gelijk.
        sp.voorrol(0, voorrolVan(k) + (gelijk ? 0 : Math.round((d * k.interval) / 8 / Q) * Q / SR));
        decks.push(sp);
      }
      return (t0) => { for (const sp of decks) sp.blok(t0, L, R, Q); };
    }, { sec });
    let som = 0, over = 0, over2 = 0;
    for (const x of m) { som += x; if (x > BUDGET_US) over++; if (x > BUDGET_US / 2) over2++; }
    // Per callback van 256/512 frames: wat Chrome op de Mac vaak vraagt.
    const perCallback = (q) => { let mx = 0; for (let i = 0; i + q <= m.length; i += q) { let s = 0; for (let j = 0; j < q; j++) s += m[i + j]; mx = Math.max(mx, s / (q * BUDGET_US)); } return mx; };
    console.log(`  ${naam.padEnd(34)} CPU ${(msPerSec / 10).toFixed(1).padStart(5)}% van een kern = ${(100 * som / m.length / BUDGET_US).toFixed(1).padStart(5)}% budget gem  `
      + `p99 ${pct(m, 0.99).toFixed(0).padStart(5)}  max ${Math.max(...m).toFixed(0).padStart(5)} µs  `
      + `boven budget ${(100 * over / m.length).toFixed(2)}%, boven de helft ${(100 * over2 / m.length).toFixed(1)}%  `
      + `zwaarste callback 256: ${(100 * perCallback(2)).toFixed(0)}%, 512: ${(100 * perCallback(4)).toFixed(0)}%`);
  }
}

// ---- luisterbestanden --------------------------------------------------------------

async function luister() {
  const fabriek = laadFabriek();
  const namen = titels();
  const kies = process.argv.slice(3).filter((a) => !a.startsWith('--') && !/^\d/.test(a));
  const lijst = kies.length ? FRAGMENTEN.filter((f) => kies.includes(f.naam) || kies.includes(f.id)) : FRAGMENTEN;
  console.log(`\n== luisterbestanden: ${DUUR} s per fragment naar ${path.relative(process.cwd(), UIT)}/ ==`);
  for (const fr of lijst) {
    const t = openTrack(fr.id);
    const van = VAN ?? fr.van;
    const map = path.join(UIT, fr.naam);
    fs.rmSync(map, { recursive: true, force: true });
    const { bron } = trackBron(t, van, DUUR);
    const a = performance.now();
    const w = (naam, data) => schrijfWav(path.join(map, `${naam}.wav`), data);
    w('01-origineel', renderHuidig(t, van, DUUR, 1));
    w('02-zoals-nu-0.92', renderHuidig(t, van, DUUR, 0.92));
    w('03-zoals-nu-1.08', renderHuidig(t, van, DUUR, 1.08));
    w('04-keylock-1.00', await renderStretch(fabriek, bron, van, DUUR, 1));
    w('05-keylock-0.92', await renderStretch(fabriek, bron, van, DUUR, 0.92));
    w('06-keylock-0.95', await renderStretch(fabriek, bron, van, DUUR, 0.95));
    w('07-keylock-1.05', await renderStretch(fabriek, bron, van, DUUR, 1.05));
    w('08-keylock-1.08', await renderStretch(fabriek, bron, van, DUUR, 1.08));
    w('09-toon-2', await renderStretch(fabriek, bron, van, DUUR, 1, { semitonen: -2 }));
    w('10-toon-1', await renderStretch(fabriek, bron, van, DUUR, 1, { semitonen: -1 }));
    w('11-toon+1', await renderStretch(fabriek, bron, van, DUUR, 1, { semitonen: 1 }));
    w('12-toon+2', await renderStretch(fabriek, bron, van, DUUR, 1, { semitonen: 2 }));
    w('13-keylock-1.08-goedkoper', await renderStretch(fabriek, bron, van, DUUR, 1.08, { preset: 'goedkoper-gespreid' }));
    w('14-keylock-1.08-kort', await renderStretch(fabriek, bron, van, DUUR, 1.08, { preset: 'kort' }));
    if (fr.naam === 'no-surprises') {
      w('15-toon+2-formantbehoud', await renderStretch(fabriek, bron, van, DUUR, 1, { semitonen: 2, formant: true }));
      w('16-toon-2-formantbehoud', await renderStretch(fabriek, bron, van, DUUR, 1, { semitonen: -2, formant: true }));
    }
    if (fr.loop) {
      // Loop van 4 tellen op het grid uit de library, 20 s lang, op 1,05.
      const g = grid(fr.id);
      const b = Math.ceil(g.beatAt(fr.loop) - 1e-9);
      const loop = { start: g.timeOf(b), end: g.timeOf(b + 4) };
      const { L: lL, R: lR, basis } = trackBron(t, loop.start, 10);
      w('15-loop-4-tellen-zoals-nu-1.05', renderLoopHuidig(t, loop, 20, 1.05));
      w('16-loop-4-tellen-keylock-1.05', await renderStretch(fabriek, loopArrayBron(lL, lR, basis, loop, SR), loop.start, 20 * 1.05, 1.05));
      fr.loopUitleg = `loop ${loop.start.toFixed(3)}–${loop.end.toFixed(3)} s (4 tellen, ${g.bpmAt(loop.start).toFixed(2)} bpm uit het grid)`;
    }
    const titel = namen.get(fr.id)?.titel ?? fr.id;
    fs.writeFileSync(path.join(map, 'BRON.txt'), `${titel}\n${fr.id}, vanaf ${van} s, ${DUUR} s tracktijd\n${fr.soort}\n${fr.loopUitleg ? `15/16: ${fr.loopUitleg}\n` : ''}`);
    console.log(`  ${fr.naam.padEnd(14)} ${fs.readdirSync(map).filter((n) => n.endsWith('.wav')).length} bestanden, ${((performance.now() - a) / 1000).toFixed(1)} s  (${titel.slice(0, 50)})`);
  }
  const luisterMd = path.join(HIER, 'LUISTER.md');
  if (fs.existsSync(luisterMd)) fs.copyFileSync(luisterMd, path.join(UIT, 'LUISTER.md'));
}

// ---- opdrachten ----------------------------------------------------------------------

async function alles() { await info(); await controle(); await meet(); await luister(); }

/** Alleen de acht decks: gevoelig voor belasting, dus los te herhalen. */
async function acht() {
  console.log(`  belasting: ${os.loadavg().map((x) => x.toFixed(1)).join(' / ')}`);
  await achtDecks(laadFabriek(), Number(arg('--sec') ?? 20));
  console.log(`  belasting na afloop: ${os.loadavg().map((x) => x.toFixed(1)).join(' / ')}`);
}

const opdrachten = { haal, info, controle, meet, luister, alles, acht };
const opdracht = process.argv[2] || 'help';
if (!opdrachten[opdracht]) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 18).join('\n'));
} else {
  console.log(`keylock-proef ${new Date().toISOString().slice(0, 16)}, Node ${process.version}, media: ${MEDIA}`);
  await opdrachten[opdracht]();
}
