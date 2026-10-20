/**
 * De rekenkern van de afspeler. Geen Web Audio, geen DOM: puur rekenwerk, zodat
 * hij in Node te testen is. De worklet (speler-worklet.js) roept alleen dit aan.
 *
 * WAT HIJ DOET
 *   Een bron = pagina's van PAGINA frames, Int16 interleaved stereo. Een pagina
 *   die er niet is (undefined) is stilte, nooit een herhaling: straks streamen
 *   we, en dan zijn er gaten. Rond een gat vloeit hij uit en in (GAT_FADE).
 *   Een segment { T, P, R, speelt }: vanaf audiokloktijd T staat de plek op P
 *   (seconden in het nummer) en loopt hij R seconden nummer per seconde
 *   audioklok. Plek op t = P + (t − T)·R, frame = plek · sr van het nummer.
 *   Hoofdthread en worklet delen GEEN teller: ze rekenen allebei met deze
 *   formule op dezelfde audioklok (speler.js positie()).
 *
 * WISSELEN, SAMPLE-EXACT
 *   Een segment gaat in op de eerste sample i met (frame + i)/ctxSr ≥ T, ook
 *   midden in een blok: het blok wordt op die plek in stukken gerenderd. Ligt
 *   T in het verleden (het bericht kwam laat), dan geldt het meteen, op de
 *   lijn: de plek is P + (t − T)·R, niet P.
 *
 * STEMMEN EN OVERVLOEIEN
 *   Wat klinkt is een STEM: een eigen kopie van de lijn {T, P, R} met een
 *   versterking w (0..1). Een nieuw segment dat op de plek van de leidende
 *   stem aansluit (≤ SPRONG_FRAMES) neemt alleen zijn lijn over: geen
 *   overvloei, naadloos (tempowissel van de klok). Is het dezelfde lijn (zelfde
 *   R, plek binnen ZELFDE_LIJN), dan verandert er NIETS, bit voor bit: de engine
 *   stuurt dezelfde lijn geregeld opnieuw, in stukken. Een start of stop vloeit
 *   in OVERVLOEI in of uit; bij een sprong leest de oude stem door langs zijn
 *   oude lijn en zakt in OVERVLOEI_SPRONG naar 0 terwijl de nieuwe opkomt. Een
 *   overvloei die onderbroken wordt, gaat verder vanaf waar w is: zo geven ook
 *   drie sprongen kort na elkaar geen tik (tot STEMMEN tegelijk; daarna wordt
 *   de zachtste afgekapt).
 *
 *   EQUAL-GAIN, niet equal-power (gemeten 19 okt, meting/klik.mjs): een sprong
 *   over hele tellen landt op hetzelfde soort geluid (kick op kick), en dan geeft
 *   equal-power +3 dB midden in de overvloei: 1,41× de grootste gewone stap. Lineair
 *   is oud + nieuw precies 1 en de steilste helling 1/N in plaats van π/(2N). Op
 *   ongelijk materiaal is het een dip van −3 dB van een paar ms, die je niet hoort.
 *   De sprong duurt 10 ms en niet 4: op een bas van 80 Hz in tegenfase is de
 *   helling van de overvloei zelf anders zo groot als die van de toon (1,59× bij
 *   4 ms). Start en stop blijven 4 ms: daar staat er maar één stem.
 *
 * INTERPOLATIE: 4-punts Hermite van de derde orde (Catmull-Rom-raaklijnen),
 *   in de x-vorm van Niemitalo ("Polynomial interpolators for high-quality
 *   resampling", 2001). Gekozen omdat hij een rechte lijn exact geeft, de
 *   afgeleide continu is (geen knik op de samplegrens), op x = 0 precies de
 *   sample teruggeeft, en lineair de hoge tonen bij een paar procent tempo
 *   hoorbaar dempt. Geen toestand: herplannen reset niets.
 *
 * GEEN AFVAL OP DE AUDIOTHREAD (v1 CLAUDE.md "HET AUDIOPAD MAAKT GEEN AFVAL")
 *   Een GC draait op de audiothread zelf: een pauze daar is een tik. Daarom:
 *   - segmenten en stemmen in vaste typed arrays (structure of arrays), niet
 *     als objecten. Een veld erbij (straks loop, rem, keylock) = een array erbij
 *     in maakKern, met een vaste betekenis per index;
 *   - hulpfuncties op het hete pad krijgen alleen objecten en hele getallen en
 *     geven niets terug: een double over een functiegrens wordt in V8 een
 *     HeapNumber zodra hij niet inlinet;
 *   - de klok staat in een Float64Array (`k.klok[0] = currentFrame`), niet als
 *     argument: na ~6 uur is currentFrame geen klein geheel getal meer;
 *   - geen array-methodes met callbacks, geen closures, geen nieuwe arrays.
 *   test/speler-kern.test.mjs meet het (0 GC's over 20.000 blokken).
 *
 * Grenzen: een nummer is hooguit 2^30 frames (~6 uur op 48 kHz): framenummers
 * blijven kleine gehele getallen en `>> 16` klopt.
 */

