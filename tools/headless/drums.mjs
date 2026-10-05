// Het drum-instrument (src/engine/instrumenten/drums.js, docs/INSTRUMENTEN.md §8)
// in de ECHTE Web Audio van Chrome: een OfflineAudioContext van twee kanalen op
// 48 kHz, het instrument rechtstreeks op de uitgang, renderen en meten.
//
//  1. elke pad van de kit klinkt: niet stil, eindig, piek ≤ 1 (snelheid 0,8)
//  2. de kick heeft zijn energie onder 120 Hz, de hat boven 5 kHz
//  3. choke: de gesloten hat kapt de open hat binnen ~10 ms af, zonder tik
//     (open + gesloten − alleen gesloten = wat er van de open hat over is;
//     dat moet de open hat zijn maal een lineaire helling naar 0)
//  4. luidheid (BS.1770): een maat vier-op-de-vloer op 124 bpm rond −14 LUFS
//  5. een geplande noot klinkt op de sample precies daar
//  6. stil() midden in alles (OfflineAudioContext.suspend): helling, daarna 0
//  7. een eigen buffer op pad 9: mono op het midden = bron × niveau, links en rechts
//  8. drive: vertraging van de oversampling en luidheid (alleen gemeld)
//
// VEILIG MET DE APC AANGESLOTEN: geen requestMIDIAccess in dit tabblad (weggehaald
// vóór de pagina laadt), eigen server op een eigen poort met een tijdelijke
// database. De pagina is /styles.css: alleen de herkomst, de app start niet.
// Raakt de geluidsinstellingen van de Mac niet: een offline context speelt niets af.
//
// Gebruik:  node tools/headless/drums.mjs
// Poorten:  VARVE_KIJK_POORT (standaard 8816), VARVE_KIJK_DEBUG (9416).
// Chromium: VARVE_CHROME, anders de headless shell uit de Playwright-cache
// (macOS), anders chromium / google-chrome op het pad (Linux).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8816, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9416;
const tmp = mkdtempSync(join(tmpdir(), 'varve-drums-'));

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
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
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

// ---- in de pagina ------------------------------------------------------------
// Deze functies gaan als tekst de pagina in (H.<naam>); ze draaien in Chrome.

/** Het instrument op een OfflineAudioContext: params zetten, noten plannen, renderen. */
async function render(spec) {
  const { DRUMS } = await import('/src/engine/instrumenten/drums.js');
  const SR = 48000;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(spec.duur * SR), sampleRate: SR });
  const d = DRUMS.maak(ctx, { uit: ctx.destination });
  await d.start();
  for (const [k, v] of spec.params ?? []) d.zetParam(k, v);
  for (const l of spec.laad ?? []) {
    const b = ctx.createBuffer(1, Math.round(l.duur * SR), SR), x = b.getChannelData(0);
    for (let i = 0; i < x.length; i++) x[i] = l.hz ? l.amp * Math.sin(2 * Math.PI * l.hz * i / SR) : l.amp;
    d.laadPad(l.pad, b, 'proef');
  }
  for (const [noot, s, t] of spec.noten ?? []) d.noteOn(noot, s, t);
  const op = {};
  for (const [t, wat] of spec.op ?? []) {
    ctx.suspend(t).then(() => { op[wat] = ctx.currentTime; if (wat === 'stil') d.stil(); ctx.resume(); });
  }
  const buf = await ctx.startRendering();
  return { L: buf.getChannelData(0), R: buf.getChannelData(1), SR, fouten: d.fouten, op, d };
}

