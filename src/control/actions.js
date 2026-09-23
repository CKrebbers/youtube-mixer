/**
 * De action-bus. Dit is het scharnierpunt van de hele app.
 *
 * Contract, en wijk hier nooit vanaf:
 *   - 'trigger' actions krijgen een boolean (true = indrukken, false = loslaten)
 *   - 'value'   actions krijgen ALTIJD een genormaliseerde 0..1
 *
 * Omdat MIDI CC ook 0..1 is (na /127) hoeft een mapping straks niets te weten
 * van dB's, hertz of seconden. Dat scheelt je in fase 2 een berg ellende.
 *
 * Sinds fase 2 kan een action ook TERUGLEZEN: `meta.read` geeft de huidige
 * stand, eveneens 0..1. Dat is geen luxe maar noodzaak — zonder die stand kan
 * soft-takeover niet weten wanneer een fysieke knop door de softwarewaarde heen
 * beweegt, en kan de LED-laag niet weten wat hij moet laten branden.
 */
import { Beatgrid, TapTempo } from '../engine/beatgrid.js';
import { EFFECTEN } from '../engine/fx.js';

const registry = new Map();

export function define(id, type, fn, meta = {}) {
  registry.set(id, { id, type, fn, meta });
}

export function invoke(id, value) {
  const a = registry.get(id);
  if (!a) { console.warn('[actions] onbekend:', id); return false; }
  a.fn(value);
  return true;
}

/**
 * Huidige stand van een action, 0..1. Null als die er niet is.
 *
 * Een read die struikelt geeft null in plaats van te gooien: deze functie wordt
 * door de LED-laag voor elke regel aangeroepen, en één kapotte getter hoort niet
 * de hele feedback om te leggen.
 */
