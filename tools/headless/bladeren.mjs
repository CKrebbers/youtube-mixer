// Bladeren in de library met de Maschine (docs/MASCHINE.md §5e), in headless Chromium:
// twee testnummers door de ingest, dan in de mixer een nagebootste Maschine-verbinding
// (dezelfde Maschine-klasse als met ?hub=, alleen de poort is nep): BROWSE opent de
// library, het wiel kiest (het paneel licht de rij op), ENTER laadt op de focus-track,
// over een spelende track pas bij een tweede druk, BROWSE sluit en dan kiest het wiel
// weer instrumenten. Een klik op een rij zet de keuze daar; een nummer dat binnenkomt
// (bovenaan) laat de keuze op hetzelfde nummer. De schermen gaan mee.
// Eigen server, tijdelijke database, MIDI eruit (veilig met de APC aangesloten).
//
// Gebruik:  node tools/headless/bladeren.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8842) en VARVE_KIJK_DEBUG (9442).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), '../..');
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8842, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9442;
const tmp = mkdtempSync(join(tmpdir(), 'varve-bladeren-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';
const B = `http://localhost:${POORT}`;

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
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

/** Een tabblad via het DevTools-protocol: cdp(), ev(), en de fouten in de console. */
async function verbind(doel) {
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let volg = 0;
  const wachtend = new Map(), fouten = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.f(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
  const ev = async (expr, gebaar = false) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gebaar });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { ws, cdp, ev, fouten };
}
async function tot(fn, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(150); }
  return false;
}

