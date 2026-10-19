/**
 * M10 — klopt het geluid, en is het herhaalbaar?
 *
 *   node v2/meting/golden.mjs            meten; golden.json alleen schrijven als hij er nog niet is
 *   node v2/meting/golden.mjs --bewaar   de hash van nu in golden.json zetten (na een bewuste wijziging)
 *
 * (a) HERHAALBAAR. Een vast script van handelingen op de ECHTE engine in een OfflineAudioContext
 *     (48 kHz, stereo, 30 s): twee demonummers laden, A play (start de klok), B play vrij, B sync,
 *     klok 126, B jog 1/16 tel, B nudge 0,5 s, A filter 0,2, kill laag op B, B seek, stop.
 *     Elke handeling op een vast moment via ctx.suspend(t) → bus → engine.tik() → ctx.resume();
 *     tussendoor elke 0,25 s een tik (zoals de timer van de engine, TIK_MS). Drie renders (twee in
 *     dezelfde pagina, één in een verse pagina): de SHA-256 van de Float32-uitvoer moet gelijk zijn.
 * (b) NULL-TEST. Hetzelfde demonummer met onze speler (speler → destination, geen strip) tegen
 *     Chromes eigen AudioBufferSourceNode (andere code, ander algoritme), zelfde start en offset,
 *     op vaste snelheid, en met een tempowissel van de klok halverwege. Verschil in dB
 *     (RMS(verschil)/RMS(signaal)) en de tijdsverschuiving via kruiscorrelatie. Daarnaast een
 *     derde, eigen referentie in float64 (venster-sinc, 64 tikken, Kaiser) om te zien WIE van de
 *     twee afwijkt: Chrome interpoleert lineair, onze speler Hermite.
 *
 * Dit bestand exporteert ook de opzet (server + headless Chrome + de hulp in de pagina): klik.mjs
 * en abx-maak.mjs gebruiken hem. Schrijft alleen in v2/meting/.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HIER = dirname(fileURLToPath(import.meta.url));
export const APP = join(HIER, '..', 'app');
export const SR = 48000;

// ---- de opzet -------------------------------------------------------------------------------

/**
 * De v2-server (alleen voor /src), headless Chrome en een LEGE pagina op dezelfde oorsprong
 * (/meting/leeg.html, via page.route: de server kent hem niet, en de app zelf hoeft niet te
 * draaien). In de pagina staat window.M (zie `hulpInPagina`).
 */
export async function opzetOffline({ poort }) {
  process.env.VARVE_V2_POORT = String(poort);   // vóór de import: de server leest zijn poort bij het laden
  const { maakServer } = await import(join(APP, 'server.mjs'));
  const server = maakServer({ media: '/geen-media' });
  await new Promise((r) => server.listen(poort, '127.0.0.1', r));
  const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const fouten = [];
  const pagina = async () => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => fouten.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
    await page.route('**/meting/leeg.html', (r) => r.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8',
      headers: { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' },
      body: '<!doctype html><meta charset="utf-8"><title>meting</title><body></body>',
    }));
    await page.addInitScript(hulpInPagina);
    await page.goto(`http://localhost:${poort}/meting/leeg.html`);
    await page.evaluate(() => window.M.laadModules());
    return page;
  };
  const page = await pagina();
  return {
    server, browser, page, pagina, fouten, versie: browser.version(),
    async sluit() { await browser.close(); server.close(); },
  };
}

/**
 * Draait IN de pagina (addInitScript: alleen browser-globals, geen closures naar Node).
 * window.M = de hulpfuncties van de metingen.
 */
