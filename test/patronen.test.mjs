// Patronen (docs/PATRONEN.md, STUDIO S4): het model, het venster (PPQN,
// swing, micro, omlopen), de klok (tel <-> audioklok, volgen, herankeren),
// de speler met een nep-maatgever en nep-instrumenten (starten, wisselen en
// stoppen op de maat, herankeren zonder dubbele of gemiste noten, opnemen),
// de engine met de actions, het handelingenlog en terugspelen, de mapping,
// en de opslag met versie (409). In Node, zonder browser; de echte Chrome
// meet tools/headless/patronen.mjs.
// Draai met: node test/patronen.test.mjs
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const fails = [];
const ok = (name, cond, extra = '') => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name + (extra && !cond ? ` — ${extra}` : '')); };
const dicht = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const M = await import('../src/engine/patronen/model.js');
const V = await import('../src/engine/patronen/venster.js');
const { Klok } = await import('../src/engine/patronen/klok.js');
const S = await import('../src/engine/patronen/speler.js');
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const { PPQN } = V;

// ---- 1. het model --------------------------------------------------------------
console.log('het model');
{
  const { set, fouten } = M.normaliseerSet({});
  ok('lege set: acht tracks van vijf lege plekken, tempo 120, geen fouten',
    Object.keys(set.tracks).join() === '1,2,3,4,5,6,7,8' && set.tracks['3'].length === 5 && set.tracks['3'].every((p) => p === null)
    && set.tempo === 120 && fouten.length === 0);
  const p = M.normaliseerPatroon({ id: 'p-a', lengte: 99, deling: 5, swing: 90, noten: [
    { stap: 4, noot: 38 }, { stap: 0, noot: 36, snelheid: 2, duur: -1, micro: 3 }, { stap: 0, noot: 36, snelheid: 0.5 },
    { stap: 70, noot: 36 }, { stap: 1, noot: 200 }, 'rommel'] }, { fouten: [] });
  ok('klemmen: lengte 64, deling 4, swing 75', p.lengte === 64 && p.deling === 4 && p.swing === 75);
  ok('noten: gesorteerd, één per (stap, noot) (de laatste wint), rommel weg', p.noten.length === 2
    && p.noten[0].stap === 0 && p.noten[0].snelheid === 0.5 && p.noten[1].stap === 4);
  const q = M.normaliseerPatroon({ noten: [{ stap: 0, noot: 36, snelheid: 2, duur: -1, micro: 3 }] });
  ok('snelheid ≤ 1, duur > 0 (standaard 1), micro −0,5..0,5', q.noten[0].snelheid === 1 && q.noten[0].duur === 1 && q.noten[0].micro === 0.5);
  ok('zonder id: een nieuwe "p-…"', /^p-[a-z0-9]+$/.test(q.id));
  const dubbel = M.normaliseerSet({ tracks: { 1: [{ id: 'x' }, { id: 'x' }] } });
  ok('een dubbele id in de set krijgt een nieuwe', dubbel.set.tracks['1'][0].id === 'x' && dubbel.set.tracks['1'][1].id !== 'x'
    && dubbel.fouten.some((f) => /dubbel/.test(f)));
  const lijst = M.normaliseerSet({ tracks: [[{ lengte: 8 }], null, [null, null, null, null, null, { lengte: 4 }]], tempo: 400 });
  ok('tracks als lijst; meer dan vijf plekken: de rest weg; tempo geklemd (240)',
    lijst.set.tracks['1'][0].lengte === 8 && lijst.set.tracks['3'].length === 5 && lijst.fouten.some((f) => /meer dan 5/.test(f)) && lijst.set.tempo === 240);
  ok('nog eens normaliseren verandert niets', JSON.stringify(M.normaliseerSet(lijst.set).set) === JSON.stringify(lijst.set));
  ok('rommel: een lege set met een fout, geen crash', M.normaliseerSet('rommel').fouten.length === 1 && M.normaliseerSet(null).set.tracks['8'].length === 5);
  let r = M.nieuwPatroon();
  r = M.wisselNoot(r, 4, 36);
  r = M.wisselNoot(r, 4, 42);
  ok('stap voor stap: twee noten op dezelfde stap', M.notenOp(r, 4).map((n) => n.noot).join() === '36,42');
  r = M.wisselNoot(r, 4, 36);
  ok('… en nog eens dezelfde: eraf', M.notenOp(r, 4).map((n) => n.noot).join() === '42');
  ok('zonderNoot zonder noot: de hele stap leeg', M.zonderNoot(r, 4).noten.length === 0);
  ok('bewerkingen laten het oude patroon staan', r !== M.metNoot(r, { stap: 1, noot: 50 }) && r.noten.length === 1);
  ok('lengtes ◀ ▶: per stap tot 16, dan per halve maat', M.volgendeLengte(16, 1) === 20 && M.volgendeLengte(20, -1) === 16
    && M.volgendeLengte(64, 1) === 64 && M.volgendeLengte(1, -1) === 1);
}

