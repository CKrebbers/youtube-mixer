// MIDI-learn zonder browser: berichten erin, koppelingen eruit.
const { Mapping } = await import('../src/control/mapping.js');
const { MidiLearn, raadModus } = await import('../src/control/midi-learn.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const cc = (num, val, ch = 0) => ({ sig: `cc:${ch}:${num}`, type: 'cc', channel: ch, number: num, value: val, norm: val / 127 });
const note = (num, on, ch = 0) => ({ sig: `note:${ch}:${num}`, type: 'note', channel: ch, number: num, value: on ? 127 : 0, norm: on ? 1 : 0, on });

// ---- modusherkenning ------------------------------------------------------

const ccs = (...w) => w.map((v) => ({ type: 'cc', value: v }));
ok('noot wordt een trigger', raadModus([{ type: 'note' }]) === 'trigger');
ok('fader die sweept is absoluut', raadModus(ccs(0, 20, 60, 100, 127)) === 'absolute');
ok('encoder rond 0/127 is tweecomplement', raadModus(ccs(1, 1, 127, 1, 126)) === 'relative-2c');
ok('encoder rond 64 is binary offset', raadModus(ccs(65, 65, 63, 66, 64)) === 'relative-bin');
ok('te weinig bewijs blijft absoluut', raadModus(ccs(1, 1)) === 'absolute');
ok('een fader die toevallig bij 64 begint blijft absoluut',
  raadModus(ccs(64, 70, 90, 110, 127)) === 'absolute');

// ---- leren ----------------------------------------------------------------

const geraakt = [];
const stand = { 'track.1.filter': 0.5, 'track.1.play': 0, 'track.2.low': 0.5 };
const maak = () => new Mapping({
  read: (id) => stand[id] ?? null,
  invoke: (id, v) => { geraakt.push([id, v]); if (typeof v === 'number') stand[id] = v; },
  vars: () => ({ focus: 1 }),
});

let klok = 0;
const m = maak();
const leer = new MidiLearn({ mapping: m, device: apc, now: () => klok });

ok('leert niets zolang hij niet gestart is', leer.feed(note(0x35, true)) === null && !leer.busy);

leer.start('track.1.play');
ok('gestart betekent bezig', leer.busy);
const r1 = leer.feed(note(0x20, true));      // pad 1/1, bestaat echt op het apparaat
ok('een noot koppelt meteen', r1.sig === 'note:0:32' && r1.mode === 'trigger');
ok('en stopt daarna vanzelf', !leer.busy);
ok('de regel staat in de mapping', m.rules.get('note:0:32')?.action === 'track.1.play');
ok('met de naam van het apparaat erbij', m.rules.get('note:0:32').label === 'pad 1/1');

// een knop die het profiel niet kent koppelt ook, gewoon zonder naam
leer.start('track.1.cue');
leer.feed(note(0x35, true));
ok('onbekende knop koppelt zonder naam',
  m.rules.get('note:0:53')?.action === 'track.1.cue' && m.rules.get('note:0:53').label === undefined);

// meteen bruikbaar, zonder herstart
geraakt.length = 0;
m.handle(note(0x20, true));
ok('de nieuwe koppeling werkt direct', geraakt.at(-1)?.[0] === 'track.1.play');

// ---- een CC scherpt zichzelf aan ------------------------------------------

klok = 1000;
leer.start('track.2.low');
leer.feed(cc(20, 1));
ok('eerste CC koppelt vast als absoluut', m.rules.get('cc:0:20').mode === 'absolute');
ok('en blijft luisteren', leer.busy);
leer.feed(cc(20, 1)); leer.feed(cc(20, 127)); leer.feed(cc(20, 1));
ok('na genoeg stapjes herkent hij de encoder', m.rules.get('cc:0:20').mode === 'relative-2c');
klok += 700;
leer.feed(cc(20, 127));
ok('na het venster stopt hij', !leer.busy);

// ---- per ongeluk een andere knop aanraken ---------------------------------

klok += 1000;
leer.start('track.1.filter');
leer.feed(cc(30, 5));
leer.feed(cc(31, 60));      // toch een andere knop
leer.feed(cc(31, 61));
ok('de laatste knop wint', m.rules.get('cc:0:31')?.action === 'track.1.filter');
ok('de per ongeluk aangeraakte knop is weer los',
  m.rules.get('cc:0:30')?.action === 'track.1.filter');
leer.stop();

// ---- overschrijven wordt gemeld -------------------------------------------

klok += 1000;
let gemeld = null;
leer.on('bound', (b) => { gemeld = b; });
leer.start('track.1.play');
leer.feed(cc(31, 100));
ok('overschrijven wordt gemeld', gemeld.overschrijft === 'track.1.filter');
ok('en de nieuwe action staat er', m.rules.get('cc:0:31').action === 'track.1.play');

// ---- vergeten -------------------------------------------------------------

const weg = leer.vergeet('track.1.play');
ok('vergeten haalt alle koppelingen weg', weg.length === 2 && m.forAction('track.1.play').length === 0);
ok('vergeten van iets zonder koppeling doet niets', leer.vergeet('track.2.play').length === 0);

// ---- rommel niet koppelen -------------------------------------------------

klok += 1000;
leer.start('track.1.cue');
ok('clock koppelt niet', leer.feed({ sig: 'clock', type: 'clock', channel: -1, value: 0 }) === null);
ok('en hij blijft wachten', leer.busy);
leer.stop();

// ---- export en import na het leren ----------------------------------------

const tekst = m.export();
const m2 = maak();
const uitslag = m2.load(tekst);
ok('een geleerde mapping laadt zonder fouten', uitslag.fouten.length === 0);
ok('export -> import geeft exact dezelfde staat', JSON.stringify(m2.toJSON()) === JSON.stringify(m.toJSON()));
ok('inclusief de geleerde modus', m2.rules.get('cc:0:20').mode === 'relative-2c');

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
