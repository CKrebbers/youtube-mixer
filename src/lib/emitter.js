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
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
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
