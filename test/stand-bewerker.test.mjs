// De bewerker van een opstelling (src/controle/stand-bewerker.js,
// docs/STANDEN.md): een stand instellen zonder JSON. De HTML bevat de keuzes
// van de server, de waarden van het formulier worden een stand die door
// normaliseerStand komt, wat de bewerker niet kent blijft staan, en alles wat
// in de HTML komt is ontsmet. Puur: geen DOM, geen server.
// Draai met: node test/stand-bewerker.test.mjs
import { readFileSync } from 'node:fs';

const { bewerkerHtml, leesBewerker, nachtKeuze, nieuweNaamGeldig, BEWERKBAAR } = await import('../src/controle/stand-bewerker.js');
const { normaliseerStand, DELEN } = await import('../src/standen/stand-model.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const wortel = new URL('..', import.meta.url);
const SJABLONEN = JSON.parse(readFileSync(new URL('racks/sjablonen.json', wortel), 'utf8')).racks.map((r) => r.name);
const KEUZES = {
  sjablonen: SJABLONEN,
  kratten: [{ id: 'slim:vertrouwd', naam: 'vertrouwd', aantal: 835 }, { id: 'slim:proefkrat', naam: 'proefkrat', aantal: 15 }],
  profielen: null, bekendeProfielen: ['laptop', 'apc', 'maschine', 'alles'], hubSets: ['dj', 'studio'], mappingNu: 'eigen (4 regels)',
};
const APC = JSON.parse(readFileSync(new URL('tools/standen/voorbeelden/apc.json', wortel), 'utf8'));
const ALLES = JSON.parse(readFileSync(new URL('tools/standen/voorbeelden/alles.json', wortel), 'utf8'));
/** De waarden die een formulier met deze HTML zou geven: per select de gekozen optie, per input de value. */
function waardenUit(html) {
  const w = {};
  for (const m of html.matchAll(/<input name="(\w+)"[^>]*value="([^"]*)"/g)) w[m[1]] = m[2].replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&#39;', "'");
  for (const m of html.matchAll(/<select name="(\w+)">(.*?)<\/select>/g)) w[m[1]] = /<option value="([^"]*)" selected>/.exec(m[2])?.[1] ?? '';
  return w;
}

console.log('de HTML');
const h = bewerkerHtml(APC, KEUZES);
ok(`alle 8 sjablonen staan erin (${SJABLONEN.join(', ')})`, SJABLONEN.length === 8 && SJABLONEN.every((n) => h.includes(`<option value="${n}"`)));
ok('de kratten van de kaart, met hun aantal', h.includes('<option value="slim:vertrouwd">vertrouwd (835)</option>') && h.includes('proefkrat (15)'));
ok('de hub-sets en de profielen (uit de voorbeelden: avondpakket nog niet samengevoegd)', h.includes('<option value="studio">') && h.includes('<option value="maschine">')
  && h.includes('avondpakket nog niet samengevoegd'));
ok('de huidige waarden staan gekozen (apc: vannacht niet, proefkrat, Dub-worp, profiel apc)', (() => {
  const w = waardenUit(h);
  return w.nacht === 'vannacht' && w.krat === 'slim:proefkrat' && w.master === 'Dub-worp' && w.profiel === 'apc' && w.hubSet === '' && w.mixerVia === '' && w.mapping === '';
})());
ok('de mapping nu wordt genoemd, met de raad "leg vast"', h.includes('nu: eigen (4 regels); je huidige erin zetten = &quot;leg vast&quot;'));
ok('een krat of sjabloon die er niet (meer) is blijft kiesbaar, met "(niet gevonden)"', (() => {
  const x = bewerkerHtml({ schema: 1, delen: { kaart: { krat: 'pl:weg' }, master: { sjabloon: 'Oud' } } }, KEUZES);
  return x.includes('<option value="pl:weg" selected>pl:weg (niet gevonden)</option>') && x.includes('<option value="Oud" selected>Oud (niet gevonden)</option>');
})());
ok('"zoals bewaard" alleen als de stand een mapping-document heeft', !h.includes('value="bewaard"')
  && bewerkerHtml({ schema: 1, delen: { mapping: { kind: 'diff', device: 'apc40mk2', rules: [{}, {}], removed: [] } } }, KEUZES).includes('zoals bewaard (eigen, 2 regels)'));
ok('wat de bewerker niet kent wordt genoemd: "blijft zoals in het bestand: beeld"', bewerkerHtml({ schema: 1, delen: { beeld: { aan: true } } }, KEUZES).includes('blijft zoals in het bestand: beeld'));
ok('zonder keuzes (server gaf niets): toch een formulier, geen fout', bewerkerHtml(APC, null).includes('name="master"') && bewerkerHtml(null).includes('name="titel"'));

console.log('\nontsmet');
const vies = { schema: 1, titel: '"><script>alert(1)</script>', uitleg: "a'b", delen: { kaart: { krat: '<img src=x onerror=alert(1)>' } } };
const hv = bewerkerHtml(vies, { ...KEUZES, sjablonen: ['<b>x</b>'], hubSets: ['"onmouseover="x'] });
ok('geen <script>, <img of <b> uit de data in de HTML', !/<script|<img|<b>/.test(hv));
ok('aanhalingstekens ontsmet (geen attribuut te breken)', !hv.includes('"onmouseover="') && hv.includes('&quot;onmouseover=&quot;x'));
ok('… en een rondje formulier geeft de titel ongeschonden terug', leesBewerker(waardenUit(hv), vies).titel === vies.titel);

