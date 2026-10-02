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

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
