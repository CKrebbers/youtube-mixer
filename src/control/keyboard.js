import { invoke, trackVanDeck } from './actions.js';

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
  const vul = (id) => id.replace(/\{([LR])\}/, (m, v) => trackVanDeck(venster(v)));

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

    const actie = toetsActie(e.code, e.shiftKey);
    if (!actie) return;
    e.preventDefault();
    if (held.has(e.code)) return;      // geen auto-repeat op triggers
    // Onthoud wat er echt ingedrukt is (met shift de shift-variant): loslaten
    // gaat naar dezelfde action, ook als shift intussen los is.
    const id = vul(actie);
    held.set(e.code, id);
    if (invoke(id, true) && MELD_NA[id]) engine.emit('melding', { tekst: MELD_NA[id](engine), soort: 'info' });
  });

  window.addEventListener('keyup', (e) => {
    const id = held.get(e.code);
    held.delete(e.code);
    if (id) invoke(id, false);
  });

  // Onder Cmd, bij Cmd+Tab of als het venster zijn focus verliest komt er
  // geen keyup. Dan bleef de toets in `held` hangen: hij deed daarna niets
  // meer, en wat hij vasthield werd nooit losgelaten. Dus alles loslaten.
  const laatAllesLos = () => {
    const ingedrukt = [...held.values()];
    held.clear();
    for (const id of ingedrukt) invoke(id, false);
  };
  window.addEventListener('blur', laatAllesLos);
  const pagina = globalThis.document;
  pagina?.addEventListener('visibilitychange', () => {
    if (pagina.visibilityState === 'hidden') laatAllesLos();
  });
}
