// De effectlaag IN de strip en de mixer (src/audio/strip.js, mixer.js, fx/): op de strenge Web
// Audio-mock. Zonder effect raakt de slot het pad niet aan (bit voor bit plak 1, de golden hash);
// met een effect: de natte weg, wisselen met een kruisfade zonder curvebreuk, de twee bussen,
// opruimen. Plus de maatklok als klok van de effecten (fx/klok.js) en v1's harde regels op de
// effecten zelf (negatieve Q in elke lus, de galmtijd van de FDN, de delay zonder doppler).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NepOmgeving, installeer } from './web-audio-mock.mjs';

installeer();
const { maakStrip } = await import('../src/audio/strip.js');
const { maakMixer } = await import('../src/audio/mixer.js');
const { InsertSlot, effectVan, EFFECTEN, FADE } = await import('../src/audio/fx/fx.js');
const { SEND_RACKS, sendGain } = await import('../src/audio/fx/sends.js');
const { fxKlokVan, volgKlok, volgendKnikpunt } = await import('../src/audio/fx/klok.js');
const { leesRack, schrijfRack, isBouwplanVorm } = await import('../src/audio/fx/rack.js');
const { Klok } = await import('../src/kern/klok.js');
const { startDrempel } = await import('../src/audio/overgang.js');

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const dicht = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

function opzet(opties) {
  const omg = new NepOmgeving(opties);
  const m = maakMixer(omg.ctx, { limiter: false });
  const st = maakStrip(omg.ctx, m);
  return { omg, ctx: omg.ctx, m, st, n: st.nodes };
}

function schoon(omg) {
  assert.equal(omg.stats.CURVES, 0, 'nergens setValueCurveAtTime');
  assert.equal(omg.stats.CURVE_BREUK, 0, 'geen afgebroken curve');
  assert.equal(omg.stats.OVERLAP_FOUTEN, 0, 'geen NotSupportedError');
  assert.equal(omg.stats.VERLEDEN, 0, 'niets in het verleden gepland');
}

/** Alle nodes die vanaf `start` bereikbaar zijn (een verbinding naar een param telt als naar zijn node). */
function bereikbaar(omg, start) {
  const gezien = new Set(), stapel = [start];
  while (stapel.length) {
    const x = stapel.pop();
    if (!x || gezien.has(x)) continue;
    gezien.add(x);
    for (const l of omg.uitVan(x)) stapel.push(l.naar.node ?? l.naar);
  }
  return gezien;
}

// ---- zonder effect: het pad van plak 1 ---------------------------------------------------

test('zonder effect: de slot staat er (delay-rack van v1, knoppen), maar geen enkele node extra in het pad', () => {
  const { omg, m, st, n } = opzet();
  assert.ok(st.fx instanceof InsertSlot);
  assert.equal(st.fx.rackNaam, 'Delay');
  assert.equal(st.fx.plekNaam(1), 'tijd');
  assert.equal(st.fx.plekNaam(5), null);
  assert.equal(st.fx.mix, 0);
  assert.equal(st.fx.keten, null, 'lui: geen keten zolang de mix dicht is');
  // Van de ingang bereikbaar: alleen de nodes van de strip, de meter, en de mixer.
  const bij = bereikbaar(omg, n.in);
  const strip = new Set(Object.values(n));
  for (const x of bij) {
    const ok = strip.has(x) || x.soort === 'splitter' || x.soort === 'analyser' || x === m.in || bereikbaar(omg, m.in).has(x);
    assert.ok(ok, `extra node in het pad: ${x.soort}`);
  }
  assert.ok(!omg.uitVan(n.droog).some((l) => l.naar === st.fx.in), 'de natte weg is nog niet aangesloten');
  assert.deepEqual(omg.uitVan(n.fader).map((l) => l.naar), [n.kant], 'de fader gaat alleen naar de kant (geen sends)');
  assert.equal(n.naFilter.gain.oproepen.length, 0, 'de droge weg (naFilter) is nooit aangeraakt');
  // Aan de knoppen draaien, aan/uit, een ander rack: zolang de mix dicht is gebeurt er in het pad niets.
  st.fx.setPlek(1, 0.8); st.fx.setBypass(true); st.fx.setBypass(false);
  st.fx.zetRack(effectRack('phaser'));
  assert.equal(st.fx.keten, null);
  assert.equal(n.naFilter.gain.oproepen.length, 0);
  assert.equal(omg.bronnen.length, 0, 'geen oscillator van de phaser gestart');
  // De sends op 0: niets ingestuurd, geen bus op de master.
  st.send('a', 0); st.send('B', 0);
  assert.ok(!m.sendAan('A') && !m.sendAan('B'));
  assert.equal(omg.naar(m.in).length, 1, 'de master heeft alleen de strip als ingang');
  schoon(omg);
});

