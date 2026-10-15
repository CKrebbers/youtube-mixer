import { clamp } from '../lib/emitter.js';

/**
 * Effect-racks als DATA.
 *
 * Een rack beschrijft een keten effecten plus een stel macro's. Een macro is
 * een PLEK (1..8) waar één knop op zit; die knop kan meerdere parameters
 * tegelijk bewegen, elk met een eigen venster, bereik en curve.
 *
 * Waarom dat het hele punt is: de MIDI-mapping wijst naar `track.1.fx.knob.1`.
 * Wat die knop doet, bepaalt het rack. Laad je een ander rack, dan doet dezelfde
 * knop iets anders en hoef je nooit opnieuw te koppelen.
 *
 * Twee dingen die bewust NIET in een rack staan:
 *   - de live knopstand. Alleen `default` wordt bewaard. Zou de huidige stand
 *     erin zitten, dan is elk rack na drie seconden spelen "gewijzigd" en
 *     verdrink je in opslaan-vragen.
 *   - schaling naar Hz, ms of dB. Alles is 0..1; de effecten doen de schaling.
 *     Dat is regel 2 van CLAUDE.md, doorgetrokken naar de racks.
 */

export const RACK_SCHEMA = 1;

export const CURVES = ['lin', 'exp', 'log', 's'];

/** Hoeveel punten een eigen kromme mag hebben (S10): 2..17, gelijk verdeeld over 0..1. */
export const KROMME_MIN = 2, KROMME_MAX = 17;
/** Een standaard eigen kromme: vijf punten op een rechte lijn. */
export const KROMME_RECHT = () => [0, 0.25, 0.5, 0.75, 1];

/** Een eigen kromme (S10): punten gelijk verdeeld over 0..1, lineair ertussen. Puur. */
export function pasKromme(t, punten) {
  const x = clamp(t), n = punten.length - 1;
  const p = x * n, i = Math.min(n - 1, Math.floor(p));
  const a = punten[i], b = punten[i + 1];
  return clamp(a + (b - a) * (p - i));
}

/** Een geldige eigen kromme, of null (dan geldt `curve`). */
export function leesKromme(k) {
  if (!Array.isArray(k) || k.length < KROMME_MIN || k.length > KROMME_MAX) return null;
  if (!k.every((y) => typeof y === 'number' && Number.isFinite(y))) return null;
  return k.map((y) => clamp(y));
}

// ---- doelen van een link (S10) ---------------------------------------------
// Naast `<slot>.<param>` kan een knop ook naar:
//   `<slot>._nat`  het deel van één effect dat nat is (droog/nat per effect);
//   `plek.K`       een andere knop (één niveau diep: zie stuurPlekken);
//   `mod.N.diepte` de diepte van modulator N (vanaf 1).
export const isPlekDoel = (t) => /^plek\.[1-8]$/.test(t);
export const isModDoel = (t) => /^mod\.[1-9]\d*\.diepte$/.test(t);
export const isNatDoel = (t) => /^[^.]+\._nat$/.test(t);
/** Een doel dat een effect in de keten raakt (ook `_nat`), niet een knop of modulator. */
export const isKetenDoel = (t) => typeof t === 'string' && !isPlekDoel(t) && !isModDoel(t) && t.indexOf('.') > 0;

/** Curve over 0..1. Een filter-sweep zonder curve voelt altijd verkeerd. */
export function pasCurve(t, curve = 'lin') {
  const x = clamp(t);
  switch (curve) {
    case 'exp': return x * x;                 // traag beginnen, snel eindigen
    case 'log': return 1 - (1 - x) * (1 - x); // snel beginnen, traag eindigen
    case 's': return x * x * (3 - 2 * x);     // zacht aan beide kanten
    default: return x;
  }
}

/**
 * Eén link van een macro oplossen.
 *
 * `in: [a, b]` is het deel van de knopdraai waarin deze link beweegt; daarbuiten
 * blijft hij op zijn uiteinde staan. Daarmee zet je meerdere dingen ná elkaar
 * op één knop: eerst de mix open, dan pas de feedback omhoog.
 *
 * `from > to` draait de richting om. Dat is Ableton's manier en het scheelt een
 * aparte invert-vlag.
 */
