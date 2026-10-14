// Combinaties en effecten (werkruimte S4, docs/werkruimte/S4.md): de nieuwe modi in de
// mapping (druk, latch, lang, stappen), houd-mapjes over twee apparaten, de weigering op
// de kern, de kies-cache, `als`, {tweede}/{maatgever}, de drukvarianten en solo op een
// echte engine (Web Audio-mock), bus-racks met een strenge tijdlijn, en de stukken.
// Draai met: node test/combinaties.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { maakTijdlijn } from './nep-tijdlijn.mjs';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// ---- Web Audio-mock (zoals handelingenlog.test), voor de echte engine ----------
let NOW = 0;
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({ type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, connect(n) { return n; }, disconnect() {},
  getByteTimeDomainData(b) { b.fill(128); } });
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { return node('biquad'); }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { const n = node('delay'); n.delayTime = param(0); return n; }
  createWaveShaper() { const n = node('shaper'); n.curve = null; return n; }
  createChannelMerger() { return node('merger'); }
  createChannelSplitter() { return node('splitter'); }
  createStereoPanner() { const n = node('pan'); n.pan = param(0); return n; }
  createOscillator() { const n = node('osc'); n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.start = () => {}; s.stop = () => { queueMicrotask(() => s.onended?.()); }; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};

const M = await import('../src/control/mapping.js');
const { Mapping, sleutelVan, resolveTarget, zetVariabele } = M;
const { HoudRegister } = await import('../src/control/houd.js');
const L = await import('../src/control/lagen.js');
const A = await import('../src/control/actions.js');
const C = await import('../src/control/acties-combi.js');

const note = (num, on, ch = 0) => ({ sig: `note:${ch}:${num}`, type: 'note', channel: ch, number: num, value: on ? 127 : 0, norm: on ? 1 : 0, on });
const cc = (num, val, ch = 0) => ({ sig: `cc:${ch}:${num}`, type: 'cc', channel: ch, number: num, value: val, norm: val / 127 });

/** Een Mapping op een nep-bus: standen in een tabel, wat er gebeurt in `gedaan`. */
function nepMapping({ regels, apparaat = 'apc40mk2', houd = new HoudRegister(), klok = { t: 0 }, vars = () => ({ focus: 1 }), lagen = () => [] } = {}) {
  const stand = {};
  const gedaan = [];
  const m = new Mapping({ read: (id) => (id in stand ? stand[id] : null),
    invoke: (id, v) => { gedaan.push([id, v]); if (typeof v === 'number') stand[id] = v; },
    vars, lagen, now: () => klok.t, houd, apparaat });
  const uit = m.load({ name: 't', device: apparaat, version: 3, rules: regels });
  return { m, stand, gedaan, uit, klok, houd };
}

