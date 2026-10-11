// Een hele sectie in de sampler, headless in echte Chrome (TASKS-SECTIES
// "Verweven" punt 6): binnenhalen, laden, de sectie die je hoort knippen
// (sampler.N.section, rij 3 van de modus sampler), de lengte = precies de
// sectie in hele maten, afspelen op de "1" van de maatgever, en na herladen
// staat de pad er nog (bewaard bij het nummer) en start hij weer op de "1".
//
// Zelfde opzet als secties.mjs: een EIGEN server op een eigen poort met een
// tijdelijke database en mediamap, de nep-yt-dlp (test/nep-ytdlp.mjs) met het
// synthetische nummer (test/synth-nummer.mjs: intro, couplet, opbouw, drop,
// break, drop, outro op 124 bpm) en de nep-splitter. Geen netwerk, geen MIDI
// (Chromium zonder navigator.requestMIDIAccess).
//
// Gebruik:  node tools/headless/sec-sampler.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8909) en VARVE_KIJK_DEBUG (9509). Chrome: VARVE_CHROME.
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
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8909, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9509;
const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-sampler-'));
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
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit', VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'),
    NEP_LOG: join(tmp, 'nep.log'), VARVE_STEMS_CMD: process.env.VARVE_STEMS_CMD || maakNepStems(tmp) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1920,1080',
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
async function maat(b, h) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: b, height: h, deviceScaleFactor: 1, mobile: false });
  await wacht(400);
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

/**
 * Valt de start van pad n op een "1" van track A (de maatgever)? Gemeten op
 * de audioklok: de "1"en van het grid via deck.ctxTimeOf, en de tel ervóór.
 */
const opDeEen = (n) => evalueer(`(() => {
  const d = window.engine.deck('A'), g = d.grid, p = window.engine.sampler.pads[${n}];
  if (!p || !p.speelt) return null;
  const b0 = g.volgendeVeelvoud(g.beatAt(d.position) - 1e-6);
  const enen = [0, 1, 2].map((i) => d.ctxTimeOf(g.timeOf(b0 + i * g.beatsPerBar)));
  const naast = Math.min(...enen.map((t) => Math.abs(t - p.start)));
  const tel = d.ctxTimeOf(g.next(d.position + 1e-3));
  return { start: p.start, naast, nu: window.engine.ctx.currentTime, volgendeTel: tel, rate: p.src.playbackRate.value };
})()`);

let trackId = null;
async function laadOpA() {
  await evalueer("document.getElementById('lib-btn').click()");
  ok('het nummer staat in de lijst', await totdat(rij('sectieS'), 180000));
  await evalueer(`${rij('sectieS')}.querySelector('button[data-deck="A"]').click()`);
  ok('op track 1', await totdat("window.engine.deck('A').duration > 150", 30000));
  ok('de secties komen van de server op het deck', await totdat("window.engine.deck('A').sectieKaart?.aantal >= 4 && window.engine.deck('A').grid", 60000));
  await evalueer("document.getElementById('lib-btn').click()");
  await wacht(500);
}

