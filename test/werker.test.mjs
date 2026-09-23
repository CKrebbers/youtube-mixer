// Vormlagen in een Worker, met een tijdsbudget in ms. Zonder browser: de
// Worker-logica (draaiWerker) draait in dit proces achter een nep-Worker die
// net zo streng is als de echte waar het ertoe doet: berichten komen
// ASYNCHROON aan, worden gekloond (een functie meesturen gooit), en een
// gesloten ImageBitmap heeft maat 0.
// Draai met: node test/werker.test.mjs

const { Budget, BUDGET_HOOFD, BUDGET_WERKER, KWALITEIT_MIN, KWALITEIT_STAP, VER } = await import('../src/vormen/budget.js');
const { VormLaag, VormLagen, STAP, kanWerker } = await import('../src/vormen/laag.js');
const { draaiWerker } = await import('../src/vormen/werker.js');
const { SYSTEMEN, SYSTEEM } = await import('../src/vormen/systemen.js');
const { VideoMixer } = await import('../src/video/video-mixer.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const even = (ms = 5) => new Promise((r) => setTimeout(r, ms));
/** Wachten tot iets waar is (hooguit een halve seconde): timers lopen onder last uit. */
async function wachtTot(f, max = 500) { for (let t = 0; t < max && !f(); t += 2) await even(2); }

// ---- nep-canvas (zoals vormen.test) ---------------------------------------
function maakCanvas(w, h) {
  const tel = { n: 0 };
  const ctx = new Proxy({ createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }), tel }, {
    get(t, k) { if (k in t) return t[k]; return () => { tel.n++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, tel };
}

// ---- nep-ImageBitmap: close() maakt hem leeg, zoals in de browser ----------
let bitmaps = 0;
class NepBitmap {
  constructor(bron) { this.width = bron.width; this.height = bron.height; this.nr = ++bitmaps; this.gesloten = false; }
  close() { this.gesloten = true; this.width = 0; this.height = 0; }
}
const maakBitmap = (c) => Promise.resolve(new NepBitmap(c));

// ---- nep-klok om te METEN: een systeem "kost" tijd door hem door te zetten --
const klok = { ms: 0 };
const nu = () => klok.ms;

// Een testsysteem dat zegt wat het kost: kost × kwaliteit ms per stap. Zo is
// de regeling een gesloten lus, net als met een echt zwaar systeem.
const proef = {
  id: 'zz', naam: 'Proef', sub: '', cat: 'Test', pal: 'fosfor', kost: 1,
  knobs: [{ k: 'a', l: 'a', min: 0, max: 10, step: 1, v: 5 }, { k: 'b', l: 'b', min: 0, max: 1, step: 0.01, v: 0.5 }],
  init(s, p, g) { s.gezien = []; this.laatsteG = g; this.laatsteS = s; },
  step(s, p, g) { klok.ms += this.kost * g.kwaliteit; s.gezien.push({ t: g.t, a: p.a, k: g.kwaliteit }); },
};
// Later toegevoegd, na het laden van systemen.js: doet vanzelf mee.
SYSTEMEN.push(proef);
SYSTEEM.zz = proef;

// ---- nep-Worker: draaiWerker in dit proces, berichten async en gekloond -----
function kloon(data, transfer = []) {
  // Wat overgedragen wordt gaat als verwijzing mee, de rest wordt gekloond:
  // een functie of klasse-instantie erin laat structuredClone gooien/strippen.
  if (!data || typeof data !== 'object') return structuredClone(data);
  const los = {}, kaal = {};
  for (const [k, v] of Object.entries(data)) (transfer.includes(v) ? los : kaal)[k] = v;
  return { ...structuredClone(kaal), ...los };
}
function nepWerker({ vertraging = 0, logboek = [] } = {}) {
  const buiten = { h: {} }, binnen = { h: {} };
  const bezorg = (kant, data) => setTimeout(() => (kant.h.message || []).forEach((f) => f({ data })), vertraging);
  const zelf = {
    addEventListener: (s, f) => { (binnen.h[s] ||= []).push(f); },
    postMessage: (data, transfer) => { logboek.push({ van: 'werker', ...data }); bezorg(buiten, kloon(data, transfer)); },
  };
  let dood = false;
  const w = {
    addEventListener: (s, f) => { (buiten.h[s] ||= []).push(f); },
    postMessage: (data) => { if (dood) throw new Error('Worker is gestopt'); logboek.push({ van: 'hoofd', ...data }); bezorg(binnen, kloon(data)); },
    terminate: () => { dood = true; buiten.h = {}; },
    vuurFout: (message) => (buiten.h.error || []).forEach((f) => f({ message, preventDefault() {} })),
    logboek, zelf,
  };
  draaiWerker(zelf, { maakCanvas, maakBitmap, nu });
  return w;
}

console.log('budget: EMA, stapjes, noodrem (nep-klok: gewoon getallen)');
{
  const b = new Budget({ ms: 4 });
  ok('begint op kwaliteit 1, zonder meting', b.kwaliteit === 1 && b.ema === null);
  b.meet(2);
  ok('eerste meting = EMA', b.ema === 2);
  b.meet(6);
  ok('daarna een voortschrijdend gemiddelde (alfa 0,25)', bij(b.ema, 3));
  let r;
  for (let i = 0; i < 4; i++) r = b.meet(6);
  ok('boven budget: één stapje omlaag', b.kwaliteit === 1 - KWALITEIT_STAP && r.kwaliteit === b.kwaliteit);
  const na = b.kwaliteit;
  for (let i = 0; i < 3; i++) b.meet(6);
  ok('en dan eerst een paar beelden rust (de EMA moet de nieuwe stand zien)', b.kwaliteit === na);
  for (let i = 0; i < 200; i++) b.meet(6);
  ok(`blijft hij te zwaar: niet lager dan ${KWALITEIT_MIN}, en dat staat erbij (teZwaar)`, b.kwaliteit === KWALITEIT_MIN && b.teZwaar);

  const c = new Budget({ ms: 4, kwaliteit: KWALITEIT_MIN });
  let omhoog = 0, wissels = 0;
  for (let i = 0; i < 400; i++) {
    const kost = 1.5 * c.kwaliteit;        // lineair in kwaliteit: 1,5 ms op vol, ruim onder budget
    const v = c.kwaliteit;
    c.meet(kost);
    if (c.kwaliteit > v) omhoog++;
    if (c.kwaliteit !== v) wissels++;
  }
  ok('ruim eronder: stap voor stap terug naar 1', c.kwaliteit === 1 && omhoog === 6);
  ok('en daar blijft hij (geen pendelen)', wissels === 6);

  const d = new Budget({ ms: 4 });
  const e = new Budget({ ms: 4 });
  for (let i = 0; i < 60; i++) { d.meet(i % 3 === 2 ? 5 : 3); e.meet(4.5); }
  ok('rond het budget: een losse uitschieter doet niets, structureel erboven wel',
    d.kwaliteit === 1 && e.kwaliteit < 1);

  const f = new Budget({ ms: 4 });
  const ver = 4 * VER + 1;
  const r1 = f.meet(ver), r2 = f.meet(ver);
  ok('twee beelden ver over budget: nog geen noodrem', !r1.noodrem && !r2.noodrem && f.kwaliteit === 1);
  f.meet(1);
  const tussen = [f.meet(ver), f.meet(ver)];
  ok('een goed beeld ertussen: de telling begint opnieuw', tussen.every((x) => !x.noodrem) && f.kwaliteit > KWALITEIT_MIN);
  const r3 = f.meet(ver);
  ok(`drie achter elkaar ver over budget: NOODREM, meteen naar ${KWALITEIT_MIN}`, r3.noodrem && r3.veranderd && f.kwaliteit === KWALITEIT_MIN);
  const nog = [f.meet(ver), f.meet(ver), f.meet(ver)];
  ok('stond hij al op de laagste stand: geen tweede melding, wel teZwaar', nog.every((x) => !x.noodrem) && f.teZwaar);
  f.zet(0.8);
  ok('met de hand zetten mag (geklemd)', f.kwaliteit === 0.8 && (f.zet(0), f.kwaliteit === KWALITEIT_MIN));
  ok(`budgetten: hoofdthread streng (${BUDGET_HOOFD} ms), Worker ruimer (${BUDGET_WERKER} ms)`, BUDGET_HOOFD < BUDGET_WERKER && BUDGET_WERKER < 16.7);
}

console.log('hoofd-modus: meten met de nep-klok, g.kwaliteit volgt');
{
  ok('in Node is er geen Worker: standaard de hoofdthread', !kanWerker() && new VormLaag({ maakCanvas }).modus === 'hoofd');
  proef.kost = 10;                           // 10 ms per stap op kwaliteit 1: ver over 4
  const laag = new VormLaag({ maakCanvas, systeem: 'zz', nu, werker: false });
  let noodrem = null;
  laag.on('noodrem', (x) => { noodrem = x; });
  for (let i = 0; i < 3; i++) laag.frame(i * STAP);
  ok('gemeten per beeld: de rekentijd staat erbij', laag.ms > 4);
  ok('drie beelden ver over budget: noodrem-event en kwaliteit 0,25 (niet uit)',
    noodrem && noodrem.systeem === 'zz' && noodrem.budget === BUDGET_HOOFD && laag.kwaliteit === KWALITEIT_MIN && laag.g.kwaliteit === KWALITEIT_MIN);
  laag.frame(3 * STAP);
  ok('het systeem ziet de nieuwe kwaliteit op g.kwaliteit', laag.s.gezien.at(-1).k === KWALITEIT_MIN);

  proef.kost = 1.5;                          // licht: hij mag terug omhoog
  for (let i = 4; i < 600; i++) laag.frame(i * STAP);
  ok('ruim onder budget: terug naar volle kwaliteit', laag.kwaliteit === 1 && laag.g.kwaliteit === 1);

  proef.kost = 6;                            // net te zwaar: stapjes, geen noodrem
  noodrem = null;
  for (let i = 600; i < 700; i++) laag.frame(i * STAP);
  ok('iets te zwaar: in stapjes omlaag tot hij past, zonder noodrem',
    !noodrem && laag.kwaliteit < 1 && laag.kwaliteit > KWALITEIT_MIN && laag.ms <= 4.2);

  const k = laag.kwaliteit;
  laag.zetSysteem('lz');
  ok('ander systeem: nieuwe meting, begint op 1', laag.kwaliteit === 1 && laag.ms === null);
  laag.zetSysteem('zz');
  ok('terug naar het vorige: begint op wat hij toen haalde', laag.kwaliteit === k && laag.g.kwaliteit === k);
  laag.zetKwaliteit(0.5);
  ok('kwaliteit met de hand', laag.kwaliteit === 0.5 && laag.g.kwaliteit === 0.5);

  // Stappen van 1/60 s blijven gelden: één meting per beeld, ook bij twee stappen.
  proef.kost = 1;
  const l2 = new VormLaag({ maakCanvas, systeem: 'zz', nu, werker: false });
  l2.frame(1); l2.frame(1 + 2.02 * STAP);
  ok('op 30 fps: twee stappen in één beeld, samen gemeten', l2.s.gezien.length === 3 && bij(l2.budget.ema, 1.25));
  const voor = l2.versie;
  l2.frame(1 + 2.5 * STAP);
  ok('geen stap = geen meting en geen nieuwe versie', l2.versie === voor);
}

console.log('de Worker-logica als functie (draaiWerker met een nep-self)');
{
  proef.kost = 1;
  const post = [];
  const h = {};
  const zelf = { addEventListener: (s, f) => { h[s] = f; }, postMessage: (m, tr) => post.push({ m, tr }) };
  draaiWerker(zelf, { maakCanvas, maakBitmap, nu });
  const stuur = (m) => h.message({ data: m });
  stuur({ type: 'frame', t: 0 });
  ok('frame vóór kies: toch een antwoord (anders wacht de hoofdthread eeuwig)', post.at(-1).m.type === 'beeld' && post.at(-1).m.bitmap === null);
  stuur({ type: 'kies', systeem: 'zz', zaad: 3, maat: 256, budgetMs: 12, kwaliteit: 1 });
  stuur({ type: 'params', p: { a: 9, onzin: 1 } });
  stuur({ type: 'frame', t: 5 });
  await even();
  const b = post.at(-1);
  ok('frame: een beeld terug als ImageBitmap, overgedragen (transfer)', b.m.type === 'beeld' && b.m.bitmap instanceof NepBitmap && b.tr?.[0] === b.m.bitmap);
  ok('van de juiste maat', b.m.bitmap.width === 256);
  ok('de parameter kwam aan (het systeem rekende met a = 9)', proef.laatsteS.gezien.at(-1).a === 9);
  ok('met rekentijd en kwaliteit erbij', typeof b.m.ms === 'number' && b.m.kwaliteit === 1);
  const n = post.length;
  stuur({ type: 'frame', t: 5 + STAP * 0.4 });
  await even();
  ok('geen stap nodig: antwoord zonder bitmap (geen kopie voor niets)', post.length === n + 1 && post.at(-1).m.bitmap === null);
  stuur({ type: 'kwaliteit', v: 0.5 });
  stuur({ type: 'frame', t: 6 });
  await even();
  ok('kwaliteit met de hand komt bij het systeem', proef.laatsteG.kwaliteit === 0.5);
  proef.kost = 100;
  for (let i = 0; i < 3; i++) { stuur({ type: 'frame', t: 7 + i * STAP }); await even(); }
  ok('noodrem in de Worker wordt een bericht', post.some((p) => p.m.type === 'noodrem' && p.m.systeem === 'zz' && p.m.kwaliteit === KWALITEIT_MIN));
  proef.kost = 1;
  const echt = proef.step;
  proef.step = () => { throw new Error('kapot systeem'); };
  stuur({ type: 'frame', t: 9 });
  ok('een systeem dat gooit: een fout-bericht, de Worker blijft leven', post.at(-1).m.type === 'fout' && /kapot/.test(post.at(-1).m.bericht));
  proef.step = echt;
  stuur({ type: 'frame', t: 9.5 });
  await even();
  ok('en daarna gewoon verder', post.at(-1).m.type === 'beeld' && post.at(-1).m.bitmap);
  ok('alles wat terug gaat is kloonbaar (geen functies over de grens)', post.every((p) => { try { kloon(p.m, p.tr); return true; } catch (_) { return false; } }));
}

console.log('werker-modus: de hoofdthread wacht nooit');
{
  proef.kost = 1;
  let w = null;
  const laag = new VormLaag({ maakCanvas, systeem: 'zz', nu, werker: () => (w = nepWerker({ vertraging: 2 })) });
  ok('met een Worker: werker-modus, budget 12 ms', laag.modus === 'werker' && laag.budgetMs === BUDGET_WERKER);
  ok('het systeem draait NIET op de hoofdthread (geen s, geen g)', laag.s === undefined && laag.g === undefined);
  ok('maar knoppen lezen kan direct', laag.leesKnop(0) === 0.5 && laag.knoppen.length === 2);
  const eerste = laag.frame(1);
  ok('frame(t) geeft METEEN iets om te uploaden: het lege canvas', eerste === laag.canvas);
  const frames = () => w.logboek.filter((m) => m.van === 'hoofd' && m.type === 'frame').length;
  laag.frame(1 + STAP); laag.frame(1 + 2 * STAP);
  ok('zolang het antwoord er niet is: geen nieuwe verzoeken (geen rij)', frames() === 1);
  await wachtTot(() => laag.beeld);
  const beeld = laag.frame(1 + 3 * STAP);
  ok('antwoord binnen: frame geeft het ImageBitmap', beeld instanceof NepBitmap && beeld.width === 512 && !beeld.gesloten);
  ok('en vraagt het volgende', frames() === 2);
  await wachtTot(() => laag.beeld !== beeld);
  const tweede = laag.frame(1 + 4 * STAP);
  ok('een nieuw beeld sluit het oude (close), het nieuwe is heel', beeld.gesloten && tweede !== beeld && !tweede.gesloten);
  ok('rekentijd en kwaliteit komen mee terug voor het scherm', typeof laag.ms === 'number' && laag.kwaliteit === 1);

  laag.zetKnop(0, 1);
  await even(10);
  ok('knop draaien: de parameter gaat naar de Worker, in eigen eenheid', w.logboek.some((m) => m.type === 'params' && m.p.a === 10) && laag.p.a === 10);
  laag.zetParams({ b: 0.25, bestaatNiet: 3, a: NaN });
  ok('zetParams (de haak voor modulatie): alleen bekende namen en getallen', w.logboek.at(-1).type === 'params'
    && JSON.stringify(w.logboek.at(-1).p) === '{"b":0.25}');

  // De Worker krijgt de tijd vooruit: wat hij tekent komt een beeld later in beeld.
  for (let i = 5; i < 40; i++) { laag.frame(1 + i * STAP); await even(3); }
  ok('de Worker wordt vooruit gevraagd (antwoord komt een beeld later)', laag.vooruit > 0 && laag.vooruit < 0.25);
  const gestuurd = w.logboek.filter((m) => m.van === 'hoofd' && m.type === 'frame').map((m) => m.t);
  ok('gestuurde tijden lopen nooit terug', gestuurd.every((t, i) => i === 0 || t >= gestuurd[i - 1]));
  const tStil = 1 + 40 * STAP;
  for (let i = 0; i < 20; i++) { laag.frame(tStil); await even(3); }
  const stil = w.logboek.filter((m) => m.van === 'hoofd' && m.type === 'frame').slice(-10).map((m) => m.t);
  ok('stilstaande klok: de gestuurde tijd staat ook stil (geen terugval, geen ijken)', stil.every((t) => t === stil[0]));

  laag.zetSysteem('lz');
  ok('ander systeem: kies-bericht met zaad', w.logboek.at(-1).type === 'kies' && w.logboek.at(-1).systeem === 'lz');
  ok('en alle berichten zijn gewone gegevens', w.logboek.every((m) => { try { structuredClone(m); return true; } catch (_) { return false; } }));
}

console.log('noodrem en fouten komen boven, met laagnummer');
{
  proef.kost = 1;
  const werkers = [];
  const v = new VormLagen({ maakCanvas, nu, werker: () => { const w = nepWerker(); werkers.push(w); return w; } });
  const noodremmen = [];
  v.on('noodrem', (x) => noodremmen.push(x));
  ok('elke laag een eigen Worker', werkers.length === 2 && v.lagen.every((l) => l.modus === 'werker'));
  v.zetSysteem('zz', v.lagen[1]);
  proef.kost = 100;
  for (let i = 0; i < 6; i++) { v.lagen[1].frame(2 + i * STAP); await wachtTot(() => !v.lagen[1].bezig); }
  await even(5);
  ok('noodrem in de Worker van laag 2: event op VormLagen met laag 1 (index)', noodremmen.length === 1 && noodremmen[0].laag === 1 && noodremmen[0].kwaliteit === KWALITEIT_MIN);
  ok('en de kwaliteit op het scherm volgt', v.lagen[1].kwaliteit === KWALITEIT_MIN);
  proef.kost = 1;
}

console.log('terugval naar de hoofdthread');
{
  const geen = new VormLaag({ maakCanvas, systeem: 'zz', nu, werker: () => { throw new Error('geen module-workers'); } });
  ok('Worker maken gooit: gewoon hoofd-modus met het strenge budget', geen.modus === 'hoofd' && geen.budgetMs === BUDGET_HOOFD && geen.frame(0) === geen.canvas);

  let w = null;
  const laag = new VormLaag({ maakCanvas, systeem: 'zz', nu, werker: () => (w = nepWerker()) });
  const modi = [];
  laag.on('modus', (x) => modi.push(x));
  laag.zetKnop(0, 0.2);
  laag.frame(3);
  await even();
  laag.frame(3 + STAP);
  const oud = laag.beeld;
  w.vuurFout('module laadde niet');
  ok('Worker valt weg: verder op de hoofdthread, en dat wordt gemeld', laag.modus === 'hoofd' && modi.length === 1 && /module/.test(modi[0].reden));
  ok('met de knoppen zoals ze stonden', laag.p.a === 2 && laag.leesKnop(0) === 0.2 && laag.g.kwaliteit >= KWALITEIT_MIN);
  ok('het laatste bitmap is vrijgegeven, frame geeft weer het canvas', (!oud || oud.gesloten) && laag.frame(4) === laag.canvas);
  ok('en het systeem draait nu hier', laag.s.gezien.length > 0);
  await even(10);
  ok('late berichten van de dode Worker doen niets', laag.modus === 'hoofd' && laag.beeld === null);
}

console.log('de mixer uploadt het ImageBitmap');
{
  const uploads = [];
  const gl = new Proxy({
    TEXTURE0: 1000, TEXTURE1: 1001, TEXTURE_2D: 1,
    createTexture: () => ({}), createFramebuffer: () => ({}), createProgram: () => ({}), createShader: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    texImage2D: (...a) => {
      const bron = a[a.length - 1];
      if (bron instanceof NepBitmap && bron.gesloten) throw new Error('InvalidStateError: gesloten ImageBitmap');
      uploads.push(bron);
    },
    pixelStorei: (k) => { throw new Error(`pixelStorei(${k}) — een ImageBitmap negeert FLIP_Y, dus dan stond hij anders dan het canvas`); },
  }, { get(t, k) { if (k in t) return t[k]; return () => {}; } });
  const engine = { ctx: { currentTime: 2, outputLatency: 0, baseLatency: 0 }, deck: () => ({ buffer: null, ui: { fader: 0 } }), xfadeGain: () => 0 };
  const mixer = new VideoMixer({ canvas: { getContext: () => gl }, engine, decks: ['A'] });
  const laag = new VormLaag({ maakCanvas, systeem: 'zz', nu, werker: () => nepWerker() });
  laag.aan = true;
  mixer.voegBeeldlaagToe(laag);
  mixer.teken();
  ok('eerste beeld: het lege canvas (nooit wachten)', uploads.includes(laag.canvas));
  let fout = null;
  try {
    for (let i = 0; i < 20; i++) { await wachtTot(() => !laag.bezig); engine.ctx.currentTime += STAP; mixer.teken(); }
  } catch (e) { fout = e; }
  ok('daarna ImageBitmaps, en nooit een gesloten (close na de upload, niet ervoor)', !fout && uploads.some((u) => u instanceof NepBitmap));
  if (fout) console.log('      ', fout.message);
  ok('de mixer zet geen pixelStorei: canvas en ImageBitmap staan hetzelfde (headless: kijk.mjs meet het)', !mixer.fout);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
