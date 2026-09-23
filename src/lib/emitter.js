// Minimale event-emitter. Geen dependencies.
export class Emitter {
  constructor() { this._h = new Map(); }
  on(evt, fn) {
    if (!this._h.has(evt)) this._h.set(evt, new Set());
    this._h.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { this._h.get(evt)?.delete(fn); }
  emit(evt, payload) {
    const s = this._h.get(evt);
    if (s) for (const fn of s) fn(payload);
  }
}

// Handige mappings die overal terugkomen.
// NaN gaat naar de ondergrens: clamp(NaN) gaf NaN, en een AudioParam gooit
// dan een TypeError die de hele aanroep meeneemt.
export const clamp = (v, lo = 0, hi = 1) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (v === Infinity ? hi : lo));
/** Piek van een analyser, 0..1. Met een hergebruikte buffer: elk frame negen keer een nieuwe was verspilling. */
const piekBuf = new WeakMap();
export function piek(analyser) {
  let buf = piekBuf.get(analyser);
  if (!buf || buf.length !== analyser.fftSize) { buf = new Uint8Array(analyser.fftSize); piekBuf.set(analyser, buf); }
  analyser.getByteTimeDomainData(buf);
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128); if (v > p) p = v; }
  return p / 128;
}
/** Exponentieel tussen twee frequenties — hoe oren werken, niet hoe getallen werken. */
export const expMap = (t, lo, hi) => lo * Math.pow(hi / lo, clamp(t));
export const dbToGain = (db) => Math.pow(10, db / 20);
export const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
};
