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

const { bindEngine, bindVideo, bindApp, bindLagen, list, read } = await import('../src/control/actions.js');
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
ok('elk mapje in lagen.js heeft regels in de mapping', Object.entries(GROEPEN).every(([g, d]) =>
  Object.values(d.knoppen).flat().every((n) => doc.rules.some((r) => r.laag === `${g}.${n}`))));

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
  ok('begint op de standaard-mapjes', lg.actief().join() === 'top.filter,device.rack,grid.hotcues');
  lg.druk('top', 'sends', true); t += 100; lg.druk('top', 'sends', false);
  ok('kort drukken zet het mapje vast', lg.stand.top === 'echo');
  lg.druk('top', 'sends', true); t += 100; lg.druk('top', 'sends', false);
  ok('nog eens op dezelfde kiesknop: het volgende mapje eronder (galm)', lg.stand.top === 'reverb');
  lg.druk('top', 'pan', true); t += 50; lg.druk('top', 'pan', false);
  lg.druk('top', 'user', true); t += GLUREN + 10;
  ok('vasthouden: het mapje is open zolang je vasthoudt', lg.stand.top === 'low');
  lg.druk('top', 'user', false);
  ok('loslaten na gluren: terug naar waar je was', lg.stand.top === 'filter');
  lg.stap('grid', 1);
  ok('bladeren door het grid', lg.stand.grid === 'loops');
  lg.stap('grid', -2);
  ok('en rond', lg.stand.grid === 'video');
  lg.zet('grid', 'hotcues');

  const gestuurd = [];
  const m = new Mapping({ read: () => 0.5, invoke: (a, v) => gestuurd.push([a, v]), vars: () => ({ focus: 3 }), lagen: () => lg.actief() });
  m.load({ version: 3, shift: 'note:0:98', rules: [
    { in: 'note:0:52', action: 'track.1.loop.toggle', mode: 'trigger' },
    { in: 'note:0:52', action: 'track.1.loop.exit', mode: 'trigger', shift: true },
    { in: 'cc:0:7', action: 'track.1.fader', mode: 'absolute' },
    { in: 'cc:0:48', action: 'track.1.filter', mode: 'absolute', laag: 'top.filter' },
    { in: 'cc:0:48', action: 'track.1.send.a', mode: 'absolute', laag: 'top.echo' },
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

  m.handle(cc(48, 64));
  ok('track knob in mapje filter', gestuurd.at(-1)[0] === 'track.1.filter');
  lg.zet('top', 'echo');
  m.handle(cc(48, 64));
  ok('zelfde knop in mapje echo', gestuurd.at(-1)[0] === 'track.1.send.a');
  m.handle(noot(32, true));
  lg.zet('grid', 'loops');                 // mapje wisselt terwijl de pad ingedrukt is
  m.handle(noot(32, false));
  ok('pad loslaten na een mapjewissel: toch naar de hotcue', gestuurd.at(-2)[0] === 'track.1.hotcue.1' && gestuurd.at(-1)[0] === 'track.1.hotcue.1' && gestuurd.at(-1)[1] === false);
  m.handle(noot(32, true)); m.handle(noot(32, false));
  ok('daarna: de pad van het loops-mapje', gestuurd.at(-1)[0] === 'track.1.beatloop.1');
  ok('actieveRegels: per knop de regel van nu', m.actieveRegels().get('note:0:32').action === 'track.1.beatloop.1'
    && m.actieveRegels().get('cc:0:48').action === 'track.1.send.a');

  // Koppelen in een mapje: de nieuwe regel komt in het open mapje.
  const regel = m.set('cc:0:48', 'track.1.low', { mode: 'absolute' });
  ok('koppelen komt in het open mapje, de andere blijven', regel.laag === 'top.echo'
    && m.rules.get('cc:0:48@top.filter').action === 'track.1.filter' && m.rules.get('cc:0:48@top.echo').action === 'track.1.low');
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

// ---- apc.html: elke knop een uitleg ---------------------------------------
{
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const kaal = doc.rules.filter((r) => { const b = beschrijf(r.action); return b.lang === r.action || !b.kort; }).map((r) => r.action);
  if (kaal.length) console.log('   zonder uitleg:', [...new Set(kaal)]);
  ok('APC-kaarten: elke action in de standaardmapping heeft een uitleg in gewone taal', kaal.length === 0);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
