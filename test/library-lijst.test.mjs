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

// ---- stems (docs/STEMS.md §4) ------------------------------------------------
console.log('\nde stems-kolom');
{
  ok('stems staat na grid, niet sorteerbaar', ids.indexOf('stems') === ids.indexOf('grid') + 1
    && !L.KOLOMMEN.find((k) => k.id === 'stems').sorteer && !/data-sorteer="stems"/.test(L.kopHtml(L.STANDAARD_SORTERING)));
  const cel = (track, opdracht = null, uit = null) =>
    L.stemsCelHtml(track, { stems: new Map(opdracht ? [[track.id, opdracht]] : []), stemsUit: uit });
  const knoppen = (html) => [...html.matchAll(/<button[^>]*data-stems="(\w+)"(?: data-aantal="(\d)")?[^>]*>([^<]*)<\/button>/g)].map((m) => m[3]);
  const tekst = (html) => /<b class="lib-stems[^"]*"[^>]*>([^<]*)<\/b>/.exec(html)?.[1];
  const geen = cel({ id: 'a"b' });
  ok('zonder stems: "—" met knoppen 2 en 4', tekst(geen) === '—' && knoppen(geen).join() === '2,4');
  ok('het id ontsnapt, in de cel en op de knoppen', geen.includes('data-st-id="a&quot;b"') && /data-stems="splits" data-aantal="2" data-id="a&quot;b"/.test(geen));
  const twee = cel({ id: 'x', stems: { aantal: 2, namen: ['vocals', 'inst'], schaal: 0.9, bestand: 'media/x/stems.wav' } });
  ok('twee stems: "2", en een knop 4 (opnieuw in vier)', tekst(twee) === '2' && knoppen(twee).join() === '4' && /class="lib-stems stems"/.test(twee));
  const vier = cel({ id: 'x', stems: { aantal: 4, namen: ['drums', 'bass', 'other', 'vocals'], schaal: 1, bestand: 'b' } });
  ok('vier stems: "4", geen knoppen', tekst(vier) === '4' && knoppen(vier).length === 0);
  const wacht = cel({ id: 'x' }, { id: 'o<1>', track: 'x', aantal: 2, status: 'wacht', voortgang: 0 });
  ok('in de rij: "wacht" met × (annuleren), opdracht-id ontsnapt', tekst(wacht) === 'wacht' && knoppen(wacht).join() === '×'
    && wacht.includes('data-stems="annuleer" data-opdracht="o&lt;1&gt;"'));
  ok('bezig: hele procenten ("42%")', tekst(cel({ id: 'x' }, { id: 'o', track: 'x', aantal: 4, status: 'bezig', voortgang: 0.427 })) === '42%');
  ok('bezig zegt nooit 100% zolang hij niet klaar is', tekst(cel({ id: 'x' }, { id: 'o', track: 'x', aantal: 4, status: 'bezig', voortgang: 1 })) === '99%');
  ok('opnieuw splitsen terwijl er al twee zijn: de voortgang, en de tooltip zegt "nu nog 2"',
    /nu nog 2/.test(cel({ id: 'x', stems: { aantal: 2 } }, { id: 'o', track: 'x', aantal: 4, status: 'bezig', voortgang: 0.1 })));
  const fout = cel({ id: 'x' }, { id: 'o', track: 'x', aantal: 2, status: 'fout', fout: '<b>geheugen</b> op' });
  ok('mislukt: "fout", de reden ontsnapt in de tooltip, opnieuw 2 · 4', tekst(fout) === 'fout' && fout.includes('&lt;b&gt;geheugen&lt;/b&gt; op')
    && !fout.includes('<b>geheugen') && knoppen(fout).join() === '2,4');
  ok('klaar terwijl de rij nog van vóór de split is: telt al als stems', tekst(cel({ id: 'x' }, { id: 'o', track: 'x', aantal: 4, status: 'klaar' })) === '4');
  ok('geannuleerd: weer "—" met 2 · 4', tekst(cel({ id: 'x' }, { id: 'o', track: 'x', aantal: 2, status: 'geannuleerd' })) === '—');
  const uit = cel({ id: 'x' }, null, 'demucs ontbreekt');
  ok('splitter weg: knoppen uit, de reden in de tooltip', (uit.match(/ disabled/g) || []).length === 2 && /kan niet splitsen: demucs ontbreekt/.test(uit));
  ok('maar annuleren kan altijd', !/disabled/.test(cel({ id: 'x' }, { id: 'o', track: 'x', aantal: 2, status: 'wacht' }, 'weg')));
  const rijHtml = L.cellenHtml(t, nu, { stems: new Map([['x', { id: 'o', track: 'x', aantal: 2, status: 'bezig', voortgang: 0.5 }]]), stemsUit: null });
  ok('met stems in de staat nog steeds één cel per kolom', (rijHtml.match(/<span /g) || []).length === L.KOLOMMEN.length && rijHtml.includes('>50%<'));
  ok('zonder staat (oude aanroep): "—", geen fout', /data-st-id="x"[^>]*>—<\/b>/.test(L.cellenHtml(t, nu)));
}

