// Spoor S9 (docs/PLAN-SET.md §6): sets in de mixer (src/ui/sets.js) met een nep-server (fetch) en
// een nep-mixer. Bewaren met versie (409 = melding, niets overschreven), terugladen zet plan,
// patronen en werkruimte; de momentopname alleen als gevraagd, over een spelende track pas bij de
// tweede druk binnen 3 s; een ontbrekend nummer = één melding, de rest laadt; er start niets.
// En maakZetMoment: nummers gewoon uit de library, dan de stand met het grid van NU.
// Draai met: node test/sets-mixer.test.mjs
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const { maakSets, maakZetMoment, ZEKER_MS } = await import('../src/ui/sets.js');
const { KENT } = await import('../src/plan/plan-model.js');

/** Een nep-server met plannen, patronen en sets (versie = teller), en een log van wat er gebeurde. */
function nepServer() {
  const db = { plannen: { 'auto-plan': { plan: { naam: 'auto-plan', stappen: [{ id: 's1', track: 'a' }, { id: 's2', track: 'b' }] }, versie: 'p1' } },
    patronen: { set: { set: { naam: 'set', tempo: 128 }, versie: 't1' } }, sets: {} };
  const log = [];
  let n = 1;
  const antwoord = (status, d) => ({ status, ok: status >= 200 && status < 300, json: async () => d });
  const haal = async (pad, opties = {}) => {
    const methode = opties.method || 'GET';
    const body = opties.body ? JSON.parse(opties.body) : null;
    log.push([methode, pad, body]);
    let m;
    if (pad === '/api/sets') return antwoord(200, { sets: Object.keys(db.sets).map((naam) => ({ naam, nummers: db.sets[naam].set.plan?.stappen?.length ?? 0 })) });
    for (const [soort, re, veld] of [['plannen', /^\/api\/plannen\/([\w-]+)$/, 'plan'], ['patronen', /^\/api\/patronen\/([\w-]+)$/, 'set'], ['sets', /^\/api\/sets\/([\w-]+)$/, 'set']]) {
      if ((m = re.exec(pad))) {
        const nu = db[soort][m[1]];
        if (methode === 'GET') return nu ? antwoord(200, { [veld]: nu[veld], versie: nu.versie }) : antwoord(404, { fout: 'weg' });
        if ((nu?.versie ?? null) !== (body.versie ?? null)) return antwoord(409, { fout: 'botsing', versie: nu?.versie ?? null });
        db[soort][m[1]] = { [veld]: body[veld], versie: `v${n++}`, kent: body.kent };
        return antwoord(200, { [veld]: body[veld], versie: db[soort][m[1]].versie });
      }
    }
    return antwoord(404, {});
  };
  return { db, log, haal };
}

const meldingen = [];
const meld = (t, s) => meldingen.push([t, s]);
let klok = 0;
const speelt = new Set();
const gebruikt = [];
const werk = { naam: 'standaard', kies: async (n) => { werk.naam = n; } };
let gezet = null;
const S = nepServer();
const momentVanNu = { focus: 1, tracks: [{ track: 1, bron: 'library', nummer: 'a', positie: 30, speelt: true }, { track: 2, bron: 'library', nummer: 'weg' }, { track: 3, bron: 'leeg' }], waarden: { 'track.1.fader': 0.7 } };
const sets = maakSets({ haal: S.haal, meld, nu: () => klok, plan: () => ({ naam: () => 'auto-plan', gebruik: async (n) => { gebruikt.push(n); }, bewaard() {} }),
  werk: () => werk, patronenNaam: () => 'set', speelt: (nr) => speelt.has(nr), moment: () => momentVanNu,
  zetMoment: async (m) => { gezet = m; return { zonder: [] }; }, library: async () => [{ id: 'a' }, { id: 'b' }] });

console.log('bewaren');
{
  werk.naam = 'twee-handen';
  const r = await sets.bewaar('vrijdag', { metMoment: true });
  const op = S.db.sets.vrijdag?.set;
  ok('bewaard: plan (kopie), patronen (kopie, met naam), werkruimte (naam), momentopname', r.ok && op.plan.stappen.length === 2 && op.patronen.naam === 'set'
    && op.patronen.set.tempo === 128 && op.werkruimte === 'twee-handen' && op.momentopname?.tracks?.length === 3);
  ok('... als nieuw (versie null)', S.log.find(([m, p]) => m === 'PUT' && p === '/api/sets/vrijdag')[2].versie === null);
  S.db.sets.vrijdag.versie = 'van-claude';      // iemand anders schreef hem intussen
  meldingen.length = 0;
  const b = await sets.bewaar('vrijdag');
  ok('een botsing (409): niets overschreven, een melding', !b.ok && S.db.sets.vrijdag.versie === 'van-claude' && meldingen.some(([t, s]) => /intussen gewijzigd/.test(t) && s === 'fout'));
  ok('een ongeldige naam: niets gestuurd', !(await sets.bewaar('Vrij dag')).ok);
  werk.naam = 'standaard';
  await sets.bewaar('leeg', { metMoment: false, nieuw: true });
  ok('zonder werkruimte (standaard) en zonder mixer', S.db.sets.leeg.set.werkruimte === null && S.db.sets.leeg.set.momentopname === null);
}

