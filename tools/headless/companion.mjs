// De companion (companion.html, docs/COMPANION.md) headless in echte Chromium,
// op een telefoon (390 × 844), een iPad liggend (1024 × 768) en staand (768 × 1024).
//
// Opzet: een EIGEN server op een eigen poort (nooit 8777) met een lege
// tijdelijke database, de nep-kaart (test/nep-kaart.mjs, twaalf nummers en de
// zeven slimme kratten) en de nep-yt-dlp (geen byte van internet; een "download"
// is een toon van 12 s die ffmpeg hier maakt, NEP_BRON). Er is hier
// GEEN mixertabblad: de companion moet het zonder doen. Getikt wordt met echte
// aanraakgebeurtenissen (Input.dispatchTouchEvent), niet met el.click().
//
// Veilig naast een proefavond (docs/COMPANION.md "Testen"):
// - Chromium altijd met --mute-audio en een eigen profiel (<tmp>/varve-companion-<pid>);
// - requestMIDIAccess en AudioContext zijn tellers die NOOIT de echte aanroepen
//   (er hangt misschien een APC aan deze Mac): de controle is dat ze 0 blijven;
// - SIGINT/SIGTERM/een fout ruimen Chromium, server en tmp op; een waakhond stopt
//   alles na 150 s; aan het eind kijkt het script ZELF na dat beide poorten weer
//   dicht zijn en dat er geen proces met dit profiel meer draait (de laatste
//   controle). Met de hand: `lsof -nP -iTCP:8805 -iTCP:9405 -sTCP:LISTEN` en
//   `pgrep -fl 'user-data-dir=[^ ]*varve-companion-'`, allebei leeg. NIET
//   `pgrep -fl '…|9405'`: dat getal stond toevallig in de argumenten van de
//   GPU-helper van Clay's eigen Chrome (review ronde 1, fix 3).
//
// "Nu" en "beeld" zijn in stap 1 leeg (de server kent /api/mixer nog niet). Eén
// blok bootst met de Fetch-laag van Chromium een melding na (acht tracks, beeld
// bevroren) om te zien hoe het er straks uitziet; dat is GEEN proef van stap 2.
//
// Gebruik:  node tools/headless/companion.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8805) en VARVE_KIJK_DEBUG (9405). Chrome: VARVE_CHROME.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schrijfKaart, NUMMERS } from '../../test/nep-kaart.mjs';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';
import { datumVan, nachtDatum } from '../../server/nacht.js';
import { BEELD_ZIN, NU_ONTBREEKT } from '../../src/companion/companion-lijst.js';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8805, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9405;
const B = `http://localhost:${POORT}`;
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

