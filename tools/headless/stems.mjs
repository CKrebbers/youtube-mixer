// De stems in de mixer, headless (docs/STEMS.md §4): binnenhalen met stems,
// splitsen, laden, de STEMS-rij, en kill per stem GEMETEN aan de master.
//
// Zelfde opzet als kijk-ingest.mjs: een EIGEN server op een eigen poort met een
// tijdelijke database en mediamap, de nep-yt-dlp (test/nep-ytdlp.mjs) en de
// nep-splitter (test/nep-stems.mjs via VARVE_STEMS_CMD: stem k = audio ×
// gewicht, twee = zang 0,75 · rest 0,25, vier = 0,1 · 0,2 · 0,3 · 0,4). Geen
// netwerk, geen Python. Chromium zonder navigator.requestMIDIAccess (veilig
// met de APC aangesloten; zie CLAUDE.md, "ÉÉN VARVE-tabblad").
//
// Gebruik:
//   node tools/headless/stems.mjs [uitmap]         na de integratie: server, engine en ui samen
//   node tools/headless/stems.mjs --nep [uitmap]   alleen de ui: /api/stems en de stem-actions
//                                                  nagebootst IN de pagina (layout, kolom, rij)
// Poorten:  VARVE_KIJK_POORT (8793) en VARVE_KIJK_DEBUG (9339).
// Splitter: VARVE_STEMS_CMD (standaard "node test/nep-stems.mjs", de server draait in de repo).
// Foto's:   1440×790 (laptop) en 1920×1080 in de uitmap (standaard tools/headless/uit).
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../server/ingest.js';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';

const NEP = process.argv.includes('--nep');
const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv.slice(2).find((a) => !a.startsWith('--')) || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8793, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9339;
const tmp = mkdtempSync(join(tmpdir(), 'varve-stems-'));
mkdirSync(UIT, { recursive: true });
const voor = NEP ? 'stems-nep' : 'stems';

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// Een constante toon: dan is het niveau aan de master stabiel en zie je de
// gewichten van de nep-splitter terug als verhouding (0,25 = zang weg).
const bron = join(tmp, 'bron.wav');
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', "aevalsrc='0.5*sin(2*PI*440*t)':s=48000:d=14", '-ac', '2', bron]);
const nepYtdlp = maakNepYtdlp(tmp);
// De server start in de repo (cwd), zodat een relatief commando werkt, ook als
// het pad van de repo spaties heeft (Clay's Bureaublad: "1. Projects").
const STEMS_CMD = process.env.VARVE_STEMS_CMD || 'node test/nep-stems.mjs';
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: nepYtdlp, NEP_BRON: bron,
    NEP_LOG: join(tmp, 'nep.log'), VARVE_STEMS_CMD: STEMS_CMD },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1920,1080',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
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
async function foto(naam) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}
async function maat(b, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: b, height: h, deviceScaleFactor: 1, mobile: false });
  await wacht(400);
}
/** Wachten tot een uitdrukking waar is (of maxMs voorbij). */
async function totdat(expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(150); }
  return false;
}
/**
 * Met de MUIS op een element, zoals Clay klikt (de knoppen van de bus luisteren
 * naar pointerdown/up, niet naar click). `shift` = met shift; `tijdens` draait
 * terwijl de knop ingedrukt is (meten tijdens een drukknop).
 */
async function muis(selector, { shift = false, ms = 80, tijdens = null, dubbel = false } = {}) {
  const p = await evalueer(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!p) return false;
  const mod = shift ? 8 : 0;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers: mod });
  for (let k = 1; k <= (dubbel ? 2 : 1); k++) {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: k, modifiers: mod });
    const uit = tijdens ? await tijdens() : (await wacht(ms), null);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: k, modifiers: mod });
    if (tijdens) { await wacht(60); return uit; }
  }
  await wacht(60);
  return true;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const bijna = (a, b, marge = 0.04) => Number.isFinite(a) && Math.abs(a - b) <= marge;

// ---- in de pagina ---------------------------------------------------------------

/** Een library-rij op (een deel van) de titel: stems-cel, knoppen, id. */
const rij = (deel) => `(() => { const r = [...document.querySelectorAll('#lib-panel .lib-rij')]
  .find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)})); if (!r) return null;
  const c = r.querySelector('.lib-stems');
  return { id: r.querySelector('button[data-deck]')?.dataset.id, stems: c?.textContent, soort: c?.className, titel: c?.title,
    knoppen: [...r.querySelectorAll('.lib-st')].map((b) => b.textContent + (b.disabled ? ':uit' : '')) }; })()`;
