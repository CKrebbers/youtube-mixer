/**
 * Wat alle instrumenten delen (docs/INSTRUMENTEN.md van v1 §2–4, in v2 dit bestand en index.js).
 * Geen DOM, geen engine, geen MIDI: noten zijn getallen, tijd is de audioklok.
 *
 *   nootHz, nootVan       MIDI-noot <-> Hz (A4 = 69 = 440 Hz), en "een geldige noot of null"
 *   tijdOp(ctx, t)        een tijd op de audioklok: leeg of voorbij = nu (het contract)
 *   ParamLijn             de waarde van één knop door de tijd: zetParam(k, v, t) mag vooruit
 *                         (p-locks, automatie; v2-oogst produceren-047)
 *   laadModule(ctx, url)  een AudioWorklet-module hooguit één keer per context laden
 *   meldWorkletFout       een fout IN een worklet als event op de context (zoals v1 worklet-fout.js
 *                         en v2 mixer.js: dezelfde naam 'varve-workletfout')
 *   komma, hz             getallen als tekst voor de eenheden (zoals v1 src/lib/notatie.js)
 */

/** MIDI-noot naar Hz (A4 = 69 = 440 Hz). */
export const nootHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** Een MIDI-noot 0..127 (afgerond), of null. */
export function nootVan(noot) {
  if (!Number.isFinite(noot)) return null;
  const n = Math.round(noot);
  return n >= 0 && n <= 127 ? n : null;
}

/** Een tijd op de audioklok: undefined, onzin of in het verleden = nu. */
export const tijdOp = (ctx, t) => {
  const nu = ctx.currentTime;
  return Number.isFinite(t) && t > nu ? t : nu;
};

const klem01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * De stand van één knop door de tijd: [{ t, v }] oplopend. `zet(v, t)` met t in de
 * toekomst laat alles vóór t zoals het was; wat erna stond vervalt (een nieuwe draai wint).
 * `op(t)` = de waarde die op audiokloktijd t geldt. Wat voorbij is wordt opgeruimd: er
 * blijft altijd één punt dat nu geldt. Zo rekent een noot die vooruit gepland is met de
 * knop van ZIJN moment (p-lock), en een knop die je nu draait geldt meteen.
 */
export class ParamLijn {
  constructor(v) { this.p = [{ t: -Infinity, v: klem01(v) }]; }
  zet(v, t) {
    const w = klem01(v);
    while (this.p.length > 1 && this.p.at(-1).t >= t) this.p.pop();
    if (this.p.length === 1 && this.p[0].t >= t) { this.p[0] = { t: -Infinity, v: w }; return; }
    this.p.push({ t, v: w });
  }
  op(t) {
    let v = this.p[0].v;
    for (const x of this.p) { if (x.t <= t) v = x.v; else break; }
    return v;
  }
  /** Alles wat vóór `nu` al geldt samenvatten in één punt. */
  ruim(nu) {
    let i = 0;
    while (i + 1 < this.p.length && this.p[i + 1].t <= nu) i++;
    if (i > 0) this.p = [{ t: -Infinity, v: this.p[i].v }, ...this.p.slice(i + 1)];
  }
  /** De laatste waarde (wat de knop uiteindelijk wordt). */
  get eind() { return this.p.at(-1).v; }
}

/** Per AudioContext en per module hooguit één addModule; een mislukte laad mag opnieuw. */
const geladen = new WeakMap();
export function laadModule(ctx, url) {
  let per = geladen.get(ctx);
  if (!per) { per = new Map(); geladen.set(ctx, per); }
  const sleutel = String(url);
  if (!per.has(sleutel)) {
    const p = ctx.audioWorklet.addModule(url);
    p.catch(() => per.delete(sleutel));
    per.set(sleutel, p);
  }
  return per.get(sleutel);
}

/** Dezelfde naam als v1 worklet-fout.js en v2 mixer.js: de engine luistert er één keer naar. */
export const WORKLET_FOUT = 'varve-workletfout';

/** Meld een worklet-fout op de context (een EventTarget). Gooit nooit. */
export function meldWorkletFout(ctx, wat, { reden = '', hint = '' } = {}) {
  try {
    if (typeof ctx?.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
    ctx.dispatchEvent(new CustomEvent(WORKLET_FOUT, { detail: { wat, reden, hint } }));
  } catch (_) { /* melden mag het instrument nooit meenemen */ }
}

/** De reden uit een processorerror-event (Chrome geeft een ErrorEvent, soms zonder tekst). */
export const foutReden = (e) => String(e?.message || e?.error?.message || '');

/** `x` met `n` decimalen en een komma: komma(1.25, 1) = '1,3'. */
export const komma = (x, n = 1) => x.toFixed(n).replace('.', ',');

/** Een frequentie: '440 Hz', '1,5 kHz', '12 kHz'. */
export const hz = (f) => (f >= 1000 ? `${komma(f / 1000, f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);

/** Tijd als tekst: '8 ms', '1,6 s', '12 s', '∞'. */
export const tijdTekst = (s) => (!Number.isFinite(s) ? '∞' : s < 1 ? `${Math.round(s * 1000)} ms` : `${komma(s, s < 10 ? 1 : 0)} s`);
