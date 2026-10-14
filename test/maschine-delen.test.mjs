// Spoor S6 (docs/werkruimte/S6.md, docs/WERKRUIMTE.md D4 "S6"): de Maschine per deel.
// Padmodi en pagina's uit data, het wiel via de mapping, houd-knoppen (houd.js), de adapter
// voor de werkruimte, de deelnamen, de fasescoop en de getallen op het scherm, en de twee
// voorbeeldstukken (mappings/stukken/maschine-delen.json, maschine-houd.json).
// Nep-engine en nep-bus; de echte Maschine, Mapping, HoudRegister en schermcode.
// Hub en Chromium: tools/headless/werk-maschine.mjs.
// Draai met: node test/maschine-delen.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra && !cond ? ` (${extra})` : ''}`); };
const lees = (pad) => JSON.parse(readFileSync(new URL(pad, import.meta.url), 'utf8'));

const { Maschine, maakMaschineAdapter, PAGINAS } = await import('../src/control/maschine.js');
const { HoudRegister } = await import('../src/control/houd.js');
const M = await import('../src/control/devices/maschine-mk2.js');
const S = await import('../src/control/maschine-scherm.js');
const { parseMessage } = await import('../src/control/midi.js');
const { PALETTE } = await import('../src/control/devices/apc40mk2.js');
const W = await import('../src/werk/model.js');
const { beschrijf } = await import('../src/ui/apc-beschrijf.js');

const STANDAARD = lees('../mappings/maschine-mk2.json');
const DELEN = lees('../mappings/stukken/maschine-delen.json');
const HOUD = lees('../mappings/stukken/maschine-houd.json');
const APC = lees('../mappings/apc40mk2.json');

// ---- nep-engine en nep-bus --------------------------------------------------------------
const DECKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const eng = {
  focus: 'A', decks: Object.fromEntries(DECKS.map((d) => [d, { buffer: null }])),
  speeltrack: () => null, instrumentOp: () => null, deck(id) { return this.decks[id]; },
};
const bus = [];
const stand = {};
const invoke = (id, v) => { bus.push([id, v]); if (/^track\.\d\.focus$/.test(id) && v) eng.focus = DECKS[+id.split('.')[1] - 1]; else stand[id] = v; return true; };
const read = (id) => (id in stand ? stand[id] : null);
let nu = 1000;

/** Een Maschine met de standaard, en (optioneel) de stukken zoals de werkruimte ze zet (fragmenten). */
function maak({ stukken = [], houd = new HoudRegister() } = {}) {
  const m = new Maschine({ engine: eng, noten: { ontvang: () => { bus.push(['NOOT']); return true; }, los() {}, ingedrukt: () => new Set() },
    read, invoke, nu: () => nu, beschrijf, houd });
  m.laadMapping(STANDAARD);
  const s = W.samenstellen({ 'maschine-mk2': STANDAARD }, Object.fromEntries(stukken.map((x) => [x.stuk, x])), { naam: 'proef', stukken: stukken.map((x) => x.stuk) });
  for (const f of s.apparaten['maschine-mk2']?.fragmenten ?? []) m.mapping.vervangFragment(f.bron, f.doc);
  return { m, houd, s };
}
const noot = (kanaal, nr, aan = true, v = 100) => parseMessage([(aan ? 0x90 : 0x80) | kanaal, nr, aan ? v : 0]);
const knop = (naam, aan = true) => noot(M.KNOP_KANAAL, M.knopNoot(naam), aan, 127);
const pad = (p, aan = true) => noot(M.PAD_KANAAL, M.padNoot(p), aan);
const draai = (k, d) => parseMessage([0xb0, M.ENCODER_CC + k - 1, d < 0 ? 128 + d : d]);
const wiel = (d) => parseMessage([0xb0, M.WIEL_CC, d < 0 ? 128 + d : d]);
const busNa = (fn) => { bus.length = 0; fn(); return bus.map(([id, v]) => `${id}=${v}`); };

