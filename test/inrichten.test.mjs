// ✎ Inrichten zonder JSON (werkruimte S8, docs/werkruimte/S8.md, src/werk/inrichten.js):
//   1. de pure bewerkingen: item erbij/weg, op een scherm, toewijzen aan een groep knoppen, de zoeker;
//   2. het model beslist: de Maschine-draaiknoppen geaccepteerd (eigen mapje in het deel), een kernsleutel
//      en een bezette plek geweigerd met reden, F1–F8 geweigerd als ze het deel kiezen;
//   3. de Inrichter: opslaan met versie, een 409 overschrijft niets en laadt opnieuw;
//   4. een eigen server: opslaan, toewijzen aan de Maschine-draaiknoppen en na herladen zitten de regels
//      erin (GET + samenstellen), terug naar de vorige versie, 409 als iemand intussen opsloeg, alleen deze Mac.
// Draai met: node test/inrichten.test.mjs
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(WORTEL);
let fouten = 0;
const ok = (naam, cond, extra = '') => { console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); if (!cond) fouten++; };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

const I = await import('../src/werk/inrichten.js');
const M = await import('../src/werk/model.js');
const lees = (p) => JSON.parse(readFileSync(p, 'utf8'));
const standaarden = { apc40mk2: lees('mappings/apc40mk2.json'), 'maschine-mk2': lees('mappings/maschine-mk2.json') };
const stukken = Object.fromEntries(['basis', 'uitlijn', 'fx-matrix', 'mix-extra', 'maschine-delen', 'maschine-houd'].map((n) => [n, lees(`mappings/stukken/${n}.json`)]));
const TH = lees('tools/werkruimtes/voorbeelden/twee-handen.json');

// ---- 1. de pure bewerkingen ---------------------------------------------------------------------
console.log('de bewerkingen');
{
  ok('itemVoor: een waarde = draai, een fader = schuif, een trigger = knop', I.itemVoor('track.1.filter', { type: 'value' }).soort === 'draai'
    && I.itemVoor('track.2.fader', { type: 'value' }).soort === 'schuif' && I.itemVoor('mixer.xfader', { type: 'value' }).soort === 'schuif'
    && I.itemVoor('track.1.kill.low.hold', { type: 'trigger' }).soort === 'knop' && I.itemVoor('rommel met spatie') === null);
  ok('alsFocus: de focus-track wordt {focus}, een andere track blijft', I.alsFocus('track.3.send.a', '3') === 'track.{focus}.send.a' && I.alsFocus('track.2.send.a', '3') === 'track.2.send.a');
  ok('paneelNaam: vrije tekst wordt een naam', I.paneelNaam('Mijn Dub!') === 'mijn-dub' && I.paneelNaam('   ') === null);
  let w = I.voegItemToe(TH, 'dub', { soort: 'draai', action: 'track.{focus}.send.a' });
  ok('een item erbij maakt het paneel (en laat de rest staan)', w.panelen.dub.items.length === 1 && w.panelen['mijn-mix'].items.length === 4 && TH.panelen.dub === undefined);
  w = I.voegItemToe(w, 'dub', { soort: 'knop', action: 'track.{focus}.fx.knob.1.hold' });
  w = I.voegItemToe(w, 'dub', { soort: 'xy', action: 'track.{focus}.fx.knob.1', y: 'track.{focus}.filter' });
  const weg = I.haalItemWeg(w, 'dub', 1);
  ok('een item weg', weg.panelen.dub.items.length === 2 && weg.panelen.dub.items[1].soort === 'xy');
  let fout = null; try { I.haalItemWeg(w, 'dub', 9); } catch (e) { fout = e; }
  ok('weg buiten de lijst: een fout met reden', fout instanceof I.Fout && /geen item 10/.test(fout.message));
  const op = I.zetOpScherm(w, 'dub', 'fx', 'iphone');
  ok('op een scherm: achteraan bij de vakken van dat deel', op.delen.fx.schermen.iphone.vakken.at(-1) === 'paneel:dub');
  const hoofd = I.zetOpScherm(w, 'dub', 'mix', 'hoofd');
  ok('op hoofd: het werkvak', hoofd.delen.mix.schermen.hoofd.werkvak === 'paneel:dub');
  const nieuwScherm = I.zetOpScherm(w, 'dub', 'mix', 'ipad-2');
  ok('een scherm dat de werkruimte nog niet kende komt erbij (iPad-soort uit de naam)', nieuwScherm.schermen['ipad-2']?.soort === 'ipad');
  ok('alles hierboven door het model', [w, weg, op, hoofd, nieuwScherm].every((x) => I.toets(x, TH, { standaarden, stukken }).ok));
}