/** Integrale luidheid volgens ITU-R BS.1770-4 (K-weging, blokken van 400 ms, poorten −70 en −10), 48 kHz. */
function lufs(kanalen) {
  const k = (x) => {
    const y = new Float64Array(x.length);
    // Trap 1 (hoge plank) en trap 2 (RLB-hoogdoorlaat), de coëfficiënten voor 48 kHz uit de norm.
    const tr = [[[1.53512485958697, -2.69169618940638, 1.19839281085285], [-1.69065929318241, 0.73248077421585]],
      [[1, -2, 1], [-1.99004745483398, 0.99007225036621]]];
    let z = Float64Array.from(x);
    for (const [[b0, b1, b2], [a1, a2]] of tr) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < z.length; i++) {
        const v = b0 * z[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = z[i]; y2 = y1; y1 = v; y[i] = v;
      }
      z = Float64Array.from(y);
    }
    return z;
  };
  const gewogen = kanalen.map(k);
  const blok = 19200, stap = 4800, n = gewogen[0].length;
  const z = [];
  for (let b = 0; b + blok <= n; b += stap) {
    let som = 0;
    for (const g of gewogen) { let s = 0; for (let i = b; i < b + blok; i++) s += g[i] * g[i]; som += s / blok; }
    z.push(som);
  }
  const l = (s) => -0.691 + 10 * Math.log10(s);
  const abs = z.filter((s) => l(s) > -70);
  if (!abs.length) return -Infinity;
  const gem = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((s) => l(s) > l(gem) - 10);
  return l(rel.reduce((a, b) => a + b, 0) / rel.length);
}

/** Welk deel van het vermogen tussen lo en hi Hz ligt (FFT over het hele stuk). */
function aandeel(x, SR, lo, hi) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n); re.set(x);
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let q = 0; q < len / 2; q++) {
      const wr = Math.cos(a * q), wi = Math.sin(a * q), u = i + q, v = u + len / 2;
      const xr = re[v] * wr - im[v] * wi, xi = re[v] * wi + im[v] * wr;
      re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi;
    }
  }
  let tot = 0, in_ = 0;
  for (let q = 1; q < n / 2; q++) { const p = re[q] * re[q] + im[q] * im[q], f = q * SR / n; tot += p; if (f >= lo && f < hi) in_ += p; }
  return in_ / tot;
}

const piek = (x) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const eersteNietNul = (x) => { for (let i = 0; i < x.length; i++) if (x[i] !== 0) return i; return -1; };

const HULP = `window.H = { render: ${render}, lufs: ${lufs}, aandeel: ${aandeel}, piek: ${piek}, eersteNietNul: ${eersteNietNul} }; true`;

const db = (a) => 20 * Math.log10(a);
const f1 = (x) => x.toFixed(1).replace('.', ',');
const f2 = (x) => x.toFixed(2).replace('.', ',');