export function resolveLink(macro, link) {
  const [a, b] = Array.isArray(link.in) && link.in.length === 2 ? link.in : [0, 1];
  const m = clamp(macro);
  let t;
  if (b === a) t = m >= b ? 1 : 0;
  else t = clamp((m - a) / (b - a));
  t = Array.isArray(link.kromme) && link.kromme.length >= KROMME_MIN ? pasKromme(t, link.kromme) : pasCurve(t, link.curve);
  const van = typeof link.from === 'number' ? link.from : 0;
  const naar = typeof link.to === 'number' ? link.to : 1;
  let v = van + (naar - van) * t;
  if (link.steps && link.steps > 1) {
    const n = Math.round(link.steps) - 1;
    v = Math.round(v * n) / n;
  }
  return clamp(v);
}

/**
 * Alle parameterwaarden die uit een set macrostanden volgen.
 *
 * Botsen twee macro's op dezelfde parameter, dan wint de HOOGSTE plek. Saai en
 * voorspelbaar; "laatste in de lijst wint" hangt van de volgorde af en dat is
 * precies het soort onvoorspelbaarheid dat je bij rack nummer tachtig niet meer
 * kunt uitleggen. De keuze staat in het rack zodat oude racks niet ineens
 * anders klinken als we hem ooit veranderen.
 */
export function resolveMacros(rack, standen) {
  const uit = new Map();
  const macros = [...(rack.macros || [])].sort((x, y) => (x.place || 0) - (y.place || 0));
  for (const macro of macros) {
    const stand = standen?.[macro.place] ?? macro.default ?? 0;
    for (const link of macro.links || []) {
      if (!link.target || !isKetenDoel(link.target)) continue;
      uit.set(link.target, resolveLink(stand, link));
    }
  }
  return uit;
}

/**
 * Knoppen die andere knoppen sturen (S10): `plek.K` als doel. Eén niveau diep:
 * elke knop rekent met zijn EIGEN stand (`standen`), ook als hij zelf door een
 * andere gestuurd wordt. Zo bestaan er geen lussen, en is het voorspelbaar:
 * knop 1 → knop 2 → knop 3 laat knop 3 de stand volgen die knop 2 met de hand
 * heeft. Botsen: de hoogste plek wint, zoals bij parameters.
 *
 * Geeft de effectieve standen (een nieuw object) en wat de knoppen op de
 * diepte van een modulator zetten (`mod.N.diepte`: N → 0..1).
 */
export function stuurPlekken(rack, standen) {
  const uit = { ...standen };
  const diepte = new Map();
  const macros = [...(rack.macros || [])].sort((x, y) => (x.place || 0) - (y.place || 0));
  for (const macro of macros) {
    const stand = standen?.[macro.place] ?? macro.default ?? 0;
    for (const link of macro.links || []) {
      if (isPlekDoel(link.target)) {
        const k = Number(link.target.slice(5));
        if (k !== macro.place) uit[k] = resolveLink(stand, link);
      } else if (isModDoel(link.target)) {
        diepte.set(Number(link.target.split('.')[1]), resolveLink(stand, link));
      }
    }
  }
  return { standen: uit, diepte };
}

// ---- het rack zelf ---------------------------------------------------------

const MIGRATIES = [
  // van schema 0 (bestaat niet) naar 1 — plaatshouder, zodat het patroon er is
  // vóórdat we hem nodig hebben. Zie library.js voor hetzelfde idee.
  (d) => ({ ...d, schema: 1 }),
];

export const LEEG_RACK = () => ({
  schema: RACK_SCHEMA,
  name: 'nieuw rack',
  tags: [],
  from: null,
  chain: [],
  macros: [],
  out: { trim: 0, mix: 0 },
  conflict: 'hoogste-plek-wint',
});

/**
 * Rack inlezen, migreren en controleren.
 *
 * Gooit nooit weg wat hij niet begrijpt: een onbekend effecttype blijft als
 * ruwe JSON bewaard en gaat er bij het opslaan ongeschonden weer uit. Eén keer
 * openen in een oudere versie mag geen rack slopen — dat is de enige regel
 * hier die later duur is om alsnog toe te voegen.
 */
