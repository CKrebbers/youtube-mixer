// De tab "kaart" headless tegen de ECHTE kaart-routes (server/kaart.js,
// server/nacht.js) van een server die al draait, met de echte varve-kaart.json
// (10 okt: 18.233 nummers, 29 kratten). Geen nep-server ervoor (dat is
// kaart.mjs, voor ontwikkeling zonder de serverkant); dit script spawnt alleen
// Chrome. De server start je zelf, met een KOPIE van de library en de
// nep-yt-dlp, zodat er niets van YouTube komt. Bijvoorbeeld (docs/KAART.md §9):
//
//   PORT=8782 VARVE_DB=<map>/media/library.db VARVE_MEDIA=<map>/media \
//   VARVE_OPNAMES=<map>/opnames VARVE_PATRONEN=<map>/patronen VARVE_PLANNEN=<map>/plannen \
//   VARVE_PROEF=<map>/proef VARVE_BACKUPS=<map>/backups VARVE_HERANALYSE=uit \
//   VARVE_YTDLP=<map>/nep-yt-dlp NEP_LOG=<map>/nep.log NEP_BRON=<map>/bron.wav NEP_DUUR=300 \
//   VARVE_KAART="$HOME/Desktop/3. Resources/Data/Muziekkaart/varve-kaart.json" node server/index.js
//
// Wat hij nakijkt: de tab opent met alle nummers, de kratkiezer heeft elke krat
// met aantal, zoeken geeft wat de API geeft, een krat toont zijn nummers in
// kratvolgorde met de kratkolom, "haal binnen" op één nummer gaat door de echte
// wens-route en de (nep-)ingest zonder videostap en zonder cookie-optie, het
// nachtblok zegt uit en noemt de speeldag, en de console blijft schoon.
//
// Gebruik:  node tools/headless/kaart-echt.mjs [uitmap]
// Poorten:  VARVE_KIJK_ECHT (de server, standaard 8782), VARVE_KIJK_DEBUG (9417).
// NEP_LOG:  het log van de nep-yt-dlp van die server (dan wordt de videostap gecontroleerd).
// Chromium: de headless shell uit de Playwright-cache, of VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const ECHT = Number(process.env.VARVE_KIJK_ECHT) || 8782, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9417;
const NEP_LOG = process.env.NEP_LOG || null;
const B = `http://localhost:${ECHT}`;
const tmp = mkdtempSync(join(tmpdir(), 'varve-kaart-echt-'));
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
const api = async (pad, init) => { const r = await fetch(`${B}${pad}`, init); return r.json(); };
const nepRegels = () => (NEP_LOG && existsSync(NEP_LOG) ? readFileSync(NEP_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : null);

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

// Eerst de server: draait hij, en met welke kaart?
let stand;
try { stand = await api('/api/kaart'); } catch (err) { console.error(`geen server op ${B}: ${err.message}`); process.exit(2); }
if (stand.status !== 'geladen') { console.error(`de kaart is niet geladen op ${B}: ${stand.status} ${stand.fout || ''} (${stand.pad})`); process.exit(2); }
const AANTAL = stand.aantal, KRATTEN = stand.kratten;
console.log(`server ${B}: kaart ${AANTAL} nummers, ${KRATTEN.length} kratten (${KRATTEN.filter((k) => k.soort === 'playlist').length} playlists, ${KRATTEN.filter((k) => k.soort === 'slim').length} slim), gebouwd ${stand.gebouwd}`);
const nachtVoor = await api('/api/nacht');
const libVoor = (await api('/api/library?aantal=1')).totaal;

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

const DEEL = "document.querySelector('#lib-panel .kaart-deel')";
const RIJEN = "document.querySelectorAll('#lib-panel .kaart-rijen .lib-venster .kaart-rij:not(.laadt)').length";
const SLEUTELS = "[...document.querySelectorAll('#lib-panel .kaart-rijen .lib-venster .kaart-rij:not(.laadt)')].map((e) => e.dataset.sleutel)";
const STATUS = "document.querySelector('#lib-panel .kaart-status').textContent";
const typ = (sel, tekst) => evalueer(`(() => { const z = document.querySelector('${sel}'); z.value = ${JSON.stringify(tekst)}; z.dispatchEvent(new Event('input')); })()`);
const klik = (sel) => evalueer(`(() => { const b = document.querySelector('${sel}'); if (!b) throw new Error('geen ${sel}'); b.click(); })()`);
const kiesKrat = (id) => evalueer(`(() => { const s = document.querySelector('#lib-panel .kaart-krat'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); })()`);
const standVan = (sleutel) => evalueer(`document.querySelector('#lib-panel .kaart-rijen [data-stand="${sleutel}"]')?.innerHTML ?? null`);
const meting = {};

let wensSleutel = null;
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

  await cdp('Page.navigate', { url: `${B}/?vormen=0` });
  ok('de app start op de echte server, met de kaart-tab', await tot('window.engine && window.library && window.kaart'));
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  await evalueer("localStorage.removeItem('varve.library.tab'); localStorage.removeItem('varve.kaart.sortering')");

  // ---- openen en de tab -------------------------------------------------------
  console.log('\npaneel open, tab kaart');
  await evalueer("document.getElementById('lib-btn').click()");
  ok('het paneel opent op de library (standaard)', await tot("!document.getElementById('lib-panel').classList.contains('hidden') && window.kaart.tab === 'library'"));
  await evalueer("window.__t0 = performance.now(); document.querySelector('#lib-panel .lib-tab[data-tab=\"kaart\"]').click()");
  ok(`tab kaart: de rijen staan er en de status zegt ${AANTAL} nummers`, await tot(`${RIJEN} > 5 && ${STATUS}.includes('${AANTAL} nummers')`), await evalueer(STATUS));
  meting.tabMs = await evalueer('performance.now() - window.__t0');
  console.log(`      ${meting.tabMs.toFixed(0)} ms van de klik tot de rijen`);
  const inDom = await evalueer(RIJEN);
  ok('alleen de zichtbare rijen in de DOM (≤ 30)', inDom > 5 && inDom <= 30, `${inDom} rijen`);
  ok(`scrollhoogte = de hele kaart (${AANTAL} × 28)`, await evalueer(`document.querySelector('#lib-panel .kaart-rijen .lib-ruimte').offsetHeight === ${AANTAL} * 28`));
  const eersteApi = (await api('/api/kaart/nummers?sorteer=beurten&richting=af&aantal=3')).nummers.map((n) => n.sleutel);
  ok('standaard: op beurten aflopend, zoals de server', JSON.stringify((await evalueer(SLEUTELS)).slice(0, 3)) === JSON.stringify(eersteApi));
  ok('zonder krat geen kratkolom; kop ligt boven de kolommen', await evalueer(`(() => {
    if (document.querySelector('#lib-panel .kaart-rijen button[data-sorteer="krat"]')) return false;
    const kop = [...document.querySelectorAll('#lib-panel .kaart-rijen .lib-kop > *')].map((e) => Math.round(e.getBoundingClientRect().left));
    const rij = [...document.querySelector('#lib-panel .kaart-rijen .lib-venster .kaart-rij').children].map((e) => Math.round(e.getBoundingClientRect().left));
    return kop.length === rij.length && kop.every((x, i) => Math.abs(x - rij[i]) <= 1);
  })()`));
  const opties = await evalueer("[...document.querySelectorAll('#lib-panel .kaart-krat option')].map((o) => [o.value, o.textContent])");
  const kratOk = KRATTEN.every((k) => opties.some(([v, t]) => v === k.id && t.startsWith(k.naam) && t.includes(`(${k.aantal}`)));
  ok(`de kratkiezer heeft alle ${KRATTEN.length} kratten met hun naam uit het bestand en hun aantal, plus "hele kaart (${AANTAL})"`, opties.length === KRATTEN.length + 1 && kratOk && opties[0][1].includes(`hele kaart (${AANTAL})`),
    kratOk ? '' : JSON.stringify(opties.slice(0, 5)));
  ok('badges staan er (♥ of ≡ of ▶ of ♫)', await evalueer("!!document.querySelector('#lib-panel .kaart-badge')"));
  ok(`het blok Nachtwachtrij: uit, ${nachtVoor.perNacht} per nacht, ${nachtVoor.venster.van}–${nachtVoor.venster.tot}, speeldagen, wenslijst`, await tot(`(() => { const n = document.querySelector('#lib-panel .kaart-nacht');
    return n.textContent.includes('NACHTWACHTRIJ') && n.querySelector('[data-nacht="aan"]')?.textContent === '${nachtVoor.aan ? 'aan' : 'uit'}' && n.querySelector('[data-nacht="perNacht"]')?.value === '${nachtVoor.perNacht}'
      && n.querySelector('[data-nacht="van"]')?.value === '${nachtVoor.venster.van}' && n.textContent.includes('wenslijst:') && n.textContent.includes('speeldagen:'); })()`, 8000),
  await evalueer("document.querySelector('#lib-panel .kaart-nacht')?.textContent.replace(/\\s+/g, ' ')"));
  ok(`de server zegt aan: ${nachtVoor.aan}, speeldagen ${JSON.stringify(nachtVoor.speeldagen)}; het blok noemt de speeldag van vandaag`, nachtVoor.aan === false && nachtVoor.speeldagen.includes('2026-10-10')
    && await evalueer("document.querySelector('#lib-panel .kaart-nacht-speeldagen')?.textContent.includes('10 okt (vandaag)')"), await evalueer("document.querySelector('#lib-panel .kaart-nacht-speeldagen')?.textContent"));
  await foto('kaart-echt-open.png');

  // ---- zoeken --------------------------------------------------------------------
  console.log('\nzoeken');
  const four = (await api('/api/kaart/nummers?zoek=four&aantal=1')).totaal;
  await evalueer('window.__t1 = performance.now()');
  await typ('#lib-panel .kaart-zoek', 'four');
  ok(`zoeken "four": "${four} gevonden" zoals de API`, await tot(`${STATUS}.includes('${four} gevonden voor "four"')`, 8000), await evalueer(STATUS));
  meting.zoekMs = await evalueer('performance.now() - window.__t1');
  console.log(`      ${meting.zoekMs.toFixed(0)} ms van het typen tot de uitkomst (met 120 ms wachten op het typen)`);
  const fourApi = (await api('/api/kaart/nummers?zoek=four&sorteer=beurten&richting=af&aantal=30')).nummers.map((n) => n.sleutel);
  const fourUi = await evalueer(SLEUTELS);
  ok('de zichtbare rijen zijn precies de eerste treffers van de API (zoek in het zoek-veld, artiest en titel)', fourUi.length > 5 && fourUi.every((s, i) => s === fourApi[i]), `${fourUi.length} rijen`);
  await foto('kaart-echt-zoek.png');
  await typ('#lib-panel .kaart-zoek', '');
  ok('leeg: weer alles', await tot(`${STATUS}.includes('${AANTAL} nummers')`, 8000));

  // ---- de proefkrat -------------------------------------------------------------------
  console.log('\nkrat: proefkrat');
  const proef = KRATTEN.find((k) => k.id === 'slim:proefkrat');
  const proefApi = (await api('/api/kaart/nummers?krat=slim:proefkrat&aantal=100'));
  await kiesKrat('slim:proefkrat');
  ok(`krat ${proef?.naam}: ${proefApi.totaal} rijen, de status noemt de naam uit het bestand`, await tot(`${STATUS}.includes('${proefApi.totaal} nummers in krat "${proef?.naam}"') && ${RIJEN} === ${proefApi.totaal}`, 8000), await evalueer(STATUS));
  ok('in de volgorde van de krat (sorteer=krat, ▲ in de kratkolom), met rangnummers 1, 2, 3 …', JSON.stringify(await evalueer(SLEUTELS)) === JSON.stringify(proefApi.nummers.map((n) => n.sleutel))
    && await evalueer("document.querySelector('#lib-panel .kaart-rijen button[data-sorteer=\"krat\"]')?.textContent.includes('▲')")
    && await evalueer("[...document.querySelectorAll('#lib-panel .kaart-rijen .kaart-rij:not(.laadt) .kaart-volgnr')].slice(0, 3).map((e) => e.textContent).join() === '1,2,3'"));
  ok('kop ligt boven de kolommen, ook met de kratkolom', await evalueer(`(() => {
    const kop = [...document.querySelectorAll('#lib-panel .kaart-rijen .lib-kop > *')].map((e) => Math.round(e.getBoundingClientRect().left));
    const rij = [...document.querySelector('#lib-panel .kaart-rijen .lib-venster .kaart-rij').children].map((e) => Math.round(e.getBoundingClientRect().left));
    return kop.length === rij.length && kop.every((x, i) => Math.abs(x - rij[i]) <= 1);
  })()`));
  await klik('#lib-panel .kaart-rijen button[data-sorteer="beurten"]');
  const proefBeurten = (await api('/api/kaart/nummers?krat=slim:proefkrat&sorteer=beurten&richting=af&aantal=100')).nummers.map((n) => n.sleutel);
  ok('kolomkop beurten: op beurten, zoals de server met sorteer=beurten', await tot(`JSON.stringify(${SLEUTELS}) === ${JSON.stringify(JSON.stringify(proefBeurten))}`, 8000));
  await klik('#lib-panel .kaart-rijen button[data-sorteer="krat"]');
  ok('terug naar de kratvolgorde via de kop', await tot(`JSON.stringify(${SLEUTELS}) === ${JSON.stringify(JSON.stringify(proefApi.nummers.map((n) => n.sleutel)))}`, 8000));
  await foto('kaart-echt-proefkrat.png');

  // ---- haal binnen: door de echte wens-route en de (nep-)ingest ---------------------------
  console.log('\nhaal binnen (echte route, nep-yt-dlp, geen video)');
  const kandidaat = proefApi.nummers.find((n) => n.youtube_id && !n.binnen && !n.wens) || (await api('/api/kaart/nummers?filter=niet-binnen&aantal=50')).nummers.find((n) => n.youtube_id && !n.wens);
  wensSleutel = kandidaat.sleutel;
  const regelsVoor = nepRegels()?.length ?? 0;
  await evalueer('window.__t2 = performance.now()');
  await klik(`#lib-panel .kaart-rijen button[data-haal="${kandidaat.sleutel}"]`);
  ok(`"haal binnen" op ${kandidaat.artiest} – ${kandidaat.titel}: de server heeft de wens (bezig of al klaar) en de status meldt het`, await (async () => {
    for (let i = 0; i < 100; i++) {
      const w = (await api('/api/kaart/wensen')).wensen.find((x) => x.sleutel === kandidaat.sleutel);
      if (w && ['bezig', 'klaar'].includes(w.status)) return true;
      await wacht(100);
    }
    return false;
  })() && await tot(`${STATUS}.includes('1 naar de wachtrij')`, 5000), await evalueer(STATUS));
  const inRij = await api('/api/ingest');
  const opdr = inRij.opdrachten?.find((o) => o.sleutel === kandidaat.youtube_id || new RegExp(kandidaat.youtube_id).test(o.url || ''));
  ok(`in de bestaande ingest-rij zonder videostap (${opdr?.stappen?.join(',') ?? 'al klaar'})`, !opdr || (!opdr.stappen.includes('video') && opdr.stappen.includes('audio')));
  const klaar = await (async () => {
    for (let i = 0; i < 1800; i++) {
      const w = (await api('/api/kaart/wensen')).wensen.find((x) => x.sleutel === kandidaat.sleutel);
      if (w && !['wacht', 'bezig'].includes(w.status)) return w;
      await wacht(100);
    }
    return null;
  })();
  meting.haalMs = await evalueer('performance.now() - window.__t2');
  ok(`de wens is klaar met zijn track als object (${klaar?.status}${klaar?.fout ? `: ${klaar.fout}` : ''}, ${(meting.haalMs / 1000).toFixed(1)} s)`, klaar?.status === 'klaar' && klaar.track?.id === kandidaat.youtube_id && klaar.track.video === null);
  const regels = nepRegels();
  if (regels) {
    const nieuw = regels.slice(regelsVoor);
    ok(`nep-yt-dlp: ${nieuw.length} aanroepen, geen videostap, geen cookie-optie`, nieuw.length > 0 && !nieuw.some((r) => r.wat === 'video') && !nieuw.some((r) => (r.args ?? []).some((a) => /cookies/.test(a))));
  } else console.log('  --  NEP_LOG niet gezet: de videostap is niet in het nep-log gecontroleerd (wel via de wachtrij-stappen hierboven)');
  ok('de library heeft er één nummer bij; het nummer is binnen op de kaart', (await api('/api/library?aantal=1')).totaal === libVoor + 1 && (await api(`/api/kaart/nummer/${encodeURIComponent(kandidaat.sleutel)}`)).nummer.binnen === kandidaat.youtube_id);
  ok('de rij is nu "binnen" met laadknoppen (peiling → verversing)', await tot(`document.querySelector('#lib-panel .kaart-rijen [data-stand="${kandidaat.sleutel}"]')?.querySelector('button[data-deck]')`, 12000), await standVan(kandidaat.sleutel));
  ok('de kratkiezer telt hem als binnen', await tot(`[...document.querySelectorAll('#lib-panel .kaart-krat option')].some((o) => o.value === 'slim:proefkrat' && /1 binnen/.test(o.textContent))`, 12000)
    || (await api('/api/kaart')).kratten.find((k) => k.id === 'slim:proefkrat').binnen >= 1);
  ok('wenslijst-telling in het blok: 1 klaar', await tot("document.querySelector('#lib-panel .kaart-nacht').textContent.includes('1 klaar')", 8000));
  await foto('kaart-echt-haal-binnen.png');

  // ---- nachtblok: niets aanzetten, alleen kijken --------------------------------------------
  console.log('\nnachtwachtrij (alleen kijken; blijft uit)');
  const nachtNa = await api('/api/nacht');
  ok('de nacht staat nog uit, speeldag 2026-10-10 staat er nog, niets liep', nachtNa.aan === false && nachtNa.speeldagen.includes('2026-10-10') && nachtNa.bezig === null && nachtNa.laatsteRun === null);
  ok('het blok zegt "nachtwachtrij uit" en noemt de laatste run niet', await evalueer("document.querySelector('#lib-panel .kaart-nacht-stand')?.textContent.includes('nachtwachtrij uit') && document.querySelector('#lib-panel .kaart-nacht-run')?.textContent.includes('nog geen run')"));
  await foto('kaart-echt-nacht.png');

  // Chrome logt een mislukte fetch zelf; alleen onze eigen fouten tellen.
  const eigen = meldingen.filter((m) => !/Failed to load resource|net::ERR/.test(m));
  ok('geen fouten in de console', eigen.length === 0, eigen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.stack || err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill();
  // De wens weg (het nummer blijft in de kopie van de library), zodat het script nog eens kan.
  if (wensSleutel) await fetch(`${B}/api/kaart/wens/${encodeURIComponent(wensSleutel)}`, { method: 'DELETE' }).catch(() => {});
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
console.log(`\ngemeten: tab → rijen ${meting.tabMs?.toFixed(0) ?? '?'} ms · zoeken ${meting.zoekMs?.toFixed(0) ?? '?'} ms · haal binnen ${meting.haalMs ? (meting.haalMs / 1000).toFixed(1) : '?'} s`);
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
