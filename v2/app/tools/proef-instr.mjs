/**
 * Proef in echte Chrome (headless, OfflineAudioContext 48 kHz): doen de instrumenten wat ze beloven?
 *
 *   node tools/proef-instr.mjs [--json]
 *
 * Voor elk instrument (src/audio/instrumenten/: poly, fm, schaal, drums), aangesloten op een kale
 * GainNode naar de uitgang (geen strip of limiter die de meting verschuift):
 *
 *   1. LUIDHEID. Een akkoord van drie (C4 E4 G4) op snelheid 0,8, 3 s vastgehouden, standaardknoppen;
 *      voor de Drums (zoals v1) vier maten vier-op-de-vloer op 124 bpm (kick op elke tel, snare op 2
 *      en 4, gesloten hat op elke achtste ertussen) op 0,8. BS.1770-4 (K-weging, gating −70 LUFS
 *      absoluut en −10 LU relatief), in Node. Doel: −14 LUFS; grens ±1 LU (v1 mat −13,93…−14,03).
 *   2. TOONHOOGTE. Eén noot A4 (Poly zonder ontstemming, FM zonder zweving, de Klankschaal op zijn
 *      notenveld), de sterkste toon binnen ±1 halve toon (Goertzel, per 0,2 cent). Drums: een sinus
 *      van 440 Hz op pad 9 met TOON +12: 880 Hz (de playbackRate). Grens: 1 cent, de Klankschaal
 *      2 cent (de drift van de Waterschaal is ±0,9 ct).
 *   3. STEMROOF. Volle polyfonie en dan nog een noot (Drums: dezelfde pad opnieuw en de choke van
 *      de hats), gepland én live (suspend). De grootste sample-stap |x[n] − x[n−1]| rond het roven,
 *      gedeeld door die in HETZELFDE venster van een referentie zonder roof (dezelfde noten op twee
 *      instrumenten, zodat niemand rooft): de maat van meting/klik.mjs. Grens ≤ 1,25 (BUDGET M9).
 *   4. DE KLANKSCHAAL OP EEN TOONSOORT. toon() = 'Am': veld 4 van de ladder = A3 (220 Hz), de kern
 *      A2 (110 Hz); toon() = { toonsoort: 'Am', cent: 20 }: alles 20 cent hoger. Met de hand 'F#m':
 *      veld 4 = F♯3.
 *
 * Playwright staat globaal op de machine; de app zelf heeft geen afhankelijkheden. Schrijft niets.
 */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const POORT = 8797;
const SR = 48000;
const alsJson = process.argv.includes('--json');

