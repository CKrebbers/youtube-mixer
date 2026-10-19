/**
 * grid-eval.mjs op een nep-server met synthetische nummers waarvan de waarheid bekend is: een goed grid,
 * een grid een halve tel naast, een grid op dubbel tempo, een onzeker grid (fout en goed), een "1" die
 * een tel naast staat (met en zonder twijfel 'maat'), een nummer in twee stukken, half getikt.
 * Daarna één keer tegen de echte v2-server (maakServer) met een tijdelijke library.db.
 *
 *   node --test v2/meting/grid-eval.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { meetNummer, samenvatting, leesTikken } from './grid-eval.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const CLI = join(HIER, 'grid-eval.mjs');

function zaad(s) {
  let x = s >>> 0 || 1;
  const u = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  return { u, g: () => { let t = 0; for (let i = 0; i < 12; i++) t += u(); return t - 6; } };
}

/** Echte tellen: stukken [{ van, bpm, anker }] → tijden in [0, duur), met het telnummer in de maat. */
function waarheid(stukken, duur) {
  const uit = [];
  for (let i = 0; i < stukken.length; i++) {
    const s = stukken[i], L = 60 / s.bpm, tot = stukken[i + 1]?.van ?? duur;
    let k = Math.ceil((s.van - s.anker) / L - 1e-9);
    for (let t = s.anker + k * L; t < tot; k++, t = s.anker + k * L) if (t >= 0) uit.push({ t, een: (((k - (s.eenTel ?? 0)) % 4) + 4) % 4 === 0 });
  }
  return uit;
}

/** Wat Clay tikt: echte tel + jitter (σ 8 ms), af en toe een gemiste tel; de "1" met shift. */
function tik(id, echt, { van = 0, tot = Infinity, s = 1 } = {}) {
  const { u, g } = zaad(s);
  const tellen = [], enen = [];
  for (const e of echt) {
    if (e.t < van || e.t > tot || u() < 0.02) continue;
    const t = e.t + 0.008 * g();
    tellen.push(t);
    if (e.een) enen.push(t);
  }
  return { id, titel: id, tellen, enen, kalibratie_ms: 42, gemaakt: '2026-10-19T20:00:00.000Z' };
}

const DUUR = 90;
const echt124 = waarheid([{ van: 0, bpm: 124, anker: 0.31 }], DUUR);
const L124 = 60 / 124;
const grid = (stukken, extra = {}) => ({ stukken, beatsPerBar: 4, bron: 'auto', ...extra });

/** id → { nummer (zoals /api/library), tik, verwacht } */
const GEVALLEN = {
  goed: { grid: grid([{ van: 0, bpm: 124, anker: 0.31, zekerheid: 0.9, maat: 0.31 }]), echt: echt124, soorten: ['zeker en goed'] },
  'halve-tel': { grid: grid([{ van: 0, bpm: 124, anker: 0.31 + L124 / 2, zekerheid: 0.9 }]), echt: echt124, soorten: ['zeker maar fout'], diagnose: 'tegentel' },
  dubbel: { grid: grid([{ van: 0, bpm: 248, anker: 0.31, zekerheid: 0.85 }]), echt: echt124, soorten: ['zeker maar fout'], diagnose: 'dubbel' },
  'onzeker-fout': { grid: grid([{ van: 0, bpm: 126.5, anker: 0.31, zekerheid: 0.3, twijfel: 'drift' }]), echt: echt124, soorten: ['onzeker en fout'] },
  'onzeker-goed': { grid: grid([{ van: 0, bpm: 124, anker: 0.31, zekerheid: 0.4, twijfel: 'los' }]), echt: echt124, soorten: ['onzeker maar goed'] },
  // Tempo en tel goed, de "1" een tel naast. Met twijfel 'maat' weigert sync (syncBij) terecht; zonder is het fout.
  'een-twijfel': { grid: grid([{ van: 0, bpm: 124, anker: 0.31, zekerheid: 0.9, maat: 0.31 + L124, twijfel: 'maat' }]), echt: echt124, soorten: ['onzeker en fout'], zekerBij: true },
  'een-fout': { grid: grid([{ van: 0, bpm: 124, anker: 0.31, zekerheid: 0.9, maat: 0.31 + L124 }]), echt: echt124, soorten: ['zeker maar fout'] },
  // Twee stukken: 0–45 s op 124 (goed, zeker); daarna echt 130, het grid zegt 128 en twijfelt.
  'twee-stukken': {
    grid: grid([{ van: 0, bpm: 124, anker: 0.31, zekerheid: 0.8 }, { van: 45, bpm: 128, anker: 45.1, zekerheid: 0.25, twijfel: 'drift' }]),
    echt: waarheid([{ van: 0, bpm: 124, anker: 0.31 }, { van: 45, bpm: 130, anker: 45.1 }], DUUR), soorten: ['zeker en goed', 'onzeker en fout'],
  },
  // Alleen 20–60 s getikt (met een gat van 8 s erin): het grid buiten het getikte deel telt niet.
  'half-getikt': { grid: grid([{ van: 0, bpm: 124, anker: 0.31, zekerheid: 0.95 }]), echt: echt124, van: 20, tot: 60, gat: [35, 43], soorten: ['zeker en goed'] },
  // Op slot: zeker, ook zonder zekerheid.
  slot: { grid: grid([{ van: 0, bpm: 124, anker: 0.31 }], { slot: true, bron: 'hand' }), echt: echt124, soorten: ['zeker en goed'] },
};

