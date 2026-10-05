import { Emitter } from '../lib/emitter.js';
import { parseMessage } from './midi.js';
import { Mapping } from './mapping.js';
import { trackVanDeck, TRACKS } from './actions.js';
import { PALETTE } from './devices/apc40mk2.js';
import { INSTRUMENTEN } from '../engine/instrumenten/index.js';
import { KNOP_KANAAL, PAD_KANAAL, PAD_NOOT, WIEL_SIG, GROEPEN, knopNoot, padVanNoot } from './devices/maschine-mk2.js';
import { tekenScherm } from './maschine-scherm.js';

/**
 * De Maschine MK2 in VARVE (docs/MASCHINE.md), zoals de AV-app-hub hem
 * doorgeeft: virtuele MIDI op de nep-poort "Maschine MK2 (hub)" (hub.js,
 * `speelPoort('maschine-mk2')`), lampjes terug via zijn uitgang, de twee
 * schermen via `scherm(nr, bytes)`. Alleen met `?hub=`: zonder de vlag wordt
 * dit bestand niet geladen.
 *
 * SPEELMODUS (de enige tot het patronen-spoor er is, zie docs/MASCHINE.md):
 *   pads 1–16        noten 36–51 naar de speeltrack, via noten.js (zoals een
 *                    keyboard: loslaten gaat naar waar de aanslag heen ging);
 *                    de drums liggen precies op 36–51, elk ander instrument
 *                    speelt ze als C2–D#3. Polyfone aftertouch = druk per noot.
 *   groep A–H        focus op track 1–8 (mappings/maschine-mk2.json)
 *   draaiknop 1–8    de acht instrumentknoppen van de speeltrack, relatief
 *                    (mapping; SHIFT = fijn)
 *   masterwiel       draaien = een ander instrument KIEZEN voor de focus-track
 *                    (op het scherm, nog niets veranderd); indrukken of ENTER =
 *                    zetten (`track.N.inst.choose`). Zo verandert een tik tegen
 *                    het wiel nooit per ongeluk je instrument.
 *   lampjes          pads: de kleur van het instrument op de speeltrack, gedimd,
 *                    fel bij een aanslag (en zolang hij klinkt-vastgehouden is);
 *                    groepen: instrument = zijn kleur (focus vol, anders gedimd),
 *                    nummer = wit gedimd (focus wit), leeg = uit (focus donkergrijs)
 *   schermen         maschine-scherm.js: speeltrack + instrument, de acht knoppen
 *
 * Wat de engine doet gaat over de bus (focus, knoppen, instrument kiezen);
 * noten niet (een noot is geen 0..1: noten.js). De engine kent geen MIDI.
 */

/** De bron van de pads in noten.js (sleutel van vastgehouden noten). */
export const BRON = 'hub-maschine-mk2-input';
export const BRON_NAAM = 'Maschine MK2 (hub)';
/** Een aanslag licht minstens zo lang fel op (een drumslag duurt op de pad maar ~15 ms). */
export const FLITS_MS = 150;
/** Een scherm hooguit zo vaak (en alleen als het veranderde). */
export const SCHERM_MS = 100;
/** Zo lang blijft een keuze van het masterwiel staan als je niets doet. */
export const KANDIDAAT_MS = 8000;
/** Na een "druk nog eens" (er speelt een nummer) zo lang op het scherm. */
export const MELDING_MS = 3000;

/** De kleur van een instrument op pads en groepknoppen (APC-palet, devices/apc40mk2.js). */
export const KLEUREN = { poly: 'violet', fm: 'cyaan', schaal: 'geel', drums: 'oranje' };
const VOL = (soort) => PALETTE[KLEUREN[soort]] ?? PALETTE.wit;
/** Gedimd = de "donker"-tint van dezelfde kleur (#59xxxx, index + 1), zoals op de APC. */
const DONKER = (soort) => (PALETTE[`${KLEUREN[soort]}donker`] ?? PALETTE.grijs);