function effectRack(id) {
  const e = effectVan(id);
  return { schema: 1, name: e.naam, chain: [{ slot: 'a', type: id, params: { ...e.standaard } }],
    macros: e.params.map((p, i) => ({ place: i + 1, label: p, default: e.standaard[p], links: [{ target: `a.${p}`, from: 0, to: 1 }] })) };
}

// ---- met effect ---------------------------------------------------------------------------

test('mix open: de keten wordt gebouwd, de natte weg tapt het filter en komt op de fader (en de meter)', () => {
  const { omg, ctx, st, n } = opzet();
  omg.nu = 1;
  st.fx.setMix(0.5);
  assert.ok(st.fx.keten, 'nu is er een keten');
  assert.ok(omg.heeft(n.droog, st.fx.in) && omg.heeft(n.nat, st.fx.in), 'droog en nat van het filter naar de slot');
  assert.ok(omg.heeft(st.fx.keten.gain, n.fader), 'de keten komt op de fader uit');
  const split = omg.uitVan(n.naFilter).map((l) => l.naar).find((x) => x.soort === 'splitter');
  assert.ok(omg.heeft(st.fx.keten.gain, split), 'en de meter leest de som (vóór de fader)');
  // Equal-power: droog = cos, nat = sin; de droge weg is naFilter.
  assert.ok(dicht(n.naFilter.gain.waarde(2), Math.SQRT1_2, 1e-6), `droog ${n.naFilter.gain.waarde(2)}`);
  assert.ok(dicht(st.fx.keten.gain.gain.waarde(2), Math.SQRT1_2, 1e-6));
  assert.deepEqual(st.fx.keten.gain.gain.sprongen(1), [], 'de natte weg vloeit in (vanaf zijn begin op 0)');
  // Dicht en weer open: dezelfde keten, de knoppen blijven.
  const k = st.fx.keten;
  st.fx.setMix(0); omg.nu = 3; st.fx.setMix(1);
  assert.equal(st.fx.keten, k);
  assert.ok(dicht(n.naFilter.gain.waarde(4), 0, 1e-6) && dicht(k.gain.gain.waarde(4), 1, 1e-6), 'helemaal nat = droog precies 0');
  void ctx;
  schoon(omg);
});

test('aan/uit: uit = droog (de mix blijft staan), en een leeg rack is altijd droog', () => {
  const { omg, st, n } = opzet();
  omg.nu = 1;
  st.fx.setMix(1);
  st.fx.setBypass(true);
  assert.ok(dicht(n.naFilter.gain.waarde(2), 1, 1e-6) && dicht(st.fx.keten.gain.gain.waarde(2), 0, 1e-6));
  assert.equal(st.fx.mix, 1);
  st.fx.setBypass(false);
  omg.nu = 2;
  st.fx.zetRack({ schema: 1, name: 'leeg', chain: [], macros: [] });
  assert.equal(st.fx.heeftEffect, false);
  assert.ok(dicht(n.naFilter.gain.waarde(3), 1, 1e-6), 'zonder effect geen volumeverlies, ook met de mix open');
  schoon(omg);
});