function bouw(namen, s0 = 1) {
  const nummers = [], tikken = [];
  for (const [i, id] of namen.entries()) {
    const g = GEVALLEN[id];
    nummers.push({ id, titel: id, artiest: '', duur: DUUR, grid: g.grid });
    let echt = g.echt;
    if (g.gat) echt = echt.filter((e) => e.t < g.gat[0] || e.t > g.gat[1]);
    tikken.push(tik(id, echt, { van: g.van, tot: g.tot, s: s0 + i }));
  }
  return { nummers, tikken };
}

async function nepServer(nummers) {
  const srv = createServer((req, res) => {
    if (req.url === '/api/library') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ bron: 'nep', nummers })); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, sluit: () => new Promise((r) => srv.close(r)) };
}

function cli(argv) {
  return new Promise((r) => execFile(process.execPath, [CLI, ...argv], { encoding: 'utf8' }, (err, stdout, stderr) => r({ code: err ? err.code : 0, stdout, stderr })));
}

test('meetNummer: elk synthetisch geval in de goede rij', () => {
  const { nummers, tikken } = bouw(Object.keys(GEVALLEN));
  for (const [i, n] of nummers.entries()) {
    const g = GEVALLEN[n.id];
    const m = meetNummer(n, leesTikken(tikken[i])[0]);
    const soorten = m.stukken.map((s) => s.soort);
    assert.deepEqual(soorten, g.soorten, `${n.id}: ${JSON.stringify(m.stukken.map((s) => ({ soort: s.soort, F: s.F, een: s.een })))}`);
    if (g.diagnose) assert.match(m.diagnose, new RegExp(g.diagnose), n.id);
    if (g.zekerBij) assert.equal(m.stukken[0].zeker, true, `${n.id}: zekerBij hoort ja te zeggen, syncBij nee`);
  }
  // De goede: F en de "1" (bijna) 1, ook na trimmen; half tempo-maten: CML = AML.
  const goed = meetNummer(nummers[0], leesTikken(tikken[0])[0]);
  assert.ok(goed.maten.F > 0.98 && goed.een > 0.98, JSON.stringify(goed.maten));
  assert.ok(Math.abs(goed.bpmTik - 124) < 0.5);
  // Dubbel tempo: F ≈ 2/3 (precisie ½), AMLt hoog, CMLt laag.
  const dub = meetNummer(nummers[2], leesTikken(tikken[2])[0]);
  assert.ok(Math.abs(dub.maten.F - 2 / 3) < 0.03 && dub.maten.AMLt > 0.9 && dub.maten.CMLt < 0.1, JSON.stringify(dub.maten));
  // Half getikt: alleen het getikte stuk (zonder het gat) telt; F hoog.
  const half = meetNummer(nummers.at(-2), leesTikken(tikken.at(-2))[0]);
  assert.ok(half.maten.F > 0.97, JSON.stringify(half.maten));
});

test('samenvatting: M12 gehaald zonder "zeker maar fout", niet gehaald met', () => {
  const ok = bouw(['goed', 'onzeker-fout', 'onzeker-goed', 'een-twijfel', 'twee-stukken', 'half-getikt', 'slot']);
  const som = samenvatting(ok.nummers.map((n, i) => meetNummer(n, leesTikken(ok.tikken[i])[0])));
  assert.equal(som.gehaald, true);
  assert.equal(som.tabel['zeker maar fout'].stukken, 0);
  assert.equal(som.tabel['zeker en goed'].stukken, 4);
  assert.equal(som.tabel['onzeker en fout'].stukken, 3);
  assert.equal(som.tabel['onzeker maar goed'].stukken, 1);
  assert.ok(som.Fzeker > 0.97);
  const mis = bouw(['goed', 'halve-tel', 'dubbel', 'een-fout']);
  const som2 = samenvatting(mis.nummers.map((n, i) => meetNummer(n, leesTikken(mis.tikken[i])[0])));
  assert.equal(som2.gehaald, false);
  assert.equal(som2.tabel['zeker maar fout'].stukken, 3);
});

