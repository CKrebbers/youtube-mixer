// Mapping-laag zonder browser: geen Web MIDI, geen DOM, geen engine nodig.
// Precies dat is de winst van de scheiding — dit is allemaal pure logica.
import { readFileSync } from 'node:fs';
import { trackVanDeck } from '../src/control/actions.js';

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
    vars: () => ({ focus: trackVanDeck(m._focus) }),
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
    { in: 'cc:0:16', action: 'track.{focus}.filter', mode: 'absolute' },
    { in: 'cc:0:17', action: 'track.{focus}.low', mode: 'relative-2c' },
    { in: 'cc:0:18', action: 'track.1.high', mode: 'relative-bin' },
    { in: 'cc:0:19', action: 'track.1.fader', mode: 'absolute', invert: true },
    { in: 'note:0:91', action: 'track.{focus}.play' },
    { in: 'rommel', action: 'x', mode: 'bestaat-niet' },
    { in: 'cc:0:20' },
  ],
});
ok('geldige regels geladen', res.aantal === 6);
ok('onbekende modus geweigerd', res.fouten.some((f) => f.includes('bestaat-niet')));
ok('regel zonder action geweigerd', res.fouten.some((f) => f.includes('verplicht')));
ok('onbekende signature doet niets', m.handle(cc(99, 64)) === null);

// ---- {focus} --------------------------------------------------------------

ok('resolveTarget vult focus in', resolveTarget('track.{focus}.filter', { focus: 2 }) === 'track.2.filter');
ok('resolveTarget laat onbekende variabele staan', resolveTarget('deck.{xyz}.a', { focus: 'B' }) === 'deck.{xyz}.a');

// ---- trigger --------------------------------------------------------------

geraakt.length = 0;
m.handle(note(91, true));
m.handle(note(91, false));
ok('note on -> true, note off -> false',
  geraakt.length === 2 && geraakt[0][0] === 'track.1.play' && geraakt[0][1] === true && geraakt[1][1] === false);

m._focus = 'B';
geraakt.length = 0;
m.handle(note(91, true));
ok('trigger volgt de focus', geraakt[0][0] === 'track.2.play');
m._focus = 'A';

// ---- wildcard-kanaal ------------------------------------------------------
// De device knobs van de APC40 mkII melden in mode 0 via het kanaal bij welke
// trackstrip ze horen. Eén regel moet ze alle negen vangen.

const mW = maak();
mW.load({ rules: [
  { in: 'cc:*:16', action: 'track.1.trim', mode: 'absolute', takeover: 1 },
  { in: 'cc:0:16', action: 'track.1.high', mode: 'absolute', takeover: 1 },
] });
geraakt.length = 0;
mW.handle(cc(16, 100, 0));
ok('exacte regel gaat voor de wildcard', geraakt.at(-1)[0] === 'track.1.high');
mW.handle(cc(16, 100, 8));
ok('wildcard vangt kanaal 9', geraakt.at(-1)[0] === 'track.1.trim');
mW.handle(cc(16, 100, 3));
ok('wildcard vangt ook kanaal 4', geraakt.at(-1)[0] === 'track.1.trim');
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
m3.load({ rules: [{ in: 'cc:0:16', action: 'track.{focus}.filter', mode: 'absolute' }] });
stand['track.1.filter'] = 0.5;
stand['track.2.filter'] = 0.1;
m3.handle(cc(16, 64));
m3.handle(cc(16, 90));
ok('knop staat vast op deck A', Math.abs(stand['track.1.filter'] - 90 / 127) < 0.001);

m3._focus = 'B';                          // deck-switch, knop blijft fysiek op 0.71
const voor = stand['track.2.filter'];
const rb = m3.handle(cc(16, 90));
ok('na deck-switch staat de knop weer los', rb.taken === false && stand['track.2.filter'] === voor);
ok('deck B springt dus niet', Math.abs(stand['track.2.filter'] - 0.1) < 0.001);
m3.handle(cc(16, 5));                     // door 0.1 heen
ok('pas als je er doorheen beweegt pakt hij deck B', Math.abs(stand['track.2.filter'] - 5 / 127) < 0.001);

// ---- relatieve encoders ---------------------------------------------------

stand['track.1.low'] = 0.5;
m.handle(cc(17, 1));                      // +1
ok('relative-2c telt op', Math.abs(stand['track.1.low'] - (0.5 + 1 / 127)) < 1e-9);
m.handle(cc(17, 127));                    // -1
ok('relative-2c trekt af', Math.abs(stand['track.1.low'] - 0.5) < 1e-9);
m.handle(cc(17, 0));                      // geen stap
ok('relative-2c: 0 doet niets', Math.abs(stand['track.1.low'] - 0.5) < 1e-9);
stand['track.1.low'] = 1;
m.handle(cc(17, 5));
ok('relatief klemt op 1', stand['track.1.low'] === 1);

stand['track.1.high'] = 0.5;
m.handle(cc(18, 68));                     // 68 - 64 = +4
ok('relative-bin telt op', Math.abs(stand['track.1.high'] - (0.5 + 4 / 127)) < 1e-9);
m.handle(cc(18, 60));                     // -4
ok('relative-bin trekt af', Math.abs(stand['track.1.high'] - 0.5) < 1e-9);

// ---- invert ---------------------------------------------------------------

stand['track.1.fader'] = 1;
m.handle(cc(19, 0));
ok('invert draait de fader om', Math.abs(stand['track.1.fader'] - 1) < 0.001);
m.handle(cc(19, 127));
ok('invert: 127 wordt 0', Math.abs(stand['track.1.fader'] - 0) < 0.001);

// ---- banken: dezelfde knop, ander kanaal, andere bestemming ---------------
// De APC40 mkII verhuist zijn acht device knobs van MIDI-kanaal zodra je een
// andere bank kiest. Daarmee is één fysieke knop negen keer te koppelen.

const mB = maak();
mB.load({ rules: [
  { in: 'cc:0:16', action: 'track.1.high', mode: 'absolute' },
  { in: 'cc:1:16', action: 'track.2.high', mode: 'absolute' },
] });
stand['track.1.high'] = 0.5; stand['track.2.high'] = 0.5;
mB.handle(cc(16, 64, 0)); mB.handle(cc(16, 127, 0));
ok('bank 1 stuurt deck A', Math.abs(stand['track.1.high'] - 1) < 0.01);
ok('en laat deck B met rust', Math.abs(stand['track.2.high'] - 0.5) < 1e-9);
mB.handle(cc(16, 64, 1)); mB.handle(cc(16, 0, 1));
ok('bank 2 stuurt deck B', Math.abs(stand['track.2.high'] - 0) < 0.01);
ok('en laat deck A met rust', Math.abs(stand['track.1.high'] - 1) < 1e-9);

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

const { bindEngine, bindVideo, bindApp, bindLagen, bindAuto, list, read } = await import('../src/control/actions.js');
const { Lagen } = await import('../src/control/lagen.js');
const { sleutelVan } = await import('../src/control/mapping.js');
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
  // Genoeg om ook sampler, bussen, video, vensters en mapjes te laten bestaan.
  sampler: { pads: [], herinneringen: [], tellen: 4, volume: 0.8 },
  sends: { A: { setPlek() {}, leesPlek: () => 0 }, B: { setPlek() {}, leesPlek: () => 0 } },
};
bindEngine(nepEngine);
bindVideo({ fx: {}, modus: 'mix', puls: 0, pulsDoel: 'rgb', zetFx() {}, volgendeModus() {}, zetPuls() {}, volgendPulsDoel() {} });
bindApp({ toon() {}, venster: () => ({ L: 'A', R: 'B' }), opnemer: {}, opnameStart() {}, opnameStop() {}, opnameSoort() {}, rackStap() {} });
bindLagen(new Lagen());
// De auto-DJ (modus auto, Shift + scene 4): zijn actions bestaan pas met een automaat.
bindAuto({ aan: false, fase: 'uit', volgende: null, zetAan() {}, ok() {}, overslaan() {}, langer() {}, nu() {} });
const acties = new Set(list().map((a) => a.id));
ok('actions geregistreerd voor deze controle', acties.size > 60);

const onbekend = [];
for (const regel of doc.rules) {
  for (const f of ['A', 'B']) {
    const t = resolveTarget(regel.action, { focus: trackVanDeck(f) });
    if (!acties.has(t)) onbekend.push(t);
  }
}
if (onbekend.length) console.log('   onbekend:', [...new Set(onbekend)]);
ok('mapping verwijst alleen naar bestaande actions', onbekend.length === 0);

// Met shift en mapjes mag een knop vaker voorkomen; per sleutel niet.
const dubbel = doc.rules.map(sleutelVan).filter((v, i, a) => a.indexOf(v) !== i);
if (dubbel.length) console.log('   dubbel:', dubbel);
ok('geen dubbele sleutels (knop + shift + mapje) in de mapping', dubbel.length === 0);
const { GROEPEN } = await import('../src/control/lagen.js');
const bestaat = (l) => { const [g, n] = l.split('.'); return Object.values(GROEPEN[g]?.knoppen || {}).flat().includes(n); };
ok('elk mapje uit de mapping bestaat in lagen.js', doc.rules.every((r) => !r.laag || bestaat(r.laag)));
// Een mapje mag ook zijn regels uit een fragment halen (apc40mk2-vormen.json:
// het mapje "vorm", alleen met ?vormen=1).
(await import('../src/control/lagen.js')).voegVormMapjeToe();   // zoals opzetVormen met ?vormen=1
const fragment = JSON.parse(readFileSync(new URL('../mappings/apc40mk2-vormen.json', import.meta.url), 'utf8'));
const metFragment = [...doc.rules, ...fragment.rules];
ok('elk mapje in lagen.js heeft regels in de mapping of een fragment', Object.entries(GROEPEN).every(([g, d]) =>
  Object.values(d.knoppen).flat().every((n) => metFragment.some((r) => r.laag === `${g}.${n}`))));
ok('ook het fragment gebruikt alleen bestaande mapjes en signatures',
  fragment.rules.every((r) => (!r.laag || bestaat(r.laag)) && apc.controls.has(r.in)));

// Een wildcard-kanaal controleren we op kanaal 0: bestaat die control daar,
// dan bestaat hij ook op de andere kanalen die het apparaat gebruikt.
const buitenProfiel = doc.rules.map((r) => r.in.replace(':*:', ':0:')).filter((sig) => !apc.controls.has(sig));
if (buitenProfiel.length) console.log('   buiten profiel:', buitenProfiel);
ok('elke signature bestaat op het apparaat', buitenProfiel.length === 0);

// ---- read(): de uitbreiding waar soft-takeover op leunt -------------------

nepEngine.decks.A.ui.filter = 0.25;
ok('read geeft de stand van een value-action', Math.abs(read('track.1.filter') - 0.25) < 1e-9);
nepEngine.decks.A.playing = true;
ok('read geeft 1 voor een ingedrukte trigger', read('track.1.play') === 1);
nepEngine.decks.A.playing = false;
ok('read geeft 0 voor een losse trigger', read('track.1.play') === 0);
ok('read geeft null als een action niets terug te lezen heeft', read('track.1.loop.halve') === null);
ok('read geeft null voor onbekende action', read('bestaat.niet') === null);

// Een echte soft-takeover tegen de echte action-bus, niet tegen een tabel.
const { invoke } = await import('../src/control/actions.js');
const echt = new Mapping({ read, invoke, vars: () => ({ focus: trackVanDeck(nepEngine.focus) }) });
echt.load({ rules: [{ in: 'cc:0:16', action: 'track.{focus}.filter', mode: 'absolute' }] });
nepEngine.decks.A.ui.filter = 0.5;
echt.handle(cc(16, 10));
ok('echte bus: fader pakt niet over', Math.abs(nepEngine.decks.A.ui.filter - 0.5) < 1e-9);
echt.handle(cc(16, 120));
ok('echte bus: doorheen bewegen pakt wel over', nepEngine.decks.A.ui.filter > 0.9);

// ---- migratie: deck.A wordt track.1 ---------------------------------------
// Een mapping die je vóór 23 september exporteerde mag niet stil stukgaan.

