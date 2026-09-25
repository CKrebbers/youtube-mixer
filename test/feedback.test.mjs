// LED-feedback zonder browser en zonder hardware: we vangen de bytes op.
import { readFileSync } from 'node:fs';
import { trackVanDeck } from '../src/control/actions.js';

const { Mapping } = await import('../src/control/mapping.js');
const { Feedback } = await import('../src/control/feedback.js');
const { bindEngine, read, metaOf, invoke } = await import('../src/control/actions.js');
const apc = (await import('../src/control/devices/apc40mk2.js')).default;

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

// Deck-dubbel: genoeg voor bindEngine, geen audio nodig.
const dubbeldeck = (id) => ({
  id, playing: false, position: 0, cuePoint: 0, duration: 10, rate: 1, buffer: {},
  hotcues: [null, null, null, null], loop: null, grid: null, loopBeats: null,
  fx: { bypass: false, effectId: 'filter', mix: 1, leesPlek: () => 0.5, setBypass(b) { this.bypass = b; } },
  ui: { trim: 0.5, low: 0.5, mid: 0.5, high: 0.5, filter: 0.5, fader: 1 },
  togglePlay() { this.playing = !this.playing; }, cue() {}, hotcue(i) { this.hotcues[i] = 1; },
  setLoop(s) { this.loop = { start: 0, end: s }; }, clearLoop() { this.loop = null; },
  halveLoop() {}, doubleLoop() {}, nudge() {}, seek() {}, setRate(r) { this.rate = r; },
  set(p, v) { this.ui[p] = v; },
});
const engine = {
  decks: { A: dubbeldeck('A'), B: dubbeldeck('B') },
  focus: 'A', xfader: 0.5, masterLevel: 0.8, xfaderCurve: 'smooth',
  kant: { A: 'A', B: 'B' }, setKant(id, k) { this.kant[id] = k; },
  ctx: { outputLatency: 0.05, baseLatency: 0 },
  syncMaster() { return null; },
  deck(id) { return this.decks[id]; },
  ander(id) { return this.decks[id === 'A' ? 'B' : 'A']; },
  setFocus(id) { this.focus = id; }, setXfader(v) { this.xfader = v; },
  setMaster(v) { this.masterLevel = v; }, setXfaderCurve(c) { this.xfaderCurve = c; },
};
bindEngine(engine);

const bus = [];
const send = (b) => { bus.push([...b]); return true; };
const { Lagen } = await import('../src/control/lagen.js');
const lagen = new Lagen();
const mapping = new Mapping({ read, invoke: () => {}, vars: () => ({ focus: trackVanDeck(engine.focus) }), lagen: () => lagen.actief() });
const standaard = JSON.parse(readFileSync(new URL('../mappings/apc40mk2.json', import.meta.url), 'utf8'));
/*
 * De ringtests draaien op een mapping MET banken, zoals in generic mode: EQ op
 * bank 1/2 (kanaal 0/1), FX op bank 3/4. Dat is het mechanisme (ring per
 * kanaal, ringtype per soort knop). De standaardmapping zelf draait sinds B1
 * in 0x42 zonder banken; die wordt onderaan apart nagelopen.
 */
const EQ = ['high', 'mid', 'low', 'filter', 'trim', null, null, 'pitch'];
const metBanken = {
  ...standaard,
  rules: [
    ...standaard.rules.filter((r) => !/^cc:0:(1[6-9]|2[0-3])$/.test(r.in)),
    ...[0, 1].flatMap((ch) => EQ.map((p, k) => p && { in: `cc:${ch}:${16 + k}`, action: `track.${ch + 1}.${p}`, mode: 'absolute' }).filter(Boolean)),
    ...[2, 3].flatMap((ch) => Array.from({ length: 8 }, (_, k) => ({ in: `cc:${ch}:${16 + k}`, action: `track.${ch - 1}.fx.knob.${k + 1}`, mode: 'absolute' }))),
  ],
};
mapping.load(metBanken);

const fb = new Feedback({ device: apc, mapping, read, meta: metaOf, send });

// ---- init -----------------------------------------------------------------

fb.init();
const sysex = bus[0];
ok('init stuurt de sysex als eerste', sysex[0] === 0xf0 && sysex[1] === 0x47 && sysex.at(-1) === 0xf7);
ok('init-sysex vraagt Alternate Ableton Live mode (0x42)', sysex[7] === 0x42);

