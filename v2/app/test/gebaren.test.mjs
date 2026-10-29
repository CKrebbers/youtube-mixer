// Gebaren (engine/acties-gebaren.js): de stapel per parameter, loslaten op de tel, echo vast,
// rack-gebaren, de pads per recept, en smaak voor gebaren.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';
import { VAST, GEBAREN, specialeVan, padGebaren, STANDAARD_SPECIAAL } from '../src/kern/opstelling/gebaren.js';
import { genereer } from '../src/kern/opstelling/varieer.js';
import { normaliseerRecept } from '../src/kern/opstelling/model.js';
import { beloon, leegSmaak } from '../src/kern/tocht/smaak.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const recept = (n) => JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', `${n}.json`), 'utf8'));
function nepInstrumenten() {
  return {
    instrumenten: ['poly', 'fm', 'schaal', 'drums'].map((soort) => ({ soort, naam: soort })),
    instrument: (ctx, soort) => {
      const p = [0.5, 0.5, 0.5, 0.5];
      const inst = { soort, start: async () => {}, noteOn() {}, noteOff() {}, stil() {}, zetParam: (k, v) => { p[k - 1] = v; }, leesParam: (k) => p[k - 1] ?? null, vernietig() {} };
      return { inst, weg: async () => {} };
    },
  };
}
async function opzet(naam = 'klokwerk') {
  const e = new Engine({ ctx: nepCtx(), audio: { ...nepAudio(), ...nepInstrumenten() }, timer: false });
  await e.klaar;
  e.opstelling.zetRecepten([recept('klokwerk'), recept('nachtstroom')]);
  await e.opstelling.zet(naam, 1);
  for (let i = 0; i < 5; i++) await new Promise((x) => setTimeout(x, 0));
  e.zetFocus(3);
  return e;
}

test('lijst: 8 vaste, 8 speciale per recept, geldig en zonder dubbele; elk gebaar heeft een korte naam', () => {
  assert.equal(VAST.length, 8);
  assert.equal(padGebaren(null).length, 16);
  assert.deepEqual(specialeVan(['breuk', 'breuk', 'bestaat-niet', 'echo']).slice(0, 1), ['breuk'], 'vaste en onbekende vallen weg');
  assert.equal(new Set(specialeVan(['breuk'])).size, 8);
  for (const n of Object.keys(GEBAREN)) assert.ok(GEBAREN[n].kort.length <= 10, n);
  for (const f of ['klokwerk', 'nachtstroom', 'stemmenzee']) {
    const { recept: r, fouten } = normaliseerRecept(recept(f));
    assert.deepEqual(fouten, []);
    assert.equal(r.gebaren.length, 8);
  }
});

test('stapel: dof en dun op hetzelfde filter, in elke volgorde los, zetten het filter precies terug', async () => {
  const e = await opzet();
  const voor = e.bus.lees('track.3.filter');
  e.bus.doe('gebaar.optel', true);   // loslaten meteen
  e.bus.doe('gebaar.dof', 1);
  e.bus.doe('gebaar.dun', 0.5);
  const samen = e.bus.lees('track.3.filter');
  assert.ok(samen > 0.06 && samen < 0.94, 'gecombineerd: ergens ertussen');
  e.bus.doe('gebaar.dof', 0);
  assert.ok(e.bus.lees('track.3.filter') > voor, 'alleen dun nog');
  e.bus.doe('gebaar.dun', 0);
  assert.ok(Math.abs(e.bus.lees('track.3.filter') - voor) < 1e-9, 'precies terug');
});

test('loslaten op de tel: met de klok gaat het pas op de volgende tel terug', async () => {
  const e = await opzet();
  e.zetKlokTempo(120, 0);
  const voor = e.bus.lees('track.3.filter');
  e.bus.doe('gebaar.dof', 1);
  e.bus.doe('gebaar.dof', 0);
  assert.ok(e.bus.lees('track.3.filter') < 0.1, 'nog niet terug');
  const tel = e.klok.tijd(Math.floor(e.klok.tel(e.nu())) + 1);
  e.gebaren.tik(tel - 0.2);
  assert.ok(e.bus.lees('track.3.filter') < 0.1, 'vlak voor de tel nog niet');
  e.gebaren.tik(tel);
  assert.ok(Math.abs(e.bus.lees('track.3.filter') - voor) < 1e-9, 'op de tel terug');
});

test('pads: 1–8 vast, 9–16 van het recept; wat je indrukte laat je los, ook na een wissel van recept', async () => {
  const e = await opzet();
  assert.deepEqual(e.gebaren.padLabels().slice(0, 4), ['echo', 'galm', 'dof', 'dun']);
  assert.equal(e.gebaren.naamVanPad(10), 'breuk', 'klokwerk: pad 10 = breuk');
  e.bus.doe('gebaar.optel', true);
  const f2 = e.bus.lees('track.2.fader');
  e.bus.doe('gebaar.pad.10', 1);
  assert.ok(e.bus.lees('track.2.fader') < 0.01, 'breuk: alles behalve de focus weg');
  e.bus.doe('gebaar.pad.10', 0);
  assert.ok(Math.abs(e.bus.lees('track.2.fader') - f2) < 1e-9);
});

test('echo vast: de worp meteen, het droge geluid pas op de volgende tel weg; loslaten = alles terug', async () => {
  const e = await opzet();
  e.zetKlokTempo(120, 0);
  const fader = e.bus.lees('track.3.fader');
  e.bus.doe('gebaar.echovast', 1);
  assert.equal(e.bus.lees('track.3.fader'), fader, 'het droge geluid nog even');
  const tel = e.klok.tijd(Math.floor(e.klok.tel(e.nu())) + 1);
  e.gebaren.tik(tel);
  assert.ok(e.bus.lees('track.3.fader') < 0.01, 'op de tel weg');
  e.bus.doe('gebaar.optel', true);
  e.bus.doe('gebaar.echovast', 0);
  assert.ok(Math.abs(e.bus.lees('track.3.fader') - fader) < 1e-9);
});

test('smaak: gebaren die je speelt komen vaker op de pads van een nieuw recept', () => {
  let sm = leegSmaak();
  sm = beloon(sm, ['gebaar:galmvast'], 15);
  const tel = { met: 0, zonder: 0 };
  for (let z = 1; z <= 80; z++) {
    if (genereer({ instrumenten: ['poly', 'drums'], smaak: sm }, z).gebaren.includes('galmvast')) tel.met++;
    if (genereer({ instrumenten: ['poly', 'drums'] }, z).gebaren.includes('galmvast')) tel.zonder++;
  }
  assert.ok(tel.met > tel.zonder, `${tel.met} met smaak, ${tel.zonder} zonder`);
  assert.ok(STANDAARD_SPECIAAL.length === 8);
});
