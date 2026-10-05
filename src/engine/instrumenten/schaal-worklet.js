/**
 * De worklet van het instrument "schaal" (schaal.js). Draait op de audiothread.
 *
 * Zoals klankschaal-worklet.js: zelf bijna niets. Berichten gaan met de
 * audioklok van aankomst naar de kern (die zet ze op hun tijd in de rij),
 * en per blok rendert de kern vanaf het begin van het blok. Geen afval per
 * blok: de tijd is `currentFrame / sampleRate` (een heel getal gedeeld, zoals
 * stream-lezer.js; de getter `currentTime` geeft elke keer een nieuw
 * getal-object) en gaat als VELD naar de kern, niet als argument.
 */
import { SchaalInstrumentKern } from './schaal-kern.js';

class SchaalInstrumentProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kern = new SchaalInstrumentKern(sampleRate);
    this.port.onmessage = (e) => this.kern.bericht(e.data, currentFrame / sampleRate);
  }

  process(_in, uit) {
    const L = uit[0][0], R = uit[0][1] || L;
    this.kern.t0 = currentFrame / sampleRate;
    this.kern.blok(L, R, L.length);
    return true;
  }
}

registerProcessor('varve-schaal-instrument', SchaalInstrumentProcessor);
