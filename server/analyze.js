import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';

/**
 * Golfvorm-peaks vooraf uitrekenen en op schijf zetten.
 *
 * Peaks veranderen nooit, maar opnieuw uitrekenen kost bij een halfuur audio
 * zo'n 90 miljoen samples aan werk — elke keer dat je de track op een deck
 * zet. Eén keer doen en bewaren is de hele winst.
 *
 * Het formaat is precies wat `src/analysis/peaks.js` in de browser maakt: per
 * bucket een min en een max, als float32 achter elkaar. De browser hoeft het
 * bestand dus alleen te lezen.
 */

export const PER_BUCKET = 256;   // gelijk aan SAMPLES_PER_BUCKET in de browser
const KANALEN = 2;
const SAMPLERATE = 48000;

/**
 * Het rekenwerk draait in een worker_thread, nooit op de hoofdthread.
 *
 * De server die dit uitrekent is dezelfde die de decks hun audio geeft, met
 * Range-verzoeken van ~1,4 s per keer. Blokkeert de event loop, dan staat elk
 * deck stil: gemeten 2,6 s zonder antwoord bij 12 minuten audio (onset), ~9 s
 * per album tijdens een ingest. Dat is een gat in je set.
 *
 * Eén worker per opdracht: opstarten kost ~30 ms, niets vergeleken met het
 * werk, en een worker die omvalt neemt niets mee. De functies met `Hier` erachter
 * doen het echte werk en staan in `hier`, zodat de worker ze kan aanroepen.
 *
 * `signal` (een geannuleerde ingest): de worker krijgt 'stop', killt zijn
 * eigen ffmpeg's, wacht tot ze echt weg zijn en stopt zelf. Pas dan
 * { afgebroken: true }. NIET meteen terminate(): een ffmpeg hoort bij de
 * event loop van de thread die hem startte, en alleen die roept waitpid aan.
 * Een beëindigde worker liet elke ffmpeg als <defunct> onder de server staan
 * tot die stopte (gemeten: 5× annuleren = 5 zombies). terminate() blijft de
 * noodrem na STOP_NOODREM_MS: een worker die zo lang rekent zonder de lus
 * vrij te geven (onsetEnvelope, analyseerGrid) heeft op dat moment geen
 * ffmpeg meer lopen — die zijn allemaal gelezen vóór het rekenen.
 *
 * Zonder signal (tap-verfijning, achtergrond-heranalyse, onsets) verandert
 * er niets: antwoord = klaar, en de worker stopt vanzelf.
 */
export const STOP_NOODREM_MS = 2000;
const GESTOPT = Object.freeze({ ok: false, fout: 'geannuleerd', afgebroken: true });

function inWerker(taak, args, signal = null) {
  return new Promise((klaar) => {
    let gemeld = false, w = null, stoppend = false, noodrem = null;
    const meld = (r) => {
      if (gemeld) return;
      gemeld = true;
      clearTimeout(noodrem);
      signal?.removeEventListener('abort', stop);
      klaar(r);
    };
    const stop = () => {
      if (stoppend || gemeld) return;
      stoppend = true;
      if (!w) { meld({ ...GESTOPT }); return; }
      w.postMessage('stop');
      noodrem = setTimeout(() => w.terminate().catch(() => {}), STOP_NOODREM_MS);
    };
    if (signal?.aborted) { stop(); return; }
    try {
      w = new Worker(new URL('./analyse-werker.js', import.meta.url), { workerData: { taak, args } });
    } catch (err) {
      meld({ ok: false, fout: `analyse kon niet starten: ${err?.message || err}` });
      return;
    }
    signal?.addEventListener('abort', stop, { once: true });
    // Na 'stop' telt alleen nog dat hij weg is: een antwoord dat net
    // onderweg was, is van een opdracht die niet meer bestaat.
    w.once('message', (r) => { if (!stoppend) meld(r); });
    w.once('error', (err) => { if (!stoppend) meld({ ok: false, fout: `analyse viel om: ${err?.message || err}` }); });
    w.once('exit', (code) => meld(stoppend ? { ...GESTOPT } : { ok: false, fout: `analyse stopte zonder antwoord (code ${code})` }));
  });
}

