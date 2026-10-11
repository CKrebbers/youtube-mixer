// Het meetdeel van het avondpakket (server/avondpakket-meet.js) en de CLI
// (tools/avondpakket.mjs), zonder hardware en zonder server: een nep-exec die
// fixtures teruggeeft of nooit antwoordt (time-outs 50 ms), de cache met de
// bevriezing op een nepklok, de bundel voor de route met nep-rijen, en de CLI via
// spawnSync met VARVE_AVONDPAKKET_NEP (dan vraagt hij nooit een server). De
// enige echte kindprocessen zijn `node -e …` om voerUit zelf te toetsen.
// Draai met: node test/avondpakket-meet.test.mjs
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const M = await import('../server/avondpakket-meet.js');
const { leesProfielen, beoordeel } = await import('../server/avondpakket.js');
const { voerUit, poortOpen, meet, maakCache, maakNep, maakAvondpakket, backupMeting, backupUitNamen, achtergrondMeting, extraPaden,
  speellijstStand, GOEDKOOP, SONDES, KAART_STANDAARD } = M;
const { allePunten } = await import('../src/controle/speellijst.js');

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const FX = join(WORTEL, 'test/fixtures/avondpakket');
const PROFIELEN = join(WORTEL, 'avondpakket/profielen.json');
const DATA = leesProfielen(readFileSync(PROFIELEN, 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'varve-avondpakket-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const NEP_PADEN = { media: '/Users/test/varve/media', wortel: '/Users/test/varve', extra: [] };
/** Een nep-map met nep.json: de standaard uit de fixtures, met wijzigingen; bestanden absoluut. */
function nepMap(naam, wijzig = {}) {
  const basis = JSON.parse(readFileSync(join(FX, 'nep.json'), 'utf8'));
  const cfg = { ...basis, ...wijzig };
  for (const [k, v] of Object.entries(cfg)) if (typeof v === 'string' && /\.(txt|json)$/.test(v)) cfg[k] = join(FX, v);
  const map = join(tmp, naam);
  mkdirSync(map, { recursive: true });
  writeFileSync(join(map, 'nep.json'), JSON.stringify(cfg));
  return map;
}

try {
  console.log('1. voerUit (echte kindprocessen: node -e)');
  {
    ok('stdout terug', (await voerUit(process.execPath, ['-e', 'process.stdout.write("hallo")'])) === 'hallo');
    const code = await voerUit(process.execPath, ['-e', 'process.exit(2)', '/Users/geheim/pad']).catch((e) => e.message);
    ok(`exitcode 2 → "node gaf code 2", zonder de opdrachtregel (${code})`, /gaf code 2$/.test(code) && !code.includes('/Users/'));
    ok('exitcode 1 mag als codes [1] (lsof/pgrep: niets gevonden)', (await voerUit(process.execPath, ['-e', 'process.exit(1)'], { codes: [1] })) === '');
    const t0 = Date.now();
    const lang = await voerUit(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 150 }).catch((e) => e.message);
    ok(`time-out → "time-out" en snel terug (${Date.now() - t0} ms)`, lang === 'time-out' && Date.now() - t0 < 2000);
    ok('ENOENT → "<naam> niet gevonden"', (await voerUit('/bestaat/niet/tailscale-xyz', []).catch((e) => e.message)) === 'tailscale-xyz niet gevonden');
    const weg = await voerUit(process.execPath, ['-e', 'console.error("find: /x/media: No such file or directory"); process.exit(1)'], { codes: [0, 1] }).catch((e) => e.message);
    ok('"No such file or directory" zonder uitvoer → "bestaat niet" (ook als code 1 mag)', weg === 'bestaat niet');
    const deels = await voerUit(process.execPath, ['-e', 'console.log("12 /x/a.wav"); console.error("Permission denied"); process.exit(1)'], { codes: [0, 1] });
    ok('find met code 1 en wel uitvoer (een map niet leesbaar) → de uitvoer', deels.trim() === '12 /x/a.wav');
  }

  console.log('2. poortOpen');
  {
    const srv = createServer(() => {}).listen(0, '127.0.0.1');
    await new Promise((r) => srv.once('listening', r));
    const poort = srv.address().port;
    ok('een luisterende poort → true', await poortOpen(poort, { timeout: 500 }));
    await new Promise((r) => srv.close(r));
    ok('een dichte poort → false', !(await poortOpen(poort, { timeout: 500 })));
  }

  console.log('3. meet uit de fixtures (nep)');
  {
    const n = maakNep(FX);
    const t0 = Date.now();
    const m = await meet({ exec: n.exec, verbind: n.verbind, paden: n.paden });
    ok(`alle ${SONDES.length} sondes gemeten, niets onbekend (${Object.entries(m).filter(([, v]) => v && typeof v === 'object' && 'onbekend' in v).map(([k, v]) => `${k}: ${v.onbekend}`)})`,
      SONDES.every((id) => id in m && !(m[id] && typeof m[id] === 'object' && !Array.isArray(m[id]) && 'onbekend' in m[id])));
    ok(`bestanden: 131, relatief, bestaat (${m.bestanden.totaal})`, m.bestanden.totaal === 131 && m.bestanden.paden.has('nr00_test/audio.wav') && m.bestanden.bestaat === true);
    ok('accu: 65 %, AC, 8 W, gezondheid 78 %, 591 cycli', m.accu.procent === 65 && m.accu.bron === 'AC' && m.accu.laderW === 8 && m.accu.gezondheid === 78 && m.accu.cycli === 591);
    ok('servers: lsof 1 pid, pgrep 1', m.servers.opDb === 1 && m.servers.varve === 1);
    ok('icloud true, schijf 122, usb [], avhub dicht, tailscale Running', m.icloud === true && Math.round(m.schijf.vrijGiB) === 122 && m.usb.length === 0
      && m.avhub.draait === false && m.tailscale.backend === 'Running');
    ok(`duurt niets (${Date.now() - t0} ms)`, Date.now() - t0 < 1000);
    ok('elke sleutel één keer gevraagd', [...n.geteld.values()].every((x) => x === 1) && !n.geteld.has('find-extra'));
  }

  console.log('4. een exec die nooit antwoordt (time-outs 50 ms, H13)');
  {
    const nooit = () => new Promise(() => {});
    const timeouts = Object.fromEntries(SONDES.map((id) => [id, 50]));
    const t0 = Date.now();
    const m = await meet({ exec: nooit, verbind: () => new Promise(() => {}), paden: NEP_PADEN, timeouts });
    const duur = Date.now() - t0;
    ok(`alles "time-out" binnen 10× de time-out (${duur} ms)`, SONDES.every((id) => m[id]?.onbekend === 'time-out') && duur < 500);
    const r = beoordeel(m, { profiel: 'apc', fase: 'aankomst', data: { ...DATA, hardwareBevestigd: true }, nu: new Date() });
    ok(`→ geen rood, de sondepunten grijs "niet gemeten: time-out" (${r.telling.fout} rood)`, r.telling.fout === 0
      && r.punten.find((p) => p.id === 'schijf').sub === 'niet gemeten: time-out');
    const half = await meet({ exec: (cmd, args, o) => (o.sleutel === 'audio' ? nooit() : maakNep(FX).exec(cmd, args, o)), verbind: async () => false,
      paden: NEP_PADEN, timeouts: { audio: 50 } });
    ok('één trage sonde: alleen die is onbekend, de rest gemeten', half.audio.onbekend === 'time-out' && half.bestanden.totaal === 131 && half.accu.procent === 65);
  }

  console.log('5. fouten per sonde');
  {
    const n = maakNep(nepMap('fouten', { tailscale: { fout: 'tailscale niet gevonden' }, 'find-stat': { fout: 'bestaat niet' }, 'find-dataless': { fout: 'bestaat niet' },
      lsof: { fout: 'lsof gaf code 2' }, optimize: { tekst: 'The domain/default pair of (com.apple.bird, optimize-storage) does not exist' }, 'ioreg-usb': { fout: 'time-out' } }));
    const m = await meet({ exec: n.exec, verbind: n.verbind, paden: n.paden });
    ok(`tailscale ENOENT op alle plekken → "tailscale niet geïnstalleerd" (${m.tailscale.onbekend})`, m.tailscale.onbekend === 'tailscale niet geïnstalleerd' && n.geteld.get('tailscale') === 3);
    ok('mediamap bestaat niet → { bestaat: false } (grijs "geen map", nooit groen)', m.bestanden.bestaat === false
      && beoordeel(m, { profiel: 'apc', data: DATA, nu: new Date() }).punten.find((p) => p.id === 'media').licht === 'uit');
    ok('lsof faalt, pgrep niet → opDb null, varve 1', m.servers.opDb === null && m.servers.varve === 1);
    ok('optimize-sleutel bestaat niet → onbekend (grijs)', m.icloud.onbekend === 'onleesbaar');
    ok('ioreg-usb faalt, system_profiler niet → usb toch gemeten', Array.isArray(m.usb));
  }

  console.log('6. de goedkope ronde (er speelt een deck, vers)');
  {
    const n = maakNep(FX);
    const vorige = await meet({ exec: n.exec, verbind: n.verbind, paden: n.paden });
    const n2 = maakNep(FX);
    const m = await meet({ exec: n2.exec, verbind: n2.verbind, paden: n2.paden, alleen: GOEDKOOP, vorige });
    const gevraagd = [...n2.geteld.keys()].sort().join();
    ok(`alleen pmset, df, defaults, pgrep: nooit system_profiler, ioreg, lsof of find (${gevraagd})`, gevraagd === 'df,optimize,pgrep,pmset-ac,pmset-batt');
    ok('accu: gezondheid en cycli uit de vorige meting', m.accu.gezondheid === 78 && m.accu.cycli === 591 && m.accu.procent === 65);
    ok('servers: opDb uit de vorige meting', m.servers.opDb === 1);
    ok('de dure sondes: de vorige waarde (audio, usb, bestanden)', m.audio === vorige.audio && m.bestanden === vorige.bestanden);
    const zonder = await meet({ exec: maakNep(FX).exec, verbind: async () => false, paden: NEP_PADEN, alleen: GOEDKOOP });
    ok('zonder vorige: de dure sondes onbekend "er speelt een deck"', /^er speelt een deck$/.test(zonder.audio.onbekend) && zonder.servers.opDb === null);
  }

  console.log('7. maakCache');
  {
    let t = 1_000_000, n = 0, speelt = false;
    let vrij = null;
    const meter = async (o) => { n++; if (vrij) await vrij; return { o, nr: n }; };
    const c = maakCache({ meet: meter, ttlMs: 10_000, versMs: 2_000, speeltDeck: () => speelt, klok: () => t });
    await c.metingen();
    await c.metingen();
    ok('twee keer binnen de ttl → één meting', n === 1);
    let laat; vrij = new Promise((r) => { laat = r; });
    t += 11_000;
    const [a, b] = [c.metingen(), c.metingen()];
    laat(); vrij = null;
    await Promise.all([a, b]);
    ok('twee tegelijk → één meting', n === 2);
    t += 1_000;
    await c.metingen({ vers: true });
    ok('vers binnen 2 s → geen nieuwe', n === 2);
    t += 2_500;
    await c.metingen({ vers: true });
    ok('vers na 2 s → wel een nieuwe', n === 3);
    speelt = true; t += 60_000;
    const bev = await c.metingen();
    ok('er speelt een deck → geen meting, de laatste met bevroren', n === 3 && bev.bevroren === 'er speelt een deck' && bev.metingen.nr === 3);
    const bevVers = await c.metingen({ vers: true });
    ok('speelt + vers → één goedkope meting (alleen GOEDKOOP, vorige erbij)', n === 4 && bevVers.bevroren && bevVers.metingen.o.alleen === GOEDKOOP && bevVers.metingen.o.vorige.nr === 3);
    speelt = false;
    await c.metingen();
    ok('na het spelen: meteen weer een volledige meting (de goedkope telt niet)', n === 5);
    const leeg = maakCache({ meet: meter, speeltDeck: () => true, klok: () => t });
    const r = await leeg.metingen();
    ok('speelt en nooit gemeten → geen meting, lege metingen met bevroren', n === 5 && r.bevroren && Object.keys(r.metingen).length === 0);
    // review 2, fix 4: automatisch (de Controlekamer elke 5 min) nooit een volledige meting
    const volT = c.laatste.t;
    ok('elke stand draagt volledigT (de laatste volledige meting)', c.laatste.volledigT === volT && c.laatste.goedkoop === false);
    t += 1_000;
    const a1 = await c.metingen({ auto: true });
    ok('auto binnen de ttl → de laatste, geen meting', n === 5 && a1 === c.laatste);
    t += 11_000;
    const a2 = await c.metingen({ auto: true });
    ok('auto na de ttl → één goedkope meting (alleen GOEDKOOP, vorige erbij, eigen reden)', n === 6 && a2.goedkoop && a2.metingen.o.alleen === GOEDKOOP
      && a2.metingen.o.vorige.nr === 5 && /automatisch/.test(a2.metingen.o.waarom));
    ok('… met volledigT van de vorige volledige meting', a2.volledigT === volT && a2.t > volT);
    t += 1_000;
    await c.metingen({ auto: true });
    ok('auto binnen de ttl na een goedkope → die goedkope, geen nieuwe', n === 6);
    await c.metingen();
    ok('een gewone vraag (openen, keuze) na een goedkope → volledig', n === 7 && c.laatste.goedkoop === false && c.laatste.volledigT === t);
    t += 11_000;
    await c.metingen({ auto: true, vers: true });
    ok('vers gaat voor auto (een klik meet alles)', n === 8 && c.laatste.goedkoop === false);
    const nooit = maakCache({ meet: meter, klok: () => t });
    const a3 = await nooit.metingen({ auto: true });
    ok('auto en nog nooit gemeten → alleen goedkoop, volledigT null', n === 9 && a3.goedkoop && a3.volledigT === null);
    speelt = true;
    await c.metingen({ auto: true });
    ok('auto terwijl er een deck speelt → geen meting (bevroren)', n === 9);
    speelt = false;
  }

  console.log('8. maakAvondpakket (de bundel voor de route), met nep');
  {
    let speelt = false, tracksGevraagd = 0;
    const rij = (id, extra = {}) => ({ id, audio: `media/${id}/audio.wav`, video: `media/${id}/video.mp4`, peaks: { bestand: `media/${id}/peaks.bin` },
      onset: { bestand: `media/${id}/onset.bin` }, stems: { bestand: `media/${id}/stems.wav` }, ...extra });
    const ap = maakAvondpakket({
      paden: { media: '/Users/x/media', wortel: '/Users/x', db: '/Users/x/media/library.db', backups: '/Users/x/media/backups' },
      profielenPad: PROFIELEN, nep: FX, speeltDeck: () => speelt,
      backupStand: () => ({ laatste: { naam: 'library-2026-10-10_12-00-00.db', tijd: Date.now() - 3600e3, bytes: 5e6 }, aantal: 3, gekeken: Date.now(), fout: null, bezig: false, gewijzigdSinds: false }),
      rijen: () => ({ ingest: [], stems: [{ status: 'wacht' }], nacht: { aan: false, speeldagen: [] } }),
      library: () => ({ sleutel: 'a:1', tracks: () => { tracksGevraagd++; return [rij('nr00_test'), rij('nr03_test'), rij('weg_test', { video: null, peaks: null, onset: null, stems: null })]; } }),
    });
    const r = await ap.rapport({ profiel: 'apc' });
    const p = (id, x = r) => x.punten.find((q) => q.id === id);
    ok(`rapport: profiel apc, fase auto → vertrek, duurMs (${r.fase}, ${r.duurMs})`, r.profiel === 'apc' && r.fase === 'vertrek' && Number.isFinite(r.duurMs));
    ok('compleet: rood met weg_test, en de 0-byte audio van nr03', p('compleet').licht === 'fout' && /weg_test\/audio\.wav/.test(p('compleet').sub) && /nr03_test\/audio\.wav \(0 B\)/.test(p('compleet').sub));
    ok('achtergrond: 1 in de wachtrij → oranje', p('achtergrond').licht === 'half');
    ok('backup: groen, geen backupnaam in het rapport', p('backup').licht === 'ok' && !JSON.stringify(r).includes('library-2026'));
    await ap.rapport({ profiel: 'maschine' });
    ok('tweede verzoek (ander profiel): dezelfde meting, tracks niet opnieuw', tracksGevraagd === 1);
    speelt = true;
    const b = await ap.rapport({ profiel: 'apc' });
    ok('er speelt een deck → bevroren, compleet grijs met de oude stand', b.bevroren === 'er speelt een deck' && p('compleet', b).licht === 'uit' && /niet vernieuwd/.test(p('compleet', b).sub));
    ok('… en de bevroren stand heeft de tijd van de meting', b.t === r.t);
    const onb = await ap.rapport({ profiel: 'bestaatniet', fase: 'onzin' });
    ok('onbekend profiel → het standaardprofiel + profielOnbekend; onbekende fase → auto', onb.profiel === 'apc' && onb.profielOnbekend === 'bestaatniet' && onb.faseGekozen === false);
    const fout = maakAvondpakket({ paden: { wortel: '/Users/x', media: '/Users/x/media', backups: '/Users/x/media/backups' }, profielenPad: join(tmp, 'bestaat-niet.json'), nep: FX,
      backupStand: () => ({ laatste: null, fout: "ENOSPC: copyfile '/Users/x/media/library.db' -> '/Users/x/media/backups/library-2026-10-10_12-00-00.db'", bezig: false }) });
    const f = await fout.rapport({});
    const s = JSON.stringify(f);
    ok('backup-fout zonder paden of backupnaam; profielen.json weg → terugval laptop + oranje punt', f.punten.find((q) => q.id === 'backup').licht === 'fout'
      && !s.includes('/Users/') && !s.includes('library-2026') && f.profiel === 'laptop' && f.punten.find((q) => q.id === 'profielen').licht === 'half');
    ok('zonder server-bronnen: achtergrond en compleet grijs "geen server"', f.punten.find((q) => q.id === 'compleet').sub === 'niet gemeten: geen server');

    // review 2, fix 1 (a): de server herstart midden in de set, of de Controlekamer gaat pas open als er al een deck speelt
    const koud = maakAvondpakket({ paden: { media: '/Users/x/media', wortel: '/Users/x', db: '/Users/x/media/library.db', backups: '/Users/x/media/backups' },
      profielenPad: PROFIELEN, nep: FX, speeltDeck: () => true,
      backupStand: () => ({ laatste: { tijd: Date.now() - 3600e3, bytes: 5e6 }, aantal: 3, gekeken: Date.now(), fout: null, bezig: false, gewijzigdSinds: false }),
      rijen: () => ({ ingest: [], stems: [], nacht: { aan: false, speeldagen: [] } }), library: () => ({ sleutel: 'a', tracks: () => [] }) });
    const k = await koud.rapport({ profiel: 'apc' });
    ok(`speelt en nog nooit gemeten → bevroren, maar niet groen (${k.licht}, ${k.oordeel}), punt fase oranje`, k.bevroren && k.licht !== 'ok'
      && k.punten.find((q) => q.id === 'fase')?.licht === 'half');
    const kv = await koud.rapport({ profiel: 'apc', vers: true });
    ok(`… ook na een klik (alleen het goedkope) niet groen (${kv.licht})`, kv.licht !== 'ok' && /\(er speelt een deck\)/.test(kv.punten.find((q) => q.id === 'fase').sub));
  }

  console.log('8b. automatisch: nooit de dure sondes (review 2, fix 4)');
  {
    let t = 5_000_000, tracksGevraagd = 0;
    const map = nepMap('auto');
    const ap = maakAvondpakket({
      paden: { media: '/Users/x/media', wortel: '/Users/x', db: '/Users/x/media/library.db', backups: '/Users/x/media/backups' },
      profielenPad: PROFIELEN, nep: map, klok: () => t,
      backupStand: () => ({ laatste: { tijd: t - 3600e3, bytes: 5e6 }, aantal: 3, gekeken: t, fout: null, bezig: false, gewijzigdSinds: false }),
      rijen: () => ({ ingest: [], stems: [], nacht: { aan: false, speeldagen: [] } }),
      library: () => ({ sleutel: 'a:1', tracks: () => { tracksGevraagd++; return [{ id: 'weg_test', audio: 'media/weg_test/audio.wav' }]; } }),
      speellijst: async () => ({ items: { [allePunten()[0].id]: { status: 'ok' }, [allePunten()[1].id]: { status: 'fout' }, bestaatniet: { status: 'ok' } } }),
    });
    // De teller van de nep (maakNep in de bundel) is niet van buiten te zien: tel via een tweede nep op dezelfde map.
    const eerste = await ap.rapport({ profiel: 'apc' });
    ok('eerste vraag (openen): volledig, geen deels', !eerste.deels && eerste.punten.find((q) => q.id === 'compleet').licht === 'fout');
    ok(`speellijst als info: 1 gedaan + 1 fout = 2 van ${allePunten().length}, 1 fout; een onbekende id telt niet`, eerste.info?.speellijst?.gedaan === 2
      && eerste.info.speellijst.fout === 1 && eerste.info.speellijst.totaal === allePunten().length);
    t += 11_000;
    const auto = await ap.rapport({ profiel: 'apc', auto: true });
    ok(`auto na de ttl → deels, met de tijd van de volledige meting (${JSON.stringify(auto.deels)})`, auto.deels?.volledig === eerste.t && auto.t > eerste.t);
    ok('… de dure punten houden de stand van toen (media, geluid), compleet hetzelfde oordeel, tracks niet opnieuw', auto.punten.find((q) => q.id === 'media').waarde === eerste.punten.find((q) => q.id === 'media').waarde
      && auto.punten.find((q) => q.id === 'compleet').licht === 'fout' && tracksGevraagd === 1);
    // Rechtstreeks op meet(): een auto-ronde vraagt met de nep-teller geen audio, usbhost, ioreg of find.
    const n = maakNep(FX);
    const vorige = await meet({ exec: n.exec, verbind: n.verbind, paden: n.paden });
    const c = maakCache({ meet: (o) => meet({ exec: n2.exec, verbind: n2.verbind, paden: n2.paden, ...o }), klok: () => t });
    const n2 = maakNep(FX);
    await c.metingen({ auto: true });
    const gevraagd = [...n2.geteld.keys()].sort().join();
    ok(`auto: alleen pmset, df, defaults, pgrep (${gevraagd})`, gevraagd === 'df,optimize,pgrep,pmset-ac,pmset-batt' && !!vorige.audio);
  }

  console.log('8c. profielen.json die blijft hangen (review 2, fix 5)');
  {
    const fifo = join(tmp, 'profielen-hangt.json');
    const mk = spawnSync('mkfifo', [fifo]);
    if (mk.status !== 0) ok('mkfifo (overgeslagen: geen mkfifo)', true);
    else {
      const ap = maakAvondpakket({ paden: { media: '/Users/x/media', wortel: '/Users/x' }, profielenPad: fifo, nep: FX, leesMs: 100 });
      const t0 = Date.now();
      const [a, b] = await Promise.all([ap.rapport({}), ap.rapport({})]);
      const duur = Date.now() - t0;
      ok(`een lezing die niet terugkomt → na de grens de terugval met een oranje punt (${duur} ms)`, duur < 1500 && a.profiel === 'laptop'
        && /time-out/.test(a.punten.find((q) => q.id === 'profielen').sub) && b.profiel === 'laptop');
      writeFileSync(fifo, '{}');   // de hangende lezing loslaten (anders houdt hij de test open)
      await wacht(50);
    }
  }

  console.log('9. backup, achtergrond, extra paden');
  {
    const b = backupUitNamen(['library-2026-10-09_22-10-00.db', 'library-2026-10-10_12-00-00.db', 'iets.txt']);
    ok('backupUitNamen: de nieuwste, tijd uit de naam (lokaal), bron map', b.laatste.tijd === new Date(2026, 9, 10, 12, 0, 0).getTime() && b.bron === 'map' && b.aantal === 2);
    ok('backupUitNamen: niets → laatste null', backupUitNamen([]).laatste === null);
    const bm = backupMeting({ laatste: { naam: 'library-2026-10-10_12-00-00.db', tijd: 5, bytes: 9 }, fout: null, gewijzigdSinds: true });
    ok('backupMeting: geen naam, wel tijd en gewijzigdSinds', bm.laatste.naam === undefined && bm.laatste.tijd === 5 && bm.gewijzigdSinds === true);
    const ochtend = new Date(2026, 9, 11, 9, 0);
    const a = achtergrondMeting({ ingest: [{ status: 'bezig' }, { status: 'klaar' }], stems: [{ status: 'wacht' }, { status: 'wacht' }],
      nacht: { aan: true, speeldagen: ['2026-10-10'] }, nu: ochtend });
    ok('achtergrond: tellingen, en de speeldag van gisteren telt vóór 12:00 (nachtDatum)', a.ingestBezig && a.ingestWacht === 0 && a.stemsWacht === 2 && a.nachtAan && a.vandaagSpeeldag);
    ok('achtergrond: na 12:00 niet meer', !achtergrondMeting({ nacht: { aan: true, speeldagen: ['2026-10-10'] }, nu: new Date(2026, 9, 11, 13, 0) }).vandaagSpeeldag);
    ok('een lopende nachtrun telt als ingest bezig', achtergrondMeting({ nacht: { aan: true, bezig: { soort: 'nacht' }, speeldagen: [] } }).ingestBezig);
    const vn = achtergrondMeting({ nacht: { aan: true, speeldagen: [], vandaagNiet: true } });
    ok('"vandaag niet" (nacht.stand().vandaagNiet) → vannachtUit (review 2, fix 3)', vn.vannachtUit === true && vn.vandaagSpeeldag === false
      && achtergrondMeting({ nacht: { aan: true, speeldagen: [] } }).vannachtUit === false);
    ok('… en het oordeel is groen', beoordeel({ achtergrond: vn }, { profiel: 'apc', fase: 'vertrek', data: DATA }).punten.find((q) => q.id === 'achtergrond').licht === 'ok');
    const ids = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    ok('speellijstStand: open telt niet, fout telt als gedaan én fout, onbekende ids niet', JSON.stringify(speellijstStand({ items: { a: { status: 'ok' }, b: { status: 'fout' },
      c: { status: 'open', notitie: 'x' }, z: { status: 'ok' } } }, ids)) === '{"gedaan":2,"fout":1,"totaal":4}');
    ok('speellijstStand: geen sessie → 0 van de echte lijst', speellijstStand(null).gedaan === 0 && speellijstStand(null).totaal === allePunten().length
      && speellijstStand({ items: { constructor: { status: 'ok' } } }, [{ id: 'constructor' }]).gedaan === 1 && speellijstStand({ items: {} }, [{ id: 'toString' }]).gedaan === 0);
    const e = extraPaden({ wortel: '/w', env: { VARVE_PLANNEN: '/elders/plannen', VARVE_PATRONEN: '/w/patronen', VARVE_KAART: '/k/kaart.json' } });
    ok('extraPaden: een VARVE_*-map buiten de wortel wel, erbinnen niet; het kaartbestand erbij', e.length === 2 && e[0].map === '/elders/plannen' && e[1].map === '/k/kaart.json');
    ok('extraPaden zonder VARVE_KAART: het standaardpad', extraPaden({ wortel: '/w', env: {} })[0].map === KAART_STANDAARD);
    const { STANDAARD_PAD } = await import('../server/kaart.js');
    ok('KAART_STANDAARD = STANDAARD_PAD uit server/kaart.js', KAART_STANDAARD === STANDAARD_PAD);
  }

  console.log('10. de CLI (spawnSync, VARVE_AVONDPAKKET_NEP: nooit een server)');
  {
    const cli = (args, nep = FX, env = {}) => spawnSync(process.execPath, ['tools/avondpakket.mjs', ...args],
      { cwd: WORTEL, encoding: 'utf8', env: { ...process.env, VARVE_AVONDPAKKET_NEP: nep, ...env }, timeout: 20000 });
    const j = cli(['--json']);
    let rapport = null;
    try { rapport = JSON.parse(j.stdout); } catch { /* */ }
    ok(`--json → geldig JSON, standaardprofiel apc, bron fixtures, exit 0 (${j.status})`, rapport?.profiel === 'apc' && /fixtures/.test(rapport.bron) && j.status === 0);
    ok('--json: het punt server komt uit nep.json (bereikbaar)', rapport?.punten.find((p) => p.id === 'server').licht === 'ok');
    ok('oranje set (accu 65 %) → exit 0, met --streng exit 1', j.status === 0 && cli(['--streng']).status === 1);
    const groen = nepMap('groen', { 'pmset-batt': { tekst: "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t85%; charging; 1:00 remaining present: true\n" } });
    const g = cli(['--streng'], groen);
    ok(`groene set → exit 0, ook met --streng (${g.status}); tekst "KLAAR"`, g.status === 0 && /^KLAAR$/m.test(g.stdout));
    const rood = nepMap('rood', { 'find-dataless': 'find-dataless-3-HANDGEMAAKT.txt' });
    const r = cli(['--aankomst'], rood);
    ok(`rode set + --aankomst → exit 2, "NOG NIET BEGINNEN" (${r.status})`, r.status === 2 && /NOG NIET BEGINNEN/.test(r.stdout) && /✕ Media lokaal/.test(r.stdout));
    ok('rode set + --vertrek → "NOG NIET VERTREKKEN"', /NOG NIET VERTREKKEN/.test(cli(['--vertrek'], rood).stdout));
    const onb = cli(['--profiel', 'bestaatniet']);
    ok(`--profiel bestaatniet → exit 3 met de keuze (${onb.status})`, onb.status === 3 && /laptop, apc, maschine, alles, beeld/.test(onb.stderr));
    ok('--profiel constructor / __proto__ → exit 3 (review 2, fix 7)', cli(['--profiel', 'constructor']).status === 3 && cli(['--profiel', '__proto__']).status === 3);
    ok('tekst: de kop zegt hoe de fase gekozen is ("vertrek (auto)")', /· vertrek \(auto\) · \d\d:\d\d/.test(cli([]).stdout));
    ok('--vertrek --aankomst → exit 3', cli(['--vertrek', '--aankomst']).status === 3);
    ok('onbekende vlag of ongeldige poort → exit 3', cli(['--onzin']).status === 3 && cli(['--poort', 'abc']).status === 3 && cli(['--profiel']).status === 3);
    ok('--help → exit 0', cli(['--help']).status === 0);
    const leeg = cli(['--json'], nepMap('leeg', { 'find-stat': 'find-stat-leeg.txt' }));
    const media = JSON.parse(leeg.stdout).punten.find((p) => p.id === 'media');
    ok(`lege mediamap → media grijs "leeg", nooit groen (${media.licht})`, media.licht === 'uit' && media.waarde === 'leeg');
    const geen = cli([], nepMap('geen', { 'find-stat': { fout: 'bestaat niet' }, 'find-dataless': { fout: 'bestaat niet' }, server: { bereikbaar: false } }));
    ok(`geen server en geen mediamap → exit 3 (${geen.status})`, geen.status === 3 && /geen mediamap/.test(geen.stderr));
    const tekst = cli(['--profiel', 'laptop']).stdout;
    ok('tekst: paklijst van laptop met regel 9, geen /Users/', /Paklijst \(laptop\):/.test(tekst) && /☐ een kopie van library\.db/.test(tekst) && !tekst.includes('/Users/'));
    ok('tekst: maschine vertrek → AV-hub grijs "straks bij aankomst"', /○ AV-hub\s+dicht\s+straks bij aankomst/.test(cli(['--profiel', 'maschine']).stdout));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
