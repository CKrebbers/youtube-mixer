/**
 * De auto-DJ, het rekenwerk: WAT er na dit nummer komt, HOE de overgang gaat en
 * WANNEER. Puur: geen engine, geen DOM, geen tijd van zichzelf. De automaat
 * (automaat.js) voert het uit via de bus.
 *
 * Herkomst: v1 src/auto/planner.js (docs/AUTO-DJ.md, gebouwd 30 sep, getest in
 * test/auto.test.mjs). Wat in v2 anders is:
 *   - Er is één MAATKLOK. Een gekoppeld nummer loopt op de klok, dus "het tempo na
 *     de sync" is het tempo van de klok en een frasegrens is een veelvoud van 16
 *     maten van de KLOK (de "1" ligt op klok-tel 0, perMaat, …). planMoment rekent
 *     voor blend en filter daarom in klok-tellen, niet in de tracktijd van de
 *     uitgaande; alleen overvloeien (beatloos) rekent nog op tijd.
 *   - Geen keylock: de toon schuift altijd mee met de snelheid (12·log2(rate)).
 *   - De bas wisselt in ALLE drie de curves in het midden (v1 alleen bij de blend):
 *     ook bij overvloeien staan er nooit twee bassen open.
 *   - Nog geen secties en geen plan (v2 heeft ze nog niet); kiesVolgende kent
 *     "past bij" (v1 src/ui/past-bij.js) als bonus in de score.
 *
 * Drie soorten overgang (het onderzoek van 30 sep: Vande Veire & De Bie 2018,
 * Mixxx, djay, Kim et al. 2020):
 *   blend    16 maten op een frasegrens van de klok, bas gewisseld in het midden.
 *            Alleen als BEIDE grids zeker zijn (sync mag), het tempo binnen 6% en
 *            de toon na de sync hooguit één stap op het Camelot-wiel.
 *   filter   de uitgaande filtert weg (highpass) met echo, 8 maten; de nieuwe valt
 *            in op de "1". Als de uitgaande op de klok loopt maar het andere niet past.
 *   ambient  beatloos: de uitgaande sluit (lowpass, galm erbij), de nieuwe opent
 *            eronder. Op tijd, niet op de tel. Als de uitgaande niet op de klok loopt.
 * De bewakers winnen altijd, ook van een voorkeur: dan wordt het de veiligste.
 */
import { Beatgrid } from '../kern/grid.js';

export const OVERGANGEN = Object.freeze({
  blend: { naam: 'lange blend', maten: 16 },
  filter: { naam: 'filter-uit', maten: 8 },
  ambient: { naam: 'overvloeien', sec: 24 },
});
/** Hoe ver het tempo mag afwijken voor een blend (Kim et al.: 86% van de tracks < 5%). */
export const TEMPO_MAX = 0.06;
/** Tot hoever "bijna past" nog meegaat (v1 past-bij). */
export const TEMPO_BIJNA = 0.10;
/** Standaard speelduur van een fragment (s): lange mixen en albums speel je in stukken. */
export const SPEELDUUR = 360;
/** Langer dan dit is een nummer een mix of album: dan kiezen we een stuk. */
export const LANG = 12 * 60;
/** Zoveel ruimte laten vóór het einde van het bestand (s). */
export const MARGE_EINDE = 6;
/** De overgang wordt minstens zo ver vooruit gepland (s klok). */
export const VOORUIT = 8;
/** Een frase is zoveel maten; past die niet meer, dan een veelvoud van KORT maten. */
export const FRASE = 16;
export const KORT = 4;
/**
 * Wanneer telt een bas als OPEN (voor de bewaking "nooit twee bassen"): de laag-knop boven de
 * kill (strip.js EQ_KILL_KNOP 0,03) en het filter niet zo ver naar rechts dat de highpass de
 * bas al weghaalt (0,66 ≈ 150 Hz: filterDoelen geeft rechts expMap(d, 20, 9000)).
 */
