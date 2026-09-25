/**
 * De middelzware Vormmachines (spoor B2): ch, jl, ls, dl, lg, wv, if.
 * Uit Clay's `vormmachines.html`, onder dezelfde regels als systemen.js:
 * geen DOM, geen Math.random (toeval uit `g.r()`), geen eigen klok (`g.t`,
 * seconden van de audioklok), één `step()` = 1/60 s, tekenen op `g.ctx`.
 *
 * 16:9 (ROADMAP 7, API bovenaan hulp.js): het doek is g.W × g.H, lijnen en
 * stippen in g.D. Roosters zijn nx × ny met vierkante cellen uit
 * `cellen(g, n)`: evenveel cellen als het oude n × n, dus dezelfde rekentijd.
 * Nergens uitgerekt: een cirkel blijft rond. Bij ch, wv, ls en if staat wat
 * vroeger op het vierkant stond nu HEEL in de hoogte en laat de breedte meer
 * van dezelfde wereld zien; jl en dl vullen de breedte en snijden daarvoor
 * boven en onder iets af (zoals het beeld van 24 sep). Per systeem:
 *   ch  de plaat is 16:9: y 0..1, x over nx/ny plaatbreedtes, het oude
 *       vierkant in het midden. Zelfde golflengtes, zelfde korrels.
 *   jl  hetzelfde stuk van het complexe vlak als het oude 3 × 3 (9 eenheden²),
 *       nu 4 × 2,25: de verzameling vult de breedte (een hoge vorm valt boven
 *       en onder iets weg; uitzoomen met de zoomknop).
 *   ls  de figuur past in het hele 16:9-vak, in het midden. Alle vijf vormen
 *       zijn smaller dan 16:9: ze worden even hoog als vroeger (88%), de
 *       Koch-vlok (breder dan hoog) 15% groter. Links en rechts achtergrond.
 *   dl  het beeld heeft de celmaat van 24 sep (cellen(g, 150), 201 × 113).
 *       Punt: de ronde figuur groeit tot 0,45 × de BREEDTE en steekt boven en
 *       onder buiten beeld (zoals het bijgesneden beeld van 24 sep); hij rekent
 *       daarvoor op een kaart van 201 × 201. Bodemlijn: over de hele breedte.
 *   lg  r loopt over de hele breedte (meer kolommen), x over de hoogte.
 *   wv  golflengte en bronafstand in de oude eenheid (korte zijde / 150): het
 *       oude beeld in het midden, de golven lopen door tot de randen.
 *   if  een varen is een staande figuur: bewust een VIERKANT rooster (320²,
 *       als vroeger) in het midden (`midden(g).vak`); links en rechts achtergrond.
 *
 * KWALITEIT: `g.kwaliteit` (0,25..1, ontbreekt = 1). Een scheduler zet hem
 * lager als een laag over zijn tijdsbudget gaat. Het beeld wordt grover
 * (minder korrels, grotere blokken, minder punten), de beweging blijft even
 * snel: tijd hangt nooit aan de hoeveelheid werk. ch: minder korrels (de rest
 * ligt stil), jl en wv: blokken van 2×2, if: minder punten per stap (elk punt
 * telt dan zwaarder, dus even helder). dl NIET: minder zwerfstappen zou de
 * groei vertragen, en dat is de beweging (hij kost ~1 ms); ls en lg hebben
 * geen zware lus.
 *
 * Wat anders is dan het origineel, verder dan de drie regels:
 *   - ls maakt per stap geen strings en geen Path2D meer (het origineel: 8×
 *     `new Path2D` en een `for..of` over een string, ~0,7 MB per beeld). Het
 *     woord wordt in init één keer vertaald naar opcodes, de lijnstukken
 *     staan in een vooraf gemaakte Float32Array, gegroepeerd per diepte, en
 *     het wandelen gebeurt één keer per stap in plaats van twee.
 *   - wv rekent cos(k·d − w) als cos(k·d)·cos w + sin(k·d)·sin w: twee tabellen
 *     die alleen veranderen als de golflengte verandert. Tijdens het draaien
 *     aan de golflengte rekent hij zoals het origineel (tabellen bouwen zou
 *     dubbel zo duur zijn); staat de knop 8 stappen stil, dan de tabellen.
 *   - if doet verval, maximum en kleuren in één doorgang, en de macht 0,6 uit
 *     een tabel.
 *   - dl: de bezettingskaart heet `bez` (in het origineel `s.o`, dat botste met
 *     de uitgangen), zwervers zonder arrays per stap, opnieuw beginnen zonder
 *     nieuwe buffers.
 *   - lg zonder het tekstje "r = …" (net als km in systemen.js).
 *   - jl en wv zonder slepen met de muis (een laag heeft geen muis).
 *
 * Uitgangen (`s.o.<naam>`, 0..1) en gebeurtenissen (`s.e.<naam>`) zoals in
 * OUTS van het origineel, berekend aan het eind van elke stap. `outs` volgt
 * het formaat van het origineel: ['naam', 'e'] = gebeurtenis.
 */

