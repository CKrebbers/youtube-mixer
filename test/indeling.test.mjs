// Spoor S11 (docs/LIBRARY-TAGS.md): de indeling van de library. Het pure model (filter, zoekregel,
// namen, plekken, import), de Library met schema v10 (tags, categorieën, slim, het filter in SQL,
// volgorde, export/import, de afgeleide kolommen) en de migratie van v9 met data. Geen server: dat
// doet indeling-server.test.mjs.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  geldigeNaam, sleutelVan, normaliseerFilter, leesZoekregel, zoekregelVan, filterNaarQuery, queryNaarFilter,
  chipsVan, combineer, plekkenTussen, normaliseerIndeling, normaliseerSnel, leesToon, gridKenmerk, toonKenmerk, energieKenmerk,
  filterKort, KLEUREN,
} from '../src/library/indeling.js';
import { Library, SCHEMA } from '../server/library.js';
import { IndelingFout } from '../server/indeling.js';
import { gridStatus } from '../src/ui/grid-strook.js';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };
const gelijk = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const gooit = (fn, code) => { try { fn(); return false; } catch (e) { return e instanceof IndelingFout && (code == null || e.code === code); } };

// ---- het pure model ------------------------------------------------------------------------------
{
  ok('namen: spaties samen, randen eraf', geldigeNaam('  deep   house ') === 'deep house');
  ok('namen: verboden , | # @ " en stuurtekens, niet leeg, niet te lang, niet met -', ['a,b', 'a|b', '#a', '@a', 'a"b', 'a\u0001b', '', '   ', 'x'.repeat(41), '-x', 5, null]
    .every((n) => geldigeNaam(n) === null));
  ok('sleutel: kleine letters, zonder accenten', sleutelVan('Élan  Dub') === 'elan dub' && sleutelVan('DUB') === sleutelVan('dub'));
  ok('toon: Camelot en naam', leesToon('8A') === 21 && leesToon('8B') === 0 && leesToon('Am') === 21 && leesToon('F#') === 6 && leesToon('xx') === null);

  const cat = [{ id: 3, naam: 'Warm op' }, { id: 4, naam: 'Dub' }];
  const r = leesZoekregel('#Dub -#vocal #a|b @warm bpm:70-90 toon:8A,C grid:zeker stems energie:hoog hallo  wereld', { categorieen: cat });
  ok('zoekregel: alles herkend', gelijk(r.filter, { zoek: 'hallo wereld', categorie: 3, tags: { en: ['dub'], of: ['a', 'b'], niet: ['vocal'] },
    bpm: [70, 90], energie: [0.66, 1], toon: [0, 21], grid: 'zeker', stems: 'ja' }) && !r.onbekend.length && !r.fouten.length, JSON.stringify(r));
  ok('zoekregel: tussen aanhalingstekens', gelijk(leesZoekregel('#"deep house" @"warm op" "a b"', { categorieen: cat }).filter,
    { zoek: 'a b', categorie: 3, tags: { en: ['deep house'], of: [], niet: [] } }));
  ok('zoekregel: bpm:128 = 127–129, stems:4, -stems, energie:0.2-0.4', gelijk(leesZoekregel('bpm:128 stems:4').filter, { bpm: [127, 129], stems: '4' })
    && leesZoekregel('-stems').filter.stems === 'nee' && gelijk(leesZoekregel('energie:0,2-0,4').filter.energie, [0.2, 0.4]));
  ok('zoekregel: #a,b is ook "of"', gelijk(leesZoekregel('#a,b').filter.tags.of, ['a', 'b']));
  const raar = leesZoekregel('bpm:snel toon:Q grid:bijna @bestaatniet');
  ok('zoekregel: wat hij niet begrijpt staat in onbekend, niet in het filter', gelijk(raar.onbekend, ['bpm:snel', 'toon:Q', 'grid:bijna', '@bestaatniet']) && gelijk(raar.filter, {}));
  ok('zoekregel: een woord met - zonder # is gewoon zoektekst', leesZoekregel('-x').filter.zoek === '-x');
  for (const t of ['#dub -#vocal bpm:70-90 grid:zeker', '@"warm op" #dub|reggae toon:8A stems:2 energie:laag hallo', '#"deep house" -stems']) {
    const f = leesZoekregel(t, { categorieen: cat }).filter;
    ok(`heen en terug: "${t}"`, gelijk(leesZoekregel(zoekregelVan(f, { categorieen: cat }), { categorieen: cat }).filter, f)
      && gelijk(queryNaarFilter(filterNaarQuery(f)).filter, f));
  }
  const q = queryNaarFilter(new URLSearchParams('cat=x&bpm=snel&grid=bijna&stems=8'));
  ok('query: fouten worden genoemd', q.fouten.length === 4, q.fouten.join('; '));
  ok('normaliseer: hooguit 20 tags', normaliseerFilter({ tags: { en: Array.from({ length: 21 }, (_, i) => `t${i}`) } }).fouten.length === 1);
  ok('normaliseer: een bereik wordt gesorteerd en geklemd', gelijk(normaliseerFilter({ bpm: [200, 60], energie: [-1, 2] }).filter, { bpm: [60, 200], energie: [0, 1] }));
  const chips = chipsVan(r.filter, { tags: new Map([['dub', { naam: 'Dub', kleur: 'groen' }]]), categorieen: cat });
  ok('chips: één per deel, met de naam zoals geschreven en de kleur', chips.length === 10 && chips.some((c) => c.tekst === '#Dub' && c.kleur === 'groen'));
  ok('chips: zonder = het filter zonder die chip', !chips.find((c) => c.tekst === '#Dub').zonder.tags.en.length && chips.find((c) => c.soort === 'bpm').zonder.bpm === undefined);
  ok('kort voor een klein scherm', filterKort({ categorie: 3, tags: { en: ['dub'], of: [], niet: [] } }, { categorieen: cat }) === '@Warm op #dub');
  ok('combineer: en bij elkaar, bereiken overlappen', gelijk(combineer({ tags: { en: ['a'], of: [], niet: ['x'] }, bpm: [60, 100] }, { tags: { en: ['b'], of: [], niet: [] }, bpm: [90, 140] }),
    { tags: { en: ['a', 'b'], of: [], niet: ['x'] }, bpm: [90, 100] }));
  ok('combineer is strikt: twee of-groepen, geen bpm-overlap, toon zonder doorsnede, ander grid = null', combineer({ tags: { en: [], of: ['a', 'b'], niet: [] } }, { tags: { en: [], of: ['c'], niet: [] } }) === null
    && combineer({ bpm: [70, 90] }, { bpm: [120, 130] }) === null && combineer({ toon: [21] }, { toon: [16] }) === null
    && combineer({ grid: 'zeker' }, { grid: 'onzeker' }) === null && combineer({ zoek: 'a' }, { zoek: 'b' }) === null
    && gelijk(combineer({ grid: 'zeker' }, { grid: 'zeker', stems: 'ja' }), { grid: 'zeker', stems: 'ja' }));
  ok('plekken: achteraan, vooraan, ertussen, te klein = null', gelijk(plekkenTussen(3, null, 2), [4, 5]) && gelijk(plekkenTussen(null, 1, 1), [0])
    && gelijk(plekkenTussen(1, 2, 1), [1.5]) && plekkenTussen(1, 1 + 1e-7, 1) === null);
  const imp = normaliseerIndeling({ tags: ['dub', { naam: 'Deep', kleur: 'groen' }, { naam: 'a,b' }, 'DUB'], categorieen: [
    { naam: 'Warm', nummers: ['a', 'a', '../x', 'b'] }, { naam: 'Slim', soort: 'slim', regel: { tags: { en: ['dub'] }, categorie: 'Warm' } },
    { naam: 'Kapot', soort: 'slim', regel: { bpm: 'x' } }, { naam: 'warm' }], snel: ['dub', null] });
  ok('import: alleen wat klopt, dubbele weg, fouten per onderdeel', imp.indeling.tags.length === 2 && imp.indeling.tags[1].kleur === 'groen'
    && gelijk(imp.indeling.categorieen.map((c) => c.naam), ['Warm', 'Slim']) && gelijk(imp.indeling.categorieen[0].nummers, ['a', 'b'])
    && imp.indeling.categorieen[1].regel.categorie === 'Warm' && imp.fouten.length === 3 && imp.indeling.snel.length === 8, imp.fouten.join('; '));
  ok('snel: acht plekken, een foute naam = null', normaliseerSnel(['a']).length === 8 && normaliseerSnel(['a,b']) === null && normaliseerSnel('x') === null);
  ok('kleuren: een vaste lijst', KLEUREN.length === 9 && KLEUREN.includes('grijs'));
}

