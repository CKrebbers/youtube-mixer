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
  // klokTrack blijft de terugval zonder engine (een kale lijst, maat.js zonder maatgever).
  const tracks = [
    { id: 'A', speelt: true, heeftGrid: true, zicht: 0.4 },
    { id: 'B', speelt: true, heeftGrid: true, zicht: 0.9 },
    { id: 'C', speelt: true, heeftGrid: false, zicht: 1 },
    { id: 'D', speelt: false, heeftGrid: true, zicht: 1 },
  ];
  ok('klokTrack (zonder engine): de luidste die speelt en een grid heeft', klokTrack(tracks) === 'B');
  ok('niemand geschikt: geen maat', klokTrack([{ id: 'A', speelt: false, heeftGrid: true, zicht: 1 }]) === null);
  ok('fader dicht telt niet mee', klokTrack([{ id: 'A', speelt: true, heeftGrid: true, zicht: 0 }]) === null);

  // De maat komt van de MAATGEVER van de engine (met hysterese, dezelfde als
  // de MAAT-badge en de sampler), niet van een eigen keuze in de mixer: die
  // sprong heen en weer bij twee even harde tracks.
  const { VideoMixer } = await import('../src/video/video-mixer.js');
  const gl = new Proxy({ TEXTURE0: 1000, TEXTURE_2D: 1, FRAMEBUFFER: 2, ARRAY_BUFFER: 3,
    getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: (p, n) => n, getAttribLocation: () => 0 },
  { get(t, k) { if (k in t) return t[k]; return () => ({}); } });
  const nepDeck = (id, fader, positie) => ({ id, playing: true, position: positie, rate: 1, buffer: {}, ui: { fader },
    grid: { phase: (p) => ((p % 0.5) + 0.5) % 0.5 / 0.5 } });
  const decks = { A: nepDeck('A', 0.6, 10.1), B: nepDeck('B', 1, 20.3) };
  let meester = decks.A;
  const engine = { ctx: { currentTime: 2, outputLatency: 0, baseLatency: 0 }, deck: (id) => decks[id],
    xfadeGain: () => 1, syncMaster: () => meester };
  const vm = new VideoMixer({ canvas: { getContext: () => gl }, engine, decks: ['A', 'B'] });
  vm.zetPuls(1);
  ok('de puls volgt de maatgever van de engine, ook als een ander net harder staat',
    bij(vm._pulsNu(0), pulsVorm(decks.A.grid.phase(10.1))) && !bij(vm._pulsNu(0), pulsVorm(decks.B.grid.phase(20.3))));
  meester = decks.B;
  ok('wisselt de engine, dan wisselt de puls mee', bij(vm._pulsNu(0), pulsVorm(decks.B.grid.phase(20.3))));
  meester = null;
  ok('geen maatgever: geen puls', vm._pulsNu(0) === 0);
  meester = decks.A; decks.A.ui.fader = 0;
  ok('maatgever niet te zien (fader dicht): geen puls', vm._pulsNu(0) === 0);
  // Integratie ronde 3: wacht (dj-transport) en rem (dj-klank) samen.
  decks.A.ui.fader = 0.6; decks.A.wacht = true;
  ok('maatgever wacht op zijn start op de maat: geen puls (hij klinkt nog niet)', vm._pulsNu(0) === 0);
  decks.A.wacht = false; decks.A.remt = true;
  ok('maatgever remt: geen puls', vm._pulsNu(0) === 0);
  decks.A.remt = false;
  ok('en weer gewoon: puls', bij(vm._pulsNu(0), pulsVorm(decks.A.grid.phase(10.1))));

  // _volg: de snelheid van NU (rem, dj-klank) en stilstaan tijdens het wachten
  // op de maat (dj-transport), allebei tegelijk in dezelfde regel.
  const nepVideo = (t) => ({ currentTime: t, seeking: false, paused: true, playbackRate: 1, duration: 60,
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
  const volg = (deck, t) => { const laag = { video: nepVideo(t), seekDuur: 0.1 }; vm._volg(laag, deck, 0.04); return laag.video; };
  const remmend = { playing: true, position: 10, rate: 1.1, snelheid: 0.5, remt: true };
  const v1 = volg(remmend, 10 - 0.04 * 0.5);
  ok(`rem: de video loopt op de snelheid van NU (${v1.playbackRate.toFixed(3)}, niet de pitchfader 1,1) en springt niet`,
    Math.abs(v1.playbackRate - 0.5) < 1e-6 && v1.currentTime === 10 - 0.04 * 0.5 && !v1.paused);
  const wachtend = { playing: true, wacht: true, position: 8, rate: 1, snelheid: 1 };
  const v2 = volg(wachtend, 8 - 0.04);
  ok('wacht op de maat: het beeld staat stil (gepauzeerd), niet meelopen', v2.paused);
  const fx = { rgb: 0.3, pixel: 0 };
  const r = metPuls(fx, 'rgb', 0.5, 1);
  ok('puls komt bovenop de knop', Math.abs(r.fx.rgb - 0.8) < 1e-9 && r.flits === 0);
  ok('het origineel blijft staan', fx.rgb === 0.3);
  ok('niet boven 1', metPuls({ rgb: 0.9 }, 'rgb', 1, 1).fx.rgb === 1);
  ok('flits is een eigen waarde', metPuls(fx, 'flits', 0.6, 0.5).flits === 0.3);
  ok('diepte 0: niets', metPuls(fx, 'pixel', 0, 1).fx.pixel === 0);
  ok('elk doel behalve flits is een echt effect', PULS_DOELEN.filter((d) => d !== 'flits').every((d) => d in { rgb: 0, pixel: 0, spiegel: 0, korrel: 0 }));
}

console.log('\nde puls op een nieuwe sectie (secties verweven, docs/SECTIES.md)');
{
  // Geen nieuw puls-doel (PULS_DOELEN loopt rond in het handelingenlog) en geen
  // nieuwe knop: een nieuwe sectie van de maatgever (sectie.nieuw, dezelfde als
  // de vormen) is een ACCENT op de puls die er al is. Vol, wat de diepte ook is.
  const { metPuls, PULS_DOELEN } = await import('../src/video/puls.js');
  const M = await import('../src/analysis/maat.js');
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  const { VideoMixer } = await import('../src/video/video-mixer.js');
  const fx = { rgb: 0.3, pixel: 0 };
  ok('PULS_DOELEN niet veranderd (een rondloper in het log, read = plek / 4)', PULS_DOELEN.join() === 'rgb,pixel,spiegel,korrel,flits');
  ok('metPuls zonder accent: precies als vroeger', bij(metPuls(fx, 'rgb', 0.5, 1).fx.rgb, 0.8) && bij(metPuls(fx, 'flits', 0.6, 0.5).flits, 0.3)
    && metPuls(fx, 'pixel', 0, 1).fx.pixel === 0);
  ok('een nieuwe sectie (accent) slaat VOL, ook met de puls zacht: een flits',
    metPuls(fx, 'flits', 0.1, 0, 1).flits === 1 && bij(metPuls(fx, 'flits', 0.1, 1, 0.5).flits, 0.5));
  ok('…op elk doel (rgb: knop + accent, niet boven 1)', bij(metPuls(fx, 'rgb', 0.1, 0, 0.5).fx.rgb, 0.8) && metPuls(fx, 'rgb', 0.1, 0, 1).fx.rgb === 1);
  ok('de tel wint als die sterker is', bij(metPuls(fx, 'flits', 0.8, 1, 0.3).flits, 0.8));
  ok('puls dicht (diepte 0): ook geen accent, de knop op 0 is uit', metPuls(fx, 'flits', 0, 1, 1).flits === 0 && metPuls(fx, 'rgb', 0, 0, 1).fx.rgb === 0.3);
  ok('een accent dat geen getal is doet niets', bij(metPuls(fx, 'flits', 0.4, 1, NaN).flits, 0.4) && bij(metPuls(fx, 'flits', 0.4, 1, undefined).flits, 0.4));

  // De mixer: het accent van de maatgever op de audioklok, op wat je HOORT.
  const ST = [{ van: 0, energie: 0.3 }, { van: 2, energie: 1 }, { van: 3.5, energie: 0.2 }];
  const V = 0.02;                                                     // uitgangsvertraging
  const ctx = { currentTime: 0, outputLatency: V, baseLatency: 0 };
  const A = { id: 'A', playing: true, buffer: {}, ui: { fader: 1 }, rate: 1, onsets: null, grid: new Beatgrid({ bpm: 120, firstBeat: 0 }),
    sectieKaart: { stukken: ST }, get position() { return ctx.currentTime; } };
  let meester = A;
  const engine = { ctx, deck: () => A, xfadeGain: () => 1, syncMaster: () => meester };
  const gl = new Proxy({ TEXTURE0: 1000, getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: (p, n) => n, getAttribLocation: () => 0 },
    { get(t, k) { if (k in t) return t[k]; return () => ({}); } });
  const vm = new VideoMixer({ canvas: { getContext: () => gl }, engine, decks: ['A'] });
  const reeks = () => {
    const r = [];
    for (let i = Math.round(1.5 * 60); i <= Math.round(2.8 * 60); i++) { ctx.currentTime = i / 60; r.push({ hoor: ctx.currentTime - V, a: vm._accentNu?.(V) }); }
    return r;
  };
  ok('puls dicht: geen accent (er wordt niets uitgelezen)', reeks().every((x) => x.a === 0) && !vm.sectieLezer);
  vm.zetPuls(0.2);
  const r = reeks();
  const eerst = r.find((x) => x.hoor >= 2 - 1e-12);
  ok(`puls open: het accent slaat op de sectiegrens zoals je hem HOORT (${eerst.a?.toFixed(2)} op ${eerst.hoor.toFixed(3)} s)`,
    eerst.a >= Math.exp(-(1 / 60) / M.NIEUW_TAU) - 1e-9);
  ok('ervóór niets; erna dooft hij uit zoals sectie.nieuw van de vormen (dezelfde vorm)',
    r.filter((x) => x.hoor < 2 - M.KLAP_OP).every((x) => x.a === 0)
    && r.filter((x) => x.hoor > 2).every((x) => x.a === 0 || bij(x.a, Math.exp(-(x.hoor - 2) / M.NIEUW_TAU), 1e-9)));
  A.ui.fader = 0;
  ok('maatgever die je niet hoort (fader dicht): geen accent', reeks().every((x) => x.a === 0));
  A.ui.fader = 1; meester = null;
  ok('geen maatgever: geen accent', reeks().every((x) => x.a === 0));
  meester = A; A.sectieKaart = null;
  ok('maatgever zonder sectiekaart: geen accent', reeks().every((x) => x.a === 0));
  A.sectieKaart = { stukken: ST };

  // teken(): het accent komt in de effectstap. Doel flits, diepte 0,1: op een
  // gewone tel een zachte flits, op de sectiegrens een volle.
  const maak = (eng) => {
    const u = [];
    const g = new Proxy({ TEXTURE0: 1000, getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
      createProgram: () => ({}), getUniformLocation: (p, n) => ({ p, n }), uniform1f: (loc, v) => { if (loc?.n === 'flits') u.push([loc.p, v]); } },
    { get(t, k) { return k in t ? t[k] : () => ({}); } });
    const m = new VideoMixer({ canvas: { getContext: () => g }, engine: eng, decks: ['A'] });
    return { m, flits: () => u.find(([p]) => p === m.effect)?.[1], wis: () => { u.length = 0; } };
  };
  const H = maak(engine);
  H.m.zetPuls(0.1);
  while (H.m.pulsDoel !== 'flits') H.m.volgendPulsDoel();
  const beelden = (X, m) => {
    const fr = [];
    for (let i = Math.round(1.4 * 60); i <= Math.round(2.4 * 60); i++) { ctx.currentTime = i / 60; X.wis(); m(); fr.push({ hoor: ctx.currentTime - V, f: X.flits() }); }
    return fr;
  };
  const fr = beelden(H, () => H.m.teken());
  const opTel = fr.find((x) => x.hoor >= 1.5 - 1e-12), opGrens = fr.find((x) => x.hoor >= 2 - 1e-12);
  ok(`teken(): op een gewone tel flitst de puls zacht (${opTel.f?.toFixed(3)}), op de sectiegrens vol (${opGrens.f?.toFixed(3)})`,
    opTel.f > 0.05 && opTel.f <= 0.1 + 1e-9 && opGrens.f > 0.9);
  // Het losse venster (de beamer) mengt zelf: het rekent het accent zelf uit, op de engine die het overnam.
  const L = maak({ ctx: { currentTime: 0 }, deck: () => ({}), xfadeGain: () => 1 });
  const frL = beelden(L, () => { L.m.neemOver(H.m); L.m.teken(); });
  const losGrens = frL.find((x) => x.hoor >= 2 - 1e-12);
  ok(`het losse venster ook: vol op de sectiegrens (${losGrens.f?.toFixed(3)})`, losGrens.f > 0.9 && L.m.engine === engine);
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

console.log('\nnoodknoppen op het eindbeeld: zwart, bevriezen, master, flits (A4)');
{
  const { Eindbeeld, standOp, flitsOp, ZWART_FADE, FLITS_DUUR, wandklok } = await import('../src/video/eindbeeld.js');
  const { VideoMixer } = await import('../src/video/video-mixer.js');
  const { bindVideo, invoke, read, list, metaOf, has } = await import('../src/control/actions.js');

  // ---- het rekenwerk, puur --------------------------------------------------
  const eb = new Eindbeeld();
  ok('standaard: niets aan, master 1, beeld ongemoeid', eb.isNeutraal(0) && eb.uniforms(0).helder === 1 && eb.uniforms(0).flits === 0);
  eb.zetZwart(true, 1000);
  const half = eb.uniforms(1000 + ZWART_FADE * 500).helder;
  ok(`zwart (schakelaar) fadet: na de helft van ${ZWART_FADE * 1000} ms half (${half.toFixed(2)}), daarna PRECIES 0`,
    bij(half, 0.5) && eb.uniforms(1000 + ZWART_FADE * 1000).helder === 0 && eb.uniforms(1e9).helder === 0);
  eb.zetZwart(false, 1000 + ZWART_FADE * 250);
  ok('halverwege de fade weer uit: van waar hij stond terug, geen sprong',
    bij(eb.zwartNu(1000 + ZWART_FADE * 250), 0.25) && eb.zwartNu(1000 + ZWART_FADE * 250 + ZWART_FADE * 1000) === 0);
  const e2 = new Eindbeeld();
  e2.zetZwartVast(true, 50);
  ok('drukvariant: direct zwart (geen fade)', e2.uniforms(50).helder === 0);
  e2.zetZwartVast(false, 60);
  ok('loslaten: direct terug', e2.uniforms(60).helder === 1);
  e2.zetZwart(true, 100); e2.zetZwartVast(true, 110); e2.zetZwartVast(false, 120);
  ok('loslaten met de schakelaar aan: blijft zwart', e2.uniforms(120 + ZWART_FADE * 1000).helder === 0 && e2.zwartNu(120) === 1);
  const e3 = new Eindbeeld();
  e3.zetMaster(0.4);
  const masterOk = bij(e3.uniforms(0).helder, 0.4);
  e3.zetMaster(7); const boven = e3.master;
  e3.zetMaster(-1);
  ok('master schaalt, en wordt geklemd', masterOk && boven === 1 && e3.uniforms(0).helder === 0);
  e3.zetMaster(1);
  e3.flits(500);
  ok(`flits: vol wit, dooft uit, na ${FLITS_DUUR * 1000} ms precies weg`,
    e3.uniforms(500).flits === 1 && e3.flitsNu(500 + FLITS_DUUR * 500) > 0 && e3.flitsNu(500 + FLITS_DUUR * 500) < 0.5
    && e3.flitsNu(500 + FLITS_DUUR * 1000) === 0 && flitsOp(null, 0) === 0);
  e3.zetZwartVast(true, 510);
  ok('zwart wint van een flits (zwart moet altijd kunnen)', e3.uniforms(510).helder === 0 && e3.uniforms(510).flits > 0);
  ok('standOp zonder duur = meteen het doel', standOp({ van: 0, naar: 1, t0: 5, duur: 0 }, 0) === 1);
  ok('de klok is absoluut (timeOrigin + now): het losse venster heeft een ander nulpunt voor performance.now()',
    Math.abs(wandklok() - Date.now()) < 1000);

  // ---- de mixer, met een SYMBOLISCHE WebGL ----------------------------------
  // Elke texture houdt bij welk beeld erin staat; een tekenstap schrijft wat
  // hij leest naar zijn framebuffer, en de toonstap zet op het canvas
  // (beeld, flits, helder) zoals de shader. Zo is "wat ziet de zaal" per
  // beeld af te lezen, zonder browser. Elk testbeeld heeft een eigen naam en
  // helderheid; de echte pixels meet tools/headless/noodknoppen.mjs.
  const maakGL = () => {
    let id = 0, cur = null, fb = null, unit = 0;
    const inhoud = new Map(), fbs = new Map(), units = [], u = {}, bronnen = new Map();
    const tel = { meng: 0, effect: 0, toon: 0, lagen: 0, upload: 0 };
    const canvas = { beeld: null, helder: null, flits: null };
    const soort = (p) => { const f = p.frag || ''; return f.includes('vorig') ? 'effect' : f.includes('modus') ? 'meng' : f.includes('basis') ? 'lagen' : 'toon'; };
    const gl = new Proxy({
      TEXTURE0: 1000, TEXTURE_2D: 1, FRAMEBUFFER: 2, ARRAY_BUFFER: 3, FRAGMENT_SHADER: 'f', VERTEX_SHADER: 'v',
      createTexture: () => ({ tex: ++id }), createFramebuffer: () => ({ fb: ++id }),
      createProgram: () => ({ prog: ++id }), createShader: (type) => ({ type }),
      shaderSource: (sh, src) => { bronnen.set(sh, src); },
      attachShader: (p, sh) => { if (sh.type === 'f') p.frag = bronnen.get(sh); },
      getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
      getUniformLocation: (p, n) => `${p.prog}:${n}`,
      useProgram: (p) => { cur = p; },
      uniform1f: (loc, v) => { u[loc] = v; },
      activeTexture: (x) => { unit = x - 1000; },
      bindTexture: (_, t) => { units[unit] = t; },
      bindFramebuffer: (_, f) => { fb = f; },
      framebufferTexture2D: (a, b, c, tex) => { fbs.set(fb, tex); },
      texImage2D: (...a) => { const bron = a.at(-1); tel.upload++; inhoud.set(units[unit], bron && bron.beeld ? { ...bron.beeld } : null); },
      drawArrays: () => {
        const k = soort(cur);
        tel[k]++;
        const leest = inhoud.get(units[0]) ?? null;
        if (k === 'toon' && fb === null) {
          canvas.beeld = leest; canvas.helder = u[`${cur.prog}:helder`] ?? 1; canvas.flits = u[`${cur.prog}:flits`] ?? 0;
        } else if (fb) inhoud.set(fbs.get(fb), leest);
      },
    }, { get(t, k) { return k in t ? t[k] : () => {}; } });
    // Wat de zaal ziet: de helderheid van het beeld op het canvas, door de toonstap.
    const pixel = () => (canvas.beeld ? Math.min(1, Math.max(0, (canvas.beeld.w * (1 - canvas.flits) + canvas.flits) * canvas.helder)) : 0);
    return { gl, canvas, tel, pixel };
  };
  const nepVideo = (beeld) => {
    const luister = {};
    return { paused: true, currentTime: 0, readyState: 4, seeking: false, playbackRate: 1, luister, src: '', beeld,
      addEventListener: (n, f) => { (luister[n] ??= []).push(f); }, removeAttribute() {}, load() {},
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  };
  const deck = { buffer: {}, ui: { fader: 1 }, position: 0, rate: 1, playing: false, grid: null };
  const engine = { ctx: { currentTime: 1, outputLatency: 0, baseLatency: 0 }, deck: () => deck, xfadeGain: () => 1 };
  const maakMixer = (G) => {
    let v = null;
    const m = new VideoMixer({ canvas: { getContext: () => G.gl }, engine, decks: ['A'], maakVideo: () => (v = nepVideo({ naam: 'beeld 1', w: 0.6 })) });
    m.zetBron('A', '/media/a/video.mp4');
    v.luister.loadeddata.forEach((f) => f());
    return { m, video: () => v };
  };
  const druk = (a) => { invoke(a, true); invoke(a, false); };

  const echteNu = performance.now;
  let klok = 1000;
  performance.now = () => klok;
  try {
    const H = maakGL();
    const { m: hoofd, video: hv } = maakMixer(H);
    bindVideo(hoofd);
    hoofd.teken();
    const gewoon = H.canvas.beeld?.naam === 'beeld 1' && bij(H.pixel(), 0.6);
    ok('de vijf actions staan op de bus, met een read (en zonder noodknop is het beeld zoals het was)', gewoon &&
      ['video.black', 'video.black.hold', 'video.freeze', 'video.master', 'video.flash'].every((a) => list().some((x) => x.id === a) && read(a) !== null)
      && metaOf('video.master')?.type === 'value' && metaOf('video.black')?.type === 'trigger' && read('video.master') === 1);

    // zwart via de bus
    druk('video.black');
    ok('video.black: de schakelaar staat aan (read 1)', read('video.black') === 1);
    hoofd.teken();
    ok('meteen na het indrukken: nog het beeld — een fade, geen klap', bij(H.pixel(), 0.6) && read('video.black') === 1);
    klok += ZWART_FADE * 500; hoofd.teken();
    ok('halverwege de fade: half', bij(H.pixel(), 0.3, 1e-6));
    klok += ZWART_FADE * 500; hoofd.teken();
    ok('na de fade: ECHT 0 op het canvas (helder = 0)', H.pixel() === 0 && H.canvas.helder === 0);
    druk('video.flash');
    hoofd.teken();
    ok('een flits tijdens zwart: blijft zwart', H.pixel() === 0 && H.canvas.flits === 1);
    druk('video.black');
    klok += 1000; hoofd.teken();                                 // ook de flits is dan uit
    ok('weer uit: na de fade het hele beeld terug', read('video.black') === 0 && bij(H.pixel(), 0.6));

    invoke('video.black.hold', true);
    hoofd.teken();
    ok('video.black.hold: direct 0 zolang je drukt (read 1)', H.pixel() === 0 && read('video.black.hold') === 1);
    invoke('video.black.hold', false);
    hoofd.teken();
    ok('loslaten: direct terug', bij(H.pixel(), 0.6) && read('video.black.hold') === 0);

    // master
    invoke('video.master', 0.5);
    hoofd.teken();
    ok('video.master 0,5: het eindbeeld half zo helder (read 0,5)', bij(H.pixel(), 0.3) && read('video.master') === 0.5);
    invoke('video.master', 0);
    hoofd.teken();
    ok('video.master 0: zwart', H.pixel() === 0 && H.canvas.beeld?.naam === 'beeld 1');
    invoke('video.master', 1);

    // flits
    klok += 1000;
    druk('video.flash');
    hoofd.teken();
    ok('video.flash: meteen wit (read 1 zolang hij brandt)', H.pixel() === 1 && read('video.flash') === 1);
    klok += FLITS_DUUR * 500; hoofd.teken();
    const tussen = H.pixel();
    ok(`en dooft uit (${tussen.toFixed(2)} na ${FLITS_DUUR * 500} ms)`, tussen < 1 && tussen > 0.6);
    klok += FLITS_DUUR * 500; hoofd.teken();
    ok('na de flits: precies het beeld weer (read 0)', bij(H.pixel(), 0.6) && H.canvas.flits === 0 && read('video.flash') === 0);

    // bevriezen
    hv().beeld = { naam: 'beeld 2', w: 0.7 };
    klok += 16; hoofd.teken();
    const volgt = H.canvas.beeld?.naam === 'beeld 2';
    druk('video.freeze');
    klok += 16; hoofd.teken();                                   // het eerste beeld NA het indrukken blijft staan
    hv().beeld = { naam: 'beeld 3', w: 0.2 };
    const voor = { ...H.tel };
    klok += 16; hoofd.teken(); klok += 16; hoofd.teken();
    ok('video.freeze: het beeld (eerst beeld 2, zoals de video) blijft staan terwijl de video verandert (read 1)',
      volgt && H.canvas.beeld?.naam === 'beeld 2' && read('video.freeze') === 1);
    ok('bevroren: niet mengen en geen effecten, wel elke keer tonen (canvas zonder preserveDrawingBuffer); de video wordt wel geüpload',
      H.tel.meng === voor.meng && H.tel.effect === voor.effect && H.tel.toon === voor.toon + 2 && H.tel.upload >= voor.upload + 2);
    invoke('video.black.hold', true); hoofd.teken();
    ok('zwart werkt ook op een bevroren beeld', H.pixel() === 0 && H.canvas.beeld?.naam === 'beeld 2');
    invoke('video.black.hold', false);
    druk('video.freeze');
    klok += 16; hoofd.teken();
    ok('los: meteen het beeld van NU (beeld 3), niet eerst nog het oude', H.canvas.beeld?.naam === 'beeld 3' && read('video.freeze') === 0);

    // ---- het losse venster neemt alles over ---------------------------------
    const L = maakGL();
    const { m: los, video: lv } = maakMixer(L);
    lv().beeld = { naam: 'los 1', w: 0.8 };
    invoke('video.master', 0.5);
    los.neemOver(hoofd); los.teken();
    const losMaster = bij(L.pixel(), 0.4);
    // Tijdens de inloop toont het het beeld van het hoofdvenster, waar master
    // en zwart al in zitten: niet nog eens toepassen.
    los.toonBeeld({ beeld: { naam: 'hoofdcanvas', w: 0.3 } });
    ok('los venster: de master van het hoofdvenster; het geleende beeld van de inloop (toonBeeld) NIET nog eens erdoor',
      losMaster && L.canvas.helder === 1 && L.canvas.flits === 0 && bij(L.pixel(), 0.3));
    invoke('video.master', 1);
    druk('video.black');
    klok += 10; los.neemOver(hoofd); los.teken();
    ok('los venster: zwart fadet ook daar (zelfde klok)', L.pixel() > 0 && L.pixel() < 0.8);
    klok += ZWART_FADE * 1000; los.neemOver(hoofd); los.teken();
    ok('... en is na de fade ECHT 0, zonder dat het hoofdvenster tekent', L.pixel() === 0);
    druk('video.black');
    klok += ZWART_FADE * 1000; los.neemOver(hoofd); los.teken();
    druk('video.flash');
    los.neemOver(hoofd); los.teken();
    ok('los venster: de flits', L.pixel() === 1);
    klok += FLITS_DUUR * 1000; los.neemOver(hoofd); los.teken();
    druk('video.freeze');
    klok += 16; los.neemOver(hoofd); los.teken();
    lv().beeld = { naam: 'los 2', w: 0.1 };
    klok += 16; los.neemOver(hoofd); los.teken();
    const losVast = L.canvas.beeld?.naam === 'los 1';
    druk('video.freeze');
    klok += 16; los.neemOver(hoofd); los.teken();
    ok('los venster: bevroren terwijl zijn eigen video verandert, en weer los', losVast && L.canvas.beeld?.naam === 'los 2');

    // Een mixer die nog nooit getekend heeft (het losse venster neemt over
    // terwijl bevriezen al aan staat): eerst één vers beeld, dan dat vasthouden.
    druk('video.freeze');
    const N = maakGL();
    const { m: nieuw, video: nv } = maakMixer(N);
    nv().beeld = { naam: 'vers', w: 0.5 };
    klok += 16; nieuw.neemOver(hoofd); nieuw.teken();
    nv().beeld = { naam: 'later', w: 0.9 };
    klok += 16; nieuw.neemOver(hoofd); nieuw.teken();
    ok('bevroren bij de overname: eerst één eigen beeld (geen leeg canvas), dan vast', N.canvas.beeld?.naam === 'vers' && nieuw.eindbeeld.bevroren);
    druk('video.freeze');

    // ---- handelingenlog: beginstand en terugspelen ---------------------------
    const { leesStand } = await import('../src/control/handelingen.js');
    const { maakUitvoerder } = await import('../src/control/terugspelen.js');
    druk('video.black');
    invoke('video.master', 0.4);
    const st = leesStand({ engine: { deck: () => deck, focus: null }, tracks: [], herkomst: () => null, acties: list(), lees: read });
    ok('beginstand: zwart en bevriezen als stand, de master als waarde; drukvariant en flits niet',
      st.rond['video.black'] === 1 && st.rond['video.freeze'] === 0 && st.waarden['video.master'] === 0.4
      && !('video.black.hold' in st.rond) && !('video.flash' in st.rond) && !('video.black.hold' in st.waarden));
    druk('video.black');
    invoke('video.master', 1);
    const doe = maakUitvoerder({ engine: {}, tracks: [], laad: async () => false, invoke, read, has });
    await doe.stand(st);
    ok('terugspelen: de beginstand zet zwart en de master terug', read('video.black') === 1 && read('video.master') === 0.4);
    druk('video.freeze');
    await doe.stand({ tracks: [], waarden: {}, rond: {} });          // een log van vóór A4
    ok('een log van vóór de noodknoppen: beeld gewoon te zien (zwart en bevriezen uit)', read('video.black') === 0 && read('video.freeze') === 0);
  } finally { performance.now = echteNu; }
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