import { PI, TAU, pcol, rooster, cellen, blit, clear, midden, K, SEL } from './hulp.js';

const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : (v || 0));
/** Schaal naar het grootste wat hij ooit zag (langzaam vergetend), zoals `auto` in het origineel. */
function auto(s, k, v) {
  const m = s._m || (s._m = {});
  const mx = Math.max(v, (m[k] || 1e-9) * 0.997);
  m[k] = mx;
  return mx > 0 ? cl01(v / mx) : 0;
}
/** g.kwaliteit, geklemd op 0,25..1; ontbreekt hij (of is hij onzin), dan 1. */
const kw = (g) => { const q = g.kwaliteit; return q > 0 ? (q < 0.25 ? 0.25 : q > 1 ? 1 : q) : 1; };
/** Blokgrootte voor pixelsystemen: 1 bij volle kwaliteit, 2 bij een kwart. */
const blok = (q) => Math.max(1, Math.min(3, Math.round(1 / Math.sqrt(q))));
/** Vul een blok van b×b vanaf (X, Y) in een rooster van nx × ny. */
function vulBlok(px, nx, ny, X, Y, b, kleur) {
  const yb = Math.min(b, ny - Y), xb = Math.min(b, nx - X);
  for (let yy = 0; yy < yb; yy++) { const r = (Y + yy) * nx + X; for (let xx = 0; xx < xb; xx++) px[r + xx] = kleur; }
}

