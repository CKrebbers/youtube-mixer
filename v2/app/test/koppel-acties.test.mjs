// De acties van de koppeling (src/koppel/acties.js): de namen van v1 (beeld.macro.*, beeld.regie.*), plus
// beeld.aan; geen botsing met wat de engine, beeld (video.*) en de auto-DJ al op de bus zetten; lees null
// zonder verbinding; de meta (log en beginstand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine/engine.js';
import { Beeld } from '../src/beeld/stand.js';
import { definieerBeeld } from '../src/beeld/acties.js';
import { definieerAuto } from '../src/engine/acties-auto.js';
import { definieerKoppeling, REGIE_LABEL } from '../src/koppel/acties.js';
import { BeeldKoppeling, MACROS, REGIE, MACRO_STANDAARD } from '../src/koppel/beeld.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

function nepZender() {
  const z = { status: { verbonden: false, beeld: null }, poorten: [], start() {}, stop() {},
    track: () => true, mix() {}, poort(id, w) { this.poorten.push(w === undefined ? [id] : [id, w]); return true; }, on: () => () => {} };
  return z;
}

async function opzet() {
  const e = new Engine({ ctx: nepCtx(), audio: nepAudio(), timer: false });
  await e.klaar;
  definieerBeeld(e.bus, new Beeld({ klok: () => 0 }));
  definieerAuto(e.bus, {});
  const bestond = new Set(e.bus.ids());
  let z = null;
  const k = new BeeldKoppeling({ engine: e, maakZender: () => (z = nepZender()), timers: { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} }, nu: () => 0 });
  const ids = definieerKoppeling(e.bus, k);
  return { e, bus: e.bus, k, ids, bestond, zender: () => z };
}

test('de namen van v1 en beeld.aan; niets botst met de engine, beeld (video.*) of de auto-DJ', async () => {
  const { bus, ids, bestond } = await opzet();
  const verwacht = [...MACROS.map((p) => `beeld.${p}`), ...REGIE.map((p) => `beeld.regie.${p.split('!')[1]}`), 'beeld.aan'];
  assert.deepEqual(ids, verwacht);
  for (const id of ids) {
    assert.ok(!bestond.has(id), `${id} bestond al`);
    assert.equal(bus.zoek(id).def.id, id, `${id} valt niet onder een sjabloon`);
  }
  assert.ok(![...bestond].some((id) => id.startsWith('beeld.')), 'de rest van v2 gebruikt beeld.* niet (het video-deel heet video.*)');
  for (const naam of Object.keys(REGIE_LABEL)) assert.ok(REGIE.includes(`regie!${naam}`));
});

test('geen ander bestand in src/ definieert beeld.macro/regie/aan (een indeling mag ze BEDIENEN)', () => {
  const lijst = (map) => readdirSync(map).flatMap((f) => (statSync(join(map, f)).isDirectory() ? lijst(join(map, f)) : [join(map, f)]));
  const re = /id:\s*['"`]beeld\.(macro|regie|aan)\b/;
  const vreemd = lijst(join(APP, 'src'))
    .filter((f) => /\.js$/.test(f) && !f.includes(`${join('src', 'koppel')}`) && !f.endsWith('koppel-paneel.js'))
    .filter((f) => re.test(readFileSync(f, 'utf8')));
  assert.deepEqual(vreemd, []);
  // De APC bedient alleen macro's die de koppeling kent.
  const apc = JSON.parse(readFileSync(join(APP, 'indelingen', 'apc40mk2.json'), 'utf8'));
  const macros = apc.regels.map((r) => r.actie).filter((a) => a.startsWith('beeld.macro.'));
  assert.equal(macros.length, 8);
  for (const a of macros) assert.ok(MACROS.includes(a.slice('beeld.'.length)), a);
});

test('meta: regie en aan niet in het log of de beginstand; macro\'s wel in het log, niet in de beginstand', async () => {
  const { bus, ids } = await opzet();
  for (const id of ids) {
    const { meta, soort } = bus.zoek(id).def;
    assert.equal(meta.beginstand, false, id);
    if (id.startsWith('beeld.macro.')) { assert.equal(soort, 'waarde'); assert.notEqual(meta.log, 'overslaan', id); }
    else { assert.equal(soort, 'trigger'); assert.equal(meta.log, 'overslaan', id); }
    assert.notEqual(meta.gevaarlijk, true, `${id} raakt het geluid niet`);
  }
  assert.equal(bus.zoek('beeld.macro.tint').def.meta.bipolair, true);
  assert.equal(bus.zoek('beeld.macro.glitch').def.meta.bipolair, undefined);
  assert.equal(bus.zoek('beeld.aan').def.meta.schakelaar, true);
});

test('de beginstand van het log neemt geen enkele beeld-actie mee', async () => {
  const { e } = await opzet();
  const stand = e.log.beginstand();
  assert.ok(!Object.keys(stand.waarden).some((id) => id.startsWith('beeld.')), 'niet in de beginstand');
});

test('lees null zonder verbinding; met verbinding de stand; doe gaat naar de koppeling', async () => {
  const { bus, k, zender } = await opzet();
  assert.equal(bus.lees('beeld.macro.tint'), null);
  assert.equal(bus.lees('beeld.regie.flits'), null);
  assert.equal(bus.lees('beeld.aan'), 0, 'aan/uit is altijd te bedienen');
  bus.doe('beeld.macro.tint', 0.6);
  assert.equal(zender(), null, 'uit: geen zender');
  k.zet({ adres: 'ws://127.0.0.1:7702/app' });
  bus.doe('beeld.aan', true); bus.doe('beeld.aan', false);
  assert.equal(bus.lees('beeld.aan'), 1);
  assert.ok(k.loopt, 'beeld.aan zet de koppeling aan');
  const z = zender();
  z.status.verbonden = true;
  assert.equal(bus.lees('beeld.macro.helderheid'), MACRO_STANDAARD['macro.helderheid']);
  k.pingAt = 0;   // de Stroommachine is er (verse ping op nu = 0)
  bus.doe('beeld.macro.tint', 0.25);
  assert.deepEqual(z.poorten.at(-1), ['macro.tint', 0.25]);
  assert.equal(bus.lees('beeld.macro.tint'), 0.25);
  bus.doe('beeld.regie.ontdek', true);
  assert.deepEqual(z.poorten.at(-1), ['regie!ontdek']);
  assert.equal(bus.lees('beeld.regie.ontdek'), 1);
  bus.doe('beeld.regie.ontdek', false);
  assert.equal(bus.lees('beeld.regie.ontdek'), 0);
  bus.doe('beeld.aan', true); bus.doe('beeld.aan', false);
  assert.ok(!k.loopt && bus.lees('beeld.aan') === 0, 'nog eens: uit');
  assert.equal(bus.lees('beeld.macro.tint'), null);
});
