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
 * WERKRUIMTE (spoor S6, docs/werkruimte/S6.md): staat er een werkruimte met delen (stand.delen),
 *   dan staan bovenaan de acht deelnamen (F1–F4 links, F5–F8 rechts, recht onder de knoppen), het
 *   actieve deel omgekeerd (`tekenDeelLabels`); de rest van het scherm schuift 9 px omlaag en de
 *   onderregel valt weg. Een deel kan per scherm de fasescoop (`tekenFasescoop`) of de getallen
 *   van de uitlijnweergave (`tekenGetallen`, src/uitlijn/reken.js) kiezen (stand.scherm).
 *   Zonder werkruimte: elk scherm bit voor bit zoals hierboven.
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
/** Zoveel rijen van de library passen links bij bladeren (10 px per rij). */
export const BLADER_RIJEN = 4;

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
    : (s.melding || (s.modus === 'sampler' ? 'SAMPLING = weer spelen' : 'CONTROL + knop = uitleg'));
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
  ['< > links boven: knoppagina', 'groep A-H: focus op een track', 'STEP SCENE SAMPLING: padmodus', 'BROWSE: library   SHIFT: fijn']
    .forEach((r, i) => tekst(buf, 2, 20 + i * 8, r));
  lijn(buf, 0, BREED - 1, 53, true);
  tekst(buf, 2, 56, pasIn(`nu: pagina ${s.paginaNaam ?? ''}`, REGEL));
  return buf;
}

/**
 * De padmodus sampler links (stand.sampler, docs/MASCHINE.md §5f): kop "SAMPLER" omgekeerd met
 * de lengte en het volume; acht vakjes zoals de pads liggen (boven pad 1–4, daaronder 5–8): het
 * nummer en wat erin zit ("T1 4t" = van track 1, 4 tellen; "(T2)" = bewaard, terug te halen;
 * "knipt"; "leeg"), een pad die speelt omgekeerd. Onderaan welke sectie een sectie-pad nu pakt.
 */
function tekenSampler(buf, s) {
  const c = s.sampler;
  vul(buf, 0, 0, BREED, 10);
  tekst(buf, 2, 1, c.focus ? `SAMPLER T${c.focus}` : 'SAMPLER', 1, true);   // T = waar een lege pad van knipt (de focus-track)
  const kop = [c.tellen ? `${c.tellen} tel${c.tellen === 1 ? '' : 'len'}` : '', c.volume == null ? '' : `vol ${Math.round(c.volume * 100)}%`].filter(Boolean).join('  ');
  if (kop) tekst(buf, BREED - 2 - tekstBreedte(kop), 1, kop, 1, true);
  for (let n = 0; n < 8; n++) {
    const p = c.pads?.[n] ?? {};
    const x = (n % 4) * KOLOM, y = n < 4 ? 12 : 31;
    const wat = p.bezig ? 'knipt' : p.gevuld ? `T${p.bron ?? '?'} ${p.tellen ?? '?'}t` : p.bewaard ? `(T${p.bewaardBron ?? '?'})` : 'leeg';
    if (p.speelt) vul(buf, x, y - 1, KOLOM - 1, 18);
    tekst(buf, x + 2, y, String(n + 1), 1, !!p.speelt);
    tekst(buf, x + 2, y + 9, pasIn(wat), 1, !!p.speelt);
    if (n % 4) staander(buf, x - 1, y - 1, y + 16, true);
  }
  lijn(buf, 0, BREED - 1, 29, true);
  lijn(buf, 0, BREED - 1, 53, true);
  tekst(buf, 2, 56, pasIn(s.melding || (c.sectie ? `onder: sectie ${c.sectie}` : 'SHIFT+pad = leeg  < > = tellen'), REGEL));
  return buf;
}

/**
 * Bladeren (stand.bladeren, docs/MASCHINE.md §5e: de library staat open). Links de
 * lijst: kop "LIBRARY" omgekeerd met n/totaal, vier rijen (titel, rechts de bpm), het
 * gekozen nummer omgekeerd; een rij die nog niet binnen is: "...". Rechts het gekozen
 * nummer groot, wie, bpm/toon/duur, waar ENTER hem heen laadt, en een melding.
 */
