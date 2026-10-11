// Het action-register zonder mixer: alle bind*-functies van src/control/actions.js
// op dubbels (geen audio, geen DOM, geen MIDI), zoals test/mapping.test.mjs dat
// doet, maar met alle acht tracks en alle onderdelen. Alleen de NAMEN tellen hier
// (welke actions er zijn), niet wat ze doen. Gebruikt door tools/handen/handenkaart.mjs
// en test/handen.test.mjs; src/handen/kaart.js krijgt alleen de lijst.
import * as A from '../../src/control/actions.js';
import { DECK_IDS } from '../../src/engine/engine.js';
import { Lagen, voegVormMapjeToe } from '../../src/control/lagen.js';

const niets = () => {};
const uitzetter = () => niets;

function dubbeldeck(id) {
  return {
    id, playing: false, position: 0, cuePoint: 0, duration: 10, rate: 1, buffer: {},
    hotcues: [null, null, null, null], loop: null,
    ui: { trim: 0.5, low: 0.5, mid: 0.5, high: 0.5, filter: 0.5, fader: 1 },
    togglePlay: niets, cue: niets, hotcue: niets, setLoop: niets, clearLoop: niets, halveLoop: niets,
    doubleLoop: niets, nudge: niets, seek: niets, setRate: niets, set: niets, on: uitzetter,
  };
}

let gebouwd = null;

/**
 * Bouw het register één keer (het is een module-singleton in actions.js) en geef
 * `{ ids, fouten }`: alle action-ids, en per bind-functie die niet wilde (dan
 * ontbreken die actions, en zegt de kaart dat).
 */
export function bouwRegister() {
  if (gebouwd) return gebouwd;
  const decks = Object.fromEntries(DECK_IDS.map((d) => [d, dubbeldeck(d)]));
  const engine = {
    decks, focus: DECK_IDS[0], xfader: 0.5, masterLevel: 0.8, xfaderCurve: 'smooth',
    deck(id) { return this.decks[id]; }, ander(id) { return this.decks[id === 'A' ? 'B' : 'A']; },
    setFocus: niets, setXfader: niets, setMaster: niets, setXfaderCurve: niets, on: uitzetter,
    sampler: { pads: [], herinneringen: [], tellen: 4, volume: 0.8 },
    // Met een klankschaal bestaan ook de klankschaal.*-actions (bindEngine kijkt of hij er is).
    klankschaal: { klinkt: () => false },
    sends: Object.fromEntries(DECK_IDS.map((d) => [d, { setPlek: niets, leesPlek: () => 0 }])),
  };
  const laag = { zetKnop: niets, leesKnop: () => 0, dekking: 1, aan: true };
  const fouten = [];
  const probeer = (naam, f) => { try { f(); } catch (e) { fouten.push(`${naam}: ${e.message}`); } };
  probeer('bindEngine', () => A.bindEngine(engine));
  probeer('bindPatronen', () => A.bindPatronen(engine));
  probeer('bindVideo', () => A.bindVideo({ fx: {}, modus: 'mix', puls: 0, pulsDoel: 'rgb', zetFx: niets, volgendeModus: niets, zetPuls: niets, volgendPulsDoel: niets }));
  probeer('bindVormen', () => A.bindVormen({ laag, lagen: [laag, laag, laag, laag], gekozen: 0, zetDekking: niets, wisselAan: niets,
    stapSysteem: niets, volgendeMengvorm: niets, kies: niets }, { zetSterkte: niets, route: () => ({ sterkte: 0 }), volgendeBron: niets, volgendDoel: niets }));
  probeer('bindApp', () => A.bindApp({ toon: niets, venster: () => ({ L: 'A', R: 'B' }), opnemer: {}, opnameStart: niets, opnameStop: niets, opnameSoort: niets, rackStap: niets }));
  probeer('bindLibrary', () => A.bindLibrary({ open: false, toggle: niets, kies: niets, laadGekozen: niets }));
  probeer('bindLog', () => A.bindLog({ log: {}, wissel: niets, terugspeler: {} }));
  probeer('bindAuto', () => A.bindAuto({ aan: false, fase: 'uit', volgende: null, zetAan: niets, ok: niets, overslaan: niets, langer: niets, nu: niets }));
  // Het mapje vorm (Detail View, alleen met ?vormen=1) bestaat pas na voegVormMapjeToe(), zoals in mapping.test.
  probeer('bindLagen', () => { voegVormMapjeToe(); A.bindLagen(new Lagen()); });
  probeer('bindBeeld', () => A.bindBeeld({ zetWaarde: niets, waarde: () => null, druk: niets, knopStand: () => null }));
  gebouwd = { ids: A.list().map((a) => a.id), fouten };
  return gebouwd;
}
