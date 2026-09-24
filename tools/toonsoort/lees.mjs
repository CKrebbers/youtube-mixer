// Lezen voor de toonsoortmeting. Alleen lezen: schrijft niets in media/ of de database.
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

// De projectmap: twee niveaus boven dit bestand. In een git-worktree
// (.claude/worktrees/<naam>) staat media/ niet mee: dan de hoofdmap erboven.
// VARVE_ROOT gaat voor.
const hier = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/\/$/, '');
export const ROOT = process.env.VARVE_ROOT
  || (existsSync(`${hier}/media/library.db`) ? hier : hier.replace(/\/\.claude\/worktrees\/[^/]+$/, ''));

/** Samplerate voor de toonsoort: 4410 Hz (ROADMAP "Toonsoort"). */
export const SR = 4410;

/**
 * Mono floats op `sr` uit ffmpeg. `bron` is een pad, of een Float32Array op
 * `bronRate` (synthetisch materiaal gaat zo door DEZELFDE hersampler).
 */
export function leesPcm(bron, sr = SR, { bronRate = 48000 } = {}) {
  return new Promise((klaar, faal) => {
    const invoer = typeof bron === 'string'
      ? ['-i', bron]
      : ['-f', 'f32le', '-ar', String(bronRate), '-ac', '1', '-i', 'pipe:0'];
    const kind = spawn('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'error', ...invoer,
      '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', String(sr), 'pipe:1'],
    { stdio: [typeof bron === 'string' ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const stukken = [];
    let fout = '';
    kind.stdout.on('data', (c) => stukken.push(c));
    kind.stderr.on('data', (d) => { fout += d; });
    kind.on('error', faal);
    kind.on('close', (code) => {
      if (code !== 0) { faal(new Error(fout.trim() || `ffmpeg gaf ${code}`)); return; }
      const b = Buffer.concat(stukken);
      const uit = new Float32Array(b.byteLength / 4);
      new Uint8Array(uit.buffer).set(b.subarray(0, uit.length * 4));
      klaar(uit);
    });
    if (typeof bron !== 'string') {
      kind.stdin.on('error', () => {});
      kind.stdin.end(Buffer.from(bron.buffer, bron.byteOffset, bron.byteLength));
    }
  });
}

/** De library, alleen lezen. */
export function tracks() {
  const db = new DatabaseSync(`${ROOT}/media/library.db`, { readOnly: true });
  try {
    return db.prepare('SELECT id, titel, uploader, duur, url, audio FROM tracks ORDER BY toegevoegd').all();
  } finally {
    db.close();
  }
}

export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const fmt = (x, n = 2) => (x == null || !Number.isFinite(x) ? '-' : x.toFixed(n));
