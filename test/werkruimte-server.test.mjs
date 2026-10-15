// /api/werkruimtes op een EIGEN server (eigen poort, tijdelijke database, VARVE_WERKRUIMTES en
// VARVE_STANDEN in een tijdelijke map; werkruimte S3, docs/werkruimte/S3.md). De lijst (eigen +
// voorbeelden), lezen met ETag, opslaan met versie (409 met wat er nu staat, .versies groeit),
// 400 bij kapotte JSON, een modelfout of een hoofdletter (en dan niets geschreven), een bestand
// dat Claude direct schrijft (de haler van de mixer ziet het bij zijn volgende beurt), en een
// stand met werkruimte: { naam }.
// Draai met: node test/werkruimte-server.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const { maakHaler } = await import('../src/werk/werkruimte.js');
const { normaliseerStand } = await import('../src/standen/stand-model.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const map = mkdtempSync(join(tmpdir(), 'varve-werkruimte-server-'));
const media = join(map, 'media');
const werkMap = join(map, 'werkruimtes');
mkdirSync(media, { recursive: true });

const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: join(media, 'library.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'),
    VARVE_HERANALYSE: 'uit', VARVE_NACHT: join(map, 'nacht.json'), VARVE_STANDEN: join(map, 'standen'), VARVE_WERKRUIMTES: werkMap,
    VARVE_KAART: join(map, 'geen-kaart.json'), VARVE_KAART_DB: join(map, 'kaart.db'), VARVE_HUB_SETS: join(map, 'hub-sets'), VARVE_HOSTS: 'varve-proef.ts.net' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverUit = '';
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const B = `http://localhost:${poort}`;

const get = async (p, headers = {}) => { const r = await fetch(`${B}${p}`, { headers }); const tekst = await r.text(); let j = null; try { j = JSON.parse(tekst); } catch {} return { status: r.status, j, etag: r.headers.get('etag') }; };
const zend = async (methode, p, body, headers = {}) => {
  const r = await fetch(`${B}${p}`, { method: methode, headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const put = (p, body, headers) => zend('PUT', p, body, headers);
const post = (p, body = {}, headers) => zend('POST', p, body, headers);
const versies = (naam) => (existsSync(join(werkMap, '.versies', naam)) ? readdirSync(join(werkMap, '.versies', naam)).length : 0);
const wachtOpServer = async () => { for (let i = 0; i < 200; i++) { if (await fetch(`${B}/api/werkruimtes`).then((r) => r.ok).catch(() => false)) return true; await wacht(100); } return false; };

/** Een pijp vrijgeven: een schrijver openen en sluiten, tot de lezer erop zijn EOF had. */
async function geefVrij(pijp) {
  const { openSync, closeSync, constants } = await import('node:fs');
  for (let i = 0; i < 40; i++) {
    let fd = null;
    try { fd = openSync(pijp, constants.O_WRONLY | constants.O_NONBLOCK); } catch {}
    await wacht(30);
    if (fd !== null) { closeSync(fd); if (i > 2) return; }
  }
}

const mijn = (extra = {}) => ({ schema: 1, naam: 'mijn', titel: 'Mijn proef', stukken: ['basis'],
  delen: { mix: { label: 'MIX', kleur: 'wit', apc40mk2: { grid: 'hotcues' } }, stems: { label: 'STEMS', kleur: 'zeegroen', apc40mk2: { grid: 'stems' } } }, ...extra });

try {
  console.log('de grens van de hele server (review ronde 2: werkruimtes en standen SAMEN hooguit 2)');
  {
    const { Werkruimtes, WerkFout } = await import('../server/werkruimtes.js');
    const { Standen, StandFout, ANDERE_LEZERS } = await import('../server/standen.js');
    const { spawnSync } = await import('node:child_process');
    const g = join(map, 'grens');
    for (const d of ['eigen', 'vb', 'standen']) mkdirSync(join(g, d), { recursive: true });
    const pijpen = ['een', 'twee'].map((n) => join(g, 'eigen', `${n}.json`));
    if (!pijpen.every((p) => spawnSync('mkfifo', [p]).status === 0)) console.log('  -- mkfifo niet beschikbaar: de grens niet getoetst');
    else {
      const w = new Werkruimtes({ map: join(g, 'eigen'), voorbeelden: join(g, 'vb'), stukken: join(g, 'stukken'), mappings: join(g, 'mappings'), leesMs: 200 });
      const st = new Standen({ map: join(g, 'standen'), voorbeelden: join(g, 'vb'), lib: null, nacht: null, kaart: null, leesMs: 200, log: () => {} });
      try {
        const t0 = performance.now();
        const [e1, e2] = await Promise.all([w.lees('een').catch((e) => e), w.lees('twee').catch((e) => e)]);
        ok(`twee hangende werkruimtes: allebei 503 na ${Math.round(performance.now() - t0)} ms, ${ANDERE_LEZERS.size} draden onderweg`,
          e1 instanceof WerkFout && e2 instanceof WerkFout && e1.code === 503 && ANDERE_LEZERS.size === 2 && performance.now() - t0 < 1000);
        let gestart = 0;
        const t1 = performance.now();
        const es = await st._extern('x', async () => { gestart++; return 'x'; }).catch((e) => e);
        ok(`… dan start ook een stand geen nieuwe draad: 503 "te veel tegelijk" (${Math.round(performance.now() - t1)} ms, ${gestart}× gestart)`,
          es instanceof StandFout && es.code === 503 && /te veel bestanden tegelijk/.test(es.message) && gestart === 0);
        const ew = await w.lees('drie').catch((e) => e);
        ok('… en een derde werkruimte ook niet (503)', ew instanceof WerkFout && ew.code === 503);
      } finally {
        await Promise.all(pijpen.map((p) => geefVrij(p)));
      }
      for (let i = 0; i < 50 && ANDERE_LEZERS.size; i++) await wacht(20);
      ok(`pijpen vrij: niets meer onderweg (${ANDERE_LEZERS.size})`, ANDERE_LEZERS.size === 0);
      const nooit = () => new Promise(() => {});
      st._extern('a', nooit).catch(() => {}); st._extern('b', nooit).catch(() => {});
      await wacht(250);
      const ew2 = await w.lees('een').catch((e) => e);
      ok('twee hangende standen: een werkruimte lezen = 503, geen nieuwe draad (de standen tellen mee)', ew2 instanceof WerkFout && ew2.code === 503 && ANDERE_LEZERS.size === 0);
    }
  }

  ok('server draait', await wachtOpServer());

  console.log('lezen');
  const l = await get('/api/werkruimtes');
  ok('GET /api/werkruimtes: de drie voorbeelden met versie', l.status === 200 && ['standaard', 'apc-alleen', 'twee-handen'].every((n) => l.j.werkruimtes.some((w) => w.naam === n && w.bron === 'voorbeeld' && /^[0-9a-f]{16}$/.test(w.versie))));
  ok('… met hun aantal delen (standaard 0, apc-alleen 8) en 0 fouten', l.j.werkruimtes.find((w) => w.naam === 'standaard').delen === 0
    && l.j.werkruimtes.find((w) => w.naam === 'apc-alleen').delen === 8 && l.j.werkruimtes.every((w) => w.fouten === 0));
  const a = await get('/api/werkruimtes/apc-alleen');
  ok('GET apc-alleen: ruw, genormaliseerd, versie, bron voorbeeld, ETag', a.status === 200 && a.j.ruw.naam === 'apc-alleen' && a.j.werkruimte.deel.kiezen === 'volgt'
    && a.j.bron === 'voorbeeld' && /^[0-9a-f]{16}$/.test(a.j.versie) && !!a.etag);
  ok('… zonder fouten, met waarschuwingen voor de stukken die er nog niet zijn', a.j.fouten.length === 0 && Array.isArray(a.j.waarschuwingen));
  ok('… met If-None-Match: 304 (de peilbeurt van de mixer)', (await get('/api/werkruimtes/apc-alleen', { 'If-None-Match': a.etag })).status === 304);
  ok('GET een naam met een hoofdletter: 400', (await get('/api/werkruimtes/Twee')).status === 400);
  ok('GET een naam die niet bestaat: 404', (await get('/api/werkruimtes/bestaatniet')).status === 404);
  ok('GET ../ in de naam: 400', (await get('/api/werkruimtes/..%2fmedia')).status === 400 || (await get('/api/werkruimtes/..%2fmedia')).status === 403);

  console.log('\nopslaan');
  const p1 = await put('/api/werkruimtes/mijn', { werkruimte: mijn(), versie: null });
  ok('PUT een nieuwe zonder versie: 200, bron eigen, versie', p1.status === 200 && p1.j.bron === 'eigen' && /^[0-9a-f]{16}$/.test(p1.j.versie));
  ok('… het bestand staat er, ingesprongen, zoals het binnenkwam', JSON.parse(readFileSync(join(werkMap, 'mijn.json'), 'utf8')).titel === 'Mijn proef'
    && readFileSync(join(werkMap, 'mijn.json'), 'utf8').includes('\n  "naam"'));
  ok('… geen .versies bij een nieuw bestand', versies('mijn') === 0);
  const z = await put('/api/werkruimtes/mijn', { werkruimte: mijn({ titel: 'zonder versie' }) });
  ok('PUT zonder versie terwijl hij bestaat: 409 met de huidige inhoud', z.status === 409 && z.j.versie === p1.j.versie && z.j.ruw.titel === 'Mijn proef' && z.j.werkruimte.naam === 'mijn');
  const p2 = await put('/api/werkruimtes/mijn', { werkruimte: mijn({ titel: 'twee' }), versie: p1.j.versie });
  ok('PUT met de goede versie: 200, nieuwe versie', p2.status === 200 && p2.j.versie !== p1.j.versie);
  ok('… .versies/mijn bewaart de vorige (1)', versies('mijn') === 1);
  const oud = await put('/api/werkruimtes/mijn', { werkruimte: mijn({ titel: 'oud' }), versie: p1.j.versie });
  ok('PUT met een oude versie: 409 met de huidige inhoud en versie', oud.status === 409 && oud.j.versie === p2.j.versie && oud.j.ruw.titel === 'twee');
  const p3 = await put('/api/werkruimtes/mijn', { werkruimte: mijn({ titel: 'drie' }), versie: p2.j.versie });
  ok('… nog eens opslaan: .versies groeit (2)', p3.status === 200 && versies('mijn') === 2);
  ok('GET …/mijn/versies: twee, nieuwste eerst', await (async () => { const v = await get('/api/werkruimtes/mijn/versies'); return v.status === 200 && v.j.versies.length === 2 && v.j.versies[0] > v.j.versies[1]; })());

  console.log('\nweigeren, en dan niets geschreven');
  const voor = readFileSync(join(werkMap, 'mijn.json'), 'utf8');
  const kapot = await put('/api/werkruimtes/mijn', '{ "werkruimte": { kapot');
  ok('kapotte JSON: 400', kapot.status === 400);
  const fout = await put('/api/werkruimtes/mijn', { werkruimte: mijn({ verberg: ['stems'] }), versie: p3.j.versie });
  ok('een fout uit het model (verberg): 400 met de reden', fout.status === 400 && /verberg/.test(fout.j.fout) && fout.j.fouten.length >= 1);
  const kern = await put('/api/werkruimtes/mijn', { werkruimte: mijn({ regels: { apc40mk2: [{ in: 'cc:0:7', action: 'track.1.send.a', mode: 'absolute' }] } }), versie: p3.j.versie });
  ok('een regel op de kern: 400', kern.status === 400 && /de kern/.test(kern.j.fout));
  const negen = await put('/api/werkruimtes/mijn', { werkruimte: mijn({ delen: Object.fromEntries('abcdefghi'.split('').map((c) => [`d${c}`, { label: c, kleur: 'wit' }])) }), versie: p3.j.versie });
  ok('negen delen: 400', negen.status === 400 && /hooguit 8/.test(negen.j.fout));
  ok('… na al die weigeringen: het bestand en .versies onveranderd', readFileSync(join(werkMap, 'mijn.json'), 'utf8') === voor && versies('mijn') === 2);
  const hoofd = await put('/api/werkruimtes/Mijn', { werkruimte: { ...mijn(), naam: 'Mijn' }, versie: null });
  ok('een naam met een hoofdletter: 400, niets geschreven', hoofd.status === 400
    // Op de naam in de map, niet met existsSync: APFS is hoofdletterongevoelig, dan "bestaat" Mijn.json omdat mijn.json er staat.
    && !readdirSync(werkMap).includes('Mijn.json') && !readdirSync(werkMap).some((f) => /^Mijn/i.test(f) && f !== 'mijn.json'));
  ok('een andere naam in het bestand dan in het adres: 400', (await put('/api/werkruimtes/ander', { werkruimte: mijn(), versie: null })).status === 400 && !existsSync(join(werkMap, 'ander.json')));
  ok('PUT als text/plain: 415', (await put('/api/werkruimtes/mijn', JSON.stringify({ werkruimte: mijn(), versie: p3.j.versie }), { 'Content-Type': 'text/plain' })).status === 415);
  ok('POST op een werkruimte: niet (415 zonder JSON, 405 met)', (await post('/api/werkruimtes/mijn', {})).status === 405);
  ok('een andere oorsprong: 403', (await put('/api/werkruimtes/mijn', { werkruimte: mijn(), versie: p3.j.versie }, { Origin: 'http://evil.example' })).status === 403);
  // W1: de iPad (via Tailscale) kijkt alleen. fetch zet geen eigen Host, dus node:http.
  const viaTailnet = (methode, body) => new Promise((klaar) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = request({ host: '127.0.0.1', port: poort, path: '/api/werkruimtes/mijn', method: methode,
      headers: { Host: 'varve-proef.ts.net', Origin: 'https://varve-proef.ts.net', 'tailscale-user-login': 'clay@example', ...(data ? { 'Content-Type': 'application/json' } : {}) } },
    (a) => { a.resume(); a.on('end', () => klaar(a.statusCode)); });
    r.on('error', () => klaar(0)); if (data) r.write(data); r.end();
  });
  const voorTailnet = readFileSync(join(werkMap, 'mijn.json'), 'utf8');
  ok('W1: lezen via de tailnet (de iPad) mag: 200', (await viaTailnet('GET')) === 200);
  ok('W1: opslaan via de tailnet (de iPad): 403, niets geschreven', (await viaTailnet('PUT', { werkruimte: mijn({ titel: 'van de iPad' }), versie: p3.j.versie })) === 403
    && readFileSync(join(werkMap, 'mijn.json'), 'utf8') === voorTailnet);
  ok('W1: opslaan met een proxykop (x-forwarded-for) op localhost: 403', (await put('/api/werkruimtes/mijn', { werkruimte: mijn(), versie: p3.j.versie }, { 'X-Forwarded-For': '100.64.0.2' })).status === 403);
  ok('PUT zonder werkruimte: 400', (await put('/api/werkruimtes/mijn', { versie: p3.j.versie })).status === 400);

  console.log('\neen voorbeeld aanpassen');
  const ruwA = a.j.ruw;
  const pa = await put('/api/werkruimtes/apc-alleen', { werkruimte: { ...ruwA, titel: 'mijn APC' }, versie: a.j.versie });
  ok('PUT apc-alleen met de versie van het voorbeeld: 200, nu eigen', pa.status === 200 && pa.j.bron === 'eigen' && existsSync(join(werkMap, 'apc-alleen.json')));
  const ga = await get('/api/werkruimtes/apc-alleen');
  ok('een eigen bestand gaat vóór het voorbeeld', ga.j.bron === 'eigen' && ga.j.ruw.titel === 'mijn APC');
  ok('… ook in de lijst', (await get('/api/werkruimtes')).j.werkruimtes.find((w) => w.naam === 'apc-alleen').bron === 'eigen');
  ok('het voorbeeld in git is niet veranderd', JSON.parse(readFileSync('tools/werkruimtes/voorbeelden/apc-alleen.json', 'utf8')).titel === 'Alleen de APC (onderweg)');

  console.log('\nClaude schrijft het bestand direct');
  {
    const haal = maakHaler({ fetch: (u, o) => fetch(`${B}${u}`, o), leesWeg: (r) => r.text?.().catch(() => {}) });
    const eerst = await haal('mijn');
    const stil = await haal('mijn', { peil: true });
    ok('de haler: eerst de werkruimte, dan peilen = 304 (niets)', eerst.versie === p3.j.versie && eerst.werkruimte.titel === 'drie' && stil.niets === true);
    writeFileSync(join(werkMap, 'mijn.json'), JSON.stringify(mijn({ titel: 'van Claude' }), null, 2));
    const t0 = Date.now();
    const daarna = await haal('mijn', { peil: true });
    ok(`de volgende peilbeurt ziet het nieuwe bestand (${Date.now() - t0} ms; de mixer peilt elke 3 s)`, daarna.werkruimte?.titel === 'van Claude' && daarna.versie !== p3.j.versie);
    const gezien = await put('/api/werkruimtes/mijn', { werkruimte: mijn({ titel: 'over Claude heen' }), versie: p3.j.versie });
    ok('… en wie nog op de oude versie werkte krijgt 409 (niets overschreven)', gezien.status === 409 && gezien.j.ruw.titel === 'van Claude');
  }

  console.log('\niCloud: een werkruimte die niet terugkomt (review ronde 2)');
  {
    // Een named pipe blijft bij het openen hangen, zoals een dataless iCloud-bestand zonder netwerk.
    const { spawnSync } = await import('node:child_process');
    const fifo = join(werkMap, 'hangt.json');
    mkdirSync(werkMap, { recursive: true });
    if (spawnSync('mkfifo', [fifo]).status !== 0) console.log('  -- mkfifo niet beschikbaar: 503 over HTTP niet getoetst');
    else {
      const t0 = performance.now();
      const r = await get('/api/werkruimtes/hangt');
      const ms = performance.now() - t0;
      ok(`GET /api/werkruimtes/hangt (een pijp): 503 "niet lokaal beschikbaar (iCloud?)" na ${Math.round(ms)} ms (LEES_MS 2 s)`, r.status === 503 && /iCloud/.test(r.j?.fout) && ms < 3500);
      const t1 = performance.now();
      const r2 = await get('/api/werkruimtes/hangt');
      ok(`… de volgende peil meteen 503 (${Math.round(performance.now() - t1)} ms), geen tweede draad`, r2.status === 503 && performance.now() - t1 < 500);
      const lijst = await get('/api/werkruimtes');
      ok('… de lijst antwoordt, met "hangt" als fout', lijst.status === 200 && lijst.j.werkruimtes.some((w) => w.naam === 'hangt' && w.fouten === 1));
      const stand = await get('/api/standen');
      ok(`… en de standen lezen nog (${stand.status})`, stand.status === 200);
      await geefVrij(fifo);
      rmSync(fifo, { force: true });
    }
  }

  console.log('\nstanden');
  ok('normaliseerStand: werkruimte { naam } is goed', (() => { const r = normaliseerStand({ schema: 1, delen: { werkruimte: { naam: 'apc-alleen' } } }); return r.fouten.length === 0 && r.stand.delen.werkruimte.naam === 'apc-alleen'; })());
  ok('normaliseerStand: een naam met een hoofdletter = fout', normaliseerStand({ schema: 1, delen: { werkruimte: { naam: 'APC' } } }).fouten.some((f) => f.deel === 'werkruimte'));
  ok('normaliseerStand: een vreemde sleutel = fout', normaliseerStand({ schema: 1, delen: { werkruimte: { naam: 'apc-alleen', deel: 'fx' } } }).fouten.some((f) => f.deel === 'werkruimte'));
  const s1 = await put('/api/standen/onderweg', { stand: { schema: 1, titel: 'onderweg', delen: { werkruimte: { naam: 'apc-alleen' } } }, versie: null });
  ok('een stand met werkruimte: opslaan 200', s1.status === 200);
  const s2 = await put('/api/standen/kapot', { stand: { schema: 1, delen: { werkruimte: { naam: 'Twee Handen' } } }, versie: null });
  ok('… met een ongeldige naam: 400', s2.status === 400);
  const ac = await post('/api/standen/onderweg/activeer');
  ok('activeren: de werkruimte staat bij de mixer (verslag.mixer)', ac.status === 200 && ac.j.verslag.mixer.includes('werkruimte'));
  const act = await get('/api/standen/actief');
  ok('… /api/standen/actief: mixer.werkruimte.naam = apc-alleen, met sinds', act.j.mixer?.werkruimte?.naam === 'apc-alleen' && typeof act.j.mixer.werkruimte.sinds === 'string');
  const s3 = await put('/api/standen/raar', { stand: { schema: 1, delen: { werkruimte: { naam: 'bestaatniet' } } }, versie: null });
  ok('een werkruimte die er niet is: opslaan mag, met een waarschuwing', s3.status === 200 && JSON.stringify(s3.j).includes('geen werkruimte'));
  const vs = await get('/api/standen/onderweg/verschil');
  ok('verschil: werkruimte "bij de volgende start van de mixer"', vs.status === 200 && vs.j.delen.werkruimte?.naar === 'apc-alleen');
} catch (err) {
  fails.push(String(err?.stack || err));
  console.log(err);
} finally {
  server.kill('SIGTERM');
  await Promise.race([new Promise((z) => server.on('exit', z)), wacht(5000)]);
  if (fails.length) console.log('\n--- server ---\n' + serverUit.split('\n').slice(-40).join('\n'));
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT` : '\nalles groen');
process.exit(fails.length ? 1 : 0);
