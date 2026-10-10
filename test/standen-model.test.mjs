// Het formaat van een stand (src/standen/stand-model.js, docs/STANDEN.md):
// schema 1, de witte lijst van delen, wat er NIET in mag, en de vier
// voorbeelden in tools/standen/voorbeelden/. Puur: geen server, geen schijf
// behalve het lezen van de voorbeelden en de bron.
// Draai met: node test/standen-model.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const M = await import('../src/standen/stand-model.js');
const { normaliseerStand, naamGeldig, DELEN, VERBODEN_DELEN, GERESERVEERD, SCHEMA, NACHT_REM, STANDAARD_APPARAAT, LABEL, nogNietToegepast } = M;
const { pasToe, STANDAARD } = await import('../server/nacht.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wortel = fileURLToPath(new URL('..', import.meta.url));
const valideerNacht = (d) => pasToe(STANDAARD, d);
const n = (delen, extra = {}) => normaliseerStand({ schema: 1, titel: 't', delen, ...extra }, { valideerNacht });
const fout = (delen, deel) => { const r = n(delen); return r.fouten.some((f) => f.deel === deel) && !(deel in r.stand.delen); };
const goed = (delen) => { const r = n(delen); return r.fouten.length === 0 && r.waarschuwingen.length === 0; };

// ---- de voorbeelden ------------------------------------------------------------
console.log('de vier voorbeelden');
const vmap = `${wortel}tools/standen/voorbeelden/`;
const voorbeelden = Object.fromEntries(readdirSync(vmap).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(vmap + f, 'utf8'))]));
ok('precies apc, alles, maschine, laptop (de profielen van het avondpakket)', Object.keys(voorbeelden).sort().join() === 'alles,apc,laptop,maschine');
for (const [naam, ruw] of Object.entries(voorbeelden)) {
  const r = normaliseerStand(ruw, { valideerNacht });
  ok(`${naam}: foutloos, zonder waarschuwing, titel ≤ 60`, r.stand && r.fouten.length === 0 && r.waarschuwingen.length === 0 && r.stand.titel.length > 0 && r.stand.titel.length <= 60);
  ok(`${naam}: noemt zijn eigen profiel in pakket`, ruw.delen.pakket?.profiel === naam);
}
ok('geen voorbeeld zet de nacht aan (een stand remt alleen)', Object.values(voorbeelden).every((v) => v.delen.nacht === undefined || v.delen.nacht.aan !== true));
ok('geen voorbeeld noemt mapping, beeld, koptelefoon of vormen', Object.values(voorbeelden).every((v) => !['mapping', 'beeld', 'koptelefoon', 'vormen'].some((d) => d in v.delen)));
ok('apc: vannacht niet, proefkrat, Dub-worp; alles: hub studio via de mixer', voorbeelden.apc.delen.nacht.vannacht === false && voorbeelden.apc.delen.kaart.krat === 'slim:proefkrat'
  && voorbeelden.apc.delen.master.sjabloon === 'Dub-worp' && voorbeelden.alles.delen.hub.set === 'studio' && voorbeelden.alles.delen.hub.mixerVia === true);
ok('laptop: nacht { aan: false }', voorbeelden.laptop.delen.nacht.aan === false && Object.keys(voorbeelden.laptop.delen.nacht).length === 1);

// ---- de stand zelf --------------------------------------------------------------
console.log('\nde stand zelf');
ok('schema is 1', SCHEMA === 1);
ok('schema 2 geweigerd (stand null, fout zonder deel)', (() => { const r = normaliseerStand({ schema: 2, delen: {} }); return r.stand === null && r.fouten[0].deel === null && /schema 1/.test(r.fouten[0].fout); })());
ok('zonder schema geweigerd', normaliseerStand({ delen: {} }).stand === null);
ok('geen object (lijst, tekst, null) geweigerd', [[], 'x', null, 3].every((x) => normaliseerStand(x).stand === null));
ok('lege delen is goed', goed({}));
ok('zonder delen is ook goed (delen {})', (() => { const r = normaliseerStand({ schema: 1 }); return r.fouten.length === 0 && Object.keys(r.stand.delen).length === 0; })());
ok('delen als lijst is een fout', n([]).fouten.some((f) => f.deel === null));
ok('titel van 60 tekens goed, 61 fout', n({}, { titel: 'x'.repeat(60) }).fouten.length === 0 && n({}, { titel: 'x'.repeat(61) }).fouten.some((f) => f.deel === null && /60/.test(f.fout)));
ok('uitleg van 301 tekens fout', n({}, { uitleg: 'x'.repeat(301) }).fouten.some((f) => /300/.test(f.fout)));
ok('een onbekend veld naast de delen: waarschuwing, niet bewaard', (() => { const r = n({}, { stems: 1 }); return r.fouten.length === 0 && r.waarschuwingen.length === 1 && !('stems' in r.stand); })());

