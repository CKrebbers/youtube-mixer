/**
 * DE INDELING ALS MODULE (Clay 19 okt: "alle knoppen veel beter en logischer …
 * echt modular … tijdens het bouwen switchen en testen … per nummer een andere
 * layout"; oogst bediening-091/092).
 *
 * Een indeling is DATA, per apparaat:
 *   { schema: 1, naam, apparaat, shift?, regels: [
 *       { control, actie, gedrag, shift?, laag?, led?, stap?, terug? } ] }
 *
 *   control  een control-id van het apparaat ('fader3', 'pad5-2', 'KeyQ')
 *   actie    een actie op de bus ('track.3.fader'), met variabelen:
 *              {focus}  de track met focus, op het moment van indrukken (vars.focus())
 *              {k}      kolom 1..8: één regel wordt bij het inlezen acht regels
 *                       ('fader{k}' -> 'track.{k}.fader'), zoals {n} op de bus
 *            of een laag: 'laag:grid.klank' opent die laag (en sluit de andere uit
 *            dezelfde groep 'grid'), 'laag:grid' gaat terug naar de basis van die groep.
 *   gedrag   'absoluut'   fader: 0..1 met soft-takeover (grijpen als hij langs de stand komt)
 *            'eindeloos'  ringknop of encoder: alleen het VERSCHIL, opgeteld bij de stand
 *                         (de ring toont de stand, dus na een wissel draai je door vanaf wat je ziet)
 *            'trigger'    indrukken = true, loslaten = false (op een waarde-actie: indrukken =
 *                         1, loslaten = wat er stond). Op een encoder: per tik een druk op
 *                         `actie` (op) of `terug` (neer).
 *            'schakelaar' per druk om: een trigger-actie krijgt de druk, een waarde-actie
 *                         gaat tussen 0 en 1. Op een laag: open/dicht.
 *   shift    alleen zolang shift vastzit
 *   laag     alleen zolang die laag open is ('grid.klank', 'device.rack': groep.naam)
 *   led      { kleur?, lees?, tel?, ring? } voor lampjes.js
 *   stap     (eindeloos) verandering per tik, 0..1; standaard 1/127
 *
 * Welke regel geldt (regelVoor): eerst de open lagen (nieuwste eerst), dan zonder
 * laag; binnen elk eerst de shift-regel (als shift vastzit), dan de gewone. Een
 * laag is dus de context en shift een variant daarbinnen: een laag hoeft geen
 * reparatieregels voor shift (v1 bediening-017). Shift vast op een eindeloze
 * knop zonder eigen shift-regel = fijn (× FIJN, bediening-075).
 *
 * Wat vastligt (v1, bediening-014): LOSLATEN GAAT ALTIJD NAAR DE ACTIE VAN HET
 * INDRUKKEN, ook als intussen de indeling, shift, een laag of de focus wisselde.
 * Een indeling wisselen zet nooit een klank: alleen regels en lagen veranderen.
 *
 * Kent geen hardware (het apparaat geeft gebeurtenissen), geen Web MIDI en geen
 * DOM. De bus komt van buiten (kern/bus.js).
 */
import { Emitter } from '../kern/emitter.js';

export const SCHEMA = 1;
export const GEDRAGEN = Object.freeze(['absoluut', 'eindeloos', 'trigger', 'schakelaar', 'aanslag', 'druk']);
/** Aanslag en druk (Maschine-pads): zo laag gaat een ingedrukte pad nooit (anders valt het gebaar weg bij lichte druk). */
export const DRUK_MIN = 0.1;
/** Soft-takeover: binnen 0,02 is dichtbij (~2,5 stappen van 127; kleiner was frustrerend fijn, v1). */
export const TAKEOVER_EPS = 0.02;
/** Een vorige faderstand ouder dan 1 s is geen bewijs meer dat hij erdoorheen ging (v1 LAST_TTL). */
export const LAATSTE_TTL = 1000;
/** Een laagknop langer vasthouden dan dit = gluren: loslaten zet terug wat er open stond (v1). */
export const GLUREN_MS = 400;
/** Shift op een eindeloze knop zonder shift-regel: zoveel fijner. */
export const FIJN = 0.1;
/** Hooguit zoveel tikken per bericht van een encoder (een draai die doorschiet springt niet ver). */
export const MAX_TIKKEN = 8;
export const STAP = 1 / 127;
const LAAG = 'laag:';
const NAAM_LAAG = /^[a-z][a-z0-9]*(\.[a-z0-9]+)?$/i;
const NAAM_ACTIE = /^[\w.{}:-]+$/;

