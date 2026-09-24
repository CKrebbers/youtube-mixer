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
 *   endless       knop met LED-ring die absolute waarden stuurt (APC40 mkII:
 *                 device en track knobs). Nieuwe waarde = softwarewaarde +
 *                 (v - vorige v van deze knop). De ring toont al de
 *                 softwarewaarde, dus na een focus- of mapjewissel draai je
 *                 meteen door vanaf wat je ziet, zonder over te pakken.
 *                 Faders hebben geen ring en blijven absolute + takeover.
 *
 * Shift en mapjes (sinds 23 september 2026):
 *   { "in": "note:0:52", "action": "track.1.loop.exit", "shift": true }
 *   { "in": "cc:0:16", "action": "track.{focus}.fx.knob.1", "laag": "device.rack" }
 * Een regel met `shift` geldt alleen zolang de shiftknop (`"shift": "note:0:98"`
 * bovenaan de mapping) ingedrukt is; zonder shift-variant valt shift terug op
 * de gewone regel, zodat een fader gewoon blijft werken. Een regel met `laag`
 * geldt alleen als dat mapje open is (zie lagen.js) en gaat dan voor een regel
 * zonder laag. Meerdere regels per signature dus; de sleutel is
 * `sig[#shift][@laag]`.
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

export const MODES = ['trigger', 'absolute', 'relative-2c', 'relative-bin', 'endless'];

/** Sleutel van een regel: dezelfde knop kan met shift en per mapje iets anders doen. */
export const sleutelVan = (r) => `${r.in}${r.shift ? '#shift' : ''}${r.laag ? `@${r.laag}` : ''}`;

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
export const MAPPING_VERSIE = 3;
const OUDE_DECKS = { A: '1', B: '2' };

/**
 * Versie 3 (23 september 2026): alle action-namen Engels, zoals de rest van
 * de code-identifiers. Wat je op het scherm leest blijft Nederlands.
 */
export const NIEUWE_NAMEN = [
  [/\.fx\.knop\./, '.fx.knob.'],
  [/^(send\.[ab])\.knop\./, '$1.knob.'],
  [/\.druk$/, '.hold'],
  [/\.loop\.wissel$/, '.loop.toggle'],
  [/^(track\.[^.]+)\.maat$/, '$1.leads'],
  [/^(track\.[^.]+)\.tel$/, '$1.beat'],
  [/\.pitch\.bereik$/, '.pitch.range'],
  [/\.xfade\.kant$/, '.xfade.side'],
  [/\.rack\.volgend$/, '.rack.next'],
  [/\.rack\.vorig$/, '.rack.prev'],
  [/^(sampler\.\d)\.wis$/, '$1.clear'],
  [/^sampler\.lengte$/, 'sampler.length'],
  [/^focus\.vorige$/, 'focus.prev'],
  [/^focus\.volgende$/, 'focus.next'],
  [/^venster\.([LR])\.toon\./, 'window.$1.show.'],
  [/^opname\.start$/, 'record.start'],
  [/^opname\.stop$/, 'record.stop'],
  [/^opname\.soort$/, 'record.mode'],
  [/^video\.modus$/, 'video.mode'],
  [/^video\.puls\.doel$/, 'video.pulse.target'],
  [/^video\.puls$/, 'video.pulse'],
  [/^video\.fx\.spiegel$/, 'video.fx.mirror'],
  [/^video\.fx\.kleur$/, 'video.fx.color'],
  [/^video\.fx\.sporen$/, 'video.fx.trails'],
  [/^video\.fx\.korrel$/, 'video.fx.grain'],
];

/**
 * De regels uit een mapping-document, gecontroleerd en zo nodig gemigreerd.
 * Wat niet klopt gaat naar `fouten` en wordt overgeslagen, niet geraden.
 */
function leesRegels(doc) {
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
    const action = migreerAction(r.action, doc.version ?? 1);
    if (action !== r.action) gemigreerd++;
    const regel = {
      in: r.in, action, mode,
      invert: !!r.invert,
      step: typeof r.step === 'number' ? r.step : undefined,
      takeover: typeof r.takeover === 'number' ? r.takeover : undefined,
      label: r.label,
      shift: r.shift ? true : undefined,
      laag: typeof r.laag === 'string' ? r.laag : undefined,
      // Hoe de LED onder deze knop oplicht, bovenop het kleurschema in
      // feedback.js: { aan, half, uit, invert, tel }. Data, dus hij hoort mee
      // bij exporteren — anders ben je hem kwijt na één keer opslaan.
      led: r.led && typeof r.led === 'object' && !Array.isArray(r.led) ? { ...r.led } : undefined,
    };
    const k = sleutelVan(regel);
    if (rules.has(k)) fouten.push(`regel ${i}: "${k}" staat al gekoppeld, laatste wint`);
    rules.set(k, regel);
  });
  return { rules, fouten, gemigreerd };
}

