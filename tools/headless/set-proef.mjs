// Spoor S9 (docs/PLAN-SET.md), headless in Chromium: een set klaarzetten en opslaan, wijzigen en
// terugladen, met de stand nagekeken. EIGEN server op een eigen poort, alles in een tijdelijke map
// (VARVE_TESTSERVER=1, VARVE_DB/MEDIA/OPNAMES/PLANNEN/PATRONEN/SETS/STANDEN/WERKRUIMTES). Geen MIDI,
// geen netwerk.
//
//  1. Klaarzetten in het planvenster (los, alleen editor) met twaalf nummers: de HANDELINGEN geteld
//     (klikken en toetsen) tot een plan van twaalf stappen op de server staat.
//  2. De mixer: twee synthetische nummers op track 1 en 3, faders, filter, positie, cue; een plan en
//     patronen op de server. "bewaar set" met de mixer. Dan alles veranderen. Dan "laad set": de
//     stand is weer gelijk (nummers, posities, waarden, plan, patronen), en er speelt niets.
//  3. Over een spelende track: de eerste druk vraagt, de tweede binnen 3 s laadt.
//
// Gebruik:  VARVE_CHROME=<chrome> node tools/headless/set-proef.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8931) en VARVE_KIJK_DEBUG (9531).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Library } from '../../server/library.js';
import { synthNummer, PLAN } from '../../test/synth-nummer.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8931, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9531;
if ([8777, 7700].includes(POORT) || [8777, 7700].includes(DEBUG)) throw new Error('8777 en 7700 zijn van de echte mixer en de hub');
const tmp = mkdtempSync(join(tmpdir(), 'varve-set-proef-'));
for (const d of ['plannen', 'patronen', 'sets', 'media/syna', 'media/synb']) mkdirSync(join(tmp, d), { recursive: true });
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- de library: twee echte (synthetische) nummers en tien voor het planvenster ----------------
function wav(mix) {
  const n = mix.length, y = new Int16Array(n * 2);
  let piek = 1e-9;
  for (const x of mix) piek = Math.max(piek, Math.abs(x));
  for (let i = 0; i < n; i++) y[2 * i] = y[2 * i + 1] = Math.round(32767 * 0.8 * mix[i] / piek);
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(2, 22);
  kop.writeUInt32LE(48000, 24); kop.writeUInt32LE(48000 * 4, 28); kop.writeUInt16LE(4, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  return Buffer.concat([kop, Buffer.from(y.buffer)]);
}
const kort = PLAN.slice(0, 4);
const sa = synthNummer({ sr: 48000, plan: kort, zaad: 3 }), sb = synthNummer({ sr: 48000, plan: kort, zaad: 9 });
writeFileSync(join(tmp, 'media/syna/audio.wav'), wav(sa.mix));
writeFileSync(join(tmp, 'media/synb/audio.wav'), wav(sb.mix));
const TOON = ['Am', 'Em', 'Bm', 'C', 'G', 'D', 'Am', 'Em', 'Dm', 'F', 'C', 'G'];
{
  const lib = new Library(join(tmp, 'lib.db'));
  for (const [id, s] of [['syna', sa], ['synb', sb]]) {
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: s.duur, audio: `media/${id}/audio.wav`, video: null,
      thumbnail: null, loudness: { I: -14 }, doelLoudness: -14, ytdlp: 'x' });
    lib.bewaarGrid(id, { ...s.grid, bron: 'hand' });
    lib.bewaarToon(id, { stukken: [{ van: 0, toonsoort: 'Am', zekerheid: 0.9 }], bron: 'hand' });
  }
  for (let i = 0; i < 10; i++) {
    const id = `nr${String(i + 1).padStart(2, '0')}`;
    lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: `nummer ${i + 1}`, uploader: 't', duur: 300 + i * 10, audio: `media/${id}/audio.wav`,
      video: null, thumbnail: null, loudness: { I: -20 + i }, doelLoudness: -14, ytdlp: 'x' });
    lib.bewaarGrid(id, { stukken: [{ van: 0, bpm: 112 + i * 3, anker: 0, zekerheid: 0.9 }], bron: 'hand' });
    lib.bewaarToon(id, { stukken: [{ van: 0, toonsoort: TOON[i], zekerheid: 0.9 }], bron: 'hand' });
  }
  lib.sluit();
}
writeFileSync(join(tmp, 'plannen', 'proef.json'), JSON.stringify({ naam: 'proef', tracks: { auto: [1, 2] },
  stappen: [{ id: 's1', track: 'syna' }, { id: 's2', track: 'synb', go: 'wacht', lagen: [{ soort: 'sampler', pad: 1, op: { sec: 20 } }] }] }));