const standaardKlok = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

export const sleutelVan = (r) => `${r.control}${r.shift ? '#shift' : ''}${r.laag ? `@${r.laag}` : ''}`;
export const isLaagActie = (actie) => typeof actie === 'string' && actie.startsWith(LAAG);
/** 'laag:grid.klank' -> { groep: 'grid', naam: 'grid.klank' }; 'laag:grid' -> { groep: 'grid', naam: null }. */
export function leesLaagActie(actie) {
  const rest = actie.slice(LAAG.length);
  if (!NAAM_LAAG.test(rest)) return null;
  const i = rest.indexOf('.');
  return i < 0 ? { groep: rest, naam: null } : { groep: rest.slice(0, i), naam: rest };
}
const groepVan = (laag) => laag.split('.')[0];

/** Vervangt {k} door de kolom in elk tekstveld van een regel (ook led.lees). */
function metKolom(r, k) {
  const z = (s) => (typeof s === 'string' ? s.replaceAll('{k}', String(k)) : s);
  const uit = { ...r, control: z(r.control), actie: z(r.actie) };
  if (r.terug !== undefined) uit.terug = z(r.terug);
  if (r.led?.lees !== undefined) uit.led = { ...r.led, lees: z(r.led.lees) };
  return uit;
}
const heeftKolom = (r) => [r.control, r.actie, r.terug, r.led?.lees].some((s) => typeof s === 'string' && s.includes('{k}'));

/** Een actie zoals de bus hem kent, om de soort na te kijken: elke variabele wordt track 1. */
const alsVoorbeeld = (actie) => actie.replace(/\{\w+\}/g, '1');

/**
 * Mag deze (uitgeschreven) regel zo op dit apparaat? Geeft een reden of null.
 * `soortVan(id)` -> 'waarde'|'trigger'|'commando'|null (null = de bus kent hem nog niet: niet controleren).
 */
export function controleerRegel(r, apparaat, soortVan = null) {
  if (!r || typeof r !== 'object') return 'geen regel';
  if (typeof r.control !== 'string' || !r.control) return '"control" ontbreekt';
  const c = apparaat.controls.get(r.control);
  if (!c) return `control "${r.control}" bestaat niet op ${apparaat.id}`;
  if (apparaat.shift && r.control === apparaat.shift) return `"${r.control}" is de shiftknop`;
  if (typeof r.actie !== 'string' || !NAAM_ACTIE.test(r.actie)) return `"actie" ontbreekt of is ongeldig`;
  if (!GEDRAGEN.includes(r.gedrag)) return `onbekend gedrag "${r.gedrag}"`;
  const mag = apparaat.gedragVoor?.[c.soort] ?? [];
  if (!mag.includes(r.gedrag)) return `${c.soort} "${r.control}" kan geen ${r.gedrag} (wel: ${mag.join(', ')})`;
  if (r.shift !== undefined && typeof r.shift !== 'boolean') return '"shift" is true of false';
  if (r.laag !== undefined && (typeof r.laag !== 'string' || !NAAM_LAAG.test(r.laag))) return `laag "${r.laag}" is geen naam (groep of groep.naam)`;
  if (r.stap !== undefined && (r.gedrag !== 'eindeloos' || !(typeof r.stap === 'number' && r.stap > 0 && r.stap <= 1))) return '"stap" is een getal 0..1, alleen bij eindeloos';
  const encoderTrigger = c.soort === 'rel' && r.gedrag === 'trigger';
  if (encoderTrigger && (typeof r.terug !== 'string' || !NAAM_ACTIE.test(r.terug))) return 'een encoder als trigger heeft "terug" nodig (de actie voor neer)';
  if (!encoderTrigger && r.terug !== undefined) return '"terug" hoort alleen bij een encoder als trigger';
  if (r.led !== undefined) {
    const l = r.led;
    if (!l || typeof l !== 'object' || Array.isArray(l)) return '"led" is een object';
    if (l.lees !== undefined && (typeof l.lees !== 'string' || !NAAM_ACTIE.test(l.lees))) return 'led.lees is een actie';
    if (l.tel !== undefined && l.tel !== 'aan') return 'led.tel is "aan"';
    if (l.ring !== undefined && !['pan', 'volume', 'single'].includes(l.ring)) return 'led.ring is pan, volume of single';
    if (l.kleur !== undefined) {
      const namen = typeof l.kleur === 'string' ? [l.kleur] : (l.kleur && typeof l.kleur === 'object' ? Object.values(l.kleur) : null);
      if (!namen || !namen.length) return 'led.kleur is een kleurnaam of { aan, half, uit }';
      if (typeof l.kleur === 'object' && Object.keys(l.kleur).some((k) => !['aan', 'half', 'uit'].includes(k))) return 'led.kleur kent alleen aan, half en uit';
      const kent = (n) => (apparaat.kleur && n in apparaat.kleur) || (apparaat.tweekleur && n in apparaat.tweekleur);
      for (const n of namen) if (typeof n !== 'string' || !kent(n)) return `onbekende kleur "${n}"`;
    }
  }
  if (isLaagActie(r.actie)) {
    if (!leesLaagActie(r.actie)) return `"${r.actie}" is geen laag (laag:groep of laag:groep.naam)`;
    if (!['trigger', 'schakelaar'].includes(r.gedrag)) return 'een laag kies je met een knop (trigger of schakelaar)';
    return null;
  }
  if (soortVan) {
    for (const [actie, rol] of [[r.actie, 'actie'], [r.terug, 'terug']]) {
      if (actie === undefined) continue;
      const s = soortVan(alsVoorbeeld(actie));
      if (!s) continue;
      if (s === 'commando') return `${rol} "${actie}" is een commando, niet voor een knop`;
      if (['absoluut', 'eindeloos', 'aanslag', 'druk'].includes(r.gedrag) && s !== 'waarde') return `${r.gedrag} vraagt een waarde-actie, "${actie}" is een ${s}`;
    }
  }
  return null;
}