console.log('\nwelke opdracht telt');
{
  const S = await import('../src/ui/stems-weergave.js');
  const lijst = [
    { id: 'k1', track: 'a', status: 'klaar', aantal: 2, klaar: 100 },
    { id: 'f1', track: 'a', status: 'fout', aantal: 4, klaar: 200 },
    { id: 'w1', track: 'b', status: 'wacht', aantal: 2 },
    { id: 'k2', track: 'b', status: 'klaar', aantal: 2, klaar: 900 },
    null, { id: 'z' },
  ];
  ok('van de afgelopen opdrachten de laatste', S.opdrachtVoor(lijst, 'a')?.id === 'f1');
  ok('een open opdracht gaat voor, ook voor een latere klare', S.opdrachtVoor(lijst, 'b')?.id === 'w1');
  ok('onbekend nummer: null', S.opdrachtVoor(lijst, 'c') === null && S.opdrachtVoor(null, 'a') === null);
  const m = S.perNummer(lijst);
  ok('per nummer in één keer, gelijk aan opdrachtVoor; rommel genegeerd', m.size === 2 && m.get('a').id === 'f1' && m.get('b').id === 'w1');
}

console.log('\nde stems-rij van de server (stems-wachtrij.js)');
{
  const { StemsWachtrij } = await import('../src/ui/stems-wachtrij.js');
  const antwoord = (code, j) => ({ ok: code >= 200 && code < 300, status: code, json: async () => j });
  let server = { code: 200, j: { opdrachten: [], server: 'r1', beschikbaar: true } };
  const verzoeken = [];
  let vertraag = null;
  const haal = async (url, init = {}) => {
    verzoeken.push({ url, ...init });
    if (init.method === 'POST') {
      const b = JSON.parse(init.body);
      if (b.aantal === 3) return antwoord(400, { fout: 'aantal moet 2 of 4 zijn' });
      if (b.track === 'weg') return antwoord(503, { fout: 'de splitter ontbreekt: geen demucs' });
      if (b.track === 'heeft') return antwoord(200, { al: true, stems: { aantal: 2 } });
      const o = { id: `o-${b.track}`, track: b.track, aantal: b.aantal, status: 'wacht', voortgang: 0 };
      server.j = { ...server.j, opdrachten: [...server.j.opdrachten, o] };
      return antwoord(202, { opdracht: o });
    }
    if (init.method === 'DELETE') return antwoord(200, { ok: true });
    if (vertraag) await vertraag;
    return antwoord(server.code, server.j);
  };
  const w = new StemsWachtrij({ haal, interval: 0 });
  const gebeurd = [];
  for (const e of ['klaar', 'fout', 'herstart', 'change']) w.on(e, (x) => gebeurd.push([e, x?.id ?? x]));
  const van = (e) => gebeurd.filter(([n]) => n === e).map(([, x]) => x);

  server = { code: 404, j: { fout: 'onbekend pad' } };
  await w.peil();
  ok('een server zonder stems (404): "ontbreekt", niet beschikbaar, met reden', w.ontbreekt && w.beschikbaar === false && /kent \/api\/stems niet/.test(w.reden));
  await w.peil();
  ok('… en dat één keer gemeld (change), niet bij elke peiling', van('change').length === 1);

  server = { code: 200, j: { opdrachten: [{ id: 'oud', track: 't0', status: 'klaar', aantal: 2 }], server: 'r1', beschikbaar: true } };
  await w.peil();
  ok('eerste echte peiling: wat al klaar was is geen nieuws', !w.ontbreekt && w.beschikbaar === true && van('klaar').length === 0);
  ok('voor(): de opdracht van een nummer', w.voor('t0')?.id === 'oud' && w.voor('niets') === null);
  server.j = { ...server.j, opdrachten: [...server.j.opdrachten, { id: 'a', track: 't1', status: 'bezig', voortgang: 0.3, aantal: 4 }] };
  await w.peil();
  ok('iets bezig: open', w.open);
  server.j = { ...server.j, opdrachten: [server.j.opdrachten[0], { id: 'a', track: 't1', status: 'klaar', aantal: 4 },
    { id: 'b', track: 't2', status: 'klaar', aantal: 2 }, { id: 'c', track: 't3', status: 'fout', fout: 'kapot', aantal: 2 }] };
  await w.peil();
  ok('klaar terwijl je keek: gemeld; ook een die tussen twee peilingen helemaal liep', van('klaar').join() === 'a,b');
  ok('mislukt: gemeld', van('fout').join() === 'c');
  await w.peil();
  ok('nog eens peilen: niets dubbel gemeld', van('klaar').length === 2 && van('fout').length === 1 && !w.open);

  server.j = { opdrachten: [{ id: 'd', track: 't4', status: 'wacht', aantal: 2 }], server: 'r1', beschikbaar: true };
  await w.peil();
  server.j = { opdrachten: [], server: 'r2', beschikbaar: true };
  await w.peil();
  ok('herstart van de server met een open opdracht: gemeld met het aantal', van('herstart').join() === '1');
  server.j = { opdrachten: [{ id: 'e', track: 't5', status: 'bezig', aantal: 2 }, { id: 'f', track: 't6', status: 'wacht', aantal: 2 }], server: 'r2', beschikbaar: true };
  await w.peil();
  server.j = { opdrachten: [{ id: 'e2', track: 't5', status: 'bezig', aantal: 2 }], server: 'r3', beschikbaar: true };
  await w.peil();
  ok('herstart die de rij terugzette (nieuwe id, zelfde nummer): alleen wat echt weg is telt', van('herstart').join() === '1,1');
  server.j = { opdrachten: [], server: 'r2', beschikbaar: false, reden: 'geen python' };
  await w.peil();
  ok('splitter weg: beschikbaar false, met de reden van de server', w.beschikbaar === false && w.reden === 'geen python');
  server.j = { opdrachten: [], server: 'r2', beschikbaar: true };
  await w.peil();
  ok('en terug: reden weg', w.beschikbaar === true && w.reden === null);

  // Peilen alleen als het ergens om gaat.
  let n = verzoeken.length;
  w._tik();
  ok('niets open en niemand kijkt: niet peilen', verzoeken.length === n);
  let kijkt = true;
  const stop = w.kijk(() => kijkt);
  w.kijk(() => { throw new Error('kapotte kijker'); });
  w._tik(); await w._loopt;
  ok('iemand kijkt (paneel open): peilen; een kapotte kijker stoort niet', verzoeken.length === n + 1);
  stop(); kijkt = false;
  n = verzoeken.length;
  w._tik();
  ok('kijker weg: weer stil', verzoeken.length === n);

  // Splitsen terwijl er een peiling onderweg is: de nieuwe opdracht staat er daarna toch.
  let laat;
  vertraag = new Promise((z) => { laat = z; });
  const onderweg = w.peil();
  const splitsing = w.splits('t9', 4);
  await new Promise((z) => setTimeout(z, 0));
  vertraag = null;
  laat();
  await onderweg;
  const r = await splitsing;
  const post = verzoeken.find((v) => v.method === 'POST');
  ok('POST /api/stems als JSON: { track, aantal }', post.url === '/api/stems' && post.headers['Content-Type'] === 'application/json'
    && JSON.stringify(JSON.parse(post.body)) === '{"track":"t9","aantal":4}');
  ok('splitsen geeft de opdracht', r.ok && r.opdracht?.id === 'o-t9' && !r.al);
  ok('een peiling die al onderweg was telt niet: daarna staat de nieuwe opdracht in de rij', w.voor('t9')?.id === 'o-t9');
  ok('opnieuw: { opnieuw: true } erbij', (await w.splits('t8', 2, { opnieuw: true })).ok && JSON.parse(verzoeken.filter((v) => v.method === 'POST').at(-1).body).opnieuw === true);
  const laatstePost = () => JSON.parse(verzoeken.filter((v) => v.method === 'POST').at(-1).body);
  ok('vooraan: { vooraan: true } erbij (vanuit de STEMS-rij); zonder: niet in het verzoek',
    (await w.splits('t7', 4, { vooraan: true })).ok && laatstePost().vooraan === true
    && (await w.splits('t6', 4)).ok && !('vooraan' in laatstePost()));
  const al = await w.splits('heeft', 2);
  ok('had al stems: { al: true }', al.ok && al.al && al.stems?.aantal === 2);
  const weg = await w.splits('weg', 2);
  ok('503: de reden van de server, geen uitzondering', !weg.ok && /geen demucs/.test(weg.fout));
  ok('400: idem', /2 of 4/.test((await w.splits('x', 3)).fout));
  const geenNet = new StemsWachtrij({ haal: async () => { throw new Error('weg'); }, interval: 0 });
  ok('server weg: tekst voor meld(), geen uitzondering', /server niet bereikbaar: weg/.test((await geenNet.splits('x', 2)).fout));
  await geenNet.peil();
  ok('… en peilen zonder server laat alles staan', geenNet.beschikbaar === null && geenNet.opdrachten.length === 0);
  const x = await w.annuleer('o/1 2');
  ok('annuleren: DELETE /api/stems/<id>, het id gecodeerd', x.ok && verzoeken.some((v) => v.method === 'DELETE' && v.url === '/api/stems/o%2F1%202'));
}

