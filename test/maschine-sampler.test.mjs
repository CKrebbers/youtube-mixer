// De padmodus sampler op de Maschine (docs/MASCHINE.md §5f): SAMPLING zet de pads in de
// stand sampler: boven de acht sampler-pads, onder een sectie in pad 1–8, SHIFT + pad =
// leegmaken; ◄ ► (transport) = minder/meer tellen, draaiknop 5 = sampler-volume. Nep-engine,
// nep-sampler en een nep-bus; de echte Maschine en de echte indeling. In Chromium met een
// echte sampler: tools/headless/maschine-sampler.mjs.
// Draai met: node test/maschine-sampler.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const { parseMessage } = await import('../src/control/midi.js');
const { Maschine, HELDER, samplerPad, samplerActie } = await import('../src/control/maschine.js');
const D = await import('../src/control/devices/maschine-mk2.js');
const S = await import('../src/control/maschine-scherm.js');
const { PALETTE } = await import('../src/control/devices/apc40mk2.js');
const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
const { DRUMPAD_VAN_SAMPLER } = await import('../src/control/actions.js');
const doc = JSON.parse(readFileSync(new URL('../mappings/maschine-mk2.json', import.meta.url), 'utf8'));

console.log('de pads zoals je ernaar kijkt');
{
  const kaart = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((p) => samplerPad(p));
  ok('bovenste rij (pad 13–16) = sampler-pad 1–4', [13, 14, 15, 16].map(samplerPad).every((x, i) => x.k === i + 1 && x.soort === 'sample'));
  ok('tweede rij (pad 9–12) = sampler-pad 5–8', [9, 10, 11, 12].map(samplerPad).every((x, i) => x.k === i + 5 && x.soort === 'sample'));
  ok('derde rij (pad 5–8) = sectie → pad 1–4', [5, 6, 7, 8].map(samplerPad).every((x, i) => x.k === i + 1 && x.soort === 'sectie'));
  ok('onderste rij (pad 1–4) = sectie → pad 5–8', [1, 2, 3, 4].map(samplerPad).every((x, i) => x.k === i + 5 && x.soort === 'sectie'));
  ok('elke sampler-pad komt precies twee keer voor (sample en sectie)', [1, 2, 3, 4, 5, 6, 7, 8].every((k) => kaart.filter((x) => x.k === k).length === 2));
  ok('de action: sample = sampler.K, sectie = sampler.K.section, met SHIFT allebei sampler.K.clear',
    samplerActie(13, false) === 'sampler.1' && samplerActie(1, false) === 'sampler.5.section' && samplerActie(13, true) === 'sampler.1.clear' && samplerActie(1, true) === 'sampler.5.clear');
  // Crossover (W1): sampler.K.drums legt het stuk op dezelfde fysieke pad waarop je het in
  // SAMPLING knipt; in de speelmodus slaat die pad dan het stuk aan.
  ok('sampler.K.drums: dezelfde fysieke pad (voor elke pad 9–16: samplerPad = sample K en DRUMPAD_VAN_SAMPLER[K − 1] = die pad)',
    [9, 10, 11, 12, 13, 14, 15, 16].every((p) => { const x = samplerPad(p); return x.soort === 'sample' && DRUMPAD_VAN_SAMPLER[x.k - 1] === p; }));
}

