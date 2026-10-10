// De tab "kaart" in het library-paneel headless bekijken (src/ui/kaart-panel.js,
// scratchpad CONTRACT-KAART.md deel 3): paneel open, tab kaart, rijen staan er,
// zoeken filtert, de kratkiezer werkt, filters, sorteren op de kolomkop, "haal
// binnen" stuurt de juiste POST, laden van een nummer dat binnen is, knoppen
// uit zodra een deck speelt, "zoek" met het kieslijstje en de zekere keuze, de
// krat op de wenslijst met bevestiging boven 20, en het blok Nachtwachtrij.
//
// Zoals library.mjs: MIDI eruit vóór de pagina laadt, een EIGEN Varve-server op
// een eigen poort met een tijdelijke database. De kaart-API bestaat in deze
// worktree nog niet op de server: de NEP-server (kaart-nep.mjs, in dit proces)
// beantwoordt /api/kaart* en /api/nacht* uit test/fixtures/varve-kaart.klein.json
// en geeft de rest door aan de echte server. Niets van YouTube, niets op 8777.
//
// Gebruik:  node tools/headless/kaart.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (nep, standaard 8816), VARVE_KIJK_ECHT (de echte
//           server, 8815) en VARVE_KIJK_DEBUG (9416).
// Chromium: de headless shell uit de Playwright-cache, of VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8816, ECHT = Number(process.env.VARVE_KIJK_ECHT) || 8815, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9416;
const FIXTURE = join(WORTEL, 'test/fixtures/varve-kaart.klein.json');
const tmp = mkdtempSync(join(tmpdir(), 'varve-kaart-'));
mkdirSync(UIT, { recursive: true });

const { Library } = await import(join(WORTEL, 'server/library.js'));
const { maakWav } = await import(join(WORTEL, 'src/engine/stream-kern.js'));
const { maakKaartNep } = await import(join(WORTEL, 'tools/headless/kaart-nep.mjs'));
const kaart = JSON.parse((await import('node:fs')).readFileSync(FIXTURE, 'utf8'));

