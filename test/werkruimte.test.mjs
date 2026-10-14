// @alleen: meet de JS-tijd van een deelwissel en van de LED-tik erna op de wandklok
// De werkruimte in de mixer (werkruimte S3, docs/WERKRUIMTE.md C2, docs/werkruimte/S3.md):
// src/werk/werkruimte.js, apparaten.js en src/control/acties-werk.js op de echte bus, de echte
// Lagen en een echte Mapping van de APC (standaard + Clay's verschil), zonder browser.
// Bus-spion (een deelwissel = 0 invokes buiten layer.*/werk.*), de LED-diff in één tik (nep-klok),
// volgt (vast tegen gluren), onthoud, THUIS (ook via ⇧ master-knop en het stuk basis),
// vereist/terugval met een nep-Maschine, vastleggen (tweede druk), peilen, en het scherm.
// Draai met: node test/werkruimte.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const bus = await import('../src/control/actions.js');
const { Lagen, GROEPEN } = await import('../src/control/lagen.js');
const { Mapping } = await import('../src/control/mapping.js');
const { Feedback } = await import('../src/control/feedback.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;
const { Werkruimte, maakHaler, plekkenVan } = await import('../src/werk/werkruimte.js');
const { maakApcAdapter, registreerApparaat, apparaat } = await import('../src/werk/apparaten.js');
const { bindWerk } = await import('../src/control/acties-werk.js');
const { slaOver } = await import('../src/control/terugspelen.js');
const beschrijfWerk = (await import('../src/ui/beschrijf/werk.js')).default;

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const pad = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const lees = (p) => JSON.parse(readFileSync(pad(p), 'utf8'));
const microtaak = () => new Promise((z) => setTimeout(z, 0));

// ---- de opzet: bus, mapjes, APC-mapping, adapter ----------------------------------------------
let klok = 1000;
const lagen = new Lagen({ now: () => klok });
bus.bindLagen(lagen);
const mapping = new Mapping({ read: bus.read, invoke: bus.invoke, vars: () => ({ focus: 1 }), lagen: () => lagen.actief(), metaOf: bus.metaOf });
const VIDEO = { 'cc:0:20': 'video.fx.pixel', 'cc:0:21': 'video.fx.rgb', 'cc:0:22': 'video.fx.trails', 'cc:0:23': 'video.fx.grain' };
mapping.zetStandaard(lees('mappings/apc40mk2.json'));
mapping.load({ kind: 'diff', version: 3, device: 'apc40mk2', top: {}, removed: [],
  rules: Object.entries(VIDEO).map(([s, a]) => ({ in: s, action: a, mode: 'absolute', laag: 'device.rack' })) });
const regelsVandaag = new Map([...mapping.rules].map(([k, r]) => [k, r.action]));

const adapter = maakApcAdapter({ lagen, invoke: bus.invoke, bijInvoke: bus.bijInvoke, mapping, naam: 'APC' });
registreerApparaat('apc40mk2', adapter);

// De stukken: wat er is, plus een namaak van wat andere sporen nog bouwen (zoals werkruimte-model.test).
const NAMAAK = {
  uitlijn: { schema: 1, stuk: 'uitlijn', mapjes: { nieuw: { 'apc40mk2.device.uitlijn': { naam: 'uitlijn', kiesknop: { in: 'note:0:63', shift: true }, kleur: 'groen' } } },
    regels: { apc40mk2: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ in: `cc:0:${16 + i}`, laag: 'device.uitlijn', action: `track.${i + 1}.filter`, mode: 'endless' })) } },
  'fx-matrix': { schema: 1, stuk: 'fx-matrix', mapjes: { nieuw: { 'apc40mk2.grid.fx': { naam: 'fx-matrix', kiesknop: { in: 'note:0:62', shift: true }, kleur: 'violet' } } },
    regels: { apc40mk2: [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ in: `note:0:${apc.gridNote(k, 1)}`, laag: 'grid.fx', action: `track.${k}.fx.knob.1.hold`, mode: 'trigger' })) } },
  'mix-extra': { schema: 1, stuk: 'mix-extra', regels: { apc40mk2: [0, 1, 2, 3, 4, 5, 6, 7].map((ch) => ({ in: `note:${ch}:66`, shift: true, action: `track.${ch + 1}.xfade.thru`, mode: 'trigger' })) } },
};
const haalStuk = async (n) => (existsSync(pad(`mappings/stukken/${n}.json`)) ? lees(`mappings/stukken/${n}.json`) : NAMAAK[n] ?? null);
// De werkruimtes: de voorbeelden, plus wat een test erbij zet (zoals een eigen bestand).
const eigen = new Map();
let haalTeller = 0;
const haal = async (naam) => {
  haalTeller++;
  if (eigen.has(naam)) return { ...eigen.get(naam) };
  const p = `tools/werkruimtes/voorbeelden/${naam}.json`;
  return existsSync(pad(p)) ? { werkruimte: lees(p), versie: `v-${naam}`, bron: 'voorbeeld' } : null;
};
const bewaard = [];
const bewaar = async (naam, ruw, versie) => { bewaard.push({ naam, ruw, versie }); return { ok: true, versie: `v${bewaard.length}` }; };

