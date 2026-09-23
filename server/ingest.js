import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { maakPeaks, maakOnset } from './analyze.js';

/**
 * De ingest-pipeline: URL erin, genormaliseerd bestand plus metadata eruit.
 *
 * Twee regels die hier alles bepalen:
 *
 * 1. Een mislukte ingest mag de app nooit meenemen in zijn val. Elke externe
 *    aanroep geeft een resultaat terug, gooit niet. yt-dlp breekt om de paar
 *    weken — dat is normaal bedrijf, geen uitzondering.
 * 2. Loudness-normalisatie is niet optioneel. YouTube-uploads liggen makkelijk
 *    15 dB uit elkaar; zonder dit klopt geen enkele crossfade.
 */

/** Versie waarop dit is getest. Wijkt de jouwe af, dan is dat een waarschuwing, geen fout. */
export const YTDLP_GETEST_OP = '2026.8.19';

/** EBU R128-doel. -14 LUFS is de streamingnorm en laat genoeg ruimte voor de mixer. */
export const LOUDNESS = { I: -14, TP: -1.5, LRA: 11 };

/**
 * Draait een commando en geeft ALTIJD een resultaat terug, ook bij een crash of
 * een ontbrekend programma. Niets hierbinnen mag de server omver trekken.
 */
export function run(cmd, args, { onLijn, timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((klaar) => {
    let kind;
    try {
      kind = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      klaar({ ok: false, code: -1, stdout: '', stderr: String(err?.message || err) });
      return;
    }
    let stdout = '', stderr = '', afgekapt = false;
    const klok = setTimeout(() => { afgekapt = true; kind.kill('SIGKILL'); }, timeout);

    kind.stdout.on('data', (d) => { stdout += d; });
    kind.stderr.on('data', (d) => {
      const tekst = String(d);
      stderr += tekst;
      if (onLijn) for (const lijn of tekst.split(/\r?\n/)) if (lijn.trim()) onLijn(lijn.trim());
    });
    kind.on('error', (err) => {
      clearTimeout(klok);
      klaar({ ok: false, code: -1, stdout, stderr: stderr + String(err?.message || err) });
    });
    kind.on('close', (code) => {
      clearTimeout(klok);
      klaar({ ok: code === 0 && !afgekapt, code, stdout, stderr, afgekapt });
    });
  });
}

/**
 * Kijkt bij PyPI of er een nieuwere yt-dlp is.
 *
 * Dit is geen luxe: YouTube verandert om de paar weken iets, en een verouderde
 * yt-dlp faalt dan met een HTTP 403 die nergens naar wijst. Beter dat de app
 * het zelf zegt dan dat je een halfuur zoekt.
 */
export async function nieuwsteVersie({ timeout = 5000 } = {}) {
  try {
    const af = AbortSignal.timeout(timeout);
    const r = await fetch('https://pypi.org/pypi/yt-dlp/json', { signal: af });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.info?.version || null;
  } catch {
    return null;    // offline of PyPI plat: geen reden om iets te blokkeren
  }
}

/**
 * Datumversies als 2026.8.19 vergelijken zonder semver-bibliotheek.
 * Let op: yt-dlp zelf zegt "2026.08.19" en PyPI "2026.8.19" — als tekst
 * ongelijk, als versie gelijk. Daarom per deel als getal vergelijken.
 */
export function gelijkeVersie(a, b) {
  const deel = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0).join('.');
  return deel(a) === deel(b);
}

export function ouderDan(a, b) {
  const deel = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [deel(a), deel(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) < (y[i] || 0)) return true;
    if ((x[i] || 0) > (y[i] || 0)) return false;
  }
  return false;
}

export async function ytdlpVersie() {
  const r = await run('yt-dlp', ['--version'], { timeout: 15000 });
  return r.ok ? r.stdout.trim() : null;
}

