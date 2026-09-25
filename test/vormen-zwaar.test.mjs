// De zware Vormmachines (gs, cl, ln, ph, sp): zonder browser, met een
// nep-canvas van 640 × 360 (16:9, zoals laag.js). Elk systeem draait, is
// herhaalbaar, vult het doek, luistert naar g.kwaliteit, en blijft binnen een
// beeld (16 ms) per stap.
// Draai met: node test/vormen-zwaar.test.mjs
import { readFileSync } from 'node:fs';

const { SYSTEMEN_ZWAAR, kwaliteit, HALF_ONDER, SP_MAX_OMVAL, ROOSTER, sinT } = await import('../src/vormen/systemen-zwaar.js');
const { draaiKnoppen, SYSTEMEN } = await import('../src/vormen/systemen.js');
const { LUTS, maakRng, maten, midden } = await import('../src/vormen/hulp.js');
const { LAAG_BREEDTE, LAAG_HOOGTE } = await import('../src/vormen/laag.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- nep-canvas: elke tekenaanroep telt, niets tekent (zoals vormen.test) --
// drawImage bewaart zijn argumenten: zo is te zien WAAR een rooster landt.
function maakCanvas(w, h) {
  const tel = { n: 0 }, getekend = [];
  const ctx = new Proxy({
    createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }),
    drawImage: (...a) => { tel.n++; getekend.push(a); },
    tel, getekend,
  }, {
    get(t, k) { if (k in t) return t[k]; return () => { tel.n++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, tel, getekend };
}
/** Een g zoals VormLaag.zetSysteem hem bouwt: 640 × 360, W/H/D uit maten(). */
function maakG(sys, { zaad = 7, q, W = LAAG_BREEDTE, H = LAAG_HOOGTE } = {}) {
  const canvas = maakCanvas(W, H);
  const g = { ctx: canvas.getContext('2d'), ...maten(W, H), t: 0, pal: sys.pal, L: LUTS[sys.pal], r: maakRng(zaad), maakCanvas, canvas };
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
  // g.S (verouderd, = g.H) niet als g.S en niet uitgepakt als { S } = g.
  ok('16:9: gebruikt g.S niet meer', !/\bg\.S\b/.test(bron) && !/\{[^}=]*\bS\b[^}=]*\}\s*=\s*g\b/.test(bron));
  ok('vijf systemen: gs, cl, ln, ph, sp', SYSTEMEN_ZWAAR.map((s) => s.id).sort().join() === 'cl,gs,ln,ph,sp');
  ok('ze staan in SYSTEMEN, en geen id komt twee keer voor', SYSTEMEN_ZWAAR.every((s) => SYSTEMEN.includes(s)) && new Set(SYSTEMEN.map((s) => s.id)).size === SYSTEMEN.length);
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

console.log('16:9: het hele doek, vierkante cellen');
{
  const W = LAAG_BREEDTE, H = LAAG_HOOGTE, vak = midden({ W, H }).vak;
  const vierkant = (nx, ny) => Math.abs((W / nx) / (H / ny) - 1) < 0.01;
  // Waar het rooster op het doek landt: het laatste drawImage van een stap.
  for (const sys of SYSTEMEN_ZWAAR) {
    const r = start(sys);
    r.stap(3);
    const [, x, y, b, h] = r.g.canvas.getekend.at(-1) ?? [];
    if (sys.id === 'cl') ok(`cl: het vierkante histogram landt in het middenvak (${x}, ${y}, ${b} × ${h}), de vorm heel in beeld`, x === vak.x && y === vak.y && b === vak.b && h === vak.h);
    else ok(`${sys.id}: het rooster beslaat het hele doek (${x}, ${y}, ${b} × ${h})`, x === 0 && y === 0 && b === W && h === H);
  }
  // gs en ln: nx × ny met vierkante cellen, evenveel als het oude n × n.
  for (const id of ['gs', 'ln']) {
    const n = ROOSTER[id], { vol, half } = start(ID[id]).s;
    ok(`${id}: ${vol.nx} × ${vol.ny} met vierkante cellen, even, en de halve maat ${half.nx} × ${half.ny} ook vierkant`,
      vierkant(vol.nx, vol.ny) && vierkant(half.nx, half.ny) && vol.nx % 2 === 0 && vol.ny % 2 === 0 && vol.nx > vol.ny * 1.7);
    ok(`${id}: evenveel cellen als het oude ${n}² (${vol.nx * vol.ny} tegen ${n * n}), dus dezelfde rekentijd`, Math.abs(vol.nx * vol.ny / (n * n) - 1) < 0.02);
  }
  // ln: de kernel klopt op het halve rooster, ook bij een oneven straal.
  const straal = (c) => { let som = 0; for (let k = 0; k < c.off.length; k++) { const dy = Math.round(c.off[k] / c.Px), dx = c.off[k] - dy * c.Px; som += c.w[k] * Math.hypot(dx, dy); } return som; };
  for (const R of [7, 10, 13]) {
    const { vol, half } = start(ID.ln, { p: { R } }).s;
    const a = straal(vol), b = straal(half);
    ok(`ln: kernelstraal ${R} -> op de halve maat ${half.R}; gewogen straal ${a.toFixed(2)} -> ${b.toFixed(2)} cel, de helft (±3%)`,
      vol.R === R && half.R === R / 2 && Math.abs(a / b / 2 - 1) < 0.03 && Math.abs(vol.w.reduce((x, y) => x + y, 0) - 1) < 1e-5);
  }
  // gs: zaaien per as (x 0,95 is rechts op het brede rooster).
  {
    const r = start(ID.gs), c = r.s.cur, i = ((0.5 * c.ny) | 0) * c.nx + ((0.95 * c.nx) | 0);
    c.v[i] = 0;
    ID.gs.pointer.call(ID.gs, r.s, r.p, 0.95, 0.5, r.g);
    ok('gs: pointer per as: (0,95; 0,5) zaait rechts op het brede rooster', c.v[i] >= 0.25);
  }
  // ph: deeltjes houden schaal en snelheid t.o.v. de hoogte; rekentijd hooguit × W/H.
  {
    const r = start(ID.ph), { nx, ny, n, ax, ay } = r.s;
    ok(`ph: spoorveld ${nx} × ${ny}, cellen van g.H / ${ROOSTER.ph} (als op het oude vierkant van 160), vierkant`, ny === ROOSTER.ph && vierkant(nx, ny));
    ok(`ph: evenveel agents per cel als 5000 op 160² (${n} op ${nx * ny})`, Math.abs(n / (nx * ny) / (5000 / 25600) - 1) < 0.01);
    ok(`ph: rekentijd groeit hooguit met de verhouding van de oppervlaktes (${(nx * ny / 25600).toFixed(2)}× cellen, ${(n / 5000).toFixed(2)}× agents, grens ${(W / H).toFixed(2)})`,
      nx * ny / 25600 <= W / H * 1.01 && n / 5000 <= W / H * 1.01);
    let sx = 0, sy = 0, rmax = 0;
    for (let i = 0; i < n; i++) { sx += ax[i]; sy += ay[i]; rmax = Math.max(rmax, Math.hypot(ax[i] - nx / 2, ay[i] - ny / 2)); }
    ok(`ph: de agents beginnen in een schijf rond het midden (${(sx / n / nx).toFixed(2)}, ${(sy / n / ny).toFixed(2)}), straal op de korte zijde`,
      Math.abs(sx / n / nx - 0.5) < 0.01 && Math.abs(sy / n / ny - 0.5) < 0.01 && rmax <= 0.32 * ny + 1e-3);
  }
  // cl: de vorm blijft heel: de rand van het histogram blijft leeg.
  {
    const r = start(ID.cl);
    r.stap(120);
    const { N, h } = r.s, rand = Math.floor(N * 0.02);
    let buiten = 0, rijen = 0;
    for (let y = 0; y < N; y++) {
      let rij = 0;
      for (let x = 0; x < N; x++) { if (!h[y * N + x]) continue; rij = 1; if (x < rand || x >= N - rand || y < rand || y >= N - rand) buiten++; }
      rijen += rij;
    }
    ok(`cl: niets in de buitenste 2% van het histogram (heel in beeld), en hij beslaat ${(rijen / N * 100).toFixed(0)}% van de hoogte`, buiten === 0 && rijen > N * 0.4);
  }
  // sp: oneven maten, symmetrisch, en "vol" pas aan de zijkant.
  {
    const r = start(ID.sp), { nx, ny } = r.s, a = r.s.a;
    ok(`sp: ${nx} × ${ny}, oneven (exact midden), vierkante cellen van ~4 pixels`, nx % 2 === 1 && ny % 2 === 1 && vierkant(nx, ny) && Math.abs(W / nx - 4) < 0.1);
    ok(`sp: minder cellen dan het oude 129² (${nx * ny}): de lawine is begrensd, zo is hij sneller vol`, nx * ny < 129 * 129);
    let bij = 0, sym = true, stappen = 0;
    for (let i = 0; i < 600 && !r.s.done; i++) {
      r.stap(1); stappen++;
      if (r.s.sn || r.s.done) continue;
      bij++;
      for (let y = 0; y < ny && sym; y++) for (let x = 0; x < nx; x++) if (a[y * nx + x] !== a[y * nx + nx - 1 - x] || a[y * nx + x] !== a[(ny - 1 - y) * nx + x]) { sym = false; break; }
    }
    ok(`sp: waar hij bijgelopen is (${bij}×) is de mandala spiegelsymmetrisch, links-rechts en boven-onder`, bij > 0 && sym);
    let zij = false, boven = false, onder = false;
    for (let y = 0; y < ny; y++) if (a[y * nx + 1] || a[y * nx + nx - 2]) zij = true;
    for (let x = 0; x < nx; x++) { if (a[x]) boven = true; if (a[(ny - 1) * nx + x]) onder = true; }
    ok(`sp: "vol" na ${(stappen / 60).toFixed(1)} s, als de hoop de zijkant raakt; boven- en onderrand zijn dan al bereikt (massa ${r.s.o.massa.toFixed(2)})`,
      r.s.done > 0 && zij && boven && onder && stappen / 60 < 4 && r.s.o.massa > 0.5);
  }
  // sp: de andere plekken liggen symmetrisch op het brede rooster.
  for (const [pl, naam] of [[1, 'vier punten'], [2, 'diagonaal']]) {
    const r = start(ID.sp, { p: { pl } }), { nx, ny, a, pts } = r.s;
    let bij = 0, sym = true, stappen = 0;
    for (let i = 0; i < 900 && !r.s.done; i++) {
      r.stap(1); stappen++;
      if (r.s.sn || r.s.done) continue;
      bij++;
      for (let j = 0; j < a.length && sym; j++) {
        const x = j % nx, y = (j / nx) | 0;
        if (pl === 1 ? a[j] !== a[y * nx + nx - 1 - x] || a[j] !== a[(ny - 1 - y) * nx + x] : a[j] !== a[a.length - 1 - j]) sym = false;
      }
    }
    const binnen = pts.every(([x, y]) => x > 0 && x < nx - 1 && y > 0 && y < ny - 1);
    ok(`sp (${naam}): ${pts.length} plekken op het brede rooster, ${pl === 1 ? 'spiegelsymmetrisch' : 'puntsymmetrisch'} waar hij bijliep (${bij}×), vol na ${(stappen / 60).toFixed(1)} s`,
      binnen && bij > 0 && sym && r.s.done > 0 && getallen(r.s).every(Number.isFinite));
  }
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
    ok(`${id}: onder ${HALF_ONDER} rekent hij op de halve maat (${vol.nx} × ${vol.ny} -> ${half.nx} × ${half.ny})`,
      half !== vol && half.nx * 2 === vol.nx && half.ny * 2 === vol.ny);
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
    const d = (i) => { let dx = Math.abs(r.s.ax[i] - x0[i]), dy = Math.abs(r.s.ay[i] - y0[i]); dx = Math.min(dx, r.s.nx - dx); dy = Math.min(dy, r.s.ny - dy); return Math.hypot(dx, dy); };
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
  // Referentie: het origineel, met de onbegrensde lus, op hetzelfde rooster.
  const GPF = 600, r = start(ID.sp, { q: 0.25, p: { gpf: GPF } });
  const NX = r.s.nx, NY = r.s.ny, c = (NY >> 1) * NX + (NX >> 1);
  const ref = new Uint32Array(NX * NY);
  const legOrigineel = (add) => {
    const a = ref, st = [];
    a[c] += add; st.push(c);
    while (st.length) {
      const i = st.pop(), v = a[i];
      if (v < 4) continue;
      const q = v >> 2; a[i] = v & 3;
      const x = i % NX, y = (i / NX) | 0;
      if (x > 0) { a[i - 1] += q; if (a[i - 1] >= 4) st.push(i - 1); }
      if (x < NX - 1) { a[i + 1] += q; if (a[i + 1] >= 4) st.push(i + 1); }
      if (y > 0) { a[i - NX] += q; if (a[i - NX] >= 4) st.push(i - NX); }
      if (y < NY - 1) { a[i + NX] += q; if (a[i + NX] >= 4) st.push(i + NX); }
    }
  };
  // Het origineel krijgt de korrels pas als we vergelijken, allemaal tegelijk:
  // de stapel is abels, dus de uitkomst is dezelfde, en het scheelt rekenen.
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
  ok('de stapel met achterstand past altijd (één plek per cel)', r.s.sn <= NX * NY);

  const r2 = start(ID.sp);
  r2.stap(10);
  r2.s.done = 60;                                // "vol" op t = 60 s, en dan een nieuwe AudioContext:
  r2.stap(1);                                    // de klok staat weer op 11/60 s
  ok('terug in de tijd na "vol": hij begint opnieuw in plaats van eeuwig te wachten', r2.s.done === 0);
}

console.log('tijd per stap (640 × 360, zonder echt tekenen: een ondergrens)');
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
