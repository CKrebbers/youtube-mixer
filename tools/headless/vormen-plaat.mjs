// Alle Vormmachines op één plaat (ROADMAP 7): elk systeem met een vast zaad
// na een vast aantal stappen van 1/60 s, als PNG, plus één contactblad. Zo
// zie je in één keer hoe elk systeem het 16:9-doek gebruikt (heel in het
// midden, of over de breedte), en of er iets stilvalt, ontploft of uitrekt.
//
// Hetzelfde als kijk.mjs waar het om veiligheid gaat: headless Chromium uit
// de Playwright-cache, navigator.requestMIDIAccess weg vóór de pagina laadt
// (geen tweede MIDI-client naast Clay's tabblad), een EIGEN server op een
// eigen poort met een tijdelijke database, media- en opnamemap. De server
// serveert alleen zijn witte lijst (src/ wel, tools/ niet): de pagina is een
// kaal document van die server en importeert de modules uit /src/. De app
// zelf start niet.
//
// De vormen draaien op de hoofdthread van de pagina (werker: false) op een
// echte OffscreenCanvas, met een meetklok die altijd 0 zegt: het budget grijpt
// dus niet in en de kwaliteit blijft wat je vraagt. Zelfde zaad, stappen en
// kwaliteit = zelfde plaat.
//
// Gebruik:
//   node tools/headless/vormen-plaat.mjs <uitmap> [--stappen 180] [--zaad 7] [--kwaliteit 1] [--alleen gs,ln]
// Poorten: VARVE_KIJK_POORT (server) en VARVE_KIJK_DEBUG (Chromium), standaard
// 8792 en 9338. Chromium: VARVE_CHROME of de headless shell uit de Playwright-cache.
//
// Uit: <uitmap>/<id>.png (640 × 360), <uitmap>/plaat.png (contactblad) en
// <uitmap>/plaat.json (per systeem: ms per stap, hoeveel er te zien is,
// hoeveel daarvan RECHTS van het oude vierkant ligt (x ≥ 1,05 H), het
// zwaartepunt (midden-x) en van waar tot waar er licht is (x-bereik, als
// deel van de breedte). Een systeem dat alleen een vierkant links tekent
// (zoals vóór ROADMAP 7) heeft rechts niets: "vierkant", midden-x ~0,28;
// een vorm heel in het midden heeft midden-x ~0,5 en een x-bereik van
// hooguit ~0,56 (de korte zijde); wie de breedte vult ~0,9 of meer.
// Faalt (exit 1) als een systeem gooit. De ms zijn headless op een drukke
// machine: vergelijk ze onderling, niet met het budget.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8792, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9338;

