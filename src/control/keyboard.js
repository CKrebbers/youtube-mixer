import { invoke, read, trackVanDeck } from './actions.js';
import { Mapping, resolveTarget, MAPPING_VERSIE } from './mapping.js';
import { MidiLearn } from './midi-learn.js';

/**
 * Toetsenbord is gewoon de eerste controller. Dezelfde mapping-vorm als MIDI
 * straks: een tabel van fysieke input -> action-id. Niets meer.
 *
 * `{L}` en `{R}` zijn de "vensters" van de schermlaag: L = de track met focus,
 * R = de track waar je daarvoor op zat (sinds het scherm de APC spiegelt, zie
 * src/ui/vensters.js). Geef je track 5 focus, dan is Q play op track 5 en P
 * play op de track waar je vandaan kwam. I zet de focus daarheen: wisselen.
 */
export const KEYMAP = {
  // linkerhand: de track met focus
  KeyQ: 'track.{L}.play',      KeyW: 'track.{L}.cue',
  // Rem op de toets links van 1. Op een ISO-toetsenbord (Mac) heet die per
  // browser Backquote of IntlBackslash; beide, dan werkt het overal.
  Backquote: 'track.{L}.brake', IntlBackslash: 'track.{L}.brake',
  KeyA: 'track.{L}.hotcue.1',  KeyS: 'track.{L}.hotcue.2',
  KeyD: 'track.{L}.hotcue.3',  KeyF: 'track.{L}.hotcue.4',
  Digit1: 'track.{L}.loop.1',  Digit2: 'track.{L}.loop.2',
  Digit3: 'track.{L}.loop.4',  Digit4: 'track.{L}.loop.8',
  Digit5: 'track.{L}.loop.exit',
  KeyZ: 'track.{L}.nudge.back', KeyX: 'track.{L}.nudge.fwd',
  KeyE: 'track.{L}.focus',
  KeyR: 'track.{L}.beatjump.back', KeyT: 'track.{L}.beatjump.fwd',
  KeyG: 'track.{L}.loop.in',       KeyC: 'track.{L}.loop.out',
  KeyV: 'track.{L}.keylock',

  // rechterhand: de vorige focus
  KeyP: 'track.{R}.play',       KeyO: 'track.{R}.cue',
  Equal: 'track.{R}.brake',
  KeyJ: 'track.{R}.hotcue.1',   KeyK: 'track.{R}.hotcue.2',
  KeyL: 'track.{R}.hotcue.3',   Semicolon: 'track.{R}.hotcue.4',
  Digit7: 'track.{R}.loop.1',   Digit8: 'track.{R}.loop.2',
  Digit9: 'track.{R}.loop.4',   Digit0: 'track.{R}.loop.8',
  Minus:  'track.{R}.loop.exit',
  Comma: 'track.{R}.nudge.back', Period: 'track.{R}.nudge.fwd',
  KeyI: 'track.{R}.focus',
  KeyY: 'track.{R}.beatjump.back', KeyU: 'track.{R}.beatjump.fwd',
  KeyH: 'track.{R}.loop.in',       KeyN: 'track.{R}.loop.out',
  KeyM: 'track.{R}.keylock',

  // midden: voor alle tracks
  Digit6: 'transport.quantize',
};

/**
 * Shift als ingebouwde modifier, per action: hotcue -> wissen, play ->
 * starten op de maat, beatjump terug/vooruit -> lengte halveren/verdubbelen,
 * loop in -> reloop/exit, nudge −/+ -> toon −1/+1 (zoals Shift + Nudge op de APC).
 * Wat per TOETS moet, staat in SHIFT_TOETS hieronder.
 */
const SHIFT_VARIANT = [
  [/\.nudge\.back$/, (id) => id.replace(/nudge\.back$/, 'transpose.down')],
  [/\.nudge\.fwd$/, (id) => id.replace(/nudge\.fwd$/, 'transpose.up')],
  [/\.hotcue\.\d+$/, (id) => `${id}.delete`],
  [/\.play$/, (id) => `${id}.quant`],
  [/\.beatjump\.back$/, (id) => id.replace(/back$/, 'halve')],
  [/\.beatjump\.fwd$/, (id) => id.replace(/fwd$/, 'double')],
  [/\.loop\.in$/, (id) => id.replace(/in$/, 'reloop')],
];
export const SHIFT_ALIAS = (id) => {
  const v = SHIFT_VARIANT.find(([re]) => re.test(id));
  return v ? v[1](id) : id;
};

