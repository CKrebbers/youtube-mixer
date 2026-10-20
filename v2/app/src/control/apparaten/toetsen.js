/**
 * Het toetsenbord als apparaat: dezelfde vorm als de APC, zodat dezelfde
 * indeling-module (indeling.js) en hetzelfde leren erop werken.
 *
 * Een control is de FYSIEKE toets: KeyboardEvent.code ('KeyQ', 'Digit1',
 * 'ArrowUp'), niet het teken. Dan hangt de indeling niet af van qwerty of azerty.
 * v1 vertaalde dat naar HID-nummers omdat zijn mapping alleen 'type:kanaal:nummer'
 * kende; in v2 is de control-id gewoon een naam.
 *
 * Elke toets is een knop: alleen trigger en schakelaar. Shift is de shifttoets
 * van het toetsenbord (e.shiftKey), geen control.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `Key${l}`);
const CIJFERS = '0123456789'.split('').map((c) => `Digit${c}`);
const OVERIG = [
  'Space', 'Enter', 'Backspace', 'Tab', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
  'Semicolon', 'Quote', 'Backquote', 'IntlBackslash', 'Comma', 'Period', 'Slash',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Delete',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter',
];

/** Toetsen die bij de browser horen en nooit iets in de mixer doen. */
export const NOOIT = Object.freeze(['Escape', 'Tab', 'F5', 'F11', 'F12']);

const LABEL = {
  Space: 'spatie', Enter: 'enter', Backspace: '⌫', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', IntlBackslash: '§', Comma: ',', Period: '.',
  Slash: '/', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
const labelVan = (code) => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return LABEL[code] ?? code;
};

const controls = new Map();
for (const code of [...LETTERS, ...CIJFERS, ...OVERIG]) {
  if (NOOIT.includes(code)) continue;
  controls.set(code, Object.freeze({ id: code, soort: 'knop', led: 'geen', label: `toets ${labelVan(code)}` }));
}

export const toetsen = Object.freeze({
  id: 'toetsen',
  naam: 'Toetsenbord',
  kolommen: 8,
  shift: null,
  controls,
  gedragVoor: Object.freeze({ knop: ['trigger', 'schakelaar'] }),
  label: (id) => controls.get(id)?.label ?? null,
});

export default toetsen;
