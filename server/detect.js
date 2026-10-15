/**
 * Beat- en toonsoortdetectie. Geen dependencies: de FFT staat hieronder.
 *
 * De opzet gaat uit van de aanname die ROADMAP.md al maakt — automatiek faalt
 * op dit repertoire. Daarom levert alles hier niet alleen een antwoord maar ook
 * een ZEKERHEID, en wordt een track in segmenten geknipt in plaats van tot één
 * bpm platgeslagen. Een album van een halfuur heeft geen tempo; het heeft er
 * zeven.
 *
 * Wat je overhoudt is een voorstel. De tap en de grid-editor blijven de baas.
 */

/** Iteratieve radix-2 FFT, in-place. n moet een macht van twee zijn. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const hoek = -2 * Math.PI / len;
    const wr = Math.cos(hoek), wi = Math.sin(hoek);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2], bi = im[i + k + len / 2];
        const tr = br * cr - bi * ci, ti = br * ci + bi * cr;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const hann = (n) => {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
};

const vertragingCache = new Map();

/**
 * IJkmateriaal: klanken waarvan we weten waar de tel valt.
 *
 * Eén tik van 900 Hz zonder ruis (de oude ijking) is de makkelijkste klank
 * die er bestaat. Echte muziek heeft zachtere aanzetten en een ruisvloer, en
 * beide schuiven de piek van de envelope naar achter: gemeten 5 tot 33 ms te
 * laat. Daarom ijken we op een reeks: tik, kick, ruisslag, hihat en een
 * akkoord, elk met een aanzet van 0, 15 en 30 ms, op twee ruisvloeren.
 * Deterministisch (vaste zaden), zodat de ijking bij elke start gelijk is.
 */
export function ijkKlanken(sampleRate, { duur = 6, bpm = 124, T0 = 0.3 } = {}) {
  const uit = [];
  for (const klank of ['tik', 'kick', 'ruis', 'hihat', 'akkoord']) {
    for (const aanzetMs of [0, 15, 30]) {
      for (const vloer of [0.005, 0.05]) {
        uit.push({ klank, aanzetMs, vloer, bpm, T0, x: ijkSpoor(sampleRate, klank, aanzetMs, vloer, { duur, bpm, T0 }) });
      }
    }
  }
  return uit;
}

export function ijkSpoor(sr, klank, aanzetMs, vloer, { duur = 6, bpm = 124, T0 = 0.3, seed = 3 } = {}) {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2147483648 - 1);
  const x = new Float32Array(Math.round(sr * duur));
  for (let i = 0; i < x.length; i++) x[i] = vloer * rnd();
  const p = 60 / bpm, a = (aanzetMs / 1000) * sr, lang = Math.round(sr * 0.4);
  for (let t = T0; t < duur - 0.5; t += p) {
    const s0 = Math.round(t * sr);
    for (let i = 0; i < lang && s0 + i < x.length; i++) {
      const omh = (a > 0 ? Math.min(1, i / a) : 1) * Math.exp(-i / (sr * 0.12));
      let v;
      if (klank === 'kick') v = Math.sin(2 * Math.PI * (55 * i / sr + 1.8 * (1 - Math.exp(-i / (sr * 0.03)))));
      else if (klank === 'ruis') v = rnd();
      else if (klank === 'hihat') v = 3 * rnd() * Math.exp(-i / (sr * 0.02));
      else if (klank === 'akkoord') v = Math.sin(2 * Math.PI * 220 * i / sr) + 0.5 * Math.sin(2 * Math.PI * 330 * i / sr) + 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
      else v = Math.sin(2 * Math.PI * 900 * i / sr);
      x[s0 + i] += 0.5 * omh * v;
    }
  }
  return x;
}

/** Gemiddeld telprofiel: envelope rond elke tel, per stapje van `stap` s. */
function telProfiel(env, frameVan, periodeF, vanS, totS, envRate, stap = 0.001) {
  const lees = (t) => {
    if (t < 0 || t >= env.length - 1) return 0;
    const i = Math.floor(t), f = t - i;
    return env[i] * (1 - f) + env[i + 1] * f;
  };
  const k0 = Math.ceil((1 - vanS * envRate - frameVan) / periodeF);
  const k1 = Math.floor((env.length - 2 - totS * envRate - frameVan) / periodeF);
  const prof = [];
  for (let t = vanS; t <= totS + 1e-9; t += stap) {
    let som = 0, n = 0;
    for (let k = k0; k <= k1; k++) { som += lees(frameVan + k * periodeF + t * envRate); n++; }
    prof.push(n ? som / n : 0);
  }
  return prof;
}

/**
 * Hoeveel loopt de onset-envelope vóór op de werkelijkheid?
 *
 * Een aanslag laat de flux al stijgen zodra hij het venster BINNENKOMT, niet
 * pas als hij in het midden staat. Dat is een voorsprong die van de venster-
 * en hopgrootte afhangt — en, zo bleek, van de klank. We meten hem op de
 * ijkreeks (ijkKlanken) en nemen het MIDDEN van wat we zien (tussen vroegste
 * en laatste), zodat de fout over die hele reeks zo klein mogelijk blijft.
 * Gemeten, niet gegokt: de correctie klopt ook als iemand aan win of hop draait.
 */
/*
 * De uitkomst van die meting voor wat de ingest gebruikt, vastgelegd: meten
 * kost ~0,8 s en een worker per verfijning zou dat elke tap opnieuw doen.
 * detect.test meet opnieuw ({ meet: true }) en faalt als het getal hier niet
 * meer klopt — dan is er aan de envelope gedraaid en moet dit mee.
 */
const GEIJKT = { '11025/1024/128': 0.061 };
const GEIJKT_FLANK = { 11025: 0.00503 };

export function onsetVertraging(sampleRate, win = 1024, hop = 128, { meet = false } = {}) {
  const sleutel = `${sampleRate}/${win}/${hop}`;
  if (!meet && sleutel in GEIJKT) return GEIJKT[sleutel];
  if (!meet && vertragingCache.has(sleutel)) return vertragingCache.get(sleutel);
  const waarden = [];
  for (const { x, bpm, T0 } of ijkKlanken(sampleRate)) {
    const { env, envRate } = onsetEnvelope(x, sampleRate, { win, hop, ruw: true });
    const n = normaliseerEnvelope(env, envRate);
    // Waar ligt de top van de gemiddelde tel, in frames na tel T0 (frame 0 = venster op 0)?
    const prof = telProfiel(n, T0 * envRate, (60 / bpm) * envRate, -0.25, 0.1, envRate);
    let top = 0;
    for (let i = 1; i < prof.length; i++) if (prof[i] > prof[top]) top = i;
    waarden.push(-(-0.25 + top * 0.001));
  }
  const v = (Math.min(...waarden) + Math.max(...waarden)) / 2;
  vertragingCache.set(sleutel, v);
  return v;
}

/*
 * De fijne fase: voorflank op een envelope met een KORT venster.
 *
 * De envelope van de ingest (venster 1024 op 11025 Hz = 93 ms) is goed voor
 * tempo maar te wazig voor de fase: de piek schuift met de aanzet en de
 * ruisvloer mee, tot 30 ms. Met een venster van 23 ms (256) en het punt
 * waarop de gemiddelde tel HALVERWEGE zijn stijging is (de voorflank, niet
 * de piek) blijft over de hele ijkreeks ±5 ms over. Dat kan alleen uit de
 * audio zelf; daarom leest de route een stuk audio rond de tap.
 */
export const FIJN = { win: 256, hop: 32 };

/**
 * Voorflank van de gemiddelde tel, in seconden t.o.v. `anker` (tijd van
 * frame 0 = t0). Null als er geen duidelijke tel in het profiel staat.
 */
function flankVan(env, envRate, t0, bpm, anker, zoek) {
  const periodeF = (60 / bpm) * envRate;
  const z = Math.min(zoek, 0.3 * 60 / bpm);
  const stap = 0.0005;
  const prof = telProfiel(env, (anker - t0) * envRate, periodeF, -z, z, envRate, stap);
  let top = 0;
  for (let i = 1; i < prof.length; i++) if (prof[i] > prof[top]) top = i;
  // Bodem: het laagste punt in de 60 ms vóór de top.
  let bodem = top;
  for (let i = top; i >= Math.max(0, top - Math.round(0.06 / stap)); i--) if (prof[i] < prof[bodem]) bodem = i;
  // Duidelijk genoeg? De top moet ruim boven het profiel uitsteken, anders
  // meet je de vorm van ruis (gemeten: 55 ms mis op een zachte tik in ruis).
  const mediaan = [...prof].sort((a, b) => a - b)[prof.length >> 1];
  if (!(prof[top] > 0) || prof[top] < 2.5 * mediaan || bodem === top) return null;
  const helft = prof[bodem] + 0.5 * (prof[top] - prof[bodem]);
  let i = top;
  while (i > bodem && prof[i - 1] > helft) i--;
  // Lineair tussen i-1 en i
  const a = prof[i - 1], b = prof[i];
  const f = b !== a ? (helft - a) / (b - a) : 0;
  return -z + (i - 1 + f) * stap;
}

const flankCache = new Map();
/** Waar ligt de voorflank t.o.v. de echte tel? Gemeten op de ijkreeks, midden van het bereik. */
export function flankVertraging(sampleRate, { meet = false } = {}) {
  if (!meet && sampleRate in GEIJKT_FLANK) return GEIJKT_FLANK[sampleRate];
  if (!meet && flankCache.has(sampleRate)) return flankCache.get(sampleRate);
  const waarden = [];
  for (const { x, bpm, T0 } of ijkKlanken(sampleRate)) {
    const { env, envRate } = onsetEnvelope(x, sampleRate, { ...FIJN, ruw: true });
    const n = normaliseerEnvelope(env, envRate);
    const t0 = FIJN.win / 2 / sampleRate;   // frametijd = midden van het venster
    const fl = flankVan(n, envRate, t0, bpm, T0, 0.08);
    if (fl !== null) waarden.push(-fl);
  }
  const v = (Math.min(...waarden) + Math.max(...waarden)) / 2;
  flankCache.set(sampleRate, v);
  return v;
}

/**
 * Fase bijstellen op de audio rond de tel. `pcm` is mono vanaf tracktijd
 * `t0`. Geeft het verbeterde anker, of null als het profiel geen duidelijke
 * tel laat zien (dan blijft de grove fase staan).
 */
export function fijneFase(pcm, sampleRate, bpm, anker, { t0 = 0, zoek = 0.06 } = {}) {
  const { env, envRate } = onsetEnvelope(pcm, sampleRate, { ...FIJN, ruw: true });
  if (env.length < envRate * 4) return null;
  const n = normaliseerEnvelope(env, envRate);
  const fl = flankVan(n, envRate, t0 + FIJN.win / 2 / sampleRate, bpm, anker, zoek);
  if (fl === null) return null;
  return anker + fl + flankVertraging(sampleRate);
}

/**
 * Onset-envelope via spectral flux: hoeveel energie komt er per frame BIJ.
 *
 * Alleen toenames tellen mee (half-wave rectified). Een afnemende toon is geen
 * aanslag; een inzet is dat wel. De logcompressie zorgt dat een zachte hi-hat
 * net zo goed meetelt als een harde kick.
 */
export function onsetEnvelope(x, sampleRate, { win = 1024, hop = 128, ruw = false, banden = 40 } = {}) {
  // De tijdcorrectie komt uit onsetVertraging(): gemeten, niet gegokt.
  const venster = hann(win);
  const frames = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  const env = new Float32Array(frames);
  const bins = win / 2;

  /*
   * Bins groeperen naar logaritmisch verdeelde banden.
   *
   * Alle 512 bins los optellen laat de ruisvloer in de bovenste driehonderd net
   * zo zwaar meewegen als de kick. Bij ambient is dat precies het verschil
   * tussen een bruikbare envelope en soep. Veertig banden volgen bovendien hoe
   * het oor frequentie verdeelt.
   */
  const bandVan = new Int32Array(bins);
  const laag = 30 * win / sampleRate;           // ~30 Hz in bins
  const hoog = bins - 1;
  for (let b = 0; b < bins; b++) {
    const t = Math.log(Math.max(b, laag) / laag) / Math.log(hoog / laag);
    bandVan[b] = Math.min(banden - 1, Math.max(0, Math.floor(t * banden)));
  }

  let vorige = new Float32Array(banden);
  let huidig = new Float32Array(banden);
  const re = new Float32Array(win), im = new Float32Array(win);

  for (let f = 0; f < frames; f++) {
    const s = f * hop;
    for (let i = 0; i < win; i++) { re[i] = x[s + i] * venster[i]; im[i] = 0; }
    fft(re, im);

    huidig.fill(0);
    for (let b = 0; b < bins; b++) huidig[bandVan[b]] += Math.hypot(re[b], im[b]);
    for (let k = 0; k < banden; k++) huidig[k] = Math.log1p(1000 * huidig[k]);

    /*
     * Superflux: vergelijk een band niet met zichzelf van het vorige frame,
     * maar met het MAXIMUM van zijn buren. Een toon die langzaam omhoog
     * glijdt — een pad, vibrato, tape-wow — blijft dan binnen zijn eigen
     * maximum en levert geen flux op. Een aanslag wel.
     */
    let flux = 0;
    for (let k = 0; k < banden; k++) {
      let ref = vorige[k];
      if (k > 0 && vorige[k - 1] > ref) ref = vorige[k - 1];
      if (k < banden - 1 && vorige[k + 1] > ref) ref = vorige[k + 1];
      const d = huidig[k] - ref;
      if (d > 0) flux += d;
    }
    env[f] = flux;
    const wissel = vorige; vorige = huidig; huidig = wissel;
  }

  return { env, envRate: sampleRate / hop,
    tijdOffset: ruw ? 0 : onsetVertraging(sampleRate, win, hop) };
}

/**
 * DE LAGE BAND (15 okt, docs/BEATGRID.md §14): de ENERGIE onder `tot` Hz
 * (kick en bas) in vakjes van 1/envRate s (standaard 4 ms), gefilterd per
 * sample: een hoogdoorlaat op `van` Hz en twee keer een laagdoorlaat op `tot`
 * (één pool elk). Voor een tweede mening over de "1" (maatMening in
 * src/engine/tellen.js): op de "1" valt in Clay's repertoire bijna altijd een
 * kick of een nieuwe basnoot; maatSterkte kijkt hoeveel energie er na een tel
 * BIJ komt (na min ervoor).
 * Geen FFT-flux met frames van 11,6 ms (de eerste versie): de plek van de
 * aanslag tussen twee frames schoof per tel op, en waar een maat precies een
 * geheel aantal van die verschuivingen lang was (122,3 bpm = 42,25 frames per
 * tel) lag de "1" 30-45% zwakker dan tel 4, in vier op de vloer. Energie per
 * sample opgeteld hangt daar niet van af. Los van onsetEnvelope (die blijft
 * bit voor bit gelijk: analyze.test vergelijkt hem met de browser).
 * Vakje i hoort bij tracktijd i / envRate (tijdOffset 0; de vertraging van de
 * filters, ~2 ms, is voor elke tel dezelfde en valt weg in de vergelijking).
 */
