// toetsen.js: dezelfde indeling-vorm, geen Cmd/Ctrl/Alt, niets tijdens typen,
// geen auto-repeat, loslaten naar het indrukken, alles los bij blur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Indeling } from '../src/control/indeling.js';
import { Toetsen } from '../src/control/toetsen.js';
import { Leren } from '../src/control/leren.js';
import toetsen from '../src/control/apparaten/toetsen.js';
import { maakBus } from './control-hulp.mjs';

const doc = { schema: 1, naam: 'proef', apparaat: 'toetsen', regels: [
  { control: 'KeyQ', actie: 'track.{focus}.play', gedrag: 'trigger' },
  { control: 'KeyQ', shift: true, actie: 'track.{focus}.play.quant', gedrag: 'trigger' },
  { control: 'KeyZ', actie: 'track.{focus}.nudge.terug', gedrag: 'trigger' },
  { control: 'Digit{k}', actie: 'track.{k}.focus', gedrag: 'trigger' },
] };
const ev = (code, extra = {}) => ({ code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, target: null, voorkomen: 0, preventDefault() { this.voorkomen++; }, ...extra });

function opzet() {
  const { bus, log } = maakBus();
  const vars = { n: 2 };
  const ind = new Indeling({ bus, apparaat: toetsen, vars: { focus: () => vars.n }, bron: 'toetsen' });
  assert.deepEqual(ind.voegToe(doc).fouten, []);
  const typen = new Set();
  const t = new Toetsen({ indeling: ind, isTypen: (el) => typen.has(el) });
  return { ind, t, log, vars, typen };
}
const acties = (log) => log.map(([id, v]) => `${id}=${v}`);

test('een toets doet zijn actie (met {focus}), met shift de shift-regel; loslaten na shift los naar het indrukken', () => {
  const { t, log } = opzet();
  const e = ev('KeyQ');
  assert.equal(t.neer(e), true);
  assert.equal(e.voorkomen, 1);
  t.op(ev('KeyQ'));
  t.neer(ev('KeyQ', { shiftKey: true }));
  t.op(ev('KeyQ'));                     // shift al los
  t.neer(ev('Digit5')); t.op(ev('Digit5'));
  assert.deepEqual(acties(log), ['track.2.play=true', 'track.2.play=false', 'track.2.play.quant=true', 'track.2.play.quant=false', 'track.5.focus=true', 'track.5.focus=false']);
});

test('Cmd, Ctrl en Alt horen bij de browser; typen in een veld doet niets; een toets zonder regel ook niet', () => {
  const { t, log, typen } = opzet();
  assert.equal(t.neer(ev('KeyQ', { metaKey: true })), false);
  assert.equal(t.neer(ev('KeyQ', { ctrlKey: true })), false);
  assert.equal(t.neer(ev('KeyQ', { altKey: true })), false);
  const veld = {};
  typen.add(veld);
  assert.equal(t.neer(ev('KeyQ', { target: veld })), false);
  const zonder = ev('KeyM');
  assert.equal(t.neer(zonder), false);
  assert.equal(zonder.voorkomen, 0, 'de browser houdt zijn toets');
  assert.equal(t.neer(ev('Escape')), false);
  assert.equal(t.neer(ev('KeyQ', { defaultPrevented: true })), false, 'een schermknop gebruikte hem al');
  assert.deepEqual(log, []);
});

test('auto-repeat doet niets; een nieuwe druk zonder keyup ertussen laat eerst los', () => {
  const { t, log } = opzet();
  t.neer(ev('KeyZ'));
  for (let i = 0; i < 5; i++) assert.equal(t.neer(ev('KeyZ', { repeat: true })), true);
  t.neer(ev('KeyZ'));                   // het keyup kwam nooit (onder Cmd losgelaten)
  t.op(ev('KeyZ'));
  assert.deepEqual(acties(log), ['track.2.nudge.terug=true', 'track.2.nudge.terug=false', 'track.2.nudge.terug=true', 'track.2.nudge.terug=false']);
});

test('blur en een verborgen tabblad: alles los (anders blijft een nudge hangen)', () => {
  const { t, log, ind } = opzet();
  t.neer(ev('KeyZ'));
  t.neer(ev('KeyQ'));
  t.blur();
  assert.equal(ind.vast.size, 0);
  assert.deepEqual(acties(log).slice(2).sort(), ['track.2.nudge.terug=false', 'track.2.play=false']);
  t.op(ev('KeyZ'));                     // het keyup dat na de blur nog komt: niets
  assert.equal(log.length, 4);
  // koppel(): aan een venster en document hangen, en weer los.
  const lijst = new Map();
  const doel = { addEventListener: (n, f) => lijst.set(n, f), removeEventListener: (n) => lijst.delete(n) };
  const docu = { visibilityState: 'visible', addEventListener: (n, f) => lijst.set(`doc:${n}`, f), removeEventListener: (n) => lijst.delete(`doc:${n}`) };
  const los = t.koppel(doel, docu);
  lijst.get('keydown')(ev('KeyZ'));
  docu.visibilityState = 'hidden';
  lijst.get('doc:visibilitychange')();
  assert.equal(log.at(-1).join(), 'track.2.nudge.terug,false,toetsen');
  los();
  assert.equal(lijst.size, 0);
});

test('leren op het toetsenbord: de volgende toets krijgt de actie, en doet zelf niets', () => {
  const { t, log, ind } = opzet();
  const leren = new Leren({ indeling: ind });
  t.leren = leren;
  leren.start('track.{focus}.sync');
  t.neer(ev('KeyX'));
  t.op(ev('KeyX'));
  assert.equal(log.length, 0);
  assert.equal(leren.bezig, false);
  assert.equal(ind.regelVoor('KeyX').actie, 'track.{focus}.sync');
  t.neer(ev('KeyX'));
  assert.deepEqual(acties(log), ['track.2.sync=true']);
});