export const BAS_KILL = 0.03;
export const BAS_HPF = 0.66;

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
const mod12 = (x) => ((x % 12) + 12) % 12;

// ---- toonsoort (v1 src/engine/toonsoort.js, alleen wat de auto-DJ nodig heeft) ----------
// Een sleutel k: 0..11 = majeur op toonklasse k (C = 0), 12..23 = mineur op k − 12.

const isSleutel = (k) => Number.isInteger(k) && k >= 0 && k < 24;
const isMineur = (k) => k >= 12;
const KORT_MAJ = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const KORT_MIN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

/** "F", "F#m", "Dbm", "E♭", "Bb minor" (of al een sleutel) → 0..23, anders null. */
export function leesToon(s) {
  if (isSleutel(s)) return s;
  if (s && typeof s === 'object') return leesToon(s.toonsoort ?? s.k ?? null);
  const m = /^\s*([A-Ga-g])\s*(#|♯|b|♭)?\s*(m|min|minor|mineur)?\s*(maj|major|majeur)?\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const basis = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const vt = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const t = mod12(basis + vt);
  return m[3] ? 12 + t : t;
}

/** Korte naam op het scherm: `G`, `B♭m`; null zonder sleutel. */
export const toonNaam = (k) => (isSleutel(k) ? (isMineur(k) ? `${KORT_MIN[k - 12]}m` : KORT_MAJ[k]) : null);

/** Een aantal halve tonen verschuiven (afgerond); majeur/mineur blijft. */
export const transponeer = (k, halveTonen) => (isSleutel(k)
  ? (isMineur(k) ? 12 : 0) + mod12((k % 12) + Math.round(halveTonen))
  : null);

/** Camelot-getal 1..12: C majeur = 8B, elke kwint omhoog +1; mineur = dat van zijn relatieve majeur. */
function camelotGetal(k) {
  const t = isMineur(k) ? ((k % 12) + 3) % 12 : k;
  return mod12(7 * t + 7) + 1;
}

/** Afstand op het Camelot-wiel: 0 = gelijk, 1 = buren (±1 of A↔B), …; null als er een ontbreekt. */
export function camelotAfstand(a, b) {
  if (!isSleutel(a) || !isSleutel(b)) return null;
  const d = Math.abs(camelotGetal(a) - camelotGetal(b));
  return Math.min(d, 12 - d) + (isMineur(a) !== isMineur(b) ? 1 : 0);
}

/** Relatieve afwijking van twee tempi (0,03 = 3%); null zonder beide. */
export function tempoAfwijking(a, b) {
  return eindig(a) && eindig(b) && a > 0 && b > 0 ? Math.abs(b / a - 1) : null;
}

/** Halve tonen die een snelheid erbij doet (geen keylock in v2): 12·log2(rate). */
export const halveTonenVan = (rate) => (eindig(rate) && rate > 0 ? 12 * Math.log2(rate) : 0);

// ---- wat we van een nummer weten -----------------------------------------------------

/** Het grid van een library-nummer (v1-JSON, of de korte `gridLijst` van een demo), of null. */
export function gridVanNummer(nummer) {
  const g = nummer?.grid ?? nummer?.gridLijst ?? null;
  return g instanceof Beatgrid ? g : Beatgrid.van(g);
}

/**
 * Wat we van een library-nummer op tracktijd t weten, ZONDER dat hij geladen is:
 * grid (sync mag = syncBij), tempo van de plaat, toon van de plaat.
 * De toon komt als tekst ("Am") of sleutel; `toonZeker` alleen als het nummer het zegt
 * (zonder: een toon die er staat telt als zeker, dat is de VOORZICHTIGE kant: een
 * botsing maakt van een blend een filter, nooit andersom).
 */
export function kenmerken(nummer, t = 0) {
  const grid = gridVanNummer(nummer);
  const k = leesToon(nummer?.toon ?? null);
  return {
    grid,
    gridZeker: !!grid && grid.syncBij(t),
    bpm: grid ? grid.bpmAt(t) : null,
    k,
    toonZeker: k !== null && nummer?.toonZeker !== false,
  };
}

// ---- welk fragment ---------------------------------------------------------------------

/**
 * Waar een fragment van dit nummer begint en eindigt (tracktijd). Kort: het hele
 * nummer. Lang (mix, album): een stuk van SPEELDUUR, bij voorkeur waar een zeker
 * gridstuk begint. `van` en `speelduur` (straks van een plan) gaan voor.
 * @param rnd toeval 0..1 (injecteerbaar voor tests)
 */
export function fragment(nummer, { van = null, speelduur = null, rnd = Math.random } = {}) {
  const duur = eindig(nummer?.duur) ? nummer.duur : 0;
  const eind = Math.max(0, duur - MARGE_EINDE);
  const vast = eindig(speelduur);
  const sd = vast ? speelduur : SPEELDUUR;
  if (eindig(van)) return { van: Math.max(0, Math.min(van, eind)), tot: Math.min(eind, Math.max(0, van) + sd) };
  if (duur <= LANG) return { van: 0, tot: vast ? Math.min(eind, sd) : eind };
  const stukken = (nummer.grid?.stukken || []).filter((s) => eindig(s.van) && s.van > 30 && s.van + sd <= eind);
  let v;
  if (stukken.length) {
    // De zekerste helft, daaruit een willekeurige: niet elke keer hetzelfde stuk.
    stukken.sort((a, b) => (b.zekerheid ?? 1) - (a.zekerheid ?? 1));
    const top = stukken.slice(0, Math.max(1, Math.ceil(stukken.length / 2)));
    v = top[Math.floor(rnd() * top.length) % top.length].van;
  } else {
    v = Math.floor(rnd() * Math.max(1, eind - sd));
  }
  return { van: v, tot: Math.min(eind, v + sd) };
}

// ---- wat past bij wat (v1 src/ui/past-bij.js) ---------------------------------------------

/**
 * Eén paar: uitgaande → nieuwe, met dezelfde regels als de bewakers (kiesOvergang).
 * `uit.bpm` = wat je HOORT (de klok), `uit.k` = de toon die je hoort; de nieuwe op de plaat.
 *   goed   tempo ≤ 6% en de toon na de sync ≤ 1 stap
 *   bijna  tempo ≤ 6% met 2 stappen, tempo 6–10% met ≤ 1 stap, of half/dubbel tempo met ≤ 1
 * @returns { soort, tempo, stappen, half, waarom, score } of null (past niet, of niets te zeggen)
 */
export function beoordeel(uit, inn) {
  const ta = tempoAfwijking(uit?.bpm, inn?.bpm);
  if (ta === null) return null;
  const factor = [1, 2, 0.5].reduce((best, k) => (Math.abs(inn.bpm * k / uit.bpm - 1) < Math.abs(inn.bpm * best / uit.bpm - 1) ? k : best), 1);
  const half = factor !== 1 && ta > TEMPO_BIJNA;
  const tempo = half ? Math.abs(inn.bpm * factor / uit.bpm - 1) : ta;
  if (tempo > (half ? TEMPO_MAX : TEMPO_BIJNA)) return null;
  // De toon NA de sync: zonder keylock schuift hij mee met het tempo.
  const kIn = isSleutel(inn.k) ? transponeer(inn.k, halveTonenVan(uit.bpm / (inn.bpm * (half ? factor : 1)))) : null;
  const stappen = isSleutel(uit.k) && kIn !== null ? camelotAfstand(uit.k, kIn) : null;
  let soort = null;
  const waarom = [];
  if (stappen === null) {
    if (!half && tempo <= TEMPO_MAX) { soort = 'goed'; waarom.push('toon onbekend'); }
  } else if (!half && tempo <= TEMPO_MAX && stappen <= 1) soort = 'goed';
  else if (!half && tempo <= TEMPO_MAX && stappen === 2) { soort = 'bijna'; waarom.push('toon 2 stappen'); }
  else if (!half && tempo <= TEMPO_BIJNA && stappen <= 1) { soort = 'bijna'; waarom.push('tempo 6–10%: ver pitchen'); }
  else if (half && stappen <= 1) { soort = 'bijna'; waarom.push('half/dubbel tempo'); }
  if (!soort) return null;
  if (soort === 'goed' && stappen !== null) waarom.push(stappen === 0 ? 'zelfde toon' : 'toon naast elkaar');
  const score = (soort === 'goed' ? 0 : 10) + tempo * 20 + (stappen ?? 1);
  return { soort, tempo, stappen, half, waarom: waarom.join(' · '), score };
}

/**
 * Het volgende nummer kiezen (zonder plan). Harde filters: niet wat nu speelt, niet wat
 * deze sessie al speelde of overgeslagen werd (tenzij alles al speelde). Daarna een score:
 * tempo dichtbij, toon dichtbij, "past bij", luidheid dichtbij en een beetje toeval.
 *
 * Anders dan v1: een nummer ZONDER tempo krijgt een straf als het huidige een tempo heeft
 * (in v1 telde "onbekend" als "geen verschil", zodat een pad zonder grid boven een nummer
 * op 1,6% kon eindigen).
 *
 * @param huidig   { id, bpm (wat je hoort), k (wat je hoort), toonZeker, loudness } of null
 * @param nummers  library-nummers ({ id, titel, duur, grid, toon, … })
 * @param gespeeld Set van id's die niet meer hoeven (gespeeld, overgeslagen)
 * @returns { nummer, redenen } of null
 */
export function kiesVolgende({ huidig = null, nummers = [], gespeeld = new Set(), rnd = Math.random } = {}) {
  let pool = nummers.filter((t) => t?.id && t.audio !== false && t.id !== huidig?.id);
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
    else if (eindig(huidig?.bpm)) s -= 0.5;          // geen tempo: slechter dan een tempo dat dichtbij ligt
    const ka = huidig?.toonZeker && k.toonZeker ? camelotAfstand(huidig.k, k.k) : null;
    if (ka !== null) { s -= ka * 0.6; if (ka <= 1) redenen.push(`toon past (${toonNaam(k.k)})`); }
    const pb = huidig && k.gridZeker ? beoordeel(huidig, k) : null;
    if (pb?.soort === 'goed') { s += 0.4; redenen.push('past bij'); } else if (pb?.soort === 'bijna') s += 0.15;
    const la = huidig && eindig(huidig.loudness) && eindig(t.loudness_i) ? Math.abs(huidig.loudness - t.loudness_i) : null;
    if (la !== null) s -= Math.min(2, la / 6);
    if (!gespeeld.has(t.id)) s += 0.3;
    return { nummer: t, s, redenen };
  });
  scores.sort((a, b) => b.s - a.s);
  const beste = scores[0];
  return { nummer: beste.nummer, redenen: beste.redenen.length ? beste.redenen : ['nog niet gespeeld'] };
}