// ---- 2. toewijzen, het model beslist -----------------------------------------------------------
console.log('\ntoewijzen: het model beslist');
let metDraai;
{
  let w = I.voegItemToe(TH, 'dub', { soort: 'draai', action: 'track.{focus}.send.a' });
  w = I.voegItemToe(w, 'dub', { soort: 'knop', action: 'track.{focus}.fx.knob.1.hold' });
  w = I.voegItemToe(w, 'dub', { soort: 'xy', action: 'track.{focus}.fx.knob.1', y: 'track.{focus}.filter' });
  const r = I.wijsToe(w, 'dub', 'maschine-draai', 'fx');
  metDraai = r.ruw;
  const t = I.toets(r.ruw, TH, { standaarden, stukken });
  ok('Maschine-draaiknoppen: drie waarden (draai + xy), de knop past niet', r.regels === 3 && r.overgeslagen.join() === 'track.{focus}.fx.knob.1.hold');
  ok('het model accepteert het: een eigen pagina p-dub in deel FX', t.ok && t.werkruimte.delen.fx['maschine-mk2'].pagina === 'p-dub', t.reden ?? '');
  const sam = M.samenstellen(standaarden, stukken, t.werkruimte, {});
  const frag = sam.apparaten['maschine-mk2']?.fragmenten?.find((f) => f.bron === 'werk:twee-handen');
  ok('samengesteld: de regels staan in het fragment van de werkruimte, in het mapje pagina.p-dub', frag?.doc.rules.filter((x) => x.laag === 'pagina.p-dub').map((x) => `${x.in}=${x.action}`).join() === 'cc:0:16=track.{focus}.send.a,cc:0:17=track.{focus}.fx.knob.1,cc:0:18=track.{focus}.filter');
  const nog = I.wijsToe(r.ruw, 'dub', 'maschine-draai', 'fx');
  ok('nog eens toewijzen vervangt (geen dubbele regels)', nog.ruw.regels['maschine-mk2'].filter((x) => x.laag === 'pagina.p-dub').length === 3);
  const apc = I.wijsToe(w, 'dub', 'apc-device', 'fx');
  const ta = I.toets(apc.ruw, TH, { standaarden, stukken });
  ok('APC device knobs: een eigen device-mapje in het deel (geen plek van de standaard)', ta.ok && ta.werkruimte.delen.fx.apc40mk2.device === 'p-dub' && apc.ruw.regels.apc40mk2.some((x) => x.laag === 'device.p-dub' && x.in === 'cc:0:16'), ta.reden ?? '');
  const pads = I.wijsToe(w, 'dub', 'maschine-pads', 'fx');
  ok('Maschine-pads: alleen de knoppen', pads.regels === 1 && I.toets(pads.ruw, TH, { standaarden, stukken }).ok);
  let f = null; try { I.wijsToe(w, 'dub', 'maschine-f', 'fx'); } catch (e) { f = e; }
  ok('F1–F8 in een werkruimte waar ze het deel kiezen: geweigerd met reden', f instanceof I.Fout && /kiezen in deze werkruimte het deel/.test(f.message));
  const zonderDelen = { ...w, stukken: w.stukken.filter((s) => s !== 'maschine-delen') };
  const fk = I.wijsToe(zonderDelen, 'dub', 'maschine-f', 'fx');
  ok('F1–F8 zonder dat stuk: op note:1:0–7', fk.regels === 1 && fk.ruw.regels['maschine-mk2'].at(-1).in === 'note:1:0');
  const kern = I.toets(I.wijsRegelsToe(w, 'apc40mk2', [{ in: 'cc:0:48', action: 'track.1.send.a', mode: 'endless' }]), TH, { standaarden, stukken });
  ok('een regel op een kernsleutel (track knob 1): geweigerd met reden', !kern.ok && /is de kern/.test(kern.reden), kern.reden);
  const bezet = I.toets(I.wijsRegelsToe(w, 'apc40mk2', [{ in: 'note:0:82', action: 'track.1.send.a', mode: 'trigger' }]), TH, { standaarden, stukken });
  ok('een regel op een plek van de standaard (scene 1): geweigerd met reden', !bezet.ok && /al bezet in de standaardmapping/.test(bezet.reden));
  let g = null; try { I.wijsToe(w, 'leeg', 'apc-device', 'fx'); } catch (e) { g = e; }
  ok('een paneel dat niet bestaat: een reden', /geen paneel "leeg"/.test(g?.message ?? ''));
}

