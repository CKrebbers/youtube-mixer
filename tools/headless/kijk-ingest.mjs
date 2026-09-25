// De ingest-strook in het library-paneel bekijken, headless, met een
// nep-yt-dlp (test/nep-ytdlp.mjs): geen byte van internet.
//
// Zelfde opzet als kijk.mjs: een EIGEN server op een eigen poort met een
// tijdelijke database en mediamap, en een headless Chromium zonder
// navigator.requestMIDIAccess (veilig met de APC aangesloten).
//
// Gebruik:  node tools/headless/kijk-ingest.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8792) en VARVE_KIJK_DEBUG (9338).
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../server/ingest.js';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8792, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9338;
const tmp = mkdtempSync(join(tmpdir(), 'varve-kijk-ingest-'));
mkdirSync(UIT, { recursive: true });

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

const bron = join(tmp, 'bron.wav');
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
  '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=44100:d=12", '-ac', '2', bron]);
const nepYtdlp = maakNepYtdlp(tmp), nepLog = join(tmp, 'nep.log');
// Een functie: aan het eind wordt de server herstart (zelfde poort, database en media).
const startServer = () => spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit',
    // Een trage download duurt 25 × 1,2 s: headless (swiftshader, drukke machine)
    // is traag, en er moet tijd zijn om hem te annuleren.
    VARVE_YTDLP: nepYtdlp, NEP_LOG: nepLog, NEP_BRON: bron, NEP_TRAAG_MS: '1200' },
  stdio: 'ignore',
});
let server = startServer();
const wezen = [];   // pids van nep-yt-dlp's die bij de herstart hun server kwijtraakten
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
/** Wachten tot een uitdrukking waar is (of maxMs voorbij). */
async function totdat(expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(150); }
  return false;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// In de pagina: rijen van de strook als { klasse, label, titel, sub, pct, knoppen }.
const RIJEN = `[...document.querySelectorAll('#lib-panel .ing-rij')].map((r) => ({
  klasse: r.className, label: r.querySelector('.lib-job-stap')?.textContent.trim(),
  titel: r.querySelector('.lib-job-tekst b')?.textContent, sub: r.querySelector('.ing-sub')?.textContent,
  pct: r.querySelector('.ing-pct')?.textContent, nu: r.querySelectorAll('.ing-stappen i.nu').length,
  gedaan: r.querySelectorAll('.ing-stappen i.gedaan').length, laad: r.querySelectorAll('button[data-laad]').length }))`;
const rij = (deel) => `${RIJEN}.find((x) => (x.titel || '').includes(${JSON.stringify(deel)}))`;
const klikX = (deel) => evalueer(`(() => { const r = [...document.querySelectorAll('#lib-panel .ing-rij')].find((x) => x.querySelector('.lib-job-tekst b')?.textContent.includes(${JSON.stringify(deel)})); r?.querySelector('button.ing-x')?.click(); return !!r; })()`);
const status = () => evalueer("document.querySelector('#lib-panel .lib-status').textContent");
/**
 * Met de MUIS op × van een rij, zoals Clay klikt: indrukken, `ms` vasthouden,
 * loslaten (CDP Input, geen el.click()). De strook tekent intussen opnieuw.
 */
