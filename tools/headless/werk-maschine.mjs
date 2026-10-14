// Spoor S6 van de werkruimte (docs/werkruimte/S6.md): de Maschine per deel, van begin tot eind in een
// echte Chromium, met de ECHTE hub (startHub uit de hub-repo), een nep-APC (NepSysteem) en een
// nep-Maschine MK2 op HID-niveau (NepHidSysteem + nepMaschine uit de hub-tests), zoals
// tools/headless/speelapparaten.mjs. VARVE draait met ?hub=…&werk=twee-handen (het voorbeeld met de
// stukken maschine-delen en maschine-houd). Gecontroleerd en gemeten:
//   - F1–F8 wisselen het deel; de grid-LED's van de APC krijgen de kleur van het deel (tijd gemeten)
//   - het Maschine-scherm toont de 8 deelnamen met het actieve omgekeerd (bit voor bit tekenScherm)
//   - FX: twee pads tegelijk = twee worpen (reads 1 en 1, na loslaten de oude stand)
//   - VOLUME vast + draaiknop 3 = track.3.fader
//   - UITLIJN: de ring van device knob 2 op de APC volgt track.2.phase.offset
//   - het wiel is jog in MIX en bladert met de library open
//   - SHIFT + F1 = THUIS vanuit elk deel
//   - de volgorde over twee apparaten: 1000 × SOLO (Maschine) en 5 ms later een APC-knop met een
//     regel in houd.solo; hoe vaak de volgorde klopt en de scheefheid (p50/p99)
//   - de nep-Maschine weg: apc-alleen met één melding (zie de opmerking bij "weg" hieronder)
//
// VEILIG MET DE APC AANGESLOTEN: requestMIDIAccess is een spion die weigert; de hub luistert op een
// vrije poort; geen node-hid; eigen VARVE-server met alles (VARVE_*) in een tijdelijke map.
//
// Gebruik:  VARVE_HUB_REPO=<AV-app-hub> node tools/headless/werk-maschine.mjs
//   VARVE_KIJK_POORT=8975  de poort van de proefserver   VARVE_CHROME=<pad>  een eigen Chromium
//   VARVE_VOLGORDE=1000    hoe vaak SOLO + APC-knop
//
// Bank (alleen Node, geen hub of Chromium): wat de pads in SPELEN (maschine.ontvang -> noten) en de
// LED-tik van de Maschine (ledBeeld) kosten, voor en na:
//   node tools/headless/werk-maschine.mjs --bench <wortel-voor> [<wortel-na>]
//   (wortel-voor = een uitgepakte git archive van de basis; zonder wortel-na: deze map)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));