process.env.VARVE_V2_POORT = String(POORT);
const { maakServer } = await import('../server.mjs');
const server = maakServer({ media: '/geen-media', data: mkdtempSync(join(tmpdir(), 'varve-v2-proef-instr-')) });
await new Promise((r) => server.listen(POORT, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const fouten = [];
page.on('pageerror', (e) => fouten.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
await page.route('**/proef/leeg.html', (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  headers: { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' },
  body: '<!doctype html><meta charset="utf-8"><title>proef-instr</title><body></body>',
}));

/** Draait IN de pagina: de renders (window.P). */
function hulp() {
  const SR = 48000;
  const P = {};
  window.P = P;
  P.laad = async () => { P.I = await import('/src/audio/instrumenten/index.js'); return P.I.INSTRUMENTEN.map((d) => d.soort); };
  const kanaal = (buf, c) => {
    const x = buf.getChannelData(c);
    const u8 = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s);
  };
  const terug = (buf) => ({ L: kanaal(buf, 0), R: kanaal(buf, 1) });
  const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
  /**
   * Renderen met het scenario in een suspend bij het tweede blok, en 300 ms wachten voor het
   * verder gaat: de berichten naar een worklet komen anders te laat, hoe snel de offline context
   * ook is (v1 tools/headless/instrumenten.mjs). `later` = { T, fn }: nog een stop op T (live).
   */
  const speel = async (ctx, nu, later = null) => {
    ctx.suspend(256 / SR).then(async () => { nu(); await wacht(300); ctx.resume(); });
    if (later) ctx.suspend(later.T).then(async () => { later.fn(); await wacht(300); ctx.resume(); });
    return terug(await ctx.startRendering());
  };
  /** Een context met `n` instrumenten van soort `soort` op één kale uitgang. */
  P.maak = async (soort, sec, { n = 1, toon = null, params = {} } = {}) => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(sec * SR), sampleRate: SR });
    const uit = ctx.createGain();
    uit.connect(ctx.destination);
    const lijst = [];
    for (let i = 0; i < n; i++) {
      const inst = P.I.instrumentDef(soort).maak(ctx, { uit, klok: null, toon: toon === null ? () => null : () => toon });
      await inst.start();
      for (const [k, v] of Object.entries(params)) inst.zetParam(Number(k), v);
      lijst.push(inst);
    }
    return { ctx, lijst };
  };

  /** 1. luidheid: een akkoord, of (drums) vier maten vier-op-de-vloer. */
  P.luid = async (soort) => {
    if (soort === 'drums') {
      const tel = 60 / 124, sec = 16 * tel + 1;
      const { ctx, lijst: [d] } = await P.maak(soort, sec);
      return { ...(await speel(ctx, () => {
        for (let b = 0; b < 16; b++) {
          const t = 0.1 + b * tel;
          d.noteOn(36, 0.8, t);
          if (b % 2 === 1) d.noteOn(37, 0.8, t);
          d.noteOn(39, 0.8, t + tel / 2);
        }
      })), van: 0.1, tot: 0.1 + 16 * tel };
    }
    const { ctx, lijst: [i] } = await P.maak(soort, 4.5);
    return { ...(await speel(ctx, () => { for (const n of [60, 64, 67]) { i.noteOn(n, 0.8, 0.1); i.noteOff(n, 3.1); } })), van: 0.1, tot: 3.1 };
  };

  /** 2. toonhoogte van één noot. */
  P.toon = async (soort) => {
    if (soort === 'drums') {
      const { ctx, lijst: [d] } = await P.maak(soort, 1.2, { params: { 1: 1 } });   // TOON +12
      const b = ctx.createBuffer(1, SR * 2, SR);
      const x = b.getChannelData(0);
      for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
      d.laadPad(9, b);
      return { ...(await speel(ctx, () => d.noteOn(44, 0.8, 0.05))), van: 0.15, tot: 0.95, verwacht: 880 };
    }
    const params = soort === 'poly' ? { 2: 0 } : soort === 'fm' ? { 6: 0 } : {};
    const { ctx, lijst: [i] } = await P.maak(soort, 2, { params });
    return { ...(await speel(ctx, () => i.noteOn(69, 0.8, 0.05))), van: soort === 'schaal' ? 0.3 : 0.4, tot: soort === 'schaal' ? 1.3 : 1.9, verwacht: 440 };
  };

  /**
   * 3. stemroof. `roof` = met roof (één instrument), anders de referentie (zelfde noten, de
   * laatste op een tweede instrument). `live`: de extra noot in een suspend, zonder tijd.
   */
  P.roof = async (soort, { roof, live, geval = 'vol' }) => {
    const T = 1.0, sec = 1.6;
    const { ctx, lijst } = await P.maak(soort, sec, { n: roof ? 1 : 2 });
    const [a, b] = roof ? [lijst[0], lijst[0]] : lijst;
    let eerst, extra;
    if (soort === 'drums') {
      if (geval === 'choke') { eerst = () => a.noteOn(43, 0.8, 0.1); extra = () => b.noteOn(39, 0.8, live ? undefined : T); }
      else { eerst = () => a.noteOn(36, 0.8, 0.95); extra = () => b.noteOn(36, 0.8, live ? undefined : T); }
    } else {
      const N = soort === 'schaal' ? 10 : 12;
      eerst = () => { for (let i = 0; i < N; i++) a.noteOn(57 + i, 0.7, 0.1 + i * 0.002); };
      extra = () => b.noteOn(57 + N, 0.7, live ? undefined : T);
    }
    const r = live ? await speel(ctx, eerst, { T, fn: extra }) : await speel(ctx, () => { eerst(); extra(); });
    return { ...r, T };
  };

  /** 4. de Klankschaal op een toonsoort: veld 4 van de ladder en de kern. */
  P.schaalToon = async ({ toon, hand = null, wat }) => {
    const { ctx, lijst: [s] } = await P.maak('schaal', 2, { toon });
    const r = await speel(ctx, () => {
      if (hand) s.zetHand(hand);
      if (wat === 'veld') s.slaVeld(4, 0.8, 0.05); else s.slaKern(0.8, 0.05);
    });
    return { ...r, van: 0.3, tot: 1.8, ladder: s.ladderStand() };
  };
}

