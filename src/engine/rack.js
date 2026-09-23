import { clamp } from '../lib/emitter.js';

/**
 * Effect-racks als DATA.
 *
 * Een rack beschrijft een keten effecten plus een stel macro's. Een macro is
 * een PLEK (1..8) waar één knop op zit; die knop kan meerdere parameters
 * tegelijk bewegen, elk met een eigen venster, bereik en curve.
 *
 * Waarom dat het hele punt is: de MIDI-mapping wijst naar `track.1.fx.knop.1`.
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
  t = pasCurve(t, link.curve);
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
      if (!link.target) continue;
      uit.set(link.target, resolveLink(stand, link));
    }
  }
  return uit;
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
    return { ...node, slot, onbekend, bypass: onbekend ? true : !!node.bypass,
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
    links: (Array.isArray(m.links) ? m.links : []).filter((l) => {
      if (!l?.target || typeof l.target !== 'string') { fouten.push(`macro ${m.place}: link zonder doel`); return false; }
      const [slot] = l.target.split('.');
      if (!slots.has(slot)) {
        // Luid klagen, niet stil negeren: een niet-oplosbaar doel betekent dat
        // iemand een slot hernoemd heeft en negentig links stil kapotgingen.
        fouten.push(`macro ${m.place}: doel "${l.target}" wijst naar een slot dat niet bestaat`);
        return false;
      }
      if (l.curve && !CURVES.includes(l.curve)) fouten.push(`macro ${m.place}: onbekende curve "${l.curve}"`);
      return true;
    }),
  }));

  const plekken = rack.macros.map((m) => m.place);
  if (new Set(plekken).size !== plekken.length) fouten.push('twee macros op dezelfde plek');

  return { rack, fouten };
}

/** Terugschrijven, inclusief wat we niet begrepen. */
export function schrijfRack(rack) {
  return {
    schema: RACK_SCHEMA,
    name: rack.name || 'naamloos',
    tags: rack.tags || [],
    from: rack.from ?? null,
    chain: (rack.chain || []).map(({ onbekend, ...node }) => node),
    macros: (rack.macros || []).map((m) => ({
      place: m.place, label: m.label, default: m.default,
      ...(m.bipolar ? { bipolar: true } : {}),
      links: (m.links || []).map((l) => ({
        target: l.target,
        ...(l.in ? { in: l.in } : {}),
        from: l.from ?? 0, to: l.to ?? 1,
        ...(l.curve && l.curve !== 'lin' ? { curve: l.curve } : {}),
        ...(l.steps ? { steps: l.steps } : {}),
      })),
    })),
    out: rack.out || { trim: 0, mix: 0 },
    conflict: rack.conflict || 'hoogste-plek-wint',
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
