// Vormlagen: de Vormmachines als beeldlaag over de video. Zonder browser:
// een nep-canvas voor de systemen en een nep-WebGL voor de mixer.
// Draai met: node test/vormen.test.mjs
import { readFileSync } from 'node:fs';

const { SYSTEMEN, SYSTEEM, draaiKnoppen, maakRng, ACHTERGROND, LUTS } = await import('../src/vormen/systemen.js');
const { VormLaag, VormLagen, STAP, MAX_STAPPEN, LAAG_BREEDTE, LAAG_HOOGTE } = await import('../src/vormen/laag.js');
const { maten, cellen, rooster, blit, clear, fade, midden } = await import('../src/vormen/hulp.js');
const { actieveLagen, lagenUniforms, MAX_BEELDLAGEN, LAAG_FIT } = await import('../src/video/lagen.js');
const { leesLaag } = await import('../src/video/passen.js');
const { VideoMixer } = await import('../src/video/video-mixer.js');
const actions = await import('../src/control/actions.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// Rekentijd in THREADTIJD (process.threadCpuUsage): alleen de ms dat onze eigen
// JS-draad rekende. Op een drukke machine (load 30–250 op 8 kernen, gemeten 25
// sep) loopt de wandklok door terwijl de planner ons wegzet: tot 330 ms voor een
// stap van 5. process.cpuUsage telt GC- en compilerdraden mee: tot 27 ms. Wat de
// stap zelf doet telt wel, ook GC op de hoofddraad: voor het werk van de stap
// is de check even streng. Wat threadtijd NIET wegneemt: onder load rekenen we
// op een trage kern (E-kern, koude cache), 2 à 3× zo duur. Daarom boven het
// budget nog eens meten, hooguit drie keer, de beste telt; een stap die echt te
// duur is, is dat elke keer. Bewust niet: een percentiel (p95 verstopt een stap
// die ALTIJD traag is, zoals wv stap 7: 2,5 ms tegen een p95 van 0,2) en een
// referentieblok waarmee de drempel meeschaalt (ander rekenwerk vertraagt anders:
// alleen op de E-kernen werd fl 2,2× zo duur en een vast Float32-blok niet, onder
// load 250 fl 2,2× en het blok 1,3×; zo'n drempel schaalt met het blok mee, niet
// met de vorm, en wordt dus te ruim of te krap).
const draadMs = () => { const t = process.threadCpuUsage(); return (t.user + t.system) / 1000; };

// ---- nep-canvas: elke tekenaanroep telt, niets tekent -----------------------
function maakCanvas(w, h) {
  const tel = { n: 0 };
  // Zoals een echte 2D-context: begintoestand, en reset() zet die terug.
  const BEGIN = { lineCap: 'butt', lineJoin: 'miter', lineWidth: 1, globalAlpha: 1, imageSmoothingEnabled: true };
  const doel = {
    ...BEGIN,
    createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }),
    reset: () => Object.assign(doel, BEGIN),
    tel,
  };
  const ctx = new Proxy(doel, {
    get(t, k) { if (k in t) return t[k]; return () => { tel.n++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, tel };
}
/**
 * Nep-canvas dat elke tekenaanroep MET argumenten opschrijft, zodat we zien
 * over welk vlak clear, fade en blit gaan. Zoals een echte context: een
 * onbekende methode bestaat niet (dan gooit het), niet stilletjes niets.
 */
function opneemCanvas(w, h) {
  const log = [];
  const ctx = { fillStyle: '#000', imageSmoothingEnabled: true, log };
  for (const m of ['fillRect', 'drawImage', 'putImageData']) ctx[m] = (...a) => log.push([m, ...a]);
  ctx.createImageData = (b, hh) => ({ width: b, height: hh, data: new Uint8ClampedArray(b * hh * 4) });
  return { width: w, height: h, getContext: () => ctx, log };
}
/** Alle getallen in de toestand van een systeem, om NaN te vinden en toestanden te vergelijken. */
function getallen(s, uit = [], diep = 0) {
  if (diep > 3 || s == null) return uit;
  if (typeof s === 'number') uit.push(s);
  else if (ArrayBuffer.isView(s)) { for (let i = 0; i < s.length; i += Math.max(1, s.length >> 6)) uit.push(s[i]); }
  else if (Array.isArray(s)) s.slice(0, 64).forEach((x) => getallen(x, uit, diep + 1));
  else if (typeof s === 'object' && !s.getContext && !s.px) Object.values(s).forEach((x) => getallen(x, uit, diep + 1));
  return uit;
}

console.log('de systemen');
{
  const { readdirSync } = await import('node:fs');
  const bestanden = readdirSync(new URL('../src/vormen/', import.meta.url)).filter((f) => /^(hulp|systemen.*)\.js$/.test(f));
  const vies = bestanden.filter((f) => /\bdocument\b|\bwindow\b|performance\.now|Math\.random|Path2D/.test(
    readFileSync(new URL(`../src/vormen/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  ok(`hulp.js en systemen*.js (${bestanden.length}) kennen geen DOM, geen eigen klok en geen Math.random`, bestanden.length >= 2 && vies.length === 0);
  if (vies.length) console.log('      vies:', vies.join(', '));
  // ROADMAP 7: alle 26 tekenen op W × H; de zijde van het oude vierkant (g.S)
  // bestaat niet meer, ook niet uitgepakt als { S } = g.
  const metS = bestanden.filter((f) => /\bg\.S\b|\{[^}=]*\bS\b[^}=]*\}\s*=\s*g\b/.test(
    readFileSync(new URL(`../src/vormen/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  ok('geen enkel systeembestand noemt g.S nog', metS.length === 0);
  if (metS.length) console.log('      met g.S:', metS.join(', '));
  ok(`${SYSTEMEN.length} systemen, elk met een uniek id`, SYSTEMEN.length >= 8 && new Set(SYSTEMEN.map((s) => s.id)).size === SYSTEMEN.length);

  const echt = Math.random;
  Math.random = () => { throw new Error('Math.random gebruikt'); };
  for (const sys of SYSTEMEN) {
    let fout = null, laag = null;
    try {
      laag = new VormLaag({ maakCanvas, systeem: sys.id, zaad: 7 });
      for (let i = 0; i < 180; i++) laag.frame(i * STAP);
    } catch (e) { fout = e; }
    const nums = laag ? getallen(laag.s) : [];
    ok(`${sys.id} (${sys.naam}): 180 stappen zonder fout, zonder NaN, en hij tekent`,
      !fout && nums.every(Number.isFinite) && laag.canvas.tel.n > 0);
    if (fout) console.log('      ', fout.message);
  }
  Math.random = echt;

  // Zelfde zaad = dezelfde tekening, voor elk systeem: elke tekenaanroep met
  // zijn getallen en elke stijl die gezet wordt gaat in een hash, en van een
  // pixelrooster de pixels zelf. Eén hash voor alle canvassen van een laag
  // (het doek én de roosters, die hun eigen canvas hebben).
  const hashCanvassen = (st = { h: 2166136261 }) => (w, h) => {
    const mix = (v) => {
      const s = typeof v === 'number' ? v.toFixed(4) : typeof v === 'string' ? v : '';
      for (let i = 0; i < s.length; i++) st.h = Math.imul(st.h ^ s.charCodeAt(i), 16777619) >>> 0;
    };
    const doel = { createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }) };
    const ctx = new Proxy(doel, {
      get(o, k) {
        if (k in o) return o[k];
        return (...a) => {
          mix(k);
          for (const x of a) {
            if (x?.data) { const d = x.data; for (let i = 0; i < d.length; i += 4 * 7) mix(d[i] + d[i + 1] * 256 + d[i + 2] * 65536); } else mix(x);
          }
        };
      },
      set(o, k, v) { mix(k); mix(v); o[k] = v; return true; },
    });
    return { width: w, height: h, getContext: () => ctx, st };
  };
  const tekening = (id, zaad) => {
    // Een meetklok die 0 zegt: anders zet het budget (wandklok) op een drukke
    // machine de kwaliteit lager, en dan tekent fl terecht minder.
    const l = new VormLaag({ maakCanvas: hashCanvassen(), systeem: id, zaad, nu: () => 0 });
    for (let i = 0; i < 20; i++) l.frame(i * STAP);
    return l.canvas.st.h;
  };
  const anders = SYSTEMEN.filter((s) => tekening(s.id, 7) !== tekening(s.id, 7)).map((s) => s.id);
  ok(`alle ${SYSTEMEN.length}: zelfde zaad = precies dezelfde tekening (hash over 20 stappen)`,
    anders.length === 0 && tekening('bd', 7) !== tekening('bd', 8) && tekening('cc', 7) !== tekening('cc', 8));
  if (anders.length) console.log('      anders:', anders.join(', '));

  const na = (zaad) => { const l = new VormLaag({ maakCanvas, systeem: 'bd', zaad }); for (let i = 0; i < 60; i++) l.frame(i * STAP); return getallen(l.s); };
  const a = na(3), b = na(3), c = na(4);
  ok('zelfde zaad = precies hetzelfde beeld (replay kan)', a.length > 50 && a.every((x, i) => x === b[i]));
  ok('ander zaad = ander beeld', a.some((x, i) => x !== c[i]));
  const r = maakRng(1);
  const reeks = Array.from({ length: 1000 }, r);
  ok('de generator geeft 0 ≤ x < 1, gemiddeld rond 0,5', reeks.every((x) => x >= 0 && x < 1) && Math.abs(reeks.reduce((s, x) => s + x, 0) / 1000 - 0.5) < 0.05);

  const dk = draaiKnoppen(SYSTEEM.ec);
  ok('draaiknoppen: geen keuzelijst en geen herstart-knop (ec: alleen "rijen per frame")', dk.length === 1 && dk[0].k === 'sp');
  ok('draaiknoppen: nooit meer dan zes', SYSTEMEN.every((s) => draaiKnoppen(s).length <= 6));
  ok('elk systeem heeft minstens één draaiknop', SYSTEMEN.every((s) => draaiKnoppen(s).length >= 1));
}

console.log('het doek is 16:9 (ROADMAP 7)');
{
  const { BREEDTE, HOOGTE } = await import('../src/video/video-mixer.js');
  ok(`${LAAG_BREEDTE} × ${LAAG_HOOGTE}: precies 16:9`, LAAG_BREEDTE * 9 === LAAG_HOOGTE * 16);
  ok('niet groter dan het oude vierkant van 512² (budget.js hoeft niet opnieuw)', LAAG_BREEDTE * LAAG_HOOGTE <= 512 * 512);
  ok('een heel getal keer naar het doek van de mixer (geen scheve resampling)',
    BREEDTE % LAAG_BREEDTE === 0 && HOOGTE % LAAG_HOOGTE === 0 && BREEDTE / LAAG_BREEDTE === HOOGTE / LAAG_HOOGTE);

  const laag = new VormLaag({ maakCanvas: opneemCanvas, systeem: 'hg' });
  ok('een vormlaag tekent op een canvas van 640 × 360', laag.canvas.width === 640 && laag.canvas.height === 360);
  ok('g kent W en H, D = korte zijde / 320, en geen S meer (alle 26 zijn om)',
    laag.g.W === 640 && laag.g.H === 360 && bij(laag.g.D, 360 / 320) && !('S' in laag.g));
  ok('bij het starten gaat het HELE doek naar de achtergrond',
    laag.canvas.log.some(([m, x, y, b, h]) => m === 'fillRect' && x === 0 && y === 0 && b === 640 && h === 360) && laag.ctx.fillStyle === ACHTERGROND);
  const eigen = new VormLaag({ maakCanvas: opneemCanvas, systeem: 'lz', breedte: 320, hoogte: 180 });
  ok('een eigen maat kan (breedte, hoogte)', eigen.canvas.width === 320 && eigen.g.W === 320 && eigen.g.H === 180 && bij(eigen.g.D, 180 / 320));

  const m = maten(640, 360), staand = maten(360, 640);
  ok('maten(): D op de KORTE zijde, liggend en staand gelijk (lijnen even dik), geen S', bij(m.D, 1.125) && bij(staand.D, m.D) && !('S' in m));

  const c = opneemCanvas(640, 360);
  const g = { ...m, ctx: c.getContext('2d'), maakCanvas: opneemCanvas };
  clear(g); fade(g, 0.1);
  const vlakken = c.log.filter(([f]) => f === 'fillRect').map((a) => a.slice(1).join(','));
  ok('clear en fade gaan over het hele doek (niet meer S × S)', vlakken.length === 2 && vlakken.every((v) => v === '0,0,640,360'));

  // cellen(): evenveel cellen als n × n, vierkant, over het hele doek.
  const ns = [64, 110, 128, 150, 160, 180, 200, 256, 320];
  const rs = ns.map((n) => ({ n, ...cellen(g, n) }));
  ok(`cellen(g, n): evenveel cellen als n × n, hooguit 2% ernaast (${ns.join(', ')})`,
    rs.every(({ n, nx, ny }) => Math.abs(nx * ny - n * n) / (n * n) < 0.02));
  ok('en ze zijn vierkant: breedte en hoogte van een cel hooguit 1% uit elkaar',
    rs.every(({ nx, ny }) => Math.abs(640 / nx - 360 / ny) / (360 / ny) < 0.01));
  ok('cel = pixels per cel (H / ny)', rs.every(({ ny, cel }) => bij(cel, 360 / ny)));
  const c128 = cellen(g, 128);
  ok('cellen(g, 128) = 171 × 96, cel 3,75 (het voorbeeld in hulp.js)', c128.nx === 171 && c128.ny === 96 && bij(c128.cel, 3.75));
  const vol = cellen(g, 128, 2), half = { nx: vol.nx / 2, ny: vol.ny / 2 };
  ok('veelvoud 2: de halve maat past precies (2×2-blokken)', vol.nx % 2 === 0 && vol.ny % 2 === 0 && Number.isInteger(half.nx) && Number.isInteger(half.ny));
  ok('en de halve heeft ook vierkante cellen', Math.abs(640 / half.nx - 360 / half.ny) / (360 / half.ny) < 0.01);
  ok('ny een veelvoud van 9: exact vierkant (640 × 360 is 16:9 met ggd 40)', cellen(g, 320, 9).nx * 360 === cellen(g, 320, 9).ny * 640);
  ok('op een staand doek ook vierkant', (() => { const s = cellen({ ...staand }, 128); return Math.abs(360 / s.nx - 640 / s.ny) / (640 / s.ny) < 0.01 && s.ny > s.nx; })());

  // rooster(): nx × ny, over het hele doek. Het oude getal-geval gooit.
  const gr = rooster(g, cellen(g, 128));
  ok('rooster(g, cellen(g, n)): nx × ny pixels, px heeft nx * ny plekken, cel gaat mee',
    gr.c.width === 171 && gr.c.height === 96 && gr.px.length === 171 * 96 && bij(gr.cel, 3.75) && !gr.oud);
  c.log.length = 0;
  blit(gr, g, true);
  const teken = c.log.find(([f]) => f === 'drawImage');
  ok('blit rekt het rooster over het HELE doek', teken && teken[1] === gr.c && teken.slice(2).join(',') === '0,0,640,360');
  ok('blit met pix: scherpe blokken', g.ctx.imageSmoothingEnabled === false);
  let gooit = null;
  try { rooster(g, 128); } catch (e) { gooit = e; }
  ok('rooster(g, getal) bestaat niet meer: hij gooit, in plaats van stil een vierkant links te tekenen', gooit instanceof TypeError);

  const md = midden(g);
  ok('midden(g): middelpunt en korte zijde', md.cx === 320 && md.cy === 180 && md.kort === 360);
  ok('midden(g).vak: het vierkant in het midden', md.vak.x === 140 && md.vak.y === 0 && md.vak.b === 360 && md.vak.h === 360);
  c.log.length = 0;
  blit(rooster(g, { nx: 110, ny: 110 }), g, false, md.vak);
  ok('een bewust vierkant rooster in het midden: blit(gr, g, pix, midden(g).vak)',
    c.log.find(([f]) => f === 'drawImage').slice(2).join(',') === '140,0,360,360');
  const mdStaand = midden({ ...staand });
  ok('staand: het vak schuift verticaal', mdStaand.vak.x === 0 && mdStaand.vak.y === 140 && mdStaand.kort === 360);
}

console.log('de lichte systemen (systemen.js) tekenen echt 16:9');
{
  // Velden vullen het hele doek; vormen rond een middelpunt staan in het
  // midden, heel in beeld, geschaald op de korte zijde (docs/VORMEN-16x9.md).
  // Twee uitzonderingen die de breedte gebruiken (Clay 25 sep): hg (de
  // x-slinger zwaait W / H zo ver) en fy (de spiraal tot in de hoeken).
  const VELD = ['bd', 'fl', 'ec', 'cc'], VORM = ['lz', 'sf', 'km', 'dp'], BREED = ['hg', 'fy'];
  const bron = readFileSync(new URL('../src/vormen/systemen.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  ok('systemen.js gebruikt g.S niet meer, en geen verouderd rooster(g, n)',
    !/\bg\.S\b/.test(bron) && !/rooster\(g,\s*[\w$.]+\s*\)/.test(bron) && /rooster\(g, cellen\(/.test(bron));
  const lichte = [...VELD, ...VORM, ...BREED];
  ok(`alle lichte systemen zijn ingedeeld (${lichte.length})`, lichte.every((id) => SYSTEEM[id]) && new Set(lichte).size === 10);

  /** Nep-canvas dat bijhoudt waar er getekend wordt (lijnen, bogen, beelden; clear/fade niet). */
  function bereikCanvas(w, h) {
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    const punt = (x, y, r = 0) => { b.x0 = Math.min(b.x0, x - r); b.x1 = Math.max(b.x1, x + r); b.y0 = Math.min(b.y0, y - r); b.y1 = Math.max(b.y1, y + r); };
    const doel = {
      lineCap: 'butt', lineJoin: 'miter', lineWidth: 1, globalAlpha: 1, imageSmoothingEnabled: true,
      createImageData: (bb, hh) => ({ data: new Uint8ClampedArray(bb * hh * 4) }),
      moveTo: (x, y) => punt(x, y), lineTo: (x, y) => punt(x, y), arc: (x, y, r) => punt(x, y, r),
      drawImage: (_, x, y, bb, hh) => { if (bb !== undefined) { punt(x, y); punt(x + bb, y + hh); } },
    };
    const ctx = new Proxy(doel, { get(t, k) { return k in t ? t[k] : () => {}; }, set(t, k, v) { t[k] = v; return true; } });
    return { width: w, height: h, getContext: () => ctx, bereik: b };
  }
  const W = LAAG_BREEDTE, H = LAAG_HOOGTE;
  const bereik = {};
  for (const id of lichte) {
    const laag = new VormLaag({ maakCanvas: bereikCanvas, systeem: id, zaad: 7 });
    for (let i = 0; i < 300; i++) laag.frame(i * STAP);
    bereik[id] = laag.canvas.bereik;
  }
  const pct = (v) => `${Math.round(v * 100)}%`;
  for (const id of VELD) {
    const b = bereik[id];
    ok(`${id}: tekent over het hele doek, van rand tot rand (x ${pct(b.x0 / W)}–${pct(b.x1 / W)}, y ${pct(b.y0 / H)}–${pct(b.y1 / H)})`,
      b.x0 <= 0.02 * W && b.x1 >= 0.98 * W && b.y0 <= 0.02 * H && b.y1 >= 0.98 * H);
  }
  for (const id of VORM) {
    const b = bereik[id], mx = (b.x0 + b.x1) / 2 / W;
    ok(`${id}: in het midden (${mx.toFixed(3)}), heel in beeld en niet breder dan de korte zijde (${Math.round(b.x1 - b.x0)} × ${Math.round(b.y1 - b.y0)} px)`,
      Math.abs(mx - 0.5) < 0.03 && b.y0 >= -0.02 * H && b.y1 <= 1.02 * H && b.x1 - b.x0 <= 1.02 * H);
  }
  for (const id of ['sf', 'km']) {
    const b = bereik[id], bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    ok(`${id}: een cirkel blijft rond (breedte/hoogte ${(bw / bh).toFixed(3)})`, Math.abs(bw / bh - 1) < 0.1);
  }
  {
    // hg: de x-slinger zwaait W / H zo ver als de y-slinger, dus de figuur
    // vult de breedte in dezelfde verhouding als de hoogte, heel in beeld.
    const b = bereik.hg, fx = (b.x1 - b.x0) / W, fy = (b.y1 - b.y0) / H, mx = (b.x0 + b.x1) / 2 / W;
    ok(`hg: vult de breedte zoals de hoogte (x ${pct(b.x0 / W)}–${pct(b.x1 / W)}, y ${pct(b.y0 / H)}–${pct(b.y1 / H)}), in het midden, heel in beeld`,
      fx >= 0.75 && Math.abs(fx / fy - 1) < 0.08 && Math.abs(mx - 0.5) < 0.03 && b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H);
    // fy: de spiraal loopt door tot in de hoeken; zaden die er helemaal
    // buiten vallen worden niet getekend.
    const f = bereik.fy, rmax = SYSTEEM.fy.DICHT * H / Math.sqrt(10) * 0.42 * 2;     // grootste zaad dat kan (n 10, sz 2), ruim
    ok(`fy: tekent tot in de hoeken (x ${pct(f.x0 / W)}–${pct(f.x1 / W)}, y ${pct(f.y0 / H)}–${pct(f.y1 / H)}) en niets ver buiten beeld`,
      f.x0 <= 0 && f.x1 >= W && f.y0 <= 0 && f.y1 >= H && f.x0 > -rmax && f.x1 < W + rmax && f.y0 > -rmax && f.y1 < H + rmax);
  }

  // Wat meegroeit met het doek: deeltjes even dicht als op 320 × 320, roosters
  // met vierkante cellen en evenveel cellen als het oude n × n.
  const g = { ...maten(W, H), ctx: maakCanvas(W, H).getContext('2d'), t: 0, r: maakRng(7), maakCanvas };
  const start = (id, p = {}) => {
    const sys = SYSTEEM[id], s = { o: {}, e: {} };
    const pp = { ...Object.fromEntries(sys.knobs.map((k) => [k.k, k.v])), ...p };
    sys.init.call(sys, s, pp, { ...g, pal: sys.pal, L: LUTS[sys.pal], r: maakRng(7) });
    return { s, p: pp };
  };
  const dicht = (n, oud) => Math.abs((n / ((W / g.D) * (H / g.D))) / (oud / (320 * 320)) - 1) < 0.01;
  const bd = start('bd').s, fl = start('fl').s;
  ok(`bd: ${bd.n} boids in ${Math.round(bd.Wu)} × ${Math.round(bd.Hu)} eenheden, even dicht als 170 op 320 × 320`, bd.n === 302 && dicht(bd.n, 170) && bd.Hu === 320);
  ok(`fl: ${fl.n} deeltjes, even dicht als 2200 op 320 × 320`, fl.n === 3911 && dicht(fl.n, 2200) && fl.Hu === 320);
  const ec = start('ec').s, cc = start('cc').s;
  const vierkant = (nx, ny) => Math.abs(W / nx - H / ny) / (H / ny) < 0.01;
  ok(`ec: ${ec.W} × ${ec.H} cellen over het hele doek, vierkant, evenveel als 160 × 160`,
    ec.g.nx === ec.W && ec.g.ny === ec.H && vierkant(ec.W, ec.H) && Math.abs(ec.W * ec.H / 160 ** 2 - 1) < 0.02 && !ec.g.oud);
  ok(`cc: ${cc.NX} × ${cc.NY} cellen, vierkant, evenveel als 128 × 128`,
    cc.g.nx === cc.NX && cc.g.ny === cc.NY && vierkant(cc.NX, cc.NY) && Math.abs(cc.NX * cc.NY / 128 ** 2 - 1) < 0.02 && !cc.g.oud);

  // Boids zoekt buren in vakken. Dat moet precies dezelfde buren geven als
  // alle paren aflopen, zoals het origineel (ook niet over de rand heen).
  const sysBd = SYSTEEM.bd;
  const allePaar = (s, p) => {
    const n = s.n, v2 = p.vis * p.vis, sd = (p.vis * 0.45) ** 2, vx2 = Float32Array.from(s.vx), vy2 = Float32Array.from(s.vy);
    for (let i = 0; i < n; i++) {
      let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, c = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i], d2 = dx * dx + dy * dy;
        if (d2 < v2) { cx += s.x[j]; cy += s.y[j]; ax += vx2[j]; ay += vy2[j]; c++; if (d2 < sd && d2 > 0) { sx -= dx / d2; sy -= dy / d2; } }
      }
      let vx = vx2[i], vy = vy2[i];
      if (c) { vx += ((ax / c) - vx) * 0.05 * p.ali + ((cx / c) - s.x[i]) * 0.0012 * p.coh; vy += ((ay / c) - vy) * 0.05 * p.ali + ((cy / c) - s.y[i]) * 0.0012 * p.coh; }
      vx += sx * p.sep * 0.9; vy += sy * p.sep * 0.9;
      const sp = Math.hypot(vx, vy) || 1, cl = Math.max(1, Math.min(2.6, sp));
      vx2[i] = vx / sp * cl; vy2[i] = vy / sp * cl;
    }
    return { vx: vx2, vy: vy2 };
  };
  let slechtst = 0, rand = 0;
  for (const vis of [10, 23.5, 38, 90]) {
    const { s, p } = start('bd', { vis });
    const gg = { ...g, pal: sysBd.pal, L: LUTS[sysBd.pal] };
    for (let k = 0; k < 120; k++) {                  // zwermen laten vormen: vakken lopen vol
      const ref = allePaar(s, p);
      sysBd.step.call(sysBd, s, p, gg);
      for (let i = 0; i < s.n; i++) slechtst = Math.max(slechtst, Math.abs(ref.vx[i] - s.vx[i]), Math.abs(ref.vy[i] - s.vy[i]));
    }
    for (let i = 0; i < s.n; i++) if (s.x[i] < p.vis || s.x[i] > s.Wu - p.vis || s.y[i] < p.vis || s.y[i] > s.Hu - p.vis) rand++;
  }
  ok(`bd: buren via vakken = alle paren aflopen, bij zichtafstand 10, 23,5, 38 en 90 (grootste verschil ${slechtst.toExponential(1)})`, slechtst < 1e-5 && rand > 0);

  // fy: een ingezoomde zonnebloem. Welke zaden hij tekent, en hoeveel.
  {
    const sysFy = SYSTEEM.fy;
    const zaden = (p = {}, t = 1) => {
      const arcs = [];
      const doel = { createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }), arc: (x, y, r) => arcs.push([x, y, r]) };
      let aanroepen = 0;
      const ctx = new Proxy(doel, { get: (o, k) => (k in o ? (...a) => { aanroepen++; return o[k](...a); } : () => { aanroepen++; }), set: (o, k, v) => { o[k] = v; return true; } });
      const pp = { ...Object.fromEntries(sysFy.knobs.map((k) => [k.k, k.v])), ...p };
      sysFy.step.call(sysFy, {}, pp, { ...g, ctx, t, pal: sysFy.pal, L: LUTS[sysFy.pal] });
      return { arcs, aanroepen, c: H * sysFy.DICHT / Math.sqrt(pp.n | 0) };
    };
    const { arcs, c } = zaden();
    ok(`fy: alleen zaden die (deels) in beeld vallen worden getekend (${arcs.length})`,
      arcs.length > 1000 && arcs.every(([x, y, r]) => x + r >= 0 && x - r <= W && y + r >= 0 && y - r <= H));
    // Geen rand en geen lege strook: met de gulden hoek zelf (drift 0; met
    // drift ontstaan armen met ruimte ertussen, zoals altijd) heeft elk punt
    // van het doek, ook de vier hoeken, een zaad binnen 1,7 zaadafstand (een
    // zaad heeft ~π c²; langs de rand vallen zaden net buiten beeld weg).
    const gulden = zaden({ dr: 0 }, 1).arcs;
    const dichtste = (px, py) => Math.min(...gulden.map(([x, y]) => Math.hypot(x - px, y - py)));
    const punten = [[0, 0], [W, 0], [0, H], [W, H]];
    for (let y = 0; y <= H; y += 24) for (let x = 0; x <= W; x += 32) punten.push([x, y]);
    const gat = Math.max(...punten.map(([x, y]) => dichtste(x, y)));
    ok(`fy: de spiraal loopt door tot in de hoeken, zonder rand of gat (verste punt ${(gat / c).toFixed(2)} zaadafstand van een zaad)`, gat < 1.7 * c);
    const hoek = arcs.filter(([x, y]) => Math.hypot(x - W / 2, y - H / 2) > Math.hypot(W, H) / 2 - 3 * c);
    const binnen = arcs.filter(([x, y]) => Math.hypot(x - W / 2, y - H / 2) < 3 * c);
    ok('fy: de zaden groeien naar de hoeken toe (de rand van de bloem ligt daar)',
      hoek.length && binnen.length && Math.min(...hoek.map((a) => a[2])) > 2 * Math.max(...binnen.map((a) => a[2])));
    // Rekentijd: tekenaanroepen hooguit 16/9 × die van het oude vierkant met
    // dezelfde knoppen (daar tekende hij n − 1 zaden van 3 aanroepen, plus
    // clear), over het hele bereik van zaden en zaadgrootte. Speling van 16
    // zaden: bij de kleinste n en de grootste zaden tellen de halve zaden
    // langs de rand zwaar mee (×1,8 van een paar honderd aanroepen).
    const slechtst = [];
    for (const n of [100, 400, 1400, 3000]) for (const sz of [0.3, 1, 2]) for (const t of [0, 3, 6.3]) {
      const oud = 3 * (n - 1) + 1, nieuw = zaden({ n, sz }, t).aanroepen;
      slechtst.push({ n, sz, t, x: nieuw / oud, over: nieuw - 16 / 9 * oud });
    }
    const erg = slechtst.reduce((a, b) => (b.over > a.over ? b : a));
    ok(`fy: over het hele bereik (n 100–3000, zaadgrootte 0,3–2) hooguit 16/9 × de tekenaanroepen van het oude vierkant (slechtst ×${erg.x.toFixed(2)} bij n ${erg.n}, zaadgrootte ${erg.sz})`,
      erg.over <= 3 * 16);
    const std = slechtst.find((r) => r.n === 1400 && r.sz === 1 && r.t === 0);
    ok(`fy: op de standaard (1400 zaden) ×${std.x.toFixed(2)}`, std.x < 16 / 9);
  }

  // fl luistert naar g.kwaliteit: alleen de eerste n · kwaliteit deeltjes
  // bewegen en tekenen, even snel; de rest ligt stil.
  {
    const sysFl = SYSTEEM.fl;
    const draai = (kw, stappen = 30) => {
      let lijnen = 0;
      const doel = { createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }), lineTo: () => { lijnen++; } };
      const ctx = new Proxy(doel, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
      const { s, p } = start('fl');
      const gg = { ...g, ctx, pal: sysFl.pal, L: LUTS[sysFl.pal], r: maakRng(7), kwaliteit: kw };
      const x0 = Float32Array.from(s.x), y0 = Float32Array.from(s.y);
      let stap = 0, snel = 0, gemeten = 0;
      for (let k = 0; k < stappen; k++) {
        gg.t = ++stap / 60; lijnen = 0;
        sysFl.step.call(sysFl, s, p, gg);
        for (let i = 0; i < Math.round(s.n * (kw ?? 1)); i += 97) {    // alleen wie beweegt
          const d = Math.hypot(s.x[i] - s.ox[i], s.y[i] - s.oy[i]);
          if (d > 0 && d < 10) { snel += d; gemeten++; }
        }
      }
      let stil = 0;
      for (let i = 0; i < s.n; i++) if (s.x[i] === x0[i] && s.y[i] === y0[i]) stil++;
      return { lijnen, stil, n: s.n, snel: snel / gemeten, p };
    };
    const vol = draai(1), kwart = draai(0.25), zonder = draai(undefined);
    ok(`fl kwaliteit 1: alle ${vol.n} deeltjes bewegen en tekenen`, vol.lijnen === vol.n && vol.stil === 0 && zonder.lijnen === vol.n);
    ok(`fl kwaliteit 0,25: een kwart tekent (${kwart.lijnen}), de rest ligt stil (${kwart.stil})`,
      kwart.lijnen === Math.round(vol.n * 0.25) && kwart.stil === vol.n - kwart.lijnen);
    ok(`fl: even snel op elke kwaliteit (${vol.snel.toFixed(3)} en ${kwart.snel.toFixed(3)} eenheden per stap = snelheid ${vol.p.sp})`,
      bij(vol.snel, vol.p.sp, 1e-3) && bij(kwart.snel, vol.p.sp, 1e-3));
  }

  // Rekentijd: wat met het doek meegroeit, groeit hooguit met de oppervlakte
  // (16/9). Tekenaanroepen per stap op het oude vierkant (360 × 360, zaad 7,
  // na 60 stappen), gemeten op 3ca17ea vóór de omzetting.
  const VIERKANT = { lz: 113, hg: 6019, bd: 681, fl: 4409, sf: 7603, ec: 1, cc: 1, km: 363, dp: 271, fy: 4198 };
  const { BUDGET_HOOFD } = await import('../src/vormen/budget.js');
  // Telt tekenaanroepen zoals maakCanvas, maar met één gedeelde functie: geen
  // nieuwe closure per aanroep, zodat de meting over het systeem gaat.
  const snelCanvas = (w, h) => {
    const tel = { n: 0 }, tik = () => { tel.n++; };
    const doel = { createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }) };
    const ctx = new Proxy(doel, { get: (t, k) => (k in t ? t[k] : tik), set: (t, k, v) => { t[k] = v; return true; } });
    return { width: w, height: h, getContext: () => ctx, tel };
  };
  const meet = (id) => {
    const sys = SYSTEEM[id], c = snelCanvas(W, H), { s, p } = start(id);
    const gg = { ...g, ctx: c.getContext('2d'), pal: sys.pal, L: LUTS[sys.pal], r: maakRng(7) };
    let i = 0;
    const stap = () => { gg.t = ++i / 60; s.e = {}; sys.step.call(sys, s, p, gg); };
    for (let k = 0; k < 60; k++) stap();
    const n0 = c.tel.n, ts = [];
    for (let k = 0; k < 100; k++) { const t0 = draadMs(); stap(); ts.push(draadMs() - t0); }
    ts.sort((a, b) => a - b);
    return { aanroepen: (c.tel.n - n0) / 100, med: ts[50] };
  };
  const regels = [];
  const teVeel = [], teTraag = [];
  for (const id of lichte) {
    let m = meet(id);
    for (let poging = 1; poging < 3 && m.med >= BUDGET_HOOFD; poging++) { const m2 = meet(id); if (m2.med < m.med) m = m2; }
    regels.push(`${id} ${m.med.toFixed(2)} ms ×${(m.aanroepen / VIERKANT[id]).toFixed(2)}`);
    if (m.aanroepen > VIERKANT[id] * 16 / 9 + 0.5) teVeel.push(id);
    if (m.med >= BUDGET_HOOFD) teTraag.push(id);
  }
  console.log(`      ${regels.join(' · ')}`);
  ok('tekenaanroepen per stap hooguit 16/9 × die op het oude vierkant', teVeel.length === 0);
  if (teVeel.length) console.log('      te veel:', teVeel.join(', '));
  ok(`en elk licht systeem rekent een stap in minder dan het budget van de hoofdthread (${BUDGET_HOOFD} ms, zonder echt tekenen)`, teTraag.length === 0);
  if (teTraag.length) console.log('      te traag:', teTraag.join(', '));
}

