/**
 * Proef in echte Chrome (headless, OfflineAudioContext): doet de effectlaag wat hij belooft?
 *
 *   node tools/proef-fx.mjs [--json]
 *
 * Metingen 1–4 op de ECHTE strip (src/audio/strip.js) met zijn insert-slot (src/audio/fx/),
 * gemeten aan de uitgang van de strip (een kale mixer erachter: geen compressor of limiter die de
 * meting verschuift of afvlakt); meting 5 op de echte engine, aan de master:
 *
 *   1. ECHO OP DE KLOK. Het rack van send A (echo op de maat, 1/4 tel) als insert, mix 0,5, op een
 *      maatklok van 120 bpm (src/kern/klok.js). Een klik op 0,1 s: de eerste echo hoort op 0,6 s
 *      te liggen. Grens: 0,5 s ± 1 ms. En na een tempowissel van de klok naar 100 bpm (de
 *      'verander' van de klok herankert de slot): 0,6 s ± 1 ms.
 *   2. WISSELEN MIDDEN IN EEN TOON. Een sinus van 220 Hz door een rack; op 1,0 s een ander rack
 *      (suspend op een blokgrens). De grootste sample-stap |x[n] − x[n−1]| in het venster van de
 *      kruisfade, gedeeld door de grootste stap in HETZELFDE venster van twee renders zonder wissel
 *      (het oude rack de hele tijd, het nieuwe de hele tijd): de maat van meting/klik.mjs ("÷ ref").
 *      Grens ≤ 1,25 (BUDGET M9).
 *   3. GALM. Een klik door de FDN (rack reverb, RT60 beloofd 2,0 s, helemaal nat). De galmtijd uit
 *      de HELLING van het uitsterven (Schroeder-integraal, rechte lijn door −5 … −35 dB, naar −60 dB
 *      doorgetrokken), niet de eerste −60 dB na de piek (v1 CLAUDE.md "reverb is een FDN"). Grens:
 *      de beloofde tijd ± 10%.
 *   4. DE WORKLETS van de effecten (fx-worklet.js: pitch, auto-wah, kam, frequentieschuif, aanslag)
 *      laden van hun plek in v2 (/src/audio/fx/) en geven geluid: een sinus erdoor, helemaal nat,
 *      moet klinken (RMS > −60 dBFS) en zonder processorerror.
 *   5. ZONDER EFFECT NIETS ANDERS. Het vaste script van meting/golden.mjs op de echte engine, maar
 *      met definieerFx(engine) erbij (zoals na de integratie) en onderweg aan de effectknoppen
 *      gedraaid met de mix dicht: knoppen, aan/uit, volgend rack, sends op 0, de knoppen van de
 *      bussen. De hash moet die van meting/golden.json zijn. Als tegenproef een render met een send
 *      open: die hash moet anders zijn (de bus klinkt).
 *
 * Playwright staat globaal op de machine; de app zelf heeft geen afhankelijkheden. Schrijft niets.
 */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const POORT = 8793;
const SR = 48000;
const alsJson = process.argv.includes('--json');

