/**
 * De Vormmachines: kleine wetenschappelijke systemen die bewegende vormen
 * maken. Overgenomen uit Clay's `vormmachines.html` (artifact "Vormmachines",
 * 23 september 2026); de rekenregels zijn dezelfde, drie dingen zijn anders:
 *
 *   1. Geen DOM. Een systeem tekent op `g.ctx` (een 2D-context) en maakt
 *      pixelroosters via `g.maakCanvas`. Zo kan het straks in een Worker op
 *      een OffscreenCanvas draaien, en in de tests op een nep-context.
 *   2. Geen Math.random. Toeval komt uit `g.r()`, een generator met een
 *      zaadje. Zelfde zaadje = zelfde beeld: nodig voor replay en tests.
 *   3. Geen eigen klok. `g.t` (seconden) komt van buiten, van de audioklok
 *      (regel 3). Eén `step()` is één stap van 1/60 s; laag.js roept hem
 *      zo vaak aan als de tijd vraagt.
 *
 * Kleine opruimingen: allocaties per frame zijn naar `init` verhuisd (ec, sf,
 * km), fl tekent zonder Path2D, km zonder tekstje.
 *
 * 16:9 (ROADMAP 7, docs/VORMEN-16x9.md): elk systeem tekent op g.W × g.H,
 * zonder uitrekken. Twee soorten:
 *   - VELDEN (bd, fl, ec, cc) vullen het hele doek. Zwermen leven in een
 *     wereld van g.W / g.D × g.H / g.D eenheden (568,9 × 320) met evenveel
 *     deeltjes per oppervlak als op het oude vierkant van 320 × 320; roosters
 *     zijn cellen(g, n): vierkante cellen, evenveel als het oude n × n.
 *   - VORMEN rond een middelpunt (lz, sf, km, dp) schalen op de korte zijde
 *     (midden(g)) en blijven heel en rond in het midden; wat links en rechts
 *     overblijft is ruimte (achtergrond = doorzichtig boven de video).
 *   - Twee uitzonderingen (Clay 25 sep), omdat de breedte daar natuurlijk is:
 *     hg (de x-slinger zwaait W / H zo ver, de figuur vult de breedte) en fy
 *     (de spiraal loopt door tot in de hoeken, zonder rand).
 *
 * g.kwaliteit (budget.js): van de lichte luistert alleen fl (3911 deeltjes,
 * ×16/9 door het bredere doek): bij minder kwaliteit bewegen er minder. De
 * andere blijven ruim onder het budget.
 *
 * Stap 1 (docs/plugins/01-plan.md): alleen de LICHTE systemen, gemeten onder
 * 0,5 ms per stap in Node (bench: tools/bench/vm-bench.cjs), plus drie
 * middelzware (fl, hg, dp). De zware (cl, ln, gs, sp, wv, if) komen met de
 * Worker in stap 3.
 *
 * Deze module kent geen Varve: AV-kern kan hem ongewijzigd kopiëren.
 */

import {
  PI, TAU, ACHTERGROND, PALETTEN, LUTS, maakRng, gauss, noise, pcol, cellen, rooster, blit, clear, fade, midden, K, SEL,
} from './hulp.js';

import { SYSTEMEN_ZWAAR } from './systemen-zwaar.js';
import { SYSTEMEN_MEER } from './systemen-meer.js';
import { SYSTEMEN_ISOMORF } from './systemen-isomorf.js';

export { ACHTERGROND, PALETTEN, LUTS, maakRng, noise };

/** g.kwaliteit (budget.js), geklemd op 0,25..1; ontbreekt of onzin = 1. */
const kwaliteit = (g) => { const k = g.kwaliteit; return Number.isFinite(k) ? Math.max(0.25, Math.min(1, k)) : 1; };

// ---- de systemen -----------------------------------------------------------

