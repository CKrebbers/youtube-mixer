// Crossover stap 1 (10 okt, docs/INSTRUMENTEN.md "Uit de sampler"): een stuk uit een
// nummer, via de sampler, als drumpad 13 (sampler-pad 1: dezelfde Maschine-pad) op de
// Drums van een andere track, in de ECHTE Web Audio van Chrome (OfflineAudioContext,
// 48 kHz, de hele engine met master en limiter).
//
//  1. inhoud: wat er op t klinkt IS de sampler-buffer (correlatie), op de sample
//     waar hij hoort (de limiter-vooruitblik erbij), met de verwachte versterking
//  1b. eerlijk vergelijken met hetzelfde stuk als nummer op een deck
//  2. strip: fader van de drumtrack op 0 = stil (het stuk loopt door de strip)
//  3. de keten: deck B geeft de maat, een patroon op track A met noot 48 speelt
//     het stuk op de tellen van deck B
//  4. kosten van laadPad op de hoofdthread
//  5. tempo (H1): geknipt op 124, de maat op 128: de aanslagen op de 128-tellen,
//     het stuk zelf blijft 124 (niet uitgerekt), en de uitkomst zegt het
//  6. de koptelefoon: fader van de drumtrack dicht, PFL aan: het stuk op kanaal 3/4,
//     de zaal stil (een knip vóórhoren kan de sampler niet)
//
// VEILIG: eigen headless shell, eigen server op een eigen poort, ALLES van de server
// in een tijdelijke map (database, media, opnames, patronen, plannen, kaart, nacht,
// en een nep-yt-dlp: geen netwerk), geen requestMIDIAccess. De pagina is /styles.css (de app start niet).
// Gebruik: node tools/headless/sampler-drums.mjs [uitmap]   (VARVE_KIJK_POORT 8797, VARVE_KIJK_DEBUG 9397)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8797, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9397;
const tmp = mkdtempSync(join(tmpdir(), 'varve-sampler-drums-'));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
// De server mag NIETS buiten de tijdelijke map raken: niet de echte media/ en niet de
// werkmap. Een symlink zou dat verbergen, dus de echte paden vergelijken.
const echtTmp = realpathSync(tmp), echtWortel = realpathSync(WORTEL);
if (echtTmp.startsWith(echtWortel) || /Youtube mixer/.test(echtTmp)) throw new Error(`tijdelijke map ${echtTmp} ligt in de werkmap: stop`);

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
    // H13: ook de kaart, de nachtwachtrij en yt-dlp in de tijdelijke map (zonder VARVE_KAART
    // valt een verse database terug op Clay's kaart; de nep-yt-dlp kan niet naar buiten).
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