process.env.VARVE_V2_POORT = String(POORT);
const { maakServer } = await import('../server.mjs');
const server = maakServer({ media: '/geen-media', data: mkdtempSync(join(tmpdir(), 'varve-v2-proef-fx-')) });
await new Promise((r) => server.listen(POORT, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const fouten = [];
page.on('pageerror', (e) => fouten.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
await page.route('**/proef/leeg.html', (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  headers: { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' },
  body: '<!doctype html><meta charset="utf-8"><title>proef-fx</title><body></body>',
}));

/** Draait IN de pagina: de hulp voor de renders (window.P). */
function hulp() {
  const SR = 48000;
  const P = {};
  window.P = P;
  P.laad = async () => {
    P.strip = await import('/src/audio/strip.js');
    P.fx = await import('/src/audio/fx/fx.js');
    P.sends = await import('/src/audio/fx/sends.js');
    P.Klok = (await import('/src/kern/klok.js')).Klok;
    P.overgang = await import('/src/audio/overgang.js');
    return true;
  };
  /** Een kale mixer: de strip gaat rechtstreeks naar de uitgang (alleen in deze proef). */
  P.kaleMixer = (ctx) => ({ in: ctx.destination, kantGain: () => 1, _meld() {}, _vergeet() {} });
  P.rack = (id, params = {}) => {
    const e = P.fx.effectVan(id);
    return { schema: 1, name: e.naam, chain: [{ slot: 'a', type: id, params: { ...e.standaard, ...params } }],
      macros: e.params.map((p, i) => ({ place: i + 1, label: p, default: { ...e.standaard, ...params }[p], links: [{ target: `a.${p}`, from: 0, to: 1 }] })) };
  };
  P.klik = (ctx, t, amp = 0.5) => {
    const b = ctx.createBuffer(2, 4, SR);
    b.getChannelData(0)[0] = amp; b.getChannelData(1)[0] = amp;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.start(t);
    return s;
  };
  const kanaal = (buf) => {
    const L = buf.getChannelData(0);
    let s = '';
    const u8 = new Uint8Array(L.buffer, L.byteOffset, L.byteLength);
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s);
  };

  /** 1. de echo op de klok. */
  P.echo = async ({ bpm = 120, wissel = null, sec = 3 } = {}) => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: sec * SR, sampleRate: SR });
    const st = P.strip.maakStrip(ctx, P.kaleMixer(ctx));
    const klok = new P.Klok();
    klok.start(0, 0, bpm);
    st.fx.setKlok(klok);
    st.fx.zetRack(P.sends.SEND_RACKS.A);
    st.fx.setMix(0.5);
    const t0 = 0.1;
    P.klik(ctx, t0).connect(st.in);
    let t1 = null;
    if (wissel) {
      // Een tempowissel van de klok (zoals de engine: op 'straks'), daarna een tweede klik.
      ctx.suspend(wissel.t).then(() => { klok.houd(wissel.t + 0.01, wissel.bpm); ctx.resume(); });
      t1 = wissel.klik;
      P.klik(ctx, t1).connect(st.in);
    }
    const buf = await ctx.startRendering();
    return { L: kanaal(buf), t0, t1 };
  };

  /** 2. wisselen van rack midden in een toon. `wissel` = de tijd, of null (een referentie). */
  P.wissel = async ({ van, naar, mix = 0.7, wissel = 1.0, sec = 1.6, f = 220 } = {}) => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(sec * SR), sampleRate: SR });
    const st = P.strip.maakStrip(ctx, P.kaleMixer(ctx));
    const klok = new P.Klok();
    klok.start(0, 0, 120);
    st.fx.setKlok(klok);
    st.fx.zetRack(van);
    st.fx.setMix(mix);
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    osc.connect(g).connect(st.in);
    osc.start(0);
    if (wissel !== null) ctx.suspend(wissel).then(() => { st.fx.zetRack(naar); ctx.resume(); });
    const buf = await ctx.startRendering();
    return { L: kanaal(buf), drempel: P.overgang.startDrempel(ctx), fade: P.fx.FADE };
  };

  /** 4. een effect met een worklet: geladen? klinkt het? */
  P.worklet = async (id) => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR / 2, sampleRate: SR });
    const { laadFxWorklet } = await import('/src/audio/fx/fx-meer.js');
    const geladen = await laadFxWorklet(ctx);
    let fout = null;
    ctx.addEventListener?.('varve-workletfout', (e) => { fout = e.detail; });
    const st = P.strip.maakStrip(ctx, P.kaleMixer(ctx));
    st.fx.zetRack(P.rack(id));
    st.fx.setMix(1);
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    osc.connect(st.in);
    osc.start(0);
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0);
    let s = 0;
    for (let i = SR / 10; i < L.length; i++) s += L[i] * L[i];
    const nodes = [...st.fx.keten.node.slots.values()][0]?.inst;
    return { geladen, rms: Math.sqrt(s / (L.length - SR / 10)), fout, heeftNode: !!nodes };
  };

  /** 3. de galm: RT60 beloofd `rt60` s. */
  P.galm = async ({ rt60 = 2, sec = 4, toon = 1 } = {}) => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: sec * SR, sampleRate: SR });
    const st = P.strip.maakStrip(ctx, P.kaleMixer(ctx));
    // expMap(t, 0,4, 30) = rt60 → t = ln(rt60 / 0,4) / ln(75)
    const grootte = Math.log(rt60 / 0.4) / Math.log(75);
    st.fx.zetRack(P.rack('reverb', { grootte, toon, meng: 1, freeze: 0 }));
    st.fx.setMix(1);
    P.klik(ctx, 0.1, 0.9).connect(st.in);
    const buf = await ctx.startRendering();
    return { L: kanaal(buf), t0: 0.1, belofte: P.fx.toonWaarde('reverb', 'grootte', grootte) };
  };
}