// ---- een Maschine met een nep-sampler -----------------------------------------------
let pads = Array.from({ length: 8 }, (_, i) => ({ pad: i + 1, gevuld: false, speelt: false, bezig: false, bron: null, tellen: null, bewaard: false }));
pads[0] = { ...pads[0], gevuld: true, speelt: true, bron: 1, tellen: 4 };
pads[1] = { ...pads[1], gevuld: true, bron: 2, tellen: 8 };
pads[2] = { ...pads[2], bewaard: true, bewaardBron: 3, bewaardTellen: 2 };
pads[3] = { ...pads[3], bezig: true };
const sampler = { stand: () => pads, tellen: 4, volume: 0.8 };
const deckA = { buffer: {}, sectieKaart: { aantal: 3, naam: (i) => ['intro', 'opbouw A', 'drop A'][i] }, sectieHier: 1, fx: null };
const engine = { focus: 'A', speeltrack: () => null, instrumentOp: () => null, deck: (id) => (id === 'A' ? deckA : null), sampler };
const lees = {
  'sampler.volume': () => sampler.volume,
  'sampler.length.down': () => 0.5, 'sampler.length.up': () => 0.5,
};
const read = (a) => {
  if (lees[a]) return lees[a]();
  let m = /^sampler\.(\d)\.section$/.exec(a);
  if (m) return Number(m[1]) <= 4 && !pads[Number(m[1]) - 1].gevuld ? 0.5 : null;
  m = /^sampler\.(\d)\.clear$/.exec(a);
  if (m) { const p = pads[Number(m[1]) - 1]; return p.gevuld || p.bewaard ? 0.5 : 0; }
  return null;
};
const gestuurd = [];
const noten = { ontvang: () => { gestuurd.push(['noot']); return true; }, los: () => {}, ingedrukt: () => new Set() };
const m = new Maschine({ engine, noten, read, invoke: (a, v) => gestuurd.push([a, v]), beschrijf });
m.laadMapping(doc);
const knop = (naam, aan = true) => m.ontvang(parseMessage([aan ? 0x91 : 0x81, D.knopNoot(naam), aan ? 127 : 0]));
const druk = (naam) => { knop(naam); knop(naam, false); };
const pad = (p, aan = true) => m.ontvang(parseMessage([aan ? 0x90 : 0x80, D.PAD_NOOT + p - 1, aan ? 100 : 0]));
const draai = (k, n) => m.ontvang(parseMessage([0xb0, D.ENCODER_CC + k - 1, n < 0 ? 128 + n : n]));
const led = (naam) => m.ledBeeld().get(`${D.KNOP_KANAAL}:${D.knopNoot(naam)}`);
const padLed = (p) => m.ledBeeld().get(`${D.PAD_KANAAL}:${D.PAD_NOOT + p - 1}`);

console.log('\nSAMPLING en de pads');
{
  ok('SAMPLING-lampje zacht (de engine heeft een sampler)', led('sampling') === HELDER.beschikbaar);
  druk('sampling');
  ok('SAMPLING: de padmodus sampler, lampje fel', m.modus === 'sampler' && led('sampling') === HELDER.aan);
  gestuurd.length = 0;
  pad(13); pad(13, false);
  ok('pad 13 (boven links): sampler.1 indrukken en loslaten', JSON.stringify(gestuurd) === JSON.stringify([['sampler.1', true], ['sampler.1', false]]));
  gestuurd.length = 0;
  pad(9); pad(9, false); pad(5); pad(5, false); pad(1); pad(1, false);
  ok('pad 9 = sampler.5, pad 5 = sampler.1.section, pad 1 = sampler.5.section',
    gestuurd.filter(([, v]) => v).map(([a]) => a).join() === 'sampler.5,sampler.1.section,sampler.5.section');
  gestuurd.length = 0;
  knop('shift'); pad(14); pad(14, false); pad(6); pad(6, false); knop('shift', false);
  ok('SHIFT + pad: leegmaken (sampler.2.clear), ook op een sectie-pad', gestuurd.filter(([, v]) => v).map(([a]) => a).join() === 'sampler.2.clear,sampler.2.clear');
  gestuurd.length = 0;
  pad(16); knop('shift'); pad(16, false); knop('shift', false);
  ok('indrukken zonder SHIFT, loslaten met: het loslaten gaat naar dezelfde action', JSON.stringify(gestuurd.filter(([a]) => a !== 'noot')) === JSON.stringify([['sampler.4', true], ['sampler.4', false]]));
}