export const PAGINA = 65536;            // frames per pagina, ~1,37 s op 48 kHz
const PAGINA_SHIFT = 16;
const PAGINA_MASK = PAGINA - 1;
export const OVERVLOEI = 0.004;         // start en stop: zo lang vloeit hij in of uit
export const OVERVLOEI_SPRONG = 0.010;  // sprong: zo lang vloeit oud in nieuw over (zie onder)
export const OVERVLOEI_WET = 'gelijk';  // 'gelijk' (equal-gain, lineair) of 'vermogen' (equal-power, sin)
export const GAT_FADE = 0.003;          // zo ver kijken we vooruit naar een gat, en zo lang duurt het uitvloeien
export const SPRONG_FRAMES = 2;         // verder dan dit van de klinkende plek = een sprong (met overvloei)
export const ZELFDE_LIJN = 1e-9;        // seconden: zo dicht en hetzelfde tempo = dezelfde lijn, niets doen
export const MAX_SEGMENTEN = 64;        // zoveel wachtende segmenten
export const STEMMEN = 4;               // zoveel lijnen kunnen tegelijk klinken (overvloeien)
/**
 * LOOP: een segment mag een lus [la, lb) hebben (seconden in het nummer). Wat erna zou komen
 * vouwt terug: plek = la + (p − la) mod (lb − la). Een einde en een begin liggen bijna nooit
 * op dezelfde hoogte (een tik), dus de laatste LOOP_NAAD vloeit lineair over naar wat vlak
 * vóór la staat (v1 LOOP_NAAD). Zo is het laatste sample vóór de naad dat van vlak vóór la, en
 * het eerste erna la zelf: naadloos. Ligt la dichter bij 0 dan LOOP_NAAD, dan staat er niets
 * vóór: geen naad (v1: anders vloeide hij naar stilte). 10 ms, niet de 5 van v1: bij een
 * verschil van 0,56 tussen einde en begin gaf 5 ms 1,41× een gewone stap (test/lus-kern), zoals
 * bij de sprong (OVERVLOEI_SPRONG).
 */
export const LOOP_NAAD = 0.010;
/**
 * STEMS (docs/STEMS.md in v1): een bron mag 4 of 8 kanalen hebben = 2 of 4 stereoparen (stems,
 * vooraf gesplitst door Demucs). Paar 0 gaat naar L/R, paar 1..3 naar `k.extra` (de andere
 * uitgangen van de worklet; daar zit per uitgang een gain voor niveau en kill). Zonder extra
 * (een toets, een sampler) worden de paren opgeteld: de som van de stems is het nummer. Een
 * stereobron gaat door het oude pad, bit voor bit.
 */
export const KANALEN = Object.freeze([2, 4, 8]);

const HALF_PI = Math.PI / 2;
const SCHAAL = 1 / 32768;

/**
 * Een kern voor één speler. Alles wat hij ooit nodig heeft wordt hier gemaakt;
 * renderBlok maakt niets meer aan.
 */
