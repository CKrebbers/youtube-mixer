// Hulp voor de control-tests (geen test zelf): nepklok met timers, nep-MIDI
// (MIDIAccess zoals Chrome hem geeft), en de acties die er zijn of deze week komen.
import { Bus } from '../src/kern/bus.js';

/**
 * De acties van v2 met hun soort: wat er nu op de bus staat (src/engine/acties.js)
 * en wat er deze week bij komt (plak 2/3). De standaardindeling mag alleen naar
 * deze namen wijzen. Bij twee soorten ('trigger|waarde') is het nog niet beslist;
 * de indeling gebruikt daar 'schakelaar', dat met allebei werkt.
 */
const K8 = [1, 2, 3, 4, 5, 6, 7, 8];
// De opstelling en de partituur (engine/acties-opstelling.js, 29 okt): uitgeschreven, want {n} is hier een track.
const OPSTELLING = {
  'opstelling.start': 'trigger', 'opstelling.morph': 'waarde', 'opstelling.loop': 'trigger', 'avond.lopen': 'trigger', 'avond.volgende': 'trigger',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => i + 1).flatMap((k) => [
    [`opstelling.macro.${k}`, 'waarde'], [`opstelling.stop.${k}`, 'trigger'], [`opstelling.b.${k}`, 'trigger'], [`opstelling.glij.${k}`, 'trigger'],
    ...[1, 2, 3, 4, 5].map((r) => [`opstelling.variant.${k}.${r}`, 'trigger']),
  ])),
  ...Object.fromEntries([1, 2, 3, 4, 5].map((r) => [`opstelling.rij.${r}`, 'trigger'])),
};

export const BEKEND = Object.freeze({
  ...OPSTELLING,
  // bestaand
  'track.{n}.play': 'trigger', 'track.{n}.play.quant': 'trigger', 'track.{n}.cue': 'trigger',
  'track.{n}.sync': 'trigger', 'track.{n}.sync.klok': 'trigger', 'track.{n}.pitch': 'waarde',
  'track.{n}.jog': 'waarde', 'track.{n}.nudge.voor': 'trigger', 'track.{n}.nudge.terug': 'trigger',
  'track.{n}.trim': 'waarde', 'track.{n}.laag': 'waarde', 'track.{n}.mid': 'waarde', 'track.{n}.hoog': 'waarde',
  'track.{n}.filter': 'waarde', 'track.{n}.fader': 'waarde',
  'track.{n}.kill.laag': 'trigger', 'track.{n}.kill.mid': 'trigger', 'track.{n}.kill.hoog': 'trigger',
  'track.{n}.kant': 'trigger', 'track.{n}.seek': 'waarde',
  'klok.tempo': 'waarde', 'klok.tempo.op': 'trigger', 'klok.tempo.neer': 'trigger',
  'klok.tempo.op.grof': 'trigger', 'klok.tempo.neer.grof': 'trigger', 'klok.tap': 'trigger', 'klok.stop': 'trigger',
  'mixer.xfader': 'waarde', 'mixer.master': 'waarde',
  'track.{n}.laad': 'commando',
  // komt
  ...Object.fromEntries(K8.map((k) => [`track.{n}.fx.knop.${k}`, 'waarde'])),
  'track.{n}.fx.mix': 'waarde', 'track.{n}.fx.aan': 'trigger|waarde',
  'track.{n}.fx.volgend': 'trigger', 'track.{n}.fx.vorig': 'trigger',
  'track.{n}.send.a': 'waarde', 'track.{n}.send.b': 'waarde',
  ...Object.fromEntries(K8.map((k) => [`send.a.knop.${k}`, 'waarde'])),
  ...Object.fromEntries(K8.map((k) => [`send.b.knop.${k}`, 'waarde'])),
  ...Object.fromEntries(K8.map((k) => [`track.{n}.hotcue.${k}`, 'trigger'])),
  ...Object.fromEntries(K8.map((k) => [`track.{n}.hotcue.${k}.wis`, 'trigger'])),
  'track.{n}.loop': 'trigger', 'track.{n}.loop.halveer': 'trigger', 'track.{n}.loop.verdubbel': 'trigger',
  'track.{n}.beatjump.voor': 'trigger', 'track.{n}.beatjump.terug': 'trigger',
  'track.{n}.pfl': 'trigger|waarde',
  'koptelefoon.volume': 'waarde', 'koptelefoon.mix': 'waarde',
  'track.{n}.focus': 'trigger', 'opname': 'trigger',
  'library.volgende': 'trigger', 'library.vorige': 'trigger', 'library.laad': 'trigger',
  ...Object.fromEntries(['vocals', 'inst', 'drums', 'bass', 'other'].flatMap((s) => [
    [`track.{n}.stem.${s}`, 'waarde'], [`track.{n}.stem.${s}.kill`, 'trigger'], [`track.{n}.stem.${s}.kill.hold`, 'trigger']])),
  ...Object.fromEntries([1, 2, 3, 4, 5].map((k) => [`track.{n}.patroon.${k}`, 'trigger'])),
  'patronen.stop': 'trigger',
  ...Object.fromEntries(['intensiteit', 'snelheid', 'helderheid', 'feedback', 'tint', 'dichtheid', 'glitch', 'balans'].map((n) => [`beeld.macro.${n}`, 'waarde'])),
});

