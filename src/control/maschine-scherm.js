/**
 * De twee schermen van de Maschine MK2 als PURE functie: stand -> 2048 bytes.
 *
 * Formaat (AV-app-hub, docs/MASCHINE.md, PROTOCOL §17): 256 × 64 pixels, 1 bit,
 * rij voor rij van boven, 32 bytes per rij, het hoogste bit van een byte is de
 * meest linkse pixel, 1 = aan. Geen DOM, geen canvas, geen klok: het tekent
 * alleen wat het krijgt (de stand maakt src/control/maschine.js).
 *
 * Indeling (docs/MASCHINE.md, "De schermen"):
 *   kop      groot (letters 2×), links de speeltrack en zijn instrument
 *            ("T2 Poly"), rechts de focus-track of de keuze van het masterwiel
 *   vier kolommen van 64 px: de naam van de knop, zijn waarde in echte eenheden
 *            (zoals de INSTRUMENT-rij) en een balk 0..1; links knop 1–4, rechts 5–8
 *   onderregel klein: SHIFT = fijn, of wat het wiel doet
 *
 * Het lettertype is een klassiek 5×7-font (kolom voor kolom, onderste bit =
 * bovenste pixel), ASCII 32–126 plus ±. Wat er niet in staat wordt eerst
 * vereenvoudigd (é -> e, − -> -, × -> x, → -> >), anders een vraagteken.
 */

export const BREED = 256;
export const HOOG = 64;
export const BYTES = BREED * HOOG / 8;          // 2048
export const LETTER_B = 5, LETTER_H = 7, STAP = 6;   // een letter, en zijn plek (met 1 px tussenruimte)
/** Een kolom per knop: vier per scherm. */
export const KOLOM = 64;
/** Zoveel letters (1×) passen in een kolom, met een pixel marge links en rechts. */
export const KOLOM_TEKENS = Math.floor((KOLOM - 2) / STAP);   // 10

// ASCII 32..126: 5 bytes per teken, kolom voor kolom, bit 0 = bovenste rij.
const FONT = [
  '0000000000', '00005f0000', '0007000700', '147f147f14', '242a7f2a12', '2313086462', '3649552250', '0005030000',
  '001c224100', '0041221c00', '082a1c2a08', '08083e0808', '0050300000', '0808080808', '0060600000', '2010080402',
  '3e5149453e', '00427f4000', '4261514946', '2141454b31', '1814127f10', '2745454539', '3c4a494930', '0171090503',
  '3649494936', '064949291e', '0036360000', '0056360000', '0008142241', '1414141414', '4122140800', '0201510906',
  '324979413e', '7e1111117e', '7f49494936', '3e41414122', '7f4141221c', '7f49494941', '7f09090101', '3e41415132',
  '7f0808087f', '00417f4100', '2040413f01', '7f08142241', '7f40404040', '7f0204027f', '7f0408107f', '3e4141413e',
  '7f09090906', '3e4151215e', '7f09192946', '4649494931', '01017f0101', '3f4040403f', '1f2040201f', '7f2018207f',
  '6314081463', '0304780403', '6151494543', '00007f4141', '0204081020', '41417f0000', '0402010204', '4040404040',
  '0001020400', '2054545478', '7f48444438', '3844444420', '384444487f', '3854545418', '087e090102', '081454543c',
  '7f08040478', '00447d4000', '2040443d00', '007f102844', '00417f4000', '7c04180478', '7c08040478', '3844444438',
  '7c14141408', '081414187c', '7c08040408', '4854545420', '043f444020', '3c4040207c', '1c2040201c', '3c4030403c',
  '4428102844', '0c5050503c', '4464544c44', '0008364100', '00007f0000', '0041360800', '0804080408',
].map((h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16)));
/** Tekens buiten ASCII die we zelf tekenen. */
const EXTRA = { '±': Uint8Array.of(0x44, 0x44, 0x5f, 0x44, 0x44) };
/** Wat we vereenvoudigen voor we tekenen. */
const VERVANG = { '−': '-', '–': '-', '—': '-', '×': 'x', '·': '.', '→': '>', '←': '<', '♯': '#', '♭': 'b', '…': '...', '½': '1/2', '°': 'o' };

