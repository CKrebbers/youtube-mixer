import { Emitter } from '../lib/emitter.js';
import { parseMessage } from './midi.js';
import { Mapping, resolveTarget } from './mapping.js';
import { trackVanDeck, TRACKS, SECTIE_PADS } from './actions.js';
import { PALETTE } from './devices/apc40mk2.js';
import { INSTRUMENTEN } from '../engine/instrumenten/index.js';
import { KNOP_KANAAL, PAD_KANAAL, PAD_NOOT, WIEL_SIG, GROEPEN, KNOPPEN, KNOP_LABEL, ENCODER_CC, knopNoot, knopSig, padVanNoot } from './devices/maschine-mk2.js';
import { tekenScherm, BLADER_RIJEN } from './maschine-scherm.js';
import { eqDb, filterDoelen } from '../engine/audio-graph.js';
import { houd as gedeeldHoud } from './houd.js';

/**
 * De Maschine MK2 in VARVE (docs/MASCHINE.md), zoals de AV-app-hub hem
 * doorgeeft: virtuele MIDI op de nep-poort "Maschine MK2 (hub)" (hub.js,
 * `speelPoort('maschine-mk2')`), lampjes terug via zijn uitgang, de twee
 * schermen via `scherm(nr, bytes)`. Alleen met `?hub=`: zonder de vlag wordt
 * dit bestand niet geladen.
 *
 * SPEELMODUS (standaard):
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
 * PATRONEN (docs/PATRONEN.md; altijd op de speeltrack en zijn GEKOZEN plek):
 *   STEP             stapmodus aan/uit: pad S = `track.{speel}.pattern.step.S`
 *                    (de laatst gespeelde noot erop of eraf), lampje = de read
 *                    van die stap, de stap die je hoort wit; ◄ ► (transport) =
 *                    de bladzijde (stap 1–16, 17–32, …)
 *   PATTERN + pad    plek 1–5 kiezen (engine.patronen.kies: kiezen staat niet op
 *                    de bus); de pads tonen zolang de vijf plekken
 *   PLAY, RESTART, REC, ERASE, SHIFT + ◄ ►   de mapping: het gekozen patroon
 *                    starten/stoppen, stoppen, opnemen, leegmaken, korter/langer
 *   live opnemen     vanzelf: de pads spelen via noten.js, en daar luistert de
 *                    patroonspeler op (patronen-paneel.js)
 *
 * SECTIES (docs/SECTIES.md; de FOCUS-track, zoals de grid-modus secties van de APC):
 *   SCENE            padmodus secties aan/uit (zoals STEP; één padmodus tegelijk):
 *                    pad K = `track.{focus}.section.K` over de bus, de sectie valt
 *                    in op de volgende "1" (deck.naarSectie). Lampje = de read
 *                    (wit = die hoor je of drukt je in, donker hemelsblauw = er is
 *                    een sectie, uit = geen); ◄ ► (transport) = de bladzijde bij
 *                    meer dan 16 secties. Links op het scherm de sectie die je
 *                    hoort en de namen zoals de pads liggen.
 *                    Waarom de focus-track en niet de speeltrack: secties horen bij
 *                    een NUMMER, de speeltrack heeft altijd een instrument.
 *
 * KNOPPAGINA'S (◄ ► links boven, tak studio/maschine-dj):
 *   Instrument       de regels zonder laag (hierboven): de acht knoppen van de speeltrack
 *   Strip            laag `pagina.strip` in de mapping: trim, hoog, mid, laag, echo, galm,
 *                    fx-mix en filter van de FOCUS-track (de strip van de APC, met het
 *                    filter op 8: op de APC zit dat op de trackknop)
 *   Rack             laag `pagina.rack`: de acht plekken van het rack van de focus-track,
 *                    met de naam die het rack zelf geeft (fx.plekNaam)
 *   De pagina is een "open mapje" voor de mapping (`lagen`): wat een knop doet blijft
 *   data in mappings/maschine-mk2.json. Op het scherm de naam, de waarde in echte
 *   eenheden (dB uit eqDb, Hz uit filterDoelen) en een balk; de knop die je draait
 *   staat even omgekeerd.
 *
 * SAMPLER (SAMPLING, docs/MASCHINE.md §5f): padmodus sampler (zoals STEP en SCENE, één tegelijk).
 *   Bovenste rij = sampler-pad 1–4, tweede rij = 5–8 (`sampler.K`: leeg = knippen of het bewaarde
 *   stuk terug, gevuld = op de tel starten/stoppen); derde rij = sectie → pad 1–4, onderste = 5–8
 *   (`sampler.K.section`); SHIFT + pad = `sampler.K.clear`. Laag `sampler` in de mapping: ◄ ►
 *   (transport) = minder/meer tellen, draaiknop 5 = sampler-volume. Links op het scherm de 8 pads.
 *
 * BLADEREN (BROWSE, docs/MASCHINE.md §5e): zolang de library open is (`library.toggle`, ook
 *   met de muis of B geopend) loopt het masterwiel door de lijst (`library.next/prev`), en
 *   laden ENTER en het wiel indrukken het gekozen nummer op de FOCUS-track
 *   (`track.{focus}.load.selected`, laag `bladeren` in de mapping; speelt die: nog eens).
 *   ◄ ► bij het wiel: een pagina. De schermen tonen de lijst (de library geeft `bladerStand()`).
 *
 * UITLEG (CONTROL vasthouden): wat je dan aanraakt (knop, draaiknop, pad, wiel) gebeurt
 *   NIET; het scherm zegt wat het hier doet (`beschrijf` uit ui/apc-beschrijf.js voor
 *   wat in de mapping staat, eigen teksten voor pads, STEP, SCENE, ◄ ► …). Wat iets doet
 *   knippert. Loslaten van wat je tijdens de uitleg indrukte gaat ook nergens heen.
 *
 * WERKRUIMTE (14 okt, spoor S6, docs/werkruimte/S6.md, docs/WERKRUIMTE.md A3): wat een stuk
 *   (mappings/stukken/*.json) of een werkruimte op de Maschine zet, is DATA in de mapping:
 *   - padmodi uit data: een regel met laag `pads.<modus>` maakt die padmodus (naast STEP,
 *     SCENE en SAMPLING, die code blijven). In zo'n padmodus gaan de pads naar de mapping;
 *     loslaten naar waar het indrukken heen ging (padVast), ook na een deelwissel.
 *   - pagina's uit data: een regel met laag `pagina.<naam>` maakt een knoppagina erbij
 *     (◄ ► links boven loopt erlangs); het scherm toont label en read van die regels.
 *   - het wiel: eerst de mapping (open mapjes, ook `wiel.<naam>`), anders het oude gedrag;
 *     met de library open gaat de laag `bladeren` voor, anders bladert het wiel zoals altijd.
 *   - houd-knoppen (houd.js, gedeeld met de APC): `layer.houd.<naam>` op een knop; een
 *     houd-regel op een pad wint zolang de houd-knop vastzit, in elke padmodus.
 *   - `layer.pads.<x>`, `layer.pagina.<x>`, `layer.wiel.<x>`: kiesknoppen van een stuk
 *     (de Maschine zet ze zelf, ze gaan niet over de bus).
 *   - de werkruimte zet de mapjes met `maakMaschineAdapter` (src/werk/apparaten.js); de
 *     deellabels staan dan bovenaan de schermen (F1–F8), en SHIFT + pad in SCENE = als loop.
 *   Zonder stukken en zonder werkruimte: alles precies zoals hierboven.
 *
 * Wat de engine doet gaat over de bus (focus, knoppen, instrument kiezen,
 * stappen, transport); noten niet (een noot is geen 0..1: noten.js). De engine
 * kent geen MIDI.
 */

/** De bron van de pads in noten.js (sleutel van vastgehouden noten). */
export const BRON = 'hub-maschine-mk2-input';
export const BRON_NAAM = 'Maschine MK2 (hub)';
/** Een aanslag licht minstens zo lang fel op (een drumslag duurt op de pad maar ~15 ms). */
export const FLITS_MS = 150;
/** Een scherm hooguit zo vaak (en alleen als het veranderde). */
export const SCHERM_MS = 100;
/**
 * Na invoer (een draaiknop, een pad, een knop) mag een scherm sneller: de waarde
 * die je draait loopt dan met ~25 beelden per seconde mee in plaats van 10. Een
 * scherm is 8 HID-rapporten; de hub stuurt alleen de stukken die veranderden.
 */
export const SCHERM_SNEL_MS = 40;
/**
 * Na invoer een tik zo snel mogelijk (een microtaak, samengevoegd), hooguit één
 * per WEK_MS: de pad die je aanslaat licht meteen op, niet pas bij de volgende
 * tik van 33 ms (zoals Feedback.wek voor de APC).
 */
export const WEK_MS = 4;
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
/** Stappen per bladzijde in de stapmodus: de 16 pads. */
export const STAPPEN = 16;
/** Zoveel plekken (patronen) per track kies je met PATTERN + pad 1..5. */
export const PLEKKEN = 5;
/** Helderheid (0..127) van een knoplampje: uit, iets te doen, gevuld/klaar, aan. */
export const HELDER = { uit: 0, zacht: 8, half: 32, aan: 127, beschikbaar: 16 };

