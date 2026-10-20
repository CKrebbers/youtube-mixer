// De noodknoppen (oogst beeld-032 … -034): zwart wint en is precies 0, de fade loopt op de WANDklok,
// bevriezen houdt een eindbeeld van NA het indrukken vast. En de puls op de tel van de maatklok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Eindbeeld, eindUniforms, standOp, flitsOp, ZWART_FADE, FLITS_DUUR } from '../src/beeld/eindbeeld.js';
import { Beeld } from '../src/beeld/stand.js';
import { VideoMixer } from '../src/beeld/mixer.js';
import { klokPuls, klokFase, pulsVorm, metPuls } from '../src/beeld/puls.js';
import { Klok } from '../src/kern/klok.js';
import { nepCanvas, nepEngine } from './beeld-nep.mjs';

test('zwart wint van alles en is PRECIES 0, ook met een flits en master op vol', () => {
  const e = new Eindbeeld();
  e.zetMaster(1);
  e.flits(1000);
  e.zetZwartVast(true, 1000);
  const u = e.uniforms(1000);
  assert.equal(u.helder, 0, 'helder precies 0');
  assert.equal(u.flits, 1, 'de flits staat er wel, maar valt onder × helder');
  e.zetZwartVast(false, 1000);
  assert.equal(e.uniforms(1000).helder, 1, 'drukvariant los = meteen terug (de schakelaar staat uit)');
});

test('zwart als schakelaar: lineair in 250 ms op de wandklok, ook als de audioklok stilstaat', () => {
  const e = new Eindbeeld();
  e.zetZwart(true, 5000);
  assert.equal(e.uniforms(5000).helder, 1);
  assert.ok(Math.abs(e.uniforms(5000 + ZWART_FADE * 500).helder - 0.5) < 1e-9, 'halverwege half');
  assert.equal(e.uniforms(5000 + ZWART_FADE * 1000).helder, 0, 'na 250 ms precies 0');
  e.zetZwart(false, 5100 + ZWART_FADE * 1000);
  assert.equal(e.uniforms(5100 + ZWART_FADE * 1000).helder, 0, 'uit begint vanaf waar hij stond');
  assert.equal(e.uniforms(5100 + ZWART_FADE * 2000).helder, 1);
  // Halverwege omdraaien: vanaf de stand van nu, geen sprong.
  e.zetZwart(true, 10000);
  e.zetZwart(false, 10000 + 100);
  assert.ok(Math.abs(standOp(e.zwart, 10100) - 0.4) < 1e-9);
});

test('master en flits: master schaalt, flits dooft kwadratisch uit in 300 ms', () => {
  const e = new Eindbeeld();
  e.zetMaster(0.25);
  assert.equal(e.uniforms(0).helder, 0.25);
  e.zetMaster(7);
  assert.equal(e.master, 1, 'geklemd op 0..1');
  assert.equal(flitsOp(1000, 1000), 1);
  assert.ok(Math.abs(flitsOp(1000, 1000 + FLITS_DUUR * 500) - 0.25) < 1e-9);
  assert.equal(flitsOp(1000, 1000 + FLITS_DUUR * 1000), 0);
});

test('eindUniforms werkt op de VELDEN (de stand van het hoofdvenster), zonder methodes', () => {
  const e = new Eindbeeld();
  e.zetZwart(true, 0);
  const kaal = JSON.parse(JSON.stringify(e));
  assert.deepEqual(eindUniforms(kaal, 100), e.uniforms(100));
  const uit = { helder: 9, flits: 9 };
  assert.equal(eindUniforms(kaal, 300, uit), uit, 'schrijft in het meegegeven object (geen afval per beeld)');
  assert.equal(uit.helder, 0);
});

test('Beeld: de noodknoppen op zijn wandklok, bevriezen onthoudt het moment', () => {
  let ms = 2000;
  const b = new Beeld({ klok: () => ms });
  b.zetBevroren(true);
  assert.equal(b.eind.bevrorenSinds, 2000);
  ms = 3000;
  b.zetBevroren(true);
  assert.equal(b.eind.bevrorenSinds, 2000, 'nog eens aanzetten verzet het moment niet');
  b.flits();
  assert.equal(b.flitsNu(), 1);
});