console.log('tijd: stappen van 1/60 s op de audioklok (regel 3)');
{
  const laag = new VormLaag({ maakCanvas, systeem: 'lz' });
  let n = 0;
  const echt = laag._stap.bind(laag);
  const tijden = [];
  laag._stap = (t) => { n++; tijden.push(t); echt(t); };
  laag.frame(10);
  ok('eerste frame: één stap', n === 1);
  laag.frame(10 + STAP * 0.5);
  ok('nog geen 1/60 s verder: geen stap', n === 1);
  laag.frame(10 + STAP * 1.01);
  ok('1/60 s verder: één stap', n === 2);
  laag.frame(10 + STAP * 3.02);
  ok('op 30 fps: twee stappen per beeld, dus even snel', n === 4);
  ok('en de tijd van elke stap klopt', bij(tijden[3], 10 + STAP * 3, 1e-9) && bij(tijden[2], 10 + STAP * 2, 1e-9));
  const voor = n;
  laag.frame(10 + 0.5);
  ok(`een hapering van een halve seconde: hooguit ${MAX_STAPPEN} stappen, niet inhalen`, n - voor === MAX_STAPPEN);
  laag.frame(10 + 0.5 + STAP * 1.01);
  ok('daarna gewoon verder vanaf nu', n - voor === MAX_STAPPEN + 1);
  const v2 = n;
  laag.frame(3);
  ok('terug in de tijd (nieuwe AudioContext): opnieuw ijken, één stap', n - v2 === 1);
  const v3 = n;
  laag.frame(3); laag.frame(3);
  ok('stilstaande klok (audio nog niet gestart): stilstaand beeld', n === v3);
}