// ---- de zoeker ---------------------------------------------------------------------------------
console.log('\nde zoeker');
{
  const top = lees('tools/werkruimtes/top40.json');
  ok('top40.json: 40 regels, met bron', top.top40.length === 40 && /visie\/handen/.test(top.bron) && top.top40[0].action === 'track.N.fader');
  const alle = [{ id: 'mixer.xfader', label: 'crossfader' }, { id: 'track.1.fader', label: 'fader' }, { id: 'track.1.filter', label: 'filter' }, { id: 'track.1.fx.knob.1', label: 'plek 1' }, { id: 'zeldzaam.ding', label: 'iets' }];
  const r = I.zoek('', { alle, top40: top.top40 });
  ok('leeg zoeken: de top-40 bovenaan in volgorde van gebruik ({focus}, K = 1), daarna de rest', r.map((x) => x.id).join() === 'track.{focus}.fader,track.{focus}.filter,track.{focus}.fx.knob.1,mixer.xfader,track.1.fader,track.1.filter,track.1.fx.knob.1,zeldzaam.ding');
  ok('zoeken op tekst (id of label)', I.zoek('cross', { alle, top40: top.top40 }).map((x) => x.id).join() === 'mixer.xfader' && I.zoek('iets', { alle, top40: top.top40 })[0].id === 'zeldzaam.ding');
}

// ---- 3. de Inrichter ---------------------------------------------------------------------------
console.log('\nde Inrichter: opslaan met versie');
{
  const opgeslagen = [];
  let peil = 0;
  const werk = { naam: 'twee-handen', ruw: TH, versie: 'v1', deel: 'fx', standaarden, peil: async () => { peil++; } };
  const meldingen = [];
  let antwoord = { ok: true, status: 200, versie: 'v2' };
  const inr = new I.Inrichter({ werk, bewaar: async (n, r, v) => { opgeslagen.push({ n, r, v }); return antwoord; }, meld: (t) => meldingen.push(t) });
  let r = await inr.voegToe('dub', { soort: 'draai', action: 'track.{focus}.send.a' });
  ok('een bewerking = één opslag met de versie, daarna opnieuw laden', r.ok && opgeslagen.length === 1 && opgeslagen[0].v === 'v1' && opgeslagen[0].r.panelen.dub && peil === 1);
  werk.ruw = opgeslagen[0].r;
  r = await inr.doe((w) => I.wijsRegelsToe(w, 'apc40mk2', [{ in: 'cc:0:48', action: 'track.1.send.a', mode: 'endless' }]), 'toewijzen');
  ok('een kernsleutel: geweigerd met reden, niets opgeslagen', !r.ok && /kern/.test(r.reden) && opgeslagen.length === 1 && /geweigerd/.test(meldingen.at(-1)));
  antwoord = { ok: false, status: 409, fout: 'intussen gewijzigd' };
  r = await inr.wijsToe('dub', 'maschine-draai');
  ok('409: niets overschreven, een melding, opnieuw laden', !r.ok && r.status === 409 && peil === 2 && /intussen gewijzigd/.test(meldingen.at(-1)));
  const std = new I.Inrichter({ werk: { naam: 'standaard', ruw: M.STANDAARD }, bewaar: async () => ({ ok: true }) });
  ok('met standaard: niets (kies eerst een werkruimte)', !(await std.voegToe('x', { soort: 'draai', action: 'a.b' })).ok);
}