function hulpInPagina() {
  const SR = 48000;
  const M = {};
  window.M = M;

  M.laadModules = async () => {
    M.mod = {
      engine: await import('/src/engine/engine.js'),
      audio: await import('/src/audio/index.js'),
      bronnen: await import('/src/ui/bronnen.js'),
      speler: await import('/src/audio/speler.js'),
    };
    return true;
  };

  /** Zoveel ms wachten vóór elke resume (0 = meteen, zoals een naïeve offline render). */
  M.WACHT = 10;

  /** Een tijd op het blokrooster van de offline render (suspend kan alleen daar). */
  M.blok = (t) => Math.round(t * SR / 128) * 128 / SR;

  /** Een verse OfflineAudioContext met de echte engine, klaar (spelers en limiter-worklet geladen). */
  M.nieuweEngine = async (sec, kanalen = 2) => {
    const ctx = new OfflineAudioContext({ numberOfChannels: kanalen, length: Math.round(sec * SR), sampleRate: SR });
    const engine = new M.mod.engine.Engine({ ctx, audio: M.mod.audio.maakAudio(), timer: false });
    await engine.klaar;
    await engine.mixer.klaar;
    return { ctx, engine };
  };

  /** Een demonummer als `nummer` voor engine.laad / track.N.laad (zeker: ook over een spelende track). */
  M.demo = (id, extra = {}) => {
    const { DEMOS, maakDemo } = M.mod.bronnen;
    const def = DEMOS.find((d) => d.id === id);
    const d = maakDemo({ ...def, ...extra });
    return { id: d.id, titel: d.titel, artiest: 'demo', duur: d.duur, grid: d.grid, zeker: true, haal: async () => d.maakPcm(), maakPcm: d.maakPcm };
  };

  /** Een sinus als nummer, met een grid (zeker, op slot) zodat sync, jog en de klok werken. */
  M.sinus = ({ f = 80, amp = 0.5, duur = 30, bpm = 120, fase = 0 } = {}) => {
    const PAGINA = M.mod.bronnen.PAGINA, frames = Math.round(duur * SR);
    const maakPcm = () => {
      const paginas = [];
      for (let p = 0; p * PAGINA < frames; p++) {
        const a = new Int16Array(PAGINA * 2);
        for (let i = 0; i < PAGINA && p * PAGINA + i < frames; i++) {
          const v = Math.round(Math.sin(2 * Math.PI * f * (p * PAGINA + i) / SR + fase) * amp * 32767);
          a[2 * i] = v; a[2 * i + 1] = v;
        }
        paginas.push(a);
      }
      return { sr: SR, kanalen: 2, frames, paginas };
    };
    return { id: `sinus-${f}`, titel: `sinus ${f} Hz`, duur, zeker: true, grid: { stukken: [{ van: 0, bpm, anker: 0, maat: 0 }], beatsPerBar: 4, slot: true }, haal: async () => maakPcm(), maakPcm };
  };

  /** Pcm-pagina's (Int16, interleaved) naar twee Float32-kanalen: precies wat de speler leest (×1/32768). */
  M.pcmNaarFloat = (pcm) => {
    const L = new Float32Array(pcm.frames), R = new Float32Array(pcm.frames);
    const P = M.mod.bronnen.PAGINA;
    for (let f = 0; f < pcm.frames; f++) {
      const p = pcm.paginas[f >> 16], j = (f & (P - 1)) * 2;
      L[f] = p[j] / 32768; R[f] = p[j + 1] / 32768;
    }
    return { L, R };
  };

  /**
   * Een script draaien: `stappen` = [{ t, doe: async (engine, ctx) => … }], plus elke `tikElke` s
   * een engine.tik(). Elke tijd op het blokrooster; per moment: alles van dat moment, dan tik,
   * dan resume. Geeft de AudioBuffer.
   */
  M.draai = async (ctx, engine, stappen, { tikElke = 0.25, logboek = null, wacht = M.WACHT } = {}) => {
    const sec = ctx.length / SR;
    const momenten = new Map();
    const voeg = (t, fn) => { const k = M.blok(t); if (k <= 0 || k >= sec) return; if (!momenten.has(k)) momenten.set(k, []); if (fn) momenten.get(k).push(fn); };
    voeg(128 / SR, null);            // meteen een pauze: dan komt wat vóór de start gestuurd is (laad) aan
    for (const s of stappen) voeg(s.t, s.doe);
    if (tikElke) for (let t = tikElke; t < sec; t += tikElke) voeg(t, null);
    for (const [t, fns] of momenten) {
      ctx.suspend(t).then(async () => {
        for (const fn of fns) {
          const r = await fn(engine, ctx);
          if (logboek && r !== undefined) logboek.push({ t, r });
        }
        engine.tik();
        // Berichten naar de worklets (plan, laad) moeten AANKOMEN vóór het renderen verder gaat:
        // offline wacht Chrome daar niet op (zie het verslag). `wacht` ms echte tijd laat de
        // audiothread, die tijdens het pauzeren niets doet, de berichten afhandelen.
        if (wacht > 0) await new Promise((r) => setTimeout(r, wacht));
        ctx.resume();
      });
    }
    return ctx.startRendering();
  };

  M.hash = async (buf) => {
    const n = buf.length, alles = new Float32Array(n * buf.numberOfChannels);
    for (let c = 0; c < buf.numberOfChannels; c++) alles.set(buf.getChannelData(c), c * n);
    const h = await crypto.subtle.digest('SHA-256', alles.buffer);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  M.naarB64 = (f32) => {
    const b = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // ---- (a) het vaste script van golden ---------------------------------------------------------

  M.goldenScript = () => {
    const doe = (id, v) => (engine) => {
      const r = engine.bus.doe(id, v);
      return r && r.geweigerd ? `${id}: ${r.geweigerd}` : undefined;
    };
    return [
      { t: 0.5, doe: doe('track.1.play', true) },                 // A play: start de klok (124)
      { t: 2.0, doe: doe('track.2.play', true) },                 // B play, vrij (128)
      { t: 5.0, doe: doe('track.2.sync', true) },                 // B sync: gekoppeld
      { t: 8.0, doe: doe('klok.tempo', (126 - 40) / 260) },      // klok naar 126
      { t: 11.0, doe: doe('track.2.jog', 0.625) },               // jog: 0,125 × 8 × 1/32 = 1/16 tel vooruit
      { t: 14.0, doe: doe('track.2.nudge.voor', true) },         // nudge vasthouden…
      { t: 14.5, doe: doe('track.2.nudge.voor', false) },        // …0,5 s, los = gekoppeld op de nieuwe plek
      { t: 17.0, doe: doe('track.1.filter', 0.2) },              // A filter naar 0,2 (lowpass)
      { t: 19.0, doe: doe('track.2.kill.laag', true) },          // kill laag op B
      { t: 22.0, doe: doe('track.2.seek', 0.5) },                // B naar 60 s (gekoppeld: fasebehoudend)
      { t: 26.0, doe: doe('track.1.play', true) },               // stop: A pauze
      { t: 26.0, doe: doe('track.2.play', true) },               //       B pauze
      { t: 26.5, doe: doe('klok.stop', true) },                  //       de klok stil
    ];
  };

  /** Eén golden-render. Met `strip`: alleen die track klinkt (de andere fader dicht) — om per strip te zoeken. */
  M.golden = async ({ sec = 30, alleen = null, wacht = M.WACHT } = {}) => {
    const { ctx, engine } = await M.nieuweEngine(sec);
    await engine.laad(1, M.demo('demo-124'));
    await engine.laad(2, M.demo('demo-128'));
    if (alleen) engine.bus.doe(`track.${alleen === 1 ? 2 : 1}.fader`, 0);
    const log = [];
    const buf = await M.draai(ctx, engine, M.goldenScript(), { logboek: log, wacht });
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let piek = 0, som = 0;
    for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > piek) piek = a; som += L[i] * L[i] + R[i] * R[i]; }
    return {
      hash: await M.hash(buf), piek, rms: Math.sqrt(som / (2 * L.length)), geweigerd: log,
      limiter: engine.mixer.limiterStand(), b64L: M.naarB64(L), b64R: M.naarB64(R),
    };
  };

  // ---- (b) null-test --------------------------------------------------------------------------

  /**
   * Onze speler alleen (geen strip), of Chromes AudioBufferSourceNode, op hetzelfde nummer.
   * soort 'speler' | 'absn'; R1 vanaf T0 op P0; met wissel { T, R2 }: vanaf T op R2.
   */
  M.nullRender = async ({ soort, nummer = 'demo-124', sec = 8, T0 = M.blok(0.5), P0 = 10, R1 = 1, wissel = null }) => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(sec * SR), sampleRate: SR });
    const pcm = M.demo(nummer).maakPcm();
    if (soort === 'speler') {
      const sp = await M.mod.speler.Speler.maak(ctx);
      sp.node.connect(ctx.destination);
      sp.laad(pcm);
      const seg = [{ T: T0, P: P0, R: R1, speelt: true }];
      if (wissel) seg.push({ T: wissel.T, P: P0 + (wissel.T - T0) * R1, R: wissel.R2, speelt: true });
      sp.plan(seg);
    } else {
      const { L, R } = M.pcmNaarFloat(pcm);
      const b = ctx.createBuffer(2, L.length, SR);
      b.copyToChannel(L, 0); b.copyToChannel(R, 1);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = R1;
      if (wissel) src.playbackRate.setValueAtTime(wissel.R2, wissel.T);
      src.connect(ctx.destination);
      src.start(T0, P0);
    }
    // Zonder pauze komt het bericht met laad en plan pas aan als alles al gerenderd is (gemeten:
    // stilte). Dus vroeg pauzeren, de worklet even laten lezen, dan door.
    ctx.suspend(M.blok(0.05)).then(async () => { await new Promise((r) => setTimeout(r, 20)); ctx.resume(); });
    const buf = await ctx.startRendering();
    return { L: M.naarB64(buf.getChannelData(0)), R: M.naarB64(buf.getChannelData(1)) };
  };

  /**
   * De tempowissel via de ENGINE: track 1 gekoppeld (play start de klok op 124, het nummer is
   * 124: R = 1), dan op Tw (blokrooster) de klok naar `bpm2` met engine.zetKlokTempo. De speler
   * gaat los van zijn strip, rechtstreeks naar de uitgang. Geeft de render en het startmoment A.
   */
  M.nullEngine = async ({ sec = 8, tPlay = 0.5, Tw = M.blok(4), bpm2 = 128, viaBus = false, scheef = 0 }) => {
    const { ctx, engine } = await M.nieuweEngine(sec);
    await engine.laad(1, M.demo('demo-124'));
    const t = engine.track(1);
    t.speler.node.disconnect();
    t.speler.node.connect(ctx.destination);
    const uit = {};
    const stappen = [
      { t: tPlay, doe: (e) => { e.bus.doe('track.1.play', true); uit.A = e.klok.seg[0].T; uit.P0 = t.plek(uit.A); uit.R1 = t.snelheid(uit.A + 0.01); } },
      viaBus
        ? { t: Tw, doe: (e) => { e.bus.doe('klok.tempo', (bpm2 - 40) / 260); uit.Tw = e.klok.seg.at(-1).T; uit.R2 = t.snelheid(uit.Tw + 0.01); } }
        : { t: Tw - 0.05, doe: (e) => { const T = Tw + scheef / SR; e.zetKlokTempo(bpm2, T); uit.Tw = T; uit.R2 = t.snelheid(T + 0.01); } },
    ];
    const buf = await M.draai(ctx, engine, stappen);
    return { ...uit, L: M.naarB64(buf.getChannelData(0)), R: M.naarB64(buf.getChannelData(1)) };
  };
}

