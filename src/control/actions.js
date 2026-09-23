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
import { DECK_IDS, XFADE_KANTEN } from '../engine/engine.js';
import { PITCH_BEREIKEN } from '../engine/deck.js';
import { VIDEO_FX, MODI } from '../video/instellingen.js';
import { PULS_DOELEN } from '../video/puls.js';

const registry = new Map();

export function define(id, type, fn, meta = {}) {
  registry.set(id, { id, type, fn, meta });
}

export function invoke(id, value) {
  const a = registry.get(id);
  if (!a) { console.warn('[actions] onbekend:', id); return false; }
  // Een action die gooit mag de aanroeper niet meenemen: de MIDI-hub stuurt
  // het bericht daarna nog naar de monitor, en juist dán wil je het zien.
  try {
    a.fn(value);
  } catch (err) {
    console.error(`[actions] ${id} faalde:`, err);
    for (const f of foutLuisteraars) { try { f(id, err); } catch (_) {} }
    return false;
  }
  return true;
}

const foutLuisteraars = new Set();
/** Laat weten als een action faalt, om het op het scherm te zetten. */
export function bijFout(fn) { foutLuisteraars.add(fn); return () => foutLuisteraars.delete(fn); }

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

/** Welke track op welk engine-deck zit. Eén plek, zodat acht er later bij passen. */
export const TRACKS = DECK_IDS.map((id, i) => [i + 1, id]);
export const trackVanDeck = (id) => TRACKS.find(([, d]) => d === id)?.[0] ?? null;

