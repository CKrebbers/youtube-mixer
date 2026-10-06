// Secties op de Maschine MK2 (SCENE = padmodus secties), van begin tot eind in echte Chrome
// (TASKS-SECTIES, Verweven 9; docs/MASCHINE.md §5b, docs/SECTIES.md):
//
//   de ECHTE hub (startHub uit de hub-repo, op een eigen poort, standaard 7715: nooit 7700) met
//   een nep-APC (NepSysteem) en een nep-Maschine op HID-niveau (NepHidSysteem + nepMaschine uit
//   de hub-tests: echte HID-rapporten, de hub maakt er virtuele MIDI van), en VARVE met
//   ?hub=ws://…/app op een EIGEN server (tijdelijke database, media, patronen en plannen) met de
//   nep-yt-dlp en het synthetische nummer (test/synth-nummer.mjs: zeven secties op 124 bpm).
//   Gecontroleerd:
//     - zonder ?hub=: niets van de Maschine geladen (en dus verandert er niets)
//     - SCENE: de modus secties; de pads = de secties van de focus-track (HID-rapport 0x80:
//       die je hoort wit, de andere donker hemelsblauw, pads zonder sectie uit), SCENE fel (0x82)
//     - een pad tijdens het spelen: `track.1.section.K` over de bus (bijInvoke: daar luisteren
//       het handelingenlog en de auto-DJ), de sprong valt in op de volgende "1" (fasebehoudend,
//       zoals sec-toets.mjs), en daarna hoor je die sectie en brandt zijn pad wit
//     - het linkerscherm (HID 0xE0) bit voor bit tekenScherm(stand): in de aanloop "op de 1:
//       4 …", daarna de kop "T1 4 …" (de sectie die je hoort)
//     - een pad zonder sectie: geen stille weigering (de melding van de bus)
//     - SCENE nog eens: weer spelen; nooit requestMIDIAccess
//
// VEILIG met de echte mixer (8777) en de echte hub (7700) aan: eigen poorten, geen node-hid
// (nep-HID), geen opname van de hub (opname: false), requestMIDIAccess is een spion die weigert.
//
// Gebruik:  VARVE_HUB_REPO=<AV-app-hub> node tools/headless/sec-maschine.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8915), VARVE_KIJK_DEBUG (9515), VARVE_HUB_POORT (7715). Chrome: VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';
import { maakNepStems } from '../../test/nep-stems.mjs';
import { synthNummer } from '../../test/synth-nummer.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const HUB = process.env.VARVE_HUB_REPO || join(WORTEL, '../av-app-hub');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8915, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9515;
const HUB_POORT = Number(process.env.VARVE_HUB_POORT) || 7715;
for (const [naam, p] of [['VARVE_KIJK_POORT', POORT], ['VARVE_HUB_POORT', HUB_POORT]]) {
  if (p === 8777 || p === 7700) { console.error(`${naam}=${p}: daar draaien de echte mixer en hub; kies een andere poort`); process.exit(2); }
}
for (const f of ['src/hub.js', 'src/ports/nep.js', 'test/nep-speelapparaten.js']) {
  if (!existsSync(join(HUB, f))) { console.error(`geen AV-app-hub met speelapparaten in ${HUB} (${f} ontbreekt; zet VARVE_HUB_REPO)`); process.exit(2); }
}
const { startHub } = await import(join(HUB, 'src/hub.js'));
const { NepSysteem, NepHidSysteem } = await import(join(HUB, 'src/ports/nep.js'));
const { laadConfig } = await import(join(HUB, 'src/config.js'));
const MS = await import(join(HUB, 'src/devices/maschine-mk2.js'));
const { nepMaschine, rustFrame } = await import(join(HUB, 'test/nep-speelapparaten.js'));
const { tekenScherm, alsTekst } = await import(join(WORTEL, 'src/control/maschine-scherm.js'));
const { PALETTE } = await import(join(WORTEL, 'src/control/devices/apc40mk2.js'));

const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-maschine-'));
mkdirSync(UIT, { recursive: true });
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