// ---- een kleine library: drie nummers van de kaart staan al binnen (id = youtube_id) ----
const media = join(tmp, 'media');
const binnenIds = kaart.nummers.filter((n) => n.youtube_id).slice(0, 3).map((n) => n.youtube_id);
{
  const lib = new Library(join(tmp, 'lib.db'));
  for (const [k, id] of binnenIds.entries()) {
    const n = kaart.nummers.find((x) => x.youtube_id === id);
    const frames = 48000 * 6, L = new Float32Array(frames), hz = 220 + 110 * k;
    for (let i = 0; i < frames; i++) L[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / 48000);
    mkdirSync(join(media, id), { recursive: true });
    writeFileSync(join(media, id, 'audio.wav'), Buffer.from(maakWav([L, L], 48000)));
    lib.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: `${n.artiest} - ${n.titel}`, uploader: n.kanaal || n.artiest, duur: 6,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: '', loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  }
  lib.sluit();
}
const binnenSet = new Set(binnenIds);

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
  env: { ...process.env, PORT: String(ECHT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: media,
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
// De nep: `speelt` kijkt in de browser (de engine) via een vlag die het script zet.
// Het kaart-OBJECT gaat mee (niet het pad): het script zet er verderop een krat bij.
let deckSpeelt = false;
const nep = maakKaartNep({ kaart, doel: ECHT, binnen: (n) => (n.youtube_id && binnenSet.has(n.youtube_id) ? n.youtube_id : null), speelt: () => deckSpeelt });
await nep.start(POORT);
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
async function tot(expr, maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(50); }
  return false;
}
const api = (pad) => fetch(`http://localhost:${POORT}${pad}`).then((r) => r.json());

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

const DEEL = "document.querySelector('#lib-panel .kaart-deel')";
const RIJEN = "document.querySelectorAll('#lib-panel .kaart-rijen .lib-venster .kaart-rij:not(.laadt)').length";
const SLEUTELS = "[...document.querySelectorAll('#lib-panel .kaart-rijen .lib-venster .kaart-rij:not(.laadt)')].map((e) => e.dataset.sleutel)";
const STATUS = "document.querySelector('#lib-panel .kaart-status').textContent";
const typ = (sel, tekst) => evalueer(`(() => { const z = document.querySelector('${sel}'); z.value = ${JSON.stringify(tekst)}; z.dispatchEvent(new Event('input')); })()`);
const klik = (sel) => evalueer(`(() => { const b = document.querySelector('${sel}'); if (!b) throw new Error('geen ${sel}'); b.click(); })()`);
const standVan = (sleutel) => evalueer(`document.querySelector('#lib-panel .kaart-rijen [data-stand="${sleutel}"]')?.innerHTML ?? null`);

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
  ok('de app start (via het nep-doorgeefluik), met de kaart-tab', await tot('window.engine && window.library && window.kaart'));
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  await evalueer("localStorage.removeItem('varve.library.tab'); localStorage.removeItem('varve.kaart.sortering')");

  // ---- openen en de tab -------------------------------------------------------
  console.log('\npaneel open, tab kaart');
  await evalueer("document.getElementById('lib-btn').click()");
  ok('het paneel opent op de library (standaard)', await tot("!document.getElementById('lib-panel').classList.contains('hidden') && window.kaart.tab === 'library'")
    && await evalueer(`${DEEL}.classList.contains('hidden')`));
  const t0 = await evalueer("(window.__t0 = performance.now(), document.querySelector('#lib-panel .lib-tab[data-tab=\"kaart\"]').click(), window.__t0)");
  ok('tab kaart: de rijen staan er', await tot(`${RIJEN} > 5 && ${STATUS}.includes('40 nummers')`), `${(await evalueer('performance.now() - window.__t0')).toFixed(0)} ms na de klik`);
  ok('de library-delen zijn weg, de kaart-delen zichtbaar', await evalueer(`getComputedStyle(document.querySelector('#lib-panel .lib-url')).display === 'none'
    && getComputedStyle(document.querySelector('#lib-panel .lib-rijen:not(.kaart-rijen)')).display === 'none' && ${DEEL}.offsetHeight > 100`));
  ok('tab onthouden in localStorage (varve.library.tab)', await evalueer("localStorage.getItem('varve.library.tab') === 'kaart'"));
  const inDom = await evalueer(RIJEN);
  ok('alleen de zichtbare rijen in de DOM (≤ 30)', inDom > 5 && inDom <= 30, `${inDom} rijen`);
  ok('scrollhoogte = de hele kaart (40 × 28)', await evalueer("document.querySelector('#lib-panel .kaart-rijen .lib-ruimte').offsetHeight === 40 * 28"));
  const eersteApi = (await api('/api/kaart/nummers?sorteer=beurten&richting=af&aantal=3')).nummers.map((n) => n.sleutel);
  ok('standaard: op beurten aflopend, zoals de server', JSON.stringify((await evalueer(SLEUTELS)).slice(0, 3)) === JSON.stringify(eersteApi));
  ok('kolomkop ligt boven de kolommen', await evalueer(`(() => {
    const kop = [...document.querySelectorAll('#lib-panel .kaart-rijen .lib-kop > *')].map((e) => Math.round(e.getBoundingClientRect().left));
    const rij = [...document.querySelector('#lib-panel .kaart-rijen .lib-venster .kaart-rij').children].map((e) => Math.round(e.getBoundingClientRect().left));
    return kop.length === rij.length && kop.every((x, i) => Math.abs(x - rij[i]) <= 1);
  })()`));
  ok('de kratkiezer heeft de drie kratten met aantal en binnen', await evalueer(`(() => { const o = [...document.querySelectorAll('#lib-panel .kaart-krat option')];
    return o.length === 4 && o[0].textContent.includes('hele kaart (40)') && o.some((x) => /vertrouwd \\(8 · \\d binnen\\)/.test(x.textContent)) && o.some((x) => x.textContent.startsWith('Nachtwerk (14')); })()`));
  ok('binnen-rijen hebben laadknoppen, kandidaten "haal binnen", Spotify-only "zoek"', await evalueer(`(() => {
    const d = document.querySelector('#lib-panel .kaart-rijen');
    return d.querySelectorAll('button[data-deck]').length >= 8 && d.querySelectorAll('button[data-haal]').length > 3 && d.querySelectorAll('button[data-zoek]').length >= 1; })()`));
  ok('badges staan er (♥ ≡ ▶ ♫)', await evalueer("['eigen','playlist','gekeken','spotify'].every((k) => document.querySelector('#lib-panel .kaart-badge.' + k))"));
  ok('het blok Nachtwachtrij staat er: uit, 80 per nacht, 01:00–07:00, wenslijst', await tot(`(() => { const n = document.querySelector('#lib-panel .kaart-nacht');
    return n.textContent.includes('NACHTWACHTRIJ') && n.querySelector('[data-nacht="aan"]')?.textContent === 'uit' && n.querySelector('[data-nacht="perNacht"]')?.value === '80'
      && n.querySelector('[data-nacht="van"]')?.value === '01:00' && n.textContent.includes('wenslijst: 0 wacht'); })()`, 8000));
  await foto('kaart-open.png');

  // ---- zoeken --------------------------------------------------------------------
  console.log('\nzoeken');
  await typ('#lib-panel .kaart-zoek', 'nevelkust');
  ok('zoeken filtert: "5 gevonden"', await tot(`${STATUS}.includes('5 gevonden voor "nevelkust"') && ${RIJEN} === 5`, 5000), await evalueer(STATUS));
  ok('alle rijen zijn van die artiest', await evalueer("[...document.querySelectorAll('#lib-panel .kaart-rijen .kaart-artiest')].every((e) => e.textContent === 'Nevelkust')"));
  await typ('#lib-panel .kaart-zoek', 'bestaat nergens');
  ok('niets gevonden: dat staat er', await tot("document.querySelector('#lib-panel .kaart-rijen .lib-leeg')?.textContent.includes('niets gevonden')", 5000));
  await typ('#lib-panel .kaart-zoek', '');
  ok('leeg: weer alles', await tot(`${STATUS}.includes('40 nummers')`, 5000));

  // ---- kratkiezer en filters ---------------------------------------------------------
  console.log('\nkratkiezer, filters');
  const kratId = kaart.kratten.find((k) => k.naam === 'Nachtwerk').id;
  await evalueer(`(() => { const s = document.querySelector('#lib-panel .kaart-krat'); s.value = ${JSON.stringify(kratId)}; s.dispatchEvent(new Event('change')); })()`);
  ok('krat Nachtwerk: 14 rijen, de status noemt de krat', await tot(`${STATUS}.includes('14 nummers in krat "Nachtwerk"') && ${RIJEN} === 14`, 5000), await evalueer(STATUS));
  ok('de krat-knop staat aan', await evalueer("!document.querySelector('#lib-panel .kaart-krat-wens').disabled"));
  await klik('#lib-panel .kaart-filter[data-filter="niet-binnen"]');
  const nietBinnen = (await api(`/api/kaart/nummers?krat=${encodeURIComponent(kratId)}&filter=niet-binnen&aantal=1`)).totaal;
  ok(`filter "niet binnen": ${nietBinnen} rijen, geen laadknoppen`, await tot(`${RIJEN} === ${nietBinnen} && !document.querySelector('#lib-panel .kaart-rijen button[data-deck]')`, 5000));
  await klik('#lib-panel .kaart-filter[data-filter="binnen"]');
  ok('filter "binnen" sluit "niet binnen" uit: alleen rijen met laadknoppen', await tot(`document.querySelector('#lib-panel .kaart-filter[data-filter="binnen"]').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#lib-panel .kaart-filter[data-filter="niet-binnen"]').getAttribute('aria-pressed') === 'false'
    && ${RIJEN} > 0 && [...document.querySelectorAll('#lib-panel .kaart-rijen .kaart-rij:not(.laadt)')].every((r) => r.querySelector('button[data-deck]'))`, 5000));
  await klik('#lib-panel .kaart-filter[data-filter="binnen"]');
  await evalueer(`(() => { const s = document.querySelector('#lib-panel .kaart-krat'); s.value = ''; s.dispatchEvent(new Event('change')); })()`);
  ok('terug naar de hele kaart', await tot(`${STATUS}.includes('40 nummers') && ${RIJEN} > 5`, 5000));

  // ---- sorteren op de kolomkop -----------------------------------------------------------
  console.log('\nsorteren');
  await klik('#lib-panel .kaart-rijen button[data-sorteer="titel"]');
  const titelApi = (await api('/api/kaart/nummers?sorteer=titel&richting=op&aantal=3')).nummers.map((n) => n.sleutel);
  ok('titel: A→Z zoals de server, ▲ in de kop', await tot(`JSON.stringify(${SLEUTELS}.slice(0, 3)) === ${JSON.stringify(JSON.stringify(titelApi))}`, 5000)
    && await evalueer("document.querySelector('#lib-panel .kaart-rijen button[data-sorteer=\"titel\"]').textContent.includes('▲')"));
  await klik('#lib-panel .kaart-rijen button[data-sorteer="laatst"]');
  const laatstApi = (await api('/api/kaart/nummers?sorteer=laatst&richting=af&aantal=3')).nummers.map((n) => n.sleutel);
  ok('laatst: laatste eerst', await tot(`JSON.stringify(${SLEUTELS}.slice(0, 3)) === ${JSON.stringify(JSON.stringify(laatstApi))}`, 5000));
  ok('sortering onthouden (varve.kaart.sortering), los van de library', await evalueer("localStorage.getItem('varve.kaart.sortering') === '{\"sorteer\":\"laatst\",\"richting\":\"af\"}' && !localStorage.getItem('varve.library.sortering')"));
  await klik('#lib-panel .kaart-rijen button[data-sorteer="beurten"]');
  await tot(`JSON.stringify(${SLEUTELS}.slice(0, 3)) === ${JSON.stringify(JSON.stringify(eersteApi))}`, 5000);

  // ---- haal binnen: de juiste POST -------------------------------------------------------
  console.log('\nhaal binnen');
  const kandidaat = (await api('/api/kaart/nummers?filter=niet-binnen&aantal=40')).nummers.find((n) => n.youtube_id && !n.wens);
  nep.verzoeken.length = 0;
  await klik(`#lib-panel .kaart-rijen button[data-haal="${kandidaat.sleutel}"]`);
  ok('POST /api/kaart/wens { sleutels: [die], meteen: true, bevestig: false }', await (async () => {
    for (let i = 0; i < 40; i++) { if (nep.verzoeken.some((v) => v.method === 'POST' && v.pad === '/api/kaart/wens')) break; await wacht(50); }
    const v = nep.verzoeken.find((v) => v.method === 'POST' && v.pad === '/api/kaart/wens');
    return v && JSON.stringify(v.body) === JSON.stringify({ sleutels: [kandidaat.sleutel], meteen: true, bevestig: false });
  })(), JSON.stringify(nep.verzoeken.find((v) => v.pad === '/api/kaart/wens')?.body));
  ok('de rij zegt nu "bezig…" (de rij werd opnieuw opgehaald)', await tot(`document.querySelector('#lib-panel .kaart-rijen [data-stand="${kandidaat.sleutel}"]')?.textContent.includes('bezig')`, 5000), await standVan(kandidaat.sleutel));
  ok('de status meldt het', (await evalueer(STATUS)).includes('1 naar de wachtrij'), await evalueer(STATUS));
  nep.rondAf(kandidaat.sleutel);
  binnenSet.add(kandidaat.youtube_id);
  ok('peiling: klaar → de lijst ververst en de rij is "binnen"', await tot(`document.querySelector('#lib-panel .kaart-rijen [data-stand="${kandidaat.sleutel}"]')?.querySelector('button[data-deck]')`, 9000), await standVan(kandidaat.sleutel));
  ok('wenslijst-telling in het blok: 1 klaar', await tot("document.querySelector('#lib-panel .kaart-nacht').textContent.includes('1 klaar')", 7000));
  await foto('kaart-haal-binnen.png');

  // ---- laden van een nummer dat binnen is -----------------------------------------------------
  console.log('\nladen op een track, en een deck dat speelt');
  await evalueer('window.engine.resume()');
  const binnen = binnenIds[0];
  const binnenSleutel = `yt:${binnen}`;
  await klik(`#lib-panel .kaart-rijen button[data-deck="A"][data-track="${binnen}"]`);
  ok('laden op track 1 via het library-paneel', await tot(`window.engine.deck('A').title && window.engine.deck('A').title.includes(${JSON.stringify(kaart.nummers.find((n) => n.youtube_id === binnen).titel)}) && !window.library.bezig.size`, 10000),
    await evalueer("window.engine.deck('A').title"));
  ok('de status zegt het', (await evalueer(STATUS)).includes('staat op track 1'), await evalueer(STATUS));
  await evalueer("window.engine.deck('A').play()");
  ok('track 1 speelt', await tot("window.engine.deck('A').playing", 3000));
  deckSpeelt = true;
  ok('"haal binnen" en "zoek" staan uit, met de uitleg', await tot(`(() => { const h = [...document.querySelectorAll('#lib-panel .kaart-rijen button[data-haal], #lib-panel .kaart-rijen button[data-zoek]')];
    return h.length > 3 && h.every((b) => b.disabled && b.title.includes('er speelt een deck')); })()`, 4000));
  ok('laden over de spelende track vraagt eerst (tweede klik)', await (async () => {
    await klik(`#lib-panel .kaart-rijen button[data-deck="A"][data-track="${binnenIds[1]}"]`);
    await wacht(300);
    return (await evalueer(STATUS)).includes('klik nog eens') && await evalueer(`window.engine.deck('A').title.includes(${JSON.stringify(kaart.nummers.find((n) => n.youtube_id === binnen).titel)})`);
  })(), await evalueer(STATUS));
  await foto('kaart-deck-speelt.png');
  await evalueer("window.engine.deck('A').pause()");
  deckSpeelt = false;
  ok('deck stil: de knoppen komen terug', await tot("(() => { const h = [...document.querySelectorAll('#lib-panel .kaart-rijen button[data-haal]')]; return h.length > 3 && h.every((b) => !b.disabled); })()", 4000));

  // ---- zoek: kieslijstje, en de zekere keuze ------------------------------------------------------
  console.log('\nzoek (Spotify-only)');
  await klik('#lib-panel .kaart-filter[data-filter="geen-video"]');
  ok('filter "geen video": 10 rijen met "zoek"', await tot(`${RIJEN} === 10 && document.querySelectorAll('#lib-panel .kaart-rijen button[data-zoek]').length === 10`, 5000));
  const spRijen = (await api('/api/kaart/nummers?filter=geen-video&aantal=20')).nummers;
  const twijfel = spRijen.find((n) => n.like !== 'eigen'), zeker = spRijen.find((n) => n.like === 'eigen');
  nep.verzoeken.length = 0;
  await klik(`#lib-panel .kaart-rijen button[data-zoek="${twijfel.sleutel}"]`);
  ok('zoek: POST .../zoek en een kieslijstje met drie kandidaten (titel, kanaal, duur, score)', await tot(`document.querySelectorAll('#lib-panel .kaart-kieslijst .kaart-kandidaat').length === 3`, 5000)
    && nep.verzoeken.some((v) => v.pad === `/api/kaart/nummer/${encodeURIComponent(twijfel.sleutel)}/zoek` || v.pad === `/api/kaart/nummer/${twijfel.sleutel}/zoek`)
    && await evalueer("document.querySelector('#lib-panel .kaart-kieslijst .kaart-kandidaat .kaart-score').textContent === '0,72'"));
  ok('het lijstje hangt onder zijn rij', await evalueer(`(() => { const r = document.querySelector('#lib-panel .kaart-rijen .kaart-rij[data-sleutel="${twijfel.sleutel}"]'), k = document.querySelector('#lib-panel .kaart-kieslijst');
    return !!(r && k) && Math.abs(k.getBoundingClientRect().top - r.getBoundingClientRect().bottom) < 1.5; })()`));
  await foto('kaart-kieslijst.png');
  const kiesId = await evalueer("document.querySelectorAll('#lib-panel .kaart-kieslijst .kaart-kandidaat')[1].dataset.kies");
  await klik(`#lib-panel .kaart-kieslijst .kaart-kandidaat[data-kies="${kiesId}"]`);
  ok('klik = POST .../kies met die youtube_id; de rij zegt "gekozen: …" met "anders"', await tot(`!document.querySelector('#lib-panel .kaart-kieslijst') && document.querySelector('#lib-panel .kaart-rijen [data-stand="${twijfel.sleutel}"]')?.textContent.includes('gekozen:')
    && document.querySelector('#lib-panel .kaart-rijen button[data-anders="${twijfel.sleutel}"]')`, 5000)
    && nep.verzoeken.some((v) => v.pad.endsWith('/kies') && v.body?.youtube_id === kiesId), await standVan(twijfel.sleutel));
  ok('op de server staat de wens te wachten met die id', (await api(`/api/kaart/nummer/${twijfel.sleutel}`)).wens?.youtube_id === kiesId);
  nep.verzoeken.length = 0;
  await klik(`#lib-panel .kaart-rijen button[data-zoek="${zeker.sleutel}"]`);
  ok('score ≥ 0,9: meteen gekozen (POST kies zonder lijstje), "gekozen: …" en de knop "anders"', await tot(`document.querySelector('#lib-panel .kaart-rijen [data-stand="${zeker.sleutel}"]')?.textContent.includes('gekozen: ${zeker.titel}')
    && document.querySelector('#lib-panel .kaart-rijen button[data-anders="${zeker.sleutel}"]') && !document.querySelector('#lib-panel .kaart-kieslijst')`, 5000)
    && nep.verzoeken.some((v) => v.pad.endsWith('/kies')), await standVan(zeker.sleutel));
  await klik(`#lib-panel .kaart-rijen button[data-anders="${zeker.sleutel}"]`);
  ok('"anders" opent het lijstje met de gekozen aan', await tot("document.querySelector('#lib-panel .kaart-kieslijst .kaart-kandidaat.on')", 3000));
  await klik(`#lib-panel .kaart-kieslijst [data-kies-sluit="${zeker.sleutel}"]`);
  ok('× sluit het', await tot("!document.querySelector('#lib-panel .kaart-kieslijst')", 2000));
  await klik('#lib-panel .kaart-filter[data-filter="geen-video"]');
  await tot(`${STATUS}.includes('40 nummers')`, 5000);

  // ---- de krat op de wenslijst: boven 20 eerst bevestigen -----------------------------------------
  console.log('\nde krat op de wenslijst');
  // De hele kaart als "krat" bestaat niet; Nachtwerk heeft 14 (geen bevestiging). Een krat van > 20
  // ontbreekt in de fixture: we maken er een bij in de nep (alle sleutels), zodat de bevestiging te zien is.
  const groot = { id: 'pl:PLnepgroot', naam: 'Alles (groot)', soort: 'playlist', regel: null, bijgewerkt: '2026-10-10', sleutels: kaart.nummers.map((n) => n.sleutel) };
  kaart.kratten.push(groot);
  await klik('#lib-panel .kaart-rijen button[data-sorteer="beurten"]');   // sortering omgekeerd: een verversing, haalt de kratten opnieuw
  ok('na een verversing staat de nieuwe krat in de kiezer', await tot(`[...document.querySelectorAll('#lib-panel .kaart-krat option')].some((o) => o.value === ${JSON.stringify(groot.id)})`, 5000));
  await evalueer(`(() => { const s = document.querySelector('#lib-panel .kaart-krat'); s.value = ${JSON.stringify(groot.id)}; s.dispatchEvent(new Event('change')); })()`);
  ok('en is te kiezen', await tot(`${STATUS}.includes('in krat "Alles (groot)"')`, 5000), await evalueer(STATUS));
  nep.verzoeken.length = 0;
  await klik('#lib-panel .kaart-krat-wens');
  const verwacht = (await api(`/api/kaart/nummers?krat=${groot.id}&filter=niet-binnen&aantal=500`)).totaal;
  ok(`bevestiging: "${verwacht} nummers … ${verwacht} × 50 MB", nog geen POST`, await tot(`document.querySelector('#lib-panel .kaart-bevestig')?.textContent.includes('${verwacht} nummers uit "Alles (groot)"')
    && document.querySelector('#lib-panel .kaart-bevestig').textContent.includes('${verwacht} × 50 MB = ${(verwacht * 50 / 1000).toFixed(1).replace('.', ',')} GB')`, 5000)
    && !nep.verzoeken.some((v) => v.method === 'POST' && v.pad === '/api/kaart/wens'), await evalueer(STATUS));
  await foto('kaart-bevestigen.png');
  await klik('#lib-panel .kaart-bevestig button[data-bevestig="nee"]');
  ok('nee: weg, niets gestuurd', await tot("!document.querySelector('#lib-panel .kaart-bevestig')", 2000) && !nep.verzoeken.some((v) => v.method === 'POST' && v.pad === '/api/kaart/wens'));
  await klik('#lib-panel .kaart-krat-wens');
  await tot("document.querySelector('#lib-panel .kaart-bevestig')", 5000);
  await klik('#lib-panel .kaart-bevestig button[data-bevestig="ja"]');
  ok(`ja: POST met ${verwacht} sleutels en bevestig: true; de status telt`, await (async () => {
    for (let i = 0; i < 60; i++) { if (nep.verzoeken.some((v) => v.method === 'POST' && v.pad === '/api/kaart/wens')) break; await wacht(50); }
    const v = nep.verzoeken.find((v) => v.method === 'POST' && v.pad === '/api/kaart/wens');
    return v && v.body.bevestig === true && v.body.meteen === false && v.body.sleutels.length === verwacht && await tot(`${STATUS}.includes('op de wenslijst')`, 5000);
  })(), await evalueer(STATUS));
  ok('de rijen zeggen "wacht" met ×', await tot("document.querySelectorAll('#lib-panel .kaart-rijen button[data-weg]').length > 5", 5000));
  const wegSleutel = await evalueer("document.querySelector('#lib-panel .kaart-rijen button[data-weg]').dataset.weg");
  await klik(`#lib-panel .kaart-rijen button[data-weg="${wegSleutel}"]`);
  ok('× haalt een wens van de lijst (DELETE), de rij wordt weer een kandidaat', await tot(`document.querySelector('#lib-panel .kaart-rijen [data-stand="${wegSleutel}"]')?.querySelector('button[data-haal], button[data-zoek]')`, 5000)
    && nep.verzoeken.some((v) => v.method === 'DELETE' && v.pad === `/api/kaart/wens/${encodeURIComponent(wegSleutel)}`));
  await foto('kaart-wenslijst.png');

  // ---- het blok Nachtwachtrij ------------------------------------------------------------------
  console.log('\nnachtwachtrij');
  nep.verzoeken.length = 0;
  await klik('#lib-panel .kaart-nacht button[data-nacht="aan"]');
  ok('aan: POST /api/nacht { aan: true }, de knop zegt aan', await tot("document.querySelector('#lib-panel .kaart-nacht button[data-nacht=\"aan\"]')?.textContent === 'aan'", 3000)
    && nep.verzoeken.some((v) => v.pad === '/api/nacht' && v.method === 'POST' && JSON.stringify(v.body) === '{"aan":true}'));
  await evalueer(`(() => { const i = document.querySelector('#lib-panel .kaart-nacht input[data-nacht="perNacht"]'); i.value = '40'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok('per nacht 40: POST { perNacht: 40 }', await (async () => { for (let i = 0; i < 40; i++) { if (nep.verzoeken.some((v) => v.body?.perNacht === 40)) return true; await wacht(50); } return false; })());
  await evalueer(`(() => { const i = document.querySelector('#lib-panel .kaart-nacht input[data-nacht="tot"]'); i.value = '06:30'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok('venster tot 06:30: POST { venster: { van, tot } }', await (async () => { for (let i = 0; i < 40; i++) { if (nep.verzoeken.some((v) => v.body?.venster?.tot === '06:30' && v.body.venster.van === '01:00')) return true; await wacht(50); } return false; })());
  await klik('#lib-panel .kaart-nacht button[data-nacht="vandaagNiet"]');
  ok('vandaag niet: POST { vandaagNiet: true }, de stand zegt "vannacht niet"', await tot("document.querySelector('#lib-panel .kaart-nacht-stand')?.textContent.includes('vannacht niet')", 3000)
    && nep.verzoeken.some((v) => JSON.stringify(v.body) === '{"vandaagNiet":true}'));
  ok('de server heeft het zo', (await api('/api/nacht')).aan === true && (await api('/api/nacht')).perNacht === 40 && (await api('/api/nacht')).venster.tot === '06:30');
  ok('wenslijst-telling klopt met de server', await (async () => {
    const w = (await api('/api/kaart/wensen')).wensen;
    const wacht_ = w.filter((x) => ['wacht', 'zoekt', 'kies'].includes(x.status)).length, klaar = w.filter((x) => x.status === 'klaar').length;
    return tot(`document.querySelector('#lib-panel .kaart-nacht-wensen')?.textContent === 'wenslijst: ${wacht_} wacht · ${klaar} klaar · 0 mislukt'`, 7000);
  })(), await evalueer("document.querySelector('#lib-panel .kaart-nacht-wensen')?.textContent"));
  await foto('kaart-nacht.png');

  // ---- peilen alleen met de tab open ----------------------------------------------------------------
  console.log('\npeilen alleen als de tab open is');
  await klik('#lib-panel .lib-tab[data-tab="library"]');
  ok('terug naar de library: de kaart-delen weg, de library-lijst terug', await tot(`${DEEL}.classList.contains('hidden') && getComputedStyle(document.querySelector('#lib-panel .lib-rijen:not(.kaart-rijen)')).display !== 'none' && window.kaart.tab === 'library'`, 3000));
  const voor = nep.verzoeken.filter((v) => v.pad === '/api/nacht' && v.method === 'GET').length;
  await wacht(5600);
  ok('5,6 s later: geen GET /api/nacht erbij (tab dicht)', nep.verzoeken.filter((v) => v.pad === '/api/nacht' && v.method === 'GET').length === voor);
  await klik('#lib-panel .lib-tab[data-tab="kaart"]');
  await tot(`${RIJEN} > 5`, 5000);
  const voor2 = nep.verzoeken.filter((v) => v.pad === '/api/nacht' && v.method === 'GET').length;
  await wacht(5600);
  ok('tab open: wel een peiling binnen 5,6 s', nep.verzoeken.filter((v) => v.pad === '/api/nacht' && v.method === 'GET').length > voor2);

  // ---- na herladen: de tab staat er nog ------------------------------------------------------------
  console.log('\nherladen');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start opnieuw', await tot('window.engine && window.kaart'));
  await evalueer("document.getElementById('lib-btn').click()");
  ok('het paneel opent meteen op de tab kaart (onthouden)', await tot(`window.kaart.tab === 'kaart' && ${RIJEN} > 5`, 8000));
  ok('en de sortering ook (beurten ▲)', await evalueer("document.querySelector('#lib-panel .kaart-rijen button[data-sorteer=\"beurten\"]').textContent.includes('▲')"));
  await foto('kaart-herladen.png');

  // Chrome logt een mislukte fetch zelf; alleen onze eigen fouten tellen.
  const eigen = meldingen.filter((m) => !/Failed to load resource|net::ERR/.test(m));
  ok('geen fouten in de console', eigen.length === 0, eigen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.stack || err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await nep.stop().catch(() => {});
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
