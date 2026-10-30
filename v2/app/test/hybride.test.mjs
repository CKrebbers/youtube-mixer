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
  assert.equal(indeling.op.get('xf').actie, 'tijd.scrub', 'crossfader = tijd');
  for (const x of indeling.op.values()) if (x.control === 'xf') assert.ok(!x.laag && !x.shift, 'de crossfader is een anker');
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

/** De beeldacties van src/beeld/acties.js als nep op de bus (de engine in de tests heeft geen beeldlaag). */
function nepBeeld(bus) {
  const w = {};
  const waarde = (id, v = 0.5) => { w[id] = v; bus.defineer({ id, soort: 'waarde', label: id, doe: (x) => { w[id] = x; }, lees: () => w[id] }); };
  const trig = (id) => { w[id] = 0; bus.defineer({ id, soort: 'trigger', label: id, doe: (x) => { if (x) w[id] = w[id] ? 0 : 1; }, lees: () => w[id] }); };
  // Namen en soorten zoals src/beeld/acties.js ze definieert (de effecten zijn waarden, .hold een trigger).
  for (let k = 1; k <= 6; k++) waarde(`video.layer.knob.${k}`);
  waarde('video.layer.opacity', 0.8); waarde('video.master', 1); waarde('video.pulse', 0); waarde('video.layer.react', 0);
  for (const f of ['pixel', 'mirror', 'rgb', 'color', 'trails', 'grain']) { waarde(`video.fx.${f}`, f === 'color' ? 0.5 : 0); trig(`video.fx.${f}.hold`); }
  for (const t of ['video.layer.on', 'video.freeze', 'video.layer.select.1', 'video.layer.select.2', 'video.layer.prev', 'video.layer.next', 'video.layer.blend',
    'video.mode', 'video.fit', 'video.clips', 'video.flash', 'video.black.hold', 'video.pulse.target', 'video.layer.react.source', 'video.layer.react.target']) trig(t);
  return w;
}

test('W3 naar beeld en terug: BANK ▶▶ (oranje), trackknoppen 1–2, THUIS; alles staat er nog', async () => {
  const { e, druk, ind, klankjes } = await opzet();
  const w = nepBeeld(e.bus);
  druk('right'); druk('right');
  assert.deepEqual(ind.open, ['ruimte.beeld']);
  assert.equal(ind.regelVoor('pad5-1').led.kleur.aan, 'oranje', 'het grid is oranje');
  for (const tk of ['tk1', 'tk2']) {
    ind.verwerk({ control: tk, soort: 'waarde', waarde: 0.5, ruw: 64 });
    ind.verwerk({ control: tk, soort: 'waarde', waarde: 0.7, ruw: 90 });
  }
  const k1 = w['video.layer.knob.1'], k2 = w['video.layer.knob.2'];
  assert.ok(k1 > 0.6 && k2 > 0.6, `vorm 1 en 2 gedraaid (${k1}, ${k2})`);
  ind.verwerk({ control: 'dk2', soort: 'waarde', waarde: 0.5, ruw: 64 });   // spiegel (mirror) open draaien
  ind.verwerk({ control: 'dk2', soort: 'waarde', waarde: 0.8, ruw: 100 });
  const spiegel = w['video.fx.mirror'];
  assert.ok(spiegel > 0.2, `spiegel ${spiegel}`);
  // Elke regel van de beeldruimte wijst naar een actie die bestaat, met het goede gedrag (geen onbekende).
  const onbekend = [];
  ind.on('onbekend', (o) => onbekend.push(o.doel));
  for (const c of ['pad5-1', 'pad5-7', 'pad4-1', 'pad4-6', 'pad3-1', 'pad3-5']) druk(c);
  assert.deepEqual(onbekend, []);
  druk('user');
  assert.deepEqual(ind.open, []);
  assert.equal(w['video.layer.knob.1'], k1);
  assert.equal(w['video.layer.knob.2'], k2);
  assert.equal(w['video.fx.mirror'], spiegel, 'het effect staat er nog');
  e.hybride.klankje('beeld'); e.hybride.klankje('thuis');
  assert.ok(Math.abs(klankjes[0] / klankjes[1] - Math.pow(2, 4 / 12)) < 1e-9, 'beeld klinkt een terts boven thuis');
});

