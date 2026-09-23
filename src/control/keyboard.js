import { invoke } from './actions.js';

/**
 * Toetsenbord is gewoon de eerste controller. Dezelfde mapping-vorm als MIDI
 * straks: een tabel van fysieke input -> action-id. Niets meer.
 */
export const KEYMAP = {
  // deck A
  KeyQ: 'deck.A.play',      KeyW: 'deck.A.cue',
  KeyA: 'deck.A.hotcue.1',  KeyS: 'deck.A.hotcue.2',
  KeyD: 'deck.A.hotcue.3',  KeyF: 'deck.A.hotcue.4',
  Digit1: 'deck.A.loop.1',  Digit2: 'deck.A.loop.2',
  Digit3: 'deck.A.loop.4',  Digit4: 'deck.A.loop.8',
  Digit5: 'deck.A.loop.exit',
  KeyZ: 'deck.A.nudge.back', KeyX: 'deck.A.nudge.fwd',
  KeyE: 'deck.A.focus',

  // deck B
  KeyP: 'deck.B.play',       KeyO: 'deck.B.cue',
  KeyJ: 'deck.B.hotcue.1',   KeyK: 'deck.B.hotcue.2',
  KeyL: 'deck.B.hotcue.3',   Semicolon: 'deck.B.hotcue.4',
  Digit7: 'deck.B.loop.1',   Digit8: 'deck.B.loop.2',
  Digit9: 'deck.B.loop.4',   Digit0: 'deck.B.loop.8',
  Minus:  'deck.B.loop.exit',
  Comma: 'deck.B.nudge.back', Period: 'deck.B.nudge.fwd',
  KeyI: 'deck.B.focus',
};

/** Shift + hotcue wist die hotcue. Ingebouwde modifier, geen aparte tabel. */
const SHIFT_ALIAS = (id) => id.includes('.hotcue.') ? `${id}.delete` : id;

export function attachKeyboard(engine, opts = {}) {
  const held = new Set();

  const xfadeStep = (dir) => engine.setXfader(engine.xfader + dir * 0.05);

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;

    if (e.code === 'BracketLeft')  { xfadeStep(-1); e.preventDefault(); return; }
    if (e.code === 'BracketRight') { xfadeStep(1);  e.preventDefault(); return; }
    if (e.code === 'Space')        { invoke(`deck.${engine.focus}.play`, true); e.preventDefault(); return; }
    if (e.code === 'Slash')        { opts.onHelp?.(); e.preventDefault(); return; }

    const id = KEYMAP[e.code];
    if (!id) return;
    e.preventDefault();
    if (held.has(e.code)) return;      // geen auto-repeat op triggers
    held.add(e.code);
    invoke(e.shiftKey ? SHIFT_ALIAS(id) : id, true);
  });

  window.addEventListener('keyup', (e) => {
    held.delete(e.code);
    const id = KEYMAP[e.code];
    if (id) invoke(id, false);
  });
}
