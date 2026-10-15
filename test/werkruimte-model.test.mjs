// De werkruimte als data (werkruimte S3, docs/WERKRUIMTE.md B2–B4, docs/werkruimte/S3.md):
// src/werk/model.js, puur. De regels van B3 één voor één, de voorbeelden, samenstellen
// tegen de echte standaardmapping (met Clay's verschil), telNieuwePlekken en de kleur.
// Draai met: node test/werkruimte-model.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const M = await import('../src/werk/model.js');
const { Mapping, sleutelVan } = await import('../src/control/mapping.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;
const lagenMod = await import('../src/control/lagen.js');
const rack = await import('../src/engine/rack.js');
const { DEEL_KLEUR, LABEL_KLEUR, kleurVanDeel, hexVan, tekstOp } = await import('../src/werk/kleuren.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const pad = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const lees = (p) => JSON.parse(readFileSync(pad(p), 'utf8'));
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const standaarden = { apc40mk2: lees('mappings/apc40mk2.json'), 'maschine-mk2': lees('mappings/maschine-mk2.json') };

/*
 * De stukken van v1 (B4). Wat er al in mappings/stukken/ staat telt (basis van S3, uitlijn van
 * S1 zodra die is samengevoegd); wat er nog niet is maken we hier na zoals het ontwerp het
 * beschrijft, zodat "apc-alleen = de standaard plus precies de stukken" nu al te toetsen is.
 */
const gridNote = apc.gridNote;
const NAMAAK = {
  uitlijn: {
    schema: 1, stuk: 'uitlijn', titel: 'Acht fasemeters (namaak volgens B4)',
    mapjes: { nieuw: { 'apc40mk2.device.uitlijn': { naam: 'uitlijn', kiesknop: { in: 'note:0:63', shift: true }, kleur: 'groen' } } },
    regels: { apc40mk2: [
      { in: 'note:0:63', shift: true, action: 'layer.device.uitlijn', mode: 'trigger' },
      ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [
        { in: `cc:0:${16 + i}`, laag: 'device.uitlijn', action: `track.${i + 1}.phase.offset`, mode: 'endless', takeover: 1 },
        { in: `cc:0:${16 + i}`, laag: 'device.uitlijn', shift: true, action: `track.${i + 1}.phase.offset.fine`, mode: 'endless', takeover: 1 }]),
      { in: 'note:0:58', laag: 'device.uitlijn', action: 'track.{focus}.jog.back', mode: 'trigger' },
      { in: 'note:0:59', laag: 'device.uitlijn', action: 'track.{focus}.jog.fwd', mode: 'trigger' },
      { in: 'note:0:62', laag: 'device.uitlijn', action: 'track.{focus}.bar.align', mode: 'trigger' }] },
  },
  'fx-matrix': {
    schema: 1, stuk: 'fx-matrix', titel: 'fx-matrix (namaak volgens A3/B4)',
    mapjes: { nieuw: { 'apc40mk2.grid.fx': { naam: 'fx-matrix', kiesknop: { in: 'note:0:62', shift: true }, kleur: 'violet' } } },
    regels: { apc40mk2: [
      ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [1, 2, 3, 4].map((r) => ({ in: `note:0:${gridNote(k, r)}`, laag: 'grid.fx', action: `track.${k}.fx.knob.${r}.hold`, mode: 'trigger' }))),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ in: `note:0:${gridNote(k, 5)}`, laag: 'grid.fx', action: `track.${k}.send.a`, mode: 'druk', naar: 1 })),
      ...[1, 2, 3, 4].map((k) => ({ in: `note:0:${81 + k}`, laag: 'grid.fx', action: `master.fx.knob.${k}.hold`, mode: 'trigger' }))] },
  },
  'mix-extra': {
    schema: 1, stuk: 'mix-extra', titel: '⇧ A|B = thru (namaak)',
    regels: { apc40mk2: [0, 1, 2, 3, 4, 5, 6, 7].map((ch) => ({ in: `note:${ch}:66`, shift: true, action: `track.${ch + 1}.xfade.thru`, mode: 'trigger' })) },
  },
};
const stukken = {};
for (const naam of ['basis', 'uitlijn', 'fx-matrix', 'mix-extra']) {
  const p = `mappings/stukken/${naam}.json`;
  stukken[naam] = existsSync(pad(p)) ? lees(p) : NAMAAK[naam];
}
console.log(`stukken: ${Object.entries(stukken).map(([n, s]) => `${n} (${s === NAMAAK[n] ? 'namaak' : 'echt'})`).join(', ')}`);

const voorbeeld = (n) => lees(`tools/werkruimtes/voorbeelden/${n}.json`);
const norm = (ruw, o = {}) => M.normaliseerWerkruimte(ruw, { standaarden, stukken, ...o });
const basis = () => ({ schema: 1, naam: 'proef', delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { grid: 'hotcues' } } } });
const met = (extra) => ({ ...basis(), ...extra });
const foutMet = (ruw, stukje) => norm(ruw).fouten.some((f) => f.includes(stukje));