// `signal` hoort niet in de worker (niet over te zetten); de rest van de opties wel.
export const maakPeaks = (audioBestand, doel, { signal, ...opties } = {}) => inWerker('peaks', [audioBestand, doel, opties], signal);
export const maakOnset = (audioBestand, doel, { signal, ...opties } = {}) => inWerker('onset', [audioBestand, doel, opties], signal);

/**
 * Tap-verfijning op een bewaarde onset-envelope. Leest het bestand in de
 * worker: 3 uur envelope is 16 MB, die hoeft niet over de draadgrens.
 * `opties`: { rond, anker, taps, marge, audio } — zie verfijnTap in detect.js;
 * met `audio` (pad) wordt de fase op de voorflank bijgesteld.
 * Geeft { ok, bpm, firstBeat, anker, zeker, score, reden?, fijn } of { ok: false, fout }.
 */
export const verfijnUitBestand = (bestand, envRate, bpm, tijdOffset, opties = {}) =>
  inWerker('verfijn', [bestand, envRate, bpm, tijdOffset, opties]);

/**
 * Een grid-voorstel voor een hele track (stap C): analyseerGrid op de
 * bewaarde envelope, de fase per stuk op de voorflank van de audio.
 * Geeft { ok, grid } met grid = tempokaart met `bron: 'auto'`, `slot: false`
 * en per stuk een `zekerheid`; of { ok: false, fout }.
 */
export const maakGrid = (onsetBestand, envRate, tijdOffset, audio = null, { signal } = {}) =>
  inWerker('grid', [onsetBestand, envRate, tijdOffset, audio], signal);

/**
 * De onset-PIEKEN als tijden (tracktijd, s), gesorteerd. Voor "tel 1 hier"
 * dat naar de dichtstbijzijnde klap snapt, en voor de streepjes in de zoom.
 */
export const maakOnsets = (onsetBestand, envRate, tijdOffset) =>
  inWerker('onsets', [onsetBestand, envRate, tijdOffset]);

/**
 * Zekerheid vanaf waar een stuk ZEKER heet: sync en beat-loops mogen daar,
 * het grid wordt vol getekend. Zelfde getal als ZEKER_VANAF in de engine
 * (beatgrid.js); de server kent de engine niet, server.test vergelijkt ze.
 *
 * Gekozen uit de verdeling van analyseerGrid op Clay's library (23 september
 * 2026, 57 stukken in 4 tracks, na de reparatie van de nul). Drie groepen:
 *   0,00-0,06  geen puls (zoned out, pauzes, pianostukken zonder maat);
 *   0,20-0,62  wel een puls, maar één tempo houdt niet: rubato piano, Bay
 *              Ledges (demo zonder klik, ±1%), een octaaffout (76 i.p.v. 153
 *              op 0,48), de albumnummers op 140 en 150 (0,50-0,62);
 *   0,69-0,94  een vaste klik (de elektronische stukken in de Sakamoto-lijst).
 * De drempels liggen in de twee gaten: 0,65 en 0,15. Het bovenste gat is
 * smal (0,62-0,69), dus een stuk op de rand kan per analyseversie wisselen;
 * dan liever onzeker: een melding ("tik eerst") is beter dan een sync die na
 * zestien maten een tel wegloopt. Tikken zet het grid op slot.
 */
export const ZEKER_VANAF = 0.65;

/** Onder deze zekerheid: geen puls (de strook wordt rood/gestreept). */
export const GEEN_PULS = 0.15;

/*
 * Elke ffmpeg van een analyse gaat via startFfmpeg(), zodat stopAnalyse()
 * ze kan vinden. Dit is module-staat van de THREAD: in de praktijk van één
 * analyse-worker (één opdracht per worker), nooit van de hoofdthread.
 * Een nieuwe lezer (toonsoort, …) hoort hier ook doorheen, anders laat een
 * geannuleerde ingest hem weer als zombie achter.
 */