export const LAAG_TOT = 150;
export const LAAG_RATE = 250;
export function laagEnvelope(x, sampleRate, { tot = LAAG_TOT, van = 30, envRate = LAAG_RATE } = {}) {
  const n = Math.floor(x.length * envRate / sampleRate);
  const env = new Float32Array(n);
  const aH = Math.exp(-2 * Math.PI * van / sampleRate), aL = Math.exp(-2 * Math.PI * tot / sampleRate);
  let hx = 0, hy = 0, l1 = 0, l2 = 0, i = 0;
  for (let v = 0; v < n; v++) {
    const eind = Math.min(x.length, Math.round((v + 1) * sampleRate / envRate));
    let e = 0;
    for (; i < eind; i++) {
      const xi = x[i];
      hy = aH * (hy + xi - hx); hx = xi;               // hoogdoorlaat (één pool)
      l1 += (1 - aL) * (hy - l1);                      // twee keer laagdoorlaat
      l2 += (1 - aL) * (l1 - l2);
      e += l2 * l2;
    }
    env[v] = e;
  }
  return { env, envRate, tijdOffset: 0 };
}

/**
 * Envelope schoonmaken: lokaal hoogdoorlaten en lokaal normaliseren.
 *
 * Het globale gemiddelde eraf trekken werkt niet op materiaal dat van stil naar
 * luid gaat: in het stille deel blijft alles nul en in het luide deel telt alles
 * mee. Een lopende MEDIAAN haalt een langzame swell weg maar laat een klap
 * staan, en daarna delen door een lopend gemiddelde geeft een stille passage
 * evenveel gewicht als de drop.
 */
export function normaliseerEnvelope(env, envRate = 86, { medianeSec = 1.5, normSec = 3 } = {}) {
  const n = env.length;
  if (!n) return new Float32Array(0);

  // Mediaan per blok, lineair ertussenin — een echte lopende mediaan over
  // 160.000 frames is nodeloos duur voor hetzelfde resultaat.
  const blok = Math.max(8, Math.round((medianeSec * envRate) / 2));
  const blokken = Math.ceil(n / blok);
  const medianen = new Float32Array(blokken);
  const hulp = new Float32Array(blok);
  for (let b = 0; b < blokken; b++) {
    const s = b * blok, e = Math.min(n, s + blok);
    const m = e - s;
    for (let i = 0; i < m; i++) hulp[i] = env[s + i];
    const deel = hulp.subarray(0, m).slice().sort();
    medianen[b] = deel[Math.floor(m / 2)];
  }
  const medianBij = (i) => {
    const p = i / blok - 0.5;
    const a = Math.max(0, Math.min(blokken - 1, Math.floor(p)));
    const c = Math.max(0, Math.min(blokken - 1, a + 1));
    const t = Math.max(0, Math.min(1, p - a));
    return medianen[a] * (1 - t) + medianen[c] * t;
  };

  const uit = new Float32Array(n);
  for (let i = 0; i < n; i++) uit[i] = Math.max(0, env[i] - medianBij(i));

  // Lokaal normaliseren met een lopend gemiddelde over een ruimer venster.
  const w = Math.max(16, Math.round(normSec * envRate));
  let som = 0;
  const loop = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    som += uit[i];
    if (i >= w) som -= uit[i - w];
    loop[i] = som / Math.min(i + 1, w);
  }
  let globaal = 0;
  for (let i = 0; i < n; i++) globaal += uit[i];
  globaal /= n || 1;
  const eps = globaal * 0.1 + 1e-9;
  for (let i = 0; i < n; i++) uit[i] = uit[i] / (loop[i] + eps);

  return uit;
}

/**
 * Tempo uit een onset-envelope via autocorrelatie.
 *
 * De weging rond 120 bpm is geen smaak maar noodzaak: autocorrelatie ziet een
 * halve en een dubbele tel net zo goed als de echte, en zonder voorkeur kiest
 * hij willekeurig. De zekerheid zegt hoeveel de winnaar uitsteekt boven de rest
 * — daar kun je op vertrouwen of juist niet.
 */
export function tempoUitEnvelope(env, envRate, { minBpm = 60, maxBpm = 190, voorkeur = 120 } = {}) {
  const n = env.length;
  const minLag = Math.max(2, Math.floor((60 * envRate) / maxBpm));
  const maxLag = Math.min(n - 1, Math.ceil((60 * envRate) / minBpm));
  if (maxLag <= minLag) return { bpm: null, zekerheid: 0 };

  // Twee reeksen: de RUWE autocorrelatie en dezelfde met een tempovoorkeur.
  // De voorkeur kiest tussen octaven; de zekerheid mag er niet op leunen, want
  // dan meet je de vorm van je eigen aanname en scoort witte ruis hoog.
  const ruw = new Float64Array(maxLag + 1);
  const scores = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = env[i], b = env[i + lag];
      xy += a * b; xx += a * a; yy += b * b;
    }
    // Genormaliseerde autocorrelatie: 1 = perfect periodiek, 0 = geen verband.
    // Deze maat hangt niet af van hoe hard het materiaal is.
    ruw[lag] = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    const bpm = (60 * envRate) / lag;
    const straf = Math.exp(-0.5 * Math.pow(Math.log2(bpm / voorkeur) / 0.7, 2));
    scores[lag] = ruw[lag] * straf;
  }

  let beste = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (scores[lag] > scores[beste]) beste = lag;

  /*
   * De autocorrelatie meet in hele frames. Bij 86 frames/s scheelt één frame
   * rond 128 bpm al ruim een bpm, en over een venster van twintig seconden
   * loopt dat op tot 75 ms fase — hoorbaar naast.
   *
   * Een parabool door de piek en zijn twee buren geeft de top tussen de frames
   * in. Kost niets en haalt de fout een orde omlaag.
   */
  /*
   * Octaafkeuze. Bij een strak ritme is de autocorrelatie op twee tellen even
   * sterk als op één; welke wint is dan een muntworp. Staat de halve lag er
   * bijna net zo goed voor, dan kiezen we de snellere — de tel, niet de maat.
   * Daarmee wordt 174 bpm geen 87.
   */
  const half = Math.round(beste / 2);
  if (half >= minLag && scores[half] >= scores[beste] * 0.90) beste = half;

  /*
   * Octaafkeuze, deel twee: 3:2. Syncopen (drie achtsten, drie achtsten,
   * twee) leggen een sterke periode op anderhalve tel. De autocorrelatie
   * ziet daar een "tempo" van 2/3 van het echte: Bay Ledges werd 102 waar je
   * 153 tikt. Een tel is pas een tel als ook zijn veelvouden kloppen — twee
   * tellen, een maat. Dus vergelijken we de METRISCHE steun (correlatie op
   * 2× en 4× de lag, met dezelfde tempovoorkeur) van de winnaar met die van
   * 2/3× de lag, en wisselen alleen als het alternatief een echte piek is en
   * duidelijk (10%) beter gedragen wordt. De lag zelf telt niet mee: dat is
   * juist de periode waarover de twee het oneens zijn.
   * Een recht 4/4-nummer op 102 houdt zo zijn 102: op 153 vallen de
   * veelvouden tussen zijn tellen.
   */
  const acOp = (lag) => {
    const L = Math.floor(lag), f = lag - L;
    if (L < 1 || L + 1 >= n) return 0;
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i + L + 1 < n; i++) {
      const a = env[i], b = env[i + L] * (1 - f) + env[i + L + 1] * f;
      xy += a * b; xx += a * a; yy += b * b;
    }
    return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
  };
  // De lag is een heel frame; op k× de lag loopt die afronding op tot k/2
  // frames, genoeg om een smalle piek te missen. Dus rond k·lag de top zoeken.
  const steun = (lag) => {
    let som = 0, aantal = 0;
    for (const k of [2, 4]) {
      if (k * lag >= n / 2) continue;
      let top = 0;
      for (let d = -k / 2; d <= k / 2; d += 0.25) top = Math.max(top, acOp(k * lag + d));
      som += top; aantal++;
    }
    return aantal ? som / aantal : 0;
  };
  // Dezelfde tempovoorkeur als hierboven, anders wint in ruis de rand van het bereik.
  const straf = (lag) => Math.exp(-0.5 * Math.pow(Math.log2((60 * envRate) / lag / voorkeur) / 0.7, 2));
  const steunBeste = steun(beste) * straf(beste);
  let drieTwee = null;
  /*
   * Alleen de SNELLERE kant (lag × 2/3). De tragere kant (× 3/2) is gemeten
   * op Clay's library en was elke keer mis: 141 -> 92 en 157 -> 103 op het
   * album, 173 -> 116 bij Sakamoto, ook met 50% meer steun geëist. Net als bij
   * de halvering kiezen we bij twijfel de tel, niet iets groters. Tik je 2/3
   * van wat de detectie zegt, dan beslist de tap (zie verfijnTap).
   */
  for (const [factor, eis] of [[2 / 3, 1.10]]) {
    const alt = Math.round(beste * factor);
    // Alleen een echte piek in de autocorrelatie, niet de rand van het bereik.
    if (alt <= minLag || alt >= maxLag) continue;
    if (!(ruw[alt] >= ruw[alt - 1] && ruw[alt] >= ruw[alt + 1])) continue;
    const st = steun(alt) * straf(alt);
    if (st > steunBeste * eis && (!drieTwee || st > drieTwee.st)) drieTwee = { lag: alt, st };
  }
  if (drieTwee) beste = drieTwee.lag;

  let verfijndeLag = beste;
  if (beste > minLag && beste < maxLag) {
    const y0 = scores[beste - 1], y1 = scores[beste], y2 = scores[beste + 1];
    const noemer = y0 - 2 * y1 + y2;
    if (noemer !== 0) {
      const delta = (0.5 * (y0 - y2)) / noemer;
      if (Math.abs(delta) <= 1) verfijndeLag = beste + delta;
    }
  }

  /*
   * Zekerheid = de genormaliseerde correlatie op de gekozen lag, minus de
   * bodem die je ook op ruis haalt. Een strak ritme komt ver boven die bodem
   * uit, witte ruis niet.
   *
   * Nadrukkelijk NIET een z-score over alle lags: bij echte muziek zijn er
   * juist veel hoge pieken (elke maat, elke twee tellen), waardoor de spreiding
   * groot wordt en de winnaar er relatief minder bovenuit steekt. Dan scoort
   * ruis hoger dan een drumcomputer.
   */
  const geldig = [];
  for (let lag = minLag; lag <= maxLag; lag++) geldig.push(ruw[lag]);
  geldig.sort((a, b) => a - b);
  const bodem = geldig[Math.floor(geldig.length * 0.5)];
  const zekerheid = Math.max(0, Math.min(1, (ruw[beste] - bodem) / 0.35));

  return { bpm: (60 * envRate) / verfijndeLag, zekerheid, lag: verfijndeLag };
}

/**
 * Waar ligt de eerste tel? Een pulstrein op het gevonden tempo over de
 * envelope schuiven en kijken waar hij het beste past.
 */
export function faseUitEnvelope(env, envRate, bpm, tijdOffset = 0, { oversample = 8 } = {}) {
  const periode = (60 * envRate) / bpm;
  const stappen = Math.max(8, Math.round(periode * oversample));

  // Lineair tussen de frames door lezen: de tel ligt zelden precies op een frame.
  const lees = (t) => {
    if (t < 0 || t >= env.length - 1) return 0;
    const i = Math.floor(t), f = t - i;
    return env[i] * (1 - f) + env[i + 1] * f;
  };
  const scoreVan = (offset) => {
    let score = 0;
    for (let t = offset; t < env.length - 1; t += periode) score += lees(t);
    return score;
  };

  const scores = new Float64Array(stappen);
  let beste = 0;
  for (let s = 0; s < stappen; s++) {
    scores[s] = scoreVan((s / stappen) * periode);
    if (scores[s] > scores[beste]) beste = s;
  }

  // Paraboolverfijning, rondom (de reeks is cyclisch).
  const y0 = scores[(beste - 1 + stappen) % stappen];
  const y1 = scores[beste];
  const y2 = scores[(beste + 1) % stappen];
  const noemer = y0 - 2 * y1 + y2;
  let fijn = beste;
  if (noemer !== 0) {
    const delta = (0.5 * (y0 - y2)) / noemer;
    if (Math.abs(delta) <= 1) fijn = beste + delta;
  }

  const offset = ((fijn / stappen) * periode + periode) % periode;
  return offset / envRate + tijdOffset;
}

/**
 * Tempo en fase SAMEN verfijnen.
 *
 * Los van elkaar schatten werkt niet: zit het tempo 2 bpm naast, dan loopt dat
 * over twintig seconden een halve tel weg en past geen enkele fase meer. Dus
 * zoeken we over een klein rooster van tempo's, bepalen per tempo de beste
 * fase, en kiezen het paar dat samen het beste op de aanslagen valt.
 */
export function verfijnTempoFase(env, envRate, bpmStart, tijdOffset = 0,
  { marge = 0.03, stappen = 61, rond = null, straal = 45, anker = null, faseMarge = 0.25,
    fijnePas = true } = {}) {
  /*
   * Alleen scoren rond de plek waar je tikte (`rond`, tracktijd in seconden,
   * ± `straal`). Een album van een halfuur heeft zeven tempo's; over de hele
   * track scoren laat het tempo van het langste stuk winnen, niet dat van
   * wat je hoort. Zonder `rond`: de hele track, exact zoals vroeger.
   */
  const { van, tot } = vensterRond(env.length, envRate, tijdOffset, rond, straal);
  const lees = (t) => {
    if (t < 0 || t >= env.length - 1) return 0;
    const i = Math.floor(t), f = t - i;
    return env[i] * (1 - f) + env[i + 1] * f;
  };
  /*
   * Met een ANKER (tracktijd van een getikte tel) mag de fase alleen binnen
   * ±`faseMarge` van een periode rond die tel liggen. Zonder die voorwaarde
   * koos de verfijning op materiaal met een zwakke puls vaak de offbeat: een
   * halve tel naast, precies de fout die je het hardst hoort. Het oor dat
   * tikte weet waar de tel valt; de envelope weet alleen waar het klapt.
   */
  const metAnker = anker !== null && Number.isFinite(anker);
  const ankerF = metAnker ? (anker - tijdOffset) * envRate : 0;
  /*
   * Altijd hetzelfde AANTAL pulsen optellen, ongeacht de offset.
   *
   * Laat je de lus gewoon tot het eind lopen, dan past er bij een kleine offset
   * één puls meer in het venster en wint die offset op volume in plaats van op
   * passendheid. Dat kostte 25 ms fase — precies het soort fout dat je niet
   * ziet maar wel hoort.
   */
  const scoreVan = (periode, offset) => {
    const aantal = Math.floor((tot - van - 2 - periode) / periode);
    if (aantal < 2) return 0;
    // Eerste puls in het venster met dezelfde fase. Voor van = 0 precies de
    // offset zelf (geen modulo): dan blijft het oude resultaat bit voor bit.
    const basis = van === 0 && !metAnker ? offset : van + (((offset - van) % periode) + periode) % periode;
    let score = 0;
    for (let k = 0; k < aantal; k++) score += lees(basis + k * periode);
    return score / aantal;
  };
  let beste = { bpm: bpmStart, fase: 0, score: -Infinity };
  for (let i = 0; i < stappen; i++) {
    const bpm = bpmStart * (1 + marge * (2 * i / (stappen - 1) - 1));
    const periode = (60 * envRate) / bpm;
    if (metAnker) {
      const n = Math.max(8, Math.round(periode * 8 * faseMarge));
      for (let k = -n; k <= n; k++) {
        const offset = ankerF + (k / n) * faseMarge * periode;
        const sc = scoreVan(periode, offset);
        if (sc > beste.score) beste = { bpm, fase: offset, score: sc, periode };
      }
    } else {
      const fijnheid = Math.max(16, Math.round(periode * 8));
      for (let k = 0; k < fijnheid; k++) {
        const offset = (k / fijnheid) * periode;
        const sc = scoreVan(periode, offset);
        if (sc > beste.score) beste = { bpm, fase: offset, score: sc, periode };
      }
    }
  }

  // Nog één slag, fijner, rond de winnaar.
  const grof = beste;
  if (fijnePas) {
    for (let i = 0; i < 41; i++) {
      const bpm = grof.bpm * (1 + 0.004 * (2 * i / 40 - 1));
      const periode = (60 * envRate) / bpm;
      for (let k = -20; k <= 20; k++) {
        let offset;
        if (metAnker) {
          // Dezelfde fase als de grove winnaar, gemeten vanaf het anker.
          const d = grof.fase - ankerF + (k / 20) * periode * 0.05;
          if (Math.abs(d) > faseMarge * periode) continue;
          offset = ankerF + d;
        } else {
          offset = ((grof.fase + (k / 20) * periode * 0.05) % periode + periode) % periode;
        }
        const sc = scoreVan(periode, offset);
        if (sc > beste.score) beste = { bpm, fase: offset, score: sc, periode };
      }
    }
  }

  const periode = (60 * envRate) / beste.bpm;
  const fase = metAnker ? ((beste.fase % periode) + periode) % periode : beste.fase;
  const uit = { bpm: beste.bpm, firstBeat: fase / envRate + tijdOffset, score: beste.score, grofScore: grof.score };
  if (metAnker) uit.anker = beste.fase / envRate + tijdOffset;
  return uit;
}