async function doorloop() {
  console.log('binnenhalen en laden');
  await evalueer("document.getElementById('lib-btn').click()");
  await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'https://www.youtube.com/watch?v=sectieS';
    v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await evalueer("document.getElementById('lib-btn').click()");
  await laadOpA();
  trackId = await evalueer("fetch('/api/library').then((r) => r.json()).then((j) => (j.tracks || j).find((t) => String(t.title || t.titel || '').includes('sectieS') || String(t.url || '').includes('sectieS'))?.id ?? null)");
  const k = await evalueer("window.engine.deck('A').sectieKaart.stukken.map((x) => ({ van: +x.van.toFixed(2), label: x.label, groep: x.groep }))");
  console.log('      ' + k.map((x) => `${x.van}s ${x.label} ${x.groep}`).join(' · '));

  console.log('\nde modus sampler: rij 3 = de sectie die je hoort');
  await evalueer("window.engine.setFocus('A')");
  await druk('layer.grid.sampler');
  await wacht(500);
  const rij3 = await evalueer(`[1, 2, 3, 8].map((n) => document.querySelector('.spg[data-action="sampler.' + n + '.section"] .spg-t')?.textContent ?? null)`);
  ok(`het scherm-als-APC toont rij 3 (${rij3.join(' · ')})`, rij3.every((t, i) => t === `sectie→${[1, 2, 3, 8][i]}`));
  ok('lampje van rij 3: 0,5 (kan: een lege pad, de focus-track heeft secties)', await act("a.read('sampler.2.section')") === 0.5);

  console.log('\nspelen, naar de drop, de sectie knippen');
  await druk('track.1.play');
  ok('speelt', await totdat("window.engine.deck('A').playing && window.engine.deck('A').position > 0.5", 15000));
  await druk('track.1.section.4');
  ok('naar sectie 4 (de eerste drop): je hoort hem', await totdat("window.engine.deck('A').sectieHier === 3", 10000));
  await wacht(1200);
  await druk('sampler.2.section');
  ok('pad 2 gevuld', await totdat('window.engine.sampler.pads[1]?.buffer', 15000));
  const knip = await evalueer(`import('/src/engine/secties.js').then(({ sectieEen }) => {
    const d = window.engine.deck('A'), g = d.grid, k = d.sectieKaart, p = window.engine.sampler.pads[1];
    const een = sectieEen(g, k.begin(3)), volgende = sectieEen(g, k.begin(4));
    return { van: p.van, tot: p.tot, tellen: p.tellen, bpm: p.bpm, duur: p.buffer.duration, sr: p.buffer.sampleRate,
      een, volgende, maten: (g.beatAt(volgende) - g.beatAt(een)) / g.beatsPerBar, per: g.beatsPerBar,
      vanIsEen: g.isMaatbegin(Math.round(g.beatAt(p.van))), totIsEen: g.isMaatbegin(Math.round(g.beatAt(p.tot))) };
  })`);
  console.log(`      knip ${knip.van.toFixed(3)}–${knip.tot.toFixed(3)} s, ${knip.tellen} tellen (${knip.tellen / knip.per} maten), ${knip.bpm.toFixed(2)} bpm; buffer ${knip.duur.toFixed(4)} s`);
  ok(`van = de "1" van de sectie, tot = de "1" van de volgende (${knip.een.toFixed(3)}–${knip.volgende.toFixed(3)})`,
    Math.abs(knip.van - knip.een) < 1e-6 && Math.abs(knip.tot - knip.volgende) < 1e-6 && knip.vanIsEen && knip.totIsEen);
  ok(`de lengte is precies de sectie in hele maten: ${knip.tellen} tellen = ${knip.maten} maten × ${knip.per}`,
    Number.isInteger(knip.maten) && knip.tellen === knip.maten * knip.per);
  ok(`… zoals het plan van het nummer: de drop is 16 maten (${knip.tellen / knip.per})`, knip.tellen === 16 * 4);
  ok(`de audio is precies zo lang (${knip.duur.toFixed(5)} s = ${(knip.tot - knip.van).toFixed(5)} s, binnen 1 sample)`,
    Math.abs(knip.duur - (knip.tot - knip.van)) <= 1 / knip.sr + 1e-9);
  ok('lampje van rij 3 nu uit (pad gevuld); pad 2 zelf donkerviolet (gevuld)',
    await act("a.read('sampler.2.section')") === null && await act("a.read('sampler.2')") === 0.5);
  ok(`bewaard bij het nummer: GET /api/library/<id>/samples geeft pad 2 met ${knip.tellen} tellen`,
    trackId && await evalueer(`fetch('/api/library/${trackId}/samples').then((r) => r.json()).then(({ samples }) => {
      const x = samples.find((s) => s.pad === 2); return !!x && x.tellen === ${knip.tellen} && Math.abs(x.van - ${knip.van}) < 1e-6 && Math.abs(x.tot - ${knip.tot}) < 1e-6; })`));

  console.log('\nafspelen op de "1"');
  await druk('sampler.2');
  const s1 = await opDeEen(1);
  ok(`pad 2 start op een "1" van track 1 (${(s1?.naast * 1000).toFixed(3)} ms naast; start ${s1?.start.toFixed(3)}, nu ${s1?.nu.toFixed(3)})`, s1 && s1.naast < 0.002);
  ok(`… op het tempo van de maat (rate ${s1?.rate.toFixed(5)})`, s1 && Math.abs(s1.rate - 1) < 0.01);
  ok('… en speelt', await totdat('window.engine.sampler.pads[1]?.speelt && window.engine.ctx.currentTime > window.engine.sampler.pads[1].start + 0.2', 5000));
  await maat(1440, 790);
  await foto('sec-sampler-1440.png');
  await druk('sampler.2');
  // Nog eens, een paar keer, op willekeurige plekken in de maat: altijd op de "1".
  // En minstens één keer terwijl de volgende TEL geen "1" was: anders bewijst dit niets.
  const naast = [], nietDeTel = [s1 && Math.abs(s1.volgendeTel - s1.start) > 0.01];
  for (let i = 0; i < 6; i++) {
    await wacht(300 + 270 * i);
    await druk('sampler.2');
    const m = await opDeEen(1);
    naast.push(m?.naast ?? 1);
    nietDeTel.push(!!m && Math.abs(m.volgendeTel - m.start) > 0.01);
    await druk('sampler.2');
  }
  ok(`zes keer opnieuw gestart, elke keer op de "1" (${naast.map((x) => (x * 1000).toFixed(2)).join(' · ')} ms)`, naast.every((x) => x < 0.002));
  ok(`… en ${nietDeTel.filter(Boolean).length} van de 7 keer was de volgende tel GEEN "1": hij wachtte op de maat, niet op de tel`, nietDeTel.some(Boolean));
  await druk('track.1.play');

  console.log('\nherladen: de pad is er nog');
  await cdp('Page.reload');
  ok('de app start opnieuw', await totdat('window.engine && window.videoMixer', 20000));
  await laadOpA();
  ok('pad 2 staat als bewaard (↺) op de sampler, met zijn tellen', await totdat(`(() => { const s = window.engine.sampler.stand()[1]; return s.bewaard && s.bewaardTellen === ${knip.tellen}; })()`, 15000));
  await druk('sampler.2');
  ok('klik: opnieuw geknipt, hetzelfde stuk', await totdat(`(() => { const p = window.engine.sampler.pads[1]; return p && Math.abs(p.van - ${knip.van}) < 1e-6 && Math.abs(p.tot - ${knip.tot}) < 1e-6 && p.tellen === ${knip.tellen}; })()`, 15000));
  await druk('track.1.play');
  ok('speelt', await totdat("window.engine.deck('A').playing && window.engine.deck('A').position > 0.5", 15000));
  await wacht(700);
  await druk('sampler.2');
  const s2 = await opDeEen(1);
  ok(`na herladen start hij weer op de "1" (${(s2?.naast * 1000).toFixed(3)} ms naast)`, s2 && s2.naast < 0.002);
  await evalueer("window.engine.setFocus('A')");
  await druk('layer.grid.sampler');
  await wacht(500);
  await maat(1920, 1080);
  await foto('sec-sampler-1920.png');
  await druk('sampler.2');
  await druk('track.1.play');

  // Review 6 okt (punt 1): de server bewaart elk begin afgerond (0,1 ms); ligt dat
  // net NA de "1", dan knipte de pad een maat te laat. Daarom ALLE secties, en de
  // "1"-en zelf uit het grid gerekend (isMaatbegin), niet via sectieEen.
  console.log('\nalle secties: van en tot op de "1"-en van het grid zelf');
  const alle = await evalueer(`import('/src/engine/sampler.js').then(async (S) => {
    const d = window.engine.deck('A'), g = d.grid, k = d.sectieKaart, sm = window.engine.sampler;
    const enen = [];
    for (let b = Math.floor(g.beatAt(0)) - 1; g.timeOf(b) <= d.duration + 1e-9; b++) if (g.timeOf(b) >= -1e-9 && g.isMaatbegin(b)) enen.push(b);
    const dichtst = (t) => enen.reduce((x, b) => (Math.abs(g.timeOf(b) - t) < Math.abs(g.timeOf(x) - t) ? b : x), enen[0]);
    const uit = [];
    for (let i = 0; i < Math.min(k.aantal, 8); i++) {
      sm.wis(i); sm.herinneringen[i] = null;
      const bVan = i === 0 ? enen[0] : dichtst(k.begin(i));
      const bTot = i + 1 < k.aantal ? dichtst(k.begin(i + 1)) : enen[enen.length - 1];
      const r = S.knipSectie(g, k, i, d.duration);             // het rekenwerk, ook waar het grid onzeker is
      // Onzeker volgens de strook van het grid (niet volgens de sampler zelf).
      const onzeker = g.strook(d.duration).some((x) => x.tot > g.timeOf(bVan) + 1e-6 && x.van < g.timeOf(bTot) - 1e-6 && x.soort !== 'zeker');
      let fout = null;
      await sm.neemSectie(i, d, i, { bron: 1 }).catch((e) => { fout = e.message; });
      const p = sm.pads[i];
      uit.push({ i, begin: k.begin(i), naNa: k.begin(i) - g.timeOf(bVan), onzeker,
        r: r && { van: r.van, tot: r.tot, tellen: r.tellen },
        pad: p ? { van: p.van, tot: p.tot, tellen: p.tellen, duur: p.buffer.duration, sr: p.buffer.sampleRate } : null,
        wilVan: g.timeOf(bVan), wilTot: g.timeOf(bTot), wilTellen: bTot - bVan, fout });
    }
    return uit;
  })`);
  const klopt = (x, y) => !!y && Math.abs(y.van - x.wilVan) < 1e-6 && Math.abs(y.tot - x.wilTot) < 1e-6 && y.tellen === x.wilTellen;
  for (const x of alle) {
    console.log(`      sectie ${x.i + 1}: begin ${x.begin.toFixed(4)} (${(x.naNa * 1000).toFixed(3)} ms na de "1"), de "1"-en ${x.wilVan.toFixed(4)}–${x.wilTot.toFixed(4)} = ${x.wilTellen} tellen`
      + ` → knipSectie ${x.r?.van.toFixed(4)}–${x.r?.tot.toFixed(4)} ${x.r?.tellen}; pad ${x.pad ? `${x.pad.tellen} tellen` : `geweigerd${x.onzeker ? ' (grid onzeker)' : ''}: ${x.fout}`}`);
  }
  ok(`knipSectie, alle ${alle.length} secties: van en tot op de "1"-en van het grid zelf, de tellen kloppen (${alle.filter((x) => klopt(x, x.r)).length}/${alle.length})`,
    alle.length >= 7 && alle.every((x) => klopt(x, x.r)));
  const naNa = alle.filter((x) => x.naNa > 0);
  ok(`… ook de ${naNa.length} secties waarvan de server het begin NA de "1" afrondde`, naNa.length > 0 && naNa.every((x) => klopt(x, x.r)));
  const zeker = alle.filter((x) => !x.onzeker);
  ok(`als pad (neemSectie): de ${zeker.length} secties op een zeker grid geknipt zoals gerekend, de audio even lang`,
    zeker.length > 0 && zeker.every((x) => klopt(x, x.pad) && Math.abs(x.pad.duur - (x.pad.tot - x.pad.van)) <= 1 / x.pad.sr + 1e-9));
  ok(`… en de ${alle.length - zeker.length} waar het grid onzeker is geweigerd met die reden (geen pad die naast de tel loopt)`,
    alle.filter((x) => x.onzeker).every((x) => !x.pad && /onzeker/.test(x.fout ?? '')));
  const plan = s.plan.map((p) => p[2] * 4);
  ok(`… en de lengtes van het plan van het nummer (${alle.map((x) => x.r?.tellen / 4).join(' · ')} maten; plan ${plan.map((t) => t / 4).join(' · ')})`,
    alle.length === plan.length && alle.every((x, i) => x.r?.tellen === plan[i]));
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
  await maat(1440, 790);
  for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/?vormen=0` });
  ok('de app start', await totdat('window.engine && window.videoMixer', 20000));
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
