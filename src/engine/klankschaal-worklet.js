/**
 * De worklet van de klankschaal. Draait op de audiothread.
 *
 * Net als stream-lezer.js doet hij zelf bijna niets: berichten doorgeven aan
 * de kern en per blok `render()` aanroepen. Stemmen en aanslaan rekent de
 * hoofdthread uit (klankschaal.js). Geen afval per blok; wat iets aanmaakt
 * gebeurt per bericht (en een bericht maakt de browser al aan).
 *
 * Bericht { t: 'stop' }: process() geeft daarna false, zodat de browser de node
 * mag opruimen (zoals fx-worklet.js). De klankschaal van de engine leeft zo lang
 * als de AudioContext; dit is er voor wie hem ooit wel weghaalt.
 */
import { SchaalKern } from './klankschaal-kern.js';

class KlankschaalProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kern = new SchaalKern(sampleRate);
    this.levend = true;
    this.port.onmessage = (e) => {
      if (e.data?.t === 'stop') { this.levend = false; this.port.onmessage = null; return; }
      this.kern.bericht(e.data);
    };
  }

  process(_in, uit) {
    if (!this.levend) return false;
    const L = uit[0][0], R = uit[0][1] || L;
    this.kern.render(L, R, L.length);
    return true;
  }
}

registerProcessor('varve-klankschaal', KlankschaalProcessor);
