// De library-lijst als rekenwerk: sorteren, welk stuk je ziet, pagina's, en
// een cache die een laat antwoord niet over een nieuwere vraag laat vallen.
// Geen DOM: library-panel.js hangt dit aan het scherm (headless: tools/headless/library.mjs).
const L = await import('../src/ui/library-lijst.js');
const { SORTERING } = await import('../server/library.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('sorteren');
ok('dezelfde kolommen als de server, met dezelfde eerste richting',
  JSON.stringify(Object.keys(L.SORTERINGEN).sort()) === JSON.stringify(Object.keys(SORTERING).sort())
  && Object.entries(L.SORTERINGEN).every(([k, r]) => SORTERING[k].eerst === r));
ok('elke sorteerbare kolom bestaat op de server', L.KOLOMMEN.filter((k) => k.sorteer).every((k) => k.sorteer in SORTERING));
ok('sorteerbaar: titel, bpm, duur, toegevoegd, gespeeld',
  ['titel', 'bpm', 'duur', 'toegevoegd', 'gespeeld'].every((s) => L.KOLOMMEN.some((k) => k.sorteer === s)));
let s = L.volgendeSortering(L.STANDAARD_SORTERING, 'titel');
ok('klik op een andere kolom: zijn eigen eerste richting (titel A→Z)', s.sorteer === 'titel' && s.richting === 'op');
s = L.volgendeSortering(s, 'titel');
ok('nog eens: omgekeerd', s.sorteer === 'titel' && s.richting === 'af');
s = L.volgendeSortering(s, 'titel');
ok('en weer terug', s.richting === 'op');
ok('laatst gespeeld begint met de laatste bovenaan', L.volgendeSortering(s, 'gespeeld').richting === 'af');
ok('een onbekende kolom verandert niets', L.volgendeSortering(s, 'lufs') === s);
ok('ook geen naam van een JavaScript-object (constructor, toString)',
  L.volgendeSortering(s, 'constructor') === s && L.volgendeSortering(s, 'toString') === s);

console.log('\nonthouden (localStorage mag ontbreken of gooien)');
const geheugen = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const o = geheugen();
ok('niets bewaard: de standaard (nieuwste eerst)', JSON.stringify(L.leesSortering(o)) === JSON.stringify(L.STANDAARD_SORTERING));
L.bewaarSortering(o, { sorteer: 'bpm', richting: 'af' });
ok('bewaard en teruggelezen', JSON.stringify(L.leesSortering(o)) === '{"sorteer":"bpm","richting":"af"}');
o.setItem(L.SORTEER_SLEUTEL, '{kapot');
ok('kapotte JSON: de standaard', L.leesSortering(o).sorteer === 'toegevoegd');
o.setItem(L.SORTEER_SLEUTEL, '{"sorteer":"lufs","richting":"op"}');
ok('een kolom die niet (meer) bestaat: de standaard', L.leesSortering(o).sorteer === 'toegevoegd');
o.setItem(L.SORTEER_SLEUTEL, '{"sorteer":"toString","richting":"op"}');
ok('"toString" is geen kolom (de server zou 500 geven en de lijst bleef leeg)', L.leesSortering(o).sorteer === 'toegevoegd');
const gooit = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
let fout = null;
try { L.bewaarSortering(gooit, { sorteer: 'titel', richting: 'op' }); ok('opslag die gooit: lezen geeft de standaard', L.leesSortering(gooit).sorteer === 'toegevoegd'); } catch (e) { fout = e; }
ok('en bewaren gooit niet door', fout === null);
ok('zonder opslag (privévenster, test): de standaard', L.leesSortering(undefined).sorteer === 'toegevoegd');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError: geblokkeerd'); } });
let opslagFout = null;
try { ok('localStorage die al bij het LEZEN gooit (sitedata geblokkeerd): geen opslag, geen crash', L.standaardOpslag() === undefined); } catch (e) { opslagFout = e; }
ok('en het paneel kan dus altijd opstarten', opslagFout === null);
delete globalThis.localStorage;

console.log('\nwat je ziet');
const z = (boven, hoogte, totaal) => L.zichtbaar({ boven, hoogte, totaal, rijH: 28, marge: 8 });
ok('bovenaan: rij 0 tot wat past plus marge', JSON.stringify(z(0, 280, 5000)) === JSON.stringify({ van: 0, tot: 18 }));
ok('midden: marge aan beide kanten', JSON.stringify(z(28 * 3000, 280, 5000)) === JSON.stringify({ van: 2992, tot: 3018 }));
ok('onderaan: niet voorbij het einde', z(28 * 4990, 280, 5000).tot === 5000 && z(28 * 4990, 280, 5000).van === 4982);
ok('lege lijst: niets', JSON.stringify(z(0, 280, 0)) === JSON.stringify({ van: 0, tot: 0 }));
ok('verborgen paneel (hoogte 0): alleen de marge', z(0, 0, 5000).tot === 8);
ok('negatieve scroll (elastisch scrollen): als 0', z(-50, 280, 5000).van === 0);
ok('nooit meer dan ~30 rijen in de DOM, hoe lang de lijst ook is', z(28 * 2500, 340, 5000).tot - z(28 * 2500, 340, 5000).van <= 30);
ok('pagina\'s voor rij 95..105: 0 en 1', JSON.stringify(L.paginasVoor(95, 105, 100)) === '[0,1]');
ok('pagina\'s voor niets: geen', L.paginasVoor(10, 10).length === 0);
ok('url: sortering, richting, van, aantal, zoekterm gecodeerd',
  L.lijstUrl({ zoek: 'a&b 100%', sorteer: 'bpm', richting: 'op' }, 3, 100) === '/api/library?sorteer=bpm&richting=op&van=300&aantal=100&zoek=a%26b+100%25');
ok('zonder zoekterm geen zoek=', !L.lijstUrl({ zoek: '', sorteer: 'titel', richting: 'af' }, 0).includes('zoek'));

console.log('\npagina-cache');
// Een nagebouwde server: 250 nummers, antwoordt asynchroon met een vertraging per vraag.
const nummers = (zoek) => Array.from({ length: zoek ? 30 : 250 }, (_, i) => ({ id: `${zoek || 'n'}${i}`, titel: `${zoek} ${i}` }));
const verzoeken = [];
let vertraging = () => 5;
let kapot = new Set();
const haalPagina = async (vraag, p) => {
  verzoeken.push(`${vraag.zoek}:${p}`);
  await wacht(vertraging(vraag, p));
  if (kapot.has(p)) throw new Error('netwerk weg');
  const alles = nummers(vraag.zoek);
  return { tracks: alles.slice(p * 100, p * 100 + 100), totaal: alles.length };
};
const c = new L.PaginaCache(haalPagina, 100);
ok('eerste keer: pagina 0 en het totaal', await c.ververs({ zoek: '', sorteer: 'titel', richting: 'op' }, 0, 18) && c.totaal === 250 && c.rij(17).id === 'n17');
ok('rij die nog niet binnen is: undefined (het paneel tekent een lege rij)', c.rij(150) === undefined);
verzoeken.length = 0;
const [a1, a2] = await Promise.all([c.zorgVoor(140, 210), c.zorgVoor(140, 210)]);
ok('scrollen: ontbrekende pagina\'s één keer halen, ook als je twee keer vraagt',
  a1 && !a2 && JSON.stringify(verzoeken.sort()) === '[":1",":2"]' && c.rij(249).id === 'n249');
ok('niet voorbij het totaal vragen', (await c.zorgVoor(240, 400)) === false);
ok('vind op id, over alle pagina\'s', c.vind('n205')?.titel === ' 205' && c.vind('bestaatniet') === null);
c.extra.set('net-binnen', { id: 'net-binnen' });
ok('net binnengehaald (nog in geen pagina): ook te vinden', c.vind('net-binnen')?.id === 'net-binnen');
ok('alles wat geladen is, op volgorde', c.geladen.length === 250 && c.geladen[0].id === 'n0' && c.geladen[249].id === 'n249');

// Typen: "a" (traag antwoord) en meteen "ab" (snel). "a" mag niet winnen.
vertraging = (vraag) => (vraag.zoek === 'a' ? 60 : 5);
const [ra, rab] = await Promise.all([
  c.ververs({ zoek: 'a', sorteer: 'titel', richting: 'op' }, 0, 18),
  wacht(1).then(() => c.ververs({ zoek: 'ab', sorteer: 'titel', richting: 'op' }, 0, 18)),
]);
ok('een laat antwoord komt niet over een nieuwere vraag heen', ra === false && rab === true && c.vraag.zoek === 'ab' && c.rij(0).id === 'ab0' && c.totaal === 30);

// Scrollen terwijl er een nieuwe vraag loopt: de oude pagina hoort er niet meer bij.
vertraging = (vraag, p) => (p === 1 ? 40 : 5);
const oudeVraag = c.zorgVoor(100, 130);        // totaal 30: niets te halen
await c.ververs({ zoek: '', sorteer: 'bpm', richting: 'op' }, 0, 18);
const scroll = c.zorgVoor(100, 130);
await wacht(1);
const nieuwer = c.ververs({ zoek: '', sorteer: 'duur', richting: 'op' }, 0, 18);
await Promise.all([oudeVraag, scroll, nieuwer]);
ok('een pagina van de vorige sortering wordt weggegooid', c.vraag.sorteer === 'duur' && c.rij(100) === undefined);

// Andersom: de nieuwe vraag is al VERTROKKEN als je scrollt (klik op de kop,
// dan meteen scrollen). zorgVoor pakt dan nog de oude vraag, maar de
// generatie van de nieuwe; komt de nieuwe eerst terug, dan mag de trage
// pagina van de oude vraag er niet alsnog in (en het totaal niet overschrijven).
vertraging = (vraag, p) => (p === 1 ? 40 : 5);
await c.ververs({ zoek: '', sorteer: 'bpm', richting: 'op' }, 0, 18);
const naarZoek = c.ververs({ zoek: 'z', sorteer: 'bpm', richting: 'op' }, 0, 18);   // 30 treffers
const scrollOud = c.zorgVoor(100, 130);        // nog de oude vraag (250 nummers), pagina 1, traag
await Promise.all([naarZoek, scrollOud]);
ok('scrollen terwijl een nieuwe vraag onderweg is: geen rijen of totaal van de oude vraag erin',
  c.vraag.zoek === 'z' && c.rij(100) === undefined && c.totaal === 30);
await c.ververs({ zoek: '', sorteer: 'duur', richting: 'op' }, 0, 18);   // terug naar de hele lijst

// Netwerk even weg tijdens scrollen: geen fout naar boven, later opnieuw.
vertraging = () => 1;
kapot = new Set([2]);
ok('pagina mislukt: geen uitzondering', (await c.zorgVoor(200, 230)) === false && c.rij(210) === undefined);
kapot = new Set();
ok('en de volgende scroll haalt hem alsnog', (await c.zorgVoor(200, 230)) === true && c.rij(210).id === 'n210');

// Verversen (ingest klaar, nummer weg): pas ruilen als alles binnen is, geen lege flits.
vertraging = () => 20;
const bezig = c.ververs({ ...c.vraag }, 200, 230);
await wacht(5);
ok('tijdens verversen blijven de oude rijen staan', c.rij(210)?.id === 'n210');
await bezig;
ok('en daarna de nieuwe', c.rij(210)?.id === 'n210' && c.paginas.size === 1);

console.log('\nkolommen en cellen');
const t = {
  id: 'x', titel: '<img src=x onerror=alert(1)> Élan', url: 'https://youtu.be/x"', bron: 'youtube', uploader: 'A & B',
  duur: 3725, grid: { stukken: [{ van: 0, bpm: 124, anker: 0.1 }], slot: true }, loudness_i: -12.34, doel_loudness: -14,
  racks: 2, toegevoegd: new Date(2026, 8, 24, 14, 5).getTime(), laatst_geladen: null, keer_geladen: 0,
};
const nu = new Date(2026, 8, 24, 22, 0).getTime();
const html = L.cellenHtml(t, nu);
ok('titel en uploader ontsnapt (geen HTML uit een YouTube-titel)', !html.includes('<img') && html.includes('&lt;img') && html.includes('A &amp; B'));
ok('link in de hint ontsnapt', html.includes('title="https://youtu.be/x&quot;"'));
ok('duur als m:ss, bpm, slot, LUFS, racks', html.includes('62:05') && html.includes('124.0') && html.includes('✓ slot')
  && html.includes('-12.3 → -14 LUFS') && html.includes('2 racks'));
ok('toegevoegd vandaag: de tijd; nooit gespeeld: —', html.includes('>14:05<') && html.includes('>—<'));
ok('een cel per kolom', (html.match(/<span /g) || []).length === L.KOLOMMEN.length);
ok('sjabloon: de titel rekt mee, de knoppen zo breed als ze zijn',
  L.kolomSjabloon().startsWith('minmax(160px, 1fr) ') && L.kolomSjabloon().endsWith(' max-content')
  && L.kolomSjabloon().split(/ (?![^(]*\))/).length === L.KOLOMMEN.length + 1);
ok('zonder grid: — en "geen grid"', L.cellenHtml({ ...t, grid: null }, nu).includes('geen grid'));

// De toonsoort-kolom (samengevoegd met het toonsoort-spoor): tussen bpm en grid,
// een knop voor de kiezer, niet sorteerbaar.
const ids = L.KOLOMMEN.map((k) => k.id);
ok('toon staat tussen bpm en grid', ids.indexOf('toon') === ids.indexOf('bpm') + 1 && ids.indexOf('grid') === ids.indexOf('toon') + 1);
ok('toon is niet sorteerbaar', !L.KOLOMMEN.find((k) => k.id === 'toon').sorteer && !/data-sorteer="toon"/.test(L.kopHtml(L.STANDAARD_SORTERING)));
ok('zonder kaart: —, knop met het id (ontsnapt)', /<button class="lib-toon leeg" data-toon="x"[^>]*>—<\/button>/.test(html));
const album = { ...t, id: 'a"b', toon: { stukken: [{ van: 0, toonsoort: 'C', stemming: 0, zekerheid: 0.8 },
  { van: 3000, toonsoort: 'Eb', stemming: 0, zekerheid: 0.7 }], bron: 'hand', slot: true } };
const htmlAlbum = L.cellenHtml(album, nu, { kiezer: 'a"b' });
ok('album op slot: hoofdtoonsoort +1, klasse slot, id ontsnapt', htmlAlbum.includes('8B C +1') && /class="lib-toon zeker slot open"/.test(htmlAlbum)
  && htmlAlbum.includes('data-toon="a&quot;b"'));
ok('open alleen bij de rij van de kiezer', !/ open"/.test(L.cellenHtml(album, nu, { kiezer: 'ander' })) && !/ open"/.test(L.cellenHtml(album, nu)));
ok('een nieuwe kaart (zetToon) wordt opnieuw uitgerekend', L.cellenHtml({ ...album, toon: { ...album.toon, stukken: [album.toon.stukken[1]] } }, nu).includes('5B E♭<'));
const kop = L.kopHtml({ sorteer: 'bpm', richting: 'op' }, '<b>k</b>');
ok('kop: de actieve kolom met pijl en aria-sort', /data-sorteer="bpm" aria-sort="ascending"[^>]*>bpm<i>▲<\/i>/.test(kop)
  && /data-sorteer="titel" aria-sort="none"/.test(kop));
ok('kop: niet-sorteerbare kolommen zijn geen knop', !/data-sorteer="lufs"/.test(kop) && kop.includes('>LUFS<'));
ok('kop: de knoppen erachter (onzichtbaar, voor gelijke kolombreedtes)', kop.endsWith('<span class="lib-knoppen lib-kop-knoppen" aria-hidden="true"><b>k</b></span>'));
ok('kolomkop omgekeerd: ▼', L.kopHtml({ sorteer: 'gespeeld', richting: 'af' }).includes('gespeeld<i>▼</i>'));

console.log('\ndatum kort');
const d = (j, m, dg, u = 12, mi = 0) => new Date(j, m - 1, dg, u, mi).getTime();
ok('vandaag: uur en minuut', L.datumKort(d(2026, 9, 24, 9, 7), d(2026, 9, 24, 23)) === '09:07');
ok('gisteren', L.datumKort(d(2026, 9, 23, 23, 59), d(2026, 9, 24, 0, 1)) === 'gisteren');
ok('dit jaar: dag en maand', L.datumKort(d(2026, 3, 5), d(2026, 9, 24)) === '5 mrt');
ok('vorig jaar: met jaartal', L.datumKort(d(2025, 12, 31), d(2026, 1, 2)) === '31 dec 25');
ok('nooit: —', L.datumKort(null) === '—' && L.datumKort(0) === '—');

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
