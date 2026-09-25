// Video volgt audio: de rekenregel, zonder browser.
// Draai met: node test/video.test.mjs
const { synchroniseer, zichtbaarheid, SPRING_VANAF } = await import('../src/video/volg.js');

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log('video volgt audio');
let r = synchroniseer({ videoTijd: 10, doel: 10.02, rate: 1, speelt: true });
ok('klein verschil: niet springen', r.spring === null);
ok('maar iets sneller lopen tot hij bij is', r.rate > 1 && r.rate < 1.1);
r = synchroniseer({ videoTijd: 10.02, doel: 10, rate: 1, speelt: true });
ok('vóór op de audio: iets trager', r.rate < 1);
r = synchroniseer({ videoTijd: 10, doel: 10.049, rate: 1.05, speelt: true });
ok('bijsturen is relatief aan de decksnelheid', r.rate > 1.05);
r = synchroniseer({ videoTijd: 10, doel: 11, rate: 1, speelt: true });
ok('hooguit 10% bijsturen', r.spring !== null || r.rate <= 1.1 + 1e-9);
r = synchroniseer({ videoTijd: 40, doel: 12, rate: 1, speelt: true, seekDuur: 0.2 });
ok('loop of hotcue (groot verschil): springen', r.spring !== null);
ok('en wel naar waar de audio IS als de seek klaar is', bij(r.spring, 12.2));
r = synchroniseer({ videoTijd: 40, doel: 12, rate: 1, speelt: true, zoekt: true });
ok('een lopende seek niet onderbreken', r.spring === null);
r = synchroniseer({ videoTijd: 5, doel: 5.2, speelt: false });
ok('stilstaand en ergens anders: springen naar precies de plek, zonder voorsprong', bij(r.spring, 5.2) && r.speel === false);
r = synchroniseer({ videoTijd: 5, doel: 5.005, speelt: false });
ok('stilstaand en binnen een half beeld: laten staan', r.spring === null);
r = synchroniseer({ videoTijd: 1, doel: -0.02, speelt: true });
ok('nooit voor het begin', r.spring === null || r.spring >= 0);
ok(`de grens ligt op ${SPRING_VANAF * 1000} ms`, synchroniseer({ videoTijd: 0, doel: SPRING_VANAF - 0.001, speelt: true }).spring === null
  && synchroniseer({ videoTijd: 0, doel: SPRING_VANAF + 0.001, speelt: true }).spring !== null);

console.log('\nzichtbaarheid');
ok('fader dicht: onzichtbaar', zichtbaarheid(0, 1) === 0);
ok('crossfader weg: onzichtbaar', zichtbaarheid(1, 0) === 0);
ok('beide open: volledig', zichtbaarheid(1, 1) === 1);
ok('buiten 0..1 wordt geklemd', zichtbaarheid(2, 1) === 1 && zichtbaarheid(-1, 1) === 0);

console.log('\nvideo op de action-bus');
{
  const { bindVideo, invoke, read, list, VIDEO_FX_ACTIE } = await import('../src/control/actions.js');
  const { VIDEO_FX, MODI } = await import('../src/video/instellingen.js');
  const nep = {
    fx: Object.fromEntries(VIDEO_FX.map((f) => [f.id, f.standaard])), modus: MODI[0],
    zetFx(id, v) { if (id in this.fx) this.fx[id] = Math.max(0, Math.min(1, v)); },
    volgendeModus() { this.modus = MODI[(MODI.indexOf(this.modus) + 1) % MODI.length]; },
    puls: 0, pulsDoel: 'rgb',
    zetPuls(v) { this.puls = v; },
    volgendPulsDoel() { this.pulsDoel = this.pulsDoel === 'rgb' ? 'pixel' : 'rgb'; },
  };
  bindVideo(nep);
  ok('elk effect staat op de bus', VIDEO_FX.every((f) => list().some((a) => a.id === `video.fx.${VIDEO_FX_ACTIE[f.id] ?? f.id}`)));
  invoke('video.fx.pixel', 0.7);
  ok('een knop zet het effect', nep.fx.pixel === 0.7 && read('video.fx.pixel') === 0.7);
  ok('kleur begint in het midden (normaal) en is bipolair',
    read('video.fx.color') === 0.5 && list().find((a) => a.id === 'video.fx.color').meta.bipolar === true);
  invoke('video.mode', true); invoke('video.mode', false);
  ok('mengvorm-knop gaat naar de volgende', nep.modus === 'licht');
  for (let i = 0; i < MODI.length - 1; i++) invoke('video.mode', true);
  ok('en rond', nep.modus === 'mix' && read('video.mode') === 0);
  invoke('video.pulse', 0.6);
  ok('puls-knop op de bus', nep.puls === 0.6 && read('video.pulse') === 0.6);
  invoke('video.pulse.target', true);
  ok('puls-doel wisselt', nep.pulsDoel === 'pixel');
}