if (process.argv[2] === '--bench') {
  const [voor, na = WORTEL] = process.argv.slice(3);
  if (!voor) { console.error('gebruik: --bench <wortel-voor> [<wortel-na>]'); process.exit(2); }
  const bank = async (wortel) => {
    const imp = (p) => import(pathToFileURL(join(wortel, p)).href);
    const { Maschine } = await imp('src/control/maschine.js');
    const { parseMessage } = await imp('src/control/midi.js');
    const doc = JSON.parse(readFileSync(join(wortel, 'mappings/maschine-mk2.json'), 'utf8'));
    const inst = { soort: 'drums', naam: 'Drums', params: [], leesParam: () => 0.5, stand: () => ({ pads: Array.from({ length: 16 }, () => ({ gevuld: true })) }) };
    const eng = { focus: 'A', speeltrack: () => 'A', instrumentOp: (id) => (id === 'A' ? inst : null), deck: () => ({ buffer: null }), patronen: null, sampler: null };
    let t = 0;
    const noten = { ontvang: () => true, los() {}, ingedrukt: () => new Set() };
    const m = new Maschine({ engine: eng, noten, read: () => null, invoke: () => {}, nu: () => t });
    m.laadMapping(doc);
    const N = 20000;
    const pads = Array.from({ length: N }, (_, i) => parseMessage(new Uint8Array(i % 2 ? [0x80, 36 + ((i >> 1) % 16), 0] : [0x90, 36 + ((i >> 1) % 16), 100])));
    const ronde = (fn, n) => { const t0 = process.hrtime.bigint(); for (let i = 0; i < n; i++) fn(i); return Number(process.hrtime.bigint() - t0) / 1000 / n; };
    const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    const pad = (i) => { t += 1; m.ontvang(pads[i % N]); };
    const led = () => { t += 33; m.ledBeeld(); };
    for (let w = 0; w < 3; w++) { ronde(pad, N); ronde(led, 2000); }
    return { pad: med(Array.from({ length: 9 }, () => ronde(pad, N))), led: med(Array.from({ length: 9 }, () => ronde(led, 2000))) };
  };
  // Om en om, vijf keer, zodat de warmte van de machine beide gelijk treft.
  const r = { voor: [], na: [] };
  for (let i = 0; i < 5; i++) { r.voor.push(await bank(voor)); r.na.push(await bank(na)); }
  const m2 = (xs, k) => [...xs.map((x) => x[k])].sort((a, b) => a - b)[2];
  const v = { pad: m2(r.voor, 'pad'), led: m2(r.voor, 'led') }, n = { pad: m2(r.na, 'pad'), led: m2(r.na, 'led') };
  console.log(`pad in SPELEN (ontvang -> noten), µs per bericht:  voor ${v.pad.toFixed(3)}  na ${n.pad.toFixed(3)}  (${(n.pad - v.pad >= 0 ? '+' : '')}${((n.pad - v.pad) / 1000).toFixed(5)} ms)`);
  console.log(`LED-tik van de Maschine (ledBeeld), µs per tik:      voor ${v.led.toFixed(2)}  na ${n.led.toFixed(2)}  (${((n.led / v.led - 1) * 100).toFixed(1)}%)`);
  process.exit(0);
}
const HUB = process.env.VARVE_HUB_REPO || join(WORTEL, '../av-app-hub');
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8975;
const KEER = Number(process.env.VARVE_VOLGORDE) || 1000;
const CHROME = process.env.VARVE_CHROME || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
for (const f of ['src/hub.js', 'src/ports/nep.js', 'test/nep-speelapparaten.js']) {
  if (!existsSync(join(HUB, f))) { console.error(`geen AV-app-hub met speelapparaten in ${HUB} (${f} ontbreekt; zet VARVE_HUB_REPO)`); process.exit(2); }
}
const { chromium } = await import(join(HUB, 'node_modules/playwright-core/index.mjs'));
const { startHub } = await import(join(HUB, 'src/hub.js'));
const { NepSysteem, NepHidSysteem } = await import(join(HUB, 'src/ports/nep.js'));
const { laadConfig } = await import(join(HUB, 'src/config.js'));
const MS = await import(join(HUB, 'src/devices/maschine-mk2.js'));
const { nepMaschine, rustFrame, padFrame } = await import(join(HUB, 'test/nep-speelapparaten.js'));
const { tekenScherm, leesPixel } = await import(join(WORTEL, 'src/control/maschine-scherm.js'));
const { PALETTE } = await import(join(WORTEL, 'src/control/devices/apc40mk2.js'));

const tmp = mkdtempSync(join(tmpdir(), 'varve-werk-maschine-'));
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const tot = async (fn, ms = 8000) => { const eind = Date.now() + ms; while (Date.now() < eind) { const x = await fn(); if (x) return x; await wacht(20); } return fn(); };
const kwantiel = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const ms = (x) => `${x.toFixed(2)} ms`;
/** Precies wachten (busy-wait op de hrtime): setTimeout is op 1 ms nauwkeurig, de proef vraagt 5 ms. */
const precies = (msWacht) => { const eind = process.hrtime.bigint() + BigInt(Math.round(msWacht * 1e6)); while (process.hrtime.bigint() < eind) { /* wachten */ } };

const SPIONNEN = () => {
  window.__midi = 0;
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', { configurable: true,
    value: () => { window.__midi++; return Promise.reject(new DOMException('geen MIDI in de test', 'SecurityError')); } });
};

