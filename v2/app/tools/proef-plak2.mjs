/**
 * Plak 2 in echte Chrome (headless), met de echte afspeelkern, het scherm en de server:
 *   1. een lus van 4 tellen op een gekoppelde track: de motor vouwt terug en blijft op de klok;
 *   2. opnemen (6 s): de WAV staat op de server, met de juiste lengte en geluid erin;
 *   3. het log loopt vanzelf mee en bevat de handelingen en het begin van de opname;
 *   4. hotcues: zetten, bewaren op de server, en terug na opnieuw laden (een library-nummer);
 *   5. een schermafdruk (--scherm <pad>).
 *
 *   node tools/proef-plak2.mjs [--scherm pad.png]
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { opzet } from '../../meting/gemeen.mjs';

const schermPad = process.argv.includes('--scherm') ? process.argv[process.argv.indexOf('--scherm') + 1] : null;

// Een library met één nummer (20 s, 120 bpm, zeker grid), zodat hotcues bewaard worden.
const media = mkdtempSync(join(tmpdir(), 'varve-plak2-media-'));
{
  const SR = 48000, F = 20 * SR;
  mkdirSync(join(media, 'n1'));
  const b = Buffer.alloc(44 + F * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + F * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(F * 4, 40);
  for (let i = 0; i < F; i++) { const v = Math.round(9000 * Math.sin(2 * Math.PI * 110 * i / SR) * (i % 24000 < 2000 ? 1 : 0.3)); b.writeInt16LE(v, 44 + 4 * i); b.writeInt16LE(v, 46 + 4 * i); }
  writeFileSync(join(media, 'n1', 'audio.wav'), b);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(media, 'library.db'));
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, titel TEXT, uploader TEXT, duur REAL, audio TEXT, grid_json TEXT, toegevoegd INTEGER)');
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?)').run('yt:proef', 'Proefnummer', 'proef', 20, 'media/n1/audio.wav', JSON.stringify({ stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true }), 1);
  db.close();
}

const o = await opzet({ poort: 8806, media });
const uit = {};
let ok = true;
const eis = (v, wat) => { if (!v) { ok = false; console.log('NIET:', wat); } };
try {
  const p = o.page;
  await p.click('#start').catch(() => {});
  await p.waitForFunction(() => window.varve?.ctx.state === 'running');
  await p.waitForFunction(() => window.varve.log.loopt, null, { timeout: 5000 });
  // 1. Twee demonummers, sync, een lus op track 2.
  await p.evaluate(async () => {
    const { maakDemo, DEMOS } = await import('/src/ui/bronnen.js');
    const e = window.varve;
    for (const [n, id] of [[1, 'demo-124'], [2, 'demo-128']]) {
      const d = maakDemo(DEMOS.find((x) => x.id === id));
      await e.laad(n, { id, titel: id, duur: d.duur, grid: d.grid, haal: async () => d.maakPcm() });
    }
    e.bus.doe('track.1.play', true);
    await new Promise((r) => setTimeout(r, 300));
    e.bus.doe('track.2.play', true); e.bus.doe('track.2.sync', true);
  });
  await p.waitForTimeout(1500);
  uit.lus = await p.evaluate(async () => {
    const e = window.varve, t = e.track(2);
    const r = e.bus.doe('track.2.loop', true);
    if (r?.geweigerd) return { geweigerd: r.geweigerd };
    await new Promise((res) => setTimeout(res, 6000));   // ruim drie keer rond (4 tellen op 124 = 1,94 s)
    const nu = e.nu(), l = t.lus;
    let grootste = 0, buiten = 0, fase = 0;
    for (let dt = 0; dt < 2; dt += 0.01) {
      const m = t.speler.positie(nu + dt), tr = t.plek(nu + dt);
      grootste = Math.max(grootste, Math.abs(m - tr));
      if (m < l.A - 1e-9 || m >= l.B + 1e-9) buiten++;
      const d = t.grid.beatAt(m) - e.klok.tel(nu + dt); fase = Math.max(fase, Math.abs(d - Math.round(d)));
    }
    return { A: l.A, B: l.B, n: l.n, motorMinTrackMs: grootste * 1000, buitenDeLus: buiten, faseTel: fase };
  });
  eis(!uit.lus.geweigerd && uit.lus.motorMinTrackMs < 1e-3 && uit.lus.buitenDeLus === 0 && uit.lus.faseTel < 1e-6, `lus: ${JSON.stringify(uit.lus)}`);
  // 2. Opnemen.
  await p.click('button[data-actie="opname"]');
  await p.waitForTimeout(6000);
  await p.click('button[data-actie="opname"]');
  await p.waitForFunction(() => [...document.querySelectorAll('.melding')].some((m) => /opname bewaard/.test(m.textContent)), null, { timeout: 20000 });
  const lijst = await p.evaluate(() => fetch('/api/v2/opnames').then((r) => r.json()));
  const opn = lijst.opnames[0];
  const wav = readFileSync(join(o.data, 'opnames', `${opn.id}.wav`));
  let piek = 0;
  for (let i = 44; i < wav.length; i += 2) piek = Math.max(piek, Math.abs(wav.readInt16LE(i)));
  uit.opname = { id: opn.id, seconden: +opn.seconden.toFixed(2), kopKlopt: wav.readUInt32LE(40) === wav.length - 44, piekDbfs: +(20 * Math.log10(piek / 32768)).toFixed(1) };
  eis(Math.abs(opn.seconden - 6) < 0.6 && uit.opname.kopKlopt && piek > 1000, `opname: ${JSON.stringify(uit.opname)}`);
  // 3. Het log.
  await p.waitForTimeout(1500);
  const logPad = join(o.data, 'opnames', `${opn.id}.acties.jsonl`);
  const log = existsSync(logPad) ? readFileSync(logPad, 'utf8').trim().split('\n').map((r) => JSON.parse(r)) : [];
  uit.log = { regels: log.length, beginstand: !!log[0]?.stand, lus: log.some((r) => Array.isArray(r) && r[1] === 'track.2.loop'), sync: log.some((r) => Array.isArray(r) && r[1] === 'track.2.sync'), opname: log.some((r) => r.opname === opn.id), laden: log.filter((r) => r.laad).length };
  eis(uit.log.beginstand && uit.log.lus && uit.log.sync && uit.log.opname && uit.log.laden === 2, `log: ${JSON.stringify(uit.log)}`);
  // 4. Hotcues op een library-nummer: zetten, bewaard, terug na opnieuw laden.
  await p.waitForSelector('.bieb-rij');
  uit.hotcue = await p.evaluate(async () => {
    const e = window.varve;
    const rij = () => [...document.querySelectorAll('.bieb-rij')].find((x) => x.textContent.includes('Proefnummer'));
    rij().querySelector('.laad button:nth-child(3)').click();              // laad op track 3
    for (let i = 0; i < 100 && !e.track(3).geladen; i++) await new Promise((r) => setTimeout(r, 50));
    e.bus.doe('track.3.seek', 5.2 / 20);
    e.bus.doe('track.3.hotcue.1', true);
    const gezet = e.track(3).hotcues[0];
    await new Promise((r) => setTimeout(r, 500));
    const opServer = await fetch('/api/v2/nummer/yt:proef').then((r) => r.json());
    e.bus.doe('track.4.focus', true);
    rij().querySelector('.laad button:nth-child(4)').click();              // opnieuw, op track 4
    for (let i = 0; i < 100 && !e.track(4).geladen; i++) await new Promise((r) => setTimeout(r, 50));
    return { gezet, opServer: opServer.hotcues?.[0] ?? null, terug: e.track(4).hotcues[0], lampje: e.bus.lees('track.4.hotcue.1') };
  });
  eis(Math.abs(uit.hotcue.gezet - 5) < 1e-9 && uit.hotcue.opServer === uit.hotcue.gezet && uit.hotcue.terug === uit.hotcue.gezet && uit.hotcue.lampje === 0.5, `hotcue: ${JSON.stringify(uit.hotcue)}`);
  // 5. Een grote library: 20.000 nummers. Zoeken en tekenen blijven snel, en er bestaan maar een
  //    paar tientallen rijen (virtuele lijst). Bladeren via de bus houdt de keuze in beeld.
  uit.groot = await p.evaluate(async () => {
    const lib = window.varveLibrary;
    const veel = Array.from({ length: 20000 }, (_, i) => ({ id: `n${i}`, titel: `Nummer ${i} ${i % 7 ? 'house' : 'ambient'}`, artiest: `Artiest ${i % 300}`, duur: 200 + (i % 300), toegevoegd: i, grid: { stukken: [{ bpm: 90 + (i % 60) }] } }));
    let t0 = performance.now();
    lib.lijst.zet(veel); lib.teken(true);
    const zetMs = performance.now() - t0;
    t0 = performance.now();
    lib.lijst.zoeken('house 12'); lib.lijst.sorteer('bpm'); lib.teken(true);
    const zoekMs = performance.now() - t0;
    const vak = document.querySelector('#bieb-lijst');
    vak.scrollTop = 5000; await new Promise((r) => setTimeout(r, 50));
    return { zetMs: +zetMs.toFixed(1), zoekMs: +zoekMs.toFixed(1), treffers: lib.lijst.rijen.length, rijenInDeDom: document.querySelectorAll('.bieb-rij').length };
  });
  eis(uit.groot.zoekMs < 100 && uit.groot.rijenInDeDom < 60 && uit.groot.treffers > 100, `grote library: ${JSON.stringify(uit.groot)}`);
  await p.evaluate(() => { const b = window.varve.bus; for (let i = 0; i < 4; i++) { b.doe('library.volgende', true); b.doe('library.volgende', false); } });
  uit.bladeren = await p.evaluate(() => ({ gekozen: !!document.querySelector('.bieb-rij.gekozen'), lees: window.varve.bus.lees('library.laad') }));
  eis(uit.bladeren.gekozen && uit.bladeren.lees === 1, `bladeren: ${JSON.stringify(uit.bladeren)}`);
  if (schermPad) { await p.waitForTimeout(300); await p.screenshot({ path: schermPad }); }
  uit.fouten = o.fouten;
  eis(o.fouten.length === 0, `fouten in de pagina: ${o.fouten.join('; ')}`);
} finally {
  await o.sluit();
  rmSync(media, { recursive: true, force: true });
  rmSync(o.data, { recursive: true, force: true });
}
console.log(JSON.stringify(uit, null, 2));
console.log(ok ? 'GESLAAGD: lus op de klok, opname en log op de server, hotcues bewaard en terug' : 'NIET GESLAAGD');
process.exitCode = ok ? 0 : 1;
