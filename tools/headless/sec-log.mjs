// Secties in het handelingenlog, headless in echte Chrome (docs/HANDELINGENLOG.md,
// TASKS-SECTIES "Verweven" punt 4): een set met sectiesprongen en een sectie-loop
// opnemen, de sectiekaart op de server laten veranderen (een ander grid = een
// herberekening), en terugspelen. Dezelfde posities op de audioklok, toen tegen nu.
//
// Gemeten: in de pagina elke paar ms [ctx.currentTime, positie van track 1], tijdens
// het opnemen en tijdens het terugspelen. Log-tijd = audioklok min het begin van het
// log (kop.klok) of min T0 van het terugspelen. Buiten de sprongen zelf (±20 ms: daar
// springt het terugspelen tot een tik later) moet de positie op elke log-tijd gelijk
// zijn. Twee drukken vallen met opzet binnen de marge net na de "1" (0,02 tel): die
// vielen zonder `laat` bij terugspelen soms een maat later.
//
// Daarna een OUD log (zelfde set, zonder `secties`): dat haalt de kaart van de server,
// zoals voorheen.
//
// Zelfde opzet als secties.mjs: eigen server, tijdelijke database en media, de
// nep-yt-dlp met het synthetische nummer (test/synth-nummer.mjs), geen MIDI.
//
// Gebruik:  node tools/headless/sec-log.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8905) en VARVE_KIJK_DEBUG (9505). Chrome: VARVE_CHROME.
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
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8905, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9505;
const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-log-'));
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
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'),
    NEP_LOG: join(tmp, 'nep.log'), VARVE_STEMS_CMD: process.env.VARVE_STEMS_CMD || maakNepStems(tmp) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
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
async function foto(naam) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}
async function totdat(expr, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(150); }
  return false;
}
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const act = (expr) => evalueer(`import('/src/control/actions.js').then((a) => ${expr})`);
const druk = (id) => act(`(a.invoke(${JSON.stringify(id)}, true), a.invoke(${JSON.stringify(id)}, false))`);
const rij = (deel) => `[...document.querySelectorAll('#lib-panel .lib-rij')].find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)}))`;
/** Hoe vaak de server een sectiekaart uitrekende (een regel "[secties] <titel>: N secties"). */
const keerGerekend = () => (serverLog.match(/\[secties\] [^\n]*secties/g) || []).length;
const asciiJson = (x) => JSON.stringify(x).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Monsters in de pagina: [audioklok, positie van track 1, loop aan], elke paar ms, alleen als de klok tussen de twee lezingen niet versprong. */
const MONSTER = `(() => {
  const m = window.__monster ??= { lijst: [], h: null };
  m.start = () => { m.lijst = []; clearInterval(m.h); const ctx = window.engine.ctx, d = window.engine.deck('A');
    m.h = setInterval(() => { const c1 = ctx.currentTime, p = d.position, c2 = ctx.currentTime; if (c1 === c2) m.lijst.push([c1, p, d.loop ? 1 : 0]); }, 2); };
  m.stop = () => { clearInterval(m.h); return m.lijst; };
})()`;

/**
 * Druk `id` als de speelkop net NA een "1" staat, aan de rand van de marge van
 * 0,02 tel (tussen 0,010 en 0,019 tel, 5-9 ms bij 124 bpm): een tik later valt hij
 * erbuiten. Breder dan één stap van de audioklok (2,67 ms = 0,0055 tel), anders
 * mist de lus hem. Een MessageChannel-lus: elke paar honderd µs kijken.
 */
const drukNaDeEen = (id) => evalueer(`(async () => {
  const a = await import('/src/control/actions.js');
  const d = window.engine.deck('A'), g = d.grid, ctx = window.engine.ctx;
  return await new Promise((klaar) => {
    const mc = new MessageChannel(), t0 = performance.now();
    mc.port1.onmessage = () => {
      const tel = g.barPhase(d.position) * g.beatsPerBar;
      if (tel > 0.010 && tel < 0.019) {
        a.invoke(${JSON.stringify(id)}, true); a.invoke(${JSON.stringify(id)}, false);
        klaar({ tel, positie: d.position, klok: ctx.currentTime }); return;
      }
      if (performance.now() - t0 > 6000) { klaar(null); return; }
      mc.port2.postMessage(0);
    };
    mc.port2.postMessage(0);
  });
})()`);

