/**
 * De stemming van de klankschaal: op welke toon de kern en de acht velden van de ladder staan,
 * uit de toonsoort van wat je hoort. Puur: geen Web Audio, geen DOM (draait ook in Node).
 *
 * Herkomst: v1 src/engine/klankschaal.js (`stemming`, TOONLADDERS) en de sleutels van
 * src/engine/toonsoort.js (SPELLING, isMineur, tonica, relatief, kortNaam, leesToonsoort),
 * getal voor getal overgenomen. In v1 hing de globale klankschaal aan de master; in v2 is
 * de klankschaal gewoon een instrument op een track (schaal.js) en dit is zijn rekenwerk.
 *
 * Een sleutel k: 0..11 = majeur op toonklasse k (C = 0), 12..23 = mineur op k − 12.
 * De toon komt in v2 als TEKST (`toon()` van de engine: 'Am', 'F#', 'Bbm', 'C♯m'); leesToonsoort
 * maakt er een sleutel van.
 *
 * Regels (v1, oogst produceren-030): de schaal staat op wat je HOORT (toonsoort + de cent van
 * de plaat), past de ladder niet bij majeur/mineur dan de RELATIEVE toonsoort (alle tonen in de
 * toonladder van de plaat), zonder toonsoort de laatste toon houden (nooit terug naar D: dat doet
 * de aanroeper), de kern rond D3 (G♯2..G3) en de ring een octaaf hoger.
 */

/** De vaste spelling (v1 toonsoort.js); mineur krijgt een `m` erachter. */
export const SPELLING = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KORT_MAJ = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const KORT_MIN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

export const isSleutel = (k) => Number.isInteger(k) && k >= 0 && k < 24;
export const isMineur = (k) => k >= 12;
export const tonica = (k) => k % 12;
const mod12 = (x) => ((x % 12) + 12) % 12;

/** `G`, `B♭m`, of null. */
export const kortNaam = (k) => (isSleutel(k) ? (isMineur(k) ? `${KORT_MIN[k - 12]}m` : KORT_MAJ[k]) : null);

/** Relatief (zelfde Camelot-getal, andere letter): C majeur ↔ A mineur. */
export const relatief = (k) => (!isSleutel(k) ? null
  : isMineur(k) ? (tonica(k) + 3) % 12 : 12 + (k + 9) % 12);

/** "F", "F#m", "Dbm", "E♭", "Bb minor", "A mineur" → sleutel 0..23, of null (v1 leesToonsoort). */
export function leesToonsoort(s) {
  if (isSleutel(s)) return s;
  const m = /^\s*([A-Ga-g])\s*(#|♯|b|♭)?\s*(m|min|minor|mineur)?\s*(maj|major|majeur)?\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const basis = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const vt = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const t = mod12(basis + vt);
  return m[3] ? 12 + t : t;
}

/** Stappen in halve tonen t.o.v. de tonica, voor de acht velden (Waterschaal: D Kurd = A3 B♭3 C4 D4 E4 F4 G4 A4). */
export const TOONLADDERS = {
  kurd: { naam: 'Kurd', mineur: true, stappen: [-5, -4, -2, 0, 2, 3, 5, 7] },
  celtic: { naam: 'Celtic', mineur: true, stappen: [-5, -2, 0, 2, 3, 5, 7, 10] },
  penta: { naam: 'penta mineur', mineur: true, stappen: [-5, -2, 0, 3, 5, 7, 10, 12] },
  hijaz: { naam: 'Hijaz', mineur: true, stappen: [-5, -4, -1, 0, 2, 3, 5, 7] },
  majeur: { naam: 'majeur', mineur: false, stappen: [-5, -3, -1, 0, 2, 4, 5, 7] },
  pentaMajeur: { naam: 'penta majeur', mineur: false, stappen: [-5, -3, 0, 2, 4, 7, 9, 12] },
};
export const LADDERS = ['auto', ...Object.keys(TOONLADDERS)];
/** Zonder iets om te volgen: D mineur, de toon van de Waterschaal. */
export const STANDAARD_TOON = 14;
export const TRANSPOSITIE_MAX = 12;
export const FIJN_MAX = 50;

const klemCent = (x) => Math.min(FIJN_MAX, Math.max(-FIJN_MAX, Number.isFinite(x) ? x : 0));
const hzVan = (midi, cent) => 440 * Math.pow(2, (midi - 69 + cent / 100) / 12);
const naamVan = (midi) => SPELLING[mod12(midi)] + (Math.floor(midi / 12) - 1);

/**
 * De stemming van de schaal (v1 klankschaal.js `stemming`, ongewijzigd).
 *
 * @param k            toonsoort 0..23, of null: STANDAARD_TOON
 * @param cent         afwijking van wat je hoort (−50..+50)
 * @param ladder       'auto' of een sleutel van TOONLADDERS
 * @param transpositie halve tonen erbij (heel)
 * @param fijn         cent erbij
 * @returns { k, ladder, ladderNaam, relatief, tonica, cent, kernHz, kernMidi, kernNaam, velden: [{ hz, naam, midi }] }
 */
export function stemming({ k = null, cent = 0, ladder = 'auto', transpositie = 0, fijn = 0 } = {}) {
  const sleutel = isSleutel(k) ? k : STANDAARD_TOON;
  const naam = ladder === 'auto' || !TOONLADDERS[ladder] ? (isMineur(sleutel) ? 'kurd' : 'majeur') : ladder;
  const L = TOONLADDERS[naam];
  const past = L.mineur === isMineur(sleutel);
  const basis = past ? sleutel : relatief(sleutel);
  const t = mod12(tonica(basis) + Math.round(Number.isFinite(transpositie) ? transpositie : 0));
  const kernMidi = 50 + (mod12(t - 2 + 6) - 6);          // D3 = 50, G♯2..G3
  const c = klemCent(cent) + klemCent(fijn);
  const velden = L.stappen.map((s) => {
    const midi = kernMidi + 12 + s;
    return { midi, hz: hzVan(midi, c), naam: naamVan(midi) };
  });
  return {
    k: (L.mineur ? 12 : 0) + t, ladder: naam, ladderNaam: L.naam, relatief: !past,
    tonica: t, cent: c, kernHz: hzVan(kernMidi, c), kernMidi, kernNaam: naamVan(kernMidi), velden,
  };
}

/**
 * Wat `toon()` van de engine teruggeeft lezen: een tekst ('Am'), een sleutel, of een object
 * ({ toonsoort: 'Am', cent }, { k, cent }, of v1-vorm { toonsoort: { k, cent } }).
 * @returns { k, cent } of null (geen toonsoort)
 */
export function leesToon(h) {
  if (h === null || h === undefined) return null;
  if (typeof h === 'string' || typeof h === 'number') {
    const k = leesToonsoort(h);
    return k === null ? null : { k, cent: 0 };
  }
  if (typeof h !== 'object') return null;
  const ts = h.toonsoort && typeof h.toonsoort === 'object' ? h.toonsoort : h;
  const k = isSleutel(ts.k) ? ts.k : leesToonsoort(ts.toonsoort ?? ts.naam);
  if (k === null) return null;
  return { k, cent: klemCent(Number(ts.cent ?? h.cent ?? 0)) };
}
