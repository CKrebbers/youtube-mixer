// De Controlekamer (controle.html) in headless Chromium, naast een echte mixer
// in een tweede tabblad van dezelfde browser: Web Lock en BroadcastChannel
// werken dan zoals bij Clay. Eigen server, tijdelijke database en speellijst,
// en MIDI eruit vóór elke pagina (veilig met de APC aangesloten).
//
// Gebruik:  node tools/headless/controle.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8796) en VARVE_KIJK_DEBUG (9396).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), '../..');
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8796, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9396;
const tmp = mkdtempSync(join(tmpdir(), 'varve-controle-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';

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
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,790',
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
  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  return { ws, cdp, ev, fouten, id: doel.id };
}
const nieuwTabblad = async () => verbind(await fetch(`http://127.0.0.1:${DEBUG}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()));
const sluitTabblad = (t) => fetch(`http://127.0.0.1:${DEBUG}/json/close/${t.id}`).catch(() => {});
async function tot(fn, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(200); }
  return false;
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

let ctl, mixer, tweede;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ctl = await verbind(doelen.find((d) => d.type === 'page'));
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // De tegel met deze naam: { licht, waarde, sub }.
  const tegel = (naam) => ctl.ev(`(() => { const t = [...document.querySelectorAll('.tegel')].find((x) => x.querySelector('.tegel-naam').textContent.trim() === ${JSON.stringify(naam)});
    return t ? { licht: t.dataset.licht, waarde: t.querySelector('.tegel-waarde').textContent, sub: t.querySelector('.tegel-sub').textContent } : null; })()`);

  console.log('zonder mixer');
  await ctl.cdp('Page.navigate', { url: `http://localhost:${POORT}/controle` });
  ok('de Controlekamer start', await tot(() => ctl.ev('!!window.controle && document.querySelectorAll(".tegel").length >= 4')));
  ok('server: draait, met het aantal nummers', await tot(async () => { const t = await tegel('Server'); return t?.licht === 'ok' && /library: \d+ nummers/.test(t.sub); }));
  ok('mixer: niet open', (await tegel('Mixer'))?.waarde === 'niet open');
  ok('de knop "mixer openen" is aan', await ctl.ev("!document.getElementById('mixer-open').disabled"));
  const nPunten = await ctl.ev("document.querySelectorAll('.punt').length");
  ok(`de speellijst staat er (${nPunten} punten, 0 gedaan)`, nPunten > 20 && (await ctl.ev("document.getElementById('voortgang').textContent")).startsWith(`0/${nPunten}`));
  ok('past op 1440×790 zonder zijwaarts scrollen', await ctl.ev('document.documentElement.scrollWidth <= innerWidth'));
  ok('geen MIDI in de Controlekamer', await ctl.ev('!navigator.requestMIDIAccess'));

  console.log('\nmet een mixer in een ander tabblad');
  mixer = await nieuwTabblad();
  await mixer.cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  ok('de mixer start', await tot(() => mixer.ev('!!window.engine'), 20000));
  ok('de Controlekamer ziet hem (Web Lock): open', await tot(async () => (await tegel('Mixer'))?.waarde === 'open'));
  ok('... en hij meldt zich (BroadcastChannel)', await tot(async () => (await tegel('Mixer'))?.sub === 'meldt zich'));
  const apc = await tegel('APC40');
  ok(`APC-tegel volgt de mixer: geen MIDI in dit tabblad ("${apc?.waarde}")`, apc?.waarde === 'geen MIDI');
  const audio = await tegel('Audio');
  ok(`audio-tegel heeft een stand ("${audio?.waarde}")`, audio && audio.waarde !== '—');
  ok('de knop is uit: "mixer staat open"', await ctl.ev("document.getElementById('mixer-open').disabled && document.getElementById('mixer-open').textContent === 'mixer staat open'"));
  await mixer.ev("document.querySelector('.demo-btn').click()");
  ok('wat er in de mixer staat: de demotrack', await tot(() => ctl.ev("!document.getElementById('spelen').hidden && document.getElementById('spelen').textContent.includes('IN DE MIXER')")));

  tweede = await nieuwTabblad();
  await tweede.cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  ok('een tweede mixer: rood, "plus 1 extra"', await tot(async () => { const t = await tegel('Mixer'); return t?.licht === 'fout' && t.waarde.includes('plus 1'); }, 20000));
  await sluitTabblad(tweede); tweede = null;
  ok('tweede dicht: weer gewoon open', await tot(async () => (await tegel('Mixer'))?.licht === 'ok'));

  console.log('\nde speellijst');
  const B = `http://localhost:${POORT}`;
  await ctl.ev(`document.querySelector('.punt[data-id="dr-rem"] .sk[data-st="fout"]').click()`);
  ok('fout aanklikken: bewaard op de server', await tot(async () => (await (await fetch(`${B}/api/proef`)).json()).items['dr-rem']?.status === 'fout'));
  // De pagina zet de knop pas als het antwoord binnen is: daar wachten, niet op de server.
  ok('... de knop staat aan en de notitie krijgt de focus', await tot(() => ctl.ev(`document.querySelector('.punt[data-id="dr-rem"] .sk[data-st="fout"]').getAttribute('aria-pressed') === 'true'
    && document.activeElement?.id === 'n-dr-rem'`)));
  await ctl.ev(`(() => { const v = document.getElementById('n-dr-rem'); v.value = 'klikt aan het eind'; v.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok('notitie: bewaard', await tot(async () => (await (await fetch(`${B}/api/proef`)).json()).items['dr-rem']?.notitie === 'klikt aan het eind'));
  await ctl.ev(`document.querySelector('.punt[data-id="dr-loop"] .sk[data-st="ok"]').click()`);
  ok('dr-loop ok: bewaard op de server', await tot(async () => (await (await fetch(`${B}/api/proef`)).json()).items['dr-loop']?.status === 'ok'));
  const voortgang = () => ctl.ev("document.getElementById('voortgang').textContent");
  ok('voortgang telt mee (2 gedaan, 1 fout)', await tot(async () => /^2\/\d+ gedaan · 1 fout/.test(await voortgang())), await voortgang());
  await ctl.cdp('Page.reload');
  ok('na herladen staat alles er nog', await tot(() => ctl.ev(`document.querySelector('.punt[data-id="dr-rem"]')?.dataset.status === 'fout'
    && document.getElementById('n-dr-rem').value === 'klikt aan het eind' && document.querySelector('.punt[data-id="dr-loop"]').dataset.status === 'ok'`)));
  await ctl.ev(`document.querySelector('.punt[data-id="dr-loop"] .sk[data-st="ok"]').click()`);
  ok('nog eens ok: terug naar open (en weg op de server)', await tot(async () => !(await (await fetch(`${B}/api/proef`)).json()).items['dr-loop']));
  const foto = await ctl.cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, 'controle.png'), Buffer.from(foto.data, 'base64'));

  console.log('\nde mixer weer dicht');
  await sluitTabblad(mixer); mixer = null;
  ok('de Controlekamer ziet het: niet open, knop weer aan', await tot(async () => (await tegel('Mixer'))?.waarde === 'niet open'
    && await ctl.ev("!document.getElementById('mixer-open').disabled")));
  ok('geen fouten in de console van de Controlekamer', ctl.fouten.length === 0, ctl.fouten.join(' | '));
} catch (err) {
  ok(`script liep door: ${err.message}`, false);
} finally {
  for (const t of [ctl, mixer, tweede]) { try { t?.ws.close(); } catch (_) {} }
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Schermafdruk in ${UIT}/controle.png`);
process.exit(rood ? 1 : 0);