console.log('\nmigratie van versie 1');
{
  const oud = new Mapping({ read: () => 0, invoke: () => {} });
  const r = oud.load({ version: 1, rules: [
    { in: 'cc:0:48', action: 'deck.A.filter', mode: 'absolute' },
    { in: 'cc:1:48', action: 'deck.B.fx.knop.3', mode: 'absolute' },
    { in: 'note:0:91', action: 'deck.{focus}.play' },
    { in: 'cc:0:14', action: 'mixer.master', mode: 'absolute' },
  ] });
  ok('deck.A wordt track.1', oud.rules.get('cc:0:48').action === 'track.1.filter');
  ok('deck.B.fx.knop wordt in één keer track.2.fx.knob (v1 -> v3)', oud.rules.get('cc:1:48').action === 'track.2.fx.knob.3');
  ok('deck.{focus} wordt track.{focus}', oud.rules.get('note:0:91').action === 'track.{focus}.play');
  ok('mixer blijft staan', oud.rules.get('cc:0:14').action === 'mixer.master');
  ok('er wordt geteld wat er omgezet is', r.gemigreerd === 3);
  ok('zonder versienummer telt als 1',
    oud.load({ rules: [{ in: 'cc:0:48', action: 'deck.A.low', mode: 'absolute' }] }).gemigreerd === 1);
  ok('opnieuw exporteren geeft versie 3', oud.toJSON().version === 3);

  // Versie 2 -> 3: alle namen Engels. Elke oude naam die ooit bestond.
  const v2 = new Mapping({ read: () => 0, invoke: () => {} });
  const paren = [
    ['track.1.fx.knop.4', 'track.1.fx.knob.4'], ['track.{focus}.fx.knop.1.druk', 'track.{focus}.fx.knob.1.hold'],
    ['send.a.knop.2', 'send.a.knob.2'], ['send.b.knop.3.druk', 'send.b.knob.3.hold'],
    ['track.2.loop.wissel', 'track.2.loop.toggle'], ['track.3.maat', 'track.3.leads'], ['track.3.tel', 'track.3.beat'],
    ['track.1.pitch.bereik', 'track.1.pitch.range'], ['track.4.xfade.kant', 'track.4.xfade.side'],
    ['track.5.rack.volgend', 'track.5.rack.next'], ['track.5.rack.vorig', 'track.5.rack.prev'],
    ['sampler.7.wis', 'sampler.7.clear'], ['sampler.lengte', 'sampler.length'],
    ['focus.vorige', 'focus.prev'], ['focus.volgende', 'focus.next'], ['venster.R.toon.6', 'window.R.show.6'],
    ['opname.start', 'record.start'], ['opname.stop', 'record.stop'], ['opname.soort', 'record.mode'],
    ['video.modus', 'video.mode'], ['video.puls', 'video.pulse'], ['video.puls.doel', 'video.pulse.target'],
    ['video.fx.spiegel', 'video.fx.mirror'], ['video.fx.kleur', 'video.fx.color'], ['video.fx.sporen', 'video.fx.trails'],
    ['video.fx.korrel', 'video.fx.grain'],
  ];
  const r3 = v2.load({ version: 2, rules: paren.map(([a], i) => ({ in: `note:0:${i}`, action: a, mode: 'trigger' })) });
  const fout = paren.filter(([, b], i) => v2.rules.get(`note:0:${i}`).action !== b);
  ok(`versie 2 -> 3: alle ${paren.length} oude namen omgezet${fout.length ? ' — fout: ' + fout.map((x) => x[0]).join(', ') : ''}`,
    fout.length === 0 && r3.gemigreerd === paren.length);

  const nieuw = new Mapping({ read: () => 0, invoke: () => {} });
  const r2 = nieuw.load({ version: 3, rules: [{ in: 'cc:0:48', action: 'deck.A.filter', mode: 'absolute' }] });
  ok('versie 3 wordt niet aangeraakt', r2.gemigreerd === 0 && nieuw.rules.get('cc:0:48').action === 'deck.A.filter');
}

// ---- mapjes en shift (VRAGEN B3) -----------------------------------------

console.log('\nmapjes en shift');
{
  const { Lagen, GLUREN } = await import('../src/control/lagen.js');
  let t = 0;
  const lg = new Lagen({ now: () => t });
  ok('begint op de standaard-mapjes: grid-modus uit, strip en hotcues', lg.actief().join() === 'edit.uit,device.strip,grid.hotcues');
  lg.druk('device', 'view', true); t += 100; lg.druk('device', 'view', false);
  ok('Clip/Device View: strip -> rack', lg.stand.device === 'rack');
  lg.druk('device', 'view', true); t += 100; lg.druk('device', 'view', false);
  ok('nog eens: terug naar de strip (twee standen)', lg.stand.device === 'strip');
  lg.druk('grid', 'loops', true); t += 50; lg.druk('grid', 'loops', false);
  ok('kort drukken zet de grid-modus vast', lg.stand.grid === 'loops');
  lg.druk('grid', 'sampler', true); t += GLUREN + 10;
  ok('vasthouden: de modus is open zolang je vasthoudt', lg.stand.grid === 'sampler');
  lg.druk('grid', 'sampler', false);
  ok('loslaten na gluren: terug naar waar je was', lg.stand.grid === 'loops');
  lg.zet('grid', 'hotcues');
  lg.stap('grid', 1);
  ok('bladeren door het grid', lg.stand.grid === 'loops');
  lg.stap('grid', -2);
  ok('en rond (zeven modi: van loops twee terug is stems, 5 okt)', lg.stand.grid === 'stems');
  lg.zet('grid', 'hotcues');

  const gestuurd = [];
  const m = new Mapping({ read: () => 0.5, invoke: (a, v) => gestuurd.push([a, v]), vars: () => ({ focus: 3 }), lagen: () => lg.actief() });
  m.load({ version: 3, shift: 'note:0:98', rules: [
    { in: 'note:0:52', action: 'track.1.loop.toggle', mode: 'trigger' },
    { in: 'note:0:52', action: 'track.1.loop.exit', mode: 'trigger', shift: true },
    { in: 'cc:0:7', action: 'track.1.fader', mode: 'absolute' },
    { in: 'cc:0:16', action: 'track.{focus}.trim', mode: 'absolute', laag: 'device.strip' },
    { in: 'cc:0:16', action: 'track.{focus}.fx.knob.1', mode: 'absolute', laag: 'device.rack' },
    { in: 'note:0:32', action: 'track.1.hotcue.1', mode: 'trigger', laag: 'grid.hotcues' },
    { in: 'note:0:32', action: 'track.1.hotcue.1.delete', mode: 'trigger', laag: 'grid.hotcues', shift: true },
    { in: 'note:0:32', action: 'track.1.beatloop.1', mode: 'trigger', laag: 'grid.loops' },
  ] });
  const noot = (n, on) => ({ type: 'note', channel: 0, number: n, sig: `note:0:${n}`, on, value: on ? 127 : 0, norm: on ? 1 : 0 });
  const cc = (n, v) => ({ type: 'cc', channel: 0, number: n, sig: `cc:0:${n}`, value: v, norm: v / 127 });
  ok('meerdere regels per knop worden geladen', m.rules.size === 8);

  m.handle(noot(52, true)); m.handle(noot(52, false));
  ok('zonder shift: de gewone regel', gestuurd[0][0] === 'track.1.loop.toggle');
  m.handle(noot(98, true));
  ok('de shiftknop zelf gaat niet de bus op', m.shift === true && gestuurd.length === 2);
  m.handle(noot(52, true));
  ok('met shift: de shift-regel', gestuurd.at(-1)[0] === 'track.1.loop.exit');
  m.handle(noot(98, false));
  m.handle(noot(52, false));
  ok('loslaten gaat naar dezelfde action als het indrukken, ook na shift los', gestuurd.at(-1)[0] === 'track.1.loop.exit' && gestuurd.at(-1)[1] === false);
  m.handle(noot(98, true));
  m.handle(cc(7, 64));
  ok('shift vast en geen shift-regel: de fader werkt gewoon', gestuurd.at(-1)[0] === 'track.1.fader');
  m.handle(noot(98, false));

  m.handle(cc(16, 64));
  ok('device knob 1 in de strip: trim van de focus-track', gestuurd.at(-1)[0] === 'track.3.trim');
  lg.zet('device', 'rack');
  m.handle(cc(16, 64));
  ok('zelfde knop in het rack: fx-knop 1', gestuurd.at(-1)[0] === 'track.3.fx.knob.1');
  m.handle(noot(32, true));
  lg.zet('grid', 'loops');                 // mapje wisselt terwijl de pad ingedrukt is
  m.handle(noot(32, false));
  ok('pad loslaten na een mapjewissel: toch naar de hotcue', gestuurd.at(-2)[0] === 'track.1.hotcue.1' && gestuurd.at(-1)[0] === 'track.1.hotcue.1' && gestuurd.at(-1)[1] === false);
  m.handle(noot(32, true)); m.handle(noot(32, false));
  ok('daarna: de pad van het loops-mapje', gestuurd.at(-1)[0] === 'track.1.beatloop.1');
  ok('actieveRegels: per knop de regel van nu', m.actieveRegels().get('note:0:32').action === 'track.1.beatloop.1'
    && m.actieveRegels().get('cc:0:16').action === 'track.{focus}.fx.knob.1');

  // Koppelen in een mapje: de nieuwe regel komt in het open mapje.
  const regel = m.set('cc:0:16', 'track.{focus}.low', { mode: 'absolute' });
  ok('koppelen komt in het open mapje, de andere blijven', regel.laag === 'device.rack'
    && m.rules.get('cc:0:16@device.strip').action === 'track.{focus}.trim' && m.rules.get('cc:0:16@device.rack').action === 'track.{focus}.low');
  m.handle(noot(98, true));
  const sr = m.set('note:0:52', 'track.1.cue', { mode: 'trigger' });
  m.handle(noot(98, false));
  ok('koppelen met shift vast: een shift-regel', sr.shift === true && m.rules.get('note:0:52').action === 'track.1.loop.toggle');
  ok('forAction geeft sleutels, weghalen op sleutel', m.forAction('track.1.cue')[0] === 'note:0:52#shift' && m.remove('note:0:52#shift') && !m.rules.has('note:0:52#shift'));

  const terug = new Mapping({ read: () => 0, invoke: () => {}, lagen: () => lg.actief() });
  terug.load(m.toJSON());
  ok('shift en mapjes overleven exporteren en inladen', terug.shiftSig === 'note:0:98' && terug.rules.size === m.rules.size
    && terug.rules.get('note:0:32#shift@grid.hotcues').action === 'track.1.hotcue.1.delete');
}

// ---- tempo-encoder na een sync buiten het pitchbereik ----------------------
// Sync mag verder dan het bereik (±16%): dan staat de pitch-read tegen de
// aanslag. Een relatieve encoder op `pitch` rekende vanaf die GEKLEMDE stand
// en sprong bij één tik van 1,30 naar ~1,16. De encoder moet de RATE een
// klein vast stapje verzetten, wat het bereik ook is.
{
  const bus = await import('../src/control/actions.js');
  const { clamp } = await import('../src/lib/emitter.js');
  // Nepdeck met dezelfde formules als deck.js (setRate klemt 0,5–2).
  const nep = { rate: 1, pitchBereik: 0.16, buigt: 0,
    setRate(r) { this.rate = clamp(r, 0.5, 2); },
    setPitch(v) { this.setRate(1 + (clamp(v) * 2 - 1) * this.pitchBereik); },
    get pitch() { return clamp(0.5 + (this.rate - 1) / (2 * this.pitchBereik)); } };
  bus.bindEngine({ deck: () => nep, kant: {}, syncMaster: () => null });
  const tm = new Mapping({ read: bus.read, invoke: bus.invoke, vars: () => ({ focus: 1 }) });
  tm.load(doc);
  const tik = (val) => tm.handle(cc(13, val));

  nep.rate = 1.30;
  tik(1);
  ok('tempo-encoder: één tik na sync naar 1,30 blijft bij 1,30 (+0,1%)', Math.abs(nep.rate - 1.301) < 1e-6);
  tik(127);
  ok('tempo-encoder: één tik terug is weer 1,30', Math.abs(nep.rate - 1.30) < 1e-6);
  tm.handle(note(98, true));
  tik(1);
  tm.handle(note(98, false));
  ok('tempo-encoder met shift: fijner (+0,01%)', Math.abs(nep.rate - 1.3001) < 1e-6);
  nep.rate = 1;
  for (let i = 0; i < 20; i++) tik(1);
  ok('tempo-encoder: twintig tikken vanaf 1 = +2%', Math.abs(nep.rate - 1.02) < 1e-6);
  nep.rate = 1.999;
  tik(5);
  ok('tempo-encoder klemt op 2x', nep.rate === 2);
  nep.rate = 0.501;
  tik(123);
  ok('tempo-encoder klemt op 0,5x', nep.rate === 0.5);
}

// ---- controller losgekoppeld -------------------------------------------------
// Trek je de APC eruit terwijl je shift of een bend vasthoudt, dan komt het
// loslaten nooit. Zonder opruimen bleef shift aan (elke knop deed daarna de
// shift-variant) en bleef de track trager lopen.
{
  const lm = maak();
  lm.load({ name: 't', shift: 'note:0:98', rules: [
    { in: 'note:0:100', action: 'track.1.bend.back' },
    { in: 'note:0:52', action: 'track.1.loop.toggle' },
    { in: 'note:0:52', action: 'track.1.loop.exit', shift: true },
  ] });
  lm.handle(note(98, true));
  lm.handle(note(100, true));
  geraakt.length = 0;
  let shiftEv = null;
  lm.on('shift', (a) => { shiftEv = a; });
  lm.losgekoppeld();
  ok('losgekoppeld: shift staat uit (en dat wordt gemeld)', lm.shift === false && shiftEv === false);
  ok('losgekoppeld: niets meer vastgehouden', lm.vast.size === 0);
  ok('losgekoppeld: een vastgehouden knop wordt losgelaten', geraakt.some(([id, v]) => id === 'track.1.bend.back' && v === false));
  geraakt.length = 0;
  lm.handle(note(52, true));
  ok('na opnieuw aansluiten doet een knop weer het gewone', geraakt[0]?.[0] === 'track.1.loop.toggle');
}

