// Het vrije paneel (src/paneel/vrij.js), de kaart (src/paneel/kaart.js) en het aanmelden bij de
// renderloop (renderloop.js), op een nep-DOM (werkruimte S7, docs/werkruimte/S7.md):
//   - items uit `panelen` (draai, knop, schuif, lamp, xy, rij met herhaal en {k}, tekst);
//   - labels uit de bron (beschrijf), kleur uit soorten.js, {focus} via resolveTarget, `doel`;
//   - een onbekende action grijs met één melding;
//   - volgen: alleen schrijven wat verandert;
//   - indrukken leest de action, loslaten gaat naar DEZELFDE (ook na een focus- of deelwissel),
//     per pointerId (twee vingers);
//   - zonder invoke (de iPad, W1): kijken, nooit iets sturen;
//   - badge per item en paneel, en 300 ms oplichten;
//   - in de mixer: de gewone controls (.knob, input range, data-kind=button) met hun data-action;
//   - de kaart: per apparaat de regels van het open mapje;
//   - renderloop.meldAan: aanmelden en weer weg (geen Knob blijft achter).
// Draai met: node test/vrij-paneel.test.mjs
const { VrijPaneel, varsVoor, vul, OPLICHT_MS, BOUWSTENEN, bouwsteenVan, bouwsteenDef, metRuw } = await import('../src/paneel/vrij.js');
const { kaartVan, KaartWeergave, MAX_KNOPPEN } = await import('../src/paneel/kaart.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// ---- een nep-DOM: elementen, classList, dataset, style, events, closest -----------------------
function maakDoc() {
  const doc = { defaultView: { performance: { now: () => 0 } }, schrijf: 0 };
  doc.createElement = (tag) => {
    const klassen = new Set();
    const style = new Proxy({}, { set(o, k, v) { if (o[k] !== v) doc.schrijf++; o[k] = v; return true; } });
    const e = {
      tagName: tag.toUpperCase(), ownerDocument: doc, dataset: {}, style, children: [], parent: null, hidden: false, title: '', luister: {},
      _tekst: '',
      get textContent() { return this._tekst; }, set textContent(t) { doc.schrijf++; this._tekst = String(t); },
      get className() { return [...klassen].join(' '); }, set className(c) { klassen.clear(); String(c).split(/\s+/).filter(Boolean).forEach((k) => klassen.add(k)); },
      classList: {
        add: (...k) => { k.forEach((x) => klassen.add(x)); doc.schrijf++; }, remove: (...k) => { k.forEach((x) => klassen.delete(x)); doc.schrijf++; },
        contains: (k) => klassen.has(k), toggle: (k, aan) => { const zet = aan ?? !klassen.has(k); if (zet) klassen.add(k); else klassen.delete(k); doc.schrijf++; return zet; },
      },
      appendChild(k) { if (k.parent) k.remove(); k.parent = e; e.children.push(k); return k; },
      replaceChildren() { e.children.forEach((k) => { k.parent = null; }); e.children = []; },
      remove() { if (e.parent) { e.parent.children = e.parent.children.filter((x) => x !== e); e.parent = null; } },
      addEventListener(n, f) { (e.luister[n] ||= []).push(f); }, removeEventListener(n, f) { e.luister[n] = (e.luister[n] || []).filter((x) => x !== f); },
      closest(sel) { const k = sel.replace('.', ''); let x = e; while (x) { if (x.classList.contains(k)) return x; x = x.parent; } return null; },
      querySelectorAll(sel) { const k = sel.replace('.', ''); const uit = []; const loop = (x) => { for (const c of x.children) { if (c.classList.contains(k)) uit.push(c); loop(c); } }; loop(e); return uit; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      setPointerCapture() {},
    };
    return e;
  };
  return doc;
}
/** Een pointer-event op het paneel (het paneel luistert op zijn root; target = het element). */
const vuur = (paneel, naam, target, extra = {}) => { for (const f of paneel.root.luister[naam] ?? []) f({ target, pointerId: 1, button: 0, clientX: 0, clientY: 0, preventDefault() {}, ...extra }); };

/** Een bron zoals de bus (de opener) of de server hem geeft. */
function maakBron({ kijkt = false } = {}) {
  const b = {
    waarden: { 'track.1.filter': 0.5, 'track.2.filter': 0.2, 'track.1.kill.low': 0, 'track.1.kill.high.hold': 0, 'track.2.kill.high.hold': 0, 'track.1.fader': 1,
      'track.1.sync': 0.5, 'video.fx.pixel.hold': 0, 'video.fx.rgb.hold': 0, 'track.1.fx.knob.1': 0.3, 'track.1.fx.knob.2': 0.7, 'track.3.filter': 0.5 },
    types: { 'track.1.filter': 'value', 'track.2.filter': 'value', 'track.3.filter': 'value', 'track.1.fader': 'value', 'track.1.fx.knob.1': 'value', 'track.1.fx.knob.2': 'value' },
    vars0: { focus: '1', maatgever: '3', tweede: '2' },
    invokes: [], meldingen: [], geraakt0: {}, badge0: { 'track.1.filter': ['APC track knob 1'], 'track.1.fader': ['APC fader 1', 'Maschine draaiknop 1'] }, t: 0,
    read(id) { return id in b.waarden ? b.waarden[id] : null; },
    metaOf(id) { return id in b.waarden ? { type: b.types[id] ?? 'trigger', label: `L:${id}` } : null; },
    label(id) { return id === 'track.1.filter' ? 'filter' : null; },
    vars() { return b.vars0; },
    badges(id) { return b.badge0[id] ?? []; },
    geraakt(id) { return b.geraakt0[id] ?? 0; },
    nu() { return b.t; },
    meld(t) { b.meldingen.push(t); },
  };
  if (!kijkt) b.invoke = (id, v) => { b.invokes.push([id, v]); if (typeof v === 'number') b.waarden[id] = v; };
  return b;
}

const DEF = { titel: 'MIJN', items: [
  { soort: 'draai', action: 'track.{focus}.filter' },
  { soort: 'knop', action: 'track.1.kill.low' },
  { soort: 'knop', action: 'track.{focus}.kill.high.hold', label: 'HOOG' },
  { soort: 'schuif', action: 'track.1.fader' },
  { soort: 'lamp', action: 'track.1.sync' },
  { soort: 'xy', action: 'track.1.fx.knob.{as}' },
  { soort: 'rij', herhaal: ['pixel', 'rgb'], item: { soort: 'knop', action: 'video.fx.{k}.hold' } },
  { soort: 'tekst', tekst: 'zomaar tekst' },
  { soort: 'draai', action: 'bestaat.niet' },
  { soort: 'draai', action: 'bestaat.niet' },
] };

console.log('bouwen en volgen (modus los: werk.html)');
{
  const doc = maakDoc();
  const bron = maakBron();
  const p = new VrijPaneel(doc.createElement('div'), DEF, bron, { id: 'mijn' });
  ok('de items: rij uitgevouwen (10 + 1)', p.items.length === 11 && p.items.map((i) => i.soort).join() === 'draai,knop,knop,schuif,lamp,xy,knop,knop,tekst,draai,draai');
  ok('{focus} ingevuld via resolveTarget', p.items[0].action === 'track.1.filter' && p.items[2].action === 'track.1.kill.high.hold');
  ok('{k} in een rij', p.items[6].action === 'video.fx.pixel.hold' && p.items[7].action === 'video.fx.rgb.hold');
  ok('xy: twee actions ({as} = 1 en 2)', p.items[5].actions.join() === 'track.1.fx.knob.1,track.1.fx.knob.2');
  ok('label: eigen label > beschrijf (bron.label) > meta.label', p.items[2].labelEl.textContent === 'HOOG' && p.items[0].labelEl.textContent === 'filter' && p.items[1].labelEl.textContent === 'L:track.1.kill.low');
  ok('kleur uit soorten.js (s-<soort>)', p.items[0].el.classList.contains('s-mixer') && p.items[1].el.classList.contains('s-klank') && p.items[6].el.classList.contains('s-video'));
  ok('een onbekende action: grijs', p.items[9].el.classList.contains('vp-grijs') && p.items[10].el.classList.contains('vp-grijs') && !p.items[0].el.classList.contains('vp-grijs'));
  ok('… met ÉÉN melding (twee items met dezelfde action)', bron.meldingen.length === 1 && bron.meldingen[0].includes('bestaat.niet'));
  p.teken(0);
  const voor = p.items[0].ind.style.transform;
  ok('draai volgt read (0,5 = recht omhoog)', voor === 'rotate(0deg)');
  ok('lamp: 0,5 = gedimd, niet aan', p.items[4].el.classList.contains('vp-half') && !p.items[4].el.classList.contains('vp-aan'));
  const s0 = doc.schrijf;
  p.teken(1); p.teken(2);
  ok('niets veranderd: niets geschreven', doc.schrijf === s0);
  bron.waarden['track.1.filter'] = 1;
  p.teken(3);
  ok('read verandert: de wijzer volgt', p.items[0].ind.style.transform === 'rotate(140deg)' && doc.schrijf > s0);
  bron.waarden['track.1.fader'] = 0.25;
  p.teken(4);
  ok('schuif volgt (scaleX)', p.items[3].vul.style.transform === 'scaleX(0.250)');
  ok('xy volgt (twee reads)', p.items[5].punt.style.transform === 'translate(30.0%, 30.0%)');
  ok('badge per item en per paneel (per apparaat)', p.items[0].badgeEl.textContent === 'APC track knob 1' && p.items[3].badgeEl.textContent === 'APC fader 1 · Maschine draaiknop 1'
    && p._badge.textContent.includes('APC') && p._badge.textContent.includes('Maschine'));
  bron.geraakt0['track.1.filter'] = 100; bron.t = 150;
  p.teken();
  ok('oplichten: aangeraakt (bron.nu, de klok van de mixer)', p.items[0].el.classList.contains('vp-geraakt'));
  bron.t = 100 + OPLICHT_MS + 1;
  p.teken();
  ok(`… en na ${OPLICHT_MS} ms weer uit`, !p.items[0].el.classList.contains('vp-geraakt'));
  bron.vars0 = { focus: '2' };
  p.teken();
  ok('een andere focus: de actions volgen', p.items[0].action === 'track.2.filter' && p.items[2].action === 'track.2.kill.high.hold');
  ok('doel = maatgever: {focus} wordt de maatgever', varsVoor({ focus: '1', maatgever: '3' }, 'maatgever').focus === '3' && varsVoor({ focus: '1' }, 'maatgever').focus === '1');
  ok('vul: een {…} die niet in te vullen is = null (grijs)', vul('track.{speel}.inst', { focus: '1' }) === null && vul('track.{focus}.x', { focus: '4' }) === 'track.4.x');
}

console.log('\nindrukken en loslaten (per vinger, dezelfde action)');
{
  const doc = maakDoc();
  const bron = maakBron();
  const p = new VrijPaneel(doc.createElement('div'), DEF, bron, { id: 'mijn' });
  const hoog = p.items[2], laag = p.items[1];
  vuur(p, 'pointerdown', hoog.ctl, { pointerId: 7 });
  ok('indrukken: de action van NU (track.1.kill.high.hold, true)', JSON.stringify(bron.invokes.at(-1)) === '["track.1.kill.high.hold",true]');
  bron.vars0 = { focus: '2' };
  p.teken();
  ok('intussen een andere focus (en dus een andere action op de knop)', hoog.action === 'track.2.kill.high.hold');
  vuur(p, 'pointerdown', laag.ctl, { pointerId: 8 });
  vuur(p, 'pointerup', hoog.ctl, { pointerId: 7 });
  ok('loslaten: naar DEZELFDE action als het indrukken (track 1)', JSON.stringify(bron.invokes.at(-1)) === '["track.1.kill.high.hold",false]');
  ok('een tweede vinger tegelijk op een andere knop: die blijft vast', JSON.stringify(bron.invokes.at(-2)) === '["track.1.kill.low",true]' && p._vast.has(8));
  vuur(p, 'pointercancel', laag.ctl, { pointerId: 8 });
  ok('… en laat los naar de zijne (ook bij pointercancel)', JSON.stringify(bron.invokes.at(-1)) === '["track.1.kill.low",false]' && p._vast.size === 0);
  vuur(p, 'lostpointercapture', laag.ctl, { pointerId: 8 });
  ok('nog eens loslaten: niets dubbel', bron.invokes.filter(([a, v]) => a === 'track.1.kill.low' && v === false).length === 1);
  // Draaien en schuiven.
  bron.vars0 = { focus: '1' }; p.teken();
  bron.waarden['track.1.filter'] = 0.5;
  vuur(p, 'pointerdown', p.items[0].dial, { pointerId: 3, clientY: 200 });
  vuur(p, 'pointermove', p.items[0].dial, { pointerId: 3, clientY: 180 });
  vuur(p, 'pointermove', p.items[0].dial, { pointerId: 3, clientY: 160 });
  const voorBeeld = bron.invokes.length;
  p.teken();
  ok('waarden gebundeld: twee bewegingen in één beeld = één invoke (de laatste)', bron.invokes.length === voorBeeld + 1);
  ok('draaien: omhoog slepen = groter (160 px = de hele knop)', bron.invokes.at(-1)[0] === 'track.1.filter' && Math.abs(bron.invokes.at(-1)[1] - 0.75) < 1e-9);
  vuur(p, 'pointerup', p.items[0].dial, { pointerId: 3 });
  vuur(p, 'pointerdown', p.items[3].baan, { pointerId: 4, clientX: 40 });
  p.teken();
  ok('schuif: de plek in de baan', JSON.stringify(bron.invokes.at(-1)) === '["track.1.fader",0.4]');
  vuur(p, 'pointerup', p.items[3].baan, { pointerId: 4 });
  vuur(p, 'pointerdown', p.items[5].vlak, { pointerId: 5, clientX: 20, clientY: 10 });
  p.teken();
  ok('xy: x en y naar hun eigen action', JSON.stringify(bron.invokes.slice(-2)) === '[["track.1.fx.knob.1",0.2],["track.1.fx.knob.2",0.9]]');
  vuur(p, 'pointerup', p.items[5].vlak, { pointerId: 5 });
  const n = bron.invokes.length;
  vuur(p, 'pointerdown', p.items[9].dial, { pointerId: 6 });
  vuur(p, 'pointerdown', p.items[4].lamp, { pointerId: 9 });
  ok('een grijs item en een lamp: niets', bron.invokes.length === n);
  vuur(p, 'pointerdown', hoog.ctl, { pointerId: 11 });
  p.vernietig();
  ok('vernietig met een knop vast: laat los naar zijn action', JSON.stringify(bron.invokes.at(-1)) === '["track.1.kill.high.hold",false]');
}

console.log('\nde iPad: alleen kijken (W1)');
{
  const doc = maakDoc();
  const bron = maakBron({ kijkt: true });
  const p = new VrijPaneel(doc.createElement('div'), DEF, bron, { id: 'mijn' });
  ok('zonder invoke: het paneel kijkt (klasse vp-kijkt)', p.kijkt && p.root.classList.contains('vp-kijkt'));
  vuur(p, 'pointerdown', p.items[1].ctl);
  vuur(p, 'pointerdown', p.items[0].dial, { pointerId: 2 });
  vuur(p, 'pointermove', p.items[0].dial, { pointerId: 2, clientY: -100 });
  ok('indrukken en slepen sturen niets (er is niets om naar te sturen)', p._vast.size === 0 && !('invokes' in bron && bron.invokes.length));
  p.teken(0);
  ok('maar het volgt wel', p.items[0].ind.style.transform === 'rotate(0deg)');
}

console.log('\nin de mixer (het werkvak): de gewone controls');
{
  const doc = maakDoc();
  const bron = maakBron();
  const knobs = new Map();
  const p = new VrijPaneel(doc.createElement('div'), DEF, bron, { id: 'mijn', modus: 'mixer', knobVan: knobs });
  const draai = p.items[0].ctl, schuif = p.items[3].ctl, knop = p.items[1].ctl;
  ok('draai = .knob met data-action', draai.classList.contains('knob') && draai.dataset.action === 'track.1.filter');
  ok('schuif = input range met data-action', schuif.tagName === 'INPUT' && schuif.type === 'range' && schuif.dataset.action === 'track.1.fader');
  ok('knop = data-kind button met data-action', knop.dataset.kind === 'button' && knop.dataset.action === 'track.1.kill.low');
  const nepKnob = { action: 'track.1.filter' };
  knobs.set(draai, nepKnob);
  bron.vars0 = { focus: '3' };
  p.teken();
  ok('focus 3: data-action en de Knob (controls.js) volgen', draai.dataset.action === 'track.3.filter' && nepKnob.action === 'track.3.filter');
  const n = bron.invokes.length;
  vuur(p, 'pointerdown', knop);
  ok('de invoer van draai/schuif/knop doen de controls van de mixer zelf (het paneel niet)', bron.invokes.length === n);
  vuur(p, 'pointerdown', p.items[5].vlak, { clientX: 50, clientY: 50 });
  vuur(p, 'pointerup', p.items[5].vlak, {});
  ok('xy (geen control in de mixer): het paneel zelf', bron.invokes.length === n + 2);
}

console.log('\nde xy-pad: y, druk, los (uit de ruwe werkruimte)');
{
  const doc = maakDoc();
  const bron = maakBron();
  bron.waarden['track.1.send.a'] = 0.1; bron.types['track.1.send.a'] = 'value'; bron.waarden['track.1.fx.knob.1.hold'] = 0;
  const ruw = { items: [{ soort: 'xy', action: 'track.1.fx.knob.1', y: 'track.1.send.a', druk: 'track.1.fx.knob.1.hold', los: 'terug' }] };
  const def = metRuw({ items: [{ soort: 'xy', action: 'track.1.fx.knob.1' }] }, ruw);
  ok('metRuw: y, druk en los komen mee (het model van S3 bewaart ze niet)', def.items[0].y === 'track.1.send.a' && def.items[0].los === 'terug');
  ok('metRuw: alleen geldige waarden; een ander aantal items = niets', !metRuw({ items: [{ soort: 'xy', action: 'a' }] }, { items: [{ los: 'weg', y: 'x y' }] }).items[0].los
    && metRuw({ items: [{ soort: 'xy', action: 'a' }] }, { items: [] }).items[0].y === undefined);
  const p = new VrijPaneel(doc.createElement('div'), def, bron, { id: 'xy' });
  const it = p.items[0];
  ok('x en y uit twee eigen actions, het label uit beide', it.actions.join() === 'track.1.fx.knob.1,track.1.send.a' && it.labelEl.textContent.includes('×'));
  vuur(p, 'pointerdown', it.vlak, { pointerId: 1, clientX: 80, clientY: 20 });
  ok('aanraken = de druk-action aan', JSON.stringify(bron.invokes[0]) === '["track.1.fx.knob.1.hold",true]');
  for (let i = 0; i < 10; i++) vuur(p, 'pointermove', it.vlak, { pointerId: 1, clientX: 80 + i, clientY: 20 });
  p.teken();
  ok('tien bewegingen in één beeld: één invoke per as', bron.invokes.length === 3);
  vuur(p, 'pointermove', it.vlak, { pointerId: 1, clientX: 90, clientY: 30 });
  vuur(p, 'pointerup', it.vlak, { pointerId: 1 });
  const staart = bron.invokes.slice(-5).map(([a, v]) => `${a}=${v}`).join(' ');
  ok(`loslaten: eerst de laatste stand, dan terug naar vóór het aanraken, dan de druk los (${staart})`,
    staart === 'track.1.fx.knob.1=0.9 track.1.send.a=0.7 track.1.fx.knob.1=0.3 track.1.send.a=0.1 track.1.fx.knob.1.hold=false');
  const p2 = new VrijPaneel(doc.createElement('div'), { items: [{ soort: 'xy', action: 'track.1.fx.knob.{as}', los: 'midden' }] }, bron, { id: 'm' });
  vuur(p2, 'pointerdown', p2.items[0].vlak, { pointerId: 2, clientX: 10, clientY: 10 });
  vuur(p2, 'pointerup', p2.items[0].vlak, { pointerId: 2 });
  ok('los: midden = terugveren naar 0,5', JSON.stringify(bron.invokes.slice(-2)) === '[["track.1.fx.knob.1",0.5],["track.1.fx.knob.2",0.5]]');
  const p3 = new VrijPaneel(doc.createElement('div'), { items: [{ soort: 'xy', action: 'track.1.fx.knob.1', druk: 'track.1.fader' }] }, bron, { id: 'v' });
  const n3 = bron.invokes.length;
  vuur(p3, 'pointerdown', p3.items[0].vlak, { pointerId: 3, clientX: 10, clientY: 10 });
  vuur(p3, 'pointerup', p3.items[0].vlak, { pointerId: 3 });
  ok('druk naar een value-action (de fader): genegeerd (regel 2)', !bron.invokes.slice(n3).some(([a2]) => a2 === 'track.1.fader'));
}

console.log('\nde bouwstenen (elk onderdeel als paneel)');
{
  ok('fx, strip, mixer, stems, master, sampler', ['fx', 'strip', 'mixer', 'stems', 'master', 'sampler'].every((k) => typeof BOUWSTENEN[k] === 'function'));
  ok('bouwsteenVan: strip:3 = track 3, fx = de focus, onbekend = null', bouwsteenVan('strip:3').track === '3' && bouwsteenVan('fx').track === '{focus}' && bouwsteenVan('kaart') === null && bouwsteenVan('strip:9') === null);
  const bron = maakBron();
  const fx = bouwsteenDef('fx', { bestaat: (a) => !!bron.metaOf(a), vars: { focus: '1' } });
  ok('een bouwsteen laat weg wat niet bestaat (geen melding, geen grijs)', fx.items.length === 1 && fx.items[0].herhaal.join() === '1,2');
  const doc = maakDoc();
  const p = new VrijPaneel(doc.createElement('div'), bouwsteenDef('strip:2'), bron, { id: 'strip' });
  ok('strip:2 is een gewoon paneel op track 2', p.items.some((i) => i.action === 'track.2.filter') && p.items.every((i) => !i.action || i.action.startsWith('track.2.')));
  bron.naam = (a) => (a === 'track.1.fx.knob.1' ? 'echo' : null);
  let ls = 'a'; bron.labelSleutel = () => ls;
  const pf = new VrijPaneel(doc.createElement('div'), bouwsteenDef('fx:1'), bron, { id: 'fx' });
  pf.teken();
  ok('de naam van de plek (wat het rack erop zet) als label', pf.items[0].labelEl.textContent === 'echo');
  bron.naam = (a) => (a === 'track.1.fx.knob.1' ? 'galm' : null);
  pf.teken(); ok('… nog niet opnieuw zonder nieuwe labelSleutel', pf.items[0].labelEl.textContent === 'echo');
  ls = 'b'; pf.teken();
  ok('… wel na een ander rack (labelSleutel)', pf.items[0].labelEl.textContent === 'galm');
}

console.log('\nde kaart');
{
  const regels = new Map([
    ['cc:0:16', { in: 'cc:0:16', laag: 'device.rack', action: 'track.{focus}.fx.knob.1' }],
    ['note:0:53', { in: 'note:0:53', action: 'track.1.play' }],
    ['note:0:0', { in: 'note:0:0', laag: 'grid.hotcues', action: 'track.1.hotcue.1' }],
    ['note:0:1', { in: 'note:0:1', laag: 'grid.loops', action: 'track.1.loop.toggle' }],
  ]);
  const mapping = { actieveRegels: () => regels, lagen: () => ['device.rack', 'grid.hotcues'], vars: () => ({ focus: '2' }) };
  const k = kaartVan([{ id: 'apc40mk2', naam: 'APC40', mapping, device: { label: (s) => (s === 'cc:0:16' ? 'device knob 1' : null) } }], (a) => (a === 'track.{focus}.fx.knob.1' ? { kort: 'knop 1' } : null));
  const a = k.apparaten[0];
  ok('alleen de regels van de OPEN mapjes (geen kern, geen dicht mapje)', a.knoppen.length === 2 && a.mapjes.join() === 'device.rack,grid.hotcues');
  ok('wat de knop NU doet: label van de control, beschrijf, soort, ingevuld', JSON.stringify(a.knoppen[0]) === '["device knob 1","knop 1","fx","track.2.fx.knob.1"]' && a.knoppen[1][0] === 'note:0:0');
  ok('een sleutel (tekenen alleen bij een andere)', typeof k.sleutel === 'string' && k.sleutel === kaartVan([{ id: 'apc40mk2', mapping, device: null }]).sleutel);
  const veel = new Map(Array.from({ length: 80 }, (_, i) => [`note:0:${i}`, { in: `note:0:${i}`, laag: 'grid.hotcues', action: `x.${i}` }]));
  const kv = kaartVan([{ id: 'x', mapping: { actieveRegels: () => veel, lagen: () => ['grid.hotcues'], vars: {} } }]);
  ok(`hooguit ${MAX_KNOPPEN} knoppen per apparaat, de rest geteld`, kv.apparaten[0].knoppen.length === MAX_KNOPPEN && kv.apparaten[0].meer === 16);
  const doc = maakDoc();
  const w = new KaartWeergave(doc.createElement('div'));
  ok('weergave: tekent bij een nieuwe sleutel', w.toon(k) === true && w.root.children.length === 1);
  ok('… en niet nog eens bij dezelfde', w.toon(k) === false);
}

console.log('\nde renderloop: aanmelden en weer weg (bind/ontbind in vensters.js)');
{
  const { meldAan, aangemeld } = await import('../src/ui/renderloop.js');
  const basis = aangemeld();
  const af = meldAan({ knobs: [{ action: 'a' }, { action: 'b' }], faders: [{}] });
  const met = aangemeld();
  ok('aangemeld: twee Knobs en een fader erbij', met.knobs === basis.knobs + 2 && met.faders === basis.faders + 1 && met.groepen === basis.groepen + 1);
  af();
  const na = aangemeld();
  ok('afgemeld: niets blijft achter', na.knobs === basis.knobs && na.faders === basis.faders && na.groepen === basis.groepen);
  af();
  ok('twee keer afmelden: geen fout, niets negatief', aangemeld().groepen === basis.groepen);
}

if (fails.length) { console.log(`\n${fails.length} FOUT`); process.exit(1); }
console.log('\nAlle checks groen.');
