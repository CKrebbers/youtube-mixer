// De kaart-tab als rekenwerk (src/ui/kaart-lijst.js): tab en sortering
// onthouden, filters, de url, de stand van een nummer en zijn knop, badges,
// cellen, kratkiezer, bevestigen bij veel, zoekkandidaten, de teksten van de
// nachtwachtrij. Plus de nep-server (tools/headless/kaart-nep.mjs) tegen het
// contract (deel 2), en de pagina-cache van de library op kaart-pagina's.
// Geen DOM: kaart-panel.js hangt dit aan het scherm (headless: tools/headless/kaart.mjs).
const K = await import('../src/ui/kaart-lijst.js');
const L = await import('../src/ui/library-lijst.js');
const { maakKaartNep, SORTERING, FILTERS, nepKandidaten } = await import('../tools/headless/kaart-nep.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const geheugen = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const FIXTURE = new URL('./fixtures/varve-kaart.klein.json', import.meta.url).pathname;

console.log('de tab onthouden');
{
  const o = geheugen();
  ok('niets bewaard: library', K.leesTab(o) === 'library');
  K.bewaarTab(o, 'kaart');
  ok('kaart bewaard en teruggelezen onder varve.library.tab', K.leesTab(o) === 'kaart' && o.getItem('varve.library.tab') === 'kaart');
  K.bewaarTab(o, 'onzin');
  ok('een onbekende tab wordt niet bewaard', K.leesTab(o) === 'kaart');
  o.setItem(K.TAB_SLEUTEL, 'constructor');
  ok('een objectnaam in de opslag: library', K.leesTab(o) === 'library');
  const gooit = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('Quota'); } };
  let fout = null;
  try { K.bewaarTab(gooit, 'kaart'); ok('opslag die gooit: library, geen crash', K.leesTab(gooit) === 'library'); } catch (e) { fout = e; }
  ok('en bewaren gooit niet door', fout === null);
}

console.log('\nsorteren');
{
  ok('dezelfde sleutels als de (nep-)server, met dezelfde eerste richting',
    JSON.stringify(Object.keys(K.SORTERINGEN).sort()) === JSON.stringify(Object.keys(SORTERING).sort())
    && Object.entries(K.SORTERINGEN).every(([k, r]) => SORTERING[k].eerst === r));
  ok('elke sorteerbare kolom bestaat als sleutel', K.KOLOMMEN.filter((k) => k.sorteer).every((k) => k.sorteer in K.SORTERINGEN));
  ok('standaard: beurten aflopend', K.STANDAARD_SORTERING.sorteer === 'beurten' && K.STANDAARD_SORTERING.richting === 'af');
  let s = K.volgendeSortering(K.STANDAARD_SORTERING, 'titel');
  ok('klik op titel: A→Z', s.sorteer === 'titel' && s.richting === 'op');
  s = K.volgendeSortering(s, 'titel');
  ok('nog eens: Z→A', s.richting === 'af');
  ok('laatst begint met de laatste bovenaan', K.volgendeSortering(s, 'laatst').richting === 'af');
  // sorteer=krat (de volgorde van de krat zelf, server/kaart.js): alleen met een krat.
  ok('effectieveSortering: krat zonder krat valt terug op beurten af; met krat blijft hij', JSON.stringify(K.effectieveSortering(K.KRAT_SORTERING, '')) === JSON.stringify(K.STANDAARD_SORTERING)
    && JSON.stringify(K.effectieveSortering(K.KRAT_SORTERING, 'pl:x')) === JSON.stringify(K.KRAT_SORTERING) && K.effectieveSortering(null, '').sorteer === 'beurten');
  ok('sorteringBijKrat: een krat kiezen met de standaard = kratvolgorde; een eigen keuze blijft; geen krat = niets', JSON.stringify(K.sorteringBijKrat(K.STANDAARD_SORTERING, 'pl:x')) === JSON.stringify(K.KRAT_SORTERING)
    && K.sorteringBijKrat({ sorteer: 'titel', richting: 'op' }, 'pl:x').sorteer === 'titel' && K.sorteringBijKrat(K.STANDAARD_SORTERING, '').sorteer === 'beurten');
  ok('kolommenVoor: met een krat de kratkolom vooraan (sorteer krat), zonder de gewone kolommen', K.kolommenVoor(true)[0].id === 'krat' && K.kolommenVoor(true)[0].sorteer === 'krat'
    && K.kolommenVoor(true).length === K.KOLOMMEN.length + 1 && K.kolommenVoor(false) === K.KOLOMMEN);
  ok('de kratkolom toont het rangnummer alleen als het paneel er een geeft', K.KRAT_KOLOM.cel({}, 0, { volgnr: 7 }) === '7' && K.KRAT_KOLOM.cel({}, 0, {}) === '' && K.KRAT_KOLOM.cel({}, 0, { volgnr: null }) === '');
  ok('de kop van de kratkolom is sorteerbaar', /data-sorteer="krat"/.test(L.kopHtml(K.KRAT_SORTERING, '', K.kolommenVoor(true))) && /aria-sort="ascending"/.test(L.kopHtml(K.KRAT_SORTERING, '', K.kolommenVoor(true))));
  ok('onbekend (bronnen, stand, constructor) verandert niets', K.volgendeSortering(s, 'bronnen') === s && K.volgendeSortering(s, 'constructor') === s);
  const o = geheugen();
  K.bewaarSortering(o, { sorteer: 'laatst', richting: 'op' });
  ok('bewaard onder varve.kaart.sortering (los van de library)', K.leesSortering(o).sorteer === 'laatst' && o.getItem('varve.kaart.sortering') && !o.getItem(L.SORTEER_SLEUTEL));
  o.setItem(K.SORTEER_SLEUTEL, '{"sorteer":"bpm","richting":"op"}');
  ok('een library-kolom die de kaart niet kent: de standaard', K.leesSortering(o).sorteer === 'beurten');
}