// ---- toetsenbord: modifiers en hangende toetsen -------------------------------
// Cmd+Q, Cmd+W, Ctrl+Tab… bedienden de decks (Cmd+W = cue op links). En onder
// Cmd of Cmd+Tab komt er geen keyup: de toets bleef in `held` hangen, zodat
// hij daarna niets meer deed (geen auto-repeat) en nooit losgelaten werd.
{
  const bus = await import('../src/control/actions.js');
  const { attachKeyboard } = await import('../src/control/keyboard.js');
  const log = [];
  for (const id of ['track.1.play', 'track.1.cue', 'track.1.hotcue.1', 'track.1.hotcue.1.delete']) {
    bus.define(id, 'trigger', (on) => log.push(`${id}=${on}`));
  }
  const win = {}, doc = { visibilityState: 'visible' };
  const oudW = globalThis.window, oudD = globalThis.document;
  globalThis.window = { addEventListener: (t, f) => { win[t] = f; } };
  globalThis.document = { addEventListener: (t, f) => { doc[t] = f; }, get visibilityState() { return doc.visibilityState; } };
  attachKeyboard({ focus: 'A', xfader: 0.5 }, { venster: (v) => (v === 'L' ? 'A' : 'B') });
  globalThis.window = oudW; globalThis.document = oudD;
  const toets = (code, type = 'keydown', mods = {}) => (win[type] || (() => {}))({
    code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods,
    target: { matches: () => false }, preventDefault() {} });

  toets('KeyW', 'keydown', { metaKey: true });
  toets('KeyQ', 'keydown', { ctrlKey: true });
  toets('KeyA', 'keydown', { altKey: true });
  ok('toetsenbord: Cmd/Ctrl/Alt + toets bedient geen deck', log.length === 0);
  toets('KeyW', 'keyup', { metaKey: true });

  toets('KeyA', 'keydown', { shiftKey: true });
  toets('KeyA', 'keyup');
  ok('toetsenbord: shift blijft de wis-variant, loslaten naar dezelfde action',
    log.join() === 'track.1.hotcue.1.delete=true,track.1.hotcue.1.delete=false');

  log.length = 0;
  toets('KeyQ');
  ok('toetsenbord: blur-luisteraar bestaat', typeof win.blur === 'function');
  win.blur?.();
  ok('toetsenbord: blur laat een ingedrukte toets los', log.join() === 'track.1.play=true,track.1.play=false');
  toets('KeyQ');
  ok('toetsenbord: na blur werkt dezelfde toets weer', log.at(-1) === 'track.1.play=true');

  log.length = 0;
  doc.visibilityState = 'hidden';
  doc.visibilitychange?.();
  ok('toetsenbord: tabblad verborgen laat los', log.join() === 'track.1.play=false');
  toets('KeyQ', 'keyup');
  ok('toetsenbord: een late keyup stuurt niets dubbel', log.length === 1);
}

// ---- endless: de 16 knoppen met LED-ring (ronde 2) -------------------------
// De ring toont al de softwarewaarde. Na een focus- of mapjewissel moet
// doordraaien dus meteen werken, vanaf wat de ring laat zien: nieuwe waarde =
// software + verschil met het vorige bericht van deze knop.
console.log('\nendless');
{
  const mE = maak('A');
  mE.load({ rules: [{ in: 'cc:0:16', action: 'track.{focus}.trim', mode: 'endless' }] });
  stand['track.1.trim'] = 0.5; stand['track.2.trim'] = 0.2;
  geraakt.length = 0;
  const r0 = mE.handle(cc(16, 100));
  ok('endless: eerste bericht wordt alleen onthouden', r0.taken === false && geraakt.length === 0 && stand['track.1.trim'] === 0.5);
  mE.handle(cc(16, 103));
  ok('endless: daarna software + verschil (+3)', Math.abs(stand['track.1.trim'] - (0.5 + 3 / 127)) < 1e-9);
  mE.handle(cc(16, 90));
  ok('endless: en terug (-13)', Math.abs(stand['track.1.trim'] - (0.5 - 10 / 127)) < 1e-9);
  ok('endless: telt nooit als "los" bij soft-takeover', !mE.takeoverStatus().includes('cc:0:16'));

  mE._focus = 'B';                          // focuswissel: de knop staat fysiek op 90
  mE.handle(cc(16, 91));
  ok('endless: na een focuswissel springt de nieuwe track niet', stand['track.2.trim'] === 0.2);
  mE.handle(cc(16, 93));
  ok('endless: en draait meteen door vanaf de ring (0,2 + 2)', Math.abs(stand['track.2.trim'] - (0.2 + 2 / 127)) < 1e-9);

  stand['track.2.trim'] = 0.7;              // de muis verzet de waarde
  mE.handle(cc(16, 94));
  ok('endless: na een verzetting door iets anders eerst opnieuw onthouden', stand['track.2.trim'] === 0.7);
  mE.handle(cc(16, 95));
  ok('endless: en dan verder vanaf de nieuwe stand', Math.abs(stand['track.2.trim'] - (0.7 + 1 / 127)) < 1e-9);

  stand['track.2.trim'] = 0.99;
  mE.handle(cc(16, 60)); mE.handle(cc(16, 80));
  ok('endless: klemt op 1', stand['track.2.trim'] === 1);
  mE.handle(cc(16, 70));
  ok('endless: na klemmen direct weer omlaag (geen dode zone)', Math.abs(stand['track.2.trim'] - (1 - 10 / 127)) < 1e-9);

  // Op de aanslag: stuurt de knop nog eens 127 terwijl hij al op 127 stond,
  // dan is dat doordraaien, geen stilstand.
  stand['track.2.trim'] = 0.3;
  mE.handle(cc(16, 126)); mE.handle(cc(16, 127));
  const voorAanslag = stand['track.2.trim'];
  mE.handle(cc(16, 127));
  ok('endless: op de aanslag telt nog een 127 als een stap', Math.abs(stand['track.2.trim'] - (voorAanslag + 1 / 127)) < 1e-9);

  ok('endless is een geldige modus en overleeft export', (() => {
    const t = maak(); t.load(mE.toJSON()); return t.rules.get('cc:0:16').mode === 'endless';
  })());

  const st = new Mapping({ read: () => 0.5, invoke: () => {} });
  st.load(doc);
  const ringknoppen = [...st.rules.values()].filter((r) => /^cc:0:(1[6-9]|2[0-3]|4[89]|5[0-5])$/.test(r.in));
  ok(`standaard: de 16 ringknoppen staan op endless (${ringknoppen.length} regels)`,
    ringknoppen.length >= 16 && ringknoppen.every((r) => r.mode === 'endless'));
  const faders = [...st.rules.values()].filter((r) => /^cc:\d:7$|^cc:0:1[45]$/.test(r.in));
  ok('standaard: faders blijven absolute (soft-takeover)', faders.length === 10 && faders.every((r) => r.mode === 'absolute'));

  // Het 2×2-blok: A|B = crossfaderkant, ● = de koptelefoon (5 okt, docs/STUDIO.md §3),
  // ● + shift = cue (alleen met shift: per ongeluk cue zette een hoorbare track stil).
  ok('2×2: A|B = crossfaderkant, ● zonder shift = koptelefoon, ● + shift = cue (alle 8 kolommen)',
    [0, 1, 2, 3, 4, 5, 6, 7].every((ch) => st.kies(`note:${ch}:66`, { shift: false })?.action === `track.${ch + 1}.xfade.side`
      && st.kies(`note:${ch}:48`, { shift: false })?.action === `track.${ch + 1}.pfl` && st.kies(`note:${ch}:48`, { shift: true })?.action === `track.${ch + 1}.cue`));
  ok('actieveRegels volgt shift', st.actieveRegels({ shift: true }).get('note:0:48')?.action === 'track.1.cue'
    && st.actieveRegels({ shift: false }).get('note:0:48')?.action === 'track.1.pfl');
  // Cue Level = de koptelefoon (Clay, 5 okt): volume, shift = mix; in de grid-modus sampler en
  // video met shift het sampler-volume en de puls (die stonden eerder op Cue Level zelf).
  const cl = (shift, laag) => { const m = new Mapping({ read: () => 0.5, invoke: () => {}, lagen: () => (laag ? [laag] : []) }); m.load(doc); return m.kies('cc:0:47', { shift })?.action; };
  ok('Cue Level = koptelefoonvolume, shift = koptelefoonmix; met shift in modus sampler/video het sampler-volume en de puls',
    cl(false) === 'headphone.level' && cl(true) === 'headphone.mix' && cl(false, 'grid.sampler') === 'headphone.level'
    && cl(true, 'grid.sampler') === 'sampler.volume' && cl(true, 'grid.video') === 'video.pulse' && cl(true, 'grid.klank') === 'headphone.mix');
}

// ---- grid-modus (stap D) ------------------------------------------------------
console.log('\ngrid-modus');
{
  const { Lagen } = await import('../src/control/lagen.js');
  let t = 0;
  const lg = new Lagen({ now: () => t });
  lg.druk('edit', 'toggle', true); t += 1000; lg.druk('edit', 'toggle', false);
  ok('grid-modus is een schakelaar: lang vasthouden = gewoon aan (geen gluren)', lg.stand.edit === 'aan');
  lg.druk('edit', 'toggle', true); lg.druk('edit', 'toggle', false);
  ok('nog eens drukken = uit', lg.stand.edit === 'uit');

  const gm = new Mapping({ read: () => 0.5, invoke: () => {}, lagen: () => lg.actief() });
  gm.load(doc);
  const actie = (sig, shift = false) => gm.kies(sig, { shift })?.action ?? null;
  ok('Metronome zonder shift = crossfadercurve, met shift = grid-modus', actie('note:0:90') === 'mixer.xfader.curve' && actie('note:0:90', true) === 'layer.edit.toggle');
  lg.zet('edit', 'aan');
  const verwacht = {
    'note:0:82': 'grid.here', 'note:0:83': 'grid.double', 'note:0:84': 'grid.halve', 'note:0:85': 'grid.halfbeat',
    'note:0:86': 'grid.split', 'note:0:100': 'grid.back', 'note:0:101': 'grid.fwd', 'cc:0:47': 'grid.bpm', 'note:0:63': 'grid.lock',
  };
  const mis = Object.entries(verwacht).filter(([sig, a]) => actie(sig) !== `track.{focus}.${a}`);
  ok(`grid-modus: scene 1–5, nudge, cue level en Lock bewerken het grid${mis.length ? ' — mis: ' + mis.map((x) => x[0]).join() : ''}`, mis.length === 0);
  ok('grid-modus + shift: nudge ±1 ms, cue level ±0,1, Metronome zet hem uit',
    actie('note:0:100', true) === 'track.{focus}.grid.back.fine' && actie('note:0:101', true) === 'track.{focus}.grid.fwd.fine'
    && actie('cc:0:47', true) === 'track.{focus}.grid.bpm' && actie('note:0:90', true) === 'layer.edit.toggle');
  const stap = (sh) => gm.kies('cc:0:47', { shift: sh }).step * 260;
  ok('cue level: 0,01 bpm per tik, met shift 0,1', Math.abs(stap(false) - 0.01) < 1e-12 && Math.abs(stap(true) - 0.1) < 1e-12);
  ok('grid-modus: Tap blijft tap, Metronome zonder shift blijft de curve',
    actie('note:0:99') === 'track.{focus}.tap' && actie('note:0:90') === 'mixer.xfader.curve');
  ok('grid-modus: wat hij niet definieert werkt gewoon (fader, play, filter, hotcue-pad)',
    actie('cc:0:7') === 'track.1.fader' && actie('note:0:91') === 'track.{focus}.play'
    && actie('cc:0:48') === 'track.1.filter' && actie('note:0:32') === 'track.1.hotcue.1');
  ok('grid-modus wint van een grid-mapje op dezelfde knop (edit staat vooraan)', lg.actief()[0] === 'edit.aan');

  // Buiten de grid-modus: precies wat de mapping zonder grid-modus zou doen.
  lg.zet('edit', 'uit');
  const zonder = new Mapping({ read: () => 0.5, invoke: () => {}, lagen: () => lg.actief() });
  zonder.load({ ...doc, rules: doc.rules.filter((r) => r.laag !== 'edit.aan' && r.action !== 'layer.edit.toggle') });
  const sigs = [...new Set(doc.rules.map((r) => r.in))];
  const anders = sigs.filter((sig) => [false, true].some((sh) => gm.kies(sig, { shift: sh }) !== null
    && gm.kies(sig, { shift: sh })?.action !== zonder.kies(sig, { shift: sh })?.action && !(sh && sig === 'note:0:90')));
  ok(`buiten grid-modus doet elke knop wat hij deed (behalve Shift + Metronome)${anders.length ? ' — anders: ' + anders.join() : ''}`, anders.length === 0);
}