console.log('knoppen: 0..1 in, de engine schaalt (regel 2)');
{
  const laag = new VormLaag({ maakCanvas, systeem: 'bd' });
  const k = laag.knoppen[3];                     // zichtafstand 10..90, stap 1
  ok('de beginstand is de standaard van het systeem', bij(laag.leesKnop(3), (38 - 10) / 80) && laag.p.vis === 38);
  laag.zetKnop(3, 0); ok('0 = minimum', laag.p.vis === k.min);
  laag.zetKnop(3, 1); ok('1 = maximum', laag.p.vis === k.max);
  laag.zetKnop(3, 0.5031); ok('afgerond op de stap van het systeem', laag.p.vis === 50 && bij(laag.leesKnop(3), 0.5031));
  laag.zetKnop(3, 7); ok('buiten 0..1 wordt geklemd', laag.leesKnop(3) === 1 && laag.p.vis === 90);
  ok('een knop die er niet is: null, en zetten doet niets', laag.leesKnop(5) === null && (laag.zetKnop(5, 1), true));
  laag.zetSysteem('hg');
  ok('ander systeem: eigen knoppen en standaarden', laag.knoppen[0].k === 'a' && laag.p.a === 3);
  const ctx = laag.canvas.getContext('2d');
  laag.zetSysteem('lz'); laag.frame(0);
  const rond = ctx.lineCap === 'round';
  laag.zetSysteem('fl');
  ok('een ander systeem begint met een schone context (geen ronde kappen van lz in fl)', rond && ctx.lineCap === 'butt' && ctx.globalAlpha === 1 && ctx.imageSmoothingEnabled === true);
}