const meet = (s) => evalueer(`(async () => {
  const s = ${JSON.stringify(s)};
  const SR = 48000, N = Math.round(s.duur * SR);
  const Echt = window.AudioContext;
  window.AudioContext = class extends OfflineAudioContext { constructor() { super({ numberOfChannels: 2, length: N, sampleRate: SR }); } };
  let e;
  try { const { Engine } = await import('/src/engine/engine.js'); e = new Engine(); } finally { window.AudioContext = Echt; }
  await e.master.klaar;
  const ctx = e.ctx;
  const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
  const { Beatgrid } = await import('/src/engine/beatgrid.js');
  const { faderGain } = await import('/src/engine/audio-graph.js');
  const { UIT_OPHOGING } = await import('/src/engine/instrumenten/drums.js');
  const pt = e.patronen; pt.elke = () => null;
  const dB = e.deck('B');
  if (!(await dB.laadGeheugen(renderDemoTrack(ctx, { bars: 16 }), 'demo 124'))) throw new Error('demo niet geladen');
  dB.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  dB.set('fader', 0);
  // Knippen: 1 tel, eindigend op tel 5 (de laatste hele tel vóór de positie).
  dB.seek(5 * 60 / 124 + 0.01);
  e.sampler.tellen = 1;
  await e.sampler.neem(0, dB, { bron: 2 });
  const sp = e.sampler.pads[0];
  const sb = sp.buffer;
  dB.seek(0);
  // Check 5: de maat op een ANDER tempo dan het stuk (geknipt op 124).
  if (s.maatBpm) dB.setGrid(new Beatgrid({ bpm: s.maatBpm, firstBeat: 0 }));
  e.zetInstrument('A', 'drums');
  const inst = e.instrumentOp('A');
  await inst.start();
  e.setFocus('A');
  // Sampler-pad 1 → drumpad 13 (DRUMPAD_VAN_SAMPLER: dezelfde Maschine-pad), noot 48.
  const r = e.samplerNaarDrums(0, { pad: 13 });
  let r2 = null;                 // nog eens zodra deck B speelt: dan is er een maat
  e.deck('A').set('fader', s.faderA ?? 1);
  const gepland = [];
  const echt = inst.noteOn.bind(inst);
  inst.noteOn = (noot, v, t) => { gepland.push([noot, v, t]); return echt(noot, v, t); };
  const tellen = new Map();
  if (s.patroon) {
    pt.laadSet({ tempo: 120, tracks: { 1: [{ noten: [0, 8].map((stap) => ({ stap, noot: 48, snelheid: s.v })) }] } });
    const STAP = 0.025; let gestart = false;
    const noteer = () => { if (!dB.playing || !dB.grid) return; const nu = ctx.currentTime; const b0 = Math.ceil(dB.grid.beatAt(dB.position) - 1e-9);
      for (let b = b0; b < b0 + 4; b++) { const t = dB.ctxTimeOf(dB.grid.timeOf(b)); if (t >= nu) tellen.set(b, t); } };
    for (let i = 1; i * STAP < s.duur - 0.05; i++) {
      const t = i * STAP;
      ctx.suspend(t).then(() => {
        if (t >= 0.2 && !gestart) { dB.play(); gestart = true; r2 = e.samplerNaarDrums(0, { pad: 13 }); pt.start('A', 1); } else pt.tik();
        noteer();
        return new Promise((res) => setTimeout(res, 1)).then(() => ctx.resume());
      });
    }
  } else {
    for (const t of s.tijden) inst.noteOn(48, s.v, t);
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  window.__render = window.__render || {}; window.__render[s.naam || 'x'] = { L: L.slice(), R: R.slice(), sb: sb.getChannelData(0).slice(), sbR: sb.getChannelData(1).slice(), t: s.tijden?.[0] };
  const sL = sb.getChannelData(0);
  // Per aanslag: beste vertraging (0..400 samples) en correlatie over 0,4 s, na de 2 ms in-fade.
  const lang = Math.min(sb.length - 200, Math.round(0.4 * SR)), na = 200;
  const perAanslag = gepland.map(([, , t]) => {
    const k0 = Math.round(t * SR);
    let beste = { lag: -1, corr: -2, gain: 0 };
    for (let lag = 0; lag <= 400; lag++) {
      let xy = 0, xx = 0, yy = 0;
      for (let j = na; j < lang; j++) { const x = sL[j], y = L[k0 + lag + j] ?? 0; xy += x * y; xx += x * x; yy += y * y; }
      const c = xy / Math.sqrt(xx * yy || 1);
      if (c > beste.corr) beste = { lag, corr: c, gain: xy / (xx || 1) };
    }
    return { t, ...beste };
  });
  let piek = 0, som = 0; for (let i = 0; i < L.length; i++) { piek = Math.max(piek, Math.abs(L[i]), Math.abs(R[i])); som += L[i] * L[i] + R[i] * R[i]; }
  let sbPiek = 0; for (let i = 0; i < sL.length; i++) sbPiek = Math.max(sbPiek, Math.abs(sL[i]));
  const telLijst = [...tellen.entries()].sort((a, b) => a[0] - b[0]);
  const bijTel = (t) => { let b = null; for (const x of telLijst) if (!b || Math.abs(x[1] - t) < Math.abs(b[1] - t)) b = x; return b; };
  return { r, r2, padNaam: inst.stand().pads[12].naam, padLen: inst.pads[12].buffer?.length ?? null, sbLen: sb.length, sbBpm: sp.bpm, van: sp.van, tot: sp.tot, sbPiek,
    verwacht: Math.pow(s.v, 1.5) * faderGain(inst.leesParam(8)) * UIT_OPHOGING, niveauKnop: inst.leesParam(8),
    perAanslag, piek, rmsDb: 10 * Math.log10(som / (2 * L.length) || 1e-30), fouten: inst.fouten,
    telAfwijking: s.patroon ? gepland.map(([, , t]) => { const b = bijTel(t); return b ? t - b[1] : null; }) : [], aantalGepland: gepland.length };
})()`);

