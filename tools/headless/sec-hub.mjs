// De sectie naar de AV-app-hub (PROTOCOL §18), van begin tot eind in echte Chrome
// (TASKS-SECTIES, Verweven 11; src/control/hub.js, docs/SECTIES.md §7):
//
//   1. zonder ?hub=: hub.js niet geladen, geen WebSocket (er verandert niets)
//   2. de conformiteitstoets van de hub zelf (toetsApp uit tools/nep-hub.mjs) MET MUZIEK: het
//      nummer speelt, dus worden ook de §18-punten getoetst (levert, globaal pas na het manifest en
//      alleen sectie.*, hooguit 10×/s, na herverbinden de sectie opnieuw zonder nieuw)
//   3. de ECHTE hub (startHub uit de hub-repo, eigen poort, standaard 7721, opname: false, nep-APC)
//      en een beeld-app die meeluistert (een gewone manifest-app op een WebSocket):
//      - de hub ziet levert: ['sectie'] en varve-dj als bron (beeld().bronnen.sectie)
//      - bij elke grens die je hoort precies één sectie.nieuw: de teller van de hub verspringt één
//        keer, en VARVE stuurde hem binnen een tik (SECTIE_MS) nadat je de grens hoort
//      - energie en label = die van de sectie die je hoort (de kaart)
//      - een sprong naar een andere sectie (track.1.section.K, valt in op de "1"): ook precies één
//      - herverbinden: geen klap (de teller blijft staan), energie en label kloppen
//      - een loop van 1 tel op de "1" van een sectie: één klap, niet één per rondgang (geen stroboscoop)
//      - pauze: de energie blijft eerst een halve seconde staan (een cut in de mix), dan naar 0, geen klap
//   Met een hub van vóór §18 (geen src/core/bijdragen.js): VARVE stuurt de sectie toch, de hub negeert
//   hem (grondregel 5): geen sectie bij de beeld-app, VARVE blijft op dezelfde socket, geen fout, de APC werkt.
//
// VEILIG met de echte mixer (8777) en de echte hub (7700) aan: eigen poorten, geen MIDI en geen HID
// in de hub (NepSysteem, hid null), geen opname (opname: false), requestMIDIAccess is een spion
// die weigert. Eigen server met tijdelijke database, media, patronen en plannen.
//
// Gebruik:  VARVE_HUB_REPO=<AV-app-hub met §18> node tools/headless/sec-hub.mjs
// Poorten:  VARVE_KIJK_POORT (8921), VARVE_KIJK_DEBUG (9521), VARVE_HUB_POORT (7721). Chrome: VARVE_CHROME.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakNepYtdlp } from '../../test/nep-ytdlp.mjs';
import { maakNepStems } from '../../test/nep-stems.mjs';
import { synthNummer } from '../../test/synth-nummer.mjs';
import { SECTIE_MS } from '../../src/control/hub.js';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const HUB = process.env.VARVE_HUB_REPO || join(WORTEL, '../av-app-hub');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8921, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9521;
const HUB_POORT = Number(process.env.VARVE_HUB_POORT) || 7721;
for (const [naam, p] of [['VARVE_KIJK_POORT', POORT], ['VARVE_HUB_POORT', HUB_POORT]]) {
  if (p === 8777 || p === 7700) { console.error(`${naam}=${p}: daar draaien de echte mixer en hub; kies een andere poort`); process.exit(2); }
}
for (const f of ['src/hub.js', 'src/ports/nep.js', 'tools/nep-hub.mjs']) {
  if (!existsSync(join(HUB, f))) { console.error(`geen AV-app-hub in ${HUB} (${f} ontbreekt; zet VARVE_HUB_REPO)`); process.exit(2); }
}
// Een hub van vóór PROTOCOL §18 (zonder src/core/bijdragen.js) negeert `levert` en de globaal van een app:
// dan toetsen we alleen dat VARVE daar niet van in de war raakt (zelfde socket, geen fout, de APC werkt).
const P18 = existsSync(join(HUB, 'src/core/bijdragen.js'));
const { startHub } = await import(join(HUB, 'src/hub.js'));
const { NepSysteem } = await import(join(HUB, 'src/ports/nep.js'));
const { laadConfig } = await import(join(HUB, 'src/config.js'));
const { toetsApp } = await import(join(HUB, 'tools/nep-hub.mjs'));
const { default: WebSocket } = await import(join(HUB, 'node_modules/ws/index.js'));