// ---- 2. het venster ----------------------------------------------------------------
console.log('\nhet venster (Elektronlearn: PPQN, swing, micro, omlopen)');
{
  const kick = M.normaliseerPatroon({ noten: [0, 4, 8, 12].map((stap) => ({ stap, noot: 36 })) });
  const s0 = { basis: 0, start: 0, stop: Infinity };
  const alle = V.notenInVenster(kick, s0, 0, 64 * 4 * PPQN);
  ok('384 PPQN, een zestiende 96 ticks', PPQN === 384 && V.stapTicks(kick) === 96 && V.omloopTicks(kick) === 16 * 96);
  ok('64 maten kick op de tel: 256 noten, precies op elke tel', alle.length === 256 && alle.every((n, i) => n.tick === i * PPQN));
  ok('swing 50 laat alles recht; even stappen schuiven nooit', V.swingTicks(1, 50, 96) === 0 && V.swingTicks(4, 66.67, 96) === 0);
  ok('swing 66,67: de off-beat een derde stap later', dicht(V.swingTicks(1, 66.666667, 96), 32, 0.01));
  const sw = M.normaliseerPatroon({ swing: 75, noten: [{ stap: 1, noot: 42 }, { stap: 2, noot: 42 }] });
  const swn = V.notenInVenster(sw, s0, 0, V.omloopTicks(sw));
  ok('swing 75: stap 1 een halve stap later, stap 2 niet', swn[0].tick === 96 + 48 && swn[1].tick === 192);
  const mic = M.normaliseerPatroon({ noten: [{ stap: 0, noot: 36, micro: -0.25 }, { stap: 4, noot: 38, micro: 0.25 }] });
  const mn = V.notenInVenster(mic, s0, 0, 2 * V.omloopTicks(mic));
  ok('micro: een kwart stap vroeger/later', mn.find((n) => n.noot === 38 && n.omloop === 0).tick === 4 * 96 + 24);
  ok('negatieve micro op stap 0: in de eerste omloop op de start (niet ervóór)', mn[0].tick === 0 && mn[0].omloop === 0);
  ok('… en in de tweede omloop een kwart stap vóór de omloop (hij hoort bij zijn eigen omloop)',
    mn.some((n) => n.noot === 36 && n.omloop === 1 && n.tick === 16 * 96 - 24));
  // Venster voor venster = alles in één keer, met duizend willekeurige grenzen (zoals Elektronlearn).
  const vol = M.normaliseerPatroon({ swing: 61, noten: [0, 2, 3, 7, 11, 15].map((stap, i) => ({ stap, noot: 36 + i, micro: [-0.125, 0, 0.0625, -0.3125, 0.1875, 0][i] })) });
  const TOT = 32 * 4 * PPQN;
  const ref = V.notenInVenster(vol, s0, 0, TOT);
  let cur = 0, zaad = 12345;
  const stuk = [];
  while (cur < TOT) {
    zaad = (zaad * 1103515245 + 12345) & 0x7fffffff;
    const volgende = Math.min(cur + 40 + (zaad % 400) + (zaad % 7) / 3, TOT);
    stuk.push(...V.notenInVenster(vol, s0, cur, volgende));
    cur = volgende;
  }
  ok('venster voor venster: hetzelfde aantal, dezelfde ticks in dezelfde volgorde',
    stuk.length === ref.length && stuk.every((n, i) => n.tick === ref[i].tick && n.noot === ref[i].noot), `${stuk.length} vs ${ref.length}`);
  // Polymetrie: een patroon van 15 stappen naast een van 16.
  const p15 = M.normaliseerPatroon({ lengte: 15, noten: [{ stap: 0, noot: 36 }] });
  const p16 = M.normaliseerPatroon({ lengte: 16, noten: [{ stap: 0, noot: 36 }] });
  ok('lengte 15 loopt 16 keer rond in 240 stappen, lengte 16 15 keer',
    V.notenInVenster(p15, s0, 0, 240 * 96).length === 16 && V.notenInVenster(p16, s0, 0, 240 * 96).length === 15);
  // Start en stop: niets ervóór, niets erna.
  const ss = { basis: 4 * PPQN, start: 4 * PPQN, stop: 8 * PPQN };
  const sn = V.notenInVenster(kick, ss, 0, 100 * PPQN);
  ok('start en stop: precies de tellen ertussen (4 noten)', sn.length === 4 && sn[0].tick === 4 * PPQN && sn.at(-1).tick === 7 * PPQN);
  const laat = M.normaliseerPatroon({ lengte: 4, swing: 75, noten: [{ stap: 3, noot: 36, micro: 0.5 }] });
  ok('een noot die door swing en micro op de stop zou vallen: weg', V.notenInVenster(laat, { basis: 0, start: 0, stop: 4 * 96 }, 0, 1e6).length === 0);
  ok('noten voorbij de lengte klinken niet', V.notenInVenster(M.normaliseerPatroon({ lengte: 4, noten: [{ stap: 6, noot: 36 }] }), s0, 0, 1e5).length === 0);
  ok('stapOp: de stap op een tick, null vóór de start', V.stapOp(kick, ss, 4 * PPQN + 200) === 2 && V.stapOp(kick, ss, 100) === null);
  // Geen drift: 64 maten op 120 bpm, elke stap op i × 0,125 s.
  const zestienden = M.normaliseerPatroon({ noten: Array.from({ length: 16 }, (_, stap) => ({ stap, noot: 36 })) });
  let ergst = 0;
  V.notenInVenster(zestienden, s0, 0, 64 * 4 * PPQN).forEach((n, i) => { ergst = Math.max(ergst, Math.abs(n.tick / PPQN * 0.5 - i * 0.125)); });
  ok(`64 maten zestienden op 120 bpm: drift ${(ergst * 1e6).toFixed(3)} µs`, ergst < 1e-9);
}

