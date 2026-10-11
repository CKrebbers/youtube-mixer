// De companion (companion.html, docs/COMPANION.md) tegen EIGEN servers: eigen
// poorten, lege tijdelijke database, de nep-kaart (test/nep-kaart.mjs) en de
// nep-yt-dlp (geen byte van internet). Twee servers: één met VARVE_HOSTS (zoals
// via Tailscale) en één zonder (de opstartregel die zegt dat de iPhone een 403
// krijgt). Daarna de stappen die de companion zelf zet, met de pure functies
// uit companion-lijst.js: wens, kies uit kandidaten, haal nu (geweigerd op een
// speeldag) en de speeldag-knop (alleen toevoegen). Een derde server (met een
// nep-download, NEP_BRON) laat "haal de wenslijst nu op" echt lopen: alleen de
// wenslijst (alleenWensen, review ronde 1, fix 1) en het 202-pad tot `klaar`.
// Draai met: node test/companion-server.test.mjs
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
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

/** Een server met alles in een eigen submap; `hosts` = VARVE_HOSTS of niets; `extra` = meer omgeving. */
function startServer(naam, { hosts = null, extra = {} } = {}) {
  const m = join(map, naam);
  mkdirSync(join(m, 'media'), { recursive: true });
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(poort), VARVE_DB: join(m, 'media', 'library.db'), VARVE_MEDIA: join(m, 'media'),
    VARVE_OPNAMES: join(m, 'opnames'), VARVE_PLANNEN: join(m, 'plannen'), VARVE_PATRONEN: join(m, 'patronen'),
    VARVE_PROEF: join(m, 'proef'), VARVE_BACKUPS: join(m, 'backups'), VARVE_HERANALYSE: 'uit',
    VARVE_YTDLP: nepYtdlp, NEP_LOG: nepLog, VARVE_KAART: kaartPad, ...extra };
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
// De derde: een eigen nep-log en een echte bron voor de nep-download (ffmpeg maakt 12 s toon).
const haalLog = join(map, 'haal-nep.log');
const bron = join(map, 'bron.wav');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-ac', '2', bron]);
const haalSrv = startServer('haal', { extra: { NEP_LOG: haalLog, NEP_BRON: bron, NEP_DUUR: '300' } });
const B = met.B;
const get = async (p) => { const r = await fetch(`${B}${p}`); return { status: r.status, j: await r.json().catch(() => null) }; };
const post = async (p, body) => {
  const r = await fetch(`${B}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
};

try {
  ok('drie servers draaien (met en zonder VARVE_HOSTS, en een met nep-download)', (await klaar(met)) && (await klaar(zonder)) && (await klaar(haalSrv)));

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

  // ---- haal nu echt laten lopen (derde server, nep-download) ----------------------------
  console.log('\nhaal de wenslijst nu op: alleen de wenslijst (fix 1), en het 202-pad tot klaar');
  const H = haalSrv.B;
  const hGet = async (p) => { const r = await fetch(`${H}${p}`); return { status: r.status, j: await r.json().catch(() => null) }; };
  const hPost = async (p, b) => {
    const r = await fetch(`${H}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const haalRegels = () => (existsSync(haalLog) ? readFileSync(haalLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const totKlaar = async () => { for (let i = 0; i < 300; i++) { if ((await hGet('/api/nacht')).j.bezig === null) return true; await wacht(100); } return false; };
  let hn = (await hPost('/api/nacht', { speeldagen: ['2026-01-02'], pauze: { min: 0, max: 0 } })).j;
  const hNu = new Date(hn.nu);
  ok(`de stand geeft vandaag en nachtDatum van de server (fix 9): ${hn.vandaag}, ${hn.nachtDatum}`,
    hn.vandaag === datumVan(hNu) && hn.nachtDatum === nachtDatum(hNu) && L.vandaagVan(hn) === hn.vandaag);
  ok('de standaardvolgorde staat aan (standaard): zonder vlag zou de run de kaart afwerken', hn.standaardVolgorde === true);
  await hPost('/api/kaart/wens', { sleutels: [SP] });                 // alleen Spotify; de nep-zoeker geeft hooguit 0,60
  const knopH = L.haalNuKnop(L.wachtAantal((await hGet('/api/kaart/wensen')).j.wensen), hn);
  ok(`de knop: "${knopH.tekst}"`, knopH.kan && knopH.aantal === 1);
  const r1 = await hPost('/api/nacht/nu', L.haalNuBody(knopH.aantal));
  ok('POST /api/nacht/nu { aantal: 1, alleenWensen: true }: 202, bezig met alleenWensen', r1.status === 202 && r1.j.bezig?.alleenWensen === true && r1.j.bezig?.soort === 'nu');
  ok('... de run is binnen 30 s klaar', await totKlaar());
  const w1 = (await hGet('/api/kaart/wensen')).j.wensen;
  ok(`de wens staat op kies (geen zekere versie): ${w1.map((w) => `${w.sleutel}=${w.status}`).join(', ')}`, w1.length === 1 && w1[0].status === 'kies');
  ok('geen wens met bron nacht: niets uit de standaardvolgorde gehaald', w1.every((w) => w.bron !== 'nacht'));
  ok(`in het nep-log alleen de zoekvraag, geen download (${haalRegels().map((r) => r.wat).join(', ')})`, haalRegels().length >= 1 && haalRegels().every((r) => r.wat === 'zoek'));
  const run1 = (await hGet('/api/nacht/runs')).j.runs[0];
  ok(`de run zegt het: "${run1?.reden}"`, run1?.reden === 'niets meer te halen' && run1?.gehaald === 0);

  const YT = 'yt:fourtet0baby';
  await hPost('/api/kaart/wens', { sleutels: [YT] });
  const r2 = await hPost('/api/nacht/nu', L.haalNuBody(1));
  ok('een yt-wens: 202, bezig gevuld (de knop zegt dan "er loopt al een run")', r2.status === 202 && r2.j.bezig?.aantal === 1
    && L.haalNuKnop(1, r2.j).tekst === 'haal nu: er loopt al een run');
  ok('... de run is binnen 30 s klaar', await totKlaar());
  const w2 = (await hGet('/api/kaart/wensen')).j.wensen;
  const ytWens = w2.find((w) => w.sleutel === YT);
  ok(`de wens staat op klaar, met de track (${ytWens?.status}, ${ytWens?.track?.id ?? 'geen track'})`, ytWens?.status === 'klaar' && !!ytWens?.track);
  ok('nog steeds geen wens met bron nacht', w2.every((w) => w.bron !== 'nacht'));
  ok('in het nep-log nu ook de download van dat nummer, en alleen dat', haalRegels().filter((r) => r.wat === 'download').length === 1
    && haalRegels().filter((r) => r.wat === 'download').every((r) => /fourtet0baby/.test(r.url)));
  const rijYt = (await hGet(`/api/kaart/nummer/${encodeURIComponent(YT)}`)).j.nummer;
  const { rijen: naRun } = L.pasWensenToe([{ ...rijYt, binnen: null, wens: { status: 'wacht', fout: null, youtube_id: rijYt.youtube_id } }], w2);
  ok('de companion-rij volgt: klaar (pasWensenToe)', /data-stand="klaar"/.test(L.rijHtml(naRun[0])));

  // Fix 5: hoe groot is GET /api/kaart/wensen per wens? Een klare wens draagt het hele track-object mee;
  // de companion vraagt daarom ?licht=1 (zonder track en nummer, kandidaten alleen bij kies).
  const ruw = await (await fetch(`${H}/api/kaart/wensen`)).text();
  const licht = await (await fetch(`${H}/api/kaart/wensen?licht=1`)).text();
  const perWens = Object.fromEntries(w2.map((w) => [w.status, JSON.stringify(w).length]));
  const lw = JSON.parse(licht).wensen;
  const perLicht = Object.fromEntries(lw.map((w) => [w.status, JSON.stringify(w).length]));
  ok(`omvang /api/kaart/wensen: ${ruw.length} B voor ${w2.length} wensen (klaar met track ${perWens.klaar} B, kies met 5 kandidaten ${perWens.kies} B);`
    + ` ?licht=1: ${licht.length} B (klaar ${perLicht.klaar} B)`, ruw.length > 0 && licht.length < ruw.length && perLicht.klaar < perWens.klaar / 3);
  ok('?licht=1: geen track en geen nummer, wel sleutel/status/fout/youtube_id, en de kandidaten van de kies-wens',
    lw.every((w) => !('track' in w) && !('nummer' in w) && 'status' in w && 'youtube_id' in w && 'fout' in w)
    && L.kandidatenPerSleutel(lw).get(SP)?.length === 5 && lw.find((w) => w.status === 'klaar').kandidaten === null);
  const { rijen: naLicht } = L.pasWensenToe([{ ...rijYt, binnen: null, wens: { status: 'wacht', fout: null, youtube_id: rijYt.youtube_id } }], lw);
  ok('... en de companion-rij volgt ook met de lichte lijst: klaar', /data-stand="klaar"/.test(L.rijHtml(naLicht[0])));

  // Review ronde 2, fix 4: de lichte lijst met een ETag; zolang er niets verandert 304 zonder body
  // (de companion peilt elke 5 s, over een hotspot telt de hele lijst anders elke keer op).
  console.log('\nde lichte wenslijst met een ETag (fix 4): 304 zolang er niets veranderde');
  const e1 = await fetch(`${H}/api/kaart/wensen?licht=1`);
  const tag1 = e1.headers.get('etag');
  const body1 = await e1.text();
  ok(`?licht=1 geeft een ETag (${tag1})`, e1.status === 200 && /^"[0-9a-f]{16}"$/.test(tag1 ?? '') && JSON.parse(body1).wensen.length === lw.length);
  const e2 = await fetch(`${H}/api/kaart/wensen?licht=1`, { headers: { 'If-None-Match': tag1 } });
  const body2 = await e2.text();
  ok(`opnieuw met If-None-Match: ${e2.status}, lege body (${body2.length} B in plaats van ${body1.length} B), dezelfde ETag`,
    e2.status === 304 && body2 === '' && e2.headers.get('etag') === tag1);
  const zwak = await fetch(`${H}/api/kaart/wensen?licht=1`, { headers: { 'If-None-Match': `W/${tag1}` } });
  const lijst = await fetch(`${H}/api/kaart/wensen?licht=1`, { headers: { 'If-None-Match': `"0000000000000000", ${tag1}` } });
  ok(`als zwakke ETag (${zwak.status}) of in een lijst (${lijst.status}): 304`, zwak.status === 304 && lijst.status === 304);
  const ander = await fetch(`${H}/api/kaart/wensen?licht=1`, { headers: { 'If-None-Match': '"0000000000000000"' } });
  ok(`een andere ETag: ${ander.status} met de hele lichte lijst`, ander.status === 200 && (await ander.json()).wensen.length === lw.length);
  const vol = await fetch(`${H}/api/kaart/wensen`, { headers: { 'If-None-Match': tag1 } });
  ok(`zonder ?licht=1 (de laptop): ${vol.status}, geen ETag, de volle lijst zoals altijd`, vol.status === 200 && vol.headers.get('etag') === null
    && (await vol.json()).wensen.some((w) => w.track));
  await hPost('/api/kaart/wens', { sleutels: ['yt:eigenlike001'] });
  const e3 = await fetch(`${H}/api/kaart/wensen?licht=1`, { headers: { 'If-None-Match': tag1 } });
  const tag3 = e3.headers.get('etag');
  ok(`na een nieuwe wens met de oude ETag: ${e3.status}, een andere ETag (${tag3}), één wens meer`, e3.status === 200 && !!tag3 && tag3 !== tag1
    && (await e3.json()).wensen.length === lw.length + 1);
  ok('... en met die nieuwe ETag weer 304', (await fetch(`${H}/api/kaart/wensen?licht=1`, { headers: { 'If-None-Match': tag3 } })).status === 304);
} catch (err) {
  ok(`test liep door: ${err.stack || err}`, false);
} finally {
  for (const s of [met, zonder, haalSrv]) s.proc.kill('SIGTERM');
  await Promise.race([Promise.all([met, zonder, haalSrv].map((s) => new Promise((z) => (s.proc.exitCode !== null ? z() : s.proc.on('exit', z))))), wacht(5000)]);
  if (fails.length) console.log(`\n--- server met ---\n${met.uit.split('\n').slice(-25).join('\n')}\n--- server zonder ---\n${zonder.uit.split('\n').slice(-8).join('\n')}`
    + `\n--- server haal ---\n${haalSrv.uit.split('\n').slice(-25).join('\n')}`);
  rmSync(map, { recursive: true, force: true });
}

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