console.log('\nterugladen');
{
  S.db.sets.vrijdag = { set: { ...S.db.sets.vrijdag.set, plan: { stappen: [{ id: 's1', track: 'a' }, { id: 's2', track: 'weg' }] } }, versie: 'x' };
  meldingen.length = 0; gezet = null;
  const r = await sets.terugladen('vrijdag');
  const putPlan = S.log.filter(([m, p]) => m === 'PUT' && p === '/api/plannen/vrijdag').at(-1);
  ok('het plan wordt plan "vrijdag", met versie en kent: KENT, en actief', r.ok && putPlan && putPlan[2].versie === null && JSON.stringify(putPlan[2].kent) === JSON.stringify(KENT)
    && gebruikt.at(-1) === 'vrijdag');
  ok('de patronen gaan naar de set van de mixer, met zijn versie', S.log.filter(([m, p]) => m === 'PUT' && p === '/api/patronen/set').at(-1)?.[2]?.versie === 't1');
  ok('de werkruimte op naam', werk.naam === 'twee-handen');
  ok('zonder "met mixer": geen momentopname', gezet === null);
  ok(`een nummer dat er niet meer is: één melding, de rest laadt (${r.ontbreekt})`, r.ontbreekt.join() === 'weg' && meldingen.filter(([t]) => /weg staat niet/.test(t)).length === 1);
}

console.log('\nterugladen met de mixer');
{
  speelt.add(1);
  meldingen.length = 0; gezet = null;
  const r1 = await sets.terugladen('vrijdag', { metMoment: true });
  ok('track 1 speelt: de eerste druk vraagt, niets gezet', r1.vraag && !gezet && meldingen.some(([t]) => /druk nog eens/.test(t)));
  klok += ZEKER_MS + 1;
  const r2 = await sets.terugladen('vrijdag', { metMoment: true });
  ok('na 3 s telt hij weer als eerste druk', r2.vraag && !gezet);
  klok += 1000;
  const r3 = await sets.terugladen('vrijdag', { metMoment: true });
  ok('de tweede druk binnen 3 s: de momentopname', r3.ok && !!gezet);
  ok('... met niets dat speelt, en het ontbrekende nummer als lege track', gezet.tracks.every((t) => !t.speelt && !t.wacht) && gezet.tracks.find((t) => t.track === 2).bron === 'leeg');
  speelt.clear();
  gezet = null;
  ok('niets speelt: meteen', (await sets.terugladen('vrijdag', { metMoment: true })).ok && !!gezet);
}

console.log('\nmaakZetMoment: nummers uit de library, de stand met het grid van NU');
{
  const grid = (b) => ({ toJSON: () => ({ stukken: [{ van: 0, bpm: b, anker: 0 }] }) });
  const decks = { A: { buffer: null, playing: false, pause() { this.playing = false; } }, B: { buffer: 1, playing: true, grid: grid(120), pause() { this.playing = false; } } };
  const herkomst = { B: { bron: 'library', nummer: 'b' } };
  const geladen = [];
  let stand = null;
  const zet = maakZetMoment({ engine: { deck: (id) => decks[id] }, tracks: [[1, 'A'], [2, 'B']],
    laadLibrary: async (id, t) => { geladen.push([id, t.id]); decks[id].buffer = 1; decks[id].grid = grid(126); herkomst[id] = { bron: 'library', nummer: t.id }; return true; },
    uitvoerder: { stand: async (st) => { stand = st; return { zonder: [] }; } }, herkomst: (id) => herkomst[id] ?? null });
  const r = await zet({ tracks: [{ track: 1, bron: 'library', nummer: 'a', grid: { oud: true } }, { track: 2, bron: 'library', nummer: 'b', grid: { oud: true } }] }, [{ id: 'a' }, { id: 'b' }]);
  ok('track 1 geladen uit de library; track 2 had het nummer al (niet opnieuw)', geladen.length === 1 && geladen[0].join() === 'A,a' && r.zonder.length === 0);
  ok('de stand krijgt het grid van NU, niet dat van toen', stand.tracks[0].grid.stukken[0].bpm === 126 && stand.tracks[1].grid.stukken[0].bpm === 120);
  ok('... en niets speelt', stand.tracks.every((t) => t.speelt === false && t.wacht === false));
}

console.log(fails.length ? `\n${fails.length} FOUT:\n  ${fails.join('\n  ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
