// Crossover, verdieping (10 okt, proefpunt `cx-stems` in de speellijst): werkt de keten
// sampler → drumpad ook met een GESTREAMD library-nummer MET STEMS, precies zoals op
// avond 2/3? Alle eerdere metingen (sampler-drums.mjs) gebruikten de demotrack in het
// geheugen zonder stems. Hier: een synthetisch library-nummer in een tijdelijke
// database (audio.wav + stems.wav met vier stems, elke stem een eigen toon), geladen
// met `laadStream` van de echte server (Range-verzoeken, de echte worklet), de stems
// weggezet met de bestaande stem-kills, 2 tellen geknipt in sampler-pad 1, dan
// `samplerNaarDrums` (sampler.1.drums) op drumpad 13 en gemeten in de ECHTE Web
// Audio van Chrome (OfflineAudioContext, 48 kHz, de hele engine met master en limiter).
//
//  a. samplerNaarDrums: ok, pad 13, noot 48, gewichten [1, 0, 0, 0] en stemNamen
//     precies STEM_STANDEN[4] (deck.js)
//  b. de melding (drumMelding uit actions.js) bevat "stems: drums"
//  c. Goertzel op de render van drie noteOn(48)-aanslagen: alleen de drums-toon
//     (110 Hz), bas/overig/zang (220/440/880 Hz) elk ≥ 40 dB lager; als controle
//     dezelfde knip ZONDER kills in pad 2: daar zitten alle vier de tonen in
//  d. de drumpad-render tegen dezelfde knip als nummer op een deck (zelfde strip,
//     zelfde master): correlatie > 0,99 (zoals check 1b van sampler-drums.mjs), en het
//     niveauverschil = NIVEAU van de Drums × de crossfader: track 1 staat op kant A
//     (−3 dB in het midden), de Drums op track 8 op thru; met track 1 op thru blijft
//     alleen de +2,1 dB van de Drums over
//  e. deck.buffer is gevuld bij een StreamBron-deck (uit de library), en sampler.neem
//     weigert niet (knippen gaat via bron.knip: een Range-verzoek op stems.wav)
//  f. de kosten: sampler.neem (knip over het netwerk) en samplerNaarDrums (laadPad), ms
//  g. met het nummer spelend op track 1 (fader dicht): maatBpm 124, geen tempowaarschuwing
//
// VEILIG: eigen headless shell, eigen server op een eigen poort (8801/9401, vooraf
// vrij), ALLES van de server in een tijdelijke map (database, media, opnames, patronen,
// plannen, proef, kaart, nacht, nep-yt-dlp: geen netwerk), geen requestMIDIAccess, de
// pagina is /styles.css (de app start niet). De echte media/library.db wordt niet
// aangeraakt. De tijdelijke map blijft staan (het pad staat in de uitvoer).
// Gebruik: VARVE_TMP=<kladmap> node tools/headless/sampler-drums-stems.mjs [uitmap]
//          (VARVE_KIJK_POORT 8801, VARVE_KIJK_DEBUG 9401)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';
import { Library } from '../../server/library.js';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8801, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9401;
const KLAD = process.env.VARVE_TMP || tmpdir();
mkdirSync(KLAD, { recursive: true });
const tmp = mkdtempSync(join(KLAD, 'varve-sampler-drums-stems-'));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
// De server mag NIETS buiten de tijdelijke map raken: niet de echte media/ en niet de
// werkmap. Een symlink zou dat verbergen, dus de echte paden vergelijken.
const echtTmp = realpathSync(tmp), echtWortel = realpathSync(WORTEL);
if (echtTmp.startsWith(echtWortel) || /Youtube mixer/.test(echtTmp)) throw new Error(`tijdelijke map ${echtTmp} ligt in de werkmap: stop`);

