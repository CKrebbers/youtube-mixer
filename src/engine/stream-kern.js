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
 *   { T, P, R, loop, speelt }
 *   "vanaf audiokloktijd T staat de positie op P en loopt hij met snelheid R"
 *
 * Elke wijziging (play, seek, pitch, loop) is een nieuw segment. Komt het
 * bericht een paar milliseconden te laat bij de worklet aan, dan rekent hij
 * de formule gewoon vanaf T door en zit hij meteen op de goede plek.
 *
 * Een nieuw soort beweging (een rem: de snelheid loopt terug naar 0) is een
 * extra veld op het segment en een extra term in positieOp, en nergens
 * anders: renderBlok vraagt elke positie aan positieOp (zie posities()).
 * Wat er dan nog meer mee moet staat bij positieOp.
 */

export const PAGINA = 65536;           // frames per pagina, ~1,37 s op 48 kHz
export const KANALEN = 2;
export const BYTES_PER_FRAME = 4;      // 16 bit stereo
export const PAGINA_BYTES = PAGINA * BYTES_PER_FRAME;

export const STIL = Object.freeze({ T: 0, P: 0, R: 1, loop: null, speelt: false });

/**
 * Positie in tracktijd (seconden) op audiokloktijd t.
 *
 * Een versnelling (rem) komt in de regel met `p = ...`: P + (t - T) * R
 * wordt dan P + afgelegde weg met een snelheid die vanaf R terugloopt (en na
 * stilstand niet verder), vóór het vouwen in de loop. Dezelfde functie draait
 * op de hoofdthread (bron.js) en per frame in de worklet, dus beide zien de
 * rem meteen. Wat er dan nog meer mee moet: ctxTijdVan (het omgekeerde, nu
 * lineair), `vooruit` in renderBlok (rekent met |R| als bovengrens: klopt
 * zolang het alleen afremt), en test/renderblok.test.mjs (een segment zonder
 * rem moet bit voor bit dezelfde hash geven; houd de functie klein en zonder
 * objecten, anders is het audiopad niet meer afvalvrij).
 */
export function positieOp(seg, t) {
  if (!seg.speelt) return seg.P;
  let p = seg.P + (t - seg.T) * seg.R;
  const loop = seg.loop;
  if (loop) {
    const len = loop.end - loop.start;
    if (len > 0 && p >= loop.end) p = loop.start + ((p - loop.start) % len);
  }
  return p;
}

/**
 * Wanneer passeert dit segment tracktijd x (voor het eerst na `nu`), op de
 * audioklok? Binnen een loop die al is rondgegaan telt de gevouwen positie:
 * rekenen vanaf P gaf dan een tijd in het verleden, en gate en sampler
 * vielen naast de tel.
 */
