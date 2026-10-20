// indeling.js: {k} en {focus}, shift, lagen (laag eerst, shift daarbinnen), loslaten
// naar het indrukken (ook na wisselen van indeling, shift, laag of focus),
// soft-takeover (grijpen, erlangs, herpakken), eindeloos, encoders, per nummer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Indeling, normaliseerIndeling, GLUREN_MS, TAKEOVER_EPS, LAATSTE_TTL, FIJN } from '../src/control/indeling.js';
import apc from '../src/control/apparaten/apc40mk2.js';
import { maakBus, NepKlok } from './control-hulp.mjs';

const doc = (regels, naam = 'proef', extra = {}) => ({ schema: 1, naam, apparaat: 'apc40mk2', regels, ...extra });
const druk = (control) => ({ control, soort: 'druk', waarde: 1, ruw: 127 });
const los = (control) => ({ control, soort: 'los', waarde: 0, ruw: 0 });
const draai = (control, ruw) => ({ control, soort: 'waarde', waarde: ruw / 127, ruw });

function opzet(regels, { focus = 1, stand, docs = [] } = {}) {
  const klok = new NepKlok();
  const { bus, log, waarden } = maakBus({ stand });
  const vars = { focus: () => vars.n, n: focus };
  const ind = new Indeling({ bus, apparaat: apc, vars: { focus: () => vars.n }, nu: klok.nu, bron: 'apc' });
  const r = ind.voegToe(doc(regels));
  assert.deepEqual(r.fouten, []);
  for (const d of docs) ind.voegToe(d);
  return { ind, bus, log, waarden, klok, vars };
}

test('{k} schrijft een regel uit voor elke kolom; {focus} geldt bij het indrukken', () => {
  const { ind, log, vars } = opzet([
    { control: 'act{k}', actie: 'track.{k}.play', gedrag: 'trigger' },
    { control: 'nudgeP', actie: 'track.{focus}.nudge.voor', gedrag: 'trigger' },
  ]);
  assert.equal([...ind.actief.op.keys()].filter((k) => k.startsWith('act')).length, 8);
  ind.verwerk(druk('act5'));
  ind.verwerk(los('act5'));
  vars.n = 3;
  ind.verwerk(druk('nudgeP'));
  vars.n = 6;                          // de focus wisselt terwijl je vasthoudt
  ind.verwerk(los('nudgeP'));
  assert.deepEqual(log, [
    ['track.5.play', true, 'apc'], ['track.5.play', false, 'apc'],
    ['track.3.nudge.voor', true, 'apc'], ['track.3.nudge.voor', false, 'apc'],
  ]);
});

test('shift: de shift-regel, een fader blijft werken; loslaten na shift los gaat naar het indrukken', () => {
  const { ind, log } = opzet([
    { control: 'act1', actie: 'track.1.play', gedrag: 'trigger' },
    { control: 'act1', shift: true, actie: 'track.1.play.quant', gedrag: 'trigger' },
    { control: 'fader1', actie: 'track.1.fader', gedrag: 'absoluut' },
  ], { stand: { 'track.1.fader': 0.5 } });
  ind.verwerk(druk('shift'));
  assert.equal(ind.shift, true);
  ind.verwerk(druk('act1'));
  ind.verwerk(los('shift'));
  ind.verwerk(los('act1'));
  ind.verwerk(draai('fader1', 64));
  assert.deepEqual(log.map(([id, v]) => `${id}=${v}`), ['track.1.play.quant=true', 'track.1.play.quant=false', `track.1.fader=${64 / 127}`]);
});