console.log('kopieën kloppen met de bron');
ok('PALET = de namen van PALETTE in devices/apc40mk2.js', deepEqual([...M.PALET].sort(), Object.keys(apc.palette).sort()));
ok('CURVES = CURVES in rack.js', deepEqual([...M.CURVES], rack.CURVES));
{
  const fb = readFileSync(pad('src/control/feedback.js'), 'utf8');
  const kleur = Object.fromEntries([...fb.matchAll(/\^layer\\\.grid\\\.(\w+)\$\/,\s*\{ aan: '(\w+)'/g)].map((m) => [m[1], m[2]]));
  ok('GRID_KLEUR = de aan-kleur van layer.grid.* in feedback.js', Object.keys(kleur).length === 9 && deepEqual(kleur, { ...M.GRID_KLEUR }));
}
{
  lagenMod.voegVormMapjeToe();
  const b = M.bekendUitGroepen(lagenMod.GROEPEN);
  const namen = (x) => Object.fromEntries(Object.entries(x).map(([g, d]) => [g, Object.keys(d.mapjes).sort()]));
  ok('STANDAARD_MAPJES.apc40mk2 = GROEPEN van lagen.js (met vorm)', deepEqual(namen(b.apc40mk2), namen(M.STANDAARD_MAPJES.apc40mk2)));
  ok('de volgorde van ▲ ▼ = die van lagen.js', deepEqual(b.apc40mk2.grid.volgorde, M.STANDAARD_MAPJES.apc40mk2.grid.volgorde));
  ok('elk APC-mapje heeft een kiesknop (dus de toets "zonder kiesknop" kan iets zien)', Object.values(b.apc40mk2.grid.mapjes).every((x) => x.kiesknop));
  lagenMod.haalMapjeWeg('device', 'vorm');
}
ok('model.js heeft geen import, geen DOM, geen dynamische import', (() => {
  const bron = readFileSync(pad('src/werk/model.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  return !/^\s*import\s/m.test(bron) && !/\bimport\(/.test(bron) && !/\b(document|window|navigator)\./.test(bron);
})());

console.log('\nde voorbeelden');
for (const n of ['standaard', 'apc-alleen', 'twee-handen']) {
  const r = norm(voorbeeld(n));
  ok(`${n}: normaliseert zonder fout${r.fouten.length ? ` (${r.fouten.join('; ')})` : ''}`, r.werkruimte && r.fouten.length === 0);
  // Ook zonder de stukken die nog niet bestaan: dan alleen waarschuwingen.
  const zonder = M.normaliseerWerkruimte(voorbeeld(n), { standaarden, stukken: { basis: stukken.basis } });
  ok(`${n}: zonder de stukken van andere sporen ook geen fout (${zonder.waarschuwingen.length} waarschuwingen)`, zonder.fouten.length === 0
    && (n === 'standaard' || zonder.waarschuwingen.some((w) => /stuk "fx-matrix" bestaat \(nog\) niet/.test(w))));
}
{
  const s = norm(voorbeeld('standaard')).werkruimte;
  ok('standaard: geen delen, geen stukken, geen regels', Object.keys(s.delen).length === 0 && s.stukken.length === 0 && Object.keys(s.regels).length === 0);
  const t = norm(voorbeeld('twee-handen')).werkruimte;
  ok('twee-handen: acht delen, start mix, expliciet, vereist apc + maschine, terugval apc-alleen',
    M.delenLijst(t).map((d) => d.label).join(' ') === 'MIX UITLIJN FX STEMS SECTIES SPELEN BEELD LIBRARY'
    && t.deel.start === 'mix' && t.deel.kiezen === 'expliciet' && t.vereist.join() === 'apc40mk2,maschine-mk2' && t.terugval === 'apc-alleen');
  ok('twee-handen: de conditie van SPELEN blijft een conditie', deepEqual(t.delen.spelen.apc40mk2.device, { als: 'focus.instrument', dan: 'inst', anders: 'strip' }));
  ok('twee-handen: mijn dub = nieuw mapje met kiesknop ⇧ Device ◀', t.mapjes.nieuw.length === 1 && t.mapjes.nieuw[0].laag === 'mijndub' && t.mapjes.nieuw[0].kiesknop.in === 'note:0:58');
  ok('twee-handen: ▲ ▼ = hotcues loops klank stems fx video', t.mapjes.volgorde['apc40mk2.grid'].join(' ') === 'hotcues loops klank stems fx video');
  const a = norm(voorbeeld('apc-alleen')).werkruimte;
  ok('apc-alleen: kiezen volgt, de volgt-lijst van A4 (zeven mapjes)', a.deel.kiezen === 'volgt' && a.volgt.length === 7
    && a.volgt.some((v) => v.mapje === 'grid.stems' && v.deel === 'stems') && a.volgt.some((v) => v.mapje === 'device.uitlijn' && v.deel === 'uitlijn'));
  ok('apc-alleen: stukken basis, uitlijn, fx-matrix, mix-extra', a.stukken.join() === 'basis,uitlijn,fx-matrix,mix-extra');
}

console.log('\nweigeren (fouten)');
ok('verberg op het hoogste niveau = fout', foutMet(met({ verberg: ['track.1.play'] }), 'verberg'));
ok('uit in een deel = fout', foutMet(met({ delen: { mix: { label: 'MIX', kleur: 'wit', uit: ['stems'] } } }), '"uit"'));
ok('start (een klank) op het hoogste niveau = fout', foutMet(met({ start: 'track.1.play' }), '"start"'));
ok('een adres in een scherm = fout', foutMet(met({ schermen: { ipad: { soort: 'ipad', adres: '10.0.0.2' } } }), 'adres'));
{
  const delen = Object.fromEntries('abcdefghi'.split('').map((c) => [`d${c}`, { label: c.toUpperCase(), kleur: 'wit' }]));
  ok('negen delen = fout (hooguit 8)', foutMet(met({ delen }), 'hooguit 8 delen'));
  const acht = Object.fromEntries('abcdefgh'.split('').map((c) => [`d${c}`, { label: c.toUpperCase(), kleur: 'wit' }]));
  ok('acht delen mag', norm(met({ delen: acht })).fouten.length === 0);
}
ok('label van 9 tekens = fout', foutMet(met({ delen: { mix: { label: 'MIXMIXMIX', kleur: 'wit' } } }), 'label'));
ok('kleur buiten het palet = fout', foutMet(met({ delen: { mix: { label: 'MIX', kleur: 'paars' } } }), 'APC-palet'));
ok('een deelnaam met een cijfer = fout', foutMet(met({ delen: { mix2: { label: 'MIX', kleur: 'wit' } } }), 'deelnaam'));
ok('naam met een hoofdletter = geweigerd', M.normaliseerWerkruimte({ schema: 1, naam: 'Twee' }).werkruimte === null);
ok('naam "actief" = geweigerd', M.normaliseerWerkruimte({ schema: 1, naam: 'actief' }).werkruimte === null);
ok('schema 2 = geweigerd', M.normaliseerWerkruimte({ schema: 2, naam: 'x' }).werkruimte === null);
ok('een conditie buiten de witte lijst = fout', foutMet(met({ delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { device: { als: 'focus.bpm > 120', dan: 'rack' } } } } }), 'witte lijst') || foutMet(met({ delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { device: { als: 'focus.bpm > 120', dan: 'rack' } } } } }), 'staat niet op de lijst'));
ok('een conditie met een expressie-veld = fout', foutMet(met({ delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { device: { als: 'hub', dan: 'rack', of: 'strip' } } } } }), 'geen expressies'));
ok('een mapje zonder kiesknop dat in geen deel staat = fout', foutMet(met({ mapjes: { nieuw: { 'device.stil': { naam: 'stil', kiesknop: null } } } }), 'onbereikbaar'));
ok('… en in een deel is het goed', norm(met({ mapjes: { nieuw: { 'device.stil': { naam: 'stil', kiesknop: null } } },
  delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { device: 'stil' } } } })).fouten.length === 0);
