// Laten lopen (kern/opstelling/verloop.js, opstelling.loop in engine/acties-opstelling.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maakVerloop, standOp, sceneVoor } from '../src/kern/opstelling/verloop.js';
import { realiseer } from '../src/kern/opstelling/realiseer.js';
import { normaliseerRecept } from '../src/kern/opstelling/model.js';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const ruw = (n) => JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', `${n}.json`), 'utf8'));
const CAT = { instrumenten: ['poly', 'fm', 'schaal', 'drums', 'korrel'], nummers: [] };

test('verloop: intro tot uitloop, herhaalbaar per zaad, anders met een ander zaad; begint klein en eindigt leeg', () => {
  const { recept } = normaliseerRecept(ruw('klokwerk'));
  const o = realiseer(recept, 4, CAT);
  const a = maakVerloop(o, 4), b = maakVerloop(o, 4);
  assert.deepEqual(a.delen.map((d) => [d.naam, d.maten]), b.delen.map((d) => [d.naam, d.maten]));
  assert.equal(a.delen[0].naam, 'intro');
  assert.equal(a.delen.at(-1).naam, 'uitloop');
  assert.ok(a.delen.some((d) => d.naam === 'breuk'));
  const vormen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((z) => JSON.stringify(maakVerloop(o, z).delen.map((d) => [d.naam, d.maten]))));
  assert.ok(vormen.size > 1, 'andere zaden, andere vormen');
  const aan = (st) => Object.values(st.sporen).filter((r) => r > 0).length;
  assert.ok(aan(standOp(a, 0)) <= 2, 'de intro begint met één of twee sporen');
  const vol = a.delen.findIndex((d) => d.naam === 'vol');
  const opVol = a.delen.slice(0, vol).reduce((s, d) => s + d.maten, 0);
  assert.equal(aan(standOp(a, opVol)), o.sporen.length, 'vol = alles');
  assert.ok(Object.values(standOp(a, opVol).sporen).every((r) => r >= 4));
  assert.equal(aan(standOp(a, a.maten - 1)) <= 1, true, 'de laatste maat van de uitloop: bijna leeg');
  assert.equal(standOp(a, a.maten), null, 'daarna: klaar');
  assert.equal(sceneVoor([{ naam: 'kaal' }, { naam: 'groef' }, { naam: 'vol' }], 'vol2'), 3);
});

test('engine: lopen zet sporen op de maat aan en uit, glijdt naar de scenes, en stopt aan het eind', async () => {
  const e = new Engine({ ctx: nepCtx(), audio: { ...nepAudio(), instrumenten: CAT.instrumenten.map((s) => ({ soort: s, naam: s })),
    instrument: (ctx, soort) => { const p = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]; const inst = { soort, start: async () => {}, noteOn() {}, noteOff() {}, stil() {}, zetParam: (k, v) => { p[k - 1] = v; }, leesParam: (k) => p[k - 1] ?? null, vernietig() {} }; return { inst, weg: async () => {} }; } }, timer: false, patronenTimers: { zet: () => 0, weg: () => {} } });
  await e.klaar;
  e.opstelling.zetRecepten([ruw('klokwerk')]);
  await e.opstelling.zet('klokwerk', 4);
  for (let i = 0; i < 5; i++) await new Promise((x) => setTimeout(x, 0));
  e.zetKlokTempo(120, 0);
  e.bus.doe('opstelling.loop', true);
  const st0 = e.opstelling.stand().loop;
  assert.ok(st0 && st0.totaal >= 56, `verloop van ${st0?.totaal} maten`);
  // Een maat op 120 = 2 s. Loop de hele avond in stappen van 50 ms.
  const t0 = e.nu();
  let maxAan = 0, minAan = 9, delen = new Set();
  for (let t = t0; t < t0 + st0.totaal * 2 + 6; t += 0.05) {
    e.opstelling.tik(t);
    const s = e.opstelling.stand();
    if (s.loop) delen.add(s.loop.deel);
    const aan = Object.values(s.partituur).filter((x) => !x.uit).length;
    maxAan = Math.max(maxAan, aan); minAan = Math.min(minAan, aan);
  }
  assert.ok(delen.has('intro') && delen.has('vol') && delen.has('breuk') && delen.has('uitloop'), [...delen].join(','));
  assert.equal(maxAan, 4, 'in het volle deel alle vier');
  assert.ok(minAan <= 1, 'in de intro of de breuk weinig');
  assert.equal(e.opstelling.stand().loop, null, 'aan het eind klaar');
});

