// De effecten uit Clay's filter app (src/engine/fx-meer.js, docs/EFFECTEN.md)
// in Node, tegen een Web Audio-mock die ALLES vastlegt: elke node, elke
// verbinding, elke automatisering. Daarmee:
//   - het contract van fx.js per effect (params 0..1, standaard, eenheid);
//   - geen NaN of Infinity, hoe je ook aan de knoppen draait;
//   - de eenheid op het scherm is wat zet() echt op de nodes zet;
//   - elke lus heeft een vertraging, en geen filter met een bult in een lus;
//   - verzetten gaat met twee koppen of twee vormen, lineair, na de drempel;
//   - de LFO op de maat: op de tel, en na een sprong op dezelfde tel;
//   - worklets: één keer laden, droog tot ze er zijn, nooit gooien;
//   - vernietig() stopt alles wat loopt;
//   - de rekenkernen van de worklets: toonhoogte gemeten, 0 GC per blok.
// Het geluid zelf (begrensd, bypass bit voor bit, hoorbaar) meet
// tools/headless/effecten.mjs in Chrome.
// @alleen: afvalmeting (GCProfiler, 0 GC) (test/alles.mjs draait hem na de pool, zonder iets ernaast)
import v8 from 'node:v8';
import vm from 'node:vm';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };

if (typeof globalThis.gc !== 'function') {
  v8.setFlagsFromString('--expose-gc');
  globalThis.gc = vm.runInNewContext('gc');
}

// ---- de mock -------------------------------------------------------------------

let NOW = 0;
let NIET_EINDIG = [];        // [param-naam, functie, argumenten] met NaN of Infinity
let CURVES = 0;              // setValueCurveAtTime: mag nergens

const param = (eigenaar, naam, v = 0) => ({
  value: v, naam, eigenaar, events: [],
  _log(f, a) {
    this.events.push([f, ...a]);
    if (a.some((x) => typeof x === 'number' && !Number.isFinite(x))) NIET_EINDIG.push([`${eigenaar.soort}.${naam}`, f, a]);
  },
  setTargetAtTime(x, t, tau) { this._log('setTargetAtTime', [x, t, tau]); this.value = x; },
  setValueAtTime(x, t) { this._log('setValueAtTime', [x, t]); this.value = x; },
  linearRampToValueAtTime(x, t) { this._log('linearRampToValueAtTime', [x, t]); this.value = x; },
  exponentialRampToValueAtTime(x, t) { this._log('exponentialRampToValueAtTime', [x, t]); this.value = x; },
  setValueCurveAtTime(c, t, d) { CURVES++; this._log('setValueCurveAtTime', [t, d]); },
  cancelScheduledValues(t) { this._log('cancelScheduledValues', [t]); },
  cancelAndHoldAtTime(t) { this._log('cancelAndHoldAtTime', [t]); },
});

let NODES = [];
// `soort` is wat voor node het is; `type` blijft vrij voor het filtertype en de golfvorm.
const node = (ctx, soort, params = [], extra = {}) => {
  const n = { soort, ctx, naar: [], ...extra };
  for (const [p, v] of params) n[p] = param(n, p, v);
  n.connect = (doel, uit = 0, inp = 0) => { n.naar.push({ doel, uit, inp }); return doel; };
  n.disconnect = (doel) => { n.naar = doel ? n.naar.filter((v) => v.doel !== doel) : []; };
  NODES.push(n);
  return n;
};

class MockContext {
  constructor({ worklet = null } = {}) {
    this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005;
    this.destination = node(this, 'dest');
    this.bronnen = [];
    if (worklet) this.audioWorklet = worklet;
  }
  get currentTime() { return NOW; }
  createGain() { return node(this, 'gain', [['gain', 1]], { channelCount: 2, channelCountMode: 'max' }); }
  createDelay(max = 1) { return node(this, 'delay', [['delayTime', 0]], { max }); }
  createBiquadFilter() { return node(this, 'biquad', [['frequency', 350], ['Q', 1], ['gain', 0], ['detune', 0]], { type: 'lowpass' }); }
  createWaveShaper() {
    const n = node(this, 'shaper', [], { oversample: 'none', curves: [] });
    let c = null;
    Object.defineProperty(n, 'curve', { get: () => c, set: (x) => { c = x; n.curves.push(x); } });
    return n;
  }
  createDynamicsCompressor() { return node(this, 'comp', [['threshold', -24], ['knee', 30], ['ratio', 12], ['attack', 0.003], ['release', 0.25]]); }
  createStereoPanner() { return node(this, 'pan', [['pan', 0]]); }
  createChannelSplitter(n = 6) { return node(this, 'splitter', [], { uitgangen: n }); }
  createChannelMerger(n = 6) { return node(this, 'merger', [], { ingangen: n }); }
  createOscillator() {
    const o = node(this, 'osc', [['frequency', 440], ['detune', 0]], { type: 'sine', gestart: null, gestopt: null });
    o.start = (t = 0) => { o.gestart = t; this.bronnen.push(o); };
    o.stop = (t = 'nu') => { o.gestopt = t; };
    return o;
  }
  createBufferSource() {
    const s = node(this, 'src', [['playbackRate', 1], ['detune', 0]], { buffer: null, loop: false, gestart: null, offset: null, gestopt: null, onended: null });
    s.start = (t = 0, offset = 0) => { s.gestart = t; s.offset = offset; this.bronnen.push(s); };
    s.stop = (t = 'nu') => { s.gestopt = t; queueMicrotask(() => s.onended?.()); };
    return s;
  }
  createBuffer(ch, len, sr) {
    const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] };
  }
}

/** Een audioWorklet waarvan de test bepaalt wanneer (en of) hij klaar is. */
function nepWorklet() {
  const w = { geladen: 0, urls: [], los: [] };
  w.addModule = (url) => {
    w.geladen++; w.urls.push(String(url));
    return new Promise((ok, fout) => w.los.push({ ok, fout }));
  };
  // Eerst even wachten: laadFxWorklet roept addModule pas in een microtaak aan.
  w.klaar = async () => { await rust(); for (const l of w.los.splice(0)) l.ok(); await rust(); };
  w.mislukt = async () => { await rust(); for (const l of w.los.splice(0)) l.fout(new Error('nep')); await rust(); };
  return w;
}
const rust = () => new Promise((r) => setTimeout(r, 0));

const WORKLET_NODES = [];
const PARAMS_VAN = { 'varve-fx-omhullende': [['aanzet', 0.01], ['verval', 0.15]], 'varve-fx-toonhoogte': [['halvetonen', 0]] };
globalThis.AudioWorkletNode = class {
  constructor(ctx, naam, opties = {}) {
    if (!PARAMS_VAN[naam]) throw new Error(`InvalidStateError: ${naam} niet geregistreerd`);
    const n = node(ctx, 'worklet', [], { naam, opties, berichten: [] });
    n.parameters = new Map(PARAMS_VAN[naam].map(([p, v]) => [p, param(n, p, v)]));
    n.port = { postMessage: (m) => { if (!n.poortDicht) n.berichten.push(m); }, onmessage: null, close() { n.poortDicht = true; } };
    WORKLET_NODES.push(n);
    return n;
  }
};

// ---- grafen -------------------------------------------------------------------

/** Alle nodes die vanaf `start` bereikbaar zijn (een verbinding naar een param telt als naar zijn eigenaar). */
function bereikbaar(start) {
  const gezien = new Set(), stapel = [start];
  while (stapel.length) {
    const n = stapel.pop();
    if (!n || gezien.has(n)) continue;
    gezien.add(n);
    for (const { doel } of n.naar || []) stapel.push(doel.eigenaar || doel);
  }
  return gezien;
}