console.log('\n◄ ► (transport) en draaiknop 5');
{
  gestuurd.length = 0;
  druk('stapL'); druk('stapR');
  ok('◄ ► = sampler.length.down / up (via de laag sampler)', gestuurd.filter(([, v]) => v).map(([a]) => a).join() === 'sampler.length.down,sampler.length.up');
  ok('lampjes ◄ ►: half zolang het die kant op kan', led('stapL') === HELDER.half && led('stapR') === HELDER.half);
  gestuurd.length = 0;
  draai(5, 10);
  const vol = gestuurd.find(([a]) => a === 'sampler.volume');
  ok(`draaiknop 5 = sampler.volume, relatief vanaf de stand (${vol?.[1]})`, !!vol && Math.abs(vol[1] - 0.81) < 1e-9);
  gestuurd.length = 0;
  draai(1, 10);
  ok('draaiknop 1 blijft van de pagina (hier: het instrument, er is er geen: niets naar de sampler)', !gestuurd.some(([a]) => /^sampler/.test(a ?? '')));
  const st = m.stand();
  ok('het scherm: knop 5 heet volume, 80%', st.knoppen[4]?.label === 'volume' && st.knoppen[4].tekst === '80%' && st.knoppen[4].vast);
}

console.log('\nlampjes, scherm en uitleg');
{
  ok('sample-pads violet zoals op de APC: speelt = fel, gevuld = donker, bewaard = grijs, knipt = wit, leeg = donkergrijs',
    padLed(13) === PALETTE.violet && padLed(14) === PALETTE.violetdonker && padLed(15) === PALETTE.grijs && padLed(16) === PALETTE.wit && padLed(9) === PALETTE.donkergrijs);
  ok('sectie-pads: blauw waar het kan (pad 3, 4: leeg), uit waar niet (pad 1: bezet; 5–8: geen)',
    padLed(7) === PALETTE.hemelsblauwdonker && padLed(8) === PALETTE.hemelsblauwdonker && padLed(5) === PALETTE.uit && padLed(1) === PALETTE.uit);
  knop('shift');
  ok('met SHIFT: rood waar iets te wissen valt (gevuld of bewaard), anders uit', padLed(13) === PALETTE.rooddonker && padLed(15) === PALETTE.rooddonker && padLed(9) === PALETTE.uit);
  knop('shift', false);
  const st = m.stand();
  ok('stand.sampler: de 8 pads, 4 tellen, 80%, de sectie die je hoort ("2 opbouw A")',
    st.sampler?.pads.length === 8 && st.sampler.tellen === 4 && st.sampler.volume === 0.8 && st.sampler.sectie === '2 opbouw A');
  const links = S.tekenScherm(st, 0), normaal = S.tekenScherm({ ...st, modus: 'spelen', sampler: null }, 0);
  ok('links: de kop SAMPLER (een volle balk) en de pads, anders dan in spelen', S.leesPixel(links, 128, 9) && !links.every((x, i) => x === normaal[i]));
  ok('links: pad 1 speelt = omgekeerd vlak', S.leesPixel(links, 60, 25));
  const rechts = S.tekenScherm(st, 1);
  ok('rechts: knop 5 met zijn label (ook zonder instrument)', rechts.some((x) => x));
  ok('uitleg: pad 13 = sampler-pad 1, pad 5 = sectie in pad 1, draaiknop 5 = sampler-volume',
    /sampler-pad 1:/.test(m.legUit(parseMessage([0x90, D.PAD_NOOT + 12, 100])).tekst)
    && /sectie .*sampler-pad 1/.test(m.legUit(parseMessage([0x90, D.PAD_NOOT + 4, 100])).tekst)
    && /sampler-volume/.test(m.legUit(parseMessage([0xb0, D.ENCODER_CC + 4, 1])).tekst));
  ok('uitleg ◄ ►: minder/meer tellen (de mapping, niet "bladzijde")', /minder tellen/.test(m.legUit(parseMessage([0x91, D.knopNoot('stapL'), 100])).tekst));
}

