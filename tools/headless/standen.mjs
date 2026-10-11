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
const { komendeNacht, STANDAARD: NACHT_STANDAARD } = await import(join(WORTEL, 'server/nacht.js'));
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
  // fouten = van onze code (uitzondering, console.error); netwerk = wat Chrome zelf logt over een verzoek
  // met een foutstatus (Log-domein, bron network): dat kan JavaScript niet onderdrukken (CLAUDE.md, beeld).
  const wachtend = new Map(), fouten = [], netwerk = [], luister = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method && luister.has(m.method)) luister.get(m.method)(m.params);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.f(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') (m.params.entry.source === 'network' ? netwerk : fouten).push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  return { ws, cdp, ev, fouten, netwerk, luister, id: doel.id };
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
  ok('mixer openen: gewoon / (niets actief), geen knop "zonder hub"', await ctl.ev(`document.getElementById('mixer-open').dataset.adres === '/' && document.getElementById('mixer-open').textContent === 'mixer openen'
    && document.getElementById('mixer-open-gewoon').hidden && !document.getElementById('mixer-open-gewoon').offsetParent`));
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
  ok(`… half (waarschuwing: lege proefkrat in de nep-kaart; het profiel apc staat in het avondpakket): "${tg?.sub}"`, tg?.licht === 'half' && /^sinds \d\d:\d\d · /.test(tg.sub));
  ok(`… met de regel "${tg?.regel.replaceAll('\u00a0', ' ')}"`, /krat proefkrat \(kies hem in de kaart\)/.test(tg?.regel.replaceAll('\u00a0', ' ')) && /master Dub-worp: mixer volgt nog niet/.test(tg?.regel.replaceAll('\u00a0', ' ')));
  // Sinds de integratie met draagbaar (11 okt) is "avondpakket nog niet samengevoegd" weg; de lege proefkrat blijft.
  ok('de waarschuwingen staan ook als rode melding', (await ctl.ev(`[...document.querySelectorAll('.melding.fout')].map((m) => m.textContent)`)).some((m) => /proefkrat" is leeg/.test(m)));
  const n = await ctl.ev(`fetch('/api/nacht').then((r) => r.json())`);
  // De komende nacht (nacht.js, komendeNacht): 's ochtends na 07:00 is dat de nacht van vandaag op morgen.
  const vandaag = komendeNacht(new Date(), NACHT_STANDAARD.venster);
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
  ok('daarnaast de uitweg "zonder hub" naar / (zichtbaar, niet geklikt) (review punt 8)', await tot(() => ctl.ev(`(() => { const g = document.getElementById('mixer-open-gewoon');
    return !g.hidden && !!g.offsetParent && g.dataset.adres === '/' && g.textContent === 'zonder hub' && !g.disabled; })()`)));
  fotos.push(await foto(ctl, 'standen-5-alles-zonder-hub.png', true));
  ok('de regel zegt "hub-set studio: start hem zelf (npm start -- studio)"', /hub-set studio: start hem zelf \(npm start -- studio\)/.test((await tegel())?.regel.replaceAll('\u00a0', ' ')));
  ok('nog steeds geen tweede tabblad (alleen de Controlekamer)', (await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json())).filter((d) => d.type === 'page').length === 1);

  console.log('\nvorige terugzetten');
  await klik('stand-terug');
  ok('één klik: "zeker? klik nog eens"', (await tekst('stand-terug')) === 'zeker? klik nog eens');
  await klik('stand-terug');
  ok('tweede klik: melding "vorige teruggezet: nacht" ("alles" noemt geen mapping, dus die blijft) (review punt 1)', await tot(async () => (await meldingen()).some((m) => m === 'vorige teruggezet: nacht'), 3000),
    (await meldingen()).slice(-2).join(' | '));
  ok('de tegel: "geen", "vorige teruggezet hh:mm"', await tot(async () => { const t = await tegel(); return t?.waarde === 'geen' && /^vorige teruggezet \d\d:\d\d$/.test(t.sub); }, 3000));
  ok('mixer openen weer gewoon /, "zonder hub" weer weg', await tot(() => ctl.ev(`document.getElementById('mixer-open').dataset.adres === '/' && document.getElementById('mixer-open-gewoon').hidden`)));
  ok('de nacht: vannacht niet blijft (terug = vóór "alles", en toen gold het al door apc)', (await ctl.ev(`fetch('/api/nacht').then((r) => r.json())`)).vandaagNiet === true);

  console.log('\nbewerken zonder JSON');
  const B = `http://localhost:${POORT}`;
  const api = (pad, opties) => fetch(`${B}${pad}`, opties).then((r) => r.json());
  await kies('apc');
  await ctl.ev(`document.getElementById('stand-bewerk').open = true`);
  ok('bewerk open: velden voor apc, met de 8 sjablonen', await tot(() => ctl.ev(`document.querySelectorAll('#bw-velden select[name="master"] option').length === 9
    && document.querySelector('#bw-velden select[name="master"]').value === 'Dub-worp'`)));
  ok('de status zegt: voorbeeld (bewaren maakt een eigen kopie)', /voorbeeld \(bewaren maakt een eigen kopie\)/.test(await tekst('bw-status')));
  await ctl.ev(`(() => { const s = document.querySelector('#bw-velden select[name="master"]'); s.value = 'Oplossen'; })()`);
  await klik('bw-bewaar');
  ok('kies Oplossen, bewaar: GET /api/standen/apc is eigen, master Oplossen, de rest gelijk', await tot(async () => {
    const g = await api('/api/standen/apc');
    return g.bron === 'eigen' && g.stand.delen.master.sjabloon === 'Oplossen' && g.stand.delen.nacht.vannacht === false && g.stand.delen.kaart.krat === 'slim:proefkrat';
  }));
  ok('… melding "apc bewaard" en de status zegt nu "eigen bestand"', await tot(async () => (await meldingen()).includes('apc bewaard') && /eigen bestand/.test(await tekst('bw-status'))));
  await ctl.ev(`document.getElementById('bw-nieuw').value = 'a b'`);
  await klik('bw-bewaar-als');
  ok('"bewaar als" met "a b": een melding, niets bewaard', await tot(async () => (await meldingen()).some((m) => /een naam is kleine letters/.test(m))) && (await api('/api/standen')).standen.length === 4);
  await ctl.ev(`document.getElementById('bw-nieuw').value = 'proef-x'`);
  await klik('bw-bewaar-als');
  ok('"bewaar als" proef-x: 5 opties, proef-x gekozen', await tot(() => ctl.ev(`document.querySelectorAll('#stand-kies option').length === 5 && document.getElementById('stand-kies').value === 'proef-x'`)));
  ok('… met de inhoud van de bewerker (master Oplossen)', (await api('/api/standen/proef-x')).stand?.delen?.master?.sjabloon === 'Oplossen');
  // Een eigen mapping van één regel op de server (zoals de mixer hem bewaart), dan "leg vast".
  await api('/api/mapping', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mapping: { kind: 'diff', version: 3, device: 'apc40mk2', base: 'x', top: {}, rules: [{ in: 'cc:0:41', action: 'track.1.filter', mode: 'absolute' }], removed: [] } }) });
  ok('de bewerker toont proef-x', await tot(async () => /^proef-x · eigen bestand/.test(await tekst('bw-status'))));
  // Review punt 9: een keuze gemaakt maar niet bewaard, dan "leg vast": niet stil weggooien.
  await ctl.ev(`(() => { const s = document.querySelector('#bw-velden select[name="master"]'); s.value = 'Dub-worp'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await klik('bw-leg-vast');
  ok('kies Dub-worp, "leg vast" zonder bewaren: melding "nog niet bewaard", niets vastgelegd', await tot(async () => (await meldingen()).some((m) => /je keuzes zijn nog niet bewaard/.test(m)))
    && await (async () => { const g = await api('/api/standen/proef-x'); return g.stand.delen.master.sjabloon === 'Oplossen' && !g.stand.delen.mapping; })());
  ok('… en de keuze staat nog in de bewerker', await ctl.ev(`document.querySelector('#bw-velden select[name="master"]').value === 'Dub-worp'`));
  await ctl.ev(`document.getElementById('stand-bewerk').open = false`);   // dicht en open = de keuze loslaten
  await wacht(300);
  await ctl.ev(`document.getElementById('stand-bewerk').open = true`);
  ok('bewerk dicht en open: de bewaarde waarde (Oplossen) staat er weer', await tot(() => ctl.ev(`document.querySelector('#bw-velden select[name="master"]')?.value === 'Oplossen' && /^proef-x · eigen bestand/.test(document.getElementById('bw-status').textContent)`)));
  await klik('bw-leg-vast');
  ok('"leg vast": GET /api/standen/proef-x heeft nu een mapping (1 regel)', await tot(async () => (await api('/api/standen/proef-x')).stand?.delen?.mapping?.rules?.length === 1));
  ok('… en de lijst "mapping" biedt "zoals bewaard (eigen, 1 regel)"', await tot(() => ctl.ev(`[...document.querySelectorAll('#bw-velden select[name="mapping"] option')].some((o) => o.textContent === 'zoals bewaard (eigen, 1 regel)' && o.selected)`)));
  fotos.push(await foto(ctl, 'standen-4-bewerker.png', true));
  // Iemand anders (Claude, een tweede tabblad) verandert het bestand: bewaren mag dan niet stil overschrijven.
  const nu = await api('/api/standen/proef-x');
  await api('/api/standen/proef-x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stand: { ...nu.stand, titel: 'Van buiten' }, versie: nu.versie }) });
  await klik('bw-bewaar');
  ok('bewaren na een wijziging van buiten: 409, melding "intussen veranderd", niets overschreven', await tot(async () => (await meldingen()).some((m) => /intussen veranderd/.test(m)))
    && (await api('/api/standen/proef-x')).stand.titel === 'Van buiten');
  // Review punt 7: een naam met hoofdletters wordt kleine letters; Enter in het naamveld = "bewaar als" (niet de oude naam).
  await ctl.ev(`(() => { const n = document.getElementById('bw-nieuw'); n.value = ' Feest2 '; n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  ok('"Feest2" + Enter: bewaard als feest2, gekozen in de kiezer, geen naam met hoofdletters', await tot(async () => (await meldingen()).includes('bewaard als feest2')
    && await ctl.ev(`document.getElementById('stand-kies').value === 'feest2' && [...document.querySelectorAll('#stand-kies option')].every((o) => o.value === o.value.toLowerCase())`)));
  ok('… en proef-x is niet overschreven (titel "Van buiten")', (await api('/api/standen/proef-x')).stand.titel === 'Van buiten' && (await api('/api/standen/feest2')).bron === 'eigen');

  console.log('\nfouten van de server (review 2)');
  // Punt 4b: een kapot eigen bestand. Onder de kiezer de reden van de server, niet alleen "400".
  writeFileSync(join(tmp, 'standen', 'kapot.json'), JSON.stringify({ schema: 2, titel: 'Kapot', delen: {} }));
  ok('een kapot eigen bestand verschijnt in de kiezer met "· fout"', await tot(() => ctl.ev(`[...document.querySelectorAll('#stand-kies option')].some((o) => o.value === 'kapot' && o.textContent.endsWith('· fout'))`), 5000));
  await kies('kapot');
  ok('onder de kiezer de reden van de server, niet alleen "400" (review 2, punt 4b)',
    await tot(async () => (await tekst('stand-uitleg')) === 'Deze opstelling klopt niet: deze VARVE kent schema 1 (dit bestand: 2). Pas standen/kapot.json met de hand aan.', 3000), await tekst('stand-uitleg'));
  // Punt 3: "alles" actief (mixer via de hub), dan geeft GET /api/standen even 503 (iCloud). De knop blijft via de hub.
  await api('/api/standen/alles/activeer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok('alles weer actief: mixer openen via de hub', await tot(() => ctl.ev(`document.getElementById('mixer-open').dataset.adres === '/?hub=ws://localhost:7700/app'`), 5000));
  let onderschept = 0;
  ctl.luister.set('Fetch.requestPaused', (p) => {
    onderschept++;
    ctl.cdp('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 503, responsePhrase: 'Service Unavailable',
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ fout: 'te veel bestanden tegelijk niet lokaal beschikbaar (iCloud?)' })).toString('base64') }).catch(() => {});
  });
  await ctl.cdp('Fetch.enable', { patterns: [{ urlPattern: '*/api/standen', requestStage: 'Response' }] });
  ok('GET /api/standen geeft 503: de tegel zegt "onbekend · fout van de server (503)"', await tot(async () => { const t = await tegel(); return t?.waarde === 'onbekend' && /503/.test(t.sub); }, 6000),
    `${onderschept}× onderschept`);
  const knopNu = await ctl.ev(`(() => { const k = document.getElementById('mixer-open'), g = document.getElementById('mixer-open-gewoon');
    return { adres: k.dataset.adres, onbekend: k.dataset.onbekend, tekst: k.textContent, title: k.title, gewoonZichtbaar: !g.hidden && !!g.offsetParent }; })()`);
  ok('… en "mixer openen" blijft via de hub (de laatst bekende), met dat in de title; "zonder hub" blijft zichtbaar (review 2, punt 3)',
    knopNu.adres === '/?hub=ws://localhost:7700/app' && knopNu.onbekend === '1' && knopNu.tekst === 'mixer openen via de hub' && knopNu.gewoonZichtbaar
      && knopNu.title.startsWith('opstelling nu onbekend (fout van de server); dit is de laatst bekende: via de hub'), knopNu.title);
  ok('… window.controle.mixerAdres() zegt hetzelfde', (await ctl.ev('window.controle.mixerAdres()')) === '/?hub=ws://localhost:7700/app');
  await ctl.cdp('Fetch.disable');
  ctl.luister.delete('Fetch.requestPaused');

  console.log('\nsmal (390 px)');
  await maat(ctl, 390, 844);
  await wacht(400);
  ok('op 390 px geen zijwaarts scrollen', await geenZijwaarts(), `${await ctl.ev('document.documentElement.scrollWidth')} px`);
  ok('de kiezer past in de breedte', await ctl.ev(`document.getElementById('stand-kies').getBoundingClientRect().right <= innerWidth`));
  fotos.push(await foto(ctl, 'standen-3-smal-390.png', true));
  await maat(ctl, 1440, 790);

  ok(`0 consolefouten van onze code${ctl.fouten.length ? `: ${ctl.fouten.slice(0, 3).join(' | ')}` : ''}`, ctl.fouten.length === 0);
  // Bedoeld: de 409 op proef-x (bewaren na een wijziging van buiten), de 400 op kapot/verschil en de nagebootste 503 (review 2).
  const bedoeld = [/409 \(Conflict\) http:\/\/localhost:\d+\/api\/standen\/proef-x\s*$/, /400 \(Bad Request\) http:\/\/localhost:\d+\/api\/standen\/kapot\/verschil\s*$/,
    /status of 503\b.*http:\/\/localhost:\d+\/api\/standen\s*$/];
  ok(`netwerk: alleen de bedoelde 409, 400 en 503 (${ctl.netwerk.length}: ${ctl.netwerk.map((x) => x.replace(/^.*status of /, '')).join(' | ')})`,
    ctl.netwerk.every((x) => bedoeld.some((b) => b.test(x))) && ctl.netwerk.filter((x) => bedoeld[0].test(x)).length === 1 && bedoeld.every((b) => ctl.netwerk.some((x) => b.test(x))));
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