// ---- 3. de klok ----------------------------------------------------------------------
console.log('\nde klok');
{
  const k = new Klok();
  k.zet(3.7, 0, 137.3 / 60);
  ok('tel en tijd zijn elkaars inverse', dicht(k.tel(k.tijd(9999.25)), 9999.25, 1e-6) && dicht(k.tijd(k.tel(12.3)), 12.3, 1e-9));
  k.houd(10, 2);
  ok('houd: vanaf 10 s een ander tempo, continu', dicht(k.tel(10), (10 - 3.7) * 137.3 / 60) && dicht(k.rate(11), 2) && dicht(k.tel(9), (9 - 3.7) * 137.3 / 60));
  // Richten: de klok op de tellen van een maatgever van 124 bpm, beat 0 op t = 1.
  const L = 60 / 124;
  const r = new Klok();
  r.zet(1, 0, 1 / L);
  ok('al op de lijn: richten doet niets', !r.richt({ a: 1 + 5 * L, L }, 2).veranderd);
  // Een pitchwissel: +3% vanaf t = 2 (zijn tel op 2 blijft staan).
  const L2 = L / 1.03, b2 = (2 - 1) / L;
  const a2 = 2 + (Math.ceil(b2) - b2) * L2;
  const g = r.richt({ a: a2, L: L2 }, 2.12);
  ok('pitch +3%: herankerd, N = de dichtstbijzijnde tel, de fout klein', g.veranderd && g.N === Math.ceil(b2) && Math.abs(g.fout) < 0.01);
  ok('… continu op A', dicht(r.tel(2.12 - 1e-12), r.tel(2.12), 1e-9));
  const eind = r.seg.at(-1);
  ok('… en binnen twee tellen op de nieuwe lijn', eind.T - 2.12 <= 2 * L2 + 1e-9 && dicht(eind.R, 1 / L2) && dicht(r.tel(a2 + 10 * L2), g.N + 10, 1e-9));
  ok('nog eens richten op dezelfde maatgever: niets (de overgang loopt al)', !r.richt({ a: a2 + 3 * L2, L: L2 }, 2.4).veranderd);
  // Een sprong van een halve tel: glijdt, nooit achteruit.
  const j = new Klok();
  j.zet(0, 0, 1 / L);
  const sj = j.richt({ a: 0.5 * L + 10 * L, L }, 3);
  const stijgt = [...Array(200)].every((_, i) => j.tel(3 + i * 0.01 + 0.01) > j.tel(3 + i * 0.01));
  ok('sprong van een halve tel: geglijd (continu en stijgend), daarna op de lijn', sj.veranderd && stijgt
    && dicht(j.tel(0.5 * L + 30 * L) - Math.round(j.tel(0.5 * L + 30 * L)), 0, 1e-9));
  // Maten.
  const m = new Klok();
  m.zet(0, 0, 2);
  m.zetMaat(10, 2, 4);
  ok('maten: tel 10 staat op tel 3 van zijn maat → maatbegin op 8, 12, …', m.volgendeMaat(9) === 12 && m.volgendeMaat(12) === 12 && m.volgendeMaat(8.001) === 12 && m.volgendeMaat(8 + 1e-12) === 8);
  ok('volgende tel', m.volgendeTel(3.2) === 4 && m.volgendeTel(4) === 4);
  m.houd(5, 2); m.houd(6, 3); m.houd(7, 2);
  m.ruim(6.5);
  ok('ruim: wat voorbij is weg, wat nog geldt blijft', m.seg.length === 2 && dicht(m.tel(6.6), m.tel(6) + 0.6 * 3));
}

// ---- 4. de speler, met een nep-maatgever en nep-instrumenten ---------------------------
console.log('\nde speler');

/** Een audioklok die we zelf verzetten. */
const maakCtx = () => ({ currentTime: 0, sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.02 });
/**
 * Een maatgever zoals een deck hem geeft: positie = P0 + (t − T0) × rate, een
 * grid op `bpm` met tel 0 op 0 s, en fxKlok zoals Deck.fxKlok.
 */
function maakDeck(ctx, { id = 'A', bpm = 124, P0 = 0, T0 = 0, rate = 1 } = {}) {
  const d = { id, grid: new Beatgrid({ bpm, firstBeat: 0 }), P0, T0, rate, speelt: true };
  Object.defineProperty(d, 'position', { get: () => d.P0 + (ctx.currentTime - d.T0) * d.rate });
  d.ctxTimeOf = (x) => d.T0 + (x - d.P0) / d.rate;
  d.fxKlok = () => {
    if (!d.speelt) return null;
    const n = Math.ceil(d.grid.beatAt(d.position) - 1e-9);
    return { beatLengte: (d.grid.timeOf(n + 1) - d.grid.timeOf(n)) / d.rate, ankerCtx: d.ctxTimeOf(d.grid.timeOf(n)) };
  };
  d.setRate = (r) => { d.P0 = d.position; d.T0 = ctx.currentTime; d.rate = r; };
  d.seek = (p) => { d.P0 = p; d.T0 = ctx.currentTime; };
  /** Audiokloktijd van tel b (zolang er niets verandert). */
  d.telTijd = (b) => d.ctxTimeOf(d.grid.timeOf(b));
  return d;
}
/** Een instrument dat opschrijft wat het moet doen. */
function maakInst(ctx, soort = 'poly') {
  const log = [];
  return { soort, log,
    noteOn(noot, snelheid, t) { log.push({ w: 'aan', noot, snelheid, t: t ?? ctx.currentTime, roep: ctx.currentTime }); },
    noteOff(noot, t) { log.push({ w: 'uit', noot, t: t ?? ctx.currentTime }); },
    alleUit(t) { log.push({ w: 'alleUit', t: t ?? ctx.currentTime, roep: ctx.currentTime }); },
    aan() { return log.filter((x) => x.w === 'aan'); } };
}
const IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
/** Een speler op nep-tracks: instrumenten per track, de maatgever `m` (of null). */
function maakSpeler(ctx, { m = null, inst = {} } = {}) {
  const w = { maat: m, inst };
  const sp = new S.PatroonSpeler({ ctx, ids: IDS, instrument: (id) => w.inst[id] ?? null, maat: () => S.maatVan(w.maat), elke: () => null, stopElke: () => {} });
  sp.noten = [];
  sp.onNoot = (id, n, t) => sp.noten.push({ id, ...n, t });
  return { sp, w };
}
/** De tijd laten lopen tot `tot`, met een kijkbeurt elke `stap` s (de timer). */
function loop(ctx, sp, tot, stap = 0.025, bijElke = null) {
  while (ctx.currentTime < tot - 1e-12) {
    ctx.currentTime = Math.min(tot, ctx.currentTime + stap);
    bijElke?.(ctx.currentTime);
    sp.tik();
  }
}
const KICK = { noten: [0, 4, 8, 12].map((stap) => ({ stap, noot: 36 })) };
const ZESTIENDEN = { noten: Array.from({ length: 16 }, (_, stap) => ({ stap, noot: 42 })) };
const doorlopend = (noten, per = PPQN) => noten.every((n, i) => i === 0 || n.nominaal - noten[i - 1].nominaal === per);

