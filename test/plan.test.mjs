// De programmering: het planformaat (plan-model.js), de voorspelling
// (tijdlijn.js) en de opslag met versies (server/plannen.js). Puur en op een
// tijdelijke map; geen browser, geen server.
// Draai met: node test/plan.test.mjs
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const M = await import('../src/plan/plan-model.js');
const T = await import('../src/plan/tijdlijn.js');
const { Plannen } = await import('../server/plannen.js');

console.log('het formaat');
{
  const v1 = { naam: 'oud', stappen: [{ track: 'a', van: 10, speelduur: 300, waarom: 'x' }, { track: 'b', overgang: 'blend' }] };
  const { plan, fouten } = M.normaliseerPlan(v1);
  ok('v1 wordt v2 zonder fouten', plan.versie === 2 && fouten.length === 0 && plan.stappen.length === 2);
  ok('elke stap krijgt een id (s1, s2)', plan.stappen.map((s) => s.id).join() === 's1,s2');
  ok('wat ontbreekt: null (de app kiest), overgang auto', plan.stappen[1].van === null && plan.stappen[1].speelduur === null && plan.stappen[0].overgang === 'auto');
  const { plan: p2 } = M.normaliseerPlan(plan);
  ok('nog een keer normaliseren verandert niets', JSON.stringify(p2) === JSON.stringify(plan));
  const r = M.normaliseerPlan({ stappen: [{ id: 'x', track: 'a' }, { id: 'x', track: 'b' }, { track: '' }, null, { track: 'c', overgang: 'boem', speelduur: -3, van: -1, lengte: { maten: 900 } }] });
  ok('dubbele id: de tweede krijgt een nieuwe', r.plan.stappen[0].id === 'x' && r.plan.stappen[1].id !== 'x');
  ok('stappen zonder nummer vallen weg, met een fout', r.plan.stappen.length === 3 && r.fouten.filter((f) => /geen nummer/.test(f)).length === 2);
  ok('onbekende overgang → auto, met een fout', r.plan.stappen[2].overgang === 'auto' && r.fouten.some((f) => /boem/.test(f)));
  ok('negatieve tijden → de app kiest; lengte begrensd (64 maten)', r.plan.stappen[2].speelduur === null && r.plan.stappen[2].van === null && r.plan.stappen[2].lengte.maten === 64);
  ok('rommel: een leeg plan met een fout, geen crash', M.normaliseerPlan('rommel').plan.stappen.length === 0 && M.normaliseerPlan(null).fouten.length > 0);
  const m = M.normaliseerPlan(v1, { trackIds: new Set(['a']) });
  ok('onbekend nummer: gemeld, niet weggegooid', m.plan.stappen.length === 2 && m.fouten.some((f) => /b staat niet/.test(f)));
  ok('lange tekst wordt ingekort', M.normaliseerPlan({ stappen: [{ track: 'a', waarom: 'x'.repeat(2000) }] }).plan.stappen[0].waarom.length === 500);
}

console.log('\nbewerken');
{
  const { plan } = M.normaliseerPlan({ stappen: [{ track: 'a' }, { track: 'b' }, { track: 'c' }] });
  const p1 = M.bewerk(plan, { soort: 'zet', id: 's2', velden: { van: 30, overgang: 'filter', lengte: { maten: 8 } } });
  ok('zet: velden veranderen, door = clay', p1.stappen[1].van === 30 && p1.stappen[1].overgang === 'filter' && p1.stappen[1].door === 'clay');
  ok('... het oude plan blijft zoals het was (ongedaan maken)', plan.stappen[1].van === null && p1 !== plan);
  ok('zet met rommel: begrensd, niet stuk', M.bewerk(plan, { soort: 'zet', id: 's1', velden: { overgang: 'x', speelduur: 'lang' } }).stappen[0].overgang === 'auto');
  ok('zet mag de id niet veranderen', M.bewerk(plan, { soort: 'zet', id: 's1', velden: { id: 'zz' } }).stappen[0].id === 's1');
  const p2 = M.bewerk(plan, { soort: 'verplaats', id: 's3', naar: 0 });
  ok('verplaats: c vooraan', p2.stappen.map((s) => s.track).join('') === 'cab');
  ok('verplaats buiten de lijst: aan het eind', M.bewerk(plan, { soort: 'verplaats', id: 's1', naar: 99 }).stappen.map((s) => s.track).join('') === 'bca');
  ok('weg', M.bewerk(plan, { soort: 'weg', id: 's2' }).stappen.map((s) => s.id).join() === 's1,s3');
  const p3 = M.bewerk(plan, { soort: 'erbij', stap: { track: 'd', id: 's1' }, na: 's1' }, { door: 'claude' });
  ok('erbij na s1, met een nieuwe id en door = claude', p3.stappen[1].track === 'd' && !['s1', 's2', 's3'].includes(p3.stappen[1].id) && p3.stappen[1].door === 'claude');
  const hergebruik = M.bewerk(M.bewerk(plan, { soort: 'weg', id: 's3' }), { soort: 'erbij', stap: { track: 'e' } });
  ok('een verwijderde id komt nooit terug bij een nieuwe stap', hergebruik.stappen[2].id !== 's3');
  ok('erbij vooraan (na = null) en achteraan (na weg)', M.bewerk(plan, { soort: 'erbij', stap: { track: 'd' }, na: null }).stappen[0].track === 'd'
    && M.bewerk(plan, { soort: 'erbij', stap: { track: 'd' } }).stappen[3].track === 'd');
  ok('onbekende id of soort: hetzelfde plan terug', M.bewerk(plan, { soort: 'weg', id: 'zz' }) === plan && M.bewerk(plan, { soort: 'boem' }) === plan);
  const vs = M.verschil(plan, M.bewerk(M.bewerk(p1, { soort: 'weg', id: 's3' }), { soort: 'erbij', stap: { track: 'e' } }));
  ok(`verschil: 1 erbij, 1 weg, s2 anders (van, overgang, lengte) — ${JSON.stringify(vs)}`, vs.erbij.length === 1 && vs.weg.join() === 's3'
    && vs.anders.length === 1 && vs.anders[0].id === 's2' && vs.anders[0].velden.join() === 'van,overgang,lengte' && !vs.volgorde);
  ok('verschil: volgorde', M.verschil(plan, p2).volgorde === true);
}