const uitB64 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

/** De piek (|x| grootst) tussen twee tijden. */
function piek(x, van, tot) {
  let m = 0, w = -1;
  for (let i = Math.max(0, Math.round(van * SR)); i < Math.min(x.length, Math.round(tot * SR)); i++) if (Math.abs(x[i]) > m) { m = Math.abs(x[i]); w = i; }
  return { i: w, t: w / SR, a: m };
}

function grootsteStap(x, van, tot) {
  let m = 0;
  for (let i = Math.max(1, Math.round(van * SR)); i < Math.min(x.length, Math.round(tot * SR)); i++) { const d = Math.abs(x[i] - x[i - 1]); if (d > m) m = d; }
  return m;
}

/** RT60 uit de helling: Schroeder-integraal van t0 + 5 ms, rechte lijn door −5 … −35 dB. */
function galmtijd(x, t0) {
  const a = Math.round((t0 + 0.005) * SR);
  const n = x.length - a;
  const E = new Float64Array(n);
  let s = 0;
  for (let i = n - 1; i >= 0; i--) { s += x[a + i] * x[a + i]; E[i] = s; }
  const db = (i) => 10 * Math.log10(E[i] / E[0]);
  const punten = [];
  for (let i = 0; i < n; i += 48) { const d = db(i); if (d <= -5 && d >= -35) punten.push([i / SR, d]); }
  const m = punten.length;
  const mx = punten.reduce((q, p) => q + p[0], 0) / m, my = punten.reduce((q, p) => q + p[1], 0) / m;
  let sxy = 0, sxx = 0;
  for (const [t, d] of punten) { sxy += (t - mx) * (d - my); sxx += (t - mx) * (t - mx); }
  const helling = sxy / sxx;          // dB per seconde
  return { rt60: -60 / helling, helling, punten: m };
}