/**
 * Shift per TOETS, vóór SHIFT_VARIANT: voor een toets waarvan de shift-variant
 * niet uit zijn eigen action volgt. Secties (docs/SECTIES.md): W en O zijn
 * allebei cue, maar shift+W is de vorige sectie links en shift+O de volgende
 * rechts (links naar rechts = terug naar vooruit, zoals R/T, Y/U en , / .).
 * Met shift deden deze vier eerst hetzelfde als zonder.
 */
export const SHIFT_TOETS = {
  KeyW: 'track.{L}.section.prev', KeyE: 'track.{L}.section.next',
  KeyI: 'track.{R}.section.prev', KeyO: 'track.{R}.section.next',
};

/** De action van een toets (met `{L}`/`{R}`), met of zonder shift; null = geen. */
export const toetsActie = (code, shift = false) => {
  const basis = KEYMAP[code];
  if (!basis) return null;
  return shift ? (SHIFT_TOETS[code] ?? SHIFT_ALIAS(basis)) : basis;
};

/*
 * HET TOETSENBORD ALS DATA (14 okt, werkruimte S5, docs/werkruimte/S5.md).
 *
 * Wat een toets doet staat in `mappings/toetsen.json`, als regels van een
 * gewone Mapping: dezelfde vorm als de APC, dus koppelen, je eigen verschil
 * (server `/api/mapping/toetsen`) en "standaard herstellen" werken zoals daar.
 * attachKeyboard voert die Mapping uit; KEYMAP en SHIFT_TOETS hierboven blijven
 * als de GOUDEN lijst (test/keyboard.test.mjs eist dat toetsen.json per toets,
 * met en zonder shift, precies dezelfde action geeft) en als beginstand tot
 * mappings/toetsen.json binnen is (een paar ms na het laden van de pagina).
 *
 * Signature `key:0:<n>`, n = de HID-gebruikscode van de fysieke toets (USB HID
 * Usage Tables, Keyboard/Keypad page 0x07; KeyboardEvent.code is óók de
 * fysieke toets, dus de nummering hangt niet van de toetsenbordindeling af).
 * Het label van de regel zegt welke toets het is. Waarom geen `key:<code>`:
 * mapping.js (van spoor S4) neemt alleen `type:kanaal:nummer` aan.
 *
 * `shift: true` op een regel = met de shifttoets ingedrukt, net als bij MIDI.
 * Variabelen: {focus} = de track in het linkervenster (L, de track met focus),
 * {tweede} = het rechtervenster (R, de vorige focus); {L} en {R} blijven als alias.
 *
 * Blijven CODE (schermgebaren, niet te koppelen): spatie, [ ], /, Esc, B
 * (library, onderpanelen.js) en Cmd+Z. Tijdens typen doet geen toets iets, en
 * alles met Cmd/Ctrl/Alt hoort bij de browser: allebei precies zoals vroeger.
 */

/** HID-gebruikscode (page 0x07) per KeyboardEvent.code. Alleen toetsen die iets kúnnen doen. */
export const HID = (() => {
  const t = {};
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l, i) => { t[`Key${l}`] = 4 + i; });
  '123456789'.split('').forEach((c, i) => { t[`Digit${c}`] = 30 + i; });
  t.Digit0 = 39;
  Object.assign(t, {
    Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
    Backslash: 49, IntlHash: 50, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56,
    Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
    ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
    NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, NumpadDecimal: 99,
    IntlBackslash: 100, NumpadEqual: 103, IntlRo: 135, IntlYen: 137,
  });
  for (let i = 1; i <= 12; i++) t[`F${i}`] = 57 + i;
  for (let i = 1; i <= 9; i++) t[`Numpad${i}`] = 88 + i;
  t.Numpad0 = 98;
  return Object.freeze(t);
})();
const CODE_VAN = new Map(Object.entries(HID).map(([c, n]) => [n, c]));
/** De signature van een toets (KeyboardEvent.code), of null als hij niet in de tabel staat. */
export const toetsSig = (code) => (code in HID ? `key:0:${HID[code]}` : null);
/** De code van een signature, of null. */
export const codeVanSig = (sig) => { const m = /^key:0:(\d+)$/.exec(sig || ''); return m ? CODE_VAN.get(Number(m[1])) ?? null : null; };