export function maakKern(ctxSr, { overvloei = OVERVLOEI, sprong = OVERVLOEI_SPRONG, wet = OVERVLOEI_WET } = {}) {
  return {
    ctxSr,                                   // samplerate van de AudioContext (vast)
    klok: new Float64Array(1),               // [0] = frame van de eerste sample van dit blok (currentFrame)
    dw: 1 / (overvloei * ctxSr),             // stap van w per sample (start, stop)
    dwSprong: 1 / (sprong * ctxSr),          // stap van w per sample (sprong)
    lin: wet === 'gelijk' ? 1 : 0,           // 1: versterking = w (equal-gain); 0: sin(w·π/2) (equal-power)
    de: 1 / (GAT_FADE * ctxSr),              // stap van de gat-envelop per sample
    // De wachtrij: gesorteerd op T, [0] is de volgende. Index = plek, geen objecten.
    sT: new Float64Array(MAX_SEGMENTEN),
    sP: new Float64Array(MAX_SEGMENTEN),
    sR: new Float64Array(MAX_SEGMENTEN),
    sSpeelt: new Uint8Array(MAX_SEGMENTEN),
    sLA: new Float64Array(MAX_SEGMENTEN),     // lus: begin (s), of 0/0 = geen lus
    sLB: new Float64Array(MAX_SEGMENTEN),
    sN: 0,
    ongeldig: 0,                             // segmenten die planSegmenten weigerde (de worklet meldt het)
    // Twee bronnen om de beurt: bij laad/leeg leest wat uitvloeit nog de oude.
    bronPag: [null, null],                   // array van Int16Array|undefined, of null
    bronSr: new Float64Array(2),
    bronFrames: new Float64Array(2),
    bronId: new Float64Array(2),             // het laadnummer van de speler (streamen: een pagina hoort bij één laad)
    bronK: new Uint8Array([2, 2]),           // kanalen van de bron: 2 (stereo), 4 of 8 (stems)
    extra: null,                             // [L1, R1, L2, R2, L3, R3]: de uitgangen voor paar 1..3, of null
    bron: 0,
    // De stemmen.
    vAan: new Uint8Array(STEMMEN),
    vBron: new Uint8Array(STEMMEN),
    vT: new Float64Array(STEMMEN),
    vP: new Float64Array(STEMMEN),
    vR: new Float64Array(STEMMEN),
    vW: new Float64Array(STEMMEN),           // versterking 0..1 (klinkt als sin(w·π/2))
    vRicht: new Int8Array(STEMMEN),          // +1 komt op, 0 staat, −1 zakt weg
    vDw: new Float64Array(STEMMEN),          // de stap van w van deze stem (start/stop of sprong)
    vLA: new Float64Array(STEMMEN),          // de lus van de stem (seconden; lb = 0: geen)
    vLB: new Float64Array(STEMMEN),
    vEnv: new Float64Array(STEMMEN),         // gat-envelop 0..1
    lead: -1,                                // de stem die het laatste segment speelt, of −1
    // Kladblok voor de vier buren van een sample (ruwe Int16-waarden).
    bl: new Int32Array(4),
    br: new Int32Array(4),
    bm: new Int32Array(32),                  // de vier buren van elk van de acht kanalen: [q * 8 + c]
    bn: new Int32Array(32),                  // idem voor de naad van een lus
  };
}

/** Alles terug naar leeg en stil (na een fout). Niet voor het hete pad. */
export function wisKern(k) {
  k.sN = 0;
  k.bronPag[0] = null; k.bronPag[1] = null;
  k.vAan.fill(0);
  k.lead = -1;
}

/** Alle stemmen van bron `b` meteen uit (hun pagina's worden vervangen). */
function kapBron(k, b) {
  for (let v = 0; v < STEMMEN; v++) if (k.vAan[v] === 1 && k.vBron[v] === b) k.vAan[v] = 0;
  if (k.lead >= 0 && k.vAan[k.lead] === 0) k.lead = -1;
}

/** Alles wat klinkt zakt weg; de wachtrij is leeg. */
function laatUitvloeien(k) {
  for (let v = 0; v < STEMMEN; v++) if (k.vAan[v] === 1) { k.vRicht[v] = -1; k.vDw[v] = k.dw; }
  k.lead = -1;
  k.sN = 0;
}

/**
 * Een nieuwe bron. Wat klinkt vloeit uit (van de oude pagina's), de wachtrij
 * is leeg: wat gepland was hoorde bij het vorige nummer. Daarna plan().
 * `paginas`: array van Int16Array (PAGINA frames, interleaved stereo) of
 * undefined/null voor een pagina die (nog) ontbreekt.
 */