console.log('\nsecties in een stap: in en uit (docs/PLAN.md §2)');
{
  const IN = { sectie: 2, label: 'drop', groep: 'B' }, UIT = { sectie: 5, label: 'break', groep: 'C' };
  const { plan, fouten } = M.normaliseerPlan({ stappen: [{ track: 'a', van: 61.9, in: IN, uit: UIT }, { track: 'b' }] });
  ok('in en uit blijven staan, zonder fouten', fouten.length === 0 && JSON.stringify(plan.stappen[0].in) === JSON.stringify(IN)
    && JSON.stringify(plan.stappen[0].uit) === JSON.stringify(UIT) && plan.stappen[0].van === 61.9);
  ok('zonder in/uit: geen velden erbij (formaat v2 blijft zoals het was)', !('in' in plan.stappen[1]) && !('uit' in plan.stappen[1])
    && Object.keys(plan.stappen[1]).join() === 'id,track,van,speelduur,overgang,lengte,waarom,notitie,door');
  const { plan: p2 } = M.normaliseerPlan(plan);
  ok('twee keer normaliseren geeft hetzelfde (ook met in/uit)', JSON.stringify(p2) === JSON.stringify(plan));
  const { plan: p3 } = M.normaliseerPlan({ stappen: [{ track: 'a', uit: { groep: 'C', extra: 1, sectie: 5, label: 'break' }, in: { label: 'drop', sectie: 2, groep: 'B' } }] });
  ok('in/uit in een vaste vorm: { sectie, label, groep }, de rest weg', JSON.stringify(p3.stappen[0].in) === JSON.stringify(IN)
    && JSON.stringify(p3.stappen[0].uit) === JSON.stringify(UIT));
  const r = M.normaliseerPlan({ stappen: [
    { track: 'a', in: { sectie: 0 } }, { track: 'b', in: { sectie: 2.5 } }, { track: 'c', in: 'drop' }, { track: 'd', uit: { sectie: 999 } },
    { track: 'e', in: { sectie: '3' } }, { track: 'f', in: { sectie: 3, label: '<b>', groep: 'bb' } }, { track: 'g', in: null, uit: null }] });
  ok(`rommel in in/uit: weggelaten, met een fout (${r.fouten.length})`, r.plan.stappen.slice(0, 5).every((s) => !('in' in s) && !('uit' in s))
    && r.fouten.length === 5 && r.fouten.every((f) => /(in|uit)/.test(f)));
  ok('een vreemd label of groep: null, de sectie blijft', JSON.stringify(r.plan.stappen[5].in) === '{"sectie":3,"label":null,"groep":null}');
  ok('in/uit null: gewoon niets, geen fout', !('in' in r.plan.stappen[6]) && !('uit' in r.plan.stappen[6]));
  const v = M.normaliseerPlan({ stappen: [{ track: 'a', in: { sectie: 4 }, uit: { sectie: 4 } }, { track: 'b', in: { sectie: 4 }, uit: { sectie: 2 } }] });
  ok('uit niet na in: uit weg, met een fout', v.plan.stappen.every((s) => s.in && !('uit' in s)) && v.fouten.filter((f) => /uit/.test(f)).length === 2);

  // Bewerken: pak en verschil kennen in en uit.
  const b0 = M.normaliseerPlan({ stappen: [{ track: 'a' }, { track: 'b' }] }).plan;
  const b1 = M.bewerk(b0, { soort: 'zet', id: 's2', velden: { in: IN, van: 61.9 } });
  ok('zet: in (en van op het begin ervan)', JSON.stringify(b1.stappen[1].in) === JSON.stringify(IN) && b1.stappen[1].van === 61.9 && b1.stappen[1].door === 'clay');
  const b2 = M.bewerk(b1, { soort: 'zet', id: 's2', velden: { uit: UIT } });
  ok('zet: uit erbij, in blijft', JSON.stringify(b2.stappen[1].uit) === JSON.stringify(UIT) && !!b2.stappen[1].in);
  const b3 = M.bewerk(b2, { soort: 'zet', id: 's2', velden: { in: null } });
  ok('zet in: null haalt in weg, van blijft (de terugval)', !('in' in b3.stappen[1]) && b3.stappen[1].van === 61.9 && !!b3.stappen[1].uit);
  const vs = M.verschil(b0, b2);
  ok(`verschil kent in en uit (${JSON.stringify(vs.anders)})`, vs.anders.length === 1 && vs.anders[0].velden.join() === 'van,in,uit');
  ok('verschil: alleen een ander label van in telt ook', M.verschil(b2, M.bewerk(b2, { soort: 'zet', id: 's2', velden: { in: { ...IN, label: 'break' } } }))
    .anders[0]?.velden.join() === 'in');
  ok('erbij met in/uit: ze blijven', !!M.bewerk(b0, { soort: 'erbij', stap: { track: 'c', van: 10, in: IN } }).stappen[2].in);
}

