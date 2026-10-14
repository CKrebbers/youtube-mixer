// Spoor S10: het paneel `sjablonen` (een bouwsteen in src/paneel/vrij.js) en de XY-pad van een rack
// (`track.N.fx.xy.x/.y`, src/control/acties-effecten.js). Puur: een nep-bus en een nep-engine.
//   - de bouwsteen: sjabloon ◀ ▶, de XY-pad op de knoppen die het rack kiest, acht plekken, mix, aan/uit;
//   - op de iPad (S8): mag als `mag` het noemt en het paneel op dat scherm staat; bewaren kan niet (niet op de bus);
//   - xy volgt het rack: een ander rack = andere plekken, zonder iets opnieuw te koppelen.
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };

const V = await import('../src/paneel/vrij.js');
const P = await import('../src/paneel/protocol.js');
const M = await import('../src/werk/model.js');
const { Uitvoerder } = await import('../src/paneel/uitvoer.js');
const { bindEffecten, xyVan } = await import('../src/control/acties-effecten.js');
const beschrijfEffecten = (await import('../src/ui/beschrijf/effecten.js')).default;
const { beschrijfSpoor } = await import('../src/ui/beschrijf/index.js');

console.log('de bouwsteen');
const def = V.bouwsteenDef('sjablonen:2');
ok('sjablonen:2 bestaat en heet SJABLONEN 2', def && def.titel === 'SJABLONEN 2' && V.bouwsteenVan('sjablonen').track === '{focus}');
const acties = P.actionsVan(def);
ok('sjabloon ◀ ▶, de XY-pad (x én y), acht plekken, mix en aan/uit', ['track.2.rack.prev', 'track.2.rack.next', 'track.2.fx.xy.x', 'track.2.fx.xy.y', 'track.2.fx.knob.1', 'track.2.fx.knob.8', 'track.2.fx.mix', 'track.2.fx.bypass']
  .every((a) => acties.includes(a)), acties.join(' '));
ok('geen bewaren, wissen of laden in het paneel', !acties.some((a) => /bewaar|wis|load|save/.test(a)));

console.log('\nop de iPad (de schrijfweg van S8)');
const werk = M.normaliseerWerkruimte({ schema: 1, naam: 'fx', titel: 'fx', delen: { fx: { label: 'FX', kleur: 'violet', schermen: { ipad: { vakken: ['sjablonen'] } } } },
  schermen: { ipad: { soort: 'ipad', mag: ['track.*.fx.*', 'track.*.rack.*'] } } }).werkruimte;
ok('het werkruimte-model kent de vaknaam (geen fout)', !!werk && werk.delen.fx.schermen.ipad.vakken[0] === 'sjablonen');
ok('mag: xy, plekken en sjabloon ◀ ▶ (niet in VAST_NOOIT, niet tijdkritisch)', ['track.1.fx.xy.x', 'track.1.fx.xy.y', 'track.1.fx.knob.3', 'track.1.rack.next'].every((a) => M.magOpScherm(werk, 'ipad', a)));
const bus = new Map();
const uitgevoerd = [];
const define = (id, type, fn, meta = {}) => bus.set(id, { id, type, fn, meta });
const nepFx = (macros, xy) => {
  const standen = {};
  return { rack: { macros: macros.map((p) => ({ place: p, label: `knop ${p}` })), ...(xy ? { xy } : {}) },
    setPlek(k, v) { if (!macros.includes(k)) return false; standen[k] = v; return true; }, leesPlek: (k) => (macros.includes(k) ? standen[k] ?? 0 : null),
    plekNaam: (k) => `knop ${k}`, standen };
};
const decks = { A: { fx: nepFx([1, 2, 3, 4], [3, 1]) }, B: { fx: nepFx([1, 2]) } };
const engine = { deck: (id) => decks[id] ?? { fx: nepFx([]) }, master: { fx: nepFx([1, 2, 5], [5, 2]) } };
bindEffecten({ engine, define });
ok('bindEffecten: xy voor acht tracks en de master', ['track.1.fx.xy.x', 'track.8.fx.xy.y', 'master.fx.xy.x', 'master.fx.xy.y'].every((a) => bus.has(a)));
ok('niet in de beginstand van het log (de plek staat er al in)', bus.get('track.1.fx.xy.x').meta.beginstand === false);
const u = new Uitvoerder({
  invoke: (id, v, o) => { uitgevoerd.push([id, v, o?.bron]); bus.get(id).fn(v); },
  read: (id) => bus.get(id)?.meta.read?.() ?? null,
  metaOf: (id) => (bus.has(id) ? { type: bus.get(id).type, meta: bus.get(id).meta } : null),
  werkruimte: () => ({ ...werk, naam: 'fx' }),
  toegestaan: () => new Set(acties.map((a) => a.replace('track.2', 'track.1'))),
});
const r = u.voer({ t: 'invoke', id: 'track.1.fx.xy.x', v: 0.7, scherm: 'ipad', k: 'a', seq: 1 });
ok('de iPad draait de XY-pad: de mixer voert hem uit, met de bron in het log', r.ok && uitgevoerd.at(-1)?.join() === 'track.1.fx.xy.x,0.7,ipad', r.reden);
ok('… op de plek die het rack daarvoor kiest (xy [3, 1]: x = knop 3)', decks.A.fx.standen[3] === 0.7 && decks.A.fx.standen[1] === undefined);
u.voer({ t: 'invoke', id: 'track.1.fx.xy.y', v: 0.2, scherm: 'ipad', k: 'a', seq: 2 });
ok('y = knop 1, en read leest die plek terug', decks.A.fx.standen[1] === 0.2 && bus.get('track.1.fx.xy.y').meta.read() === 0.2 && bus.get('track.1.fx.xy.x').meta.read() === 0.7);
ok('een rack zonder xy: knop 1 en 2', xyVan(decks.B.fx).join() === '1,2' && (bus.get('track.2.fx.xy.y').fn(0.4), decks.B.fx.standen[2] === 0.4));
decks.A.fx = nepFx([1, 2, 6], [6, 2]);
bus.get('track.1.fx.xy.x').fn(0.9);
ok('een ander rack: dezelfde action stuurt nu zijn xy (knop 6), zonder opnieuw te koppelen', decks.A.fx.standen[6] === 0.9);
ok('master: xy [5, 2]', (bus.get('master.fx.xy.x').fn(0.3), engine.master.fx.standen[5] === 0.3));
ok('VAST_NOOIT blijft winnen (laden, opnemen)', !M.magOpScherm({ ...werk, schermen: { ipad: { soort: 'ipad', mag: ['*'] } } }, 'ipad', 'track.1.load.selected'));

console.log('\nuitleg');
ok('uitleg voor xy (track en master)', /XY-pad/.test(beschrijfEffecten('track.{focus}.fx.xy.x')?.lang) && /master-rack/.test(beschrijfEffecten('master.fx.xy.y')?.lang)
  && beschrijfSpoor('track.3.fx.xy.y')?.kort === 'fx xy y' && beschrijfEffecten('track.1.filter') === null);

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