function tekenBladeren(buf, s, nr) {
  const b = s.bladeren;
  if (nr === 0) {
    vul(buf, 0, 0, BREED, 10);
    const teller = b.totaal ? `${b.gekozen + 1}/${b.totaal}` : '0';
    // Spoor S11: met een filter (een categorie, tags) staat dat in de kop in plaats van LIBRARY.
    tekst(buf, 2, 1, b.filter ? pasIn(b.filter, Math.floor((BREED - 8 - tekstBreedte(teller)) / STAP)) : 'LIBRARY', 1, true);
    tekst(buf, BREED - 2 - tekstBreedte(teller), 1, teller, 1, true);
    if (!b.totaal) {
      tekst(buf, 2, 20, pasIn(b.zoek ? `niets gevonden voor ${b.filter || `"${b.zoek}"`}` : 'nog niets binnengehaald', REGEL));
      tekst(buf, 2, 28, pasIn(b.zoek ? 'zoek iets anders in de library' : 'plak een link in de library', REGEL));
    }
    (b.rijen || []).slice(0, BLADER_RIJEN).forEach((r, i) => {
      const y = 13 + i * 10;
      if (r.gekozen) vul(buf, 0, y - 1, BREED, 9);
      const bpm = r.titel === null || !r.bpm || r.bpm === '—' ? '' : String(r.bpm);
      const ruimte = Math.floor((BREED - 6 - (bpm ? tekstBreedte(bpm) + STAP : 0)) / STAP);
      tekst(buf, 2, y, r.titel === null ? '...' : pasIn(r.titel, ruimte), 1, r.gekozen);
      if (bpm) tekst(buf, BREED - 2 - tekstBreedte(bpm), y, bpm, 1, r.gekozen);
    });
    lijn(buf, 0, BREED - 1, 53, true);
    tekst(buf, 2, 56, pasIn(b.totaal ? 'wiel = kiezen  < > = 10 verder' : 'BROWSE = library dicht', REGEL));
    return buf;
  }
  const t = b.track;
  if (!t) {
    kop(buf, 2, 1, b.totaal ? 'even geduld...' : 'library leeg', BREED - 4);
  } else {
    kop(buf, 2, 1, t.titel || '(geen titel)', BREED - 4);
  }
  lijn(buf, 0, BREED - 1, 17);
  if (t) {
    if (t.artiest) tekst(buf, 2, 20, pasIn(t.artiest, REGEL));
    tekst(buf, 2, 28, pasIn([t.bpm && t.bpm !== '—' ? `${t.bpm} BPM` : 'geen grid', t.toon && t.toon !== '—' ? t.toon : '', t.duur].filter(Boolean).join('  '), REGEL));
  }
  // Een melding ("speelt: nog eens") gaat voor, op twee regels; anders waar ENTER hem heen laadt.
  if (b.melding) regels(b.melding, REGEL).slice(0, 2).forEach((r, i) => tekst(buf, 2, 36 + i * 8, r));
  else if (t) tekst(buf, 2, 38, pasIn(b.laadt ? 'laden...' : `ENTER = laden op T${b.focus ?? '?'}`, REGEL));
  lijn(buf, 0, BREED - 1, 53, true);
  tekst(buf, 2, 56, pasIn(s.melding || 'BROWSE = library dicht', REGEL));
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
 *   bladeren:  { gekozen, totaal, rijen[{ titel, bpm, gekozen }], track, focus, melding, zoek, filter, laadt } | null   (de library open; filter = kort, S11)
 *   sampler:   { pads[8] (sampler.stand()), tellen, volume, focus, sectie } | null   (padmodus sampler)
 * }
 * @param nr 0 = links (knop 1–4), 1 = rechts (knop 5–8)
 * @returns Uint8Array(2048)
 */
export function tekenScherm(stand, nr) {
  const s = stand || {};
  // ---- uitleg (CONTROL vast): gaat voor alles, ook voor de deelnamen ----
  if (s.uitleg) return tekenUitleg(leegScherm(), s, nr);
  const buf = tekenInhoud(s, nr);
  return s.delen ? metDeelLabels(buf, s.delen, nr, s.melding) : buf;
}

/** Hoe hoog de regel met de deelnamen is (een letter + een pixel erboven en eronder). */
export const LABEL_H = 9;

/**
 * De deelnamen bovenaan (F1–F8 staan recht boven de schermen: F1–F4 boven het linker, F5–F8 boven
 * het rechter, elk 64 px breed). Het actieve deel omgekeerd: een vol vlak met de letters uit.
 * Puur: tekent op `buf` (standaard een leeg scherm) in de rijen 0 .. LABEL_H − 1 en geeft hem terug.
 *
 * @param delen   [label, …] (hooguit 8; een lege plek = geen deel)
 * @param actief  index 0..7 van het deel van nu, of -1
 * @param nr      0 = links (deel 1–4), 1 = rechts (deel 5–8)
 */