await page.goto(`http://localhost:${POORT}/proef/leeg.html`);
await page.evaluate(`(${hulp.toString()})()`);
const soorten = await page.evaluate(() => window.P.laad());

// ---- rekenwerk in Node ----------------------------------------------------------------
const uitB64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

/** Een biquad over een signaal (Direct Form I). */
function biquad(x, [b0, b1, b2], [, a1, a2]) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
/** BS.1770-4 bij 48 kHz: K-weging (shelf + RLB), blokken van 400 ms met 75% overlap, gating −70 / −10. */
function lufs(L, R, van, tot) {
  const kw = (x) => biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]),
    [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
  const a = Math.round(van * SR), b = Math.round(tot * SR);
  const kl = kw(L.subarray(a, b)), kr = kw(R.subarray(a, b));
  const blok = 0.4 * SR, stap = 0.1 * SR, ms = [];
  for (let i = 0; i + blok <= kl.length; i += stap) {
    let s = 0;
    for (let j = i; j < i + blok; j++) s += kl[j] * kl[j] + kr[j] * kr[j];
    ms.push(s / blok);
  }
  const L_ = (z) => -0.691 + 10 * Math.log10(z);
  const abs = ms.filter((z) => L_(z) > -70);
  const gem = (lijst) => lijst.reduce((s, z) => s + z, 0) / lijst.length;
  const rel = L_(gem(abs)) - 10;
  return L_(gem(abs.filter((z) => L_(z) > rel)));
}
const piekDb = (L, R) => { let p = 0; for (const x of [L, R]) for (const v of x) p = Math.max(p, Math.abs(v)); return 20 * Math.log10(p); };
function goertzel(x, f) {
  const w = (2 * Math.PI * f) / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
    const s0 = x[i] * hann + c * s1 - s2; s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}