{
  // A: kick op de tel naast een maatgever van 124 bpm die al 0,3 s speelt.
  const ctx = maakCtx();
  const deck = maakDeck(ctx, { P0: 0.3 });
  const inst = maakInst(ctx, 'drums');
  const { sp } = maakSpeler(ctx, { m: deck, inst: { A: inst } });
  sp.laadSet({ tracks: { 1: [KICK] } });
  ctx.currentTime = 0.1;
  const r = sp.start('A', 1);
  const eersteTel = r.op;
  ok('starten met een maatgever: op zijn volgende maatbegin (tel 4)', r.ok && eersteTel === 4);
  ok('lampje: wacht (knippert tussen 1 en 0,5)', [1, 0.5].includes(sp.lamp('A', 1)) && sp.stand('A').wacht === 1);
  loop(ctx, sp, 5);
  const aan = inst.aan();
  const fout = Math.max(...aan.map((x, i) => Math.abs(x.t - deck.telTijd(eersteTel + i))));
  ok(`elke kick op een tel van de maatgever (${aan.length} kicks, grootste fout ${(fout * 1e9).toFixed(3)} ns)`, aan.length >= 7 && fout < 1e-9);
  ok('geen noot vóór het maatbegin', aan[0].t >= deck.telTijd(4) - 1e-12);
  ok('alles minstens de drempel vooruit gepland (niets te laat)', aan.every((x) => x.t >= x.roep) && sp.stats.laat === 0 && sp.stats.gemist === 0);
  ok('elke noot krijgt zijn noteOff een stap later', inst.log.filter((x) => x.w === 'uit').length === aan.length);
  ok('lampje: speelt (1); de rest van de rij: leeg (0)', sp.lamp('A', 1) === 1 && sp.lamp('A', 2) === 0 && sp.lamp('B', 1) === null);

  // Pitch +3% op 5 s: de kicks volgen; na hooguit een tel weer exact op de tellen.
  deck.setRate(1.03);
  const voor = sp.noten.length;
  loop(ctx, sp, 12);
  const na = inst.aan().slice(voor);
  const t5 = 5 + S.VOORUIT + 2 * 60 / 124;
  const opTel = na.filter((x) => x.t > t5).map((x) => { const b = deck.grid.beatAt(deck.P0 + (x.t - deck.T0) * deck.rate); return Math.abs(b - Math.round(b)) * 60 / 124 / 1.03; });
  ok(`pitch +3%: na de overgang elke kick op de tel (grootste fout ${(Math.max(...opTel) * 1e9).toFixed(2)} ns)`, opTel.length > 10 && Math.max(...opTel) < 1e-6);
  ok('… zonder dubbele of gemiste kick (elke tel precies één keer)', doorlopend(sp.noten));
  ok('… herankerd', sp.stats.herankerd >= 1);

  // Een sprong van 0,37 tel (hotcue zonder quantize): glijdt, geen dubbele of gemiste.
  deck.seek(deck.position + 0.37 * 60 / 124);
  const v2 = sp.noten.length;
  loop(ctx, sp, 18);
  const na2 = sp.noten.slice(v2).filter((n) => n.t > ctx.currentTime - 3);
  const fout2 = Math.max(...na2.map((n) => { const b = deck.grid.beatAt(deck.P0 + (n.t - deck.T0) * deck.rate); return Math.abs(b - Math.round(b)); }));
  ok(`sprong van 0,37 tel: elke tel één keer, en daarna weer op de tellen (${fout2.toExponential(1)} tel)`, doorlopend(sp.noten) && fout2 < 1e-6);

  // Een sprong van precies 32 tellen terug (hotcue met quantize): niets te glijden.
  const v3 = sp.noten.length;
  const b0 = deck.grid.beatAt(deck.position);
  deck.seek(deck.grid.timeOf(b0 - 32));
  loop(ctx, sp, 22);
  const na3 = sp.noten.slice(v3);
  const fout3 = Math.max(...na3.map((n) => { const b = deck.grid.beatAt(deck.P0 + (n.t - deck.T0) * deck.rate); return Math.abs(b - Math.round(b)); }));
  ok(`sprong van 32 tellen terug: elke kick op de tel, geen enkele dubbel (${fout3.toExponential(1)} tel)`, doorlopend(sp.noten) && fout3 < 1e-6);

  // Stoppen op de maat: niets meer na het maatbegin, alleUit precies daar.
  const st = sp.klok.volgendeMaat(sp.klok.tel(sp.geplandTot)) ;
  sp.stop('A');
  ok('stoppen: lampje knippert (wacht op de maat)', [1, 0.5].includes(sp.lamp('A', 1)) && sp.stand('A').stopt);
  loop(ctx, sp, 26);
  const uit = inst.log.filter((x) => x.w === 'alleUit');
  const stopTijd = sp.klok.tijd(st);
  ok('stoppen op de maat: alleUit op het maatbegin, geen noot erna', uit.length === 1 && dicht(uit[0].t, stopTijd, 1e-9)
    && inst.aan().every((x) => x.t < stopTijd - 1e-9));
  ok('daarna: lampje gevuld (0,5), de klok staat stil', sp.lamp('A', 1) === 0.5 && sp.klokStand().bron === null && sp.geplandTot === null);
}

