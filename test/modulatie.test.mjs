// Spoor S10 (docs/EFFECTEN-MEER.md): modulators, knoppen die knoppen sturen, droog/nat per
// effect, eigen krommes, muteren met zaad, en het rackformaat dat dat allemaal bewaart.
// Puur rekenwerk (modulatie.js, rack.js) en InsertSlot op de mock van test/nep-fx.mjs.
import { staat, MockContext, bereikbaar } from './nep-fx.mjs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };
const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const R = await import('../src/engine/rack.js');
const Mo = await import('../src/engine/modulatie.js');
const { InsertSlot, effectVan, MOD_TIK } = await import('../src/engine/fx.js');

// ---- golven en toeval ---------------------------------------------------------------

console.log('golven en toeval');
ok('golven: +1 op de tel, binnen −1..1', Mo.MOD_VORMEN.filter((v) => v !== 'omlaag').every((v) => bij(Mo.golf(v, 0), 1))
  && Mo.MOD_VORMEN.every((v) => [0, 0.1, 0.33, 0.5, 0.77, 0.99].every((f) => Math.abs(Mo.golf(v, f)) <= 1 + 1e-12)));
ok('omlaag loopt van −1 naar +1 (een opbouw)', bij(Mo.golf('omlaag', 0), -1) && Mo.golf('omlaag', 0.9) > 0.7);
const reeks = (z) => [0, 1, 2, 3, 4, 5, 6, 7].map((n) => Mo.toevalVan(z, n));
ok('toeval: hetzelfde zaad = dezelfde reeks', JSON.stringify(reeks(7)) === JSON.stringify(reeks(7)));
ok('toeval: een ander zaad = een andere reeks', JSON.stringify(reeks(7)) !== JSON.stringify(reeks(8)));
ok('toeval: binnen −1..1, en niet allemaal gelijk', reeks(3).every((x) => x >= -1 && x <= 1) && new Set(reeks(3)).size === 8);
{
  let som = 0, n = 4000;
  for (let i = 0; i < n; i++) som += Mo.toevalVan(11, i);
  ok(`toeval: gemiddeld rond 0 (${(som / n).toFixed(3)})`, Math.abs(som / n) < 0.05);
}

// ---- één modulator op de klok ----------------------------------------------------------

