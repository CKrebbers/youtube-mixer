// Bladeren in de library met de Maschine (docs/MASCHINE.md §5e): BROWSE opent de
// library, het masterwiel loopt door de lijst, ENTER (of het wiel indrukken) laadt
// het gekozen nummer op de focus-track. De bus (bindLibrary), de pure lijsthulp
// (library-lijst.js), terugspelen slaat het over, en de Maschine met een nep-bus en
// een nep-library. In Chromium, met een echte library: tools/headless/bladeren.mjs.
// Draai met: node test/bladeren.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const A = await import('../src/control/actions.js');
const { parseMessage } = await import('../src/control/midi.js');
const { Maschine, HELDER } = await import('../src/control/maschine.js');
const D = await import('../src/control/devices/maschine-mk2.js');
const S = await import('../src/control/maschine-scherm.js');
const L = await import('../src/ui/library-lijst.js');
const { OVERSLAAN } = await import('../src/control/terugspelen.js');
const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
const { soortVan } = await import('../src/ui/soorten.js');
const doc = JSON.parse(readFileSync(new URL('../mappings/maschine-mk2.json', import.meta.url), 'utf8'));

console.log('de lijst: kiezen binnen de grenzen, en het venster voor een klein scherm');
{
  ok('klemKeuze: niet voorbij het begin of het eind, lege lijst = 0',
    L.klemKeuze(3, -10, 12) === 0 && L.klemKeuze(3, 99, 12) === 11 && L.klemKeuze(3, 1, 12) === 4 && L.klemKeuze(0, 1, 0) === 0);
  const cache = { totaal: 12, rij: (i) => (i < 10 ? { titel: `nummer ${i}`, uploader: 'wie', duur: 125.4 } : undefined) };
  const v0 = L.bladerVenster(cache, 0, 4);
  ok('bovenaan: rij 0–3, de eerste gekozen, met titel, artiest en duur', v0.rijen.map((r) => r.i).join() === '0,1,2,3' && v0.rijen[0].gekozen
    && v0.track?.titel === 'nummer 0' && v0.track.artiest === 'wie' && v0.track.duur === '2:05');
  const v5 = L.bladerVenster(cache, 5, 4);
  ok('in het midden: de keuze zo veel mogelijk in het midden (3–6)', v5.rijen.map((r) => r.i).join() === '3,4,5,6' && v5.rijen.find((r) => r.gekozen).i === 5);
  const v11 = L.bladerVenster(cache, 11, 4);
  ok('onderaan: 8–11; een rij die nog niet binnen is heeft geen titel, en dan is er (nog) geen track',
    v11.rijen.map((r) => r.i).join() === '8,9,10,11' && v11.rijen[3].titel === null && v11.track === null);
  ok('lege library: niets', L.bladerVenster({ totaal: 0, rij: () => undefined }, 3).totaal === 0);
  // De keuze volgt het NUMMER (review 8 okt): een ingest bovenaan schuift de rijen op.
  const pc = new L.PaginaCache(async () => ({ tracks: [], totaal: 0 }), 4);
  pc.paginas = new Map([[0, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]], [2, [{ id: 'x' }, { id: 'y' }]]]);
  ok('PaginaCache.index: de rij van een nummer in de pagina\'s die er zijn, anders -1', pc.index('c') === 2 && pc.index('y') === 9 && pc.index('zz') === -1);
}

