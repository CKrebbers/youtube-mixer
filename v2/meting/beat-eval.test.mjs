/**
 * beat-eval.mjs tegen mir_eval.beat (0.8.2): 50 willekeurige paren (vast zaad: jitter, missers, extra
 * tellen, dubbel en half tempo, de tegentel, een tempo dat 2% naast ligt, randgevallen), verschil per
 * maat ≤ 1e-6. De uitkomsten van mir_eval staan in beat-eval-mireval.json, zodat dit ook zonder
 * Python draait; staat mir_eval op de machine, dan rekent hij ze ook live na.
 *
 *   node --test v2/meting/beat-eval.test.mjs
 *   VARVE_MIR_PY=<python met mir_eval> node --test v2/meting/beat-eval.test.mjs      (live)
 *   VARVE_MIR_PY=<python> VARVE_MIR_N=500 VARVE_MIR_ZAAD=7 node --test …                 (live, meer paren)
 *   VARVE_MIR_PY=<python> VARVE_MIR_SCHRIJF=1 node --test v2/meting/beat-eval.test.mjs (json opnieuw)
 *
 * De generator gebruikt alleen + − × ÷ (xorshift32, Irwin-Hall): op elke JS-motor dezelfde paren.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalueer, fMaat, cemgil, goto, pScore, continuiteit, variaties, koppel, trimBeats, MIR_NAMEN } from './beat-eval.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const VAST = join(HIER, 'beat-eval-mireval.json');
const GRENS = 1e-6;

function zaad(s) {
  let x = s >>> 0 || 1;
  const u = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const g = () => { let t = 0; for (let i = 0; i < 12; i++) t += u(); return t - 6; };  // ~N(0, 1)
  return { u, g };
}

const SOORTEN = ['goed', 'jitter', 'missers', 'extra', 'dubbel', 'half', 'halfEven', 'tegentel', 'tempo', 'rand'];

/** 50 paren { soort, ref, est }. */
export function maakParen(n = 50, s = 20261019) {
  const { u, g } = zaad(s);
  const paren = [];
  for (let i = 0; i < n; i++) {
    const soort = SOORTEN[i % SOORTEN.length];
    const tempo = 70 + 110 * u();
    let ioi = 60 / tempo;
    const duur = 15 + 75 * u();
    const rubato = u() < 0.3;
    const echt = [];
    for (let t = 0.2 + 3 * u(); t < duur; t += ioi) {
      echt.push(t);
      if (rubato) ioi = Math.min(60 / 60, Math.max(60 / 200, ioi * (1 + 0.004 * g())));
    }
    const tikJ = 0.008 * u();
    const ref = echt.map((t) => t + tikJ * g());
    const sigma = soort === 'jitter' ? 0.02 + 0.04 * u() : 0.003 + 0.012 * u();
    let est;
    const midden = (a) => a.slice(0, -1).map((t, k) => (t + a[k + 1]) / 2);
    switch (soort) {
      case 'missers': { const p = 0.1 + 0.3 * u(); est = echt.filter(() => u() > p); break; }
      case 'extra': { const p = 0.05 + 0.15 * u(); est = [...echt]; for (const t of midden(echt)) if (u() < p) est.push(t + 0.05 * g()); break; }
      case 'dubbel': est = [...echt, ...midden(echt)]; break;
      case 'half': est = echt.filter((_, k) => k % 2 === 0); break;
      case 'halfEven': est = echt.filter((_, k) => k % 2 === 1); break;
      case 'tegentel': est = midden(echt); break;
      case 'tempo': { const f = 1 + (u() < 0.5 ? -1 : 1) * (0.01 + 0.02 * u()); est = echt.map((t) => echt[0] + (t - echt[0]) * f); break; }
      case 'rand': {
        const k = i % 4;  // vier randgevallen om de beurt
        if (k === 0) est = echt.filter((t) => t >= 5).slice(0, 1);          // na het trimmen één tel
        else if (k === 1) est = echt.filter((t) => t >= 5).slice(0, 3);     // drie tellen
        else if (k === 2) est = echt.filter((t) => t < 4.9);                // alles vóór 5 s: leeg na trimmen
        else est = echt.filter((t) => t >= 5).slice(0, 2).concat(echt.filter((t) => t > duur - 4));
        break;
      }
      default: est = [...echt];
    }
    est = est.map((t) => Math.max(0, t + sigma * g()));
    paren.push({ soort, ref: ref.sort((a, b) => a - b), est: est.sort((a, b) => a - b) });
  }
  return paren;
}