console.log('twee lagen, één gekozen');
{
  const v = new VormLagen({ maakCanvas });
  let wissels = 0;
  v.on('change', () => wissels++);
  ok(`${MAX_BEELDLAGEN} lagen, met een verschillende vorm`, v.lagen.length === MAX_BEELDLAGEN && v.lagen[0].sys.id !== v.lagen[1].sys.id);
  ok('beginnen uit (niets verandert aan het beeld tot je hem aanzet)', v.lagen.every((l) => !l.aan));
  v.kies(1); ok('kiezen', v.gekozen === 1 && v.laag === v.lagen[1]);
  v.kies(2); ok('voorbij de laatste: rond naar de eerste', v.gekozen === 0);
  v.kies(-1); ok('vóór de eerste: de laatste', v.gekozen === 1);
  const was = v.laag.sys.id;
  v.stapSysteem(1); const volgende = v.laag.sys.id;
  v.stapSysteem(-1);
  ok('bladeren door de vormen, en terug', volgende !== was && v.laag.sys.id === was);
  v.stapSysteem(-1); v.stapSysteem(-SYSTEMEN.length + 1);
  ok('rondlopen over alle vormen', SYSTEMEN.some((s) => s.id === v.laag.sys.id));
  ok('elke wissel meldt zich (voor het scherm)', wissels >= 5);
}