export function ctxTijdVan(seg, x, nu = seg.T) {
  if (!seg.speelt) return null;
  const pos = positieOp(seg, nu);
  let t = nu + (x - pos) / seg.R;
  const loop = seg.loop;
  if (loop && x < pos && x >= loop.start && loop.end > loop.start) t += (loop.end - loop.start) / seg.R;
  return t;
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

/** Alleen wat de worklet kan lezen. Liever nu een duidelijke fout dan straks ruis. */
export function controleerWav(kop) {
  if (kop.formaat !== 1 && kop.formaat !== 0xfffe) return `WAV-formaat ${kop.formaat} wordt niet ondersteund (alleen PCM)`;
  if (kop.bits !== 16) return `${kop.bits}-bit WAV wordt niet ondersteund (alleen 16-bit)`;
  if (kop.kanalen !== 2) return `${kop.kanalen} kanalen wordt niet ondersteund (alleen stereo)`;
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
};

/** Eén keer (de worklet: 128 frames), of als een blok groter is dan ooit. */
function groei(frames) {
  if (frames <= klad.n) return;
  klad.n = frames;
  klad.nu = segKlad(frames);
  klad.oud = segKlad(frames);
}

/**
 * Frame n (beide kanalen) naar L[i] en R[i], of 0 als die pagina er (nog)
 * niet is. Stilte is het eerlijke antwoord op een gat; de vorige pagina
 * herhalen klinkt als een haperende cd.
 */
function leesFrame(paginas, n, L, R, i) {
  L[i] = 0; R[i] = 0;
  if (n < 0) return;
  const p = paginas.get(Math.floor(n / PAGINA));
  if (!p) return;
  const j = (n % PAGINA) * KANALEN;
  if (j < p.length) L[i] = p[j] * (1 / 32768);
  if (j + 1 < p.length) R[i] = p[j + 1] * (1 / 32768);
}

/**
 * Lezen op fractionele frameposities F[i], voor elke i < tot met
 * soort[i] >= vanaf: exact op een heel frame, anders cubisch (Catmull-Rom).
 */
function leesKubisch(paginas, F, L, R, soort, vanaf, tot) {
  const yl = klad.yl, yr = klad.yr;
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
    const j = ((n - 1) % PAGINA) * KANALEN;
    if (p && j + 7 < p.length) {
      yl[0] = p[j] * (1 / 32768); yr[0] = p[j + 1] * (1 / 32768);
      yl[1] = p[j + 2] * (1 / 32768); yr[1] = p[j + 3] * (1 / 32768);
      yl[2] = p[j + 4] * (1 / 32768); yr[2] = p[j + 5] * (1 / 32768);
      yl[3] = p[j + 6] * (1 / 32768); yr[3] = p[j + 7] * (1 / 32768);
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
 */
function leesSegment(seg, paginas, S, tot) {
  posities(seg, S.pos, tot);
  const loop = seg.loop;
  // De naad: hooguit een kwart van de loop, en nooit langer dan er vóór het
  // loopbegin staat. Een loop die op 0 s begint heeft daar niets, en de naad
  // vloeide dan naar stilte (een dip vlak voor elke herhaling). Liever dan
  // geen naad.
  const naad = loop ? Math.max(0, Math.min(LOOP_NAAD, (loop.end - loop.start) / 4, loop.start)) : 0;
  const trackRate = klad.trackRate, duur = klad.duur;
  const pos = S.pos, soort = S.soort;
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
  leesKubisch(paginas, S.f, S.l, S.r, soort, GEWOON, tot);
  if (!metNaad) return;
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
 * `vooruit` rekent met seg.R als bovengrens van de snelheid; komt er een
 * versnelling bij (rem, zie positieOp), dan blijft |R| de bovengrens zolang
 * het deck alleen afremt.
 *
 * Geef in een lus die elk blok draait `staat` mee en hergebruik het object
 * met de argumenten (zoals stream-lezer.js): een nieuw object per blok is
 * weer afval.
 *
 * @returns 'einde' als het trackeinde binnen dit blok viel, anders null.
 */
export function renderBlok({ seg, paginas, uit, frames, t0, ctxRate, trackRate, duur,
  vorig = null, wisselT = -Infinity, staat = { env: 1 } }) {
  const L = uit[0], R = uit[1];
  // Hoeveel frames vallen in de overgang? Altijd het begin van het blok: t loopt op.
  let wissel = 0;
  if (vorig) while (wissel < frames && t0 + wissel / ctxRate < wisselT + SEGMENT_FADE) wissel++;
  if (!seg.speelt && wissel === 0) { L.fill(0, 0, frames); R.fill(0, 0, frames); return null; }

  groei(frames);
  klad.t0 = t0; klad.ctxRate = ctxRate; klad.trackRate = trackRate; klad.duur = duur;
  const nu = klad.nu, oud = klad.oud;
  if (seg.speelt) leesSegment(seg, paginas, nu, frames);
  if (wissel > 0 && vorig.speelt) leesSegment(vorig, paginas, oud, wissel);

  const vooruit = GAT_FADE * trackRate * Math.max(0.5, Math.abs(seg.R || 1));
  const stap = 1 / (GAT_FADE * ctxRate);
  klad.k0 = -1; klad.k1 = -1;             // heeftPagina: niets onthouden van een vorig blok
  let env = staat.env;
  let einde = null;
  for (let i = 0; i < frames; i++) {
    let l = 0, r = 0;
    if (seg.speelt) {
      if (nu.soort[i] === VOORBIJ) { einde = 'einde'; }
      else {
        // Gat vooruit? Dan uitvloeien; data er weer? Dan invloeien.
        const n = Math.floor(nu.f[i]);
        const doel = heeftFrame(paginas, n) && heeftFrame(paginas, Math.floor(n + vooruit)) ? 1 : 0;
        env = doel > env ? Math.min(1, env + stap) : Math.max(doel, env - stap);
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
  staat.env = env;
  return einde;
}
