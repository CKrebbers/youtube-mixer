/**
 * De rekenkern van het streamen. Geen Web Audio, geen fetch, geen DOM: puur
 * rekenwerk, zodat hij in Node te testen is en de hoofdthread en de worklet
 * EXACT dezelfde code draaien.
 *
 * Dat laatste is het hele punt. De hoofdthread moet weten waar het deck is
 * (golfvorm, beatgrid, effecten op de tel) en de worklet moet weten welke
 * sample hij nu speelt. Twee tellers lopen uit elkaar; twee keer dezelfde
 * formule op dezelfde audioklok niet. Regel 3, maar dan over een draadgrens.
 *
 * Het segment:
 *   { T, P, R, loop, speelt, rem }
 *   "vanaf audiokloktijd T staat de positie op P en loopt hij met snelheid R"
 *   rem = { a } (a < 0): hij REMT (vinylstop): positie = P + R·dt + a·dt²/2,
 *   tot de snelheid R + a·dt op 0 staat; daarna staat hij stil. rem = null
 *   (of ontbreekt): de gewone rechte lijn, bit voor bit zoals altijd.
 *
 *   Waarom een object en geen getal `a` op het segment: net als `loop`. Een
 *   getal-veld dat op sommige segmenten ontbreekt, laat V8 bij ELK lezen een
 *   nieuw getal-object maken (de waarde moet dan "getal of undefined" zijn),
 *   en dat was afval op de audiothread (gemeten: 260 bytes per blok). Een
 *   object-veld lezen maakt niets aan, ook als het ontbreekt.
 *
 * Elke wijziging (play, seek, pitch, loop, rem) is een nieuw segment. Komt het
 * bericht een paar milliseconden te laat bij de worklet aan, dan rekent hij
 * de formule gewoon vanaf T door en zit hij meteen op de goede plek.
 *
 * De rem zit in positieOp en nergens anders in het audiopad: renderBlok vraagt
 * elke positie aan positieOp (zie posities()). Daarnaast rekent ctxTijdVan
 * hem terug, zegt snelheidOp hoe snel het nu gaat (voor de video), en dooft
 * remUit het geluid in het laatste stuk (zie REM_UIT).
 */

export const PAGINA = 65536;           // frames per pagina, ~1,37 s op 48 kHz
export const KANALEN = 2;
export const BYTES_PER_FRAME = 4;      // 16 bit stereo (audio.wav); stems: zie bytesPerFrame
export const PAGINA_BYTES = PAGINA * BYTES_PER_FRAME;

/**
 * Hoeveel kanalen een bestand mag hebben: stereo (audio.wav), of twee of
 * vier stems als stereoparen naast elkaar (stems.wav, docs/STEMS.md §1).
 * Kanaalpaar k (kanalen 2k, 2k+1) is één stem. Meer dan vier paren kan de
 * worklet niet afspelen: hij heeft vier uitgangen.
 */
export const KANALEN_TOEGESTAAN = [2, 4, 8];

/**
 * Bytes per frame uit de kop: 16 bit maal het aantal kanalen. Een pagina is
 * altijd PAGINA FRAMES, dus PAGINA × bytesPerFrame bytes: met stems even veel
 * muziek per pagina als zonder, alleen breder.
 */
export const bytesPerFrame = (kop) => kop.kanalen * (kop.bits / 8);

/**
 * Zoveel uitgangen heeft de worklet (stream-lezer.js), altijd, elk van twee
 * kanalen: uitgang k speelt kanaalpaar k. Een stereobestand speelt op
 * uitgang 0, de rest is stil.
 */
export const UITGANGEN = 4;

export const STIL = Object.freeze({ T: 0, P: 0, R: 1, loop: null, speelt: false, rem: null });

/**
 * Onder dit deel van de beginsnelheid dooft een rem uit, lineair tot stilte
 * op het moment van stilstand. Tot dan klinkt hij vol: de toon zakt, dat is
 * de rem. Het laatste stuk (bij 1 s remmen de laatste 250 ms, twee octaven
 * en meer omlaag) zou anders een trage golf van volle sterkte zijn die op
 * stilstand als een gelijkspanning blijft staan: een plof, en dan een tik
 * als hij wegvalt. Een draaitafel doet hetzelfde vanzelf: een element geeft
 * spanning naar snelheid.
 */
export const REM_UIT = 0.25;