/**
 * Toen tegen nu: voor elk monster van het terugspelen de positie van het origineel
 * op dezelfde log-tijd (lineair tussen twee monsters zonder sprong ertussen). Rond
 * een sprong (in een van beide) ±20 ms overslaan.
 */
function vergelijk(toen, nu, rate = 1) {
  const sprongen = (l) => {
    const j = [];
    for (let i = 1; i < l.length; i++) if (Math.abs((l[i][1] - l[i - 1][1]) - (l[i][0] - l[i - 1][0]) * rate) > 2e-3) j.push(l[i][0]);
    return j;
  };
  // Alleen na het begin van het log (vóór T0 zet de beginstand de track neer).
  const J = [...sprongen(toen), ...sprongen(nu)].filter((t) => t > 0.02);
  const uit = [];
  let j = 0;
  for (const [t, p] of nu) {
    if (J.some((x) => Math.abs(x - t) < 0.02)) continue;
    while (j < toen.length - 2 && toen[j + 1][0] < t) j++;
    const a = toen[j], b = toen[j + 1];
    if (!a || !b || !(a[0] <= t && t <= b[0])) continue;
    if (Math.abs((b[1] - a[1]) - (b[0] - a[0]) * rate) > 2e-3) continue;
    uit.push([t, p - (a[1] + (t - a[0]) * rate)]);
  }
  return { verschillen: uit, sprongenToen: sprongen(toen).filter((t) => t > 0.02), sprongenNu: sprongen(nu).filter((t) => t > 0.02) };
}