// Beide poorten moeten vrij zijn (een wees-Chrome of een andere proefserver staat anders in de weg).
for (const p of [POORT, DEBUG]) {
  let bezet = '';
  try { bezet = execFileSync('lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN'], { encoding: 'utf8' }); } catch (_) { /* niets = vrij */ }
  if (bezet.trim()) throw new Error(`poort ${p} is bezet:\n${bezet}`);
}

// ---- het synthetische library-nummer --------------------------------------------
// 48 kHz, 16-bit, 8 s, 124 bpm (tel 483,9 ms), firstBeat 0. Per stem een eigen toon:
// drums 110 Hz met een hann-omhullende per tel (pulserend, zoals een slag; de
// zijbanden liggen op ±2 Hz, dus niets lekt naar 220), bas 220, overig 440, zang 880
// doorlopend. audio.wav = de som van de vier (zoals Demucs: de som is het origineel).
const SR = 48000, BPM = 124, DUUR = 8, FRAMES = SR * DUUR;
const NAMEN = ['drums', 'bass', 'other', 'vocals'];
const TONEN = { drums: 110, bass: 220, other: 440, vocals: 880 };
const ID = 'stemsproef';
function stemmen() {
  const tel = 60 / BPM;
  const uit = {};
  for (const n of NAMEN) {
    const x = new Float32Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) {
      const t = i / SR;
      const env = n === 'drums' ? 0.5 * (1 - Math.cos(2 * Math.PI * ((t / tel) % 1))) : 1;
      x[i] = (n === 'drums' ? 0.3 : 0.2) * env * Math.sin(2 * Math.PI * TONEN[n] * t);
    }
    uit[n] = x;
  }
  return uit;
}
/** Stereoparen naast elkaar, 16 bit interleaved (docs/STEMS.md §1); L = R. */
function wav(paren) {
  const n = paren[0].length, ch = paren.length * 2;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < paren.length; k++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(paren[k][i] * 32767)));
    b.writeInt16LE(v, o); b.writeInt16LE(v, o + 2); o += 4;
  }
  return b;
}
{
  const st = stemmen();
  const som = new Float32Array(FRAMES);
  for (const n of NAMEN) for (let i = 0; i < FRAMES; i++) som[i] += st[n][i];
  const map = join(tmp, 'media', ID);
  mkdirSync(map, { recursive: true });
  writeFileSync(join(map, 'audio.wav'), wav([som]));
  writeFileSync(join(map, 'stems.wav'), wav(NAMEN.map((n) => st[n])));
  const stemsJson = { versie: 1, model: 'synthetisch', aantal: 4, namen: NAMEN, schaal: 1, frames: FRAMES, sr: SR, apparaat: 'synthetisch', gemaakt: new Date().toISOString() };
  writeFileSync(join(map, 'stems.json'), JSON.stringify(stemsJson, null, 1));
  // In de tijdelijke database via de library-API, vóór de server start: nummer, grid, stems.
  const lib = new Library(join(tmp, 'lib.db'));
  lib.bewaarTrack({ id: ID, url: `https://example.com/${ID}`, titel: 'stemsproef 124', uploader: 'proef', duur: DUUR,
    audio: `media/${ID}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  lib.bewaarGrid(ID, { bpm: BPM, firstBeat: 0 });
  lib.bewaarStems(ID, { ...stemsJson, bestand: `media/${ID}/stems.wav` });
  const t = lib.track(ID);
  lib.sluit();
  if (!t?.stems?.bestand || !t?.grid) throw new Error(`het nummer staat niet goed in de database: ${JSON.stringify(t)}`);
}

function zoekChrome() {
  if (process.env.VARVE_CHROME) return { pad: process.env.VARVE_CHROME, shell: false };
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    if (shell) {
      const map = join(cache, shell);
      const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
      if (sub) return { pad: join(map, sub, 'chrome-headless-shell'), shell: true };
    }
  }
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return { pad: execFileSync('which', [naam], { encoding: 'utf8' }).trim(), shell: false }; } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit',
    VARVE_PROEF: join(tmp, 'proef'), VARVE_BACKUPS: join(tmp, 'backups'),
    VARVE_KAART: join(tmp, 'kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'), VARVE_NACHT: join(tmp, 'nacht.json'),
    VARVE_YTDLP: maakNepYtdlp(tmp) },
  stdio: 'ignore',
});
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
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
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const meld = (tekst) => console.log(`   ·  ${tekst}`);

/** Gedeeld door elke meting in de pagina: engine op een OfflineAudioContext, Goertzel. */
const VOORAF = `
  const SR = 48000, NAMEN = ${JSON.stringify(NAMEN)}, TONEN = ${JSON.stringify(TONEN)}, ID = ${JSON.stringify(ID)};
  const maakEngine = async (kanalen, lengte) => {
    const Echt = window.AudioContext;
    window.AudioContext = class extends OfflineAudioContext { constructor() { super({ numberOfChannels: kanalen, length: lengte, sampleRate: SR }); } };
    try { const { Engine } = await import('/src/engine/engine.js'); const e = new Engine(); await e.master.klaar; return e; } finally { window.AudioContext = Echt; }
  };
  const goertzel = (x, hz) => {
    const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / x.length;
  };
  const tonen = (x) => Object.fromEntries(NAMEN.map((n) => [n, goertzel(x, TONEN[n])]));
  /** Het nummer uit de library (zoals laden.js laadLibrary: stems.wav als het stems heeft), op deck id. */
  const laadUitLibrary = async (e, id) => {
    const { track } = await (await fetch('/api/library/' + ID)).json();
    const d = e.deck(id);
    const t0 = performance.now();
    const geladen = await d.laadStream('/' + track.stems.bestand.replace(/^\\//, ''), track.titel, { stems: { namen: track.stems.namen, schaal: track.stems.schaal } });
    const laadMs = performance.now() - t0;
    d.setGrid(track.grid || null);
    return { track, d, geladen, laadMs };
  };
`;

/**
 * De hoofdmeting: het nummer gestreamd op track 1 (deck A) met de stems bas/overig/zang
 * weg, 2 tellen in sampler-pad 1, zonder kills in pad 2 (controle), pad 1 → drumpad 13
 * van de Drums op track 8 (deck H), drie aanslagen op noot 48, render.
 */
const meet = (s) => evalueer(`(async () => {
  ${VOORAF}
  const s = ${JSON.stringify(s)};
  const e = await maakEngine(2, Math.round(s.duur * SR));
  const ctx = e.ctx;
  const { StreamBron } = await import('/src/engine/bron.js');
  const { STEM_STANDEN } = await import('/src/engine/deck.js');
  const { drumMelding } = await import('/src/control/actions.js');
  const { faderGain } = await import('/src/engine/audio-graph.js');
  const { UIT_OPHOGING } = await import('/src/engine/instrumenten/drums.js');
  const { track, d: dA, geladen, laadMs } = await laadUitLibrary(e, 'A');
  e.setFocus('A');
  const stream = { geladen, laadMs, isStream: dA.bron instanceof StreamBron, buffer: !!dA.buffer, duur: dA.duration, stems: dA.stems ? { ...dA.stems, namen: [...dA.stems.namen] } : null, grid: !!dA.grid, bpm: dA.grid?.bpmAt(0) ?? null };
  // De bestaande stem-kills (track.1.stem.<s>.kill → deck.setStemKill): alles weg behalve drums.
  for (const n of ['bass', 'other', 'vocals']) dA.setStemKill(n, true);
  const gewichtenNu = dA.knipGewichten();
  // 2 tellen, eindigend op tel 4 (de laatste hele tel vóór de positie), zoals sampler.1 op de focus-track.
  dA.seek(4 * 60 / 124 + 0.01);
  e.sampler.tellen = 2;
  const t1 = performance.now();
  let neemFout = null;
  try { await e.sampler.neem(0, dA, { bron: 1 }); } catch (err) { neemFout = err.message; }
  const neemMs = performance.now() - t1;
  // Controle: dezelfde knip zonder kills in pad 2.
  for (const n of ['bass', 'other', 'vocals']) dA.setStemKill(n, false);
  await e.sampler.neem(1, dA, { bron: 1 });
  for (const n of ['bass', 'other', 'vocals']) dA.setStemKill(n, true);
  const sp = e.sampler.pads[0], sp2 = e.sampler.pads[1];
  const padInfo = (p) => p ? { frames: p.buffer.length, van: p.van, tot: p.tot, bpm: p.bpm, tellen: p.tellen, gewichten: p.gewichten, stemNamen: p.stemNamen,
    tonen: tonen(p.buffer.getChannelData(0)) } : null;
  // De Drums op track 8, zoals op de proefavond; de focus blijft op het nummer.
  e.zetInstrument('H', 'drums');
  const inst = e.instrumentOp('H');
  await inst.start();
  const t2 = performance.now();
  const r = e.samplerNaarDrums(0, { pad: 13 });
  const padMs = performance.now() - t2;
  const melding = r.ok ? drumMelding(0, r) : null;
  e.deck('H').set('fader', 1);
  dA.set('fader', 0);
  const gepland = [];
  for (const t of s.tijden) { inst.noteOn(48, s.v, t); gepland.push(t); }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  window.__render = window.__render || {};
  window.__render.drum = { L: L.slice(), sb: sp.buffer.getChannelData(0).slice(), sbR: sp.buffer.getChannelData(1).slice(), t: s.tijden[0] };
  // Per aanslag: de tonen over 0,9 s vanaf de aanslag (de knip is 0,97 s), en de correlatie met het ruwe stuk (beste vertraging).
  const sL = sp.buffer.getChannelData(0);
  const lang = Math.min(sL.length - 200, Math.round(0.4 * SR)), na = 200;
  const perAanslag = gepland.map((t) => {
    const k0 = Math.round(t * SR);
    const venster = L.subarray(k0, Math.min(L.length, k0 + Math.round(0.9 * SR)));
    let beste = { lag: -1, corr: -2, gain: 0 };
    for (let lag = 0; lag <= 400; lag++) {
      let xy = 0, xx = 0, yy = 0;
      for (let j = na; j < lang; j++) { const x = sL[j], y = L[k0 + lag + j] ?? 0; xy += x * y; xx += x * x; yy += y * y; }
      const c = xy / Math.sqrt(xx * yy || 1);
      if (c > beste.corr) beste = { lag, corr: c, gain: xy / (xx || 1) };
    }
    return { t, tonen: tonen(venster), ...beste };
  });
  let piek = 0; for (let i = 0; i < L.length; i++) piek = Math.max(piek, Math.abs(L[i]), Math.abs(R[i]));
  return { stream, track: { audio: track.audio, stems: track.stems, grid: track.grid }, gewichtenNu, neemFout, neemMs, padMs, pad1: padInfo(sp), pad2: padInfo(sp2),
    r, melding, STEM4: STEM_STANDEN[4], perAanslag, heel: tonen(L), piek, fouten: inst.fouten,
    xfade: { fader: e.xfader, kantA: e.kant.A, kantH: e.kant.H, gainA: e.xfadeGain('A'), gainH: e.xfadeGain('H') },
    verwacht: Math.pow(s.v, 1.5) * faderGain(inst.leesParam(8)) * UIT_OPHOGING, padNaam: inst.stand().pads[12].naam };
})()`);

/** Check d: dezelfde knip als NUMMER op een deck (laadGeheugen, zelfde strip en master), zoals check 1b van sampler-drums.mjs. */
const meetDeck = (s) => evalueer(`(async () => {
  ${VOORAF}
  const s = ${JSON.stringify(s)};
  const e = await maakEngine(2, Math.round(s.duur * SR));
  const ctx = e.ctx;
  const ref = window.__render.drum.sb;
  const b = ctx.createBuffer(2, ref.length + SR, SR);
  b.getChannelData(0).set(ref); b.getChannelData(1).set(window.__render.drum.sbR);
  const dA = e.deck('A');
  if (!(await dA.laadGeheugen(b, 'stuk'))) throw new Error('stuk niet geladen');
  if (s.kant) e.setKant('A', s.kant);
  const xfadeGain = e.xfadeGain('A');
  dA.set('fader', 1);
  const STAP = 0.025; let gestart = null;
  for (let i = 1; i * STAP < s.duur - 0.05; i++) {
    const t = i * STAP;
    ctx.suspend(t).then(() => {
      if (t >= s.start && gestart === null) { dA.play(); gestart = ctx.currentTime; }
      return new Promise((res) => setTimeout(res, 1)).then(() => ctx.resume());
    });
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0);
  const D = window.__render.drum.L, td = Math.round(window.__render.drum.t * SR);
  const lang = Math.round(0.4 * SR), na = 200;
  let k = Math.round(gestart * SR); while (k < L.length && Math.abs(L[k]) < 1e-4) k++;
  let beste = { lag: 0, corr: -2, gain: 0 };
  for (let lag = -300; lag <= 300; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let j = na; j < lang; j++) { const x = L[k + lag + j] ?? 0, y = D[td + j + s.verschuiving] ?? 0; xy += x * y; xx += x * x; yy += y * y; }
    const c = xy / Math.sqrt(xx * yy || 1);
    if (c > beste.corr) beste = { lag, corr: c, gain: xy / (xx || 1) };
  }
  // En de deck-render tegen de ruwe knip (wat strip + master met een nummer doen), zoals check 1b.
  let bs = { lag: 0, corr: -2, gain: 0 };
  for (let lag = -400; lag <= 400; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let j = na; j < lang; j++) { const x = ref[j], y = L[k + lag + j] ?? 0; xy += x * y; xx += x * x; yy += y * y; }
    const c = xy / Math.sqrt(xx * yy || 1);
    if (c > bs.corr) bs = { lag, corr: c, gain: xy / (xx || 1) };
  }
  // RMS over de hele knip (0,97 s), onafhankelijk van de correlatieschatter: ruw, drumpad-render, deck-render.
  const rms = (x, a, n) => { let som = 0; for (let i = a; i < a + n; i++) som += (x[i] ?? 0) ** 2; return Math.sqrt(som / n); };
  const n = ref.length;
  const rmsRuw = rms(ref, 0, n), rmsDrum = rms(D, td + 60, n), rmsDeck = rms(L, k + bs.lag, n);
  return { gestart, begin: k / SR, kant: e.kant.A, xfadeGain, drumTegenDeck: beste, deckTegenStuk: bs, rms: { ruw: rmsRuw, drum: rmsDrum, deck: rmsDeck }, deckTonen: tonen(L.subarray(k, k + Math.round(0.9 * SR))) };
})()`);

/** Check g: het nummer speelt op track 1 (fader dicht) en geeft de maat: maatBpm 124, geen tempowaarschuwing. */
const meetMaat = () => evalueer(`(async () => {
  ${VOORAF}
  const e = await maakEngine(2, SR);
  const ctx = e.ctx;
  const { drumMelding } = await import('/src/control/actions.js');
  const { d: dA } = await laadUitLibrary(e, 'A');
  e.setFocus('A');
  for (const n of ['bass', 'other', 'vocals']) dA.setStemKill(n, true);
  dA.seek(4 * 60 / 124 + 0.01);
  e.sampler.tellen = 2;
  await e.sampler.neem(0, dA, { bron: 1 });
  e.zetInstrument('H', 'drums');
  await e.instrumentOp('H').start();
  dA.set('fader', 0);
  let r = null, melding = null, maat = null;
  ctx.suspend(0.2).then(() => { dA.play(); return new Promise((res) => setTimeout(res, 150)).then(() => {
    maat = e.syncMaster()?.id ?? null; r = e.samplerNaarDrums(0, { pad: 13 }); melding = r.ok ? drumMelding(0, r) : null; return ctx.resume(); }); });
  await ctx.startRendering();
  return { r, melding, maat, speelt: dA.playing };
})()`);

const LIMITER_VOORUITBLIK = 72;
const ms = (x) => `${x.toFixed(2)} ms`;
const dB = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
const fmtTonen = (t) => NAMEN.map((n) => `${n} ${TONEN[n]} Hz ${dB(t[n]).toFixed(1)} dB`).join(' · ');
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  if (!doelen) throw new Error('Chrome antwoordt niet op de debug-poort');
  const pagina = doelen.find((d) => d.type === 'page');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/styles.css`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/styles.css` });
  await wacht(500);
  meld(`tijdelijke map: ${tmp} (blijft staan)`);

  console.log('0. het nummer in de tijdelijke library');
  const lijst = await fetch(`http://localhost:${POORT}/api/library/${ID}`).then((r) => r.json());
  meld(`GET /api/library/${ID}: audio ${lijst.track?.audio}, stems ${JSON.stringify(lijst.track?.stems)}, grid ${JSON.stringify(lijst.track?.grid?.stukken)}`);
  ok('de server kent het nummer met vier stems (drums, bass, other, vocals) en een grid op 124', lijst.track?.stems?.aantal === 4 && lijst.track.stems.namen.join() === NAMEN.join() && lijst.track.grid?.stukken?.[0]?.bpm === 124);
  const kop = await fetch(`http://localhost:${POORT}/media/${ID}/stems.wav`, { headers: { Range: 'bytes=0-43' } });
  ok(`stems.wav is te streamen (Range → ${kop.status}, ${kop.headers.get('content-range')})`, kop.status === 206);

  console.log('\n1. gestreamd op track 1 met stems, bas/overig/zang weg, 2 tellen in pad 1, pad 1 → drumpad 13 van de Drums op track 8, drie aanslagen (snelheid 1)');
  const a = await meet({ duur: 4.2, v: 1, tijden: [0.5, 1.7, 2.9] });
  const st = a.stream;
  meld(`laadStream: ${st.geladen ? 'geladen' : 'NIET geladen'} in ${ms(st.laadMs)}; bron ${st.isStream ? 'StreamBron' : 'ANDERS'}, buffer ${st.buffer ? 'gevuld' : 'LEEG'}, duur ${st.duur?.toFixed(3)} s, stems ${JSON.stringify(st.stems)}, grid ${st.grid ? `${st.bpm} bpm` : 'GEEN'}`);
  ok('(e) deck.buffer is gevuld bij een StreamBron-deck uit de library, met vier stems en het grid', st.geladen && st.isStream && st.buffer && st.stems?.aantal === 4 && st.grid && st.bpm === 124);
  meld(`knipGewichten na de kills: [${a.gewichtenNu?.map((g) => g.toFixed(2)).join(', ')}]`);
  ok(`(e) sampler.neem weigert niet (${a.neemFout ? `fout: ${a.neemFout}` : 'geen fout'}), pad 1 gevuld`, !a.neemFout && !!a.pad1);
  const p1 = a.pad1, p2 = a.pad2;
  meld(`pad 1: ${p1?.frames} frames (${(p1?.frames / 48).toFixed(1)} ms; 2 tellen op 124 = 967,7 ms), ${p1?.van.toFixed(4)}–${p1?.tot.toFixed(4)} s, bpm ${p1?.bpm}, tellen ${p1?.tellen}, gewichten [${p1?.gewichten?.join(', ')}], stemNamen [${p1?.stemNamen?.join(', ')}]`);
  meld(`pad 1 (alleen drums) inhoud: ${fmtTonen(p1.tonen)}`);
  meld(`pad 2 (zonder kills) inhoud: ${fmtTonen(p2.tonen)}`);
  // naadloos() leest 5 ms vóór `van` mee en vloeit die in het einde: de buffer is precies tot − van.
  ok('de knip is 2 tellen van het grid (46 452 ± 2 frames; de naad van 5 ms zit in het einde gevouwen) op 124 bpm', p1 && Math.abs(p1.frames - Math.round(2 * 60 / 124 * 48000)) <= 2 && p1.bpm === 124 && p1.tellen === 2);
  ok('de knip ZONDER kills bevat alle vier de tonen (elk boven −30 dB)', NAMEN.every((n) => dB(p2.tonen[n]) > -30));
  const drDb = dB(p1.tonen.drums);
  ok(`de knip MET kills bevat alleen drums (${drDb.toFixed(1)} dB), de andere drie ≥ 40 dB lager`, drDb > -30 && ['bass', 'other', 'vocals'].every((n) => drDb - dB(p1.tonen[n]) >= 40));

  meld(`samplerNaarDrums: ${JSON.stringify(a.r)}; drumpad 13 heet "${a.padNaam}"`);
  ok('(a) samplerNaarDrums: ok, drumpad 13, noot 48, track 8, gewichten [1, 0, 0, 0]', a.r.ok && a.r.pad === 13 && a.r.noot === 48 && a.r.id === 'H' && Array.isArray(a.r.gewichten) && a.r.gewichten.join() === '1,0,0,0' && a.padNaam === 'S1 · track 1');
  ok(`(a) stemNamen zijn precies STEM_STANDEN[4] (${a.STEM4.join(', ')})`, Array.isArray(a.r.stemNamen) && a.r.stemNamen.join() === a.STEM4.join() && a.STEM4.join() === NAMEN.join());
  meld(`melding: "${a.melding}"`);
  ok('(b) de melding bevat "stems: drums" en noemt drumpad 13 van track 8 (noot C3 · 48)', typeof a.melding === 'string' && a.melding.includes('stems: drums') && /^S1 staat op drumpad 13 van track 8 \(noot C3 · 48\)/.test(a.melding));
  ok('(b) geen tempowaarschuwing (er speelt nog geen maat: maatBpm null)', a.r.maatBpm === null && !/let op/.test(a.melding));

  for (const x of a.perAanslag) meld(`aanslag t = ${x.t} s: ${fmtTonen(x.tonen)}; vertraging ${x.lag} samples, correlatie met de knip ${x.corr.toFixed(5)}, versterking ${dB(x.gain).toFixed(2)} dB`);
  meld(`hele render: ${fmtTonen(a.heel)}; piek ${a.piek.toFixed(3)}`);
  const laagste = Math.min(...a.perAanslag.map((x) => Math.min(...['bass', 'other', 'vocals'].map((n) => dB(x.tonen.drums) - dB(x.tonen[n])))));
  ok(`(c) in de render van elke aanslag alleen de drums-toon: bas/overig/zang minstens ${laagste.toFixed(1)} dB lager (eis ≥ 40)`, a.perAanslag.every((x) => dB(x.tonen.drums) > -40) && laagste >= 40);
  const a0 = a.perAanslag[0];
  ok(`(c) elke aanslag is de knip zelf, op dezelfde plek (vertraging ${a0.lag} samples, correlatie ${a0.corr.toFixed(4)})`, a.perAanslag.every((x) => x.lag === a0.lag && x.corr > 0.99 && Math.abs(x.corr - a0.corr) < 1e-3));
  ok('geen fouten in het instrument', a.fouten === 0);

  console.log('\n2. (d) dezelfde knip als NUMMER op een deck (laadGeheugen), zelfde strip en master');
  meld(`crossfader in de drumpad-render: ${a.xfade.fader} (track 1 kant ${a.xfade.kantA} → ×${a.xfade.gainA.toFixed(4)} = ${dB(a.xfade.gainA).toFixed(2)} dB; track 8 kant ${a.xfade.kantH} → ×${a.xfade.gainH.toFixed(4)})`);
  meld(`drumpad tegen de ruwe knip: ${dB(a0.gain).toFixed(2)} dB (correlatie ${a0.corr.toFixed(5)})`);
  for (const kant of ['A', 'thru']) {
    const d = await meetDeck({ duur: 2.5, start: 0.5, verschuiving: LIMITER_VOORUITBLIK - a0.lag, kant });
    const verwacht = dB(a.verwacht) + dB(a.xfade.gainH) - dB(d.xfadeGain);
    meld(`track 1 op kant ${d.kant} (crossfader ×${d.xfadeGain.toFixed(4)}): deck tegen de ruwe knip ${dB(d.deckTegenStuk.gain).toFixed(2)} dB (correlatie ${d.deckTegenStuk.corr.toFixed(5)}); RMS ruw ${dB(d.rms.ruw).toFixed(2)}, drumpad ${dB(d.rms.drum).toFixed(2)}, deck ${dB(d.rms.deck).toFixed(2)} dB`);
    meld(`   drumpad tegen deck: correlatie ${d.drumTegenDeck.corr.toFixed(5)} (vertraging ${d.drumTegenDeck.lag}), verschil ${dB(d.drumTegenDeck.gain).toFixed(2)} dB; verwacht ${verwacht.toFixed(2)} dB = NIVEAU 0,8 van de Drums (${dB(a.verwacht).toFixed(2)}) + crossfader (${(dB(a.xfade.gainH) - dB(d.xfadeGain)).toFixed(2)})`);
    ok(`(d) track 1 op ${d.kant}: drumpad en deck geven hetzelfde signaal (correlatie > 0,99)`, d.drumTegenDeck.corr > 0.99);
    ok(`(d) track 1 op ${d.kant}: het niveauverschil is Drums × crossfader (${verwacht.toFixed(2)} dB ± 0,3)`, Math.abs(dB(d.drumTegenDeck.gain) - verwacht) < 0.3);
  }
  meld('op de proefavond (track 1 op A, Drums op track 8 thru): met de crossfader in het midden klinkt de drumpad ~5,1 dB luider dan hetzelfde stuk op track 1, helemaal op A ~2,1 dB (de +2,15 dB uit het spoorrapport gold voor dezelfde crossfaderkant)');

  console.log('\n3. (f) kosten');
  meld(`sampler.neem (knip van 2 tellen uit stems.wav via een Range-verzoek op de server, 8 kanalen → stereo met gewichten): ${ms(a.neemMs)}`);
  meld(`samplerNaarDrums (laadPad: kopie met in- en uitfade): ${ms(a.padMs)}`);
  meld(`laadStream (kop + eerste pagina's van stems.wav): ${ms(st.laadMs)}`);
  ok('(f) knip + laadPad samen onder 250 ms (zonder oren: de knip wacht op de server)', a.neemMs + a.padMs < 250);

  console.log('\n4. (g) het nummer speelt op track 1 (fader dicht) en geeft de maat');
  const g = await meetMaat();
  meld(`maatgever ${g.maat ?? 'geen'}, speelt ${g.speelt}; samplerNaarDrums: bpm ${g.r?.bpm}, maatBpm ${g.r?.maatBpm}; melding "${g.melding}"`);
  ok('(g) maatBpm 124 = het stuk, geen tempowaarschuwing, nog steeds "stems: drums"', g.r?.ok && g.r.bpm === 124 && Math.abs(g.r.maatBpm - 124) < 0.01 && g.melding?.includes('stems: drums') && !/let op/.test(g.melding));

  for (const m of meldingen) console.log(`  ! ${m}`);
  ok('geen uitzonderingen of console-fouten op de pagina', meldingen.length === 0);
} catch (err) {
  console.error(err); uitkomst.push(['script', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL'); server.kill('SIGINT'); await wacht(300);
}
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
