// De speellijst per deel (16 okt): het rekenwerk achter "één punt tegelijk", de delen, de kern en het verslag
// (src/controle/speellijst-weergave.js), op de echte speellijst en op een kleine verzonnen.
// Draai met: node test/speellijst-weergave.test.mjs
import { SPEELLIJST, allePunten } from '../src/controle/speellijst.js';
import { DELEN, KERN, deelVan, blokkenVan, heeftKern, idsVan, telling, eersteOpen, beginDeel, plekVan, vraagCodes, verslagTekst } from '../src/controle/speellijst-weergave.js';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${!cond && extra ? `\n      ${extra}` : ''}`); };

console.log('de echte speellijst');
{
  const namen = DELEN.map((d) => d.naam);
  ok('elk blok hoort bij precies één deel', SPEELLIJST.every((b) => namen.includes(deelVan(b))), SPEELLIJST.filter((b) => !namen.includes(deelVan(b))).map((b) => b.titel).join(' | '));
  ok('de delen samen = de hele lijst, in dezelfde volgorde', namen.flatMap((n) => blokkenVan(SPEELLIJST, n)).map((b) => b.id).join() === SPEELLIJST.map((b) => b.id).join());
  ok('alles = de hele lijst', idsVan(blokkenVan(SPEELLIJST, 'alles')).length === allePunten().length);
  ok('alleen Avond 1 heeft een kern, en die bestaat uit de vijf kernblokken', namen.filter((n) => heeftKern(SPEELLIJST, n)).join() === 'Avond 1'
    && blokkenVan(SPEELLIJST, 'Avond 1', { kern: true }).map((b) => b.id).join() === KERN.join());
  ok('kern op een deel zonder kern: gewoon het hele deel', blokkenVan(SPEELLIJST, 'Vooraf', { kern: true }).length === blokkenVan(SPEELLIJST, 'Vooraf').length);
  ok('de opstellingen van de delen bestaan als voorbeeld', DELEN.filter((d) => d.opstelling).every((d) => ['apc', 'alles'].includes(d.opstelling)));
  const codes = allePunten().flatMap((p) => vraagCodes(p.let));
  ok(`vraagcodes uit de echte lijst (${codes.length}) hebben allemaal de vorm van VRAGEN.md`, codes.length > 40 && codes.every((c) => /^[A-Z]{1,4}\d{1,3}[a-z]?$/.test(c)));
}

console.log('\nrekenwerk op een kleine lijst');
{
  const L = [
    { id: 'v', titel: 'Vooraf · Klaar', minuten: 5, punten: [{ id: 'v1', doe: 'a', let: 'b (AR1)' }, { id: 'v2', doe: 'c', let: 'd' }] },
    { id: 'start', titel: 'Avond 1 · Opstarten', minuten: 2, punten: [{ id: 's1', doe: 'e', let: 'f (I4, O2)' }] },
    { id: 'x', titel: 'Avond 1 · Meer', minuten: 3, punten: [{ id: 'x1', doe: 'g', let: 'h (bv. 150)' }, { id: 'x2', doe: 'i', let: 'j' }] },
  ];
  ok('telling: open, ok, fout, overslaan, gedaan', JSON.stringify(telling(['v1', 'v2', 's1', 'x1'], { v1: { status: 'ok' }, v2: { status: 'fout' }, s1: { status: 'overslaan' }, x1: { status: 'open' } }))
    === JSON.stringify({ ok: 1, fout: 1, overslaan: 1, open: 1, gedaan: 3, totaal: 4 }));
  ok('telling: een onbekende status telt als open', telling(['v1'], { v1: { status: 'raar' } }).open === 1);
  const ids = idsVan(blokkenVan(L, 'Avond 1'));
  ok('eersteOpen: van voren af', eersteOpen(ids, {}) === 's1');
  ok('eersteOpen: na s1 (ok) is x1 de volgende', eersteOpen(ids, { s1: { status: 'ok' } }, 's1') === 'x1');
  ok('eersteOpen: rondgaand (na x2 terug naar s1)', eersteOpen(ids, {}, 'x2') === 's1');
  ok('eersteOpen: alles gedaan = null', eersteOpen(ids, { s1: { status: 'ok' }, x1: { status: 'fout' }, x2: { status: 'overslaan' } }) === null);
  ok('beginDeel: het eerste deel met een open punt', beginDeel(L, {}) === 'Vooraf' && beginDeel(L, { v1: { status: 'ok' }, v2: { status: 'ok' } }) === 'Avond 1');
  ok('beginDeel: alles gedaan = het eerste deel', beginDeel(L, Object.fromEntries(['v1', 'v2', 's1', 'x1', 'x2'].map((i) => [i, { status: 'ok' }]))) === 'Vooraf');
  const p = plekVan(L, 'x2');
  ok('plekVan: blok, nr en van', p.blok.id === 'x' && p.nr === 2 && p.van === 2 && plekVan(L, 'weg') === null);
  ok('vraagCodes: "(I4, O2)", "(AR1)"; "(bv. 150)" en zonder haakjes niets',
    vraagCodes('f (I4, O2)').join() === 'I4,O2' && vraagCodes('b (AR1)').join() === 'AR1' && vraagCodes('h (bv. 150)').length === 0 && vraagCodes('geen').length === 0
    && vraagCodes('(W2/W33/W40)').join() === 'W2,W33,W40');
  const items = { s1: { status: 'fout', notitie: 'geen geluid\ntweede regel' }, x1: { status: 'ok', notitie: 'goed zo' }, x2: { status: 'overslaan' } };
  const t = verslagTekst(L, 'Avond 1', items);
  ok('verslag: kop, telling, FOUT met id, codes en de notitie ingesprongen', t.startsWith('Varve proefsessie · Avond 1\n3 van 3 gedaan: 1 ok, 1 fout, 1 overgeslagen, 0 open.')
    && t.includes('FOUT\n- [fout] Avond 1 · Opstarten (s1): e (I4, O2)\n  geen geluid\n  tweede regel'), t);
  ok('verslag: notities en antwoorden apart, zonder fout; zonder notitie niets', t.includes('NOTITIES EN ANTWOORDEN\n- [ok] Avond 1 · Meer (x1): g\n  goed zo') && !t.includes('(x2)'));
  ok('verslag van "alles" telt alles', verslagTekst(L, 'alles', items).split('\n')[1].startsWith('3 van 5 gedaan'));
  ok('verslag zonder iets: alleen de kop en de telling', verslagTekst(L, 'Vooraf', {}) === 'Varve proefsessie · Vooraf\n0 van 2 gedaan: 0 ok, 0 fout, 0 overgeslagen, 2 open.');
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