/**
 * Welk stuk envelope telt als je rond `rond` (tracktijd) scoort? Zonder
 * `rond`: alles. Te dicht bij het einde: het venster schuift terug.
 */
export function vensterRond(lengte, envRate, tijdOffset, rond, straal) {
  let van = 0, tot = lengte;
  if (rond !== null && rond !== undefined && Number.isFinite(rond)) {
    const midden = (rond - tijdOffset) * envRate;
    van = Math.max(0, Math.floor(midden - straal * envRate));
    tot = Math.min(lengte, Math.ceil(midden + straal * envRate));
    if (tot - van < 2 * straal * envRate) {
      van = Math.max(0, Math.min(van, Math.floor(tot - 2 * straal * envRate)));
    }
  }
  return { van, tot };
}

/**
 * Een rechte lijn door de tikken: tijd = anker + i · periode.
 *
 * Het gemiddelde van de tussenpozen (of de mediaan) gooit weg WAAR je tikte;
 * de lijn houdt tempo en fase samen. Bij vier tikken halveert dat de
 * tempofout ruwweg, en de fase komt er gratis bij. Een gemiste tik (een gat
 * van twee tellen) telt als een overgeslagen tel, niet als een trage tel.
 *
 * `seRel` is de onzekerheid van de periode als fractie: het residu van de
 * lijn gedeeld door de spreiding van de tikken. Bij twee of drie tikken zegt
 * het residu nog weinig, dus rekenen we een bekende menselijke tapfout
 * (`tapSigma`, ~20 ms) mee als twee extra waarnemingen.
 */
export function fitTaps(taps, bpmHint = null, { tapSigma = 0.02, gewicht = 2 } = {}) {
  if (!Array.isArray(taps)) return null;
  const t = taps.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (t.length < 2) return null;
  const tussen = [];
  for (let i = 1; i < t.length; i++) tussen.push(t[i] - t[i - 1]);
  const gesorteerd = [...tussen].sort((a, b) => a - b);
  const pSchat = bpmHint > 0 ? 60 / bpmHint : gesorteerd[Math.floor(gesorteerd.length / 2)];
  if (!(pSchat > 0)) return null;
  // Dubbele tik (korter dan een halve tel na de vorige): weg.
  const tijden = [t[0]], idx = [0];
  for (let i = 1; i < t.length; i++) {
    const d = t[i] - tijden.at(-1);
    if (d < 0.5 * pSchat) continue;
    tijden.push(t[i]);
    idx.push(idx.at(-1) + Math.max(1, Math.round(d / pSchat)));
  }
  const n = tijden.length;
  if (n < 2) return null;
  const mx = idx.reduce((a, b) => a + b, 0) / n;
  const my = tijden.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let k = 0; k < n; k++) { sxx += (idx[k] - mx) ** 2; sxy += (idx[k] - mx) * (tijden[k] - my); }
  const periode = sxy / sxx;
  if (!(periode > 60 / 300 && periode < 60 / 30)) return null;
  const a = my - periode * mx;
  let ssr = 0;
  for (let k = 0; k < n; k++) ssr += (tijden[k] - (a + periode * idx[k])) ** 2;
  const sigma = Math.sqrt((ssr + gewicht * tapSigma ** 2) / (n - 2 + gewicht));
  // Anker = de tel op de lijn het dichtst bij het zwaartepunt: daar is de
  // fase het zekerst (de fout groeit naar de randen van de reeks).
  const iAnker = Math.round(mx);
  return {
    bpm: 60 / periode, periode, n,
    anker: a + periode * iAnker,
    sigma, seRel: sigma / Math.sqrt(sxx) / periode,
    eerste: tijden[0], laatste: tijden.at(-1),
  };
}

/**
 * Deterministische schudder (LCG): dezelfde nul bij elke aanroep.
 *
 * `draai`: elk blok ook nog een willekeurig stuk rondschuiven. Zonder dat
 * houdt de nul zijn fase vast zodra een blok een geheel aantal (halve) tellen
 * lang is — bij 1 s blokken: 120, 90, 60, 180 bpm. Gemeten 23 september 2026:
 * een schone klik op 120 bpm kreeg zekerheid 0 (de nul hield net zo goed vast
 * als het echte spoor), op 124 bpm 1,00. Voor faseStabiliteit is dat fataal,
 * daarom draait analyseerGrid; pulsToets scoort op tempo én fase over het
 * hele venster en is op de oude manier geijkt.
 */
function schudBlokken(deel, blok, seed, { draai = false } = {}) {
  const n = Math.floor(deel.length / blok);
  const idx = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const uit = new Float32Array(deel.length);
  for (let i = 0; i < n; i++) {
    const bron = deel.subarray(idx[i] * blok, idx[i] * blok + blok);
    if (!draai) { uit.set(bron, i * blok); continue; }
    const k = Math.floor(rnd() * blok);
    uit.set(bron.subarray(k), i * blok);
    uit.set(bron.subarray(0, k), i * blok + blok - k);
  }
  uit.set(deel.subarray(n * blok), n * blok);
  return uit;
}

/**
 * Is er rond deze plek wel een puls? De nul.
 *
 * De verfijning vindt ALTIJD een beste tempo en fase, ook in ruis: zoeken
 * over 61 tempo's en honderd fasen levert altijd een maximum op. Of dat
 * maximum iets betekent, zie je pas als je dezelfde zoektocht loslaat op
 * dezelfde envelope met de tijd door elkaar gegooid (blokken van 1 s
 * geschud): zelfde niveaus, zelfde dichtheid, geen doorlopende puls. Komt de
 * echte score daar niet duidelijk bovenuit, dan is er niets om op te lijnen
 * en maakt verfijnen een tap alleen slechter (gemeten: 13-25 van de 40
 * proeven op de offbeat bij "zoned out").
 *
 * Geeft { puls, verhouding, z, nul } — verhouding = echte score / hoogste nul.
 */
export function pulsToets(env, envRate, tijdOffset, bpmStart, opties = {},
  { schud = 12, blokSec = 1, straal = 20, drempel = 1.05, zDrempel = 3 } = {}) {
  /*
   * Lokaal (±20 s rond de tap), niet over het hele verfijnvenster: bij
   * piano en rubato is de puls er alleen waar je tikte, en ±45 s verdunde hem
   * tot hij niet meer van de nul te onderscheiden was.
   */
  const { rond = null } = opties;
  const { van, tot } = vensterRond(env.length, envRate, tijdOffset, rond, straal);
  const deel = env.subarray(van, tot);
  const t0 = tijdOffset + van / envRate;
  const zoek = { ...opties, rond: null, fijnePas: false };
  const echt = verfijnTempoFase(deel, envRate, bpmStart, t0, zoek).grofScore;
  const blok = Math.max(1, Math.round(blokSec * envRate));
  const nul = [];
  for (let k = 0; k < schud; k++) {
    const g = schudBlokken(deel, blok, 7919 * (k + 1));
    nul.push(verfijnTempoFase(g, envRate, bpmStart, t0, zoek).grofScore);
  }
  const hoogste = Math.max(...nul);
  const gem = nul.reduce((a, b) => a + b, 0) / nul.length;
  const sd = Math.sqrt(nul.reduce((a, b) => a + (b - gem) ** 2, 0) / nul.length) || 1e-9;
  const verhouding = hoogste > 0 ? echt / hoogste : Infinity;
  const z = (echt - gem) / sd;
  // Boven de hoogste nul uit, of ver boven het gemiddelde van de nullen.
  return { puls: verhouding >= drempel || z >= zDrempel, verhouding, z, nul: hoogste };
}

/**
 * De tap-hybride in één aanroep: wat de route /grid/verfijn doet.
 *
 * In: getikte bpm (tracktijd), en zo mogelijk de tikken zelf (`taps`,
 * tracktijden) of één getikte tel (`anker`). Uit: { bpm, firstBeat, anker,
 * zeker, score, reden? }. Zonder puls: `zeker: false` met reden "geen puls",
 * en de tap zelf terug — de browser laat hem dan staan.
 */
export function verfijnTap(env, envRate, tijdOffset, { bpm, positie = null, anker = null, taps = null,
  marge = null, straal = null, pulsOpties = {} } = {}) {
  const fit = fitTaps(taps, bpm);
  const bpmStart = fit ? fit.bpm : bpm;
  const ankerIn = fit ? fit.anker : (Number.isFinite(anker) ? anker : null);
  /*
   * Venster: ±30 s met een getikte fase, ±45 s zonder (zoals vroeger). Met
   * een anker hoeft het venster het octaaf en de fase niet meer te vinden, en
   * een kleiner venster volgt een tempo dat zwalkt: op Bay Ledges (±1%) ging
   * de tap-simulatie daar van 5 naar 16-19 van de 20 goed.
   */
  if (!(straal > 0)) straal = ankerIn !== null ? 30 : 45;
  const rond = Number.isFinite(positie) ? positie : (fit ? (fit.eerste + fit.laatste) / 2 : ankerIn);
  /*
   * Tempomarge: met tikken schaalt hij mee met hoe netjes je tikte. De
   * standaardfout van de lijn ziet alleen de SPREIDING van je tikken; wie
   * gelijkmatig 1% te snel tikt, tikt een keurige rechte lijn. Daarom komt er
   * een vloer van 1% bij (kwadratisch opgeteld). Marge = drie keer dat,
   * tussen 1,5% en 6%. Zonder tikken: de vaste 3% van vroeger.
   * (Een gaussische voorkeur rond de getikte bpm is ook gemeten, met sigma
   * 1× en 1,5× die onzekerheid: slechter in elke variant. Hij trekt het
   * tempo weg van de puls zodra je gelijkmatig iets te snel tikt.)
   */
  const onzeker = fit && fit.n >= 3 ? Math.hypot(fit.seRel, 0.01) : null;
  const m = Number.isFinite(marge) && marge > 0 ? marge
    : onzeker ? Math.min(0.06, Math.max(0.015, 3 * onzeker)) : 0.03;
  const opties = { marge: m, rond, straal, anker: ankerIn };
  const r = verfijnTempoFase(env, envRate, bpmStart, tijdOffset, opties);
  const toets = pulsToets(env, envRate, tijdOffset, bpmStart, opties, pulsOpties);

  const basis = { marge: m, tikken: fit ? fit.n : 0, puls: toets.verhouding, positie: rond };
  if (!toets.puls) {
    // Geen puls: de tap zelf. Fase uit de lijn of het anker; anders niets.
    const p = 60 / bpmStart;
    const a = ankerIn;
    return { ...basis, zeker: false, reden: 'geen puls', bpm: bpmStart,
      firstBeat: a === null ? null : ((a % p) + p) % p, anker: a, score: r.score };
  }
  const p = 60 / r.bpm;
  const ankerUit = r.anker ?? (rond === null ? r.firstBeat : r.firstBeat + Math.round((rond - r.firstBeat) / p) * p);
  return { ...basis, zeker: true, bpm: r.bpm, firstBeat: r.firstBeat, anker: ankerUit, score: r.score };
}

/**
 * Tempo per venster: een tempocurve over de hele track.
 * Hiermee zie je waar het tempo verandert in plaats van dat je er één
 * gemiddelde overheen legt dat nergens klopt.
 *
 * `tijd` is het MIDDEN van het venster (tracktijd). Het begin gebruiken
 * legde elke tempogrens een half venster (6 s) te vroeg.
 */
export function tempoCurve(env, envRate, { vensterSec = 12, stapSec = 4, ...opties } = {}) {
  const venster = Math.round(vensterSec * envRate);
  const stap = Math.round(stapSec * envRate);
  const t0 = opties.tijdOffset || 0;
  const uit = [];
  for (let s = 0; s + venster <= env.length; s += stap) {
    const deel = env.subarray(s, s + venster);
    const r = tempoUitEnvelope(deel, envRate, opties);
    uit.push({ tijd: (s + venster / 2) / envRate + t0, van: s / envRate + t0, tot: (s + venster) / envRate + t0,
      bpm: r.bpm, zekerheid: r.zekerheid });
  }
  return uit;
}

const mediaanVan = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/**
 * De eerste helft van segmenteer: bruikbare vensters (bpm, zekerheid ≥
 * `minZekerheid`) aan elkaar rijgen zolang het tempo binnen `tolerantie` van
 * de mediaan blijft en er geen GAT tussen zit (meer dan `maxGat` s zonder
 * bruikbaar venster; standaard twee stappen van de curve). Nog niets
 * opgeslokt of weggegooid. Per keten { van, tot (middens van het eerste en
 * laatste venster), bpms, zeker, idx (indexen in `curve`), gatNa }, plus de stap.
 */
export function ketens(curve, { tolerantie = 0.03, minZekerheid = 0.30, maxGat = null } = {}) {
  // Stapgrootte uit de curve zelf; een gat is meer dan twee stappen zonder bruikbaar venster.
  const stappen = [];
  for (let i = 1; i < curve.length; i++) stappen.push(curve[i].tijd - curve[i - 1].tijd);
  const stap = stappen.length ? mediaanVan(stappen) : 0;
  const gat = maxGat ?? 2 * stap + 1e-6;
  const uit = [];
  let huidig = null;
  curve.forEach((p, i) => {
    if (!(p.bpm && p.zekerheid >= minZekerheid)) return;
    if (huidig) {
      const ref = mediaanVan(huidig.bpms);
      const overGat = p.tijd - huidig.tot > gat;
      if (!overGat && Math.abs(p.bpm - ref) / ref <= tolerantie) {
        huidig.bpms.push(p.bpm); huidig.zeker.push(p.zekerheid); huidig.tot = p.tijd; huidig.idx.push(i);
        return;
      }
      huidig.gatNa = overGat;
      uit.push(huidig);
    }
    huidig = { van: p.tijd, tot: p.tijd, bpms: [p.bpm], zeker: [p.zekerheid], idx: [i] };
  });
  if (huidig) uit.push(huidig);
  return { ketens: uit, stap };
}

