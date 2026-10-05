/**
 * Device-profiel Maschine MK2 — zoals de AV-app-hub hem doorgeeft.
 *
 * VARVE ziet de Maschine nooit zelf: de hub opent hem via USB-HID en maakt er
 * VIRTUELE MIDI van (AV-app-hub, docs/MASCHINE.md en src/devices/maschine-mk2.js,
 * de bron van de nummers hieronder; PROTOCOL §17). Dit profiel beschrijft alleen
 * WAT er op het apparaat zit, zoals devices/apc40mk2.js: welke knop welk bericht
 * stuurt en waar een lampje zit. Wat een knop DOET staat in mappings/maschine-mk2.json
 * en src/control/maschine.js (docs/MASCHINE.md in deze repo).
 *
 *   16 pads           noot 36–51 op kanaal 0 (pad 1 = linksonder = 36, per rij van vier naar boven),
 *                     velocity 1..127, polyfone aftertouch (0xA0), loslaten = noot uit
 *   48 knoppen        noot = bitnummer 0–47 op kanaal 1 (0x91 127 / 0x81 0)
 *   8 draaiknoppen    CC 16–23 op kanaal 0, RELATIEF (tweecomplement), in tellen:
 *                     één omwenteling ≈ 1000 tellen, pas na 12 tellen in één richting
 *   masterwiel        CC 24 op kanaal 0, relatief, ±1 per klik; indrukken = noot 23 op kanaal 1
 *
 * Lampjes terug (noot aan op hetzelfde nummer): pads (kanaal 0) en groepen A–H
 * (kanaal 1, noot 24–31) velocity = APC-paletindex (dezelfde 128 kleuren als de
 * APC, devices/apc40mk2.js); andere knoppen velocity = helderheid 0..127. Het
 * masterwiel heeft geen lampje. Schermen: twee keer 256 × 64, 1 bit
 * (src/control/maschine-scherm.js).
 */

export const PAD_NOOT = 36;
export const PAD_KANAAL = 0;
export const KNOP_KANAAL = 1;
export const ENCODER_CC = 16;
export const WIEL_CC = 24;
/** Tellen per omwenteling van een draaiknop (de hub: 0..999, rondlopend). */
export const TELLEN_PER_OMWENTELING = 1000;

/** De 48 knoppen in de volgorde van hun bit (= hun noot op kanaal 1). Namen zoals in de hub. */
export const KNOPPEN = Object.freeze([
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8',
  'control', 'step', 'browse', 'sampling', 'browseL', 'browseR', 'all', 'auto',
  'volume', 'swing', 'tempo', 'navL', 'navR', 'enter', 'noteRepeat', 'wiel',
  'groepA', 'groepB', 'groepC', 'groepD', 'groepE', 'groepF', 'groepG', 'groepH',
  'restart', 'stapL', 'stapR', 'grid', 'play', 'rec', 'erase', 'shift',
  'scene', 'pattern', 'padMode', 'navigate', 'duplicate', 'select', 'solo', 'mute',
]);
export const KNOP_NR = new Map(KNOPPEN.map((k, i) => [k, i]));
/** Wat er op de knop staat. */
export const KNOP_LABEL = Object.freeze({
  control: 'CONTROL', step: 'STEP', browse: 'BROWSE', sampling: 'SAMPLING', browseL: '◄ (links boven)', browseR: '► (links boven)',
  all: 'ALL', auto: 'AUTO', volume: 'VOLUME', swing: 'SWING', tempo: 'TEMPO', navL: '◄ (bij het wiel)', navR: '► (bij het wiel)',
  enter: 'ENTER', noteRepeat: 'NOTE REPEAT', wiel: 'masterwiel indrukken', restart: 'RESTART', stapL: '◄ (transport)',
  stapR: '► (transport)', grid: 'GRID', play: 'PLAY', rec: 'REC', erase: 'ERASE', shift: 'SHIFT', scene: 'SCENE',
  pattern: 'PATTERN', padMode: 'PAD MODE', navigate: 'NAVIGATE', duplicate: 'DUPLICATE', select: 'SELECT', solo: 'SOLO', mute: 'MUTE',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`f${i}`, `F${i}`])),
  ...Object.fromEntries('ABCDEFGH'.split('').map((l) => [`groep${l}`, `groep ${l}`])),
});
/** Groepknoppen A–H: noot 24–31 op kanaal 1, lampje in paletkleur. */
export const GROEPEN = Object.freeze(KNOPPEN.slice(24, 32));

/** Noot van een knop (kanaal 1). */
export const knopNoot = (naam) => KNOP_NR.get(naam) ?? null;
/** Noot van pad 1..16. */
export const padNoot = (pad) => PAD_NOOT + pad - 1;
/** Pad 1..16 van een noot op kanaal 0, of null. */
export const padVanNoot = (noot) => (noot >= PAD_NOOT && noot < PAD_NOOT + 16 ? noot - PAD_NOOT + 1 : null);

/** Signatures zoals parseMessage ze maakt (midi.js). */
export const knopSig = (naam) => `note:${KNOP_KANAAL}:${knopNoot(naam)}`;
export const padSig = (pad) => `note:${PAD_KANAAL}:${padNoot(pad)}`;
export const encoderSig = (k) => `cc:0:${ENCODER_CC + k - 1}`;
export const WIEL_SIG = `cc:0:${WIEL_CC}`;

function bouwControls() {
  const uit = new Map();
  for (let p = 1; p <= 16; p++) uit.set(padSig(p), { sig: padSig(p), label: `pad ${p}`, kind: 'pad', led: 'rgb' });
  KNOPPEN.forEach((k) => {
    const led = k === 'wiel' ? null : GROEPEN.includes(k) ? 'rgb' : 'single';
    uit.set(knopSig(k), { sig: knopSig(k), label: KNOP_LABEL[k] ?? k, kind: 'button', led });
  });
  for (let k = 1; k <= 8; k++) uit.set(encoderSig(k), { sig: encoderSig(k), label: `draaiknop ${k}`, kind: 'encoder' });
  uit.set(WIEL_SIG, { sig: WIEL_SIG, label: 'masterwiel', kind: 'encoder' });
  return uit;
}

export const maschineMk2 = {
  id: 'maschine-mk2',
  name: 'Maschine MK2 (via de hub)',
  match: /maschine/i,
  controls: bouwControls(),
  label(sig) { return this.controls.get(sig)?.label ?? null; },
};

export default maschineMk2;