// Rijen en onderpaneel zoals het register (rijen.js) en de library ze geven.
const rijOpen = new Map();
const rijZet = [];
const rijen = {
  rij: (n) => (['stems', 'master', 'beeld', 'instrument', 'patronen', 'auto', 'klankschaal', 'koptelefoon'].includes(n)
    ? { naam: n, zet: (o) => { rijZet.push([n, o]); rijOpen.set(n, o); }, isOpen: () => !!rijOpen.get(n) } : null),
  rijNamen: () => ['auto', 'beeld', 'instrument', 'klankschaal', 'koptelefoon', 'master', 'stems', 'patronen'],
};
let libOpen = false;
const scherm = { onderpaneel: (n, o) => { libOpen = o; }, onderpaneelOpen: () => libOpen };
const meldingen = [];
const meld = (tekst, soort, duur, knop) => { meldingen.push({ tekst, soort, knop }); };
let nuMs = 0;

const werk = new Werkruimte({ mapping, herbind: bus.herbindLagen, meld, rijen, scherm, haal, haalStuk, bewaar,
  standaarden: { apc40mk2: lees('mappings/apc40mk2.json') }, conditie: (c) => c === 'focus.instrument' && focusInstrument, now: () => nuMs,
  basislijn: { opslag: new Map(), lees(n) { return this.opslag.get(n) ?? null; }, zet(n, p) { this.opslag.set(n, p); } } });
let focusInstrument = false;
let namen = ['standaard', 'apc-alleen', 'twee-handen'];
bindWerk(werk, { lijst: () => namen });
const wissels = [];
werk.on('change', (s) => wissels.push(s));
const werkvak = [];
werk.on('werkruimte', (e) => werkvak.push(e));

// De bus-spion: alles wat er over de bus gaat.
const spion = [];
bus.bijInvoke((id, v) => spion.push([id, v]));
const buiten = (lijst) => lijst.filter(([id]) => !/^(layer|werk)\./.test(id));
const druk = (id) => { bus.invoke(id, true); bus.invoke(id, false); };
const note = (num, on, ch = 0) => ({ sig: `note:${ch}:${num}`, type: 'note', channel: ch, number: num, value: on ? 127 : 0, norm: on ? 1 : 0, on });
const shift = (aan) => mapping.handle(note(98, aan));