const uit = { fouten };
let golden = null;
try {
  await page.addInitScript(hulp);
  await page.goto(`http://localhost:${POORT}/proef/leeg.html`);
  await page.evaluate(() => window.P.laad());

  // ---- 1. echo -------------------------------------------------------------------------------
  {
    const r = await page.evaluate(() => window.P.echo({ bpm: 120 }));
    const x = uitB64(r.L);
    const p0 = piek(x, r.t0 - 0.01, r.t0 + 0.01), p1 = piek(x, r.t0 + 0.3, r.t0 + 0.7);
    const echo = (p1.i - p0.i) / SR;
    const w = await page.evaluate(() => window.P.echo({ bpm: 120, sec: 4, wissel: { t: 1.0, bpm: 100, klik: 2.0 } }));
    const y = uitB64(w.L);
    const q0 = piek(y, w.t1 - 0.01, w.t1 + 0.01), q1 = piek(y, w.t1 + 0.4, w.t1 + 0.8);
    const echo2 = (q1.i - q0.i) / SR;
    uit.echo = { verwacht: 0.5, gemeten: echo, fout_ms: (echo - 0.5) * 1000, piek: p1.a, naWissel: { verwacht: 0.6, gemeten: echo2, fout_ms: (echo2 - 0.6) * 1000 },
      ok: Math.abs(echo - 0.5) <= 0.001 && Math.abs(echo2 - 0.6) <= 0.001 && p1.a > 0.05 };
  }

  // ---- 2. wisselen ------------------------------------------------------------------------------
  {
    const paren = await page.evaluate(() => {
      const P = window.P;
      return [
        ['filter (LP) → phaser', P.rack('filter', { freq: 0.3, reso: 0.3 }), P.rack('phaser')],
        ['delay → reverb', P.rack('delay', { tijd: 0.4, feedback: 0.5 }), P.rack('reverb', { grootte: 0.4, meng: 0.5 })],
        ['chorus → distortion', P.rack('chorus'), P.rack('distortion')],
        ['tremolo (op de maat) → gate', P.rack('tremolo'), P.rack('gate')],
        ['filter → filter (zelfde klank)', P.rack('filter', { freq: 0.3 }), P.rack('filter', { freq: 0.3 })],
        ['delay → delay (andere tijd)', P.rack('delay', { tijd: 0.3 }), P.rack('delay', { tijd: 0.6 })],
      ];
    });
    uit.wissel = [];
    for (const [naam, van, naar] of paren) {
      const T = Math.round(1.0 * SR / 128) * 128 / SR;
      const m = await page.evaluate((o) => window.P.wissel(o), { van, naar, wissel: T });
      const refOud = await page.evaluate((o) => window.P.wissel(o), { van, naar, wissel: null });
      const refNieuw = await page.evaluate((o) => window.P.wissel(o), { van: naar, naar, wissel: null });
      const x = uitB64(m.L);
      const W0 = T, W1 = T + m.drempel + m.fade + 0.01;
      const stap = grootsteStap(x, W0, W1);
      const ref = Math.max(grootsteStap(uitB64(refOud.L), W0, W1), grootsteStap(uitB64(refNieuw.L), W0, W1));
      const ervoor = grootsteStap(x, W0 - (W1 - W0), W0);
      uit.wissel.push({ naam, venster_ms: (W1 - W0) * 1000, stap, ref, tegenRef: stap / ref, tegenErvoor: stap / ervoor, ok: stap / ref <= 1.25 });
    }
  }

  // ---- 3. galm ------------------------------------------------------------------------------------
  {
    uit.galm = [];
    for (const rt60 of [1.0, 2.0]) {
      const r = await page.evaluate((o) => window.P.galm(o), { rt60, sec: Math.ceil(rt60 * 1.6) + 1 });
      const g = galmtijd(uitB64(r.L), r.t0);
      uit.galm.push({ belofte: rt60, scherm: r.belofte, gemeten: g.rt60, afwijking: g.rt60 / rt60 - 1, punten: g.punten, ok: Math.abs(g.rt60 / rt60 - 1) <= 0.1 });
    }
  }

  // ---- 4. de worklets ----------------------------------------------------------------------------
  {
    uit.worklets = [];
    for (const id of ['pitch', 'autowah', 'kam', 'freqschuif', 'aanslag']) {
      const r = await page.evaluate((x) => window.P.worklet(x), id);
      const dB = 20 * Math.log10(r.rms || 1e-12);
      uit.worklets.push({ id, geladen: r.geladen, dB, fout: r.fout, ok: r.geladen === true && dB > -60 && !r.fout });
    }
  }

  // ---- 5. zonder effect niets anders (de golden hash) -------------------------------------------
  {
    const { opzetOffline, HIER } = await import('../../meting/golden.mjs');
    const { readFileSync } = await import('node:fs');
    const verwacht = JSON.parse(readFileSync(join(HIER, 'golden.json'), 'utf8')).hash;
    golden = await opzetOffline({ poort: 8794 });
    const r = await golden.page.evaluate(async () => {
      const M = window.M;
      const { definieerFx } = await import('/src/engine/acties-fx.js');
      const nieuw = M.nieuweEngine, script = M.goldenScript;
      M.nieuweEngine = async (...a) => { const x = await nieuw(...a); definieerFx(x.engine); return x; };
      const doe = (id, v) => (e) => { e.bus.doe(id, v); };
      const metKnoppen = () => [...script(),
        { t: 3.0, doe: doe('track.1.fx.knop.1', 0.8) }, { t: 3.0, doe: doe('track.2.fx.knop.2', 0.1) },
        { t: 4.0, doe: doe('track.2.fx.aan', true) }, { t: 4.5, doe: doe('track.2.fx.aan', true) },
        { t: 6.0, doe: doe('track.1.fx.volgend', true) }, { t: 6.5, doe: doe('track.1.fx.vorig', true) },
        { t: 7.0, doe: doe('track.1.send.a', 0) }, { t: 7.0, doe: doe('track.2.send.b', 0) },
        { t: 9.0, doe: doe('send.a.knop.1', 0.2) }, { t: 9.0, doe: doe('send.b.knop.3', 1) },
        { t: 12.0, doe: doe('track.1.fx.mix', 0) }];
      M.goldenScript = metKnoppen;
      const a = await M.golden({});
      M.goldenScript = () => [...metKnoppen(), { t: 15.0, doe: doe('track.1.send.b', 0.3) }];
      const b = await M.golden({});
      M.nieuweEngine = nieuw; M.goldenScript = script;
      return { a: a.hash, b: b.hash };
    });
    uit.golden = { verwacht, metFx: r.a, metSend: r.b, gelijk: r.a === verwacht, sendAnders: r.b !== verwacht, ok: r.a === verwacht && r.b !== verwacht };
    fouten.push(...golden.fouten);
  }
} finally {
  await browser.close();
  server.close();
  await golden?.sluit();
}