export function leesRack(data, { bekendType = () => true } = {}) {
  let d = typeof data === 'string' ? JSON.parse(data) : (data || {});
  const fouten = [];

  let versie = Number(d.schema) || 0;
  while (versie < RACK_SCHEMA) {
    d = MIGRATIES[versie](d);
    versie = Number(d.schema) || versie + 1;
  }

  const rack = { ...LEEG_RACK(), ...d, schema: RACK_SCHEMA };
  rack.chain = Array.isArray(d.chain) ? d.chain : [];
  rack.macros = Array.isArray(d.macros) ? d.macros : [];

  const slots = new Set();
  rack.chain = rack.chain.map((node, i) => {
    const slot = node?.slot || String.fromCharCode(97 + i);
    if (slots.has(slot)) fouten.push(`slot "${slot}" komt dubbel voor`);
    slots.add(slot);
    const onbekend = !bekendType(node?.type);
    if (onbekend) fouten.push(`effect "${node?.type}" ken ik niet — blijft bewaard, staat uit`);
    // Uit zetten mag, maar alleen hier: wat er in het bestand stond gaat er
    // weer zo uit (`_bypass`). Anders stond een effect dat deze versie niet
    // kent na één keer bewaren voorgoed uit, ook in de versie die hem wel kent.
    const eigen = onbekend ? { _bypass: node && '_bypass' in node ? node._bypass : node?.bypass } : {};
    return { ...node, slot, onbekend, ...eigen, bypass: onbekend ? true : !!node.bypass,
      params: node?.params && typeof node.params === 'object' ? node.params : {} };
  });

  rack.macros = rack.macros.filter((m) => {
    if (!m || typeof m.place !== 'number') { fouten.push('macro zonder plek genegeerd'); return false; }
    return true;
  }).map((m) => ({
    place: m.place,
    label: m.label || `plek ${m.place}`,
    default: typeof m.default === 'number' ? clamp(m.default) : 0,
    bipolar: !!m.bipolar,
    // Glijtijd in seconden: zo lang doet het GELUID erover om de knop te
    // volgen. 0 = direct. Hooguit tien minuten; langer is een vergissing.
    glide: typeof m.glide === 'number' && m.glide > 0 ? Math.min(m.glide, 600) : 0,
    links: (Array.isArray(m.links) ? m.links : []).filter((l) => {
      if (!l?.target || typeof l.target !== 'string') { fouten.push(`macro ${m.place}: link zonder doel`); return false; }
      if (isPlekDoel(l.target) || isModDoel(l.target)) return true;
      const [slot] = l.target.split('.');
      if (!slots.has(slot)) {
        // Luid klagen, niet stil negeren: een niet-oplosbaar doel betekent dat
        // iemand een slot hernoemd heeft en negentig links stil kapotgingen.
        fouten.push(`macro ${m.place}: doel "${l.target}" wijst naar een slot dat niet bestaat`);
        return false;
      }
      if (l.curve && !CURVES.includes(l.curve)) fouten.push(`macro ${m.place}: onbekende curve "${l.curve}"`);
      if (l.kromme !== undefined && !leesKromme(l.kromme)) fouten.push(`macro ${m.place}: kromme van "${l.target}" klopt niet (2–17 getallen)`);
      return true;
    }).map((l) => {
      if (l.kromme === undefined) return l;
      const k = leesKromme(l.kromme);
      const { kromme, ...rest } = l;
      return k ? { ...rest, kromme: k } : rest;
    }),
  }));

  // Droog/nat per effect (S10): alleen een getal 0..1 telt, anders weg (de oude bedrading).
  rack.chain = rack.chain.map((n) => {
    if (n.meng === undefined) return n;
    if (typeof n.meng === 'number' && Number.isFinite(n.meng)) return { ...n, meng: clamp(n.meng) };
    fouten.push(`slot "${n.slot}": meng is geen getal`);
    const { meng, ...rest } = n;
    return rest;
  });

  // Modulators (S10, src/engine/modulatie.js). Een soort die deze versie niet kent blijft
  // als ruwe JSON staan en doet niets (zoals een onbekend effect).
  const ruweMods = (Array.isArray(d.mods) ? d.mods : []).filter((x) => x && typeof x === 'object');
  if (ruweMods.length > MAX_MODS) fouten.push(`${ruweMods.length} modulators: alleen de eerste ${MAX_MODS} tellen`);
  rack.mods = ruweMods.slice(0, MAX_MODS)
    .map((x, i) => {
      // Een soort die deze versie niet kent: helemaal ongeschonden laten (ook zijn doelen).
      if (!MOD_SOORT_BEKEND.includes(x.soort)) return x;
      if (Array.isArray(x.doelen) && x.doelen.length > MAX_DOELEN) fouten.push(`modulator ${i + 1}: ${x.doelen.length} doelen, alleen de eerste ${MAX_DOELEN} tellen`);
      const doelen = (Array.isArray(x.doelen) ? x.doelen : []).filter((dl) => {
        if (!dl || typeof dl.target !== 'string') { fouten.push(`modulator ${i + 1}: doel zonder target`); return false; }
        if (isPlekDoel(dl.target)) return true;
        if (isModDoel(dl.target)) {
          if (Number(dl.target.split('.')[1]) === i + 1) { fouten.push(`modulator ${i + 1}: stuurt zijn eigen diepte`); return false; }
          return true;
        }
        if (!slots.has(dl.target.split('.')[0])) { fouten.push(`modulator ${i + 1}: doel "${dl.target}" wijst naar een slot dat niet bestaat`); return false; }
        return true;
      }).slice(0, MAX_DOELEN).map((dl) => ({ target: dl.target, diepte: Number.isFinite(dl.diepte) ? Math.max(-1, Math.min(1, dl.diepte)) : 0.5 }));
      return { ...x, doelen };
    });

  // Welke twee knoppen samen op een XY-pad passen (S10). Zonder: knop 1 en 2.
  if (d.xy !== undefined) {
    const ok = Array.isArray(d.xy) && d.xy.length === 2 && d.xy.every((k) => Number.isInteger(k) && k >= 1 && k <= 8) && d.xy[0] !== d.xy[1];
    if (!ok) { fouten.push('xy: twee verschillende knoppen 1–8'); delete rack.xy; }
    else rack.xy = [...d.xy];
  }

  const plekken = rack.macros.map((m) => m.place);
  if (new Set(plekken).size !== plekken.length) fouten.push('twee macros op dezelfde plek');

  return { rack, fouten };
}

