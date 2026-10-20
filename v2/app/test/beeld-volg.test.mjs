// Video als slaaf van wat je HOORT (oogst beeld-001 … -004, -008): het rekenwerk (volg.js) en de
// mixer met een nep-WebGL en nep-<video>'s: bijsturen, springen met een GEMETEN seekduur, en pauze
// (en niets uploaden) als hij onzichtbaar is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synchroniseer, inDePas, doelVan, SPRING_VANAF, MAX_BIJSTUUR } from '../src/beeld/volg.js';
import { VideoMixer } from '../src/beeld/mixer.js';
import { Beeld } from '../src/beeld/stand.js';
import { nepCanvas, nepVideo, nepTrack, nepEngine } from './beeld-nep.mjs';

const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('synchroniseer: klein verschil = bijsturen, hooguit ±10%, proportioneel', () => {
  const r = synchroniseer({ videoTijd: 10, doel: 10.05, rate: 1, speelt: true });
  assert.equal(r.spring, null);
  assert.ok(bij(r.rate, 1.1), `50 ms achter = 10% sneller (${r.rate})`);
  const v = synchroniseer({ videoTijd: 10, doel: 9.99, rate: 1.2, speelt: true });
  assert.ok(bij(v.rate, 1.2 * (1 - 0.02)), '10 ms voor = 2% trager, op de snelheid van de track');
  const max = synchroniseer({ videoTijd: 10, doel: 10 + SPRING_VANAF - 0.001, rate: 1, speelt: true });
  assert.ok(bij(max.rate, 1 + MAX_BIJSTUUR), 'nooit meer dan 10%');
});

test('synchroniseer: boven 150 ms springen, naar waar de audio is ALS de seek klaar is', () => {
  const r = synchroniseer({ videoTijd: 10, doel: 12, rate: 1.05, speelt: true, seekDuur: 0.4 });
  assert.ok(bij(r.spring, 12 + 0.4 * 1.05), `doel + seekDuur × rate (${r.spring})`);
  assert.equal(synchroniseer({ videoTijd: 10, doel: 12, speelt: true, zoekt: true }).spring, null, 'een lopende seek nooit onderbreken');
  assert.equal(synchroniseer({ videoTijd: 5, doel: -1, speelt: true }).spring, 0, 'nooit vóór 0');
});

test('synchroniseer: stilstaand pas springen boven een half beeld, en pauze', () => {
  const a = synchroniseer({ videoTijd: 10, doel: 10.005, speelt: false });
  assert.deepEqual([a.spring, a.speel], [null, false]);
  const b = synchroniseer({ videoTijd: 10, doel: 10.5, speelt: false });
  assert.deepEqual([b.spring, b.speel], [10.5, false], 'stil: precies naar de plek, geen voorsprong');
});

test('doelVan: wat je HOORT = plek(nu − V) op snelheid(nu); stil en wachten = beeld staat', () => {
  const t = nepTrack({ P0: 30, T0: 0, R: 1.04 });
  const d = doelVan(t, 10, 0.05);
  assert.ok(bij(d.doel, 30 + 9.95 * 1.04), `plek op nu − V (${d.doel})`);
  assert.ok(bij(d.rate, 1.04) && d.speelt);
  const stil = doelVan(nepTrack({ P0: 42, speelt: false }), 10, 0.05);
  assert.deepEqual([stil.doel, stil.speelt], [42, false], 'stilstaand: zijn plek, geen seek bij een pauze');
  const wacht = doelVan(nepTrack({ P0: 8, speelt: true, wachtTot: 12 }), 10, 0.05);
  assert.deepEqual([wacht.doel, wacht.speelt], [8, false], 'wacht op de maat = speelt niet, beeld blijft staan (beeld-004)');
});

test('inDePas: alleen de zichtbare, een fout telt niet mee, n beperkt de lijst', () => {
  assert.ok(inDePas([]));
  assert.ok(inDePas([{ klaar: true, zoekt: false, verschil: 0.04 }, { fout: true }]));
  assert.ok(!inDePas([{ klaar: true, zoekt: true, verschil: 0 }]));
  assert.ok(!inDePas([{ klaar: true, zoekt: false, verschil: 0.06 }]));
  assert.ok(inDePas([{ klaar: true, zoekt: false, verschil: 0 }, { klaar: false }], undefined, 1), 'alleen de eerste n');
});

