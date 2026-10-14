// Spoor S11 (docs/LIBRARY-TAGS.md §3): de schermkant van de indeling zonder DOM. De URL van een
// pagina met een filter (en zonder: precies de oude), de pagina-cache bij een nieuw filter (geen race),
// het tagveld, aan/uit voor een groep, de chips in een rij (ontsnapt), het tag-geheugen van de bus,
// de uitleg van elke nieuwe action, en wat de iPad mag (library.* nooit, track.N.tag.K met mag).
import * as L from '../src/ui/library-lijst.js';
import { leesTagInvoer, tagWissel, rijChipsHtml, heeftTag } from '../src/ui/library-indeling.js';
import { maakTagGeheugen } from '../src/ui/aanhakers/indeling.js';
import { beschrijfSpoor } from '../src/ui/beschrijf/index.js';
import { waaromNietOpScherm } from '../src/werk/model.js';
import { leesZoekregel } from '../src/library/indeling.js';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

console.log('de url van een pagina');
{
  ok('zonder filter: precies de oude url', L.lijstUrl({ zoek: 'a', sorteer: 'bpm', richting: 'op' }, 1, 100) === '/api/library?sorteer=bpm&richting=op&van=100&aantal=100&zoek=a'
    && L.lijstUrl({ zoek: 'a', sorteer: 'bpm', richting: 'op', filter: {} }, 1, 100) === '/api/library?sorteer=bpm&richting=op&van=100&aantal=100&zoek=a');
  const f = leesZoekregel('#Dub -#vocal bpm:70-90 grid:zeker toon:8A', {}).filter;
  ok('met een filter: tag, niet, bpm, toon, grid', L.lijstUrl({ sorteer: 'titel', richting: 'op', filter: f }, 0, 100)
    === '/api/library?sorteer=titel&richting=op&van=0&aantal=100&tag=dub&niet=vocal&bpm=70-90&toon=8A&grid=zeker');
  ok('op plek: sorteer=plek, richting op, met de categorie', L.lijstUrl({ sorteer: 'titel', richting: 'af', plek: true, filter: { categorie: 4 } }, 0, 50)
    === '/api/library?sorteer=plek&richting=op&van=0&aantal=50&cat=4');
}

console.log('\nde pagina-cache bij een nieuw filter');
{
  const haal = async (vraag, p) => {
    await wacht(vraag.filter?.tags ? 40 : 5);      // het oude filter (met tags) is traag
    const n = vraag.filter?.categorie ? 3 : vraag.filter?.tags ? 7 : 20;
    return { tracks: Array.from({ length: Math.max(0, Math.min(100, n - p * 100)) }, (_, i) => ({ id: `${vraag.filter?.categorie ?? (vraag.filter?.tags ? 't' : 'n')}${i}` })), totaal: n };
  };
  const c = new L.PaginaCache(haal, 100);
  await c.ververs({ zoek: '', sorteer: 'titel', richting: 'op', filter: {} }, 0, 20);
  const [oud, nieuw] = await Promise.all([
    c.ververs({ zoek: '', sorteer: 'titel', richting: 'op', filter: { tags: { en: ['dub'], of: [], niet: [] } } }, 0, 20),
    wacht(1).then(() => c.ververs({ zoek: '', sorteer: 'titel', richting: 'op', filter: { categorie: 9 }, plek: true }, 0, 20)),
  ]);
  ok('een laat antwoord op het oude filter komt niet over het nieuwe heen', oud === false && nieuw === true && c.totaal === 3 && c.rij(0).id === '90' && c.vraag.filter.categorie === 9);
}