writeFileSync(join(tmp, 'patronen', 'set.json'), JSON.stringify({ naam: 'set', tempo: 126 }));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return execFileSync('which', [naam], { encoding: 'utf8' }).trim(); } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  cwd: WORTEL,
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_SETS: join(tmp, 'sets'),
    VARVE_STANDEN: join(tmp, 'standen'), VARVE_WERKRUIMTES: join(tmp, 'werkruimtes'), VARVE_PROEF: join(tmp, 'proef'), VARVE_BACKUPS: join(tmp, 'backups'),
    VARVE_NACHT: join(tmp, 'nacht.json'), VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_HERANALYSE: 'uit' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const meldingen = [];
function cdp(method, params = {}) {
  const id = ++volg;
  ws.send(JSON.stringify({ id, method, params }));
  // Een antwoord dat nooit komt (een evaluate tijdens het navigeren) laat de proef niet hangen.
  return new Promise((ok, fout) => {
    const t = setTimeout(() => { wachtend.delete(id); fout(new Error(`${method}: geen antwoord binnen 20 s`)); }, 20000);
    wachtend.set(id, { ok: (x) => { clearTimeout(t); ok(x); }, fout: (e) => { clearTimeout(t); fout(e); } });
  });
}
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function foto(naam) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}
const tot = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(`!!(${expr})`).catch(() => false)) return true; await wacht(150); } return false; };
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const api = (pad, opties) => fetch(`http://localhost:${POORT}${pad}`, opties).then((r) => r.json());
let handelingen = 0;
/** Een klik zoals een gebruiker (telt als één handeling). */
const klik = async (sel) => { handelingen++; return ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.click(); return true; })()`); };
const toets = async (key, extra = {}) => {
  handelingen++;
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), ...extra });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), ...extra });
};

/** De stand zoals Clay hem zou nakijken: per track nummer, positie, fader, filter, cue; het plan; de patronen. */
const STAND = `(async () => {
  const e = window.engine, k = window.varvePlan;
  const tracks = ['A', 'B', 'C', 'D'].map((id, i) => { const d = e.deck(id);
    return { nr: i + 1, titel: d.buffer ? d.title : null, pos: Math.round(d.position * 10) / 10, speelt: !!d.playing || !!d.wacht,
      fader: Math.round(d.ui.fader * 100) / 100, filter: Math.round(d.ui.filter * 100) / 100, cue: Math.round((d.cuePoint ?? 0) * 10) / 10 }; });
  const p = await fetch('/api/plannen/' + k.naam()).then((r) => r.json());
  const pt = await fetch('/api/patronen/set').then((r) => r.json());
  return { tracks, plan: k.naam(), stappen: (p.plan?.stappen || []).map((s) => s.track + (s.go ? ':go' : '')).join(','), tempo: pt.set?.tempo ?? null };
})()`;

async function klaarzetten() {
  console.log('1. klaarzetten in het planvenster: twaalf nummers');
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/plan.html?plan=vrijdag` });
  ok('het planvenster opent (leeg plan "vrijdag")', await tot("window.varvePlanVenster && document.querySelectorAll('.pl-bieb .rij').length === 12", 15000));
  handelingen = 0;
  await klik('.pl-sel-alles');                       // 1: alles in de selectie (of: een krat kiezen)
  await klik('.pl-maakset');                         // 2: maak set (boog)
  ok('twaalf stappen in een boog', await tot("window.varvePlanVenster.plan.stappen.length === 12"));
  await toets('s', { modifiers: 2 });                 // 3: ctrl+s opslaan (vanuit de mixer doet "gebruik dit plan" dit meteen)
  ok('opgeslagen op de server', await tot("document.querySelector('.pl-status').textContent === 'opgeslagen'", 8000));
  const opSchijf = JSON.parse(readFileSync(join(tmp, 'plannen', 'vrijdag.json'), 'utf8'));
  ok(`een set van twaalf nummers in ${handelingen} handelingen (kiezen, maak set, opslaan)`, opSchijf.stappen.length === 12 && handelingen === 3,
    opSchijf.stappen.map((s) => s.track).join(' '));
  const eerste = opSchijf.stappen[0].track, piek = opSchijf.stappen.findIndex((s) => s.track === 'nr10');
  ok(`de boog: rustig begin (${eerste}), de luidste/snelste op ~70% (plek ${piek + 1})`, ['syna', 'synb', 'nr01', 'nr02', 'nr03'].includes(eerste) && piek >= 6 && piek <= 10);
  // Per stap snel: 2 = blend op de gekozen stap, G = wacht op GO.
  await ev("document.querySelectorAll('.pl-rij')[3].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true");
  await toets('2'); await toets('g');
  const s4 = await ev('window.varvePlanVenster.plan.stappen[3]');
  ok(`toets 2 = blend en G = GO op de gekozen stap (${s4.overgang}, ${s4.go})`, s4.overgang === 'blend' && s4.go === 'wacht');
  await ev("(() => { const i = document.querySelector('.pl-auto-tracks'); i.value = '1,2'; i.dispatchEvent(new Event('change')); return true; })()");
  ok('tracks van de automaat: 1,2', await ev("JSON.stringify(window.varvePlanVenster.plan.tracks) === '{\"auto\":[1,2]}'"));
  ok('de klaar-kolom staat er (G T S § V per nummer)', await tot("document.querySelectorAll('.pl-klaar').length === 12", 8000));
  await foto('set-planvenster.png');
  await toets('s', { modifiers: 2 });                 // opslaan (niet geteld): anders vraagt het venster bij weggaan
  ok('weer opgeslagen, met tracks en GO', await tot("document.querySelector('.pl-status').textContent === 'opgeslagen'", 8000)
    && JSON.parse(readFileSync(join(tmp, 'plannen', 'vrijdag.json'), 'utf8')).stappen[3].go === 'wacht');
}