/** Een mixer met nep-WebGL, één track met video en een stand. */
function opzet({ V = 0.05 } = {}) {
  const engine = nepEngine({ V });
  const canvas = nepCanvas();
  let ms = 1000;                 // niet 0: een seekStart van 0 is "geen sprong"
  const videos = [];
  const mixer = new VideoMixer({ canvas, maakVideo: () => { const v = nepVideo(); videos.push(v); return v; }, klokMs: () => ms, wand: () => ms });
  const beeld = new Beeld({ klok: () => ms });
  engine.tracks[0] = nepTrack({ P0: 20, T0: 0, R: 1 });
  beeld.zetBron(1, '/api/library/x/video');
  const stap = (dt) => {           // dt seconden verder: audioklok, wandklok en de decoder
    engine.tijd += dt; ms += dt * 1000;
    for (const v of videos) v.loop(dt);
    mixer.teken(engine, beeld);
  };
  return { engine, mixer, beeld, videos, gl: canvas.gl, stap, zetMs: (x) => { ms = x; } };
}

test('mixer: een video volgt de plek die je hoort, binnen een beeld na de eerste sprong', () => {
  const o = opzet();
  const t0 = o.engine.tijd;
  o.mixer.teken(o.engine, o.beeld);
  const v = o.videos[0];
  assert.ok(v, 'de bron van de stand werd een <video>');
  assert.equal(v.src, '/api/library/x/video');
  assert.equal(v.sprongen.length, 1, 'ver weg: één sprong, al vóór het eerste beeld binnen is');
  const doel = 20 + (t0 - 0.05);
  assert.ok(Math.abs(v.sprongen[0] - (doel + 0.15)) < 1e-6, `naar het doel + de beginschatting van de seekduur (${v.sprongen[0]})`);
  v.vuur('loadeddata');
  o.stap(1 / 60);
  // Zolang hij zoekt: niets aanraken.
  o.stap(1 / 60); o.stap(1 / 60);
  assert.equal(v.sprongen.length, 1, 'een lopende seek wordt niet onderbroken');
  v.klaarMetZoeken();
  for (let i = 0; i < 60; i++) o.stap(1 / 60);
  const fout = v.currentTime - (20 + o.engine.tijd - 0.05);
  assert.ok(Math.abs(fout) < 1 / 30, `na een seconde binnen één beeld (${(fout * 1000).toFixed(1)} ms)`);
  assert.ok(!v.paused, 'hij speelt');
});

test('mixer: de seekduur wordt gemeten tot het eerste beeld met seeking = false, niet met seeked (beeld-003)', () => {
  const o = opzet();
  const v = (o.mixer.teken(o.engine, o.beeld), o.videos[0]);
  v.vuur('loadeddata');                 // sprong 1 ging in het eerste teken()
  // De sprong duurt 50 beelden; het seeked-event zou onder belasting veel later komen: het telt niet.
  for (let i = 0; i < 49; i++) o.stap(1 / 60);
  v.klaarMetZoeken();
  o.stap(1 / 60);
  const laag = o.mixer.lagen[0];
  const gemeten = 0.15 * 0.7 + (50 / 60) * 0.3;
  assert.ok(Math.abs(laag.seekDuur - gemeten) < 0.01, `seekDuur = EMA met de echte duur (${laag.seekDuur.toFixed(3)} ≈ ${gemeten.toFixed(3)})`);
  // De video liep intussen niet (hij zocht) en ligt nu 0,68 s achter: dezelfde stap springt al
  // opnieuw, en rekent met de net gemeten duur.
  const doel = o.engine.tracks[0].plek(o.engine.tijd - 0.05);
  assert.equal(v.sprongen.length, 2);
  assert.ok(Math.abs(v.sprongen.at(-1) - (doel + laag.seekDuur)) < 1e-6, 'sprong naar doel + gemeten seekduur');
  // Een hotcue (30 s verder) terwijl die sprong nog loopt: wachten, dan pas springen.
  o.engine.tracks[0].P0 += 30;
  o.stap(1 / 60);
  assert.equal(v.sprongen.length, 2, 'eerst de lopende seek af');
  v.klaarMetZoeken();
  o.stap(1 / 60);
  assert.equal(v.sprongen.length, 3);
  assert.ok(v.sprongen.at(-1) > 60, 'daarna naar de nieuwe plek');
});