console.log('\neffecten op de tel');
{
  const { pulsVorm, klokTrack, metPuls, PULS_DOELEN } = await import('../src/video/puls.js');
  ok('op de tel: vol', pulsVorm(0) === 1);
  ok('halve tel: bijna weg', pulsVorm(0.5) < 0.1);
  ok('altijd tussen 0 en 1', [-1, 0, 0.3, 1, 2].every((f) => pulsVorm(f) >= 0 && pulsVorm(f) <= 1));
  const tracks = [
    { id: 'A', speelt: true, heeftGrid: true, zicht: 0.4 },
    { id: 'B', speelt: true, heeftGrid: true, zicht: 0.9 },
    { id: 'C', speelt: true, heeftGrid: false, zicht: 1 },
    { id: 'D', speelt: false, heeftGrid: true, zicht: 1 },
  ];
  ok('de maat komt van de luidste die speelt en een grid heeft', klokTrack(tracks) === 'B');
  ok('niemand geschikt: geen maat', klokTrack([{ id: 'A', speelt: false, heeftGrid: true, zicht: 1 }]) === null);
  ok('fader dicht telt niet mee', klokTrack([{ id: 'A', speelt: true, heeftGrid: true, zicht: 0 }]) === null);
  const fx = { rgb: 0.3, pixel: 0 };
  const r = metPuls(fx, 'rgb', 0.5, 1);
  ok('puls komt bovenop de knop', Math.abs(r.fx.rgb - 0.8) < 1e-9 && r.flits === 0);
  ok('het origineel blijft staan', fx.rgb === 0.3);
  ok('niet boven 1', metPuls({ rgb: 0.9 }, 'rgb', 1, 1).fx.rgb === 1);
  ok('flits is een eigen waarde', metPuls(fx, 'flits', 0.6, 0.5).flits === 0.3);
  ok('diepte 0: niets', metPuls(fx, 'pixel', 0, 1).fx.pixel === 0);
  ok('elk doel behalve flits is een echt effect', PULS_DOELEN.filter((d) => d !== 'flits').every((d) => d in { rgb: 0, pixel: 0, spiegel: 0, korrel: 0 }));
}

console.log('\nbeeldverhouding per laag (staande video)');
{
  const { schaalVoor, maatVan, leesLaag, FITS } = await import('../src/video/passen.js');
  const { bindVideo, invoke, read } = await import('../src/control/actions.js');
  /*
   * Een nep-video zoals een canvas: 720×1280 (9:16, TikTok), en het beeld
   * ASYMMETRISCH — vier verschillende kwarten. Een beeld dat alleen links en
   * rechts verschilt verstopt een omgekeerde y (zie CLAUDE.md, sporen).
   */
  const nep = { width: 720, height: 1280 };
  const kwart = (x, y) => (y < 0.5 ? (x < 0.5 ? 'rood' : 'groen') : (x < 0.5 ? 'blauw' : 'geel'));
  // Het doek van 1280×720 bemonsteren zoals de meng-shader dat doet.
  const doek = (schaal, u, v) => { const p = leesLaag(u, v, schaal); return p.binnen ? kwart(p.x, p.y) : 'zwart'; };

  ok('maat van een canvas (width/height) en van een <video> (videoWidth)',
    maatVan(nep).join('x') === '720x1280' && maatVan({ videoWidth: 1920, videoHeight: 1080, width: 300, height: 150 }).join('x') === '1920x1080');
  const passend = schaalVoor(...maatVan(nep), 'passend');
  ok(`9:16 passend: breder lezen, hoogte gelijk (${passend.map((x) => x.toFixed(3)).join(', ')})`,
    Math.abs(passend[0] - (16 / 9) / (9 / 16)) < 1e-9 && passend[1] === 1);
  ok('balken links en rechts zijn zwart', doek(passend, 0.05, 0.5) === 'zwart' && doek(passend, 0.95, 0.5) === 'zwart'
    && doek(passend, 0.05, 0.1) === 'zwart' && doek(passend, 0.95, 0.9) === 'zwart');
  // Het beeld beslaat 720/1280 × (9/16) = 31,6% van de breedte, in het midden.
  const rand = (1 - (9 / 16) / (16 / 9)) / 2;
  ok(`het beeld zelf: van ${(rand * 100).toFixed(1)}% tot ${((1 - rand) * 100).toFixed(1)}% van de breedte`,
    doek(passend, rand - 0.001, 0.5) === 'zwart' && doek(passend, rand + 0.001, 0.5) !== 'zwart'
    && doek(passend, 1 - rand + 0.001, 0.5) === 'zwart' && doek(passend, 1 - rand - 0.001, 0.5) !== 'zwart');
  ok('de vier kwarten staan goed: niet gespiegeld, niet ondersteboven',
    doek(passend, 0.45, 0.25) === 'rood' && doek(passend, 0.55, 0.25) === 'groen'
    && doek(passend, 0.45, 0.75) === 'blauw' && doek(passend, 0.55, 0.75) === 'geel');
  ok('van boven tot onder zichtbaar (niets afgesneden)', doek(passend, 0.5, 0.001) !== 'zwart' && doek(passend, 0.5, 0.999) !== 'zwart');

  const vullen = schaalVoor(720, 1280, 'vullen');
  ok('9:16 vullen: overal beeld, geen balken', [0.01, 0.5, 0.99].every((u) => [0.01, 0.5, 0.99].every((v) => doek(vullen, u, v) !== 'zwart')));
  ok('en de kwarten staan nog goed', doek(vullen, 0.2, 0.2) === 'rood' && doek(vullen, 0.8, 0.2) === 'groen'
    && doek(vullen, 0.2, 0.8) === 'blauw' && doek(vullen, 0.8, 0.8) === 'geel');
  const boven = leesLaag(0.5, 0, vullen).y;
  ok(`boven en onder valt weg (doekrand leest op ${(boven * 100).toFixed(1)}% van het beeld)`, boven > 0.3 && boven < 0.35);

  ok('16:9 blijft zoals het was', schaalVoor(1280, 720, 'passend').join() === '1,1' && schaalVoor(1920, 1080, 'vullen').join() === '1,1');
  const breed = schaalVoor(2560, 1080, 'passend');
  ok('21:9 passend: balken boven en onder', breed[0] === 1 && breed[1] > 1 && doek(breed, 0.5, 0.02) === 'zwart' && doek(breed, 0.02, 0.5) !== 'zwart');
  const oud = schaalVoor(640, 480, 'passend');
  ok('4:3 passend: smalle balken opzij', oud[0] > 1 && oud[1] === 1 && doek(oud, 0.05, 0.5) === 'zwart' && doek(oud, 0.2, 0.5) !== 'zwart');
  ok('maat nog onbekend (video laadt): uitrekken zoals vroeger, niet verdwijnen', schaalVoor(0, 0).join() === '1,1' && schaalVoor(...maatVan(null)).join() === '1,1');

  const mixer = { fit: FITS[0], volgendeFit() { this.fit = FITS[(FITS.indexOf(this.fit) + 1) % FITS.length]; },
    fx: {}, zetFx() {}, volgendeModus() {}, zetPuls() {}, volgendPulsDoel() {}, modus: 'mix', puls: 0, pulsDoel: 'rgb' };
  bindVideo(mixer);
  ok('video.fit staat op de bus, begint op passend', read('video.fit') === 0 && mixer.fit === 'passend');
  invoke('video.fit', true); invoke('video.fit', false);
  ok('één druk: vullen', mixer.fit === 'vullen' && read('video.fit') === 1);
  invoke('video.fit', true);
  ok('nog een: terug naar passend', mixer.fit === 'passend');
  // De shader moet hetzelfde doen als leesLaag: controleer dat hij de schaal per laag leest.
  const bron = (await import('node:fs')).readFileSync(new URL('../src/video/video-mixer.js', import.meta.url), 'utf8');
  ok('de meng-shader schaalt elke laag (s[0..7]) en is buiten het beeld doorzichtig',
    [0, 1, 2, 3, 4, 5, 6, 7].every((i) => bron.includes(`q = (uv - 0.5) * s[${i}] + 0.5; l[${i}] = texture(t${i}, q).rgb; g[${i}] = w[${i}] * binnen(q);`))
    && !/l\[i\] \* w\[i\]/.test(bron));
}