// ---- druk, latch, lang, stappen ------------------------------------------------
console.log('mapping: druk, latch, lang, stappen');
{
  const { m, stand, gedaan, klok } = nepMapping({ regels: [
    { in: 'note:0:1', action: 'track.1.send.a', mode: 'druk', naar: 1 },
    { in: 'note:0:2', action: 'track.1.filter', mode: 'latch', naar: 0.85 },
    { in: 'note:0:3', action: 'track.1.send.b', mode: 'latch', naar: 1, lang: 400 },
    { in: 'note:0:4', action: 'track.1.fx.knob.1', mode: 'druk', naar: 1, lang: true },
    { in: 'cc:0:24', action: 'track.{focus}.jog', mode: 'stappen' },
    { in: 'cc:0:25', action: 'track.1.jog', mode: 'stappen', codering: 'bin' },
    { in: 'cc:0:40', action: 'track.1.send.a', mode: 'druk', naar: 0.6 },
  ] });
  stand['track.1.send.a'] = 0.3; stand['track.1.filter'] = 0.5; stand['track.1.send.b'] = 0.2; stand['track.1.fx.knob.1'] = 0.1;

  m.handle(note(1, true));
  ok('druk: indrukken zet naar (1)', stand['track.1.send.a'] === 1 && gedaan.at(-1)[1] === 1);
  stand['track.1.send.a'] = 0.9;   // iets anders verzet hem intussen
  m.handle(note(1, false));
  ok('druk: loslaten zet terug wat er stond (0,3), ook als hij intussen bewoog', stand['track.1.send.a'] === 0.3 && gedaan.length === 2);

  gedaan.length = 0;
  m.handle(note(2, true)); m.handle(note(2, false));
  ok('latch: druk = naar, loslaten laat staan', stand['track.1.filter'] === 0.85 && gedaan.length === 1);
  m.handle(note(2, true)); m.handle(note(2, false));
  ok('latch: nog eens = de oude stand', stand['track.1.filter'] === 0.5 && gedaan.length === 2);

  // lang: < 400 ms = latch, ≥ 400 ms = momentary (nep-klok).
  gedaan.length = 0;
  klok.t = 1000; m.handle(note(3, true)); klok.t = 1399; m.handle(note(3, false));
  ok('lang: 399 ms gedrukt = vast (latch)', stand['track.1.send.b'] === 1 && gedaan.length === 1);
  klok.t = 2000; m.handle(note(3, true)); klok.t = 2050; m.handle(note(3, false));
  ok('lang: daarna nog eens kort = terug', stand['track.1.send.b'] === 0.2 && gedaan.length === 2);
  klok.t = 3000; m.handle(note(3, true)); klok.t = 3400; m.handle(note(3, false));
  ok('lang: 400 ms gedrukt = zolang je drukte (terug bij loslaten)', stand['track.1.send.b'] === 0.2 && gedaan.length === 4);
  klok.t = 4000; m.handle(note(4, true)); klok.t = 4500; m.handle(note(4, false));
  ok('lang: true = 400 ms, ook bij druk', stand['track.1.fx.knob.1'] === 0.1);
  klok.t = 5000; m.handle(note(4, true)); klok.t = 5100; m.handle(note(4, false));
  ok('lang bij druk: kort = vast', stand['track.1.fx.knob.1'] === 1);
  m.handle(note(4, true)); m.handle(note(4, false));
  ok('… nog eens = terug', stand['track.1.fx.knob.1'] === 0.1);

  // Een druk die over een shift- of mapjewissel heen loopt laat los waar hij indrukte.
  gedaan.length = 0;
  m.handle(note(1, true)); m.shift = true; m.handle(note(1, false)); m.shift = false;
  ok('druk: loslaten gaat naar de regel van het indrukken (shift tussendoor)', stand['track.1.send.a'] === 0.3 && gedaan.length === 2);

  // Een CC-knop in een knopmodus: de halve slag.
  gedaan.length = 0;
  m.handle(cc(40, 127)); m.handle(cc(40, 127)); m.handle(cc(40, 0));
  ok('druk op een CC-knop: 127 = indrukken (één keer), 0 = loslaten', gedaan.length === 2 && gedaan[0][1] === 0.6 && stand['track.1.send.a'] === 0.3);

  // Een action zonder stand (read null) is geen drukknop.
  delete stand['track.1.send.a'];
  gedaan.length = 0;
  const r0 = m.handle(note(1, true)); m.handle(note(1, false));
  ok('druk op een action zonder stand (read null): doet niets, ook niet bij loslaten', gedaan.length === 0 && r0.taken === false);
  stand['track.1.send.a'] = 0.3;

  // stappen
  gedaan.length = 0;
  m.handle(cc(24, 3));
  ok('stappen: +3 klikken = 3 × .fwd (ingedrukt en losgelaten), {focus} ingevuld',
    gedaan.filter(([a, v]) => a === 'track.1.jog.fwd' && v === true).length === 3 && gedaan.length === 6);
  gedaan.length = 0;
  m.handle(cc(24, 127));
  ok('stappen: 127 (tweecomplement) = 1 × .back', gedaan.filter(([a, v]) => a === 'track.1.jog.back' && v === true).length === 1);
  gedaan.length = 0;
  m.handle(cc(24, 40));
  ok(`stappen: +40 in één bericht = hooguit ${M.MAX_STAPPEN} × .fwd`, gedaan.filter(([, v]) => v === true).length === M.MAX_STAPPEN);
  gedaan.length = 0;
  m.handle(cc(25, 61));
  ok('stappen, codering bin: 61 = 3 × .back', gedaan.filter(([a, v]) => a === 'track.1.jog.back' && v === true).length === 3);
  gedaan.length = 0;
  m.handle(cc(24, 0));
  ok('stappen: 0 = niets', gedaan.length === 0);

  ok('toJSON: de nieuwe velden gaan mee (naar, lang, codering)', (() => {
    const j = m.toJSON().rules;
    return j.find((r) => r.in === 'note:0:3').lang === 400 && j.find((r) => r.in === 'note:0:2').naar === 0.85
      && j.find((r) => r.in === 'cc:0:25').codering === 'bin';
  })());
  ok('een regel zonder de nieuwe velden: dezelfde sleutel en dezelfde JSON als vroeger',
    sleutelVan({ in: 'note:0:1', shift: true, laag: 'grid.x' }) === 'note:0:1#shift@grid.x'
    && JSON.stringify(M.normaliseer({ rules: [{ in: 'cc:0:1', action: 'a', mode: 'absolute' }] }).doc.rules[0]) === '{"in":"cc:0:1","action":"a","mode":"absolute"}');
}