console.log('\nfilters');
{
  let f = K.wisselFilter([], 'niet-binnen');
  ok('niet binnen aan', f.join() === 'niet-binnen');
  f = K.wisselFilter(f, 'geen-video');
  ok('geen video erbij, in de volgorde van FILTERS', f.join() === 'niet-binnen,geen-video');
  f = K.wisselFilter(f, 'binnen');
  ok('binnen sluit niet-binnen uit', f.join() === 'binnen,geen-video');
  f = K.wisselFilter(f, 'binnen');
  ok('nog eens: uit', f.join() === 'geen-video');
  ok('onbekend filter: niets', K.wisselFilter(f, 'vertrouwd').join() === 'geen-video');
  ok('elk filter van de UI kent de server', K.FILTERS.every((x) => FILTERS.includes(x.id)));
  const html = K.filterKnoppenHtml(['geen-video']);
  ok('knoppen met aria-pressed', /data-filter="geen-video"[^>]*aria-pressed="true"/.test(html) && /data-filter="binnen"[^>]*aria-pressed="false"/.test(html));
  ok('url: zoek, krat, filter met komma, sortering, van/aantal',
    K.kaartUrl({ zoek: 'a&b', krat: 'pl:X', filters: ['niet-binnen', 'geen-video'], sorteer: 'laatst', richting: 'af' }, 2, 100)
    === '/api/kaart/nummers?sorteer=laatst&richting=af&van=200&aantal=100&zoek=a%26b&krat=pl%3AX&filter=niet-binnen%2Cgeen-video');
  ok('zonder zoek/krat/filter alleen de sortering', K.kaartUrl({ sorteer: 'beurten', richting: 'af' }, 0) === '/api/kaart/nummers?sorteer=beurten&richting=af&van=0&aantal=100');
}