const meetDeck = (s) => evalueer(`(async () => {
  const s = ${JSON.stringify(s)};
  const SR = 48000, N = Math.round(s.duur * SR);
  const Echt = window.AudioContext;
  window.AudioContext = class extends OfflineAudioContext { constructor() { super({ numberOfChannels: 2, length: N, sampleRate: SR }); } };
  let e;
  try { const { Engine } = await import('/src/engine/engine.js'); e = new Engine(); } finally { window.AudioContext = Echt; }
  await e.master.klaar;
  const ctx = e.ctx;
  const ref = window.__render[s.van].sb;
  const b = ctx.createBuffer(2, ref.length + SR, SR);           // het stuk + 1 s stilte erachter
  b.getChannelData(0).set(ref); b.getChannelData(1).set(window.__render[s.van].sbR);
  const dA = e.deck('A');
  if (!(await dA.laadGeheugen(b, 'stuk'))) throw new Error('stuk niet geladen');
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
  window.__render.deck = { L: L.slice() };
  // Vergelijk: drumpad-render (op t) tegen deck-render (begint ergens na 'gestart'): beste vertraging.
  const D = window.__render[s.van].L, td = Math.round(window.__render[s.van].t * SR);
  const lang = Math.round(0.4 * SR), na = 200;
  // grof: het begin in de deck-render (eerste sample > 1e-4 na gestart)
  let k = Math.round(gestart * SR); while (k < L.length && Math.abs(L[k]) < 1e-4) k++;
  let beste = { lag: 0, corr: -2, gain: 0 };
  for (let lag = -300; lag <= 300; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let j = na; j < lang; j++) { const x = L[k + lag + j] ?? 0, y = D[td + j + s.verschuiving] ?? 0; xy += x * y; xx += x * x; yy += y * y; }
    const c = xy / Math.sqrt(xx * yy || 1);
    if (c > beste.corr) beste = { lag, corr: c, gain: xy / (xx || 1) };
  }
  // en de deck-render tegen het ruwe stuk (wat doet de strip + master met een nummer?)
  let bs = { lag: 0, corr: -2, gain: 0 };
  for (let lag = -400; lag <= 400; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let j = na; j < lang; j++) { const x = ref[j], y = L[k + lag + j] ?? 0; xy += x * y; xx += x * x; yy += y * y; }
    const c = xy / Math.sqrt(xx * yy || 1);
    if (c > bs.corr) bs = { lag, corr: c, gain: xy / (xx || 1) };
  }
  return { gestart, begin: k / SR, drumTegenDeck: beste, deckTegenStuk: bs };
})()`);

// De vooruitblik van de master-limiter (samples bij 48 kHz): het deck komt er even laat
// door als de drumpad. De drumpad zelf heeft daarbovenop zijn eigen vertraging (a.lag uit
// check 1b), dus de render van de drumpad schuift LIMITER_VOORUITBLIK − lag op om het
// begin van het stuk op het begin van de deck-render te leggen; de zoektocht ±300 erna
// vangt de rest.
const LIMITER_VOORUITBLIK = 72;
/**
 * Check 6 (W2, optioneel in het ontwerp): de koptelefoon. Vier kanalen zoals het
 * samengestelde apparaat (1/2 de zaal, 3/4 de koptelefoon, docs/STUDIO.md §3). Drums op
 * track A met de fader DICHT, het stuk op drumpad 13, één aanslag op 0,5 s; PFL van A aan
 * of uit. Terug: per kanaal de correlatie met het ruwe stuk (beste vertraging) en het niveau.
 */
