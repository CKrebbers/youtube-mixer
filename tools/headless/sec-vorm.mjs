// Secties in beeld, headless in echte Chrome (TASKS-SECTIES, Verweven 7 en 8):
// de vormbronnen `sectie.nieuw` en `sectie.energie` (src/analysis/maat.js) en
// het accent op de video-puls (video-mixer.js, _accentNu) op een echt nummer
// met een echte sectiekaart van de server, op de audioklok.
//
// Wat het laat zien:
//   - sectie.nieuw slaat PRECIES op elke sectiegrens die je hoort: uit elke
//     meting na de grens volgt het moment van de piek (hoor + τ·ln(waarde)),
//     en dat valt binnen een paar ms op het begin van de sectie in de kaart;
//     ervóór (verder dan de opkomst van 12 ms) is hij 0. Ook na een sprong
//     (seek) naar vlak vóór de volgende grens.
//   - sectie.energie is de energie van de sectie die je hoort, en wisselt OP
//     de grens.
//   - alleen van de maatgever: track 3 speelt zachter hetzelfde nummer en gaat
//     over een eigen grens, dat geeft niets; en alleen als je hem hoort: met
//     de fader dicht geeft een grens niets.
//   - de echte haken: de vormlaag (route nieuwe sectie → knop 1, sterkte 1)
//     krijgt zijn offset rond de grenzen, en de video-puls (doel flits, diepte
//     0,1) krijgt in teken() het accent: in de effectstap is de flits op de
//     grens vol, op een gewone tel 0,1.
//
// Opzet zoals sec-toets.mjs: een EIGEN server op een eigen poort met een
// tijdelijke database, mediamap, patronen- en plannenmap, de nep-yt-dlp met het
// synthetische nummer (test/synth-nummer.mjs: zeven secties op 124 bpm) en de
// nep-splitter. Geen netwerk, geen MIDI (Chromium zonder requestMIDIAccess).
//
// Gebruik:  node tools/headless/sec-vorm.mjs
// Poorten:  VARVE_KIJK_POORT (8911) en VARVE_KIJK_DEBUG (9511). Chrome: VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';
import { maakNepStems } from '../../test/nep-stems.mjs';
import { synthNummer } from '../../test/synth-nummer.mjs';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8911, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9511;
const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-vorm-'));

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
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'),
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
], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });     // een eigen procesgroep: zie het opruimen onderaan
let chromeLog = '';
chrome.stderr.on('data', (d) => { chromeLog = (chromeLog + d).slice(-4000); });
chrome.on('exit', (code, sig) => { chromeLog += `\n[chrome stopte: ${code ?? sig}]`; });

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
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(100); }
  return false;
}
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const act = (expr) => evalueer(`import('/src/control/actions.js').then((a) => ${expr})`);
const druk = (id) => act(`(a.invoke(${JSON.stringify(id)}, true), a.invoke(${JSON.stringify(id)}, false))`);
const zet = (id, v) => act(`a.invoke(${JSON.stringify(id)}, ${v})`);
const rij = (deel) => `[...document.querySelectorAll('#lib-panel .lib-rij')].find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)}))`;
const deck = (id) => `window.engine.deck(${JSON.stringify(id)})`;

/**
 * Meten op de audioklok in de pagina, op ~60 Hz (setTimeout; de animatielus
 * haalt headless maar een paar beelden per seconde). Een EIGEN maatlezer op
 * de engine (engineMaatLezer, dezelfde als het vormpaneel maakt), en per
 * meting ook een echt beeld (videoMixer.teken()). Per meting: t, wat je hoort
 * van track 1 en 3, de waarden en wie de maat geeft.
 * `stappen` = [[seconden na de start, js-code], ...] om onderweg iets te doen.
 */
