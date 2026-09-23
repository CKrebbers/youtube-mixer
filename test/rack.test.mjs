// Effect-racks: puur rekenwerk, dus volledig in Node te toetsen.
// De tabel onderaan is een gouden bestand: vijf macrostanden met de uitkomst
// die eruit hoort te komen. Dat vangt regressies die je met je oren pas na een
// week hoort.
const R = await import('../src/engine/rack.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- curves ----------------------------------------------------------------

ok('lineair laat 0..1 staan', bij(R.pasCurve(0.3), 0.3) && bij(R.pasCurve(1), 1));
ok('exp begint traag', R.pasCurve(0.5, 'exp') < 0.5);
ok('log begint snel', R.pasCurve(0.5, 'log') > 0.5);
ok('s is zacht aan beide kanten', bij(R.pasCurve(0.5, 's'), 0.5) && R.pasCurve(0.25, 's') < 0.25);
ok('alle curves blijven binnen 0..1',
  R.CURVES.every((c) => [0, 0.5, 1].every((t) => R.pasCurve(t, c) >= 0 && R.pasCurve(t, c) <= 1)));
ok('een onbekende curve valt terug op lineair', bij(R.pasCurve(0.4, 'rommel'), 0.4));

// ---- één link --------------------------------------------------------------

const vol = { target: 'a.x', from: 0, to: 1 };
ok('zonder venster loopt hij mee', bij(R.resolveLink(0.4, vol), 0.4));
ok('bereik wordt toegepast', bij(R.resolveLink(0.5, { target: 'a.x', from: 0.2, to: 0.6 }), 0.4));
ok('from > to draait de richting om', bij(R.resolveLink(0.25, { target: 'a.x', from: 1, to: 0 }), 0.75));

const venster = { target: 'b.feedback', in: [0.25, 1], from: 0.3, to: 0.8 };
ok('onder het venster blijft hij op zijn begin', bij(R.resolveLink(0, venster), 0.3));
ok('op de ondergrens ook', bij(R.resolveLink(0.25, venster), 0.3));
ok('halverwege het venster', bij(R.resolveLink(0.625, venster), 0.55));
ok('bovenaan staat hij op zijn eind', bij(R.resolveLink(1, venster), 0.8));
ok('buiten bereik wordt geklemd, niet doorgerekend', bij(R.resolveLink(2, venster), 0.8));

ok('een venster van nul breedte schakelt',
  bij(R.resolveLink(0.4, { target: 'a.x', in: [0.5, 0.5] }), 0) &&
  bij(R.resolveLink(0.6, { target: 'a.x', in: [0.5, 0.5] }), 1));

ok('stappen kwantiseren', bij(R.resolveLink(0.3, { target: 'a.x', steps: 4 }), 1 / 3));
ok('en raken de uiteinden precies',
  bij(R.resolveLink(0, { target: 'a.x', steps: 4 }), 0) && bij(R.resolveLink(1, { target: 'a.x', steps: 4 }), 1));

// ---- meerdere macro's ------------------------------------------------------

const rack = {
  schema: 1, name: 'proef',
  chain: [
    { slot: 'a', type: 'filter', params: {} },
    { slot: 'b', type: 'delay', params: {} },
  ],
  macros: [
    { place: 1, label: 'Dub', default: 0, links: [
      { target: 'b.tijd', from: 0.2, to: 0.7 },
      { target: 'b.feedback', from: 0.3, to: 0.8, in: [0.25, 1] },
    ] },
    { place: 4, label: 'Filter', default: 0.5, bipolar: true, links: [
      { target: 'a.freq', from: 0, to: 1 },
    ] },
  ],
};

const bij0 = R.resolveMacros(rack, { 1: 0, 4: 0.5 });
ok('alle doelen komen eruit', bij0.size === 3);
ok('en met de juiste waarden', bij(bij0.get('b.tijd'), 0.2) && bij(bij0.get('b.feedback'), 0.3) && bij(bij0.get('a.freq'), 0.5));

const bij1 = R.resolveMacros(rack, { 1: 1, 4: 0 });
ok('één knop duwt meerdere parameters', bij(bij1.get('b.tijd'), 0.7) && bij(bij1.get('b.feedback'), 0.8));
ok('en de andere macro blijft onafhankelijk', bij(bij1.get('a.freq'), 0));

const standaard = R.resolveMacros(rack, {});
ok('zonder standen wordt de default gebruikt',
  bij(standaard.get('b.tijd'), 0.2) && bij(standaard.get('a.freq'), 0.5));

// botsing: de hoogste plek wint, en dat is voorspelbaar
const botsing = {
  schema: 1, chain: [{ slot: 'a', type: 'filter' }],
  macros: [
    { place: 5, default: 0, links: [{ target: 'a.freq', from: 0, to: 0.2 }] },
    { place: 2, default: 1, links: [{ target: 'a.freq', from: 0, to: 0.9 }] },
  ],
};
ok('bij een botsing wint de hoogste plek', bij(R.resolveMacros(botsing, { 2: 1, 5: 0 }).get('a.freq'), 0));
ok('en de volgorde in de lijst doet er niet toe',
  bij(R.resolveMacros({ ...botsing, macros: [...botsing.macros].reverse() }, { 2: 1, 5: 0 }).get('a.freq'), 0));

// ---- inlezen, controleren, terugschrijven ----------------------------------

const bekend = (t) => ['filter', 'delay', 'crush'].includes(t);

const leeg = R.leesRack({}, { bekendType: bekend });
ok('een leeg rack is geldig', leeg.rack.schema === R.RACK_SCHEMA && leeg.fouten.length === 0);

const zonderSchema = R.leesRack({ chain: [], macros: [] }, { bekendType: bekend });
ok('een rack zonder schema wordt gemigreerd', zonderSchema.rack.schema === R.RACK_SCHEMA);

const g = R.leesRack(rack, { bekendType: bekend });
ok('een geldig rack geeft geen klachten', g.fouten.length === 0);
ok('slots blijven hun eigen id houden', g.rack.chain.map((c) => c.slot).join('') === 'ab');

const stuk = R.leesRack({
  schema: 1,
  chain: [{ slot: 'a', type: 'filter' }],
  macros: [
    { place: 1, links: [{ target: 'z.freq', from: 0, to: 1 }] },
    { place: 2, links: [{ from: 0, to: 1 }] },
    { links: [] },
  ],
}, { bekendType: bekend });
ok('een doel naar een onbestaand slot wordt luid gemeld',
  stuk.fouten.some((f) => f.includes('z.freq')));
ok('en die link wordt niet stilletjes uitgevoerd', stuk.rack.macros[0].links.length === 0);
ok('een link zonder doel wordt gemeld', stuk.fouten.some((f) => f.includes('zonder doel')));
ok('een macro zonder plek wordt genegeerd', stuk.rack.macros.length === 2);

// Onbekend effect: bewaren, niet weggooien. Eén keer openen in een oudere
// versie mag geen rack slopen.
const toekomst = R.leesRack({
  schema: 1,
  chain: [{ slot: 'a', type: 'spectral.freeze', params: { grootte: 0.7 } }],
  macros: [{ place: 1, links: [{ target: 'a.grootte', from: 0, to: 1 }] }],
}, { bekendType: bekend });
ok('een onbekend effect wordt gemeld', toekomst.fouten.some((f) => f.includes('spectral.freeze')));
ok('maar blijft in de keten staan', toekomst.rack.chain.length === 1);
ok('gemarkeerd als onbekend', toekomst.rack.chain[0].onbekend === true);
ok('en staat uit', toekomst.rack.chain[0].bypass === true);
ok('zijn parameters blijven bewaard', toekomst.rack.chain[0].params.grootte === 0.7);
const terug = R.schrijfRack(toekomst.rack);
ok('en komen er ongeschonden weer uit', terug.chain[0].type === 'spectral.freeze' && terug.chain[0].params.grootte === 0.7);
ok('de interne markering lekt niet naar het bestand', !('onbekend' in terug.chain[0]));

// ---- rondje: schrijven en opnieuw lezen ------------------------------------

const heen = R.schrijfRack(g.rack);
const weer = R.leesRack(JSON.parse(JSON.stringify(heen)), { bekendType: bekend });
ok('schrijven -> lezen geeft dezelfde macro-uitkomsten',
  JSON.stringify([...R.resolveMacros(weer.rack, { 1: 0.6, 4: 0.3 })]) ===
  JSON.stringify([...R.resolveMacros(g.rack, { 1: 0.6, 4: 0.3 })]));
ok('en zonder nieuwe klachten', weer.fouten.length === 0);

// ---- gouden bestand --------------------------------------------------------
// Vijf standen, vaste uitkomsten. Verandert hier iets, dan klinkt elk bestaand
// rack anders — en dat moet een bewuste keuze zijn, geen ongelukje.

const GOUD = [
  [0.00, { 'b.tijd': 0.200, 'b.feedback': 0.300, 'a.freq': 0.500 }],
  [0.25, { 'b.tijd': 0.325, 'b.feedback': 0.300, 'a.freq': 0.500 }],
  [0.50, { 'b.tijd': 0.450, 'b.feedback': 0.467, 'a.freq': 0.500 }],
  [0.75, { 'b.tijd': 0.575, 'b.feedback': 0.633, 'a.freq': 0.500 }],
  [1.00, { 'b.tijd': 0.700, 'b.feedback': 0.800, 'a.freq': 0.500 }],
];
let goudOk = true;
for (const [stand, verwacht] of GOUD) {
  const uit = R.resolveMacros(rack, { 1: stand, 4: 0.5 });
  for (const [k, v] of Object.entries(verwacht)) {
    if (!bij(uit.get(k), v, 1e-3)) { goudOk = false; console.log(`       ${stand} ${k}: ${uit.get(k)} != ${v}`); }
  }
}
ok('gouden bestand klopt op alle vijf standen', goudOk);

// ---- rack uit één effect ---------------------------------------------------

const effect = { id: 'delay', naam: 'Delay', params: ['tijd', 'feedback'], standaard: { tijd: 0.4, feedback: 0.5 } };
const uitEffect = R.rackVanEffect(effect);
ok('één effect wordt een rack met één macro per parameter', uitEffect.macros.length === 2);
ok('met de parameternaam als label', uitEffect.macros[0].label === 'tijd');
ok('en de standaardwaarde als default', bij(uitEffect.macros[1].default, 0.5));
ok('dat rack is zelf geldig', R.leesRack(uitEffect, { bekendType: bekend }).fouten.length === 0);

// ---- DICHT/OPEN: instellen door te doen -------------------------------------

console.log('\nDICHT en OPEN');
{
  const m = { place: 1, label: 'x', default: 0, links: [] };
  let r = R.neemOp(m, 'a.feedback', 'open', 0.8, 0.3);
  ok('nieuwe parameter: koppeling erbij, huidige stand is de andere kant',
    m.links.length === 1 && m.links[0].from === 0.3 && m.links[0].to === 0.8 && !r.weg);
  R.neemOp(m, 'a.feedback', 'dicht', 0.1, 0.5);
  ok('bestaande koppeling: alleen die kant verandert, basis telt niet', m.links[0].from === 0.1 && m.links[0].to === 0.8);
  ok('dicht = knop 0, open = knop 1, ook met een venster en curve', (() => {
    m.links[0].in = [0.5, 1]; m.links[0].curve = 'exp';
    return R.resolveLink(0, m.links[0]) === 0.1 && bij(R.resolveLink(1, m.links[0]), 0.8);
  })());
  r = R.neemOp(m, 'a.feedback', 'dicht', 0.8, 0);
  ok('beide kanten gelijk: koppeling weg, en de parameter houdt die waarde', r.weg && m.links.length === 0 && r.basis === 0.8);
  R.neemOp(m, 'b.freq', 'dicht', 0.2, 0.5);
  R.neemOp(m, 'a.tijd', 'dicht', 0.6, 0.35);
  ok('meerdere parameters op één knop', m.links.map((l) => l.target).join() === 'b.freq,a.tijd');
  ok('waarden worden geklemd', (R.neemOp(m, 'b.freq', 'open', 7, 0), m.links[0].to === 1));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
