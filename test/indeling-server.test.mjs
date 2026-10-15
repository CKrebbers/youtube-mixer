// Spoor S11 (docs/LIBRARY-TAGS.md §5): de routes van de indeling op een EIGEN server (eigen poort,
// tijdelijke database, alle VARVE_* in een tijdelijke map, een verzonnen kaart). De lijst met een
// filter (pagina's, totaal, 400/404), taggen, categorieën, volgorde, slim, hernoemen en wissen,
// een kaartkrat overnemen, export/import (droog), en: elke POST alleen vanaf deze Mac.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Library } from '../server/library.js';
import { schrijfKaart } from './nep-kaart.mjs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));
const gelijk = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const map = mkdtempSync(join(tmpdir(), 'varve-indeling-server-'));
const media = join(map, 'media');
mkdirSync(media, { recursive: true });
const dbPad = join(media, 'library.db');
// De library vóór de server: nummers, waarvan drie uit de krat Nachtwerk van de nep-kaart.
{
  const lib = new Library(dbPad);
  const ids = ['vertrouwd002', 'fourtet0baby', 'n1', 'n2', 'n3', 'n4', 'n5'];
  ids.forEach((id, i) => lib.bewaarTrack({ id, url: `https://youtu.be/${id}`, titel: `Titel ${i}`, audio: `media/${id}/audio.wav`, duur: 200 }));
  lib.bewaarGrid('n1', { stukken: [{ van: 0, bpm: 80, anker: 0, zekerheid: 0.9 }] });
  lib.bewaarGrid('n2', { stukken: [{ van: 0, bpm: 126, anker: 0, zekerheid: 0.9 }] });
  lib.sluit();
}
const kaartPad = join(map, 'varve-kaart.json');
schrijfKaart(kaartPad);
const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: dbPad, VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'),
    VARVE_HERANALYSE: 'uit', VARVE_NACHT: join(map, 'nacht.json'), VARVE_STANDEN: join(map, 'standen'), VARVE_WERKRUIMTES: join(map, 'werkruimtes'), VARVE_SETS: join(map, 'sets'),
    VARVE_KAART: kaartPad, VARVE_KAART_DB: join(map, 'kaart.db'), VARVE_HUB_SETS: join(map, 'hub-sets'), VARVE_HOSTS: 'varve-proef.ts.net',
    VARVE_STEMS_PY: join(map, 'geen-python'), VARVE_SJABLONEN: join(map, 'eigen.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverUit = '';
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const B = `http://localhost:${poort}`;
const get = async (p, headers = {}) => { const r = await fetch(`${B}${p}`, { headers }); return { status: r.status, j: await r.json().catch(() => null) }; };
const post = async (p, body, headers = {}) => {
  const r = await fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const IPAD = { Host: 'varve-proef.ts.net', Origin: 'https://varve-proef.ts.net' };
const lijst = async (q) => (await get(`/api/library?${q}`)).j;

try {
  let klaar = false;
  for (let i = 0; i < 200 && !klaar; i++) { klaar = await fetch(`${B}/api/indeling/stand`).then((r) => r.ok).catch(() => false); if (!klaar) await wacht(100); }
  ok('de server start', klaar);
  const leeg = await get('/api/indeling/stand');
  ok('de stand van een lege indeling', leeg.status === 200 && gelijk(leeg.j.tags, []) && gelijk(leeg.j.categorieen, []) && leeg.j.snel.length === 8);

  // taggen
  const t1 = await post('/api/indeling/tags/zet', { ids: ['n1', 'n2', 'n3', 'onbekend'], tags: ['Dub'], aan: true });
  ok('taggen: 200, onbekend genoemd', t1.status === 200 && t1.j.gezet === 3 && gelijk(t1.j.onbekend, ['onbekend']));
  ok('taggen zonder aan: 400', (await post('/api/indeling/tags/zet', { ids: ['n1'], tags: ['x'] })).status === 400);
  ok('taggen met een naam die niet mag: 400 met reden', (await post('/api/indeling/tags/zet', { ids: ['n1'], tags: ['a|b'], aan: true })).status === 400);
  ok('taggen vanaf de iPad (Tailscale): 403', (await post('/api/indeling/tags/zet', { ids: ['n1'], tags: ['x'], aan: true }, IPAD)).status === 403);
  ok('taggen met een andere Origin: 403', (await post('/api/indeling/tags/zet', { ids: ['n1'], tags: ['x'], aan: true }, { Origin: 'http://evil.example' })).status === 403);
  ok('taggen als tekst (geen JSON): 415', (await fetch(`${B}/api/indeling/tags/zet`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status === 415);
  ok('lezen mag van de iPad (GET)', (await get('/api/indeling/stand', IPAD)).status === 200);

  // de lijst met een filter
  const a = await lijst('tag=dub&sorteer=titel&richting=op&van=0&aantal=2');
  const b = await lijst('tag=dub&sorteer=titel&richting=op&van=2&aantal=2');
  ok('lijst met tag: totaal = treffers, pagina\'s sluiten aan', a.totaal === 3 && a.tracks.length === 2 && b.tracks.length === 1
    && gelijk([...a.tracks, ...b.tracks].map((t) => t.id).sort(), ['n1', 'n2', 'n3']));
  ok('de rijen dragen hun tags', a.tracks.every((t) => gelijk(t.tags, ['Dub'])));
  ok('tag + bpm', gelijk((await lijst('tag=dub&bpm=70-90&aantal=10')).tracks.map((t) => t.id), ['n1']));
  ok('niet', (await lijst('niet=dub&aantal=10')).totaal === 4);
  ok('grid=zeker', (await lijst('grid=zeker&aantal=10')).totaal === 2);
  ok('een fout filter: 400 met reden', (await get('/api/library?bpm=snel')).status === 400 && (await get('/api/library?grid=bijna')).status === 400);
  ok('zonder filter: zoals altijd', (await lijst('aantal=100')).totaal === 7);

  // categorieën
  const c = await post('/api/indeling/categorie', { naam: 'Warm op', soort: 'gewoon', kleur: 'oranje' });
  ok('een categorie maken', c.status === 200 && c.j.categorie.id > 0);
  const cid = c.j.categorie.id;
  ok('dezelfde naam: 409', (await post('/api/indeling/categorie', { naam: 'warm op', soort: 'gewoon' })).status === 409);
  ok('erin', (await post('/api/indeling/categorie/nummers', { id: cid, ids: ['n3', 'n1', 'n5'], aan: true })).j.erin === 3);
  ok('slepen: vóór', (await post('/api/indeling/categorie/nummers', { id: cid, ids: ['n5'], aan: true, voor: 'n3' })).status === 200);
  const pl = await lijst(`cat=${cid}&sorteer=plek&aantal=10`);
  ok('sorteer=plek: de volgorde van de categorie', gelijk(pl.tracks.map((t) => t.id), ['n5', 'n3', 'n1']) && pl.totaal === 3);
  ok('sorteer=plek zonder cat: 400', (await get('/api/library?sorteer=plek')).status === 400);
  ok('cat die niet bestaat: 404', (await get('/api/library?cat=999')).status === 404);
  ok('cat + tag', gelijk((await lijst(`cat=${cid}&tag=dub&sorteer=plek&aantal=10`)).tracks.map((t) => t.id), ['n3', 'n1']));
  const s = await post('/api/indeling/categorie', { naam: 'Dub zeker', soort: 'slim', regel: { tags: { en: ['dub'] }, grid: 'zeker' } });
  ok('slim: maken en vinden', s.status === 200 && (await lijst(`cat=${s.j.categorie.id}&aantal=10`)).totaal === 2);
  ok('slim in slim: 400', (await post('/api/indeling/categorie', { naam: 'x', soort: 'slim', regel: { categorie: s.j.categorie.id } })).status === 400);
  const v = await post('/api/indeling/categorie/volgorde', { ids: [s.j.categorie.id, cid] });
  ok('de volgorde van de categorieën', v.status === 200 && gelijk(v.j.volgorde, [s.j.categorie.id, cid]));
  const st = (await get('/api/indeling/stand')).j;
  ok('de stand: aantallen (ook van slim)', st.categorieen[0].aantal === 2 && st.categorieen[1].aantal === 3 && st.tags[0].aantal === 3);

  // hernoemen, snel, wissen
  ok('snel-tags zetten', gelijk((await post('/api/indeling/tags/snel', { snel: ['Dub', 'nacht'] })).j.snel.slice(0, 2), ['Dub', 'nacht']));
  const h = await post('/api/indeling/tags/tag', { naam: 'dub', nieuw: 'nacht' });
  ok('hernoemen naar een bestaande: 409 met bestaat', h.status === 409 && h.j.bestaat === 'nacht');
  ok('samenvoegen', (await post('/api/indeling/tags/tag', { naam: 'dub', nieuw: 'nacht', samenvoegen: true })).status === 200);
  ok('…de regel en de snel-tag gingen mee', (await lijst(`cat=${s.j.categorie.id}&aantal=10`)).totaal === 2 && (await get('/api/indeling/stand')).j.snel[0] === 'nacht');
  ok('een tag in een regel wissen: 409', (await post('/api/indeling/tags/wis', { naam: 'nacht' })).status === 409);
  ok('een categorie wissen vanaf de iPad: 403', (await post('/api/indeling/categorie/wis', { id: cid }, IPAD)).status === 403);
  ok('een categorie wissen', (await post('/api/indeling/categorie/wis', { id: cid })).j.nummers === 3 && (await get(`/api/library?cat=${cid}`)).status === 404);

  // de kaart
  const k = await post('/api/indeling/categorie/van-kaart', { krat: 'pl:PLnachtwerk' });
  ok('een kaartkrat overnemen: de nummers die binnen zijn, in kratvolgorde', k.status === 200 && k.j.categorie.naam === 'Nachtwerk' && k.j.erin === 2
    && gelijk((await lijst(`cat=${k.j.categorie.id}&sorteer=plek&aantal=10`)).tracks.map((t) => t.id), ['vertrouwd002', 'fourtet0baby']));
  ok('nog eens overnemen: niets dubbel', (await post('/api/indeling/categorie/van-kaart', { krat: 'pl:PLnachtwerk' })).j.erin === 0);
  ok('een krat die niet bestaat: 404', (await post('/api/indeling/categorie/van-kaart', { krat: 'pl:nee' })).status === 404);

  // export / import
  const exp = (await get('/api/indeling')).j;
  ok('export', exp.soort === 'varve-indeling' && exp.categorieen.some((x) => x.naam === 'Nachtwerk' && gelijk(x.nummers, ['vertrouwd002', 'fourtet0baby'])));
  const imp = { categorieen: [{ naam: 'Van Claude', nummers: ['n4', 'n2', 'nee'] }], tags: [{ naam: 'claude', kleur: 'violet' }] };
  const droog = await post('/api/indeling?droog=1', imp);
  ok('import droog: verslag, niets veranderd', droog.status === 200 && droog.j.droog && droog.j.categorieen.nieuw === 1 && droog.j.nummers.onbekend === 1
    && !(await get('/api/indeling/stand')).j.categorieen.some((x) => x.naam === 'Van Claude'));
  ok('import vanaf de iPad: 403', (await post('/api/indeling', imp, IPAD)).status === 403);
  const echt = await post('/api/indeling', imp);
  ok('import', echt.status === 200 && (await get('/api/indeling/stand')).j.categorieen.some((x) => x.naam === 'Van Claude' && x.aantal === 2));
  ok('een nummer weghalen haalt het uit zijn categorieën', (await fetch(`${B}/api/library/n4`, { method: 'DELETE' }).then((r) => r.json())).weg
    && (await get('/api/indeling/stand')).j.categorieen.find((x) => x.naam === 'Van Claude').aantal === 1);
} catch (err) {
  ok(`geen uitzondering (${err.message})`, false);
} finally {
  server.kill();
  await wacht(100);
  rmSync(map, { recursive: true, force: true });
}
if (fails.length) { console.log(serverUit.slice(-2000)); console.log(`\n${fails.length} FOUT(EN): ${fails.join(' | ')}`); process.exit(1); }
console.log('\nAlle checks groen.');
