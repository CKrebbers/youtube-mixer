/**
 * M9 (gehoor): de WAV-paren voor abx.html maken, en de pagina headless toetsen.
 *
 *   node v2/meting/abx-maak.mjs            paren maken (abx/*.wav + abx/paren.js) en abx.html toetsen
 *   node v2/meting/abx-maak.mjs --toets    alleen abx.html toetsen (de paren staan er al)
 *
 * Vier overgangen op het demonummer Klokwerk 124, met de ECHTE engine offline gerenderd (dezelfde
 * renders als klik.mjs: M.overgang). Elk paar: A = VarveDJ, B = een referentie die uit renders
 * ZONDER de overgang is gemaakt (oude stand en nieuwe stand) en daartussen een overgang die per
 * constructie niet tikt, aan de uitgang (na de limiter: alles daar is lineair en tijdinvariant zolang
 * de limiter niets doet, en dat doet hij hier niet: piek −6 dBFS, plafond −1 dBTP).
 *   1 sprong       gekoppeld 16 tellen verder (4 maten: het demonummer herhaalt zich), dus dezelfde
 *                  muziek. B = oud → nieuw met 20 ms equal-GAIN (gelijk materiaal: amplitudes
 *                  optellen tot 1); dat is zo goed als "geen sprong", met dezelfde hihat-ruis.
 *   2 kill         kill laag aan op 1,5 s, uit op 2,7 s. B = de stand zonder en met kill, gemengd
 *                  langs dezelfde zachte S van 5 ms, maar in het SIGNAAL in plaats van in de
 *                  coëfficiënten van het filter (wat een kill idealiter doet).
 *   3 start/stop   start midden in het nummer (0,6 s), pauze (2,0 s), weer verder (2,8 s). B = hetzelfde
 *                  met een zachte overvloei van 20 ms (verhoogde cosinus) bij elk van de drie.
 *   4 laad         een ander nummer laden over een spelende track (2,0 s), op 2,8 s play. B = het oude
 *                  vloeit uit in 4 ms met de vorm van de speler (lineair, equal-gain) en verder niets; vanaf
 *                  2,5 s is B gelijk aan A (het nieuwe nummer start bij beide hetzelfde).
 * WAV: 16-bit, 48 kHz, stereo, 4 s. Schrijft alleen in v2/meting/abx/.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { opzetOffline, uitB64, SR, HIER } from './golden.mjs';
import { installeerKlik, referenties } from './klik.mjs';

const MAP = join(HIER, 'abx');
const SEC = 4;
const blok = (t) => Math.round(t * SR / 128) * 128 / SR;
const VOORUIT = 256, DREMPEL = 272;               // frames: engine.straks() en de startDrempel van de strip
const BRON = { soort: 'demo', id: 'demo-124' };

// ---- WAV -------------------------------------------------------------------------------------

function wav16(L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { buf.writeInt16LE(q(L[i]), 44 + i * 4); buf.writeInt16LE(q(R[i]), 46 + i * 4); }
  return buf;
}

// ---- omhullenden (0..1) ------------------------------------------------------------------------

/** Verhoogde cosinus van 0 naar 1 vanaf frame a, `d` frames lang. */
const opRC = (i, a, d) => (i <= a ? 0 : i >= a + d ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (i - a) / d));
/** De zachte S van een kill (halve cosinus), vanaf a, d frames. */
const S = opRC;

const kanalen = (r) => [uitB64(r.L), uitB64(r.R)];
const meng = (n, fn) => { const L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i++) { const [l, rr] = fn(i); L[i] = l; R[i] = rr; } return [L, R]; };