/** Wat er op een toets staat, voor labels en het koppelpaneel. */
export function toetsNaam(code) {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `num ${code.slice(6)}`;
  return ({ Backquote: '`', IntlBackslash: '§ (links van 1)', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Space: 'spatie', Escape: 'Esc',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' })[code] ?? code;
}

/** Toetsen die code blijven (schermgebaren): niet te koppelen, ook niet uit een eigen mapping. */
export const GEBAREN = Object.freeze(['Space', 'BracketLeft', 'BracketRight', 'Slash', 'Escape', 'KeyB']);

/** Het "apparaat" toetsenbord voor koppelpaneel en koppelmodus: alleen namen. */
export const TOETSEN_APPARAAT = Object.freeze({
  id: 'toetsen', name: 'Toetsenbord',
  label(sig) { const c = codeVanSig(sig); return c ? `toets ${toetsNaam(c)}` : null; },
});

const metNamen = (id) => id.replace(/\{L\}/g, '{focus}').replace(/\{R\}/g, '{tweede}');

/**
 * De standaard van het toetsenbord als document, uit KEYMAP en SHIFT_TOETS
 * (precies wat mappings/toetsen.json bevat; de test vergelijkt ze). Een
 * shift-regel alleen waar shift iets anders doet: zonder valt shift terug op de
 * gewone regel, zoals bij MIDI.
 */
export function toetsenStandaard() {
  const rules = [];
  for (const code of Object.keys(KEYMAP)) {
    const in_ = toetsSig(code), label = TOETSEN_APPARAAT.label(in_);
    const gewoon = toetsActie(code, false), metShift = toetsActie(code, true);
    rules.push({ in: in_, action: metNamen(gewoon), mode: 'trigger', label });
    if (metShift !== gewoon) rules.push({ in: in_, action: metNamen(metShift), mode: 'trigger', shift: true, label });
  }
  return { name: 'Toetsenbord — standaard', device: 'toetsen', version: MAPPING_VERSIE, rules };
}

/*
 * De Mapping van het toetsenbord van deze pagina (de laatste attachKeyboard),
 * en zijn MidiLearn. De aanhaker van spoor S5 (src/ui/aanhakers/apparaten.js)
 * laadt er mappings/toetsen.json + jouw verschil in en zet hem in het koppelpaneel.
 */
let huidig = null;
/** { mapping, learn } van het toetsenbord, of null vóór attachKeyboard. */
export const toetsenbord = () => huidig;

/**
 * Schakelaars voor de hele engine die je vanaf het toetsenbord omzet zonder
 * ernaar te kijken: wat de nieuwe stand is, komt even in de meldingstrook.
 * Quantize verandert stil hoe cue en hotcues landen; zonder melding merk je
 * dat pas bij de volgende hotcue.
 */
const MELD_NA = {
  'transport.quantize': (engine) => (engine.quantize
    ? 'quantize aan (alle tracks): cue, hotcues en loop in/out op de tel'
    : 'quantize uit (alle tracks): cue, hotcues en loop in/out precies waar je drukt'),
};

/**
 * @param opts.venster  (v: 'L'|'R') -> deck-id dat daar nu staat. Zonder:
 *                      links track 1, rechts track 2.
 */
/**
 * Is dit een veld waarin getypt wordt? Dan zijn letters letters, geen sneltoetsen.
 * Ook een getalveld (de latentie in de BEELD-rij): cijfers en min zijn anders loops.
 */
export const isTypen = (el) => !!el?.matches?.('input[type=text], input[type=search], input[type=url], input[type=number], input:not([type]), textarea, [contenteditable]');

export function attachKeyboard(engine, opts = {}) {
  // Per toets de action die bij het INDRUKKEN gold: loslaten moet daar
  // terechtkomen, ook als het venster intussen een andere track toont.
  const held = new Map();
  const venster = opts.venster || ((v) => (v === 'L' ? 'A' : 'B'));
  const vars = () => {
    const l = trackVanDeck(venster('L')), r = trackVanDeck(venster('R'));
    return { focus: l, tweede: r, L: l, R: r };
  };
  // De Mapping: meteen de standaard (dezelfde regels als mappings/toetsen.json),
  // zodat elke toets vanaf het eerste moment werkt; de aanhaker zet er daarna het
  // bestand en jouw verschil in. invoke/read gaan niet via de Mapping zelf: de
  // toets beslist hieronder (loslaten, geen herhaling), de Mapping zegt alleen WAT.
  const mapping = new Mapping({ read, invoke, vars });
  mapping.laadStandaard(toetsenStandaard());
  const learn = new MidiLearn({ mapping, device: TOETSEN_APPARAAT });
  huidig = { mapping, learn };
  const geslikt = new Set();   // toetsen die gekoppeld werden: hun keyup gaat nergens heen

  // Via de bus, net als elke andere bediening: dan volgen scherm en LED's vanzelf.
  const xfadeStep = (dir) => invoke('mixer.xfader', Math.max(0, Math.min(1, engine.xfader + dir * 0.05)));

  window.addEventListener('keydown', (e) => {
    // Alleen tijdens TYPEN geen sneltoetsen. Een fader of keuzemenu dat focus
    // kreeg door een klik, zette eerder álle toetsen stil tot je ergens
    // anders klikte.
    if (isTypen(e.target)) return;
    // Cmd+Z (Ctrl+Z): de laatste bewerking van het grid van de focus-track terug
    // (5 okt). Alle letters zijn al van de decks; dit is de toets die iedereen kent.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyZ') {
      const id = `track.${trackVanDeck(engine.focus)}.grid.undo`;
      invoke(id, true); invoke(id, false);
      e.preventDefault();
      return;
    }
    // Cmd/Ctrl/Alt horen bij de browser en het systeem (Cmd+W, Ctrl+Tab),
    // niet bij de decks. Shift wel: de shift-variant (toetsActie).
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.code === 'BracketLeft')  { xfadeStep(-1); e.preventDefault(); return; }
    if (e.code === 'BracketRight') { xfadeStep(1);  e.preventDefault(); return; }
    if (e.code === 'Space')        { invoke(`track.${trackVanDeck(engine.focus)}.play`, true); e.preventDefault(); return; }
    if (e.code === 'Slash')        { opts.onHelp?.(); e.preventDefault(); return; }

    const sig = toetsSig(e.code);
    if (!sig || GEBAREN.includes(e.code)) return;
    // Koppelen (koppelpaneel of koppelmodus met "toetsen" gekozen): deze toets
    // wordt de knop, hij doet nu niets. Shift vast = een shift-regel, zoals bij MIDI.
    if (learn.busy) {
      e.preventDefault();
      if (e.repeat || geslikt.has(e.code)) return;
      mapping.shift = e.shiftKey;
      try { learn.feed({ type: 'note', on: true, channel: 0, number: HID[e.code], value: 127, norm: 1, sig }); } finally { mapping.shift = false; }
      geslikt.add(e.code);
      return;
    }
    // Net gekoppeld en nog vast (auto-repeat): niets doen, zijn keyup gaat ook nergens heen.
    if (geslikt.has(e.code)) { e.preventDefault(); return; }
    const regel = mapping.kies(sig, { shift: e.shiftKey });
    // Een toets is een knop: alleen trigger-regels (een fader op een toets betekent niets).
    if (!regel || (regel.mode && regel.mode !== 'trigger')) return;
    e.preventDefault();
    if (held.has(e.code)) return;      // geen auto-repeat op triggers
    // Onthoud wat er echt ingedrukt is (met shift de shift-variant): loslaten
    // gaat naar dezelfde action, ook als shift intussen los is.
    const id = resolveTarget(regel.action, vars());
    held.set(e.code, id);
    if (invoke(id, true) && MELD_NA[id]) engine.emit('melding', { tekst: MELD_NA[id](engine), soort: 'info' });
  });

  window.addEventListener('keyup', (e) => {
    if (geslikt.delete(e.code)) return;
    const id = held.get(e.code);
    held.delete(e.code);
    if (id) invoke(id, false);
  });

  // Onder Cmd, bij Cmd+Tab of als het venster zijn focus verliest komt er
  // geen keyup. Dan bleef de toets in `held` hangen: hij deed daarna niets
  // meer, en wat hij vasthield werd nooit losgelaten. Dus alles loslaten.
  const laatAllesLos = () => {
    geslikt.clear();
    const ingedrukt = [...held.values()];
    held.clear();
    for (const id of ingedrukt) invoke(id, false);
  };
  window.addEventListener('blur', laatAllesLos);
  const pagina = globalThis.document;
  pagina?.addEventListener('visibilitychange', () => {
    if (pagina.visibilityState === 'hidden') laatAllesLos();
  });
  return huidig;
}
