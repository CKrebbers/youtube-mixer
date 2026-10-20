/**
 * Het apparaat APC40 mkII: WAT er op zit (welke knop welk bericht stuurt, welk
 * lampje eronder zit, hoe je hem wakker maakt). Wat een knop DOET staat in de
 * indeling (indelingen/apc40mk2.json). Hier dus geen enkele actie.
 *
 * Bron van elk nummer: Akai APC40 Mk2 Communications Protocol v1.2 (19 januari
 * 2015), "Assignment of Note number messages to LEDs" (p13-17), "Assignment of
 * controller numbers to absolute controllers" (p23-26), het palet (p18-22).
 * Overgenomen uit v1 src/control/devices/apc40mk2.js en nagelegd tegen
 * AV-app-hub src/devices/apc40mk2.js (dezelfde nummers). Niet uit herinnering:
 * wijk er niet van af zonder het document erbij.
 *
 * Control-id's zijn die van AV-app-hub (en av-kern), zodat er één naamgeving is:
 *   pad{rij}-{kolom}   het grid, rij 1 = ONDERSTE rij (noot 0-7), rij 5 = bovenste (noot 32-39)
 *   scene1-5           scene launch, scene 1 = bovenaan (noot 82-86)
 *   rec/solo/act/sel/stop/ab{k}  per kolom (noot 48/49/50/51/52/66, kanaal k-1)
 *   fader{k}           CC 7 op kanaal k-1
 *   tk{k}              track knob boven de kolom (CC 48-55, kanaal 0)
 *   dk{k}              device knob (CC 16-23, kanaal 0: in 0x42 niet gebankt, bediening-044)
 *   en de losse knoppen (LOS hieronder), met right = noot 96 en left = noot 97 (protocol v1.2).
 */

export const NAAM = 'APC40 mkII';
export const MODUS = Object.freeze({ generiek: 0x40, ableton: 0x41, alternatief: 0x42 });

/**
 * Introductie (bediening-043). Mode 0x42 = Alternate Ableton Live: alles
 * momentary, ALLE lampjes en ringen van ons, de device-sectie niet gebankt.
 * Apparaat-id 0x7F = iedereen. Na elke (her)aansluiting opnieuw: na een replug
 * staat de APC weer in 0x40.
 */
export const intro = (modus = MODUS.alternatief) => [0xf0, 0x47, 0x7f, 0x29, 0x60, 0x00, 0x04, modus, 0x00, 0x00, 0x00, 0xf7];
export const INIT = Object.freeze(intro());

export const KOLOMMEN = 8;
export const RIJEN = 5;
/** Grid-noot voor rij 1..5 (1 = ONDER) en kolom 1..8. Noot 0 is linksonder (bediening-045). */
export const gridNoot = (rij, kolom) => (rij - 1) * KOLOMMEN + (kolom - 1);

/**
 * Het palet: velocity = kleur (p18-22). Namen voor wat we gebruiken. De gedimde
 * stand is index n+1 (de #59xxxx-tinten); de "zacht"-pastels (n-1) zijn op het
 * apparaat even fel als de volle kleur en dus GEEN gedimde stand (bediening-033).
 */
export const KLEUR = Object.freeze({
  uit: 0, donkergrijs: 1, grijs: 2, wit: 3,
  rood: 5, rooddonker: 6, oranje: 9, oranjedonker: 10, geel: 13, geeldonker: 14,
  limoen: 17, limoendonker: 18, groen: 21, groendonker: 22, zeegroen: 33, zeegroendonker: 34,
  cyaan: 37, cyaandonker: 38, hemelsblauw: 41, hemelsblauwdonker: 42, blauw: 45, blauwdonker: 46,
  violet: 49, violetdonker: 50, magenta: 53, magentadonker: 54, roze: 57, rozedonker: 58,
});
/** De donkere tint van een kleur (n+1); wit wordt grijs, en zonder tint donkergrijs. */
export const donker = (naam) => (naam === 'wit' ? 'grijs' : KLEUR[`${naam}donker`] !== undefined ? `${naam}donker` : 'donkergrijs');

/** De tweekleurige LED onder A|B: 0 uit, 1 geel, 2-127 oranje (protocol "Bi-Color LED"). */
export const TWEEKLEUR = Object.freeze({ uit: 0, geel: 1, oranje: 127 });

