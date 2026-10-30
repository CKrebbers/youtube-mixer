// De meekijkvensters (kaart.html, leren.html): de kaart rekent per control wat hij nu doet en welke kleur
// hij heeft, met dezelfde regels als de lampjes. Hier met de echte Hybride-indeling op de echte engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';
import { Indeling } from '../src/control/indeling.js';
import { Lampjes } from '../src/control/lampjes.js';
import { kaartVan, welkeControl } from '../src/control/kaart.js';
import apc from '../src/control/apparaten/apc40mk2.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HIER, '..', 'indelingen', 'apc40mk2-hybride.json'), 'utf8'));

async function opzet() {
  const e = new Engine({ ctx: nepCtx(), audio: nepAudio(), timer: false, patronenTimers: { zet: () => 0, weg: () => {} } });
  await e.klaar;
  const ind = new Indeling({ bus: e.bus, apparaat: apc, vars: { focus: () => e.focus } });
  ind.voegToe(doc);
  ind.kies('hybride');
  const druk = (c) => { ind.verwerk({ control: c, soort: 'druk' }); ind.verwerk({ control: c, soort: 'los' }); };
  return { e, ind, druk };
}

test('kaart: elke control van de APC staat erin, met de naam uit de indeling', async () => {
  const { ind } = await opzet();
  const k = kaartVan(ind);
  assert.equal(k.size, apc.controls.size);
  assert.equal(k.get('xf').actie, 'tijd.scrub');
  assert.equal(k.get('user').laag, true);
  assert.ok(k.get('fader1').actie, 'fader 1 doet iets');
});

test('kaart: de kleur van een rgb-pad is dezelfde als wat de lampjes sturen', async () => {
  const { ind, druk } = await opzet();
  const lampjes = new Lampjes({ indeling: ind, stuur: () => {}, tel: () => null });
  for (const stap of [() => {}, () => druk('right')]) {
    stap();
    const k = kaartVan(ind);
    const gewild = lampjes.gewild();
    for (const [id, x] of k) {
      if (x.led !== 'rgb') continue;
      const bytes = gewild.get(id);
      assert.equal(apc.kleur[x.kleur] ?? 0, bytes[2], `${id}: ${x.kleur}`);
    }
  }
});

test('kaart: een andere ruimte geeft andere namen op het grid, en welkeControl vindt de knop terug', async () => {
  const { ind, druk } = await opzet();
  const thuis = kaartVan(ind).get('pad5-1').label;
  druk('right');
  const anders = kaartVan(ind).get('pad5-1');
  assert.notEqual(anders.label, thuis);
  assert.equal(welkeControl(ind, anders.actie), 'pad5-1');
  assert.equal(welkeControl(ind, 'bestaat.niet'), null);
});
