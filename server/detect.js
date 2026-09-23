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

/**
 * Onset-envelope via spectral flux: hoeveel energie komt er per frame BIJ.
 *
 * Alleen toenames tellen mee (half-wave rectified). Een afnemende toon is geen
 * aanslag; een inzet is dat wel. De logcompressie zorgt dat een zachte hi-hat
 * net zo goed meetelt als een harde kick.
 */
const vertragingCache = new Map();

/**
 * Hoeveel loopt de onset-envelope vóór op de werkelijkheid?
 *
 * Een aanslag laat de flux al stijgen zodra hij het venster BINNENKOMT, niet
 * pas als hij in het midden staat. Dat is een vaste voorsprong die van de
 * venster- en hopgrootte afhangt. In plaats van dat getal te gokken meten we
 * hem: één impuls op een bekende plek erdoorheen, kijken waar de piek landt.
 *
 * Zo blijft de correctie kloppen als iemand later aan win of hop draait.
 */
export function onsetVertraging(sampleRate, win = 1024, hop = 128) {
  const sleutel = `${sampleRate}/${win}/${hop}`;
  if (vertragingCache.has(sleutel)) return vertragingCache.get(sleutel);

  const T = win * 4;
  const x = new Float32Array(win * 8);
  for (let i = 0; i < 200; i++) {
    x[T + i] = Math.exp(-i / 40) * Math.sin((2 * Math.PI * 900 * i) / sampleRate);
  }
  const { env } = onsetEnvelope(x, sampleRate, { win, hop, ruw: true });
  let top = 1;
  for (let i = 2; i < env.length; i++) if (env[i] > env[top]) top = i;
  const v = T / sampleRate - (top * hop) / sampleRate;
  vertragingCache.set(sleutel, v);
  return v;
}

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
  { marge = 0.03, stappen = 61, rond = null, straal = 45 } = {}) {
  /*
   * Alleen scoren rond de plek waar je tikte (`rond`, tracktijd in seconden,
   * ± `straal`). Een album van een halfuur heeft zeven tempo's; over de hele
   * track scoren laat het tempo van het langste stuk winnen, niet dat van
   * wat je hoort. Zonder `rond`: de hele track, exact zoals vroeger.
   */
  let van = 0, tot = env.length;
  if (rond !== null && Number.isFinite(rond)) {
    const midden = (rond - tijdOffset) * envRate;
    van = Math.max(0, Math.floor(midden - straal * envRate));
    tot = Math.min(env.length, Math.ceil(midden + straal * envRate));
    // Te dicht bij het einde of voorbij de track: schuif het venster terug.
    if (tot - van < 2 * straal * envRate) {
      van = Math.max(0, Math.min(van, Math.floor(tot - 2 * straal * envRate)));
    }
  }
  const lees = (t) => {
    if (t < 0 || t >= env.length - 1) return 0;
    const i = Math.floor(t), f = t - i;
    return env[i] * (1 - f) + env[i + 1] * f;
  };
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
    const basis = van === 0 ? offset : van + (((offset - van) % periode) + periode) % periode;
    let score = 0;
    for (let k = 0; k < aantal; k++) score += lees(basis + k * periode);
    return score / aantal;
  };

  let beste = { bpm: bpmStart, fase: 0, score: -Infinity };
  for (let i = 0; i < stappen; i++) {
    const bpm = bpmStart * (1 + marge * (2 * i / (stappen - 1) - 1));
    const periode = (60 * envRate) / bpm;
    const fijnheid = Math.max(16, Math.round(periode * 8));
    for (let k = 0; k < fijnheid; k++) {
      const offset = (k / fijnheid) * periode;
      const sc = scoreVan(periode, offset);
      if (sc > beste.score) beste = { bpm, fase: offset, score: sc, periode };
    }
  }

  // Nog één slag, fijner, rond de winnaar.
  const grof = beste;
  for (let i = 0; i < 41; i++) {
    const bpm = grof.bpm * (1 + 0.004 * (2 * i / 40 - 1));
    const periode = (60 * envRate) / bpm;
    const rond = grof.fase;
    for (let k = -20; k <= 20; k++) {
      const offset = ((rond + (k / 20) * periode * 0.05) % periode + periode) % periode;
      const sc = scoreVan(periode, offset);
      if (sc > beste.score) beste = { bpm, fase: offset, score: sc, periode };
    }
  }

  return { bpm: beste.bpm, firstBeat: beste.fase / envRate + tijdOffset, score: beste.score };
}

/**
 * Tempo per venster: een tempocurve over de hele track.
 * Hiermee zie je waar het tempo verandert in plaats van dat je er één
 * gemiddelde overheen legt dat nergens klopt.
 */
export function tempoCurve(env, envRate, { vensterSec = 12, stapSec = 4, ...opties } = {}) {
  const venster = Math.round(vensterSec * envRate);
  const stap = Math.round(stapSec * envRate);
  const uit = [];
  for (let s = 0; s + venster <= env.length; s += stap) {
    const deel = env.subarray(s, s + venster);
    const r = tempoUitEnvelope(deel, envRate, opties);
    uit.push({ tijd: s / envRate + (opties.tijdOffset || 0), bpm: r.bpm, zekerheid: r.zekerheid });
  }
  return uit;
}

/**
 * De tempocurve opknippen in segmenten met een stabiel tempo.
 *
 * Vensters die binnen `tolerantie` procent van elkaar liggen horen bij elkaar.
 * Een segment korter dan `minSec` is ruis en wordt bij de buur gevoegd — anders
 * krijg je bij elke stilte een nieuw "tempo".
 */
export function segmenteer(curve, { tolerantie = 0.03, minSec = 20, minZekerheid = 0.30 } = {}) {
  const bruikbaar = curve.filter((p) => p.bpm && p.zekerheid >= minZekerheid);
  if (!bruikbaar.length) return [];

  const segmenten = [];
  let huidig = { van: bruikbaar[0].tijd, tot: bruikbaar[0].tijd, bpms: [bruikbaar[0].bpm], zeker: [bruikbaar[0].zekerheid] };
  const mediaanVan = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  for (let i = 1; i < bruikbaar.length; i++) {
    const p = bruikbaar[i];
    const ref = mediaanVan(huidig.bpms);
    if (Math.abs(p.bpm - ref) / ref <= tolerantie) {
      huidig.bpms.push(p.bpm); huidig.zeker.push(p.zekerheid); huidig.tot = p.tijd;
    } else {
      segmenten.push(huidig);
      huidig = { van: p.tijd, tot: p.tijd, bpms: [p.bpm], zeker: [p.zekerheid] };
    }
  }
  segmenten.push(huidig);

  // te korte segmenten opslokken
  const samen = [];
  for (const s of segmenten) {
    const duur = s.tot - s.van;
    if (duur < minSec && samen.length) {
      const vorig = samen.at(-1);
      vorig.tot = s.tot; vorig.bpms.push(...s.bpms); vorig.zeker.push(...s.zeker);
    } else samen.push(s);
  }

  return samen.map((s) => ({
    van: s.van, tot: s.tot,
    bpm: mediaanVan(s.bpms),
    zekerheid: s.zeker.reduce((a, b) => a + b, 0) / s.zeker.length,
  }));
}
