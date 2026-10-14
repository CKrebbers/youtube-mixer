// Spoor S11 (docs/LIBRARY-TAGS.md): hoe snel is een gefilterde pagina van de library, op 5.000 en
// 20.000 nummers? In het proces (geen HTTP), op een tijdelijke database. Per vraag: één pagina van
// 100 (de twee stappen van Library.tracks) plus het totaal (aantalTracks), zoals GET /api/library.
// Ook de stand van de indeling (de kolom links, met de aantallen van de slimme categorieën).
//
// Gebruik: node tools/bench/indeling.mjs [aantal…]   (standaard 5000 20000)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library } from '../../server/library.js';

const AANTALLEN = process.argv.slice(2).map(Number).filter((n) => n > 0);
const VRAGEN = [
  ['geen filter (titel)', { sorteer: 'titel', richting: 'op' }],
  ['#deep', { filter: { tags: { en: ['deep'], of: [], niet: [] } } }],
  ['#deep -#nacht', { filter: { tags: { en: ['deep'], of: [], niet: ['nacht'] } } }],
  ['#deep|nacht|warm, op titel', { filter: { tags: { en: [], of: ['deep', 'nacht', 'warm'], niet: [] } }, sorteer: 'titel', richting: 'op' }],
  ['#dub bpm:70-90 grid:zeker', { filter: { tags: { en: ['dub'], of: [], niet: [] }, bpm: [70, 90], grid: 'zeker' } }],
  ['toon:8A,9A energie:hoog', { filter: { toon: [21, 16], energie: [0.66, 1] } }],
  ['zoek "nummer 1"', { zoek: 'nummer 1' }],
  ['categorie (2000), op plek', { filter: { categorie: 1 }, sorteer: 'plek' }],
  ['slim: #deep bpm:120-130', { filter: { categorie: 2 } }],
];

const mediaan = (x) => { const s = [...x].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
for (const N of AANTALLEN.length ? AANTALLEN : [5000, 20000]) {
  const map = mkdtempSync(join(tmpdir(), 'varve-bench-indeling-'));
  try {
    const lib = new Library(join(map, 'lib.db'));
    const t0 = performance.now();
    lib.db.exec('BEGIN');
    for (let i = 0; i < N; i++) {
      const id = `n${i}`;
      lib.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: `Nummer ${(i * 7919) % N}`, uploader: `artiest ${i % 97}`, audio: `media/${id}/audio.wav`, duur: 180 + (i % 400) });
      if (i % 3) lib.bewaarGrid(id, { stukken: [{ van: 0, bpm: 70 + (i % 100), anker: 0, zekerheid: i % 7 ? 0.9 : 0.3 }], bron: 'auto' });
      if (i % 2 === 0) lib.bewaarToon(id, { stukken: [{ van: 0, toonsoort: ['Am', 'Em', 'C', 'G'][(i / 2) % 4], stemming: 0, zekerheid: 0.8 }], bron: 'auto' });
      if (i % 4 === 0) lib.bewaarSecties(id, { stukken: [{ van: 0, label: 'intro', groep: 'A', energie: (i % 10) / 10 }] });
    }
    lib.db.exec('COMMIT');
    const ids = lib.alleIds();
    const ind = lib.indeling;
    const tag = (naam, elke) => { for (let i = 0; i < ids.length; i += 5000) ind.zetTags(ids.slice(i, i + 5000).filter((_, k) => (i + k) % elke === 0), [naam], true); };
    tag('deep', 4); tag('nacht', 7); tag('dub', 10); tag('warm', 11);
    for (let k = 0; k < 40; k++) tag(`tag${k}`, 13 + k);   // veel tags, zoals na een tijdje
    const cat = ind.bewaarCategorie({ naam: 'Groot', soort: 'gewoon' });
    ind.zetNummers(cat.id, ids.filter((_, i) => i % Math.max(1, Math.floor(N / 2000)) === 0).slice(0, 2000), { aan: true });
    ind.bewaarCategorie({ naam: 'Deep vlot', soort: 'slim', regel: { tags: { en: ['deep'] }, bpm: [120, 130] } });
    for (let k = 0; k < 10; k++) ind.bewaarCategorie({ naam: `slim ${k}`, soort: 'slim', regel: { tags: { en: [`tag${k}`] }, grid: 'zeker' } });
    const opbouw = performance.now() - t0;
    console.log(`\n${N} nummers (${(opbouw / 1000).toFixed(1)} s opbouw; ${ind.tags().length} tags, ${lib.db.prepare('SELECT COUNT(*) AS n FROM nummer_tags').get().n} tagregels)`);
    for (const [naam, v] of VRAGEN) {
      const tijden = [];
      let totaal = 0;
      for (let k = 0; k < 15; k++) {
        const t = performance.now();
        lib.tracks({ ...v, van: 1000 % Math.max(1, totaal || 1), aantal: 100 });
        totaal = lib.aantalTracks({ zoek: v.zoek, filter: v.filter });
        tijden.push(performance.now() - t);
      }
      console.log(`  ${naam.padEnd(30)} ${String(totaal).padStart(6)} treffers   mediaan ${mediaan(tijden).toFixed(2).padStart(6)} ms   traagst ${Math.max(...tijden).toFixed(2).padStart(6)} ms`);
    }
    // De stand na een wijziging (de eerste vraag rekent) en daarna (uit het geheugen).
    const st = [], warm = [];
    for (let k = 0; k < 8; k++) {
      ind.zetTags([ids[k]], ['wissel'], k % 2 === 0);
      let t = performance.now(); ind.stand(); st.push(performance.now() - t);
      t = performance.now(); ind.stand(); warm.push(performance.now() - t);
    }
    console.log(`  ${'de stand na een wijziging'.padEnd(30)} ${''.padStart(6)}             mediaan ${mediaan(st).toFixed(2).padStart(6)} ms   traagst ${Math.max(...st).toFixed(2).padStart(6)} ms   (12 categorieën, 45 tags)`);
    console.log(`  ${'de stand, nog eens'.padEnd(30)} ${''.padStart(6)}             mediaan ${mediaan(warm).toFixed(2).padStart(6)} ms`);
    lib.sluit();
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
}
