// De Maschine-kaart (maschine.html, src/ui/maschine-kaart-plan.js): de plaat en
// wat elke control doet. De belofte van de kaart: de tekst is PRECIES de uitleg
// van de Maschine zelf (legUit, CONTROL vasthouden), in elke pagina en padmodus;
// niets wat in de indeling staat lijkt "vrij"; en de kaart stuurt nooit iets.
// In Chromium (los en live vanuit de mixer): tools/headless/maschine-kaart.mjs.
// Draai met: node test/maschine-kaart.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const { parseMessage } = await import('../src/control/midi.js');
const { Maschine, UITLEG, PAGINAS } = await import('../src/control/maschine.js');
const D = await import('../src/control/devices/maschine-mk2.js');
const K = await import('../src/ui/maschine-kaart-plan.js');
const { SOORTEN, soortVan } = await import('../src/ui/soorten.js');
const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const doc = JSON.parse(lees('../mappings/maschine-mk2.json'));

// ---- twee Maschines: zonder mixer (zoals de kaart los), en met een nep-engine ----------
const ZONDER = { focus: 'A', speeltrack: () => null, instrumentOp: () => null, deck: () => null };
const POLY = { soort: 'poly', naam: 'Poly', params: ['golf', 'ontstem', 'filter', 'reso', 'env', 'attack', 'decay', 'sustain'].map((label) => ({ label })),
  leesParam: () => 0.5, stand: () => ({ pads: null }) };
const MET = {
  focus: 'B', speeltrack: () => 'B', instrumentOp: (id) => (id === 'B' ? POLY : null),
  deck: (id) => (id === 'B' ? { buffer: null, fx: { rackNaam: 'Filter', plekNaam: (k) => ['cutoff', 'reso', 'mix'][k - 1] ?? null, plekBipolair: () => false } } : null),
};
const gestuurd = [];
let libraryOpen = 0;          // wat de nep-bus zegt voor library.toggle (bladeren, §5e)
const maak = (engine) => {
  // read: een rackplek die bestaat heeft een stand (zoals de bus); de rest null.
  const m = new Maschine({ engine, read: (a) => (a === 'library.toggle' ? libraryOpen : /\.fx\.knob\.[1-3]$/.test(a) ? 0.5 : null), invoke: (...a) => gestuurd.push(a), beschrijf });
  m.laadMapping(doc);
  return m;
};
const zonder = maak(ZONDER), met = maak(MET);

console.log('de plaat');
{
  const ids = K.PLAATS.map(([id]) => id);
  ok(`72 controls: 16 pads, 8 draaiknoppen, het wiel en 47 knoppen (${ids.length})`, ids.length === 72
    && ids.filter((i) => /^pad\d+$/.test(i)).length === 16 && ids.filter((i) => /^k\d$/.test(i)).length === 8 && ids.includes('wiel'));
  ok('elke knop van het apparaat staat er precies één keer op (het wiel als draaien + indrukken)',
    D.KNOPPEN.every((n) => ids.filter((i) => i === n).length === (n === 'wiel' ? 1 : 1)) && new Set(ids).size === ids.length);
  ok('elke control heeft een signature die het apparaatprofiel kent', K.PLAATS.every(([id]) => D.maschineMk2.controls.has(K.sigVan(id))));
  ok('heen en terug: idVanSig(sigVan(id)) = id, en het wiel indrukken is het wiel',
    K.PLAATS.every(([id]) => K.idVanSig(K.sigVan(id)) === id) && K.idVanSig(D.knopSig('wiel')) === 'wiel' && K.idVanSig('note:5:99') === null);
  ok('elke control heeft een opdruk en zit in precies één deel van de lijst',
    K.PLAATS.every(([id]) => K.OPDRUK[id] && K.DELEN.filter(([, d]) => d.includes(id)).length === 1));
  ok('alles binnen de plaat (0–100%)', K.PLAATS.every(([, , x, y]) => x > 0 && x < 100 && y > 0 && y < 100));
}

