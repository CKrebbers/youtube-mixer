/**
 * Device-profiel APC40 mkII.
 *
 * Een profiel beschrijft alleen WAT er op het apparaat zit — welke knop welk
 * bericht stuurt, welke LED er onder zit, hoe je hem wakker maakt. Wat een knop
 * DOET staat in de mapping, en die is data. Hier dus geen enkele action-id.
 *
 * Bron: Akai APC40 Mk2 Communications Protocol v1.2 (19 januari 2015), de
 * tabellen "Assignment of Note number messages to LEDs" (p13-17) en
 * "Assignment of controller numbers to absolute controllers" (p23-26).
 * Alles hieronder komt uit dat document, niet uit herinnering.
 */

/**
 * Introduction message. Zonder dit blijven de LED's grotendeels dood.
 * Mode 0x42 = Alternate Ableton Live (Clay, 23 september 2026, VRAGEN B1):
 * alles momentary, ÁLLE LED's inclusief de ringen van ons, en de device-sectie
 * niet gebankt (alles op kanaal 0). Gemeten in 0x41: device knob 1 kwam op
 * cc:0:16 ongeacht de geselecteerde track, dus banken bestaan hier niet —
 * welke track de device knobs bedienen bepaalt {focus} in de mapping.
 */
export const INIT_SYSEX = [0xf0, 0x47, 0x7f, 0x29, 0x60, 0x00, 0x04, 0x42, 0x00, 0x00, 0x00, 0xf7];

export const GRID = { cols: 8, rows: 5, first: 0x00 };

/**
 * Grid-noot voor kolom 1..8 en rij 1..5, rij 1 bovenaan.
 *
 * De noten lopen van ONDER naar BOVEN: noot 0x00 is linksonder, 0x27 is
 * rechtsboven. De bovenste rij is dus 0x20-0x27, niet 0x00-0x07. Reken hier
 * nooit `rij * 8 + kolom`: dat klopt alleen toevallig voor de middelste rij en
 * spiegelt de rest van het apparaat.
 */
export const gridNote = (col, row) => GRID.first + (GRID.rows - row) * GRID.cols + (col - 1);

/**
 * Velocity kiest de kleur van een RGB-LED. Volledige tabel uit het protocol
 * (p18-22); dit zijn de kleuren waar we iets aan hebben, met hun echte hex.
 */
export const PALETTE = {
  uit: 0, donkergrijs: 1, grijs: 2, wit: 3,
  rood: 5, roodzacht: 4, rooddonker: 6,
  oranje: 9, oranjezacht: 8, oranjedonker: 10,
  geel: 13, geelzacht: 12, geeldonker: 14,
  limoen: 17, limoendonker: 18, groen: 21, groenzacht: 20, groendonker: 22,
  mint: 29, zeegroen: 33, zeegroendonker: 34,
  cyaan: 37, cyaanzacht: 36, cyaandonker: 38,
  blauw: 45, blauwzacht: 44, blauwdonker: 46, hemelsblauw: 41, hemelsblauwdonker: 42,
  violet: 49, violetzacht: 48, violetdonker: 50,
  magenta: 53, magentadonker: 54, roze: 57, rozedonker: 58,
};

/*
 * Kleurbetekenis (VRAGEN B4, Clay akkoord): uit = niets te doen, donkergrijs =
 * leeg maar bruikbaar, <kleur>donker (velocity n+1 na de volle, #59xxxx) =
 * gevuld/dicht, volle kleur = actief, rood = wissen (alleen met shift). De
 * "zacht"-varianten (n-1) zijn pastels en even FEL als de volle kleur: die
 * zijn geen gedimde stand, ook al lijkt de naam dat te zeggen.
 */

/**
 * De tweekleurige LED onder de crossfader A/B-knop: 0 = uit, 1 = geel,
 * 2-127 = oranje (protocol v1.2, "Bi-Color LED"). Geen palet, drie standen.
 */
export const BICOLOR = { uit: 0, geel: 1, oranje: 127 };