export function tekenDeelLabels(delen, actief, { nr = 0, buf = leegScherm() } = {}) {
  for (let y = 0; y < LABEL_H; y++) for (let x = 0; x < BREED; x++) wisPixel(buf, x, y);
  for (let j = 0; j < 4; j++) {
    const i = nr * 4 + j, x = j * KOLOM;
    const label = delen?.[i];
    if (j > 0) staander(buf, x - 1, 0, LABEL_H - 2, true);
    if (typeof label !== 'string' || !label) continue;
    const t = pasIn(label);
    const tx = x + Math.max(1, Math.floor((KOLOM - 1 - tekstBreedte(t)) / 2));
    if (i === actief) { vul(buf, x, 0, KOLOM - 1, LABEL_H - 1); tekst(buf, tx, 1, t, 1, true); }
    else tekst(buf, tx, 1, t);
  }
  lijn(buf, 0, BREED - 1, LABEL_H - 1, true);
  return buf;
}

/**
 * De inhoud 9 px omlaag (de onderste 9 rijen vallen weg) en de deelnamen erboven. Een melding
 * ("T1 speelt: druk nog eens") stond in die onderste rijen: dan staat ze zolang in plaats van de
 * deelnamen, omgekeerd (review ronde 1: anders zag je de vraag om een tweede druk niet).
 */
function metDeelLabels(buf, delen, nr, melding = null) {
  const uit = leegScherm();
  uit.set(buf.subarray(0, 32 * (HOOG - LABEL_H)), 32 * LABEL_H);
  if (!melding) return tekenDeelLabels(delen.labels, delen.actief ?? -1, { nr, buf: uit });
  vul(uit, 0, 0, BREED, LABEL_H - 1);
  tekst(uit, 2, 1, pasIn(melding, REGEL), 1, true);
  return uit;
}

/** Zo breed is de fasescoop: ± BEREIK_MS over de hele breedte (4 px per ms). */
export const SCOOP_MS = 32;
const scoopX = (ms) => Math.round(BREED / 2 + (ms / SCOOP_MS) * (BREED / 2));

/**
 * De fasescoop van de focus-track (src/uitlijn/reken.js `vouw`): elke gehoorde tel van de track
 * als een stip op zijn fase tegen de maatgever (midden = gelijk, rechts = de track loopt VOOR,
 * 4 px per ms, ±32 ms), de nieuwste bovenaan, één rij per tel. Gelijk = een smalle staander in het
 * midden, drift = een schuine lijn, een flam = twee staanders. Onderin streepjes voor de tellen van
 * de maatgever zelf (het ijkpunt). Wat buiten ±32 ms valt, staat als pijl op de rand.
 *
 * @param vouw  { bron, punten: [{ ms, k, wie }] } of null
 * @param buf   het scherm om op te tekenen (standaard leeg); rijen y0 .. y0 + h − 1
 */
export function tekenFasescoop(vouw, { buf = leegScherm(), y0 = 0, h = HOOG } = {}) {
  const midden = BREED / 2;
  for (let y = y0; y < y0 + h; y += 2) zetPixel(buf, midden, y);
  for (const ms of [-20, -10, 10, 20]) { const x = scoopX(ms); zetPixel(buf, x, y0); zetPixel(buf, x, y0 + h - 1); }
  const punten = vouw?.punten ?? [];
  const rijen = h - 6;
  for (const p of punten) {
    if (typeof p.ms !== 'number' || !Number.isFinite(p.ms)) continue;
    const buiten = Math.abs(p.ms) > SCOOP_MS;
    const x = buiten ? (p.ms > 0 ? BREED - 2 : 1) : scoopX(p.ms);
    if (p.wie === 'maatgever') {
      if (p.k < 8) for (let y = y0 + h - 4; y < y0 + h - 1; y++) zetPixel(buf, x, y);
      continue;
    }
    if (!(p.k >= 0) || p.k >= rijen) continue;
    const y = y0 + 1 + p.k;
    zetPixel(buf, x, y); zetPixel(buf, x - 1, y); zetPixel(buf, x + 1, y);
    if (buiten) zetPixel(buf, x + (p.ms > 0 ? -2 : 2), y);
  }
  return buf;
}

/** Een getal in ms met teken en komma ("+2,3 ms"), of "-". */
const msTekst = (ms) => (typeof ms !== 'number' || !Number.isFinite(ms) ? '-' : `${ms > 0 ? '+' : ms < 0 ? '-' : ''}${komma(Math.abs(ms).toFixed(1))} ms`);
const komma = (t) => t.replace('.', ',');

/**
 * De getallen van de uitlijnweergave voor de focus-track (src/uitlijn/reken.js `getallen`): grid Δ,
 * muziek Δ, drift per 16 tellen en de maat, één per regel; een ! als het grid naast zijn muziek ligt.
 * Puur: tekent op `buf` vanaf rij y0 (vier regels van 8 px) en geeft hem terug.
 */