const tmp = mkdtempSync(join(tmpdir(), 'varve-sec-hub-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

// Het synthetische nummer als stereo WAV op 48 kHz: dat wordt de "download" (zeven secties op 124 bpm).
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
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_HERANALYSE: 'uit',
    VARVE_YTDLP: maakNepYtdlp(tmp), NEP_BRON: join(tmp, 'bron.wav'), NEP_LOG: join(tmp, 'nep.log'),
    VARVE_STEMS_CMD: process.env.VARVE_STEMS_CMD || maakNepStems(tmp) },
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
const waarschuwingen = [];   // console.warn('[hub]', …) in de pagina: een fout van de hub
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
  while (Date.now() - t0 < maxMs) { if (await evalueer(`!!(${expr})`).catch(() => false)) return true; await wacht(40); }
  return false;
}
const tot = async (fn, ms = 8000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(40); } return fn(); };
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const act = (expr) => evalueer(`import('/src/control/actions.js').then((a) => ${expr})`);
const druk = (id) => act(`(a.invoke(${JSON.stringify(id)}, true), a.invoke(${JSON.stringify(id)}, false))`);
const rij = (deel) => `[...document.querySelectorAll('#lib-panel .lib-rij')].find((x) => x.querySelector('.lib-titel')?.textContent.includes(${JSON.stringify(deel)}))`;
const D = "window.engine.deck('A')";
const BASIS = `http://localhost:${POORT}/`;

