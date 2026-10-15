import { Emitter, clamp } from '../lib/emitter.js';
import { houd as gedeeldHoud } from './houd.js';

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
 *
 * Combinaties (14 okt, werkruimte S4, docs/werkruimte/S4.md; ontwerp B5):
 *   druk          { "mode": "druk", "naar": 1 }: elke value-action als
 *                 drukknop. Indrukken zet `naar`, loslaten zet terug wat er
 *                 stond. Allebei over de bus, dus allebei in het log.
 *   latch         { "mode": "latch", "naar": 0.85 }: druk = `naar`, nog eens
 *                 = de stand van ervoor.
 *   lang          bij druk/latch: { "lang": 400 } (of true = 400 ms): kort
 *                 drukken zet hem vast (latch), lang = zolang je drukt.
 *   stappen       een relatieve encoder roept per klik `<action>.fwd` of
 *                 `<action>.back` aan (triggers: indrukken en loslaten), hooguit
 *                 MAX_STAPPEN per bericht. `"codering": "bin"` voor binary
 *                 offset, anders tweecomplement.
 *   laag houd.*   { "laag": "houd.solo" }: geldt zolang een houd-knop vastzit
 *                 (`layer.houd.solo`, op welk apparaat ook; houd.js). De open
 *                 houd-mapjes staan VÓÓR de andere mapjes.
 *   als           { "als": "focus.instrument" }: de regel geldt alleen als de
 *                 conditie waar is (witte lijst ALS; de conditie komt van buiten:
 *                 mapping.als = (naam) => boolean, S3 zet hem). Zonder die
 *                 functie geldt een regel met `als` nooit. Een regel met `als`
 *                 gaat voor dezelfde regel zonder.
 *   {tweede}      = {R} (de vorige focus); {L}/{R} blijven. {maatgever} en
 *                 andere variabelen van buiten: zetVariabele(naam, fn).
 * Geen houd-regel en geen druk/latch op de kern (KERN: play, cue, play.quant,
 * hotcue.*, load.*, layer.*): die worden geweigerd met een reden.
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

export const MODES = ['trigger', 'absolute', 'relative-2c', 'relative-bin', 'endless', 'druk', 'latch', 'stappen'];

/** Knopmodi met `naar` (druk, latch): loslaten hoort bij het indrukken, ook op een CC-knop. */
const KNOPMODI = new Set(['druk', 'latch']);
/** Hoe lang is "lang" als een regel `lang: true` zegt (ms): dezelfde 400 ms als gluren (lagen.js). */
export const LANG_MS = 400;
/** Hooguit zoveel stappen per bericht (een encoder die doorschiet). */
export const MAX_STAPPEN = 8;

/**
 * De kern: hierop nooit een houd-regel en nooit druk/latch (ontwerp B3, C5).
 * Een drukknop op play of cue zou bij het loslaten terugzetten wat je net
 * startte; een houd-knop die een paar ms te laat komt, mag niet beslissen of
 * een track start.
 */
export const KERN = /^(track\.(\{\w+\}|\d+)\.(play|cue|play\.quant|hotcue\..+|load(\..+)?)|layer\..+)$/;

/** De condities die een regel mag hebben (`als`, ontwerp B3). Geen expressies. */
export const ALS = /^(focus\.(instrument|nummer|stems|leeg)|speel\.instrument|hub|apparaat\.[a-z0-9-]{1,32})$/;

/**
 * Sleutel van een regel: dezelfde knop kan met shift en per mapje iets anders
 * doen, en met een conditie (`?als`). Zonder `als` precies de sleutel van vroeger.
 */
export const sleutelVan = (r) => `${r.in}${r.shift ? '#shift' : ''}${r.laag ? `@${r.laag}` : ''}${r.als ? `?${r.als}` : ''}`;

/**
 * Mag deze regel zo? Geeft een reden (tekst) of null. `geweigerd: true` als het
 * de kern raakt (dat meldt de Mapping met 'geweigerd'); de rest is een gewone fout.
 */
export function controleerRegel(r) {
  const mode = r.mode || 'trigger';
  if (KNOPMODI.has(mode)) {
    if (typeof r.naar !== 'number' || !(r.naar >= 0 && r.naar <= 1)) return { reden: `${mode} heeft "naar" nodig (een getal 0..1)` };
  } else if (r.naar !== undefined) return { reden: `"naar" hoort alleen bij druk of latch` };
  if (r.lang !== undefined) {
    if (!KNOPMODI.has(mode)) return { reden: `"lang" hoort alleen bij druk of latch` };
    if (r.lang !== true && !(typeof r.lang === 'number' && r.lang > 0 && r.lang <= 10000)) return { reden: `"lang" is een tijd in ms (of true = ${LANG_MS})` };
  }
  if (r.codering !== undefined && (mode !== 'stappen' || !['2c', 'bin'].includes(r.codering))) return { reden: `"codering" is "2c" of "bin", alleen bij stappen` };
  if (r.als !== undefined && (typeof r.als !== 'string' || !ALS.test(r.als))) return { reden: `onbekende conditie "${r.als}" (als)` };
  const houdRegel = typeof r.laag === 'string' && r.laag.startsWith('houd.');
  if ((houdRegel || KNOPMODI.has(mode)) && KERN.test(r.action)) {
    return { reden: `is de kern (play, cue, play.quant, hotcue, load, layer): geen ${houdRegel ? 'houd-regel' : mode}`, geweigerd: true };
  }
  return null;
}

/**
 * Variabelen van buiten ({maatgever}, ontwerp B5): naam -> () => waarde of null.
 * De combi-aanhaker zet `maatgever` (engine.syncMaster()). Een variabele die
 * de aanroeper zelf meegeeft (vars) gaat altijd voor.
 */
/**
 * Drukknoppen (mode druk) die een doel nu vasthouden, GEDEELD door alle Mappings (APC en
 * Maschine op hetzelfde doel): de eerste stand telt, terug pas bij de laatste loslating.
 */
const DRUK_DOEL = new Map();