ok('een nieuw mapje zonder het veld kiesknop = fout (uitdrukkelijk null of een knop)', foutMet(met({ mapjes: { nieuw: { 'device.x': { naam: 'x' } } } }), 'kiesknop nodig'));
ok('een nieuw mapje dat al bestaat (grid.stems) = fout', foutMet(met({ mapjes: { nieuw: { 'grid.stems': { naam: 'x', kiesknop: null } } } }), 'bestaat al'));
ok('een nieuw mapje in de groep edit = fout', foutMet(met({ mapjes: { nieuw: { 'edit.x': { naam: 'x', kiesknop: null } } } }), 'alleen in'));
ok('een kiesknop op een bezette plek = botsing (geen regel erbij)', (() => {
  const w = norm(met({ mapjes: { nieuw: { 'device.x': { naam: 'x', kiesknop: { in: 'note:0:58' } } } } })).werkruimte;
  const s = M.samenstellen(standaarden, stukken, w);
  return s.botsingen.some((b) => b.sleutel === 'note:0:58');
})());
ok('▲ ▼ zonder een mapje dat geen kiesknop heeft = fout', (() => {
  const b = M.bekendUitGroepen(lagenMod.GROEPEN);
  b.apc40mk2.grid.mapjes.auto.kiesknop = false;   // stel: auto had geen kiesknop
  return M.normaliseerWerkruimte(met({ mapjes: { volgorde: { 'apc40mk2.grid': ['hotcues', 'loops'] } } }), { standaarden, bekend: b }).fouten.some((f) => f.includes('onbereikbaar'));
})());
ok('▲ ▼ zonder sampler/secties/patronen/auto mag (die hebben een kiesknop)', norm(met({ mapjes: { volgorde: { 'apc40mk2.grid': ['hotcues', 'loops', 'klank', 'stems', 'video'] } } })).fouten.length === 0);

