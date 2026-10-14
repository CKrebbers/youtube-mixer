// De zeven effecten van spoor S10 (src/engine/fx-s10.js, docs/EFFECTEN-MEER.md) en de sjablonen in de
// ECHTE Web Audio van Chrome, op een OfflineAudioContext. Zelfde harnas en testsignaal als
// tools/headless/effecten.mjs (de effecten uit de filter app). Per effect:
//
//   1. eindig en begrensd: met elke knop op 0 en op 1 (ook de kam op ±97% feedback);
//   2. bypass = bit voor bit de invoer (de FX-knop van het rack en een effect dat uit staat);
//   3. hoorbaar op de standaard, en de LUIDHEID t.o.v. de invoer;
//   4. staart: na staart() is hij stil;
//   5. klikvrij: elke knop verzetten midden in een toon, een effectwissel, herankeren (duiker);
//   6. losse metingen: frequentieschuif, kam en klinker in Chrome;
//   7. CPU: acht tegelijk (acht tracks), ms rekentijd per seconde audio;
//   8. elk sjabloon: beginstand (moet droog zijn) en alle knoppen open (eindig, begrensd).
//
// Veilig met de APC aangesloten: geen MIDI, geen app (de pagina is /styles.css), eigen server en
// tijdelijke map (VARVE_TESTSERVER=1, alle VARVE_*), Chrome gedempt.
//
// Gebruik:  node tools/headless/effecten-meer.mjs [--snel]
// Poorten:  VARVE_KIJK_POORT (server), VARVE_KIJK_DEBUG (Chrome). Chromium: VARVE_CHROME.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8833, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9433;
const SNEL = process.argv.includes('--snel');
const tmp = mkdtempSync(join(tmpdir(), 'varve-effecten-meer-'));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return { pad: process.env.VARVE_CHROME, shell: false };
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    if (shell) {
      const map = join(cache, shell);
      const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
      if (sub) return { pad: join(map, sub, 'chrome-headless-shell'), shell: true };
    }
  }
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return { pad: execFileSync('which', [naam], { encoding: 'utf8' }).trim(), shell: false }; } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_SETS: join(tmp, 'sets'), VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const meldingen = [];
function cdp(method, params = {}) {
  const id = ++volg;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, fout) => wachtend.set(id, { ok, fout }));
}
async function evalueer(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// ---- wat in de pagina draait -----------------------------------------------------

const PAGINA = String.raw`(async () => {
  const fx = await import('/src/engine/fx.js');
  const meer = await import('/src/engine/fx-meer.js');
  const { EFFECTEN, effectVan, bouwKeten, InsertSlot } = fx;
  const SR = 48000;
  const s10 = await import('/src/engine/fx-s10.js');
  const NIEUW = s10.S10_EFFECTEN.map((e) => e.id);

  // Testsignaal: ruis (L en R deels anders) + sinussen. Vast zaad: elke run hetzelfde.
  function signaal(ctx, duur, { ruis = 0.06, sinus = [[440, 0.3]], stilVanaf = Infinity, stappen = false } = {}) {
    const n = Math.round(duur * SR), b = ctx.createBuffer(2, n, SR);
    const L = b.getChannelData(0), R = b.getChannelData(1);
    let x = 20261005, y = 4242;
    const stil = Math.round(stilVanaf * SR);
    for (let i = 0; i < n && i < stil; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
      const a = (x >>> 8) / 16777216 - 0.5, c = (y >>> 8) / 16777216 - 0.5;
      let s = 0;
      for (const [f, amp] of sinus) s += amp * Math.sin(2 * Math.PI * f * i / SR);
      // Stappen: elke kwart seconde om en om vol en −20 dB (voor de compressor).
      const env = stappen && Math.floor(i / (SR / 4)) % 2 ? 0.1 : 1;
      L[i] = env * (s + ruis * (a + 0.4 * c));
      R[i] = env * (s + ruis * (a - 0.4 * c));
    }
    return b;
  }
  const klok = (ctx) => () => ({ beatLengte: 0.5, ankerCtx: Math.ceil(ctx.currentTime / 0.5 + 1e-9) * 0.5 });

  /** Effect (of rack) bouwen op een offline context met dit signaal erin. */
  async function opzet(duur, keten, { sig = {}, slot = null } = {}) {
    const ctx = new OfflineAudioContext(2, Math.round(duur * SR), SR);
    await meer.laadFxWorklet(ctx);
    const inb = signaal(ctx, duur, sig);
    const src = new AudioBufferSourceNode(ctx, { buffer: inb });
    src.start();
    let k;
    if (slot) {
      k = new InsertSlot(ctx);
      k._ruimOp = () => {};                     // opruimen loopt op een gewone timer, los van deze klok
      k.setKlok(klok(ctx));
      slot(k);
      src.connect(k.in); k.out.connect(ctx.destination);
    } else {
      k = bouwKeten(ctx, keten, klok(ctx));
      src.connect(k.in); k.out.connect(ctx.destination);
    }
    return { ctx, inb, k };
  }
  const kanalen = (b) => [b.getChannelData(0), b.getChannelData(1)];
  const rms = (x, a = 0, z = x.length) => { let s = 0; for (let i = a; i < z; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, z - a)); };
  const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));

  // ---- 1. eindig en begrensd ----
  async function begrensd(id, stand, duur = 20) {
    const e = effectVan(id);
    const params = {};
    for (const p of e.params) params[p] = typeof stand === 'number' ? stand : (stand[p] ?? e.standaard[p]);
    const { ctx } = await opzet(duur, [{ slot: 'a', type: id, params }]);
    const b = await ctx.startRendering();
    let eindig = true, piek = 0;
    const perSec = [];
    for (const d of kanalen(b)) for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) { eindig = false; break; } if (Math.abs(v) > piek) piek = Math.abs(v); }
    const [L, R] = kanalen(b);
    for (let s = 0; s < duur; s++) perSec.push(Math.hypot(rms(L, s * SR, (s + 1) * SR), rms(R, s * SR, (s + 1) * SR)) / Math.SQRT2);
    const begin = Math.max(...perSec.slice(1, 4)), eind = Math.max(...perSec.slice(-3));
    return { eindig, piek, groeiDb: db(eind) - db(begin), eindDb: db(eind) };
  }

  // ---- 2. bypass ----
  async function bypass(id) {
    const e = effectVan(id), uit = {};
    // a. de FX-knop van het rack (InsertSlot.setBypass), mix op vol
    {
      const { ctx, inb } = await opzet(3, null, { slot: (s) => { s.zetRack({ name: 'b', chain: [{ slot: 'a', type: id, params: { ...e.standaard } }], macros: [] }); s.setMix(1); s.setBypass(true); } });
      const b = await ctx.startRendering();
      let mis = 0;
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c), x = inb.getChannelData(c); for (let i = 0; i < d.length; i++) if (d[i] !== x[i]) mis++; }
      uit.knop = mis;
    }
    // b. het effect staat uit in het rack (bypass: true), mix vol: na het inloopen
    {
      const { ctx, inb } = await opzet(3, null, { slot: (s) => { s.setMix(1); s.zetRack({ name: 'b', chain: [{ slot: 'a', type: id, bypass: true, params: { ...e.standaard } }], macros: [] }); } });
      const b = await ctx.startRendering();
      let mis = 0;
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c), x = inb.getChannelData(c); for (let i = SR; i < d.length; i++) if (d[i] !== x[i]) mis++; }
      uit.rack = mis;
    }
    return uit;
  }

  // ---- 3. hoorbaar ----
  function fftMag(x) {
    const N = x.length, re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    const m = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) m[i] = re[i] * re[i] + im[i] * im[i];
    return m;
  }
  const BANDEN = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  function banden(x) {
    const m = fftMag(x), N = x.length, uit = [];
    for (const f of BANDEN) { let s = 0; for (let k = Math.floor(f / Math.SQRT2 * N / SR); k < Math.ceil(f * Math.SQRT2 * N / SR); k++) s += m[k]; uit.push(10 * Math.log10(s + 1e-20)); }
    return uit;
  }
  function piekHz(x) { const m = fftMag(x); let k = 1; for (let i = 2; i < m.length; i++) if (m[i] > m[k]) k = i; return k * SR / x.length; }
  function modulatie(x) {
    const F = SR / 100, r = [];
    for (let i = 0; i + F <= x.length; i += F) r.push(rms(x, i, i + F));
    const gem = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(r.reduce((a, b) => a + (b - gem) ** 2, 0) / r.length) / (gem || 1);
  }
  function balans(L, R) {
    const F = SR / 100, r = [];
    for (let i = 0; i + F <= L.length; i += F) { const l = rms(L, i, i + F), q = rms(R, i, i + F); r.push((l - q) / (l + q + 1e-12)); }
    const gem = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(r.reduce((a, b) => a + (b - gem) ** 2, 0) / r.length);
  }
  function zijMidden(L, R) { let s = 0, m = 0; for (let i = 0; i < L.length; i++) { s += (L[i] - R[i]) ** 2; m += (L[i] + R[i]) ** 2; } return 10 * Math.log10((s + 1e-20) / (m + 1e-20)); }
  /** Verschil tussen de luide en de zachte kwartseconden (dB), van de invoer en van de uitvoer. */
  async function dynamiek(id) {
    const { ctx, inb } = await opzet(3, [{ slot: 'a', type: id, params: { ...effectVan(id).standaard } }], { sig: { stappen: true } });
    const b = await ctx.startRendering();
    const verschil = (d) => { let luid = 0, zacht = 0; for (let q = 4; q < 12; q++) { const r = rms(d, q * SR / 4 + SR / 20, (q + 1) * SR / 4 - SR / 20); if (q % 2) zacht += r; else luid += r; } return db(luid) - db(zacht); };
    return verschil(b.getChannelData(0)) - verschil(inb.getChannelData(0));
  }
  async function hoorbaar(id) {
    const e = effectVan(id);
    const dyn = await dynamiek(id);
    const { ctx, inb } = await opzet(2, [{ slot: 'a', type: id, params: { ...e.standaard } }]);
    const b = await ctx.startRendering();
    const N = 32768, a = SR;                       // vanaf 1 s: alles is ingelopen
    const [L, R] = kanalen(b), [xL, xR] = kanalen(inb);
    const uL = L.subarray(a, a + N), uR = R.subarray(a, a + N), iL = xL.subarray(a, a + N), iR = xR.subarray(a, a + N);
    const bu = banden(uL), bi = banden(iL);
    return {
      niveau: db(Math.hypot(rms(uL), rms(uR))) - db(Math.hypot(rms(iL), rms(iR))),
      spectrum: Math.max(...bu.map((v, i) => Math.abs(v - bi[i]))),
      modulatie: modulatie(uL) - modulatie(iL),
      balans: balans(uL, uR) - balans(iL, iR),
      stereo: zijMidden(uL, uR) - zijMidden(iL, iR),
      piek: piekHz(uL), piekIn: piekHz(iL), dynamiek: dyn,
    };
  }

  // ---- 4. staart ----
  async function staart(id, stand) {
    const e = effectVan(id), params = { ...e.standaard, ...stand };
    const ctx0 = new OfflineAudioContext(2, SR, SR);
    const k0 = bouwKeten(ctx0, [{ slot: 'a', type: id, params }], klok(ctx0));
    const belofte = k0.staart();
    k0.vernietig();
    const duur = 1 + belofte + 1;
    const { ctx } = await opzet(duur, [{ slot: 'a', type: id, params }], { sig: { stilVanaf: 1 } });
    const b = await ctx.startRendering();
    const [L, R] = kanalen(b);
    const ref = Math.max(rms(L, SR / 2, SR), rms(R, SR / 2, SR));
    // Na de belofte: het luidste blok van 10 ms, t.o.v. het geluid tijdens het signaal.
    let na = 0;
    for (let i = Math.round((1 + belofte + 0.01) * SR); i + 480 <= L.length; i += 480) na = Math.max(na, rms(L, i, i + 480), rms(R, i, i + 480));
    return { belofte, naDb: db(na) - db(ref) };
  }

  // ---- 5. klikvrij ----
  // Een lage sinus (110 Hz, 0,5): zijn tweede afgeleide is klein (~3e-4); een
  // sprong in het geluid geeft daar een piek. Drie vensters: vóór, tijdens de
  // overgang en ruim erna. Een klik = de overgang steekt boven allebei uit.
  function tweede(x, a, z) { let m = 0; for (let i = Math.max(2, a); i < z; i++) m = Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2])); return m; }
  async function klik(maak, doe, { duur = 2, op = 1 } = {}) {
    const ctx = new OfflineAudioContext(2, duur * SR, SR);
    await meer.laadFxWorklet(ctx);
    const inb = signaal(ctx, duur, { ruis: 0, sinus: [[110, 0.5]] });
    const src = new AudioBufferSourceNode(ctx, { buffer: inb });
    src.start();
    const k = maak(ctx);
    src.connect(k.in); k.out.connect(ctx.destination);
    ctx.suspend(op).then(() => { doe(k, ctx); ctx.resume(); });
    const b = await ctx.startRendering();
    let voor = 0, tijdens = 0, erna = 0;
    for (const d of kanalen(b)) {
      voor = Math.max(voor, tweede(d, Math.round((op - 0.4) * SR), Math.round((op - 0.02) * SR)));
      tijdens = Math.max(tijdens, tweede(d, Math.round(op * SR), Math.round((op + 0.15) * SR)));
      erna = Math.max(erna, tweede(d, Math.round((op + 0.4) * SR), Math.round((duur - 0.05) * SR)));
    }
    return { voor, tijdens, erna, ratio: tijdens / Math.max(voor, erna, 1e-6) };
  }
  async function klikParam(id, p, naar) {
    const e = effectVan(id);
    return klik((ctx) => bouwKeten(ctx, [{ slot: 'a', type: id, params: { ...e.standaard } }], klok(ctx)),
      (k, ctx) => k.zet('a.' + p, naar, ctx.currentTime));
  }
  async function klikWissel(id) {
    return klik((ctx) => { const s = new InsertSlot(ctx); s._ruimOp = () => {}; s.setKlok(klok(ctx)); s.setMix(1); s.zetEffect('filter'); return s; },
      (s) => s.zetEffect(id));
  }
  async function klikHeranker(id) {
    let bl = 0.5;
    return klik((ctx) => bouwKeten(ctx, [{ slot: 'a', type: id, params: { ...effectVan(id).standaard, diepte: 1 } }],
      () => ({ beatLengte: bl, ankerCtx: Math.ceil(ctx.currentTime / bl + 1e-9) * bl + 0.013 })),
    (k) => { bl = 0.47; k.heranker(); });
  }

  // ---- 6. losse metingen ----
  async function toonhoogte(st) {
    const ctx = new OfflineAudioContext(2, 2 * SR, SR);
    await meer.laadFxWorklet(ctx);
    const inb = signaal(ctx, 2, { ruis: 0, sinus: [[440, 0.5]] });
    const src = new AudioBufferSourceNode(ctx, { buffer: inb }); src.start();
    const k = bouwKeten(ctx, [{ slot: 'a', type: 'pitch', params: { interval: (st + 24) / 48, meng: 1 } }]);
    src.connect(k.in); k.out.connect(ctx.destination);
    const b = await ctx.startRendering();
    const x = b.getChannelData(0).subarray(SR, SR + 32768);
    const m = fftMag(x), N = x.length, doel = 440 * Math.pow(2, st / 12);
    let tot = 0, band = 0, bron = 0;
    for (let i = 1; i < m.length; i++) { const f = i * SR / N; tot += m[i]; if (Math.abs(f - doel) < 30) band += m[i]; if (Math.abs(f - 440) < 30) bron += m[i]; }
    return { doel, band: band / tot, bron: bron / tot };
  }
  async function wahVolgt() {
    const uit = [];
    for (const amp of [0.03, 0.5]) {
      const ctx = new OfflineAudioContext(2, 2 * SR, SR);
      await meer.laadFxWorklet(ctx);
      const inb = signaal(ctx, 2, { ruis: amp, sinus: [] });
      const src = new AudioBufferSourceNode(ctx, { buffer: inb }); src.start();
      const k = bouwKeten(ctx, [{ slot: 'a', type: 'autowah', params: { ...effectVan('autowah').standaard, meng: 1 } }]);
      src.connect(k.in); k.out.connect(ctx.destination);
      const b = await ctx.startRendering();
      const m = fftMag(b.getChannelData(0).subarray(SR, SR + 32768));
      let s = 0, w = 0;
      for (let i = 1; i < m.length; i++) { s += m[i]; w += m[i] * i * SR / 32768; }
      uit.push(w / s);
    }
    return { zacht: uit[0], hard: uit[1] };
  }
  async function compMeng() {
    // Drempel 0 dB: niets te comprimeren. Met meng 0,5 moet er dan niets dan
    // een niveau veranderen: geen kam (Chrome kijkt 6 ms vooruit).
    const uit = {};
    for (const [naam, wacht] of [['met', true], ['zonder', false]]) {
      const { ctx, inb, k } = await opzet(2, [{ slot: 'a', type: 'compressor', params: { ...effectVan('compressor').standaard, drempel: 1, makeup: 0.5, meng: 0.5 } }], { sig: { ruis: 0.2, sinus: [] } });
      if (!wacht) k.slots.get('a').inst._n.wacht.delayTime.value = 0;
      const b = await ctx.startRendering();
      const bu = banden(b.getChannelData(0).subarray(SR, SR + 32768)), bi = banden(inb.getChannelData(0).subarray(SR, SR + 32768));
      const d = bu.map((v, i) => v - bi[i]);
      uit[naam] = Math.max(...d) - Math.min(...d);
    }
    return uit;
  }
  async function vervormLuid() {
    const uit = {};
    for (const soort of meer.SOORTEN) {
      const r = [];
      for (const drive of [0, 0.5, 1]) {
        const { ctx, inb } = await opzet(1.5, [{ slot: 'a', type: 'distortion', params: { drive, soort: meer.SOORTEN.indexOf(soort) / 3, toon: 1, niveau: 0.5, meng: 1 } }], { sig: { ruis: 0.03, sinus: [[110, 0.2], [440, 0.1]] } });
        const b = await ctx.startRendering();
        r.push(db(rms(b.getChannelData(0), SR / 2)) - db(rms(inb.getChannelData(0), SR / 2)));
      }
      uit[soort] = r;
    }
    return uit;
  }
  async function aliasing() {
    // Hard, drive 1, sinus van 3150 Hz (geen deler van 48 kHz, anders valt alles
    // terug op een harmonische): wat er NIET op een harmonische valt is aliasing.
    const F = 3150;
    const { ctx } = await opzet(1, [{ slot: 'a', type: 'distortion', params: { drive: 1, soort: 1 / 3, toon: 1, niveau: 0.5, meng: 1 } }], { sig: { ruis: 0, sinus: [[F, 0.5]] } });
    const b = await ctx.startRendering();
    const m = fftMag(b.getChannelData(0).subarray(SR / 4, SR / 4 + 32768));
    let harm = 0, rest = 0;
    for (let i = 1; i < m.length; i++) { const f = i * SR / 32768, h = f / F; if (Math.abs(h - Math.round(h)) * F < 20) harm += m[i]; else rest += m[i]; }
    return 10 * Math.log10(rest / harm);
  }
  /** Luidheid t.o.v. droog met ALLEEN knop plek op v (de rest op hun beginstand). */
  async function sjabloonKnop(rack, plek, v) {
    const { ctx, inb } = await opzet(2.5, null, { slot: (s) => { s.zetRack(rack); s.setMix(1); s.setPlek(plek, v, { direct: true }); } });
    const b = await ctx.startRendering();
    const [L, R] = kanalen(b);
    return db(Math.hypot(rms(L, SR), rms(R, SR))) - db(Math.hypot(rms(inb.getChannelData(0), SR), rms(inb.getChannelData(1), SR)));
  }
  async function sjabloon(rack, knop) {
    const { ctx, inb } = await opzet(4, null, { slot: (s) => { s.zetRack(rack); s.setMix(1); for (const m of rack.macros) s.setPlek(m.place, knop ?? m.default ?? 0); } });
    const b = await ctx.startRendering();
    const [L, R] = kanalen(b);
    let eindig = true, piek = 0;
    for (const d of [L, R]) for (const v of d) { if (!Number.isFinite(v)) eindig = false; else piek = Math.max(piek, Math.abs(v)); }
    return { eindig, piek, niveau: db(Math.hypot(rms(L, SR), rms(R, SR))) - db(Math.hypot(rms(inb.getChannelData(0), SR), rms(inb.getChannelData(1), SR))) };
  }


  // ---- 6. losse metingen van S10 ----
  /** Het spectrum van één effect op een toon, na 1 s: de sterkste frequentie en hoeveel er rond doel zit. */
  async function spectrum(id, params, f0, doel, { duur = 2, ruis = 0 } = {}) {
    const { ctx } = await opzet(duur, [{ slot: 'a', type: id, params: { ...effectVan(id).standaard, ...params } }], { sig: { ruis, sinus: f0 ? [[f0, 0.4]] : [] } });
    const b = await ctx.startRendering();
    const x = b.getChannelData(0).subarray(SR, SR + 32768);
    const m = fftMag(x), N = x.length;
    let tot = 0, band = 0, bron = 0;
    for (let i = 1; i < m.length; i++) { const f = i * SR / N; tot += m[i]; if (doel !== null && Math.abs(f - doel) < 15) band += m[i]; if (f0 && Math.abs(f - f0) < 15) bron += m[i]; }
    return { piek: piekHz(x), band: band / tot, bron: bron / tot };
  }
  /** Het zwaartepunt van het spectrum op ruis (voor de klinker: a ↔ i). */
  async function zwaartepunt(id, params) {
    const { ctx } = await opzet(2, [{ slot: 'a', type: id, params: { ...effectVan(id).standaard, ...params } }], { sig: { ruis: 0.3, sinus: [] } });
    const b = await ctx.startRendering();
    const m = fftMag(b.getChannelData(0).subarray(SR, SR + 32768));
    let s = 0, w = 0;
    for (let i = 1; i < m.length; i++) { s += m[i]; w += m[i] * i * SR / 32768; }
    return w / s;
  }
  /** Energie rond 2290 Hz t.o.v. rond 1000 Hz (dB), klinker op ruis. */
  async function formant(params) {
    const { ctx } = await opzet(2, [{ slot: 'a', type: 'klinker', params: { ...effectVan('klinker').standaard, ...params } }], { sig: { ruis: 0.3, sinus: [] } });
    const b = await ctx.startRendering();
    const m = fftMag(b.getChannelData(0).subarray(SR, SR + 32768)), N = 32768;
    const band = (f0) => { let e = 0; for (let i = 1; i < m.length; i++) if (Math.abs(i * SR / N - f0) < 200) e += m[i]; return e; };
    return 10 * Math.log10(band(2290) / band(1000));
  }
  /** Luidheid t.o.v. de invoer op ruis + tonen (rms, dB), effect op zijn standaard. */
  async function luidheid(id, params = {}) {
    const { ctx, inb } = await opzet(3, [{ slot: 'a', type: id, params: { ...effectVan(id).standaard, ...params } }], { sig: { ruis: 0.08, sinus: [[110, 0.2], [440, 0.1], [1760, 0.05]] } });
    const b = await ctx.startRendering();
    const [L, R] = kanalen(b), [xL, xR] = kanalen(inb);
    return db(Math.hypot(rms(L, SR), rms(R, SR))) - db(Math.hypot(rms(xL, SR), rms(xR, SR)));
  }
  /**
   * CPU: n exemplaren van een effect naast elkaar (acht tracks), 10 s audio offline. Rekentijd
   * minus die van hetzelfde zonder effect, per seconde audio. Beste van drie.
   */
  async function cpu(id, n = 8, duur = 10) {
    const ronde = async (metEffect) => {
      const ctx = new OfflineAudioContext(2, duur * SR, SR);
      await meer.laadFxWorklet(ctx);
      const inb = signaal(ctx, duur, {});
      for (let k = 0; k < n; k++) {
        const src = new AudioBufferSourceNode(ctx, { buffer: inb }); src.start();
        if (metEffect) { const kk = bouwKeten(ctx, [{ slot: 'a', type: id, params: { ...effectVan(id).standaard } }], klok(ctx)); src.connect(kk.in); kk.out.connect(ctx.destination); }
        else { const g = ctx.createGain(); src.connect(g).connect(ctx.destination); }
      }
      const t0 = performance.now();
      await ctx.startRendering();
      return performance.now() - t0;
    };
    let met = Infinity, zonder = Infinity;
    for (let r = 0; r < 3; r++) { zonder = Math.min(zonder, await ronde(false)); met = Math.min(met, await ronde(true)); }
    return { msPerSec: Math.max(0, met - zonder) / duur, totaal: met / duur };
  }

  window.__fx = { NIEUW, params: Object.fromEntries(s10.S10_EFFECTEN.map((e) => [e.id, e.params])), standaard: Object.fromEntries(s10.S10_EFFECTEN.map((e) => [e.id, e.standaard])),
    begrensd, bypass, hoorbaar, staart, klikParam, klikWissel, klikHeranker, sjabloon, sjabloonKnop, spectrum, zwaartepunt, formant, luidheid, cpu };
  return NIEUW;
})()`;

const roep = (f, ...args) => evalueer(`window.__fx.${f}(${args.map((a) => JSON.stringify(a)).join(', ')})`);
const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);