const meetPfl = (s) => evalueer(`(async () => {
  const s = ${JSON.stringify(s)};
  const SR = 48000, N = SR * 2;
  const Echt = window.AudioContext;
  window.AudioContext = class extends OfflineAudioContext { constructor() { super({ numberOfChannels: 4, length: N, sampleRate: SR }); } };
  let e;
  try { const { Engine } = await import('/src/engine/engine.js'); e = new Engine(); } finally { window.AudioContext = Echt; }
  await e.master.klaar;
  const ctx = e.ctx;
  const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
  const { Beatgrid } = await import('/src/engine/beatgrid.js');
  const dB = e.deck('B');
  if (!(await dB.laadGeheugen(renderDemoTrack(ctx, { bars: 16 }), 'demo 124'))) throw new Error('demo niet geladen');
  dB.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
  dB.set('fader', 0);
  dB.seek(5 * 60 / 124 + 0.01);
  e.sampler.tellen = 1;
  await e.sampler.neem(0, dB, { bron: 2 });
  const sL = e.sampler.pads[0].buffer.getChannelData(0);
  e.zetInstrument('A', 'drums');
  const inst = e.instrumentOp('A');
  await inst.start();
  e.setFocus('A');
  const r = e.samplerNaarDrums(0, { pad: 13 });
  e.deck('A').set('fader', 0);                         // de zaal hoort de drumtrack niet
  const kt = e.koptelefoon;
  if (s.pfl) kt.zetPfl('A', true);
  inst.noteOn(48, 1, 0.5);
  const buf = await ctx.startRendering();
  const k0 = Math.round(0.5 * SR), lang = Math.min(sL.length - 200, Math.round(0.4 * SR)), na = 200;
  const kanalen = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c);
    let beste = { lag: -1, corr: -2 };
    for (let lag = 0; lag <= 400; lag += 1) {
      let xy = 0, xx = 0, yy = 0;
      for (let j = na; j < lang; j++) { const a = sL[j], b = x[k0 + lag + j] ?? 0; xy += a * b; xx += a * a; yy += b * b; }
      const corr = yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
      if (corr > beste.corr) beste = { lag, corr };
    }
    let som = 0; for (let i = k0; i < k0 + lang; i++) som += x[i] * x[i];
    kanalen.push({ ...beste, rmsDb: 10 * Math.log10(som / lang || 1e-30) });
  }
  return { ok: r.ok, beschikbaar: kt.beschikbaar, aantal: buf.numberOfChannels, pfl: kt.pflAan('A'), kanalen };
})()`);

