// Spoor S9 (docs/PLAN-SET.md §3 en §6): /api/sets en /api/set/* op een EIGEN server (eigen poort,
// tijdelijke database en VARVE_SETS/PLANNEN/PATRONEN in een tijdelijke map). Sets opslaan met versie
// (409 met wat er nu staat, .versies groeit), kopiëren, hernoemen, alleen vanaf deze Mac, een oud of
// rommelig bestand dat toch laadt (en waarin niets start), klaar-voor-de-set, en "maak klaar" dat
// weigert op een speeldag en terwijl er een deck speelt.
// Draai met: node test/sets-server.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const map = mkdtempSync(join(tmpdir(), 'varve-sets-server-'));
const media = join(map, 'media');
const setsMap = join(map, 'sets');
mkdirSync(join(media, 'b'), { recursive: true });

// Een library met twee nummers: a met een zeker grid, toon en secties met de hand; b onzeker, zonder.
const { Library } = await import('../server/library.js');
{
  const lib = new Library(join(media, 'library.db'));
  for (const [id, z] of [['a', 0.9], ['b', 0.1]]) {
    lib.bewaarTrack({ id, url: `https://www.youtube.com/watch?v=${id}xxxxxxxxxx`.slice(0, 43), titel: `nummer ${id}`, duur: 200, audio: `media/${id}/audio.wav`, video: id === 'a' ? `media/${id}/video.mp4` : null });
    lib.bewaarGrid(id, { stukken: [{ van: 0, bpm: 124, anker: 0, zekerheid: z }] });
    lib.bewaarToon(id, { stukken: [{ van: 0, toonsoort: 'Am', zekerheid: z }], bron: 'auto' });
  }
  lib.bewaarSecties('a', { stukken: [{ van: 0, label: 'intro', groep: 'A' }, { van: 60, label: 'drop', groep: 'B' }], bron: 'hand' });
  lib.db.close?.();
}
// Een klein audio.wav voor b: een Range-verzoek erop = "er speelt een deck".
{
  const n = 4800, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(192000, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  writeFileSync(join(media, 'b', 'audio.wav'), buf);
}

const poort = 20000 + Math.floor(Math.random() * 20000);
const nachtPad = join(map, 'nacht.json');
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: join(media, 'library.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'),
    VARVE_HERANALYSE: 'uit', VARVE_NACHT: nachtPad, VARVE_STANDEN: join(map, 'standen'), VARVE_WERKRUIMTES: join(map, 'werkruimtes'), VARVE_SETS: setsMap,
    VARVE_KAART: join(map, 'geen-kaart.json'), VARVE_KAART_DB: join(map, 'kaart.db'), VARVE_HUB_SETS: join(map, 'hub-sets'), VARVE_HOSTS: 'varve-proef.ts.net',
    VARVE_STEMS_PY: join(map, 'geen-python') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverUit = '';
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const B = `http://localhost:${poort}`;
const get = async (p, headers = {}) => { const r = await fetch(`${B}${p}`, { headers }); return { status: r.status, j: await r.json().catch(() => null) }; };
const zend = async (methode, p, body, headers = {}) => {
  const r = await fetch(`${B}${p}`, { method: methode, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const versies = (naam) => (existsSync(join(setsMap, '.versies', naam)) ? readdirSync(join(setsMap, '.versies', naam)).length : 0);
const wachtOpServer = async () => { for (let i = 0; i < 200; i++) { if (await fetch(`${B}/api/sets`).then((r) => r.ok).catch(() => false)) return true; await wacht(100); } return false; };

const set = (extra = {}) => ({ naam: 'vrijdag', uitleg: 'proef',
  plan: { naam: 'vrijdag', tracks: { auto: [1, 2] }, stappen: [{ id: 's1', track: 'a' }, { id: 's2', track: 'b', go: 'wacht' }] },
  patronen: { naam: 'set', set: { tempo: 128 } }, werkruimte: 'twee-handen',
  momentopname: { focus: 1, tracks: [{ track: 1, bron: 'library', nummer: 'a', positie: 30, speelt: true, wacht: true, cue: 2, hotcues: [1, null, 3, null] }, { track: 2, bron: 'leeg' }],
    waarden: { 'track.1.fader': 0.8, 'mixer.xfader': 0.5 }, pads: [{ track: 1, van: 1, tot: 3, speelt: true }], patronen: { speelt: [{ track: 3, plek: 1 }] } },
  ...extra });

try {
  ok('de server start', await wachtOpServer());

  console.log('sets: opslaan met versie');
  {
    const leeg = await get('/api/sets');
    ok('nog geen sets', leeg.status === 200 && leeg.j.sets.length === 0);
    const r1 = await zend('PUT', '/api/sets/vrijdag', { set: set(), versie: null });
    ok(`nieuw opslaan: 200 met een versie (${r1.status})`, r1.status === 200 && typeof r1.j.versie === 'string');
    ok('... de momentopname start niets: speelt/wacht false, pads stil, geen patronen', r1.j.set.momentopname.tracks[0].speelt === false
      && r1.j.set.momentopname.tracks[0].wacht === false && r1.j.set.momentopname.pads[0].speelt === false && r1.j.set.momentopname.patronen.speelt.length === 0);
    ok('... plan en patronen als kopie, werkruimte op naam', r1.j.set.plan.stappen[1].go === 'wacht' && r1.j.set.patronen.set.tempo === 128 && r1.j.set.werkruimte === 'twee-handen');
    const l = await get('/api/sets');
    ok(`de lijst: naam, 2 nummers, een duur, met momentopname (${JSON.stringify(l.j.sets[0])})`, l.j.sets.length === 1 && l.j.sets[0].naam === 'vrijdag'
      && l.j.sets[0].nummers === 2 && l.j.sets[0].duur > 100 && l.j.sets[0].moment === true);
    const dubbel = await zend('PUT', '/api/sets/vrijdag', { set: set(), versie: null });
    ok('nog eens als nieuw: 409 met wat er nu staat', dubbel.status === 409 && dubbel.j.versie === r1.j.versie && dubbel.j.set?.naam === 'vrijdag');
    const r2 = await zend('PUT', '/api/sets/vrijdag', { set: set({ uitleg: 'tweede' }), versie: r1.j.versie });
    ok('met de goede versie: 200, en de vorige staat in .versies', r2.status === 200 && versies('vrijdag') === 1);
    const oud = await zend('PUT', '/api/sets/vrijdag', { set: set({ uitleg: 'botst' }), versie: r1.j.versie });
    ok('met een oude versie: 409, niets overschreven', oud.status === 409 && (await get('/api/sets/vrijdag')).j.set.uitleg === 'tweede');
    const ver = await get('/api/sets/vrijdag/versies');
    ok('GET versies', ver.status === 200 && ver.j.versies.length === 1);
    const ipad = await zend('PUT', '/api/sets/vrijdag', { set: set(), versie: r2.j.versie }, { Host: 'varve-proef.ts.net', Origin: 'https://varve-proef.ts.net' });
    ok(`opslaan via Tailscale (de iPad): 403 (${ipad.status})`, ipad.status === 403);
    ok('lezen via Tailscale mag', (await get('/api/sets/vrijdag', { Host: 'varve-proef.ts.net' })).status === 200);
    ok('een naam met een hoofdletter: 400', (await zend('PUT', '/api/sets/Vrijdag', { set: set(), versie: null })).status === 400);

    const k = await zend('POST', '/api/sets/vrijdag/kopie', { naar: 'zaterdag' });
    ok('kopiëren', k.status === 200 && (await get('/api/sets/zaterdag')).j.set.uitleg === 'tweede');
    ok('kopiëren naar een naam die al bestaat: 409', (await zend('POST', '/api/sets/vrijdag/kopie', { naar: 'zaterdag' })).status === 409);
    const v = (await get('/api/sets/zaterdag')).j.versie;
    ok('hernoemen met een oude versie: 409', (await zend('POST', '/api/sets/zaterdag/hernoem', { naar: 'zondag', versie: 'oud' })).status === 409);
    const h = await zend('POST', '/api/sets/zaterdag/hernoem', { naar: 'zondag', versie: v });
    ok('hernoemen: de nieuwe bestaat, de oude niet (en staat in .versies)', h.status === 200 && (await get('/api/sets/zondag')).status === 200
      && (await get('/api/sets/zaterdag')).status === 404 && versies('zaterdag') === 1);

    // Kruisend hernoemen (review S9 a-K1): a→b en b→a tegelijk mag niet vastlopen.
    await zend('PUT', '/api/sets/kruis-a', { set: set({ uitleg: 'a' }), versie: null });
    await zend('PUT', '/api/sets/kruis-b', { set: set({ uitleg: 'b' }), versie: null });
    const va = (await get('/api/sets/kruis-a')).j.versie, vb = (await get('/api/sets/kruis-b')).j.versie;
    const tijd = (p, ms) => Promise.race([p, new Promise((z) => setTimeout(() => z({ status: 'hangt' }), ms))]);
    const [x, y] = await Promise.all([tijd(zend('POST', '/api/sets/kruis-a/hernoem', { naar: 'kruis-b', versie: va }), 4000),
      tijd(zend('POST', '/api/sets/kruis-b/hernoem', { naar: 'kruis-a', versie: vb }), 4000)]);
    ok(`kruisend hernoemen hangt niet (${x.status}, ${y.status}: allebei 409, de doelnaam bestaat)`, x.status === 409 && y.status === 409);
    ok('... en daarna gaat opslaan gewoon', (await zend('PUT', '/api/sets/kruis-a', { set: set({ uitleg: 'na' }), versie: va })).status === 200);

    // Een oud of vreemd bestand, door Claude of een oudere versie geschreven.
    writeFileSync(join(setsMap, 'oud.json'), JSON.stringify({ schema: 7, naam: 'oud', plan: { stappen: [{ track: 'a' }, { geen: 1 }] },
      momentopname: { tracks: [{ track: 9 }, { track: 1, bron: 'library', nummer: 'a', speelt: true }] }, onbekend: true }));
    const o = await get('/api/sets/oud');
    ok(`een oud bestand laadt toch, met fouten (${o.j?.fouten?.length})`, o.status === 200 && o.j.set.plan.stappen.length === 1 && o.j.fouten.some((f) => /schema 7/.test(f))
      && o.j.set.momentopname.tracks.length === 1 && o.j.set.momentopname.tracks[0].speelt === false);
    writeFileSync(join(setsMap, 'kapot.json'), '{ niet');
    const kp = await get('/api/sets/kapot');
    ok('kapotte JSON: set null met de fout, de lijst valt niet om', kp.status === 200 && kp.j.set === null && (await get('/api/sets')).j.sets.some((s) => s.naam === 'kapot' && s.kapot));
  }

  console.log('\nklaar voor de set');
  {
    const r = await zend('POST', '/api/set/klaar', { ids: ['a', 'b', 'c'] });
    const [a, b, c] = r.j.nummers;
    ok(`a: grid en toon zeker, secties ja, video (${JSON.stringify(a)})`, a.grid === 'zeker' && a.toon === 'zeker' && a.secties === 'ja' && a.video === true && a.stems === null);
    ok(`b: grid onzeker, toon gegokt, geen secties, geen video (${JSON.stringify(b)})`, b.grid === 'onzeker' && b.toon === 'gok' && b.secties === 'geen' && b.video === false);
    ok('c bestaat niet', c.bestaat === false);
    ok('klaar mag ook van de iPad (alleen lezen)', (await zend('POST', '/api/set/klaar', { ids: ['a'] }, { Host: 'varve-proef.ts.net', Origin: 'https://varve-proef.ts.net' })).status === 200);
    ok('maak klaar via Tailscale: 403', (await zend('POST', '/api/set/klaarmaken', { ids: ['b'] }, { Host: 'varve-proef.ts.net', Origin: 'https://varve-proef.ts.net' })).status === 403);
    // Een speeldag: vandaag in de speeldagen van de nacht (via de route van de nacht).
    const vandaag = new Date();
    const d = `${vandaag.getFullYear()}-${String(vandaag.getMonth() + 1).padStart(2, '0')}-${String(vandaag.getDate()).padStart(2, '0')}`;
    const z = await zend('POST', '/api/nacht', { speeldagen: [d] });
    const sd = await zend('POST', '/api/set/klaarmaken', { ids: ['b'] });
    ok(`op een speeldag: 409 (${z.status}, ${sd.status} ${sd.j?.fout})`, sd.status === 409 && /speeldag/.test(sd.j?.fout ?? ''));
    await zend('POST', '/api/nacht', { speeldagen: [] });
    // Er speelt een deck: een Range-verzoek op een audio.wav.
    await fetch(`${B}/media/b/audio.wav`, { headers: { Range: 'bytes=0-99' } }).then((x) => x.arrayBuffer());
    const sp = await zend('POST', '/api/set/klaarmaken', { ids: ['b'] });
    ok(`er speelt een deck: 409 (${sp.status} ${sp.j?.fout})`, sp.status === 409 && /deck/.test(sp.j?.fout ?? ''));
  }

  console.log('\nde live-stand');
  {
    const r = await zend('POST', '/api/set/live', { stand: { tekst: { nu: 'NU x' } } });
    ok('de mixer zendt: nog geen kijker', r.status === 200 && r.j.kijker === false);
    const g = await get('/api/set/live', { Host: 'varve-proef.ts.net' });
    ok('de iPad leest de stand', g.status === 200 && g.j.stand?.tekst?.nu === 'NU x');
    ok('... en daarna weet de mixer dat er gekeken wordt', (await zend('POST', '/api/set/live', { stand: {} })).j.kijker === true);
    ok('zenden via Tailscale: 403', (await zend('POST', '/api/set/live', { stand: {} }, { Host: 'varve-proef.ts.net', Origin: 'https://varve-proef.ts.net' })).status === 403);
  }
} catch (err) {
  fails.push(`gooide: ${err.stack}`);
  console.log(err);
} finally {
  server.kill();
  await wacht(200);
  if (fails.length) console.log(serverUit.split('\n').slice(-30).join('\n'));
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT:\n  ${fails.join('\n  ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