console.log('de voorbeeldstukken: geldig, op vrije plekken (B1: de standaard blijft bit voor bit)');
{
  const std = { apc40mk2: APC, 'maschine-mk2': STANDAARD };
  for (const doc of [DELEN, HOUD]) {
    const n = W.normaliseerStuk(doc, { standaarden: std });
    ok(`${doc.stuk}: geen fouten of waarschuwingen`, n.fouten.length === 0 && n.waarschuwingen.length === 0, [...n.fouten, ...n.waarschuwingen].join('; '));
    ok(`${doc.stuk}: als VOORBEELD gemarkeerd`, /VOORBEELD/.test(doc.titel) && /VOORBEELD/.test(doc.uitleg));
  }
  const s = W.samenstellen(std, { 'maschine-delen': DELEN, 'maschine-houd': HOUD }, { naam: 'x', stukken: ['maschine-delen', 'maschine-houd'] });
  ok('samengesteld: 0 botsingen met maschine-mk2.json en apc40mk2.json, 0 fouten', s.botsingen.length === 0 && s.fouten.length === 0, JSON.stringify(s.botsingen));
  const tw = lees('../tools/werkruimtes/voorbeelden/twee-handen.json');
  ok('twee-handen noemt beide stukken', tw.stukken.includes('maschine-delen') && tw.stukken.includes('maschine-houd'));
  const regels = s.apparaten['maschine-mk2'].fragmenten.flatMap((f) => f.doc.rules);
  ok('F1–F8 = werk.deel.1–8, SHIFT + F1 = werk.thuis', [1, 2, 3, 4, 5, 6, 7, 8].every((i) => regels.some((r) => r.in === `note:1:${i - 1}` && !r.shift && r.action === `werk.deel.${i}`))
    && regels.some((r) => r.in === 'note:1:0' && r.shift && r.action === 'werk.thuis'));
  ok('de kiesknoppen VOLUME en SOLO = layer.houd.volume en layer.houd.solo', regels.some((r) => r.in === 'note:1:16' && r.action === 'layer.houd.volume')
    && regels.some((r) => r.in === 'note:1:46' && r.action === 'layer.houd.solo'));
  ok('elke regel van de stukken heeft een uitleg (beschrijf)', regels.every((r) => {
    const b = beschrijf(r.action.replace('{focus}', '1'));
    return b && b.lang && !b.lang.startsWith('?');
  }), regels.filter((r) => beschrijf(r.action.replace('{focus}', '1'))?.lang?.startsWith('?')).map((r) => r.action).join(', '));
}

console.log('\nzonder stukken: alles zoals het was');
{
  const { m } = maak();
  ok('pagina\'s = Instrument, Strip, Rack', JSON.stringify(m.paginas()) === JSON.stringify(PAGINAS));
  ok('geen padmodi uit data', m.padmodi().length === 0);
  ok('de open mapjes: pagina.instrument (zoals vroeger)', JSON.stringify(m.mapping.lagen()) === JSON.stringify(['pagina.instrument']));
  m.zetModus('sampler');
  ok('… en in de sampler: sampler, pagina.instrument', JSON.stringify(m.mapping.lagen()) === JSON.stringify(['sampler', 'pagina.instrument']));
  m.zetModus('worpen');
  ok('een padmodus die er niet is: spelen', m.modus === 'spelen');
  ok('geen lampjes voor F1–F8, VOLUME, SOLO, MUTE', ['f1', 'f8', 'volume', 'solo', 'mute'].every((n) => !m.ledBeeld().has(`1:${M.knopNoot(n)}`)));
  ok('het wiel kiest een instrument (geen regel op cc:0:24)', busNa(() => m.ontvang(wiel(1))).length === 0 && m.kandidaat !== null);
  m.kandidaat = null;
  ok('stand() zonder delen, scherm of uitlijn (dezelfde sleutel als vroeger)', !('delen' in m.stand()) && !('scherm' in m.stand()) && !('uitlijn' in m.stand()));
}

