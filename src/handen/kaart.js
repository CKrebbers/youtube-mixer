/**
 * De handenkaart (docs/HANDEN.md): wat elke control van elke controller in Varve
 * doet, waar nog plek is, en welke nieuwe actie er als voorstel op staat. Puur:
 * geen I/O, geen DOM, geen engine, geen MIDI. Alles komt als data binnen; de CLI
 * (tools/handen/handenkaart.mjs) leest de bestanden, test/handen.test.mjs toetst.
 *
 *   maakHandenkaart({ mappings, controls, knoppen, eigen, params, register,
 *                     voorstel, profielen, telling })
 *     → { apc, maschine, lpd8, xboard, vrij, zonderPlek, verouderd, top, rollen }
 *
 * De kaart verandert niets: geen mapping, geen knop. Een nieuwe plek komt eerst via
 * learn (Clay's eigen verschil, docs/MAPPING-VERSCHIL.md), pas na een proef op het
 * apparaat in de standaard (VISIE §5.3–5.4). De kaart documenteert BEDOELING, niet
 * werking: tot de hub-middag (de F0-proef) is niets hiervan op de hardware nagelopen.
 *
 * Rijentaal: altijd "van boven" (Varve: rij 1 = bovenste), met de hub-id erachter
 * (`pad5-3` = rij 1 · kolom 3), want de hub telt van onder.
 */
import { normaliseer } from './telling.js';

/** Met `?hub=` is Bank de hubtoets (hub config.json `hubtoets`) en komt hij nooit bij Varve aan. */
export const HUBTOETS = 'bank';
/** Soorten APC-controls die je indrukt (de rest draait of schuift). */
export const SCHAKELAARS = ['knop', 'scene', 'voet'];

/**
 * De LPD8 zoals de hub hem verdeelt (AV-app-hub PROTOCOL §6): de knoppen zijn
 * rollen (de pickup volgt de eerste app met die rol), de pads zijn van de hub.
 * Varve's rollen staan in src/control/hub.js (`PARAMS`).
 */
export const LPD8 = Object.freeze([
  { id: 'K1', rol: 'macro.intensiteit' }, { id: 'K2', rol: 'macro.helderheid' },
  { id: 'K3', rol: 'macro.ruimte' }, { id: 'K4', rol: 'macro.beweging' },
  { id: 'K5', rol: 'macro.kleur' }, { id: 'K6', rol: 'macro.dichtheid' },
  { id: 'K7', rol: 'klok.adem_periode' }, { id: 'K8', rol: 'macro.balans' },
  { id: 'P1', param: 'paniek', hub: 'paniek (vasthouden): elke app' },
  { id: 'P2', hub: 'tap tempo' }, { id: 'P3', hub: 'adem' }, { id: 'P4', hub: 'opname van de hub' },
  { id: 'P5', hub: 'snapshot 1' }, { id: 'P6', hub: 'snapshot 2' }, { id: 'P7', hub: 'snapshot 3' }, { id: 'P8', hub: 'snapshot 4' },
]);

/** Varve's signature van een hub-control: `t:ch:n`. */
export const apcSig = (c) => `${c.t}:${c.ch}:${c.n}`;
/** Hub-rij (1 = onder) → Varve-rij (1 = boven). */
export const rijVanBoven = (hubRij) => 6 - hubRij;

/** Waar een APC-control zit, in Varve-taal met de hub-id erachter. */
export function plekNaam(c) {
  const m = /^pad(\d)-(\d)$/.exec(c.id);
  return m ? `rij ${rijVanBoven(Number(m[1]))} · kolom ${m[2]} (${c.id})` : `${c.label} (${c.id})`;
}

/** Past een mapping-`in` (met eventueel `*` als kanaal) op deze signature? */
export function sigPast(regelIn, sig) {
  if (regelIn === sig) return true;
  const a = regelIn.split(':'), b = sig.split(':');
  return a.length === 3 && b.length === 3 && a[0] === b[0] && a[2] === b[2] && a[1] === '*';
}