/** Registreert de complete standaardset voor een engine. */
export function bindEngine(engine) {
  // De bus spreekt in TRACKS, de engine nog in decks A en B. Track 1 = A,
  // track 2 = B. Zo hoeven mappings niet opnieuw als er acht tracks komen:
  // dan groeit deze lijst, en veranderen de namen niet nog een keer.
  for (const [nr, id] of TRACKS) {
    const d = engine.deck(id);
    const n = `track.${nr}`;
    const bool = (fn) => () => (fn() ? 1 : 0);

    define(`${n}.play`, 'trigger', (on) => { if (on) d.togglePlay(); },
      { label: `Track ${nr} play/pause`, read: bool(() => d.playing) });
    define(`${n}.cue`, 'trigger', (on) => { if (on) d.cue(); },
      { label: `Track ${nr} cue`, read: bool(() => d.buffer && Math.abs(d.position - d.cuePoint) < 0.02) });
    define(`${n}.sync`, 'trigger', (on) => {
      if (!on) return;
      const r = engine.sync(id);
      if (!r.ok) engine.emit('melding', { tekst: `sync track ${nr}: ${r.reden}`, soort: 'fout' });
      engine.emit('sync', { id, ...r });
    }, { label: `Track ${nr} sync naar de luidste track`,
         read: () => {
           const d2 = engine.syncMaster(id);
           if (!d.grid || !d2?.grid) return 0;
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
      // Je tikt mee met wat je HOORT (grid × rate), maar het grid staat in
      // TRACKTIJD. Zonder deze deling stond het grid op +5% pitch 5% fout,
      // en de verfijning op de server zoekt maar binnen 3% en kon het niet
      // meer rechtzetten.
      const bpm = r.bpm / (d.rate || 1);
      if (d.grid) d.grid.setBpm(bpm, { ankerTijd: r.firstBeat ?? d.position });
      else d.setGrid(new Beatgrid({ bpm, firstBeat: r.firstBeat ?? d.position }));
      d.emit('change', d);
      // De UI mag dit door de server laten verfijnen: jouw tap geeft het
      // octaaf, de analyse haalt er honderdsten van een bpm van.
      engine.emit('tap', { deck: id, bpm, taps: r.taps });
    }, { label: `Track ${nr} tap tempo`, read: () => (d.grid ? 1 : 0) });

    define(`${n}.grid.here`, 'trigger', (on) => {
      if (!on || !d.grid) return;
      d.grid.ankerHier(d.position);
      d.emit('change', d);
    }, { label: `Track ${nr} beat 1 hier` });

    define(`${n}.grid.back`, 'trigger', (on) => { if (on && d.grid) { d.grid.schuif(-0.005); d.emit('change', d); } },
      { label: `Track ${nr} grid 5 ms terug` });
    define(`${n}.grid.fwd`, 'trigger', (on) => { if (on && d.grid) { d.grid.schuif(0.005); d.emit('change', d); } },
      { label: `Track ${nr} grid 5 ms vooruit` });
    define(`${n}.grid.double`, 'trigger', (on) => { if (on && d.grid) { d.grid.verdubbel(); d.emit('change', d); } },
      { label: `Track ${nr} bpm x2` });
    define(`${n}.grid.halve`, 'trigger', (on) => { if (on && d.grid) { d.grid.halveer(); d.emit('change', d); } },
      { label: `Track ${nr} bpm /2` });
    define(`${n}.grid.clear`, 'trigger', (on) => { if (on) { d.grid = null; tap.reset(); d.emit('change', d); } },
      { label: `Track ${nr} grid wissen`, read: () => (d.grid ? 1 : 0) });

    for (const beats of [0.25, 0.5, 1, 2, 4, 8, 16]) {
      define(`${n}.beatloop.${beats}`, 'trigger', (on) => { if (on) d.setBeatLoop(beats); },
        { label: `Track ${nr} loop ${beats} ${beats === 1 ? 'tel' : 'tellen'}`,
          read: () => (d.loopBeats === beats ? 1 : 0) });
    }

    for (let i = 0; i < 4; i++) {
      define(`${n}.hotcue.${i + 1}`, 'trigger', (on) => { if (on) d.hotcue(i); },
        { label: `Track ${nr} hotcue ${i + 1}`, read: bool(() => d.hotcues[i] !== null) });
      define(`${n}.hotcue.${i + 1}.delete`, 'trigger', (on) => { if (on) d.hotcue(i, { del: true }); },
        { label: `Track ${nr} hotcue ${i + 1} wissen` });
    }

    for (const sec of [0.5, 1, 2, 4, 8]) {
      define(`${n}.loop.${sec}`, 'trigger', (on) => { if (on) d.setLoop(sec); },
        { label: `Track ${nr} loop ${sec}s`,
          read: bool(() => d.loop && Math.abs((d.loop.end - d.loop.start) - sec) < 0.01) });
    }
    define(`${n}.loop.exit`, 'trigger', (on) => { if (on) d.clearLoop(); },
      { label: `Track ${nr} loop uit`, read: bool(() => d.loop) });
    define(`${n}.loop.halve`, 'trigger', (on) => { if (on) d.halveLoop(); }, { label: `Track ${nr} loop /2` });
    define(`${n}.loop.double`, 'trigger', (on) => { if (on) d.doubleLoop(); }, { label: `Track ${nr} loop x2` });

    define(`${n}.nudge.back`, 'trigger', (on) => { if (on) d.nudge(-0.05); }, { label: `Track ${nr} nudge -` });
    define(`${n}.nudge.fwd`, 'trigger', (on) => { if (on) d.nudge(0.05); }, { label: `Track ${nr} nudge +` });

    // Het bereik (±8/16/50%) zit in het deck; de fader blijft 0..1. De read
    // is geklemd: sync mag verder dan het bereik, en dan staat hij tegen de aanslag.
    define(`${n}.pitch`, 'value', (v) => d.setPitch(v),
      { label: `Track ${nr} pitch`, bipolar: true, read: () => d.pitch });
    define(`${n}.pitch.bereik`, 'trigger', (on) => { if (on) d.volgendBereik(); },
      { label: `Track ${nr} pitchbereik ±8 / ±16 / ±50%`, read: () => PITCH_BEREIKEN.indexOf(d.pitchBereik) / (PITCH_BEREIKEN.length - 1) });
    define(`${n}.seek`, 'value', (v) => d.seek(v * d.duration),
      { label: `Track ${nr} scrub`, read: () => (d.duration ? d.position / d.duration : 0) });

    // bipolar: staat in het midden in rust. De LED-ring hoort dan pan-stijl te
    // zijn in plaats van volume-stijl; dat is het enige wat de LED-laag hoeft
    // te weten om hem goed te tekenen.
    for (const p of ['trim', 'low', 'mid', 'high', 'filter', 'fader']) {
      define(`${n}.${p}`, 'value', (v) => d.set(p, v),
        { label: `Track ${nr} ${p}`, bipolar: ['low', 'mid', 'high', 'filter'].includes(p),
          read: () => d.ui[p] });
    }

    // Sends: na de fader naar de gedeelde echo (A) en galm (B).
    for (const bus of ['A', 'B']) {
      define(`${n}.send.${bus.toLowerCase()}`, 'value', (v) => d.set(`send${bus}`, v),
        { label: `Track ${nr} send ${bus} (${bus === 'A' ? 'echo' : 'galm'})`, read: () => d.ui[`send${bus}`] });
    }

    // ---- effecten ---------------------------------------------------------
    // De knoppen wijzen naar een PLEK, niet naar een parameter. Wissel je van
    // effect, dan doet plek 1 iets anders en hoef je niets opnieuw te koppelen.
    // Dat is de hele opzet waar de racks straks op verder bouwen.
    define(`${n}.fx.mix`, 'value', (v) => d.fx.setMix(v),
      { label: `Track ${nr} FX dry/wet`, read: () => d.fx.mix });
    define(`${n}.fx.bypass`, 'trigger', (on) => { if (on) d.fx.setBypass(!d.fx.bypass); },
      { label: `Track ${nr} FX uit`, read: () => (d.fx.bypass ? 1 : 0) });
    // Acht plekken: precies de acht device knobs van één bank.
    for (let k = 1; k <= 8; k++) {
      define(`${n}.fx.knop.${k}`, 'value', (v) => d.fx.setPlek(k, v),
        { label: `Track ${nr} FX plek ${k}`,
          bipolar: false,
          read: () => d.fx.leesPlek(k) });
    }
    define(`${n}.fx.next`, 'trigger', (on) => {
      if (!on) return;
      const lijst = EFFECTEN.map((e) => e.id);
      const i = lijst.indexOf(d.fx.effectId);
      d.fx.zetEffect(lijst[(i + 1) % lijst.length]);
      d.emit('change', d);
    }, { label: `Track ${nr} volgend effect` });

    define(`${n}.focus`, 'trigger', (on) => { if (on) engine.setFocus(id); },
      { label: `Focus track ${nr}`, read: bool(() => engine.focus === id) });

    // Eén knop voor loop aan/uit (Clip stop op de APC): 8 tellen met grid, anders 4 s.
    define(`${n}.loop.wissel`, 'trigger', (on) => {
      if (!on || !d.buffer) return;
      if (d.loop) d.clearLoop();
      else if (d.grid) d.setBeatLoop(8);
      else d.setLoop(4);
    }, { label: `Track ${nr} loop aan/uit`, read: bool(() => d.loop) });

    // Alleen om uit te lezen, voor LED's: geeft deze track de maat, en valt nu
    // de tel? Afgeleid van positie en grid (regel 3), geen eigen teller.
    define(`${n}.maat`, 'trigger', () => {}, { label: `Track ${nr} geeft de maat (alleen lezen)`,
      read: bool(() => engine.syncMaster()?.id === id) });
    define(`${n}.tel`, 'trigger', () => {}, { label: `Track ${nr} op de tel (alleen lezen)`,
      read: bool(() => d.playing && d.grid && d.grid.phase(d.position) < 0.15) });

    // Crossfader-toewijzing: A -> B -> thru -> A, zoals de knop op de APC.
    // read() geeft 0 / 0.5 / 1 zodat een LED er drie standen van kan maken.
    define(`${n}.xfade.kant`, 'trigger', (on) => {
      if (!on) return;
      const i = XFADE_KANTEN.indexOf(engine.kant[id]);
      engine.setKant(id, XFADE_KANTEN[(i + 1) % XFADE_KANTEN.length]);
    }, { label: `Track ${nr} crossfader A/B/thru`,
         read: () => ({ A: 0, B: 1, thru: 0.5 })[engine.kant[id]] });
    // En per kant een eigen knop: op het scherm één klik naar de juiste kant,
    // zonder langs een kant te komen die de track stilzet.
    for (const kant of XFADE_KANTEN) {
      define(`${n}.xfade.${kant.toLowerCase()}`, 'trigger', (on) => { if (on) engine.setKant(id, kant); },
        { label: `Track ${nr} crossfader ${kant}`, read: bool(() => engine.kant[id] === kant) });
    }
  }

  // De knoppen van de twee bussen: plekken, net als bij de tracks.
  for (const [bus, slot] of Object.entries(engine.sends || {})) {
    for (let k = 1; k <= 8; k++) {
      define(`send.${bus.toLowerCase()}.knop.${k}`, 'value', (v) => slot.setPlek(k, v),
        { label: `Send ${bus} knop ${k}`, read: () => slot.leesPlek(k) });
    }
  }

  // ---- sampler: acht pads -------------------------------------------------
  // Leeg: pak de laatste tellen van de track met focus — of, als er een
  // bewaard stuk op deze pad wacht, knip dat opnieuw. Gevuld: start op de
  // volgende tel, of stop. Shift (de .wis-variant): een gevulde pad leeg
  // maken (bewaard blijft bewaard); een lege, bewaarde pad vergeten.
  const sampler = engine.sampler;
  if (sampler) {
    for (let i = 0; i < 8; i++) {
      define(`sampler.${i + 1}`, 'trigger', (on) => {
        if (!on) return;
        if (sampler.pads[i]) { sampler.wissel(i); return; }
        const fout = (err) => engine.emit('melding', { tekst: `sampler pad ${i + 1}: ${err.message}`, soort: 'fout' });
        const h = sampler.herinneringen[i];
        if (h) { sampler.herstel(i, engine.deck(h.deckId)).catch(fout); return; }
        const deck = engine.focused();
        sampler.neem(i, deck, { bron: trackVanDeck(deck.id) }).catch(fout);
      }, { label: `Sampler pad ${i + 1}`,
           read: () => (sampler.pads[i]?.speelt ? 1 : sampler.pads[i] ? 0.5 : 0) });
      define(`sampler.${i + 1}.wis`, 'trigger', (on) => {
        if (!on) return;
        if (sampler.pads[i]) sampler.wis(i);
        else sampler.vergeet(i);
      }, { label: `Sampler pad ${i + 1} leegmaken (leeg + bewaard: vergeten)` });
    }
    define('sampler.lengte', 'trigger', (on) => { if (on) sampler.volgendeLengte(); },
      { label: 'Sampler: hoeveel tellen', read: () => [1, 2, 4, 8].indexOf(sampler.tellen) / 3 });
    define('sampler.volume', 'value', (v) => sampler.setVolume(v),
      { label: 'Sampler volume', read: () => sampler.volume });
  }

  // Focus door de tracks: de pijlen op de APC.
  const focusStap = (stap) => {
    const i = DECK_IDS.indexOf(engine.focus);
    engine.setFocus(DECK_IDS[(i + stap + DECK_IDS.length) % DECK_IDS.length]);
  };
  define('focus.vorige', 'trigger', (on) => { if (on) focusStap(-1); }, { label: 'Focus: vorige track' });
  define('focus.volgende', 'trigger', (on) => { if (on) focusStap(1); }, { label: 'Focus: volgende track' });

  define('mixer.xfader', 'value', (v) => engine.setXfader(v),
    { label: 'Crossfader', bipolar: true, read: () => engine.xfader });
  define('mixer.master', 'value', (v) => engine.setMaster(v),
    { label: 'Master', read: () => engine.masterLevel });
  define('mixer.xfader.curve', 'trigger', (on) => {
    if (on) engine.setXfaderCurve(engine.xfaderCurve === 'smooth' ? 'sharp' : 'smooth');
  }, { label: 'Crossfader-curve wisselen', read: () => (engine.xfaderCurve === 'sharp' ? 1 : 0) });
}

/**
 * De video-actions. Apart van bindEngine: de video is geen engine (regel 1),
 * maar wat je eraan draait hoort wél op de bus — dan kan een APC-knop het
 * net zo goed als de muis, en volgen de knoppen op het scherm vanzelf.
 */
export function bindVideo(mixer) {
  for (const fx of VIDEO_FX) {
    define(`video.fx.${fx.id}`, 'value', (v) => mixer.zetFx(fx.id, v),
      { label: `Video ${fx.naam}`, bipolar: !!fx.bipolair, read: () => mixer.fx[fx.id] });
  }
  define('video.modus', 'trigger', (on) => { if (on) mixer.volgendeModus(); },
    { label: 'Video: volgende mengvorm', read: () => MODI.indexOf(mixer.modus) / (MODI.length - 1) });
  define('video.puls', 'value', (v) => mixer.zetPuls(v),
    { label: 'Video: puls op de tel', read: () => mixer.puls });
  define('video.puls.doel', 'trigger', (on) => { if (on) mixer.volgendPulsDoel(); },
    { label: 'Video: wat er pulst', read: () => PULS_DOELEN.indexOf(mixer.pulsDoel) / (PULS_DOELEN.length - 1) });
}

/**
 * Wat de schermlaag doet maar op de bus hoort, zodat een APC-knop het kan:
 * een track in een venster zetten, opnemen, door racks bladeren. De functies
 * komen van app.js; hier alleen de namen en de read.
 */
export function bindApp({ toon, venster, opnemer, opnameStart, opnameStop, opnameSoort, rackStap }) {
  for (const [nr, id] of TRACKS) {
    for (const v of ['L', 'R']) {
      define(`venster.${v}.toon.${nr}`, 'trigger', (on) => { if (on) toon(v, id); },
        { label: `Track ${nr} in het ${v === 'L' ? 'linker' : 'rechter'}venster`, read: () => (venster()[v] === id ? 1 : 0) });
    }
    define(`track.${nr}.rack.volgend`, 'trigger', (on) => { if (on) rackStap(id, 1); }, { label: `Track ${nr} volgend rack` });
    define(`track.${nr}.rack.vorig`, 'trigger', (on) => { if (on) rackStap(id, -1); }, { label: `Track ${nr} vorig rack` });
  }
  define('opname.start', 'trigger', (on) => { if (on && !opnemer.bezig) opnameStart(); },
    { label: 'Opname starten', read: () => (opnemer.bezig ? 1 : 0) });
  define('opname.stop', 'trigger', (on) => { if (on && opnemer.bezig) opnameStop(); },
    { label: 'Opname stoppen (zet hem achter shift)', read: () => (opnemer.bezig ? 1 : 0) });
  define('opname.soort', 'trigger', (on) => { if (on && !opnemer.bezig) opnameSoort(); },
    { label: 'Opname: audio of audio + video', read: () => (opnemer.metVideo ? 1 : 0) });
}