// Het synthetische nummer als stereo WAV op 48 kHz: dat wordt de "download".
const s = synthNummer({ sr: 48000 });
{
  const n = s.mix.length, y = new Int16Array(n * 2);
  let piek = 1e-9;
  for (const x of s.mix) piek = Math.max(piek, Math.abs(x));
  for (let i = 0; i < n; i++) y[2 * i] = y[2 * i + 1] = Math.round(32767 * 0.8 * s.mix[i] / piek);
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(2, 22);
  kop.writeUInt32LE(48000, 24); kop.writeUInt32LE(48000 * 4, 28); kop.writeUInt16LE(4, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  writeFileSync(join(tmp, 'bron.wav'), Buffer.concat([kop, Buffer.from(y.buffer)]));
}
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit',
    VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'), NEP_LOG: join(tmp, 'nep.log'),
    VARVE_STEMS_CMD: process.env.VARVE_STEMS_CMD || maakNepStems(tmp) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

// De hub: config zoals op de Mac, sneller hotplug, nep-HID, geen drivers en GEEN opname (geen avondmap).
const basis = laadConfig();
const config = { ...basis, hotplug_ms: 20, apparaten: { ...basis.apparaten, 'maschine-mk2': { ...basis.apparaten['maschine-mk2'], stil_ms: 200 } } };
const systeem = new NepSysteem();
systeem.voegToe('APC40 mkII');
const hid = new NepHidSysteem();
const m = nepMaschine(hid);
hid.bijOpen = (p) => setTimeout(() => p.injecteer(rustFrame()), 1);
const echt = await startHub({ config, systeem, hid, poort: HUB_POORT, drivers: false, opname: false });
const appUrl = echt.adres.replace('http', 'ws') + '/app';

const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,790',
  '--autoplay-policy=no-user-gesture-required', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
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
async function totdat(expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(50); }
  return false;
}
const tot = async (fn, ms = 8000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(40); } return fn(); };
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const act = (expr) => evalueer(`import('/src/control/actions.js').then((a) => ${expr})`);
const druk = (id) => act(`(a.invoke(${JSON.stringify(id)}, true), a.invoke(${JSON.stringify(id)}, false))`);
const rij = (deel) => `[...document.querySelectorAll('#lib-panel .lib-rij')].find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)}))`;
const deck = (id) => `window.engine.deck(${JSON.stringify(id)})`;

// Lampjes en schermen zoals de nep-Maschine ze van de hub kreeg (HID-rapporten).
const padRgb = (rap, pad) => rap.slice(1 + 3 * MS.plekVanPad(pad), 4 + 3 * MS.plekVanPad(pad));
const isKleur = (a, idx) => JSON.stringify(a) === JSON.stringify(MS.paletRgb(idx));
const padKleur = (pad) => { const r = m.laatste()['80']; return r ? padRgb(r, pad) : null; };
const padIs = (pad, idx) => { const r = m.laatste()['80']; return !!r && isKleur(padRgb(r, pad), idx); };
const sceneLamp = () => m.laatste()['82']?.[1 + 16] ?? null;   // rapport 0x82, plek 16 = SCENE (hub: KNOP_LED_82)
const scherm = (nr) => {
  const l = m.laatste();
  const uit = new Uint8Array(2048);
  for (let i = 0; i < 8; i++) { const stuk = l[`e${nr}:${i}`]; if (!stuk) return null; uit.set(stuk.slice(9), i * 256); }
  return uit;
};
const gelijk = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
/** Wacht tot het linkerscherm van de Maschine bit voor bit tekenScherm(stand) is, voor een stand die `voorwaarde` haalt. */
async function schermIs(voorwaarde, ms = 4000) {
  const eind = Date.now() + ms;
  let st = null;
  while (Date.now() < eind) {
    st = await evalueer('window.maschine.stand()');
    if (voorwaarde(st) && gelijk(scherm(0), tekenScherm(st, 0))) return st;
    await wacht(40);
  }
  return null;
}