// ---- modus klank en de knoppen rechts (Clay 25 sep, "Voorstel A") -----------
console.log('\nmodus klank en de nieuwe knoppen rechts');
{
  const { Lagen, GROEPEN, GLUREN: GLUREN_MS } = await import('../src/control/lagen.js');
  let t = 0;
  const lg = new Lagen({ now: () => t });
  const km = new Mapping({ read: () => 0.5, invoke: () => {}, lagen: () => lg.actief() });
  km.load(doc);
  const actie = (sig, shift = false) => km.kies(sig, { shift })?.action ?? null;

  ok('klank is de vijfde grid-modus, na video (auto erachter, 2 okt; stems daarachter, 5 okt)',
    GROEPEN.grid.volgorde.join() === 'hotcues,loops,sampler,video,klank,auto,stems' && GROEPEN.grid.knoppen.klank?.join() === 'klank');
  lg.zet('grid', 'video'); lg.stap('grid', 1);
  ok('▼ vanuit video = klank', lg.stand.grid === 'klank');
  lg.stap('grid', 1);
  ok('▼ vanuit klank = auto', lg.stand.grid === 'auto');
  lg.stap('grid', 1);
  ok('▼ vanuit auto = stems', lg.stand.grid === 'stems');
  lg.stap('grid', 1);
  ok('▼ vanuit stems = weer hotcues (rondlopen)', lg.stand.grid === 'hotcues');
  lg.stap('grid', -3);
  ok('▲ ▲ ▲ vanuit hotcues = klank', lg.stand.grid === 'klank');
  lg.zet('grid', 'hotcues');

  // Direct: Shift + scene 5. Scene 5 zelf blijft "loop weg" (één druk, geen shift).
  ok('scene 5 zonder shift = loop weg, met shift = modus klank',
    actie('note:0:86') === 'track.{focus}.loop.exit' && actie('note:0:86', true) === 'layer.grid.klank');
  // Door de mapping met de echte Lagen, zoals de APC het stuurt: shift vast, scene 5 kort.
  const viaBus = new Mapping({ read: () => 0, invoke: (a, on) => { const x = /^layer\.grid\.(\w+)$/.exec(a); if (x) lg.druk('grid', x[1], on); },
    lagen: () => lg.actief() });
  viaBus.load(doc);
  viaBus.handle(note(98, true)); viaBus.handle(note(86, true)); t += 100; viaBus.handle(note(98, false)); viaBus.handle(note(86, false));
  ok('Shift + scene 5 kort: klank staat vast open (shift eerder los maakt niet uit)', lg.stand.grid === 'klank');
  viaBus.handle(note(82, true)); t += 100; viaBus.handle(note(82, false));
  ok('scene 1: terug naar hotcues', lg.stand.grid === 'hotcues');
  viaBus.handle(note(98, true)); viaBus.handle(note(86, true)); t += GLUREN_MS + 10; viaBus.handle(note(86, false)); viaBus.handle(note(98, false));
  ok('Shift + scene 5 vasthouden = even gluren: loslaten is terug naar hotcues', lg.stand.grid === 'hotcues');

  // De pads: per kolom (= track) van boven naar onder, met en zonder shift.
  lg.zet('grid', 'klank');
  const RIJEN = [['kill.high.hold', 'kill.high'], ['kill.mid.hold', 'kill.mid'], ['kill.low.hold', 'kill.low'], ['brake', 'brake'], ['play.quant', 'play.quant']];
  const mis = [];
  for (let kol = 1; kol <= 8; kol++) {
    for (let rij = 1; rij <= 5; rij++) {
      const sig = `note:0:${apc.gridNote(kol, rij)}`;
      const [gewoon, metShift] = RIJEN[rij - 1];
      if (actie(sig) !== `track.${kol}.${gewoon}`) mis.push(`${kol}/${rij}`);
      if (actie(sig, true) !== `track.${kol}.${metShift}`) mis.push(`${kol}/${rij}+shift`);
    }
  }
  ok(`klank: elke pad (rij, kolom) doet de juiste action op de juiste track, met en zonder shift${mis.length ? ' — mis: ' + mis.join() : ''}`, mis.length === 0);
  ok('klank: linksboven (noot 0x20) = kill hoog van track 1, rechtsonder (0x07) = op de maat van track 8',
    actie('note:0:32') === 'track.1.kill.high.hold' && actie('note:0:7') === 'track.8.play.quant');
  ok('klank: scene 5 blijft loop weg, zijn lampje toont "klank open"',
    actie('note:0:86') === 'track.{focus}.loop.exit' && km.kies('note:0:86').led?.lees === 'layer.grid.klank');
  ok('klank: wat de modus niet definieert werkt gewoon (fader, play, filter, Clip Stop)',
    actie('cc:0:7') === 'track.1.fader' && actie('note:0:50') === 'track.1.play' && actie('cc:0:48') === 'track.1.filter'
    && actie('note:0:52') === 'track.1.loop.toggle');

  // Een kill-pad is een drukknop: indrukken = weg, loslaten = terug, ook als
  // shift er tussendoor komt. Shift + pad = de schakelaar (vastzetten).
  const gestuurd = [];
  const kb = new Mapping({ read: () => 0, invoke: (a, v) => gestuurd.push(`${a}=${v}`), vars: () => ({ focus: 2 }), lagen: () => lg.actief() });
  kb.load(doc);
  kb.handle(note(apc.gridNote(3, 1), true)); kb.handle(note(98, true)); kb.handle(note(apc.gridNote(3, 1), false)); kb.handle(note(98, false));
  ok('kill-pad: indrukken en loslaten naar de drukknop, ook met shift ertussen',
    gestuurd.join() === 'track.3.kill.high.hold=true,track.3.kill.high.hold=false');
  gestuurd.length = 0;
  kb.handle(note(98, true)); kb.handle(note(apc.gridNote(3, 3), true)); kb.handle(note(98, false)); kb.handle(note(apc.gridNote(3, 3), false));
  ok('shift + kill-pad = de schakelaar, en loslaten gaat daar ook heen (shift eerder los)',
    gestuurd.join() === 'track.3.kill.low=true,track.3.kill.low=false');
  gestuurd.length = 0;
  kb.handle(note(apc.gridNote(5, 4), true)); kb.handle(note(apc.gridNote(5, 4), false));
  kb.handle(note(apc.gridNote(6, 5), true)); kb.handle(note(apc.gridNote(6, 5), false));
  ok('rij 4 = rem, rij 5 = op de maat, op de track van de kolom (niet de focus)',
    gestuurd.join() === 'track.5.brake=true,track.5.brake=false,track.6.play.quant=true,track.6.play.quant=false');
  lg.zet('grid', 'hotcues');

  // Rechts: de track met focus ({focus}), zoals de rest van het focusdeel.
  const verwacht = {
    'note:0:60': 'track.{focus}.beatjump.back', 'note:0:61': 'track.{focus}.beatjump.fwd',
    'note:0:87': 'track.{focus}.loop.in', 'note:0:88': 'track.{focus}.loop.out', 'note:0:89': 'track.{focus}.loop.reloop',
    'note:0:63': 'transport.quantize', 'note:0:81': 'track.{focus}.brake',
  };
  const misR = Object.entries(verwacht).filter(([sig, a]) => actie(sig) !== a);
  ok(`rechts: Bank ◀ ▶ beatjump, Pan/Sends/User loop in/out/reloop, Lock quantize, Stop All rem${misR.length ? ' — mis: ' + misR.map((x) => x[0]).join() : ''}`, misR.length === 0);
  ok('shift + Bank ◀ ▶ = beatjump-lengte ½ / ×2',
    actie('note:0:60', true) === 'track.{focus}.beatjump.halve' && actie('note:0:61', true) === 'track.{focus}.beatjump.double');
  ok('2×2: shift + nummer = op de maat starten, zonder shift play (alle 8 kolommen)',
    [0, 1, 2, 3, 4, 5, 6, 7].every((ch) => actie(`note:${ch}:50`, true) === `track.${ch + 1}.play.quant` && actie(`note:${ch}:50`) === `track.${ch + 1}.play`));
  ok('Bank blijft vrij, ook met shift (keylock, VRAGEN I4)', actie('note:0:103') === null && actie('note:0:103', true) === null);
  const opF = new Mapping({ read: () => 0, invoke: (a) => gestuurd.push(a), vars: () => ({ focus: 4 }), lagen: () => lg.actief() });
  opF.load(doc);
  gestuurd.length = 0;
  for (const n of [61, 88, 81]) { opF.handle(note(n, true)); opF.handle(note(n, false)); }
  ok('rechts gaat naar de focus-track (focus 4)',
    gestuurd.join() === 'track.4.beatjump.fwd,track.4.beatjump.fwd,track.4.loop.out,track.4.loop.out,track.4.brake,track.4.brake');

  // Lock: quantize, behalve in de grid-modus (edit): daar blijft het het slot.
  lg.zet('edit', 'aan');
  ok('Lock in de grid-modus blijft het grid-slot (het open mapje wint), ook met shift',
    actie('note:0:63') === 'track.{focus}.grid.lock' && actie('note:0:63', true) === 'track.{focus}.grid.lock');
  ok('in de grid-modus doen Bank ◀ ▶ en Stop All gewoon hun werk', actie('note:0:60') === 'track.{focus}.beatjump.back' && actie('note:0:81') === 'track.{focus}.brake');
  lg.zet('edit', 'uit');
  ok('grid-modus uit: Lock is weer quantize', actie('note:0:63') === 'transport.quantize');

  // Met ?vormen=1 en het mapje vorm open wint het fragment op Bank ◀ ▶.
  km.voegToe('vormen', fragment);
  lg.zet('device', 'vorm');
  ok('mapje vorm (fragment): Bank ◀ ▶ kiest de vormlaag, niet beatjump',
    actie('note:0:60') === 'video.layer.select.prev' && actie('note:0:61') === 'video.layer.select.next');
  // Bewust: een shift-regel gaat voor het open mapje (mapping.kies), dus
  // shift + Bank ◀ ▶ blijft ook in het mapje vorm de beatjump-lengte.
  ok('mapje vorm: shift + Bank ◀ ▶ = beatjump-lengte (shift-regel gaat voor het mapje)',
    actie('note:0:60', true) === 'track.{focus}.beatjump.halve' && actie('note:0:61', true) === 'track.{focus}.beatjump.double');
  ok('mapje vorm: Detail View blijft het fragment (mapje vorm kiezen), de standaard heeft er geen regel',
    actie('note:0:65') === 'layer.device.detail');
  lg.zet('device', 'strip');
  ok('mapje vorm dicht: Bank ◀ ▶ weer beatjump', actie('note:0:60') === 'track.{focus}.beatjump.back');
}

// ---- LED-instellingen in een regel overleven laden en exporteren -------------
{
  const t = maak();
  t.load({ version: 3, rules: [{ in: 'note:0:62', action: 'track.1.fx.bypass', mode: 'trigger', led: { invert: true } }] });
  const t2 = maak(); t2.load(t.toJSON());
  ok('regel.led blijft bewaard bij laden en exporteren', t2.rules.get('note:0:62').led?.invert === true);
}

// ---- apc.html: elke knop een uitleg ---------------------------------------
{
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const kaal = doc.rules.filter((r) => { const b = beschrijf(r.action); return b.lang === r.action || b.lang.startsWith('?') || !b.kort; }).map((r) => r.action);
  if (kaal.length) console.log('   zonder uitleg:', [...new Set(kaal)]);
  ok('APC-kaarten: elke action in de standaardmapping heeft een uitleg in gewone taal', kaal.length === 0);
}

console.log('fragmenten: regels die erbij komen maar niet van jou worden');
{
  const gedaan = [];
  const m = new Mapping({ invoke: (a, v) => gedaan.push([a, v]), read: () => 0, lagen: () => ['device.vorm'] });
  m.load({ name: 'eigen', version: 3, rules: [{ in: 'note:0:10', action: 'eigen.knop', mode: 'trigger' }, { in: 'note:0:60', action: 'mijn.bank', mode: 'trigger', laag: 'device.vorm' }] });
  const r = m.voegToe('vormen', { version: 3, rules: [
    { in: 'note:0:65', action: 'layer.device.detail', mode: 'trigger' },
    { in: 'note:0:60', action: 'video.layer.select.prev', mode: 'trigger', laag: 'device.vorm' },
  ] });
  ok('een fragment vult aan', r.aantal === 1 && m.kies('note:0:65')?.action === 'layer.device.detail');
  ok('een eigen regel op dezelfde plek wint', m.kies('note:0:60')?.action === 'mijn.bank');
  ok('het fragment gaat NIET mee in je bewaarde mapping', m.toJSON().rules.every((x) => x.action !== 'layer.device.detail') && m.toJSON().rules.length === 2);
  m.load({ name: 'andere', version: 3, rules: [{ in: 'note:0:11', action: 'x', mode: 'trigger' }] });
  ok('en blijft staan als er een andere mapping geladen wordt', m.kies('note:0:65')?.action === 'layer.device.detail' && m.kies('note:0:60')?.action === 'video.layer.select.prev');
  ok('een fragmentregel weghalen kan niet: hij staat er meteen weer', m.remove('note:0:65') === false && m.kies('note:0:65')?.action === 'layer.device.detail');
  m.set('note:0:60', 'eigen.dekt', { mode: 'trigger', laag: 'device.vorm' });
  m.remove('note:0:60@device.vorm');
  ok('een eigen regel weghalen die een fragmentregel afdekte: die staat er meteen weer', m.kies('note:0:60')?.action === 'video.layer.select.prev');
  m.set('note:0:65', 'zelf.gekoppeld', { mode: 'trigger' });
  ok('koppel je er zelf iets overheen, dan is het de jouwe en gaat hij wel mee', m.toJSON().rules.some((x) => x.in === 'note:0:65' && x.action === 'zelf.gekoppeld'));
}

// ---- eigen mapping als VERSCHIL met de standaard (ROADMAP 13) ----------------
// Clay's echte kopie (GET /api/mapping, 24 sep): de standaard met rack-knoppen
// 5-8 op video-effecten, gekoppeld met "leren" (dus absolute), in een andere
// volgorde dan het bestand. Precies die vorm bouwen we hier na.