const EIGEN = [

  { id: 'lz', naam: 'Lorenz-attractor', sub: 'het vlindereffect', cat: 'Chaos', pal: 'gloed',
    knobs: [K('s', 'σ (sigma)', 1, 20, 0.1, 10), K('r', 'ρ (rho)', 1, 120, 0.5, 28), K('b', 'β (beta)', 0.5, 5, 0.01, 2.667),
      K('n', 'aantal banen', 1, 40, 1, 14, { re: 1, fix: 1 }), K('rot', 'draaisnelheid', 0, 1, 0.01, 0.3, { fix: 1 })],
    init(s, p, g) { s.P = []; for (let i = 0; i < p.n; i++) s.P.push({ x: 1 + i * 0.02, y: 1, z: 20, sx: null, sy: null }); clear(g); },
    step(s, p, g) {
      const ctx = g.ctx, { cx, cy, kort } = midden(g); fade(g, 0.045);
      const th = g.t * p.rot * 0.35, co = Math.cos(th), si = Math.sin(th), sc = kort * 0.8 / (1.6 * Math.max(p.r, 4) + 12), zc = Math.max(p.r - 1, 0) * 0.95;
      ctx.lineWidth = 1.2 * g.D; ctx.lineCap = 'round';
      const n = s.P.length;
      s.P.forEach((q, i) => {
        ctx.beginPath(); let first = true;
        for (let k = 0; k < 5; k++) {
          const dt = 0.005, dx = p.s * (q.y - q.x), dy = q.x * (p.r - q.z) - q.y, dz = q.x * q.y - p.b * q.z;
          q.x += dx * dt; q.y += dy * dt; q.z += dz * dt;
          if (!isFinite(q.x) || Math.abs(q.x) > 1e4) { q.x = 1 + i * 0.02; q.y = 1; q.z = 20; q.sx = null; }
          const X = q.x * co - q.y * si, sx = cx + X * sc, sy = cy - (q.z - zc) * sc;
          if (first) { ctx.moveTo(q.sx ?? sx, q.sy ?? sy); first = false; }
          ctx.lineTo(sx, sy); q.sx = sx; q.sy = sy;
        }
        ctx.strokeStyle = pcol(g.pal, 0.35 + 0.65 * i / Math.max(1, n - 1)); ctx.stroke();
      });
    } },

  { id: 'hg', naam: 'Harmonograaf', sub: 'gekoppelde slingers · Lissajous', cat: 'Golven', pal: 'fosfor',
    knobs: [K('a', 'frequentie x', 1, 9, 1, 3), K('b', 'frequentie y', 1, 9, 1, 2), K('e', 'ontstemming', 0, 0.03, 0.0005, 0.004),
      K('d', 'demping', 0.001, 0.02, 0.0005, 0.004), K('ph', 'fasedrift', 0, 1, 0.01, 0.3, { fix: 1 })],
    init() {},
    step(s, p, g) {
      clear(g);
      // Elke slinger zwaait over zijn eigen as tot 8% van de rand (Clay 25 sep):
      // de x-slinger W / H zo ver als de y-slinger (16/9 op 640 × 360), dus de
      // figuur vult de breedte. Een cirkel (a = b) wordt daardoor een ellips;
      // dat is de afspraak. Op het scherm is de figuur zo breed als op 24 sep,
      // dus 6000 punten blijven even glad.
      const ctx = g.ctx, { cx, cy } = midden(g), T = Math.min(260, 5 / p.d), n = 6000, dt = T / n, ph = g.t * p.ph * 0.6, Rx = g.W * 0.42, Ry = g.H * 0.42, bands = 6;
      ctx.lineWidth = 0.9 * g.D; ctx.globalAlpha = 0.85;
      for (let bnd = 0; bnd < bands; bnd++) {
        ctx.beginPath();
        const i0 = bnd * n / bands | 0, i1 = (bnd + 1) * n / bands | 0;
        for (let i = i0; i <= i1; i++) {
          const t = i * dt, e = Math.exp(-p.d * t),
            x = e * (0.6 * Math.sin(p.a * t + ph) + 0.4 * Math.sin(p.b * t)),
            y = e * (0.6 * Math.sin((p.b + p.e) * t) + 0.4 * Math.sin(p.a * t + ph * 0.5 + 1));
          const X = cx + x * Rx, Y = cy + y * Ry;
          if (i === i0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.strokeStyle = pcol(g.pal, 0.95 - bnd * 0.11); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } },

  { id: 'bd', naam: 'Boids', sub: 'zwermgedrag · Reynolds', cat: 'Zwermen', pal: 'fosfor',
    knobs: [K('sep', 'scheiding', 0, 3, 0.05, 1.4), K('ali', 'uitlijning', 0, 3, 0.05, 1), K('coh', 'cohesie', 0, 3, 0.05, 1), K('vis', 'zichtafstand', 10, 90, 1, 38)],
    init(s, p, g) {
      // De wereld in eenheden van g.D: 568,9 × 320 op 640 × 360. Evenveel boids
      // per oppervlak als de 170 op het oude vierkant van 320 × 320, dus 302:
      // zwermen even dicht, even groot en even snel ten opzichte van de hoogte.
      const Wu = g.W / g.D, Hu = g.H / g.D, n = Math.round(170 * Wu * Hu / (320 * 320));
      s.n = n; s.Wu = Wu; s.Hu = Hu;
      s.x = new Float32Array(n); s.y = new Float32Array(n); s.vx = new Float32Array(n); s.vy = new Float32Array(n);
      for (let i = 0; i < n; i++) { s.x[i] = g.r() * Wu; s.y[i] = g.r() * Hu; const a = g.r() * TAU; s.vx[i] = Math.cos(a) * 1.5; s.vy[i] = Math.sin(a) * 1.5; }
      // Buren zoeken in vakken (zie step): een vak per boid, de boids per vak
      // op volgorde, en per vak waar zijn rij in `orde` begint. Groot genoeg
      // voor de kleinste zichtafstand (10).
      s.vak = new Int32Array(n); s.orde = new Int32Array(n);
      s.begin = new Int32Array(Math.floor(Wu / 10) * Math.floor(Hu / 10) + 1);
      clear(g);
    },
    step(s, p, g) {
      const n = s.n, Wu = s.Wu, Hu = s.Hu, v2 = p.vis * p.vis, sd = (p.vis * 0.45) ** 2, ctx = g.ctx, D = g.D; fade(g, 0.28);
      // Vakken van minstens de zichtafstand breed en hoog: alle buren van een
      // boid zitten in de 3 × 3 vakken om de zijne. Dezelfde buren als alle
      // paren aflopen (ook niet over de rand heen), maar op 16:9 met 302 boids
      // zou dat 3,2× zo duur zijn als de 170 van vroeger; zo wordt het goedkoper.
      const zicht = Math.max(p.vis, 10), kol = Math.max(1, Math.floor(Wu / zicht)), rij = Math.max(1, Math.floor(Hu / zicht)), nv = kol * rij;
      const vak = s.vak, orde = s.orde, begin = s.begin;
      begin.fill(0, 0, nv + 1);
      for (let i = 0; i < n; i++) {
        const v = Math.min(rij - 1, (s.y[i] / Hu * rij) | 0) * kol + Math.min(kol - 1, (s.x[i] / Wu * kol) | 0);
        vak[i] = v; begin[v]++;
      }
      for (let v = 1; v < nv; v++) begin[v] += begin[v - 1];          // begin[v] = einde van vak v
      for (let i = n - 1; i >= 0; i--) orde[--begin[vak[i]]] = i;      // nu = begin van vak v, oplopend
      begin[nv] = n;
      for (let i = 0; i < n; i++) {
        let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, c = 0;
        const vk = vak[i] % kol, vr = (vak[i] / kol) | 0, r1 = Math.min(rij - 1, vr + 1), k0 = Math.max(0, vk - 1), k1 = Math.min(kol - 1, vk + 1);
        for (let r = Math.max(0, vr - 1); r <= r1; r++) for (let m = begin[r * kol + k0], e = begin[r * kol + k1 + 1]; m < e; m++) {
          const j = orde[m];
          if (i === j) continue;
          const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i], d2 = dx * dx + dy * dy;
          if (d2 < v2) { cx += s.x[j]; cy += s.y[j]; ax += s.vx[j]; ay += s.vy[j]; c++; if (d2 < sd && d2 > 0) { sx -= dx / d2; sy -= dy / d2; } }
        }
        let vx = s.vx[i], vy = s.vy[i];
        if (c) { vx += ((ax / c) - vx) * 0.05 * p.ali + ((cx / c) - s.x[i]) * 0.0012 * p.coh; vy += ((ay / c) - vy) * 0.05 * p.ali + ((cy / c) - s.y[i]) * 0.0012 * p.coh; }
        vx += sx * p.sep * 0.9; vy += sy * p.sep * 0.9;
        const sp = Math.hypot(vx, vy) || 1, cl = Math.max(1, Math.min(2.6, sp));
        s.vx[i] = vx / sp * cl; s.vy[i] = vy / sp * cl;
      }
      ctx.lineWidth = 1.6 * D; ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        s.x[i] = (s.x[i] + s.vx[i] + Wu) % Wu; s.y[i] = (s.y[i] + s.vy[i] + Hu) % Hu;
        ctx.strokeStyle = pcol(g.pal, 0.45 + 0.55 * (i / n)); ctx.beginPath();
        ctx.moveTo(s.x[i] * D, s.y[i] * D); ctx.lineTo((s.x[i] - s.vx[i] * 2.5) * D, (s.y[i] - s.vy[i] * 2.5) * D); ctx.stroke();
      }
    } },

  { id: 'fl', naam: 'Stromingsveld', sub: 'curl noise · deeltjesstroming', cat: 'Zwermen', pal: 'fosfor',
    knobs: [K('sc', 'schaal', 0.002, 0.03, 0.0005, 0.008), K('sp', 'snelheid', 0.3, 4, 0.05, 1.4), K('ev', 'evolutie', 0, 1, 0.01, 0.3), K('tr', 'spoor', 0.01, 0.3, 0.005, 0.05, { fix: 1 })],
    init(s, p, g) {
      // Zoals bd: een wereld van 568,9 × 320 eenheden, met evenveel deeltjes
      // per oppervlak als de 2200 op 320 × 320 (3911). Het veld (schaal) en de
      // snelheid zijn in eenheden, dus even groot en even snel als vroeger.
      const Wu = g.W / g.D, Hu = g.H / g.D, n = Math.round(2200 * Wu * Hu / (320 * 320));
      s.n = n; s.Wu = Wu; s.Hu = Hu;
      s.x = new Float32Array(n).map(() => g.r() * Wu); s.y = new Float32Array(n).map(() => g.r() * Hu);
      s.l = new Float32Array(n).map(() => g.r() * 200); s.ox = new Float32Array(n); s.oy = new Float32Array(n);
      clear(g);
    },
    step(s, p, g) {
      fade(g, p.tr);
      // Bij lagere kwaliteit (budget.js) bewegen en tekenen alleen de eerste
      // n · kwaliteit deeltjes; de rest ligt stil tot hij terugkomt. Zelfde
      // veld en snelheid, een dunner beeld. Op 16:9 zijn het er 3911 (×16/9),
      // zo kan het budget ook hier terugregelen.
      const ctx = g.ctx, D = g.D, sc = p.sc, tz = g.t * p.ev * 0.25, e = 1, n = Math.max(1, Math.round(s.n * kwaliteit(g)));
      const F = (x, y) => noise(x * sc + tz, y * sc) + 0.5 * noise(x * sc * 2.1 - tz * 0.7, y * sc * 2.1 + 11);
      for (let i = 0; i < n; i++) {
        const x = s.x[i], y = s.y[i], vx = F(x, y + e) - F(x, y - e), vy = -(F(x + e, y) - F(x - e, y)), m = Math.hypot(vx, vy) || 1;
        s.ox[i] = x; s.oy[i] = y; s.x[i] = x + vx / m * p.sp; s.y[i] = y + vy / m * p.sp;
      }
      // Vier kleuren, elk één pad: in het origineel vier Path2D's.
      ctx.lineWidth = D;
      for (let c = 0; c < 4; c++) {
        ctx.beginPath();
        for (let i = c; i < n; i += 4) { ctx.moveTo(s.ox[i] * D, s.oy[i] * D); ctx.lineTo(s.x[i] * D, s.y[i] * D); }
        ctx.strokeStyle = pcol(g.pal, 0.45 + c * 0.18); ctx.stroke();
      }
      const Wu = s.Wu, Hu = s.Hu;
      for (let i = 0; i < n; i++) {
        const nx = s.x[i], ny = s.y[i];
        if (--s.l[i] < 0 || nx < 0 || nx > Wu || ny < 0 || ny > Hu) { s.x[i] = g.r() * Wu; s.y[i] = g.r() * Hu; s.l[i] = 80 + g.r() * 200; }
      }
    } },

  { id: 'sf', naam: 'Superformule', sub: 'Gielis · één formule, alle vormen', cat: 'Wiskunde', pal: 'iris',
    knobs: [K('m', 'm (symmetrie)', 0, 20, 0.5, 6), K('n1', 'n1', 0.1, 12, 0.05, 1), K('n2', 'n2', 0.1, 12, 0.05, 1.7), K('n3', 'n3', 0.1, 12, 0.05, 1.7),
      K('L', 'lagen', 1, 28, 1, 14, { fix: 1 }), K('br', 'ademen', 0, 1, 0.01, 0.5, { fix: 1 })],
    init(s) { s.rr = new Float32Array(541); },
    r(m, n1, n2, n3, ph) { const a = Math.abs(Math.cos(m * ph / 4)) ** n2, b = Math.abs(Math.sin(m * ph / 4)) ** n3, r = (a + b) ** (-1 / n1); return isFinite(r) ? r : 0; },
    step(s, p, g) {
      clear(g);
      const ctx = g.ctx, { cx, cy, kort } = midden(g), t = g.t, L = p.L | 0, pts = 540, rr = s.rr; ctx.lineWidth = 1.1 * g.D;
      for (let l = 0; l < L; l++) {
        const f = L > 1 ? l / (L - 1) : 0, n1 = p.n1 * (1 + p.br * 0.55 * Math.sin(t * 0.8 + l * 0.38)), rot = t * 0.12 * p.br * (l % 2 ? 1 : -1);
        let mx = 0;
        for (let i = 0; i <= pts; i++) { rr[i] = this.r(p.m, n1, p.n2, p.n3, i / pts * TAU); if (rr[i] > mx) mx = rr[i]; }
        const sc = kort * 0.44 * (1 - f * 0.85) / (mx || 1);
        ctx.beginPath();
        for (let i = 0; i <= pts; i++) {
          const ph = i / pts * TAU + rot, X = cx + Math.cos(ph) * rr[i] * sc, Y = cy + Math.sin(ph) * rr[i] * sc;
          if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        }
        ctx.strokeStyle = pcol(g.pal, 0.3 + 0.7 * f); ctx.stroke();
      }
    } },

  { id: 'ec', naam: 'Elementaire automaat', sub: 'Wolfram · 256 regels', cat: 'Automaten', pal: 'fosfor',
    knobs: [K('rule', 'regel', 0, 255, 1, 30, { re: 1 }), SEL('start', 'begin', ['Eén cel', 'Willekeurig'], 0, { re: 1 }), K('sp', 'rijen per frame', 1, 6, 1, 2, { fix: 1 })],
    init(s, p, g) {
      // Een rij van W cellen over de hele breedte, H rijen die omhoog schuiven:
      // cellen(g, 160) = 213 × 120, evenveel cellen als het oude 160 × 160.
      s.g = rooster(g, cellen(g, 160)); const W = s.g.nx; s.W = W; s.H = s.g.ny; s.g.px.fill(g.L[0]);
      s.row = new Uint8Array(W); s.nieuw = new Uint8Array(W);
      if (p.start == 0) s.row[W >> 1] = 1; else for (let i = 0; i < W; i++) s.row[i] = g.r() < 0.5 ? 1 : 0;
    },
    step(s, p, g) {
      const W = s.W, H = s.H, px = s.g.px, on = g.L[215], off = g.L[0], rule = p.rule | 0;
      for (let k = 0; k < p.sp; k++) {
        const r = s.row, n = s.nieuw;
        for (let i = 0; i < W; i++) { const idx = (r[(i - 1 + W) % W] << 2) | (r[i] << 1) | r[(i + 1) % W]; n[i] = (rule >> idx) & 1; }
        s.row = n; s.nieuw = r;
        px.copyWithin(0, W, W * H);
        for (let i = 0; i < W; i++) px[(H - 1) * W + i] = n[i] ? on : off;
      }
      blit(s.g, g, true);
    } },

  { id: 'cc', naam: 'Cyclische automaat', sub: 'Griffeath · BZ-spiralen', cat: 'Patronen', pal: 'iris',
    knobs: [K('n', 'toestanden', 3, 20, 1, 14, { re: 1 }), K('T', 'drempel', 1, 5, 1, 1), SEL('nb', 'buurt', ['Moore (8)', 'Von Neumann (4)'], 1), K('sp', 'stappen per frame', 1, 4, 1, 2, { fix: 1 })],
    init(s, p, g) {
      // cellen(g, 128) = 171 × 96 vierkante cellen, evenveel als het oude 128 × 128:
      // spiralen even groot in cellen, zelfde rekentijd. Rondlopen per as.
      s.g = rooster(g, cellen(g, 128)); const NX = s.g.nx, NY = s.g.ny; s.NX = NX; s.NY = NY;
      s.a = new Uint8Array(NX * NY); s.b = new Uint8Array(NX * NY); for (let i = 0; i < NX * NY; i++) s.a[i] = g.r() * p.n | 0;
    },
    step(s, p, g) {
      const NX = s.NX, NY = s.NY, n = p.n | 0, T = p.T | 0, moore = p.nb == 0;
      for (let k = 0; k < p.sp; k++) {
        const a = s.a, b = s.b;
        for (let y = 0; y < NY; y++) {
          const ym = ((y - 1 + NY) % NY) * NX, yc = y * NX, yp = ((y + 1) % NY) * NX;
          for (let x = 0; x < NX; x++) {
            const xm = (x - 1 + NX) % NX, xp = (x + 1) % NX, c = a[yc + x], nx = (c + 1) % n;
            let cnt = (a[ym + x] === nx) + (a[yp + x] === nx) + (a[yc + xm] === nx) + (a[yc + xp] === nx);
            if (moore) cnt += (a[ym + xm] === nx) + (a[ym + xp] === nx) + (a[yp + xm] === nx) + (a[yp + xp] === nx);
            b[yc + x] = cnt >= T ? nx : c;
          }
        }
        s.a = b; s.b = a;
      }
      const px = s.g.px, L = g.L, a = s.a;
      for (let i = 0; i < a.length; i++) px[i] = L[20 + (a[i] / n * 235) | 0];
      blit(s.g, g, true);
    } },

  { id: 'km', naam: 'Kuramoto-oscillatoren', sub: 'spontane synchronisatie', cat: 'Zwermen', pal: 'gloed',
    knobs: [K('K', 'koppeling', 0, 4, 0.01, 1.1), K('sg', 'tempo-spreiding', 0, 2, 0.01, 0.6), K('n', 'oscillatoren', 8, 240, 1, 90, { re: 1, fix: 1 })],
    init(s, p, g) {
      const n = p.n | 0; s.n = n;
      s.z = Float32Array.from({ length: n }, () => gauss(g.r)).sort();
      s.th = new Float32Array(n).map(() => g.r() * TAU);
      clear(g);
    },
    step(s, p, g) {
      const n = s.n, ctx = g.ctx, D = g.D, { cx, cy, kort } = midden(g);
      let cs = 0, sn = 0;
      for (let i = 0; i < n; i++) { cs += Math.cos(s.th[i]); sn += Math.sin(s.th[i]); }
      cs /= n; sn /= n;
      const R = Math.hypot(cs, sn), psi = Math.atan2(sn, cs);
      for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) s.th[i] += 0.02 * (1 + p.sg * s.z[i] + p.K * R * Math.sin(psi - s.th[i]));
      s.o.sync = R;   // een uitgang: hoe gelijk ze lopen (0..1)
      fade(g, 0.16);
      const plek = (i) => { const r = kort * (0.07 + 0.38 * i / (n - 1)); return [cx + Math.cos(s.th[i]) * r, cy + Math.sin(s.th[i]) * r]; };
      ctx.lineWidth = 0.8 * D; ctx.beginPath();
      for (let i = 0; i < n; i++) { const [x, y] = plek(i); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.strokeStyle = 'rgba(238,161,60,.35)'; ctx.stroke();
      for (let i = 0; i < n; i++) { const [x, y] = plek(i); ctx.fillStyle = pcol(g.pal, 0.4 + 0.6 * i / n); ctx.beginPath(); ctx.arc(x, y, 2 * D, 0, TAU); ctx.fill(); }
    } },

  { id: 'dp', naam: 'Dubbele slinger', sub: 'deterministische chaos', cat: 'Chaos', pal: 'iris',
    knobs: [K('n', 'aantal slingers', 1, 60, 1, 30, { re: 1, fix: 1 }), K('e', 'verschil (10^x)', -9, -1, 1, -4, { re: 1 }),
      K('a0', 'beginhoek °', 20, 179, 1, 130, { re: 1 }), K('gv', 'zwaartekracht', 1, 25, 0.1, 9.8)],
    init(s, p, g) {
      const n = p.n | 0, eps = 10 ** p.e, a = p.a0 * PI / 180;
      s.P = Array.from({ length: n }, (_, i) => ({ a1: a + i * eps, a2: a + i * eps, w1: 0, w2: 0, tx: null, ty: null }));
      clear(g);
    },
    step(s, p, g) {
      // Ophangpunt op 0,42 van de hoogte, zoals op het oude vierkant.
      const ctx = g.ctx, D = g.D, { cx, cy, kort } = midden(g), ox = cx, oy = cy - 0.08 * kort, l = kort * 0.22, gv = p.gv, n = s.P.length;
      fade(g, 0.2); ctx.lineCap = 'round';
      s.P.forEach((q, i) => {
        for (let k = 0; k < 10; k++) {
          const dt = 0.0025, d = q.a1 - q.a2, den = 3 - Math.cos(2 * d);
          const al1 = (-gv * 3 * Math.sin(q.a1) - gv * Math.sin(q.a1 - 2 * q.a2) - 2 * Math.sin(d) * (q.w2 * q.w2 + q.w1 * q.w1 * Math.cos(d))) / den;
          const al2 = (2 * Math.sin(d) * (q.w1 * q.w1 * 2 + gv * 2 * Math.cos(q.a1) + q.w2 * q.w2 * Math.cos(d))) / den;
          q.w1 += al1 * dt; q.w2 += al2 * dt; q.a1 += q.w1 * dt; q.a2 += q.w2 * dt;
        }
        const x1 = ox + Math.sin(q.a1) * l, y1 = oy + Math.cos(q.a1) * l, x2 = x1 + Math.sin(q.a2) * l, y2 = y1 + Math.cos(q.a2) * l;
        ctx.strokeStyle = pcol(g.pal, 0.35 + 0.65 * i / Math.max(1, n - 1));
        ctx.globalAlpha = 0.35; ctx.lineWidth = D; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1;
        if (q.tx !== null) { ctx.lineWidth = 1.6 * D; ctx.beginPath(); ctx.moveTo(q.tx, q.ty); ctx.lineTo(x2, y2); ctx.stroke(); }
        q.tx = x2; q.ty = y2;
      });
    } },

  { id: 'fy', naam: 'Fyllotaxis', sub: 'de gulden hoek · zonnebloempit', cat: 'Groei', pal: 'gloed',
    knobs: [K('ang', 'hoek °', 90, 180, 0.001, 137.508), K('n', 'zaden', 100, 3000, 10, 1400, { fix: 1 }), K('dr', 'drift', 0, 1, 0.01, 0.25, { fix: 1 }), K('sz', 'zaadgrootte', 0.3, 2, 0.01, 1, { fix: 1 })],
    // Hoe dicht de zaden staan: n zaden op een schijf met straal DICHT × de
    // korte zijde (het origineel: 0,46, en daar hield de bloem op).
    DICHT: 0.6,
    init() {},
    step(s, p, g) {
      clear(g);
      // Een ingezoomde zonnebloem (Clay 25 sep): de spiraal loopt door tot in
      // de hoeken, zonder rand. De RAND van de bloem ligt in de hoek (straal =
      // halve diagonaal): daar zijn de zaden het grootst en het lichtst, zoals
      // vroeger aan de rand. Zaden die buiten beeld vallen worden berekend
      // maar niet getekend. Met DICHT 0,6 (vroeger 0,46) zijn ze 30% groter dan
      // op het oude vierkant; zo tekent hij, met de halve zaden langs de rand,
      // hooguit 16/9 zoveel als het oude vierkant (op 1400 zaden ×1,6).
      const ctx = g.ctx, W = g.W, H = g.H, { cx, cy, kort } = midden(g), n = p.n | 0, a = (p.ang + Math.sin(g.t * 0.25) * p.dr * 0.9) * PI / 180;
      const c = kort * this.DICHT / Math.sqrt(n), rand = Math.hypot(W, H) / 2, N = (rand / c) ** 2, k = c * 0.42 * p.sz;
      for (let i = 1; ; i++) {
        // i / N = (r / rand)²: de groei en de kleur zoals vroeger i / n.
        const r = c * Math.sqrt(i), f = i / N, rad = Math.max(0.6, k * (0.4 + 0.6 * Math.sqrt(f)));
        if (r - rad > rand) break;                     // voorbij de hoeken: klaar
        const th = i * a, x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
        if (x + rad < 0 || x - rad > W || y + rad < 0 || y - rad > H) continue;
        ctx.fillStyle = pcol(g.pal, 0.3 + 0.7 * f); ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU); ctx.fill();
      }
    } },
];