// ---- rekenwerk in Node ------------------------------------------------------------------------

export const uitB64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
export const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : String(x));

/** RMS(a − b) / RMS(b) over [van, tot) in dB. */
export function verschilDb(a, b, van, tot) {
  let d = 0, s = 0;
  for (let i = van; i < tot; i++) { const e = a[i] - b[i]; d += e * e; s += b[i] * b[i]; }
  return db(Math.sqrt(d / s));
}

/**
 * Tijdsverschuiving van a t.o.v. b in samples (+ = a ligt later): eerst de hele lag met de
 * grootste kruiscorrelatie (±maxLag), dan de fijne rest met kleinste kwadraten op de afgeleide
 * (a(t) ≈ b(t − δ) ≈ b(t) − δ·b'(t)). Parabolisch interpoleren rond de piek is op laag, traag
 * veranderend materiaal (de pad) een paar honderdste sample scheef; deze schatting niet.
 */
export function verschuiving(a, b, van, tot, maxLag = 64) {
  const c = (L) => { let s = 0; for (let i = van; i < tot; i++) s += a[i] * b[i - L]; return s; };
  let best = -Infinity, bL = 0;
  for (let L = -maxLag; L <= maxLag; L++) { const v = c(L); if (v > best) { best = v; bL = L; } }
  let teller = 0, noemer = 0;
  for (let i = van + 1; i < tot - 1; i++) {
    const db1 = (b[i - bL + 1] - b[i - bL - 1]) / 2;
    teller += (a[i] - b[i - bL]) * db1;
    noemer += db1 * db1;
  }
  return bL - (noemer > 0 ? teller / noemer : 0);
}

