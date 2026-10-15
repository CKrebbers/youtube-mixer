#!/usr/bin/env node
/**
 * VRAGEN AR2 (16 okt): de twee metingen die alleen op Clay's Mac kunnen, in één opdracht.
 *   (a) het ECHTE Beat This! op de benchmark (GA3): synth/bench.mjs --beatthis <python>, dan synth/groep.mjs;
 *   (b) "tel 1 hier" op Clay's eigen fragmenten: rest/tel1-echt.mjs (kolom T = snappen naar de tel van Beat This!).
 * De opdrachten zelf staan in docs/verslagen/2026-10-15/arch-beatgrid.md §5; dit script draait ze na elkaar en
 * zet alles in één verslag (tools/beatmeting/uit/ar2-<datum>.txt, niet in git). In de cloud kon het niet: het
 * checkpoint staat op cloud.cp.jku.at en daar kwam de container niet bij, en (b) heeft Clay's media nodig.
 *
 *   node tools/beatmeting/ar2.mjs            droog: wat ontbreekt er, wat zou hij draaien (doet niets)
 *   node tools/beatmeting/ar2.mjs --meet     meten (een paar minuten; de server mag aan blijven, maar zonder
 *                                            spelende decks: de bench gebruikt alle kernen)
 *
 * Wat hij nodig heeft: de Python met beat-this (VARVE_TELLEN_PY, VARVE_STEMS_PY of ~/.varve/stems-venv/bin/python),
 * het checkpoint (VARVE_TELLEN_MODEL of ~/.varve/modellen/beat_this-final0.ckpt; ontbreekt het, dan zegt hij de
 * curl-opdracht), ffmpeg, en voor (b) de media-map (zoals rest/lib.mjs: VARVE_MEDIA, media/, media-VERHUISD.txt).
 * Schrijft alleen in tools/beatmeting/uit/ en de tijdelijke map van het systeem.
 * Exit: 0 gemeten (of droog en alles aanwezig) · 2 droog en er ontbreekt iets · 1 een stap faalde.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = fileURLToPath(new URL('.', import.meta.url));

/** De fragmenten van 25 sep: <id>:<begin s>:<lengte s>:<bpm als startwaarde> (arch-beatgrid.md §5). */
export const FRAGMENTEN = [
  '_x5K5Ihutbw:1414:100:174', 'CVeYI-gmX00:889:56:170', 'f3a7DiCsm8k:120:48:150',
  'f3a7DiCsm8k:705:100:156', 'mOzW9KQKfzA:1710:80:115.2', 'HGv_ySHXtYI:0:44:156.69',
];

/** De curl-opdracht voor het checkpoint (dezelfde als MODEL_HULP in server/tellen/tellen.py). */
export const MODEL_CURL = 'curl -L -o ~/.varve/modellen/beat_this-final0.ckpt --create-dirs '
  + 'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt';

/**
 * Wat er zou gebeuren: { python, model, stappen: [{ naam, cmd, args }], ontbreekt: [tekst], uitJson }.
 * Puur op `env`, `home`, `bestaat` (voor de test) en `tmp`.
 */
export function plan({ env = process.env, home = homedir(), bestaat = existsSync, tmp = tmpdir(), node = process.execPath } = {}) {
  const python = env.VARVE_TELLEN_PY || env.VARVE_STEMS_PY || join(home, '.varve', 'stems-venv', 'bin', 'python');
  const model = env.VARVE_TELLEN_MODEL || join(home, '.varve', 'modellen', 'beat_this-final0.ckpt');
  const ontbreekt = [];
  if (!bestaat(python)) ontbreekt.push(`geen Python met beat-this op ${python} (zet VARVE_TELLEN_PY, of maak ~/.varve/stems-venv: docs/STEMS.md)`);
  if (!bestaat(model)) ontbreekt.push(`geen checkpoint op ${model}: ${MODEL_CURL}`);
  const uitJson = join(tmp, `varve-ar2-echt-${process.pid}.json`);
  const stappen = [
    { naam: '(a) het echte Beat This! op de benchmark', cmd: node, args: [join(HIER, 'synth', 'bench.mjs'), '--beatthis', python, '--json', uitJson] },
    { naam: '(a) per soort fout: de nep (bt) naast echt', cmd: node, args: [join(HIER, 'synth', 'groep.mjs'), uitJson] },
    { naam: '(b) tel 1 hier op de eigen fragmenten (A = de klap, T = de tel van Beat This!)', cmd: node, args: [join(HIER, 'rest', 'tel1-echt.mjs'), ...FRAGMENTEN] },
  ];
  return { python, model, stappen, ontbreekt, uitJson };
}

function main(argv) {
  const meet = argv.includes('--meet');
  const p = plan();
  const regels = [];
  const zeg = (t = '') => { console.log(t); regels.push(t); };
  zeg(`AR2 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${meet ? 'meten' : 'droog (niets gedraaid; --meet om te meten)'}`);
  zeg(`python: ${p.python}`);
  zeg(`model:  ${p.model}`);
  for (const o of p.ontbreekt) zeg(`ONTBREEKT: ${o}`);
  if (!meet) {
    for (const s of p.stappen) zeg(`zou draaien: ${s.naam}\n  ${[s.cmd, ...s.args].join(' ')}`);
    return p.ontbreekt.length ? 2 : 0;
  }
  if (p.ontbreekt.length) { zeg('niet gemeten: eerst wat hierboven ontbreekt'); return 1; }
  let code = 0;
  for (const s of p.stappen) {
    zeg(`\n== ${s.naam}`);
    const r = spawnSync(s.cmd, s.args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    zeg((r.stdout || '').trimEnd());
    if (r.stderr?.trim()) zeg(r.stderr.trimEnd());
    if (r.status !== 0) { zeg(`(stap faalde: exit ${r.status})`); code = 1; if (s.args.includes('--json')) break; }
  }
  const map = join(HIER, 'uit');
  mkdirSync(map, { recursive: true });
  const pad = join(map, `ar2-${new Date().toISOString().slice(0, 10)}.txt`);
  writeFileSync(pad, regels.join('\n') + '\n');
  console.log(`\nverslag: ${pad}`);
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