const ms = (x) => `${(x * 1000).toFixed(3)} ms`;
const db = (x) => `${(20 * Math.log10(x)).toFixed(2)} dB`;
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
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/styles.css`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/styles.css` });
  await wacht(500);

  console.log('1. inhoud en versterking (snelheid 0,5, drie aanslagen)');
  const a = await meet({ duur: 4, v: 0.5, tijden: [0.5, 1.5, 2.5] });
  meld(`sampler-pad 1: ${a.sbLen} frames (${(a.sbLen / 48000 * 1000).toFixed(1)} ms; 1 tel op 124 bpm = 483,9 ms + 5 ms naad), ${a.van.toFixed(4)}–${a.tot.toFixed(4)} s, bpm ${a.sbBpm}, piek ${a.sbPiek.toFixed(3)}`);
  ok(`samplerNaarDrums: sampler-pad 1 → drumpad 13, noot ${a.r.noot}, naam "${a.padNaam}"`, a.r.ok && a.r.pad === 13 && a.r.noot === 48 && a.padNaam === 'S1 · track 2');
  for (const x of a.perAanslag) meld(`t = ${x.t} s: vertraging ${x.lag} samples (${ms(x.lag / 48000)}), correlatie ${x.corr.toFixed(5)}, versterking ${x.gain.toFixed(4)} (${db(x.gain)})`);
  const a0 = a.perAanslag[0];
  ok(`elke aanslag is hetzelfde signaal op dezelfde plek (vertraging ${a0.lag} samples, correlatie met het ruwe stuk ${a0.corr.toFixed(4)}; strip + master veranderen het laag, zie 1b)`,
    a.perAanslag.every((x) => x.lag === a0.lag && Math.abs(x.corr - a0.corr) < 1e-4 && Math.abs(20 * Math.log10(x.gain / a0.gain)) < 0.01));
  meld(`dus bij snelheid 1 speelt het stuk op ${db(a.verwacht / Math.pow(0.5, 1.5))} t.o.v. het nummer zelf, bij 0,8 op ${db(a.verwacht / Math.pow(0.5, 1.5) * Math.pow(0.8, 1.5))} (zelfde strip)`);
  ok('geen fouten in het instrument', a.fouten === 0);

  console.log('\n1b. eerlijk vergelijken: hetzelfde stuk als NUMMER op deck A, zelfde strip, zelfde master');
  const a1 = await meet({ duur: 2, v: 1, tijden: [0.5], naam: 'drum1' });
  const d = await meetDeck({ duur: 2.5, start: 0.5, van: 'drum1', verschuiving: LIMITER_VOORUITBLIK - a1.perAanslag[0].lag });
  meld(`drumpad (snelheid 1) tegen het ruwe stuk: correlatie ${a1.perAanslag[0].corr.toFixed(5)}, ${db(a1.perAanslag[0].gain)}`);
  meld(`deck A tegen het ruwe stuk: correlatie ${d.deckTegenStuk.corr.toFixed(5)}, ${db(d.deckTegenStuk.gain)} (dit is wat strip + master met elk nummer doen)`);
  meld(`drumpad tegen deck A: correlatie ${d.drumTegenDeck.corr.toFixed(5)}, verschil ${db(d.drumTegenDeck.gain)} (verwacht ${db(a1.verwacht)})`);
  ok('drumpad en deck geven hetzelfde signaal (correlatie > 0,99)', d.drumTegenDeck.corr > 0.99);
  ok(`het stuk op de drumpad is bij snelheid 1 en NIVEAU 0,8 ${db(a1.verwacht)} t.o.v. hetzelfde stuk op een deck (±0,2 dB)`, Math.abs(20 * Math.log10(d.drumTegenDeck.gain / a1.verwacht)) < 0.2);

  console.log('\n2. strip: fader van de drumtrack op 0');
  const b = await meet({ duur: 2, v: 1, tijden: [0.5], faderA: 0 });
  ok(`fader 0 = −70 dB, zoals elke track (piek ${b.piek.toExponential(2)}, ${b.rmsDb.toFixed(1)} dBFS rms)`, b.piek < 3e-4 && b.rmsDb < -90);

  console.log('\n3. de keten: deck B geeft de maat, patroon op A (noot 48 op stap 1 en 9), 8 s');
  const c = await meet({ duur: 8, v: 0.5, patroon: true });
  const afw = c.telAfwijking.filter((x) => x != null);
  meld(`gepland ${c.aantalGepland} aanslagen; afwijking van de tellen van deck B: ${afw.slice(0, 6).map(ms).join(', ')}${afw.length > 6 ? ' …' : ''}`);
  ok(`het patroon speelt het stuk (${c.aantalGepland} aanslagen in ~7,8 s op 124 bpm, elke 2 tellen)`, c.aantalGepland >= 7);
  ok(`elke aanslag op een tel van deck B (grootste afwijking ${ms(Math.max(...afw.map(Math.abs)))})`, afw.length === c.aantalGepland && afw.every((x) => Math.abs(x) < 1e-6));
  const heel = c.perAanslag.filter((x) => x.t + 0.5 < 8);
  ok(`en in de render is het elke keer dat stuk, op dezelfde vertraging als in 1 (${heel.length} hele aanslagen)`,
    heel.length >= 6 && heel.every((x) => Math.abs(x.lag - a0.lag) <= 1 && Math.abs(x.corr - a0.corr) < 0.003),
    heel.map((x) => `${x.corr.toFixed(4)}@${x.lag}`).join(' '));

  console.log('\n4. kosten op de hoofdthread: laadPad van een lange sectie (90 s stereo, de grens SECTIE_MAX_SEC)');
  const kost = await evalueer(`(async () => {
    const { DRUMS } = await import('/src/engine/instrumenten/drums.js');
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 48000, sampleRate: 48000 });
    const d = DRUMS.maak(ctx, { uit: ctx.destination }); await d.start();
    const uit = [];
    for (const sec of [0.5, 8, 30, 90]) {
      const b = ctx.createBuffer(2, Math.round(sec * 48000), 48000);
      b.getChannelData(0).fill(0.1); b.getChannelData(1).fill(0.1);
      const tijden = [];
      for (let k = 0; k < 5; k++) { const t0 = performance.now(); d.laadPad(9, b, 'x'); tijden.push(performance.now() - t0); }
      tijden.sort((x, y) => x - y);
      uit.push({ sec, mediaan: tijden[2], max: tijden[4], mb: (2 * b.length * 4 / 1e6) });
    }
    return uit;
  })()`);
  for (const k of kost) meld(`${k.sec} s (${k.mb.toFixed(1)} MB Float32): mediaan ${k.mediaan.toFixed(2)} ms, max ${k.max.toFixed(2)} ms`);
  ok('een stuk van 8 s kost minder dan een frame (16 ms)', kost.find((k) => k.sec === 8).mediaan < 16);

  console.log('\n5. tempo (H1): geknipt op 124, de maat (deck B) op 128, patroon noot 48 op stap 1 en 9, 8 s');
  const f = await meet({ duur: 8, v: 0.5, patroon: true, maatBpm: 128 });
  meld(`vóór het spelen: bpm ${f.r.bpm}, maatBpm ${f.r.maatBpm} (geen maat: niets speelt); zodra deck B speelt: bpm ${f.r2?.bpm}, maatBpm ${f.r2?.maatBpm?.toFixed(4)}`);
  ok('samplerNaarDrums zegt het: bpm 124 (het stuk), maatBpm 128 (de maat)', f.r2?.ok && f.r2.bpm === 124 && Math.abs(f.r2.maatBpm - 128) < 0.01 && f.r.maatBpm === null);
  const afw5 = f.telAfwijking.filter((x) => x != null);
  const tussen = f.perAanslag.slice(1).map((x, k) => x.t - f.perAanslag[k].t);
  meld(`gepland ${f.aantalGepland} aanslagen, tussenruimte ${tussen.slice(0, 4).map((x) => `${(x * 1000).toFixed(3)} ms`).join(', ')} (2 tellen op 128 = 937,5 ms)`);
  ok(`elke aanslag op een 128-tel van deck B (grootste afwijking ${ms(Math.max(...afw5.map(Math.abs)))}), om de 937,5 ms`,
    f.aantalGepland >= 7 && afw5.length === f.aantalGepland && afw5.every((x) => Math.abs(x) < 1e-6) && tussen.every((x) => Math.abs(x - 2 * 60 / 128) < 1e-6));
  const heel5 = f.perAanslag.filter((x) => x.t + 0.5 < 8);
  ok(`het stuk zelf blijft 124: ${f.padLen} frames op de drumpad (${(f.padLen / 48).toFixed(1)} ms; een tel op 128 = 468,8 ms), en elke aanslag is dat stuk onveranderd (zelfde vertraging en correlatie als in 1)`,
    f.padLen === f.sbLen && f.sbLen === a.sbLen && heel5.length >= 6 && heel5.every((x) => Math.abs(x.lag - a0.lag) <= 1 && Math.abs(x.corr - a0.corr) < 0.003),
    heel5.map((x) => `${x.corr.toFixed(4)}@${x.lag}`).join(' '));

  console.log('\n6. de koptelefoon (W2): fader van de drumtrack dicht, PFL aan: het stuk op 3/4, de zaal (1/2) stil');
  const k1 = await meetPfl({ pfl: true }), k0 = await meetPfl({ pfl: false });
  const kan = (k) => k.kanalen.map((c, i) => `${i + 1}: ${c.rmsDb.toFixed(1)} dB, corr ${c.corr.toFixed(3)}@${c.lag}`).join(' | ');
  meld(`PFL aan (${k1.aantal} kanalen, koptelefoon ${k1.beschikbaar ? 'beschikbaar' : 'NIET beschikbaar'}): ${kan(k1)}`);
  meld(`PFL uit: ${kan(k0)}`);
  ok('PFL aan: kanaal 3/4 is het stuk (correlatie > 0,8, boven −40 dB), de zaal 1/2 is stil (onder −60 dB)',
    k1.ok && k1.beschikbaar && k1.pfl && k1.kanalen.slice(2).every((c) => c.corr > 0.8 && c.rmsDb > -40) && k1.kanalen.slice(0, 2).every((c) => c.rmsDb < -60));
  ok('PFL uit: ook de koptelefoon stil (hij hoort dan de zaal, en die is stil)', k0.kanalen.every((c) => c.rmsDb < -60));

  for (const m of meldingen) console.log(`  ! ${m}`);
  ok('geen uitzonderingen of console-fouten op de pagina', meldingen.length === 0);
} catch (err) {
  console.error(err); uitkomst.push(['script', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL'); server.kill('SIGINT'); await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