console.log('\nvoorspelling');
{
  const tr = (id, bpm, toon, zeker, duur = 300) => ({ id, titel: id, duur, loudness_i: -14,
    grid: { stukken: [{ van: 0, bpm, anker: 0, zekerheid: zeker }] }, toon: { stukken: [{ van: 0, toonsoort: toon, zekerheid: 0.9 }] } });
  const tracks = new Map([tr('a', 124, 'Am', 0.9), tr('b', 125, 'Em', 0.9), tr('c', 96, 'G', 0.1), tr('d', 124, 'D', 0.9)].map((t) => [t.id, t]));
  const { plan } = M.normaliseerPlan({ stappen: [
    { track: 'a', speelduur: 120 }, { track: 'b', speelduur: 120, overgang: 'blend' }, { track: 'c', speelduur: 120 },
    { track: 'zz' }, { track: 'd', speelduur: 60, overgang: 'blend' }] });
  const v = T.voorspel(plan, tracks);
  const [a, b, c, zz, d] = v.stappen;
  ok('eerste: begint op 0, geen overgang', a.start === 0 && a.overgang === null && a.duur === 120);
  ok(`a → b: blend (zekere grids, toon naast elkaar), 16 maten ≈ ${b.overgang.sec.toFixed(1)} s`, b.overgang.gekozen === 'blend' && Math.abs(b.overgang.sec - 16 * 4 * 60 / 124) < 0.01);
  ok('b begint waar de blend begint: 120 − overlap', Math.abs(b.start - (120 - b.overlap)) < 1e-9 && b.overlap > 30);
  ok('b → c (onzeker grid): filter-uit, de nieuwe valt in op het eind (overlap 0)', c.overgang.gekozen === 'filter' && c.overlap === 0 && Math.abs(c.start - (b.start + 120)) < 1e-9);
  ok('onbekend nummer: gemarkeerd, telt niet mee', zz.ontbreekt && zz.duur === 0);
  ok(`c → d, plan vraagt blend: de app kiest ${d.overgang.naam}, en dat staat erbij`, d.overgang.gekozen !== 'blend' && d.overgang.afgewezen && d.overgang.gevraagd === 'blend');
  ok('toonafstand tussen stappen (Am → Em = 1)', b.afstand === 1 && T.toonKleur(1) === 'goed' && T.toonKleur(3) === 'botst' && T.toonKleur(null) === null);
  ok(`totaal = start van de laatste + zijn duur (${v.totaal.toFixed(1)})`, Math.abs(v.totaal - (d.start + d.duur)) < 1e-9);
  const lang = M.bewerk(plan, { soort: 'zet', id: 's2', velden: { lengte: { maten: 32 } } });
  ok('eigen lengte: 32 maten', Math.abs(T.voorspel(lang, tracks).stappen[1].overgang.sec - 32 * 4 * 60 / 124) < 0.01);
}