const knopInRij = (deel, sel) => `[...document.querySelectorAll('#lib-panel .lib-rij')].find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)}))?.querySelector(${JSON.stringify(sel)})`;
/** De STEMS-rij zoals je hem ziet. */
const RIJ = `(() => { const r = document.getElementById('stems'); const z = (e) => e && getComputedStyle(e).display !== 'none';
  return { open: z(r), track: r.querySelector('.st-track').textContent,
    stems: [...r.querySelectorAll('.st-stem')].filter(z).map((s) => ({ s: s.dataset.stem, naam: s.querySelector('.st-naam').textContent,
      niveau: Number(s.querySelector('.st-niveau').value), kill: s.querySelector('.st-kill').classList.contains('on'),
      weg: s.classList.contains('weg'), groep: s.classList.contains('groep') })),
    geen: z(r.querySelector('.st-geen')), soort: r.querySelector('.st-geen').dataset.soort || '', tekst: r.querySelector('.st-tekst').textContent,
    splits: z(r.querySelector('.st-splitsen')), splitsUit: [...r.querySelectorAll('.st-splits')].some((b) => b.disabled),
    x: z(r.querySelector('.st-x')), balk: z(r.querySelector('.st-balk')) }; })()`;
const teken = (deck) => `(() => { const e = document.querySelector('.kol[data-deck="${deck}"] .kol-stems');
  return e && getComputedStyle(e).display !== 'none' ? { tekst: e.textContent, soort: e.dataset.soort, titel: e.title } : null; })()`;
const status = () => evalueer("document.querySelector('#lib-panel .lib-status').textContent");
/**
 * Wachten tot de STEMS-rij `cond` laat zien (r = RIJ). Het scherm tekent in de
 * renderloop, en headless op een drukke machine haalt die soms maar 3 beelden
 * per seconde: nooit een vaste wachttijd na een klik.
 */
const rijWordt = (cond, ms = 15000) => totdat(`((r) => ${cond})(${RIJ})`, ms);
const onderaan = () => evalueer("[...document.querySelectorAll('#meldingen .melding')].map((m) => m.textContent).join(' | ')");
/** Het niveau (RMS) aan de master-analyser, gemiddeld over `ms`. */
const rms = (ms = 500) => evalueer(`(async () => {
  const a = window.engine.master.analyser, b = new Float32Array(a.fftSize);
  let som = 0, n = 0; const eind = performance.now() + ${ms};
  while (performance.now() < eind) { a.getFloatTimeDomainData(b); let s = 0; for (const x of b) s += x * x; som += s / b.length; n++;
    await new Promise((r) => setTimeout(r, 25)); }
  return Math.sqrt(som / Math.max(1, n)); })()`);
/**
 * Past het op dit scherm? De rij loopt niet over, alles staat binnen het
 * venster, de kolommen (met faders) staan er nog, en geen tekst onder 11 px.
 */
const LAYOUT = `(() => {
  const r = document.getElementById('stems'), W = innerWidth, H = innerHeight;
  const zicht = (e) => getComputedStyle(e).display !== 'none' && e.getClientRects().length;
  const els = [...r.querySelectorAll('*')].filter(zicht);
  const buiten = els.filter((e) => { const b = e.getBoundingClientRect(); return b.right > W + 0.5 || b.bottom > H + 0.5 || b.left < -0.5; }).map((e) => e.className);
  const klein = els.filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.className + ':' + getComputedStyle(e).fontSize);
  const kol = document.getElementById('kolommen').getBoundingClientRect();
  const fader = document.querySelector('.kol .vfader').getBoundingClientRect();
  const rb = r.getBoundingClientRect();
  return { buiten, klein, over: r.scrollWidth > r.clientWidth + 1, rijH: Math.round(rb.height), rijOnder: Math.round(rb.bottom),
    kolOnder: Math.round(kol.bottom), faderH: Math.round(fader.height), boven: Math.round(rb.top), H, W,
    paginaScroll: document.documentElement.scrollHeight > H + 1 || document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight + 1 };
})()`;
async function layout(naam) {
  const l = await evalueer(LAYOUT);
  ok(`${naam}: de rij past (niets erbuiten, geen overloop, ${l.rijH} px hoog)`, !l.buiten.length && !l.over && l.rijOnder <= l.H,
    l.buiten.length ? `buiten: ${l.buiten.slice(0, 5).join(', ')}` : '');
  ok(`${naam}: geen tekst onder 11 px in de rij`, !l.klein.length, l.klein.slice(0, 5).join(', '));
  ok(`${naam}: de kolommen staan boven de rij, faders ${l.faderH} px`, l.kolOnder <= l.boven + 1 && l.faderH >= 40,
    `kolommen tot ${l.kolOnder}, rij vanaf ${l.boven}`);
  return l;
}

// ---- nagebootst (alleen --nep): /api/stems en de stem-actions IN de pagina --------

/**
 * Een nep-server voor /api/stems in de pagina, plus de stems-velden in
 * /api/library (wat de server van het serverspoor straks meestuurt). De rest
 * gaat gewoon naar de echte (eigen) server. Draait vóór de app (elke pagina).
 */