/**
 * Een indeling-document nakijken en uitschrijven ({k}). Gooit bij iets dat de
 * hele indeling onbruikbaar maakt (geen object, ander schema of apparaat);
 * een regel die niet klopt gaat naar `fouten` en wordt overgeslagen, niet
 * geraden. Twee regels met dezelfde sleutel (control, shift, laag): de laatste
 * wint, en de sleutel staat in `dubbel` (zo kan een eigen regel een regel uit
 * een {k}-sjabloon vervangen).
 */
export function normaliseerIndeling(doc, { apparaat, soortVan = null } = {}) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('indeling: geen object');
  if (doc.schema !== SCHEMA) throw new Error(`indeling: schema ${doc.schema} (verwacht ${SCHEMA})`);
  if (typeof doc.naam !== 'string' || !doc.naam.trim()) throw new Error('indeling: "naam" ontbreekt');
  if (doc.apparaat !== apparaat.id) throw new Error(`indeling "${doc.naam}" is voor ${doc.apparaat}, niet voor ${apparaat.id}`);
  if (!Array.isArray(doc.regels)) throw new Error(`indeling "${doc.naam}": "regels" is geen lijst`);
  const shift = doc.shift === undefined ? (apparaat.shift ?? null) : doc.shift;
  if (shift !== null && !apparaat.controls.has(shift)) throw new Error(`indeling "${doc.naam}": shiftknop "${shift}" bestaat niet`);
  const op = new Map();
  const fouten = [];
  const dubbel = [];
  doc.regels.forEach((bron, i) => {
    const regels = bron && typeof bron === 'object' && heeftKolom(bron)
      ? Array.from({ length: apparaat.kolommen ?? 8 }, (_, k) => metKolom(bron, k + 1))
      : [bron];
    for (const r of regels) {
      const reden = controleerRegel(r, apparaat, soortVan);
      if (reden) { fouten.push(`regel ${i}${r?.control ? ` (${r.control})` : ''}: ${reden}`); continue; }
      const regel = Object.freeze({
        control: r.control, actie: r.actie, gedrag: r.gedrag,
        ...(r.shift ? { shift: true } : {}),
        ...(r.laag ? { laag: r.laag } : {}),
        ...(r.led ? { led: Object.freeze({ ...r.led }) } : {}),
        ...(r.stap !== undefined ? { stap: r.stap } : {}),
        ...(r.terug !== undefined ? { terug: r.terug } : {}),
        ...(r.label ? { label: String(r.label) } : {}),
      });
      const k = sleutelVan(regel);
      if (op.has(k)) dubbel.push(k);
      op.set(k, regel);
    }
  });
  const lagen = new Set();
  for (const r of op.values()) {
    if (r.laag) lagen.add(r.laag);
    if (isLaagActie(r.actie)) { const l = leesLaagActie(r.actie); if (l.naam) lagen.add(l.naam); }
  }
  return {
    indeling: Object.freeze({ schema: SCHEMA, naam: doc.naam, apparaat: apparaat.id, shift, op, lagen: [...lagen], bron: doc }),
    fouten, dubbel,
  };
}