/** Sterk samenhangende componenten (Tarjan) van de graaf vanaf `start`: de lussen. */
function lussen(start) {
  const nodes = [...bereikbaar(start)];
  const index = new Map(), laag = new Map(), op = new Set(), stapel = [], uit = [];
  let i = 0;
  const buren = (n) => (n.naar || []).map(({ doel }) => doel.eigenaar || doel);
  const sc = (v) => {
    index.set(v, i); laag.set(v, i); i++; stapel.push(v); op.add(v);
    for (const w of buren(v)) {
      if (!index.has(w)) { sc(w); laag.set(v, Math.min(laag.get(v), laag.get(w))); }
      else if (op.has(w)) laag.set(v, Math.min(laag.get(v), index.get(w)));
    }
    if (laag.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do { w = stapel.pop(); op.delete(w); comp.push(w); } while (w !== v);
      const zelf = comp.length === 1 && buren(comp[0]).includes(comp[0]);
      if (comp.length > 1 || zelf) uit.push(comp);
    }
  };
  for (const n of nodes) if (!index.has(n)) sc(n);
  return uit;
}

/** Alle params van alle nodes van een context: waarde en elke automatisering eindig? */
function allesEindig(ctx) {
  for (const n of NODES) {
    if (n.ctx !== ctx) continue;
    for (const v of Object.values(n)) if (v && typeof v === 'object' && 'events' in v && !Number.isFinite(v.value)) return false;
    if (n.parameters) for (const p of n.parameters.values()) if (!Number.isFinite(p.value)) return false;
  }
  return NIET_EINDIG.length === 0;
}

// ---- het contract -------------------------------------------------------------------

const { EFFECTEN, effectVan, bouwKeten, toonWaarde, InsertSlot } = await import('../src/engine/fx.js');
const M = await import('../src/engine/fx-meer.js');
const L = await import('../src/engine/fx-lfo.js');
const NIEUW = M.MEER_EFFECTEN.map((e) => e.id);

console.log('contract');
// Daarachter de zeven van spoor S10 (fx-s10.js): getoetst in test/effecten-s10.test.mjs.
// Op id, niet op hun plek in de lijst: een effect erbij in fx.js mag deze test niet breken. Wel de
// volgorde, want die is die van de kiezer en van fx.next/prev: eerst die van fx.js zelf, dan de tien
// aaneengesloten in hun eigen volgorde, dan de rest (S10).
const plekVan = (e) => EFFECTEN.findIndex((x) => x.id === e.id);
const plekken = M.MEER_EFFECTEN.map(plekVan);
const S10_IDS = new Set((await import('../src/engine/fx-s10.js')).S10_EFFECTEN.map((e) => e.id));
const eigen = EFFECTEN.map((e, i) => [e, i]).filter(([e]) => !NIEUW.includes(e.id) && !S10_IDS.has(e.id)).map(([, i]) => i);
ok(`tien effecten uit de filter app (${NIEUW.join(', ')})`, NIEUW.length === 10);
ok('elk staat in EFFECTEN, op id en als hetzelfde object (effectVan vindt het)',
  M.MEER_EFFECTEN.every((e, k) => plekken[k] >= 0 && EFFECTEN[plekken[k]] === e && effectVan(e.id) === e),
  M.MEER_EFFECTEN.filter((e, k) => plekken[k] < 0).map((e) => e.id).join(', '));
ok('aaneengesloten en in hun eigen volgorde (de kiezer)', plekken.every((p, k) => k === 0 || p === plekken[k - 1] + 1));
ok(`achter de ${eigen.length} van fx.js zelf`, eigen.length >= 1 && eigen.every((i) => i < plekken[0]));
ok('vóór de effecten van S10', EFFECTEN.every((e, i) => !S10_IDS.has(e.id) || i > plekken[plekken.length - 1]));
ok('ids uniek over alle effecten, ook met de oude', new Set(EFFECTEN.map((e) => e.id)).size === EFFECTEN.length);
for (const e of M.MEER_EFFECTEN) {
  const goed = typeof e.naam === 'string' && e.naam && Array.isArray(e.params) && e.params.length >= 1 && e.params.length <= 8
    && e.params.every((p) => typeof e.standaard[p] === 'number' && e.standaard[p] >= 0 && e.standaard[p] <= 1)
    && Object.keys(e.standaard).every((p) => e.params.includes(p))
    && e.params.every((p) => typeof e.eenheid?.[p] === 'function')
    && (e.bipolair || []).every((p) => e.params.includes(p))
    && Object.keys(e.trappen || {}).every((p) => e.params.includes(p) && e.trappen[p] >= 2)
    && typeof e.bouw === 'function';
  ok(`${e.id}: naam, 1–8 parameters met standaard 0..1, een eenheid per parameter, bipolair/trappen bestaan`, goed);
}

// ---- bouwen, aan alles draaien, opruimen ------------------------------------------

console.log('\nbouwen, aan alles draaien, opruimen');
const { expMap, dbToGain } = await import('../src/lib/emitter.js');
const { startDrempel } = await import('../src/engine/overgang.js');
const evts = (p, f) => p.events.filter((x) => x[0] === f);
const nepKlok = (bl = 0.5) => () => ({ beatLengte: bl, ankerCtx: Math.ceil(NOW / bl + 1e-9) * bl });
const RAAR = [0, 0.25, 0.5, 0.75, 1, NaN, -1, 2, Infinity, -Infinity, 1e-9, 0.999999];
for (const e of M.MEER_EFFECTEN) {
  NIET_EINDIG = [];
  NOW = 10;
  const ctx = new MockContext();
  const inst = e.bouw(ctx, { klok: nepKlok() });
  for (const p of e.params) inst.zet(p, e.standaard[p], NOW);
  ok(`${e.id}: bouwt, in en uit zijn nodes van deze context, en het signaal komt van in naar uit`,
    inst.in?.ctx === ctx && inst.out?.ctx === ctx && typeof inst.zet === 'function' && typeof inst.staart === 'function'
    && bereikbaar(inst.in).has(inst.out));
  let gooit = null;
  try {
    for (const t of RAAR) for (const p of e.params) { NOW += 0.37; inst.zet(p, t, NOW); }
    inst.heranker?.();
  } catch (err) { gooit = err; }
  ok(`${e.id}: elke parameter op 0, 1, NaN, −1, 2, ±Infinity: geen fout, overal eindige waarden`,
    !gooit && allesEindig(ctx), gooit ? gooit.message : NIET_EINDIG.slice(0, 2).map((x) => x.join(' ')).join('; '));
  let staarten = [];
  for (const stand of [0, 1, 0.5]) {
    for (const p of e.params) { NOW += 0.37; inst.zet(p, stand, NOW); }
    staarten.push(inst.staart());
  }
  ok(`${e.id}: staart eindig en begrensd (${staarten.map((s) => s.toFixed(3)).join(' / ')} s)`,
    staarten.every((s) => Number.isFinite(s) && s >= 0 && s <= 30));
  inst.vernietig?.();
  const lopend = ctx.bronnen.filter((b) => b.gestart !== null && b.gestopt === null);
  ok(`${e.id}: vernietig stopt elke oscillator en bron (${ctx.bronnen.length} gestart)`, lopend.length === 0);
}

// Flanger: de staart volgt de terugkoppeling (zoveel rondgangen tot −60 dB).
{
  NOW = 20;
  const f = effectVan('flanger').bouw(new MockContext());
  for (const [p, v] of Object.entries({ snelheid: 0.4, diepte: 1, vertraging: 1, feedback: 1, meng: 0.5 })) f.zet(p, v, NOW);
  const d = 0.015 + (0.015 - 0.0028), verwacht = d * Math.log(0.001) / Math.log(0.95) + 0.005;
  ok(`flanger op volle feedback: staart ${f.staart().toFixed(3)} s = ${verwacht.toFixed(3)} s (langste vertraging × rondgangen tot −60 dB)`,
    Math.abs(f.staart() - verwacht) < 1e-9);
  f.zet('feedback', 0.5, NOW);
  ok('zonder feedback: alleen de langste vertraging', Math.abs(f.staart() - (d + 0.005)) < 1e-9);
  f.vernietig();
}