// ---- validatie: de kern ----------------------------------------------------------
console.log('\nmapping: geen houd, druk of latch op de kern');
{
  const geweigerd = [];
  const { m, uit } = nepMapping({ regels: [
    { in: 'note:0:1', action: 'track.1.play', laag: 'houd.solo' },
    { in: 'note:0:2', action: 'track.{focus}.cue', mode: 'druk', naar: 1 },
    { in: 'note:0:3', action: 'track.1.hotcue.2', mode: 'latch', naar: 1 },
    { in: 'note:0:4', action: 'track.1.play.quant', laag: 'houd.x' },
    { in: 'note:0:5', action: 'track.1.load.selected', mode: 'druk', naar: 1 },
    { in: 'note:0:6', action: 'layer.grid.loops', laag: 'houd.x' },
    { in: 'note:0:7', action: 'track.1.filter', mode: 'druk' },
    { in: 'note:0:8', action: 'track.1.filter', mode: 'trigger', naar: 1 },
    { in: 'note:0:9', action: 'track.1.filter', mode: 'latch', naar: 1, als: 'iets.raars' },
    { in: 'note:0:10', action: 'track.1.filter', mode: 'stappen', lang: 400 },
    { in: 'note:0:11', action: 'track.1.play', mode: 'trigger' },
    { in: 'note:0:12', action: 'track.1.loop.toggle', laag: 'houd.x' },
  ] });
  ok(`alleen de twee geldige regels geladen (${uit.aantal})`, uit.aantal === 2);
  const reden = (n) => uit.fouten.find((f) => f.startsWith(`regel ${n}:`)) ?? '';
  ok('houd-regel op play: geweigerd met een reden', /de kern/.test(reden(0)) && /houd-regel/.test(reden(0)) && reden(0).endsWith(': geweigerd'));
  ok('druk op cue ({focus}), latch op hotcue, houd op play.quant, druk op load, houd op layer: geweigerd',
    [1, 2, 3, 4, 5].every((i) => reden(i).endsWith(': geweigerd')));
  ok('druk zonder naar, naar bij trigger, onbekende als, lang bij stappen: een fout (geen kern)',
    /"naar" nodig/.test(reden(6)) && /alleen bij druk of latch/.test(reden(7)) && /onbekende conditie/.test(reden(8)) && /"lang"/.test(reden(9)));
  m.on('geweigerd', (l) => geweigerd.push(...l));
  ok('set(): druk op play geweigerd (null) met een melding', m.set('note:0:20', 'track.1.play', { mode: 'druk', naar: 1 }) === null
    && geweigerd.length === 1 && /de kern/.test(geweigerd[0]));
  ok('set(): een houd-regel op cue geweigerd', m.set('note:0:21', 'track.2.cue', { laag: 'houd.solo' }) === null && geweigerd.length === 2);
  ok('set(): een gewone regel op play mag', !!m.set('note:0:22', 'track.1.play', {}));
  ok('KERN herkent het wel en niet', M.KERN.test('track.{focus}.hotcue.3.clear') && !M.KERN.test('track.1.playlist') && !M.KERN.test('track.1.cue.level'));
}