/** Bessel I0 voor het Kaiser-venster. */
function i0(x) { let s = 1, t = 1; for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-20 * s) break; } return s; }

/**
 * Een eigen, onafhankelijke resampler in float64: venster-sinc met 2·H tikken (Kaiser β),
 * afsnijden op `fc` × Nyquist (alleen bij R > 1 lager, hier niet nodig: R ≤ 1,04).
 * pos(i) = plek in frames van uitvoersample i (of NaN = stilte).
 */
export function sincResample(x, n, pos, { H = 32, beta = 9 } = {}) {
  // Het Kaiser-venster als tabel (lineair geïnterpoleerd: fout < 1e-9), anders kost I0 per tik te veel.
  const TAB = 1 << 16, I0b = i0(beta), venster = new Float64Array(TAB + 2);
  for (let k = 0; k <= TAB + 1; k++) { const u = Math.min(1, k / TAB); venster[k] = i0(beta * Math.sqrt(Math.max(0, 1 - u * u))) / I0b; }
  const win = (u) => { const a = Math.abs(u) * TAB, k = Math.floor(a), f = a - k; return venster[k] + (venster[k + 1] - venster[k]) * f; };
  const uit = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = pos(i);
    if (!(p >= 0) || p >= x.length) continue;
    const m = Math.floor(p), fr = p - m;
    if (fr === 0) { uit[i] = x[m]; continue; }
    let s = 0;
    const sinFr = Math.sin(Math.PI * fr);
    for (let k = -H + 1; k <= H; k++) {
      const j = m + k;
      if (j < 0 || j >= x.length) continue;
      const d = k - fr;                     // afstand van tik j tot de plek
      // sin(π(k − fr)) = (−1)^(k+1) · sin(π fr)
      const sinc = ((k & 1) ? sinFr : -sinFr) / (Math.PI * d);
      s += x[j] * sinc * win(d / H);
    }
    uit[i] = s;
  }
  return uit;
}