test('mixer: onzichtbaar (fader dicht, niet spelend, clips uit) = pauze en niet uploaden (beeld-008, -036)', () => {
  const o = opzet();
  o.mixer.teken(o.engine, o.beeld);
  const v = o.videos[0];
  v.vuur('loadeddata');
  o.stap(1 / 60); v.klaarMetZoeken(); o.stap(1 / 60);
  assert.ok(!v.paused);
  const geupload = () => o.gl.log.uploads.filter((x) => x === v).length;
  let n = geupload();
  o.stap(1 / 60);
  assert.equal(geupload(), n + 1, 'zichtbaar: elk beeld geüpload');
  assert.ok(o.gl.log.uniform.get('w')[0] > 0.99, 'gewicht = zaalversterking');

  o.engine.versterking[0] = 0.0005;     // fader (bijna) dicht
  n = geupload();
  o.stap(1 / 60); o.stap(1 / 60);
  assert.ok(v.paused, 'onzichtbaar: gepauzeerd');
  assert.equal(geupload(), n, 'onzichtbaar: niet geüpload');
  assert.equal(o.gl.log.uniform.get('w')[0], 0, 'gewicht 0 in de mengstap');

  o.engine.versterking[0] = 0.7;
  o.stap(1 / 60);
  assert.ok(!v.paused && Math.abs(o.gl.log.uniform.get('w')[0] - 0.7) < 1e-6, 'weer zichtbaar, gewicht 0,7');

  o.beeld.zetClips(false);
  n = geupload();
  o.stap(1 / 60);
  assert.ok(v.paused && geupload() === n && o.gl.log.uniform.get('w')[0] === 0, 'clips uit: alsof hij onzichtbaar is');
  o.beeld.zetClips(true);
  o.engine.tracks[0].speelt = false;
  o.stap(1 / 60);
  assert.ok(v.paused, 'een track die niet speelt heeft zaalversterking 0: geen beeld (wat je hoort, zie je)');
});

test('mixer: een bron weghalen of vervangen geeft de decoder vrij', () => {
  const o = opzet();
  o.mixer.teken(o.engine, o.beeld);
  const v = o.videos[0];
  o.beeld.zetBron(1, '/api/library/y/video');
  o.mixer.teken(o.engine, o.beeld);
  assert.equal(v.src, '', 'de oude video heeft geen src meer');
  assert.equal(o.videos.length, 2);
  o.beeld.zetBron(1, null);
  o.mixer.teken(o.engine, o.beeld);
  assert.equal(o.mixer.lagen[0], null);
});

test('mixer: een video met een fout meldt één keer, een nummer zonder video is geen fout', () => {
  const o = opzet();
  const fouten = [];
  o.mixer.onFout = (n, tekst) => fouten.push([n, tekst]);
  o.mixer.teken(o.engine, o.beeld);
  const v = o.videos[0];
  v.error = { code: 4 };
  v.vuur('error'); v.vuur('error');
  assert.deepEqual(fouten, [[1, 'het bestand ontbreekt of het formaat wordt niet ondersteund']]);
});

test('mixer: zichtbaar en na 10 s nog geen beeld = melding; tijd zonder tekenen telt niet', () => {
  const o = opzet();
  const fouten = [];
  o.mixer.onFout = (n, tekst) => fouten.push(tekst);
  o.mixer.teken(o.engine, o.beeld);
  for (let i = 0; i < 18; i++) o.stap(0.5);  // twee beelden per seconde: 9 s
  assert.equal(fouten.length, 0);
  o.engine.tijd += 30; o.zetMs(1e6);         // lang niet getekend (tabblad verborgen)
  o.stap(1 / 60);
  assert.equal(fouten.length, 0, 'na een pauze in het tekenen begint de teller opnieuw');
  for (let i = 0; i < 22; i++) o.stap(0.5);
  assert.deepEqual(fouten, ['na 10 s nog geen beeld']);
});