// ---- houd-mapjes over twee apparaten -----------------------------------------------
console.log('\nhoud-mapjes over twee nep-apparaten');
{
  const houd = new HoudRegister();
  const apc = nepMapping({ houd, apparaat: 'apc40mk2', regels: [
    { in: 'note:0:50', action: 'track.1.loop.toggle' },                                   // B: gewoon Y
    { in: 'note:0:50', action: 'track.1.stem.vocals.kill', laag: 'houd.solo' },          // B in houd.solo: X
    { in: 'note:0:51', action: 'track.1.focus' },
    { in: 'note:0:51', action: 'track.2.focus', laag: 'houd.vol' },
    { in: 'cc:0:16', action: 'track.1.filter', mode: 'absolute' },
    { in: 'cc:0:16', action: 'track.1.fader', mode: 'absolute', laag: 'houd.vol' },
  ] });
  const mas = nepMapping({ houd, apparaat: 'maschine-mk2', regels: [
    { in: 'note:1:10', action: 'layer.houd.solo' },                                       // A: houd-knop
    { in: 'note:1:11', action: 'layer.houd.vol' },
  ] });
  const B = (on) => apc.m.handle(note(50, on));
  const laatste = () => apc.gedaan.at(-1);

  B(true); B(false);
  ok('zonder houd: B doet Y', laatste()[0] === 'track.1.loop.toggle' && apc.gedaan.length === 2);
  const v0 = houd.versie;
  mas.m.handle(note(10, true, 1));
  ok('houd-knop A (Maschine) indrukken: houd.solo open, niets op de bus', houd.isOpen('solo') && mas.gedaan.length === 0 && houd.versie === v0 + 1);
  ok('… de APC-mapping ziet het vóór zijn eigen mapjes', apc.m.lagen()[0] === 'houd.solo');
  B(true);
  ok('B doet X zolang A vastzit', laatste()[0] === 'track.1.stem.vocals.kill' && laatste()[1] === true);
  mas.m.handle(note(10, false, 1));
  ok('A eerst los: houd.solo dicht', !houd.isOpen('solo'));
  B(false);
  ok('… en het loslaten van B gaat toch naar X', laatste()[0] === 'track.1.stem.vocals.kill' && laatste()[1] === false);
  ok('de kies-cache geeft na het loslaten meteen de gewone regel', apc.m.kies('note:0:50').action === 'track.1.loop.toggle');

  // Twee houd-mapjes tegelijk.
  mas.m.handle(note(10, true, 1)); mas.m.handle(note(11, true, 1));
  ok('twee houd-mapjes tegelijk open, de laatste eerst', apc.m.lagen().slice(0, 2).join() === 'houd.vol,houd.solo');
  mas.m.handle(note(11, false, 1));
  ok('loslaten van het ene sluit het andere niet', houd.isOpen('solo') && !houd.isOpen('vol'));
  B(true); B(false);
  ok('… en B doet nog X', apc.gedaan.at(-2)[0] === 'track.1.stem.vocals.kill');

  // Van wie het is: de APC kan houd.solo niet sluiten.
  houd.druk('apc40mk2', 'solo', false);
  ok('loslaten door een ander apparaat sluit hem niet ("als het nog de zijne is")', houd.isOpen('solo'));
  // losgekoppeld
  mas.m.handle(note(11, true, 1));
  mas.m.losgekoppeld();
  ok('losgekoppeld() van de Maschine sluit al zijn houd-mapjes', houd.leeg && apc.m.lagen().length === 0);
  ok('… en een tweede losgekoppeld verandert niets (versie blijft)', (() => { const v = houd.versie; mas.m.losgekoppeld(); return houd.versie === v; })());

  // Cache: zonder verandering geen nieuwe zoektocht; de versie gaat niet omhoog per tik.
  const v1 = houd.versie;
  for (let i = 0; i < 100; i++) apc.m.actieveRegels();
  ok('100 × actieveRegels zonder verandering: dezelfde Map, houd-versie blijft', apc.m.actieveRegels() === apc.m.actieveRegels() && houd.versie === v1);
  mas.m.handle(note(11, true, 1));
  const metVol = apc.m.actieveRegels();
  ok('houd.vol open: de LED-laag ziet de houd-regel (fader op cc 16)', metVol.get('cc:0:16')?.action === 'track.1.fader' && metVol.get('note:0:51')?.action === 'track.2.focus');
  mas.m.handle(note(11, false, 1));
  ok('… dicht: meteen weer de gewone', apc.m.actieveRegels().get('cc:0:16')?.action === 'track.1.filter');

  // Een houd-mapje via de bus (scherm, toetsenbord): voegMapjeToe + herbindLagen.
  const lagen = new L.Lagen({ houd });
  A.bindLagen(lagen);
  L.voegMapjeToe('houd', 'proef', { naam: 'proef (houd)', kleur: 'groen' });
  A.herbindLagen();
  const wissels = [];
  lagen.on('change', (w) => wissels.push(w));
  ok('voegMapjeToe(houd) + herbindLagen: layer.houd.proef op de bus', A.has('layer.houd.proef') && /proef \(houd\)/.test(A.metaOf('layer.houd.proef').label));
  A.invoke('layer.houd.proef', true);
  ok('via de bus indrukken: open (apparaat "bus"), lampje aan, Lagen meldt het', houd.open.get('proef') === 'bus' && A.read('layer.houd.proef') === 1
    && wissels.at(-1)?.id === 'houd.proef');
  ok('Lagen.actief() kent de houd-mapjes niet (de Mapping zet ze ervoor)', !lagen.actief().some((l) => l.startsWith('houd.')) && !('houd' in lagen.stand));
  A.invoke('layer.houd.proef', false);
  ok('loslaten: dicht, de mapje-balk krijgt "houd.dicht"', !houd.isOpen('proef') && wissels.at(-1)?.id === 'houd.dicht');
  let fout = null;
  try { L.voegMapjeToe('houd', 'x', { kiesknop: 'y' }); } catch (e) { fout = e; }
  ok('een houd-mapje onder een andere kiesknop: een fout', !!fout);
  A.invoke('layer.houd.proef', true);
  L.haalMapjeWeg('houd', 'proef'); A.herbindLagen();
  ok('haalMapjeWeg(houd): weg van de bus en dicht', !A.has('layer.houd.proef') && !houd.isOpen('proef'));
}