/** Controleert of de tooling er is voordat we iemand laten wachten. */
export async function controleerTooling() {
  const [yt, ff, fp] = await Promise.all([
    run('yt-dlp', ['--version'], { timeout: 15000 }),
    run('ffmpeg', ['-version'], { timeout: 15000 }),
    run('ffprobe', ['-version'], { timeout: 15000 }),
  ]);
  const versie = yt.ok ? yt.stdout.trim() : null;
  const nieuwste = versie ? await nieuwsteVersie() : null;
  return {
    ok: yt.ok && ff.ok && fp.ok,
    ytdlp: versie,
    nieuwsteYtdlp: nieuwste,
    verouderd: !!(versie && nieuwste && ouderDan(versie, nieuwste)),
    bijwerken: 'python3 -m pip install -U yt-dlp',
    ffmpeg: ff.ok ? (ff.stdout.split('\n')[0] || '').trim() : null,
    ffprobe: fp.ok,
    // Geen harde eis: een nieuwere yt-dlp is meestal juist wat je wilt.
    versieWijkt: versie !== null && !gelijkeVersie(versie, YTDLP_GETEST_OP),
    getestOp: YTDLP_GETEST_OP,
    ontbreekt: [!yt.ok && 'yt-dlp', !ff.ok && 'ffmpeg', !fp.ok && 'ffprobe'].filter(Boolean),
  };
}

/** Haalt alleen de metadata op. Snel, en het valideert de URL voordat we gaan downloaden. */
export async function metadata(url) {
  const r = await run('yt-dlp', [
    '--dump-single-json', '--no-playlist', '--no-warnings', url,
  ], { timeout: 90000 });
  if (!r.ok) return { ok: false, fout: kortefout(r.stderr) || `yt-dlp gaf code ${r.code}` };
  try {
    const j = JSON.parse(r.stdout);
    return {
      ok: true,
      info: {
        id: j.id, titel: j.title || j.id, uploader: j.uploader || j.channel || '',
        duur: Math.round(j.duration || 0), url: j.webpage_url || url,
        thumbnail: j.thumbnail || '', upload_datum: j.upload_date || '',
      },
    };
  } catch (err) {
    return { ok: false, fout: 'kon de metadata van yt-dlp niet lezen' };
  }
}

/** yt-dlp's foutregels zijn lang; hier de regel die er echt toe doet. */
function kortefout(stderr) {
  const lijnen = String(stderr).split(/\r?\n/).filter((l) => /^ERROR/i.test(l));
  return lijnen.length ? lijnen[0].replace(/^ERROR:\s*/i, '').slice(0, 300) : null;
}

/** Meet loudness (pass 1 van twee). Levert de waarden die pass 2 nodig heeft. */
export async function meetLoudness(bestand) {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', bestand,
    '-af', `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json`,
    '-f', 'null', '-',
  ]);
  // loudnorm schrijft zijn JSON naar stderr, achter de gewone uitvoer aan.
  const m = r.stderr.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, fout: 'loudnorm gaf geen meetwaarden terug' };
  try {
    const j = JSON.parse(m[0]);
    return {
      ok: true,
      gemeten: {
        I: parseFloat(j.input_i), TP: parseFloat(j.input_tp),
        LRA: parseFloat(j.input_lra), drempel: parseFloat(j.input_thresh),
        offset: parseFloat(j.target_offset),
      },
    };
  } catch {
    return { ok: false, fout: 'meetwaarden van loudnorm waren onleesbaar' };
  }
}

/**
 * Pass 2: normaliseren met de gemeten waarden. `linear=true` doet één vaste
 * correctie over het hele bestand in plaats van dynamisch meebewegen — dat
 * laatste zou de dynamiek van je track platdrukken.
 */
export async function normaliseer(bron, gemeten, doel) {
  const filter = `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`
    + `:measured_I=${gemeten.I}:measured_TP=${gemeten.TP}:measured_LRA=${gemeten.LRA}`
    + `:measured_thresh=${gemeten.drempel}:offset=${gemeten.offset}:linear=true:print_format=summary`;
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-y', '-i', bron,
    '-af', filter, '-ar', '48000', '-ac', '2', doel,
  ]);
  return r.ok ? { ok: true } : { ok: false, fout: `normaliseren mislukt (code ${r.code})` };
}

