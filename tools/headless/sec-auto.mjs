// De auto-DJ met secties, headless in Chrome (docs/AUTO-DJ.md §3b): twee
// nummers met secties via de ingest, de kaart van de server, en de automaat
// die op de INTRO van de nieuwe inmixt en op de OUTRO van de oude uitmixt,
// niet midden in een drop (waar het oude moment zonder secties zou vallen).
//
// Zelfde opzet als secties.mjs: een EIGEN server op een eigen poort met een
// tijdelijke database en mediamap, de nep-yt-dlp (test/nep-ytdlp.mjs) met een
// synthetisch nummer met een bekend antwoord (test/synth-nummer.mjs, hier met
// een outro van 24 maten zodat een blend van 16 maten erin past), en de
// nep-splitter. Het grid zetten we op het bekende antwoord (zeker), zodat de
// secties op dat grid gerekend worden. Geen netwerk, geen Python, geen MIDI.
//
// Gebruik:  node tools/headless/sec-auto.mjs [uitmap]   (~2 minuten: de overgang speelt echt)
// Poorten:  VARVE_KIJK_POORT (8901) en VARVE_KIJK_DEBUG (9501). Chrome: VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';
import { maakNepStems } from '../../test/nep-stems.mjs';
import { synthNummer, PLAN } from '../../test/synth-nummer.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8901, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9501;
const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-auto-'));
mkdirSync(UIT, { recursive: true });
// Een eigen (lege) map met setplannen: anders ziet de planKoppeling plannen/auto-plan.json
// van de werkmap als een nieuwe versie en vervangt hij het plan van deze proef.
mkdirSync(join(tmp, 'plannen'), { recursive: true });

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// Het bekende antwoord: intro 8, deel 16, opbouw 8, drop 16, break 8, drop 16, outro 24 maten op 124 bpm.
const plan = PLAN.map((p) => (p[0] === 'outro' ? [p[0], p[1], 24, p[3], p[4], p[5]] : p));
const s = synthNummer({ sr: 48000, plan });
const OUTRO = s.grenzen[6], DROP2 = [s.grenzen[5], s.grenzen[6]];
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
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'),
    NEP_LOG: join(tmp, 'nep.log'), VARVE_STEMS_CMD: process.env.VARVE_STEMS_CMD || maakNepStems(tmp) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
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
const rij = (deel) => `[...document.querySelectorAll('#lib-panel .lib-rij')].find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)}))`;
const api = (pad, opties) => fetch(`http://localhost:${POORT}${pad}`, opties).then((r) => r.json());

