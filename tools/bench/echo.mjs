// Hoe vaak valt een druk of een loslaten weg op een knop waarvan het lampje knippert?
// (controller-invoer, 14 okt; docs/verslagen/2026-10-14/controller-invoer.md)
//
// De echte MidiHub (echofilter aan, zoals voor de APC), de echte Mapping met de
// standaardmapping en de echte Feedback (LED-laag), met een NEP-klok: de LED-tik
// elke 33 ms zoals midi-opzet.js, een track op 124 bpm met een lopende loop, en
// een "hand" die op willekeurige momenten de knop indrukt en 60–200 ms later
// loslaat. Telt hoeveel drukken en loslaten de mapping NIET bereikten.
//
// Gebruik:  node tools/bench/echo.mjs [wortel] [sig] [aantal]
//           wortel = een andere versie (bv. een uitgepakte git archive), sig standaard note:0:88 (Sends = loop out,
//           knippert met een lopende loop), aantal drukken standaard 4000. Zaad vast: elke keer hetzelfde.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = fileURLToPath(new URL('../..', import.meta.url));
const wortel = resolve(process.argv[2] || HIER);
const SIG = process.argv[3] || 'note:0:88';
const AANTAL = Number(process.argv[4]) || 4000;
const imp = (p) => import(pathToFileURL(join(wortel, p)).href);

// Nep-klok: performance.now() van de hele module-wereld.
let T = 0;
Object.defineProperty(globalThis.performance, 'now', { value: () => T, configurable: true });

const { MidiHub } = await imp('src/control/midi.js');
const { Mapping } = await imp('src/control/mapping.js');
const { Lagen } = await imp('src/control/lagen.js');
const { Feedback } = await imp('src/control/feedback.js');
const apc = (await imp('src/control/devices/apc40mk2.js')).default;
const doc = JSON.parse(readFileSync(join(wortel, 'mappings/apc40mk2.json'), 'utf8'));

// Nep-poorten zoals in test/midi.test.mjs.
const poort = (id, name, type) => ({ id, name, type, state: 'connected', connection: 'open', onmidimessage: null, send() {} });
const inn = poort('i', 'APC40 mkII', 'input'), uit = poort('o', 'APC40 mkII', 'output');
const hub = new MidiHub();
hub.access = { inputs: new Map([[inn.id, inn]]), outputs: new Map([[uit.id, uit]]), onstatechange: null };
hub.enabled = true; hub.sysex = true;
hub._sync();
hub.echoFilter = apc.echoFilter !== false;

// Een track op 124 bpm met een lopende loop: de fase loopt met de nep-klok mee.
const BPM = 124;
const read = (id) => {
  if (/\.phase$/.test(id)) return ((T / 1000) * BPM / 60) % 1;
  if (/\.barbeat$/.test(id)) return 0;
  if (/\.leads$/.test(id)) return 1;
  return 1;           // alles "aan": de loop loopt, de knop brandt (en knippert op de tel)
};
const lagen = new Lagen();
const mapping = new Mapping({ read, invoke: () => {}, vars: () => ({ focus: 1 }), lagen: () => lagen.actief() });
mapping.laadStandaard(doc);
// De LED-laag stuurt direct (zonder de wachtrij van 4 ms: die maakt het venster alleen later, niet anders).
const fb = new Feedback({ device: apc, mapping, read, meta: () => null, send: (b) => hub._verstuur(b), sendSysex: () => {} });
fb.klaar = true;

let drukken = 0, loslaten = 0, drukAan = 0, losAan = 0;
hub.onInput((m) => { if (m.sig !== SIG) return; if (m.on) drukAan++; else losAan++; });
const [, ch, nr] = SIG.split(':').map(Number);
const stuur = (bytes) => inn.onmidimessage({ data: new Uint8Array(bytes), timeStamp: T });

// Zaad vast (mulberry32): elke keer dezelfde hand.
let z = 0x2f6e2b1;
const toeval = () => { z |= 0; z = (z + 0x6d2b79f5) | 0; let t = Math.imul(z ^ (z >>> 15), 1 | z); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let volgendeTik = 0, volgendeDruk = 200 + toeval() * 600, los = null;
const eind = () => drukken >= AANTAL && los === null;
let knipper = 0, vorige = null;
for (T = 0; !eind(); T += 0.25) {
  if (T >= volgendeTik) {
    fb.tick();
    const nu = fb.vorige.get(SIG);
    if (nu !== vorige) { knipper++; vorige = nu; }
    volgendeTik += 33;
  }
  if (los === null && T >= volgendeDruk && drukken < AANTAL) {
    stuur([0x90 | ch, nr, 127]); drukken++;
    los = T + 60 + toeval() * 140;
  }
  if (los !== null && T >= los) {
    stuur([0x80 | ch, nr, 0]); loslaten++;
    los = null;
    volgendeDruk = T + 150 + toeval() * 700;
  }
}
const pct = (a, b) => `${(100 * (1 - a / b)).toFixed(1)}%`;
console.log(`${SIG} (${mapping.kies(SIG)?.action ?? '—'}), lampje wisselde ${knipper}× in ${(T / 1000).toFixed(0)} s, echofilter ${hub.echoFilter ? 'aan' : 'uit'}`);
console.log(`drukken:  ${drukAan}/${drukken} kwamen aan — weg: ${drukken - drukAan} (${pct(drukAan, drukken)})`);
console.log(`loslaten: ${losAan}/${loslaten} kwamen aan — weg: ${loslaten - losAan} (${pct(losAan, loslaten)})`);
console.log(`als echo geteld: ${hub.echoes}`);
