// De Maschine MK2 in v2: het apparaat (control/apparaten/maschine-mk2.js) en de indeling
// indelingen/maschine-mk2.json tegen de echte bus van de engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';
import { Indeling, normaliseerIndeling } from '../src/control/indeling.js';
import { Lampjes } from '../src/control/lampjes.js';
import maschine, { ontleed, alleUit, CONTROLS, relatief } from '../src/control/apparaten/maschine-mk2.js';
import { parseBericht } from '../src/control/midi.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HIER, '..', 'indelingen', 'maschine-mk2.json'), 'utf8'));
const bericht = (b) => ontleed(parseBericht(Uint8Array.from(b)));

test('apparaat: 16 pads, 48 knoppen, 8 draaiknoppen en het wiel; nummers zoals de hub ze maakt', () => {
  assert.equal(CONTROLS.length, 16 + 48 + 9);
  assert.deepEqual(bericht([0x90, 36, 100]), { control: 'pad1', soort: 'druk', waarde: 1, ruw: 100 });
  assert.equal(bericht([0x80, 51, 0]).control, 'pad16');
  assert.equal(bericht([0x80, 51, 0]).soort, 'los');
  assert.equal(bericht([0x91, 39, 127]).control, 'shift');
  assert.equal(bericht([0x91, 24, 127]).control, 'groepA');
  assert.equal(bericht([0x91, 36, 127]).control, 'play');
  const d = bericht([0xb0, 16, 125]);
  assert.equal(d.control, 'enc1');
  assert.equal(d.delta, -3);
  assert.equal(bericht([0xb0, 24, 1]).control, 'masterwiel');
  assert.equal(relatief(64), -64);
  assert.ok(alleUit().every((b) => b[2] === 0));
  assert.ok(!alleUit().some((b) => b[0] === 0x91 && b[1] === 23), 'het wiel heeft geen lampje');
});

async function opzet() {
  const e = new Engine({ ctx: nepCtx(), audio: nepAudio(), timer: false });
  await e.klaar;
  return e;
}

test('indeling: elke regel geldig tegen de echte bus', async () => {
  const e = await opzet();
  const { fouten } = normaliseerIndeling(doc, { apparaat: maschine, soortVan: (id) => e.bus.zoek(id)?.def?.soort ?? null });
  assert.deepEqual(fouten, []);
});

test('draaien: één omwenteling (≈1000 tellen) = het hele bereik; SHIFT = fijn', async () => {
  const e = await opzet();
  e.opstelling.zetRecepten([JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', 'klokwerk.json'), 'utf8'))]);
  await e.opstelling.zet('klokwerk', 1);
  const ind = new Indeling({ bus: e.bus, apparaat: maschine, vars: { focus: () => e.focus } });
  ind.voegToe(doc);
  e.bus.doe('opstelling.macro.1', 0);
  ind.verwerk({ control: 'enc1', soort: 'delta', delta: 250 });
  assert.ok(Math.abs(e.bus.lees('opstelling.macro.1') - 0.5) < 1e-9);
  ind.verwerk({ control: 'shift', soort: 'druk' });
  ind.verwerk({ control: 'enc1', soort: 'delta', delta: 100 });
  ind.verwerk({ control: 'shift', soort: 'los' });
  assert.ok(Math.abs(e.bus.lees('opstelling.macro.1') - 0.52) < 1e-9);
});

test('wiel kiest het recept, indrukken laadt; groep C = focus 3; lampjes gaan naar de Maschine', async () => {
  const e = await opzet();
  const r = (n) => JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', `${n}.json`), 'utf8'));
  e.opstelling.zetRecepten([r('klokwerk'), r('nachtstroom')]);
  const ind = new Indeling({ bus: e.bus, apparaat: maschine, vars: { focus: () => e.focus } });
  ind.voegToe(doc);
  ind.verwerk({ control: 'masterwiel', soort: 'delta', delta: 1 });
  assert.equal(e.opstelling.stand().kandidaat, 'Nachtstroom');
  ind.verwerk({ control: 'wiel', soort: 'druk' }); ind.verwerk({ control: 'wiel', soort: 'los' });
  for (let i = 0; i < 5; i++) await new Promise((x) => setTimeout(x, 0));
  assert.equal(e.opstelling.stand().recept, 'nachtstroom');
  ind.verwerk({ control: 'groepC', soort: 'druk' }); ind.verwerk({ control: 'groepC', soort: 'los' });
  assert.equal(e.focus, 3);
  const uit = [];
  const l = new Lampjes({ indeling: ind, stuur: (b) => uit.push([...b]), nu: () => 0, timers: { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} } });
  l.init();
  l.tik?.();
  assert.ok(uit.some((b) => b[0] === 0x90 && b[1] >= 40 && b[1] <= 47 && b[2] > 0), 'scene-pads hebben een kleur');
});
