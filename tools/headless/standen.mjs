// De opstelling in de Controlekamer (docs/STANDEN.md) in headless Chromium:
// de tegel, de kiezer, activeren met twee klikken, vorige terugzetten, en
// "mixer openen" via de hub. GEEN mixer-tabblad (dat komt pas in stap M) en
// niets van Clay: eigen server met een tijdelijke database, de verzonnen kaart
// (test/nep-kaart.mjs), de nep-yt-dlp, een eigen nacht.json, eigen standen-map
// en eigen hub-sets. Chromium gedempt (--mute-audio), MIDI eruit vóór elke pagina.
//
// Gebruik:  node tools/headless/standen.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8822) en VARVE_KIJK_DEBUG (9422).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), '../..');
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8822, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9422;
const tmp = mkdtempSync(join(tmpdir(), 'varve-standen-kijk-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';

const { maakNepYtdlp } = await import(join(WORTEL, 'test/nep-ytdlp.mjs'));
const { schrijfKaart } = await import(join(WORTEL, 'test/nep-kaart.mjs'));
const kaartPad = join(tmp, 'varve-kaart.json');
schrijfKaart(kaartPad);
const hubSets = join(tmp, 'hub-sets');
mkdirSync(hubSets, { recursive: true });
for (const s of ['dj', 'studio']) writeFileSync(join(hubSets, `${s}.json`), '{}');

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
let serverUit = '';
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'media', 'library.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PROEF: join(tmp, 'proef'),
    VARVE_BACKUPS: join(tmp, 'backups'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp), VARVE_KAART: kaartPad,
    VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_NACHT: join(tmp, 'nacht.json'), VARVE_STANDEN: join(tmp, 'standen'), VARVE_HUB_SETS: hubSets },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`, '--mute-audio',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,790', 'about:blank',
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
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') fouten.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  return { ws, cdp, ev, fouten, id: doel.id };
}
async function tot(fn, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(150); }
  return false;
}
const maat = (p, w, h) => p.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
async function foto(p, naam, volledig = false) {
  const opties = { format: 'png' };
  if (volledig) {
    const { cssContentSize: c } = await p.cdp('Page.getLayoutMetrics');
    opties.clip = { x: 0, y: 0, width: c.width, height: Math.min(c.height, 2400), scale: 1 };
    opties.captureBeyondViewport = true;
  }
  const f = await p.cdp('Page.captureScreenshot', opties);
  writeFileSync(join(UIT, naam), Buffer.from(f.data, 'base64'));
  return join(UIT, naam);
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const fotos = [];

let ctl;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ctl = await verbind(doelen.find((d) => d.type === 'page'));
  await maat(ctl, 1440, 790);
  for (let i = 0; i < 80; i++) { if (await fetch(`http://localhost:${POORT}/api/standen`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  /** De tegel "Opstelling": { licht, waarde, sub, regel }. */
  const tegel = () => ctl.ev(`(() => { const t = [...document.querySelectorAll('.tegel')].find((x) => x.querySelector('.tegel-naam').textContent.trim() === 'Opstelling');
    return t ? { licht: t.dataset.licht, waarde: t.querySelector('.tegel-waarde').textContent, sub: t.querySelector('.tegel-sub').textContent,
      regel: t.querySelector('.tegel-regel')?.textContent ?? '' } : null; })()`);
  const kies = (naam) => ctl.ev(`(() => { const k = document.getElementById('stand-kies'); k.value = ${JSON.stringify(naam)}; k.dispatchEvent(new Event('change')); return k.value; })()`);
  const tekst = (id) => ctl.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const klik = (id) => ctl.ev(`document.getElementById(${JSON.stringify(id)}).click()`);
  const meldingen = () => ctl.ev(`[...document.querySelectorAll('.melding')].map((m) => m.textContent)`);
  const geenZijwaarts = () => ctl.ev('document.documentElement.scrollWidth <= innerWidth');

  console.log('de Controlekamer, niets actief');
  await ctl.cdp('Page.navigate', { url: `http://localhost:${POORT}/controle` });
  ok('de Controlekamer start', await tot(() => ctl.ev('!!window.controle && document.querySelectorAll(".tegel").length >= 4')));
  ok('tegel "Opstelling" bestaat en toont "geen", "kies er een onder Openen"',
    await tot(async () => { const t = await tegel(); return t?.waarde === 'geen' && t.sub === 'kies er een onder Openen'; }));
  ok('de tegel staat direct na "Server"', await ctl.ev(`[...document.querySelectorAll('.tegel-naam')].map((x) => x.textContent.trim()).slice(0, 2).join() === 'Server,Opstelling'`));
  ok('het kopje boven de kiezer is het label "Opstelling"', (await tekst('h-opstelling')) === 'Opstelling');
  ok('#stand-kies heeft 4 opties (de voorbeelden)', await tot(() => ctl.ev(`document.querySelectorAll('#stand-kies option').length === 4 && !document.getElementById('stand-kies').disabled`)));
  await kies('apc');
  ok('onder de kiezer: wat activeren verandert', await tot(async () => /^Activeren: .*nacht: uit → uit · vannacht niet.*master: — → Dub-worp \(mixer volgt nog niet\)/.test(await tekst('stand-uitleg'))),
    (await tekst('stand-uitleg')).slice(0, 120));
  ok('mixer openen: gewoon / (niets actief)', await ctl.ev(`document.getElementById('mixer-open').dataset.adres === '/' && document.getElementById('mixer-open').textContent === 'mixer openen'`));
  ok('past op 1440×790 zonder zijwaarts scrollen', await geenZijwaarts());
  fotos.push(await foto(ctl, 'standen-1-geen.png', true));

  console.log('\nactiveren met twee klikken');
  await klik('stand-activeer');
  ok('één klik: "zeker? klik nog eens", nog niets gebeurd', (await tekst('stand-activeer')) === 'zeker? klik nog eens'
    && (await (await fetch(`http://localhost:${POORT}/api/standen/actief`)).json()).naam === null);
  const t0 = Date.now();
  await klik('stand-activeer');
  ok('tweede klik: een melding "apc actief: nacht, …"', await tot(async () => (await meldingen()).some((m) => /^apc actief: nacht/.test(m)), 3000), (await meldingen()).join(' | '));
  ok('binnen 3 s toont de tegel "Avond 1 · APC direct"', await tot(async () => (await tegel())?.waarde === 'Avond 1 · APC direct', 3000), `${Date.now() - t0} ms`);
  const tg = await tegel();
  ok(`… half (waarschuwingen: lege proefkrat in de nep-kaart, avondpakket nog niet samengevoegd): "${tg?.sub}"`, tg?.licht === 'half' && /^sinds \d\d:\d\d · /.test(tg.sub));
  ok(`… met de regel "${tg?.regel.replaceAll('\u00a0', ' ')}"`, /krat proefkrat \(kies hem in de kaart\)/.test(tg?.regel.replaceAll('\u00a0', ' ')) && /master Dub-worp: mixer volgt nog niet/.test(tg?.regel.replaceAll('\u00a0', ' ')));
  ok('de waarschuwingen staan ook als rode melding', (await ctl.ev(`[...document.querySelectorAll('.melding.fout')].map((m) => m.textContent)`)).some((m) => /avondpakket/.test(m)));
  const n = await ctl.ev(`fetch('/api/nacht').then((r) => r.json())`);
  const vandaag = await ctl.ev(`(() => { const d = new Date(); if (d.getHours() < 12) d.setDate(d.getDate() - 1); return d.toLocaleDateString('sv-SE'); })()`);
  ok(`fetch('/api/nacht') op de pagina: vannacht niet (${n.vandaagNiet}), aan blijft ${n.aan}`, n.vandaagNiet === true && n.aan === false);
  ok(`… vandaagNietDatum in nacht.json is de nacht van vandaag (${vandaag})`, await (async () => {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(join(tmp, 'nacht.json'), 'utf8')).instellingen.vandaagNietDatum === vandaag;
  })());
  ok('de kiezer markeert "apc" als actief', await tot(() => ctl.ev(`document.querySelector('#stand-kies option[value="apc"]').textContent.endsWith('· actief')`)));
  fotos.push(await foto(ctl, 'standen-2-apc-actief.png', true));

  console.log('\nalles: mixer openen via de hub (niet klikken)');
  await kies('alles');
  await klik('stand-activeer'); await klik('stand-activeer');
  ok('alles actief', await tot(async () => (await tegel())?.waarde === 'Avond 2 · APC + Maschine via de hub', 3000));
  ok('de knop "mixer openen" heeft de ?hub=-URL', await tot(() => ctl.ev(`document.getElementById('mixer-open').dataset.adres === '/?hub=ws://localhost:7700/app'`)));
  ok('… en zegt "mixer openen via de hub"; window.controle.mixerAdres() zegt hetzelfde',
    (await tekst('mixer-open')) === 'mixer openen via de hub' && (await ctl.ev('window.controle.mixerAdres()')) === '/?hub=ws://localhost:7700/app');
  ok('de regel zegt "hub-set studio: start hem zelf (npm start -- studio)"', /hub-set studio: start hem zelf \(npm start -- studio\)/.test((await tegel())?.regel.replaceAll('\u00a0', ' ')));
  ok('nog steeds geen tweede tabblad (alleen de Controlekamer)', (await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json())).filter((d) => d.type === 'page').length === 1);

  console.log('\nvorige terugzetten');
  await klik('stand-terug');
  ok('één klik: "zeker? klik nog eens"', (await tekst('stand-terug')) === 'zeker? klik nog eens');
  await klik('stand-terug');
  ok('tweede klik: melding "vorige teruggezet: mapping, nacht"', await tot(async () => (await meldingen()).some((m) => m === 'vorige teruggezet: mapping, nacht'), 3000));
  ok('de tegel: "geen", "vorige teruggezet hh:mm"', await tot(async () => { const t = await tegel(); return t?.waarde === 'geen' && /^vorige teruggezet \d\d:\d\d$/.test(t.sub); }, 3000));
  ok('mixer openen weer gewoon /', await tot(() => ctl.ev(`document.getElementById('mixer-open').dataset.adres === '/'`)));
  ok('de nacht: vannacht niet blijft (terug = vóór "alles", en toen gold het al door apc)', (await ctl.ev(`fetch('/api/nacht').then((r) => r.json())`)).vandaagNiet === true);

  console.log('\nsmal (390 px)');
  await maat(ctl, 390, 844);
  await wacht(400);
  ok('op 390 px geen zijwaarts scrollen', await geenZijwaarts(), `${await ctl.ev('document.documentElement.scrollWidth')} px`);
  ok('de kiezer past in de breedte', await ctl.ev(`document.getElementById('stand-kies').getBoundingClientRect().right <= innerWidth`));
  fotos.push(await foto(ctl, 'standen-3-smal-390.png', true));
  await maat(ctl, 1440, 790);

  ok(`0 consolefouten${ctl.fouten.length ? `: ${ctl.fouten.slice(0, 3).join(' | ')}` : ''}`, ctl.fouten.length === 0);
  ok('geen MIDI in de Controlekamer', await ctl.ev('!navigator.requestMIDIAccess'));
} catch (err) {
  ok(`zonder uitzondering: ${err.message}`, false);
} finally {
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
  await Promise.race([new Promise((z) => server.on('exit', z)), wacht(4000)]);
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
}
const fout = uitkomst.filter(([, g]) => !g).length;
console.log(`\nschermafdrukken: ${fotos.join(', ')}`);
if (fout) console.log('\n--- server ---\n' + serverUit.split('\n').slice(-25).join('\n'));
console.log(`\n${uitkomst.length - fout}/${uitkomst.length} ok${fout ? ` — ${fout} FAIL` : ''}`);
process.exit(fout ? 1 : 0);