export const SYSTEMEN_MEER = [

  { id: 'ch', naam: 'Chladni-figuren', sub: 'cymatica · trillende plaat', cat: 'Golven', pal: 'gloed',
    knobs: [K('n', 'modus n', 1, 14, 1, 3, { rnd: [1, 10] }), K('m', 'modus m', 1, 14, 1, 5, { rnd: [1, 12] }), K('amp', 'trilling', 0.3, 6, 0.1, 2.5, { fix: 1 }),
      K('cnt', 'zandkorrels', 2000, 16000, 500, 9000, { re: 1, fix: 1 })],
    outs: ['beweging', 'orde'],
    // De plaat is 16:9: y loopt van 0 tot 1 (de hoogte), x over A = nx/ny
    // plaatbreedtes, van x0 tot x0 + A, zodat het oude vierkant 0..1 in het
    // midden ligt. Het veld is dezelfde formule, dus dezelfde golflengtes; het
    // loopt gewoon door naar links en rechts. Korrels en cellen even veel als
    // vroeger: even helder, even duur.
    init(s, p, g) {
      const n = p.cnt | 0; s.n = n; s.x = new Float32Array(n); s.y = new Float32Array(n);
      s.g = rooster(g, cellen(g, 256)); s.c = new Uint16Array(s.g.nx * s.g.ny);
      s.A = s.g.nx / s.g.ny; s.x0 = (1 - s.A) / 2;
      for (let i = 0; i < n; i++) { s.x[i] = s.x0 + g.r() * s.A; s.y[i] = g.r(); }
    },
    step(s, p, g) {
      // Bij lagere kwaliteit bewegen alleen de eerste korrels; de rest ligt stil en telt niet.
      const q = kw(g), na = Math.max(1, Math.ceil(s.n * q));
      const n = p.n, m = p.m, amp = p.amp * 0.012, nx = s.g.nx, ny = s.g.ny, x0 = s.x0, x1 = s.x0 + s.A;
      const c = s.c, r = g.r, gelijk = n === m, X = s.x, Y = s.y;
      c.fill(0);
      let sf = 0, orde = 0;
      for (let i = 0; i < na; i++) {
        let x = X[i], y = Y[i];
        const a = Math.cos(n * PI * x) * Math.cos(m * PI * y), b = Math.cos(m * PI * x) * Math.cos(n * PI * y), af = Math.abs(gelijk ? a : a - b), f = af * amp + 0.0006;
        sf += af; if (af < 0.08) orde++;
        x += (r() - 0.5) * f; y += (r() - 0.5) * f;
        if (x < x0) x = 2 * x0 - x; if (x > x1) x = 2 * x1 - x; if (y < 0) y = -y; if (y > 1) y = 2 - y;
        X[i] = x; Y[i] = y; c[Math.min(ny - 1, y * ny | 0) * nx + Math.min(nx - 1, (x - x0) * ny | 0)]++;
      }
      const px = s.g.px, L = g.L, h = 70 / q;   // minder korrels, elk telt zwaarder: even helder
      for (let i = 0; i < c.length; i++) px[i] = L[Math.min(255, c[i] * h) | 0];
      blit(s.g, g);
      s.o.beweging = cl01(sf / na / 1.2 * p.amp / 2.5); s.o.orde = orde / na;
    } },

  { id: 'jl', naam: 'Julia-verzameling', sub: 'complexe dynamica', cat: 'Wiskunde', pal: 'iris',
    knobs: [K('r', 'straal van c', 0.3, 1.1, 0.001, 0.7885, { rnd: [0.62, 0.82] }), K('sp', 'snelheid', 0, 1, 0.01, 0.25, { fix: 1 }),
      K('it', 'iteraties', 20, 160, 1, 70, { fix: 1 }), K('z', 'zoom', 0.6, 3, 0.01, 1, { fix: 1 })],
    outs: ['re', 'im', 'binnen'],
    // Het beeld beslaat evenveel van het complexe vlak als het oude vierkant
    // van 3 × 3 (bij zoom 1): 4 × 2,25. Eén cel is even groot als vroeger.
    init(s, p, g) { s.g = rooster(g, cellen(g, 180)); s.th = 0; },
    step(s, p, g) {
      const nx = s.g.nx, ny = s.g.ny, px = s.g.px, L = g.L, mi = p.it | 0, b = blok(kw(g));
      s.th += p.sp * 0.008;
      const cr = p.r * Math.cos(s.th), ci = p.r * Math.sin(s.th), sc = 3 / (Math.sqrt(nx * ny) * p.z), L0 = L[0];
      for (let Y = 0; Y < ny; Y += b) for (let X = 0; X < nx; X += b) {
        let zx = (X - nx / 2) * sc, zy = (Y - ny / 2) * sc, i = 0, m = 0;
        for (; i < mi; i++) { const xx = zx * zx, yy = zy * zy; m = xx + yy; if (m > 16) break; zy = 2 * zx * zy + ci; zx = xx - yy + cr; }
        const kleur = i >= mi ? L0 : L[Math.min(255, (Math.sqrt((i + 1 - Math.log2(Math.log2(m) + 1e-9)) / mi) * 255) | 0)];
        if (b === 1) px[Y * nx + X] = kleur; else vulBlok(px, nx, ny, X, Y, b, kleur);
      }
      blit(s.g, g);
      s.o.re = cl01(0.5 + cr / 2.4); s.o.im = cl01(0.5 + ci / 2.4);
      let c = 0, t = 0;
      for (let i = 0; i < px.length; i += 7) { t++; if (px[i] === L0) c++; }
      s.o.binnen = auto(s, 'b', c / t);
    } },

  { id: 'ls', naam: 'L-systeem', sub: 'Lindenmayer · herschrijfregels', cat: 'Groei', pal: 'mos',
    knobs: [SEL('f', 'vorm', ['Plant', 'Struik', 'Koch-vlok', 'Draak', 'Sierpiński'], 0, { re: 1, on: (i) => ({ ang: [25, 22.5, 60, 90, 120][i], it: [5, 4, 4, 11, 6][i] }) }),
      K('it', 'iteraties', 1, 12, 1, 5, { re: 1, fix: 1 }), K('ang', 'hoek °', 5, 130, 0.5, 25), K('wind', 'wind', 0, 12, 0.1, 3, { fix: 1 })],
    outs: ['zwaai', 'lengte', 'hoek'],
    DEF: [['X', { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, 6], ['F', { F: 'FF+[+F-F-F]-[-F+F+F]' }, 4], ['F--F--F', { F: 'F+F--F+F' }, 5],
      ['FX', { X: 'X+YF+', Y: '-FX-Y' }, 13], ['F-G-G', { F: 'F-G+F+G-F', G: 'GG' }, 7]],
    // Het woord wordt hier één keer gemaakt en vertaald naar opcodes:
    // 1 = lijn (F/G), 2 = +, 3 = −, 4 = [, 5 = ]. Andere letters doen niets.
    init(s, p) {
      const [ax, ru, max] = this.DEF[p.f | 0];
      let str = ax;
      const it = Math.min(p.it | 0, max);
      for (let i = 0; i < it; i++) { let o = ''; for (const ch of str) o += ru[ch] ?? ch; str = o; }
      const len = str.length, code = new Uint8Array(len);
      let nSeg = 0, dep = 0, maxDep = 0;
      const perDiepte = new Uint32Array(8);
      for (let i = 0; i < len; i++) {
        const ch = str[i];
        if (ch === 'F' || ch === 'G') { code[i] = 1; nSeg++; perDiepte[Math.min(7, dep)]++; }
        else if (ch === '+') code[i] = 2;
        else if (ch === '-') code[i] = 3;
        else if (ch === '[') { code[i] = 4; dep++; if (dep > maxDep) maxDep = dep; }
        else if (ch === ']') { code[i] = 5; dep--; }
      }
      // Elk lijnstuk krijgt vooraf zijn plek, gegroepeerd per diepte (de kleur):
      // dan tekent elke kleur één aaneengesloten stuk van de array.
      const begin = new Uint32Array(9);
      for (let d = 0; d < 8; d++) begin[d + 1] = begin[d] + perDiepte[d];
      const plek = new Uint32Array(nSeg), vol = begin.slice(0, 8);
      dep = 0;
      for (let i = 0, k = 0; i < len; i++) {
        const c = code[i];
        if (c === 1) plek[k++] = vol[Math.min(7, dep)]++;
        else if (c === 4) dep++;
        else if (c === 5) dep--;
      }
      s.len = len; s.code = code; s.nSeg = nSeg; s.plek = plek; s.begin = begin;
      s.seg = new Float32Array(nSeg * 4);
      s.stX = new Float64Array(maxDep + 1); s.stY = new Float64Array(maxDep + 1); s.stH = new Float64Array(maxDep + 1);
      s.hoek = new Float64Array(maxDep + 1); s.maxDep = maxDep;
    },
    step(s, p, g) {
      clear(g);
      const W = g.W, H = g.H, t = g.t, base = p.ang * PI / 180, w = p.wind * PI / 180, A = s.hoek, code = s.code, seg = s.seg, plek = s.plek;
      for (let d = 0; d <= s.maxDep; d++) A[d] = base + Math.sin(t * 1.1 + d * 0.6) * w;   // hoek per diepte, zoals het origineel per teken
      let x = 0, y = 0, h = -PI / 2, dep = 0, k = 0, minx = 0, maxx = 0, miny = 0, maxy = 0;
      for (let i = 0; i < s.len; i++) {
        const c = code[i];
        if (c === 1) {
          const nx = x + Math.cos(h), ny = y + Math.sin(h), o = plek[k++] * 4;
          seg[o] = x; seg[o + 1] = y; seg[o + 2] = nx; seg[o + 3] = ny;
          x = nx; y = ny;
          if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        } else if (c === 2) h += A[dep];
        else if (c === 3) h -= A[dep];
        else if (c === 4) { s.stX[dep] = x; s.stY[dep] = y; s.stH[dep] = h; dep++; }
        else if (c === 5) { dep--; x = s.stX[dep]; y = s.stY[dep]; h = s.stH[dep]; }
      }
      // Passend in het hele 16:9-vak (88%), in het midden. Een vorm die smaller
      // is dan 16:9 (alle vijf) wordt 88% van de hoogte, zoals op het vierkant.
      const kk = 0.88 * Math.min(W / Math.max(maxx - minx, 1e-6), H / Math.max(maxy - miny, 1e-6));
      const ox = W / 2 - (minx + maxx) / 2 * kk, oy = H / 2 - (miny + maxy) / 2 * kk;
      const ctx = g.ctx;
      // Lijndikte als het origineel (kk × 0,35 geklemd, maal D), maar kk in 320-eenheden
      // (kk / D × 0,56, want 0,56 = 0,35 × de oude D van 1,6): anders telde de maat
      // van het doek twee keer mee en werden de lijnen op 360 px 30% dunner t.o.v. de vorm.
      ctx.lineWidth = Math.max(0.6, Math.min(1.6, kk / g.D * 0.56)) * g.D / (g.D > 1 ? 1.4 : 1); ctx.lineCap = 'round';
      for (let d = 0; d < 8; d++) {
        const van = s.begin[d], tot = s.begin[d + 1];
        if (van === tot) continue;
        ctx.beginPath();
        for (let j = van; j < tot; j++) { const o = j * 4; ctx.moveTo(ox + seg[o] * kk, oy + seg[o + 1] * kk); ctx.lineTo(ox + seg[o + 2] * kk, oy + seg[o + 3] * kk); }
        ctx.strokeStyle = pcol(g.pal, 0.4 + d * 0.085); ctx.stroke();
      }
      s.o.zwaai = 0.5 + 0.5 * Math.sin(t * 1.1); s.o.lengte = cl01(Math.log10(s.len) / 5.5); s.o.hoek = cl01((p.ang - 5) / 125);
    } },

  { id: 'dl', naam: 'Diffusie-aggregatie', sub: 'DLA · groeiende fractals', cat: 'Groei', pal: 'fosfor',
    knobs: [K('st', 'plakkans', 0.03, 1, 0.01, 1, { rnd: [0.1, 1] }), K('wind', 'wind naar zaad', 0, 0.5, 0.01, 0.05, { rnd: [0, 0.35] }),
      SEL('seed', 'zaad', ['Punt', 'Bodemlijn'], 0, { re: 1 })],
    outs: [['plak', 'e'], 'straal', 'groei'],
    // Het beeld is een rooster met de celmaat van 24 sep (cellen(g, 150):
    // 201 × 113, een cel = 1/113 van de hoogte), dus dezelfde korrel en, bij
    // 50000 zwerfstappen per stap, dezelfde groeisnelheid op het scherm.
    // Punt: een DLA-figuur is rond. Hij groeit, als vroeger, tot 0,45 × de
    // BREEDTE (90 cellen) en steekt dus boven en onder buiten beeld, precies
    // zoals het bijgesneden beeld van 24 sep. Daarvoor rekent hij op een
    // bezettingskaart van nx × nx (evenveel cellen als het oude 200²) en toont
    // hij de middelste ny rijen (vanaf rij oy). Met de kaart even hoog als het
    // beeld groeide er een X: zwervers die boven en onder stierven, voedden
    // die armen niet meer.
    // Bodemlijn: kaart = beeld, over de hele breedte, tot 8% onder de bovenkant.
    init(s, p, g) {
      s.g = rooster(g, cellen(g, 150)); s.nx = s.g.nx; s.ny = s.g.ny;
      s.sh = p.seed == 0 ? s.nx : s.ny; s.oy = (s.sh - s.ny) >> 1;   // hoogte van de kaart, en de eerste rij in beeld
      s.bez = new Uint8Array(s.nx * s.sh); s.cx = s.nx >> 1; s.cy = s.sh >> 1; s.nst = 0;
      this.opnieuw(s, p, g);
    },
    /** Leeg beginnen zonder nieuwe buffers: na een volgroeide figuur, en in init. */
    opnieuw(s, p, g) {
      const nx = s.nx, sh = s.sh, px = s.g.px, L = g.L;
      s.bez.fill(0); px.fill(L[0]); s.rmax = 2; s.top = sh - 1; s.af = false; s.afOp = 0; s.wx = -1; s.wy = -1;
      if (p.seed == 0) { s.bez[s.cy * nx + s.cx] = 1; px[(s.cy - s.oy) * nx + s.cx] = L[255]; }
      else for (let x = 0; x < nx; x++) { s.bez[(sh - 1) * nx + x] = 1; px[(sh - 1) * nx + x] = L[255]; }
    },
    /** Een nieuwe zwerver, in s.wx/s.wy (het origineel gaf een array terug). */
    zwerver(s, p, g) {
      if (p.seed == 0) { const a = g.r() * TAU, r = s.rmax + 6; s.wx = Math.round(s.cx + Math.cos(a) * r); s.wy = Math.round(s.cy + Math.sin(a) * r); }
      else { s.wx = g.r() * s.nx | 0; s.wy = Math.max(1, s.top - 6); }
    },
    step(s, p, g) {
      const nx = s.nx, sh = s.sh, oy = s.oy, ny = s.ny, o = s.bez, px = s.g.px, L = g.L, pt = p.seed == 0, r = g.r, cx = s.cx, cy = s.cy, rEind = nx * 0.45;
      if (s.af) {
        // Twee seconden laten staan; loopt de klok terug (nieuwe AudioContext), dan ook opnieuw.
        if (g.t - s.afOp > 2 || g.t < s.afOp) this.opnieuw(s, p, g);
        blit(s.g, g, true); this.uit(s, p); return;
      }
      if (s.wx < 0) this.zwerver(s, p, g);
      let x = s.wx, y = s.wy;
      for (let k = 0; k < 50000; k++) {
        if (r() < p.wind) { if (pt) { const dx = cx - x, dy = cy - y; if (Math.abs(dx) > Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy); } else y++; }
        else { const d = r() * 4 | 0; if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else y--; }
        if (!pt) x = (x + nx) % nx;
        if (x < 1 || x > nx - 2 || y < 1 || y > sh - 2) { this.zwerver(s, p, g); x = s.wx; y = s.wy; continue; }
        if (pt) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy > (s.rmax + 22) ** 2) { this.zwerver(s, p, g); x = s.wx; y = s.wy; continue; } }
        const i = y * nx + x;
        if ((o[i - 1] | o[i + 1] | o[i - nx] | o[i + nx]) && r() < p.st) {
          o[i] = 1; s.nst++;
          const zicht = y >= oy && y < oy + ny, j = (y - oy) * nx + x;   // de kaart kan hoger zijn dan het beeld
          if (pt) { const rr = Math.hypot(x - cx, y - cy); if (rr > s.rmax) s.rmax = rr; if (zicht) px[j] = L[Math.min(255, 60 + (rr / rEind) * 195 | 0)]; if (s.rmax > rEind) { s.af = true; s.afOp = g.t; break; } }
          else { if (y < s.top) s.top = y; px[j] = L[Math.min(255, 60 + ((sh - y) / sh) * 195 | 0)]; if (s.top < sh * 0.08) { s.af = true; s.afOp = g.t; break; } }
          this.zwerver(s, p, g); x = s.wx; y = s.wy;
        }
      }
      s.wx = x; s.wy = y;
      blit(s.g, g, true);
      this.uit(s, p);
    },
    uit(s, p) {
      const n = s.nst; if (n) s.e.plak = 1;
      s.o.groei = auto(s, 'g', n); s.nst = 0;
      s.o.straal = p.seed == 0 ? cl01(s.rmax / (s.nx * 0.45)) : cl01((s.sh - s.top) / (s.sh * 0.92));
    } },

  { id: 'lg', naam: 'Logistieke afbeelding', sub: 'bifurcatie · de weg naar chaos', cat: 'Chaos', pal: 'fosfor',
    knobs: [K('r0', 'r van', 2.4, 3.99, 0.001, 2.8, { re: 1, rnd: [2.8, 3.8] }), K('r1', 'r tot', 2.5, 4, 0.001, 4, { re: 1, rnd: [3.6, 4] }),
      K('sp', 'scansnelheid', 0, 1, 0.01, 0.3, { fix: 1 })],
    outs: ['r', 'baan', ['stap', 'e']],
    // Een grafiek: r loopt over de hele breedte (nx kolommen, meer dan de oude
    // 320), x over de hoogte (ny rijen). Per kolom 260 punten zoals vroeger;
    // over minder rijen verdeeld is een chaotisch stuk iets voller.
    init(s, p, g) {
      let r0 = p.r0, r1 = p.r1; if (r1 <= r0) r1 = Math.min(4, r0 + 0.01);
      s.r0 = r0; s.r1 = r1; s.g = rooster(g, cellen(g, 320));
      const nx = s.g.nx, ny = s.g.ny, h = new Float32Array(nx * ny);
      for (let c = 0; c < nx; c++) {
        const r = r0 + (r1 - r0) * c / (nx - 1); let x = 0.5;
        for (let i = 0; i < 300; i++) x = r * x * (1 - x);
        for (let i = 0; i < 260; i++) { x = r * x * (1 - x); h[Math.min(ny - 1, ((1 - x) * (ny - 1)) | 0) * nx + c]++; }
      }
      for (let i = 0; i < h.length; i++) s.g.px[i] = g.L[Math.min(255, h[i] ? 60 + Math.log(1 + h[i]) * 38 : 0) | 0];
      s.fc = 0; s.lx = 0.37;
    },
    step(s, p, g) {
      blit(s.g, g);
      const ctx = g.ctx, W = g.W, H = g.H, D = g.D, f = (g.t * p.sp * 0.08) % 1, r = s.r0 + (s.r1 - s.r0) * f, X = f * W;
      ctx.strokeStyle = 'rgba(238,161,60,.5)'; ctx.lineWidth = D; ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, H); ctx.stroke();
      let x = 0.5; for (let i = 0; i < 400; i++) x = r * x * (1 - x);
      ctx.fillStyle = '#eea13c';
      for (let i = 0; i < 64; i++) { x = r * x * (1 - x); ctx.beginPath(); ctx.arc(X, (1 - x) * H, 2.6 * D, 0, TAU); ctx.fill(); }
      s.o.r = cl01((r - 2.4) / 1.6); s.fc++;
      if (s.fc % 8 === 0) { let lx = s.lx; if (!(lx > 0 && lx < 1)) lx = 0.37; lx = r * lx * (1 - lx); s.lx = lx; s.o.baan = lx; s.e.stap = 1; }
    } },

  { id: 'wv', naam: 'Golfinterferentie', sub: 'rimpels die elkaar kruisen', cat: 'Golven', pal: 'fosfor',
    knobs: [K('n', 'bronnen', 1, 9, 1, 3, { re: 1 }), K('wl', 'golflengte', 3, 40, 0.5, 12), K('sp', 'snelheid', 0, 4, 0.05, 1.4, { fix: 1 }),
      K('rad', 'bronafstand', 0, 0.45, 0.005, 0.18, { re: 1 })],
    outs: ['midden', ['golftop', 'e']],
    RUST: 8,   // zoveel stappen moet de golflengte stilstaan voor de tabellen gebouwd worden
    // Golflengte en bronafstand blijven in de oude eenheid: 1/150 van de
    // korte zijde (de golflengte-knop "3..40" betekent dus hetzelfde). Het
    // oude vierkant staat in het midden, de golven lopen door tot de randen.
    // De afstanden in s.d staan in die eenheid; het rooster is cellen(g, 150).
    init(s, p, g) {
      s.g = rooster(g, cellen(g, 150)); s.d = [];
      const nx = s.g.nx, ny = s.g.ny, per = 150 / ny;   // oude eenheden per cel
      for (let j = 0; j < p.n; j++) {
        const a = j / p.n * TAU, sx = nx / 2 + Math.cos(a) * p.rad * ny, sy = ny / 2 + Math.sin(a) * p.rad * ny, d = new Float32Array(nx * ny);
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) d[y * nx + x] = Math.hypot(x - sx, y - sy) * per;
        s.d.push(d);
      }
      s.C = new Float32Array(nx * ny); s.Sn = new Float32Array(nx * ny); s.k = NaN; s.rust = 0;
      // Kleur uit een tabel over v ∈ [-1, 1]: het origineel rekende per pixel (v/2 + ½)^1,6.
      const L = g.L; s.kleur = new Uint32Array(2049);
      for (let j = 0; j <= 2048; j++) { const v = j / 1024 - 1; s.kleur[j] = L[Math.min(255, ((v * 0.5 + 0.5) ** 1.6 * 255) | 0)]; }
    },
    step(s, p, g) {
      const nx = s.g.nx, ny = s.g.ny, k = TAU / p.wl, w = g.t * p.sp * 3, n = s.d.length, px = s.g.px, kl = s.kleur, b = blok(kw(g)), inv = 1 / n;
      if (k !== s.k) { s.k = k; s.rust = 0; }
      if (s.rust < this.RUST && ++s.rust === this.RUST) {
        const C = s.C, Sn = s.Sn, nn = nx * ny; C.fill(0); Sn.fill(0);
        for (let j = 0; j < n; j++) { const d = s.d[j]; for (let i = 0; i < nn; i++) { const a = k * d[i]; C[i] += Math.cos(a); Sn[i] += Math.sin(a); } }
      }
      const tabel = s.rust >= this.RUST, cw = Math.cos(w) * inv, sw = Math.sin(w) * inv;
      for (let Y = 0; Y < ny; Y += b) for (let X = 0; X < nx; X += b) {
        const i = Y * nx + X;
        let v;
        if (tabel) v = s.C[i] * cw + s.Sn[i] * sw;
        else { v = 0; for (let j = 0; j < n; j++) v += Math.cos(k * s.d[j][i] - w); v *= inv; }
        const kleur = kl[((v + 1) * 1024 + 0.5) | 0];
        if (b === 1) px[i] = kleur; else vulBlok(px, nx, ny, X, Y, b, kleur);
      }
      blit(s.g, g);
      const m = (ny >> 1) * nx + (nx >> 1);
      let v = 0; for (let j = 0; j < n; j++) v += Math.cos(k * s.d[j][m] - w);
      v = 0.5 + 0.5 * v / n;
      if (v > 0.85 && (s.pv ?? 1) <= 0.85) s.e.golftop = 1;
      s.pv = v; s.o.midden = v;
    } },

  { id: 'if', naam: 'IFS-varen', sub: 'Barnsley · iterated function system', cat: 'Groei', pal: 'mos',
    knobs: [K('k', 'kromming', -0.12, 0.12, 0.001, 0.04), K('bl', 'bladgrootte', 0.4, 1.4, 0.01, 1), K('st', 'stengel', 0.7, 0.9, 0.001, 0.85),
      K('wind', 'wind', 0, 1, 0.01, 0.4, { fix: 1 })],
    outs: ['wind', 'kromming'],
    // Een varen is een staande figuur: hij krijgt BEWUST een vierkant rooster
    // van 320 × 320 (zelfde cellen en rekentijd als vroeger), heel in de
    // hoogte en in het midden van het doek (`midden(g).vak`). Links en rechts
    // is achtergrond; een bredere varen zou uitrekken zijn.
    init(s, p, g) {
      const N = 320; s.N = N; s.g = rooster(g, { nx: N, ny: N }); s.vak = midden(g).vak;
      s.h = new Float32Array(N * N); s.x = 0; s.y = 0; s.m = 0;
      clear(g);   // de randen naast het vak tekent hij nooit: die staan vanaf hier op de achtergrond
      // (log(1+h)/log(1+max))^0,6 uit een tabel van 4096 stappen.
      const L = g.L; s.kleur = new Uint32Array(4097);
      for (let j = 0; j <= 4096; j++) s.kleur[j] = L[Math.min(255, (Math.pow(j / 4096, 0.6) * 255) | 0)];
    },
    step(s, p, g) {
      const N = s.N, h = s.h, k = p.k + Math.sin(g.t * 1.3) * p.wind * 0.03, b = p.bl, st = p.st, r = g.r;
      // Minder punten bij lagere kwaliteit; elk punt telt dan 1/q, zodat het beeld even helder blijft.
      const q = kw(g), iter = Math.round(60000 * q), tel = 1 / q;
      const ymax = 1.6 / (1 - st) * 0.98 + 0.4, sc = N * 0.9 / ymax;
      // h is al vervallen (aan het eind van de vorige stap); s.m is daar het maximum van.
      let x = s.x, y = s.y, m = s.m;
      for (let i = 0; i < iter; i++) {
        const rr = r(); let nx, ny;
        if (rr < 0.01) { nx = 0; ny = 0.16 * y; }
        else if (rr < 0.86) { nx = st * x + k * y; ny = -k * x + st * y + 1.6; }
        else if (rr < 0.93) { nx = b * (0.2 * x - 0.26 * y); ny = b * (0.23 * x + 0.22 * y) + 1.6; }
        else { nx = b * (-0.15 * x + 0.28 * y); ny = b * (0.26 * x + 0.24 * y) + 0.44; }
        x = nx; y = ny;
        const X = (N / 2 + x * sc) | 0, Y = (N * 0.97 - y * sc) | 0;
        if (X >= 0 && X < N && Y >= 0 && Y < N) { const v = (h[Y * N + X] += tel); if (v > m) m = v; }
      }
      s.x = x; s.y = y;
      if (m < 1) m = 1;
      // Eén doorgang: kleuren, dan vervallen (×0,78, in het origineel aan het begin van de stap) en het nieuwe maximum.
      const lm = 4096 / Math.log(1 + m), px = s.g.px, kl = s.kleur, L0 = g.L[0];
      let md = 0;
      for (let i = 0; i < h.length; i++) {
        const v = h[i];
        if (v > 0.05) { px[i] = kl[(Math.log(1 + v) * lm) | 0]; const dv = v * 0.78; h[i] = dv; if (dv > md) md = dv; }
        else { px[i] = L0; h[i] = v * 0.78; }
      }
      s.m = md;
      blit(s.g, g, false, s.vak);
      s.o.wind = 0.5 + 0.5 * Math.sin(g.t * 1.3); s.o.kromming = cl01((p.k + 0.12) / 0.24);
    } },
];