const regel = (r) => met({ regels: { apc40mk2: [r] } });
ok('een regel op de fader (kern) = fout', foutMet(regel({ in: 'cc:0:7', action: 'track.2.fader', mode: 'absolute' }), 'de kern'));
ok('een regel op de fader in een NIEUW mapje = ook fout', foutMet(met({ mapjes: { nieuw: { 'device.x': { naam: 'x', kiesknop: { in: 'note:0:59', shift: true } } } },
  regels: { apc40mk2: [{ in: 'cc:3:7', laag: 'device.x', action: 'track.1.send.a', mode: 'absolute' }] } }), 'de kern'));
ok('⇧ ● (cue, kern) = fout', foutMet(regel({ in: 'note:0:48', shift: true, action: 'track.1.pfl' }), 'de kern'));
ok('play (kern) = fout', foutMet(regel({ in: 'note:2:50', action: 'track.3.sync' }), 'de kern'));
ok('⇧ master-knop is vrij (THUIS)', norm(regel({ in: 'note:0:80', shift: true, action: 'werk.thuis' })).fouten.length === 0);
ok('⇧ A|B is vrij (thru)', norm(regel({ in: 'note:4:66', shift: true, action: 'track.5.xfade.thru' })).fouten.length === 0);
ok('master-knop zonder shift (beeld zwart, kern) = fout', foutMet(regel({ in: 'note:0:80', action: 'werk.thuis' }), 'de kern'));
ok('een bezette plek (Device ◀ zonder shift) = fout', foutMet(regel({ in: 'note:0:58', action: 'werk.thuis' }), 'al bezet'));
ok('een bezette plek in een standaardmapje (cc:0:20 @device.rack) = fout', foutMet(regel({ in: 'cc:0:20', laag: 'device.rack', action: 'video.fx.pixel', mode: 'absolute' }), 'al bezet'));
ok('een houd-regel op play = fout', foutMet(met({ regels: { apc40mk2: [{ in: 'cc:0:16', laag: 'houd.volume', action: 'track.1.play' }] } }), 'tijdkritisch'));
ok('een druk-regel op play = fout', foutMet(regel({ in: 'note:0:58', shift: true, action: 'track.{focus}.play', mode: 'druk', naar: 1 }), 'tijdkritisch'));
ok('een latch-regel op hotcue = fout', foutMet(regel({ in: 'note:0:58', shift: true, action: 'track.1.hotcue.3', mode: 'latch', naar: 1 }), 'tijdkritisch'));
ok('een druk-regel op een mapje (layer.*) = fout', foutMet(regel({ in: 'note:0:58', shift: true, action: 'layer.grid.stems', mode: 'druk', naar: 1 }), 'tijdkritisch'));
ok('een druk-regel op send.a mag (de dub-worp)', norm(regel({ in: 'note:0:58', shift: true, action: 'track.{focus}.send.a', mode: 'druk', naar: 1 })).fouten.length === 0);
ok('druk zonder naar = fout (regel 2: een stand 0..1)', foutMet(regel({ in: 'note:0:58', shift: true, action: 'track.1.send.a', mode: 'druk' }), 'naar'));
ok('een onbekende modus = fout', foutMet(regel({ in: 'note:0:58', shift: true, action: 'track.1.send.a', mode: 'slingeren' }), 'onbekende modus'));
ok('modifier bestaat niet in v1 = fout', foutMet(regel({ in: 'note:0:58', shift: true, action: 'track.1.send.a', modifier: 'note:0:59' }), 'modifier'));
ok('een superknop die een superknop stuurt = fout', foutMet(met({ superknoppen: [{ nr: 1, links: [{ action: 'super.2' }] }] }), 'superknop'));
ok('17 superknoppen = fout', foutMet(met({ superknoppen: Array.from({ length: 17 }, (_, i) => ({ nr: i + 1, links: [{ action: 'track.1.filter' }] })) }), 'hooguit 16'));
ok('record.* in mag van de iPad = fout (de vaste lijst)', foutMet(met({ schermen: { ipad: { soort: 'ipad', mag: ['record.*', 'track.*.section.*'] } } }), 'nooit van buiten'));
ok('volgt naar een deel dat niet bestaat = fout', foutMet(met({ volgt: [{ apparaat: 'apc40mk2', mapje: 'grid.stems', deel: 'stems' }] }), 'bestaat niet'));
ok('deel.start dat geen deel is = fout', foutMet(met({ deel: { start: 'fx' } }), 'deel.start'));
ok('vereist een onbekend apparaat = fout', foutMet(met({ vereist: ['launchpad'] }), 'onbekend apparaat'));
ok('terugval naar zichzelf = fout', foutMet(met({ terugval: 'proef' }), 'ANDERE'));