async function mixer() {
  console.log('\n2. de mixer: bewaren, wijzigen, terugladen');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess; try { localStorage.setItem('varve.plan.actief', 'proef'); } catch (_) {}" });
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start, met window.varveSets (de aanhaker set)', await tot('window.engine && window.auto && window.varveSets && window.varvePlan', 30000));
  await ev('window.engine.resume().then(() => true)');
  const lib = (await api('/api/library?aantal=500')).tracks;
  const a = lib.find((t) => t.id === 'syna'), b = lib.find((t) => t.id === 'synb');
  await ev(`(async () => { await window.auto.laad('A', ${JSON.stringify(a)}); await window.auto.laad('C', ${JSON.stringify(b)}); return true; })()`);
  ok('syna op track 1, synb op track 3', await tot("window.engine.deck('A').buffer && window.engine.deck('C').buffer", 20000));
  const inv = (id, v) => ev(`(() => { window.varvePlan.invoke(${JSON.stringify(id)}, ${JSON.stringify(v)}); return true; })()`);
  await inv('track.1.fader', 0.7); await inv('track.3.fader', 0.4); await inv('track.3.filter', 0.3);
  await inv('track.1.seek', 0.25); await inv('track.3.seek', 0.5);
  await ev("(() => { window.engine.deck('A').cuePoint = 12.5; return true; })()");
  const voor = await ev(STAND);
  ok(`de stand vóór: ${JSON.stringify(voor.tracks.filter((t) => t.titel))}, plan ${voor.plan} (${voor.stappen}), tempo ${voor.tempo}`, voor.plan === 'proef' && voor.tempo === 126);
  const bew = await ev("window.varveSets.zetMetMoment(true), window.varveSets.bewaar('vrijdag').then((r) => r.ok)");
  const bestand = existsSync(join(tmp, 'sets', 'vrijdag.json')) ? JSON.parse(readFileSync(join(tmp, 'sets', 'vrijdag.json'), 'utf8')) : null;
  ok(`set bewaard: sets/vrijdag.json met plan, patronen en de mixer (${bestand?.momentopname?.tracks?.length} tracks)`, bew && bestand?.plan?.stappen?.length === 2
    && bestand.patronen?.set?.tempo === 126 && bestand.momentopname?.tracks?.some((t) => t.nummer === 'syna'));
  ok('... geen audio in de set, alleen verwijzingen (tracks.id)', !JSON.stringify(bestand).includes('audio.wav'));

  // Alles anders: ander nummer op 1, faders, positie, een ander plan, andere patronen.
  await ev(`(async () => { await window.auto.laad('A', ${JSON.stringify(b)}); return true; })()`);
  await tot("window.engine.deck('A').title === 'synb'", 15000);
  await inv('track.1.fader', 0.1); await inv('track.3.fader', 1); await inv('track.3.filter', 0.5); await inv('track.3.seek', 0.1);
  await api('/api/plannen/ander', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: { stappen: [{ track: 'nr01' }] }, versie: null }) });
  await ev("window.varvePlan.gebruik('ander').then(() => true)");
  const pv = await api('/api/patronen/set');
  await api('/api/patronen/set', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: { ...pv.set, tempo: 90 }, versie: pv.versie }) });
  const tussen = await ev(STAND);
  ok(`alles anders (${JSON.stringify(tussen.tracks[0])}, plan ${tussen.plan}, tempo ${tussen.tempo})`, tussen.tracks[0].titel === 'synb' && tussen.plan === 'ander' && tussen.tempo === 90);

  const r = await ev("window.varveSets.terugladen('vrijdag', { metMoment: true })");
  ok(`terugladen zonder spelende track: meteen (${JSON.stringify(r)})`, r.ok && !r.vraag);
  await tot("window.engine.deck('A').title === 'syna'", 15000);
  await wacht(800);
  const na = await ev(STAND);
  const zelfde = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const verschil = na.tracks.map((t, i) => (zelfde(t, voor.tracks[i]) ? null : `${t.nr}: ${JSON.stringify(voor.tracks[i])} → ${JSON.stringify(t)}`)).filter(Boolean);
  ok(`de stand is weer gelijk: tracks${verschil.length ? ` (${verschil.join('; ')})` : ''}`, !verschil.length);
  ok(`... het plan "vrijdag" is actief met de stappen van de set (${na.plan}: ${na.stappen})`, na.plan === 'vrijdag' && na.stappen === voor.stappen);
  ok(`... de patronen van de set (tempo ${na.tempo})`, na.tempo === 126);
  ok('... en er speelt niets', na.tracks.every((t) => !t.speelt));
  await wacht(4500);
  ok('... en de patronen botsen niet (de mixer nam de set over, review S9 b6)', await ev('!(window.patronenPaneel?.opslag?.stand?.().botsing)'));

  console.log('\n3. over een spelende track: de tweede druk');
  await inv('track.1.play', true);
  await tot("window.engine.deck('A').playing", 5000);
  if (!(await ev('window.varveSets.st.metMoment'))) await inv('set.moment', true);   // "met mixer" aan
  await ev("(() => { window.varveSets.st.gekozen = 'vrijdag'; return true; })()");
  await inv('set.terugladen', true); await inv('set.terugladen', false);
  await wacht(300);
  ok('eerste druk: hij vraagt, track 1 speelt nog', await ev("window.varveSets.stand().vraag && window.engine.deck('A').playing"));
  await inv('set.terugladen', true); await inv('set.terugladen', false);
  ok('tweede druk binnen 3 s: teruggeladen, er speelt niets', await tot("!window.engine.deck('A').playing && !window.varveSets.stand().bezig", 15000));
  await foto('set-mixer.png');
}

try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://localhost:${DEBUG}/json/list`); const l = await r.json(); const p = l.find((x) => x.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch (_) {} await wacht(200); }
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Page.javascriptDialogOpening') cdp('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await klaarzetten();
  await mixer();
  // Fouten die bij een proefserver horen: geen video, geen peaks van de tien nep-nummers.
  const echt = meldingen.filter((m) => !/404|Failed to load resource|peaks|video/i.test(m));
  ok('geen fouten in de pagina', echt.length === 0, echt.join(' | '));
} catch (err) {
  ok('script liep door', false, err.stack);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await wacht(300);
  if (uitkomst.some(([, g]) => !g)) console.log(serverLog.split('\n').slice(-25).join('\n'));
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Foto's in ${UIT}`);
process.exit(rood ? 1 : 0);