/**
 * Positie in tracktijd (seconden) op audiokloktijd t.
 *
 * Met een rem (seg.rem.a < 0) loopt de snelheid lineair van R naar 0 en blijft
 * de positie daarna staan, vóór het vouwen in de loop. Zonder rem precies
 * de oude regel: een segment zonder rem geeft bit voor bit hetzelfde (de
 * gouden hash in test/renderblok.test.mjs). Dezelfde functie draait op de
 * hoofdthread (bron.js) en per frame in de worklet, dus beide zien de rem
 * meteen. Houd hem klein en zonder objecten: hij wordt in posities()
 * ingelijfd, en anders is het audiopad niet meer afvalvrij.
 */
export function positieOp(seg, t) {
  if (!seg.speelt) return seg.P;
  let p;
  const rem = seg.rem;
  if (rem) {
    // Remmen: na dt = -R/a staat hij stil, en daar blijft hij.
    const a = rem.a;
    let dt = t - seg.T;
    const stil = -seg.R / a;
    if (dt > stil) dt = stil;
    p = seg.P + dt * (seg.R + 0.5 * a * dt);
  } else p = seg.P + (t - seg.T) * seg.R;
  const loop = seg.loop;
  if (loop) {
    const len = loop.end - loop.start;
    if (len > 0 && p >= loop.end) p = loop.start + ((p - loop.start) % len);
  }
  return p;
}

/**
 * Hoe snel de positie loopt op audiokloktijd t, in tracktijd per seconde:
 * R, of tijdens een rem wat daarvan over is (0 na stilstand). Niet voor het
 * audiopad; de video volgt hiermee een rem zonder te springen.
 */
export function snelheidOp(seg, t) {
  if (!seg.speelt) return 0;
  if (!seg.rem) return seg.R;
  return Math.max(0, Math.min(seg.R, seg.R + seg.rem.a * (t - seg.T)));
}

/** Wanneer een remmend segment stilstaat, op de audioklok. Null zonder rem. */
export const remStil = (seg) => (seg.speelt && seg.rem ? seg.T - seg.R / seg.rem.a : null);

/**
 * Wanneer passeert dit segment tracktijd x (voor het eerst na `nu`), op de
 * audioklok? Binnen een loop die al is rondgegaan telt de gevouwen positie:
 * rekenen vanaf P gaf dan een tijd in het verleden, en gate en sampler
 * vielen naast de tel. Tijdens een rem: null als hij stilstaat voordat hij
 * er is.
 *
 * Een GEPLANDE start (T na `nu`, starten op de maat): tot T staat hij stil op
 * P, dus er wordt vanaf T gerekend, niet vanaf `nu`. Rekenen vanaf `nu` liep
 * een denkbeeldige positie vóór P terug, en een punt in de loop tussen die
 * positie en P kreeg dan een tijd vóór T, terwijl hij daar pas na een ronde
 * langskomt. Een punt achter P buiten de loop geeft (net als een punt achter
 * de speelkop) een tijd vóór T: daar komt hij niet meer langs.
 */
export function ctxTijdVan(seg, x, nu = seg.T) {
  if (!seg.speelt) return null;
  const vanaf = Math.max(nu, seg.T);
  const pos = positieOp(seg, vanaf);
  const loop = seg.loop;
  const rond = loop && x < pos && x >= loop.start && loop.end > loop.start;
  if (!seg.rem) {
    let t = vanaf + (x - pos) / seg.R;
    if (rond) t += (loop.end - loop.start) / seg.R;
    return t;
  }
  // Remmen: de afstand s afleggen met snelheid v die met a afneemt, dus
  // v·τ + a·τ²/2 = s. De kleinste wortel, in de vorm die niet wegvalt als a
  // klein is: τ = 2s / (v + √(v² + 2as)). Onder de wortel negatief: hij
  // staat eerder stil. (Een gepland segment heeft geen rem; `vanaf` is hier
  // dus gewoon `nu`, tenzij iemand ooit een rem in de toekomst plant.)
  const s = x - pos + (rond ? loop.end - loop.start : 0);
  if (s === 0) return vanaf;
  const v = snelheidOp(seg, vanaf);
  const d = v * v + 2 * seg.rem.a * s;
  if (d < 0) return null;
  const tau = (2 * s) / (v + Math.sqrt(d));
  return Number.isFinite(tau) ? vanaf + tau : null;
}