/** Hex per velocity, voor de paletproef en voor kleurkeuzes in de UI. */
export const PALETTE_HEX = {
  0: '#000000', 1: '#1E1E1E', 2: '#7F7F7F', 3: '#FFFFFF',
  4: '#FF4C4C', 5: '#FF0000', 6: '#590000', 7: '#190000',
  8: '#FFBD6C', 9: '#FF5400', 10: '#591D00', 11: '#271B00',
  12: '#FFFF4C', 13: '#FFFF00', 14: '#595900', 15: '#191900',
  16: '#88FF4C', 17: '#54FF00', 18: '#1D5900', 19: '#142B00',
  20: '#4CFF4C', 21: '#00FF00', 22: '#005900', 23: '#001900',
  24: '#4CFF5E', 25: '#00FF19', 26: '#00590D', 27: '#001902',
  28: '#4CFF88', 29: '#00FF55', 30: '#00591D', 31: '#001F12',
  32: '#4CFFB7', 33: '#00FF99', 34: '#005935', 35: '#001912',
  36: '#4CC3FF', 37: '#00A9FF', 38: '#004152', 39: '#001019',
  40: '#4C88FF', 41: '#0055FF', 42: '#001D59', 43: '#000819',
  44: '#4C4CFF', 45: '#0000FF', 46: '#000059', 47: '#000019',
  48: '#874CFF', 49: '#5400FF', 50: '#190064', 51: '#0F0030',
  52: '#FF4CFF', 53: '#FF00FF', 54: '#590059', 55: '#190019',
  56: '#FF4C87', 57: '#FF0054', 58: '#59001D', 59: '#220013',
};

/**
 * Het MIDI-kanaal kiest het GEDRAG van een RGB-LED, niet de kleur.
 * 0 = primaire kleur, 1-5 oneshot, 6-10 pulserend, 11-15 knipperend,
 * telkens van 1/24 tot 1/2 van de tempo-deling.
 */
export const BEHAVIOUR = {
  vast: 0,
  oneshot24: 1, oneshot16: 2, oneshot8: 3, oneshot4: 4, oneshot2: 5,
  puls24: 6, puls16: 7, puls8: 8, puls4: 9, puls2: 10,
  knipper24: 11, knipper16: 12, knipper8: 13, knipper4: 14, knipper2: 15,
};

/** Ring-standen voor de knop-LED-ringen. */
export const RING = { uit: 0, single: 1, volume: 2, pan: 3 };

/** LED-soort onder een control: rgb / single (aan-uit) / bicolor / null. */
const ctl = (sig, label, kind, led = null) => [sig, { sig, label, kind, led }];

function buildControls() {
  const out = new Map();

  // --- clip-grid, 8x5, noten 0x00-0x27, RGB ------------------------------
  for (let row = 1; row <= GRID.rows; row++) {
    for (let col = 1; col <= GRID.cols; col++) {
      out.set(...ctl(`note:0:${gridNote(col, row)}`, `pad ${col}/${row}`, 'pad', 'rgb'));
    }
  }

  // --- per trackstrip: noot 0x30-0x34, kanaal 0-7 = track 1-8 ------------
  const strip = [
    [0x30, 'record arm', 'single'],
    [0x31, 'solo', 'single'],
    [0x32, 'activator', 'single'],
    [0x33, 'track select', 'single'],
    [0x34, 'clip stop', 'single'],
    [0x42, 'crossfader A/B', 'bicolor'],
  ];
  for (let ch = 0; ch < 8; ch++) {
    for (const [n, naam, led] of strip) out.set(...ctl(`note:${ch}:${n}`, `${naam} ${ch + 1}`, 'button', led));
    out.set(...ctl(`cc:${ch}:7`, `fader ${ch + 1}`, 'fader'));
  }

  // --- device-sectie ------------------------------------------------------
  // In generic mode (mode 0) horen deze knoppen bij de geselecteerde
  // trackstrip en komen ze binnen op kanaal 0-7, of 8 voor master. In Ableton
  // Live mode zijn ze niet gebankt en komen ze op kanaal 0. Daarom alle negen.
  const gebankt = [
    [0x3a, 'device left'], [0x3b, 'device right'],
    [0x3c, 'bank left'],   [0x3d, 'bank right'],
    [0x3e, 'device on/off'], [0x3f, 'device lock'],
    [0x40, 'clip/device view'], [0x41, 'detail view'],
    [0x67, 'bank lock'],
  ];
  for (let ch = 0; ch <= 8; ch++) {
    for (const [n, naam] of gebankt) out.set(...ctl(`note:${ch}:${n}`, naam, 'button', 'single'));
  }

  const knoppen = [
    [0x50, 'master', 'single'], [0x51, 'stop all clips', null],
    [0x57, 'pan', 'single'], [0x58, 'sends', 'single'], [0x59, 'user', 'single'],
    [0x5a, 'metronome', 'single'], [0x5b, 'play', 'single'], [0x5d, 'record', 'single'],
    [0x5e, 'up', null], [0x5f, 'down', null], [0x60, 'right', null], [0x61, 'left', null],
    [0x62, 'shift', null], [0x63, 'tap tempo', null],
    [0x64, 'nudge -', null], [0x65, 'nudge +', null],
    [0x66, 'session record', 'single'],
  ];
  for (const [n, naam, led] of knoppen) out.set(...ctl(`note:0:${n}`, naam, 'button', led));

  for (let i = 1; i <= 5; i++) out.set(...ctl(`note:0:${0x51 + i}`, `scene launch ${i}`, 'button', 'rgb'));

  // --- knoppen en faders --------------------------------------------------
  // Device knobs melden in mode 0 via het KANAAL bij welke trackstrip ze horen
  // (0-7 = track 1-8, 8 = master). Vandaar alle negen kanalen.
  for (let ch = 0; ch <= 8; ch++) {
    for (let i = 0; i < 8; i++) {
      out.set(...ctl(`cc:${ch}:${0x10 + i}`, `device knob ${i + 1}`, 'knob'));
      out.set(...ctl(`cc:${ch}:${0x18 + i}`, `ring device ${i + 1}`, 'ring'));
    }
  }
  for (let i = 0; i < 8; i++) {
    out.set(...ctl(`cc:0:${0x30 + i}`, `track knob ${i + 1}`, 'knob'));
    out.set(...ctl(`cc:0:${0x38 + i}`, `ring track ${i + 1}`, 'ring'));
  }
  out.set(...ctl('cc:0:13', 'tempo', 'encoder'));
  out.set(...ctl('cc:0:14', 'master fader', 'fader'));
  out.set(...ctl('cc:0:15', 'crossfader', 'fader'));
  out.set(...ctl('cc:0:47', 'cue level', 'encoder'));
  out.set(...ctl('cc:0:64', 'footswitch', 'button'));

  return out;
}