test('lagen: een laag gaat voor de basis; shift is een variant BINNEN de laag (geen reparatieregels)', () => {
  const { ind, log } = opzet([
    { control: 'pad5-1', actie: 'track.1.hotcue.1', gedrag: 'trigger' },
    { control: 'pad5-1', shift: true, actie: 'track.1.hotcue.1.wis', gedrag: 'trigger' },
    { control: 'pad5-1', laag: 'grid.klank', actie: 'track.1.kill.hoog', gedrag: 'trigger' },
    { control: 'pad1-1', actie: 'track.1.kill.laag', gedrag: 'trigger' },
    { control: 'scene3', actie: 'laag:grid.klank', gedrag: 'trigger' },
    { control: 'scene1', actie: 'laag:grid', gedrag: 'trigger' },
  ]);
  const tik = (c) => { ind.verwerk(druk(c)); ind.verwerk(los(c)); };
  tik('pad5-1');
  tik('scene3');
  assert.deepEqual(ind.open, ['grid.klank']);
  tik('pad5-1');
  ind.verwerk(druk('shift'));
  tik('pad5-1');                       // in klank met shift: nog steeds kill hoog, niet hotcue wissen
  ind.verwerk(los('shift'));
  tik('pad1-1');                       // de laag heeft pad1-1 niet: de basis
  tik('scene1');
  assert.deepEqual(ind.open, []);
  tik('pad5-1');
  assert.deepEqual(log.filter(([, v]) => v).map(([id]) => id), [
    'track.1.hotcue.1', 'track.1.kill.hoog', 'track.1.kill.hoog', 'track.1.kill.laag', 'track.1.hotcue.1',
  ]);
  assert.equal(ind.lees('laag:grid'), 1);
  assert.equal(ind.lees('laag:grid.klank'), 0);
});

test('lagen: kort drukken = vast, vasthouden = gluren; schakelaar = open/dicht; één laag per groep', () => {
  const { ind, klok } = opzet([
    { control: 'scene2', actie: 'laag:grid.cue58', gedrag: 'trigger' },
    { control: 'scene3', actie: 'laag:grid.klank', gedrag: 'trigger' },
    { control: 'clipdev', actie: 'laag:device.rack', gedrag: 'schakelaar' },
  ]);
  ind.verwerk(druk('scene2')); ind.verwerk(los('scene2'));
  assert.deepEqual(ind.open, ['grid.cue58']);
  ind.verwerk(druk('scene3'));
  assert.deepEqual(ind.open, ['grid.klank'], 'één laag per groep');
  klok.loop(GLUREN_MS + 10);
  ind.verwerk(los('scene3'));
  assert.deepEqual(ind.open, ['grid.cue58'], 'gegluurd: terug');
  ind.verwerk(druk('clipdev')); ind.verwerk(los('clipdev'));
  assert.deepEqual(ind.open, ['device.rack', 'grid.cue58']);
  ind.verwerk(druk('clipdev')); ind.verwerk(los('clipdev'));
  assert.deepEqual(ind.open, ['grid.cue58']);
});

test('loslaten na wisselen van INDELING gaat naar de actie van het indrukken; shift blijft van zijn knop', () => {
  const B = doc([{ control: 'nudgeP', actie: 'track.2.nudge.terug', gedrag: 'trigger' }], 'ander', { shift: 'bank' });
  const { ind, log } = opzet([
    { control: 'nudgeP', actie: 'track.1.nudge.voor', gedrag: 'trigger' },
    { control: 'pad1-1', actie: 'track.1.fx.aan', gedrag: 'trigger' },
  ], { docs: [B] });
  ind.verwerk(druk('nudgeP'));
  ind.verwerk(druk('shift'));
  ind.verwerk(druk('pad1-1'));           // fx.aan: in de hulp een trigger
  assert.equal(ind.kies('ander'), true);
  assert.equal(ind.actief.naam, 'ander');
  ind.verwerk(los('nudgeP'));
  ind.verwerk(los('pad1-1'));
  ind.verwerk(los('shift'));             // in "ander" is shift de bankknop: toch los
  assert.equal(ind.shift, false);
  ind.verwerk(druk('nudgeP'));
  assert.deepEqual(log.map(([id, v]) => `${id}=${v}`), [
    'track.1.nudge.voor=true', 'track.1.fx.aan=true', 'track.1.nudge.voor=false', 'track.1.fx.aan=false', 'track.2.nudge.terug=true',
  ]);
});