console.log('\nvideo van een nummer ontbreekt of laadt niet');
{
  const { videoFoutTekst, laadtTeLang, LAAD_GEDULD } = await import('../src/video/fouten.js');
  ok('404 of een formaat dat niet kan: "ontbreekt"', /ontbreekt/.test(videoFoutTekst({ code: 4 })));
  ok('kapot bestand: "niet te decoderen"', /decoderen/.test(videoFoutTekst({ code: 3 })));
  ok('onbekend: de boodschap zelf, of iets', videoFoutTekst({ code: 9, message: 'raar' }) === 'raar' && videoFoutTekst(null).length > 0);
  const basis = { zichtbaar: true, klaar: false, gemeld: false, sinds: 0 };
  ok(`zichtbaar en na ${LAAD_GEDULD} s nog geen beeld: melden`, laadtTeLang({ ...basis, nu: LAAD_GEDULD * 1000 + 1 }));
  ok('nog binnen het geduld: niet', !laadtTeLang({ ...basis, nu: LAAD_GEDULD * 1000 - 1 }));
  ok('niet te zien, al klaar of al gemeld: niet', !laadtTeLang({ ...basis, zichtbaar: false, nu: 1e9 })
    && !laadtTeLang({ ...basis, klaar: true, nu: 1e9 }) && !laadtTeLang({ ...basis, gemeld: true, nu: 1e9 }));
}