console.log('\nop de klok (regel 3)');
{
  const m = Mo.leesMod({ soort: 'lfo', sync: false, hz: 2, vorm: 'sinus' });
  const s = new Mo.ModStaat();
  const a = s.waarde(m, 10, null), b = s.waarde(m, 10.125, null), c = s.waarde(m, 10.125, null);
  ok('vrij: 2 Hz, een kwart periode later van +1 naar 0', bij(a, 1) && bij(b, 0, 1e-9));
  ok('dezelfde t nog eens = dezelfde waarde (stille klok = stille modulatie)', bij(b, c));
  ok('vrij wordt geklemd op 8 Hz', Mo.leesMod({ soort: 'lfo', sync: false, hz: 40 }).hz === Mo.MOD_HZ_MAX);
}
{
  // Op de maat: tel van 0,5 s, het anker (de volgende tel) op 11,0, vier per maat, de volgende "1" over 3 tellen:
  // de tel op 11,0 is tel 2 van de maat (index 1). Een 1/1-golf (vier tellen) staat daar op 1/4.
  const k = { beatLengte: 0.5, ankerCtx: 11, tellenTotEen: 3, perMaat: 4 };
  const m = Mo.leesMod({ soort: 'lfo', sync: true, deling: '1/1', vorm: 'zaag' });
  const s = new Mo.ModStaat();
  const v = s.waarde(m, 11, k);
  ok(`op de maat: fase uit de tel in de maat (zaag op 1/4 = 0,5; ${v.toFixed(3)})`, bij(v, 0.5, 1e-9));
  // Een halve tel later, met een anker dat een tel verder ligt (de volgende tel is nu 11,5, nog 2 tot de "1"):
  const v2 = s.waarde(m, 11.25, { beatLengte: 0.5, ankerCtx: 11.5, tellenTotEen: 2, perMaat: 4 });
  ok(`… en loopt door met de klok (1/4 + 1/8 → ${v2.toFixed(3)})`, bij(v2, 1 - 2 * 0.375, 1e-9));
  // Zonder klok: door op de laatste tel.
  const v3 = s.waarde(m, 11.75, null);
  ok(`zonder klok: door op de laatst bekende tel (${v3.toFixed(3)})`, bij(v3, 1 - 2 * 0.625, 1e-9));
  // Een sprong (seek): het anker zegt ineens tel 4 van de maat. De golf volgt de maat, geen sprong in tellen buiten de maat.
  const v4 = s.waarde(m, 12, { beatLengte: 0.5, ankerCtx: 12, tellenTotEen: 1, perMaat: 4 });
  ok(`na een sprong: op de tel van de maat (tel 4 = 3/4; ${v4.toFixed(3)})`, bij(v4, 1 - 2 * 0.75, 1e-9));
}
{
  // Stappen: vier stappen op 1/16 (een kwart tel), beginnend op de "1".
  const m = Mo.leesMod({ soort: 'stap', deling: '1/16', stappen: [1, 0, 0.5, 0.25] });
  const s = new Mo.ModStaat();
  const k = (t) => ({ beatLengte: 0.5, ankerCtx: 10, tellenTotEen: 0 === 0 ? 4 : 0, perMaat: 4 });
  // Anker op 10 met tellenTotEen 4 → tel index 0: de "1".
  const w = [10, 10.125, 10.25, 10.375, 10.5].map((t) => s.waarde(m, t, k(t)));
  ok(`stappen: 1 · 0 · ½ · ¼ en weer 1 (${w.join(' · ')})`, JSON.stringify(w) === '[1,0,0.5,0.25,1]');
  const g = Mo.leesMod({ soort: 'stap', deling: '1/16', stappen: [1, 0], glad: 0.5 });
  const sg = new Mo.ModStaat();
  sg.waarde(g, 10, k(10));
  const mid = sg.waarde(g, 10.125 + 0.03125, k(0));
  ok(`glad: halverwege de overgang tussen twee stappen (${mid.toFixed(3)})`, mid > 0.1 && mid < 0.9);
}
{
  const m = Mo.leesMod({ soort: 'volger', aanzet: 0.01, verval: 0.3, gevoel: 0.5 });
  const s = new Mo.ModStaat();
  let niv = 0.2;
  s.waarde(m, 1, null, () => 0);
  const op = s.waarde(m, 1.01, null, () => niv);
  const vol = s.waarde(m, 2, null, () => niv);
  const neer = s.waarde(m, 2.3, null, () => 0);
  ok(`volger: na de aanzet 63% (${(op / vol * 100).toFixed(1)}%), na het verval 37% (${(neer / vol * 100).toFixed(1)}%)`,
    Math.abs(op / vol - (1 - Math.exp(-1))) < 0.01 && Math.abs(neer / vol - Math.exp(-1)) < 0.01);
  ok('volger: binnen 0..1, hoe hard ook', s.waarde(m, 3, null, () => 50) <= 1);
}
ok('een onbekende soort doet niets (null), maar breekt niets', Mo.leesMod({ soort: 'wolk' }) === null
  && new Mo.ModBank([{ soort: 'wolk', doelen: [{ target: 'a.x', diepte: 1 }] }]).actief === false);

// ---- de bank: offsets per doel ---------------------------------------------------------------

console.log('\nde bank');
{
  const bank = new Mo.ModBank([
    { soort: 'lfo', sync: false, hz: 1, vorm: 'sinus', diepte: 0.5, doelen: [{ target: 'a.freq', diepte: 0.4 }, { target: 'plek.2', diepte: -1 }] },
    { soort: 'lfo', sync: false, hz: 1, vorm: 'sinus', diepte: 0, doelen: [{ target: 'b.feedback', diepte: 1 }] },
  ]);
  const u = bank.bereken(0, null, null, new Map([[2, 1]]));
  ok('offset = waarde × diepte × doeldiepte', bij(u.keten.get('a.freq'), 0.2) && bij(u.plek.get(2), -0.5));
  ok('een knop zet de diepte van een modulator (mod.2.diepte)', bij(u.keten.get('b.feedback'), 1));
  const bank2 = new Mo.ModBank([
    { soort: 'lfo', sync: false, hz: 1, diepte: 1, doelen: [{ target: 'mod.2.diepte', diepte: -0.5 }] },
    { soort: 'lfo', sync: false, hz: 1, diepte: 1, doelen: [{ target: 'a.x', diepte: 1 }] },
  ]);
  ok('een modulator op de diepte van een andere (één niveau)', bij(bank2.bereken(0).keten.get('a.x'), 0.5));
}

