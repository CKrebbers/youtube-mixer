// De Tocht (src/kern/tocht, engine/acties-tocht.js): hoofdstukken, ontdekkingen, smaak, het einde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOFDSTUKKEN, WENSEN, leegStaat, normaliseerStaat, verwerk, overslaan, kies, stem, huidig, wensenOpVolgorde } from '../src/kern/tocht/model.js';
import { leegSmaak, beloon, kenmerkenVan, kiesMetSmaak, gewichtVan, top, normaliseerSmaak } from '../src/kern/tocht/smaak.js';
import { stroom } from '../src/kern/opstelling/zaad.js';
import { genereer } from '../src/kern/opstelling/varieer.js';
import { realiseer } from '../src/kern/opstelling/realiseer.js';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const druk = (s, id, bron = 'maschine') => verwerk(s, { soort: 'actie', id, v: true, bron }).staat;

test('hoofdstukken: elk heeft doelen met een sleutel; de sleutels zijn uniek', () => {
  const sleutels = HOOFDSTUKKEN.flatMap((h) => h.doelen.map((d) => d.sleutel));
  assert.equal(new Set(sleutels).size, sleutels.length);
  assert.ok(HOOFDSTUKKEN.length >= 10);
  assert.ok(WENSEN.length >= 8);
});

test('het eerste hoofdstuk: laden + start = door naar het tweede; de opstelling zelf telt niet mee', () => {
  let s = leegStaat();
  s = verwerk(s, { soort: 'actie', id: 'opstelling.laad', v: true, bron: 'opstelling' }).staat;
  assert.equal(s.hoofdstuk, 0, 'bron opstelling telt niet');
  s = druk(s, 'opstelling.laad');
  assert.equal(s.hoofdstuk, 0);
  const r = verwerk(s, { soort: 'actie', id: 'opstelling.start', v: true, bron: 'maschine' });
  assert.deepEqual(r.klaar, ['klank']);
  assert.equal(r.staat.hoofdstuk, 1);
  assert.equal(huidig(r.staat).id, 'knoppen');
});

test('verschillend: vijf verschillende macro\'s, niet vijf keer dezelfde; vooruit spelen telt later mee', () => {
  let s = { ...leegStaat(), hoofdstuk: 1 };
  for (let i = 0; i < 10; i++) s = druk(s, 'opstelling.macro.1');
  assert.equal(s.hoofdstuk, 1);
  s = druk(s, 'opstelling.scene.1'); s = druk(s, 'opstelling.scene.2'); s = druk(s, 'opstelling.scene.3');   // hoofdstuk 3 al vooruit
  for (const k of [2, 3, 4, 5]) s = druk(s, `opstelling.macro.${k}`);
  assert.equal(huidig(s).id, 'zaad', 'knoppen klaar, en scenes was al gedaan: door naar zaad');
});

test('ontdekkingen: een nieuwe handeling is een kaartje, track-nummers tellen niet apart; loslaten telt niet', () => {
  let s = leegStaat();
  let r = verwerk(s, { soort: 'actie', id: 'track.3.stem.vocals.kill.hold', v: true, bron: 'maschine' });
  assert.deepEqual(r.nieuw, ['track.stem.vocals.kill.hold']);
  r = verwerk(r.staat, { soort: 'actie', id: 'track.5.stem.vocals.kill.hold', v: true, bron: 'apc' });
  assert.deepEqual(r.nieuw, []);
  const los = verwerk(r.staat, { soort: 'actie', id: 'opstelling.muteer', v: false, bron: 'apc' });
  assert.equal(los.staat, r.staat);
});

test('maten: variatie-hoofdstuk telt alleen met variatie hoog; het laatste alleen als je er bent', () => {
  let s = { ...leegStaat(), hoofdstuk: HOOFDSTUKKEN.findIndex((h) => h.id === 'variatie') };
  for (let i = 0; i < 8; i++) s = verwerk(s, { soort: 'maat', variatie: 0.3 }).staat;
  assert.equal(huidig(s).id, 'variatie');
  for (let i = 0; i < 8; i++) s = verwerk(s, { soort: 'maat', variatie: 0.8 }).staat;
  assert.notEqual(huidig(s).id, 'variatie');
  assert.equal(s.voortgang['avond.maten'] ?? 0, 0, 'de avond telt pas als je er bent');
});

test('vrij: overslaan, het einde kiezen, stemmen; normaliseren gooit nooit', () => {
  let s = overslaan(leegStaat());
  assert.equal(s.hoofdstuk, 1);
  assert.equal(kies(s, 'bouwen').einde, 'bouwen');
  s = stem(stem(stem(s, 'strata'), 'strata'), 'formula');
  assert.equal(wensenOpVolgorde(s)[0].id, 'strata');
  assert.equal(stem(s, 'bestaat-niet'), s);
  assert.doesNotThrow(() => normaliseerStaat('kapot'));
  assert.deepEqual(normaliseerStaat(JSON.parse(JSON.stringify(s))), s);
});

test('smaak: kenmerken van een opstelling, belonen, gewogen kiezen (en toch blijven verkennen)', () => {
  const cat = { nummers: [], instrumenten: ['poly', 'fm', 'drums', 'schaal'], racks: ['A', 'B', 'C', 'D'], vormen: ['lz', 'gs'] };
  const o = realiseer(genereer(cat, 3), 2, cat);
  const k = kenmerkenVan(o);
  assert.ok(k.some((x) => x.startsWith('recept:')));
  let sm = beloon(leegSmaak(), ['rack:C'], 15);
  assert.ok(gewichtVan(sm, 'rack:C') > gewichtVan(sm, 'rack:A'));
  const r = stroom(1, 'test');
  const tel = { A: 0, B: 0, C: 0, D: 0 };
  for (let i = 0; i < 2000; i++) tel[kiesMetSmaak(r, ['A', 'B', 'C', 'D'], sm, (x) => `rack:${x}`)]++;
  assert.ok(tel.C > tel.A * 3, `C ${tel.C} vs A ${tel.A}`);
  assert.ok(tel.A > 50, 'en de rest komt nog steeds langs');
  sm = beloon(sm, ['rack:A'], -100);
  assert.ok(gewichtVan(sm, 'rack:A') >= 0.2, 'afkeer wordt nooit een verbod');
  assert.equal(top(sm, 1)[0][0], 'rack:C');
  assert.deepEqual(normaliseerSmaak(JSON.parse(JSON.stringify(sm))), sm);
});

test('engine: de tocht telt wat je op de bus doet, bewaren geeft smaak, en hij meldt bewaren', async () => {
  const e = new Engine({ ctx: nepCtx(), audio: nepAudio(), timer: false });
  await e.klaar;
  e.opstelling.zetRecepten([JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', 'klokwerk.json'), 'utf8'))]);
  const bewaard = [];
  e.tocht.on('bewaar', (x) => bewaard.push(x));
  e.bus.doe('opstelling.laad', true, { bron: 'maschine' });
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  e.bus.doe('opstelling.start', true, { bron: 'maschine' });
  assert.equal(e.tocht.stand().hoofdstuk, 1);
  assert.ok(bewaard.length > 0);
  e.bus.doe('opstelling.bewaar', true, { bron: 'maschine' });
  assert.ok(e.tocht.smaak().kenmerken['recept:klokwerk'] >= 3);
  e.bus.doe('tocht.toon', true, { bron: 'maschine' });
  assert.equal(e.tocht.stand().toont, true);
  e.bus.doe('tocht.toon', false, { bron: 'maschine' });
  assert.equal(e.tocht.stand().toont, false);
});
