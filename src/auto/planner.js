import { Beatgrid } from '../engine/beatgrid.js';
import { ToonKaart, camelotGetal, isMineur, kortNaam, transponeer } from '../engine/toonsoort.js';

/**
 * De auto-DJ, het rekenwerk: WAT er na deze track komt, HOE de overgang gaat
 * en WANNEER. Puur: geen engine, geen DOM, geen klok van zichzelf. De
 * automaat (automaat.js) voert het uit via de action-bus. docs/AUTO-DJ.md.
 *
 * Drie soorten overgang (het onderzoek van 30 sep: Vande Veire & De Bie 2018,
 * Mixxx, djay, Kim et al. 2020):
 *   blend    lange blend over 16 maten op een frasegrens, bas gewisseld in het
 *            midden (nooit twee bassen tegelijk). Alleen als BEIDE grids daar
 *            zeker zijn, het tempo binnen 6% ligt en de toonsoorten passen.
 *   filter   de uitgaande track filtert weg (highpass) met echo, 8 maten; de
 *            nieuwe valt in op de "1". Als het grid van de uitgaande zeker is
 *            maar tempo of toon niet past.
 *   ambient  beatloos: de uitgaande sluit (lowpass, galm erbij), de nieuwe
 *            opent eronder. Op tijd, niet op de tel. Voor alles waar de grids
 *            onzeker zijn: in Clay's library de hoofdroute, geen noodgeval.
 * De bewakers winnen altijd, ook van een plan dat iets anders vraagt: dan
 * wordt het de veilige soort, met de reden erbij.
 */

export const OVERGANGEN = {
  blend: { naam: 'lange blend', maten: 16 },
  filter: { naam: 'filter-uit', maten: 8 },
  ambient: { naam: 'overvloeien', sec: 24 },
};
/** Hoe ver het tempo mag afwijken voor een blend (Kim et al.: 86% van de tracks < 5%). */
export const TEMPO_MAX = 0.06;
/** Standaard speelduur van een fragment (s): lange mixen en albums speel je in stukken. */
export const SPEELDUUR = 360;
/** Langer dan dit is een nummer een mix of album: dan kiezen we een stuk. */
export const LANG = 12 * 60;
/** Zoveel ruimte laten vóór het einde van het bestand (s). */
const MARGE_EINDE = 6;
/** De overgang wordt minstens zo ver vooruit gepland (s): tijd om te laden en te zien wat er komt. */
export const VOORUIT = 20;

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);

// ---- wat past bij wat --------------------------------------------------------

/**
 * Afstand op het Camelot-wiel: 0 = gelijk, 1 = buren (±1 of A↔B), … ; null
 * als een van beide onbekend is.
 */
export function camelotAfstand(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  const ga = camelotGetal(a), gb = camelotGetal(b);
  const d = Math.abs(ga - gb), rond = Math.min(d, 12 - d);
  return rond + (isMineur(a) !== isMineur(b) ? 1 : 0);
}

/** Relatieve afwijking van twee tempi (0,03 = 3%); null zonder beide. */
export function tempoAfwijking(a, b) {
  return eindig(a) && eindig(b) && a > 0 && b > 0 ? Math.abs(b / a - 1) : null;
}

/**
 * Wat we van een nummer op één plek weten: grid (zeker?), tempo, toon (zeker?).
 * @param track  zoals /api/library hem geeft ({ grid, toon, duur, … })
 * @param t      tracktijd
 */
export function kenmerken(track, t) {
  const grid = track?.grid ? Beatgrid.van(track.grid) : null;
  const kaart = track?.toon ? ToonKaart.van(track.toon) : null;
  const stuk = kaart ? kaart.stukAt(t) : null;
  return {
    grid,
    gridZeker: !!grid && grid.zekerBij(t),
    bpm: grid ? grid.bpmAt(t) : null,
    k: stuk?.k ?? null,
    toonZeker: stuk?.soort === 'zeker',
  };
}

// ---- welk fragment -----------------------------------------------------------

/**
 * Waar een fragment van dit nummer begint en eindigt. Kort: het hele nummer.
 * Lang (mix, album): een stuk, bij voorkeur waar de toonsoort of het grid een
 * nieuw stuk begint en zeker is; `van` uit het plan gaat voor.
 *
 * @param rnd  toeval 0..1 (injecteerbaar voor tests)
 * @returns { van, tot }
 */
