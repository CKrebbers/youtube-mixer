// Verdringen de video's de audio? (docs/WINST.md punt 2, verslag 2026-10-14/winst-snel.md)
//
// Acht decks die spelen, met het videopaneel open (acht zichtbare video's), en
// 30 sprongen: om de 1,5 s een ander deck naar een willekeurige plek. Chrome
// opent over HTTP/1.1 hooguit 6 verbindingen per host; een <video> die een
// minuut vooruit buffert houdt er een vast, en dan wachten de audiopagina's.
// Gemeten:
//   - wachttijd van een audioverzoek vóór het verzonden wordt (p50/p90/max)
//   - sprong -> pagina binnen (p50/p90/max; 5000 = niet binnen 5 s)
//   - gat: hoe lang een spelend deck op een plek stond zonder pagina (per deck)
//   - de video's: readyState, gepauzeerd, buffer vooruit
// Doel na de knip: p90 onder 300 ms, geen gat boven 1 s.
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in dit tabblad, eigen
// server op een eigen poort, een tijdelijke database.
//
// Gebruik:  node tools/headless/acht-video.mjs
//   VARVE_ACHT_MEDIA  een media-map met library.db en nummers MET video (bv. een
//                     kopie van je eigen). Er wordt niets in geschreven: de
//                     database wordt gekopieerd (VACUUM INTO), de nummermappen
//                     gelinkt. Zonder: acht synthetische nummers van 150 s met
//                     ruisbeeld (~3 Mbit/s, zoals YouTube 720p), via de upload-route
//                     (de ingest codeert ze: reken op een paar minuten per nummer).
//   VARVE_ACHT_VIDEO  open (standaard: paneel open, alles zichtbaar) · dicht · geen (geen video)
//   VARVE_CODE        een andere checkout om te meten (vóór/na met hetzelfde script)
//   VARVE_KIJK_POORT / VARVE_KIJK_DEBUG  poorten (standaard 8883 / 9383)
//   VARVE_CHROME      Chrome MET H.264 (Chrome for Testing; de Chromium van
//                     Playwright speelt geen mp4). Anders google-chrome op het pad.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const WORTEL = process.env.VARVE_CODE || fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8883, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9383;
const B = `http://localhost:${POORT}`;
const VIDEO = process.env.VARVE_ACHT_VIDEO || 'open';
const tmp = mkdtempSync(join(tmpdir(), 'varve-acht-'));
const media = join(tmp, 'media');
mkdirSync(media, { recursive: true });
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  for (const naam of ['google-chrome-stable', 'google-chrome', 'chromium']) {
    try { return execFileSync('which', [naam], { encoding: 'utf8' }).trim(); } catch (_) {}
  }
  throw new Error('geen Chrome gevonden (zet VARVE_CHROME)');
}