console.log('\npadmodus uit data: worpen');
{
  const { m } = maak({ stukken: [DELEN] });
  ok('padmodi: worpen', JSON.stringify(m.padmodi()) === '["worpen"]');
  m.zetModus('worpen');
  ok('zetModus(worpen) en de laag pads.worpen staat open', m.modus === 'worpen' && m.mapping.lagen().includes('pads.worpen'));
  const aan = busNa(() => { m.ontvang(pad(1)); m.ontvang(pad(2)); });
  ok('twee pads tegelijk = twee worpen', JSON.stringify(aan) === JSON.stringify(['track.1.fx.knob.1.hold=true', 'track.1.fx.knob.2.hold=true']), aan.join(' '));
  ok('geen noot (de pads spelen niet)', !aan.includes('NOOT=undefined'));
  // Deelwissel terwijl de pads vastzitten: loslaten gaat naar waar het indrukken heen ging.
  m.zetModus('spelen');
  const los = busNa(() => { m.ontvang(pad(1, false)); m.ontvang(pad(2, false)); });
  ok('na een wissel naar spelen: loslaten naar de worp (padVast)', JSON.stringify(los) === JSON.stringify(['track.1.fx.knob.1.hold=false', 'track.1.fx.knob.2.hold=false']), los.join(' '));
  m.zetModus('worpen');
  m.ontvang(knop('shift'));
  stand['track.1.fx.knob.3'] = 0.2;
  const latch = busNa(() => { m.ontvang(pad(3)); m.ontvang(pad(3, false)); });
  m.ontvang(knop('shift', false));
  ok('SHIFT + pad = vastzetten (latch naar 1)', latch[0] === 'track.1.fx.knob.3=1' && latch.length === 1, latch.join(' '));
  ok('pad 9 (geen regel) doet niets', busNa(() => { m.ontvang(pad(9)); m.ontvang(pad(9, false)); }).length === 0);
  stand['track.1.fx.knob.1.hold'] = 1;
  m.kleur = 'violet';
  ok('lampje: de read van de regel in de kleur van het deel', m.ledBeeld().get(`0:${M.padNoot(1)}`) === PALETTE.violet && m.ledBeeld().get(`0:${M.padNoot(9)}`) === PALETTE.uit);
  delete stand['track.1.fx.knob.1.hold'];
  ok('CONTROL + pad: de uitleg van de regel', /worp|plek 1/.test(m.legUit(pad(1)).tekst), m.legUit(pad(1)).tekst);
  ok('wordt hij weggehaald (andere werkruimte), dan weer spelen', (m.mapping.haalWeg('stuk:maschine-delen'), m._controleer(), m.modus === 'spelen'));
}

console.log('\npagina uit data: uitlijn');
{
  const { m } = maak({ stukken: [DELEN] });
  ok('pagina\'s: Instrument, Strip, Rack, Uitlijn', JSON.stringify(m.paginas()) === JSON.stringify([...PAGINAS, 'uitlijn']));
  m.zetPagina('rack');
  m.ontvang(knop('browseR'));
  ok('◄ ► links boven komt er vanzelf langs', m.pagina === 'uitlijn');
  stand['track.1.phase.offset'] = 0.5;
  const d = busNa(() => m.ontvang(draai(1, 5)));
  ok('draaiknop 1 = phase.offset van de focus-track (relatief)', d.length === 1 && d[0].startsWith('track.1.phase.offset=0.505'), d.join(' '));
  const st = m.stand();
  ok('scherm: label en waarde van de regel', st.knoppen[0].label === 'fase' && st.knoppen[0].tekst === '51%' && st.paginaNaam === 'Uitlijn' && st.paginas === 4);
  ok('scherm: een plek zonder regel (7) heeft geen label', st.knoppen[6].label === null);
  ok('het lampje ► is uit op de laatste pagina', m.ledBeeld().get(`1:${M.knopNoot('browseR')}`) === 0);
}