export function laadBron(k, sr, frames, paginas, id = 0, kanalen = 2) {
  if (KANALEN.indexOf(kanalen) < 0) throw new RangeError(`laadBron: ${kanalen} kanalen (2, 4 of 8)`);
  const nieuw = k.bron ^ 1;
  kapBron(k, nieuw);                      // laad twee keer binnen 4 ms: die stemmen houden op
  laatUitvloeien(k);
  const n = Math.ceil(frames / PAGINA);
  const pag = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = paginas ? paginas[i] : undefined;
    pag[i] = p instanceof Int16Array ? p : undefined;   // één soort array: monomorf lezen
  }
  k.bronPag[nieuw] = pag;
  k.bronSr[nieuw] = sr;
  k.bronFrames[nieuw] = frames;
  k.bronId[nieuw] = id;
  k.bronK[nieuw] = kanalen;
  k.bron = nieuw;
}

/**
 * Streamen (stroom.js): een pagina erbij of weg, voor de bron met laadnummer `id`. Is die bron er
 * niet meer (een late pagina van een vorig nummer), dan gebeurt er niets. Niet op het hete pad:
 * alleen vanuit een bericht.
 */
export function zetPagina(k, id, i, data) {
  for (let b = 0; b < 2; b++) {
    const pag = k.bronPag[b];
    if (pag === null || k.bronId[b] !== id || !(i >= 0 && i < pag.length)) continue;
    const kc = k.bronK[b];
    if (!(data instanceof Int16Array) || data.length > PAGINA * kc || data.length % kc !== 0) return false;
    pag[i] = data;
    return true;
  }
  return false;
}

export function wisPagina(k, id, i) {
  for (let b = 0; b < 2; b++) {
    const pag = k.bronPag[b];
    if (pag !== null && k.bronId[b] === id && i >= 0 && i < pag.length) pag[i] = undefined;
  }
}

/** Geen bron meer: wat klinkt vloeit uit, daarna mogen de pagina's weg. */
export function leegBron(k) {
  const nieuw = k.bron ^ 1;
  kapBron(k, nieuw);
  laatUitvloeien(k);
  k.bronPag[nieuw] = null;
  k.bronSr[nieuw] = 0;
  k.bronFrames[nieuw] = 0;
  k.bronK[nieuw] = 2;
  k.bron = nieuw;
}

/**
 * Segmenten plannen: alles wat wacht vanaf segmenten[0].T wordt vervangen.
 * Verwacht op T oplopende segmenten met eindige getallen (speler.js toetst);
 * wat daar niet aan voldoet of niet meer past, wordt overgeslagen.
 * Wat al ingegaan is, klinkt door tot het nieuwe ingaat (de stem heeft een
 * eigen kopie van zijn lijn).
 * @returns het aantal segmenten dat in de wachtrij kwam
 */
export function planSegmenten(k, segmenten) {
  if (!segmenten || segmenten.length === 0) return 0;
  const T0 = +segmenten[0].T;
  if (!Number.isFinite(T0)) { k.ongeldig += segmenten.length; return 0; }
  let n = k.sN;
  while (n > 0 && k.sT[n - 1] >= T0) n--;
  let erbij = 0, vorigeT = -Infinity;
  for (let i = 0; i < segmenten.length && n < MAX_SEGMENTEN; i++) {
    const s = segmenten[i];
    const T = +s.T, P = +s.P, speelt = !!s.speelt;
    const R = speelt ? +s.R : 1;
    if (!Number.isFinite(T) || !Number.isFinite(P) || !Number.isFinite(R) || T < vorigeT || (speelt && !(R > 0))) { k.ongeldig++; continue; }
    let la = 0, lb = 0;
    if (s.lb !== undefined && s.lb !== null) {
      la = +s.la; lb = +s.lb;
      if (!(la >= 0) || !(lb > la) || !Number.isFinite(lb)) { k.ongeldig++; continue; }
    }
    k.sT[n] = T; k.sP[n] = P; k.sR[n] = R; k.sSpeelt[n] = speelt ? 1 : 0;
    k.sLA[n] = la; k.sLB[n] = lb;
    vorigeT = T; n++; erbij++;
  }
  k.sN = n;
  return erbij;
}

/**
 * De vier buren n−1..n+2 frame voor frame (paginagrens, gat, rand van het
 * nummer) als RUWE Int16-waarden naar k.bl/k.br; ontbreekt een pagina: 0.
 * Alleen hele getallen: dit pad draait een paar keer per paginagrens, te
 * weinig om geoptimaliseerd te worden, en ongeoptimaliseerd maakt V8 van elke
 * double een object (gemeten: ~350 bytes per venster met doubles hier).
 */
