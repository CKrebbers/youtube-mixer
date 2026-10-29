/**
 * Spelen met een opstelling, zodat hij nooit twee keer hetzelfde wordt. Puur: elke bewerking
 * krijgt het zaad mee en geeft een NIEUWE opstelling of nieuwe macrowaarden terug.
 *
 *   muteer(o, zaad, hoeveel)    de macro's een stap opzij, en met kans `hoeveel` één keuze opnieuw
 *                               (ander nummer, ander rack, ander patroon) — "Mutatie" van de Stroommachine
 *   kruis(a, b, zaad)           per macro en per spoor de helft van a en de helft van b ("Kweek")
 *   drift(o, tel, variatie)     waar de macro's op deze tel naartoe zweven (de opstelling speelt zelf mee,
 *                               AVBRNC-autonomie): elke 4 maten een nieuw doel, glad ertussen
 *   genereer(catalogus, zaad)   een NIEUW recept uit alle bouwstenen die er zijn (de bouwdoos hieronder)
 */
import { stroom } from './zaad.js';
import { ROLLEN, normaliseerRecept } from './model.js';
import { realiseer, kiesNummer } from './realiseer.js';
import { maakPatroon, toonVan } from './patroon.js';

const klem01 = (v) => Math.min(1, Math.max(0, v));

export function muteer(o, zaad, hoeveel = 0.3, catalogus = {}) {
  const r = stroom(zaad, o.recept, 'muteer');
  const breedte = 0.05 + hoeveel * 0.3;
  const macros = o.macros.map((m) => (m.rol === 'variatie' ? m : { ...m, waarde: r.rond(m.waarde, breedte) }));
  let sporen = o.sporen;
  let patronen = o.patronen;
  let wat = 'macro\'s';
  if (r.kans(hoeveel)) {
    const kandidaten = [
      ...o.sporen.filter((s) => s.soort === 'nummer' && catalogus.nummers?.length > 1).map((s) => ['nummer', s]),
      ...o.sporen.filter((s) => s.rack && catalogus.racks?.length > 1).map((s) => ['rack', s]),
      ...o.patronen.map((p) => ['patroon', p]),
    ];
    const keuze = r.kies(kandidaten);
    if (keuze?.[0] === 'nummer') {
      const bezet = new Set(o.sporen.map((s) => s.nummer?.id).filter(Boolean));
      const x = kiesNummer({ bpm: null, stems: 'maakt-niet-uit' }, catalogus.nummers, r, { bezet });
      if (x) { sporen = o.sporen.map((s) => (s === keuze[1] ? { ...s, nummer: { id: x.id, titel: x.titel } } : s)); wat = `nummer op ${keuze[1].n}`; }
    } else if (keuze?.[0] === 'rack') {
      const naam = r.kies(catalogus.racks.filter((x) => x !== keuze[1].rack.naam));
      sporen = o.sporen.map((s) => (s === keuze[1] ? { ...s, rack: { naam, index: catalogus.racks.indexOf(naam) } } : s));
      wat = `rack op ${keuze[1].n}`;
    } else if (keuze?.[0] === 'patroon') {
      const p = keuze[1];
      const soort = p.uitleg.startsWith('kick') ? 'drums' : p.uitleg.split(' ')[0];
      const nieuw = maakPatroon({ soort, dichtheid: [0.2, 0.8], lengte: [p.patroon.lengte] }, zaad, { n: p.n, toon: o.toon });
      patronen = o.patronen.map((x) => (x === p ? { ...p, patroon: nieuw.patroon, uitleg: nieuw.uitleg } : x));
      wat = `patroon op ${p.n}`;
    }
  }
  return { opstelling: { ...o, zaad, macros, sporen, patronen }, wat };
}

export function kruis(a, b, zaad) {
  if (!b || a.recept !== b.recept) return { opstelling: { ...a, zaad }, wat: 'niets om mee te kruisen' };
  const r = stroom(zaad, a.recept, 'kruis');
  const macros = a.macros.map((m, i) => (r.kans(0.5) && b.macros[i] ? { ...m, waarde: b.macros[i].waarde } : m));
  const sporen = a.sporen.map((s) => { const t = b.sporen.find((x) => x.n === s.n); return t && r.kans(0.5) ? t : s; });
  const patronen = a.patronen.map((p) => { const q = b.patronen.find((x) => x.n === p.n); return q && r.kans(0.5) ? q : p; });
  return { opstelling: { ...a, zaad, macros, sporen, patronen }, wat: 'gekruist met de vorige' };
}

const glad = (x) => x * x * (3 - 2 * x);

/**
 * Waar de macro's op tel `tel` (de maatklok) naartoe zweven. `basis` = de waarden die de speler
 * zette; de drift beweegt eromheen, nooit verder dan `variatie × drift × 0,35`. Herhaalbaar per
 * (zaad, vak van 16 tellen): terugspoelen = dezelfde beweging.
 */