/** Een korte WAV (klikken op `hz`) door de ingest; geeft het library-id. */
async function testnummer(naam, hz) {
  const SR = 48000, N = SR * 8, wav = Buffer.alloc(44 + N * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 4, 40);
  for (let t = 0; t < 8; t += 0.5) for (let i = 0; i < 400; i++) {
    const v = Math.round(16000 * Math.exp(-i / 60) * Math.sin(2 * Math.PI * hz * i / SR)), o = 44 + (Math.round(t * SR) + i) * 4;
    wav.writeInt16LE(v, o); wav.writeInt16LE(v, o + 2);
  }
  const up = await fetch(`${B}/api/upload?naam=${encodeURIComponent(naam)}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav }).then((r) => r.json());
  for (let i = 0; i < 200; i++) {
    await wacht(200);
    const o = (await fetch(`${B}/api/ingest`).then((r) => r.json())).opdrachten.find((x) => x.id === up.id);
    if (o?.status === 'klaar') return o.track.id;
    if (o?.status === 'mislukt') return null;
  }
  return null;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

let mixer;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  for (let i = 0; i < 50; i++) { if (await fetch(`${B}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  console.log('twee testnummers door de ingest');
  const een = await testnummer('Alfa testnummer.wav', 800);
  const twee = await testnummer('Bravo testnummer.wav', 500);
  ok('twee nummers in de library', !!een && !!twee, `${een} ${twee}`);

  console.log('\nde mixer, met een nagebootste Maschine');
  mixer = await verbind(doelen.find((d) => d.type === 'page'));
  await mixer.cdp('Page.navigate', { url: `${B}/` });
  ok('de mixer laadt', await tot(() => mixer.ev('!!window.engine && !!window.library'), 20000));
  await mixer.ev(`(async () => {
    const { Maschine } = await import('/src/control/maschine.js');
    const { read, invoke } = await import('/src/control/actions.js');
    const { beschrijf } = await import('/src/ui/apc-beschrijf.js');
    const { parseMessage } = await import('/src/control/midi.js');
    const m = new Maschine({ engine: window.engine, noten: window.noten, read, invoke, beschrijf, library: window.library });
    m.laadMapping(await (await fetch('mappings/maschine-mk2.json')).json());
    window.verstuurd = { schermen: [] };
    m.koppel({ in: { state: 'connected', onmidimessage: null, onstatechange: null }, uit: { state: 'connected', send() {} },
      scherm(nr, data) { window.verstuurd.schermen[nr] = data; } });
    setInterval(() => m.tik(), 33);
    window.maschine = m;
    window.druk = (st, nr, w) => m.ontvang(parseMessage([st, nr, w]));
  })()`);
  const knop = (n) => `druk(0x91, ${n}, 127); druk(0x81, ${n}, 0)`;   // BROWSE 10, ENTER 21
  const wiel = (n) => `druk(0xb0, 24, ${n < 0 ? 128 + n : n})`;
  const paneelOpen = () => mixer.ev("!document.getElementById('lib-panel').classList.contains('hidden')");
  const gekozen = () => mixer.ev("[window.library.gekozen, document.querySelector('#lib-panel .lib-rij.gekozen')?.dataset.i ?? null]");
  const titel = (i) => mixer.ev(`window.library.cache.rij(${i})?.titel ?? null`);

  ok('de library is dicht, het BROWSE-lampje zacht', !(await paneelOpen()) && await tot(() => mixer.ev('window.maschine.leds.get("1:10") === 16')));
  await mixer.ev(knop(10));
  ok('BROWSE: het library-paneel gaat open', await tot(paneelOpen));
  ok('…en de lijst is binnen (2 nummers), de eerste gekozen en opgelicht', await tot(async () => JSON.stringify(await gekozen()) === '[0,"0"]'
    && (await mixer.ev('window.library.cache.totaal')) === 2), JSON.stringify(await gekozen()));
  ok('de Maschine staat in bladeren: BROWSE fel, scherm met de lijst', await tot(() => mixer.ev(
    'window.maschine.leds.get("1:10") === 127 && window.maschine.stand().bladeren?.totaal === 2 && !!window.verstuurd.schermen[0]')));
  await mixer.ev(wiel(1));
  ok('het wiel één tik: de tweede rij gekozen, in het paneel ook', await tot(async () => JSON.stringify(await gekozen()) === '[1,"1"]'), JSON.stringify(await gekozen()));
  { const { data } = await mixer.cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(UIT, 'bladeren-open.png'), Buffer.from(data, 'base64')); }
  await mixer.ev(wiel(5));
  ok('verder dan het eind: blijft op de laatste', await tot(async () => (await gekozen())[0] === 1));
  const tweeTitel = await titel(1);
  ok('focus op track 1, ENTER: het gekozen nummer laadt daar', (await mixer.ev("window.engine.focus")) === 'A'
    && (await mixer.ev(knop(21)), await tot(async () => (await mixer.ev("window.engine.deck('A').title")) === tweeTitel, 15000)), `${tweeTitel}`);

  // Over een spelende track: pas bij een tweede druk.
  await mixer.ev("window.engine.resume?.(); window.engine.deck('A').play?.(), true");
  ok('track 1 speelt', await tot(() => mixer.ev("window.engine.deck('A').playing")));
  await mixer.ev(wiel(-1));
  const eenTitel = await titel(0);
  await mixer.ev(knop(21));
  await wacht(600);
  ok('ENTER over een spelende track: nog niet, de melding staat op de Maschine', (await mixer.ev("window.engine.deck('A').title")) === tweeTitel
    && /nog eens/.test(await mixer.ev('window.maschine.stand().bladeren?.melding ?? ""')), await mixer.ev('window.maschine.stand().bladeren?.melding ?? ""'));
  await mixer.ev(knop(21));
  ok('…nog eens binnen 3 s: dan wel', await tot(async () => (await mixer.ev("window.engine.deck('A').title")) === eenTitel, 15000));

  // Muis en controller wijzen hetzelfde aan.
  await mixer.ev("document.querySelector('#lib-panel .lib-rij[data-i=\"1\"] .lib-titel').click(), true");
  ok('een klik op een rij zet de keuze daar', await tot(async () => (await gekozen())[0] === 1));
  // Een nieuw nummer komt bovenaan (sortering: toegevoegd): de keuze blijft op hetzelfde NUMMER, een rij lager.
  const keuzeTitel = await titel(1);
  const drie = await testnummer('Charlie testnummer.wav', 300);
  ok('een derde nummer komt binnen (bovenaan): de keuze blijft op hetzelfde nummer, nu rij 3', !!drie
    && await tot(async () => (await mixer.ev('window.library.cache.totaal')) === 3 && JSON.stringify(await gekozen()) === '[2,"2"]' && (await titel(2)) === keuzeTitel, 20000),
    `${JSON.stringify(await gekozen())} ${await titel(2)} / ${keuzeTitel}`);

  // Dicht: het wiel kiest weer een instrument.
  await mixer.ev(knop(10));
  ok('BROWSE nog eens: het paneel gaat dicht, lampje weer zacht', await tot(async () => !(await paneelOpen()) && await mixer.ev('window.maschine.leds.get("1:10") === 16')));
  await mixer.ev(wiel(1));
  ok('library dicht: het wiel kiest weer een instrument (de keuze in de library blijft staan)',
    await tot(() => mixer.ev('window.maschine._kandidaat() !== null')) && (await gekozen())[0] === 2);
  ok('geen fouten in de console', mixer.fouten.length === 0, mixer.fouten.join(' | '));
  const { data } = await mixer.cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, 'bladeren.png'), Buffer.from(data, 'base64'));
} catch (err) {
  ok(`script liep door: ${err.message}`, false);
} finally {
  try { mixer?.ws.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Schermafdrukken in ${UIT}/bladeren{,-open}.png`);
process.exit(rood ? 1 : 0);