// Het contract met de planner (spoor auto bouwt hem, TASKS-SECTIES "Verweven"):
//   fragment(track, { van, speelduur, rnd, secties, inSectie })
//   planMoment({ …, secties, uitSectie })    secties = de stukken van de UITGAANDE
// Hier alleen of voorspel ze goed DOORGEEFT (een spion), niet wat de planner ermee doet.
console.log('\nvoorspelling: secties naar de planner (contract)');
{
  const P = await import('../src/auto/planner.js');
  const tr = (id, bpm, toon) => ({ id, titel: id, duur: 300, loudness_i: -14,
    grid: { stukken: [{ van: 0, bpm, anker: 0, zekerheid: 0.9 }] }, toon: { stukken: [{ van: 0, toonsoort: toon, zekerheid: 0.9 }] } });
  const tracks = new Map([tr('a', 124, 'Am'), tr('b', 125, 'Em'), tr('c', 124, 'Am')].map((t) => [t.id, t]));
  const kaart = (...grenzen) => ({ versie: 1, opGrid: true, grid: 'abcd1234', bron: 'auto', slot: false,
    stukken: grenzen.map((van, i) => ({ van, label: i ? 'deel' : 'intro', groep: String.fromCharCode(65 + i), energie: 0.5 })) });
  const kA = kaart(0, 31, 62, 93, 124), kB = kaart(0, 15.5, 46.5, 77.5);
  const secties = new Map([['a', kA], ['b', kB]]);
  const IN = { sectie: 2, label: 'deel', groep: 'B' }, UIT = { sectie: 3, label: 'deel', groep: 'C' };
  const { plan } = M.normaliseerPlan({ stappen: [
    { track: 'a', speelduur: 120, uit: UIT }, { track: 'b', van: 15.5, in: IN, speelduur: 120, overgang: 'blend' }, { track: 'c', speelduur: 60 }] });
  const frag = [], mom = [];
  const spion = {
    fragment: (t, o) => { frag.push({ id: t.id, o }); return P.fragment(t, o); },
    planMoment: (o) => { mom.push(o); return P.planMoment(o); },
  };
  T.voorspel(plan, tracks, { secties, planner: spion });
  const fA = frag.find((x) => x.id === 'a')?.o, fB = frag.find((x) => x.id === 'b')?.o, fC = frag.find((x) => x.id === 'c')?.o;
  ok('fragment krijgt van, speelduur en rnd zoals altijd', fB?.van === 15.5 && fB.speelduur === 120 && typeof fB.rnd === 'function');
  ok('fragment krijgt de stukken van ZIJN kaart als secties', fA?.secties === kA.stukken && fB?.secties === kB.stukken);
  ok('fragment krijgt in als inSectie (null zonder in)', JSON.stringify(fB?.inSectie) === JSON.stringify(IN) && fA?.inSectie === null);
  ok('een nummer zonder kaart: secties null', fC?.secties === null && fC.inSectie === null);
  ok(`planMoment per overgang (${mom.length}×), met type, grid, positie en eind van de uitgaande`, mom.length === 2
    && mom[0].type === 'blend' && !!mom[0].grid && mom[0].positie === 0 && mom[0].eind === 120);
  ok('planMoment krijgt de stukken van de UITGAANDE en haar uit', mom[0].secties === kA.stukken && JSON.stringify(mom[0].uitSectie) === JSON.stringify(UIT));
  ok('... de tweede overgang: de kaart van b, zonder uit (null)', mom[1].secties === kB.stukken && mom[1].uitSectie === null);
  frag.length = 0; mom.length = 0;
  T.voorspel(plan, tracks, { planner: spion });
  ok('zonder secties (los venster zonder kaarten): overal null', frag.every((x) => x.o.secties === null) && mom.every((x) => x.secties === null));
  ok('zonder secties: in/uit gaan wel mee (de planner valt terug op van)', JSON.stringify(frag[1].o.inSectie) === JSON.stringify(IN)
    && JSON.stringify(mom[0].uitSectie) === JSON.stringify(UIT));

  // Met uit volgt de strook het moment van de planner: de overgang begint daar.
  const nep = { planMoment: () => ({ start: 50, lengte: 20 }) };
  const v = T.voorspel(plan, tracks, { secties, planner: nep });
  const [a, b] = v.stappen;
  ok(`met uit: de nieuwe begint waar het moment van de planner begint (${b.start}), overlap = zijn lengte (${b.overlap})`, b.start === 50 && b.overlap === 20);
  ok(`... en de uitgaande is klaar aan het eind van de overgang (tot ${a.tot}, duur ${a.duur})`, a.tot === 70 && a.duur === 70);
  const zonderUit = M.bewerk(plan, { soort: 'zet', id: 's1', velden: { uit: null } });
  const w = T.voorspel(zonderUit, tracks, { secties, planner: nep });
  ok('zonder uit: de oude schatting (de overgang eindigt op het eind van het stuk)', w.stappen[0].duur === 120 && Math.abs(w.stappen[1].start - (120 - w.stappen[1].overlap)) < 1e-9);
  const echt = T.voorspel(plan, tracks, { secties });
  ok('met de echte planner: geen fout, een moment per overgang', echt.stappen[1].moment && Number.isFinite(echt.stappen[1].moment.start) && echt.stappen[1].start >= 0);
  const stuk = T.voorspel(plan, tracks, { secties, planner: { planMoment: () => { throw new Error('boem'); } } });
  ok('een planner die gooit: de oude schatting, geen crash', stuk.stappen[1].moment === null && stuk.stappen[0].duur === 120);
}

