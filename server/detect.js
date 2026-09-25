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
 * Een grid-voorstel voor een hele track: een lijst stukken in tracktijd,
 * [{ van, tot, bpm, anker, zekerheid }], aaneengesloten van 0 tot het einde.
 *
 * - tempo per venster (tempoCurve), zekerheid per venster = fase-stabiliteit
 *   tegen een nul (dezelfde envelope met blokken van 1 s geschud);
 * - een tweede kans voor brokjes die anders wegvallen (tweedeKans): de
 *   vensters tussen twee brokjes met hetzelfde tempo opnieuw op dat tempo;
 * - segmenteren (geen stuk over een gat), per stuk tempo en fase verfijnen;
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

  const eerste = curve.map((c) => ({ bpm: c.bpm, zekerheid: c.zekerheid }));
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
      if (!inStuk) { Object.assign(c, eerste[i]); delete c.tweedeKans; }
    });
  }

  const segmenten = segmenteer(curve, { tolerantie, minSec, minZekerheid });
  const stukken = [];
  for (const sg of segmenten) {
    const midden = (sg.van + sg.tot) / 2;
    const r = verfijnTempoFase(env, envRate, sg.bpm, tijdOffset,
      { rond: midden, straal: Math.max(6, (sg.tot - sg.van) / 2), marge: 0.02 });
    const p = 60 / r.bpm;
    let anker = r.firstBeat + Math.ceil((sg.van - r.firstBeat) / p - 1e-9) * p;
    if (pcm) {
      const telMidden = anker + Math.round((midden - anker) / p) * p;
      const a = Math.max(0, Math.floor((telMidden - omgeving) * sampleRate));
      const b = Math.min(pcm.length, Math.ceil((telMidden + omgeving) * sampleRate));
      const f = fijneFase(pcm.subarray(a, b), sampleRate, r.bpm, telMidden, { t0: a / sampleRate });
      if (f !== null && Math.abs(f - telMidden) < 0.03) anker += f - telMidden;
    }
    stukken.push({ van: sg.van, tot: sg.tot, bpm: r.bpm, anker });
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
   * het grid van de buur.
   */
  const heel = [];
  for (const sk of stukken) {
    const vorige = heel.at(-1);
    const t = vorige ? vorige.tot : 0;
    if (sk.van - t < vensterSec) {
      // Klein gat of overlap: de grens in het midden; aan het begin: vanaf 0.
      if (vorige) { const m = Math.max(vorige.van, (t + sk.van) / 2); vorige.tot = m; sk.van = m; } else sk.van = 0;
    } else {
      const buur = vorige || sk;
      heel.push({ van: t, tot: sk.van, bpm: buur.bpm, anker: buur.anker, gat: true });
    }
    heel.push(sk);
  }
  const laatste = heel.at(-1);
  if (duur - laatste.tot < vensterSec) laatste.tot = duur;
  else heel.push({ van: laatste.tot, tot: duur, bpm: laatste.bpm, anker: laatste.anker, gat: true });

  // Zekerheid per stuk: het gemiddelde van de vensters waarvan het midden erin
  // valt. Een gat heeft alleen vensters onder de nul, en dus ~0.
  return heel.map((sk) => {
    const binnen = curve.filter((c) => c.tijd >= sk.van && c.tijd < sk.tot);
    const zekerheid = binnen.length ? binnen.reduce((a, c) => a + c.zekerheid, 0) / binnen.length : 0;
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
