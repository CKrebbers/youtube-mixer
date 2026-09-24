// Vormlagen: de Vormmachines als beeldlaag over de video. Zonder browser:
// een nep-canvas voor de systemen en een nep-WebGL voor de mixer.
// Draai met: node test/vormen.test.mjs
import { readFileSync } from 'node:fs';

const { SYSTEMEN, SYSTEEM, draaiKnoppen, maakRng } = await import('../src/vormen/systemen.js');
const { VormLaag, VormLagen, STAP, MAX_STAPPEN } = await import('../src/vormen/laag.js');
const { actieveLagen, lagenUniforms, MAX_BEELDLAGEN, LAAG_FIT } = await import('../src/video/lagen.js');
const { leesLaag } = await import('../src/video/passen.js');
const { VideoMixer } = await import('../src/video/video-mixer.js');
const actions = await import('../src/control/actions.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

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
  ok('Detail View was vrij in de standaardmapping', !std.rules.some((r) => r.in === 'note:0:65'));
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
  ok('een laag die al 16:9 is blijft 1:1 (voor later, als de systemen breed tekenen)', bij(breed.s[0], 1) && bij(breed.s[1], 1) && Math.abs(breed.s[2] - 1) < 0.01 && Math.abs(breed.s[3] - 1) < 0.01);
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