// ---- de afgeleide kenmerken: dezelfde formules als de lijst ---------------------------------------
{
  const grid = { stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }, { van: 100, bpm: 120, anker: 0, zekerheid: 0.1 }] };
  ok('k_grid = gridStatus van de lijst', gridKenmerk(grid, 400) === gridStatus(grid, 400).status && gridKenmerk(grid, 400) === 'onzeker' && gridKenmerk(grid, 150) === 'zeker');
  ok('k_grid zonder grid: null', gridKenmerk(null, 100) === null);
  ok('k_toon: de hoofdtoonsoort, niet bij "geen duidelijke"', toonKenmerk({ stukken: [{ van: 0, toonsoort: 'Am', stemming: 0, zekerheid: 0.8 }] }, 200) === 21
    && toonKenmerk({ stukken: [{ van: 0, toonsoort: 'Am', stemming: 0, zekerheid: 0.05 }] }, 200) === null);
  ok('k_energie: gewogen naar de lengte', energieKenmerk({ stukken: [{ van: 0, energie: 0 }, { van: 30, energie: 1 }] }, 120) === 0.75);
}

// ---- de Library ---------------------------------------------------------------------------------
const map = mkdtempSync(join(tmpdir(), 'varve-indeling-'));
try {
  let lib = new Library(join(map, 'lib.db'));
  ok(`schema v${SCHEMA.length} (v10 = de indeling)`, lib.versie === SCHEMA.length && SCHEMA.length === 10);
  const ind = lib.indeling;
  const nieuw = (id, extra = {}) => lib.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: extra.titel ?? `Nummer ${id}`, uploader: extra.uploader ?? 'x', audio: `media/${id}/audio.wav`, duur: 200 });
  for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) nieuw(id);
  lib.bewaarGrid('a1', { stukken: [{ van: 0, bpm: 80, anker: 0, zekerheid: 0.9 }] });
  lib.bewaarGrid('a2', { stukken: [{ van: 0, bpm: 85, anker: 0, zekerheid: 0.3 }] });
  lib.bewaarGrid('a3', { stukken: [{ van: 0, bpm: 124, anker: 0, zekerheid: 0.9 }] });
  lib.bewaarToon('a1', { stukken: [{ van: 0, toonsoort: 'Am', stemming: 0, zekerheid: 0.9 }], bron: 'auto' });
  lib.bewaarSecties('a1', { stukken: [{ van: 0, label: 'intro', groep: 'A', energie: 0.2 }, { van: 50, label: 'drop', groep: 'B', energie: 0.9 }] });
  lib.bewaarStems('a3', { aantal: 4, namen: ['drums', 'bass', 'other', 'vocals'], schaal: 1, bestand: 'media/a3/stems.wav' });
  const k = lib.db.prepare("SELECT id, k_grid, k_toon, k_energie FROM tracks WHERE id IN ('a1','a2','a6') ORDER BY id").all();
  ok('de afgeleide kolommen worden gezet bij grid, toon en secties', k[0].k_grid === 'zeker' && k[0].k_toon === 21 && Math.abs(k[0].k_energie - 0.725) < 1e-9
    && k[1].k_grid === 'onzeker' && k[2].k_grid === null, JSON.stringify(k));
  lib.bewaarGrid('a2', null);
  ok('grid wissen: k_grid weer null', lib.db.prepare("SELECT k_grid FROM tracks WHERE id = 'a2'").get().k_grid === null);
  lib.bewaarGrid('a2', { stukken: [{ van: 0, bpm: 85, anker: 0, zekerheid: 0.3 }] });

  // taggen
  const z = ind.zetTags(['a1', 'a2', 'a3', 'bestaatniet'], ['Dub', 'deep'], true);
  ok('taggen in één keer: nieuwe tags, onbekende nummers genoemd', z.gezet === 6 && gelijk(z.onbekend, ['bestaatniet']) && ind.tags().length === 2);
  ok('nog eens taggen telt niet dubbel', ind.zetTags(['a1'], ['dub'], true).gezet === 0);
  ind.zetTags(['a3'], ['vocal'], true);
  ok('de rij draagt zijn tags (op sleutel)', gelijk(lib.track('a1').tags, ['deep', 'Dub']) && gelijk(lib.track('a6').tags, []));
  ok('heeftTag op sleutel', ind.heeftTag('a1', 'DUB') && !ind.heeftTag('a6', 'dub'));
  ok('een naam die niet mag: 400', gooit(() => ind.zetTags(['a1'], ['a,b'], true), 400));
  ok('eraf halen', ind.zetTags(['a2'], ['deep'], false).weg === 1 && !ind.heeftTag('a2', 'deep'));

  const ids = (f, extra = {}) => lib.tracks({ filter: f, aantal: 100, ...extra }).map((t) => t.id);
  const F = (s) => leesZoekregel(s, { categorieen: ind.categorieen() }).filter;
  ok('filter #dub', gelijk(ids(F('#dub')).sort(), ['a1', 'a2', 'a3']));
  ok('filter #dub -#vocal', gelijk(ids(F('#dub -#vocal')).sort(), ['a1', 'a2']));
  ok('filter #dub #deep (en)', gelijk(ids(F('#dub #deep')).sort(), ['a1', 'a3']));
  ok('filter #vocal|deep (of)', gelijk(ids(F('#vocal|deep')).sort(), ['a1', 'a3']));
  ok('filter #bestaatniet = niets, -#bestaatniet = alles', ids(F('#bestaatniet')).length === 0 && ids(F('-#bestaatniet')).length === 6);
  ok('filter bpm:70-90', gelijk(ids(F('bpm:70-90')).sort(), ['a1', 'a2']));
  ok('filter grid:zeker / onzeker / geen', gelijk(ids(F('grid:zeker')).sort(), ['a1', 'a3']) && gelijk(ids(F('grid:onzeker')), ['a2']) && ids(F('grid:geen')).length === 3);
  ok('filter toon:8A en toon:Am zijn hetzelfde', gelijk(ids(F('toon:8A')), ['a1']) && gelijk(ids(F('toon:Am')), ['a1']));
  ok('filter stems / stems:4 / stems:2 / -stems', gelijk(ids(F('stems')), ['a3']) && gelijk(ids(F('stems:4')), ['a3']) && !ids(F('stems:2')).length && ids(F('-stems')).length === 5);
  ok('filter energie:hoog (0,725) en energie:laag', gelijk(ids(F('energie:hoog')), ['a1']) && !ids(F('energie:laag')).length);
  ok('filter "dub" als zoektekst vindt ook de tag', gelijk(ids(F('dub')).sort(), ['a1', 'a2', 'a3']));
  ok('aantalTracks telt met het filter', lib.aantalTracks({ filter: F('#dub -#vocal') }) === 2 && lib.aantalTracks({}) === 6);
  ok('het oude zoek blijft werken (titel)', gelijk(lib.tracks({ zoek: 'Nummer a4', aantal: 10 }).map((t) => t.id), ['a4']));
  ok('sorteren werkt met een filter', gelijk(lib.tracks({ filter: F('#dub'), sorteer: 'bpm', richting: 'op', aantal: 10 }).map((t) => t.id), ['a1', 'a2', 'a3']));
  ok('pagina\'s met een filter: geen dubbele, geen gemiste', gelijk([...ids(F('#dub'), { sorteer: 'titel', richting: 'op', aantal: 2 }),
    ...lib.tracks({ filter: F('#dub'), sorteer: 'titel', richting: 'op', van: 2, aantal: 2 }).map((t) => t.id)], ['a1', 'a2', 'a3']));

  // categorieën
  const warm = ind.bewaarCategorie({ naam: 'Warm op', soort: 'gewoon', kleur: 'oranje' });
  ok('een categorie maken', warm.id > 0 && warm.soort === 'gewoon' && warm.kleur === 'oranje');
  ok('dezelfde naam (andere hoofdletters): 409', gooit(() => ind.bewaarCategorie({ naam: 'warm OP', soort: 'gewoon' }), 409));
  ok('een foute soort of kleur: 400', gooit(() => ind.bewaarCategorie({ naam: 'x', soort: 'map' }), 400) && gooit(() => ind.bewaarCategorie({ naam: 'y', soort: 'gewoon', kleur: 'paars' }), 400));
  const e1 = ind.zetNummers(warm.id, ['a3', 'a1', 'a5', 'nee'], { aan: true });
  ok('nummers erin, achteraan, in volgorde; onbekende genoemd', e1.erin === 3 && gelijk(e1.onbekend, ['nee']) && gelijk(ind.nummersVan(warm.id), ['a3', 'a1', 'a5']));
  ok('nog eens erin: geen dubbele, de plek blijft', ind.zetNummers(warm.id, ['a1', 'a2'], { aan: true }).erin === 1 && gelijk(ind.nummersVan(warm.id), ['a3', 'a1', 'a5', 'a2']));
  ind.zetNummers(warm.id, ['a2', 'a5'], { aan: true, voor: 'a3' });
  ok('slepen: vóór een ander nummer (ook wat er al in stond)', gelijk(ind.nummersVan(warm.id), ['a2', 'a5', 'a3', 'a1']));
  ind.zetNummers(warm.id, ['a2'], { aan: true, naarEind: true });
  ok('naar het eind', gelijk(ind.nummersVan(warm.id), ['a5', 'a3', 'a1', 'a2']));
  ok('vóór zichzelf of vóór iets wat er niet in staat: 400', gooit(() => ind.zetNummers(warm.id, ['a1'], { voor: 'a1' }), 400) && gooit(() => ind.zetNummers(warm.id, ['a1'], { voor: 'a6' }), 400));
  // Zestig keer wisselen op de tweede plek: het gat wordt te klein (na ~19 keer), dan nummert hij opnieuw.
  // Het model hiernaast rekent dezelfde stappen na: de volgorde moet daarna nog precies kloppen.
  const model = ind.nummersVan(warm.id);
  for (let i = 0; i < 60; i++) {
    const [eerste, tweede] = ind.nummersVan(warm.id);
    ind.zetNummers(warm.id, [tweede], { aan: true, voor: eerste });
    model.splice(0, 2, model[1], model[0]);
  }
  const plekken = lib.db.prepare('SELECT plek FROM categorie_nummers WHERE categorie_id = ? ORDER BY plek').all(warm.id).map((r) => r.plek);
  ok('na 60 keer tussenvoegen: vier plekken, allemaal verschillend, en de volgorde klopt', plekken.length === 4 && new Set(plekken).size === 4
    && gelijk(ind.nummersVan(warm.id), model), `${ind.nummersVan(warm.id)} / ${model}`);
  const volg = ind.nummersVan(warm.id);
  ok('sorteer=plek geeft de volgorde van de categorie', gelijk(lib.tracks({ filter: { categorie: warm.id }, sorteer: 'plek', aantal: 10 }).map((t) => t.id), volg)
    && gelijk(lib.tracks({ filter: { categorie: warm.id }, sorteer: 'plek', richting: 'af', aantal: 10 }).map((t) => t.id), [...volg].reverse()));
  ok('sorteer=plek zonder categorie: 400', gooit(() => lib.tracks({ sorteer: 'plek', aantal: 10 }), 400));
  ok('een categorie + een tag', gelijk(ids({ categorie: warm.id, tags: { en: ['dub'], of: [], niet: [] } }, { sorteer: 'plek' }), volg.filter((x) => ['a1', 'a2', 'a3'].includes(x))));
  ok('onbekende categorie: 404', gooit(() => lib.tracks({ filter: { categorie: 999 }, aantal: 1 }), 404));
  ind.zetNummers(warm.id, ['a5'], { aan: false });
  ok('eruit', !ind.nummersVan(warm.id).includes('a5') && ind.categorieen().find((c) => c.id === warm.id).aantal === 3);

  // slim
  const slim = ind.bewaarCategorie({ naam: 'dub zeker', soort: 'slim', regel: { tags: { en: ['dub'] }, grid: 'zeker' } });
  ok('een slimme categorie vindt wat zijn regel zegt', gelijk(ids({ categorie: slim.id }).sort(), ['a1', 'a3']) && ind.categorieen().find((c) => c.id === slim.id).aantal === 2);
  ind.zetTags(['a4'], ['dub'], true);
  lib.bewaarGrid('a4', { stukken: [{ van: 0, bpm: 100, anker: 0, zekerheid: 0.9 }] });
  ok('…en werkt zichzelf bij (een nieuwe tag, een nieuw grid)', gelijk(ids({ categorie: slim.id }).sort(), ['a1', 'a3', 'a4']));
  ok('slim + wat je erbij typt (en)', gelijk(ids({ categorie: slim.id, bpm: [70, 90] }), ['a1']));
  const binnen = ind.bewaarCategorie({ naam: 'warm en dub', soort: 'slim', regel: { categorie: 'Warm op', tags: { en: ['dub'] } } });
  // Wat je erbij typt in een slimme is ALTIJD een deelverzameling van de slimme (review S11 a2/b1).
  const regelSlim = ind.bewaarCategorie({ naam: 'strikt', soort: 'slim', regel: { tags: { of: ['dub', 'deep'] }, bpm: [70, 90], toon: [21], grid: 'zeker' } });
  const basis = new Set(ids({ categorie: regelSlim.id }));
  const extra = [{ tags: { en: [], of: ['vocal', 'x'], niet: [] } }, { bpm: [120, 130] }, { toon: [16] }, { grid: 'onzeker' }, { grid: 'geen' }, { stems: 'nee' }, { zoek: 'Nummer' }];
  ok(`slim + wat je typt is nooit ruimer (${basis.size} in de slimme)`, extra.every((x) => ids({ categorie: regelSlim.id, ...x }).every((id) => basis.has(id)))
    && ids({ categorie: regelSlim.id, toon: [16] }).length === 0 && ids({ categorie: regelSlim.id, bpm: [120, 130] }).length === 0);
  ind.wisCategorie(regelSlim.id);
  ok('slim binnen een gewone categorie (op naam), sorteer=plek kan dan ook', gelijk(ids({ categorie: binnen.id }, { sorteer: 'plek' }), ind.nummersVan(warm.id).filter((x) => ['a1', 'a2', 'a3', 'a4'].includes(x))));
  ok('slim in slim: 400', gooit(() => ind.bewaarCategorie({ naam: 'nee', soort: 'slim', regel: { categorie: slim.id } }), 400));
  ok('een slimme vult zich niet met de hand: 400', gooit(() => ind.zetNummers(slim.id, ['a1']), 400));
  ok('de soort verandert niet: 400', gooit(() => ind.bewaarCategorie({ id: slim.id, soort: 'gewoon' }), 400));
  ok('hernoemen en een nieuwe regel', ind.bewaarCategorie({ id: slim.id, naam: 'Dub, zeker'.replace(',', ''), regel: { tags: { en: ['dub'] } } }).naam === 'Dub zeker'
    && ids({ categorie: slim.id }).length === 4);

  // tags hernoemen, samenvoegen, wissen: de regels gaan mee
  ind.zetSnel(['dub', 'deep', null, 'nieuw-uit-snel']);
  ok('snel-tags: acht plekken, een nieuwe naam wordt een tag', gelijk(ind.snel(), ['Dub', 'deep', null, 'nieuw-uit-snel', null, null, null, null]) && !!ind.tag('nieuw-uit-snel'));
  ok('hernoemen naar een bestaande: 409 met bestaat', (() => { try { ind.bewerkTag({ naam: 'deep', nieuw: 'Dub' }); return false; } catch (e) { return e.code === 409 && e.extra.bestaat === 'Dub'; } })());
  ind.bewerkTag({ naam: 'dub', nieuw: 'Dubwise', kleur: 'groen' });
  ok('hernoemen: de regels, de snel-tags en de rijen gaan mee', ind.categorie(slim.id).regel.tags.en[0] === 'dubwise' && ind.snel()[0] === 'Dubwise'
    && lib.track('a1').tags.includes('Dubwise') && ind.tag('dubwise').kleur === 'groen');
  ind.bewerkTag({ naam: 'deep', nieuw: 'dubwise', samenvoegen: true });
  ok('samenvoegen: alle nummers van beide, de oude tag weg, snel-tag mee', !ind.tag('deep') && ind.tags().find((t) => t.sleutel === 'dubwise').aantal === 4 && ind.snel()[1] === 'Dubwise');
  ok('wissen van een tag die een regel gebruikt: 409 met gebruikt', (() => { try { ind.wisTag('dubwise'); return false; } catch (e) { return e.code === 409 && e.extra.gebruikt.length === 2; } })());
  const weg = ind.wisTag('vocal');
  ok('wissen: van alle nummers', weg.nummers === 1 && !lib.track('a3').tags.includes('vocal'));
  ok('een gewone categorie wissen waar een slimme in zoekt: 409; met forceer zoekt die weer overal', gooit(() => ind.wisCategorie(warm.id), 409)
    && ind.wisCategorie(warm.id, { forceer: true }).nummers === 3 && ind.categorie(binnen.id).regel.categorie === undefined);

  // export / import
  const exp = ind.exporteer();
  ok('export: namen, geen ids; de nummers in hun volgorde', exp.soort === 'varve-indeling' && exp.tags.some((t) => t.naam === 'Dubwise') && exp.categorieen.every((c) => !('id' in c)));
  const lib2 = new Library(join(map, 'lib2.db'));
  for (const id of ['a1', 'a3']) lib2.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: id, audio: `media/${id}/audio.wav`, duur: 100 });
  const kratIn = { soort: 'varve-indeling', tags: [{ naam: 'Nacht', kleur: 'blauw' }], categorieen: [{ naam: 'Laat', nummers: ['a3', 'a1', 'weg'] },
    { naam: 'Nachtelijk', soort: 'slim', regel: { tags: { en: ['nacht'] }, categorie: 'Laat' } }], snel: ['Nacht'] };
  const droog = lib2.indeling.importeer(kratIn, { droog: true });
  ok('import droog: het verslag, en er staat niets', droog.categorieen.nieuw === 2 && droog.nummers.erin === 2 && droog.nummers.onbekend === 1
    && lib2.indeling.categorieen().length === 0 && lib2.indeling.tags().length === 0);
  const echt = lib2.indeling.importeer(kratIn);
  ok('import: categorieën, volgorde, slimme regel op naam, snel-tag', echt.categorieen.nieuw === 2 && gelijk(lib2.indeling.nummersVan(lib2.indeling.categorieen()[0].id), ['a3', 'a1'])
    && lib2.indeling.categorieen()[1].regel.categorie === lib2.indeling.categorieen()[0].id && lib2.indeling.snel()[0] === 'Nacht');
  const nogEens = lib2.indeling.importeer({ categorieen: [{ naam: 'laat', nummers: ['a1'] }, { naam: 'Nachtelijk', nummers: [] }] });
  ok('import is samenvoegen: niets dubbel, niets weg; soort botst = fout in het verslag', nogEens.categorieen.bijgewerkt === 1 && nogEens.nummers.erin === 0
    && nogEens.fouten.length === 1 && lib2.indeling.categorieen().length === 2);
  ok('import van een export is idempotent', (() => { const e = lib2.indeling.exporteer(); lib2.indeling.importeer(e); return gelijk(lib2.indeling.exporteer(), e); })());
  // Een export in een LEGE library met dezelfde nummers zet de tags per nummer terug (review S11 b3).
  const lib3 = new Library(join(map, 'lib3.db'));
  for (const id of ['a2', 'a3', 'a4']) lib3.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: id, audio: `media/${id}/audio.wav`, duur: 100 });
  const v3 = lib3.indeling.importeer(exp);
  ok('export → lege library: de tags staan weer op de nummers (onbekende genoemd)', gelijk(lib3.track('a3').tags, lib.track('a3').tags) && gelijk(lib3.track('a4').tags, lib.track('a4').tags)
    && lib3.track('a3').tags.length > 0 && v3.tags.gezet > 0 && v3.tags.onbekend > 0, JSON.stringify(v3.tags));
  lib3.sluit();
  lib2.sluit();

  // weghalen = cascade
  lib.verwijderTrack('a1');
  ok('een nummer weghalen haalt zijn tags en plekken mee', lib.db.prepare("SELECT COUNT(*) AS n FROM nummer_tags WHERE track_id = 'a1'").get().n === 0
    && lib.db.prepare("SELECT COUNT(*) AS n FROM categorie_nummers WHERE track_id = 'a1'").get().n === 0);
  // bpm filtert op het hoofdtempo zoals de lijst het toont (k_bpm, libraryBpm), niet op het eerste stuk.
  nieuw('bp');
  lib.bewaarGrid('bp', { stukken: [{ van: 0, bpm: 95, anker: 0, zekerheid: 0.9 }, { van: 10, bpm: 124, anker: 0, zekerheid: 0.9 }] });
  ok('bpm:120-128 vindt een nummer met een intro op 95 en de rest op 124', ids({ bpm: [120, 128] }).includes('bp') && !ids({ bpm: [90, 100] }).includes('bp'));
  // Een kapotte stems_json (een oude schrijver): stems:4 geeft geen fout, alleen niets voor die rij.
  lib.db.prepare("UPDATE tracks SET stems_json = '{kapot' WHERE id = 'a4'").run();
  ok('stems:4 met een kapotte stems_json: geen fout', (() => { try { return Array.isArray(ids({ stems: '4' })); } catch { return false; } })());
  lib.db.prepare("UPDATE tracks SET stems_json = NULL WHERE id = 'a4'").run();
  // Een server zonder S11 op dezelfde library.db schrijft grid_json zonder de k_*-kolommen: bij het
  // opnieuw openen kloppen ze weer (review S11 a4).
  lib.db.prepare("UPDATE tracks SET grid_json = ?, grid_bpm = 140, k_grid = NULL, k_bpm = NULL WHERE id = 'a6'").run(JSON.stringify({ stukken: [{ van: 0, bpm: 140, anker: 0, zekerheid: 0.9 }] }));
  const pad = join(map, 'lib.db');
  lib.sluit();
  const her = new Library(pad);
  ok('opnieuw openen herstelt de afgeleide kolommen (en raakt de rest niet)', her._kenmerkenHersteld === 1
    && her.db.prepare("SELECT k_grid, k_bpm FROM tracks WHERE id = 'a6'").get().k_bpm === 140 && her.haal('kenmerk_versie') >= 1);
  lib = her;
  ok('de rijen hebben geen k_*-velden (intern), wel tags en energie', !('k_grid' in lib.track('a3')) && Array.isArray(lib.track('a3').tags) && 'energie' in lib.track('a3'));
  lib.sluit();

  // ---- migratie v9 -> v10 met data -----------------------------------------------------------
  const pad9 = join(map, 'v9.db');
  const db = new DatabaseSync(pad9);
  db.function('sorteertitel', { deterministic: true }, (s) => String(s ?? '').toLowerCase());
  for (let v = 0; v < 9; v++) db.exec(SCHEMA[v]);
  db.exec('PRAGMA user_version = 9');
  const ins = db.prepare('INSERT INTO tracks (id, url, titel, audio, duur, toegevoegd, grid_json, toon_json, secties_json, grid_bpm) VALUES (?,?,?,?,?,?,?,?,?,?)');
  ins.run('m1', 'u1', 'een', 'media/m1/audio.wav', 120, 1, JSON.stringify({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0.9 }] }),
    JSON.stringify({ stukken: [{ van: 0, toonsoort: 'C', stemming: 0, zekerheid: 0.9 }], bron: 'auto' }),
    JSON.stringify({ stukken: [{ van: 0, label: 'intro', groep: 'A', energie: 0.4 }] }), 120);
  ins.run('m2', 'u2', 'twee', 'media/m2/audio.wav', 120, 2, null, '{kapot', null, null);
  db.close();
  const l9 = new Library(pad9);
  const m = l9.db.prepare('SELECT id, k_grid, k_toon, k_energie FROM tracks ORDER BY id').all();
  ok('v9 met data -> v10: de afgeleide kolommen gevuld, kapotte JSON = null', l9.versie === 10 && m[0].k_grid === 'zeker' && m[0].k_toon === 0 && m[0].k_energie === 0.4
    && m[1].k_grid === null && m[1].k_toon === null, JSON.stringify(m));
  ok('…en de lege tabellen staan er', l9.indeling.stand().tags.length === 0 && l9.indeling.categorieen().length === 0);
  l9.sluit();
} finally {
  rmSync(map, { recursive: true, force: true });
}

if (fails.length) { console.log(`\n${fails.length} FOUT(EN): ${fails.join(' | ')}`); process.exit(1); }
console.log('\nAlle checks groen.');
