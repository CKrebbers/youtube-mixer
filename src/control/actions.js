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
import { Beatgrid, TapTempo, MIN_BPM, MAX_BPM, snapNaarOnset } from '../engine/beatgrid.js';
import { EFFECTEN } from '../engine/fx.js';
import { DECK_IDS, XFADE_KANTEN, ONZEKER } from '../engine/engine.js';
import { PITCH_BEREIKEN } from '../engine/deck.js';
import { VIDEO_FX, MODI } from '../video/instellingen.js';
import { PULS_DOELEN } from '../video/puls.js';
import { FITS } from '../video/passen.js';
import { EQ_BANDEN, REM_MIN, REM_MAX } from '../engine/deck.js';
import { GROEPEN, LAAGNAAM } from './lagen.js';

const registry = new Map();

/** Het rate-bereik van `track.N.tempo`; gelijk aan de klem in deck.setRate. */
const RATE_MIN = 0.5;
const RATE_MAX = 2;

export function define(id, type, fn, meta = {}) {
  registry.set(id, { id, type, fn, meta });
}

/**
 * Een knopplek als drukknop: indrukken = vol open, loslaten = terug waar hij
 * stond. Voor een dub-worp of een galm vasthouden, zolang je de knop vasthoudt.
 * Direct, zonder glijden: een worp moet op het moment van drukken klinken.
 * Wisselt het rack terwijl je drukt, dan niet terugzetten: de oude stand
 * betekent in het nieuwe rack iets anders.
 */