/** De soorten modulators die deze versie kent (zelfde lijst als MOD_SOORTEN in modulatie.js; rack.js blijft zonder imports). */
const MOD_SOORT_BEKEND = ['lfo', 'stap', 'volger', 'toeval'];
/** Hooguit zoveel modulators per rack, en zoveel doelen per modulator. */
export const MAX_MODS = 4, MAX_DOELEN = 8;

/** Velden van een rack die schrijfRack zelf schrijft; de rest gaat ongeschonden mee (S10). */
const BEKENDE_VELDEN = new Set(['schema', 'name', 'tags', 'from', 'chain', 'macros', 'out', 'conflict', 'mods', 'xy', 'uitleg']);

/** Terugschrijven, inclusief wat we niet begrepen. */
export function schrijfRack(rack) {
  // Velden die een nieuwere versie erbij zette, gaan er weer zo uit (zoals een onbekend effect).
  const extra = {};
  for (const [k, v] of Object.entries(rack || {})) if (!BEKENDE_VELDEN.has(k) && !k.startsWith('_') && v !== undefined) extra[k] = v;
  return {
    ...extra,
    schema: RACK_SCHEMA,
    name: rack.name || 'naamloos',
    tags: rack.tags || [],
    from: rack.from ?? null,
    chain: (rack.chain || []).map(({ onbekend, _bypass, ...node }) => {
      if (!onbekend) return node;
      // Een onbekend effect gaat terug zoals het binnenkwam, ook zijn bypass.
      const { bypass, ...rest } = node;
      return _bypass === undefined ? rest : { ...rest, bypass: _bypass };
    }),
    macros: (rack.macros || []).map((m) => ({
      place: m.place, label: m.label, default: m.default,
      ...(m.bipolar ? { bipolar: true } : {}),
      ...(m.glide > 0 ? { glide: m.glide } : {}),
      links: (m.links || []).map((l) => ({
        target: l.target,
        ...(l.in ? { in: l.in } : {}),
        from: l.from ?? 0, to: l.to ?? 1,
        ...(l.curve && l.curve !== 'lin' ? { curve: l.curve } : {}),
        ...(l.kromme ? { kromme: [...l.kromme] } : {}),
        ...(l.steps ? { steps: l.steps } : {}),
      })),
    })),
    out: rack.out || { trim: 0, mix: 0 },
    conflict: rack.conflict || 'hoogste-plek-wint',
    ...(rack.uitleg ? { uitleg: rack.uitleg } : {}),
    ...(Array.isArray(rack.xy) ? { xy: [...rack.xy] } : {}),
    ...(Array.isArray(rack.mods) && rack.mods.length ? { mods: rack.mods.map((m) => JSON.parse(JSON.stringify(m))) } : {}),
  };
}

/** Eén effect, één macro per parameter — het eenvoudigste bruikbare rack. */
export function rackVanEffect(effect) {
  return {
    ...LEEG_RACK(),
    name: effect.naam,
    chain: [{ slot: 'a', type: effect.id, typeVersion: 1, bypass: false, params: { ...effect.standaard } }],
    macros: effect.params.map((naam, i) => ({
      place: i + 1, label: naam,
      default: effect.standaard?.[naam] ?? 0.5,
      bipolar: false,
      links: [{ target: `a.${naam}`, from: 0, to: 1, curve: 'lin' }],
    })),
  };
}