// De strook (strook.js) op een nep-2D-context: de witte strepen van in en uit
// liggen BOVENOP. Begint de volgende stap precies op de uit van de vorige (zo
// plant de planner hem), dan verfde zijn overgang (en zijn banden) over de streep.
console.log('\nde strook: in en uit bovenop');
{
  const { tekenStrook } = await import('../src/plan/strook.js');
  const tr = (id, bpm, toon) => ({ id, titel: id, duur: 128 * 240 / bpm, loudness_i: -14,
    grid: { stukken: [{ van: 0, bpm, anker: 0, zekerheid: 0.9 }] }, toon: { stukken: [{ van: 0, toonsoort: toon, zekerheid: 0.9 }] } });
  const tracks = new Map([tr('een', 124, 'Am'), tr('twee', 125, 'Em')].map((t) => [t.id, t]));
  const kaart = (bpm, delen) => ({ versie: 1, opGrid: true, grid: 'abcd1234', bron: 'hand', slot: false,
    stukken: delen.map(([m, label, groep]) => ({ van: m * 240 / bpm, label, groep, energie: 0.5 })) });
  const secties = new Map([['een', kaart(124, [[0, 'intro', 'A'], [16, 'opbouw', 'B'], [32, 'drop', 'C'], [64, 'break', 'D'], [80, 'drop', 'C'], [112, 'outro', 'E']])],
    ['twee', kaart(125, [[0, 'intro', 'A'], [8, 'deel', 'B'], [24, 'drop', 'C'], [56, 'break', 'D'], [72, 'outro', 'E']])]]);
  const { plan } = M.normaliseerPlan({ stappen: [
    { id: 's1', track: 'een', speelduur: 200, uit: { sectie: 4, label: 'break', groep: 'D' } },
    { id: 's2', track: 'twee', van: 24 * 240 / 125, in: { sectie: 3, label: 'drop', groep: 'C' }, overgang: 'blend' }] });
  const v = T.voorspel(plan, tracks, { secties });
  const ops = [];
  const g = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : k === 'fillRect' ? (x, y, w, h) => ops.push({ x, y, w, h, kleur: o.fillStyle }) : () => {}),
    set: (o, k, w) => { o[k] = w; return true; },
  });
  const banden = tekenStrook(g, { v, w: 1000, h: 74 });
  const wit = ops.map((o, i) => ({ ...o, i })).filter((o) => o.kleur === '#ffffff');
  const over = wit.filter((m) => ops.slice(m.i + 1).some((o) => o.kleur !== '#ffffff'
    && o.x < m.x + m.w && o.x + o.w > m.x && o.y < m.y + m.h && o.y + o.h > m.y));
  ok(`de tweede stap begint op de uit van de eerste (${v.stappen[1].start.toFixed(1)} s = break D ${(64 * 240 / 124).toFixed(1)} s)`,
    Math.abs(v.stappen[1].start - 64 * 240 / 124) < 0.01);
  ok(`banden voor beide stappen (${banden.length})`, banden.some((b) => b.id === 's1') && banden.some((b) => b.id === 's2'));
  ok(`witte strepen (in en uit) liggen bovenop: ${wit.length} strepen, ${over.length} overgeschilderd`, wit.length === 2 && over.length === 0);
}

