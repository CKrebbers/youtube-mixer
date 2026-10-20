/**
 * De worklet van de opnemer: schrijft wat de master uitstuurt (ná de limiter) als 16-bit stereo
 * in een RING in een SharedArrayBuffer, en de hoofdthread leest hem leeg. Zo maakt de
 * audiothread niets aan (v1 sneed per seconde een stuk af: 192 kB afval op de audiothread).
 *
 * Indeling van de gedeelde buffers (opnemer.js maakt ze):
 *   ring   Int16Array(RING_FRAMES * 2)  de samples, interleaved
 *   stand  Int32Array(4)                [0] geschreven frames (totaal), [1] gelezen frames (de
 *                                       hoofdthread), [3] gestopt
 * De worklet schrijft altijd door (de oudste frames worden overschreven); loopt de hoofdthread
 * meer dan een ring achter, dan ziet die dat aan [0] − [1] en slaat hij het verlorene over: op
 * de server blijft dat stuk stilte, op zijn plek.
 *   start  Float64Array(1)              currentFrame van de eerste opgenomen frame
 * Berichten erin: { type: 'stop' }. Daarna geeft process() false (v1-regel: een node die weg
 * moet krijgt eerst 'stop').
 */
class Opnemer extends AudioWorkletProcessor {
  constructor(opties) {
    super();
    const { ring, stand, start } = opties.processorOptions;
    this.ring = new Int16Array(ring);
    this.stand = new Int32Array(stand);
    this.start = new Float64Array(start);
    this.n = this.ring.length / 2;
    this.eerste = true;
    this.gestopt = false;
    this.port.onmessage = (e) => { if (e.data?.type === 'stop') { this.gestopt = true; Atomics.store(this.stand, 3, 1); } };
  }

  process(inputs) {
    if (this.gestopt) return false;
    const inp = inputs[0];
    const L = inp && inp[0], R = inp && (inp[1] || inp[0]);
    const frames = L ? L.length : 128;
    if (this.eerste) { this.start[0] = currentFrame; this.eerste = false; }
    let w = Atomics.load(this.stand, 0);
    const ring = this.ring, n = this.n;
    for (let i = 0; i < frames; i++) {
      const l = L ? L[i] : 0, rr = R ? R[i] : 0;
      const j = (w % n) * 2;
      ring[j] = Math.round((l > 1 ? 1 : l < -1 ? -1 : l) * 32767);
      ring[j + 1] = Math.round((rr > 1 ? 1 : rr < -1 ? -1 : rr) * 32767);
      w++;
    }
    Atomics.store(this.stand, 0, w);
    return true;
  }
}

registerProcessor('varve-opnemer', Opnemer);