async function maakParen(o) {
  const render = (a) => o.page.evaluate((a) => window.M.overgang(a), { sec: SEC, ...a });
  const n = SEC * SR;
  const paren = [];
  const bewaar = (id, naam, uitleg, A, B, extra) => {
    writeFileSync(join(MAP, `${id}-a.wav`), wav16(A[0], A[1]));
    writeFileSync(join(MAP, `${id}-b.wav`), wav16(B[0], B[1]));
    // Hoe ver A en B uit elkaar liggen (alleen ter controle: waar en hoeveel).
    let d = 0, s = 0, piek = 0, waar = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) { const e = A[c][i] - B[c][i]; d += e * e; s += B[c][i] ** 2; if (Math.abs(e) > piek) { piek = Math.abs(e); waar = i; } }
    paren.push({ id, naam, uitleg, a: `abx/${id}-a.wav`, b: `abx/${id}-b.wav`, verschilDb: 10 * Math.log10(d / s), grootsteVerschil: piek, waarS: waar / SR, ...extra });
  };

  // 1. sprong: gekoppeld 16 tellen (exact 4 maten) verder.
  {
    const ts = blok(2.0);
    const extra = { relatief: 16 * 60 / 124 };
    const r = await render({ bron: BRON, overgang: 'sprong', ts, extra });
    const [oud, nieuw] = referenties('sprong', extra, r);
    const ro = await render({ bron: BRON, ts, ...oud }), rn = await render({ bron: BRON, ts, ...nieuw });
    const [oL, oR] = kanalen(ro), [nL, nR] = kanalen(rn);
    const a = Math.round((ts + r.D) * SR) + VOORUIT + 5 * 48 - 480;     // 20 ms, gecentreerd op het midden van onze 10 ms (OVERVLOEI_SPRONG)
    const B = meng(n, (i) => { const c = opRC(i, a, 960); return [oL[i] * (1 - c) + nL[i] * c, oR[i] * (1 - c) + nR[i] * c]; });
    bewaar('sprong', 'Sprong', 'Gekoppeld 16 tellen verder op 2,0 s (dezelfde muziek). B: oud naar nieuw met 20 ms equal-gain, zo goed als geen sprong.', kanalen(r), B, { sprongS: r.plekNa - (r.A - r.Aplay) });
  }
  // 2. kill laag aan op 1,5 s, uit op 2,7 s.
  {
    const t1 = blok(1.5), t2 = blok(2.7);
    const extra = { band: 'laag', en: [{ t: t2, bus: ['track.1.kill.laag', true] }] };
    const r = await render({ bron: BRON, overgang: 'kill aan', ts: t1, extra });
    const [open, dicht] = referenties('kill aan', { band: 'laag' }, r);
    const ro = await render({ bron: BRON, ts: t1, ...open }), rd = await render({ bron: BRON, ts: t1, ...dicht });
    const [oL, oR] = kanalen(ro), [dL, dR] = kanalen(rd);
    const a1 = Math.round((t1 + r.D) * SR) + DREMPEL, a2 = Math.round((t2 + r.D) * SR) + DREMPEL;
    const B = meng(n, (i) => { const k = S(i, a1, 240) * (1 - S(i, a2, 240)); return [oL[i] * (1 - k) + dL[i] * k, oR[i] * (1 - k) + dR[i] * k]; });
    bewaar('kill', 'Kill laag', 'Kill laag aan op 1,5 s en uit op 2,7 s. B: zonder en met kill gemengd langs dezelfde zachte S van 5 ms, in het signaal.', kanalen(r), B, {});
  }
  // 3. start midden in het nummer, pauze, weer verder.
  let startSprong = null;
  {
    const t1 = blok(0.6), t2 = blok(2.0), t3 = blok(2.8);
    const extra = { startPlek: 1.0, en: [{ t: t2, bus: ['track.1.play', true] }, { t: t3, bus: ['track.1.play', true] }] };
    const r = await render({ bron: BRON, overgang: 'start', ts: t1, extra });
    const [, steady] = referenties('start', { startPlek: 1.0 }, { ts: t1 });
    // Na de pauze start hij GEKOPPELD: op de dichtstbijzijnde tel van de klok, die doorliep (klok-B07),
    // dus niet precies waar hij stopte. De referentie volgt dat: een tweede rechte lijn door de plek
    // waar hij na de tweede play is (uit de engine gelezen).
    // (Vanaf het begin terugrekenen kan niet: die lijn ligt vóór 0 s. Dus een start op t1 op de plek die
    // hij op t1 had gehad.)
    const s0 = steady.voor[0].seek, Aplay = blok(0.1) + VOORUIT / SR, A1 = t1 + VOORUIT / SR;
    const na = r.en[1];
    const rs = await render({ bron: BRON, ts: t1, ...steady });
    const rs2 = await render({ bron: BRON, ts: t1, overgang: 'start', extra: { startPlek: na.plek - (na.A - A1) } });
    const [sL, sR] = kanalen(rs), [tL, tR] = kanalen(rs2);
    const D = Math.round(r.D * SR);
    const a1 = Math.round(t1 * SR) + VOORUIT + D, a2 = Math.round(t2 * SR) + VOORUIT + D, a3 = Math.round(t3 * SR) + VOORUIT + D;
    const B = meng(n, (i) => {
      const e1 = opRC(i, a1, 960) * (1 - opRC(i, a2, 960)), e2 = opRC(i, a3, 960);
      return [sL[i] * e1 + tL[i] * e2, sR[i] * e1 + tR[i] * e2];
    });
    startSprong = na.plek - (s0 + (na.A - Aplay)) + (t3 - t2);
    bewaar('startstop', 'Start en stop', 'Start midden in het nummer (0,6 s), pauze (2,0 s), verder (2,8 s; gekoppeld: op de tel van de klok). B: hetzelfde met een zachte overvloei van 20 ms.', kanalen(r), B, { verderTovStop: startSprong });
  }
  // 4. laad over een spelende track, dan play.
  {
    const t1 = blok(2.0), t2 = blok(2.8);
    const extra = { ander: { soort: 'demo', id: 'demo-128' }, en: [{ t: t2, bus: ['track.1.play', true] }] };
    const r = await render({ bron: BRON, overgang: 'laad over spelend', ts: t1, extra });
    const ro = await render({ bron: BRON, ts: t1, overgang: 'geen', extra: {}, voor: [] });
    const [xL, xR] = kanalen(r), [oL, oR] = kanalen(ro);
    const a = Math.round((t1 + r.D) * SR), d = 192, wissel = Math.round(2.5 * SR);
    const B = meng(n, (i) => {
      if (i >= wissel) return [xL[i], xR[i]];
      const g = i < a ? 1 : i >= a + d ? 0 : 1 - (i - a) / d;
      return [oL[i] * g, oR[i] * g];
    });
    bewaar('laad', 'Laden over spelend', 'Een ander nummer laden op 2,0 s terwijl dit speelt, op 2,8 s play. B: het oude vloeit uit in 4 ms en verder niets.', kanalen(r), B, {});
  }
  writeFileSync(join(MAP, 'paren.js'), `// Gemaakt door abx-maak.mjs (${new Date().toISOString().slice(0, 10)}). Niet met de hand bewerken.\nwindow.ABX_PAREN = ${JSON.stringify(paren.map(({ id, naam, uitleg, a, b }) => ({ id, naam, uitleg, a, b })), null, 1)};\n`);
  return paren;
}

