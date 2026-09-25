import { Kenmerken } from './features.js';

/**
 * Leest een BESTAANDE AnalyserNode uit en maakt er kenmerken van (features.js).
 * Alleen uitlezen: de engine weet niet dat dit bestaat (regel 1), en er wordt
 * niets aan de audiograaf gehangen.
 *
 * Welke analyser: dat bepaalt de aanroeper met `analyser()`. De vormlagen
 * gebruiken die van de MASTER (na de limiter): wat de zaal hoort. Een bass-kill
 * op de track die het hardst klinkt haalt daar de bas weg; een track die
 * dicht staat telt niet mee; echo, galm en sampler wel. De hardst klinkende
 * track apart uitlezen (de maatgever) zou bij elke wissel van maatgever een
 * sprong in het beeld geven, en een track zonder grid telt daar niet mee.
 *
 * Kost niets zolang niemand `lees()` aanroept: er is geen eigen timer.
 */
export class Luisteraar {
  /**
   * @param analyser   () -> AnalyserNode of null (nog geen audio)
   * @param sampleRate () -> sampleRate van de AudioContext
   */
  constructor({ analyser, sampleRate, opties } = {}) {
    this.analyser = analyser;
    this.sampleRate = sampleRate;
    this.kenmerken = new Kenmerken(opties);
    this.spectrum = null;
    this.td = null;
  }

  /**
   * De kenmerken op tijd t (seconden, audioklok). Twee keer dezelfde t (twee
   * lagen in één beeld) leest de analyser maar één keer.
   */
  lees(t) {
    const a = this.analyser?.();
    if (!a) return null;
    const k = this.kenmerken;
    if (k.t !== null && t === k.t) return k.waarden;
    const bins = a.frequencyBinCount;
    if (!this.spectrum || this.spectrum.length !== bins) this.spectrum = new Float32Array(bins);
    if (!this.td || this.td.length !== a.fftSize) this.td = new Float32Array(a.fftSize);
    a.getFloatFrequencyData(this.spectrum);
    a.getFloatTimeDomainData(this.td);
    return k.stap(t, this.spectrum, this.sampleRate(), this.td,
      { minDb: a.minDecibels ?? -100, maxDb: a.maxDecibels ?? -30 });
  }
}