test('wisselen midden in het spelen: twee ketens, equal-power, geen curve, de oude na fade + staart weg (vernietig)', async () => {
  const { omg, st } = opzet();
  omg.nu = 1;
  st.fx.zetRack(effectRack('phaser'));
  st.fx.setMix(0.6);
  const oud = st.fx.keten;
  const osc = omg.bronnen.filter((b) => b.soort === 'oscillator');
  assert.ok(osc.length >= 1, 'de phaser heeft een LFO');
  omg.nu = 1.5;
  st.fx.zetRack(effectRack('filter'));
  assert.notEqual(st.fx.keten, oud);
  assert.ok(st.fx.oud.includes(oud), 'de oude keten is niet meteen weg');
  // Snel nog eens wisselen, en aan de mix draaien midden in de fade: geen NotSupportedError, geen breuk.
  omg.nu = 1.51; st.fx.zetRack(effectRack('crush'));
  omg.nu = 1.52; st.fx.setMix(0.3);
  const d = startDrempel(st.ctx);
  assert.ok(oud.gain.gain.waarde(1.5 + d + FADE + 0.001) < 1e-6, 'de oude is na de fade stil');
  assert.deepEqual(oud.gain.gain.sprongen(1.4), [], 'zonder sprong eruit');
  omg.nu = 3;
  await wacht((d + FADE + 0.05 + 0.1) * 1000 + 100);
  assert.ok(!st.fx.oud.includes(oud), 'opgeruimd');
  assert.ok(osc.every((o) => o.gestopt !== null), 'en zijn LFO is gestopt (vernietig)');
  schoon(omg);
});

test('vernietig van de strip: de slot en de sends mee weg, oscillatoren gestopt', async () => {
  const { omg, m, st, n } = opzet();
  omg.nu = 1;
  st.fx.zetRack(effectRack('ringmod'));
  st.fx.setMix(0.5);
  st.send('a', 0.5);
  const osc = omg.bronnen.filter((b) => b.soort === 'oscillator');
  const keten = st.fx.keten;
  omg.nu = 2;
  const weg = st.vernietig();
  omg.nu = 3;
  await wacht(80);
  await weg;
  assert.ok(osc.length && osc.every((o) => o.gestopt !== null), 'de oscillator van de ringmod is gestopt');
  assert.equal(omg.uitVan(keten.gain).length, 0, 'de keten is los');
  assert.equal(omg.uitVan(st.fx.in).length, 0);
  for (const node of Object.values(n)) assert.equal(omg.uitVan(node).length, 0, `${node.soort} los`);
  assert.ok(st.fx.weg);
  void m;
});

// ---- de sends ------------------------------------------------------------------------------------

test('send A en B: na de fader, kwadratisch, naar twee gedeelde bussen op de master (vóór de limiter), helemaal nat', () => {
  const omg = new NepOmgeving();
  const m = maakMixer(omg.ctx, { limiter: false });
  const a = maakStrip(omg.ctx, m), b = maakStrip(omg.ctx, m);
  omg.nu = 1;
  assert.equal(sendGain(0.5), 0.25);
  a.send('a', 0.5);
  assert.ok(m.sendAan('A') && !m.sendAan('B'), 'alleen de echo is wakker');
  const bus = m.sends.A;
  const g = omg.uitVan(a.nodes.fader).map((l) => l.naar).find((x) => x !== a.nodes.kant);
  assert.ok(g && omg.heeft(g, bus.in), 'fader -> send -> bus');
  assert.ok(dicht(g.gain.waarde(2), 0.25, 1e-6), 'kwadratisch');
  assert.ok(omg.heeft(bus.out, m.in), 'de bus komt uit op de master (vóór de limiter)');
  assert.ok(bus.keten, 'en zijn keten is gebouwd');
  assert.equal(bus.rackNaam, 'Echo');
  assert.equal(bus.mix, 1);
  assert.equal(bus.dry.gain.waarde(2), 0, 'helemaal nat: geen droog signaal op de bus');
  b.send('A', 1);
  assert.ok(omg.uitVan(b.nodes.fader).some((l) => omg.heeft(l.naar, bus.in)), 'de tweede track op dezelfde bus');
  a.send('b', 0.2);
  assert.equal(m.sends.B.rackNaam, 'Galm');
  assert.equal(m.sends.B.paramWaarde('a', 'meng'), 1, 'de galm op de bus: meng op vol');
  assert.equal(a.lees('send.a'), 0.5);
  a.send('a', 0);
  assert.ok(g.gain.waarde(3) < 1e-6, 'op 0: niets meer ingestuurd');
  // Een tweede druk op 0 of een NaN: niets.
  assert.equal(a.send('a', NaN), false);
  assert.throws(() => a.send('c', 1), TypeError);
  schoon(omg);
});