function buren(k, pag, n) {
  const np = pag === null ? 0 : pag.length;
  const bl = k.bl, br = k.br;
  for (let q = 0; q < 4; q++) {
    const m = n - 1 + q;
    bl[q] = 0; br[q] = 0;
    if (m < 0) continue;
    const pk = m >> PAGINA_SHIFT;
    if (pk >= np) continue;
    const p = pag[pk];
    if (p === undefined) continue;
    const j = (m & PAGINA_MASK) * 2;
    if (j + 1 < p.length) { bl[q] = p[j]; br[q] = p[j + 1]; }
  }
}

/**
 * Stem v voor de samples van..tot−1, OPGETELD bij L en R. Leest zijn eigen
 * lijn, zijn eigen bron; zakt hij tot 0, dan is hij vrij.
 */
function stemBlok(k, v, L, R, van, tot) {
  const b = k.vBron[v];
  if (k.bronK[b] !== 2) { stemBlokMeer(k, v, L, R, van, tot); return; }
  const pag = k.bronPag[b];
  const np = pag === null ? 0 : pag.length;
  const sr = k.bronSr[b], frames = k.bronFrames[b];
  const f0 = k.klok[0], csr = k.ctxSr;
  const T = k.vT[v], P = k.vP[v], Rr = k.vR[v];
  const la = k.vLA[v], lb = k.vLB[v], lus = lb > 0, lL = lb - la;
  const naad = lus && la >= LOOP_NAAD ? LOOP_NAAD : 0;          // geen naad als er niets vóór la staat
  const laF = Math.floor(la * sr), lbF = Math.floor(lb * sr), lF = lbF - laF;
  const dw = k.vDw[v], de = k.de;
  const bl = k.bl, br = k.br;
  let w = k.vW[v], richt = k.vRicht[v], env = k.vEnv[v];
  const lin = k.lin === 1;
  // Zo ver vooruit (frames) zien we een gat aankomen; minstens het halve tempo.
  const vooruit = Math.ceil(GAT_FADE * sr * (Rr > 0.5 ? Rr : 0.5)) + 2;
  let klaar = false;
  for (let i = van; i < tot && !klaar; i++) {
    // Versterking van DEZE sample, dan pas een stap verder: de eerste sample
    // van een nieuwe stem is 0, de laatste van een wegzakkende de kleinste > 0.
    const g = w >= 1 ? 1 : lin ? w : Math.sin(w * HALF_PI);
    if (richt !== 0) {
      w += richt * dw;
      if (w >= 1) { w = 1; richt = 0; }
      else if (w <= 0) { w = 0; klaar = true; }                  // weggezakt: na deze sample stil
    }
    let pos = P + ((f0 + i) / csr - T) * Rr;
    if (lus && pos >= lb) pos = la + ((pos - la) % lL);
    const f = pos * sr;
    if (!(f >= 0) || f >= frames) continue;                     // buiten het nummer: stilte (geen gat)
    const n = Math.floor(f);
    const x = f - n;
    // Gat in de buurt (n−1, n+2) of vooruit? Dan uitvloeien, anders invloeien.
    let ok = true;
    let m = n - 1;
    if (m >= 0) { const q = m >> PAGINA_SHIFT; ok = q < np && pag[q] !== undefined; }
    m = n + 2;
    if (ok && m < frames) { const q = m >> PAGINA_SHIFT; ok = q < np && pag[q] !== undefined; }
    m = n + vooruit;
    if (lus && m >= lbF && lF > 0) m = laF + ((m - laF) % lF);   // vooruit in een lus = na het terugvouwen
    if (ok && m < frames) { const q = m >> PAGINA_SHIFT; ok = q < np && pag[q] !== undefined; }
    if (ok) { if (env < 1) { env += de; if (env > 1) env = 1; } }
    else if (env > 0) { env -= de; if (env < 0) env = 0; }
    if (env === 0) continue;
    // De vier buren (ruwe Int16): bijna altijd op één pagina, dan rechtstreeks.
    const k0 = (n - 1) >> PAGINA_SHIFT;
    const p = n >= 1 && k0 === ((n + 2) >> PAGINA_SHIFT) && k0 < np ? pag[k0] : undefined;
    const j = ((n - 1) & PAGINA_MASK) * 2;
    let l0, l1, l2, l3, r0, r1, r2, r3;
    if (p !== undefined && j + 7 < p.length) {
      l0 = p[j]; r0 = p[j + 1]; l1 = p[j + 2]; r1 = p[j + 3];
      l2 = p[j + 4]; r2 = p[j + 5]; l3 = p[j + 6]; r3 = p[j + 7];
    } else {
      buren(k, pag, n);
      l0 = bl[0]; l1 = bl[1]; l2 = bl[2]; l3 = bl[3];
      r0 = br[0]; r1 = br[1]; r2 = br[2]; r3 = br[3];
    }
    // Hermite is lineair in y: eerst op de ruwe waarden, dan één keer schalen.
    const a = g * env * SCHAAL;
    let yl = l1 + 0.5 * x * (l2 - l0 + x * (2 * l0 - 5 * l1 + 4 * l2 - l3 + x * (3 * (l1 - l2) + l3 - l0)));
    let yr = r1 + 0.5 * x * (r2 - r0 + x * (2 * r0 - 5 * r1 + 4 * r2 - r3 + x * (3 * (r1 - r2) + r3 - r0)));
    // De naad van een lus: de laatste LOOP_NAAD lineair naar wat een lus terug staat (vlak vóór la).
    if (naad > 0 && pos > lb - naad) {
      const wn = (pos - (lb - naad)) / naad;
      const f2 = (pos - lL) * sr;
      const n2 = Math.floor(f2), x2 = f2 - n2;
      buren(k, pag, n2);
      const m0 = bl[0], m1 = bl[1], m2 = bl[2], m3 = bl[3], q0 = br[0], q1 = br[1], q2 = br[2], q3 = br[3];
      const zl = m1 + 0.5 * x2 * (m2 - m0 + x2 * (2 * m0 - 5 * m1 + 4 * m2 - m3 + x2 * (3 * (m1 - m2) + m3 - m0)));
      const zr = q1 + 0.5 * x2 * (q2 - q0 + x2 * (2 * q0 - 5 * q1 + 4 * q2 - q3 + x2 * (3 * (q1 - q2) + q3 - q0)));
      yl += wn * (zl - yl); yr += wn * (zr - yr);
    }
    L[i] += a * yl;
    R[i] += a * yr;
  }
  k.vW[v] = w; k.vRicht[v] = richt; k.vEnv[v] = env;
  if (klaar) k.vAan[v] = 0;
}

