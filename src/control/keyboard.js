import { invoke, trackVanDeck } from './actions.js';

/**
 * Toetsenbord is gewoon de eerste controller. Dezelfde mapping-vorm als MIDI
 * straks: een tabel van fysieke input -> action-id. Niets meer.
 *
 * `{L}` en `{R}` zijn de tracks in het linker- en rechtervenster. De handen
 * bedienen wat je ziet; zet je track 5 links, dan is Q play op track 5.
 */
export const KEYMAP = {
  // linkervenster
  KeyQ: 'track.{L}.play',      KeyW: 'track.{L}.cue',
  KeyA: 'track.{L}.hotcue.1',  KeyS: 'track.{L}.hotcue.2',
  KeyD: 'track.{L}.hotcue.3',  KeyF: 'track.{L}.hotcue.4',
  Digit1: 'track.{L}.loop.1',  Digit2: 'track.{L}.loop.2',
  Digit3: 'track.{L}.loop.4',  Digit4: 'track.{L}.loop.8',
  Digit5: 'track.{L}.loop.exit',
  KeyZ: 'track.{L}.nudge.back', KeyX: 'track.{L}.nudge.fwd',
  KeyE: 'track.{L}.focus',

  // rechtervenster
  KeyP: 'track.{R}.play',       KeyO: 'track.{R}.cue',
  KeyJ: 'track.{R}.hotcue.1',   KeyK: 'track.{R}.hotcue.2',
  KeyL: 'track.{R}.hotcue.3',   Semicolon: 'track.{R}.hotcue.4',
  Digit7: 'track.{R}.loop.1',   Digit8: 'track.{R}.loop.2',
  Digit9: 'track.{R}.loop.4',   Digit0: 'track.{R}.loop.8',
  Minus:  'track.{R}.loop.exit',
  Comma: 'track.{R}.nudge.back', Period: 'track.{R}.nudge.fwd',
  KeyI: 'track.{R}.focus',
};

/** Shift + hotcue wist die hotcue. Ingebouwde modifier, geen aparte tabel. */
const SHIFT_ALIAS = (id) => id.includes('.hotcue.') ? `${id}.delete` : id;

/**
 * @param opts.venster  (v: 'L'|'R') -> deck-id dat daar nu staat. Zonder:
 *                      links track 1, rechts track 2.
 */
export function attachKeyboard(engine, opts = {}) {
  // Per toets de action die bij het INDRUKKEN gold: loslaten moet daar
  // terechtkomen, ook als het venster intussen een andere track toont.
  const held = new Map();
  const venster = opts.venster || ((v) => (v === 'L' ? 'A' : 'B'));
  const vul = (id) => id.replace(/\{([LR])\}/, (m, v) => trackVanDeck(venster(v)));

  const xfadeStep = (dir) => engine.setXfader(engine.xfader + dir * 0.05);

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;

    if (e.code === 'BracketLeft')  { xfadeStep(-1); e.preventDefault(); return; }
    if (e.code === 'BracketRight') { xfadeStep(1);  e.preventDefault(); return; }
    if (e.code === 'Space')        { invoke(`track.${trackVanDeck(engine.focus)}.play`, true); e.preventDefault(); return; }
    if (e.code === 'Slash')        { opts.onHelp?.(); e.preventDefault(); return; }

    if (!KEYMAP[e.code]) return;
    e.preventDefault();
    if (held.has(e.code)) return;      // geen auto-repeat op triggers
    const id = vul(KEYMAP[e.code]);
    held.set(e.code, id);
    invoke(e.shiftKey ? SHIFT_ALIAS(id) : id, true);
  });

  window.addEventListener('keyup', (e) => {
    const id = held.get(e.code);
    held.delete(e.code);
    if (id) invoke(id, false);
  });
}