console.log('\neigen mapping als verschil');
const {
  maakVerschil, pasVerschilToe, vingerafdruk, isVerschil, normaliseer, MAPPING_VERSIE,
} = await import('../src/control/mapping.js');
const VIDEO_KNOPPEN = { 'cc:0:20': 'video.fx.pixel', 'cc:0:21': 'video.fx.rgb', 'cc:0:22': 'video.fx.trails', 'cc:0:23': 'video.fx.grain' };
const kopieVanClay = () => {
  const d = JSON.parse(JSON.stringify(doc));
  for (const r of d.rules) {
    if (r.laag === 'device.rack' && VIDEO_KNOPPEN[r.in]) { r.action = VIDEO_KNOPPEN[r.in]; r.mode = 'absolute'; }
  }
  d.rules.reverse();                         // volgorde betekent niets
  return d;
};
const alsSet = (d) => new Map(normaliseer(d).doc.rules.map((r) => [sleutelVan(r), JSON.stringify(r)]));
const zelfde = (a, b) => { const x = alsSet(a), y = alsSet(b); return x.size === y.size && [...x].every(([k, t]) => y.get(k) === t); };
const kaal = () => new Mapping({ read: () => null, invoke: () => {} });
{
  const kopie = kopieVanClay();
  const v = maakVerschil(doc, kopie);
  ok('oude kopie -> verschil: alleen de vier eigen regels, niets weggehaald', isVerschil(v)
    && v.rules.length === 4 && v.removed.length === 0 && Object.keys(v.top).length === 0
    && v.rules.every((r) => r.laag === 'device.rack' && r.action === VIDEO_KNOPPEN[r.in] && r.mode === 'absolute'));
  ok('het verschil draagt de vingerafdruk van de standaard en een lijst "rules" (de server eist die)',
    v.base === vingerafdruk(doc) && Array.isArray(v.rules) && v.device === 'apc40mk2' && v.version === MAPPING_VERSIE);
  ok('standaard + verschil = precies de oude kopie', zelfde(pasVerschilToe(doc, v).doc, kopie));
  ok('het verschil is klein (de kopie is ~30 kB)', JSON.stringify(v).length < 1000);

  // In een Mapping: standaard zetten, verschil erop, en terugrekenen.
  const mv = kaal();
  mv.laadStandaard(doc);
  ok('alleen de standaard: leeg verschil', (() => { const w = mv.verschil(); return w.rules.length === 0 && w.removed.length === 0; })());
  const u = mv.load(v);
  ok('verschil laden in een Mapping', u.verschil && u.eigen === 4 && u.weg === 0 && !u.standaardNieuw && u.fouten.length === 0);
  ok('en wat hij dan uitrekent is weer hetzelfde verschil', JSON.stringify(mv.verschil()) === JSON.stringify(v));
  ok('eigen regel doet wat Clay koppelde', mv.rules.get('cc:0:20@device.rack').action === 'video.fx.pixel');

  // De vingerafdruk: volgorde en naam tellen niet, inhoud wel.
  const omgedraaid = { ...doc, name: 'anders genoemd', rules: [...doc.rules].reverse() };
  ok('vingerafdruk: volgorde en naam tellen niet', vingerafdruk(omgedraaid) === vingerafdruk(doc));
  ok('vingerafdruk: een andere regel wel', vingerafdruk(kopie) !== vingerafdruk(doc));

  // Een NIEUWE standaard: een regel erbij, een regel die Clay niet aanraakte
  // anders, en de standaard verandert óók een knop die Clay zelf koppelde.
  const nieuw = JSON.parse(JSON.stringify(doc));
  nieuw.rules.push({ in: 'note:0:65', action: 'layer.device.detail', mode: 'trigger', label: 'nieuw in de standaard' });
  const filterRegel = nieuw.rules.find((r) => r.in === 'cc:0:48' && !r.shift && !r.laag);
  filterRegel.action = 'track.1.trim';
  nieuw.rules.find((r) => r.in === 'cc:0:21' && r.laag === 'device.rack').action = 'track.{focus}.fx.knob.6.hold';
  const mn = kaal();
  mn.laadStandaard(nieuw);
  const un = mn.load(v);
  ok('nieuwe standaardregel komt binnen', mn.rules.get('note:0:65')?.action === 'layer.device.detail');
  ok('een standaardregel die Clay niet aanraakte volgt de nieuwe standaard', mn.rules.get('cc:0:48').action === 'track.1.trim');
  ok('een eigen regel wint, ook als de standaard hem later verandert', mn.rules.get('cc:0:21@device.rack').action === 'video.fx.rgb');
  ok('en het laden meldt dat de standaard veranderd is', un.standaardNieuw === true && un.eigen === 4);
  ok('opnieuw uitgerekend: nog steeds alleen de vier eigen regels, nu tegen de nieuwe standaard',
    (() => { const w = mn.verschil(); return w.rules.length === 4 && w.base === vingerafdruk(nieuw) && w.base !== v.base; })());

  // Weghalen: een markering, en die blijft staan als de standaard verandert.
  const mw = kaal();
  mw.laadStandaard(doc);
  mw.load(v);
  ok('een standaardregel weghalen', mw.remove('note:0:52#shift') === true);
  const vw = mw.verschil();
  ok('weghalen wordt een markering in het verschil', vw.removed.length === 1 && vw.removed[0] === 'note:0:52#shift' && vw.rules.length === 4);
  const nieuw2 = JSON.parse(JSON.stringify(nieuw));
  nieuw2.rules.find((r) => r.in === 'note:0:52' && r.shift && !r.laag).action = 'track.1.loop.exit.nieuw';
  const mw2 = kaal();
  mw2.laadStandaard(nieuw2);
  const uw = mw2.load(vw);
  ok('weggehaalde regel blijft weg, ook als de nieuwe standaard hem verandert',
    !mw2.rules.has('note:0:52#shift') && uw.weg === 1 && mw2.rules.has('note:0:52'));

  // Terugkoppelen naar wat de standaard doet: dan is het niet meer van jou.
  const std20 = doc.rules.find((r) => r.in === 'cc:0:20' && r.laag === 'device.rack');
  mw.set('cc:0:20', std20.action, { mode: std20.mode, label: std20.label, laag: 'device.rack' });
  ok('een regel terug naar de standaard verdwijnt uit het verschil', !mw.verschil().rules.some((r) => r.in === 'cc:0:20'));

  // Topvelden: de shiftknop.
  const ms = kaal();
  ms.laadStandaard(doc);
  ms.load({ ...doc, shift: 'note:0:99' });
  const vs = ms.verschil();
  ok('een andere shiftknop is een topveld in het verschil', vs.top.shift === 'note:0:99' && vs.rules.length === 0 && !('name' in vs.top));
  const ms2 = kaal(); ms2.laadStandaard(doc); ms2.load(vs);
  ok('en komt terug bij laden', ms2.shiftSig === 'note:0:99');
  const zonder = { ...doc }; delete zonder.shift;
  ms.load(zonder);
  ok('geen shiftknop meer = shift: null', ms.verschil().top.shift === null);
  ms2.load(ms.verschil());
  ok('en geen shiftknop na laden', ms2.shiftSig === null);

  // Weigeren wat niet klopt, in plaats van vier regels als hele mapping te laden.
  let fout = null;
  try { kaal().load(v); } catch (e) { fout = e.message; }
  ok('een verschil zonder standaard wordt geweigerd', /standaard/.test(fout || ''));
  fout = null;
  try { const g = kaal(); g.laadStandaard({ device: 'generic', rules: [] }); g.load(v); } catch (e) { fout = e.message; }
  ok('een verschil voor een ander apparaat wordt geweigerd', /apc40mk2/.test(fout || ''));
  ok('verschil() zonder passende standaard: null (eerst die standaard erbij)',
    kaal().verschil() === null && (() => { const g = kaal(); g.laadStandaard(doc); g.load({ device: 'generic', rules: [] }); return g.verschil() === null; })());

  // Een verschil met oude action-namen wordt net zo gemigreerd als een heel bestand.
  const oudV = { kind: 'diff', version: 2, device: 'apc40mk2', rules: [{ in: 'cc:0:20', action: 'track.{focus}.fx.knop.5.druk', mode: 'trigger', laag: 'device.rack' }] };
  const mo = kaal(); mo.laadStandaard(doc);
  const uo = mo.load(oudV);
  ok('migreerAction werkt ook in een verschil', mo.rules.get('cc:0:20@device.rack').action === 'track.{focus}.fx.knob.5.hold' && uo.gemigreerd === 1);
}

console.log('fragment blijft buiten het verschil');
{
  const fragment = JSON.parse(readFileSync(new URL('../mappings/apc40mk2-vormen.json', import.meta.url), 'utf8'));
  const mf = new Mapping({ read: () => null, invoke: () => {}, lagen: () => ['device.vorm'] });
  mf.laadStandaard(doc);
  mf.load(maakVerschil(doc, kopieVanClay()));
  const voor = JSON.stringify(mf.verschil());
  const r = mf.voegToe('vormen', fragment);
  ok('het fragment is er', r.aantal > 0 && mf.kies('cc:0:16')?.bron === 'vormen');
  ok('en het verschil is precies hetzelfde gebleven', JSON.stringify(mf.verschil()) === voor);
  mf.set('cc:0:16', 'zelf.over.vorm', { mode: 'endless', laag: 'device.vorm' });
  ok('koppel je zelf over een fragmentregel, dan komt die WEL in je verschil',
    mf.verschil().rules.some((x) => x.in === 'cc:0:16' && x.laag === 'device.vorm' && x.action === 'zelf.over.vorm'));

  // Een fragment op de plek van een standaardregel die je weghaalde: de
  // markering blijft, het fragment vult aan zolang het aan staat.
  const basis = { device: 'x', rules: [{ in: 'note:0:10', action: 'standaard.knop', mode: 'trigger' }] };
  const mx = new Mapping({ read: () => null, invoke: () => {} });
  mx.laadStandaard(basis);
  mx.voegToe('frag', { rules: [{ in: 'note:0:10', action: 'fragment.knop', mode: 'trigger' }] });
  ok('de standaard gaat voor een fragment', mx.kies('note:0:10').action === 'standaard.knop');
  mx.remove('note:0:10');
  ok('weghalen: het fragment vult het gat', mx.kies('note:0:10').action === 'fragment.knop');
  const vx = mx.verschil();
  ok('en in het verschil staat alleen de markering, niet de fragmentregel', vx.removed[0] === 'note:0:10' && vx.rules.length === 0);
  const zonderFrag = new Mapping({ read: () => null, invoke: () => {} });
  zonderFrag.laadStandaard(basis);
  zonderFrag.load(vx);
  ok('zonder fragment is de knop na laden echt leeg', zonderFrag.kies('note:0:10') === null);
}

console.log('generic: een mapping voor een ander apparaat');
{
  const gen = JSON.parse(readFileSync(new URL('../mappings/generic.json', import.meta.url), 'utf8'));
  const mg = kaal();
  mg.laadStandaard(gen);
  mg.set('cc:3:7', 'track.1.fader', { mode: 'absolute', label: 'fader' });
  mg.set('note:3:1', 'track.1.play', { mode: 'trigger' });
  const vg = mg.verschil();
  ok('verschil tegen de lege generic-standaard = je hele mapping', vg.device === 'generic' && vg.rules.length === 2 && vg.removed.length === 0);
  const mg2 = kaal();
  mg2.laadStandaard(gen);
  mg2.load(vg);
  ok('en terug', mg2.rules.get('cc:3:7')?.action === 'track.1.fader' && mg2.rules.size === 2 && mg2.device === 'generic');
}

// ---- het hele opstarten tegen een nagebouwde server --------------------------
// Net zo streng als server/index.js: POST zonder "rules"-lijst = 400, JSON
// gaat als tekst de database in en komt er als nieuw object weer uit, een
// onbekend bestand is 404. De browser-opslag geeft null voor wat er niet is,
// net als localStorage.