/**
 * De tempocurve opknippen in segmenten met een stabiel tempo.
 *
 * Vensters die binnen `tolerantie` van elkaar liggen horen bij elkaar. Een
 * GAT (meer dan `maxGat` seconden zonder bruikbaar venster) knipt altijd: een
 * stuk loopt nooit over een stilte of een pulsloze passage heen, ook niet als
 * het tempo erna toevallig gelijk is. Een segment korter dan `minSec` is ruis:
 * het gaat op in een aangrenzend segment (het eerste stuk ook), en staat het
 * alleen tussen twee gaten, dan vervalt het.
 */
export function segmenteer(curve, { tolerantie = 0.03, minSec = 20, minZekerheid = 0.30, maxGat = null } = {}) {
  const { ketens: segmenten, stap } = ketens(curve, { tolerantie, minZekerheid, maxGat });
  if (!segmenten.length) return [];

  // Grenzen: een segment beslaat zijn vensters (midden ± halve stap).
  for (const sg of segmenten) { sg.van -= stap / 2; sg.tot += stap / 2; }

  // Te korte segmenten opslokken, alleen door een aangrenzende buur (geen gat
  // ertussen); bij twee buren die met het dichtstbijzijnde tempo.
  let veranderd = true;
  while (veranderd) {
    veranderd = false;
    for (let i = 0; i < segmenten.length; i++) {
      const sg = segmenten[i];
      if (sg.tot - sg.van >= minSec) continue;
      const links = i > 0 && !segmenten[i - 1].gatNa ? segmenten[i - 1] : null;
      const rechts = i < segmenten.length - 1 && !sg.gatNa ? segmenten[i + 1] : null;
      const m = mediaanVan(sg.bpms);
      const afstand = (b) => (b ? Math.abs(Math.log(mediaanVan(b.bpms) / m)) : Infinity);
      const doel = afstand(links) <= afstand(rechts) ? links : rechts;
      if (doel) {
        doel.van = Math.min(doel.van, sg.van); doel.tot = Math.max(doel.tot, sg.tot);
        doel.bpms.push(...sg.bpms); doel.zeker.push(...sg.zeker);
        if (doel === links) links.gatNa = sg.gatNa;
      }
      // Geen buur zonder gat: ruis tussen twee stiltes, weg ermee.
      segmenten.splice(i, 1);
      veranderd = true;
      break;
    }
  }

  return segmenten.map((sg) => ({
    van: Math.max(0, sg.van), tot: sg.tot,
    bpm: mediaanVan(sg.bpms),
    zekerheid: sg.zeker.reduce((a, b) => a + b, 0) / sg.zeker.length,
  }));
}

/**
 * Fase-stabiliteit: houdt de puls zijn fase vast?
 *
 * Per deelvenster (`sub` s, om de `stap` s) de fase van de envelope op dit
 * tempo, als gewogen cirkelgemiddelde (afgetopt op p95 van het stuk, zodat
 * één klap niet beslist). Een echte puls geeft buurvensters met dezelfde fase; ruis, piano
 * zonder maat of een verkeerd tempo niet. Gemeten op Clay's library voorspelt
 * dit beter of een grid klopt dan de hoogte van een autocorrelatiepiek (die
 * scoort vals hoog op piano en vals laag op ambient-elektronisch).
 *
 * Geeft het aandeel buurparen waarvan de fase minder dan `tol` (8% van een
 * periode) verschilt, 0..1. Zonder vergelijking met een nul zegt het getal
 * weinig: overlappende vensters lijken ook in ruis op elkaar.
 */
export function faseStabiliteit(env, envRate, tijdOffset, bpm, van, tot, { sub = 6, stap = 1.5, tol = 0.08 } = {}) {
  if (!(bpm > 0)) return 0;
  const p = 60 / bpm;
  const w = (2 * Math.PI) / (p * envRate);      // fasehoek per frame
  const cw = Math.cos(w), sw = Math.sin(w);
  // Aftoppen op p95 van het hele stuk: één klap mag een deelvenster niet beslissen.
  const heelA = Math.max(0, Math.floor((van - tijdOffset) * envRate));
  const heelB = Math.min(env.length, Math.floor((tot - tijdOffset) * envRate));
  if (heelB - heelA < envRate) return 0;
  const gesorteerd = env.slice(heelA, heelB).sort();
  const kap = gesorteerd[Math.floor(0.95 * (gesorteerd.length - 1))] || 1e-9;
  const fasen = [];
  for (let v = van; v + sub <= tot + 1e-9; v += stap) {
    const fA = Math.max(0, Math.floor((v - tijdOffset) * envRate));
    const fB = Math.min(env.length, Math.floor((v + sub - tijdOffset) * envRate));
    if (fB - fA < envRate) { fasen.push(null); continue; }
    // cos/sin per frame via rotatie: dezelfde hoek als (f/envRate + tijdOffset)/p, zonder trig per frame.
    const h0 = 2 * Math.PI * ((fA / envRate + tijdOffset) / p);
    let c = Math.cos(h0), sn = Math.sin(h0), re = 0, im = 0, som = 0;
    for (let f = fA; f < fB; f++) {
      const e = env[f] < kap ? env[f] : kap;
      re += e * c; im += e * sn; som += e;
      const nc = c * cw - sn * sw; sn = c * sw + sn * cw; c = nc;
    }
    fasen.push(som > 0 ? Math.atan2(im, re) / (2 * Math.PI) : null);
  }
  /*
   * Stapjes in fase tussen buren. Een tempo dat een fractie naast zit (de
   * curve meet op ±0,5%, Bay Ledges zwalkt ±1%) laat de fase gestaag
   * doorschuiven: elke stap evenveel. Dat is nog steeds een puls. Dus
   * vergelijken we elke stap met de MEDIAAN van de stappen, niet met nul.
   */
  const wrap = (x) => x - Math.round(x);
  const stapjes = [];
  for (let i = 1; i < fasen.length; i++) {
    stapjes.push(fasen[i] === null || fasen[i - 1] === null ? null : wrap(fasen[i] - fasen[i - 1]));
  }
  const geldig = stapjes.filter((x) => x !== null);
  if (!geldig.length) return 0;
  // Circulaire mediaan-benadering: de stap waar de meeste andere dichtbij liggen.
  let drift = 0, best = -1;
  for (const c of geldig) {
    const n = geldig.filter((x) => Math.abs(wrap(x - c)) < tol).length;
    if (n > best) { best = n; drift = c; }
  }
  // Meer drift dan 0,1 periode per stap is geen tempofout meer maar een ander tempo.
  if (Math.abs(drift) > 0.1) drift = 0;
  let ok = 0;
  for (const x of stapjes) if (x !== null && Math.abs(wrap(x - drift)) < tol) ok++;
  return ok / stapjes.length;
}

/**
 * Tweede kans voor brokjes die anders wegvallen (25 september 2026).
 *
 * De tempocurve schat per venster van 12 s een tempo met autocorrelatie, en
 * op dit repertoire kiest die midden in een nummer vaak iets toevalligs: op
 * het album 148, 131, 112 en 107 in een nummer op 156. De stabiliteit wordt
 * dan op het VERKEERDE tempo gemeten, het venster telt als gat, en het nummer
 * valt uiteen in brokjes tussen gaten die segmenteer als ruis weggooit
 * (korter dan minSec, geen buur zonder gat). Zo verdween het 156-bpm-stuk
 * (album, 11:45-13:29): negen zekere vensters in vier brokjes van 4-16 s,
 * gescheiden door 16-44 s "gat", terwijl één grid op 156,0 er van 11:27 tot
 * 13:39 op ±30 ms op past (fase-stabiliteit 19-22 van de 22 stapjes).
 *
 * Dus: is een keten (ketens()) korter dan minSec, en ligt er binnen `maxBrug`
 * seconden een keten met HETZELFDE tempo T, zonder echt stuk (≥ minSec) van
 * een ander tempo ertussen, dan meten we elk venster daartussen ook op T
 * (`zekerOp(T, venster)`, geschaald zoals elk venster). Houdt de fase daar
 * vast (≥ minZekerheid, en niet slechter dan op zijn eigen tempo), dan hoort
 * het venster bij T.
 * - Alleen om een te kort brokje te redden. Twee ketens die elk lang genoeg
 *   zijn blijven gescheiden, ook als het gat ertussen op T vasthoudt: één
 *   stuk heeft één tempo en één anker, en over minuten loopt een tempo dat
 *   0,5% zwalkt een tel weg (Sakamoto 34:26-37:47: samengevoegd stond het
 *   grid tot 235 ms naast).
 * - Een gat waar de puls op T niet vasthoudt (stilte tussen twee nummers,
 *   een break zonder tel) blijft een gat en knipt zoals altijd.
 * - Octaven: een venster op de HELFT van T is dezelfde puls (album 2:10-2:18,
 *   een half-time passage op 71-75 in een stuk op 150). Dat gaat mee als de
 *   fase op T vasthoudt, ook als de halve tel nét iets beter scoort: het grid
 *   op T bevat de tellen van T/2. Een venster op het DUBBELE van T blijft
 *   altijd staan, zoals tempoUitEnvelope bij twijfel de tel kiest en niet de
 *   maat. Op een tempo dat ±1% zwalkt houdt een halve tel zijn fase beter
 *   vast (dubbele marge in ms); zonder deze regel werd het octaaffoute stuk
 *   van Bay Ledges (76 waar 153 klopt) langer en zelfs "zeker" (0,48 -> 0,72).
 *   De marge is dubbel: op de halve tel zit de schatting tot 5% naast.
 * - Alles uit de EERSTE ronde: een aangepast venster maakt geen nieuwe ketens.
 * Wijzigt `curve` ter plekke (bpm, zekerheid, `tweedeKans: true`); geeft het
 * aantal aangepaste vensters.
 */
export function tweedeKans(curve, zekerOp, { tolerantie = 0.04, minZekerheid = 0.2, minSec = 20, maxBrug = 60 } = {}) {
  const { ketens: kt, stap } = ketens(curve, { tolerantie, minZekerheid });
  const zelfde = (a, b) => Math.abs(a - b) / Math.min(a, b) <= tolerantie;
  const octaaf = (a, f, T) => !!a && Math.abs(Math.log(a * f / T)) <= 2 * tolerantie;
  const lang = (k) => k.tot - k.van + stap >= minSec;
  // Per venster de beste kandidaat: [T, z].
  const kandidaat = new Map();
  for (let a = 0; a < kt.length; a++) {
    const A = kt[a], TA = mediaanVan(A.bpms);
    let c = a + 1;
    for (; c < kt.length; c++) {
      if (kt[c].van - A.tot > maxBrug) { c = kt.length; break; }
      if (zelfde(mediaanVan(kt[c].bpms), TA)) break;
      if (lang(kt[c])) { c = kt.length; break; }      // een echt stuk van een ander tempo ertussen
    }
    if (c >= kt.length) continue;
    const C = kt[c];
    if (lang(A) && lang(C)) continue;                 // niets te redden
    const T = Math.sqrt(TA * mediaanVan(C.bpms));
    for (let i = A.idx.at(-1) + 1; i < C.idx[0]; i++) {
      if (curve[i].bpm && zelfde(curve[i].bpm, T)) continue;
      const z = zekerOp(T, curve[i]);
      if (!(kandidaat.get(i)?.[1] >= z)) kandidaat.set(i, [T, z]);
    }
  }
  let aantal = 0;
  for (const [i, [T, z]] of kandidaat) {
    const c = curve[i];
    if (octaaf(c.bpm, 0.5, T)) continue;                                   // dubbel: de tel blijft
    if (z < minZekerheid || (z < c.zekerheid && !octaaf(c.bpm, 2, T))) continue;   // half: fase op T volstaat
    Object.assign(c, { bpm: T, zekerheid: z, tweedeKans: true });
    aantal++;
  }
  return aantal;
}

/**
 * Waar valt de puls van [van, tot) op een grid (bpm, anker)? Cirkelgemiddelde
 * van de envelope (afgetopt op p95, zoals faseStabiliteit) op de fase van dat
 * grid: { fase (-0,5..0,5 tel), R (0..1: hoe duidelijk) }, of null.
 */
export function faseOpGrid(env, envRate, tijdOffset, bpm, anker, van, tot) {
  if (!(bpm > 0)) return null;
  const p = 60 / bpm;
  const fA = Math.max(0, Math.floor((van - tijdOffset) * envRate));
  const fB = Math.min(env.length, Math.floor((tot - tijdOffset) * envRate));
  if (fB - fA < envRate) return null;
  const gesorteerd = env.slice(fA, fB).sort();
  const kap = gesorteerd[Math.floor(0.95 * (gesorteerd.length - 1))] || 1e-9;
  const w = (2 * Math.PI) / (p * envRate);
  const cw = Math.cos(w), sw = Math.sin(w);
  const h0 = 2 * Math.PI * ((fA / envRate + tijdOffset - anker) / p);
  let c = Math.cos(h0), sn = Math.sin(h0), re = 0, im = 0, som = 0;
  for (let f = fA; f < fB; f++) {
    const e = env[f] < kap ? env[f] : kap;
    re += e * c; im += e * sn; som += e;
    const nc = c * cw - sn * sw; sn = c * sw + sn * cw; c = nc;
  }
  if (!(som > 0)) return null;
  return { fase: Math.atan2(im, re) / (2 * Math.PI), R: Math.hypot(re, im) / som };
}

/**
 * Past ÉÉN grid op deze vensters? De controle op de tweede kans (25 september
 * 2026, controleur).
 *
 * tweedeKans redt een venster als de fase op T daar VASTHOUDT
 * (faseStabiliteit), maar niet of hij op dezelfde PLEK ligt als bij de buren:
 * stabiliteit vergeeft een vaste drift (een tempo tot ~4 bpm naast) en een
 * sprong telt maar in een paar stapjes. Zo plakte hij een volgend nummer op
 * hetzelfde tempo in een andere fase, of 1-3% sneller, aan een stuk vast, en
 * dat stuk was "zeker": synthetisch tot 61% van de kicks een halve tel naast,
 * op Sakamoto (1:08-1:50) vensters tot 268 ms naast. Sync en beat-loops
 * vertrouwen een zeker stuk.
 *
 * Per venster (`tijd` ± `vensterSec`/2) met een duidelijke puls (R ≥ `minR`)
 * de fase op het grid; de maat is de fase waar de meeste andere dichtbij
 * liggen (een cirkel heeft geen gewone mediaan). Het grid past niet als meer
 * dan `maxAandeel` van alle vensters, of van de geredde vensters
 * (`tweedeKans`), verder dan `maxAfwijking` tel van die fase ligt. Het tweede
 * omdat een kort geplakt stuk onder de 10% van een lang stuk kan blijven.
 * Gemeten op de geredde stukken van het album (156 en 150), Bay Ledges, de
 * jungle-mix en Sakamoto: hooguit 0,12 tel naast (album 11:45, 47 ms).
 */
