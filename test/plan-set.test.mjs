// Spoor S9 (docs/PLAN-SET.md): het planformaat voor live bijmixen (tracks, go, lagen), een oude
// schrijver die ze niet kent, snel klaarzetten (volgorde, lengte, past-bij-keten) en de live-stand.
// Puur: geen browser, geen server. Draai met: node test/plan-set.test.mjs
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const M = await import('../src/plan/plan-model.js');
const K = await import('../src/plan/klaarzetten.js');
const L = await import('../src/plan/live.js');
const { voorspel } = await import('../src/plan/tijdlijn.js');

const nummer = (id, bpm, toon, { duur = 300, luid = -14, zeker = 0.9 } = {}) => ({ id, titel: id, duur, audio: 'x', loudness_i: luid,
  grid: { stukken: [{ van: 0, bpm, anker: 0, zekerheid: zeker }] }, toon: { stukken: [{ van: 0, toonsoort: toon, zekerheid: 0.9 }] } });

console.log('het formaat: tracks, go, lagen');
{
  const ruw = { tracks: { auto: [2, 1, 1, 9] }, stappen: [
    { track: 'a', go: 'wacht', lagen: [
      { soort: 'nummer', track: 'acap', op: { sectie: 3, label: 'drop', groep: 'C', sec: 64 }, stem: 'vocals', deck: 5, duur: 64 },
      { soort: 'sampler', pad: 3, op: { sec: 90 } },
      { soort: 'patroon', deck: 7, plek: 2, op: { sectie: 2 } },
      { soort: 'nummer', track: 'x', op: { sec: 10 }, deck: 1 },
      { soort: 'raar', op: { sec: 1 } },
      { soort: 'sampler', op: { sec: 1 } },
      { soort: 'patroon', deck: 2, plek: 1, op: { sec: 1 } },
    ] },
    { track: 'b', go: 'auto' }, { track: 'c', go: 'boem' }] };
  const { plan, fouten } = M.normaliseerPlan(ruw);
  ok('tracks: uniek, oplopend, alleen 1..8', JSON.stringify(plan.tracks) === '{"auto":[1,2]}');
  ok('go: alleen "wacht" blijft staan', plan.stappen[0].go === 'wacht' && !('go' in plan.stappen[1]) && !('go' in plan.stappen[2]));
  ok('... een onbekende go is een fout', fouten.some((f) => /boem/.test(f)));
  const l = plan.stappen[0].lagen;
  ok(`vier lagen blijven (${l?.length})`, l?.length === 4);
  ok('laag nummer: sectie met sec als terugval, stem, deck, duur, start auto', l[0].soort === 'nummer' && l[0].op.sectie === 3 && l[0].op.sec === 64
    && l[0].stem === 'vocals' && l[0].deck === 5 && l[0].duur === 64 && l[0].start === 'auto' && l[0].id === 'l1');
  ok('een laag op een track van de automaat: deck weg (kiest zelf), met een fout', l[3].deck === null && fouten.some((f) => /van de automaat/.test(f)));
  ok('rommel weg met een fout (soort, geen pad, patroon op een automaat-track)', fouten.filter((f) => /laag \d: .*weggelaten/.test(f)).length === 3);
  ok('nog eens normaliseren verandert niets', JSON.stringify(M.normaliseerPlan(plan).plan) === JSON.stringify(plan));
  const oud = M.normaliseerPlan({ stappen: [{ track: 'a' }] }).plan;
  ok('een plan zonder de nieuwe velden heeft ze niet (v2 blijft v2)', !('tracks' in oud) && !('go' in oud.stappen[0]) && !('lagen' in oud.stappen[0]) && oud.versie === 2);
  const zonder = M.bewerk(plan, { soort: 'zet', id: plan.stappen[0].id, velden: { go: null, lagen: [] } });
  ok('bewerk: go en lagen weg', !('go' in zonder.stappen[0]) && !('lagen' in zonder.stappen[0]));
  const t2 = M.bewerk(plan, { soort: 'tracks', tracks: { auto: [5, 6] } });
  ok('bewerk tracks: een laag op een track die nu van de automaat is verliest zijn deck', JSON.stringify(t2.tracks) === '{"auto":[5,6]}' && t2.stappen[0].lagen[0].deck === null);
  ok('bewerk tracks null: weg', !('tracks' in M.bewerk(plan, { soort: 'tracks', tracks: null })));
  const vs = M.verschil(plan, M.bewerk(t2, { soort: 'zet', id: plan.stappen[1].id, velden: { go: 'wacht' } }));
  ok(`verschil kent tracks en go (${JSON.stringify(vs)})`, vs.tracks === true && vs.anders.some((a) => a.id === plan.stappen[1].id && a.velden.includes('go')));
}