/** De sterkste toon binnen ±1 halve toon rond `rond` (per 0,2 cent), en zijn afwijking in cent. */
function toonhoogte(x, rond) {
  let beste = rond, max = -1;
  for (let c = -100; c <= 100; c += 0.2) { const f = rond * Math.pow(2, c / 1200); const p = goertzel(x, f); if (p > max) { max = p; beste = f; } }
  return { hz: beste, cent: 1200 * Math.log2(beste / rond) };
}
const stuk = (x, van, tot) => Float64Array.from(x.subarray(Math.round(van * SR), Math.round(tot * SR)));
function grootsteStap(L, R, van, tot) {
  let m = 0;
  for (const x of [L, R]) for (let i = Math.max(1, Math.round(van * SR)); i < Math.round(tot * SR); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
}

// ---- de metingen ----------------------------------------------------------------------
const uitslag = { luid: {}, toon: {}, roof: {}, schaal: {} };
const goed = [];
const check = (naam, ok, wat) => { goed.push({ naam, ok, wat }); };

for (const soort of soorten) {
  const r = await page.evaluate((s) => window.P.luid(s), soort);
  const L = uitB64(r.L), R = uitB64(r.R);
  const l = lufs(L, R, r.van, r.tot), p = piekDb(L, R);
  uitslag.luid[soort] = { lufs: +l.toFixed(2), piekDbfs: +p.toFixed(1) };
  check(`${soort}: luidheid ${l.toFixed(2)} LUFS (piek ${p.toFixed(1)} dBFS)`, Math.abs(l + 14) <= 1, l);

  const t = await page.evaluate((s) => window.P.toon(s), soort);
  const th = toonhoogte(stuk(uitB64(t.L), t.van, t.tot), t.verwacht);
  uitslag.toon[soort] = { verwacht: t.verwacht, hz: +th.hz.toFixed(3), cent: +th.cent.toFixed(2) };
  check(`${soort}: toonhoogte ${th.hz.toFixed(2)} Hz (${th.cent.toFixed(2)} ct van ${t.verwacht})`, Math.abs(th.cent) <= (soort === 'schaal' ? 2 : 1), th.cent);

  const gevallen = soort === 'drums' ? ['vol', 'choke'] : ['vol'];
  for (const geval of gevallen) {
    for (const live of [false, true]) {
      const a = await page.evaluate(([s, g, l]) => window.P.roof(s, { roof: true, live: l, geval: g }), [soort, geval, live]);
      const b = await page.evaluate(([s, g, l]) => window.P.roof(s, { roof: false, live: l, geval: g }), [soort, geval, live]);
      const va = a.T - 0.01, tot = a.T + 0.06;
      const sa = grootsteStap(uitB64(a.L), uitB64(a.R), va, tot), sb = grootsteStap(uitB64(b.L), uitB64(b.R), va, tot);
      const ratio = sa / sb;
      const naam = `${soort} ${geval === 'choke' ? 'choke' : soort === 'drums' ? 'zelfde pad' : 'stemroof'} ${live ? 'live' : 'gepland'}`;
      uitslag.roof[naam] = { stap: +sa.toExponential(3), ref: +sb.toExponential(3), ratio: +ratio.toFixed(3) };
      check(`${naam}: grootste stap ÷ referentie = ${ratio.toFixed(3)} (≤ 1,25)`, ratio <= 1.25 && Number.isFinite(ratio), ratio);
    }
  }
}

for (const [naam, opties, verwacht, grens] of [
  ['Am, veld 4 (A3)', { toon: 'Am', wat: 'veld' }, 220, 2],
  ['Am +20 ct, veld 4', { toon: { toonsoort: 'Am', cent: 20 }, wat: 'veld' }, 220 * Math.pow(2, 20 / 1200), 2],
  ['Am, de kern (A2)', { toon: 'Am', wat: 'kern' }, 110, 8],
  ['met de hand F#m, veld 4 (F#3)', { toon: 'Am', hand: 'F#m', wat: 'veld' }, 440 * Math.pow(2, (54 - 69) / 12), 2],
]) {
  const r = await page.evaluate((o) => window.P.schaalToon(o), opties);
  const th = toonhoogte(stuk(uitB64(r.L), r.van, r.tot), verwacht);
  uitslag.schaal[naam] = { verwacht: +verwacht.toFixed(3), hz: +th.hz.toFixed(3), cent: +th.cent.toFixed(2), ladder: `${r.ladder.toon} ${r.ladder.velden.join(' ')}` };
  check(`Klankschaal ${naam}: ${th.hz.toFixed(2)} Hz (${th.cent.toFixed(2)} ct)`, Math.abs(th.cent) <= grens, th.cent);
}
check('geen fouten in de pagina', fouten.length === 0, fouten.join(' | '));

await browser.close();
server.close();

const rood = goed.filter((g) => !g.ok);
if (alsJson) console.log(JSON.stringify({ uitslag, checks: goed, fouten }, null, 1));
else {
  for (const g of goed) console.log(`${g.ok ? '  ok  ' : 'FOUT  '}${g.naam}`);
  console.log(rood.length ? `\n${rood.length} fout(en).` : `\nAlle ${goed.length} checks groen.`);
}
process.exit(rood.length ? 1 : 0);
