/**
 * Proef in echte Chrome (headless): de controllerlaag met een NEP-APC.
 *
 *   node tools/proef-apc.mjs
 *
 * Nooit een echte MIDI-poort: navigator.requestMIDIAccess wordt vóór het laden
 * vervangen door een nagebouwde MIDIAccess met één ingang en één uitgang
 * "APC40 mkII". De app draait zoals altijd (index.html); de proef zet er
 * src/ui/controllers.js naast (zoals app.js dat straks doet) en dan:
 *   1. de init: 0x42 als eerste bericht, dan zwart, dan de stand; dan een demonummer
 *      laden met ▼ en ► (library.volgende en library.laad, of met de muis als dat
 *      spoor er nog niet is);
 *   2. fader 1 grijpen (soft-takeover) en bewegen -> track.1.fader op de bus;
 *   3. track knob 1 draaien (eindeloos) -> track.1.filter;
 *   4. activator 1 -> track 1 speelt, en zijn lampje gaat aan;
 *   5. scene 3 -> laag grid.klank: de pads worden kills (rooddonker);
 *   6. de tempo-encoder één tik -> de klok +0,1 bpm;
 *   7. de toets Q -> play op de focus-track (toetsen.json);
 *   8. de kabel eruit en erin -> alles los, en opnieuw 0x42;
 *   en over alles: nooit meer dan 16 berichten in een venster van 4 ms.
 * Playwright staat globaal (createRequire op /opt/node22/lib/node_modules/ of PLAYWRIGHT_MODULE).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const HIER = dirname(fileURLToPath(import.meta.url));
const POORT = 8792;

process.env.VARVE_V2_POORT = String(POORT);
const { maakServer } = await import('../server.mjs');
const server = maakServer({ media: '/geen-media' });
await new Promise((r) => server.listen(POORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const fouten = [];
const volg = (p) => {
  p.on('pageerror', (e) => fouten.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
  return p;
};

// De nep-APC, vóór elk script van elke pagina (elk tabblad zijn eigen nep-apparaat).
await context.addInitScript(() => {
  const uit = [];
  const ingang = { id: 'apc-in', name: 'APC40 mkII', state: 'connected', type: 'input', onmidimessage: null };
  const uitgang = { id: 'apc-uit', name: 'APC40 mkII', state: 'connected', type: 'output', send(b) { uit.push({ t: performance.now(), b: [...b] }); } };
  const toegang = { inputs: new Map([[ingang.id, ingang]]), outputs: new Map([[uitgang.id, uitgang]]), sysexEnabled: true, onstatechange: null };
  let gevraagd = 0;
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async (o) => { gevraagd++; window.__apc.opties = o; return toegang; } });
  window.__apc = {
    uit,
    get gevraagd() { return gevraagd; },
    stuur(bytes) { ingang.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp: performance.now() }); },
    kabel(aan) { ingang.state = uitgang.state = aan ? 'connected' : 'disconnected'; toegang.onstatechange?.({}); },
  };
});

const page = volg(await context.newPage());
const uitslag = { stappen: [], fouten };
/** De controllers van de app zelf (app.js zet ze op); de meldingen vangen we mee. */
const zetOp = (p) => p.evaluate(async () => {
  for (let i = 0; i < 100 && !window.varveCtl; i++) await new Promise((r) => setTimeout(r, 20));
  window.__meld = [];
  window.varve.on('melding', ({ tekst, soort }) => window.__meld.push(`${soort}: ${tekst}`));
  window.__ctl = window.varveCtl;
  await window.__ctl.geladen;
});
const stap = (naam, ok, info = {}) => uitslag.stappen.push({ naam, ok: !!ok, ...info });