test('SEND_RACKS zoals v1: echo op de maat op 1/4 tel, galm met grootte/toon/vasthouden', () => {
  assert.deepEqual(SEND_RACKS.A.chain[0].params, { tijd: 3 / 7, feedback: 0.5, toon: 0.5, sync: 1 });
  assert.equal(SEND_RACKS.B.chain[0].type, 'reverb');
  for (const r of Object.values(SEND_RACKS)) assert.deepEqual(leesRack(r, { bekendType: (t) => !!effectVan(t) }).fouten, []);
});

// ---- de maatklok als klok van de effecten -----------------------------------------------------------

test('fxKlokVan: de momentopname van v1 uit de maatklok (anker, tellengte, tellen tot de "1")', () => {
  const omg = new NepOmgeving();
  const klok = new Klok();
  const k = fxKlokVan(klok, omg.ctx);
  assert.equal(k(), null, 'de klok loopt niet: geen klok');
  klok.start(0, 0, 120);
  omg.nu = 0.1;
  let s = k();
  assert.ok(dicht(s.ankerCtx, 0.5) && dicht(s.beatLengte, 0.5) && s.tellenTotEen === 3 && s.perMaat === 4, JSON.stringify(s));
  omg.nu = 1.9;
  s = k();
  assert.ok(dicht(s.ankerCtx, 2) && s.tellenTotEen === 0, 'het anker IS de "1"');
  omg.nu = 2;
  assert.ok(dicht(k().ankerCtx, 2), 'precies op de tel: die tel');
  // Met vertraging: het signaal loopt achter, dus de tel valt later.
  const kv = fxKlokVan(klok, omg.ctx, { vertraging: () => 0.02 });
  omg.nu = 2.01;
  assert.ok(dicht(kv().ankerCtx, 2.02), 'tel 4 van het signaal valt op 2,02');
  // Een tempowissel binnen de tel: de tellengte is die tot de tel erna.
  omg.nu = 2.1;
  klok.houd(2.6, 60);       // halverwege tel 5 → 6 naar 60 bpm
  s = k();
  assert.ok(dicht(s.ankerCtx, 2.5) && dicht(s.beatLengte, 0.9), `tel 5 op 2,5 s, en hij duurt tot tel 6 (${s.ankerCtx}, ${s.beatLengte})`);
  klok.stop();
  assert.equal(k(), null);
});

test('herankeren: op elke "verander" van de klok, en op een knikpunt van richt() zonder event', async () => {
  const omg = new NepOmgeving();
  const klok = new Klok();
  klok.start(0, 0, 120);
  let n = 0;
  const af = volgKlok(klok, omg.ctx, () => { n++; });
  klok.houd(1, 126);
  assert.equal(n, 1);
  omg.nu = 1.5;
  klok.richt({ a: 2, L: 60 / 128 }, 1.6);
  assert.equal(n, 2);
  const knik = volgendKnikpunt(klok, omg.ctx.currentTime + 0.2);
  assert.ok(knik > 1.6, 'richt heeft een knikpunt na zijn begin');
  omg.nu = knik + 0.01;
  await wacht(300);
  assert.ok(n >= 3, `op het knikpunt nog eens (${n})`);
  af();
  klok.houd(10, 100);
  assert.ok(n <= 4, 'na af() niets meer');
});

