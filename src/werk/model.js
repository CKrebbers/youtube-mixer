/**
 * DE WERKRUIMTE ALS DATA (14 okt 2026, werkruimte S3, docs/WERKRUIMTE.md B2–B4,
 * docs/werkruimte/S3.md).
 *
 * Een werkruimte zegt WAAR alles zit: per deel (MIX, UITLIJN, FX …) welke
 * mapjes open gaan op welk apparaat, welke rijen en panelen op welk scherm, en
 * welke extra knoppen (stukken, eigen regels) erbij komen. Een deel kiezen zet
 * alleen mapjes, panelen en rijen; nooit een klank (Clay, punt 1 en 6).
 *
 * Dit bestand is het FORMAAT (schema 1), puur: geen imports, geen DOM, geen
 * schijf. De mixer (src/werk/werkruimte.js), de server (server/werkruimtes.js)
 * en de tests gebruiken dezelfde regels, zodat niemand van mening verschilt
 * over wat een werkruimte is. Wat het model van buiten moet weten (de
 * standaardmappings, de stukken, welke mapjes er zijn) krijgt het mee; zonder
 * dat valt het terug op de kopieën hieronder (STANDAARD_MAPJES), die de test
 * naast lagen.js en feedback.js legt.
 *
 * Fouten en waarschuwingen staan apart:
 *   fout          het bestand klopt niet; opslaan weigert (400), en wat fout is
 *                 staat niet in de genormaliseerde werkruimte.
 *   waarschuwing  iets is onbekend (een stuk dat er nog niet is, een mapje dat
 *                 dit apparaat niet kent): overgeslagen, nooit geraden.
 *
 * Wat een werkruimte NOOIT kan (WERKRUIMTE.md A12): iets weghalen of verbergen
 * (verberg, uit, acties …: fout), een regel op de kern zetten, een houd-, druk-
 * of latch-regel op play/cue/op de maat/hotcues/laden/mapjes, of een mapje
 * onbereikbaar maken.
 */

export const SCHEMA = 1;
/** Een werkruimtenaam is ook een bestandsnaam: kleine letters, cijfers, - en _ (zoals standen). */
export const NAAM = /^[a-z0-9_-]{1,60}$/;
export const NAAM_UITLEG = 'een werkruimtenaam is kleine letters, cijfers, - en _ (hooguit 60; niet actief of terug)';
export const GERESERVEERD = new Set(['actief', 'terug']);
export const naamGeldig = (n) => typeof n === 'string' && NAAM.test(n) && !GERESERVEERD.has(n);

export const MAX_TITEL = 60;
export const MAX_UITLEG = 300;
export const MAX_DELEN = 8;
export const MAX_LABEL = 8;
export const DEEL_NAAM = /^[a-z]{2,16}$/;
/** Deelnamen die al een action zijn (werk.deel.next/prev). */
export const GERESERVEERDE_DELEN = Object.freeze(['next', 'prev']);
export const MAX_SUPER = 16;
export const MAX_LINKS = 32;
export const MAX_NIEUW = 12;   // nieuwe plekken per proefavond (A11): erboven een waarschuwing
export const MAX_BYTES = 256 * 1024;

/** De apparaten die een werkruimte kan noemen (vereist, terugval, delen, regels). */
export const APPARATEN = Object.freeze(['apc40mk2', 'maschine-mk2', 'xboard49', 'lpd8', 'hub']);
/** Wie mapjes heeft die een deel kan openzetten, en welke groepen dat zijn. */
export const DEEL_GROEPEN = Object.freeze({ apc40mk2: Object.freeze(['grid', 'device']), 'maschine-mk2': Object.freeze(['pads', 'pagina', 'wiel', 'scherm']) });
/** In welke groep een werkruimte of stuk een NIEUW mapje mag zetten (B3). */
export const NIEUW_GROEPEN = Object.freeze({ apc40mk2: Object.freeze(['device', 'grid', 'houd']), 'maschine-mk2': Object.freeze(['pads', 'pagina', 'houd']) });
/** Wie regels heeft (een mapping). */
export const REGEL_APPARATEN = Object.freeze(['apc40mk2', 'maschine-mk2', 'xboard49']);

/** De condities van een deel ({ als, dan, anders }): een vaste witte lijst, geen expressies. */
export const CONDITIES = Object.freeze(['focus.instrument', 'focus.nummer', 'focus.stems', 'focus.leeg', 'speel.instrument', 'hub',
  ...APPARATEN.map((a) => `apparaat.${a}`)]);
export const KIEZEN = Object.freeze(['expliciet', 'volgt']);

/** De rijen onder de mixer (rijen.js) en de onderpanelen die een deel kan openzetten. */
export const RIJEN = Object.freeze(['auto', 'beeld', 'instrument', 'klankschaal', 'koptelefoon', 'master', 'stems', 'patronen']);
export const ONDERPANELEN = Object.freeze(['library']);
export const SCHERM_NAAM = /^[a-z0-9-]{1,16}$/;
export const SCHERM_SOORTEN = Object.freeze(['mixer', 'venster', 'ipad']);
export const PANEEL_SOORTEN = Object.freeze(['draai', 'knop', 'schuif', 'lamp', 'xy', 'rij', 'tekst']);
export const PANEEL_NAAM = /^[a-z0-9-]{1,32}$/;
export const CURVES = Object.freeze(['lin', 'exp', 'log', 's']);   // = CURVES in src/engine/rack.js (de test vergelijkt)

/**
 * Wat geen scherm buiten de Mac ooit mag, wat een werkruimte ook zegt (C4): opnemen,
 * het log, mappings, werkruimtes kiezen en opslaan, de library en laden. `*` = willekeurige
 * tekens, ook punten (`*.load*` vangt track.3.load.selected).
 */
export const VAST_NOOIT = Object.freeze(['record.*', 'log.*', 'mapping.*', 'werk.kies', 'werk.opslaan', 'werk.terug', 'werk.vastleggen', 'library.*', '*.load*']);

/** Velden die nergens mogen: een werkruimte zet mapjes en panelen, geen standen, adressen of uitzetters. */
export const VERBODEN = Object.freeze(['uit', 'verberg', 'acties', 'pijlers', 'opname', 'knopstanden', 'standen', 'waarden',
  'posities', 'positie', 'adres', 'adressen', 'url', 'relay']);
/** Daarbij op het hoogste niveau: `start` (een werkruimte start niets; `deel.start` mag wel). */
const VERBODEN_BOVEN = Object.freeze([...VERBODEN, 'start']);
const VELDEN = Object.freeze(['schema', 'naam', 'titel', 'uitleg', 'vereist', 'terugval', 'stukken', 'deel', 'mapjes', 'delen', 'volgt',
  'regels', 'superknoppen', 'bussen', 'panelen', 'schermen']);

/** De modi van een regel: die van mapping.js plus die van B5 (druk, latch, stappen: S4 bouwt ze in de mapping). */
export const MODES = Object.freeze(['trigger', 'absolute', 'relative-2c', 'relative-bin', 'endless', 'druk', 'latch', 'stappen']);

/** De namen van het APC-palet (= Object.keys(PALETTE) in src/control/devices/apc40mk2.js; de test vergelijkt). */
export const PALET = Object.freeze(['uit', 'donkergrijs', 'grijs', 'wit', 'rood', 'roodzacht', 'rooddonker', 'oranje', 'oranjezacht', 'oranjedonker',
  'geel', 'geelzacht', 'geeldonker', 'limoen', 'limoendonker', 'groen', 'groenzacht', 'groendonker', 'mint', 'zeegroen', 'zeegroendonker',
  'cyaan', 'cyaanzacht', 'cyaandonker', 'blauw', 'blauwzacht', 'blauwdonker', 'hemelsblauw', 'hemelsblauwdonker',
  'violet', 'violetzacht', 'violetdonker', 'magenta', 'magentadonker', 'roze', 'rozedonker']);

/** De kleur van een grid-mapje op de APC (= de `aan`-kleur van layer.grid.* in feedback.js; de test vergelijkt). */
export const GRID_KLEUR = Object.freeze({ hotcues: 'geel', loops: 'cyaan', sampler: 'violet', video: 'blauw', klank: 'magenta',
  auto: 'limoen', stems: 'zeegroen', patronen: 'oranje', secties: 'hemelsblauw' });