console.log('\nde bus: bindLibrary');
{
  const log = [];
  let open = false;
  A.bindLibrary({ get open() { return open; }, toggle: () => { open = !open; log.push('toggle'); }, kies: (s) => log.push(`kies ${s}`), laadGekozen: (d) => log.push(`laad ${d}`) }, 10);
  A.invoke('library.toggle', true); A.invoke('library.toggle', false);
  ok('library.toggle opent (alleen bij indrukken), read = 1 als hij open is', log.join() === 'toggle' && A.read('library.toggle') === 1);
  A.invoke('library.next', true); A.invoke('library.prev', true); A.invoke('library.page.next', true); A.invoke('library.page.prev', true);
  ok('next/prev = 1, page = 10', log.slice(1).join() === 'kies 1,kies -1,kies 10,kies -10');
  A.invoke('track.2.load.selected', true);
  ok('track.2.load.selected laadt op deck B', log.at(-1) === 'laad B');
  ok('elke track 1–8 heeft load.selected', [1, 2, 3, 4, 5, 6, 7, 8].every((n) => A.has(`track.${n}.load.selected`)));
  ok('de auto-DJ: laden uit de keuze op zijn track = overnemen (zoals elke knop die de mix raakt)',
    /\|load\\\.selected\)\$\//.test(readFileSync(new URL('../src/auto/automaat.js', import.meta.url), 'utf8').split('\n').find((r) => r.startsWith('const OVERNEEM')) ?? ''));
  ok('terugspelen slaat bladeren en laden-uit-de-keuze over (het laden zelf staat al als laad in het log)',
    ['library.toggle', 'library.next', 'library.page.prev', 'track.3.load.selected'].every((a) => OVERSLAAN.test(a)) && !OVERSLAAN.test('track.3.load'));
  ok('elke nieuwe action heeft een uitleg in gewone taal en de soort library',
    ['library.toggle', 'library.next', 'library.prev', 'library.page.next', 'library.page.prev', 'track.{focus}.load.selected']
      .every((a) => beschrijf(a).kort !== a && !beschrijf(a).lang.startsWith('?') && soortVan(a) === 'library'));
  A.invoke('library.toggle', true);   // weer dicht voor wat hierna komt
}