{
  // B: zonder maatgever op het eigen tempo, en een tempowissel.
  const ctx = maakCtx();
  const inst = maakInst(ctx);
  const { sp } = maakSpeler(ctx, { inst: { C: inst } });
  sp.laadSet({ tempo: 120, tracks: { 3: [null, KICK] } });
  ctx.currentTime = 1;
  const r = sp.start('C', 2);
  ok('zonder maatgever en zonder iets dat speelt: meteen (op de drempel)', r.ok && r.op === 0);
  loop(ctx, sp, 4);
  const aan = inst.aan();
  ok('op 120 bpm: elke 0,5 s precies', aan.length >= 5 && aan.every((x, i) => i === 0 || dicht(x.t - aan[i - 1].t, 0.5)));
  ok('de eerste kick net na de drempel', aan[0].t > 1 && aan[0].t < 1.03);
  sp.zetTempo(100);
  loop(ctx, sp, 9);
  const laatste = inst.aan().slice(-4);
  ok('tempo 100: daarna elke 0,6 s, zonder dubbele of gemiste', laatste.every((x, i) => i === 0 || dicht(x.t - laatste[i - 1].t, 0.6)) && doorlopend(sp.noten));
  ok('klokstand: eigen, 100 bpm', sp.klokStand().bron === 'eigen' && dicht(sp.klokBpm(), 100));
  // Een maatgever komt erbij (124, willekeurige fase): de kicks gaan naar zijn tellen.
  const deck = maakDeck(ctx, { id: 'B', bpm: 124, P0: 0.1234, T0: 9 });
  ctx.currentTime = 9;
  const w = { maat: deck };
  sp.maat = () => S.maatVan(w.maat);
  loop(ctx, sp, 14);
  const opTel = inst.aan().filter((x) => x.t > 11).map((x) => { const b = deck.grid.beatAt(deck.P0 + (x.t - deck.T0)); return Math.abs(b - Math.round(b)); });
  ok('een maatgever komt erbij: de patronen gaan naar zijn tellen (en blijven doorlopend)', Math.max(...opTel) < 1e-6 && doorlopend(sp.noten) && sp.klokStand().bron === 'maat');
  // De maatgever stopt: het laatste tempo vasthouden, niet terug naar 100.
  deck.speelt = false;
  loop(ctx, sp, 17);
  const ls = inst.aan().slice(-3);
  ok('de maatgever stopt: de klok houdt zijn tempo (124), niet terug naar het eigen tempo', ls.every((x, i) => i === 0 || dicht(x.t - ls[i - 1].t, 60 / 124, 1e-9))
    && sp.klokStand().bron === 'eigen' && sp.tempo === 100);
}

{
  // C: wisselen op de maat, en nooit een hangende noot.
  const ctx = maakCtx();
  const deck = maakDeck(ctx);
  const inst = maakInst(ctx);
  const { sp } = maakSpeler(ctx, { m: deck, inst: { A: inst } });
  sp.laadSet({ tracks: { 1: [ZESTIENDEN, { noten: [{ stap: 0, noot: 48, duur: 4 }] }] } });
  ctx.currentTime = 0.05;
  sp.start('A', 1);
  loop(ctx, sp, 3.0);
  const r = sp.druk('A', 2);
  const K = r.op;
  ok('een ander patroon op dezelfde track: wacht op het volgende maatbegin', r.ok && K % 4 === 0 && sp.stand('A').wacht === 2 && sp.stand('A').speelt === 1);
  ok('lampjes: het oude speelt (1), het nieuwe knippert', sp.lamp('A', 1) === 1 && [1, 0.5].includes(sp.lamp('A', 2)));
  loop(ctx, sp, 6);
  const tK = deck.telTijd(K);
  const iUit = inst.log.findIndex((x) => x.w === 'alleUit');
  const iNieuw = inst.log.findIndex((x) => x.w === 'aan' && x.noot === 48);
  ok('wissel: alleUit precies op het maatbegin, vóór de eerste noot van het nieuwe', iUit >= 0 && dicht(inst.log[iUit].t, tK) && iNieuw > iUit && dicht(inst.log[iNieuw].t, tK));
  ok('het oude patroon speelt niets meer vanaf het maatbegin', inst.log.filter((x) => x.w === 'aan' && x.noot === 42).every((x) => x.t < tK - 1e-9));
  ok('het nieuwe loopt rond (elke maat)', inst.log.filter((x) => x.w === 'aan' && x.noot === 48).length >= 2 && sp.stand('A').speelt === 2);
  // Nog eens op de wachtende: niet meer. Op de spelende: stoppen op de maat; nog eens: toch door.
  sp.druk('A', 1);
  sp.druk('A', 1);
  ok('nog eens op de wachtende plek: hij wacht niet meer, het patroon dat speelt speelt door', sp.stand('A').wacht === null && sp.stand('A').speelt === 2 && !sp.stand('A').stopt);
  sp.druk('A', 2);
  ok('op de spelende plek: stopt op de maat (knippert)', sp.stand('A').stopt);
  sp.druk('A', 2);
  ok('… nog eens: toch door', !sp.stand('A').stopt);
  // Meteen stoppen (shift): zodra wat gepland is op is, hooguit VOORUIT.
  const nu = ctx.currentTime;
  sp.stop('A', { meteen: true });
  loop(ctx, sp, nu + 0.5);
  const stop = inst.log.filter((x) => x.w === 'alleUit').at(-1);
  ok(`meteen stoppen: binnen de vooruitblik (${((stop.t - nu) * 1000).toFixed(0)} ms), daarna niets`, stop.t - nu <= S.VOORUIT + 1e-9
    && inst.log.filter((x) => x.w === 'aan').every((x) => x.t < stop.t + 1e-9) && sp.stand('A').speelt === null);
  // Het instrument gaat weg terwijl hij speelt: het patroon stopt (de engine liet al los).
  sp.start('A', 2);
  loop(ctx, sp, ctx.currentTime + 3);
  const w = { inst: null };
  const oud = sp.instrument;
  sp.instrument = (id) => (id === 'A' ? w.inst : null);
  const telVoor = inst.log.length;
  loop(ctx, sp, ctx.currentTime + 2);
  ok('instrument weg: het patroon stopt, er gaat niets meer naar het oude', sp.stand('A').speelt === null && inst.log.length === telVoor
    && sp.lamp('A', 2) === null);
  // Een ander instrument erop: het patroon speelt daarop verder.
  sp.instrument = oud;
  sp.start('A', 2);
  loop(ctx, sp, ctx.currentTime + 3);
  const nieuw = maakInst(ctx, 'fm');
  sp.instrument = (id) => (id === 'A' ? nieuw : null);
  loop(ctx, sp, ctx.currentTime + 4.2);
  ok('ander instrument op de track: het patroon speelt daarop verder', nieuw.aan().length >= 1 && sp.stand('A').speelt === 2);
}