const meet = (s, stappen = []) => evalueer(`(async () => {
  const e = window.engine, M = window.__maat;
  const vertraging = () => window.__vertraging(e.ctx);
  const l = window.__lezer ??= M.engineMaatLezer(e, window.videoMixer.decks, vertraging);
  const uit = []; const t0 = e.ctx.currentTime, eind = t0 + ${s};
  const stappen = [${stappen.map(([na, code]) => `[${na}, () => { ${code} }]`).join(', ')}];
  await new Promise((klaar) => {
    const f = () => {
      const nu = e.ctx.currentTime;
      while (stappen.length && nu - t0 >= stappen[0][0]) stappen.shift()[1]();
      const v = vertraging(), t = nu - v;
      const A = e.deck('A'), C = e.deck('C');
      // Ook het echte beeld, op dezelfde ~60 Hz: de animatielus haalt headless
      // onder belasting soms meer dan een seconde niets (en een grens in zo'n
      // gat telt bewust niet, GAT). teken() loopt zo door de echte haken:
      // vormlaag (router) en video-puls.
      window.videoMixer.teken();
      const w = l.lees(t);
      // Wat je hoort zoals de lezer het rekende (SectieLezer.hoor): geen tweede
      // lezing van de positie (currentTime kan binnen één taak een quantum verder zijn).
      const hoorA = l.maatgever === 'A' ? l.secties.hoor : (A.playing ? A.position - v * A.rate : A.position);
      uit.push({ t, hoorA, hoorC: C.playing ? C.position - v * C.rate : null,
        n: w['sectie.nieuw'], e: w['sectie.energie'], wie: l.maatgever });
      e.ctx.currentTime < eind ? setTimeout(f, 16) : klaar();
    };
    f();
  });
  return uit;
})()`);