/**
 * De buren n−1..n+2 van alle `kc` kanalen naar `uit` ([q * 8 + c]), ruw; ontbreekt een pagina: 0.
 * Hele getallen in en uit (zie buren).
 */
function burenMeer(pag, n, kc, uit) {
  const np = pag === null ? 0 : pag.length;
  for (let q = 0; q < 4; q++) {
    const m = n - 1 + q;
    const o = q * 8;
    for (let c = 0; c < kc; c++) uit[o + c] = 0;
    if (m < 0) continue;
    const pk = m >> PAGINA_SHIFT;
    if (pk >= np) continue;
    const p = pag[pk];
    if (p === undefined) continue;
    const j = (m & PAGINA_MASK) * kc;
    if (j + kc - 1 < p.length) for (let c = 0; c < kc; c++) uit[o + c] = p[j + c];
  }
}

/**
 * Een stem van een bron met stems (4 of 8 kanalen): dezelfde lijn, lus, naad, gaten en
 * overvloei als stemBlok, per sample voor elk paar. Paar 0 naar L/R, de andere naar k.extra
 * (of, zonder extra, ook naar L/R: de som). Een eigen functie, zodat het stereopad niet
 * verandert (de gouden hash, meting/golden.mjs).
 */
function stemBlokMeer(k, v, L, R, van, tot) {
  const b = k.vBron[v];
  const pag = k.bronPag[b];
  const np = pag === null ? 0 : pag.length;
  const kc = k.bronK[b];
  const sr = k.bronSr[b], frames = k.bronFrames[b];
  const f0 = k.klok[0], csr = k.ctxSr;
  const T = k.vT[v], P = k.vP[v], Rr = k.vR[v];
  const la = k.vLA[v], lb = k.vLB[v], lus = lb > 0, lL = lb - la;
  const naad = lus && la >= LOOP_NAAD ? LOOP_NAAD : 0;
  const laF = Math.floor(la * sr), lbF = Math.floor(lb * sr), lF = lbF - laF;
  const dw = k.vDw[v], de = k.de;
  const bm = k.bm, bn = k.bn;
  const ex = k.extra;
  let w = k.vW[v], richt = k.vRicht[v], env = k.vEnv[v];
  const lin = k.lin === 1;
  const vooruit = Math.ceil(GAT_FADE * sr * (Rr > 0.5 ? Rr : 0.5)) + 2;
  let klaar = false;
  for (let i = van; i < tot && !klaar; i++) {
    const g = w >= 1 ? 1 : lin ? w : Math.sin(w * HALF_PI);
    if (richt !== 0) {
      w += richt * dw;
      if (w >= 1) { w = 1; richt = 0; }
      else if (w <= 0) { w = 0; klaar = true; }
    }
    let pos = P + ((f0 + i) / csr - T) * Rr;
    if (lus && pos >= lb) pos = la + ((pos - la) % lL);
    const f = pos * sr;
    if (!(f >= 0) || f >= frames) continue;
    const n = Math.floor(f);
    const x = f - n;
    let ok = true;
    let m = n - 1;
    if (m >= 0) { const q = m >> PAGINA_SHIFT; ok = q < np && pag[q] !== undefined; }
    m = n + 2;
    if (ok && m < frames) { const q = m >> PAGINA_SHIFT; ok = q < np && pag[q] !== undefined; }
    m = n + vooruit;
    if (lus && m >= lbF && lF > 0) m = laF + ((m - laF) % lF);
    if (ok && m < frames) { const q = m >> PAGINA_SHIFT; ok = q < np && pag[q] !== undefined; }
    if (ok) { if (env < 1) { env += de; if (env > 1) env = 1; } }
    else if (env > 0) { env -= de; if (env < 0) env = 0; }
    if (env === 0) continue;
    burenMeer(pag, n, kc, bm);
    let wn = 0;
    if (naad > 0 && pos > lb - naad) {
      wn = (pos - (lb - naad)) / naad;
      burenMeer(pag, Math.floor((pos - lL) * sr), kc, bn);
    }
    const x2 = wn > 0 ? (pos - lL) * sr - Math.floor((pos - lL) * sr) : 0;
    const a = g * env * SCHAAL;
    for (let c = 0; c < kc; c++) {
      const y0 = bm[c], y1 = bm[8 + c], y2 = bm[16 + c], y3 = bm[24 + c];
      let y = y1 + 0.5 * x * (y2 - y0 + x * (2 * y0 - 5 * y1 + 4 * y2 - y3 + x * (3 * (y1 - y2) + y3 - y0)));
      if (wn > 0) {
        const z0 = bn[c], z1 = bn[8 + c], z2 = bn[16 + c], z3 = bn[24 + c];
        const z = z1 + 0.5 * x2 * (z2 - z0 + x2 * (2 * z0 - 5 * z1 + 4 * z2 - z3 + x2 * (3 * (z1 - z2) + z3 - z0)));
        y += wn * (z - y);
      }
      const paar = c >> 1;
      if (paar === 0 || ex === null) {
        if ((c & 1) === 0) L[i] += a * y; else R[i] += a * y;
      } else ex[2 * (paar - 1) + (c & 1)][i] += a * y;
    }
  }
  k.vW[v] = w; k.vRicht[v] = richt; k.vEnv[v] = env;
  if (klaar) k.vAan[v] = 0;
}