{
  // D: een rij op alle tracks (scene launch): allemaal op hetzelfde maatbegin.
  const ctx = maakCtx();
  const deck = maakDeck(ctx, { P0: 1.9 });
  const ia = maakInst(ctx), ib = maakInst(ctx), ic = maakInst(ctx);
  const { sp } = maakSpeler(ctx, { m: deck, inst: { A: ia, B: ib, C: ic } });
  sp.laadSet({ tracks: { 1: [KICK, KICK], 2: [null, KICK], 3: [KICK] } });
  ctx.currentTime = 0.02;
  sp.start('A', 1);
  sp.start('C', 1);
  loop(ctx, sp, 2.5);
  sp.rij(2);
  ok('rij 2: track 1 wisselt, track 2 begint, track 3 (leeg in rij 2) stopt — alles op hetzelfde maatbegin',
    sp.sporen.A.wacht.start === sp.sporen.B.wacht.start && sp.sporen.C.spel.stop === sp.sporen.A.wacht.start && sp.sporen.A.spel.stop === sp.sporen.A.wacht.start);
  ok('rijlampje 2 knippert, rij 3 leeg (0), rij 1 speelt (1)', [1, 0.5].includes(sp.rijLamp(2)) && sp.rijLamp(3) === 0 && sp.rijLamp(1) === 1);
  loop(ctx, sp, 6);
  const K = sp.sporen.A.spel.start;
  const tK = sp.klok.tijd(K / PPQN);
  ok('rij 2 klinkt op één maatbegin: de eerste kick van track 1 en 2 tegelijk', dicht(ia.aan().find((x) => x.t >= tK - 1e-9).t, ib.aan()[0].t)
    && ic.aan().every((x) => x.t < tK - 1e-9));
  sp.stopAlles();
  loop(ctx, sp, 9);
  ok('alles stoppen: overal alleUit op hetzelfde moment', dicht(ia.log.filter((x) => x.w === 'alleUit').at(-1).t, ib.log.filter((x) => x.w === 'alleUit').at(-1).t)
    && sp.spelend().length === 0);
}

{
  // E: een haperende timer: wat te laat is klinkt nu, wat veel te laat is valt weg (geen salvo).
  const ctx = maakCtx();
  const inst = maakInst(ctx);
  const { sp } = maakSpeler(ctx, { inst: { A: inst } });
  sp.laadSet({ tempo: 120, tracks: { 1: [ZESTIENDEN] } });
  ctx.currentTime = 1;
  sp.start('A', 1);
  loop(ctx, sp, 2);
  ctx.currentTime += 0.4;           // 400 ms geen timer
  sp.tik();
  ok(`timer 400 ms weg: noten > 100 ms te laat vallen weg (${sp.stats.gemist}), wat net te laat is klinkt nu (${sp.stats.laat})`,
    sp.stats.gemist >= 1 && sp.stats.laat >= 1 && doorlopend(sp.noten.concat(), 96) === false);
  const n0 = sp.noten.length;
  loop(ctx, sp, 4);
  ok('… en daarna gewoon verder, elke stap één keer', doorlopend(sp.noten.slice(n0), 96));
}

{
  // F: opnemen (live, gekwantiseerd, overdub) en stap voor stap.
  const ctx = maakCtx();
  const inst = maakInst(ctx);
  const { sp } = maakSpeler(ctx, { inst: { A: inst } });
  sp.laadSet({ tempo: 120, tracks: { 1: [KICK] } });
  ctx.currentTime = 1;
  sp.start('A', 1);
  loop(ctx, sp, 2.0);
  sp.neemOp(true);
  // Wat je hoort loopt de uitgangsvertraging achter: speel "op" stap 6 zoals je hem HOORT, 10 ms te vroeg.
  const V_UIT = 0.025, stap = 0.125;
  const s = sp.sporen.A.spel;
  const tStap6 = sp.klok.tijd((s.basis + 6 * 96) / PPQN + 8 * 0.5 * 0) ; // omloop 0
  const omloopDuur = 2;
  const volgende6 = tStap6 + Math.ceil((ctx.currentTime - V_UIT - tStap6) / omloopDuur) * omloopDuur;
  loop(ctx, sp, volgende6 + V_UIT - 0.01);
  sp.noot('A', 38, 0.9);
  const p = sp.patroon('A', 1);
  ok('live opnemen: op de dichtstbijzijnde stap van wat je hoorde (6)', p.noten.some((n) => n.stap === 6 && n.noot === 38 && dicht(n.snelheid, 0.9)));
  ok('… erbij (overdub): de kicks staan er nog', p.noten.filter((n) => n.noot === 36).length === 4);
  loop(ctx, sp, ctx.currentTime + 0.3);
  sp.noot('A', 38, 0);
  ok('loslaten: de duur in stappen (afgerond, minstens 1)', sp.patroon('A', 1).noten.find((n) => n.noot === 38).duur === Math.max(1, Math.round(0.31 / stap)));
  loop(ctx, sp, ctx.currentTime + 2.2);
  const snares = inst.aan().filter((x) => x.noot === 38);
  ok('je hoorde hem al van je vinger: deze omloop niet nog eens, de volgende wel (één keer)', snares.length === 1 && snares[0].t > volgende6 + 1.5);
  sp.neemOp(false);
  sp.noot('A', 50, 0.7);
  ok('opnemen uit: niets erbij, wel de laatst gespeelde noot onthouden', !sp.patroon('A', 1).noten.some((n) => n.noot === 50) && sp.laatsteNoot('A') === 50);
  sp.wisselStap('A', 1, 3);
  ok('stap voor stap: de laatst gespeelde noot op stap 3', M.notenOp(sp.patroon('A', 1), 3).map((n) => n.noot).join() === '50');
  ok('stapLamp: 1 = de laatst gespeelde, 0,5 = een andere noot, 0 = leeg, null voorbij de lengte',
    sp.stapLamp('A', 3) === 1 && sp.stapLamp('A', 0) === 0.5 && sp.stapLamp('A', 1) === 0 && sp.stapLamp('A', 16) === null);
  sp.wisselStap('A', 1, 3);
  ok('… nog eens: eraf', M.notenOp(sp.patroon('A', 1), 3).length === 0);
  ok('zonder gespeelde noot: drums = kick (36), de rest C4 (60)', (() => { const x = maakSpeler(ctx, { inst: { A: maakInst(ctx, 'drums'), B: maakInst(ctx) } }).sp; return x.laatsteNoot('A') === 36 && x.laatsteNoot('B') === 60; })());
  // Een lege plek: zonder opnemen alleen kiezen, met opnemen beginnen (leeg) en erin opnemen.
  const r1 = sp.druk('A', 4);
  ok('lege plek zonder opnemen: alleen gekozen (er verandert niets aan wat speelt)', r1.gekozen && sp.gekozen('A') === 4 && sp.stand('A').speelt === 1 && !sp.sporen.A.wacht);
  sp.neemOp(true);
  sp.druk('A', 4);
  ok('lege plek met opnemen: hij begint (leeg) op de maat', sp.sporen.A.wacht?.plek === 4);
  // Lengte veranderen terwijl hij speelt: hij loopt door vanaf waar hij was.
  sp.neemOp(false);
  sp.stop('A', { meteen: true });
  loop(ctx, sp, ctx.currentTime + 1);
  sp.laadSet({ tempo: 120, tracks: { 1: [ZESTIENDEN] } });
  sp.start('A', 1);
  loop(ctx, sp, ctx.currentTime + 3.1);
  const n0 = sp.noten.length;
  sp.zetLengte('A', 1, 12);
  loop(ctx, sp, ctx.currentTime + 4);
  const na = sp.noten.slice(n0);
  ok('lengte 16 → 12 terwijl hij speelt: elke zestiende één keer (geen gat, geen dubbel), daarna in omlopen van 12',
    doorlopend(na, 96) && na.filter((n) => n.stap === 12).length <= 1 && na.some((n) => n.stap === 11) && na.filter((n) => n.stap === 0).length >= 3);
  sp.vernietig();
}