// ---- lussen ---------------------------------------------------------------------------
// Chrome zet een lus zonder DelayNode op stil, en een lowpass/highpass met Q
// boven −3 dB (een piek, Q is daar in dB) laat een lus aanzwellen.

console.log('\nlussen (alle zeventien effecten)');
for (const e of EFFECTEN) {
  NOW = 5;
  const ctx = new MockContext();
  const inst = e.bouw(ctx, { klok: nepKlok() });
  for (const p of e.params) inst.zet(p, e.standaard[p], NOW);
  const comps = lussen(inst.in);
  const metVertraging = comps.every((c) => c.some((n) => n.soort === 'delay'));
  const filters = comps.flat().filter((n) => n.soort === 'biquad');
  const geenBult = filters.every((f) => !['lowpass', 'highpass'].includes(f.type) || f.Q.value < -3);
  ok(`${e.id}: ${comps.length} lus(sen), elk met een vertraging; ${filters.length} filter(s) erin, geen met een bult`,
    metVertraging && geenBult);
  inst.vernietig?.();
}

// ---- inloop: een geheugen begint leeg ----------------------------------------------
// Een nieuwe keten (rackwissel, editor) begint met lege vertragingslijnen. Zonder
// inloop begint de vertraagde kopie abrupt, midden in een golf: een tik
// (gemeten in Chrome, tools/headless/effecten.mjs). Elke weg van de ingang naar
// iets met geheugen (vertraging, compressor, worklet) loopt dus door een gain
// die vanaf 0 opengaat.

console.log('\ninloop');
for (const e of M.MEER_EFFECTEN) {
  NOW = 50;
  const w = nepWorklet(), ctx = new MockContext({ worklet: w });
  const eerst = e.bouw(ctx, { klok: nepKlok() });
  await w.klaar();                                   // daarna is de module er: de node komt meteen
  const inst = e.bouw(ctx, { klok: nepKlok() });
  for (const p of e.params) inst.zet(p, e.standaard[p], NOW);
  const isInloop = (n) => n.soort === 'gain' && n.gain.events.some((x) => x[0] === 'setValueAtTime' && x[1] === 0)
    && evts(n.gain, 'linearRampToValueAtTime').at(-1)?.[1] === 1;
  // Bereikbaar vanaf de ingang ZONDER door een inloop te gaan:
  const gezien = new Set(), stapel = [inst.in];
  while (stapel.length) {
    const n = stapel.pop();
    if (!n || gezien.has(n) || isInloop(n)) continue;
    gezien.add(n);
    for (const { doel } of n.naar || []) stapel.push(doel.eigenaar || doel);
  }
  // De omhullende (auto-wah) telt niet: die begint op 0 en stijgt met zijn aanzettijd, nooit met een sprong.
  const geheugen = [...bereikbaar(inst.in)].filter((n) => ['delay', 'comp'].includes(n.soort) || n.naam === 'varve-fx-toonhoogte');
  const bloot = geheugen.filter((n) => gezien.has(n));
  ok(`${e.id}: ${geheugen.length ? `${geheugen.length} node(s) met geheugen, elk achter een inloop` : 'geen geheugen, geen inloop nodig'}`,
    bloot.length === 0, bloot.map((n) => n.soort).join(', '));
  eerst.vernietig?.(); inst.vernietig?.();
}

// ---- eenheden: wat het scherm zegt is wat zet() doet ---------------------------------
// De rack-editor toont elke parameter via `eenheid` (toonWaarde). Hier wordt
// gelezen wat zet() ECHT op de nodes zette, en vergeleken met de tekst, tot op
// de laatste getoonde decimaal. Wijkt één formule af, dan liegt het scherm.

console.log('\neenheden = wat zet() doet');
const getallen = (s) => (String(s).replace(/−/g, '-').match(/-?\d+(?:,\d+)?/g) || [])
  .map((x) => ({ v: Number(x.replace(',', '.')), dec: (x.split(',')[1] || '').length }));
/** Klopt `waarde` met het i-de getal in de tekst, tot op een halve eenheid van de laatste decimaal? */
const klopt = (tekst, waarde, i = 0, schaal = 1) => {
  const g = getallen(tekst)[i];
  return !!g && Math.abs(g.v * schaal - waarde) <= 0.5 * Math.pow(10, -g.dec) * schaal * 1.0001 + 1e-9;
};
const hzKlopt = (tekst, f) => klopt(tekst, f, 0, /kHz/.test(tekst) ? 1000 : 1);
const mengKlopt = (tekst, n) => klopt(tekst, Math.asin(Math.min(1, n.nat.gain.value)) * 2 / Math.PI * 100);
const db20 = (g) => 20 * Math.log10(g);
const kop = (k) => k._kop().stand;

const LEZERS = {
  distortion: {
    drive: (n, s) => klopt(s, db20(n.vormers[n.wissel.actief].voor.gain.value * 128)),
    soort: (n, s) => n.vormers[n.wissel.actief].soort === s,
    toon: (n, s) => hzKlopt(s, n.toon.frequency.value),
    niveau: (n, s) => klopt(s, db20(n.niveau.gain.value)),
    meng: (n, s) => mengKlopt(s, n),
  },
  chorus: {
    snelheid: (n, s) => klopt(s, n.stemmen[0].lfo.frequency.value) && Math.abs(n.stemmen[1].lfo.frequency.value / n.stemmen[0].lfo.frequency.value - 1.23) < 1e-9,
    diepte: (n, s) => klopt(s, Math.abs(kop(n.stemmen[0].koppen).diepte) * 1000)
      && Math.abs(kop(n.stemmen[1].koppen).diepte + kop(n.stemmen[0].koppen).diepte) < 1e-12,
    vertraging: (n, s) => klopt(s, kop(n.stemmen[0].koppen).basis * 1000)
      && Math.abs(kop(n.stemmen[1].koppen).basis / kop(n.stemmen[0].koppen).basis - 1.35) < 1e-9,
    meng: (n, s) => mengKlopt(s, n),
  },
  flanger: {
    snelheid: (n, s) => klopt(s, n.lfo.frequency.value),
    diepte: (n, s) => { const k = kop(n.koppen); return klopt(s, (k.basis - k.diepte) * 1000, 0) && klopt(s, (k.basis + k.diepte) * 1000, 1) && k.basis - k.diepte >= 0.0028 - 1e-12; },
    vertraging: (n, s) => klopt(s, kop(n.koppen).basis * 1000),
    feedback: (n, s) => klopt(s, n.fb.gain.value * 100) && Math.abs(n.inLus.gain.value - Math.sqrt(1 - n.fb.gain.value ** 2)) < 1e-12,
    meng: (n, s) => mengKlopt(s, n),
  },
  vibrato: {
    snelheid: (n, s) => klopt(s, n.lfo.frequency.value),
    diepte: (n, s) => { const k = kop(n.koppen); return klopt(s, k.diepte * 1000) && (k.diepte === 0 ? k.basis === 0 : Math.abs(k.basis - k.diepte - 0.0005) < 1e-12); },
  },
  tremolo: {
    snelheid: (n, s) => (n.lfo.stand.sync ? L.LFO_DELINGEN.find((d) => d.tellen === n.lfo.stand.tellen)?.id === s : klopt(s, n.lfo.stand.hz)),
    diepte: (n, s) => klopt(s, n.diep.gain.value * 200) && Math.abs(n.poort.gain.value + n.diep.gain.value - 1) < 1e-12,
    vorm: (n, s) => n.lfo.stand.vorm === s,
    sync: (n, s) => (n.lfo.stand.sync ? 'op de maat' : 'vrij') === s,
  },
  autopan: {
    snelheid: (n, s) => (n.lfo.stand.sync ? L.LFO_DELINGEN.find((d) => d.tellen === n.lfo.stand.tellen)?.id === s : klopt(s, n.lfo.stand.hz)),
    diepte: (n, s) => klopt(s, -n.diep.gain.value * 100),
    vorm: (n, s) => n.lfo.stand.vorm === s,
    sync: (n, s) => (n.lfo.stand.sync ? 'op de maat' : 'vrij') === s,
  },
  autowah: {
    gevoel: (n, s) => klopt(s, n.gevoel.gain.value),
    basis: (n, s) => hzKlopt(s, n.bp.frequency.value),
    bereik: (n, s) => klopt(s, n.bereik.gain.value / 1200) && n.bp.frequency.value * Math.pow(2, n.bereik.gain.value / 1200) <= 20000 * (1 + 1e-9),
    reso: (n, s) => klopt(s, n.bp.Q.value) && Math.abs(n.terug.gain.value - Math.min(4, Math.sqrt(2 * n.bp.Q.value))) < 1e-12,
    aanzet: (n, s) => klopt(s, n.omh.node.parameters.get('aanzet').value * 1000),
    verval: (n, s) => klopt(s, n.omh.node.parameters.get('verval').value * 1000),
    meng: (n, s) => mengKlopt(s, n),
  },
  pitch: {
    interval: (n, s) => klopt(s, n.w.node.parameters.get('halvetonen').value) && (s.startsWith('−') ? n.w.node.parameters.get('halvetonen').value < 0 : true),
    meng: (n, s) => mengKlopt(s, n),
  },
  compressor: {
    drempel: (n, s) => klopt(s, n.comp.threshold.value),
    ratio: (n, s) => klopt(s, n.comp.ratio.value),
    aanzet: (n, s) => klopt(s, n.comp.attack.value * 1000),
    verval: (n, s) => klopt(s, n.comp.release.value * 1000),
    makeup: (n, s) => klopt(s, db20(n.makeup.gain.value))
      && Math.abs(n.terug.gain.value * M.chromeMakeup(n.comp.threshold.value, 12, n.comp.ratio.value) - 1) < 1e-12,
    meng: (n, s) => mengKlopt(s, n),
  },
  widener: {
    breedte: (n, s) => klopt(s, n.zijW.gain.value * 100),
    haas: (n, s) => (kop(n.koppen).basis === 0 ? s === 'uit' : klopt(s, kop(n.koppen).basis * 1000)),
  },
};