/** De keuzes van het masterwiel: geen, dan elk instrument (zelfde volgorde als track.N.inst). */
export const KEUZES = [null, ...INSTRUMENTEN.map((x) => x.soort)];

const sleutel = (kanaal, noot) => `${kanaal}:${noot}`;

export class Maschine extends Emitter {
  /**
   * @param engine  focus, speeltrack(), instrumentOp(id), deck(id)
   * @param noten   de Noten van instrument-paneel.js (de pads spelen daar)
   * @param read    read() van de bus
   * @param invoke  invoke() van de bus
   * @param nu      klok in ms (flitsen, schermtempo, keuze van het wiel)
   */
  constructor({ engine, noten, read = () => null, invoke = () => {}, nu = () => (globalThis.performance?.now() ?? Date.now()) }) {
    super();
    Object.assign(this, { engine, noten, read, invoke, nu });
    this.mapping = new Mapping({ read, invoke, now: nu,
      vars: () => ({ focus: trackVanDeck(engine.focus), speel: trackVanDeck(engine.speeltrack?.() ?? null) }) });
    this.poort = null;              // { in, uit, scherm } van HubMidi.speelPoort('maschine-mk2')
    this.leds = new Map();          // 'kanaal:noot' -> velocity zoals het laatst verstuurd
    this.schermen = [null, null];   // laatst verstuurde bytes per scherm
    this.schermTijd = [-Infinity, -Infinity];
    this.flits = new Map();         // pad-noot -> tot (ms)
    this.kandidaat = null;          // { id, index, tot }: het masterwiel, nog niet gezet
    this.melding = null;            // { tekst, tot }
    this.rx = 0;
  }

  laadMapping(doc) { return this.mapping.load(doc); }

  // ---- de poort ----------------------------------------------------------------

  /**
   * De nep-poorten van de hub aansluiten (`{ in, uit, scherm }`). Ingang zoals
   * noten.koppel: achter een onmidimessage/onstatechange die er al stond. Valt
   * de verbinding weg: noten en shift los; komt hij terug: alles opnieuw tekenen.
   */
  koppel(poort) {
    this.poort = poort;
    const ingang = poort.in;
    const vorig = ingang.onmidimessage || null, vorigSt = ingang.onstatechange || null;
    const zelf = this;
    ingang.onmidimessage = function (e) {
      try { vorig?.call(this, e); } finally {
        if (e?.data) {
          const m = parseMessage(e.data);
          m.port = BRON; m.portName = BRON_NAAM; m.time = e.timeStamp;
          zelf.ontvang(m);
        }
      }
    };
    ingang.onstatechange = function (e) { try { vorigSt?.call(this, e); } finally { zelf._staat(); } };
    this._staat();
    return this;
  }

  _staat() {
    if (this.poort?.in?.state === 'connected') return;
    // Weg: wat de pads vasthielden los, shift los; bij terugkomen alles opnieuw.
    this.noten?.los(BRON);
    this.mapping.losgekoppeld();
    this.vergeet();
  }

  /** Alles opnieuw sturen bij de volgende tik (lampjes en schermen). */
  vergeet() { this.leds.clear(); this.schermen = [null, null]; this.schermTijd = [-Infinity, -Infinity]; }

  // ---- invoer --------------------------------------------------------------------

