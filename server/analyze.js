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
 */
function inWerker(taak, args) {
  return new Promise((klaar) => {
    let gemeld = false;
    const meld = (r) => { if (!gemeld) { gemeld = true; klaar(r); } };
    let w;
    try {
      w = new Worker(new URL('./analyse-werker.js', import.meta.url), { workerData: { taak, args } });
    } catch (err) {
      meld({ ok: false, fout: `analyse kon niet starten: ${err?.message || err}` });
      return;
    }
    w.once('message', meld);
    w.once('error', (err) => meld({ ok: false, fout: `analyse viel om: ${err?.message || err}` }));
    w.once('exit', (code) => meld({ ok: false, fout: `analyse stopte zonder antwoord (code ${code})` }));
  });
}

export const maakPeaks = (audioBestand, doel, opties = {}) => inWerker('peaks', [audioBestand, doel, opties]);
export const maakOnset = (audioBestand, doel, opties = {}) => inWerker('onset', [audioBestand, doel, opties]);

/**
 * Tap-verfijning op een bewaarde onset-envelope. Leest het bestand in de
 * worker: 3 uur envelope is 16 MB, die hoeft niet over de draadgrens.
 * Geeft { ok, bpm, firstBeat, score } of { ok: false, fout }.
 */
export const verfijnUitBestand = (bestand, envRate, bpm, tijdOffset, opties = {}) =>
  inWerker('verfijn', [bestand, envRate, bpm, tijdOffset, opties]);

/**
 * Leest de audio als ruwe floats uit ffmpeg en rekent al lezend de peaks uit.
 * Streamend, want een halfuur stereo is 712 MB aan ruwe floats — dat wil je
 * niet in één keer in het geheugen hebben staan.
 */
function maakPeaksHier(audioBestand, doel, { perBucket = PER_BUCKET } = {}) {
  return new Promise((klaar) => {
    let kind;
    try {
      kind = spawn('ffmpeg', [
        '-hide_banner', '-nostats', '-loglevel', 'error', '-i', audioBestand,
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(KANALEN), '-ar', String(SAMPLERATE), '-',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      klaar({ ok: false, fout: String(err?.message || err) });
      return;
    }

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
async function maakOnsetHier(audioBestand, doel, { sampleRate = 11025 } = {}) {
  const { onsetEnvelope, normaliseerEnvelope } = await import('./detect.js');

  const pcm = await new Promise((klaar) => {
    let kind;
    try {
      kind = spawn('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'error', '-i', audioBestand,
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', String(sampleRate), '-'],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { klaar(null); return; }
    const stukken = [];
    kind.stdout.on('data', (c) => stukken.push(c));
    kind.on('error', () => klaar(null));
    kind.on('close', (code) => {
      if (code !== 0) { klaar(null); return; }
      const b = Buffer.concat(stukken);
      klaar(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
    });
  });
  if (!pcm || !pcm.length) return { ok: false, fout: 'kon de audio niet lezen voor onset-analyse' };

  const { env, envRate, tijdOffset } = onsetEnvelope(pcm, sampleRate);
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
  const { verfijnTempoFase } = await import('./detect.js');
  return { ok: true, ...verfijnTempoFase(env, envRate, bpm, tijdOffset, opties) };
}

/** Voor de worker. Niet rechtstreeks aanroepen vanuit de server. */
export const hier = { peaks: maakPeaksHier, onset: maakOnsetHier, verfijn: verfijnHier };
