/**
 * Gedeeld door de metingen: de v2-server op een eigen poort, headless Chrome met
 * Playwright, en een pagina met de echte app (window.varve = de engine).
 * Playwright staat globaal (deze machine: /opt/node22; elders: PLAYWRIGHT_MODULE).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

export async function opzet({ poort, media = '/geen-media', viewport = { width: 1440, height: 900 }, args = [] } = {}) {
  process.env.VARVE_V2_POORT = String(poort);
  const { maakServer } = await import(join(APP, 'server.mjs'));
  const server = maakServer({ media });
  await new Promise((r) => server.listen(poort, '127.0.0.1', r));
  const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', ...args] });
  const page = await browser.newPage({ viewport });
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
  await page.goto(`http://localhost:${poort}/`);
  await page.waitForFunction(() => window.varve);
  await page.evaluate(async () => { await window.varve.ctx.resume(); await window.varve.klaar; await window.varve.mixer.klaar; });
  const cdp = await page.context().newCDPSession(page);
  return {
    server, browser, page, cdp, fouten,
    async sluit() { await browser.close(); server.close(); },
  };
}

/** In de pagina: een nummer laden uit de demolijst, of een toon (sinus, constant). */
export const LAAD_IN_PAGINA = `
  window.__laad = async (n, wat) => {
    const e = window.varve;
    const { maakDemo, DEMOS, PAGINA } = await import('/src/ui/bronnen.js');
    if (wat.toon) {
      const sr = 48000, duur = wat.duur ?? 60, frames = sr * duur, f = wat.toon;
      const paginas = [];
      for (let p = 0; p * PAGINA < frames; p++) {
        const a = new Int16Array(PAGINA * 2);
        for (let i = 0; i < PAGINA && p * PAGINA + i < frames; i++) { const v = Math.round(Math.sin(2 * Math.PI * f * (p * PAGINA + i) / sr) * 0.5 * 32767); a[2 * i] = v; a[2 * i + 1] = v; }
        paginas.push(a);
      }
      const grid = { stukken: [{ van: 0, bpm: wat.bpm ?? 120, anker: 0 }], slot: true };
      return e.laad(n, { id: 'toon-' + f, titel: 'toon ' + f, duur, grid, haal: async () => ({ sr, kanalen: 2, frames, paginas }) });
    }
    const def = DEMOS.find((d) => d.id === wat.demo);
    const d = maakDemo({ ...def, duur: wat.duur ?? def.duur });
    return e.laad(n, { id: def.id + (wat.duur ? '-' + wat.duur : ''), titel: def.titel, duur: d.duur, grid: d.grid, haal: async () => d.maakPcm() });
  };
`;

export const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const gem = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, min: s[0], mediaan: q(0.5), p95: q(0.95), max: s.at(-1), gem, spreiding: Math.sqrt(s.reduce((a, b) => a + (b - gem) ** 2, 0) / s.length) };
};