/** Het MIDI-kanaal kiest het GEDRAG van een RGB-lampje: 0 vast, 1-5 oneshot, 6-10 puls, 11-15 knipper. */
export const LED_KANAAL = Object.freeze({ vast: 0, oneshot: 1, puls: 6, knipper: 11 });

/** Ringtype (CC 24-31 voor de device knobs, 56-63 voor de track knobs): 0 uit, 1 single, 2 volume, 3 pan. */
export const RING = Object.freeze({ uit: 0, single: 1, volume: 2, pan: 3 });

/**
 * Soorten control en het gedrag dat ze in een indeling mogen hebben:
 *   pad, scene, knop  indrukken/loslaten         -> trigger, schakelaar
 *   fader             absoluut zonder ring       -> absoluut (soft-takeover)
 *   draai             ringknop: draait eindeloos maar stuurt ABSOLUUT (bediening-012)
 *                                                -> eindeloos (of absoluut)
 *   rel               relatieve encoder (tempo, cue level: 1-63 op, 64-127 neer)
 *                                                -> eindeloos, of trigger met `terug` (per tik)
 *   voet              footswitch (CC 64, >= 64 = ingedrukt) -> trigger, schakelaar
 */
export const GEDRAG_VOOR = Object.freeze({
  pad: ['trigger', 'schakelaar'], scene: ['trigger', 'schakelaar'], knop: ['trigger', 'schakelaar'],
  voet: ['trigger', 'schakelaar'], fader: ['absoluut'], draai: ['eindeloos', 'absoluut'], rel: ['eindeloos', 'trigger'],
});

/** @type {{ id, soort, t: 'noot'|'cc', n, ch, led: 'rgb'|'aan'|'clipstop'|'ab'|'ring'|'geen', label }[]} */
const LIJST = [];
const K = (id, soort, t, n, ch, led, label) => LIJST.push(Object.freeze({ id, soort, t, n, ch, led, label }));

for (let r = 1; r <= RIJEN; r++) for (let c = 1; c <= KOLOMMEN; c++) K(`pad${r}-${c}`, 'pad', 'noot', gridNoot(r, c), 0, 'rgb', `pad rij ${r} kolom ${c}`);
for (let r = 1; r <= 5; r++) K(`scene${r}`, 'scene', 'noot', 0x51 + r, 0, 'rgb', `scene ${r}`);
for (let c = 1; c <= KOLOMMEN; c++) {
  K(`rec${c}`, 'knop', 'noot', 0x30, c - 1, 'aan', `record arm ${c}`);
  K(`solo${c}`, 'knop', 'noot', 0x31, c - 1, 'aan', `solo ${c}`);
  K(`act${c}`, 'knop', 'noot', 0x32, c - 1, 'aan', `activator ${c}`);
  K(`sel${c}`, 'knop', 'noot', 0x33, c - 1, 'aan', `track select ${c}`);
  K(`stop${c}`, 'knop', 'noot', 0x34, c - 1, 'clipstop', `clip stop ${c}`);
  K(`ab${c}`, 'knop', 'noot', 0x42, c - 1, 'ab', `A|B ${c}`);
  K(`fader${c}`, 'fader', 'cc', 0x07, c - 1, 'geen', `fader ${c}`);
  K(`dk${c}`, 'draai', 'cc', 0x0f + c, 0, 'ring', `device knob ${c}`);
  K(`tk${c}`, 'draai', 'cc', 0x2f + c, 0, 'ring', `track knob ${c}`);
}
const LOS = [
  ['devL', 'knop', 'noot', 0x3a, 'aan', '◄ device'], ['devR', 'knop', 'noot', 0x3b, 'aan', 'device ►'],
  ['bankL', 'knop', 'noot', 0x3c, 'aan', '◄ bank'], ['bankR', 'knop', 'noot', 0x3d, 'aan', 'bank ►'],
  ['devOn', 'knop', 'noot', 0x3e, 'aan', 'device on/off'], ['lock', 'knop', 'noot', 0x3f, 'aan', 'device lock'],
  ['clipdev', 'knop', 'noot', 0x40, 'aan', 'clip/device view'], ['detail', 'knop', 'noot', 0x41, 'aan', 'detail view'],
  ['mastersel', 'knop', 'noot', 0x50, 'aan', 'master'], ['stopall', 'knop', 'noot', 0x51, 'geen', 'stop all clips'],
  ['pan', 'knop', 'noot', 0x57, 'aan', 'pan'], ['sends', 'knop', 'noot', 0x58, 'aan', 'sends'], ['user', 'knop', 'noot', 0x59, 'aan', 'user'],
  ['metro', 'knop', 'noot', 0x5a, 'aan', 'metronome'], ['play', 'knop', 'noot', 0x5b, 'aan', 'play'],
  ['record', 'knop', 'noot', 0x5d, 'aan', 'record'],
  ['up', 'knop', 'noot', 0x5e, 'geen', '▲'], ['down', 'knop', 'noot', 0x5f, 'geen', '▼'],
  ['right', 'knop', 'noot', 0x60, 'geen', '►'], ['left', 'knop', 'noot', 0x61, 'geen', '◄'],
  ['shift', 'knop', 'noot', 0x62, 'geen', 'shift'], ['tap', 'knop', 'noot', 0x63, 'geen', 'tap tempo'],
  ['nudgeM', 'knop', 'noot', 0x64, 'geen', 'nudge −'], ['nudgeP', 'knop', 'noot', 0x65, 'geen', 'nudge +'],
  ['session', 'knop', 'noot', 0x66, 'aan', 'session record'], ['bank', 'knop', 'noot', 0x67, 'geen', 'bank'],
  ['master', 'fader', 'cc', 0x0e, 'geen', 'master fader'], ['xf', 'fader', 'cc', 0x0f, 'geen', 'crossfader'],
  ['tempo', 'rel', 'cc', 0x0d, 'geen', 'tempo'], ['cue', 'rel', 'cc', 0x2f, 'geen', 'cue level'],
  ['voet', 'voet', 'cc', 0x40, 'geen', 'footswitch'],
];
for (const [id, soort, t, n, led, label] of LOS) K(id, soort, t, n, 0, led, label);