test('soft-takeover: grijpen dichtbij, grijpen als hij erlangs gaat, opnieuw grijpen als iets anders de stand verzette', () => {
  const { ind, bus, log, klok } = opzet([{ control: 'fader1', actie: 'track.1.fader', gedrag: 'absoluut' }], { stand: { 'track.1.fader': 0.8 } });
  const n = () => log.length;
  ind.verwerk(draai('fader1', 25));      // 0,2: ver weg
  ind.verwerk(draai('fader1', 64));      // 0,5: nog steeds onder
  assert.equal(n(), 0, 'springt niet');
  ind.verwerk(draai('fader1', 101));     // 0,795: binnen 0,02 -> grijpt
  assert.equal(n(), 1);
  ind.verwerk(draai('fader1', 110));
  assert.equal(n(), 2);
  bus.doe('track.1.fader', 0.3, { bron: 'scherm' });   // de muis
  log.length = 0;
  ind.verwerk(draai('fader1', 111));
  assert.equal(log.length, 0, 'na de muis eerst opnieuw grijpen');
  ind.verwerk(draai('fader1', 30));      // 0,236: van boven naar onder door 0,3 heen
  assert.equal(log.length, 1, 'erlangs = grijpen');
  // Een vorige stand ouder dan LAATSTE_TTL telt niet als bewijs.
  bus.doe('track.1.fader', 0.5);
  log.length = 0;
  ind.verwerk(draai('fader1', 20));
  klok.loop(LAATSTE_TTL + 1);
  ind.verwerk(draai('fader1', 100));
  assert.equal(log.length, 0, 'na een seconde stil: geen sprong');
  assert.ok(TAKEOVER_EPS === 0.02);
});

test('eindeloos: alleen het verschil, eerste bericht alleen onthouden, aanslag, shift = fijn, andere track = opnieuw', () => {
  const { ind, bus, waarden, vars } = opzet([{ control: 'dk1', actie: 'track.{focus}.filter', gedrag: 'eindeloos' }],
    { stand: { 'track.1.filter': 0.5, 'track.2.filter': 0.1 } });
  ind.verwerk(draai('dk1', 100));        // de knop staat fysiek op 100: geen sprong naar 0,79
  assert.equal(waarden.get('track.1.filter'), 0.5);
  ind.verwerk(draai('dk1', 103));
  assert.ok(Math.abs(waarden.get('track.1.filter') - (0.5 + 3 / 127)) < 1e-12);
  ind.verwerk(draai('dk1', 127));
  const op127 = waarden.get('track.1.filter');
  ind.verwerk(draai('dk1', 127));        // nog eens op de aanslag = doordraaien
  assert.ok(Math.abs(waarden.get('track.1.filter') - (op127 + 1 / 127)) < 1e-12);
  ind.verwerk(druk('shift'));
  const voor = waarden.get('track.1.filter');
  ind.verwerk(draai('dk1', 117));        // −10 tikken, fijn
  assert.ok(Math.abs(waarden.get('track.1.filter') - (voor - 10 / 127 * FIJN)) < 1e-12);
  ind.verwerk(los('shift'));
  vars.n = 2;                            // focus wisselt: de ring toont nu track 2, opnieuw beginnen
  ind.verwerk(draai('dk1', 50));
  assert.equal(waarden.get('track.2.filter'), 0.1);
  ind.verwerk(draai('dk1', 52));
  assert.ok(Math.abs(waarden.get('track.2.filter') - (0.1 + 2 / 127)) < 1e-12);
  bus.doe('track.2.filter', 0.9);        // iets anders verzette hem: één tik kwijt, geen sprong
  ind.verwerk(draai('dk1', 60));
  assert.equal(waarden.get('track.2.filter'), 0.9);
});

test('encoder: eindeloos met stap, of als trigger per tik op actie (op) en terug (neer)', () => {
  const { ind, log, waarden } = opzet([
    { control: 'cue', actie: 'koptelefoon.volume', gedrag: 'eindeloos', stap: 0.25 },
    { control: 'tempo', actie: 'klok.tempo.op', terug: 'klok.tempo.neer', gedrag: 'trigger' },
  ], { stand: { 'koptelefoon.volume': 0.5 } });
  ind.verwerk({ control: 'cue', soort: 'delta', delta: 1 });
  assert.equal(waarden.get('koptelefoon.volume'), 0.75);
  ind.verwerk({ control: 'cue', soort: 'delta', delta: -4 });
  assert.equal(waarden.get('koptelefoon.volume'), 0);
  log.length = 0;
  ind.verwerk({ control: 'tempo', soort: 'delta', delta: 2 });
  ind.verwerk({ control: 'tempo', soort: 'delta', delta: -1 });
  ind.verwerk({ control: 'tempo', soort: 'delta', delta: 50 });   // hooguit 8
  assert.deepEqual(log.slice(0, 6).map(([id, v]) => `${id}=${v}`), [
    'klok.tempo.op=true', 'klok.tempo.op=false', 'klok.tempo.op=true', 'klok.tempo.op=false', 'klok.tempo.neer=true', 'klok.tempo.neer=false',
  ]);
  assert.equal(log.length, 6 + 16);
});

