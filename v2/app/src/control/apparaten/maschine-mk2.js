/**
 * Het apparaat Maschine MK2: WAT er op zit, zoals apparaten/apc40mk2.js. Wat een knop DOET
 * staat in de indeling (indelingen/maschine-mk2.json). Hier dus geen enkele actie.
 *
 * VarveDJ ziet de Maschine nooit zelf: de AV-app-hub opent hem via USB-HID (zonder NI-software)
 * en maakt er VIRTUELE MIDI van (AV-app-hub docs/MASCHINE.md, src/devices/maschine-mk2.js: de
 * bron van de nummers hieronder; PROTOCOL §17). Overgenomen uit v1 src/control/devices/maschine-mk2.js,
 * in de vorm die indeling, lampjes en leren van v2 verwachten.
 *
 *   pad1..pad16    noot 36–51 op kanaal 0 (pad 1 = linksonder, per rij van vier naar boven),
 *                  velocity 1..127, polyfone aftertouch (0xA0), loslaten = noot uit
 *   48 knoppen     noot = bitnummer 0–47 op kanaal 1 (namen zoals in de hub: f1, groepA, shift …)
 *   enc1..enc8     CC 16–23 op kanaal 0, RELATIEF (tweecomplement), in tellen: één omwenteling ≈ 1000
 *   masterwiel     CC 24 op kanaal 0, relatief, ±1 per klik; indrukken = knop `wiel`
 *
 * Lampjes terug (noot aan op hetzelfde nummer): pads en groepen A–H velocity = APC-paletindex
 * (dezelfde 128 kleuren als de APC), andere knoppen velocity = helderheid. Het wiel heeft geen
 * lampje. De twee schermen (256 × 64, 1 bit) gaan niet via de indeling maar via de hub
 * (`scherm(nr, bytes)`, control/maschine-scherm.js).
 */
import { KLEUR, donker, PALET } from './apc40mk2.js';

export const NAAM = 'Maschine MK2';
export const PAD_NOOT = 36;
export const PAD_KANAAL = 0;
export const KNOP_KANAAL = 1;
export const ENCODER_CC = 16;
export const WIEL_CC = 24;
/** Tellen per omwenteling van een draaiknop (de hub: 0..999, rondlopend). */
export const TELLEN_PER_OMWENTELING = 1000;
/** Eén omwenteling = het hele bereik 0..1 (stap in een indeling). */
export const STAP_OMWENTELING = 1 / TELLEN_PER_OMWENTELING;

/** De 48 knoppen in de volgorde van hun bit (= hun noot op kanaal 1). */
export const KNOPPEN = Object.freeze([
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8',
  'control', 'step', 'browse', 'sampling', 'browseL', 'browseR', 'all', 'auto',
  'volume', 'swing', 'tempo', 'navL', 'navR', 'enter', 'noteRepeat', 'wiel',
  'groepA', 'groepB', 'groepC', 'groepD', 'groepE', 'groepF', 'groepG', 'groepH',
  'restart', 'stapL', 'stapR', 'grid', 'play', 'rec', 'erase', 'shift',
  'scene', 'pattern', 'padMode', 'navigate', 'duplicate', 'select', 'solo', 'mute',
]);
export const GROEPEN = Object.freeze(KNOPPEN.slice(24, 32));
const LABEL = {
  control: 'CONTROL', step: 'STEP', browse: 'BROWSE', sampling: 'SAMPLING', browseL: '◄ links boven', browseR: '► links boven',
  all: 'ALL', auto: 'AUTO', volume: 'VOLUME', swing: 'SWING', tempo: 'TEMPO', navL: '◄ bij het wiel', navR: '► bij het wiel',
  enter: 'ENTER', noteRepeat: 'NOTE REPEAT', wiel: 'wiel indrukken', restart: 'RESTART', stapL: '◄ transport',
  stapR: '► transport', grid: 'GRID', play: 'PLAY', rec: 'REC', erase: 'ERASE', shift: 'SHIFT', scene: 'SCENE',
  pattern: 'PATTERN', padMode: 'PAD MODE', navigate: 'NAVIGATE', duplicate: 'DUPLICATE', select: 'SELECT', solo: 'SOLO', mute: 'MUTE',
};