console.log('\nde mixer meldt een video die niet laadt');
{
  const { VideoMixer } = await import('../src/video/video-mixer.js');
  let id = 0;
  const gl = new Proxy({ TEXTURE0: 1000, createTexture: () => ({ tex: ++id }), createFramebuffer: () => ({ fb: ++id }),
    createProgram: () => ({ prog: ++id }), createShader: () => ({ sh: ++id }), getShaderParameter: () => true,
    getProgramParameter: () => true, getUniformLocation: (p, n) => n, getAttribLocation: () => 0 },
  { get(t, k) { return k in t ? t[k] : () => {}; } });
  const nepVideo = () => {
    const luister = {};
    return { paused: true, currentTime: 0, readyState: 0, seeking: false, playbackRate: 1, luister, src: '',
      addEventListener: (n, f) => { (luister[n] ??= []).push(f); }, removeAttribute() { this.src = ''; },
      load() {}, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  };
  const deck = { buffer: {}, ui: { fader: 1 }, position: 3, rate: 1, playing: false, grid: null };
  const engine = { ctx: { currentTime: 1, outputLatency: 0, baseLatency: 0 }, deck: () => deck, xfadeGain: () => 1 };
  const hoofd = new VideoMixer({ canvas: { getContext: () => gl }, engine, decks: ['A', 'B'], maakVideo: nepVideo });
  const meldingen = [];
  hoofd.onFout = (d, t) => meldingen.push([d, t]);
  hoofd.zetBron('B', '/media/weg/video.mp4');
  const vb = hoofd.lagen.get('B').video;
  vb.error = { code: 4 };
  vb.luister.error.forEach((f) => f());
  vb.luister.error.forEach((f) => f());
  ok('bestand ontbreekt (404): één melding met de track erbij', meldingen.length === 1 && meldingen[0][0] === 'B' && /ontbreekt/.test(meldingen[0][1]));
  hoofd.zetBron('B', null);
  vb.luister.error.forEach((f) => f());
  ok('een fout van een video die al weg is telt niet', meldingen.length === 1);

  // "Na 10 s nog geen beeld" telt de tijd dat de laag te ZIEN was. Tekent deze
  // mixer een tijd niet (tabblad verborgen: rAF stil en Chrome laadt geen
  // media; of het andere venster mengde), dan telt die tijd niet mee: bij het
  // eerste beeld daarna meteen melden was vals alarm.
  const echteNu = performance.now;
  let klok = 0;
  performance.now = () => klok;
  try {
    meldingen.length = 0;
    hoofd.zetBron('A', '/media/traag/video.mp4');   // laadt niet (readyState 0), zichtbaar (fader 1)
    hoofd.teken(); klok = 500; hoofd.teken();
    klok = 60500; hoofd.teken();                     // een minuut niet getekend
    ok('een minuut niet getekend: die tijd telt niet als "geen beeld"', meldingen.length === 0);
    while (klok < 71000) { klok += 100; hoofd.teken(); }
    ok('wel 10 s zichtbaar getekend zonder beeld: één melding', meldingen.length === 1 && meldingen[0][0] === 'A' && /10 s/.test(meldingen[0][1]));
  } finally { performance.now = echteNu; }
}

console.log('\nsprongen die lang duren: seekDuur leert de echte duur, ook als het seeked-event laat komt');
{
  // Onder belasting komt het 'seeked'-event pas NA het volgende beeld. Sprong
  // dat beeld opnieuw (de vorige landde te laat), dan hoorde het event bij de
  // vorige sprong en telde de nieuwe als 0 s: seekDuur zakte naar ~0, elke
  // sprong landde 0,8 s te laat, en de video sprong eindeloos achter het
  // geluid aan (tools/headless/beamer.mjs, acht tracks, 25 sep).
  const { VideoMixer } = await import('../src/video/video-mixer.js');
  const gl = new Proxy({ TEXTURE0: 1000, createTexture: () => ({}), createFramebuffer: () => ({}), createProgram: () => ({}),
    createShader: () => ({}), getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (p, n) => n, getAttribLocation: () => 0 },
  { get(t, k) { return k in t ? t[k] : () => {}; } });
  const echteNu = performance.now;
  let klok = 1000;
  performance.now = () => klok;
  try {
    const deck = { buffer: {}, ui: { fader: 1 }, position: 30, rate: 1, playing: true, grid: null };
    const engine = { ctx: { currentTime: 1, outputLatency: 0, baseLatency: 0 }, deck: () => deck, xfadeGain: () => 1 };
    let v;
    const maakVideo = () => (v = { paused: true, readyState: 4, seeking: false, playbackRate: 1, luister: {}, src: '', t: 0, klaarOm: 0, laat: false,
      addEventListener(n, f) { (this.luister[n] ??= []).push(f); }, removeAttribute() {}, load() {},
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); },
      get currentTime() { return this.t; },
      set currentTime(x) { this.t = x; this.seeking = true; this.klaarOm = klok + 800; } });   // elke sprong duurt 0,8 s
    const mx = new VideoMixer({ canvas: { getContext: () => gl }, engine, decks: ['A'], maakVideo });
    mx.zetBron('A', '/media/s/video.mp4');
    mx.lagen.get('A').klaar = true;
    let sprongen = 0, laatsteSprong = 0;
    for (let n = 0; n < 1200; n++) {                         // 20 s op 60 beelden per seconde
      klok += 1000 / 60;
      deck.position = 30 + (klok - 1000) / 1000;
      if (v.laat) { v.laat = false; (v.luister.seeked ?? []).forEach((f) => f()); }   // het event van de vorige sprong, een beeld te laat
      if (v.seeking && klok >= v.klaarOm) { v.seeking = false; v.laat = true; }
      else if (!v.seeking && !v.paused) v.t += v.playbackRate / 60;
      const voor = v.klaarOm;
      mx.teken();
      if (v.klaarOm !== voor) { sprongen++; laatsteSprong = klok; }
    }
    const laag = mx.lagen.get('A');
    ok('seekDuur leert de echte duur (0,8 s), niet de tijd tot een laat event', laag.seekDuur > 0.6, `${laag.seekDuur.toFixed(2)} s`);
    ok('de video komt in de pas en springt daarna niet meer', laatsteSprong < 11000 && Math.abs(v.t - deck.position) < 0.05,
      `${sprongen} sprongen, laatste na ${((laatsteSprong - 1000) / 1000).toFixed(1)} s, verschil ${Math.round((v.t - deck.position) * 1000)} ms`);
  } finally { performance.now = echteNu; }
}