test('W4 terug in de tijd: crossfader naar links = de stand van toen, midden = nu', async () => {
  const { e, ctx, ind } = await opzet();
  const tik = (t) => { ctx.currentTime = t; e.hybride.tik(t); };
  // Drie minuten waarin fader 2 langzaam omhoog gaat.
  for (let t = 0; t <= 180; t += 0.5) { if (t % 10 === 0) e.bus.doe('track.2.fader', t / 200, { bron: 'apc' }); tik(t); }
  const nu = e.bus.lees('track.2.fader');
  assert.ok(Math.abs(nu - 0.9) < 1e-9);
  assert.ok(e.hybride.tijdStand().opnames >= 170);
  // Crossfader eerst in het midden pakken (soft-takeover), dan naar −2 min: terug = ((0,48 − v)/0,48)² · 600 = 120 s.
  ind.verwerk({ control: 'xf', soort: 'waarde', waarde: 0.5, ruw: 64 });
  const v = 0.48 - 0.48 * Math.sqrt(120 / 600);
  ind.verwerk({ control: 'xf', soort: 'waarde', waarde: 0.49, ruw: 62 });
  ind.verwerk({ control: 'xf', soort: 'waarde', waarde: v, ruw: Math.round(v * 127) });
  const toen = e.bus.lees('track.2.fader');
  assert.ok(Math.abs(toen - 60 / 200) < 0.051, `2 minuten terug: fader 2 = ${toen} (toen 0,30)`);
  ind.verwerk({ control: 'xf', soort: 'waarde', waarde: 0.5, ruw: 64 });
  assert.ok(Math.abs(e.bus.lees('track.2.fader') - nu) < 1e-9, 'midden = nu');
  // Verder spelen vanuit het verleden: terug, iets aanraken, dan blijft het verleden staan.
  ind.verwerk({ control: 'xf', soort: 'waarde', waarde: v, ruw: Math.round(v * 127) });
  e.bus.doe('track.3.fader', 0.4, { bron: 'apc' });
  ind.verwerk({ control: 'xf', soort: 'waarde', waarde: 0.5, ruw: 64 });
  assert.ok(Math.abs(e.bus.lees('track.2.fader') - toen) < 1e-9, 'opgepakt: het verleden is nu');
});

test('beeld: elke video-actie in de Hybride-indeling bestaat echt in src/beeld/acties.js, met de goede soort', async () => {
  const { VIDEO_FX_ACTIE } = await import('../src/beeld/instellingen.js');
  const { VORM_KNOPPEN } = await import('../src/beeld/acties.js');
  const bron = readFileSync(join(HIER, '..', 'src', 'beeld', 'acties.js'), 'utf8');
  const soort = new Map();
  for (const m of bron.matchAll(/id: '(video\.[\w.]+)', soort: '(\w+)'/g)) soort.set(m[1], m[2]);
  for (const f of Object.values(VIDEO_FX_ACTIE)) { soort.set(`video.fx.${f}`, 'waarde'); soort.set(`video.fx.${f}.hold`, 'trigger'); }
  for (let k = 1; k <= VORM_KNOPPEN; k++) soort.set(`video.layer.knob.${k}`, 'waarde');
  for (let i = 1; i <= 2; i++) soort.set(`video.layer.select.${i}`, 'trigger');
  const video = doc.regels.filter((r) => r.actie.startsWith('video.'));
  assert.ok(video.length > 20);
  for (const r of video) {
    assert.ok(soort.has(r.actie), `${r.control}: ${r.actie} bestaat niet in beeld/acties.js`);
    const moet = r.gedrag === 'trigger' || r.gedrag === 'schakelaar' ? 'trigger' : 'waarde';
    assert.equal(soort.get(r.actie), moet, `${r.control}: ${r.actie} is een ${soort.get(r.actie)}, gedrag ${r.gedrag}`);
  }
});
