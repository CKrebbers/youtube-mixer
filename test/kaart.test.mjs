// De muziekkaart als zoeklaag (server/kaart.js, docs/KAART.md): laden en
// herladen, zoeken, filteren, sorteren, pagineren op een verzonnen kaart;
// de wenslijst (grens van 20, dubbele, al binnen); een YouTube-versie zoeken
// met een ingeprikte zoeker (geen netwerk) en de score; de standaardvolgorde
// van de nacht met zijn uitsluitingen; en de bewaker: geen cookie-optie in
// enige yt-dlp-aanroep in server/. Draai met: node test/kaart.test.mjs
// @alleen: tijdsgrens op de wandklok (laden, sorteren, zoeken van 18 763 rijen) (test/alles.mjs draait hem na de pool, zonder iets ernaast)
import { mkdtempSync, rmSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { Kaart, KaartFout, KAART_SCHEMA, SORTERINGEN, FILTERS, SLIM, scoreKandidaat, leesZoekresultaat, normaliseerNummer, plat, ZEKER,
  MAX_WENSEN_ZONDER_BEVESTIGING } = await import('../server/kaart.js');
const { NUMMERS, kratten, schrijfKaart, nummer } = await import('./nep-kaart.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const gooit = (f, code) => { try { f(); return false; } catch (e) { return e instanceof KaartFout && (code === undefined || e.code === code) ? e : false; } };

const map = mkdtempSync(join(tmpdir(), 'varve-kaart-'));
const pad = join(map, 'varve-kaart.json');
schrijfKaart(pad);

/** Een nep-library: twee nummers "binnen". */
const binnen = new Set(['binnen000001', 'los000000001']);
const library = { alleIds: () => [...binnen], track: (id) => (binnen.has(id) ? { id, titel: `track ${id}` } : null) };

try {
  // ---- laden ----------------------------------------------------------------------
  console.log('laden en herladen');
  let klok = 1_000_000;
  const logs = [];
  const kaart = new Kaart({ pad, db: join(map, 'kaart.db'), library, klok: () => klok, log: (s) => logs.push(s) });
  ok(`eigen schema met versie (v${kaart.versie} = KAART_SCHEMA.length)`, kaart.versie === KAART_SCHEMA.length && kaart.versie >= 1);
  const stand = kaart.stand();
  ok(`geladen: ${stand.aantal} nummers, gebouwd ${stand.gebouwd}`, stand.status === 'geladen' && stand.aantal === NUMMERS.length && stand.gebouwd === '2026-10-10T12:00:00+02:00' && stand.fout === null);
  ok('de kratten met aantal en hoeveel binnen', stand.kratten.find((k) => k.id === 'slim:vertrouwd')?.aantal === 5
    && stand.kratten.find((k) => k.id === 'slim:vertrouwd')?.binnen === 1 && stand.kratten.find((k) => k.id === 'pl:PLnachtwerk')?.aantal === 3
    && stand.kratten.find((k) => k.id === 'slim:proefkrat')?.aantal === 0);
  ok('de slimme kratten uit het bestand zijn gelijk aan de regels in SLIM', kratten().filter((k) => k.soort === 'slim' && k.id !== 'slim:proefkrat')
    .every((k) => { const naam = k.id.slice(5); const uit = NUMMERS.filter(SLIM[naam]).map((n) => n.sleutel).sort().join(); return uit === [...k.sleutels].sort().join(); }));
  ok('niet elk verzoek leest opnieuw (mtime gelijk)', (kaart.stand(), kaart.stand(), logs.filter((l) => /geladen/.test(l)).length === 1));

  // Het bestand verandert: een nummer erbij, nieuwe mtime -> herladen.
  const j = JSON.parse(readFileSync(pad, 'utf8'));
  j.nummers.push(nummer({ youtube_id: 'nieuw0000001', artiest: 'Nieuw', titel: 'Erbij', beurten: 1 }));
  j.gebouwd = '2026-10-10T13:00:00+02:00';
  writeFileSync(pad, JSON.stringify(j));
  utimesSync(pad, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  const s2 = kaart.stand();
  ok(`herladen als het bestand verandert (${s2.aantal}, ${s2.gebouwd})`, s2.aantal === NUMMERS.length + 1 && s2.gebouwd === '2026-10-10T13:00:00+02:00');
  // Terug naar de vaste fixture voor de rest.
  schrijfKaart(pad); utimesSync(pad, new Date(Date.now() + 10000), new Date(Date.now() + 10000));
  ok('en weer terug', kaart.stand().aantal === NUMMERS.length);

  // Kapot bestand: status fout, de vorige kaart blijft staan.
  writeFileSync(pad, '{ kapot'); utimesSync(pad, new Date(Date.now() + 15000), new Date(Date.now() + 15000));
  const s3 = kaart.stand();
  ok(`kapot bestand: status fout met reden, de oude kaart blijft bruikbaar ("${s3.fout?.slice(0, 30)}")`, s3.status === 'fout' && s3.fout && s3.aantal === NUMMERS.length);
  schrijfKaart(pad); utimesSync(pad, new Date(Date.now() + 20000), new Date(Date.now() + 20000));
  ok('hersteld bestand: weer geladen', kaart.stand().status === 'geladen');

  // Ontbreekt.
  const leeg = new Kaart({ pad: join(map, 'bestaat-niet.json'), db: ':memory:', library, log: () => {} });
  const s4 = leeg.stand();
  ok('ontbrekend bestand: status ontbreekt, 0 nummers, de slimme kratten bestaan (leeg)', s4.status === 'ontbreekt' && s4.aantal === 0 && s4.fout === null
    && s4.kratten.length === Object.keys(SLIM).length && s4.kratten.every((k) => k.aantal === 0));
  ok('nummers op een ontbrekende kaart: leeg, totaal 0', leeg.nummers({}).totaal === 0);
  leeg.sluit();

  // ---- normaliseren -----------------------------------------------------------------
  console.log('\nnormaliseren');
  const n0 = normaliseerNummer({ sleutel: 'yt:a', artiest: 'Élan', titel: 'Zomer' });
  ok('elk veld bestaat, onbekend = null/[]/{}', n0.youtube_id === null && Array.isArray(n0.alternatieven) && n0.beurten === null && typeof n0.per_jaar === 'object'
    && n0.klasse === 'muziek' && n0.like === null);
  ok('zoek-veld wordt zelf gemaakt als het ontbreekt, zonder accenten', n0.zoek === 'elan zomer');
  ok('sorteersleutels zonder accenten, niet naar buiten', n0.artiest_sleutel === 'elan' && !Object.keys(n0).includes('artiest_sleutel') && !JSON.stringify(n0).includes('artiest_sleutel'));
  ok('plat(): kleine letters, geen accenten', plat('Ólafur Arnalds — Þú') === 'olafur arnalds — þu');

  // ---- zoeken, filteren, sorteren, pagineren --------------------------------------------
  console.log('\nzoeken, filteren, sorteren, pagineren');
  const alles = kaart.nummers({ aantal: 500 });
  ok(`standaard: op beurten aflopend (${alles.nummers.slice(0, 3).map((n) => n.beurten).join(',')})`,
    alles.totaal === NUMMERS.length && alles.nummers[0].beurten === 60 && alles.nummers[1].beurten === 50);
  ok('elk nummer heeft binnen en wens', alles.nummers.every((n) => 'binnen' in n && 'wens' in n) && alles.nummers.find((n) => n.sleutel === 'yt:binnen000001').binnen === 'binnen000001'
    && alles.nummers.find((n) => n.sleutel === 'yt:fourtet0baby').binnen === null && alles.nummers.every((n) => n.wens === null));
  ok('wat geen waarde heeft staat achteraan (beurten null)', (() => {
    const z = kaart.nummers({ sorteer: 'gekeken', aantal: 500 }).nummers;
    return z[z.length - 1].gekeken === null && z[0].gekeken === 7;
  })());
  const zoek = kaart.nummers({ zoek: 'four' });
  ok(`zoek=four: ${zoek.totaal} (video én Spotify)`, zoek.totaal === 2 && zoek.nummers.every((n) => /four/i.test(n.artiest)));
  ok('zoeken zonder accent vindt met accent ("elan")', kaart.nummers({ zoek: 'elan' }).totaal === 1);
  ok('zoeken op playlistnaam via het zoek-veld', kaart.nummers({ zoek: 'nachtwerk' }).totaal === 1);
  ok('% en _ zijn gewone tekens', kaart.nummers({ zoek: '%' }).totaal === 0 && kaart.nummers({ zoek: '_' }).totaal === 0);
  ok('filter binnen / niet-binnen / geen-video', kaart.nummers({ filter: 'binnen' }).totaal === 1 && kaart.nummers({ filter: 'niet-binnen' }).totaal === NUMMERS.length - 1
    && kaart.nummers({ filter: 'geen-video' }).totaal === 2);
  ok('slimme filters = de krat', kaart.nummers({ filter: 'vertrouwd' }).totaal === 5 && kaart.nummers({ filter: 'eigen-likes' }).totaal === 4
    && kaart.nummers({ filter: 'vergeten' }).totaal === 1 && kaart.nummers({ filter: 'evergreens' }).totaal === 1
    && kaart.nummers({ filter: 'geliket-nooit-gespeeld' }).totaal === 1 && kaart.nummers({ filter: 'eigen-keuze' }).totaal === 1);
  ok('meerdere filters met komma = en', kaart.nummers({ filter: 'vertrouwd,niet-binnen' }).totaal === 4 && kaart.nummers({ filter: 'eigen-likes,geen-video' }).totaal === 1);
  ok('krat: alleen die sleutels, in de volgorde van de krat (sorteer=krat standaard)', kaart.nummers({ krat: 'pl:PLnachtwerk' }).nummers.map((n) => n.sleutel).join()
    === 'yt:vertrouwd002,yt:fourtet0baby,yt:eigenlike001');
  ok('krat met een sortering: die sortering', kaart.nummers({ krat: 'pl:PLnachtwerk', sorteer: 'beurten' }).nummers[0].sleutel === 'yt:fourtet0baby');
  ok('krat omgekeerd', kaart.nummers({ krat: 'pl:PLnachtwerk', richting: 'af' }).nummers[0].sleutel === 'yt:eigenlike001');
  ok('eigen-likes op like_datum aflopend', kaart.nummers({ sorteer: 'like_datum', filter: 'eigen-likes' }).nummers.map((n) => n.like_datum).join() === '2024-07-01,2024-06-01,2024-05-01,2023-05-01');
  const titels = kaart.nummers({ sorteer: 'titel', aantal: 500 }).nummers.map((n) => n.titel);
  ok(`titel op, zonder accenten ("${titels[0]}" … "${titels[titels.length - 1]}")`, titels[0] === 'Alfa' && titels.includes('Zomer') && titels.indexOf('Zomer') === titels.length - 1);
  ok('artiest op: Élan tussen de e', (() => { const a = kaart.nummers({ sorteer: 'artiest', aantal: 500 }).nummers.map((n) => n.artiest); return a.indexOf('Élan Vital') < a.indexOf('Four Tet') && a.indexOf('Élan Vital') > a.indexOf('Dixon'); })());
  ok('duur op: kortste eerst', kaart.nummers({ sorteer: 'duur' }).nummers[0].duur === 240 && kaart.nummers({ sorteer: 'duur', richting: 'af' }).nummers[0].duur === 5400);
  ok('laatst af: nieuwste eerst, null achteraan', kaart.nummers({ sorteer: 'laatst' }).nummers[0].laatst === '2025-11-30');
  // Pagineren: geen overlap, alles precies één keer.
  const p1 = kaart.nummers({ van: 0, aantal: 5 }), p2 = kaart.nummers({ van: 5, aantal: 5 }), p3 = kaart.nummers({ van: 10, aantal: 5 });
  const samen = [...p1.nummers, ...p2.nummers, ...p3.nummers].map((n) => n.sleutel);
  ok(`pagina's van 5: ${p1.nummers.length}+${p2.nummers.length}+${p3.nummers.length}, totaal ${p1.totaal}, geen dubbele`, samen.length === NUMMERS.length
    && new Set(samen).size === NUMMERS.length && p1.totaal === NUMMERS.length && p2.van === 5);
  ok('voorbij het eind: leeg, totaal blijft', kaart.nummers({ van: 1000, aantal: 5 }).nummers.length === 0 && kaart.nummers({ van: 1000, aantal: 5 }).totaal === NUMMERS.length);
  ok('onbekende sortering: 400', !!gooit(() => kaart.nummers({ sorteer: 'constructor' }), 400) && !!gooit(() => kaart.nummers({ sorteer: 'bpm' }), 400));
  ok('onbekend filter: 400', !!gooit(() => kaart.nummers({ filter: 'lekker' }), 400));
  ok('onbekende krat: 404', !!gooit(() => kaart.nummers({ krat: 'pl:bestaatniet' }), 404));
  ok('aantal buiten 1..500 en van < 0: 400', !!gooit(() => kaart.nummers({ aantal: 0 }), 400) && !!gooit(() => kaart.nummers({ aantal: 501 }), 400) && !!gooit(() => kaart.nummers({ van: -1 }), 400));
  ok('richting anders dan op/af: 400', !!gooit(() => kaart.nummers({ richting: 'omhoog' }), 400));
  ok('sorteer=krat zonder krat: 400', !!gooit(() => kaart.nummers({ sorteer: 'krat' }), 400));
  ok('alle sorteringen uit het contract bestaan', ['beurten', 'laatst', 'titel', 'artiest', 'duur', 'like_datum', 'gekeken'].every((s) => s in SORTERINGEN));
  ok('alle filters uit het contract bestaan', ['binnen', 'niet-binnen', 'geen-video', 'vertrouwd', 'vergeten', 'evergreens', 'geliket-nooit-gespeeld', 'eigen-keuze', 'eigen-likes'].every((f) => FILTERS.includes(f)));
  const een = kaart.nummer('yt:fourtet0baby');
  ok('één nummer op sleutel, met binnen en wens', een?.titel === 'Baby' && een.binnen === null && een.wens === null && kaart.nummer('yt:nee') === null);

  // Snelheid: 18.763 rijen, zoals de echte kaart.
  {
    const groot = join(map, 'groot.json');
    const veel = [];
    for (let i = 0; i < 18763; i++) veel.push(nummer({ youtube_id: `g${String(i).padStart(10, '0')}`, artiest: `Artiest ${i % 997}`, titel: `Titel ${i}`, beurten: (i * 7919) % 300, duur: 100 + (i % 500), like: i % 9 === 0 ? 'eigen' : null, like_datum: i % 9 === 0 ? '2024-01-01' : null }));
    schrijfKaart(groot, { nummers: veel });
    const g = new Kaart({ pad: groot, db: ':memory:', library, log: () => {} });
    const t0 = performance.now(); g.laad(); const laadMs = performance.now() - t0;
    const t1 = performance.now(); g.nummers({ sorteer: 'titel', aantal: 100 }); const sortMs = performance.now() - t1;   // eerste keer: sorteren
    const t2 = performance.now(); g.nummers({ sorteer: 'titel', van: 9000, aantal: 100 }); const paginaMs = performance.now() - t2;
    const t3 = performance.now(); const z = g.nummers({ zoek: 'titel 1234', filter: 'niet-binnen' }); const zoekMs = performance.now() - t3;
    const t4 = performance.now(); g.stand(); const standMs = performance.now() - t4;
    ok(`18.763 rijen: laden ${laadMs.toFixed(0)} ms, eerste sortering ${sortMs.toFixed(1)} ms, pagina ${paginaMs.toFixed(1)} ms, zoeken ${zoekMs.toFixed(1)} ms (${z.totaal}), stand ${standMs.toFixed(1)} ms`,
      laadMs < 3000 && sortMs < 500 && paginaMs < 100 && zoekMs < 100 && standMs < 200);
    g.sluit();
  }

  // ---- wensen ---------------------------------------------------------------------------
  console.log('\nwensen');
  klok = 2_000_000;
  const w1 = kaart.voegWensen(['yt:fourtet0baby', 'sp:sp0000000001']);
  ok('twee wensen toegevoegd', w1.ok && w1.toegevoegd.length === 2 && w1.geweigerd.length === 0);
  ok('nog eens: geweigerd als dubbel met reden', (() => { const r = kaart.voegWensen(['yt:fourtet0baby']); return r.toegevoegd.length === 0 && /al op de lijst/.test(r.geweigerd[0].reden); })());
  ok('dubbel in dezelfde vraag: één keer', (() => { const r = kaart.voegWensen(['yt:vertrouwd002', 'yt:vertrouwd002']); return r.toegevoegd.length === 1 && /dubbel/.test(r.geweigerd[0].reden); })());
  ok('al binnen: geweigerd', (() => { const r = kaart.voegWensen(['yt:binnen000001']); return r.toegevoegd.length === 0 && r.geweigerd[0].reden === 'al binnen'; })());
  ok('niet op de kaart: geweigerd', (() => { const r = kaart.voegWensen(['yt:bestaatniet']); return r.geweigerd[0].reden === 'niet op de kaart'; })());
  ok('geen lijst: 400', !!gooit(() => kaart.voegWensen([]), 400) && !!gooit(() => kaart.voegWensen('yt:x'), 400));
  const veel = Array.from({ length: MAX_WENSEN_ZONDER_BEVESTIGING + 1 }, (_, i) => `yt:x${i}`);
  const e409 = gooit(() => kaart.voegWensen(veel), 409);
  ok(`meer dan ${MAX_WENSEN_ZONDER_BEVESTIGING} zonder bevestig: 409 { fout: "meer dan 20", aantal }`, !!e409 && e409.message === 'meer dan 20' && e409.extra.aantal === 21);
  ok(`precies ${MAX_WENSEN_ZONDER_BEVESTIGING}: mag zonder bevestig`, !gooit(() => kaart.voegWensen(veel.slice(0, 20))));
  ok('met bevestig: mag (alles geweigerd want niet op de kaart, maar geen 409)', (() => { const r = kaart.voegWensen(veel, { bevestig: true }); return r.ok && r.geweigerd.length === 21; })());
  const lijst = kaart.wensen();
  ok(`de lijst: ${lijst.length}, oudste eerst, status wacht, youtube_id uit de kaart`, lijst.length === 3 && lijst[0].sleutel === 'yt:fourtet0baby' && lijst.every((w) => w.status === 'wacht')
    && lijst[0].youtube_id === 'fourtet0baby' && lijst[1].youtube_id === null && lijst[0].gevraagd === 2_000_000 && lijst[0].track === null && lijst[0].nummer.titel === 'Baby');
  ok('het nummer draagt zijn wens', kaart.nummer('yt:fourtet0baby').wens?.status === 'wacht' && kaart.nummers({ zoek: 'baby' }).nummers[0].wens.status === 'wacht');
  ok('volgendeWens = de oudste die wacht', kaart.volgendeWens().sleutel === 'yt:fourtet0baby');
  ok('status zetten', kaart.zetWens('yt:fourtet0baby', { status: 'bezig' }).status === 'bezig' && kaart.volgendeWens().sleutel === 'sp:sp0000000001');
  ok('onbekende status gooit', (() => { try { kaart.zetWens('yt:fourtet0baby', { status: 'zoem' }); return false; } catch { return true; } })());
  ok('verwijderen', kaart.verwijderWens('yt:vertrouwd002') === true && kaart.verwijderWens('yt:vertrouwd002') === false && kaart.wensen().length === 2);
  ok('een mislukte wens mag opnieuw gevraagd worden', (() => { kaart.zetWens('yt:fourtet0baby', { status: 'mislukt', fout: 'x' }); const r = kaart.voegWensen(['yt:fourtet0baby']); return r.toegevoegd.length === 1 && kaart.wens('yt:fourtet0baby').status === 'wacht' && kaart.wens('yt:fourtet0baby').fout === null; })());
  ok('wensen overleven een herstart (eigen kaart.db)', (() => { kaart.sluit(); const k2 = new Kaart({ pad, db: join(map, 'kaart.db'), library, log: () => {} }); const n = k2.wensen().length; k2.sluit(); return n === 2; })());

  // ---- score en zoeken ------------------------------------------------------------------
  console.log('\nscore en zoeken van een YouTube-versie');
  const kaart2 = new Kaart({ pad, db: join(map, 'kaart.db'), library, klok: () => klok, log: () => {} });
  kaart2.laad();
  const ft = kaart2.perSleutel.get('sp:sp0000000001');   // Four Tet, 300 s
  ok('alles raak = 1,0 (zeker)', scoreKandidaat(ft, { titel: 'Four Tet - Two Thousand and Seventeen', kanaal: 'Four Tet - Topic', duur: 301 }).score === 1 && 1 >= ZEKER);
  ok('kanaal is de artiest telt ook', scoreKandidaat(ft, { titel: 'Two Thousand and Seventeen', kanaal: 'Four Tet', duur: 300 }).score === 1);
  const twee = scoreKandidaat(ft, { titel: 'Four Tet - Two Thousand and Seventeen', kanaal: 'Fan', duur: 300 });
  ok(`twee van de drie komt nooit boven ZEKER (${twee.score})`, twee.score < ZEKER && twee.score > 0.5 && /lengte/.test(twee.reden) && /titel/.test(twee.reden));
  ok('lengte binnen 5 s: half', scoreKandidaat(ft, { titel: 'x', kanaal: 'y', duur: 304 }).score === 0.2 && scoreKandidaat(ft, { titel: 'x', kanaal: 'y', duur: 310 }).score === 0);
  ok('zonder bekende duur nooit zeker', scoreKandidaat({ ...ft, duur: null }, { titel: 'Two Thousand and Seventeen', kanaal: 'Four Tet - Topic', duur: 300 }).score < ZEKER);
  ok('niets raak: 0 met reden', scoreKandidaat(ft, { titel: 'REACTION', kanaal: 'Reacties', duur: 600 }).reden === 'niets herkend');
  ok('leesZoekresultaat: alleen entries met een id', leesZoekresultaat({ entries: [{ id: 'abcdefghijk', title: 't', channel: 'c', duration: 3 }, { id: null }, null, { id: 'x' }] }).length === 1
    && leesZoekresultaat(null).length === 0);

  const vragen = [];
  kaart2.zoeker = async (vraag) => {
    vragen.push(vraag);
    if (/Nils/.test(vraag)) return { ok: false, fout: 'HTTP Error 403: Forbidden' };
    return { ok: true, kandidaten: [
      { youtube_id: 'reactie00001', titel: 'REACTION', kanaal: 'Reacties', duur: 600 },
      { youtube_id: 'topic0000001', titel: 'Four Tet - Two Thousand and Seventeen', kanaal: 'Four Tet - Topic', duur: 300 },
      { youtube_id: 'clip00000001', titel: 'Four Tet - Two Thousand and Seventeen (clip)', kanaal: 'FourTetVEVO', duur: 312 },
    ] };
  };
  const z1 = await kaart2.zoek('sp:sp0000000001');
  ok(`zoekvraag "<artiest> <titel>" ("${vragen[0]}")`, vragen[0] === 'Four Tet Two Thousand and Seventeen');
  ok('kandidaten op score, beste eerst, met reden', z1.kandidaten[0].youtube_id === 'topic0000001' && z1.kandidaten[0].score === 1 && z1.kandidaten[2].youtube_id === 'reactie00001'
    && z1.kandidaten.every((k) => 'youtube_id' in k && 'titel' in k && 'kanaal' in k && 'duur' in k && 'score' in k && 'reden' in k));
  ok('de wens staat nu op kies, met de kandidaten erbij', kaart2.wens('sp:sp0000000001').status === 'kies' && kaart2.wensen().find((w) => w.sleutel === 'sp:sp0000000001').kandidaten.length === 3);
  ok('onbekende sleutel: 404', await kaart2.zoek('sp:nee').then(() => false, (e) => e instanceof KaartFout && e.code === 404));
  const fout = await kaart2.zoek('sp:sp0000000002').then(() => null, (e) => e);
  ok(`zoeken mislukt: 502 met de fout van yt-dlp erin ("${fout?.message}")`, fout instanceof KaartFout && fout.code === 502 && /403/.test(fout.message));
  ok('zoeken op een nummer zonder wens maakt geen wens', kaart2.wens('sp:sp0000000002') === null);
  const gekozen = kaart2.kies('sp:sp0000000001', 'clip00000001');
  ok('kies: de wens krijgt die id en staat weer op wacht', gekozen.status === 'wacht' && gekozen.youtube_id === 'clip00000001' && kaart2.nummer('sp:sp0000000001').wens.youtube_id === 'clip00000001');
  ok('kies zonder wens maakt er een', kaart2.kies('sp:sp0000000002', 'topic0000002').status === 'wacht' && kaart2.wens('sp:sp0000000002').youtube_id === 'topic0000002');
  ok('kies met een onzinnige id: 400; onbekende sleutel: 404', !!gooit(() => kaart2.kies('sp:sp0000000001', 'a b'), 400) && !!gooit(() => kaart2.kies('yt:nee', 'abcdefghijk'), 404));

  // ---- de standaardvolgorde van de nacht -------------------------------------------------
  console.log('\nstandaardvolgorde (vertrouwd, dan eigen likes; de uitsluitingen)');
  const k3 = new Kaart({ pad, db: ':memory:', library, log: () => {} });
  const volg = k3.standaardVolgorde();
  ok(`volgorde: ${volg.join(' ')}`, volg.join() === 'yt:fourtet0baby,yt:vergeten0001,yt:vertrouwd002,yt:eigenlike002,yt:eigenlike001');
  ok('nooit al binnen (binnen000001 is vertrouwd én eigen like)', !volg.includes('yt:binnen000001'));
  ok('nooit twijfel', !volg.includes('yt:twijfel00001'));
  ok('nooit een set zonder wens', !volg.includes('yt:eenset000001'));
  ok('nooit > 15 min zonder wens', !volg.includes('yt:telang000001'));
  ok('nooit alleen-overzet', !volg.includes('yt:overzet00001'));
  ok('nooit zonder video (Spotify-likes wachten op een wens)', !volg.some((s) => s.startsWith('sp:')));
  ok('vertrouwd met een overzet-like hoort wel bij vertrouwd (beurten tellen)', volg.includes('yt:vertrouwd002'));
  ok('eigen likes op beurten aflopend', volg.indexOf('yt:eigenlike002') < volg.indexOf('yt:eigenlike001'));
  k3.voegWensen(['yt:fourtet0baby']);
  ok('een nummer met een wens (welke status ook) niet nog eens', !k3.standaardVolgorde().includes('yt:fourtet0baby') && k3.standaardVolgorde({ grens: 1 }).join() === 'yt:vergeten0001');
  k3.zetWens('yt:fourtet0baby', { status: 'mislukt', fout: 'x' });
  ok('ook niet als hij mislukte (niet elke nacht opnieuw)', !k3.standaardVolgorde().includes('yt:fourtet0baby'));
  ok('mist het bestand een slimme krat, dan komt hij uit de regels', (() => {
    const p = join(map, 'zonder-slim.json');
    const j2 = { versie: 1, gebouwd: 'x', nummers: NUMMERS, kratten: [] };
    writeFileSync(p, JSON.stringify(j2));
    const k = new Kaart({ pad: p, db: ':memory:', library, log: () => {} });
    const r = k.standaardVolgorde().join() === volg.join() && k.stand().kratten.find((x) => x.id === 'slim:vertrouwd')?.aantal === 5;
    k.sluit(); return r;
  })());
  k3.sluit();

  // ---- nacht_runs -----------------------------------------------------------------------
  console.log('\nnacht_runs');
  const id = kaart2.beginRun('nu', 5_000_000);
  ok('een run begint zonder einde', kaart2.laatsteRun().begonnen === 5_000_000 && kaart2.laatsteRun().klaar === null);
  kaart2.eindRun(id, { klaar: 5_000_900, gehaald: 3, mislukt: 1, reden: 'klaar: 3 gehaald' });
  ok('en eindigt met gehaald, mislukt, reden', (() => { const r = kaart2.laatsteRun(); return r.klaar === 5_000_900 && r.gehaald === 3 && r.mislukt === 1 && r.reden === 'klaar: 3 gehaald' && r.soort === 'nu'; })());
  ok('runs(): nieuwste eerst', kaart2.runs()[0].id === id);
  kaart2.sluit();

  // ---- de bewaker: nooit cookies ------------------------------------------------------------
  console.log('\nnooit cookies in een yt-dlp-aanroep');
  {
    const serverMap = new URL('../server/', import.meta.url);
    const bestanden = readdirSync(serverMap).filter((f) => f.endsWith('.js'));
    // Een cookie-optie als ARGUMENT staat altijd als los tekstje tussen aanhalingstekens
    // (`'--cookies', pad` of `'--cookies-from-browser'`). Een vermelding in een zin
    // (de hint in links.js die zegt dat het er bewust NIET in zit) heeft dat niet.
    const treffers = [];
    for (const f of bestanden) {
      const tekst = readFileSync(new URL(f, serverMap), 'utf8');
      tekst.split('\n').forEach((regel, i) => { if (/['"`]--cookies/.test(regel) || /--cookies[\w-]*\s*[,=]\s*['"`]/.test(regel)) treffers.push(`${f}:${i + 1}`); });
    }
    ok(`geen enkele yt-dlp-aanroep in server/*.js (${bestanden.length} bestanden) geeft een cookie-optie mee${treffers.length ? ` (${treffers.join(', ')})` : ''}`, treffers.length === 0);
    const kaartTekst = readFileSync(new URL('kaart.js', serverMap), 'utf8');
    ok('kaart.js zoekt met ytsearch5 en --flat-playlist -J', /ytsearch5:/.test(kaartTekst) && /'--flat-playlist', '-J'/.test(kaartTekst));
    ok('kaart.js en nacht.js noemen cookies alleen om ze uit te sluiten', !/cookies-from-browser|--cookies\b/.test(kaartTekst) && !/--cookies/.test(readFileSync(new URL('nacht.js', serverMap), 'utf8')));
  }
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