const ok = uit.echo?.ok && uit.wissel?.every((w) => w.ok) && uit.galm?.every((g) => g.ok) && uit.golden?.ok && uit.worklets?.every((w) => w.ok) && !fouten.length;
if (alsJson) console.log(JSON.stringify(uit, null, 2));
else {
  const f = (v, n = 2) => v.toFixed(n).replace('.', ',');
  console.log('proef-fx: de effectlaag in echte Chrome (OfflineAudioContext, 48 kHz)\n');
  const e = uit.echo;
  console.log(`1. echo op 1/4 tel, klok 120 bpm: ${f(e.gemeten * 1000, 2)} ms (verwacht 500, ${f(e.fout_ms, 3)} ms naast)`);
  console.log(`   na klok → 100 bpm:            ${f(e.naWissel.gemeten * 1000, 2)} ms (verwacht 600, ${f(e.naWissel.fout_ms, 3)} ms naast)   ${e.ok ? 'ok' : 'FOUT'}`);
  console.log('\n2. rack wisselen midden in een toon (220 Hz): grootste stap ÷ ref (grens ≤ 1,25)');
  for (const w of uit.wissel) console.log(`   ${w.naam.padEnd(30)} venster ${f(w.venster_ms, 1)} ms  stap ${w.stap.toExponential(2)}  ÷ ref ${f(w.tegenRef)}  ÷ ervoor ${f(w.tegenErvoor)}  ${w.ok ? 'ok' : 'TE GROOT'}`);
  console.log('\n3. galm (FDN): RT60 uit de helling (−5 … −35 dB), grens ± 10%');
  for (const g of uit.galm) console.log(`   beloofd ${f(g.belofte, 1)} s (scherm: ${g.scherm}): gemeten ${f(g.gemeten, 2)} s (${g.afwijking >= 0 ? '+' : ''}${f(g.afwijking * 100, 1)}%)  ${g.ok ? 'ok' : 'BUITEN DE GRENS'}`);
  console.log('\n4. worklets van de effecten (sinus 220 Hz, helemaal nat)');
  for (const w of uit.worklets) console.log(`   ${w.id.padEnd(11)} geladen ${w.geladen ? 'ja' : 'NEE'}  ${f(w.dB, 1)} dBFS  ${w.fout ? 'FOUT ' + JSON.stringify(w.fout) : ''}${w.ok ? 'ok' : 'FOUT'}`);
  const g = uit.golden;
  console.log(`\n5. golden-script met definieerFx en aan de effectknoppen gedraaid (mix dicht): ${g.gelijk ? 'GELIJK' : 'ANDERS'} aan golden.json (${g.metFx.slice(0, 12)}…)`);
  console.log(`   tegenproef met send B open: ${g.sendAnders ? 'anders, zoals het hoort' : 'NIET anders: de bus klinkt niet'}`);
  if (fouten.length) console.log('\nFOUTEN in de pagina:\n' + fouten.join('\n'));
  console.log(`\n${ok ? 'alles binnen de grens' : 'NIET alles binnen de grens'}`);
}
process.exitCode = ok ? 0 : 1;