/**
 * De indeling aan het werk, voor één apparaat: welke indeling actief is (te
 * wisselen tijdens het spelen, ook per nummer), shift, de open lagen, wat er
 * vastzit, soft-takeover en eindeloos.
 *
 * Gebeurtenissen: 'verander' (andere of bewerkte indeling), 'laag', 'shift',
 * 'onbekend' ({ doel }: de bus kent die actie (nog) niet; één keer per actie),
 * 'fout' ({ doel, fout }), 'melding' ({ tekst, soort }).
 */
export class Indeling extends Emitter {
  /**
   * @param bus      kern/bus.js (doe, lees, zoek)
   * @param apparaat apparaten/*.js
   * @param vars     { focus: () => n, … }: variabelen in een actie
   * @param nu       ms-klok (soft-takeover, gluren)
   * @param bron     wat er als bron in het log komt (standaard het apparaat-id)
   */
  constructor({ bus, apparaat, vars = {}, nu = standaardKlok, bron = apparaat.id }) {
    super();
    this.bus = bus;
    this.apparaat = apparaat;
    this.vars = vars;
    this.nu = nu;
    this.bron = bron;
    this.docs = new Map();        // naam -> genormaliseerde indeling
    this.actief = null;
    this.standaard = null;        // naam van de indeling zonder eigen keuze
    this.perNummer = new Map();   // nummer-id -> indelingnaam
    this.open = [];               // open lagen, nieuwste eerst
    this.shift = false;
    this._shiftVan = null;        // welke control shift indrukte (los = shift los, welke indeling er ook staat)
    this.vast = new Map();        // control -> wat het indrukken deed; loslaten gaat daarheen
    this.staat = new Map();       // control -> { doel, gepakt, vorige, gestuurd, tijd, vorigeRuw }
    this.versie = 0;              // +1 bij alles wat bepaalt welke regel waar geldt (lampjes plannen opnieuw)
    this._onbekend = new Set();
    this._actiefCache = { versie: -1, shift: null, kaart: null };
  }

  /** De soort van een actie volgens de bus, of null als hij (nog) niet bestaat. */
  soortVan(id) { return this.bus?.zoek?.(id)?.def?.soort ?? null; }

  // ---- indelingen beheren ------------------------------------------------------

  /** Een indeling erbij (of een met dezelfde naam vervangen: live herladen). */
  voegToe(doc) {
    const { indeling, fouten, dubbel } = normaliseerIndeling(doc, { apparaat: this.apparaat, soortVan: (id) => this.soortVan(id) });
    this.docs.set(indeling.naam, indeling);
    if (this.standaard === null) this.standaard = indeling.naam;
    if (!this.actief || this.actief.naam === indeling.naam) this._zetActief(indeling, this.actief?.naam === indeling.naam);
    return { naam: indeling.naam, fouten, dubbel };
  }

  /** Welke indeling geldt als een nummer er geen eigen heeft. */
  zetStandaard(naam) { if (this.docs.has(naam)) this.standaard = naam; return this.standaard === naam; }

  namen() { return [...this.docs.keys()]; }

  /** Wissel naar een andere indeling. Wat vastzit blijft van zijn indrukken; lagen gaan dicht. */
  kies(naam) {
    const d = this.docs.get(naam);
    if (!d) { this.emit('melding', { tekst: `indeling "${naam}" bestaat niet (${this.apparaat.naam})`, soort: 'fout' }); return false; }
    if (this.actief === d) return true;
    this._zetActief(d, false);
    return true;
  }

  _zetActief(d, herlaad) {
    this.actief = d;
    // Lagen die de nieuwe indeling niet kent, gaan dicht; bij een nieuwe indeling alle.
    this.open = herlaad ? this.open.filter((l) => d.lagen.includes(l)) : [];
    this.versie++;
    this.emit('verander', { naam: d.naam, herlaad });
  }