for (const e of M.MEER_EFFECTEN) {
  let mis = [], n = 0;
  for (const p of e.params) {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      NOW = 1000;
      const w = nepWorklet(), ctx = new MockContext({ worklet: w });
      const inst = e.bouw(ctx, { klok: nepKlok() });
      const stand = { ...e.standaard };
      // Bij een gesynchroniseerde LFO ook de vrije stand (Hz) nalopen.
      if (p === 'snelheid' && 'sync' in stand && i % 2) stand.sync = 0;
      for (const q of e.params) inst.zet(q, stand[q], NOW);
      await w.klaar();
      NOW = 1001;
      stand[p] = t;
      inst.zet(p, t, NOW);
      NOW = 1002;
      const tekst = toonWaarde(e.id, p, t, (q) => stand[q]);
      n++;
      if (!LEZERS[e.id][p](inst._n, tekst)) mis.push(`${p}=${t}: "${tekst}"`);
      inst.vernietig?.();
    }
  }
  ok(`${e.id}: ${n} standen, de eenheid op het scherm is wat er op de nodes staat`, mis.length === 0, mis.slice(0, 3).join(' | '));
}
{
  const tw = (id, p, t, l) => toonWaarde(id, p, t, l);
  ok('voorbeelden: delay-stijl (komma, kHz, echte min)',
    tw('distortion', 'toon', 1) === '20 kHz' && tw('compressor', 'drempel', 0) === '−60,0 dB' && tw('pitch', 'interval', 0) === '−24 ht'
    && tw('pitch', 'interval', 0.5) === '0 ht' && tw('pitch', 'interval', 1) === '+24 ht' && tw('widener', 'haas', 0) === 'uit'
    && tw('tremolo', 'snelheid', 0.5) === '1/8' && tw('tremolo', 'snelheid', 0.5, () => 0) === '1,73 Hz'
    && tw('flanger', 'feedback', 0.5) === '0%' && tw('flanger', 'feedback', 0) === '−95%');
}

// ---- twee koppen: verzetten zonder glijdende toon -----------------------------------
// Een vertraging verschuiven laat de toonhoogte glijden (de delay in fx.js,
// 1000 Hz → 4293 Hz). Een nieuwe vertraging gaat op de stille kop, en daar
// wordt LINEAIR naartoe gevloeid (twee keer bijna hetzelfde signaal: lineair
// telt op tot 1, ook in de lus van de flanger).

console.log('\ntwee koppen');
const W = startDrempel(new MockContext());
{
  NOW = 100;
  const ctx = new MockContext();
  const c = effectVan('chorus').bouw(ctx);
  for (const p of effectVan('chorus').params) c.zet(p, effectVan('chorus').standaard[p], NOW);
  const k = c._n.stemmen[0].koppen;
  const s0 = k._kop();
  ok('bij het bouwen: beide koppen dezelfde vertraging en diepte, één hoorbaar, geen overgang',
    s0.tijden[0] === s0.tijden[1] && s0.diepten[0] === s0.diepten[1] && s0.gains[0] === 1 && s0.gains[1] === 0
    && evts(k.koppen[0].g.gain, 'linearRampToValueAtTime').length === 0);
  NOW = 101;
  c.zet('vertraging', 0.9, NOW);
  const s1 = k._kop();
  ok('nieuwe vertraging op de STILLE kop, de hoorbare blijft staan',
    s1.actief === 1 && s1.tijden[0] === s0.tijden[0] && Math.abs(s1.tijden[1] - expMap(0.9, 0.003, 0.04)) < 1e-15);
  const dt = k.koppen[1].d.delayTime.events.filter((x) => x[0] !== 'cancelScheduledValues');
  ok('… en daar meteen gezet (hij klinkt niet): geen helling of doel op een vertraging',
    dt.at(-1)[0] === 'setValueAtTime' && dt.at(-1)[2] === 101
    && [...k.koppen.flatMap((kp) => kp.d.delayTime.events)].every((x) => !/Ramp|Target|Curve/.test(x[0])));
  const uit = evts(k.koppen[0].g.gain, 'linearRampToValueAtTime'), in_ = evts(k.koppen[1].g.gain, 'linearRampToValueAtTime');
  ok(`lineair van de ene kop naar de andere in 50 ms, pas na de drempel (${(W * 1000).toFixed(1)} ms)`,
    uit.length === 1 && uit[0][1] === 0 && Math.abs(uit[0][2] - (101 + W + 0.05)) < 1e-12
    && in_.length === 1 && in_[0][1] === 1 && Math.abs(in_[0][2] - (101 + W + 0.05)) < 1e-12
    && evts(k.koppen[1].g.gain, 'setValueAtTime').some((x) => Math.abs(x[2] - (101 + W)) < 1e-12));
  NOW = 101.01;
  c.zet('vertraging', 0.2, NOW);
  c.zet('diepte', 0.9, NOW);
  c.zet('vertraging', 0.5, NOW);
  ok('snel doordraaien midden in de overgang: niets over elkaar heen', k._kop().actief === 1 && k._kop().tijden[0] === s0.tijden[0]);
  NOW = 101.2;
  await new Promise((r) => setTimeout(r, 120));
  const s2 = k._kop();
  ok('daarna de LAATSTE stand (vertraging én diepte), niet een tussenstand',
    s2.actief === 0 && Math.abs(s2.tijden[0] - expMap(0.5, 0.003, 0.04)) < 1e-15
    && Math.abs(Math.abs(s2.diepten[0]) - 0.9 * expMap(0.5, 0.003, 0.04) * 0.6) < 1e-15);
  NOW = 102;
  const voor = k.koppen[0].g.gain.events.length;
  c.zet('vertraging', 0.5, NOW);
  ok('dezelfde stand nog eens: geen overgang', k.koppen[0].g.gain.events.length === voor);
  // Een stand die wacht, en vlak na klaarOm (vóór de timer vuurt) een nieuwere: de nieuwere wint.
  NOW = 103;
  c.zet('vertraging', 0.6, NOW);
  NOW = 103.01;
  c.zet('vertraging', 0.7, NOW);            // wacht: de overgang loopt nog
  NOW = 103.2;
  c.zet('vertraging', 0.3, NOW);            // na klaarOm, de timer heeft nog niet gevuurd
  NOW = 104;                                // en als hij vuurt is ook die overgang klaar
  await new Promise((r) => setTimeout(r, 120));
  ok('een wachtende stand wordt niet alsnog gezet als er intussen een nieuwere kwam',
    Math.abs(k._kop().stand.basis - expMap(0.3, 0.003, 0.04)) < 1e-15);
  c.vernietig();
  ok('geen enkele setValueCurveAtTime', CURVES === 0);
}
{
  // Vibrato: de diepte gaat ook via de koppen, en op 0 is er geen vertraging.
  NOW = 200;
  const v = effectVan('vibrato').bouw(new MockContext());
  v.zet('diepte', 0, NOW);
  ok('vibrato op diepte 0: vertraging 0 (bit voor bit door, gemeten in Chrome)', v._n.koppen._kop().tijden.every((t) => t === 0));
  NOW = 201;
  v.zet('diepte', 1, NOW);
  const k = v._n.koppen._kop();
  ok('vibrato vol: ±8 ms om 8,5 ms heen (nooit onder 0,5 ms), via de stille kop',
    k.actief === 1 && Math.abs(k.stand.diepte - 0.008) < 1e-15 && Math.abs(k.stand.basis - 0.0085) < 1e-15);
  v.vernietig();
}
{
  // Flanger: de zwaai blijft boven één render quantum (Chrome klemt een vertraging in een lus).
  let laagste = Infinity;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    NOW = 300;
    const f = effectVan('flanger').bouw(new MockContext());
    f.zet('vertraging', i / 10, NOW); f.zet('diepte', j / 10, NOW);
    const s = f._n.koppen._kop().stand;
    laagste = Math.min(laagste, s.basis - Math.abs(s.diepte));
    f.vernietig();
  }
  ok(`flanger: laagste vertraging over alle standen ${(laagste * 1000).toFixed(2)} ms ≥ 128 samples (2,67 ms)`, laagste >= 128 / 48000);
}

