import { Mapping, resolveTarget } from '../control/mapping.js';
import { GROEPEN, LAAGNAAM, voegMapjeToe, haalMapjeWeg } from '../control/lagen.js';
import apc from '../control/devices/apc40mk2.js';
import { normaliseerWerkruimte, samenstellen, mapjesVanDeel, delenLijst, bekendUitGroepen, STANDAARD } from '../werk/model.js';
import { hexVan, tekstOp, kleurVanDeel } from '../werk/kleuren.js';

/**
 * De werkruimte ZONDER hem te activeren (spoor S6, docs/werkruimte/S6.md, WERKRUIMTE.md A9
 * "eerst bekijken, dan aanzetten"): de kaarten (apc.html, maschine.html) en de spiekbrief
 * (spiekbrief.html) laten per werkruimte en per deel zien wat elke knop doet. Dezelfde weg als de
 * mixer (src/werk/model.js: normaliseerWerkruimte + samenstellen, de stukken als fragment op de
 * Mapping, de mapjes van het deel), maar op een EIGEN Mapping of Maschine: er gaat niets naar de
 * bus, de APC of de Maschine, en er verandert niets aan de werkruimte van de mixer.
 *
 * Geen DOM in de functies hieronder (op spiekHtml na, die alleen tekst maakt): de test draait ze in
 * Node met een nep-`haal`. `haal(url)` geeft een JSON-document of null.
 *
 * Wat een knop doet komt uit `Mapping.kies()` en de uitleg uit `beschrijf()` (apc-beschrijf.js);
 * voor de Maschine uit `legUit()`, dezelfde tekst als met CONTROL. Dit bestand laadt GEEN code van
 * de Maschine (test/hub.test.mjs: dat mag alleen haar eigen keten); wie de Maschine erbij wil
 * (maschine.html, spiekbrief.html) geeft de helpers uit de Maschine-kaart mee (`maschine` hieronder).
 * Condities (`{ als, dan, anders }`) tonen de `anders`-tak: de kaart weet niet wat er op de
 * focus-track staat (CONDITIE hieronder).
 */

/** Condities in de voorbeeldmodus: niets is waar (de `anders`-tak, zie boven). */
export const CONDITIE = () => false;

/** De lijst van werkruimtes (de server), altijd met standaard vooraan. */
export async function lijstWerkruimtes(haal) {
  let lijst = [];
  try { lijst = (await haal('/api/werkruimtes'))?.werkruimtes ?? []; } catch (_) { lijst = []; }
  const uit = lijst.filter((w) => w && typeof w.naam === 'string').map((w) => ({ naam: w.naam, titel: w.titel ?? w.naam }));
  if (!uit.some((w) => w.naam === 'standaard')) uit.unshift({ naam: 'standaard', titel: 'standaard' });
  return uit;
}

/**
 * Een werkruimte als voorbeeld laden: { naam, werkruimte (genormaliseerd), samenstelling,
 * standaarden, fouten, waarschuwingen }. Zonder server-antwoord (of 'standaard'): de standaard.
 */
export async function laadVoorbeeld(naam, haal) {
  const standaarden = {};
  for (const app of ['apc40mk2', 'maschine-mk2']) {
    try { const d = await haal(`mappings/${app}.json`); if (d) standaarden[app] = d; } catch (_) {}
  }
  let ruw = STANDAARD;
  if (naam && naam !== 'standaard') {
    try { ruw = (await haal(`/api/werkruimtes/${encodeURIComponent(naam)}`))?.ruw ?? null; } catch (_) { ruw = null; }
  }
  if (!ruw) return { naam, werkruimte: null, samenstelling: null, standaarden, fouten: [`werkruimte ${naam} is niet te lezen`], waarschuwingen: [] };
  const stukken = {};
  for (const s of Array.isArray(ruw.stukken) ? ruw.stukken : []) {
    try { const d = await haal(`mappings/stukken/${encodeURIComponent(s)}.json`); if (d) stukken[s] = d; } catch (_) {}
  }
  const bekend = bekendUitGroepen(GROEPEN);
  const n = normaliseerWerkruimte(ruw, { standaarden, stukken, bekend });
  const werkruimte = n.werkruimte ?? normaliseerWerkruimte(STANDAARD).werkruimte;
  const samenstelling = samenstellen(standaarden, stukken, werkruimte, { bekend });
  return { naam, werkruimte, samenstelling, standaarden, fouten: [...n.fouten, ...samenstelling.fouten], waarschuwingen: [...n.waarschuwingen, ...samenstelling.waarschuwingen] };
}