function nepServer() {
  const nep = window.__nep = { opdrachten: [], beschikbaar: true, reden: null, stemsVan: {}, titels: {}, ingest: [], posts: [], n: 0, decks: {} };
  const echt = window.fetch.bind(window);
  const antwoord = (code, j) => new Response(JSON.stringify(j), { status: code, headers: { 'Content-Type': 'application/json' } });
  nep.zet = (id, w) => Object.assign(nep.opdrachten.find((o) => o.id === id), w);
  nep.klaar = (id) => {
    const o = nep.zet(id, { status: 'klaar', voortgang: 1, klaar: Date.now() });
    nep.stemsVan[o.track] = { aantal: o.aantal, namen: o.aantal === 4 ? ['drums', 'bass', 'other', 'vocals'] : ['vocals', 'inst'],
      schaal: 1, bestand: `media/${o.track}/stems.wav` };
    return o;
  };
  nep.van = (track) => nep.opdrachten.filter((o) => o.track === track).at(-1);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const methode = (init.method || 'GET').toUpperCase();
    if (url.pathname === '/api/stems' && methode === 'GET') {
      return antwoord(200, { opdrachten: nep.opdrachten, server: 'nep', beschikbaar: nep.beschikbaar, ...(nep.reden ? { reden: nep.reden } : {}) });
    }
    if (url.pathname === '/api/stems' && methode === 'POST') {
      const b = JSON.parse(init.body);
      nep.posts.push(b);
      if (!nep.beschikbaar) return antwoord(503, { fout: nep.reden || 'geen splitter' });
      if (nep.stemsVan[b.track]?.aantal === b.aantal && !b.opnieuw) return antwoord(200, { al: true, stems: nep.stemsVan[b.track] });
      const open = nep.opdrachten.find((o) => o.track === b.track && (o.status === 'wacht' || o.status === 'bezig'));
      if (open) return antwoord(200, { opdracht: open });
      const o = { id: `nep${++nep.n}`, track: b.track, titel: nep.titels[b.track] || b.track, aantal: b.aantal, status: 'wacht', voortgang: 0, begon: Date.now() };
      nep.opdrachten.push(o);
      return antwoord(202, { opdracht: o });
    }
    const weg = /^\/api\/stems\/(.+)$/.exec(url.pathname);
    if (weg && methode === 'DELETE') {
      const o = nep.opdrachten.find((x) => x.id === decodeURIComponent(weg[1]));
      if (!o) return antwoord(404, { fout: 'onbekend' });
      if (o.status === 'wacht' || o.status === 'bezig') o.status = 'geannuleerd';
      else nep.opdrachten = nep.opdrachten.filter((x) => x !== o);
      return antwoord(200, { ok: true });
    }
    if (url.pathname === '/api/ingest' && methode === 'POST') nep.ingest.push(JSON.parse(init.body));
    const r = await echt(input, init);
    if (url.pathname === '/api/library' && methode === 'GET' && r.ok) {
      const j = await r.json();
      for (const t of j.tracks || []) { nep.titels[t.id] = t.titel; if (nep.stemsVan[t.id]) t.stems = nep.stemsVan[t.id]; }
      return antwoord(r.status, j);
    }
    return r;
  };
}

/**
 * De stem-actions zoals het contract ze beschrijft (§3), zonder geluid:
 * read null zonder stems of voor een stem die in deze stand niet bestaat,
 * `inst` werkt bij twee en bij vier. `__nep.zetDeck(id, namen)` zet een track.
 */
async function nepActies() {
  const act = await import('/src/control/actions.js');
  const { DECK_IDS } = await import('/src/engine/engine.js');
  const nep = window.__nep;
  window.__act = act;
  DECK_IDS.forEach((id, i) => {
    const nr = i + 1;
    const st = () => nep.decks[id] || null;
    const bestaat = (s) => { const d = st(); return !!d && (s === 'inst' || d.namen.includes(s)); };
    for (const s of ['vocals', 'inst', 'drums', 'bass', 'other']) {
      const weg = () => (bestaat(s) ? (st().weg[s] || st().vast[s] ? 1 : 0) : null);
      act.define(`track.${nr}.stem.${s}`, 'value', (v) => { if (bestaat(s)) st().niveau[s] = v; },
        { label: `nep ${s}`, read: () => (bestaat(s) ? (st().niveau[s] ?? 1) : null) });
      act.define(`track.${nr}.stem.${s}.kill`, 'trigger', (on) => { if (on && bestaat(s)) st().weg[s] = !st().weg[s]; }, { label: `nep kill ${s}`, read: weg });
      act.define(`track.${nr}.stem.${s}.hold`, 'trigger', (on) => { if (bestaat(s)) st().vast[s] = !!on; }, { label: `nep hold ${s}`, read: weg });
    }
  });
  nep.zetDeck = (id, namen) => { nep.decks[id] = namen ? { namen, niveau: {}, weg: {}, vast: {} } : null; };
  return true;
}

// ---- de doorloop -----------------------------------------------------------------

async function binnenhalen(links, stems) {
  await evalueer(`document.querySelector('#lib-panel [data-stems-keuze="${stems}"]').click()`);
  await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = ${JSON.stringify(links.join(' '))};
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
}