export function drift(o, tel, variatie, basis) {
  const hoeveel = klem01(variatie) * (o.drift ?? 0.3) * 0.35;
  if (!(hoeveel > 0) || !Number.isFinite(tel)) return basis.slice();
  const vak = Math.floor(tel / 16), f = glad((tel / 16) - vak);
  return o.macros.map((m, i) => {
    if (m.rol === 'variatie') return basis[i];
    const a = stroom(o.zaad, o.recept, 'drift', m.rol, vak).r() * 2 - 1;
    const b = stroom(o.zaad, o.recept, 'drift', m.rol, vak + 1).r() * 2 - 1;
    return klem01(basis[i] + (a + (b - a) * f) * hoeveel);
  });
}

// ---- de bouwdoos: wat elke rol kan raken, met de acties die v2 heeft -----------------------
// {n} = de track van het spoor (realiseer vult hem in). `wie`: op welke sporen ('nummer', 'instrument', 'alle').
const BOUWDOOS = {
  schaal: [
    { naam: 'filter', wie: 'nummer', link: { actie: 'track.{n}.filter', van: 0.5, tot: 0.12, kromme: 's' } },
    { naam: 'open', wie: 'alle', link: { actie: 'track.{n}.filter', van: 0.5, tot: 0.85, kromme: 'lin' } },
  ],
  dichtheid: [
    { naam: 'laag', wie: 'instrument', link: { actie: 'track.{n}.fader', van: 0, tot: 0.85, kromme: 'log' } },
    { naam: 'drums', wie: 'nummer', link: { actie: 'track.{n}.stem.drums', van: 0.2, tot: 1, kromme: 'lin' } },
  ],
  beweging: [
    { naam: 'fx 1', wie: 'alle', link: { actie: 'track.{n}.fx.knop.1', van: 0.1, tot: 0.9, kromme: 'lin' } },
    { naam: 'puls', wie: 'beeld', link: { actie: 'video.pulse', van: 0, tot: 0.8, kromme: 'lin' } },
  ],
  vervorming: [
    { naam: 'fx', wie: 'alle', link: { actie: 'track.{n}.fx.mix', van: 0, tot: 0.75, kromme: 'exp' } },
    { naam: 'fx 2', wie: 'alle', link: { actie: 'track.{n}.fx.knop.2', van: 0.1, tot: 0.9, kromme: 'lin' } },
  ],
  kleur: [
    { naam: 'toon', wie: 'alle', link: { actie: 'track.{n}.hoog', van: 0.35, tot: 0.65, kromme: 'lin' } },
    { naam: 'klank', wie: 'instrument', link: { actie: 'track.{n}.inst.knop.1', van: 0.15, tot: 0.85, kromme: 'lin' } },
  ],
  helderheid: [
    { naam: 'beeld', wie: 'beeld', link: { actie: 'video.master', van: 0.3, tot: 1, kromme: 'log' } },
    { naam: 'laag', wie: 'beeld', link: { actie: 'video.layer.opacity', van: 0.1, tot: 1, kromme: 'lin' } },
  ],
  ruimte: [
    { naam: 'galm', wie: 'alle', link: { actie: 'track.{n}.send.b', van: 0, tot: 0.6, kromme: 'exp' } },
    { naam: 'echo', wie: 'alle', link: { actie: 'track.{n}.send.a', van: 0, tot: 0.5, kromme: 'exp' } },
  ],
};
/** Wat een spoor kan zijn, met zijn kans en wat erbij hoort. */
const SPOOR_SOORTEN = [
  { gewicht: 3, maak: (r) => ({ soort: 'nummer', kies: { bpm: r.kans(0.5) ? [110, 130] : null, stems: r.kies(['liefst', 'maakt-niet-uit']), toon: 'past' }, rack: 'elk', mix: [0, 0.3], strip: { fader: [0.7, 0.9] } }) },
  { gewicht: 2, maak: (r) => ({ soort: 'instrument', kies: { uit: ['drums'] }, patroon: { soort: 'drums', dichtheid: [0.25, 0.75], lengte: [16, 32] }, strip: { fader: [0.6, 0.85] } }) },
  { gewicht: 2, maak: (r) => ({ soort: 'instrument', kies: { uit: ['poly', 'fm'] }, patroon: { soort: r.kies(['bas', 'lijn', 'akkoord']), dichtheid: [0.2, 0.7], lengte: [16, 32] }, rack: 'elk', mix: [0, 0.4], strip: { fader: [0.5, 0.8] }, knoppen: { 1: [0.2, 0.8], 2: [0.2, 0.8] } }) },
  { gewicht: 1, maak: (r) => ({ soort: 'instrument', kies: { uit: ['schaal'] }, patroon: { soort: 'lijn', dichtheid: [0.1, 0.4], lengte: [32] }, strip: { fader: [0.4, 0.7] } }) },
];
const NAMEN_A = ['Nacht', 'Stroom', 'Kristal', 'Stof', 'Puls', 'Diep', 'Glas', 'Motor', 'Mist', 'Koraal', 'Vonk', 'Getij'];
const NAMEN_B = ['veld', 'lijn', 'kamer', 'zee', 'werk', 'boog', 'wolk', 'kern', 'gang', 'zand'];