console.log('\nhet wiel via de mapping');
{
  const { m } = maak({ stukken: [DELEN] });
  m.wiel = 'jog';
  ok('wiel-mapje jog: een klik = track.1.jog.fwd', JSON.stringify(busNa(() => m.ontvang(wiel(1)))) === JSON.stringify(['track.1.jog.fwd=true', 'track.1.jog.fwd=false']));
  ok('… terug = jog.back', busNa(() => m.ontvang(wiel(-1)))[0] === 'track.1.jog.back=true');
  m.ontvang(knop('shift'));
  ok('… SHIFT = jog fijn', busNa(() => m.ontvang(wiel(1)))[0] === 'track.1.jog.fine.fwd=true');
  m.ontvang(knop('shift', false));
  stand['library.toggle'] = 1;
  ok('library open: het wiel bladert (laag bladeren gaat voor)', JSON.stringify(busNa(() => m.ontvang(wiel(2)))) === JSON.stringify(['library.next=true', 'library.next=true']));
  stand['library.toggle'] = 0;
  m.wiel = null;
  ok('zonder wiel-mapje: weer het instrument kiezen', busNa(() => m.ontvang(wiel(1))).length === 0 && m.kandidaat !== null);
  m.kandidaat = null;
}

console.log('\nhoud-knoppen (houd.js, gedeeld met de APC)');
{
  const houd = new HoudRegister();
  const { m } = maak({ stukken: [DELEN, HOUD], houd });
  m.zetPagina('strip');
  ok('VOLUME indrukken = houd.volume open, van de Maschine', (m.ontvang(knop('volume')), houd.isOpen('volume') && houd.eigenaar('volume') === 'maschine-mk2'));
  stand['track.3.fader'] = 0.5;
  const d = busNa(() => m.ontvang(draai(3, 10)));
  ok('VOLUME vast + draaiknop 3 = track.3.fader', d.length === 1 && d[0].startsWith('track.3.fader=0.51'), d.join(' '));
  ok('lampje VOLUME vol zolang hij vastzit', m.ledBeeld().get(`1:${M.knopNoot('volume')}`) === 127);
  m.ontvang(knop('volume', false));
  ok('loslaten = dicht; draaiknop 3 weer de strip (mid)', !houd.isOpen('volume') && busNa(() => m.ontvang(draai(3, 1)))[0]?.startsWith('track.1.mid='));
  ok('lampje VOLUME zacht als hij los is', m.ledBeeld().get(`1:${M.knopNoot('volume')}`) === 8);
  // SOLO + pad: wint van de padmodus (hier spelen: geen noot)
  m.ontvang(knop('solo'));
  const s = busNa(() => m.ontvang(pad(2)));
  ok('SOLO vast + pad 2 = drums solo (geen noot)', JSON.stringify(s) === '["track.1.stem.drums.solo=true"]', s.join(' '));
  m.ontvang(knop('solo', false));
  ok('SOLO eerst los, dan de pad: loslaten gaat toch naar de solo', JSON.stringify(busNa(() => m.ontvang(pad(2, false)))) === '["track.1.stem.drums.solo=false"]');
  ok('zonder SOLO speelt pad 2 weer een noot', busNa(() => { m.ontvang(pad(2)); m.ontvang(pad(2, false)); }).every((x) => x.startsWith('NOOT')));
  // Een ander apparaat (de APC) houdt hetzelfde mapje vast: een loslaten van de Maschine zonder indrukken sluit het niet.
  houd.druk('apc40mk2', 'solo', true);
  m.ontvang(knop('solo', false));
  ok('een houd-mapje van de APC: een los van de Maschine sluit het niet', houd.isOpen('solo') && houd.eigenaar('solo') === 'apc40mk2');
  houd.druk('apc40mk2', 'solo', false);
  ok('MUTE = track.{focus}.fx.bypass', busNa(() => m.ontvang(knop('mute')))[0] === 'track.1.fx.bypass=true');
  m.ontvang(knop('mute', false));
  m.ontvang(knop('volume'));
  ok('poort weg met VOLUME vast: houd.volume dicht', (m.poort = { in: { state: 'disconnected' } }, m._staat(), !houd.isOpen('volume')));
  m.poort = null;
}