  /** Per nummer: nummer-id -> indelingnaam (null = terug naar de standaard). */
  koppelNummer(id, naam) {
    if (naam === null || naam === undefined) this.perNummer.delete(String(id));
    else this.perNummer.set(String(id), String(naam));
  }

  /** De tabel als JSON (bewaren is niet de zaak van deze module). */
  perNummerJSON() { return { schema: SCHEMA, apparaat: this.apparaat.id, nummers: Object.fromEntries(this.perNummer) }; }

  laadPerNummer(json) {
    const doc = typeof json === 'string' ? JSON.parse(json) : json;
    this.perNummer.clear();
    for (const [id, naam] of Object.entries(doc?.nummers ?? {})) if (typeof naam === 'string') this.perNummer.set(String(id), naam);
    return this.perNummer.size;
  }

  /** Een nummer krijgt focus of wordt geladen: zijn indeling, of de standaard. Geeft de naam. */
  kiesVoorNummer(id) {
    let naam = id === null || id === undefined ? this.standaard : (this.perNummer.get(String(id)) ?? this.standaard);
    if (!this.docs.has(naam)) {
      this.emit('melding', { tekst: `nummer ${id}: indeling "${naam}" bestaat niet, de standaard blijft`, soort: 'fout' });
      naam = this.standaard;
    }
    if (naam !== null) this.kies(naam);
    return naam;
  }

  /** De actieve indeling als document (zoals hij bewaard wordt), met wat er geleerd is. */
  naarJSON(naam = this.actief?.naam) {
    const d = this.docs.get(naam);
    return d ? JSON.parse(JSON.stringify(d.bron)) : null;
  }