export const CONTROLS = Object.freeze(LIJST);
export const OP_ID = new Map(CONTROLS.map((c) => [c.id, c]));
const OP_MIDI = new Map(CONTROLS.map((c) => [`${c.t}:${c.ch}:${c.n}`, c]));

/** Grid en scenes komen altijd op kanaal 0; de stripknoppen dragen de kolom in het kanaal. */
const vindNoot = (n, ch) => OP_MIDI.get(`noot:${ch}:${n}`) || OP_MIDI.get(`noot:0:${n}`) || null;
const vindCC = (n, ch) => OP_MIDI.get(`cc:${ch}:${n}`) || null;
/** Tweecomplement: 1..63 = +n, 64..127 = −64..−1 (tempo en cue level, protocol v1.2 p37). */
export const relatief = (ruw) => (ruw >= 64 ? ruw - 128 : ruw);

/**
 * Een geparsed bericht (midi.js parseBericht) -> gebeurtenis, of null (onbekend, sysex):
 *   { control, soort: 'druk'|'los'|'waarde'|'delta', waarde (0..1), ruw, delta? }
 */
export function ontleed(m) {
  if (m.type === 'noot') {
    const c = vindNoot(m.nummer, m.kanaal);
    if (!c) return null;
    return { control: c.id, soort: m.aan ? 'druk' : 'los', waarde: m.aan ? 1 : 0, ruw: m.waarde };
  }
  if (m.type === 'cc') {
    const c = vindCC(m.nummer, m.kanaal);
    if (!c) return null;
    if (c.soort === 'rel') return { control: c.id, soort: 'delta', delta: relatief(m.waarde), waarde: null, ruw: m.waarde };
    if (c.soort === 'voet') return { control: c.id, soort: m.waarde >= 64 ? 'druk' : 'los', waarde: m.waarde >= 64 ? 1 : 0, ruw: m.waarde };
    return { control: c.id, soort: 'waarde', waarde: m.waarde / 127, ruw: m.waarde };
  }
  return null;
}

/**
 * De bytes van een lampje. `staat`:
 *   rgb       { kleur: velocity 0..127, kanaal?: LED_KANAAL-waarde (standaard vast) }
 *   aan       { aan }                  eenkleurig: 0 uit, 127 aan
 *   clipstop  { aan }                  0 uit, 1 aan (velocity 2 = knipperen van het apparaat zelf; dat gebruiken we niet)
 *   ab        { kleur: 0 | 1 | 127 }   tweekleurig
 *   ring      { waarde: 0..1 }         de ringwaarde op de CC van de knop zelf
 * Uit is een note-on met velocity 0 (= note off), op het kanaal van de control.
 */