function drukknop(slotVan, k) {
  let vast = null;                 // { stand, rack } zolang ingedrukt
  const fn = (on) => {
    const slot = slotVan();
    if (!slot) return;
    if (on) {
      if (vast) return;              // twee bronnen tegelijk: de eerste stand telt
      const stand = slot.leesPlek(k);
      if (stand === null) return;    // deze plek bestaat niet in dit rack
      vast = { stand, rack: slot.rack };
      slot.setPlek(k, 1, { direct: true });
    } else if (vast) {
      if (slot.rack === vast.rack) slot.setPlek(k, vast.stand, { direct: true });
      vast = null;
    }
  };
  return { fn, ingedrukt: () => (vast ? 1 : 0) };
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
    // Wat je NU hoort, in tracktijd: tijdens spelen de positie min de
    // uitgangsvertraging (× rate, want de positie loopt in tracktijd), net als
    // de video-puls. Stilstaand is de positie zelf wat je hoort en ziet.
    const hoorbaar = () => {
      if (!d.playing) return d.position;
      const c = engine.ctx;
      return d.position - ((c?.outputLatency || 0) + (c?.baseLatency || 0)) * (d.rate || 1);
    };

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
           return Math.abs(d.bpm - d2.bpm) < 0.05 ? 1 : 0;   // hoorbaar, op de plek waar ze nu zijn
         } });

    // ---- beatgrid ---------------------------------------------------------
    // Autodetectie faalt juist op ambient en lange sets, dus de tap is niet de
    // noodoplossing maar het hoofdgereedschap. Vier keer meetikken is genoeg.
    const tap = new TapTempo();
    define(`${n}.tap`, 'trigger', (on) => {
      if (!on || !d.buffer) return;
      const r = tap.tap(performance.now(), d.position);
      if (!r) return;
      // Speelt de track, dan gaat de lijn door de TRACKTIJDEN van de tikken en
      // is het tempo meteen in tracktijd. Staat hij stil, dan door de klok:
      // je tikt mee met wat je HOORT (grid × rate), dus delen door de rate.
      // Zonder die deling stond het grid op +5% pitch 5% fout.
      const bpm = r.bpmTrack ?? r.bpm / (d.rate || 1);
      const anker = r.anker ?? d.position;
      // Alleen het stuk waar je tikte; zonder grid een nieuw grid van één stuk.
      if (d.grid) d.grid.zetStuk(anker, { bpm, anker });
      else d.setGrid(new Beatgrid({ bpm, firstBeat: anker }));
      // Vier tikken is een meting met de hand: op slot, zodat een automatisch
      // voorstel (stap C) hem nooit overschrijft. Minder is nog zoeken.
      if (r.taps >= 4) d.grid.slot = true;
      d.gridGewijzigd();
      // De UI mag dit door de server laten verfijnen: jouw tap geeft het
      // octaaf en de fase, de analyse haalt er honderdsten van een bpm van.
      engine.emit('tap', { deck: id, bpm, taps: r.taps, anker, tijden: r.tijden, positie: anker });
    }, { label: `Track ${nr} tap tempo`, read: () => (d.grid ? 1 : 0) });

    // Grid bewerken "vanaf hier": alles raakt alleen het STUK waar je bent.
    // "Hier" is wat je HOORT (hoorbaar()), anders zet je een tel een
    // uitgangsvertraging te laat. Met één stuk is dat het hele grid.
    const bewerk = (fn) => (on) => { if (on && d.grid) { fn(d.grid, hoorbaar()); d.gridGewijzigd(); } };
    // Voor de scene-knoppen in de grid-modus: read null zonder grid (niets te
    // doen), 1 zolang ingedrukt (je ziet dat hij het deed), anders `rust()`.
    const gridKnop = (id, fn, label, rust = () => 0) => {
      let ingedrukt = false;
      const doe = bewerk(fn);
      define(`${n}.grid.${id}`, 'trigger', (on) => { ingedrukt = !!on; doe(on); },
        { label, read: () => (!d.grid ? null : ingedrukt ? 1 : rust()) });
    };
    // Tel 1 hier SNAPT naar de dichtstbijzijnde klap binnen 30 ms (de onsets
    // van de analyse, stap C); geen klap of geen analyse: de positie zelf.
    gridKnop('here', (g, p) => g.ankerHier(snapNaarOnset(d.onsets, p)), `Track ${nr} beat 1 hier (snapt naar een klap)`);
    define(`${n}.grid.back`, 'trigger', bewerk((g, p) => g.schuif(-0.005, p)), { label: `Track ${nr} grid 5 ms terug` });
    define(`${n}.grid.fwd`, 'trigger', bewerk((g, p) => g.schuif(0.005, p)), { label: `Track ${nr} grid 5 ms vooruit` });
    define(`${n}.grid.back.fine`, 'trigger', bewerk((g, p) => g.schuif(-0.001, p)), { label: `Track ${nr} grid 1 ms terug` });
    define(`${n}.grid.fwd.fine`, 'trigger', bewerk((g, p) => g.schuif(0.001, p)), { label: `Track ${nr} grid 1 ms vooruit` });
    gridKnop('double', (g, p) => g.verdubbel(p), `Track ${nr} bpm x2`);
    gridKnop('halve', (g, p) => g.halveer(p), `Track ${nr} bpm /2`);
    gridKnop('halfbeat', (g, p) => g.schuifTel(0.5, p), `Track ${nr} grid een halve tel verschuiven`);
    gridKnop('split', (g, p) => g.splits(p), `Track ${nr} nieuw gridstuk hier`,
      () => (d.grid.aantalStukken > 1 ? 0.5 : 0));
    // Tempo van het stuk waar je bent, als value 0..1 over het hele bpm-bereik
    // (regel 2: de mapping weet niets van bpm). Lineair, zodat een encoder-tik
    // overal even groot is: 0,01 bpm = step 0,01 / 260. De tel die het dichtst
    // bij wat je hoort ligt blijft liggen (setBpm met `bij`).
    define(`${n}.grid.bpm`, 'value', (v) => {
      if (!d.grid) return;
      d.grid.setBpm(MIN_BPM + Math.min(1, Math.max(0, v)) * (MAX_BPM - MIN_BPM), { bij: hoorbaar() });
      d.gridGewijzigd();
    }, { label: `Track ${nr} bpm van het gridstuk hier (${MIN_BPM}–${MAX_BPM}, voor een encoder)`,
         read: () => (!d.grid ? null : (d.grid.bpmAt(hoorbaar()) - MIN_BPM) / (MAX_BPM - MIN_BPM)) });
    define(`${n}.grid.merge`, 'trigger', bewerk((g, p) => g.voegSamen(p)),
      { label: `Track ${nr} gridstuk samenvoegen met het vorige` });
    define(`${n}.grid.lock`, 'trigger', bewerk((g) => { g.slot = !g.slot; }),
      { label: `Track ${nr} grid op slot`, read: () => (!d.grid ? null : d.grid.slot ? 1 : 0) });
    define(`${n}.grid.clear`, 'trigger', (on) => { if (on) { tap.reset(); d.setGrid(null); } },
      { label: `Track ${nr} grid wissen`, read: () => (d.grid ? 1 : 0) });

    // Reads voor de LED's (VRAGEN B4): null = niets te doen (lege track, geen
    // grid), 0 = leeg maar bruikbaar, 0,5 = gevuld, 1 = actief.
    for (const beats of [0.25, 0.5, 1, 2, 4, 8, 16]) {
      define(`${n}.beatloop.${beats}`, 'trigger', (on) => {
        if (!on) return;
        // In een onzeker stuk niet stil verkeerd loopen, maar zeggen waarom.
        if (d.grid && d.gridZekerHier === false) engine.emit('melding', { tekst: `track ${nr}: ${ONZEKER}`, soort: 'fout' });
        else d.setBeatLoop(beats);
      }, { label: `Track ${nr} loop ${beats} ${beats === 1 ? 'tel' : 'tellen'}`,
          read: () => (!d.buffer || !d.grid || d.gridZekerHier === false ? null : d.loopBeats === beats ? 1 : 0) });
    }

    for (let i = 0; i < 4; i++) {
      // Actief = ingedrukt: je ziet onder je vinger dat de pad het deed.
      let ingedrukt = false;
      define(`${n}.hotcue.${i + 1}`, 'trigger', (on) => { ingedrukt = !!on; if (on) d.hotcue(i); },
        { label: `Track ${nr} hotcue ${i + 1}`,
          read: () => (!d.buffer ? null : d.hotcues[i] === null ? 0 : ingedrukt ? 1 : 0.5) });
      define(`${n}.hotcue.${i + 1}.delete`, 'trigger', (on) => { if (on) d.hotcue(i, { del: true }); },
        { label: `Track ${nr} hotcue ${i + 1} wissen`,
          read: () => (!d.buffer ? null : d.hotcues[i] !== null ? 1 : 0) });
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
    // Bend: zolang je drukt 4% trager of sneller, loslaten = terug. Zo werkt
    // nudge op elke DJ-controller; nudge.back/fwd hierboven springt 50 ms.
    define(`${n}.bend.back`, 'trigger', (on) => d.bend(on ? -1 : 0), { label: `Track ${nr} even trager (zolang je drukt)`, read: () => (d.buigt < 0 ? 1 : 0) });
    define(`${n}.bend.fwd`, 'trigger', (on) => d.bend(on ? 1 : 0), { label: `Track ${nr} even sneller (zolang je drukt)`, read: () => (d.buigt > 0 ? 1 : 0) });

    // Rem (vinylstop): in de remtijd naar stilstand, dan gepauzeerd op die
    // plek. Nog eens drukken tijdens het remmen = los (meteen weer op tempo).
    // Lampje: 1 = remt, 0 = speelt (er valt te remmen), null = staat stil.
    define(`${n}.brake`, 'trigger', (on) => { if (on) d.rem(); },
      { label: `Track ${nr} rem (vinylstop); tijdens het remmen nog eens = los`,
        read: () => (d.remt ? 1 : d.playing ? 0 : null) });
    // Remtijd in seconden, exponentieel (de engine schaalt, regel 2).
    define(`${n}.brake.time`, 'value', (v) => d.setRemTijd(v),
      { label: `Track ${nr} remtijd (${REM_MIN}–${REM_MAX} s)`, read: () => d.remKnop });

    // Het bereik (±8/16/50%) zit in het deck; de fader blijft 0..1. De read
    // is geklemd: sync mag verder dan het bereik, en dan staat hij tegen de aanslag.
    define(`${n}.pitch`, 'value', (v) => d.setPitch(v),
      { label: `Track ${nr} pitch`, bipolar: true, read: () => d.pitch });
    // Tempo over het HELE rate-bereik (0,5–2x), lineair: voor een encoder.
    // Op `pitch` rekent een encoder vanaf de geklemde read, en na een sync
    // buiten het bereik sprong één tik dan van 1,30 naar 1,16. Deze read is
    // niet geklemd, dus een tik verzet de rate met step × 1,5, waar hij ook
    // staat (0,1% = step 0,001/1,5). Het klemmen op 0,5–2 doet setRate.
    define(`${n}.tempo`, 'value', (v) => d.setRate(RATE_MIN + Math.min(1, Math.max(0, v)) * (RATE_MAX - RATE_MIN)),
      { label: `Track ${nr} tempo (0,5–2x, voor een encoder)`, read: () => (d.rate - RATE_MIN) / (RATE_MAX - RATE_MIN) });
    define(`${n}.pitch.range`, 'trigger', (on) => { if (on) d.volgendBereik(); },
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

    // EQ-kill per band: een schakelaar (aan/uit) en een drukknop (weg zolang
    // je drukt). De knopstand blijft staan, dus kill uit is precies terug.
    // Lampje, voor beide: 1 = de band is weg (door schakelaar of drukknop),
    // 0 = open, null = lege track zonder kill (niets te doen).
    for (const band of EQ_BANDEN) {
      const naam = { low: 'laag', mid: 'midden', high: 'hoog' }[band];
      const stand = () => (d.gekild(band) ? 1 : d.buffer ? 0 : null);
      define(`${n}.kill.${band}`, 'trigger', (on) => { if (on) d.toggleKill(band); },
        { label: `Track ${nr} kill ${naam} aan/uit`, read: stand });
      define(`${n}.kill.${band}.hold`, 'trigger', (on) => d.houdKill(band, !!on),
        { label: `Track ${nr} kill ${naam} zolang je drukt`, read: stand });
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
    // read = bypass (1 = effect UIT); de LED draait dat om (feedback.js).
    // Zonder effect in de slot valt er niets aan of uit te zetten: null.
    define(`${n}.fx.bypass`, 'trigger', (on) => { if (on) d.fx.setBypass(!d.fx.bypass); },
      { label: `Track ${nr} FX uit`, read: () => (!d.fx.effectId ? null : d.fx.bypass ? 1 : 0) });
    // Acht plekken: precies de acht device knobs van één bank.
    for (let k = 1; k <= 8; k++) {
      define(`${n}.fx.knob.${k}`, 'value', (v) => d.fx.setPlek(k, v),
        { label: `Track ${nr} FX plek ${k}`,
          bipolar: false,
          read: () => d.fx.leesPlek(k) });
      const druk = drukknop(() => d.fx, k);
      define(`${n}.fx.knob.${k}.hold`, 'trigger', druk.fn,
        { label: `Track ${nr} FX plek ${k} vasthouden (open zolang ingedrukt)`, read: druk.ingedrukt });
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
    define(`${n}.loop.toggle`, 'trigger', (on) => {
      if (!on || !d.buffer) return;
      if (d.loop) d.clearLoop();
      else if (d.grid) d.setBeatLoop(8);
      else d.setLoop(4);
    }, { label: `Track ${nr} loop aan/uit`, read: () => (!d.buffer ? null : d.loop ? 1 : 0) });

    // Alleen om uit te lezen, voor LED's: geeft deze track de maat, en valt nu
    // de tel? Afgeleid van positie en grid (regel 3), geen eigen teller.
    define(`${n}.leads`, 'trigger', () => {}, { label: `Track ${nr} geeft de maat (alleen lezen)`,
      read: bool(() => engine.syncMaster()?.id === id) });
    define(`${n}.beat`, 'trigger', () => {}, { label: `Track ${nr} op de tel (alleen lezen)`,
      read: bool(() => d.playing && d.grid && d.grid.phase(d.position) < 0.15) });
    // Fase binnen de tel van wat je HOORT: positie min de uitgangsvertraging
    // (× rate, want de positie loopt in tracktijd), zoals de video-puls. Voor
    // LED's die op de tel knipperen. null als hij niet speelt of geen grid heeft.
    define(`${n}.phase`, 'trigger', () => {}, { label: `Track ${nr} fase binnen de tel (alleen lezen)`,
      read: () => {
        if (!d.playing || !d.grid) return null;
        return d.grid.phase(hoorbaar());
      } });

    // Crossfader-toewijzing: A -> B -> thru -> A, zoals de knop op de APC.
    // read() geeft 0 / 0.5 / 1 zodat een LED er drie standen van kan maken.
    define(`${n}.xfade.side`, 'trigger', (on) => {
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
      define(`send.${bus.toLowerCase()}.knob.${k}`, 'value', (v) => slot.setPlek(k, v),
        { label: `Send ${bus} knop ${k}`, read: () => slot.leesPlek(k) });
      const druk = drukknop(() => slot, k);
      define(`send.${bus.toLowerCase()}.knob.${k}.hold`, 'trigger', druk.fn,
        { label: `Send ${bus} knop ${k} vasthouden (open zolang ingedrukt)`, read: druk.ingedrukt });
    }
  }

  // ---- sampler: acht pads -------------------------------------------------
  // Leeg: pak de laatste tellen van de track met focus — of, als er een
  // bewaard stuk op deze pad wacht, knip dat opnieuw. Gevuld: start op de
  // volgende tel, of stop. Shift (de .clear-variant): een gevulde pad leeg
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
      define(`sampler.${i + 1}.clear`, 'trigger', (on) => {
        if (!on) return;
        if (sampler.pads[i]) sampler.wis(i);
        else sampler.vergeet(i);
      }, { label: `Sampler pad ${i + 1} leegmaken (leeg + bewaard: vergeten)`,
           // 0,5: er valt iets te wissen (gedimd rood); dit staat niet achter
           // shift, dus vol rood zou de hele tijd schreeuwen.
           read: () => (sampler.pads[i] || sampler.herinneringen?.[i] ? 0.5 : 0) });
    }
    define('sampler.length', 'trigger', (on) => { if (on) sampler.volgendeLengte(); },
      { label: 'Sampler: hoeveel tellen', read: () => [1, 2, 4, 8].indexOf(sampler.tellen) / 3 });
    define('sampler.volume', 'value', (v) => sampler.setVolume(v),
      { label: 'Sampler volume', read: () => sampler.volume });
  }

  // Focus door de tracks: de pijlen op de APC.
  const focusStap = (stap) => {
    const i = DECK_IDS.indexOf(engine.focus);
    engine.setFocus(DECK_IDS[(i + stap + DECK_IDS.length) % DECK_IDS.length]);
  };
  define('focus.prev', 'trigger', (on) => { if (on) focusStap(-1); }, { label: 'Focus: vorige track' });
  define('focus.next', 'trigger', (on) => { if (on) focusStap(1); }, { label: 'Focus: volgende track' });

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
/** Action-namen van de video-effecten: Engels, net als de rest van de bus. Intern heten ze nog Nederlands. */
export const VIDEO_FX_ACTIE = { spiegel: 'mirror', kleur: 'color', sporen: 'trails', korrel: 'grain' };

export function bindVideo(mixer) {
  for (const fx of VIDEO_FX) {
    define(`video.fx.${VIDEO_FX_ACTIE[fx.id] ?? fx.id}`, 'value', (v) => mixer.zetFx(fx.id, v),
      { label: `Video ${fx.naam}`, bipolar: !!fx.bipolair, read: () => mixer.fx[fx.id] });
  }
  // Drukvariant, voor het video-grid: vol aan zolang je drukt, daarna terug.
  for (const fx of VIDEO_FX) {
    let stond = null;
    define(`video.fx.${VIDEO_FX_ACTIE[fx.id] ?? fx.id}.hold`, 'trigger', (on) => {
      if (on && stond === null) { stond = mixer.fx[fx.id]; mixer.zetFx(fx.id, 1); }
      else if (!on && stond !== null) { mixer.zetFx(fx.id, stond); stond = null; }
    }, { label: `Video ${fx.naam} vasthouden`, read: () => (stond !== null ? 1 : 0) });
  }
  define('video.mode', 'trigger', (on) => { if (on) mixer.volgendeModus(); },
    { label: 'Video: volgende mengvorm', read: () => MODI.indexOf(mixer.modus) / (MODI.length - 1) });
  // Passend (zwarte randen, alles zichtbaar) of vullen (doek vol, randen
  // vallen weg). Voor staande video: TikTok is 9:16, het doek 16:9.
  define('video.fit', 'trigger', (on) => { if (on) mixer.volgendeFit(); },
    { label: 'Video: passend of vullen', read: () => FITS.indexOf(mixer.fit) / (FITS.length - 1) });
  define('video.pulse', 'value', (v) => mixer.zetPuls(v),
    { label: 'Video: puls op de tel', read: () => mixer.puls });
  define('video.pulse.target', 'trigger', (on) => { if (on) mixer.volgendPulsDoel(); },
    { label: 'Video: wat er pulst', read: () => PULS_DOELEN.indexOf(mixer.pulsDoel) / (PULS_DOELEN.length - 1) });
}

/**
 * De vormlagen (Vormmachines, src/vormen/): generatief beeld over de video.
 * Alleen met ?vormen=1; zonder dat worden deze actions nooit gedefinieerd.
 *
 * Net als de FX-knoppen wijzen de knoppen naar een PLEK (`video.layer.knob.3`),
 * niet naar een parameter: wissel je van vorm, dan betekent plek 3 iets
 * anders en hoef je niets opnieuw te koppelen. Ze werken op de GEKOZEN laag
 * (Bank ◀ ▶ in het mapje "vorm"), zoals de device knobs op de track met focus.
 */
export const VORM_KNOPPEN = 6;

export function bindVormen(vormen, router = null) {
  const laag = () => vormen.laag;
  for (let k = 1; k <= VORM_KNOPPEN; k++) {
    define(`video.layer.knob.${k}`, 'value', (v) => laag().zetKnop(k - 1, v),
      { label: `Vormlaag: knop ${k}`, read: () => laag().leesKnop(k - 1) });
  }
  define('video.layer.opacity', 'value', (v) => vormen.zetDekking(v),
    { label: 'Vormlaag: dekking', read: () => laag().dekking });
  define('video.layer.on', 'trigger', (on) => { if (on) vormen.wisselAan(); },
    { label: 'Vormlaag aan/uit', read: () => (laag().aan ? 1 : 0) });
  define('video.layer.next', 'trigger', (on) => { if (on) vormen.stapSysteem(1); }, { label: 'Vormlaag: volgende vorm' });
  define('video.layer.prev', 'trigger', (on) => { if (on) vormen.stapSysteem(-1); }, { label: 'Vormlaag: vorige vorm' });
  define('video.layer.blend', 'trigger', (on) => { if (on) vormen.volgendeMengvorm(); },
    { label: 'Vormlaag: mengvorm (screen · add · multiply)' });
  define('video.layer.select.next', 'trigger', (on) => { if (on) vormen.kies(vormen.gekozen + 1); }, { label: 'Volgende vormlaag kiezen' });
  define('video.layer.select.prev', 'trigger', (on) => { if (on) vormen.kies(vormen.gekozen - 1); }, { label: 'Vorige vormlaag kiezen' });
  vormen.lagen.forEach((_, i) => {
    define(`video.layer.select.${i + 1}`, 'trigger', (on) => { if (on) vormen.kies(i); },
      { label: `Vormlaag ${i + 1} kiezen`, read: () => (vormen.gekozen === i ? 1 : 0) });
  });
  // Reageren op de mix (src/analysis/router.js): per laag één route, op de
  // gekozen laag. De sterkte is een offset bovenop de knop, geen knopstand.
  if (!router) return;
  define('video.layer.react', 'value', (v) => router.zetSterkte(vormen.gekozen, v),
    { label: 'Vormlaag: reageren op de mix (sterkte)', read: () => router.route(vormen.gekozen).sterkte });
  define('video.layer.react.source', 'trigger', (on) => { if (on) router.volgendeBron(vormen.gekozen); },
    { label: 'Vormlaag: reageren op laag · midden · hoog · klap · luid' });
  define('video.layer.react.target', 'trigger', (on) => { if (on) router.volgendDoel(vormen.gekozen); },
    { label: 'Vormlaag: reageren, welke knop (1–6)' });
}

/**
 * Wat de schermlaag doet maar op de bus hoort, zodat een APC-knop het kan:
 * een track in een venster zetten (L = focus, R = de tweede), opnemen, door
 * racks bladeren. De functies
 * komen van app.js; hier alleen de namen en de read.
 */
export function bindApp({ toon, venster, opnemer, opnameStart, opnameStop, opnameSoort, rackStap }) {
  for (const [nr, id] of TRACKS) {
    for (const v of ['L', 'R']) {
      define(`window.${v}.show.${nr}`, 'trigger', (on) => { if (on) toon(v, id); },
        { label: v === 'L' ? `Focus op track ${nr}` : `Track ${nr} als tweede (rechterhand)`, read: () => (venster()[v] === id ? 1 : 0) });
    }
    define(`track.${nr}.rack.next`, 'trigger', (on) => { if (on) rackStap(id, 1); }, { label: `Track ${nr} volgend rack` });
    define(`track.${nr}.rack.prev`, 'trigger', (on) => { if (on) rackStap(id, -1); }, { label: `Track ${nr} vorig rack` });
  }
  define('record.start', 'trigger', (on) => { if (on && !opnemer.bezig) opnameStart(); },
    { label: 'Opname starten', read: () => (opnemer.bezig ? 1 : 0) });
  define('record.stop', 'trigger', (on) => { if (on && opnemer.bezig) opnameStop(); },
    { label: 'Opname stoppen (zet hem achter shift)', read: () => (opnemer.bezig ? 1 : 0) });
  define('record.mode', 'trigger', (on) => { if (on && !opnemer.bezig) opnameSoort(); },
    { label: 'Opname: audio of audio + video', read: () => (opnemer.metVideo ? 1 : 0) });
}

/**
 * De kiesknoppen van de mapjes (lagen.js): Pan/Sends/User, de knoppen onder de
 * device knobs, en de grid-pagina's. Een kiesknop is een gewone action, dus
 * ook te koppelen aan een andere knop of te bedienen met de muis.
 */
export function bindLagen(lagen) {
  for (const [groep, g] of Object.entries(GROEPEN)) {
    for (const knop of Object.keys(g.knoppen)) {
      define(`layer.${groep}.${knop}`, 'trigger', (on) => lagen.druk(groep, knop, on),
        { label: g.schakel ? `${g.naam[0].toUpperCase()}${g.naam.slice(1)} aan/uit`
            : `Mapje ${g.naam}: ${g.knoppen[knop].map((l) => LAAGNAAM[`${groep}.${l}`] ?? l).join(' / ')}`,
          // Een kiesknop met meer mapjes onder zich (Clip/Device View: strip,
          // dan rack) licht alleen op buiten het standaardmapje. Anders
          // brandde hij altijd en zag je niet of je in het rack zat.
          read: () => (lagen.isOpen(groep, knop)
            && (g.knoppen[knop].length === 1 || lagen.stand[groep] !== g.standaard) ? 1 : 0) });
    }
    if (g.volgorde) {
      define(`layer.${groep}.next`, 'trigger', (on) => { if (on) lagen.stap(groep, 1); }, { label: `Mapje ${g.naam}: volgende` });
      define(`layer.${groep}.prev`, 'trigger', (on) => { if (on) lagen.stap(groep, -1); }, { label: `Mapje ${g.naam}: vorige` });
    }
  }
}