export const apc40mk2 = {
  id: 'apc40mk2',
  name: 'APC40 mkII',
  match: /apc40/i,
  init: INIT_SYSEX,
  needsSysex: true,
  grid: GRID,
  gridNote,
  palette: PALETTE,
  bicolor: BICOLOR,
  /*
   * Echofilter in de hub (midi.js): een bericht dat identiek terugkomt binnen
   * 60 ms na wat wij stuurden, wordt genegeerd. Voor 0x42 NIET bewezen nodig
   * (het protocol zegt nergens dat de APC ringwaarden terugmeldt), maar ook
   * niet bewezen overbodig. Blijft aan tot de monitor het uitwijst: zegt
   * hub.status().echoes na een sessie draaien nog steeds 0, dan mag dit false.
   */
  echoFilter: true,
  paletteHex: PALETTE_HEX,
  behaviour: BEHAVIOUR,
  ring: RING,
  controls: buildControls(),
  label(sig) { return this.controls.get(sig)?.label ?? null; },

  /**
   * De LED-ring die bij een knop hoort. Beide knoppenbanken liggen acht
   * nummers onder hun ring: device knob 0x10 -> ring 0x18, track knob 0x30 ->
   * ring 0x38. Waar die ring zit is apparaatkennis en hoort dus hier.
   */
  /**
   * Elke LED op het apparaat, ontdubbeld, als uitgaande signature.
   *
   * Nodig om het oppervlak schoon over te nemen: wat wij niet aansturen blijft
   * anders branden met wat de vorige gebruiker erop achterliet. Noten onder
   * 0x30 zijn het grid, 0x30-0x34 en 0x42 zitten per trackstrip op hun eigen
   * kanaal, en al het andere negeert het kanaal — dat sturen we dus één keer.
   */
  allLeds() {
    const uit = [];
    const perStrip = new Set([0x30, 0x31, 0x32, 0x33, 0x34, 0x42]);
    const gezien = new Set();
    for (const [sig, c] of this.controls) {
      if (!c.led) continue;
      const m = /^note:(\d+):(\d+)$/.exec(sig);
      if (!m) continue;
      const ch = +m[1], n = +m[2];
      const key = (n < 0x30 || perStrip.has(n)) ? sig : `note:0:${n}`;
      if (gezien.has(key)) continue;
      gezien.add(key);
      uit.push(key);
    }
    return uit;
  },

  ringFor(sig) {
    const m = /^cc:(\d+|\*):(\d+)$/.exec(sig);
    if (!m) return null;
    const n = +m[2];
    const inBank = (n >= 0x10 && n <= 0x17) || (n >= 0x30 && n <= 0x37);
    return inBank ? `cc:${m[1]}:${n + 8}` : null;
  },
};

export default apc40mk2;