/** Een eenvoudige lineair-fase lowpass (venster-sinc, 255 tikken) om te zien WAAR een verschil zit. */
export function lowpass(x, fc) {
  const N = 255, h = new Float64Array(N), M2 = (N - 1) / 2, w = 2 * fc / SR;
  let som = 0;
  for (let k = 0; k < N; k++) {
    const d = k - M2;
    h[k] = (d === 0 ? w : Math.sin(Math.PI * w * d) / (Math.PI * d)) * (0.42 - 0.5 * Math.cos(2 * Math.PI * k / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * k / (N - 1)));
    som += h[k];
  }
  const uit = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < N; k++) { const j = i + M2 - k; if (j >= 0 && j < x.length) s += x[j] * h[k]; }
    uit[i] = s / som;
  }
  return uit;
}

// ---- het meten -----------------------------------------------------------------------------------

async function meetHerhaalbaar(o, wacht) {
  const r1 = await o.page.evaluate((w) => window.M.golden({ wacht: w }), wacht);
  const r2 = await o.page.evaluate((w) => window.M.golden({ wacht: w }), wacht);
  const p2 = await o.pagina();
  const r3 = await p2.evaluate((w) => window.M.golden({ wacht: w }), wacht);
  const r4 = await p2.evaluate((w) => window.M.golden({ wacht: w }), wacht);
  await p2.close();
  const renders = [r1, r2, r3, r4];
  const gelijk = renders.every((r) => r.hash === r1.hash);
  const uit = { wacht, hashes: renders.map((r) => r.hash), gelijk, piek: r1.piek, rmsDb: db(r1.rms), geweigerd: r1.geweigerd, limiter: r1.limiter };
  if (!gelijk) {
    // Waar en hoeveel: per kanaal, eerste verschil en grootste afwijking, en per strip apart.
    const verschil = (a, b) => {
      const A = uitB64(a), B = uitB64(b);
      let n = 0, eerste = -1, max = 0;
      for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - B[i]); if (d > 0) { n++; if (eerste < 0) eerste = i; if (d > max) max = d; } }
      return { samples: n, eersteS: eerste / SR, maxDb: db(max) };
    };
    uit.verschil = renders.slice(1).map((r) => (r.hash === r1.hash ? 'gelijk' : { L: verschil(r1.b64L, r.b64L), R: verschil(r1.b64R, r.b64R) }));
    uit.perStrip = {};
    for (const s of [1, 2]) {
      const hs = [];
      for (let k = 0; k < 3; k++) hs.push((await o.page.evaluate(([s, w]) => window.M.golden({ alleen: s, wacht: w }), [s, wacht])).hash);
      uit.perStrip[s] = { gelijk: hs.every((h) => h === hs[0]), verschillend: new Set(hs).size };
    }
  }
  return uit;
}

