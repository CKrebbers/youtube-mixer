// Standen op schijf en activeren (server/standen.js, docs/STANDEN.md), zonder
// server: de echte Kaart op de verzonnen kaart (nep-kaart.mjs), de echte Nacht
// met een tijdelijk nacht.json en een nepklok, de echte racks/sjablonen.json en
// mappings/apc40mk2.json, en een nep-library die een eigen mapping-verschil van
// vier regels bewaart (zoals lib.zet/haal: via JSON).
// Draai met: node test/standen.test.mjs
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Standen, StandFout, beschrijfMapping } = await import('../server/standen.js');
const { Kaart } = await import('../server/kaart.js');
const { Nacht, pasToe, STANDAARD, nachtDatum } = await import('../server/nacht.js');
const { vingerafdruk } = await import('../src/control/mapping.js');
const { schrijfKaart } = await import('./nep-kaart.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const wortel = fileURLToPath(new URL('..', import.meta.url));
const map = mkdtempSync(join(tmpdir(), 'varve-standen-'));
const kaartPad = join(map, 'varve-kaart.json');
schrijfKaart(kaartPad);
const STD = JSON.parse(readFileSync(join(wortel, 'mappings', 'apc40mk2.json'), 'utf8'));
const SJABLONEN = JSON.parse(readFileSync(join(wortel, 'racks', 'sjablonen.json'), 'utf8')).racks;

/** Clay's eigen mapping als verschil van vier regels (zoals mapping-opslag.js hem bewaart). */
const VIER = {
  kind: 'diff', version: 3, device: 'apc40mk2', base: vingerafdruk(STD), top: {},
  rules: [1, 2, 3, 4].map((i) => ({ in: `cc:0:${40 + i}`, action: `track.${i}.filter`, mode: 'absolute' })), removed: [],
};

/** Een nep-library zoals Library.zet/haal: alles gaat door JSON. */
function nepLib(begin = {}) {
  const data = new Map(Object.entries(begin).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    haal: (k, std = null) => (data.has(k) ? JSON.parse(data.get(k)) : std),
    zet: (k, v) => { data.set(k, JSON.stringify(v)); },
  };
}

let teller = 0;
/** Een vers geheel in een eigen submap. `nu` is 10 okt 14:00 (de nacht van 10 okt). */
function maak({ nu = new Date(2026, 9, 10, 14, 0), profielen = async () => null, hubSets = async () => ['dj', 'studio'],
  speeltDeck = () => false, lib = nepLib({ mapping: VIER }), kaartBestand = kaartPad } = {}) {
  const sub = join(map, `geheel-${++teller}`);
  mkdirSync(sub, { recursive: true });
  const kaart = new Kaart({ pad: kaartBestand, db: ':memory:', library: { alleIds: () => [], track: () => null }, log: () => {} });
  const nachtPad = join(sub, 'nacht.json');
  const nacht = new Nacht({ pad: nachtPad, kaart, haal: async () => ({ ok: true }), klok: () => nu, log: () => {} });
  const logs = [];
  const standen = new Standen({
    map: join(sub, 'standen'), voorbeelden: join(wortel, 'tools', 'standen', 'voorbeelden'),
    lib, nacht, kaart, speeltDeck, profielen, hubSets, klok: () => nu, log: (s) => logs.push(s),
    valideerNacht: (d) => pasToe(STANDAARD, d),
    sjablonen: async () => SJABLONEN, standaardMapping: async () => STD,
  });
  return { standen, nacht, kaart, lib, sub, nachtPad, logs, map: join(sub, 'standen') };
}
const gooit = async (f) => { try { await f(); return null; } catch (err) { return err; } };
const lijstIn = (p) => (existsSync(p) ? readdirSync(p) : []);

try {
  // ---- lijst en lezen --------------------------------------------------------------
  console.log('lijst en lezen');
  {
    const { standen } = maak();
    const l = await standen.lijst();
    ok(`lijst(): de vier voorbeelden (${l.map((x) => x.naam).join(', ')})`, l.length === 4 && l.every((x) => x.bron === 'voorbeeld' && x.fouten === 0 && /^[0-9a-f]{16}$/.test(x.versie)));
    const g = await standen.lees('apc');
    ok('lees("apc"): voorbeeld, titel "Avond 1 · APC direct", foutloos', g.bron === 'voorbeeld' && g.stand.titel === 'Avond 1 · APC direct' && g.fouten.length === 0);
    ok('lees van een onbekende of ongeldige naam: null', (await standen.lees('bestaatniet')) === null && (await standen.lees('../x')) === null && (await standen.lees('actief')) === null);
    const o = await standen.overzicht();
    ok('overzicht: label Opstelling, actief null', o.label === 'Opstelling' && o.actief === null && o.standen.length === 4);
    ok('actief() zonder bestand: { naam: null }', (await standen.actief()).naam === null);
  }

  // ---- opslaan (PUT) -------------------------------------------------------------------
  console.log('\nopslaan met versie');
  {
    const { standen, map: smap } = maak();
    const nieuw = { schema: 1, titel: 'Proef', delen: { nacht: { aan: false } } };
    const r1 = await standen.schrijf('proef', nieuw, null);
    ok('PUT op een nieuwe naam met versie null: 200, bron eigen', r1.code === 200 && r1.antwoord.bron === 'eigen' && existsSync(join(smap, 'proef.json')));
    ok('geen .tmp achtergebleven', !lijstIn(smap).some((f) => f.endsWith('.tmp')));
    const r409 = await standen.schrijf('apc', { schema: 1, titel: 'x', delen: {} }, null);
    ok('PUT op "apc" met null: 409 met de voorbeeldstand (H10)', r409.code === 409 && r409.antwoord.stand?.titel === 'Avond 1 · APC direct' && r409.antwoord.bron === 'voorbeeld');
    const vb = await standen.lees('apc');
    const r2 = await standen.schrijf('apc', { ...vb.stand, titel: 'Avond 1 · eigen' }, vb.versie);
    ok('PUT op "apc" met de voorbeeldversie: 200, bron eigen', r2.code === 200 && r2.antwoord.bron === 'eigen');
    ok('… zonder .versies-kopie van het voorbeeld (dat zit in git)', lijstIn(join(smap, '.versies', 'apc')).length === 0);
    ok('eigen gaat vóór voorbeeld', (await standen.lees('apc')).bron === 'eigen' && (await standen.lees('apc')).stand.titel === 'Avond 1 · eigen');
    ok('een oude versie: 409 met wat er nu staat', (await standen.schrijf('apc', vb.stand, vb.versie)).code === 409);
    ok('versie bij een naam die niet bestaat: 409', (await standen.schrijf('nieuwer', nieuw, 'abcdef0123456789')).code === 409);
    const fout = await standen.schrijf('proef2', { schema: 1, delen: { nacht: { aan: true } } }, null);
    ok('een fout in een deel: 400 en niets geschreven', fout.code === 400 && /remmen/.test(fout.antwoord.fout) && !existsSync(join(smap, 'proef2.json')));
    ok('schema 2: 400', (await standen.schrijf('proef3', { schema: 2, delen: {} }, null)).code === 400);
    ok('een ongeldige naam: 400', (await standen.schrijf('a b', nieuw, null)).code === 400 && (await standen.schrijf('terug', nieuw, null)).code === 400);
    const w = await standen.schrijf('krat', { schema: 1, delen: { kaart: { krat: 'slim:bestaat-niet' }, master: { sjabloon: 'Nergens' } } }, null);
    ok('opslaan kijkt na: waarschuwing voor een onbekende krat en een onbekend sjabloon', w.code === 200 && w.antwoord.waarschuwingen.some((x) => /krat/.test(x)) && w.antwoord.waarschuwingen.some((x) => /sjabloon "Nergens"/.test(x)));
    // 60 keer opslaan: elke vorige inhoud staat in .versies, niets weg.
    let v = r1.antwoord.versie;
    for (let i = 0; i < 60; i++) {
      const r = await standen.schrijf('proef', { ...nieuw, titel: `Proef ${i}` }, v);
      if (r.code !== 200) { v = null; break; }
      v = r.antwoord.versie;
    }
    ok('60 keer opslaan: 60 vorige versies in .versies/proef (niets weggegooid)', v !== null && lijstIn(join(smap, '.versies', 'proef')).length === 60);
    ok('versies() geeft ze, nieuwste eerst', (await standen.versies('proef')).length === 60);
    ok('lijst(): nu 6 (de vier voorbeelden plus proef en krat; apc één keer, als eigen)', (await standen.lijst()).length === 6 && (await standen.lijst()).find((x) => x.naam === 'apc').bron === 'eigen');
  }

  // ---- activeren: de nacht ----------------------------------------------------------------
  console.log('\nactiveren: de nacht remmen');
  {
    const { standen, nacht, nachtPad } = maak();
    const speeldagen = nacht.instellingen.speeldagen.join();
    nacht.zet({ aan: true });   // Clay zette hem zelf aan
    const r = await standen.activeer('laptop');
    ok('laptop: nacht.aan === false, toegepast nacht', nacht.instellingen.aan === false && r.verslag.toegepast.includes('nacht'));
    ok('… speeldagen en perNacht ongewijzigd', nacht.instellingen.speeldagen.join() === speeldagen && nacht.instellingen.perNacht === 80);
    ok('… en nacht.json geschreven', existsSync(nachtPad) && JSON.parse(readFileSync(nachtPad, 'utf8')).instellingen.aan === false);
  }
  {
    const { standen, nacht } = maak();
    nacht.zet({ aan: true });
    const nu = new Date(2026, 9, 10, 14, 0);
    await standen.activeer('apc');
    ok('apc: vandaagNietDatum = nachtDatum(nu), aan blijft aan (W5: alleen vannacht)', nacht.instellingen.vandaagNietDatum === nachtDatum(nu) && nacht.instellingen.aan === true && nacht.vandaagNiet === true);
  }
  {
    const { standen, nacht } = maak();
    nacht._bezig = { gehaald: 0 };   // een nep-run loopt
    const r = await standen.activeer('laptop');
    ok('een lopende run + laptop: stop gevraagd en een waarschuwing (H2)', nacht._stop === true && r.verslag.waarschuwingen.some((w) => /nachtrun/.test(w)));
  }
  {
    const { standen, nacht } = maak();
    for (const naam of ['apc', 'alles', 'maschine', 'laptop']) await standen.activeer(naam);
    ok('alle vier na elkaar activeren: de nacht staat nooit aan', nacht.instellingen.aan === false);
  }

  // ---- activeren: mapping ---------------------------------------------------------------------
  console.log('\nactiveren: de mapping');
  {
    const { standen, lib, map: smap } = maak();
    await standen.schrijf('std', { schema: 1, titel: 'Standaard', delen: { mapping: 'standaard' } }, null);
    const r = await standen.activeer('std');
    const m = lib.haal('mapping');
    ok('mapping "standaard": een leeg verschil op de vingerafdruk van de standaard', r.verslag.toegepast.includes('mapping') && m.kind === 'diff' && m.rules.length === 0 && m.removed.length === 0 && m.base === vingerafdruk(STD));
    const vorige = lijstIn(join(smap, '.vorige'));
    const v = JSON.parse(readFileSync(join(smap, '.vorige', vorige[0]), 'utf8'));
    ok('.vorige/ bevat het oude verschil van vier regels', vorige.length === 1 && v.mapping.rules.length === 4 && v.door === 'activeer' && v.voor === 'std');
    ok('actief().delen.mapping beschrijft hem', (await standen.actief()).delen.mapping === 'standaard');
  }
  {
    const { standen, lib } = maak();
    await standen.activeer('apc');
    ok('apc noemt geen mapping: de vier regels blijven staan', lib.haal('mapping').rules.length === 4);
    await standen.schrijf('eigen', { schema: 1, delen: { mapping: VIER } }, null);
    lib.zet('mapping', null);
    await standen.activeer('eigen');
    ok('een stand met een eigen verschil zet dat verschil', lib.haal('mapping').rules.length === 4);
    ok('beschrijfMapping: standaard / eigen (4 regels)', beschrijfMapping(null) === 'standaard' && beschrijfMapping(VIER) === 'eigen (4 regels)' && beschrijfMapping({ ...VIER, rules: [] }) === 'standaard');
  }

  // ---- activeren: kaart, master, pakket, hub, mixer -------------------------------------------------
  console.log('\nactiveren: krat, master, pakket, hub');
  {
    const { standen } = maak();
    const m = await standen.activeer('maschine');
    ok('krat slim:vertrouwd: gecontroleerd, geen waarschuwing over de krat', m.verslag.gecontroleerd.includes('kaart') && !m.verslag.waarschuwingen.some((w) => /krat/.test(w)));
    const a = await standen.activeer('apc');
    ok('krat slim:proefkrat: gecontroleerd + "krat is leeg" (de nep-kaart heeft er 0) (H4)', a.verslag.gecontroleerd.includes('kaart') && a.verslag.waarschuwingen.some((w) => /proefkrat" is leeg/.test(w)));
    await standen.schrijf('onbekend', { schema: 1, delen: { kaart: { krat: 'slim:bestaat-niet' } } }, null);
    const o = await standen.activeer('onbekend');
    ok('krat slim:bestaat-niet: waarschuwing "niet in de kaart", niet gecontroleerd', !o.verslag.gecontroleerd.includes('kaart') && o.verslag.waarschuwingen.some((w) => /niet in de kaart/.test(w)));
  }
  {
    const { standen } = maak({ kaartBestand: join(map, 'bestaat-niet.json') });
    const r = await standen.activeer('apc');
    ok('zonder kaartbestand: "de kaart is niet geladen", krat niet nagekeken', r.verslag.waarschuwingen.some((w) => /niet geladen \(ontbreekt\)/.test(w)) && !r.verslag.gecontroleerd.includes('kaart'));
  }
  {
    const { standen } = maak();
    const r = await standen.activeer('apc');
    const a = await standen.actief();
    ok('apc: master Dub-worp vastgelegd voor de mixer (s:1, keten van 2)', r.verslag.mixer.includes('master') && a.mixer.master.sjabloon === 'Dub-worp' && a.mixer.master.herkomst === 's:1' && a.mixer.master.rack.chain.length === 2);
    await standen.schrijf('kwijt', { schema: 1, delen: { master: { sjabloon: 'Nergens' }, nacht: { vannacht: false } } }, null);
    const k = await standen.activeer('kwijt');
    ok('een onbekend sjabloon: fout bij master, de nacht wel toegepast', k.verslag.fouten.some((f) => f.deel === 'master') && k.verslag.toegepast.includes('nacht') && (await standen.actief()).mixer.master === null);
  }
  {
    const { standen } = maak();
    const r = await standen.activeer('apc');
    ok('pakket zonder avondpakket/profielen.json: "avondpakket nog niet samengevoegd"', r.verslag.waarschuwingen.some((w) => /avondpakket nog niet samengevoegd/.test(w)) && !r.verslag.gecontroleerd.includes('pakket'));
  }
  {
    const { standen } = maak({ profielen: async () => ({ laptop: {}, apc: {}, alles: {} }) });
    const a = await standen.activeer('apc');
    ok('met profielen en een bekend profiel: pakket gecontroleerd', a.verslag.gecontroleerd.includes('pakket') && !a.verslag.waarschuwingen.some((w) => /profiel/.test(w)));
    const m = await standen.activeer('maschine');
    ok('een profiel dat er niet in staat: waarschuwing', !m.verslag.gecontroleerd.includes('pakket') && m.verslag.waarschuwingen.some((w) => /profiel "maschine" staat niet/.test(w)));
  }
  {
    const { standen } = maak({ profielen: async () => { throw new SyntaxError('kapot'); } });
    const r = await standen.activeer('apc');
    ok('een kapot profielenbestand: waarschuwing, de rest gaat door', r.verslag.waarschuwingen.some((w) => /niet leesbaar/.test(w)) && r.verslag.toegepast.includes('nacht'));
  }
  {
    const { standen } = maak();
    const r = await standen.activeer('alles');
    const a = await standen.actief();
    ok('alles: hub genoemd, set studio en mixerVia in actief().hub', r.verslag.genoemd.includes('hub') && a.hub.set === 'studio' && a.hub.mixerVia === true);
    ok('alles: geen waarschuwing over de hub-set (studio bestaat)', !r.verslag.waarschuwingen.some((w) => /hub-set/.test(w)));
    await standen.schrijf('hubnee', { schema: 1, delen: { hub: { set: 'feest' } } }, null);
    ok('een hub-set die er niet is: waarschuwing', (await standen.activeer('hubnee')).verslag.waarschuwingen.some((w) => /hub-set "feest" niet gevonden/.test(w)));
  }
  {
    const { standen } = maak({ hubSets: async () => null });
    ok('geen hub op deze machine: geen waarschuwing over de set', !(await standen.activeer('alles')).verslag.waarschuwingen.some((w) => /hub-set/.test(w)));
  }

  // ---- fouten, onbekend, mixer-delen, een spelend deck ---------------------------------------------------
  console.log('\nfouten, mixer-delen, een spelend deck');
  {
    const { standen, lib, map: smap } = maak({ speeltDeck: () => true });
    mkdirSync(smap, { recursive: true });
    writeFileSync(join(smap, 'kapot.json'), JSON.stringify({ schema: 1, delen: { nacht: { perNacht: 0 }, mapping: 'standaard' } }));
    const g = await standen.lees('kapot');
    ok('met de hand kapot nacht-deel: lees() meldt de fout bij nacht', g.fouten.some((f) => f.deel === 'nacht') && !('nacht' in g.stand.delen));
    const r = await standen.activeer('kapot');
    ok('activeren: fout bij nacht in het verslag, mapping wel gezet', r.verslag.fouten.some((f) => f.deel === 'nacht') && r.verslag.toegepast.includes('mapping') && lib.haal('mapping').rules.length === 0);
    ok('er speelt een deck: waarschuwing "herlaad de mixer niet"', r.verslag.waarschuwingen.some((w) => /herlaad de mixer niet/.test(w)));
    writeFileSync(join(smap, 'stuk.json'), '{ "schema": 1, ');
    const s = await standen.lees('stuk');
    ok('kapotte JSON: lees() geeft stand null met de fout', s.stand === null && /geen geldige JSON/.test(s.fouten[0].fout));
    const e = await gooit(() => standen.activeer('stuk'));
    ok('… en activeren gooit 400', e instanceof StandFout && e.code === 400);
    const e404 = await gooit(() => standen.activeer('nergens'));
    ok('een onbekende stand: 404', e404 instanceof StandFout && e404.code === 404);
    await standen.schrijf('mixerdelen', { schema: 1, delen: { beeld: { aan: true }, koptelefoon: { omgewisseld: true }, vormen: { aan: false }, stems: { x: 1 } } }, null);
    const m = await standen.activeer('mixerdelen');
    ok('beeld, koptelefoon, vormen: overgeslagen (stap K); onbekend deel: waarschuwing', m.verslag.overgeslagen.map((o) => o.deel).join() === 'beeld,koptelefoon,vormen' && m.verslag.waarschuwingen.some((w) => /onbekend deel "stems"/.test(w)));
  }

  // ---- .actief.json overleeft een herstart ---------------------------------------------------------------
  console.log('\nactief en herstart');
  {
    const g = maak();
    const r = await g.standen.activeer('apc');
    const opnieuw = new Standen({ map: g.map, voorbeelden: join(wortel, 'tools', 'standen', 'voorbeelden'), lib: g.lib, nacht: g.nacht, kaart: g.kaart });
    const a = await opnieuw.actief();
    ok('een nieuw object leest .actief.json terug (naam, sinds, verslag)', a.naam === 'apc' && a.sinds === r.sinds && a.verslag.toegepast.includes('nacht') && a.bron === 'voorbeeld');
    ok('geen .tmp naast .actief.json', !lijstIn(g.map).some((f) => f.endsWith('.tmp')));
    ok('het serverlog noemt de activering', g.logs.some((l) => /\[standen\] apc actief/.test(l)));
  }

  // ---- verschil -----------------------------------------------------------------------------------------
  console.log('\nvooraf zien wat activeren verandert');
  {
    const { standen } = maak();
    const v = await standen.verschil('apc');
    ok('verschil("apc"): nacht van "uit" naar "uit · vannacht niet", nu', v.delen.nacht.van === 'uit' && v.delen.nacht.naar === 'uit · vannacht niet' && v.delen.nacht.moment === 'nu');
    ok('… master — → Dub-worp (mixer volgt nog niet), krat (kies hem in de kaart)', v.delen.master.van === '—' && v.delen.master.naar === 'Dub-worp' && /mixer volgt nog niet/.test(v.delen.master.moment) && /kies hem in de kaart/.test(v.delen.kaart.moment));
    ok('… geen mapping-deel (apc noemt geen mapping)', !('mapping' in v.delen));
    const h = await standen.verschil('alles');
    ok('verschil("alles"): hub "start hem zelf"', h.delen.hub.naar === 'studio, mixer via de hub' && /start hem zelf/.test(h.delen.hub.moment));
    await standen.activeer('apc');
    ok('na activeren: master van Dub-worp naar Dub-worp', (await standen.verschil('alles')).delen.master.van === 'Dub-worp');
    ok('verschil van een onbekende stand gooit 404', (await gooit(() => standen.verschil('nergens')))?.code === 404);
  }

  // ---- vastleggen ---------------------------------------------------------------------------------------
  console.log('\nvastleggen: de huidige toestand in de stand');
  {
    const { standen, nacht, map: smap } = maak();
    const vb = await standen.lees('apc');
    const eerst = await standen.schrijf('apc', vb.stand, vb.versie);   // nu een eigen bestand
    nacht.zet({ vandaagNiet: true });
    const r = await standen.vastleggen('apc', eerst.antwoord.versie);
    const g = await standen.lees('apc');
    ok('vastleggen("apc"): 200, mapping = het verschil van vier regels', r.code === 200 && g.stand.delen.mapping.rules.length === 4);
    ok('… nacht alleen als rem: { aan: false, vannacht: false }', g.stand.delen.nacht.aan === false && g.stand.delen.nacht.vannacht === false && Object.keys(g.stand.delen.nacht).length === 2);
    ok('… hub/pakket/kaart/master behouden', g.stand.delen.pakket.profiel === 'apc' && g.stand.delen.kaart.krat === 'slim:proefkrat' && g.stand.delen.master.sjabloon === 'Dub-worp');
    ok('… één vorige versie in .versies/apc', lijstIn(join(smap, '.versies', 'apc')).length === 1);
    ok('… met een oude versie: 409', (await standen.vastleggen('apc', eerst.antwoord.versie)).code === 409);
    const zonder = await standen.vastleggen('maschine', (await standen.lees('maschine')).versie, ['pakket']);
    const gm = await standen.lees('maschine');
    ok('behoud ["pakket"]: hub en kaart vallen weg, pakket blijft', zonder.code === 200 && gm.stand.delen.pakket.profiel === 'maschine' && !('hub' in gm.stand.delen) && !('kaart' in gm.stand.delen));
  }
  {
    const { standen, nacht } = maak({ lib: nepLib({}) });
    nacht.zet({ aan: true });
    const r = await standen.vastleggen('nieuw', null);
    const g = await standen.lees('nieuw');
    ok('vastleggen op een nieuwe naam zonder eigen mapping: mapping "standaard", geen nachtdeel (de nacht staat aan)', r.code === 200 && g.stand.delen.mapping === 'standaard' && !('nacht' in g.stand.delen));
  }

  // ---- terug ------------------------------------------------------------------------------------------------
  console.log('\nvorige terugzetten');
  {
    const { standen, lib, nacht, map: smap } = maak();
    const e = await gooit(() => standen.terug());
    ok('terug() zonder .vorige: gooit met code 404', e instanceof StandFout && e.code === 404);
    nacht.zet({ aan: true });
    await standen.schrijf('std', { schema: 1, delen: { mapping: 'standaard', nacht: { aan: false } } }, null);
    await standen.activeer('std');
    ok('na activeren: mapping leeg, nacht uit', lib.haal('mapping').rules.length === 0 && nacht.instellingen.aan === false);
    const t = await standen.terug();
    ok('terug(): de vier regels en de nacht zoals hij was', t.ok && lib.haal('mapping').rules.length === 4 && nacht.instellingen.aan === true && t.delen.join() === 'mapping,nacht');
    ok('… schreef zelf een tweede .vorige/ (door: terug), wist niets', lijstIn(join(smap, '.vorige')).length === 2
      && JSON.parse(readFileSync(join(smap, '.vorige', lijstIn(join(smap, '.vorige')).sort().at(-1)), 'utf8')).door === 'terug');
    const a = await standen.actief();
    ok('… en actief() = { naam: null, teruggezet }', a.naam === null && typeof a.teruggezet === 'string');
    const o = await standen.overzicht();
    ok('overzicht.actief toont het terugzetten (voor de tegel)', o.actief?.teruggezet === a.teruggezet);
    const t2 = await standen.terug();
    ok('nog eens terug = de activering opnieuw (mapping leeg, nacht uit)', t2.ok && lib.haal('mapping').rules.length === 0 && nacht.instellingen.aan === false);
  }
  {
    const { standen, nacht } = maak();
    await standen.activeer('apc');
    ok('apc zet vannacht niet', nacht.vandaagNiet === true);
    await standen.terug();
    ok('terug zet "vannacht niet" ook terug', nacht.vandaagNiet === false && nacht.instellingen.vandaagNietDatum === null);
  }

  // ---- keuzes voor de bewerker ----------------------------------------------------------------------------
  console.log('\nkeuzes');
  {
    const { standen } = maak({ profielen: async () => ({ laptop: {}, apc: {}, maschine: {}, alles: {} }) });
    const k = await standen.keuzes();
    ok(`keuzes(): 8 sjablonen (${k.sjablonen.length}), de kratten van de nep-kaart (${k.kratten.length})`, k.sjablonen.length === 8 && k.sjablonen.includes('Dub-worp') && k.kratten.length === 8 && k.kratten.some((x) => x.id === 'slim:proefkrat' && x.aantal === 0));
    ok('… profielen en hub-sets, mapping nu "eigen (4 regels)"', k.profielen.join() === 'laptop,apc,maschine,alles' && k.hubSets.join() === 'dj,studio' && k.mappingNu === 'eigen (4 regels)');
  }
  {
    const { standen } = maak({ hubSets: async () => { throw new Error('weg'); } });
    const k = await standen.keuzes();
    ok('zonder profielen en zonder hub: null, null', k.profielen === null && k.hubSets === null);
  }

  // ---- iCloud: een bestand dat niet terugkomt ---------------------------------------------------------------
  // Een named pipe (FIFO) blijft bij het openen hangen tot er een schrijver is,
  // zoals een "dataless" iCloud-bestand zonder netwerk. Daarna openen we hem zelf
  // om te schrijven, zodat de draad in de threadpool weer vrijkomt.
  console.log('\nlezen binnen de tijd');
  {
    const { standen, map: smap } = maak();
    mkdirSync(smap, { recursive: true });
    const fifo = join(smap, 'traag.json');
    const { spawnSync } = await import('node:child_process');
    const mk = spawnSync('mkfifo', [fifo]);
    if (mk.status !== 0) console.log('  -- mkfifo niet beschikbaar: lezen binnen de tijd niet getoetst');
    else {
      standen.leesMs = 150;
      const t0 = performance.now();
      const e = await gooit(() => standen.lees('traag'));
      const ms = performance.now() - t0;
      ok(`een bestand dat niet terugkomt: 503 "niet lokaal beschikbaar (iCloud?)" na ${Math.round(ms)} ms`, e instanceof StandFout && e.code === 503 && /iCloud/.test(e.message) && ms < 1000);
      const { openSync, closeSync, constants } = await import('node:fs');
      try { closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK)); } catch {}
    }
  }
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nalles ok');
process.exit(fails.length ? 1 : 0);
