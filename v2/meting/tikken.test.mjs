// @alleen: echte Chrome in echte tijd (~1 min), tikken op de audioklok
/**
 * De tikpagina in echte Chrome (Playwright, headless) op een synthetisch nummer waarvan elke tel bekend is
 * (124 bpm, kick op de tel, hi-hat ertussen, ruis eronder). Gesimuleerde tikken: toetsaanslagen
 * (KeyboardEvent, dus event.timeStamp) op de tel + 60 ms "hand" + jitter (σ 6 ms, hooguit 15 ms).
 *   1. kalibreren: 16 tikken op de klik → ~60 ms
 *   2. tikken zonder snap: na de kalibratie rond de echte tel (de jitter blijft)
 *   3. snap alle: elke tik binnen ±5 ms van de echte tel
 *   4. opnieuw tikken over een stuk met snap aan: vervangt, verdubbelt niet
 *   5. bewaren (download + localStorage), herladen = terug, en grid-eval op het bestand: M12 gehaald.
 *
 *   node --test v2/meting/tikken.test.mjs        (Playwright globaal: /opt/node22 of PLAYWRIGHT_MODULE)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
let chromium = null;
try { chromium = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/')('playwright').chromium; } catch {}

const SR = 48000, DUUR = 30, BPM = 124, ANKER = 0.5, L = 60 / BPM;
const TELLEN = []; for (let t = ANKER; t < DUUR - 0.3; t += L) TELLEN.push(t);
const LAT = 0.060, SIGMA = 0.006, KLEM = 0.015;

/** Het nummer als 16-bit stereo WAV: kick op elke tel (begint precies op de tel), hi-hat ertussen, ruis. */
function maakWav() {
  let x = 12345;
  const ruis = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2147483648 - 1; };
  const n = SR * DUUR, s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = 0.01 * ruis();
  const zet = (t, lengte, f) => { const a = Math.round(t * SR); for (let i = 0; i < lengte * SR && a + i < n; i++) s[a + i] += f(i / SR); };
  for (const t of TELLEN) {
    zet(t, 0.002, () => 0.35 * ruis());                                                      // het klikje van de slag
    zet(t, 0.25, (u) => 0.7 * Math.sin(2 * Math.PI * (55 * u + 90 * 0.03 * (1 - Math.exp(-u / 0.03)))) * Math.exp(-u / 0.09));
    zet(t + L / 2, 0.04, (u) => 0.12 * ruis() * Math.exp(-u / 0.012));                       // hi-hat op de tegentel
  }
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))); buf.writeInt16LE(v, 44 + 4 * i); buf.writeInt16LE(v, 46 + 4 * i); }
  return buf;
}

async function vrijePoort() {
  const s = createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port; await new Promise((r) => s.close(r)); return p;
}

/** In de pagina: toetsaanslagen op de tellen die je hoort (+ hand + jitter), elk vlak ervoor gepland. */
const PLAN = async ({ doelen, lat, sigma, klem, zaad, vanKlik }) => {
  let x = zaad >>> 0;
  const u = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const g = () => { let t = 0; for (let i = 0; i < 12; i++) t += u(); return t - 6; };
  const st = window.tik.st, c = st.ctx;
  const slaap = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
  // Waar de klok die je hoort NU staat (zoals een mens het geluid volgt, ook als de audio even hapert).
  const naarMs = (T) => { const ts = c.getOutputTimestamp(); return ts.performanceTime + (T - ts.contextTime) * 1000; };
  const fout = [];
  for (const d of doelen) {
    const T = vanKlik ? d.t : st.t0 + (d.t - st.p0) / st.rate;   // audiokloktijd waarop deze tel klinkt
    const j = Math.max(-klem, Math.min(klem, sigma * g()));
    let wanneer = naarMs(T + lat + j);
    if (wanneer - performance.now() > 60) { await slaap(wanneer - performance.now() - 40); wanneer = naarMs(T + lat + j); }
    await slaap(wanneer - performance.now());
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', shiftKey: !!d.een, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    fout.push(j);
  }
  return fout;
};