/** De delen van een voorbeeld; zonder delen (standaard) één deel "standaard". */
export function delenVan(v) {
  const lijst = delenLijst(v?.werkruimte);
  return lijst.length ? lijst.map((d) => ({ ...d, kleur: kleurVanDeel(d.naam, v.werkruimte.delen[d.naam]) }))
    : [{ naam: null, nr: 1, label: 'standaard', kleur: 'grijs' }];
}

/** De fragmenten van een apparaat in een voorbeeld: [{ bron, doc }]. */
export const fragmentenVan = (v, app) => v?.samenstelling?.apparaten?.[app]?.fragmenten ?? [];

/** Komt de Maschine in deze werkruimte voor (een deel, een stuk, een regel)? */
export function metMaschine(v) {
  const w = v?.werkruimte;
  if (!w) return false;
  return fragmentenVan(v, 'maschine-mk2').length > 0 || Object.values(w.delen ?? {}).some((d) => d['maschine-mk2']) || (w.vereist ?? []).includes('maschine-mk2');
}

/**
 * Een Mapping met de fragmenten van het voorbeeld erop (zoals de werkruimte ze in de mixer zet).
 * `mapping` = een bestaande (de APC-kaart met jouw eigen verschil), anders een nieuwe met de standaard.
 * Geeft een functie die de fragmenten weer weghaalt.
 */
export function zetFragmenten(mapping, v, app) {
  const bronnen = [];
  for (const f of fragmentenVan(v, app)) { mapping.vervangFragment(f.bron, f.doc); bronnen.push(f.bron); }
  return () => { for (const b of bronnen) mapping.haalWeg(b); };
}

/**
 * De nieuwe APC-mapjes van het voorbeeld (grid.fx, device.uitlijn, mijn dub …) in de GROEPEN van
 * DEZE pagina (lagen.js), zoals de werkruimte ze in de mixer zet: dan hebben ze een naam in de uitleg
 * en een rij in de kaart. Geeft een functie die ze weer weghaalt. Een mapje dat er al is: overgeslagen.
 */
export function zetApcMapjes(v) {
  const gezet = [];
  for (const mj of v?.samenstelling?.apparaten?.apc40mk2?.mapjes ?? []) {
    try { voegMapjeToe(mj.groep, mj.laag, { naam: mj.naam, kleur: mj.kleur ?? undefined, kiesknop: mj.kiesknop }); gezet.push(mj); } catch (_) {}
  }
  return () => { for (const mj of gezet) haalMapjeWeg(mj.groep, mj.laag); };
}

/**
 * De open mapjes van de APC in een deel: de standaard van elke groep, met wat het deel noemt
 * erover. Puur: { groep: laag } (zonder de houd-groep).
 */
export function apcStandVan(v, deelNaam) {
  const stand = {};
  for (const [g, d] of Object.entries(GROEPEN)) if (!d.houd) stand[g] = d.standaard;
  const deel = deelNaam ? v?.werkruimte?.delen?.[deelNaam] : null;
  return { ...stand, ...mapjesVanDeel(deel, 'apc40mk2', CONDITIE) };
}

/** De mapjes van de Maschine in een deel ({ pads, pagina, wiel, scherm }). */
export function maschineDefVan(v, deelNaam) {
  const deel = deelNaam ? v?.werkruimte?.delen?.[deelNaam] : null;
  return mapjesVanDeel(deel, 'maschine-mk2', CONDITIE);
}

/** De houd-mapjes in de regels van een Mapping, met hun regels: [{ naam, regels: [regel] }]. */
export function houdMapjes(mapping) {
  const per = new Map();
  for (const r of mapping.rules.values()) {
    if (typeof r.laag !== 'string' || !r.laag.startsWith('houd.')) continue;
    const n = r.laag.slice(5);
    if (!per.has(n)) per.set(n, []);
    per.get(n).push(r);
  }
  return [...per.entries()].map(([naam, regels]) => ({ naam, regels }));
}

/** De deelnamen en de kleur van een deel voor een Maschine (m.delen, m.kleur), of null. */
export function deelLabels(v, deel) {
  const lijst = delenLijst(v?.werkruimte);
  if (!lijst.length) return { delen: null, kleur: null };
  return { delen: { labels: lijst.map((d) => d.label), actief: lijst.findIndex((d) => d.naam === deel) },
    kleur: deel ? kleurVanDeel(deel, v.werkruimte.delen[deel]) : null };
}

/** Een regel in gewone taal: "<kort>: <lang>" van de action, met de focus als track 1. */
function tekstVan(regel, beschrijf) {
  if (!regel) return '';
  const id = resolveTarget(regel.action, { focus: 1, speel: 1, tweede: 2, R: 2, L: 1, plek: 1, maatgever: 1 });
  let b = null;
  try { b = beschrijf?.(id) ?? null; } catch (_) { b = null; }
  const lang = b?.lang ? b.lang.replace(/ — track 1$/, ' (focus)') : '';
  return lang || regel.label || regel.action;
}