test('een slot op de maatklok: de echo op 1/4 tel staat op 0,5 s bij 120 bpm, en volgt een tempowissel', async () => {
  const omg = new NepOmgeving();
  const klok = new Klok();
  klok.start(0, 0, 120);
  const slot = new InsertSlot(omg.ctx);
  slot.setKlok(klok);
  slot.setMix(1);
  omg.nu = 0.3;
  slot.zetRack(SEND_RACKS.A);
  const kop = () => slot.keten.node.slots.get('a').inst._kop();
  assert.ok(dicht(kop().tijden[kop().actief], 0.5), `1/4 tel = 0,5 s (${kop().tijden})`);
  omg.nu = 1;
  klok.houd(1.01, 100);     // de engine zet dit op 'straks'
  omg.nu = 1.2;
  slot.heranker();          // zoals volgKlok op het knikpunt (of de 'verander' zelf, als het anker al na de wissel ligt)
  await wacht(250);
  const k = kop();
  assert.ok(dicht(k.tijden[k.actief], 0.6), `100 bpm: 0,6 s (${k.tijden})`);
  slot.vernietig();
});

// ---- v1's harde regels, op de effecten zelf ---------------------------------------------------------

test('elk filter in een terugkoppellus heeft een negatieve Q (Q is in dB: een bult laat de lus aanzwellen)', () => {
  for (const id of ['reverb', 'delay']) {
    const omg = new NepOmgeving();
    const filters = [];
    const maak = omg.ctx.createBiquadFilter.bind(omg.ctx);
    omg.ctx.createBiquadFilter = () => { const b = maak(); filters.push(b); return b; };
    const e = effectVan(id).bouw(omg.ctx);
    for (const [p, v] of Object.entries(effectVan(id).standaard)) e.zet(p, v, 0);
    const lp = filters.filter((f) => f.type === 'lowpass');
    assert.ok(lp.length && lp.every((f) => f.Q.value < -3), `${id}: ${lp.map((f) => f.Q.value)}`);
    e.vernietig?.();
  }
});

test('de galm (FDN): acht lijnen, gain per rondgang volgt RT60 (−60 dB in de beloofde tijd), freeze houdt vast', () => {
  const omg = new NepOmgeving();
  const r = effectVan('reverb').bouw(omg.ctx);
  for (const [p, v] of Object.entries(effectVan('reverb').standaard)) r.zet(p, v, 0);
  omg.nu = 5;               // de mock rekent setTargetAtTime echt uit: na 100 τ staat hij er
  const st = r._staat();
  assert.equal(st.gains.length, 8);
  // Na rt60 seconden is elke lijn 60 dB zachter: g^(rt60 / lengte) = 0,001.
  const LENGTES = [29.7, 37.1, 41.1, 43.7, 53.9, 61.3, 67.9, 73.1];
  st.gains.forEach((g, i) => assert.ok(Math.abs(Math.pow(g, st.rt60 / (LENGTES[i] / 1000)) - 0.001) < 1e-6));
  r.zet('freeze', 1, 5);
  omg.nu = 10;
  assert.ok(r._staat().invoer < 1e-9 && r._staat().gains.every((g) => g > 0.999 && g < 1));
  r.vernietig();
});

test('delaytijd zonder doppler: een nieuwe tijd op de stille kop, en daarheen gevloeid; snel draaien = de laatste stand', async () => {
  const omg = new NepOmgeving();
  const d = effectVan('delay').bouw(omg.ctx);
  omg.nu = 100;
  d.zet('tijd', 0.35, 100);
  let k = d._kop();
  assert.ok(k.tijden[0] === k.tijden[1] && k.gains[0] === 1 && k.gains[1] === 0, 'bij het bouwen: beide koppen gelijk');
  d.zet('tijd', 0.8, 100);
  k = d._kop();
  assert.ok(k.actief === 1 && Math.abs(k.tijden[0] - k.tijden[1]) > 0.1, 'de nieuwe tijd op de andere kop');
  const oude = k.tijden[0];
  omg.nu = 100.01; d.zet('tijd', 0.2, 100.01);
  omg.nu = 100.02; d.zet('tijd', 0.5, 100.02);
  assert.equal(d._kop().tijden[0], oude, 'tijdens de fade: niets over elkaar heen');
  omg.nu = 100.3;
  await wacht(200);
  k = d._kop();
  assert.ok(k.actief === 0 && dicht(k.tijden[0], 0.02 * Math.pow(60, 0.5)), 'daarna de LAATSTE stand');
  // Geen enkele delayTime die glijdt: alleen setValueAtTime op een stille kop.
  d.vernietig();
});

