// De acties van beeld op de bus: elke actie heeft een lees() (lampjes, ringen), de namen van v1 (de
// telling kent ze zo), en wat ze doen komt in de stand (stand.js) terecht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from '../src/kern/bus.js';
import { Beeld } from '../src/beeld/stand.js';
import { definieerBeeld, VORM_KNOPPEN } from '../src/beeld/acties.js';
import { VormLagen } from '../src/beeld/vormen/laag.js';
import { Router } from '../src/beeld/analyse/router.js';
import { nep2D } from './beeld-nep.mjs';

function opzet({ zonderVormen = false } = {}) {
  let ms = 1000;
  const bus = new Bus();
  const vormen = zonderVormen ? null : new VormLagen({ maakCanvas: nep2D, werker: false });
  const router = zonderVormen ? null : new Router(2);
  const beeld = new Beeld({ vormen, router, klok: () => ms });
  const ids = definieerBeeld(bus, beeld);
  return { bus, beeld, ids, vormen, router, verder: (x) => { ms += x; } };
}

test('de namen van v1: zes effecten in het Engels, zes vormknoppen, de noodknoppen', () => {
  const { ids } = opzet();
  for (const naam of ['pixel', 'mirror', 'rgb', 'color', 'trails', 'grain']) {
    assert.ok(ids.includes(`video.fx.${naam}`), naam);
    assert.ok(ids.includes(`video.fx.${naam}.hold`), `${naam}.hold`);
  }
  for (let k = 1; k <= VORM_KNOPPEN; k++) assert.ok(ids.includes(`video.layer.knob.${k}`));
  for (const id of ['video.mode', 'video.fit', 'video.pulse', 'video.pulse.target', 'video.clips', 'video.black', 'video.black.hold',
    'video.freeze', 'video.master', 'video.flash', 'video.layer.select.1', 'video.layer.select.2', 'video.layer.select.next',
    'video.layer.select.prev', 'video.layer.on', 'video.layer.next', 'video.layer.prev', 'video.layer.blend', 'video.layer.opacity',
    'video.layer.react', 'video.layer.react.source', 'video.layer.react.target']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, 'geen dubbele');
});

test('elke actie heeft een lees(): een getal 0..1 (met vormen), of null zonder vormen', () => {
  const { bus, ids, vormen } = opzet();
  const heeft = vormen.laag.knoppen.length;
  for (const id of ids) {
    const z = bus.zoek(id);
    assert.equal(typeof z.def.lees, 'function', `${id} heeft lees`);
    const v = bus.lees(id);
    const k = /^video\.layer\.knob\.(\d)$/.exec(id);
    if (k && Number(k[1]) > heeft) { assert.equal(v, null, `${id}: deze vorm heeft maar ${heeft} knoppen`); continue; }
    assert.ok(typeof v === 'number' && v >= 0 && v <= 1, `${id}: lees = ${v}`);
  }
  const zonder = opzet({ zonderVormen: true });
  for (const id of zonder.ids.filter((x) => x.startsWith('video.layer.'))) {
    assert.equal(zonder.bus.lees(id), null, `${id} zonder vormen: null (lampje uit)`);
    zonder.bus.doe(id, true); zonder.bus.doe(id, false);   // en hij doet niets, zonder fout
  }
});

test('effecten: waarde in de stand, vasthouden = vol en daarna terug', () => {
  const { bus, beeld } = opzet();
  bus.doe('video.fx.mirror', 0.4);
  assert.equal(beeld.stand.fx.spiegel, 0.4);
  assert.equal(bus.lees('video.fx.mirror'), 0.4);
  assert.equal(bus.lees('video.fx.color'), 0.5, 'kleur begint in het midden (normaal)');
  bus.doe('video.fx.mirror.hold', true);
  assert.equal(beeld.stand.fx.spiegel, 1);
  assert.equal(bus.lees('video.fx.mirror.hold'), 1);
  bus.doe('video.fx.mirror.hold', false);
  assert.equal(beeld.stand.fx.spiegel, 0.4, 'terug naar de stand van vóór het drukken');
  assert.equal(bus.zoek('video.fx.mirror.hold').def.meta.beginstand, false, 'een gebaar, geen stand');
});