const lopend = new Map();   // kind -> belofte die afgaat als het proces weg is (waitpid gedaan)
let analyseGestopt = false;

/** ffmpeg met stdout/stderr als pijp, of null als deze thread gestopt is. Gooit als spawn gooit. */
function startFfmpeg(args) {
  if (analyseGestopt) return null;
  const kind = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  // 'exit' komt pas als libuv het proces heeft binnengehaald; 'error' als hij nooit startte.
  lopend.set(kind, new Promise((weg) => { kind.once('exit', weg); kind.once('error', weg); })
    .then(() => { lopend.delete(kind); }));
  return kind;
}

/**
 * Voor de worker, op 'stop': geen nieuwe ffmpeg meer, de lopende SIGKILL
 * (ze lezen alleen; er valt niets netjes af te sluiten) en wachten tot ze
 * binnengehaald zijn. Daarna mag de worker weg zonder zombies.
 */
export function stopAnalyse() {
  analyseGestopt = true;
  for (const kind of lopend.keys()) {
    if (kind.exitCode === null && kind.signalCode === null) { try { kind.kill('SIGKILL'); } catch {} }
  }
  return Promise.all(lopend.values());
}

/**
 * Leest de audio als ruwe floats uit ffmpeg en rekent al lezend de peaks uit.
 * Streamend, want een halfuur stereo is 712 MB aan ruwe floats — dat wil je
 * niet in één keer in het geheugen hebben staan.
 */