async function doorloopNep() {
  console.log('nagebootst: /api/stems en de stem-actions in de pagina (ui-spoor, vóór de integratie)');
  ok('nep-acties staan op de bus', await evalueer(`(${nepActies})()`));
  ok('de stems-rij van de "server" is gelezen', await totdat('window.stemsWachtrij.beschikbaar === true && !window.stemsWachtrij.ontbreekt', 15000));

  console.log('\nde keuze bij het binnenhalen');
  await evalueer("document.getElementById('lib-btn').click()");
  const keuze = () => evalueer("[...document.querySelectorAll('#lib-panel [data-stems-keuze]')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.stemsKeuze).join()");
  ok('standaard: 2 (zang + rest)', (await keuze()) === '2', await keuze());
  await evalueer("document.querySelector('#lib-panel [data-stems-keuze=\"4\"]').click()");
  ok('4 gekozen: onthouden in localStorage', (await evalueer("localStorage.getItem('varve.stems.standaard')")) === '4');
  await cdp('Page.reload');
  await totdat('window.engine && window.stemsWachtrij', 20000);
  await evalueer(`(${nepActies})()`);
  await evalueer("document.getElementById('lib-btn').click()");
  ok('na herladen staat 4 er nog', (await keuze()) === '4', await keuze());
  await binnenhalen(['http://127.0.0.1:9/nep-a', 'http://127.0.0.1:9/nep-b'], 2);
  ok('naar de server: POST /api/ingest met stems: 2', await totdat('window.__nep.ingest.at(-1)?.stems === 2', 15000),
    JSON.stringify(await evalueer('window.__nep.ingest')));
  ok('beide nummers staan in de lijst', await totdat(`${rij('Nep nep-a')} && ${rij('Nep nep-b')}`, 60000));

  console.log('\nde kolom');
  let a = await evalueer(rij('Nep nep-a'));
  ok(`zonder stems: "—" met knoppen 2 · 4 (${JSON.stringify(a)})`, a.stems === '—' && a.knoppen.join() === '2,4');
  await evalueer("window.__nep.beschikbaar = false; window.__nep.reden = 'geen demucs'");
  await evalueer('window.stemsWachtrij.peil()');
  a = await evalueer(rij('Nep nep-a'));
  ok('splitter weg: de knoppen staan uit, de reden in de tooltip, de keuze gedimd',
    a.knoppen.join() === '2:uit,4:uit' && await evalueer("document.querySelector('.lib-stems-keuze').classList.contains('uit') && /geen demucs/.test(document.querySelector('.lib-stems-keuze').title)"),
    JSON.stringify(a));
  await evalueer("window.__nep.beschikbaar = true; window.__nep.reden = null");
  await evalueer('window.stemsWachtrij.peil()');
  await evalueer(`${knopInRij('Nep nep-a', '[data-stems="splits"][data-aantal="2"]')}.click()`);
  ok('klik 2: POST /api/stems { track, aantal: 2 }, de cel zegt "wacht" met ×',
    await totdat(`window.__nep.posts.at(-1)?.aantal === 2 && (${rij('Nep nep-a')}).stems === 'wacht' && (${rij('Nep nep-a')}).knoppen.join() === '×'`, 15000),
    JSON.stringify(await evalueer(rij('Nep nep-a'))));
  const idA = (await evalueer(rij('Nep nep-a'))).id;
  await evalueer(`window.__nep.zet(window.__nep.van(${JSON.stringify(idA)}).id, { status: 'bezig', voortgang: 0.42 })`);
  ok('bezig: "42%" (het paneel peilt zolang het open staat)', await totdat(`(${rij('Nep nep-a')}).stems === '42%'`, 15000));
  await evalueer(`${knopInRij('Nep nep-a', '[data-stems="annuleer"]')}.click()`);
  await totdat("/klik nog eens op ×/.test(document.querySelector('#lib-panel .lib-status').textContent)", 15000);
  ok('× op een lopende split vraagt eerst een tweede klik', /klik nog eens op ×/.test(await status())
    && (await evalueer(`window.__nep.van(${JSON.stringify(idA)}).status`)) === 'bezig', await status());
  await foto(`${voor}-kolom-bezig.png`);
  await evalueer(`window.__nep.klaar(window.__nep.van(${JSON.stringify(idA)}).id)`);
  ok('klaar: de cel zegt "2" en biedt "4" aan', await totdat(`(${rij('Nep nep-a')}).stems === '2' && (${rij('Nep nep-a')}).knoppen.join() === '4'`, 15000),
    JSON.stringify(await evalueer(rij('Nep nep-a'))));
  await evalueer(`${knopInRij('Nep nep-b', '[data-stems="splits"][data-aantal="4"]')}.click()`);
  const idB = (await evalueer(rij('Nep nep-b'))).id;
  await totdat(`window.__nep.van(${JSON.stringify(idB)})`, 15000);
  await evalueer(`window.__nep.zet(window.__nep.van(${JSON.stringify(idB)}).id, { status: 'fout', fout: 'nep: geheugen op', klaar: Date.now() })`);
  ok('mislukt: "fout", de reden in de tooltip, opnieuw 2 · 4', await totdat(`(${rij('Nep nep-b')}).stems === 'fout' && /geheugen op/.test((${rij('Nep nep-b')}).titel)`, 15000),
    JSON.stringify(await evalueer(rij('Nep nep-b'))));
  ok('en onderaan een foutmelding', /stems van .* mislukt: nep: geheugen op/.test(await onderaan()), await onderaan());
  await maat(1440, 790);
  await foto(`${voor}-library-1440.png`);

  console.log('\nladen: stems.wav lukt niet, dan audio.wav');
  await evalueer(`${knopInRij('Nep nep-a', 'button[data-deck="A"]')}.click()`);
  ok('nep-a staat op track 1 (audio.wav, want stems.wav is er niet)', await totdat("window.engine.deck('A').duration > 13", 15000));
  ok('met een melding onderaan', /track 1: stems van "Nep nep-a" niet geladen/.test(await onderaan()), await onderaan());
  // De golfvorm komt na het geluid; pas dan hoort de track bij zijn nummer (laden.js).
  ok('kolomkop: S! (mislukt)', await totdat(`(${teken('A')})?.soort === 'mislukt'`, 15000), JSON.stringify(await evalueer(teken('A'))));
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer("document.getElementById('stems-btn').click(); window.engine.setFocus('A')");
  await totdat(`(${RIJ}).soort === 'mislukt'`, 15000);
  let r = await evalueer(RIJ);
  ok(`STEMS-rij open, track 1: "stems niet geladen …" (${r.tekst})`, r.open && r.track === 'track 1' && r.soort === 'mislukt' && !r.splits);

  console.log('\nde rij met stems (nep-acties)');
  const fps = await evalueer('new Promise((ok) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : ok(n); }; requestAnimationFrame(f); })');
  console.log(`      (beelden per seconde in deze headless pagina: ${fps})`);
  await evalueer("window.__nep.zetDeck('A', ['vocals', 'inst'])");
  await rijWordt("r.stems.map((s) => s.naam).join() === 'zang,rest'");
  r = await evalueer(RIJ);
  ok(`twee: zang en rest, op vol (${r.stems.map((s) => s.naam).join(', ')})`, r.stems.map((s) => s.naam).join() === 'zang,rest' && r.stems.every((s) => s.niveau === 1) && !r.geen);
  ok('kolomkop: S2', await totdat(`(${teken('A')})?.tekst === 'S2'`, 15000));
  ok('de meldingen staan boven de rij, niet over zijn knoppen', await evalueer(`(() => { const m = document.getElementById('meldingen').getBoundingClientRect();
    const r = document.getElementById('stems').getBoundingClientRect(); return !document.querySelector('#meldingen .melding') || m.bottom <= r.top + 1; })()`));
  await muis('#stems .st-stem[data-stem="vocals"] .st-kill');
  await rijWordt('r.stems[0].kill');
  r = await evalueer(RIJ);
  ok('kill zang (muis): de knop brandt, de strip is doorgestreept, de bus zegt weg', r.stems[0].kill && r.stems[0].weg
    && (await evalueer("window.__act.read('track.1.stem.vocals.kill')")) === 1, JSON.stringify(r.stems[0]) + ' bus: ' + (await evalueer("window.__act.read('track.1.stem.vocals.kill')")));
  await evalueer("window.__act.invoke('track.1.stem.vocals', 0.3)");
  await rijWordt('Math.abs(r.stems[0].niveau - 0.3) < 0.002');
  ok('de schuif volgt de bus (read per frame): 0,3', bijna((await evalueer(RIJ)).stems[0].niveau, 0.3, 0.002),
    `${(await evalueer(RIJ)).stems[0].niveau}, actief: ${await evalueer('document.activeElement?.className')}`);
  await muis('#stems .st-stem[data-stem="vocals"] .st-niveau', { dubbel: true });
  await totdat("window.__act.read('track.1.stem.vocals') === 1", 2000);
  ok('dubbelklik op de schuif: terug op vol', (await evalueer("window.__act.read('track.1.stem.vocals')")) === 1);
  const vast = await muis('#stems .st-stem[data-stem="inst"] .st-kill', { shift: true,
    tijdens: async () => { await rijWordt('r.stems[1].kill', 15000); return evalueer(RIJ); } });
  await rijWordt('!r.stems[1].kill', 15000);
  r = await evalueer(RIJ);
  ok('shift + vasthouden op kill rest: weg zolang je drukt, daarna terug', vast.stems[1].kill && !r.stems[1].kill);
  await muis('#stems .st-stem[data-stem="vocals"] .st-kill');
  await rijWordt('!r.stems[0].kill', 15000);
  await maat(1440, 790);
  await layout('twee stems, 1440×790');
  await foto(`${voor}-twee-1440.png`);
  await evalueer("window.__nep.zetDeck('A', ['drums', 'bass', 'other', 'vocals'])");
  await rijWordt('r.stems.length === 5');
  r = await evalueer(RIJ);
  ok(`vier: drums, bas, overig, zang en rest als groep (${r.stems.map((s) => s.naam + (s.groep ? '*' : '')).join(', ')})`,
    r.stems.map((s) => s.naam).join() === 'drums,bas,overig,zang,rest' && r.stems.at(-1).groep);
  ok('kolomkop: S4', await totdat(`(${teken('A')})?.tekst === 'S4'`, 15000));
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer(`${knopInRij('Nep nep-a', '[data-stems="splits"][data-aantal="4"]')}.click()`);
  await totdat("/speelt met stems/.test(document.querySelector('#lib-panel .lib-status').textContent)", 15000);
  ok('opnieuw splitsen terwijl track 1 het met stems speelt: geweigerd, met uitleg', /speelt met stems op track 1/.test(await status())
    && !(await evalueer(`window.__nep.posts.some((p) => p.track === ${JSON.stringify(idA)} && p.aantal === 4)`)), await status());
  await evalueer("document.getElementById('lib-btn').click()");
  await maat(1440, 790);
  await layout('vier stems, 1440×790');
  await foto(`${voor}-vier-1440.png`);
  await maat(1920, 1080);
  await layout('vier stems, 1920×1080');
  await foto(`${voor}-vier-1920.png`);
  await evalueer("document.getElementById('lib-btn').click()");
  await foto(`${voor}-library-1920.png`);
  await evalueer("document.getElementById('lib-btn').click()");
  await maat(1440, 790);

  console.log('\nklaar terwijl het nummer al op een track staat');
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer(`${knopInRij('Nep nep-b', 'button[data-deck="B"]')}.click()`);
  ok('nep-b (geen stems) staat op track 2', await totdat("window.engine.deck('B').duration > 13", 15000));
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer("window.engine.setFocus('B')");
  await rijWordt("r.track === 'track 2' && r.soort === 'fout'");
  r = await evalueer(RIJ);
  ok(`focus track 2: "${r.tekst}" met splitsen in 2 · 4`, r.track === 'track 2' && r.soort === 'fout' && r.splits);
  await muis('#stems .st-splits[data-aantal="2"]');
  ok('splitsen in 2 vanuit de rij: in de rij van de server', await totdat(`window.__nep.van(${JSON.stringify(idB)})?.status === 'wacht'`, 15000));
  await evalueer(`window.__nep.zet(window.__nep.van(${JSON.stringify(idB)}).id, { status: 'bezig', voortgang: 0.6 })`);
  ok('de rij toont de voortgang met een balk en ×', await totdat(`(${RIJ}).soort === 'open' && (${RIJ}).balk && (${RIJ}).x && /60%/.test((${RIJ}).tekst)`, 15000),
    JSON.stringify(await evalueer(RIJ)));
  await foto(`${voor}-rij-bezig-1440.png`);
  await evalueer(`window.__nep.klaar(window.__nep.van(${JSON.stringify(idB)}).id)`);
  ok('klaar: niet vanzelf gewisseld, de rij zegt dat herladen ze geeft', await totdat(`(${RIJ}).soort === 'herladen'`, 15000)
    && (await evalueer(RIJ)).stems.length === 0, (await evalueer(RIJ)).tekst);
  ok('kolomkop 2: gestippeld S2 (herladen)', await totdat(`(${teken('B')})?.soort === 'herladen'`, 15000), JSON.stringify(await evalueer(teken('B'))));
  ok('en een melding met de track', /staan klaar — laad het nummer opnieuw op track 2/.test(await onderaan()), await onderaan());
  await foto(`${voor}-herladen-1440.png`);

  console.log('\nde Controlekamer');
  // Een nieuwe pagina: de nep-server begint daar leeg, dus nu pas iets in de rij zetten.
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/controle` });
  await totdat('window.controle && window.__nep', 15000);
  const tegel = "[...document.querySelectorAll('.tegel')].find((t) => /Stems/.test(t.textContent))?.textContent.replace(/\\s+/g, ' ').trim()";
  ok('tegel Stems: leeg, splitter klaar', await totdat(`/leeg.*splitter klaar/.test(${tegel})`, 15000), await evalueer(tegel));
  await evalueer("window.__nep.opdrachten.push({ id: 'x1', track: 'x', titel: 'een lang album', aantal: 4, status: 'bezig', voortgang: 0.3 }, { id: 'x2', track: 'y', titel: 'nog een', aantal: 2, status: 'wacht', voortgang: 0 })");
  ok('tegel Stems: 1 bezig, 1 wacht, met wat er loopt', await totdat(`/1 bezig, 1 wacht.*een lang album · in 4 · 30%/.test(${tegel})`, 15000), await evalueer(tegel));
  await foto(`${voor}-controle.png`);
  await evalueer("window.__nep.beschikbaar = false; window.__nep.reden = 'demucs ontbreekt in ~/.varve/stems-venv'");
  ok('splitter weg: rood, met de reden', await totdat(`/splitter ontbreekt.*demucs ontbreekt/.test(${tegel}) && document.querySelector('.tegel:has(.led)') && [...document.querySelectorAll('.tegel')].find((t) => /Stems/.test(t.textContent)).dataset.licht === 'fout'`, 15000), await evalueer(tegel));
}

async function doorloopEcht() {
  const api = await evalueer("fetch('/api/stems').then(async (r) => ({ status: r.status, j: r.ok ? await r.json() : null }))");
  ok('de server kent /api/stems en de splitter is er', api.status === 200 && api.j?.beschikbaar !== false, JSON.stringify(api));
  if (api.status !== 200) throw new Error('deze server kent /api/stems niet: draai dit na de integratie, of met --nep');
  await evalueer("(async () => { window.__act = await import('/src/control/actions.js'); return true; })()");
  await evalueer('window.engine.resume()');

  console.log('\ntwee stems: binnenhalen met stems=2');
  await evalueer("document.getElementById('lib-btn').click()");
  ok('de keuze staat standaard op 2', await evalueer("document.querySelector('#lib-panel [data-stems-keuze=\"2\"]').classList.contains('on')"));
  await binnenhalen(['http://127.0.0.1:9/stems-twee'], 2);
  ok('binnen, en daarna vanzelf gesplitst: de kolom zegt 2', await totdat(`(${rij('Nep stems-twee')})?.stems === '2'`, 120000),
    JSON.stringify(await evalueer(rij('Nep stems-twee'))));
  const twee = await evalueer(rij('Nep stems-twee'));
  const opd = await evalueer(`fetch('/api/stems').then((r) => r.json()).then((j) => j.opdrachten.find((o) => o.track === ${JSON.stringify(twee.id)}))`);
  ok('GET /api/stems: de opdracht is klaar, met 2', opd?.status === 'klaar' && opd?.aantal === 2, JSON.stringify(opd));
  await evalueer(`${knopInRij('Nep stems-twee', 'button[data-deck="A"]')}.click()`);
  ok('op track 1, met stems op de bus', await totdat("window.engine.deck('A').duration > 13 && window.__act.read('track.1.stem.vocals') !== null", 20000));
  ok('de melding zegt "met 2 stems"', await totdat("/met 2 stems/.test(document.querySelector('#lib-panel .lib-status').textContent)", 15000), await status());
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer("document.getElementById('stems-btn').click(); window.engine.setFocus('A')");
  await rijWordt("r.stems.length === 2");
  let r = await evalueer(RIJ);
  ok(`STEMS-rij: zang en rest (${r.stems.map((s) => s.naam).join(', ')})`, r.stems.map((s) => s.naam).join() === 'zang,rest');
  ok('kolomkop: S2', await totdat(`(${teken('A')})?.tekst === 'S2'`, 15000));
  await evalueer("__act.invoke('track.1.fader', 1); __act.invoke('mixer.xfader', 0); __act.invoke('track.1.play', true); __act.invoke('track.1.play', false)");
  await wacht(800);
  const basis = await rms();
  ok(`het speelt: niveau aan de master ${basis.toFixed(4)}`, basis > 0.01);
  const meet = async (naam, verwacht, b = basis) => {
    await wacht(150);
    const v = (await rms()) / b;
    ok(`${naam}: ${v.toFixed(3)} van het niveau (verwacht ${verwacht})`, verwacht === 0 ? v < 0.02 : bijna(v, verwacht));
    return v;
  };
  // Met de muis op kill, en wachten tot de BUS het zegt (een drukke machine
  // verwerkt de klik soms pas na een paar honderd ms); dan pas meten.
  const klik = async (nr, s, verwacht) => {
    await muis(`#stems .st-stem[data-stem="${s}"] .st-kill`);
    await totdat(`__act.read('track.${nr}.stem.${s}.kill') === ${verwacht}`, 15000);
  };
  await klik(1, 'vocals', 1);
  await meet('zang weg (muis)', 0.25);
  await rijWordt('r.stems[0].kill', 15000);
  r = await evalueer(RIJ);
  ok('de kill-knop brandt en de bus zegt weg', r.stems[0].kill && (await evalueer("__act.read('track.1.stem.vocals.kill')")) === 1);
  await klik(1, 'inst', 1);
  await meet('zang én rest weg', 0);
  await klik(1, 'vocals', 0);
  await meet('zang terug, rest nog weg', 0.75);
  await klik(1, 'inst', 0);
  await meet('alles terug', 1);
  const tijdens = await muis('#stems .st-stem[data-stem="vocals"] .st-kill', { shift: true,
    tijdens: async () => { await totdat("__act.read('track.1.stem.vocals.kill') === 1", 15000); await wacht(100); return (await rms(300)) / basis; } });
  ok(`shift + vasthouden: zang weg zolang je drukt (${tijdens.toFixed(3)})`, bijna(tijdens, 0.25));
  await totdat("__act.read('track.1.stem.vocals.kill') === 0", 15000);
  await meet('losgelaten: terug', 1);
  await evalueer("__act.invoke('track.1.stem.vocals', 0.5)");
  await rijWordt('Math.abs(r.stems[0].niveau - 0.5) < 0.002', 15000);
  ok('de schuif volgt de bus (read per frame)', bijna((await evalueer(RIJ)).stems[0].niveau, 0.5, 0.002));
  await muis('#stems .st-stem[data-stem="vocals"] .st-niveau', { dubbel: true });
  await totdat("__act.read('track.1.stem.vocals') === 1", 2000);
  ok('dubbelklik op de schuif: weer vol', (await evalueer("__act.read('track.1.stem.vocals')")) === 1);
  await maat(1440, 790);
  await layout('twee stems, 1440×790');
  await foto(`${voor}-twee-1440.png`);

  console.log('\nvier stems: binnenhalen zonder, dan splitsen in de kolom');
  await evalueer("document.getElementById('lib-btn').click()");
  await binnenhalen(['http://127.0.0.1:9/stems-vier'], 0);
  ok('binnen, zonder stems: "—" met 2 · 4', await totdat(`(${rij('Nep stems-vier')})?.knoppen?.join() === '2,4'`, 60000),
    JSON.stringify(await evalueer(rij('Nep stems-vier'))));
  const vier = await evalueer(rij('Nep stems-vier'));
  await wacht(2500);
  ok('en geen opdracht in de stems-rij (stems=0)', !(await evalueer(`fetch('/api/stems').then((r) => r.json()).then((j) => j.opdrachten.some((o) => o.track === ${JSON.stringify(vier.id)}))`)));
  // Eerst op track 3, ZONDER stems: dan moet "klaar" daar niet vanzelf wisselen.
  await evalueer(`${knopInRij('Nep stems-vier', 'button[data-deck="C"]')}.click()`);
  ok('op track 3 (nog zonder stems)', await totdat("window.engine.deck('C').duration > 13", 15000));
  await evalueer(`${knopInRij('Nep stems-vier', '[data-stems="splits"][data-aantal="4"]')}.click()`);
  ok('klik 4: de kolom zegt 4', await totdat(`(${rij('Nep stems-vier')})?.stems === '4'`, 120000), JSON.stringify(await evalueer(rij('Nep stems-vier'))));
  ok('track 3 wisselde niet vanzelf: kolomkop gestippeld S4 (herladen)', await totdat(`(${teken('C')})?.soort === 'herladen'`, 15000)
    && (await evalueer("__act.read('track.3.stem.vocals')")) === null, JSON.stringify(await evalueer(teken('C'))));
  ok('en een melding dat herladen ze geeft', /staan klaar — laad het nummer opnieuw op track 3/.test(await onderaan()), await onderaan());
  await evalueer(`${knopInRij('Nep stems-twee', '[data-stems="splits"][data-aantal="4"]')}.click()`);
  await totdat("/speelt met stems/.test(document.querySelector('#lib-panel .lib-status').textContent)", 15000);
  ok('opnieuw splitsen terwijl track 1 het met stems speelt: geweigerd', /speelt met stems op track 1/.test(await status()), await status());
  await evalueer(`${knopInRij('Nep stems-vier', 'button[data-deck="B"]')}.click()`);
  ok('op track 2, met vier stems op de bus', await totdat("window.engine.deck('B').duration > 13 && __act.read('track.2.stem.drums') !== null", 20000));
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer("__act.invoke('track.1.play', true); __act.invoke('track.1.play', false); window.engine.setFocus('B')");
  await evalueer("__act.invoke('track.2.fader', 1); __act.invoke('mixer.xfader', 1); __act.invoke('track.2.play', true); __act.invoke('track.2.play', false)");
  await rijWordt("r.track === 'track 2' && r.stems.length === 5");
  r = await evalueer(RIJ);
  ok(`STEMS-rij: drums, bas, overig, zang, rest als groep (${r.stems.map((s) => s.naam).join(', ')})`,
    r.stems.map((s) => s.naam).join() === 'drums,bas,overig,zang,rest' && r.stems.at(-1).groep);
  ok('kolomkop 2: S4', await totdat(`(${teken('B')})?.tekst === 'S4'`, 15000));
  await wacht(600);
  const basis4 = await rms();
  await klik(2, 'drums', 1);
  await meet('drums weg', 0.9, basis4);
  await klik(2, 'bass', 1);
  await meet('drums en bas weg', 0.7, basis4);
  await klik(2, 'drums', 0);
  await klik(2, 'bass', 0);
  await klik(2, 'inst', 1);
  await meet('rest (groep) weg: alleen de zang', 0.4, basis4);
  await klik(2, 'vocals', 1);
  await meet('en de zang ook: stilte', 0, basis4);
  await klik(2, 'vocals', 0);
  await klik(2, 'inst', 0);
  await meet('alles terug', 1, basis4);
  await maat(1440, 790);
  await layout('vier stems, 1440×790');
  await foto(`${voor}-vier-1440.png`);
  await maat(1920, 1080);
  await layout('vier stems, 1920×1080');
  await foto(`${voor}-vier-1920.png`);
  await evalueer("document.getElementById('lib-btn').click()");
  await foto(`${voor}-library-1920.png`);
  await maat(1440, 790);
  await foto(`${voor}-library-1440.png`);
  await evalueer("document.getElementById('lib-btn').click()");

  console.log('\nde Controlekamer');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/controle` });
  ok('tegel Stems: leeg, splitter klaar', await totdat("[...document.querySelectorAll('.tegel')].some((t) => /Stems/.test(t.textContent) && /leeg/.test(t.textContent))", 15000),
    await evalueer("[...document.querySelectorAll('.tegel')].find((t) => /Stems/.test(t.textContent))?.textContent.replace(/\\s+/g, ' ').trim()").catch(() => ''));
  await foto(`${voor}-controle.png`);
}

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
  if (NEP) await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(${nepServer})();` });
  await maat(1440, 790);
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start', await totdat('window.engine && window.videoMixer && window.stemsWachtrij', 20000));
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  ok('de STEMS-rij is standaard dicht', await evalueer("document.getElementById('stems').classList.contains('hidden')"));
  if (NEP) await doorloopNep(); else await doorloopEcht();
  ok('geen fouten in de pagina', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
