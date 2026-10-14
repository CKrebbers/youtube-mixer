// De indeling van de library (spoor S11, docs/LIBRARY-TAGS.md) in echte Chrome, zoals Clay hem
// gebruikt: zoeken, meer nummers kiezen (klik, shift-klik), TAGGEN in het tagveld, een CATEGORIE maken
// (+ en een naam), nummers erheen SLEPEN, FILTEREN met de zoekregel, een gefilterd nummer LADEN op
// een track, de volgorde in de categorie omslepen, een snel-tag met alt+1, een slimme categorie, en
// track.1.tag.1 over de bus (wat de iPad doet). Op een library van 5000 nummers: de lijst blijft
// virtueel en een gefilterde pagina is een paar ms. Handelingen worden geteld.
//
// Zoals library.mjs: MIDI eruit vóór de pagina laadt, een EIGEN server op een eigen poort met een
// tijdelijke database en ALLE data-mappen in een tijdelijke map (VARVE_TESTSERVER=1).
//
// Gebruik:  node tools/headless/indeling.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (standaard 8831) en VARVE_KIJK_DEBUG (standaard 9431).
// Chromium: de headless shell uit de Playwright-cache, of VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8831, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9431;
const N = Number(process.env.VARVE_KIJK_AANTAL) || 5000;
const tmp = mkdtempSync(join(tmpdir(), 'varve-indeling-'));
mkdirSync(UIT, { recursive: true });

const { Library } = await import(join(WORTEL, 'server/library.js'));
const { maakWav } = await import(join(WORTEL, 'src/engine/stream-kern.js'));