export function eenGridPast(env, envRate, tijdOffset, grid, vensters,
  { vensterSec = 12, minR = 0.15, maxAfwijking = 0.15, maxAandeel = 0.1 } = {}) {
  const wrap = (x) => x - Math.round(x);
  const fasen = [];
  for (const v of vensters) {
    const f = faseOpGrid(env, envRate, tijdOffset, grid.bpm, grid.anker, v.tijd - vensterSec / 2, v.tijd + vensterSec / 2);
    if (f && f.R >= minR) fasen.push({ fase: f.fase, gered: !!v.tweedeKans });
  }
  if (!fasen.length) return true;
  let ref = 0, best = -1;
  for (const { fase } of fasen) {
    const n = fasen.filter((x) => Math.abs(wrap(x.fase - fase)) <= maxAfwijking).length;
    if (n > best) { best = n; ref = fase; }
  }
  const teVeel = (lijst) => lijst.filter((x) => Math.abs(wrap(x.fase - ref)) > maxAfwijking).length > maxAandeel * lijst.length;
  return !teVeel(fasen) && !teVeel(fasen.filter((x) => x.gered));
}

/*
 * Past het grid van ELK stuk? (25 september 2026)
 *
 * segmenteer rijgt vensters op hetzelfde tempo (±4%) aaneen zonder naar de
 * fase te kijken, en de zekerheid van een stuk is de stabiliteit van zijn
 * vensters: of de fase in elk venster VASTHOUDT, niet of ze op dezelfde plek
 * ligt. Twee nummers op (bijna) hetzelfde tempo zonder duidelijk gat werden zo
 * één "zeker" stuk met één grid: synthetisch tot de helft van de kicks naast, op
 * Clay's muziek (let it all go 14:49 en 31:18, Sakamoto 28:30 en 35:59)
 * vensters tot een halve tel naast. Sync en beat-loops vertrouwen een zeker
 * stuk. Daarom krijgt elk stuk een toets zoals eenGridPast (stukPast: fase
 * per venster op het grid, strenger, met reeksen), en wat niet past wordt
 * gesplitst waar de fase verspringt (faseSprongen, verfijnGrens), of onzeker
 * (PAST_NIET). Het verloop staat in analyseerGrid.
 */

/**
 * Zoveel zekerheid krijgt een venster hooguit als het grid van zijn stuk er
 * niet op past: onder ZEKER_VANAF (0,65) en boven GEEN_PULS (0,15), allebei in
 * analyze.js. Er IS een puls, maar sync en beat-loops horen er niet op te
 * vertrouwen: onzeker. detect.test controleert dat het ertussen blijft.
 */
export const PAST_NIET = 0.5;

/** Hoeveel tel ligt een fase naast een andere (-0,5..0,5). */
const telWrap = (x) => x - Math.round(x);

/**
 * De fase waar de meeste andere binnen `marge` liggen (een cirkel heeft geen
 * gewone mediaan, en een gemiddelde van twee groepen een kwart tel uit elkaar
 * ligt precies ertussen en "past" dan op allebei). Gesorteerd en met twee
 * wijzers: n log n. Bij gelijke stand de eerste in de invoer.
 */
function modusFase(fasen, marge) {
  const n = fasen.length;
  if (!n) return 0;
  const s = fasen.map((x, i) => [telWrap(x), i]).sort((a, b) => a[0] - b[0]);
  const rond = [...s.map(([x]) => x - 1), ...s.map(([x]) => x), ...s.map(([x]) => x + 1)];
  let ref = 0, best = -1, bestI = Infinity, lo = 0, hi = 0;
  for (let k = 0; k < n; k++) {
    const x = s[k][0];
    while (rond[lo] < x - marge - 1e-12) lo++;
    while (hi < rond.length && rond[hi] <= x + marge + 1e-12) hi++;
    const aantal = Math.min(n, hi - lo);
    if (aantal > best || (aantal === best && s[k][1] < bestI)) { best = aantal; ref = fasen[s[k][1]]; bestI = s[k][1]; }
  }
  return ref;
}

/**
 * Oordeel over afwijkingen (tel van de referentie, Infinity = een ander
 * tempo), in tijdsvolgorde. Naast = verder dan `maxAfwijking`. Het past niet
 * als er te veel naast liggen, `maxReeks` op een rij, of `maxVerReeks` op een
 * rij VER naast (meer dan `ver`, een kwart tel: dat hoor je als flam).
 * Eén losse uitschieter mag altijd: in een stuk van twintig seconden (vijf
 * vensters) is dat al 20%, en een blok dat ergens anders ligt vangt de reeks.
 * De korte reeks ver naast is er voor wat maar twee vensters beslaat: een
 * ander nummer van 15 s aan het eind van een stuk van drie minuten (2 van 51,
 * een halve tel naast), of een versnelling waarin de muziek in 16 s een hele
 * tel wegloopt en daarna weer op het grid valt (Sakamoto 36:41-36:57).
 */
function oordeelVan(afwijking, { maxAfwijking = 0.1, maxAandeel = 0.1, maxReeks = 3, ver = 0.25, maxVerReeks = 2 } = {}) {
  let n = 0, reeks = 0, rij = 0, verReeks = 0, verRij = 0;
  for (const a of afwijking) {
    if (a > maxAfwijking) { n++; rij++; reeks = Math.max(reeks, rij); } else rij = 0;
    if (a > ver) { verRij++; verReeks = Math.max(verReeks, verRij); } else verRij = 0;
  }
  const past = n <= Math.max(1, maxAandeel * afwijking.length) && reeks < maxReeks && verReeks < maxVerReeks;
  return { past, n: afwijking.length, naast: n, reeks, verReeks };
}

/**
 * Per venster de fase op een grid: { tijd, fase (tel), R, anders }, op tijd
 * gesorteerd. Gemeten over `tijd` ± `vensterSec`/2, maar alleen binnen
 * [van, tot): wat buiten het stuk valt, hoort niet bij zijn grid (een venster
 * op de grens mengt anders de fase van de buren erin).
 *
 * `anders`: het venster heeft een duidelijke puls op een tempo vlak naast het
 * grid (binnen `tolerantie`, in stapjes van `tempoStap`, geen octaaf) die het
 * grid niet ziet: R daar minstens `andersFactor` keer zo groot en ≥ `minR`.
 * Een nummer 2-3% sneller schuift binnen twaalf seconden een halve tot hele tel
 * op het grid door; zijn R op het grid zakt dan onder minR, en zonder deze
 * vlag was het onzichtbaar (synthetisch: 150 schoon, dan 154 met fills).
 * Gezocht, niet het tempo van de tempocurve: die zat er op Sakamoto (36:41)
 * 2% naast (121 waar 123 de puls was, een versnelling van 16 s waarin de
 * muziek een hele tel wegloopt), en dan kwam de verhouding niet boven 1,9.
 * Gemeten op de stukken (zekerheid ≥ 0,2) van 22 fragmenten: de verhouding
 * is p50 1,01, p95 1,3; in de zekere stukken boven 1,4 met R ≥ 0,15 alleen
 * in die versnelling (1,7-2,9).
 */
export function vensterFasen(env, envRate, tijdOffset, grid, vensters,
  { vensterSec = 12, van = -Infinity, tot = Infinity, minR = 0.15, tolerantie = 0.04, andersFactor = 2, tempoStap = 0.0025 } = {}) {
  const uit = [];
  const K = Math.floor(tolerantie / tempoStap + 1e-9);
  for (const v of vensters) {
    const a = Math.max(van, v.tijd - vensterSec / 2), b = Math.min(tot, v.tijd + vensterSec / 2);
    const f = faseOpGrid(env, envRate, tijdOffset, grid.bpm, grid.anker, a, b);
    if (!f) continue;
    let anders = false;
    if (K > 0 && f.R * andersFactor <= 1) {
      const bpms = [];
      for (let k = -K; k <= K; k++) if (k) bpms.push(grid.bpm * Math.exp(k * tempoStap));
      const beste = Math.max(...pulsOpTempos(env, envRate, tijdOffset, bpms, a, b));
      anders = beste >= minR && beste >= andersFactor * f.R;
    }
    uit.push({ tijd: v.tijd, fase: f.fase, R: f.R, anders });
  }
  return uit.sort((x, y) => x.tijd - y.tijd);
}

/**
 * R (0..1, hoe duidelijk de puls is) van [van, tot) op elk tempo uit `bpms`:
 * hetzelfde als faseOpGrid(...).R, maar de afgetopte envelope maar één keer.
 */
function pulsOpTempos(env, envRate, tijdOffset, bpms, van, tot) {
  const fA = Math.max(0, Math.floor((van - tijdOffset) * envRate));
  const fB = Math.min(env.length, Math.floor((tot - tijdOffset) * envRate));
  if (fB - fA < envRate) return bpms.map(() => 0);
  const deel = env.slice(fA, fB);
  const gesorteerd = Float32Array.from(deel).sort();
  const kap = gesorteerd[Math.floor(0.95 * (gesorteerd.length - 1))] || 1e-9;
  let som = 0;
  for (let i = 0; i < deel.length; i++) { if (deel[i] > kap) deel[i] = kap; som += deel[i]; }
  if (!(som > 0)) return bpms.map(() => 0);
  return bpms.map((bpm) => {
    const w = (2 * Math.PI * bpm) / (60 * envRate);
    const cw = Math.cos(w), sw = Math.sin(w);
    let c = 1, sn = 0, re = 0, im = 0;
    for (let i = 0; i < deel.length; i++) {
      re += deel[i] * c; im += deel[i] * sn;
      const nc = c * cw - sn * sw; sn = c * sw + sn * cw; c = nc;
    }
    return Math.hypot(re, im) / som;
  });
}

/**
 * Past het grid op een stuk? Alleen vensters met een duidelijke puls tellen:
 * op het grid (R ≥ `minR`, zoals in eenGridPast) of op een tempo vlak ernaast
 * (`anders`, zie vensterFasen: die liggen altijd naast). Het past niet als
 * meer dan `maxAandeel` ervan (één mag altijd) verder dan `maxAfwijking` tel
 * van de modus ligt, als er `maxReeks` op een rij naast liggen (een ander
 * nummer van 20 s aan het eind van een stuk van drie minuten blijft onder de
 * 10%, maar is drie vensters achter elkaar), of `maxVerReeks` op een rij meer
 * dan `ver` naast (oordeelVan). Losse uitschieters (een fill, een break) zijn
 * geen reeks.
 * `maxAfwijking` is 0,1 tel, strenger dan de 0,15 van eenGridPast: de modus
 * kiest zijn plek zelf, dus ±0,15 liet een sprong van 0,3 tel binnen één stuk
 * toe, en die zat er op Clay's muziek twee keer in (let it all go 14:49-15:24
 * en 31:18-32:02: een kwart tel, 100 ms op 170). Op de 48 fragmenten bleef
 * met 0,1 elk ander zeker stuk zoals het was (de wijdste: jungle 7:48-10:40,
 * 0,14 tel van eerste tot laatste blok).
 * Geeft { past, n, naast, reeks, verReeks }.
 */
export function stukPast(fasen, { minR = 0.15, maxAfwijking = 0.1, maxAandeel = 0.1, maxReeks = 3, ver = 0.25, maxVerReeks = 2 } = {}) {
  const tel = fasen.filter((f) => f.R >= minR || f.anders);
  if (!tel.length) return { past: true, n: 0, naast: 0, reeks: 0, verReeks: 0 };
  const ref = modusFase(tel.filter((f) => !f.anders).map((f) => f.fase), maxAfwijking);
  return oordeelVan(tel.map((f) => (f.anders ? Infinity : Math.abs(telWrap(f.fase - ref)))),
    { maxAfwijking, maxAandeel, maxReeks, ver, maxVerReeks });
}

/**
 * Hoe hard loopt de muziek van het grid weg, in tel per seconde? Vensters met
 * een duidelijke puls op het grid (R ≥ `minR`, niet `anders`), op volgorde
 * uitgevouwen (elke stap hooguit een halve tel), een rechte lijn met R als
 * gewicht. Een helling b betekent: de muziek is 60·b bpm langzamer dan het
 * grid. Null onder vier vensters.
 */
export function faseHelling(fasen, { minR = 0.15, rest = false } = {}) {
  const tel = fasen.filter((f) => f.R >= minR && !f.anders).sort((a, b) => a.tijd - b.tijd);
  if (tel.length < 4) return null;
  let x = 0, vorige = null;
  const punten = tel.map((f) => {
    x = vorige === null ? f.fase : x + telWrap(f.fase - vorige);
    vorige = f.fase;
    return { t: f.tijd, x, w: f.R };
  });
  let sw = 0, st = 0, sx = 0;
  for (const p of punten) { sw += p.w; st += p.w * p.t; sx += p.w * p.x; }
  const tm = st / sw, xm = sx / sw;
  let boven = 0, onder = 0;
  for (const p of punten) { boven += p.w * (p.t - tm) * (p.x - xm); onder += p.w * (p.t - tm) ** 2; }
  if (!(onder > 0)) return null;
  const b = boven / onder;
  if (!rest) return b;
  // Met `rest`: { helling, rest } = ook de grootste afstand van een venster tot de lijn.
  return { helling: b, rest: Math.max(...punten.map((p) => Math.abs(p.x - xm - b * (p.t - tm)))) };
}

/**
 * Waar verspringt de fase? Kandidaat-grenzen voor een stuk dat niet past.
 *
 * De vensters met een duidelijke puls (R ≥ `minR`, of `anders`), met hun
 * fase op het grid van het hele stuk. Voor elke grens tussen twee vensters:
 * hoeveel vensters links plus rechts NIET in een model passen (een `anders`
 * venster nooit). Een kant korter dan `minSec` wordt geen stuk maar een rest:
 * al zijn vensters tellen, maar voor `restKosten` (de helft): een venster in
 * een rest wordt onzeker, een venster dat naast een zeker grid ligt is fout.
 * Zonder dat verschil kostte een ander nummer van 15 s aan het eind evenveel
 * als een grens 18 s te vroeg, en won de vroege. Twee modellen voor een kant:
 * - VAST: één fase (hetzelfde tempo, een andere plek: een ander nummer op
 *   hetzelfde tempo);
 * - LIJN: fase = a + b·t, een eigen tempo tot `tolerantie` ernaast (een
 *   nummerwissel op bijna hetzelfde tempo: het grid van het hele stuk is een
 *   compromis en de fase van elke kant loopt weg).
 * Een venster past als het binnen `maxAfwijking` ligt van de fase waar de
 * meeste liggen: een rond histogram met vakken van een kwart `maxAfwijking`,
 * per helling één keer van links naar rechts en één keer terug opgebouwd
 * (n × hellingen × vakken). De vorige versie rekende per grens en per helling
 * een modus uit en deed over een segment van twintig minuten 4 s.
 * Tussen de twee kanten mag een rest liggen (twee grenzen): een versnelling
 * waarin de muziek een tel wegloopt en daarna weer op het grid valt, past
 * links noch rechts, en met één grens bleef de helft ervan aan elke kant
 * hangen. Bij gelijke kosten liever één grens dan een rest.
 * Goedkoop: geen verfijning per grens, en een lijn past op een kort stuk
 * bijna altijd (ook over een sprong heen); de aanroeper toetst de kandidaten
 * met echte grids (analyseerGrid). Bij gelijke kosten de middelste grens van
 * de eerste reeks: vensters zonder puls rond een sprong tellen niet mee, dus
 * daar zijn de kosten vlak.
 * Geeft { kandidaten: [{ links, rechts, kosten, model }] (goedkoopste eerst;
 * de rest ligt tussen links en rechts, bij één grens is links = rechts),
 * heel }: `heel` = wat het beste model over alles kost, zonder grens.
 */