// ---- distortion: een andere soort is een andere vormer ---------------------------------

console.log('\ndistortion');
{
  NOW = 400;
  const ctx = new MockContext();
  const d = effectVan('distortion').bouw(ctx);
  for (const p of effectVan('distortion').params) d.zet(p, effectVan('distortion').standaard[p], NOW);
  const [a, b] = d._n.vormers;
  ok('twee vormers, allebei zacht, zonder oversampling (Chrome: 2x = 128, 4x = 192 samples later: een kam met de mix-knop)',
    a.soort === 'zacht' && b.soort === 'zacht' && a.vorm.oversample === 'none' && b.vorm.oversample === 'none');
  const curvesVoor = a.vorm.curves.length;
  NOW = 401;
  d.zet('drive', 0.9, NOW);
  ok('drive is een gain vóór de vorm: glijdt, geen nieuwe curve',
    a.vorm.curves.length === curvesVoor && evts(a.voor.gain, 'setTargetAtTime').at(-1)[1] === (1 + 30 * 0.9) / 128);
  NOW = 402;
  d.zet('soort', 1 / 3, NOW);
  ok('andere soort: de curve gaat op de STILLE vormer (gain 0 op dat moment), de hoorbare houdt de zijne',
    d._n.wissel.actief === 1 && b.soort === 'hard' && a.soort === 'zacht' && b.vorm.curve === b.vorm.curves.at(-1)
    && evts(b.g.gain, 'linearRampToValueAtTime').at(-1)[1] === 1 && evts(a.g.gain, 'linearRampToValueAtTime').at(-1)[1] === 0);
  ok('… met de drive van nu, direct (hij klinkt nog niet)',
    Math.abs(evts(b.voor.gain, 'setValueAtTime').at(-1)[1] - (1 + 60 * 0.9) / 128) < 1e-15);
  const f = M.SOORTEN.map((s) => { const c = (d.zet('soort', M.SOORTEN.indexOf(s) / 3, NOW += 1), d._n.vormers[d._n.wissel.actief].vorm.curve); return [c[8192], c[0], c[16384]]; });
  ok('elke vorm: 0 op 0, oneven, binnen −1..1', f.every(([m, l, r]) => m === 0 && Math.abs(l + r) < 1e-6 && Math.abs(l) <= 1 && Math.abs(r) <= 1));
  // Gelijke luidheid: een sinus met piek 0,3 komt er bij elke drive even luid uit.
  let slechtste = 0;
  for (const s of M.SOORTEN) for (let i = 0; i <= 10; i++) {
    const g = 1 + { zacht: 30, hard: 60, fuzz: 60, vouw: 10 }[s] * i / 10, c = M.compVan(s, g);
    const fn = { zacht: Math.tanh, hard: (u) => Math.max(-1, Math.min(1, u)), fuzz: (u) => Math.sign(u) * (1 - Math.exp(-Math.abs(u))),
      vouw: (u) => { const v = (((u + 1) % 4) + 4) % 4; return v < 2 ? v - 1 : 3 - v; } }[s];
    let e = 0; for (let k = 0; k < 4800; k++) { const y = c * fn(g * 0.3 * Math.sin(2 * Math.PI * k / 4800)); e += y * y; }
    slechtste = Math.max(slechtste, Math.abs(10 * Math.log10(e / 4800 / (0.045))));
  }
  ok(`gelijke luidheid: sinus met piek 0,3 bij elke soort en drive binnen ${slechtste.toFixed(3)} dB van de invoer`, slechtste < 0.05);
  d.vernietig();
}

// ---- compressor -----------------------------------------------------------------------

console.log('\ncompressor');
{
  ok(`Chrome's eigen make-up nagerekend: drempel −24, knie 12, ratio 4 → ${db20(M.chromeMakeup(-24, 12, 4)).toFixed(3)} dB (gemeten in Chrome: 8,207)`,
    Math.abs(db20(M.chromeMakeup(-24, 12, 4)) - 8.2075) < 0.005);
  ok('… en op drempel 0 niets', Math.abs(db20(M.chromeMakeup(0, 12, 4))) < 1e-9);
  ok('vooruitkijken: 288 samples op 48 kHz (gemeten in Chrome), 264 op 44,1 kHz',
    Math.round(M.compLatentie(48000) * 48000) === 288 && Math.round(M.compLatentie(44100) * 44100) === 264);
  NOW = 500;
  const c = effectVan('compressor').bouw(new MockContext());
  for (const p of effectVan('compressor').params) c.zet(p, effectVan('compressor').standaard[p], NOW);
  c.zet('makeup', 0.5, NOW);
  ok('makeup 0 dB: onder de drempel precies even luid (Chrome\'s make-up eruit gedeeld)',
    Math.abs(c._n.makeup.gain.value * c._n.terug.gain.value * M.chromeMakeup(c._n.comp.threshold.value, 12, c._n.comp.ratio.value) - 1) < 1e-12);
  NOW = 501;
  const [p0, p1] = c._n.paden;
  c.zet('drempel', 1, NOW);
  ok('een nieuwe drempel gaat op de STILLE compressor (direct, met zijn eigen terugrekening), en daar wordt lineair naartoe gevloeid',
    c._n.wissel.actief === 1 && p1.comp.threshold.value === 0 && p0.comp.threshold.value === -24
    && evts(p1.comp.threshold, 'setTargetAtTime').length === 0 && Math.abs(p1.terug.gain.value * M.chromeMakeup(0, 12, 4) - 1) < 1e-12
    && evts(p1.g.gain, 'linearRampToValueAtTime').at(-1)[1] === 1 && evts(p0.g.gain, 'linearRampToValueAtTime').at(-1)[1] === 0);
  c.zet('aanzet', 1, NOW);
  ok('aanzet glijdt op allebei', p0.comp.attack.value === 1 && p1.comp.attack.value === 1);
  ok('het droge pad wacht even lang als de compressor (meng zonder kam)', Math.abs(c._n.wacht.delayTime.value * 48000 - 288) < 1e-9);
  c.vernietig?.();
}