// Het oppervlak schoon overnemen: ook lampjes die wij niet gebruiken.
const nullen = bus.filter((b) => (b[0] & 0xf0) === 0x90 && b[2] === 0);
ok('init veegt het hele oppervlak schoon', nullen.length === apc.allLeds().length);
ok('en raakt ook ongekoppelde pads', nullen.some((b) => b[1] === apc.gridNote(1, 5)));
ok('en knoppen die in geen enkele regel voorkomen', nullen.some((b) => b[1] === 0x5d));

// Aantal niet hardcoderen: elke knop die erbij komt hoort vanzelf een ring te
// krijgen, en een vast getal zou dan bij elke uitbreiding breken.
const ringen = bus.filter((b) => (b[0] & 0xf0) === 0xb0
  && ((b[1] >= 0x18 && b[1] <= 0x1f) || (b[1] >= 0x38 && b[1] <= 0x3f)));
const knopRegels = [...mapping.actieveRegels().values()]
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
ok('gezette hotcue wordt gedimd geel (B4: gevuld)', hot[2] === apc.palette.geeldonker && hot[2] === 14);
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

// ---- mapjes: wat dichtgaat, gaat uit ----------------------------------------
{
  const busM = [];
  const lgM = new Lagen();
  const mM = new Mapping({ read: (a) => (a.endsWith('hotcue.1') ? 1 : a.endsWith('beatloop.1') ? 0 : null), invoke: () => {}, lagen: () => lgM.actief() });
  mM.load({ version: 3, rules: [
    { in: 'note:0:32', action: 'track.1.hotcue.1', mode: 'trigger', laag: 'grid.hotcues' },
    { in: 'note:0:33', action: 'track.2.hotcue.1', mode: 'trigger', laag: 'grid.hotcues' },
    { in: 'note:0:32', action: 'track.1.beatloop.1', mode: 'trigger', laag: 'grid.loops' },
  ] });
  const fbM = new Feedback({ device: apc, mapping: mM, read: mM.read, meta: () => null, send: (b) => { busM.push([...b]); return true; } });
  fbM.klaar = true;
  fbM.tick(999);
  const aan = busM.find((b) => b[1] === 32);
  ok('mapje hotcues: de gezette hotcue brandt', aan && aan[2] === apc.palette.geel);
  busM.length = 0;
  lgM.zet('grid', 'loops');
  fbM.tick(999);
  ok('mapje wisselt: de pad krijgt de stand van het nieuwe mapje', busM.some((b) => b[1] === 32 && b[2] === apc.palette.donkergrijs));
  ok('en een pad zonder regel in dit mapje gaat uit', busM.some((b) => b[1] === 33 && b[2] === 0));
}

// ---- de standaardmapping (0x42, geen banken) ------------------------------
{
  const m = new Mapping({ read, invoke: () => {}, vars: () => ({ focus: 1 }) });
  m.load(standaard);
  const dk = [...m.rules.values()].filter((r) => /^cc:\d+:(1[6-9]|2[0-3])$/.test(r.in));
  ok('standaard: device knobs alleen op kanaal 0 (0x42 bankt niet)', dk.length > 0 && dk.every((r) => r.in.startsWith('cc:0:')));
  const rack = dk.filter((r) => r.laag === 'device.rack');
  ok('standaard: in het mapje "rack" bedienen ze het rack van de track met focus',
    rack.length === 8 && rack.every((r) => r.action === `track.{focus}.fx.knob.${Number(r.in.split(':')[2]) - 15}`));
  ok('standaard: elke device knob hoort bij een mapje', dk.every((r) => r.laag?.startsWith('device.')));
}