test('rondlopers: mengvorm, passend, pulsdoel; lees = plek / (n − 1)', () => {
  const { bus, beeld } = opzet();
  assert.equal(bus.lees('video.mode'), 0);
  bus.doe('video.mode', true); bus.doe('video.mode', false);
  assert.equal(beeld.stand.modus, 'licht');
  assert.ok(Math.abs(bus.lees('video.mode') - 1 / 3) < 1e-12);
  bus.doe('video.fit', true);
  assert.equal(beeld.stand.fit, 'vullen');
  bus.doe('video.pulse.target', true);
  assert.equal(beeld.stand.pulsDoel, 'pixel');
  bus.doe('video.pulse', 0.6);
  assert.equal(beeld.stand.puls, 0.6);
});

test('noodknoppen en clips: schakelaars met hun stand als lampje; zwart vast; master; flits', () => {
  const { bus, beeld, verder } = opzet();
  assert.equal(bus.lees('video.clips'), 1);
  bus.doe('video.clips', true); bus.doe('video.clips', false);
  assert.equal(beeld.stand.clips, false);
  assert.equal(bus.lees('video.clips'), 0);
  bus.doe('video.black', true);
  assert.equal(bus.lees('video.black'), 1, 'het lampje zegt meteen wat je deed, ook al loopt de fade nog');
  assert.equal(beeld.eind.uniforms(1000).helder, 1);
  assert.equal(beeld.eind.uniforms(1250).helder, 0);
  bus.doe('video.black', true);
  assert.equal(bus.lees('video.black'), 0);
  bus.doe('video.black.hold', true);
  assert.equal(beeld.eind.uniforms(1000).helder, 0, 'vasthouden: meteen zwart');
  bus.doe('video.black.hold', false);
  bus.doe('video.freeze', true);
  assert.equal(bus.lees('video.freeze'), 1);
  bus.doe('video.master', 0.3);
  assert.equal(bus.lees('video.master'), 0.3);
  bus.doe('video.flash', true);
  assert.equal(bus.lees('video.flash'), 1);
  verder(400);
  assert.equal(bus.lees('video.flash'), 0, 'na 300 ms is de flits uit');
  for (const id of ['video.black', 'video.freeze', 'video.clips']) assert.equal(bus.zoek(id).def.meta.schakelaar, true, `${id} is een stand`);
});

test('vormlagen: knoppen op de GEKOZEN laag, kiezen, aan, vorm, dekking, reageren', () => {
  const { bus, vormen, router } = opzet();
  bus.doe('video.layer.knob.1', 0.9);
  assert.equal(vormen.lagen[0].leesKnop(0), 0.9);
  bus.doe('video.layer.select.2', true);
  assert.equal(vormen.gekozen, 1);
  assert.equal(bus.lees('video.layer.select.2'), 1);
  assert.equal(bus.lees('video.layer.select.1'), 0);
  bus.doe('video.layer.knob.1', 0.1);
  assert.equal(vormen.lagen[1].leesKnop(0), 0.1, 'dezelfde plek, nu op laag 2');
  assert.equal(vormen.lagen[0].leesKnop(0), 0.9, 'laag 1 bleef staan');
  assert.equal(bus.lees('video.layer.on'), 0);
  bus.doe('video.layer.on', true);
  assert.equal(vormen.lagen[1].aan, true);
  const was = vormen.laag.sys.id;
  bus.doe('video.layer.next', true);
  assert.notEqual(vormen.laag.sys.id, was);
  bus.doe('video.layer.opacity', 0.3);
  assert.equal(vormen.lagen[1].dekking, 0.3);
  bus.doe('video.layer.react', 0.7);
  assert.equal(router.route(1).sterkte, 0.7);
  assert.equal(router.route(0).sterkte, 0);
  bus.doe('video.layer.react.source', true);
  assert.equal(router.route(1).bron, 'midden');
  bus.doe('video.layer.react.target', true);
  assert.equal(router.route(1).doel, 2);
  bus.doe('video.layer.select.next', true);
  assert.equal(vormen.gekozen, 0);
});

test('het log ziet beeldacties met hun bron (de bus meldt ze)', () => {
  const { bus } = opzet();
  const gezien = [];
  bus.on('actie', (a) => gezien.push([a.id, a.v, a.bron]));
  bus.doe('video.layer.knob.3', 0.5, { bron: 'midi' });
  assert.deepEqual(gezien, [['video.layer.knob.3', 0.5, 'midi']]);
});