const VARIABELEN = new Map();
let variabelenVersie = 0;
export function zetVariabele(naam, fn) {
  if (typeof fn === 'function') VARIABELEN.set(naam, fn); else VARIABELEN.delete(naam);
  variabelenVersie++;
}

/** Een action met {variabelen}, eenmalig in stukken: [tekst, naam, tekst, naam, …, tekst]. */
const SJABLONEN = new Map();

/**
 * Vult {focus} en andere variabelen in. Puur tekst, geen kennis van decks.
 * Het sjabloon wordt één keer geknipt (de LED-laag vraagt dit voor elke regel,
 * dertig keer per seconde; een regex met een terugroepfunctie per keer was
 * daar het duurste deel van).
 */
export function resolveTarget(action, vars) {
  if (!action.includes('{')) return action;
  let d = SJABLONEN.get(action);
  if (!d) {
    d = action.split(/\{(\w+)\}/);
    if (SJABLONEN.size > 4096) SJABLONEN.clear();
    SJABLONEN.set(action, d);
  }
  let uit = d[0];
  for (let i = 1; i < d.length; i += 2) {
    const k = d[i];
    uit += (vars && k in vars ? vars[k] : extraVariabele(k, vars) ?? `{${k}}`) + d[i + 1];
  }
  return uit;
}

/** {tweede} = {R}; daarna de variabelen van buiten (zetVariabele). null = blijft staan. */
function extraVariabele(k, vars) {
  if (k === 'tweede') return vars && 'R' in vars ? vars.R : null;
  const f = VARIABELEN.get(k);
  if (!f) return null;
  try { const v = f(); return v ?? null; } catch (_) { return null; }
}

/** Twee lijsten met dezelfde tekst op dezelfde plek? */
const zelfdeLijst = (a, b) => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

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
 *
 * Alleen `rules` en `version` tellen. Een veld `mapjes` (een stuk of een
 * werkruimte, docs/WERKRUIMTE.md B4) wordt hier bewust NIET gelezen: die mapjes
 * registreert de aanroeper zelf (lagen.voegMapjeToe), vóór hij de regels zet.
 *
 * `weiger(action)`: geeft een reden als deze action niet op een knop mag
 * (meta.alleenScherm, zie Mapping.metaOf), anders null. Zonder: alles mag.
 */