async function doorloop() {
  console.log('binnenhalen en laden: hetzelfde nummer op track 1 en track 3');
  await evalueer(`(async () => {
    window.__maat = await import('/src/analysis/maat.js');
    window.__vertraging = (await import('/src/engine/hoorbaar.js')).uitgangsVertraging;
    await window.engine.resume();
  })()`);
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'https://www.youtube.com/watch?v=secVorm';
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  ok('het nummer staat in de lijst', await totdat(rij('secVorm'), 90000));
  await evalueer(`${rij('secVorm')}.querySelector('button[data-deck="A"]').click()`);
  ok('op track 1', await totdat(`${deck('A')}.duration > 150`, 30000));
  ok('track 1 heeft secties', await totdat(`${deck('A')}.sectieKaart?.aantal >= 6`, 60000));
  await totdat(`!${rij('secVorm')}.querySelector('button[data-deck="C"]').disabled`, 10000);
  await evalueer(`${rij('secVorm')}.querySelector('button[data-deck="C"]').click()`);
  ok('op track 3', await totdat(`${deck('C')}.duration > 150 && ${deck('C')}.sectieKaart?.aantal >= 6`, 60000));
  await evalueer("document.getElementById('lib-btn').click()");
  const st = await evalueer(`${deck('A')}.sectieKaart.stukken.map((x) => ({ van: x.van, energie: x.energie }))`);
  console.log('      ' + (await evalueer(`${deck('A')}.sectieKaart.stukken.map((x, i) => (+x.van.toFixed(2)) + 's ' + ${deck('A')}.sectieKaart.naam(i) + ' e' + x.energie)`)).join(' · '));

  console.log('\nde vormlaag en de video-puls aanzetten');
  await evalueer("document.getElementById('video-btn').click()");
  await zet('track.1.fader', 1); await zet('track.3.fader', 0.5); await zet('mixer.xfader', 0);
  await druk('video.layer.on');
  for (let i = 0; i < 8; i++) await druk('video.layer.react.source');
  await zet('video.layer.react', 1);
  await zet('video.pulse', 0.1);
  while (await evalueer('window.videoMixer.pulsDoel') !== 'flits') await druk('video.pulse.target');
  ok('vormlaag 1 aan, reageert op "nieuwe sectie" → knop 1, sterkte 1',
    await evalueer("window.vormen.laag.aan && document.querySelector('.vorm-reageer-bron').value === 'sectie.nieuw'"),
    await evalueer("document.querySelector('.vorm-reageer-bron').value"));
  ok('de bronkeuze toont de maatgever: klap (maat), tel, sectie en nieuwe sectie',
    await evalueer("[...document.querySelectorAll('.vorm-reageer-bron optgroup')[1].children].map((o) => o.textContent).join(',') === 'klap (maat),tel,sectie,nieuwe sectie'"));
  ok('video-puls 0,1 op flits', await evalueer("window.videoMixer.puls === 0.1 && window.videoMixer.pulsDoel === 'flits'"));

  // De echte haken vastleggen (alleen kijken): wat de vormlaag per beeld krijgt,
  // wat teken() als accent meekrijgt, en de flits die de effectstap krijgt.
  await evalueer(`(() => {
    const e = window.engine, mx = window.videoMixer, laag = window.vormen.lagen[0], v = () => window.__vertraging(e.ctx);
    window.__frames = []; window.__accent = []; window.__flits = [];
    const frame = laag.frame;
    laag.frame = (t) => { const r = frame(t); const A = e.deck('A');
      window.__frames.push({ t, hoorA: A.playing ? A.position - v() * A.rate : A.position, mod: laag.mod[0] }); return r; };
    // De puls van DEZELFDE aanroep van teken() (eerst _pulsNu, dan _accentNu), niet opnieuw gerekend.
    let puls = 0;
    const pulsNu = mx._pulsNu.bind(mx);
    mx._pulsNu = (vt, m) => (puls = pulsNu(vt, m));
    const accent = mx._accentNu.bind(mx);
    mx._accentNu = (vt, m) => { const a = accent(vt, m); const A = e.deck('A');
      const hoorA = mx.sectieLezer && mx.sectieLezer.deck === A ? mx.sectieLezer.hoor : (A.playing ? A.position - v() * A.rate : A.position);
      window.__accent.push({ t: e.ctx.currentTime - v(), hoorA, a, puls }); return a; };
    const loc = mx.loc;
    mx.loc = (p, n) => { const l = loc(p, n); if (l) { l.__p = p; l.__n = n; } return l; };
    const gl = mx.gl, u1f = gl.uniform1f.bind(gl);
    gl.uniform1f = (l, x) => { if (l?.__n === 'flits' && l.__p === mx.effect) window.__flits.push({ f: x, n: window.__accent.length }); return u1f(l, x); };
  })()`);

  // ---- Run 1: track 1 is de maatgever ------------------------------------------
  // Grens k (de drop) en k+1 (de break): start 3 s vóór k; na 4,5 s een sprong
  // naar 1,5 s vóór k+1. Track 3 (fader 0,5: zachter) gaat na 1,5 s over ZIJN
  // grens k+2, terwijl track 1 tussen twee grenzen zit.
  const k = st.findIndex((x) => x.van > 40);
  const [vk, vk1, vk2] = [st[k].van, st[k + 1].van, st[k + 2].van];
  console.log(`\nrun 1: track 1 over de grens op ${vk.toFixed(2)} s, sprong, dan over ${vk1.toFixed(2)} s; track 3 zachter over ${vk2.toFixed(2)} s`);
  await evalueer(`(() => { const A = ${deck('A')}, C = ${deck('C')}; A.seek(${vk - 3}); C.seek(${vk2 - 1.5}); })()`);
  await druk('track.1.play'); await druk('track.3.play');
  ok('beide spelen', await totdat(`${deck('A')}.playing && ${deck('C')}.playing`, 5000));
  const r1 = await meet(7.2, [[4.5, `e.deck('A').seek(${vk1 - 1.5})`]]);
  const { fr1, ac1, fl1 } = await evalueer('({ fr1: window.__frames.splice(0), ac1: window.__accent.splice(0), fl1: window.__flits.splice(0) })');
  console.log(`      ${r1.length} metingen, ${fr1.length} beelden van de vormlaag, ${ac1.length} keer teken() met de puls`);

  ok('track 1 gaf de hele tijd de maat', r1.every((x) => x.wie === 'A'), [...new Set(r1.map((x) => x.wie))].join(','));
  const TAU = await evalueer('window.__maat.NIEUW_TAU'), OP = await evalueer('window.__maat.KLAP_OP');
  for (const [naam, van] of [['k', vk], ['k+1 (na een sprong)', vk1]]) {
    const na = r1.filter((x) => x.hoorA >= van && x.hoorA < van + 0.6 && x.n > 1e-3);
    const piek = na.map((x) => x.hoorA + TAU * Math.log(x.n));          // waar de piek lag, volgens elke meting
    const fout = Math.max(...piek.map((p) => Math.abs(p - van)));
    ok(`nieuwe sectie ${naam}: ${na.length} metingen na de grens, de piek ligt OP het begin in de kaart (max ${(fout * 1000).toFixed(1)} ms ernaast)`,
      na.length >= 10 && fout < 0.008);                               // currentTime loopt per render-quantum (2,7 ms)
    const eerste = r1.find((x) => x.hoorA >= van);
    ok(`… de eerste meting erna staat bijna vol (${eerste?.n.toFixed(3)} op ${((eerste?.hoorA - van) * 1000).toFixed(1)} ms)`,
      eerste && eerste.n >= Math.exp(-(eerste.hoorA - van + 0.003) / TAU));
    // Ervóór: niets dat opkomt. Hooguit de laatste staart van een grens van
    // 1,5 s eerder (na de sprong), en die is dan al onder de 0,001.
    const voor = r1.filter((x) => x.hoorA < van - OP - 0.004 && x.hoorA > van - 1.4);
    ok(`… in de 1,4 s ervóór niets (${voor.length} metingen, max ${Math.max(0, ...voor.map((x) => x.n)).toExponential(1)})`,
      voor.length >= 20 && voor.every((x) => x.n < 1e-3));
    const eNa = r1.filter((x) => x.hoorA >= van + 0.003 && x.hoorA < van + 0.8), eVoor = r1.filter((x) => x.hoorA < van - 0.003 && x.hoorA > van - 0.8);
    const i = st.findIndex((x) => x.van === van);
    ok(`… de energie wisselt op de grens: ${st[i - 1].energie} → ${st[i].energie}`,
      eVoor.length > 5 && eNa.length > 5 && eVoor.every((x) => x.e === st[i - 1].energie) && eNa.every((x) => x.e === st[i].energie));
  }
  const c2 = r1.filter((x) => x.hoorC !== null && x.hoorC >= vk2 - 0.05 && x.hoorC < vk2 + 0.5);
  ok(`alleen de maatgever: track 3 gaat over zijn grens (${c2.length} metingen), dat geeft niets`, c2.length >= 10 && c2.every((x) => x.n === 0));

  // De echte haken.
  const grensBij = (hoor) => [vk, vk1].some((v) => hoor >= v - OP - 0.004 && hoor < v + 1.0);
  const fMet = fr1.filter((x) => x.mod > 0.01);
  ok(`vormlaag: offset op knop 1 alleen rond een grens (${fMet.length} van ${fr1.length} beelden), na elke grens minstens één`,
    fr1.length > 0 && fMet.every((x) => grensBij(x.hoorA)) && [vk, vk1].every((v) => fr1.some((x) => x.hoorA >= v && x.hoorA < v + 1 && x.mod > 0)),
    fMet.map((x) => `${x.hoorA.toFixed(2)}:${x.mod.toFixed(2)}`).join(' '));
  // Ter info: de beelden van de echte lus rond elke grens (hoor:waarde, en het gat ervoor in s).
  const rondom = (lijst, v, veld) => lijst.map((x, j) => ({ ...x, gat: j ? x.t - lijst[j - 1].t : 0 }))
    .filter((x) => x.hoorA > v - 1.5 && x.hoorA < v + 1.5).map((x) => `${(x.hoorA - v).toFixed(2)}:${x[veld].toFixed(2)}${x.gat > 0.5 ? `(gat ${x.gat.toFixed(2)})` : ''}`).join(' ');
  for (const v of [vk, vk1]) console.log(`      rond ${v.toFixed(2)}: vormlaag ${rondom(fr1, v, 'mod')}`);
  const aMet = ac1.filter((x) => x.a > 0.01);
  ok(`video-puls: het accent alleen rond een grens (${aMet.length} van ${ac1.length} beelden), na elke grens minstens één`,
    ac1.length > 0 && aMet.every((x) => grensBij(x.hoorA)) && [vk, vk1].every((v) => ac1.some((x) => x.hoorA >= v && x.hoorA < v + 1 && x.a > 0)),
    aMet.map((x) => `${x.hoorA.toFixed(2)}:${x.a.toFixed(2)}`).join(' '));
  // Per beeld de grens waar het het dichtst bij ligt. Na de grens: uit de
  // uitdoving volgt waar de piek lag; in de opkomst (vlak ervóór): 1 − afstand / 12 ms.
  const piekA = aMet.filter((x) => x.a > 0.05).map((x) => {
    const van = Math.abs(x.hoorA - vk) < Math.abs(x.hoorA - vk1) ? vk : vk1;
    return x.hoorA >= van ? Math.abs(x.hoorA + TAU * Math.log(x.a) - van) : Math.abs(1 - (van - x.hoorA) / OP - x.a) * OP;
  });
  ok(`video-puls: ook in teken() ligt de piek op de grens (max ${(Math.max(0, ...piekA) * 1000).toFixed(1)} ms ernaast, ${piekA.length} beelden)`,
    piekA.length >= 1 && Math.max(...piekA) < 0.01);
  // De flits in de effectstap = max(0,1 × tel, accent).
  const paren = fl1.map((x) => ({ f: x.f, ...ac1[x.n - 1] })).filter((x) => x.a !== undefined);
  const klopt = paren.every((x) => Math.abs(x.f - Math.max(0.1 * x.puls, x.a)) < 1e-6);
  const groot = paren.filter((x) => x.f > 0.11);
  ok(`de effectstap krijgt de flits: 0,1 × de tel, op de grens het accent (${groot.length} beelden boven 0,1, max ${Math.max(0, ...paren.map((x) => x.f)).toFixed(2)})`,
    paren.length > 0 && klopt && groot.length >= 1 && groot.every((x) => grensBij(x.hoorA)));

  // ---- Run 2: niemand die je hoort ---------------------------------------------
  console.log('\nrun 2: track 3 stil, track 1 met de fader dicht over de grens op ' + vk2.toFixed(2) + ' s');
  await druk('track.3.play');
  await zet('track.1.fader', 0);
  await evalueer(`${deck('A')}.seek(${vk2 - 1.5})`);
  const r2 = await meet(3);
  const { ac2 } = await evalueer('({ ac2: window.__accent.splice(0), fr: window.__frames.splice(0), fl: window.__flits.splice(0) })');
  const rond = r2.filter((x) => x.hoorA >= vk2 - 0.05 && x.hoorA < vk2 + 0.6);
  ok(`fader dicht: geen maatgever, en over de grens geen nieuwe sectie (${rond.length} metingen)`,
    rond.length >= 10 && r2.every((x) => x.wie === null) && rond.every((x) => x.n === 0));
  ok(`…de energie gleed naar 0 (${r2.at(-1)?.e})`, r2.at(-1)?.e === 0);
  // De eerste beelden van run 2 kunnen nog de laatste staart van de grens uit
  // run 1 hebben (die was na 1,2 s nog 0,0025 en dooft gewoon verder uit).
  const ac2Rond = ac2.filter((x) => x.hoorA >= vk2 - OP - 0.004 && x.hoorA < vk2 + 1);
  ok(`…en de video-puls geeft rond de grens geen accent (${ac2Rond.length} van ${ac2.length} beelden; daarvoor hooguit de staart van run 1: max ${Math.max(0, ...ac2.map((x) => x.a)).toExponential(1)})`,
    ac2Rond.every((x) => x.a === 0) && ac2.every((x) => x.a < 0.003));
  await druk('track.1.play');
}

