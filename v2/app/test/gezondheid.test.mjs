/**
 * M8: de engine bewaakt de AudioContext. Stil terwijl hij liep = een melding die blijft tot hij
 * weer loopt; een handeling zet hem weer aan (hooguit eens per seconde); vóór de eerste start
 * niets. En een fout van de afspeelmotor wordt altijd gemeld, ook als hij doorspeelt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';
import { maakKern, planSegmenten } from '../src/audio/speler-kern.js';

/** Een nep-context met state en statechange, zoals de browser hem heeft. */
function ctxMetStand(begin = 'running') {
  const ctx = nepCtx();
  const doel = new EventTarget();
  ctx.state = begin;
  ctx.resumes = 0;
  ctx.addEventListener = doel.addEventListener.bind(doel);
  ctx.zet = (s) => { ctx.state = s; doel.dispatchEvent(new Event('statechange')); };
  ctx.resume = async () => { ctx.resumes++; ctx.zet('running'); };
  return ctx;
}

async function engineMet(ctx) {
  const e = new Engine({ ctx, audio: nepAudio(), tracks: 2, timer: false });
  await e.klaar;
  const meldingen = [];
  e.on('melding', (m) => meldingen.push(m));
  return { e, meldingen };
}

test('stil terwijl hij liep: één melding met sleutel audio; weer aan: "loopt weer" onder dezelfde sleutel', async () => {
  const ctx = ctxMetStand('running');
  const { meldingen } = await engineMet(ctx);
  ctx.zet('suspended');
  assert.equal(meldingen.length, 1);
  assert.equal(meldingen[0].sleutel, 'audio');
  assert.equal(meldingen[0].soort, 'fout');
  assert.match(meldingen[0].tekst, /staat stil/);
  ctx.zet('running');
  assert.equal(meldingen.length, 2);
  assert.equal(meldingen[1].sleutel, 'audio');
  assert.match(meldingen[1].tekst, /loopt weer/);
});

test('vóór de eerste start meldt hij niets (Chrome wacht op een klik)', async () => {
  const ctx = ctxMetStand('suspended');
  const { e, meldingen } = await engineMet(ctx);
  e.bus.doe('mixer.xfader', 0.3);
  assert.equal(meldingen.filter((m) => m.sleutel === 'audio').length, 0);
  assert.equal(ctx.resumes, 0, 'de knop "geluid aan" doet dat, niet de engine');
});

test('een handeling zet hem weer aan, hooguit eens per seconde', async () => {
  const ctx = ctxMetStand('running');
  const { e } = await engineMet(ctx);
  ctx.resume = async () => { ctx.resumes++; };          // hij wil niet: blijft stil
  ctx.zet('suspended');
  e.bus.doe('mixer.xfader', 0.3);
  e.bus.doe('mixer.xfader', 0.4);
  e.bus.doe('mixer.xfader', 0.5);
  assert.equal(ctx.resumes, 1, 'drie handelingen binnen een seconde: één poging');
});

test('closed is geen storing om te herstellen: geen poging', async () => {
  const ctx = ctxMetStand('running');
  const { e, meldingen } = await engineMet(ctx);
  ctx.zet('closed');
  e.bus.doe('mixer.xfader', 0.3);
  assert.equal(ctx.resumes, 0);
  assert.equal(meldingen.filter((m) => m.sleutel === 'audio').length, 0);
});

test('de kern telt segmenten die hij weigert (de worklet meldt ze, de rest speelt door)', () => {
  const k = maakKern(48000);
  planSegmenten(k, [{ T: 'x', P: 0, R: 1, speelt: true }]);
  assert.equal(k.ongeldig, 1);
  k.ongeldig = 0;
  planSegmenten(k, [{ T: 0, P: 0, R: 1, speelt: true }, { T: 1, P: NaN, R: 1, speelt: true }, { T: 2, P: 0, R: -1, speelt: true }, { T: 3, P: 1, R: 1, speelt: true }]);
  assert.equal(k.ongeldig, 2);
  assert.equal(k.sN, 2, 'de geldige staan erin');
});

test('een fout van de motor: kapot = "speelt stil", anders alleen wat er gebeurde', async () => {
  const ctx = ctxMetStand('running');
  const { e, meldingen } = await engineMet(ctx);
  e.track(1).speler.onfout('2 ongeldig(e) segment(en) overgeslagen', false);
  e.track(2).speler.onfout('RangeError', true);
  assert.doesNotMatch(meldingen[0].tekst, /speelt stil/);
  assert.match(meldingen[1].tekst, /speelt stil/);
  assert.equal(meldingen[0].sleutel, 'speler:1');
});