export function fragment(track, { van = null, speelduur = null, rnd = Math.random } = {}) {
  const duur = eindig(track?.duur) ? track.duur : 0;
  const eind = Math.max(0, duur - MARGE_EINDE);
  const vast = eindig(speelduur);                 // het plan zegt hoe lang
  if (!vast) speelduur = SPEELDUUR;
  if (eindig(van)) return { van: Math.max(0, Math.min(van, eind)), tot: Math.min(eind, Math.max(0, van) + speelduur) };
  if (duur <= LANG) return { van: 0, tot: vast ? Math.min(eind, speelduur) : eind };
  // Beginpunten: waar een toon- of gridstuk begint, met ruimte voor een heel fragment.
  const kandidaten = [];
  for (const s of track.toon?.stukken || []) if (eindig(s.van)) kandidaten.push({ van: s.van, z: s.zekerheid ?? 0 });
  for (const s of track.grid?.stukken || []) if (eindig(s.van)) kandidaten.push({ van: s.van, z: s.zekerheid ?? 0 });
  const bruikbaar = kandidaten.filter((c) => c.van > 30 && c.van + speelduur <= eind);
  let v;
  if (bruikbaar.length) {
    // De zekerste helft, daaruit een willekeurige: niet elke keer hetzelfde stuk.
    bruikbaar.sort((a, b) => b.z - a.z);
    const top = bruikbaar.slice(0, Math.max(1, Math.ceil(bruikbaar.length / 2)));
    v = top[Math.floor(rnd() * top.length) % top.length].van;
  } else {
    v = Math.floor(rnd() * Math.max(1, eind - speelduur));
  }
  return { van: v, tot: Math.min(eind, v + speelduur) };
}

/**
 * Het volgende nummer kiezen, zonder plan (of als het plan op is). Harde
 * filters: niet wat nu speelt of deze sessie al speelde (tenzij alles al
 * speelde). Daarna een score: tempo dichtbij, toon dichtbij (alleen als beide
 * zeker), luidheid dichtbij, en een beetje toeval.
 *
 * @param huidig  { trackId, bpm, k, toonZeker, loudness } of null
 * @param tracks  library-nummers
 * @param gespeeld Set van track-id's
 * @returns { track, redenen } of null
 */
export function kiesVolgende({ huidig = null, tracks = [], gespeeld = new Set(), rnd = Math.random } = {}) {
  let pool = tracks.filter((t) => t?.id && t.audio && t.id !== huidig?.trackId);
  const nieuw = pool.filter((t) => !gespeeld.has(t.id));
  if (nieuw.length) pool = nieuw;
  if (!pool.length) return null;
  const scores = pool.map((t) => {
    const f = fragment(t, { rnd: () => 0.5 });
    const k = kenmerken(t, f.van);
    const redenen = [];
    let s = rnd() * 0.5;
    const ta = huidig ? tempoAfwijking(huidig.bpm, k.bpm) : null;
    if (ta !== null) { s -= Math.min(3, ta * 20); if (ta <= TEMPO_MAX) redenen.push(`tempo ${Math.round(k.bpm)}`); }
    const ka = huidig?.toonZeker && k.toonZeker ? camelotAfstand(huidig.k, k.k) : null;
    if (ka !== null) { s -= ka * 0.6; if (ka <= 1) redenen.push(`toon past (${kortNaam(k.k)})`); }
    const la = huidig && eindig(huidig.loudness) && eindig(t.loudness_i) ? Math.abs(huidig.loudness - t.loudness_i) : null;
    if (la !== null) s -= Math.min(2, la / 6);
    if (!gespeeld.has(t.id)) s += 0.3;
    return { track: t, s, redenen };
  });
  scores.sort((a, b) => b.s - a.s);
  const beste = scores[0];
  return { track: beste.track, redenen: beste.redenen.length ? beste.redenen : ['nog niet gespeeld'] };
}

// ---- welke overgang ----------------------------------------------------------

/**
 * De soort overgang, met waarom. `voorkeur` (uit het plan) wordt gevolgd als de
 * bewakers het toelaten; anders de veiligste die wel mag.
 *
 * @param uit  kenmerken van de uitgaande op het mengpunt, met `bpm` = wat je HOORT
 * @param in   kenmerken van de nieuwe op zijn beginpunt
 * @returns { type, naam, redenen: [..], veilig: bool }
 */