console.log('\nde Maschine: BROWSE, het wiel, ENTER');
{
  let open = 0;
  const gestuurd = [];
  let stand = { gekozen: 0, totaal: 3, rijen: [{ i: 0, titel: 'een', bpm: '124.0', gekozen: true }, { i: 1, titel: 'twee', bpm: '—', gekozen: false }], track: { titel: 'een', bpm: '124.0', duur: '3:00' }, melding: null, laadt: false };
  const library = { bladerStand: () => stand };
  const engine = { focus: 'B', speeltrack: () => null, instrumentOp: () => null, deck: () => null };
  const read = (a) => (a === 'library.toggle' ? open : null);
  const m = new Maschine({ engine, read, invoke: (a, v) => gestuurd.push([a, v]), beschrijf, library });
  m.laadMapping(doc);
  const druk = (naam, aan = true) => m.ontvang(parseMessage([aan ? 0x91 : 0x81, D.knopNoot(naam), aan ? 127 : 0]));
  const draai = (n) => m.ontvang(parseMessage([0xb0, D.WIEL_CC, n < 0 ? 128 + n : n]));

  druk('browse'); druk('browse', false);
  ok('BROWSE = library.toggle over de bus', gestuurd.some(([a, v]) => a === 'library.toggle' && v));
  gestuurd.length = 0;
  draai(2);
  ok('library dicht: het wiel kiest een instrument, niets naar de library', gestuurd.length === 0 && m._kandidaat() !== null);
  m.kandidaat = null;
  open = 1;
  draai(3); draai(-2);
  const stappen = gestuurd.filter(([, v]) => v).map(([a]) => a);
  ok('library open: het wiel = 3× library.next, dan 2× library.prev (alleen indrukken: half zoveel op de bus en in het log)',
    stappen.join() === 'library.next,library.next,library.next,library.prev,library.prev' && gestuurd.length === 5 && m._kandidaat() === null);
  gestuurd.length = 0;
  druk('enter'); druk('enter', false);
  ok('ENTER = laden op de focus-track (track.2.load.selected), loslaten naar dezelfde action',
    JSON.stringify(gestuurd) === JSON.stringify([['track.2.load.selected', true], ['track.2.load.selected', false]]));
  gestuurd.length = 0;
  druk('wiel'); druk('wiel', false);
  ok('het wiel indrukken: ook laden', gestuurd[0]?.[0] === 'track.2.load.selected');
  gestuurd.length = 0;
  druk('navR'); druk('navR', false); druk('navL'); druk('navL', false);
  ok('◄ ► bij het wiel: een pagina terug/verder', gestuurd.filter(([, v]) => v).map(([a]) => a).join() === 'library.page.next,library.page.prev');
  // Ingedrukt met de library open, losgelaten na het sluiten: het loslaten gaat naar dezelfde action (geen zetKeuze).
  gestuurd.length = 0;
  druk('enter'); open = 0; druk('enter', false);
  ok('ENTER los na het sluiten van de library: loslaten naar dezelfde action', gestuurd.at(-1)?.[0] === 'track.2.load.selected' && gestuurd.at(-1)?.[1] === false);
  gestuurd.length = 0;
  druk('navR'); druk('navR', false);
  ok('library dicht: ◄ ► doen niets', gestuurd.length === 0);

  // Lampjes
  open = 1;
  let leds = m.ledBeeld();
  const knop = (naam) => leds.get(`${D.KNOP_KANAAL}:${D.knopNoot(naam)}`);
  ok('lampjes open: BROWSE fel, ENTER fel (er is een nummer), ◄ uit (bovenaan), ► half',
    knop('browse') === HELDER.aan && knop('enter') === HELDER.aan && knop('navL') === HELDER.uit && knop('navR') === HELDER.half);
  stand = { ...stand, gekozen: 1 };
  leds = m.ledBeeld();
  ok('in het midden van de lijst: ◄ en ► allebei half', knop('navL') === HELDER.half && knop('navR') === HELDER.half);
  open = 0; leds = m.ledBeeld();
  ok('dicht: BROWSE zacht (kan), ENTER uit (geen keuze van het wiel), ◄ ► UIT (review: ze bleven half branden)',
    knop('browse') === HELDER.beschikbaar && knop('enter') === HELDER.uit && knop('navL') === HELDER.uit && knop('navR') === HELDER.uit);
  stand = { ...stand, gekozen: 0 };
  const kaal = new Maschine({ engine, read: () => null, beschrijf });
  ok('zonder library op de bus (geen library.toggle): BROWSE uit', kaal.ledBeeld().get(`${D.KNOP_KANAAL}:${D.knopNoot('browse')}`) === HELDER.uit);

  // Schermen en uitleg
  open = 1;
  const st = m.stand();
  ok('stand.bladeren: de rijen van de library en de focus-track (2)', st.bladeren?.totaal === 3 && st.bladeren.focus === 2 && st.bladeren.rijen.length === 2);
  const links = S.tekenScherm(st, 0), rechts = S.tekenScherm(st, 1);
  const normaal = S.tekenScherm({ ...st, bladeren: null }, 0);
  ok('links: de kop LIBRARY omgekeerd (een volle balk bovenaan), anders dan zonder bladeren',
    S.leesPixel(links, 250, 0) && S.leesPixel(links, 128, 9) && !links.every((x, i) => x === normaal[i]));
  ok('rechts: het gekozen nummer (er staat iets)', rechts.some((x) => x));
  stand = { ...stand, melding: 'track 2 speelt: nog eens om er toch overheen te laden' };
  const metMelding = S.tekenScherm(m.stand(), 1);
  ok('een melding ("speelt: nog eens") komt op het rechterscherm', !metMelding.every((x, i) => x === rechts[i]));
  ok('uitleg met de library open: het wiel bladert, ENTER laadt (track 2)',
    /library/.test(m.legUit(parseMessage([0xb0, D.WIEL_CC, 1])).tekst) && /laden/.test(m.legUit(parseMessage([0x91, D.knopNoot('enter'), 100])).tekst));
  open = 0;
  ok('dicht: ENTER = de instrumentkeuze zetten (de eigen uitleg)', /instrument/.test(m.legUit(parseMessage([0x91, D.knopNoot('enter'), 100])).tekst)
    && m.eigenUitleg('enter') !== null);
  open = 1;
  ok('open: geen eigen uitleg voor wiel en ENTER (de mapping)', m.eigenUitleg('enter') === null && m.eigenUitleg('wiel') === null && m.eigenUitleg('control') !== null);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