console.log('\nwaarschuwen');
const waarschuwt = (ruw, stukje) => { const r = norm(ruw); return r.fouten.length === 0 && r.waarschuwingen.some((w) => w.includes(stukje)); };
ok('een onbekend stuk = waarschuwing', waarschuwt(met({ stukken: ['bestaat-niet'] }), 'stuk "bestaat-niet" bestaat (nog) niet'));
ok('een onbekend mapje in een deel = waarschuwing (overgeslagen)', (() => {
  const r = norm(met({ delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { grid: 'raket' } } } }));
  return r.fouten.length === 0 && r.waarschuwingen.some((w) => w.includes('grid.raket')) && !('apc40mk2' in r.werkruimte.delen.mix);
})());
ok('een groep die het apparaat niet kent = waarschuwing', waarschuwt(met({ delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { pads: 'x' } } } }), 'geen groep "pads"'));
ok('een onbekende rij = waarschuwing', waarschuwt(met({ delen: { mix: { label: 'MIX', kleur: 'wit', schermen: { hoofd: { rijen: ['raket'] } } } } }), 'onbekende rij'));
ok('STEMS in violet = waarschuwing (de stems-modus brandt zeegroen)', waarschuwt(met({ delen: { stems: { label: 'STEMS', kleur: 'violet', apc40mk2: { grid: 'stems' } } } }), 'brandt zeegroen'));
ok('STEMS in zeegroen = geen waarschuwing over kleur', !norm(met({ delen: { stems: { label: 'STEMS', kleur: 'zeegroen', apc40mk2: { grid: 'stems' } } } })).waarschuwingen.some((w) => w.includes('brandt')));
ok('MIX in wit met hotcues (het standaardmapje) = geen kleurwaarschuwing', !norm(basis()).waarschuwingen.some((w) => w.includes('brandt')));
ok('UITLIJN in rood met device.uitlijn (groen uit het stuk) = waarschuwing', waarschuwt(met({ stukken: ['uitlijn'], delen: { uitlijn: { label: 'UITLIJN', kleur: 'rood', apc40mk2: { device: 'uitlijn' } } } }), 'brandt groen'));
ok('een panel-action die niet bestaat = waarschuwing (grijs)', (() => {
  const r = M.normaliseerWerkruimte(met({ panelen: { p: { items: [{ soort: 'knop', action: 'track.1.raket' }] } } }), { standaarden, bestaat: (a) => a !== 'track.1.raket' });
  return r.fouten.length === 0 && r.waarschuwingen.some((w) => w.includes('track.1.raket'));
})());
{
  const vorige = M.samenstellen(standaarden, stukken, norm(met({ stukken: ['basis'] })).werkruimte);
  const deze = M.samenstellen(standaarden, stukken, norm(voorbeeld('apc-alleen')).werkruimte);
  const t = M.telNieuwePlekken(vorige, deze);
  ok(`telNieuwePlekken: basis → apc-alleen = ${t.aantal} nieuwe plekken, boven 12 een waarschuwing`, t.aantal > 12 && /meer dan 12/.test(t.waarschuwing));
  ok('telNieuwePlekken: dezelfde = 0, geen waarschuwing', M.telNieuwePlekken(deze, deze).aantal === 0 && M.telNieuwePlekken(deze, deze).waarschuwing === null);
  const twaalf = M.samenstellen(standaarden, {}, norm(met({ regels: { apc40mk2: Array.from({ length: 12 }, (_, i) => ({ in: `note:${i % 8}:66`, shift: true, action: 'werk.thuis' })).filter((r, i, a) => a.findIndex((x) => x.in === r.in) === i) } })).werkruimte);
  ok('telNieuwePlekken: 8 plekken = geen waarschuwing', M.telNieuwePlekken(null, twaalf).aantal === 8 && M.telNieuwePlekken(null, twaalf).waarschuwing === null);
  ok('telNieuwePlekken: weg telt ook', M.telNieuwePlekken(twaalf, null).aantal === 8);
}

console.log('\nsamenstellen');
// De mapping van vandaag: de standaard + Clay's verschil (docs/MAPPING-VERSCHIL.md: rack-knoppen 5–8 = video).
const VIDEO = { 'cc:0:20': 'video.fx.pixel', 'cc:0:21': 'video.fx.rgb', 'cc:0:22': 'video.fx.trails', 'cc:0:23': 'video.fx.grain' };
const clayVerschil = { kind: 'diff', version: 3, device: 'apc40mk2', base: null, top: {}, removed: [],
  rules: Object.entries(VIDEO).map(([s, a], i) => ({ in: s, action: a, mode: 'absolute', laag: 'device.rack', label: `device knob ${5 + i}` })) };
