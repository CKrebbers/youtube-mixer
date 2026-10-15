// De server mag even weg zijn (docs/WINST.md punt 3, spoor D): een echte mixer in een headless
// Chromium tegen een EIGEN server, twee decks streamend en hoorbaar, opname en handelingenlog aan.
// Dan de server SIGKILL, 30 s weg, en opnieuw starten (met dezelfde mappen, zoals de herstartlus).
// Met VARVE_WEG_SOORT=hang (16 okt, docs/verslagen/2026-10-15/ar-proef.md): de server HANGT (SIGSTOP),
// 30 s, en loopt dan door (SIGCONT): de poort blijft open, verzoeken krijgen geen antwoord (time-out).
//
// De eisen:
//   - 0 stille vensters van 50 ms op engine.master.analyser terwijl een deck speelt
//     (wat je hoort houdt 60 s vooruit, stream-kern.js VOORUIT_HOORBAAR);
//   - een WAV zonder gat (geen reeks nullen van 10 ms of langer) en precies zo lang als de opname;
//   - het handelingenlog zonder gat (geen NUL-bytes) en met zijn eind-regel;
//   - hooguit één opname-melding (sleutel 'opname', opname-knop.js), die "weer goed" wordt.
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in dit tabblad, eigen server op een eigen
// poort (VARVE_TESTSERVER=1), ALLE mappen in een tijdelijke map.
//
// Gebruik:  node tools/headless/server-weg.mjs
//   VARVE_WEG_S      hoe lang de server weg is (standaard 30)
//   VARVE_WEG_SOORT  kill (standaard: SIGKILL en opnieuw starten) of hang (SIGSTOP, dan SIGCONT)
//   VARVE_WEG_KOPIE  een map: de opnames (WAV, log, mp4) gaan daarheen vóór het opruimen (voor tools/proef/ar-na.mjs)
//   VARVE_CODE       een andere checkout (server en pagina komen daarvandaan: vóór en na meten)
//   VARVE_KIJK_POORT / VARVE_KIJK_DEBUG  poorten (standaard 8961 / 8962)
//   VARVE_CHROME     Chromium; anders de headless shell uit de Playwright-cache, anders op het pad
// Exitcode 0 = alle eisen gehaald.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = process.env.VARVE_CODE || fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8961, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 8962;
const B = `http://localhost:${POORT}`;
const WEG_S = Number(process.env.VARVE_WEG_S) || 30;
const HANG = process.env.VARVE_WEG_SOORT === 'hang';
const tmp = mkdtempSync(join(tmpdir(), 'varve-serverweg-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)} s] ${a.join(' ')}`);

function zoekChrome() {
  if (process.env.VARVE_CHROME) return { pad: process.env.VARVE_CHROME, shell: /headless.shell/.test(process.env.VARVE_CHROME) };
  for (const cache of [join(homedir(), 'Library/Caches/ms-playwright'), '/opt/pw-browsers', join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(cache)) continue;
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    if (!shell) continue;
    const map = join(cache, shell);
    for (const sub of readdirSync(map)) {
      for (const naam of ['chrome-headless-shell', 'headless_shell']) if (existsSync(join(map, sub, naam))) return { pad: join(map, sub, naam), shell: true };
    }
  }
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return { pad: execFileSync('which', [naam], { encoding: 'utf8' }).trim(), shell: false }; } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}

// Alle mappen in tmp: een testserver schrijft nooit in de echte media/, opnames/, patronen/ …
const ENV = { ...process.env, PORT: String(POORT), VARVE_TESTSERVER: '1', VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
  VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
  VARVE_BACKUPS: join(tmp, 'backups'), VARVE_PROEF: join(tmp, 'proef'), VARVE_STANDEN: join(tmp, 'standen'),
  VARVE_SETS: join(tmp, 'sets'), VARVE_SJABLONEN: join(tmp, 'eigen.json'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'),
  VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_NACHT: join(tmp, 'nacht.json'),
  VARVE_HERANALYSE: 'uit' };
let server = null;
let serverUit = '';
function startServer() {
  server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { serverUit += d; });
  server.stderr.on('data', (d) => { serverUit += d; });
}
const antwoordt = () => fetch(`${B}/api/proef`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false);

startServer();
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900', '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

/** De langste reeks frames waarin beide kanalen precies 0 zijn, en het aantal reeksen ≥ `min` frames. */
function nulReeksen(buf, kop, min) {
  let langste = 0, lopend = 0, reeksen = 0;
  for (let o = kop; o + 4 <= buf.length; o += 4) {
    if (buf.readInt16LE(o) === 0 && buf.readInt16LE(o + 2) === 0) { lopend++; if (lopend === min) reeksen++; if (lopend > langste) langste = lopend; }
    else lopend = 0;
  }
  return { langste, reeksen };
}

let code = 1;
const eisen = [];
const eis = (naam, goed) => { eisen.push([naam, goed]); log(`${goed ? 'GOED' : 'FOUT'}  ${naam}`); };
try {
  let lijst = null;
  for (let i = 0; i < 100 && !lijst?.find?.((x) => x.type === 'page'); i++) { await wacht(200); lijst = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(lijst.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const x = wachtend.get(m.id); wachtend.delete(m.id); m.error ? x.f(new Error(m.error.message)) : x.ok(m.result); }
    if (m.method === 'Inspector.targetCrashed') log('RENDERER GECRASHT');
    if (m.method === 'Runtime.exceptionThrown') log('uitzondering:', (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Inspector.enable').catch(() => {});
  // Geen MIDI in dit tabblad (veilig met de APC aangesloten); het handelingenlog altijd aan.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess; try { localStorage.setItem('varve.log.altijd', '1') } catch {}" });
  for (let i = 0; i < 100 && !(await antwoordt()); i++) await wacht(200);

  // Twee nummers van 3 min, altijd hoorbaar (een stille plek zou als "stil venster" tellen),
  // via de upload-route: dezelfde pijplijn als altijd.
  const nummers = [];
  for (let k = 0; k < 2; k++) {
    const pad = join(tmp, `n${k}.wav`);
    const f = 220 + 37 * k;
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
      `aevalsrc=0.5*sin(2*PI*55*t)*exp(-12*mod(t\\,0.483871))+0.2*sin(2*PI*${f}*t)|0.5*sin(2*PI*55*t)*exp(-12*mod(t\\,0.483871))+0.2*sin(2*PI*${f * 1.5}*t):s=48000:d=180`,
      '-c:a', 'pcm_s16le', pad]);
    const up = await fetch(`${B}/api/upload?naam=weg${k}.wav&video=0&titel=weg${k}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: readFileSync(pad) }).then((r) => r.json());
    let nr = null;
    for (let i = 0; i < 2400 && !nr; i++) {
      await wacht(250);
      const o = (await fetch(`${B}/api/ingest`).then((r) => r.json())).opdrachten.find((x) => x.id === up.id);
      if (o?.status === 'klaar') nr = o.track.id;
      if (o?.status === 'mislukt') throw new Error(`ingest mislukt: ${JSON.stringify(o)}`);
    }
    nummers.push(nr);
  }
  log('twee nummers binnen:', nummers.join(', '));

  await cdp('Page.navigate', { url: `${B}/?vormen=0` });
  for (let i = 0; i < 200; i++) { if (await ev('!!(window.engine && window.library)').catch(() => false)) break; await wacht(100); }
  await wacht(1500);
  await ev('window.engine.resume()');
  await ev(`(async () => {
    window.__a = await import('/src/control/actions.js');
    // De stiltemeter op de master (na de limiter): elke 50 ms een venster, alleen terwijl een deck speelt.
    const an = window.engine.master.analyser, buf = new Float32Array(an.fftSize);
    window.__stil = { stil: 0, n: 0, langste: 0, lopend: 0 };
    setInterval(() => {
      const e = window.engine, s = window.__stil;
      if (!['A', 'B'].some((id) => e.deck(id).playing) || e.ctx.state !== 'running') { s.lopend = 0; return; }
      an.getFloatTimeDomainData(buf);
      let q = 0; for (let i = 0; i < buf.length; i++) q += buf[i] * buf[i];
      s.n++;
      if (Math.sqrt(q / buf.length) < 1e-4) { s.stil++; s.lopend += 50; s.langste = Math.max(s.langste, s.lopend); } else s.lopend = 0;
    }, 50);
    // Elke opname-melding die ooit op het scherm kwam (nieuw element), en elke tekst die hij had.
    window.__meld = { nieuw: 0, teksten: [], max: 0, alle: [] };
    const strook = document.getElementById('meldingen');
    const kijk = () => {
      // Elke melding, van wie ook (de opname, het log, de audio, de stream …): wat ziet Clay op het scherm?
      for (const m of strook.children) { const t = m.firstChild?.textContent || ''; if (t && !window.__meld.alle.includes(t)) window.__meld.alle.push(t); }
      const op = [...strook.children].filter((m) => !m.classList.contains('weg') && /^opname/.test(m.firstChild?.textContent || ''));
      window.__meld.max = Math.max(window.__meld.max, op.length);
      for (const m of op) { const t = m.firstChild.textContent; if (window.__meld.teksten.at(-1) !== t) window.__meld.teksten.push(t); }
    };
    new MutationObserver((lijst) => {
      for (const r of lijst) for (const n of r.addedNodes) if (n.nodeType === 1 && /^opname/.test(n.firstChild?.textContent || '')) window.__meld.nieuw++;
      kijk();
    }).observe(strook, { childList: true, subtree: true, characterData: true });
  })()`);
  const laad = (deck, nr) => ev(`(async () => { const { track } = await (await fetch('/api/library/${nr}')).json(); await window.library.onLaad('${deck}', track); return !!window.engine.deck('${deck}').bron?.bestand; })()`);
  log('laad A', await laad('A', nummers[0]), '· laad B', await laad('B', nummers[1]));
  await ev("__a.invoke('track.1.fader', 0.9); __a.invoke('track.2.fader', 0.9); __a.invoke('mixer.xfader', 0.5); "
    + "__a.invoke('track.1.play', true); __a.invoke('track.1.play', false); __a.invoke('track.2.play', true); __a.invoke('track.2.play', false)");
  await ev("__a.invoke('record.start', true); __a.invoke('record.start', false)");
  // Even laten lopen: de opname schrijft, de decks halen hun minuut vooruit binnen.
  await wacht(6000);
  const stand = () => ev(`JSON.stringify((() => { const e = window.engine, d = (id) => e.deck(id);
    const vooruit = (id) => { const b = d(id).bron; if (!b?.geladen) return null; const p = b.positie, sr = 48000, P = 65536;
      let n = 0; while (b.geladen.has(Math.floor(p * sr / P) + n + 1)) n++; return +(n * P / sr).toFixed(1); };
    return { A: { speelt: d('A').playing, pos: +d('A').position.toFixed(1), vooruit: d('A').vooruit, binnen: vooruit('A'), mb: +(d('A').bron.geheugen / 1e6).toFixed(1) },
      B: { speelt: d('B').playing, pos: +d('B').position.toFixed(1), vooruit: d('B').vooruit, binnen: vooruit('B'), mb: +(d('B').bron.geheugen / 1e6).toFixed(1) },
      opname: window.opnemer ? { s: +window.opnemer.seconden.toFixed(1), wacht: window.opnemer.wachtSeconden, verloren: window.opnemer.verloren } : null,
      log: window.logboek?.log?.bezig ?? null, stil: window.__stil, meld: window.__meld.teksten.slice(-2) }; })())`);
  const voor = JSON.parse(await stand());
  log('voor de kill:', JSON.stringify(voor));
  eis(`beide decks hoorbaar: 60 s vooruit (A ${voor.A.vooruit}, B ${voor.B.vooruit}), ${voor.A.binnen} s en ${voor.B.binnen} s binnen`,
    voor.A.vooruit === 60 && voor.B.vooruit === 60 && voor.A.binnen > WEG_S + 10 && voor.B.binnen > WEG_S + 10);

  log(HANG ? `SERVER HANGT (SIGSTOP), ${WEG_S} s` : `SERVER SIGKILL, ${WEG_S} s weg`);
  server.kill(HANG ? 'SIGSTOP' : 'SIGKILL');
  const tKill = Date.now();
  const kloktijd = (d) => d.toTimeString().slice(0, 8);
  const storingVan = kloktijd(new Date(tKill));
  while (Date.now() - tKill < WEG_S * 1000) {
    await wacht(5000);
    const s = JSON.parse(await stand());
    log(`  weg +${((Date.now() - tKill) / 1000).toFixed(0)} s: A ${s.A.pos}/${s.A.binnen} s · B ${s.B.pos}/${s.B.binnen} s · stil ${s.stil.stil} · opname wacht ${s.opname?.wacht} s · melding "${s.meld.at(-1) ?? ''}"`);
  }
  if (HANG) { log('SERVER LOOPT DOOR (SIGCONT)'); server.kill('SIGCONT'); }
  else { log('SERVER WEER AAN (dezelfde mappen, zoals de herstartlus)'); startServer(); }
  const tStart = Date.now();
  while (!(await antwoordt()) && Date.now() - tStart < 15000) await wacht(100);
  log(`server antwoordt na ${Date.now() - tStart} ms · de storing op de klok: ${storingVan}-${kloktijd(new Date())} (voor ar-na --venster)`);
  for (let i = 0; i < 6; i++) {
    await wacht(2000);
    const s = JSON.parse(await stand());
    log(`  terug +${((Date.now() - tStart) / 1000).toFixed(0)} s: A ${s.A.binnen} s · B ${s.B.binnen} s vooruit · stil ${s.stil.stil} · opname wacht ${s.opname?.wacht} s · melding "${s.meld.at(-1) ?? ''}"`);
  }
  const na = JSON.parse(await stand());
  // De meldingen tot hier: wat stop daarna meldt ("opname bewaard") is een eigen gebeurtenis.
  const meld = JSON.parse(await ev('JSON.stringify(window.__meld)'));

  // Stoppen en nakijken: de opname (WAV) en het log.
  await ev("__a.invoke('record.stop', true); __a.invoke('record.stop', false)");
  for (let i = 0; i < 100; i++) { if (!(await ev('window.opnemer?.bezig ?? false'))) break; await wacht(200); }
  await wacht(3000);
  const opnameS = na.opname?.s;
  const map = join(tmp, 'opnames');
  const wav = readdirSync(map).find((f) => f.endsWith('.wav'));
  const jsonl = readdirSync(map).find((f) => f.endsWith('.acties.jsonl'));
  const buf = readFileSync(join(map, wav));
  const kop = buf.toString('latin1', 36, 40) === 'data' ? 44 : 80;
  const wavS = (buf.length - kop) / 192000;
  const nul = nulReeksen(buf, kop, 480);
  const stil = JSON.parse(await ev('JSON.stringify(window.__stil)'));
  const meldNa = JSON.parse(await ev('JSON.stringify(window.__meld)'));
  const tekst = jsonl ? readFileSync(join(map, jsonl), 'latin1') : '';
  log(`opname ${wav}: ${wavS.toFixed(2)} s (de opnemer telde ${opnameS} s vóór stop), langste reeks nullen ${(nul.langste / 48).toFixed(2)} ms`);
  log(`meldingen van de opname tot stop: ${meld.nieuw} nieuw, hooguit ${meld.max} tegelijk; daarna bij stop: "${meldNa.teksten.at(-1)}"`);
  log(`  teksten: ${JSON.stringify(meld.teksten)}`);
  log(`alle meldingen op het scherm (ook na stop): ${JSON.stringify(meldNa.alle)}`);

  eis(`0 stille vensters van 50 ms terwijl een deck speelt (${stil.stil} van ${stil.n}, langste ${stil.langste} ms)`, stil.stil === 0 && stil.n > 500);
  eis(`de decks speelden door (A ${voor.A.pos} → ${na.A.pos} s, B ${voor.B.pos} → ${na.B.pos} s)`, na.A.speelt && na.B.speelt && na.A.pos - voor.A.pos > WEG_S);
  eis(`na de herstart weer een minuut vooruit (A ${na.A.binnen} s, B ${na.B.binnen} s)`, na.A.binnen > 50 && na.B.binnen > 50);
  eis(`WAV zonder gat: geen reeks nullen van 10 ms (${nul.reeksen} reeksen, langste ${(nul.langste / 48).toFixed(2)} ms)`, nul.reeksen === 0);
  eis(`WAV even lang als de opname (${wavS.toFixed(2)} s, ≥ ${opnameS} s), niets kwijt (${na.opname?.verloren} s)`, wavS >= opnameS && na.opname?.verloren === 0);
  eis(`handelingenlog zonder gat en met eind-regel (${tekst.length} bytes)`, tekst.length > 0 && !tekst.includes('\0') && /"e":"eind"/.test(tekst));
  eis(`hooguit één opname-melding (${meld.nieuw} nieuw, ${meld.max} tegelijk), en die werd "weer goed"`,
    meld.nieuw <= 1 && meld.max <= 1 && meld.teksten.some((t) => /weer goed, niets verloren/.test(t)));
  code = eisen.every(([, g]) => g) ? 0 : 1;
  log(code === 0 ? 'ALLE EISEN GEHAALD' : `${eisen.filter(([, g]) => !g).length} EIS(EN) NIET GEHAALD`);
} catch (err) {
  log('AFGEBROKEN', err.stack);
  if (serverUit) log('server-uitvoer (staart):\n' + serverUit.slice(-2000));
} finally {
  try { ws?.close(); } catch {}
  browser.kill('SIGKILL');
  server?.kill('SIGKILL');
  await wacht(300);
  if (process.env.VARVE_WEG_KOPIE && existsSync(join(tmp, 'opnames'))) cpSync(join(tmp, 'opnames'), process.env.VARVE_WEG_KOPIE, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  process.exit(code);
}
