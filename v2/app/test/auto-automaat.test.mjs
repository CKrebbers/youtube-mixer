// De auto-DJ op een echte engine met nep-audio (test/nep-audio.mjs): van stilte tot een hele
// overgang via de bus met bron 'auto', op de "1" van de klok, nooit twee bassen, nooit stilte,
// en Clay die overneemt. De garanties van v1 test/auto.test.mjs §2–3, op de maatklok van v2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { Automaat, CLAY_RECENT, neemtOver } from '../src/auto/automaat.js';
import { definieerAuto } from '../src/engine/acties-auto.js';
import { maakLaad } from '../src/ui/auto-paneel.js';
import { basOpen, FRASE } from '../src/auto/planner.js';
import { nepCtx, nepAudio, nepNummer } from './nep-audio.mjs';

const STAP = 0.04;
const slaap = () => new Promise((r) => setImmediate(r));

/** Een library (zekere grids, ander anker en tempo), een engine en een automaat; laden zoals de app (via de bus). */
async function opzet(nummers, { rnd = () => 0 } = {}) {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: nepAudio(), timer: false });
  await e.klaar;
  const lijst = new Map(nummers.map((x) => [x.id, x]));
  const library = { laadOp: (n, id) => e.bus.doe(`track.${n}.laad`, { ...lijst.get(id), zeker: true }) };
  const a = new Automaat({ engine: e, nummers: () => nummers, laad: maakLaad({ engine: e, library }), tijd: null, rnd });
  definieerAuto(e.bus, a);
  const log = [];
  e.bus.on('actie', (x) => log.push({ t: ctx.currentTime, id: x.id, v: x.v, bron: x.bron }));
  const meting = { tweeBassen: 0, stil: 0, stappen: 0, begonnen: false };
  const zet = async (t) => {
    ctx.currentTime = t;
    e.tik();
    a.tik();
    for (let i = 0; i < 3; i++) await slaap();
    // Wat de zaal krijgt na deze tik: hoeveel tracks spelen hoorbaar met hun bas open?
    const open = e.tracks.filter((x) => x.speeltOp(t) && e.hoorbaar(x.n) && x.plek(t) < x.nummer.duur
      && basOpen({ fader: x.strip.lees('fader'), laag: x.strip.lees('laag'), filter: x.strip.lees('filter') }));
    if (open.length > 1) meting.tweeBassen++;
    const klinkt = e.tracks.some((x) => x.speeltOp(t) && e.hoorbaar(x.n) && x.plek(t) < x.nummer.duur);
    if (klinkt) meting.begonnen = true; else if (meting.begonnen) meting.stil++;
    meting.stappen++;
  };
  let nu = 0;
  // Tot `tot` (s audioklok), of tot `elke` ja zegt (dan staat de tijd net na die tik).
  const loop = async (tot, elke = null) => {
    while (nu < tot - 1e-9) { await zet(nu); nu += STAP; if (elke?.() === true) break; }
    return nu;
  };
  return { e, ctx, a, bus: e.bus, log, meting, loop, nu: () => nu };
}

const lib = () => [
  { ...nepNummer({ id: 'a', bpm: 124, anker: 0.3, duur: 120 }), toon: 'Am' },
  { ...nepNummer({ id: 'b', bpm: 125, anker: 0.21, duur: 120 }), toon: 'Em' },
  { ...nepNummer({ id: 'c', bpm: 123, anker: 0.1, duur: 120 }), toon: 'Am' },
];

test('auto-automaat: van stilte meteen iets laten klinken, en de volgende klaarzetten', async () => {
  const { a, e, log, loop } = await opzet(lib());
  await a.aan();
  await loop(1);
  assert.equal(a.hoofd, 1, 'iets klinkt op track 1');
  assert.ok(e.track(1).speelt);
  assert.ok(e.klok.loopt, 'de klok begint bij het eerste nummer');
  assert.equal(e.track(1).gekoppeld, true, 'op de klok, zodat er straks gemixt kan worden');
  assert.equal(a.fase, 'klaar');
  assert.equal(a.volgende.n, 2, 'de volgende op een andere track');
  assert.equal(e.track(2).speelt, false, 'die staat stil klaar');
  assert.equal(e.track(2).strip.lees('fader'), 0, 'met de fader dicht');
  assert.equal(e.track(2).kant, e.track(1).kant, 'dezelfde crossfaderkant als wat klinkt');
  const vanMij = log.filter((x) => x.bron === 'auto');
  assert.ok(vanMij.some((x) => x.id === 'track.1.play'), 'play ging over de bus');
  assert.ok(log.filter((x) => !x.id.endsWith('.laad')).every((x) => x.bron === 'auto'), 'alles wat hij deed staat met bron auto op de bus');
});