/**
 * Eén blok van `frames` samples naar L en R (Float32Array's). De klok van het
 * blok staat in k.klok[0] (currentFrame). Segmenten gaan in op hun sample;
 * daartussen speelt elke stem zijn stuk.
 *
 * Het WISSELEN staat hier zelf in, niet in een hulpfunctie: het gebeurt een
 * paar keer per seconde, te weinig om een eigen functie ooit geoptimaliseerd
 * te krijgen, en ongeoptimaliseerd maakt V8 van elke double een object
 * (gemeten: ~330 bytes per wissel). In renderBlok, die elk blok draait, wordt
 * het mee geoptimaliseerd.
 */
export function renderBlok(k, L, R, frames) {
  L.fill(0, 0, frames);
  R.fill(0, 0, frames);
  const ex = k.extra;
  if (ex !== null) for (let c = 0; c < ex.length; c++) ex[c].fill(0, 0, frames);
  const f0 = k.klok[0], csr = k.ctxSr;
  let i = 0;
  while (i < frames) {
    let s = frames;
    if (k.sN > 0) {
      const T = k.sT[0];
      s = i;
      while (s < frames && (f0 + s) / csr < T) s++;             // dezelfde t als in stemBlok
    }
    if (s > i) {
      for (let v = 0; v < STEMMEN; v++) if (k.vAan[v] === 1) stemBlok(k, v, L, R, i, s);
      i = s;
    }
    if (i >= frames || k.sN === 0) continue;
    // ---- het eerste wachtende segment gaat in op sample i -------------------
    // (!(t < T): ook een T in het verleden; dan rekent het vanaf T door.)
    const t = (f0 + i) / csr;
    // Gaan er meer tegelijk in (laat bericht, T's in het verleden), dan geldt
    // alleen de laatste: op t staat de plek op de lijn van het laatste segment
    // met T ≤ t. De eerdere eerst toepassen gaf een sprong heen en terug.
    let eerst = 0;
    while (eerst + 1 < k.sN && !(t < k.sT[eerst + 1])) eerst++;
    const T = k.sT[eerst], P = k.sP[eerst], Rs = k.sR[eerst], speelt = k.sSpeelt[eerst] === 1;
    const sla = k.sLA[eerst], slb = k.sLB[eerst];
    const n = k.sN, weg = eerst + 1;
    if (n > weg) {
      k.sT.copyWithin(0, weg, n); k.sP.copyWithin(0, weg, n);
      k.sR.copyWithin(0, weg, n); k.sSpeelt.copyWithin(0, weg, n);
      k.sLA.copyWithin(0, weg, n); k.sLB.copyWithin(0, weg, n);
    }
    k.sN = n - weg;
    const b = k.bron;
    const lead = k.lead;
    if (lead >= 0 && speelt && k.vBron[lead] === b) {
      // Beide plekken teruggevouwen in hun eigen lus: een lus aan- of uitzetten waar je nu
      // bent is geen sprong, en een lijn die in de lus doorloopt ook niet.
      let oud = k.vP[lead] + (t - k.vT[lead]) * k.vR[lead];
      const ola = k.vLA[lead], olb = k.vLB[lead];
      if (olb > 0 && oud >= olb) oud = ola + ((oud - ola) % (olb - ola));
      let nieuw = P + (t - T) * Rs;
      if (slb > 0 && nieuw >= slb) nieuw = sla + ((nieuw - sla) % (slb - sla));
      const d = nieuw > oud ? nieuw - oud : oud - nieuw;
      const zelfdeLus = ola === sla && olb === slb;
      if (Rs === k.vR[lead] && zelfdeLus && d <= ZELFDE_LIJN) continue;   // dezelfde lijn: bit voor bit niets
      if (d <= SPRONG_FRAMES / k.bronSr[b]) {                     // sluit aan: naadloos
        k.vT[lead] = T; k.vP[lead] = P; k.vR[lead] = Rs; k.vLA[lead] = sla; k.vLB[lead] = slb;
        continue;
      }
    }
    // Sprong of stop: oud zakt weg. Bij een sprong in OVERVLOEI_SPRONG, oud en nieuw samen.
    const sprong = lead >= 0 && speelt;
    if (lead >= 0) { k.vRicht[lead] = -1; k.vDw[lead] = sprong ? k.dwSprong : k.dw; k.lead = -1; }
    if (!speelt) continue;
    // Een vrije stem, of anders de zachtste (die wordt afgekapt).
    let v = -1, zachtst = 2;
    for (let u = 0; u < STEMMEN; u++) {
      if (k.vAan[u] === 0) { v = u; break; }
      if (k.vW[u] < zachtst) { zachtst = k.vW[u]; v = u; }
    }
    k.vAan[v] = 1; k.vBron[v] = b;
    k.vT[v] = T; k.vP[v] = P; k.vR[v] = Rs; k.vLA[v] = sla; k.vLB[v] = slb;
    k.vW[v] = 0; k.vRicht[v] = 1; k.vEnv[v] = 1; k.vDw[v] = sprong ? k.dwSprong : k.dw;
    k.lead = v;
  }
  // Een oude bron waar niemand meer uit leest: los, zodat het geheugen weg mag.
  const oud = k.bron ^ 1;
  if (k.bronPag[oud] !== null) {
    let bezet = false;
    for (let v = 0; v < STEMMEN; v++) if (k.vAan[v] === 1 && k.vBron[v] === oud) bezet = true;
    if (!bezet) k.bronPag[oud] = null;
  }
}