/** Was de laatste sprong van dit deck op de maat? (zoals sec-toets.mjs; SECTIES.md §3) */
async function sprongOpDeMaat(id, i) {
  return evalueer(`(() => {
    const d = ${deck(id)}, g = d.grid, sp = window.__sprongen.filter((x) => x.id === ${JSON.stringify(id)}).at(-1);
    if (!g || !sp) return { ok: false, waarom: g ? 'geen sprong' : 'geen grid' };
    const van = d.sectieKaart.begin(${i}), bpb = g.beatsPerBar;
    const fase = (t) => g.barPhase(t);
    const dFase = Math.abs(fase(sp.naar) - fase(sp.voor)), fasefout = Math.min(dFase, 1 - dFase);
    const tellenTotDeEen = g.beatAt(van) - g.beatAt(sp.naar);
    const vanOpDeEen = Math.min(fase(van), 1 - fase(van));
    const tellenVoor = fase(sp.voor) * bpb, verwacht = tellenVoor < 0.02 ? -tellenVoor : bpb - tellenVoor;
    return { ok: fasefout < 0.01 && vanOpDeEen < 0.01 && Math.abs(tellenTotDeEen - verwacht) < 0.01 && sp.doorlopend,
      voor: +sp.voor.toFixed(3), naar: +sp.naar.toFixed(3), van: +van.toFixed(3), aanloop: +tellenTotDeEen.toFixed(3),
      verwacht: +verwacht.toFixed(3), fasefout: +fasefout.toFixed(4) };
  })()`);
}