// ---- een grote library, zonder audio (behalve drie echte nummers) --------------------------
const media = join(tmp, 'media');
{
  const lib = new Library(join(tmp, 'lib.db'));
  lib.db.exec('BEGIN');
  for (let i = 0; i < N; i++) {
    const id = `n${String(i).padStart(5, '0')}`;
    lib.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: `Nummer ${i}`, uploader: `artiest ${i % 37}`, duur: 200 + (i % 300),
      audio: `media/${id}/audio.wav`, video: null, thumbnail: '', loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    if (i % 3) lib.bewaarGrid(id, { stukken: [{ van: 0, bpm: 70 + (i % 100), anker: 0, zekerheid: 0.9 }], bron: 'auto' });
  }
  lib.db.exec('COMMIT');
  // Een groot deel getagd (zoals na een tijdje gebruiken): 1 op 4 #deep, 1 op 7 #nacht.
  const ids = lib.alleIds();
  lib.indeling.zetTags(ids.filter((_, i) => i % 4 === 0).slice(0, 5000), ['deep'], true);
  lib.indeling.zetTags(ids.filter((_, i) => i % 7 === 0).slice(0, 5000), ['nacht'], true);
  // Drie nummers met echte audio (16-bit stereo 48 kHz, zoals de ingest levert).
  for (const [id, hz, bpm] of [['echt1', 220, 80], ['echt2', 330, 124], ['echt3', 440, 85]]) {
    const n = 48000 * 8;
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / 48000);
    mkdirSync(join(media, id), { recursive: true });
    writeFileSync(join(media, id, 'audio.wav'), Buffer.from(maakWav([L, L], 48000)));
    lib.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: `echt ${id}`, uploader: 'test', duur: 8,
      audio: `media/${id}/audio.wav`, video: null, thumbnail: '', loudness: {}, doelLoudness: -14, ytdlp: 'x' });
    lib.bewaarGrid(id, { stukken: [{ van: 0, bpm, anker: 0, zekerheid: 0.9 }], bron: 'auto' });
  }
  lib.sluit();
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
// Draait er al iets op deze poort (een verweesde proefserver van een vorige run), dan zou de proef
// tegen OUDE data en code lopen: liever meteen stoppen.
if (await fetch(`http://localhost:${POORT}/`).then(() => true, () => false)) {
  console.error(`poort ${POORT} is bezet (een oude proefserver?): stop die eerst, of zet VARVE_KIJK_POORT`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media,
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_SETS: join(tmp, 'sets'),
    VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_PROEF: join(tmp, 'proef'), VARVE_BACKUPS: join(tmp, 'backups'), VARVE_STANDEN: join(tmp, 'standen'),
    VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'), VARVE_NACHT: join(tmp, 'nacht.json'), VARVE_KAART: join(tmp, 'geen-kaart.json'),
    VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_HERANALYSE: 'uit', VARVE_STEMS_PY: join(tmp, 'geen-python') },
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
async function tot(expr, maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(50); }
  return false;
}
const B = `http://localhost:${POORT}`;
const api = (pad) => fetch(`${B}${pad}`).then((r) => r.json());
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// Handelingen tellen: elke klik, elke toets en elk getypt veld (met Enter) is er één.
let handelingen = 0;
const klik = async (sel, { mod = 0 } = {}) => {
  handelingen++;
  // Een echte muisklik (CDP Input): de modifiers (8 = shift, 4 = cmd, 1 = alt) gaan mee zoals in Chrome.
  const r = await evalueer(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error(`niet gevonden: ${sel}`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, modifiers: mod });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1, modifiers: mod });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1, modifiers: mod });
};
const typ = async (sel, tekst, { enter = true } = {}) => {
  handelingen++;
  await evalueer(`document.querySelector(${JSON.stringify(sel)}).focus()`);
  await cdp('Input.insertText', { text: tekst });
  if (enter) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }
};
const zetZoek = async (tekst) => {
  handelingen++;
  await evalueer(`(() => { const z = document.querySelector('#lib-panel .lib-zoek'); z.focus(); z.value = ${JSON.stringify(tekst)}; z.dispatchEvent(new Event('input')); })()`);
};
/** Slepen met echte DragEvents en een DataTransfer (HTML5): van een rij naar een doel. */
const sleep = async (van, naar) => {
  handelingen++;
  return evalueer(`(() => {
    const a = document.querySelector(${JSON.stringify(van)}), b = document.querySelector(${JSON.stringify(naar)});
    if (!a || !b) return false;
    const dt = new DataTransfer();
    a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    b.dispatchEvent(over);
    b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return over.defaultPrevented;
  })()`);
};
const STATUS = "document.querySelector('#lib-panel .lib-status').textContent";
const IDS = "[...document.querySelectorAll('#lib-panel .lib-venster .lib-rij[data-id]')].map((e) => e.dataset.id)";