// ---- het rackformaat ----------------------------------------------------------------------

console.log('\nhet rackformaat');
const bekend = (t) => !!effectVan(t);
const RACK = {
  schema: 1, name: 'proef', uitleg: 'een proef', xy: [3, 1], toekomst: { iets: 1 },
  chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5 } }, { slot: 'b', type: 'delay', params: {}, meng: 0.4 }],
  macros: [
    { place: 1, label: 'een', default: 0, links: [{ target: 'b.feedback', from: 0.2, to: 0.8, kromme: [0, 0.8, 1] }, { target: 'plek.3', from: 0, to: 1 }] },
    { place: 3, label: 'drie', default: 0.25, links: [{ target: 'a.freq', from: 0.5, to: 0.9 }, { target: 'mod.1.diepte', from: 0, to: 1 }, { target: 'b._nat', from: 0, to: 1 }] },
  ],
  mods: [
    { soort: 'lfo', sync: true, deling: '1/2', vorm: 'driehoek', diepte: 1, doelen: [{ target: 'a.reso', diepte: 0.3 }] },
    { soort: 'wolk', iets: 'later', doelen: [] },
  ],
};
{
  const { rack, fouten } = R.leesRack(RACK, { bekendType: bekend });
  ok(`leest zonder fouten (${fouten.join('; ')})`, fouten.length === 0);
  const terug = R.schrijfRack(rack);
  ok('schrijven bewaart uitleg, xy, meng per effect, kromme, modulators (ook een onbekende) en onbekende velden',
    terug.uitleg === 'een proef' && terug.xy.join() === '3,1' && terug.chain[1].meng === 0.4
    && terug.macros[0].links[0].kromme.join() === '0,0.8,1' && terug.mods.length === 2 && terug.mods[1].iets === 'later'
    && terug.toekomst?.iets === 1);
  const weer = R.leesRack(JSON.parse(JSON.stringify(terug)), { bekendType: bekend });
  ok('… en opnieuw lezen geeft hetzelfde', JSON.stringify(R.schrijfRack(weer.rack)) === JSON.stringify(terug));
  const fout = R.leesRack({ ...RACK, xy: [2, 2], mods: [{ soort: 'lfo', doelen: [{ target: 'z.x', diepte: 1 }, { target: 'mod.1.diepte', diepte: 1 }] }],
    macros: [{ place: 1, links: [{ target: 'a.freq', kromme: [5] }] }] }, { bekendType: bekend });
  ok(`klaagt over een fout xy, een doel zonder slot, een modulator op zichzelf, een kapotte kromme (${fout.fouten.length})`,
    fout.fouten.length === 4 && !fout.rack.xy && fout.rack.mods[0].doelen.length === 0 && !fout.rack.macros[0].links[0].kromme);
  const toekomst = R.leesRack({ ...RACK, mods: [{ soort: 'wolk', doelen: [{ target: 'z.bestaat.niet', snelheid: 3 }, { target: 'mod.9.hz' }], extra: 1 }] }, { bekendType: bekend });
  ok('een onbekende soort modulator blijft helemaal ongeschonden, ook zijn doelen', JSON.stringify(R.schrijfRack(toekomst.rack).mods[0]) === JSON.stringify({ soort: 'wolk', doelen: [{ target: 'z.bestaat.niet', snelheid: 3 }, { target: 'mod.9.hz' }], extra: 1 }));
  const teveel = R.leesRack({ ...RACK, mods: Array.from({ length: 6 }, () => ({ soort: 'lfo', doelen: [] })) }, { bekendType: bekend });
  ok('meer dan vier modulators: afgekapt MET een melding', teveel.rack.mods.length === 4 && teveel.fouten.some((f) => /6 modulators/.test(f)));
  const oud = R.leesRack({ name: 'oud', chain: [{ slot: 'a', type: 'delay' }], macros: [] }, { bekendType: bekend });
  const oudUit = R.schrijfRack(oud.rack);
  ok('een rack zonder de nieuwe velden schrijft ze ook niet', !('mods' in oudUit) && !('xy' in oudUit) && !('uitleg' in oudUit) && !('meng' in oudUit.chain[0]));
}
{
  ok('kromme: punten gelijk verdeeld, lineair ertussen', bij(R.pasKromme(0.25, [0, 0.8, 1]), 0.4) && bij(R.pasKromme(0.75, [0, 0.8, 1]), 0.9));
  ok('kromme gaat voor curve', bij(R.resolveLink(0.5, { target: 'a.x', curve: 'exp', kromme: [0, 1, 1] }), 1));
  const { standen, diepte } = R.stuurPlekken(R.leesRack(RACK, { bekendType: bekend }).rack, { 1: 0.5, 3: 0.25 });
  ok('knop 1 stuurt knop 3 (plek.3), en knop 3 de diepte van modulator 1', bij(standen[3], 0.5) && bij(diepte.get(1), 0.25));
  ok('resolveMacros laat plek.* en mod.* links buiten de keten', !R.resolveMacros(RACK, {}).has('plek.3') && !R.resolveMacros(RACK, {}).has('mod.1.diepte'));
}
{
  const a = R.muteer(RACK, { zaad: 5, sterkte: 0.2, effectVan }), b = R.muteer(RACK, { zaad: 5, sterkte: 0.2, effectVan });
  const c = R.muteer(RACK, { zaad: 6, sterkte: 0.2, effectVan });
  ok('muteren: zelfde zaad = zelfde rack, ander zaad = ander rack', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c));
  ok('muteren: filterfrequentie, dichte kanten, knoppen en modulators blijven',
    a.chain[0].params.freq === 0.5 && a.macros[0].links[0].from === 0.2 && a.macros.length === 2 && a.mods.length === 2 && a.xy.join() === '3,1');
  const w = R.muteer(RACK, { zaad: 9, sterkte: 1, effectVan });
  ok('willekeurig (sterkte 1): alles binnen 0..1', w.chain.every((n) => Object.values(n.params).every((v) => v >= 0 && v <= 1)));
}