async function muisX(deel, ms) {
  const plek = await evalueer(`(() => { const r = [...document.querySelectorAll('#lib-panel .ing-rij')].find((x) => x.querySelector('.lib-job-tekst b')?.textContent.includes(${JSON.stringify(deel)}));
    const b = r?.querySelector('button.ing-x')?.getBoundingClientRect(); return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
  if (!plek) return false;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: plek.x, y: plek.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: plek.x, y: plek.y, button: 'left', clickCount: 1 });
  await wacht(ms);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plek.x, y: plek.y, button: 'left', clickCount: 1 });
  await wacht(100);
  return true;
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start', await totdat('window.engine && window.videoMixer', 20000));
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  await evalueer("document.getElementById('lib-btn').click()");
  ok('het library-paneel staat open, de strook is leeg en verborgen',
    await evalueer("!document.getElementById('lib-panel').classList.contains('hidden') && document.querySelector('#lib-panel .lib-jobs').classList.contains('hidden')"));
  ok('het invoerveld zegt dat er meer links mogen', /één of meer links/.test(await evalueer("document.querySelector('#lib-panel .lib-url').placeholder")));

  // Plakken van vier regels, zoals uit een notitie of chat.
  console.log('plakken en binnenhalen');
  const regels = ['http://127.0.0.1:9/nummer-a-traag', 'http://127.0.0.1:9/nummer-b',
    'https://www.youtube.com/watch?v=abcdefghijk&list=PL9', 'https://www.youtube.com/playlist?list=PL2'].join('\n');
  await evalueer(`(() => {
    const veld = document.querySelector('#lib-panel .lib-url');
    veld.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(regels)});
    veld.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  const veld = await evalueer("document.querySelector('#lib-panel .lib-url').value");
  ok('vier regels geplakt: vier links met spaties in het veld (niet aan elkaar geplakt)', veld.split(' ').length === 4, veld);
  await evalueer("document.querySelector('#lib-panel .lib-haal').click()");
  ok('de strook toont één bezig en twee wachtend', await totdat(`${RIJEN}.filter((x) => /bezig/.test(x.klasse)).length === 1 && ${RIJEN}.filter((x) => /wacht/.test(x.klasse)).length === 2`, 10000),
    JSON.stringify(await evalueer(`${RIJEN}.map((x) => x.label)`)));
  ok('melding: 3 in de wachtrij, de playlist geweigerd', /3 in de wachtrij.*1 geweigerd/.test(await status()), await status());
  ok('de geweigerde playlist-link blijft in het veld', /playlist\?list=PL2/.test(await evalueer("document.querySelector('#lib-panel .lib-url').value")));
  ok('de wachtende YouTube-link staat er zonder list=', !!(await evalueer(`${RIJEN}.find((x) => x.titel === 'youtube.com/watch?v=abcdefghijk')`)));
  ok('de lopende toont DOWNLOAD met een percentage en een oplichtend streepje',
    await totdat(`(() => { const r = ${rij('nummer-a-traag')}; return r && r.label === 'download' && /^[0-9]+%$/.test(r.pct) && parseInt(r.pct) > 0 && r.nu === 1 && r.gedaan === 1; })()`, 15000),
    JSON.stringify(await evalueer(rij('nummer-a-traag'))));
  ok('er staat een kop: wachtrij · 1 bezig · 2 wachtend', /1 bezig · 2 wachtend/.test(await evalueer("document.querySelector('#lib-panel .ing-kop')?.textContent || ''")));
  await foto('ingest-voortgang.png');

  console.log('annuleren');
  await klikX('watch?v=abcdefghijk');
  ok('× op een wachtende: meteen geannuleerd', await totdat(`/geannuleerd/.test((${rij('watch?v=abcdefghijk')})?.klasse || '')`, 5000));
  // Met de muis en 2,5 s ingedrukt: intussen pollt de strook en loopt het
  // percentage op, dus hij tekent opnieuw. Vroeger verving dat de knop onder
  // de muis en ging de klik verloren (bij een upload met voortgang altijd).
  const html0 = await evalueer("document.querySelector('#lib-panel .lib-jobs').innerHTML");
  await muisX('nummer-a-traag', 2500);
  ok('× op de lopende (echte muis, lang ingedrukt terwijl de voortgang loopt) vraagt eerst een tweede klik',
    /klik nog eens op × om te stoppen/.test(await status()) && /bezig/.test((await evalueer(rij('nummer-a-traag'))).klasse), await status());
  ok('en na het loslaten tekent de strook weer bij', await totdat(`document.querySelector('#lib-panel .lib-jobs').innerHTML !== ${JSON.stringify(html0)}`, 5000));
  await klikX('nummer-a-traag');
  ok('tweede klik: hij stopt en wordt geannuleerd', await totdat(`/geannuleerd/.test((${rij('nummer-a-traag')})?.klasse || '')`, 8000));
  ok('de volgende (b) loopt meteen daarna', await totdat(`/bezig|klaar/.test((${rij('Nep nummer-b')})?.klasse || '')`, 15000));
  await foto('ingest-annuleren.png');

  console.log('klaar, dubbel, direct laden');
  ok('b is klaar, met laadknoppen per track', await totdat(`(() => { const r = ${rij('Nep nummer-b')}; return r && /klaar/.test(r.klasse) && r.laad === 8; })()`, 60000),
    JSON.stringify(await evalueer(rij('Nep nummer-b'))));
  ok('en staat in de lijst eronder', await totdat("[...document.querySelectorAll('#lib-panel .lib-rij .lib-titel')].some((e) => e.textContent.includes('Nep nummer-b'))", 5000));
  ok('"klaar, zonder video" (de nep levert geen beeld)', /zonder video/.test((await evalueer(rij('Nep nummer-b'))).sub));
  await foto('ingest-klaar.png');
  // Dezelfde link nog eens: niet opnieuw, maar "al binnen" met laadknoppen.
  await evalueer("(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'http://127.0.0.1:9/nummer-b'; v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  ok('dezelfde link nog eens: melding "staat al in de library"', await totdat("/staat al in de library/.test(document.querySelector('#lib-panel .lib-status').textContent)", 5000), await status());
  ok('en een rij "al binnen" met laadknoppen', await totdat(`${RIJEN}.some((x) => x.label === 'al binnen' && x.laad === 8)`, 5000));
  await foto('ingest-dubbel.png');
  await evalueer("[...document.querySelectorAll('#lib-panel .ing-rij.bestond button[data-laad]')][0].click()");
  ok('klik op laadknop 1 in de strook: het nummer staat op track 1', await totdat("window.engine.deck('A').duration > 11 && /staat op track 1/.test(document.querySelector('#lib-panel .lib-status').textContent)", 15000), await status());

  console.log('een playlist die alleen yt-dlp herkent');
  await evalueer("(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'http://127.0.0.1:9/een-lijst'; v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  ok('mislukt, met de reden in de strook, en hij blijft staan', await totdat(`${RIJEN}.some((x) => /mislukt/.test(x.klasse) && /playlist \\(3 nummers\\)/.test(x.sub))`, 15000));
  await foto('ingest-mislukt.png');
  await evalueer("document.querySelector('#lib-panel .ing-rij.mislukt button.ing-x').click()");
  ok('× klikt hem weg', await totdat(`!${RIJEN}.some((x) => /mislukt/.test(x.klasse))`, 5000));

  // De rij staat in het geheugen van de server: na een herstart is hij leeg.
  // De strook mag dat niet stil laten gebeuren. Het paneel is dicht, zoals
  // tijdens een set: dan ook onderaan melden.
  console.log('server herstart');
  await evalueer("(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'http://127.0.0.1:9/herstart-a-traag http://127.0.0.1:9/herstart-b-traag'; v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  ok('twee trage links in de rij: één bezig, één wacht', await totdat(`${RIJEN}.some((x) => /bezig/.test(x.klasse) && /herstart-a/.test(x.titel)) && ${RIJEN}.some((x) => /wacht/.test(x.klasse) && /herstart-b/.test(x.titel))`, 15000),
    JSON.stringify(await evalueer(RIJEN)));
  await evalueer("document.getElementById('lib-btn').click()");
  ok('het paneel is dicht', await evalueer("document.getElementById('lib-panel').classList.contains('hidden')"));
  const pidA = await (async () => {
    for (let i = 0; i < 50; i++) {
      const r = existsSync(nepLog) && readFileSync(nepLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((x) => x.wat === 'download' && /herstart-a/.test(x.url));
      if (r) return r.pid;
      await wacht(100);
    }
    return null;
  })();
  if (pidA) wezen.push(pidA);
  const weg1 = new Promise((z) => server.once('exit', z));
  server.kill();
  await weg1;
  await wacht(1500);   // de strook pollt intussen tegen een server die er niet is
  server = startServer();
  ok('onderaan: "de server is herstart: 2 opdrachten … weg", tot je hem wegklikt',
    await totdat("[...document.querySelectorAll('#meldingen .melding.fout')].some((m) => /server is herstart: 2 opdrachten uit de wachtrij zijn weg.*opnieuw/.test(m.textContent))", 20000),
    await evalueer("[...document.querySelectorAll('#meldingen .melding')].map((m) => m.textContent).join(' | ')"));
  await evalueer("document.getElementById('lib-btn').click()");
  const HERSTART = "document.querySelector('#lib-panel .ing-rij.herstart')";
  ok('paneel open: bovenaan de strook een rij "herstart" met "opnieuw" en ×',
    await totdat(`${HERSTART} && ${HERSTART}.querySelector('[data-herstart=opnieuw]') && ${HERSTART}.querySelector('[data-herstart=laat]')`, 5000));
  ok('de rij zegt hoeveel er weg is', /2 opdrachten uit de wachtrij zijn weg/.test(await evalueer(`${HERSTART}.textContent`)));
  ok('en de oude opdrachten staan er niet meer als bezig of wachtend', !(await evalueer(`${RIJEN}.some((x) => /bezig|wacht/.test(x.klasse))`)));
  await foto('ingest-herstart.png');
  // "opnieuw" met de muis, zoals Clay klikt.
  const plekO = await evalueer(`(() => { const b = ${HERSTART}.querySelector('[data-herstart=opnieuw]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: plekO.x, y: plekO.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: plekO.x, y: plekO.y, button: 'left', clickCount: 1 });
  await wacht(120);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plekO.x, y: plekO.y, button: 'left', clickCount: 1 });
  ok('klik op "opnieuw": beide links terug in de rij, in dezelfde volgorde',
    await totdat(`!${HERSTART} && ${RIJEN}.some((x) => /bezig/.test(x.klasse) && /herstart-a/.test(x.titel)) && ${RIJEN}.some((x) => /wacht/.test(x.klasse) && /herstart-b/.test(x.titel))`, 15000),
    JSON.stringify(await evalueer(RIJEN)));
  ok('melding: 2 in de wachtrij', /2 in de wachtrij/.test(await status()), await status());
  ok('en de melding onderaan is weg (je koos al)', await totdat("![...document.querySelectorAll('#meldingen .melding')].some((m) => /server is herstart/.test(m.textContent))", 3000));
  await foto('ingest-herstart-terug.png');
  // Netjes stoppen, zodat er bij het afsluiten niets loopt.
  await klikX('herstart-b');
  await klikX('herstart-a');
  await klikX('herstart-a');
  ok('en weer te annuleren', await totdat(`${RIJEN}.filter((x) => /geannuleerd/.test(x.klasse) && /herstart/.test(x.titel)).length === 2`, 10000),
    JSON.stringify(await evalueer(RIJEN)));
  ok('geen fouten in de pagina', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  for (const pid of wezen) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