/** Eén null-geval: twee renders, vergelijken in [van, tot). */
function vergelijk(sp, ab, { van, tot, ref = null }) {
  const L1 = uitB64(sp.L), L2 = uitB64(ab.L);
  const r = {
    db: verschilDb(L1, L2, van, tot),
    verschuivingSamples: verschuiving(L1, L2, van, tot),
  };
  // Waar zit het verschil: alleen onder 4 kHz (beide door dezelfde lowpass).
  const a4 = lowpass(L1.subarray(0, tot + 200), 4000), b4 = lowpass(L2.subarray(0, tot + 200), 4000);
  r.dbOnder4k = verschilDb(a4, b4, van, tot);
  if (ref) {
    r.spelerTegenSinc = verschilDb(L1, ref, van, tot);
    r.absnTegenSinc = verschilDb(L2, ref, van, tot);
    r.spelerTegenSincVerschuiving = verschuiving(L1, ref, van, tot);
    const r4 = lowpass(ref.subarray(0, tot + 200), 4000);
    r.spelerTegenSincOnder4k = verschilDb(a4, r4, van, tot);
    r.absnTegenSincOnder4k = verschilDb(b4, r4, van, tot);
  }
  return r;
}

async function bronVan(o, nummer) {
  const b64 = await o.page.evaluate((nummer) => {
    const pcm = window.M.demo(nummer).maakPcm();
    const { L } = window.M.pcmNaarFloat(pcm);
    return window.M.naarB64(L.subarray(0, 48000 * 30));
  }, nummer);
  return Float64Array.from(uitB64(b64));
}

