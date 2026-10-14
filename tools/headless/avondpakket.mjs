// Controlekamer × avondpakket, headless in Chromium (docs/AVONDPAKKET.md, ontwerp
// stap 5): de tegel Avondpakket, de keuze (profiel, fase), de punten en de
// paklijst, en vooral WANNEER de pagina meet: bij het openen, bij een keuze,
// bij een klik, verder hooguit elke 5 min; niet als de mixer open is (Web Lock,
// de tweede laag naast de bevriezing in de server).
//
// Opzet: een EIGEN server op een eigen poort met een kladlibrary (twee nummers,
// één met stems in de rij maar zonder stems.wav), kladmedia en de volledige
// omgeving, plus VARVE_AVONDPAKKET_NEP: geen system_profiler, geen find op echte
// mappen, geen hardware. GEEN echte mixer: de Web Lock wordt in een tweede
// tabblad van dezelfde oorsprong vastgehouden (een JSON-pagina, geen script).
// Chromium met --mute-audio en zonder requestMIDIAccess.
//
// Gebruik:  node tools/headless/avondpakket.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8914) en VARVE_KIJK_DEBUG (9514). Chrome: VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Library } from '../../server/library.js';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8914, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9514;
const tmp = mkdtempSync(join(tmpdir(), 'varve-avondpakket-kijk-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';
const FX = join(WORTEL, 'test/fixtures/avondpakket');

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- de kladlibrary en de nep-sondes ------------------------------------------------
const media = join(tmp, 'media');
for (const id of ['nrA', 'nrB']) { mkdirSync(join(media, id), { recursive: true }); writeFileSync(join(media, id, 'audio.wav'), Buffer.alloc(4096, 1)); }
{
  const lib = new Library(join(tmp, 'lib.db'));
  for (const id of ['nrA', 'nrB']) {
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: 10,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  }
  lib.bewaarStems('nrA', { aantal: 2, namen: ['zang', 'rest'], schaal: 1, bestand: 'media/nrA/stems.wav' });
  lib.sluit();
}
const nepMap = join(tmp, 'nep');
mkdirSync(nepMap);
{
  const basis = JSON.parse(readFileSync(join(FX, 'nep.json'), 'utf8'));
  for (const [k, v] of Object.entries(basis)) if (typeof v === 'string' && /\.(txt|json)$/.test(v)) basis[k] = join(FX, v);
  const regels = ['nrA', 'nrB'].map((id) => `4096 ${join(media, id, 'audio.wav')}`).join('\n') + '\n';
  writeFileSync(join(nepMap, 'nep.json'), JSON.stringify({ ...basis, 'find-stat': { tekst: regels }, 'find-dataless': { tekst: '' },
    paden: { media, wortel: WORTEL, db: join(tmp, 'lib.db'), extra: [] } }));
}

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media,
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PATRONEN: join(tmp, 'patronen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_KAART: join(WORTEL, 'test/fixtures/varve-kaart.klein.json'),
    VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_NACHT: join(tmp, 'nacht.json'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp),
    VARVE_AVONDPAKKET_NEP: nepMap },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`, '--mute-audio',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

/** Een tabblad via het DevTools-protocol (zoals tools/headless/sec-controle.mjs), plus een teller op /api/avondpakket. */
async function verbind(doel) {
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let volg = 0;
  const wachtend = new Map(), fouten = [], logFouten = [], luisteraars = new Map(), vragen = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.f(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logFouten.push({ tekst: m.params.entry.text, url: m.params.entry.url ?? '' });
    if (m.method === 'Network.requestWillBeSent' && /\/api\/avondpakket/.test(m.params.request.url)) vragen.push({ t: Date.now(), url: m.params.request.url });
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
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { ws, cdp, ev, op, fouten, logFouten, vragen };
}
async function tot(fn, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(200); }
  return false;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

let ctl, slot;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ctl = await verbind(doelen.find((d) => d.type === 'page'));
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/api/opnames`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  const tegel = () => ctl.ev(`(() => { const t = document.querySelector('.tegel[data-id="avondpakket"]');
    return t ? { licht: t.dataset.licht, waarde: t.querySelector('.tegel-waarde').textContent, sub: t.querySelector('.tegel-sub').textContent,
      regel: t.querySelector('.tegel-regel')?.textContent ?? null, titel: t.title, rol: t.getAttribute('role'), tab: t.tabIndex } : null; })()`);
  const sinds = (t) => ctl.vragen.filter((v) => v.t >= t);
  const klik = () => ctl.ev(`document.querySelector('.tegel[data-id="avondpakket"]').click()`);

  console.log('openen');
  const t0 = Date.now();
  await ctl.cdp('Page.navigate', { url: `http://localhost:${POORT}/controle` });
  ok('de tegel Avondpakket verschijnt, met data-id, als knop', await tot(async () => (await tegel())?.rol === 'button' && (await tegel()).tab === 0));
  ok('na het openen gemeten: "1 rood" (library compleet), rood', await tot(async () => (await tegel())?.waarde === '1 rood'), JSON.stringify(await tegel()));
  const g = await tegel();
  ok(`regel = het rode punt (${g.regel})`, /^Library compleet: nrA\/stems\.wav \(ontbreekt\)/.test(g.regel || ''));
  ok(`sub = "apc · vertrek · HH:MM" (${g.sub})`, /^apc · vertrek · \d\d:\d\d$/.test(g.sub));
  ok('title = alle punten, één regel per punt', g.titel.split('\n').length >= 12 && /Library compleet/.test(g.titel));
  await wacht(8000);
  ok(`bij het openen precies één meting, daarna niet elke 2 s (${sinds(t0).length} in ~10 s)`, sinds(t0).length === 1, sinds(t0).map((v) => v.url).join(' '));
  ok('zonder profiel en fase in de vraag (standaard, auto)', /\/api\/avondpakket$/.test(sinds(t0)[0]?.url || ''));

  console.log('\nde toetsenbordfocus (review 2, fix 10)');
  await ctl.ev(`document.querySelector('.tegel[data-id="avondpakket"]').focus()`);
  const tFocus = Date.now();
  await wacht(2600);
  ok('de tegel houdt de focus na het hertekenen (elke 2 s)', (await ctl.ev(`document.activeElement?.dataset?.id ?? null`)) === 'avondpakket');
  ok('… en focussen alleen meet niets', sinds(tFocus).length === 0);
  await ctl.ev(`document.activeElement.blur()`);

  console.log('\nde keuze en de lijsten');
  await ctl.ev(`document.getElementById('avondpakket').open = true`);
  ok('de keuzelijst kent de vijf profielen, apc gekozen', await tot(() => ctl.ev(`(() => { const s = document.getElementById('ap-profiel');
    return s.options.length === 5 && s.value === 'apc'; })()`)));
  ok('punten, paklijst (met vinkjes) en "Varve kan" staan er', await ctl.ev(`document.querySelectorAll('#ap-punten li').length >= 12
    && document.querySelectorAll('#ap-paklijst input[type=checkbox]').length >= 6 && document.querySelectorAll('#ap-kan li').length >= 1`));
  ok('de paklijst heeft regel 9 (kopie blijft thuis)', await ctl.ev(`[...document.querySelectorAll('#ap-paklijst li')].some((l) => /blijft thuis/.test(l.textContent))`));
  ok('de speellijst staat er als info (review 2, fix 12)', await ctl.ev(`(() => { const i = document.getElementById('ap-info');
    return !i.hidden && /^speellijst: 0 van \\d+ punten gedaan \\(telt niet mee in het oordeel\\)$/.test(i.textContent); })()`), await ctl.ev(`document.getElementById('ap-info').textContent`));
  await ctl.ev(`document.getElementById('ap-pak-0').checked = true`);
  const tKlik = Date.now();
  await klik();
  await wacht(2500);
  ok(`klik op de tegel → precies één vraag, met vers=1 (${sinds(tKlik).map((v) => v.url.split('?')[1]).join(' ')})`, sinds(tKlik).length === 1 && /vers=1/.test(sinds(tKlik)[0].url));
  ok('een vinkje in de paklijst blijft staan na een nieuwe meting', await ctl.ev(`document.getElementById('ap-pak-0').checked`));
  const tKies = Date.now();
  await ctl.ev(`(() => { const s = document.getElementById('ap-profiel'); s.value = 'maschine'; s.dispatchEvent(new Event('change')); })()`);
  ok('ander profiel → één vraag met profiel=maschine, de tegel zegt het', await tot(async () => /^maschine · /.test((await tegel())?.sub)) && sinds(tKies).length === 1
    && /profiel=maschine/.test(sinds(tKies)[0].url));
  ok('… en het profiel staat in localStorage', (await ctl.ev(`localStorage.getItem('varve.avondpakket.profiel')`)) === 'maschine');
  ok('maschine vertrek: AV-hub grijs "straks bij aankomst" in de punten', await ctl.ev(`[...document.querySelectorAll('#ap-punten li')]
    .some((l) => l.dataset.licht === 'uit' && /AV-hub/.test(l.textContent) && /straks bij aankomst/.test(l.textContent))`));
  ok('de paklijst volgt het profiel (Maschine MK2, geen APC)', await ctl.ev(`(() => { const t = document.getElementById('ap-paklijst').textContent;
    return /Maschine MK2/.test(t) && !/APC40/.test(t); })()`));
  const tSnel = Date.now();
  await ctl.ev(`(() => { const s = document.getElementById('ap-profiel'); s.value = 'beeld'; s.dispatchEvent(new Event('change'));
    s.value = 'maschine'; s.dispatchEvent(new Event('change')); })()`);
  await wacht(3000);
  ok(`twee keuzes vlak na elkaar: de laatste wint (maschine), de tweede wacht op de eerste (${sinds(tSnel).map((v) => v.url.split('?')[1]).join(' ')})`,
    /^maschine · /.test((await tegel())?.sub) && sinds(tSnel).length === 2 && /profiel=maschine/.test(sinds(tSnel)[1].url));
  const tFase = Date.now();
  await ctl.ev(`(() => { const s = document.getElementById('ap-fase'); s.value = 'aankomst'; s.dispatchEvent(new Event('change')); })()`);
  ok('fase aankomst → één vraag met fase=aankomst, de tegel zegt "aankomst"', await tot(async () => / · aankomst · /.test((await tegel())?.sub)) && sinds(tFase).length === 1
    && /fase=aankomst/.test(sinds(tFase)[0].url));

  console.log('\nhet automatische moment, elke 5 min (review 2, fix 4)');
  const zicht = (s) => ctl.ev(`(Object.defineProperty(document, 'visibilityState', { value: '${s}', configurable: true }), document.dispatchEvent(new Event('visibilitychange')), true)`);
  await zicht('hidden');
  const tVerb = Date.now();
  await ctl.ev(`controle.apAutomatisch()`);
  await wacht(1500);
  ok(`verborgen pagina: het automatische moment vraagt niets (${sinds(tVerb).length})`, sinds(tVerb).length === 0);
  const tZicht = Date.now();
  await zicht('visible');   // terug in beeld, maar de laatste meting is net: geen extra vraag
  await wacht(800);
  ok(`terug in beeld binnen 5 min na de laatste meting: geen vraag (${sinds(tZicht).length})`, sinds(tZicht).length === 0);
  await ctl.ev(`controle.apAutomatisch()`);
  ok('in beeld: één vraag met auto=1 (de server meet dan niets duurs)', await tot(async () => sinds(tZicht).length === 1) && /auto=1/.test(sinds(tZicht)[0].url)
    && !/vers=1/.test(sinds(tZicht)[0].url), sinds(tZicht).map((v) => v.url.split('?')[1]).join(' '));
  ok('… met de keuze erbij (profiel en fase blijven)', /profiel=maschine/.test(sinds(tZicht)[0]?.url || '') && /fase=aankomst/.test(sinds(tZicht)[0]?.url || ''));
  await wacht(300);   // de volgende stap telt vanaf een eigen tijdstip (anders kan de auto-vraag in dezelfde ms vallen)

  console.log('\nopnieuw laden: het profiel blijft, de fase niet');
  const tHer = Date.now();
  await ctl.cdp('Page.reload');
  ok('na herladen: maschine en fase auto (vertrek)', await tot(async () => /^maschine · vertrek · /.test((await tegel())?.sub)));
  ok('de eerste vraag na herladen heeft profiel=maschine en geen fase', /profiel=maschine$/.test(sinds(tHer)[0]?.url || ''), sinds(tHer)[0]?.url);

  console.log('\neen onthouden profiel dat niet meer bestaat (review 2, fix 6)');
  await ctl.ev(`localStorage.setItem('varve.avondpakket.profiel', 'bestaatniet'), true`);
  const tWeg = Date.now();
  await ctl.cdp('Page.reload');
  ok('de eerste vraag heeft nog profiel=bestaatniet; daarna is het vergeten', await tot(async () => sinds(tWeg).length >= 1
    && (await ctl.ev(`localStorage.getItem('varve.avondpakket.profiel')`)) === null) && /profiel=bestaatniet/.test(sinds(tWeg)[0].url));
  ok('de tegel en de keuzelijst staan op het standaardprofiel', await tot(async () => /^apc · /.test((await tegel())?.sub))
    && (await ctl.ev(`document.getElementById('ap-profiel').value`)) === 'apc');
  const tNa = Date.now();
  await klik();
  ok('de volgende vraag (een klik) heeft geen profiel= meer', await tot(async () => sinds(tNa).length === 1) && !/profiel=/.test(sinds(tNa)[0].url), sinds(tNa)[0]?.url);

  console.log('\nde mixer is open (Web Lock in een tweede tabblad, geen echte mixer)');
  const doel = await fetch(`http://127.0.0.1:${DEBUG}/json/new?${encodeURIComponent(`http://localhost:${POORT}/api/backups`)}`, { method: 'PUT' }).then((r) => r.json());
  slot = await verbind(doel);
  await wacht(500);
  await slot.ev(`(navigator.locks.request('varve-mixer', () => new Promise(() => {})), true)`);
  const tLock = Date.now();
  await ctl.cdp('Page.reload');
  ok('de Controlekamer ziet de mixer open', await tot(() => ctl.ev(`[...document.querySelectorAll('.tegel')].some((t) => /Mixer/.test(t.textContent) && /open/.test(t.querySelector('.tegel-waarde').textContent))`)));
  await wacht(10000);
  ok(`lock vast → geen vraag naar /api/avondpakket bij het openen of daarna (${sinds(tLock).length} in ~12 s)`, sinds(tLock).length === 0);
  ok('… en de tegel zegt waarom: "niet gemeten · mixer open: klik om te meten"', await tot(async () => { const t = await tegel();
    return t?.waarde === 'niet gemeten' && t.sub === 'mixer open: klik om te meten'; }), JSON.stringify(await tegel()));
  const tLockKlik = Date.now();
  await klik();
  await wacht(2500);
  ok(`… maar een klik meet wel: precies één vraag met vers=1 (${sinds(tLockKlik).length})`, sinds(tLockKlik).length === 1 && /vers=1/.test(sinds(tLockKlik)[0].url));
  await ctl.cdp('Page.reload');   // weer "niet gemeten · mixer open"
  ok('opnieuw geladen met de mixer open: weer "niet gemeten"', await tot(async () => (await tegel())?.waarde === 'niet gemeten'));
  const tLos = Date.now();
  await slot.cdp('Page.navigate', { url: 'about:blank' });   // lock los
  ok('lock los terwijl de tegel "niet gemeten" zei: binnen 5 s een meting (review 2, fix 11)', await tot(async () => sinds(tLos).length >= 1, 5000)
    && !/vers=1|auto=1/.test(sinds(tLos)[0].url), sinds(tLos).map((v) => v.url).join(' '));
  ok('… en de tegel toont het rapport', await tot(async () => /rood|klaar/.test((await tegel())?.waarde || '')), (await tegel())?.waarde);
  ok('lock los: de Controlekamer ziet de mixer dicht', await tot(() => ctl.ev(`[...document.querySelectorAll('.tegel')].some((t) => /Mixer/.test(t.textContent) && /niet open/.test(t.querySelector('.tegel-waarde').textContent))`)));

  console.log('\nop een smal scherm (390 px), met het paneel open');
  await ctl.cdp('Page.reload');
  ok('na herladen zonder mixer: weer gemeten', await tot(async () => /rood|klaar/.test((await tegel())?.waarde || '')), (await tegel())?.waarde);
  await ctl.ev(`document.getElementById('avondpakket').open = true`);
  await ctl.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wacht(600);
  ok('390 px: geen zijwaarts scrollen', await ctl.ev('document.documentElement.scrollWidth <= innerWidth'), await ctl.ev('document.documentElement.scrollWidth + "/" + innerWidth'));
  const foto390 = await ctl.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: 1500, scale: 1 } });
  writeFileSync(join(UIT, 'avondpakket-390.png'), Buffer.from(foto390.data, 'base64'));
  await ctl.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wacht(400);
  const foto = await ctl.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: 1100, scale: 1 } });
  writeFileSync(join(UIT, 'avondpakket.png'), Buffer.from(foto.data, 'base64'));

  console.log('\nbevroren (er speelt een deck: een Range-verzoek op audio.wav)');
  await ctl.ev(`fetch('/media/nrA/audio.wav', { headers: { Range: 'bytes=0-99' } }).then((r) => r.status)`);
  await wacht(2200);
  await klik();
  ok('de tegel zegt "bevroren: er speelt een deck · HH:MM"', await tot(async () => /^bevroren: er speelt een deck · \d\d:\d\d$/.test((await tegel())?.sub)), (await tegel())?.sub);

  console.log('\nfouten van de server (Fetch-laag)');
  const vragenFetch = [];
  let antwoord = 'door';
  const geef = (p, code, tekst) => ctl.cdp('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: code,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(tekst).toString('base64') }).catch(() => {});
  ctl.op('Fetch.requestPaused', (p) => {
    vragenFetch.push(Date.now());
    if (antwoord === '500') return geef(p, 500, '{"fout":"stuk"}');
    if (antwoord === '404') return geef(p, 404, '{"fout":"onbekend eindpunt"}');
    return ctl.cdp('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
  });
  await ctl.cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/avondpakket*', requestStage: 'Request' }] });
  const logVoor = ctl.logFouten.length;
  antwoord = '500';
  await klik();
  ok('500 → "onbekend (fout)", grijs', await tot(async () => { const t = await tegel(); return t?.waarde === 'onbekend (fout)' && t.licht === 'uit'; }));
  const t500 = Date.now();
  await klik();
  await wacht(1500);
  ok('daarna rust de route: een klik binnen de minuut vraagt niets', vragenFetch.filter((x) => x >= t500).length === 0);
  antwoord = '404';
  await ctl.cdp('Page.reload');   // nieuwe pagina = geen rust meer
  const t404 = Date.now();
  ok('404 (oudere server) → "onbekend", sub "oudere server", grijs', await tot(async () => { const t = await tegel(); return t?.waarde === 'onbekend' && t.sub === 'oudere server' && t.licht === 'uit'; }));
  await klik();
  await wacht(1500);
  ok(`… en ook dan hooguit één vraag per minuut (${vragenFetch.filter((x) => x >= t404).length})`, vragenFetch.filter((x) => x >= t404).length === 1);
  ok(`netwerkfouten alleen van de nagebootste 500 en 404 (${ctl.logFouten.length - logVoor})`, ctl.logFouten.slice(logVoor).every((f) => /avondpakket/.test(f.url + f.tekst)) && ctl.logFouten.length - logVoor <= 2);
  antwoord = 'door';
  await ctl.cdp('Fetch.disable');

  ok('geen fouten van de pagina zelf in de console (Runtime)', ctl.fouten.length === 0, ctl.fouten.join(' | '));
  ok('geen MIDI gevraagd (requestMIDIAccess bestaat niet in deze pagina)', (await ctl.ev(`typeof navigator.requestMIDIAccess`)) === 'undefined');
} catch (err) {
  ok(`script liep door: ${err.message}`, false);
} finally {
  try { ctl?.ws.close(); slot?.ws.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
if (rood) console.log(`\nserverlog (laatste regels):\n${serverLog.split('\n').slice(-12).join('\n')}`);
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen (${uitkomst.length} ok). Schermafdrukken in ${UIT}/avondpakket.png en avondpakket-390.png`);
process.exit(rood ? 1 : 0);