/**
 * Video naar constante framerate.
 *
 * `-vsync` is uit ffmpeg 9 verwijderd en heet nu `-fps_mode`. Oudere builds
 * kennen alleen `-vsync`. We proberen de nieuwe naam en vallen terug op de
 * oude, zodat dit op beide werkt zonder versiedetectie.
 */
export async function cfrTranscode(bron, doel, { fps = 30 } = {}) {
  const basis = ['-hide_banner', '-nostats', '-y', '-i', bron, '-an'];
  const staart = ['-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', doel];

  let r = await run('ffmpeg', [...basis, '-fps_mode', 'cfr', ...staart]);
  if (!r.ok && /unrecognized option .?fps_mode/i.test(r.stderr)) {
    r = await run('ffmpeg', [...basis, '-vsync', 'cfr', ...staart]);
  }
  if (r.ok) return { ok: true };
  const regel = String(r.stderr).split(/\r?\n/).filter(Boolean).pop() || `code ${r.code}`;
  return { ok: false, fout: regel.slice(0, 200) };
}

export async function duurVan(bestand) {
  const r = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', bestand,
  ], { timeout: 30000 });
  const d = parseFloat(r.stdout.trim());
  return r.ok && isFinite(d) ? d : 0;
}

const bestaat = async (p) => { try { await stat(p); return true; } catch { return false; } };

/**
 * De hele pipeline. Meldt elke stap via `onStap` zodat de UI kan meekijken, en
 * ruimt bij een mislukking zijn eigen rommel op.
 *
 * @returns {{ok:boolean, track?:object, fout?:string}}
 */
