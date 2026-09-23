// Het scherm als spiegel van de APC: welke control waar staat en wat hij doet.
// Puur rekenwerk tegen de echte standaardmapping, geen DOM.
import { readFileSync } from 'node:fs';

const { Mapping } = await import('../src/control/mapping.js');
const { Lagen } = await import('../src/control/lagen.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;
const P = await import('../src/ui/spiegel-plan.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const doc = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
const lagen = new Lagen();
const m = new Mapping({ read: () => null, invoke: () => {}, lagen: () => lagen.actief() });
m.load(doc);
const lees = (sig, focus = 1, shift = false) => P.leesControl(m, sig, { shift, vars: { focus } });

// ---- de indeling -----------------------------------------------------------

ok('elke gespiegelde control bestaat op het apparaat', P.ALLE.every((c) => apc.label(c.sig)));
ok('geen control staat twee keer op het scherm', new Set(P.ALLE.map((c) => c.sig)).size === P.ALLE.length);
ok('een kolom heeft 13 controls, van knob tot fader',
  P.kolomControls(1).length === 13 && P.kolomControls(1)[0].rol === 'knob' && P.kolomControls(1).at(-1).rol === 'fader');
ok('pad 1 van kolom 1 is de BOVENSTE rij (noot 0x20), niet 0x00', P.kolomControls(1)[1].sig === 'note:0:32');
ok('pad 5 van kolom 8 is rechtsonder (noot 0x07)', P.kolomControls(8)[5].sig === 'note:0:7');
ok('track select 3 zit op kanaal 2', P.kolomControls(3).find((c) => c.rol === 'select').sig === 'note:2:51');
ok('device knobs 1-8 zijn cc 16-23', P.DEVICE_KNOBS.map((c) => c.sig).join() === [16, 17, 18, 19, 20, 21, 22, 23].map((n) => `cc:0:${n}`).join());

// ---- wat de knoppen doen ---------------------------------------------------

ok('kolom 3 activator = play van track 3', lees('note:2:50')?.action === 'track.3.play');
ok('kolom 5 fader = volume track 5', lees('cc:4:7')?.action === 'track.5.fader');
ok('track knob 2 = filter track 2', lees('cc:0:49')?.action === 'track.2.filter');
ok('clip stop met shift op het scherm = loop weg', lees('note:0:52')?.actionShift === 'track.1.loop.exit');
ok('track select shift = tweede (window.R.show)', lees('note:3:51')?.actionShift === 'window.R.show.4');
ok('tooltip noemt de fysieke knop en wat hij doet', /^APC: activator 3 — play/.test(lees('note:2:50').titel));

ok('device knob 1 in de strip = trim van de focus', lees('cc:0:16', 2)?.action === 'track.2.trim');
ok('focuswissel verandert de device knob', lees('cc:0:16', 6)?.action === 'track.6.trim');
lagen.druk('device', 'view', true); lagen.druk('device', 'view', false);
ok('in het rack = fx-plek 1', lees('cc:0:16', 2)?.action === 'track.2.fx.knob.1');
ok('knob 8 in het rack = fx-plek 8', lees('cc:0:23', 2)?.action === 'track.2.fx.knob.8');
lagen.zet('device', 'strip');

ok('pad bovenaan kolom 1 = hotcue 1 (geel)', lees('note:0:32')?.action === 'track.1.hotcue.1' && lees('note:0:32').modus === 'hotcues');
ok('shift+klik op een hotcue-pad wist hem', lees('note:0:32')?.actionShift === 'track.1.hotcue.1.delete');
lagen.zet('grid', 'loops');
ok('mapje loops: dezelfde pad wordt een beatloop', lees('note:0:32')?.action === 'track.1.beatloop.1' && lees('note:0:32').modus === 'loops');
ok('loops-pad heeft geen shift-variant (valt terug op zichzelf)', lees('note:0:32')?.actionShift === null);
lagen.zet('grid', 'sampler');
ok('mapje sampler: bovenste rij = pad', lees('note:0:35')?.action === 'sampler.4' && lees('note:0:35').modus === 'sampler');
lagen.zet('grid', 'hotcues');
ok('scene 2 kiest het mapje loops, in cyaan', lees('note:0:83')?.action === 'layer.grid.loops' && lees('note:0:83').modus === 'loops');
ok('shift zelf doet niets op de bus', lees('note:0:98') === null);
ok('APC-shift ingedrukt: de gewone action wordt de shift-variant', lees('note:0:52', 1, true)?.action === 'track.1.loop.exit');
ok('lege plek geeft null', lees('note:0:87') === null);

ok('korte tekst zonder het kolomnummer', P.kortInKolom('3·cue 1') === 'cue 1' && P.kortInKolom('play') === 'play');
ok('licht: vol, half, uit, onbekend',
  P.lichtVan(1) === 'aan' && P.lichtVan(0.5) === 'half' && P.lichtVan(0) === 'uit' && P.lichtVan(null) === null);

// ---- vensters als model ----------------------------------------------------

let v = { L: 'A', R: 'B' };
v = P.volgFocus(v, 'C');
ok('focus op C: L = C, R = de vorige (A)', v.L === 'C' && v.R === 'A');
ok('zelfde focus verandert niets (zelfde object)', P.volgFocus(v, 'C') === v);
v = P.volgFocus(v, 'A');
ok('terug naar A: wisselen', v.L === 'A' && v.R === 'C');
ok('tweede zetten', P.zetTweede(v, 'E').R === 'E' && P.zetTweede(v, 'E').L === 'A');
ok('de focus kan niet ook de tweede zijn', P.zetTweede(v, 'A') === v);

// ---- Clip/Device View licht alleen op in het rack -------------------------

const { bindLagen, read } = await import('../src/control/actions.js');
const l2 = new Lagen();
bindLagen(l2);
ok('in de strip (standaard) is de kiesknop uit', read('layer.device.view') === 0);
l2.zet('device', 'rack');
ok('in het rack licht hij op', read('layer.device.view') === 1);
ok('een grid-kiesknop licht op als zijn mapje open staat', read('layer.grid.hotcues') === 1 && read('layer.grid.loops') === 0);

// ---- de kolomkop: resterende tijd, bpm, crossfaderkant ---------------------

const deck = (x) => ({ loaded: true, duration: 300, position: 0, playing: false, bpm: null, ...x });
ok('resterend in hele seconden, naar boven afgerond', P.kolomInfo(deck({ position: 87.6 })).rest === '-3:33');
ok('op het einde: -0:00', P.kolomInfo(deck({ position: 300 })).rest === '-0:00');
ok('lange track: minuten lopen door', P.kolomInfo(deck({ duration: 3725, position: 0 })).rest === '-62:05');
ok('bpm is de hoorbare (d.bpm), één decimaal', P.kolomInfo(deck({ bpm: 153.04 })).bpm === '153.0');
ok('geen grid: streepje', P.kolomInfo(deck({})).bpm === '—');
ok('lege track: streepjes, nooit bijna', P.kolomInfo({ loaded: false }).rest === '—' && !P.kolomInfo({ loaded: false }).bijna);
ok('onder 30 s en spelend = bijna', P.kolomInfo(deck({ position: 275, playing: true })).bijna);
ok('onder 30 s maar stil = niet bijna (niets aan de hand)', !P.kolomInfo(deck({ position: 275 })).bijna);
ok('31 s voor het eind = nog niet bijna', !P.kolomInfo(deck({ position: 269, playing: true })).bijna);
ok('kant uit read(): 0 = A, 0,5 = thru, 1 = B, null = onbekend',
  P.kantVan(0) === 'A' && P.kantVan(0.5) === 'thru' && P.kantVan(1) === 'B' && P.kantVan(null) === null);
ok('alleen xfade.side toont de kant (niet de losse A/B/thru-actions)',
  P.isKantKnop('track.3.xfade.side') && !P.isKantKnop('track.3.xfade.a') && !P.isKantKnop(null));

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nspiegel: alles groen');