/**
 * De mapjes die er vandaag zijn, per apparaat en groep: { laag: { kiesknop: bool } }, plus de
 * standaard en de volgorde van ▲ ▼. APC: = GROEPEN in lagen.js (vorm alleen met ?vormen=1; de test
 * vergelijkt). Maschine: de namen uit het ontwerp (A3, B2); S6 bouwt ze, tot dan doet een deel
 * daar niets mee.
 */
const m = (namen, kiesknop = true) => Object.fromEntries(namen.map((n) => [n, { kiesknop }]));
export const STANDAARD_MAPJES = Object.freeze({
  apc40mk2: {
    edit: { standaard: 'uit', mapjes: m(['uit', 'aan']) },
    device: { standaard: 'strip', mapjes: m(['strip', 'rack', 'inst', 'master', 'beeld', 'vorm']) },
    grid: { standaard: 'hotcues', mapjes: m(['hotcues', 'loops', 'sampler', 'video', 'klank', 'auto', 'stems', 'patronen', 'secties']),
      volgorde: ['hotcues', 'loops', 'sampler', 'video', 'klank', 'auto', 'stems', 'patronen', 'secties'] },
    // De houd-mapjes van S4 (lagen.js, groep houd): geen stand en geen eigen mapjes; een stuk of
    // werkruimte zet ze erbij (NIEUW_GROEPEN), met de kiesknop = het mapje zelf.
    houd: { standaard: null, mapjes: {} },
  },
  'maschine-mk2': {
    pads: { standaard: 'spelen', mapjes: m(['spelen', 'transport', 'uitlijn', 'worpen', 'stems', 'secties', 'sampler', 'beeld', 'laden', 'stap']) },
    pagina: { standaard: 'instrument', mapjes: m(['instrument', 'strip', 'rack', 'uitlijn', 'stems', 'beeld', 'super']) },
    wiel: { standaard: 'instrument', mapjes: m(['instrument', 'jog', 'rack', 'sectie', 'mengvorm', 'bladeren']) },
    scherm: { standaard: 'instrument', mapjes: m(['instrument', 'strip', 'fasescoop', 'getallen', 'rack', 'super', 'stems', 'secties', 'beeld', 'blader']) },
  },
});

/**
 * Een `bekend` (zie STANDAARD_MAPJES) uit de GROEPEN van lagen.js, zoals ze NU zijn: wat er van
 * buiten bij kwam (een stuk) staat er dan ook in. De Maschine blijft de kopie hierboven.
 */
export function bekendUitGroepen(groepen) {
  const apc = {};
  for (const [g, d] of Object.entries(groepen ?? {})) {
    const mapjes = {};
    for (const lijst of Object.values(d.knoppen ?? {})) for (const l of lijst) mapjes[l] = { kiesknop: true };
    if (d.standaard && !mapjes[d.standaard]) mapjes[d.standaard] = { kiesknop: !!d.schakel };
    for (const l of d.volgorde ?? []) mapjes[l] ??= { kiesknop: false };
    apc[g] = { standaard: d.standaard, mapjes, ...(d.volgorde ? { volgorde: [...d.volgorde] } : {}) };
  }
  return { ...kopieBekend(STANDAARD_MAPJES), apc40mk2: apc };
}

const kopieBekend = (b) => JSON.parse(JSON.stringify(b));

/**
 * De KERN (A2): wat in elke werkruimte en elk deel hetzelfde doet. Een regel van een stuk of een
 * werkruimte op deze knoppen wordt geweigerd, met of zonder mapje (in een mapje zou hij de kern
 * overschrijven zolang dat mapje open staat). Per control de signature; `shift: true` = ook de
 * shift-variant is kern (⇧ cue, ⇧ tap …, en alles wat draait: een fader blijft een fader met
 * shift vast). Een knop met `shift: false` heeft een vrije shift-plek (⇧ master-knop = THUIS,
 * ⇧ A|B = thru, ⇧ Lock = uitlijn).
 */
function kernApc() {
  const k = [];
  for (let ch = 0; ch < 8; ch++) {
    k.push([`cc:${ch}:7`, true], [`cc:0:${48 + ch}`, true]);                        // fader, trackknop (filter)
    k.push([`note:${ch}:48`, true], [`note:${ch}:49`, true], [`note:${ch}:50`, true]); // ● (⇧ cue), S (⇧ tap), ▶ (⇧ op de maat)
    k.push([`note:${ch}:51`, true], [`note:${ch}:52`, true], [`note:${ch}:66`, false]); // Track Select, Clip Stop, A|B
  }
  k.push(['cc:0:14', true], ['cc:0:15', true], ['cc:0:13', true], ['cc:0:47', true]);  // master, crossfader, tempo, Cue Level
  k.push(['note:0:100', true], ['note:0:101', true], ['note:0:99', true]);              // Nudge ±, Tap
  k.push(['note:0:87', false], ['note:0:88', false], ['note:0:89', false]);             // Pan / Sends / User = loop in/out/reloop
  k.push(['note:0:63', false], ['note:0:81', false], ['note:0:91', false], ['note:0:93', true]);   // Lock, Stop All, Play, Record
  k.push(['note:0:80', false], ['note:0:96', false], ['note:0:97', false], ['note:0:98', true]);   // master-knop, ◀ ▶ focus, shift
  return k;
}
/** De Maschine (A2): CONTROL, STEP, BROWSE, SAMPLING, ◄ ► links boven, groep A–H, SHIFT, SCENE (maschine.js zelf). */
const kernMaschine = () => [8, 9, 10, 11, 12, 13, 24, 25, 26, 27, 28, 29, 30, 31, 39, 40].map((n) => [`note:1:${n}`, true]);

export const KERN = Object.freeze({ apc40mk2: Object.freeze(kernApc()), 'maschine-mk2': Object.freeze(kernMaschine()) });

/** Is deze plek (signature + shift) kern op dit apparaat? */
export function isKern(apparaat, sig, shift) {
  const lijst = KERN[apparaat];
  if (!lijst) return false;
  for (const [s, ookShift] of lijst) if (s === sig && (!shift || ookShift)) return true;
  return false;
}

/** Acties die nooit achter een houd-, druk- of latch-regel mogen (B3, C5: tijdkritisch). */
export const BESCHERMD = /^(track\.[^.]+\.(play|cue|play\.quant|hotcue\..+|load\..+)|layer\..+)$/;

const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const bytes = (s) => new TextEncoder().encode(s).length;
const SIG = /^([a-z]+:(\*|\d+):\d+|[a-z-]+)$/;
// = sleutelVan in mapping.js, ook met de conditie (`?als`, S4): op één knop mag een regel met en een zonder `als`.
const sleutel = (r) => `${r.in}${r.shift ? '#shift' : ''}${r.laag ? `@${r.laag}` : ''}${r.als ? `?${r.als}` : ''}`;
/** De plek zonder conditie: een regel met `als` op een plek van de standaard verandert de standaard (B1). */
const plek = (r) => `${r.in}${r.shift ? '#shift' : ''}${r.laag ? `@${r.laag}` : ''}`;