console.log('\nde adapter voor de werkruimte');
{
  const houd = new HoudRegister();
  const { m } = maak({ stukken: [DELEN, HOUD], houd });
  const a = maakMaschineAdapter(m);
  bus.length = 0;
  const r = a.zetMapjes({ pads: 'worpen', pagina: 'uitlijn', wiel: 'jog', scherm: ['fasescoop', 'getallen'] });
  ok('zetMapjes: alles gezet', r.niet.length === 0 && m.modus === 'worpen' && m.pagina === 'uitlijn' && m.wiel === 'jog' && m.scherm.join() === 'fasescoop,getallen', JSON.stringify(r));
  ok('een deelwissel zet geen klank (0 invokes)', bus.length === 0);
  ok('mapjes() zegt wat er open staat', JSON.stringify(a.mapjes()) === JSON.stringify({ pads: 'worpen', pagina: 'uitlijn', wiel: 'jog', scherm: ['fasescoop', 'getallen'] }));
  const n = a.zetMapjes({ pads: 'transport', pagina: 'super', wiel: 'mengvorm' });
  ok('wat er niet is (transport, super, mengvorm) staat in niet, en verandert niets', n.niet.length === 3 && m.modus === 'worpen' && m.pagina === 'uitlijn' && m.wiel === 'jog');
  ok('secties = SCENE, sampler = SAMPLING', ['secties', 'sampler'].every((p) => a.zetMapjes({ pads: p }).niet.length === 0 && m.modus === p));
  a.zetMapjes({ pads: 'stap' });
  ok('… stap -> modus stappen, mapjes() zegt weer stap', m.modus === 'stappen' && a.mapjes().pads === 'stap');
  a.zetMapjes({ wiel: 'bladeren' });
  ok('wiel bladeren = het oude wiel (bladert vanzelf met de library open)', m.wiel === null);
  m.ontvang(knop('volume'));
  a.standaard();
  ok('standaard (THUIS): spelen, Instrument, het oude wiel, geen scherm, houd los', m.modus === 'spelen' && m.pagina === 'instrument' && m.wiel === null && m.scherm === null && !houd.isOpen('volume'));
  m.ontvang(knop('volume', false));
  ok('aanwezig: volgt de nep-poort', !a.aanwezig() && (m.poort = { in: { state: 'connected' } }, a.aanwezig()));
  m.poort = null;
  ok('naam en mapping', a.naam === 'Maschine' && a.mapping === m.mapping);
  let poort = [];
  m.on('poort', (v) => poort.push(v));
  m.poort = { in: { state: 'connected' } }; m._staat();
  m.poort.in.state = 'disconnected'; m._staat(); m._staat();
  ok("'poort' alleen bij een echte wissel", JSON.stringify(poort) === '[true,false]', JSON.stringify(poort));
  m.poort = null;
}

console.log('\nF1–F8, SHIFT + F1 en de lampjes');
{
  const { m } = maak({ stukken: [DELEN] });
  ok('F3 = werk.deel.3', busNa(() => { m.ontvang(knop('f3')); m.ontvang(knop('f3', false)); })[0] === 'werk.deel.3=true');
  m.ontvang(knop('shift'));
  ok('SHIFT + F1 = werk.thuis', busNa(() => { m.ontvang(knop('f1')); m.ontvang(knop('f1', false)); })[0] === 'werk.thuis=true');
  m.ontvang(knop('shift', false));
  stand['werk.deel.3'] = 1; stand['werk.deel.1'] = 0; stand['werk.deel.2'] = 0;
  const l = m.ledBeeld();
  ok('lampje F3 vol (het deel van nu), F1 zacht, F8 uit (geen deel)', l.get(`1:${M.knopNoot('f3')}`) === 127 && l.get(`1:${M.knopNoot('f1')}`) === 8 && l.get(`1:${M.knopNoot('f8')}`) === 0);
}

