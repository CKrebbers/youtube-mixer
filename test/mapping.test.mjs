// Mapping-laag zonder browser: geen Web MIDI, geen DOM, geen engine nodig.
// Precies dat is de winst van de scheiding — dit is allemaal pure logica.
import { readFileSync } from 'node:fs';

const { Mapping, resolveTarget } = await import('../src/control/mapping.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// Nep-engine: alleen een tabel met standen, net genoeg om read/invoke te doen.
const stand = {};
const geraakt = [];
const maak = (focus = 'A') => {
  const m = new Mapping({
    read: (id) => (id in stand ? stand[id] : null),
    invoke: (id, v) => { geraakt.push([id, v]); if (typeof v === 'number') stand[id] = v; },
    vars: () => ({ focus: m._focus }),
  });
  m._focus = focus;
  return m;
};
const cc = (num, val, ch = 0) => ({ sig: `cc:${ch}:${num}`, type: 'cc', channel: ch, number: num, value: val, norm: val / 127 });
const note = (num, on, ch = 0) => ({ sig: `note:${ch}:${num}`, type: 'note', channel: ch, number: num, value: on ? 127 : 0, norm: on ? 1 : 0, on });

// ---- laden en valideren ---------------------------------------------------

const m = maak();
const res = m.load({
  name: 'test', device: 'apc40mk2',
  rules: [
    { in: 'cc:0:15', action: 'mixer.xfader', mode: 'absolute' },
    { in: 'cc:0:16', action: 'deck.{focus}.filter', mode: 'absolute' },
    { in: 'cc:0:17', action: 'deck.{focus}.low', mode: 'relative-2c' },
    { in: 'cc:0:18', action: 'deck.A.high', mode: 'relative-bin' },
    { in: 'cc:0:19', action: 'deck.A.fader', mode: 'absolute', invert: true },
    { in: 'note:0:91', action: 'deck.{focus}.play' },
    { in: 'rommel', action: 'x', mode: 'bestaat-niet' },
    { in: 'cc:0:20' },
  ],
});
ok('geldige regels geladen', res.aantal === 6);
ok('onbekende modus geweigerd', res.fouten.some((f) => f.includes('bestaat-niet')));
ok('regel zonder action geweigerd', res.fouten.some((f) => f.includes('verplicht')));
ok('onbekende signature doet niets', m.handle(cc(99, 64)) === null);

// ---- {focus} --------------------------------------------------------------

ok('resolveTarget vult focus in', resolveTarget('deck.{focus}.filter', { focus: 'B' }) === 'deck.B.filter');
ok('resolveTarget laat onbekende variabele staan', resolveTarget('deck.{xyz}.a', { focus: 'B' }) === 'deck.{xyz}.a');

// ---- trigger --------------------------------------------------------------

geraakt.length = 0;
m.handle(note(91, true));
m.handle(note(91, false));
ok('note on -> true, note off -> false',
  geraakt.length === 2 && geraakt[0][0] === 'deck.A.play' && geraakt[0][1] === true && geraakt[1][1] === false);

m._focus = 'B';
geraakt.length = 0;
m.handle(note(91, true));
ok('trigger volgt de focus', geraakt[0][0] === 'deck.B.play');
m._focus = 'A';

// ---- wildcard-kanaal ------------------------------------------------------
// De device knobs van de APC40 mkII melden in mode 0 via het kanaal bij welke
// trackstrip ze horen. Eén regel moet ze alle negen vangen.

const mW = maak();
mW.load({ rules: [
  { in: 'cc:*:16', action: 'deck.A.trim', mode: 'absolute', takeover: 1 },
  { in: 'cc:0:16', action: 'deck.A.high', mode: 'absolute', takeover: 1 },
] });
geraakt.length = 0;
mW.handle(cc(16, 100, 0));
ok('exacte regel gaat voor de wildcard', geraakt.at(-1)[0] === 'deck.A.high');
mW.handle(cc(16, 100, 8));
ok('wildcard vangt kanaal 9', geraakt.at(-1)[0] === 'deck.A.trim');
mW.handle(cc(16, 100, 3));
ok('wildcard vangt ook kanaal 4', geraakt.at(-1)[0] === 'deck.A.trim');
ok('ongeldige signature wordt geweigerd',
  maak().load({ rules: [{ in: 'cc:16', action: 'x' }] }).fouten.length === 1);

// ---- soft-takeover --------------------------------------------------------

stand['mixer.xfader'] = 0.5;
geraakt.length = 0;
let r = m.handle(cc(15, 10));            // knop staat links, software in het midden
ok('fader ver van de softwarewaarde pakt niet over', r.taken === false && geraakt.length === 0);
ok('en meldt hoe ver hij eraf zit', Math.abs(r.software - 0.5) < 0.001);

m.handle(cc(15, 20));
ok('nog steeds los', stand['mixer.xfader'] === 0.5);

r = m.handle(cc(15, 100));               // beweegt door het midden heen
ok('doorheen bewegen pakt over', r.taken === true && stand['mixer.xfader'] > 0.7);

r = m.handle(cc(15, 40));
ok('daarna volgt hij gewoon', r.taken === true && Math.abs(stand['mixer.xfader'] - 40 / 127) < 0.001);

// dichtbij beginnen mag ook meteen
const m2 = maak();
m2.load({ rules: [{ in: 'cc:0:15', action: 'mixer.xfader', mode: 'absolute' }] });
stand['mixer.xfader'] = 0.5;
ok('knop die al dichtbij staat pakt direct over', m2.handle(cc(15, 64)).taken === true);

// ---- muis/toetsenbord verzet de waarde: knop moet weer overpakken ---------

const mM = maak();
mM.load({ rules: [{ in: 'cc:0:15', action: 'mixer.xfader', mode: 'absolute' }] });
stand['mixer.xfader'] = 0.5;
mM.handle(cc(15, 64));                    // pakt over
mM.handle(cc(15, 127));
ok('knop staat vast', Math.abs(stand['mixer.xfader'] - 1) < 0.001);
stand['mixer.xfader'] = 0.2;              // muis verzet de crossfader
const rM = mM.handle(cc(15, 127));        // knop staat nog rechts
ok('na een muisbeweging staat de knop weer los', rM.taken === false);
ok('en de waarde springt dus niet terug', Math.abs(stand['mixer.xfader'] - 0.2) < 0.001);
mM.handle(cc(15, 10));                    // door 0.2 heen
ok('na doorheen bewegen pakt hij weer over', Math.abs(stand['mixer.xfader'] - 10 / 127) < 0.001);

const mT = maak();
mT.load({ rules: [{ in: 'cc:0:15', action: 'mixer.xfader', mode: 'absolute', takeover: 1 }] });
stand['mixer.xfader'] = 0.5;
ok('takeover:1 zet de hele beveiliging uit', mT.handle(cc(15, 127)).taken === true);

// ---- deck-switch: dit is waarom soft-takeover bestaat ---------------------

const m3 = maak('A');
m3.load({ rules: [{ in: 'cc:0:16', action: 'deck.{focus}.filter', mode: 'absolute' }] });
stand['deck.A.filter'] = 0.5;
stand['deck.B.filter'] = 0.1;
m3.handle(cc(16, 64));
m3.handle(cc(16, 90));
ok('knop staat vast op deck A', Math.abs(stand['deck.A.filter'] - 90 / 127) < 0.001);

m3._focus = 'B';                          // deck-switch, knop blijft fysiek op 0.71
const voor = stand['deck.B.filter'];
const rb = m3.handle(cc(16, 90));
ok('na deck-switch staat de knop weer los', rb.taken === false && stand['deck.B.filter'] === voor);
ok('deck B springt dus niet', Math.abs(stand['deck.B.filter'] - 0.1) < 0.001);
m3.handle(cc(16, 5));                     // door 0.1 heen
ok('pas als je er doorheen beweegt pakt hij deck B', Math.abs(stand['deck.B.filter'] - 5 / 127) < 0.001);

// ---- relatieve encoders ---------------------------------------------------

stand['deck.A.low'] = 0.5;
m.handle(cc(17, 1));                      // +1
ok('relative-2c telt op', Math.abs(stand['deck.A.low'] - (0.5 + 1 / 127)) < 1e-9);
m.handle(cc(17, 127));                    // -1
ok('relative-2c trekt af', Math.abs(stand['deck.A.low'] - 0.5) < 1e-9);
m.handle(cc(17, 0));                      // geen stap
ok('relative-2c: 0 doet niets', Math.abs(stand['deck.A.low'] - 0.5) < 1e-9);
stand['deck.A.low'] = 1;
m.handle(cc(17, 5));
ok('relatief klemt op 1', stand['deck.A.low'] === 1);

stand['deck.A.high'] = 0.5;
m.handle(cc(18, 68));                     // 68 - 64 = +4
ok('relative-bin telt op', Math.abs(stand['deck.A.high'] - (0.5 + 4 / 127)) < 1e-9);
m.handle(cc(18, 60));                     // -4
ok('relative-bin trekt af', Math.abs(stand['deck.A.high'] - 0.5) < 1e-9);

// ---- invert ---------------------------------------------------------------

stand['deck.A.fader'] = 1;
m.handle(cc(19, 0));
ok('invert draait de fader om', Math.abs(stand['deck.A.fader'] - 1) < 0.001);
m.handle(cc(19, 127));
ok('invert: 127 wordt 0', Math.abs(stand['deck.A.fader'] - 0) < 0.001);

// ---- banken: dezelfde knop, ander kanaal, andere bestemming ---------------
// De APC40 mkII verhuist zijn acht device knobs van MIDI-kanaal zodra je een
// andere bank kiest. Daarmee is één fysieke knop negen keer te koppelen.

const mB = maak();
mB.load({ rules: [
  { in: 'cc:0:16', action: 'deck.A.high', mode: 'absolute' },
  { in: 'cc:1:16', action: 'deck.B.high', mode: 'absolute' },
] });
stand['deck.A.high'] = 0.5; stand['deck.B.high'] = 0.5;
mB.handle(cc(16, 64, 0)); mB.handle(cc(16, 127, 0));
ok('bank 1 stuurt deck A', Math.abs(stand['deck.A.high'] - 1) < 0.01);
ok('en laat deck B met rust', Math.abs(stand['deck.B.high'] - 0.5) < 1e-9);
mB.handle(cc(16, 64, 1)); mB.handle(cc(16, 0, 1));
ok('bank 2 stuurt deck B', Math.abs(stand['deck.B.high'] - 0) < 0.01);
ok('en laat deck A met rust', Math.abs(stand['deck.A.high'] - 1) < 1e-9);

// ---- een oude knopstand is geen bewijs meer -------------------------------
// Na een bankwissel wijst dezelfde knop ergens anders heen terwijl hij fysiek
// verdraaid kan zijn. Rekenen met zijn vorige stand laat de waarde alsnog
// springen — precies wat soft-takeover moet voorkomen.

let klok = 0;
const mTtl = new Mapping({
  read: (id) => (id in stand ? stand[id] : null),
  invoke: (id, v) => { if (typeof v === 'number') stand[id] = v; },
  vars: () => ({}), now: () => klok,
});
mTtl.load({ rules: [{ in: 'cc:0:16', action: 'mixer.master', mode: 'absolute' }] });
stand['mixer.master'] = 0.5;
mTtl.handle(cc(16, 12));                    // knop staat links, pakt niet over
ok('ver weg pakt niet over', Math.abs(stand['mixer.master'] - 0.5) < 1e-9);
klok += 2000;                             // ondertussen op een andere bank gedraaid
mTtl.handle(cc(16, 115));
ok('een verouderde stand telt niet als doorheen bewegen',
  Math.abs(stand['mixer.master'] - 0.5) < 1e-9);
mTtl.handle(cc(16, 60));                    // nu wel echt er doorheen
ok('vers bewijs pakt wel over', Math.abs(stand['mixer.master'] - 60 / 127) < 0.001);

// ---- export en import -----------------------------------------------------

const doc = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
const m4 = maak();
const g1 = m4.load(doc);
ok('standaardmapping laadt zonder fouten', g1.fouten.length === 0 && g1.aantal === doc.rules.length);

const m5 = maak();
m5.load(JSON.parse(m4.export()));
ok('export -> import geeft exact dezelfde staat',
  JSON.stringify(m5.toJSON()) === JSON.stringify(m4.toJSON()));

// ---- de standaardmapping tegen de werkelijkheid ---------------------------
// Een deck-dubbel: genoeg om bindEngine zijn werk te laten doen, zonder audio.

const { bindEngine, list, read } = await import('../src/control/actions.js');
const dubbeldeck = (id) => ({
  id, playing: false, position: 0, cuePoint: 0, duration: 10, rate: 1, buffer: {},
  hotcues: [null, null, null, null], loop: null,
  ui: { trim: 0.5, low: 0.5, mid: 0.5, high: 0.5, filter: 0.5, fader: 1 },
  togglePlay() { this.playing = !this.playing; }, cue() {}, hotcue(i) { this.hotcues[i] = 1; },
  setLoop(s) { this.loop = { start: 0, end: s }; }, clearLoop() { this.loop = null; },
  halveLoop() {}, doubleLoop() {}, nudge() {}, seek() {}, setRate(r) { this.rate = r; },
  set(p, v) { this.ui[p] = v; },
});
const nepEngine = {
  decks: { A: dubbeldeck('A'), B: dubbeldeck('B') },
  focus: 'A', xfader: 0.5, masterLevel: 0.8, xfaderCurve: 'smooth',
  deck(id) { return this.decks[id]; },
  ander(id) { return this.decks[id === 'A' ? 'B' : 'A']; },
  setFocus(id) { this.focus = id; }, setXfader(v) { this.xfader = v; },
  setMaster(v) { this.masterLevel = v; }, setXfaderCurve(c) { this.xfaderCurve = c; },
};
bindEngine(nepEngine);
const acties = new Set(list().map((a) => a.id));
ok('actions geregistreerd voor deze controle', acties.size > 60);

const onbekend = [];
for (const regel of doc.rules) {
  for (const f of ['A', 'B']) {
    const t = resolveTarget(regel.action, { focus: f });
    if (!acties.has(t)) onbekend.push(t);
  }
}
if (onbekend.length) console.log('   onbekend:', [...new Set(onbekend)]);
ok('mapping verwijst alleen naar bestaande actions', onbekend.length === 0);

const dubbel = doc.rules.map((r) => r.in).filter((v, i, a) => a.indexOf(v) !== i);
ok('geen dubbele signatures in de mapping', dubbel.length === 0);

// Een wildcard-kanaal controleren we op kanaal 0: bestaat die control daar,
// dan bestaat hij ook op de andere kanalen die het apparaat gebruikt.
const buitenProfiel = doc.rules.map((r) => r.in.replace(':*:', ':0:')).filter((sig) => !apc.controls.has(sig));
if (buitenProfiel.length) console.log('   buiten profiel:', buitenProfiel);
ok('elke signature bestaat op het apparaat', buitenProfiel.length === 0);

// ---- read(): de uitbreiding waar soft-takeover op leunt -------------------

nepEngine.decks.A.ui.filter = 0.25;
ok('read geeft de stand van een value-action', Math.abs(read('deck.A.filter') - 0.25) < 1e-9);
nepEngine.decks.A.playing = true;
ok('read geeft 1 voor een ingedrukte trigger', read('deck.A.play') === 1);
nepEngine.decks.A.playing = false;
ok('read geeft 0 voor een losse trigger', read('deck.A.play') === 0);
ok('read geeft null als een action niets terug te lezen heeft', read('deck.A.loop.halve') === null);
ok('read geeft null voor onbekende action', read('bestaat.niet') === null);

// Een echte soft-takeover tegen de echte action-bus, niet tegen een tabel.
const { invoke } = await import('../src/control/actions.js');
const echt = new Mapping({ read, invoke, vars: () => ({ focus: nepEngine.focus }) });
echt.load({ rules: [{ in: 'cc:0:16', action: 'deck.{focus}.filter', mode: 'absolute' }] });
nepEngine.decks.A.ui.filter = 0.5;
echt.handle(cc(16, 10));
ok('echte bus: fader pakt niet over', Math.abs(nepEngine.decks.A.ui.filter - 0.5) < 1e-9);
echt.handle(cc(16, 120));
ok('echte bus: doorheen bewegen pakt wel over', nepEngine.decks.A.ui.filter > 0.9);

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