console.log('opstarten, omzetten, bewaren (mapping-opslag.js)');
const { opzetMappingOpslag, laadEigen, haalStandaard, EIGEN_MAPPING } = await import('../src/ui/mapping-opslag.js');
const nepServer = ({ opgeslagen = null, bereikbaar = true, bestanden = {} } = {}) => {
  const s = { db: opgeslagen === null ? null : JSON.stringify(opgeslagen), bereikbaar, posts: 0, bestanden, kapot: new Set() };
  s.haal = async (url, opts = {}) => {
    if (!s.bereikbaar) throw new TypeError('Failed to fetch');
    const antwoord = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/mapping') {
      const methode = opts.method || 'GET';
      if (methode === 'GET') return antwoord(200, { mapping: s.db === null ? null : JSON.parse(s.db) });
      if (methode === 'DELETE') { s.db = null; return antwoord(200, { ok: true }); }
      if (methode === 'POST') {
        if (opts.headers?.['Content-Type'] !== 'application/json') return antwoord(415, { fout: 'alleen application/json' });
        const b = JSON.parse(opts.body);
        if (!b?.mapping || !Array.isArray(b.mapping.rules)) return antwoord(400, { fout: 'een mapping heeft rules nodig' });
        s.posts++;
        s.db = JSON.stringify(b.mapping);
        return antwoord(200, { ok: true, regels: b.mapping.rules.length });
      }
    }
    const mb = /^mappings\/([\w-]+)\.json$/.exec(url);
    if (mb) {
      if (s.kapot.has(mb[1])) return antwoord(500, { fout: 'kapot' });
      if (s.bestanden[mb[1]]) return antwoord(200, s.bestanden[mb[1]]);
      try { return antwoord(200, JSON.parse(readFileSync(new URL(`../mappings/${mb[1]}.json`, import.meta.url), 'utf8'))); } catch { return antwoord(404, {}); }
    }
    return antwoord(404, {});
  };
  s.inDb = () => (s.db === null ? null : JSON.parse(s.db));
  return s;
};
const nepOpslag = (begin = {}) => {
  const d = new Map(Object.entries(begin));
  return { getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k), d };
};
const rust = () => new Promise((r) => setTimeout(r, 5));
{
  // 1. De oude volledige kopie van Clay staat op de server.
  const kopie = normaliseer(kopieVanClay()).doc;
  const srv = nepServer({ opgeslagen: kopie });
  const winkel = nepOpslag({ [EIGEN_MAPPING]: JSON.stringify(kopie) });
  const meldingen = [];
  const m1 = kaal();
  const o1 = opzetMappingOpslag({ mapping: m1, haal: srv.haal, opslag: winkel, meld: (t, s) => meldingen.push([t, s]), wacht: 0 });
  const v1 = await o1.start();
  ok('opstarten met een oude kopie: omgezet, van de server, 4 eigen, 0 weg',
    v1.omgezet && v1.bron === 'server' && v1.eigen === 4 && v1.weg === 0 && v1.bewaard === true);
  ok('wat er nu gekoppeld is, is precies de oude kopie', zelfde(m1.toJSON(), kopie));
  const opServer = srv.inDb();
  ok('op de server staat nu het verschil, niet meer de kopie', isVerschil(opServer) && opServer.rules.length === 4 && srv.posts === 1);
  ok('en in de browser hetzelfde', winkel.getItem(EIGEN_MAPPING) === JSON.stringify(opServer));
  ok('zonder foutmeldingen', meldingen.length === 0);

  // 2. Nog een keer opstarten: niets om te bewaren.
  const m2 = kaal();
  const o2 = opzetMappingOpslag({ mapping: m2, haal: srv.haal, opslag: winkel, wacht: 0 });
  const v2 = await o2.start();
  ok('tweede start: verschil geladen, niets omgezet of bewaard', !v2.omgezet && !v2.standaardNieuw && srv.posts === 1 && zelfde(m2.toJSON(), kopie));

  // 3. Een fragment komt binnen: geen 'eigen' wijziging, dus niets naar de server.
  m2.voegToe('vormen', JSON.parse(readFileSync(new URL('../mappings/apc40mk2-vormen.json', import.meta.url), 'utf8')));
  await rust();
  ok('een fragment dat binnenkomt bewaart niets', srv.posts === 1);

  // 4. Iets koppelen: het verschil groeit met één regel.
  m2.set('note:0:66', 'track.1.sync', { mode: 'trigger' });
  await rust();
  ok('koppelen bewaart het verschil (nu 5 eigen regels)', srv.posts === 2 && srv.inDb().rules.length === 5 && JSON.parse(winkel.getItem(EIGEN_MAPPING)).rules.length === 5);

  // 5. De standaard wordt bijgewerkt (nieuwe regel): komt vanzelf binnen.
  const nieuw = JSON.parse(JSON.stringify(doc));
  nieuw.rules.push({ in: 'note:0:65', action: 'layer.device.detail', mode: 'trigger' });
  srv.bestanden.apc40mk2 = nieuw;
  const m3 = kaal();
  const gemeld3 = [];
  const o3 = opzetMappingOpslag({ mapping: m3, haal: srv.haal, opslag: winkel, meld: (t) => gemeld3.push(t), wacht: 0 });
  const v3 = await o3.start();
  ok('nieuwe standaard: de nieuwe regel is er, jouw 5 ook', m3.rules.get('note:0:65')?.action === 'layer.device.detail'
    && m3.rules.get('cc:0:20@device.rack').action === 'video.fx.pixel' && m3.rules.get('note:0:66').action === 'track.1.sync');
  ok('en het verschil wordt meteen tegen de nieuwe standaard bewaard', v3.standaardNieuw && srv.posts === 3 && srv.inDb().base === vingerafdruk(nieuw));

  // 6. Standaard herstellen = een leeg verschil, geen gat.
  const ok3 = await o3.herstel();
  const leegV = srv.inDb();
  ok('standaard herstellen: een LEEG verschil op de server', ok3 && isVerschil(leegV) && leegV.rules.length === 0 && leegV.removed.length === 0);
  ok('en in de browser', JSON.parse(winkel.getItem(EIGEN_MAPPING)).rules.length === 0);
  ok('en de mapping is precies de standaard', zelfde(m3.toJSON(), nieuw) && m3.verschil().rules.length === 0);
  // Een oude kopie in een ANDERE browser komt daarna niet meer terug: de server heeft iets.
  const andereBrowser = nepOpslag({ [EIGEN_MAPPING]: JSON.stringify(kopie) });
  const m4b = kaal();
  const v4b = await opzetMappingOpslag({ mapping: m4b, haal: srv.haal, opslag: andereBrowser, wacht: 0 }).start();
  ok('na herstellen wint de server (leeg verschil) van een oude kopie in een andere browser',
    v4b.bron === 'server' && m4b.verschil().rules.length === 0
    && m4b.rules.get('cc:0:20@device.rack').action === 'track.{focus}.fx.knob.5');
}
{
  // Server leeg, maar een oude kopie in de browser: omzetten en naar de server.
  const kopie = kopieVanClay();
  const srv = nepServer();
  const winkel = nepOpslag({ [EIGEN_MAPPING]: JSON.stringify(kopie) });
  const m = kaal();
  const v = await opzetMappingOpslag({ mapping: m, haal: srv.haal, opslag: winkel, wacht: 0 }).start();
  ok('alleen in de browser: omgezet en naar de server', v.bron === 'browser' && v.omgezet && isVerschil(srv.inDb()) && srv.inDb().rules.length === 4);

  // Helemaal niets bereikbaar (ook de standaard niet): foutmelding, niets bewaren.
  srv.bereikbaar = false;
  const gemeld = [];
  const mo = kaal();
  const oo = opzetMappingOpslag({ mapping: mo, haal: srv.haal, opslag: winkel, meld: (t, s) => gemeld.push(s), wacht: 0 });
  const vo = await oo.start();
  ok('niets bereikbaar: een foutmelding en geen bewaren', vo.fout && gemeld.includes('fout') && !oo.geladen
    && JSON.parse(winkel.getItem(EIGEN_MAPPING)).rules.length === 4);
}
{
  // Alleen de API weg, de bestanden wel (zoals een 500 op /api/mapping).
  const srv = nepServer();
  const haal = async (url, o) => (url === '/api/mapping' ? new Response('{}', { status: 500 }) : srv.haal(url, o));
  const winkel = nepOpslag({ [EIGEN_MAPPING]: JSON.stringify(maakVerschil(doc, kopieVanClay())) });
  const gemeld = [];
  const m = kaal();
  const o = opzetMappingOpslag({ mapping: m, haal, opslag: winkel, meld: (t, s) => gemeld.push(s), wacht: 0 });
  const v = await o.start();
  ok('API geeft 500: het verschil uit de browser, en niet proberen te bewaren', v.bron === 'browser' && !v.serverBereikbaar && v.eigen === 4 && gemeld.length === 0);
  m.set('note:0:66', 'track.1.sync', { mode: 'trigger' });
  await rust();
  ok('koppelen terwijl de server faalt: in de browser bewaard, en een foutmelding',
    JSON.parse(winkel.getItem(EIGEN_MAPPING)).rules.length === 5 && gemeld.includes('fout'));
}
{
  // De standaard komt niet binnen: dan NIETS bewaren, anders overschrijft de
  // eerste 'change' (een fragment) Clay's verschil met een lege mapping.
  const srv = nepServer({ opgeslagen: maakVerschil(doc, kopieVanClay()) });
  srv.kapot.add('apc40mk2');
  const gemeld = [];
  const m = kaal();
  const o = opzetMappingOpslag({ mapping: m, haal: srv.haal, opslag: nepOpslag(), meld: (t, s) => gemeld.push(s), wacht: 0 });
  await o.start();
  m.voegToe('vormen', { rules: [{ in: 'note:0:65', action: 'layer.device.detail', mode: 'trigger' }] });
  m.set('note:0:66', 'track.1.sync', { mode: 'trigger' });
  await rust();
  ok('standaard onbereikbaar: foutmelding, en Clay\'s verschil op de server blijft ongemoeid',
    gemeld.filter((s) => s === 'fout').length >= 1 && srv.posts === 0 && srv.inDb().rules.length === 4 && !o.geladen);
}
{
  // Importeren van een mapping voor een ander apparaat (generic): de standaard
  // van DAT apparaat wordt erbij gehaald, en het verschil is daartegen.
  const srv = nepServer();
  const winkel = nepOpslag();
  const m = kaal();
  const o = opzetMappingOpslag({ mapping: m, haal: srv.haal, opslag: winkel, wacht: 0 });
  await o.start();
  m.load({ name: 'mijn keyboard', device: 'generic', version: 3, rules: [{ in: 'cc:3:7', action: 'track.1.fader', mode: 'absolute' }] });
  await rust();
  const opgeslagen = srv.inDb();
  ok('import voor generic: bewaard als verschil tegen generic.json', isVerschil(opgeslagen) && opgeslagen.device === 'generic'
    && opgeslagen.rules.length === 1 && opgeslagen.top.name === 'mijn keyboard');
  const m2 = kaal();
  await opzetMappingOpslag({ mapping: m2, haal: srv.haal, opslag: winkel, wacht: 0 }).start();
  ok('en na herladen weer precies die mapping', m2.device === 'generic' && m2.name === 'mijn keyboard' && m2.rules.size === 1);
  // Een apparaat zonder standaardbestand: lege standaard, verschil = alles.
  ok('onbekend apparaat: een lege standaard (404), geen fout',
    (await haalStandaard('bestaat-niet', srv.haal)).rules.length === 0 && (await haalStandaard('../server/index', srv.haal)).rules.length === 0);
  // apc.html leest alleen: laadEigen bewaart niets.
  const voor = srv.posts;
  const kaart = kaal();
  await laadEigen(kaart, { haal: nepServer({ opgeslagen: normaliseer(kopieVanClay()).doc }).haal });
  ok('laadEigen (apc.html) zet een oude kopie om in het geheugen en bewaart niets', srv.posts === voor && kaart.rules.get('cc:0:23@device.rack').action === 'video.fx.grain');
}

// ---- controleur 25 sep: niets overschrijven zonder dat Clay iets deed ----------
// Een OUDE kopie in de browser, van vóór de grid-modus (23 sep): de handmatige
// samenvoeging ging alleen naar de server, dus in een tweede browser (Comet)
// kan zo'n kopie nog staan. Omgezet tegen de huidige standaard worden alle
// grid-modusregels "weggehaald".
const oudeBrowserKopie = () => {
  const k = normaliseer(kopieVanClay()).doc;
  k.rules = k.rules.filter((r) => r.laag !== 'edit.aan');
  return k;
};
console.log('controleur: server niet gelezen = niet naar de server bij opstarten');
{
  // GET /api/mapping faalt (500), POST werkt wel: de server heeft Clay's goede
  // verschil, de browser een oude kopie. Opstarten mag het verschil op de
  // server NIET vervangen: het is niet gelezen, dus niet bekend of het nieuwer is.
  const goed = maakVerschil(doc, kopieVanClay());
  const srv = nepServer({ opgeslagen: goed });
  const haal = (url, o) => (url === '/api/mapping' && !o?.method ? Promise.resolve(new Response('{}', { status: 500 })) : srv.haal(url, o));
  const winkel = nepOpslag({ [EIGEN_MAPPING]: JSON.stringify(oudeBrowserKopie()) });
  const m = kaal();
  const v = await opzetMappingOpslag({ mapping: m, haal, opslag: winkel, wacht: 0 }).start();
  await rust();
  ok('server niet gelezen + oude kopie in de browser: wel geladen (reserve), maar niets naar de server',
    v.bron === 'browser' && v.omgezet && srv.posts === 0);
  ok('Clay\'s verschil op de server is ongeschonden (geen grid-modus "weggehaald")',
    JSON.stringify(srv.inDb()) === JSON.stringify(goed));
}
console.log('controleur: eigen mapping niet geladen = deze sessie niets bewaren');
{
  // mappings/apc40mk2.json komt de EERSTE keer niet binnen (500, bv. de server
  // herstart net), de tweede keer wel: de standaard staat erop, Clay's verschil
  // is niet geladen. Koppelt hij daarna één knop, dan mag dat zijn vier eigen
  // regels op de server niet vervangen door een verschil van één regel.
  const goed = maakVerschil(doc, kopieVanClay());
  const srv = nepServer({ opgeslagen: goed });
  let eerste = true;
  const haal = (url, o) => {
    if (url === 'mappings/apc40mk2.json' && eerste) { eerste = false; return Promise.resolve(new Response('{}', { status: 500 })); }
    return srv.haal(url, o);
  };
  const gemeld = [];
  const m = kaal();
  const o = opzetMappingOpslag({ mapping: m, haal, opslag: nepOpslag(), meld: (t, s) => gemeld.push([t, s]), wacht: 0 });
  const v = await o.start();
  ok('standaard eerst niet binnen: de standaard staat erop, met een foutmelding', !!v.fout && m.rules.size === doc.rules.length
    && gemeld.some(([t, s]) => s === 'fout' && /niet bewaard/.test(t)));
  m.set('note:0:66', 'track.1.sync', { mode: 'trigger' });
  m.voegToe('vormen', fragment);
  await rust();
  ok('een koppeling daarna overschrijft Clay\'s verschil op de server niet', srv.posts === 0 && JSON.stringify(srv.inDb()) === JSON.stringify(goed));
  // Standaard herstellen is een bewuste keuze: dat mag wel, en daarna wordt er weer bewaard.
  ok('standaard herstellen mag daarna wel (bewust)', await o.herstel() && srv.inDb().rules.length === 0 && o.geladen);
  m.set('note:0:66', 'track.1.sync', { mode: 'trigger' });
  await rust();
  ok('en daarna wordt koppelen weer bewaard', srv.inDb().rules.length === 1);
}
console.log('controleur: de reserve in de browser volgt de server');
{
  // Chrome zette de kopie om; in Comet staat nog de oude kopie. Comet laadt
  // van de server (goed), maar zijn reserve moet dan ook het verschil worden,
  // anders ligt de oude kopie klaar voor de dag dat de server even niet antwoordt.
  const goed = maakVerschil(doc, kopieVanClay());
  const srv = nepServer({ opgeslagen: goed });
  const comet = nepOpslag({ [EIGEN_MAPPING]: JSON.stringify(oudeBrowserKopie()) });
  const m = kaal();
  const v = await opzetMappingOpslag({ mapping: m, haal: srv.haal, opslag: comet, wacht: 0 }).start();
  ok('van de server geladen, niets naar de server', v.bron === 'server' && srv.posts === 0);
  ok('en de reserve in de browser is nu hetzelfde verschil', comet.getItem(EIGEN_MAPPING) === JSON.stringify(goed));
}

