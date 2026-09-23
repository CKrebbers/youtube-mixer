// De zware Vormmachines (gs, cl, ln, ph, sp): zonder browser, met een
// nep-canvas. Elk systeem draait, is herhaalbaar, luistert naar g.kwaliteit,
// en blijft binnen een beeld (16 ms) per stap.
// Draai met: node test/vormen-zwaar.test.mjs
import { readFileSync } from 'node:fs';

const { SYSTEMEN_ZWAAR, kwaliteit, HALF_ONDER, SP_MAX_OMVAL, sinT } = await import('../src/vormen/systemen-zwaar.js');
const { draaiKnoppen, SYSTEMEN } = await import('../src/vormen/systemen.js');
const { LUTS, maakRng } = await import('../src/vormen/hulp.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- nep-canvas: elke tekenaanroep telt, niets tekent (zoals vormen.test) --
function maakCanvas(w, h) {
  const tel = { n: 0 };
  const ctx = new Proxy({
    createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }),
    tel,
  }, {
    get(t, k) { if (k in t) return t[k]; return () => { tel.n++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, tel };
}
/** Een g zoals VormLaag.zetSysteem hem bouwt, op S = 640 (de maat uit de meting). */
function maakG(sys, { zaad = 7, q, S = 640 } = {}) {
  const canvas = maakCanvas(S, S);
  const g = { ctx: canvas.getContext('2d'), S, D: S / 320, t: 0, pal: sys.pal, L: LUTS[sys.pal], r: maakRng(zaad), maakCanvas, canvas };
  if (q !== undefined) g.kwaliteit = q;
  return g;
}
function start(sys, opt = {}) {
  const p = Object.fromEntries(sys.knobs.map((k) => [k.k, k.v]));
  Object.assign(p, opt.p);
  const s = { o: {}, e: {} }, g = maakG(sys, opt);
  sys.init.call(sys, s, p, g);
  let i = 0;
  const stap = (n = 1) => { for (let k = 0; k < n; k++) { g.t = ++i / 60; s.e = {}; sys.step.call(sys, s, p, g); } };
  return { s, p, g, stap };
}
/** Alle getallen in de toestand, om NaN te vinden en toestanden te vergelijken. */
function getallen(s, uit = [], diep = 0) {
  if (diep > 3 || s == null) return uit;
  if (typeof s === 'number') uit.push(s);
  else if (ArrayBuffer.isView(s)) { for (let i = 0; i < s.length; i += Math.max(1, s.length >> 8)) uit.push(s[i]); }
  else if (Array.isArray(s)) s.slice(0, 64).forEach((x) => getallen(x, uit, diep + 1));
  else if (typeof s === 'object' && !s.getContext && !s.px) Object.values(s).forEach((x) => getallen(x, uit, diep + 1));
  return uit;
}
/** Alle pixelroosters in de toestand (ook die van gs/ln per maat). */
function roosters(s, uit = [], diep = 0) {
  if (diep > 2 || s == null || typeof s !== 'object' || ArrayBuffer.isView(s)) return uit;
  if (s.px instanceof Uint32Array) { uit.push(s); return uit; }
  for (const v of Object.values(s)) roosters(v, uit, diep + 1);
  return uit;
}
const ID = Object.fromEntries(SYSTEMEN_ZWAAR.map((s) => [s.id, s]));

console.log('de bestanden');
{
  const bron = readFileSync(new URL('../src/vormen/systemen-zwaar.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('systemen-zwaar.js kent geen DOM, geen eigen klok en geen Math.random', !/\bdocument\b|\bwindow\b|performance\.now|Math\.random|Path2D/.test(bron));
  const imports = [...bron.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  ok('importeert alleen uit ./hulp.js', imports.length >= 1 && imports.every((i) => i === './hulp.js'));
  ok('vijf systemen: gs, cl, ln, ph, sp', SYSTEMEN_ZWAAR.map((s) => s.id).sort().join() === 'cl,gs,ln,ph,sp');
  const alle = [...SYSTEMEN, ...SYSTEMEN_ZWAAR].map((s) => s.id);
  ok('geen id botst met de lichte systemen', new Set(alle).size === alle.length);
  ok('elk systeem heeft naam, palet, knoppen, init en step', SYSTEMEN_ZWAAR.every((s) => s.naam && LUTS[s.pal] && s.knobs.length && typeof s.init === 'function' && typeof s.step === 'function'));
}

console.log('elk systeem: 180 stappen, zonder Math.random');
{
  const echt = Math.random;
  Math.random = () => { throw new Error('Math.random gebruikt'); };
  for (const sys of SYSTEMEN_ZWAAR) {
    let fout = null, r = null;
    try { r = start(sys); r.stap(180); } catch (e) { fout = e; }
    const nums = r ? getallen(r.s) : [];
    const L0 = LUTS[sys.pal][0];
    const beeld = r ? roosters(r.s).some((gr) => gr.px.some((v) => v !== L0)) : false;
    ok(`${sys.id} (${sys.naam}): geen fout, geen NaN, en hij tekent`, !fout && nums.length > 10 && nums.every(Number.isFinite) && r.g.canvas.tel.n > 0 && beeld);
    if (fout) console.log('      ', fout.message);
    const uit = r ? Object.values(r.s.o) : [];
    ok(`${sys.id}: uitgangen zoals het origineel, allemaal 0..1`, uit.length >= 2 && uit.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
  }
  Math.random = echt;
}

console.log('zaad: herhaalbaar');
{
  for (const sys of SYSTEMEN_ZWAAR) {
    const na = (zaad) => { const r = start(sys, { zaad }); r.stap(40); return getallen(r.s); };
    const a = na(3), b = na(3);
    ok(`${sys.id}: zelfde zaad = precies dezelfde toestand`, a.length > 10 && a.length === b.length && a.every((x, i) => Object.is(x, b[i])));
    if (['gs', 'ln', 'ph'].includes(sys.id)) {
      const c = na(4);
      ok(`${sys.id}: ander zaad = andere toestand`, a.some((x, i) => x !== c[i]));
    }
  }
}

console.log('draaiknoppen');
for (const sys of SYSTEMEN_ZWAAR) {
  const dk = draaiKnoppen(sys);
  ok(`${sys.id}: ${dk.length} draaiknop(pen) (${dk.map((k) => k.k).join(', ')}), tussen 1 en 6, geen keuzelijst of herstart`,
    dk.length >= 1 && dk.length <= 6 && dk.every((k) => !k.sel && !k.re));
}

console.log('g.kwaliteit');
{
  ok('ontbreekt = 1, geklemd op 0,25..1', kwaliteit({}) === 1 && kwaliteit({ kwaliteit: 0.1 }) === 0.25 && kwaliteit({ kwaliteit: 3 }) === 1 && kwaliteit({ kwaliteit: NaN }) === 1 && kwaliteit({ kwaliteit: 0.5 }) === 0.5);

  // Elk systeem op 0,25: werkt, geen NaN, tekent.
  for (const sys of SYSTEMEN_ZWAAR) {
    let fout = null, r = null;
    try { r = start(sys, { q: 0.25 }); r.stap(180); } catch (e) { fout = e; }
    ok(`${sys.id}: op kwaliteit 0,25 geen fout en geen NaN`, !fout && getallen(r.s).every(Number.isFinite) && r.g.canvas.tel.n > 0);
    if (fout) console.log('      ', fout.message);
  }

  // gs en ln: halve maat onder HALF_ONDER, en terug, met de toestand mee.
  for (const id of ['gs', 'ln']) {
    const r = start(ID[id], { q: 1 });
    r.stap(120);
    const vol = r.s.cur;
    r.g.kwaliteit = 0.25; r.stap(1);
    const half = r.s.cur;
    const nVol = vol.n ?? vol.N, nHalf = half.n ?? half.N;
    ok(`${id}: onder ${HALF_ONDER} rekent hij op de halve maat (${nVol} -> ${nHalf})`, nHalf * 2 === nVol);
    const voor = id === 'gs' ? r.s.o.dekking : r.s.o.massa;
    r.stap(120);
    const na = id === 'gs' ? r.s.o.dekking : r.s.o.massa;
    ok(`${id}: het beeld blijft hetzelfde soort (${voor.toFixed(2)} -> ${na.toFixed(2)})`, na > voor * 0.6 && na < voor * 1.6 + 0.05);
    r.g.kwaliteit = 1; r.stap(1);
    ok(`${id}: terug naar kwaliteit 1 = weer de volle maat`, r.s.cur === vol);
    r.stap(60);
    ok(`${id}: en dat loopt gewoon door (geen NaN)`, getallen(r.s).every(Number.isFinite) && Object.values(r.s.o).every(Number.isFinite));
  }
  // gs: de diffusie gaat mee met de celmaat, dus vlekken houden hun maat
  // op het scherm en groeien even hard. Zelfde zaad, zelfde begin: na
  // 150 stappen is op beide maten ongeveer even veel van het beeld bedekt.
  {
    const bedekt = (q) => {
      const r = start(ID.gs, { q, zaad: 1 });
      r.stap(150);
      const v = r.s.cur.v;
      let aan = 0;
      for (let i = 0; i < v.length; i++) if (v[i] > 0.1) aan++;
      return aan / v.length;
    };
    const a = bedekt(1), b = bedekt(0.25);
    ok(`gs: op de halve maat groeit het patroon even hard (${(a * 100).toFixed(1)}% tegen ${(b * 100).toFixed(1)}% bedekt na 150 stappen)`, a > 0.2 && Math.abs(a - b) < 0.15 * a);
  }
  // ph: minder agents, elk even snel (één stap = één eenheid).
  {
    const r = start(ID.ph, { q: 0.25 });
    const x0 = r.s.ax.slice(), y0 = r.s.ay.slice();
    r.stap(1);
    const n = Math.round(r.s.n * 0.25);
    const d = (i) => { let dx = Math.abs(r.s.ax[i] - x0[i]), dy = Math.abs(r.s.ay[i] - y0[i]); dx = Math.min(dx, 160 - dx); dy = Math.min(dy, 160 - dy); return Math.hypot(dx, dy); };
    ok(`ph: op 0,25 lopen ${n} van de ${r.s.n} agents, even snel`, Math.abs(d(0) - 1) < 1e-3 && Math.abs(d(n - 1) - 1) < 1e-3 && r.s.ax[n + 5] === x0[n + 5]);
  }
  // cl: sinus uit de tabel, over het hele bereik dat de attractor gebruikt.
  {
    let fout = 0;
    for (let v = -20; v <= 20; v += 0.0007) fout = Math.max(fout, Math.abs(sinT(v) - Math.sin(v)));
    ok(`cl: sinustabel wijkt hooguit 1e-7 af (${fout.toExponential(1)})`, fout < 1e-7);
  }
  // cl: de kleur via drempels is dezelfde als log + pow per pixel.
  {
    const r = start(ID.cl, { p: { drift: 0 } });  // zonder drift vervaagt h niet na het kleuren
    r.stap(30);
    const h = r.s.h, L = r.g.L, px = r.s.g.px, lm = 1 / Math.log(1 + r.s.m);
    let mis = 0, gezien = 0;
    for (let i = 0; i < h.length; i += 37) {
      if (!h[i]) continue;
      gezien++;
      const k = Math.min(255, (Math.pow(Math.log(1 + h[i]) * lm, 0.7) * 255) | 0);
      if (px[i] !== L[k] && px[i] !== L[Math.max(0, k - 1)] && px[i] !== L[Math.min(255, k + 1)]) mis++;
    }
    let echtMax = 1;
    for (let i = 0; i < h.length; i++) if (h[i] > echtMax) echtMax = h[i];
    ok(`cl: kleur gelijk aan de formule van het origineel (${gezien} pixels, hooguit één tint verschil)`, gezien > 100 && mis === 0);
    ok('cl: het bijgehouden maximum klopt met het echte', Math.abs(echtMax - r.s.m) / echtMax < 1e-3);
  }
}

console.log('zandhoop: begrensd, en toch dezelfde vorm');
{
  // Referentie: het origineel, met de onbegrensde lus.
  const N = 129, c = N >> 1;
  const ref = new Uint32Array(N * N);
  const legOrigineel = (add) => {
    const a = ref, st = [];
    a[c * N + c] += add; st.push(c * N + c);
    while (st.length) {
      const i = st.pop(), v = a[i];
      if (v < 4) continue;
      const q = v >> 2; a[i] = v & 3;
      const x = i % N, y = (i / N) | 0;
      if (x > 0) { a[i - 1] += q; if (a[i - 1] >= 4) st.push(i - 1); }
      if (x < N - 1) { a[i + 1] += q; if (a[i + 1] >= 4) st.push(i + 1); }
      if (y > 0) { a[i - N] += q; if (a[i - N] >= 4) st.push(i - N); }
      if (y < N - 1) { a[i + N] += q; if (a[i + N] >= 4) st.push(i + N); }
    }
  };
  // Het origineel krijgt de korrels pas als we vergelijken, allemaal tegelijk:
  // de stapel is abels, dus de uitkomst is dezelfde, en het scheelt rekenen.
  const GPF = 600, r = start(ID.sp, { q: 0.25, p: { gpf: GPF } });
  const max = Math.round(SP_MAX_OMVAL * 0.25);
  let stappen = 0, achter = 0, vergeleken = 0, gelijk = true, meest = 0, open = 0;
  for (let i = 0; i < 300 && !r.s.done; i++) {
    r.stap(1); stappen++;
    open += GPF;
    meest = Math.max(meest, r.s.omval);
    if (r.s.sn === 0 && !r.s.done) { legOrigineel(open); open = 0; }
    if (r.s.sn > 0) achter++;
    else if (!r.s.done) { vergeleken++; if (!r.s.a.every((v, j) => v === ref[j])) gelijk = false; }
  }
  ok(`nooit meer dan ${max} omvallers per stap op kwaliteit 0,25 (meest ${meest}; de lawine liep ${achter} van de ${stappen} stappen achter)`, meest <= max && meest > 0 && achter > 0);
  ok(`waar hij bijgelopen is (${vergeleken}×), is de stapel precies die van het origineel (abels)`, vergeleken > 0 && gelijk);
  ok('de stapel met achterstand past altijd (één plek per cel)', r.s.sn <= N * N);

  const r2 = start(ID.sp);
  r2.stap(10);
  r2.s.done = 60;                                // "vol" op t = 60 s, en dan een nieuwe AudioContext:
  r2.stap(1);                                    // de klok staat weer op 11/60 s
  ok('terug in de tijd na "vol": hij begint opnieuw in plaats van eeuwig te wachten', r2.s.done === 0);
}

console.log('tijd per stap (S = 640, zonder echt tekenen: een ondergrens)');
{
  const meet = (sys, q, n = 200) => {
    const r = start(sys, { q });
    r.stap(40);                                  // opwarmen (JIT)
    const ts = [];
    // Per stap de kleinste van wandkloktijd en processortijd: de wandklok telt
    // mee als de machine ons even wegzet (andere processen), de processortijd
    // telt GC-draden mee. Wat overblijft is wat de stap zelf kost.
    for (let i = 0; i < n; i++) {
      const c0 = process.cpuUsage(), t0 = performance.now();
      r.stap(1);
      const wand = performance.now() - t0, c = process.cpuUsage(c0);
      ts.push(Math.min(wand, (c.user + c.system) / 1000));
    }
    ts.sort((a, b) => a - b);
    return { gem: ts.reduce((a, b) => a + b, 0) / n, p99: ts[Math.floor(n * 0.99)], max: ts[n - 1] };
  };
  for (const sys of SYSTEMEN_ZWAAR) {
    // Een uitschieter door een drukke machine (andere processen) is geen
    // eigenschap van het systeem: tot drie keer meten, de beste run telt.
    let best = null;
    for (let poging = 0; poging < 3 && !(best && best.max < 16); poging++) {
      const m = meet(sys, 1);
      if (!best || m.max < best.max) best = m;
    }
    const laag = [0, 1].map(() => meet(sys, 0.25, 80)).reduce((a, b) => (a.gem < b.gem ? a : b));
    const vol = [0, 1].map(() => meet(sys, 1, 80)).reduce((a, b) => (a.gem < b.gem ? a : b));
    console.log(`      ${sys.id}: kwaliteit 1 gem ${best.gem.toFixed(2)} ms, p99 ${best.p99.toFixed(2)}, max ${best.max.toFixed(2)} · kwaliteit 0,25 gem ${laag.gem.toFixed(2)} ms, max ${laag.max.toFixed(2)}`);
    ok(`${sys.id}: hooguit 16 ms per stap op kwaliteit 1 (max ${best.max.toFixed(1)} ms)`, best.max < 16);
    ok(`${sys.id}: kwaliteit 0,25 is goedkoper (${laag.gem.toFixed(2)} tegen ${vol.gem.toFixed(2)} ms)`, laag.gem < vol.gem * 0.85);
  }
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