// ---- InsertSlot: modulatie als offset, op de audioklok ---------------------------------------

console.log('\nInsertSlot');
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const laatste = (p) => p.events.filter((e) => e[0] === 'setTargetAtTime').at(-1)?.[1];
{
  staat.NOW = 1;
  const ctx = new MockContext();
  const fx = new InsertSlot(ctx);
  // Geen modulators: geen timer.
  fx.zetRack({ name: 'zonder', chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5 } }], macros: [{ place: 1, default: 0.3, links: [{ target: 'a.reso', from: 0, to: 1 }] }] });
  ok('zonder modulators: geen timer, geen meter', fx._modTimer === null && fx._meter === null);
  fx.zetRack({
    name: 'met', chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5, reso: 0.2 } }],
    macros: [{ place: 1, default: 0.4, links: [{ target: 'a.freq', from: 0.2, to: 0.8 }] }],
    mods: [{ soort: 'lfo', sync: false, hz: 1, vorm: 'sinus', diepte: 1, doelen: [{ target: 'a.freq', diepte: 0.1 }, { target: 'a.reso', diepte: 0.5 }] }],
  });
  ok('met een modulator: een timer', fx._modTimer !== null);
  // t = 1: sinus op +1 (eerste keer). Knop 1 op 0,4 → freq 0,44 + 0,1.
  ok(`offset bovenop de knop: freq ${fx.paramWaarde('a', 'freq').toFixed(3)} = 0,44 + 0,1`, bij(fx.paramWaarde('a', 'freq'), 0.54, 1e-9));
  ok('de knop zelf beweegt niet mee (leesPlek = 0,4)', bij(fx.leesPlek(1), 0.4));
  ok('een parameter zonder knop: offset op zijn eigen stand (reso 0,2 + 0,5)', bij(fx.paramWaarde('a', 'reso'), 0.7, 1e-9));
  staat.NOW = 1.25;                       // een kwart periode: sinus 0
  await wacht(MOD_TIK * 2 + 10);
  ok(`de timer rekent op de audioklok: op t + ¼ periode is de offset 0 (freq ${fx.paramWaarde('a', 'freq').toFixed(4)})`, bij(fx.paramWaarde('a', 'freq'), 0.44, 1e-6));
  const voor = fx._toegepast.get('a.freq');
  await wacht(MOD_TIK * 2 + 10);
  ok('stille klok: niets nieuws doorgegeven', fx._toegepast.get('a.freq') === voor);
  fx.setPlek(1, 1);
  ok('knop draaien tijdens modulatie: basis verschuift, offset blijft', bij(fx.paramWaarde('a', 'freq'), 0.8, 1e-6));
  fx.zetRack({ name: 'weer zonder', chain: [{ slot: 'a', type: 'filter' }], macros: [] });
  ok('een rack zonder modulators zet de timer uit', fx._modTimer === null);
}
{
  staat.NOW = 2;
  const ctx = new MockContext();
  const fx = new InsertSlot(ctx);
  fx.zetRack({
    name: 'volger', chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5, reso: 0 } }], macros: [],
    mods: [{ soort: 'volger', aanzet: 0.01, verval: 0.2, gevoel: 0.5, diepte: 1, doelen: [{ target: 'a.reso', diepte: 1 }] }],
  });
  ok('de volger hangt een meter aan de INGANG van het rack', fx._meter && fx.in.naar.some((v) => v.doel === fx._meter));
  ctx.niveau = 0.3;
  staat.NOW = 3;
  await wacht(MOD_TIK + 15);
  const r = fx.paramWaarde('a', 'reso');
  ok(`luid = reso omhoog (${r.toFixed(3)})`, r > 0.5);
  clearInterval(fx._modTimer);
}
{
  staat.NOW = 4;
  const ctx = new MockContext();
  const fx = new InsertSlot(ctx);
  fx.zetRack({
    name: 'knop stuurt knop', chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5 } }, { slot: 'b', type: 'delay', params: {} }],
    macros: [
      { place: 1, default: 0, links: [{ target: 'plek.2', from: 0, to: 1 }] },
      { place: 2, default: 0.5, links: [{ target: 'b.feedback', from: 0, to: 1 }] },
    ],
  });
  fx.setPlek(1, 0.8);
  ok('knop 1 zet knop 2 op 0,8: feedback volgt (zonder timer)', bij(fx.paramWaarde('b', 'feedback'), 0.8) && fx._modTimer === null);
  ok('de stand van knop 2 zelf blijft (scherm, LED-ring)', bij(fx.leesPlek(2), 0.5));
}
{
  // Droog/nat per effect: alleen met `meng` of een doel _nat, anders de oude bedrading.
  staat.NOW = 5;
  const ctx = new MockContext();
  const fx = new InsertSlot(ctx);
  fx.zetRack({ name: 'oud', chain: [{ slot: 'a', type: 'delay' }], macros: [] });
  const oud = fx.keten.node;
  const ketenIn = oud.in;
  ok('zonder meng: de ingang gaat recht het effect in (oude bedrading)', ketenIn.naar.length === 1);
  fx.zetRack({ name: 'nat', chain: [{ slot: 'a', type: 'filter', meng: 0.25 }], macros: [{ place: 1, default: 0, links: [{ target: 'a._nat', from: 0.25, to: 1 }] }] });
  const s = fx.keten.node.slots.get('a');
  ok('met meng: droog en nat LINEAIR (0,25: 0,75 / 0,25; equal-power gaf +3 dB halverwege bij een effect dat op zijn ingang lijkt)', s.nat && bij(s.nat.droog.gain.value, 0.75) && bij(s.nat.nat.gain.value, 0.25) && !s.nat.stuur);
  fx.setPlek(1, 1);
  ok('een knop op a._nat zet hem helemaal nat (glijdend)', bij(laatste(s.nat.nat.gain), 1) && bij(laatste(s.nat.droog.gain), 0, 1e-12));
  fx.zetRack({ name: 'stuur', chain: [{ slot: 'a', type: 'delay', meng: 0 }], macros: [{ place: 1, default: 0, links: [{ target: 'a._nat', from: 0, to: 1 }] }] });
  const sd = fx.keten.node.slots.get('a');
  ok('de delay (alleen nat): droog/nat is een STUUR vóór de echo, droog blijft vol, de uitgang van de echo blijft open',
    sd.nat.stuur && sd.nat.droog.gain.value === 1 && sd.nat.nat.gain.value === 1 && sd.nat.stuur.gain.value === 0
    && fx.keten.node.in.naar.some((v) => v.doel === sd.nat.stuur) && sd.nat.stuur.naar.some((v) => v.doel === sd.inst.in));
  fx.setPlek(1, 1); fx.setPlek(1, 0);
  ok('… knop terug: het stuur dicht, de staart rolt door (uitgang nog open)', bij(laatste(sd.nat.stuur.gain), 0, 1e-12) && sd.nat.nat.gain.value === 1 && sd.nat.droog.gain.value === 1);
  fx.zetRack({ name: 'nat', chain: [{ slot: 'a', type: 'filter', meng: 0.25 }], macros: [{ place: 1, default: 0, links: [{ target: 'a._nat', from: 0.25, to: 1 }] }] });
  ok('het droge pad loopt van de ingang van het effect naar de som', bereikbaar(fx.keten.node.in).has(fx.keten.node.slots.get('a').nat.droog));
  ok('de editor kan naar _nat, knoppen en modulators wijzen', fx.doelen().some((d) => d.target === 'a._nat')
    && fx.andereDoelen(1).length === 0 && fx.andereDoelen(2).some((d) => d.target === 'plek.1'));
}
{
  // bewerkMods: een nieuwe modulator op _nat vraagt een nieuwe keten.
  staat.NOW = 6;
  const fx = new InsertSlot(new MockContext());
  fx.zetRack({ name: 'x', chain: [{ slot: 'a', type: 'delay' }], macros: [] });
  const r1 = fx.bewerkMods([{ soort: 'lfo', sync: false, hz: 1, doelen: [{ target: 'a.feedback', diepte: 0.2 }] }]);
  const r2 = fx.bewerkMods([{ soort: 'lfo', sync: false, hz: 1, doelen: [{ target: 'a._nat', diepte: 0.2 }] }]);
  ok('bewerkMods: naar een parameter = geen nieuwe keten; naar _nat zonder droog/nat-pad = wel', !r1.opnieuw && r2.opnieuw);
  clearInterval(fx._modTimer);
}

