// Spoor S11 (docs/LIBRARY-TAGS.md §3): de schermkant van de indeling zonder DOM. De URL van een
// pagina met een filter (en zonder: precies de oude), de pagina-cache bij een nieuw filter (geen race),
// het tagveld, aan/uit voor een groep, de chips in een rij (ontsnapt), het tag-geheugen van de bus,
// de uitleg van elke nieuwe action, en wat de iPad mag (library.* nooit, track.N.tag.K met mag).
import * as L from '../src/ui/library-lijst.js';
import { leesTagInvoer, tagWissel, rijChipsHtml, heeftTag, vulAan, IndelingPaneel } from '../src/ui/library-indeling.js';
import { readFileSync } from 'node:fs';
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

console.log('\naanvullen, title-attributen, het paneel zonder DOM');
{
  const tags = [{ naam: 'Dub', sleutel: 'dub' }, { naam: 'dub techno', sleutel: 'dub techno' }, { naam: 'Nacht', sleutel: 'nacht' }];
  const a = vulAan(['na', 'dub', 'du', 'zzz'], tags);
  ok('Enter: alleen exact = die tag; een begin is NIEUW met een voorstel (nooit stil aanvullen)', JSON.stringify(a)
    === JSON.stringify({ namen: ['na', 'Dub', 'du', 'zzz'], nieuw: ['na', 'du', 'zzz'], voorstel: ['Nacht'] }));
  // Geen title="… "${…}" …": een letterlijke " in een attribuut liet een naam als attributen in de knop vallen (review S11 a1).
  const fout = ['src/ui/library-indeling.js', 'src/ui/library-panel.js', 'src/ui/library-lijst.js'].flatMap((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    .split('\n').map((r, i) => [f, i + 1, r]).filter(([, , r]) => /title="[^"$]+"\$\{/.test(r) || /title="[^"]*"(?![\s>/$`])/.test(r)));
  ok('…en de toets vangt de oude fout', /title="[^"$]+"\$\{/.test('title="wat gekozen is uit "${esc(c.naam)}" halen'));
  ok('geen letterlijke " binnen een title-attribuut', fout.length === 0, fout.map(([f, n]) => `${f}:${n}`).join(', '));
  let tekst = '';
  const p = { zoekTekst: () => tekst, zetZoekTekst: (t) => { tekst = t; }, meld() {}, bevestigd: () => true };
  const ind = new IndelingPaneel({ root: { querySelector: () => null }, panel: p });
  ind.stand = { tags: [], categorieen: [{ id: 3, naam: 'Warm op', soort: 'gewoon' }, { id: 4, naam: 'Slim', soort: 'slim', regel: { grid: 'zeker' } }], snel: Array(8).fill(null) };
  tekst = '#dub bpm:70-90';
  ind.kiesCategorie(3);
  ok('een categorie kiezen houdt de rest van het filter', tekst === '@"warm op" #dub bpm:70-90', tekst);
  ind.wisselTagFilter('dub', true);
  ok('alt-klik op een tag: van "en" naar "niet"', tekst === '@"warm op" -#dub bpm:70-90', tekst);
  ind.wisselTagFilter('dub', true);
  ok('nog eens: eraf', tekst === '@"warm op" bpm:70-90', tekst);
  ok('stapCategorie: alles → Warm op → Slim → alles', ind.stapCategorie(1) === 'Slim' && ind.stapCategorie(1) === 'alles' && ind.stapCategorie(1) === 'Warm op');
  ok('plek kan in een gewone, niet in een slimme zonder gewone', ind.plekMogelijk({ categorie: 3 }) && !ind.plekMogelijk({ categorie: 4 }));
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
  // Ouder dan LEEFTIJD: opnieuw ophalen, maar tot dan de oude stand (het lampje gaat niet even uit).
  let klok = 0;
  let n2 = 0;
  const g2 = maakTagGeheugen({ haal: async () => { n2++; return [`v${n2}`]; }, nu: () => klok });
  g2.lees('y'); await wacht(5);
  ok('vers: uit het geheugen', JSON.stringify(g2.lees('y')) === '["v1"]' && n2 === 1);
  klok = 10001;
  ok('ouder dan 10 s: de oude stand, en opnieuw ophalen', JSON.stringify(g2.lees('y')) === '["v1"]' && n2 === 2);
  await wacht(5);
  ok('…daarna de nieuwe', JSON.stringify(g2.lees('y')) === '["v2"]');
  g2.vergeet('y');
  ok('vergeet (na een tagwijziging in het paneel): null en opnieuw', g2.lees('y') === null && n2 === 3);
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

console.log('\nhet voorbeeldstuk voor de Maschine');
{
  const W = await import('../src/werk/model.js');
  const lees = (pad) => JSON.parse(readFileSync(new URL(pad, import.meta.url), 'utf8'));
  const std = { apc40mk2: lees('../mappings/apc40mk2.json'), 'maschine-mk2': lees('../mappings/maschine-mk2.json') };
  const doc = lees('../mappings/stukken/indeling-voorbeeld.json');
  const n = W.normaliseerStuk(doc, { standaarden: std });
  ok('indeling-voorbeeld: geen fouten of waarschuwingen, als VOORBEELD gemarkeerd', n.fouten.length === 0 && n.waarschuwingen.length === 0 && /VOORBEELD/.test(doc.titel),
    [...n.fouten, ...n.waarschuwingen].join('; '));
  const sm = W.samenstellen(std, { 'indeling-voorbeeld': doc }, { naam: 'x', stukken: ['indeling-voorbeeld'] });
  const regels = sm.apparaten['maschine-mk2']?.fragmenten.flatMap((f) => f.doc.rules) ?? [];
  ok('in een werkruimte: 0 botsingen, en de drie regels komen op de Maschine (SHIFT, vrije sleutels)', sm.botsingen.length === 0 && sm.fouten.length === 0
    && ['library.category.prev', 'library.category.next', 'library.category.clear'].every((a) => regels.some((r) => r.action === a && r.shift)));
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