// ---- WAV ------------------------------------------------------------------

/**
 * Leest de kop van een WAV-bestand en zoekt waar de samples beginnen.
 *
 * Niet uitgaan van 44 bytes: ffmpeg zet er een LIST-chunk met metadata voor,
 * en dan zou je de eerste milliseconden als ruis afspelen en alles daarna een
 * paar samples verschoven.
 */
export function leesWavKop(buf) {
  const v = new DataView(buf);
  const tekst = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 12 || tekst(0) !== 'RIFF' || tekst(8) !== 'WAVE') throw new Error('geen WAV-bestand');
  let o = 12, fmt = null;
  while (o + 8 <= buf.byteLength) {
    const id = tekst(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = {
        formaat: v.getUint16(o + 8, true),
        kanalen: v.getUint16(o + 10, true),
        sampleRate: v.getUint32(o + 12, true),
        bits: v.getUint16(o + 22, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV: data vóór fmt');
      return { ...fmt, dataStart: o + 8, dataLengte: len };
    }
    o += 8 + len + (len & 1);          // chunks zijn op even bytes uitgelijnd
  }
  throw new Error('WAV: geen data-chunk in de eerste kilobytes');
}

/**
 * Een WAV in precies het formaat van de ingest (16-bit PCM stereo), uit
 * Float32-kanalen. Voor losse bestanden en de demotrack: die gaan zo door
 * dezelfde streamkern als de library. Mono wordt op beide kanalen gezet.
 * @returns ArrayBuffer met een kop van 44 bytes
 */
export function maakWav(kanalen, sampleRate) {
  const L = kanalen[0], R = kanalen[1] ?? kanalen[0];
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * BYTES_PER_FRAME);
  const v = new DataView(buf);
  const schrijf = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  schrijf(0, 'RIFF'); v.setUint32(4, 36 + n * BYTES_PER_FRAME, true); schrijf(8, 'WAVE');
  schrijf(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * BYTES_PER_FRAME, true); v.setUint16(32, BYTES_PER_FRAME, true); v.setUint16(34, 16, true);
  schrijf(36, 'data'); v.setUint32(40, n * BYTES_PER_FRAME, true);
  const pcm = new Int16Array(buf, 44);
  const naar16 = (x) => { const c = Math.max(-1, Math.min(1, x)); return Math.round(c < 0 ? c * 32768 : c * 32767); };
  for (let i = 0; i < n; i++) { pcm[i * 2] = naar16(L[i]); pcm[i * 2 + 1] = naar16(R[i]); }
  return buf;
}

/**
 * Alleen wat de worklet kan lezen. Liever nu een duidelijke fout dan straks ruis.
 * 2, 4 of 8 kanalen: stereo, of stereoparen voor stems. Of het aantal past
 * bij wat de aanroeper verwacht (stems of niet), zegt de StreamBron.
 */
export function controleerWav(kop) {
  if (kop.formaat !== 1 && kop.formaat !== 0xfffe) return `WAV-formaat ${kop.formaat} wordt niet ondersteund (alleen PCM)`;
  if (kop.bits !== 16) return `${kop.bits}-bit WAV wordt niet ondersteund (alleen 16-bit)`;
  if (!KANALEN_TOEGESTAAN.includes(kop.kanalen)) return `${kop.kanalen} kanalen wordt niet ondersteund (alleen 2, 4 of 8: stereo of stereoparen)`;
  return null;
}

// ---- welke pagina's --------------------------------------------------------

export const paginaVan = (sec, sr) => Math.floor((sec * sr) / PAGINA);

/**
 * Welke pagina's moeten er zijn, belangrijkste eerst?
 *
 * Vooruit ruim, achteruit een beetje (nudge, korte scratch), plus vastgepinde
 * pagina's rond hotcues, cuepunt en loop: daar spring je naartoe zonder
 * waarschuwing, en dan mag er geen gat vallen.
 */