// ---- de LFO: vrij en op de maat -----------------------------------------------------------

console.log('\nLFO (tremolo, autopan)');
{
  let vormGoed = true, sprong = 0;
  for (const v of L.LFO_VORMEN) {
    const d = L.vormSamples(v);
    let som = 0, mx = -Infinity, mn = Infinity;
    for (let i = 0; i < d.length; i++) {
      som += d[i]; mx = Math.max(mx, d[i]); mn = Math.min(mn, d[i]);
      sprong = Math.max(sprong, Math.abs(d[i] - d[(i + d.length - 1) % d.length]));
    }
    if (Math.abs(som / d.length) > 0.01 || Math.abs(mx - 1) > 1e-6 || Math.abs(mn + 1) > 1e-3 || Math.abs(d[0] - 1) > 1e-6) vormGoed = false;
  }
  ok('vier golfvormen: gemiddeld 0, van −1 tot 1, +1 op de tel', vormGoed);
  ok(`nergens een sprong, ook niet bij blok en zaag (grootste stap ${sprong.toFixed(4)} per sample van 4096)`, sprong < 0.03);
  ok('delingen van langzaam naar snel, knop rechts = sneller', L.LFO_DELINGEN.every((d, i, a) => !i || d.tellen < a[i - 1].tellen)
    && L.lfoDelingVan(0).id === '4/1' && L.lfoDelingVan(1).id === '1/32' && L.lfoDelingVan(0.5).id === '1/8');
}

/** De fase van een bron op tijd t: offset in de buffer plus wat hij sindsdien afspeelde. */
const bronFase = (src, t) => (src.offset / src.buffer.duration + (t - src.gestart) * src.playbackRate.value / src.buffer.duration) % 1;
const frac = (x) => x - Math.floor(x);
const fasefout = (a, b) => Math.abs(frac(a - b + 0.5) - 0.5);
{
  // Op de maat: tel van 0,5 s, volgende tel op 10,25.
  NOW = 10;
  let klok = { beatLengte: 0.5, ankerCtx: 10.25 };
  const ctx = new MockContext();
  const tr = effectVan('tremolo').bouw(ctx, { klok: () => klok });
  for (const p of effectVan('tremolo').params) tr.zet(p, effectVan('tremolo').standaard[p], NOW);
  const lfo = tr._n.lfo;
  const levend = () => ctx.bronnen.filter((b) => b.soort === 'src' && b.gestopt === null);
  ok('bouwen met alle parameters: één bron, de rest kwam nooit aan klinken toe', levend().length === 1 && lfo.bron.src === levend()[0]);
  let src = lfo.bron.src;
  const P = 0.5 * 0.5;            // 1/8 = een halve tel
  ok('periode exact via de snelheid: 1/8 bij 120 bpm = 0,25 s', Math.abs(src.buffer.duration / src.playbackRate.value - P) < 1e-12);
  ok(`start na de drempel, op de fase die hij dan hoort te hebben: op de tel (10,25) fase 0`,
    Math.abs(src.gestart - (10 + W)) < 1e-12 && fasefout(bronFase(src, 10.25), 0) < 1e-9 && fasefout(bronFase(src, 12.75), 0) < 1e-9);
  const g0 = src.naar[0].doel;
  ok('… en vloeit in vanaf 0 (lineair, LFO_FADE)', evts(g0.gain, 'linearRampToValueAtTime').at(-1)?.[1] === 1 && g0.gain.events.find((x) => x[0] === 'setValueAtTime')?.[1] === 0);
  NOW = 11;
  const starts = lfo.starts;
  tr.heranker();
  ok('herankeren met dezelfde maat: niets (de engine herankert bij elke change)', lfo.starts === starts);
  // Tempo omhoog en een sprong: de nieuwe tel ligt op 11,1 met 0,48 s.
  klok = { beatLengte: 0.48, ankerCtx: 11.1 };
  tr.heranker();
  const nieuw = lfo.bron.src;
  ok('ander tempo: een nieuwe bron, meteen (niet pas op de volgende tel), op de tel van de nieuwe maat',
    nieuw !== src && Math.abs(nieuw.gestart - (11 + W)) < 1e-12 && fasefout(bronFase(nieuw, 11.1), 0) < 1e-9
    && Math.abs(nieuw.buffer.duration / nieuw.playbackRate.value - 0.24) < 1e-12);
  ok('de oude vloeit in dezelfde 20 ms uit en stopt daarna', src.gestopt > 11 + W + L.LFO_FADE - 1e-9
    && evts(g0.gain, 'linearRampToValueAtTime').at(-1)[1] === 0);
  // Golf van een hele maat (4 tellen): na een sprong op DEZELFDE tel van de cyclus.
  NOW = 12;
  tr.zet('snelheid', 2 / 9, NOW);          // 1/1
  src = lfo.bron.src;
  const anker = 11.1 + 0.48 * 4;           // ergens later op het rooster
  const faseVoor = bronFase(src, anker);
  klok = { beatLengte: 0.48, ankerCtx: anker + 0.5 * 0.48 + 0.01 };   // sprong: tel valt nu anders
  NOW = 12.2;
  tr.heranker();
  const k1 = Math.round(frac(faseVoor + (0.5 * 0.48 + 0.01) / (4 * 0.48)) * 4) % 4;
  ok(`1/1 (vier tellen): na een sprong op de tel van de cyclus waar hij zat (tel ${k1 + 1} van 4)`,
    fasefout(bronFase(lfo.bron.src, klok.ankerCtx), k1 / 4) < 1e-9);
  // Geen klok meer (de track stopt): door op de laatste tel.
  klok = null;
  NOW = 13;
  tr.zet('snelheid', 4 / 9, NOW);          // 1/4
  ok('zonder klok: de laatst bekende tel (0,48 s), niet terug naar 120 bpm',
    Math.abs(lfo.bron.src.buffer.duration / lfo.bron.src.playbackRate.value - 0.48) < 1e-12);
  // Vrij: Hz, een andere snelheid glijdt op dezelfde bron.
  NOW = 14;
  tr.zet('sync', 0, NOW);
  const vrij = lfo.bron.src;
  NOW = 15;
  tr.zet('snelheid', 0.8, NOW);
  ok('vrij: een andere snelheid glijdt op dezelfde bron (geen nieuwe golf)',
    lfo.bron.src === vrij && Math.abs(evts(vrij.playbackRate, 'setTargetAtTime').at(-1)[1] * 48000 / 4096 - expMap(0.8, 0.1, 30)) < 1e-9);
  NOW = 16;
  tr.zet('vorm', 1, NOW);
  ok('andere golfvorm: een nieuwe bron met de zaag, overvloeien', lfo.bron.src !== vrij && lfo.stand.vorm === 'zaag' && vrij.gestopt !== null);
  NOW = 17;
  tr.zet('diepte', 1, NOW);
  ok('diepte glijdt op twee AudioParams; de golf loopt door', tr._n.poort.gain.value === 0.5 && tr._n.diep.gain.value === 0.5 && lfo.stand.vorm === 'zaag');
  tr.vernietig();
  await rust();
  ok('vernietig: geen bron loopt nog', levend().length === 0);
}
{
  // Autopan: links op de tel.
  NOW = 20;
  const ap = effectVan('autopan').bouw(new MockContext(), { klok: () => ({ beatLengte: 0.5, ankerCtx: 20.5 }) });
  for (const p of effectVan('autopan').params) ap.zet(p, effectVan('autopan').standaard[p], NOW);
  ok('autopan: pan = −diepte · golf, dus links op de tel; 1/4 op de standaard', ap._n.diep.gain.value === -0.8 && ap._n.lfo.stand.tellen === 1
    && fasefout(bronFase(ap._n.lfo.bron.src, 20.5), 0) < 1e-9);
  ap.vernietig();
}