export function tekenGetallen(getallen, { buf = leegScherm(), y0 = 0 } = {}) {
  const g = getallen;
  if (!g) { tekst(buf, 2, y0, 'geen maatgever of geen grid'); return buf; }
  if (g.maatgever) {
    tekst(buf, 2, y0, 'deze track geeft de maat');
    if (g.afwijking !== null && g.afwijking !== undefined) tekst(buf, 2, y0 + 8, pasIn(`! grid naast muziek ${msTekst(g.afwijking)}`, 42));
    return buf;
  }
  const maat = g.maat === null || g.maat === undefined ? '-' : g.maat === 0 ? 'op de 1' : `${g.maat > 0 ? '+' : ''}${g.maat} tel`;
  const rijen = [['grid', msTekst(g.grid)], ['muziek', msTekst(g.muziek)], ['drift', `${msTekst(g.drift)}/16`], ['maat', maat]];
  rijen.forEach(([naam, w], i) => { tekst(buf, 2, y0 + i * 8, naam); tekst(buf, 50, y0 + i * 8, pasIn(w, 22)); });
  if (g.afwijking !== null && g.afwijking !== undefined) tekst(buf, 160, y0, '! grid');
  if (g.wacht !== null && g.wacht !== undefined) tekst(buf, 160, y0 + 8, pasIn(`valt in ${komma(String(g.wacht))}`, 15));
  return buf;
}

/** De fasescoop als heel scherm: kop (track en hoe ver hij naast ligt), de scoop, onderregel. */
function tekenScoopScherm(buf, s) {
  const u = s.uitlijn ?? {};
  const eigen = (u.vouw?.punten ?? []).filter((p) => p.wie !== 'maatgever' && p.k < 8 && Number.isFinite(p.ms)).map((p) => p.ms).sort((a, b) => a - b);
  const mediaan = eigen.length ? eigen[eigen.length >> 1] : null;
  tekst(buf, 2, 1, pasIn(`T${u.nr ?? '?'} fase ${mediaan === null ? '' : msTekst(mediaan)}`, 26));
  if (u.getallen?.bpm) { const b = `${komma(u.getallen.bpm.toFixed(2))} BPM`; tekst(buf, BREED - 2 - tekstBreedte(b), 1, b); }
  lijn(buf, 0, BREED - 1, 9);
  if (!u.vouw) tekst(buf, 2, 24, 'geen maatgever, of geen grid');
  else tekenFasescoop(u.vouw, { buf, y0: 11, h: 42 });
  lijn(buf, 0, BREED - 1, 53, true);
  tekst(buf, 2, 56, pasIn(u.vouw ? 'midden = gelijk, rechts = voor (4 px/ms)' : 'groep A-H: focus', REGEL));
  return buf;
}

/** De getallen als heel scherm. */
function tekenGetallenScherm(buf, s) {
  const u = s.uitlijn ?? {};
  kop(buf, 2, 1, `T${u.nr ?? '?'} uitlijn`, BREED - 4);
  lijn(buf, 0, BREED - 1, 17);
  tekenGetallen(u.getallen, { buf, y0: 20 });
  lijn(buf, 0, BREED - 1, 53, true);
  tekst(buf, 2, 56, pasIn('grid = wat het grid zegt, muziek = de kicks', REGEL));
  return buf;
}

/** De inhoud van een scherm (zonder uitleg en zonder deelnamen). */
function tekenInhoud(s, nr) {
  const buf = leegScherm();
  // ---- bladeren (de library open): de lijst en het gekozen nummer ----
  if (s.bladeren) return tekenBladeren(buf, s, nr);
  // ---- een deel kiest voor dit scherm de fasescoop of de getallen ----
  if (s.scherm?.[nr] === 'fasescoop') return tekenScoopScherm(buf, s);
  if (s.scherm?.[nr] === 'getallen') return tekenGetallenScherm(buf, s);
  // ---- de pagina's Strip en Rack: de focus-track en zijn knoppen ----
  if (s.dj && !((s.patroonVast || s.modus === 'stappen' || s.modus === 'secties' || s.modus === 'sampler') && nr === 0)) return tekenDj(buf, s, nr);
  // Links in de padmodus sampler: de acht pads in plaats van knop 1–4.
  if (nr === 0 && s.modus === 'sampler' && s.sampler && !s.patroonVast) return tekenSampler(buf, s);
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
    // Zonder instrument alleen het nummer, behalve een knop die niet van het instrument is (k.vast: sampler-volume).
    if ((!s.speel && !k?.vast) || !k || k.waarde === null || k.waarde === undefined) {
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
    : (s.melding || (s.kandidaat ? 'druk op het wiel = zetten' : s.modus === 'sampler' ? 'SAMPLING = weer spelen' : 'wiel = instrument kiezen'));
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