/**
 * Alle 26, in de volgorde waarin Device ◀ ▶ ze afloopt: eerst de lichte
 * (hierboven), dan de zware (systemen-zwaar.js: gs, cl, ln, ph, sp), de
 * middelzware (systemen-meer.js) en de vier waarin beeld = geluid
 * (systemen-isomorf.js; hun geluid zit achter een sink die in Varve nog
 * nergens op aangesloten is, dus ze zijn hier alleen beeld).
 */
export const SYSTEMEN = [...EIGEN, ...SYSTEMEN_ZWAAR, ...SYSTEMEN_MEER, ...SYSTEMEN_ISOMORF];

export const SYSTEEM = Object.fromEntries(SYSTEMEN.map((s) => [s.id, s]));

/**
 * De knoppen die op een draaiknop mogen: geen keuzelijst (sel), geen knop
 * die een nieuwe init vraagt (re), en geen knop die alleen het geluid raakt
 * (geluid: de volumeknop van de isomorfe systemen; er is nog geen sink). Hooguit `max`, in de volgorde van het
 * systeem — daar staan de knoppen die het verschil maken vooraan.
 */
export function draaiKnoppen(sys, max = 6) {
  return sys.knobs.filter((k) => !k.sel && !k.re && !k.geluid).slice(0, max);
}