async function meetNull(o) {
  const uit = {};
  const bronnen = { 'demo-124': await bronVan(o, 'demo-124'), 'demo-pad': await bronVan(o, 'demo-pad') };
  const sec = 8, n = sec * SR;
  const T0 = Math.round(0.5 * SR / 128) * 128 / SR, P0 = 10;
  const van = Math.round((T0 + 0.02) * SR), tot = n - 2000;        // na de inloop van 4 ms van de speler
  const gevallen = [
    ['R 124/128', 124 / 128, 'demo-124'], ['R 1,0', 1, 'demo-124'], ['R 0,97', 0.97, 'demo-124'], ['R 1,03', 1.03, 'demo-124'],
    ['R 124/128, demo-pad (geen hihat)', 124 / 128, 'demo-pad'], ['R 0,97, demo-pad (geen hihat)', 0.97, 'demo-pad'],
  ];
  for (const [naam, R1, nummer] of gevallen) {
    const sp = await o.page.evaluate((a) => window.M.nullRender({ ...a, soort: 'speler' }), { sec, T0, P0, R1, nummer });
    const ab = await o.page.evaluate((a) => window.M.nullRender({ ...a, soort: 'absn' }), { sec, T0, P0, R1, nummer });
    const ref = sincResample(bronnen[nummer], n, (i) => (i / SR < T0 ? NaN : (P0 + (i / SR - T0) * R1) * SR));
    uit[naam] = vergelijk(sp, ab, { van, tot, ref });
  }
  // Tempowissel halverwege, met de hand gepland (speler-segmenten) tegen setValueAtTime.
  {
    const Tw = Math.round(4 * SR / 128) * 128 / SR, R1 = 1, R2 = 128 / 124;
    const sp = await o.page.evaluate((a) => window.M.nullRender({ ...a, soort: 'speler' }), { sec, T0, P0, R1, wissel: { T: Tw, R2 } });
    const ab = await o.page.evaluate((a) => window.M.nullRender({ ...a, soort: 'absn' }), { sec, T0, P0, R1, wissel: { T: Tw, R2 } });
    const pos = (i) => { const t = i / SR; if (t < T0) return NaN; return (t < Tw ? P0 + (t - T0) * R1 : P0 + (Tw - T0) * R1 + (t - Tw) * R2) * SR; };
    const ref = sincResample(bronnen['demo-124'], n, pos);
    const naam = 'wissel R 1 → 128/124 (segmenten met de hand)';
    uit[naam] = vergelijk(sp, ab, { van, tot, ref });
    uit[naam].naDeWissel = verschilDb(uitB64(sp.L), uitB64(ab.L), Math.round((Tw + 0.02) * SR), tot);
  }
  // Tempowissel van de KLOK via de engine (gekoppelde track). Chromes playbackRate is k-rate:
  // alleen op een blokgrens is "hetzelfde moment" voor beide waar. straks() = twee blokken na
  // currentTime, dus via de bus valt hij op een blokgrens; de derde zet hem er 16 samples naast.
  for (const [naam, opties] of [
    ['klok 124 → 128, engine.zetKlokTempo op een blokgrens', {}],
    ['klok 124 → 128 via de bus (klok.tempo)', { viaBus: true }],
    ['klok 124 → 128, 16 samples naast een blokgrens', { scheef: 16 }],
  ]) {
    const e = await o.page.evaluate((a) => window.M.nullEngine(a), { sec, ...opties });
    const ab = await o.page.evaluate((a) => window.M.nullRender({ ...a, soort: 'absn' }), { sec, T0: e.A, P0: e.P0, R1: e.R1, wissel: { T: e.Tw, R2: e.R2 } });
    const pos = (i) => { const t = i / SR; if (t < e.A) return NaN; return (t < e.Tw ? e.P0 + (t - e.A) * e.R1 : e.P0 + (e.Tw - e.A) * e.R1 + (t - e.Tw) * e.R2) * SR; };
    const ref = sincResample(bronnen['demo-124'], n, pos);
    const vanE = Math.round((e.A + 0.02) * SR);
    uit[naam] = vergelijk({ L: e.L }, ab, { van: vanE, tot, ref });
    uit[naam].naDeWissel = verschilDb(uitB64(e.L), uitB64(ab.L), Math.round((e.Tw + 0.02) * SR), tot);
    uit[naam].naDeWisselVerschuiving = verschuiving(uitB64(e.L), uitB64(ab.L), Math.round((e.Tw + 0.02) * SR), tot);
    uit[naam].momenten = { A: e.A, Tw: e.Tw, TwFrames: e.Tw * SR, TwOpBlok: Math.abs((e.Tw * SR) % 128) < 1e-6, R1: e.R1, R2: e.R2 };
  }
  return uit;
}

