import { Emitter } from '../lib/emitter.js';

/**
 * MIDI-learn: kies een action, beweeg een control, gekoppeld.
 *
 * Kent geen DOM en geen Web MIDI — hij krijgt geparseerde berichten gevoerd en
 * schrijft in de mapping. Daarmee is hij in Node te testen.
 *
 * Een noot is meteen duidelijk: indrukken is een trigger, klaar. Bij een CC
 * weet je het pas na een paar berichten: een fader loopt van 0 naar 127, maar
 * een relatieve encoder blijft rond 1 of rond 64 hangen. Daarom koppelt hij
 * direct bij het eerste bericht (zodat het meteen werkt) en scherpt hij de
 * modus aan zolang je blijft draaien.
 */

const VENSTER = 600;        // ms dat we blijven meekijken bij een CC
const MIN_VOOR_RELATIEF = 4; // minder berichten is te weinig bewijs

/**
 * Welke modus hoort bij deze reeks berichten van dezelfde control?
 * Bij twijfel absoluut — dat is de veilige gok, want soft-takeover vangt een
 * verkeerde gok op. Andersom zou een fader als encoder wegrennen.
 */
export function raadModus(berichten) {
  const eerste = berichten[0];
  if (!eerste) return 'trigger';
  if (eerste.type === 'note') return 'trigger';
  if (eerste.type !== 'cc') return 'absolute';

  const w = berichten.map((b) => b.value);
  if (berichten.length < MIN_VOOR_RELATIEF) return 'absolute';

  // Tweecomplement: alleen kleine stapjes net boven 0 of net onder 128.
  if (w.every((v) => (v >= 1 && v <= 8) || (v >= 120 && v <= 127))) return 'relative-2c';
  // Binary offset: alles blijft dicht bij het midden.
  if (w.every((v) => Math.abs(v - 64) <= 8) && new Set(w).size <= 6) return 'relative-bin';
  return 'absolute';
}

export class MidiLearn extends Emitter {
  constructor({ mapping, device, now = () => performance.now() }) {
    super();
    this.mapping = mapping;
    this.device = device;
    this.now = now;
    this.action = null;
    this.sig = null;
    this.buf = [];
    this.begin = 0;
  }

  get busy() { return this.action !== null; }

  /** Wachten op een control voor deze action. */
  start(action) {
    this.action = action;
    this.sig = null;
    this.buf = [];
    this.emit('armed', { action });
  }

  stop() {
    const was = this.action;
    this.action = null;
    this.sig = null;
    this.buf = [];
    if (was) this.emit('done', { action: was });
  }

  /**
   * Voer hier elk binnenkomend bericht in terwijl er geleerd wordt. De app moet
   * die berichten dan NIET ook door de mapping halen — anders verzet je tijdens
   * het koppelen je filter.
   */
  feed(msg) {
    if (!this.busy) return null;
    if (msg.channel < 0) return null;             // clock, sysex: niet koppelen

    if (this.sig !== msg.sig) {                   // ander control: opnieuw beginnen
      this.sig = msg.sig;
      this.buf = [];
      this.begin = this.now();
    }
    this.buf.push(msg);

    const mode = raadModus(this.buf);
    const label = this.device?.label?.(msg.sig) ?? undefined;
    // Wat hier NU geldt (met shift en het open mapje), niet zomaar de kale regel.
    const vorige = this.mapping.kies?.(msg.sig) ?? this.mapping.rules.get(msg.sig);
    const overschrijft = vorige && vorige.action !== this.action ? vorige.action : null;

    this.mapping.set(msg.sig, this.action, { mode, label });
    const uitslag = { sig: msg.sig, action: this.action, mode, label, overschrijft };
    this.emit('bound', uitslag);

    // Een noot is meteen klaar. Bij een CC blijven we even meekijken zodat een
    // encoder zich alsnog kan verraden.
    if (msg.type === 'note' || this.now() - this.begin > VENSTER) this.stop();
    return uitslag;
  }

  /** Koppeling(en) van een action weghalen. */
  vergeet(action) {
    const weg = this.mapping.forAction(action);
    weg.forEach((sig) => this.mapping.remove(sig));
    if (weg.length) this.emit('forgotten', { action, sigs: weg });
    return weg;
  }
}