console.log('\nopslag met versies');
{
  const map = mkdtempSync(join(tmpdir(), 'varve-plannen-'));
  try {
    const pl = new Plannen(map);
    ok('niets: lijst leeg, lezen null', (await pl.lijst()).length === 0 && (await pl.lees('x')) === null);
    const r1 = await pl.schrijf('set', { naam: 'set', stappen: [{ track: 'a' }] }, null);
    ok('nieuw plan (versie null): 200 met een versie', r1.code === 200 && typeof r1.antwoord.versie === 'string');
    const r2 = await pl.schrijf('set', { stappen: [{ track: 'b' }] }, null);
    ok('nog een keer "nieuw": 409 met wat er staat', r2.code === 409 && r2.antwoord.plan.stappen[0].track === 'a');
    const r3 = await pl.schrijf('set', { stappen: [{ track: 'b' }] }, 'verkeerd');
    ok('verkeerde versie: 409', r3.code === 409);
    const r4 = await pl.schrijf('set', { naam: 'set', stappen: [{ track: 'b' }] }, r1.antwoord.versie);
    ok('juiste versie: 200, nieuwe versie', r4.code === 200 && r4.antwoord.versie !== r1.antwoord.versie);
    ok('de vorige staat in .versies', (await pl.versies('set')).length === 1);
    // Claude schrijft het bestand buiten de server om: de versie verandert vanzelf.
    writeFileSync(join(map, 'set.json'), JSON.stringify({ stappen: [{ track: 'c' }] }));
    const l = await pl.lees('set');
    ok('bestand buiten de server om gewijzigd: nieuwe versie, genormaliseerd gelezen', l.versie !== r4.antwoord.versie && l.plan.stappen[0].id === 's1');
    ok('... en opslaan op de oude versie botst', (await pl.schrijf('set', { stappen: [] }, r4.antwoord.versie)).code === 409);
    writeFileSync(join(map, 'kapot.json'), '{ kapot');
    const k = await pl.lees('kapot');
    ok('kapot bestand: plan null, met de fout, geen crash', k.plan === null && /JSON/.test(k.fouten[0]));
    ok('geen tijdelijke bestanden achtergebleven', readdirSync(map).every((f) => !f.endsWith('.tmp')));
    ok('lijst: set en kapot (niet .versies)', (await pl.lijst()).map((p) => p.naam).sort().join() === 'kapot,set');
    ok('het bestand is leesbare JSON met versie 2', JSON.parse(readFileSync(join(map, 'set.json'), 'utf8')).stappen !== undefined);
    const alleenRommel = await pl.schrijf('leeg', { stappen: [{ track: '' }] }, null);
    ok('alleen onbruikbare stappen: 400', alleenRommel.code === 400);
    let v = (await pl.lees('set')).versie;
    for (let i = 0; i < 55; i++) v = (await pl.schrijf('set', { stappen: [{ track: `t${i}` }] }, v)).antwoord.versie;
    ok(`hooguit 50 oude versies bewaard (${(await pl.versies('set')).length})`, (await pl.versies('set')).length === 50);
  } finally { rmSync(map, { recursive: true, force: true }); }
}