console.log('\nloslaten na een wissel, PATTERN vast, Strip, de library open (review 8 okt)');
{
  gestuurd.length = 0;
  pad(13); druk('step'); pad(13, false);
  ok('pad 13 ingedrukt in sampler, losgelaten na STEP: het loslaten naar sampler.1', JSON.stringify(gestuurd) === JSON.stringify([['sampler.1', true], ['sampler.1', false]]));
  druk('sampling');
  gestuurd.length = 0;
  knop('stapL'); druk('sampling'); knop('stapL', false);
  ok('◄ ingedrukt in sampler, losgelaten na terug naar spelen: het loslaten naar sampler.length.down',
    JSON.stringify(gestuurd) === JSON.stringify([['sampler.length.down', true], ['sampler.length.down', false]]));
  druk('sampling');
  knop('pattern');
  gestuurd.length = 0;
  druk('stapL');
  ok('PATTERN vast in sampler: ◄ = minder tellen, en de uitleg zegt dat ook (niet "bladzijde")',
    gestuurd[0]?.[0] === 'sampler.length.down' && /minder tellen/.test(m.legUit(parseMessage([0x91, D.knopNoot('stapL'), 100])).tekst));
  knop('pattern', false);
  m.zetPagina('strip');
  const st = m.stand();
  ok('pagina Strip in sampler: knop 5 = volume (ook op het dj-scherm rechts), 6 = galm van de strip', st.knoppen[4]?.label === 'volume' && st.knoppen[5]?.label === 'galm');
  const rechts = S.tekenScherm(st, 1), links = S.tekenScherm(st, 0);
  ok('pagina Strip in sampler: links nog steeds de pads, rechts het dj-scherm', S.leesPixel(links, 128, 9) && rechts.some((x) => x));
  m.zetPagina('instrument');
  const zonderSampler = new Maschine({ engine: { ...engine, sampler: null }, read: () => null, beschrijf });
  zonderSampler.zetModus('sampler');
  ok('zonder sampler (de losse kaart): knop 5 heet toch volume', zonderSampler.stand().knoppen[4]?.label === 'volume');
  // De library open tijdens de sampler: ◄ ► (transport) blijven tellen, ◄ ► bij het wiel bladeren.
  const metLib = new Maschine({ engine, read: (a) => (a === 'library.toggle' ? 1 : read(a)), invoke: (a, v) => gestuurd.push([a, v]), beschrijf, library: { bladerStand: () => ({ gekozen: 0, totaal: 2, rijen: [], track: null }) } });
  metLib.laadMapping(doc);
  metLib.zetModus('sampler');
  gestuurd.length = 0;
  for (const n of ['stapR', 'navR']) { metLib.ontvang(parseMessage([0x91, D.knopNoot(n), 127])); metLib.ontvang(parseMessage([0x81, D.knopNoot(n), 0])); }
  ok('library open in sampler: ► (transport) = meer tellen, ► bij het wiel = 10 verder', gestuurd.filter(([, v]) => v).map(([a]) => a).join() === 'sampler.length.up,library.page.next');
}

console.log('\nterug naar spelen');
{
  druk('sampling');
  gestuurd.length = 0;
  pad(13); pad(13, false); druk('stapL');
  ok('SAMPLING nog eens: spelen; de pads spelen noten, ◄ ► doen niets', m.modus === 'spelen' && gestuurd.every(([a]) => a === 'noot') && gestuurd.length === 2);
  ok('lampje SAMPLING weer zacht', led('sampling') === HELDER.beschikbaar);
  druk('step'); druk('sampling');
  ok('één padmodus tegelijk: STEP en dan SAMPLING = sampler', m.modus === 'sampler');
  druk('sampling');
  const zonder = new Maschine({ engine: { ...engine, sampler: null }, read: () => null, beschrijf });
  ok('zonder sampler in de engine: SAMPLING-lampje uit', zonder.ledBeeld().get(`${D.KNOP_KANAAL}:${D.knopNoot('sampling')}`) === HELDER.uit);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