async function doorloop() {
  console.log('binnenhalen en laden');
  await evalueer(MONSTER);
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'https://www.youtube.com/watch?v=sectieLog';
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  // Ruim: onder belasting (andere bouwers, alles.mjs) duurt de ingest langer.
  ok('het nummer staat in de lijst', await totdat(rij('sectieLog'), 240000));
  await evalueer(`${rij('sectieLog')}.querySelector('button[data-deck="A"]').click()`);
  ok('op track 1', await totdat("window.engine.deck('A').duration > 150", 30000));
  ok('de secties komen van de server op het deck', await totdat("window.engine.deck('A').sectieKaart?.aantal >= 6", 60000));
  await evalueer("document.getElementById('lib-btn').click()");
  const nummer = await evalueer("fetch('/api/library').then((r) => r.json()).then((j) => j.tracks[0].id)");
  const kaartToen = await evalueer("JSON.stringify(window.engine.deck('A').sectieKaart.toJSON())");
  const k = JSON.parse(kaartToen);
  console.log(`      ${k.stukken.length} secties: ${k.stukken.map((x) => `${x.van.toFixed(2)} ${x.label} ${x.groep}`).join(' · ')}  (grid ${k.grid})`);
  ok('het grid is zeker (de sprong rekent op de maat)', await evalueer("window.engine.deck('A').gridZekerHier !== false && !!window.engine.deck('A').grid"));
  const naLaden = keerGerekend();

  console.log('\nopnemen: een set met sectiesprongen en een sectie-loop');
  await evalueer(`window.engine.setFocus('A'); window.engine.deck('A').seek(${k.stukken[1].van - 3})`);
  await druk('track.1.play');
  ok('speelt', await totdat("window.engine.deck('A').playing && window.engine.ctx.state === 'running'", 10000));
  await wacht(1000);
  await evalueer("document.getElementById('log-btn').click()");
  ok('○ log: het log loopt', await totdat('window.logboek.log.bezig', 3000));
  await evalueer('window.__monster.start()');
  await wacht(700);
  // Een kaart die net binnenkomt (zelfde inhoud, nieuw object, zoals haalSecties) en in
  // dezelfde taak een sectiedruk: in het log moet de kaart vóór de druk staan (busNaarLog).
  await evalueer(`import('/src/control/actions.js').then((a) => { const d = window.engine.deck('A');
    d.setSectieKaart(d.sectieKaart.toJSON()); a.invoke('track.1.section.4', true); a.invoke('track.1.section.4', false); })`);   // aanloop, valt in op de volgende "1"
  await wacht(2600);
  const band1 = await drukNaDeEen('track.1.section.2');             // binnen de marge: sectie 2 meteen
  ok(`pad 2 vlak na de "1" (${band1 ? `${band1.tel.toFixed(4)} tel` : 'niet gelukt'})`, band1 && band1.tel < 0.02);
  await wacht(1800);
  await druk('track.1.section.5.loop');                             // shift + pad 5: aanloop, dan de loop
  await wacht(3000);
  ok('de loop is sectie 5', (await act("a.read('track.1.section.5.loop')")) === 1);
  await druk('track.1.section.next');                               // uit de loop, naar sectie 6
  await wacht(2200);
  const band2 = await drukNaDeEen('track.1.section.prev');          // binnen de marge: vorige
  ok(`"vorige" vlak na de "1" (${band2 ? `${band2.tel.toFixed(4)} tel` : 'niet gelukt'})`, band2 && band2.tel < 0.02);
  await wacht(1500);
  await evalueer("document.getElementById('log-btn').click()");
  const toenRuw = await evalueer('window.__monster.stop()');
  for (let i = 0; i < 25 && (await evalueer('window.logboek.log.bezig')); i++) await wacht(200);
  const logs = await evalueer("fetch('/api/handelingen').then((r) => r.json()).then((j) => j.logs)");
  const id = logs[0]?.id;
  const regels = (await evalueer(`fetch('/api/handelingen/${id}').then((r) => r.text())`)).trim().split('\n').map((r) => JSON.parse(r));
  const kop = regels.find((r) => r.e === 'kop'), stand = regels.find((r) => r.e === 'stand');
  ok('het log: de kaart van track 1 in de beginstand', JSON.stringify(stand?.tracks[0].secties) === kaartToen);
  const iKaart = regels.findIndex((r) => r?.e === 'secties'), iDruk = regels.findIndex((r) => Array.isArray(r) && r[1] === 'track.1.section.4');
  ok(`een kaart die vlak vóór de druk binnenkwam staat ervóór in het log (regel ${iKaart} / ${iDruk})`, iKaart > 0 && iKaart < iDruk);
  const drukken = regels.filter((r) => Array.isArray(r) && /section/.test(r[1]) && r[2] === true);
  ok('de sectie-drukken staan erin, elk met de plek waarvan de sprong rekende', drukken.length === 5 && drukken.every((r) => Number.isFinite(r[3]?.van)),
    drukken.map((r) => `${r[0].toFixed(3)} ${r[1].replace('track.1.section.', '')} van ${r[3]?.van?.toFixed(3)}`).join(', '));
  const toen = toenRuw.map(([c, p, l]) => [c - kop.klok, p, l]);

  console.log('\nde server rekent opnieuw (ander grid), de track staat ergens anders');
  const gridNu = await evalueer(`fetch('/api/library/${nummer}/grid').then((r) => r.json()).then((j) => j.grid)`);
  const ander = { ...gridNu, stukken: gridNu.stukken.map((x) => ({ ...x, anker: x.anker + 60 / x.bpm, ...(x.maat != null ? { maat: x.maat + 60 / x.bpm } : {}) })) };
  const r = await evalueer(`fetch('/api/library/${nummer}/grid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ grid: ander }))} }).then((r) => r.status)`);
  ok('een ander grid op de server (een tel verschoven)', r === 200);
  await evalueer("window.engine.deck('A').pause(); window.engine.deck('A').seek(20); window.engine.deck('A').setSectieKaart(null)");

  console.log('\nterugspelen');
  await evalueer("document.getElementById('terug-btn').click()");
  ok('↺ toont het log', await totdat(`document.querySelector('#log-lijst [data-speel="${id}"]')`, 5000));
  await evalueer('window.__monster.start()');
  // Meekijken hoe laat elke sectiedruk de bus op gaat (de Terugspeler roept this.invoke).
  await evalueer(`(() => { const tp = window.logboek.terugspeler, bus = tp.invoke; window.__laat = [];
    tp.invoke = (a, v, o) => { if (/section/.test(a) && v === true) window.__laat.push([a, o?.laat ?? 0]); return bus(a, v, o); }; })()`);
  await evalueer(`document.querySelector('#log-lijst [data-speel="${id}"]').click(); document.querySelector('#log-lijst [data-speel="${id}"]').click()`);
  ok('terugspelen loopt', await totdat('window.logboek.terugspeler.bezig', 5000));
  ok('na de beginstand: de kaart van TOEN op track 1', await totdat(`window.logboek.terugspeler.T0 !== null && JSON.stringify(window.engine.deck('A').sectieKaart?.toJSON()) === ${JSON.stringify(kaartToen)}`, 20000));
  await foto('sec-log-terug.png');
  for (let i = 0; i < 200 && (await evalueer('window.logboek.terugspeler.bezig')); i++) await wacht(200);
  const nuRuw = await evalueer('window.__monster.stop()');
  const T0 = await evalueer('window.logboek.terugspeler.T0');
  const laatLijst = await evalueer('window.__laat');
  const tel = await evalueer("window.engine.deck('A').grid.beatLengthAt(60)");
  console.log(`      de sectiedrukken kwamen ${laatLijst.map(([a, l]) => `${a.replace('track.1.section.', '')} ${(l * 1000).toFixed(1)} ms`).join(', ')} te laat`);
  // Zonder `laat` rekende de sprong vanaf toen + laat: binnen de marge (< 0,02 tel) of een maat later?
  for (const [naam, b, l] of [['pad 2', band1, laatLijst.find(([a]) => a === 'track.1.section.2')?.[1]], ['vorige', band2, laatLijst.find(([a]) => a === 'track.1.section.prev')?.[1]]]) {
    if (!b || l == null) continue;
    const zonder = b.tel + l / tel;
    console.log(`      ${naam}: toen ${b.tel.toFixed(4)} tel na de "1", nu ${l * 1000 > 0 ? (l * 1000).toFixed(1) : 0} ms later = ${zonder.toFixed(4)} tel: zonder \`laat\` ${zonder < 0.02 ? 'nog binnen de marge' : 'BUITEN de marge (een maat later)'}`);
  }
  const nu = nuRuw.map(([c, p, l]) => [c - T0, p, l]);
  ok('de kaart bleef die van toen (niets van de server)', await evalueer(`JSON.stringify(window.engine.deck('A').sectieKaart?.toJSON()) === ${JSON.stringify(kaartToen)}`));
  ok(`de server rekende tijdens het terugspelen niets uit (${keerGerekend()} keer [secties], na het laden ${naLaden})`, keerGerekend() === naLaden);

  const { verschillen, sprongenToen, sprongenNu } = vergelijk(toen, nu);
  const ds = verschillen.map((x) => x[1]);
  const gesorteerd = [...ds].sort((a, b) => a - b);
  const mediaan = gesorteerd[Math.floor(gesorteerd.length / 2)] ?? NaN;
  const maxAbs = Math.max(...ds.map(Math.abs));
  const spreiding = gesorteerd.at(-1) - gesorteerd[0];
  console.log(`      ${toen.length} monsters toen, ${nu.length} nu, ${ds.length} vergeleken; sprongen toen ${sprongenToen.length} (${sprongenToen.map((x) => x.toFixed(3)).join(' ')}), nu ${sprongenNu.length} (${sprongenNu.map((x) => x.toFixed(3)).join(' ')})`);
  // Per stuk tussen twee sprongen van toen: het verschil (nu − toen) in ms.
  const grenzen = [-Infinity, ...sprongenToen, Infinity];
  const perStuk = [];
  for (let i = 0; i < grenzen.length - 1; i++) {
    const v = verschillen.filter(([t]) => t > grenzen[i] && t < grenzen[i + 1]).map((x) => x[1] * 1000);
    if (v.length) perStuk.push(`${Math.min(...v).toFixed(1)}..${Math.max(...v).toFixed(1)}`);
  }
  console.log(`      verschil nu − toen per stuk (ms): ${perStuk.join(' | ')}`);
  ok(`evenveel sprongen toen als nu (${sprongenToen.length} / ${sprongenNu.length})`, sprongenToen.length === sprongenNu.length && sprongenToen.length >= 5);
  // De sprongtijden zijn gemeten op de monsters (elke ~4 ms, en de audioklok loopt in
  // stappen van 128 frames = 2,67 ms; een monster kan ook wachten op de taak die drukt):
  // een tik later plus die korrel.
  ok(`elke sprong nu op hetzelfde moment, op een tik en de meetkorrel na (${sprongenNu.map((x, i) => `${((x - sprongenToen[i]) * 1000).toFixed(1)}`).join(' ')} ms)`,
    sprongenNu.every((x, i) => x - sprongenToen[i] > -0.02 && x - sprongenToen[i] < 0.025));
  // Een maat is hier 1,9 s. Wat overblijft is de korrel van de audioklok (2,67 ms): de
  // beginstand, en per sprong als de klok tikt tussen positie lezen en het segment zetten
  // (gemeten: 0 tot 8 ms, het meest onder belasting). Grens: vijf stappen, spreiding drie.
  ok(`dezelfde positie op de audioklok: mediaan ${(mediaan * 1000).toFixed(2)} ms, hooguit ${(maxAbs * 1000).toFixed(2)} ms, spreiding ${(spreiding * 1000).toFixed(2)} ms`,
    ds.length > 500 && maxAbs < 0.0135 && spreiding < 0.0081);

  console.log('\neen oud log (zonder secties): de kaart van de server, zoals voorheen');
  const serverKaart = await evalueer(`fetch('/api/library/${nummer}/secties?maak=1').then((r) => r.json()).then((j) => j.secties)`);
  ok(`de server heeft nu een andere kaart (grid ${serverKaart?.grid} / toen ${k.grid})`, serverKaart && serverKaart.grid !== k.grid);
  // Zoals een log van vóór 6 okt: geen `secties` (stand en gebeurtenis), en een druk zonder plek.
  const oud = regels.filter((x) => x?.e !== 'secties').map((x) => (Array.isArray(x) ? x.slice(0, 3)
    : x?.e === 'stand' ? { ...x, tracks: x.tracks.map(({ secties: _s, ...t }) => t) } : x));
  const start = await evalueer(`fetch('/api/handelingen/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json())`);
  const tekst = oud.map(asciiJson).join('\n') + '\n';
  const st = await evalueer(`fetch('/api/handelingen/${start.id}/stuk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ van: 0, tekst }))} }).then((r) => r.status)`);
  ok('het oude log staat op de server', start.ok && st === 200);
  // Eerst gewoon laden (zoals bij Clay: het nummer staat er, niet uit een terugspelen);
  // dan weet je zeker dat het terugspelen het opnieuw laadt.
  await evalueer(`(async () => { const { track } = await (await fetch('/api/library/${nummer}')).json(); await window.library.onLaad('A', track); })()`);
  await totdat(`window.engine.deck('A').sectieKaart?.grid === ${JSON.stringify(serverKaart?.grid)}`, 20000);
  await evalueer("window.engine.deck('A').pause(); window.engine.deck('A').seek(30); window.engine.deck('A').setSectieKaart(null)");
  await evalueer("document.getElementById('terug-btn').click()");
  await totdat(`document.querySelector('#log-lijst [data-speel="${start.id}"]')`, 5000);
  await evalueer(`document.querySelector('#log-lijst [data-speel="${start.id}"]').click(); document.querySelector('#log-lijst [data-speel="${start.id}"]').click()`);
  ok('terugspelen loopt', await totdat('window.logboek.terugspeler.bezig', 5000));
  ok('de kaart komt van de server (zoals voorheen)', await totdat(`window.engine.deck('A').sectieKaart?.grid === ${JSON.stringify(serverKaart?.grid)}`, 20000),
    await evalueer("window.engine.deck('A').sectieKaart?.grid ?? 'geen'"));
  await evalueer("document.getElementById('terug-btn').click()");     // stoppen
  await totdat('!window.logboek.terugspeler.bezig', 3000);
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
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start', await totdat('window.engine && window.videoMixer && window.logboek', 20000));
  await doorloop();
  ok('geen fouten in de pagina', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto in ${UIT}`);
process.exit(rood ? 1 : 0);