  /** Eén bericht (plat, zoals parseMessage het maakt). Geeft true als het iets deed. */
  ontvang(msg) {
    if (!msg || !(msg.channel >= 0)) return false;
    this.rx++;
    // Pads: noten (en polyfone aftertouch) naar de speeltrack, zoals een keyboard.
    if (msg.channel === PAD_KANAAL && (msg.type === 'note' || msg.type === 'poly') && padVanNoot(msg.number) !== null) {
      if (msg.type === 'note' && msg.on) this.flits.set(msg.number, this.nu() + FLITS_MS);
      return !!this.noten?.ontvang({ ...msg, port: BRON, portName: BRON_NAAM });
    }
    // Het masterwiel: draaien = kiezen, indrukken (of ENTER) = zetten.
    if (msg.sig === WIEL_SIG) {
      const stappen = msg.value >= 64 ? msg.value - 128 : msg.value;
      return this.draaiWiel(stappen);
    }
    if (msg.type === 'note' && msg.channel === KNOP_KANAAL && (msg.number === knopNoot('wiel') || msg.number === knopNoot('enter'))) {
      return msg.on ? this.zetKeuze() : false;
    }
    // De rest via de mapping (groepen, draaiknoppen, shift). Een regel op de
    // speeltrack doet niets zolang er nergens een instrument is.
    if (msg.sig !== this.mapping.shiftSig && !(msg.type === 'note' && !msg.on)) {
      const regel = this.mapping.kies(msg.sig);
      if (regel?.action.includes('{speel}') && !this.engine.speeltrack?.()) return false;
    }
    return !!this.mapping.handle(msg)?.taken;
  }

  /** Index in KEUZES van wat er nu op track `id` staat. */
  _keuzeVan(id) { return Math.max(0, KEUZES.indexOf(this.engine.instrumentOp(id)?.soort ?? null)); }

  /**
   * De keuze van het wiel, als die nog geldt (zelfde focus, niet verlopen, nog
   * niet gezet). Anders is hij weg, ook als de focus later terugkomt: een keuze
   * van een halve minuut geleden mag niet opeens weer op het scherm staan.
   */
  _kandidaat() {
    const k = this.kandidaat;
    if (!k) return null;
    if (k.id !== this.engine.focus || this.nu() > k.tot || k.index === this._keuzeVan(k.id)) { this.kandidaat = null; return null; }
    return k;
  }

  /** Het masterwiel `stappen` verder: een ander instrument voor de focus-track kiezen (nog niet zetten). */
  draaiWiel(stappen) {
    if (!stappen || KEUZES.length < 2) return false;
    const id = this.engine.focus;
    const nu = this._keuzeVan(id);
    const van = this._kandidaat()?.index ?? nu;
    const n = KEUZES.length;
    const index = (((van + stappen) % n) + n) % n;
    this.kandidaat = index === nu ? null : { id, index, tot: this.nu() + KANDIDAAT_MS };
    this.melding = null;
    return true;
  }

  /** Wiel indrukken of ENTER: de keuze zetten, over de bus. */
  zetKeuze() {
    const k = this._kandidaat();
    if (!k) return false;
    const nr = trackVanDeck(k.id);
    this.invoke(`track.${nr}.inst.choose`, k.index / (KEUZES.length - 1));
    if (this._keuzeVan(k.id) === k.index) { this.kandidaat = null; this.melding = null; return true; }
    // Er speelt een nummer: de bus wil een tweede druk binnen 3 s. De keuze blijft staan.
    k.tot = this.nu() + MELDING_MS;
    this.melding = { tekst: `T${nr} speelt: druk nog eens`, tot: this.nu() + MELDING_MS };
    return true;
  }

  // ---- uitvoer -------------------------------------------------------------------