/** Een tekst zoals het font hem kan tekenen. Puur. */
export function normaliseer(tekst) {
  let s = '';
  for (const t of String(tekst ?? '')) {
    if (EXTRA[t] || (t >= ' ' && t <= '~')) { s += t; continue; }
    if (VERVANG[t] !== undefined) { s += VERVANG[t]; continue; }
    const kaal = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s += kaal.length === 1 && kaal >= ' ' && kaal <= '~' ? kaal : '?';
  }
  return s;
}

const glyph = (t) => EXTRA[t] ?? FONT[t.charCodeAt(0) - 32] ?? FONT['?'.charCodeAt(0) - 32];

export const leegScherm = () => new Uint8Array(BYTES);

export function zetPixel(buf, x, y) {
  if (x < 0 || y < 0 || x >= BREED || y >= HOOG) return;
  buf[32 * y + (x >> 3)] |= 0x80 >> (x & 7);
}

/** Staat pixel (x, y) aan? (voor de tests en wie het scherm wil nalezen) */
export const leesPixel = (buf, x, y) => (x < 0 || y < 0 || x >= BREED || y >= HOOG ? false : (buf[32 * y + (x >> 3)] & (0x80 >> (x & 7))) !== 0);

/** Hoe breed een (genormaliseerde) tekst wordt, in pixels, zonder de laatste tussenruimte. */
export const tekstBreedte = (tekst, schaal = 1) => {
  const n = [...normaliseer(tekst)].length;
  return n ? (n * STAP - 1) * schaal : 0;
};

/** Tekst op (x, y) = linksboven van de eerste letter. Geeft de x ná de tekst. */
export function tekst(buf, x, y, s, schaal = 1) {
  let cx = x;
  for (const t of normaliseer(s)) {
    const g = glyph(t);
    for (let k = 0; k < LETTER_B; k++) {
      for (let r = 0; r < LETTER_H; r++) {
        if (!(g[k] & (1 << r))) continue;
        for (let dx = 0; dx < schaal; dx++) for (let dy = 0; dy < schaal; dy++) zetPixel(buf, cx + k * schaal + dx, y + r * schaal + dy);
      }
    }
    cx += STAP * schaal;
  }
  return cx;
}

export function lijn(buf, x0, x1, y, stip = false) {
  for (let x = x0; x <= x1; x++) if (!stip || (x & 1) === 0) zetPixel(buf, x, y);
}
function staander(buf, x, y0, y1, stip = false) {
  for (let y = y0; y <= y1; y++) if (!stip || (y & 1) === 0) zetPixel(buf, x, y);
}

/** Een balk: rand, en van links gevuld tot `waarde` (0..1). */
export function balk(buf, x, y, b, h, waarde) {
  lijn(buf, x, x + b - 1, y); lijn(buf, x, x + b - 1, y + h - 1);
  staander(buf, x, y, y + h - 1); staander(buf, x + b - 1, y, y + h - 1);
  const v = Math.min(1, Math.max(0, Number(waarde) || 0));
  const vol = Math.round(v * (b - 4));
  for (let yy = y + 2; yy <= y + h - 3; yy++) lijn(buf, x + 2, x + 1 + vol, yy);
}

/**
 * Een tekst die in `max` letters moet passen (1×): eerst zonder spatie vóór een
 * eenheid ("1,2 kHz" -> "1,2kHz"), lange woorden korter ("halve tonen" -> "ht"),
 * dan afkappen op een woordgrens, en pas daarna midden in een woord.
 */