console.log('\nSCENE: SHIFT + pad = als loop, alleen in een werkruimte');
{
  const { m } = maak();
  eng.decks.A = { buffer: {}, sectieKaart: { aantal: 6, naam: (i) => `s${i}` }, sectieHier: 0, sectieOpDeMaat: 0 };
  m.zetModus('secties');
  m.ontvang(knop('shift'));
  ok('zonder werkruimte: SHIFT + pad = de sectie (zoals altijd)', busNa(() => { m.ontvang(pad(2)); m.ontvang(pad(2, false)); })[0] === 'track.1.section.2=true');
  m.delen = { labels: ['MIX'], actief: 0 };
  ok('in een werkruimte: SHIFT + pad = track.1.section.2.loop', busNa(() => { m.ontvang(pad(2)); m.ontvang(pad(2, false)); })[0] === 'track.1.section.2.loop=true');
  m.ontvang(knop('shift', false));
  ok('… zonder SHIFT de sectie', busNa(() => { m.ontvang(pad(2)); m.ontvang(pad(2, false)); })[0] === 'track.1.section.2=true');
  eng.decks.A = { buffer: null };
}

console.log('\nde schermen: deelnamen, fasescoop, getallen');
{
  const labels = ['MIX', 'UITLIJN', 'FX', 'STEMS', 'SECTIES', 'SPELEN', 'BEELD', 'LIBRARY'];
  const links = S.tekenDeelLabels(labels, 2, { nr: 0 });
  const rechts = S.tekenDeelLabels(labels, 2, { nr: 1 });
  ok('2048 bytes per scherm', links.length === 2048 && rechts.length === 2048);
  const vol = (buf, x0) => { let n = 0; for (let y = 0; y < 8; y++) for (let x = x0; x < x0 + 63; x++) n += S.leesPixel(buf, x, y) ? 1 : 0; return n; };
  ok('het actieve deel (FX, derde vak links) omgekeerd: bijna vol', vol(links, 128) > 63 * 8 * 0.7, vol(links, 128));
  ok('de andere vakken: alleen letters', vol(links, 0) > 0 && vol(links, 0) < 63 * 8 * 0.3 && vol(links, 64) < 63 * 8 * 0.3);
  ok('rechts: deel 5–8, geen omgekeerd vak', [0, 64, 128, 192].every((x) => vol(rechts, x) > 0 && vol(rechts, x) < 63 * 8 * 0.3));
  // fasescoop: een stip in het midden voor 0 ms, rechts voor +10 ms (4 px/ms)
  const sc = S.tekenFasescoop({ punten: [{ ms: 0, k: 0, wie: 'eigen' }, { ms: 10, k: 5, wie: 'eigen' }, { ms: 0, k: 0, wie: 'maatgever' }] });
  ok('fasescoop: 0 ms = midden (x 128), nieuwste bovenaan', S.leesPixel(sc, 127, 1) && S.leesPixel(sc, 128, 1) && S.leesPixel(sc, 129, 1));
  ok('fasescoop: +10 ms = 40 px rechts, rij 6', S.leesPixel(sc, 168, 6) && !S.leesPixel(sc, 88, 6));
  ok('fasescoop: de maatgever als streepje onderin', S.leesPixel(sc, 128, 61) && S.leesPixel(sc, 128, 62));
  const buiten = S.tekenFasescoop({ punten: [{ ms: 80, k: 2, wie: 'eigen' }] });
  ok('fasescoop: buiten ±32 ms op de rand', S.leesPixel(buiten, 254, 3));
  const g = S.tekenGetallen({ grid: 0.5, muziek: 9.75, drift: -0.75, maat: 1, bpm: 124 });
  ok('getallen: vier regels tekst', [0, 8, 16, 24].every((y) => { for (let x = 0; x < 120; x++) for (let r = y; r < y + 7; r++) if (S.leesPixel(g, x, r)) return true; return false; }));
  // De hele stand: met delen schuift het scherm 9 px en staan de labels erboven.
  const st = { speel: null, focus: { nr: 1, wat: 'leeg' }, knoppen: [], modus: 'spelen', pagina: 'instrument' };
  const zonder = S.tekenScherm(st, 0);
  const met = S.tekenScherm({ ...st, delen: { labels, actief: 0 } }, 0);
  let gelijk = true;
  for (let y = 0; y < 64 - 9; y++) for (let x = 0; x < 256; x++) if (S.leesPixel(zonder, x, y) !== S.leesPixel(met, x, y + 9)) gelijk = false;
  ok('met delen: hetzelfde scherm 9 px lager', gelijk);
  ok('met delen: het eerste vak omgekeerd', vol(met, 0) > 63 * 8 * 0.7);
  const { m } = maak({ stukken: [DELEN] });
  m.scherm = ['fasescoop', 'getallen'];
  m.uitlijn = () => ({ vouw: { bron: 'tellen', punten: [{ ms: 1.13, k: 0, tel: 1, wie: 'eigen' }] }, getallen: { bpm: 124.001, grid: 1.13, muziek: { ms: 2 }, drift: 0.1, maat: 0, maatgever: false } });
  const s = m.stand();
  ok('stand: uitlijn afgerond op 0,25 ms (de sleutel van het scherm blijft rustig)', s.uitlijn.vouw.punten[0].ms === 1.25 && s.uitlijn.getallen.grid === 1.25 && s.uitlijn.getallen.muziek === 2);
  ok('scherm 0 = fasescoop (stip rechts van het midden), scherm 1 = getallen', S.leesPixel(S.tekenScherm(s, 0), 133, 12));
  m.uitlijn = () => { throw new Error('kapot'); };
  ok('een kapotte uitlijn-functie legt het scherm niet stil', m.stand().uitlijn.vouw === null);
}