/** Een action uit een mapping van `versie` naar de huidige naam. */
export function migreerAction(action, versie = 1) {
  let a = action;
  if (versie < 2) a = a.replace(/^deck\.([AB]|\{focus\})\./, (m, d) => `track.${OUDE_DECKS[d] ?? d}.`);
  if (versie < 3) for (const [van, naar] of NIEUWE_NAMEN) a = a.replace(van, naar);
  return a;
}

export class Mapping extends Emitter {
  /**
   * @param read   (actionId) -> huidige stand 0..1 of null. Nodig voor
   *               soft-takeover en voor relatieve encoders.
   * @param invoke (actionId, value) -> void. De action-bus.
   * @param vars   () -> { focus: 1 } (tracknummer). Wordt per bericht opnieuw gevraagd.
   */
  /**
   * @param lagen  () -> ['device.strip', 'grid.hotcues', …]: de open mapjes.
   */
  constructor({ read, invoke, vars = () => ({}), lagen = () => [], now = () => (globalThis.performance?.now() ?? Date.now()) } = {}) {
    super();
    this.read = read;
    this.invoke = invoke;
    this.vars = vars;
    this.lagen = lagen;
    this.now = now;
    this.name = 'leeg';
    this.device = 'generic';
    this.rules = new Map();     // sleutel (sig[#shift][@laag]) -> regel
    this.state = new Map();     // sig -> { caught, last, target }
    this.shiftSig = null;       // welke knop shift is, uit de mapping
    this.shift = false;
    this.vast = new Map();      // sig -> { rule, target } van een ingedrukte knop
    this.extra = new Map();     // bron -> regels die erbij komen maar niet van jou zijn (voegToe)
  }

  // ---- laden en opslaan --------------------------------------------------

  load(data) {
    const doc = typeof data === 'string' ? JSON.parse(data) : data;
    const { rules, fouten, gemigreerd } = leesRegels(doc);
    this._pasExtraToe(rules);
    this.shiftSig = typeof doc.shift === 'string' ? doc.shift : null;
    this.shift = false;
    this.vast.clear();

    this.name = doc.name || 'naamloos';
    this.device = doc.device || 'generic';
    this.rules = rules;
    this.resetTakeover();
    this.emit('change', this);
    return { aantal: rules.size, fouten, gemigreerd };
  }

  /**
   * Regels die er BIJ komen zonder van jou te worden: een fragment van een
   * onderdeel dat aan staat (de vormlagen: `mappings/apc40mk2-vormen.json`).
   * Ze gaan niet mee in toJSON, dus niet in je eigen bewaarde mapping, en ze
   * blijven staan als er een andere mapping geladen wordt. Heb jij zelf al
   * een regel op dezelfde plek (knop, shift, mapje), dan wint die: een
   * fragment vult alleen aan. Koppel je er iets overheen, dan wordt het de
   * jouwe en gaat hij wel mee.
   */
  voegToe(bron, data) {
    const doc = typeof data === 'string' ? JSON.parse(data) : data;
    const { rules, fouten } = leesRegels(doc);
    const lijst = [...rules.values()].map((r) => ({ ...r, bron }));
    this.extra.set(bron, lijst);
    const voor = this.rules.size;
    this._pasExtraToe(this.rules);
    this.emit('change', this);
    return { aantal: this.rules.size - voor, fouten };
  }

  _pasExtraToe(rules) {
    for (const lijst of this.extra.values()) {
      for (const r of lijst) { const k = sleutelVan(r); if (!rules.has(k)) rules.set(k, r); }
    }
  }

  toJSON() {
    return {
      name: this.name,
      device: this.device,
      version: MAPPING_VERSIE,
      ...(this.shiftSig ? { shift: this.shiftSig } : {}),
      rules: [...this.rules.values()].filter((r) => !r.bron).map((r) => {
        const o = { in: r.in, action: r.action, mode: r.mode };
        if (r.shift) o.shift = true;
        if (r.laag) o.laag = r.laag;
        if (r.invert) o.invert = true;
        if (r.step !== undefined) o.step = r.step;
        if (r.takeover !== undefined) o.takeover = r.takeover;
        if (r.label) o.label = r.label;
        if (r.led) o.led = { ...r.led };
        return o;
      }),
    };
  }