try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
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
  for (let i = 0; i < 50; i++) { if (await fetch(`${B}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `${B}/?vormen=0` });
  ok('de app start, de aanhaker indeling ook', await tot("window.engine && window.library && window.varveIndeling", 20000));
  await evalueer("localStorage.removeItem('varve.library.sortering'); localStorage.removeItem('varve.library.indeling')");
  await evalueer('window.engine.resume()');
  await evalueer(`(async () => { window.__act = await import('/src/control/actions.js'); })()`);

  // ---- openen: de kolom INDELING met de tags die er al zijn --------------------------------
  console.log(`\n${N + 3} nummers, 1 op 4 #deep, 1 op 7 #nacht`);
  await klik('#lib-btn');
  ok('paneel open, de tags in de kolom met hun aantal', await tot(`${STATUS}.includes('${N + 3}') && document.querySelectorAll('#lib-panel .ik-tags [data-tagfilter]').length === 2`));
  ok('de lijst past op 1440 (geen horizontale schuifbalk met de kolom open)', await evalueer("(() => { const r = document.querySelector('#lib-panel .lib-rijen'); return r.scrollWidth <= r.clientWidth + 1; })()"),
    await evalueer("(() => { const r = document.querySelector('#lib-panel .lib-rijen'); return `${r.scrollWidth} / ${r.clientWidth}`; })()"));
  ok('alleen de zichtbare rijen in de DOM', await evalueer("document.querySelectorAll('#lib-panel .lib-venster .lib-rij').length") <= 30);
  await foto('indeling-open.png');

  // ---- taggen: zoeken, twee kiezen (klik, shift-klik), tag typen, Enter ----------------------
  console.log('\ntaggen');
  const h0 = handelingen;
  await zetZoek('echt');
  ok('zoeken: de drie echte nummers', await tot(`${IDS}.length === 3`, 5000));
  await klik('#lib-panel .lib-rij[data-id="echt1"] .lib-duur');
  await klik('#lib-panel .lib-rij[data-id="echt3"] .lib-duur', { mod: 8 });
  ok('shift-klik: een reeks van drie gekozen', await tot("document.querySelector('#lib-panel .ik-sel').textContent.includes('3 gekozen')", 3000), await evalueer("document.querySelector('#lib-panel .ik-sel').textContent"));
  await klik('#lib-panel .lib-rij[data-id="echt2"] .lib-duur', { mod: 4 });
  ok('cmd-klik: echt2 eraf (twee gekozen)', await tot("document.querySelector('#lib-panel .ik-sel').textContent.includes('2 gekozen')", 3000));
  await typ('#lib-panel .ik-tagveld', 'Dub');
  ok('tagveld + Enter: #Dub op echt1 en echt3 (server)', await tot("document.querySelectorAll('#lib-panel .lib-rij[data-id=\"echt1\"] .ik-chip, #lib-panel .lib-rij[data-id=\"echt3\"] .ik-chip').length === 2", 5000)
    && (await api('/api/library?tag=dub&aantal=10')).totaal === 2);
  ok('taggen van twee nummers: 5 handelingen (zoeken, klik, shift-klik, cmd-klik, typen + Enter)', handelingen - h0 === 5, `${handelingen - h0}`);
  await foto('indeling-getagd.png');

  // ---- een categorie maken en er nummers heen slepen ---------------------------------------
  console.log('\ncategorie');
  const h1 = handelingen;
  await klik('#lib-panel .lib-indeling button[data-nieuw="gewoon"]');
  ok('+ geeft een naamveld', await tot("!!document.querySelector('#lib-panel .ik-nieuwnaam')", 2000));
  await typ('#lib-panel .ik-nieuwnaam', 'Warm op');
  ok('categorie gemaakt (server)', await tot("!!document.querySelector('#lib-panel .ik-cat[data-soort=\"gewoon\"]')", 5000)
    && (await api('/api/indeling/stand')).categorieen.some((c) => c.naam === 'Warm op'));
  const cid = (await api('/api/indeling/stand')).categorieen.find((c) => c.naam === 'Warm op').id;
  ok('een categorie maken: 2 handelingen', handelingen - h1 === 2);
  // De selectie (echt1, echt3) slepen: een gekozen rij neemt de hele selectie mee.
  ok('slepen naar de categorie: de kolom neemt hem aan', await sleep('#lib-panel .lib-rij[data-id="echt3"]', `#lib-panel .ik-cat[data-cat="${cid}"]`));
  ok('…en de twee gekozen nummers staan erin, in de volgorde van de lijst', await tot(`document.querySelector('#lib-panel .ik-cat[data-cat="${cid}"] b')?.textContent === '2'`, 5000)
    && JSON.stringify((await api(`/api/library?cat=${cid}&sorteer=plek&aantal=10`)).tracks.map((t) => t.id)) === JSON.stringify(['echt3', 'echt1']));
  await klik('#lib-panel .lib-rij[data-id="echt2"] .lib-duur');
  await klik('#lib-panel .ik-incat');
  handelingen--; // een keuzelijst openen en kiezen telt als één
  await evalueer(`(() => { const s = document.querySelector('#lib-panel .ik-incat'); s.value = '${cid}'; s.dispatchEvent(new Event('change')); })()`);
  ok('→ categorie (de keuzelijst): echt2 erbij, achteraan', await tot(`document.querySelector('#lib-panel .ik-cat[data-cat="${cid}"] b')?.textContent === '3'`, 5000));

  // ---- filteren met de zoekregel en een gefilterd nummer laden --------------------------------
  console.log('\nfilteren en laden');
  const h2 = handelingen;
  await zetZoek('#dub bpm:70-90');
  ok('#dub bpm:70-90: alleen echt1 en echt3', await tot(`JSON.stringify(${IDS}.sort()) === '["echt1","echt3"]'`, 5000), JSON.stringify(await evalueer(IDS)));
  ok('de chips van het filter staan in de tagbalk', await evalueer("[...document.querySelectorAll('#lib-panel .ik-chips .ik-filter')].map((c) => c.textContent).join('|')") === '#Dub ×|70-90 bpm ×');
  await klik('#lib-panel button[data-deck="A"][data-id="echt3"]');
  ok('een gefilterd nummer op track 1 geladen', await tot("window.engine.deck('A').title === 'echt echt3' && !window.library.bezig.size", 10000));
  ok('filteren en laden: 2 handelingen', handelingen - h2 === 2);
  await klik('#lib-panel .ik-chips .ik-filter');
  ok('× op een chip: het filter wordt ruimer (alleen nog bpm)', await tot("document.querySelector('#lib-panel .lib-zoek').value === 'bpm:70-90'", 3000));
  await zetZoek('#deep -#nacht');
  const deep = await api('/api/library?tag=deep&niet=nacht&aantal=1');
  ok(`#deep -#nacht op ${N + 3} nummers: de lijst telt wat de server telt (${deep.totaal})`, await tot(`${STATUS}.includes('${deep.totaal} gevonden')`, 5000));
  // Hoe snel: een gefilterde pagina van 100 op deze library (de server levert ook de pagina's van de decks).
  const tijden = [];
  for (const q of ['tag=deep&niet=nacht', 'tag=deep&bpm=70-90&grid=zeker', 'of=deep,nacht&sorteer=titel&richting=op', `cat=${cid}&sorteer=plek`]) {
    for (let k = 0; k < 5; k++) { const t0 = performance.now(); await fetch(`${B}/api/library?${q}&aantal=100&van=200`).then((r) => r.json()); tijden.push(performance.now() - t0); }
  }
  tijden.sort((a, b) => a - b);
  ok(`een gefilterde pagina van 100 (met totaal), over HTTP: mediaan ${tijden[10].toFixed(1)} ms, traagst ${tijden.at(-1).toFixed(1)} ms`, tijden[10] < 50);

  // ---- de categorie op volgorde, omslepen ----------------------------------------------------
  console.log('\nvolgorde');
  await zetZoek('');
  await klik(`#lib-panel .ik-cat[data-cat="${cid}"]`);
  ok('klik op de categorie: zijn nummers, in zijn volgorde', await tot(`JSON.stringify(${IDS}) === '["echt3","echt1","echt2"]'`, 5000),
    `${JSON.stringify(await evalueer(IDS))} · ${await evalueer(STATUS)} · zoek=${await evalueer("document.querySelector('#lib-panel .lib-zoek').value")}`);
  ok('de zoekregel zegt @"warm op", de knop volgorde staat aan', await evalueer("document.querySelector('#lib-panel .lib-zoek').value") === '@"warm op"'
    && await evalueer("!!document.querySelector('#lib-panel .ik-plek.on')"));
  ok('echt2 vóór echt1 slepen', await sleep('#lib-panel .lib-rij[data-id="echt2"]', '#lib-panel .lib-rij[data-id="echt1"]'));
  ok('…de nieuwe volgorde (scherm en server)', await tot(`JSON.stringify(${IDS}) === '["echt3","echt2","echt1"]'`, 5000)
    && JSON.stringify((await api(`/api/library?cat=${cid}&sorteer=plek&aantal=10`)).tracks.map((t) => t.id)) === JSON.stringify(['echt3', 'echt2', 'echt1']));
  await foto('indeling-categorie.png');

  // ---- snel-tag: in het menu van een tag op 1 zetten, dan alt+1 ---------------------------------
  console.log('\nsnel-tag en de bus');
  await klik('#lib-panel .ik-tagrij:has([data-tagfilter="Dub"]) .ik-meer');
  await klik('#lib-panel button[data-snelzet="1"]');
  ok('snel-tag 1 = Dub (server en knop in de balk)', await tot("!!document.querySelector('#lib-panel .ik-snelknop[data-snel=\"1\"]')", 5000) && (await api('/api/indeling/stand')).snel[0] === 'Dub');
  await klik('#lib-panel .lib-rij[data-id="echt2"] .lib-duur');
  handelingen++;
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', modifiers: 1, windowsVirtualKeyCode: 49 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1', modifiers: 1, windowsVirtualKeyCode: 49 });
  ok('alt+1: #Dub op echt2', await tot("!!document.querySelector('#lib-panel .lib-rij[data-id=\"echt2\"] .ik-chip')", 5000) && (await api('/api/library?tag=dub&aantal=10')).totaal === 3);
  // track.1.tag.1 (wat de iPad doet via de schrijfweg): echt3 staat op track 1 en heeft #Dub.
  ok('read track.1.tag.1 = 1 (echt3 heeft Dub)', await tot("__act.read('track.1.tag.1') === 1", 5000));
  await evalueer("__act.invoke('track.1.tag.1', true); __act.invoke('track.1.tag.1', false)");
  ok('invoke track.1.tag.1: Dub eraf (server), read 0', await tot("__act.read('track.1.tag.1') === 0", 5000) && (await api('/api/library?tag=dub&aantal=10')).totaal === 2);
  ok('library.category.next/prev/clear staan op de bus', await evalueer("['library.category.next', 'library.category.prev', 'library.category.clear', 'library.quicktag.8', 'track.8.tag.8'].every((a) => __act.has(a))"));
  await evalueer("__act.invoke('library.category.clear', true)");
  ok('library.category.clear: het filter leeg', await tot("document.querySelector('#lib-panel .lib-zoek').value === ''", 3000));
  await evalueer("__act.invoke('library.category.next', true)");
  ok('library.category.next: de eerste categorie', await tot("document.querySelector('#lib-panel .lib-zoek').value === '@\"warm op\"'", 3000));
  ok('het scherm van de Maschine kent het filter (bladerStand)', await evalueer("window.library.bladerStand().filter") === '@Warm op');

  // ---- een slimme categorie uit het filter --------------------------------------------------
  console.log('\nslim');
  await zetZoek('#deep grid:zeker bpm:120-140');
  await klik('#lib-panel .lib-indeling button[data-nieuw="slim"]');
  await typ('#lib-panel .ik-nieuwnaam', 'Deep vlot');
  const stand = await api('/api/indeling/stand');
  const slim = stand.categorieen.find((c) => c.naam === 'Deep vlot');
  const verwacht = (await api('/api/library?tag=deep&grid=zeker&bpm=120-140&aantal=1')).totaal;
  ok(`een slimme categorie uit het filter: ${slim?.aantal} nummers, wat de regel nu vindt`, slim?.soort === 'slim' && slim.aantal === verwacht && verwacht > 0);
  ok('…en hij staat meteen als filter', await tot(`document.querySelector('#lib-panel .lib-zoek').value === '@"deep vlot"'`, 3000));
  await foto('indeling-slim.png');

  ok('geen fouten in de console', meldingen.length === 0, meldingen.join(' | '));
  console.log(`\nhandelingen in totaal: ${handelingen}`);
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