// ---- de pagina toetsen -------------------------------------------------------------------------

async function toetsPagina() {
  const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
  const uit = {};
  try {
    await page.goto(pathToFileURL(join(HIER, 'abx.html')).href + '?toets=1');
    await page.waitForFunction(() => window.__abx);
    uit.paren = await page.$$eval('#paren button', (b) => b.length);
    uit.naam = await page.textContent('#naam');
    // Speelt het? X zonder luisteren kiezen mag niet; dan A, B en X afspelen en kijken of de tijd loopt.
    await page.keyboard.press('1');
    uit.zonderLuisteren = await page.textContent('#melding');
    const speelt = {};
    for (const k of ['a', 'b', 'x']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(400);
      const s = await page.evaluate(() => window.__abx.stand());
      speelt[k] = { speelt: s.speelt, tijd: s.tijd };
    }
    uit.speelt = speelt;
    await page.keyboard.press(' ');
    uit.duur = await page.evaluate(async () => {
      const a = new Audio(window.ABX_PAREN[0].a);
      await new Promise((r) => { a.onloadedmetadata = r; a.onerror = r; });
      return a.duration;
    });
    // Paar 1: elke proef goed (de toets kijkt naar X). Paar 2: altijd "X is A".
    for (let p = 0; p < 2; p++) {
      const x = [];
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press('x');
        const s = await page.evaluate(() => window.__abx.stand());
        x.push(s.x);
        await page.keyboard.press(p === 0 ? (s.x === 'A' ? '1' : '2') : '1');
      }
      const u = await page.evaluate(() => window.__abx.uitslag());
      const r = u.paren[p];
      uit[`paar${p + 1}`] = { goed: r.goed, n: r.n, p: r.p, verwachtGoed: p === 0 ? 16 : x.filter((v) => v === 'A').length, xA: x.filter((v) => v === 'A').length, tekst: await page.textContent('#uitslag') };
      await page.waitForTimeout(1700);            // de pagina gaat vanzelf naar het volgende paar
    }
    uit.pControle = await page.evaluate(() => [window.__abx.pWaarde(12), window.__abx.pWaarde(16), window.__abx.pWaarde(0)]);
    uit.jsonOk = await page.evaluate(() => { try { const j = JSON.parse(document.getElementById('json').value); return j.paren.length === window.ABX_PAREN.length && j.paren[0].proeven.length === 16; } catch { return false; } });
    uit.huidigNa = await page.evaluate(() => window.__abx.stand().huidig);
  } finally {
    await browser.close();
  }
  uit.fouten = fouten;
  const binom = (k) => { let s = 0, c = 1; for (let i = 0; i <= 16; i++) { if (i >= k) s += c; c = c * (16 - i) / (i + 1); } return s / 65536; };
  uit.ok = uit.paren === 4 && /luister eerst/.test(uit.zonderLuisteren)
    && ['a', 'b', 'x'].every((k) => uit.speelt[k].speelt === k.toUpperCase() && uit.speelt[k].tijd > 0.1)
    && uit.paar1.goed === 16 && uit.paar1.n === 16 && Math.abs(uit.paar1.p - 1 / 65536) < 1e-12
    && uit.paar2.goed === uit.paar2.verwachtGoed && Math.abs(uit.paar2.p - binom(uit.paar2.goed)) < 1e-12
    && Math.abs(uit.pControle[0] - 2517 / 65536) < 1e-12 && uit.pControle[2] === 1
    && uit.jsonOk && uit.huidigNa === 2 && !fouten.length;
  return uit;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--toets')) {
    mkdirSync(MAP, { recursive: true });
    const o = await opzetOffline({ poort: 8813 });
    try {
      await installeerKlik(o.page);
      const paren = await maakParen(o);
      for (const p of paren) {
        console.log(`${p.naam.padEnd(20)} ${p.a} / ${p.b}   A−B: ${p.verschilDb.toFixed(1)} dB, grootste verschil ${p.grootsteVerschil.toExponential(2)} op ${p.waarS.toFixed(3)} s${p.sprongS ? `  (sprong ${p.sprongS.toFixed(4)} s)` : ''}${p.verderTovStop != null ? `  (verder ${(p.verderTovStop * 1000).toFixed(1)} ms t.o.v. de stop)` : ''}`);
      }
      if (o.fouten.length) console.log('FOUTEN in de pagina:\n' + o.fouten.join('\n'));
    } finally {
      await o.sluit();
    }
  }
  if (!existsSync(join(MAP, 'paren.js'))) { console.log('abx/paren.js ontbreekt'); process.exit(1); }
  const t = await toetsPagina();
  console.log('\nabx.html headless:', JSON.stringify(t, null, 1));
  console.log(t.ok ? 'GESLAAGD: de pagina laadt, speelt A, B en X, telt goed en rekent p goed uit' : 'MISLUKT');
  process.exitCode = t.ok ? 0 : 1;
}