console.log('op de action-bus');
{
  const v = new VormLagen({ maakCanvas });
  const { Router } = await import('../src/analysis/router.js');
  actions.bindVormen(v, new Router(v.lagen.length));   // met router: ook video.layer.react (device knob 8)
  actions.invoke('video.layer.knob.1', 0);
  ok('knop 1 werkt op de gekozen laag', v.lagen[0].leesKnop(0) === 0 && actions.read('video.layer.knob.1') === 0);
  actions.invoke('video.layer.select.next', true); actions.invoke('video.layer.select.next', false);
  ok('Bank ▶: de volgende laag', v.gekozen === 1 && actions.read('video.layer.select.2') === 1 && actions.read('video.layer.select.1') === 0);
  actions.invoke('video.layer.knob.1', 1);
  ok('en dan werken de knoppen daarop', v.lagen[1].leesKnop(0) === 1 && v.lagen[0].leesKnop(0) === 0);
  actions.invoke('video.layer.on', true); actions.invoke('video.layer.on', false);
  ok('On/Off: aan bij indrukken, loslaten doet niets', v.lagen[1].aan && actions.read('video.layer.on') === 1);
  actions.invoke('video.layer.opacity', 0.3);
  ok('dekking', bij(v.lagen[1].dekking, 0.3) && bij(actions.read('video.layer.opacity'), 0.3));
  const id = v.laag.sys.id;
  actions.invoke('video.layer.next', true);
  ok('Device ▶: volgende vorm', v.laag.sys.id !== id);
  actions.invoke('video.layer.blend', true);
  ok('mengvorm: screen → add', v.laag.mengvorm === 'add');
  ok('knop 6 op een vorm met minder knoppen: read null (lampje uit), geen fout',
    (v.zetSysteem('ec'), actions.read('video.layer.knob.6') === null) && actions.invoke('video.layer.knob.6', 0.5));
  ok('elke knop-action is een value, elke keuze een trigger',
    actions.metaOf('video.layer.knob.3').type === 'value' && actions.metaOf('video.layer.on').type === 'trigger');
}

