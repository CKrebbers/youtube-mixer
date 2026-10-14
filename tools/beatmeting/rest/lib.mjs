// Gedeeld voor de metingen van de beatgrid-restpunten (25 september 2026).
// Leest ALLEEN: media/<id>/onset.bin en audio.wav (fragmenten, via ffmpeg naar
// een tijdelijke map) en media/library.db. Schrijft niets in media/.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HIER = path.dirname(new URL(import.meta.url).pathname);
export const ROOT = path.resolve(decodeURIComponent(HIER), '..', '..', '..');

/** De media-map: VARVE_MEDIA, anders die van de hoofdrepo (ook vanuit een worktree). */
export function mediaMap() {
  if (process.env.VARVE_MEDIA) return process.env.VARVE_MEDIA;
  try {
    const git = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return verhuisd(path.join(path.dirname(git), 'media'));
  } catch { return verhuisd(path.join(ROOT, 'media')); }
}
/** Is media/ verhuisd (VI2), dan het pad uit media-VERHUISD.txt ernaast. */
function verhuisd(m) {
  if (existsSync(m)) return m;
  const t = (() => { try { return readFileSync(path.join(path.dirname(m), 'media-VERHUISD.txt'), 'utf8'); } catch { return ''; } })();
  return /^VARVE_MEDIA=(\/.+)$/m.exec(t)?.[1].trim() ?? m;
}
export const MEDIA = mediaMap();
export const TMP = path.join(tmpdir(), 'varve-beatmeting-rest');
mkdirSync(TMP, { recursive: true });

export const SR = 11025, ENV_RATE = SR / 128;
export const d = await import(path.join(ROOT, 'server/detect.js'));
export const analyze = await import(path.join(ROOT, 'server/analyze.js'));
export const beatgrid = await import(path.join(ROOT, 'src/engine/beatgrid.js'));

/**
 * detect.js zoals hij was vóór de restpunten (commit cc527e3), met alleen de
 * optie `nulGrens` erbij, om oud en nieuw op dezelfde nul te vergelijken.
 */
export async function detectOud() {
  const pad = path.join(TMP, 'detect-oud.js');
  if (!existsSync(pad)) {
    let bron = execFileSync('git', ['show', 'cc527e3:server/detect.js'], { cwd: ROOT, encoding: 'utf8' });
    bron = bron.replace('const nulGrens = kwantiel(nul, 0.97);',
      'const nulGrens = Number.isFinite(opties.nulGrens) ? opties.nulGrens : kwantiel(nul, 0.97);');
    writeFileSync(pad, bron);
  }
  return import(pad);
}

/**
 * detect.js zoals hij in `commit` was (die moet `nulGrens` al kennen: vanaf de
 * restpunten, 25 september 2026). Voor "elk stuk moet passen": 12776ba.
 */
export async function detectVan(commit) {
  const pad = path.join(TMP, `detect-${commit}.js`);
  if (!existsSync(pad)) writeFileSync(pad, execFileSync('git', ['show', `${commit}:server/detect.js`], { cwd: ROOT, encoding: 'utf8' }));
  return import(pad);
}

/**
 * Een stuk van de bewaarde envelope (onset.bin): precies wat de server
 * analyseerde. Het begin valt op het raster van de tempocurve van het HELE
 * nummer (stappen van 345 frames), anders liggen de vensters anders dan toen.
 */
export function envelopeFragment(id, van, duur, { raster = true } = {}) {
  const b = readFileSync(path.join(MEDIA, id, 'onset.bin'));
  const heel = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const stapF = Math.round(4 * ENV_RATE);
  const f0 = raster ? Math.round(van * ENV_RATE / stapF) * stapF : Math.max(0, Math.round(van * ENV_RATE));
  const f1 = Math.min(heel.length, f0 + Math.round(duur * ENV_RATE));
  return { env: heel.slice(f0, f1), envRate: ENV_RATE, tijdOffset: d.onsetVertraging(SR, 1024, 128) + f0 / ENV_RATE };
}

/** Mono audio op 11025 Hz, van `van` s voor `duur` s, geknipt met ffmpeg naar TMP (één keer). */
export function audioFragment(id, van, duur) {
  const pad = path.join(TMP, `${id}-${van}-${duur}.f32`);
  if (!existsSync(pad)) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(van), '-t', String(duur),
      '-i', path.join(MEDIA, id, 'audio.wav'), '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', String(SR), '-y', pad]);
  }
  const b = readFileSync(pad);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
