// LED-feedback zonder browser en zonder hardware: we vangen de bytes op.
import { readFileSync } from 'node:fs';
import { trackVanDeck } from '../src/control/actions.js';

const { Mapping } = await import('../src/control/mapping.js');
const { Feedback } = await import('../src/control/feedback.js');
const { bindEngine, read, metaOf } = await import('../src/control/actions.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// Deck-dubbel: genoeg voor bindEngine, geen audio nodig.
const dubbeldeck = (id) => ({
  id, playing: false, position: 0, cuePoint: 0, duration: 10, rate: 1, buffer: {},
  hotcues: [null, null, null, null], loop: null,
  ui: { trim: 0.5, low: 0.5, mid: 0.5, high: 0.5, filter: 0.5, fader: 1 },
  togglePlay() { this.playing = !this.playing; }, cue() {}, hotcue(i) { this.hotcues[i] = 1; },
  setLoop(s) { this.loop = { start: 0, end: s }; }, clearLoop() { this.loop = null; },
  halveLoop() {}, doubleLoop() {}, nudge() {}, seek() {}, setRate(r) { this.rate = r; },
  set(p, v) { this.ui[p] = v; },
});
const engine = {
  decks: { A: dubbeldeck('A'), B: dubbeldeck('B') },
  focus: 'A', xfader: 0.5, masterLevel: 0.8, xfaderCurve: 'smooth',
  deck(id) { return this.decks[id]; },
  ander(id) { return this.decks[id === 'A' ? 'B' : 'A']; },
  setFocus(id) { this.focus = id; }, setXfader(v) { this.xfader = v; },
  setMaster(v) { this.masterLevel = v; }, setXfaderCurve(c) { this.xfaderCurve = c; },
};
bindEngine(engine);

const bus = [];
const send = (b) => { bus.push([...b]); return true; };
const mapping = new Mapping({ read, invoke: () => {}, vars: () => ({ focus: trackVanDeck(engine.focus) }) });
mapping.load(JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8')));

const fb = new Feedback({ device: apc, mapping, read, meta: metaOf, send });

// ---- init -----------------------------------------------------------------

fb.init();
const sysex = bus[0];
ok('init stuurt de sysex als eerste', sysex[0] === 0xf0 && sysex[1] === 0x47 && sysex.at(-1) === 0xf7);
ok('init-sysex vraagt Ableton Live mode (0x41)', sysex[7] === 0x41);

// Het oppervlak schoon overnemen: ook lampjes die wij niet gebruiken.
const nullen = bus.filter((b) => (b[0] & 0xf0) === 0x90 && b[2] === 0);
ok('init veegt het hele oppervlak schoon', nullen.length === apc.allLeds().length);
ok('en raakt ook ongekoppelde pads', nullen.some((b) => b[1] === apc.gridNote(1, 5)));
ok('en knoppen die in geen enkele regel voorkomen', nullen.some((b) => b[1] === 0x5d));

// Aantal niet hardcoderen: elke knop die erbij komt hoort vanzelf een ring te
// krijgen, en een vast getal zou dan bij elke uitbreiding breken.
const ringen = bus.filter((b) => (b[0] & 0xf0) === 0xb0
  && ((b[1] >= 0x18 && b[1] <= 0x1f) || (b[1] >= 0x38 && b[1] <= 0x3f)));
const knopRegels = [...mapping.rules.values()]
  .filter((r) => apc.ringFor(r.in.replace(':*:', ':0:')));
ok(`elke gekoppelde knop krijgt een ringtype (${knopRegels.length})`,
  ringen.length === knopRegels.length && knopRegels.length >= 12);
const ringVan = (knop, ch = 0) => ringen.find((b) => b[1] === knop + 8 && (b[0] & 0x0f) === ch)?.[2];
ok('EQ-knop krijgt pan-stijl (bipolair)', ringVan(0x10) === apc.ring.pan);
ok('trim krijgt volume-stijl', ringVan(0x14) === apc.ring.volume);
ok('pitch krijgt pan-stijl', ringVan(0x17) === apc.ring.pan);
// De bank zit in het kanaal: bank 2 hoort zijn eigen ringen te krijgen.
ok('bank 2 krijgt zijn ringen op kanaal 2', ringVan(0x10, 1) === apc.ring.pan);
// Knop 1 bestaat in elke bank, dus zijn ring hoort op elk gebruikt kanaal apart
// te komen. Niet op een vast aantal toetsen: er kunnen banken bij komen.
const kanalenVanKnop1 = new Set(ringen.filter((b) => b[1] === 0x18).map((b) => b[0] & 0x0f));
ok('knop 1 krijgt per bank zijn eigen ring', kanalenVanKnop1.size >= 2);
ok('en dat zijn echt verschillende kanalen', kanalenVanKnop1.has(0) && kanalenVanKnop1.has(1));
ok('ook de ongebankte track-knoppen krijgen er een',
  ringen.some((b) => b[1] >= 0x38 && b[1] <= 0x3f));

// ---- diffing --------------------------------------------------------------

bus.length = 0;
let n = fb.tick(999);
ok('eerste tick stuurt de hele staat', n > 20);
const eerste = bus.length;

bus.length = 0;
n = fb.tick(999);
ok('tweede tick stuurt NIETS als er niets veranderde', n === 0 && bus.length === 0);

engine.decks.A.hotcues[0] = 3.2;
bus.length = 0;
n = fb.tick(999);
ok('één verandering geeft precies één bericht', n === 1 && bus.length === 1);
const hot = bus[0];
ok('hotcue-pad wordt geel', hot[2] === apc.palette.geel);
ok('hotcue-pad zit op noot 32 (pad 1/1, linksboven)', hot[1] === 32);
ok('pad gebruikt gedragskanaal 0 (vaste kleur)', hot[0] === 0x90);

engine.decks.A.hotcues[0] = null;
fb.tick(999);
ok('hotcue uit wordt donkergrijs', bus.at(-1)[2] === apc.palette.donkergrijs);

engine.decks.A.playing = true;
bus.length = 0;
fb.tick(999);
ok('play zet een eenkleurige LED aan', bus.some((b) => b[1] === 50 && b[2] === 127));

// ---- knoppen tonen de softwarestand ---------------------------------------

engine.decks.A.ui.filter = 0.25;
bus.length = 0;
fb.tick(999);
const ring = bus.find((b) => b[1] === 0x13 && (b[0] & 0x0f) === 0);
ok('device knob 4 stuurt de softwarewaarde naar zijn ring', ring && ring[2] === Math.round(0.25 * 127));

// Deck B hangt op bank 2, dus zijn ring hoort op kanaal 2 te vertrekken.
engine.decks.B.ui.filter = 0.75;
bus.length = 0;
fb.tick(999);
const ringB = bus.find((b) => b[1] === 0x13 && (b[0] & 0x0f) === 1);
ok('deck B stuurt zijn ring naar bank 2', ringB && ringB[2] === Math.round(0.75 * 127));

// ---- deck-switch verft het hele beeld om ----------------------------------

bus.length = 0;
engine.focus = 'B';
n = fb.tick(999);
ok('na een deck-switch volgen de focus-LEDs mee', n > 0);

// ---- tempo begrenzen ------------------------------------------------------

fb.invalidate();
bus.length = 0;
n = fb.tick(5);
ok('max per tick wordt gerespecteerd', n === 5 && bus.length === 5);

// ---- paletproef -----------------------------------------------------------

// Na de proef moet ook alles wat de proef verfde weer uit — juist de pads die
// nergens aan gekoppeld zijn, want die staan in geen enkele diff-cache.
bus.length = 0;
const proef = fb.paletteProef(0);
ok('paletproef vult 40 pads', proef.length === 40 && bus.length === 40);
ok('paletproef begint op velocity 0', bus[0][2] === 0);
ok('paletproef loopt op tot 39', bus.at(-1)[2] === 39);
ok('paletproef pagina 0 zit op de juiste noten', bus[0][1] === apc.gridNote(1, 1) && bus.at(-1)[1] === apc.gridNote(8, 5));
bus.length = 0;
fb.tick(999);
ok('tijdens de proef stuurt de feedback niets', bus.length === 0);
fb.paletteProef(3);
ok('pagina 3 stopt netjes bij 127', bus.filter((b) => b[2] > 127).length === 0);
bus.length = 0;
fb.stopProef();
const gewist = bus.filter((b) => b[2] === 0);
ok('stoppen wist ook de pads die nergens aan hangen',
  gewist.some((b) => b[1] === apc.gridNote(6, 5)) && gewist.some((b) => b[1] === apc.gridNote(8, 4)));
bus.length = 0;
ok('na de proef wordt alles opnieuw gestuurd', fb.tick(999) > 20);

// ---- blackout -------------------------------------------------------------

bus.length = 0;
fb.blackout();
ok('blackout dekt elke LED op het apparaat', bus.length === apc.allLeds().length);
ok('blackout zet alles op nul', bus.every((b) => b[2] === 0));

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