console.log('\nreview ronde 1');
{
  const { m } = maak({ stukken: [DELEN] });
  const a = maakMaschineAdapter(m);
  a.zetMapjes({ pads: 'worpen', pagina: 'uitlijn', wiel: 'jog' });
  m.mapping.haalWeg('stuk:maschine-delen');
  ok('mapjes() na een weggehaald stuk: spelen, Instrument, het oude wiel', JSON.stringify(a.mapjes()) === JSON.stringify({ pads: 'spelen', pagina: 'instrument', wiel: 'instrument', scherm: null }));
  m.mapping.vervangFragment('stuk:x', { device: 'maschine-mk2', version: 3, rules: [{ in: 'note:1:22', action: 'layer.pads.stap', mode: 'trigger' }] });
  ok('een kiesknop layer.pads.stap = STEP (geen dode padmodus "stap")', m.padmodi().length === 0 && (m.ontvang(knop('noteRepeat')), m.modus === 'stappen'));
  ok('… zijn lampje leest de stand', m.mapping.read('layer.pads.stap') === 1 && m.mapping.read('layer.pads.secties') === 0);
  m.ontvang(knop('noteRepeat', false));
  const st = { speel: null, focus: { nr: 1, wat: 'leeg' }, knoppen: [], modus: 'spelen', pagina: 'instrument', delen: { labels: ['MIX', 'FX'], actief: 0 } };
  const zonder = S.tekenScherm(st, 1), met = S.tekenScherm({ ...st, melding: 'T1 speelt: druk nog eens' }, 1);
  let rij = 0; for (let x = 0; x < 256; x++) rij += S.leesPixel(met, x, 0) ? 1 : 0;
  ok('in een werkruimte: een melding staat bovenaan (omgekeerd) in plaats van de deelnamen', rij > 200 && !zonder.every((b, i) => b === met[i]));
  m.scherm = ['fasescoop'];
  let gevraagd = null;
  m.uitlijn = (id, wat) => { gevraagd = wat; return { vouw: { punten: [] }, getallen: { bpm: 124, grid: 3 } }; };
  const s1 = m.stand();
  ok('alleen een fasescoop: geen getallen in de stand (behalve bpm), de vraag zegt het', gevraagd.vouw && !gevraagd.getallen && s1.uitlijn.getallen.grid === undefined && s1.uitlijn.getallen.bpm === 124);
}

console.log(fails.length ? `\n${fails.length} FOUT:\n  ${fails.join('\n  ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
