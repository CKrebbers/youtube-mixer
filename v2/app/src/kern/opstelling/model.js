/**
 * Een RECEPT (een template): data die zegt welke bouwstenen samen een speelbare opstelling
 * vormen, en hoeveel ruimte er is om elke keer anders uit te vallen. Een recept + een zaad =
 * een OPSTELLING (realiseer.js). Niet "sjabloon" genoemd: dat zijn de racks (audio/fx).
 *
 *   { schema: 1, id, naam, uitleg, kleur,
 *     sporen: [ hooguit 8, n = de track (en dus de kolom op de APC) ]
 *       { n, soort: 'nummer' | 'instrument',
 *         kies:    nummer:     { bpm: [lo, hi], stems: 'nodig'|'liefst'|'maakt-niet-uit', toon: 'past' }
 *                  instrument: { uit: ['drums', 'poly', 'fm', 'schaal'] }
 *         rack:    [namen] of 'elk' (uit racks/sjablonen.json), mix: [lo, hi]
 *         strip:   { fader | filter | laag | mid | hoog | trim: [lo, hi] }
 *         knoppen: { 1..8: [lo, hi] }                 de knoppen van het instrument
 *         patroon: { soort: 'drums'|'bas'|'lijn'|'akkoord', dichtheid: [lo, hi], lengte: [16, 32, …] } }
 *     beeld:  { lagen: [ { uit: [vorm-id's] } ], opacity: [lo, hi] }
 *     macros: [ hooguit 8, op volgorde van het alfabet (instrumenten/gedeeld/alfabet.js) ]
 *       { rol, naam, start: [lo, hi], links: [ { actie, van, tot, kromme? } ] }
 *     scenes: [ hooguit 8 ] { naam, macros: { <rol>: v | [lo, hi] } }
 *     variatie: { drift: 0..1 }  hoeveel de opstelling uit zichzelf beweegt (macro "variatie" schaalt het) }
 *
 * Een actie in een link mag `{n}` dragen: dat wordt de track van het spoor waar de link bij hoort
 * (`spoor` in de link), of de track met focus als er geen spoor is.
 * normaliseer() gooit nooit: wat niet klopt valt weg met een regel in `fouten`.
 */

export const SCHEMA = 1;
export const MAX_SPOREN = 8;
export const MAX_MACROS = 8;
export const MAX_SCENES = 8;

/** Het alfabet (werkplek/bediening/SYSTEEM.md §3.3): dezelfde acht betekenissen op dezelfde plek. */
export const ROLLEN = Object.freeze(['schaal', 'dichtheid', 'beweging', 'vervorming', 'kleur', 'helderheid', 'variatie', 'ruimte']);
export const SOORTEN = Object.freeze(['nummer', 'instrument']);
export const INSTRUMENTEN = Object.freeze(['drums', 'poly', 'fm', 'schaal']);
export const PATROON_SOORTEN = Object.freeze(['drums', 'bas', 'lijn', 'akkoord']);
export const STRIP = Object.freeze(['fader', 'filter', 'laag', 'mid', 'hoog', 'trim']);
export const KROMMEN = Object.freeze(['lin', 'exp', 'log', 's']);
const NAAM_ACTIE = /^[\w.{}:-]+$/;
const ID = /^[\w-]{1,64}$/;

const eindig = Number.isFinite;
const klem01 = (v) => Math.min(1, Math.max(0, v));

/** [lo, hi] binnen 0..1 (of een getal = [v, v]), anders `standaard`. */
export function bereik(x, standaard = null, { min = 0, max = 1 } = {}) {
  if (eindig(x)) return [Math.min(max, Math.max(min, x)), Math.min(max, Math.max(min, x))];
  if (Array.isArray(x) && x.length === 2 && eindig(x[0]) && eindig(x[1])) {
    const a = Math.min(max, Math.max(min, x[0])), b = Math.min(max, Math.max(min, x[1]));
    return a <= b ? [a, b] : [b, a];
  }
  return standaard;
}