// ---- worklets: lui, één keer, en nooit gooien -----------------------------------------------

console.log('\nworklets (pitch, auto-wah)');
{
  NOW = 600;
  const w = nepWorklet(), ctx = new MockContext({ worklet: w });
  const voor = WORKLET_NODES.length;
  const p = effectVan('pitch').bouw(ctx), a = effectVan('autowah').bouw(ctx);
  for (const q of effectVan('pitch').params) p.zet(q, effectVan('pitch').standaard[q], NOW);
  for (const q of effectVan('autowah').params) a.zet(q, effectVan('autowah').standaard[q], NOW);
  const p2 = effectVan('pitch').bouw(ctx);
  await rust();
  ok('drie effecten op één context: de module wordt één keer geladen', w.geladen === 1 && /fx-worklet\.js$/.test(w.urls[0]));
  ok('zolang hij laadt: pitch helemaal droog (droog 1, nat 0), geen node, niets gegooid',
    p._n.droog.gain.value === 1 && p._n.nat.gain.value === 0 && WORKLET_NODES.length === voor);
  ok('… en de auto-wah een wah in rust (omhullende dicht)', a._n.aan.gain.value === 0);
  p.zet('interval', 0, NOW); p.zet('meng', 1, NOW);
  ok('draaien tijdens het laden mag: onthouden, pitch blijft droog', p._n.droog.gain.value === 1 && p._n.staat.st === -24);
  p2.vernietig();                         // opgeruimd voordat hij er is
  NOW = 601;
  await w.klaar();
  const nodes = WORKLET_NODES.slice(voor);
  const pn = p._n.w.node, an = a._n.omh.node;
  ok('geladen: precies twee nodes (de opgeruimde krijgt er geen)', nodes.length === 2 && pn && an && !p2._n.w.node);
  ok('pitch-node: stereo, aangesloten tussen in en nat, op het interval van NU (−24)',
    pn.naam === 'varve-fx-toonhoogte' && pn.opties.outputChannelCount[0] === 2 && pn.opties.channelCountMode === 'explicit'
    && bereikbaar(p.in).has(pn) && pn.naar.some((v) => v.doel === p._n.nat)
    && pn.parameters.get('halvetonen').value === -24);
  ok('… en vloeit dan lineair naar de meng van nu (1: alleen nat)',
    evts(p._n.droog.gain, 'linearRampToValueAtTime').at(-1)[1] < 1e-12 && evts(p._n.nat.gain, 'linearRampToValueAtTime').at(-1)[1] === 1);
  ok('auto-wah: omhullende tussen in en gevoel, aanzet/verval van nu, vloeit in',
    an.naam === 'varve-fx-omhullende' && a.in.naar.some((v) => v.doel === an) && an.naar.some((v) => v.doel === a._n.gevoel)
    && Math.abs(an.parameters.get('aanzet').value - expMap(0.404, 0.001, 0.3)) < 1e-12
    && evts(a._n.aan.gain, 'linearRampToValueAtTime').at(-1)[1] === 1);
  const nu = WORKLET_NODES.length;
  const p3 = effectVan('pitch').bouw(ctx);
  ok('al geladen: een nieuw effect krijgt zijn node METEEN, tijdens het bouwen, op de meng (geen invloeien)',
    WORKLET_NODES.length === nu + 1 && p3._n.w.node && Math.abs(p3._n.nat.gain.value - Math.SQRT1_2) < 1e-12
    && evts(p3._n.nat.gain, 'linearRampToValueAtTime').length === 0 && w.geladen === 1);
  ok('… met een inloop vóór de lijn (die begint leeg)',
    p3.in.naar.some((v) => v.doel.soort === 'gain' && evts(v.doel.gain, 'linearRampToValueAtTime').at(-1)?.[1] === 1 && v.doel.naar.some((x) => x.doel === p3._n.w.node)));
  p3.vernietig();
  NOW = 602;
  p.zet('interval', 0.75, NOW);
  ok('daarna glijdt het interval op de AudioParam (+12)', evts(pn.parameters.get('halvetonen'), 'setTargetAtTime').at(-1)[1] === 12);
  p.vernietig(); a.vernietig();
  ok('vernietig: de processor hoort "stop" (anders houdt hij zichzelf in leven) en hangt los',
    pn.berichten.includes('stop') && an.berichten.includes('stop') && pn.naar.length === 0 && an.naar.length === 0);
  ok('… en daarna gaat de poort dicht (stop eerst: een dichte poort neemt niets meer aan)', pn.poortDicht === true && an.poortDicht === true);
}
{
  NOW = 700;
  const w = nepWorklet(), ctx = new MockContext({ worklet: w });
  const p = effectVan('pitch').bouw(ctx);
  p.zet('meng', 1, NOW);
  await w.mislukt();
  ok('laden mislukt: droog, geen fout', p._n.droog.gain.value === 1 && !p._n.w.node);
  const q = effectVan('pitch').bouw(ctx);
  await rust();
  ok('… en het volgende effect probeert het opnieuw', w.geladen === 2);
  await w.klaar();
  ok('… en dat lukt dan wel', !!q._n.w.node);
  p.vernietig(); q.vernietig();
}
{
  // Een context zonder worklets (zoals de mock van engine.test).
  NOW = 800;
  const ctx = new MockContext();
  let gooit = null;
  try { const p = effectVan('pitch').bouw(ctx); p.zet('interval', 1, NOW); p.vernietig(); } catch (e) { gooit = e; }
  ok('een context zonder audioWorklet: bouwt, droog, gooit niets', !gooit && M.laadFxWorklet(ctx) === null);
}

// ---- in de insert-slot ---------------------------------------------------------------------

console.log('\nin de insert-slot');
{
  NOW = 900;
  const ctx = new MockContext();
  const slot = new InsertSlot(ctx);
  slot.setKlok(nepKlok());
  slot.setMix(1);
  let fouten = [], gestopt = 0;
  for (const id of NIEUW) {
    NOW += 1;
    const oud = slot.keten;
    if (oud) for (const s of oud.node.slots.values()) { const v = s.inst.vernietig; s.inst.vernietig = () => { gestopt++; v?.(); }; }
    try { slot.zetEffect(id); } catch (e) { fouten.push(`${id}: ${e.message}`); }
    if (slot.effectId !== id) fouten.push(`${id}: staat er niet in`);
    if (oud && !slot.oud.includes(oud)) fouten.push(`${id}: de vorige keten is meteen weg`);
    if (slot.plekken.length !== effectVan(id).params.length) fouten.push(`${id}: ${slot.plekken.length} plekken`);
    for (const k of slot.plekken) { NOW += 0.1; slot.setPlek(k, 0.9); slot.setPlek(k, 0.1); }
    slot.heranker();
  }
  ok('elk nieuw effect in de slot: twee ketens tijdens de kruisfade, één plek per parameter, draaien en herankeren zonder fout',
    fouten.length === 0, fouten.slice(0, 3).join(' | '));
  for (const k of [...slot.oud]) slot._ruimOp(k);
  ok(`opruimen na de kruisfade roept vernietig() van elk oud effect aan (${gestopt}×)`, gestopt === NIEUW.length - 1 && slot.oud.length === 0);
  ok('nergens een setValueCurveAtTime, en alles eindig', CURVES === 0 && allesEindig(ctx));
}