console.log('\nde tekst is die van de Maschine (legUit), in elke stand');
{
  let verschil = [], getoetst = 0;
  for (const m of [zonder, met]) {
    for (const pagina of PAGINAS) {
      for (const p of K.PADMODI) {
        m.zetPagina(pagina); K.zetPadmodus(m, p.id);
        const alles = K.leesAlles(m);
        for (const [id] of K.PLAATS) {
          getoetst++;
          const echt = m.legUit(K.berichtVan(id));
          const r = alles.get(id);
          if (r.tekst !== echt.tekst || r.titel !== echt.titel) verschil.push(`${pagina}/${p.id}/${id}`);
        }
      }
    }
  }
  ok(`${getoetst} keer: tekst en titel gelijk aan legUit${verschil.length ? ' — anders: ' + verschil.slice(0, 5).join(', ') : ''}`, verschil.length === 0);
  ok('een knop van maschine.js zelf: de tekst uit UITLEG (dezelfde als op het scherm)',
    Object.keys(UITLEG).every((n) => n === 'wiel' || zonder.legUit(parseMessage([0x91, D.knopNoot(n), 100])).tekst === UITLEG[n].tekst));
  ok('elke UITLEG heeft een kort label en een soort met een kleur', Object.values(UITLEG).every((u) => u.kort && u.tekst && SOORTEN.some(([s]) => s === u.soort)));
}

console.log('\nniets uit de indeling lijkt vrij');
{
  const fout = [];
  for (const r of doc.rules) {
    const id = K.idVanSig(r.in);
    if (!id) { fout.push(`${r.in} staat niet op de plaat`); continue; }
    const m = met;
    m.zetPagina(r.laag?.startsWith('pagina.') ? r.laag.replace('pagina.', '') : 'instrument'); K.zetPadmodus(m, r.laag === 'sampler' ? 'sampler' : 'spelen');
    libraryOpen = r.laag === 'bladeren' ? 1 : 0;
    const c = K.leesControl(m, id, { shift: !!r.shift });
    libraryOpen = 0;
    if (c.vrij) fout.push(`${id} (${r.laag ?? 'zonder laag'}${r.shift ? ', shift' : ''})`);
  }
  ok(`elke regel van mappings/maschine-mk2.json (${doc.rules.length}) staat op de plaat en is niet vrij${fout.length ? ': ' + fout.slice(0, 5).join(', ') : ''}`, fout.length === 0);
  met.zetPagina('instrument'); K.zetPadmodus(met, 'spelen');
  const alles = K.leesAlles(met);
  const vrij = [...alles.values()].filter((r) => r.vrij).map((r) => r.id);
  ok(`vrij zijn alleen knoppen zonder regel en zonder eigen uitleg (${vrij.length}: ${vrij.join(' ')})`,
    vrij.includes('f1') && vrij.includes('noteRepeat') && !vrij.includes('browse') && !vrij.includes('play') && !vrij.includes('control') && !vrij.some((i) => /^pad\d|^k\d$/.test(i)));
  const css = lees('../styles.css');
  const soorten = new Set([...alles.values()].map((r) => r.soort));
  for (const pagina of PAGINAS) for (const p of K.PADMODI) { met.zetPagina(pagina); K.zetPadmodus(met, p.id); for (const r of K.leesAlles(met).values()) soorten.add(r.soort); }
  ok(`elke soort op de kaart heeft een kleur in styles.css (${[...soorten].join(', ')})`, [...soorten].every((s) => css.includes(`.s-${s}{`)));
}