export function plan({ positie, rate = 1, duur, sr, vastpunten = [], loop = null,
  vooruit = 20, achteruit = 5, rondPunt = 3 }) {
  const laatste = Math.max(0, Math.ceil((duur * sr) / PAGINA) - 1);
  const lijst = [];
  const gezien = new Set();
  const voeg = (a, b) => {
    const p0 = Math.max(0, paginaVan(a, sr)), p1 = Math.min(laatste, paginaVan(b, sr));
    for (let p = p0; p <= p1; p++) if (!gezien.has(p)) { gezien.add(p); lijst.push(p); }
  };
  const r = Math.max(0.5, Math.abs(rate));
  voeg(positie, positie + 2 * r);                          // wat nu klinkt
  if (loop) voeg(loop.start - 0.05, loop.end);              // een loop moet heel zijn, plus zijn naad
  voeg(positie, positie + vooruit * r);
  for (const t of vastpunten) if (t !== null && t !== undefined && t >= 0) voeg(t, t + rondPunt);
  voeg(positie - achteruit, positie);
  return lijst;
}

/** Aaneengesloten pagina's samenvoegen tot één verzoek, hooguit `max` lang. */
export function reeksen(paginas, max = 8) {
  const s = [...paginas].sort((a, b) => a - b);
  const uit = [];
  for (const p of s) {
    const laatste = uit[uit.length - 1];
    if (laatste && p === laatste.tot + 1 && laatste.tot - laatste.van + 1 < max) laatste.tot = p;
    else uit.push({ van: p, tot: p });
  }
  return uit;
}

// ---- samples lezen ---------------------------------------------------------

/*
 * GEEN AFVAL OP DE AUDIOTHREAD (ROADMAP 22, cijfers in docs/AUDIOPAD.md).
 *
 * Acht decks, elk 375 blokken per seconde. Alles wat hier per blok of per
 * frame een object aanmaakt, moet de garbage collector opruimen, en die
 * draait op de audiothread zelf: een pauze daar is een tik. Vóór de ombouw
 * was het ~12,7 kB per blok (een array [L, R] per frame, en elke double die
 * een niet-geïnlinede functie in of uit ging als los HeapNumber-object):
 * een kleine GC zo'n negen keer per seconde.
 *
 * De regels die dat voorkomen:
 *   - tussenresultaten in vaste Float64Arrays (`klad`). Float64 is precies
 *     een JS-getal: er wordt niets afgerond, de uitvoer blijft bit voor bit;
 *   - een hulpfunctie op het hete pad krijgt alleen objecten en HELE getallen
 *     mee en geeft niets (of een boolean) terug, nooit een losse double. Een
 *     double over een functiegrens wordt een HeapNumber zodra V8 die functie
 *     niet inlinet, en of hij inlinet hangt af van een budget dat per
 *     V8-versie verschilt. Zo hangt "geen afval" niet van de inliner af;
 *   - wat per blok vastligt (t0, rates, duur) staat als veld op `klad`, niet
 *     als argument, om dezelfde reden;
 *   - positieOp (een double erin, een double eruit) komt alleen in
 *     `posities()` voor, een lus die niets anders doet: daar is hij de enige
 *     kandidaat voor het inlinebudget en wordt hij ruim ingelijfd, ook met
 *     een term erbij. Gebeurt dat ooit niet, dan ziet de test het.
 * test/renderblok.test.mjs bewaakt het (heap over duizenden blokken) en
 * tools/bench/renderblok.mjs meet het.
 *
 * Eén klad voor alle decks: de worklet rendert ze na elkaar, nooit door
 * elkaar heen, en renderBlok roept niets aan dat terugroept.
 *
 * STEMS (docs/STEMS.md §3): een pagina mag meer dan twee kanalen per frame
 * hebben (`stride`: 2, 4 of 8), en renderBlok leest er één stereopaar uit
 * (`paar`: het eerste kanaal, 0, 2, 4 of 6). De worklet roept hem per paar
 * aan, elk met zijn eigen `staat`. Stride en paar zijn hele getallen en
 * staan per blok op `klad`, zoals t0: geen afval, en voor stereo (stride 2,
 * paar 0) precies dezelfde indexen en dus bit voor bit dezelfde uitvoer.
 */

const VOORBIJ = 0, GEWOON = 1, NAAD = 2;        // soort frame, zie segKlad

/** Werkruimte voor één segment, `n` frames. */
function segKlad(n) {
  return {
    pos: new Float64Array(n),     // positie in tracktijd (s), uit positieOp
    f: new Float64Array(n),       // leespositie in frames
    g: new Float64Array(n),       // in de naad: de tweede leespositie, vlak vóór het loopbegin
    w: new Float64Array(n),       // in de naad: hoe ver (0..1)
    l: new Float64Array(n),       // het frame, links en rechts (na de naad)
    r: new Float64Array(n),
    gl: new Float64Array(n),      // wat er op g staat
    gr: new Float64Array(n),
    soort: new Uint8Array(n),     // VOORBIJ (na het trackeinde), GEWOON of NAAD
    metNaad: false,               // valt er een frame in de naad (dan een tweede lezing)
  };
}

