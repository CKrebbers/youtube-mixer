// Het library-paneel headless bekijken met een GROTE library (ROADMAP 21):
// 5000 nummers, sorteren op de kolomkop, scrollen tot onderaan, zoeken, en
// hotcues die bij het nummer bewaard worden en terugkomen bij opnieuw laden.
//
// Zoals kijk.mjs: MIDI eruit vóór de pagina laadt (geen tweede MIDI-client
// naast Clay's tabblad), een EIGEN server op een eigen poort met een tijdelijke
// database en mediamap. Clay's library en server op 8777 blijven buiten schot.
//
// Gebruik:  node tools/headless/library.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (standaard 8814) en VARVE_KIJK_DEBUG (standaard 9414).
// Chromium: de headless shell uit de Playwright-cache, of VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8814, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9414;
const N = Number(process.env.VARVE_KIJK_AANTAL) || 5000;
const tmp = mkdtempSync(join(tmpdir(), 'varve-library-'));
mkdirSync(UIT, { recursive: true });

const { Library } = await import(join(WORTEL, 'server/library.js'));
const { maakWav } = await import(join(WORTEL, 'src/engine/stream-kern.js'));

// ---- een grote library, zonder audio (behalve twee echte nummers) ---------
const media = join(tmp, 'media');
{
  const lib = new Library(join(tmp, 'lib.db'));
  const t0 = performance.now();
  lib.db.exec('BEGIN');
  const woorden = ['Élan', 'alpha', 'Zulu', 'beta', 'Nacht', 'ochtend', 'Dub', 'échec', 'Track'];
  for (let i = 0; i < N; i++) {
    const id = `n${String(i).padStart(5, '0')}`;
    lib.bewaarTrack({
      id, url: `https://youtu.be/${id}`, titel: `${woorden[i % woorden.length]} ${(i * 7919) % N}`, uploader: `artiest ${i % 37}`,
      duur: 60 + ((i * 37) % 3600), audio: `media/${id}/audio.wav`, video: null, thumbnail: '',
      loudness: { I: -10 - (i % 12), TP: -1, LRA: 5, drempel: -20, offset: 0 }, doelLoudness: -14, ytdlp: 'x',
    });
    if (i % 5) lib.bewaarGrid(id, { stukken: [{ van: 0, bpm: 70 + (i % 110) + 0.5, anker: 0.1, zekerheid: 0.8 }], bron: 'auto' });
  }
  lib.db.prepare('UPDATE tracks SET toegevoegd = ? + CAST(substr(id, 2) AS INTEGER) * 60000').run(Date.now() - N * 60000);
  lib.db.prepare('UPDATE tracks SET laatst_geladen = toegevoegd + 1000, keer_geladen = 1 WHERE CAST(substr(id, 2) AS INTEGER) % 9 = 0').run();
  lib.db.exec('COMMIT');
  // Twee nummers met echte audio (16-bit stereo 48 kHz, zoals de ingest levert), om te laden.
  for (const [id, hz] of [['echt1', 220], ['echt2', 330]]) {
    const n = 48000 * 8;
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / 48000);
    mkdirSync(join(media, id), { recursive: true });
    writeFileSync(join(media, id, 'audio.wav'), Buffer.from(maakWav([L, L], 48000)));
    lib.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: `echt ${id}`, uploader: 'test', duur: 8,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: '', loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  }
  lib.sluit();
  console.log(`library van ${N + 2} nummers gemaakt in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media,
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
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
/** Wachten tot een uitdrukking waar is (niet een vaste tijd: de machine kan druk zijn). */
async function tot(expr, maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(50); }
  return false;
}
const api = (pad) => fetch(`http://localhost:${POORT}${pad}`).then((r) => r.json());

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// Wat staat er in beeld: titels van de rijen in de DOM, in volgorde.
const TITELS = "[...document.querySelectorAll('#lib-panel .lib-venster .lib-rij:not(.laadt) .lib-titel')].map((e) => e.lastChild?.textContent ?? '')";
const RIJEN = "document.querySelectorAll('#lib-panel .lib-venster .lib-rij').length";

try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start', await tot('window.engine && window.library'));
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  await evalueer("localStorage.removeItem('varve.library.sortering')");

  // ---- openen: 5000 nummers, maar maar een handvol rijen in de DOM -------
  console.log(`\n${N + 2} nummers`);
  const t0 = await evalueer("(window.__t0 = performance.now(), document.getElementById('lib-btn').click(), window.__t0)");
  ok('paneel open, rijen staan er', await tot(`${RIJEN} > 5 && document.querySelector('#lib-panel .lib-status').textContent.includes('${N + 2}')`));
  const openMs = await evalueer('performance.now() - window.__t0');
  ok(`status: ${N + 2} nummers (vroeger: 200)`, await evalueer(`document.querySelector('#lib-panel .lib-status').textContent.includes('${N + 2} nummers')`), `${openMs.toFixed(0)} ms na de klik`);
  const inDom = await evalueer(RIJEN);
  ok('alleen de zichtbare rijen in de DOM (≤ 30)', inDom > 5 && inDom <= 30, `${inDom} rijen`);
  ok('scrollhoogte = de hele lijst', await evalueer(`document.querySelector('#lib-panel .lib-ruimte').offsetHeight === ${N + 2} * 28`));
  const eersteApi = (await api('/api/library?sorteer=toegevoegd&richting=af&aantal=3')).tracks.map((t) => t.titel);
  ok('standaard: nieuwste eerst', JSON.stringify((await evalueer(TITELS)).slice(0, 3)) === JSON.stringify(eersteApi), eersteApi.join(' | '));
  ok('kolomkop ligt precies boven de kolommen', await evalueer(`(() => {
    const kop = [...document.querySelectorAll('#lib-panel .lib-kop > *')].map((e) => Math.round(e.getBoundingClientRect().left));
    const rij = [...document.querySelector('#lib-panel .lib-venster .lib-rij').children].map((e) => Math.round(e.getBoundingClientRect().left));
    return kop.length === rij.length && kop.every((x, i) => Math.abs(x - rij[i]) <= 1);
  })()`));
  await foto('library-open.png');

  // ---- scrollen: tot onderaan, en hoe duur één beeld is ------------------
  console.log('\nscrollen');
  const scroll = await evalueer(`(async () => {
    const el = document.querySelector('#lib-panel .lib-rijen'), p = window.library;
    let fetches = 0; const echt = window.fetch;
    window.fetch = (...a) => { if (String(a[0]).startsWith('/api/library?')) fetches++; return echt(...a); };
    const tijden = [];
    const stap = Math.floor(el.scrollHeight / 120);
    for (let y = 0; y <= el.scrollHeight; y += stap) {
      el.scrollTop = y;
      const t = performance.now(); p.tekenRijen(); tijden.push(performance.now() - t);
      await p._haalZichtbaar();
    }
    el.scrollTop = el.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => r()));
    await p._haalZichtbaar(); p.tekenRijen();
    window.fetch = echt;
    tijden.sort((a, b) => a - b);
    return { max: tijden.at(-1), p95: tijden[Math.floor(tijden.length * 0.95)], n: tijden.length, fetches,
      rijen: document.querySelectorAll('#lib-panel .lib-venster .lib-rij').length };
  })()`);
  ok(`een beeld tekenen tijdens scrollen: p95 ${scroll.p95.toFixed(1)} ms, traagst ${scroll.max.toFixed(1)} ms (${scroll.n} stappen)`, scroll.p95 < 16);
  ok(`${scroll.fetches} pagina-verzoeken voor de hele lijst (pagina's van 100)`, scroll.fetches <= Math.ceil((N + 2) / 100) + 2);
  ok('onderaan nog steeds maar een handvol rijen in de DOM', scroll.rijen <= 30, `${scroll.rijen}`);
  const laatsteApi = (await api(`/api/library?sorteer=toegevoegd&richting=af&van=${N}&aantal=2`)).tracks.map((t) => t.titel);
  ok('onderaan: de oudste twee nummers', await tot(`JSON.stringify(${TITELS}.slice(-2)) === ${JSON.stringify(JSON.stringify(laatsteApi))}`, 5000), laatsteApi.join(' | '));
  await foto('library-onderaan.png');

  // ---- sorteren: klik op de kolomkop, nog eens = omgekeerd ---------------
  console.log('\nsorteren');
  const klikKop = (s) => evalueer(`document.querySelector('#lib-panel button[data-sorteer="${s}"]').click()`);
  const eerste = async (q) => (await api(`/api/library?${q}&aantal=5`)).tracks.map((t) => t.titel);
  const vergelijk = async (naam, q) => {
    const verwacht = await eerste(q);
    const klopt = await tot(`JSON.stringify(${TITELS}.slice(0, 5)) === ${JSON.stringify(JSON.stringify(verwacht))}`, 5000);
    ok(naam, klopt, klopt ? verwacht.slice(0, 3).join(' | ') : `scherm: ${(await evalueer(TITELS)).slice(0, 3).join(' | ')}`);
  };
  await klikKop('titel');
  await vergelijk('titel: A→Z, bovenaan begonnen', 'sorteer=titel&richting=op');
  ok('scrollpositie terug naar boven', await evalueer("document.querySelector('#lib-panel .lib-rijen').scrollTop === 0"));
  ok('de kop zegt welke kolom en welke kant (▲)', await evalueer(`(() => { const b = document.querySelector('#lib-panel button[data-sorteer="titel"]');
    return b.classList.contains('aan') && b.textContent.includes('▲') && b.getAttribute('aria-sort') === 'ascending'; })()`));
  await klikKop('titel');
  await vergelijk('titel nog eens: Z→A', 'sorteer=titel&richting=af');
  await klikKop('bpm');
  await vergelijk('bpm: laagste eerst', 'sorteer=bpm&richting=op');
  await klikKop('duur');
  await klikKop('duur');
  await vergelijk('duur twee keer: langste eerst', 'sorteer=duur&richting=af');
  await klikKop('gespeeld');
  await vergelijk('laatst gespeeld: laatste eerst', 'sorteer=gespeeld&richting=af');
  await klikKop('toegevoegd');
  await klikKop('toegevoegd');
  await vergelijk('toegevoegd twee keer: oudste eerst', 'sorteer=toegevoegd&richting=op');
  await klikKop('bpm');
  await klikKop('bpm');
  await foto('library-bpm-af.png');
  ok('sortering onthouden in localStorage', await evalueer("localStorage.getItem('varve.library.sortering') === '{\"sorteer\":\"bpm\",\"richting\":\"af\"}'"));

  // ---- zoeken -----------------------------------------------------------
  console.log('\nzoeken');
  await evalueer(`(() => { const z = document.querySelector('#lib-panel .lib-zoek'); z.value = 'Zulu 1'; z.dispatchEvent(new Event('input')); })()`);
  const zoekTotaal = (await api('/api/library?zoek=Zulu%201&aantal=1')).totaal;
  ok(`zoeken op de server: "${zoekTotaal} gevonden"`, await tot(`document.querySelector('#lib-panel .lib-status').textContent.includes('${zoekTotaal} gevonden')`, 5000));
  await vergelijk('en gesorteerd zoals gekozen (bpm af)', 'zoek=Zulu%201&sorteer=bpm&richting=af');
  await evalueer(`(() => { const z = document.querySelector('#lib-panel .lib-zoek'); z.value = 'bestaat nergens'; z.dispatchEvent(new Event('input')); })()`);
  ok('niets gevonden: dat staat er', await tot("document.querySelector('#lib-panel .lib-leeg')?.textContent.includes('niets gevonden')", 5000));

  // ---- na herladen: de sortering staat er nog -----------------------------
  console.log('\nherladen');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start opnieuw', await tot('window.engine && window.library'));
  await evalueer("document.getElementById('lib-btn').click()");
  ok('sortering na herladen: nog steeds bpm ▼', await tot(`(() => { const b = document.querySelector('#lib-panel button[data-sorteer="bpm"]');
    return b?.classList.contains('aan') && b.textContent.includes('▼'); })()`));
  await vergelijk('en de lijst ook', 'sorteer=bpm&richting=af');

  // ---- hotcues bij het nummer -------------------------------------------
  console.log('\nhotcues per nummer');
  await evalueer('window.engine.resume()');
  await evalueer(`(async () => { window.__act = await import('/src/control/actions.js'); })()`);
  await evalueer(`(() => { const z = document.querySelector('#lib-panel .lib-zoek'); z.value = 'echt'; z.dispatchEvent(new Event('input')); })()`);
  ok('de twee echte nummers gevonden', await tot("document.querySelectorAll('#lib-panel button[data-id=\"echt1\"]').length > 0", 5000));
  const laadOpA = async (id) => {
    await evalueer(`document.querySelector('#lib-panel button[data-deck="A"][data-id="${id}"]').click()`);
    return tot(`window.engine.deck('A').title === 'echt ${id}' && !window.library.bezig.size`, 10000);
  };
  ok('echt1 op track 1 geladen', await laadOpA('echt1'));
  await evalueer("window.engine.deck('A').seek(2.5); __act.invoke('track.1.hotcue.2', true); __act.invoke('track.1.hotcue.2', false)");
  await evalueer("window.engine.deck('A').seek(5.25); __act.invoke('track.1.hotcue.4', true); __act.invoke('track.1.hotcue.4', false)");
  const bewaard = async () => (await api('/api/library/echt1/hotcues')).hotcues;
  let hc = [];
  for (let i = 0; i < 40 && hc.length < 2; i++) { await wacht(100); hc = await bewaard(); }
  ok('hotcues 2 en 4 bewaard bij het nummer', hc.length === 2 && hc[0].nr === 2 && Math.abs(hc[0].tijd - 2.5) < 0.01 && hc[1].nr === 4 && Math.abs(hc[1].tijd - 5.25) < 0.01,
    JSON.stringify(hc));
  await evalueer("__act.invoke('track.1.hotcue.4.delete', true); __act.invoke('track.1.hotcue.4.delete', false)");
  for (let i = 0; i < 40 && hc.length > 1; i++) { await wacht(100); hc = await bewaard(); }
  ok('hotcue 4 gewist: ook bij het nummer weg', hc.length === 1 && hc[0].nr === 2);
  ok('echt2 op track 1: zijn eigen (lege) hotcues', await laadOpA('echt2') && await tot("window.engine.deck('A').hotcues.every((h) => h === null)", 3000));
  ok('echt1 weer op track 1: hotcue 2 is terug', await laadOpA('echt1')
    && await tot("Math.abs(window.engine.deck('A').hotcues[1] - 2.5) < 0.01 && window.engine.deck('A').hotcues[3] === null", 5000),
    JSON.stringify(await evalueer("window.engine.deck('A').hotcues")));
  ok('ook op een andere track (hotcues horen bij het nummer, niet bij de fader)', await (async () => {
    await evalueer("document.querySelector('#lib-panel button[data-deck=\"C\"][data-id=\"echt1\"]').click()");
    return tot("window.engine.deck('C').title === 'echt echt1' && Math.abs(window.engine.deck('C').hotcues[1] - 2.5) < 0.01", 10000);
  })());
  ok('de rij zegt dat hij net gespeeld is', await evalueer(`(() => {
    const rij = document.querySelector('#lib-panel button[data-id="echt1"]').closest('.lib-rij');
    return /^\\d\\d:\\d\\d$/.test([...rij.querySelectorAll('.lib-datum')].at(-1).textContent);
  })()`));
  ok('en de server ook (laatst gespeeld)', (await api('/api/library?sorteer=gespeeld&aantal=1')).tracks[0].id === 'echt1');
  await foto('library-hotcues.png');

  // ---- laden over een spelende track: pas bij de tweede klik ---------------
  console.log('\nladen over een spelende track, weghalen');
  const klikLaad = (id, deck) => evalueer(`document.querySelector('#lib-panel button[data-deck="${deck}"][data-id="${id}"]').click()`);
  const status = () => evalueer("document.querySelector('#lib-panel .lib-status').textContent");
  await evalueer("window.engine.deck('A').play()");
  ok('track 1 speelt', await tot("window.engine.deck('A').playing", 3000));
  await klikLaad('echt2', 'A');
  await wacht(300);
  ok('eerste klik over een spelende track: niets geladen, wel de vraag',
    await evalueer("window.engine.deck('A').title === 'echt echt1'") && (await status()).includes('klik nog eens'), await status());
  await klikLaad('echt2', 'A');
  ok('tweede klik: wel geladen', await tot("window.engine.deck('A').title === 'echt echt2' && !window.library.bezig.size", 10000));

  // ---- weghalen: eerst vragen, dan weg (met zijn hotcues) ----------------
  const klikWeg = (id) => evalueer(`document.querySelector('#lib-panel button[data-weg="${id}"]').click()`);
  const voorTotaal = (await api('/api/library?aantal=1')).totaal;
  await klikWeg('echt1');
  await wacht(300);
  ok('weghalen vraagt eerst', (await api('/api/library?aantal=1')).totaal === voorTotaal && (await status()).includes('Klik nog eens op ×'));
  await klikWeg('echt1');
  ok('tweede klik: weg, op het scherm en op de server',
    await tot(`!document.querySelector('#lib-panel button[data-weg="echt1"]') && document.querySelector('#lib-panel .lib-status').textContent.includes('1 gevonden')`, 5000)
    && (await api('/api/library?aantal=1')).totaal === voorTotaal - 1, await status());
  ok('en zijn hotcues ook', (await api('/api/library/echt1/hotcues')).hotcues.length === 0);

  // Midden in de hele lijst weghalen: je blijft waar je was.
  await evalueer(`(() => { const z = document.querySelector('#lib-panel .lib-zoek'); z.value = ''; z.dispatchEvent(new Event('input')); })()`);
  ok('zoekterm leeg: weer de hele lijst', await tot(`document.querySelector('#lib-panel .lib-status').textContent.includes('${N + 1} nummers')`, 5000), await status());
  await evalueer('document.querySelector("#lib-panel .lib-rijen").scrollTop = 28 * 2500');
  ok('midden in de lijst: rijen staan er', await tot(`${TITELS}.length > 5`, 5000));
  const inBeeld = await evalueer("[...document.querySelectorAll('#lib-panel .lib-venster button[data-weg]')].map((b) => b.dataset.weg)");
  const weg = inBeeld[12];
  await klikWeg(weg);
  await klikWeg(weg);
  ok(`weghalen midden in de lijst (${weg}): weg, en je blijft waar je was`, await tot(`!document.querySelector('#lib-panel button[data-weg="${weg}"]')
    && document.querySelector('#lib-panel .lib-status').textContent.includes('${N} nummers')
    && Math.abs(document.querySelector('#lib-panel .lib-rijen').scrollTop - 28 * 2500) < 2`, 5000), await status());
  await foto('library-weg.png');

  // ---- toonsoort in de lange lijst (samengevoegd met het toonsoort-spoor) ----
  // De kiezer zweeft onder zijn rij; de rijen eronder verschuiven niet, ook niet
  // als zijn rij uit het getekende stuk scrollt. zetToon vindt een nummer dat
  // niet in beeld is, en de kiezer op de laatste rij is te bereiken.
  console.log('\ntoonsoort in de lange lijst');
  const LIJST = "document.querySelector('#lib-panel .lib-rijen')";
  const rijVan = (id) => `document.querySelector('#lib-panel .lib-toon[data-toon="${id}"]')?.closest('.lib-rij')`;
  // Rijen in het venster liggen precies 28 px uit elkaar (de kiezer telt niet mee).
  const REGELMATIG = `(() => { const r = [...document.querySelectorAll('#lib-panel .lib-venster .lib-rij')].map((e) => e.getBoundingClientRect().top);
    return r.length > 5 && r.every((y, i) => i === 0 || Math.abs(y - r[i - 1] - 28) < 0.5); })()`;
  const onderRij = (id) => evalueer(`(() => { const r = ${rijVan(id)}, k = document.querySelector('#lib-panel .lib-toonkiezer');
    return !!(r && k) && Math.abs(k.getBoundingClientRect().top - r.getBoundingClientRect().bottom) < 1.5; })()`);
  const inBeeldToon = await evalueer("[...document.querySelectorAll('#lib-panel .lib-venster .lib-toon')].map((b) => b.dataset.toon)");
  const kid = inBeeldToon[14];
  await evalueer(`document.querySelector('#lib-panel .lib-toon[data-toon="${kid}"]').click()`);
  ok('de toonsoort-kolom is een knop; klik opent de kiezer onder die rij', await tot(`document.querySelectorAll('#lib-panel .lib-toonkiezer .lib-tk').length === 24`, 3000)
    && await onderRij(kid));
  ok('de rijen eronder verspringen niet (de kiezer zweeft erover)', await evalueer(REGELMATIG));
  const HEEL_IN_BEELD = `(() => { const k = document.querySelector('#lib-panel .lib-toonkiezer')?.getBoundingClientRect(),
    l = ${LIJST}.getBoundingClientRect(); return !!k && k.bottom <= l.bottom + 1 && k.top >= l.top; })()`;
  ok(`de kiezer onder de ${inBeeldToon.indexOf(kid) + 1}e getekende rij staat helemaal in beeld (de lijst schoof mee)`,
    await tot(HEEL_IN_BEELD, 2000) && await onderRij(kid));
  await foto('library-kiezer.png');
  await evalueer(`${LIJST}.scrollTop += 28 * 3`);
  await wacht(150);
  ok('drie rijen verder gescrold: de kiezer hangt nog onder zijn rij', await onderRij(kid) && await evalueer(REGELMATIG));
  await evalueer(`${LIJST}.scrollTop += 28 * 60`);
  ok('zijn rij uit het getekende stuk: kiezer weg, rijen regelmatig',
    await tot(`!document.querySelector('#lib-panel .lib-toonkiezer') && ${TITELS}.length > 5`, 5000) && await evalueer(REGELMATIG));
  await evalueer(`${LIJST}.scrollTop -= 28 * 63`);
  ok('terug: de kiezer staat weer onder zijn rij', await tot(`!!document.querySelector('#lib-panel .lib-toonkiezer')`, 3000) && await onderRij(kid));
  await evalueer(`document.querySelector('#lib-panel .lib-toonkiezer [data-tk="sluit"]').click()`);
  ok('× sluit de kiezer', await tot(`!document.querySelector('#lib-panel .lib-toonkiezer')`, 2000));

  // zetToon op een nummer dat in een geladen pagina staat maar NIET in de DOM.
  const verborgen = await evalueer(`(() => { const c = window.library.cache, inDom = new Set([...document.querySelectorAll('#lib-panel .lib-toon')].map((b) => b.dataset.toon));
    for (const p of c.paginas.values()) for (const t of p) if (!inDom.has(t.id)) return t.id; return null; })()`);
  const KAART = { stemming: 0, stukken: [{ van: 0, toonsoort: 'C', stemming: 0 }], bron: 'hand', slot: true };
  await evalueer(`window.library.zetToon(${JSON.stringify(verborgen)}, ${JSON.stringify(KAART)})`);
  const rijNr = await evalueer(`(() => { const c = window.library.cache; for (const [k, p] of c.paginas) { const i = p.findIndex((t) => t.id === ${JSON.stringify(verborgen)}); if (i >= 0) return k * c.grootte + i; } return -1; })()`);
  await evalueer(`${LIJST}.scrollTop = 28 * ${Math.max(0, rijNr - 3)}`);
  ok(`zetToon op een nummer buiten beeld (${verborgen}, rij ${rijNr}): na scrollen staat de nieuwe kaart in zijn rij`,
    await tot(`document.querySelector('#lib-panel .lib-toon[data-toon="${verborgen}"]')?.textContent === '8B C'
      && document.querySelector('#lib-panel .lib-toon[data-toon="${verborgen}"]').classList.contains('slot')`, 5000));
  ok('zetToon op een nummer dat nergens geladen is: geen fout', await evalueer(`(window.library.zetToon('bestaat-niet', ${JSON.stringify(KAART)}), true)`));

  // De kiezer op de LAATSTE rij: de lijst wordt langer, dus je kunt hem in beeld scrollen.
  await evalueer(`${LIJST}.scrollTop = ${LIJST}.scrollHeight`);
  // Wachten tot de rijen van ONDERAAN er staan (niet de vorige die nog in de DOM zitten).
  await tot(`(() => { const c = window.library.cache, b = [...document.querySelectorAll('#lib-panel .lib-venster .lib-toon')].at(-1);
    return !!b && b.dataset.toon === c.rij(c.totaal - 1)?.id; })()`, 5000);
  const laatste = await evalueer("[...document.querySelectorAll('#lib-panel .lib-venster .lib-toon')].at(-1).dataset.toon");
  await evalueer(`document.querySelector('#lib-panel .lib-toon[data-toon="${laatste}"]').click()`);
  await tot(`!!document.querySelector('#lib-panel .lib-toonkiezer')`, 2000);
  await evalueer(`${LIJST}.scrollTop = ${LIJST}.scrollHeight`);
  await wacht(150);
  ok('kiezer op de laatste rij: helemaal in beeld te scrollen', await onderRij(laatste) && await evalueer(HEEL_IN_BEELD));
  await foto('library-kiezer-onderaan.png');
  await evalueer(`document.querySelector('#lib-panel .lib-toonkiezer [data-tk="sluit"]').click()`);

  ok('geen fouten in de console', meldingen.length === 0, meldingen.join(' | '));
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