// ---- instellen door te doen: DICHT en OPEN ---------------------------------

/** Zo dicht bij elkaar dat een koppeling niets meer doet. */
const GELIJK = 0.005;

/**
 * Wat er gebeurt als je, met een knop op DICHT of OPEN, aan een parameter draait.
 *
 * DICHT is de stand bij knop 0, OPEN bij knop 1: dat zijn `from` en `to` van
 * de koppeling, wat het venster en de curve ook zijn. Zo kun je een knop
 * instellen op het gehoor in plaats van met getallen — het Octatrack-idee van
 * twee scènes, maar in het datamodel dat er al lag.
 *
 *   - bestaat de koppeling nog niet, dan komt hij erbij, met `basis` (wat de
 *     parameter nu doet) als de andere kant: de andere stand blijft klinken
 *     zoals hij klonk;
 *   - worden beide kanten gelijk, dan verdwijnt hij: een koppeling die niets
 *     verandert is ruis in de lijst. De parameter houdt dan die waarde als
 *     eigen stand (`basis` in het resultaat), zodat er niets verspringt.
 *
 * Puur: past `macro.links` aan en zegt wat er gebeurde.
 * @returns {{ link: object|null, weg: boolean, basis: number|null }}
 */
export function neemOp(macro, target, kant, v, basis) {
  const waarde = clamp(v);
  let link = macro.links.find((l) => l.target === target);
  if (!link) {
    link = { target, from: clamp(basis), to: clamp(basis) };
    macro.links.push(link);
  }
  link[kant === 'dicht' ? 'from' : 'to'] = waarde;
  if (Math.abs((link.from ?? 0) - (link.to ?? 1)) < GELIJK) {
    macro.links.splice(macro.links.indexOf(link), 1);
    return { link: null, weg: true, basis: waarde };
  }
  return { link, weg: false, basis: null };
}

// ---- willekeurig en muteren, met zaad (S10) ----------------------------------

/** Een reeks getallen 0..1 uit een zaad (mulberry32): hetzelfde zaad = dezelfde reeks. */
export function reeksVan(zaad) {
  let a = (zaad | 0) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Een rack een beetje (of helemaal) anders maken, puur en herhaalbaar: hetzelfde
 * zaad en dezelfde sterkte geven hetzelfde rack.
 *
 *   - elke parameter in de keten schuift tot `sterkte` op (trappen springen met
 *     kans sterkte/3 naar een andere trap);
 *   - van elke koppeling schuift de OPEN kant (`to`) tot sterkte/2 op; de dichte
 *     kant (`from`) blijft, dus de beginstand van de knoppen klinkt zoals hij klonk;
 *   - de frequentie van een filter blijft waar hij is (dicht is stilte), en
 *     knoppen, namen, modulators en de keten zelf blijven ook.
 *
 * `sterkte` 1 = willekeurig, 0,15 = muteren. `effectVan` (type → effect) zegt
 * welke parameters er zijn en welke trappen hebben.
 */
export function muteer(rack, { zaad = 1, sterkte = 0.15, effectVan = () => null } = {}) {
  const r = reeksVan(zaad);
  const s = clamp(sterkte);
  const uit = JSON.parse(JSON.stringify(schrijfRack(rack)));
  const vast = new Set();
  for (const node of uit.chain) {
    const eff = effectVan(node.type);
    if (!eff) continue;
    node.params = { ...(node.params || {}) };
    for (const p of eff.params) {
      if (node.type === 'filter' && p === 'freq') { vast.add(`${node.slot}.${p}`); continue; }
      const v = node.params[p] ?? eff.standaard?.[p] ?? 0.5;
      const n = eff.trappen?.[p];
      if (n > 1) {
        if (r() < s / 3) node.params[p] = Math.floor(r() * n) / (n - 1);
        else r();
      } else {
        node.params[p] = Math.round(clamp(v + (r() * 2 - 1) * s) * 1000) / 1000;
      }
    }
  }
  for (const m of uit.macros) {
    for (const l of m.links) {
      if (!isKetenDoel(l.target) || vast.has(l.target)) continue;
      l.to = Math.round(clamp((l.to ?? 1) + (r() * 2 - 1) * s / 2) * 1000) / 1000;
    }
  }
  return uit;
}