const klad = {
  n: 0,                           // voor hoeveel frames er ruimte is
  // Per blok gezet door renderBlok. NaN en geen 0: dan zijn het vanaf het
  // begin double-velden, en die schrijft V8 ter plekke over.
  t0: NaN, ctxRate: NaN, trackRate: NaN, duur: NaN,
  nu: null,                       // segKlad van het segment
  oud: null,                      // segKlad van `vorig` (de overgang)
  yl: new Float64Array(4),        // de vier buren voor cubisch, links en rechts
  yr: new Float64Array(4),
  k0: -1, v0: false,              // heeftPagina: de laatste twee antwoorden (per blok)
  k1: -1, v1: false,
  // Per blok gezet: kanalen per frame in de pagina en het eerste kanaal van
  // het paar. Hele getallen vanaf het begin (geen NaN zoals t0): dan blijven
  // het kleine gehele getallen en kost lezen niets.
  stride: KANALEN, paar: 0,
  // Stems: de gat-envelop per frame van het eerste paar van dit blok, voor
  // de paren erna (zelfde pagina's, dus dezelfde envelop als ze met dezelfde
  // stand begonnen). envVan/envNa: de stand ervoor en erna.
  envs: null, envVan: NaN, envNa: NaN,
};

/** Eén keer (de worklet: 128 frames), of als een blok groter is dan ooit. */
function groei(frames) {
  if (klad.nu && frames <= klad.n) return;
  klad.n = frames;
  klad.nu = segKlad(frames);
  klad.oud = segKlad(frames);
  klad.envs = new Float64Array(frames);
}

/**
 * Frame n (beide kanalen van het paar) naar L[i] en R[i], of 0 als die
 * pagina er (nog) niet is. Stilte is het eerlijke antwoord op een gat; de
 * vorige pagina herhalen klinkt als een haperende cd.
 */
function leesFrame(paginas, n, L, R, i) {
  L[i] = 0; R[i] = 0;
  if (n < 0) return;
  const p = paginas.get(Math.floor(n / PAGINA));
  if (!p) return;
  const j = (n % PAGINA) * klad.stride + klad.paar;
  if (j < p.length) L[i] = p[j] * (1 / 32768);
  if (j + 1 < p.length) R[i] = p[j + 1] * (1 / 32768);
}

/**
 * Lezen op fractionele frameposities F[i], voor elke i < tot met
 * soort[i] >= vanaf: exact op een heel frame, anders cubisch (Catmull-Rom).
 */
function leesKubisch(paginas, F, L, R, soort, vanaf, tot) {
  const yl = klad.yl, yr = klad.yr;
  const s = klad.stride, paar = klad.paar;      // kanalen per frame, eerste kanaal van het paar
  for (let i = 0; i < tot; i++) {
    if (soort[i] < vanaf) continue;
    const f = F[i];
    const n = Math.floor(f);
    const x = f - n;
    // Afrondruis van de klokrekening: 12,9999999 is gewoon sample 13.
    if (x < 1e-7) { leesFrame(paginas, n, L, R, i); continue; }
    if (x > 1 - 1e-7) { leesFrame(paginas, n + 1, L, R, i); continue; }
    // De vier buren n-1..n+2 staan bijna altijd op één pagina: dan één keer
    // opzoeken in plaats van vier. Anders (paginagrens, gat, vóór het begin,
    // een afgekapte laatste pagina) frame voor frame, met dezelfde uitkomst.
    const k = Math.floor((n - 1) / PAGINA);
    const p = n >= 1 && k === Math.floor((n + 2) / PAGINA) ? paginas.get(k) : undefined;
    // Stereo: s = 2 en paar = 0, dus j, j+1 … j+7: dezelfde indexen als altijd.
    const j = ((n - 1) % PAGINA) * s + paar;
    if (p && j + 3 * s + 1 < p.length) {
      yl[0] = p[j] * (1 / 32768); yr[0] = p[j + 1] * (1 / 32768);
      yl[1] = p[j + s] * (1 / 32768); yr[1] = p[j + s + 1] * (1 / 32768);
      yl[2] = p[j + 2 * s] * (1 / 32768); yr[2] = p[j + 2 * s + 1] * (1 / 32768);
      yl[3] = p[j + 3 * s] * (1 / 32768); yr[3] = p[j + 3 * s + 1] * (1 / 32768);
    } else {
      leesFrame(paginas, n - 1, yl, yr, 0);
      leesFrame(paginas, n, yl, yr, 1);
      leesFrame(paginas, n + 1, yl, yr, 2);
      leesFrame(paginas, n + 2, yl, yr, 3);
    }
    let y0 = yl[0], y1 = yl[1], y2 = yl[2], y3 = yl[3];
    L[i] = y1 + 0.5 * x * (y2 - y0 + x * (2 * y0 - 5 * y1 + 4 * y2 - y3 + x * (3 * (y1 - y2) + y3 - y0)));
    y0 = yr[0]; y1 = yr[1]; y2 = yr[2]; y3 = yr[3];
    R[i] = y1 + 0.5 * x * (y2 - y0 + x * (2 * y0 - 5 * y1 + 4 * y2 - y3 + x * (3 * (y1 - y2) + y3 - y0)));
  }
}