console.log('\nde beamer: wie mengt er (het losse venster loopt door als het hoofdtabblad verborgen is)');
{
  const { wieMengt, Beamer, isDicht, isVerborgen } = await import('../src/video/beamer.js');
  const s = (x) => `${x.hoofd ? 'H' : '-'}${x.los ? 'L' : '-'}${x.voorbeeld ? 'V' : '-'}`;
  ok('niets open: niemand mengt', s(wieMengt({ losOpen: false, paneelOpen: false })) === '---');
  ok('alleen het paneel: het hoofdvenster mengt (zoals altijd)', s(wieMengt({ losOpen: false, paneelOpen: true })) === 'H--');
  ok('los venster open: DAT mengt, en het paneel toont zijn beeld (één keer mengen)', s(wieMengt({ losOpen: true, paneelOpen: true })) === '-LV');
  ok('los venster open, paneel dicht: alleen het losse venster', s(wieMengt({ losOpen: true, paneelOpen: false })) === '-L-');
  ok('video-opname uit het hoofdvenster, paneel dicht: hoofd mengt door (anders zwart in de opname)',
    s(wieMengt({ losOpen: false, paneelOpen: false, opname: 'hoofd' })) === 'H--');
  ok('opname begon in het hoofdvenster, dan los venster erbij: allebei (een MediaRecorder wisselt niet van bron)',
    s(wieMengt({ losOpen: true, paneelOpen: true, opname: 'hoofd' })) === 'HL-');
  ok('opname uit het losse venster: alleen dat mengt', s(wieMengt({ losOpen: true, paneelOpen: false, opname: 'los' })) === '-L-');
  ok('los venster weg tijdens zijn opname: het paneel mengt weer zelf', s(wieMengt({ losOpen: false, paneelOpen: true, opname: 'los' })) === 'H--');

  const b = new Beamer();
  let weg = 0;
  b.onWeg = () => weg++;
  const venster = { closed: false }, ander = { closed: false };
  const mixer = { canvas: { naam: 'los-canvas' } };
  ok('zonder los venster: opname uit het eigen canvas', b.opnameCanvas('hoofd-canvas') === 'hoofd-canvas' && b.opnameWaar === 'hoofd');
  b.meldAan(venster, mixer);
  ok('aangemeld: het losse venster mengt', b.wieMengt({ paneelOpen: true }).los && b.mengtLos(venster, b.wieMengt({ paneelOpen: true })));
  ok('een ander venster mengt niet (alleen het aangemelde)', !b.mengtLos(ander, b.wieMengt({ paneelOpen: true })));
  ok('opname nu uit het losse canvas', b.opnameCanvas('hoofd-canvas') === mixer.canvas && b.opnameWaar === 'los');
  ok('afmelden door een ander venster doet niets', b.meldAf(ander) === false && b.los && weg === 0);
  ok('afmelden (pagehide): weg, en onWeg één keer', b.meldAf(venster) === true && !b.los && weg === 1);
  b.meldAan(venster, mixer);
  ok('herladen van het losse venster: zelfde venster meldt zich weer aan', b.levend()?.venster === venster);
  venster.document = { hidden: true };
  ok('los venster verborgen (geminimaliseerd): zijn lus staat stil, het paneel mengt weer zelf',
    s(b.wieMengt({ paneelOpen: true })) === 'H--' && b.levend()?.venster === venster && weg === 1);
  // Een verborgen los venster (geminimaliseerd, of op hetzelfde scherm achter
  // het hoofdvenster) tekent niet: een opname van ZIJN canvas zou stilstaan.
  ok('los venster verborgen: een nieuwe video-opname neemt het eigen canvas (dat mengt nu)',
    b.opnameCanvas('hoofd-canvas') === 'hoofd-canvas' && b.opnameWaar === 'hoofd');
  venster.document.hidden = false;
  ok('weer zichtbaar: eerst inlopen (zijn video\'s stonden stil), het paneel mengt nog',
    s(b.wieMengt({ paneelOpen: true, nu: 1000 })) === 'H--' && b.rolLos(venster, b.wieMengt({ paneelOpen: true, nu: 1000 })) === 'inloop');
  b.meldPas(venster, true, 1000);
  ok('in de pas: het losse venster neemt het weer over', !b.meldPas(venster, true, 1400) && s(b.wieMengt({ paneelOpen: true, nu: 1400 })) === '-LV');
  ok('een venster waar we niet in mogen kijken telt als zichtbaar', !isVerborgen({ get document() { throw new Error('SecurityError'); } }));
  venster.closed = true;
  ok('dicht zonder afmelden (crash): levend() ruimt op en meldt het', b.levend() === null && weg === 2 && !b.wieMengt({ paneelOpen: true }).los);
  ok('een venster waar we niet meer bij mogen telt als dicht',
    isDicht({ get closed() { throw new Error('SecurityError'); } }) && isDicht(null) && !isDicht({ closed: false }));
}