const vandaag = () => {
  const m = new Mapping({ read: () => null, invoke: () => {} });
  m.zetStandaard(standaarden.apc40mk2);
  m.load(clayVerschil);
  return m;
};
const regelsVan = (m) => [...m.rules.entries()].map(([k, r]) => [k, { in: r.in, action: r.action, mode: r.mode, shift: !!r.shift, laag: r.laag ?? null }]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const pasToe = (m, s) => { for (const f of s.apparaten.apc40mk2?.fragmenten ?? []) m.vervangFragment(f.bron, f.doc); return m; };
{
  const m0 = vandaag();
  ok('de mapping van vandaag heeft Clay\'s vier regels op cc:0:20–23 @device.rack', Object.entries(VIDEO).every(([s, a]) => m0.rules.get(`${s}@device.rack`)?.action === a));
  const s = M.samenstellen(standaarden, stukken, norm(voorbeeld('standaard')).werkruimte);
  ok('standaard: geen fragmenten, geen mapjes, geen volgorde', !s.apparaten.apc40mk2 && s.botsingen.length === 0 && s.fouten.length === 0);
  const m1 = pasToe(vandaag(), s);
  ok('standaard = de mapping van vandaag (deepEqual op alle regels, met Clay\'s verschil)', deepEqual(regelsVan(m1), regelsVan(m0)) && m1.rules.size === m0.rules.size);
  ok('… en het verschil dat bewaard wordt is hetzelfde', deepEqual(m1.verschil().rules, m0.verschil().rules));

  const a = norm(voorbeeld('apc-alleen')).werkruimte;
  const sa = M.samenstellen(standaarden, stukken, a);
  const fr = sa.apparaten.apc40mk2.fragmenten;
  ok('apc-alleen: vier fragmenten (stuk:basis, stuk:uitlijn, stuk:fx-matrix, stuk:mix-extra), geen werk:-fragment', fr.map((f) => f.bron).join() === 'stuk:basis,stuk:uitlijn,stuk:fx-matrix,stuk:mix-extra');
  ok('apc-alleen: 0 botsingen, 0 fouten', sa.botsingen.length === 0 && sa.fouten.length === 0);
  ok('apc-alleen: twee nieuwe mapjes (device.uitlijn met ⇧ Lock, grid.fx met ⇧ On/Off)', sa.apparaten.apc40mk2.mapjes.map((x) => `${x.groep}.${x.laag}:${x.kiesknop}`).join() === 'device.uitlijn:uitlijn,grid.fx:fx');
  const m2 = pasToe(vandaag(), sa);
  const verwacht = new Map(regelsVan(m0));
  let erbij = 0;
  for (const f of fr) for (const r of f.doc.rules) { verwacht.set(sleutelVan(r), { in: r.in, action: r.action, mode: r.mode, shift: !!r.shift, laag: r.laag ?? null }); erbij++; }
  // De regels van de stukken, plus een kiesknop-regel voor elk nieuw mapje dat hem zelf niet noemt (uitlijn wel, de namaak van fx-matrix niet).
  const stukRegels = Object.keys(stukken).reduce((n, k) => n + (stukken[k].regels?.apc40mk2?.length ?? 0), 0);
  const gemaakt = Object.values(stukken).reduce((n, st) => n + Object.entries(st.mapjes?.nieuw ?? {}).filter(([sl, mj]) => mj.kiesknop
    && !(st.regels?.apc40mk2 ?? []).some((r) => r.action === `layer.${sl.split('.').slice(-2).join('.')}`)).length, 0);
  ok(`apc-alleen: precies de regels van de stukken erbij (${erbij} = ${stukRegels} + ${gemaakt} gemaakte kiesknop; een kiesknop die er al staat niet dubbel)`, erbij === stukRegels + gemaakt);
  // De mapping laat druk/latch nog niet toe (dat bouwt S4): wat hij niet kent, staat er dan (nog) niet in.
  const kent = (r) => r.mode !== 'druk' && r.mode !== 'latch';
  const verwachtNu = [...verwacht].filter(([, r]) => kent(r)).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const nu = regelsVan(m2).filter(([, r]) => kent(r));
  ok('apc-alleen op een echte Mapping = standaard + Clay + de stukken (alles wat de mapping vandaag kent)', deepEqual(nu, verwachtNu));
  ok('… en Clay\'s eigen regels winnen nog steeds', Object.entries(VIDEO).every(([sg, ac]) => m2.rules.get(`${sg}@device.rack`)?.action === ac));
  ok('… en het verschil (wat bewaard wordt) verandert niet door de stukken', deepEqual(m2.verschil().rules, m0.verschil().rules));
  ok('… en ⇧ master-knop = werk.thuis (stuk basis)', m2.rules.get('note:0:80#shift')?.action === 'werk.thuis' && m2.rules.get('note:0:80')?.action === 'video.black');
  // Een standaardregel weghalen kan niet: elke standaardsleutel staat er nog.
  ok('geen enkele standaardregel is weg of anders', [...m0.rules].every(([k, r]) => m2.rules.get(k)?.action === r.action));
}
{
  // Een stuk dat een bezette plek pakt: niet erbij, gemeld.
  const stout = { schema: 1, stuk: 'stout', regels: { apc40mk2: [{ in: 'note:0:58', action: 'werk.thuis' }] } };
  const s = M.samenstellen(standaarden, { stout }, norm(met({ stukken: ['stout'] }), { stukken: { stout } }).werkruimte);
  ok('een stuk op een bezette plek: fout en geen regel', s.fouten.some((f) => f.includes('al bezet')) && !(s.apparaten.apc40mk2?.fragmenten.length));
  const dubbel = { schema: 1, stuk: 'dubbel', regels: { apc40mk2: [{ in: 'note:0:80', shift: true, action: 'werk.deel.next' }] } };
  const s2 = M.samenstellen(standaarden, { basis: stukken.basis, dubbel }, norm(met({ stukken: ['basis', 'dubbel'] }), { stukken: { basis: stukken.basis, dubbel } }).werkruimte);
  ok('twee stukken op dezelfde vrije plek: de eerste wint, de tweede is een botsing', s2.botsingen.length === 1 && s2.botsingen[0].sleutel === 'note:0:80#shift' && s2.botsingen[0].met === 'stuk:basis');
}
{
  const t = norm(voorbeeld('twee-handen')).werkruimte;
  const s = M.samenstellen(standaarden, stukken, t);
  const w = s.apparaten.apc40mk2.fragmenten.find((f) => f.bron === 'werk:twee-handen');
  ok('twee-handen: werk:twee-handen = de dub-regel + de gemaakte kiesknop ⇧ Device ◀ = layer.device.mijndub',
    w && w.doc.rules.length === 2 && w.doc.rules.some((r) => r.in === 'note:0:58' && r.shift && r.action === 'layer.device.mijndub'));
  ok('twee-handen: volgorde van grid gaat mee', s.apparaten.apc40mk2.volgorde.grid.join(' ') === 'hotcues loops klank stems fx video');
  ok('twee-handen: 0 botsingen met de standaard', s.botsingen.length === 0);
}

console.log('\nde velden van S4 in een stuk (samenvoegen golf 2)');
{
  // Het model en mapping.js (S4) moeten dezelfde regels aannemen: een stuk dat met ?stukken= werkt,
  // werkt ook in een werkruimte. Gevonden bij het samenvoegen: codering viel weg, lang: true werd
  // geweigerd en twee regels met en zonder `als` op één knop heetten dubbel.
  const st = (regels) => M.normaliseerStuk({ schema: 1, stuk: 'proef-s4', regels: { apc40mk2: regels } }, { standaarden });
  const a = st([{ in: 'cc:9:47', action: 'track.{focus}.beatjump', mode: 'stappen', codering: 'bin' }]);
  ok('stappen: codering "bin" blijft staan', a.fouten.length === 0 && a.stuk.regels.apc40mk2[0].codering === 'bin');
  ok('codering bij een andere modus: fout', st([{ in: 'cc:9:48', action: 'track.1.filter', mode: 'absolute', codering: 'bin' }]).fouten.length === 1);
  const b = st([{ in: 'note:9:90', action: 'track.1.send.a', mode: 'latch', naar: 1, lang: true }]);
  ok('lang: true mag (= 400 ms, zoals in mapping.js)', b.fouten.length === 0 && b.stuk.regels.apc40mk2[0].lang === true);
  const c = st([{ in: 'note:9:91', action: 'track.1.send.a', mode: 'druk', naar: 1, als: 'focus.instrument' },
    { in: 'note:9:91', action: 'track.1.send.b', mode: 'druk', naar: 1 }]);
  ok('één knop met en zonder als: twee regels, niet dubbel', c.fouten.length === 0 && c.stuk.regels.apc40mk2.length === 2);
  const std = standaarden.apc40mk2.rules.find((r) => !r.shift && !r.laag && !M.isKern('apc40mk2', r.in, false));
  const d = st([{ in: std.in, action: 'track.1.send.a', mode: 'trigger', als: 'focus.instrument' }]);
  ok('een regel met als op een plek van de standaard: nog steeds bezet', !std || (d.fouten.length === 1 && /bezet/.test(d.fouten[0])));
  // En de mapping leest de uitkomst zoals hij hem kreeg: dezelfde sleutels.
  const m = new Mapping({ read: () => 0, invoke: () => {} });
  m.load({ device: 'apc40mk2', version: 3, rules: [...a.stuk.regels.apc40mk2, ...b.stuk.regels.apc40mk2, ...c.stuk.regels.apc40mk2] });
  ok('mapping.js neemt ze aan (4 regels, codering en als mee)', m.rules.size === 4 && [...m.rules.values()].some((r) => r.codering === 'bin')
    && [...m.rules.keys()].includes(sleutelVan(c.stuk.regels.apc40mk2[0])));
  // Een houd-mapje (lagen.js, groep houd van S4) in een stuk: kiesknop = layer.houd.<naam>, regels in het mapje.
  const h = M.normaliseerStuk({ schema: 1, stuk: 'proef-houd', mapjes: { nieuw: { 'houd.solo': { naam: 'solo', kiesknop: { in: 'note:9:92' } } } },
    regels: { apc40mk2: [{ in: 'note:9:93', laag: 'houd.solo', action: 'track.1.send.a', mode: 'trigger' }] } }, { standaarden });
  ok('een houd-mapje in een stuk: geen fout, de regel blijft', h.fouten.length === 0 && h.waarschuwingen.length === 0 && h.stuk.regels.apc40mk2?.length === 1);
  const sh = M.samenstellen(standaarden, { 'proef-houd': { schema: 1, stuk: 'proef-houd', mapjes: { nieuw: { 'houd.solo': { naam: 'solo', kiesknop: { in: 'note:9:92' } } } },
    regels: { apc40mk2: [{ in: 'note:9:93', laag: 'houd.solo', action: 'track.1.send.a', mode: 'trigger' }] } } }, { naam: 'x', stukken: ['proef-houd'] });
  const regelsH = sh.apparaten.apc40mk2?.fragmenten.flatMap((f) => f.doc.rules) ?? [];
  ok('… samengesteld: de kiesknop wordt layer.houd.solo', regelsH.some((r) => r.in === 'note:9:92' && r.action === 'layer.houd.solo') && sh.fouten.length === 0);
}

console.log('\nhulpjes');
ok('mapjesVanDeel rekent de conditie uit', (() => {
  const t = norm(voorbeeld('twee-handen')).werkruimte.delen.spelen;
  return M.mapjesVanDeel(t, 'apc40mk2', (c) => c === 'focus.instrument').device === 'inst' && M.mapjesVanDeel(t, 'apc40mk2', () => false).device === 'strip';
})());
ok('leesMapjeSleutel: beide vormen', deepEqual(M.leesMapjeSleutel('apc40mk2.device.uitlijn'), { apparaat: 'apc40mk2', groep: 'device', laag: 'uitlijn' })
  && deepEqual(M.leesMapjeSleutel('grid.fx'), { apparaat: 'apc40mk2', groep: 'grid', laag: 'fx' }));
ok('magOpScherm: mag en nooit, nooit wint, de vaste lijst altijd', (() => {
  const w = norm(voorbeeld('twee-handen')).werkruimte;
  return M.magOpScherm(w, 'ipad', 'track.3.section.2') && M.magOpScherm(w, 'ipad', 'werk.deel.fx') && !M.magOpScherm(w, 'ipad', 'track.1.play')
    && !M.magOpScherm(w, 'ipad', 'record.start') && !M.magOpScherm(w, 'ipad', 'track.3.load.selected') && !M.magOpScherm(w, 'mac-2', 'track.1.filter');
})());
ok('kern: 8 × 8 + 18 controls op de APC, ⇧ op A|B/Lock/master-knop vrij', M.KERN.apc40mk2.length === 64 + 18 && !M.isKern('apc40mk2', 'note:3:66', true) && M.isKern('apc40mk2', 'note:3:66', false)
  && !M.isKern('apc40mk2', 'note:0:63', true) && M.isKern('apc40mk2', 'cc:5:7', true));
ok('kern: elk kernsignaal bestaat op de APC', M.KERN.apc40mk2.every(([s]) => apc.controls.has(s)));

console.log('\nkleuren');
ok('A10: MIX wit, UITLIJN groen, FX violet, STEMS zeegroen, SECTIES hemelsblauw, SPELEN oranje, BEELD geel, LIBRARY grijs',
  deepEqual({ ...DEEL_KLEUR }, { mix: 'wit', uitlijn: 'groen', fx: 'violet', stems: 'zeegroen', secties: 'hemelsblauw', spelen: 'oranje', beeld: 'geel', bladeren: 'grijs' })
  && LABEL_KLEUR.LIBRARY === 'grijs');
ok('elke kleur staat in het palet', Object.values(DEEL_KLEUR).every((k) => M.PALET.includes(k)));
ok('kleurVanDeel: eigen kleur gaat voor, dan naam, dan label', kleurVanDeel('fx', { kleur: 'rood' }) === 'rood' && kleurVanDeel('fx') === 'violet' && kleurVanDeel('eigen', { label: 'STEMS' }) === 'zeegroen');
ok('hexVan: wit = #FFFFFF, zeegroen = #00FF99', hexVan('wit') === '#FFFFFF' && hexVan('zeegroen') === '#00FF99');
ok('tekstOp: donker op wit en geel, licht op blauw', tekstOp('wit') === '#07090b' && tekstOp('geel') === '#07090b' && tekstOp('blauw') === '#f4f7fa');

console.log(fails.length ? `\n${fails.length} FOUT` : '\nalles groen');
process.exit(fails.length ? 1 : 0);