// Een planvenster van vóór in/uit (nog open tijdens een update) gooit ze weg
// bij een stap die het bewerkt (zijn normaliseerPlan kent ze niet); de andere
// stappen houden ze (het kopieert ze ongezien). Wie ze kent zegt dat (`kent`).
// Zonder: terug alleen op een stap die in de payload een id had en GEEN in- of
// uit-sleutel (wie er een schrijft kent ze), met hetzelfde nummer en hetzelfde
// begin. De 409-regel blijft precies zo.
console.log('\nopslag: een oud venster wist in/uit niet');
{
  const IN = { sectie: 2, label: 'drop', groep: 'B' }, UIT = { sectie: 5, label: 'break', groep: 'C' };
  const nu = M.normaliseerPlan({ stappen: [{ id: 's1', track: 'a', van: 31, in: IN, uit: UIT }, { id: 's2', track: 'b', uit: UIT }, { id: 's3', track: 'c', van: 10, in: IN }] }).plan;
  const herstel = (ruw, opties) => M.herstelSecties(nu, ruw, M.normaliseerPlan(ruw).plan, opties);
  // Zo slaat een oud venster op: s1 bewerkt (waarom), s2 ander nummer, s3 ander begin.
  const oud = { ...nu, stappen: [{ ...nu.stappen[0], waarom: 'x' }, { ...nu.stappen[1], track: 'z' }, { ...nu.stappen[2], van: 12 }]
    .map(({ in: _i, uit: _u, ...s }) => s) };
  const h = herstel(oud);
  const [h1, h2, h3] = h.plan.stappen;
  ok('zelfde stap, zelfde nummer en begin: in en uit terug', JSON.stringify(h1.in) === JSON.stringify(IN) && JSON.stringify(h1.uit) === JSON.stringify(UIT) && h1.waarom === 'x');
  ok('ander nummer: niets terug', !('in' in h2) && !('uit' in h2));
  ok('ander begin: in niet terug (van is de waarheid)', !('in' in h3));
  ok(`een melding per herstelde stap (${h.hersteld.join(' | ')})`, h.hersteld.length === 1 && /s1/.test(h.hersteld[0]));
  ok('wie in/uit kent: niets terug', herstel(oud, { kent: ['in', 'uit'] }).hersteld.length === 0);
  ok('herstellen is idempotent', JSON.stringify(M.herstelSecties(nu, h.plan, h.plan).plan) === JSON.stringify(h.plan));
  // Het echte oude venster: alleen de BEWERKTE stap verloor in/uit, de andere hebben ze nog in de payload.
  const echtOud = { ...nu, stappen: [(({ in: _i, uit: _u, ...s }) => ({ ...s, waarom: 'x' }))(nu.stappen[0]), nu.stappen[1], nu.stappen[2]] };
  const he = herstel(echtOud);
  ok('oud venster, andere stappen met in/uit in de payload: de bewerkte stap krijgt ze terug', he.plan.stappen[0].in?.sectie === 2
    && he.plan.stappen[0].uit?.sectie === 5 && he.hersteld.length === 1);

  // Bewuste wijzigingen (review 6 okt, (a)–(e)): nooit ongedaan maken.
  const R = { sectie: 3, label: 'deel', groep: 'C' };
  const nu2 = M.normaliseerPlan({ stappen: [{ id: 's1', track: 'x' }, { id: 's2', track: 'y' }, { id: 's3', track: 'a', van: 31, in: IN, uit: UIT }] }).plan;
  const herstel2 = (ruw) => M.herstelSecties(nu2, ruw, M.normaliseerPlan(ruw).plan);
  const xy = (s3) => ({ stappen: [{ id: 's1', track: 'x' }, { id: 's2', track: 'y' }, s3] });
  const a = herstel2(xy({ id: 's3', track: 'a', van: 60, in: R }));
  ok('(a) een nieuwe in en uit weg (curl, zonder kent): uit komt niet terug', !('uit' in a.plan.stappen[2]) && a.plan.stappen[2].in?.sectie === 3 && !a.hersteld.length);
  const bRuw = xy({ id: 's3', track: 'a', van: 31, in: { sectie: '3' }, uit: UIT });
  const b = herstel2(bRuw);
  ok(`(b) een kapotte in: de oude komt niet terug, geen tegenstrijdige melding (${[...M.normaliseerPlan(bRuw).fouten, ...b.hersteld].join(' | ')})`,
    !('in' in b.plan.stappen[2]) && !b.hersteld.length);
  const c = herstel2({ stappen: [{ track: 'q' }, { track: 'r' }, { track: 'a', van: 31 }] });
  ok('(c) een nieuw plan zonder ids: niets terug op het nummer op dezelfde plek', !('in' in c.plan.stappen[2]) && !('uit' in c.plan.stappen[2]) && !c.hersteld.length);
  const dRuw = xy({ track: 'a', van: 31 });
  const d = herstel2(dRuw);
  ok(`(d) een stap zonder id die id ${M.normaliseerPlan(dRuw).plan.stappen[2].id} krijgt: niets terug`, !('in' in d.plan.stappen[2]) && !('uit' in d.plan.stappen[2]) && !d.hersteld.length);
  const e = herstel2(xy({ id: 's3', track: 'a', van: 140, in: { sectie: 6, label: 'deel', groep: 'F' } }));
  ok('(e) in voorbij de oude uit, uit weg: uit niet terug, geen "bewaard"', !('uit' in e.plan.stappen[2]) && !e.hersteld.length);
  // (e) ook als het bewaarde plan zelf niet klopt: alleen melden wat het normaliseren overleeft.
  const scheef = { stappen: [{ id: 's1', track: 'a', van: 31, in: { sectie: 4, label: null, groep: null }, uit: { sectie: 2, label: null, groep: null } }] };
  const es = M.herstelSecties(scheef, { stappen: [{ id: 's1', track: 'a', van: 31 }] }, M.normaliseerPlan({ stappen: [{ id: 's1', track: 'a', van: 31 }] }).plan);
  ok(`(e) een teruggezette uit die wegvalt, wordt niet "bewaard" gemeld (${es.hersteld.join(' | ')})`, !('uit' in es.plan.stappen[0]) && es.hersteld.every((t) => !/uit/.test(t)));
  // Uit vóór het begin: een ander begin (oud venster typte een later begin) → uit niet terug.
  const later = herstel({ stappen: [{ id: 's1', track: 'a', van: 200 }, { id: 's2', track: 'b' }, { id: 's3', track: 'c', van: 10 }] });
  ok('ander begin: ook uit niet terug (hij kan nu vóór het begin liggen)', !('uit' in later.plan.stappen[0]) && !('in' in later.plan.stappen[0]));

  const map = mkdtempSync(join(tmpdir(), 'varve-plannen-'));
  try {
    const pl = new Plannen(map);
    const r1 = await pl.schrijf('set', nu, null, { kent: ['in', 'uit'] });
    ok('opslaan met in/uit: ze staan in het bestand', r1.code === 200 && JSON.parse(readFileSync(join(map, 'set.json'), 'utf8')).stappen[0].in?.sectie === 2);
    const r2 = await pl.schrijf('set', echtOud, r1.antwoord.versie);
    ok('een oud venster (zonder kent) slaat op: 200, in/uit van s1 bewaard, met een opmerking', r2.code === 200
      && r2.antwoord.plan.stappen[0].in?.sectie === 2 && r2.antwoord.plan.stappen[0].uit?.sectie === 5 && r2.antwoord.fouten.some((f) => /s1/.test(f)));
    const r3 = await pl.schrijf('set', { ...r2.antwoord.plan, stappen: r2.antwoord.plan.stappen.map(({ in: _i, ...s }) => s) }, r2.antwoord.versie, { kent: ['in', 'uit'] });
    ok('een venster dat in/uit kent mag ze weghalen', r3.code === 200 && !('in' in r3.antwoord.plan.stappen[0]) && r3.antwoord.plan.stappen[0].uit?.sectie === 5);
    ok('de 409-regel blijft: een oude versie botst, ook met kent', (await pl.schrijf('set', nu, r1.antwoord.versie, { kent: ['in', 'uit'] })).code === 409);
  } finally { rmSync(map, { recursive: true, force: true }); }
}