console.log('\nde inloop: het losse venster toont het beeld van het hoofdvenster tot zijn eigen video\'s in de pas lopen');
{
  const { inDePas, INLOOP_DREMPEL, SPRING_VANAF } = await import('../src/video/volg.js');
  const { wieMengt, inloopStap, Beamer, INLOOP_HOUD, INLOOP_MAX } = await import('../src/video/beamer.js');
  const s = (x) => `${x.hoofd ? 'H' : '-'}${x.los ? 'L' : '-'}${x.voorbeeld ? 'V' : '-'}${x.inloop ? 'I' : '-'}`;

  const goed = { klaar: true, zoekt: false, verschil: 0.01, fout: false };
  ok('alle zichtbare video\'s klaar, niet aan het springen, dicht bij wat je hoort: in de pas', inDePas([goed, { ...goed, verschil: -0.02 }]));
  ok('één nog zonder beeld: niet', !inDePas([goed, { ...goed, klaar: false }]));
  ok('één nog aan het springen: niet', !inDePas([goed, { ...goed, zoekt: true }]));
  ok(`strenger dan springen: ${INLOOP_DREMPEL * 1000} ms, niet ${SPRING_VANAF * 1000} (daartussen stuurt volg nog bij)`,
    INLOOP_DREMPEL < SPRING_VANAF && inDePas([{ ...goed, verschil: INLOOP_DREMPEL }]) && !inDePas([{ ...goed, verschil: -(INLOOP_DREMPEL + 0.001) }]));
  ok('een video met een fout houdt de overname niet op', inDePas([goed, { klaar: false, zoekt: false, verschil: 9, fout: true }]));
  ok('geen zichtbare video: niets in te lopen', inDePas([]));

  ok('inloop: het hoofdvenster mengt (ook met het paneel dicht), het losse venster niet',
    s(wieMengt({ losOpen: true, paneelOpen: true, inloop: true })) === 'H--I' && s(wieMengt({ losOpen: true, paneelOpen: false, inloop: true })) === 'H--I');
  ok('zonder los venster geen inloop', s(wieMengt({ losOpen: false, paneelOpen: true, inloop: true })) === 'H---');
  ok('na de inloop weer één keer mengen', s(wieMengt({ losOpen: true, paneelOpen: true, inloop: false })) === '-LV-');

  let il = { sinds: 0, pasSinds: null };
  il = inloopStap(il, false, 500);
  ok('nog niet in de pas: inloop loopt door', il && il.pasSinds === null);
  il = inloopStap(il, true, 600);
  ok(`in de pas, maar nog geen ${INLOOP_HOUD * 1000} ms: door`, il && il.pasSinds === 600 && inloopStap(il, true, 600 + INLOOP_HOUD * 1000 - 1));
  ok('even eruit (een sprong): de teller begint opnieuw', inloopStap(il, false, 700).pasSinds === null
    && !!inloopStap(inloopStap(il, false, 700), true, 800 + INLOOP_HOUD * 1000 - 1));
  ok(`${INLOOP_HOUD * 1000} ms achter elkaar in de pas: voorbij`, inloopStap(il, true, 600 + INLOOP_HOUD * 1000) === null);
  ok(`nooit in de pas: na ${INLOOP_MAX} s neemt het losse venster hoe dan ook over`,
    inloopStap({ sinds: 0, pasSinds: null }, false, INLOOP_MAX * 1000 - 1) && inloopStap({ sinds: 0, pasSinds: null }, false, INLOOP_MAX * 1000) === null);

  // De Beamer: wanneer wel, wanneer niet, en de overname.
  const venster = { closed: false, document: { hidden: false } };
  const mixer = { canvas: 'los-canvas' };
  const b = new Beamer();
  b.wieMengt({ paneelOpen: true, nu: 0 });                  // het paneel mengt: zijn video's lopen al
  b.meldAan(venster, mixer, 100);
  let w = b.wieMengt({ paneelOpen: true, nu: 100 });
  ok('los venster open terwijl het paneel mengde: inloop, het hoofdvenster blijft mengen', s(w) === 'H--I' && b.rolLos(venster, w) === 'inloop' && !b.mengtLos(venster, w));
  ok('een tweede los venster doet niet mee', b.rolLos({ closed: false }, w) === null);
  ok('een video-opname die nu start neemt het losse canvas (daar staat het beeld van het hoofdvenster op, en straks het eigen)',
    b.opnameCanvas('hoofd-canvas') === 'los-canvas' && b.opnameWaar === 'los');
  ok('en de inloop gaat gewoon door (de opname heeft het beeld al)', s(b.wieMengt({ paneelOpen: true, opname: 'los', nu: 200 })) === 'H--I');
  ok('meldPas: nog niet in de pas, blijft inlopen', b.meldPas(venster, false, 2000) === true);
  b.meldPas(venster, true, 3000);
  ok('in de pas en dat blijft zo: het losse venster mengt zelf, het hoofdvenster stopt',
    b.meldPas(venster, true, 3000 + INLOOP_HOUD * 1000) === false && s(b.wieMengt({ paneelOpen: true, nu: 3400 })) === '-LV-'
    && b.rolLos(venster, b.wieMengt({ paneelOpen: true, nu: 3400 })) === 'mengt');
  ok('een ander venster kan de inloop niet beëindigen', new Beamer().meldPas(venster, true, 0) === false);

  const b2 = new Beamer();
  b2.wieMengt({ paneelOpen: false, nu: 0 });                // paneel dicht: niemand mengde
  b2.meldAan(venster, mixer, 0);
  ok('het hoofdvenster mengde niet (paneel dicht): geen inloop, het losse venster mengt meteen',
    s(b2.wieMengt({ paneelOpen: false, nu: 0 })) === '-L--');

  const b3 = new Beamer();
  b3.wieMengt({ paneelOpen: true, nu: 0 });
  b3.meldAan(venster, mixer, 0);
  ok('hoofdtabblad verborgen: geen beeld om te lenen, het losse venster mengt meteen',
    s(b3.wieMengt({ paneelOpen: true, hoofdVerborgen: true, nu: 50 })) === '-LV-');
  ok('en dat blijft zo als het hoofdtabblad terugkomt (de inloop is voorbij)', s(b3.wieMengt({ paneelOpen: true, nu: 5000 })) === '-LV-');

  // Verborgen en weer zichtbaar: alleen inlopen als het hoofdvenster intussen mengde.
  const b5 = new Beamer();
  b5.meldAan(venster, mixer, 0);
  venster.document.hidden = true;
  b5.wieMengt({ paneelOpen: false, nu: 10 });               // niemand mengt
  venster.document.hidden = false;
  ok('los venster terug, maar het paneel was dicht: meteen zelf mengen', s(b5.wieMengt({ paneelOpen: false, nu: 20 })) === '-L--');
  venster.document.hidden = true;
  b5.wieMengt({ paneelOpen: true, nu: 30 });                // het paneel nam het over
  ok('verborgen tijdens de inloop: geen inloop meer (zijn lus staat toch stil)', !b5.los.inloop);
  venster.document.hidden = false;
  ok('terug terwijl het paneel mengde: opnieuw inlopen', s(b5.wieMengt({ paneelOpen: true, nu: 40 })) === 'H--I');
  delete venster.document.hidden;
}