/**
 * Soorten control en het gedrag dat ze in een indeling mogen hebben (zoals apc40mk2.js):
 *   pad, knop   indrukken/loslaten            -> trigger, schakelaar
 *   rel         relatieve encoder / het wiel   -> eindeloos, of trigger met `terug` (per tik)
 */
export const GEDRAG_VOOR = Object.freeze({ pad: ['trigger', 'schakelaar'], knop: ['trigger', 'schakelaar'], rel: ['eindeloos', 'trigger'] });

/** @type {{ id, soort, t: 'noot'|'cc', n, ch, led: 'rgb'|'aan'|'geen', label }[]} */
const LIJST = [];
const K = (id, soort, t, n, ch, led, label) => LIJST.push(Object.freeze({ id, soort, t, n, ch, led, label }));
for (let p = 1; p <= 16; p++) K(`pad${p}`, 'pad', 'noot', PAD_NOOT + p - 1, PAD_KANAAL, 'rgb', `pad ${p}`);
KNOPPEN.forEach((k, i) => {
  const led = k === 'wiel' ? 'geen' : GROEPEN.includes(k) ? 'rgb' : 'aan';
  K(k, 'knop', 'noot', i, KNOP_KANAAL, led, LABEL[k] ?? (k.startsWith('groep') ? `groep ${k.slice(5)}` : k.toUpperCase()));
});
for (let k = 1; k <= 8; k++) K(`enc${k}`, 'rel', 'cc', ENCODER_CC + k - 1, 0, 'geen', `draaiknop ${k}`);
K('masterwiel', 'rel', 'cc', WIEL_CC, 0, 'geen', 'masterwiel');

export const CONTROLS = Object.freeze(LIJST);
export const OP_ID = new Map(CONTROLS.map((c) => [c.id, c]));
const OP_MIDI = new Map(CONTROLS.map((c) => [`${c.t}:${c.ch}:${c.n}`, c]));

/** Tweecomplement: 1..63 = +n, 64..127 = −64..−1. */
export const relatief = (ruw) => (ruw >= 64 ? ruw - 128 : ruw);

/**
 * Een geparsed bericht (midi.js parseBericht) -> gebeurtenis, of null:
 *   { control, soort: 'druk'|'los'|'delta', waarde, ruw, delta? }
 * `ruw` is bij een pad de aanslag (velocity). Polyfone aftertouch ontleedt dit apparaat nog niet.
 */
export function ontleed(m) {
  if (m.type === 'noot') {
    const c = OP_MIDI.get(`noot:${m.kanaal}:${m.nummer}`);
    if (!c) return null;
    return { control: c.id, soort: m.aan ? 'druk' : 'los', waarde: m.aan ? 1 : 0, ruw: m.waarde };
  }
  if (m.type === 'cc') {
    const c = OP_MIDI.get(`cc:${m.kanaal}:${m.nummer}`);
    if (!c) return null;
    return { control: c.id, soort: 'delta', delta: relatief(m.waarde), waarde: null, ruw: m.waarde };
  }
  return null;
}

const klem = (v) => Math.max(0, Math.min(127, Math.round(v)));

/**
 * De bytes van een lampje. `staat`: rgb { kleur: paletindex 0..127 }, aan { aan, helder? 0..127 }.
 * Uit is een noot aan met velocity 0.
 */
export function ledBericht(c, staat) {
  switch (c.led) {
    case 'rgb': return [0x90 | c.ch, c.n, klem(staat.kleur ?? 0)];
    case 'aan': return [0x90 | c.ch, c.n, staat.aan ? klem(staat.helder ?? 127) : 0];
    default: return null;
  }
}

/** Uit-bericht voor elk lampje. */
export function alleUit() {
  return CONTROLS.filter((c) => c.led !== 'geen').map((c) => [0x90 | c.ch, c.n, 0]);
}

export const maschineMk2 = Object.freeze({
  id: 'maschine-mk2',
  naam: NAAM,
  zoek: /maschine/i,
  kolommen: 4,
  shift: 'shift',
  init: null,
  controls: OP_ID,
  gedragVoor: GEDRAG_VOOR,
  kleur: KLEUR,
  donker,
  palet: PALET,
  ontleed,
  ledBericht,
  alleUit,
  label: (id) => OP_ID.get(id)?.label ?? null,
});

export default maschineMk2;
