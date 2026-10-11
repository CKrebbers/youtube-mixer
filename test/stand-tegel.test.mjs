// De tegel "Opstelling" van de Controlekamer (src/controle/stand-tegel.js,
// docs/STANDEN.md): elke rij, het afkappen van de sub, de regel met wat Clay
// zelf nog moet doen, het adres van "mixer openen", de tekst onder de kiezer en
// de melding na activeren. Puur: geen DOM, geen server.
// Draai met: node test/stand-tegel.test.mjs
import { readFileSync } from 'node:fs';

const { standTegel, standRegel, mixerAdres, mixerKeuze, verschilTekst, activeerMelding, terugMelding, LABEL, MIXER_VIA_HUB, MIXER_GEWOON, SUB_MAX } = await import('../src/controle/stand-tegel.js');
const model = await import('../src/standen/stand-model.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const sinds = new Date(2026, 9, 10, 18, 40).toISOString();
const ACTIEF_APC = {
  naam: 'apc', titel: 'Avond 1 · APC direct', sinds, bron: 'voorbeeld',
  verslag: { toegepast: ['nacht'], gecontroleerd: ['kaart'], genoemd: [], mixer: ['master'], overgeslagen: [], fouten: [], waarschuwingen: [] },
  mixer: { master: { sjabloon: 'Dub-worp', herkomst: 's:1', rack: {} } }, hub: null, pakket: { profiel: 'apc' }, kaart: { krat: 'slim:proefkrat' },
};
const met = (over) => ({ standen: [], actief: { ...ACTIEF_APC, ...over, verslag: { ...ACTIEF_APC.verslag, ...(over.verslag ?? {}) } }, label: 'Opstelling' });
const tegel = (standen) => standTegel({ standen });

console.log('het label');
ok('LABEL is "Opstelling" en komt uit stand-model.js (één constante)', LABEL === 'Opstelling' && LABEL === model.LABEL);
ok('elke tegel heet zo', [null, { ontbreekt: true }, { standen: [], actief: null }, met({})].every((s) => tegel(s).naam === 'Opstelling'));

console.log('\nde rijen');
ok('server weg (null): uit, —', (() => { const t = tegel(null); return t.licht === 'uit' && t.waarde === '—' && t.sub === '' && t.regel === ''; })());
ok('oudere server (404): uit, onbekend, "oudere server"', (() => { const t = tegel({ ontbreekt: true }); return t.licht === 'uit' && t.waarde === 'onbekend' && t.sub === 'oudere server'; })());
ok('een fout van de server (500): uit, onbekend, met de status', (() => { const t = tegel({ fout: 500 }); return t.licht === 'uit' && t.waarde === 'onbekend' && /500/.test(t.sub); })());
ok('niets actief: uit, geen, "kies er een onder Openen"', (() => { const t = tegel({ standen: [], actief: null }); return t.licht === 'uit' && t.waarde === 'geen' && t.sub === 'kies er een onder Openen'; })());
ok('vorige teruggezet: geen, "vorige teruggezet 18:50"', (() => {
  const t = tegel({ standen: [], actief: { naam: null, teruggezet: new Date(2026, 9, 10, 18, 50).toISOString() } });
  return t.licht === 'uit' && t.waarde === 'geen' && t.sub === 'vorige teruggezet 18:50';
})());
ok('actief zonder zorgen: ok, de titel, "sinds 18:40"', (() => { const t = tegel(met({})); return t.licht === 'ok' && t.waarde === 'Avond 1 · APC direct' && t.sub === 'sinds 18:40'; })());
ok('zonder titel: de naam', tegel(met({ titel: '' })).waarde === 'apc');
ok('een waarschuwing: half, "sinds 18:40 · <de eerste>"', (() => {
  const t = tegel(met({ verslag: { waarschuwingen: ['krat "proefkrat" is leeg'] } }));
  return t.licht === 'half' && t.sub === 'sinds 18:40 · krat "proefkrat" is leeg';
})());
ok('twee waarschuwingen: "(+1)"', /\(\+1\)$/.test(tegel(met({ verslag: { waarschuwingen: ['a', 'b'] } })).sub));
ok('overgeslagen (beeld): half, "beeld nog niet"', (() => {
  const t = tegel(met({ verslag: { overgeslagen: [{ deel: 'beeld', reden: 'stap K' }] } }));
  return t.licht === 'half' && t.sub === 'sinds 18:40 · beeld nog niet';
})());
ok('een fout in het verslag: rood, de eerste fout met zijn deel', (() => {
  const t = tegel(met({ verslag: { fouten: [{ deel: 'master', fout: 'geen sjabloon "Nergens"' }], waarschuwingen: ['x'] } }));
  return t.licht === 'fout' && t.waarde === 'Avond 1 · APC direct' && t.sub === 'master: geen sjabloon "Nergens"';
})());
ok(`een lange sub wordt afgekapt op ${SUB_MAX} tekens met …`, (() => {
  const t = tegel(met({ verslag: { waarschuwingen: ['x'.repeat(300)] } }));
  return t.sub.length === SUB_MAX && t.sub.endsWith('…');
})());

console.log('\nde regel: wat Clay zelf nog doet');
const r = tegel(met({ hub: { set: 'studio', mixerVia: true }, pakket: { profiel: 'alles' } })).regel.replaceAll(' ', ' ');
ok(`krat met "kies hem in de kaart" ("${r.split(' · ')[0]}")`, r.includes('krat proefkrat (kies hem in de kaart)'));
// Review 2, punt 4c: de naam die de kaart geeft (in .actief.json sinds review 2) gaat vóór de id.
ok('krat met zijn naam uit de kaart: "krat Proefkrat", zoals het verschil', standRegel({ ...ACTIEF_APC, kaart: { krat: 'slim:proefkrat', naam: 'Proefkrat' } }).startsWith('krat Proefkrat (kies hem in de kaart)'));
ok('hub-set met "start hem zelf (npm start -- studio)"', r.includes('hub-set studio: start hem zelf (npm start -- studio)'));
ok('mixer via de hub genoemd', r.includes('mixer openen gaat via de hub'));
ok('master met "mixer volgt nog niet"', r.includes('master Dub-worp: mixer volgt nog niet'));
ok('profiel', r.endsWith('profiel alles'));
ok('gewone spaties (een lang deel breekt tussen woorden, niet midden in een woord)', !standRegel(ACTIEF_APC).includes('\u00a0') && standRegel(ACTIEF_APC).split(' · ').length === 3);
ok('zonder delen: geen regel', standRegel({ naam: 'laptop' }) === '' && standRegel(null) === '');

console.log('\nmixer openen');
ok('niets actief: gewoon /', mixerAdres(null) === MIXER_GEWOON && mixerAdres({ naam: null }) === '/');
ok('actief zonder hub: /', mixerAdres(ACTIEF_APC) === '/');
ok(`hub.mixerVia: ${MIXER_VIA_HUB}`, mixerAdres({ ...ACTIEF_APC, hub: { set: 'studio', mixerVia: true } }) === '/?hub=ws://localhost:7700/app');
ok('mixerVia "ja" (geen boolean) of teruggezet: gewoon /', mixerAdres({ ...ACTIEF_APC, hub: { mixerVia: 'ja' } }) === '/' && mixerAdres({ naam: null, hub: { mixerVia: true } }) === '/');

// Review 2, punt 3: een fout van /api/standen (503, iCloud) mag "mixer openen" niet stil zonder hub laten openen.
const ALLES = { ...ACTIEF_APC, naam: 'alles', hub: { set: 'studio', mixerVia: true } };
const goed = { standen: [{ naam: 'alles' }], actief: ALLES, label: 'Opstelling' };
ok('mixerKeuze: een goed antwoord met alles: via de hub, niet onbekend', (() => { const k = mixerKeuze(goed, null); return k.adres === MIXER_VIA_HUB && !k.onbekend; })());
ok('… daarna { fout: 503 }: blijft /?hub=… (de laatst bekende), onbekend', (() => { const k = mixerKeuze({ fout: 503 }, ALLES); return k.adres === MIXER_VIA_HUB && k.onbekend; })());
ok('… of geen antwoord (null): ook de laatst bekende', mixerKeuze(null, ALLES).adres === MIXER_VIA_HUB && mixerKeuze(null, ALLES).onbekend);
ok('een fout zonder laatst bekende: gewoon /, onbekend', (() => { const k = mixerKeuze({ fout: 500 }, null); return k.adres === MIXER_GEWOON && k.onbekend; })());
ok('een goed antwoord zonder actieve opstelling gaat vóór de laatst bekende: /', mixerKeuze({ standen: [], actief: null }, ALLES).adres === MIXER_GEWOON);
ok('een oudere server zonder standen (404): gewoon /, niet onbekend', (() => { const k = mixerKeuze({ ontbreekt: true }, ALLES); return k.adres === MIXER_GEWOON && !k.onbekend; })());

console.log('\nwat activeren verandert');
const v = verschilTekst({ delen: {
  nacht: { van: 'aan', naar: 'aan · vannacht niet', moment: 'nu' },
  master: { van: '—', naar: 'Dub-worp', moment: 'mixer volgt nog niet' },
  hub: { van: '—', naar: 'studio, mixer via de hub', moment: 'start hem zelf' },
  kaart: { van: 'slim:proefkrat', naar: 'slim:proefkrat', moment: 'kies hem in de kaart' },
} });
ok(`de tekst ("${v}")`, v === 'nacht: aan → aan · vannacht niet · master: — → Dub-worp (mixer volgt nog niet) · hub: studio, mixer via de hub (start hem zelf) · kaart: slim:proefkrat (blijft; kies hem in de kaart)');
ok('leeg verschil: "verandert niets op de server"; onzin: leeg', verschilTekst({ delen: {} }) === 'verandert niets op de server' && verschilTekst(null) === '' && verschilTekst({ delen: 3 }) === '');

console.log('\nde melding na activeren');
const m = activeerMelding({ naam: 'apc', verslag: { toegepast: ['nacht'], gecontroleerd: ['kaart'], mixer: ['master'], fouten: [{ deel: 'pakket', fout: 'x' }], waarschuwingen: ['krat leeg'] } });
ok(`tekst: "${m.tekst}"`, m.tekst === 'apc actief: nacht, kaart nagekeken, master klaar voor de mixer');
ok('fouten en waarschuwingen apart (rood)', m.rood.join('|') === 'pakket: x|krat leeg');
ok('zonder verslag: "<naam> actief"', activeerMelding({ naam: 'laptop' }).tekst === 'laptop actief');

console.log('\nde melding na "vorige terugzetten" (review punt 1)');
ok('mapping en nacht terug', terugMelding({ delen: ['mapping', 'nacht'], raakte: ['mapping', 'nacht'], overgeslagen: [], fouten: [] }).tekst === 'vorige teruggezet: mapping, nacht');
ok('na "alles" (alleen de nacht): "vorige teruggezet: nacht"', terugMelding({ delen: ['nacht'], raakte: ['nacht'] }).tekst === 'vorige teruggezet: nacht');
const niets = terugMelding({ delen: [], raakte: [], overgeslagen: [], fouten: [] });
ok(`de laatste activering raakte niets: "${niets.tekst}"`, niets.tekst === 'vorige teruggezet: niets (de laatste activering veranderde mapping en nacht niet)' && niets.rood.length === 0);
const hand = terugMelding({ delen: ['mapping'], raakte: ['mapping', 'nacht'], overgeslagen: [{ deel: 'nacht', reden: 'met de hand veranderd na de activering: blijft zoals hij is' }], fouten: [] });
ok(`de nacht met de hand veranderd: "${hand.tekst}", rood "${hand.rood[0]}"`, hand.tekst === 'vorige teruggezet: mapping' && hand.rood[0] === 'nacht: met de hand veranderd na de activering: blijft zoals hij is');
ok('alleen overgeslagen: "niets (nacht met de hand veranderd …)"', /^vorige teruggezet: niets \(nacht met de hand veranderd/.test(terugMelding({ delen: [], raakte: ['nacht'], overgeslagen: [{ deel: 'nacht', reden: 'x' }] }).tekst));
ok('een fout gaat ook rood; onzin geeft "niets"', terugMelding({ delen: [], fouten: [{ deel: 'mapping', fout: 'stuk' }] }).rood.join() === 'mapping: stuk' && terugMelding(null).tekst === 'vorige teruggezet: niets');

console.log('\npuur');
const bron = readFileSync(new URL('../src/controle/stand-tegel.js', import.meta.url), 'utf8');
ok('stand-tegel.js kent geen document, window of fetch', !/\b(document|window|localStorage)\.|\bfetch\(/.test(bron));
ok('en importeert alleen stand-model.js', [...bron.matchAll(/^import .* from '([^']+)'/gm)].map((x) => x[1]).join() === '../standen/stand-model.js');

console.log(fails.length ? `\n${fails.length} FAIL` : '\nalles ok');
process.exit(fails.length ? 1 : 0);