const PY = `
import json, sys, warnings
warnings.simplefilter('ignore')
import numpy as np, mir_eval
paren = json.load(sys.stdin)
uit = []
for p in paren:
    s = mir_eval.beat.evaluate(np.array(p['ref'], dtype=float), np.array(p['est'], dtype=float))
    uit.append({k: float(v) for k, v in s.items()})
json.dump({'mir_eval': mir_eval.__version__, 'numpy': np.__version__, 'uitkomsten': uit}, sys.stdout)
`;

function mirLive(py, paren) {
  const r = spawnSync(py, ['-I', '-c', PY], { input: JSON.stringify(paren), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`mir_eval draaide niet: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function vergelijk(paren, mir) {
  let grootst = 0, waar = '';
  for (let i = 0; i < paren.length; i++) {
    const js = evalueer(paren[i].ref, paren[i].est);
    for (const [k, naam] of Object.entries(MIR_NAMEN)) {
      const d = Math.abs(js[k] - mir[i][naam]);
      if (!(d <= GRENS)) assert.fail(`paar ${i} (${paren[i].soort}) ${k}: js ${js[k]} mir_eval ${mir[i][naam]}`);
      if (d > grootst) { grootst = d; waar = `paar ${i} ${k}`; }
    }
  }
  return { grootst, waar };
}

const mirPy = process.env.VARVE_MIR_PY
  ?? (spawnSync('python3', ['-I', '-c', 'import mir_eval'], { encoding: 'utf8' }).status === 0 ? 'python3' : null);

test('beat-eval = mir_eval.beat op 50 willekeurige paren (vastgelegde uitkomsten)', () => {
  const paren = maakParen();
  if (process.env.VARVE_MIR_SCHRIJF && mirPy) writeFileSync(VAST, JSON.stringify(mirLive(mirPy, paren), null, 1) + '\n');
  assert.ok(existsSync(VAST), `${VAST} ontbreekt (VARVE_MIR_PY=… VARVE_MIR_SCHRIJF=1)`);
  const vast = JSON.parse(readFileSync(VAST, 'utf8'));
  assert.equal(vast.uitkomsten.length, paren.length);
  const { grootst, waar } = vergelijk(paren, vast.uitkomsten);
  console.log(`grootste verschil met mir_eval ${vast.mir_eval}: ${grootst.toExponential(2)} (${waar})`);
  // De paren raken echt elke soort: niet alles 1 of alles 0.
  const F = paren.map((p) => evalueer(p.ref, p.est).F);
  assert.ok(F.some((f) => f > 0.95) && F.some((f) => f < 0.2) && F.some((f) => f > 0.3 && f < 0.9));
});

test('beat-eval = mir_eval.beat live (als mir_eval er is)', { skip: mirPy ? false : 'mir_eval niet gevonden (VARVE_MIR_PY)' }, () => {
  // VARVE_MIR_N=500 voor een grotere steekproef (alleen live).
  const paren = maakParen(Number(process.env.VARVE_MIR_N ?? 50), Number(process.env.VARVE_MIR_ZAAD ?? 20261019));
  const live = mirLive(mirPy, paren);
  const { grootst, waar } = vergelijk(paren, live.uitkomsten);
  console.log(`live mir_eval ${live.mir_eval}, numpy ${live.numpy}: grootste verschil ${grootst.toExponential(2)} (${waar})`);
});

// ---- met de hand nagerekend -------------------------------------------------------------------

const rij = (van, stap, n) => Array.from({ length: n }, (_, k) => van + k * stap);

test('trimmen: alles vóór 5 s valt weg, in beide', () => {
  assert.deepEqual([...trimBeats([1, 4.999, 5, 6])], [5, 6]);
  const r = evalueer([1, 2, 3], [1, 2, 3]);
  assert.equal(r.F, 0);  // na het trimmen leeg
});

test('F-maat met de hand: ±70 ms, één-op-één', () => {
  const ref = rij(5, 0.5, 10);
  assert.equal(fMaat(ref, ref), 1);
  // 9 van de 10 raak (één 80 ms naast), plus één extra: p = 9/11, r = 9/10, F = 2pr/(p+r) = 18/21.
  const est = [...ref]; est[3] += 0.08; est.push(9.9);
  assert.ok(Math.abs(fMaat(ref, est.sort((a, b) => a - b)) - 18 / 21) < 1e-12);
  // Precies op de grens telt nog (r ≥ e − w en r ≤ e + w): 0,5 + 0,0625 met w = 0,0625 (exact in binair).
  assert.equal(koppel([0.5], [0.5625], 0.0625), 1);
  // Twee schattingen bij één referentie: maar één paar.
  assert.equal(koppel([1], [0.99, 1.01], 0.07), 1);
});

test('Cemgil met de hand: σ = 40 ms', () => {
  const ref = rij(5, 0.5, 8);
  assert.deepEqual(cemgil(ref, ref), [1, 1]);
  // Alles 40 ms te laat: elke tel e^(−½); noemer ½(8 + 8) = 8 → e^(−½).
  const [c] = cemgil(ref, ref.map((t) => t + 0.04));
  assert.ok(Math.abs(c - Math.exp(-0.5)) < 1e-12);
  // Dubbel tempo geschat: op het juiste niveau elke ref raak, noemer ½(15 + 8): 8 / 11,5; best = dubbel = 1.
  const dub = variaties(ref)[2];
  const [c2, best] = cemgil(ref, dub);
  assert.ok(Math.abs(c2 - 8 / 11.5) < 1e-12);
  assert.ok(Math.abs(best - 1) < 1e-12);
});

test('varianten: tegentel, dubbel, half oneven/even', () => {
  const v = variaties([0, 1, 2, 3, 4]);
  assert.deepEqual([...v[1]], [0.5, 1.5, 2.5, 3.5]);
  assert.deepEqual([...v[2]], [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  assert.deepEqual([...v[3]], [0, 2, 4]);
  assert.deepEqual([...v[4]], [1, 3]);
});

test('continuïteit met de hand', () => {
  const ref = rij(5, 0.5, 20);
  assert.deepEqual(continuiteit(ref, ref), { CMLc: 1, CMLt: 1, AMLc: 1, AMLt: 1 });
  // Tel 10 is 200 ms te laat: fase 0,4 > 0,175, en tel 11 daarna ook (periode |1 − 0,3/0,5| = 0,4).
  const est = [...ref]; est[10] += 0.2;
  const c = continuiteit(ref, est.sort((a, b) => a - b));
  // Langste spoor 0..9 = 10 van 20; 18 van de 20 goed.
  assert.equal(c.CMLc, 10 / 20);
  assert.equal(c.CMLt, 18 / 20);
  // Tegentel: CML 0, AML 1 (de tegentel-variant past, op de rand na: 19 middens bij 20 schattingen).
  const tegen = variaties(ref)[1];
  const t = continuiteit(ref, tegen);
  assert.equal(t.CMLt, 0);
  assert.equal(t.AMLt, 1);
  // Half tempo: elke tweede. AMLt = 1 via half oneven.
  const h = continuiteit(ref, ref.filter((_, k) => k % 2 === 0));
  assert.equal(h.AMLc, 1);
  assert.ok(h.CMLt < 0.1);
});

test('Goto en P-score met de hand', () => {
  const ref = rij(5, 0.5, 40);
  assert.equal(goto(ref, ref), 1);
  assert.equal(goto(ref, variaties(ref)[1]), 0);  // tegentel: elke fout 0,5 > 0,35
  assert.equal(pScore(ref, ref), 1);
  // P-score: tellen op 10 ms, venster round(0,2 × 50) = 10 stappen = 100 ms. 60 ms naast telt nog, 120 ms niet.
  assert.equal(pScore(ref, ref.map((t) => t + 0.06)), 1);
  assert.equal(pScore(ref, ref.map((t) => t + 0.12)), 0);
  // Half tempo: 20 schattingen, elk raak: 20 / max(20, 40) = 0,5.
  assert.equal(pScore(ref, ref.filter((_, k) => k % 2 === 0)), 0.5);
});