// ---- ronde 2 (23 sep): drie standen, B4-kleuren, shift, On/Off, op de tel --
{
  const standen = {};
  const lees = (a) => (a in standen ? standen[a] : null);
  const lgR = new Lagen();
  const mR = new Mapping({ read: lees, invoke: () => {}, vars: () => ({ focus: 1 }), lagen: () => lgR.actief() });
  mR.load(standaard);
  const busR = [];
  const fbR = new Feedback({ device: apc, mapping: mR, read: lees, meta: () => null, send: (b) => { busR.push([...b]); return true; } });
  fbR.klaar = true;
  const led = (sig) => fbR.desired().get(sig)?.[2] ?? null;   // wat er NU zou branden
  const noot = (n, on) => ({ type: 'note', channel: 0, number: n, sig: `note:0:${n}`, on, value: on ? 127 : 0, norm: on ? 1 : 0 });

  // 1. A|B-knop = crossfaderkant op de tweekleurige LED: A geel, B oranje, thru uit.
  standen['track.1.xfade.side'] = 0;       // read: A = 0, thru = 0,5, B = 1
  ok('A|B-knop: kant A = geel (velocity 1)', led('note:0:66') === 1);
  standen['track.1.xfade.side'] = 1;
  ok('A|B-knop: kant B = oranje (velocity 127)', led('note:0:66') === 127);
  standen['track.1.xfade.side'] = 0.5;
  ok('A|B-knop: thru = uit', led('note:0:66') === 0);
  standen['track.3.xfade.side'] = 0;
  ok('A|B-knop van kolom 3 op kanaal 3', fbR.desired().get('note:2:66')?.[0] === 0x92);

  // ● (record arm) doet zonder shift niets, en brandt dus ook niet.
  standen['track.1.cue'] = 1;
  ok('● zonder shift: geen regel, geen lampje', led('note:0:48') === null);

  // 4. Shift: LED's tonen de shift-regels, en dat gebeurt meteen bij het event.
  standen['track.1.hotcue.1'] = 0.5;
  standen['track.1.hotcue.1.delete'] = 1;
  standen['track.1.hotcue.2'] = 0;
  standen['track.1.hotcue.2.delete'] = 0;
  fbR.tick(999);
  busR.length = 0;
  mR.handle(noot(98, true));
  ok('shift ingedrukt: LED\'s verversen zonder op de volgende tick te wachten', busR.length > 0);
  ok('shift: ● toont cue', busR.some((b) => b[0] === 0x90 && b[1] === 48 && b[2] === 127));
  ok('shift: een gezette hotcue wordt ROOD (wissen)', led('note:0:32') === apc.palette.rood);
  ok('shift: een lege hotcue is niets te wissen = uit', led('note:0:24') === 0);
  mR.handle(noot(98, false));
  ok('shift los: terug naar gedimd geel', led('note:0:32') === apc.palette.geeldonker);
  ok('shift los: ● weer donker', led('note:0:48') === null);

  // 2 + 3. Halve standen en B4-kleuren.
  ok('hotcue leeg (track geladen) = donkergrijs', led('note:0:24') === 1);
  standen['track.1.hotcue.2'] = 1;
  ok('hotcue actief (ingedrukt) = volle kleur', led('note:0:24') === apc.palette.geel);
  delete standen['track.1.hotcue.2'];
  ok('hotcue zonder track (read null) = uit', led('note:0:24') === null);
  lgR.zet('grid', 'sampler');
  standen['sampler.1'] = 0;
  ok('sampler-pad leeg = donkergrijs', led('note:0:32') === 1);
  standen['sampler.1'] = 0.5;
  ok('sampler-pad gevuld = gedimd violet (50), niet dezelfde als spelend', led('note:0:32') === 50);
  standen['sampler.1'] = 1;
  ok('sampler-pad speelt = violet (49)', led('note:0:32') === 49);
  ok('grid-kiesknop sampler dicht = gedimd violet', (standen['layer.grid.sampler'] = 0, led('note:0:84') === 50));
  standen['sampler.1.clear'] = 0.5;
  ok('leegmaken zonder shift: gedimd rood (er valt iets te wissen)', led('note:0:24') === apc.palette.rooddonker);
  lgR.zet('grid', 'hotcues');
  ok('gedimde kleuren zijn de donkere (#59xxxx), niet de fel-pastel "zacht"',
    ['geeldonker', 'cyaandonker', 'blauwdonker', 'violetdonker'].every((k) => {
      const hex = apc.paletteHex[apc.palette[k]];
      return hex && Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))) <= 0x64;
    }));

  // 5. On/Off brandt als het effect AAN staat.
  standen['track.1.fx.bypass'] = 0;
  ok('On/Off: effect aan = LED aan', led('note:0:62') === 127);
  standen['track.1.fx.bypass'] = 1;
  ok('On/Off: effect uit (bypass) = LED uit', led('note:0:62') === 0);

  // 6. Op de tel: fel/gedimd, gerekend uit de fase van wat je HOORT.
  lgR.zet('grid', 'loops');
  standen['track.1.beatloop.1'] = 1;
  standen['track.1.phase'] = 0.1;
  ok('actieve loop op de tel = fel cyaan', led('note:0:32') === apc.palette.cyaan);
  standen['track.1.phase'] = 0.6;
  ok('actieve loop tussen de tellen = gedimd cyaan', led('note:0:32') === apc.palette.cyaandonker);
  // Op de "1" van de maat (maat-anker per stuk) een halve tel fel, anders een kwart.
  standen['track.1.phase'] = 0.35; standen['track.1.barbeat'] = 1;
  ok('op de "1" van de maat: na een kwart tel nog fel', led('note:0:32') === apc.palette.cyaan);
  standen['track.1.barbeat'] = 2;
  ok('op tel 2: na een kwart tel gedimd', led('note:0:32') === apc.palette.cyaandonker);
  standen['track.1.barbeat'] = 1; standen['track.1.phase'] = 0.6;
  ok('ook op de "1": na een halve tel gedimd', led('note:0:32') === apc.palette.cyaandonker);
  delete standen['track.1.barbeat'];
  standen['track.1.phase'] = null;
  ok('loop op een stilstaande track: gewoon fel, geen knipperen', led('note:0:32') === apc.palette.cyaan);
  standen['track.1.beatloop.2'] = 0;
  standen['track.1.phase'] = 0.1;
  ok('een loop die NIET loopt knippert niet', led('note:0:24') === 1);
  lgR.zet('grid', 'hotcues');

  standen['track.1.focus'] = 1; standen['track.1.leads'] = 1;
  standen['track.1.phase'] = 0.6;
  ok('Track Select van de maatgever met focus: aan tussen de tellen', led('note:0:51') === 127);
  standen['track.1.phase'] = 0.1;
  ok('... en even uit op de tel', led('note:0:51') === 0);
  standen['track.1.focus'] = 0;
  ok('maatgever zonder focus: even aan op de tel', led('note:0:51') === 127);
  standen['track.1.leads'] = 0;
  ok('geen maatgever: geen tel, gewoon de focusstand', led('note:0:51') === 0);

  // Verkeer: een knipperende LED stuurt twee berichten per tel, niet 30.
  lgR.zet('grid', 'loops');
  standen['track.1.leads'] = 1; standen['track.1.focus'] = 1;
  fbR.tick(999);
  busR.length = 0;
  for (let t = 0; t < 2000; t += 33) {       // 2 s op 120 bpm = 4 tellen, tik elke 33 ms
    standen['track.1.phase'] = (t / 500) % 1;
    standen['track.1.barbeat'] = Math.floor(t / 500) % 4 + 1;    // de "1" knippert langer, niet vaker
    fbR.tick();
  }
  delete standen['track.1.barbeat'];
  const perLed = (n) => busR.filter((b) => b[1] === n).length;
  ok(`knipperen: loop-pad ${perLed(32)} en Track Select ${perLed(51)} berichten in 4 tellen (≤ 8)`,
    perLed(32) <= 8 && perLed(51) <= 8 && perLed(32) >= 6);
  lgR.zet('grid', 'hotcues');
}

