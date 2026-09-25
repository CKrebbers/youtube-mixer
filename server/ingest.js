import { spawn } from 'node:child_process';
import { mkdir, rm, stat, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { maakPeaks, maakOnset, maakGrid } from './analyze.js';
import { normaliseerLink, bronVan, trackIdVoor, tiktokHint } from './links.js';

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
 * Welke yt-dlp. VARVE_YTDLP wijst een andere aan: de tests gebruiken een
 * nep-yt-dlp (test/nep-ytdlp.mjs) om de wachtrij en het annuleren te proberen
 * zonder één byte van internet. Bij elke aanroep gelezen, niet bij het laden.
 */
const ytdlp = () => process.env.VARVE_YTDLP || 'yt-dlp';

/** Wat een geannuleerde stap teruggeeft. */
export const GEANNULEERD = 'geannuleerd';

/**
 * Draait een commando en geeft ALTIJD een resultaat terug, ook bij een crash of
 * een ontbrekend programma. Niets hierbinnen mag de server omver trekken.
 *
 * onLijn krijgt elke niet-lege regel van stderr, onUit die van stdout (yt-dlp
 * schrijft zijn voortgang naar stdout, ffmpeg -progress ook). Een regel die
 * over twee stukken data valt wordt eerst heel gemaakt.
 *
 * signal: annuleren. Dan SIGTERM (yt-dlp en ffmpeg stoppen daar netjes op),
 * en na 3 s SIGKILL als hij er dan nog is. Het resultaat komt pas als het
 * proces echt weg is — dan pas mag de werkmap weg. { afgebroken: true }.
 */
export function run(cmd, args, { onLijn, onUit, signal, timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((klaar) => {
    if (signal?.aborted) {
      klaar({ ok: false, code: -1, stdout: '', stderr: GEANNULEERD, afgebroken: true });
      return;
    }
    let kind;
    try {
      kind = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      klaar({ ok: false, code: -1, stdout: '', stderr: String(err?.message || err) });
      return;
    }
    let stdout = '', stderr = '', afgekapt = false, afgebroken = false, hard = null;
    const klok = setTimeout(() => { afgekapt = true; kind.kill('SIGKILL'); }, timeout);
    const stop = () => {
      afgebroken = true;
      kind.kill('SIGTERM');
      hard = setTimeout(() => kind.kill('SIGKILL'), 3000);
    };
    signal?.addEventListener('abort', stop, { once: true });
    const opruimen = () => { clearTimeout(klok); clearTimeout(hard); signal?.removeEventListener('abort', stop); };

    const regels = (terug) => {
      if (!terug) return () => {};
      let rest = '';
      return (d) => {
        const delen = (rest + d).split(/\r\n|\r|\n/);
        rest = delen.pop();
        for (const lijn of delen) if (lijn.trim()) terug(lijn.trim());
      };
    };
    const uitRegel = regels(onUit), foutRegel = regels(onLijn);
    kind.stdout.on('data', (d) => { stdout += d; uitRegel(String(d)); });
    kind.stderr.on('data', (d) => { stderr += d; foutRegel(String(d)); });
    kind.on('error', (err) => {
      opruimen();
      klaar({ ok: false, code: -1, stdout, stderr: stderr + String(err?.message || err), afgebroken });
    });
    kind.on('close', (code) => {
      opruimen();
      if (onUit && stdout && !/[\r\n]$/.test(stdout)) uitRegel('\n');
      if (onLijn && stderr && !/[\r\n]$/.test(stderr)) foutRegel('\n');
      klaar({ ok: code === 0 && !afgekapt && !afgebroken, code, stdout, stderr, afgekapt, afgebroken });
    });
  });
}

/**
 * Hoe ver een yt-dlp-download is, uit één regel, of null.
 *
 * yt-dlp schrijft zijn voortgang naar STDOUT, en zonder terminal met \r
 * ertussen. Daarom `--newline` en een eigen sjabloon (VOORTGANG_SJABLOON):
 * "[varve] <binnen> <totaal> <schatting>", in bytes, NA als hij het niet weet.
 * Valt het sjabloon ooit weg, dan werkt de gewone regel ook:
 * "[download]  45.3% of 3.45MiB at ...".
 */
export const VOORTGANG_SJABLOON = ['--newline', '--progress-template',
  'download:[varve] %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s'];

export function leesDownload(lijn) {
  // eslint-disable-next-line no-control-regex
  const l = String(lijn).replace(/\x1b\[[0-9;]*m/g, '');
  const m = /^\[varve\]\s+(\S+)\s+(\S+)\s+(\S+)/.exec(l);
  if (m) {
    const binnen = Number(m[1]), totaal = Number(m[2]) || Number(m[3]);
    if (!(binnen >= 0) || !(totaal > 0)) return null;
    return Math.min(100, (binnen / totaal) * 100);
  }
  const p = /^\[download\]\s+([\d.]+)%/.exec(l);
  return p ? Math.min(100, parseFloat(p[1])) : null;
}

/**
 * Hoe ver ffmpeg is, in seconden uitvoer, uit één regel van `-progress pipe:1`,
 * of null. `out_time_us` in microseconden; `out_time_ms` is (ffmpeg-grap)
 * óók microseconden; aan het begin staat er soms N/A.
 */
export function leesFfmpegTijd(lijn) {
  const m = /^out_time_(?:us|ms)=(\d+)$/.exec(String(lijn).trim());
  return m ? Number(m[1]) / 1e6 : null;
}

/** onUit voor ffmpeg: meldt het percentage van `duur` (seconden) via onPct. */
const ffmpegVoortgang = (duur, onPct) => (duur > 0 && onPct
  ? (lijn) => { const t = leesFfmpegTijd(lijn); if (t !== null) onPct(Math.min(100, (t / duur) * 100)); }
  : undefined);

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
  const r = await run(ytdlp(), ['--version'], { timeout: 15000 });
  return r.ok ? r.stdout.trim() : null;
}

/** Controleert of de tooling er is voordat we iemand laten wachten. */
export async function controleerTooling() {
  const [yt, ff, fp] = await Promise.all([
    run(ytdlp(), ['--version'], { timeout: 15000 }),
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

/**
 * Haalt alleen de metadata op. Snel, en het valideert de URL voordat we gaan downloaden.
 *
 * Een PLAYLIST (of kanaal, album, profiel: voor yt-dlp allemaal hetzelfde)
 * wordt geweigerd: downloaden zou elk nummer erin binnenhalen, want
 * --no-playlist geldt alleen voor een link die video én lijst is.
 * --flat-playlist houdt die vraag kort: hij loopt de lijst niet af.
 */
export async function metadata(url, { signal } = {}) {
  const r = await run(ytdlp(), [
    '--dump-single-json', '--no-playlist', '--flat-playlist', '--no-warnings', url,
  ], { timeout: 90000, signal });
  if (r.afgebroken) return { ok: false, fout: GEANNULEERD, afgebroken: true };
  if (!r.ok) return { ok: false, fout: kortefout(r.stderr) || `yt-dlp gaf code ${r.code}` };
  try {
    const j = JSON.parse(r.stdout);
    if (j._type === 'playlist' || j._type === 'multi_video') {
      const n = Array.isArray(j.entries) ? j.entries.length : j.playlist_count;
      return { ok: false, playlist: true,
        fout: `dit is een playlist${n ? ` (${n} nummers)` : ''}${j.title ? ` "${String(j.title).slice(0, 80)}"` : ''}`
          + ' — plak de link van één nummer' };
    }
    // TikTok geeft als titel "TikTok video #<id>"; de beschrijving zegt meer.
    const kaal = /^TikTok video #\d+$/.test(j.title || '');
    const beschrijving = String(j.description || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return {
      ok: true,
      info: {
        id: j.id, extractor: j.extractor_key || j.extractor || '',
        titel: (kaal && beschrijving) || j.title || j.id, uploader: j.uploader || j.channel || '',
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

/**
 * Meet loudness (pass 1 van twee). Levert de waarden die pass 2 nodig heeft.
 * Met `duur` (s) en `onPct` meldt hij hoe ver hij is (ffmpeg -progress).
 */
export async function meetLoudness(bestand, { signal, duur = 0, onPct } = {}) {
  const r = await run('ffmpeg', [
    // -vn: bij een eigen videobestand decodeerde de null-uitvoer anders ook
    // het hele beeld, twee keer (per pass) — voor een 4K-video minuten werk.
    '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', bestand, '-vn', '-sn', '-dn',
    '-af', `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json`,
    '-f', 'null', '-',
  ], { signal, onUit: ffmpegVoortgang(duur, onPct) });
  if (r.afgebroken) return { ok: false, fout: GEANNULEERD, afgebroken: true };
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
export async function normaliseer(bron, gemeten, doel, { signal, duur = 0, onPct } = {}) {
  const filter = `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`
    + `:measured_I=${gemeten.I}:measured_TP=${gemeten.TP}:measured_LRA=${gemeten.LRA}`
    + `:measured_thresh=${gemeten.drempel}:offset=${gemeten.offset}:linear=true:print_format=summary`;
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', bron,
    // pcm_s16le expliciet: de streamende bron leest dit formaat rechtstreeks
    // van schijf, met Range-verzoeken. Een ander formaat zou hij weigeren.
    '-vn', '-sn', '-dn', '-af', filter, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', doel,
  ], { signal, onUit: ffmpegVoortgang(duur, onPct) });
  if (r.afgebroken) return { ok: false, fout: GEANNULEERD, afgebroken: true };
  return r.ok ? { ok: true } : { ok: false, fout: `normaliseren mislukt (code ${r.code})` };
}

/**
 * Video naar constante framerate.
 *
 * `-vsync` is uit ffmpeg 9 verwijderd en heet nu `-fps_mode`. Oudere builds
 * kennen alleen `-vsync`. We proberen de nieuwe naam en vallen terug op de
 * oude, zodat dit op beide werkt zonder versiedetectie.
 */
export async function cfrTranscode(bron, doel, { fps = 30, signal, duur = 0, onPct } = {}) {
  const basis = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', '-i', bron, '-an', '-sn', '-dn'];
  // Hooguit 720 op de KORTE kant (1280×720 liggend, 720×1280 staand), even
  // afmetingen (yuv420p eist dat). YouTube levert al ≤720, daar verandert
  // niets; een eigen 4K-video of een staande 1080×1920 wordt kleiner, zodat
  // acht lagen tegelijk te decoderen blijven.
  const schaal = "scale=w='if(gte(iw,ih),-2,2*trunc(min(720,iw)/2))':h='if(gte(iw,ih),2*trunc(min(720,ih)/2),-2)'";
  const staart = ['-vf', schaal, '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', doel];

  const opties = { signal, onUit: ffmpegVoortgang(duur, onPct) };
  let r = await run('ffmpeg', [...basis, '-fps_mode', 'cfr', ...staart], opties);
  if (!r.ok && /unrecognized option .?fps_mode/i.test(r.stderr)) {
    r = await run('ffmpeg', [...basis, '-vsync', 'cfr', ...staart], opties);
  }
  if (r.afgebroken) return { ok: false, fout: GEANNULEERD, afgebroken: true };
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
 * yt-dlp-formaat voor het beeld. `-S res:720` sorteert op de KLEINSTE kant:
 * 1280×720 liggend, maar ook 720×1280 staand. `[height<=720]` gaf op een
 * staande TikTok (576×1024 of groter) niets, en dan kwam er geen video.
 */
export const VIDEO_FORMAAT = ['-f', 'bv/b', '-S', 'res:720'];

/**
 * Een werkmap voor één ingest. Pas bij succes gaat het naar media/<id>/:
 * een mislukte HERHAALDE download gooide anders de goede, al bestaande
 * track weg, en twee ingests van hetzelfde nummer schreven door elkaar.
 */
export async function werkmap(mediaDir, id) {
  const map = join(mediaDir, `.bezig-${id}-${randomBytes(4).toString('hex')}`);
  await mkdir(map, { recursive: true });
  return map;
}

/**
 * De stappen van de pijplijn in volgorde, zoals onStap ze noemt. De wachtrij
 * geeft ze mee aan de browser, die er een strookje van maakt (stap 3 van 8).
 * Een link begint met metadata en downloaden; een eigen bestand niet.
 */
export function stappenVoor({ link = true, video = true } = {}) {
  return [...(link ? ['metadata', 'audio'] : []), 'meten', 'normaliseren', 'peaks', 'onset', 'grid', ...(video ? ['video'] : [])];
}

/**
 * Annuleren binnen de pijplijn. Elke stap begint met een melding; is er dan
 * geannuleerd, dan gooit `stap()` STOP en vangt verwerk() dat zelf op — naar
 * buiten gooit de ingest nog steeds nooit. Een lopend yt-dlp of ffmpeg stopt
 * via het signal in run(), een analyse-worker via terminate().
 * Voortgang binnen een stap (percentages) gaat NIET via stap(): die komt uit
 * een event-handler, en een throw daar zou de server raken.
 */
const STOP = Symbol('geannuleerd');
const stapper = (onStap, signal) => (s) => { if (signal?.aborted) throw STOP; onStap(s); };
/** Geannuleerd en niet gelukt: altijd dezelfde uitkomst, wat de stap ook zei. */
const alsGeannuleerd = (r, signal) => (signal?.aborted && !r.ok ? { ok: false, fout: GEANNULEERD, afgebroken: true } : r);

/**
 * De hele pipeline voor een link. Meldt elke stap via `onStap` zodat de UI
 * kan meekijken, en ruimt bij een mislukking zijn eigen rommel op.
 *
 * signal: annuleren (zie STOP). bestaat(id): staat dit nummer al in de library
 * (met zijn audio)? Dan niets downloaden: { ok: true, bestond: true, track }.
 * Dat is de tweede controle op dubbel; de eerste (op de link) doet de server
 * al vóór de wachtrij, maar een willekeurige site kent zijn id pas hier.
 *
 * @returns {{ok:boolean, track?:object, fout?:string, bestond?:boolean, playlist?:boolean, afgebroken?:boolean}}
 */
export async function ingest(url, { mediaDir = 'media', video = true, onStap = () => {}, signal, bestaat: bestaatAl = null } = {}) {
  const link = normaliseerLink(url) ?? url;
  const tiktok = bronVan(link) === 'tiktok';
  const metHint = (fout) => {
    const hint = tiktok ? tiktokHint(fout) : null;
    return hint ? `${hint} (${fout})` : fout;
  };
  const stap = stapper(onStap, signal);
  const opVoortgang = (s) => (lijn) => {
    const pct = leesDownload(lijn);
    if (pct !== null) onStap({ ...s, pct });
  };

  if (signal?.aborted) return alsGeannuleerd({ ok: false }, signal);
  onStap({ stap: 'metadata', tekst: 'metadata ophalen' });
  const meta = await metadata(link, { signal });
  if (!meta.ok) return alsGeannuleerd({ ok: false, fout: metHint(meta.fout), ...(meta.playlist ? { playlist: true } : {}) }, signal);

  // De id wordt een mapnaam. yt-dlp maakt hem bij sommige sites uit de URL
  // (de generic extractor: unquote(basename)), dus "../../x" is mogelijk —
  // en bij een mislukking volgde dan een rm -rf buiten media/. Alleen veilige ids.
  const id = trackIdVoor(meta.info);
  if (!id) {
    return { ok: false, fout: `onbruikbare video-id ${JSON.stringify(meta.info.id)} — alleen letters, cijfers, - en _` };
  }
  // Al binnen (via een andere link naar hetzelfde nummer)? Dan niet nog eens.
  const al = bestaatAl ? await bestaatAl(id) : null;
  if (al) return { ok: true, bestond: true, track: al };
  if (signal?.aborted) return alsGeannuleerd({ ok: false }, signal);

  const map = await werkmap(mediaDir, id);
  const tijdelijk = join(map, 'rauw');

  const haalAudio = async () => {
    // De titel is een eigen veld: de strook zet hem vooraan, niet in elke stap.
    const s = { stap: 'audio', tekst: 'audio downloaden' };
    stap({ ...s, titel: meta.info.titel });
    const dl = await run(ytdlp(), [
      '-f', 'bestaudio/best', '--no-playlist', '--no-warnings', ...VOORTGANG_SJABLOON,
      '-o', `${tijdelijk}.%(ext)s`, link,
    ], { signal, onUit: opVoortgang(s), onLijn: opVoortgang(s) });
    if (dl.afgebroken) return { ok: false, fout: GEANNULEERD };
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
      return { ok: false, fout: metHint(fout) };
    }
    // yt-dlp kiest zelf de extensie; zoek op welke het geworden is.
    for (const ext of ['webm', 'm4a', 'opus', 'mp3', 'mp4', 'ogg', 'wav']) {
      if (await bestaat(`${tijdelijk}.${ext}`)) return { ok: true, pad: `${tijdelijk}.${ext}` };
    }
    return { ok: false, fout: 'download gaf geen bestand dat ik terugvind' };
  };

  const haalVideo = async () => {
    const s = { stap: 'video', tekst: 'video downloaden' };
    stap(s);
    const vd = await run(ytdlp(), [
      ...VIDEO_FORMAAT, '--no-playlist', '--no-warnings', ...VOORTGANG_SJABLOON,
      '-o', `${tijdelijk}-v.%(ext)s`, link,
    ], { signal, onUit: opVoortgang(s), onLijn: opVoortgang(s) });
    if (vd.afgebroken) return { fout: GEANNULEERD };
    if (!vd.ok) return { fout: kortefout(vd.stderr) || `videodownload mislukt (code ${vd.code})` };
    for (const ext of ['mp4', 'webm', 'mkv']) {
      if (await bestaat(`${tijdelijk}-v.${ext}`)) return { pad: `${tijdelijk}-v.${ext}` };
    }
    return { fout: 'videodownload gaf geen bestand dat ik terugvind' };
  };

  return alsGeannuleerd(await verwerk({
    id, map, onStap, signal, haalAudio, haalVideo: video ? haalVideo : null,
    info: { url: meta.info.url, titel: meta.info.titel, uploader: meta.info.uploader, thumbnail: meta.info.thumbnail, duur: meta.info.duur },
    ytdlp: true,
  }, mediaDir), signal);
}

/**
 * Een eigen bestand (de upload) door DEZELFDE pipeline: loudness, audio.wav,
 * peaks, onset, grid en — als er beeld in zit — video.mp4. `bron` staat al in
 * de werkmap `map` (de upload schreef hem daar), en verdwijnt met de werkmap.
 *
 * @param bron  pad naar het bestand, binnen `map`
 * @param opties.info  { url, titel, uploader } — url is "bestand:…", geen pad
 * @param opties.heeftVideo  uit `onderzoek()`: een echt videospoor, geen hoesje
 */
export async function ingestBestand(bron, { id, map, info, heeftVideo = false, video = true, mediaDir = 'media', onStap = () => {}, signal }) {
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) {
    await rm(map, { recursive: true, force: true }).catch(() => {});
    return { ok: false, fout: `onbruikbare id ${JSON.stringify(id)}` };
  }
  return alsGeannuleerd(await verwerk({
    id, map, onStap, signal,
    haalAudio: async () => ({ ok: true, pad: bron }),
    haalVideo: video && heeftVideo ? async () => ({ pad: bron }) : null,
    info: { thumbnail: '', uploader: '', ...info },
    ytdlp: false,
  }, mediaDir), signal);
}

/**
 * Wat er in een bestand zit, volgens ffprobe. Zo weet de upload dat het echt
 * media is voordat de ingest begint, en of er beeld in zit.
 *
 * Een hoesje in een mp3 of m4a is voor ffprobe ook een "video"-spoor (met
 * disposition attached_pic). Dat telt hier NIET als beeld: anders werd één
 * plaatje een video van een uur.
 *
 * @returns {{ok:true, audio:boolean, video:boolean, duur:number, breedte, hoogte, tags}|{ok:false, fout:string}}
 */
export async function onderzoek(bestand) {
  const r = await run('ffprobe', [
    '-v', 'error', '-show_entries',
    'format=duration,format_name:format_tags=title,artist:stream=codec_type,codec_name,width,height:stream_disposition=attached_pic',
    '-of', 'json', bestand,
  ], { timeout: 60000 });
  let j = null;
  try { j = JSON.parse(r.stdout || 'null'); } catch {}
  if (!r.ok || !j) return { ok: false, fout: 'dit is geen audio of video die ffmpeg kan lezen' };
  const sporen = Array.isArray(j.streams) ? j.streams : [];
  const audio = sporen.some((s) => s.codec_type === 'audio' && s.codec_name);
  const beeld = sporen.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic && s.width > 0 && s.height > 0);
  const duur = parseFloat(j.format?.duration);
  if (!audio) return { ok: false, fout: beeld ? 'deze video heeft geen geluidsspoor — een DJ-deck heeft geluid nodig' : 'dit is geen audio of video die ffmpeg kan lezen' };
  if (!(duur > 0.5)) return { ok: false, fout: 'dit bestand is korter dan een halve seconde of heeft geen leesbare duur' };
  const tags = j.format?.tags || {};
  const tag = (k) => String(tags[k] ?? tags[k.toUpperCase()] ?? '').trim().slice(0, 200);
  return {
    ok: true, audio, video: !!beeld, duur,
    breedte: beeld?.width ?? null, hoogte: beeld?.height ?? null,
    tags: { titel: tag('title'), artiest: tag('artist') },
  };
}

/**
 * Het gedeelde deel: van ruwe audio (en eventueel ruwe video) in de werkmap
 * naar media/<id>/. haalAudio() geeft { ok, pad | fout }, haalVideo() geeft
 * { pad } of { fout } — video is bonus, die laat de audio nooit vallen.
 */
async function verwerk({ id, map, onStap, signal, haalAudio, haalVideo, info, ytdlp }, mediaDir) {
  const doel = join(mediaDir, id);
  const stap = stapper(onStap, signal);
  // Een ffmpeg-stap met percentage: `s` is de melding, de duur komt van de bron.
  const metPct = (s, duur) => { stap(s); return { signal, duur, onPct: (pct) => onStap({ ...s, pct }) }; };
  try {
    // ---- audio -------------------------------------------------------------
    const a = await haalAudio();
    if (!a.ok) return mislukt(map, a.fout);
    const rauw = a.pad;
    const duurBron = info.duur > 0 ? info.duur : await duurVan(rauw);

    // ---- loudness in twee passes ------------------------------------------
    const meting = await meetLoudness(rauw, metPct({ stap: 'meten', tekst: 'loudness meten (pass 1 van 2)' }, duurBron));
    if (!meting.ok) return mislukt(map, meting.fout);

    const audio = join(map, 'audio.wav');
    const norm = await normaliseer(rauw, meting.gemeten, audio,
      metPct({ stap: 'normaliseren', tekst: `normaliseren naar ${LOUDNESS.I} LUFS (pass 2 van 2)` }, duurBron));
    if (!norm.ok) return mislukt(map, norm.fout);

    // ---- golfvorm vooraf uitrekenen ---------------------------------------
    // Peaks veranderen nooit. Ze elke keer opnieuw uitrekenen bij het laden is
    // pure verspilling; dit kost één keer anderhalve seconde.
    stap({ stap: 'peaks', tekst: 'golfvorm uitrekenen' });
    const peaksBestand = join(map, 'peaks.bin');
    const pk = await maakPeaks(audio, peaksBestand, { signal });
    const peaks = pk.ok ? { bestand: peaksBestand, buckets: pk.buckets, perBucket: pk.perBucket } : null;

    // ---- onset-envelope voor de tap-hybride --------------------------------
    stap({ stap: 'onset', tekst: 'ritme-analyse voorbereiden' });
    const onsetBestand = join(map, 'onset.bin');
    const on = await maakOnset(audio, onsetBestand, { signal });
    const onset = on.ok
      ? { bestand: onsetBestand, frames: on.frames, envRate: on.envRate, tijdOffset: on.tijdOffset }
      : null;

    // ---- beatgrid-voorstel -------------------------------------------------
    // Een tempokaart met zekerheid per stuk. Kost een paar seconden per half
    // uur (in een worker). Mislukt dit, dan is er gewoon geen grid: de tap
    // werkt nog steeds, en de server probeert het bij het opstarten opnieuw.
    let grid = null;
    if (onset) {
      stap({ stap: 'grid', tekst: 'beatgrid zoeken' });
      const g = await maakGrid(onsetBestand, on.envRate, on.tijdOffset, audio, { signal });
      if (g.ok) grid = g.grid;
    }

    // ---- video, met constante framerate -----------------------------------
    let videoBestand = null;
    let videoFout = null;
    if (haalVideo) {
      const v = await haalVideo();
      if (v.fout) videoFout = v.fout;
      else {
        // Constante framerate is geen franje: zonder dit loopt de A/V-sync in
        // fase 4 langzaam weg en is hij niet meer bij te sturen.
        videoBestand = join(map, 'video.mp4');
        const conv = await cfrTranscode(v.pad, videoBestand, metPct({ stap: 'video', tekst: 'video naar constante framerate' }, duurBron));
        if (!conv.ok) {
          // Video is bonus: de audio staat er al en die laten we niet vallen.
          // Maar stil falen is erger dan de fout zelf, dus hij wordt gemeld.
          videoFout = conv.fout;
          await rm(videoBestand, { force: true }).catch(() => {});
          videoBestand = null;
        }
        if (v.pad !== rauw) await rm(v.pad, { force: true });
      }
      if (videoFout) stap({ stap: 'video', tekst: `video overgeslagen — ${videoFout}` });
    }

    // Laatste kans om te annuleren; hierna wordt er alleen nog verhuisd.
    if (signal?.aborted) return mislukt(map, GEANNULEERD);
    await rm(rauw, { force: true });
    const duur = await duurVan(audio);

    // Alles is gelukt: verhuizen naar de echte map. Bestanden die er al
    // waren (een eerdere download) worden per stuk vervangen; een video die
    // deze keer mislukte laat de oude staan.
    await mkdir(doel, { recursive: true });
    const verhuis = async (pad) => {
      if (!pad) return null;
      const naar = join(doel, pad.slice(map.length + 1));
      await rename(pad, naar);
      return naar;
    };
    const audioDef = await verhuis(audio);
    const videoDef = await verhuis(videoBestand);
    if (peaks) peaks.bestand = await verhuis(peaks.bestand);
    if (onset) onset.bestand = await verhuis(onset.bestand);
    await rm(map, { recursive: true, force: true });

    return {
      ok: true,
      track: {
        id, url: info.url, titel: info.titel, uploader: info.uploader,
        duur, audio: audioDef, video: videoDef, videoFout, peaks, onset, grid, thumbnail: info.thumbnail,
        loudness: meting.gemeten, doelLoudness: LOUDNESS.I,
        ytdlp: ytdlp ? await ytdlpVersie() : null,
      },
    };
  } catch (err) {
    // Geannuleerd (STOP uit stap()): de werkmap gaat weg, net als bij een fout.
    if (err === STOP || signal?.aborted) return mislukt(map, GEANNULEERD);
    // Wat hier ook misgaat: de server blijft staan.
    return mislukt(map, `onverwachte fout: ${err?.message || err}`);
  }
}

async function mislukt(map, fout) {
  try { await rm(map, { recursive: true, force: true }); } catch {}
  return { ok: false, fout };
}