test('trigger op een waarde-actie = vasthouden; schakelaar op een waarde-actie = om', () => {
  const { ind, waarden } = opzet([
    { control: 'pad1-1', actie: 'track.1.send.a', gedrag: 'trigger' },
    { control: 'pad1-2', actie: 'track.1.send.b', gedrag: 'schakelaar' },
  ], { stand: { 'track.1.send.a': 0.3, 'track.1.send.b': 0.2 } });
  ind.verwerk(druk('pad1-1'));
  assert.equal(waarden.get('track.1.send.a'), 1);
  ind.verwerk(los('pad1-1'));
  assert.equal(waarden.get('track.1.send.a'), 0.3);
  ind.verwerk(druk('pad1-2')); ind.verwerk(los('pad1-2'));
  assert.equal(waarden.get('track.1.send.b'), 1);
  ind.verwerk(druk('pad1-2')); ind.verwerk(los('pad1-2'));
  assert.equal(waarden.get('track.1.send.b'), 0);
});

test('een actie die de bus (nog) niet kent: niets gooit, één melding per actie', () => {
  const klok = new NepKlok();
  const { bus } = maakBus({ alleen: ['track.{n}.play'] });
  const ind = new Indeling({ bus, apparaat: apc, vars: {}, nu: klok.nu });
  ind.voegToe(doc([{ control: 'pad{k}-1', actie: 'track.1.hotcue.{k}', gedrag: 'trigger' }, { control: 'dk1', actie: 'track.1.fx.mix', gedrag: 'eindeloos' }]));
  const meld = [];
  ind.on('onbekend', ({ doel }) => meld.push(doel));
  for (const c of ['pad1-1', 'pad1-1', 'pad2-1']) { ind.verwerk(druk(c)); ind.verwerk(los(c)); }
  ind.verwerk(draai('dk1', 3));
  assert.deepEqual(meld, ['track.1.hotcue.1', 'track.1.hotcue.2', 'track.1.fx.mix']);
});

test('per nummer: een nummer kiest zijn indeling, onbekend = de standaard; de tabel als JSON', () => {
  const { ind } = opzet([{ control: 'act1', actie: 'track.1.play', gedrag: 'trigger' }], {
    docs: [doc([{ control: 'act1', actie: 'track.1.cue', gedrag: 'trigger' }], 'beatloos')],
  });
  assert.equal(ind.standaard, 'proef');
  ind.koppelNummer('yt:abc', 'beatloos');
  ind.koppelNummer('yt:fout', 'bestaat-niet');
  const meld = [];
  ind.on('melding', (m) => meld.push(m.tekst));
  assert.equal(ind.kiesVoorNummer('yt:abc'), 'beatloos');
  assert.equal(ind.regelVoor('act1').actie, 'track.1.cue');
  assert.equal(ind.kiesVoorNummer('yt:zonder'), 'proef');
  assert.equal(ind.kiesVoorNummer('yt:fout'), 'proef');
  assert.equal(meld.length, 1);
  const json = JSON.parse(JSON.stringify(ind.perNummerJSON()));
  const ander = new Indeling({ bus: ind.bus, apparaat: apc });
  assert.equal(ander.laadPerNummer(json), 2);
  assert.equal(ander.perNummer.get('yt:abc'), 'beatloos');
});

test('live herladen van dezelfde indeling: nieuwe regels meteen, wat vastzat laat los naar het oude doel', () => {
  const { ind, log } = opzet([{ control: 'nudgeM', actie: 'track.1.nudge.terug', gedrag: 'trigger' }]);
  ind.verwerk(druk('nudgeM'));
  ind.voegToe(doc([{ control: 'nudgeM', actie: 'track.4.nudge.terug', gedrag: 'trigger' }]));
  ind.verwerk(los('nudgeM'));
  ind.verwerk(druk('nudgeM'));
  assert.deepEqual(log.map(([id, v]) => `${id}=${v}`), ['track.1.nudge.terug=true', 'track.1.nudge.terug=false', 'track.4.nudge.terug=true']);
});