console.log('\nde mixer in het losse venster loopt in: bijsturen en uploaden, niet mengen');
{
  const { VideoMixer } = await import('../src/video/video-mixer.js');
  let id = 0;
  const tel = { upload: 0, teken: 0 };
  const gl = new Proxy({ TEXTURE0: 1000, createTexture: () => ({ tex: ++id }), createFramebuffer: () => ({ fb: ++id }),
    createProgram: () => ({ prog: ++id }), createShader: () => ({ sh: ++id }), getShaderParameter: () => true,
    getProgramParameter: () => true, getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    texImage2D: () => { tel.upload++; }, drawArrays: () => { tel.teken++; } },
  { get(t, k) { return k in t ? t[k] : () => {}; } });
  const nepVideo = () => {
    const luister = {};
    return { paused: true, currentTime: 0, readyState: 0, seeking: false, playbackRate: 1, luister, src: '',
      addEventListener: (n, f) => { (luister[n] ??= []).push(f); }, removeAttribute() { this.src = ''; },
      load() {}, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); },
      set currentTime(t) { this._t = t; this.seeking = true; }, get currentTime() { return this._t ?? 0; } };
  };
  const decks = { A: { buffer: {}, ui: { fader: 1 }, position: 12, rate: 1, playing: true, grid: null },
    B: { buffer: {}, ui: { fader: 0 }, position: 3, rate: 1, playing: true, grid: null } };
  const engine = { ctx: { currentTime: 1, outputLatency: 0.02, baseLatency: 0 }, deck: (d) => decks[d], xfadeGain: () => 1 };
  const los = new VideoMixer({ canvas: { getContext: () => gl }, engine, decks: ['A', 'B'], maakVideo: nepVideo });
  tel.upload = 0; tel.teken = 0;                             // de lege texture uit de constructor telt niet
  los.zetBron('A', '/media/a/video.mp4');
  los.zetBron('B', '/media/b/video.mp4');
  const va = los.lagen.get('A').video, vb = los.lagen.get('B').video;
  vb.paused = false;
  ok('nog geen beeld: niet in de pas', los.loopIn() === false);
  ok('zonder te uploaden of te tekenen', tel.upload === 0 && tel.teken === 0 && los.beelden === 0);
  ok('de zichtbare video loopt al (zodat hij bij kan komen), de onzichtbare staat stil', !va.paused && vb.paused);
  va.readyState = 4; va.luister.loadeddata.forEach((f) => f());
  los.loopIn();
  ok('beeld binnen, maar 12 s naast wat je hoort: springen (naar de audio plus de seekduur)', va.seeking && va.currentTime > 11.9);
  ok('en dan nog niet in de pas', los.loopIn() === false);
  va.seeking = false; va._t = 12 - 0.02 + 0.01;               // na de sprong: 10 ms naast wat je hoort
  tel.upload = 0;
  ok('geland, dicht bij wat je HOORT (positie min uitgangsvertraging): in de pas', los.loopIn() === true);
  ok('met beeld wordt hij WEL geüpload (anders is het eerste eigen beeld na de overname oud), maar niets gemengd',
    tel.upload === 1 && tel.teken === 0 && los.beelden === 0);
  decks.B.ui.fader = 1;
  ok('een tweede track gaat open: die moet ook eerst in de pas', los.loopIn() === false);
  vb.readyState = 4; vb.luister.loadeddata.forEach((f) => f()); vb.seeking = false; vb._t = 3 - 0.02;
  ok('ook in de pas: samen in de pas', los.loopIn() === true);
  tel.upload = 0; tel.teken = 0;
  los.teken();
  ok('na de overname tekent teken() gewoon (twee video\'s geüpload, drie stappen)', tel.upload === 2 && tel.teken === 3);

  // toonBeeld: het beeld van het hoofdvenster erop, één upload en één stap (tonen), geen video.
  tel.upload = 0; tel.teken = 0;
  const bronnen = [];
  gl.texImage2D = (...a) => { tel.upload++; bronnen.push(a.at(-1)); };
  const hoofdCanvas = { hoofd: true };
  los.toonBeeld(hoofdCanvas);
  ok('toonBeeld: het canvas van het hoofdvenster geüpload en getoond, verder niets', tel.upload === 1 && tel.teken === 1 && bronnen[0] === hoofdCanvas);
  const tex = los.leenTex;
  los.toonBeeld(hoofdCanvas);
  ok('elk beeld dezelfde texture (niets nieuws per beeld)', los.leenTex === tex);
}

