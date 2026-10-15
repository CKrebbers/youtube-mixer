import { Beatgrid } from '../engine/beatgrid.js';
import { ToonKaart, camelotGetal, isMineur, kortNaam, transponeer } from '../engine/toonsoort.js';
import { SectieKaart, LABEL_TEKST } from '../engine/secties.js';

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
    // Zeker genoeg voor een blend = sync mag (Beatgrid.syncBij, AR3): ook de "1" niet in twijfel.
    gridZeker: !!grid && grid.syncBij(t),
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
 * Met secties (docs/AUTO-DJ.md §3b) is de voorrang: `inSectie` uit het plan
 * (als die sectie te vinden is, binnen SECTIE_SPELING van `van` als het plan
 * die geeft, het grid daar zeker is en er nog MIN_FRAGMENT te spelen valt) →
 * `van` uit het plan → een keuze uit de secties (kort: de intro; lang: een
 * sectiegrens met ruimte voor een heel fragment, de rustigste soort eerst) →
 * het oude gedrag.
 *
 * @param rnd       toeval 0..1 (injecteerbaar voor tests)
 * @param secties   de stukken van de sectiekaart van dit nummer ([{ van, label, groep, energie, zeker? }]) of null;
 *                  alleen een kaart op het grid (sectiesVan)
 * @param inSectie  { sectie: K (vanaf 1), label?, groep? } uit een planstap, of null
 * @returns { van, tot, sectie? }   sectie = { sectie, label, groep } als het begin een sectie is
 */