// Eén bewuste wijziging aan bestaande standaardregels sinds de voorgangers (Clay, 5 okt):
// Cue Level werd het koptelefoonvolume (shift: de mix); sampler-volume en puls gingen naar
// shift in hun eigen grid-modus. Een voorganger verschilt dus alleen in die twee regels.
const CUE_LEVEL_OUD = (e) => JSON.stringify((e?.rules || []).map((r) => `${r.in}${r.shift ? '#shift' : ''}=${r.action}`).sort())
  === JSON.stringify(['cc:0:47#shift=video.pulse', 'cc:0:47=sampler.volume']);

// ---- eerdere standaarden: een oude kopie krijgt de nieuwe regels -------------
// Clay's server had op 25 sep nog zijn VOLLEDIGE kopie van 24 sep (291 regels:
// de standaard 35823dda-291 + vier rack-knoppen op video). De standaard kreeg
// daarna de indeling "Voorstel A" (83 regels erbij). Omzetten tegen de nieuwe
// standaard gaf die 83 als "door Clay weggehaald": ze kwamen nooit binnen.
console.log('eerdere standaarden (eerder in het standaardbestand)');
{
  const { eerdereStandaarden, verschilVanKopie, maakEerder } = await import('../src/control/mapping.js');
  const eerder = eerdereStandaarden(doc);
  ok('het standaardbestand draagt zijn voorgangers mee en ze zijn allemaal terug te rekenen (anders: node tools/mapping/eerder.mjs)',
    Array.isArray(doc.eerder) && doc.eerder.length >= 1 && eerder.length === doc.eerder.length);
  const vorige = eerder.find((e) => e.vingerafdruk === '35823dda-291')?.doc;
  ok('de voorganger waar Clay\'s kopie van 24 sep op rust (35823dda-291, 291 regels) staat erin', vorige?.rules.length === 291);
  ok('de voorganger is de huidige min de nieuwe regels; alleen Cue Level is veranderd (koptelefoon, 5 okt)',
    CUE_LEVEL_OUD(doc.eerder.find((e) => e.vingerafdruk === '35823dda-291')));
  ok('maakEerder rekent uit wat er staat',
    JSON.stringify(maakEerder(doc, vorige).removed) === JSON.stringify(doc.eerder.find((e) => e.vingerafdruk === '35823dda-291').removed));
  // Zo stond hij op Clay's server: de VORIGE standaard met de vier video-knoppen.
  const kopie = JSON.parse(JSON.stringify(vorige));
  for (const r of kopie.rules) if (r.laag === 'device.rack' && VIDEO_KNOPPEN[r.in]) { r.action = VIDEO_KNOPPEN[r.in]; r.mode = 'absolute'; }
  const { verschil, basis } = verschilVanKopie(doc, kopie);
  ok('een oude kopie wordt afgezet tegen de standaard waar hij op rust: 4 eigen, niets weggehaald',
    basis === '35823dda-291' && verschil.base === '35823dda-291' && verschil.rules.length === 4 && verschil.removed.length === 0);
  ok('zonder voorganger zou elke nieuwe regel "weggehaald" zijn (dat lost dit op)',
    maakVerschil(doc, kopie).removed.length === doc.rules.length - vorige.rules.length);
  const mk = kaal();
  mk.laadStandaard(doc);
  const u = mk.load(verschil);
  const oudeSleutels = new Set(vorige.rules.map(sleutelVan));
  const nieuweSleutels = doc.rules.map(sleutelVan).filter((k) => !oudeSleutels.has(k));
  ok(`geladen: de nieuwe standaard (${doc.rules.length}) met Clay's 4 regels, alle ${nieuweSleutels.length} nieuwe regels erop`,
    u.standaardNieuw && u.weg === 0 && u.eigen === 4 && mk.rules.size === doc.rules.length
    && nieuweSleutels.every((k) => mk.rules.has(k)) && mk.rules.get('cc:0:22@device.rack').action === 'video.fx.trails');
  ok('geen nieuwe regel valt op een eigen sleutel van Clay (rack-knoppen 5–8)',
    !nieuweSleutels.some((k) => Object.keys(VIDEO_KNOPPEN).some((sig) => k === `${sig}@device.rack`)));
  const na = mk.verschil();
  ok('opnieuw uitgerekend tegen de nieuwe standaard: alleen de 4', na.rules.length === 4 && na.removed.length === 0 && na.base === vingerafdruk(doc));
  ok('een kopie van de HUIDIGE standaard blijft tegen de huidige afgezet', verschilVanKopie(doc, kopieVanClay()).basis === 'huidig');
  const kapot = { ...doc, eerder: [{ ...doc.eerder[0], removed: doc.eerder[0].removed.slice(1) }] };
  ok('een voorganger die niet meer klopt (vingerafdruk) telt niet mee: liever niets dan een verkeerde basis',
    eerdereStandaarden(kapot).length === 0 && verschilVanKopie(kapot, kopie).basis === 'huidig');

  // Het hele opstarten, zoals Clay's app het straks doet: kopie op de server.
  const srv = nepServer({ opgeslagen: normaliseer(kopie).doc });
  const ms = kaal();
  const v = await opzetMappingOpslag({ mapping: ms, haal: srv.haal, opslag: nepOpslag(), wacht: 0 }).start();
  ok('opstarten: omgezet én de nieuwe standaard erop, bewaard als 4 eigen regels tegen de nieuwe standaard',
    v.omgezet && v.standaardNieuw && v.eigen === 4 && v.weg === 0 && srv.posts === 1
    && srv.inDb().rules.length === 4 && srv.inDb().removed.length === 0 && srv.inDb().base === vingerafdruk(doc));
  ok('en de APC heeft de modus klank (shift + scene 5)', ms.kies('note:0:86', { shift: true })?.action === 'layer.grid.klank');
}

