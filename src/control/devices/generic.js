/**
 * Leeg profiel voor onbekende controllers: geen namen, geen LED's, geen init.
 * Alles werkt nog steeds — je maakt je mapping dan met MIDI-learn.
 */
export const generic = {
  id: 'generic',
  name: 'Onbekende controller',
  match: /.*/,
  init: null,
  needsSysex: false,
  grid: null,
  palette: {},
  behaviour: {},
  ring: {},
  controls: new Map(),
  label() { return null; },
  ringFor() { return null; },
  allLeds() { return []; },
};

export default generic;