/**
 * Hoe lang de naad van een loop wordt overgevloeid, in seconden.
 *
 * Springt een loop van zijn einde terug naar zijn begin, dan liggen die twee
 * samples bijna nooit op dezelfde hoogte: een sprong in de golfvorm, en die
 * hoor je als een tik. In de laatste 5 ms vóór het einde mengen we daarom
 * over naar wat er vlak vóór het BEGIN staat; op het moment van terugspringen
 * sluit het dan naadloos aan. Te kort om als fade te horen.
 */
export const LOOP_NAAD = 0.005;

/** Zo lang vloeien twee segmenten in elkaar over (play, seek, hotcue, stop). */
export const SEGMENT_FADE = 0.004;
/** Zo ver vooruit kijken naar een gat, en zo lang doet het uitvloeien erover. */
export const GAT_FADE = 0.003;

/** Is er data voor frame n en zijn buren (cubisch leest n-1..n+2)? */
function heeftFrame(paginas, n) {
  if (n < 0) return true;                 // vóór het begin is stilte, geen gat
  return heeftPagina(paginas, Math.floor(n / PAGINA)) && heeftPagina(paginas, Math.floor((n + 2) / PAGINA));
}

/**
 * Is pagina k er? Per frame wordt dat vier keer gevraagd, bijna altijd voor
 * dezelfde één of twee pagina's, en binnen een blok verandert het antwoord
 * niet (berichten komen tussen blokken). Dus: de laatste twee antwoorden
 * onthouden. renderBlok wist ze bij elk blok (ander deck, andere pagina's).
 */
function heeftPagina(paginas, k) {
  if (k === klad.k0) return klad.v0;
  if (k === klad.k1) return klad.v1;
  const v = paginas.has(k);
  klad.k1 = klad.k0; klad.v1 = klad.v0;
  klad.k0 = k; klad.v0 = v;
  return v;
}

/**
 * De positie van de eerste `tot` frames van dit blok, op de audioklok van
 * frame i: t0 + i / ctxRate. De ENIGE aanroep van positieOp in het audiopad,
 * in een lus die niets anders doet (zie boven: zo wordt hij geïnlined).
 */
function posities(seg, pos, tot) {
  const t0 = klad.t0, ctxRate = klad.ctxRate;
  for (let i = 0; i < tot; i++) pos[i] = positieOp(seg, t0 + i / ctxRate);
}

/**
 * Eén segment voor de eerste `tot` frames van het blok, naar S.l en S.r;
 * S.soort zegt welke frames voorbij het trackeinde vallen (VOORBIJ). Met de
 * loop-naad: in de laatste LOOP_NAAD van een loop overvloeien naar wat er
 * vlak vóór het begin staat.
 *
 * `hergebruik`: dit is een volgend paar van hetzelfde blok (stems). Waar
 * elk frame leest (pos, f, soort, en in de naad g en w) hangt alleen van het
 * segment en de klok af, niet van het paar: dat staat nog in S van het paar
 * ervoor. Alleen het lezen zelf (en naad en rem) wordt dan nog gedaan.
 */