// ---- grid-modus (stap D): LED's -------------------------------------------------
{
  const standen = {};
  const lees = (a) => (a in standen ? standen[a] : null);
  const lg = new Lagen();
  const m = new Mapping({ read: lees, invoke: () => {}, vars: () => ({ focus: 2 }), lagen: () => lg.actief() });
  m.load(standaard);
  const fbG = new Feedback({ device: apc, mapping: m, read: lees, meta: () => null, send: () => true });
  fbG.klaar = true;
  const led = (sig) => fbG.desired().get(sig)?.[2] ?? null;
  standen['layer.grid.hotcues'] = 1; standen['layer.grid.loops'] = 0;
  standen['mixer.xfader.curve'] = 0; standen['layer.edit.toggle'] = 0;
  standen['track.2.grid.here'] = 0; standen['track.2.grid.lock'] = 1;
  standen['track.2.focus'] = 1; standen['track.2.leads'] = 0; standen['track.2.phase'] = 0.1;

  ok('buiten grid-modus: scene 1 = geel (hotcues open)', led('note:0:82') === apc.palette.geel);
  ok('buiten grid-modus: Metronome-lampje = curve (smooth = uit)', led('note:0:90') === 0);
  ok('buiten grid-modus: Lock brandt niet', led('note:0:63') === null);
  ok('buiten grid-modus: focus zonder maat knippert niet', led('note:1:51') === 127);

  lg.zet('edit', 'aan'); standen['layer.edit.toggle'] = 1;
  ok('grid-modus: scene 1 = WIT (niet de kleur van een grid-mapje)', led('note:0:82') === apc.palette.wit);
  standen['track.2.grid.here'] = 1;
  ok('grid-modus: scene 1 ingedrukt = cyaan', led('note:0:82') === apc.palette.cyaan);
  delete standen['track.2.grid.here'];
  ok('grid-modus zonder grid: scene 1 uit (niets te doen)', led('note:0:82') === null);
  ok('grid-modus: Metronome-lampje aan, ook met de curve op smooth', led('note:0:90') === 127);
  ok('grid-modus: Lock = slot van de focus-track', led('note:0:63') === 127);
  standen['track.2.grid.lock'] = 0;
  ok('... en uit als hij niet op slot staat', led('note:0:63') === 0);
  ok('grid-modus: Track Select van de focus knippert op de tel (uit op de tel)', led('note:1:51') === 0);
  standen['track.2.phase'] = 0.6;
  ok('... en aan ertussen', led('note:1:51') === 127);
  standen['track.1.focus'] = 0; standen['track.1.leads'] = 1; standen['track.1.phase'] = 0.1;
  ok('grid-modus: een andere track zonder focus blijft donker', led('note:0:51') === 0);
}