try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  const pagina = doelen.find((d) => d.type === 'page');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
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
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/styles.css`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
  await cdp('Page.navigate', { url: `http://localhost:${POORT}/styles.css` });
  for (let i = 0; i < 50; i++) { if (await evalueer('document.readyState === "complete"').catch(() => false)) break; await wacht(100); }
  await evalueer(HULP);
  ok('pagina zonder MIDI, de module laadt', await evalueer(`!navigator.requestMIDIAccess && import('/src/engine/instrumenten/drums.js').then((m) => m.KIT.length === 8)`));

  // ---- 1 en 2: elke pad van de kit -------------------------------------------------
  console.log('\nde kit, elke pad apart (snelheid 0,8, alles op standaard)');
  const pads = await evalueer(`(async () => {
    const { KIT } = await import('/src/engine/instrumenten/drums.js');
    const uit = [];
    for (let i = 0; i < 8; i++) {
      const r = await H.render({ duur: 2.5, noten: [[36 + i, 0.8, 0.1]] });
      let eindig = true, ms = 0;
      for (const x of [r.L, r.R]) for (let j = 0; j < x.length; j++) { if (!Number.isFinite(x[j])) eindig = false; ms += x[j] * x[j]; }
      const mono = r.L.map((v, j) => (v + r.R[j]) / 2);
      // Luidheid van één slag: het luidste venster van 400 ms (momentaan).
      let mom = -Infinity;
      for (let b = 0; b + 19200 <= r.L.length; b += 2400) mom = Math.max(mom, H.lufs([r.L.subarray(b, b + 19200), r.R.subarray(b, b + 19200)]));
      uit.push({ naam: KIT[i].naam, piek: Math.max(H.piek(r.L), H.piek(r.R)), eindig, rms: 10 * Math.log10(ms / (2 * r.L.length)),
        laag: H.aandeel(mono, r.SR, 0, 120), hoog: H.aandeel(mono, r.SR, 5000, 24000), mom, fouten: r.fouten });
    }
    return uit;
  })()`);
  for (const p of pads) {
    ok(`${p.naam.padEnd(8)}: klinkt, eindig, piek ≤ 1`, p.eindig && p.piek > 0.05 && p.piek <= 1 && p.fouten === 0,
      `piek ${f1(db(p.piek))} dBFS, slag ${f1(p.mom)} LUFS (400 ms), <120 Hz ${Math.round(p.laag * 100)}%, >5 kHz ${Math.round(p.hoog * 100)}%`);
  }
  ok('de kick: energie onder 120 Hz (> 80%)', pads[0].laag > 0.8, `${f1(pads[0].laag * 100)}%`);
  ok('de hat: energie boven 5 kHz (> 75%)', pads[3].hoog > 0.75, `${f1(pads[3].hoog * 100)}%`);
  ok('de open hat ook (> 75%)', pads[7].hoog > 0.75, `${f1(pads[7].hoog * 100)}%`);

  // ---- 3: choke -------------------------------------------------------------------------
  console.log('\nchoke: de gesloten hat kapt de open hat af');
  const choke = await evalueer(`(async () => {
    const { KAP } = await import('/src/engine/instrumenten/drums.js');
    const T = 0.3, open = [43, 0.8, 0.1], dicht = [39, 0.8, T];
    const a = await H.render({ duur: 1, noten: [open, dicht] });
    const b = await H.render({ duur: 1, noten: [dicht] });
    const c = await H.render({ duur: 1, noten: [open] });
    const SR = a.SR, i0 = Math.round(T * SR), iK = Math.round((T + KAP) * SR);
    // Wat er van de open hat over is, per kanaal: met de gesloten erbij min alleen de gesloten.
    let voor = 0, na = 0, helling = 0, stapRest = 0, stapOpen = 0;
    for (const [x, y, z] of [[a.L, b.L, c.L], [a.R, b.R, c.R]]) {
      for (let i = 0; i < x.length; i++) {
        const rest = x[i] - y[i];
        if (i < i0) voor = Math.max(voor, Math.abs(rest - z[i]));
        else if (i >= iK) na = Math.max(na, Math.abs(rest));
        else {
          // Binnen de fade: de open hat maal een lineaire helling van 1 naar 0.
          const w = 1 - (i - i0) / (iK - i0);
          helling = Math.max(helling, Math.abs(rest - z[i] * w));
        }
        if (i > i0 - 48 && i < iK + 48) {
          stapRest = Math.max(stapRest, Math.abs((x[i] - y[i]) - (x[i - 1] - y[i - 1])));
          stapOpen = Math.max(stapOpen, Math.abs(z[i] - z[i - 1]));
        }
      }
    }
    return { voor, na, helling, stapRest, stapOpen, piekOpen: H.piek(c.L.subarray(i0, iK)), KAP, n: iK - i0 };
  })()`);
  ok('vóór de gesloten hat: de open hat precies zoals zonder choke', choke.voor < 1e-6, choke.voor.toExponential(1));
  ok(`${choke.KAP * 1000} ms na de gesloten hat: van de open hat is niets meer over (binnen ~10 ms af)`, choke.na < 1e-6, choke.na.toExponential(1));
  ok('daartussen: de open hat maal een lineaire helling naar 0 (geen sprong)', choke.helling < choke.piekOpen * 0.02,
    `afwijking ${choke.helling.toExponential(1)} bij een open hat van ${f2(choke.piekOpen)}`);
  // De helling zelf mag per sample hooguit piek/n extra geven.
  ok('... grootste stap van sample tot sample niet groter dan in de open hat zelf (geen tik)', choke.stapRest <= choke.stapOpen + choke.piekOpen / choke.n,
    `${f2(choke.stapRest)} tegen ${f2(choke.stapOpen)}`);

  // ---- 4: luidheid ----------------------------------------------------------------------
  console.log('\nluidheid: vier-op-de-vloer, 124 bpm, snelheid 0,8');
  const maat = await evalueer(`(async () => {
    const { UIT_OPHOGING } = await import('/src/engine/instrumenten/drums.js');
    const tel = 60 / 124, MATEN = 4, noten = [];
    for (let m = 0; m < MATEN; m++) for (let t = 0; t < 4; t++) {
      const op = 0.05 + (m * 4 + t) * tel;
      noten.push([36, 0.8, op]);                          // kick op elke tel
      if (t === 1 || t === 3) noten.push([37, 0.8, op]);  // snare op 2 en 4
      noten.push([39, 0.8, op + tel / 2]);                // gesloten hat tussen de tellen
    }
    const duur = 0.05 + MATEN * 4 * tel;
    const r = await H.render({ duur, noten });
    const d = await H.render({ duur, noten, params: [[4, 1]] });
    return { lufs: H.lufs([r.L, r.R]), piek: Math.max(H.piek(r.L), H.piek(r.R)), drive: H.lufs([d.L, d.R]),
      drivePiek: Math.max(H.piek(d.L), H.piek(d.R)), UIT_OPHOGING, fouten: r.fouten };
  })()`);
  ok('een maat kick + snare + hat rond −14 LUFS (±1)', Math.abs(maat.lufs + 14) <= 1 && maat.fouten === 0,
    `${f1(maat.lufs)} LUFS, piek ${f1(db(maat.piek))} dBFS, UIT_OPHOGING ${maat.UIT_OPHOGING}`);
  meld(`zonder ophoging zou het ${f1(maat.lufs - db(maat.UIT_OPHOGING))} LUFS zijn; voor −14: ×${(maat.UIT_OPHOGING * 10 ** ((-14 - maat.lufs) / 20)).toFixed(3)}`);
  meld(`met DRIVE 1: ${f1(maat.drive)} LUFS, piek ${f1(db(maat.drivePiek))} dBFS`);

  // ---- 5: plannen op de sample ------------------------------------------------------------
  console.log('\neen geplande noot klinkt op de sample precies daar');
  const plan = await evalueer(`(async () => {
    const uit = {};
    for (const [naam, k, params] of [['heel', 12345, []], ['half', 12345.5, []], ['drive', 12345, [[4, 0.5]]], ['laat', 23456, [[3, 0.5]]]]) {
      const r = await H.render({ duur: 0.6, noten: [[36, 0.8, k / 48000]], params });
      uit[naam] = Math.min(H.eersteNietNul(r.L), H.eersteNietNul(r.R));
    }
    return uit;
  })()`);
  ok('kick op sample 12 345 (t = 12345/48000): de eerste sample die niet 0 is, is 12 345', plan.heel === 12345, `${plan.heel}`);
  ok('... met het filter dicht (FILTER 0,5) ook: op 23 456', plan.laat === 23456, `${plan.laat}`);
  meld(`op een halve sample (12 345,5): eerste klank op ${plan.half} (Chrome plant tot op de sample nauwkeurig: de volgende hele)`);
  meld(`met DRIVE (WaveShaper, 2x oversample): eerste klank op ${plan.drive} (${plan.drive - 12345} samples later)`);

  // ---- 6: stil() --------------------------------------------------------------------------
  console.log('\nstil() midden in alles');
  const stil = await evalueer(`(async () => {
    const { STIL } = await import('/src/engine/instrumenten/drums.js');
    const { startDrempel } = await import('/src/engine/overgang.js');
    const SR = 48000;
    // Vergelijk met en zonder stil() (suspend op 0,2 s): tot de fade gelijk, dan
    // de uitvoer van zonder maal een helling van 1 naar 0, daarna precies 0.
    const vergelijk = async (spec) => {
      const met = await H.render({ ...spec, op: [[0.2, 'stil']] });
      const zonder = await H.render(spec);
      const ts = met.op.stil + startDrempel({ sampleRate: SR });
      const i0 = Math.round(ts * SR), i1 = Math.round((ts + STIL) * SR);
      let voor = 0, na = 0, helling = 0, stap = 0, stapZonder = 0, gepland = 0;
      for (const [x, y] of [[met.L, zonder.L], [met.R, zonder.R]]) {
        for (let i = 1; i < x.length; i++) {
          if (i < i0) voor = Math.max(voor, Math.abs(x[i] - y[i]));
          else if (i >= i1) na = Math.max(na, Math.abs(x[i]));
          else helling = Math.max(helling, Math.abs(x[i] - (spec.dc ? y[i0] : y[i]) * (1 - (i - i0) / (i1 - i0))));
          if (i > i0 - 48 && i < i1 + 48) { stap = Math.max(stap, Math.abs(x[i] - x[i - 1])); stapZonder = Math.max(stapZonder, Math.abs(y[i] - y[i - 1])); }
        }
        gepland = Math.max(gepland, H.piek(x.subarray(Math.round(0.6 * SR))));
      }
      return { voor, na, helling, stap, stapZonder, gepland, niveau: H.piek(zonder.L.subarray(i0, i1)), n: i1 - i0, STIL };
    };
    // Een mix (kick, sinus op pad 9, open hat) en een snare die pas na stil() zou komen.
    const mix = await vergelijk({ duur: 1, laad: [{ pad: 9, duur: 0.8, hz: 220, amp: 0.8 }],
      noten: [[36, 1, 0.1], [44, 0.8, 0.12], [43, 0.8, 0.15], [37, 0.8, 0.6]] });
    // Een gelijkspanning op pad 9 met DECAY 0,5: stil() valt midden in een helling
    // van de envelope; de uitvoer IS dan de envelope.
    const staart = await vergelijk({ duur: 1, dc: true, params: [[2, 0.5]], laad: [{ pad: 9, duur: 0.8, hz: 0, amp: 0.5 }], noten: [[44, 0.8, 0.0]] });
    return { mix, staart };
  })()`);
  const { mix, staart } = stil;
  ok('tot de fade precies hetzelfde als zonder stil()', mix.voor < 1e-6 && staart.voor < 1e-6, `${mix.voor.toExponential(1)} · ${staart.voor.toExponential(1)}`);
  ok(`in ${mix.STIL * 1000} ms lineair naar 0`, mix.helling < mix.niveau * 1e-3, `afwijking ${mix.helling.toExponential(1)} bij ${f2(mix.niveau)}`);
  ok('daarna alles precies 0, ook de snare die nog gepland stond', mix.na === 0 && mix.gepland === 0, `${mix.na}`);
  ok('geen tik: grootste stap rond de fade niet groter dan zonder', mix.stap <= mix.stapZonder + mix.niveau / mix.n, `${f2(mix.stap)} tegen ${f2(mix.stapZonder)}`);
  ok('midden in een DECAY-helling: hij houdt vast waar de helling is en gaat van daar lineair naar 0',
    staart.helling < 1e-4 && staart.na === 0, `afwijking ${staart.helling.toExponential(1)} bij ${staart.niveau.toFixed(3)}`);
  ok('... zonder sprong op het houdpunt (grootste stap ≤ die van de envelope zelf + de helling)', staart.stap <= staart.stapZonder + staart.niveau / staart.n + 1e-6,
    `${staart.stap.toExponential(2)} tegen ${staart.stapZonder.toExponential(2)}`);

  // ---- 7: een eigen buffer op pad 9 ---------------------------------------------------------
  console.log('\npad 9: een eigen buffer');
  const eigen = await evalueer(`(async () => {
    const { UIT_OPHOGING, snelheidGain } = await import('/src/engine/instrumenten/drums.js');
    const { faderGain } = await import('/src/engine/audio-graph.js');
    const r = await H.render({ duur: 0.5, laad: [{ pad: 9, duur: 0.3, hz: 1000, amp: 0.5 }], noten: [[44, 0.8, 0.1]] });
    const verwacht = 0.5 * snelheidGain(0.8) * faderGain(0.8) * UIT_OPHOGING;
    const i = Math.round(0.25 * 48000);
    return { L: H.piek(r.L.subarray(i - 480, i + 480)), R: H.piek(r.R.subarray(i - 480, i + 480)), verwacht,
      begin: H.eersteNietNul(r.L), eind: H.piek(r.L.subarray(Math.round(0.4 * 48000))) };
  })()`);
  ok('mono op het midden: links = rechts = bron × snelheid × niveau (de √2 tegen de panner klopt)',
    Math.abs(eigen.L / eigen.verwacht - 1) < 0.002 && Math.abs(eigen.R / eigen.verwacht - 1) < 0.002, `${eigen.L.toFixed(4)} / ${eigen.R.toFixed(4)} tegen ${eigen.verwacht.toFixed(4)}`);
  ok('begint op zijn sample, en is na zijn einde stil', eigen.begin >= 4800 && eigen.begin <= 4801 && eigen.eind === 0, `${eigen.begin}`);

  for (const m of meldingen) console.log(`  ! ${m}`);
  ok('geen uitzonderingen of console-fouten op de pagina', meldingen.length === 0, meldingen.length ? `${meldingen.length}` : '');
} catch (err) {
  console.error(err);
  uitkomst.push(['script', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL');
  server.kill('SIGINT');
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