  export() { return JSON.stringify(this.toJSON(), null, 2); }

  // ---- regels bewerken (MIDI-learn gebruikt dit) --------------------------

  /**
   * Een knop koppelen. Zonder expliciete `shift`/`laag` in opts: de stand van
   * NU. Houd je shift vast, dan wordt het een shift-regel; hoort deze knop bij
   * een mapje, dan komt hij in het mapje dat open staat. Zo koppel je in een
   * mapje zonder dat je daar iets voor hoeft in te stellen.
   */
  set(sig, action, opts = {}) {
    const shift = opts.shift ?? (this.shift || undefined);
    let laag = opts.laag;
    if (laag === undefined) {
      const groepen = new Set([...this.rules.values()].filter((r) => r.in === sig && r.laag).map((r) => r.laag.split('.')[0]));
      laag = this.lagen().find((l) => groepen.has(l.split('.')[0]));
    }
    const regel = { in: sig, action, mode: opts.mode || 'trigger', ...opts, shift: shift || undefined, laag: laag || undefined };
    this.rules.set(sleutelVan(regel), regel);
    this.state.delete(sig);
    this.emit('change', this);
    return regel;
  }

  /** Een regel weghalen, op sleutel. Een kale signature is de regel zonder shift en laag. */
  remove(sleutel) {
    const was = this.rules.get(sleutel);
    const weg = this.rules.delete(sleutel);
    this.state.delete(sleutel.split(/[#@]/)[0]);
    // Een fragmentregel is niet van jou: hij komt meteen terug (anders pas na
    // herladen, en dan doet weghalen iets anders dan wat je zag). En haal je een
    // eigen regel weg die er een afdekte, dan staat die er meteen weer.
    this._pasExtraToe(this.rules);
    if (was?.bron) return false;
    if (weg) this.emit('change', this);
    return weg;
  }

  /** Alle sleutels die naar deze action wijzen — voor de UI. */
  forAction(actionId) {
    return [...this.rules.entries()].filter(([, r]) => r.action === actionId).map(([k]) => k);
  }

  /**
   * Welke regel geldt NU voor deze signature? Met shift eerst de shift-regels,
   * daarna de gewone; binnen die twee eerst het open mapje, dan zonder mapje;
   * exacte signature voor wildcard (`cc:*:16`).
   */
  kies(sig, { shift = this.shift } = {}) {
    const [type, ch, nr] = sig.split(':');
    const sigs = ch === '*' ? [sig] : [sig, `${type}:*:${nr}`];
    const open = this.lagen();
    for (const s of sigs) {
      for (const sh of shift ? ['#shift', ''] : ['']) {
        for (const l of open) { const r = this.rules.get(`${s}${sh}@${l}`); if (r) return r; }
        const r = this.rules.get(`${s}${sh}`);
        if (r) return r;
      }
    }
    return null;
  }

  /**
   * Per fysieke control de regel die nu geldt — voor de LED's. Standaard met
   * de shiftstand van NU: houd je shift vast, dan tonen de lampjes wat de
   * knoppen met shift doen (hotcue wissen in rood). Een knop zonder
   * shift-variant houdt zijn gewone regel; een knop die ALLEEN met shift iets
   * doet (● = cue) valt zonder shift weg en blijft donker.
   */
  actieveRegels({ shift = this.shift } = {}) {
    const uit = new Map();
    for (const r of this.rules.values()) {
      if (uit.has(r.in)) continue;
      const k = this.kies(r.in, { shift });
      if (k) uit.set(r.in, k);
    }
    return uit;
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

  /**
   * De controller is weg (uitgetrokken, poort 'disconnected'). Wat je op dat
   * moment vasthield krijgt nooit meer een loslaten: shift bleef aan, zodat
   * elke knop daarna de shift-variant deed, en een bend liet de track trager
   * lopen. Dus: shift uit, elke ingedrukte drukknop loslaten, en soft-takeover
   * opnieuw — de knoppen kunnen intussen verdraaid zijn.
   */
  losgekoppeld() {
    if (this.shift) { this.shift = false; this.emit('shift', false); }
    const vast = [...this.vast.values()];
    this.vast.clear();
    for (const { rule, target } of vast) {
      if (rule.mode === 'trigger' || !rule.mode) this.invoke(target, false);
    }
    for (const st of this.state.values()) st.last = null;
    this.resetTakeover();
  }

  // ---- het echte werk ----------------------------------------------------

  /**
   * Verwerkt één bericht. Geeft terug wat er gebeurd is, of null als deze
   * signature niet gekoppeld is — de monitor gebruikt dat om mee te kijken.
   */
  handle(msg) {
    // De shiftknop zelf: alleen onthouden, niets op de bus.
    if (this.shiftSig && msg.sig === this.shiftSig) {
      const aan = msg.type === 'note' ? msg.on : msg.value >= 64;
      if (aan !== this.shift) { this.shift = aan; this.emit('shift', aan); }
      return { rule: { in: msg.sig, action: 'shift', mode: 'trigger', label: 'shift' }, target: 'shift', mode: 'trigger', value: aan, taken: true };
    }

    // Loslaten gaat naar dezelfde action als het indrukken, ook als shift of
    // het mapje intussen veranderde. Anders blijft een drukknop hangen.
    const los = msg.type === 'note' && !msg.on;
    const vast = los ? this.vast.get(msg.sig) : null;
    if (vast) {
      this.vast.delete(msg.sig);
      if (vast.rule.mode === 'trigger' || !vast.rule.mode) return this._trigger(vast.rule, msg, vast.target);
    }

    const rule = this.kies(msg.sig);
    if (!rule) return null;

    const target = resolveTarget(rule.action, this.vars());
    if (msg.type === 'note' && msg.on) this.vast.set(msg.sig, { rule, target });

    switch (rule.mode) {
      case 'absolute':   return this._absolute(rule, msg, target);
      case 'relative-2c':  return this._relative(rule, msg, target, (v) => (v >= 64 ? v - 128 : v));   // 64 = -64 (protocol v1.2 p37)
      case 'relative-bin': return this._relative(rule, msg, target, (v) => v - 64);
      case 'endless':    return this._endless(rule, msg, target);
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

  /**
   * Endless: verschil met het vorige bericht van DEZE knop, opgeteld bij de
   * softwarewaarde. Geen overpakken, geen sprong.
   *
   * Zonder vorige stand (eerste bericht, andere track of mapje, controller
   * opnieuw aangesloten) alleen onthouden: één tikje kwijt, nooit een sprong.
   * Heeft iets anders de waarde intussen verzet (muis, tweede controller),
   * dan ook opnieuw beginnen. Dat is nodig als de APC zijn interne knopstand
   * gelijkzet met de ring die wij sturen — dat weten we niet zeker — want
   * dan komt het volgende bericht vanaf de NIEUWE stand en zou het verschil
   * met de oude een sprong zijn. Met die regel klopt het in beide gevallen.
   * Geen LAST_TTL hier: in 0x42 zijn er geen banken, dus elke draai van deze
   * knop komt bij ons binnen en de vorige stand veroudert niet.
   */
  _endless(rule, msg, target) {
    const st = this._stateFor(rule.in, target);
    st.caught = true;                        // er valt niets over te pakken
    const v = rule.invert ? 1 - msg.norm : msg.norm;
    const sw = this.read ? this.read(target) : null;
    const eps0 = rule.takeover ?? TAKEOVER_EPS;
    if (sw != null && st.sent != null && Math.abs(sw - st.sent) > eps0) st.last = null;

    const vorige = st.last;
    st.last = v;
    if (vorige === null || sw == null) {
      st.sent = sw;
      return { rule, target, mode: rule.mode, value: v, software: sw, taken: false };
    }
    let delta = v - vorige;
    // Op de aanslag nog eens hetzelfde bericht: dat is doordraaien, geen
    // stilstand. Anders kom je vanaf een ring op 0,2 met de knop op 127
    // nooit meer omhoog.
    if (!delta && (msg.value === 127 || msg.value === 0)) delta = (msg.value === 127 ? 1 : -1) * (rule.invert ? -1 : 1) / 127;
    if (!delta) return { rule, target, mode: rule.mode, value: sw, taken: false };
    const nieuw = clamp(sw + delta);
    st.sent = nieuw;
    this.invoke(target, nieuw);
    return { rule, target, mode: rule.mode, value: nieuw, delta, taken: true };
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
