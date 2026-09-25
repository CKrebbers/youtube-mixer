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
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