console.log('het mappingfragment voor de APC');
{
  const { Lagen, GROEPEN, voegVormMapjeToe } = await import('../src/control/lagen.js');
  ok('zonder vlag bestaat het mapje vorm niet (geen action, geen lege rij op apc.html)', !GROEPEN.device.knoppen.detail);
  voegVormMapjeToe();                            // wat opzetVormen doet, vóór bindLagen
  actions.bindLagen(new Lagen());
  const frag = JSON.parse(readFileSync(new URL('../mappings/apc40mk2-vormen.json', import.meta.url), 'utf8'));
  const std = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
  ok('elke action in het fragment bestaat op de bus', frag.rules.every((r) => actions.has(r.action)));
  const buiten = frag.rules.filter((r) => r.laag !== 'device.vorm');
  ok('alleen Detail View staat buiten het mapje (om het te openen)', buiten.length === 1 && buiten[0].in === 'note:0:65' && buiten[0].action === 'layer.device.detail');
  const bezet = new Set(std.rules.map((r) => `${r.in}${r.shift ? '#shift' : ''}${r.laag ? `@${r.laag}` : ''}`));
  ok('het fragment overschrijft geen enkele regel van de standaardmapping', frag.rules.every((r) => !bezet.has(`${r.in}${r.laag ? `@${r.laag}` : ''}`)));
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const kaal = frag.rules.filter((r) => beschrijf(r.action).kort === r.action);
  ok('elke action in het fragment heeft een uitleg voor het scherm en de APC-kaart', kaal.length === 0);
  if (kaal.length) console.log('      zonder uitleg:', kaal.map((r) => r.action).join(', '));
  // Shift + Detail View is sinds 6 okt het mapje beeld (spoor beeld): een shift-regel,
  // dus Detail View zelf (zonder shift, wat het fragment gebruikt) blijft vrij.
  ok('Detail View (zonder shift) was vrij in de standaardmapping; met shift is het het mapje beeld',
    !std.rules.some((r) => r.in === 'note:0:65' && !r.shift)
    && std.rules.filter((r) => r.in === 'note:0:65').every((r) => r.shift && !r.laag && r.action === 'layer.device.beeld'));
  ok('device knobs 1–6 = vorm, 7 = dekking, endless (geen overpakken)',
    [16, 17, 18, 19, 20, 21].every((cc, i) => frag.rules.some((r) => r.in === `cc:0:${cc}` && r.action === `video.layer.knob.${i + 1}` && r.mode === 'endless'))
    && frag.rules.some((r) => r.in === 'cc:0:22' && r.action === 'video.layer.opacity' && r.mode === 'endless'));
}