/**
 * De rijen van de APC in een deel: elke control met een regel, [{ knop, tekst, shift }]. `mapping`
 * heeft de fragmenten al (zetFragmenten); de lagen van het deel gaan er even op en weer af.
 */
export function apcRijen(mapping, stand, beschrijf) {
  const oud = mapping.lagen;
  mapping.lagen = () => Object.entries(stand).map(([g, l]) => `${g}.${l}`);
  const rijen = [];
  try {
    for (const [sig, c] of apc.controls) {
      const gewoon = mapping.kies(sig, { shift: false });
      const metShift = mapping.kies(sig, { shift: true });
      if (!gewoon && !metShift) continue;
      rijen.push({ sig, knop: c.label ?? sig, tekst: tekstVan(gewoon ?? metShift, beschrijf),
        shift: metShift && metShift !== gewoon ? tekstVan(metShift, beschrijf) : null });
    }
  } finally { mapping.lagen = oud; }
  return rijen;
}

/** De houd-mapjes van een Mapping als rijen per mapje (welke knop doet wat zolang je hem vasthoudt). */
export function houdRijen(mapping, label, beschrijf) {
  return houdMapjes(mapping).map(({ naam, regels }) => ({
    naam,
    rijen: regels.map((r) => ({ sig: r.in, knop: `${label(r.in) ?? r.in}${r.shift ? ' + shift' : ''}`, tekst: tekstVan(r, beschrijf) })),
  }));
}

/**
 * De spiekbrief: één pagina per apparaat × deel. [{ apparaat, naam (APC/Maschine), deel: { naam,
 * label, kleur }, rijen, houd: [{ naam, rijen }] }]. `apcMapping` = de APC-mapping (standaard of
 * met jouw verschil); `maschineDoc` = de Maschine-mapping (standaard of met jouw verschil);
 * `maschine` = { maakVoorbeeldMaschine, maschineRijen } van de Maschine-kaart (zonder: alleen de APC).
 */
export function spiekbrief(v, { apcMapping, maschineDoc = null, maschine = null, beschrijf, maschineLabel = (s) => s }) {
  const paginas = [];
  const delen = delenVan(v);
  const af = zetFragmenten(apcMapping, v, 'apc40mk2');
  const afMapjes = zetApcMapjes(v);
  try {
    for (const d of delen) {
      paginas.push({ apparaat: 'apc40mk2', naam: 'APC40 mkII', deel: d,
        rijen: apcRijen(apcMapping, apcStandVan(v, d.naam), beschrijf),
        houd: houdRijen(apcMapping, (s) => apc.label(s), beschrijf) });
    }
  } finally { af(); afMapjes(); }
  if (metMaschine(v) && maschineDoc && maschine) {
    for (const d of delen) {
      const m = maschine.maakVoorbeeldMaschine({ doc: maschineDoc, v, deel: d.naam, beschrijf });
      paginas.push({ apparaat: 'maschine-mk2', naam: 'Maschine MK2', deel: d, rijen: maschine.maschineRijen(m),
        houd: houdRijen(m.mapping, maschineLabel, beschrijf) });
    }
  }
  return paginas;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** De spiekbrief als HTML (één <section class="blad"> per pagina; de pagina-indeling doet CSS). */
export function spiekHtml(paginas, { titel = '' } = {}) {
  return paginas.map((p) => {
    const kl = hexVan(p.deel.kleur), tk = tekstOp(p.deel.kleur);
    const rij = (r) => `<tr><td>${esc(r.knop)}</td><td>${esc(r.tekst)}${r.shift ? `<br><i>shift: ${esc(r.shift)}</i>` : ''}</td></tr>`;
    const houd = p.houd.length ? `<h3>vasthouden</h3>${p.houd.map((h) => `<h4>${esc(h.naam.toUpperCase())} vast</h4><table>${h.rijen.map(rij).join('')}</table>`).join('')}` : '';
    return `<section class="blad" data-apparaat="${esc(p.apparaat)}" data-deel="${esc(p.deel.naam ?? '')}" style="--deel:${kl};--deel-tekst:${tk}">
  <header><b>${esc(p.deel.label)}</b><span>${esc(p.naam)}${titel ? ` · ${esc(titel)}` : ''}</span></header>
  <table>${p.rijen.map(rij).join('')}</table>${houd}
</section>`;
  }).join('\n');
}

/** De naam van een mapje voor een kiezer (LAAGNAAM, anders groep.laag). */
export const mapjeNaam = (g, l) => LAAGNAAM[`${g}.${l}`] ?? `${g}.${l}`;