const sleutel = (kanaal, noot) => `${kanaal}:${noot}`;
const NAMEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI-noot als naam (60 = C4). */
export const nootNaam = (n) => `${NAMEN[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

/** De knoppagina's (◄ ► links boven), in deze volgorde; 'instrument' = de regels zonder laag. */
export const PAGINAS = ['instrument', 'strip', 'rack'];
export const PAGINA_NAAM = { instrument: 'Instrument', strip: 'Strip', rack: 'Rack' };
/** De padmodi die code zijn (STEP, SCENE, SAMPLING en spelen); de rest komt uit de mapping (`pads.<modus>`). */
export const CODE_PADMODI = ['spelen', 'stappen', 'secties', 'sampler'];
/** De namen in een werkruimte (src/werk/model.js) die een code-padmodus zijn. */
export const WERK_PADMODUS = { spelen: 'spelen', stap: 'stappen', secties: 'secties', sampler: 'sampler' };
/** De naam van een pagina, padmodus of wiel uit data op het scherm: "uitlijn" -> "Uitlijn". */
export const naamUitData = (n) => (PAGINA_NAAM[n] ?? (n ? n[0].toUpperCase() + n.slice(1) : ''));
/**
 * Knoppen waarvan maschine.js het lampje zelf zet (ledBeeld). De andere krijgen alleen een lampje
 * als er een regel op staat (een stuk, of jouw eigen): dan de read van die regel.
 */
const CODE_LAMPJES = new Set(['shift', 'enter', 'step', 'pattern', 'play', 'restart', 'rec', 'erase', 'scene', 'sampling',
  'stapL', 'stapR', 'browseL', 'browseR', 'control', 'browse', 'navL', 'navR', 'wiel', ...GROEPEN]);
/**
 * De pads in de padmodus sampler (§5f), zoals je ernaar kijkt: bovenste rij (pad 13–16) =
 * sampler-pad 1–4, tweede rij (9–12) = 5–8, derde (5–8) = sectie → pad 1–4, onderste (1–4) =
 * sectie → pad 5–8. Puur: pad 1..16 → { k: sampler-pad 1..8, soort: 'sample' | 'sectie' }.
 */
export function samplerPad(pad) {
  const rij = Math.floor((pad - 1) / 4), kol = (pad - 1) % 4;
  return rij >= 2 ? { k: kol + (rij === 3 ? 1 : 5), soort: 'sample' } : { k: kol + (rij === 1 ? 1 : 5), soort: 'sectie' };
}
/** De action van een pad in de padmodus sampler; met SHIFT: leegmaken (of vergeten). */
export const samplerActie = (pad, shift) => {
  const { k, soort } = samplerPad(pad);
  return shift ? `sampler.${k}.clear` : soort === 'sample' ? `sampler.${k}` : `sampler.${k}.section`;
};

/** Zo lang staat de draaiknop die je draaide omgekeerd op het scherm. */
export const GEDRAAID_MS = 1000;
/** Knipperen tijdens de uitleg: zo lang aan, zo lang zacht. */
export const KNIPPER_MS = 300;

const komma = (s) => s.replace('.', ',');
const dB = (db) => (Math.abs(db) < 0.05 ? '0 dB' : komma(`${db > 0 ? '+' : ''}${db.toFixed(1)} dB`));
const hz = (f) => (f < 1000 ? `${Math.round(f)} Hz` : komma(`${(f / 1000).toFixed(f < 10000 ? 1 : 0)} kHz`));
const procent = (v) => `${Math.round(v * 100)}%`;
/** Het filter in woorden: midden open, links lowpass, rechts highpass (dezelfde formule als de engine). */
export function filterTekst(v) {
  if (Math.abs(v - 0.5) < 0.004) return 'open';
  const [hpf, , lpf] = filterDoelen(v);
  return v < 0.5 ? `LP ${hz(lpf)}` : `HP ${hz(hpf)}`;
}
/** De pagina Strip: welke action per knop, de naam op het scherm en de waarde in echte eenheden. */
export const STRIP = [
  { actie: 'trim', label: 'trim', bipolair: true, uitleg: 'versterking vóór de EQ; midden = 0 dB, helemaal links = uit', tekst: (v) => (v <= 0.001 ? 'uit' : dB(20 * Math.log10(2 * v))) },
  { actie: 'high', label: 'hoog', bipolair: true, uitleg: 'EQ hoog: -30 tot +8 dB, midden = 0 dB, helemaal links = kill', tekst: (v) => (v < 0.03 ? 'kill' : dB(eqDb(v))) },
  { actie: 'mid', label: 'mid', bipolair: true, uitleg: 'EQ mid: -30 tot +8 dB, midden = 0 dB, helemaal links = kill', tekst: (v) => (v < 0.03 ? 'kill' : dB(eqDb(v))) },
  { actie: 'low', label: 'laag', bipolair: true, uitleg: 'EQ laag: -30 tot +8 dB, midden = 0 dB, helemaal links = kill', tekst: (v) => (v < 0.03 ? 'kill' : dB(eqDb(v))) },
  { actie: 'send.a', label: 'echo', uitleg: 'hoeveel naar de echobus gaat (na de fader: echo-out werkt)', tekst: procent },
  { actie: 'send.b', label: 'galm', uitleg: 'hoeveel naar de galmbus gaat (na de fader)', tekst: procent },
  { actie: 'fx.mix', label: 'fx-mix', uitleg: 'droog/nat van het effect op deze track (pagina Rack: de plekken)', tekst: procent },
  { actie: 'filter', label: 'filter', bipolair: true, uitleg: 'links lowpass (dicht naar 250 Hz), rechts highpass (tot 9 kHz), midden open', tekst: filterTekst },
];

/**
 * Uitleg van de knoppen die maschine.js zelf afhandelt (niet in de mapping):
 * de tekst voor CONTROL, en voor de Maschine-kaart (maschine.html) een kort
 * label en een soort (de kleur, ui/soorten.js).
 */
export const UITLEG = {
  control: { kort: 'uitleg', soort: 'mapje', tekst: 'vasthouden en iets aanraken: hier staat wat het doet, en het gebeurt niet' },
  shift: { kort: 'shift', soort: 'mapje', tekst: 'vasthouden: de tweede laag. Draaiknoppen fijn, PLAY en RESTART meteen, < > (transport) korter/langer' },
  browseL: { kort: '◄ pagina', soort: 'mapje', tekst: 'vorige knoppagina: Instrument, Strip, Rack' },
  browseR: { kort: 'pagina ►', soort: 'mapje', tekst: 'volgende knoppagina: Instrument, Strip, Rack' },
  step: { kort: 'stappen', soort: 'patroon', tekst: 'stapmodus aan/uit: de pads zijn de stappen van het gekozen patroon op de speeltrack' },
  scene: { kort: 'secties', soort: 'sectie', tekst: 'padmodus secties aan/uit: pad K = sectie K van de focus-track, valt in op de volgende "1"' },
  sampling: { kort: 'sampler', soort: 'sampler', tekst: 'padmodus sampler aan/uit: boven de 8 sampler-pads, onder een sectie in pad 1-8, SHIFT + pad = leeg; < > = tellen, knop 5 = volume' },
  pattern: { kort: 'plek kiezen', soort: 'patroon', tekst: 'vasthouden + pad 1-5: een patroonplek kiezen op de speeltrack' },
  stapL: { kort: '◄ blad', soort: 'patroon', tekst: 'stappen of secties: vorige bladzijde. SHIFT: het patroon korter' },
  stapR: { kort: 'blad ►', soort: 'patroon', tekst: 'stappen of secties: volgende bladzijde. SHIFT: het patroon langer' },
  wiel: { kort: 'zetten', soort: 'instrument', tekst: 'indrukken: het instrument dat het wiel koos zetten op de focus-track (met de library open: laden)' },
  enter: { kort: 'zetten', soort: 'instrument', tekst: 'het instrument dat het wiel koos zetten op de focus-track (met de library open: laden)' },
};

export class Maschine extends Emitter {
  /**
   * @param engine  focus, speeltrack(), instrumentOp(id), deck(id)
   * @param noten   de Noten van instrument-paneel.js (de pads spelen daar)
   * @param read    read() van de bus
   * @param invoke  invoke() van de bus
   * @param nu      klok in ms (flitsen, schermtempo, keuze van het wiel)
   * @param beschrijf  action -> { kort, lang } (ui/apc-beschrijf.js), voor de uitleg; zonder: de kale action
   * @param houd     het register van de houd-mapjes (houd.js), gedeeld met de APC; een test geeft een eigen
   * @param uitlijn  (deckId) => { vouw, getallen } | null: de fasescoop en de getallen van de focus-track
   *                 (src/uitlijn/reken.js; de aanhaker geeft hem, zie src/ui/aanhakers/maschine.js)
   */
  constructor({ engine, noten, read = () => null, invoke = () => {}, nu = () => (globalThis.performance?.now() ?? Date.now()), beschrijf = null, library = null,
    houd = gedeeldHoud, uitlijn = null }) {
    super();
    Object.assign(this, { engine, noten, read, invoke, nu, beschrijf, library, houd, uitlijn });
    this.pagina = 'instrument';     // de knoppagina (◄ ► links boven): een open "mapje" voor de mapping
    this.wiel = null;               // het wiel-mapje uit data ('jog', 'rack', …: laag wiel.<naam>), of null = het oude gedrag
    this.scherm = null;             // wat de schermen in een deel tonen, per scherm (['strip', 'fasescoop']), of null
    this.delen = null;              // in een werkruimte: { labels: [..8], actief: 0..7 | -1 } voor de bovenste regel, anders null
    this.kleur = null;              // de kleur van het deel (APC-palet), voor de pads in een padmodus uit data
    this._dataC = null;             // wat de mapping aan padmodi, pagina's en wielen declareert (per versie van de regels)
    // Lezen en uitvoeren gaan via de bus, behalve de kiesknoppen van de Maschine zelf (layer.pads.*, …).
    const lees = (id) => (id.charCodeAt(0) === 108 && id.startsWith('layer.') ? this._leesLokaal(id, read) : read(id));
    const doe = (id, v, o) => { if (!(id.charCodeAt(0) === 108 && this._doeLokaal(id, v))) invoke(id, v, o); };
    this.mapping = new Mapping({ read: lees, invoke: doe, now: nu, houd,
      lagen: () => this._lagen(),
      vars: () => ({ focus: trackVanDeck(engine.focus), speel: trackVanDeck(engine.speeltrack?.() ?? null), plek: this.plek() }) });
    this.uitleg = null;             // CONTROL vast: { wat: { titel, tekst } | null }
    this.uitlegVast = new Set();    // knoppen/pads die tijdens de uitleg ingedrukt werden: hun loslaten gaat nergens heen
    this.gedraaid = null;           // { k (0..7), tot }: de draaiknop die je net draaide
    this.poort = null;              // { in, uit, scherm } van HubMidi.speelPoort('maschine-mk2')
    this.leds = new Map();          // 'kanaal:noot' -> velocity zoals het laatst verstuurd
    this.schermen = [null, null];   // laatst verstuurde bytes per scherm
    this.schermTijd = [-Infinity, -Infinity];
    this.schermWakker = -Infinity;  // nu() van de laatste invoer: tot SCHERM_MS daarna mag een scherm per SCHERM_SNEL_MS
    this._wekker = null;            // een geplande wektik (zie wek)
    this._laatsteTik = -Infinity;
    this.wekTikken = 0;
    this.flits = new Map();         // pad-noot -> tot (ms)
    this.kandidaat = null;          // { id, index, tot }: het masterwiel, nog niet gezet
    this.melding = null;            // { tekst, tot }
    this.modus = 'spelen';          // 'spelen', 'stappen' (STEP) of 'secties' (SCENE)
    this.bladzijde = 0;             // stapmodus: pads = stap 16·b + 1 .. 16·b + 16
    this.sectieBlad = 0;            // modus secties: pads = sectie 16·b + 1 .. 16·b + 16
    this._sectieFocus = undefined;  // de focus-track waar sectieBlad bij hoort
    this.patroonVast = false;       // PATTERN ingedrukt: pads 1–5 kiezen een plek
    this.padVast = new Map();       // pad-noot -> waar het indrukken heen ging ('noten', een action, of 'kies' = niets bij het loslaten)
    this.rx = 0;
    this.geraakt = null;            // { sig, t }: het laatst ingedrukt of gedraaid (voor de Maschine-kaart)
  }

  /** Staat de library open? Dan bladert het wiel en laadt ENTER (docs/MASCHINE.md §5e). */
  bladeren() { return this.read('library.toggle') === 1; }

  /**
   * De open mapjes voor de mapping. Met de library open gaat `bladeren` voor (het wiel bladert);
   * dan de padmodus (sampler, of een uit data), het wiel-mapje en de knoppagina. De houd-mapjes
   * zet de Mapping er zelf voor (houd.js).
   */
  _lagen() {
    const l = [];
    if (this.bladeren()) l.push('bladeren');
    if (this.modus === 'sampler') l.push('sampler');
    else if (this.isDataPad(this.modus)) l.push(`pads.${this.modus}`);
    if (this.wiel) l.push(`wiel.${this.wiel}`);
    l.push(`pagina.${this.pagina}`);
    return l;
  }

  /**
   * Wat de regels (standaard, stukken, werkruimte, jouw eigen) aan padmodi, pagina's en wielen
   * declareren: een laag `pads.x`/`pagina.x`/`wiel.x`, of een kiesknop `layer.pads.x`. Opnieuw
   * alleen als de regels veranderen (`mapping._versie`). `ledKnoppen`: knoppen met een regel die
   * maschine.js zelf geen lampje geeft (F1–F8, VOLUME, SOLO …): hun lampje volgt de read.
   */
  _data() {
    const v = this.mapping._versie;
    if (this._dataC?.v === v) return this._dataC;
    const pads = new Set(), paginas = new Set(), wielen = new Set(), sigs = new Set();
    const bij = { pads, pagina: paginas, wiel: wielen };
    for (const r of this.mapping.rules.values()) {
      sigs.add(r.in);
      // De namen uit het werkruimtebestand (stap, secties …) zijn de padmodi van code, geen nieuwe.
      const [g, n] = typeof r.laag === 'string' ? r.laag.split('.') : [];
      if (bij[g] && n) bij[g].add(n);
      const k = /^layer\.(pads|pagina|wiel)\.([a-z0-9-]+)$/.exec(r.action);
      if (k) bij[k[1]].add(k[2]);
    }
    const ledKnoppen = KNOPPEN.filter((naam) => !CODE_LAMPJES.has(naam) && sigs.has(knopSig(naam)));
    this._dataC = { v, pads: [...pads].filter((p) => !CODE_PADMODI.includes(p) && !WERK_PADMODUS[p]), paginas: [...PAGINAS, ...[...paginas].filter((p) => !PAGINAS.includes(p))],
      wielen: [...wielen], ledKnoppen };
    return this._dataC;
  }

  /** De knoppagina's: Instrument, Strip, Rack en wat een stuk erbij zet (laag pagina.<naam>). */
  paginas() { return this._data().paginas; }
  /** De padmodi uit data (laag pads.<modus>), zonder de vier die code zijn. */
  padmodi() { return this._data().pads; }
  /** Is dit een padmodus uit data die er nu is? */
  isDataPad(modus) { return !CODE_PADMODI.includes(modus) && this._data().pads.includes(modus); }

  /**
   * Na een andere mapping (een werkruimte haalt zijn stukken weg): een padmodus, pagina of wiel
   * die er niet meer is, gaat terug naar spelen, Instrument en het oude wiel. Goedkoop: alleen
   * als de versie van de regels veranderde.
   */
  _controleer() {
    if (this._gecontroleerd === this.mapping._versie) return;
    this._gecontroleerd = this.mapping._versie;
    if (!CODE_PADMODI.includes(this.modus) && !this.isDataPad(this.modus)) this.modus = 'spelen';
    if (!this.paginas().includes(this.pagina)) this.pagina = 'instrument';
    if (this.wiel && !this._data().wielen.includes(this.wiel)) this.wiel = null;
  }

  /** De read van een kiesknop van de Maschine zelf (layer.pads.x, layer.houd.x …), anders de bus. */
  _leesLokaal(id, read) {
    const [, g, n] = id.split('.');
    if (g === 'houd' && n) return this.houd?.isOpen(n) ? 1 : 0;
    if (g === 'pads') { const p = WERK_PADMODUS[n] ?? n; return CODE_PADMODI.includes(p) || this.isDataPad(p) ? (this.modus === p ? 1 : 0) : null; }
    if (g === 'pagina') return this.paginas().includes(n) ? (this.pagina === n ? 1 : 0) : null;
    if (g === 'wiel') return this._data().wielen.includes(n) ? (this.wiel === n ? 1 : 0) : null;
    return read(id);
  }

  /** Een kiesknop van een stuk op de Maschine: zelf doen (indrukken), niet over de bus. Geeft true als hij van hier is. */
  _doeLokaal(id, v) {
    const k = /^layer\.(pads|pagina|wiel)\.([a-z0-9-]+)$/.exec(id);
    if (!k) return false;
    if (!v) return true;
    const [, g, n] = k;
    if (g === 'pads') { const p = WERK_PADMODUS[n] ?? n; this.zetModus(this.modus === p ? 'spelen' : p); }
    else if (g === 'pagina') this.zetPagina(n);
    else this.wiel = this.wiel === n || !this._data().wielen.includes(n) ? null : n;
    return true;
  }

  /** De read van een regel (met led.lees), zoals de LED-laag van de APC hem leest. */
  _leesRegel(regel) {
    if (!regel) return null;
    const vars = this.mapping.vars();
    const id = resolveTarget(regel.led?.lees ?? regel.action, vars);
    try { return this.mapping.read(id); } catch (_) { return null; }
  }

  /** Een houd-regel op deze signature, zolang er een houd-mapje open is (anders null, zonder te zoeken). */
  _houdRegel(sig) {
    if (!this.houd || this.houd.leeg) return null;
    const r = this.mapping.kies(sig);
    return r && typeof r.laag === 'string' && r.laag.startsWith('houd.') ? r : null;
  }

  /** Een eigen uitleg (UITLEG) voor deze knop, als die nu geldt; met de library open laden wiel en ENTER (de mapping). */
  eigenUitleg(naam) {
    if ((naam === 'wiel' || naam === 'enter') && (this.bladeren() || this.mapping.kies(knopSig(naam)))) return null;
    if ((naam === 'stapL' || naam === 'stapR') && this.modus === 'sampler') return null;   // zoals ontvang(): ook met PATTERN vast
    return UITLEG[naam] ?? null;
  }

  /**
   * Het wiel met de library open: `stappen` nummers verder (hooguit 20 per bericht).
   * Alleen indrukken (een trigger doet niets bij loslaten): de helft minder op de bus en in het log.
   */
  blader(stappen) {
    const n = Math.max(-20, Math.min(20, stappen | 0));
    const actie = n > 0 ? 'library.next' : 'library.prev';
    for (let i = 0; i < Math.abs(n); i++) this.invoke(actie, true);
    return n !== 0;
  }

  /** De gekozen plek (1..5) op de speeltrack, of 1. */
  plek() {
    const id = this.engine.speeltrack?.() ?? null;
    return (id && this.engine.patronen?.gekozen?.(id)) || 1;
  }

  /** Lengte van het gekozen patroon op de speeltrack (16 als het er nog niet is). */
  _lengte() {
    const id = this.engine.speeltrack?.() ?? null;
    return (id && this.engine.patronen?.patroon?.(id, this.plek())?.lengte) || STAPPEN;
  }

  /** Aantal bladzijden van 16 stappen; houdt de bladzijde binnen het patroon. */
  _bladzijden() {
    const n = Math.max(1, Math.ceil(this._lengte() / STAPPEN));
    if (this.bladzijde > n - 1) this.bladzijde = n - 1;
    return n;
  }

  /** De track van de modus secties: de FOCUS-track ({ id, nr, deck }), of null. */
  _sectieTrack() {
    const id = this.engine.focus ?? null;
    const nr = id ? trackVanDeck(id) : null;
    return nr ? { id, nr, deck: this.engine.deck?.(id) ?? null } : null;
  }

  /** De sectiekaart van de focus-track (alleen met een nummer erop), of null. */
  _sectieKaart() {
    const d = this._sectieTrack()?.deck;
    return d?.buffer && d.sectieKaart ? d.sectieKaart : null;
  }

  /**
   * Aantal bladzijden van 16 secties op de focus-track; houdt de bladzijde erbinnen.
   * Een andere focus-track: de bladzijde met de sectie die je daar HOORT, anders
   * blad 1 (anders ging blad 2 mee en zag je op de nieuwe track meteen 17–32).
   */
  _sectieBladen() {
    const t = this._sectieTrack(), k = this._sectieKaart();
    if ((t?.id ?? null) !== this._sectieFocus) {
      this._sectieFocus = t?.id ?? null;
      const hier = k ? t.deck.sectieHier : -1;
      this.sectieBlad = hier >= 0 && hier < SECTIE_PADS ? Math.floor(hier / STAPPEN) : 0;
    }
    const n = Math.max(1, Math.ceil(Math.min(k?.aantal ?? 0, SECTIE_PADS) / STAPPEN));
    if (this.sectieBlad > n - 1) this.sectieBlad = n - 1;
    return n;
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
          zelf.schermWakker = zelf.nu();
          zelf.wek();
        }
      }
    };
    ingang.onstatechange = function (e) { try { vorigSt?.call(this, e); } finally { zelf._staat(); } };
    this._staat();
    return this;
  }

  _staat() {
    const verbonden = this.poort?.in?.state === 'connected';
    // Voor de werkruimte (vereist/terugval): de aanhaker luistert hierop. Alleen bij een echte wissel.
    if (verbonden !== this._verbonden) { this._verbonden = verbonden; this.emit('poort', verbonden); }
    if (verbonden) return;
    // Weg: wat de pads vasthielden los, shift los; bij terugkomen alles opnieuw.
    this.noten?.los(BRON);
    // 'mapping': de pad ging naar de mapping (een padmodus uit data); die laat hem los in losgekoppeld().
    for (const waar of this.padVast.values()) if (waar !== 'noten' && waar !== 'kies' && waar !== 'mapping') this.invoke(waar, false);
    this.padVast.clear();
    this.patroonVast = false;
    this.uitleg = null;
    this.uitlegVast.clear();
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
    this._controleer();
    if ((msg.type === 'note' && msg.on) || msg.type === 'cc') this.geraakt = { sig: msg.sig, t: this.nu() };
    // CONTROL vasthouden = uitleg: wat je dan aanraakt wordt uitgelegd, niet uitgevoerd.
    if (msg.type === 'note' && msg.channel === KNOP_KANAAL && msg.number === knopNoot('control')) {
      this.uitleg = msg.on ? { wat: null } : null;
      return true;
    }
    if (this._uitlegSlikt(msg)) return true;
    // ◄ ► links boven: de knoppagina (Instrument, Strip, Rack).
    if (msg.type === 'note' && msg.channel === KNOP_KANAAL && (msg.number === knopNoot('browseL') || msg.number === knopNoot('browseR'))) {
      if (msg.on) this.bladerPagina(msg.number === knopNoot('browseL') ? -1 : 1);
      return true;
    }
    if (msg.type === 'cc' && msg.channel === 0 && msg.number >= ENCODER_CC && msg.number < ENCODER_CC + 8) {
      this.gedraaid = { k: msg.number - ENCODER_CC, tot: this.nu() + GEDRAAID_MS };
    }
    // Pads: spelen (noten.js), een stap (stapmodus) of een plek kiezen (PATTERN).
    if (msg.channel === PAD_KANAAL && (msg.type === 'note' || msg.type === 'poly') && padVanNoot(msg.number) !== null) return this._pad(msg);
    // STEP, SCENE en PATTERN: de modus van de pads (hier, niet op de bus: het is wat de pads betekenen).
    if (msg.type === 'note' && msg.channel === KNOP_KANAAL) {
      if (msg.number === knopNoot('step')) { if (msg.on) this.zetModus(this.modus === 'stappen' ? 'spelen' : 'stappen'); return true; }
      if (msg.number === knopNoot('scene')) { if (msg.on) this.zetModus(this.modus === 'secties' ? 'spelen' : 'secties'); return true; }
      if (msg.number === knopNoot('sampling')) { if (msg.on) this.zetModus(this.modus === 'sampler' ? 'spelen' : 'sampler'); return true; }
      if (msg.number === knopNoot('pattern')) { this.patroonVast = !!msg.on; return true; }
      // ◄ ► (transport) zonder SHIFT: de bladzijde van de stappen of de secties. Met SHIFT: de mapping (korter/langer).
      const stap = msg.number === knopNoot('stapL') ? -1 : msg.number === knopNoot('stapR') ? 1 : 0;
      if (stap && !this.mapping.shift && !this.mapping.vast.has(msg.sig) && this.modus !== 'sampler') {
        if (msg.on && this.modus === 'stappen') this.bladzijde = Math.max(0, Math.min(this._bladzijden() - 1, this.bladzijde + stap));
        if (msg.on && this.modus === 'secties') this.sectieBlad = Math.max(0, Math.min(this._sectieBladen() - 1, this.sectieBlad + stap));
        return msg.on && (this.modus === 'stappen' || this.modus === 'secties');
      }
    }
    // Het masterwiel: draaien = kiezen, indrukken (of ENTER) = zetten.
    // Met de library open: door de lijst (bladeren), en indrukken/ENTER gaat naar de mapping (laden).
    // Het wiel vraagt eerst de mapping (een wiel-mapje uit data, een houd-mapje: TEMPO vast + wiel);
    // met de library open alleen de laag bladeren, anders bladert hij zoals altijd.
    if (msg.sig === WIEL_SIG) {
      const stappen = msg.value >= 64 ? msg.value - 128 : msg.value;
      const regel = this.mapping.kies(msg.sig);
      if (this.bladeren()) return regel?.laag === 'bladeren' ? !!this.mapping.handle(msg)?.taken : this.blader(stappen);
      return regel ? !!this.mapping.handle(msg)?.taken : this.draaiWiel(stappen);
    }
    if (msg.type === 'note' && msg.channel === KNOP_KANAAL && (msg.number === knopNoot('wiel') || msg.number === knopNoot('enter'))
      && !this.bladeren() && !this.mapping.vast.has(msg.sig) && !(msg.on && this.mapping.kies(msg.sig))) {
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

  /** STEP, SCENE, SAMPLING of een padmodus uit data: spelen, stappen, secties, sampler of <naam> (één padmodus tegelijk). */
  zetModus(modus) {
    this.modus = modus === 'stappen' || modus === 'secties' || modus === 'sampler' || this.isDataPad(modus) ? modus : 'spelen';
    this._bladzijden();
    this._sectieBladen();
  }

  /** Een knoppagina zetten ('instrument', 'strip', 'rack', of een uit data). Geeft false bij een onbekende. */
  zetPagina(pagina) {
    if (!this.paginas().includes(pagina)) return false;
    this.pagina = pagina;
    this.gedraaid = null;
    return true;
  }

  /** ◄ ► links boven: één pagina verder of terug, niet rondlopend (het lampje zegt of het kan). */
  bladerPagina(stap) {
    const lijst = this.paginas();
    const i = lijst.indexOf(this.pagina) + stap;
    return i >= 0 && i < lijst.length ? this.zetPagina(lijst[i]) : false;
  }

  // ---- uitleg (CONTROL vasthouden) ------------------------------------------------

  /**
   * Slikt de uitleg dit bericht in? Tijdens de uitleg: indrukken en draaien worden
   * uitgelegd en NIET doorgegeven. Wat tijdens de uitleg werd ingedrukt, laat ook
   * nergens los (ook als CONTROL al los is). Loslaten en druk van wat er al vóór
   * CONTROL in zat gaan gewoon door: anders bleef er een noot of knop hangen.
   */
  _uitlegSlikt(msg) {
    const toets = msg.type === 'note' || msg.type === 'poly' ? `note:${msg.channel}:${msg.number}` : null;
    if (toets && this.uitlegVast.has(toets) && !(msg.type === 'note' && msg.on)) {
      if (msg.type === 'note') this.uitlegVast.delete(toets);
      return true;
    }
    if (!this.uitleg) return false;
    if (msg.type === 'note' && msg.on) {
      this.uitlegVast.add(toets);
      this.uitleg.wat = this.legUit(msg);
      return true;
    }
    if (msg.type === 'cc') {
      if (msg.value) this.uitleg.wat = this.legUit(msg);
      return true;
    }
    return false;
  }

  /** Wat een knop, draaiknop, pad of het wiel HIER doet: { titel, tekst }. */
  legUit(msg) {
    if (msg.channel === PAD_KANAAL && msg.type === 'note' && padVanNoot(msg.number) !== null) return this._legPadUit(padVanNoot(msg.number));
    if (msg.sig === WIEL_SIG) {
      const regel = this.mapping.kies(msg.sig, { shift: false });
      const metShift = this.mapping.kies(msg.sig, { shift: true });
      if (regel && (!this.bladeren() || regel.laag === 'bladeren')) {
        return { titel: 'masterwiel', tekst: `${this._beschrijfActie(regel.action)}${metShift && metShift !== regel ? `. SHIFT: ${this._beschrijfActie(metShift.action)}` : ''}` };
      }
      if (this.bladeren()) {
        const nr = trackVanDeck(this.engine.focus ?? null);
        return { titel: 'masterwiel (library open)', tekst: `draaien = door de library (het gekozen nummer licht op); indrukken of ENTER = laden op track ${nr ?? '?'} (focus)` };
      }
      return { titel: 'masterwiel', tekst: 'draaien = een instrument kiezen voor de focus-track (eerst alleen op het scherm); indrukken of ENTER = zetten' };
    }
    if (msg.type === 'cc' && msg.number >= ENCODER_CC && msg.number < ENCODER_CC + 8) {
      const k = msg.number - ENCODER_CC + 1;
      // In de padmodus sampler gaat de laag `sampler` voor (draaiknop 5 = volume).
      const viaSampler = this.modus === 'sampler' ? this.mapping.kies(msg.sig, { shift: false }) : null;
      if (viaSampler?.laag === 'sampler') return { titel: `draaiknop ${k} (sampler)`, tekst: `${this._beschrijfActie(viaSampler.action)}. SHIFT = fijn` };
      const titel = `draaiknop ${k} (${naamUitData(this.pagina)})`;
      const nr = trackVanDeck(this.engine.focus ?? null);
      if (this.pagina === 'strip') return { titel, tekst: `${STRIP[k - 1].label} van track ${nr ?? '?'} (focus): ${STRIP[k - 1].uitleg}. SHIFT = fijn` };
      if (this.pagina === 'rack') {
        const naam = this.engine.deck?.(this.engine.focus)?.fx?.plekNaam?.(k) ?? null;
        return { titel, tekst: naam ? `plek ${k} van het rack van track ${nr ?? '?'}: ${naam}. Het rack bepaalt wat dat doet. SHIFT = fijn`
          : `plek ${k} bestaat niet in het rack van track ${nr ?? '?'} (een ander rack: ook met de APC of op het scherm)` };
      }
      const regel = this.mapping.kies(msg.sig, { shift: false });
      return { titel, tekst: regel ? `${this._beschrijfActie(regel.action)}. SHIFT = fijn` : 'doet op deze pagina niets' };
    }
    const naam = msg.channel === KNOP_KANAAL && msg.type === 'note' ? KNOPPEN[msg.number] : null;
    const titel = KNOP_LABEL[naam] ?? naam ?? msg.sig;
    const eigen = naam ? this.eigenUitleg(naam) : null;
    if (eigen) return { titel, tekst: eigen.tekst };
    const regel = this.mapping.kies(msg.sig, { shift: false });
    const metShift = this.mapping.kies(msg.sig, { shift: true });
    if (!regel && !metShift) return { titel, tekst: 'doet hier (nog) niets' };
    let tekst = regel ? this._beschrijfActie(regel.action) : '';
    if (metShift && metShift !== regel) tekst += `${tekst ? '. ' : ''}SHIFT: ${this._beschrijfActie(metShift.action)}`;
    return { titel, tekst };
  }

  _legPadUit(pad) {
    const titel = `pad ${pad}`;
    const sig = `note:${PAD_KANAAL}:${PAD_NOOT + pad - 1}`;
    const houd = this._houdRegel(sig);
    if (houd) return { titel, tekst: `${this._beschrijfActie(houd.action)} (zolang ${houd.laag.slice(5).toUpperCase()} vastzit)` };
    if (this.patroonVast) return { titel, tekst: pad <= PLEKKEN ? `patroonplek ${pad} kiezen op de speeltrack` : 'doet niets zolang PATTERN vastzit (pad 1-5 kiezen een plek)' };
    if (this.modus === 'secties') return { titel, tekst: `sectie ${this.sectieBlad * STAPPEN + pad} van de focus-track; valt in op de volgende "1"${this.delen ? '. SHIFT = als loop' : ''}` };
    if (this.isDataPad(this.modus)) {
      const regel = this.mapping.kies(sig, { shift: false });
      const metShift = this.mapping.kies(sig, { shift: true });
      if (!regel && !metShift) return { titel, tekst: `doet in padmodus ${this.modus} niets` };
      let tekst = regel ? this._beschrijfActie(regel.action) : '';
      if (metShift && metShift !== regel) tekst += `${tekst ? '. ' : ''}SHIFT: ${this._beschrijfActie(metShift.action)}`;
      return { titel, tekst };
    }
    if (this.modus === 'sampler') {
      const { k, soort } = samplerPad(pad);
      return { titel, tekst: soort === 'sample'
        ? `sampler-pad ${k}: leeg = de laatste tellen van de focus-track knippen (of het bewaarde stuk terug), gevuld = op de tel starten/stoppen. SHIFT = leegmaken (leeg: vergeten)`
        : `de sectie die je hoort op de focus-track in sampler-pad ${k} (alleen een lege pad). SHIFT = pad ${k} leegmaken` };
    }
    if (this.modus === 'stappen') return { titel, tekst: `stap ${this.bladzijde * STAPPEN + pad} van het gekozen patroon aan/uit, met de laatst gespeelde noot` };
    const speel = this.engine.speeltrack?.() ?? null;
    const inst = speel ? this.engine.instrumentOp(speel) : null;
    return { titel, tekst: inst
      ? `speelt ${nootNaam(PAD_NOOT + pad - 1)} op ${inst.naam} (track ${trackVanDeck(speel)}): zo hard als je slaat, dieper drukken = druk`
      : 'speelt een noot zodra er een instrument op een track staat (groep, wiel, indrukken)' };
  }

  /** Een action in gewone taal (ui/apc-beschrijf.js), of de kale naam. */
  _beschrijfActie(action) {
    try { return this.beschrijf?.(action)?.lang ?? action; } catch (_) { return action; }
  }

  // ---- de pagina's Strip en Rack ------------------------------------------------------

  /** De focus-track voor de schermkop: nummer, titel, bpm, toonsoort, resterende tijd, rack. */
  _djStand() {
    const id = this.engine.focus ?? null;
    const nr = id ? trackVanDeck(id) : null;
    const d = id ? this.engine.deck?.(id) ?? null : null;
    const metNummer = !!d?.buffer;
    let rest = null;
    if (metNummer && Number.isFinite(d.duration) && Number.isFinite(d.position)) {
      const s = Math.max(0, Math.round(d.duration - d.position));
      rest = `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    const t = metNummer ? d.toonsoort : null;
    const bpm = metNummer ? d.bpm : null;
    return {
      nr, titel: metNummer ? d.title ?? null : null,
      wat: metNummer ? 'nummer' : this.engine.instrumentOp?.(id) ? this.engine.instrumentOp(id).naam : 'leeg',
      bpm: Number.isFinite(bpm) ? komma(bpm.toFixed(1)) : null,
      toon: t ? [t.camelot, t.kort].filter(Boolean).join(' ') : null,
      rest,
      rack: d?.fx?.rackNaam ?? null,
    };
  }

  /** De acht knoppen van Strip of Rack voor het scherm: { label, waarde, tekst, bipolair }. */
  _djKnoppen() {
    const id = this.engine.focus ?? null;
    const nr = id ? trackVanDeck(id) : null;
    if (!nr) return Array.from({ length: 8 }, () => ({ label: null, waarde: null, tekst: null }));
    if (this.pagina === 'strip') {
      return STRIP.map((s) => {
        const w = this.read(`track.${nr}.${s.actie}`);
        return w === null || w === undefined ? { label: s.label, waarde: null, tekst: null }
          : { label: s.label, waarde: w, tekst: s.tekst(w), bipolair: !!s.bipolair };
      });
    }
    if (this.pagina !== 'rack') return this._dataKnoppen();
    const fx = this.engine.deck?.(id)?.fx ?? null;
    return Array.from({ length: 8 }, (_, i) => {
      const k = i + 1;
      const label = fx?.plekNaam?.(k) ?? null;
      const w = label ? this.read(`track.${nr}.fx.knob.${k}`) : null;
      if (w === null || w === undefined) return { label: null, waarde: null, tekst: null };
      const bipolair = !!fx?.plekBipolair?.(k);
      return { label, waarde: w, bipolair, tekst: bipolair ? `${w >= 0.5 ? '+' : ''}${Math.round((w - 0.5) * 200)}%` : procent(w) };
    });
  }

  /**
   * De acht knoppen van een pagina uit data (laag pagina.<naam>): wat elke draaiknop NU doet (de
   * regel die de mapping kiest: die van de pagina, een houd-mapje dat vastzit, of de regel zonder
   * laag als de pagina die plek vrij laat), met zijn label (of de korte uitleg van zijn action), de
   * read, en in procenten (bipolair vanuit het midden als de action dat zegt). Geen regel: alleen
   * het nummer.
   */
  _dataKnoppen() {
    const vars = this.mapping.vars();
    return Array.from({ length: 8 }, (_, i) => {
      const r = this.mapping.kies(`cc:0:${ENCODER_CC + i}`, { shift: false });
      if (!r || (r.action.includes('{speel}') && !vars.speel)) return { label: null, waarde: null, tekst: null };
      const id = resolveTarget(r.action, vars);
      let label = r.label ?? null;
      if (!label) { try { label = this.beschrijf?.(id)?.kort ?? null; } catch (_) {} }
      label ??= id.split('.').slice(-2).join(' ');
      const w = this.mapping.read(id);
      if (typeof w !== 'number' || !Number.isFinite(w)) return { label, waarde: null, tekst: null };
      const bipolair = !!this.mapping.metaOf?.(id)?.bipolar;
      return { label, waarde: w, bipolair, tekst: bipolair ? `${w >= 0.5 ? '+' : ''}${Math.round((w - 0.5) * 200)}%` : procent(w) };
    });
  }

  /** Een pad naar de mapping (een padmodus uit data, of een houd-regel): loslaten gaat er ook heen. */
  _padNaarMapping(msg, noot) {
    const r = this.mapping.handle(msg);
    this.padVast.set(noot, r ? 'mapping' : 'kies');
    if (r) this.flits.set(noot, this.nu() + FLITS_MS);
    return !!r?.taken;
  }

  /**
   * Eén pad. Het loslaten gaat naar waar het indrukken heen ging (noten.js,
   * een stap- of sectie-action, of niets na een keuze), ook als de modus of de
   * focus intussen wisselde: een noot blijft zo nooit hangen.
   */
  _pad(msg) {
    const noot = msg.number;
    const naarNoten = () => !!this.noten?.ontvang({ ...msg, port: BRON, portName: BRON_NAAM });
    if (msg.type === 'poly') return this.padVast.get(noot) === 'noten' ? naarNoten() : false;
    if (!msg.on) {
      const waar = this.padVast.get(noot);
      this.padVast.delete(noot);
      if (waar === undefined || waar === 'noten') return naarNoten();
      if (waar === 'mapping') { this.mapping.handle(msg); return true; }
      if (waar !== 'kies') this.invoke(waar, false);
      return true;
    }
    if (this.padVast.has(noot)) this._pad({ ...msg, on: false, value: 0 });   // twee keer aan zonder uit
    const pad = padVanNoot(noot);
    const id = this.engine.speeltrack?.() ?? null;
    // Een houd-knop vast (DUPLICATE, SOLO …) met een regel op deze pad: die wint, in elke padmodus.
    if (this._houdRegel(msg.sig)) return this._padNaarMapping(msg, noot);
    if (this.patroonVast) {
      this.padVast.set(noot, 'kies');
      if (id && pad <= PLEKKEN && this.engine.patronen?.kies) { this.engine.patronen.kies(id, pad); this.bladzijde = 0; return true; }
      return false;
    }
    if (this.modus === 'sampler') {
      // Sampler-pad of sectie → pad (§5f); SHIFT = leegmaken. Loslaten naar dezelfde action.
      const action = samplerActie(pad, !!this.mapping.shift);
      this.padVast.set(noot, action);
      this.invoke(action, true);
      return true;
    }
    if (this.modus === 'secties') {
      // De sectie op deze pad van de focus-track, over de bus (op de maat, in het log). Ook
      // zonder sectie op die plek: dan zegt de bus waarom niet (actions.js, waaromNiet).
      // Voorbij de 40 (SECTIE_PADS, de laatste bladzijde) bestaat er geen action: niets.
      const t = this._sectieTrack();
      if (!t) return false;
      this._sectieBladen();                                 // de focus kan net gewisseld zijn (groep A–H)
      const k = this.sectieBlad * STAPPEN + pad;
      if (k > SECTIE_PADS) { this.padVast.set(noot, 'kies'); return false; }
      // In een werkruimte: SHIFT + pad = de sectie als loop, zoals op de APC (WERKRUIMTE.md A2).
      const action = `track.${t.nr}.section.${k}${this.delen && this.mapping.shift ? '.loop' : ''}`;
      this.padVast.set(noot, action);
      this.invoke(action, true);
      return true;
    }
    if (this.isDataPad(this.modus)) return this._padNaarMapping(msg, noot);
    if (this.modus === 'stappen') {
      if (!id) return false;
      const stap = this.bladzijde * STAPPEN + pad;
      const action = `track.${trackVanDeck(id)}.pattern.step.${stap}`;
      this.padVast.set(noot, action);
      this.invoke(action, true);
      return true;
    }
    this.flits.set(noot, this.nu() + FLITS_MS);
    this.padVast.set(noot, 'noten');
    return naarNoten();
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
    const nr = speel ? trackVanDeck(speel) : null;
    const plek = this.plek();
    // Een read 0..1 als paletkleur: null = uit, 0 = leeg (donkergrijs), 0,5 = gevuld (gedimd), 1 = aan (vol).
    const kleurVan = (r) => (r === null || r === undefined ? PALETTE.uit : r >= 0.75 ? VOL(inst.soort) : r >= 0.25 ? DONKER(inst.soort) : PALETTE.donkergrijs);
    if (inst && this.patroonVast) {
      // PATTERN vast: pad 1–5 = de vijf plekken (zoals de APC-modus patronen), de gekozen wit als hij niet speelt.
      for (let i = 0; i < 16; i++) {
        const r = i < PLEKKEN ? this.read(`track.${nr}.pattern.${i + 1}`) : null;
        const v = i >= PLEKKEN ? PALETTE.uit : i + 1 === plek && !(r >= 0.75) ? PALETTE.wit : kleurVan(r);
        uit.set(sleutel(PAD_KANAAL, PAD_NOOT + i), v);
      }
    } else if (this.modus === 'sampler' && !this.patroonVast) {
      // Sampler (§5f): violet zoals de modus sampler op de APC (feedback.js; §3: een pad heeft op beide
      // controllers dezelfde kleur). Sample: fel = speelt, donker = gevuld,
      // grijs = bewaard (terug te halen), wit = knipt nu, donkergrijs = leeg. Sectie: blauw = kan, wit =
      // ingedrukt, uit = kan niet. SHIFT vast: rood waar iets te wissen valt.
      const st = this.engine.sampler?.stand?.() ?? [];
      const shift = this.mapping.shift;
      for (let i = 0; i < 16; i++) {
        const { k, soort } = samplerPad(i + 1);
        let v = PALETTE.uit;
        if (shift) v = this.read(`sampler.${k}.clear`) >= 0.25 ? PALETTE.rooddonker : PALETTE.uit;
        else if (soort === 'sample') {
          const p = st[k - 1];
          v = !p ? PALETTE.uit : p.bezig ? PALETTE.wit : p.speelt ? PALETTE.violet : p.gevuld ? PALETTE.violetdonker : p.bewaard ? PALETTE.grijs : PALETTE.donkergrijs;
        } else {
          const r = this.read(`sampler.${k}.section`);
          v = r === null || r === undefined ? PALETTE.uit : r >= 0.75 ? PALETTE.wit : PALETTE.hemelsblauwdonker;
        }
        uit.set(sleutel(PAD_KANAAL, PAD_NOOT + i), v);
      }
    } else if (this.modus === 'secties' && !this.patroonVast) {
      // Secties van de focus-track (zoals de APC): wit = die hoor je (of drukt je in),
      // donker hemelsblauw = er is een sectie, uit = geen. Geen instrument nodig.
      const t = this._sectieTrack();
      this._sectieBladen();
      for (let i = 0; i < 16; i++) {
        const r = t ? this.read(`track.${t.nr}.section.${this.sectieBlad * STAPPEN + i + 1}`) : null;
        uit.set(sleutel(PAD_KANAAL, PAD_NOOT + i), r === null || r === undefined ? PALETTE.uit : r >= 0.75 ? PALETTE.wit : PALETTE.hemelsblauwdonker);
      }
    } else if (this.isDataPad(this.modus)) {
      // Een padmodus uit data: elke pad de read van zijn regel (zoals de LED-laag van de APC).
      for (let i = 0; i < 16; i++) uit.set(sleutel(PAD_KANAAL, PAD_NOOT + i), this._padKleur(this.mapping.kies(`note:${PAD_KANAAL}:${PAD_NOOT + i}`), PAD_NOOT + i, nu));
    } else if (inst && this.modus === 'stappen') {
      // Stapmodus: de read van elke stap; de stap die je nu hoort wit (alleen als het gekozen patroon speelt).
      const st = this.engine.patronen?.stand?.(speel) ?? null;
      const hoort = st && st.speelt === st.gekozen ? st.stap : null;
      for (let i = 0; i < 16; i++) {
        const stap = this.bladzijde * STAPPEN + i + 1;
        const r = this.read(`track.${nr}.pattern.step.${stap}`);
        uit.set(sleutel(PAD_KANAAL, PAD_NOOT + i), r !== null && hoort === stap - 1 ? PALETTE.wit : kleurVan(r));
      }
    } else {
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
    }
    // Een houd-knop vast met regels op pads: die pads in hun kleur (de rest blijft wat de padmodus zegt).
    if (this.houd && !this.houd.leeg) {
      for (let i = 0; i < 16; i++) {
        const r = this._houdRegel(`note:${PAD_KANAAL}:${PAD_NOOT + i}`);
        if (r) uit.set(sleutel(PAD_KANAAL, PAD_NOOT + i), this._padKleur(r, PAD_NOOT + i, nu));
      }
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
    const knop = (naam, v) => uit.set(sleutel(KNOP_KANAAL, knopNoot(naam)), v);
    knop('shift', this.mapping.shift ? HELDER.aan : HELDER.beschikbaar);
    knop('enter', this._kandidaat() ? HELDER.aan : HELDER.uit);
    // Patronen: alleen met een instrument op de speeltrack (en een patroonspeler).
    const pt = !!(inst && this.engine.patronen);
    // Een read als helderheid: null = uit, 1 = aan, 0,5 = half (gevuld, of knipperend: de read wisselt zelf), 0 = zacht.
    const helder = (r) => (r === null || r === undefined ? HELDER.uit : r >= 0.75 ? HELDER.aan : r >= 0.25 ? HELDER.half : HELDER.zacht);
    knop('step', !pt ? HELDER.uit : this.modus === 'stappen' ? HELDER.aan : HELDER.beschikbaar);
    knop('pattern', !pt ? HELDER.uit : this.patroonVast ? HELDER.aan : HELDER.beschikbaar);
    knop('play', pt ? helder(this.read(`track.${nr}.pattern.${plek}`)) : HELDER.uit);
    knop('restart', pt ? helder(this.read(`track.${nr}.pattern.stop`)) : HELDER.uit);
    knop('rec', pt ? (this.read('patterns.record') === 1 ? HELDER.aan : HELDER.beschikbaar) : HELDER.uit);
    knop('erase', pt ? helder(this.read(`track.${nr}.pattern.clear`)) : HELDER.uit);
    // Secties: zacht aan als de focus-track ze heeft, fel in de modus.
    knop('scene', this.modus === 'secties' ? HELDER.aan : this._sectieKaart() ? HELDER.beschikbaar : HELDER.uit);
    knop('sampling', !this.engine.sampler ? HELDER.uit : this.modus === 'sampler' ? HELDER.aan : HELDER.beschikbaar);
    const secties = this.modus === 'secties';
    const bladen = secties ? this._sectieBladen() : pt && this.modus === 'stappen' ? this._bladzijden() : 0;
    const blad = secties ? this.sectieBlad : this.bladzijde;
    knop('stapL', bladen && blad > 0 ? HELDER.half : HELDER.uit);
    knop('stapR', bladen && blad < bladen - 1 ? HELDER.half : HELDER.uit);
    if (this.modus === 'sampler') {
      // ◄ ► = minder/meer tellen: half zolang het die kant op nog kan.
      knop('stapL', this.read('sampler.length.down') != null ? HELDER.half : HELDER.uit);
      knop('stapR', this.read('sampler.length.up') != null ? HELDER.half : HELDER.uit);
    }
    // Knoppagina's: ◄ ► half als er die kant op een pagina is. CONTROL zacht, fel tijdens de uitleg.
    const paginas = this.paginas();
    const p = paginas.indexOf(this.pagina);
    knop('browseL', p > 0 ? HELDER.half : HELDER.uit);
    knop('browseR', p < paginas.length - 1 ? HELDER.half : HELDER.uit);
    // Knoppen met een regel uit een stuk of van jou (F1–F8, VOLUME, SOLO …): de read van wat ze nu doen.
    for (const naam of this._data().ledKnoppen) knop(naam, helder(this._leesRegel(this.mapping.kies(knopSig(naam)))));
    knop('control', this.uitleg ? HELDER.aan : HELDER.beschikbaar);
    // BROWSE: fel = library open (bladeren), zacht = kan; ◄ ► bij het wiel en ENTER doen dan iets.
    const lib = this.read('library.toggle');
    knop('browse', lib === null || lib === undefined ? HELDER.uit : lib === 1 ? HELDER.aan : HELDER.beschikbaar);
    // ◄ ► bij het wiel ALTIJD zetten: alleen met de library open hadden ze een stand, en na sluiten bleven ze half branden.
    const b = lib === 1 ? this.library?.bladerStand?.(BLADER_RIJEN) ?? null : null;
    knop('navL', b?.gekozen > 0 ? HELDER.half : HELDER.uit);
    knop('navR', b && b.gekozen < b.totaal - 1 ? HELDER.half : HELDER.uit);
    if (b) knop('enter', b.track ? HELDER.aan : HELDER.uit);
    if (this.uitleg) {
      // Tijdens de uitleg knippert wat iets doet (de groepen houden hun kleur).
      const fel = Math.floor(nu / KNIPPER_MS) % 2 === 0;
      for (const naam of KNOPPEN) {
        if (naam === 'wiel' || naam === 'control' || GROEPEN.includes(naam)) continue;
        const doetIets = UITLEG[naam] || this.mapping.kies(knopSig(naam), { shift: false }) || this.mapping.kies(knopSig(naam), { shift: true });
        if (doetIets) knop(naam, fel ? HELDER.aan : HELDER.zacht);
      }
    }
    return uit;
  }

  /**
   * De kleur van een pad met een regel (padmodus uit data, houd): null = uit, 1 = vol, 0,5 = donker,
   * 0 = donkergrijs (iets te doen). Kleur: `led.aan`/`led.uit` van de regel, anders de kleur van het
   * deel, anders wit. Een aanslag licht kort vol op (FLITS_MS), ook als de read niets zegt.
   */
  _padKleur(regel, noot, nu) {
    if (!regel) return PALETTE.uit;
    const r = this._leesRegel(regel);
    const naam = this.kleur && PALETTE[this.kleur] !== undefined ? this.kleur : 'wit';
    const aan = PALETTE[regel.led?.aan] ?? PALETTE[naam];
    const donker = PALETTE[regel.led?.uit] ?? PALETTE[`${naam}donker`] ?? PALETTE.donkergrijs;
    if ((this.flits.get(noot) ?? -Infinity) > nu || r >= 0.75) return aan;
    if (r === null || r === undefined) return PALETTE.uit;
    return r >= 0.25 ? donker : PALETTE.donkergrijs;
  }

  /**
   * De fasescoop en de getallen van de focus-track (src/uitlijn/reken.js, via de aanhaker), klein
   * gemaakt voor de sleutel van het scherm: ms op 0,25 ms, de nieuwste 32 tellen. Null zonder.
   */
  _uitlijnStand() {
    let u = null;
    // Alleen wat een scherm toont (review ronde 1): zonder getallen-scherm geen getallen (muziek Δ is duur).
    const wat = { vouw: this.scherm.includes('fasescoop'), getallen: this.scherm.includes('getallen') };
    try { u = this.uitlijn?.(this.engine.focus ?? null, wat) ?? null; } catch (_) { u = null; }
    if (!u) return { nr: trackVanDeck(this.engine.focus ?? null), vouw: null, getallen: null };
    const r4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 4) / 4 : null);
    const g = u.getallen;
    return {
      nr: trackVanDeck(this.engine.focus ?? null),
      vouw: u.vouw ? { bron: u.vouw.bron, punten: (u.vouw.punten ?? []).map((p) => ({ ms: r4(p.ms), k: p.k, tel: p.tel, wie: p.wie })) } : null,
      getallen: g && !wat.getallen ? { bpm: g.bpm ? Math.round(g.bpm * 100) / 100 : null } : g ? { bpm: g.bpm ? Math.round(g.bpm * 100) / 100 : null, grid: r4(g.grid), muziek: r4(g.muziek?.ms), drift: r4(g.drift), maat: g.maat ?? null,
        maatgever: !!g.maatgever, afwijking: g.afwijking ? r4(g.afwijking.ms) : null, wacht: g.wacht ? Math.round(g.wacht.maten * 10) / 10 : null } : null,
    };
  }

  /** Wat de schermen tonen (zie maschine-scherm.js). */
  stand() {
    const speel = this.engine.speeltrack?.() ?? null;
    const inst = speel ? this.engine.instrumentOp(speel) : null;
    const knoppen = this.pagina !== 'instrument' ? this._djKnoppen() : Array.from({ length: 8 }, (_, i) => {
      const p = inst?.params?.[i];
      if (!p) return { label: null, waarde: null, tekst: null };
      const w = inst.leesParam(i + 1);
      let tekst = null;
      try { tekst = p.eenheid ? p.eenheid(w) : null; } catch (_) { /* dan het percentage */ }
      return { label: p.label, waarde: w, tekst: tekst ?? `${Math.round((w ?? 0) * 100)}%` };
    });
    if (this.modus === 'sampler') {
      // Draaiknop 5 = het sampler-volume (laag `sampler`); 6–8 blijven van de pagina. Ook zonder sampler (de losse kaart): het label.
      const v = this.read('sampler.volume');
      knoppen[4] = { label: 'volume', waarde: v ?? null, tekst: v === null || v === undefined ? null : `${Math.round(v * 100)}%`, vast: true };
    }
    const f = this.engine.focus;
    const fi = this.engine.instrumentOp(f);
    const k = this._kandidaat();
    const nu = this.nu();
    // Het gekozen patroon op de speeltrack (stapmodus en PATTERN), uit de reads en de speler.
    let patroon = null;
    const pt = this.engine.patronen;
    if (inst && pt && (this.modus === 'stappen' || this.patroonVast)) {
      const nr = trackVanDeck(speel);
      const st = pt.stand?.(speel) ?? {};
      const plek = this.plek();
      const p = pt.patroon?.(speel, plek) ?? null;
      const bladen = this._bladzijden();
      patroon = {
        plek, lengte: p?.lengte ?? STAPPEN, swing: p?.swing ?? null,
        speelt: st.speelt === plek, wacht: st.wacht === plek, opnemen: this.read('patterns.record') === 1,
        bladzijde: this.bladzijde, bladzijden: bladen,
        stappen: Array.from({ length: STAPPEN }, (_, i) => this.read(`track.${nr}.pattern.step.${this.bladzijde * STAPPEN + i + 1}`)),
        hoort: st.speelt === st.gekozen && st.stap != null ? st.stap - this.bladzijde * STAPPEN : null,
        noot: nootNaam(st.laatsteNoot ?? pt.laatsteNoot?.(speel) ?? 60),
        plekken: Array.from({ length: PLEKKEN }, (_, i) => this.read(`track.${nr}.pattern.${i + 1}`)),
      };
    }
    return {
      modus: this.modus, patroonVast: this.patroonVast, patroon,
      secties: this.modus === 'secties' ? this._sectieStand() : null,
      speel: inst ? { nr: trackVanDeck(speel), naam: inst.naam } : null,
      focus: { nr: trackVanDeck(f), wat: fi ? fi.naam : this.engine.deck?.(f)?.buffer ? 'nummer' : 'leeg' },
      knoppen,
      kandidaat: k ? { naam: k.index === 0 ? 'geen' : INSTRUMENTEN[k.index - 1].naam } : null,
      shift: !!this.mapping.shift,
      melding: this.melding && this.melding.tot > nu ? this.melding.tekst : null,
      pagina: this.pagina, paginaNr: this.paginas().indexOf(this.pagina), paginas: this.paginas().length, paginaNaam: naamUitData(this.pagina),
      dj: this.pagina !== 'instrument' ? this._djStand() : null,
      gedraaid: this.gedraaid && this.gedraaid.tot > nu ? this.gedraaid.k : null,
      uitleg: this.uitleg ? { titel: this.uitleg.wat?.titel ?? null, tekst: this.uitleg.wat?.tekst ?? null } : null,
      sampler: this.modus === 'sampler' ? this._samplerStand() : null,
      bladeren: this.bladeren()
        ? { ...(this.library?.bladerStand?.(BLADER_RIJEN) ?? { gekozen: 0, totaal: 0, rijen: [], track: null }), focus: trackVanDeck(f ?? null) } : null,
      // Alleen in een werkruimte (anders staan ze er niet: dezelfde sleutel en dezelfde bytes als vroeger).
      ...(this.delen ? { delen: this.delen } : {}),
      ...(this.scherm ? { scherm: this.scherm, ...(this.scherm.some((x) => x === 'fasescoop' || x === 'getallen') ? { uitlijn: this._uitlijnStand() } : {}) } : {}),
    };
  }

  /**
   * De padmodus sampler voor het scherm (§5f): de 8 pads (wat erin zit, van welke track, speelt,
   * bewaard, knipt), de lengte, het volume, en welke sectie een sectie-pad nu zou pakken.
   */
  _samplerStand() {
    const s = this.engine.sampler;
    const id = this.engine.focus ?? null;
    const d = id ? this.engine.deck?.(id) ?? null : null;
    const k = d?.buffer && d.sectieKaart ? d.sectieKaart : null;
    const hier = k ? d.sectieHier : -1;
    return {
      pads: s?.stand?.() ?? [],
      tellen: s?.tellen ?? null,
      volume: s ? s.volume : null,
      focus: trackVanDeck(id),
      sectie: k && hier >= 0 && hier < k.aantal ? `${hier + 1} ${k.naam(hier)}` : null,
    };
  }

  /**
   * De modus secties voor het scherm: de focus-track, wat erop staat, de naam
   * per pad van deze bladzijde (null = geen sectie), welke branden (de read: die
   * je hoort of indrukt), de sectie die je HOORT (deck.sectieHier) en, als die
   * anders is, de sectie op de volgende "1" (deck.sectieOpDeMaat: een sprong in
   * de aanloop, of de volgende sectie in de laatste maat ervóór). "3 drop C".
   */
  _sectieStand() {
    const t = this._sectieTrack();
    if (!t) return null;
    const d = t.deck, k = this._sectieKaart();
    const fi = this.engine.instrumentOp?.(t.id);
    const bladen = this._sectieBladen(), blad = this.sectieBlad;
    const bestaat = (i) => !!k && i >= 0 && i < Math.min(k.aantal, SECTIE_PADS);
    // Wat je hoort of wat er komt: ook boven de 40 (een kaart met de hand mag tot 64), al staat het op geen pad.
    const metNr = (i) => (k && i >= 0 && i < k.aantal ? `${i + 1} ${k.naam(i)}` : null);
    const hier = k ? d.sectieHier : -1, opDeMaat = k ? d.sectieOpDeMaat : -1;
    return {
      nr: t.nr, wat: fi ? fi.naam : d?.buffer ? 'nummer' : 'leeg', aantal: k?.aantal ?? 0, blad, bladen,
      namen: Array.from({ length: STAPPEN }, (_, i) => (bestaat(blad * STAPPEN + i) ? k.naam(blad * STAPPEN + i) : null)),
      aan: Array.from({ length: STAPPEN }, (_, i) => this.read(`track.${t.nr}.section.${blad * STAPPEN + i + 1}`) >= 0.75),
      hoort: metNr(hier),
      naar: opDeMaat !== hier ? metNr(opDeMaat) : null,
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
    this._controleer();
    this._laatsteTik = this.nu();
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
      // Vlak na invoer sneller (SCHERM_SNEL_MS), anders hooguit eens per SCHERM_MS.
      const tussen = nu - this.schermWakker < SCHERM_MS ? SCHERM_SNEL_MS : SCHERM_MS;
      let stand = null, sleutelStand = null;
      for (const nr of [0, 1]) {
        if (nu - this.schermTijd[nr] < tussen) continue;
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

  /**
   * Na invoer zo snel mogelijk een tik (een microtaak, ná het verwerken van het
   * bericht), samengevoegd en hooguit één per WEK_MS. De tik stuurt alleen wat
   * veranderde, dus de gewone tik erna vindt niets dubbel. Gemeten pad ->
   * lampje: docs/verslagen/2026-10-14/controller-uitvoer.md (tools/bench/feedback.mjs).
   */
  wek() {
    if (this._wekker !== null) return;
    let mijn = null;
    const doe = () => {
      if (this._wekker !== mijn) return;
      this._wekker = null;
      this.wekTikken++;
      try { this.tik(); } catch (err) { console.warn('[maschine]', err); }
    };
    const wacht = WEK_MS - (this.nu() - this._laatsteTik);
    if (wacht <= 0) { mijn = {}; this._wekker = mijn; queueMicrotask(doe); }
    else { mijn = setTimeout(doe, wacht); this._wekker = mijn; }
  }

  /** Een geplande wektik weg. */
  stop() {
    if (this._wekker !== null) clearTimeout(this._wekker);
    this._wekker = null;
  }
}

/**
 * De Maschine als apparaat van de werkruimte (werkruimte S3/S6, src/werk/apparaten.js):
 * `registreerApparaat('maschine-mk2', maakMaschineAdapter(maschine))` (de aanhaker doet dat).
 *
 *   zetMapjes({ pads, pagina, wiel, scherm })   pads: spelen · stap · secties · sampler (code) of een
 *            padmodus uit data; pagina: instrument · strip · rack of een uit data; wiel: instrument
 *            (= het oude gedrag), bladeren (= ook het oude gedrag: het wiel bladert zodra de library
 *            open is) of een wiel-mapje uit data; scherm: per scherm wat het toont (['strip', 'fasescoop']).
 *            Wat er niet is, staat in `niet` (een deel zet nooit iets half).
 *   mapjes()  wat er nu open staat (voor onthoud en vastleggen)
 *   standaard()  THUIS: spelen, Instrument, het oude wiel, de schermen zoals altijd, en wat de Maschine
 *            aan houd-mapjes vasthield dicht. Een pad die nog vastzit laat later los waar hij indrukte.
 *
 * Een deelwissel raakt geen klank: alleen de stand van de Maschine (geen invoke).
 */
export function maakMaschineAdapter(m, { naam = 'Maschine' } = {}) {
  const werkNaam = (modus) => (modus === 'stappen' ? 'stap' : modus);
  const zetEen = (groep, waarde) => {
    switch (groep) {
      case 'pads': {
        const doel = waarde === null || waarde === undefined ? 'spelen' : WERK_PADMODUS[waarde] ?? waarde;
        if (doel !== 'spelen' && !CODE_PADMODI.includes(doel) && !m.isDataPad(doel)) return false;
        m.patroonVast = false;
        m.zetModus(doel);
        return m.modus === doel;
      }
      case 'pagina': return m.pagina === (waarde ?? 'instrument') || m.zetPagina(waarde ?? 'instrument');
      case 'wiel': {
        if (waarde === null || waarde === undefined || waarde === 'instrument' || waarde === 'bladeren') { m.wiel = null; return true; }
        if (!m._data().wielen.includes(waarde)) return false;
        m.wiel = waarde;
        return true;
      }
      case 'scherm':
        m.scherm = Array.isArray(waarde) && waarde.length ? waarde.filter((x) => typeof x === 'string').slice(0, 2) : null;
        return true;
      default: return false;
    }
  };
  return {
    naam, mapping: m.mapping,
    zetMapjes(def = {}) {
      m._controleer();   // een padmodus/pagina/wiel van een weggehaald stuk telt niet meer (review ronde 1)
      const gezet = [], niet = [];
      for (const [g, w] of Object.entries(def ?? {})) (zetEen(g, w) ? gezet : niet).push(`${g}.${Array.isArray(w) ? w.join('+') : w}`);
      m.gedraaid = null;
      m.wek?.();
      return { gezet, niet };
    },
    mapjes: () => (m._controleer(), { pads: werkNaam(m.modus), pagina: m.pagina, wiel: m.wiel ?? 'instrument', scherm: m.scherm ? [...m.scherm] : null }),
    standaard() {
      m.patroonVast = false;
      m.zetModus('spelen');
      m.zetPagina('instrument');
      m.wiel = null;
      m.scherm = null;
      m.houd?.losgekoppeld(m.mapping._wie);
      m.wek?.();
      return { gezet: ['pads.spelen', 'pagina.instrument', 'wiel.instrument'], niet: [] };
    },
    stil: (fn) => fn(),
    aanwezig: () => m.poort?.in?.state === 'connected',
  };
}

function gelijk(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