function normaliseerSpoor(s, i, fouten) {
  const waar = `spoor ${i + 1}`;
  if (!s || typeof s !== 'object') { fouten.push(`${waar}: geen object`); return null; }
  const n = Math.round(s.n);
  if (!(n >= 1 && n <= MAX_SPOREN)) { fouten.push(`${waar}: n ${s.n} is geen track 1–8`); return null; }
  if (!SOORTEN.includes(s.soort)) { fouten.push(`${waar}: soort "${s.soort}" (wel: ${SOORTEN.join(', ')})`); return null; }
  const uit = { n, soort: s.soort, kies: {} };
  const k = s.kies && typeof s.kies === 'object' ? s.kies : {};
  if (s.soort === 'nummer') {
    uit.kies.bpm = bereik(k.bpm, null, { min: 40, max: 240 });
    uit.kies.stems = ['nodig', 'liefst', 'maakt-niet-uit'].includes(k.stems) ? k.stems : 'maakt-niet-uit';
    uit.kies.toon = k.toon === 'past' ? 'past' : null;
  } else {
    const lijst = (Array.isArray(k.uit) ? k.uit : INSTRUMENTEN).filter((x) => INSTRUMENTEN.includes(x));
    if (!lijst.length) { fouten.push(`${waar}: geen bekend instrument in kies.uit`); return null; }
    uit.kies.uit = lijst;
  }
  if (s.rack === 'elk' || (Array.isArray(s.rack) && s.rack.every((x) => typeof x === 'string'))) uit.rack = s.rack;
  if (s.mix !== undefined) uit.mix = bereik(s.mix, null);
  if (s.strip && typeof s.strip === 'object') {
    uit.strip = {};
    for (const [naam, b] of Object.entries(s.strip)) {
      if (!STRIP.includes(naam)) { fouten.push(`${waar}: strip "${naam}" bestaat niet`); continue; }
      const r = bereik(b, null);
      if (r) uit.strip[naam] = r;
    }
  }
  if (s.knoppen && typeof s.knoppen === 'object') {
    uit.knoppen = {};
    for (const [kk, b] of Object.entries(s.knoppen)) {
      const nr = Number(kk), r = bereik(b, null);
      if (nr >= 1 && nr <= 8 && r) uit.knoppen[nr] = r; else fouten.push(`${waar}: knop ${kk}`);
    }
  }
  if (s.patroon && typeof s.patroon === 'object') {
    const p = s.patroon;
    if (!PATROON_SOORTEN.includes(p.soort)) fouten.push(`${waar}: patroon "${p.soort}" (wel: ${PATROON_SOORTEN.join(', ')})`);
    else {
      const lengtes = (Array.isArray(p.lengte) ? p.lengte : [16]).map(Math.round).filter((x) => x >= 4 && x <= 64);
      uit.patroon = { soort: p.soort, dichtheid: bereik(p.dichtheid, [0.3, 0.6]), lengte: lengtes.length ? lengtes : [16] };
    }
  }
  return uit;
}

function normaliseerLink(l, waar, fouten) {
  if (!l || typeof l.actie !== 'string' || !NAAM_ACTIE.test(l.actie)) { fouten.push(`${waar}: link zonder geldige actie`); return null; }
  const uit = { actie: l.actie, van: eindig(l.van) ? klem01(l.van) : 0, tot: eindig(l.tot) ? klem01(l.tot) : 1, kromme: KROMMEN.includes(l.kromme) ? l.kromme : 'lin' };
  if (l.spoor !== undefined) { const n = Math.round(l.spoor); if (n >= 1 && n <= MAX_SPOREN) uit.spoor = n; }
  return uit;
}

