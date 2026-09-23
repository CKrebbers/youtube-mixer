/**
 * De worklet van de opnemer. Draait op de audiothread.
 *
 * Verzamelt wat de master uitstuurt en geeft het per seconde door als 16-bit
 * stereo, al omgezet: dan hoeft de hoofdthread alleen nog te versturen. Hij
 * telt frames, en de lengte van de opname komt dus van de audioklok zelf.
 *
 * Berichten erin:  { type: 'stop' }   rest doorgeven en daarna niets meer
 * Berichten eruit: { type: 'stuk', data: ArrayBuffer, frames }  (overgedragen)
 *                  { type: 'klaar', frames }                      na 'stop'
 */
const PER_STUK = 48000;          // een seconde op 48 kHz

class Opnemer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(PER_STUK * 2);
    this.n = 0;
    this.totaal = 0;
    this.gestopt = false;
    this.port.onmessage = ({ data }) => {
      if (data.type !== 'stop' || this.gestopt) return;
      this.gestopt = true;
      this._geefDoor();
      this.port.postMessage({ type: 'klaar', frames: this.totaal });
    };
  }

  _geefDoor() {
    if (!this.n) return;
    const data = this.buf.slice(0, this.n * 2).buffer;
    this.port.postMessage({ type: 'stuk', data, frames: this.n }, [data]);
    this.totaal += this.n;
    this.n = 0;
  }

  process(inputs) {
    if (this.gestopt) return false;
    const inp = inputs[0];
    // Zonder aangesloten signaal is er geen kanaal; mono wordt op beide gezet.
    const L = inp[0], R = inp[1] || inp[0];
    const frames = L ? L.length : 128;
    for (let i = 0; i < frames; i++) {
      const l = L ? Math.max(-1, Math.min(1, L[i])) : 0;
      const r = R ? Math.max(-1, Math.min(1, R[i])) : 0;
      this.buf[this.n * 2] = Math.round(l * 32767);
      this.buf[this.n * 2 + 1] = Math.round(r * 32767);
      if (++this.n === PER_STUK) this._geefDoor();
    }
    return true;
  }
}

registerProcessor('opnemer', Opnemer);