// ---- de reads achter de B4-kleuren (echte action-bus) -----------------------
{
  const A = engine.decks.A;
  A.buffer = {}; A.hotcues = [null, null, null, null];
  ok('hotcue-read: leeg op een geladen track = 0', read('track.1.hotcue.1') === 0);
  A.hotcues[0] = 2;
  ok('hotcue-read: gezet = 0,5 (gevuld)', read('track.1.hotcue.1') === 0.5);
  invoke('track.1.hotcue.1', true);
  ok('hotcue-read: ingedrukt = 1 (actief)', read('track.1.hotcue.1') === 1);
  invoke('track.1.hotcue.1', false);
  ok('hotcue-read: los = weer 0,5', read('track.1.hotcue.1') === 0.5);
  ok('wis-read: iets te wissen = 1', read('track.1.hotcue.1.delete') === 1 && read('track.1.hotcue.2.delete') === 0);
  ok('beatloop-read zonder grid = null (niets te doen)', read('track.1.beatloop.4') === null);
  A.buffer = null;
  ok('hotcue-read zonder track = null', read('track.1.hotcue.1') === null && read('track.1.hotcue.1.delete') === null);
  ok('loop.toggle-read zonder track = null', read('track.1.loop.toggle') === null);
  A.buffer = {};
  A.fx.effectId = null;
  ok('On/Off-read zonder effect = null (niets aan of uit te zetten)', read('track.1.fx.bypass') === null);
  A.fx.effectId = 'filter';

  // Fase van wat je HOORT: positie min uitgangsvertraging × rate.
  A.grid = { bpm: 120, phase(t) { const b = t * 2; return b - Math.floor(b); } };
  A.playing = true; A.position = 1.1; A.rate = 1;
  ok('fase-read rekent met de uitgangsvertraging (50 ms)', Math.abs(read('track.1.phase') - 0.1) < 1e-9);
  // Tel van de maat van wat je HOORT, vanaf het maat-anker van het stuk: de "1" op 1,0 s.
  const { Beatgrid } = await import('../src/engine/beatgrid.js');
  A.grid = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker: 0, maat: 1.0 }] });
  A.position = 1.1;
  ok('maat-read: 50 ms na de "1" (wat je hoort) = tel 1', read('track.1.barbeat') === 1);
  A.position = 1.1 + 0.5 * 3;
  ok('maat-read: drie tellen later = tel 4', read('track.1.barbeat') === 4);
  A.playing = false;
  ok('fase-read op een stilstaande track = null', read('track.1.phase') === null && read('track.1.barbeat') === null);
  A.grid = null; A.hotcues[0] = null;
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