  /**
   * Wat de lampjes nu moeten zijn: Map('kanaal:noot' -> velocity). Pads en
   * groepen: APC-paletindex; andere knoppen: helderheid 0..127. Puur (leest
   * alleen de engine, noten en de eigen stand).
   */
  ledBeeld() {
    const uit = new Map();
    const nu = this.nu();
    const speel = this.engine.speeltrack?.() ?? null;
    const inst = speel ? this.engine.instrumentOp(speel) : null;
    const vast = speel && this.noten ? this.noten.ingedrukt(speel) : new Set();
    const pads = inst?.stand?.().pads ?? null;
    for (let i = 0; i < 16; i++) {
      const noot = PAD_NOOT + i;
      let v = PALETTE.uit;
      if (inst) {
        const fel = vast.has(noot) || (this.flits.get(noot) ?? -Infinity) > nu;
        const leeg = pads && pads[i] && !pads[i].gevuld;
        v = fel ? VOL(inst.soort) : leeg ? PALETTE.donkergrijs : DONKER(inst.soort);
      }
      uit.set(sleutel(PAD_KANAAL, noot), v);
    }
    for (const [nr, id] of TRACKS) {
      if (nr > GROEPEN.length) break;
      const focus = this.engine.focus === id;
      const i = this.engine.instrumentOp(id);
      const v = i ? (focus ? VOL(i.soort) : DONKER(i.soort))
        : this.engine.deck?.(id)?.buffer ? (focus ? PALETTE.wit : PALETTE.grijs)
        : focus ? PALETTE.donkergrijs : PALETTE.uit;
      uit.set(sleutel(KNOP_KANAAL, knopNoot(GROEPEN[nr - 1])), v);
    }
    // Knoppen die iets doen: zacht aan, fel als ze iets betekenen.
    uit.set(sleutel(KNOP_KANAAL, knopNoot('shift')), this.mapping.shift ? 127 : 16);
    uit.set(sleutel(KNOP_KANAAL, knopNoot('enter')), this._kandidaat() ? 127 : 0);
    return uit;
  }

  /** Wat de schermen tonen (zie maschine-scherm.js). */
  stand() {
    const speel = this.engine.speeltrack?.() ?? null;
    const inst = speel ? this.engine.instrumentOp(speel) : null;
    const knoppen = Array.from({ length: 8 }, (_, i) => {
      const p = inst?.params?.[i];
      if (!p) return { label: null, waarde: null, tekst: null };
      const w = inst.leesParam(i + 1);
      let tekst = null;
      try { tekst = p.eenheid ? p.eenheid(w) : null; } catch (_) { /* dan het percentage */ }
      return { label: p.label, waarde: w, tekst: tekst ?? `${Math.round((w ?? 0) * 100)}%` };
    });
    const f = this.engine.focus;
    const fi = this.engine.instrumentOp(f);
    const k = this._kandidaat();
    const nu = this.nu();
    return {
      speel: inst ? { nr: trackVanDeck(speel), naam: inst.naam } : null,
      focus: { nr: trackVanDeck(f), wat: fi ? fi.naam : this.engine.deck?.(f)?.buffer ? 'nummer' : 'leeg' },
      knoppen,
      kandidaat: k ? { naam: k.index === 0 ? 'geen' : INSTRUMENTEN[k.index - 1].naam } : null,
      shift: !!this.mapping.shift,
      melding: this.melding && this.melding.tot > nu ? this.melding.tekst : null,
    };
  }

  /**
   * Eén tik (de app roept dit ~30× per seconde aan): lampjes die veranderden
   * naar de uitgang (die gaat door de wachtrij van hub.js), en een scherm alleen
   * als het anders is dan wat er al staat, hooguit eens per SCHERM_MS.
   */
  tik() {
    const p = this.poort;
    if (!p?.uit || p.uit.state !== 'connected') return 0;
    let n = 0;
    for (const [k, v] of this.ledBeeld()) {
      if (this.leds.get(k) === v) continue;
      this.leds.set(k, v);
      const [kanaal, noot] = k.split(':').map(Number);
      p.uit.send([0x90 | kanaal, noot, v]);
      n++;
    }
    for (const [noot, tot] of this.flits) if (tot <= this.nu()) this.flits.delete(noot);
    if (p.scherm) {
      const nu = this.nu();
      let stand = null, sleutelStand = null;
      for (const nr of [0, 1]) {
        if (nu - this.schermTijd[nr] < SCHERM_MS) continue;
        stand ??= this.stand();
        sleutelStand ??= JSON.stringify(stand);
        if (this.schermen[nr]?.sleutel === sleutelStand) continue;
        const data = tekenScherm(stand, nr);
        const vorig = this.schermen[nr]?.data;
        this.schermen[nr] = { sleutel: sleutelStand, data };
        if (vorig && gelijk(vorig, data)) continue;
        p.scherm(nr, data);
        this.schermTijd[nr] = nu;
        n++;
      }
    }
    return n;
  }
}

function gelijk(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