export function read(id) {
  const a = registry.get(id);
  if (!a || !a.meta.read) return null;
  try {
    const v = a.meta.read();
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch (err) {
    console.warn(`[actions] read("${id}") struikelde:`, err?.message || err);
    return null;
  }
}

export function has(id) { return registry.has(id); }

/** Meta zonder de read-functie: label, bipolar, todo. Voor UI en LED-laag. */
export function metaOf(id) {
  const a = registry.get(id);
  if (!a) return null;
  const { read: _r, ...rest } = a.meta;
  return { id: a.id, type: a.type, ...rest };
}

/** Lijst voor UI en export. `read` blijft eruit: dat is een functie, geen data. */
export function list() {
  return [...registry.values()].map(({ id, type, meta }) => {
    const { read: _r, ...rest } = meta;
    return { id, type, meta: rest };
  });
}

/** Registreert de complete standaardset voor een engine. */
export function bindEngine(engine) {
  for (const id of ['A', 'B']) {
    const d = engine.deck(id);
    const n = `deck.${id}`;
    const bool = (fn) => () => (fn() ? 1 : 0);

    define(`${n}.play`, 'trigger', (on) => { if (on) d.togglePlay(); },
      { label: `Deck ${id} play/pause`, read: bool(() => d.playing) });
    define(`${n}.cue`, 'trigger', (on) => { if (on) d.cue(); },
      { label: `Deck ${id} cue`, read: bool(() => d.buffer && Math.abs(d.position - d.cuePoint) < 0.02) });
    define(`${n}.sync`, 'trigger', (on) => {
      if (!on) return;
      const r = engine.sync(id);
      if (!r.ok) console.warn(`[sync] deck ${id}: ${r.reden}`);
      engine.emit('sync', { id, ...r });
    }, { label: `Deck ${id} sync naar het andere deck`,
         read: () => {
           const d2 = engine.ander(id);
           if (!d.grid || !d2.grid) return 0;
           return Math.abs(d.grid.bpm * d.rate - d2.grid.bpm * d2.rate) < 0.05 ? 1 : 0;
         } });

    // ---- beatgrid ---------------------------------------------------------
    // Autodetectie faalt juist op ambient en lange sets, dus de tap is niet de
    // noodoplossing maar het hoofdgereedschap. Vier keer meetikken is genoeg.
    const tap = new TapTempo();
    define(`${n}.tap`, 'trigger', (on) => {
      if (!on || !d.buffer) return;
      const r = tap.tap(performance.now(), d.position);
      if (!r) return;
      if (d.grid) d.grid.setBpm(r.bpm, { ankerTijd: r.firstBeat ?? d.position });
      else d.setGrid(new Beatgrid({ bpm: r.bpm, firstBeat: r.firstBeat ?? d.position }));
      d.emit('change', d);
      // De UI mag dit door de server laten verfijnen: jouw tap geeft het
      // octaaf, de analyse haalt er honderdsten van een bpm van.
      engine.emit('tap', { deck: id, bpm: r.bpm, taps: r.taps });
    }, { label: `Deck ${id} tap tempo`, read: () => (d.grid ? 1 : 0) });

    define(`${n}.grid.here`, 'trigger', (on) => {
      if (!on || !d.grid) return;
      d.grid.ankerHier(d.position);
      d.emit('change', d);
    }, { label: `Deck ${id} beat 1 hier` });

    define(`${n}.grid.back`, 'trigger', (on) => { if (on && d.grid) { d.grid.schuif(-0.005); d.emit('change', d); } },
      { label: `Deck ${id} grid 5 ms terug` });
    define(`${n}.grid.fwd`, 'trigger', (on) => { if (on && d.grid) { d.grid.schuif(0.005); d.emit('change', d); } },
      { label: `Deck ${id} grid 5 ms vooruit` });
    define(`${n}.grid.double`, 'trigger', (on) => { if (on && d.grid) { d.grid.verdubbel(); d.emit('change', d); } },
      { label: `Deck ${id} bpm x2` });
    define(`${n}.grid.halve`, 'trigger', (on) => { if (on && d.grid) { d.grid.halveer(); d.emit('change', d); } },
      { label: `Deck ${id} bpm /2` });
    define(`${n}.grid.clear`, 'trigger', (on) => { if (on) { d.grid = null; tap.reset(); d.emit('change', d); } },
      { label: `Deck ${id} grid wissen`, read: () => (d.grid ? 1 : 0) });

    for (const beats of [0.25, 0.5, 1, 2, 4, 8, 16]) {
      define(`${n}.beatloop.${beats}`, 'trigger', (on) => { if (on) d.setBeatLoop(beats); },
        { label: `Deck ${id} loop ${beats} ${beats === 1 ? 'tel' : 'tellen'}`,
          read: () => (d.loopBeats === beats ? 1 : 0) });
    }

    for (let i = 0; i < 4; i++) {
      define(`${n}.hotcue.${i + 1}`, 'trigger', (on) => { if (on) d.hotcue(i); },
        { label: `Deck ${id} hotcue ${i + 1}`, read: bool(() => d.hotcues[i] !== null) });
      define(`${n}.hotcue.${i + 1}.delete`, 'trigger', (on) => { if (on) d.hotcue(i, { del: true }); },
        { label: `Deck ${id} hotcue ${i + 1} wissen` });
    }

    for (const sec of [0.5, 1, 2, 4, 8]) {
      define(`${n}.loop.${sec}`, 'trigger', (on) => { if (on) d.setLoop(sec); },
        { label: `Deck ${id} loop ${sec}s`,
          read: bool(() => d.loop && Math.abs((d.loop.end - d.loop.start) - sec) < 0.01) });
    }
    define(`${n}.loop.exit`, 'trigger', (on) => { if (on) d.clearLoop(); },
      { label: `Deck ${id} loop uit`, read: bool(() => d.loop) });
    define(`${n}.loop.halve`, 'trigger', (on) => { if (on) d.halveLoop(); }, { label: `Deck ${id} loop /2` });
    define(`${n}.loop.double`, 'trigger', (on) => { if (on) d.doubleLoop(); }, { label: `Deck ${id} loop x2` });

    define(`${n}.nudge.back`, 'trigger', (on) => { if (on) d.nudge(-0.05); }, { label: `Deck ${id} nudge -` });
    define(`${n}.nudge.fwd`, 'trigger', (on) => { if (on) d.nudge(0.05); }, { label: `Deck ${id} nudge +` });

    define(`${n}.pitch`, 'value', (v) => d.setRate(0.92 + v * 0.16),
      { label: `Deck ${id} pitch ±8%`, bipolar: true, read: () => (d.rate - 0.92) / 0.16 });
    define(`${n}.seek`, 'value', (v) => d.seek(v * d.duration),
      { label: `Deck ${id} scrub`, read: () => (d.duration ? d.position / d.duration : 0) });

    // bipolar: staat in het midden in rust. De LED-ring hoort dan pan-stijl te
    // zijn in plaats van volume-stijl; dat is het enige wat de LED-laag hoeft
    // te weten om hem goed te tekenen.
    for (const p of ['trim', 'low', 'mid', 'high', 'filter', 'fader']) {
      define(`${n}.${p}`, 'value', (v) => d.set(p, v),
        { label: `Deck ${id} ${p}`, bipolar: ['low', 'mid', 'high', 'filter'].includes(p),
          read: () => d.ui[p] });
    }

    // ---- effecten ---------------------------------------------------------
    // De knoppen wijzen naar een PLEK, niet naar een parameter. Wissel je van
    // effect, dan doet plek 1 iets anders en hoef je niets opnieuw te koppelen.
    // Dat is de hele opzet waar de racks straks op verder bouwen.
    define(`${n}.fx.mix`, 'value', (v) => d.fx.setMix(v),
      { label: `Deck ${id} FX dry/wet`, read: () => d.fx.mix });
    define(`${n}.fx.bypass`, 'trigger', (on) => { if (on) d.fx.setBypass(!d.fx.bypass); },
      { label: `Deck ${id} FX uit`, read: () => (d.fx.bypass ? 1 : 0) });
    // Acht plekken: precies de acht device knobs van één bank.
    for (let k = 1; k <= 8; k++) {
      define(`${n}.fx.knop.${k}`, 'value', (v) => d.fx.setPlek(k, v),
        { label: `Deck ${id} FX plek ${k}`,
          bipolar: false,
          read: () => d.fx.leesPlek(k) });
    }
    define(`${n}.fx.next`, 'trigger', (on) => {
      if (!on) return;
      const lijst = EFFECTEN.map((e) => e.id);
      const i = lijst.indexOf(d.fx.effectId);
      d.fx.zetEffect(lijst[(i + 1) % lijst.length]);
      d.emit('change', d);
    }, { label: `Deck ${id} volgend effect` });

    define(`${n}.focus`, 'trigger', (on) => { if (on) engine.setFocus(id); },
      { label: `Focus deck ${id}`, read: bool(() => engine.focus === id) });
  }

  define('mixer.xfader', 'value', (v) => engine.setXfader(v),
    { label: 'Crossfader', bipolar: true, read: () => engine.xfader });
  define('mixer.master', 'value', (v) => engine.setMaster(v),
    { label: 'Master', read: () => engine.masterLevel });
  define('mixer.xfader.curve', 'trigger', (on) => {
    if (on) engine.setXfaderCurve(engine.xfaderCurve === 'smooth' ? 'sharp' : 'smooth');
  }, { label: 'Crossfader-curve wisselen', read: () => (engine.xfaderCurve === 'sharp' ? 1 : 0) });
}