test('mixer bevroren: eerst één vers eindbeeld, daarna alleen nog tonen (beeld-034)', () => {
  let ms = 1000;
  const engine = nepEngine();
  const canvas = nepCanvas();
  const mixer = new VideoMixer({ canvas, klokMs: () => ms, wand: () => ms });
  const beeld = new Beeld({ klok: () => ms });
  const gl = canvas.gl;
  mixer.teken(engine, beeld);
  assert.equal(gl.log.draws, 3, 'gewoon: mengen, effecten, tonen');
  ms = 2000;
  beeld.zetBevroren(true);
  mixer.teken(engine, beeld);
  assert.equal(gl.log.draws, 6, 'het eerste beeld NA het indrukken wordt nog gemaakt');
  const eind = mixer.laatsteEindMs;
  ms = 2100;
  mixer.teken(engine, beeld);
  mixer.teken(engine, beeld);
  assert.equal(gl.log.draws, 8, 'daarna: alleen de toonstap (het canvas is na elk beeld leeg)');
  assert.equal(mixer.laatsteEindMs, eind, 'het eindbeeld blijft staan');
  // Zwart werkt ook bevroren: het zit in de toonstap.
  beeld.zetZwartVast(true);
  mixer.teken(engine, beeld);
  assert.equal(gl.log.uniform.get('helder'), 0);
  beeld.zetZwartVast(false);
  beeld.zetBevroren(false);
  mixer.teken(engine, beeld);
  assert.equal(gl.log.draws, 12, 'los: weer drie stappen');
  assert.equal(gl.log.uniform.get('helder'), 1);
});

test('puls op de tel van de KLOK zoals je hem hoort: tel(nu − V), knopstand verandert niet', () => {
  const klok = new Klok();
  klok.start(0, 0, 120);                 // 2 tellen per seconde
  const V = 0.05;
  assert.equal(klokPuls({ loopt: false }, 10, V), 0, 'klok staat stil: geen puls');
  // Vlak NA de tel die je hoort (niet precies erop: afronding, beeld-018).
  const nuOpTel = 10 + V + 0.001;
  assert.ok(klokPuls(klok, nuOpTel, V) > 0.98, 'net na de gehoorde tel: vol');
  assert.ok(Math.abs(klokFase(klok, 10 + V + 0.25, V) - 0.5) < 1e-9, 'halve tel later: fase 0,5');
  assert.ok(Math.abs(klokPuls(klok, 10 + V + 0.25, V) - pulsVorm(0.5)) < 1e-12);
  assert.ok(klokPuls(klok, 10 + 0.001, V) < 0.2, 'zonder de vertraging zou hij V te vroeg slaan');

  const fx = { pixel: 0, spiegel: 0, rgb: 0.3, kleur: 0.5, sporen: 0, korrel: 0 };
  const uit = {};
  const r = metPuls(fx, 'rgb', 0.5, 1, 0, uit);
  assert.equal(r, uit);
  assert.ok(Math.abs(r.rgb - 0.8) < 1e-12 && fx.rgb === 0.3, 'de puls komt bovenop de knop; de knop zelf blijft 0,3');
  assert.equal(metPuls(fx, 'flits', 0.5, 1, 0, uit).flits, 0.5);
  assert.equal(metPuls(fx, 'rgb', 0, 1, 1, uit).rgb, 0.3, 'diepte 0 = uit, ook voor het accent');
});

test('mixer: de puls gaat via de klok van de engine in de effectstap', () => {
  const klok = new Klok();
  klok.start(0, 0, 120);
  const engine = nepEngine({ klok, V: 0.05 });
  engine.tijd = 20 + 0.05 + 0.002;       // net na een gehoorde tel
  const canvas = nepCanvas();
  const mixer = new VideoMixer({ canvas, klokMs: () => 1000, wand: () => 1000 });
  const beeld = new Beeld({ klok: () => 1000 });
  beeld.zetFx('rgb', 0.2);
  mixer.teken(engine, beeld);
  assert.equal(canvas.gl.log.uniform.get('rgb'), 0.2, 'puls dicht: de knopstand');
  beeld.zetPuls(0.5);
  mixer.teken(engine, beeld);
  assert.ok(canvas.gl.log.uniform.get('rgb') > 0.68, `puls open, op de tel: 0,2 + 0,5 × ~1 (${canvas.gl.log.uniform.get('rgb')})`);
  engine.tijd += 0.25;                    // een halve tel later
  mixer.teken(engine, beeld);
  assert.ok(Math.abs(canvas.gl.log.uniform.get('rgb') - (0.2 + 0.5 * pulsVorm(0.5 + 0.004))) < 1e-6, 'halve tel: 8% over');
  assert.equal(beeld.stand.fx.rgb, 0.2, 'de stand van de knop is niet veranderd');
  beeld.volgendPulsDoel(); beeld.volgendPulsDoel(); beeld.volgendPulsDoel(); beeld.volgendPulsDoel();   // rgb → pixel → spiegel → korrel → flits
  engine.tijd += 0.25;
  mixer.teken(engine, beeld);
  const flits = canvas.gl.log.uniform.get(`flits@${mixer.effect.id}`);
  assert.ok(flits > 0.48, `doel flits: de lichtflits op de tel, in de effectstap (${flits})`);
  assert.equal(canvas.gl.log.uniform.get(`flits@${mixer.toon.id}`), 0, 'niet de noodknop-flits van de toonstap');
});