// ---- 4. een eigen server -----------------------------------------------------------------------
console.log('\neen eigen server: toewijzen, herladen, terug, 409');
const map = mkdtempSync(join(tmpdir(), 'varve-inrichten-'));
const media = join(map, 'media');
mkdirSync(media, { recursive: true });
const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: join(media, 'library.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'),
    VARVE_HERANALYSE: 'uit', VARVE_NACHT: join(map, 'nacht.json'), VARVE_STANDEN: join(map, 'standen'), VARVE_WERKRUIMTES: join(map, 'werkruimtes'),
    VARVE_KAART: join(map, 'geen-kaart.json'), VARVE_KAART_DB: join(map, 'kaart.db'), VARVE_HUB_SETS: join(map, 'hub-sets'), VARVE_HOSTS: 'varve-proef.ts.net' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverUit = '';
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const B = `http://localhost:${poort}`;
const api = async (methode, pad, body) => { const r = await fetch(`${B}${pad}`, { method: methode, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
try {
  let op = false;
  for (let i = 0; i < 200 && !op; i++) { op = await fetch(`${B}/api/werkruimtes`).then((r) => r.ok).catch(() => false); if (!op) await wacht(100); }
  ok('de server start', op);
  const v0 = await api('GET', '/api/werkruimtes/twee-handen');
  ok('twee-handen is een voorbeeld', v0.bron === 'voorbeeld');
  // De Inrichter tegen de echte server.
  const werk = { naam: 'twee-handen', ruw: v0.ruw, versie: v0.versie, deel: 'fx', standaarden,
    peil: async () => { const d = await api('GET', '/api/werkruimtes/twee-handen'); werk.ruw = d.ruw; werk.versie = d.versie; } };
  const bewaar = async (n, r, v) => { const d = await api('PUT', `/api/werkruimtes/${n}`, { werkruimte: r, versie: v }); return { ok: d.status === 200, status: d.status, versie: d.versie, fout: d.fout }; };
  const terugApi = async (n, v) => { const d = await api('POST', `/api/werkruimtes/${n}/terug`, { versie: v }); return { ok: d.status === 200, status: d.status, fout: d.fout }; };
  const inr = new I.Inrichter({ werk, bewaar, terugApi });
  ok('een paneel erbij: een eigen bestand (het voorbeeld blijft)', (await inr.voegToe('dub', { soort: 'draai', action: 'track.{focus}.send.a' })).ok && (await api('GET', '/api/werkruimtes/twee-handen')).bron === 'eigen');
  await inr.voegToe('dub', { soort: 'draai', action: 'track.{focus}.filter' });
  const r = await inr.wijsToe('dub', 'maschine-draai');
  ok('toewijzen aan de Maschine-draaiknoppen: opgeslagen', r.ok && r.regels === 2);
  const na = await api('GET', '/api/werkruimtes/twee-handen');
  const sam = M.samenstellen(standaarden, stukken, na.werkruimte, {});
  const frag = sam.apparaten['maschine-mk2']?.fragmenten?.find((f) => f.bron === 'werk:twee-handen');
  ok('na herladen: geen fouten, en de regels zitten in de mapping van de Maschine (pagina.p-dub in FX)', na.fouten.length === 0 && na.werkruimte.delen.fx['maschine-mk2'].pagina === 'p-dub'
    && frag?.doc.rules.filter((x) => x.laag === 'pagina.p-dub').length === 2, JSON.stringify(na.fouten));
  const kern = await inr.doe((w) => I.wijsRegelsToe(w, 'apc40mk2', [{ in: 'cc:0:48', action: 'track.1.send.a', mode: 'endless' }]));
  ok('een kernsleutel: geweigerd, op de server niets veranderd', !kern.ok && (await api('GET', '/api/werkruimtes/twee-handen')).versie === na.versie);
  const versies = (await api('GET', '/api/werkruimtes/twee-handen/versies')).versies;
  ok('elke opslag bewaart de vorige', versies.length >= 2);
  // Terug: de vorige inrichting (zonder de toewijzing).
  const t = await inr.terug();
  const nt = await api('GET', '/api/werkruimtes/twee-handen');
  ok('terug zet de vorige versie terug (twee items, nog niet toegewezen)', t.ok && nt.ruw.panelen.dub.items.length === 2 && !nt.ruw.regels?.['maschine-mk2']?.some((x) => x.laag === 'pagina.p-dub'));
  // Iemand anders (Claude) slaat intussen op: terug met de oude versie = 409.
  const claude = await api('PUT', '/api/werkruimtes/twee-handen', { werkruimte: { ...nt.ruw, titel: 'door Claude' }, versie: nt.versie });
  ok('Claude slaat intussen op', claude.status === 200);
  const t409 = await api('POST', '/api/werkruimtes/twee-handen/terug', { versie: nt.versie });
  ok('terug met een oude versie: 409, niets teruggezet', t409.status === 409 && (await api('GET', '/api/werkruimtes/twee-handen')).ruw.titel === 'door Claude');
  const viaInrichter = await inr.terug();
  ok('de Inrichter bij een 409: niets overschreven, opnieuw geladen', !viaInrichter.ok && viaInrichter.status === 409 && werk.ruw.titel === 'door Claude');
  const buiten = await new Promise((z) => {
    const q = request({ host: '127.0.0.1', port: poort, method: 'POST', path: '/api/werkruimtes/twee-handen/terug', headers: { host: 'varve-proef.ts.net', origin: 'https://varve-proef.ts.net', 'content-type': 'application/json' } }, (res) => { res.resume(); z(res.statusCode); });
    q.end(JSON.stringify({ versie: werk.versie }));
  });
  ok('terug via de tailnet (de iPad): 403', buiten === 403);
  ok('top40.json staat op de witte lijst (de zoeker leest hem)', (await fetch(`${B}/tools/werkruimtes/top40.json`)).status === 200 && (await fetch(`${B}/tools/werkruimtes/voorbeelden/twee-handen.json`)).status === 404);
} catch (err) {
  ok(`geen fout: ${err?.stack || err}`, false);
} finally {
  server.kill();
  await wacht(100);
  rmSync(map, { recursive: true, force: true });
}

if (fouten) { console.log(`\n${fouten} check(s) faalden`); if (serverUit.trim()) console.log(serverUit.slice(-1500)); process.exit(1); }
console.log('\nAlle checks groen.');