// ---- als en variabelen ---------------------------------------------------------------
console.log('\nmapping: als, {tweede}, {maatgever}');
{
  const { m, gedaan } = nepMapping({ regels: [
    { in: 'note:0:1', action: 'track.{focus}.loop.toggle' },
    { in: 'note:0:1', action: 'track.{focus}.inst.stil', als: 'focus.instrument' },
    { in: 'note:0:2', action: 'track.{tweede}.loop.toggle' },
    { in: 'note:0:3', action: 'track.{maatgever}.fx.knob.1', mode: 'druk', naar: 1 },
  ], vars: () => ({ focus: 1, R: 4 }) });
  ok('als zonder conditie van buiten: de regel zonder als', m.kies('note:0:1').action === 'track.{focus}.loop.toggle');
  let inst = true;
  m.als = (n) => n === 'focus.instrument' && inst;
  ok('als waar: de regel met als gaat voor', m.kies('note:0:1').action === 'track.{focus}.inst.stil');
  inst = false;
  ok('als wordt onwaar: de cache geeft meteen de regel zonder', m.kies('note:0:1').action === 'track.{focus}.loop.toggle');
  ok('sleutel met als: in?als, zonder: zoals vroeger', sleutelVan({ in: 'note:0:1', als: 'hub' }) === 'note:0:1?hub');
  m.handle(note(2, true)); m.handle(note(2, false));
  ok('{tweede} = {R}', gedaan.at(-1)[0] === 'track.4.loop.toggle');
  ok('{tweede} zonder R blijft staan; {L}/{R} blijven gewoon', resolveTarget('a.{tweede}', { focus: 1 }) === 'a.{tweede}' && resolveTarget('{R}', { R: 3 }) === '3');
  ok('{maatgever} zonder variabele van buiten blijft staan', resolveTarget('track.{maatgever}.x', { focus: 1 }) === 'track.{maatgever}.x');
  zetVariabele('maatgever', () => 7);
  ok('{maatgever} met zetVariabele: ingevuld, en in mapping.vars() (de sleutel van het LED-plan)',
    resolveTarget('track.{maatgever}.x', { focus: 1 }) === 'track.7.x' && m.vars().maatgever === 7 && m.vars().focus === 1);
  ok('een variabele van de aanroeper gaat voor', resolveTarget('{maatgever}', { maatgever: 2 }) === '2');
  {
    const bron = { focus: 3 };
    const zonder = new Mapping({ read: () => null, invoke: () => {}, vars: () => bron, houd: new HoudRegister() });
    zonder.load({ name: 'z', device: 'x', version: 3, rules: [{ in: 'note:0:1', action: 'track.{focus}.play' }] });
    ok('een mapping zonder {maatgever} in zijn regels: vars() is precies het object van de bron (geen extra werk)', zonder.vars() === bron);
    zonder.set('note:0:2', 'track.{maatgever}.sync', {});
    ok('… koppel je er een met {maatgever}, dan staat hij er meteen in', zonder.vars().maatgever === 7 && zonder.vars() !== bron);
  }
  zetVariabele('maatgever', () => null);
  ok('maatgever null (geen track geeft de maat): blijft staan', resolveTarget('track.{maatgever}.x', {}) === 'track.{maatgever}.x' && !('maatgever' in m.vars()));
  zetVariabele('maatgever', null);
  const v = m.vars;
  m.vars = v;   // apc-kaart.js zet lagen/vars terug op wat hij las: geen lus
  m.lagen = m.lagen;
  ok('vars en lagen terugzetten op hun eigen lezer: geen lus', m.vars().focus === 1 && Array.isArray(m.lagen()));
}

// ---- drukvarianten en solo op een echte engine ------------------------------------------
console.log('\ndrukvarianten en solo op een echte engine (Web Audio-mock)');
const { Engine } = await import('../src/engine/engine.js');
{
  const eng = new Engine();
  A.bindEngine(eng);
  const meldingen = [];
  C.bindCombi({ engine: eng, meld: (t) => meldingen.push(t) });
  const d = eng.deck('A');
  A.invoke('track.1.send.a', 0.3);
  A.invoke('track.1.send.a.hold', true);
  ok('send.a.hold: 1 bij indrukken', d.ui.sendA === 1 && A.read('track.1.send.a.hold') === 1);
  A.invoke('track.1.send.a', 0.8);       // de knop beweegt intussen
  A.invoke('track.1.send.a.hold', true); // een tweede bron: de eerste stand telt
  A.invoke('track.1.send.a.hold', false);
  ok('… loslaten: terug naar de stand van vóór (0,3), ook als hij intussen bewoog', d.ui.sendA === 0.3 && A.read('track.1.send.a.hold') === 0);
  A.invoke('track.2.send.b', 0.1); A.invoke('track.2.send.b.hold', true); A.invoke('track.2.send.b.hold', false);
  ok('send.b.hold op track 2: heen en terug', eng.deck('B').ui.sendB === 0.1);
  ok('send.a/b.hold nemen de auto-DJ over (meta overneem), fx.mix.hold niet', A.metaOf('track.1.send.a.hold').overneem === true
    && A.metaOf('track.1.send.b.hold').overneem === true && !A.metaOf('track.1.fx.mix.hold').overneem);
  A.invoke('track.1.fx.mix', 0.2); A.invoke('track.1.fx.mix.hold', true);
  const nat = d.fx.mix;
  A.invoke('track.1.fx.mix.hold', false);
  ok('fx.mix.hold: helemaal nat zolang je drukt, dan terug', nat === 1 && d.fx.mix === 0.2);

  // Solo: vier stems (nep: het bestand heeft ze, de engine-mock rekent de versterking). Een
  // stem-action vraagt een nummer op de track (waaromNiet in actions.js): de demo.
  const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
  d.load(renderDemoTrack(eng.ctx, { seed: 0, bars: 2 }), 'demo');
  d.stems = { aantal: 4, namen: ['drums', 'bass', 'other', 'vocals'], schaal: 1 };
  const bus = [];
  const weg = A.bijInvoke((id, v) => bus.push([id, v]));
  A.invoke('track.1.stem.drums.solo', true);
  ok('stem.drums.solo: zang, bas en overig weg (drums niet)', d.stemGekild('vocals') && d.stemGekild('bass') && d.stemGekild('other') && !d.stemGekild('drums')
    && A.read('track.1.stem.drums.solo') === 1);
  ok('… via hun .hold op de bus (dus in het log)', bus.filter(([a, v]) => /stem\.\w+\.hold$/.test(a) && v === true).map(([a]) => a).sort().join()
    === 'track.1.stem.bass.hold,track.1.stem.other.hold,track.1.stem.vocals.hold');
  A.invoke('track.1.stem.drums.solo', false);
  ok('… loslaten: alles weer terug', !['vocals', 'bass', 'other', 'drums'].some((s) => d.stemGekild(s)) && A.read('track.1.stem.drums.solo') === 0);
  A.invoke('track.1.stem.vocals.kill', true);   // een schakelaar blijft staan
  A.invoke('track.1.stem.drums.solo', true); A.invoke('track.1.stem.drums.solo', false);
  ok('… een stem die met de schakelaar weg stond, blijft weg', d.stemGekild('vocals'));
  A.invoke('track.1.stem.vocals.kill', true);
  A.invoke('track.1.stem.inst.solo', true);
  ok('solo inst bij vier stems: alleen de zang weg', d.stemGekild('vocals') && !d.stemGekild('drums'));
  A.invoke('track.1.stem.inst.solo', false);
  ok('solo: log overslaan (de kinderen staan in het log)', A.metaOf('track.1.stem.drums.solo').log === 'overslaan');
  ok('solo op een track zonder stems: read null, doet niets', A.read('track.2.stem.drums.solo') === null
    && (A.invoke('track.2.stem.drums.solo', true), A.read('track.2.stem.drums.solo') === null));
  weg();
  ok('andereStems bij twee stems', C.andereStems(['vocals', 'inst'], 'vocals').join() === 'inst' && C.andereStems(['vocals', 'inst'], 'inst').join() === 'vocals');
  ok('geen melding bij dit alles', meldingen.length === 0);

  // maakAls: de condities uit de engine.
  const als = C.maakAls(eng, { hub: false, apparaten: () => ['apc40mk2'] });
  ok('maakAls: focus.stems (de nep-stems), focus.nummer (de demo), niet leeg, geen instrument, hub nee, apparaat.apc40mk2 ja',
    als('focus.stems') === true && als('focus.nummer') === true && als('focus.leeg') === false && als('focus.instrument') === false
    && als('hub') === false && als('apparaat.apc40mk2') === true && als('apparaat.lpd8') === false);
  ok('maakAls op track 2 (leeg): focus.leeg', (eng.setFocus('B'), als('focus.leeg') === true && als('focus.nummer') === false));
  eng.setFocus('A');
  C.zetMaatgeverVariabele(eng);
  ok('{maatgever} zonder maatgever: blijft staan', resolveTarget('track.{maatgever}.x', {}) === 'track.{maatgever}.x');
  zetVariabele('maatgever', null);
}