async function doorloop() {
  console.log('twee nummers binnenhalen');
  await evalueer("document.getElementById('lib-btn').click()");
  for (const v of ['secautoA', 'secautoB']) {
    await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'https://www.youtube.com/watch?v=${v}';
      v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    ok(`${v} staat in de lijst`, await totdat(rij(v), 90000));
  }
  const { tracks } = await api('/api/library?aantal=500');
  const idA = tracks.find((t) => /secautoA/.test(t.titel))?.id, idB = tracks.find((t) => /secautoB/.test(t.titel))?.id;
  ok(`twee nummers in de library (${idA}, ${idB})`, idA && idB && idA !== idB);
  // Het grid op het bekende antwoord (zeker); de secties worden bij het laden op dit grid gerekend.
  for (const id of [idA, idB]) {
    await api(`/api/library/${id}/grid`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grid: s.grid }) });
  }
  // De kaarten vooraf laten rekenen: dit kijkt naar de KEUZE. De race (kaart pas na
  // het laden) zit in test/auto-secties.test.mjs; op een drukke machine kost een
  // kaart hier tot ~5 s, en dan plant de automaat eerst zonder en daarna opnieuw.
  for (const id of [idA, idB]) {
    const r = await api(`/api/library/${id}/secties?maak=1`);
    ok(`de kaart van ${id} is gerekend (${r.secties?.stukken?.length} stukken)`, r.secties?.stukken?.length >= 5);
  }
  await evalueer("document.getElementById('lib-btn').click()");

  console.log('\nde automaat met een plan van twee stappen (A vanaf 110 s, in de tweede drop; dan B)');
  await evalueer(`(async () => {
    const a = window.auto, e = window.engine;
    a.haalPlan = async () => ({ naam: 'secties', stappen: [{ track: ${JSON.stringify(idA)}, van: 110, waarom: 'tweede drop' }, { track: ${JSON.stringify(idB)}, waarom: 'op de outro' }] });
    // Wanneer de nieuwe begint te spelen, en waar de oude dan is (zijn tracktijd).
    window.__in = null;
    a.on('change', () => {
      const v = a.volgende;
      if (!v || window.__in || !a.hoofd) return;
      const n = e.deck(v.deckId);
      if (n.playing && !n.wacht) window.__in = { oud: e.deck(a.hoofd).position, nieuw: n.position, fase: a.fase };
    });
    window.__stil = { max: 0, sinds: null };
    setInterval(() => {
      const p = e.masterPeak(), nu = e.ctx.currentTime, s = window.__stil;
      if (!a.aan || !a.hoofd) return;
      if (p < 0.003) { s.sinds ??= nu; s.max = Math.max(s.max, nu - s.sinds); } else s.sinds = null;
      const v = a.volgende;
      if (v && !window.__in && a.fase === 'bezig') { const n = e.deck(v.deckId); if (n.playing && !n.wacht) window.__in = { oud: e.deck(a.hoofd).position, nieuw: n.position, fase: a.fase }; }
    }, 20);
    await e.resume();
    return true;
  })()`);
  await evalueer("document.getElementById('auto-btn').click(), true");
  await evalueer(`(() => { const el = document.querySelector('[data-action="auto.aan"]'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  ok('aan: B staat klaar', await totdat("window.auto.fase === 'klaar' && window.auto.volgende", 60000));
  const st = await evalueer(`(async () => {
    const a = window.auto, e = window.engine, v = a.volgende, d = e.deck(a.hoofd);
    const P = await import('/src/auto/planner.js');
    const kaartA = (d.sectieKaart || a._kaartVan(a.hoofd))?.stukken?.map((x) => ({ van: x.van, label: x.label, groep: x.groep })) ?? null;
    const kaartB = (e.deck(v.deckId).sectieKaart || a._kaartVan(v.deckId))?.stukken?.map((x) => ({ van: x.van, label: x.label, groep: x.groep })) ?? null;
    const zonder = P.planMoment({ type: v.overgang.type, grid: d.grid, positie: a.geschiedenis.at(-1)?.van ?? 110, eind: a.eind, rate: d.rate, vooruit: 8, lengte: v.lengte });
    return { type: v.overgang.type, moment: v.moment, inSectie: v.inSectie, van: v.van, kaartA, kaartB, zonder, eind: a.eind,
      redenen: a.stand().volgende.redenen, titel: document.querySelector('#auto .au-volgende').title };
  })()`);
  if (!st.kaartA || !st.kaartB) console.log('      server: ' + (serverLog.match(/\[secties\][^\n]*/g) || []).join(' | '));
  console.log('      kaart A: ' + (st.kaartA || []).map((x) => `${x.van.toFixed(2)} ${x.label} ${x.groep}`).join(' · '));
  console.log('      verwacht: ' + s.grenzen.map((g, i) => `${g.toFixed(2)} ${plan[i][0]}`).join(' · '));
  ok(`de secties van beide nummers komen van de server (${st.kaartA?.length} en ${st.kaartB?.length} stukken)`, st.kaartA?.length >= 5 && st.kaartB?.length >= 5);
  ok(`de overgang is een blend (zeker grid, zelfde tempo en toon): ${st.type}`, st.type === 'blend');
  const sectieOp = (t) => st.kaartA.reduce((k, x) => (x.van <= t + 1e-3 ? x : k), st.kaartA[0]);
  ok(`uit op de OUTRO van A: ${st.moment.start.toFixed(2)} s (sectie ${st.moment.sectie?.sectie} ${st.moment.sectie?.label}; de outro begint op ${OUTRO.toFixed(2)})`,
    st.moment.sectie?.label === 'outro' && Math.abs(st.moment.start - OUTRO) < 0.6);
  const midden = (t) => { const x = sectieOp(t); return x.label === 'drop' && t > x.van + 0.05; };
  ok(`niet midden in een drop (zonder secties: ${st.zonder.start.toFixed(2)} s, ${midden(st.zonder.start) ? 'midden in de drop' : 'geen drop'} ${DROP2.map((x) => x.toFixed(1)).join('–')})`,
    !midden(st.moment.start) && midden(st.zonder.start));
  ok(`in op de INTRO van B: vanaf ${st.van.toFixed(2)} s (${st.inSectie?.label} ${st.inSectie?.groep}), de eerste "1"`, st.inSectie?.label === 'intro' && Math.abs(st.van - s.grid.stukken[0].anker) < 0.05);
  // De rij tekent op zijn eigen tempo: even wachten tot de tooltip bij is.
  const tip = await totdat("/uit op outro/.test(document.querySelector('#auto .au-volgende').title) && /in op intro/.test(document.querySelector('#auto .au-volgende').title)", 5000);
  ok(`de tooltip van de AUTO-rij legt het uit ("${st.redenen.slice(-2).join('" · "')}")`, tip && st.redenen.some((r) => /uit op outro/.test(r)));
  await foto('sec-auto-klaar.png');

  console.log('\nde overgang speelt');
  const begon = await totdat('window.__in', 60000);
  const klaar = begon && await totdat("window.auto.geschiedenis.filter((g) => g.wat === 'gespeeld').length >= 2", 60000);
  const na = await evalueer(`(() => { const a = window.auto, e = window.engine; const g = a.geschiedenis.filter((x) => x.wat === 'gespeeld');
    return { in: window.__in, gespeeld: g.map((x) => ({ titel: x.titel, gekozen: x.gekozen })), spelend: ['A', 'B', 'C', 'D'].filter((id) => e.deck(id).playing),
      hoofd: a.hoofd }; })()`);
  ok(`B begon te spelen toen A op ${na.in?.oud?.toFixed(2)} s was: op de "1" van de outro (blend: sync en start op de maat)`,
    begon && Math.abs(na.in.oud - st.moment.start) < 0.6 && Math.abs(na.in.oud - OUTRO) < 0.8);
  ok(`... vanaf zijn intro (${na.in?.nieuw?.toFixed(2)} s)`, begon && na.in.nieuw < 3);
  ok(`de overgang is klaar: B klinkt alleen (${na.gespeeld.map((x) => `${x.titel}: ${x.gekozen}`).join(' · ')}; spelend ${na.spelend.join(',')})`,
    klaar && na.gespeeld[1]?.gekozen === 'blend' && na.spelend.length === 1 && na.spelend[0] === na.hoofd);
  const stil = await evalueer('window.__stil.max');
  ok(`nooit dode lucht: langste stilte op de master ${(stil * 1000).toFixed(0)} ms`, stil < 0.3);
  await foto('sec-auto-na.png');
  await evalueer(`(() => { const el = document.querySelector('[data-action="auto.aan"]'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
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
  ok('de app start, zonder MIDI', await totdat('window.engine && window.auto && !navigator.requestMIDIAccess', 20000));
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
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
