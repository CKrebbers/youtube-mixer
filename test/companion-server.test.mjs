// De companion (companion.html, docs/COMPANION.md) tegen EIGEN servers: eigen
// poorten, lege tijdelijke database, de nep-kaart (test/nep-kaart.mjs) en de
// nep-yt-dlp (geen byte van internet). Twee servers: één met VARVE_HOSTS (zoals
// via Tailscale) en één zonder (de opstartregel die zegt dat de iPhone een 403
// krijgt). Daarna de stappen die de companion zelf zet, met de pure functies
// uit companion-lijst.js: wens, kies uit kandidaten, haal nu (geweigerd op een
// speeldag) en de speeldag-knop (alleen toevoegen).
// Draai met: node test/companion-server.test.mjs
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const L = await import('../src/companion/companion-lijst.js');
const { maakNepYtdlp } = await import('./nep-ytdlp.mjs');
const { schrijfKaart, NUMMERS } = await import('./nep-kaart.mjs');
const { datumVan, nachtDatum } = await import('../server/nacht.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const TS = 'varve.proef-net.ts.net';
const map = mkdtempSync(join(tmpdir(), 'varve-companion-server-'));
const kaartPad = join(map, 'varve-kaart.json');
const nepLog = join(map, 'nep.log');
schrijfKaart(kaartPad);
const nepYtdlp = maakNepYtdlp(map);

/** Een server met alles in een eigen submap; `hosts` = VARVE_HOSTS of niets. */
function startServer(naam, { hosts = null } = {}) {
  const m = join(map, naam);
  mkdirSync(join(m, 'media'), { recursive: true });
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(poort), VARVE_DB: join(m, 'media', 'library.db'), VARVE_MEDIA: join(m, 'media'),
    VARVE_OPNAMES: join(m, 'opnames'), VARVE_PLANNEN: join(m, 'plannen'), VARVE_PATRONEN: join(m, 'patronen'),
    VARVE_PROEF: join(m, 'proef'), VARVE_BACKUPS: join(m, 'backups'), VARVE_HERANALYSE: 'uit',
    VARVE_YTDLP: nepYtdlp, NEP_LOG: nepLog, VARVE_KAART: kaartPad };
  delete env.VARVE_HOSTS;
  if (hosts) env.VARVE_HOSTS = hosts;
  const proc = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { poort, proc, uit: '', B: `http://localhost:${poort}` };
  proc.stdout.on('data', (d) => { s.uit += d; });
  proc.stderr.on('data', (d) => { s.uit += d; });
  return s;
}
const klaar = async (s) => {
  for (let i = 0; i < 200; i++) { if (await fetch(`${s.B}/api/kaart`).then((r) => r.ok).catch(() => false)) return true; await wacht(100); }
  return false;
};
/** fetch laat geen eigen Host toe; dit stuurt de koppen letterlijk. */
const rauw = (s, pad, { method = 'GET', headers = {}, body = null } = {}) => new Promise((z) => {
  const rq = request({ host: '127.0.0.1', port: s.poort, path: pad, method, headers }, (res) => {
    const delen = [];
    res.on('data', (d) => delen.push(d));
    res.on('end', () => z({ status: res.statusCode, body: Buffer.concat(delen).toString() }));
  });
  rq.on('error', (e) => z({ status: 0, body: String(e) }));
  if (body) rq.write(body);
  rq.end();
});

const met = startServer('met', { hosts: TS });
const zonder = startServer('zonder');
const B = met.B;
const get = async (p) => { const r = await fetch(`${B}${p}`); return { status: r.status, j: await r.json().catch(() => null) }; };
const post = async (p, body) => {
  const r = await fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};

