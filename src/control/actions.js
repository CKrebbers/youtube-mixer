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
import { ToonKaart, WIJZER } from '../engine/toonsoort.js';
import { teControleren, plekkenTeControleren, volgendTeControleren, oordeelStuk } from '../engine/tellen.js';
import { EFFECTEN } from '../engine/fx.js';
import { DECK_IDS, XFADE_KANTEN, ONZEKER } from '../engine/engine.js';
import { PITCH_BEREIKEN, SPRONG_TELLEN, GLIJ, TOON_MAX } from '../engine/deck.js';
import { hoorbaar as hoorbaarVan, uitgangsVertraging } from '../engine/hoorbaar.js';
import { VIDEO_FX, MODI } from '../video/instellingen.js';
import { PULS_DOELEN } from '../video/puls.js';
import { FITS } from '../video/passen.js';
import { EQ_BANDEN, REM_MIN, REM_MAX, STEM_NAMEN } from '../engine/deck.js';
import { GROEPEN, LAAGNAAM } from './lagen.js';
import { VOLGEN, LADDERS, KLANKSOORTEN, TRANSPOSITIE_MAX } from '../engine/klankschaal.js';
import { INSTRUMENTEN } from '../engine/instrumenten/index.js';
import { PLEKKEN, MAX_LENGTE, STANDAARD_LENGTE, TEMPO, SWING, gevuld, volgendeLengte } from '../engine/patronen/model.js';

const registry = new Map();

/** De stems op het scherm en in labels: Nederlands, de action-namen blijven Engels. */
export const STEM_LABELS = { vocals: 'zang', inst: 'rest', drums: 'drums', bass: 'bas', other: 'overig' };

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
  // Wie meeluistert (het handelingenlog) hoort het vóór de action draait:
  // dan staat de handeling in het log vóór wat eruit volgt.
  for (const f of busLuisteraars) { try { f(id, value); } catch (_) {} }
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

const busLuisteraars = new Set();
/**
 * Meeluisteren op de bus: (id, waarde) bij elke action die bestaat, van
 * MIDI, toetsenbord, muis of terugspelen. Voor het handelingenlog. Geeft een
 * functie terug die weer ophoudt.
 */