/** Het sjabloon van een concrete id: 'track.3.fader' -> 'track.{n}.fader'. */
export const sjabloonVan = (id) => id.replace(/^track\.\d+\./, 'track.{n}.');

/**
 * Een bus met elke bekende actie: waarden worden bewaard (lees geeft ze terug),
 * elke doe komt in `log` als [id, v, bron]. Een 'trigger|waarde' wordt hier een
 * trigger die omschakelt (zoals sync en kill nu). Begin-standen in `stand`.
 */
export function maakBus({ alleen = null, stand = {} } = {}) {
  const bus = new Bus();
  const log = [];
  const waarden = new Map(Object.entries(stand));
  for (const [id, soortTekst] of Object.entries(BEKEND)) {
    if (alleen && !alleen.includes(id)) continue;
    const soort = soortTekst.split('|')[0];
    const sleutel = (n) => (n === null ? id : id.replace('{n}', n));
    bus.defineer({
      id, soort,
      doe: (v, n, { bron }) => {
        const k = sleutel(n);
        log.push([k, v, bron]);
        if (soort === 'waarde') waarden.set(k, v);
        else if (soort === 'trigger' && v && soortTekst.includes('waarde')) waarden.set(k, waarden.get(k) ? 0 : 1);
      },
      lees: (n) => (waarden.has(sleutel(n)) ? waarden.get(sleutel(n)) : (soort === 'waarde' ? 0.5 : null)),
    });
  }
  return { bus, log, waarden };
}

/** Een klok in ms met eigen timers: `loop(ms)` laat de tijd lopen en draait wat aan de beurt is, op volgorde. */
export class NepKlok {
  constructor() { this.t = 0; this._taken = []; this._id = 1; this.nu = () => this.t; }
  get timers() {
    return {
      setTimeout: (f, ms) => this._zet(f, ms, 0), clearTimeout: (id) => this._wis(id),
      setInterval: (f, ms) => this._zet(f, ms, ms), clearInterval: (id) => this._wis(id),
    };
  }
  _zet(f, ms, herhaal) { const id = this._id++; this._taken.push({ id, t: this.t + Math.max(0, ms), f, herhaal }); return id; }
  _wis(id) { this._taken = this._taken.filter((x) => x.id !== id); }
  loop(ms) {
    const eind = this.t + ms;
    for (;;) {
      this._taken.sort((a, b) => a.t - b.t || a.id - b.id);
      const v = this._taken[0];
      if (!v || v.t > eind) break;
      this.t = Math.max(this.t, v.t);
      if (v.herhaal) v.t += v.herhaal; else this._taken.shift();
      v.f();
    }
    this.t = eind;
  }
}

/** Een poort zoals Chrome hem geeft: name, id, state, en onmidimessage (in) of send (uit). */
export function nepIn(id, name, state = 'connected') {
  return {
    id, name, state, type: 'input', onmidimessage: null,
    /** De controller stuurt iets. */
    stuur(bytes, timeStamp = 0) { this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp }); },
  };
}
export function nepUit(id, name, klok = null, state = 'connected') {
  return {
    id, name, state, type: 'output', ontvangen: [],
    send(bytes) { this.ontvangen.push({ t: klok ? klok.nu() : 0, bytes: [...bytes] }); },
  };
}

/** MIDIAccess: inputs/outputs als Map, onstatechange, en `zetState` om een kabel los te trekken. */
export function nepToegang({ ins = [], uits = [], sysex = true } = {}) {
  const t = {
    inputs: new Map(ins.map((p) => [p.id, p])),
    outputs: new Map(uits.map((p) => [p.id, p])),
    sysexEnabled: sysex,
    onstatechange: null,
    zetState(state, ...ids) {
      for (const id of ids) { const p = t.inputs.get(id) ?? t.outputs.get(id); if (p) p.state = state; }
      t.onstatechange?.({});
    },
  };
  return t;
}

/** De nep-APC: één ingang en één uitgang met de naam van het echte apparaat. */
export function nepApc(klok) {
  const i = nepIn('apc-in', 'APC40 mkII');
  const o = nepUit('apc-uit', 'APC40 mkII', klok);
  return { i, o, toegang: nepToegang({ ins: [i], uits: [o] }) };
}

/** Grootste aantal berichten in een venster van `ms` (schuivend), uit [{ t }]. */
export function maxInVenster(lijst, ms) {
  let max = 0;
  for (let a = 0, b = 0; b < lijst.length; b++) {
    while (lijst[b].t - lijst[a].t >= ms) a++;
    max = Math.max(max, b - a + 1);
  }
  return max;
}