console.log('\neen oude schrijver (kent alleen in/uit) wist go, lagen en tracks niet');
{
  const nu = M.normaliseerPlan({ tracks: { auto: [1, 2] }, stappen: [
    { id: 's1', track: 'a', van: 10, go: 'wacht', lagen: [{ soort: 'sampler', pad: 1, op: { sec: 5 } }] },
    { id: 's2', track: 'b', go: 'wacht' }] }).plan;
  // Het oude venster bewerkte s1 (zijn normaliseerPlan gooide go en lagen weg) en schreef zonder tracks.
  const ruw = { naam: 'p', stappen: [{ id: 's1', track: 'a', van: 12, waarom: 'nieuw' }, { id: 's2', track: 'b', go: 'wacht' }] };
  const h = M.herstelVelden(nu, ruw, M.normaliseerPlan(ruw).plan, { kent: ['in', 'uit'] });
  ok('tracks terug', JSON.stringify(h.plan.tracks) === '{"auto":[1,2]}');
  ok('go en lagen terug op s1 (zelfde nummer, ander begin mag)', h.plan.stappen[0].go === 'wacht' && h.plan.stappen[0].lagen?.length === 1);
  ok('... met een opmerking', h.hersteld.some((t) => /s1: go en lagen bewaard/.test(t)) && h.hersteld.some((t) => /tracks/.test(t)));
  const nieuw = { naam: 'p', tracks: null, stappen: [{ id: 's1', track: 'a', go: null, lagen: [] }, { id: 's2', track: 'b' }] };
  const h2 = M.herstelVelden(nu, nieuw, M.normaliseerPlan(nieuw).plan, { kent: M.KENT });
  ok('wie ze kent (KENT) haalt ze bewust weg: niets terug', !h2.plan.tracks && !h2.plan.stappen[0].go && !h2.plan.stappen[0].lagen && !h2.plan.stappen[1].go && !h2.hersteld.length);
  const ander = { stappen: [{ id: 's1', track: 'z' }, { id: 's2', track: 'b' }] };
  const h3 = M.herstelVelden(nu, ander, M.normaliseerPlan(ander).plan, { kent: ['in', 'uit'] });
  ok('een ander nummer op s1: geen lagen terug', !h3.plan.stappen[0].lagen);
  ok('... s2 (zelfde nummer, geen go in de payload): go terug', h3.plan.stappen[1].go === 'wacht');
}

console.log('\nsnel klaarzetten: volgorde');
{
  // Twaalf nummers: tempo en luidheid lopen uiteen; een boog moet rustig beginnen en de piek op ~70% hebben.
  const toon = ['Am', 'Em', 'Bm', 'C', 'G', 'D', 'Am', 'Em', 'Dm', 'F', 'C', 'G'];
  const lib = toon.map((t, i) => nummer(`n${i + 1}`, 110 + i * 3, t, { luid: -20 + i }));
  const schud = [5, 0, 11, 3, 8, 1, 10, 6, 2, 9, 4, 7].map((i) => lib[i]);
  const set = K.maakSet(schud, { vorm: 'boog', naam: 'proef' });
  const ids = set.plan.stappen.map((s) => s.track);
  ok(`12 stappen, elk nummer één keer (${ids.join(' ')})`, ids.length === 12 && new Set(ids).size === 12);
  const e = (id) => Number(id.slice(1));
  const piek = ids.indexOf('n12');
  ok(`boog: begint rustig (${ids[0]}), piek rond 70% (plek ${piek + 1})`, e(ids[0]) <= 3 && piek >= 6 && piek <= 10);
  ok('boog: het eind is lager dan de piek', e(ids[11]) < 12);
  const op = K.maakSet(schud, { vorm: 'oplopend' }).plan.stappen.map((s) => e(s.track));
  ok(`oplopend loopt (bijna) op (${op.join(' ')})`, op.slice(1).filter((x, i) => x < op[i]).length <= 2 && op[0] <= 2 && op[11] >= 11);
  ok('zoals gekozen: de volgorde van de keuze', K.maakSet(schud, { vorm: 'zoals' }).plan.stappen.map((s) => s.track).join() === schud.map((t) => t.id).join());
  ok('deterministisch: twee keer dezelfde set', JSON.stringify(K.maakSet(schud, { vorm: 'boog' }).plan.stappen.map((s) => s.track)) === JSON.stringify(ids));
  ok('dubbele en nummers zonder audio vallen eruit (gemeld)', (() => { const r = K.maakSet([lib[0], lib[0], { ...lib[1], audio: false }]); return r.plan.stappen.length === 1 && r.meldingen.length === 1; })());
  ok('tracks van de automaat gaan mee in het plan', JSON.stringify(K.maakSet(lib, { tracks: { auto: [1, 2] } }).plan.tracks) === '{"auto":[1,2]}');
}