// ---- welke overgang (de bewakers) ----------------------------------------------------

/**
 * De soort overgang, met waarom. `voorkeur` wordt gevolgd als de bewakers het toelaten
 * (een veiligere mag altijd); anders de veiligste die wel mag.
 *
 * @param uit  de uitgaande op het mengpunt: { gridZeker (en: hij loopt op de klok), bpm = wat je HOORT, k = wat je hoort, toonZeker }
 * @param inn  de nieuwe op zijn beginpunt: { gridZeker, bpm van de plaat, k van de plaat, toonZeker }
 * @returns { type, naam, redenen, veilig }
 */
export function kiesOvergang(uit, inn, { voorkeur = 'auto' } = {}) {
  const redenen = [];
  const ta = tempoAfwijking(uit.bpm, inn.bpm);
  const tempoOk = ta !== null && ta <= TEMPO_MAX;
  // Een blend koppelt de nieuwe aan de klok, en zonder keylock schuift zijn toon mee
  // (6% ≈ een halve toon): vergelijk wat je NA de sync hoort.
  const kIn = isSleutel(inn.k) ? transponeer(inn.k, tempoOk ? halveTonenVan(uit.bpm / inn.bpm) : 0) : null;
  const ka = uit.toonZeker && inn.toonZeker ? camelotAfstand(uit.k, kIn) : null;
  const toonOk = ka === null || ka <= 1;
  const beideZeker = !!uit.gridZeker && !!inn.gridZeker;

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
    else if (!toonOk) redenen.push(`toonsoorten botsen (${toonNaam(uit.k)} → ${toonNaam(kIn)})`);
    redenen.push('uitfilteren en op de 1 invallen');
  } else {
    redenen.push(uit.grid === null || uit.geenGrid ? 'geen grid: beatloos overvloeien' : 'niet zeker op de klok: beatloos overvloeien');
  }

  const rang = { ambient: 0, filter: 1, blend: 2 };
  let type = mag;
  if (voorkeur in rang && voorkeur !== mag) {
    if (rang[voorkeur] <= rang[mag]) { type = voorkeur; redenen.unshift(`gevraagd: ${OVERGANGEN[voorkeur].naam}`); }
    else redenen.unshift(`gevraagd was ${OVERGANGEN[voorkeur].naam}, maar dat klinkt hier niet goed`);
  }
  return { type, naam: OVERGANGEN[type].naam, redenen, veilig: type !== 'blend' };
}