console.log('\nlabels en standen');
{
  const m = met;
  m.zetPagina('strip'); K.zetPadmodus(m, 'spelen');
  let a = K.leesAlles(m);
  ok('Strip: trim · hoog · mid · laag · echo · galm · fx-mix · filter', ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'].map((k) => a.get(k).kort).join(' ') === 'trim hoog mid laag echo galm fx-mix filter');
  ok('…met de soort van de action: EQ = mixer, echo = effecten', a.get('k2').soort === 'mixer' && a.get('k5').soort === 'fx');
  m.zetPagina('rack');
  a = K.leesAlles(m);
  ok('Rack: de namen van het rack (cutoff, reso, mix), daarna plek 4…', a.get('k1').kort === 'cutoff' && a.get('k3').kort === 'mix' && a.get('k4').kort === 'plek 4');
  m.zetPagina('instrument');
  a = K.leesAlles(m);
  ok('Instrument met Poly op de speeltrack: de namen van zijn knoppen', a.get('k1').kort === 'golf' && a.get('k8').kort === 'sustain');
  zonder.zetPagina('instrument');
  ok('zonder instrument: instr 1…8', K.leesAlles(zonder).get('k1').kort === 'instr 1');
  ok('pads spelen: C2 (pad 1) tot D#3 (pad 16)', a.get('pad1').kort === 'C2' && a.get('pad16').kort === 'D#3');
  K.zetPadmodus(m, 'stappen');
  ok('stappen: stap 1–16', K.leesAlles(m).get('pad16').kort === 'stap 16');
  K.zetPadmodus(m, 'plek');
  a = K.leesAlles(m);
  ok('PATTERN vast: plek 1–5, pad 6–16 vrij', a.get('pad5').kort === 'plek 5' && a.get('pad6').vrij && K.padmodusVan(m) === 'plek');
  K.zetPadmodus(m, 'secties');
  ok('secties zonder nummer: sectie N', K.leesAlles(m).get('pad2').kort === 'sectie 2');
  K.zetPadmodus(m, 'spelen');
  const gewoon = K.leesControl(m, 'play'), metShift = K.leesControl(m, 'play', { shift: true });
  ok(`PLAY: met shift een ander label (${gewoon.kort} / ${metShift.kort}), en hij weet dat er een shift-regel is`, gewoon.kort !== metShift.kort && metShift.shiftRegel);
  ok('groep A = focus 1 (transport & focus)', a.get('groepA').kort === 'focus 1' && a.get('groepA').soort === soortVan('track.1.focus'));
}

console.log('\nper stand, en de Maschine blijft zoals hij was');
{
  const m = met;
  m.zetPagina('strip'); K.zetPadmodus(m, 'stappen'); m.bladzijde = 0;
  const voor = JSON.stringify(K.neemStand(m));
  const pad = K.perStand(m, 'pad4'), knop = K.perStand(m, 'k1');
  ok('pad: vijf padmodi (sinds SAMPLING, §5f), de huidige gemarkeerd', pad.length === 5 && pad.filter((x) => x.nu).length === 1 && pad.find((x) => x.nu).naam.startsWith('stappen'));
  ok('draaiknop: drie pagina\'s, de huidige gemarkeerd', knop.length === 3 && knop.find((x) => x.nu).naam === 'Strip' && /trim/.test(knop[1].tekst));
  ok('een gewone knop: geen tabel', K.perStand(m, 'play').length === 0);
  const stap = K.perStand(m, 'stapL');
  ok('◄ (transport): per padmodus, in sampler "minder tellen" (§5f)', stap.length === 5 && /minder tellen/.test(stap.find((x) => x.naam.startsWith('sampler')).tekst));
  ok('na perStand staat de Maschine precies zoals ervoor', JSON.stringify(K.neemStand(m)) === voor);

  // Per padmodus = wat de Maschine zegt NADAT je op STEP/SCENE/PATTERN drukt. Met >16 secties en
  // een focuswissel: het apparaat springt dan naar het blad dat je hoort (review 7 okt: de kaart
  // draaide dat terug en zei "sectie 17" waar het apparaat "sectie 1" zei).
  const secties = (n, hier) => ({ buffer: {}, sectieKaart: { aantal: n, naam: (i) => `deel ${i + 1}` }, sectieHier: hier, sectieOpDeMaat: hier });
  const decks = { A: secties(20, 18), B: secties(20, 0) };
  const eng = { focus: 'A', speeltrack: () => null, instrumentOp: () => null, deck: (id) => decks[id] ?? null };
  const kaart = maak(eng), apparaat = maak(eng);
  for (const x of [kaart, apparaat]) { x.zetModus('secties'); x.zetModus('spelen'); }   // op A: blad 2 (je hoort sectie 19)
  eng.focus = 'B';                                                                      // groep B
  const rij = K.perStand(kaart, 'pad1').find((x) => x.naam.startsWith('secties'));
  apparaat.ontvang(parseMessage([0x91, D.knopNoot('scene'), 127]));
  const echt = apparaat.legUit(K.berichtVan('pad1')).tekst;
  ok(`secties na een focuswissel: de kaart zegt wat het apparaat na SCENE zegt ("${rij.tekst.slice(0, 30)}…")`, rij.tekst === echt && /sectie 1 /.test(echt));
  const elk = K.PADMODI.filter((p) => p.id !== 'plek').every((p) => {
    const a = maak(eng), b = maak(eng);
    const kaartRij = K.perStand(a, 'pad3').find((x) => x.naam === p.naam).tekst;
    if (p.id === 'stappen') b.ontvang(parseMessage([0x91, D.knopNoot('step'), 127]));
    if (p.id === 'secties') b.ontvang(parseMessage([0x91, D.knopNoot('scene'), 127]));
    if (p.id === 'sampler') b.ontvang(parseMessage([0x91, D.knopNoot('sampling'), 127]));
    return kaartRij === b.legUit(K.berichtVan('pad3')).tekst;
  });
  ok('elke padmodus: de rij van de kaart = de uitleg van een Maschine die die knop indrukte', elk);
}

console.log('\nshift op knoppen met een eigen uitleg');
{
  const m = maak(ZONDER);
  const gewoon = K.leesControl(m, 'stapL'), metShift = K.leesControl(m, 'stapL', { shift: true });
  ok(`◄ (transport): "${gewoon.kort}", met SHIFT "${metShift.kort}" (de mapping: het patroon korter)`, gewoon.kort === '◄ blad' && metShift.kort === 'korter' && metShift.shiftRegel);
  ok('CONTROL heeft geen shift-regel en blijft "uitleg"', K.leesControl(m, 'control', { shift: true }).kort === 'uitleg' && !K.leesControl(m, 'control').shiftRegel);
}

console.log('\nde kaart stuurt niets, en volgt alleen');
{
  ok(`in alle standen en controls hierboven: niets naar de bus (${gestuurd.length} keer)`, gestuurd.length === 0);
  // De stand van het apparaat overnemen (live): alleen velden kopiëren.
  const app = maak(MET), kaart = maak(ZONDER);
  app.zetPagina('rack'); K.zetPadmodus(app, 'secties');
  K.zetStand(kaart, K.neemStand(app));
  ok('neemStand/zetStand: pagina en padmodus van het apparaat op de kaart', kaart.pagina === 'rack' && K.padmodusVan(kaart) === 'secties');
  // geraakt: wat de Maschine het laatst kreeg (indrukken of draaien), voor de oplichtende knop.
  app.ontvang(parseMessage([0x91, D.knopNoot('play'), 127]));
  const na = app.geraakt?.sig;
  app.ontvang(parseMessage([0x81, D.knopNoot('play'), 0]));
  ok('maschine.geraakt = de laatste knop die je indrukte (loslaten telt niet)', na === D.knopSig('play') && app.geraakt.sig === D.knopSig('play'));
  app.ontvang(parseMessage([0xb0, D.ENCODER_CC + 2, 1]));
  ok('…of draaide (draaiknop 3)', app.geraakt.sig === D.encoderSig(3) && K.idVanSig(app.geraakt.sig) === 'k3');
}

console.log('\nde mixer en de server');
{
  const html = lees('../index.html');
  ok('de mixer: naast APC een knop Maschine naar maschine.html', /id="apc-btn"[^>]*>APC<\/a>\s*<a id="maschine-btn"[^>]*href="maschine\.html"[^>]*>Maschine<\/a>/.test(html));
  ok('de server laat maschine.html door (witte lijst)', /\(index\|video\|apc\|maschine\|plan\|controle\)\\\.html/.test(lees('../server/index.js')));
  const kaart = lees('../src/ui/maschine-kaart.js');
  ok('de kaart vraagt geen MIDI aan en stuurt niets (invoke doet niets)', !/requestMIDIAccess/.test(kaart) && /invoke: \(\) => \{\}/.test(kaart));
}

// ---- spoor S6: de kaarten en de spiekbrief per werkruimte en deel (voorbeeldmodus) ----------
console.log('\nwerkruimte × deel × padmodus (voorbeeldmodus, spoor S6)');
{
  const { existsSync } = await import('node:fs');
  const SB = await import('../src/ui/spiekbrief.js');
  const { Mapping } = await import('../src/control/mapping.js');
  const apcDev = (await import('../src/control/devices/apc40mk2.js')).default;
  const wortel = new URL('../', import.meta.url);
  const haal = async (url) => {
    const m = /^\/api\/werkruimtes\/(.+)$/.exec(url);
    if (url === '/api/werkruimtes') return { werkruimtes: ['standaard', 'apc-alleen', 'twee-handen'].map((naam) => ({ naam })) };
    const pad = new URL(m ? `tools/werkruimtes/voorbeelden/${decodeURIComponent(m[1])}.json` : url, wortel);
    if (!existsSync(pad)) return null;
    const d = JSON.parse(readFileSync(pad, 'utf8'));
    return m ? { ruw: d } : d;
  };
  const apcDoc = JSON.parse(lees('../mappings/apc40mk2.json'));
  const leeg = /^(doet hier \(nog\) niets|doet in padmodus .* niets|doet op deze pagina niets)$/;
  for (const naam of (await SB.lijstWerkruimtes(haal)).map((w) => w.naam)) {
    const v = await SB.laadVoorbeeld(naam, haal);
    ok(`${naam}: laadt zonder fouten`, v.werkruimte && v.fouten.length === 0);
    let regels = 0, zonderUitleg = [];
    for (const d of SB.delenVan(v)) {
      const m = K.maakVoorbeeldMaschine({ doc, v, deel: d.naam, beschrijf });
      for (const pm of K.padmodiVan(m)) {
        K.zetPadmodus(m, pm.id);
        for (const p of K.paginasVan(m)) {
          m.pagina = p;
          for (const [id, r] of K.leesAlles(m)) {
            const heeft = m.mapping.kies(r.sig, { shift: false }) || m.mapping.kies(r.sig, { shift: true });
            if (!heeft) continue;
            regels++;
            if (!r.tekst || leeg.test(r.tekst) || r.vrij) zonderUitleg.push(`${d.label}/${pm.id}/${p}/${id}`);
          }
        }
      }
    }
    ok(`${naam}: Maschine, geen lege uitleg waar een regel staat (${regels} plekken)`, regels > 0 && zonderUitleg.length === 0);
    if (zonderUitleg.length) console.log('      ', zonderUitleg.slice(0, 8).join(', '));
    // APC: elke regel in elk deel heeft een uitleg.
    const apcMapping = new Mapping({ read: () => null, invoke: () => {} });
    apcMapping.laadStandaard(apcDoc);
    const af = SB.zetFragmenten(apcMapping, v, 'apc40mk2');
    const afM = SB.zetApcMapjes(v);
    const apcLeeg = [];
    for (const d of SB.delenVan(v)) for (const r of SB.apcRijen(apcMapping, SB.apcStandVan(v, d.naam), beschrijf)) if (!r.tekst || r.tekst.startsWith('?') || / mapje [a-z]+: {2}/.test(r.tekst + (r.shift ?? ''))) apcLeeg.push(`${d.label} ${r.knop}`);
    af(); afM();
    ok(`${naam}: APC, elke regel in elk deel een uitleg`, apcLeeg.length === 0);
    if (apcLeeg.length) console.log('      ', apcLeeg.slice(0, 8).join(', '));
    const vers = new Mapping({ read: () => null, invoke: () => {} });
    vers.laadStandaard(apcDoc);
    ok(`${naam}: na het bekijken staat de APC-mapping weer zoals hij was`, apcMapping.extra.size === 0 && apcMapping.rules.size === vers.rules.size);
  }
  // In voorbeeldmodus: het deel zet de mapjes van de Maschine, de deellabels staan erop, er gaat niets naar de bus.
  const v = await SB.laadVoorbeeld('twee-handen', haal);
  const voor = gestuurd.length;
  const fx = K.maakVoorbeeldMaschine({ doc, v, deel: 'fx', beschrijf });
  ok('voorbeeld FX: padmodus worpen, pagina rack, deellabels met FX actief', fx.modus === 'worpen' && fx.pagina === 'rack' && fx.delen.labels[fx.delen.actief] === 'FX');
  ok('voorbeeld FX: pad 1 = worp plek 1 (kort op de kaart)', K.leesControl(fx, 'pad1').kort === 'worp fx 1' && !K.leesControl(fx, 'pad1').vrij);
  ok('voorbeeld FX: pad 16 vrij (geen regel)', K.leesControl(fx, 'pad16').vrij);
  fx.ontvang(parseMessage([0x90, 36, 100])); fx.ontvang(parseMessage([0x80, 36, 0]));
  ok('de voorbeeld-Maschine stuurt niets (invoke doet niets)', gestuurd.length === voor);
  const ul = K.maakVoorbeeldMaschine({ doc, v, deel: 'uitlijn', beschrijf });
  ok('voorbeeld UITLIJN: pagina uitlijn, draaiknop 1 = fase', ul.pagina === 'uitlijn' && K.leesControl(ul, 'k1').kort === 'fase');
  ok('perStand van pad 1: ook de padmodus uit het stuk', K.perStand(fx, 'pad1').some((r) => r.naam.startsWith('worpen') && /worp|plek 1/.test(r.tekst)));
  ok('perStand van draaiknop 1: ook de pagina Uitlijn', K.perStand(ul, 'k1').some((r) => r.naam === 'Uitlijn' && /fase/.test(r.tekst)));
  ok('zonder werkruimte: dezelfde padmodi en pagina\'s als vroeger', JSON.stringify(K.padmodiVan(zonder)) === JSON.stringify(K.PADMODI) && JSON.stringify(K.paginasVan(zonder)) === JSON.stringify(PAGINAS));

  console.log('\nde spiekbrief (spiekbrief.html, src/ui/spiekbrief.js)');
  const apcMapping = new Mapping({ read: () => null, invoke: () => {} });
  apcMapping.laadStandaard(apcDoc);
  for (const naam of ['standaard', 'apc-alleen', 'twee-handen']) {
    const vv = await SB.laadVoorbeeld(naam, haal);
    const paginas = SB.spiekbrief(vv, { apcMapping, maschineDoc: doc, maschine: K, beschrijf, maschineLabel: (s) => D.maschineMk2.label(s) });
    const apps = SB.metMaschine(vv) ? 2 : 1;
    const delen = SB.delenVan(vv).length;
    ok(`${naam}: één pagina per apparaat × deel (${apps} × ${delen})`, paginas.length === apps * delen
      && new Set(paginas.map((p) => `${p.apparaat}/${p.deel.naam}`)).size === paginas.length);
    const zonderTekst = paginas.flatMap((p) => [...p.rijen, ...p.houd.flatMap((h) => h.rijen)].filter((r) => !r.tekst || !r.knop).map((r) => `${p.deel.label} ${r.knop}`));
    ok(`${naam}: elke regel met tekst (${paginas.reduce((n, p) => n + p.rijen.length, 0)} regels)`, zonderTekst.length === 0 && paginas.every((p) => p.rijen.length > 0));
    const html = SB.spiekHtml(paginas);
    ok(`${naam}: de HTML heeft precies zoveel bladen, elk in de kleur van het deel`, (html.match(/<section class="blad"/g) ?? []).length === paginas.length && /--deel:#[0-9A-F]{6}/i.test(html));
  }
  const tw = SB.spiekbrief(await SB.laadVoorbeeld('twee-handen', haal), { apcMapping, maschineDoc: doc, maschine: K, beschrijf, maschineLabel: (s) => D.maschineMk2.label(s) });
  ok('twee-handen: het Maschine-blad van FX noemt de worp op pad 1 en de houd-knoppen', tw.some((p) => p.apparaat === 'maschine-mk2' && p.deel.naam === 'fx'
    && p.rijen.some((r) => r.knop === 'pad 1' && /plek 1/.test(r.tekst)) && p.houd.some((h) => h.naam === 'volume' && h.rijen.length === 16)));
  ok('twee-handen: het APC-blad van UITLIJN noemt de fasemeter op device knob 2', tw.some((p) => p.apparaat === 'apc40mk2' && p.deel.naam === 'uitlijn'
    && p.rijen.some((r) => r.sig === 'cc:0:17' && /fase/.test(r.tekst))));
  ok('na de spiekbrief: de APC-mapping zonder fragmenten', apcMapping.extra.size === 0);
  const sb = lees('../spiekbrief.html') + lees('../src/ui/spiekbrief.js');
  ok('de spiekbrief vraagt geen MIDI en importeert de bus niet', !/requestMIDIAccess/.test(sb) && !/control\/actions\.js/.test(sb));
  ok('de server laat spiekbrief.html door (witte lijst)', /spiekbrief\)\\\.html/.test(lees('../server/index.js')));
  ok('apc-kaart en maschine-kaart hebben de kiezer werkruimte + deel', /werk-kies/.test(lees('../src/ui/apc-kaart.js')) && /werk-kies/.test(lees('../src/ui/maschine-kaart.js')));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
