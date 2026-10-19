/**
 * De vergelijkingspagina headless in de interne stand (zonder kabel): hoe strak synct v2 de
 * kliksporen, ook het zwervende spoor C (een tempokaart van 96 stukken)?
 *
 *   node v2/meting/kliksporen.mjs && node v2/meting/vergelijk-intern.mjs [seconden=90]
 *
 * Op de Mac is dit de nul-meting naast de loopback: verschil tussen intern en via de kabel =
 * wat de geluidskaart toevoegt (moet 0 spreiding toevoegen).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const SEC = Number(process.argv[2] || 90);
const POORT = 8794;
const srv = spawn(process.execPath, [join(HIER, 'server.mjs')], { env: { ...process.env, VARVE_METING_POORT: String(POORT), VARVE_MEDIA: '/geen-media' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const uit = {};
try {
  for (const spoor of ['b-128', 'c-zwerft']) {
    const page = await browser.newPage();
    const fouten = [];
    page.on('pageerror', (e) => fouten.push(String(e)));
    await page.goto(`http://localhost:${POORT}/meting/vergelijk.html`);
    await page.check('#intern');
    await page.selectOption('#spoor', spoor);
    await page.fill('#sec', String(SEC));
    await page.click('#v2');
    await page.waitForFunction(() => window.__uitslag?.app === 'v2', null, { timeout: (SEC + 60) * 1000 });
    uit[spoor] = await page.evaluate(() => window.__uitslag);
    if (fouten.length) uit[spoor].fouten = fouten;
    await page.close();
  }
} finally { await browser.close(); srv.kill(); }
console.log(JSON.stringify(uit, null, 2));
const ok = Object.values(uit).every((u) => u.spreidingMs <= 1 && Math.abs(u.driftMsPerMin) <= 0.5 && u.maxMs <= 2);
console.log(ok ? 'v2 intern: GESLAAGD (spreiding ≤ 1 ms, drift ≤ 0,5 ms/min, max ≤ 2 ms)' : 'v2 intern: NIET GEHAALD');
process.exitCode = ok ? 0 : 1;