test('takes: vastleggen op hele maten, afspelen zet het terug, weg = prullenbak, terug haalt hem terug', async () => {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: { ...nepAudio(), instrumenten: CAT.instrumenten.map((s) => ({ soort: s, naam: s })),
    instrument: (c, soort) => { const p = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]; const inst = { soort, start: async () => {}, noteOn() {}, noteOff() {}, stil() {}, zetParam: (k, v) => { p[k - 1] = v; }, leesParam: (k) => p[k - 1] ?? null, vernietig() {} }; return { inst, weg: async () => {} }; } },
    timer: false, patronenTimers: { zet: () => 0, weg: () => {} } });
  await e.klaar;
  const bewaard = [];
  e.opstelling.zetBronnen({ bewaarTakes: (x) => bewaard.push(JSON.parse(JSON.stringify(x))) });
  e.opstelling.zetRecepten([ruw('klokwerk')]);
  await e.opstelling.zet('klokwerk', 4);
  for (let i = 0; i < 5; i++) await new Promise((x) => setTimeout(x, 0));
  e.zetKlokTempo(120, 0);                       // 2 s per maat
  const op = (s) => { ctx.currentTime = s; e.opstelling.tik(s); };
  op(0.5);
  e.bus.doe('opstelling.neem', true, { bron: 'maschine' });
  assert.equal(e.opstelling.stand().take.neemt, true);
  op(1.0); e.bus.doe('opstelling.macro.1', 0.9, { bron: 'maschine' });
  op(2.5); e.bus.doe('opstelling.macro.1', 0.1, { bron: 'maschine' });
  e.bus.doe('opstelling.herrol', true, { bron: 'maschine' });   // geen deel van de take
  op(3.0); e.bus.doe('opstelling.neem', true, { bron: 'maschine' });
  const t = e.opstelling.takes();
  assert.equal(t.length, 1);
  assert.equal(t[0].maten, 2, 'van maat 1 tot halverwege maat 2 = 2 maten');
  assert.deepEqual(t[0].acties.map((a) => a.id), ['opstelling.macro.1', 'opstelling.macro.1']);
  assert.ok(Math.abs(t[0].acties[0].tel - 2) < 1e-6, 'tel 2 van de take (1 s op 120)');
  assert.equal(bewaard.length, 1);
  // Afspelen: de opstelling van toen terug, dan op de volgende maat de macro.
  await new Promise((x) => setTimeout(x, 0));
  e.bus.doe('opstelling.macro.1', 0.5, { bron: 'maschine' });
  e.bus.doe('opstelling.take.speel', true, { bron: 'maschine' });
  for (let i = 0; i < 10; i++) await new Promise((x) => setTimeout(x, 0));
  assert.equal(e.opstelling.stand().zaad, t[0].zaad, 'de opstelling van de take staat er weer');
  const start = Math.ceil(e.klok.tel(ctx.currentTime) / 4 + 1e-9) * 4;   // de volgende maat (tellen)
  const tijd = (tel) => e.klok.tijd(start + tel);
  op(tijd(1)); assert.ok(Math.abs(e.bus.lees('opstelling.macro.1') - 0.9) > 0.01, 'vóór tel 2 nog niet de waarde van de take');
  op(tijd(2.01)); assert.ok(Math.abs(e.bus.lees('opstelling.macro.1') - 0.9) < 1e-9, 'op tel 2: 0,9');
  op(tijd(5)); assert.ok(Math.abs(e.bus.lees('opstelling.macro.1') - 0.1) < 1e-9);
  op(tijd(8.1)); assert.equal(e.opstelling.stand().take.speelt, null, 'na 2 maten klaar');
  // Weg en terug.
  e.bus.doe('opstelling.take.weg', true, { bron: 'maschine' });
  assert.equal(e.opstelling.takes().length, 0);
  assert.equal(e.opstelling.stand().take.prullenbak, 1);
  e.bus.doe('opstelling.take.terug', true, { bron: 'maschine' });
  assert.equal(e.opstelling.takes().length, 1);
  assert.equal(bewaard.at(-1).takes.length, 1);
});