test('auto-automaat: een hele blend op de "1" van de klok, nooit twee bassen, nooit stilte', async () => {
  const { a, e, log, loop, meting, nu } = await opzet(lib());
  await a.aan();
  await loop(1);
  const v = a.volgende;
  assert.equal(v.overgang.type, 'blend', v.overgang.redenen.join(', '));
  const m = { ...v.moment };
  assert.equal(m.opKlok, true);
  assert.equal(m.start % (4), 0, 'het begin is een "1" van de klok');
  assert.ok(m.start % (FRASE * 4) === 0 || m.start % 16 === 0, `frasegrens: ${m.start}`);
  // Laten lopen tot de nieuwe op de maat wacht: hij valt in op de "1" die het begin IS.
  await loop(200, () => e.track(2).wacht !== null);
  const vak = e.track(2).vakken.find((x) => x.soort === 'gekoppeld');
  assert.equal(vak.vanTel, m.start, 'start op de klok-tel van het begin');
  const t1 = e.klok.tijd(m.start);
  const g = e.track(2).grid;
  const plek = e.track(2).plek(t1 + 1e-6);
  assert.ok(Math.abs(plek - v.van) < 1e-3, `op zijn beginpunt (${plek} ≈ ${v.van})`);
  assert.ok(Math.abs(g.barPhase(plek)) < 1e-3 || Math.abs(g.barPhase(plek) - 1) < 1e-3, 'en dat is een "1" van het nummer');
  // De rest van de overgang.
  await loop(200, () => a.fase === 'wacht' && a.hoofd === 2);
  assert.equal(a.hoofd, 2, 'de nieuwe is de hoofdtrack');
  assert.equal(e.track(1).speelt, false, 'de oude staat stil');
  assert.equal(e.track(2).strip.lees('fader'), 1);
  assert.equal(e.track(2).strip.lees('laag'), 0.5);
  assert.equal(e.track(1).strip.lees('fader'), 0);
  assert.equal(meting.tweeBassen, 0, 'nooit twee bassen');
  assert.equal(meting.stil, 0, 'nooit stilte');
  // De curve ging over de bus met bron auto, en alleen wat veranderde.
  const fader2 = log.filter((x) => x.id === 'track.2.fader' && x.bron === 'auto');
  assert.ok(fader2.length > 50, `de fader van de nieuwe ging open in stappen (${fader2.length})`);
  for (let i = 1; i < fader2.length; i++) assert.notEqual(fader2[i].v, fader2[i - 1].v, 'geen herhaling van dezelfde waarde');
  const bas = log.filter((x) => x.id.endsWith('.laag') && x.bron === 'auto' && x.t >= t1);
  const wissel = bas.filter((x) => x.id === 'track.1.laag' && x.v === 0)[0];
  const open = bas.filter((x) => x.id === 'track.2.laag' && x.v === 0.5)[0];
  assert.ok(wissel && open && wissel.t === open.t, 'de bas wisselt voor beide in dezelfde tik');
  assert.ok(log.indexOf(log.find((x) => x === wissel)) < log.indexOf(log.find((x) => x === open)), 'eerst dicht, dan open');
  const midden = e.klok.tijd(m.start + m.lengte / 2);
  assert.ok(wissel.t >= midden - 0.05 && wissel.t <= midden + 0.05, `de wissel in het midden (${wissel.t} ≈ ${midden})`);
  // Daarna gaat hij verder: de volgende op de vrijgekomen track.
  await loop(nu() + 2);
  assert.equal(a.volgende?.n, 1, 'heen en weer, zoals twee decks');
});

test('auto-automaat: Clay neemt over — raakt hij een track in de overgang aan, dan laat de automaat los', async () => {
  const { a, e, bus, log, loop, nu } = await opzet(lib());
  await a.aan();
  await loop(200, () => a.fase === 'bezig');
  await loop(nu() + 2);
  bus.doe('track.2.fader', 0.3);                 // Clay (bron 'scherm')
  assert.equal(a.fase, 'overgenomen');
  const t0 = nu();
  await loop(t0 + 10);
  const daarna = log.filter((x) => x.t > t0 && x.bron === 'auto');
  assert.equal(daarna.length, 0, `na de overname stuurt de automaat niets meer (${daarna.map((x) => x.id).join(', ')})`);
  // Clay maakt het af: de oude dicht. Er klinkt weer één track: de automaat gaat verder.
  bus.doe('track.1.fader', 0);
  bus.doe('track.2.fader', 1);
  await loop(nu() + 2);
  assert.equal(a.hoofd, 2);
  assert.notEqual(a.fase, 'overgenomen');
  // Kijken neemt niets over, en een track die niet meedoet ook niet.
  assert.equal(neemtOver('track.2.focus'), null);
  assert.deepEqual(neemtOver('track.2.kill.laag'), { n: 2 });
  assert.deepEqual(neemtOver('mixer.xfader'), { n: null });
  assert.equal(neemtOver('track.2.fx.knop.1'), null);
  assert.deepEqual(neemtOver('track.2.iets', { overneem: true }), { n: 2 }, 'de definitie kan het zelf zeggen');
  assert.equal(neemtOver('track.2.fader', { overneem: false }), null);
});