// vervangPlan: staat de volgende klaar en veranderde zijn in, dan opnieuw
// kiezen (zoals bij een ander nummer of beginpunt). Zijn uit bepaalt alleen de
// overgang DAARNA (gepland als hij klinkt): niet herladen. Alleen de
// beslissing; de rest van de automaat zit in auto.test.
console.log('\nautomaat: vervangPlan kent in en uit');
{
  const { Automaat } = await import('../src/auto/automaat.js');
  const IN = { sectie: 2, label: 'drop', groep: 'B' };
  const UIT = { sectie: 4, label: 'outro', groep: 'D' };
  const basis = { naam: 'live', stappen: [{ id: 's1', track: 'een' }, { id: 's2', track: 'twee', van: 30, in: IN, uit: UIT }, { id: 's3', track: 'drie' }] };
  const proef = (wijzig, welke = 1) => {
    const au = new Automaat({ engine: { deck: () => ({ position: 10, rate: 1, duration: 300 }) }, invoke: () => {}, laad: async () => {}, haalLibrary: async () => [] });
    au._zetPlan({ plan: basis, versie: 'v1' });
    Object.assign(au, { aan: true, fase: 'klaar', hoofd: 'A', hoofdStap: 's1', hoofdVan: 0, planIndex: 1,
      volgende: { deckId: 'B', track: { id: 'twee' }, van: 30, stapId: 's2', bron: 'plan', voorkeur: 'auto', waarom: '' } });
    let gepland = 0;
    au._planOvergang = () => { gepland++; };
    const p = JSON.parse(JSON.stringify(basis));
    wijzig(p.stappen[welke]);
    au.vervangPlan({ plan: p, versie: 'v2' });
    const uit = { fase: au.fase, volgende: !!au.volgende, gepland };
    au.vernietig();
    return uit;
  };
  const zelfde = proef((s) => { s.waarom = 'anders'; });
  ok('alleen waarom anders: dezelfde volgende, opnieuw gepland', zelfde.fase === 'klaar' && zelfde.volgende && zelfde.gepland === 1);
  const anderIn = proef((s) => { s.in = { sectie: 3, label: 'break', groep: 'C' }; });
  ok('een andere in (zelfde van): opnieuw kiezen', anderIn.fase === 'wacht' && !anderIn.volgende);
  const inWeg = proef((s) => { delete s.in; });
  ok('in weg (zelfde van): opnieuw kiezen', inWeg.fase === 'wacht' && !inWeg.volgende);
  const anderUit = proef((s) => { s.uit = { sectie: 5, label: 'outro', groep: 'E' }; });
  ok('een andere uit van de klaarstaande: NIET herladen, alleen opnieuw gepland', anderUit.fase === 'klaar' && anderUit.volgende && anderUit.gepland === 1);
  const uitWeg = proef((s) => { delete s.uit; });
  ok('uit van de klaarstaande weg: niet herladen', uitWeg.fase === 'klaar' && uitWeg.volgende);
  const uitNu = proef((s) => { s.uit = { sectie: 3, label: 'break', groep: 'C' }; }, 0);
  ok('een uit op de stap die NU klinkt: opnieuw gepland (_planOvergang), niet herladen', uitNu.fase === 'klaar' && uitNu.volgende && uitNu.gepland === 1);
  const anderLabel = proef((s) => { s.in = { ...IN, label: 'break' }; });
  ok('alleen het label van in anders: ook opnieuw kiezen', anderLabel.fase === 'wacht');
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
