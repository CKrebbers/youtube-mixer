/**
 * Peak-extractie: per bucket de min en max over alle kanalen.
 * 256 samples/bucket geeft bij 44.1k ~172 buckets/sec — fijn genoeg om op
 * ~1 bucket per pixel in te zoomen zonder dat je kijkt naar een blokkendoos.
 *
 * Fase 3 hangt hier de bandsplitsing (laag/mid/hoog kleuren) en de beatgrid aan.
 */
export const SAMPLES_PER_BUCKET = 256;

export function computePeaks(buffer, samplesPerBucket = SAMPLES_PER_BUCKET) {
  const n = Math.ceil(buffer.length / samplesPerBucket);
  const out = new Float32Array(n * 2);
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));

  for (let b = 0; b < n; b++) {
    const s = b * samplesPerBucket;
    const e = Math.min(s + samplesPerBucket, buffer.length);
    let mn = 1, mx = -1;
    for (const data of chans) {
      for (let i = s; i < e; i++) {
        const v = data[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    out[b * 2] = mn;
    out[b * 2 + 1] = mx;
  }
  return { peaks: out, samplesPerBucket, sampleRate: buffer.sampleRate, count: n };
}

/**
 * De samplerate waarmee de golfvorm getekend moet worden.
 *
 * Let op: dit is NIET de samplerate van de AudioBuffer. De server rekent de
 * peaks uit op 48 kHz, maar `decodeAudioData` hersamplet naar de snelheid van
 * je geluidskaart — draait die op 44,1 kHz, dan zit je er 8,8% naast en loopt
 * de golfvorm zichtbaar uit de pas met wat je hoort.
 *
 * Daarom leiden we hem af uit het aantal buckets en de echte duur. Dat klopt
 * per definitie, ongeacht wie er onderweg hersamplet.
 */
export function effectieveSampleRate(count, samplesPerBucket, duration) {
  if (!count || !duration) return 0;
  return (count * samplesPerBucket) / duration;
}

/**
 * Peaks uit een vooraf berekend bestand, gemaakt door `server/analyze.js`.
 * Zelfde formaat: per bucket een min en een max als float32 achter elkaar.
 * Geeft null terug als het bestand er niet is — dan rekent de browser het
 * alsnog zelf uit.
 *
 * `duration` is verplicht: zonder de echte duur kun je de golfvorm niet op de
 * audio leggen.
 */
export async function laadPeaks(url, { samplesPerBucket = SAMPLES_PER_BUCKET, duration } = {}) {
  if (!duration) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const peaks = new Float32Array(await res.arrayBuffer());
    if (!peaks.length || peaks.length % 2) return null;
    const count = peaks.length / 2;
    return { peaks, samplesPerBucket, count,
      sampleRate: effectieveSampleRate(count, samplesPerBucket, duration) };
  } catch {
    return null;
  }
}

/**
 * Integrated-ish loudness (RMS in dBFS) over de hele track.
 * Niet EBU R128 — dat komt in de ingest-pipeline met ffmpeg. Dit is genoeg om
 * nu al te zien dat twee bestanden 10 dB uit elkaar liggen.
 */
export function rmsDb(buffer) {
  const d = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / 200000));
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += step) { sum += d[i] * d[i]; n++; }
  return 20 * Math.log10(Math.sqrt(sum / n) + 1e-9);
}