function leesRegels(doc, weiger = null) {
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
    const nee = weiger?.(action);
    if (nee) { fouten.push(`regel ${i}: "${action}" ${nee}`); return; }
    const c = controleerRegel({ ...r, action, mode });
    if (c) { fouten.push(`regel ${i}: "${action}" ${c.reden}${c.geweigerd ? ': geweigerd' : ''}`); return; }
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
      // Combinaties (S4): alleen als ze er staan, zodat een regel zonder precies de oude vorm houdt.
      ...(r.naar !== undefined ? { naar: r.naar } : {}),
      ...(r.lang !== undefined ? { lang: r.lang } : {}),
      ...(r.codering !== undefined ? { codering: r.codering } : {}),
      ...(r.als !== undefined ? { als: r.als } : {}),
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

/** Een regel zoals hij in een document staat: alleen wat ertoe doet, in vaste volgorde. */
function regelNaarJSON(r) {
  const o = { in: r.in, action: r.action, mode: r.mode };
  if (r.shift) o.shift = true;
  if (r.laag) o.laag = r.laag;
  if (r.invert) o.invert = true;
  if (r.step !== undefined) o.step = r.step;
  if (r.takeover !== undefined) o.takeover = r.takeover;
  if (r.label) o.label = r.label;
  if (r.led) o.led = { ...r.led };
  if (r.naar !== undefined) o.naar = r.naar;
  if (r.lang !== undefined) o.lang = r.lang;
  if (r.codering !== undefined) o.codering = r.codering;
  if (r.als !== undefined) o.als = r.als;
  return o;
}

/**
 * Een volledig mapping-document gecontroleerd en in de vorm van toJSON():
 * acties gemigreerd, regels genormaliseerd, dubbele sleutels samengevoegd.
 * Twee documenten zijn daarna regel voor regel te vergelijken.
 */
export function normaliseer(data) {
  const doc = typeof data === 'string' ? JSON.parse(data) : data;
  const { rules, fouten, gemigreerd } = leesRegels(doc);
  return {
    doc: {
      name: doc.name || 'naamloos',
      device: doc.device || 'generic',
      version: MAPPING_VERSIE,
      ...(typeof doc.shift === 'string' ? { shift: doc.shift } : {}),
      rules: [...rules.values()].map(regelNaarJSON),
    },
    fouten, gemigreerd,
  };
}

/*
 * EIGEN MAPPING ALS VERSCHIL (ROADMAP 13, 25 sep 2026)
 *
 * Tot nu toe bewaarde de app je eigen mapping als VOLLEDIGE kopie. Een nieuwe
 * standaardmapping kwam dan nooit bij je aan (23 sep: de grid-modus ontbrak op
 * de APC). Nu bewaren we alleen wat JIJ anders hebt dan de standaard:
 *
 *   { kind: 'diff', version, device, base,     base = vingerafdruk van de standaard
 *     top: { shift?, name? },                  alleen topvelden die anders zijn
 *     rules: [ … ],                            regels die je toevoegde of veranderde (volledig)
 *     removed: [ 'cc:0:20@device.rack', … ] }  sleutels van standaardregels die je weghaalde
 *
 * Laden = standaard + verschil. Een nieuwe regel in de standaard komt dus
 * vanzelf binnen; een regel die jij veranderde of weghaalde blijft van jou,
 * ook als de standaard hem later verandert. Het verschil wordt telkens
 * opnieuw UITGEREKEND (standaard tegen wat er nu staat), niet bijgehouden per
 * bewerking: koppel je een knop terug naar wat de standaard doet, dan
 * verdwijnt hij vanzelf uit je verschil.
 *
 * Fragmenten (Mapping.voegToe, de vormlagen) horen er nooit bij: ze gaan al
 * niet mee in toJSON(), dus ook niet in het verschil.
 *
 * `rules` is altijd een lijst, ook als hij leeg is: de server (/api/mapping)
 * weigert een document zonder `rules`. Zo werkt dit zonder de server te
 * herstarten. `version` telt hier, net als in een volledig document, de
 * generatie van de action-namen: migreerAction werkt dus ook op een verschil.
 */

export const isVerschil = (doc) => !!doc && typeof doc === 'object' && doc.kind === 'diff';

const sleutelTekst = (r) => JSON.stringify(regelNaarJSON(r));

/** FNV-1a (32 bit): klein, synchroon, overal hetzelfde. Geen beveiliging, alleen herkennen. */
function fnv1a(tekst) {
  let h = 0x811c9dc5;
  for (let i = 0; i < tekst.length; i++) { h ^= tekst.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Vingerafdruk van een standaard: apparaat, shiftknop en de regels, op
 * sleutel gesorteerd (de volgorde van de regels betekent niets). De naam telt
 * niet mee: een andere naam is geen andere standaard. Vorm: "3fa2c01b-291",
 * met het aantal regels erachter zodat een mens hem ook kan lezen.
 */
export function vingerafdruk(data) {
  const { doc } = normaliseer(data);
  const regels = doc.rules.map((r) => [sleutelVan(r), r]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canon = JSON.stringify({ device: doc.device, shift: doc.shift ?? null, rules: regels.map(([, r]) => r) });
  return `${fnv1a(canon)}-${doc.rules.length}`;
}

/**
 * Wat heeft `data` anders dan de standaard `basis`? Beide volledige documenten;
 * `base` is de vingerafdruk van `basis` als je die al hebt. Een ander apparaat
 * dan de standaard is een fout van de aanroeper: dan is er geen zinnig
 * verschil (alles zou "weg" en "nieuw" zijn).
 */
export function maakVerschil(basis, data, base = null) {
  const b = normaliseer(basis).doc;
  const d = normaliseer(data).doc;
  if (b.device !== d.device) throw new Error(`mapping: verschil tussen twee apparaten ("${b.device}" en "${d.device}") kan niet`);
  const inBasis = new Map(b.rules.map((r) => [sleutelVan(r), sleutelTekst(r)]));
  const inDoc = new Map(d.rules.map((r) => [sleutelVan(r), r]));
  const top = {};
  if ((d.shift ?? null) !== (b.shift ?? null)) top.shift = d.shift ?? null;
  if (d.name !== b.name) top.name = d.name;
  // Vaste volgorde, zodat hetzelfde verschil altijd dezelfde tekst is (anders
  // bewaart de app na elk laden opnieuw): veranderde regels in de volgorde van
  // de standaard, daarna wat je toevoegde in jouw volgorde.
  const veranderd = [...inBasis].filter(([k, t]) => inDoc.has(k) && sleutelTekst(inDoc.get(k)) !== t).map(([k]) => inDoc.get(k));
  const nieuw = d.rules.filter((r) => !inBasis.has(sleutelVan(r)));
  return {
    kind: 'diff',
    version: MAPPING_VERSIE,
    device: b.device,
    base: base ?? vingerafdruk(b),
    top,
    rules: [...veranderd, ...nieuw],
    removed: [...inBasis.keys()].filter((k) => !inDoc.has(k)),
  };
}

/**
 * Standaard + verschil = het volledige document. Volgorde: die van de
 * standaard (een veranderde regel op zijn eigen plek), wat je toevoegde
 * achteraan. `standaardNieuw`: de standaard is veranderd sinds dit verschil
 * gemaakt is — wat erbij kwam staat erin, jouw regels winnen.
 */
export function pasVerschilToe(basis, verschil) {
  if (!isVerschil(verschil)) throw new Error('mapping: dit is geen verschil (kind: "diff" ontbreekt)');
  const b = normaliseer(basis).doc;
  if (verschil.device !== b.device) {
    throw new Error(`mapping: dit verschil hoort bij "${verschil.device}", de standaard is "${b.device}"`);
  }
  const { rules: eigen, fouten, gemigreerd } = leesRegels({
    version: verschil.version ?? MAPPING_VERSIE,
    rules: Array.isArray(verschil.rules) ? verschil.rules : [],
  });
  if (!Array.isArray(verschil.rules)) fouten.push('verschil: "rules" is geen lijst');
  const weg = new Set();
  (Array.isArray(verschil.removed) ? verschil.removed : []).forEach((k, i) => {
    if (typeof k === 'string') weg.add(k); else fouten.push(`verschil: removed ${i} is geen sleutel`);
  });
  const top = verschil.top && typeof verschil.top === 'object' ? verschil.top : {};

  const rules = [];
  const gebruikt = new Set();
  let weggehaald = 0;
  for (const r of b.rules) {
    const k = sleutelVan(r);
    if (eigen.has(k)) { rules.push(regelNaarJSON(eigen.get(k))); gebruikt.add(k); } // jouw regel wint
    else if (weg.has(k)) weggehaald++;
    else rules.push(r);
  }
  for (const [k, r] of eigen) if (!gebruikt.has(k)) rules.push(regelNaarJSON(r));

  let shift = b.shift;
  if ('shift' in top) {
    if (top.shift === null || typeof top.shift === 'string') shift = top.shift;
    else fouten.push('verschil: top.shift is geen knop (en geen null), de standaard blijft');
  }
  return {
    doc: {
      name: typeof top.name === 'string' ? top.name : b.name,
      device: b.device,
      version: MAPPING_VERSIE,
      ...(typeof shift === 'string' ? { shift } : {}),
      rules,
    },
    fouten, gemigreerd,
    eigen: eigen.size,
    weg: weggehaald,
    standaardNieuw: typeof verschil.base === 'string' && verschil.base !== vingerafdruk(b),
  };
}

/*
 * EERDERE STANDAARDEN (25 sep 2026, APC-indeling "Voorstel A")
 *
 * Een oude VOLLEDIGE kopie (van vóór het verschil) zegt niet op welke
 * standaard hij rustte. Zet je hem om tegen een NIEUWERE standaard, dan lijkt
 * alles wat die standaard erbij kreeg door jou weggehaald: het verschil krijgt
 * die sleutels als `removed`, en de nieuwe functies komen nooit binnen. Precies
 * wat het verschil moest voorkomen (docs/MAPPING-VERSCHIL.md).
 *
 * Daarom draagt het standaardbestand zijn voorgangers mee, elk als verschil
 * met de huidige regels: `eerder: [{ vingerafdruk, rules, removed, top? }]`.
 * Huidige standaard + zo'n verschil = die voorganger, en de vingerafdruk
 * controleert dat (klopt hij niet, dan telt de voorganger niet mee: liever
 * niets dan een verkeerde basis). Een oude kopie wordt afgezet tegen de
 * standaard waar hij het DICHTST bij ligt (minste regels in het verschil);
 * bij gelijkspel de huidige. Het verschil draagt dan de vingerafdruk van die
 * voorganger, dus het laden zegt "standaard bijgewerkt" en wat erbij kwam
 * staat erop. Bijwerken na een wijziging aan de standaard:
 * `node tools/mapping/eerder.mjs` (test/mapping.test.mjs eist dat het klopt).
 */

/** Een voorganger van `nieuw` als verschil met `nieuw`: wat er in het standaardbestand onder `eerder` staat. */
export function maakEerder(nieuw, oud) {
  const v = maakVerschil(nieuw, oud);
  return { vingerafdruk: vingerafdruk(oud), ...(Object.keys(v.top).length ? { top: v.top } : {}), rules: v.rules, removed: v.removed };
}

/**
 * De voorgangers uit `standaard.eerder` als volledige documenten, alleen die
 * waarvan de vingerafdruk klopt. `[{ vingerafdruk, doc }]`.
 */
export function eerdereStandaarden(standaard) {
  const lijst = Array.isArray(standaard?.eerder) ? standaard.eerder : [];
  const uit = [];
  for (const e of lijst) {
    if (!e || typeof e.vingerafdruk !== 'string') continue;
    try {
      const { doc, fouten } = pasVerschilToe(standaard, {
        kind: 'diff', version: MAPPING_VERSIE, device: normaliseer(standaard).doc.device,
        top: e.top || {}, rules: Array.isArray(e.rules) ? e.rules : [], removed: Array.isArray(e.removed) ? e.removed : [],
      });
      if (!fouten.length && vingerafdruk(doc) === e.vingerafdruk) uit.push({ vingerafdruk: e.vingerafdruk, doc });
    } catch (_) { /* een kapotte voorganger telt niet mee */ }
  }
  return uit;
}

/**
 * Een oude volledige kopie als verschil, afgezet tegen de standaard waar hij
 * het dichtst bij ligt: de huidige of een voorganger (`eerder`). Geeft het
 * verschil plus `basis`: 'huidig' of de vingerafdruk van de voorganger.
 */
export function verschilVanKopie(standaard, kopie) {
  const maat = (v) => v.rules.length + v.removed.length + Object.keys(v.top).length;
  let beste = { v: maakVerschil(standaard, kopie), basis: 'huidig' };
  for (const e of eerdereStandaarden(standaard)) {
    const v = maakVerschil(e.doc, kopie, e.vingerafdruk);
    if (maat(v) < maat(beste.v)) beste = { v, basis: e.vingerafdruk };
  }
  return { verschil: beste.v, basis: beste.basis };
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
  /**
   * @param metaOf (actionId) -> meta of null (metaOf uit actions.js). Zegt die
   *               `alleenScherm: true`, dan komt een regel met die action er bij
   *               het laden niet in ('geweigerd'). Weg (de server, de kaarten): alles mag.
   *               Ook later te zetten (mapping.metaOf = …, dan weigerAlleenScherm()).
   */
  /**
   * @param houd     het register van de houd-mapjes (houd.js); standaard het
   *                 gedeelde van de app, zodat elke Mapping dezelfde ziet.
   * @param apparaat wie deze Mapping is voor het houd-register (standaard het
   *                 `device` uit de geladen mapping).
   */
  constructor({ read, invoke, vars = () => ({}), lagen = () => [], now = () => (globalThis.performance?.now() ?? Date.now()), metaOf = null,
    houd = gedeeldHoud, apparaat = null } = {}) {
    super();
    this.metaOf = metaOf;
    this.read = read;
    this.invoke = invoke;
    this.houd = houd;
    this.apparaat = apparaat;
    this.als = null;            // (naam) => boolean: de conditie van een regel met `als` (S3 zet hem)
    this._lagenOpen = { versie: -1, bron: null, lijst: null };
    this.vars = vars;
    this.lagen = lagen;
    this.now = now;
    this.name = 'leeg';
    this.device = 'generic';
    this._versie = 0;           // telt elke wijziging aan de regels (de caches van kies)
    this._cache = { versie: -1, lagen: null, kies: [new Map(), new Map()], actief: [null, null] };
    this.rules = new Map();     // sleutel (sig[#shift][@laag]) -> regel
    this.state = new Map();     // sig -> { caught, last, target }
    this.shiftSig = null;       // welke knop shift is, uit de mapping
    this.shift = false;
    this.vast = new Map();      // sig -> { rule, target } van een ingedrukte knop
    this.extra = new Map();     // bron -> regels die erbij komen maar niet van jou zijn (voegToe)
    this.basis = null;          // de standaard waar je eigen verschil op rust: { doc, vingerafdruk }
    this._latch = new Map();    // regelsleutel|doel -> de stand van vóór (latch en lang)
    this._drukDoel = DRUK_DOEL; // doel -> { oud, n }: drukknoppen (druk) die dit doel nu vasthouden, over alle Mappings
    this._nietWaarde = new Set(); // doelen waarvan al gemeld is dat druk/latch er niets doet
    this._als = { versie: -1, per: new Map(), namen: [] };
  }

  /*
   * De open mapjes, MET de houd-mapjes ervoor (S4). `lagen` blijft een functie
   * die je zet zoals altijd (constructor, apc-kaart.js); lezen geeft deze
   * functie terug. Zonder open houd-mapje is het precies de lijst van de bron
   * (dezelfde bevroren lijst van Lagen.actief(), dus de caches blijven heel);
   * met, één lijst per stand van het register en van de bron.
   */
  get lagen() { return this._lagenMet; }
  set lagen(fn) {
    // Een lezer die je hier eerder las, terugzetten (apc-kaart.js: oud = mapping.lagen; …; mapping.lagen = oud)
    // = zijn eigen bron terug. Elke bron krijgt zijn eigen lezer.
    const bron = typeof fn === 'function' && fn.bron ? fn.bron : fn;
    this._lagenBron = bron;
    this._lagenMet = Object.assign(() => this._openMetHoud(), { bron });
  }

  _openMetHoud() {
    const bron = this._lagenBron();
    const h = this.houd;
    if (!h || h.leeg) return bron;
    const c = this._lagenOpen;
    if (c.versie === h.versie && c.bron === bron) return c.lijst;
    const lijst = Object.freeze([...h.lijst(), ...(bron || []).filter((l) => !l.startsWith('houd.'))]);
    this._lagenOpen = { versie: h.versie, bron, lijst };
    return lijst;
  }

  /*
   * De variabelen ({focus}, {speel}, …) plus die van buiten (zetVariabele,
   * {maatgever}). Zonder variabelen van buiten: precies wat de bron geeft. Met:
   * ze staan in het object, dus ook in de sleutel van het LED-plan (feedback.js
   * maakt het plan opnieuw als de maatgever wisselt).
   */
  get vars() { return this._varsMet; }
  set vars(fn) {
    const bron = typeof fn === 'function' && fn.bron ? fn.bron : fn;
    this._varsBron = bron;
    this._varsMet = Object.assign(() => this._varsMetExtra(), { bron });
  }

  _varsMetExtra() {
    const v = this._varsBron();
    if (!VARIABELEN.size) return v;
    // Alleen de variabelen die een regel van deze mapping gebruikt: zonder zo'n
    // regel precies het object van de bron (geen extra werk per bericht of tik).
    const nodig = this._extraNodig();
    if (!nodig.length) return v;
    const uit = { ...v };
    for (const k of nodig) {
      const f = VARIABELEN.get(k);
      if (!f || k in uit) continue;
      let w = null;
      try { w = f(); } catch (_) {}
      if (w !== null && w !== undefined) uit[k] = w;
    }
    return uit;
  }

  /** Welke variabelen van buiten de regels gebruiken ({maatgever}); opnieuw als regels of variabelen veranderen. */
  _extraNodig() {
    const c = this._extra;
    if (c && c.versie === this._versie && c.vv === variabelenVersie) return c.namen;
    const namen = [];
    for (const k of VARIABELEN.keys()) {
      const t = `{${k}}`;
      for (const r of this.rules.values()) if (r.action.includes(t) || r.led?.lees?.includes(t)) { namen.push(k); break; }
    }
    this._extra = { versie: this._versie, vv: variabelenVersie, namen };
    return namen;
  }

  /** Wie deze Mapping is voor het houd-register. */
  get _wie() { return this.apparaat || this.device; }

  /**
   * Welke condities (`als`) de regels gebruiken, per sleutel zonder conditie.
   * Opnieuw als de regels veranderen (dezelfde teller als de caches van kies).
   */
  _alsIndex() {
    const c = this._als;
    if (c.versie === this._versie) return c;
    const per = new Map();
    const namen = new Set();
    for (const r of this.rules.values()) {
      if (!r.als) continue;
      const k = sleutelVan({ ...r, als: undefined });
      if (!per.has(k)) per.set(k, []);
      per.get(k).push(r.als);
      namen.add(r.als);
    }
    this._als = { versie: this._versie, per, namen: [...namen] };
    return this._als;
  }

  /** Is deze conditie nu waar? Zonder functie van buiten: nooit. */
  _alsWaar(naam) {
    if (typeof this.als !== 'function') return false;
    try { return !!this.als(naam); } catch (_) { return false; }
  }

  /** De stand van alle condities als tekst (voor de cache); '' als geen regel er een heeft. */
  _alsStand() {
    const { namen } = this._alsIndex();
    if (!namen.length) return '';
    let t = '';
    for (const n of namen) t += this._alsWaar(n) ? '1' : '0';
    return t;
  }

  /*
   * De regels. Een nieuwe Map toewijzen maakt de caches van kies() ongeldig;
   * wie er iets IN verandert gaat via set/remove/load/voegToe (die tellen ook).
   */
  get rules() { return this._rules; }
  set rules(m) { this._rules = m; this._versie++; }

  /**
   * Wat kies() en actieveRegels() uitrekenden, geldt zolang de regels en de
   * open mapjes hetzelfde zijn (shift heeft zijn eigen vak). Per MIDI-bericht
   * en per LED-tik (700 regels, 30 keer per seconde) is het dan één opzoeking
   * in plaats van een zoektocht met nieuwe teksten.
   */
  _geldig(open) {
    const c = this._cache;
    // De versie van het houd-register (gaat alleen omhoog bij een verandering)
    // en de stand van de condities horen bij de sleutel (S4).
    const hv = this.houd ? this.houd.versie : 0;
    const als = this._alsStand();
    if (c.versie === this._versie && c.houd === hv && c.als === als && zelfdeLijst(c.lagen, open)) return c;
    c.versie = this._versie;
    c.houd = hv;
    c.als = als;
    c.lagen = open ? [...open] : null;
    c.kies[0].clear(); c.kies[1].clear();
    c.actief[0] = null; c.actief[1] = null;
    return c;
  }

  // ---- laden en opslaan --------------------------------------------------

  /**
   * Een volledig document laden. Is het een VERSCHIL (kind: 'diff'), dan komt
   * het bovenop de standaard die met laadStandaard/zetStandaard gezet is; een
   * verschil zonder die standaard (of voor een ander apparaat) wordt geweigerd,
   * anders laad je stilletjes alleen je vier eigen regels als hele mapping.
   */
  load(data) {
    const doc = typeof data === 'string' ? JSON.parse(data) : data;
    if (isVerschil(doc)) {
      if (!this.basis) throw new Error('mapping: een verschil heeft een standaard nodig, en die is nog niet geladen');
      const v = pasVerschilToe(this.basis.doc, doc);
      const uit = this._laad(v.doc);
      return { ...uit, fouten: [...v.fouten, ...uit.fouten], gemigreerd: v.gemigreerd,
        verschil: true, eigen: v.eigen, weg: v.weg, standaardNieuw: v.standaardNieuw };
    }
    return this._laad(doc);
  }

  /**
   * De standaard waar je eigen verschil tegen afgezet wordt (mappings/<apparaat>.json).
   * Verandert niets aan wat er nu gekoppeld is.
   */
  zetStandaard(data) {
    const { doc, fouten } = normaliseer(data);
    this.basis = { doc, vingerafdruk: vingerafdruk(doc) };
    return { fouten };
  }

  /** De standaard zetten én laden: geen eigen verschil (meer). */
  laadStandaard(data) {
    const { fouten } = this.zetStandaard(data);
    const uit = this._laad(this.basis.doc);
    return { ...uit, fouten: [...fouten, ...uit.fouten] };
  }

  /**
   * Wat jij anders hebt dan de standaard, als verschil-document. null als er
   * geen standaard is voor dit apparaat (dan eerst zetStandaard: een verschil
   * tegen de standaard van een ander apparaat betekent niets).
   */
  verschil() {
    if (!this.basis || this.basis.doc.device !== this.device) return null;
    return maakVerschil(this.basis.doc, this.toJSON(), this.basis.vingerafdruk);
  }

  _laad(doc) {
    const { rules, fouten, gemigreerd } = leesRegels(doc, this._weiger);
    this._meldGeweigerd(fouten);
    this._pasExtraToe(rules);
    this.shiftSig = typeof doc.shift === 'string' ? doc.shift : null;
    this.shift = false;
    // Een houd-knop die nog vastzit krijgt na het laden geen loslaten meer: zijn mapje nu dicht (S4).
    // Idem een drukknop: terug naar zijn stand (anders blijft de telling op dat doel voorgoed staan).
    for (const v of [...this.vast.values()]) {
      if (v.target.startsWith('layer.houd.')) this._doe(v.target, false, v.wie);
      else if (KNOPMODI.has(v.rule.mode)) this._knopLos(v);
    }
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
    const { rules, fouten } = leesRegels(doc, this._weiger);
    this._meldGeweigerd(fouten);
    const lijst = [...rules.values()].map((r) => ({ ...r, bron }));
    this.extra.set(bron, lijst);
    const voor = this.rules.size;
    this._pasExtraToe(this.rules);
    this.emit('change', this);
    return { aantal: this.rules.size - voor, fouten };
  }

  /**
   * Een fragment VERVANGEN (14 okt, werkruimte S0): eerst alle regels van deze
   * bron weg, dan de nieuwe erbij met de regels van voegToe (alleen aanvullen,
   * een eigen regel op dezelfde sleutel wint). Twee keer hetzelfde = één keer de
   * regels. Voor stukken en werkruimteregels die bij een wissel opnieuw komen.
   */
  vervangFragment(bron, data) {
    this._haalBronWeg(bron);
    return this.voegToe(bron, data);
  }

  /**
   * Een fragment weg: daarna staat er geen regel van deze bron meer. Dekte hij
   * een regel van een ander fragment af, dan staat die er meteen weer. Een
   * eigen regel (zonder bron) blijft altijd. Geeft het aantal weggehaalde regels.
   */
  haalWeg(bron) {
    const weg = this._haalBronWeg(bron);
    this._pasExtraToe(this.rules);
    if (weg) this.emit('change', this);
    return weg;
  }

  _haalBronWeg(bron) {
    this.extra.delete(bron);
    let weg = 0;
    for (const [k, r] of this.rules) if (r.bron === bron) { this.rules.delete(k); weg++; }
    if (weg) this._versie++;
    return weg;
  }

  /** Waarom een action niet op een knop mag (meta.alleenScherm), of null. */
  get _weiger() {
    const metaOf = this.metaOf;
    if (typeof metaOf !== 'function') return null;
    return (action) => (metaOf(action)?.alleenScherm === true ? 'mag alleen op het scherm, niet op een knop: geweigerd' : null);
  }

  _meldGeweigerd(fouten) {
    const g = fouten.filter((f) => f.endsWith(': geweigerd'));
    if (g.length) this.emit('geweigerd', g);
  }

  /**
   * Regels die er al staan nog eens langs meta.alleenScherm: voor actions die
   * pas NA het laden van de mapping bestaan (de aanhakers, docs/werkruimte/S0.md).
   * Haalt ze weg ('geweigerd' + 'change'); geeft hoeveel.
   */
  weigerAlleenScherm() {
    const w = this._weiger;
    if (!w) return 0;
    const fouten = [];
    for (const [k, r] of this.rules) {
      const nee = w(r.action);
      if (nee) { this.rules.delete(k); fouten.push(`regel ${k}: "${r.action}" ${nee}`); }
    }
    for (const [bron, lijst] of this.extra) this.extra.set(bron, lijst.filter((r) => !w(r.action)));
    if (!fouten.length) return 0;
    this._versie++;
    this._meldGeweigerd(fouten);
    this.emit('change', this);
    return fouten.length;
  }

  _pasExtraToe(rules) {
    this._versie++;
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
      rules: [...this.rules.values()].filter((r) => !r.bron).map(regelNaarJSON),
    };
  }

  /**
   * Exporteren geeft het VOLLEDIGE document, geen verschil: een bestand voor
   * mensen en voor een andere computer. Het leest zonder te weten op welke
   * standaard het rustte, en inladen geeft precies wat erin staat. Bewaren
   * (server, browser) gaat wel als verschil; zie mapping-opslag.js.
   */
  export() { return JSON.stringify(this.toJSON(), null, 2); }

  // ---- regels bewerken (MIDI-learn gebruikt dit) --------------------------

  /**
   * Een knop koppelen. Zonder expliciete `shift`/`laag` in opts: de stand van
   * NU. Houd je shift vast, dan wordt het een shift-regel; hoort deze knop bij
   * een mapje, dan komt hij in het mapje dat open staat. Zo koppel je in een
   * mapje zonder dat je daar iets voor hoeft in te stellen.
   */
  set(sig, action, opts = {}) {
    const nee = this._weiger?.(action);
    if (nee) { this._meldGeweigerd([`${sig}: "${action}" ${nee}`]); return null; }
    const shift = opts.shift ?? (this.shift || undefined);
    let laag = opts.laag;
    if (laag === undefined) {
      const groepen = new Set([...this.rules.values()].filter((r) => r.in === sig && r.laag).map((r) => r.laag.split('.')[0]));
      laag = this.lagen().find((l) => groepen.has(l.split('.')[0]));
    }
    const regel = { in: sig, action, mode: opts.mode || 'trigger', ...opts, shift: shift || undefined, laag: laag || undefined };
    const c = controleerRegel(regel);
    if (c) {
      if (c.geweigerd) this._meldGeweigerd([`${sig}: "${action}" ${c.reden}: geweigerd`]);
      return null;
    }
    this.rules.set(sleutelVan(regel), regel);
    this._versie++;
    this.state.delete(sig);
    this.emit('change', this);
    return regel;
  }

  /** Een regel weghalen, op sleutel. Een kale signature is de regel zonder shift en laag. */
  remove(sleutel) {
    const was = this.rules.get(sleutel);
    const weg = this.rules.delete(sleutel);
    this._versie++;
    this.state.delete(sleutel.split(/[#@?]/)[0]);
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
    const open = this.lagen();
    const vak = this._geldig(open).kies[shift ? 1 : 0];
    let r = vak.get(sig);
    if (r === undefined) { r = this._zoek(sig, shift, open); vak.set(sig, r); }
    return r;
  }

  /** De zoektocht zelf (zie kies): met shift eerst de shift-regels, binnen elk eerst het open mapje. */
  _zoek(sig, shift, open) {
    const [type, ch, nr] = sig.split(':');
    const sigs = ch === '*' ? [sig] : [sig, `${type}:*:${nr}`];
    const per = this._alsIndex().per;
    // Met een conditie die nu waar is eerst (in de volgorde van de regels), dan zonder.
    const pak = per.size
      ? (k) => { const v = per.get(k); if (v) for (const n of v) if (this._alsWaar(n)) return this.rules.get(`${k}?${n}`); return this.rules.get(k); }
      : (k) => this.rules.get(k);
    for (const s of sigs) {
      for (const sh of shift ? ['#shift', ''] : ['']) {
        for (const l of open) { const r = pak(`${s}${sh}@${l}`); if (r) return r; }
        const r = pak(`${s}${sh}`);
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
   * doet valt zonder shift weg en blijft donker.
   */
  actieveRegels({ shift = this.shift } = {}) {
    const c = this._geldig(this.lagen());
    const i = shift ? 1 : 0;
    if (c.actief[i]) return c.actief[i];
    const uit = new Map();
    for (const r of this.rules.values()) {
      if (uit.has(r.in)) continue;
      const k = this.kies(r.in, { shift });
      if (k) uit.set(r.in, k);
    }
    // Dezelfde Map tot er iets verandert (regels, mapjes): alleen lezen, niet in schrijven.
    c.actief[i] = uit;
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
    for (const v of vast) {
      if (v.rule.mode === 'trigger' || !v.rule.mode) this._doe(v.target, false, v.wie);
      else if (KNOPMODI.has(v.rule.mode)) this._knopLos(v);   // een drukknop gaat terug, een vastgezette blijft
    }
    // Wat dit apparaat aan houd-mapjes open hield, gaat dicht (houd.js).
    this.houd?.losgekoppeld(this._wie);
    for (const v of vast) if (v.wie !== this._wie) this.houd?.losgekoppeld(v.wie);
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
    // het mapje intussen veranderde. Anders blijft een drukknop hangen. Een
    // knopmodus (druk, latch) op een CC-knop telt de halve slag als loslaten.
    const isNoot = msg.type === 'note';
    const eerder = this.vast.get(msg.sig);
    const los = isNoot ? !msg.on : !!eerder && KNOPMODI.has(eerder.rule.mode) && msg.value < 64;
    const vast = los ? eerder : null;
    if (vast) {
      this.vast.delete(msg.sig);
      if (vast.rule.mode === 'trigger' || !vast.rule.mode) return this._trigger(vast.rule, msg, vast.target, vast.wie);
      if (KNOPMODI.has(vast.rule.mode)) return this._knopLos(vast);
    }
    // Een CC-knop in een knopmodus die nog vastzit: geen tweede indrukken.
    if (!isNoot && eerder && KNOPMODI.has(eerder.rule.mode)) return { rule: eerder.rule, target: eerder.target, mode: eerder.rule.mode, value: null, taken: false };

    const rule = this.kies(msg.sig);
    if (!rule) return null;

    const target = resolveTarget(rule.action, this.vars());
    const knop = KNOPMODI.has(rule.mode);
    if (isNoot ? msg.on : knop && msg.value >= 64) this.vast.set(msg.sig, { rule, target, wie: this._wie });

    switch (rule.mode) {
      case 'absolute':   return this._absolute(rule, msg, target);
      case 'relative-2c':  return this._relative(rule, msg, target, (v) => (v >= 64 ? v - 128 : v));   // 64 = -64 (protocol v1.2 p37)
      case 'relative-bin': return this._relative(rule, msg, target, (v) => v - 64);
      case 'endless':    return this._endless(rule, msg, target);
      case 'druk':
      case 'latch':      return this._knop(rule, msg, target);
      case 'stappen':    return this._stappen(rule, msg, target);
      default:           return this._trigger(rule, msg, target);
    }
  }

  _trigger(rule, msg, target, wie) {
    // Noten hebben al een on/off; een knop die CC stuurt gebruikt de halve slag.
    const on = msg.type === 'note' ? msg.on : msg.value >= 64;
    this._doe(target, on, wie);
    return { rule, target, mode: rule.mode, value: on, taken: true };
  }

  /**
   * Een trigger uitvoeren. `layer.houd.<naam>` gaat niet over de bus maar naar
   * het houd-register, met DIT apparaat als eigenaar (S4): zo sluit het
   * loslaten op de Maschine alleen wat de Maschine opende. Bij loslaten de
   * eigenaar van het indrukken (`wie`), ook als intussen een andere mapping laadde.
   */
  _doe(target, on, wie = this._wie) {
    if (this.houd && target.startsWith('layer.houd.')) { this.houd.druk(wie, target.slice(11), !!on); return; }
    this.invoke(target, on);
  }

  /**
   * Druk en latch (S4). `naar` zetten en onthouden wat er stond; loslaten (druk,
   * of lang bij `lang`) zet dat terug. Allebei gewone invokes over de bus, dus
   * het log heeft twee regels en terugspelen doet hetzelfde. Een action zonder
   * stand (read null) is geen drukknop: dan gebeurt er niets.
   */
  _knop(rule, msg, target) {
    const on = msg.type === 'note' ? msg.on : msg.value >= 64;
    const geen = { rule, target, mode: rule.mode, value: null, taken: false };
    if (!on) return geen;                       // een loslaten zonder indrukken (na laden, losgekoppeld)
    const vast = this.vast.get(msg.sig);
    // Alleen een value-action (regel 2: naar is 0..1). Een trigger zou bij loslaten false krijgen en blijven staan.
    const meta = typeof this.metaOf === 'function' ? this.metaOf(target) : undefined;
    if (meta !== undefined && meta?.type !== 'value') {
      if (vast) vast.niets = true;
      if (!this._nietWaarde.has(target)) { this._nietWaarde.add(target); this.emit('geweigerd', [`${rule.in}: "${target}" ${meta ? 'is geen draaiknop' : 'bestaat niet'}: ${rule.mode} doet niets: geweigerd`]); }
      return geen;
    }
    const sleutel = `${sleutelVan(rule)}|${target}`;
    const lang = rule.lang === true ? LANG_MS : rule.lang;
    // Vastgezet (latch, of kort gedrukt bij lang): nog eens drukken = terug.
    if (rule.mode === 'latch' || lang) {
      if (this._latch.has(sleutel)) {
        const oud = this._latch.get(sleutel);
        this._latch.delete(sleutel);
        if (vast) vast.niets = true;              // het loslaten van deze druk doet niets meer
        this.invoke(target, oud);
        return { rule, target, mode: rule.mode, value: oud, taken: true };
      }
    }
    // Een druk (zonder lang) op een doel dat al door een andere druk vastgehouden wordt:
    // de eerste stand telt, terug pas als de laatste loslaat (zoals drukknop() in actions.js).
    if (rule.mode === 'druk' && !lang) {
      const al = this._drukDoel.get(target);
      if (al) {
        al.n++;
        if (vast) { vast.oud = al.oud; vast.gedeeld = al; }
        this.invoke(target, rule.naar);
        return { rule, target, mode: rule.mode, value: rule.naar, taken: true };
      }
    }
    const oud = this.read ? this.read(target) : null;
    if (oud === null || oud === undefined) { if (vast) vast.niets = true; return geen; }
    if (vast) { vast.oud = oud; vast.t0 = this.now(); vast.sleutel = sleutel; vast.lang = lang; }
    if (rule.mode === 'druk' && !lang && vast) { vast.gedeeld = { oud, n: 1 }; this._drukDoel.set(target, vast.gedeeld); }
    if (rule.mode === 'latch' || lang) this._latch.set(sleutel, oud);
    this.invoke(target, rule.naar);
    return { rule, target, mode: rule.mode, value: rule.naar, taken: true };
  }

  _knopLos(vast) {
    const { rule, target } = vast;
    const geen = { rule, target, mode: rule.mode, value: null, taken: false };
    if (vast.niets || vast.oud === undefined) return geen;
    if (vast.lang) {
      // Kort = vast laten staan (latch). Lang = zolang je drukte: terug.
      if (this.now() - vast.t0 < vast.lang) return geen;
      if (!this._latch.has(vast.sleutel)) return geen;
      this._latch.delete(vast.sleutel);
    } else if (rule.mode === 'latch') return geen;
    else if (vast.gedeeld) {
      if (--vast.gedeeld.n > 0) return geen;       // een andere druk houdt hem nog vast
      if (this._drukDoel.get(target) === vast.gedeeld) this._drukDoel.delete(target);
    }
    this.invoke(target, vast.oud);
    return { rule, target, mode: rule.mode, value: vast.oud, taken: true };
  }

  /**
   * Stappen (S4): een relatieve encoder als triggers. Per klik `<action>.fwd`
   * of `.back`, ingedrukt en losgelaten (een trigger die alleen op indrukken
   * reageert merkt het loslaten niet; een drukknop blijft niet hangen).
   * Hooguit MAX_STAPPEN per bericht: een draai die doorschiet springt niet ver.
   */
  _stappen(rule, msg, target) {
    const v = msg.value;
    let n = rule.codering === 'bin' ? v - 64 : (v >= 64 ? v - 128 : v);
    if (rule.invert) n = -n;
    if (!n) return { rule, target, mode: rule.mode, value: null, taken: false };
    if (n > MAX_STAPPEN) n = MAX_STAPPEN; else if (n < -MAX_STAPPEN) n = -MAX_STAPPEN;
    const id = `${target}.${n > 0 ? 'fwd' : 'back'}`;
    if (typeof this.metaOf === 'function' && !this.metaOf(id)) return { rule, target: id, mode: rule.mode, value: null, taken: false };
    for (let i = Math.abs(n); i > 0; i--) { this.invoke(id, true); this.invoke(id, false); }
    return { rule, target: id, mode: rule.mode, value: n, delta: n, taken: true };
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
