// Hybride (v2/HYBRIDE.md): de grondwet in de indeling en de acceptatietests W1, W2 en W5, met de echte
// Hybride-indeling (indelingen/apc40mk2-hybride.json) op de echte engine (zonder hardware).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';
import { Indeling, normaliseerIndeling } from '../src/control/indeling.js';
import apc from '../src/control/apparaten/apc40mk2.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HIER, '..', 'indelingen', 'apc40mk2-hybride.json'), 'utf8'));
const ruw = (n) => JSON.parse(readFileSync(join(HIER, '..', 'opstellingen', `${n}.json`), 'utf8'));

async function opzet() {
  const noten = [];
  const klankjes = [];
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: { ...nepAudio(), klankje: (c, uit, hz) => klankjes.push(hz),
    instrumenten: ['poly', 'fm', 'schaal', 'drums', 'korrel'].map((s) => ({ soort: s, naam: s })),
    instrument: (c, soort) => { const p = Array(8).fill(0.5); const inst = { soort, start: async () => {}, noteOn: (n, v) => noten.push([soort, n, v]), noteOff: (n) => noten.push([soort, n, 0]), stil() {}, zetParam: (k, v) => { p[k - 1] = v; }, leesParam: (k) => p[k - 1] ?? null, vernietig() {} }; return { inst, weg: async () => {} }; } },
    timer: false, patronenTimers: { zet: () => 0, weg: () => {} } });
  await e.klaar;
  const ind = new Indeling({ bus: e.bus, apparaat: apc, vars: { focus: () => e.focus } });
  ind.voegToe(doc);
  const druk = (c, extra = {}) => { ind.verwerk({ control: c, soort: 'druk', ...extra }); ind.verwerk({ control: c, soort: 'los', ...extra }); };
  return { e, ctx, ind, druk, noten, klankjes };
}
const rust = async () => { for (let i = 0; i < 6; i++) await new Promise((x) => setTimeout(x, 0)); };

test('grondwet: de ankers staan in de basis en nergens in een laag of achter shift; hooguit één laag diep', () => {
  const { indeling, fouten } = normaliseerIndeling(doc, { apparaat: apc });
  assert.deepEqual(fouten, []);
  const ankers = ['user', 'master', ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [`fader${k}`, `sel${k}`])];
  for (const x of indeling.op.values()) if (ankers.includes(x.control)) assert.ok(!x.laag && !x.shift, `${x.control} is een anker`);
  assert.equal(indeling.op.get('user').actie, 'laag:ruimte', 'USER = THUIS');
  for (let k = 1; k <= 8; k++) assert.equal(indeling.op.get(`fader${k}`).actie, `track.${k}.fader`, 'faders = mix');
  assert.ok(indeling.lagen.every((l) => l.split('.').length === 2 && l.startsWith('ruimte.')), 'alleen ruimtes, één niveau');
  // Kleurtaal: klank blauw, beeld oranje, tijd wit, navigatie/patch paars.
  const kleur = (c) => indeling.op.get(c)?.led?.kleur?.aan;
  assert.equal(kleur('pad5-1'), 'blauw');
  assert.equal(kleur('pad3-1'), 'oranje');
  assert.equal(kleur('pad1-1'), 'wit');
  assert.equal(kleur('scene1'), 'violet');
  assert.equal(indeling.op.get('pad5-1@ruimte.patch').led.kleur.aan, 'violet');
});

test('W1 drone uit stilte: de blauwe cel linksboven, dan fader 1 omhoog', async () => {
  const { e, druk, ind, noten } = await opzet();
  druk('pad5-1');
  await rust();
  assert.equal(e.track(1).instrument?.soort, 'korrel', 'kolom 1 = de korrelwolk');
  assert.ok(noten.some(([s, n, v]) => s === 'korrel' && v > 0), 'er klinkt een drone');
  assert.equal(e.bus.lees('bron.1'), 1, 'en de cel brandt');
  ind.verwerk({ control: 'fader1', soort: 'waarde', waarde: e.bus.lees('track.1.fader'), ruw: 0 });
  ind.verwerk({ control: 'fader1', soort: 'waarde', waarde: 0.95, ruw: 121 });
  assert.ok(Math.abs(e.bus.lees('track.1.fader') - 0.95) < 1e-9, 'fader 1 = mix van track 1');
  druk('pad5-1');
  assert.ok(noten.some(([s, , v]) => s === 'korrel' && v === 0), 'nog eens = stil');
  assert.equal(e.bus.lees('bron.1'), 0);
});

test('W2 koppeling leggen: BANK ▶, cel lfo × helderheid, device-knop 1 = sterkte, THUIS; de modulatie blijft', async () => {
  const { e, druk, ind, ctx } = await opzet();
  e.opstelling.zetRecepten([ruw('klokwerk')]);
  await e.opstelling.zet('klokwerk', 3);
  await rust();
  druk('right');
  assert.deepEqual(ind.open, ['ruimte.patch']);
  druk('pad5-6');                                         // rij 1 = lfo 1 maat, kolom 6 = helderheid
  assert.equal(e.bus.lees('patch.cel.1.6'), 0.5);
  ind.verwerk({ control: 'dk1', soort: 'waarde', waarde: 0.5, ruw: 64 });
  ind.verwerk({ control: 'dk1', soort: 'waarde', waarde: 0.6, ruw: 90 });   // eindeloos: +26 stappen
  assert.ok(e.bus.lees('patch.cel.1.6') > 0.6, `sterkte ${e.bus.lees('patch.cel.1.6')}`);
  druk('user');
  assert.deepEqual(ind.open, [], 'THUIS');
  e.zetKlokTempo(120, 0);
  const basis = e.bus.lees('opstelling.macro.6');
  const waarden = [];
  for (let t = 0; t < 2; t += 0.05) { ctx.currentTime = t; e.hybride.tik(t); waarden.push(e.bus.lees('opstelling.macro.6')); }
  assert.ok(Math.max(...waarden) - Math.min(...waarden) > 0.2, 'helderheid ademt mee met de lfo');
  assert.ok(waarden.every((v) => v >= 0 && v <= 1));
  druk('right');
  druk('pad5-6');                                         // de gekozen cel nog eens = uit
  assert.equal(e.bus.lees('patch.cel.1.6'), 0);
  assert.ok(Math.abs(e.bus.lees('opstelling.macro.6') - basis) < 0.3, 'uit = terug naar zijn stand');
});

test('W5 verdwaald: vanuit elke ruimte brengt THUIS je terug, met de grondtoon', async () => {
  const { e, druk, ind, klankjes } = await opzet();
  for (const pad of [['right'], ['right', 'right']]) {
    for (const c of pad) druk(c);
    assert.notDeepEqual(ind.open, []);
    druk('user');
    assert.deepEqual(ind.open, []);
    assert.equal(ind.regelVoor('pad5-1').actie, 'bron.1', 'het grid is weer de kaart');
  }
  e.hybride.klankje('thuis');
  e.hybride.klankje('patch');
  assert.equal(klankjes.length, 2);
  assert.ok(Math.abs(klankjes[1] / klankjes[0] - Math.pow(2, 7 / 12)) < 1e-9, 'patch klinkt een kwint boven de grondtoon');
});