// ---- argumenten --------------------------------------------------------------
const args = process.argv.slice(2);
const vlag = (naam, standaard) => {
  const i = args.indexOf(`--${naam}`);
  if (i < 0) return standaard;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const STAPPEN = Number(vlag('stappen', 180));
const ZAAD = Number(vlag('zaad', 7));
const KWALITEIT = Number(vlag('kwaliteit', 1));
const ALLEEN = (vlag('alleen', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const UIT = resolve(args[0] || join(WORTEL, 'tools/headless/uit/vormen'));
if (!(STAPPEN >= 1 && Number.isInteger(STAPPEN)) || !Number.isInteger(ZAAD) || !(KWALITEIT >= 0.25 && KWALITEIT <= 1)) {
  console.error('gebruik: node tools/headless/vormen-plaat.mjs <uitmap> [--stappen 180] [--zaad 7] [--kwaliteit 0,25..1] [--alleen id,id]');
  process.exit(2);
}
mkdirSync(UIT, { recursive: true });

// ---- server en Chromium (zoals kijk.mjs) -------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'varve-plaat-'));
function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const nu = (d = new Date(), t = (x) => String(x).padStart(2, '0')) =>
  `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())} ${t(d.getHours())}:${t(d.getMinutes())}`;
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', 'about:blank',
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

// ---- wat er in de pagina draait -----------------------------------------------
// Eén functie per systeem (niet alles in één evaluate): 26 PNG's in één
// antwoord is onnodig groot, en een systeem dat vastloopt noemt zo zijn naam.
const IN_PAGINA = `(async () => {
  const { SYSTEMEN } = await import('/src/vormen/systemen.js');
  const { VormLaag, STAP, LAAG_BREEDTE, LAAG_HOOGTE } = await import('/src/vormen/laag.js');
  const maakCanvas = (w, h) => new OffscreenCanvas(w, h);
  window.__lagen = {};
  const naarB64 = async (canvas) => {
    const buf = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  };
  /** Wat er te zien is: pixels die boven de drempel van de lagenshader uitkomen (~5% boven #07090c). */
  const meet = (laag) => {
    const W = laag.canvas.width, H = laag.canvas.height, d = laag.ctx.getImageData(0, 0, W, H).data;
    // Rechts van het oude vierkant (x = H) tekent een niet-omgezet systeem
    // niets; een staart of lijndikte steekt er hooguit een paar pixels over
    // (Boids tot ~7 px). Vandaar 5% marge.
    const grens = Math.round(H * 1.05);
    let licht = 0, rechts = 0, somX = 0, x0 = W, x1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.max(d[i] - 7, d[i + 1] - 9, d[i + 2] - 12) > 12) {
        licht++; somX += x; if (x >= grens) rechts++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    return { licht: licht / (W * H), rechts: licht ? rechts / licht : 0, zwaartepuntX: licht ? somX / licht / W : null,
      bereikX: licht ? [x0 / W, (x1 + 1) / W] : null };
  };
  window.__plaat = async (id, stappen, zaad, kwaliteit) => {
    const sys = SYSTEMEN.find((s) => s.id === id);
    let laag = null, fout = null, ms = null;
    try {
      laag = new VormLaag({ maakCanvas, systeem: id, zaad, werker: false, nu: () => 0, kwaliteit });
      const t0 = performance.now();
      for (let i = 0; i < stappen; i++) {
        if (kwaliteit < 1) laag.zetKwaliteit(kwaliteit);    // het budget niet laten terugregelen
        laag.frame(i * STAP);
      }
      ms = (performance.now() - t0) / stappen;
    } catch (e) { fout = e.message; }
    if (!laag) return { id, naam: sys?.naam ?? id, fout };
    window.__lagen[id] = laag.canvas;
    return { id, naam: sys.naam, fout, ms, kwaliteit: laag.kwaliteit, maat: [laag.canvas.width, laag.canvas.height],
      ...meet(laag), png: await naarB64(laag.canvas) };
  };
  /** Het contactblad: elke vorm op halve maat met naam, 16:9 of vierkant, en ms per stap. */
  window.__blad = async (uitslagen, kop) => {
    const K = 5, TB = LAAG_BREEDTE / 2, TH = LAAG_HOOGTE / 2, LABEL = 26, GAT = 10, KOP = 44;
    const rijen = Math.ceil(uitslagen.length / K);
    const c = new OffscreenCanvas(GAT + K * (TB + GAT), KOP + rijen * (TH + LABEL + GAT) + GAT), x = c.getContext('2d');
    x.fillStyle = '#12151b'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#c9d3e6'; x.font = '600 18px sans-serif'; x.textBaseline = 'middle';
    x.fillText(kop, GAT, KOP / 2);
    uitslagen.forEach((u, i) => {
      const bx = GAT + (i % K) * (TB + GAT), by = KOP + Math.floor(i / K) * (TH + LABEL + GAT);
      const bron = window.__lagen[u.id];
      x.fillStyle = '#07090c'; x.fillRect(bx, by, TB, TH);
      if (bron) { x.imageSmoothingQuality = 'high'; x.drawImage(bron, bx, by, TB, TH); }
      x.strokeStyle = '#2a3140'; x.lineWidth = 1; x.strokeRect(bx - 0.5, by - 0.5, TB + 1, TH + 1);
      // Streepje op de grens van het oude vierkant (x = H), boven en onder de tegel.
      x.strokeStyle = '#5a6478'; x.beginPath();
      x.moveTo(bx + TH, by - 4); x.lineTo(bx + TH, by - 1); x.moveTo(bx + TH, by + TH + 1); x.lineTo(bx + TH, by + TH + 4); x.stroke();
      const soort = u.soort;
      const kleur = { FOUT: '#ff5a5a', leeg: '#8a93a6', vierkant: '#eea13c', '16:9': '#6cd49a' }[soort];
      x.font = '600 13px sans-serif'; x.fillStyle = '#e6ebf5';
      x.fillText(u.id + ' · ' + u.naam, bx, by + TH + LABEL / 2 + 1, TB - 110);
      x.textAlign = 'right'; x.fillStyle = kleur;
      x.fillText(soort + (u.ms != null ? ' · ' + u.ms.toFixed(1) + ' ms' : ''), bx + TB, by + TH + LABEL / 2 + 1);
      x.textAlign = 'left';
    });
    return naarB64(c);
  };
  return SYSTEMEN.map((s) => s.id);
})()`;

let fouten = 0;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  if (!doelen) throw new Error(`Chromium antwoordt niet op poort ${DEBUG}`);
  const pagina = doelen.find((d) => d.type === 'page');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
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
  let klaar = false;
  for (let i = 0; i < 50 && !klaar; i++) { klaar = await fetch(`http://localhost:${POORT}/styles.css`).then((r) => r.ok).catch(() => false); if (!klaar) await wacht(200); }
  if (!klaar) throw new Error(`de eigen server start niet op poort ${POORT}`);

  // Een kaal document van de eigen server (zelfde origin, dus /src/ importeren
  // mag), zonder de app: styles.css staat op de witte lijst en draait niets.
  const adres = `http://localhost:${POORT}/styles.css`;
  await cdp('Page.navigate', { url: adres });
  for (let i = 0; i < 50; i++) {
    if (await evalueer(`location.href === ${JSON.stringify(adres)} && document.readyState === 'complete'`).catch(() => false)) break;
    await wacht(200);
  }
  const alle = await evalueer(IN_PAGINA);
  if (await evalueer('!!navigator.requestMIDIAccess')) throw new Error('MIDI is nog zichtbaar in dit tabblad: gestopt');
  const ids = ALLEEN.length ? alle.filter((id) => ALLEEN.includes(id)) : alle;
  const onbekend = ALLEEN.filter((id) => !alle.includes(id));
  if (onbekend.length) console.log(`onbekend, overgeslagen: ${onbekend.join(', ')}`);

  console.log(`${ids.length} systemen · zaad ${ZAAD} · ${STAPPEN} stappen (${(STAPPEN / 60).toFixed(1)} s) · kwaliteit ${KWALITEIT}`);
  console.log('id  naam                       ms/stap  licht  rechts  midden-x  x-bereik   soort');
  const uitslagen = [];
  for (const id of ids) {
    const u = await evalueer(`window.__plaat(${JSON.stringify(id)}, ${STAPPEN}, ${ZAAD}, ${KWALITEIT})`);
    if (u.png) writeFileSync(join(UIT, `${id}.png`), Buffer.from(u.png, 'base64'));
    delete u.png;
    u.soort = u.fout ? 'FOUT' : u.licht < 0.001 ? 'leeg' : u.rechts < 0.005 ? 'vierkant' : '16:9';
    if (u.fout) fouten++;
    uitslagen.push(u);
    const pct = (v) => (v == null ? '   -' : `${(v * 100).toFixed(1).padStart(4)}%`);
    console.log(`${id.padEnd(3)} ${u.naam.padEnd(26).slice(0, 26)} ${(u.ms == null ? '-' : u.ms.toFixed(2)).padStart(7)}  ${pct(u.licht)}  ${pct(u.rechts)}  ${u.zwaartepuntX == null ? '    -' : u.zwaartepuntX.toFixed(2).padStart(8)}  ${u.bereikX ? u.bereikX.map((v) => v.toFixed(2)).join('–') : '    -    '}  ${u.soort}${u.fout ? ` (${u.fout})` : ''}`);
  }
  const kop = `Vormmachines · zaad ${ZAAD} · ${STAPPEN} stappen van 1/60 s · kwaliteit ${KWALITEIT} · ${uitslagen[0]?.maat?.join(' × ') ?? ''} · ${nu()}`;
  writeFileSync(join(UIT, 'plaat.png'), Buffer.from(await evalueer(`window.__blad(${JSON.stringify(uitslagen)}, ${JSON.stringify(kop)})`), 'base64'));
  writeFileSync(join(UIT, 'plaat.json'), JSON.stringify({ zaad: ZAAD, stappen: STAPPEN, kwaliteit: KWALITEIT, systemen: uitslagen }, null, 2));
  const tel = (s) => uitslagen.filter((u) => u.soort === s).length;
  console.log(`\n16:9: ${tel('16:9')} · vierkant: ${tel('vierkant')} · leeg: ${tel('leeg')} · fout: ${tel('FOUT')}`);
  if (meldingen.length) { console.log(`meldingen in de pagina:\n  ${meldingen.join('\n  ')}`); fouten += meldingen.length; }
  console.log(`plaat en PNG's in ${UIT}`);
} catch (err) {
  console.error(`FOUT: ${err.message}`);
  fouten++;
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
process.exit(fouten ? 1 : 0);