test('auto-automaat: de crossfader van Clay tijdens de overgang = overgenomen', async () => {
  const { a, bus, loop } = await opzet(lib());
  await a.aan();
  await loop(200, () => a.fase === 'bezig');
  bus.doe('mixer.xfader', 0.4);
  assert.equal(a.fase, 'overgenomen');
});

test(`auto-automaat: een track die Clay de laatste ${CLAY_RECENT} s aanraakte laadt en start hij niet`, async () => {
  const { a, e, bus, loop, nu } = await opzet(lib());
  bus.doe('track.2.filter', 0.6);              // Clay draait aan track 2 (niets geladen)
  bus.doe('track.3.focus', true);              // kijken telt niet
  await a.aan();
  await loop(1);
  assert.equal(a.hoofd, 1);
  assert.equal(a.volgende.n, 3, 'niet op track 2: daar zat Clay net aan');
  assert.equal(e.track(2).geladen, false);
  // Laadt Clay zelf iets op een track, dan is die van hem (ook na 120 s).
  bus.doe('track.4.laad', { ...nepNummer({ id: 'eigen', duur: 60 }), zeker: true });
  await loop(nu() + 0.2);
  assert.ok(a._vanClay(4));
  assert.ok(a._vanClay(2));
  await loop(CLAY_RECENT + 5);
  assert.equal(a._vanClay(2), false, 'na 120 s mag track 2 weer');
  assert.equal(a._vanClay(4), true, 'wat Clay laadde blijft van hem');
});

test('auto-automaat: nooit stilte — zet Clay alles stil, dan start de klaarstaande meteen', async () => {
  const { a, e, bus, loop, nu, meting } = await opzet(lib());
  await a.aan();
  await loop(5);
  assert.equal(a.fase, 'klaar');
  bus.doe('track.1.play', true);               // Clay: pauze op wat klinkt (geen overgang: geen overname)
  assert.equal(e.track(1).speelt, false);
  await loop(nu() + 0.1);
  assert.ok(e.track(2).speelt, 'de klaarstaande speelt meteen');
  assert.equal(a.hoofd, 2);
  assert.ok(meting.stil <= 1, `hooguit één tik stil (${meting.stil})`);
});

test('auto-automaat: ok, overslaan, langer en nu over de bus', async () => {
  const { a, bus, loop } = await opzet([...lib(), { ...nepNummer({ id: 'd', bpm: 124, duur: 120 }), toon: 'Am' }]);
  await a.aan();
  await loop(1);
  assert.equal(bus.lees('auto.aan'), 1);
  assert.equal(bus.lees('auto.ok'), 0);
  bus.doe('auto.ok', true);
  assert.equal(a.volgende.bevestigd, true);
  assert.equal(bus.lees('auto.ok'), 1);
  const s0 = a.volgende.moment.start;
  bus.doe('auto.langer', true);
  // Langer kan alleen als het nog past; zo niet, dan blijft het staan met een melding.
  const s1 = a.volgende.moment.start;
  assert.ok(s1 === s0 + 32 || (s1 === s0 && /langer kan niet/.test(a.melding?.tekst ?? '')), `langer: ${s0} → ${s1}`);
  bus.doe('auto.nu', true);
  const s2 = a.volgende.moment.start;
  assert.equal(s2 % 16, 0, 'nu: een 4-maatsgrens');
  assert.ok(s2 < s0, `nu is eerder (${s2} < ${s0})`);
  assert.equal(a.stand().volgende.nu, true);
  const eerst = a.volgende.nummer.id;
  bus.doe('auto.overslaan', true);
  assert.equal(a.volgende, null);
  await loop(2);
  assert.ok(a.volgende && a.volgende.nummer.id !== eerst, 'een andere');
  bus.doe('auto.aan', true);
  assert.equal(a.actief, false);
  assert.equal(bus.lees('auto.ok'), null);
});

test('auto-automaat: filter-uit bij een tempo dat te ver weg ligt: de nieuwe valt in op de "1" aan het eind', async () => {
  const nummers = [
    { ...nepNummer({ id: 'a', bpm: 124, anker: 0.3, duur: 120 }), toon: 'Am' },
    { ...nepNummer({ id: 'snel', bpm: 140, anker: 0.05, duur: 120 }), toon: 'Am' },
  ];
  const { a, e, loop, meting } = await opzet(nummers);
  await a.aan();
  await loop(1);
  assert.equal(a.volgende.overgang.type, 'filter');
  const m = { ...a.volgende.moment };
  await loop(200, () => e.track(2).wacht !== null);
  const vak = e.track(2).vakken.find((x) => x.soort === 'gekoppeld');
  assert.equal(vak.vanTel, m.start + m.lengte, 'op de "1" aan het eind van de overgang');
  await loop(200, () => a.hoofd === 2);
  assert.equal(e.track(1).speelt, false);
  assert.equal(meting.tweeBassen, 0);
  assert.equal(meting.stil, 0);
});

