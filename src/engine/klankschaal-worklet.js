/**
 * De worklet van de klankschaal. Draait op de audiothread.
 *
 * Net als stream-lezer.js doet hij zelf bijna niets: berichten doorgeven aan
 * de kern en per blok `render()` aanroepen. Stemmen en aanslaan rekent de
 * hoofdthread uit (klankschaal.js). Geen afval per blok; wat iets aanmaakt
 * gebeurt per bericht (en een bericht maakt de browser al aan).
 */
import { SchaalKern } from './klankschaal-kern.js';

class KlankschaalProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kern = new SchaalKern(sampleRate);
    this.port.onmessage = (e) => this.kern.bericht(e.data);
  }

  process(_in, uit) {
    const L = uit[0][0], R = uit[0][1] || L;
    this.kern.render(L, R, L.length);
    return true;
  }
}

registerProcessor('varve-klankschaal', KlankschaalProcessor);
