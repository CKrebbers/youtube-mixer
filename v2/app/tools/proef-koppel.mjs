/**
 * Proef van de koppeling met de Stroommachine (src/koppel/) in echte Chromium (headless).
 *
 *   node tools/proef-koppel.mjs [--scherm uit.png]
 *
 * Deel 1 (altijd): de ECHTE engine met de audiolaag van Chrome, twee demonummers, de echte opzet van
 * beeld (#paneel-beeld) met het koppelpaneel erin, en een NEP-WebSocket in de pagina die zich gedraagt als
 * relay + Stroommachine (pings met een oplopende teller, elke seconde een beeld-status) en alles opschrijft.
 * Wat hij meet: uit = geen WebSocket; aan via het paneel; het manifest eerst; de klok = de hoorbare tel van
 * de maatklok; kenmerken uit de ECHTE master-analyser (mix.* > 0 met muziek); track pas na de eerste
 * beeld-status, met varve:demo-<id>; mix bij de crossfader; een macro via de bus; herladen (de teller
 * begint opnieuw) = de track gaat opnieuw; uit = de socket dicht en niets meer; de rij staat in het paneel.
 *
 * Deel 2 (als de Stroommachine-repo er is, VARVE_STROOM_REPO of ~/Projects/stroommachine of naast
 * youtube-mixer): de ECHTE relay (tools/varve-relay.js, geen afhankelijkheden) en de ECHTE Stroommachine
 * (haar index.html, file://, ?hub=…&dj, SwiftShader). Wat hij meet: ze ontvangt VarveDJ en volgt het
 * tempo; de tel loopt gelijk (zoals haar eigen tools/test-dj.mjs: < 0,35 tel, headless ~1 beeld/s); deck A
 * bepaalt de scène, de crossfader voorbij het midden wisselt naar deck B; een macro komt aan; de beeld-status
 * komt terug in VarveDJ; na F5 van de Stroommachine komen de tracks vanzelf terug; uit = ze valt terug op
 * haar eigen klok.
 *
 * Playwright staat globaal op de machine (PLAYWRIGHT_MODULE); de app heeft geen afhankelijkheden.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';

const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const schermPad = process.argv.includes('--scherm') ? process.argv[process.argv.indexOf('--scherm') + 1] : null;
const STROOM = process.env.VARVE_STROOM_REPO || [join(homedir(), 'Projects', 'stroommachine'), join(APP, '..', '..', '..', 'stroommachine')]
  .find((p) => existsSync(join(p, 'tools', 'varve-relay.js')) && existsSync(join(p, 'index.html')));
const RELAY_POORT = 7798;

const uitslag = [];
const ok = (naam, goed, detail = '') => { uitslag.push({ naam, goed: !!goed }); console.log(`${goed ? '  ok  ' : 'FOUT  '}${naam}${detail ? ` — ${detail}` : ''}`); };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- de proefpagina ------------------------------------------------------------------------
const PROEF = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>proef koppel</title>
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/src/beeld/beeld.css"></head>
<body style="padding:8px"><div class="paneel" id="paneel-beeld" data-paneel="beeld" style="width:1180px"></div>
<script type="module">
import { Engine } from '/src/engine/engine.js';
import { maakAudio } from '/src/audio/index.js';
import { opzetBeeld } from '/src/beeld/opzet.js';
import { Luisteraar } from '/src/beeld/analyse/luisteraar.js';
import { maakDemo, DEMOS } from '/src/ui/bronnen.js';
import { BeeldKoppeling } from '/src/koppel/beeld.js';
import { definieerKoppeling } from '/src/koppel/acties.js';
import { opzetKoppelPaneel } from '/src/ui/koppel-paneel.js';

const nep = new URLSearchParams(location.search).has('nep');
const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
await ctx.resume();
const engine = new Engine({ ctx, audio: maakAudio() });
await engine.klaar;
const meldingen = [];
engine.on('melding', (m) => meldingen.push(m));
opzetBeeld({ engine, bus: engine.bus, paneel: document.getElementById('paneel-beeld'), analyser: engine.mixer.analyser, doek: { breedte: 320, hoogte: 180 } });

// De nep-relay + Stroommachine: pings (oplopende teller) en elke seconde een beeld-status; alles opschrijven.
const socks = [];
let wsGemaakt = 0;
class NepWS {
  constructor(url) {
    wsGemaakt++;
    this.url = url; this.readyState = 0; this.uit = []; this.lsn = []; this.teller = 0; socks.push(this);
    setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); }, 30);
    this.taak = setInterval(() => {
      if (this.readyState !== 1 || !this.leeft) return;
      this.krijg({ naar: 'varvedj', type: 'ping', id: ++this.teller, t0: performance.now(), van: 'stroommachine' });
      this.krijg({ naar: 'varvedj', van: 'stroommachine', type: 'beeld-status', regime: 'Gloed', scene: 'Nep', bpm: 124, volgt: true, fps: 60 });
    }, 500);
  }
  addEventListener(t, f) { if (t === 'message') this.lsn.push(f); }
  send(s) { this.uit.push(JSON.parse(s)); }
  close() { this.readyState = 3; clearInterval(this.taak); }
  krijg(o) { const e = { data: JSON.stringify(o) }; for (const f of this.lsn) f(e); this.onmessage?.(e); }
}
const koppeling = new BeeldKoppeling({ engine, luisteraar: new Luisteraar({ analyser: () => engine.mixer.analyser, sampleRate: () => ctx.sampleRate }),
  WebSocketImpl: nep ? NepWS : WebSocket, mag: true });
definieerKoppeling(engine.bus, koppeling);
const geheugen = new Map();
const opslag = { getItem: (k) => geheugen.get(k) ?? null, setItem: (k, v) => geheugen.set(k, String(v)) };
const paneel = opzetKoppelPaneel({ koppeling, bus: engine.bus, wortel: document.getElementById('paneel-beeld'), opslag,
  meld: (t, s, k) => meldingen.push({ tekst: t, soort: s, sleutel: k }) });

async function laadDemo(n, i) {
  const d = maakDemo(DEMOS[i]);
  const pcm = d.maakPcm();
  return engine.laad(n, { id: d.id, titel: d.titel, artiest: 'demo', duur: d.duur, grid: d.grid, demo: true, haal: async () => pcm });
}
const hoor = () => { const c = koppeling.klok(); return { p: performance.now(), beat: c?.beat ?? null, bpm: c?.bpm ?? null, speelt: c?.speelt ?? null, tel: engine.hoorbareTel() }; };
window.proef = { engine, koppeling, paneel, laadDemo, socks, meldingen, hoor, geheugen, ws: () => wsGemaakt };
</script></body></html>`;

// ---- de server ------------------------------------------------------------------------------
const SOORT = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const kop = (res, status, soort) => res.writeHead(status, {
  'content-type': soort, 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
});
const server = createServer((req, res) => {
  try {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pad === '/proef.html') { kop(res, 200, SOORT['.html']); return res.end(PROEF); }
    if (pad === '/racks/sjablonen.json' && existsSync(join(APP, 'racks', 'sjablonen.json'))) { kop(res, 200, SOORT['.json']); return res.end(readFileSync(join(APP, 'racks', 'sjablonen.json'))); }
    if (/^\/(styles\.css|src\/[\w/.-]+\.(js|css))$/.test(pad) && !pad.includes('..')) {
      const bestand = normalize(join(APP, pad));
      if (bestand.startsWith(APP + sep) && existsSync(bestand)) { kop(res, 200, SOORT[extname(bestand)]); return res.end(readFileSync(bestand)); }
    }
    kop(res, 404, 'text/plain'); res.end();
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASIS = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fouten = [];
const luister = (p, naam, negeer = () => false) => {
  p.on('pageerror', (e) => fouten.push(`${naam}: ${e}`));
  p.on('console', (m) => { if (m.type() === 'error' && !negeer(m.text())) fouten.push(`${naam}: ${m.text()}`); });
};
let relay = null;

try {
  // ---- deel 1: de nep-WebSocket in de pagina ---------------------------------------------------
  console.log('deel 1: echte engine en audio, nep-relay in de pagina');
  const ctx1 = await browser.newContext({ viewport: { width: 1200, height: 260 } });
  const p = await ctx1.newPage();
  luister(p, 'nep');
  await p.goto(`${BASIS}/proef.html?nep`);
  await p.waitForFunction(() => window.proef, null, { timeout: 20000 });
  const plek = await p.evaluate(() => {
    const rij = document.querySelector('#paneel-beeld .beeld-bediening > .beeld-koppel');
    const r = rij?.getBoundingClientRect(), pan = document.getElementById('paneel-beeld').getBoundingClientRect();
    return { er: !!rij, eerste: rij?.parentElement.firstElementChild === rij, h: r?.height ?? 0, binnen: r ? r.right <= pan.right + 1 : false, panH: pan.height };
  });
  ok('de rij staat bovenaan de bediening van #paneel-beeld', plek.er && plek.eerste, `rij ${plek.h.toFixed(0)} px hoog, paneel ${plek.panH.toFixed(0)} px`);
  ok('de rij past (één regel, niet breder dan het paneel)', plek.h > 0 && plek.h <= 32 && plek.binnen, `${plek.h.toFixed(0)} px`);
  await p.evaluate(async () => { await proef.laadDemo(1, 0); await proef.laadDemo(2, 1); });
  await p.evaluate(() => proef.engine.bus.doe('track.1.play', true));
  await wacht(1200);
  ok('uit: geen WebSocket gemaakt', await p.evaluate(() => proef.ws()) === 0);
  await p.fill('.kp-adres', 'ws://127.0.0.1:7798/app');
  await p.press('.kp-adres', 'Enter');
  await p.click('.kp-aan');
  await wacht(400);
  let s = await p.evaluate(() => ({ ws: proef.ws(), status: proef.koppeling.status(), tekst: document.querySelector('.kp-stand').textContent }));
  ok('aan via het paneel: één WebSocket naar het adres, verbonden', s.ws === 1 && s.status.verbonden, s.tekst);
  ok('nog geen beeld-status: geen track over de lijn (de relay zou hem weggooien)',
    await p.evaluate(() => !proef.socks[0].uit.some((m) => m.type === 'track')));
  await p.evaluate(() => { proef.socks[0].leeft = true; });
  await wacht(1300);
  const lijn = await p.evaluate(() => proef.socks[0].uit);
  ok('eerste bericht = het manifest van varvedj', lijn[0]?.app === 'varvedj' && Array.isArray(lijn[0].bronnen));
  const tr = lijn.filter((m) => m.type === 'track');
  ok('na de eerste beeld-status: track A = het demonummer (varve:demo-124), bpm van de plaat',
    tr.some((m) => m.deck === 'A' && m.id === 'varve:demo-124' && m.bpm === 124), JSON.stringify(tr.map((m) => [m.deck, m.id, m.bpm])));
  ok('track B = demo 2 (staat klaar op kant B)', tr.some((m) => m.deck === 'B' && m.id === 'varve:demo-128'));
  // de klok: de laatste klok vergelijken met de hoorbare tel op hetzelfde moment (performance.now)
  const k = await p.evaluate(() => {
    const z = proef.socks[0].uit.filter((m) => m.type === 'klok').at(-1);
    const h = proef.hoor();
    return { z, h };
  });
  const verwacht = k.h.tel + (k.z.t - k.h.p) / 60000 * k.h.bpm;
  ok('klok: bpm 124, speelt, tel = de hoorbare tel van de maatklok', Math.abs(k.z.bpm - 124) < 0.01 && k.z.speelt
    && Math.abs(k.z.beat - verwacht) < 0.02, `afwijking ${(k.z.beat - verwacht).toFixed(4)} tel`);
  const ken = lijn.filter((m) => m.type === 'kenmerken');
  const maxW = (naam) => Math.max(...ken.map((m) => m.w[naam] ?? 0));
  ok('kenmerken uit de echte master-analyser: mix.laag en mix.luid bewegen', ken.length > 10 && maxW('mix.laag') > 0.1 && maxW('mix.luid') > 0.1,
    `${ken.length} berichten, max laag ${maxW('mix.laag').toFixed(2)}, luid ${maxW('mix.luid').toFixed(2)}`);
  ok('maat.klap volgt de tel (aan en uit)', ken.some((m) => m.w['maat.klap'] === 1) && ken.some((m) => m.w['maat.klap'] === 0));
  // mix bij de crossfader
  const nMix = await p.evaluate(() => proef.socks[0].uit.filter((m) => m.type === 'mix').length);
  await p.evaluate(() => proef.engine.bus.doe('mixer.xfader', 0.9));
  await wacht(400);
  const mix = await p.evaluate(() => proef.socks[0].uit.filter((m) => m.type === 'mix'));
  ok('crossfader 0,9: een mix met xfader 0,9 en a.speelt', mix.length > nMix && mix.at(-1).xfader === 0.9 && mix.at(-1).a?.speelt === true);
  // macro via de bus (verbonden en aanwezig)
  await p.evaluate(() => proef.engine.bus.doe('beeld.macro.glitch', 0.7));
  ok('beeld.macro.glitch via de bus: poort macro.glitch 0,7', await p.evaluate(() => proef.socks[0].uit.some((m) => m.poort === 'macro.glitch' && m.waarde === 0.7)));
  ok('lees van de macro = 0,7', await p.evaluate(() => proef.engine.bus.lees('beeld.macro.glitch')) === 0.7);
  // herladen: de teller begint opnieuw
  const nTr = tr.length;
  await p.evaluate(() => { proef.socks[0].teller = 0; });
  await wacht(1200);
  const na = await p.evaluate(() => proef.socks[0].uit);
  ok('herladen (de ping-teller begint opnieuw): beide tracks en de gezette macro opnieuw',
    na.filter((m) => m.type === 'track').length >= nTr + 2 && na.filter((m) => m.poort === 'macro.glitch').length >= 2);
  // uit
  await p.click('.kp-aan');
  await wacht(200);
  const n = await p.evaluate(() => proef.socks[0].uit.length);
  await wacht(1000);
  s = await p.evaluate(() => ({ n: proef.socks[0].uit.length, rs: proef.socks[0].readyState, ws: proef.ws(), tekst: document.querySelector('.kp-stand').textContent, aan: proef.geheugen.get('varve.v2.koppel.aan') }));
  ok('uit: de socket dicht, niets meer verstuurd, geen nieuwe WebSocket, bewaard als uit', s.n === n && s.rs === 3 && s.ws === 1 && s.tekst === 'uit' && s.aan === '0');
  if (schermPad) { await p.click('.kp-aan'); await wacht(1200); await p.screenshot({ path: schermPad }); console.log(`scherm: ${schermPad}`); }
  await ctx1.close();

  // ---- deel 2: de echte relay en de echte Stroommachine ---------------------------------------------
  if (!STROOM) {
    console.log('\ndeel 2 overgeslagen: geen Stroommachine-repo (zet VARVE_STROOM_REPO). Niet geproefd: de echte relay,');
    console.log('  haar klokvergelijking (ping/pong), de scène per deck, de crossfader in haar beeld, F5 van de Stroommachine.');
  } else {
    console.log(`\ndeel 2: de echte relay en Stroommachine (${STROOM})`);
    relay = spawn(process.execPath, [join(STROOM, 'tools', 'varve-relay.js'), String(RELAY_POORT), '--stil'], { stdio: 'ignore' });
    await wacht(800);
    const tmp = mkdtempSync(join(tmpdir(), 'varve-proef-koppel-'));
    const stroomHtml = join(tmp, 'stroom.html');
    writeFileSync(stroomHtml, '<!doctype html><meta charset="utf-8">' + readFileSync(join(STROOM, 'index.html'), 'utf8'));   // zoals haar tools/test.sh
    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 260 } });
    const v = await ctx2.newPage();
    // Een mislukte WebSocket en lettertypen van buiten logt Chrome zelf; dat is geen fout van onze code.
    luister(v, 'varvedj', (t) => /WebSocket connection/.test(t));
    await v.goto(`${BASIS}/proef.html`);
    await v.waitForFunction(() => window.proef, null, { timeout: 20000 });
    await v.evaluate(async () => { await proef.laadDemo(1, 0); await proef.laadDemo(2, 1); proef.engine.bus.doe('mixer.xfader', 0); proef.engine.bus.doe('track.1.play', true); });
    await v.fill('.kp-adres', `ws://127.0.0.1:${RELAY_POORT}/app`);
    await v.press('.kp-adres', 'Enter');
    await v.click('.kp-aan');
    const ctx3 = await browser.newContext({ viewport: { width: 480, height: 270 } });
    const st = await ctx3.newPage();
    luister(st, 'stroommachine', (t) => /ERR_TUNNEL|fonts\.g|ERR_CERT|net::ERR/.test(t));
    await st.goto(`file://${stroomHtml}?hub=ws://127.0.0.1:${RELAY_POORT}/app&dj#vast`);
    const dj = () => st.evaluate(() => window.__stroom?.dj?.() ?? null);
    const wachtOp = async (f, ms = 25000) => { const eind = Date.now() + ms; let d; do { d = await dj().catch(() => null); if (d && f(d)) return d; await wacht(250); } while (Date.now() < eind); return d; };
    let d = await wachtOp((x) => x.fris && x.klok && Math.abs(x.bpm - 124) < 0.3);
    ok('de Stroommachine ontvangt VarveDJ en volgt het tempo (124)', d?.fris && d?.klok && Math.abs(d.bpm - 124) < 0.3, `bpm ${d?.bpm?.toFixed?.(2)}, rtt ${d?.rtt?.toFixed?.(1)} ms`);
    // de tel: haar tel op haar laatste beeld tegen de hoorbare tel van VarveDJ op dat moment (djT = onze performance.now)
    await wacht(3000);
    d = await dj();
    const h = await v.evaluate(() => proef.hoor());
    const djTel = h.tel + (d.djT - h.p) / 60000 * h.bpm;
    ok('de tel loopt gelijk met de hoorbare tel van VarveDJ (< 0,35 tel, zoals haar test-dj)', Math.abs(d.beat - djTel) < 0.35,
      `afwijking ${(d.beat - djTel).toFixed(3)} tel (e ${d.e?.toFixed?.(3)}, off ${d.off?.toFixed?.(1)} ms)`);
    d = await wachtOp((x) => x.decks?.A?.id === 'varve:demo-124' && x.dom === 'A');
    ok('deck A (demo 1) bepaalt de scène', d?.decks?.A?.id === 'varve:demo-124' && d.dom === 'A', `label ${d?.label}`);
    ok('deck B (demo 2) kent ze ook', d?.decks?.B?.id === 'varve:demo-128');
    await v.evaluate(() => proef.engine.bus.doe('mixer.xfader', 0.85));
    d = await wachtOp((x) => x.dom === 'B' && Math.abs(x.x - 0.85) < 1e-3);
    ok('de crossfader voorbij het midden: de scène van deck B', d?.dom === 'B', `x ${d?.x}`);
    await v.evaluate(() => proef.engine.bus.doe('beeld.macro.glitch', 0.9));
    let g = 0;
    for (let i = 0; i < 60 && !(g > 0.8); i++) { await wacht(250); g = await st.evaluate(() => window.__stroom.lees('macro.glitch')).catch(() => 0); }
    ok('beeld.macro.glitch komt aan in de Stroommachine', g > 0.8, `macro.glitch ${(+g).toFixed?.(2)}`);
    const terug = await v.evaluate(() => proef.koppeling.status());
    ok('de beeld-status komt terug in VarveDJ', !!terug.beeld && typeof terug.beeld.regime === 'string', JSON.stringify(terug.beeld));
    // F5 van de Stroommachine: ze weet niets meer; VarveDJ ziet het aan haar ping-teller en stuurt de tracks opnieuw
    await st.reload();
    d = await wachtOp((x) => x.fris && x.decks?.A?.id === 'varve:demo-124' && x.decks?.B?.id === 'varve:demo-128');
    ok('na F5 van de Stroommachine: beide tracks vanzelf terug', d?.decks?.A?.id === 'varve:demo-124' && d?.decks?.B?.id === 'varve:demo-128');
    // uit: terug naar haar eigen klok
    await v.click('.kp-aan');
    d = await wachtOp((x) => !x.fris && !x.klok, 12000);
    ok('uit in VarveDJ: de Stroommachine valt terug op haar eigen klok', d && !d.fris && !d.klok);
    if (schermPad) await st.screenshot({ path: schermPad.replace(/\.png$/, '') + '-stroom.png' });
    await ctx2.close(); await ctx3.close();
  }
  ok('geen fouten in de console van onze pagina\'s', fouten.length === 0, fouten.slice(0, 5).join(' | '));
} catch (e) {
  ok('de proef liep zonder uitzondering', false, e?.stack ?? String(e));
} finally {
  await browser.close();
  server.close();
  relay?.kill();
}
const fout = uitslag.filter((x) => !x.goed).length;
console.log(`\n${uitslag.length} checks · ${fout ? `${fout} FOUT` : 'alles groen'}`);
process.exit(fout ? 1 : 0);