// ---- wanneer ----------------------------------------------------------------------------

/** Maten van een blend of filter: een eigen lengte ({ maten }), anders de standaard. */
export function overgangMaten({ type, lengte = null }) {
  if (eindig(lengte?.maten)) return Math.max(2, Math.round(lengte.maten));
  return OVERGANGEN[type]?.maten ?? 8;
}

/**
 * Het begin van de overgang en hoe lang hij duurt.
 *
 * Blend en filter: IN KLOK-TELLEN. `vroegst` en `eind` zijn klok-tellen (eind = de tel waarop
 * de uitgaande klaar moet zijn). De overgang begint op een veelvoud van FRASE maten van de
 * klok, zo laat mogelijk zodat hij vóór `eind` klaar is; past dat niet meer (te laat), dan
 * de eerstvolgende KORT-maatsgrens. Een grens is altijd een "1" van de klok.
 *   → { start, lengte, maten, opKlok: true }   (start en lengte in klok-tellen)
 *
 * Ambient (beatloos): OP TIJD, in de tracktijd van de uitgaande. `vroegst` en `eind` zijn
 * tracktijd, `rate` = seconden tracktijd per seconde klok (de snelheid van de uitgaande).
 * Begint 24 s klok vóór het eind, nooit vóór `vroegst`.
 *   → { start, lengte, opKlok: false }          (in tracktijd)
 */