/**
 * Een nieuw recept uit de bouwdoos: 2–5 sporen (kolommen 1..), per rol een link op een passend spoor,
 * vijf scenes (rust, opbouw, vol, breuk, uitloop). Het recept is gewone data: bewaren = een nieuw template.
 */
export function genereer(catalogus = {}, zaad = 1, { beeld = true } = {}) {
  const r = stroom(zaad, 'genereer');
  const aantal = r.geheel(2, 5);
  const sporen = [];
  const pot = SPOOR_SOORTEN.flatMap((s) => Array(s.gewicht).fill(s));
  const isDrums = (sp) => sp.soort === 'instrument' && sp.kies.uit.includes('drums');
  for (let n = 1; n <= aantal; n++) {
    let sp = r.kies(pot).maak(r);
    if (sp.soort === 'nummer' && !(catalogus.nummers?.length)) sp = r.kies([SPOOR_SOORTEN[1], SPOOR_SOORTEN[2], SPOOR_SOORTEN[3]]).maak(r);
    // Eén drumstel per recept: een tweede wordt een melodisch instrument.
    if (isDrums(sp) && sporen.some(isDrums)) sp = r.kies([SPOOR_SOORTEN[2], SPOOR_SOORTEN[3]]).maak(r);
    sporen.push({ n, ...sp });
  }
  if (!sporen.some((s) => s.soort === 'instrument' && s.kies.uit.includes('drums')) && r.kans(0.7) && aantal < 8) {
    sporen.push({ n: sporen.length + 1, ...SPOOR_SOORTEN[1].maak(r) });
  }
  const opSpoor = (wie) => {
    const lijst = wie === 'alle' ? sporen : sporen.filter((s) => s.soort === wie);
    return r.kies(lijst)?.n ?? null;
  };
  const macros = [];
  for (const rol of ROLLEN) {
    if (rol === 'variatie') { macros.push({ rol, naam: 'variatie', start: [0.3, 0.6], links: [] }); continue; }
    const keuzes = BOUWDOOS[rol].filter((b) => (b.wie === 'beeld' ? beeld : sporen.some((s) => b.wie === 'alle' || s.soort === b.wie)));
    const b = r.kies(keuzes);
    if (!b) continue;
    const links = [];
    if (b.wie === 'beeld') links.push({ ...b.link });
    else {
      // Eén of twee sporen: een macro die twee dingen tegelijk beweegt voelt als één gebaar.
      const eerste = opSpoor(b.wie);
      links.push({ ...b.link, spoor: eerste });
      const tweede = opSpoor(b.wie);
      if (tweede !== null && tweede !== eerste && r.kans(0.4)) links.push({ ...b.link, spoor: tweede });
    }
    macros.push({ rol, naam: b.naam, start: [0.3, 0.6], links });
  }
  const scenes = [
    { naam: 'rust', macros: { dichtheid: [0.1, 0.3], ruimte: [0.5, 0.8], schaal: [0.5, 0.8], vervorming: [0, 0.2] } },
    { naam: 'opbouw', macros: { dichtheid: [0.4, 0.6], ruimte: [0.3, 0.5], schaal: [0.3, 0.5], beweging: [0.4, 0.7] } },
    { naam: 'vol', macros: { dichtheid: [0.8, 1], ruimte: [0.1, 0.3], schaal: [0, 0.15], helderheid: [0.8, 1] } },
    { naam: 'breuk', macros: { dichtheid: [0, 0.2], vervorming: [0.6, 0.9], ruimte: [0.6, 0.9], schaal: [0.6, 0.9] } },
    { naam: 'uitloop', macros: { dichtheid: [0.2, 0.4], ruimte: [0.7, 1], helderheid: [0.2, 0.4], beweging: [0.1, 0.3] } },
  ];
  const vormen = catalogus.vormen ?? [];
  const naam = `${r.kies(NAMEN_A)}${r.kies(NAMEN_B)}`;
  const { recept } = normaliseerRecept({
    schema: 1, id: `gen-${zaad}`, naam, uitleg: `gemaakt uit de bouwdoos (zaad ${zaad})`, kleur: r.kies(['cyaan', 'magenta', 'oranje', 'limoen', 'violet', 'geel']),
    sporen, macros, scenes,
    beeld: beeld && vormen.length ? { lagen: [{ uit: r.schud(vormen).slice(0, 4) }], opacity: [0.5, 0.9] } : null,
    variatie: { drift: r.tussen(0.2, 0.6) },
  });
  return recept;
}

/** Herrollen: hetzelfde recept, een ander zaad (een heel andere avond binnen dezelfde regels). */
export const herrol = (recept, zaad, catalogus, opties) => realiseer(recept, zaad, catalogus, opties);

export { toonVan };