export function faseSprongen(fasen, van, tot, bpm, { minR = 0.15, maxAfwijking = 0.1, minSec = 20, tolerantie = 0.04,
  maxHellingen = 401, restKosten = 0.5 } = {}) {
  const tel = fasen.filter((f) => f.R >= minR || f.anders).sort((a, b) => a.tijd - b.tijd);
  const n = tel.length;
  if (n < 2) return { kandidaten: [], heel: 0 };
  const B = Math.max(8, Math.round(4 / maxAfwijking));   // vakken per tel
  const w = Math.max(1, Math.round(maxAfwijking * B));    // ± vakken
  // Hellingen (tel per seconde): een tempo tot `tolerantie` naast het grid, zo
  // fijn dat de lijn over het hele stuk hooguit maxAfwijking verschuift (en
  // niet meer dan maxHellingen).
  const bMax = tolerantie * bpm / 60;
  const stap = Math.max(2 * bMax / (maxHellingen - 1), maxAfwijking / Math.max(1, tot - van));
  const hellingen = [0];
  for (let b = stap; b <= bMax + 1e-12; b += stap) hellingen.push(b, -b);
  // Het grootste aantal in 2w+1 opeenvolgende vakken (rond).
  const meeste = (h) => {
    let s = 0;
    for (let j = -w; j <= w; j++) s += h[(j + B) % B];
    let m = s;
    for (let c = 1; c < B; c++) { s += h[(c + w) % B] - h[(c - w - 1 + B) % B]; if (s > m) m = s; }
    return m;
  };
  // Per model: links[k] = wat tel[0..k) kost, rechts[k] = wat tel[k..n) kost.
  const lijn = { links: new Float64Array(n + 1).fill(Infinity), rechts: new Float64Array(n + 1).fill(Infinity) };
  let vast = null;
  const h = new Float64Array(B);
  for (const b of hellingen) {
    const vak = tel.map((f) => (f.anders ? -1 : ((Math.floor((f.fase - b * (f.tijd - van)) * B) % B) + B) % B));
    const L = new Float64Array(n + 1), R = new Float64Array(n + 1);
    h.fill(0);
    for (let k = 1; k <= n; k++) { if (vak[k - 1] >= 0) h[vak[k - 1]]++; L[k] = k - meeste(h); }
    h.fill(0);
    for (let k = n - 1; k >= 0; k--) { if (vak[k] >= 0) h[vak[k]]++; R[k] = n - k - meeste(h); }
    for (let k = 0; k <= n; k++) { lijn.links[k] = Math.min(lijn.links[k], L[k]); lijn.rechts[k] = Math.min(lijn.rechts[k], R[k]); }
    if (b === 0) vast = { links: L, rechts: R };
  }
  const grensTijd = (k) => (tel[k - 1].tijd + tel[k].tijd) / 2;
  // Twee grenzen k1 ≤ k2: links tel[0..k1), een rest tel[k1..k2), rechts
  // tel[k2..n). De rest korter dan minSec: wat langer is kan een eigen stuk
  // zijn, en als rest (de helft per venster) was het te goedkoop (een mix
  // van twintig minuten: eerst één rest van tien minuten over drie nummers).
  const kies = ({ links, rechts }, model) => {
    const A = (k) => (grensTijd(k) - van < minSec ? restKosten * k : links[k]);
    const C = (k) => (tot - grensTijd(k) < minSec ? restKosten * (n - k) : rechts[k]);
    let beste = Infinity, gelijk = [];
    for (let k2 = 1; k2 < n; k2++) {
      // Bij gelijke stand de k1 het dichtst bij k2: liever één grens dan een rest.
      let M = Infinity, k1 = k2;
      for (let k = k2; k >= 1 && grensTijd(k2) - grensTijd(k) < minSec; k--) {
        const x = A(k) - restKosten * k;
        if (x < M - 1e-9) { M = x; k1 = k; }
      }
      const c = M + restKosten * k2 + C(k2);
      if (c < beste - 1e-9) { beste = c; gelijk = [[k1, k2]]; } else if (c < beste + 1e-9) gelijk.push([k1, k2]);
    }
    // Van de goedkoopste: de kortste rest, en daarvan de middelste van de eerste reeks.
    const kort = Math.min(...gelijk.map(([a, b]) => b - a));
    const kandidaat = gelijk.filter(([a, b]) => b - a === kort);
    let eind = 1;
    while (eind < kandidaat.length && kandidaat[eind][1] === kandidaat[eind - 1][1] + 1) eind++;
    const [a, b] = kandidaat[Math.floor((eind - 1) / 2)];
    return { links: grensTijd(a), rechts: grensTijd(b), kosten: beste, model };
  };
  const kandidaten = [kies(vast, 'vast')];
  const l = kies(lijn, 'lijn');
  if (l.links !== kandidaten[0].links || l.rechts !== kandidaten[0].rechts) kandidaten.push(l);
  return { kandidaten: kandidaten.sort((a, b) => a.kosten - b.kosten), heel: lijn.links[n] };
}

/**
 * Waar gaat grid L over in grid R? De fasen per venster zien een grens maar
 * op een venster (4 s) nauwkeurig, en bij een tempowissel is de grens op de
 * fasen alleen vaag (vlak bij de wissel passen beide). Op de envelope zelf is
 * hij scherper: de grens t in [van, tot] waarvoor L vóór t en R vanaf t samen
 * het best op de envelope passen. "Passen" is per frame de envelope (afgetopt
 * op p95, zoals faseOpGrid) maal de cosinus van de fase op dat grid: een tel
 * die raak is telt +1, een tel een halve tel naast -1, en een grid dat 40 ms
 * naast een klap ligt telt nog 0,8 op 150 bpm. Het anker van L en R is dus
 * het zwaartepunt van de envelope op dat grid (fase 0 van faseOpGrid), niet
 * per se de klap: de aanroeper verschuift het. Een eerdere versie las de
 * envelope alleen OP elke tel: een grid dat 40 ms naast lag las dan vlak naast
 * een smalle piek en vond niets, zodat de grens bij toeval ergens in het
 * bereik viel (synthetisch 16 s te laat, in het volgende nummer).
 *
 * Tussen L en R mag een REST liggen: een stuk waar geen van beide past. De
 * rest heeft geen grid, dus hij krijgt wat het BESTE grid daar zou halen (de
 * lengte van de som over `restSec` s rond elk frame, op het tempo van L of R)
 * maal `restFactor`: cos(0,15 tel). Waar de puls binnen 0,15 tel van L of R
 * ligt wint dat grid, verder de rest. Zonder R (de andere kant wordt geen
 * stuk) is alles na de grens rest; zonder L alles ervoor. Met "de rest telt
 * 0" won het toeval: een nummer 2,7% sneller schuift binnen 15 s een hele tel
 * door, en de cosinus middelt dan naar nul (de grens kwam 15 s te laat). En
 * met L en R zonder rest ertussen viel de grens bij een versnelling
 * (synthetisch: in 16 s een hele tel voor, daarna weer op het grid) ergens in
 * de versnelling, waar geen van beide past: de helft ervan zat in een zeker
 * stuk.
 * Geeft { links, rechts }: L tot links, rest tot rechts, R vanaf rechts; een
 * rest korter dan `minRest` s wordt één grens (links = rechts). Per frame (~12 ms).
 */
export function verfijnGrens(env, envRate, tijdOffset, L, R, van, tot,
  { restSec = 2, restFactor = Math.cos(2 * Math.PI * 0.15), minRest = 2 } = {}) {
  const fA = Math.max(0, Math.floor((van - tijdOffset) * envRate));
  const fB = Math.min(env.length, Math.ceil((tot - tijdOffset) * envRate));
  const n = fB - fA;
  if (n < 2 || (!L && !R)) return { links: (van + tot) / 2, rechts: (van + tot) / 2 };
  const gesorteerd = env.slice(fA, fB).sort();
  const kap = gesorteerd[Math.floor(0.95 * (gesorteerd.length - 1))] || 1e-9;
  // Per frame wat een grid haalt: envelope maal de cosinus van zijn fase.
  const winst = (g) => {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const f = fA + i, e = env[f] < kap ? env[f] : kap;
      w[i] = e * Math.cos(2 * Math.PI * (f / envRate + tijdOffset - g.anker) * g.bpm / 60);
    }
    return w;
  };
  // De rest: per frame het aandeel van de lengte van de som rond dat frame.
  const restWinst = (g) => {
    const C = new Float64Array(n + 1), S = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const f = fA + i, e = env[f] < kap ? env[f] : kap;
      const h = 2 * Math.PI * (f / envRate + tijdOffset - g.anker) * g.bpm / 60;
      C[i + 1] = C[i] + e * Math.cos(h); S[i + 1] = S[i] + e * Math.sin(h);
    }
    const half = Math.max(1, Math.round(restSec * envRate / 2));
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
      w[i] = restFactor * Math.hypot(C[hi] - C[lo], S[hi] - S[lo]) / (hi - lo);
    }
    return w;
  };
  const wM = restWinst(L || R);
  const wL = L ? winst(L) : wM, wR = R ? winst(R) : wM;
  // Grenzen i ≤ j (vóór frame i, vóór frame j): L op [0, i), rest op [i, j),
  // R op [j, n). Som = SL(i) - SM(i) + SM(j) - SR(j) + SR(n): per j de beste
  // i ≤ j bijhouden.
  let SL = 0, SM = 0, SR = 0, totR = 0;
  for (let i = 0; i < n; i++) totR += wR[i];
  let besteI = 0, besteLinks = 0;                  // max over i ≤ j van SL(i) - SM(i)
  let beste = -Infinity, iB = 0, jB = 0;
  for (let j = 0; j <= n; j++) {
    if (SL - SM > besteLinks) { besteLinks = SL - SM; besteI = j; }
    const som = besteLinks + SM - SR + totR;
    if (som > beste + 1e-12) { beste = som; iB = besteI; jB = j; }
    if (j < n) { SL += wL[j]; SM += wM[j]; SR += wR[j]; }
  }
  const tijd = (i) => Math.max(van, Math.min(tot, (fA + i) / envRate + tijdOffset));
  let links = tijd(iB), rechts = tijd(jB);
  if (L && R && rechts - links < minRest) links = rechts = (links + rechts) / 2;
  return { links, rechts };
}

/**
 * LOOPT HET GRID WEG VAN DE KLAPPEN? (14 okt, docs/BEATGRID.md §12) De
 * zekerheid van analyseerGrid is de fase-STABILITEIT per venster van 12 s
 * plus "past één grid" (stukPast): een tempo dat golft (een band zonder klik,
 * ±1-2%) middelen de vensters weg, en dan staat er een zeker stuk dat
 * tientallen ms naast de muziek ligt (benchmark: live band, 64% van de tellen
 * meer dan 0,1 tel naast, toch zeker). Dit meet het grid zelf aan de
 * onset-pieken, zoals meetGrid het aan de tellen van Beat This! doet: per
 * blok van DRIFT_BLOK pieken binnen 0,2 tel van een gridlijn de mediaan van
 * de afwijking. Een blok verder dan DRIFT_TEL tel = het grid ligt hier
 * systematisch naast. Ruim gekozen (synthetisch: schoon hooguit 0,03 tel,
 * weglopend 0,1-0,17): een zeker stuk wordt alleen onzeker als het echt
 * wegloopt; de echte tel is een paar ms, de pieken van de envelope ±15 ms.
 * @param {ArrayLike<number>} pieken  onset-pieken in tracktijd (onsetPieken), gesorteerd
 * @param {{ van: number, bpm: number, anker: number }} stuk
 * @param {number} tot  waar het stuk eindigt
 * @returns {{ n: number, afwijking: number|null }} afwijking = grootste |blokmediaan| in tellen
 */
export const DRIFT_BLOK = 16;
export const DRIFT_TEL = 0.08;
export function blokDrift(pieken, stuk, tot) {
  const L = 60 / stuk.bpm;
  const e = [];
  for (const p of pieken) {
    if (p < stuk.van || p >= tot) continue;
    const x = (p - stuk.anker) / L;
    const f = x - Math.round(x);
    if (Math.abs(f) <= 0.2) e.push(f);
  }
  if (e.length < DRIFT_BLOK) return { n: e.length, afwijking: null };
  let max = 0;
  for (let j = 0; j + DRIFT_BLOK <= e.length; j += DRIFT_BLOK >> 1) {
    const b = e.slice(j, j + DRIFT_BLOK).sort((a, c) => a - c);
    const m = Math.abs((b[(DRIFT_BLOK >> 1) - 1] + b[DRIFT_BLOK >> 1]) / 2);
    if (m > max) max = m;
  }
  return { n: e.length, afwijking: max };
}

/**
 * Het tempo van een stuk bijstellen op de onset-pieken, met de lijn bij
 * `spil` (tracktijd: waar fijneFase de fase op de voorflank zette) op zijn
 * plek: een rechte lijn door de pieken binnen 0,2 tel van een gridlijn (twee
 * keer: de tweede keer zonder wat verder dan 0,1 tel naast de eerste lijn
 * lag). Een klik van acht minuten op 128 kreeg 128,024: aan het eind 0,11 tel
 * naast (benchmark 14 okt). Geeft { bpm, anker } of null (te weinig pieken,
 * of meer dan 0,5% anders: dan is het geen kleine tempofout).
 */
export function kantelOpPieken(pieken, stuk, tot, spil) {
  let L = 60 / stuk.bpm, a = stuk.anker;
  for (const ruim of [0.2, 0.1]) {
    let n = 0, sk = 0, st = 0, skk = 0, skt = 0;
    const k0 = Math.round((spil - a) / L), t0 = a + k0 * L;
    for (const p of pieken) {
      if (p < stuk.van || p >= tot) continue;
      const x = (p - a) / L, k = Math.round(x);
      if (Math.abs(x - k) > ruim) continue;
      const u = k - k0, v = p - t0;
      n++; sk += u; st += v; skk += u * u; skt += u * v;
    }
    const d = n * skk - sk * sk;
    if (n < 2 * DRIFT_BLOK || d <= 0) return null;
    const L2 = (n * skt - sk * st) / d;        // de helling: s per tel
    // De spil blijft liggen: de lijn bij spil op dezelfde tijd, het nieuwe tempo eromheen.
    a = t0 - k0 * L2;
    L = L2;
  }
  if (Math.abs(L * stuk.bpm / 60 - 1) > 0.005) return null;
  return { bpm: 60 / L, anker: a };
}

/**
 * Een grid-voorstel voor een hele track: een lijst stukken in tracktijd,
 * [{ van, tot, bpm, anker, zekerheid }], aaneengesloten van 0 tot het einde.
 *
 * - tempo per venster (tempoCurve), zekerheid per venster = fase-stabiliteit
 *   tegen een nul (dezelfde envelope met blokken van 1 s geschud);
 * - een tweede kans voor brokjes die anders wegvallen (tweedeKans): de
 *   vensters tussen twee brokjes met hetzelfde tempo opnieuw op dat tempo;
 * - segmenteren (geen stuk over een gat), per stuk tempo en fase verfijnen;
 * - per stuk toetsen of dat ene grid past (stukPast), en zo niet: splitsen
 *   waar de fase verspringt, of onzeker (zie "Past het grid op elk stuk");
 * - wat tussen de stukken overblijft wordt ook een stuk: het tempo van de
 *   buur, het grid loopt door, maar de zekerheid is wat er gemeten wordt
 *   (bij geen puls: ~0). Onzeker betekent: niet op vertrouwen.
 *
 * Met `pcm` (mono, `sampleRate`, vanaf tracktijd 0) wordt het anker van elk
 * stuk op de voorflank bijgesteld (fijneFase), anders blijft de grove fase.
 */