{
  // G: een andere maatgever (hysterese in de engine): de klok gaat naar zijn tellen, ook als die op een ander tempo staan.
  const ctx = maakCtx();
  const d1 = maakDeck(ctx, { id: 'A', bpm: 124 });
  const inst = maakInst(ctx);
  const { sp, w } = maakSpeler(ctx, { m: d1, inst: { C: inst } });
  sp.laadSet({ tracks: { 3: [KICK] } });
  ctx.currentTime = 0.1;
  sp.start('C', 1);
  loop(ctx, sp, 4);
  const d2 = maakDeck(ctx, { id: 'B', bpm: 128, P0: 7.777, T0: 4 });
  w.maat = d2;
  loop(ctx, sp, 9);
  const opTel = inst.aan().filter((x) => x.t > 5.5).map((x) => { const b = d2.grid.beatAt(d2.P0 + (x.t - d2.T0)); return Math.abs(b - Math.round(b)); });
  ok('een andere maatgever (128 bpm, andere fase): binnen twee tellen op zijn tellen, geen dubbele of gemiste', Math.max(...opTel) < 1e-6 && doorlopend(sp.noten));
  ok('… en zijn maten: een nieuwe start valt op zijn "1"', (() => { const K = sp.klok.volgendeMaat(sp.klok.tel(ctx.currentTime) + 0.3); const b = d2.grid.beatAt(d2.P0 + (sp.klok.tijd(K) - d2.T0)); return dicht(b, Math.round(b), 1e-6) && Math.round(b) % 4 === 0; })());
}

// ---- 5. de opslag: met versie, 409 bij een botsing (zoals de plannen) -----------------------
console.log('\nde opslag');
{
  const { Patronen } = await import('../server/patronen.js');
  const map = mkdtempSync(join(tmpdir(), 'varve-patronen-'));
  try {
    const pa = new Patronen(join(map, 'patronen'));
    ok('nog niets: lees = null, lijst leeg', (await pa.lees('set')) === null && (await pa.lijst()).length === 0);
    const r1 = await pa.schrijf('set', { tracks: { 1: [KICK] } }, null);
    ok('nieuw (versie null): 200, met een versie en de nette set', r1.code === 200 && /^[0-9a-f]{16}$/.test(r1.antwoord.versie)
      && r1.antwoord.set.tracks['1'][0].noten.length === 4);
    const r2 = await pa.schrijf('set', { tracks: {} }, null);
    ok('nog eens "nieuw": 409 met wat er staat', r2.code === 409 && r2.antwoord.set.tracks['1'][0].noten.length === 4 && r2.antwoord.versie === r1.antwoord.versie);
    ok('verkeerde versie: 409', (await pa.schrijf('set', { tracks: {} }, 'ffffffffffffffff')).code === 409);
    const r3 = await pa.schrijf('set', { tempo: 99, tracks: { 2: [null, ZESTIENDEN] } }, r1.antwoord.versie);
    ok('de goede versie: 200, nieuwe versie; de vorige bewaard in .versies', r3.code === 200 && r3.antwoord.versie !== r1.antwoord.versie
      && (await pa.versies('set')).length === 1);
    ok('… en opslaan op de oude versie botst', (await pa.schrijf('set', { tracks: {} }, r1.antwoord.versie)).code === 409);
    const ruw = JSON.parse(readFileSync(join(map, 'patronen', 'set.json'), 'utf8'));
    ok('het bestand is gewoon leesbare JSON (Claude kan het schrijven)', ruw.tempo === 99 && ruw.tracks['2'][1].noten.length === 16);
    const g = await pa.lees('set');
    ok('lees: de set met dezelfde versie als na het schrijven', g.versie === r3.antwoord.versie && g.set.tempo === 99);
    ok('geen set: 400', (await pa.schrijf('x', null, null)).code === 400);
  } finally { rmSync(map, { recursive: true, force: true }); }
}

