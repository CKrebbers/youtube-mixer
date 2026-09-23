import { invoke } from './actions.js';

/**
 * Toetsenbord is gewoon de eerste controller. Dezelfde mapping-vorm als MIDI
 * straks: een tabel van fysieke input -> action-id. Niets meer.
 */
export const KEYMAP = {
  // deck A
  KeyQ: 'track.1.play',      KeyW: 'track.1.cue',
  KeyA: 'track.1.hotcue.1',  KeyS: 'track.1.hotcue.2',
  KeyD: 'track.1.hotcue.3',  KeyF: 'track.1.hotcue.4',
  Digit1: 'track.1.loop.1',  Digit2: 'track.1.loop.2',
  Digit3: 'track.1.loop.4',  Digit4: 'track.1.loop.8',
  Digit5: 'track.1.loop.exit',
  KeyZ: 'track.1.nudge.back', KeyX: 'track.1.nudge.fwd',
  KeyE: 'track.1.focus',

  // deck B
  KeyP: 'track.2.play',       KeyO: 'track.2.cue',
  KeyJ: 'track.2.hotcue.1',   KeyK: 'track.2.hotcue.2',
  KeyL: 'track.2.hotcue.3',   Semicolon: 'track.2.hotcue.4',
  Digit7: 'track.2.loop.1',   Digit8: 'track.2.loop.2',
  Digit9: 'track.2.loop.4',   Digit0: 'track.2.loop.8',
  Minus:  'track.2.loop.exit',
  Comma: 'track.2.nudge.back', Period: 'track.2.nudge.fwd',
  KeyI: 'track.2.focus',
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