test('processen: groei maakt voller en bakt in, verval houdt, zwerven blijft binnen 0..1, evolutie verandert de partituur', async () => {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: { ...nepAudio(), instrumenten: CAT.instrumenten.map((s) => ({ soort: s, naam: s })),
    instrument: (c, soort) => { const p = Array(8).fill(0.5); const inst = { soort, start: async () => {}, noteOn() {}, noteOff() {}, stil() {}, zetParam: (k, v) => { p[k - 1] = v; }, leesParam: (k) => p[k - 1] ?? null, vernietig() {} }; return { inst, weg: async () => {} }; } },
    timer: false, patronenTimers: { zet: () => 0, weg: () => {} } });
  await e.klaar;
  e.opstelling.zetRecepten([ruw('klokwerk')]);
  await e.opstelling.zet('klokwerk', 4);
  for (let i = 0; i < 5; i++) await new Promise((x) => setTimeout(x, 0));
  e.zetKlokTempo(120, 0);                                    // 2 s per maat
  let t = 0;
  const loop = (s) => { for (const eind = t + s; t < eind; t += 0.05) { ctx.currentTime = t; e.opstelling.tik(t); } };
  const dicht = () => e.bus.lees('opstelling.macro.2');
  const voor = dicht();
  e.bus.doe('opstelling.proces.1.kort', true, { bron: 'maschine' });   // groei, 32 maten
  assert.deepEqual(e.opstelling.stand().processen.map((p) => p.id), ['groei']);
  loop(2);
  const vroeg = e.opstelling.stand().macros[1].nu;
  loop(62);
  const laat = e.opstelling.stand().macros[1].nu;
  assert.ok(laat > vroeg + 0.4, `groei: dichtheid ${vroeg.toFixed(2)} -> ${laat.toFixed(2)}`);
  assert.ok(Object.values(e.opstelling.stand().partituur).every((x) => x.actief >= 4), 'groei eindigt vol');
  loop(4);
  assert.equal(e.opstelling.stand().processen.length, 0, 'groei is klaar');
  assert.ok(dicht() > voor, 'en zijn eindstand is jouw stand geworden (ingebakken)');
  // Verval houdt zijn eindstand tot je hem stopt.
  e.bus.doe('opstelling.proces.2.kort', true, { bron: 'maschine' });
  loop(70);
  assert.equal(e.opstelling.stand().processen[0]?.id, 'verval', 'verval loopt nog (houdt)');
  assert.ok(e.opstelling.stand().macros[1].nu < 0.3, 'en is dun');
  e.bus.doe('opstelling.proces.2', true, { bron: 'maschine' });          // nog eens = stoppen
  assert.equal(e.opstelling.stand().processen.length, 0);
  // Zwerven + ademen tegelijk: alles blijft binnen 0..1.
  e.bus.doe('opstelling.proces.3', true, { bron: 'maschine' });
  e.bus.doe('opstelling.proces.4', true, { bron: 'maschine' });
  for (let i = 0; i < 400; i++) { loop(0.25); assert.ok(e.opstelling.stand().macros.every((m) => !m || (m.nu >= 0 && m.nu <= 1))); }
  e.bus.doe('opstelling.proces.stop', true, { bron: 'maschine' });
  assert.equal(e.opstelling.stand().processen.length, 0);
  // Evolutie: na een paar keer 8 maten staat de partituur anders.
  const rijen = () => JSON.stringify(Object.values(e.opstelling.stand().partituur).map((x) => x.actief));
  const r0 = rijen();
  e.bus.doe('opstelling.proces.8', true, { bron: 'maschine' });
  loop(16 * 2 * 4);
  assert.notEqual(rijen(), r0, 'evolutie veranderde de partituur');
});

test('avond: station na station, elk zijn verloop, na de laatste weer de eerste met een nieuw zaad', async () => {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: { ...nepAudio(), instrumenten: CAT.instrumenten.map((s) => ({ soort: s, naam: s })),
    instrument: (c, soort) => { const p = Array(8).fill(0.5); const inst = { soort, start: async () => {}, noteOn() {}, noteOff() {}, stil() {}, zetParam: (k, v) => { p[k - 1] = v; }, leesParam: (k) => p[k - 1] ?? null, vernietig() {} }; return { inst, weg: async () => {} }; } },
    timer: false, patronenTimers: { zet: () => 0, weg: () => {} } });
  await e.klaar;
  e.opstelling.zetRecepten([ruw('klokwerk'), ruw('korrelzee')]);
  e.zetKlokTempo(120, 0);
  e.bus.doe('avond.lopen', true, { bron: 'maschine' });
  for (let i = 0; i < 8; i++) await new Promise((x) => setTimeout(x, 0));
  assert.equal(e.opstelling.stand().recept, 'klokwerk');
  assert.ok(e.opstelling.stand().loop, 'het eerste station loopt');
  const gezien = [];
  let t = 0;
  for (let ronde = 0; ronde < 400 && gezien.length < 3; ronde++) {
    for (const eind = t + 2; t < eind; t += 0.05) { ctx.currentTime = t; e.opstelling.tik(t); }
    for (let i = 0; i < 4; i++) await new Promise((x) => setTimeout(x, 0));
    const st = e.opstelling.stand();
    const sleutel = `${st.recept}#${st.zaad}`;
    if (gezien.at(-1) !== sleutel) gezien.push(sleutel);
  }
  assert.equal(gezien.length, 3, gezien.join(' → '));
  assert.ok(gezien[1].startsWith('korrelzee'), 'tweede station');
  assert.ok(gezien[2].startsWith('klokwerk') && gezien[2] !== gezien[0], 'weer het eerste, met een ander zaad');
  e.bus.doe('avond.lopen', true, { bron: 'maschine' });
  assert.equal(e.opstelling.stand().avond, null, 'uit');
});