try {
  let doelen = null;
  // Onder zware belasting start Chrome traag: tot 60 s wachten op een pagina.
  for (let i = 0; i < 300 && !doelen?.some((d) => d.type === 'page'); i++) {
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
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=1` });
  ok('de app start met ?vormen=1', await totdat('window.engine && window.videoMixer && window.vormen', 20000));
  ok('geen MIDI in dit tabblad', await evalueer('!navigator.requestMIDIAccess'));
  await doorloop();
  ok('geen fouten in de pagina', meldingen.length === 0, meldingen.join(' | '));
} catch (err) {
  ok('script liep door', false, err.message);
  if (serverLog) console.log(serverLog.split('\n').slice(-15).join('\n'));
  if (chromeLog) console.log('chrome:', chromeLog.split('\n').slice(-8).join('\n'));
} finally {
  try { ws?.close(); } catch (_) {}
  // Chrome met zijn hulpprocessen (de hele groep) en de server, en wachten tot
  // ze echt weg zijn: anders hield een hulpproces van de vorige Chrome de
  // debugpoort op 127.0.0.1 nog vast als je deze proef meteen opnieuw draaide
  // (gemeten: elke tweede keer "bind() failed", dan alleen [::1]).
  const weg = (p) => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve()
    : Promise.race([new Promise((r) => p.once('exit', r)), wacht(10000)]));
  try { process.kill(-chrome.pid, 'SIGTERM'); } catch (_) { chrome.kill(); }
  server.kill();
  await Promise.all([weg(chrome), weg(server)]);
  await wacht(500);
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch (_) {}
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN) van ${uitkomst.length}` : `\nAlles groen (${uitkomst.length} ok).`);
process.exit(rood ? 1 : 0);