export function kiesOvergang(uit, inn, { voorkeur = 'auto' } = {}) {
  const redenen = [];
  const ta = tempoAfwijking(uit.bpm, inn.bpm);
  const tempoOk = ta !== null && ta <= TEMPO_MAX;
  // Een blend synct de nieuwe naar het tempo van de uitgaande, en zonder
  // keylock schuift zijn toon mee (6% ≈ een halve toon): vergelijk wat je
  // NA de sync hoort.
  const verschuiving = tempoOk ? 12 * Math.log2(uit.bpm / inn.bpm) : 0;
  const kIn = Number.isInteger(inn.k) ? transponeer(inn.k, verschuiving) : null;
  const ka = uit.toonZeker && inn.toonZeker ? camelotAfstand(uit.k, kIn) : null;
  const toonOk = ka === null || ka <= 1;
  const beideZeker = uit.gridZeker && inn.gridZeker;

  let mag = 'ambient';
  if (beideZeker && tempoOk && toonOk) mag = 'blend';
  else if (uit.gridZeker) mag = 'filter';

  if (mag === 'blend') {
    redenen.push(`beide grids zeker, tempo ${Math.round(inn.bpm)} ≈ ${Math.round(uit.bpm)}`);
    if (ka !== null) redenen.push(ka === 0 ? 'zelfde toon' : 'toon naast elkaar');
    else redenen.push('toon niet zeker: let op');
  } else if (mag === 'filter') {
    if (!inn.gridZeker) redenen.push('grid van de nieuwe onzeker');
    else if (!tempoOk) redenen.push(`tempo te ver uit elkaar (${Math.round(uit.bpm)} → ${Math.round(inn.bpm)})`);
    else if (!toonOk) redenen.push(`toonsoorten botsen (${kortNaam(uit.k)} → ${kortNaam(kIn)})`);
    redenen.push('uitfilteren en op de 1 invallen');
  } else {
    redenen.push(uit.grid ? 'grid onzeker: beatloos overvloeien' : 'geen grid: beatloos overvloeien');
  }

  const rang = { ambient: 0, filter: 1, blend: 2 };
  let type = mag;
  if (voorkeur in rang && voorkeur !== mag) {
    if (rang[voorkeur] <= rang[mag]) { type = voorkeur; redenen.unshift(`plan: ${OVERGANGEN[voorkeur].naam}`); }
    else redenen.unshift(`plan wilde ${OVERGANGEN[voorkeur].naam}, maar dat klinkt hier niet goed`);
  }
  return { type, naam: OVERGANGEN[type].naam, redenen, veilig: type !== 'blend' };
}

// ---- wanneer -------------------------------------------------------------------

/**
 * Het begin van de overgang in de TRACKTIJD van de uitgaande, en hoe lang hij
 * duurt (ook in tracktijd).
 *
 * Blend en filter: op een frasegrens. Een blend eindigt zo dicht mogelijk
 * vóór `eind` en begint op een veelvoud van 16 maten vanaf het maat-anker
 * van het stuk (Beatgrid.volgendeVeelvoud); past dat niet meer (te laat), dan
 * de eerstvolgende 4-maatsgrens. Ambient: op tijd.
 *
 * @param grid     Beatgrid van de uitgaande (null bij ambient mag)
 * @param positie  waar de uitgaande nu is (tracktijd)
 * @param eind     waar hij klaar moet zijn (tracktijd)
 * @param rate     afspeelsnelheid van de uitgaande (seconden → tracktijd)
 * @param vooruit  minstens zoveel seconden vanaf nu
 * @param lengte   eigen lengte uit het plan: { maten } of { sec } (null = standaard)
 * @returns { start, lengte, maten? }
 */
export function planMoment({ type, grid = null, positie, eind, rate = 1, vooruit = VOORUIT, lengte: eigen = null }) {
  const vroegst = positie + vooruit * rate;
  if (type === 'ambient' || !grid) {
    const sec = overgangSec({ type: 'ambient', lengte: eigen, bpm: grid ? grid.bpmAt(eind) * rate : null });
    const lengte = sec * rate;
    return { start: Math.max(vroegst, eind - lengte), lengte };
  }
  const maten = overgangMaten({ type, lengte: eigen, bpm: grid.bpmAt(eind), bpb: grid.beatsPerBar || 4 });
  const bpb = grid.beatsPerBar || 4;
  const tellen = maten * bpb;
  const ideaal = grid.beatAt(eind) - tellen;
  const min = grid.beatAt(vroegst);
  let b;
  if (ideaal >= min) {
    b = grid.volgendeVeelvoud(ideaal - 16 * bpb + 1e-6, 16 * bpb);      // de laatste 16-maatsgrens ≤ ideaal
    if (b > ideaal + 1e-6 || b < min) b = grid.volgendeVeelvoud(Math.max(min, ideaal - 4 * bpb), 4 * bpb);
  } else {
    b = grid.volgendeVeelvoud(min, 4 * bpb);
  }
  const start = grid.timeOf(b);
  return { start, lengte: grid.timeOf(b + tellen) - start, maten, tel: b };
}