async function doorloop() {
  const BASIS = `http://localhost:${POORT}/`;

  console.log('zonder ?hub=: niets van de Maschine');
  await cdp('Page.navigate', { url: `${BASIS}?vormen=0` });
  ok('de app start', await totdat('window.engine && window.videoMixer', 20000));
  await wacht(800);
  const geladen = await evalueer("performance.getEntriesByType('resource').map((r) => r.name).filter((u) => /speelapparaten\\.js|control\\/maschine|maschine-scherm|maschine-mk2/.test(u))");
  ok('speelapparaten.js, maschine.js, maschine-scherm.js en de Maschine-indeling niet geladen', geladen.length === 0, geladen.join(', '));
  ok('geen WebSocket, geen window.maschine', await evalueer('window.__ws.length === 0 && window.maschine === undefined'));

  console.log(`\nmet ?hub= (de echte hub op ${appUrl})`);
  await cdp('Page.navigate', { url: `${BASIS}?vormen=0&hub=${encodeURIComponent(appUrl)}` });
  ok('de app start met de Maschine', await totdat('window.engine && window.maschine && window.noten', 20000));
  ok('VARVE speelt de Maschine (beeld.spelers)', await tot(() => {
    const b = echt.kern.beeld();
    return b.spelers?.['maschine-mk2'] === 'varve-dj' && b.apparaten?.['maschine-mk2']?.status === 'verbonden';
  }), JSON.stringify(echt.kern.beeld().spelers));
  echt.kern.focus('varve-dj');

  console.log('\nbinnenhalen en laden op track 1 (de focus)');
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'https://www.youtube.com/watch?v=secMaschine';
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  ok('het nummer staat in de lijst', await totdat(rij('secMaschine'), 90000));
  await evalueer(`${rij('secMaschine')}.querySelector('button[data-deck="A"]').click()`);
  ok('op track 1', await totdat(`${deck('A')}.duration > 150`, 30000));
  ok('track 1 heeft secties', await totdat(`${deck('A')}.sectieKaart?.aantal >= 6`, 60000));
  await evalueer("document.getElementById('lib-btn').click()");
  const namen = await evalueer(`${deck('A')}.sectieKaart.stukken.map((x, i) => ${deck('A')}.sectieKaart.naam(i))`);
  const n = namen.length;
  console.log(`      ${namen.map((x, i) => `${i + 1} ${x}`).join(' · ')}`);
  ok('focus op track 1', await evalueer("window.engine.focus === 'A'"));

  console.log('\nSCENE: de padmodus secties');
  // Het EERSTE knoppenrapport na aansluiten zet in de hub alleen de beginstand (MaschineSessie): eerst één neutraal rapport.
  m.los('shift');
  await wacht(100);
  ok('SCENE zacht aan (de focus-track heeft secties)', await tot(() => sceneLamp() > 0), String(sceneLamp()));
  const zacht = sceneLamp();
  m.tik('scene');
  ok('SCENE: modus secties', await totdat("window.maschine.modus === 'secties'", 3000));
  ok('… het lampje van SCENE fel (HID 0x82)', await tot(() => sceneLamp() > zacht), `${zacht} -> ${sceneLamp()}`);
  ok(`pads (HID 0x80): pad 1 wit (je staat in sectie 1), 2–${n} donker hemelsblauw, ${n + 1}–16 uit`,
    await tot(() => padIs(1, PALETTE.wit) && [2, n].every((p) => padIs(p, PALETTE.hemelsblauwdonker)) && [n + 1, 16].every((p) => padIs(p, PALETTE.uit))),
    `pad 1 ${padKleur(1)}, pad 2 ${padKleur(2)}, pad ${n + 1} ${padKleur(n + 1)}`);
  ok(`linkerscherm (HID 0xE0) bit voor bit tekenScherm: "T1 1 ${namen[0]}" en de namen van de pads`,
    !!(await schermIs((st) => st.secties?.hoort === `1 ${namen[0]}` && st.secties.namen[n - 1] === namen[n - 1])));
  writeFileSync(join(UIT, 'sec-maschine-scherm-stil.txt'), alsTekst(scherm(0) ?? new Uint8Array(2048)));

  // Meeluisteren op de bus (daar luisteren ook het handelingenlog en de auto-DJ) en op elke sprong.
  await act(`(window.__bus = [], a.bijInvoke((id, v) => window.__bus.push([id, v])))`);
  await evalueer(`(() => { window.__sprongen = [];
    const d = window.engine.deck('A'), seek = d.seek.bind(d);
    d.seek = (t, o) => { window.__sprongen.push({ id: 'A', voor: d.position, naar: t, doorlopend: !!o?.doorlopend }); return seek(t, o); }; })()`);

  console.log('\nstilstaand: pad 2 = naar het begin van sectie 2');
  m.pad(2);
  ok('pad 2 -> track.1.section.2 over de bus (indrukken en los)', await totdat("window.__bus.some(([a, v]) => a === 'track.1.section.2' && v === true) && window.__bus.some(([a, v]) => a === 'track.1.section.2' && v === false)", 3000),
    JSON.stringify(await evalueer('window.__bus')));
  ok('… de speelkop staat op het begin van sectie 2', await totdat(`Math.abs(${deck('A')}.position - ${deck('A')}.sectieKaart.begin(1)) < 0.01`, 3000));

  console.log('\nspelen: pad 4 midden in een maat');
  await druk('track.1.play');
  ok('track 1 speelt in sectie 2', await totdat(`${deck('A')}.playing && ${deck('A')}.sectieHier === 1`, 15000));
  // Net na een "1" van sectie 2 (een kwart tel erin): de aanloop naar sectie 4 duurt dan bijna een maat.
  await evalueer(`(() => { const d = ${deck('A')}, g = d.grid, b = g.timeOf(g.volgendeVeelvoud(g.beatAt(d.sectieKaart.begin(1)) - 0.01));
    d.seek(g.verschuif(b, g.beatsPerBar + 0.25)); })()`);
  await wacht(150);
  const bus0 = await evalueer('window.__bus.length');
  m.pad(4);
  ok('pad 4 -> track.1.section.4 over de bus (bijInvoke: het handelingenlog en de auto-DJ zien het)',
    await totdat(`window.__bus.slice(${bus0}).some(([a, v]) => a === 'track.1.section.4' && v === true)`, 3000), JSON.stringify(await evalueer(`window.__bus.slice(${bus0})`)));
  ok('… de sectie op de maat is sectie 4', await totdat(`${deck('A')}.sectieOpDeMaat === 3`, 2000));
  const sp = await sprongOpDeMaat('A', 3);
  ok('… op de maat: dezelfde plek in de maat, sectie 4 valt in op de volgende "1" (doorlopend)', sp.ok, JSON.stringify(sp));
  // De aanloop is het eind van de maat vóór sectie 4: dan hoor je nog sectie 3 (SECTIES.md §3).
  const aanloop = await schermIs((st) => st.secties?.naar === `4 ${namen[3]}` && st.secties.hoort === `3 ${namen[2]}`, 1500);
  ok(`… in de aanloop (je hoort het eind van sectie 3): het scherm zegt "op de 1: 4 ${namen[3]}" (bit voor bit tekenScherm)`, !!aanloop);
  if (aanloop) writeFileSync(join(UIT, 'sec-maschine-scherm-aanloop.txt'), alsTekst(tekenScherm(aanloop, 0)));
  ok('… binnen een maat hoor je sectie 4', await totdat(`${deck('A')}.sectieHier === 3 && ${deck('A')}.playing`, 3000));
  const hoort = await schermIs((st) => st.secties?.hoort === `4 ${namen[3]}` && st.secties.naar === null, 3000);
  ok(`… en de kop zegt "T1 4 ${namen[3]}" (bit voor bit tekenScherm)`, !!hoort);
  if (hoort) writeFileSync(join(UIT, 'sec-maschine-scherm-hoort.txt'), alsTekst(tekenScherm(hoort, 0)));
  ok('… pad 4 wit, pad 2 weer donker hemelsblauw (HID 0x80)', await tot(() => padIs(4, PALETTE.wit) && padIs(2, PALETTE.hemelsblauwdonker), 3000),
    `pad 4 ${padKleur(4)}, pad 2 ${padKleur(2)}`);

  console.log('\neen pad zonder sectie');
  const sprongen = await evalueer('window.__sprongen.length');
  m.pad(16);
  ok(`pad 16 (er zijn er ${n}) -> track.1.section.16 over de bus; de bus zegt waarom niet en er springt niets`,
    await totdat(`window.__bus.some(([a]) => a === 'track.1.section.16') && document.getElementById('meldingen').textContent.includes('sectie 16 is er niet')`, 3000)
    && await evalueer(`window.__sprongen.length === ${sprongen}`), await evalueer("document.getElementById('meldingen').textContent.slice(0, 120)"));

  console.log('\nSCENE nog eens: weer spelen');
  m.tik('scene');
  ok('modus spelen; SCENE weer zacht', await totdat("window.maschine.modus === 'spelen'", 3000) && await tot(() => sceneLamp() === zacht));
  ok('requestMIDIAccess NOOIT aangeroepen', await evalueer('window.__midi === 0'), String(await evalueer('window.__midi')));
  await druk('track.1.play');
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
    const msg = JSON.parse(e.data);
    if (msg.id && wachtend.has(msg.id)) { const w = wachtend.get(msg.id); wachtend.delete(msg.id); msg.error ? w.fout(new Error(msg.error.message)) : w.ok(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') meldingen.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  // requestMIDIAccess telt en weigert (met ?hub= mag hij nooit geroepen worden); WebSockets tellen.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__midi = 0; window.__ws = [];
    Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true,
      value: () => { window.__midi++; return Promise.reject(new DOMException('geen MIDI in de test', 'SecurityError')); } });
    const Echt = window.WebSocket;
    window.WebSocket = class extends Echt { constructor(url, p) { super(url, p); window.__ws.push(String(url)); } };` });
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await doorloop();
  // Zonder ?hub= weigert de spion requestMIDIAccess: die fout hoort bij de test, niet bij de app.
  const echteFouten = meldingen.filter((x) => !/geen MIDI in de test/.test(x));
  ok('geen fouten in de pagina', echteFouten.length === 0, echteFouten.join(' | '));
} catch (err) {
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await echt.stop().catch(() => {});
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)${serverLog.includes('Error') ? `\nserver:\n${serverLog.slice(-1500)}` : ''}` : `\nAlles groen (${uitkomst.length} checks). Schermen als tekst in ${UIT}`);
process.exit(rood ? 1 : 0);