export function pasIn(s, max = KOLOM_TEKENS) {
  let t = normaliseer(s).trim();
  if (t.length <= max) return t;
  t = t.replace(/ halve ton(en|e)\b/g, 'ht').replace(/(\d) (?=[a-zA-Z%])/g, '$1').replace(/ +/g, ' ');
  if (t.length <= max) return t;
  const kort = t.slice(0, max + 1);
  const spatie = kort.lastIndexOf(' ');
  return (spatie > 0 ? kort.slice(0, spatie) : t.slice(0, max)).trim();
}

/** Een kop die in `px` past op schaal 2, anders op schaal 1 (afgekapt). */
function kop(buf, x, y, s, px) {
  if (tekstBreedte(s, 2) <= px) return tekst(buf, x, y, s, 2);
  return tekst(buf, x, y + 4, pasIn(s, Math.floor((px + 1) / STAP)), 1);
}

/**
 * Eén scherm tekenen.
 *
 * @param stand {
 *   speel:     { nr, naam } | null    de speeltrack en zijn instrument (waar pads, keyboard en draaiknoppen heen gaan)
 *   focus:     { nr, wat }            de focus-track: wat = instrumentnaam, 'nummer' of 'leeg'
 *   knoppen:   [{ label, waarde, tekst }] × 8   (waarde null = die plek bestaat niet)
 *   kandidaat: { naam } | null        het masterwiel staat op een ander instrument (nog niet gezet)
 *   shift:     boolean
 *   melding:   string | null          een korte regel onderaan (rechts), bv. "druk nog eens"
 * }
 * @param nr 0 = links (knop 1–4), 1 = rechts (knop 5–8)
 * @returns Uint8Array(2048)
 */
export function tekenScherm(stand, nr) {
  const buf = leegScherm();
  const s = stand || {};
  // ---- kop ----
  if (nr === 0) {
    kop(buf, 2, 1, s.speel ? `T${s.speel.nr} ${s.speel.naam}` : 'geen instrument', BREED - 4);
  } else if (s.kandidaat) {
    kop(buf, 2, 1, `T${s.focus?.nr ?? '?'} > ${s.kandidaat.naam}?`, BREED - 4);
  } else if (s.focus && s.focus.nr !== s.speel?.nr) {
    kop(buf, 2, 1, `focus T${s.focus.nr}: ${s.focus.wat}`, BREED - 4);
  } else {
    kop(buf, 2, 1, s.speel ? 'knop 5-8' : 'kies met het wiel', BREED - 4);
  }
  lijn(buf, 0, BREED - 1, 17);
  // ---- vier knoppen ----
  const knoppen = s.knoppen || [];
  for (let i = 0; i < 4; i++) {
    const k = knoppen[nr * 4 + i];
    const x = i * KOLOM;
    if (i > 0) staander(buf, x - 1, 19, 50, true);
    if (!s.speel || !k || k.waarde === null || k.waarde === undefined) {
      tekst(buf, x + 2, 21, String(nr * 4 + i + 1));
      continue;
    }
    tekst(buf, x + 2, 21, pasIn(k.label));
    tekst(buf, x + 2, 31, pasIn(k.tekst ?? `${Math.round(k.waarde * 100)}%`));
    balk(buf, x + 2, 42, KOLOM - 5, 8, k.waarde);
  }
  // ---- onderregel ----
  lijn(buf, 0, BREED - 1, 53, true);
  const onder = nr === 0
    ? (s.shift ? 'SHIFT: draaiknoppen fijn' : s.speel ? 'pads + keyboard spelen hier' : 'zet een instrument met het wiel')
    : (s.melding || (s.kandidaat ? 'druk op het wiel = zetten' : 'wiel = instrument kiezen'));
  tekst(buf, 2, 56, pasIn(onder, Math.floor((BREED - 4) / STAP)));
  return buf;
}

/** Het scherm als tekst (# en .), voor wie het in een terminal wil zien. */
export function alsTekst(buf) {
  let uit = '';
  for (let y = 0; y < HOOG; y++) {
    for (let x = 0; x < BREED; x++) uit += leesPixel(buf, x, y) ? '#' : '.';
    uit += '\n';
  }
  return uit;
}