try {
  console.log('actions');
  ok('werk.deel.1–8, next/prev, thuis, vastleggen, kies bestaan', [1, 2, 3, 4, 5, 6, 7, 8].every((n) => bus.has(`werk.deel.${n}`))
    && ['werk.deel.next', 'werk.deel.prev', 'werk.thuis', 'werk.vastleggen', 'werk.kies'].every((a) => bus.has(a)));
  ok('alle werk.* met log: overslaan en beginstand: false', bus.list().filter((a) => a.id.startsWith('werk.')).every((a) => a.meta.log === 'overslaan' && a.meta.beginstand === false));
  ok('terugspelen slaat werk.* over (slaOver), ook werk.deel.<naam> van de acht vaste namen vóór er een werkruimte is',
    ['werk.deel.fx', 'werk.deel.bladeren', 'werk.deel.3', 'werk.thuis', 'werk.vastleggen', 'werk.kies', 'werk.deel.next'].every((a) => slaOver(a)));
  ok('werk.kies is alleenScherm', bus.metaOf('werk.kies').alleenScherm === true && bus.metaOf('werk.thuis').alleenScherm === undefined);
  ok('een regel met werk.kies wordt geweigerd', mapping.set('note:0:58', 'werk.kies', { shift: true, laag: 'device.strip' }) === null);
  ok('standaard: werk.deel.1 leest null (bestaat niet)', bus.read('werk.deel.1') === null);
  ok('elke werk-action heeft een uitleg', bus.list().filter((a) => a.id.startsWith('werk.')).every((a) => beschrijfWerk(a.id)?.kort));

  console.log('\nstandaard');
  await werk.kies('standaard');
  ok('standaard: geen delen, de mapping precies die van vandaag', werk.delen().length === 0 && mapping.rules.size === regelsVandaag.size
    && [...regelsVandaag].every(([k, a]) => mapping.rules.get(k)?.action === a));

  console.log('\napc-alleen');
  spion.length = 0;
  await werk.kies('apc-alleen');
  ok('apc-alleen: acht delen, deel MIX, begonnen met start', werk.delen().length === 8 && werk.deel === 'mix' && werk.door === 'start');
  ok('… ⇧ master-knop = werk.thuis (stuk basis), master-knop blijft beeld zwart', mapping.rules.get('note:0:80#shift')?.action === 'werk.thuis' && mapping.rules.get('note:0:80')?.action === 'video.black');
  ok('… de mapjes van de stukken zijn er (device.uitlijn, grid.fx) met hun kiesknop', GROEPEN.device.knoppen.uitlijn?.[0] === 'uitlijn' && GROEPEN.grid.knoppen.fx?.[0] === 'fx'
    && bus.has('layer.device.uitlijn') && bus.has('layer.grid.fx'));
  ok('… Clay\'s eigen regels winnen nog steeds', Object.entries(VIDEO).every(([s, a]) => mapping.rules.get(`${s}@device.rack`)?.action === a));
  ok('… kiezen = 0 invokes buiten layer.*/werk.*', buiten(spion).length === 0);
  ok('werk.deel.1 = 1, werk.deel.4 = 0, werk.deel.stems = 0', bus.read('werk.deel.1') === 1 && bus.read('werk.deel.4') === 0 && bus.read('werk.deel.stems') === 0);

  console.log('\neen deelwissel');
  spion.length = 0; wissels.length = 0;
  druk('werk.deel.fx');
  ok('werk.deel.fx: deel FX, grid fx, device rack', werk.deel === 'fx' && lagen.stand.grid === 'fx' && lagen.stand.device === 'rack');
  ok('… 0 invokes buiten layer.*/werk.* (bus-spion)', buiten(spion).length === 0 && spion.some(([id]) => id.startsWith('layer.')));
  ok(`… één change (${wissels.length})`, wissels.length === 1 && wissels[0].deel === 'fx' && wissels[0].door === 'scherm');
  ok('… de master-rij gaat open, het werkvak krijgt het deel', rijOpen.get('master') === true && werkvak.at(-1).deel === 'fx' && werkvak.at(-1).def.label === 'FX');
  for (const n of ['stems', 'secties', 'spelen', 'beeld', 'uitlijn', 'bladeren', 'mix']) {
    spion.length = 0;
    druk(`werk.deel.${n}`);
    ok(`werk.deel.${n}: deel ${n}, 0 invokes buiten layer.*/werk.*`, werk.deel === n && buiten(spion).length === 0);
  }
  ok('MIX (rijen: []) sluit wat de delen openzetten', ['master', 'stems', 'beeld', 'instrument', 'patronen'].every((n) => !rijOpen.get(n)));
  druk('werk.deel.bladeren');
  ok('LIBRARY opent de library', libOpen === true);
  druk('werk.deel.mix');
  ok('… en een ander deel sluit hem weer (hij was door het deel open)', libOpen === false);
  libOpen = true; druk('werk.deel.bladeren'); druk('werk.deel.mix');
  ok('een library die jij al open had, blijft open', libOpen === true);
  libOpen = false;
  rijOpen.set('klankschaal', true); druk('werk.deel.stems'); druk('werk.deel.mix');
  ok('een rij die jij opende, blijft open', rijOpen.get('klankschaal') === true);
  rijOpen.set('klankschaal', false);
  druk('werk.deel.spelen');
  ok('SPELEN zonder instrument op de focus: device strip (de conditie)', lagen.stand.device === 'strip' && lagen.stand.grid === 'patronen');
  druk('werk.deel.mix');
  ok('werk.deel.next/prev lopen rond', (druk('werk.deel.next'), werk.deel === 'uitlijn') && (druk('werk.deel.prev'), druk('werk.deel.prev'), werk.deel === 'bladeren'));
  druk('werk.deel.1');
  ok('werk.deel.1 = MIX', werk.deel === 'mix');

  console.log('\nLED-laag');
  {
    const uit = [];
    const fb = new Feedback({ device: apc, mapping, read: bus.read, meta: bus.metaOf, send: (b) => { uit.push([...b]); return true; }, nu: () => klok });
    fb.init(); fb.tick(10000); fb.tick(10000);
    uit.length = 0;
    const tWissel = [], tTik = [], tRust = [], tHand = [], n = [];
    let nagekomen = 0;
    // Om en om: een deelwissel, en ter vergelijking dezelfde mapjewissel met de hand (scene 1 /
    // ⇧ scene 3, zoals vandaag op de APC). Zo telt opwarmen van de JIT voor beide even zwaar.
    for (let i = 0; i < 40; i++) {
      const naar = i % 4 < 2 ? (i % 2 ? 'mix' : 'stems') : null;
      let t0 = performance.now();
      if (naar) { bus.invoke(`werk.deel.${naar}`, true); bus.invoke(`werk.deel.${naar}`, false); tWissel.push(performance.now() - t0); }
      else druk(i % 2 ? 'layer.grid.hotcues' : 'layer.grid.stems');
      klok += 33;                                   // nep-klok: de volgende tik van de LED-laag
      t0 = performance.now();
      const m = fb.tick();
      (naar ? tTik : tHand).push(performance.now() - t0);
      if (naar) n.push(m);
      klok += 33;
      t0 = performance.now();
      nagekomen += fb.tick();                       // een tweede tik vindt niets meer: alles zat in de eerste
      tRust.push(performance.now() - t0);
      await microtaak();                            // volgt na een wissel met de hand (de APC wordt dan niet gezet)
    }
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    druk('werk.deel.mix');
    console.log(`        wissel ${med(tWissel).toFixed(3)} ms (mediaan, max ${Math.max(...tWissel).toFixed(3)}), tik erna ${med(tTik).toFixed(3)} ms,`
      + ` tik na dezelfde wissel met de hand ${med(tHand).toFixed(3)} ms, tik zonder wissel ${med(tRust).toFixed(3)} ms, ${med(n)} berichten per tik`);
    ok('na een deelwissel stuurt de eerstvolgende tik (33 ms, nep-klok) de LED-diff', n.every((x) => x > 0));
    ok('… en de tik daarna niets meer (de diff zat in één tik)', nagekomen === 0);
    ok(`… JS van de wissel ≤ 1 ms (mediaan ${med(tWissel).toFixed(3)} ms)`, med(tWissel) <= 1);
    // De tik zelf is van de LED-laag (feedback.js, 710 regels): na ELKE mapjewissel rekent hij zijn plan
    // opnieuw (~1 ms, ook vandaag met scene 1 / ⇧ scene 3). Een deelwissel mag daar niets bij doen.
    ok(`… de tik na een deelwissel kost niet meer dan na dezelfde wissel met de hand (${med(tTik).toFixed(3)} tegen ${med(tHand).toFixed(3)} ms)`,
      med(tTik) <= med(tHand) * 1.25 + 0.1);
  }

  console.log('\nvolgt');
  druk('werk.deel.mix');
  await microtaak();
  spion.length = 0; wissels.length = 0;
  shift(true); mapping.handle(note(84, true)); klok += 50; mapping.handle(note(84, false)); shift(false);
  await microtaak();
  ok('⇧ scene 3 (stems vast open): deel STEMS', werk.deel === 'stems' && lagen.stand.grid === 'stems');
  ok(`… met één change (${wissels.length}), door "APC (volgt)"`, wissels.length === 1 && wissels[0].door === 'APC (volgt)');
  ok('… de APC wordt niet opnieuw gezet (alleen jouw twee layer.grid.stems)', spion.length === 2 && spion.every(([id]) => id === 'layer.grid.stems'));
  ok('… en de STEMS-rij gaat open', rijOpen.get('stems') === true);
  wissels.length = 0;
  shift(true); mapping.handle(note(84, true)); klok += 500; mapping.handle(note(84, false)); shift(false);   // al open: blijft
  mapping.handle(note(82, true)); klok += 500; mapping.handle(note(82, false));                              // gluren naar hotcues (500 ms)
  await microtaak();
  ok('gluren (≥ 400 ms vasthouden) wisselt het deel niet', werk.deel === 'stems' && lagen.stand.grid === 'stems' && wissels.length === 0);
  mapping.handle(note(82, true)); klok += 50; mapping.handle(note(82, false));
  await microtaak();
  ok('kort drukken op hotcues = vast: deel MIX', werk.deel === 'mix' && lagen.stand.grid === 'hotcues');
  bus.invoke('layer.grid.next', true); bus.invoke('layer.grid.next', false);
  await microtaak();
  ok('▲ ▼ naar loops (niet in volgt): het deel blijft MIX', werk.deel === 'mix' && lagen.stand.grid === 'loops');
  druk('layer.grid.hotcues'); await microtaak();
  shift(true); mapping.handle(note(63, true)); klok += 50; mapping.handle(note(63, false)); shift(false);
  await microtaak();
  ok('⇧ Lock (device.uitlijn, uit het stuk) = deel UITLIJN', werk.deel === 'uitlijn' && lagen.stand.device === 'uitlijn');

  console.log('\nonthoud');
  druk('werk.deel.fx');
  druk('layer.grid.loops'); await microtaak();
  ok('in FX een ander mapje (loops): het deel blijft FX', werk.deel === 'fx' && lagen.stand.grid === 'loops');
  druk('werk.deel.mix');
  ok('MIX: hotcues', lagen.stand.grid === 'hotcues');
  druk('werk.deel.fx');
  ok('FX → ander mapje → MIX → FX geeft het andere mapje terug (loops)', werk.deel === 'fx' && lagen.stand.grid === 'loops' && lagen.stand.device === 'rack');
  druk('werk.deel.stems'); await microtaak();
  shift(true); mapping.handle(note(83, true)); klok += 50; mapping.handle(note(83, false)); shift(false); await microtaak();   // ⇧ scene 2 = patronen
  ok('volgt vanuit STEMS naar patronen = SPELEN', werk.deel === 'spelen');
  druk('werk.deel.stems');
  ok('… en terug naar STEMS onthoudt stems (niet patronen: wat er vóór jouw druk stond)', lagen.stand.grid === 'stems');

  console.log('\nTHUIS');
  for (const n of ['fx', 'stems', 'uitlijn', 'beeld', 'spelen', 'bladeren', 'secties']) {
    druk(`werk.deel.${n}`);
    lagen.druk('grid', 'loops', true);                     // een kiesknop vast (gluren)
    spion.length = 0;
    druk('werk.thuis');
    ok(`THUIS vanuit ${n}: deel MIX, hotcues/strip, 0 andere invokes`, werk.deel === 'mix' && lagen.stand.grid === 'hotcues' && lagen.stand.device === 'strip'
      && buiten(spion).length === 0 && !lagen.ingedrukt.grid);
  }
  bus.invoke('layer.edit.toggle', true); bus.invoke('layer.edit.toggle', false);
  ok('(grid-modus aan)', lagen.stand.edit === 'aan');
  druk('werk.deel.fx');
  spion.length = 0;
  shift(true); mapping.handle(note(80, true)); mapping.handle(note(80, false)); shift(false);
  ok('⇧ master-knop = THUIS via het stuk basis (ook de grid-modus uit)', werk.deel === 'mix' && lagen.stand.edit === 'uit' && lagen.stand.grid === 'hotcues'
    && spion[0][0] === 'werk.thuis' && buiten(spion).length === 0);
  ok('… door "⇧ master-knop: THUIS · APC"', /APC$/.test(werk.door));
  druk('werk.deel.fx'); druk('layer.grid.loops'); druk('werk.thuis'); druk('werk.deel.fx');
  ok('na THUIS is het onthouden weg: FX = de fx-matrix', lagen.stand.grid === 'fx');
  druk('werk.thuis');

  console.log('\nvereist / terugval');
  let maschineEr = true;
  const mz = [];
  const afMaschine = registreerApparaat('maschine-mk2', { naam: 'Maschine', aanwezig: () => maschineEr, mapjes: () => ({ pads: 'transport' }), zetMapjes: (d) => { mz.push(d); return { gezet: [], niet: [] }; } });
  meldingen.length = 0;
  await werk.kies('twee-handen');
  ok('twee-handen met de (nep-)Maschine erbij', werk.naam === 'twee-handen' && werk.deel === 'mix' && werk.terug === null);
  ok('… de Maschine krijgt de mapjes van MIX', mz.at(-1)?.pads === 'transport' && mz.at(-1)?.pagina === 'strip');
  ok('… ▲ ▼ van de werkruimte (geen sampler/secties/patronen/auto)', !GROEPEN.grid.volgorde.includes('sampler') && GROEPEN.grid.volgorde[0] === 'hotcues');
  ok('… en mijn dub met ⇧ Device ◀', mapping.rules.get('note:0:58#shift')?.action === 'layer.device.mijndub' && bus.has('layer.device.mijndub'));
  druk('werk.deel.bladeren');
  meldingen.length = 0;
  maschineEr = false;
  werk.controleerAanwezig();
  await microtaak(); await microtaak();
  ok('nep-Maschine weg: apc-alleen', werk.naam === 'apc-alleen' && werk.terug?.naam === 'twee-handen');
  ok(`… met één melding (${meldingen.length})`, meldingen.length === 1 && /Maschine is weg/.test(meldingen[0].tekst));
  ok('… mijn dub en de volgorde van twee-handen zijn weg', !bus.has('layer.device.mijndub') && GROEPEN.grid.volgorde.includes('sampler') && !mapping.rules.has('note:0:58#shift'));
  werk.controleerAanwezig();
  ok('nog eens kijken: geen tweede melding', meldingen.length === 1);
  meldingen.length = 0;
  maschineEr = true;
  werk.controleerAanwezig();
  ok('Maschine terug: NIET vanzelf terug', werk.naam === 'apc-alleen');
  ok('… wel één melding met een knop', meldingen.length === 1 && meldingen[0].knop?.tekst === 'terug naar twee-handen' && werk.stand().terug.mag === true);
  await meldingen[0].knop.doe();
  ok('… de knop zet twee-handen terug', werk.naam === 'twee-handen' && werk.terug === null);
  maschineEr = false;
  meldingen.length = 0;
  const tijdensTerugval = [];
  const afT = werk.on('change', (st) => tijdensTerugval.push([st.naam, !!werk.terug]));
  await werk.kies('twee-handen');
  afT();
  ok('twee-handen kiezen zonder Maschine: apc-alleen, één melding', werk.naam === 'apc-alleen' && meldingen.length === 1 && /er niet/.test(meldingen[0].tekst));
  ok('… elke change van de terugval zegt al dat het een terugval is (dan onthoudt de mixer twee-handen, niet apc-alleen)',
    tijdensTerugval.length > 0 && tijdensTerugval.every(([n, t]) => n !== 'apc-alleen' || t));
  {
    // Valt de Maschine weg TERWIJL er geladen wordt (kies wacht op de stukken), dan kijkt hij erna
    // alsnog (review ronde 1: vroeger pas bij het volgende 'state'-event).
    maschineEr = true;
    await werk.kies('twee-handen');
    const echteStuk = werk.haalStuk;
    let open; const poort = new Promise((z) => { open = z; });
    werk.haalStuk = async (n) => { await poort; return echteStuk(n); };
    const p = werk.kies('twee-handen');
    await microtaak();
    meldingen.length = 0;
    maschineEr = false;
    werk.controleerAanwezig();
    const tijdens = werk.naam === 'twee-handen' && !werk.terug;
    open(); await p;
    for (let i = 0; i < 6; i++) await microtaak();
    werk.haalStuk = echteStuk;
    ok('Maschine weg tijdens het laden: eerst niets (bezig), daarna alsnog apc-alleen met één melding', tijdens
      && werk.naam === 'apc-alleen' && werk.terug?.naam === 'twee-handen' && meldingen.filter((m) => / weg|er niet/.test(m.tekst)).length === 1 && meldingen.some((m) => /Maschine is weg/.test(m.tekst)));
  }
  afMaschine();
  maschineEr = true;

  console.log('\nvastleggen');
  await werk.kies('apc-alleen');
  druk('werk.deel.fx');
  druk('layer.grid.loops'); await microtaak();
  rijOpen.set('koptelefoon', true);
  bewaard.length = 0; meldingen.length = 0;
  nuMs = 10000; druk('werk.vastleggen'); await microtaak();
  ok('eerste druk: een vraag, niets bewaard', bewaard.length === 0 && /nog eens binnen 3 s: leg vast in FX/.test(meldingen.at(-1)?.tekst));
  nuMs = 14000; druk('werk.vastleggen'); await microtaak();
  ok('na 4 s telt het als een nieuwe eerste druk', bewaard.length === 0);
  nuMs = 15500; druk('werk.vastleggen'); await microtaak(); await microtaak();
  const b = bewaard[0];
  ok('tweede druk binnen 3 s: bewaard met de versie van wat er stond', b && b.naam === 'apc-alleen' && b.versie === 'v-apc-alleen');
  ok('… FX = grid loops, device rack, en de open rijen (master, koptelefoon)', b && b.ruw.delen.fx.apc40mk2.grid === 'loops' && b.ruw.delen.fx.apc40mk2.device === 'rack'
    && b.ruw.delen.fx.schermen.hoofd.rijen.join() === 'koptelefoon,master');
  ok('… de andere delen niet aangeraakt', JSON.stringify(b?.ruw.delen.stems) === JSON.stringify(lees('tools/werkruimtes/voorbeelden/apc-alleen.json').delen.stems));
  ok('… werk.versie is de nieuwe', werk.versie === 'v1' && werk.bron === 'eigen');
  rijOpen.set('koptelefoon', false);
  {
    // Een conditie blijft een conditie (review ronde 1): SPELEN device = { als: focus.instrument, … }.
    focusInstrument = false;
    druk('werk.deel.spelen');
    nuMs = 20000; druk('werk.vastleggen'); await microtaak();
    nuMs = 20500; druk('werk.vastleggen'); await microtaak(); await microtaak();
    const c = bewaard.at(-1)?.ruw.delen.spelen.apc40mk2;
    ok('vastleggen in SPELEN zonder iets te veranderen: device blijft de conditie (niet de letterlijke strip)', bewaard.length === 2
      && c?.device?.als === 'focus.instrument' && c.device.dan === 'inst' && c.device.anders === 'strip' && c.grid === 'patronen');
    druk('layer.device.view'); await microtaak();   // Clip/Device View: strip → rack
    nuMs = 30000; druk('werk.vastleggen'); await microtaak();
    nuMs = 30500; druk('werk.vastleggen'); await microtaak(); await microtaak();
    ok('… opende je zelf een ander mapje (rack), dan wordt dat het deel', bewaard.length === 3 && bewaard.at(-1).ruw.delen.spelen.apc40mk2.device === 'rack');
  }

  console.log('\npeilen (een bestand dat Claude schrijft)');
  {
    const ruw = lees('tools/werkruimtes/voorbeelden/apc-alleen.json');
    ruw.delen.stems.label = 'STAM';
    druk('werk.deel.stems');
    eigen.set('apc-alleen', { werkruimte: ruw, versie: 'claude-1', bron: 'eigen' });
    spion.length = 0;
    const r = await werk.peil();
    ok('peil: nieuwe versie = opnieuw opgezet, het deel blijft STEMS', r === true && werk.versie === 'claude-1' && werk.deel === 'stems' && werk.deelDef().label === 'STAM');
    ok('… 0 invokes buiten layer.*/werk.*', buiten(spion).length === 0);
    ok('peil: dezelfde versie = niets', (await werk.peil()) === false);
    // Een mapje dat je binnen het deel met de hand opende, blijft bij een herlaad open zolang het deel
    // zelf niet veranderde (review ronde 1); verandert het deel voor de APC, dan geldt het nieuwe.
    druk('werk.deel.mix'); druk('layer.grid.loops'); await microtaak();
    const ruw2 = JSON.parse(JSON.stringify(ruw)); ruw2.delen.stems.label = 'STEM';
    eigen.set('apc-alleen', { werkruimte: ruw2, versie: 'claude-2', bron: 'eigen' });
    await werk.peil();
    ok('peil, MIX zelf ongewijzigd: loops (met de hand geopend) blijft open', werk.versie === 'claude-2' && werk.deel === 'mix' && lagen.stand.grid === 'loops');
    const ruw3 = JSON.parse(JSON.stringify(ruw2)); ruw3.delen.mix.apc40mk2.grid = 'sampler';
    eigen.set('apc-alleen', { werkruimte: ruw3, versie: 'claude-3', bron: 'eigen' });
    await werk.peil();
    ok('peil, MIX kreeg grid sampler: de APC volgt het nieuwe deel', werk.versie === 'claude-3' && werk.deel === 'mix' && lagen.stand.grid === 'sampler');
    eigen.delete('apc-alleen');
    druk('werk.deel.stems');
  }
  {
    // De haler: ETag en 304 (zoals de mixer elke 3 s vraagt).
    const vragen = [];
    const nep = async (url, o) => { vragen.push(o.headers); return o.headers['If-None-Match'] === '"x"' ? { status: 304, ok: false, json: async () => null } : { status: 200, ok: true, headers: { get: () => '"x"' }, json: async () => ({ ruw: { schema: 1, naam: 'a' }, versie: 'v' }) }; };
    const h = maakHaler({ fetch: nep });
    const a = await h('a'); const bb = await h('a', { peil: true });
    ok('maakHaler: eerst gewoon, peilen met If-None-Match, 304 = niets', a.versie === 'v' && bb.niets === true && vragen[1]['If-None-Match'] === '"x"');
  }

  console.log('\nherladen houdt je indeling (review ronde 2)');
  {
    // Een herlaad (peil, de peil na een 409, een terugval) haalt de mapjes van de werkruimte weg en zet
    // ze terug. Vroeger zette haalMapjeWeg een open mapje (grid.fx, device.uitlijn uit een stuk) naar
    // de standaard, de adapter meldde dat als jouw keuze (volgt), en het deel sprong naar MIX.
    const vb = () => lees('tools/werkruimtes/voorbeelden/apc-alleen.json');
    const volgtWissels = [];
    const afV = werk.on('change', (st) => { if (/volgt/.test(st.door ?? '')) volgtWissels.push(st.deel); });
    let r2 = 0;
    const nieuweVersie = (pas) => { const ruw = vb(); pas(ruw); eigen.set('apc-alleen', { werkruimte: ruw, versie: `r2-${++r2}`, bron: 'eigen' }); };
    const stand = () => `deel ${werk.deel} grid ${lagen.stand.grid} device ${lagen.stand.device}`;
    eigen.delete('apc-alleen');
    await werk.kies('apc-alleen');
    druk('werk.deel.fx'); await microtaak();
    const voorFx = stand();
    nieuweVersie((ruw) => { ruw.delen.beeld.label = 'BLD'; });
    spion.length = 0;
    await werk.peil(); await microtaak(); await microtaak();
    ok(`deel FX (grid fx uit het stuk fx-matrix), peil met een wijziging in BEELD: ${voorFx} → ${stand()}, ${volgtWissels.length} change door volgt`,
      werk.versie === 'r2-1' && stand() === voorFx && voorFx === 'deel fx grid fx device rack' && volgtWissels.length === 0);
    ok('… 0 invokes buiten layer.*/werk.*', buiten(spion).length === 0);
    druk('werk.deel.uitlijn'); await microtaak();
    const voorUit = stand();
    nieuweVersie((ruw) => { ruw.delen.beeld.label = 'BLD2'; });
    await werk.peil(); await microtaak(); await microtaak();
    ok(`deel UITLIJN (device uitlijn uit het stuk uitlijn): ${voorUit} → ${stand()}, 0 volgt`, stand() === voorUit && lagen.stand.device === 'uitlijn' && volgtWissels.length === 0);
    // Met de hand een ander mapje binnen FX, dan een herlaad: blijft open, ook als het mapje van het deel (fx) weg en terug moest.
    druk('werk.deel.fx'); druk('layer.grid.loops'); await microtaak();
    nieuweVersie((ruw) => { ruw.delen.beeld.label = 'BLD3'; });
    await werk.peil(); await microtaak();
    ok('in FX met de hand loops geopend, peil: loops blijft open, deel FX', stand() === 'deel fx grid loops device rack' && volgtWissels.length === 0);
    // Onthouden overleeft een herlaad voor de delen die niet veranderden.
    druk('werk.deel.mix'); await microtaak();
    nieuweVersie((ruw) => { ruw.delen.beeld.label = 'BLD4'; });
    await werk.peil(); await microtaak();
    druk('werk.deel.fx');
    ok('FX → loops → MIX → peil → FX: loops terug (onthoud blijft voor een deel dat niet veranderde)', stand() === 'deel fx grid loops device rack');
    // De peil na een 409 bij vastleggen (forceer) doet hetzelfde.
    druk('layer.grid.fx'); await microtaak();
    const echteBewaar = werk.bewaar;
    werk.bewaar = async () => ({ ok: false, status: 409 });
    nieuweVersie((ruw) => { ruw.delen.beeld.label = 'BLD5'; });
    nuMs = 50000; druk('werk.vastleggen'); await microtaak();
    nuMs = 50500; druk('werk.vastleggen');
    for (let i = 0; i < 6; i++) await microtaak();
    werk.bewaar = echteBewaar;
    ok(`vastleggen geeft 409, de peil({ forceer }) erna: ${stand()}, versie ${werk.versie}`, werk.versie === 'r2-5' && stand() === 'deel fx grid fx device rack' && volgtWissels.length === 0);
    // Verandert het deel zelf voor de APC, dan geldt het nieuwe (zoals in ronde 1).
    nieuweVersie((ruw) => { ruw.delen.fx.apc40mk2.grid = 'sampler'; });
    await werk.peil(); await microtaak();
    ok('peil, FX kreeg grid sampler: de APC volgt het nieuwe deel', stand() === 'deel fx grid sampler device rack');

    // twee-handen: de eigen dub op ⇧ Device ◀ (een mapje van de werkruimte zelf).
    let er = true;
    const afM = registreerApparaat('maschine-mk2', { naam: 'Maschine', aanwezig: () => er, mapjes: () => ({ pads: 'transport' }), zetMapjes: () => ({ gezet: [], niet: [] }) });
    eigen.delete('apc-alleen');
    await werk.kies('twee-handen');
    shift(true); mapping.handle(note(58, true)); klok += 50; mapping.handle(note(58, false)); shift(false); await microtaak();
    const voorDub = stand();
    const ruwT = lees('tools/werkruimtes/voorbeelden/twee-handen.json'); ruwT.delen.beeld.label = 'BLD';
    eigen.set('twee-handen', { werkruimte: ruwT, versie: 'th-1', bron: 'eigen' });
    await werk.peil(); await microtaak(); await microtaak();
    ok(`twee-handen, ⇧ Device ◀ (mijn dub) open, peil: ${voorDub} → ${stand()}`, voorDub === 'deel mix grid hotcues device mijndub' && stand() === voorDub && werk.versie === 'th-1');
    eigen.delete('twee-handen');
    // Een terugval (de Maschine valt weg) laat het mapje op de APC staan als de terugval dat deel ook heeft.
    await werk.kies('twee-handen');
    druk('werk.deel.stems'); await microtaak();
    meldingen.length = 0;
    er = false;
    werk.controleerAanwezig();
    for (let i = 0; i < 6; i++) await microtaak();
    ok(`twee-handen in STEMS, Maschine weg: apc-alleen, ${stand()} (niet terug naar hotcues/strip)`, werk.naam === 'apc-alleen' && stand() === 'deel stems grid stems device strip'
      && meldingen.length === 1 && volgtWissels.length === 0);
    afM();
    afV();
    eigen.delete('apc-alleen');
    await werk.kies('apc-alleen');
  }

  console.log('\nhet werkvak en peilen (review ronde 2)');
  {
    // Het event 'werkruimte' gaat in het volgende beeld (plan), nooit in het MIDI-bericht van de wissel.
    const rij = [];
    werk.plan = (fn) => rij.push(fn);
    const n0 = werkvak.length;
    druk('werk.deel.stems'); druk('werk.deel.fx');
    ok('twee deelwissels in één beeld: nog geen event (het staat in plan)', werkvak.length === n0);
    for (const f of rij.splice(0)) f();
    ok(`… in het beeld: één event, voor het laatste deel (${werkvak.length - n0}, ${werkvak.at(-1)?.deel})`, werkvak.length === n0 + 1 && werkvak.at(-1).deel === 'fx');
    werk.plan = (fn) => fn();
    // Nooit twee peilverzoeken tegelijk, en een antwoord dat na een andere keuze komt telt niet.
    const echteHaal = werk.haal;
    let los = null, gevraagd = 0;
    werk.haal = (n, o) => (o?.peil ? (gevraagd++, new Promise((z) => { los = z; })) : echteHaal(n, o));
    const p1 = werk.peil();
    const p2 = await werk.peil();
    ok(`een peil die blijft hangen: de volgende start geen tweede verzoek (${gevraagd})`, p2 === false && gevraagd === 1);
    await werk.kies('twee-handen');
    const ruwX = lees('tools/werkruimtes/voorbeelden/apc-alleen.json'); ruwX.delen.mix.label = 'X';
    los({ werkruimte: ruwX, versie: 'laat', bron: 'eigen' });
    ok('… komt het antwoord pas na een andere keuze (twee-handen), dan telt het niet', (await p1) === false && werk.versie !== 'laat');
    werk.haal = echteHaal;
    await werk.kies('apc-alleen');
    druk('werk.deel.stems');
  }

  console.log('\nnieuw (A11)');
  ok(`apc-alleen telt ${werk.nieuw.aantal} nieuwe plekken tegen de standaard (> 0)`, werk.nieuw.aantal > 0);
  werk.gezien();
  ok('gezien: daarna 0', werk.nieuw.aantal === 0 && werk.basislijn.lees('apc-alleen'));
  await werk.kies('apc-alleen');
  ok('… ook na opnieuw kiezen', werk.nieuw.aantal === 0);
  ok('plekkenVan is JSON (voor localStorage)', JSON.parse(JSON.stringify(plekkenVan(werk.samenstelling))).apparaten.apc40mk2.fragmenten.length > 0);

  console.log('\nopstarten (kiesStart in de aanhaker)');
  {
    const { kiesStart, SLEUTEL, STAND_SLEUTEL } = await import('../src/ui/aanhakers/werk.js');
    const opsl = new Map();
    const l = (k) => opsl.get(k) ?? null;
    ok('niets onthouden: standaard', kiesStart({ lees: l }).naam === 'standaard');
    ok('?werk=apc-alleen gaat voor, en wordt onthouden', (() => { const k = kiesStart({ url: 'http://x/?werk=apc-alleen', lees: l }); return k.naam === 'apc-alleen' && k.onthoud[SLEUTEL] === 'apc-alleen'; })());
    ok('?werk=Fout (hoofdletter) telt niet', kiesStart({ url: 'http://x/?werk=Fout', lees: l }).naam === 'standaard');
    opsl.set(SLEUTEL, 'twee-handen');
    ok('onthouden: twee-handen', kiesStart({ lees: l }).naam === 'twee-handen');
    const k = kiesStart({ stand: { naam: 'apc-alleen', sinds: '2026-10-14T10:00:00Z' }, lees: l });
    ok('een stand die net geactiveerd is gaat voor wat onthouden was (één keer)', k.naam === 'apc-alleen' && k.onthoud[STAND_SLEUTEL] === '2026-10-14T10:00:00Z');
    for (const [a, b] of Object.entries(k.onthoud)) opsl.set(a, b);
    opsl.set(SLEUTEL, 'twee-handen');
    ok('… daarna niet meer: wat je zelf koos wint weer', kiesStart({ stand: { naam: 'apc-alleen', sinds: '2026-10-14T10:00:00Z' }, lees: l }).naam === 'twee-handen');
  }

  console.log('\nwerk.kies en terug naar standaard');
  bus.invoke('werk.kies', 0);
  await microtaak(); await microtaak(); await microtaak();
  ok('werk.kies 0 = standaard: alles weg, de mapping weer precies die van vandaag', werk.naam === 'standaard' && mapping.rules.size === regelsVandaag.size
    && [...regelsVandaag].every(([k, a]) => mapping.rules.get(k)?.action === a) && !bus.has('layer.grid.fx') && !GROEPEN.grid.knoppen.fx);
  ok('… werk.deel.fx bestaat nog en leest null', bus.has('werk.deel.fx') && bus.read('werk.deel.fx') === null);
  ok('… werk.kies leest 0', bus.read('werk.kies') === 0);
  ok('THUIS werkt ook in standaard (de standaardmapjes)', (druk('layer.grid.loops'), druk('werk.thuis'), lagen.stand.grid === 'hotcues'));
} catch (err) {
  fails.push(String(err?.stack || err));
  console.log(err);
}

console.log(fails.length ? `\n${fails.length} FOUT` : '\nalles groen');
process.exit(fails.length ? 1 : 0);