// ---- modus auto: de auto-DJ op de APC (2 okt, VRAGEN AU1) -------------------
// Een zesde grid-modus, Shift + scene 4 of ▲ ▼. Bovenste rij: ok · overslaan ·
// langer · nu, pad 8 = aan/uit. In de standaardmapping (geen fragment: de
// auto-DJ is er altijd), dus ook op apc.html, het scherm en in een verschil.
console.log('\nmodus auto (auto-DJ)');
{
  const { Lagen, GROEPEN, LAAGNAAM, GLUREN: GLUREN_MS } = await import('../src/control/lagen.js');
  const { eerdereStandaarden, verschilVanKopie } = await import('../src/control/mapping.js');
  let t = 0;
  const lg = new Lagen({ now: () => t });
  const am = new Mapping({ read: () => 0, invoke: () => {}, lagen: () => lg.actief() });
  am.load(doc);
  const actie = (sig, shift = false) => am.kies(sig, { shift })?.action ?? null;

  ok('auto is een grid-modus met een eigen naam, achteraan in ▲ ▼ (alleen stems kwam erachter, 5 okt)',
    GROEPEN.grid.knoppen.auto?.join() === 'auto' && GROEPEN.grid.volgorde.at(-2) === 'auto' && GROEPEN.grid.volgorde.at(-1) === 'stems'
    && /auto-dj/.test(LAAGNAAM['grid.auto']));
  lg.zet('grid', 'hotcues'); lg.stap('grid', -2);
  ok('▲ ▲ vanuit hotcues = auto (▲ = stems)', lg.stand.grid === 'auto');
  lg.zet('grid', 'hotcues');

  ok('scene 4 zonder shift = video (zoals altijd), met shift = modus auto',
    actie('note:0:85') === 'layer.grid.video' && actie('note:0:85', true) === 'layer.grid.auto');
  const viaBus = new Mapping({ read: () => 0, invoke: (a, on) => { const x = /^layer\.grid\.(\w+)$/.exec(a); if (x) lg.druk('grid', x[1], on); },
    lagen: () => lg.actief() });
  viaBus.load(doc);
  viaBus.handle(note(98, true)); viaBus.handle(note(85, true)); t += 100; viaBus.handle(note(98, false)); viaBus.handle(note(85, false));
  const naShift = lg.stand.grid;
  ok('Shift + scene 4 kort: auto staat vast open (shift eerder los maakt niet uit)', naShift === 'auto');
  viaBus.handle(note(85, true)); t += 100; viaBus.handle(note(85, false));
  ok('scene 4 zonder shift vanuit auto: video', naShift === 'auto' && lg.stand.grid === 'video');
  lg.zet('grid', 'hotcues');
  viaBus.handle(note(98, true)); viaBus.handle(note(85, true)); t += GLUREN_MS + 10;
  const tijdens = lg.stand.grid;
  viaBus.handle(note(85, false)); viaBus.handle(note(98, false));
  ok('Shift + scene 4 vasthouden = even gluren: auto zolang je vasthoudt, loslaten is terug naar hotcues',
    tijdens === 'auto' && lg.stand.grid === 'hotcues');

  // De pads: bovenste rij, van links naar rechts. De rest van het grid doet niets.
  lg.zet('grid', 'auto');
  const RIJ1 = { 1: 'auto.ok', 2: 'auto.skip', 3: 'auto.langer', 4: 'auto.nu', 8: 'auto.aan' };
  const mis = [];
  for (let kol = 1; kol <= 8; kol++) {
    for (let rij = 1; rij <= 5; rij++) {
      const sig = `note:0:${apc.gridNote(kol, rij)}`;
      const wil = rij === 1 ? RIJ1[kol] ?? null : null;
      if (actie(sig) !== wil) mis.push(`${kol}/${rij}`);
      if (actie(sig, true) !== wil) mis.push(`${kol}/${rij}+shift`);
    }
  }
  ok(`auto: bovenste rij ok · overslaan · langer · nu, pad 8 aan/uit, de rest vrij (ook met shift)${mis.length ? ' — mis: ' + mis.join() : ''}`, mis.length === 0);
  ok('auto: scene 4 blijft video kiezen, zijn lampje toont "auto open"',
    actie('note:0:85') === 'layer.grid.video' && am.kies('note:0:85').led?.lees === 'layer.grid.auto');
  const autoOpen = actie('note:0:32') === 'auto.ok';     // de modus is echt open (anders zeggen de checks hieronder niets)
  ok('auto: scene 5 blijft loop weg (zonder klank-lampje), met shift klank',
    autoOpen && actie('note:0:86') === 'track.{focus}.loop.exit' && !am.kies('note:0:86').led && actie('note:0:86', true) === 'layer.grid.klank');
  ok('auto: de kern zit niet in het mapje (fader, play, filter, Clip Stop, Track Select, device knobs, ▲ ▼)',
    autoOpen && actie('cc:0:7') === 'track.1.fader' && actie('note:0:50') === 'track.1.play' && actie('cc:0:48') === 'track.1.filter'
    && actie('note:0:52') === 'track.1.loop.toggle' && actie('note:2:51') === 'track.3.focus' && actie('cc:0:16') === 'track.{focus}.trim'
    && actie('note:0:94') === 'layer.grid.prev' && actie('note:0:95') === 'layer.grid.next');

  // Indrukken en loslaten gaan naar dezelfde action, ook als shift of het
  // mapje ertussen wisselt.
  const gestuurd = [];
  const ab = new Mapping({ read: () => 0, invoke: (a, v) => gestuurd.push(`${a}=${v}`), vars: () => ({ focus: 2 }), lagen: () => lg.actief() });
  ab.load(doc);
  for (const kol of [1, 2, 3, 4, 8]) { ab.handle(note(apc.gridNote(kol, 1), true)); ab.handle(note(apc.gridNote(kol, 1), false)); }
  ok('auto: de pads roepen auto.* aan, indrukken true en loslaten false',
    gestuurd.join() === 'auto.ok=true,auto.ok=false,auto.skip=true,auto.skip=false,auto.langer=true,auto.langer=false,'
      + 'auto.nu=true,auto.nu=false,auto.aan=true,auto.aan=false');
  gestuurd.length = 0;
  ab.handle(note(apc.gridNote(4, 1), true)); lg.zet('grid', 'hotcues'); ab.handle(note(98, true)); ab.handle(note(apc.gridNote(4, 1), false)); ab.handle(note(98, false));
  ok('auto: loslaten gaat naar de action van het indrukken, ook als mapje en shift intussen wisselden',
    gestuurd.join() === 'auto.nu=true,auto.nu=false');
  lg.zet('grid', 'hotcues');

  // De grid-modus (Shift + Metronome) houdt scene 4, ook met shift: daar
  // verandert Shift + scene 4 niets (anders opende shift + nudge, dan scene 4,
  // de modus auto in plaats van "halve tel").
  const buiten = actie('note:0:85', true);
  lg.zet('edit', 'aan');
  ok('grid-modus: scene 4 = halve tel, ook met shift (Shift + scene 4 opent alleen BUITEN de grid-modus auto); Shift + scene 5 blijft klank',
    buiten === 'layer.grid.auto' && actie('note:0:85') === 'track.{focus}.grid.halfbeat' && actie('note:0:85', true) === 'track.{focus}.grid.halfbeat'
    && actie('note:0:86', true) === 'layer.grid.klank');
  lg.zet('edit', 'uit');

  // Niets bestaands veranderd: de standaard van 25 sep (e2bef131-374) staat als
  // voorganger in `eerder` en verschilt ALLEEN in regels die erbij kwamen.
  const vorige = eerdereStandaarden(doc).find((e) => e.vingerafdruk === 'e2bef131-374')?.doc;
  const vorigeE = doc.eerder.find((e) => e.vingerafdruk === 'e2bef131-374');
  ok('de standaard van 25 sep (374 regels) is een voorganger; alleen bijgekomen, behalve Cue Level (koptelefoon, 5 okt)',
    vorige?.rules.length === 374 && CUE_LEVEL_OUD(vorigeE));
  const nieuw = vorigeE ? vorigeE.removed.slice().sort() : [];
  const wilNieuw = ['note:0:32@grid.auto', 'note:0:33@grid.auto', 'note:0:34@grid.auto', 'note:0:35@grid.auto', 'note:0:39@grid.auto',
    'note:0:85#shift', 'note:0:85@grid.auto', 'note:0:85#shift@edit.aan',
    // Beeld-noodknoppen (2 okt, A4): master-knop = zwart, en vier pads in de modus video.
    'note:0:80', 'note:0:38@grid.video', 'note:0:39@grid.video', 'note:0:30@grid.video', 'note:0:31@grid.video',
    // Koptelefoon (5 okt, docs/STUDIO.md §3): ● zonder shift in elke kolom; sampler-volume
    // en puls naar shift + Cue Level in hun eigen grid-modus (Cue Level = koptelefoon).
    'note:0:48', 'note:1:48', 'note:2:48', 'note:3:48', 'note:4:48', 'note:5:48', 'note:6:48', 'note:7:48',
    'cc:0:47#shift@grid.sampler', 'cc:0:47#shift@grid.video',
    // Modus stems (5 okt, VRAGEN N1, docs/STEMS.md §5): Shift + scene 3, het lampje van
    // scene 3, scene 3 met shift in de grid-modus, en de 40 pads met en zonder shift.
    'note:0:84#shift', 'note:0:84@grid.stems', 'note:0:84#shift@edit.aan',
    ...Array.from({ length: 40 }, (_, n) => [`note:0:${n}@grid.stems`, `note:0:${n}#shift@grid.stems`]).flat()].sort();
  ok(`erbij: precies de vijf pads, Shift + scene 4, het lampje van scene 4, scene 4 met shift in de grid-modus, de vijf beeld-noodknoppen, de acht koptelefoonknoppen en de modus stems (${nieuw.length} regels)`,
    JSON.stringify(nieuw) === JSON.stringify(wilNieuw));
  const tel = (d) => { const c = {}; for (const r of d.rules) { const k = `${r.laag ?? '-'}${r.shift ? '#shift' : ''}`; c[k] = (c[k] || 0) + 1; } return c; };
  const voor = vorige ? tel(vorige) : {}, na = tel(doc);
  const anders = Object.keys({ ...voor, ...na }).filter((k) => voor[k] !== na[k]).sort();
  ok(`aantal regels per bestaande modus gelijk; alleen auto (5 + 1) en stems (40 + 1, 40 met shift) erbij, twee shift-regels zonder mapje en twee in de grid-modus, de noodknoppen (1 zonder mapje, 4 in video) en de koptelefoon (8 zonder mapje) (${anders.join(' ')})`,
    anders.join() === '-,-#shift,edit.aan#shift,grid.auto,grid.sampler#shift,grid.stems,grid.stems#shift,grid.video,grid.video#shift'
    && na['grid.auto'] === 6 && na['grid.stems'] === 41 && na['grid.stems#shift'] === 40 && na['-#shift'] === voor['-#shift'] + 2
    && na['grid.sampler#shift'] === 1 && na['grid.video#shift'] === 1
    && na['edit.aan#shift'] === voor['edit.aan#shift'] + 2 && na['-'] === voor['-'] + 1 + 8 && na['grid.video'] === voor['grid.video'] + 4
    && ['grid.hotcues', 'grid.loops', 'grid.sampler', 'grid.klank', 'device.strip', 'device.rack']
      .every((k) => voor[k] === na[k] && voor[k] > 0));

  // Clay's eigen mapping zoals hij sinds 25 sep op de server staat: een
  // VERSCHIL van vier regels tegen de standaard van toen. Het blijft werken.
  const clay = { kind: 'diff', version: 3, device: 'apc40mk2', base: 'e2bef131-374', top: {},
    rules: Object.entries(VIDEO_KNOPPEN).map(([sig, a], i) => ({ in: sig, action: a, mode: 'absolute', laag: 'device.rack', label: `device knob ${5 + i}` })),
    removed: [] };
  const mc = new Mapping({ read: () => 0, invoke: () => {}, lagen: () => lg.actief() });
  mc.laadStandaard(doc);
  const u = mc.load(clay);
  lg.zet('grid', 'auto');
  ok('Clay\'s verschil (4 rack-knoppen, base e2bef131-374): geladen op de nieuwe standaard, niets weggehaald, de modus auto erop',
    u.verschil && u.standaardNieuw && u.eigen === 4 && u.weg === 0 && mc.rules.size === doc.rules.length
    && mc.kies('note:0:85', { shift: true })?.action === 'layer.grid.auto' && mc.kies('note:0:32')?.action === 'auto.ok'
    && mc.rules.get('cc:0:22@device.rack').action === 'video.fx.trails');
  const opnieuw = mc.verschil();
  ok('en opnieuw bewaard: nog steeds alleen zijn 4, tegen de nieuwe standaard',
    mc.rules.has('note:0:32@grid.auto') && opnieuw.rules.length === 4 && opnieuw.removed.length === 0 && opnieuw.base === vingerafdruk(doc));
  // Een oude VOLLEDIGE kopie van de standaard van 25 sep (zoals export die geeft)
  // wordt tegen die voorganger afgezet: de nieuwe regels komen erbij.
  const kopie25 = JSON.parse(JSON.stringify(vorige));
  for (const r of kopie25.rules) if (r.laag === 'device.rack' && VIDEO_KNOPPEN[r.in]) { r.action = VIDEO_KNOPPEN[r.in]; r.mode = 'absolute'; }
  const vk = verschilVanKopie(doc, kopie25);
  ok('een volledige kopie van 25 sep: afgezet tegen e2bef131-374, 4 eigen, niets weggehaald (anders 106 x "weggehaald": 13 + 8 koptelefoonknoppen + 2 Cue Level-regels in een grid-modus + 83 van de modus stems)',
    vk.basis === 'e2bef131-374' && vk.verschil.rules.length === 4 && vk.verschil.removed.length === 0
    && maakVerschil(doc, kopie25).removed.length === 106);
  lg.zet('grid', 'hotcues');

  // Beeld-noodknoppen (2 okt, ONTBREEKT A4): de master-knop (Track Select boven
  // de masterfader) is zwart, in ELK mapje en zonder mapje; in de modus video
  // rij 1 pad 7 flits, pad 8 zwart zolang je drukt, rij 2 pad 7 zwart, pad 8 bevriezen.
  const zwartOveral = [['grid', 'hotcues'], ['grid', 'loops'], ['grid', 'sampler'], ['grid', 'video'], ['grid', 'klank'], ['grid', 'auto']]
    .every(([g, k]) => { lg.zet(g, k); return am.kies('note:0:80')?.action === 'video.black'; });
  lg.zet('edit', 'aan');
  const zwartGrid = am.kies('note:0:80')?.action === 'video.black';
  lg.zet('edit', 'uit');
  ok('noodknop: de master-knop is zwart in elke grid-modus en in de grid-modus (geen mapje)', zwartOveral && zwartGrid);
  lg.zet('grid', 'video');
  ok('modus video: rij 1 pad 7 flits, pad 8 zwart vasthouden, rij 2 pad 7 zwart, pad 8 bevriezen; de effecten op 1–6 blijven',
    am.kies(`note:0:${apc.gridNote(7, 1)}`)?.action === 'video.flash' && am.kies(`note:0:${apc.gridNote(8, 1)}`)?.action === 'video.black.hold'
    && am.kies(`note:0:${apc.gridNote(7, 2)}`)?.action === 'video.black' && am.kies(`note:0:${apc.gridNote(8, 2)}`)?.action === 'video.freeze'
    && am.kies(`note:0:${apc.gridNote(1, 1)}`)?.action === 'video.fx.pixel.hold');
  lg.zet('grid', 'hotcues');
}

// ---- modus stems (5 okt, VRAGEN N1, docs/STEMS.md §5) ----------------------------
// Een zevende grid-modus, alleen regels ERBIJ: per kolom een stem weg zolang je
// drukt (shift: vastzetten), van boven naar onder zang · rest · drums · bas ·
// overig. Shift + scene 3 opent hem (scene 3 zelf blijft sampler), en in de
// grid-modus blijft Shift + scene 3 "bpm ½", zoals Shift + scene 4 "halve tel".
console.log('\nmodus stems');
{
  const { Lagen, GROEPEN, LAAGNAAM } = await import('../src/control/lagen.js');
  const lg = new Lagen({ now: () => 0 });
  const sm = new Mapping({ read: () => 0, invoke: () => {}, lagen: () => lg.actief() });
  sm.load(doc);
  const actie = (sig, shift = false) => sm.kies(sig, { shift })?.action ?? null;
  ok('stems is een grid-modus met een eigen naam, achteraan in ▲ ▼ (wat er al was blijft op zijn plek)',
    GROEPEN.grid.knoppen.stems?.join() === 'stems' && GROEPEN.grid.volgorde.at(-1) === 'stems' && /stems/.test(LAAGNAAM['grid.stems']));
  lg.zet('grid', 'hotcues'); lg.stap('grid', -1);
  ok('▲ vanuit hotcues = stems', lg.stand.grid === 'stems');
  lg.zet('grid', 'hotcues');
  ok('scene 3 zonder shift = sampler (zoals altijd), met shift = modus stems',
    actie('note:0:84') === 'layer.grid.sampler' && actie('note:0:84', true) === 'layer.grid.stems');
  lg.zet('grid', 'stems');
  const RIJEN = ['vocals', 'inst', 'drums', 'bass', 'other'];
  const mis = [];
  for (let kol = 1; kol <= 8; kol++) {
    for (let rij = 1; rij <= 5; rij++) {
      const sig = `note:0:${apc.gridNote(kol, rij)}`;
      if (actie(sig) !== `track.${kol}.stem.${RIJEN[rij - 1]}.hold`) mis.push(`${kol}/${rij}`);
      if (actie(sig, true) !== `track.${kol}.stem.${RIJEN[rij - 1]}.kill`) mis.push(`${kol}/${rij}+shift`);
    }
  }
  ok(`stems: elke pad doet zijn stem weg op de track van zijn kolom (zang · rest · drums · bas · overig), met shift de schakelaar${mis.length ? ' — mis: ' + mis.join() : ''}`,
    mis.length === 0);
  ok('stems: scene 3 blijft sampler kiezen, zijn lampje toont "stems open"',
    actie('note:0:84') === 'layer.grid.sampler' && sm.kies('note:0:84').led?.lees === 'layer.grid.stems');
  ok('stems: de kern zit niet in het mapje (fader, play, filter, Clip Stop, ● = cue, ▲ ▼)',
    actie('cc:0:7') === 'track.1.fader' && actie('note:0:50') === 'track.1.play' && actie('cc:0:48') === 'track.1.filter'
    && actie('note:0:52') === 'track.1.loop.toggle' && actie('note:0:48') === 'track.1.pfl' && actie('note:0:94') === 'layer.grid.prev');
  // Een pad is een drukknop: loslaten gaat naar het indrukken, ook als shift ertussen komt.
  const gestuurd = [];
  const sb = new Mapping({ read: () => 0, invoke: (a, v) => gestuurd.push(`${a}=${v}`), lagen: () => lg.actief() });
  sb.load(doc);
  sb.handle(note(apc.gridNote(2, 1), true)); sb.handle(note(98, true)); sb.handle(note(apc.gridNote(2, 1), false)); sb.handle(note(98, false));
  sb.handle(note(98, true)); sb.handle(note(apc.gridNote(5, 3), true)); sb.handle(note(98, false)); sb.handle(note(apc.gridNote(5, 3), false));
  ok('stems: zang-pad indrukken en loslaten naar de drukknop; shift + drums-pad naar de schakelaar (loslaten ook)',
    gestuurd.join() === 'track.2.stem.vocals.hold=true,track.2.stem.vocals.hold=false,track.5.stem.drums.kill=true,track.5.stem.drums.kill=false');
  lg.zet('grid', 'hotcues');
  lg.zet('edit', 'aan');
  ok('grid-modus: scene 3 = bpm ½, ook met shift (Shift + scene 3 opent alleen BUITEN de grid-modus stems)',
    actie('note:0:84') === 'track.{focus}.grid.halve' && actie('note:0:84', true) === 'track.{focus}.grid.halve');
  lg.zet('edit', 'uit');
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const kaal = doc.rules.filter((r) => r.laag === 'grid.stems' || r.action === 'layer.grid.stems')
    .filter((r) => beschrijf(r.action).lang.startsWith('?') || beschrijf(r.action).kort === r.action);
  ok('elke regel van de modus stems heeft een uitleg op de APC-kaart', kaal.length === 0);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