console.log('\nstems bij het binnenhalen (ingest-strook.js)');
{
  const I = await import('../src/ui/ingest-strook.js');
  const o = geheugen();
  ok('niets bewaard: 2 (zang + rest)', I.leesStemsKeuze(o) === 2 && I.leesStemsKeuze(undefined) === 2);
  for (const [v, n] of [['4', 4], ['0', 0], ['2', 2], ['3', 2], ['', 2], ['x', 2]]) {
    o.setItem(I.STEMS_SLEUTEL, v);
    ok(`bewaard "${v}": ${n}`, I.leesStemsKeuze(o) === n);
  }
  I.bewaarStemsKeuze(o, 0);
  ok('bewaren: als tekst onder varve.stems.standaard', o.getItem('varve.stems.standaard') === '0' && I.STEMS_SLEUTEL === 'varve.stems.standaard');
  let gegooid = null;
  try { ok('opslag die gooit: lezen geeft 2', I.leesStemsKeuze(gooit) === 2); I.bewaarStemsKeuze(gooit, 4); } catch (e) { gegooid = e; }
  ok('… en bewaren gooit niet door', gegooid === null);

  // De strook stuurt de keuze mee: in POST /api/ingest en in de upload.
  const [fetch0, interval0, xhr0] = [globalThis.fetch, globalThis.setInterval, globalThis.XMLHttpRequest];
  const posts = [], uploads = [];
  globalThis.fetch = async (u, init = {}) => {
    if (init.method === 'POST') { posts.push(JSON.parse(init.body)); return { ok: true, status: 202, json: async () => ({ status: 'wacht', plek: 1, resultaten: [] }) }; }
    return { json: async () => ({ opdrachten: [] }) };
  };
  globalThis.setInterval = () => 0;
  globalThis.XMLHttpRequest = class {
    constructor() { this.upload = {}; }
    open(m, u) { uploads.push(u); } setRequestHeader() {} abort() {}
    send() { setTimeout(() => { this.status = 202; this.responseText = '{"id":"u1","status":"wacht"}'; this.onload(); }, 0); }
  };
  const knop = (v) => ({ dataset: { stemsKeuze: v }, aan: false, classList: { toggle(n, a) { knop.staat[v] = a; } }, setAttribute() {} });
  knop.staat = {};
  const knoppen = ['2', '4', '0'].map(knop);
  let klik = null;
  const keuzeEl = { querySelectorAll: () => knoppen, addEventListener: (t, f) => { klik = f; } };
  const el = { addEventListener() {}, classList: { toggle() {} }, innerHTML: '', contains: () => true };
  const url = { value: '', addEventListener() {} };
  const opslag = geheugen();
  opslag.setItem(I.STEMS_SLEUTEL, '4');
  const s = new I.IngestStrook({ el, url, stemsKeuze: keuzeEl, opslag });
  ok('de strook begint met de bewaarde keuze (4), die knop brandt', s.stems === 4 && knop.staat['4'] === true && knop.staat['2'] === false);
  url.value = 'https://youtu.be/abc';
  await s.haalBinnen();
  ok('één link: { url, stems: 4 }', posts.at(-1).url === 'https://youtu.be/abc' && posts.at(-1).stems === 4);
  klik({ target: { closest: () => knoppen[2] } });
  ok('klik "geen": stems 0, bewaard, die knop brandt', s.stems === 0 && opslag.getItem(I.STEMS_SLEUTEL) === '0' && knop.staat['0'] === true && knop.staat['4'] === false);
  url.value = 'https://youtu.be/a https://youtu.be/b';
  await s.haalBinnen();
  ok('meer links: { urls, stems: 0 }', posts.at(-1).urls?.length === 2 && posts.at(-1).stems === 0);
  s.zetStems(3);
  ok('een onzinkeuze (3) verandert niets', s.stems === 0);
  s.zetStems(2);
  await s.uploadBestand({ name: 'eigen nummer.wav', size: 3 });
  ok('upload: &stems=2 in de url', /^\/api\/upload\?naam=eigen%20nummer\.wav&stems=2$/.test(uploads.at(-1)), uploads.at(-1));
  await s.uploadBestand({ name: 'op track.wav', size: 3 }, { naDeck: 'B' });
  ok('upload op een track: vooraan én stems', /&vooraan=1&stems=2$/.test(uploads.at(-1)), uploads.at(-1));
  const zonder = new I.IngestStrook({ el, url });
  ok('zonder knoppen en zonder opslag (test, privévenster): 2, geen crash', zonder.stems === 2);
  Object.assign(globalThis, { fetch: fetch0, setInterval: interval0, XMLHttpRequest: xhr0 });
}

console.log('\ndatum kort');
const d = (j, m, dg, u = 12, mi = 0) => new Date(j, m - 1, dg, u, mi).getTime();
ok('vandaag: uur en minuut', L.datumKort(d(2026, 9, 24, 9, 7), d(2026, 9, 24, 23)) === '09:07');
ok('gisteren', L.datumKort(d(2026, 9, 23, 23, 59), d(2026, 9, 24, 0, 1)) === 'gisteren');
ok('dit jaar: dag en maand', L.datumKort(d(2026, 3, 5), d(2026, 9, 24)) === '5 mrt');
ok('vorig jaar: met jaartal', L.datumKort(d(2025, 12, 31), d(2026, 1, 2)) === '31 dec 25');
ok('nooit: —', L.datumKort(null) === '—' && L.datumKort(0) === '—');

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