console.log('\nde mixer in het losse venster neemt alles over van die in het hoofdvenster');
{
  const { VideoMixer } = await import('../src/video/video-mixer.js');
  // Nep-WebGL en nep-<video>: genoeg om te zien wat er gemaakt, gebonden en geladen wordt.
  let id = 0;
  const gl = new Proxy({ TEXTURE0: 1000, createTexture: () => ({ tex: ++id }), createFramebuffer: () => ({ fb: ++id }),
    createProgram: () => ({ prog: ++id }), createShader: () => ({ sh: ++id }), getShaderParameter: () => true,
    getProgramParameter: () => true, getUniformLocation: (p, n) => n, getAttribLocation: () => 0 },
  { get(t, k) { return k in t ? t[k] : () => {}; } });
  const nepVideo = () => {
    const luister = {};
    return { paused: true, currentTime: 0, readyState: 0, seeking: false, playbackRate: 1, luister, src: '',
      addEventListener: (n, f) => { (luister[n] ??= []).push(f); }, removeAttribute() { this.src = ''; },
      load() {}, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  };
  const deck = { buffer: {}, ui: { fader: 1 }, position: 3, rate: 1, playing: false, grid: null };
  const engineOud = { ctx: { currentTime: 1, outputLatency: 0, baseLatency: 0 }, deck: () => deck, xfadeGain: () => 1 };
  const engineNieuw = { ...engineOud, ctx: { currentTime: 9, outputLatency: 0, baseLatency: 0 } };
  const hoofd = new VideoMixer({ canvas: { getContext: () => gl }, engine: engineOud, decks: ['A', 'B'], maakVideo: nepVideo });
  const los = new VideoMixer({ canvas: { getContext: () => gl }, engine: { ctx: {} }, decks: ['A', 'B'], maakVideo: nepVideo });

  hoofd.zetBron('A', '/media/x/video.mp4');
  hoofd.zetFx('pixel', 0.4); hoofd.volgendeModus(); hoofd.volgendeFit(); hoofd.zetPuls(0.7); hoofd.volgendPulsDoel();
  los.neemOver(hoofd);
  ok('knoppen, mengvorm, passend/vullen, puls en doel over', los.fx.pixel === 0.4 && los.modus === hoofd.modus
    && los.fit === 'vullen' && los.puls === 0.7 && los.pulsDoel === hoofd.pulsDoel);
  ok('het losse venster leest de engine van het hoofdvenster', los.engine === engineOud);
  const eigen = los.lagen.get('A');
  ok('dezelfde video, maar een EIGEN <video> (een verborgen tabblad decodeert niets)',
    eigen && eigen.url === '/media/x/video.mp4' && eigen.video !== hoofd.lagen.get('A').video);
  los.neemOver(hoofd);
  ok('elk beeld opnieuw overnemen maakt niets opnieuw', los.lagen.get('A') === eigen);
  hoofd.zetBron('A', null);
  los.neemOver(hoofd);
  ok('video weg in het hoofdvenster: ook hier weg (en losgelaten)', !los.lagen.has('A') && eigen.video.src === '');
  ok('zonder beeldlagen geen lagenstap in het losse venster', !los.lagenProg);
  const laag = { aan: true, dekking: 1, mengvorm: 'screen', frame: () => ({ width: 512, height: 512 }) };
  hoofd.voegBeeldlaagToe(laag);
  los.neemOver(hoofd);
  ok('beeldlagen: DEZELFDE objecten (een vorm rekent één keer), lagenstap hier gebouwd',
    los.beeldlagen === hoofd.beeldlagen && los.beeldlagen[0] === laag && !!los.lagenProg && !!los.gelaagd);
  hoofd.engine = engineNieuw;
  los.neemOver(hoofd);
  ok('hoofdvenster herladen: de nieuwe engine komt vanzelf mee', los.engine === engineNieuw);

  // Zonder WebGL2 meldt het losse venster zich niet aan, maar zijn lus roept
  // neemOver elk beeld aan: dat mag niet gooien (eerst: TypeError op this.fx,
  // elke seconde een console.error in het losse venster).
  const zonderGl = new VideoMixer({ canvas: { getContext: () => null }, engine: { ctx: {} }, decks: ['A', 'B'], maakVideo: nepVideo });
  let gooit = null;
  try { zonderGl.neemOver(hoofd); zonderGl.pauzeerAlles(); } catch (err) { gooit = err.message; }
  ok('los venster zonder WebGL2: neemOver gooit niet', !!zonderGl.fout && gooit === null);

}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