const map = (n) => join(tmp, n);
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: map('lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: map('media'), VARVE_OPNAMES: map('opnames'),
    VARVE_PATRONEN: map('patronen'), VARVE_PLANNEN: map('plannen'), VARVE_STANDEN: map('standen'), VARVE_WERKRUIMTES: map('werkruimtes'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(SPIONNEN);
const BASIS = `http://localhost:${POORT}/`;

// De hub zoals in speelapparaten.mjs: snelle hotplug, geen echte HID, opname: false.
const basis = laadConfig();
const config = { ...basis, hotplug_ms: 20, apparaten: { ...basis.apparaten, 'maschine-mk2': { ...basis.apparaten['maschine-mk2'], stil_ms: 200 } } };
const systeem = new NepSysteem();
const apc = systeem.voegToe('APC40 mkII');
const hid = new NepHidSysteem();
const m = nepMaschine(hid);
hid.bijOpen = (p) => setTimeout(() => p.injecteer(rustFrame()), 1);
const echt = await startHub({ config, systeem, hid, poort: 0, drivers: false, opname: false });
const appUrl = echt.adres.replace('http', 'ws') + '/app';

// Wat de hub naar de nep-APC stuurt, met de tijd van aankomst (node-klok).
const apcIn = [];
const push = apc.verstuurd.push.bind(apc.verstuurd);
apc.verstuurd.push = (...x) => { for (const b of x) apcIn.push({ t: performance.now(), b }); return push(...x); };

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASIS)).ok) break; } catch (_) {} await wacht(100); }
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`    [pagina] ${e.message}`));
  await page.goto(`${BASIS}?hub=${encodeURIComponent(appUrl)}&werk=twee-handen`);
  await page.waitForFunction(() => window.maschine && window.werk && window.engine, null, { timeout: 20000 });
  const doe = (fn, arg) => page.evaluate(fn, arg);
  echt.kern.focus('varve-dj');
  m.los('shift');   // het eerste knoppenrapport zet in de hub alleen de beginstand (speelapparaten.mjs)
  await wacht(100);
  await doe(() => window.engine.resume?.());

  console.log('de werkruimte twee-handen met de Maschine');
  ok('werkruimte twee-handen actief (de Maschine is er, geen terugval)', await tot(() => doe(() => window.werk.naam === 'twee-handen' && !window.werk.terug), 15000),
    await doe(() => `${window.werk.naam} ${JSON.stringify(window.werk.terug)}`));
  ok('de stukken staan op de Maschine (fragmenten stuk:maschine-delen en stuk:maschine-houd)',
    await tot(() => doe(() => window.maschine.mapping.extra.has('stuk:maschine-delen') && window.maschine.mapping.extra.has('stuk:maschine-houd'))));
  const delen = await doe(() => window.werk.delen().map((d) => ({ naam: d.naam, label: d.label, kleur: d.kleur })));
  ok('acht delen', delen.length === 8, delen.map((d) => d.label).join(' '));

  // Spionnen in de pagina: de bus, de meldingen.
  await doe(async () => {
    window.__a = await import('/src/control/actions.js');
    window.__bus = [];
    window.__a.bijInvoke((id, v) => window.__bus.push([id, v, performance.now()]));
    window.__meld = [];
    const o = window.werk.meld;
    window.werk.meld = (...x) => { window.__meld.push(String(x[0])); return o(...x); };
  });
  await wacht(100);

  // ---- F1–F8 ----------------------------------------------------------------------------------
  console.log('\nF1–F8 wisselen het deel; de APC-grid krijgt de kleur van het deel');
  // Een rack op track 1 (de worpen in FX hebben plekken nodig) en de demo op track 1 en 2 met een grid
  // (jog en de fasemeters hebben een nummer nodig).
  await doe(async () => {
    const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const { Beatgrid } = await import('/src/engine/beatgrid.js');
    const e = window.engine;
    const buf = renderDemoTrack(e.ctx, { bars: 16 });
    for (const id of ['A', 'B']) {
      const d = e.deck(id);
      await d.laadGeheugen(buf, `demo ${id}`);
      d.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 }));
    }
    const sj = await (await fetch('/racks/sjablonen.json')).json();
    e.deck('A').fx.zetRack(sj.racks[0]);
  });
  // Grid-pads (noot 0–39) en scene-knoppen (82–86) op kanaal 0: wat een grid-mapje laat branden.
  const gridNoot = (b) => (b[0] & 0xf0) === 0x90 && (b[0] & 0x0f) === 0 && (b[1] < 40 || (b[1] >= 82 && b[1] <= 86));
  // In VARVE: wanneer kwam de F-knop binnen (maschine.geraakt) en wanneer ging de eerste grid-LED naar de hub.
  await doe(() => {
    window.__lang = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lang.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: false });
    window.__ledUit = [];
    const o = window.midi._stuur.bind(window.midi);
    window.midi._stuur = (b) => { if (b?.t === 'led' && !b.dev) window.__ledUit.push({ t: performance.now(), bytes: b.bytes }); return o(b); };
  });
  const RONDES = 5;
  const wissel = [];
  for (let ronde = 0; ronde < RONDES; ronde++) {
    for (const i of [1, 2, 3, 4, 5, 6, 7, 0]) {   // MIX is het startdeel: eerst weg, dan terug
      const d = delen[i];
      const voor = apcIn.length;
      const voorUit = await doe(() => window.__ledUit.length);
      const t0 = performance.now();
      m.tik(`f${i + 1}`);
      const gelukt = await tot(() => doe((n) => window.werk.deel === n, d.naam), 3000);
      const apcMapje = await doe((n) => window.werk.deelDef(n)?.apc40mk2?.grid ?? null, d.naam);
      const vorigMapje = wissel.length ? wissel[wissel.length - 1].apcMapje : 'hotcues';
      const andersGrid = apcMapje && apcMapje !== vorigMapje;
      // De eerste grid-LED na de druk (het grid-mapje wisselt), en of er een in de deelkleur bij zit.
      let eerste = null;
      if (andersGrid) eerste = await tot(() => apcIn.slice(voor).find((x) => gridNoot(x.b)), 2000);
      await wacht(120);
      const kleuren = [PALETTE[d.kleur], PALETTE[`${d.kleur}donker`]].filter((x) => x !== undefined);
      const inKleur = apcIn.slice(voor).find((x) => gridNoot(x.b) && kleuren.includes(x.b[2]));
      const intern = andersGrid ? await doe((v) => {
        const g = window.maschine.geraakt?.t;
        const u = window.__ledUit.slice(v).find((x) => x.bytes.some((b) => (b[0] & 0xf0) === 0x90 && (b[0] & 0x0f) === 0 && (b[1] < 40 || (b[1] >= 82 && b[1] <= 86))));
        return g && u ? { ms: u.t - g, lang: window.__lang.filter((x) => x.t + x.d > g && x.t < u.t).map((x) => Math.round(x.d)) } : null;
      }, voorUit) : null;
      wissel.push({ deel: d.label, gelukt, apcMapje, andersGrid, ms: eerste ? eerste.t - t0 : null, intern: intern?.ms ?? null, lang: intern?.lang ?? [], kleurMs: inKleur ? inKleur.t - t0 : null });
    }
  }
  ok(`F1–F8: elk deel gekozen (${RONDES} rondes)`, wissel.every((w) => w.gelukt), wissel.filter((w) => !w.gelukt).map((w) => w.deel).join(','));
  const metGrid = wissel.filter((w) => w.andersGrid);
  const snel = metGrid.map((w) => w.ms).filter((x) => x !== null);
  const intern = metGrid.map((w) => w.intern).filter((x) => x !== null);
  console.log(`      druk op F (HID in de hub) -> eerste grid-LED op de nep-APC: mediaan ${ms(kwantiel(snel, 0.5))}, p95 ${ms(kwantiel(snel, 0.95))}, max ${ms(Math.max(...snel))} (${snel.length} wissels)`);
  const traag = metGrid.filter((w) => w.intern > 33);
  console.log(`      wissels boven 33 ms in VARVE: ${traag.length}/${metGrid.length}${traag.length ? `, ${traag.map((w) => `${w.deel} ${w.intern.toFixed(1)} ms (lange taak ${w.lang.join('+') || 'geen'} ms)`).join(', ')}` : ''}`);
  console.log(`      daarvan in VARVE (F binnen -> LED naar de hub): mediaan ${ms(kwantiel(intern, 0.5))}, p95 ${ms(kwantiel(intern, 0.95))}, max ${ms(Math.max(...intern))}`);
  ok('elke wissel van het APC-grid-mapje: de grid-LED\'s wisselen mee', snel.length === metGrid.length, `${snel.length}/${metGrid.length}`);
  ok('… binnen 33 ms na de druk op F (mediaan, Maschine -> hub -> VARVE -> hub -> APC)', kwantiel(snel, 0.5) <= 33, ms(kwantiel(snel, 0.5)));
  ok('… in VARVE zelf binnen 33 ms (mediaan)', kwantiel(intern, 0.5) <= 33, `mediaan ${ms(kwantiel(intern, 0.5))}, p95 ${ms(kwantiel(intern, 0.95))}`);
  // Ter vergelijking: dezelfde wissels zonder de Maschine (werk.kiesDeel vanuit de pagina, zoals de werk-balk).
  const zonderM = await doe(async (rondes) => {
    const uit = [];
    const grid = (b) => (b[0] & 0xf0) === 0x90 && (b[0] & 0x0f) === 0 && (b[1] < 40 || (b[1] >= 82 && b[1] <= 86));
    const namen = window.werk.delen().map((d) => d.naam);
    let vorig = window.werk.deelDef()?.apc40mk2?.grid;
    for (let r = 0; r < rondes; r++) {
      for (const n of [...namen.slice(1), namen[0]]) {
        const g = window.werk.deelDef(n)?.apc40mk2?.grid;
        const v = window.__ledUit.length;
        const t = performance.now();
        window.werk.kiesDeel(n, { door: 'proef' });
        if (g && g !== vorig) {
          const eind = t + 1000;
          while (performance.now() < eind && !window.__ledUit.slice(v).some((x) => x.bytes.some(grid))) await new Promise((z) => setTimeout(z, 1));
          const u = window.__ledUit.slice(v).find((x) => x.bytes.some(grid));
          if (u) uit.push(u.t - t);
        }
        if (g) vorig = g;
        await new Promise((z) => setTimeout(z, 120));
      }
    }
    return uit;
  }, RONDES);
  console.log(`      ter vergelijking zonder de Maschine (werk.kiesDeel -> LED naar de hub): mediaan ${ms(kwantiel(zonderM, 0.5))}, p95 ${ms(kwantiel(zonderM, 0.95))}, max ${ms(Math.max(...zonderM))} (${zonderM.length} wissels)`);
  const fx = wissel.filter((w) => w.deel === 'FX').map((w) => w.kleurMs);
  ok('FX: de grid in de kleur van het deel (fx-matrix violet), elke ronde', fx.every((x) => x !== null), fx.map((x) => (x === null ? 'geen' : ms(x))).join(', '));

  // ---- wat de Maschine per tik kost, per deel ----------------------------------------------------
  console.log('\nwat een tik van de Maschine kost (lampjes + schermen, de schermen elke keer opnieuw), per deel');
  const kosten = await doe(async () => {
    const uit = {};
    const m = window.maschine;
    for (const d of window.werk.delen()) {
      window.werk.kiesDeel(d.naam, { door: 'proef' });
      await new Promise((r) => setTimeout(r, 50));
      const N = 200;
      let t = performance.now();
      for (let i = 0; i < N; i++) m.ledBeeld();
      const led = (performance.now() - t) / N;
      t = performance.now();
      for (let i = 0; i < N; i++) m.stand();
      const stand = (performance.now() - t) / N;
      uit[d.label] = { led, stand };
    }
    window.werk.kiesDeel('mix', { door: 'proef' });
    return uit;
  });
  console.log(`      ${Object.entries(kosten).map(([k, v]) => `${k}: lampjes ${v.led.toFixed(3)} ms, stand ${v.stand.toFixed(3)} ms`).join(' · ')}`);

  // ---- het scherm: de 8 deelnamen ----------------------------------------------------------------
  console.log('\nhet Maschine-scherm: de deelnamen, het actieve omgekeerd');
  m.tik('f3');
  await tot(() => doe(() => window.werk.deel === 'fx'));
  await wacht(500);
  const leesScherm = (nr) => {
    const l = m.laatste();
    const uit = new Uint8Array(2048);
    for (let i = 0; i < 8; i++) { const stuk = l[`e${nr}:${i}`]; if (!stuk) return null; uit.set(stuk.slice(9), i * 256); }
    return uit;
  };
  const stand = await doe(() => window.maschine.stand());
  await wacht(300);
  const links = leesScherm(0), rechts = leesScherm(1);
  const gelijk = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
  ok('stand.delen: acht namen, FX actief', stand.delen?.labels?.length === 8 && stand.delen.labels[stand.delen.actief] === 'FX');
  ok('beide schermen bit voor bit tekenScherm(stand)', gelijk(links, tekenScherm(stand, 0)) && gelijk(rechts, tekenScherm(stand, 1)));
  const vol = (buf, x0) => { let n = 0; for (let y = 0; y < 8; y++) for (let x = x0; x < x0 + 63; x++) n += leesPixel(buf, x, y) ? 1 : 0; return n / (63 * 8); };
  ok('links: vak 3 (FX) omgekeerd, MIX en UITLIJN niet', links && vol(links, 128) > 0.7 && vol(links, 0) < 0.3 && vol(links, 64) < 0.3,
    links ? `${[0, 64, 128, 192].map((x) => vol(links, x).toFixed(2)).join(' ')}` : '');
  ok('rechts: STEMS … LIBRARY, geen omgekeerd', rechts && [0, 64, 128, 192].every((x) => vol(rechts, x) > 0 && vol(rechts, x) < 0.3));

  // ---- FX: twee worpen tegelijk -------------------------------------------------------------------
  console.log('\nFX: twee pads tegelijk = twee worpen');
  ok('FX: padmodus worpen op de Maschine', await doe(() => window.maschine.modus === 'worpen'));
  await doe(() => { window.__a.invoke('track.1.focus', true); window.__a.invoke('track.1.focus', false); });
  const leesK = () => doe(() => [window.__a.read('track.1.fx.knob.1'), window.__a.read('track.1.fx.knob.2')]);
  const oud = await leesK();
  const plekken = Array(16).fill(0);
  plekken[MS.plekVanPad(1)] = 1500; plekken[MS.plekVanPad(2)] = 1500;
  for (let i = 1; i <= 4; i++) m.stuur(padFrame(plekken.map((x) => x * i / 4)));
  const tijdens = await tot(async () => { const k = await leesK(); return k[0] === 1 && k[1] === 1 ? k : null; }, 3000) || await leesK();
  ok('pad 1 en 2 vast: plek 1 en plek 2 allebei vol (reads 1 en 1)', tijdens[0] === 1 && tijdens[1] === 1, `voor ${oud.map((x) => x?.toFixed?.(2)).join(', ')}, tijdens ${tijdens.join(', ')}`);
  m.stuur(padFrame(Array(16).fill(0)));
  const na = await tot(async () => { const k = await leesK(); return Math.abs(k[0] - oud[0]) < 1e-9 && Math.abs(k[1] - oud[1]) < 1e-9 ? k : null; }, 3000) || await leesK();
  ok('… los: de oude stand terug', Math.abs(na[0] - oud[0]) < 1e-9 && Math.abs(na[1] - oud[1]) < 1e-9, `na ${na.map((x) => x?.toFixed?.(3)).join(', ')}`);

  // ---- VOLUME vast + draaiknop 3 -------------------------------------------------------------------
  console.log('\nVOLUME vast + draaiknop 3 = de fader van track 3');
  const f3 = () => doe(() => window.engine.deck('C').ui.fader);
  const voorF = await f3();
  m.druk('volume');
  await tot(() => doe(() => window.maschine.houd.isOpen('volume')));
  m.draai(2, -200);
  const naF = await tot(async () => { const f = await f3(); return Math.abs(f - (voorF - 0.2)) < 0.02 ? f : null; }, 3000) || await f3();
  m.los('volume');
  ok('track.3.fader −0,2 (200 tellen, step 0,001)', Math.abs(naF - (voorF - 0.2)) < 0.02, `${voorF.toFixed(3)} -> ${naF.toFixed(3)}`);
  ok('VOLUME los: het houd-mapje dicht', await tot(() => doe(() => !window.maschine.houd.isOpen('volume'))));

  // ---- UITLIJN: de ring van device knob 2 volgt track.2.phase.offset ---------------------------------
  console.log('\nUITLIJN: de fasemeter op de APC (device knob 2 = track 2)');
  m.tik('f2');
  ok('UITLIJN: het APC-mapje device.uitlijn staat open', await tot(() => doe(() => window.werk.deel === 'uitlijn' && window.lagen.stand.device === 'uitlijn')));
  await doe(() => { const e = window.engine; e.deck('A').set('fader', 1); e.deck('B').set('fader', 0.8); e.deck('A').play(); e.deck('B').play(); });
  await wacht(400);
  const ring = async () => { const x = [...apcIn].reverse().find((a) => (a.b[0] & 0xf0) === 0xb0 && a.b[1] === 17); return x ? x.b[2] : null; };
  const metingen = [];
  for (const dv of [0.06, -0.12, 0.08]) {
    const r = await doe((dv) => { const w = window.__a.read('track.2.phase.offset'); return w === null ? null : w; }, dv);
    if (r === null) { metingen.push(null); continue; }
    await doe((v) => window.__a.invoke('track.2.phase.offset', v), Math.min(1, Math.max(0, r + dv)));
    await wacht(150);
    const lees = await doe(() => window.__a.read('track.2.phase.offset'));
    const rr = await tot(async () => { const x = await ring(); return x !== null && Math.abs(x - Math.round(lees * 127)) <= 3 ? x : null; }, 1500) ?? await ring();
    metingen.push({ read: lees, ring: rr });
  }
  ok('de ring van device knob 2 (cc:0:17) volgt de read van track.2.phase.offset (±3 van 127)', metingen.every((x) => x && x.ring !== null && Math.abs(x.ring - Math.round(x.read * 127)) <= 3),
    metingen.map((x) => (x ? `${x.read?.toFixed(3)} -> ${x.ring}` : 'geen read')).join(', '));
  await doe(() => { window.engine.deck('A').pause?.(); window.engine.deck('B').pause?.(); });

  // ---- het wiel: jog in MIX, bladeren met de library open ----------------------------------------------
  console.log('\nhet wiel');
  m.tik('f1');
  await tot(() => doe(() => window.werk.deel === 'mix'));
  ok('MIX: wiel-mapje jog', await doe(() => window.maschine.wiel === 'jog'));
  await doe(() => { window.__bus.length = 0; });
  m.wiel(1);
  ok('wiel een klik = track.1.jog.fwd', await tot(() => doe(() => window.__bus.some(([id, v]) => id === 'track.1.jog.fwd' && v === true))),
    await doe(() => window.__bus.map(([id]) => id).join(' ')));
  await doe(() => { window.__a.invoke('library.toggle', true); window.__a.invoke('library.toggle', false); window.__bus.length = 0; });
  await tot(() => doe(() => window.__a.read('library.toggle') === 1));
  m.wiel(1);
  ok('library open: het wiel bladert (library.next), geen jog', await tot(() => doe(() => window.__bus.some(([id]) => id === 'library.next') && !window.__bus.some(([id]) => id.includes('.jog')))),
    await doe(() => window.__bus.map(([id]) => id).join(' ')));
  await doe(() => { window.__a.invoke('library.toggle', true); window.__a.invoke('library.toggle', false); });

  // ---- SHIFT + F1 = THUIS vanuit elk deel -------------------------------------------------------------
  console.log('\nSHIFT + F1 = THUIS');
  const thuis = [];
  for (let i = 2; i <= 8; i++) {
    m.tik(`f${i}`);
    await tot(() => doe((n) => window.werk.deel === n, delen[i - 1].naam), 3000);
    m.druk('shift'); m.tik('f1'); m.los('shift');
    thuis.push(await tot(() => doe(() => window.werk.deel === 'mix' && window.werk.door?.includes('THUIS') && window.maschine.modus === 'spelen'), 3000));
  }
  ok('SHIFT + F1 vanuit UITLIJN … LIBRARY: deel MIX, door THUIS, de Maschine op spelen', thuis.every(Boolean), thuis.map((x) => (x ? 'ja' : 'nee')).join(' '));

  // ---- de volgorde over twee apparaten -----------------------------------------------------------------
  console.log(`\nde volgorde over twee apparaten: ${KEER} × SOLO (Maschine), 5 ms later scene 1 (APC) met een regel in houd.solo`);
  await doe(() => {
    // Scene 1 krijgt in houd.solo een regel (alleen in deze proef; een stuk legt dat zelf vast).
    const map = window.werk.mapping;
    map.vervangFragment('proef:volgorde', { device: 'apc40mk2', version: 3, rules: [{ in: 'note:0:82', laag: 'houd.solo', action: 'track.8.stem.drums.solo', mode: 'trigger' }] });
    window.__volg = [];
    window.maschine.houd.on('change', ({ naam, open }) => { if (naam === 'solo' && open) window.__volg.push({ solo: performance.now() }); });
    window.__a.bijInvoke((id, v) => {
      if (v !== true) return;
      const laatste = window.__volg[window.__volg.length - 1];
      if (id === 'track.8.stem.drums.solo' || id.startsWith('layer.grid')) { if (laatste && laatste.apc === undefined) { laatste.apc = performance.now(); laatste.goed = id === 'track.8.stem.drums.solo'; } else window.__volg.push({ apc: performance.now(), goed: false, zonderSolo: true }); }
    });
  });
  await wacht(100);
  for (let i = 0; i < KEER; i++) {
    m.druk('solo');
    precies(5);
    apc.injecteer([0x90, 82, 127]);
    await wacht(6);
    apc.injecteer([0x80, 82, 0]);
    m.los('solo');
    await wacht(6);
  }
  await wacht(500);
  const volg = await doe(() => window.__volg);
  const paren = volg.filter((x) => x.solo !== undefined && x.apc !== undefined);
  const goed = paren.filter((x) => x.goed).length;
  const scheef = paren.map((x) => x.apc - x.solo - 5);
  ok(`de volgorde klopt in ≥ 99,9% (${goed}/${KEER})`, goed / KEER >= 0.999, `${paren.length} paren gezien, ${volg.filter((x) => x.zonderSolo).length} APC-drukken zonder SOLO ervoor`);
  console.log(`      scheefheid (aankomst APC − aankomst SOLO − 5 ms, in VARVE): p50 ${ms(kwantiel(scheef, 0.5))}, p99 ${ms(kwantiel(scheef, 0.99))}, min ${ms(Math.min(...scheef))}, max ${ms(Math.max(...scheef))}`);
  ok('scheefheid gemeten (p99 in docs/werkruimte/S6.md)', Number.isFinite(kwantiel(scheef, 0.99)));
  await doe(() => window.werk.mapping.haalWeg('proef:volgorde'));

  // ---- de nep-Maschine weg ----------------------------------------------------------------------------
  console.log('\nde nep-Maschine weg: apc-alleen met één melding');
  const meldVoor = (await doe(() => window.__meld.length));
  m.uittrekken();
  await wacht(800);
  const merkt = await doe(() => window.midi.speelPoort('maschine-mk2').in.state);
  // De hub zegt een lease-app niet dat ÉÉN speelapparaat wegviel (PROTOCOL §17: alleen de cockpit
  // ziet beeld.apparaten); de nep-poort in VARVE wordt pas 'disconnected' als de hubverbinding wegvalt.
  // Daarom zetten we hem hier zoals hub.js zou doen als de hub het meldde (_poorten): state + onstatechange.
  console.log(`      na uittrekken: de nep-poort in VARVE staat op "${merkt}" (de hub meldt het niet per apparaat; zie S6.md)`);
  await doe(() => { const p = window.midi.speelPoort('maschine-mk2'); for (const x of [p.in, p.uit]) { x.state = 'disconnected'; x.connection = 'closed'; x.onstatechange?.({ port: x }); } });
  ok('werkruimte apc-alleen (terugval)', await tot(() => doe(() => window.werk.naam === 'apc-alleen' && window.werk.terug?.naam === 'twee-handen'), 5000),
    await doe(() => window.werk.naam));
  await wacht(500);
  const meldingen = (await doe(() => window.__meld)).slice(meldVoor);
  ok('precies één melding', meldingen.length === 1, meldingen.join(' | '));
  ok('het deel bleef (apc-alleen heeft het ook)', await doe(() => !!window.werk.deel));
  ok('de stukken van de Maschine zijn weg van haar Mapping', await doe(() => !window.maschine.mapping.extra.has('stuk:maschine-delen')));
  ok('requestMIDIAccess NOOIT aangeroepen', (await doe(() => window.__midi)) === 0);
} finally {
  await browser.close().catch(() => {});
  await echt.stop().catch(() => {});
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