  /**
   * Eén regel in de actieve indeling zetten of vervangen (leren). Een regel met
   * dezelfde sleutel die er letterlijk staat gaat eruit; een regel uit een
   * {k}-sjabloon wordt overschreven (de laatste wint). Geeft { regel, was } of
   * { fout }.
   */
  zetRegel(r) {
    if (!this.actief) return { fout: 'geen indeling' };
    const reden = controleerRegel(r, this.apparaat, (id) => this.soortVan(id));
    if (reden) return { fout: reden };
    const k = sleutelVan(r);
    const was = this.actief.op.get(k) ?? null;
    const bron = this.actief.bron;
    const regels = bron.regels.filter((x) => heeftKolom(x) || sleutelVan(x) !== k);
    const schoon = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== false));
    regels.push(schoon);
    this.voegToe({ ...bron, regels });
    return { regel: this.actief.op.get(k), was };
  }

  /** Een regel weghalen (op sleutel). Een sjabloonregel kan zo niet weg: die komt uit {k}. */
  haalWeg(sleutel) {
    if (!this.actief) return false;
    const bron = this.actief.bron;
    const regels = bron.regels.filter((x) => heeftKolom(x) || sleutelVan(x) !== sleutel);
    if (regels.length === bron.regels.length) return false;
    this.voegToe({ ...bron, regels });
    return true;
  }

  // ---- welke regel geldt -----------------------------------------------------------

  /** De regel die NU geldt voor deze control: open lagen eerst, binnen elk shift eerst. */
  regelVoor(control, { shift = this.shift } = {}) {
    const op = this.actief?.op;
    if (!op) return null;
    for (const l of this.open) {
      if (shift) { const r = op.get(`${control}#shift@${l}`); if (r) return r; }
      const r = op.get(`${control}@${l}`);
      if (r) return r;
    }
    if (shift) { const r = op.get(`${control}#shift`); if (r) return r; }
    return op.get(control) ?? null;
  }

  /** Per control de regel die nu geldt (voor de lampjes). Dezelfde Map tot er iets verandert. */
  actieveRegels() {
    const c = this._actiefCache;
    if (c.kaart && c.versie === this.versie && c.shift === this.shift) return c.kaart;
    const kaart = new Map();
    for (const id of this.apparaat.controls.keys()) {
      const r = this.regelVoor(id);
      if (r) kaart.set(id, r);
    }
    this._actiefCache = { versie: this.versie, shift: this.shift, kaart };
    return kaart;
  }

  /** De actie met ingevulde variabelen, of null als een variabele nu niets is (geen focus). */
  vul(actie) {
    if (!actie.includes('{')) return actie;
    let leeg = false;
    const uit = actie.replace(/\{(\w+)\}/g, (_, naam) => {
      const v = this.vars[naam];
      const w = typeof v === 'function' ? v() : v;
      if (w === null || w === undefined) { leeg = true; return ''; }
      return String(w);
    });
    return leeg ? null : uit;
  }

  /** De stand van een actie of laag (0..1, boolean of null), zoals de lampjes hem lezen. */
  lees(doel) {
    if (doel === null) return null;
    if (isLaagActie(doel)) {
      const l = leesLaagActie(doel);
      if (!l) return null;
      return l.naam ? (this.open.includes(l.naam) ? 1 : 0) : (this.open.some((o) => groepVan(o) === l.groep) ? 0 : 1);
    }
    try { return this.bus.lees(doel); } catch (_) { return null; }
  }

  // ---- gebeurtenissen van het apparaat ------------------------------------------------

  /**
   * Eén gebeurtenis van het apparaat:
   *   { control, soort: 'druk'|'los'|'waarde'|'delta', waarde?, ruw?, delta?, shift? }
   * `shift` (toetsenbord) gaat voor de shiftknop van de indeling.
   * Geeft wat er gebeurde, of null (niets gekoppeld, of losgelaten zonder indrukken).
   */
  verwerk(g) {
    const { control } = g;
    // Druk (polyfone aftertouch) op een pad die je vasthoudt: de waarde volgt de druk.
    if (g.soort === 'aanraak') {
      const v = this.vast.get(control);
      if (!v?.druk || v.gedrag !== 'druk') return null;
      const w = Math.max(DRUK_MIN, Math.min(1, g.waarde));
      this._doe(v.doel, w);
      return { doel: v.doel, gedaan: true, waarde: w };
    }
    if (g.soort === 'druk' || g.soort === 'los') {
      const shiftKnop = this.actief?.shift ?? this.apparaat.shift;
      if (control === this._shiftVan || (g.soort === 'druk' && shiftKnop && control === shiftKnop)) {
        const aan = g.soort === 'druk';
        this._shiftVan = aan ? control : null;
        if (this.shift !== aan) { this.shift = aan; this.versie++; this.emit('shift', aan); }
        return { shift: aan };
      }
      if (g.soort === 'los') {
        const v = this.vast.get(control);
        if (!v) return null;
        this.vast.delete(control);
        return this._los(v);
      }
      // Indrukken terwijl hij nog vastzat (een gemist loslaten): eerst los.
      const nog = this.vast.get(control);
      if (nog) { this.vast.delete(control); this._los(nog); }
    }
    const shift = g.shift ?? this.shift;
    const regel = this.regelVoor(control, { shift });
    if (!regel) return null;
    const fijn = shift && !regel.shift;
    if (isLaagActie(regel.actie)) return g.soort === 'druk' ? this._laagDruk(control, regel) : null;
    if (g.soort === 'delta' && regel.gedrag === 'trigger') return this._tikken(regel, g.delta);
    const doel = this.vul(regel.actie);
    if (doel === null) return { regel, doel: null, gedaan: false };
    switch (regel.gedrag) {
      case 'absoluut': return g.soort === 'waarde' ? this._absoluut(control, regel, doel, g) : null;
      case 'eindeloos': return this._eindeloos(control, regel, doel, g, fijn);
      case 'aanslag': case 'druk': {
        if (g.soort !== 'druk') return null;
        if (!this.soortVan(doel)) { this._meldOnbekend(doel); this.vast.set(control, { niets: true }); return { regel, doel, gedaan: false }; }
        // De aanslag (velocity, 1..127) is de beginwaarde; loslaten = 0 (via vast, ook na een wissel van laag).
        const w = Math.max(DRUK_MIN, Math.min(1, (g.ruw ?? 127) / 127));
        this._doe(doel, w);
        this.vast.set(control, { doel, druk: true, gedrag: regel.gedrag });
        return { regel, doel, gedaan: true, waarde: w };
      }
      default: return g.soort === 'druk' ? this._druk(control, regel, doel) : null;
    }
  }

  _doe(doel, v) {
    if (!this.soortVan(doel)) { this._meldOnbekend(doel); return undefined; }
    try { return this.bus.doe(doel, v, { bron: this.bron }); } catch (fout) { this.emit('fout', { doel, fout }); return undefined; }
  }

  _meldOnbekend(doel) {
    const sjabloon = doel.replace(/^track\.\d+\./, 'track.{n}.');
    if (this._onbekend.has(sjabloon)) return;
    this._onbekend.add(sjabloon);
    this.emit('onbekend', { doel });
  }

  /** Trigger en schakelaar: indrukken. Loslaten gaat via `vast` naar hetzelfde doel. */
  _druk(control, regel, doel) {
    const soort = this.soortVan(doel);
    if (!soort) { this._meldOnbekend(doel); this.vast.set(control, { niets: true }); return { regel, doel, gedaan: false }; }
    if (soort === 'commando') { this.vast.set(control, { niets: true }); return { regel, doel, gedaan: false }; }
    if (soort === 'waarde') {
      const oud = this.lees(doel);
      if (regel.gedrag === 'schakelaar') {
        this._doe(doel, (oud ?? 0) >= 0.5 ? 0 : 1);
        this.vast.set(control, { niets: true });
      } else {
        this._doe(doel, 1);
        this.vast.set(control, { doel, soort, oud: oud ?? 0 });
      }
      return { regel, doel, gedaan: true };
    }
    const antwoord = this._doe(doel, true);
    this.vast.set(control, { doel, soort });
    return { regel, doel, gedaan: true, antwoord };
  }

  _los(v) {
    if (v.laag) return this._laagLos(v);
    if (v.niets) return null;
    if (v.druk) { this._doe(v.doel, 0); return { doel: v.doel, los: true }; }
    if (v.soort === 'waarde') { this._doe(v.doel, v.oud); return { doel: v.doel, los: true }; }
    this._doe(v.doel, false);
    return { doel: v.doel, los: true };
  }

  /** Een encoder als trigger: per tik een druk en een loslaten op `actie` (op) of `terug` (neer). */
  _tikken(regel, delta) {
    if (!delta) return null;
    const n = Math.min(MAX_TIKKEN, Math.abs(delta));
    const doel = this.vul(delta > 0 ? regel.actie : regel.terug);
    if (doel === null) return { regel, doel: null, gedaan: false };
    for (let i = 0; i < n; i++) { this._doe(doel, true); this._doe(doel, false); }
    return { regel, doel, gedaan: true, tikken: n };
  }

  _staatVoor(control, doel) {
    let st = this.staat.get(control);
    if (!st) { st = { doel, gepakt: false, vorige: null, gestuurd: null, tijd: 0, vorigeRuw: null }; this.staat.set(control, st); }
    // Wijst dezelfde knop nu ergens anders heen (focus, laag, indeling): los, opnieuw beginnen.
    if (st.doel !== doel) { st.doel = doel; st.gepakt = false; st.vorige = null; st.gestuurd = null; st.vorigeRuw = null; }
    return st;
  }

  /**
   * Soft-takeover (v1 bediening-011): pas grijpen als de fader binnen 0,02 komt
   * of er sinds het vorige bericht DOORHEEN beweegt. Verzette iets anders de stand
   * (muis, toetsen, een tweede controller) meer dan 0,02, dan opnieuw grijpen.
   */
  _absoluut(control, regel, doel, g) {
    if (!this.soortVan(doel)) { this._meldOnbekend(doel); return { regel, doel, gedaan: false }; }
    const st = this._staatVoor(control, doel);
    const nu = this.nu();
    if (st.vorige !== null && nu - st.tijd > LAATSTE_TTL) st.vorige = null;
    st.tijd = nu;
    const v = g.waarde;
    const sw = this.lees(doel);
    if (st.gepakt && typeof sw === 'number' && st.gestuurd !== null && Math.abs(sw - st.gestuurd) > TAKEOVER_EPS) {
      st.gepakt = false;
      st.vorige = null;
    }
    if (typeof sw !== 'number') st.gepakt = true;
    else if (!st.gepakt) {
      const dichtbij = Math.abs(v - sw) <= TAKEOVER_EPS;
      const doorheen = st.vorige !== null && Math.sign(v - sw) !== Math.sign(st.vorige - sw);
      if (dichtbij || doorheen) st.gepakt = true;
    }
    st.vorige = v;
    if (!st.gepakt) return { regel, doel, gedaan: false, waarde: v, stand: sw };
    st.gestuurd = v;
    this._doe(doel, v);
    return { regel, doel, gedaan: true, waarde: v };
  }

  /**
   * Eindeloos (v1 bediening-012): het verschil, opgeteld bij de stand van de bus.
   * Een ringknop stuurt absolute waarden: verschil met zijn vorige bericht; het
   * eerste bericht (of na een andere doel, of als iets anders de stand verzette)
   * alleen onthouden: één tik kwijt, nooit een sprong. Op de aanslag (0 of 127)
   * nog eens hetzelfde bericht = doordraaien. Een encoder stuurt het verschil zelf.
   */
  _eindeloos(control, regel, doel, g, fijn) {
    if (!this.soortVan(doel)) { this._meldOnbekend(doel); return { regel, doel, gedaan: false }; }
    const st = this._staatVoor(control, doel);
    st.gepakt = true;
    const sw = this.lees(doel);
    let tikken;
    if (g.soort === 'delta') tikken = g.delta;
    else if (g.soort === 'waarde') {
      const ruw = g.ruw ?? Math.round(g.waarde * 127);
      if (typeof sw === 'number' && st.gestuurd !== null && Math.abs(sw - st.gestuurd) > TAKEOVER_EPS) st.vorigeRuw = null;
      const vorige = st.vorigeRuw;
      st.vorigeRuw = ruw;
      if (vorige === null) { st.gestuurd = typeof sw === 'number' ? sw : null; return { regel, doel, gedaan: false }; }
      tikken = ruw - vorige;
      if (!tikken && (ruw === 127 || ruw === 0)) tikken = ruw === 127 ? 1 : -1;
    } else return null;
    if (!tikken || typeof sw !== 'number') return { regel, doel, gedaan: false };
    const nieuw = Math.min(1, Math.max(0, sw + tikken * (regel.stap ?? STAP) * (fijn ? FIJN : 1)));
    st.gestuurd = nieuw;
    if (nieuw === sw) return { regel, doel, gedaan: false, waarde: sw };
    this._doe(doel, nieuw);
    return { regel, doel, gedaan: true, waarde: nieuw, tikken };
  }

  // ---- lagen ------------------------------------------------------------------------

  _zetLagen(open) {
    if (open.length === this.open.length && open.every((l, i) => l === this.open[i])) return;
    this.open = open;
    this.versie++;
    this.emit('laag', [...open]);
  }

  /**
   * Een laagknop indrukken. Schakelaar: open/dicht. Trigger: open (kort = blijft
   * open, vasthouden >= GLUREN_MS = gluren: loslaten zet terug wat er stond).
   */
  _laagDruk(control, regel) {
    const l = leesLaagActie(regel.actie);
    const voor = [...this.open];
    const zonderGroep = this.open.filter((o) => groepVan(o) !== l.groep);
    let open;
    if (!l.naam) open = zonderGroep;
    else if (regel.gedrag === 'schakelaar' && this.open.includes(l.naam)) open = zonderGroep;
    else open = [l.naam, ...zonderGroep];
    this._zetLagen(open);
    this.vast.set(control, { laag: true, gluren: regel.gedrag === 'trigger', voor, t0: this.nu() });
    return { regel, laag: l.naam ?? l.groep, open: [...this.open] };
  }

  _laagLos(v) {
    if (v.gluren && this.nu() - v.t0 >= GLUREN_MS) this._zetLagen(v.voor);
    return { laag: true, open: [...this.open] };
  }

  /** Alle lagen dicht (basis). */
  sluitLagen() { this._zetLagen([]); }

  // ---- loslaten -----------------------------------------------------------------------

  /** Alles wat vastzit loslaten (toetsenbord blur, verborgen tabblad). */
  laatAllesLos() {
    const vast = [...this.vast.values()];
    this.vast.clear();
    for (const v of vast) this._los(v);
    if (this._shiftVan || this.shift) { this._shiftVan = null; this.shift = false; this.versie++; this.emit('shift', false); }
  }

  /**
   * De controller is weg (poort 'disconnected'): alles los, shift uit, en
   * soft-takeover en eindeloos opnieuw (de knoppen kunnen intussen verdraaid zijn).
   */
  losgekoppeld() {
    this.laatAllesLos();
    for (const st of this.staat.values()) { st.gepakt = false; st.vorige = null; st.vorigeRuw = null; st.gestuurd = null; }
  }

  status() {
    return { apparaat: this.apparaat.id, naam: this.actief?.naam ?? null, lagen: [...this.open], shift: this.shift, vast: this.vast.size };
  }
}