// ---- mapping --------------------------------------------------------------------
console.log('\nmapping');
const verschil = { kind: 'diff', version: 3, device: 'apc40mk2', base: 'abc-1', top: {}, rules: [{ in: 'cc:0:7', action: 'track.1.volume', mode: 'absolute' }], removed: [] };
ok('"standaard" is goed', goed({ mapping: 'standaard' }) && n({ mapping: 'standaard' }).stand.delen.mapping === 'standaard');
ok('een verschil voor de APC is goed', goed({ mapping: verschil }));
ok('zonder rules: fout', fout({ mapping: { ...verschil, rules: undefined } }, 'mapping'));
ok('een verschil zonder device: fout', fout({ mapping: { ...verschil, device: undefined } }, 'mapping'));
ok(`device xboard49: fout (alleen ${STANDAARD_APPARAAT})`, fout({ mapping: { ...verschil, device: 'xboard49' } }, 'mapping'));
ok('een volledig document zonder device: fout', fout({ mapping: { name: 'x', rules: [] } }, 'mapping'));
ok('een andere tekst dan "standaard": fout', fout({ mapping: 'mijn' }, 'mapping'));
ok('groter dan 64 KiB: fout', fout({ mapping: { ...verschil, rules: Array.from({ length: 2000 }, (_, i) => ({ in: `cc:0:${i}`, action: 'track.1.volume.lang.genoeg', mode: 'absolute' })) } }, 'mapping'));
ok('de standaardmapping zelf (231 kB) past bewust niet', fout({ mapping: JSON.parse(readFileSync(`${wortel}mappings/apc40mk2.json`, 'utf8')) }, 'mapping'));

// ---- nacht: alleen remmen ---------------------------------------------------------
console.log('\nnacht: een stand kan de nacht alleen remmen');
ok('{ aan: true } is een fout (een stand haalt nooit binnen)', fout({ nacht: { aan: true } }, 'nacht') && n({ nacht: { aan: true } }).fouten[0].fout === NACHT_REM);
ok('{ aan: false } is goed', goed({ nacht: { aan: false } }));
ok('{ vannacht: false } is goed', goed({ nacht: { vannacht: false } }));
ok('beide samen is goed', goed({ nacht: { aan: false, vannacht: false } }));
ok('{ vannacht: true } is een fout', fout({ nacht: { vannacht: true } }, 'nacht'));
ok('een lege nacht is een fout', fout({ nacht: {} }, 'nacht'));
for (const k of ['perNacht', 'venster', 'pauze', 'standaardVolgorde', 'speeldagen', 'vandaagNiet', 'vandaagNietDatum']) {
  ok(`nacht.${k} is een fout (nachtbeleid hoort in de kaart-knoppen)`, fout({ nacht: { aan: false, [k]: k === 'perNacht' ? 10 : true } }, 'nacht'));
}
ok('de vertaalde rem gaat ook door pasToe van de nacht (valideerNacht)', (() => {
  const gezien = [];
  normaliseerStand({ schema: 1, delen: { nacht: { aan: false, vannacht: false } } }, { valideerNacht: (d) => gezien.push(d) });
  return gezien.length === 1 && gezien[0].aan === false && gezien[0].vandaagNiet === true;
})());
ok('gooit valideerNacht, dan is het een fout bij nacht',
  normaliseerStand({ schema: 1, delen: { nacht: { aan: false } } }, { valideerNacht: () => { throw new Error('nee'); } }).fouten.some((f) => f.deel === 'nacht' && /nee/.test(f.fout)));