/** Opent VARVE met ?hub=, laadt het nummer op track 1 (eerst binnenhalen als het er nog niet is). */
async function openMetHub(url, binnenhalen) {
  await cdp('Page.navigate', { url: `${BASIS}?vormen=0&hub=${encodeURIComponent(url)}` });
  if (!await totdat('window.engine && window.midi && window.midi.lezer', 20000)) throw new Error('de app start niet met de hub');
  // De audioklok moet lopen (headless start het apparaat soms pas seconden later): zoals sec-vorm.mjs.
  await evalueer('window.engine.resume()');
  if (!await totdat("window.engine.ctx.state === 'running' && window.engine.ctx.currentTime > 0.05", 10000)) throw new Error('de audioklok loopt niet');
  await evalueer("document.getElementById('lib-btn').click()");
  if (binnenhalen) {
    await evalueer(`(() => { const v = document.querySelector('#lib-panel .lib-url'); v.value = 'https://www.youtube.com/watch?v=secHub';
      v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  }
  if (!await totdat(rij('secHub'), 90000)) throw new Error('het nummer staat niet in de lijst');
  await evalueer(`${rij('secHub')}.querySelector('button[data-deck="A"]').click()`);
  if (!await totdat(`${D}.duration > 150 && ${D}.sectieKaart?.aantal >= 6`, 60000)) throw new Error('geen nummer met secties op track 1');
  await evalueer("document.getElementById('lib-btn').click()");
  // Elke globaal die VARVE de hub stuurt, met wat je op dat moment HOORT (hoorbaar.js), en Date.now.
  await evalueer(`import('/src/engine/hoorbaar.js').then((H) => {
    window.__glob = [];
    const m = window.midi, stuur = m._stuur.bind(m);
    m._stuur = (b) => {
      if (b.t === 'globaal' && m.open) {
        const d = window.engine.deck('A'), V = H.uitgangsVertraging(window.engine.ctx), hoor = H.hoorbaar(d, V);
        const st = d.sectieKaart?.stukken ?? [];
        let i = -1; for (let k = 0; k < st.length; k++) if (st[k].van <= hoor) i = k;
        window.__glob.push({ w: b.waarden, nu: Date.now(), hoor, i, van: i >= 0 ? st[i].van : null, rate: d.rate, ws: m.ws });
      }
      return stuur(b);
    };
    return true;
  })`);
}
/** De sectiebegins, labels en energieën van track 1. */
const kaart = () => evalueer(`${D}.sectieKaart.stukken.map((x) => ({ van: x.van, label: x.label, energie: x.energie }))`);
/** Naar `t` (tracktijd) en spelen, tenzij hij al speelt. */
async function speelVanaf(t) {
  await evalueer(`${D}.seek(${t})`);
  if (!await evalueer(`${D}.playing`)) await druk('track.1.play');
  return totdat(`${D}.playing`, 5000);
}
const hoort = () => evalueer(`import('/src/engine/hoorbaar.js').then((H) => H.hoorbaar(${D}, H.uitgangsVertraging(window.engine.ctx)))`);
async function wachtTotGehoord(t, ms = 15000) {
  const eind = Date.now() + ms;
  while (Date.now() < eind) { if (await hoort() >= t) return true; await wacht(40); }
  return false;
}
const glob = () => evalueer('window.__glob.map(({ ws, ...x }) => x)');
const rond = (e) => Math.round(e * 1000) / 1000;

async function doorloop() {
  console.log('zonder ?hub=: er verandert niets');
  await cdp('Page.navigate', { url: `${BASIS}?vormen=0` });
  ok('de app start', await totdat('window.engine && window.videoMixer', 20000));
  await wacht(800);
  const geladen = await evalueer("performance.getEntriesByType('resource').map((r) => r.name).filter((u) => /control\\/hub\\.js/.test(u))");
  ok('hub.js niet geladen, geen WebSocket', geladen.length === 0 && await evalueer('window.__ws.length === 0'), geladen.join(', '));

  // ---- 2. de conformiteitstoets van de hub, met muziek ------------------------------------
  console.log('\nde conformiteitstoets van de hub (toetsApp), met het nummer aan');
  let st = null;
  const r = await toetsApp({
    poort: 0, timeoutMs: 120000,
    start: async (url) => {
      await openMetHub(url, true);
      st = await kaart();
      // Midden in de tweede sectie (lang genoeg voor de hele toets), en spelen: VARVE levert dan een sectie.
      await speelVanaf(st[1].van + 1);
      await totdat('window.__glob.some((x) => x.w["sectie.label"])', 8000);
    },
  });
  for (const u of r.uitslagen) ok(`toetsApp: ${u.naam}`, u.ok, u.detail);
  ok(`toetsApp: ${r.app} conform PROTOCOL.md`, r.ok);
  const t18 = r.uitslagen.filter((u) => /levert|globaal/.test(u.naam));
  if (P18) {
    ok(`… de §18-punten zijn echt getoetst (${t18.length}: ${t18.map((u) => u.naam).join('; ')})`,
      t18.length >= 3 && t18.every((u) => u.ok) && r.uitslagen.some((u) => /na herverbinden de sectie opnieuw/.test(u.naam)));
  } else console.log('      (een hub zonder §18: zijn toets kent levert en de globaal van een app nog niet, en noemt ze ook geen fout)');
  console.log(`      secties: ${st.map((x) => `${x.label} ${x.van.toFixed(2)} (${x.energie})`).join(' · ')}`);

  // ---- 3. de echte hub en een beeld-app die meeluistert -----------------------------------
  console.log(`\nde echte hub (poort ${HUB_POORT}) met een beeld-app die meeluistert`);
  const ontvangen = [];   // { nu, w } van elke globaal die de beeld-app kreeg
  const beeld = new WebSocket(appUrl);
  let hb = null;
  beeld.on('open', () => {
    beeld.send(JSON.stringify({ t: 'hallo', app: 'beeld-luistert', inst: 'x1', v: 1 }));
    beeld.send(JSON.stringify({ t: 'manifest', manifest: { v: 1, app: 'beeld-luistert', naam: 'Beeld', params: [{ id: 'x', naam: 'X', soort: 'waarde' }] } }));
    beeld.send(JSON.stringify({ t: 'staat', waarden: { x: 0 } }));
    hb = setInterval(() => beeld.send('{"t":"hb"}'), 500);
  });
  beeld.on('message', (d) => { const b = JSON.parse(String(d)); if (b.t === 'globaal') ontvangen.push({ nu: Date.now(), w: b.waarden }); });
  beeld.on('close', () => clearInterval(hb));
  ok(`de beeld-app is aangemeld${P18 ? ' (de teller sectie.nieuw staat vanaf de start op 0)' : ''}`, await tot(() => ontvangen.some((x) => (P18 ? x.w['sectie.nieuw'] === 0 : true))));
  // Wat de beeld-app nu weet: de laatste waarde van elke sleutel, en hoe vaak de teller versprong (een klap).
  const weet = () => {
    const w = {}; let klap = 0, vorige = null;
    for (const x of ontvangen) {
      Object.assign(w, x.w);
      if ('sectie.nieuw' in x.w) { if (vorige !== null && x.w['sectie.nieuw'] !== vorige) klap++; vorige = x.w['sectie.nieuw']; }
    }
    return { ...w, klap };
  };
  const klappen = () => { const uit = []; let vorige = null; for (const x of ontvangen) if ('sectie.nieuw' in x.w) { if (vorige !== null && x.w['sectie.nieuw'] !== vorige) uit.push(x); vorige = x.w['sectie.nieuw']; } return uit; };

  await openMetHub(appUrl, false);
  ok('VARVE aangemeld bij de echte hub', await tot(() => echt.kern.beeld().apps.some((a) => a.app === 'varve-dj' && a.status === 'actief'), 10000));
  st = await kaart();
  if (!P18) {
    console.log('\neen hub zonder §18: VARVE stuurt de sectie, de hub negeert hem');
    echt.kern.focus('varve-dj');
    await evalueer('window.__wsOud = window.midi.ws');
    const waarschuwingVoor = waarschuwingen.length, ledsVoor = apc.verstuurd.length;
    await speelVanaf(st[1].van - 2);
    ok(`je hoort de grens naar ${st[1].label}`, await wachtTotGehoord(st[1].van + 0.6));
    await wacht(500);
    const g = await glob();
    ok(`VARVE stuurde de sectie, ook een nieuw (${g.length} globaal): een oude hub kent levert niet en negeert de globaal`, g.some((x) => x.w['sectie.nieuw'] === true));
    ok('de beeld-app krijgt geen sectie (de oude hub geeft hem niet door)', !ontvangen.some((x) => Object.keys(x.w).some((k) => k.startsWith('sectie.'))));
    ok(`VARVE blijft verbonden op dezelfde socket, zonder fout of melding van de hub (${waarschuwingen.slice(waarschuwingVoor).join(' | ') || 'geen [hub]-waarschuwing'})`,
      await evalueer('window.midi.ws === window.__wsOud && window.midi.open && !window.midi.status().hub.vervangen') && waarschuwingen.length === waarschuwingVoor);
    ok('de hub houdt VARVE actief, en de lampjes van VARVE komen op de APC', echt.kern.beeld().apps.some((a) => a.app === 'varve-dj' && a.status === 'actief')
      && await tot(() => apc.verstuurd.length > ledsVoor, 3000), `${apc.verstuurd.length - ledsVoor} berichten naar de APC`);
    await druk('track.1.play');
    ok('requestMIDIAccess NOOIT aangeroepen', await evalueer('window.__midi === 0'));
    beeld.close();
    return;
  }
  const dj = [...echt.kern.apps.values()].find((a) => a.app === 'varve-dj');
  ok('de hub kreeg levert: ["sectie"] in het manifest, en varve-dj is de bron', JSON.stringify(dj?.manifest?.levert) === '["sectie"]'
    && echt.kern.beeld().bronnen?.sectie === 'varve-dj', `${JSON.stringify(dj?.manifest?.levert)}, bron ${echt.kern.beeld().bronnen?.sectie}`);
  ok('nog niets gespeeld: nog geen energie en label in globaal', !('sectie.energie' in echt.kern.beeld().globaal));

  /** Speelt over grens k (doorlopend) en kijkt naar de klap: precies één, op tijd, met energie en label. */
  async function overGrens(k, waarom) {
    const voorKlap = weet().klap, voorGlob = (await glob()).length;
    ok(`${waarom}: je hoort de grens naar ${st[k].label} (${st[k].van.toFixed(2)} s)`, await wachtTotGehoord(st[k].van + 0.6));
    await wacht(200);
    const g = (await glob()).slice(voorGlob).filter((x) => x.w['sectie.nieuw'] === true);
    const kl = klappen().slice(voorKlap);
    ok(`… precies één sectie.nieuw van VARVE en één klap bij de beeld-app (teller ${weet()['sectie.nieuw']})`, g.length === 1 && kl.length === 1 && weet().klap === voorKlap + 1,
      `${g.length} gestuurd, ${kl.length} klappen`);
    const laat = g[0] ? (g[0].hoor - st[k].van) / g[0].rate : NaN;
    ok(`… VARVE stuurde hem ${(laat * 1000).toFixed(1)} ms nadat je de grens hoort (binnen een tik van ${SECTIE_MS} ms)`,
      g[0]?.i === k && laat >= 0 && laat <= SECTIE_MS / 1000 + 0.005);
    ok(`… de beeld-app kreeg hem ${kl[0] && g[0] ? kl[0].nu - g[0].nu : '?'} ms later, met label ${kl[0]?.w['sectie.label']} en energie ${kl[0]?.w['sectie.energie']} (kaart: ${st[k].label}, ${rond(st[k].energie)})`,
      kl[0]?.w['sectie.label'] === st[k].label && kl[0]?.w['sectie.energie'] === rond(st[k].energie) && kl[0].nu - g[0].nu < 100);
  }

  console.log('\nspelen, doorlopend over twee grenzen');
  await speelVanaf(st[1].van - 3);
  ok('spelen: energie en label van de intro bij de beeld-app, zonder klap', await tot(() => weet()['sectie.label'] === st[0].label && weet().klap === 0, 5000),
    `${weet()['sectie.label']} ${weet()['sectie.energie']}`);
  await overGrens(1, 'doorlopend');
  await evalueer(`${D}.seek(${st[2].van - 2.5})`);   // een sprong midden in een sectie: geen nieuwe sectie
  await overGrens(2, 'na een seek midden in de sectie, doorlopend');

  console.log('\neen sprong naar een andere sectie (track.1.section.K, valt in op de "1")');
  {
    await wacht(1500);
    const k = st.findIndex((x, i) => i > 3 && x.label === 'drop');
    await druk(`track.1.section.${k + 1}`);
    ok(`track.1.section.${k + 1}: de sectie op de maat is ${st[k].label}`, await totdat(`${D}.sectieOpDeMaat === ${k}`, 3000));
    await overGrens(k, 'de sprong valt in');
  }

  console.log('\nherverbinden: geen klap');
  {
    await wacht(500);
    const voor = weet(), voorGlob = (await glob()).length;
    await evalueer('(window.__wsVoor = window.midi.ws).close()');
    ok('VARVE verbindt opnieuw (een nieuwe socket)', await totdat('window.midi.ws && window.midi.ws !== window.__wsVoor && window.midi.open', 8000));
    await wacht(1500);
    const na = weet(), g = (await glob()).slice(voorGlob);
    ok(`geen klap bij de beeld-app (teller ${voor['sectie.nieuw']} -> ${na['sectie.nieuw']})`, na.klap === voor.klap && na['sectie.nieuw'] === voor['sectie.nieuw']);
    ok(`VARVE stuurde na het herverbinden de sectie van nu, zonder nieuw (${JSON.stringify(g[0]?.w)})`,
      g.length >= 1 && !('sectie.nieuw' in g[0].w) && g[0].w['sectie.label'] === st[g[0].i]?.label);
    ok(`… energie en label kloppen bij de beeld-app (${na['sectie.label']}, ${na['sectie.energie']})`, na['sectie.label'] === st[g[0]?.i]?.label && na['sectie.energie'] === rond(st[g[0]?.i]?.energie ?? -1));
  }

  console.log('\neen loop van 1 tel op de "1" van een sectie: één klap, geen stroboscoop');
  {
    const k = st.findIndex((x, i) => i > 3 && x.label === 'drop');
    const voorKlap = weet().klap, voorGlob = (await glob()).length;
    // Vlak vóór het begin van de drop, met een loop van één tel op zijn "1": je hoort de drop één keer
    // beginnen, en daarna elke tel opnieuw (een stutter, ~8 keer in 4 s).
    await evalueer(`(() => { const d = ${D}, g = d.grid, b = ${st[k].van}; d.seek(b - 0.6); d.setLoopRange(b, g.timeOf(g.beatAt(b) + 1)); })()`);
    ok('de loop staat aan', await evalueer(`!!${D}.loop`));
    await wacht(4200);
    const rondes = await evalueer(`(${D}.loop ? 1 : 0)`);
    const kl = klappen().slice(voorKlap), g = (await glob()).slice(voorGlob).filter((x) => x.w['sectie.nieuw'] === true);
    ok(`4 s lang een loop van 1 tel op de "1" van de drop: één klap bij de beeld-app (${kl.length}) en één nieuw van VARVE (${g.length}), niet één per rondgang`,
      rondes === 1 && kl.length === 1 && g.length === 1);
    await evalueer(`${D}.clearLoop()`);
  }

  console.log('\npauze: de energie naar 0');
  {
    const voor = { ...weet(), nu: Date.now() };
    await druk('track.1.play');
    ok('track 1 staat stil', await totdat(`!${D}.playing`, 3000));
    const nul = await tot(() => weet()['sectie.energie'] === 0, 4000);
    const energieen = ontvangen.filter((x) => x.nu > voor.nu && 'sectie.energie' in x.w).map((x) => x.w['sectie.energie']);
    ok(`de beeld-app krijgt energie 0, glijdend (${energieen.join(' ')}), zonder klap; het label blijft staan (${weet()['sectie.label']})`,
      nul && weet().klap === voor.klap && weet()['sectie.label'] === voor['sectie.label']);
  }
  const h = await evalueer('window.midi.status().hub.sectie');
  ok(`VARVE telt even veel nieuwe secties als de beeld-app klappen zag (${h?.nieuw} / ${weet().klap}): vier grenzen, vier klappen`,
    h?.nieuw === weet().klap && weet().klap === 4);
  {
    const g = (await glob()).map((x) => x.nu);
    let max = 0;
    for (let i = 0, j = 0; i < g.length; i++) { while (g[i] - g[j] >= 1000) j++; max = Math.max(max, i - j + 1); }
    ok(`hooguit 10×/s een globaal van VARVE (${g.length} in totaal, hooguit ${max} binnen 1 s)`, max <= 10);
  }
  ok('requestMIDIAccess NOOIT aangeroepen', await evalueer('window.__midi === 0'));
  beeld.close();
}

let echt = null, appUrl = null, apc = null;
try {
  // De hub: config zoals op de Mac, geen MIDI (NepSysteem met een nep-APC), geen HID, geen drivers en GEEN opname.
  const systeem = new NepSysteem();
  apc = systeem.voegToe('APC40 mkII');
  echt = await startHub({ config: { ...laadConfig(), hotplug_ms: 20 }, systeem, poort: HUB_POORT, drivers: false, opname: false });
  appUrl = echt.adres.replace('http', 'ws') + '/app';
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (msg.id && wachtend.has(msg.id)) { const w = wachtend.get(msg.id); wachtend.delete(msg.id); msg.error ? w.fout(new Error(msg.error.message)) : w.ok(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') meldingen.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning' && msg.params.args[0]?.value === '[hub]') waarschuwingen.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__midi = 0; window.__ws = [];
    Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true,
      value: () => { window.__midi++; return Promise.reject(new DOMException('geen MIDI in de test', 'SecurityError')); } });
    const Echt = window.WebSocket;
    window.WebSocket = class extends Echt { constructor(url, p) { super(url, p); window.__ws.push(String(url)); } };` });
  for (let i = 0; i < 100; i++) { if (await fetch(BASIS).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await doorloop();
  const echteFouten = meldingen.filter((x) => !/geen MIDI in de test/.test(x));
  ok('geen fouten in de pagina', echteFouten.length === 0, echteFouten.join(' | '));
} catch (err) {
  ok('script liep door', false, err.stack || err.message);
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await echt?.stop().catch(() => {});
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)${serverLog.includes('Error') ? `\nserver:\n${serverLog.slice(-1500)}` : ''}` : `\nAlles groen (${uitkomst.length} checks).`);
process.exit(rood ? 1 : 0);