console.log('\nsnel klaarzetten: lengte');
{
  const lib = Array.from({ length: 12 }, (_, i) => nummer(`n${i + 1}`, 124, 'Am', { duur: 360 }));
  const vrij = K.maakSet(lib, { vorm: 'zoals' });
  ok(`zonder duur: ~${Math.round(vrij.totaal / 60)} min`, vrij.totaal > 50 * 60);
  const kort = K.maakSet(lib, { vorm: 'zoals', duur: 45 * 60 });
  ok(`45 min: past (${(kort.totaal / 60).toFixed(1)} min), stukken ingekort, alle 12 blijven`, kort.totaal <= 45 * 60 + 30 && kort.plan.stappen.length === 12
    && kort.plan.stappen.every((s) => s.speelduur >= K.MIN_STUK));
  const heelKort = K.maakSet(lib, { vorm: 'zoals', duur: 8 * 60 });
  ok(`8 min: nummers vallen af (${heelKort.plan.stappen.length} over), gemeld`, heelKort.totaal <= 8 * 60 + 30 && heelKort.plan.stappen.length < 12 && heelKort.meldingen.some((m) => /vielen af/.test(m)));
  ok('te kort voor de duur: gemeld, niets verzonnen', K.maakSet(lib.slice(0, 2), { duur: 90 * 60 }).meldingen.some((m) => /korter dan gevraagd/.test(m)));
  const nu = new Date(2026, 9, 14, 22, 0, 0);
  ok('eindtijd 23:30 om 22:00 = 90 min', K.secondenTot('23:30', nu) === 90 * 60);
  ok('eindtijd 01:30 om 22:00 = morgen, 3,5 uur', K.secondenTot('1:30', nu) === 3.5 * 3600);
  ok('geen tijd: null', K.secondenTot('half twee', nu) === null && K.secondenTot('25:00', nu) === null);
}

console.log('\nsnel klaarzetten: een "past bij"-keten');
{
  const lib = [nummer('a', 124, 'Am'), nummer('b', 125, 'Em'), nummer('c', 140, 'F#'), nummer('d', 126, 'Bm'), nummer('e', 124, 'C')];
  const k = K.pastBijKeten(lib[0], lib, { aantal: 4 }).map((t) => t.id);
  ok(`begint bij a, past eerst (${k.join(' ')})`, k[0] === 'a' && k.length === 4 && !k.slice(0, 3).includes('c'));
  ok('elk nummer één keer, ook als de rest niet past', K.pastBijKeten(lib[0], lib, { aantal: 10 }).length === 5);
}

console.log('\nde live-stand');
{
  const lib = new Map([['a', nummer('a', 124, 'Am')], ['b', nummer('b', 124, 'Am')], ['c', nummer('c', 124, 'Em')]]);
  const plan = M.normaliseerPlan({ stappen: [{ id: 's1', track: 'a' }, { id: 's2', track: 'b', go: 'wacht' }, { id: 's3', track: 'c' }] }).plan;
  const v = voorspel(plan, lib);
  const stand = { aan: true, fase: 'klaar', nu: { nr: 1, titel: 'a', rest: 100 },
    volgende: { nr: 2, titel: 'b', soort: 'lange blend', maten: 8, over: 20, voortgang: null, bron: 'plan', go: { wacht: true, uiterlijk: 60 } },
    plan: { index: 1, hoofdStap: 's1', volgendeStap: 's2' } };
  const nuMs = new Date(2026, 9, 14, 22, 0, 0).getTime();
  const s = L.liveStand({ stand, plan, voorspelling: v, titelVan: (id) => lib.get(id)?.titel ?? id, nuMs });
  ok(`NU / VOLGENDE / DAARNA (${s.tekst.nu} | ${s.tekst.volgende} | ${s.tekst.daarna})`, /NU 1 · a · nog 1:40/.test(s.tekst.nu)
    && /VOLGENDE b · wacht op GO \(uiterlijk over 1:00\)/.test(s.tekst.volgende) && s.daarna?.stap === 's3');
  const verwacht = 100 + (v.totaal - v.stappen[1].start) - v.stappen[1].overlap;
  ok(`eindtijd = rest van NU + de rest van het plan na de overlap (${s.tekst.eind})`, Math.abs(s.eind.sec - verwacht) < 1e-6 && /^klaar ~2\d:\d\d/.test(s.tekst.eind));
  const uit = L.liveStand({ stand: { aan: false, fase: 'uit', plan: { index: 0 } }, plan, voorspelling: v, nuMs });
  ok('uit: geen NU, wel de verwachte duur van het hele plan', !uit.nu && uit.eind?.voorspeld && Math.abs(uit.eind.sec - v.totaal) < 1e-6);
}

console.log(fails.length ? `\n${fails.length} FOUT:\n  ${fails.join('\n  ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