test('losgekoppeld: shift uit, alles wat vastzat los, en de faders opnieuw grijpen', () => {
  const { ind, log } = opzet([
    { control: 'nudgeP', actie: 'track.1.nudge.voor', gedrag: 'trigger' },
    { control: 'fader1', actie: 'track.1.fader', gedrag: 'absoluut' },
  ], { stand: { 'track.1.fader': 0.5 } });
  ind.verwerk(draai('fader1', 64));
  ind.verwerk(druk('shift'));
  ind.verwerk(druk('nudgeP'));
  ind.losgekoppeld();
  assert.equal(ind.shift, false);
  assert.equal(log.at(-1).join(), 'track.1.nudge.voor,false,apc');
  log.length = 0;
  ind.verwerk(draai('fader1', 120));
  assert.equal(log.length, 0, 'na loskoppelen geen sprong');
});

test('nakijken: wat niet klopt gaat naar fouten, met de reden', () => {
  const { bus } = maakBus();
  const soortVan = (id) => bus.zoek(id)?.def.soort ?? null;
  const { indeling, fouten } = normaliseerIndeling(doc([
    { control: 'bestaatniet', actie: 'track.1.play', gedrag: 'trigger' },
    { control: 'fader1', actie: 'track.1.fader', gedrag: 'eindeloos' },
    { control: 'dk1', actie: 'track.1.play', gedrag: 'eindeloos' },
    { control: 'act1', actie: 'track.1.laad', gedrag: 'trigger' },
    { control: 'tempo', actie: 'klok.tempo.op', gedrag: 'trigger' },
    { control: 'shift', actie: 'track.1.play', gedrag: 'trigger' },
    { control: 'pad1-1', actie: 'track.1.play', gedrag: 'trigger', led: { kleur: 'paars' } },
    { control: 'scene1', actie: 'laag:grid.a.b', gedrag: 'trigger' },
    { control: 'act2', actie: 'track.2.play', gedrag: 'trigger' },
  ]), { apparaat: apc, soortVan });
  assert.equal(fouten.length, 8, fouten.join('\n'));
  assert.match(fouten.join('\n'), /bestaat niet[\s\S]*kan geen eindeloos[\s\S]*waarde-actie[\s\S]*commando[\s\S]*terug[\s\S]*shiftknop[\s\S]*kleur[\s\S]*laag/);
  assert.equal(indeling.op.size, 1);
  assert.throws(() => normaliseerIndeling({ schema: 2, naam: 'x', apparaat: 'apc40mk2', regels: [] }, { apparaat: apc }));
  assert.throws(() => normaliseerIndeling({ schema: 1, naam: 'x', apparaat: 'toetsen', regels: [] }, { apparaat: apc }));
});

test('zetRegel (leren): een sjabloonregel overschrijven, opslaan als JSON, weer weghalen', () => {
  const { ind } = opzet([{ control: 'tk{k}', actie: 'track.{k}.filter', gedrag: 'eindeloos' }]);
  const r = ind.zetRegel({ control: 'tk3', actie: 'track.3.send.a', gedrag: 'eindeloos' });
  assert.equal(r.was.actie, 'track.3.filter');
  assert.equal(ind.regelVoor('tk3').actie, 'track.3.send.a');
  assert.equal(ind.regelVoor('tk4').actie, 'track.4.filter');
  const json = ind.naarJSON();
  assert.equal(json.regels.length, 2);
  const ander = new Indeling({ bus: ind.bus, apparaat: apc });
  ander.voegToe(json);
  assert.equal(ander.regelVoor('tk3').actie, 'track.3.send.a');
  assert.equal(ind.haalWeg('tk3'), true);
  assert.equal(ind.regelVoor('tk3').actie, 'track.3.filter');
  assert.ok(ind.zetRegel({ control: 'fader1', actie: 'track.1.fader', gedrag: 'trigger' }).fout);
});