console.log('\nstand en knop');
{
  const basis = { sleutel: 'yt:abc', youtube_id: 'abc', artiest: 'A', titel: 'T', binnen: null, wens: null };
  const staat = { decks: ['A', 'B'], label: (d) => (d === 'A' ? '1' : '2'), standen: ['leeg', 'speelt'], speelt: false, bezig: new Set(), gekozen: new Map() };
  ok('met video, niet binnen: kandidaat', K.standVan(basis) === 'kandidaat');
  ok('zonder video: geen-video', K.standVan({ ...basis, youtube_id: null }) === 'geen-video');
  ok('binnen wint van alles', K.standVan({ ...basis, binnen: 'abc', wens: { status: 'wacht' } }) === 'binnen');
  ok('een wens die wacht/zoekt/kies/bezig/mislukt: die status', ['wacht', 'zoekt', 'kies', 'bezig', 'mislukt'].every((s) => K.standVan({ ...basis, wens: { status: s } }) === s));
  ok('geannuleerd telt niet als wens', K.standVan({ ...basis, wens: { status: 'geannuleerd' } }) === 'kandidaat');
  ok('klaar zonder binnen: klaar (de lijst is verouderd)', K.standVan({ ...basis, wens: { status: 'klaar' } }) === 'klaar');
  const kand = K.standCelHtml(basis, staat);
  ok('kandidaat: knop "haal binnen" met data-haal', /data-haal="yt:abc"/.test(kand) && kand.includes('>haal binnen<') && !/disabled/.test(kand));
  const uit = K.standCelHtml(basis, { ...staat, speelt: true });
  ok('deck speelt: uitgeschakeld met de uitleg in de tooltip', /disabled/.test(uit) && uit.includes(K.SPEELT_UITLEG.slice(0, 20)));
  const geen = K.standCelHtml({ ...basis, youtube_id: null, sleutel: 'sp:x"y' }, staat);
  ok('geen video: knop "zoek", sleutel ontsnapt', /data-zoek="sp:x&quot;y"/.test(geen) && geen.includes('>zoek<'));
  ok('zoek ook uit als een deck speelt', /disabled/.test(K.standCelHtml({ ...basis, youtube_id: null }, { ...staat, speelt: true })));
  const bin = K.standCelHtml({ ...basis, binnen: 'trk<1>' }, staat);
  ok('binnen: een laadknop per deck met track-id en de stand van het deck',
    (bin.match(/data-deck="/g) || []).length === 2 && /data-deck="A" data-track="trk&lt;1&gt;"/.test(bin) && /lib-trk speelt" data-deck="B"/.test(bin) && bin.includes('>1<') && bin.includes('>2<'));
  ok('bezig: de knoppen staan uit met …', /disabled/.test(K.standCelHtml({ ...basis, binnen: 'x' }, { ...staat, bezig: new Set(['yt:abc']) })));
  const wacht = K.standCelHtml({ ...basis, wens: { status: 'wacht' } }, staat);
  ok('wacht: tekst en × (van de wenslijst)', wacht.includes('>wacht<') && /data-weg="yt:abc"/.test(wacht) && !/data-haal/.test(wacht));
  const mis = K.standCelHtml({ ...basis, wens: { status: 'mislukt', fout: '<403>' } }, staat);
  ok('mislukt: tekst, de fout ontsnapt in de tooltip, ×', mis.includes('>mislukt<') && mis.includes('&lt;403&gt;') && !mis.includes('<403>') && /data-weg/.test(mis));
  ok('bezig: alleen tekst', K.standCelHtml({ ...basis, wens: { status: 'bezig' } }, staat).includes('>bezig…<') && !/<button/.test(K.standCelHtml({ ...basis, wens: { status: 'bezig' } }, staat)));
  ok('kies: een knop die de kandidaten toont', /data-zoek="yt:abc"/.test(K.standCelHtml({ ...basis, wens: { status: 'kies' } }, staat)));
  const gek = K.standCelHtml({ ...basis, youtube_id: null, wens: { status: 'wacht' } }, { ...staat, gekozen: new Map([['yt:abc', { youtube_id: 'q', titel: 'Q <live>' }]]) });
  ok('gekozen: "gekozen: …" met knop "anders", ook met een wens die wacht', gek.includes('gekozen: Q &lt;live&gt;') && /data-anders="yt:abc"/.test(gek) && !/data-zoek/.test(gek));
}

console.log('\nbadges en cellen');
{
  const n = {
    sleutel: 'sp:1', youtube_id: null, artiest: 'A & B', titel: '<b>T</b>', versie: 'Nacht Edit', kanaal: null, youtube_titel: null,
    duur: 262.4, duur_bron: 'spotify_schatting', klasse: 'twijfel', vorm: 'live', beurten: 41, gekozen: 20, overgeslagen: 3, uren: 2.9,
    eerst: '2019-03-02', laatst: '2025-11-30', per_jaar: { 2020: 29, 2019: 12 }, like: 'eigen', like_datum: '2024-05-01',
    playlists: ['Nachtwerk', 'Dag'], gekeken: 7, yt_laatst: '2025-10-01', binnen: null, wens: null,
  };
  const b = K.badges(n);
  ok('badges: ♥ eigen, ≡ playlist, ▶ gekeken, ♫ spotify-only (in die volgorde)', b.map((x) => x.teken).join('') === '♥≡▶♫');
  ok('overzet-like: ⇄, geen ♥', K.badges({ ...n, like: 'overzet' }).map((x) => x.teken).join('') === '⇄≡▶♫');
  ok('met video, zonder likes/playlists, nooit gekeken: geen badges', K.badges({ youtube_id: 'x', playlists: [], gekeken: 0 }).length === 0);
  ok('tooltips noemen de playlists en het aantal keer gekeken', b[1].titel.includes('Nachtwerk, Dag') && b[2].titel.includes('7×'));
  const nu = new Date(2026, 9, 10, 12, 0).getTime();
  const html = K.cellenHtml ? '' : L.cellenHtml(n, nu, { decks: [], bezig: new Set(), gekozen: new Map() }, K.KOLOMMEN);
  ok('één cel per kolom', (html.match(/<span class="/g) || []).length >= K.KOLOMMEN.length);
  ok('titel en artiest ontsnapt, de versie klein erachter, twijfel gemarkeerd', html.includes('&lt;b&gt;T&lt;/b&gt;') && html.includes('A &amp; B') && html.includes('kaart-versie') && html.includes('kaart-twijfel'));
  ok('duur als schatting: ~4:22', html.includes('>~4:22<'));
  ok('beurten als getal, laatst kort met een hint per jaar', html.includes('>41<') && html.includes('>30 nov 25<') && html.includes('2019: 12, 2020: 29'));
  ok('sjabloon: artiest vast, titel rekt, stand vast breed (acht knoppen)', L.kolomSjabloon(K.KOLOMMEN).startsWith('150px minmax(160px, 1fr)') && L.kolomSjabloon(K.KOLOMMEN).endsWith('276px max-content'));
  const kop = L.kopHtml(K.STANDAARD_SORTERING, '', K.KOLOMMEN);
  ok('kop: beurten ▼ aan, titel/artiest/duur/laatst sorteerbaar, bronnen en stand niet',
    kop.includes('beurten<i>▼</i>') && ['titel', 'artiest', 'duur', 'laatst'].every((s) => kop.includes(`data-sorteer="${s}"`)) && !kop.includes('data-sorteer="bronnen"') && !kop.includes('data-sorteer="stand"'));
  ok('duur onbekend: —; echte YouTube-lengte zonder ~', K.duurTekst({ duur: null }) === '—' && K.duurTekst({ duur: 61, duur_bron: 'youtube' }) === '1:01');
  ok('datumIso: null of onzin is —', K.datumIso(null) === '—' && K.datumIso('nooit') === '—');
  ok('alsRij geeft id = sleutel (voor de PaginaCache), alsPagina de vorm van /api/library',
    K.alsRij(n).id === 'sp:1' && JSON.stringify(Object.keys(K.alsPagina({ nummers: [n], totaal: 1, van: 0 }))) === '["tracks","totaal","van"]');
}

console.log('\nkratten, bevestigen, kandidaten');
{
  const kratten = [
    { id: 'pl:B', naam: 'Zomer', soort: 'playlist', aantal: 10, binnen: 2 }, { id: 'slim:eigen-likes', naam: 'eigen likes', soort: 'slim', aantal: 8, binnen: 0 },
    { id: 'pl:A', naam: 'Avond', soort: 'playlist', aantal: 3, binnen: 0 }, { id: 'slim:vertrouwd', naam: 'vertrouwd', soort: 'slim', aantal: 5, binnen: 5 },
  ];
  const html = K.kratOptiesHtml(kratten, 'pl:B', 40);
  const volg = [...html.matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
  ok('volgorde: hele kaart, slimme kratten (vaste volgorde), playlists op naam', volg.join() === ',slim:vertrouwd,slim:eigen-likes,pl:A,pl:B');
  ok('aantal en binnen erbij, de gekozen staat geselecteerd', html.includes('vertrouwd (5 · 5 binnen)') && html.includes('Avond (3)') && /value="pl:B" selected/.test(html) && html.includes('hele kaart (40)'));
  ok('kratVan', K.kratVan(kratten, 'pl:A')?.naam === 'Avond' && K.kratVan(kratten, 'x') === null);
  ok('bevestigen vanaf 21', !K.moetBevestigen(20) && K.moetBevestigen(21));
  ok('tekst met aantal × 50 MB', K.bevestigingsTekst(30, '"Zomer"') === '30 nummers uit "Zomer" op de wenslijst zetten? Schatting: 30 × 50 MB = 1,5 GB aan audio.');
  ok('onder een GB in MB', K.mbTekst(19 * 50) === '950 MB');
  ok('wensUitkomst: toegevoegd en geweigerd per reden', K.wensUitkomst({ toegevoegd: ['a', 'b'], geweigerd: [{ sleutel: 'c', reden: 'staat al in de library' }, { sleutel: 'd', reden: 'staat al in de library' }] }).tekst === '2 op de wenslijst · 2 geweigerd: staat al in de library');
  ok('wensUitkomst meteen: "naar de wachtrij"; niets: niet goed', K.wensUitkomst({ toegevoegd: ['a'], geweigerd: [] }, { meteen: true }).tekst === '1 naar de wachtrij' && K.wensUitkomst({ toegevoegd: [], geweigerd: [{ reden: 'x' }] }).goed === false);
  const kand = [{ youtube_id: 'a', score: 0.5 }, { youtube_id: 'b', score: 0.92 }, { youtube_id: 'c', score: 0.95 }];
  ok('de zekere kandidaat is de hoogste ≥ 0,9', K.zekereKandidaat(kand).youtube_id === 'c');
  ok('geen zekere: null', K.zekereKandidaat([{ youtube_id: 'a', score: 0.89 }]) === null && K.zekereKandidaat([]) === null);
  const lijst = K.kieslijstHtml('sp:1', [{ youtube_id: 'v"1', titel: '<T>', kanaal: 'K', duur: 125, score: 0.95, reden: 'r' }], 56, { gekozen: 'v"1' });
  ok('kieslijst: knop per kandidaat met id ontsnapt, titel/kanaal/duur/score, de gekozen aan, × sluit, onder zijn rij',
    lijst.includes('data-kies="v&quot;1" data-id="sp:1"') && lijst.includes('&lt;T&gt;') && lijst.includes('2:05') && lijst.includes('0,95') && lijst.includes('kaart-kandidaat on') && lijst.includes('data-kies-sluit="sp:1"') && lijst.includes('top:56px'));
  ok('kieslijst zonder kandidaten zegt dat', K.kieslijstHtml('x', []).includes('geen kandidaten gevonden'));
}

console.log('\nnachtwachtrij');
{
  ok('speeldagenTekst: "10 okt (vandaag)", ander jaar met jaartal, gesorteerd, leeg = geen, onzin eruit',
    K.speeldagenTekst(['2026-10-10'], '2026-10-10T12:00:00+02:00') === '10 okt (vandaag)'
    && K.speeldagenTekst(['2026-10-10', '2025-12-31'], '2026-10-10T12:00:00+02:00') === '31 dec 25, 10 okt (vandaag)'
    && K.speeldagenTekst([], 1) === 'geen' && K.speeldagenTekst(['gisteren'], 1) === 'geen' && K.speeldagenTekst(undefined) === 'geen');
}
{
  const t = K.wensTelling([{ status: 'wacht' }, { status: 'wacht' }, { status: 'kies' }, { status: 'klaar' }, { status: 'mislukt' }, { status: 'bezig' }, { status: 'onzin' }]);
  ok('telling per status', t.wacht === 2 && t.kies === 1 && t.klaar === 1 && t.mislukt === 1 && t.bezig === 1 && t.totaal === 7);
  ok('tekst: wacht (incl. zoekt/kies) · klaar · mislukt, bezig voorop', K.wensTellingTekst(t) === '1 bezig · 3 wacht · 1 klaar · 1 mislukt');
  ok('geen run: dat staat er', K.laatsteRunTekst(null) === 'nog geen run geweest');
  const nu = new Date(2026, 9, 10, 9, 0).getTime();
  const run = K.laatsteRunTekst({ begonnen: new Date(2026, 9, 10, 1, 5).toISOString(), klaar: new Date(2026, 9, 10, 3, 40).toISOString(), gehaald: 80, mislukt: 1, reden: null }, nu);
  ok('laatste run: van–tot, gehaald, mislukt', run === 'vandaag 01:05–03:40: 80 gehaald, 1 mislukt');
  ok('gestopt met reden, en een run die nog loopt', K.laatsteRunTekst({ begonnen: new Date(2026, 9, 9, 1, 0).toISOString(), klaar: null, gehaald: 3, reden: '429' }, nu) === 'gisteren 01:00 (loopt): 3 gehaald, gestopt: 429');
  ok('stand: uit / aan met volgende / vannacht niet / bezig',
    K.nachtStandTekst({ aan: false }) === 'nachtwachtrij uit' && K.nachtStandTekst({ aan: true, vandaagNiet: true }) === 'nachtwachtrij aan, vannacht niet'
    && K.nachtStandTekst({ aan: true, bezig: true }) === 'nachtwachtrij: bezig' && K.nachtStandTekst({ aan: true, volgende: new Date(2026, 9, 11, 1, 0).toISOString() }, nu) === 'nachtwachtrij aan, volgende 11 okt 01:00');
  ok('wijziging: aan/uit, vandaag niet', JSON.stringify(K.nachtWijziging('aan', true)) === '{"aan":true}' && JSON.stringify(K.nachtWijziging('vandaagNiet', 1)) === '{"vandaagNiet":true}');
  ok('per nacht: een geheel getal 1..500, anders null', JSON.stringify(K.nachtWijziging('perNacht', '80')) === '{"perNacht":80}' && K.nachtWijziging('perNacht', '0') === null && K.nachtWijziging('perNacht', 'x') === null);
  ok('venster: het hele venster mee, alleen een geldige tijd', JSON.stringify(K.nachtWijziging('tot', '06:30', { venster: { van: '02:00', tot: '07:00' } })) === '{"venster":{"van":"02:00","tot":"06:30"}}' && K.nachtWijziging('van', '25:00') === null);
  ok('onbekend veld: null', K.nachtWijziging('cookies', true) === null);
}

console.log('\nde nep-server tegen het contract (deel 2)');
{
  const nep = maakKaartNep({ kaart: FIXTURE, binnen: (n) => (n.sleutel === 'yt:nep000xxxxx' || n.sleutel === 'yt:nep001xxxxx' ? n.youtube_id : null) });
  const poort = await nep.start(0);
  const api = async (pad, opties) => { const r = await fetch(`http://127.0.0.1:${poort}${pad}`, opties); return { status: r.status, j: await r.json() }; };
  const post = (pad, body) => api(pad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const k = (await api('/api/kaart')).j;
  ok('GET /api/kaart: geladen, 40 nummers, 3 kratten met aantal en binnen', k.status === 'geladen' && k.aantal === 40 && k.kratten.length === 3 && k.kratten[0].aantal === 8 && k.kratten.every((x) => 'binnen' in x));
  const alles = (await api('/api/kaart/nummers?aantal=500')).j;
  ok('nummers: totaal 40, op beurten aflopend, met binnen en wens', alles.totaal === 40 && alles.nummers.length === 40 && alles.nummers[0].beurten >= alles.nummers[1].beurten && alles.nummers[0].binnen === 'nep000xxxxx' && alles.nummers[0].wens === null);
  ok('elk veld van het contract staat op elke rij', ['sleutel', 'youtube_id', 'alternatieven', 'spotify_uri', 'artiest', 'titel', 'versie', 'kanaal', 'youtube_titel', 'duur', 'duur_bron', 'klasse', 'vorm', 'beurten', 'gekozen', 'overgeslagen', 'uren', 'eerst', 'laatst', 'per_jaar', 'like', 'like_datum', 'playlists', 'gekeken', 'yt_laatst', 'zoek'].every((v) => alles.nummers.every((n) => v in n)));
  const p2 = (await api('/api/kaart/nummers?van=10&aantal=5')).j;
  ok('pagineren: van/aantal, totaal blijft het geheel', p2.nummers.length === 5 && p2.van === 10 && p2.totaal === 40 && p2.nummers[0].sleutel === alles.nummers[10].sleutel);
  ok('onbekende sortering = 400', (await api('/api/kaart/nummers?sorteer=bpm')).status === 400);
  const titel = (await api('/api/kaart/nummers?sorteer=titel&aantal=3')).j.nummers.map((n) => n.titel);
  ok('sorteren op titel: A→Z', titel.join() === [...titel].sort((a, b) => a.localeCompare(b)).join());
  const duur = (await api('/api/kaart/nummers?sorteer=duur&richting=af&aantal=40')).j.nummers;
  ok('duur aflopend, onbekend achteraan', duur[0].duur >= duur[1].duur && duur.at(-1).duur === null);
  const zoek = (await api('/api/kaart/nummers?zoek=nevelkust')).j;
  ok('zoeken op artiest (kleine letters, via het zoek-veld)', zoek.totaal === 5 && zoek.nummers.every((n) => n.artiest === 'Nevelkust'));
  ok('zoeken met een accent of hoofdletters vindt hetzelfde', (await api('/api/kaart/nummers?zoek=N%C3%A9velkust')).j.totaal === 5);
  const krat = (await api('/api/kaart/nummers?krat=slim:vertrouwd&aantal=50')).j;
  ok('krat: alleen zijn sleutels', krat.totaal === 8 && krat.nummers.every((n) => n.beurten >= 25 && n.youtube_id));
  ok('onbekende krat = 404', (await api('/api/kaart/nummers?krat=pl:bestaat-niet')).status === 404);
  ok('filter binnen / niet-binnen / geen-video', (await api('/api/kaart/nummers?filter=binnen')).j.totaal === 2 && (await api('/api/kaart/nummers?filter=niet-binnen')).j.totaal === 38 && (await api('/api/kaart/nummers?filter=geen-video')).j.totaal === 10);
  ok('filters met komma', (await api('/api/kaart/nummers?filter=niet-binnen,geen-video')).j.totaal === 10);
  ok('onbekend filter = 400', (await api('/api/kaart/nummers?filter=cookies')).status === 400);
  const een = await api('/api/kaart/nummer/yt:nep002xxxxx');
  ok('GET /api/kaart/nummer/<sleutel> = { nummer } zoals de server', een.status === 200 && een.j.nummer.sleutel === 'yt:nep002xxxxx' && een.j.nummer.binnen === null && een.j.nummer.wens === null);
  ok('onbekende sleutel = 404', (await api('/api/kaart/nummer/yt:nee')).status === 404);

  // wensen
  const veel = alles.nummers.filter((n) => !n.binnen).map((n) => n.sleutel);
  let r = await post('/api/kaart/wens', { sleutels: veel.slice(0, 21) });
  ok('meer dan 20 zonder bevestig = 409 met aantal', r.status === 409 && r.j.fout === 'meer dan 20' && r.j.aantal === 21);
  r = await post('/api/kaart/wens', { sleutels: ['yt:nep002xxxxx', 'yt:nep000xxxxx', 'yt:nep002xxxxx', 'yt:nee'] });
  ok('wens: toegevoegd, en geweigerd met de redenen van de server (al binnen, dubbel in de vraag, niet op de kaart)', r.status === 200 && r.j.toegevoegd.join() === 'yt:nep002xxxxx'
    && r.j.geweigerd.map((g) => g.reden).join('|') === 'al binnen|dubbel in de vraag|niet op de kaart');
  r = await post('/api/kaart/wens', { sleutels: ['yt:nep002xxxxx'] });
  ok('nog eens: staat al op de lijst (wacht)', r.j.geweigerd[0]?.reden === 'staat al op de lijst (wacht)');
  ok('geen sleutels = 400', (await post('/api/kaart/wens', { sleutels: [] })).status === 400);
  ok('de rij zegt nu wacht', (await api('/api/kaart/nummer/yt:nep002xxxxx')).j.nummer.wens.status === 'wacht');
  const sp = alles.nummers.find((n) => !n.youtube_id).sleutel;
  const yt = alles.nummers.find((n) => n.youtube_id && !n.binnen && n.sleutel !== 'yt:nep002xxxxx').sleutel;
  r = await post('/api/kaart/wens', { sleutels: [yt, sp], meteen: true });
  ok('meteen: met video naar bezig (gestart), zonder video op wacht (eerst zoeken, of de nacht)', r.j.toegevoegd.join() === `${yt},${sp}` && r.j.gestart.join() === yt && !r.j.geweigerd.length
    && (await api(`/api/kaart/nummer/${yt}`)).j.nummer.wens.status === 'bezig' && (await api(`/api/kaart/nummer/${sp}`)).j.nummer.wens.status === 'wacht');
  nep.speelt = () => true;
  r = await post('/api/kaart/wens', { sleutels: ['yt:nep004xxxxx'], meteen: true });
  ok('meteen terwijl een deck speelt = 409', r.status === 409 && r.j.fout === 'er speelt een deck');
  ok('zoek terwijl een deck speelt = 409', (await post(`/api/kaart/nummer/${sp}/zoek`, {})).status === 409);
  nep.speelt = () => false;
  r = await post(`/api/kaart/nummer/${sp}/zoek`, {});
  ok('zoek: kandidaten met youtube_id, titel, kanaal, duur, score, reden', r.status === 200 && r.j.kandidaten.length === 3 && ['youtube_id', 'titel', 'kanaal', 'duur', 'score', 'reden'].every((v) => v in r.j.kandidaten[0]));
  const spN = alles.nummers.find((n) => n.sleutel === sp);
  ok('nep-kandidaten: zeker (0,95) alleen met een eigen like', (K.zekereKandidaat(nepKandidaten(spN)) !== null) === (spN.like === 'eigen') && K.zekereKandidaat(nepKandidaten({ ...spN, like: 'eigen' }))?.score === 0.95);
  r = await post(`/api/kaart/nummer/${sp}/kies`, { youtube_id: r.j.kandidaten[0].youtube_id });
  ok('kies: de wens krijgt de id en wacht', r.status === 200 && (await api(`/api/kaart/nummer/${sp}`)).j.nummer.wens.status === 'wacht' && (await api(`/api/kaart/nummer/${sp}`)).j.nummer.wens.youtube_id);
  const sp2 = alles.nummers.find((n) => !n.youtube_id && n.sleutel !== sp).sleutel;
  r = await post(`/api/kaart/nummer/${sp2}/kies`, { youtube_id: 'abcdefghijk' });
  ok('kies zonder eerdere wens maakt er een op wacht (contract-afwijking van de UI, de server doet het zo)', r.status === 200 && r.j.wens.status === 'wacht' && (await api(`/api/kaart/nummer/${sp2}`)).j.nummer.wens.youtube_id === 'abcdefghijk');
  await api(`/api/kaart/wens/${sp2}`, { method: 'DELETE' });
  ok('kies zonder youtube_id = 400', (await post(`/api/kaart/nummer/${sp}/kies`, {})).status === 400);
  const w = (await api('/api/kaart/wensen')).j.wensen;
  ok('GET /api/kaart/wensen: drie, met sleutel/status/gevraagd/youtube_id/fout/track', w.length === 3 && w.every((x) => ['sleutel', 'status', 'gevraagd', 'youtube_id', 'fout', 'track'].every((v) => v in x)));
  nep.rondAf(yt);
  const klaarW = (await api('/api/kaart/wensen')).j.wensen.find((x) => x.sleutel === yt);
  ok('rondAf: klaar met track als OBJECT met id (zoals de server), nooit een string', klaarW.status === 'klaar' && typeof klaarW.track === 'object' && klaarW.track.id === alles.nummers.find((n) => n.sleutel === yt).youtube_id);
  ok('track is null zolang hij niet binnen is', w.every((x) => x.track === null));
  ok('DELETE /api/kaart/wens/<sleutel>', (await api('/api/kaart/wens/yt:nep002xxxxx', { method: 'DELETE' })).j.ok === true && (await api('/api/kaart/nummer/yt:nep002xxxxx')).j.nummer.wens === null);
  ok('DELETE van een sleutel zonder wens = 200 { ok: false } (zoals de server)', (await api('/api/kaart/wens/yt:nep002xxxxx', { method: 'DELETE' })).j.ok === false);

  // nacht
  const n0 = (await api('/api/nacht')).j;
  ok('GET /api/nacht: standaard UIT, venster 01:00–07:00, 80 per nacht, pauze 20–90', n0.aan === false && n0.venster.van === '01:00' && n0.venster.tot === '07:00' && n0.perNacht === 80 && n0.pauze.min === 20 && n0.pauze.max === 90 && Array.isArray(n0.speeldagen));
  const n1 = (await post('/api/nacht', { aan: true, perNacht: 40, venster: { van: '02:00', tot: '06:00' } })).j;
  ok('POST /api/nacht gedeeltelijk: de nieuwe stand', n1.aan === true && n1.perNacht === 40 && n1.venster.van === '02:00' && n1.venster.tot === '06:00' && n1.pauze.min === 20);
  ok('onzin wordt genegeerd', (await post('/api/nacht', { perNacht: 0, venster: { van: '99:99' } })).j.perNacht === 40);
  ok('alles wat de kaart-API kreeg staat in nep.verzoeken (met body)', nep.verzoeken.some((v) => v.method === 'POST' && v.pad === '/api/kaart/wens' && v.body?.meteen === true));
  ok('iets anders zonder doel: 404', (await api('/api/library')).status === 404);
  await nep.stop();
}

console.log('\nde pagina-cache van de library op kaart-pagina\'s');
{
  const nep = maakKaartNep({ kaart: FIXTURE });
  const poort = await nep.start(0);
  const c = new L.PaginaCache(async (vraag, p) => {
    const r = await fetch(`http://127.0.0.1:${poort}${K.kaartUrl(vraag, p, 10)}`);
    return K.alsPagina(await r.json());
  }, 10);
  await c.ververs({ zoek: '', krat: '', filters: [], sorteer: 'beurten', richting: 'af' }, 0, 10);
  ok('pagina 0 van 10, totaal 40, rijen met id = sleutel', c.totaal === 40 && c.rij(0).id === c.rij(0).sleutel && c.rij(10) === undefined);
  await c.zorgVoor(25, 35);
  ok('scrollen haalt de pagina\'s erbij; vind op sleutel werkt', c.rij(30) && c.vind(c.rij(30).sleutel) === c.rij(30));
  await c.ververs({ zoek: '', krat: 'slim:vertrouwd', filters: ['niet-binnen'], sorteer: 'titel', richting: 'op' }, 0, 10);
  ok('een krat met filter: 8, op titel', c.totaal === 8 && c.rij(0).titel.localeCompare(c.rij(1).titel) <= 0);
  await nep.stop();
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
