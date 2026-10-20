import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Noten } from '../src/control/noten.js';

function nepToegang() {
  const poort = (id, name) => {
    const l = new Set();
    return { id, name, state: 'connected', addEventListener: (_, f) => l.add(f), removeEventListener: (_, f) => l.delete(f), stuur: (b) => { for (const f of l) f({ data: Uint8Array.from(b) }); }, luisteraars: () => l.size };
  };
  const inputs = new Map([['k', poort('k', 'Keystation 49')], ['apc', poort('apc', 'APC40 mkII')]]);
  const sl = new Set();
  return { inputs, addEventListener: (_, f) => sl.add(f), removeEventListener: (_, f) => sl.delete(f), wissel: () => { for (const f of sl) f(); } };
}
function ontvanger() {
  const log = [];
  let speel = 3;
  return { log, zet: (n) => { speel = n; },
    aan: (noot, v) => { log.push(['aan', noot, v, speel]); return speel; },
    uit: (noot, s) => log.push(['uit', noot, s]),
    houd: (aan, s) => { log.push(['houd', aan, s ?? speel]); return s ?? speel; },
    buig: (w) => log.push(['buig', w]), mod: (w) => log.push(['mod', w]) };
}

test('noten van het keyboard, niet van de controller; noot-uit naar waar de noot-aan heen ging', () => {
  const t = nepToegang(), o = ontvanger();
  const n = new Noten({ toegang: t, ontvanger: o, isController: (p) => /apc/i.test(p.name) });
  n.start();
  assert.equal(t.inputs.get('apc').luisteraars(), 0, 'de controller niet');
  t.inputs.get('k').stuur([0x90, 60, 100]);
  o.zet(5);                                       // de speeltrack wisselt tijdens de noot
  t.inputs.get('k').stuur([0x80, 60, 0]);
  assert.deepEqual(o.log, [['aan', 60, 100 / 127, 3], ['uit', 60, 3]]);
  t.inputs.get('k').stuur([0x90, 62, 0]);         // aan met snelheid 0 = uit (niets klinkt: niets)
  assert.equal(o.log.length, 2);
});

test('pedaal, pitchbend en modwiel; het pedaal laat los waar het indrukte', () => {
  const t = nepToegang(), o = ontvanger();
  const n = new Noten({ toegang: t, ontvanger: o, isController: (p) => /apc/i.test(p.name) });
  n.start();
  const k = t.inputs.get('k');
  k.stuur([0xb0, 64, 127]); o.zet(6); k.stuur([0xb0, 64, 0]);
  k.stuur([0xe0, 0, 64]); k.stuur([0xb0, 1, 127]);
  assert.deepEqual(o.log, [['houd', true, 3], ['houd', false, 3], ['buig', 0], ['mod', 1]]);
});

test('keyboard eruit: alles wat klonk en het pedaal los', () => {
  const t = nepToegang(), o = ontvanger();
  const n = new Noten({ toegang: t, ontvanger: o, isController: (p) => /apc/i.test(p.name) });
  n.start();
  const k = t.inputs.get('k');
  k.stuur([0x90, 60, 90]); k.stuur([0x91, 64, 90]); k.stuur([0xb0, 64, 127]);
  k.state = 'disconnected'; t.wissel();
  assert.deepEqual(o.log.slice(-3).map((x) => x[0]).sort(), ['houd', 'uit', 'uit']);
  assert.equal(k.luisteraars(), 0);
});