export function bijInvoke(fn) { busLuisteraars.add(fn); return () => busLuisteraars.delete(fn); }

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
  const kt = engine.koptelefoon;
  for (const [nr, id] of TRACKS) {
    const d = engine.deck(id);
    const n = `track.${nr}`;
    const bool = (fn) => () => (fn() ? 1 : 0);
    // Wat je NU hoort, in tracktijd: tijdens spelen de positie min de
    // uitgangsvertraging (× rate, want de positie loopt in tracktijd), net als
    // de video-puls. Stilstaand is de positie zelf wat je hoort en ziet.
    // Eén formule voor de hele app: engine/hoorbaar.js.
    const hoorbaar = () => hoorbaarVan(d, uitgangsVertraging(engine.ctx));

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
      // De eerste tik doet nog niets zichtbaars: zeg dat hij geteld is.
      if (!r) { engine.emit('melding', { tekst: `track ${nr}: tap — tik verder op de tel; vanaf de tweede tik schuift het grid mee, na vier staat hij op slot`, soort: 'info' }); return; }
      // Speelt de track, dan gaat de lijn door de TRACKTIJDEN van de tikken en
      // is het tempo meteen in tracktijd. Staat hij stil, dan door de klok:
      // je tikt mee met wat je HOORT (grid × rate), dus delen door de rate.
      // Zonder die deling stond het grid op +5% pitch 5% fout.
      const bpm = r.bpmTrack ?? r.bpm / (d.rate || 1);
      const anker = r.anker ?? d.position;
      // De tweede tik is de eerste die het grid verandert: daarvóór kan het terug (↶).
      if (r.taps === 2) d.gridVoorBewerking();
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
    // Een bewerking met de hand kan terug (↶, deck.gridTerug) en BEVESTIGT het
    // stuk: wie het hier gelijkzet heeft het gecontroleerd, dus sync en
    // beat-loops mogen meteen (5 okt; daarvoor bleef het onzeker tot "slot").
    const bewerk = (fn) => (on) => {
      if (!on || !d.grid) return;
      const p = hoorbaar();
      d.gridVoorBewerking();
      fn(d.grid, p);
      d.grid.bevestig(p);
      d.gridGewijzigd();
    };
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
    let bpmDraai = -Infinity;           // een reeks encoder-tikken is één stap terug
    define(`${n}.grid.bpm`, 'value', (v) => {
      if (!d.grid) return;
      const p = hoorbaar(), nu = performance.now();
      if (nu - bpmDraai > 1500) d.gridVoorBewerking();
      bpmDraai = nu;
      d.grid.setBpm(MIN_BPM + Math.min(1, Math.max(0, v)) * (MAX_BPM - MIN_BPM), { bij: p });
      d.grid.bevestig(p);
      d.gridGewijzigd();
    }, { label: `Track ${nr} bpm van het gridstuk hier (${MIN_BPM}–${MAX_BPM}, voor een encoder)`,
         read: () => (!d.grid ? null : (d.grid.bpmAt(hoorbaar()) - MIN_BPM) / (MAX_BPM - MIN_BPM)) });
    // De "1" een tel verder (of terug): de tellen blijven, alleen de maat begint
    // een tel later. De analyse vindt geen downbeat; zo zet je hem zonder te tikken.
    gridKnop('bar', (g, p) => g.maatSchuif(p, 1), `Track ${nr} de "1" een tel verder`);
    gridKnop('bar.back', (g, p) => g.maatSchuif(p, -1), `Track ${nr} de "1" een tel terug`);

    // VASTZETTEN (Beatgrid.pin): de tel hier hoort HIER. Het tempo van het stuk
    // komt zo dat er tussen zijn anker en hier een geheel aantal tellen ligt,
    // en vanaf hier begint een nieuw stuk. Tel 1 aan het begin + vast een paar
    // minuten later = de drift is weg. Snapt naar een klap, zoals "tel 1 hier".
    const pin = (t) => {
      if (!d.grid) return;
      const was = d.grid.toJSON();
      const r = d.grid.pin(snapNaarOnset(d.onsets, t));
      if (!r.ok) { engine.emit('melding', { tekst: `track ${nr}, vastzetten: ${r.reden}`, soort: 'fout' }); return; }
      d.gridVoorBewerking(was);
      d.gridGewijzigd();
      const komma = (x) => x.toFixed(2).replace('.', ',');
      engine.emit('melding', { soort: 'info', tekst: r.alleenFase
        ? `track ${nr}: tel gelijkgelegd (te dicht bij het anker voor een tempo: zet "1" eerder, of vast verder weg)`
        : `track ${nr}: vastgezet — ${komma(r.bpm)} bpm (was ${komma(r.was)}) over ${Math.abs(r.tellen)} tellen; vanaf hier een nieuw stuk` });
    };
    let pinDruk = false;
    define(`${n}.grid.pin`, 'trigger', (on) => { pinDruk = !!on; if (on) pin(hoorbaar()); },
      { label: `Track ${nr} vastzetten: de tel hier hoort hier (tempo tussen het anker en hier)`,
        read: () => (!d.grid ? null : pinDruk ? 1 : 0) });
    // Hetzelfde op een AANGEWEZEN plek (klik in de golfvorm): value = tracktijd / duur.
    define(`${n}.grid.pin.op`, 'value', (v) => { if (d.buffer) pin(Math.min(1, Math.max(0, v)) * d.duration); },
      { label: `Track ${nr} vastzetten op een plek (tracktijd / duur)` });
    define(`${n}.grid.here.op`, 'value', (v) => {
      if (!d.buffer) return;
      const t = snapNaarOnset(d.onsets, Math.min(1, Math.max(0, v)) * d.duration);
      if (!d.grid) { engine.emit('melding', { tekst: `track ${nr} heeft nog geen beatgrid: tik eerst mee op de tel met TAP`, soort: 'info' }); return; }
      d.gridVoorBewerking(); d.grid.ankerHier(t); d.grid.bevestig(t); d.gridGewijzigd();
    }, { label: `Track ${nr} tel 1 op een plek (tracktijd / duur)` });

    // Terug: de laatste bewerking van het grid ongedaan (tik, pin, ×2, ‹ ›, …).
    let terugDruk = false;
    define(`${n}.grid.undo`, 'trigger', (on) => {
      terugDruk = !!on;
      if (on && !d.gridTerug()) engine.emit('melding', { tekst: `track ${nr}: niets om terug te zetten aan het grid`, soort: 'info' });
    }, { label: `Track ${nr} grid: de laatste bewerking terug`, read: () => (!d.buffer ? null : terugDruk ? 1 : d.kanGridTerug ? 0.5 : 0) });

    // ---- controleren (docs/BEATGRID.md §11) -----------------------------
    // De controleklik: een tik op elke gridlijn (accent op de "1"), in de
    // koptelefoon. Je loopt de PLEKKEN langs waar twijfel over is (stukken
    // die aan elkaar liggen horen bij één plek) — of, als alles er goed
    // uitziet, alle stukken. ✓ = "klopt tot hier": de plek tot waar je HOORT
    // is goed, en je luistert door; is de plek helemaal goed, dan springt hij
    // naar de volgende. Alles goed = het grid op slot. ✎ (de gridmodus) om bij
    // te stellen terwijl de tik doorloopt.
    let controleAlles = false;
    const komma = (x) => x.toFixed(2).replace('.', ',');
    const naarStuk = (i) => {
      const s = d.grid.stukken[i];
      // Net na het begin van het stuk, vóór zijn eerste tel: dan hoor je die tel, en ✓ keurt DIT stuk goed.
      d.seek(Math.max(0, s.van + Math.min(0.05, 15 / s.bpm)), { doorlopend: d.playing });
    };
    const plekBij = (i) => plekkenTeControleren(d.grid, d.gridMeting, { alles: controleAlles }).find((p) => p.van <= i && i <= p.tot) ?? null;
    const minuten = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
    const meldStuk = (i, voor = '') => {
      const st = d.grid.stukken, s = st[i];
      const o = oordeelStuk(s, d.gridMeting?.stukken[i] ?? null, d.grid.slot);
      const plekken = plekkenTeControleren(d.grid, d.gridMeting, { alles: controleAlles });
      const p = plekken.find((x) => x.van <= i && i <= x.tot);
      const lang = p ? (st[p.tot + 1]?.van ?? d.duration) - st[p.van].van : null;
      engine.emit('melding', { soort: 'info', duur: 9000, tekst: `${voor}track ${nr}: `
        + (p ? `plek ${plekken.indexOf(p) + 1} van ${plekken.length} (${minuten(lang)})` : `stuk ${i + 1} van ${st.length}`)
        + ` · ${komma(s.bpm)} bpm: ${o.uitleg}` });
    };
    define(`${n}.grid.controle`, 'trigger', (on) => {
      if (!on || !d.buffer) return;
      if (engine.gridControleDeck === id) { engine.gridControle(null); return; }
      if (!d.grid) { engine.emit('melding', { tekst: `track ${nr} heeft nog geen beatgrid om te controleren`, soort: 'info' }); return; }
      const plekken = plekkenTeControleren(d.grid, d.gridMeting);
      controleAlles = plekken.length === 0;
      engine.gridControle(id);
      const hier = d.grid.stukIndex(hoorbaar());
      // Vanaf hier: je controleert wat je gaat spelen, niet per se de hele opname.
      const i = controleAlles ? hier : (plekken.find((p) => p.tot >= hier) ?? plekken[0]).van;
      // Staat hij stil, dan meteen naar het eerste stuk en spelen; speelt hij, dan tikt hij mee waar je bent.
      if (!d.playing) { naarStuk(i); d.play(); }
      engine.emit('melding', { soort: 'info', duur: 12000, tekst: controleAlles
        ? `track ${nr}: alles lijkt te kloppen — luister mee of de tik op de tel valt (hoog = de "1"). ✓ keurt een stuk goed; is alles goed, dan gaat het grid op slot`
        : `track ${nr}: ${plekken.length} ${plekken.length === 1 ? 'plek' : 'plekken'} om te controleren — luister of de tik op de tel valt (hoog = de "1"). `
          + '✓ = klopt tot hier (luister door; is de plek goed, dan door naar de volgende), ▶ = sla over, ✎ = bijstellen' });
    }, { label: `Track ${nr} grid controleren: tik op de tellen, stuk voor stuk`,
         read: () => (!d.buffer ? null : engine.gridControleDeck === id ? 1 : 0) });
    define(`${n}.grid.ok`, 'trigger', (on) => {
      if (!on || !d.grid) return;
      const p = hoorbaar();
      const hier = d.grid.stukIndex(p);
      const controle = engine.gridControleDeck === id;
      // In de controle: de plek tot hier (wat je gehoord hebt); anders alleen het stuk hier.
      const plek = controle ? plekBij(hier) : null;
      d.gridVoorBewerking();
      const st = d.grid.stukken;
      for (let k = plek ? plek.van : hier; k <= hier; k++) d.grid.keurGoed(st[k].van);
      d.gridGewijzigd();
      if (!controle) {
        engine.emit('melding', { soort: 'info', tekst: `track ${nr}: dit stuk van het grid is goedgekeurd` });
        return;
      }
      // Ligt de rest van de plek nog voor je: doorluisteren.
      if (plek && plek.tot > hier && plekBij(hier + 1)) {
        const nog = (st[plek.tot + 1]?.van ?? d.duration) - p;
        engine.emit('melding', { soort: 'info', tekst: `✓ tot hier — luister door, nog ${minuten(nog)} in deze plek` });
        return;
      }
      const volgende = volgendTeControleren(d.grid, d.gridMeting, p, { alles: controleAlles });
      if (volgende === null) {
        d.grid.slot = true;
        d.gridGewijzigd();
        engine.gridControle(null);
        engine.emit('melding', { soort: 'info', tekst: `track ${nr}: alles gecontroleerd — het grid staat op slot` });
        return;
      }
      naarStuk(volgende);
      meldStuk(volgende, '✓ — ');
    }, { label: `Track ${nr} grid: klopt tot hier (goedkeuren; in de controle door naar de volgende plek)`,
         read: () => (!d.grid ? null : d.grid.stukBij(hoorbaar()).ok ? 1 : 0) });
    for (const [naam, stap] of [['next', 1], ['prev', -1]]) {
      define(`${n}.grid.check.${naam}`, 'trigger', (on) => {
        if (!on || !d.grid) return;
        const hier = d.grid.stukIndex(hoorbaar());
        const i = volgendTeControleren(d.grid, d.gridMeting, hoorbaar(), { stap, alles: controleAlles })
          ?? Math.min(d.grid.aantalStukken - 1, Math.max(0, hier + stap));
        naarStuk(i);
        meldStuk(i);
      }, { label: `Track ${nr} grid controleren: ${stap > 0 ? 'volgende' : 'vorige'} plek`, read: () => (!d.grid ? null : 0) });
    }

    define(`${n}.grid.merge`, 'trigger', bewerk((g, p) => g.voegSamen(p)),
      { label: `Track ${nr} gridstuk samenvoegen met het vorige` });
    define(`${n}.grid.lock`, 'trigger', bewerk((g) => { g.slot = !g.slot; }),
      { label: `Track ${nr} grid op slot`, read: () => (!d.grid ? null : d.grid.slot ? 1 : 0) });
    define(`${n}.grid.clear`, 'trigger', (on) => { if (on) { tap.reset(); d.setGrid(null); } },
      { label: `Track ${nr} grid wissen`, read: () => (d.grid ? 1 : 0) });

    // ---- toonsoort (docs/TOONSOORT.md §7) -----------------------------------
    // Corrigeren per STUK, op wat je HOORT (net als het grid). De kaart is van
    // de plaat: een kwint omhoog verandert wat er op de plaat staat, niet de
    // pitch. Op de APC in versie 1 geen knoppen (T6): corrigeren is zeldzaam en
    // niet live, maar met deze actions kan koppelen later zonder code. Read:
    // null zonder kaart (niets te doen), 1 zolang ingedrukt, anders `rust()`.
    const toonKnop = (id, fn, label, rust = () => 0) => {
      let ingedrukt = false;
      define(`${n}.key.${id}`, 'trigger', (on) => {
        ingedrukt = !!on;
        if (on && d.toonKaart) { fn(d.toonKaart, hoorbaar()); d.toonGewijzigd(); }
      }, { label, read: () => (!d.toonKaart ? null : ingedrukt ? 1 : rust()) });
    };
    toonKnop('fifth.up', (k, p) => k.kwint(p, 1), `Track ${nr} toonsoort hier een kwint omhoog (Camelot +1)`);
    toonKnop('fifth.down', (k, p) => k.kwint(p, -1), `Track ${nr} toonsoort hier een kwint omlaag (Camelot −1)`);
    toonKnop('mode', (k, p) => k.wisselModus(p), `Track ${nr} toonsoort hier majeur ↔ mineur (relatief)`);
    toonKnop('semitone.up', (k, p) => k.halveToon(p, 1), `Track ${nr} toonsoort hier een halve toon hoger`);
    toonKnop('semitone.down', (k, p) => k.halveToon(p, -1), `Track ${nr} toonsoort hier een halve toon lager`);
    toonKnop('none', (k, p) => k.geen(p), `Track ${nr} hier geen toonsoort`);
    toonKnop('split', (k, p) => k.splits(p), `Track ${nr} nieuw toonsoortstuk hier`,
      () => (d.toonKaart.aantalStukken > 1 ? 0.5 : 0));
    // Bevestigen: slot aan/uit. Op slot laat de analyse de kaart altijd staan.
    define(`${n}.key.lock`, 'trigger', (on) => {
      if (!on || !d.toonKaart) return;
      d.toonKaart.slot = !d.toonKaart.slot;
      d.toonGewijzigd();
    }, { label: `Track ${nr} toonsoort bevestigen (slot)`, read: () => (!d.toonKaart ? null : d.toonKaart.slot ? 1 : 0) });
    // De toonsoort van de plaat hier als value 0..1: 24 standen in wijzervolgorde
    // (1A 1B 2A … 12B), voor een encoder (regel 2: de mapping weet niets van
    // toonsoorten). Zonder kaart maakt hij er een, met de hand gezet.
    define(`${n}.key`, 'value', (v) => {
      if (!d.buffer) return;
      const k = WIJZER[Math.round(Math.min(1, Math.max(0, v)) * (WIJZER.length - 1))];
      if (!d.toonKaart) { d.setToonKaart(ToonKaart.metHand(k)); return; }
      d.toonKaart.zetStuk(hoorbaar(), { toonsoort: k });
      d.toonGewijzigd();
    }, { label: `Track ${nr} toonsoort van de plaat hier (24 standen, voor een encoder)`,
         read: () => {
           const k = d.toonKaart?.stukAt(hoorbaar()).k ?? null;
           return k === null ? null : WIJZER.indexOf(k) / (WIJZER.length - 1);
         } });

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

    // ---- transport: loop in/out, reloop, beatjump, starten op de maat ------
    // Handmatige loop zoals op een CDJ: in, dan out (de loop gaat meteen aan),
    // reloop/exit. Met quantize (transport.quantize) op de tel.
    define(`${n}.loop.in`, 'trigger', (on) => { if (on) d.loopIn(); },
      { label: `Track ${nr} loop in (begin van een handmatige loop)`,
        read: () => (!d.buffer ? null : d.loopInPunt !== null ? 1 : 0) });
    // 1 = er loopt een loop, 0 = loop in staat klaar (drukken sluit hem),
    // null = niets te doen (nog geen loop in).
    define(`${n}.loop.out`, 'trigger', (on) => { if (on) d.loopOut(); },
      { label: `Track ${nr} loop out (einde, de loop gaat aan)`,
        read: () => (!d.buffer ? null : d.loop ? 1 : d.loopInPunt !== null ? 0 : null) });
    // 1 = er loopt een loop (drukken = eraf), 0,5 = er is een loop om terug
    // te halen, null = niets te doen.
    define(`${n}.loop.reloop`, 'trigger', (on) => { if (on) d.reloop(); },
      { label: `Track ${nr} reloop / loop uit`,
        read: () => (!d.buffer ? null : d.loop ? 1 : d.vorigeLoop ? 0.5 : null) });

    // Beatjump: de ingestelde lengte (1–32 tellen, standaard 4) terug of
    // vooruit, op het grid. In een loop schuift de loop mee. Zelfde regels als
    // beat-loops: zonder grid of in een onzeker stuk niets, en dan zeggen waarom.
    // Voorbij het einde ook niet (Deck.beatjump): anders stopte de track.
    const sprongMelding = {
      geengrid: 'beatjump kan niet zonder beatgrid — tik eerst het tempo (TAP)',
      onzeker: ONZEKER,
      rand: 'beatjump: de loop komt dan buiten het nummer te liggen',
      einde: 'beatjump: dat valt voorbij het einde van het nummer — niet gesprongen',
      begin: 'beatjump: dat valt vóór het begin van het nummer — niet gesprongen',
    };
    for (const [richting, naam, tekst] of [[-1, 'back', 'terug'], [1, 'fwd', 'vooruit']]) {
      let ingedrukt = false;
      define(`${n}.beatjump.${naam}`, 'trigger', (on) => {
        ingedrukt = !!on;
        if (!on) return;
        const r = d.beatjump(richting);
        if (!r.ok && sprongMelding[r.waarom]) engine.emit('melding', { tekst: `track ${nr}: ${sprongMelding[r.waarom]}`, soort: 'fout' });
      }, { label: `Track ${nr} beatjump ${tekst}`,
           read: () => (!d.buffer || !d.grid || d.gridZekerHier === false ? null : ingedrukt ? 1 : 0) });
    }
    // Lengte als keuze (index), zoals sampler.length: halveren en verdubbelen.
    // Maar per track: op een lege track is er niets te doen (B4: null = uit).
    const sprongStand = () => (!d.buffer ? null : SPRONG_TELLEN.indexOf(d.sprongTellen) / (SPRONG_TELLEN.length - 1));
    define(`${n}.beatjump.halve`, 'trigger', (on) => { if (on) d.halveerSprong(); },
      { label: `Track ${nr} beatjump-lengte halveren (${SPRONG_TELLEN.join('/')} tellen)`, read: sprongStand });
    define(`${n}.beatjump.double`, 'trigger', (on) => { if (on) d.verdubbelSprong(); },
      { label: `Track ${nr} beatjump-lengte verdubbelen (${SPRONG_TELLEN.join('/')} tellen)`, read: sprongStand });

    // Starten op de maat: het geluid begint op het volgende maatbegin van de
    // track die de maat geeft (Engine.startOpDeMaat); zonder maatgever meteen.
    // Speelt hij al, of wacht hij nog op de maat, dan pauze, net als play:
    // shift+Q was eerst gewoon play/pauze, en Clay's vingers pauzeren er nog
    // mee. Nog een keer drukken tijdens het wachten annuleert het wachten.
    // Tijdens een rem: los, ook net als play (togglePlay).
    // Lampje: 1 = wacht op de maat, 0,5 = speelt (drukken = pauze), 0 = stil
    // (bruikbaar), null = leeg (niets te doen).
    define(`${n}.play.quant`, 'trigger', (on) => {
      if (!on) return;
      if (d.playing) { d.togglePlay(); return; }
      const r = engine.startOpDeMaat(id);
      if (r.reden) engine.emit('melding', { tekst: `track ${nr}: ${r.reden}`, soort: r.ok ? 'info' : 'fout' });
    }, { label: `Track ${nr} starten op de volgende maat van de maatgever (speelt hij: pauze)`,
         read: () => (!d.buffer ? null : d.wacht ? 1 : d.playing ? 0.5 : 0) });

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

    // Keylock en toon (docs/KEYLOCK.md): het tempo los van de toon. Keylock
    // blijft staan bij een nieuw nummer, de toon gaat terug naar 0. Een sprong
    // met keylock (play, hotcue, seek) klinkt ~95 ms later, exact (K3).
    define(`${n}.keylock`, 'trigger', (on) => { if (on) d.setKeylock(!d.keylock); },
      { label: `Track ${nr} keylock aan/uit (het tempo verandert, de toon blijft)`, read: () => (d.keylock ? 1 : 0) });
    define(`${n}.transpose`, 'value', (v) => d.setTranspositie(Math.round(Math.min(1, Math.max(0, v)) * 2 * TOON_MAX) - TOON_MAX),
      { label: `Track ${nr} toon verschuiven (±${TOON_MAX} halve tonen, 0,5 = niets)`, bipolar: true,
        read: () => (d.transpositie + TOON_MAX) / (2 * TOON_MAX) });
    define(`${n}.transpose.up`, 'trigger', (on) => { if (on) d.setTranspositie(d.transpositie + 1); },
      { label: `Track ${nr} toon een halve toon hoger`, read: () => (d.transpositie >= TOON_MAX ? null : d.transpositie > 0 ? 1 : 0) });
    define(`${n}.transpose.down`, 'trigger', (on) => { if (on) d.setTranspositie(d.transpositie - 1); },
      { label: `Track ${nr} toon een halve toon lager`, read: () => (d.transpositie <= -TOON_MAX ? null : d.transpositie < 0 ? 1 : 0) });
    define(`${n}.transpose.reset`, 'trigger', (on) => { if (on) d.setTranspositie(0); },
      { label: `Track ${nr} toon terug naar 0`, read: () => (d.transpositie !== 0 ? 1 : 0) });

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

    // Stems (docs/STEMS.md): per stem een niveau (0..1, 1 = vol; vóór de EQ)
    // en een kill als schakelaar en als drukknop, zoals de EQ-kill: het
    // niveau blijft staan, kill uit = precies terug. `inst` is de rest (bij
    // vier stems: drums + bas + overig samen). Read null als de track geen
    // stems heeft, of deze stem in deze stand niet bestaat (drums bij twee):
    // dan is er niets te doen (B4: lampje uit). Kill-lampje: 1 = weg, 0 = open.
    for (const st of STEM_NAMEN) {
      const naam = STEM_LABELS[st];
      const weg = () => (!d.stemBestaat(st) ? null : d.stemGekild(st) ? 1 : 0);
      define(`${n}.stem.${st}`, 'value', (v) => d.setStemNiveau(st, v),
        { label: `Track ${nr} stem ${naam}: niveau`, read: () => d.stemNiveau(st) });
      define(`${n}.stem.${st}.kill`, 'trigger', (on) => { if (on) d.toggleStemKill(st); },
        { label: `Track ${nr} stem ${naam} weg aan/uit`, read: weg });
      define(`${n}.stem.${st}.hold`, 'trigger', (on) => d.houdStemKill(st, !!on),
        { label: `Track ${nr} stem ${naam} weg zolang je drukt`, read: weg });

      // Stemkanalen (docs/STEMS.md §5): per stem een bipolair filter (midden
      // = open, zoals het trackfilter), een echo- en galm-send (door een
      // spiegel van de fader: fader dicht = ook de stem stuurt niets meer in)
      // en een cue. Bij vier stems werkt `inst` op drums, bas en overig samen.
      // Read null zonder die stem; de cue ook zonder koptelefoonuitgang.
      define(`${n}.stem.${st}.filter`, 'value', (v) => d.setStemFilter(st, v),
        { label: `Track ${nr} stem ${naam}: filter`, bipolar: true, read: () => d.stemFilter(st) });
      for (const bus of ['A', 'B']) {
        define(`${n}.stem.${st}.send.${bus.toLowerCase()}`, 'value', (v) => d.setStemSend(bus, st, v),
          { label: `Track ${nr} stem ${naam}: send ${bus} (${bus === 'A' ? 'echo' : 'galm'})`, read: () => d.stemSend(bus, st) });
      }
      const stemCue = `${id}:stems`;
      define(`${n}.stem.${st}.pfl`, 'trigger', (on) => { if (on && kt.heeft(stemCue)) d.toggleStemPfl(st); },
        { label: `Track ${nr} stem ${naam} in de koptelefoon (voorbeluisteren) aan/uit`,
          read: () => (!kt.heeft(stemCue) || !d.stemBestaat(st) ? null : d.stemPflAan(st) ? 1 : 0) });

      // Een eigen toon per stem (6 okt): halve tonen bovenop de toon van de
      // track, het tempo blijft. Zoals track.N.transpose: value 0..1 over
      // ±TOON_MAX (0,5 = niets), en hoger/lager/terug. Read null zonder die stem.
      const toon = () => d.stemToon(st);
      define(`${n}.stem.${st}.transpose`, 'value', (v) => d.setStemToon(st, Math.round(Math.min(1, Math.max(0, v)) * 2 * TOON_MAX) - TOON_MAX),
        { label: `Track ${nr} stem ${naam}: toon (±${TOON_MAX} halve tonen, 0,5 = niets)`, bipolar: true,
          read: () => (toon() === null ? null : (toon() + TOON_MAX) / (2 * TOON_MAX)) });
      define(`${n}.stem.${st}.transpose.up`, 'trigger', (on) => { if (on && toon() !== null) d.setStemToon(st, toon() + 1); },
        { label: `Track ${nr} stem ${naam}: een halve toon hoger`, read: () => (toon() === null || toon() >= TOON_MAX ? null : toon() > 0 ? 1 : 0) });
      define(`${n}.stem.${st}.transpose.down`, 'trigger', (on) => { if (on && toon() !== null) d.setStemToon(st, toon() - 1); },
        { label: `Track ${nr} stem ${naam}: een halve toon lager`, read: () => (toon() === null || toon() <= -TOON_MAX ? null : toon() < 0 ? 1 : 0) });
      define(`${n}.stem.${st}.transpose.reset`, 'trigger', (on) => { if (on) d.setStemToon(st, 0); },
        { label: `Track ${nr} stem ${naam}: toon terug naar 0`, read: () => (toon() === null ? null : toon() !== 0 ? 1 : 0) });
    }

    // Koptelefoon (docs/STUDIO.md §3): deze track voorbeluisteren, vóór de
    // fader. Lampje: 1 = je hoort hem in de koptelefoon, 0 = niet, null = er
    // is geen koptelefoonuitgang (de uitgang heeft geen vier kanalen).
    define(`${n}.pfl`, 'trigger', (on) => { if (on) kt.wisselPfl(id); },
      { label: `Track ${nr} in de koptelefoon (voorbeluisteren) aan/uit`,
        read: () => (kt.heeft(id) ? (kt.pflAan(id) ? 1 : 0) : null) });

    // ---- instrument op deze track (docs/INSTRUMENTEN.md §6) -----------------
    // Een track draagt een nummer óf een instrument (ST7). Kiezen loopt rond:
    // geen → elk instrument uit INSTRUMENTEN → geen. Staat er een nummer dat
    // SPEELT, dan gaat het er pas af bij een tweede druk binnen 3 s (destructief,
    // zoals laden over een spelende track): ook op de APC en het toetsenbord.
    // Noten gaan NIET over de bus (een noot is geen 0..1): src/control/noten.js.
    const inst = () => engine.instrumentOp?.(id) ?? null;
    const keuzes = [null, ...INSTRUMENTEN.map((x) => x.soort)];
    let zekerTot = 0;
    const kiesInstrument = (soort) => {
      if (soort && !inst() && d.playing) {
        const nu = performance.now();
        if (!(nu < zekerTot)) {
          zekerTot = nu + 3000;
          engine.emit('melding', { tekst: `track ${nr} speelt — druk nog eens (binnen 3 s) om het nummer eraf te halen voor een instrument`, soort: 'info' });
          return;
        }
      }
      zekerTot = 0;
      const r = engine.zetInstrument(id, soort);
      if (!r.ok) engine.emit('melding', { tekst: `track ${nr}: ${r.reden}`, soort: 'fout' });
    };
    const keuzeNu = () => keuzes.indexOf(inst()?.soort ?? null);
    define(`${n}.inst`, 'trigger', (on) => { if (on) kiesInstrument(keuzes[(Math.max(0, keuzeNu()) + 1) % keuzes.length]); },
      { label: `Track ${nr} instrument kiezen (geen → ${INSTRUMENTEN.map((x) => x.naam).join(' → ')} → geen)`,
        read: () => (keuzes.length > 1 ? Math.max(0, keuzeNu()) / (keuzes.length - 1) : 0) });
    // Door de instrumenten bladeren zonder "geen" (Device ◀ ▶ in het mapje inst).
    for (const [naam, stap] of [['next', 1], ['prev', -1]]) {
      define(`${n}.inst.${naam}`, 'trigger', (on) => {
        if (!on || !INSTRUMENTEN.length) return;
        const i = INSTRUMENTEN.findIndex((x) => x.soort === inst()?.soort);
        const j = i < 0 ? (stap > 0 ? 0 : INSTRUMENTEN.length - 1) : (i + stap + INSTRUMENTEN.length) % INSTRUMENTEN.length;
        kiesInstrument(INSTRUMENTEN[j].soort);
      }, { label: `Track ${nr} ${stap > 0 ? 'volgend' : 'vorig'} instrument`, read: () => (inst() ? 0 : null) });
    }
    // Eén keuze in één keer (het masterwiel van de Maschine: draaien = kiezen op het
    // scherm, indrukken = dit): 0 = geen, dan de instrumenten op hun plek in de rij,
    // dezelfde schaal als de read van `track.N.inst`. Zelfde regel voor een spelend nummer.
    define(`${n}.inst.choose`, 'value', (v) => {
      const i = Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * (keuzes.length - 1));
      if (i !== keuzeNu()) kiesInstrument(keuzes[i]);
    }, { label: `Track ${nr} instrument kiezen in één keer (0 = geen, dan ${INSTRUMENTEN.map((x) => x.naam).join(', ')})`,
      read: () => (keuzes.length > 1 ? Math.max(0, keuzeNu()) / (keuzes.length - 1) : 0) });
    // Acht knoppen: een PLEK, zoals de FX-knoppen; wat hij doet hangt van het instrument af.
    for (let k = 1; k <= 8; k++) {
      define(`${n}.inst.knob.${k}`, 'value', (v) => inst()?.zetParam(k, v),
        { label: `Track ${nr} instrumentknop ${k}`, read: () => inst()?.leesParam(k) ?? null });
    }
    // Paniek: meteen stil (korte fade). Lampje: 1 = ingedrukt, 0,5 = er klinkt iets, 0 = stil, null = geen instrument.
    {
      let ingedrukt = false;
      define(`${n}.inst.stil`, 'trigger', (on) => { ingedrukt = !!on; if (on) inst()?.stil(); },
        { label: `Track ${nr} instrument meteen stil (paniek)`,
          read: () => { const i = inst(); return !i ? null : ingedrukt ? 1 : i.stand().klinkt > 0 ? 0.5 : 0; } });
    }

    // Sends: na de fader naar de gedeelde echo (A) en galm (B).
    for (const bus of ['A', 'B']) {
      define(`${n}.send.${bus.toLowerCase()}`, 'value', (v) => d.set(`send${bus}`, v),
        { label: `Track ${nr} send ${bus} (${bus === 'A' ? 'echo' : 'galm'})`, read: () => d.ui[`send${bus}`] });
    }

    // Glijdend naar een stand (Deck.glide): in GLIJ s als helling op de
    // audioklok, voor de auto-DJ (docs/AUTO-DJ.md §2b). Zelfde 0..1 als de
    // knop zelf (regel 2), en dus ook gewoon in het handelingenlog en terug
    // te spelen. Bewust GEEN read: de stand lees je van de knop zelf
    // (track.N.fader), en zonder read komt een glijdende kopie niet in de
    // beginstand van het log (die zou bij terugspelen nog eens glijden).
    for (const [p, naam] of [['fader', 'fader'], ['filter', 'filter'], ['sendA', 'send.a'], ['sendB', 'send.b']]) {
      define(`${n}.${naam}.glide`, 'value', (v) => d.glide(p, v),
        { label: `Track ${nr} ${naam} glijdend (${String(GLIJ).replace('.', ',')} s, auto-DJ)` });
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
    // Wacht de track op zijn start op de maat, dan staat hij stil: geen tel.
    define(`${n}.beat`, 'trigger', () => {}, { label: `Track ${nr} op de tel (alleen lezen)`,
      read: bool(() => d.playing && !d.wacht && d.grid && d.grid.phase(d.position) < 0.15) });
    // Fase binnen de tel van wat je HOORT: positie min de uitgangsvertraging
    // (× rate, want de positie loopt in tracktijd), zoals de video-puls. Voor
    // LED's die op de tel knipperen. null als hij niet speelt (of nog op de
    // maat wacht) of geen grid heeft.
    define(`${n}.phase`, 'trigger', () => {}, { label: `Track ${nr} fase binnen de tel (alleen lezen)`,
      read: () => {
        if (!d.playing || d.wacht || !d.grid) return null;
        return d.grid.phase(hoorbaar());
      } });
    // Welke tel van de maat je HOORT (1..4), geteld vanaf de "1" van het stuk
    // (maat-anker, 25 sep 2026). Voor lampjes die op de "1" langer knipperen.
    define(`${n}.barbeat`, 'trigger', () => {}, { label: `Track ${nr} tel van de maat (alleen lezen)`,
      read: () => {
        if (!d.playing || d.wacht || !d.grid) return null;
        return d.grid.telInMaat(hoorbaar());
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

  // ---- de master: effecten op het geheel (docs/MASTER.md) ------------------
  // Hetzelfde racksysteem als een track, dus dezelfde namen: track.N.fx.* wordt
  // master.fx.*. Welk rack er in zit kiest master.rack.next/prev (bindApp: de
  // lijst kent de schermlaag). Altijd gedefinieerd, ook op een engine zonder
  // master (een dubbel in de tests): dan doen ze niets en lezen ze null.
  const mfx = () => engine.master?.fx ?? null;
  define('master.fx.mix', 'value', (v) => mfx()?.setMix(v),
    { label: 'Master FX dry/wet', read: () => mfx()?.mix ?? null });
  // read = bypass (1 = effect UIT), zoals bij een track; de LED draait dat om.
  define('master.fx.bypass', 'trigger', (on) => { const f = mfx(); if (on && f) f.setBypass(!f.bypass); },
    { label: 'Master FX uit', read: () => { const f = mfx(); return !f?.effectId ? null : f.bypass ? 1 : 0; } });
  for (let k = 1; k <= 8; k++) {
    define(`master.fx.knob.${k}`, 'value', (v) => mfx()?.setPlek(k, v),
      { label: `Master FX plek ${k}`, bipolar: false, read: () => mfx()?.leesPlek(k) ?? null });
    const druk = drukknop(mfx, k);
    define(`master.fx.knob.${k}.hold`, 'trigger', druk.fn,
      { label: `Master FX plek ${k} vasthouden (open zolang ingedrukt)`, read: druk.ingedrukt });
  }
  define('master.fx.next', 'trigger', (on) => {
    const f = mfx();
    if (!on || !f) return;
    const lijst = EFFECTEN.map((e) => e.id);
    f.zetEffect(lijst[(lijst.indexOf(f.effectId) + 1) % lijst.length]);
    engine.emit?.('change');
  }, { label: 'Master volgend effect' });

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

  // ---- klankschaal: meespelen op de toon van wat je hoort -----------------
  // Geen plek op de standaard-APC: koppel wat je wilt met "koppelen" (MIDI-learn).
  // Reads: 1 = klinkt/ingedrukt, 0 = rust; keuzes als index 0..1.
  const ks = engine.klankschaal;
  if (ks) {
    const fout = (err) => engine.emit('melding', { tekst: `klankschaal: ${err.message}`, soort: 'fout' });
    const keuze = (lijst, waarde) => lijst.indexOf(waarde) / (lijst.length - 1);
    define('klankschaal.kern', 'trigger', (on) => { if (on) ks.slaKern().catch(fout); },
      { label: 'Klankschaal: de kern aanslaan (de grondtoon)', read: () => (ks.klinkt(0) ? 1 : 0) });
    for (let i = 0; i < 8; i++) {
      define(`klankschaal.veld.${i + 1}`, 'trigger', (on) => { if (on) ks.slaVeld(i).catch(fout); },
        { label: `Klankschaal: toonveld ${i + 1} aanslaan`, read: () => (ks.klinkt(i + 1) ? 1 : 0) });
    }
    define('klankschaal.wrijf', 'trigger', (on) => { ks.wrijf(!!on).catch(fout); },
      { label: 'Klankschaal: wrijven zolang je drukt (de schaal gaat zingen)', read: () => (ks.wrijft ? 1 : 0) });
    define('klankschaal.demp', 'trigger', (on) => ks.demp(!!on),
      { label: 'Klankschaal: dempen zolang je drukt', read: () => (ks.dempt ? 1 : 0) });
    define('klankschaal.volg', 'trigger', (on) => { if (on) ks.volgendeVolg(); },
      { label: 'Klankschaal: volgt de maat → de focus → met de hand', read: () => keuze(VOLGEN, ks.volg) });
    define('klankschaal.toon', 'value', (v) => ks.zetToon(WIJZER[Math.round(Math.min(1, Math.max(0, v)) * (WIJZER.length - 1))]),
      { label: 'Klankschaal: toonsoort met de hand (24 standen; zet volgen op hand)', read: () => WIJZER.indexOf(ks.bron().k) / (WIJZER.length - 1) });
    define('klankschaal.transpose.up', 'trigger', (on) => { if (on) ks.transponeer(1); },
      { label: 'Klankschaal: een halve toon hoger', read: () => (ks.transpositie >= TRANSPOSITIE_MAX ? null : 0) });
    define('klankschaal.transpose.down', 'trigger', (on) => { if (on) ks.transponeer(-1); },
      { label: 'Klankschaal: een halve toon lager', read: () => (ks.transpositie <= -TRANSPOSITIE_MAX ? null : 0) });
    define('klankschaal.transpose.reset', 'trigger', (on) => { if (on) ks.herstelToon(); },
      { label: 'Klankschaal: transpositie en fijn terug op nul', read: () => (ks.transpositie || ks.fijn ? 0.5 : 0) });
    define('klankschaal.fijn', 'value', (v) => ks.setFijn(v),
      { label: 'Klankschaal: fijnstemmen (−50..+50 cent)', read: () => 0.5 + ks.fijn / 100 });
    define('klankschaal.toonladder', 'trigger', (on) => { if (on) ks.volgendeLadder(); },
      { label: 'Klankschaal: toonladder (auto, Kurd, Celtic, penta, Hijaz, majeur, penta majeur)', read: () => keuze(LADDERS, ks.ladder) });
    define('klankschaal.klank', 'trigger', (on) => { if (on) ks.volgendeKlank(); },
      { label: 'Klankschaal: soort schaal (brons, kristal, glas, gong)', read: () => keuze(KLANKSOORTEN, ks.klank) });
    define('klankschaal.karakter', 'value', (v) => ks.setKarakter(v),
      { label: 'Klankschaal: karakter (handpan ↔ schaal)', read: () => ks.karakter });
    define('klankschaal.uitklank', 'value', (v) => ks.setUitklank(v),
      { label: 'Klankschaal: uitklank (kort ↔ lang)', read: () => ks.uitklank });
    define('klankschaal.kracht', 'value', (v) => ks.setKracht(v),
      { label: 'Klankschaal: hoe hard je aanslaat en wrijft', read: () => ks.kracht });
    define('klankschaal.volume', 'value', (v) => ks.setVolume(v),
      { label: 'Klankschaal volume', read: () => ks.volume });
    for (const bus of ['A', 'B']) {
      define(`klankschaal.send.${bus.toLowerCase()}`, 'value', (v) => ks.setSend(bus, v),
        { label: `Klankschaal naar send ${bus} (${bus === 'A' ? 'echo' : 'galm'})`, read: () => ks.send[bus] ?? 0 });
    }
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

  // De koptelefoon (docs/STUDIO.md §3): volume en de mix cue ↔ zaal. Read
  // null zonder koptelefoonuitgang: dan is er niets te draaien.
  define('headphone.level', 'value', (v) => kt.zetNiveau(v),
    { label: 'Koptelefoon: volume', read: () => (kt.beschikbaar ? kt.niveau : null) });
  define('headphone.mix', 'value', (v) => kt.zetMix(v),
    { label: 'Koptelefoon: mix (links alleen de cue, rechts alleen de zaal)', read: () => (kt.beschikbaar ? kt.mix : null) });
  define('mixer.xfader.curve', 'trigger', (on) => {
    if (on) engine.setXfaderCurve(engine.xfaderCurve === 'smooth' ? 'sharp' : 'smooth');
  }, { label: 'Crossfader-curve wisselen', read: () => (engine.xfaderCurve === 'sharp' ? 1 : 0) });

  // Eén quantize voor alle tracks (zie Engine.setQuantize).
  define('transport.quantize', 'trigger', (on) => { if (on) engine.setQuantize(!engine.quantize); },
    { label: 'Quantize aan/uit: cue, hotcues en loop in/out op de tel, hotcues springen in de maat',
      read: () => (engine.quantize ? 1 : 0) });

  bindPatronen(engine);
  waaromNiet(engine);
}

/*
 * WAAROM NIET (Clay, 5 okt: "heel veel knoppen zijn wel in te klikken ... maar
 * ze werken niet"). Een knop die stil niets doet, is voor wie hem indrukt een
 * kapotte knop. Kan een track-action op dit moment niets, dan zegt een
 * melding waarom en wat wel kan: een lege track, een instrument in plaats van
 * een nummer, geen grid, geen stems, geen koptelefoonuitgang. Alleen bij
 * INDRUKKEN van een drukknop (niet bij loslaten, niet voor draaiknoppen); staat
 * dezelfde melding er al, dan licht die opnieuw op. De action zelf verandert niet: hij
 * doet in die gevallen nog steeds niets (dat is goed), alleen niet meer stil.
 */
const NUMMER_NODIG = /^(play|cue|sync|tap|brake|hotcue\.\d$|loop\.|beatloop\.|beatjump\.|nudge\.|bend\.|grid\.|stem\.)/;
// Zonder grid: tel 1 (here) kan nog steeds niets, maar zegt dat zelf; terug (undo) moet ook na wissen kunnen.
const GRID_NODIG = /^(grid\.(?!here$|undo$)|beatloop\.|beatjump\.)/;
const KOPTELEFOON_NODIG = /^(pfl$|stem\.\w+\.pfl$)/;

function waaromNiet(engine) {
  const kt = engine.koptelefoon;
  // Elke druk zegt het: staat dezelfde melding er nog, dan licht die opnieuw op (meldingen.js).
  const zeg = (tekst) => engine.emit('melding', { tekst, soort: 'info', duur: 8000 });
  for (const [nr, id] of TRACKS) {
    const d = engine.deck(id);
    const n = `track.${nr}.`;
    /** Waarom deze action op deze track nu niets kan, of null. */
    const reden = (rest) => {
      if (KOPTELEFOON_NODIG.test(rest) && !kt?.beschikbaar) {
        return `koptelefoon: de audio-uitgang heeft ${kt?.kanalen ?? 2} kanalen, er is er geen voor de koptelefoon. `
          + 'Maak in Audio-MIDI-configuratie een samengesteld apparaat (eerst de Scarlett, dan de koptelefoonuitgang van de Mac), '
          + 'kies het in Systeeminstellingen → Geluid en herlaad VARVE (docs/STUDIO.md §3).';
      }
      if (!NUMMER_NODIG.test(rest)) return null;
      if (!d.buffer) {
        const inst = engine.instrumentOp?.(id);
        return inst
          ? `track ${nr} speelt een instrument (${inst.naam ?? inst.soort}), geen nummer: ${rest.split('.')[0]} hoort bij een nummer. `
            + 'Speel het instrument met een keyboard of start een patroon (PATROON-rij).'
          : `track ${nr} is leeg: laad eerst een nummer (library, of sleep een bestand op de kolom).`;
      }
      if (rest.startsWith('stem.') && !KOPTELEFOON_NODIG.test(rest) && !d.stems) {
        return `track ${nr} heeft (nog) geen stems: splits hem in de STEMS-rij of in de library.`;
      }
      if (GRID_NODIG.test(rest) && !d.grid) {
        return `track ${nr} heeft nog geen beatgrid: tik mee op de tel met TAP (vier tikken), of zet tel 1 met "1".`;
      }
      return null;
    };
    for (const [aid, a] of registry) {
      if (!aid.startsWith(n) || a.type !== 'trigger') continue;
      const rest = aid.slice(n.length);
      if (!NUMMER_NODIG.test(rest) && !KOPTELEFOON_NODIG.test(rest)) continue;
      const fn = a.fn;
      a.fn = (on) => {
        if (on) {
          const r = reden(rest);
          if (r) { zeg(r); return; }
        }
        return fn(on);
      };
    }
  }
}

/** Een speler die er niet is: alles doet niets, alles leest null. */
const GEEN_PATRONEN = {
  druk: () => ({ ok: false }), stop() {}, stopAlles() {}, rij() {}, wisselStap() {}, zetLengte() {}, zetSwing() {}, wis() {},
  zetTempo() {}, neemOp() {}, lamp: () => null, rijLamp: () => null, stapLamp: () => null, stand: () => null,
  patroon: () => null, gekozen: () => 1, spelend: () => [], tempo: null, opnemen: false,
};

/**
 * Patronen (docs/PATRONEN.md, STUDIO S4): een sequencer op de maat van de
 * maatgever die de instrumenten op de tracks speelt (engine.patronen,
 * src/engine/patronen/). Per track vijf plekken, de vijf rijen van het grid.
 *
 *   track.N.pattern.K        starten op de maat; speelt hij: stoppen op de maat;
 *                            een ander op dezelfde track: wisselen op de maat;
 *                            een lege plek: alleen kiezen (met opnemen aan: beginnen)
 *   track.N.pattern.K.now    hetzelfde, maar starten op de volgende TEL en meteen stoppen (shift)
 *   track.N.pattern.stop(.now)  stoppen op de maat (meteen)
 *   track.N.pattern.step.S   stap S (1–64) van de gekozen plek: de laatst gespeelde noot erop of eraf
 *   track.N.pattern.length / .length.up / .length.down / .swing / .clear   de gekozen plek
 *   patterns.row.K           rij K op alle tracks (scene launch); patterns.stop(.now) alles
 *   patterns.tempo           het eigen tempo zonder maatgever (40–240 bpm); patterns.tap tikt het
 *   patterns.record          live opnemen aan/uit (de noten zelf gaan niet over de bus: noten.js)
 *
 * Reads (VRAGEN B4): null = geen instrument op de track (niets te doen),
 * 0 = leeg, 0,5 = gevuld, 1 = speelt; een plek die op de maat wacht
 * (starten of stoppen) knippert op de tel van de klok tussen 1 en 0,5.
 * Bewerken (stappen, lengte, swing, wissen, opnemen) slaat terugspelen over:
 * het patroon is al bewaard (zie OVERSLAAN in terugspelen.js).
 */
export function bindPatronen(engine) {
  // Altijd gedefinieerd, ook op een engine zonder speler (een dubbel in de
  // tests): dan doen ze niets en lezen ze null, zoals master.fx.*.
  const pt = engine.patronen ?? GEEN_PATRONEN;
  const k01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  const melding = (r, nr) => { if (r && !r.ok && r.reden) engine.emit('melding', { tekst: `track ${nr}, patroon: ${r.reden}`, soort: 'fout' }); };
  for (const [nr, id] of TRACKS) {
    const n = `track.${nr}.pattern`;
    const inst = () => engine.instrumentOp?.(id) ?? null;
    const gekozenP = () => pt.patroon(id, pt.gekozen(id));
    for (let k = 1; k <= PLEKKEN; k++) {
      define(`${n}.${k}`, 'trigger', (on) => { if (on) melding(pt.druk(id, k), nr); },
        { label: `Track ${nr} patroon ${k}: starten op de maat (speelt hij: stoppen op de maat)`, read: () => pt.lamp(id, k) });
      define(`${n}.${k}.now`, 'trigger', (on) => { if (on) melding(pt.druk(id, k, { meteen: true }), nr); },
        { label: `Track ${nr} patroon ${k} meteen: starten op de volgende tel, stoppen meteen`, read: () => pt.lamp(id, k) });
    }
    // 0,5 = er speelt (of wacht) iets om te stoppen, 1 = hij stopt al op de maat, 0 = niets.
    const stopLamp = () => {
      if (!inst()) return null;
      const st = pt.stand(id);
      return !st ? null : st.stopt ? 1 : st.speelt || st.wacht ? 0.5 : 0;
    };
    define(`${n}.stop`, 'trigger', (on) => { if (on) pt.stop(id); },
      { label: `Track ${nr} patroon stoppen op de maat`, read: stopLamp });
    define(`${n}.stop.now`, 'trigger', (on) => { if (on) pt.stop(id, { meteen: true }); },
      { label: `Track ${nr} patroon meteen stoppen`, read: stopLamp });
    for (let s = 1; s <= MAX_LENGTE; s++) {
      define(`${n}.step.${s}`, 'trigger', (on) => { if (on && inst()) pt.wisselStap(id, pt.gekozen(id), s - 1); },
        { label: `Track ${nr} patroon: stap ${s} aan/uit (de laatst gespeelde noot)`, read: () => pt.stapLamp(id, s - 1) });
    }
    define(`${n}.length`, 'value', (v) => { if (inst()) pt.zetLengte(id, pt.gekozen(id), 1 + Math.round(k01(v) * (MAX_LENGTE - 1))); },
      { label: `Track ${nr} patroon: lengte (1–${MAX_LENGTE} stappen)`,
        read: () => (!inst() ? null : ((gekozenP()?.lengte ?? STANDAARD_LENGTE) - 1) / (MAX_LENGTE - 1)) });
    for (const [naam, r] of [['up', 1], ['down', -1]]) {
      define(`${n}.length.${naam}`, 'trigger', (on) => {
        if (on && inst()) pt.zetLengte(id, pt.gekozen(id), volgendeLengte(gekozenP()?.lengte ?? STANDAARD_LENGTE, r));
      }, { label: `Track ${nr} patroon: ${r > 0 ? 'langer' : 'korter'}`, read: () => (inst() ? 0 : null) });
    }
    define(`${n}.swing`, 'value', (v) => { if (inst()) pt.zetSwing(id, pt.gekozen(id), SWING.min + k01(v) * (SWING.max - SWING.min)); },
      { label: `Track ${nr} patroon: swing (${SWING.min} = recht, ${SWING.max} = een halve stap)`,
        read: () => (!inst() ? null : ((gekozenP()?.swing ?? SWING.min) - SWING.min) / (SWING.max - SWING.min)) });
    // Leegmaken is destructief: pas bij een tweede druk binnen 3 s (zoals een instrument kiezen over een spelend nummer).
    let zekerTot = 0;
    define(`${n}.clear`, 'trigger', (on) => {
      if (!on || !inst()) return;
      const plek = pt.gekozen(id);
      if (!gevuld(pt.patroon(id, plek))) return;
      const nu = performance.now();
      if (!(nu < zekerTot)) {
        zekerTot = nu + 3000;
        engine.emit('melding', { tekst: `track ${nr}: druk nog eens (binnen 3 s) om patroon ${plek} leeg te maken`, soort: 'info' });
        return;
      }
      zekerTot = 0;
      pt.wis(id, plek);
    }, { label: `Track ${nr} patroon leegmaken (de gekozen plek; tweede druk binnen 3 s)`,
         read: () => (!inst() ? null : gevuld(gekozenP()) ? 0.5 : 0) });
  }

  const naarV = (bpm) => (bpm - TEMPO.min) / (TEMPO.max - TEMPO.min);
  define('patterns.tempo', 'value', (v) => pt.zetTempo(TEMPO.min + k01(v) * (TEMPO.max - TEMPO.min)),
    { label: `Patronen: eigen tempo zonder maatgever (${TEMPO.min}–${TEMPO.max} bpm)`, read: () => naarV(pt.tempo) });
  // Tikken zet het tempo via de bus (patterns.tempo): zo staat het als getal in
  // het handelingenlog en speelt terugspelen hetzelfde tempo terug.
  const tap = new TapTempo();
  define('patterns.tap', 'trigger', (on) => {
    if (!on) return;
    const r = tap.tap(performance.now());
    if (r) invoke('patterns.tempo', naarV(Math.min(TEMPO.max, Math.max(TEMPO.min, r.bpm))));
  }, { label: 'Patronen: tempo tikken (zonder maatgever)', read: () => 0 });
  define('patterns.record', 'trigger', (on) => { if (on) pt.neemOp(!pt.opnemen); },
    { label: 'Patronen: live opnemen aan/uit (wat je speelt komt in het patroon dat speelt)', read: () => (pt === GEEN_PATRONEN ? null : pt.opnemen ? 1 : 0) });
  for (let k = 1; k <= PLEKKEN; k++) {
    define(`patterns.row.${k}`, 'trigger', (on) => { if (on) pt.rij(k); },
      { label: `Patronen: rij ${k} op alle tracks (op de maat; leeg = die track stopt)`, read: () => pt.rijLamp(k) });
  }
  const iets = () => (pt.spelend().length ? 0.5 : 0);
  define('patterns.stop', 'trigger', (on) => { if (on) pt.stopAlles(); },
    { label: 'Patronen: alles stoppen op de maat', read: iets });
  define('patterns.stop.now', 'trigger', (on) => { if (on) pt.stopAlles({ meteen: true }); },
    { label: 'Patronen: alles meteen stoppen', read: iets });
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

  // De noodknoppen van de beamer (src/video/eindbeeld.js), op het EINDbeeld:
  // de zaal, het losse venster en de video-opname zien hetzelfde.
  // Zwart als schakelaar dooft in 250 ms; de drukvariant is direct en laat
  // bij loslaten de schakelaar beslissen. read = de stand van de SCHAKELAAR
  // (niet hoe ver de fade is), zodat een LED meteen zegt wat je deed.
  define('video.black', 'trigger', (on) => { if (on) mixer.zetZwart(!mixer.eindbeeld.zwartAan); },
    { label: 'Video: zwart (aan/uit)', read: () => (mixer.eindbeeld.zwartAan ? 1 : 0) });
  define('video.black.hold', 'trigger', (on) => mixer.zetZwartVast(!!on),
    { label: 'Video: zwart zolang je drukt', read: () => (mixer.eindbeeld.zwartVast ? 1 : 0) });
  define('video.freeze', 'trigger', (on) => { if (on) mixer.zetBevroren(!mixer.eindbeeld.bevroren); },
    { label: 'Video: beeld bevriezen (aan/uit)', read: () => (mixer.eindbeeld.bevroren ? 1 : 0) });
  define('video.master', 'value', (v) => mixer.zetMaster(v),
    { label: 'Video: master (helderheid van het eindbeeld)', read: () => mixer.eindbeeld.master });
  define('video.flash', 'trigger', (on) => { if (on) mixer.flits(); },
    { label: 'Video: witte flits', read: () => (mixer.flitsNu() > 0 ? 1 : 0) });
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
    { label: 'Vormlaag: reageren op laag · midden · hoog · klap · luid (de zaal) · klap · tel (de maatgever)' });
  define('video.layer.react.target', 'trigger', (on) => { if (on) router.volgendDoel(vormen.gekozen); },
    { label: 'Vormlaag: reageren, welke knop (1–6)' });
}

/**
 * Wat de schermlaag doet maar op de bus hoort, zodat een APC-knop het kan:
 * een track in een venster zetten (L = focus, R = de tweede), opnemen, door
 * racks bladeren. De functies
 * komen van app.js; hier alleen de namen en de read.
 */
export function bindApp({ toon, venster, opnemer, opnameStart, opnameStop, opnameSoort, rackStap, masterRackStap = () => {} }) {
  for (const [nr, id] of TRACKS) {
    for (const v of ['L', 'R']) {
      define(`window.${v}.show.${nr}`, 'trigger', (on) => { if (on) toon(v, id); },
        { label: v === 'L' ? `Focus op track ${nr}` : `Track ${nr} als tweede (rechterhand)`, read: () => (venster()[v] === id ? 1 : 0) });
    }
    define(`track.${nr}.rack.next`, 'trigger', (on) => { if (on) rackStap(id, 1); }, { label: `Track ${nr} volgend rack` });
    define(`track.${nr}.rack.prev`, 'trigger', (on) => { if (on) rackStap(id, -1); }, { label: `Track ${nr} vorig rack` });
  }
  // De master-racks: de kant-en-klare (racks/sjablonen.json), master-paneel.js.
  define('master.rack.next', 'trigger', (on) => { if (on) masterRackStap(1); }, { label: 'Master volgend rack' });
  define('master.rack.prev', 'trigger', (on) => { if (on) masterRackStap(-1); }, { label: 'Master vorig rack' });
  define('record.start', 'trigger', (on) => { if (on && !opnemer.bezig) opnameStart(); },
    { label: 'Opname starten', read: () => (opnemer.bezig ? 1 : 0) });
  define('record.stop', 'trigger', (on) => { if (on && opnemer.bezig) opnameStop(); },
    { label: 'Opname stoppen (zet hem achter shift)', read: () => (opnemer.bezig ? 1 : 0) });
  define('record.mode', 'trigger', (on) => { if (on && !opnemer.bezig) opnameSoort(); },
    { label: 'Opname: audio of audio + video', read: () => (opnemer.metVideo ? 1 : 0) });
}

/**
 * Het handelingenlog (docs/HANDELINGENLOG.md): aan/uit en terugspelen
 * stoppen. Op de bus zodat een toets of knop het kan; er staat bewust geen
 * APC-knop op. Terugspelen slaat log.* zelf over (terugspelen.js).
 */
export function bindLog({ log, wissel, terugspeler }) {
  define('log.toggle', 'trigger', (on) => { if (on) wissel(); },
    { label: 'Handelingenlog aan/uit', read: () => (log.bezig ? 1 : 0) });
  define('log.replay.stop', 'trigger', (on) => { if (on && terugspeler.bezig) terugspeler.stop(); },
    { label: 'Terugspelen stoppen', read: () => (terugspeler.bezig ? 1 : 0) });
}

/**
 * De kiesknoppen van de mapjes (lagen.js): Pan/Sends/User, de knoppen onder de
 * device knobs, en de grid-pagina's. Een kiesknop is een gewone action, dus
 * ook te koppelen aan een andere knop of te bedienen met de muis.
 */
/**
 * De auto-DJ op de bus (src/auto/automaat.js, docs/AUTO-DJ.md). Nog geen plek
 * op de standaard-APC: koppelen werkt. Reads: aan 1/0; ok 1 = bevestigd,
 * 0,5 = er staat iets klaar; de rest null zolang er niets te doen is.
 */
export function bindAuto(auto) {
  const klaar = () => auto.fase === 'klaar' && !!auto.volgende;
  // Waarom een knop van de auto-DJ nu niets doet (WAAROM NIET, bindEngine): uit, of nog niets klaar.
  const kan = (doe) => (on) => {
    if (!on) return;
    if (!auto.aan) { auto.emit?.('melding', { tekst: 'staat uit — zet hem eerst aan (knop "uit/aan" in de AUTO-rij)', soort: 'info' }); return; }
    if (!auto.volgende) { auto.emit?.('melding', { tekst: 'er staat nog geen overgang klaar: hij kiest nog (of de library is leeg)', soort: 'info' }); return; }
    doe();
  };
  define('auto.aan', 'trigger', (on) => { if (on) auto.zetAan(); },
    { label: 'Auto-DJ aan/uit', read: () => (auto.aan ? 1 : 0) });
  define('auto.ok', 'trigger', kan(() => auto.ok()),
    { label: 'Auto-DJ: de volgende overgang is goed', read: () => (!auto.volgende ? null : auto.volgende.bevestigd ? 1 : 0.5) });
  define('auto.skip', 'trigger', kan(() => auto.overslaan()),
    { label: 'Auto-DJ: niet deze, de volgende kandidaat', read: () => (klaar() ? 0 : null) });
  define('auto.langer', 'trigger', kan(() => auto.langer()),
    { label: 'Auto-DJ: nog 8 maten (of 30 s) langer op deze track', read: () => (klaar() ? 0 : null) });
  define('auto.nu', 'trigger', kan(() => auto.nu()),
    { label: 'Auto-DJ: de overgang nu (op de eerstvolgende 4 maten)', read: () => (klaar() ? 0 : null) });
}

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