test('elk effect bouwt, laat zich aan alle knoppen draaien en ruimt op in de v2-mock (zonder curve)', () => {
  const omg = new NepOmgeving();
  globalThis.AudioWorkletNode ??= class {};
  for (const e of EFFECTEN) {
    const inst = e.bouw(omg.ctx, { klok: () => ({ beatLengte: 0.5, ankerCtx: 1, tellenTotEen: 1, perMaat: 4 }) });
    for (const p of e.params) for (const v of [0, 0.5, 1]) inst.zet(p, v, omg.nu);
    assert.ok(inst.staart() >= 0, e.id);
    inst.vernietig?.();
  }
  assert.equal(omg.stats.CURVES, 0);
  assert.equal(omg.stats.OVERLAP_FOUTEN, 0);
});

// ---- racks ---------------------------------------------------------------------------------------

test('een rack in de vorm van het bouwplan (naam, keten, koppelingen) leest als v1, en schrijft terug als v1', () => {
  const bp = { schema: 1, naam: 'Dub', mix: 0.4,
    keten: [{ type: 'filter', params: { freq: 0.5 } }, { type: 'delay', params: { tijd: 0.3 } }],
    macros: [{ naam: 'diepte', standaard: 0.2, koppelingen: [{ slot: 1, param: 'feedback', van: 0, tot: 0.9 }, { slot: 'a', param: 'reso', van: 0.1, tot: 0.6, curve: 'exp' }] }] };
  assert.ok(isBouwplanVorm(bp));
  const { rack, fouten } = leesRack(bp, { bekendType: (t) => !!effectVan(t) });
  assert.deepEqual(fouten, []);
  assert.equal(rack.name, 'Dub');
  assert.deepEqual(rack.chain.map((n) => [n.slot, n.type]), [['a', 'filter'], ['b', 'delay']]);
  assert.deepEqual(rack.macros[0].links.map((l) => [l.target, l.from, l.to, l.curve]), [['b.feedback', 0, 0.9, undefined], ['a.reso', 0.1, 0.6, 'exp']]);
  assert.equal(rack.macros[0].default, 0.2);
  assert.equal(rack.out.mix, 0.4);
  const terug = schrijfRack(rack);
  assert.ok(Array.isArray(terug.chain) && !('keten' in terug) && terug.name === 'Dub');
  // En hij klinkt: in een slot op knop 1.
  const omg = new NepOmgeving();
  const slot = new InsertSlot(omg.ctx);
  slot.zetRack(bp);
  slot.setPlek(1, 1);
  assert.ok(dicht(slot.paramWaarde('b', 'feedback'), 0.9));
  slot.vernietig();
});

test('een onbekend effect blijft als ruwe JSON bewaard (staat uit, komt er ongeschonden weer uit)', () => {
  const data = { schema: 1, name: 'toekomst', chain: [{ slot: 'a', type: 'spectral.freeze', params: { x: 0.3 }, iets: [1, 2] }, { slot: 'b', type: 'filter', params: {} }], macros: [] };
  const { rack, fouten } = leesRack(data, { bekendType: (t) => !!effectVan(t) });
  assert.ok(fouten.some((f) => f.includes('spectral.freeze')));
  assert.ok(rack.chain[0].onbekend && rack.chain[0].bypass);
  const terug = schrijfRack(rack);
  assert.deepEqual(terug.chain[0], { slot: 'a', type: 'spectral.freeze', params: { x: 0.3 }, iets: [1, 2] });
  // In een strip: de slot kent het niet, klinkt met wat hij wel kent.
  const { omg, st } = opzet();
  omg.nu = 1;
  st.fx.zetRack(data);
  st.fx.setMix(0.5);
  assert.deepEqual([...st.fx.keten.node.slots.keys()], ['b']);
  assert.equal(schrijfRack(st.fx.rack).chain[0].type, 'spectral.freeze');
});
