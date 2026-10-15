/**
 * De worklets van de effecten (fx-meer.js). Draait op de audiothread en laadt
 * pas als een effect hem nodig heeft (`laadFxWorklet`, één keer per
 * AudioContext). Net als stream-lezer.js en klankschaal-worklet.js doet hij
 * zelf bijna niets: per blok de kern aanroepen (fx-kern.js). Geen afval per
 * blok; de `parameters` en de arrays maakt de browser.
 *
 * Bericht 'stop' (bij vernietig()): process() geeft daarna false, zodat de
 * browser de node mag opruimen. Een processor die true blijft geven, houdt
 * zichzelf in leven, ook als niets er meer aan hangt.
 */
import { Omhullende, Toonhoogte, Kam, Freqschuif, Aanslag } from './fx-kern.js';

class OmhullendeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'aanzet', defaultValue: 0.01, minValue: 0.0005, maxValue: 1, automationRate: 'k-rate' },
      { name: 'verval', defaultValue: 0.15, minValue: 0.001, maxValue: 3, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.kern = new Omhullende(sampleRate);
    this.levend = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.levend = false; };
  }

  process(ins, outs, p) {
    const uit = outs[0][0];
    const inp = ins[0];
    const k = inp.length;
    this.kern.aanzet = p.aanzet[0];
    this.kern.verval = p.verval[0];
    if (k === 0) this.kern.render(uit, uit, 0, uit, uit.length);
    else this.kern.render(inp[0], k > 1 ? inp[1] : inp[0], k > 1 ? 2 : 1, uit, uit.length);
    for (let c = 1; c < outs[0].length; c++) outs[0][c].set(uit);
    return this.levend;
  }
}

class ToonhoogteProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'halvetonen', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.kern = new Toonhoogte(sampleRate);
    this.levend = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.levend = false; };
  }

  process(ins, outs, p) {
    const uit = outs[0];
    const L = uit[0], R = uit.length > 1 ? uit[1] : uit[0];
    const inp = ins[0];
    const k = inp.length;
    this.kern.halvetonen = p.halvetonen[0];
    if (k === 0) this.kern.render(L, L, 0, L, R, L.length);
    else this.kern.render(inp[0], k > 1 ? inp[1] : inp[0], 1, L, R, L.length);
    return this.levend;
  }
}

/**
 * De stereo-kernen van spoor S10 (Kam, Freqschuif, Aanslag) in één vorm: per
 * blok de k-rate parameters als veld op de kern (`zet`), dan render().
 */
function stereoProcessor(Kern, descriptors, zet) {
  return class extends AudioWorkletProcessor {
    static get parameterDescriptors() { return descriptors; }
    constructor() {
      super();
      this.kern = new Kern(sampleRate);
      this.levend = true;
      this.port.onmessage = (e) => { if (e.data === 'stop') this.levend = false; };
    }
    process(ins, outs, p) {
      const uit = outs[0];
      const L = uit[0], R = uit.length > 1 ? uit[1] : uit[0];
      const inp = ins[0];
      const k = inp.length;
      // Met namen, niet met een sleutel uit een lijst: een keyed store van een double
      // maakt per blok een getal-object (gemeten: 3 GC's per 12 000 blokken).
      zet(this.kern, p);
      if (k === 0) this.kern.render(L, L, 0, L, R, L.length);
      else this.kern.render(inp[0], k > 1 ? inp[1] : inp[0], 1, L, R, L.length);
      return this.levend;
    }
  };
}

const K = 'k-rate';
registerProcessor('varve-fx-kam', stereoProcessor(Kam, [
  { name: 'toon', defaultValue: 220, minValue: 10, maxValue: 4000, automationRate: K },
  { name: 'fb', defaultValue: 0.5, minValue: -0.97, maxValue: 0.97, automationRate: K },
  { name: 'demping', defaultValue: 8000, minValue: 100, maxValue: 24000, automationRate: K },
], (k, p) => { k.toon = p.toon[0]; k.fb = p.fb[0]; k.demping = p.demping[0]; }));
registerProcessor('varve-fx-freqschuif', stereoProcessor(Freqschuif, [
  { name: 'hz', defaultValue: 0, minValue: -2000, maxValue: 2000, automationRate: K },
], (k, p) => { k.hz = p.hz[0]; }));
registerProcessor('varve-fx-aanslag', stereoProcessor(Aanslag, [
  { name: 'aanval', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: K },
  { name: 'sustain', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: K },
], (k, p) => { k.aanval = p.aanval[0]; k.sustain = p.sustain[0]; }));

registerProcessor('varve-fx-omhullende', OmhullendeProcessor);
registerProcessor('varve-fx-toonhoogte', ToonhoogteProcessor);
