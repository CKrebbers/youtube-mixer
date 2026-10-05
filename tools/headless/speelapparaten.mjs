// De speelapparaten (Xboard49, Maschine MK2) van de AV-app-hub in VARVE, van begin tot
// eind in een echte Chromium (docs/MASCHINE.md, PROTOCOL §17 van de hub):
//
//   de ECHTE hub (startHub uit de hub-repo) met een nep-APC en een nep-Xboard49
//   (NepSysteem) en een nep-Maschine MK2 op HID-niveau (NepHidSysteem + nepMaschine uit
//   de hub-tests: echte HID-rapporten, de hub maakt er virtuele MIDI van), en VARVE met
//   ?hub=ws://…/app. Gemeten en gecontroleerd:
//     - het masterwiel zet een instrument (draaien = kiezen, indrukken = zetten)
//     - een Xboard-noot laat de Poly op de speeltrack klinken (niveau van de track)
//     - een groepknop zet de focus, een Maschine-pad slaat de drums aan (niveau)
//     - een draaiknop draait een instrumentknop
//     - de schuif (SysEx Master Volume) zet het volume van de speeltrack
//     - lampjes en schermen komen als HID-rapporten bij de nep-Maschine aan, en het
//       scherm is bit voor bit wat maschine-scherm.js van de stand maakt
//     - zonder ?hub= laadt niets hiervan; met ?hub= nooit requestMIDIAccess
//
// VEILIG MET DE APC (en een echte hub op 7700) AANGESLOTEN: requestMIDIAccess is een spion
// die telt en weigert; de hub luistert op een vrije poort (0), niet op 7700; geen node-hid
// (de nep-HID); eigen VARVE-server op een eigen poort met een tijdelijke database.
//
// Gebruik:  VARVE_HUB_REPO=<AV-app-hub> VARVE_KIJK_POORT=8818 node tools/headless/speelapparaten.mjs
//   VARVE_CHROME=<pad>  een eigen Chromium (anders kiest playwright-core uit de hub-repo)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const HUB = process.env.VARVE_HUB_REPO || join(WORTEL, '../av-app-hub');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8818;
const CHROME = process.env.VARVE_CHROME || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
for (const f of ['src/hub.js', 'src/ports/nep.js', 'test/nep-speelapparaten.js']) {
  if (!existsSync(join(HUB, f))) { console.error(`geen AV-app-hub met speelapparaten in ${HUB} (${f} ontbreekt; zet VARVE_HUB_REPO)`); process.exit(2); }
}
const { chromium } = await import(join(HUB, 'node_modules/playwright-core/index.mjs'));
const { startHub } = await import(join(HUB, 'src/hub.js'));
const { NepSysteem, NepHidSysteem } = await import(join(HUB, 'src/ports/nep.js'));
const { laadConfig } = await import(join(HUB, 'src/config.js'));
const MS = await import(join(HUB, 'src/devices/maschine-mk2.js'));
const { nepMaschine, rustFrame, XBOARD_NAAM } = await import(join(HUB, 'test/nep-speelapparaten.js'));
const { tekenScherm } = await import(join(WORTEL, 'src/control/maschine-scherm.js'));
const { PALETTE } = await import(join(WORTEL, 'src/control/devices/apc40mk2.js'));
const { KLEUREN } = await import(join(WORTEL, 'src/control/maschine.js'));

const tmp = mkdtempSync(join(tmpdir(), 'varve-speel-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const tot = async (fn, ms = 8000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(40); } return fn(); };
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');

const SPIONNEN = () => {
  window.__midi = 0;
  window.__ws = [];
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true,
    value: () => { window.__midi++; return Promise.reject(new DOMException('geen MIDI in de test', 'SecurityError')); } });
  const Echt = window.WebSocket;
  window.WebSocket = class extends Echt { constructor(url, p) { super(url, p); window.__ws.push(String(url)); } };
};

const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
await context.addInitScript(SPIONNEN);
const BASIS = `http://localhost:${POORT}/`;