function leesSegment(seg, paginas, S, tot, hergebruik) {
  const soort = S.soort;
  if (!hergebruik) {
    posities(seg, S.pos, tot);
    const loop = seg.loop;
    // De naad: hooguit een kwart van de loop, en nooit langer dan er vóór het
    // loopbegin staat. Een loop die op 0 s begint heeft daar niets, en de naad
    // vloeide dan naar stilte (een dip vlak voor elke herhaling). Liever dan
    // geen naad.
    const naad = loop ? Math.max(0, Math.min(LOOP_NAAD, (loop.end - loop.start) / 4, loop.start)) : 0;
    const trackRate = klad.trackRate, duur = klad.duur;
    const pos = S.pos;
    let metNaad = false;
    for (let i = 0; i < tot; i++) {
      const p = pos[i];
      if (!loop && p >= duur) { soort[i] = VOORBIJ; continue; }
      S.f[i] = p * trackRate;
      const rest = loop ? loop.end - p : Infinity;
      if (rest < naad && rest > 0) {
        S.w[i] = 1 - rest / naad;
        S.g[i] = (loop.start - rest) * trackRate;
        soort[i] = NAAD;
        metNaad = true;
      } else soort[i] = GEWOON;
    }
    S.metNaad = metNaad;
  }
  leesKubisch(paginas, S.f, S.l, S.r, soort, GEWOON, tot);
  if (S.metNaad) {
    leesKubisch(paginas, S.g, S.gl, S.gr, soort, NAAD, tot);
    for (let i = 0; i < tot; i++) {
      if (soort[i] !== NAAD) continue;
      // Equal-power: de twee stukken zijn niet gelijk, dus een lineaire fade
      // zou in het midden een dipje geven.
      const w = S.w[i];
      const a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2);
      S.l[i] = S.l[i] * a + S.gl[i] * b;
      S.r[i] = S.r[i] * a + S.gr[i] * b;
    }
  }
  if (seg.rem) remUit(seg, S, tot);
}

/**
 * Een remmend segment dooft uit zodra de snelheid onder REM_UIT van de
 * beginsnelheid komt, lineair tot 0 op het moment van stilstand (zie
 * REM_UIT). Zelfde klok als posities(): frame i valt op t0 + i / ctxRate.
 * Na stilstand is het stil; de positie staat dan vast en de hoofdthread
 * maakt er even later een pauze van.
 */
function remUit(seg, S, tot) {
  const t0 = klad.t0, ctxRate = klad.ctxRate;
  const k = seg.rem.a / seg.R;             // per seconde, negatief
  const L = S.l, R = S.r;
  for (let i = 0; i < tot; i++) {
    // Wat er van de beginsnelheid over is (1 → 0), gedeeld door REM_UIT.
    let g = (1 + k * (t0 + i / ctxRate - seg.T)) / REM_UIT;
    if (g > 1) g = 1;
    else if (!(g > 0)) g = 0;
    L[i] *= g; R[i] *= g;
  }
}

/**
 * Een blok audio renderen. Dit is wat de worklet per 128 frames aanroept.
 *
 * Bij rate 1 en een geheel startpunt komt het exacte sample eruit: de
 * interpolatie valt dan weg (frac = 0). Anders cubisch (Catmull-Rom): lineair
 * dempt de hoge tonen hoorbaar bij een paar procent pitch, en ambient is hoog.
 *
 * Drie dingen tegen tikken:
 *   loop-naad   in de laatste LOOP_NAAD van een loop (zie leesSegment)
 *   wissel      `vorig` + `wisselT`: de eerste SEGMENT_FADE na play, seek,
 *               hotcue of stop vloeit het oude segment over in het nieuwe
 *   gat         een pagina die er (nog) niet is: GAT_FADE vooruit kijken en
 *               lineair uitvloeien, na het gat weer in. `staat.env` bewaart
 *               de stand tussen blokken.
 *
 * In drie stappen, zonder afval (zie boven): per segment de posities
 * (positieOp) en de samples (leesSegment), daarna per frame gat en wissel.
 * `vooruit` rekent met seg.R als bovengrens van de snelheid. Tijdens een rem
 * (zie positieOp) gaat het langzamer dan R, dus kijkt hij dan iets verder
 * vooruit dan nodig: aan de veilige kant.
 *
 * Geef in een lus die elk blok draait `staat` mee en hergebruik het object
 * met de argumenten (zoals stream-lezer.js): een nieuw object per blok is
 * weer afval.
 *
 * `stride` (kanalen per frame in de pagina, 2/4/8) en `paar` (eerste kanaal
 * van het stereopaar, 0/2/4/6): met stems één aanroep per paar, elk met een
 * eigen `staat`. Zonder: stereo, zoals altijd.
 *
 * `hergebruik` (stems): dit is het volgende paar van HETZELFDE blok, direct
 * na het vorige, met dezelfde seg, vorig, wisselT, t0, frames, rates en
 * duur; alleen paar, uit en staat zijn anders. Dan staat in `klad` nog waar
 * elk frame leest, en hoeft dat niet opnieuw (posities, soort, naad). Alleen
 * de worklet zet dit, voor paar 1–3. Een andere aanroep ertussen (ander
 * deck) en dan hergebruik zetten is een fout van de aanroeper.
 *
 * @returns 'einde' als het trackeinde binnen dit blok viel, anders null.
 */