// ---- bus-racks met een strenge tijdlijn ----------------------------------------------------
console.log('\nbus-racks: wissel via de kruisfade, niet meer ketens dan op een track');
{
  const { InsertSlot } = await import('../src/engine/fx.js');
  const { SEND_RACKS } = await import('../src/engine/engine.js');
  let T = 0;
  const { param: tparam, stats } = maakTijdlijn(() => T);
  const losTeVroeg = [];
  const ketenGains = new Set();   // de gain van elke oude keten (de kruisfade): die mag pas los als hij dicht is
  const tnode = (type) => {
    const n = { type, gain: tparam(1), frequency: tparam(1000), Q: tparam(1), detune: tparam(0), threshold: tparam(0), knee: tparam(0),
      ratio: tparam(1), attack: tparam(0), release: tparam(0), pan: tparam(0), delayTime: tparam(0), offset: tparam(0), playbackRate: tparam(1),
      fftSize: 1024, curve: null, connect(x) { return x; }, getByteTimeDomainData(b) { b.fill(128); }, start() {}, stop() {} };
    // Een gain die losgaat terwijl er nog signaal door kan (> 0 op dit moment): een klik.
    n.disconnect = () => { if (ketenGains.has(n) && n.gain.value > 1e-6) losTeVroeg.push(n.gain.value); };
    return n;
  };
  const ctx = { sampleRate: 48000, get currentTime() { return T; }, baseLatency: 0.005, destination: tnode('dest'),
    createGain: () => tnode('gain'), createBiquadFilter: () => tnode('biquad'), createDelay: () => tnode('delay'),
    createWaveShaper: () => tnode('shaper'), createChannelMerger: () => tnode('merger'), createChannelSplitter: () => tnode('splitter'),
    createStereoPanner: () => tnode('pan'), createOscillator: () => tnode('osc'), createDynamicsCompressor: () => tnode('comp'),
    createConstantSource: () => tnode('const'), createAnalyser: () => tnode('analyser'),
    createBufferSource: () => tnode('src'),
    createBuffer: (ch, len, sr) => { const dd = [...Array(ch)].map(() => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => dd[i] }; } };
  // setTimeout van de opruiming vangen: wij bepalen wanneer de tijd verstrijkt.
  const timers = [];
  const echteTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, op: T + ms / 1000 }); return timers.length; };
  try {
    const racks = JSON.parse(readFileSync(new URL('../racks/sjablonen.json', import.meta.url), 'utf8')).racks;
    const maakSlot = (rack) => { const s = new InsertSlot(ctx); s.setMix(1); s.zetRack(rack); return s; };
    const bussen = { A: maakSlot(SEND_RACKS.A), B: maakSlot(SEND_RACKS.B) };
    const track = maakSlot(SEND_RACKS.B);
    const reg = new Map();
    const define = (id, type, fn, meta = {}) => reg.set(id, { fn, meta });
    const onthouden = [];
    const stub = { ui: { sendA: 0, sendB: 0 }, set() {}, fx: { mix: 0, setMix() {} }, stemBestaat: () => false, stems: null };
    const c = C.bindCombi({ engine: { deck: () => stub, sends: bussen, focus: 'A' }, define, invoke: () => {}, read: () => null,
      metaOf: () => null, racks: () => racks, onthoudBus: (b, n) => onthouden.push([b, n]) });
    ok('send.a/b.rack.next/prev bestaan, en worden niet teruggespeeld', ['a', 'b'].every((b) => ['next', 'prev'].every((r) => reg.get(`send.${b}.rack.${r}`)?.meta.log === 'overslaan')));
    const breuk0 = stats.CURVE_BREUK, overlap0 = stats.OVERLAP_FOUTEN;
    const volgorde = [];
    for (let i = 0; i < 10; i++) {
      T += 0.004;
      reg.get('send.b.rack.next').fn(true); reg.get('send.b.rack.next').fn(false);
      volgorde.push(bussen.B.rackNaam);
    }
    // Dezelfde tien wissels op een track-insert, op dezelfde momenten.
    T -= 0.04;
    for (const naam of volgorde) { T += 0.004; track.zetRack(racks.find((r) => r.name === naam) ?? SEND_RACKS.B); }
    ok(`tien keer snel send.b.rack.next: ${bussen.B.nodeAantal} ketens, op een track-insert ${track.nodeAantal}`,
      bussen.B.nodeAantal === track.nodeAantal && bussen.B.nodeAantal === 11);
    ok('… rondlopend door galm + de kant-en-klare racks', volgorde[0] === racks[0].name && volgorde[racks.length - 1] === racks.at(-1).name
      && volgorde[racks.length] === 'Galm' && volgorde[racks.length + 1] === racks[0].name);
    ok('… zonder afgebroken curve of overlappende automatisering (CURVE_BREUK = 0)', stats.CURVE_BREUK === breuk0 && stats.OVERLAP_FOUTEN === overlap0);
    ok('… en de keuze wordt onthouden (op naam)', onthouden.length === 10 && onthouden.at(-1).join() === `B,${volgorde.at(-1)}`);
    // De tijd laten verstrijken: opruimen pas na fade plus staart, nooit met signaal.
    for (const k of bussen.B.oud) ketenGains.add(k.gain);
    for (const t of timers.filter((x) => x.op <= T)) t.fn();     // wat nu al zou mogen (niets: de fade loopt nog)
    ok(`vóór het einde van de fade is er nog niets opgeruimd (${bussen.B.opgeruimd})`, bussen.B.opgeruimd === 0 && losTeVroeg.length === 0);
    T += 30;
    for (const t of timers.splice(0)) t.fn();
    ok(`opgeruimd na de fade: ${bussen.B.opgeruimd} oude ketens, geen gain los met signaal (${losTeVroeg.length})`,
      bussen.B.opgeruimd === 10 && bussen.B.nodeAantal === 1 && losTeVroeg.length === 0);
    ok('zetBusRack op naam (voor S3), onbekend = false', c.zetBusRack('a', racks[1].name) && bussen.A.rackNaam === racks[1].name && c.zetBusRack('A', 'bestaat niet') === false);
    ok('zetBusRack met hetzelfde rack: geen nieuwe keten', (() => { const k = bussen.A.keten; c.zetBusRack('A', racks[1].name); return bussen.A.keten === k; })());
    reg.get('send.a.rack.prev').fn(true);
    ok('send.a.rack.prev: één terug', bussen.A.rackNaam === racks[0].name);
    ok('busRacks: de eigen echo vooraan, dan de kant-en-klare', c.busRacks('a')[0] === 'Echo' && c.busRacks('a').length === racks.length + 1);
  } finally {
    globalThis.setTimeout = echteTimeout;
  }
}