console.log('\nhet tagveld en de chips');
{
  const r = leesTagInvoer(' dub, #deep  house , -vocal, -#nacht, a|b, , ');
  ok('erbij, eraf (- of -#), spaties samen, een foute naam apart', JSON.stringify(r) === JSON.stringify({ erbij: ['dub', 'deep house'], eraf: ['vocal', 'nacht'], fout: ['a|b'] }));
  const t = [{ tags: ['Dub', 'x'] }, { tags: ['dub'] }];
  ok('aan/uit voor een groep: hebben ze hem allemaal, dan uit', tagWissel(t, 'DUB') === 'uit' && tagWissel(t, 'x') === 'aan' && tagWissel([], 'dub') === 'aan');
  ok('heeftTag op sleutel', heeftTag({ tags: ['Élan'] }, 'elan') && !heeftTag({}, 'x'));
  const html = rijChipsHtml({ tags: ['<b>', 'a', 'b', 'c'] }, new Map([['a', 'rood']]), 3);
  ok('chips in een rij: ontsnapt, hooguit drie, dan +n, met de kleur', html.includes('&lt;b&gt;') && !html.includes('<b>') && html.includes('ik-rood') && html.includes('+1'));
  ok('geen tags: niets', rijChipsHtml({ tags: [] }) === '' && rijChipsHtml({}) === '');
}

console.log('\nhet tag-geheugen van track.N.tag.K');
{
  let gehaald = 0;
  const pagina = new Map([['p1', { tags: ['dub'] }]]);
  const g = maakTagGeheugen({ vind: (id) => pagina.get(id), haal: async (id) => { gehaald++; await wacht(5); return id === 'weg' ? null : ['nacht']; } });
  ok('in een pagina: meteen, zonder ophalen', JSON.stringify(g.lees('p1')) === '["dub"]' && gehaald === 0);
  ok('onbekend: null en één keer ophalen (ook bij twee vragen)', g.lees('x') === null && g.lees('x') === null && gehaald === 1);
  await wacht(20);
  ok('daarna uit het geheugen', JSON.stringify(g.lees('x')) === '["nacht"]' && gehaald === 1);
  g.vers('x', ['a']);
  ok('vers na een eigen wijziging', JSON.stringify(g.lees('x')) === '["a"]');
  g.wis();
  ok('wis: opnieuw ophalen', g.lees('x') === null && gehaald === 2);
  ok('geen nummer: null', g.lees(null) === null);
}

console.log('\nde uitleg van elke nieuwe action');
{
  const acties = ['library.category.next', 'library.category.prev', 'library.category.clear',
    ...Array.from({ length: 8 }, (_, i) => [`library.quicktag.${i + 1}`, `library.quickfilter.${i + 1}`]).flat(),
    ...Array.from({ length: 64 }, (_, i) => `track.${Math.floor(i / 8) + 1}.tag.${(i % 8) + 1}`)];
  const zonder = acties.filter((a) => !beschrijfSpoor(a)?.kort || !beschrijfSpoor(a)?.lang);
  ok(`elke action heeft een korte en een lange uitleg (${acties.length})`, zonder.length === 0, zonder.join(', '));
  ok('een onbekende krijgt geen uitleg van dit spoor', beschrijfSpoor('library.quicktag.9') === null && beschrijfSpoor('track.9.tag.1') === null);
}

console.log('\nwat de iPad mag');
{
  const w = { schermen: { ipad: { soort: 'ipad', mag: ['track.*.tag.*', 'library.*'] }, iphone: { soort: 'iphone', mag: [] } } };
  ok('library.* nooit, ook niet als mag het noemt', /nooit van buiten/.test(waaromNietOpScherm(w, 'ipad', 'library.quicktag.1') ?? '')
    && /nooit van buiten/.test(waaromNietOpScherm(w, 'ipad', 'library.category.next') ?? ''));
  ok('track.N.tag.K mag als mag het noemt', waaromNietOpScherm(w, 'ipad', 'track.2.tag.3') === null);
  ok('…en anders niet', /mag/.test(waaromNietOpScherm(w, 'iphone', 'track.2.tag.3') ?? ''));
}

if (fails.length) { console.log(`\n${fails.length} FOUT(EN): ${fails.join(' | ')}`); process.exit(1); }
console.log('\nAlle checks groen.');