export function planMoment({ type, vroegst, eind, perMaat = 4, rate = 1, lengte: eigen = null }) {
  if (type === 'ambient') {
    const sec = eindig(eigen?.sec) ? eigen.sec : OVERGANGEN.ambient.sec;
    const lengte = sec * (rate > 0 ? rate : 1);
    return { start: Math.max(vroegst, eind - lengte), lengte, opKlok: false };
  }
  const maten = overgangMaten({ type, lengte: eigen });
  const tellen = maten * perMaat;
  const frase = FRASE * perMaat, kort = KORT * perMaat;
  const ideaal = eind - tellen;
  const omlaag = (x, per) => Math.floor(x / per + 1e-9) * per;
  const omhoog = (x, per) => Math.ceil(x / per - 1e-9) * per;
  let b;
  if (ideaal >= vroegst) {
    b = omlaag(ideaal, frase);                                  // de laatste frasegrens ≤ ideaal
    if (b < vroegst) b = omhoog(Math.max(vroegst, ideaal - kort), kort);
  } else {
    b = omhoog(vroegst, kort);
  }
  return { start: b, lengte: tellen, maten, opKlok: true };
}

/**
 * Hoe ver een overgang is (0..1, kan < 0 of > 1): op de klok, of op de plek van de uitgaande.
 * @param plek de plek van de uitgaande (alleen voor ambient), tel = klok-tel nu
 */