export function analyseerGrid(env, envRate, tijdOffset = 0, opties = {}) {
  const { vensterSec = 12, stapSec = 4, minSec = 20, tolerantie = 0.04, minZekerheid = 0.2,
    omgeving = 20, pcm = null, sampleRate = 11025 } = opties;
  const duur = env.length / envRate + tijdOffset;
  const curve = tempoCurve(env, envRate, { vensterSec, stapSec, tijdOffset });
  /*
   * Drie nullen (drie zaden), hun vensters samen in één pot. faseStabiliteit
   * is getrapt (1/22 per stap), en de p97 van één nul viel per zaad een trap
   * hoger of lager (0,727 of 0,773 op hetzelfde album): dat schoof elke
   * zekerheid 0,1-0,2 op. Een kort nummer krijgt de nul op elk venster, niet
   * op elk derde: van drie getallen is "p97" gewoon de mediaan.
   */
  const nulEnvs = [4242, 1234, 99].map((z) => schudBlokken(env, Math.max(1, Math.round(envRate)), z, { draai: true }));

  /*
   * Zekerheid per venster: stabiliteit boven wat de nul haalt. Per venster
   * proberen we het gedetecteerde tempo én zijn verwanten (×2, ½, ×3/2,
   * ×2/3): de autocorrelatie van twaalf seconden kiest op dit repertoire vaak
   * een verwant, en de fase laat zien welke echt vasthoudt. Bij gelijke
   * stand blijft de detectie staan. De nul krijgt dezelfde keuzevrijheid.
   */
  const verwant = [1, 2, 0.5, 1.5, 2 / 3];
  const beste = (e, bpm, a, b) => {
    const eigen = faseStabiliteit(e, envRate, tijdOffset, bpm, a, b);
    let st = eigen, keus = bpm;
    for (const k of verwant.slice(1)) {
      const kb = bpm * k;
      if (kb < 60 || kb > 190) continue;
      const x = faseStabiliteit(e, envRate, tijdOffset, kb, a, b);
      // Een verwant moet DUIDELIJK beter vasthouden; half of dubbel houdt
      // bij een echte puls bijna even goed vast en wint anders op toeval.
      if (x >= eigen + 0.15 && x > st) { st = x; keus = kb; }
    }
    return { st: Math.max(eigen, st), bpm: keus };
  };
  const echt = new Float64Array(curve.length), nul = [];
  const nulStap = curve.length < 90 ? 1 : 3;
  curve.forEach((c, i) => {
    if (!c.bpm) return;
    const a = Math.max(0, c.tijd - omgeving), b = Math.min(duur, c.tijd + omgeving);
    const r = beste(env, c.bpm, a, b);
    echt[i] = r.st;
    // De nul op elk derde venster (lange tracks): genoeg voor een percentiel, een derde van het werk.
    if (i % nulStap === 0) for (const e of nulEnvs) nul.push(beste(e, c.bpm, a, b).st);
    c.bpm = r.bpm;
  });
  // De 97e percentiel van de nul: daarboven is het geen toeval meer. Een
  // vaste `nulGrens` is voor metingen op een FRAGMENT: de nul van een stuk van
  // vier minuten is niet die van het hele nummer (album: 0,77 tegen 0,82).
  const nulGrens = Number.isFinite(opties.nulGrens) ? opties.nulGrens : kwantiel(nul, 0.97);
  const schaal = (x, g) => Math.max(0, Math.min(1, (x - g) / Math.max(1e-6, 1 - g)));
  curve.forEach((c, i) => { c.autocorrelatie = c.zekerheid; c.zekerheid = schaal(echt[i], nulGrens); });

  // Tempo en fase van een segment: dezelfde verfijning voor de controle hieronder en voor het stuk zelf.
  const gridVan = (sg) => verfijnTempoFase(env, envRate, sg.bpm, tijdOffset,
    { rond: (sg.van + sg.tot) / 2, straal: Math.max(6, (sg.tot - sg.van) / 2), marge: 0.02 });

  const eerste = curve.map((c) => ({ bpm: c.bpm, zekerheid: c.zekerheid }));
  const terug = (i) => { Object.assign(curve[i], eerste[i]); delete curve[i].tweedeKans; };
  const gered = tweedeKans(curve, (bpm, c) => {
    const a = Math.max(0, c.tijd - omgeving), b = Math.min(duur, c.tijd + omgeving);
    return schaal(faseStabiliteit(env, envRate, tijdOffset, bpm, a, b), nulGrens);
  }, { tolerantie, minZekerheid, minSec });
  if (gered) {
    // Een tweede kans die geen stuk oplevert, telt niet: dan de eerste meting
    // terug, anders kleurt hij de zekerheid van een gat (Sakamoto 37:47: 0,05 -> 0,16).
    const proef = segmenteer(curve, { tolerantie, minSec, minZekerheid });
    curve.forEach((c, i) => {
      if (!c.tweedeKans) return;
      const inStuk = proef.some((sg) => c.tijd >= sg.van && c.tijd < sg.tot && Math.abs(Math.log(sg.bpm / c.bpm)) <= tolerantie);
      if (!inStuk) terug(i);
    });
    // Een tweede kans die een stuk oplevert waar niet één grid op past (twee
    // nummers in een andere fase, of net een ander tempo) telt ook niet (eenGridPast).
    for (const sg of segmenteer(curve, { tolerantie, minSec, minZekerheid })) {
      const binnen = [];
      curve.forEach((c, i) => {
        if (c.tijd >= sg.van && c.tijd < sg.tot && c.bpm && c.zekerheid >= minZekerheid
          && Math.abs(Math.log(sg.bpm / c.bpm)) <= tolerantie) binnen.push(i);
      });
      if (!binnen.some((i) => curve[i].tweedeKans)) continue;
      const r = gridVan(sg);
      if (eenGridPast(env, envRate, tijdOffset, { bpm: r.bpm, anker: r.firstBeat }, binnen.map((i) => curve[i]), { vensterSec })) continue;
      for (const i of binnen) if (curve[i].tweedeKans) terug(i);
    }
  }

  /*
   * Past het grid van elk stuk op zijn vensters (stukPast)? Een stuk dat
   * meteen past, krijgt precies het grid van vroeger. Zo niet: splitsen waar
   * de fase verspringt (faseSprongen kiest kandidaten, die worden met echte
   * grids getoetst, verfijnGrens zet de grens op de envelope), elke kant
   * opnieuw verfijnen en toetsen, en zo verder (splits, recursief). Een kant
   * korter dan minSec wordt geen stuk (te weinig om een grid op te zetten)
   * maar een REST, net als wat tussen twee kanten in geen van beide past: die
   * blijft een gat. Levert splitsen niets op, dan het grid bijstellen op de
   * helling (bijgesteld), of het stuk blijft heel en onzeker: een grid dat
   * nergens past is geen grens die je kunt aanwijzen (rubato, een tempo dat
   * zwalkt). Rest en onzeker stuk: hun vensters krijgen `pastNiet`, en tellen
   * hieronder hooguit PAST_NIET mee in de zekerheid. Daarna worden buren uit
   * hetzelfde segment die samen ook passen weer één stuk.
   * `opties.diag` (een array) krijgt onderweg wat er getoetst en besloten is,
   * en aan het eind de vensters: voor de metingen in tools/beatmeting.
   */
  const vensterOpties = { minR: 0.15, maxAfwijking: 0.1, maxAandeel: 0.1, maxReeks: 3, ver: 0.25, maxVerReeks: 2 };
  // Hoe vaak een segment hooguit doormidden gaat (2^6 = 64 delen): een mix van
  // een uur op één tempo zonder gat is één segment met tientallen nummers.
  const MAX_DIEPTE = 6;
  // Een kandidaat-grens wordt beoordeeld op hooguit zoveel seconden aan elke kant.
  const LOKAAL = 120;
  const vanDeel = (deel) => curve.filter((c) => c.tijd >= deel.van && c.tijd < deel.tot && c.bpm && c.zekerheid >= minZekerheid);
  // Een deel verfijnen en toetsen: { van, tot, bpm, r, fasen, oordeel }.
  const meet = (deel, r) => {
    const fasen = vensterFasen(env, envRate, tijdOffset, { bpm: r.bpm, anker: r.firstBeat }, vanDeel(deel),
      { vensterSec, van: deel.van, tot: deel.tot, minR: vensterOpties.minR, tolerantie });
    return { ...deel, r, fasen, oordeel: stukPast(fasen, vensterOpties) };
  };
  /*
   * Zit het grid alleen net naast het tempo, dan liggen de fasen per venster
   * op een schuine lijn: let it all go 15:06-15:45 liep met 170,27 (van
   * verfijnTempoFase) in 36 s een kwart tel weg. Dan één keer bijstellen met
   * de helling (faseHelling; daar 169,72), met de tel in het midden van het
   * stuk op zijn plek, en opnieuw toetsen; alleen overnemen als het dan past.
   * Niet opnieuw verfijnTempoFase: die koos daar binnen ±0,4% weer 170,27.
   * Maar een sprong van een kwart tel (let it all go 31:40) of een tempowissel
   * (Sakamoto 37:25) is ook "schuin", en bijgesteld paste die binnen de marge
   * op een tempo dat nergens klopte. Daarom in toets alleen als ELK venster
   * binnen de halve marge van de lijn ligt (echt een rechte lijn: Sakamoto
   * 2:28-2:49, 128,10 -> 127,29), en anders pas als splitsen niets opleverde
   * (opgegeven in splits).
   */
  const bijgesteld = (t, { recht = false } = {}) => {
    const lijn = faseHelling(t.fasen, { minR: vensterOpties.minR, rest: true });
    if (!lijn || Math.abs(lijn.helling) * (t.tot - t.van) < vensterOpties.maxAfwijking) return null;
    if (recht && lijn.rest > vensterOpties.maxAfwijking / 2) return null;
    const { bpm, firstBeat } = t.r;
    const nieuwBpm = bpm - 60 * lijn.helling;
    if (Math.abs(Math.log(nieuwBpm / bpm)) > tolerantie) return null;
    const p = 60 / bpm, midden = (t.van + t.tot) / 2;
    const x = meet(t, { bpm: nieuwBpm, firstBeat: firstBeat + Math.round((midden - firstBeat) / p) * p });
    return x.oordeel.past ? x : null;
  };
  // Een stuk dat meteen past blijft precies zoals het was (hetzelfde grid als vroeger).
  const toets = (deel) => {
    const eerste = meet(deel, gridVan(deel));
    if (eerste.oordeel.past) return eerste;
    const x = bijgesteld(eerste, { recht: true });
    if (x && Array.isArray(opties.diag)) opties.diag.push({ bijgesteld: { van: deel.van, tot: deel.tot, bpm: x.r.bpm, oud: eerste.r.bpm, recht: true } });
    return x || eerste;
  };
  // Het tempo van een kant: de mediaan van zijn vensters rond het tempo van het hele deel.
  const tempoVan = (kant, bpm) => {
    const bpms = vanDeel(kant).map((c) => c.bpm).filter((b) => Math.abs(Math.log(b / bpm)) <= tolerantie);
    return bpms.length ? mediaanVan(bpms) : bpm;
  };
  const splits = (t, diepte) => {
    const heel = [{ van: t.van, tot: t.tot, bpm: t.bpm, r: t.r, pastNiet: !t.oordeel.past }];
    if (Array.isArray(opties.diag)) opties.diag.push({ deel: { van: t.van, tot: t.tot }, diepte, oordeel: t.oordeel, bpm: t.r.bpm, anker: t.r.firstBeat, fasen: t.fasen });
    if (t.oordeel.past) return heel;
    // Niet (verder) te splitsen: het grid bijstellen (bijgesteld), of heel en onzeker.
    const opgegeven = () => {
      const x = bijgesteld(t);
      if (x && Array.isArray(opties.diag)) opties.diag.push({ bijgesteld: { van: t.van, tot: t.tot, bpm: x.r.bpm, oud: t.r.bpm } });
      return x ? [{ van: t.van, tot: t.tot, bpm: t.bpm, r: x.r, pastNiet: false }] : heel;
    };
    if (diepte >= MAX_DIEPTE) return opgegeven();
    // Elke kandidaat-grens met echte grids per kant; de grens die de meeste
    // vensters in een passend stuk brengt wint, bij gelijke stand de goedkoopste.
    // Passen bij de goedkoopste beide kanten al, dan hoeft de tweede niet.
    // Om een grens te KIEZEN telt alleen wat er vlak bij gebeurt: elke kant
    // wordt hooguit `LOKAAL` s vanaf de grens verfijnd en getoetst (proef).
    // Een segment van twintig minuten met zes nummers werd anders bij elke
    // kandidaat helemaal verfijnd; de gekozen kanten worden hieronder alsnog
    // helemaal verfijnd.
    const { kandidaten, heel: zonderGrens } = faseSprongen(t.fasen, t.van, t.tot, t.r.bpm,
      { minR: vensterOpties.minR, maxAfwijking: vensterOpties.maxAfwijking, minSec, tolerantie });
    if (Array.isArray(opties.diag)) opties.diag.push({ kand: kandidaten, heel: zonderGrens });
    let keus = null;
    for (const k of kandidaten) {
      const kanten = [{ van: t.van, tot: k.links }, { van: k.rechts, tot: t.tot }].map((kant, i) => {
        if (kant.tot - kant.van < minSec) return { ...kant, rest: true };
        // Links het stuk vlak vóór de grens, rechts het stuk vlak erna.
        const deel = i === 0 ? { van: Math.max(kant.van, kant.tot - LOKAAL), tot: kant.tot }
          : { van: kant.van, tot: Math.min(kant.tot, kant.van + LOKAAL) };
        const proef = toets({ ...deel, bpm: tempoVan(deel, t.bpm) });
        return { ...kant, proef, heel: deel.van === kant.van && deel.tot === kant.tot };
      });
      const dekking = kanten.reduce((s, x) => s + (!x.rest && x.proef.oordeel.past ? x.proef.oordeel.n : 0), 0);
      if (!keus || dekking > keus.dekking || (dekking === keus.dekking && k.kosten < keus.kosten)) keus = { kanten, dekking, kosten: k.kosten };
      if (kanten.every((x) => !x.rest && x.proef.oordeel.past)) break;
    }
    // Past geen van beide kanten, dan alleen verder splitsen als de grens echt
    // iets uitlegt (minstens twee vensters minder naast dan zonder grens): drie
    // nummers op hetzelfde tempo hebben twee grenzen, en de eerste laat aan
    // beide kanten nog een sprong over. Anders is het geen sprong maar een
    // grid dat nergens past (rubato, een tempo dat zwalkt): heel en onzeker.
    if (!keus || (keus.dekking === 0 && keus.kosten > zonderGrens - 2)) return opgegeven();
    // De grens op de envelope scherp zetten (verfijnGrens), binnen 16 s van
    // waar de vensters hem legden. Daarna BEIDE kanten over hun hele lengte
    // opnieuw verfijnen en toetsen: hun proef hoorde bij de oude grens (een
    // kant die "paste" met 4 s van het volgende nummer erbij, past op zijn
    // nieuwe plek misschien niet meer, of andersom). Alleen een proef over de
    // hele kant, met een grens die bleef staan, hoeft niet opnieuw.
    const [pa, pb] = keus.kanten;
    // Het grid van een kant, met het anker verschoven naar waar de envelope
    // er zelf op valt: het anker ligt op de klap, maar het zwaartepunt van de
    // envelope per tel ligt daar vaak een vast stuk naast (let it all go
    // 31:20: 0,2 tel), en verfijnGrens vergelijkt zwaartepunten.
    const gridVanKant = (x) => {
      if (x.rest) return null;
      const { bpm, firstBeat } = x.proef.r;
      const f = faseOpGrid(env, envRate, tijdOffset, bpm, firstBeat, x.proef.van, x.proef.tot);
      return { bpm, anker: firstBeat + (f ? f.fase : 0) * 60 / bpm };
    };
    const lo = Math.max(pa.van, pa.tot - 16), hi = Math.min(pb.tot, pb.van + 16);
    const L = gridVanKant(pa), R = gridVanKant(pb);
    // L tot `links`, een rest (waar geen van beide past) tot `rechts`, R vanaf daar.
    let { links, rechts } = verfijnGrens(env, envRate, tijdOffset, L, R, lo, hi);
    if (!L) links = rechts;
    if (!R) rechts = links;
    // Een kant die daardoor korter wordt dan minSec is een rest; worden het er
    // twee, dan blijven de grenzen waar ze waren (anders verdwijnt alles).
    const kort = (x, v, t) => x.rest || t - v < minSec;
    if (kort(pa, pa.van, links) && kort(pb, rechts, pb.tot)) { links = pa.tot; rechts = pb.van; }
    if (Array.isArray(opties.diag)) opties.diag.push({ grens: { voor: pa.tot, voorR: pb.van, links, rechts, L, R, van: lo, tot: hi } });
    const bleef = Math.abs(links - pa.tot) <= 1e-9 && Math.abs(rechts - pb.van) <= 1e-9;
    const definitief = (x, van, tot) => {
      if (kort(x, van, tot)) return { van, tot, rest: true };
      if (bleef && x.heel) return x.proef;
      return toets({ van, tot, bpm: tempoVan({ van, tot }, t.bpm) });
    };
    // Een rest in het midden die zelf lang genoeg is, kan een eigen stuk zijn
    // (een eigen tempo tussen twee nummers: Sakamoto 36:35-36:59 op 123).
    const midden = rechts - links >= minSec ? toets({ van: links, tot: rechts, bpm: tempoVan({ van: links, tot: rechts }, t.bpm) })
      : { van: links, tot: rechts, rest: true };
    const drie = [definitief(pa, pa.van, links), midden, definitief(pb, rechts, pb.tot)].filter((x) => x.tot - x.van >= 1);
    // Bleef er maar één stuk over dat bijna het hele stuk is (de grens schoof
    // tot vlak bij de rand), dan is dat het stuk zelf nog eens: klaar.
    const echte = drie.filter((x) => !x.rest);
    if (echte.length === 1 && echte[0].tot - echte[0].van > t.tot - t.van - stapSec) return opgegeven();
    const uit = [];
    for (const deel of drie) uit.push(...(deel.rest ? [deel] : splits(deel, diepte + 1)));
    return uit;
  };
  const delen = [];
  segmenteer(curve, { tolerantie, minSec, minZekerheid }).forEach((sg, s) => {
    for (const deel of splits(toets(sg), 0)) delen.push({ ...deel, segment: s });
  });
  // Twee buurdelen uit hetzelfde segment die elk passen, en samen op één grid
  // ook: weer één stuk. Splitsen kiest per stap één grens, en die ligt niet
  // altijd op de echte (synthetisch, drie nummers op 150: het middelste in
  // 100-176 en 176-200). Alleen wat hier gesplitst werd: segmenteer houdt
  // stukken met een verschillende zekerheid soms bewust apart (jungle-mix
  // 4:16, 0,56 naast 0,73), en samenvoegen zou het zwakke deel zeker maken.
  // Eerst goedkoop: liggen de twee grids bij de grens minder dan een kwart tel
  // uit elkaar, op minder dan 0,5% tempo? Pas dan het hele stuk verfijnen.
  for (let i = 0; i + 1 < delen.length; i++) {
    const a = delen[i], b = delen[i + 1];
    if (a.segment !== b.segment) continue;
    if (a.rest || b.rest || a.pastNiet || b.pastNiet || Math.abs(a.tot - b.van) > 1e-6) continue;
    if (Math.abs(Math.log(a.r.bpm / b.r.bpm)) > 0.005) continue;
    const pa = 60 / a.r.bpm, pb = 60 / b.r.bpm;
    const telA = a.r.firstBeat + Math.round((b.van - a.r.firstBeat) / pa) * pa;
    const telB = b.r.firstBeat + Math.round((b.van - b.r.firstBeat) / pb) * pb;
    if (Math.abs(telWrap((telB - telA) / pa)) > 0.25) continue;
    const samen = toets({ van: a.van, tot: b.tot, bpm: tempoVan({ van: a.van, tot: b.tot }, a.r.bpm) });
    if (Array.isArray(opties.diag)) opties.diag.push({ samen: { van: a.van, tot: b.tot, past: samen.oordeel.past } });
    if (!samen.oordeel.past) continue;
    delen.splice(i, 2, { van: a.van, tot: b.tot, bpm: samen.bpm, r: samen.r, pastNiet: false, segment: a.segment });
    i--;
  }
  /*
   * Een BREAK is geen ander nummer (controle 25 sep). Liggen de stukken vóór en
   * na een tussendeel op één doorlopend grid (hetzelfde tempo, de tellen van het
   * ene vallen op het grid van het andere), en ligt de puls in het tussendeel
   * op dat grid op de tel of precies op de offbeat (alleen hats of een bas op de
   * "en": een halve tel verder), dan loopt de maat daar gewoon door. Gesplitst
   * werd dat een eigen "zeker" stuk een halve tel naast (synthetisch: een break
   * van 60 s met alleen offbeat-hats), of een onzeker gat in een schoon nummer
   * (16-32 s); vóór de toets per stuk was het één zeker stuk met het goede grid.
   * Dus weer één stuk, met het grid door beide kanten (van tel tot tel over het
   * hele stuk: nauwkeuriger dan elke kant apart). Hooguit 32 maten (plus twee
   * stappen voor de grenzen): wat langer is kan ook een heel nummer zijn dat
   * toevallig tussen twee nummers in dezelfde fase valt (een album op precies
   * 170), en dat houdt zijn eigen grid. Een versnelling (de muziek loopt weg en
   * valt terug op het grid, V in detect.test) heeft geen vaste fase en blijft
   * wat hij was. Bekende grens: hetzelfde patroon precies een halve tel
   * verschoven tussen twee stukken op één grid wordt ook één stuk.
   */
  const doorlopend = (a, b) => {
    if (Math.abs(Math.log(a.r.bpm / b.r.bpm)) > 0.005) return null;
    const telBij = (r, t) => { const p = 60 / r.bpm; return r.firstBeat + Math.round((t - r.firstBeat) / p) * p; };
    const ta = telBij(a.r, (a.van + a.tot) / 2), tb = telBij(b.r, (b.van + b.tot) / 2);
    const N = (tb - ta) * a.r.bpm / 60, k = Math.round(N);
    if (k < 1 || Math.abs(N - k) > vensterOpties.maxAfwijking) return null;
    const g = { bpm: 60 * k / (tb - ta), anker: ta };
    if (Math.abs(Math.log(g.bpm / a.r.bpm)) > 0.005 || Math.abs(Math.log(g.bpm / b.r.bpm)) > 0.005) return null;
    // Zonder `anders` op de kanten (tolerantie 0): die zijn al getoetst, het gaat
    // hier alleen om de fase op g, en het zoeken per venster is het dure deel.
    const fasen = (x, tol) => vensterFasen(env, envRate, tijdOffset, g, vanDeel(x),
      { vensterSec, van: x.van, tot: x.tot, minR: vensterOpties.minR, tolerantie: tol });
    const kanten = [...fasen(a, 0), ...fasen(b, 0)];
    if (!stukPast(kanten, vensterOpties).past) return null;
    const refKant = modusFase(kanten.filter((f) => f.R >= vensterOpties.minR).map((f) => f.fase), vensterOpties.maxAfwijking);
    // Het tussendeel: geen venster met puls op een ander tempo, en de fase per
    // blok van stapSec (niet per venster van 12 s: bij een kort tussendeel
    // overlappen die bijna helemaal en lijkt een versnelling dan ook vast) op
    // minstens twee blokken met puls, ALLE binnen de marge van de tel van de
    // kanten, of ALLE van hun offbeat (een halve tel ernaast). Niet elke vaste
    // fase: let it all go 31:40-32:00 ligt 0,2 tel (70 ms) voor het grid van
    // de stukken eromheen, met precies hun patroon (klappen op de tel, 1/4 en
    // 1/2, alles 0,2 tel verschoven): dat is een ander grid, geen break, en
    // splitsen had daar gelijk.
    if (fasen({ van: a.tot, tot: b.van }, tolerantie).some((f) => f.anders)) return null;
    const blokken = [];
    for (let t = a.tot; b.van - t >= stapSec / 2; t += stapSec) {
      const f = faseOpGrid(env, envRate, tijdOffset, g.bpm, g.anker, t, Math.min(b.van, t + stapSec));
      if (f && f.R >= vensterOpties.minR) blokken.push(telWrap(f.fase - refKant));
    }
    if (blokken.length < 2) return null;
    const binnen = (verschuiving) => blokken.every((f) => Math.abs(telWrap(f - verschuiving)) <= vensterOpties.maxAfwijking);
    return binnen(0) || binnen(0.5) ? g : null;
  };
  // Over een segmentgrens heen (segmenteer knipte al, bv. waar de zekerheid bij
  // de break wegzakte): één stuk per segment, beide met het doorlopende grid,
  // zoals vroeger. Anders zou de zekerheid over de grens heen gemiddeld worden.
  for (let i = 0; i + 2 < delen.length; i++) {
    const a = delen[i];
    if (a.rest || a.pastNiet || Math.abs(a.tot - delen[i + 1].van) > 1e-6) continue;
    const maxTussen = 128 * 60 / a.r.bpm + 2 * stapSec;
    for (let j = i + 2; j < delen.length; j++) {
      const b = delen[j];
      if (Math.abs(delen[j - 1].tot - b.van) > 1e-6 || b.van - a.tot > maxTussen) break;
      if (b.rest || b.pastNiet) continue;
      const g = doorlopend(a, b);
      if (Array.isArray(opties.diag)) opties.diag.push({ doorlopend: { van: a.van, tussen: [a.tot, b.van], tot: b.tot, g } });
      if (!g) continue;
      const nieuw = [];
      for (const x of delen.slice(i, j + 1)) {
        if (nieuw.length && nieuw.at(-1).segment === x.segment) nieuw.at(-1).tot = x.tot;
        else nieuw.push({ van: x.van, tot: x.tot, bpm: a.bpm, r: { bpm: g.bpm, firstBeat: g.anker }, pastNiet: false, segment: x.segment });
      }
      delen.splice(i, j - i + 1, ...nieuw);
      i += nieuw.length - 2;
      break;
    }
  }
  for (const deel of delen) {
    if (deel.rest || deel.pastNiet) for (const c of curve) if (c.tijd >= deel.van && c.tijd < deel.tot) c.pastNiet = true;
  }

  const stukken = [];
  let restErvoor = false;
  for (const sg of delen) {
    if (sg.rest) { restErvoor = true; if (stukken.length) stukken.at(-1).restNa = true; continue; }
    const midden = (sg.van + sg.tot) / 2;
    const r = sg.r;
    const p = 60 / r.bpm;
    let anker = r.firstBeat + Math.ceil((sg.van - r.firstBeat) / p - 1e-9) * p;
    if (pcm) {
      const telMidden = anker + Math.round((midden - anker) / p) * p;
      const a = Math.max(0, Math.floor((telMidden - omgeving) * sampleRate));
      const b = Math.min(pcm.length, Math.ceil((telMidden + omgeving) * sampleRate));
      const f = fijneFase(pcm.subarray(a, b), sampleRate, r.bpm, telMidden, { t0: a / sampleRate });
      if (f !== null && Math.abs(f - telMidden) < 0.03) anker += f - telMidden;
    }
    stukken.push({ van: sg.van, tot: sg.tot, bpm: r.bpm, anker, restVoor: restErvoor });
    restErvoor = false;
  }
  if (!stukken.length) {
    // Nergens een puls: één onzeker stuk over alles.
    const r = tempoUitEnvelope(env, envRate);
    stukken.push({ van: 0, tot: duur, bpm: r.bpm, anker: r.bpm ? tijdOffset : null });
  }

  /*
   * Aaneensluiten. Een gat korter dan een venster is geen gat maar de rand
   * van wat de curve kan zien (het eerste venster heeft zijn midden pas op
   * 6 s): de buren schuiven er tegenaan. Langere gaten worden stukken met
   * het grid van de buur. Behalve waar een REST lag (hierboven afgesplitst
   * omdat het grid er niet past): die blijft een gat, hoe kort ook. Anders
   * schoof de buur er weer overheen (synthetisch: een versnelling van 10 s
   * tussen twee stukken, weer half in elk zeker stuk).
   */
  const heel = [];
  for (const sk of stukken) {
    const vorige = heel.at(-1);
    const t = vorige ? vorige.tot : 0;
    if (sk.van - t < vensterSec && !(sk.restVoor && sk.van - t > 1e-9)) {
      // Klein gat of overlap: de grens in het midden; aan het begin: vanaf 0.
      if (vorige) { const m = Math.max(vorige.van, (t + sk.van) / 2); vorige.tot = m; sk.van = m; } else sk.van = 0;
    } else {
      const buur = vorige || sk;
      heel.push({ van: t, tot: sk.van, bpm: buur.bpm, anker: buur.anker, gat: true });
    }
    heel.push(sk);
  }
  const laatste = heel.at(-1);
  if (duur - laatste.tot < vensterSec && !(laatste.restNa && duur - laatste.tot > 1e-9)) laatste.tot = duur;
  else heel.push({ van: laatste.tot, tot: duur, bpm: laatste.bpm, anker: laatste.anker, gat: true });

  if (Array.isArray(opties.diag)) opties.diag.push(...curve);
  // Zekerheid per stuk: het gemiddelde van de vensters waarvan het midden erin
  // valt. Een gat heeft alleen vensters onder de nul, en dus ~0. Een venster
  // waar het grid niet past (pastNiet) telt hooguit PAST_NIET: puls, geen grid.
  return heel.map((sk) => {
    const binnen = curve.filter((c) => c.tijd >= sk.van && c.tijd < sk.tot);
    const z = (c) => (c.pastNiet ? Math.min(c.zekerheid, PAST_NIET) : c.zekerheid);
    const zekerheid = binnen.length ? binnen.reduce((a, c) => a + z(c), 0) / binnen.length : 0;
    const p = sk.bpm ? 60 / sk.bpm : null;
    // Anker = eerste tel in het stuk (voor een gat: het grid van de buur doorgetrokken).
    const anker = p && sk.anker !== null ? sk.anker + Math.ceil((sk.van - sk.anker) / p - 1e-9) * p : null;
    return { van: sk.van, tot: sk.tot, bpm: sk.bpm, anker, zekerheid };
  });
}

function kwantiel(a, q) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(q * (s.length - 1))] : 0;
}