// ---- hoofdprogramma --------------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bewaar = process.argv.includes('--bewaar');
  const o = await opzetOffline({ poort: 8811 });
  try {
    if (process.argv.includes('--alleen-null')) {
      const b = await meetNull(o);
      for (const [naam, r] of Object.entries(b)) console.log(naam, JSON.stringify(r));
      process.exit(0);
    }
    const t0 = Date.now();
    const naief = await meetHerhaalbaar(o, 0);
    console.log(`(a0) zonder wachten vóór resume: herhaalbaar ${naief.gelijk ? 'JA' : 'NEE'}  (${naief.hashes.length} renders)`);
    if (!naief.gelijk) console.log('     verschil:', JSON.stringify(naief.verschil), '\n     per strip (3 renders):', JSON.stringify(naief.perStrip));
    const a = await meetHerhaalbaar(o, 10);
    console.log(`(a) met 10 ms wachten vóór elke resume: herhaalbaar ${a.gelijk ? 'JA, bit voor bit' : 'NEE'}  (${a.hashes.length} renders, twee pagina's, ${((Date.now() - t0) / 1000).toFixed(1)} s samen)`);
    console.log(`    hash ${a.hashes[0]}`);
    console.log(`    piek ${fmt(db(a.piek))} dBFS, rms ${fmt(a.rmsDb)} dBFS, limiter ${a.limiter.soort}, geweigerd: ${a.geweigerd.length ? JSON.stringify(a.geweigerd) : 'niets'}`);
    if (!a.gelijk) console.log('    verschil:', JSON.stringify(a.verschil), 'per strip:', JSON.stringify(a.perStrip));

    const pad = join(HIER, 'golden.json');
    const oud = existsSync(pad) ? JSON.parse(readFileSync(pad, 'utf8')) : null;
    if (oud) console.log(`    tegen golden.json (${oud.datum}): ${oud.hash === a.hashes[0] ? 'GELIJK' : 'ANDERS — de uitvoer veranderde (bewust? dan --bewaar)'}`);

    const b = await meetNull(o);
    console.log('\n(b) null-test tegen Chromes AudioBufferSourceNode (grens ≤ −50 dB)');
    console.log('    geval                                                  | ons−Chrome |  <4 kHz  | verschuiving  | ons−sinc (<4k)     | Chrome−sinc (<4k)');
    for (const [naam, r] of Object.entries(b)) {
      console.log(`    ${naam.padEnd(54)} | ${fmt(r.db).padStart(7)} dB | ${fmt(r.dbOnder4k).padStart(6)} dB | ${fmt(r.verschuivingSamples, 4).padStart(8)} smp | ${fmt(r.spelerTegenSinc).padStart(6)} (${fmt(r.spelerTegenSincOnder4k).padStart(6)}) dB | ${fmt(r.absnTegenSinc).padStart(6)} (${fmt(r.absnTegenSincOnder4k).padStart(6)}) dB${r.naDeWissel !== undefined ? `  na de wissel ${fmt(r.naDeWissel)} dB` : ''}${r.momenten ? `  [Tw ${r.momenten.TwOpBlok ? 'op' : 'naast'} een blokgrens]` : ''}`);
    }
    if (!oud || bewaar) {
      writeFileSync(pad, JSON.stringify({
        hash: a.hashes[0], datum: new Date().toISOString().slice(0, 10), chromium: o.versie, sr: SR, seconden: 30,
        script: 'demo-124 op 1, demo-128 op 2; 0,5 A play · 2 B play · 5 B sync · 8 klok 126 · 11 B jog 1/16 · 14–14,5 B nudge · 17 A filter 0,2 · 19 B kill laag · 22 B seek 0,5 · 26 A en B pauze · 26,5 klok stop; elke 0,25 s tik',
        wachtVoorResumeMs: 10, herhaalbaar: a.gelijk, zonderWachten: { herhaalbaar: naief.gelijk, verschil: naief.verschil ?? null, perStrip: naief.perStrip ?? null }, nullTest: b,
      }, null, 2) + '\n');
      console.log(`\ngolden.json ${oud ? 'bijgewerkt' : 'geschreven'}`);
    }
    if (o.fouten.length) console.log('FOUTEN in de pagina:\n' + o.fouten.join('\n'));
    const nullOk = ['R 124/128', 'R 1,0', 'R 0,97', 'R 1,03'].every((k) => b[k].db <= -50);
    console.log(`\nM10: herhaalbaar ${a.gelijk ? 'ja' : 'NEE'}; null-test vaste snelheid ${nullOk ? 'binnen de grens' : 'BUITEN de grens (zie hierboven: wie wijkt af van de sinc-referentie?)'}`);
    process.exitCode = a.gelijk && !o.fouten.length ? 0 : 1;
  } finally {
    await o.sluit();
  }
}