/** Een patroon met `*` (willekeurige tekens) als RegExp. */
export function patroon(p) {
  return new RegExp(`^${String(p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}
const PATROON = /^[a-z0-9{}*._-]{1,80}$/i;

/**
 * Mag dit scherm deze action uitvoeren? `nooit` wint, de vaste lijst wint altijd; zonder `mag`
 * niets. Voor S7/S8 (de iPad); het model zegt het, de mixer handhaaft het.
 */
export function magOpScherm(werkruimte, scherm, action) {
  const s = werkruimte?.schermen?.[scherm];
  if (!s || typeof action !== 'string') return false;
  if ([...VAST_NOOIT, ...(s.nooit ?? [])].some((p) => patroon(p).test(action))) return false;
  return (s.mag ?? []).some((p) => patroon(p).test(action));
}

// ---- mapjes ----------------------------------------------------------------------------------

/** 'groep.laag' of 'apparaat.groep.laag' (een stuk, B4) -> { apparaat, groep, laag } of null. */
export function leesMapjeSleutel(s, standaardApparaat = 'apc40mk2') {
  if (typeof s !== 'string') return null;
  const d = s.split('.');
  if (d.length === 3 && APPARATEN.includes(d[0])) return { apparaat: d[0], groep: d[1], laag: d[2] };
  if (d.length === 2) return { apparaat: standaardApparaat, groep: d[0], laag: d[1] };
  return null;
}

/** De mapjes die een stuk of werkruimte erbij zet, genormaliseerd. Geeft { mapjes: [...], fouten, waarschuwingen }. */
function leesNieuweMapjes(nieuw, { bekend, waar }) {
  const uit = [], fouten = [], waarschuwingen = [];
  if (nieuw === undefined) return { mapjes: uit, fouten, waarschuwingen };
  if (!isObject(nieuw)) { fouten.push(`${waar}: mapjes.nieuw is een object ({ "device.mijndub": { … } })`); return { mapjes: uit, fouten, waarschuwingen }; }
  for (const [k, def] of Object.entries(nieuw)) {
    const s = leesMapjeSleutel(k);
    if (!s) { fouten.push(`${waar}: mapje "${k}" is "groep.laag" of "apparaat.groep.laag"`); continue; }
    const { apparaat, groep, laag } = s;
    if (!NIEUW_GROEPEN[apparaat]?.includes(groep)) {
      fouten.push(`${waar}: een nieuw mapje kan alleen in ${(NIEUW_GROEPEN[apparaat] ?? []).join(', ') || '(geen groep)'} van ${apparaat}, niet in "${groep}"`); continue;
    }
    if (!/^[a-z0-9-]{1,32}$/.test(laag)) { fouten.push(`${waar}: "${laag}" is geen mapjesnaam (a-z, 0-9, -)`); continue; }
    if (bekend?.[apparaat]?.[groep]?.mapjes?.[laag]) { fouten.push(`${waar}: het mapje ${groep}.${laag} bestaat al`); continue; }
    if (!isObject(def)) { fouten.push(`${waar}: mapje ${k} is { naam, kiesknop, kleur }`); continue; }
    let kiesknop = null;
    if (def.kiesknop !== null && def.kiesknop !== undefined) {
      if (!isObject(def.kiesknop) || typeof def.kiesknop.in !== 'string' || !SIG.test(def.kiesknop.in)) {
        fouten.push(`${waar}: de kiesknop van ${k} is { "in": "note:0:58", "shift": true } of null`); continue;
      }
      kiesknop = { in: def.kiesknop.in, ...(def.kiesknop.shift ? { shift: true } : {}) };
    } else if (def.kiesknop === undefined) {
      fouten.push(`${waar}: mapje ${k} heeft een kiesknop nodig ({ in, shift }) of uitdrukkelijk null (alleen via een deel)`); continue;
    }
    if (def.kleur !== undefined && !PALET.includes(def.kleur)) { waarschuwingen.push(`${waar}: kleur "${def.kleur}" van ${k} staat niet in het APC-palet`); }
    uit.push({ apparaat, groep, laag, naam: typeof def.naam === 'string' ? def.naam.slice(0, 80) : `${groep}.${laag}`,
      kiesknop, ...(PALET.includes(def.kleur) ? { kleur: def.kleur } : {}) });
  }
  return { mapjes: uit, fouten, waarschuwingen };
}

/** Voeg mapjes toe aan een kopie van `bekend`. */
function metMapjes(bekend, mapjes) {
  const b = kopieBekend(bekend);
  for (const mj of mapjes) {
    const g = ((b[mj.apparaat] ??= {})[mj.groep] ??= { standaard: null, mapjes: {} });
    g.mapjes[mj.laag] = { kiesknop: !!mj.kiesknop, ...(mj.kleur ? { kleur: mj.kleur } : {}) };
  }
  return b;
}

/** De kleur van een mapje: uit een stuk of werkruimte, anders die van de APC (GRID_KLEUR). */
function mapjeKleur(bekend, apparaat, groep, laag) {
  const k = bekend?.[apparaat]?.[groep]?.mapjes?.[laag]?.kleur;
  if (k) return k;
  return apparaat === 'apc40mk2' && groep === 'grid' ? GRID_KLEUR[laag] ?? null : null;
}

// ---- regels ----------------------------------------------------------------------------------

/**
 * Regels van één apparaat (een stuk of een werkruimte) controleren.
 * @param standaardSleutels Set met de sleutels van de standaardmapping (vrije plekken), of null
 * @param eigenMapjes       Set 'groep.laag' van de nieuwe mapjes (van dit stuk/deze werkruimte en de stukken)
 * Geeft { regels, fouten, waarschuwingen }; een foute regel staat niet in `regels`.
 */
export function leesRegels(lijst, { apparaat, waar, standaardSleutels = null, eigenMapjes = new Set(), bekend = null }) {
  const regels = [], fouten = [], waarschuwingen = [];
  if (lijst === undefined) return { regels, fouten, waarschuwingen };
  if (!Array.isArray(lijst)) { fouten.push(`${waar}: regels.${apparaat} is een lijst`); return { regels, fouten, waarschuwingen }; }
  const gezien = new Set();
  lijst.forEach((r, i) => {
    const w = `${waar}: regel ${i + 1} (${apparaat})`;
    if (!isObject(r) || typeof r.in !== 'string' || typeof r.action !== 'string') { fouten.push(`${w}: "in" en "action" zijn verplicht`); return; }
    if (!SIG.test(r.in)) { fouten.push(`${w}: "${r.in}" is geen signature (type:kanaal:nummer)`); return; }
    if (!/^[\w.{}*-]{1,120}$/.test(r.action)) { fouten.push(`${w}: "${r.action}" is geen action`); return; }
    const mode = r.mode ?? 'trigger';
    if (!MODES.includes(mode)) { fouten.push(`${w}: onbekende modus "${mode}" (wel: ${MODES.join(', ')})`); return; }
    for (const v of VERBODEN) if (v in r) { fouten.push(`${w}: veld "${v}" hoort niet in een regel`); return; }
    const regel = { in: r.in, action: r.action, mode };
    if (r.shift) regel.shift = true;
    if (r.laag !== undefined) {
      const l = typeof r.laag === 'string' ? r.laag.split('.') : [];
      if (l.length !== 2) { fouten.push(`${w}: laag is "groep.mapje"`); return; }
      regel.laag = r.laag;
    }
    if (mode === 'druk' || mode === 'latch') {
      if (!(typeof r.naar === 'number' && r.naar >= 0 && r.naar <= 1)) { fouten.push(`${w}: ${mode} heeft "naar" nodig (0..1, regel 2)`); return; }
      regel.naar = r.naar;
    } else if ('naar' in r) { waarschuwingen.push(`${w}: "naar" telt alleen bij druk of latch`); }
    if ('lang' in r) {
      // true = de 400 ms van mapping.js (LANG_MS), zoals een regel in de mapping het ook mag zeggen.
      if (!(r.lang === true || (Number.isFinite(r.lang) && r.lang >= 100 && r.lang <= 2000)) || (mode !== 'druk' && mode !== 'latch')) {
        fouten.push(`${w}: "lang" is 100..2000 ms (of true = 400), bij druk of latch`); return;
      }
      regel.lang = r.lang;
    }
    if ('codering' in r) {
      // Stappen (S4): tweecomplement (standaard) of binary offset. Zonder dit veld las een "bin"-encoder verkeerd om.
      if (mode !== 'stappen' || !['2c', 'bin'].includes(r.codering)) { fouten.push(`${w}: "codering" is "2c" of "bin", alleen bij stappen`); return; }
      regel.codering = r.codering;
    }
    if ('als' in r) {
      if (!CONDITIES.includes(r.als)) { fouten.push(`${w}: conditie "${r.als}" staat niet op de lijst (${CONDITIES.join(', ')})`); return; }
      regel.als = r.als;
    }
    for (const k of ['invert']) if (r[k]) regel[k] = true;
    for (const k of ['step', 'takeover']) if (typeof r[k] === 'number' && isFinite(r[k])) regel[k] = r[k];
    if (typeof r.label === 'string') regel.label = r.label.slice(0, 80);
    if (isObject(r.led)) regel.led = { ...r.led };
    if ('modifier' in r) { fouten.push(`${w}: "modifier" bestaat niet in v1 (gebruik een houd-mapje, B5)`); return; }

    // De kern: nooit, in geen enkel mapje (A2, B3).
    if (isKern(apparaat, regel.in, !!regel.shift)) { fouten.push(`${w}: ${regel.in}${regel.shift ? ' + shift' : ''} is de kern; daar komt geen regel op`); return; }
    // Geen houd-, druk- of latch-regel op wat tijdkritisch is (C5).
    const houd = regel.laag?.startsWith('houd.') || mode === 'druk' || mode === 'latch' || 'lang' in regel;
    if (houd && BESCHERMD.test(regel.action)) {
      fouten.push(`${w}: ${regel.action} mag niet achter een ${regel.laag?.startsWith('houd.') ? 'houd-mapje' : mode}-regel (play, cue, op de maat, hotcues, laden en mapjes zijn tijdkritisch)`); return;
    }
    const k = sleutel(regel);
    if (gezien.has(k)) { fouten.push(`${w}: "${k}" staat er twee keer in`); return; }
    // Alleen vrije plekken of eigen/nieuwe mapjes (B1: de standaard blijft bit voor bit).
    if (standaardSleutels?.has(plek(regel))) { fouten.push(`${w}: "${k}" is al bezet in de standaardmapping; een stuk of werkruimte gebruikt alleen vrije plekken`); return; }
    if (regel.laag && !eigenMapjes.has(regel.laag)) {
      const [g, l] = regel.laag.split('.');
      if (bekend && !bekend[apparaat]?.[g]?.mapjes?.[l]) { waarschuwingen.push(`${w}: onbekend mapje ${regel.laag}: overgeslagen`); return; }
    }
    gezien.add(k);
    regels.push(regel);
  });
  return { regels, fouten, waarschuwingen };
}

/** De sleutels van een mapping-document (de standaard van een apparaat). */
export const sleutelsVan = (doc) => new Set((Array.isArray(doc?.rules) ? doc.rules : []).filter((r) => r && typeof r.in === 'string').map(sleutel));

// ---- een stuk (B4) ---------------------------------------------------------------------------

/**
 * Een stuk (mappings/stukken/<naam>.json) controleren: dezelfde velden als het regel-/mapjesdeel
 * van een werkruimte, zonder delen en schermen. Geeft { stuk, fouten, waarschuwingen }.
 */
export function normaliseerStuk(ruw, { standaarden = {}, bekend = STANDAARD_MAPJES } = {}) {
  const fouten = [], waarschuwingen = [];
  if (!isObject(ruw)) return { stuk: null, fouten: ['een stuk is een JSON-object'], waarschuwingen };
  if (ruw.schema !== SCHEMA) return { stuk: null, fouten: [`een stuk heeft schema ${SCHEMA}`], waarschuwingen };
  if (!naamGeldig(ruw.stuk)) return { stuk: null, fouten: ['een stuk heeft een naam ("stuk": kleine letters, cijfers, - en _)'], waarschuwingen };
  const waar = `stuk ${ruw.stuk}`;
  for (const v of ['delen', 'schermen', ...VERBODEN_BOVEN]) if (v in ruw) fouten.push(`${waar}: veld "${v}" hoort niet in een stuk`);
  const nm = leesNieuweMapjes(ruw.mapjes?.nieuw, { bekend, waar });
  fouten.push(...nm.fouten); waarschuwingen.push(...nm.waarschuwingen);
  const b = metMapjes(bekend, nm.mapjes);
  const regels = {};
  for (const [app, lijst] of Object.entries(ruw.regels ?? {})) {
    if (!REGEL_APPARATEN.includes(app)) { waarschuwingen.push(`${waar}: apparaat "${app}" kent geen regels: overgeslagen`); continue; }
    const eigen = new Set(nm.mapjes.filter((x) => x.apparaat === app).map((x) => `${x.groep}.${x.laag}`));
    const r = leesRegels(lijst, { apparaat: app, waar, standaardSleutels: standaarden[app] ? sleutelsVan(standaarden[app]) : null, eigenMapjes: eigen, bekend: b });
    fouten.push(...r.fouten); waarschuwingen.push(...r.waarschuwingen);
    if (r.regels.length) regels[app] = r.regels;
  }
  return { stuk: { schema: SCHEMA, stuk: ruw.stuk, titel: typeof ruw.titel === 'string' ? ruw.titel.slice(0, MAX_TITEL) : ruw.stuk, mapjes: nm.mapjes, regels }, fouten, waarschuwingen };
}

// ---- de werkruimte (B2, B3) ------------------------------------------------------------------

/** Een deel per apparaat: { groep: mapje | { als, dan, anders } }. */
function leesDeelApparaat(def, { apparaat, bekend, waar, fouten, waarschuwingen }) {
  const groepen = DEEL_GROEPEN[apparaat];
  const uit = {};
  if (!isObject(def)) { fouten.push(`${waar}: ${apparaat} is een object ({ "grid": "stems" })`); return uit; }
  for (const [g, w] of Object.entries(def)) {
    if (!groepen.includes(g)) { waarschuwingen.push(`${waar}: ${apparaat} kent geen groep "${g}": overgeslagen`); continue; }
    if (g === 'scherm') {
      const lijst = Array.isArray(w) ? w : [w];
      const goed = lijst.filter((s) => typeof s === 'string' && (bekend?.[apparaat]?.scherm?.mapjes?.[s] || (waarschuwingen.push(`${waar}: onbekend scherm "${s}": overgeslagen`), false)));
      if (goed.length) uit.scherm = goed.slice(0, 4);
      continue;
    }
    const kent = (l) => typeof l === 'string' && !!bekend?.[apparaat]?.[g]?.mapjes?.[l];
    if (typeof w === 'string') {
      if (kent(w)) uit[g] = w; else waarschuwingen.push(`${waar}: onbekend mapje ${g}.${w}${apparaat !== 'apc40mk2' ? ` (${apparaat})` : ''}: overgeslagen`);
    } else if (isObject(w) && 'als' in w) {
      if (!CONDITIES.includes(w.als)) { fouten.push(`${waar}: conditie "${w.als}" staat niet op de lijst (${CONDITIES.join(', ')})`); continue; }
      const c = { als: w.als };
      for (const tak of ['dan', 'anders']) {
        if (w[tak] === undefined) continue;
        if (kent(w[tak])) c[tak] = w[tak]; else waarschuwingen.push(`${waar}: onbekend mapje ${g}.${w[tak]} (${tak}): overgeslagen`);
      }
      const vreemd = Object.keys(w).find((k) => !['als', 'dan', 'anders'].includes(k));
      if (vreemd) fouten.push(`${waar}: een conditie is { als, dan, anders }, geen "${vreemd}" (geen expressies)`);
      else if (c.dan || c.anders) uit[g] = c;
    } else fouten.push(`${waar}: ${g} is de naam van een mapje of { als, dan, anders }`);
  }
  return uit;
}

function leesSchermenVanDeel(s, { waar, fouten, waarschuwingen }) {
  const uit = {};
  if (!isObject(s)) { fouten.push(`${waar}: schermen is een object ({ "hoofd": { "rijen": ["stems"] } })`); return uit; }
  for (const [naam, d] of Object.entries(s)) {
    if (!SCHERM_NAAM.test(naam)) { fouten.push(`${waar}: "${naam}" is geen schermnaam`); continue; }
    if (!isObject(d)) { fouten.push(`${waar}: scherm ${naam} is een object`); continue; }
    for (const v of VERBODEN) if (v in d) fouten.push(`${waar}: veld "${v}" hoort niet in een scherm`);
    const o = {};
    if ('werkvak' in d) {
      if (d.werkvak === null || (typeof d.werkvak === 'string' && /^[a-z0-9:-]{1,40}$/.test(d.werkvak))) o.werkvak = d.werkvak;
      else fouten.push(`${waar}: werkvak is de naam van een vak (bv. "uitlijn" of "paneel:super") of null`);
    }
    if ('rijen' in d) {
      if (!Array.isArray(d.rijen)) fouten.push(`${waar}: rijen is een lijst`);
      else o.rijen = [...new Set(d.rijen.filter((r) => RIJEN.includes(r) || (waarschuwingen.push(`${waar}: onbekende rij "${r}": overgeslagen`), false)))];
    }
    if ('onderpaneel' in d) {
      if (d.onderpaneel === null || ONDERPANELEN.includes(d.onderpaneel)) o.onderpaneel = d.onderpaneel;
      else waarschuwingen.push(`${waar}: onbekend onderpaneel "${d.onderpaneel}": overgeslagen`);
    }
    if ('vakken' in d) {
      if (!Array.isArray(d.vakken) || d.vakken.some((v) => typeof v !== 'string' || !/^[a-z0-9:-]{1,40}$/.test(v))) fouten.push(`${waar}: vakken is een lijst namen`);
      else o.vakken = d.vakken.slice(0, 12);
    }
    uit[naam] = o;
  }
  return uit;
}

function leesSuperknoppen(lijst, { fouten, waarschuwingen }) {
  if (lijst === undefined) return [];
  if (!Array.isArray(lijst)) { fouten.push('superknoppen is een lijst'); return []; }
  if (lijst.length > MAX_SUPER) fouten.push(`hooguit ${MAX_SUPER} superknoppen (nu ${lijst.length})`);
  const uit = [], nrs = new Set();
  for (const [i, s] of lijst.slice(0, MAX_SUPER).entries()) {
    const w = `superknop ${i + 1}`;
    if (!isObject(s) || !Number.isInteger(s.nr) || s.nr < 1 || s.nr > MAX_SUPER) { fouten.push(`${w}: nr is 1..${MAX_SUPER}`); continue; }
    if (nrs.has(s.nr)) { fouten.push(`${w}: nr ${s.nr} staat er twee keer`); continue; }
    if (!Array.isArray(s.links) || !s.links.length) { fouten.push(`${w}: links is een lijst met minstens één link`); continue; }
    if (s.links.length > MAX_LINKS) { fouten.push(`${w}: hooguit ${MAX_LINKS} links`); continue; }
    const links = [];
    let goed = true;
    for (const [j, l] of s.links.entries()) {
      const lw = `${w}, link ${j + 1}`;
      if (!isObject(l) || typeof l.action !== 'string' || !/^[\w.{}-]{1,120}$/.test(l.action)) { fouten.push(`${lw}: action ontbreekt`); goed = false; continue; }
      if (/^super\./.test(l.action)) { fouten.push(`${lw}: een superknop stuurt geen superknop (${l.action})`); goed = false; continue; }
      const o = { action: l.action };
      if ('in' in l) {
        if (!Array.isArray(l.in) || l.in.length !== 2 || !l.in.every((x) => typeof x === 'number' && x >= 0 && x <= 1) || l.in[0] > l.in[1]) {
          fouten.push(`${lw}: in is [van, tot] binnen 0..1`); goed = false; continue;
        }
        o.in = [...l.in];
      }
      for (const k of ['from', 'to']) {
        if (k in l) { if (typeof l[k] === 'number' && l[k] >= 0 && l[k] <= 1) o[k] = l[k]; else { fouten.push(`${lw}: ${k} is 0..1 (regel 2)`); goed = false; } }
      }
      if ('curve' in l) { if (CURVES.includes(l.curve)) o.curve = l.curve; else { fouten.push(`${lw}: onbekende curve "${l.curve}"`); goed = false; } }
      if ('steps' in l) { if (Number.isInteger(l.steps) && l.steps >= 2 && l.steps <= 128) o.steps = l.steps; else { fouten.push(`${lw}: steps is 2..128`); goed = false; } }
      links.push(o);
    }
    if (!goed) continue;
    nrs.add(s.nr);
    uit.push({ nr: s.nr, ...(typeof s.naam === 'string' ? { naam: s.naam.slice(0, 16) } : {}), links });
  }
  if (lijst.some((s) => isObject(s) && 'glide' in s)) waarschuwingen.push('superknoppen: glide hoort bij S4 (de .glide-actions), hier niet bewaard');
  return uit;
}

function leesPanelen(p, { fouten, waarschuwingen, bestaat }) {
  if (p === undefined) return {};
  if (!isObject(p)) { fouten.push('panelen is een object ({ "mijn-mix": { titel, items } })'); return {}; }
  const uit = {};
  const leesItem = (it, w, diep = 0) => {
    if (!isObject(it) || !PANEEL_SOORTEN.includes(it.soort)) { fouten.push(`${w}: soort is ${PANEEL_SOORTEN.join(', ')}`); return null; }
    for (const v of VERBODEN) if (v in it) { fouten.push(`${w}: veld "${v}" hoort niet in een paneel`); return null; }
    const o = { soort: it.soort };
    if (typeof it.label === 'string') o.label = it.label.slice(0, 24);
    if (it.soort === 'rij') {
      if (diep > 0) { fouten.push(`${w}: een rij in een rij kan niet`); return null; }
      if (!Array.isArray(it.herhaal) || !it.herhaal.length || it.herhaal.length > 16 || it.herhaal.some((k) => typeof k !== 'string' || !/^[\w-]{1,24}$/.test(k))) {
        fouten.push(`${w}: een rij heeft herhaal: [namen] (hooguit 16)`); return null;
      }
      const sub = leesItem(it.item, `${w}, item`, diep + 1);
      if (!sub) return null;
      return { ...o, herhaal: [...it.herhaal], item: sub };
    }
    if (it.soort === 'tekst') { if (typeof it.tekst === 'string') o.tekst = it.tekst.slice(0, 200); return o; }
    if (typeof it.action !== 'string' || !/^[\w.{}-]{1,120}$/.test(it.action)) { fouten.push(`${w}: action ontbreekt`); return null; }
    o.action = it.action;
    if (bestaat && !it.action.includes('{k}') && !bestaat(it.action)) waarschuwingen.push(`${w}: action ${it.action} bestaat niet (grijs)`);
    return o;
  };
  for (const [naam, d] of Object.entries(p)) {
    if (!PANEEL_NAAM.test(naam)) { fouten.push(`paneel "${naam}": geen geldige naam (a-z, 0-9, -)`); continue; }
    if (!isObject(d) || !Array.isArray(d.items)) { fouten.push(`paneel ${naam}: { titel, items: [...] }`); continue; }
    const items = [];
    d.items.slice(0, 64).forEach((it, i) => { const o = leesItem(it, `paneel ${naam}, item ${i + 1}`); if (o) items.push(o); });
    uit[naam] = { ...(typeof d.titel === 'string' ? { titel: d.titel.slice(0, 24) } : {}), ...(['focus', 'speel', 'tweede', 'maatgever'].includes(d.doel) ? { doel: d.doel } : {}), items };
  }
  return uit;
}

function leesSchermen(s, { fouten }) {
  if (s === undefined) return {};
  if (!isObject(s)) { fouten.push('schermen is een object ({ "ipad": { "soort": "ipad", "mag": [...] } })'); return {}; }
  const uit = {};
  for (const [naam, d] of Object.entries(s)) {
    if (!SCHERM_NAAM.test(naam) || !isObject(d)) { fouten.push(`scherm "${naam}": een naam en { soort }`); continue; }
    for (const v of VERBODEN) if (v in d) fouten.push(`scherm ${naam}: veld "${v}" hoort niet in een werkruimte`);
    if (!SCHERM_SOORTEN.includes(d.soort)) { fouten.push(`scherm ${naam}: soort is ${SCHERM_SOORTEN.join(', ')}`); continue; }
    const o = { soort: d.soort };
    if (d.plek !== undefined) { if (d.plek === 'onthouden' || d.plek === null) o.plek = d.plek; else fouten.push(`scherm ${naam}: plek is "onthouden" (geen positie)`); }
    for (const k of ['mag', 'nooit']) {
      if (d[k] === undefined) continue;
      if (!Array.isArray(d[k]) || d[k].some((p) => typeof p !== 'string' || !PATROON.test(p))) { fouten.push(`scherm ${naam}: ${k} is een lijst patronen (bv. "track.*.section.*")`); continue; }
      o[k] = [...new Set(d[k])];
    }
    // De vaste lijst kan geen werkruimte openzetten: wat in `mag` staat en daaronder valt, eruit.
    if (o.mag) {
      const weg = o.mag.filter((p) => VAST_NOOIT.some((v) => patroon(v).test(p.replace(/\*/g, 'x'))));
      if (weg.length) fouten.push(`scherm ${naam}: ${weg.join(', ')} kan nooit van buiten de Mac (opnemen, log, mappings, werkruimtes, library, laden)`);
      o.mag = o.mag.filter((p) => !weg.includes(p));
    }
    uit[naam] = o;
  }
  return uit;
}

/**
 * Een ruwe werkruimte (geparst JSON) controleren en netjes maken.
 *
 * @param opties.standaarden { apparaat: mapping-document } de standaardmappings (vrije plekken), of {}
 * @param opties.stukken     { naam: stuk-document } de stukken die er zijn (anders: niet nagekeken),
 *                           of een Set/array met alleen de namen
 * @param opties.bekend      de mapjes die er zijn (STANDAARD_MAPJES, bekendUitGroepen)
 * @param opties.bestaat     (action) => boolean: voor panelen (anders niet nagekeken)
 * @returns { werkruimte, fouten: [tekst], waarschuwingen: [tekst] }
 *   werkruimte null = het hele bestand is geweigerd (geen object, verkeerd schema, geen naam).
 */
export function normaliseerWerkruimte(ruw, { standaarden = {}, stukken = null, bekend = STANDAARD_MAPJES, bestaat = null } = {}) {
  const fouten = [], waarschuwingen = [];
  if (!isObject(ruw)) return { werkruimte: null, fouten: ['een werkruimte is een JSON-object'], waarschuwingen };
  if (ruw.schema !== SCHEMA) return { werkruimte: null, fouten: [`deze VARVE kent schema ${SCHEMA} (dit bestand: ${JSON.stringify(ruw.schema ?? null)})`], waarschuwingen };
  if (!naamGeldig(ruw.naam)) return { werkruimte: null, fouten: [NAAM_UITLEG], waarschuwingen };
  try { if (bytes(JSON.stringify(ruw)) > MAX_BYTES) return { werkruimte: null, fouten: [`te groot (meer dan ${MAX_BYTES / 1024} KiB)`], waarschuwingen }; } catch (_) {
    return { werkruimte: null, fouten: ['geen JSON'], waarschuwingen };
  }
  const w = { schema: SCHEMA, naam: ruw.naam, titel: ruw.naam, uitleg: '' };
  for (const k of Object.keys(ruw)) {
    if (VERBODEN_BOVEN.includes(k)) fouten.push(`veld "${k}": een werkruimte zet alleen mapjes, panelen en rijen; hij haalt nooit iets weg, start niets en kent geen standen of adressen`);
    else if (!VELDEN.includes(k) && !k.startsWith('_')) waarschuwingen.push(`onbekend veld "${k}": niet bewaard`);
  }
  if ('titel' in ruw) { if (typeof ruw.titel === 'string' && ruw.titel.length <= MAX_TITEL) w.titel = ruw.titel.trim() || ruw.naam; else fouten.push(`titel is tekst van hooguit ${MAX_TITEL} tekens`); }
  if ('uitleg' in ruw) { if (typeof ruw.uitleg === 'string' && ruw.uitleg.length <= MAX_UITLEG) w.uitleg = ruw.uitleg.trim(); else fouten.push(`uitleg is tekst van hooguit ${MAX_UITLEG} tekens`); }

  // vereist / terugval
  w.vereist = [];
  if ('vereist' in ruw) {
    if (!Array.isArray(ruw.vereist)) fouten.push('vereist is een lijst apparaten');
    else for (const a of ruw.vereist) { if (APPARATEN.includes(a)) { if (!w.vereist.includes(a)) w.vereist.push(a); } else fouten.push(`vereist: onbekend apparaat "${a}" (wel: ${APPARATEN.join(', ')})`); }
  }
  w.terugval = null;
  if ('terugval' in ruw && ruw.terugval !== null) {
    if (!naamGeldig(ruw.terugval)) fouten.push('terugval is de naam van een werkruimte');
    else if (ruw.terugval === ruw.naam) fouten.push('terugval is een ANDERE werkruimte');
    else w.terugval = ruw.terugval;
  }
  if (w.vereist.length && !w.terugval) waarschuwingen.push('vereist zonder terugval: ontbreekt er een apparaat, dan geldt "standaard"');

  // stukken
  w.stukken = [];
  const stukDocs = isObject(stukken) && !(stukken instanceof Set) ? stukken : null;
  const stukNamen = stukDocs ? new Set(Object.keys(stukDocs)) : stukken ? new Set(stukken) : null;
  if ('stukken' in ruw) {
    if (!Array.isArray(ruw.stukken)) fouten.push('stukken is een lijst namen');
    else for (const s of ruw.stukken) {
      if (!naamGeldig(s)) { fouten.push(`stuk "${s}": geen geldige naam`); continue; }
      if (w.stukken.includes(s)) continue;
      w.stukken.push(s);
      if (stukNamen && !stukNamen.has(s)) waarschuwingen.push(`stuk "${s}" bestaat (nog) niet: overgeslagen`);
    }
  }
  // De mapjes van de stukken die er zijn, horen bij wat bekend is.
  let b = kopieBekend(bekend);
  if (stukDocs) {
    for (const s of w.stukken) {
      if (!stukDocs[s]) continue;
      const ns = normaliseerStuk(stukDocs[s], { standaarden, bekend: b });
      if (ns.stuk) b = metMapjes(b, ns.stuk.mapjes);
    }
  }

  // mapjes
  w.mapjes = { nieuw: [], volgorde: {} };
  if ('mapjes' in ruw && !isObject(ruw.mapjes)) fouten.push('mapjes is { nieuw, volgorde }');
  const nm = leesNieuweMapjes(ruw.mapjes?.nieuw, { bekend: b, waar: 'mapjes' });
  fouten.push(...nm.fouten); waarschuwingen.push(...nm.waarschuwingen);
  w.mapjes.nieuw = nm.mapjes;
  b = metMapjes(b, nm.mapjes);
  const volg = ruw.mapjes?.volgorde;
  if (volg !== undefined) {
    if (!isObject(volg)) fouten.push('mapjes.volgorde is { "apc40mk2.grid": [...] }');
    else for (const [k, lijst] of Object.entries(volg)) {
      const [app, groep] = k.includes('.') ? k.split('.') : ['apc40mk2', k];
      const g = b[app]?.[groep];
      if (!g) { waarschuwingen.push(`volgorde ${k}: onbekende groep: overgeslagen`); continue; }
      if (!Array.isArray(lijst) || !lijst.length) { fouten.push(`volgorde ${k}: een lijst met mapjes`); continue; }
      const goed = [];
      for (const l of lijst) {
        if (!g.mapjes[l]) { waarschuwingen.push(`volgorde ${k}: onbekend mapje "${l}": overgeslagen`); continue; }
        if (!goed.includes(l)) goed.push(l);
      }
      const kwijt = (g.volgorde ?? []).filter((l) => !goed.includes(l) && !g.mapjes[l]?.kiesknop);
      if (kwijt.length) { fouten.push(`volgorde ${k}: ${kwijt.join(', ')} heeft geen kiesknop en zou onbereikbaar worden`); continue; }
      if (goed.length) w.mapjes.volgorde[`${app}.${groep}`] = goed;
    }
  }

  // delen
  w.deel = { start: null, kiezen: 'expliciet', onthoud: true };
  w.delen = {};
  if ('delen' in ruw) {
    if (!isObject(ruw.delen)) fouten.push('delen is een object ({ "mix": { label, kleur, … } })');
    else {
      const namen = Object.keys(ruw.delen);
      if (namen.length > MAX_DELEN) fouten.push(`hooguit ${MAX_DELEN} delen (één knop per deel, F1–F8); nu ${namen.length}`);
      for (const naam of namen.slice(0, MAX_DELEN)) {
        const d = ruw.delen[naam];
        const waar = `deel ${naam}`;
        if (!DEEL_NAAM.test(naam)) { fouten.push(`${waar}: een deelnaam is 2–16 kleine letters`); continue; }
        if (GERESERVEERDE_DELEN.includes(naam)) { fouten.push(`${waar}: "${naam}" is al een action (werk.deel.${naam}); kies een andere naam`); continue; }
        if (!isObject(d)) { fouten.push(`${waar}: een object`); continue; }
        for (const v of VERBODEN) if (v in d) fouten.push(`${waar}: veld "${v}" hoort niet in een deel (een deel zet mapjes en panelen, nooit een klank)`);
        const o = {};
        if (typeof d.label !== 'string' || !d.label.trim() || d.label.length > MAX_LABEL) { fouten.push(`${waar}: label is 1–${MAX_LABEL} tekens`); continue; }
        o.label = d.label.trim();
        if (!PALET.includes(d.kleur)) { fouten.push(`${waar}: kleur "${d.kleur}" is geen naam uit het APC-palet`); continue; }
        o.kleur = d.kleur;
        for (const [k, v] of Object.entries(d)) {
          if (['label', 'kleur', 'schermen', ...VERBODEN].includes(k)) continue;
          if (APPARATEN.includes(k)) {
            if (!DEEL_GROEPEN[k]) { waarschuwingen.push(`${waar}: ${k} heeft geen mapjes die een deel openzet: overgeslagen`); continue; }
            const ap = leesDeelApparaat(v, { apparaat: k, bekend: b, waar, fouten, waarschuwingen });
            if (Object.keys(ap).length) o[k] = ap;
          } else waarschuwingen.push(`${waar}: onbekend veld "${k}": overgeslagen`);
        }
        if ('schermen' in d) o.schermen = leesSchermenVanDeel(d.schermen, { waar, fouten, waarschuwingen });
        w.delen[naam] = o;
      }
    }
  }
  const deelNamen = Object.keys(w.delen);
  if ('deel' in ruw) {
    const d = ruw.deel;
    if (!isObject(d)) fouten.push('deel is { start, kiezen, onthoud }');
    else {
      if ('start' in d) { if (deelNamen.includes(d.start)) w.deel.start = d.start; else fouten.push(`deel.start "${d.start}" is geen deel van deze werkruimte`); }
      if ('kiezen' in d) { if (KIEZEN.includes(d.kiezen)) w.deel.kiezen = d.kiezen; else fouten.push(`deel.kiezen is ${KIEZEN.join(' of ')}`); }
      if ('onthoud' in d) { if (typeof d.onthoud === 'boolean') w.deel.onthoud = d.onthoud; else fouten.push('deel.onthoud is true of false'); }
      const vreemd = Object.keys(d).find((k) => !['start', 'kiezen', 'onthoud'].includes(k));
      if (vreemd) waarschuwingen.push(`deel.${vreemd}: onbekend, niet bewaard`);
    }
  }
  if (!w.deel.start && deelNamen.length) w.deel.start = deelNamen[0];

  // volgt
  w.volgt = [];
  if ('volgt' in ruw) {
    if (!Array.isArray(ruw.volgt)) fouten.push('volgt is een lijst [{ apparaat, mapje, deel }]');
    else for (const [i, v] of ruw.volgt.entries()) {
      const vw = `volgt ${i + 1}`;
      if (!isObject(v) || !APPARATEN.includes(v.apparaat) || typeof v.mapje !== 'string' || typeof v.deel !== 'string') { fouten.push(`${vw}: { apparaat, mapje: "groep.laag", deel }`); continue; }
      if (!deelNamen.includes(v.deel)) { fouten.push(`${vw}: deel "${v.deel}" bestaat niet in deze werkruimte`); continue; }
      const [g, l] = v.mapje.split('.');
      if (!b[v.apparaat]?.[g]?.mapjes?.[l]) { waarschuwingen.push(`${vw}: onbekend mapje ${v.mapje}: overgeslagen`); continue; }
      if (w.volgt.some((x) => x.apparaat === v.apparaat && x.mapje === v.mapje)) { fouten.push(`${vw}: ${v.mapje} staat er al (een mapje volgt één deel)`); continue; }
      w.volgt.push({ apparaat: v.apparaat, mapje: v.mapje, deel: v.deel });
    }
  }
  if (w.deel.kiezen === 'volgt' && !w.volgt.length && deelNamen.length) waarschuwingen.push('deel.kiezen is volgt, maar volgt is leeg');

  // regels
  w.regels = {};
  if ('regels' in ruw) {
    if (!isObject(ruw.regels)) fouten.push('regels is { "apc40mk2": [...] }');
    else for (const [app, lijst] of Object.entries(ruw.regels)) {
      if (!REGEL_APPARATEN.includes(app)) { waarschuwingen.push(`regels: apparaat "${app}" kent geen regels: overgeslagen`); continue; }
      const eigen = new Set(w.mapjes.nieuw.filter((x) => x.apparaat === app).map((x) => `${x.groep}.${x.laag}`));
      // De mapjes van de stukken zijn ook "nieuw": een eigen regel erin mag.
      for (const [g, gd] of Object.entries(b[app] ?? {})) for (const l of Object.keys(gd.mapjes)) if (!bekend?.[app]?.[g]?.mapjes?.[l]) eigen.add(`${g}.${l}`);
      const r = leesRegels(lijst, { apparaat: app, waar: 'regels', standaardSleutels: standaarden[app] ? sleutelsVan(standaarden[app]) : null, eigenMapjes: eigen, bekend: b });
      fouten.push(...r.fouten); waarschuwingen.push(...r.waarschuwingen);
      if (r.regels.length) w.regels[app] = r.regels;
    }
  }

  w.superknoppen = leesSuperknoppen(ruw.superknoppen, { fouten, waarschuwingen });
  w.bussen = {};
  if ('bussen' in ruw) {
    if (!isObject(ruw.bussen)) fouten.push('bussen is { "a": "<racknaam>" | null, "b": … }');
    else for (const [k, v] of Object.entries(ruw.bussen)) {
      if (k !== 'a' && k !== 'b') { fouten.push(`bussen: alleen a (echo) en b (galm), niet "${k}"`); continue; }
      if (v === null || (typeof v === 'string' && v.trim() && v.length <= 60)) w.bussen[k] = v; else fouten.push(`bussen.${k} is een racknaam of null`);
    }
  }
  w.panelen = leesPanelen(ruw.panelen, { fouten, waarschuwingen, bestaat });
  w.schermen = leesSchermen(ruw.schermen, { fouten });

  // Bereikbaarheid en kleur (pas nu: alle delen en mapjes zijn gelezen).
  fouten.push(...bereikbaarheid(w));
  waarschuwingen.push(...kleurControle(w, b));
  return { werkruimte: w, fouten, waarschuwingen };
}

/**
 * De bereikbaarheidstoets (B3, A12): elk nieuw mapje heeft een kiesknop of staat in een deel (anders
 * kom je er nooit). De volgorde en de kern zijn al bij het lezen nagekeken. Geeft fouten.
 */
export function bereikbaarheid(w) {
  const f = [];
  for (const mj of w.mapjes?.nieuw ?? []) {
    if (mj.kiesknop) continue;
    const inDeel = Object.values(w.delen ?? {}).some((d) => {
      const v = d[mj.apparaat]?.[mj.groep];
      return v === mj.laag || (isObject(v) && (v.dan === mj.laag || v.anders === mj.laag));
    });
    if (!inDeel) f.push(`mapje ${mj.groep}.${mj.laag} heeft geen kiesknop en staat in geen enkel deel: onbereikbaar`);
  }
  return f;
}

/**
 * Een deel met een APC-grid-mapje (niet het standaardmapje hotcues) of een nieuw mapje met een kleur
 * heeft de kleur van dat mapje (A10): anders zie je op de APC iets anders dan op het scherm.
 */
export function kleurControle(w, bekend = STANDAARD_MAPJES) {
  const uit = [];
  for (const [naam, d] of Object.entries(w.delen ?? {})) {
    const apc = d.apc40mk2 ?? {};
    const kijk = [];
    if (typeof apc.grid === 'string' && apc.grid !== (bekend.apc40mk2?.grid?.standaard ?? 'hotcues')) kijk.push(['grid', apc.grid]);
    if (typeof apc.device === 'string' && bekend.apc40mk2?.device?.mapjes?.[apc.device]?.kleur) kijk.push(['device', apc.device]);
    for (const [g, l] of kijk) {
      const k = mapjeKleur(bekend, 'apc40mk2', g, l);
      if (k && k !== d.kleur) uit.push(`deel ${naam} (${d.label}) is ${d.kleur}, maar het mapje ${g}.${l} brandt ${k} op de APC`);
    }
  }
  return uit;
}

// ---- samenstellen ----------------------------------------------------------------------------

/**
 * Wat er per apparaat bij de mapping komt (B1): de stukken in volgorde en daarna de eigen regels
 * van de werkruimte, elk als fragment, plus de nieuwe mapjes en de volgorde van ▲ ▼.
 *
 * @param standaarden { apparaat: mapping-document }
 * @param stukken     { naam: stuk-document } (een stuk dat ontbreekt: waarschuwing)
 * @param werkruimte  genormaliseerd (normaliseerWerkruimte)
 * @returns { apparaten: { [app]: { fragmenten: [{ bron, doc }], mapjes: [{ groep, laag, naam, kleur, kiesknop, bron }],
 *            volgorde: { groep: [..] } } }, botsingen: [{ apparaat, sleutel, bron, met }], fouten, waarschuwingen }
 *
 * Een kiesknop ({ in, shift }) wordt een regel layer.<groep>.<laag> in het fragment van wie het
 * mapje maakt (staat hij er al met dezelfde action, dan niet dubbel). Een botsing = een sleutel die
 * al in de standaard of een eerder fragment staat: die regel komt er niet bij (een fragment vult
 * alleen aan), en hij wordt gemeld.
 */
export function samenstellen(standaarden = {}, stukken = {}, werkruimte = null, { bekend = STANDAARD_MAPJES } = {}) {
  const apparaten = {}, botsingen = [], fouten = [], waarschuwingen = [];
  const per = (app) => (apparaten[app] ??= { fragmenten: [], mapjes: [], volgorde: {} });
  const bezet = {};
  const bezetVan = (app) => (bezet[app] ??= new Map([...sleutelsVan(standaarden[app])].map((k) => [k, 'standaard'])));
  let b = kopieBekend(bekend);

  const voegFragmentToe = (bron, mapjes, regelsPerApp) => {
    const apps = new Set([...Object.keys(regelsPerApp ?? {}), ...mapjes.map((x) => x.apparaat)]);
    for (const app of apps) {
      if (!REGEL_APPARATEN.includes(app) && !DEEL_GROEPEN[app]) continue;
      const lijst = [...(regelsPerApp?.[app] ?? [])];
      for (const mj of mapjes.filter((x) => x.apparaat === app)) {
        per(app).mapjes.push({ groep: mj.groep, laag: mj.laag, naam: mj.naam, kleur: mj.kleur ?? null, kiesknop: mj.kiesknop ? mj.laag : null, bron });
        if (!mj.kiesknop) continue;
        const k = `${mj.kiesknop.in}${mj.kiesknop.shift ? '#shift' : ''}`;
        const al = lijst.find((r) => sleutel(r) === k);
        if (al && al.action !== `layer.${mj.groep}.${mj.laag}`) { fouten.push(`${bron}: de kiesknop van ${mj.groep}.${mj.laag} (${k}) doet al ${al.action}`); continue; }
        if (!al) lijst.push({ in: mj.kiesknop.in, ...(mj.kiesknop.shift ? { shift: true } : {}), action: `layer.${mj.groep}.${mj.laag}`, mode: 'trigger', label: `kiesknop ${mj.naam}` });
      }
      const goed = [];
      const bz = bezetVan(app);
      for (const r of lijst) {
        const k = sleutel(r);
        if (bz.has(k) || (r.als && bz.get(plek(r)) === 'standaard')) { botsingen.push({ apparaat: app, sleutel: k, bron, met: bz.get(k) ?? bz.get(plek(r)) }); continue; }
        bz.set(k, bron);
        goed.push({ ...r });
      }
      if (goed.length) per(app).fragmenten.push({ bron, doc: { device: app, version: 3, rules: goed } });
    }
  };

  for (const naam of werkruimte?.stukken ?? []) {
    const doc = stukken?.[naam];
    if (!doc) { waarschuwingen.push(`stuk "${naam}" bestaat (nog) niet: overgeslagen`); continue; }
    const ns = normaliseerStuk(doc, { standaarden, bekend: b });
    fouten.push(...ns.fouten); waarschuwingen.push(...ns.waarschuwingen);
    if (!ns.stuk) continue;
    b = metMapjes(b, ns.stuk.mapjes);
    voegFragmentToe(`stuk:${naam}`, ns.stuk.mapjes, ns.stuk.regels);
  }
  if (werkruimte) {
    b = metMapjes(b, werkruimte.mapjes?.nieuw ?? []);
    voegFragmentToe(`werk:${werkruimte.naam}`, werkruimte.mapjes?.nieuw ?? [], werkruimte.regels ?? {});
    for (const [k, lijst] of Object.entries(werkruimte.mapjes?.volgorde ?? {})) {
      const [app, groep] = k.split('.');
      per(app).volgorde[groep] = [...lijst];
    }
  }
  return { apparaten, botsingen, fouten, waarschuwingen, bekend: b };
}

/**
 * Hoeveel plekken doen iets anders dan de vorige keer (A11)? `vorige` en `deze` zijn uitkomsten van
 * samenstellen (of null = alleen de standaard). Een plek = apparaat + sleutel; anders = erbij, weg,
 * of een andere action/modus/naar. Boven MAX_NIEUW een waarschuwing.
 */
export function telNieuwePlekken(vorige, deze) {
  const plekken = (s) => {
    const uit = new Map();
    for (const [app, a] of Object.entries(s?.apparaten ?? {})) {
      for (const f of a.fragmenten) for (const r of f.doc.rules) uit.set(`${app} ${sleutel(r)}`, `${r.action}|${r.mode}|${r.naar ?? ''}`);
    }
    return uit;
  };
  const v = plekken(vorige), d = plekken(deze);
  const sleutels = [];
  for (const [k, w] of d) if (v.get(k) !== w) sleutels.push(k);
  for (const k of v.keys()) if (!d.has(k)) sleutels.push(k);
  const aantal = sleutels.length;
  return { aantal, sleutels, waarschuwing: aantal > MAX_NIEUW ? `${aantal} nieuwe plekken (meer dan ${MAX_NIEUW} per proefavond)` : null };
}

/**
 * Wat een deel per apparaat open wil, met de condities uitgerekend. `conditie(naam)` -> boolean.
 * Geeft { groep: laag } (alleen wat het deel noemt; een conditie zonder tak voor deze uitkomst: niets).
 */
export function mapjesVanDeel(deel, apparaat, conditie = () => false) {
  const d = deel?.[apparaat];
  if (!d) return {};
  const uit = {};
  for (const [g, v] of Object.entries(d)) {
    if (g === 'scherm') { uit.scherm = [...v]; continue; }
    if (typeof v === 'string') uit[g] = v;
    else if (isObject(v)) { const l = conditie(v.als) ? v.dan : v.anders; if (l) uit[g] = l; }
  }
  return uit;
}

/** De delen in hun volgorde (F1–F8, de tabs): [{ naam, nr, label, kleur }]. */
export const delenLijst = (w) => Object.entries(w?.delen ?? {}).map(([naam, d], i) => ({ naam, nr: i + 1, label: d.label, kleur: d.kleur }));

/** De werkruimte 'standaard': geen delen, geen stukken. Zonder bestand is dit hem. */
export const STANDAARD = Object.freeze({ schema: SCHEMA, naam: 'standaard', titel: 'standaard', uitleg: 'VARVE zoals het altijd was: geen delen, geen extra knoppen.' });
