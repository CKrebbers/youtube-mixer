/**
 * Recept + zaad + wat er is (de catalogus) -> een OPSTELLING: concrete keuzes en beginwaarden.
 * Puur rekenwerk; wie hem toepast (engine/acties-opstelling.js) zet alles via de engine en de bus.
 *
 * catalogus: {
 *   nummers:      [{ id, titel, bpm|null, k (sleutel 0..23)|null, stems: 0|2|4 }]
 *   instrumenten: ['drums', 'poly', …]           wat de audiolaag kent
 *   racks:        ['naam', …]                    racks/sjablonen.json, in volgorde
 *   vormen:       ['lz', 'gs', …]                de vormsystemen van het beeld
 *   smaak:        kern/tocht/smaak.js (optioneel): racks, instrumenten en vormen die je mooi vindt komen vaker
 * }
 * opstelling: {
 *   recept, zaad, naam, toon,
 *   sporen: [{ n, soort, nummer?: { id, titel }, instrument?, rack?: { naam, index }, waarden: { actie: v } }],
 *   patronen: [{ n, plek, patroon, uitleg }],
 *   varianten: { n: [5 × { naam, patroon? , waarden? }] }   rij 1 rustig … 5 vol (de partituur op de APC);
 *                                                          rij 3 = wat het recept zelf koos
 *   beeld: { lagen: [vorm-id], opacity } | null,
 *   macros: [{ rol, naam, waarde, links: [{ actie (uitgeschreven), van, tot, kromme }] }],
 *   scenes, drift
 * }
 */
import { stroom } from './zaad.js';
import { linkWaarde } from './model.js';
import { maakPatroon, toonVan } from './patroon.js';
import { kiesMetSmaak } from '../tocht/smaak.js';

/** De plek waar een opstelling zijn patronen zet: 1–4 blijven van jou (kern/patronen: vijf plekken). */
export const PATROON_PLEK = 5;
/** De partituur: vijf varianten per spoor, van rustig naar vol. */
export const RIJEN = 5;
export const MIDDEN = 3;
const DICHTHEID_RIJ = [0.08, 0.25, null, 0.7, 0.92];
/** Klankstanden van een nummer per rij (stems alleen als het nummer ze heeft; de rest slaat over wat er niet is). */
const KLANK_RIJ = [
  { naam: 'kaal', w: { filter: 0.24, 'stem.drums': 0, 'stem.bass': 0.35, 'fx.mix': 0 } },
  { naam: 'zacht', w: { filter: 0.36, 'stem.drums': 0.45, 'stem.bass': 0.8, 'fx.mix': 0 } },
  { naam: 'vol', w: { filter: 0.5, 'stem.drums': 1, 'stem.bass': 1, laag: 0.5, hoog: 0.5 } },
  { naam: 'druk', w: { filter: 0.5, 'fx.mix': 0.35, 'send.a': 0.2, laag: 0.56 } },
  { naam: 'top', w: { filter: 0.58, 'fx.mix': 0.5, laag: 0.62, hoog: 0.64 } },
];

const tussen = (r, [a, b]) => a + (b - a) * r.r();

/** Een nummer kiezen dat past: bpm in bereik, stems zoals gevraagd, toon dichtbij; anders het beste dat er is. */
export function kiesNummer(kies, nummers, r, { bezet = new Set(), toon = null } = {}) {
  const vrij = nummers.filter((x) => !bezet.has(x.id));
  if (!vrij.length) return null;
  const score = (x) => {
    let s = 0;
    if (kies.bpm && x.bpm) s += x.bpm >= kies.bpm[0] && x.bpm <= kies.bpm[1] ? 3 : -Math.min(3, Math.abs(x.bpm - (kies.bpm[0] + kies.bpm[1]) / 2) / 10);
    else if (kies.bpm) s -= 1;
    if (kies.stems === 'nodig') s += x.stems ? 4 : -10;
    else if (kies.stems === 'liefst' && x.stems) s += 2;
    if (kies.toon === 'past' && toon !== null && x.k !== null && x.k !== undefined) s += (x.k % 12) === (toon % 12) ? 2 : 0;
    return s + r.r() * 1.5;   // toeval binnen het passende: elke keer een ander nummer
  };
  return vrij.map((x) => [score(x), x]).sort((a, b) => b[0] - a[0])[0][1];
}

const vul = (actie, n, focus) => actie.replaceAll('{n}', String(n ?? focus ?? 1));