export function ledBericht(c, staat) {
  switch (c.led) {
    case 'rgb': return [0x90 | (staat.kanaal ?? 0), c.n, klem(staat.kleur ?? 0)];
    case 'aan': return [0x90 | c.ch, c.n, staat.aan ? 127 : 0];
    case 'clipstop': return [0x90 | c.ch, c.n, staat.aan ? 1 : 0];
    case 'ab': return [0x90 | c.ch, c.n, klem(staat.kleur ?? 0)];
    case 'ring': return [0xb0 | c.ch, c.n, Math.round(Math.min(1, Math.max(0, staat.waarde ?? 0)) * 127)];
    default: return null;
  }
}

/** Het ringtype van een ringknop: acht nummers boven zijn knop (CC 16 -> 24, 48 -> 56; bediening-047). */
export const ringType = (c, type) => (c.led === 'ring' ? [0xb0 | c.ch, c.n + 8, type] : null);

/** Uit-bericht voor elk lampje: het oppervlak schoonvegen bij wakker maken en afsluiten. */
export function alleUit() {
  const uit = [];
  for (const c of CONTROLS) {
    if (c.led === 'geen') continue;
    if (c.led === 'ring') { uit.push(ringType(c, RING.uit), ledBericht(c, { waarde: 0 })); continue; }
    uit.push([0x90 | (c.led === 'rgb' ? 0 : c.ch), c.n, 0]);
  }
  return uit;
}

const klem = (v) => Math.max(0, Math.min(127, Math.round(v)));

/** Velocity -> hex (p18-22), voor een kaart of de proef. */
export const PALET = Object.freeze([
  '#000000', '#1e1e1e', '#7f7f7f', '#ffffff', '#ff4c4c', '#ff0000', '#590000', '#190000',
  '#ffbd6c', '#ff5400', '#591d00', '#271b00', '#ffff4c', '#ffff00', '#595900', '#191900',
  '#88ff4c', '#54ff00', '#1d5900', '#142b00', '#4cff4c', '#00ff00', '#005900', '#001900',
  '#4cff5e', '#00ff19', '#00590d', '#001902', '#4cff88', '#00ff55', '#00591d', '#001f12',
  '#4cffb7', '#00ff99', '#005935', '#001912', '#4cc3ff', '#00a9ff', '#004152', '#001019',
  '#4c88ff', '#0055ff', '#001d59', '#000819', '#4c4cff', '#0000ff', '#000059', '#000019',
  '#874cff', '#5400ff', '#190064', '#0f0030', '#ff4cff', '#ff00ff', '#590059', '#190019',
  '#ff4c87', '#ff0054', '#59001d', '#220013', '#ff1500', '#993500', '#795100', '#436400',
  '#033900', '#005735', '#00547f', '#0000ff', '#00454f', '#2500cc', '#7f7f7f', '#202020',
  '#ff0000', '#bdff2d', '#afed06', '#64ff09', '#108b00', '#00ff87', '#00a9ff', '#002aff',
  '#3f00ff', '#7a00ff', '#b21a7d', '#402100', '#ff4a00', '#88e106', '#72ff15', '#00ff00',
  '#3bff26', '#59ff71', '#38ffcc', '#5b8aff', '#3151c6', '#877fe9', '#d31dff', '#ff005d',
  '#ff7f00', '#b9b000', '#90ff00', '#835d07', '#392b00', '#144c10', '#0d5038', '#15152a',
  '#16205a', '#693c1c', '#a8000a', '#de513d', '#d86a1c', '#ffe126', '#9ee12f', '#67b50f',
  '#1e1e30', '#dcff6b', '#80ffbd', '#9a99ff', '#8e66ff', '#404040', '#757575', '#e0ffff',
  '#a00000', '#350000', '#1ad000', '#074200', '#b9b000', '#3f3100', '#b35f00', '#4b1502',
]);

/** Het apparaat als één object, zoals indeling, lampjes en leren het verwachten. */
export const apc40mk2 = Object.freeze({
  id: 'apc40mk2',
  naam: NAAM,
  zoek: /apc40/i,
  kolommen: KOLOMMEN,
  shift: 'shift',
  init: INIT,
  controls: OP_ID,
  gedragVoor: GEDRAG_VOOR,
  kleur: KLEUR,
  donker,
  tweekleur: TWEEKLEUR,
  ring: RING,
  ledKanaal: LED_KANAAL,
  ontleed,
  ledBericht,
  ringType,
  alleUit,
  label: (id) => OP_ID.get(id)?.label ?? null,
});

export default apc40mk2;