{
  // Review S10: een modulator weghalen zet het doel terug op zijn eigen stand.
  staat.NOW = 7;
  const fx = new InsertSlot(new MockContext());
  fx.zetRack({ name: 'x', chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5, reso: 0.2 } }], macros: [],
    mods: [{ soort: 'lfo', sync: false, hz: 1, diepte: 1, doelen: [{ target: 'a.reso', diepte: 0.5 }] }] });
  const lp = fx.keten.node.slots.get('a').inst;
  ok('met de LFO: reso 0,7 naar het effect', bij(fx._toegepast.get('a.reso'), 0.7));
  const zetten = [];
  const echt = fx.keten.node.zet;
  fx.keten.node.zet = (t, v, n) => { zetten.push([t, v]); return echt(t, v, n); };
  fx.bewerkMods([]);
  ok('modulator weg: reso krijgt zijn eigen stand terug (0,2), en het scherm zegt hetzelfde', zetten.some(([t, v]) => t === 'a.reso' && bij(v, 0.2)) && bij(fx.paramWaarde('a', 'reso'), 0.2));
  void lp;
  // De stand van een modulator blijft bij bewerken (een schuif in de editor), als de soort gelijk blijft.
  fx.bewerkMods([{ soort: 'lfo', sync: false, hz: 1, diepte: 1, doelen: [{ target: 'a.reso', diepte: 0.5 }] }]);
  staat.NOW = 7.25; fx._modTik();
  const voor = fx._mods.staten[0];
  fx.bewerkMods([{ soort: 'lfo', sync: false, hz: 1, diepte: 0.9, doelen: [{ target: 'a.reso', diepte: 0.5 }] }]);
  staat.NOW = 7.5; fx._modTik();
  ok(`bewerken houdt de fase: na een halve periode staat de sinus op −1 (reso ${fx._toegepast.get('a.reso')?.toFixed(3)})`, fx._mods.staten[0] === voor && bij(fx._toegepast.get('a.reso'), 0));   // zonder: opnieuw vanaf 0 → cos(π/2) = 0 → 0,2
  fx.bewerkMods([{ soort: 'toeval', sync: false, hz: 1, doelen: [{ target: 'a.reso', diepte: 0.5 }] }]);
  ok('een andere soort begint opnieuw', fx._mods.staten[0] !== voor);
  ok('snelle modulator op de maat (1/16): fijne tik (8 ms); traag: 33 ms', (fx.bewerkMods([{ soort: 'stap', deling: '1/16', doelen: [{ target: 'a.reso', diepte: 0.5 }] }]), fx._modTikMs === 8)
    && (fx.bewerkMods([{ soort: 'lfo', sync: true, deling: '1/1', doelen: [{ target: 'a.reso', diepte: 0.5 }] }]), fx._modTikMs === 33));
  clearInterval(fx._modTimer);
}
{
  // Review S10: een hapering van meer dan een halve maat laat de teller niet teruglopen.
  const m = Mo.leesMod({ soort: 'lfo', sync: true, deling: '2/1', vorm: 'zaag' });
  const s = new Mo.ModStaat();
  const bl = 60 / 128;
  const k = (t) => { const n = Math.ceil(t / bl - 1e-9); return { beatLengte: bl, ankerCtx: n * bl, tellenTotEen: (4 - (n % 4)) % 4 || 4, perMaat: 4 }; };
  s.waarde(m, 1, k(1));
  const voor = s.tellen;
  s.waarde(m, 2, k(2));
  ok(`na 1 s stilte op 128 bpm: +${(s.tellen - voor).toFixed(2)} tellen (de klok zegt +2,13)`, Math.abs(s.tellen - voor - 1 / bl) < 0.01);
}

