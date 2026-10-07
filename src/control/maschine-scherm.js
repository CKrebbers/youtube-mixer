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
 *   STAPMODUS (links): het gekozen patroon: 16 vakjes van deze bladzijde
 *            (leeg = rand, een andere noot = blokje, de laatst gespeelde noot =
 *            vol, voorbij de lengte = niets), een streep onder de stap die je
 *            hoort, en stap/lengte, noot, speelt/wacht, REC
 *   PATTERN vast (links): de vijf plekken, de gekozen onderstreept
 *   SECTIES (links, SCENE): kop = de focus-track en de sectie die je hoort
 *            ("T4 5 opbouw B"); daaronder de namen van de 16 pads ZOALS ZE
 *            LIGGEN (pad 1 linksonder, 13–16 bovenaan), die je hoort of
 *            indrukt omgekeerd (wit vlak); onderaan wat er op de "1" komt
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

export function wisPixel(buf, x, y) {
  if (x < 0 || y < 0 || x >= BREED || y >= HOOG) return;
  buf[32 * y + (x >> 3)] &= ~(0x80 >> (x & 7));
}

/** Staat pixel (x, y) aan? (voor de tests en wie het scherm wil nalezen) */
export const leesPixel = (buf, x, y) => (x < 0 || y < 0 || x >= BREED || y >= HOOG ? false : (buf[32 * y + (x >> 3)] & (0x80 >> (x & 7))) !== 0);

/** Hoe breed een (genormaliseerde) tekst wordt, in pixels, zonder de laatste tussenruimte. */
export const tekstBreedte = (tekst, schaal = 1) => {
  const n = [...normaliseer(tekst)].length;
  return n ? (n * STAP - 1) * schaal : 0;
};