/** Een mapping-action zoals hij in de telling heet: sjablonen op 1, dan genormaliseerd. */
export const normaliseerRegel = (action) => normaliseer(String(action).replace(/\{(focus|speel|plek)\}/g, '1'));

/** `track.N.stem.*` past op `track.N.stem.drums.send.a`; zonder `*` alleen precies. */
export function patroonPast(patroon, actie) {
  if (!patroon.includes('*')) return patroon === actie;
  const re = new RegExp(`^${patroon.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(actie);
}

const regelVan = (r, bron) => ({ action: r.action, shift: !!r.shift, laag: r.laag ?? null, label: r.label ?? null, ...(bron ? { bron } : {}) });

// ---- APC40 mkII ----------------------------------------------------------------------------

function maakApc({ mapping, vormen, controls }) {
  const rijen = controls.map((c) => {
    const sig = apcSig(c);
    const regels = mapping.rules.filter((r) => sigPast(r.in, sig));
    const basis = regels.find((r) => !r.laag && !r.shift)?.action ?? null;
    const shift = regels.find((r) => !r.laag && r.shift)?.action ?? null;
    const lagen = regels.filter((r) => r.laag).map((r) => regelVan(r));
    const vorm = (vormen?.rules || []).filter((r) => sigPast(r.in, sig)).map((r) => regelVan(r, '?vormen=1'));
    const m = /^pad(\d)-(\d)$/.exec(c.id);
    const kort = m ? `pad r${rijVanBoven(Number(m[1]))}k${m[2]}` : c.label;
    return { id: c.id, label: c.label, kort, soort: c.soort, sig, plek: plekNaam(c), basis, shift, lagen, vorm };
  });
  const shiftToets = mapping.shift ?? null;
  const zonderRegel = rijen.filter((r) => !r.basis && !r.shift && !r.lagen.length);
  const vrij = {
    // Geen enkele regel in de standaard (de shift-toets zelf hoort hierbij: hij IS shift).
    zonderRegel: zonderRegel.map((r) => r.id),
    // Geen basisregel, wel een met shift.
    alleenShift: rijen.filter((r) => !r.basis && r.shift).map((r) => r.id),
    // Shift + deze knop is vrij in de basis (zolang er geen mapje open is dat hem claimt).
    // Niet de shift-toets zelf en niet de hubtoets.
    shiftVrij: rijen.filter((r) => SCHAKELAARS.includes(r.soort) && !r.shift && r.sig !== shiftToets && r.id !== HUBTOETS).map((r) => r.id),
    // Per grid-modus: de pads zonder regel in die modus (met of zonder shift).
    inModus: {},
  };
  const modi = [...new Set(mapping.rules.map((r) => r.laag).filter((l) => l && l.startsWith('grid.')))].sort();
  const pads = rijen.filter((r) => r.soort === 'pad');
  for (const m of modi) vrij.inModus[m] = pads.filter((p) => !p.lagen.some((l) => l.laag === m)).map((p) => p.id);
  const waarom = { shift: 'de shift-toets zelf', [HUBTOETS]: 'zonder hub vrij; met de hub de hubtoets (komt nooit aan)' };
  vrij.toelichting = Object.fromEntries(zonderRegel.map((r) => [r.id, waarom[r.id] ?? 'nergens gebruikt']));
  return { rijen, vrij, shiftToets };
}

// ---- Maschine MK2 --------------------------------------------------------------------------

function maakMaschine({ mapping, knoppen, draaiknoppen = [], eigen = {} }) {
  const rij = (k, soort) => {
    const regels = mapping.rules.filter((r) => sigPast(r.in, k.sig)).map((r) => regelVan(r));
    const zelf = eigen[k.naam] ?? null;
    return { naam: k.naam, label: k.label, sig: k.sig, soort, regels, eigen: zelf, vrij: !regels.length && !zelf };
  };
  const rijen = knoppen.map((k) => rij(k, 'knop'));
  const draai = draaiknoppen.map((k) => rij(k, 'draai'));
  return { rijen, draaiknoppen: draai, vrij: rijen.filter((r) => r.vrij).map((r) => r.naam), inGebruik: rijen.filter((r) => !r.vrij).map((r) => r.naam) };
}

// ---- LPD8 en Xboard49 ----------------------------------------------------------------------

function maakLpd8({ params = [] }) {
  const rijen = LPD8.map((p) => {
    const varve = p.param ? params.find((x) => x.id === p.param) : params.find((x) => x.rol && x.rol === p.rol);
    return { id: p.id, rol: p.rol ?? null, hub: p.hub ?? null, varve: varve ? { param: varve.id, naam: varve.naam, action: varve.action } : null,
      vrij: !varve && !p.hub };
  });
  return { rijen, vrij: rijen.filter((r) => r.vrij).map((r) => r.id) };
}

function maakXboard({ mapping }) {
  const rijen = (mapping?.rules || []).map((r) => ({ in: r.in, label: r.label ?? r.in, action: r.action, mode: r.mode ?? null }));
  return { rijen, vrij: [], aanname: mapping?.aanname ?? null };
}

// ---- acties zonder plek, en het voorstel --------------------------------------------------

/** Genormaliseerde action → waar hij in een mapping staat: [{ controller, label, laag, shift, bron }]. */
export function plekkenIndex({ apc, maschine, xboard, lpd8 = { rijen: [] } }) {
  const index = new Map();
  const zet = (action, plek) => {
    const a = normaliseerRegel(action);
    if (!index.has(a)) index.set(a, []);
    index.get(a).push(plek);
  };
  for (const r of apc.rijen) {
    if (r.basis) zet(r.basis, { controller: 'APC', label: r.kort, laag: null, shift: false });
    if (r.shift) zet(r.shift, { controller: 'APC', label: r.kort, laag: null, shift: true });
    for (const l of r.lagen) zet(l.action, { controller: 'APC', label: r.kort, laag: l.laag, shift: l.shift });
    for (const l of r.vorm) zet(l.action, { controller: 'APC', label: r.kort, laag: l.laag, shift: l.shift, bron: '?vormen=1' });
  }
  for (const r of [...maschine.rijen, ...maschine.draaiknoppen]) {
    for (const l of r.regels) zet(l.action, { controller: 'Maschine', label: r.label, laag: l.laag, shift: l.shift });
  }
  for (const r of xboard.rijen) zet(r.action, { controller: 'Xboard', label: r.label, laag: null, shift: false });
  for (const r of lpd8.rijen) if (r.varve) zet(r.varve.action, { controller: 'LPD8', label: r.id, laag: null, shift: false, bron: 'via de hub' });
  return index;
}

function zonderPlekVan({ register, index, voorstel }) {
  const acties = voorstel?.acties || [];
  const uitz = voorstel?.uitzonderingen || [];
  const genorm = [...new Set(register.map(normaliseer))].sort();
  return genorm.filter((a) => !index.has(a)).map((a) => {
    const v = acties.find((x) => patroonPast(x.actie, a));
    if (v) return { actie: a, status: v.status === 'voorstel' ? 'voorstel' : 'bewust-geen', voorstel: v };
    const u = uitz.find((x) => patroonPast(x.patroon, a));
    if (u) return { actie: a, status: 'uitzondering', reden: u.reden, patroon: u.patroon };
    return { actie: a, status: 'onbekend' };
  });
}

// ---- top-n handelingen → welke hand ----------------------------------------------------------

/** "fader 1", …, "fader 8", "play" → "fader 1–8, play"; pads → "12 pads". */
export function labelsKort(labels) {
  const pads = labels.filter((l) => l.startsWith('pad r'));
  const rest = labels.filter((l) => !l.startsWith('pad r'));
  const per = new Map();
  for (const l of rest) {
    const m = /^(.*?)\s?(\d+)$/.exec(l);
    const [voor, n] = m && !/[◄►]/.test(l) ? [m[1], Number(m[2])] : [l, null];
    if (!per.has(voor)) per.set(voor, []);
    if (n !== null) per.get(voor).push(n);
  }
  const delen = [...per.entries()].map(([voor, ns]) => {
    if (!ns.length) return voor;
    ns.sort((a, b) => a - b);
    const aaneen = ns.length > 2 && ns.every((x, i) => i === 0 || x === ns[i - 1] + 1);
    return `${voor} ${aaneen ? `${ns[0]}–${ns.at(-1)}` : ns.join(', ')}`;
  });
  if (pads.length) delen.push(pads.length === 1 ? pads[0] : `${pads.length} pads`);
  return delen.join(', ');
}

/** Plekken samengevat per controller/mapje/shift: "APC: fader 1–8". */
export function plekTekst(plekken = []) {
  const groepen = new Map();
  for (const p of plekken) {
    const k = `${p.controller}|${p.laag ?? ''}|${p.shift ? 1 : 0}|${p.bron ?? ''}`;
    if (!groepen.has(k)) groepen.set(k, { ...p, labels: [] });
    const g = groepen.get(k);
    if (!g.labels.includes(p.label)) g.labels.push(p.label);
  }
  // Dezelfde plek met en zonder shift (de Maschine: shift = fijn) is één regel "± shift".
  const lijst = [...groepen.values()];
  for (const g of lijst) {
    if (!g.shift) continue;
    const zonder = lijst.find((x) => !x.shift && !x.weg && x.controller === g.controller && x.laag === g.laag && x.bron === g.bron && labelsKort(x.labels) === labelsKort(g.labels));
    if (zonder) { zonder.beide = true; g.weg = true; }
  }
  return lijst.filter((g) => !g.weg).map((g) => {
    const l = labelsKort(g.labels);
    const waar = [g.beide ? '± shift' : g.shift ? 'shift' : null, g.laag, g.bron].filter(Boolean).join(', ');
    return `${g.controller}: ${l}${waar ? ` (${waar})` : ''}`;
  });
}

function maakTop({ telling, index, zonderPlek = [], n = 40 }) {
  if (!telling) return null;
  const rijen = [...telling.per.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([actie, aantal], i) => {
      const z = zonderPlek.find((x) => x.actie === actie);
      return { nr: i + 1, actie, aantal, plekken: plekTekst(index.get(actie)), zonder: z ? (z.patroon ?? z.voorstel?.actie ?? null) : null };
    });
  return { logs: telling.logs, acties: telling.acties, rijen };
}

// ---- rol per controller in de draagbare set ---------------------------------------------------

/**
 * Als avondpakket/profielen.json (PR #19) er nog niet is: dezelfde vijf profielen
 * met alleen de controllers (verwacht | optioneel | nee), uit docs/HANDEN.md §3.2.2
 * van het ontwerp (extra-2, 11 okt).
 */
export const PROFIELEN_V0 = Object.freeze({
  laptop: { titel: 'Alleen de laptop', apc40: 'nee', maschine: 'nee', lpd8: 'nee', xboard: 'nee' },
  apc: { titel: 'APC', apc40: 'verwacht', maschine: 'nee', lpd8: 'nee', xboard: 'nee' },
  maschine: { titel: 'Maschine via hub', apc40: 'nee', maschine: 'verwacht', lpd8: 'optioneel', xboard: 'optioneel' },
  alles: { titel: 'APC + Maschine (avond 2)', apc40: 'verwacht', maschine: 'verwacht', lpd8: 'optioneel', xboard: 'optioneel' },
  beeld: { titel: 'APC + beeld (avond 3)', apc40: 'verwacht', maschine: 'nee', lpd8: 'nee', xboard: 'nee' },
});

/** Wat elke controller in de set doet (VISIE §2, STUDIO §4) en of hij de hub nodig heeft. */
export const ROLLEN = Object.freeze([
  { id: 'apc40', naam: 'APC40 mkII', rol: 'mixer, tracks, effecten, cue, grid-modi: de kern van pijler 1', hub: 'nee (in `alles` via de hub: Bank = hubtoets)',
    geproefd: 'modus 0x42 en de kanalen van de device knobs (23 sep); alles van na 5 okt niet' },
  { id: 'maschine', naam: 'Maschine MK2', rol: 'pads, patronen, stapmodus, secties, sampler, Strip/Rack, bladeren (pijler 2–3)', hub: 'altijd', geproefd: 'nooit' },
  { id: 'lpd8', naam: 'LPD8', rol: 'globale laag: beeld (K2), puls (K4), zwart (P1), snapshots; met av-kern alle acht', hub: 'altijd', geproefd: 'nooit (V5 van de hub open)' },
  { id: 'xboard', naam: 'Xboard49', rol: 'noten met velocity en aftertouch, 16 knoppen, schuif (pijler 2)', hub: 'nee (ook direct)', geproefd: 'nooit (de CC\'s zijn een aanname)' },
]);

function maakRollen(profielen) {
  const p = profielen?.profielen ?? profielen ?? PROFIELEN_V0;
  const namen = Object.keys(p);
  return { bron: profielen ? 'avondpakket/profielen.json' : 'ingebakken (PROFIELEN_V0)', profielen: namen.map((n) => ({ id: n, titel: p[n].titel ?? n })),
    rijen: ROLLEN.map((r) => ({ ...r, per: Object.fromEntries(namen.map((n) => [n, p[n][r.id] ?? 'nee'])) })) };
}

// ---- alles samen -------------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {{ apc: object, vormen?: object, maschine: object, xboard?: object }} o.mappings  de JSON's uit mappings/
 * @param {Array<{id,soort,t,n,ch,label}>} o.controls  de 148 APC-controls (hub of src/handen/apc-controls.js)
 * @param {Array<{naam,label,sig}>} o.knoppen  de 48 Maschine-knoppen
 * @param {Array<{naam,label,sig}>} [o.draaiknoppen]  de acht draaiknoppen en het wiel
 * @param {Record<string, object>} [o.eigen]  knoppen die maschine.js zelf afhandelt (UITLEG)
 * @param {Array} [o.params]  Varve's hub-params (src/control/hub.js PARAMS)
 * @param {string[]} [o.register]  alle action-ids
 * @param {object} [o.voorstel]  handen/voorstel.json
 * @param {object} [o.profielen]  avondpakket/profielen.json
 * @param {object} [o.telling]  uit src/handen/telling.js
 */
export function maakHandenkaart({ mappings, controls, knoppen, draaiknoppen = [], eigen = {}, params = [], register = [], voorstel = null, profielen = null, telling = null }) {
  const apc = maakApc({ mapping: mappings.apc, vormen: mappings.vormen, controls });
  const maschine = maakMaschine({ mapping: mappings.maschine, knoppen, draaiknoppen, eigen });
  const lpd8 = maakLpd8({ params });
  const xboard = maakXboard({ mapping: mappings.xboard });
  const index = plekkenIndex({ apc, maschine, xboard, lpd8 });
  const zonderPlek = zonderPlekVan({ register, index, voorstel });
  // Een voorstel voor een actie die al in een mapping staat, is achterhaald (handen stap 4:
  // dan gaat de status in voorstel.json van "voorstel" naar "standaard").
  const verouderd = (voorstel?.acties || []).filter((v) => v.status === 'voorstel' && [...index.keys()].some((a) => patroonPast(v.actie, a))).map((v) => v.actie);
  const registerGenorm = new Set(register.map(normaliseer));
  const voorstellen = (voorstel?.acties || []).map((v) => ({ ...v, inRegister: v.busActie === false ? null : [...registerGenorm].some((a) => patroonPast(v.actie, a)) }));
  return {
    apc, maschine, lpd8, xboard,
    vrij: { apc: apc.vrij, maschine: maschine.vrij, lpd8: lpd8.vrij, xboard: xboard.vrij },
    zonderPlek, verouderd, voorstellen,
    top: maakTop({ telling, index, zonderPlek }),
    rollen: maakRollen(profielen),
  };
}