// ---- de andere delen --------------------------------------------------------------
console.log('\nkaart, master, hub, pakket, beeld, koptelefoon, vormen');
ok('kaart { krat } goed; krat als getal fout; extra sleutel fout', goed({ kaart: { krat: 'slim:proefkrat' } }) && fout({ kaart: { krat: 3 } }, 'kaart') && fout({ kaart: { krat: 'a', zoek: 'b' } }, 'kaart'));
ok('master { sjabloon: "Dub-worp" } goed', goed({ master: { sjabloon: 'Dub-worp' } }));
ok('master { sjabloon: "s:2" } fout (een naam, geen plaats)', fout({ master: { sjabloon: 's:2' } }, 'master'));
ok('master zonder sjabloon fout', fout({ master: {} }, 'master'));
ok('hub { set, mixerVia } goed; leeg goed', goed({ hub: { set: 'studio', mixerVia: true } }) && goed({ hub: {} }));
ok('hub.mixerVia "ja" fout', fout({ hub: { mixerVia: 'ja' } }, 'hub'));
ok('hub.set als getal fout', fout({ hub: { set: 1 } }, 'hub'));
ok('hub met een adres fout (onbekende sleutel)', fout({ hub: { set: 'dj', adres: 'ws://localhost:7700/app' } }, 'hub'));
ok('pakket { profiel: "apc" } goed; profiel 3 fout', goed({ pakket: { profiel: 'apc' } }) && fout({ pakket: { profiel: 3 } }, 'pakket'));
ok('beeld { aan, latentieMs: 120 } goed', goed({ beeld: { aan: true, latentieMs: 120 } }));
ok('beeld.adres fout', fout({ beeld: { adres: 'ws://100.110.172.126:9000' } }, 'beeld') && /adres/.test(n({ beeld: { adres: 'x' } }).fouten[0].fout));
ok('beeld.relay fout', fout({ beeld: { relay: 'x' } }, 'beeld'));
ok('beeld.latentieMs 900 fout, -201 fout', fout({ beeld: { latentieMs: 900 } }, 'beeld') && fout({ beeld: { latentieMs: -201 } }, 'beeld'));
ok('koptelefoon { omgewisseld: true } goed, "ja" fout', goed({ koptelefoon: { omgewisseld: true } }) && fout({ koptelefoon: { omgewisseld: 'ja' } }, 'koptelefoon'));
ok('vormen { aan: false } goed, zonder aan fout', goed({ vormen: { aan: false } }) && fout({ vormen: {} }, 'vormen'));
ok('een fout in één deel laat de andere staan', (() => { const r = n({ nacht: { perNacht: 0 }, kaart: { krat: 'slim:vertrouwd' } }); return r.fouten.length === 1 && r.stand.delen.kaart.krat === 'slim:vertrouwd' && !('nacht' in r.stand.delen); })());

// ---- onbekend en verboden ----------------------------------------------------------
console.log('\nonbekend en verboden');
ok('onbekend deel "stems": waarschuwing, blijft staan, geen fout', (() => { const r = n({ stems: { aan: true } }); return r.fouten.length === 0 && r.waarschuwingen.length === 1 && r.stand.delen.stems.aan === true; })());
for (const v of VERBODEN_DELEN) ok(`verboden deel "${v}" is een fout`, fout({ [v]: { verberg: ['kaart'] } }, v));
ok('geen sleutel van DELEN staat in VERBODEN_DELEN', Object.keys(DELEN).every((d) => !VERBODEN_DELEN.includes(d)));
ok('geen deel heeft laag "engine" (een stand raakt de engine niet)', Object.values(DELEN).every((d) => d.laag !== 'engine'));
ok('DELEN en VERBODEN_DELEN zijn bevroren', Object.isFrozen(DELEN) && Object.isFrozen(DELEN.nacht) && Object.isFrozen(VERBODEN_DELEN));
ok('nog niet toegepast: master en beeld, niet nacht', nogNietToegepast({ delen: { master: {}, beeld: {}, nacht: {}, stems: {} } }).join() === 'master,beeld');

// ---- namen -----------------------------------------------------------------------
console.log('\nnamen');
ok('apc, avond-2, Thuis_1 zijn goede namen', ['apc', 'avond-2', 'Thuis_1'].every(naamGeldig));
ok('actief, keuzes, terug zijn gereserveerd', ['actief', 'keuzes', 'terug'].every((x) => GERESERVEERD.has(x) && !naamGeldig(x)));
ok('"a b", "", "../x", 61 tekens en een getal geweigerd', ['a b', '', '../x', 'x'.repeat(61), 3].every((x) => !naamGeldig(x)));
ok('het label in de Controlekamer is "Opstelling"', LABEL === 'Opstelling');

// ---- puur ----------------------------------------------------------------------------
console.log('\npuur');
const bron = readFileSync(`${wortel}src/standen/stand-model.js`, 'utf8');
ok('stand-model.js importeert niets', !/^\s*import\s/m.test(bron) && !/\bimport\(/.test(bron) && !/\brequire\(/.test(bron));
ok('en kent geen document, window of localStorage', !/\b(document|window|localStorage)\./.test(bron));

console.log(fails.length ? `\n${fails.length} FAIL` : '\nalles ok');
process.exit(fails.length ? 1 : 0);