test('tikken.html: kalibreren, tikken, snappen, bewaren, en grid-eval op het resultaat', { skip: chromium ? false : 'Playwright niet gevonden (PLAYWRIGHT_MODULE)', timeout: 180000 }, async () => {
  const map = mkdtempSync(join(tmpdir(), 'tikken-'));
  const poort = await vrijePoort();
  let srv, browser;
  try {
    // Een library zoals die van v1: library.db + media/<id>/audio.wav.
    mkdirSync(join(map, 'synth'));
    writeFileSync(join(map, 'synth', 'audio.wav'), maakWav());
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(map, 'library.db'));
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, titel TEXT, uploader TEXT, duur REAL, audio TEXT, grid_json TEXT, toegevoegd INTEGER)');
    db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?)').run('synth', 'Synthetisch 124', 'proef', DUUR, 'media/synth/audio.wav',
      JSON.stringify({ stukken: [{ van: 0, bpm: BPM, anker: ANKER, zekerheid: 0.9, maat: ANKER }], beatsPerBar: 4, bron: 'auto' }), 1);
    db.close();

    srv = spawn(process.execPath, [join(HIER, 'tik-server.mjs')], { env: { ...process.env, VARVE_TIK_POORT: String(poort), VARVE_MEDIA: map }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((r, f) => { srv.stdout.on('data', (d) => { if (String(d).includes('Tikken')) r(); }); srv.on('exit', (c) => f(new Error(`tik-server stopte (${c})`))); });

    // De server: alleen tikken.html en /api, alleen van deze machine.
    const basis = `http://localhost:${poort}`;
    assert.equal((await fetch(`${basis}/meting/beat-eval.mjs`)).status, 404);
    assert.equal((await fetch(`${basis}/index.html`)).status, 404);
    assert.equal((await fetch(`${basis}/api/library`)).status, 200);
    assert.equal((await fetch(`${basis}/api/library`, { headers: { origin: 'http://elders.example' } })).status, 403);
    assert.equal((await fetch(`${basis}/`, { redirect: 'manual' })).headers.get('location'), '/meting/tikken.html');

    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const fouten = [];
    page.on('pageerror', (e) => fouten.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
    await page.goto(`${basis}/meting/tikken.html`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#lijst button[data-id="synth"]');

    // 1. Kalibreren: 16× tikken op de klik.
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.tik.kliks && window.tik.st.ctx.getOutputTimestamp().contextTime > 0);
    const kliks = await page.evaluate(() => window.tik.kliks.slice(2, 2 + 16).map((t) => ({ t })));
    await page.evaluate(PLAN, { doelen: kliks, lat: LAT, sigma: SIGMA, klem: KLEM, zaad: 7, vanKlik: true });
    await page.waitForFunction(() => window.tik.st.kal && !window.tik.st.kalibratie, null, { timeout: 5000 });
    const kal = await page.evaluate(() => window.tik.st.kal);
    console.log(`kalibratie ${kal.ms.toFixed(2)} ms ± ${kal.spreiding_ms.toFixed(2)} (gesimuleerde hand ${LAT * 1000} ms)`);
    assert.ok(Math.abs(kal.ms - LAT * 1000) < 8, `kalibratie ${kal.ms} ms`);

    // 2. Het nummer, snap uit, tikken van 1 s tot 21 s; de "1" op elke vierde tel.
    await page.click('#lijst button[data-id="synth"]');
    await page.waitForFunction(() => window.tik.st.buffer && window.tik.st.aanslag);
    await page.keyboard.press('a');
    assert.equal(await page.evaluate(() => window.tik.st.autosnap), false);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.tik.st.speelt && window.tik.st.ctx.getOutputTimestamp().contextTime > window.tik.st.t0);
    const doel = TELLEN.map((t, k) => ({ t, een: k % 4 === 0 })).filter((d) => d.t >= 1 && d.t <= 21);
    await page.evaluate(PLAN, { doelen: doel, lat: LAT, sigma: SIGMA, klem: KLEM, zaad: 11 });
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    const meet = async () => {
      const tikken = await page.evaluate(() => window.tik.st.tikken.map((k) => ({ ...k })));
      const fout = tikken.map((k) => { let d = Infinity; for (const t of TELLEN) if (Math.abs(k.t - t) < Math.abs(d)) d = k.t - t; return d * 1000; });
      const abs = fout.map(Math.abs).sort((a, b) => a - b);
      const med = [...fout].sort((a, b) => a - b)[fout.length >> 1];
      return { tikken, fout, max: abs.at(-1), mediaan: med, p95: abs[Math.floor(abs.length * 0.95)] };
    };
    const ruw = await meet();
    console.log(`zonder snap: ${ruw.tikken.length} tikken, fout mediaan ${ruw.mediaan.toFixed(2)} ms, p95 ${ruw.p95.toFixed(2)}, max ${ruw.max.toFixed(2)} ms`);
    assert.equal(ruw.tikken.length, doel.length);
    assert.ok(Math.abs(ruw.mediaan) < 6 && ruw.max < 28, JSON.stringify({ mediaan: ruw.mediaan, max: ruw.max }));
    assert.deepEqual(ruw.tikken.map((k) => k.een), doel.map((d) => d.een));

    // 3. Snap alle: binnen ±5 ms van de echte tel.
    await page.keyboard.press('Shift+S');
    const snap = await meet();
    console.log(`na snap: fout mediaan ${snap.mediaan.toFixed(2)} ms, max ${snap.max.toFixed(2)} ms, ${snap.tikken.filter((k) => k.s).length} gesnapt`);
    assert.equal(snap.tikken.length, doel.length);
    assert.ok(snap.max <= 5, `grootste fout na snap ${snap.max} ms`);
    assert.ok(snap.tikken.every((k) => k.s));

    // 4. Opnieuw tikken over 6–12 s met snap aan: de oude tikken daar worden vervangen.
    await page.keyboard.press('a');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');    // 5 s
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.tik.st.speelt && window.tik.st.ctx.getOutputTimestamp().contextTime > window.tik.st.t0);
    const opnieuw = doel.filter((d) => d.t >= 6 && d.t <= 12);
    await page.evaluate(PLAN, { doelen: opnieuw, lat: LAT, sigma: SIGMA, klem: KLEM, zaad: 23 });
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    const na = await meet();
    console.log(`opnieuw getikt (${opnieuw.length}): ${na.tikken.length} tikken, max fout ${na.max.toFixed(2)} ms`);
    assert.equal(na.tikken.length, doel.length);
    assert.ok(na.max <= 5, `grootste fout ${na.max} ms`);

    // 5. Bewaren: download + localStorage; herladen zet ze terug.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('d')]);
    assert.equal(dl.suggestedFilename(), 'tikken-synth.json');
    const bestand = join(map, 'tikken-synth.json');
    await dl.saveAs(bestand);
    const json = JSON.parse(readFileSync(bestand, 'utf8'));
    assert.equal(json.id, 'synth');
    assert.equal(json.titel, 'Synthetisch 124');
    assert.equal(json.tellen.length, doel.length);
    assert.equal(json.enen.length, doel.filter((d) => d.een).length);
    assert.ok(Math.abs(json.kalibratie_ms - kal.ms) < 1e-9);
    assert.ok(!Number.isNaN(Date.parse(json.gemaakt)));
    assert.ok(json.tellen.every((t, i) => i === 0 || t > json.tellen[i - 1]));
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Shift+D')]);
    assert.match(dl2.suggestedFilename(), /^tikken-alle-\d{4}-\d\d-\d\d\.json$/);
    await page.reload();
    await page.waitForSelector('#lijst button[data-id="synth"]');
    assert.match(await page.textContent('#lijst button[data-id="synth"]'), new RegExp(`${doel.length} tikken`));
    await page.click('#lijst button[data-id="synth"]');
    await page.waitForFunction((n) => window.tik.st.buffer && window.tik.st.tikken.length === n, doel.length);
    assert.ok((await page.evaluate(() => window.tik.st.kal.ms)) === kal.ms);
    assert.deepEqual(fouten, []);

    // En grid-eval op wat er getikt is, via dezelfde server: het (goede, zekere) grid haalt M12.
    const uit = await new Promise((r) => execFile(process.execPath, [join(HIER, 'grid-eval.mjs'), '--tikken', bestand, '--server', basis], { encoding: 'utf8' }, (e, so, se) => r({ code: e ? e.code : 0, so, se })));
    assert.equal(uit.code, 0, uit.so + uit.se);
    assert.match(uit.so, /M12: GEHAALD/);
  } finally {
    await browser?.close();
    srv?.kill();
    rmSync(map, { recursive: true, force: true });
  }
});