// ---- niets starten als de poorten bezet zijn (nooit iets van een ander stoppen) ----------------
for (const [naam, url] of [['server', `http://127.0.0.1:${POORT}/`], ['debug', `http://127.0.0.1:${DEBUG}/json/version`]]) {
  if (await fetch(url, { signal: AbortSignal.timeout(800) }).then(() => true).catch(() => false)) {
    console.log(`poort ${naam} (${url}) is bezet: kies VARVE_KIJK_POORT / VARVE_KIJK_DEBUG. Niets gestart.`);
    process.exit(4);
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'varve-companion-'));
const profiel = join(tmp, `varve-companion-${process.pid}`);
const kaartPad = join(tmp, 'varve-kaart.json');
const nepLog = join(tmp, 'nep.log');
schrijfKaart(kaartPad);
mkdirSync(join(tmp, 'media'), { recursive: true });
// De "download" van de nep-yt-dlp: 12 s toon (haal nu loopt echt door de ingest, zonder internet).
const bron = join(tmp, 'bron.wav');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-ac', '2', bron]);

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'media', 'library.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PATRONEN: join(tmp, 'patronen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_HERANALYSE: 'uit',
    VARVE_YTDLP: maakNepYtdlp(tmp), NEP_LOG: nepLog, NEP_BRON: bron, NEP_DUUR: '300', VARVE_KAART: kaartPad, VARVE_HOSTS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profiel}`, '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--window-size=1024,844',
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });
console.log(`server pid ${server.pid} op :${POORT} · chromium pid ${chrome.pid} op :${DEBUG} · tmp ${tmp}`);

let opgeruimd = false;
function opruimen() {
  if (opgeruimd) return;
  opgeruimd = true;
  try { chrome.kill('SIGTERM'); } catch {}
  try { server.kill('SIGTERM'); } catch {}
  // Chromium schrijft nog even in zijn profiel: een paar keer proberen.
  for (let i = 0; i < 5; i++) { try { rmSync(tmp, { recursive: true, force: true }); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); } }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log(`\n${sig}: opruimen`); opruimen(); process.exit(2); });
process.on('uncaughtException', (e) => { console.log(`\nfout: ${e.stack || e}`); opruimen(); process.exit(2); });
process.on('unhandledRejection', (e) => { console.log(`\nfout: ${e?.stack || e}`); opruimen(); process.exit(2); });
setTimeout(() => { console.log('\nwaakhond: 150 s voorbij, alles stoppen'); opruimen(); process.exit(3); }, 150_000).unref();

// Vóór elke pagina: MIDI en geluid als teller, die de echte NOOIT aanroept.
const TELLERS = `(() => {
  window.__midiAanroepen = 0; window.__audioContexten = 0;
  const weiger = () => Promise.reject(new DOMException('geen MIDI in de proef', 'NotSupportedError'));
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true, writable: true,
    value: function () { window.__midiAanroepen++; return weiger(); } });
  for (const naam of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) {
    Object.defineProperty(window, naam, { configurable: true, writable: true,
      value: function () { window.__audioContexten++; throw new Error('geen geluid in de proef'); } });
  }
})();`;

/** Een tabblad via het DevTools-protocol: cdp(), ev(), op(gebeurtenis), en de fouten in de console. */
async function verbind(doel) {
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let volg = 0;
  const wachtend = new Map(), fouten = [], logFouten = [], luisteraars = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.f(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    // Wat Chromium zelf in de console zet: netwerkfouten (404, 409), ook als de pagina ze netjes afvangt.
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logFouten.push({ tekst: m.params.entry.text, url: m.params.entry.url ?? '' });
    if (m.method && luisteraars.has(m.method)) luisteraars.get(m.method)(m.params);
  });
  const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const op = (methode, fn) => luisteraars.set(methode, fn);
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable'); await cdp('Network.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: TELLERS });
  return { ws, cdp, ev, op, fouten, logFouten };
}
async function tot(fn, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(150); }
  return false;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const api = async (pad, body) => {
  const r = await fetch(B + pad, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const nepRegels = () => (existsSync(nepLog) ? readFileSync(nepLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const schermen = [];

let p;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  p = await verbind(doelen.find((d) => d.type === 'page'));
  let serverOp = false;
  for (let i = 0; i < 100 && !serverOp; i++) { serverOp = await fetch(`${B}/api/kaart`).then((r) => r.ok).catch(() => false); if (!serverOp) await wacht(150); }
  ok('eigen server draait (lege db, nep-kaart, nep-yt-dlp)', serverOp);
  ok('de opstartregel zegt dat iPad en iPhone zonder VARVE_HOSTS een 403 krijgen', serverLog.includes('VARVE_HOSTS is leeg'));

  const nacht0 = (await api('/api/nacht')).j;
  const serverNu = new Date(nacht0.nu);
  const VANDAAG = datumVan(serverNu);
  const SPEELDAG = [...new Set([VANDAAG, nachtDatum(serverNu)])];
  await api('/api/nacht', { speeldagen: SPEELDAG });

  // ---- hulpjes op de pagina ----
  const scherm = async (w, h, dpr) => {
    await p.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
    await p.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  };
  const laad = async (pad = '/companion') => {
    await p.cdp('Page.navigate', { url: B + pad });
    return tot(() => p.ev('window.companion?.klaar === true'), 10000);
  };
  /** Echt tikken: in beeld schuiven, dan touchStart/touchEnd op het midden. */
  const tik = async (selector) => {
    const plek = await p.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
      el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!plek) throw new Error(`niets om op te tikken: ${selector}`);
    await p.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: plek.x, y: plek.y }] });
    await p.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wacht(120);
  };
  const tekst = (sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
  const zichtbaar = (sel) => p.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })()`);
  const rijen = () => p.ev(`[...document.querySelectorAll('#lijst > li.rij')].map((li) => ({ s: li.dataset.sleutel, stand: li.dataset.stand,
    knoppen: [...li.querySelectorAll('button')].map((b) => b.textContent.trim()) }))`);
  const meldingen = () => p.ev('window.companion.meldingen.map((m) => m.tekst)');
  const foto = async (naam) => {
    await wacht(250);
    const f = await p.cdp('Page.captureScreenshot', { format: 'png' });
    const pad = join(UIT, naam);
    writeFileSync(pad, Buffer.from(f.data, 'base64'));
    schermen.push([naam, statSync(pad).size]);
  };
  const geenZijwaarts = () => p.ev('document.documentElement.scrollWidth <= innerWidth');
  /** Elk zichtbaar tikdoel (knop, keuzelijst, invoer) in de pagina: { klein: [...] } onder 44 × 44. */
  const tikdoelen = () => p.ev(`(() => { const klein = []; let n = 0;
    for (const el of document.querySelectorAll('button, select, input')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || el.closest('[hidden]')) continue;
      if (getComputedStyle(el).display === 'none') continue;
      n++; if (r.width < 44 || r.height < 44) klein.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    } return { n, klein }; })()`);

  // ================= telefoon 390 × 844 =================
  console.log('\nde telefoon: 390 × 844 (iPhone 14 Pro, staand)');
  await scherm(390, 844, 3);
  // Elk verzoek naar de wenslijst tellen (fix 5: niet peilen zolang de kaart niet te zien is).
  const wensVerzoeken = [];
  p.op('Network.requestWillBeSent', (q) => { if (/\/api\/kaart\/wensen/.test(q.request.url)) wensVerzoeken.push({ t: Date.now(), url: q.request.url }); });
  ok('companion laadt en is klaar', await laad());
  ok('de kop zegt met welke server hij praat', /localhost:\d+/.test(await tekst('#verbinding')));
  ok('eerste keer (niets bewaard), /api/mixer geeft 404: de kaart, niet een vrijwel leeg "nu" (fix 4)',
    await tot(async () => (await p.ev('document.body.dataset.tab')) === 'kaart') && await zichtbaar('#kaart') && !(await zichtbaar('#nu')) && !(await zichtbaar('#beeld')));
  ok('... en die keuze is niet bewaard (Clay koos niets)', (await p.ev('localStorage.getItem("varve.companion.tab")')) === null);
  ok('naar de kaart: meteen de wenslijst, de lichte vorm (?licht=1)', await tot(async () => wensVerzoeken.length > 0, 3000)
    && wensVerzoeken.every((v) => /\?licht=1$/.test(v.url)), wensVerzoeken.map((v) => v.url).join(' '));
  await tik('.onderbalk button[data-tab="nu"]');
  ok('tik op "nu": een zin voor Clay, geen ontwikkelaarszin', await tot(async () => (await tekst('#nu-inhoud')).includes(NU_ONTBREEKT))
    && !/\/api\/mixer|stap 2/.test(await tekst('#nu-inhoud')));
  ok('390 px op "nu": geen zijwaarts scrollen', await geenZijwaarts());
  await foto('companion-390-nu-leeg.png');
  const sindsNu = Date.now();
  await wacht(6500);
  ok(`zolang "nu" open is (6,5 s): geen GET /api/kaart/wensen (fix 5; ${wensVerzoeken.filter((v) => v.t >= sindsNu).length} gezien)`,
    wensVerzoeken.filter((v) => v.t >= sindsNu).length === 0);

  await tik('.onderbalk button[data-tab="beeld"]');
  ok('tik op "beeld": alleen het beeld', (await p.ev('document.body.dataset.tab')) === 'beeld' && await zichtbaar('#beeld') && !(await zichtbaar('#nu')));
  const beeld = await tekst('#beeld-inhoud');
  ok('"beeld": nog geen beeldstand, met de zin over de pc-beamer en de APC', /nog geen beeldstand/.test(beeld) && beeld.includes(BEELD_ZIN));
  ok('"beeld" heeft geen knoppen (in v1 alleen tonen)', (await p.ev('document.querySelectorAll("#beeld button").length')) === 0);
  await foto('companion-390-beeld.png');

  const voorKaart = Date.now();
  await tik('.onderbalk button[data-tab="kaart"]');
  ok('tik op "kaart": de kaart', (await p.ev('document.body.dataset.tab')) === 'kaart' && await zichtbaar('#kaart'));
  ok('... en meteen de wenslijst (binnen 1,5 s een verzoek, niet pas na 5 s)', await tot(async () => wensVerzoeken.some((v) => v.t >= voorKaart), 1500));
  ok(`de hele kaart: ${NUMMERS.length} rijen, "${NUMMERS.length} nummers"`, (await rijen()).length === NUMMERS.length
    && (await tekst('#lijst-stand')) === `${NUMMERS.length} nummers`);
  const opties = await p.ev(`[...document.querySelectorAll('#krat option')].map((o) => ({ v: o.value, groep: o.parentElement.label ?? null }))`);
  ok(`kratkiezer: proefkrat, eigen keuze, vertrouwd bovenaan (${opties.slice(1, 4).map((o) => o.v).join(', ')})`,
    opties[0].v === '' && opties.slice(1, 4).every((o) => o.groep === 'bovenaan') && opties.slice(1, 4).map((o) => o.v).join() === 'slim:proefkrat,slim:eigen-keuze,slim:vertrouwd');
  ok(`speeldag (${SPEELDAG.join(', ')}): "haal nu" staat uit en zegt waarom; geen speeldag-knop`,
    (await p.ev('document.getElementById("haal-nu").disabled')) && /vandaag speeldag/.test(await tekst('#haal-nu')) && !(await zichtbaar('#speeldag')));

  // zoeken
  await tik('#zoek');
  await p.cdp('Input.insertText', { text: 'four tet' });
  const zoekTotaal = (await api('/api/kaart/nummers?zoek=four%20tet&sorteer=beurten&richting=af&van=0&aantal=50')).j.totaal;
  ok(`zoeken "four tet": ${zoekTotaal} rijen, zoals de server telt`, await tot(async () => (await rijen()).length === zoekTotaal && zoekTotaal === 2));
  await p.ev(`(() => { const z = document.getElementById('zoek'); z.value = ''; z.dispatchEvent(new Event('input')); })()`);
  ok('zoekveld leeg: weer de hele kaart', await tot(async () => (await rijen()).length === NUMMERS.length));

  // een krat kiezen en vastpinnen
  const kratten = (await api('/api/kaart')).j.kratten;
  const vertrouwd = kratten.find((k) => k.id === 'slim:vertrouwd');
  await p.ev(`(() => { const s = document.getElementById('krat'); s.value = 'slim:vertrouwd'; s.dispatchEvent(new Event('change')); })()`);
  ok(`krat vertrouwd: ${vertrouwd.aantal} nummers`, await tot(async () => (await rijen()).length === vertrouwd.aantal));
  await tik('#ster');
  ok('ster: vertrouwd vastgepind op dit apparaat (★, aria-pressed)', (await p.ev('document.getElementById("ster").getAttribute("aria-pressed")')) === 'true'
    && (await p.ev('localStorage.getItem("varve.companion.pins")')) === '["slim:vertrouwd"]');
  await p.ev(`(() => { const s = document.getElementById('krat'); s.value = 'slim:eigen-likes'; s.dispatchEvent(new Event('change')); })()`);
  await tik('#ster');
  ok('nog een ster (eigen likes): nieuwste eerst', (await p.ev('localStorage.getItem("varve.companion.pins")')) === '["slim:eigen-likes","slim:vertrouwd"]');
  ok('herladen: de tab kaart blijft open en de sterren staan bovenaan, vóór de indeling', await laad()
    && (await p.ev('document.body.dataset.tab')) === 'kaart'
    && (await p.ev(`[...document.querySelectorAll('#krat optgroup[label="bovenaan"] option')].map((o) => o.value).join()`))
      === 'slim:eigen-likes,slim:vertrouwd,slim:proefkrat,slim:eigen-keuze');

  // filter
  await tik('#filters [data-filter="geen-video"]');
  ok('filter "geen video": alleen de twee Spotify-nummers', await tot(async () => { const r = await rijen(); return r.length === 2 && r.every((x) => x.s.startsWith('sp:')); }));
  await tik('#filters [data-filter="geen-video"]');
  ok('filter weer uit', await tot(async () => (await rijen()).length === NUMMERS.length));

  // wens
  const WENS = 'yt:fourtet0baby';
  ok('Four Tet - Baby is een kandidaat met de knop wens', (await rijen()).find((r) => r.s === WENS)?.knoppen.join() === 'wens');
  await tik(`#lijst [data-wens="${WENS}"]`);
  ok('tik op wens: de rij staat op wacht, zonder knop (geen intrekken)', await tot(async () => { const r = (await rijen()).find((x) => x.s === WENS); return r?.stand === 'wacht' && r.knoppen.length === 0; }));
  ok('... en de server heeft hem op de wenslijst', (await api('/api/kaart/wensen')).j.wensen.some((w) => w.sleutel === WENS && w.status === 'wacht'));
  ok('de melding zegt wat er gebeurt: "1 op de wenslijst · vandaag speeldag: niet vóór morgen"',
    (await meldingen()).includes('1 op de wenslijst · vandaag speeldag: niet vóór morgen'), (await meldingen()).join(' | '));
  ok('de wenslijst telt mee: "1 wacht"', await tot(async () => /^1 wacht/.test(await tekst('#wens-telling'))));
  ok('nog steeds geen download: de nep-yt-dlp is niet aangeroepen', nepRegels().length === 0);
  await p.ev('window.scrollTo(0, 0)');
  await foto('companion-390-kaart.png');

  // kies: de laptop zoekt (hier het script, via de API zoals het kaartpaneel), de telefoon kiest
  console.log('\nkies: de laptop zocht, de telefoon kiest (W4c)');
  const SP = 'sp:sp0000000002';
  await api('/api/kaart/wens', { sleutels: [SP] });
  const gezocht = await api(`/api/kaart/nummer/${encodeURIComponent(SP)}/zoek`, {});
  ok(`de laptop zocht (nep-yt-dlp, ytsearch5): ${gezocht.j?.kandidaten?.length} kandidaten`, gezocht.status === 200 && gezocht.j.kandidaten.length === 5);
  ok('binnen 6 s ziet de telefoon het zelf (wenslijst elke 5 s): de rij krijgt de knop kies', await tot(async () => {
    const r = (await rijen()).find((x) => x.s === SP); return r?.stand === 'kies' && r.knoppen.join() === 'kies'; }, 7000));
  await tik(`#lijst [data-kies-open="${SP}"]`);
  const kandidaten = await p.ev(`[...document.querySelectorAll('#lijst [data-kies][data-id="${SP}"]')].map((b) => b.dataset.kies)`);
  ok(`tik op kies: de vijf kandidaten als knoppen onder de rij (${kandidaten.length})`, kandidaten.length === 5);
  const doelen1 = await tikdoelen();
  ok(`elk tikdoel ≥ 44 × 44, ook in het kieslijstje (${doelen1.n} getoetst)`, doelen1.klein.length === 0, doelen1.klein.join(', '));
  ok('390 px met het kieslijstje open: geen zijwaarts scrollen', await geenZijwaarts());
  await foto('companion-390-kies.png');
  await tik(`#lijst [data-kies="${kandidaten[0]}"][data-id="${SP}"]`);
  ok('tik op een kandidaat: de rij wacht weer, met die video op de server', await tot(async () => (await rijen()).find((x) => x.s === SP)?.stand === 'wacht')
    && (await api('/api/kaart/wensen')).j.wensen.find((w) => w.sleutel === SP)?.youtube_id === kandidaten[0]);
  ok('de melding noemt de keuze', (await meldingen()).some((m) => /^gekozen: .* · staat op de wenslijst$/.test(m)), (await meldingen()).at(-1));

  // haal nu en de speeldag
  console.log('\nhaal nu en de speeldag');
  await api('/api/nacht', { speeldagen: [] });
  ok('geen speeldag (na herladen): "haal de wenslijst nu op (2)" staat aan, de speeldag-knop verschijnt', await laad()
    && await tot(async () => (await tekst('#haal-nu')) === 'haal de wenslijst nu op (2)' && !(await p.ev('document.getElementById("haal-nu").disabled')))
    && await zichtbaar('#speeldag') && (await tekst('#speeldag')) === 'vandaag speeldag');
  // De laptop zet net de speeldag terwijl de telefoon nog de oude stand heeft; dan tikt Clay op haal nu.
  const logVoor = p.logFouten.length;
  await p.ev(`fetch('/api/nacht', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ speeldagen: SPEELDAG }))} }).then(() => true)`);
  await tik('#haal-nu');
  ok('haal nu terwijl de laptop net speeldag zette: de server weigert, de melding zegt "vandaag is een speeldag"',
    await tot(async () => (await meldingen()).includes('vandaag is een speeldag')), (await meldingen()).at(-1));
  await wacht(400);
  ok('geen run gestart en niets gedownload (in het nep-log alleen de zoekvraag van de laptop)',
    (await api('/api/nacht')).j.bezig === null && nepRegels().length === 1 && nepRegels()[0].wat === 'zoek', nepRegels().map((r) => r.wat).join(', '));
  ok('de knop zegt nu zelf "vandaag speeldag"', await tot(async () => /vandaag speeldag/.test(await tekst('#haal-nu'))));
  ok('de netwerkfout in de console is alleen die 409 van /api/nacht/nu', p.logFouten.slice(logVoor).every((f) => /api\/nacht\/nu/.test(f.url + f.tekst)),
    p.logFouten.slice(logVoor).map((f) => `${f.tekst} ${f.url}`).join(' | '));
  // Haal nu echt (fix 1): alleen de wenslijst, ook al staat de standaardvolgorde aan. Geen pauze tussen twee.
  console.log('\nhaal nu echt: alleen de wenslijst (de standaardvolgorde staat aan)');
  const nachtH = (await api('/api/nacht', { speeldagen: ['2026-01-02'], pauze: { min: 0, max: 0 } })).j;
  ok('de standaardvolgorde staat aan (standaard)', nachtH.standaardVolgorde === true);
  await laad();
  ok('geen speeldag: "haal de wenslijst nu op (2)"', await tot(async () => (await tekst('#haal-nu')) === 'haal de wenslijst nu op (2)'));
  const zoekVoor = nepRegels().length;
  await tik('#haal-nu');
  ok('tik: de melding "run gestart: hooguit 2 van de wenslijst"', await tot(async () => (await meldingen()).includes('run gestart: hooguit 2 van de wenslijst')),
    (await meldingen()).at(-1));
  ok('... en de knop zegt meteen "haal nu: er loopt al een run"', await tot(async () => (await tekst('#haal-nu')) === 'haal nu: er loopt al een run', 1500),
    await tekst('#haal-nu'));
  ok('binnen 25 s staan beide rijen op klaar, zonder herladen (de lijst volgt de wenslijst)', await tot(async () => {
    const r = await rijen(); return r.find((x) => x.s === WENS)?.stand === 'klaar' && r.find((x) => x.s === SP)?.stand === 'klaar'; }, 25000),
    JSON.stringify((await rijen()).filter((x) => x.s === WENS || x.s === SP)));
  const downloads = nepRegels().slice(zoekVoor).filter((r) => r.wat === 'download').map((r) => r.url);
  ok(`alleen die twee gedownload, niets uit de standaardvolgorde (${downloads.length}: ${downloads.map((u) => u.split('=').pop()).join(', ')})`,
    downloads.length === 2 && (await api('/api/kaart/wensen')).j.wensen.every((w) => w.bron !== 'nacht'));
  ok('de run is klaar en de knop zegt weer "niets te halen"', await tot(async () => (await api('/api/nacht')).j.bezig === null
    && (await tekst('#haal-nu')) === 'haal nu: niets te halen', 8000), await tekst('#haal-nu'));
  await api('/api/nacht', { speeldagen: ['2026-01-02'] });
  await laad();
  ok('weer geen speeldag: de knop "vandaag speeldag" staat er', await tot(() => zichtbaar('#speeldag')));
  await tik('#speeldag');
  const naTik = (await api('/api/nacht')).j.speeldagen;
  ok(`tik op "vandaag speeldag": alleen toegevoegd (${naTik.join(', ')})`, naTik.includes('2026-01-02') && naTik.includes(VANDAAG));
  ok('... de knop is weg en "haal nu" zegt weer speeldag', await tot(async () => !(await zichtbaar('#speeldag')) && /vandaag speeldag/.test(await tekst('#haal-nu'))));
  await api('/api/nacht', { speeldagen: SPEELDAG });

  // meer
  ok('met ?pagina=5 (alleen voor deze proef): "5 van 12" en de knop meer', await laad('/companion?pagina=5')
    && (await rijen()).length === 5 && (await tekst('#lijst-stand')) === `5 van ${NUMMERS.length}` && await zichtbaar('#meer'));
  await tik('#meer');
  ok('meer: 10', await tot(async () => (await rijen()).length === 10));
  await tik('#meer');
  ok(`meer: alle ${NUMMERS.length}, de knop is weg`, await tot(async () => (await rijen()).length === NUMMERS.length && !(await zichtbaar('#meer'))));
  const doelen2 = await tikdoelen();
  ok(`kaart: elk tikdoel ≥ 44 × 44 (${doelen2.n} getoetst)`, doelen2.klein.length === 0, doelen2.klein.join(', '));
  ok('390 px op "kaart": geen zijwaarts scrollen', await geenZijwaarts());

  // ================= iPad liggend 1024 × 768 =================
  console.log('\nde iPad liggend: 1024 × 768');
  await scherm(1024, 768, 2);
  await laad();
  const vakken = await p.ev(`Object.fromEntries(['kaart', 'nu', 'beeld'].map((id) => { const r = document.getElementById(id).getBoundingClientRect();
    return [id, { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) }]; }))`);
  ok(`twee kolommen: kaart links (${vakken.kaart.w} px), nu en beeld rechts`, vakken.kaart.r <= vakken.nu.l && vakken.kaart.r <= vakken.beeld.l
    && vakken.nu.b <= vakken.beeld.t + 1 && vakken.kaart.w > vakken.nu.w, JSON.stringify(vakken));
  ok('geen onderbalk; alle drie zichtbaar, welke tab er ook bewaard is', !(await zichtbaar('.onderbalk')) && await zichtbaar('#nu') && await zichtbaar('#beeld') && await zichtbaar('#kaart'));
  ok('1024 px: geen zijwaarts scrollen', await geenZijwaarts());
  const doelen3 = await tikdoelen();
  ok(`1024: elk tikdoel ≥ 44 × 44 (${doelen3.n} getoetst)`, doelen3.klein.length === 0, doelen3.klein.join(', '));
  await foto('companion-1024.png');
  // Fix 6: nu en beeld blijven staan als de kaart scrolt.
  await p.ev('window.scrollTo(0, 1500)');
  await wacht(250);
  const plak = await p.ev(`({ y: Math.round(scrollY), nu: Math.round(document.getElementById('nu').getBoundingClientRect().top),
    beeld: Math.round(document.getElementById('beeld').getBoundingClientRect().bottom) })`);
  ok(`gescrold (${plak.y} px): nu staat nog bovenaan (top ${plak.nu} px), beeld in beeld (onder ${plak.beeld} px)`,
    plak.y >= 200 && plak.nu >= 0 && plak.nu <= 120 && plak.beeld <= 768, JSON.stringify(plak));
  await foto('companion-1024-gescrold.png');
  await p.ev('window.scrollTo(0, 0)');

  // ================= iPad staand 768 × 1024 (fix 7) =================
  console.log('\nde iPad staand: 768 × 1024');
  await scherm(768, 1024, 2);
  await laad();
  const staand = await p.ev(`(() => { const r = document.getElementById('kaart').getBoundingClientRect(); return { w: Math.round(r.width), tab: document.body.dataset.tab }; })()`);
  ok(`één kolom met onderbalk: alleen de gekozen tab (${staand.tab}), de kaart ${staand.w} px breed`, await zichtbaar('.onderbalk')
    && staand.tab === 'kaart' && await zichtbaar('#kaart') && !(await zichtbaar('#nu')) && !(await zichtbaar('#beeld')) && staand.w >= 700);
  ok('768: geen zijwaarts scrollen', await geenZijwaarts());
  const doelen4 = await tikdoelen();
  ok(`768: elk tikdoel ≥ 44 × 44 (${doelen4.n} getoetst)`, doelen4.klein.length === 0, doelen4.klein.join(', '));
  await foto('companion-768.png');
  await tik('.onderbalk button[data-tab="nu"]');
  ok('768: tik op "nu" werkt (onderbalk)', (await p.ev('document.body.dataset.tab')) === 'nu' && await zichtbaar('#nu') && !(await zichtbaar('#kaart')));
  await tik('.onderbalk button[data-tab="kaart"]');

  // ================= laden over een trage verbinding =================
  console.log('\neen trage verbinding (200 ms per verzoek, zoals een hotspot)');
  await scherm(390, 844, 3);
  await p.cdp('Network.emulateNetworkConditions', { offline: false, latency: 200, downloadThroughput: -1, uploadThroughput: -1 });
  await p.cdp('Network.setCacheDisabled', { cacheDisabled: true });
  const t0 = Date.now();
  await p.cdp('Page.navigate', { url: `${B}/companion` });
  const vol = await tot(async () => (await p.ev('window.companion?.klaar === true')) && (await p.ev('document.querySelectorAll("#lijst > li").length')) > 0, 20000);
  const laadMs = Date.now() - t0;
  ok(`laadtijd tot de kaart gevuld is, met 200 ms per verzoek: ${laadMs} ms (gemeten, geen belofte)`, vol);
  await p.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // ================= nagebootst: zo ziet "nu" eruit als de mixer zich meldt (stap 2) =================
  console.log('\nnagebootst met de Fetch-laag (stap 2 bestaat nog niet): "nu" en "beeld" met een melding');
  let leeftijd = 800;
  const melding = () => ({ leeftijd_ms: leeftijd, twee: false, speelt: true, melding: {
    t: Date.now() - leeftijd, tab: 'proef', audio: 'running', focus: 'A', auto: false, opname: true,
    midi: { aan: true, invoer: 'APC40 mkII', uitvoer: 'APC40 mkII' },
    tracks: [
      { id: 'A', titel: 'Four Tet - Baby', speelt: true, bpm: 124, toon: '8A', positie: 600, duur: 3600, rate: 1 },
      { id: 'B', titel: 'Burial - Archangel', speelt: false, bpm: 139.5, toon: '4A', positie: 0, duur: 238, rate: 1 },
      ...'CDEFG'.split('').map((id) => ({ id, titel: `Proef ${id}`, speelt: false, bpm: 120, toon: '1B', positie: 0, duur: 300, rate: 1 })),
      { id: 'H', titel: 'Nils Frahm - Says', speelt: true, bpm: 120.2, toon: '11B', positie: 300, duur: 500, rate: 1.05 },
    ],
    eind: { zwart: false, bevroren: true, master: 0.8 } } });
  p.op('Fetch.requestPaused', (q) => p.cdp('Fetch.fulfillRequest', { requestId: q.requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(melding())).toString('base64') }).catch(() => {}));
  await p.cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/mixer*', requestStage: 'Request' }] });
  await p.ev('localStorage.setItem("varve.companion.tab", "nu")');
  await laad();
  ok('acht rijen A–H, A en H spelen', await tot(async () => (await p.ev('document.querySelectorAll("#nu .nu-track").length')) === 8
    && (await p.ev('document.querySelectorAll("#nu .nu-track.speelt").length')) === 2));
  const restA = await p.ev('document.querySelector(\'#nu [data-track="A"] .nu-rest\').textContent');
  const restH = await p.ev('document.querySelector(\'#nu [data-track="H"] .nu-rest\').textContent');
  ok(`resttijd: A "${restA}", H (rate 1,05) "${restH}"`, /^nog 49:5\d$/.test(restA) && /^nog 3:0\d$/.test(restH));
  ok('onderregel: audio aan · APC40 mkII · opname loopt · auto-DJ uit', /audio aan.*APC: APC40 mkII.*opname loopt.*auto-DJ uit/.test(await tekst('#nu-inhoud')));
  await foto('companion-390-nu-voorproef.png');
  await tik('.onderbalk button[data-tab="beeld"]');
  ok('beeld: BEVRIES aan, ZWART uit, MASTER 80 %', /ZWARTuit.*BEVRIESaan.*MASTER80%/.test((await tekst('#beeld-inhoud')).replace(/\s+/g, '')));
  await tik('.onderbalk button[data-tab="nu"]');
  leeftijd = 6000;
  ok('melding van 6 s oud: "mixer meldt zich niet", de stand grijs, resttijd met ≈', await tot(async () => /mixer meldt zich niet/.test(await tekst('#nu-inhoud'))
    && (await p.ev('document.querySelector("#nu .nu-tracks.grijs") !== null')) && /^≈ nog/.test(await p.ev('document.querySelector(\'#nu [data-track="A"] .nu-rest\').textContent')), 4000));
  await p.cdp('Fetch.disable');

  // ================= de grenzen =================
  console.log('\nde grenzen: geen geluid, geen MIDI, geen tabblad-slot');
  ok('requestMIDIAccess nooit aangeroepen', (await p.ev('window.__midiAanroepen')) === 0);
  ok('geen AudioContext gemaakt', (await p.ev('window.__audioContexten')) === 0);
  const sloten = await p.ev('navigator.locks.query().then((q) => [...q.held, ...q.pending].map((l) => l.name))');
  ok(`geen Web Lock (en zeker geen varve-mixer): [${sloten.join(', ')}]`, sloten.length === 0);
  ok('geen fouten van de pagina zelf (Runtime: uitzonderingen en console.error)', p.fouten.length === 0, p.fouten.join(' | '));
  const vreemd = p.logFouten.filter((f) => !/\/api\/mixer/.test(f.url + f.tekst) && !/\/api\/nacht\/nu/.test(f.url + f.tekst));
  ok(`netwerkfouten in de console alleen de verwachte (404 /api/mixer, 409 /api/nacht/nu): ${p.logFouten.length}`, vreemd.length === 0,
    vreemd.map((f) => `${f.tekst} ${f.url}`).join(' | '));
  const mixer404 = p.logFouten.filter((f) => /\/api\/mixer/.test(f.url + f.tekst)).length;
  ok(`/api/mixer na een 404 niet elke seconde opnieuw: ${mixer404} keer in de hele run (één per laden)`, mixer404 <= 12);

  console.log('\nschermafdrukken');
  for (const [naam, grootte] of schermen) ok(`${naam}: ${Math.round(grootte / 1024)} kB`, grootte > 10 * 1024);
} catch (err) {
  ok(`script liep door: ${err.stack || err.message}`, false);
} finally {
  try { p?.ws.close(); } catch {}
  opruimen();
  await wacht(500);
}
// Zelf nakijken dat alles van deze run weg is (fix 3): beide poorten dicht, en geen
// proces meer met DIT profiel in zijn argumenten (de tmp-map is uniek per run).
{
  const open = (url) => fetch(url, { signal: AbortSignal.timeout(800) }).then(() => true).catch(() => false);
  const eigen = () => { try { return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter((r) => r.includes(tmp)).map((r) => r.trim().slice(0, 120)); } catch { return ['ps faalde']; } };
  let vrij = false, over = [];
  for (let i = 0; i < 25 && !vrij; i++) {
    const poortOpen = (await open(`http://127.0.0.1:${POORT}/`)) || (await open(`http://127.0.0.1:${DEBUG}/json/version`));
    over = eigen();
    vrij = !poortOpen && over.length === 0;
    if (!vrij) await wacht(200);
  }
  ok(`poorten ${POORT}/${DEBUG} weer vrij, geen eigen Chromium meer`, vrij, over.join(' | '));
}
const rood = uitkomst.filter(([, g]) => !g).length;
if (rood) console.log(`\nserverlog (laatste regels):\n${serverLog.split('\n').slice(-15).join('\n')}`);
console.log(`\n${uitkomst.length - rood}/${uitkomst.length} ok${rood ? ` — ${rood} FOUT(EN)` : ''}. Schermafdrukken in ${UIT}.`);
console.log(`Met de hand nakijken (allebei leeg = goed): lsof -nP -iTCP:${POORT} -iTCP:${DEBUG} -sTCP:LISTEN   en   pgrep -fl 'user-data-dir=[^ ]*varve-companion-'`);
process.exit(rood ? 1 : 0);