try {
  ok('twee servers draaien (met en zonder VARVE_HOSTS)', (await klaar(met)) && (await klaar(zonder)));

  console.log('de pagina en zijn bestanden');
  const html = await (await fetch(`${B}/companion`)).text();
  ok('/companion geeft companion.html met het module-script', html.includes('<script type="module" src="/src/companion/companion.js">'));
  ok('/companion.html ook; /companion.htm en /companion/ niet', (await fetch(`${B}/companion.html`)).status === 200
    && (await fetch(`${B}/companion.htm`)).status === 404 && (await fetch(`${B}/companion/`)).status === 404);
  const bestanden = ['/src/companion/companion.js', '/src/companion/companion-lijst.js', '/src/companion/companion.css', '/mappings/companion.json'];
  const codes = await Promise.all(bestanden.map((p) => fetch(`${B}${p}`).then((r) => r.status)));
  ok(`script, rekenwerk, opmaak en indeling komen door (${codes.join(' ')})`, codes.every((c) => c === 200));
  const cfg = L.leesConfig(await (await fetch(`${B}/mappings/companion.json`)).json());
  ok('de indeling die de server geeft leest zonder fouten', cfg.fouten.length === 0 && cfg.config.tabs.length === 3);

  console.log('\nvia Tailscale (Host = de ts.net-naam, zoals tailscale serve hem aflevert)');
  ok('met VARVE_HOSTS: GET /companion met Host ts-naam = 200', (await rauw(met, '/companion', { headers: { Host: TS } })).status === 200);
  ok('... en GET /api/kaart ook', (await rauw(met, '/api/kaart', { headers: { Host: TS } })).status === 200);
  const viaTs = await rauw(met, '/api/kaart/wens', { method: 'POST', headers: { Host: TS, Origin: `https://${TS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sleutels: ['yt:vertrouwd002'] }) });
  ok('een wens vanaf de iPhone (Host en Origin = ts-naam) = 200, op de wenslijst',
    viaTs.status === 200 && JSON.parse(viaTs.body).toegevoegd?.includes('yt:vertrouwd002'));
  ok('Origin van een vreemde site: 403', (await rauw(met, '/api/kaart/wens', { method: 'POST',
    headers: { Host: TS, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"sleutels":[]}' })).status === 403);
  ok('zonder VARVE_HOSTS: Host ts-naam = 403 (dat is wat de opstartregel waarschuwt)',
    (await rauw(zonder, '/companion', { headers: { Host: TS } })).status === 403);
  ok('opstartregel met VARVE_HOSTS: "ook via", geen waarschuwing', met.uit.includes(`ook via  ·  https://${TS}`) && !met.uit.includes('VARVE_HOSTS is leeg'));
  ok('opstartregel zonder: "VARVE_HOSTS is leeg: iPad en iPhone krijgen 403"', zonder.uit.includes('VARVE_HOSTS is leeg: iPad en iPhone krijgen 403'));

  console.log('\nde kaart zoals de companion hem vraagt');
  const k = await get('/api/kaart');
  ok(`geladen, ${k.j?.aantal} nummers`, k.status === 200 && k.j.status === 'geladen' && k.j.aantal === NUMMERS.length);
  const kiezer = L.kratOptiesCompanionHtml(k.j.kratten, '', k.j.aantal, { config: cfg.config.kaart.kratten_bovenaan });
  const waarden = [...kiezer.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  ok(`kratkiezer: proefkrat, eigen keuze, vertrouwd bovenaan (${waarden.slice(1, 4).join(', ')})`,
    waarden.slice(1, 4).join() === 'slim:proefkrat,slim:eigen-keuze,slim:vertrouwd');
  const pagina = await get('/api/kaart/nummers?sorteer=beurten&richting=af&van=0&aantal=5');
  ok('een pagina van 5 met totaal (voor "meer")', pagina.status === 200 && pagina.j.nummers.length === 5 && pagina.j.totaal === NUMMERS.length);
  const alle = (await get(`/api/kaart/nummers?sorteer=beurten&richting=af&van=0&aantal=${L.PAGINA}`)).j.nummers;
  const rijen = alle.map((n) => L.rijHtml(n));
  ok('elke rij van de server tekent, zonder meteen/bevestig/zoek-knop', rijen.length === NUMMERS.length
    && rijen.every((h) => !/data-(meteen|bevestig|zoek|weg)\b/.test(h)));
  ok('de rij van de wens via Tailscale staat op wacht, zonder knop', /data-stand="wacht"/.test(L.rijHtml(alle.find((n) => n.sleutel === 'yt:vertrouwd002')))
    && !/<button/.test(L.rijHtml(alle.find((n) => n.sleutel === 'yt:vertrouwd002'))));

  console.log('\nkies: de laptop zocht, de iPad kiest');
  const SP = 'sp:sp0000000002';   // Nils Frahm, alleen Spotify: eerst zoeken
  const w = await post('/api/kaart/wens', { sleutels: [SP] });
  ok('wens op een nummer zonder video: op de wenslijst', w.status === 200 && w.j.toegevoegd.includes(SP));
  const z = await post(`/api/kaart/nummer/${encodeURIComponent(SP)}/zoek`, {});   // wat de laptop doet (nep-yt-dlp)
  ok(`de laptop zocht: ${z.j?.kandidaten?.length} kandidaten`, z.status === 200 && z.j.kandidaten.length > 0);
  const wensen = (await get('/api/kaart/wensen')).j.wensen;
  const per = L.kandidatenPerSleutel(wensen);
  ok('GET /api/kaart/wensen geeft de kandidaten mee (W4c: kies kan op de iPad)', per.get(SP)?.length === z.j.kandidaten.length);
  const nSp = (await get(`/api/kaart/nummer/${encodeURIComponent(SP)}`)).j.nummer;
  const dicht = L.rijHtml(nSp, { kandidaten: per.get(SP) });
  const open = L.rijHtml(nSp, { kandidaten: per.get(SP), open: true });
  ok('de rij staat op kies, met de knop kies', /data-stand="kies"/.test(dicht) && /data-kies-open=/.test(dicht));
  const keuze = /data-kies="([^"]+)" data-id="([^"]+)"/.exec(open);
  ok('open: de kandidaten als knoppen met video-id en sleutel', !!keuze && keuze[2] === SP);
  const kies = await post(`/api/kaart/nummer/${encodeURIComponent(SP)}/kies`, { youtube_id: keuze?.[1] });
  ok('kiezen: 200, de wens heeft die video en wacht weer', kies.status === 200 && kies.j.wens.youtube_id === keuze?.[1] && kies.j.wens.status === 'wacht');
  ok('... en de rij toont wacht, zonder knop', /data-stand="wacht"/.test(L.rijHtml((await get(`/api/kaart/nummer/${encodeURIComponent(SP)}`)).j.nummer)));

  console.log('\nhaal nu en de speeldag');
  let nacht = (await get('/api/nacht')).j;
  const serverNu = new Date(nacht.nu);
  const vandaag = [...new Set([datumVan(serverNu), nachtDatum(serverNu)])];
  nacht = (await post('/api/nacht', { speeldagen: vandaag })).j;
  ok(`speeldag gezet (${vandaag.join(', ')}): de companion ziet het ook`, L.isSpeeldag(nacht) && L.speeldagKnopTekst(nacht) === null);
  const wachtend = L.wachtAantal((await get('/api/kaart/wensen')).j.wensen);
  const knop = L.haalNuKnop(wachtend, nacht);
  ok(`de knop staat uit op een speeldag: "${knop.tekst}"`, !knop.kan && /speeldag/.test(knop.tekst) && wachtend === 2);
  const voor = existsSync(nepLog) ? readFileSync(nepLog, 'utf8').split('\n').filter(Boolean).length : 0;
  const nu = await post('/api/nacht/nu', { aantal: Math.max(1, knop.aantal) });
  ok('toch gestuurd (laptop zette net de speeldag): 409 "vandaag is een speeldag"', nu.status === 409 && nu.j.fout === 'vandaag is een speeldag');
  await wacht(300);
  const na = existsSync(nepLog) ? readFileSync(nepLog, 'utf8').split('\n').filter(Boolean).length : 0;
  ok('geen run gestart, geen yt-dlp aangeroepen', (await get('/api/nacht')).j.bezig === null && na === voor);

  nacht = (await post('/api/nacht', { speeldagen: ['2026-01-02'] })).j;
  ok('geen speeldag vandaag: de knop "vandaag speeldag" verschijnt', L.speeldagKnopTekst(nacht) === 'vandaag speeldag');
  const body = L.speeldagErbij(nacht);
  ok(`speeldagErbij voegt alleen toe (${body.speeldagen.join(', ')})`, body.speeldagen.includes('2026-01-02') && body.speeldagen.includes(datumVan(serverNu)));
  nacht = (await post('/api/nacht', body)).j;
  ok('na de tik: de server heeft beide, de knop is weg, haal nu zegt weer speeldag',
    nacht.speeldagen.includes('2026-01-02') && nacht.speeldagen.includes(datumVan(serverNu))
    && L.speeldagKnopTekst(nacht) === null && !L.haalNuKnop(2, nacht).kan);
  const gevolg = L.wensGevolgTekst((await post('/api/kaart/wens', { sleutels: ['yt:eigenlike001'] })).j, nacht);
  ok(`een wens op een speeldag zegt het: "${gevolg.tekst}"`, gevolg.goed && /speeldag: niet vóór morgen/.test(gevolg.tekst));
} catch (err) {
  ok(`test liep door: ${err.stack || err}`, false);
} finally {
  for (const s of [met, zonder]) s.proc.kill('SIGTERM');
  await Promise.race([Promise.all([met, zonder].map((s) => new Promise((z) => (s.proc.exitCode !== null ? z() : s.proc.on('exit', z))))), wacht(5000)]);
  if (fails.length) console.log(`\n--- server met ---\n${met.uit.split('\n').slice(-25).join('\n')}\n--- server zonder ---\n${zonder.uit.split('\n').slice(-8).join('\n')}`);
  rmSync(map, { recursive: true, force: true });
}

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
