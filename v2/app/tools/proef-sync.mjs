/**
 * Proef in echte Chrome (headless): klinkt een gesynct nummer op de tel van de klok?
 *
 *   node tools/proef-sync.mjs [--scherm uit.png]
 *
 * Twee demonummers (124 en 128 bpm, ander anker), track 1 start de klok, track 2
 * speelt eerst vrij en wordt dan gesynct. We nemen beide strips op (vóór de fader)
 * en vouwen de aanzetten van elk op de tel van de klok: valt de piek van B op die
 * van A, dan zit B op de tel. Daarna de klok naar 126 en nog eens.
 * Playwright staat globaal op de machine; de app zelf heeft geen afhankelijkheden.
 */
import { createRequire } from 'node:module';

// Playwright staat globaal (deze machine: /opt/node22; CI: npm root -g via PLAYWRIGHT_MODULE).
const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const POORT = 8791;
const schermPad = process.argv.includes('--scherm') ? process.argv[process.argv.indexOf('--scherm') + 1] : null;

process.env.VARVE_V2_POORT = String(POORT);   // vóór het laden: de server leest zijn poort bij het importeren
const { maakServer } = await import('../server.mjs');
const server = maakServer({ media: '/geen-media', data: (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'varve-v2-proef-')) });
await new Promise((r) => server.listen(POORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const fouten = [];
page.on('pageerror', (e) => fouten.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });

try {
  await page.goto(`http://localhost:${POORT}/`);
  await page.waitForFunction(() => window.varve);
  // Laden, starten en syncen zoals Clay het doet: met de muis, via het scherm.
  await page.evaluate(() => window.varve.ctx.resume());
  await page.locator('.bieb-rij', { hasText: 'Klokwerk 124' }).locator('.laad button').nth(0).click();      // -> track 1
  await page.locator('.bieb-rij', { hasText: 'Rechte lijn 128' }).locator('.laad button').nth(1).click();   // -> track 2
  await page.waitForFunction(() => window.varve.track(1).geladen && window.varve.track(2).geladen);
  await page.click('.track[data-n="1"] .b-play');
  await page.waitForTimeout(800);
  await page.click('.track[data-n="2"] .b-play');
  await page.waitForTimeout(1200);
  const uitslag = await page.evaluate(async () => {
    const e = window.varve;
    const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
    await e.ctx.resume();
    await e.klaar;
    await e.mixer.klaar;

    // Opnemer: twee ingangen (strip 1 en 2 na het filter), mono, N seconden.
    const code = `registerProcessor('opnemer', class extends AudioWorkletProcessor {
      constructor(o) { super(); this.n = o.processorOptions.n; this.a = new Float32Array(this.n); this.b = new Float32Array(this.n); this.i = 0; this.t0 = null; }
      process(ins) {
        if (this.i >= this.n) return false;
        if (this.t0 === null) this.t0 = currentTime;
        const a = ins[0][0], b = ins[1][0];
        for (let k = 0; k < 128 && this.i < this.n; k++, this.i++) { this.a[this.i] = a ? a[k] : 0; this.b[this.i] = b ? b[k] : 0; }
        if (this.i >= this.n) this.port.postMessage({ a: this.a, b: this.b, t0: this.t0 });
        return true;
      } });`;
    await e.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const neemOp = (sec) => new Promise((klaar) => {
      const sr = e.ctx.sampleRate;
      const node = new AudioWorkletNode(e.ctx, 'opnemer', { numberOfInputs: 2, numberOfOutputs: 0, processorOptions: { n: Math.round(sec * sr) } });
      e.track(1).strip.naFilter.connect(node, 0, 0);
      e.track(2).strip.naFilter.connect(node, 0, 1);
      node.port.onmessage = (m) => { node.disconnect?.(); e.track(1).strip.naFilter.disconnect(node); e.track(2).strip.naFilter.disconnect(node); klaar(m.data); };
    });
    // Aanzetten vouwen op de tel van de klok: waar in de tel zit de energie die stijgt?
    const vouw = (x, t0, klok) => {
      const sr = e.ctx.sampleRate, vak = 48;          // 1 ms
      const bins = new Float64Array(1000);
      let vorige = 0;
      for (let i = 0; i + vak <= x.length; i += vak) {
        let s = 0; for (let k = 0; k < vak; k++) s += x[i + k] * x[i + k];
        const groei = Math.max(0, s - vorige); vorige = s;
        const tel = klok.tel(t0 + i / sr);
        bins[Math.floor(((tel % 1) + 1) % 1 * 1000)] += groei;
      }
      let best = 0; for (let i = 1; i < 1000; i++) if (bins[i] > bins[best]) best = i;
      // Scherpte: deel van alle groei binnen ±10 ms van de piek.
      let som = 0, rond = 0;
      for (let i = 0; i < 1000; i++) { som += bins[i]; const d = Math.min(Math.abs(i - best), 1000 - Math.abs(i - best)); if (d <= 20) rond += bins[i]; }
      return { fase: best / 1000, scherp: rond / som };
    };
    const msTussen = (fa, fb, bpm) => { let d = fb - fa; d -= Math.round(d); return d * 60000 / bpm; };
    // Hoeveel ms B vóór (−) of na (+) A klinkt: kruiscorrelatie van de stijgende energie, per 0,25 ms.
    const lag = (a, b, bpm) => {
      const sr = e.ctx.sampleRate, vak = 12;
      const env = (x) => { const n = Math.floor(x.length / vak), u = new Float64Array(n); let vorige = 0; for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < vak; k++) s += x[j * vak + k] ** 2; u[j] = Math.max(0, s - vorige); vorige = s; } return u; };
      const ea = env(a), eb = env(b);
      const max = Math.floor((60 / bpm / 2) * sr / vak);
      let best = 0, bestL = 0;
      for (let L = -max; L <= max; L++) { let s = 0; for (let j = max; j < ea.length - max; j++) s += ea[j] * eb[j + L]; if (s > best) { best = s; bestL = L; } }
      return bestL * vak / sr * 1000;
    };

    const r = {};
    let o = await neemOp(3);
    let A = vouw(o.a, o.t0, e.klok), B = vouw(o.b, o.t0, e.klok);
    r.vrij = { A, B, bpm: e.klok.bpm(e.ctx.currentTime), verschilMs: msTussen(A.fase, B.fase, 124) };

    document.querySelector('.track[data-n="2"] .b-sync').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    await slaap(600);
    o = await neemOp(4);
    A = vouw(o.a, o.t0, e.klok); B = vouw(o.b, o.t0, e.klok);
    r.gesynct = { A, B, verschilMs: lag(o.a, o.b, 124), rate: e.track(2).snelheid(e.ctx.currentTime) };

    e.bus.doe('klok.tempo', (126 - 40) / 260);
    await slaap(800);
    o = await neemOp(4);
    A = vouw(o.a, o.t0, e.klok); B = vouw(o.b, o.t0, e.klok);
    r.klok126 = { A, B, verschilMs: lag(o.a, o.b, 126), bpm: e.klok.bpm(e.ctx.currentTime) };

    e.bus.doe('track.2.jog', 0.5 + 0.0625 / 0.5);   // 1/16 tel vooruit
    await slaap(600);
    o = await neemOp(4);
    A = vouw(o.a, o.t0, e.klok); B = vouw(o.b, o.t0, e.klok);
    r.jog = { verschilMs: lag(o.a, o.b, 126), verwachtMs: -60000 / 126 / 16 };   // B ligt voor: zijn kick klinkt eerder
    r.limiter = e.mixer.limiterStand?.();
    r.ctx = { sr: e.ctx.sampleRate, base: e.ctx.baseLatency, uit: e.ctx.outputLatency };
    return r;
  });
  if (schermPad) await page.screenshot({ path: schermPad });
  console.log(JSON.stringify(uitslag, null, 2));
  // Gesynct: B hooguit 1 ms naast A (de echte maat), en scherp op de tel van de klok (niet uitgesmeerd).
  // Scherpte als vaste grens, niet als deel van die van A: A schommelt met waar het venster van 4 s in
  // het nummer valt (gemeten 0,28–0,40 over 8 runs; 0,8 × A gaf 1 op 8 een valse fout in CI).
  // Gesynct lag B steeds op 0,29–0,39, vrij (128 tegen 124, uitgesmeerd) op 0,06–0,14.
  const SCHERP = 0.2;
  const ok = Math.abs(uitslag.gesynct.verschilMs) <= 1 && uitslag.gesynct.B.scherp > SCHERP && uitslag.vrij.B.scherp < SCHERP
    && Math.abs(uitslag.klok126.verschilMs) <= 1 && uitslag.klok126.B.scherp > SCHERP
    && Math.abs(uitslag.jog.verschilMs - uitslag.jog.verwachtMs) < 1.5 && !fouten.length;
  console.log(fouten.length ? `FOUTEN in de pagina:\n${fouten.join('\n')}` : 'geen fouten in de pagina');
  console.log(ok ? 'GESLAAGD: gesynct op de tel, ook na een tempowissel van de klok en een jog' : 'MISLUKT');
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
