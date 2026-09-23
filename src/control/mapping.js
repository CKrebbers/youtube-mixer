import { Emitter, clamp } from '../lib/emitter.js';

/**
 * Mapping: van MIDI-signature naar action-id. Data, geen code.
 *
 * Deze laag kent GEEN hardware (dat is een device-profiel) en GEEN Web MIDI
 * (dat is midi.js). Hij krijgt een geparseerd bericht en beslist wat er de
 * action-bus op gaat. Daarmee is hij ook zonder browser te testen.
 *
 * Regelvorm:
 *   { "in": "cc:0:48", "action": "track.1.filter", "mode": "absolute" }
 *
 * `in` is `type:channel:number`. Een `*` op de kanaalplek matcht elk kanaal:
 * `cc:*:16` vangt de device knob van de APC40 mkII, die in mode 0 via het
 * kanaal meldt bij welke trackstrip hij hoort. `action` mag `{focus}` bevatten — dat wordt op
 * het moment van indrukken ingevuld, zodat één knop het deck bedient waar je
 * op dat moment naar kijkt.
 *
 * Modi:
 *   trigger       knop: indrukken/loslaten wordt true/false
 *   absolute      fader/knop 0..1, MET soft-takeover
 *   relative-2c   encoder, tweecomplement: 1..63 = +, 65..127 = -
 *   relative-bin  encoder, binary offset: waarde - 64 is de stap
 *
 * Soft-takeover uitzetten voor een regel die op een doorlopend bewegende waarde
 * staat (scrub bijvoorbeeld): zet `"takeover": 1` — dan valt elke stand binnen
 * de marge en pakt de knop altijd direct over.
 */

const TAKEOVER_EPS = 0.02;   // ~2,5 stappen van 127; kleiner is frustrerend fijn
const RELATIVE_STEP = 1 / 127;
/**
 * Hoe lang we de vorige stand van een fysieke control nog vertrouwen.
 *
 * Soft-takeover kijkt of een knop DOOR de softwarewaarde heen beweegt, en
 * daarvoor heeft hij de vorige stand nodig. Maar bij een controller met banken
 * wijst dezelfde knop na een bankwissel ergens anders heen, terwijl hij fysiek
 * intussen verdraaid kan zijn. Een oude stand is dan geen bewijs meer, en op
 * vals bewijs springt je filter alsnog.
 */
const LAST_TTL = 1000;

export const MODES = ['trigger', 'absolute', 'relative-2c', 'relative-bin'];

/** Vult {focus} en andere variabelen in. Puur tekst, geen kennis van decks. */
export function resolveTarget(action, vars) {
  return action.includes('{')
    ? action.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    : action;
}

/**
 * Mappings van vóór 23 september 2026 (versie 1) spraken in decks:
 * `deck.A.filter`. Sindsdien spreekt de bus in tracks, `track.1.filter`, zodat
 * er acht bij kunnen zonder dat de namen nóg een keer veranderen. Een oud
 * bestand wordt bij het inlezen omgezet; weggooien zou je eigen koppelingen
 * kosten.
 */
export const MAPPING_VERSIE = 2;
const OUDE_DECKS = { A: '1', B: '2' };
export function migreerAction(action) {
  return action.replace(/^deck\.([AB]|\{focus\})\./, (m, d) => `track.${OUDE_DECKS[d] ?? d}.`);
}

export class Mapping extends Emitter {
  /**
   * @param read   (actionId) -> huidige stand 0..1 of null. Nodig voor
   *               soft-takeover en voor relatieve encoders.
   * @param invoke (actionId, value) -> void. De action-bus.
   * @param vars   () -> { focus: 1 } (tracknummer). Wordt per bericht opnieuw gevraagd.
   */
  constructor({ read, invoke, vars = () => ({}), now = () => (globalThis.performance?.now() ?? Date.now()) } = {}) {
    super();
    this.read = read;
    this.invoke = invoke;
    this.vars = vars;
    this.now = now;
    this.name = 'leeg';
    this.device = 'generic';
    this.rules = new Map();     // sig -> regel
    this.state = new Map();     // sig -> { caught, last, target }
  }

  // ---- laden en opslaan --------------------------------------------------

  load(data) {
    const doc = typeof data === 'string' ? JSON.parse(data) : data;
    if (!doc || !Array.isArray(doc.rules)) throw new Error('mapping: "rules" ontbreekt of is geen lijst');

    const rules = new Map();
    const fouten = [];
    let gemigreerd = 0;
    doc.rules.forEach((r, i) => {
      if (!r || typeof r.in !== 'string' || typeof r.action !== 'string') {
        fouten.push(`regel ${i}: "in" en "action" zijn verplicht`); return;
      }
      const mode = r.mode || 'trigger';
      if (!MODES.includes(mode)) { fouten.push(`regel ${i}: onbekende modus "${mode}"`); return; }
      if (!/^[a-z]+:(\*|\d+):\d+$/.test(r.in) && !/^[a-z-]+$/.test(r.in)) {
        fouten.push(`regel ${i}: "${r.in}" is geen geldige signature (type:kanaal:nummer)`); return;
      }
      if (rules.has(r.in)) fouten.push(`regel ${i}: "${r.in}" staat al gekoppeld, laatste wint`);
      const action = (doc.version ?? 1) < 2 ? migreerAction(r.action) : r.action;
      if (action !== r.action) gemigreerd++;
      rules.set(r.in, {
        in: r.in, action, mode,
        invert: !!r.invert,
        step: typeof r.step === 'number' ? r.step : undefined,
        takeover: typeof r.takeover === 'number' ? r.takeover : undefined,
        label: r.label,
      });
    });

    this.name = doc.name || 'naamloos';
    this.device = doc.device || 'generic';
    this.rules = rules;
    this.resetTakeover();
    this.emit('change', this);
    return { aantal: rules.size, fouten, gemigreerd };
  }