try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/styles.css`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/styles.css` });
  for (let i = 0; i < 50; i++) { if (await evalueer('document.readyState === "complete"').catch(() => false)) break; await wacht(100); }
  const NIEUW = await evalueer(PAGINA);
  ok('geen MIDI in dit tabblad, de modules laden', await evalueer('!navigator.requestMIDIAccess') && NIEUW.length === 7, NIEUW.join(', '));
  const PARAMS = await evalueer('window.__fx.params');

  console.log('\n1. eindig en begrensd (ruis + 440 Hz)');
  const DUUR = SNEL ? 6 : 15;
  for (const id of NIEUW) {
    const standen = [0, 1];
    if (id === 'kam') standen.push({ toon: 0, feedback: 0, demping: 0, meng: 1 }, { toon: 1, feedback: 1, demping: 0, meng: 1 });
    const r = [];
    for (const s of standen) r.push(await roep('begrensd', id, s, DUUR));
    ok(`${id}: alles 0 / alles 1${standen.length > 2 ? ' / kam −97% en +97%' : ''}: eindig, niet aanzwellend (groei ${r.map((x) => f1(x.groeiDb)).join(' / ')} dB), piek ${r.map((x) => f2(x.piek)).join(' / ')}`,
      r.every((x) => x.eindig && x.groeiDb < 3 && x.piek < 8));
  }

  console.log('\n2. bypass = bit voor bit de invoer');
  for (const id of NIEUW) {
    const r = await roep('bypass', id);
    ok(`${id}: FX-knop uit en effect uit in het rack: ${r.knop} / ${r.rack} afwijkende samples`, r.knop === 0 && r.rack === 0);
  }

  console.log('\n3. hoorbaar en luidheid op de standaard');
  const LUID = {};
  for (const id of NIEUW) {
    const h = await roep('hoorbaar', id);
    const iets = Math.abs(h.niveau) > 1 || h.spectrum > 1.5 || h.modulatie > 0.05 || h.balans > 0.05 || Math.abs(h.stereo) > 1 || Math.abs(h.piek - h.piekIn) > 20 || Math.abs(h.dynamiek) > 1;
    LUID[id] = await roep('luidheid', id);
    const plus = (x, n = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(n)}`;
    // Een effect dat op 50/50 staat (kanteling vlak, aanslag 0/0) hoort NIETS te doen: dan is "niet hoorbaar" goed.
    const neutraal = id === 'kanteling' || id === 'aanslag';
    ok(`${id}: ${neutraal ? 'neutraal op de standaard: ' : ''}niveau ${plus(h.niveau)} dB, spectrum tot ${f1(h.spectrum)} dB, modulatie ${plus(h.modulatie, 2)}, dynamiek ${plus(h.dynamiek)} dB; luidheid ${plus(LUID[id])} dB t.o.v. de invoer`,
      (neutraal ? !iets && Math.abs(LUID[id]) < 0.3 : iets) && Math.abs(LUID[id]) < 6);
  }
  for (const [id, p, naam] of [['kanteling', { kanteling: 1 }, 'kanteling +6 dB'], ['kanteling', { kanteling: 0 }, 'kanteling −6 dB'], ['aanslag', { aanval: 1 }, 'aanval +100%'], ['aanslag', { sustain: 0 }, 'sustain −100%'],
    ['klinker', { reso: 1 }, 'klinker Q 20'], ['klinker', { reso: 0 }, 'klinker Q 3'], ['kam', { feedback: 1, meng: 1 }, 'kam +97% nat']]) {
    const l = await roep('luidheid', id, p);
    // Een kam op +97% laat tonen tussen zijn pieken bijna weg (dat is een kam); alleen melden.
    if (naam.startsWith('kam')) console.log(`      luidheid ${naam} (tonen tussen de pieken, geen eis): ${l >= 0 ? '+' : ''}${f1(l)} dB`);
    // Q 20: de make-up is begrensd op ×8 (een toon op een formant mag niet verder dan +18 dB): dan zachter.
    else if (naam === 'klinker Q 20') ok(`luidheid ${naam} (make-up begrensd op ×8): ${l >= 0 ? '+' : ''}${f1(l)} dB`, Math.abs(l) < 13);
    else ok(`luidheid ${naam}: ${l >= 0 ? '+' : ''}${f1(l)} dB`, Math.abs(l) < 9);
  }

  console.log('\n4. staart: na staart() is hij stil');
  const STAARTEN = { kam: [{ feedback: 1, toon: 0, demping: 0, meng: 1 }, { feedback: 0, toon: 0.5, meng: 1 }], klinker: [{ reso: 1, klinker: 0.5, schuif: 0 }], freqschuif: [{ meng: 1 }],
    band: [{ wow: 1, flutter: 1 }], kanteling: [{ kanteling: 1 }], aanslag: [{ aanval: 1 }], duiker: [{ diepte: 1 }] };
  for (const id of NIEUW) {
    const r = [];
    for (const st of STAARTEN[id]) r.push(await roep('staart', id, st));
    ok(`${id}: staart ${r.map((x) => x.belofte.toFixed(3)).join(' / ')} s, daarna ${r.map((x) => f1(x.naDb)).join(' / ')} dB t.o.v. het signaal`, r.every((x) => x.naDb < -60));
  }

  console.log('\n5. klikvrij: elke knop, een effectwissel, herankeren (110 Hz, tweede afgeleide)');
  for (const id of NIEUW) {
    const st = (await evalueer('window.__fx.standaard'))[id];
    const r = [];
    for (const p of PARAMS[id]) r.push([p, await roep('klikParam', id, p, st[p] < 0.5 ? 1 : 0)]);
    const slechtste = r.reduce((a, b) => (b[1].ratio > a[1].ratio ? b : a));
    ok(`${id}: elke knop naar het uiterste midden in het geluid, grootste overgang ×${f2(slechtste[1].ratio)} (${slechtste[0]})`,
      r.every(([, x]) => x.ratio < 2.5 || x.tijdens < 2e-3), r.filter(([, x]) => x.ratio >= 2.5).map(([p, x]) => `${p} ×${f2(x.ratio)} (${x.tijdens.toExponential(1)})`).join(', '));
    const w = await roep('klikWissel', id);
    ok(`${id}: wisselen vanaf het filter (kruisfade), ×${f2(w.ratio)}${w.ratio >= 2.5 ? ` (${w.tijdens.toExponential(1)})` : ''}`, w.ratio < 2.5 || w.tijdens < 2e-3);
  }
  const hd = await roep('klikHeranker', 'duiker');
  ok(`duiker: herankeren (tempo 120 → 128 bpm midden in het geluid), ×${f2(hd.ratio)}${hd.ratio >= 2.5 ? ` (${hd.tijdens.toExponential(1)})` : ''}`, hd.ratio < 2.5 || hd.tijdens < 2e-3);

  console.log('\n6. losse metingen in Chrome');
  for (const [schuif, hz] of [[0.6612, 105.0], [0.25, -250]]) {
    const r = await roep('spectrum', 'freqschuif', { schuif, meng: 1 }, 1000, 1000 + hz);
    ok(`frequentieschuif ${hz > 0 ? '+' : ''}${Math.round(hz)} Hz op 1 kHz: ${(r.band * 100).toFixed(1)}% rond ${Math.round(1000 + hz)} Hz, ${(r.bron * 100).toFixed(2)}% op 1 kHz`, r.band > 0.95 && r.bron < 0.01);
  }
  {
    const k = await roep('spectrum', 'kam', { toon: Math.log(220 / 30) / Math.log(2000 / 30), feedback: 0.97, demping: 0, meng: 1 }, null, null, { ruis: 0.2 });
    ok(`kam op 220 Hz (+92%, ruis erin): de sterkste toon ${Math.round(k.piek)} Hz (een veelvoud van 220)`, Math.abs(k.piek / 220 - Math.round(k.piek / 220)) < 0.04);
  }
  {
    // De tweede formant: bij i hoog (2290 Hz), bij a en o laag (1090 / 840 Hz). Gemeten: energie rond 2290 t.o.v. rond 1000.
    const r = {};
    for (const [k, t] of [['a', 0], ['i', 0.5], ['o', 0.75]]) r[k] = await roep('formant', { klinker: t, meng: 1, reso: 0.6 });
    ok(`klinker: hoog/laag (2,3 kHz t.o.v. 1 kHz) a ${f1(r.a)} dB, i ${f1(r.i)} dB, o ${f1(r.o)} dB: i het helderst`, r.i > r.a + 6 && r.i > r.o + 6);
  }

  console.log('\n7. CPU: acht tegelijk (acht tracks), 10 s audio offline, beste van drie');
  const CPU = {};
  for (const id of [...NIEUW, 'filter', 'delay', 'reverb', 'distortion']) {
    const c = await roep('cpu', id, 8, SNEL ? 4 : 10);
    CPU[id] = c.msPerSec;
    console.log(`      ${id.padEnd(11)} ${f2(c.msPerSec)} ms per s audio voor acht (${f2(c.msPerSec / 10)}% van een kern)${NIEUW.includes(id) ? '' : '  (ter vergelijking)'}`);
  }
  // Licht = acht tegelijk onder 10% van een kern (in deze meting de helft van de galm van fx.js).
  ok('elk nieuw effect: acht tegelijk onder 10% van een kern', NIEUW.every((id) => CPU[id] / 10 < 10), NIEUW.map((id) => `${id} ${f2(CPU[id] / 10)}%`).join(', '));

  console.log('\n7b. droog/nat per effect: lineair, geen bult (review S10: equal-power gaf tot +4 dB)');
  {
    const alle = JSON.parse((await import('node:fs')).readFileSync(join(WORTEL, 'racks/sjablonen.json'), 'utf8')).racks;
    // De menging zelf: een OPEN filter (de uitgang = de ingang) met droog/nat op knop 1. Lineair = overal 0 dB;
    // equal-power gaf hier halverwege +3 dB.
    const zuiver = { name: 'menging', chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5, reso: 0 }, meng: 0 }],
      macros: [{ place: 1, label: 'nat', default: 0, links: [{ target: 'a._nat', from: 0, to: 1 }] }] };
    const z = [];
    for (const v of [0, 0.25, 0.5, 0.75, 1]) z.push(await evalueer(`window.__fx.sjabloonKnop(${JSON.stringify(zuiver)}, 1, ${v})`));
    ok(`droog/nat van een open filter van 0 naar 1: ${z.map((x) => (x >= 0 ? '+' : '') + f2(x)).join(' ')} dB (lineair: geen bult)`, z.every((x) => Math.abs(x) < 0.2));
    // De Kleur-sjablonen: alleen melden. Daar komt bewust iets bij (echo, galm, vervorming) of gaat er iets af (filter).
    for (const naam of ['Kleur: crush', 'Kleur: dub', 'Kleur: ruimte']) {
      const rack = alle.find((r) => r.name === naam);
      const r = [];
      for (const v of [0, 0.15, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1]) r.push(await evalueer(`window.__fx.sjabloonKnop(${JSON.stringify(rack)}, 1, ${v})`));
      console.log(`      ${naam}: knop 1 van 0 naar 1: ${r.map((x) => (x >= 0 ? '+' : '') + f1(x)).join(' ')} dB t.o.v. droog (geen eis)`);
    }
    // De dub-worp: knop 1 open en weer dicht, het droge blijft vol (de delay krijgt een stuur).
    const dub = alle.find((r) => r.name === 'Dub-echo');
    const vol = await evalueer(`window.__fx.sjabloonKnop(${JSON.stringify(dub)}, 1, 1)`);
    ok(`Dub-echo knop 1 vol: ${vol >= 0 ? '+' : ''}${f1(vol)} dB t.o.v. droog (het nummer blijft, de echo komt erbij)`, vol > -1 && vol < 6);
  }

  console.log('\n8. sjablonen: beginstand (droog) en alle knoppen open');
  const { readFileSync } = await import('node:fs');
  const sjab = JSON.parse(readFileSync(join(WORTEL, 'racks/sjablonen.json'), 'utf8')).racks.filter((r) => r.uitleg);
  const INSERT = new Set(['Band zakt weg', 'Master-lijm', 'Zangband', 'Drum-punch', 'Kanteling', 'Kleur: filter', 'Tel-gate 1/8', 'Pomp', 'Break-kraker']);
  for (const rack of sjab) {
    const begin = await evalueer(`window.__fx.sjabloon(${JSON.stringify(rack)})`);
    const open = await evalueer(`window.__fx.sjabloon(${JSON.stringify(rack)}, 1)`);
    // "Alle knoppen open" zet ook een filterknop tegen de aanslag: dan is stil goed. Eis: eindig en begrensd.
    ok(`${rack.name}: beginstand ${begin.niveau >= 0 ? '+' : ''}${f1(begin.niveau)} dB, alle knoppen open ${open.niveau >= 0 ? '+' : ''}${f1(open.niveau)} dB, piek ${f2(open.piek)}`,
      begin.eindig && open.eindig && open.piek < 4 && Math.abs(begin.niveau) < (INSERT.has(rack.name) ? 2 : 0.5));
  }

  for (const m of meldingen) console.log(`  ! ${m}`);
  ok('geen uitzonderingen of console-fouten op de pagina', meldingen.length === 0, meldingen.length ? `${meldingen.length}` : '');
} catch (err) {
  console.error(err);
  uitkomst.push(['script', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL');
  server.kill('SIGINT');
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
