// De middelzware Vormmachines (systemen-meer.js): ch, jl, ls, dl, lg, wv, if.
// Zonder browser: een nep-canvas dat tekenaanroepen telt, en de systemen
// direct aangeroepen met een zelfgebouwd g-object (zoals VormLaag.zetSysteem).
// Draai met: node test/vormen-meer.test.mjs
import { readFileSync } from 'node:fs';

const { SYSTEMEN_MEER } = await import('../src/vormen/systemen-meer.js');
const { SYSTEMEN, draaiKnoppen } = await import('../src/vormen/systemen.js');
const { LUTS, maakRng, maten, midden } = await import('../src/vormen/hulp.js');
const { LAAG_BREEDTE, LAAG_HOOGTE } = await import('../src/vormen/laag.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- nep-canvas: elke tekenaanroep telt, niets tekent -----------------------
// Streng waar het ertoe doet: Path2D bestaat niet (de systemen mogen hem niet
// gebruiken), en stroke() met een argument telt als fout. Voor de 16:9-checks
// onthoudt hij de laatste drawImage-aanroepen (bron en doelrechthoek) en de
// grenzen van alle punten van moveTo/lineTo/arc.
function maakCanvas(w, h) {
  const tel = { n: 0, pad: 0, beeld: 0, blits: [], minx: Infinity, maxx: -Infinity, miny: Infinity, maxy: -Infinity };
  const punt = (x, y) => { tel.n++; tel.minx = Math.min(tel.minx, x); tel.maxx = Math.max(tel.maxx, x); tel.miny = Math.min(tel.miny, y); tel.maxy = Math.max(tel.maxy, y); };
  const ctx = new Proxy({
    createImageData: (b, hh) => ({ width: b, height: hh, data: new Uint8ClampedArray(b * hh * 4) }),
    stroke: (a) => { tel.n++; if (a !== undefined) tel.pad++; },
    putImageData: () => { tel.n++; tel.beeld++; },
    drawImage: (bron, ...a) => { tel.n++; tel.blits.push([bron.width, bron.height, ...a]); if (tel.blits.length > 4) tel.blits.shift(); },
    moveTo: punt, lineTo: punt, arc: punt,
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

const W = LAAG_BREEDTE, H = LAAG_HOOGTE;
/** Een laag zoals VormLaag hem opzet (640 × 360, g uit maten()), maar voor een systeem uit deze lijst. */
function maakLaag(sys, { zaad = 7, kwaliteit, knoppen = {}, breedte = W, hoogte = H } = {}) {
  const canvas = maakCanvas(breedte, hoogte);
  const p = Object.fromEntries(sys.knobs.map((k) => [k.k, k.v]));
  Object.assign(p, knoppen);
  const s = { o: {}, e: {} };
  // Zonder de verouderde g.S: een systeem dat hem nog leest, rekent met NaN en valt hieronder op.
  const { S: _verouderd, ...maat } = maten(breedte, hoogte);
  const g = { ctx: canvas.getContext('2d'), ...maat, t: 0, pal: sys.pal, L: LUTS[sys.pal], r: maakRng(zaad), maakCanvas };
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
  ok('ze staan in SYSTEMEN, en geen id komt twee keer voor', SYSTEMEN_MEER.every((s) => SYSTEMEN.includes(s)) && new Set(SYSTEMEN.map((s) => s.id)).size === SYSTEMEN.length);
  ok('elk systeem heeft naam, categorie, palet en knoppen', SYSTEMEN_MEER.every((s) => s.naam && s.cat && LUTS[s.pal] && s.knobs.length));
  ok('draaiknoppen: minstens één, hooguit zes', SYSTEMEN_MEER.every((s) => { const n = draaiKnoppen(s).length; return n >= 1 && n <= 6; }));
  const bron = readFileSync(new URL('../src/vormen/systemen-meer.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('kent geen DOM, geen Path2D, geen eigen klok, geen Math.random', !/\bdocument\b|\bwindow\b|performance\.now|Math\.random|Path2D/.test(bron));
  const imports = [...bron.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  ok('importeert alleen uit ./hulp.js', imports.length === 1 && imports[0] === './hulp.js');
  ok('16:9: noemt g.S niet meer, en geen verouderd rooster(g, getal)', !/\bg\.S\b|\bS\s*=\s*g\.|rooster\(g,\s*[\dN]/.test(bron));
}

console.log('16:9: het hele doek, vierkante cellen, zelfde rekenwerk');
{
  const sys = (id) => SYSTEMEN_MEER.find((x) => x.id === id);
  const donker = (l) => l.g.L[0];
  /** Aandeel roosterpunten in de kolommen [van, tot) (fractie van nx) dat niet de achtergrond is. */
  const licht = (l, van, tot) => {
    const { nx, ny, px } = l.s.g, a = Math.floor(van * nx), b = Math.ceil(tot * nx);
    let n = 0; for (let y = 0; y < ny; y++) for (let x = a; x < b; x++) if (px[y * nx + x] !== donker(l)) n++;
    return n / ((b - a) * ny);
  };
  // De oude maat n × n per systeem: evenveel cellen of minder = hetzelfde werk per cel.
  const OUD = { ch: 256, jl: 180, dl: 200, lg: 320, wv: 150, if: 320 };
  for (const id of ['ch', 'jl', 'dl', 'lg', 'wv']) {
    const l = maakLaag(sys(id));
    for (let i = 0; i < 60; i++) l.stap();
    const { nx, ny, c } = l.s.g, blit = l.canvas.tel.blits.at(-1);
    ok(`${id}: rooster ${nx} × ${ny}, vierkante cellen over het hele doek (${(nx / ny).toFixed(3)} ≈ ${(W / H).toFixed(3)})`,
      !l.s.g.oud && Math.abs(nx / ny / (W / H) - 1) < 0.01);
    ok(`${id}: ${nx * ny} cellen, niet meer dan de oude ${OUD[id]}² (${OUD[id] ** 2})`, nx * ny <= OUD[id] ** 2 * 1.02);
    ok(`${id}: blit over het hele doek (0, 0, ${W}, ${H})`, blit && blit[0] === c.width && blit.slice(2).join(',') === `0,0,${W},${H}`);
  }
  {
    // ch: de plaat is 16:9 met het oude vierkant in het midden, en er ligt zand tot aan beide randen.
    const l = maakLaag(sys('ch'));
    for (let i = 0; i < 180; i++) l.stap();
    let a = Infinity, b = -Infinity;
    for (const x of l.s.x) { a = Math.min(a, x); b = Math.max(b, x); }
    ok(`ch: plaat van ${l.s.x0.toFixed(3)} tot ${(l.s.x0 + l.s.A).toFixed(3)}, het oude 0..1 in het midden, korrels tot aan de randen`,
      Math.abs(l.s.x0 + l.s.A / 2 - 0.5) < 1e-9 && a < l.s.x0 + 0.01 && b > l.s.x0 + l.s.A - 0.01);
    ok(`ch: zand in het linker- en rechtertiende (${(licht(l, 0, 0.1) * 100).toFixed(1)}%, ${(licht(l, 0.9, 1) * 100).toFixed(1)}%)`,
      licht(l, 0, 0.1) > 0.02 && licht(l, 0.9, 1) > 0.02);
  }
  {
    // jl: hetzelfde stuk complex vlak als het oude 3 × 3, en beeld tot aan de randen.
    const l = maakLaag(sys('jl'));
    for (let i = 0; i < 60; i++) l.stap();
    const { nx, ny } = l.s.g;
    ok(`jl: ${nx} × ${ny} cellen van 3/180: 9 eenheden², het oude 3 × 3`, nx * ny === 180 * 180);
    ok(`jl: beeld in het linker- en rechtervijfde (${(licht(l, 0, 0.2) * 100).toFixed(0)}%, ${(licht(l, 0.8, 1) * 100).toFixed(0)}%)`,
      licht(l, 0, 0.2) > 0.3 && licht(l, 0.8, 1) > 0.3);
  }
  {
    // wv: golflengte en bronafstand in de oude eenheid (korte zijde / 150).
    const l = maakLaag(sys('wv'));
    l.stap();
    const { nx, ny } = l.s.g, m = (ny >> 1) * nx + (nx >> 1);
    const af = l.s.d.map((d) => d[m]);
    ok(`wv: bronnen 0,18 × 150 = 27 oude eenheden van het midden (${af.map((a) => a.toFixed(1)).join(', ')})`, af.every((a) => Math.abs(a - 27) < 1.5));
    ok('wv: golven in het linker- en rechtervijfde', licht(l, 0, 0.2) > 0.5 && licht(l, 0.8, 1) > 0.5);
  }
  {
    // lg: de scanlijn loopt over de hele breedte en de hele hoogte.
    const lg = sys('lg'), l = maakLaag(lg);
    l.g.t = 0.95 / (l.p.sp * 0.08);                           // f = 0,95
    lg.step.call(lg, l.s, l.p, l.g);
    const t = l.canvas.tel;
    ok(`lg: scanlijn op 95% van de breedte (x ${t.maxx.toFixed(0)} van ${W}), van 0 tot ${H}`, Math.abs(t.maxx - 0.95 * W) < 1 && t.miny === 0 && t.maxy === H);
    ok('lg: diagram tot in het rechtervijfde', licht(l, 0.8, 1) > 0.05);
  }
  {
    // dl: bodemlijn over de hele breedte; punt groeit tot 0,45 × de breedte, dus voorbij de halve hoogte.
    const dl = sys('dl'), b = maakLaag(dl, { knoppen: { seed: 1 } });
    for (let i = 0; i < 120; i++) b.stap();
    const { nx, ny, px } = b.s.g;
    let links = 0, rechts = 0;
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx; x++) if (px[y * nx + x] !== donker(b)) { if (x < nx / 4) links++; else if (x >= nx * 3 / 4) rechts++; }
    ok(`dl bodemlijn: groeit links én rechts (${links} en ${rechts} cellen boven de bodem)`, links > 20 && rechts > 20);
    const p = maakLaag(dl, { zaad: 3 });
    let n = 0;
    while (!p.s.af && n < 6000) { p.stap(); n++; }
    ok(`dl punt: volgroeid na ${n} stappen (${(n / 60).toFixed(1)} s), straal ${p.s.rmax.toFixed(0)} > 0,45 × ${p.s.nx} en > halve hoogte ${p.s.ny / 2}`,
      p.s.af && p.s.rmax > 0.45 * p.s.nx && p.s.rmax > p.s.ny / 2);
    // De ronde figuur rekent op een kaart van nx × nx (evenveel cellen als het oude 200²) en toont de middelste ny rijen.
    ok(`dl punt: kaart ${p.s.nx} × ${p.s.sh}, beeld rij ${p.s.oy} tot ${p.s.oy + p.s.ny}, midden in beeld`,
      p.s.sh === p.s.nx && p.s.oy === (p.s.nx - p.s.ny) >> 1 && p.s.cy - p.s.oy === p.s.ny >> 1 && p.s.bez.length <= OUD.dl ** 2 * 1.02);
    let dxm = 0, dym = 0;
    for (let y = 0; y < p.s.sh; y++) for (let x = 0; x < p.s.nx; x++) if (p.s.bez[y * p.s.nx + x]) { dxm = Math.max(dxm, Math.abs(x - p.s.cx)); dym = Math.max(dym, Math.abs(y - p.s.cy)); }
    ok(`dl punt: rond (tot ${dxm} cellen opzij, ${dym} op en neer), dus boven en onder buiten beeld (${p.s.ny >> 1})`, dym > (p.s.ny >> 1) + 5 && Math.min(dxm, dym) / Math.max(dxm, dym) > 0.7);
    ok('dl bodemlijn: kaart = beeld', b.s.sh === b.s.ny && b.s.oy === 0);
  }
  {
    // if: bewust een vierkant rooster (320², als vroeger) in het midden, de varen heel.
    const l = maakLaag(sys('if'));
    for (let i = 0; i < 60; i++) l.stap();
    const { nx, ny, px, c } = l.s.g, v = midden(l.g).vak, blit = l.canvas.tel.blits.at(-1);
    ok(`if: vierkant rooster ${nx} × ${ny} (als vroeger), in het midden (${v.x}, ${v.y}, ${v.b}, ${v.h})`,
      nx === OUD.if && ny === OUD.if && blit[0] === c.width && blit.slice(2).join(',') === [v.x, v.y, v.b, v.h].join(','));
    let som = 0, n = 0, boven = ny, onder = 0;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (px[y * nx + x] !== donker(l)) { som += x; n++; boven = Math.min(boven, y); onder = Math.max(onder, y); }
    ok(`if: varen in het midden (zwaartepunt x ${(som / n / nx).toFixed(2)}) en heel (rij ${boven} tot ${onder} van ${ny})`,
      Math.abs(som / n / nx - 0.5) < 0.1 && boven > 0 && onder < ny - 1);
  }
  {
    // ls: elke vorm past in het 16:9-vak, staat in het midden en raakt 88% van een zijde.
    const ls = sys('ls');
    for (let f = 0; f < ls.DEF.length; f++) {
      const l = maakLaag(ls, { knoppen: { f, ...ls.knobs[0].on(f) } });   // met hoek en iteraties van die vorm, zoals de keuzelijst ze zet
      l.stap();
      const t = l.canvas.tel, b = t.maxx - t.minx, h = t.maxy - t.miny;
      const past = t.minx >= 0 && t.maxx <= W && t.miny >= 0 && t.maxy <= H;
      const vult = Math.abs(b - 0.88 * W) < 1 || Math.abs(h - 0.88 * H) < 1;
      const mid = Math.abs((t.minx + t.maxx) / 2 - W / 2) < 1 && Math.abs((t.miny + t.maxy) / 2 - H / 2) < 1;
      ok(`ls ${ls.knobs[0].opts[f]}: ${b.toFixed(0)} × ${h.toFixed(0)} px, past in ${W} × ${H}, raakt 88% van een zijde, in het midden`, past && vult && mid);
    }
    const koch = maakLaag(ls, { knoppen: { f: 2, ...ls.knobs[0].on(2) } });
    koch.stap();
    ok('ls Koch-vlok: breder dan het oude vierkant (de breedte wordt gebruikt)', koch.canvas.tel.maxx - koch.canvas.tel.minx > H);
    // Lijndikte t.o.v. de vorm: op 640 × 360 precies 360/512 van die op het oude vierkant van 512
    // (daar is de nieuwe formule gelijk aan het origineel). Voor elke vorm, ook waar hij klemt.
    const dik = ls.DEF.map((_, f) => {
      const [a, b] = [[W, H], [512, 512]].map(([breedte, hoogte]) => { const l = maakLaag(ls, { knoppen: { f, ...ls.knobs[0].on(f) }, breedte, hoogte }); l.stap(); return l.g.ctx.lineWidth; });
      return a / b;
    });
    ok(`ls: lijnen even dik t.o.v. de vorm als op het oude vierkant (${dik.map((d) => d.toFixed(3)).join(', ')} = ${(H / 512).toFixed(3)})`, dik.every((d) => Math.abs(d - H / 512) < 1e-9));
  }
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