test('auto-automaat: beatloos overvloeien uit een nummer zonder grid, nooit twee bassen', async () => {
  const pad = { id: 'pad', titel: 'pad', duur: 90, grid: null, toon: 'D', haal: async () => ({ sr: 48000, kanalen: 2, frames: 90 * 48000, paginas: [] }) };
  const nummers = [pad, { ...nepNummer({ id: 'b', bpm: 124, anker: 0.2, duur: 120 }), toon: 'D' }];
  const { a, e, loop, meting, log } = await opzet(nummers, { rnd: () => 0.99 });
  // Het pad speelt al (Clay zette het aan) en de automaat neemt het over.
  await e.laad(1, pad);
  e.bus.doe('track.1.play', true);
  await a.aan();
  await loop(1);
  assert.equal(a.hoofd, 1);
  assert.equal(a.volgende.overgang.type, 'ambient');
  assert.equal(a.volgende.moment.opKlok, false);
  await loop(120, () => a.hoofd === 2 && a.fase === 'wacht');
  assert.equal(a.hoofd, 2);
  assert.equal(meting.tweeBassen, 0, 'ook beatloos nooit twee bassen');
  assert.equal(meting.stil, 0);
  assert.ok(log.some((x) => x.id === 'track.1.filter' && x.bron === 'auto' && x.v < 0.25), 'de uitgaande sloot met een lowpass');
});

test('auto-automaat: in het handelingenlog staat wat de automaat deed, met bron auto', async () => {
  const { a, e, loop } = await opzet(lib());
  e.log.start('set-20261020-120000');
  await a.aan();
  await loop(100, () => a.hoofd === 2);
  const regels = e.log._buf.trim().split('\n').slice(1).map((r) => JSON.parse(r));
  const acties = regels.filter(Array.isArray);
  const auto = acties.filter((r) => r[3]?.bron === 'auto');
  assert.ok(auto.length > 100, `regels van de automaat: ${auto.length}`);
  assert.ok(auto.some((r) => r[1] === 'track.2.play.quant'), 'de start op de maat');
  assert.ok(auto.some((r) => r[1] === 'track.1.laag' && r[2] === 0), 'de baswissel');
  assert.ok(regels.some((r) => r.laad?.n === 2), 'en de laad als regel');
});

test('auto-automaat: laadt Clay iets anders op de klaarstaande track, dan kiest de automaat opnieuw', async () => {
  const { a, e, bus, loop, nu } = await opzet([...lib(), { ...nepNummer({ id: 'd', bpm: 124, duur: 120 }), toon: 'Am' }]);
  await a.aan();
  await loop(1);
  assert.equal(a.volgende.n, 2);
  bus.doe('track.2.laad', { ...nepNummer({ id: 'van-clay', duur: 60 }), zeker: true });
  await loop(nu() + 0.5);
  assert.equal(e.track(2).nummer.id, 'van-clay', 'zijn nummer blijft staan');
  assert.ok(a.volgende && a.volgende.n !== 2, `de volgende op een andere track (${a.volgende?.n})`);
});

test('auto-automaat: na overvloeien naar een nummer op een ander tempo volgt de klok hem (sync.klok)', async () => {
  const pad = { id: 'pad', titel: 'pad', duur: 90, grid: null, haal: async () => ({ sr: 48000, kanalen: 2, frames: 90 * 48000, paginas: [] }) };
  const nummers = [pad, { ...nepNummer({ id: 'snel', bpm: 140, anker: 0.2, duur: 120 }) }];
  const { a, e, bus, loop, log } = await opzet(nummers);
  // De klok loopt al op 100 (een eerder nummer), het pad speelt.
  e.zetKlokTempo(100, 0);
  await e.laad(1, pad);
  bus.doe('track.1.play', true);
  await a.aan();
  await loop(120, () => a.hoofd === 2 && a.fase !== 'bezig');
  assert.equal(a.hoofd, 2);
  assert.ok(log.some((x) => x.id === 'track.2.sync.klok' && x.bron === 'auto'), 'de klok naar het nieuwe nummer');
  await loop(e.nu() + 3);
  assert.equal(e.track(2).gekoppeld, true, 'en dan is hij gekoppeld, op zijn eigen tempo');
  assert.ok(Math.abs(e.klok.bpm(e.nu()) - 140) < 1e-6, `klok ${e.klok.bpm(e.nu())}`);
});