// Een bestaande media-map: database kopiëren, nummers met video linken.
let ids = [];
if (process.env.VARVE_ACHT_MEDIA) {
  const bron = process.env.VARVE_ACHT_MEDIA;
  const db = new DatabaseSync(join(bron, 'library.db'), { readOnly: true });
  db.exec(`VACUUM INTO '${join(media, 'library.db').replace(/'/g, "''")}'`);
  ids = db.prepare('SELECT id FROM tracks WHERE video IS NOT NULL ORDER BY toegevoegd LIMIT 8').all().map((r) => r.id);
  db.close();
  for (const id of ids) symlinkSync(join(bron, id), join(media, id));
  if (ids.length < 8) console.log(`let op: maar ${ids.length} nummers met video in ${bron}`);
}

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(media, 'library.db'), VARVE_MEDIA: media,
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_BACKUPS: join(tmp, 'backups'), VARVE_PROEF: join(tmp, 'proef'), VARVE_STANDEN: join(tmp, 'standen'),
    VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const browser = spawn(zoekChrome(), [
  '--headless=new', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`, 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const luisteraars = [];
const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN; };

let code = 1;
try {
  for (let i = 0; i < 100; i++) { if (await fetch(`${B}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  if (!ids.length) {
    // Acht synthetische nummers met ruisbeeld (ruis comprimeert slecht: ~3 Mbit/s, zoals echte video).
    console.log('acht nummers maken en binnenhalen (geen VARVE_ACHT_MEDIA)…');
    const opdrachten = [];
    for (let k = 0; k < 8; k++) {
      const pad = join(tmp, `n${k}.mp4`);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=30:d=150,noise=alls=${20 + k}:allf=t`,
        '-f', 'lavfi', '-i', `aevalsrc=0.5*sin(2*PI*${55 + k}*t)*exp(-10*mod(t\\,0.5)):s=48000:d=150`, '-ac', '2',
        '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '3M', '-g', '250', '-c:a', 'aac', '-shortest', pad]);
      const r = await fetch(`${B}/api/upload?naam=acht-${k}.mp4&titel=acht-${k}`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: readFileSync(pad) }).then((x) => x.json());
      opdrachten.push(r.id);
    }
    for (let i = 0; i < 7200 && ids.length < 8; i++) {
      await wacht(500);
      const lijst = (await fetch(`${B}/api/ingest`).then((r) => r.json())).opdrachten;
      ids = opdrachten.map((id) => lijst.find((o) => o.id === id)).filter((o) => o?.status === 'klaar').map((o) => o.track.id);
      if (lijst.some((o) => opdrachten.includes(o.id) && o.status === 'mislukt')) throw new Error('ingest mislukt');
    }
  }

  let lijst = null;
  for (let i = 0; i < 100 && !lijst?.find?.((x) => x.type === 'page'); i++) { await wacht(200); lijst = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(lijst.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const x = wachtend.get(m.id); wachtend.delete(m.id); m.error ? x.f(new Error(m.error.message)) : x.ok(m.result); } else for (const f of luisteraars) f(m);
  });
  await cdp('Page.enable'); await cdp('Network.enable'); await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  const vz = new Map();
  luisteraars.push((m) => {
    const p = m.params;
    if (m.method === 'Network.requestWillBeSent') vz.set(p.requestId, { url: p.request.url, t: p.timestamp });
    if (m.method === 'Network.responseReceived') {
      const v = vz.get(p.requestId);
      if (v) { v.conn = p.response.connectionId; v.proto = p.response.protocol; const tm = p.response.timing; if (tm) v.wacht = (tm.requestTime + tm.sendStart / 1000 - v.t) * 1000; }
    }
  });
  await cdp('Page.navigate', { url: `${B}/?vormen=0` });
  for (let i = 0; i < 400; i++) { if (await ev('!!(window.engine && window.library && window.videoMixer)').catch(() => false)) break; await wacht(25); }
  await wacht(2000);
  await ev(`(async () => { window.__act = await import('/src/control/actions.js'); await window.engine.resume(); await window.library.ververs();
    ${ids.map((id, k) => `await window.library.laad(${JSON.stringify(id)}, '${'ABCDEFGH'[k]}');`).join('\n')}
    for (let k = 1; k <= ${ids.length}; k++) __act.invoke('track.' + k + '.fader', 1);
    __act.invoke('mixer.xfader', 0.5);
    return true; })()`);
  // Elke 10 ms: staat een spelend deck op een plek waarvan de pagina er niet is?
  await ev(`(() => { window.__gat = {}; const P = 65536;
    window.__probe = setInterval(() => { for (const id of 'ABCDEFGH'.slice(0, ${ids.length})) { const d = window.engine.deck(id); const b = d.bron; if (!b?.bestand || !d.playing) continue;
      const p = Math.floor(d.position * 48000 / P); if (!b.geladen.has(p)) window.__gat[id] = (window.__gat[id] || 0) + 10; } }, 10); return true; })()`);
  if (VIDEO === 'geen') await ev(`(() => { for (const id of 'ABCDEFGH') window.videoMixer.zetBron(id, null); return true; })()`);
  if (VIDEO === 'open') await ev(`(document.getElementById('video-btn').click(), true)`);
  await wacht(1500);
  await ev(`(() => { for (let k = 1; k <= ${ids.length}; k++) { __act.invoke('track.' + k + '.play', true); __act.invoke('track.' + k + '.play', false); } return true; })()`);
  await wacht(5000);
  vz.clear();
  await ev('(window.__gat = {}, true)');
  const sprongen = [];
  for (let s = 0; s < 30; s++) {
    const deck = 'ABCDEFGH'[s % ids.length];
    sprongen.push(await ev(`(async () => { const d = window.engine.deck('${deck}'); const doel = 10 + Math.random() * (d.duration - 30); const P = 65536; const p = Math.floor(doel * 48000 / P);
      const t = performance.now(); d.seek(doel); while (!d.bron.geladen.has(p)) { await new Promise((z) => setTimeout(z, 2)); if (performance.now() - t > 5000) return 5000; } return performance.now() - t; })()`));
    await wacht(1500);
  }
  const gat = await ev('window.__gat');
  const vids = await ev(`[...window.videoMixer.lagen.values()].map((l) => l.video).map((v) => ({ rs: v.readyState, p: v.paused, buf: v.buffered.length ? +(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1) : 0 }))`);
  const alle = [...vz.values()];
  const audio = alle.filter((v) => /\/(audio|stems)\.wav/.test(v.url));
  const video = alle.filter((v) => /video\.mp4/.test(v.url));
  const wachtAudio = audio.map((v) => v.wacht).filter((x) => x != null);
  const gatMax = Math.max(0, ...Object.values(gat));
  console.log(`acht-video: VIDEO=${VIDEO}, ${ids.length} decks, ${[...new Set(alle.map((v) => v.proto).filter(Boolean))].join(',')}`);
  console.log(`  audio wacht vóór verzenden: p50 ${q(wachtAudio, 0.5).toFixed(0)} ms · p90 ${q(wachtAudio, 0.9).toFixed(0)} ms · max ${Math.max(...wachtAudio).toFixed(0)} ms (${audio.length} verzoeken; video ${video.length}; verbindingen ${new Set(alle.map((v) => v.conn).filter(Boolean)).size})`);
  console.log(`  sprong -> pagina binnen: p50 ${q(sprongen, 0.5).toFixed(0)} ms · p90 ${q(sprongen, 0.9).toFixed(0)} ms · max ${Math.max(...sprongen).toFixed(0)} ms (5000 = niet binnen 5 s)`);
  console.log(`  gat per deck (ms zonder pagina): max ${gatMax} · ${JSON.stringify(gat)}`);
  console.log(`  video's: ${JSON.stringify(vids)}`);
  code = 0;
} catch (e) {
  console.error('fout', e.stack);
} finally {
  try { browser.kill('SIGKILL'); } catch (_) {}
  try { server.kill('SIGKILL'); } catch (_) {}
  await wacht(300);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(code);
}