export function renderBlok({ seg, paginas, uit, frames, t0, ctxRate, trackRate, duur,
  vorig = null, wisselT = -Infinity, staat = { env: 1 }, stride = KANALEN, paar = 0, hergebruik = false }) {
  const L = uit[0], R = uit[1];
  // Hoeveel frames vallen in de overgang? Altijd het begin van het blok: t loopt op.
  let wissel = 0;
  if (vorig) while (wissel < frames && t0 + wissel / ctxRate < wisselT + SEGMENT_FADE) wissel++;
  if (!seg.speelt && wissel === 0) { L.fill(0, 0, frames); R.fill(0, 0, frames); return null; }

  groei(frames);
  klad.t0 = t0; klad.ctxRate = ctxRate; klad.trackRate = trackRate; klad.duur = duur;
  klad.stride = stride; klad.paar = paar;
  const nu = klad.nu, oud = klad.oud;
  if (seg.speelt) leesSegment(seg, paginas, nu, frames, hergebruik);
  if (wissel > 0 && vorig.speelt) leesSegment(vorig, paginas, oud, wissel, hergebruik);

  const vooruit = GAT_FADE * trackRate * Math.max(0.5, Math.abs(seg.R || 1));
  const stap = 1 / (GAT_FADE * ctxRate);
  klad.k0 = -1; klad.k1 = -1;             // heeftPagina: niets onthouden van een vorig blok
  let env = staat.env;
  // Stems: een volgend paar dat met dezelfde envelop begint als het eerste,
  // krijgt per frame dezelfde envelop (zelfde frames, zelfde pagina's): die
  // staat in klad.envs, de gat-controle hoeft niet nog eens. Begon het eerste
  // paar dit blok (geen hergebruik), dan vult het klad.envs.
  const envs = klad.envs;
  const leesEnv = hergebruik && env === klad.envVan;
  const schrijfEnv = !hergebruik;
  if (schrijfEnv) klad.envVan = env;
  let einde = null;
  for (let i = 0; i < frames; i++) {
    let l = 0, r = 0;
    if (seg.speelt) {
      if (nu.soort[i] === VOORBIJ) { einde = 'einde'; }
      else {
        if (leesEnv) env = envs[i];
        else {
          // Gat vooruit? Dan uitvloeien; data er weer? Dan invloeien.
          const n = Math.floor(nu.f[i]);
          const doel = heeftFrame(paginas, n) && heeftFrame(paginas, Math.floor(n + vooruit)) ? 1 : 0;
          env = doel > env ? Math.min(1, env + stap) : Math.max(doel, env - stap);
          if (schrijfEnv) envs[i] = env;
        }
        l = nu.l[i] * env; r = nu.r[i] * env;
      }
    }
    if (i < wissel) {
      const t = t0 + i / ctxRate;
      const w = Math.max(0, Math.min(1, (t - wisselT) / SEGMENT_FADE));
      const a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2);
      const o = vorig.speelt && oud.soort[i] !== VOORBIJ;
      l = (o ? oud.l[i] : 0) * a + l * b;
      r = (o ? oud.r[i] : 0) * a + r * b;
    }
    L[i] = l; R[i] = r;
  }
  if (leesEnv) env = klad.envNa;          // (ook als het laatste frame voorbij het einde viel)
  if (schrijfEnv) klad.envNa = env;
  staat.env = env;
  return einde;
}