// ---- 6. de server en de opslag van de mixer (patronen-opslag.js) tegen de echte server ----------
console.log('\nde server');
{
  const map = mkdtempSync(join(tmpdir(), 'varve-patronen-srv-'));
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(poort), VARVE_DB: join(map, 'lib.db'), VARVE_OPNAMES: join(map, 'opnames'), VARVE_MEDIA: join(map, 'media'),
      VARVE_HERANALYSE: 'uit', VARVE_PLANNEN: join(map, 'plannen'), VARVE_PROEF: join(map, 'proef'), VARVE_PATRONEN: join(map, 'patronen') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const B = `http://localhost:${poort}`;
  try {
    for (let i = 0; i < 80; i++) { if ((await fetch(`${B}/api/patronen`).catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 100)); }
    const zet = (naam, body, headers = {}) => fetch(`${B}/api/patronen/${naam}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    ok('nog niets: lijst leeg, set 404', (await (await fetch(`${B}/api/patronen`)).json()).sets.length === 0 && (await fetch(`${B}/api/patronen/set`)).status === 404);
    const r = await zet('set', { set: { tracks: { 1: [KICK] } }, versie: null });
    const d = await r.json();
    ok('PUT nieuw: 200 met versie', r.status === 200 && !!d.versie);
    ok('PUT op een oude versie: 409 met de set van nu', (await zet('set', { set: { tracks: {} }, versie: null })).status === 409);
    ok('rare naam: 400; geen JSON: 415; geen set: 400', (await zet('a%20b', { set: {} })).status === 400
      && (await fetch(`${B}/api/patronen/x`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status === 415
      && (await zet('x', { versie: null })).status === 400);
    ok('van een vreemde site: 403', (await zet('x', { set: {} }, { Origin: 'http://evil.example' })).status === 403);
    ok('niet statisch te lezen (geen witte lijst): /patronen/set.json 404', (await fetch(`${B}/patronen/set.json`)).status === 404);

    // De opslag van de mixer: ophalen, bewaren na een bewerking, Claude schrijft ertussen, botsing.
    const { opzetPatronenOpslag } = await import('../src/ui/patronen-opslag.js');
    const ctx = maakCtx();
    const { sp } = maakSpeler(ctx, { inst: { A: maakInst(ctx) } });
    const meld = [];
    let kijkFn = null;
    const later = []; // de wachttimer doen we zelf
    const o = opzetPatronenOpslag({ engine: { patronen: sp }, haal: (url, init) => fetch(B + url, init), naam: 'set',
      elke: (fn) => { kijkFn = fn; return 1; }, later: (fn) => { later.push(fn); return later.length; }, stopLater: () => {}, melding: (t, s) => meld.push([t, s]) });
    /** De wachttimers zelf afgaan tot er niets meer te bewaren is (of een botsing). */
    const rustig = async () => {
      for (let i = 0; i < 100; i++) {
        while (later.length) later.shift()();
        await new Promise((r) => setTimeout(r, 10));
        if (!o.stand().vuil || o.stand().botsing) return;
      }
    };
    await o.laad();
    ok('opstarten: de set van de server in de speler, met zijn versie', sp.patroon('A', 1)?.noten.length === 4 && o.stand().versie === d.versie);
    sp.wisselStap('A', 1, 2, 50);
    ok('een bewerking: wacht even (één verzoek straks)', o.stand().vuil && later.length === 1);
    await rustig();
    const na = await (await fetch(`${B}/api/patronen/set`)).json();
    ok('… bewaard op de server, met de nieuwe versie', na.set.tracks['1'][0].noten.length === 5 && o.stand().versie === na.versie && !o.stand().vuil);
    // Claude schrijft het bestand (op de goede versie): de mixer neemt het over.
    await zet('set', { set: { ...na.set, tempo: 133 }, versie: na.versie });
    await kijkFn();
    ok('van buiten veranderd (Claude): de mixer neemt het over, zonder eigen wijzigingen', sp.tempo === 133 && meld.some(([t]) => /bijgewerkt/.test(t)));
    // Botsing: wij bewerken, Claude ook; bewaren geeft 409, niets wordt stil overschreven.
    const nu = await (await fetch(`${B}/api/patronen/set`)).json();
    await zet('set', { set: { ...nu.set, tempo: 90 }, versie: nu.versie });
    sp.wisselStap('A', 1, 3, 51);
    await rustig();
    ok('botsing: 409, een melding, niets overschreven', o.stand().botsing && meld.some(([t, s]) => s === 'fout' && /iemand anders/.test(t))
      && (await (await fetch(`${B}/api/patronen/set`)).json()).set.tempo === 90);
    await kijkFn();
    ok('… tijdens een botsing neemt kijken niets over', sp.tempo === 133);
    await o.mijnVersie();
    await rustig();
    const mijn = await (await fetch(`${B}/api/patronen/set`)).json();
    ok('mijn versie: bewaard over de hunne heen (de hunne staat in .versies)', !o.stand().botsing && mijn.set.tempo === 133
      && mijn.set.tracks['1'][0].noten.some((n) => n.noot === 51));
    await zet('set', { set: { ...mijn.set, tempo: 77 }, versie: mijn.versie });
    sp.wisselStap('A', 1, 4, 52);
    await rustig();
    o.hunVersie();
    ok('hun versie: geladen in de speler, de botsing weg', !o.stand().botsing && sp.tempo === 77 && !sp.patroon('A', 1).noten.some((n) => n.noot === 52));
  } finally {
    server.kill('SIGINT');
    await new Promise((r) => setTimeout(r, 200));
    rmSync(map, { recursive: true, force: true });
  }
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