{
  // Review S10 ronde 2: een onbekende modulator met rare doelen laat zetRack niet vallen.
  staat.NOW = 9;
  const fx = new InsertSlot(new MockContext());
  let fout = null;
  try {
    fx.zetRack({ name: 'raar', chain: [{ slot: 'a', type: 'filter' }], macros: [], mods: [{ soort: 'wolk', doelen: { a: 1 } }, { soort: 'wolk', doelen: [null, 3] }] });
    fx.bewerkMods([{ soort: 'wolk', doelen: { a: 1 } }]);
  } catch (e) { fout = e; }
  ok('een onbekende modulator met doelen als object of null: geen fout, de keten is gebouwd, en hij gaat ongeschonden terug', !fout && fx.keten && JSON.stringify(fx.naarJSON().mods) === JSON.stringify([{ soort: 'wolk', doelen: { a: 1 } }]), fout?.message);
  // Een modulator weghalen: die erachter houdt ZIJN stand (niet die van de weggehaalde).
  const A = { soort: 'lfo', sync: false, hz: 0.25, diepte: 1, doelen: [{ target: 'a.reso', diepte: 0.4 }] };
  const B = { soort: 'lfo', sync: false, hz: 0.5, diepte: 1, doelen: [{ target: 'a.freq', diepte: 0.4 }] };
  fx.zetRack({ name: 'twee', chain: [{ slot: 'a', type: 'filter', params: { freq: 0.5, reso: 0.2 } }], macros: [], mods: [A, B] });
  staat.NOW = 9.5; fx._modTik();
  const staatB = fx._mods.staten[1];
  fx.bewerkMods([B], { kaart: [1] });
  ok('modulator 1 weg: modulator 2 schuift op en houdt zijn eigen stand', fx._mods.staten[0] === staatB);
  ok('een stap op de maat (ook 1/8) krijgt de fijne tik', (fx.bewerkMods([{ soort: 'stap', deling: '1/8', doelen: [{ target: 'a.reso', diepte: 0.5 }] }]), fx._modTikMs === 8));
  clearInterval(fx._modTimer);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