export async function ingest(url, { mediaDir = 'media', video = true, onStap = () => {} } = {}) {
  onStap({ stap: 'metadata', tekst: 'metadata ophalen' });
  const meta = await metadata(url);
  if (!meta.ok) return { ok: false, fout: meta.fout };

  const id = meta.info.id;
  const map = join(mediaDir, id);
  const tijdelijk = join(map, 'rauw');
  await mkdir(map, { recursive: true });

  try {
    // ---- audio binnenhalen -------------------------------------------------
    onStap({ stap: 'audio', tekst: `audio downloaden — ${meta.info.titel}` });
    const dl = await run('yt-dlp', [
      '-f', 'bestaudio/best', '--no-playlist', '--no-warnings',
      '-o', `${tijdelijk}.%(ext)s`, url,
    ], { onLijn: (l) => { const p = l.match(/\[download\]\s+([\d.]+)%/); if (p) onStap({ stap: 'audio', tekst: `audio downloaden ${p[1]}%`, pct: parseFloat(p[1]) }); } });
    if (!dl.ok) {
      let fout = kortefout(dl.stderr) || `download mislukt (code ${dl.code})`;
      // Een 403 betekent bijna altijd: YouTube is veranderd en yt-dlp is te oud.
      if (/403|forbidden|nsig|signature|player/i.test(fout)) {
        const t = await controleerTooling();
        if (t.verouderd) {
          fout += ` — yt-dlp is ${t.ytdlp}, nieuwste is ${t.nieuwsteYtdlp}.`
                + ` Werk hem bij met: ${t.bijwerken}`;
        }
      }
      return mislukt(map, fout);
    }

    // yt-dlp kiest zelf de extensie; zoek op welke het geworden is.
    let rauw = null;
    for (const ext of ['webm', 'm4a', 'opus', 'mp3', 'mp4', 'ogg', 'wav']) {
      if (await bestaat(`${tijdelijk}.${ext}`)) { rauw = `${tijdelijk}.${ext}`; break; }
    }
    if (!rauw) return mislukt(map, 'download gaf geen bestand dat ik terugvind');

    // ---- loudness in twee passes ------------------------------------------
    onStap({ stap: 'meten', tekst: 'loudness meten (pass 1 van 2)' });
    const meting = await meetLoudness(rauw);
    if (!meting.ok) return mislukt(map, meting.fout);

    onStap({ stap: 'normaliseren', tekst: `normaliseren naar ${LOUDNESS.I} LUFS (pass 2 van 2)` });
    const audio = join(map, 'audio.wav');
    const norm = await normaliseer(rauw, meting.gemeten, audio);
    if (!norm.ok) return mislukt(map, norm.fout);

    // ---- golfvorm vooraf uitrekenen ---------------------------------------
    // Peaks veranderen nooit. Ze elke keer opnieuw uitrekenen bij het laden is
    // pure verspilling; dit kost één keer anderhalve seconde.
    onStap({ stap: 'peaks', tekst: 'golfvorm uitrekenen' });
    const peaksBestand = join(map, 'peaks.bin');
    const pk = await maakPeaks(audio, peaksBestand);
    const peaks = pk.ok ? { bestand: peaksBestand, buckets: pk.buckets, perBucket: pk.perBucket } : null;

    // ---- onset-envelope voor de tap-hybride --------------------------------
    onStap({ stap: 'onset', tekst: 'ritme-analyse voorbereiden' });
    const onsetBestand = join(map, 'onset.bin');
    const on = await maakOnset(audio, onsetBestand);
    const onset = on.ok
      ? { bestand: onsetBestand, frames: on.frames, envRate: on.envRate, tijdOffset: on.tijdOffset }
      : null;

    // ---- video, met constante framerate -----------------------------------
    let videoBestand = null;
    let videoFout = null;
    if (video) {
      onStap({ stap: 'video', tekst: 'video downloaden' });
      const vd = await run('yt-dlp', [
        '-f', 'bestvideo[height<=720]/best[height<=720]', '--no-playlist', '--no-warnings',
        '-o', `${tijdelijk}-v.%(ext)s`, url,
      ]);
      let rauwV = null;
      for (const ext of ['mp4', 'webm', 'mkv']) {
        if (await bestaat(`${tijdelijk}-v.${ext}`)) { rauwV = `${tijdelijk}-v.${ext}`; break; }
      }
      if (!vd.ok) videoFout = kortefout(vd.stderr) || `videodownload mislukt (code ${vd.code})`;
      else if (!rauwV) videoFout = 'videodownload gaf geen bestand dat ik terugvind';
      else {
        // Constante framerate is geen franje: zonder dit loopt de A/V-sync in
        // fase 4 langzaam weg en is hij niet meer bij te sturen.
        onStap({ stap: 'video', tekst: 'video naar constante framerate' });
        videoBestand = join(map, 'video.mp4');
        const conv = await cfrTranscode(rauwV, videoBestand);
        if (!conv.ok) {
          // Video is bonus: de audio staat er al en die laten we niet vallen.
          // Maar stil falen is erger dan de fout zelf, dus hij wordt gemeld.
          videoFout = conv.fout;
          videoBestand = null;
          await rm(videoBestand ?? join(map, 'video.mp4'), { force: true }).catch(() => {});
        }
        await rm(rauwV, { force: true });
      }
      if (videoFout) onStap({ stap: 'video', tekst: `video overgeslagen — ${videoFout}` });
    }

    await rm(rauw, { force: true });
    const duur = await duurVan(audio);

    return {
      ok: true,
      track: {
        id, url: meta.info.url, titel: meta.info.titel, uploader: meta.info.uploader,
        duur, audio, video: videoBestand, videoFout, peaks, onset, thumbnail: meta.info.thumbnail,
        loudness: meting.gemeten, doelLoudness: LOUDNESS.I,
        ytdlp: await ytdlpVersie(),
      },
    };
  } catch (err) {
    // Wat hier ook misgaat: de server blijft staan.
    return mislukt(map, `onverwachte fout: ${err?.message || err}`);
  }
}

async function mislukt(map, fout) {
  try { await rm(map, { recursive: true, force: true }); } catch {}
  return { ok: false, fout };
}
