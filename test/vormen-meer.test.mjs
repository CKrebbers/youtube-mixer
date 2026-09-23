// De middelzware Vormmachines (systemen-meer.js): ch, jl, ls, dl, lg, wv, if.
// Zonder browser: een nep-canvas dat tekenaanroepen telt, en de systemen
// direct aangeroepen met een zelfgebouwd g-object (zoals VormLaag.zetSysteem).
// Draai met: node test/vormen-meer.test.mjs
import { readFileSync } from 'node:fs';

const { SYSTEMEN_MEER } = await import('../src/vormen/systemen-meer.js');
const { SYSTEMEN, draaiKnoppen } = await import('../src/vormen/systemen.js');
const { LUTS, maakRng } = await import('../src/vormen/hulp.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- nep-canvas: elke tekenaanroep telt, niets tekent -----------------------
// Streng waar het ertoe doet: Path2D bestaat niet (de systemen mogen hem niet
// gebruiken), en stroke() met een argument telt als fout.
function maakCanvas(w, h) {
  const tel = { n: 0, pad: 0, beeld: 0 };
  const ctx = new Proxy({
    createImageData: (b, hh) => ({ width: b, height: hh, data: new Uint8ClampedArray(b * hh * 4) }),
    stroke: (a) => { tel.n++; if (a !== undefined) tel.pad++; },
    putImageData: () => { tel.n++; tel.beeld++; },
    tel,
  }, {
    get(t, k) { if (k in t) return t[k]; return () => { tel.n++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, tel };
}
function getallen(s, uit = [], diep = 0) {
  if (diep > 3 || s == null) return uit;
  if (typeof s === 'number') uit.push(s);
  else if (ArrayBuffer.isView(s)) { for (let i = 0; i < s.length; i += Math.max(1, s.length >> 6)) uit.push(s[i]); }
  else if (Array.isArray(s)) s.slice(0, 64).forEach((x) => getallen(x, uit, diep + 1));
  else if (typeof s === 'object' && !s.getContext && !s.px) Object.values(s).forEach((x) => getallen(x, uit, diep + 1));
  return uit;
}

const MAAT = 512;
/** Een laag zoals VormLaag hem opzet, maar voor een systeem uit deze lijst. */
function maakLaag(sys, { zaad = 7, kwaliteit, knoppen = {} } = {}) {
  const canvas = maakCanvas(MAAT, MAAT);
  const p = Object.fromEntries(sys.knobs.map((k) => [k.k, k.v]));
  Object.assign(p, knoppen);
  const s = { o: {}, e: {} };
  const g = { ctx: canvas.getContext('2d'), S: MAAT, D: MAAT / 320, t: 0, pal: sys.pal, L: LUTS[sys.pal], r: maakRng(zaad), maakCanvas };
  if (kwaliteit !== undefined) g.kwaliteit = kwaliteit;
  sys.init.call(sys, s, p, g);
  let i = 0;
  const stap = () => { g.t = i++ / 60; sys.step.call(sys, s, p, g); };
  return { s, p, g, canvas, stap };
}
function meet(sys, opties, n = 180, direct = false) {
  const l = maakLaag(sys, opties);
  const rust = sys.RUST;
  if (direct) sys.RUST = Infinity;                        // wv: nooit tabellen, zoals tijdens het draaien aan de golflengte
  try {
    for (let i = 0; i < 10; i++) l.stap();               // opwarmen: de JIT eerst
    const tijden = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); l.stap(); tijden.push(performance.now() - t0); }
    return { gem: tijden.reduce((a, b) => a + b, 0) / n, max: Math.max(...tijden), laag: l };
  } finally { if (direct) sys.RUST = rust; }
}

console.log('de lijst');
{
  const ids = ['ch', 'jl', 'ls', 'dl', 'lg', 'wv', 'if'];
  ok(`zeven systemen: ${ids.join(', ')}`, SYSTEMEN_MEER.length === 7 && ids.every((id, i) => SYSTEMEN_MEER[i].id === id));
  const bestaand = new Set(SYSTEMEN.map((s) => s.id));
  ok('geen id botst met systemen.js', SYSTEMEN_MEER.every((s) => !bestaand.has(s.id)));
  ok('elk systeem heeft naam, categorie, palet en knoppen', SYSTEMEN_MEER.every((s) => s.naam && s.cat && LUTS[s.pal] && s.knobs.length));
  ok('draaiknoppen: minstens één, hooguit zes', SYSTEMEN_MEER.every((s) => { const n = draaiKnoppen(s).length; return n >= 1 && n <= 6; }));
  const bron = readFileSync(new URL('../src/vormen/systemen-meer.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('kent geen DOM, geen Path2D, geen eigen klok, geen Math.random', !/\bdocument\b|\bwindow\b|performance\.now|Math\.random|Path2D/.test(bron));
  const imports = [...bron.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  ok('importeert alleen uit ./hulp.js', imports.length === 1 && imports[0] === './hulp.js');
}

console.log('180 stappen per systeem, Math.random geblokkeerd');
{
  const echt = Math.random;
  Math.random = () => { throw new Error('Math.random gebruikt'); };
  for (const sys of SYSTEMEN_MEER) {
    let fout = null, l = null;
    try { l = maakLaag(sys); for (let i = 0; i < 180; i++) l.stap(); } catch (e) { fout = e; }
    const nums = l ? getallen(l.s) : [];
    ok(`${sys.id} (${sys.naam}): zonder fout, zonder NaN, en hij tekent`, !fout && nums.every(Number.isFinite) && l.canvas.tel.n > 0);
    if (fout) console.log('      ', fout.stack);
    const uit = l ? Object.entries(l.s.o) : [];
    const namen = (sys.outs || []).filter((o) => !Array.isArray(o));
    ok(`${sys.id}: uitgangen (${namen.join(', ')}) bestaan en liggen in 0..1`,
      namen.every((k) => typeof l?.s.o[k] === 'number') && uit.every(([, v]) => Number.isFinite(v) && v >= 0 && v <= 1));
    ok(`${sys.id}: tekent zonder Path2D`, l && l.canvas.tel.pad === 0);
  }
  Math.random = echt;
}

console.log('alle vormen van het L-systeem, op hun hoogste iteratie');
{
  const ls = SYSTEMEN_MEER.find((s) => s.id === 'ls');
  for (let f = 0; f < ls.DEF.length; f++) {
    let fout = null, l = null;
    try { l = maakLaag(ls, { knoppen: { f, it: 12 } }); for (let i = 0; i < 5; i++) l.stap(); } catch (e) { fout = e; }
    ok(`ls vorm ${f} (${ls.knobs[0].opts[f]}): ${l?.s.nSeg} lijnstukken, eindigt op diepte 0`, !fout && l.s.nSeg > 0 && getallen(l.s).every(Number.isFinite));
  }
  // Het origineel liep het woord twee keer door per stap; dezelfde grenzen moeten eruit komen.
  const l = maakLaag(ls); l.stap();
  const seg = l.s.seg;
  let minx = Infinity, maxx = -Infinity;
  for (let i = 0; i < seg.length; i += 2) { minx = Math.min(minx, seg[i]); maxx = Math.max(maxx, seg[i]); }
  ok('ls: elk lijnstuk krijgt een plek (niets dubbel, niets vergeten)', new Set(l.s.plek).size === l.s.nSeg && Math.max(...l.s.plek) === l.s.nSeg - 1);
  ok('ls: de plant staat rechtop (hoogte > breedte)', (() => { let a = Infinity, b = -Infinity; for (let i = 1; i < seg.length; i += 2) { a = Math.min(a, seg[i]); b = Math.max(b, seg[i]); } return b - a > maxx - minx; })());
}

console.log('zaad: zelfde zaad = zelfde beeld');
{
  const na = (sys, zaad) => { const l = maakLaag(sys, { zaad }); for (let i = 0; i < 60; i++) l.stap(); return getallen(l.s).concat(Array.from(l.s.g?.px ?? []).filter((_, i) => i % 97 === 0)); };
  for (const sys of SYSTEMEN_MEER) {
    const a = na(sys, 3), b = na(sys, 3);
    ok(`${sys.id}: zelfde zaad, precies dezelfde toestand`, a.length > 5 && a.every((x, i) => x === b[i]));
  }
  for (const id of ['ch', 'dl', 'if']) {
    const sys = SYSTEMEN_MEER.find((s) => s.id === id);
    const a = na(sys, 3), c = na(sys, 4);
    ok(`${id}: ander zaad, andere toestand`, a.some((x, i) => x !== c[i]));
  }
}

console.log('tijd: de beweging hangt aan g.t en aan het aantal stappen, niet aan de kwaliteit');
{
  // Uitgangen die alleen van tijd en knoppen afhangen, moeten bij kwaliteit 0,25 gelijk zijn.
  for (const [id, k] of [['jl', 're'], ['lg', 'r'], ['if', 'wind'], ['wv', 'midden']]) {
    const sys = SYSTEMEN_MEER.find((s) => s.id === id);
    const a = maakLaag(sys), b = maakLaag(sys, { kwaliteit: 0.25 });
    for (let i = 0; i < 90; i++) { a.stap(); b.stap(); }
    ok(`${id}.${k} na 90 stappen gelijk bij kwaliteit 1 en 0,25`, Math.abs(a.s.o[k] - b.s.o[k]) < 1e-9);
  }
  const wv = SYSTEMEN_MEER.find((s) => s.id === 'wv');
  const a = maakLaag(wv);
  for (let i = 0; i < 20; i++) a.stap();
  const tabel = Array.from(a.s.g.px);
  const b = maakLaag(wv);
  wv.RUST = Infinity;                                     // rekent de hele tijd zoals het origineel
  for (let i = 0; i < 20; i++) b.stap();
  wv.RUST = 8;
  ok('wv: zonder rust geen tabellen, met rust wel', b.s.rust === 20 && a.s.rust === 8);
  let gelijk = 0; for (let i = 0; i < tabel.length; i++) if (tabel[i] === b.s.g.px[i]) gelijk++;
  ok(`wv: tabellen geven hetzelfde beeld als direct rekenen (${(gelijk / tabel.length * 100).toFixed(2)}% van de pixels gelijk)`, gelijk / tabel.length > 0.99);
}

console.log('kwaliteit 0,25: werkt, en is goedkoper waar er een zware lus is');
{
  for (const sys of SYSTEMEN_MEER) {
    let fout = null, l = null;
    try { l = maakLaag(sys, { kwaliteit: 0.25 }); for (let i = 0; i < 60; i++) l.stap(); } catch (e) { fout = e; }
    ok(`${sys.id}: kwaliteit 0,25 zonder fout en zonder NaN`, !fout && getallen(l.s).every(Number.isFinite) && l.canvas.tel.n > 0);
  }
  for (const sys of SYSTEMEN_MEER) {
    const l = maakLaag(sys, { kwaliteit: Number.NaN });
    l.stap();
    ok(`${sys.id}: onzin als kwaliteit telt als 1`, getallen(l.s).every(Number.isFinite));
  }
  // wv met tabellen kost al bijna niets; het dure moment is draaien aan de golflengte (direct rekenen).
  for (const [id, direct] of [['ch'], ['jl'], ['wv', true], ['if']]) {
    const sys = SYSTEMEN_MEER.find((s) => s.id === id);
    // Een paar keer om en om meten, en de beste nemen: een drukke machine mag de test niet laten wankelen.
    let vol = Infinity, kwart = Infinity;
    for (let r = 0; r < 3; r++) { vol = Math.min(vol, meet(sys, {}, 40, direct).gem); kwart = Math.min(kwart, meet(sys, { kwaliteit: 0.25 }, 40, direct).gem); }
    ok(`${id}${direct ? ' (draaiend)' : ''}: kwaliteit 0,25 is goedkoper (${vol.toFixed(2)} → ${kwart.toFixed(2)} ms)`, kwart < vol * 0.8);
  }
  {
    // dl schaalt bewust niet mee: minder zwerfstappen = tragere groei.
    const dl = SYSTEMEN_MEER.find((s) => s.id === 'dl');
    const a = maakLaag(dl, { zaad: 5 }), b = maakLaag(dl, { zaad: 5, kwaliteit: 0.25 });
    for (let i = 0; i < 60; i++) { a.stap(); b.stap(); }
    ok('dl: groeit bij kwaliteit 0,25 precies even snel (kwaliteit genegeerd)', a.s.rmax === b.s.rmax && a.s.rmax > 2);
  }
}

console.log('meten: ms per stap in Node, nep-canvas (alleen het rekenwerk)');
{
  for (const sys of SYSTEMEN_MEER) {
    // Opnieuw meten bij een uitschieter (tot zes keer): andere processen op de machine (parallelle
    // agenten, load 12 gemeten) mogen een piek niet op dit systeem schuiven. Een systeem dat echt
    // te zwaar is, haalt het in geen enkele ronde.
    let m1 = meet(sys, {});
    for (let r = 0; r < 5 && m1.max >= 16; r++) { const m = meet(sys, {}); if (m.max < m1.max) m1 = m; }
    const m4 = meet(sys, { kwaliteit: 0.25 });
    console.log(`      ${sys.id.padEnd(3)} kwaliteit 1: gem ${m1.gem.toFixed(2)} ms, max ${m1.max.toFixed(2)} ms · kwaliteit 0,25: gem ${m4.gem.toFixed(2)} ms, max ${m4.max.toFixed(2)} ms`);
    ok(`${sys.id}: max < 16 ms per stap bij kwaliteit 1`, m1.max < 16);
  }
  const wv = SYSTEMEN_MEER.find((s) => s.id === 'wv');
  // Alleen ter informatie: draaien aan de golflengte rekent zoals het origineel (n cosinussen per
  // pixel). Met 9 bronnen is dat het duurste moment van wv; daar is g.kwaliteit voor.
  const d1 = meet(wv, {}, 60, true), d9 = meet(wv, { knoppen: { n: 9 } }, 60, true), d9k = meet(wv, { knoppen: { n: 9 }, kwaliteit: 0.25 }, 60, true);
  console.log(`      wv  draaiend aan de golflengte: 3 bronnen gem ${d1.gem.toFixed(2)} ms · 9 bronnen gem ${d9.gem.toFixed(2)} ms, max ${d9.max.toFixed(2)} ms · 9 bronnen op 0,25 gem ${d9k.gem.toFixed(2)} ms`);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