export function voortgang(moment, { tel = null, plek = null } = {}) {
  if (!moment) return 0;
  const x = moment.opKlok ? tel : plek;
  return eindig(x) ? (x - moment.start) / moment.lengte : 0;
}

// ---- hoe: de curves ------------------------------------------------------------------------

const cosUit = (x) => Math.cos(Math.min(1, Math.max(0, x)) * Math.PI / 2);
const sinIn = (x) => Math.sin(Math.min(1, Math.max(0, x)) * Math.PI / 2);

/**
 * De knopstanden op voortgang p (0..1) als waarden 0..1 van de bus (regel 4): fader, laag
 * (0,5 = 0 dB, 0 = weg), filter (0,5 = open, < 0,5 lowpass, > 0,5 highpass), sendA (echo),
 * sendB (galm). `basis` = de sends zoals ze stonden: daar gaan ze naartoe terug.
 *
 * De bas is een SCHAKELAAR die in het midden wisselt (beide tracks in dezelfde tik): nooit
 * twee bassen, nooit een gat. In v1 alleen bij de blend; in v2 ook bij overvloeien. Bij
 * filter-uit haalt de highpass de bas van de uitgaande weg en start de nieuwe pas op het eind.
 *
 * `start: true` bij de nieuwe = hij moet nu spelen.
 */
export function standen(type, p, basis = { uitA: 0, uitB: 0, inA: 0, inB: 0 }) {
  const q = Math.min(1, Math.max(0, p));
  const helft = q >= 0.5;
  if (type === 'blend') {
    return {
      uit: { fader: helft ? cosUit((q - 0.5) / 0.5) : 1, laag: helft ? 0 : 0.5, filter: 0.5, sendA: basis.uitA, sendB: basis.uitB },
      in: { fader: helft ? 1 : sinIn(q / 0.5), laag: helft ? 0.5 : 0, filter: 0.5, sendA: basis.inA, sendB: basis.inB, start: true },
    };
  }
  if (type === 'filter') {
    const klaar = q >= 1;
    return {
      uit: { fader: klaar ? 0 : 1, laag: 0.5, filter: 0.5 + 0.42 * q, sendA: basis.uitA + (0.65 - basis.uitA) * q, sendB: basis.uitB },
      in: { fader: 1, laag: 0.5, filter: 0.5, sendA: basis.inA, sendB: basis.inB, start: klaar },
    };
  }
  // ambient: de uitgaande sluit en galmt weg, de nieuwe opent eronder; de bas wisselt in het midden.
  return {
    uit: { fader: q < 0.4 ? 1 : cosUit((q - 0.4) / 0.6), laag: helft ? 0 : 0.5, filter: 0.5 - 0.35 * q, sendA: basis.uitA,
      sendB: basis.uitB + (Math.max(basis.uitB, 0.55) - basis.uitB) * Math.min(1, q / 0.5) },
    in: { fader: sinIn(q / 0.6), laag: helft ? 0.5 : 0, filter: 0.25 + 0.25 * Math.min(1, q / 0.7), sendA: basis.inA, sendB: basis.inB, start: true },
  };
}

/** Beginstand van de nieuwe vóór de overgang (hij staat klaar, stil). */
export function klaarStand(type) {
  const s = standen(type, 0);
  return { fader: type === 'filter' ? 1 : 0, laag: s.in.laag, filter: s.in.filter };
}

/** Staat de bas van een track met deze knopstanden open (fader open, laag niet weg, geen highpass erover)? */
export const basOpen = ({ fader, laag, filter }) => fader > 0.001 && laag >= BAS_KILL && filter < BAS_HPF;