export function realiseer(recept, zaad, catalogus = {}, { focus = 1 } = {}) {
  const nummers = catalogus.nummers ?? [];
  const instrumenten = catalogus.instrumenten ?? [];
  const racks = catalogus.racks ?? [];
  const vormen = catalogus.vormen ?? [];
  const smaak = catalogus.smaak ?? null;
  const bezet = new Set();
  const sporen = [];
  const patronen = [];
  // Eerst de nummers (die bepalen de toon), dan de instrumenten in die toon.
  const geordend = [...recept.sporen].sort((a, b) => (a.soort === 'nummer' ? 0 : 1) - (b.soort === 'nummer' ? 0 : 1) || a.n - b.n);
  let toonK = null;
  for (const sp of geordend) {
    const rs = stroom(zaad, recept.id, 'spoor', sp.n);
    const uit = { n: sp.n, soort: sp.soort, waarden: {} };
    if (sp.soort === 'nummer') {
      const x = kiesNummer(sp.kies, nummers, rs, { bezet, toon: toonK });
      if (x) { bezet.add(x.id); uit.nummer = { id: x.id, titel: x.titel }; if (toonK === null && Number.isInteger(x.k)) toonK = x.k; }
    } else {
      const mag = sp.kies.uit.filter((s) => !instrumenten.length || instrumenten.includes(s));
      uit.instrument = kiesMetSmaak(rs, mag.length ? mag : sp.kies.uit, smaak, (x) => `inst:${x}`);
      if (uit.instrument === 'korrel' && sp.bron) uit.bron = sp.bron;
      for (const [k, b] of Object.entries(sp.knoppen ?? {})) uit.waarden[`track.${sp.n}.inst.knop.${k}`] = tussen(rs, b);
    }
    if (sp.rack && racks.length) {
      const lijst = sp.rack === 'elk' ? racks : sp.rack.filter((x) => racks.includes(x));
      const naam = kiesMetSmaak(rs, lijst, smaak, (x) => `rack:${x}`);
      if (naam) uit.rack = { naam, index: racks.indexOf(naam) };
    }
    if (sp.mix) uit.waarden[`track.${sp.n}.fx.mix`] = tussen(rs, sp.mix);
    for (const [naam, b] of Object.entries(sp.strip ?? {})) uit.waarden[`track.${sp.n}.${naam}`] = tussen(rs, b);
    sporen.push(uit);
  }
  const toon = toonVan(toonK, stroom(zaad, recept.id, 'toon'));
  for (const sp of recept.sporen) {
    if (sp.soort !== 'instrument' || !sp.patroon) continue;
    const gekozen = sporen.find((x) => x.n === sp.n)?.instrument;
    // Een drumpatroon hoort bij drums; een melodisch patroon niet op een drumstel.
    const soort = gekozen === 'drums' ? 'drums' : sp.patroon.soort === 'drums' ? 'lijn' : sp.patroon.soort;
    const { patroon, uitleg } = maakPatroon({ ...sp.patroon, soort }, zaad, { n: sp.n, toon });
    patronen.push({ n: sp.n, plek: PATROON_PLEK, patroon, uitleg });
  }
  sporen.sort((a, b) => a.n - b.n);
  const varianten = {};
  for (const sp of sporen) {
    const p = patronen.find((x) => x.n === sp.n);
    if (p) {
      const bron = recept.sporen.find((x) => x.n === sp.n).patroon;
      const soort = sp.instrument === 'drums' ? 'drums' : bron.soort === 'drums' ? 'lijn' : bron.soort;
      varianten[sp.n] = DICHTHEID_RIJ.map((d, i) => (d === null
        ? { naam: p.uitleg, patroon: p.patroon }
        : (() => { const m = maakPatroon({ ...bron, soort, dichtheid: [d, d] }, (zaad + 7919 * (i + 1)) >>> 0, { n: sp.n, toon }); return { naam: m.uitleg, patroon: m.patroon }; })()));
    } else if (sp.soort === 'nummer' && sp.nummer) {
      varianten[sp.n] = KLANK_RIJ.map((k) => ({ naam: k.naam, waarden: Object.fromEntries(Object.entries(k.w).map(([a, v]) => [`track.${sp.n}.${a}`, v])) }));
    }
  }
  let beeld = null;
  if (recept.beeld) {
    const rb = stroom(zaad, recept.id, 'beeld');
    const lagen = recept.beeld.lagen.map((l) => kiesMetSmaak(rb, l.uit.filter((x) => !vormen.length || vormen.includes(x)), smaak, (x) => `vorm:${x}`) ?? null).filter(Boolean);
    beeld = { lagen, opacity: tussen(rb, recept.beeld.opacity) };
  }
  const macros = recept.macros.map((m) => {
    const rm = stroom(zaad, recept.id, 'macro', m.rol);
    return {
      rol: m.rol, naam: m.naam, waarde: tussen(rm, m.start),
      links: m.links.map((l) => ({ actie: vul(l.actie, l.spoor, focus), van: l.van, tot: l.tot, kromme: l.kromme })),
    };
  });
  return { recept: recept.id, naam: recept.naam, zaad, toon, sporen, patronen, varianten, beeld, gebaren: recept.gebaren ?? null, macros, scenes: recept.scenes, drift: recept.variatie.drift };
}

/** Wat macro `m` op waarde v op de bus zet: [[actie, waarde], …]. */
export const macroActies = (m, v = m.waarde) => m.links.map((l) => [l.actie, linkWaarde(l, v)]);

/** Een scene: de macrowaarden die erbij horen (een bereik = een trekking met dit zaad, dus elke keer net anders). */
export function sceneWaarden(opstelling, k, zaad = opstelling.zaad) {
  const s = opstelling.scenes?.[k - 1];
  if (!s) return null;
  const r = stroom(zaad, opstelling.recept, 'scene', k);
  const uit = {};
  for (const [rol, b] of Object.entries(s.macros)) uit[rol] = tussen(r, b);
  return uit;
}