console.log('\nwaarden → stand');
ok('"vannacht niet" → { nacht: { vannacht: false } }', JSON.stringify(leesBewerker({ nacht: 'vannacht' }).delen) === '{"nacht":{"vannacht":false}}');
ok('"uit" → { aan: false }; "uit en vannacht niet" → beide', leesBewerker({ nacht: 'uit' }).delen.nacht.aan === false && JSON.stringify(leesBewerker({ nacht: 'beide' }).delen.nacht) === '{"aan":false,"vannacht":false}');
ok('ongemoeid laat een deel weg', Object.keys(leesBewerker({ nacht: '', mapping: '', krat: '', master: '', hubSet: '', mixerVia: '', profiel: '' }).delen).length === 0);
ok('"standaard" → mapping: "standaard"', leesBewerker({ mapping: 'standaard' }).delen.mapping === 'standaard');
ok('"zoals bewaard" neemt het document van de oude stand over; zonder oud document: weg', (() => {
  const doc = { kind: 'diff', device: 'apc40mk2', rules: [], removed: [] };
  return leesBewerker({ mapping: 'bewaard' }, { delen: { mapping: doc } }).delen.mapping === doc && !('mapping' in leesBewerker({ mapping: 'bewaard' }, { delen: {} }).delen);
})());
ok('hub-set en "via de hub" → { hub: { set, mixerVia: true } }; "gewoon" → mixerVia false', (() => {
  const a = leesBewerker({ hubSet: 'studio', mixerVia: 'ja' }).delen.hub, b = leesBewerker({ mixerVia: 'nee' }).delen.hub;
  return a.set === 'studio' && a.mixerVia === true && b.mixerVia === false && !('set' in b);
})());
ok('krat, master en profiel', (() => { const d = leesBewerker({ krat: 'slim:vertrouwd', master: 'Oplossen', profiel: 'alles' }).delen;
  return d.kaart.krat === 'slim:vertrouwd' && d.master.sjabloon === 'Oplossen' && d.pakket.profiel === 'alles'; })());
ok('titel en uitleg zonder spaties eromheen', (() => { const s = leesBewerker({ titel: '  Avond 3 ', uitleg: ' x ' }); return s.titel === 'Avond 3' && s.uitleg === 'x' && s.schema === 1; })());
ok('beeld, koptelefoon en een onbekend deel van de oude stand blijven staan', (() => {
  const d = leesBewerker({}, { delen: { beeld: { aan: true }, koptelefoon: { omgewisseld: true }, stems: { x: 1 }, master: { sjabloon: 'weg' } } }).delen;
  return d.beeld.aan === true && d.koptelefoon.omgewisseld === true && d.stems.x === 1 && !('master' in d);
})());

console.log('\nrondje: elk voorbeeld door de bewerker en terug');
for (const [naam, vb] of [['apc', APC], ['alles', ALLES]]) {
  const terug = leesBewerker(waardenUit(bewerkerHtml(vb, KEUZES)), vb);
  const r = normaliseerStand(terug);
  ok(`${naam}: ongewijzigd terug, en foutloos volgens normaliseerStand`, r.fouten.length === 0 && JSON.stringify(Object.entries(terug.delen).sort()) === JSON.stringify(Object.entries(vb.delen).sort())
    && terug.titel === vb.titel);
}
ok('apc, master op Oplossen: alleen master verandert', (() => {
  const w = { ...waardenUit(bewerkerHtml(APC, KEUZES)), master: 'Oplossen' };
  const s = leesBewerker(w, APC);
  return s.delen.master.sjabloon === 'Oplossen' && s.delen.nacht.vannacht === false && s.delen.kaart.krat === 'slim:proefkrat';
})());
ok('elke uitkomst van de bewerker komt foutloos door normaliseerStand', ['', 'uit', 'vannacht', 'beide'].every((nacht) => ['', 'standaard'].every((mapping) =>
  normaliseerStand(leesBewerker({ nacht, mapping, krat: 'slim:x', master: 'Getij', hubSet: 'dj', mixerVia: 'ja', profiel: 'laptop', titel: 't' })).fouten.length === 0)));

console.log('\nnamen en grenzen');
ok('nieuweNaamGeldig: "avond-3" ja; "a b", "actief", "" nee', nieuweNaamGeldig('avond-3') && !nieuweNaamGeldig('a b') && !nieuweNaamGeldig('actief') && !nieuweNaamGeldig(''));
ok('BEWERKBAAR zijn bekende delen, geen verboden', BEWERKBAAR.every((d) => Object.hasOwn(DELEN, d)));
ok('nachtKeuze: { aan: false, vannacht: false } → beide; null → ""', nachtKeuze({ aan: false, vannacht: false }) === 'beide' && nachtKeuze(null) === '');
const bron = readFileSync(new URL('src/controle/stand-bewerker.js', wortel), 'utf8');
ok('stand-bewerker.js kent geen document, window of fetch, en importeert alleen stand-model.js', !/\b(document|window|localStorage)\.|\bfetch\(/.test(bron)
  && [...bron.matchAll(/^import .* from '([^']+)'/gm)].map((x) => x[1]).join() === '../standen/stand-model.js');

console.log(fails.length ? `\n${fails.length} FAIL` : '\nalles ok');
process.exit(fails.length ? 1 : 0);