/** Tekst op (x, y) = linksboven van de eerste letter. Geeft de x ná de tekst. `wis`: de letters uit (op een vol vlak). */
export function tekst(buf, x, y, s, schaal = 1, wis = false) {
  const pixel = wis ? wisPixel : zetPixel;
  let cx = x;
  for (const t of normaliseer(s)) {
    const g = glyph(t);
    for (let k = 0; k < LETTER_B; k++) {
      for (let r = 0; r < LETTER_H; r++) {
        if (!(g[k] & (1 << r))) continue;
        for (let dx = 0; dx < schaal; dx++) for (let dy = 0; dy < schaal; dy++) pixel(buf, cx + k * schaal + dx, y + r * schaal + dy);
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

/** Een balk vanuit het midden (EQ, trim, filter: 0,5 = niets): rand, streepje in het midden, gevuld naar de waarde. */
export function balkMidden(buf, x, y, b, h, waarde) {
  lijn(buf, x, x + b - 1, y); lijn(buf, x, x + b - 1, y + h - 1);
  staander(buf, x, y, y + h - 1); staander(buf, x + b - 1, y, y + h - 1);
  const v = Math.min(1, Math.max(0, Number.isFinite(Number(waarde)) ? Number(waarde) : 0.5));
  const midden = x + Math.round((b - 1) / 2);
  const naar = x + 2 + Math.round(v * (b - 5));
  staander(buf, midden, y - 2, y + h + 1);
  const [van, tot] = naar < midden ? [naar, midden] : [midden, naar];
  for (let yy = y + 2; yy <= y + h - 3; yy++) lijn(buf, van, tot, yy);
}

/** Woorden over regels van hooguit `max` letters (1×); een te lang woord wordt afgekapt. Puur. */
export function regels(s, max = Math.floor((BREED - 4) / STAP)) {
  const uit = [];
  let regel = '';
  for (const woord of normaliseer(s).split(/\s+/).filter(Boolean)) {
    const proef = regel ? `${regel} ${woord}` : woord;
    if (proef.length <= max) { regel = proef; continue; }
    if (regel) uit.push(regel);
    regel = woord.length > max ? woord.slice(0, max) : woord;
  }
  if (regel) uit.push(regel);
  return uit;
}

/** Een leeg vak met rand. */
function vak(buf, x, y, b, h) {
  lijn(buf, x, x + b - 1, y); lijn(buf, x, x + b - 1, y + h - 1);
  staander(buf, x, y, y + h - 1); staander(buf, x + b - 1, y, y + h - 1);
}
function vul(buf, x, y, b, h) { for (let yy = y; yy < y + h; yy++) lijn(buf, x, x + b - 1, yy); }

/** Stapmodus, het linkerscherm (onder de kop): 16 vakjes, de lopende stap, en wat erbij hoort. */
function tekenStappen(buf, p) {
  const van = p.bladzijde * 16 + 1;
  const tot = Math.min(p.lengte, van + 15);
  const status = p.speelt ? 'speelt' : p.wacht ? 'wacht' : 'stil';
  tekst(buf, 2, 20, pasIn(`stap ${van}-${tot}/${p.lengte} noot ${p.noot} ${status}${p.opnemen ? ' REC' : ''}`, 42));
  for (let i = 0; i < 16; i++) {
    const x = i * 16 + 1, y = 30;
    const r = p.stappen?.[i];
    if (i % 4 === 0) lijn(buf, x + 6, x + 7, 28);   // de tellen
    if (r === null || r === undefined) continue;    // voorbij de lengte
    vak(buf, x, y, 14, 14);
    if (r >= 0.75) vul(buf, x + 2, y + 2, 10, 10);
    else if (r >= 0.25) vul(buf, x + 4, y + 4, 6, 6);
  }
  if (p.hoort !== null && p.hoort !== undefined && p.hoort >= 0 && p.hoort < 16) vul(buf, p.hoort * 16 + 1, 46, 14, 3);
}

/** PATTERN vast, het linkerscherm: de vijf plekken (read: null = geen, 0 = leeg, 0,5 = gevuld, 1 = speelt). */
function tekenPlekken(buf, p) {
  for (let i = 0; i < 5; i++) {
    const r = p.plekken?.[i];
    const x = i * 51 + 3, y = 22, b = 46, h = 24;
    if (r === null || r === undefined) continue;
    vak(buf, x, y, b, h);
    if (r >= 0.25) vak(buf, x + 1, y + 1, b - 2, h - 2);   // gevuld: dikke rand
    tekst(buf, x + 4, y + 5, String(i + 1), 2);
    if (r >= 0.75) tekst(buf, x + 20, y + 5, '>', 2);       // speelt
    if (p.plek === i + 1) vul(buf, x, y + h + 2, b, 3);      // de gekozen
  }
}

/**
 * Modus secties, het linkerscherm (onder de kop): de naam per pad in een raster
 * van 4 × 4 zoals de pads liggen (pad 1 linksonder, rij van onder naar boven),
 * een kolom van 64 px per pad, rijen van 8 px. Brandt een pad (die hoor je of
 * drukt je in), dan staat zijn naam omgekeerd: een vol vlak met de letters uit.
 */
function tekenSecties(buf, c) {
  for (let i = 0; i < 16; i++) {
    const naam = c.namen?.[i];
    if (naam === null || naam === undefined) continue;
    const x = (i % 4) * KOLOM, y = 20 + (3 - Math.floor(i / 4)) * 8;
    if (c.aan?.[i]) { vul(buf, x, y - 1, KOLOM - 1, 9); tekst(buf, x + 2, y, pasIn(naam), 1, true); }
    else tekst(buf, x + 2, y, pasIn(naam));
  }
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

const REGEL = Math.floor((BREED - 4) / STAP);   // 42 letters (1×) op een hele regel

/**
 * De pagina's Strip en Rack (maschine.js, stand.dj): links groot de focus-track en de
 * pagina ("T3 Strip", bij Rack de naam van het rack), rechts in twee kleine regels wat
 * er op die track staat (titel; bpm, toonsoort, resterende tijd). Daaronder vier
 * knoppen per scherm zoals op de pagina Instrument; EQ, trim en filter met een balk
 * vanuit het midden. De knop die je net draaide (stand.gedraaid) staat omgekeerd.
 */
function tekenDj(buf, s, nr) {
  const d = s.dj;
  if (nr === 0) {
    const naam = s.pagina === 'rack' ? (d.rack || 'Rack') : (s.paginaNaam || 'Strip');
    kop(buf, 2, 1, `T${d.nr ?? '?'} ${naam}`, BREED - 4);
  } else if (d.wat === 'nummer') {
    tekst(buf, 2, 1, pasIn(d.titel || 'nummer', REGEL));
    tekst(buf, 2, 9, pasIn([d.bpm ? `${d.bpm} BPM` : 'geen grid', d.toon, d.rest].filter(Boolean).join('  '), REGEL));
  } else {
    tekst(buf, 2, 1, pasIn(d.wat === 'leeg' ? 'leeg: laad een nummer' : `${d.wat} (instrument)`, REGEL));
    tekst(buf, 2, 9, pasIn(d.wat === 'leeg' ? 'de knoppen werken ook zonder' : 'strip en rack werken ook hier', REGEL));
  }
  lijn(buf, 0, BREED - 1, 17);
  const knoppen = s.knoppen || [];
  for (let i = 0; i < 4; i++) {
    const n = nr * 4 + i, k = knoppen[n], x = i * KOLOM;
    if (i > 0) staander(buf, x - 1, 19, 50, true);
    if (!k || k.waarde === null || k.waarde === undefined) {
      tekst(buf, x + 2, 21, k?.label ? pasIn(k.label) : String(n + 1));
      continue;
    }
    if (s.gedraaid === n) { vul(buf, x, 20, KOLOM - 1, 9); tekst(buf, x + 2, 21, pasIn(k.label), 1, true); }
    else tekst(buf, x + 2, 21, pasIn(k.label));
    tekst(buf, x + 2, 31, pasIn(k.tekst ?? `${Math.round(k.waarde * 100)}%`));
    (k.bipolair ? balkMidden : balk)(buf, x + 2, 42, KOLOM - 5, 8, k.waarde);
  }
  lijn(buf, 0, BREED - 1, 53, true);
  const onder = nr === 0
    ? (s.shift ? 'SHIFT: draaiknoppen fijn' : `< > pagina ${(s.paginaNr ?? 0) + 1}/${s.paginas ?? 1}: ${s.paginaNaam ?? ''}`)
    : (s.melding || 'CONTROL + knop = uitleg');
  tekst(buf, 2, 56, pasIn(onder, REGEL));
  return buf;
}

/**
 * CONTROL vast (stand.uitleg): links "UITLEG" omgekeerd, wat je aanraakte en wat het
 * hier doet (drie regels; wat niet past loopt door op het rechterscherm). Zonder iets
 * aangeraakt: hoe het werkt. Rechts, als er niets doorloopt, de vaste knoppen.
 */
function tekenUitleg(buf, s, nr) {
  const u = s.uitleg;
  const tekstRegels = u.titel ? regels(u.tekst || '', REGEL) : [];
  if (nr === 0) {
    vul(buf, 0, 0, BREED, 16);
    tekst(buf, 2, 1, 'UITLEG', 2, true);
    if (u.titel) {
      tekst(buf, 2, 20, pasIn(u.titel, REGEL));
      lijn(buf, 2, 2 + tekstBreedte(pasIn(u.titel, REGEL)), 28);
      tekstRegels.slice(0, 3).forEach((r, i) => tekst(buf, 2, 31 + i * 8, r));
    } else {
      ['houd CONTROL vast en raak iets aan:', 'een knop, draaiknop, pad of het wiel.', 'het gebeurt dan niet: hier staat', 'wat het doet.']
        .forEach((r, i) => tekst(buf, 2, 20 + i * 8, r));
    }
    lijn(buf, 0, BREED - 1, 53, true);
    tekst(buf, 2, 56, 'CONTROL los = weer spelen');
    return buf;
  }
  if (tekstRegels.length > 3) {
    tekstRegels.slice(3, 9).forEach((r, i) => tekst(buf, 2, 2 + i * 8, r));
    return buf;
  }
  kop(buf, 2, 1, 'overal', BREED - 4);
  lijn(buf, 0, BREED - 1, 17);
  ['< > links boven: knoppagina', 'groep A-H: focus op een track', 'STEP: stappen   SCENE: secties', 'SHIFT + draaien: fijn']
    .forEach((r, i) => tekst(buf, 2, 20 + i * 8, r));
  lijn(buf, 0, BREED - 1, 53, true);
  tekst(buf, 2, 56, pasIn(`nu: pagina ${s.paginaNaam ?? ''}`, REGEL));
  return buf;
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
 *   modus:     'spelen' | 'stappen' | 'secties'
 *   secties:   { nr, wat, aantal, blad, bladen, namen[16], aan[16], hoort, naar } | null   (modus secties, maschine.js)
 * }
 * @param nr 0 = links (knop 1–4), 1 = rechts (knop 5–8)
 * @returns Uint8Array(2048)
 */
export function tekenScherm(stand, nr) {
  const buf = leegScherm();
  const s = stand || {};
  // ---- uitleg (CONTROL vast): gaat voor alles ----
  if (s.uitleg) return tekenUitleg(buf, s, nr);
  // ---- de pagina's Strip en Rack: de focus-track en zijn knoppen ----
  if (s.dj && !((s.patroonVast || s.modus === 'stappen' || s.modus === 'secties') && nr === 0)) return tekenDj(buf, s, nr);
  // ---- kop ----
  // Links in de stapmodus of met PATTERN vast: het gekozen patroon in plaats van knop 1–4.
  if (nr === 0 && s.speel && s.patroon && (s.patroonVast || s.modus === 'stappen')) {
    const p = s.patroon;
    kop(buf, 2, 1, s.patroonVast ? `T${s.speel.nr} kies patroon` : `T${s.speel.nr} ${s.speel.naam} P${p.plek}`, BREED - 4);
    lijn(buf, 0, BREED - 1, 17);
    if (s.patroonVast) tekenPlekken(buf, p); else tekenStappen(buf, p);
    lijn(buf, 0, BREED - 1, 53, true);
    const onder = s.melding || (s.patroonVast ? 'pad 1-5 = kiezen, PLAY = starten'
      : p.bladzijden > 1 ? `< > blad ${p.bladzijde + 1}/${p.bladzijden}, SHIFT < > lengte` : 'pad = stap, SHIFT < > = lengte');
    tekst(buf, 2, 56, pasIn(onder, Math.floor((BREED - 4) / STAP)));
    return buf;
  }
  // Links in de modus secties (SCENE): de focus-track en zijn secties in plaats van knop 1–4.
  if (nr === 0 && s.modus === 'secties' && s.secties && !s.patroonVast) {
    const c = s.secties;
    kop(buf, 2, 1, c.aantal ? `T${c.nr} ${c.hoort ?? ''}`
      : `T${c.nr} ${c.wat === 'nummer' ? 'nog geen secties' : c.wat === 'leeg' ? 'leeg' : `${c.wat}: geen nummer`}`, BREED - 4);
    lijn(buf, 0, BREED - 1, 17);
    tekenSecties(buf, c);
    lijn(buf, 0, BREED - 1, 53, true);
    const onder = c.naar ? `op de 1: ${c.naar}`
      : !c.aantal ? (c.wat === 'nummer' ? 'de secties komen na het laden' : 'secties horen bij een nummer: groep A-H')
      : c.bladen > 1 ? `pad = sectie op de 1, < > blad ${c.blad + 1}/${c.bladen}` : 'pad = sectie, valt in op de 1';
    tekst(buf, 2, 56, pasIn(onder, Math.floor((BREED - 4) / STAP)));
    return buf;
  }
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