  toJSON() {
    return {
      name: this.name,
      device: this.device,
      version: MAPPING_VERSIE,
      rules: [...this.rules.values()].map((r) => {
        const o = { in: r.in, action: r.action, mode: r.mode };
        if (r.invert) o.invert = true;
        if (r.step !== undefined) o.step = r.step;
        if (r.takeover !== undefined) o.takeover = r.takeover;
        if (r.label) o.label = r.label;
        return o;
      }),
    };
  }

  export() { return JSON.stringify(this.toJSON(), null, 2); }

  // ---- regels bewerken (MIDI-learn gebruikt dit) --------------------------

  set(sig, action, opts = {}) {
    this.rules.set(sig, { in: sig, action, mode: opts.mode || 'trigger', ...opts });
    this.state.delete(sig);
    this.emit('change', this);
  }

  remove(sig) {
    const weg = this.rules.delete(sig);
    this.state.delete(sig);
    if (weg) this.emit('change', this);
    return weg;
  }

  /** Alle signatures die naar deze action wijzen — voor de UI. */
  forAction(actionId) {
    return [...this.rules.values()].filter((r) => r.action === actionId).map((r) => r.in);
  }

  // ---- soft-takeover -----------------------------------------------------

  /**
   * Zet alle absolute controls weer 'los'. Doe dit na het laden van een andere
   * mapping; bij een deck-switch gaat het vanzelf, zie _stateFor().
   */
  resetTakeover() {
    for (const st of this.state.values()) { st.caught = false; }
    this.emit('takeover', this.takeoverStatus());
  }

  _stateFor(sig, target) {
    let st = this.state.get(sig);
    if (!st) { st = { caught: false, last: null, sent: null, target, tijd: 0 }; this.state.set(sig, st); }
    // Wijst dezelfde knop nu naar een ander deck? Dan staat hij per definitie
    // weer los: dit is precies de sprong die je bij een deck-switch voelt.
    if (st.target !== target) { st.target = target; st.caught = false; st.last = null; st.sent = null; }
    return st;
  }

  takeoverStatus() {
    const los = [];
    for (const [sig, st] of this.state) if (!st.caught) los.push(sig);
    return los;
  }

  // ---- het echte werk ----------------------------------------------------

  /**
   * Verwerkt één bericht. Geeft terug wat er gebeurd is, of null als deze
   * signature niet gekoppeld is — de monitor gebruikt dat om mee te kijken.
   */
  handle(msg) {
    // Exacte regel gaat voor; een wildcard-regel vangt de rest van de kanalen.
    const rule = this.rules.get(msg.sig)
      || (msg.channel >= 0 ? this.rules.get(`${msg.type}:*:${msg.number}`) : undefined);
    if (!rule) return null;

    const target = resolveTarget(rule.action, this.vars());

    switch (rule.mode) {
      case 'absolute':   return this._absolute(rule, msg, target);
      case 'relative-2c':  return this._relative(rule, msg, target, (v) => (v > 64 ? v - 128 : v));
      case 'relative-bin': return this._relative(rule, msg, target, (v) => v - 64);
      default:           return this._trigger(rule, msg, target);
    }
  }

  _trigger(rule, msg, target) {
    // Noten hebben al een on/off; een knop die CC stuurt gebruikt de halve slag.
    const on = msg.type === 'note' ? msg.on : msg.value >= 64;
    this.invoke(target, on);
    return { rule, target, mode: rule.mode, value: on, taken: true };
  }

  _absolute(rule, msg, target) {
    const st = this._stateFor(rule.in, target);
    const nu = this.now();
    // Te lang niet aangeraakt? Dan weten we niet meer waar hij fysiek staat.
    if (st.last !== null && nu - st.tijd > LAST_TTL) st.last = null;
    st.tijd = nu;
    const v = rule.invert ? 1 - msg.norm : msg.norm;
    const sw = this.read ? this.read(target) : null;
    const eps0 = rule.takeover ?? TAKEOVER_EPS;

    // Heeft iets anders deze waarde verzet — de muis, het toetsenbord, een
    // tweede controller — dan staat de fysieke knop er weer naast en moet hij
    // opnieuw overpakken. Zonder dit springt hij alsnog, alleen later.
    if (st.caught && sw != null && st.sent != null && Math.abs(sw - st.sent) > eps0) {
      st.caught = false;
      st.last = null;
    }

    if (sw == null) {
      st.caught = true;                       // niets om overheen te pakken
    } else if (!st.caught) {
      const dichtbij = Math.abs(v - sw) <= eps0;
      // Of de knop is er dichtbij, of hij is er sinds het vorige bericht
      // doorheen bewogen. Pas dan pakt hij de waarde over.
      const doorheen = st.last !== null && Math.sign(v - sw) !== Math.sign(st.last - sw);
      if (dichtbij || doorheen) {
        st.caught = true;
        this.emit('takeover', this.takeoverStatus());
      }
    }

    st.last = v;
    if (!st.caught) return { rule, target, mode: rule.mode, value: v, software: sw, taken: false };

    st.sent = v;
    this.invoke(target, v);
    return { rule, target, mode: rule.mode, value: v, taken: true };
  }

  _relative(rule, msg, target, toDelta) {
    const stappen = toDelta(msg.value);
    if (!stappen) return { rule, target, mode: rule.mode, value: null, taken: false };
    const cur = this.read ? this.read(target) : null;
    const v = clamp((cur ?? 0.5) + stappen * (rule.step ?? RELATIVE_STEP));
    this.invoke(target, v);
    return { rule, target, mode: rule.mode, value: v, delta: stappen, taken: true };
  }
}