// ---- de rekenkernen van de worklets ----------------------------------------------------------

console.log('\nrekenkernen (fx-kern.js) en de worklet zelf');
const K = await import('../src/engine/fx-kern.js');
const SR = 48000, Q = 128;
const goertzel = (x, hz) => {
  const w = 2 * Math.PI * hz / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / x.length;
};
{
  const uitkomst = [];
  let begrensd = true;
  for (const st of [7, -12, 12, -5]) {
    const k = new K.Toonhoogte(SR);
    k.halvetonen = st;
    const blokken = Math.ceil(1.5 * SR / Q), uit = new Float32Array(blokken * Q);
    const inL = new Float32Array(Q), oL = new Float32Array(Q), oR = new Float32Array(Q);
    for (let b = 0; b < blokken; b++) {
      for (let i = 0; i < Q; i++) inL[i] = 0.5 * Math.sin(2 * Math.PI * 440 * (b * Q + i) / SR);
      k.render(inL, inL, 1, oL, oR, Q);
      uit.set(oL, b * Q);
      for (let i = 0; i < Q; i++) if (!(Math.abs(oL[i]) <= 0.5 * Math.SQRT2 + 1e-6) || oL[i] !== oR[i]) begrensd = false;
    }
    // Over één seconde: vermogen in een band van ±30 Hz. Op één frequentie
    // zie je weinig: elke korrel begint op een andere fase, dus de toon
    // spreidt zich met de korrelsnelheid (~11 Hz) over een paar lijnen.
    const x = uit.subarray(SR / 2, SR / 2 + SR), doel = 440 * Math.pow(2, st / 12);
    let tot = 0;
    for (let i = 0; i < x.length; i++) tot += x[i] * x[i];
    tot /= x.length;
    const band = (f0) => { let e = 0; for (let f = Math.round(f0) - 30; f <= Math.round(f0) + 30; f++) e += goertzel(x, f) ** 2 / 2; return e; };
    uitkomst.push({ st, doel: band(doel) / tot, bron: band(440) / tot, db: 10 * Math.log10(tot / 0.125) });
  }
  ok(`toonhoogte: 440 Hz → +7/−12/+12/−5 ht: het vermogen zit rond het nieuwe interval, niet meer op 440 (${uitkomst.map((u) => `${u.st > 0 ? '+' : ''}${u.st}: ${(u.doel * 100).toFixed(1)}% / ${(u.bron * 100).toFixed(2)}%, ${u.db >= 0 ? '+' : ''}${u.db.toFixed(1)} dB`).join('; ')})`,
    uitkomst.every((u) => u.doel > 0.95 && u.bron < 0.01 && Math.abs(u.db) < 1.5));
  ok('… eindig, nooit boven √2 × de invoer, links = rechts bij mono', begrensd);
}
{
  const o = new K.Omhullende(SR);
  o.aanzet = 0.01; o.verval = 0.15;
  const een = new Float32Array(Q).fill(0.5), nul = new Float32Array(Q), uit = new Float32Array(Q);
  let t = 0, op10 = 0, op150 = 0;
  for (; t < 0.5 * SR; t += Q) { o.render(een, een, 2, uit, Q); if (t <= 0.01 * SR && t + Q > 0.01 * SR) op10 = uit[0.01 * SR - t]; }
  const top = uit[Q - 1];
  for (let s = 0; s < 0.3 * SR; s += Q) { o.render(nul, nul, 2, uit, Q); if (s <= 0.15 * SR && s + Q > 0.15 * SR) op150 = uit[0.15 * SR - s]; }
  ok(`omhullende: na de aanzet (10 ms) 63% (${(op10 / 0.5 * 100).toFixed(1)}%), na het verval (150 ms) 37% (${(op150 / top * 100).toFixed(1)}%)`,
    Math.abs(op10 / 0.5 - (1 - Math.exp(-1))) < 0.01 && Math.abs(op150 / top - Math.exp(-1)) < 0.01);
}

// De echte worklet in een nagebouwde AudioWorkletGlobalScope (zoals renderblok.test).
globalThis.sampleRate = SR;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {} }; } };
const PROC = {};
globalThis.registerProcessor = (naam, klasse) => { PROC[naam] = klasse; };
await import('../src/engine/fx-worklet.js');
// En de drie van spoor S10 (kam, freqschuif, aanslag): getoetst in test/effecten-s10.test.mjs.
ok('de worklet registreert de omhullende en de toonhoogte (en de drie van S10)', Object.keys(PROC).sort().join()
  === 'varve-fx-aanslag,varve-fx-freqschuif,varve-fx-kam,varve-fx-omhullende,varve-fx-toonhoogte');
{
  const toon = new PROC['varve-fx-toonhoogte'](), omh = new PROC['varve-fx-omhullende']();
  // Invoer: 64 blokken ruis + toon, vooraf gemaakt (het harnas zelf mag ook niets aanmaken).
  const INV = [];
  let x = 20261005;
  for (let b = 0; b < 64; b++) {
    const L = new Float32Array(Q), R = new Float32Array(Q);
    for (let i = 0; i < Q; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      const r = ((x >>> 8) / 16777216 - 0.5) * 0.2;
      L[i] = 0.4 * Math.sin(2 * Math.PI * 220 * (b * Q + i) / SR) + r; R[i] = L[i] * 0.8 - r;
    }
    INV.push([[L, R]]);
  }
  const uitT = [[new Float32Array(Q), new Float32Array(Q)]], uitO = [[new Float32Array(Q)]];
  const pT = { halvetonen: new Float32Array([7]) }, pO = { aanzet: new Float32Array([0.01]), verval: new Float32Array([0.15]) };
  const leeg = [[]];
  let blok = 0;
  const draai = (n) => {
    for (let i = 0; i < n; i++) {
      const inv = (blok & 1023) === 1023 ? leeg : INV[blok & 63];       // af en toe zonder invoer
      toon.process(inv, uitT, pT);
      omh.process(inv, uitO, pO);
      blok++;
    }
  };
  draai(4000);                              // opwarmen: V8 optimaliseert
  // Rekentijd: één blok van 128 frames (2,67 ms audio) van allebei, beste van drie.
  let msBlok = Infinity;
  for (let r = 0; r < 3; r++) { const t0 = performance.now(); draai(3000); msBlok = Math.min(msBlok, (performance.now() - t0) / 3000); }
  ok(`rekentijd: toonhoogte + omhullende ${(msBlok * 1000).toFixed(0)} µs per blok (< 0,5 ms van 2,67)`, msBlok < 0.5);
  ok('na opwarmen: uitgang eindig', [...uitT[0][0], ...uitT[0][1], ...uitO[0][0]].every(Number.isFinite));
  const venster = () => {
    globalThis.gc(); globalThis.gc();
    const prof = new v8.GCProfiler();
    prof.start();
    const h0 = process.memoryUsage().heapUsed;
    draai(12000);
    const h1 = process.memoryUsage().heapUsed;
    return { bytes: h1 - h0, gcs: prof.stop().statistics.length };
  };
  let beste = null, pogingen = 0;
  for (; pogingen < 30; pogingen++) {
    const r = venster();
    if (!beste || r.gcs < beste.gcs || (r.gcs === beste.gcs && r.bytes < beste.bytes)) beste = r;
    if (r.gcs === 0 && r.bytes < 1024) break;
  }
  ok(`geen afval: 12 000 blokken toonhoogte + omhullende, ${beste.gcs} GC's, ${beste.bytes} bytes heapgroei (venster ${pogingen + 1})`,
    beste.gcs === 0 && beste.bytes < 1024);
  // 'stop': daarna geeft process() false en mag de browser hem opruimen.
  toon.port.onmessage({ data: 'stop' });
  ok('na "stop" geeft process() false', toon.process(INV[0], uitT, pT) === false && omh.process(INV[0], uitO, pO) === true);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