// ---- de stukken ------------------------------------------------------------------------------
console.log('\nde stukken (mappings/stukken/)');
{
  const standaard = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
  const sleutels = new Set(standaard.rules.map((r) => sleutelVan(r)));
  const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
  const eng = new Engine();
  A.bindEngine(eng);
  A.bindApp({ toon() {}, venster: () => ({}), opnemer: {}, opnameStart() {}, opnameStop() {}, opnameSoort() {}, rackStap() {} });
  C.bindCombi({ engine: eng });
  const lagen = new L.Lagen();
  A.bindLagen(lagen);
  const map = new URL('../mappings/stukken/', import.meta.url);
  const stukken = readdirSync(map).filter((f) => f.endsWith('.json')).sort();
  ok(`twee stukken van S4 (${stukken.join(', ')})`, stukken.includes('fx-matrix.json') && stukken.includes('mix-extra.json'));
  const groepenVoor = JSON.stringify(L.GROEPEN);
  for (const f of ['fx-matrix.json', 'mix-extra.json']) {
    const doc = JSON.parse(readFileSync(new URL(f, map), 'utf8'));
    const regels = doc.regels.apc40mk2;
    const botsing = regels.filter((r) => sleutels.has(sleutelVan(r)));
    ok(`${doc.stuk}: ${regels.length} regels, 0 botsingen met de standaard`, regels.length > 0 && botsing.length === 0);
    const { fouten } = M.normaliseer({ rules: regels });
    ok(`${doc.stuk}: elke regel geldig (ook latch met naar)`, fouten.length === 0);
    // Op een echte Mapping zetten: eerst de mapjes, dan het fragment.
    const m = new Mapping({ read: A.read, invoke: A.invoke, vars: () => ({ focus: 1 }), lagen: () => lagen.actief(), metaOf: A.metaOf, houd: new HoudRegister() });
    m.laadStandaard(standaard);
    const voor = m.toJSON();
    const uit = C.zetStuk(doc, { mapping: m, voegMapjeToe: L.voegMapjeToe, herbind: A.herbindLagen });
    ok(`${doc.stuk}: op de mapping, alle ${regels.length} regels erbij, je eigen mapping (toJSON) onveranderd`,
      uit.aantal === regels.length && uit.fouten.length === 0 && JSON.stringify(m.toJSON()) === JSON.stringify(voor));
    const onbekend = [...new Set(regels.map((r) => r.action))].filter((a) => !A.has(a));
    ok(`${doc.stuk}: elke action bestaat${onbekend.length ? ` (niet: ${onbekend.join(', ')})` : ''}`, onbekend.length === 0);
    const kaal = [...new Set(regels.map((r) => r.action))].filter((a) => { const b = beschrijf(a); return b.lang === a || b.lang.startsWith('?') || !b.kort; });
    ok(`${doc.stuk}: elke action heeft een uitleg${kaal.length ? ` (niet: ${kaal.join(', ')})` : ''}`, kaal.length === 0);
    if (doc.stuk === 'fx-matrix') {
      ok('fx-matrix: mapje grid.fx (violet), layer.grid.fx bestaat', L.MAPJE_KLEUR['grid.fx'] === 'violet' && A.has('layer.grid.fx'));
      // Spelen: ⇧ On/Off opent het mapje, pad 1/3 = plek 1 van track 3 vol zolang je drukt.
      m.handle({ sig: 'note:0:98', type: 'note', on: true, value: 127 });
      m.handle(note(62, true)); m.handle(note(62, false));
      m.handle({ sig: 'note:0:98', type: 'note', on: false, value: 0 });
      ok('⇧ On/Off opent grid.fx', lagen.stand.grid === 'fx');
      ok('pad 1/3 = track.3.fx.knob.1.hold, ⇧ = latch op track.3.fx.knob.1', m.kies('note:0:34').action === 'track.3.fx.knob.1.hold'
        && m.kies('note:0:34', { shift: true }).mode === 'latch' && m.kies('note:0:34', { shift: true }).action === 'track.3.fx.knob.1');
      ok('rij 5 = echo-worp, scene 1 = master plek 1, scene 5 blijft loop weg', m.kies('note:0:0').action === 'track.1.send.a.hold'
        && m.kies('note:0:82').action === 'master.fx.knob.1.hold' && m.kies('note:0:86').action === 'track.{focus}.loop.exit');
      const d = eng.deck('C');
      const stand0 = d.fx.leesPlek(1);
      m.handle(note(34, true));
      const open = d.fx.leesPlek(1);
      m.handle(note(34, false));
      ok(`pad 1/3 indrukken: plek 1 vol (${open}), loslaten: terug (${stand0})`, open === 1 && d.fx.leesPlek(1) === stand0);
      m.handle({ sig: 'note:0:98', type: 'note', on: true, value: 127 });
      m.handle(note(34, true)); m.handle(note(34, false));
      m.handle({ sig: 'note:0:98', type: 'note', on: false, value: 0 });
      ok('⇧ + pad 1/3: vast open (latch)', d.fx.leesPlek(1) === 1);
      m.handle({ sig: 'note:0:98', type: 'note', on: true, value: 127 });
      m.handle(note(34, true)); m.handle(note(34, false));
      m.handle({ sig: 'note:0:98', type: 'note', on: false, value: 0 });
      ok('⇧ + pad 1/3 nog eens: terug', d.fx.leesPlek(1) === stand0);
      lagen.zet('grid', 'hotcues');
      L.haalMapjeWeg('grid', 'fx'); A.herbindLagen();
    } else {
      m.handle({ sig: 'note:0:98', type: 'note', on: true, value: 127 });
      m.handle(note(66, true, 2)); m.handle(note(66, false, 2));
      m.handle({ sig: 'note:0:98', type: 'note', on: false, value: 0 });
      ok('mix-extra: ⇧ A|B 3 = track 3 op thru', eng.kant.C === 'thru');
      m.handle(note(66, true, 2)); m.handle(note(66, false, 2));
      ok('… zonder shift doet A|B wat hij deed (rondlopen)', eng.kant.C === 'A');
    }
    ok(`${doc.stuk}: weer weg (haalWeg) = de mapping van vóór`, m.haalWeg(`stuk:${doc.stuk}`) === regels.length && JSON.stringify(m.toJSON()) === JSON.stringify(voor));
  }
  ok('GROEPEN weer zoals vóór de stukken', JSON.stringify(L.GROEPEN) === groepenVoor);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
