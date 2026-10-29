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

function nepInstrumenten() {
  return {
    instrumenten: ['poly', 'fm', 'schaal', 'drums'].map((soort) => ({ soort, naam: soort })),
    instrument: (ctx, soort) => {
      const params = [0.5, 0.5, 0.5, 0.5];
      const inst = { soort, start: async () => {}, noteOn() {}, noteOff() {}, stil() {}, zetParam: (k, v) => { params[k - 1] = v; }, leesParam: (k) => params[k - 1] ?? null, vernietig() {} };
      return { inst, weg: async () => {} };
    },
  };
}

async function opzet() {
  const e = new Engine({ ctx: nepCtx(), audio: { ...nepAudio(), ...nepInstrumenten() }, timer: false });
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

test('wiel kiest het recept, indrukken laadt; SHIFT+groep C = focus 3; lampjes gaan naar de Maschine', async () => {
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
  ind.verwerk({ control: 'shift', soort: 'druk' });
  ind.verwerk({ control: 'groepC', soort: 'druk' }); ind.verwerk({ control: 'groepC', soort: 'los' });
  ind.verwerk({ control: 'shift', soort: 'los' });
  assert.equal(e.focus, 3, 'SHIFT + groep C = focus 3');
  const uit = [];
  const l = new Lampjes({ indeling: ind, stuur: (b) => uit.push([...b]), nu: () => 0, timers: { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} } });
  l.init();
  l.tik?.();
  assert.ok(uit.some((b) => b[0] === 0x90 && b[1] >= 40 && b[1] <= 47 && b[2] > 0), 'scene-pads hebben een kleur');
});

test('druk: een pad met gedrag druk zet de aanslag, volgt de aftertouch en gaat bij loslaten naar 0', async () => {
  const e = await opzet();
  const ind = new Indeling({ bus: e.bus, apparaat: maschine, vars: { focus: () => e.focus } });
  ind.voegToe(doc);
  const g = [];
  e.bus.on('actie', (a) => { if (a.id === 'gebaar.dof') g.push(a.v); });
  ind.verwerk({ control: 'groepA', soort: 'druk' }); ind.verwerk({ control: 'groepA', soort: 'los' });   // tik: padstand gebaren
  assert.deepEqual(ind.open, ['pads.gebaren']);
  ind.verwerk(bericht([0x90, 38, 64]));     // pad 3 = dof, aanslag 64
  ind.verwerk(bericht([0xa0, 38, 120]));    // dieper drukken
  ind.verwerk(bericht([0xa0, 38, 2]));      // bijna los: nooit onder DRUK_MIN
  ind.verwerk(bericht([0x80, 38, 0]));
  assert.equal(g.length, 4);
  assert.ok(Math.abs(g[0] - 64 / 127) < 1e-9);
  assert.ok(Math.abs(g[1] - 120 / 127) < 1e-9);
  assert.equal(g[2], 0.1);
  assert.equal(g[3], 0);
  ind.verwerk({ control: 'groepF', soort: 'druk' }); ind.verwerk({ control: 'groepF', soort: 'los' });
  assert.deepEqual(ind.open, [], 'groep F = terug naar de basis');
});

test('gebaar: een track die iets draagt duwt zijn filter weg en zet het precies terug', async () => {
  const e = await opzet();
  e.opstelling.zetRecepten([JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', 'klokwerk.json'), 'utf8'))]);
  await e.opstelling.zet('klokwerk', 1);
  for (let i = 0; i < 5; i++) await new Promise((x) => setTimeout(x, 0));
  e.zetFocus(3);
  const voor = e.bus.lees('track.3.filter');
  e.bus.doe('gebaar.dof', 1);
  assert.ok(e.bus.lees('track.3.filter') < 0.1);
  e.bus.doe('gebaar.dof', 0);
  assert.ok(Math.abs(e.bus.lees('track.3.filter') - voor) < 1e-9);
  const f2 = e.bus.lees('track.2.fader');
  e.bus.doe('gebaar.breuk', 1);
  assert.ok(e.bus.lees('track.2.fader') < 0.01, 'breuk: de andere tracks weg');
  e.bus.doe('gebaar.breuk', 0);
  assert.ok(Math.abs(e.bus.lees('track.2.fader') - f2) < 1e-9);
});

test('partituur: variant wisselt (zonder klok meteen), rij zet alles, stop zet de fader weg en terug; morph en glijden', async () => {
  const e = await opzet();
  e.opstelling.zetRecepten([JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', 'klokwerk.json'), 'utf8'))]);
  await e.opstelling.zet('klokwerk', 1);
  for (let i = 0; i < 5; i++) await new Promise((x) => setTimeout(x, 0));
  assert.equal(e.bus.lees('opstelling.variant.1.3'), 1, 'rij 3 = wat het recept koos');
  e.bus.doe('opstelling.variant.1.1', true);
  const rustig = e.patronen.patroon(1, 5).noten.length;
  e.bus.doe('opstelling.variant.1.5', true);
  assert.equal(e.bus.lees('opstelling.variant.1.5'), 1);
  assert.ok(e.patronen.patroon(1, 5).noten.length > rustig, 'rij 5 is voller dan rij 1');
  e.bus.doe('opstelling.rij.1', true);
  assert.ok([1, 2, 3, 4].every((k) => e.bus.lees(`opstelling.variant.${k}.1`) === 1));
  assert.equal(e.bus.lees('opstelling.variant.6.1'), null, 'een spoor dat er niet is: uit');
  const f = e.bus.lees('track.2.fader');
  e.bus.doe('opstelling.stop.2', true);
  assert.equal(e.bus.lees('track.2.fader'), 0);
  e.bus.doe('opstelling.stop.2', true);
  assert.equal(e.bus.lees('track.2.fader'), f);
  const d0 = e.bus.lees('opstelling.macro.2');
  e.bus.doe('opstelling.b.3', true);   // vol: dichtheid 0,85..1
  e.bus.doe('opstelling.morph', 1);
  assert.ok(e.bus.lees('opstelling.macro.2') >= 0.85);
  e.bus.doe('opstelling.morph', 0);
  assert.ok(Math.abs(e.bus.lees('opstelling.macro.2') - d0) < 1e-9, 'terug naar waar je was');
  e.zetKlokTempo(120, 0);
  e.bus.doe('opstelling.glij.1', true);   // kaal: dichtheid 0..0,15
  const t0 = e.klok.tijd(e.klok.tel(e.nu()));
  for (let t = 0; t <= 9; t += 0.25) e.opstelling.tik(t0 + t);
  assert.ok(e.bus.lees('opstelling.macro.2') <= 0.15 + 1e-9, 'na vier maten (8 s op 120) aangekomen');
});