async function open(url, klaar) {
  const page = await context.newPage();
  const verzoeken = [];
  page.on('request', (r) => verzoeken.push(r.url()));
  page.on('pageerror', (e) => console.log(`    [pagina] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(klaar, null, { timeout: 20000 });
  return { page, verzoeken };
}

// De hub: config zoals op de Mac, alleen sneller hotplug en geen echte HID.
const basis = laadConfig();
const config = { ...basis, hotplug_ms: 20, apparaten: { ...basis.apparaten, 'maschine-mk2': { ...basis.apparaten['maschine-mk2'], stil_ms: 200 } } };
const systeem = new NepSysteem();
const apc = systeem.voegToe('APC40 mkII');
const xb = systeem.voegToe(XBOARD_NAAM, { uitgang: false });
const hid = new NepHidSysteem();
const m = nepMaschine(hid);
hid.bijOpen = (p) => setTimeout(() => p.injecteer(rustFrame()), 1);
const echt = await startHub({ config, systeem, hid, poort: 0, drivers: false });
const appUrl = echt.adres.replace('http', 'ws') + '/app';

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASIS)).ok) break; } catch (_) {} await wacht(100); }

  console.log('zonder ?hub=: niets van de speelapparaten');
  {
    const g = await open(BASIS, () => window.midi && window.feedback);
    await wacht(500);
    const v = g.verzoeken.filter((u) => /speelapparaten\.js|control\/maschine|maschine-scherm|maschine-mk2/.test(u));
    ok('speelapparaten.js, maschine.js, maschine-scherm.js en de Maschine-indeling niet geladen', v.length === 0, v.join(', '));
    ok('geen WebSocket, geen window.maschine', (await g.page.evaluate(() => window.__ws.length === 0 && window.maschine === undefined)));
    await g.page.close();
  }

  console.log(`\nmet ?hub= (de echte hub op ${appUrl})`);
  const { page, verzoeken } = await open(`${BASIS}?hub=${encodeURIComponent(appUrl)}`, () => window.maschine && window.noten && window.engine);
  const doe = (fn, arg) => page.evaluate(fn, arg);
  ok('VARVE speelt beide: beeld.spelers', await tot(() => {
    const b = echt.kern.beeld();
    return b.spelers?.xboard49 === 'varve-dj' && b.spelers?.['maschine-mk2'] === 'varve-dj' && b.apparaten?.['maschine-mk2']?.status === 'verbonden';
  }), JSON.stringify(echt.kern.beeld().spelers));
  echt.kern.focus('varve-dj');
  ok('speelapparaten.js, maschine.js en mappings/maschine-mk2.json geladen', ['speelapparaten.js', 'control/maschine.js', 'maschine-scherm.js', 'mappings/maschine-mk2.json'].every((x) => verzoeken.some((u) => u.includes(x))));
  await doe(() => window.engine.resume?.());
  ok('de AudioContext loopt', await tot(() => doe(() => window.engine.ctx.state === 'running')), await doe(() => window.engine.ctx.state));
  await doe(() => {
    window.__noten = [];
    window.noten.on('noot', (x) => window.__noten.push({ ...x, t: performance.timeOrigin + performance.now() }));
  });

  // ---- het masterwiel: Poly op track 1 (de focus) ----
  // Het EERSTE knoppenrapport na aansluiten zet in de hub alleen de beginstand van wiel en
  // draaiknoppen (die tellers hebben geen nulpunt, MaschineSessie): eerst één neutraal rapport.
  m.los('shift');
  await wacht(100);
  m.wiel(1);
  ok('masterwiel één klik: een keuze op het scherm, nog geen instrument', await tot(() => doe(() => window.maschine.stand().kandidaat?.naam === 'Poly' && !window.engine.instrumentOp('A'))));
  m.tik('wiel');
  ok('masterwiel indrukken: de Poly staat op track 1', await tot(() => doe(() => window.engine.instrumentOp('A')?.soort === 'poly')));

  // ---- Xboard-noot -> de Poly klinkt ----
  const piek = async (id, ms) => doe(async ({ id, ms }) => {
    const d = window.engine.deck(id); let p = 0; const eind = performance.now() + ms;
    while (performance.now() < eind) { p = Math.max(p, d.level()); await new Promise((r) => setTimeout(r, 10)); }
    return p;
  }, { id, ms });
  const stilA = await piek('A', 200);
  const tXb = Date.now();
  xb.injecteer([0x90, 60, 100]);
  const aanA = await piek('A', 500);
  const noot = await tot(() => doe(() => window.__noten.find((x) => x.noot === 60 && x.aan)));
  ok('Xboard49 noot C4 -> de Poly op de speeltrack klinkt', aanA > 0.05 && aanA > stilA * 10, `stil ${db(stilA)} dBFS, met de noot ${db(aanA)} dBFS`);
  ok('… de noot kwam binnen via de hub (Xboard -> hub -> VARVE -> noteOn)', !!noot, noot ? `${(noot.t - tXb).toFixed(1)} ms van injecteren tot noteOn` : '');
  xb.injecteer([0x80, 60, 0]);
  await wacht(1500);
  const naA = await piek('A', 200);
  ok('… noot los: hij klinkt uit', naA < aanA / 10, `${db(naA)} dBFS`);

  // ---- groepknop B -> focus, wiel -> drums, pad -> klinkt ----
  m.tik('groepB');
  ok('groepknop B: focus op track 2', await tot(() => doe(() => window.engine.focus === 'B')));
  m.wiel(4);
  m.tik('wiel');
  ok('masterwiel vier klikken + indrukken: de drums op track 2', await tot(() => doe(() => window.engine.instrumentOp('B')?.soort === 'drums')));
  await tot(() => doe(() => window.engine.instrumentOp('B').stand().pads?.[0]?.gevuld), 4000);
  const stilB = await piek('B', 200);
  const tPad = Date.now();
  const piekPad = piek('B', 600);
  m.pad(1, 'hard');
  const aanB = await piekPad;
  const slag = await tot(() => doe(() => window.__noten.find((x) => x.id === 'B' && x.noot === 36 && x.aan)));
  ok('Maschine pad 1 (noot 36) -> de kick van de drums klinkt', aanB > 0.05 && aanB > stilB * 10, `stil ${db(stilB)}, slag ${db(aanB)} dBFS`);
  ok('… via de hub (HID-rapport -> virtuele MIDI -> VARVE -> noteOn)', !!slag, slag ? `${(slag.t - tPad).toFixed(1)} ms van het eerste padrapport tot noteOn` : '');

  // ---- een draaiknop ----
  const knop1 = () => doe(() => window.engine.instrumentOp('B').leesParam(1));
  const voorK = await knop1();
  m.draai(0, 200);
  ok('draaiknop 1, 200 tellen rechtsom -> instrumentknop 1 van de drums +0,2', await tot(async () => Math.abs((await knop1()) - voorK - 0.2) < 0.015), `${voorK.toFixed(3)} -> ${(await knop1()).toFixed(3)}`);
  m.druk('shift');
  const voorF = await knop1();
  m.draai(0, -200);
  await tot(async () => (await knop1()) < voorF - 0.03);
  m.los('shift');
  ok('… met SHIFT fijn: −200 tellen = −0,04', Math.abs((await knop1()) - voorF + 0.04) < 0.006, `${voorF.toFixed(3)} -> ${(await knop1()).toFixed(3)}`);

  // ---- de schuif van de Xboard: het volume van de speeltrack ----
  const fader = () => doe(() => window.engine.deck('B').ui.fader);
  const voorV = await fader();
  for (const w of [16383, 14000, 12000, 9000]) { xb.injecteer([0xf0, 0x7f, 0x7f, 0x04, 0x01, w & 0x7f, (w >> 7) & 0x7f, 0xf7]); await wacht(30); }
  ok('Xboard-schuif (SysEx Master Volume) -> de fader van de speeltrack (opgepakt, dan gevolgd)', await tot(async () => Math.abs((await fader()) - 9000 / 16383) < 0.01), `${voorV.toFixed(3)} -> ${(await fader()).toFixed(3)}`);

  // ---- lampjes en schermen als HID-rapporten ----
  await wacht(400);
  const r = m.laatste();
  const padRgb = (rap, pad) => rap.slice(1 + 3 * MS.plekVanPad(pad), 4 + 3 * MS.plekVanPad(pad));
  const groepRgb = (rap, i) => rap.slice(1 + 6 * i, 4 + 6 * i);
  const isKleur = (a, idx) => JSON.stringify(a) === JSON.stringify(MS.paletRgb(idx));
  ok(`pad-lampjes (rapport 0x80): de drums gedimd (${KLEUREN.drums}donker), lege pads 9–16 donkergrijs`, !!r['80'] && isKleur(padRgb(r['80'], 1), PALETTE[`${KLEUREN.drums}donker`]) && isKleur(padRgb(r['80'], 9), PALETTE.donkergrijs),
    r['80'] ? `pad 1 ${padRgb(r['80'], 1)}, pad 9 ${padRgb(r['80'], 9)}` : 'geen 0x80');
  ok(`groep-lampjes (rapport 0x81): B = drums vol (focus), A = Poly gedimd (${KLEUREN.poly}donker), C = uit`, !!r['81'] && isKleur(groepRgb(r['81'], 1), PALETTE[KLEUREN.drums]) && isKleur(groepRgb(r['81'], 0), PALETTE[`${KLEUREN.poly}donker`]) && isKleur(groepRgb(r['81'], 2), 0),
    r['81'] ? `A ${groepRgb(r['81'], 0)}, B ${groepRgb(r['81'], 1)}, C ${groepRgb(r['81'], 2)}` : 'geen 0x81');
  const ingedrukt = m.poort.verstuurd.length;
  const vast = Array.from({ length: 16 }, (_, plek) => (plek === MS.plekVanPad(3) ? 1500 : 0));
  const { padFrame } = await import(join(HUB, 'test/nep-speelapparaten.js'));
  for (let i = 0; i < 4; i++) m.stuur(padFrame(vast.map((x) => x * (i + 1) / 4)));
  ok('pad 3 ingedrukt: zijn lampje fel (de volle kleur)', await tot(() => m.poort.verstuurd.slice(ingedrukt).some((x) => x[0] === 0x80 && isKleur(padRgb(x, 3), PALETTE[KLEUREN.drums]))));
  m.stuur(padFrame(Array(16).fill(0)));
  // Het scherm: de 8 stukken van 0xE0/0xE1 terug tot 2048 bytes, gelijk aan tekenScherm(stand).
  await wacht(600);
  const stand = await doe(() => window.maschine.stand());
  await wacht(300);
  const lees = (nr) => {
    const l = m.laatste();
    const uit = new Uint8Array(2048);
    for (let i = 0; i < 8; i++) { const stuk = l[`e${nr}:${i}`]; if (!stuk) return null; uit.set(stuk.slice(9), i * 256); }
    return uit;
  };
  const links = lees(0), rechts = lees(1);
  const gelijk = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
  ok('beide schermen als HID-rapporten aangekomen (8 stukken van 9 + 256 bytes elk)', !!links && !!rechts);
  ok('linkerscherm bit voor bit tekenScherm(stand, 0): "T2 Drums" en knop 1–4', gelijk(links, tekenScherm(stand, 0)), `T${stand.speel?.nr} ${stand.speel?.naam}`);
  ok('rechterscherm bit voor bit tekenScherm(stand, 1): knop 5–8', gelijk(rechts, tekenScherm(stand, 1)));
  const h = await doe(() => ({ midi: window.__midi, st: window.midi.status().hub.speelt }));
  ok('requestMIDIAccess NOOIT aangeroepen', h.midi === 0, `${h.midi}×`);
  ok('status: lampjes en schermen geteld, niets geweigerd', h.st['maschine-mk2'].leds > 20 && h.st['maschine-mk2'].schermen >= 2 && h.st['maschine-mk2'].geweigerd === 0,
    `${h.st['maschine-mk2'].leds} lampjes, ${h.st['maschine-mk2'].schermen} schermen, xboard rx ${h.st.xboard49.rx}, maschine rx ${h.st['maschine-mk2'].rx}`);
  ok('de APC-lease werkt nog: LED\'s van VARVE op de APC', apc.verstuurd.filter((b) => b[0] >= 0x80 && b[0] < 0xc0).length > 100);
} finally {
  await browser.close().catch(() => {});
  await echt.stop().catch(() => {});
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