test('de CLI tegen een nep-server: exit 0 als M12 gehaald is, 1 als niet, en het verslag', async () => {
  const map = mkdtempSync(join(tmpdir(), 'grid-eval-'));
  try {
    const alles = bouw(Object.keys(GEVALLEN));
    const srv = await nepServer(alles.nummers);
    try {
      // Goede set: één bestand per nummer, zoals tikken.html ze bewaart, plus een id die er niet is.
      const goedMap = join(map, 'goed'); mkdirSync(goedMap);
      for (const t of alles.tikken.filter((t) => !['halve-tel', 'dubbel', 'een-fout'].includes(t.id))) writeFileSync(join(goedMap, `tikken-${t.id}.json`), JSON.stringify(t));
      writeFileSync(join(goedMap, 'tikken-weg.json'), JSON.stringify({ id: 'bestaat-niet', tellen: [1, 2, 3], enen: [] }));
      const a = await cli(['--tikken', goedMap, '--server', srv.url, '--json', join(map, 'uit.json')]);
      assert.equal(a.code, 0, a.stdout + a.stderr);
      assert.match(a.stdout, /M12: GEHAALD/);
      assert.match(a.stdout, /Niet in de library \(niet gemeten\): bestaat-niet/);
      assert.match(a.stdout, /zeker maar fout\s+0/);
      const json = JSON.parse(readFileSync(join(map, 'uit.json'), 'utf8'));
      assert.equal(json.samenvatting.gehaald, true);
      assert.ok(json.nummers.every((n) => typeof n.maten.CMLc === 'number' && typeof n.maten.goto === 'number'));
      // Alles in één bestand (de export "alles" van tikken.html): met de slechte erbij = niet gehaald.
      writeFileSync(join(map, 'alle.json'), JSON.stringify(alles.tikken));
      const b = await cli(['--tikken', join(map, 'alle.json'), '--server', srv.url]);
      assert.equal(b.code, 1, b.stdout + b.stderr);
      assert.match(b.stdout, /M12: NIET GEHAALD/);
      assert.match(b.stdout, /halve-tel[\s\S]*zeker maar fout[\s\S]*tegentel/);
      assert.match(b.stdout, /zeker maar fout\s+3/);
    } finally { await srv.sluit(); }
    // Geen server: exit 2 met een uitleg.
    const c = await cli(['--tikken', join(map, 'alle.json'), '--server', 'http://127.0.0.1:9']);
    assert.equal(c.code, 2);
    assert.match(c.stderr, /de server antwoordt niet/);
  } finally { rmSync(map, { recursive: true, force: true }); }
});

test('de CLI tegen de echte v2-server (maakServer, tijdelijke library.db, alleen lezen)', async () => {
  const map = mkdtempSync(join(tmpdir(), 'grid-eval-echt-'));
  // Een vrije poort: server.mjs leest VARVE_V2_POORT bij het laden (de Host-controle).
  const vrij = createServer(); await new Promise((r) => vrij.listen(0, '127.0.0.1', r));
  const poort = vrij.address().port; await new Promise((r) => vrij.close(r));
  process.env.VARVE_V2_POORT = String(poort);
  const { maakServer } = await import('../app/server.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  try {
    const db = new DatabaseSync(join(map, 'library.db'));
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, titel TEXT, uploader TEXT, duur REAL, audio TEXT, grid_json TEXT, toegevoegd INTEGER)');
    const zet = db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?)');
    const { nummers, tikken } = bouw(['goed', 'onzeker-fout', 'twee-stukken']);
    nummers.forEach((n, i) => zet.run(n.id, n.titel, 'proef', n.duur, `media/${n.id}/audio.wav`, JSON.stringify(n.grid), i));
    db.close();
    const tmap = join(map, 'tikken'); mkdirSync(tmap);
    for (const t of tikken) writeFileSync(join(tmap, `tikken-${t.id}.json`), JSON.stringify(t));
    const srv = maakServer({ media: map });
    await new Promise((r) => srv.listen(poort, '127.0.0.1', r));
    try {
      const a = await cli(['--tikken', tmap, '--server', `http://localhost:${poort}`]);
      assert.equal(a.code, 0, a.stdout + a.stderr);
      assert.match(a.stdout, /M12: GEHAALD/);
      assert.match(a.stdout, /onzeker en fout\s+2/);
    } finally { await new Promise((r) => srv.close(r)); }
  } finally { rmSync(map, { recursive: true, force: true }); }
});