function maakPeaksHier(audioBestand, doel, { perBucket = PER_BUCKET } = {}) {
  return new Promise((klaar) => {
    let kind;
    try {
      kind = startFfmpeg([
        '-hide_banner', '-nostats', '-loglevel', 'error', '-i', audioBestand,
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(KANALEN), '-ar', String(SAMPLERATE), '-',
      ]);
    } catch (err) {
      klaar({ ok: false, fout: String(err?.message || err) });
      return;
    }
    if (!kind) { klaar({ ...GESTOPT }); return; }

    const uit = [];          // min/max per bucket, als we gaan
    let mn = 1, mx = -1;     // lopende min/max van de huidige bucket
    let inBucket = 0;        // frames in de huidige bucket
    let rest = Buffer.alloc(0);
    let fouten = '';

    kind.stderr.on('data', (d) => { fouten += d; });

    kind.stdout.on('data', (chunk) => {
      const data = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      // Per frame zitten er KANALEN floats; alleen hele frames verwerken.
      const perFrame = 4 * KANALEN;
      const frames = Math.floor(data.length / perFrame);
      for (let f = 0; f < frames; f++) {
        const basis = f * perFrame;
        for (let c = 0; c < KANALEN; c++) {
          const v = data.readFloatLE(basis + c * 4);
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        if (++inBucket === perBucket) {
          uit.push(mn, mx);
          mn = 1; mx = -1; inBucket = 0;
        }
      }
      rest = data.subarray(frames * perFrame);
    });

    kind.on('error', (err) => klaar({ ok: false, fout: String(err?.message || err) }));

    kind.on('close', async (code) => {
      if (code !== 0) {
        klaar({ ok: false, fout: (fouten.trim().split('\n').pop() || `ffmpeg gaf code ${code}`).slice(0, 200) });
        return;
      }
      // Laatste, onvolledige bucket telt mee — net als in de browser.
      if (inBucket > 0) uit.push(mn, mx);
      const arr = new Float32Array(uit);
      try {
        await writeFile(doel, Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
      } catch (err) {
        klaar({ ok: false, fout: `peaks niet weggeschreven: ${err?.message || err}` });
        return;
      }
      klaar({
        ok: true,
        buckets: arr.length / 2,
        perBucket,
        sampleRate: SAMPLERATE,
        bytes: arr.byteLength,
      });
    });
  });
}

/**
 * Onset-envelope uitrekenen en bewaren.
 *
 * Bewaren zodat de tap-hybride later niet opnieuw 31 minuten audio hoeft te
 * lezen: jij tikt acht tellen, de server pakt deze envelope erbij en verfijnt
 * jouw bpm tot op honderdsten. Zelfde patroon als de peaks-cache, zelfde reden.
 */
/*
 * Waarmee de onset-envelope gemaakt wordt. De tijdcorrectie hangt hiervan af
 * (onsetVertraging), dus verfijnen rekent hem met dezelfde getallen opnieuw
 * uit in plaats van het getal uit de database te vertrouwen.
 */
const ONSET_RATE = 11025, ONSET_WIN = 1024, ONSET_HOP = 128;

/** Mono floats op `sampleRate` uit ffmpeg, eventueel vanaf `van` s voor `duur` s. */
function leesPcm(audioBestand, sampleRate, { van = null, duur = null } = {}) {
  return new Promise((klaar) => {
    let kind;
    const stuk = van === null ? [] : ['-ss', String(Math.max(0, van)), '-t', String(duur)];
    try {
      kind = startFfmpeg(['-hide_banner', '-nostats', '-loglevel', 'error', ...stuk, '-i', audioBestand,
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', String(sampleRate), '-']);
    } catch { klaar(null); return; }
    // Gestopt: geen audio, dus elke lezer valt netjes af ("kon de audio niet lezen").
    if (!kind) { klaar(null); return; }
    const stukken = [];
    kind.stdout.on('data', (c) => stukken.push(c));
    kind.on('error', () => klaar(null));
    kind.on('close', (code) => {
      if (code !== 0) { klaar(null); return; }
      const b = Buffer.concat(stukken);
      klaar(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
    });
  });
}

async function maakOnsetHier(audioBestand, doel, { sampleRate = ONSET_RATE } = {}) {
  const { onsetEnvelope, normaliseerEnvelope } = await import('./detect.js');

  const pcm = await leesPcm(audioBestand, sampleRate);
  if (!pcm || !pcm.length) return { ok: false, fout: 'kon de audio niet lezen voor onset-analyse' };

  const { env, envRate, tijdOffset } = onsetEnvelope(pcm, sampleRate, { win: ONSET_WIN, hop: ONSET_HOP });
  const schoon = normaliseerEnvelope(env, envRate);
  try {
    await writeFile(doel, Buffer.from(schoon.buffer, schoon.byteOffset, schoon.byteLength));
  } catch (err) {
    return { ok: false, fout: `onset niet weggeschreven: ${err?.message || err}` };
  }
  return { ok: true, frames: schoon.length, envRate, tijdOffset, bytes: schoon.byteLength };
}

async function verfijnHier(bestand, envRate, bpm, tijdOffset, opties) {
  let env;
  try {
    const b = await readFile(bestand);
    env = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  } catch (err) {
    return { ok: false, fout: `onset-bestand onleesbaar: ${err?.message || err}` };
  }
  const { verfijnTap, onsetVertraging, fijneFase } = await import('./detect.js');
  /*
   * De tijdcorrectie opnieuw uitrekenen: in de database staat wat hij was
   * toen de envelope gemaakt werd, en de ijking is sindsdien verbeterd (23
   * september 2026: van één tik naar een reeks klanken). De envelope zelf
   * verandert daar niet door, alleen welke tijd bij een frame hoort.
   */
  if (Math.abs(envRate - ONSET_RATE / ONSET_HOP) < 1e-6) tijdOffset = onsetVertraging(ONSET_RATE, ONSET_WIN, ONSET_HOP);
  const { rond = null, anker = null, taps = null, marge = null, audio = null } = opties;
  const r = verfijnTap(env, envRate, tijdOffset, { bpm, positie: rond, anker, taps, marge });

  /*
   * De fijne fase: 24 s audio rond de tel, voorflank op een kort venster.
   * Alleen als er een puls is, en alleen een kleine bijstelling (< 30 ms):
   * de grove fase zit er hooguit ~15 ms naast, meer is een meetfout.
   */
  let fijn = null;
  if (r.zeker && audio && Number.isFinite(r.anker)) {
    const van = Math.max(0, r.anker - 12);
    const pcm = await leesPcm(audio, ONSET_RATE, { van, duur: 24 });
    const f = pcm && pcm.length ? fijneFase(pcm, ONSET_RATE, r.bpm, r.anker, { t0: van }) : null;
    if (f !== null && Math.abs(f - r.anker) < 0.03) {
      fijn = f - r.anker;
      const p = 60 / r.bpm;
      r.anker = f;
      r.firstBeat = ((f % p) + p) % p;
    }
  }
  return { ok: true, ...r, fijn };
}

async function leesEnvelope(bestand) {
  const b = await readFile(bestand);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

/** De tijdcorrectie opnieuw uitrekenen als de envelope met de standaardgetallen gemaakt is (zie verfijnHier). */
async function juisteOffset(envRate, tijdOffset) {
  const { onsetVertraging } = await import('./detect.js');
  return Math.abs(envRate - ONSET_RATE / ONSET_HOP) < 1e-6 ? onsetVertraging(ONSET_RATE, ONSET_WIN, ONSET_HOP) : tijdOffset;
}

async function maakGridHier(onsetBestand, envRate, tijdOffset, audio) {
  let env;
  try { env = await leesEnvelope(onsetBestand); } catch (err) {
    return { ok: false, fout: `onset-bestand onleesbaar: ${err?.message || err}` };
  }
  if (env.length < envRate * 15) return { ok: false, fout: 'te kort voor een grid-analyse' };
  const { analyseerGrid, fijneFase } = await import('./detect.js');
  const offset = await juisteOffset(envRate, tijdOffset);
  // Zonder pcm: een uur audio op 11025 Hz is 160 MB. De fijne fase doen we
  // hieronder per stuk, met alleen de 40 s audio die hij nodig heeft.
  const stukken = analyseerGrid(env, envRate, offset);
  if (audio) {
    for (const sk of stukken) {
      // Waar een puls is; fijneFase zegt zelf null als het profiel te vaag is.
      if (!(sk.zekerheid >= GEEN_PULS) || !sk.bpm || sk.anker === null) continue;
      const p = 60 / sk.bpm;
      const midden = (sk.van + sk.tot) / 2;
      const telMidden = sk.anker + Math.round((midden - sk.anker) / p) * p;
      const van = Math.max(0, telMidden - 20);
      const pcm = await leesPcm(audio, ONSET_RATE, { van, duur: 40 });
      const f = pcm && pcm.length ? fijneFase(pcm, ONSET_RATE, sk.bpm, telMidden, { t0: van }) : null;
      if (f !== null && Math.abs(f - telMidden) < 0.03) {
        sk.anker += f - telMidden;
        // Anker = eerste tel in het stuk, ook na het bijstellen.
        sk.anker += Math.ceil((sk.van - sk.anker) / p - 1e-9) * p;
      }
    }
  }
  const grid = {
    stukken: stukken.filter((sk) => sk.bpm > 0 && Number.isFinite(sk.anker))
      .map((sk) => ({ van: sk.van, bpm: sk.bpm, anker: sk.anker, zekerheid: sk.zekerheid })),
    beatsPerBar: 4,
    bron: 'auto',
    slot: false,
  };
  if (!grid.stukken.length) return { ok: false, fout: 'geen tempo gevonden' };
  // Het eerste stuk begint op 0: de kaart geldt vanaf het begin.
  grid.stukken[0].van = 0;
  grid.zeker = grid.stukken.some((sk) => sk.zekerheid >= ZEKER_VANAF);
  return { ok: true, grid };
}

/**
 * Pieken in de genormaliseerde envelope: lokale maxima boven een drempel.
 *
 * De envelope is al lokaal genormaliseerd (normaliseerEnvelope: mediaan eraf,
 * gedeeld door het lopende gemiddelde), dus een vaste drempel betekent overal
 * "zoveel keer boven wat hier gewoon is": een zachte passage krijgt ook zijn
 * klappen. `minAfstand` (s) houdt een roffel of een galmstaart bij één
 * streepje per aanzet; binnen die afstand wint de hoogste.
 *
 * Tijd van frame f = f / envRate + tijdOffset. Voor de envelope van de
 * ingest is dat PIEK_GEIJKT (zie piekVertraging), niet de 61 ms van de
 * tempo-analyse — zonder correctie snapt "tel 1 hier" 68 ms te vroeg.
 */
export function onsetPieken(env, envRate, tijdOffset = 0, { drempel = 2, minAfstand = 0.07 } = {}) {
  const r = Math.max(1, Math.round(minAfstand * envRate));
  const uit = [];
  let laatste = -Infinity, laatsteW = 0;
  for (let i = 1; i < env.length - 1; i++) {
    const v = env[i];
    if (v < drempel || v < env[i - 1] || v < env[i + 1]) continue;
    if (i - laatste < r) {
      // Te dicht op de vorige: de hoogste van de twee blijft.
      if (v > laatsteW) { uit[uit.length - 1] = i; laatste = i; laatsteW = v; }
      continue;
    }
    uit.push(i); laatste = i; laatsteW = v;
  }
  const tijden = new Float64Array(uit.length);
  for (let k = 0; k < uit.length; k++) tijden[k] = uit[k] / envRate + tijdOffset;
  return tijden;
}

/*
 * Waar ligt de piek van de envelope t.o.v. de echte aanzet? Niet op dezelfde
 * plek als de top van het gemiddelde telprofiel (onsetVertraging, 61 ms): een
 * losse piek valt op een frame (11,6 ms) en schuift met de klank mee. Gemeten
 * op de ijkreeks van detect.js (vijf klanken × drie aanzetten × twee
 * ruisvloeren): mediaan 68,5 ms, p10-p90 53-76 ms. Een scherpe klik valt
 * daardoor ~15 ms te vroeg, een zachte aanzet ~10 ms te laat — goed genoeg om
 * te zien waar de klappen zitten en om binnen ±30 ms naar de goede te
 * snappen; de fase daarna op de voorflank zetten doet de verfijning (±5 ms).
 * analyze.test meet opnieuw ({ meet: true }) en faalt als dit niet meer klopt.
 */
const PIEK_GEIJKT = 0.0685;
export async function piekVertraging({ meet = false } = {}) {
  if (!meet) return PIEK_GEIJKT;
  const { ijkKlanken, onsetEnvelope, normaliseerEnvelope } = await import('./detect.js');
  const medianen = [];
  for (const { x, bpm, T0 } of ijkKlanken(ONSET_RATE)) {
    const { env, envRate } = onsetEnvelope(x, ONSET_RATE, { win: ONSET_WIN, hop: ONSET_HOP, ruw: true });
    const P = 60 / bpm;
    const af = [...onsetPieken(normaliseerEnvelope(env, envRate), envRate, 0)]
      .map((t) => t - (T0 + Math.round((t - T0) / P) * P)).filter((v) => Math.abs(v) < 0.15).sort((a, b) => a - b);
    if (af.length) medianen.push(af[af.length >> 1]);
  }
  medianen.sort((a, b) => a - b);
  return -medianen[medianen.length >> 1];
}

async function maakOnsetsHier(onsetBestand, envRate, tijdOffset) {
  let env;
  try { env = await leesEnvelope(onsetBestand); } catch (err) {
    return { ok: false, fout: `onset-bestand onleesbaar: ${err?.message || err}` };
  }
  // Met de standaardgetallen gemaakt: de piekijking; anders de tijdcorrectie van het bestand.
  const standaard = Math.abs(envRate - ONSET_RATE / ONSET_HOP) < 1e-6;
  const tijden = onsetPieken(env, envRate, standaard ? PIEK_GEIJKT : tijdOffset);
  // Op de milliseconde: meer zegt een envelope van 86 frames per seconde niet.
  return { ok: true, tijden: Array.from(tijden, (t) => Math.round(t * 1000) / 1000) };
}

/** Voor de worker. Niet rechtstreeks aanroepen vanuit de server. */
export const hier = { peaks: maakPeaksHier, onset: maakOnsetHier, verfijn: verfijnHier,
  grid: maakGridHier, onsets: maakOnsetsHier };
