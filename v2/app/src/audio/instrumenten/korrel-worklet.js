/**
 * De worklet van het instrument "korrel" (korrel.js). Zoals schaal-worklet.js: zelf bijna niets.
 * Berichten gaan met de audioklok van aankomst naar de kern; per blok rendert de kern vanaf het begin
 * van het blok. De tijd is `currentFrame / sampleRate` en gaat als VELD naar de kern (geen afval).
 * Bericht { t: 'stop' }: process() geeft daarna false (de browser mag hem opruimen).
 */
import { KorrelInstrumentKern } from './korrel-kern.js';

class KorrelInstrumentProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kern = new KorrelInstrumentKern(sampleRate);
    this.levend = true;
    this.port.onmessage = (e) => {
      if (e.data?.t === 'stop') { this.levend = false; this.port.onmessage = null; return; }
      this.kern.bericht(e.data, currentFrame / sampleRate);
    };
  }

  process(_in, uit) {
    if (!this.levend) return false;
    const L = uit[0][0], R = uit[0][1] || L;
    this.kern.t0 = currentFrame / sampleRate;
    this.kern.blok(L, R, L.length);
    return true;
  }
}

registerProcessor('varve-korrel-instrument', KorrelInstrumentProcessor);