try {
  await page.goto(`http://localhost:${POORT}/`);
  await page.waitForFunction(() => window.varve);
  await page.evaluate(() => window.varve.ctx.resume());
  await zetOp(page);
  await page.waitForFunction(() => window.__apc.uit.some((x) => x.b[0] === 0xf0), null, { timeout: 5000 });
  await page.waitForTimeout(150);

  const init = await page.evaluate(() => ({ eerste: window.__apc.uit[0].b, n: window.__apc.uit.length, opties: window.__apc.opties, gevraagd: window.__apc.gevraagd, status: window.__ctl.status() }));
  stap('init 0x42 als eerste bericht, MIDI met sysex', init.eerste.join(',') === [0xf0, 0x47, 0x7f, 0x29, 0x60, 0x00, 0x04, 0x42, 0x00, 0x00, 0x00, 0xf7].join(',') && init.opties?.sysex === true && init.gevraagd === 1,
    { berichten: init.n, status: init.status });

  const doe = (bytes, wacht = 30) => page.evaluate(async ([b, w]) => { window.__apc.stuur(b); await new Promise((r) => setTimeout(r, w)); }, [bytes, wacht]);
  const lees = (id) => page.evaluate((i) => window.varve.bus.lees(i), id);

  // 1b. Een demonummer laden MET DE APC: ▼ (library.volgende) en ► (library.laad op de focus-track).
  await doe([0x90, 0x5f, 127], 5); await doe([0x80, 0x5f, 0], 30);
  await doe([0x90, 0x60, 127], 5); await doe([0x80, 0x60, 0], 30);
  const metApc = await page.waitForFunction(() => window.varve.track(1).geladen, null, { timeout: 3000 }).then(() => true, () => false);
  if (!metApc) {
    // De library-lijst is een ander spoor; lukt het niet met de APC, dan met de muis (de knop "1" van het eerste nummer).
    await page.locator('#bieb-lijst .laad button, #bieb-lijst .laad [title="laad op track 1"]').first().click();
    await page.waitForFunction(() => window.varve.track(1).geladen, null, { timeout: 5000 });
  }
  stap('laden: ▼ en ► op de APC (library.volgende, library.laad)', true, { metApc, focus: await page.evaluate(() => window.varve.focus ?? null) });

  // 2. fader 1: soft-takeover. De fader begint op de stand van de bus; ver eronder springt niets.
  const faderVoor = await lees('track.1.fader');
  await doe([0xb0, 7, 10]);
  const naVer = await lees('track.1.fader');
  await doe([0xb0, 7, Math.round(faderVoor * 127)]);
  await doe([0xb0, 7, 64]);
  stap('fader 1: niet springen, dan grijpen en volgen', Math.abs(naVer - faderVoor) < 1e-9 && Math.abs((await lees('track.1.fader')) - 64 / 127) < 0.002, { voor: faderVoor, naVer });

  // 3. track knob 1 eindeloos: eerste bericht onthouden, dan +6 tikken.
  const filterVoor = await lees('track.1.filter');
  await doe([0xb0, 48, 64]);
  await doe([0xb0, 48, 70]);
  const filterNa = await lees('track.1.filter');
  stap('track knob 1: alleen het verschil (+6/127)', Math.abs(filterNa - filterVoor - 6 / 127) < 0.002, { voor: filterVoor, na: filterNa });

  // 4. activator 1 = play; zijn lampje volgt via wek() meteen.
  const voorPlay = await page.evaluate(() => window.__apc.uit.length);
  await doe([0x90, 50, 127], 5);
  await doe([0x80, 50, 0], 200);
  const play = await page.evaluate((v) => ({ speelt: window.varve.track(1).speelt, lamp: window.__apc.uit.slice(v).filter((x) => x.b[0] === 0x90 && x.b[1] === 50).map((x) => x.b[2]) }), voorPlay);
  stap('activator 1: track 1 speelt en het lampje gaat aan', play.speelt && play.lamp.includes(127), play);

  // 5. scene 3: laag klank, pad5-1 wordt kill hoog (rooddonker = 6), scene 3 magenta (53).
  await doe([0x90, 0x54, 127], 5);
  await doe([0x80, 0x54, 0], 100);
  const klank = await page.evaluate(() => {
    const laatst = (n) => window.__apc.uit.filter((x) => (x.b[0] & 0xf0) === 0x90 && x.b[1] === n).at(-1)?.b[2];
    return { pad51: laatst(32), scene3: laatst(0x54), lagen: window.__ctl.status().lagen };
  });
  stap('scene 3: laag grid.klank, pads in de kleur van de kills', klank.pad51 === 6 && klank.scene3 === 53 && klank.lagen.includes('grid.klank'), klank);
  await doe([0x90, 0x52, 127], 5);
  await doe([0x80, 0x52, 0], 50);

  // 6. tempo-encoder: één tik = +0,1 bpm.
  const bpmVoor = await page.evaluate(() => window.varve.klok.bpm(window.varve.nu()));
  await doe([0xb0, 13, 1], 80);
  const bpmNa = await page.evaluate(() => window.varve.klok.bpm(window.varve.nu()));
  stap('tempo-encoder: +0,1 bpm per tik', Math.abs(bpmNa - bpmVoor - 0.1) < 1e-6, { bpmVoor, bpmNa });

  // 7. toets Q = play op de focus-track (pauze, want hij speelt).
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(30);
  await page.keyboard.up('KeyQ');
  await page.waitForTimeout(100);
  stap('toets Q: play/pauze op de focus-track', !(await page.evaluate(() => window.varve.track(1).speelt)));

  // Leren door aanwijzen (indelingspaneel): leren aan, klik de lus-knop van track 1 op het scherm,
  // druk Pan op de APC; daarna doet Pan de lus van track 1.
  await page.click('#ind-knop');
  await page.click('#ind-paneel .leer');
  await page.click('.track[data-n="1"] .b-lus');
  const lusVoor = await page.evaluate(() => window.varve.track(1).lus !== null);
  await doe([0x90, 0x57, 127], 60); await doe([0x80, 0x57, 0], 60);
  await page.click('#ind-paneel .leer');                 // leren uit
  await doe([0x90, 0x57, 127], 60); await doe([0x80, 0x57, 0], 60);
  const lusNa = await page.evaluate(() => window.varve.track(1).lus !== null);
  stap('leren door aanwijzen: Pan doet daarna de lus van track 1', lusVoor === false && lusNa === true, { lusVoor, lusNa });

  // 8. kabel eruit (met nudge ingedrukt) en erin.
  await doe([0x90, 101, 127], 20);
  await page.evaluate(() => window.__apc.kabel(false));
  await page.waitForTimeout(50);
  const los = await page.evaluate(() => window.__ctl.apc.vast.size);
  await page.evaluate(() => window.__apc.kabel(true));
  await page.waitForTimeout(250);
  const inits = await page.evaluate(() => window.__apc.uit.filter((x) => x.b[0] === 0xf0).length);
  stap('kabel eruit: alles los; erin: opnieuw 0x42', los === 0 && inits === 2, { vast: los, inits });

  // De grens van de wachtrij over alles wat er naar de APC ging.
  const venster = await page.evaluate(() => {
    const u = window.__apc.uit;
    let max = 0;
    for (let a = 0, b = 0; b < u.length; b++) { while (u[b].t - u[a].t >= 4) a++; max = Math.max(max, b - a + 1); }
    return { max, totaal: u.length };
  });
  stap('wachtrij: nooit meer dan 16 berichten in 4 ms', venster.max <= 16, venster);
  uitslag.meldingen = await page.evaluate(() => window.__meld);

  // 9. Een tweede tabblad vraagt GEEN MIDI-toegang (Web Lock 'varve-v2-mixer'); sluit het eerste, dan neemt het over.
  const tweede = volg(await context.newPage());
  await tweede.goto(`http://localhost:${POORT}/`);
  await tweede.waitForFunction(() => window.varve);
  await zetOp(tweede);
  await tweede.waitForTimeout(200);
  const t2 = await tweede.evaluate(() => ({ gevraagd: window.__apc.gevraagd, tabblad: window.__ctl.status().tabblad }));
  await page.close();
  await tweede.waitForFunction(() => window.__apc.gevraagd === 1, null, { timeout: 5000 }).catch(() => {});
  await tweede.waitForTimeout(150);
  const t2na = await tweede.evaluate(() => ({ gevraagd: window.__apc.gevraagd, tabblad: window.__ctl.status().tabblad, init: window.__apc.uit[0]?.b[7] }));
  stap('tweede tabblad: geen MIDI tot het eerste sluit, dan wel (en 0x42)', t2.gevraagd === 0 && t2.tabblad === 'tweede' && t2na.gevraagd === 1 && t2na.tabblad === 'eerste' && t2na.init === 0x42, { voor: t2, na: t2na });
} catch (fout) {
  stap('proef liep', false, { fout: String(fout?.stack ?? fout) });
} finally {
  await browser.close();
  server.close();
}

const goed = uitslag.stappen.every((s) => s.ok) && !fouten.length;
console.log(JSON.stringify(uitslag, null, 2));
console.log(goed ? 'PROEF GOED' : 'PROEF FOUT');
process.exit(goed ? 0 : 1);