/** Een recept nakijken: { recept, fouten }. Gooit nooit. */
export function normaliseerRecept(invoer) {
  const fouten = [];
  const r = invoer && typeof invoer === 'object' ? invoer : {};
  if (r.schema !== undefined && r.schema !== SCHEMA) fouten.push(`schema ${r.schema}, verwacht ${SCHEMA}`);
  const id = typeof r.id === 'string' && ID.test(r.id) ? r.id : null;
  if (!id) fouten.push('id ontbreekt of is ongeldig');
  const sporen = [];
  const bezet = new Set();
  (Array.isArray(r.sporen) ? r.sporen : []).slice(0, MAX_SPOREN).forEach((s, i) => {
    const sp = normaliseerSpoor(s, i, fouten);
    if (!sp) return;
    if (bezet.has(sp.n)) { fouten.push(`spoor ${i + 1}: track ${sp.n} staat er al`); return; }
    bezet.add(sp.n);
    sporen.push(sp);
  });
  const macros = [];
  const rollen = new Set();
  (Array.isArray(r.macros) ? r.macros : []).slice(0, MAX_MACROS).forEach((m, i) => {
    const waar = `macro ${i + 1}`;
    if (!m || !ROLLEN.includes(m.rol)) { fouten.push(`${waar}: rol "${m?.rol}" (wel: ${ROLLEN.join(', ')})`); return; }
    if (rollen.has(m.rol)) { fouten.push(`${waar}: rol ${m.rol} staat er al`); return; }
    rollen.add(m.rol);
    const links = (Array.isArray(m.links) ? m.links : []).map((l) => normaliseerLink(l, waar, fouten)).filter(Boolean);
    macros.push({ rol: m.rol, naam: typeof m.naam === 'string' && m.naam ? m.naam.slice(0, 12) : m.rol, start: bereik(m.start, [0.4, 0.6]), links });
  });
  // Op de volgorde van het alfabet: macro k = draaiknop k, op elk apparaat en in elk recept.
  macros.sort((a, b) => ROLLEN.indexOf(a.rol) - ROLLEN.indexOf(b.rol));
  const scenes = (Array.isArray(r.scenes) ? r.scenes : []).slice(0, MAX_SCENES).map((s, i) => {
    const m = {};
    for (const [rol, v] of Object.entries(s?.macros ?? {})) { const b = bereik(v, null); if (ROLLEN.includes(rol) && b) m[rol] = b; else fouten.push(`scene ${i + 1}: ${rol}`); }
    return { naam: typeof s?.naam === 'string' && s.naam ? s.naam.slice(0, 10) : `scene ${i + 1}`, macros: m };
  });
  let beeld = null;
  if (r.beeld && typeof r.beeld === 'object') {
    const lagen = (Array.isArray(r.beeld.lagen) ? r.beeld.lagen : []).slice(0, 2)
      .map((l) => (Array.isArray(l?.uit) ? l.uit.filter((x) => typeof x === 'string') : [])).filter((l) => l.length).map((uit) => ({ uit }));
    beeld = { lagen, opacity: bereik(r.beeld.opacity, [0.6, 0.9]) };
  }
  const drift = eindig(r.variatie?.drift) ? klem01(r.variatie.drift) : 0.3;
  return {
    recept: { schema: SCHEMA, id: id ?? 'zonder-id', naam: typeof r.naam === 'string' && r.naam ? r.naam : (id ?? 'recept'),
      uitleg: typeof r.uitleg === 'string' ? r.uitleg : '', kleur: typeof r.kleur === 'string' ? r.kleur : 'wit',
      sporen, macros, scenes, beeld, variatie: { drift } },
    fouten,
  };
}

/** Een kromme 0..1 -> 0..1 (zoals de rack-macro's: lin, exp, log, s). */
export function kromme(naam, x) {
  const v = klem01(x);
  switch (naam) {
    case 'exp': return v * v;
    case 'log': return Math.sqrt(v);
    case 's': return v * v * (3 - 2 * v);
    default: return v;
  }
}

/** Wat een link doet bij macrowaarde m: de waarde voor zijn actie. */
export const linkWaarde = (l, m) => klem01(l.van + (l.tot - l.van) * kromme(l.kromme, m));