export function fragment(track, { van = null, speelduur = null, rnd = Math.random, secties = null, inSectie = null } = {}) {
  const duur = eindig(track?.duur) ? track.duur : 0;
  const eind = Math.max(0, duur - MARGE_EINDE);
  const vast = eindig(speelduur);                 // het plan zegt hoe lang
  if (!vast) speelduur = SPEELDUUR;
  const st = Array.isArray(secties) && secties.length ? secties : null;
  const zeker = st ? gridZeker(track) : null;
  const vanaf = (v) => ({ van: Math.max(0, Math.min(v, eind)), tot: Math.min(eind, Math.max(0, v) + speelduur) });
  // 1. De sectie uit het plan (`van` is de waarheid: de sectie moet er vlakbij liggen),
  //    met ruimte om nog te spelen (anders volgt meteen de volgende overgang, of past die niet).
  if (st && inSectie && zeker) {
    const i = vindSectie(st, inSectie, { bij: eindig(van) ? van : null });
    if (i >= 0 && st[i].van + Math.min(speelduur, MIN_FRAGMENT) <= eind && zeker(st[i].van)) return { ...vanaf(st[i].van), sectie: sectieInfo(st, i) };
  }
  // 2. Het beginpunt uit het plan.
  if (eindig(van)) return vanaf(van);
  // 3. Een keuze uit de secties.
  if (st && zeker) {
    if (duur <= LANG) {
      const i = st.findIndex((s) => s.label === 'intro');
      if (i >= 0 && st[i].van < eind && zeker(st[i].van)) {
        const v = st[i].van;
        return { van: v, tot: vast ? Math.min(eind, v + speelduur) : eind, sectie: sectieInfo(st, i) };
      }
    } else {
      // Een sectiegrens met ruimte voor een heel fragment; de rustigste soort
      // (intro, break, opbouw, deel; een drop of outro als laatste), daaruit de
      // zekerste helft en daaruit een willekeurige.
      const kand = st.map((s, i) => ({ i, van: s.van, z: s.zeker ?? 0, r: IN_RANG[s.label] ?? IN_RANG.deel }))
        .filter((c) => c.van > 30 && c.van + speelduur <= eind && zeker(c.van));
      if (kand.length) {
        const r = Math.min(...kand.map((c) => c.r));
        const top = kand.filter((c) => c.r === r).sort((a, b) => b.z - a.z);
        const half = top.slice(0, Math.max(1, Math.ceil(top.length / 2)));
        const c = half[Math.floor(rnd() * half.length) % half.length];
        return { van: c.van, tot: Math.min(eind, c.van + speelduur), sectie: sectieInfo(st, c.i) };
      }
    }
  }
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
 * Met de secties van de uitgaande (docs/AUTO-DJ.md §3b) begint hij bij
 * voorkeur op een sectiegrens: `uitSectie` uit het plan; anders zelf, binnen
 * SECTIE_VENSTER vóór het eind: waar de outro begint, dan de laatste break,
 * dan het oude moment als dat niet midden in een drop valt, dan het laatste
 * begin van iets anders dan een drop, dan het begin van een drop. Een
 * sectiebegin telt alleen als het grid daar zeker is (`zeker`) en de soort
 * overgang daar nog mag (`mag`, de bewakers); de soort en de lengte blijven
 * wat ze zonder secties waren. Lukt niets: het oude moment.
 *
 * @param grid       Beatgrid van de uitgaande (null bij ambient mag)
 * @param positie    waar de uitgaande nu is (tracktijd)
 * @param eind       waar hij klaar moet zijn (tracktijd)
 * @param rate       afspeelsnelheid van de uitgaande (seconden → tracktijd)
 * @param vooruit    minstens zoveel seconden vanaf nu
 * @param lengte     eigen lengte uit het plan: { maten } of { sec } (null = standaard)
 * @param secties    de stukken van de sectiekaart van de UITGAANDE (sectiesVan), of null
 * @param uitSectie  { sectie: K (vanaf 1), label?, groep? } uit het plan: de overgang begint daar
 * @param zeker      (t) => is het grid op t zeker (standaard grid.zekerBij; zonder grid: geen secties)
 * @param mag        (t) => mag de soort overgang nog als hij op t begint (de bewakers), of null
 * @returns { start, lengte, maten?, tel?, sectie? }   sectie = { sectie, label, groep } als hij op een sectie begint
 */
export function planMoment({ type, grid = null, positie, eind, rate = 1, vooruit = VOORUIT, lengte: eigen = null,
  secties = null, uitSectie = null, zeker = null, mag = null }) {
  const oud = opDeFrase({ type, grid, positie, eind, rate, vooruit, lengte: eigen });
  const st = Array.isArray(secties) && secties.length ? secties : null;
  const z = zeker ?? (grid ? (t) => grid.zekerBij(t) : null);
  if (!st || !z) return oud;
  const vroegst = positie + vooruit * rate;
  const opTel = type !== 'ambient' && !!grid;
  const bpb = grid?.beatsPerBar || 4;
  // Elk sectiebegin als kandidaat: de overgang begint op zijn "1" en moet
  // tussen vroegst en eind passen.
  const kand = (i) => {
    const s = st[i];
    if (!eindig(s?.van) || !z(s.van)) return null;
    let k;
    if (opTel) {
      const tel = grid.volgendeVeelvoud(grid.beatAt(s.van) - TEL_MARGE, bpb);
      const start = grid.timeOf(tel);
      k = { start, lengte: grid.timeOf(tel + oud.maten * bpb) - start, maten: oud.maten, tel };
    } else {
      k = { start: s.van, lengte: oud.lengte };
    }
    if (k.start < vroegst - 1e-6 || k.start + k.lengte > eind + 1e-6) return null;
    if (mag && !mag(k.start)) return null;
    return { ...k, sectie: sectieInfo(st, i) };
  };
  // 1. De sectie uit het plan: de overgang begint op haar begin.
  if (uitSectie) {
    const i = vindSectie(st, uitSectie);
    const k = i >= 0 ? kand(i) : null;
    if (k) return k;
  }
  // 2. Zelf kiezen, niet verder dan SECTIE_VENSTER vóór het laatste moment
  //    dat nog past (anders trekt een vroege break de overgang minuten naar voren).
  const vanaf = opTel
    ? grid.timeOf(grid.beatAt(eind) - (oud.maten + SECTIE_VENSTER.maten) * bpb)
    : eind - oud.lengte - SECTIE_VENSTER.sec * rate;
  const alle = st.map((_, i) => kand(i)).filter((k) => k && k.start >= vanaf - 1e-6);
  const soort = (label) => alle.filter((k) => k.sectie.label === label);
  const outro = soort('outro')[0];
  if (outro) return outro;
  const brk = soort('break').at(-1);
  if (brk) return brk;
  if (!middenInDrop(st, oud.start)) return oud;
  const rustig = alle.filter((k) => k.sectie.label !== 'drop').at(-1);
  if (rustig) return rustig;
  return soort('drop').at(-1) ?? oud;
}

/** Het moment zonder secties: op de frasegrens (blend, filter) of op tijd (ambient). */
function opDeFrase({ type, grid, positie, eind, rate, vooruit, lengte: eigen }) {
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

/**
 * De argumenten voor planMoment zoals de automaat ze maakt (_planOvergang), uit
 * wat ook het planvenster heeft. Puur. Zo voorspellen planvenster en automaat
 * hetzelfde moment, ook bij beatloos (dan geen grid voor de timing, maar wel
 * `zeker` op het grid van de uitgaande voor de secties) en ook waar de
 * bewakers een sectie weigeren (`mag`).
 *
 * @param type       de soort overgang (uit kiesOvergang)
 * @param grid       het grid van de UITGAANDE (Beatgrid of JSON), of null
 * @param uit        de uitgaande: een library-nummer (dan kenmerken(uit, t), bpm × rate),
 *                   of (t) => kenmerken op tracktijd t met `bpm` = wat je hoort
 * @param inn        kenmerken van de nieuwe op zijn beginpunt ({ grid, gridZeker, bpm, k, toonZeker })
 * @param kaart      de sectiekaart van de UITGAANDE (JSON of SectieKaart), of null
 * @param uitSectie  `uit` van de planstap die nu klinkt, of null
 * @returns de argumenten voor planMoment
 */
export function momentArgs({ type, grid = null, uit = null, inn = null, positie, eind, rate = 1, vooruit = Math.min(VOORUIT, 8),
  lengte = null, kaart = null, uitSectie = null }) {
  const g = grid instanceof Beatgrid ? grid : Beatgrid.van(grid);
  const uitOp = typeof uit === 'function' ? uit
    : uit ? (t) => { const k = kenmerken(uit, t); return { ...k, bpm: eindig(k.bpm) ? k.bpm * rate : null }; } : null;
  return {
    type, grid: type === 'ambient' ? null : g, positie, eind, rate, vooruit, lengte,
    secties: sectiesVan(kaart), uitSectie,
    zeker: (t) => !!g && g.zekerBij(t),
    // De bewakers op dat begin: mag deze soort daar ook (tempo, toon, grid van de uitgaande dáár)?
    mag: uitOp && inn ? (t) => kiesOvergang(uitOp(t), inn, { voorkeur: type }).type === type : null,
  };
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

// ---- secties (docs/SECTIES.md, docs/AUTO-DJ.md §3b) ---------------------------

/**
 * Hoe ver vóór het laatste moment dat nog past een sectiebegin de overgang
 * naar voren mag halen, als de planner zelf kiest: 32 maten (beatloos 60 s).
 * Een plan (uitSectie) mag verder.
 */
export const SECTIE_VENSTER = { maten: 32, sec: 60 };
/**
 * Een sectie uit het plan (`in`/`uit`) met een tijd erbij (`van`) telt alleen als
 * ze nu nog zo dicht (s) bij die tijd ligt; anders is `van` de waarheid.
 */
export const SECTIE_SPELING = 30;
/** Een fragment dat op een sectie uit het plan begint, speelt minstens zo lang (s; of de kortere speelduur van het plan). */
export const MIN_FRAGMENT = 60;
/** Een sectiebegin ligt op een maatbegin, maar afgerond (4 decimalen): zoveel tellen ervoor telt nog als die maat. */
const TEL_MARGE = 0.02;
/** Inmixen in een lange mix: de rustigste soort eerst. */
const IN_RANG = { intro: 0, break: 1, opbouw: 2, deel: 3, drop: 4, outro: 5 };

/**
 * De stukken van een sectiekaart (JSON of SectieKaart) als de auto-DJ ze mag
 * gebruiken: alleen een kaart die op het grid gerekend is (`opGrid`). Anders null.
 */
export function sectiesVan(kaart) {
  const k = kaart ? SectieKaart.van(kaart) : null;
  return k && k.opGrid ? k.stukken : null;
}

/**
 * Een sectie uit een planstap terugvinden: { sectie: K (vanaf 1), label?, groep?, van? }.
 * De kaart kan sinds het plannen opnieuw berekend zijn (een stuk erbij of eraf,
 * dus andere nummers), en labels komen terug ("drop D" twee keer). Daarom:
 * - de kandidaten zijn de stukken met die label en groep (wat ontbreekt klopt);
 *   zonder label en groep alleen stuk K;
 * - daarvan het stuk dat het dichtst ligt bij de tijd van toen (`bij`, de
 *   `van` uit het plan, of `ref.van`); zonder tijd bij waar stuk K NU begint;
 *   zonder stuk K bij plek K in de rij; gelijk: het dichtst bij plek K;
 * - met een tijd van toen: alleen binnen SECTIE_SPELING, anders −1 (dan is
 *   die tijd de waarheid).
 * Geeft de index (vanaf 0), of −1.
 */
export function vindSectie(secties, ref, { bij = null } = {}) {
  if (!Array.isArray(secties) || !ref || typeof ref !== 'object') return -1;
  const label = typeof ref.label === 'string' ? ref.label : null;
  const groep = typeof ref.groep === 'string' ? ref.groep : null;
  const K = Number.isInteger(ref.sectie) && ref.sectie >= 1 ? ref.sectie : null;
  const tijd = eindig(bij) ? bij : eindig(ref.van) ? ref.van : null;
  const klopt = (s) => !!s && (label === null || s.label === label) && (groep === null || s.groep === groep);
  const kand = label === null && groep === null
    ? (K !== null && secties[K - 1] ? [K - 1] : [])
    : secties.map((s, i) => (klopt(s) ? i : -1)).filter((i) => i >= 0);
  if (!kand.length) return -1;
  const doel = tijd ?? (K !== null && eindig(secties[K - 1]?.van) ? secties[K - 1].van : null);
  const plek = (i) => Math.abs(i - ((K ?? 1) - 1));
  const afstand = (i) => (doel !== null ? Math.abs(secties[i].van - doel) : plek(i));
  let beste = kand[0];
  for (const i of kand) {
    const a = afstand(i), b = afstand(beste);
    if (a < b - 1e-9 || (Math.abs(a - b) <= 1e-9 && plek(i) < plek(beste))) beste = i;
  }
  if (tijd !== null && Math.abs(secties[beste].van - tijd) > SECTIE_SPELING) return -1;
  return beste;
}

/** { sectie (vanaf 1), label, groep } van stuk i: voor de uitleg en het plan. */
export function sectieInfo(secties, i) {
  const s = secties[i] || {};
  return { sectie: i + 1, label: s.label ?? null, groep: s.groep ?? null };
}

/** "outro F", of "B" voor een gewoon deel (zoals SectieKaart.naam). */
export function sectieNaam(info) {
  if (!info) return '';
  const l = LABEL_TEKST[info.label] ?? info.label ?? '';
  return l ? `${l} ${info.groep ?? ''}`.trim() : String(info.groep ?? '');
}

/**
 * De eerste sectiegrens na `na` tot en met `tot` (tracktijd) waar het grid
 * zeker is, op zijn "1" als er een grid is: { start, tel?, sectie } of null.
 * Voor "langer" en "nu".
 */
export function sectieGrens({ secties, grid = null, zeker = null, na, tot }) {
  const st = Array.isArray(secties) && secties.length ? secties : null;
  const z = zeker ?? (grid ? (t) => grid.zekerBij(t) : null);
  if (!st || !z) return null;
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (!eindig(s?.van) || !z(s.van)) continue;
    const tel = grid ? grid.volgendeVeelvoud(grid.beatAt(s.van) - TEL_MARGE, grid.beatsPerBar || 4) : null;
    const start = grid ? grid.timeOf(tel) : s.van;
    if (start > na + 1e-3 && start <= tot + 1e-6) return grid ? { start, tel, sectie: sectieInfo(st, i) } : { start, sectie: sectieInfo(st, i) };
  }
  return null;
}

/** Ligt t midden in een drop (niet op zijn begin)? */
function middenInDrop(secties, t) {
  let i = 0;
  for (let k = 0; k < secties.length; k++) if (secties[k].van <= t + 1e-6) i = k;
  return secties[i]?.label === 'drop' && t > secties[i].van + 1e-6;
}

/** (t) => is het grid van dit library-nummer op t zeker; null zonder grid. */
function gridZeker(track) {
  const g = track?.grid ? Beatgrid.van(track.grid) : null;
  return g ? (t) => g.zekerBij(t) : null;
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
