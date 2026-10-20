// Herkomst: v1 youtube-mixer/src/engine/limiter-worklet.js @ 6a640ac; alleen het commentaar over 'stop' bijgewerkt (de mixer stuurt het nu bij vernietig()). Wijzigingen hier, niet meer in v1.
/**
 * De worklet van de master-limiter. Draait op de audiothread.
 *
 * Net als klankschaal-worklet.js doet hij zelf bijna niets: per blok de kern
 * (limiter-kern.js) laten rekenen. Uitgang 0 is het geluid (stereo), uitgang 1
 * de gain per sample (mono): de hoofdthread leest die met een AnalyserNode
 * uit voor de gain reduction. Geen berichten en geen afval per blok
 * (docs/AUDIOPAD.md); een invoer zonder verbinding (lege lijst) is stilte.
 *
 * Bericht 'stop': process() geeft daarna false (zoals fx-worklet.js), zodat de
 * browser de node mag opruimen. De mixer stuurt het in vernietig(), vóór hij
 * de node losmaakt.
 */
import { LimiterKern } from './limiter-kern.js';

class LimiterProcessor extends AudioWorkletProcessor {
  constructor(opties) {
    super();
    this.kern = new LimiterKern(sampleRate, opties?.processorOptions || {});
    this.stil = new Float32Array(128);
    this.levend = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') { this.levend = false; this.port.onmessage = null; } };
  }

  process(invoer, uitvoer) {
    if (!this.levend) return false;
    const uit = uitvoer[0];
    const L = uit[0], R = uit.length > 1 ? uit[1] : uit[0];
    const n = L.length;
    // Een renderblok is 128 frames; is het ooit groter, dan één keer meer stilte.
    if (this.stil.length < n) this.stil = new Float32Array(n);
    const inn = invoer[0];
    const a = inn && inn.length > 0 ? inn[0] : this.stil;
    const b = inn && inn.length > 1 ? inn[1] : a;
    const g = uitvoer.length > 1 && uitvoer[1].length > 0 ? uitvoer[1][0] : null;
    this.kern.render(a, b, L, R, g, n);
    return true;
  }
}

registerProcessor('varve-limiter', LimiterProcessor);