/** Maten van een blend of filter: uit het plan (maten, of seconden omgerekend), anders de standaard. */
export function overgangMaten({ type, lengte = null, bpm = null, bpb = 4 }) {
  if (eindig(lengte?.maten)) return Math.max(2, Math.round(lengte.maten));
  if (eindig(lengte?.sec) && eindig(bpm) && bpm > 0) return Math.max(2, Math.round(lengte.sec / (bpb * 60 / bpm)));
  return OVERGANGEN[type]?.maten ?? 8;
}

/** Seconden van een overgang (beatloos: uit het plan of 24 s; blend/filter: maten op dit tempo). */
export function overgangSec({ type, lengte = null, bpm = null, bpb = 4 }) {
  if (type === 'ambient' || !eindig(bpm) || bpm <= 0) {
    if (eindig(lengte?.sec)) return lengte.sec;
    if (eindig(lengte?.maten) && eindig(bpm) && bpm > 0) return lengte.maten * bpb * 60 / bpm;
    return OVERGANGEN.ambient.sec;
  }
  return overgangMaten({ type, lengte, bpm, bpb }) * bpb * 60 / bpm;
}

// ---- hoe: de curves ------------------------------------------------------------

const cosUit = (x) => Math.cos(Math.min(1, Math.max(0, x)) * Math.PI / 2);
const sinIn = (x) => Math.sin(Math.min(1, Math.max(0, x)) * Math.PI / 2);

/**
 * De knopstanden op voortgang p (0..1) van de overgang, als waarden 0..1 van
 * de bus (regel 2): fader, low (0,5 = 0 dB, 0 = weg), filter (0,5 = open,
 * < 0,5 lowpass, > 0,5 highpass), sendA (echo), sendB (galm). `basis` zijn de
 * sends zoals ze stonden: daar gaan ze naartoe terug.
 *
 * `start: true` bij de nieuwe = hij moet nu spelen (de automaat start hem op
 * de maat of meteen).
 */
export function standen(type, p, basis = { uitA: 0, uitB: 0, inA: 0, inB: 0 }) {
  const q = Math.min(1, Math.max(0, p));
  if (type === 'blend') {
    // Equal power, en de bas in het midden gewisseld: nooit twee bassen.
    const helft = q >= 0.5;
    return {
      uit: { fader: helft ? cosUit((q - 0.5) / 0.5) : 1, low: helft ? 0 : 0.5, filter: 0.5, sendA: basis.uitA, sendB: basis.uitB },
      in: { fader: helft ? 1 : sinIn(q / 0.5), low: helft ? 0.5 : 0, filter: 0.5, sendA: basis.inA, sendB: basis.inB, start: true },
    };
  }
  if (type === 'filter') {
    // Highpass omhoog en echo erbij; op het eind valt de nieuwe vol in.
    const klaar = q >= 1;
    return {
      uit: { fader: klaar ? 0 : 1, low: 0.5, filter: 0.5 + 0.42 * q, sendA: basis.uitA + (0.65 - basis.uitA) * q, sendB: basis.uitB },
      in: { fader: 1, low: 0.5, filter: 0.5, sendA: basis.inA, sendB: basis.inB, start: klaar },
    };
  }
  // ambient: de uitgaande sluit en galmt weg, de nieuwe opent eronder.
  return {
    uit: { fader: q < 0.4 ? 1 : cosUit((q - 0.4) / 0.6), low: 0.5, filter: 0.5 - 0.35 * q, sendA: basis.uitA,
      sendB: basis.uitB + (Math.max(basis.uitB, 0.55) - basis.uitB) * Math.min(1, q / 0.5) },
    in: { fader: sinIn(q / 0.6), low: 0.5, filter: 0.25 + 0.25 * Math.min(1, q / 0.7), sendA: basis.inA, sendB: basis.inB, start: true },
  };
}

/** Beginstand van de nieuwe track vóór de overgang (hij staat klaar, stil). */
export function klaarStand(type) {
  const s = standen(type, 0);
  return { fader: type === 'filter' ? 1 : 0, low: s.in.low, filter: s.in.filter };
}