console.log('de mixer: lagen tussen mengen en effecten');
{
  const lagen = [{ aan: true, dekking: 0.5, mengvorm: 'add' }, { aan: false, dekking: 1 }, { aan: true, dekking: 0.001 }, { aan: true, dekking: 1, mengvorm: 'multiply' }, { aan: true, dekking: 1 }];
  const act = actieveLagen(lagen);
  ok(`alleen lagen die aan staan en te zien zijn, hooguit ${MAX_BEELDLAGEN}`, act.length === 2 && act[0] === lagen[0] && act[1] === lagen[3]);
  const u = lagenUniforms(act, [[512, 512], [512, 512]], 1280, 720);
  ok('een vierkant VULT 16:9 (Clay 24 sep): schaal [1, 9/16]', LAAG_FIT === 'vullen' && bij(u.s[0], 1) && bij(u.s[1], 9 / 16, 1e-6));
  const hoek = [[0, 0], [1, 0], [0, 1], [1, 1], [0.001, 0.5], [0.999, 0.5]].map(([x, y]) => leesLaag(x, y, [u.s[0], u.s[1]]).binnen);
  ok('geen lege banden: elke hoek en rand van het doek valt binnen de vorm', hoek.every((b) => b === 1));
  const boven = leesLaag(0.5, 0, [u.s[0], u.s[1]]), onder = leesLaag(0.5, 1, [u.s[0], u.s[1]]);
  ok(`boven en onder valt elk 22% weg (zichtbaar ${boven.y.toFixed(3)}–${onder.y.toFixed(3)})`, bij(boven.y, (1 - 9 / 16) / 2, 1e-6) && bij(onder.y, 1 - (1 - 9 / 16) / 2, 1e-6));
  const breed = lagenUniforms(act, [[1280, 720], [912, 512]], 1280, 720);
  ok('een laag die al 16:9 is blijft 1:1', bij(breed.s[0], 1) && bij(breed.s[1], 1) && Math.abs(breed.s[2] - 1) < 0.01 && Math.abs(breed.s[3] - 1) < 0.01);
  const { maatVan } = await import('../src/video/passen.js');
  const echt = new VormLaag({ maakCanvas, systeem: 'lz' });
  const [lb, lh] = maatVan(echt.frame(0));
  const eigen = lagenUniforms([{ aan: true, dekking: 1 }], [[lb, lh]], 1280, 720);
  ok(`een vormlaag (${lb} × ${lh}) past precies: schaal [1, 1], niets valt weg, niets extra opgeschaald`,
    lb === 640 && lh === 360 && eigen.s[0] === 1 && eigen.s[1] === 1);
  const hoeken = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => leesLaag(x, y, [eigen.s[0], eigen.s[1]]));
  ok('de hoeken van het doek zijn de hoeken van de vorm', hoeken.every((h, i) => h.binnen === 1 && h.x === [0, 1, 0, 1][i] && h.y === [0, 0, 1, 1][i]));
  ok('dekking en mengvorm per laag', bij(u.a[0], 0.5, 1e-6) && u.m[0] === 1 && u.m[1] === 2);
  ok('lege plek: dekking 0', lagenUniforms([], [], 1280, 720).a.every((x) => x === 0));

  // Nep-WebGL: onthoudt welke texture waar hangt en wat er getekend wordt.
  let id = 0;
  const log = [];
  const gebonden = {};
  let unit = 0, prog = null;
  const gl = new Proxy({
    TEXTURE0: 1000, TEXTURE1: 1001, TEXTURE_2D: 1, FRAMEBUFFER: 2, ARRAY_BUFFER: 3,
    createTexture: () => ({ tex: ++id }), createFramebuffer: () => ({ fb: ++id }), createProgram: () => ({ prog: ++id }),
    createShader: () => ({ sh: ++id }), getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    activeTexture: (u) => { unit = u - 1000; },
    bindTexture: (_, t) => { gebonden[unit] = t; },
    useProgram: (p) => { prog = p; },
    texImage2D: (...a) => { log.push({ upload: a[a.length - 1], unit }); },
    drawArrays: () => { log.push({ draw: prog, t0: gebonden[0] }); },
  }, { get(t, k) { if (k in t) return t[k]; return () => {}; } });
  const engine = { ctx: { currentTime: 2, outputLatency: 0, baseLatency: 0 }, deck: () => ({ buffer: null, ui: { fader: 0 } }), xfadeGain: () => 0 };
  const mixer = new VideoMixer({ canvas: { getContext: () => gl }, engine, decks: ['A', 'B'] });
  ok('zonder beeldlagen geen lagenprogramma en geen extra doek (niets extra te compileren)', !mixer.fout && !mixer.lagenProg && !mixer.gelaagd);

  log.length = 0;
  mixer.teken();
  const zonder = log.filter((l) => l.draw);
  ok('zonder beeldlagen: drie stappen zoals altijd, en de effecten lezen het gemengde beeld',
    zonder.length === 3 && zonder[1].draw === mixer.effect && zonder[1].t0 === mixer.gemengd.tex && !mixer.gelaagd);

  const v = new VormLagen({ maakCanvas });
  v.lagen.forEach((l) => mixer.voegBeeldlaagToe(l));
  log.length = 0;
  mixer.teken();
  ok('lagen toegevoegd: programma, doek en texturen één keer, buiten teken()', mixer.lagenProg && mixer.gelaagd && mixer.laagTex.length === MAX_BEELDLAGEN);
  ok('maar uit: nog steeds bit voor bit de oude weg', log.filter((l) => l.draw).length === 3);

  v.lagen[0].aan = true;
  log.length = 0;
  mixer.teken();
  const met = log.filter((l) => l.draw);
  ok('één laag aan: vier stappen, lagen tussen mengen en effecten',
    met.length === 4 && met[0].draw === mixer.meng && met[1].draw === mixer.lagenProg && met[2].draw === mixer.effect);
  ok('de lagenstap leest het gemengde beeld, de effecten lezen het gelaagde', met[1].t0 === mixer.gemengd.tex && met[2].t0 === mixer.gelaagd.tex);
  ok('het canvas van de vorm gaat als texture de kaart op', log.some((l) => l.upload === v.lagen[0].canvas && l.unit === 1));
  ok('de vorm kreeg de tijd van de audioklok', bij(v.lagen[0].g.t, 2));
  engine.ctx.outputLatency = 0.05;
  v.lagen[0].frame = function (t) { this.gekregen = t; return this.canvas; };
  mixer.teken();
  ok('op wat je HOORT: min de uitgangsvertraging', bij(v.lagen[0].gekregen, 1.95));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
