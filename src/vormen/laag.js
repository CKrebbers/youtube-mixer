import { Emitter } from '../lib/emitter.js';
import { SYSTEMEN, SYSTEEM, LUTS, maakRng, draaiKnoppen } from './systemen.js';
import { MENGVORMEN, MAX_BEELDLAGEN } from '../video/lagen.js';

/**
 * Een vormlaag: één Vormmachine die op zijn eigen canvas tekent, voor de
 * videomixer. En VormLagen: de twee lagen samen, met welke er gekozen is.
 *
 * Tijd (regel 3): de laag krijgt de tijd van BUITEN, in seconden van de
 * audioklok (wat je hoort). Een systeem doet stappen van 1/60 s; zoveel als
 * er sinds de vorige keer verstreken zijn, hooguit MAX_STAPPEN. Zo draait
 * een vorm even snel op 30 als op 120 beelden per seconde, en loopt hij niet
 * in te halen na een hapering. Staat de audioklok stil (AudioContext nog niet
 * gestart), dan staat het beeld ook stil.
 *
 * Knoppen (regel 2): een knop is 0..1. De laag schaalt naar min..max van het
 * systeem en rondt af op zijn stap. Welke knoppen er zijn: draaiKnoppen() —
 * geen keuzelijsten, geen knoppen die een nieuwe start vragen.
 *
 * Kent geen DOM: het canvas komt uit `maakCanvas` (OffscreenCanvas in de
 * browser, een nep-canvas in de tests).
 */

export const STAP = 1 / 60;
export const MAX_STAPPEN = 3;
export const MAAT = 512;               // het systeem rekent in 320-eenheden, D = MAAT/320
export const AANTAL_LAGEN = MAX_BEELDLAGEN;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const naar01 = (k, v) => (k.max === k.min ? 0 : clamp01((v - k.min) / (k.max - k.min)));
function vanaf01(k, v) {
  const x = k.min + clamp01(v) * (k.max - k.min);
  const r = k.step ? Math.round((x - k.min) / k.step) * k.step + k.min : x;
  return Math.max(k.min, Math.min(k.max, +r.toFixed(6)));
}

export class VormLaag {
  /**
   * @param maakCanvas (w, h) -> canvas met getContext('2d')
   * @param zaad       begin van het toeval; zelfde zaad = zelfde beeld
   */
  constructor({ maakCanvas, systeem = SYSTEMEN[0].id, zaad = 1, maat = MAAT }) {
    this.maakCanvas = maakCanvas;
    this.zaad = zaad;
    this.canvas = maakCanvas(maat, maat);
    this.ctx = this.canvas.getContext('2d');
    this.maat = maat;
    this.aan = false;
    this.dekking = 0.8;
    this.mengvorm = MENGVORMEN[0];
    this.zetSysteem(systeem);
  }

  zetSysteem(id) {
    const sys = SYSTEEM[id] ?? SYSTEMEN[0];
    this.sys = sys;
    this.knoppen = draaiKnoppen(sys);
    this.p = Object.fromEntries(sys.knobs.map((k) => [k.k, k.v]));
    this.stand = this.knoppen.map((k) => naar01(k, k.v));
    this.mod = this.knoppen.map(() => 0);
    this.s = { o: {}, e: {} };
    this.g = {
      ctx: this.ctx, S: this.maat, D: this.maat / 320, t: 0,
      pal: sys.pal, L: LUTS[sys.pal], r: maakRng(this.zaad), maakCanvas: this.maakCanvas,
    };
    this.laatst = null;
    sys.init.call(sys, this.s, this.p, this.g);
  }

  /** Stand van knop i als 0..1, of null als het systeem die knop niet heeft. */
  leesKnop(i) { return i < this.stand.length ? this.stand[i] : null; }
  zetKnop(i, v) {
    const k = this.knoppen[i];
    if (!k) return;
    this.stand[i] = clamp01(v);
    this.p[k.k] = vanaf01(k, this.stand[i] + this.mod[i]);
  }
  /**
   * Modulatie (src/analysis/router.js): een offset BOVENOP de knopstand. De
   * stand (leesKnop, dus scherm, LED-ring en soft-takeover) blijft staan; het
   * systeem rekent vanaf de volgende stap met stand + offset.
   */
  zetModulatie(i, offset) {
    const k = this.knoppen[i];
    if (!k || this.mod[i] === offset) return;
    this.mod[i] = offset;
    this.p[k.k] = vanaf01(k, this.stand[i] + offset);
  }
  /** De echte waarde, in de eenheid van het systeem: voor het scherm. */
  waarde(i) { const k = this.knoppen[i]; return k ? this.p[k.k] : null; }

  /**
   * Bijwerken tot tijd t (seconden, audioklok) en het canvas teruggeven.
   * De eerste keer één stap, daarna zoveel stappen als er tijd verstreken is.
   */
  frame(t) {
    if (this.laatst === null || t < this.laatst || t - this.laatst > 1) {
      this.laatst = t;                         // begin, terug in de tijd, of lang stil: opnieuw ijken
      this._stap(t);
      return this.canvas;
    }
    let n = Math.floor((t - this.laatst) / STAP + 1e-9);
    if (n <= 0) return this.canvas;
    this.laatst += n * STAP;
    if (n > MAX_STAPPEN) { n = MAX_STAPPEN; this.laatst = t; }
    for (let i = 0; i < n; i++) this._stap(this.laatst - (n - 1 - i) * STAP);
    return this.canvas;
  }

  _stap(t) {
    this.g.t = t;
    this.sys.step.call(this.sys, this.s, this.p, this.g);
  }
}

/**
 * De lagen samen, met één GEKOZEN laag: daar werken de device knobs op
 * (mapje "vorm"), Bank ◀ ▶ kiest. 'change' bij elke wissel van systeem,
 * keuze, aan/uit of mengvorm — voor het scherm; knoppen en dekking volgt
 * het scherm zelf via read().
 */
export class VormLagen extends Emitter {
  constructor({ maakCanvas, aantal = AANTAL_LAGEN }) {
    super();
    // Elke laag een ander systeem en zaad, zodat twee lagen niet hetzelfde tonen.
    this.lagen = Array.from({ length: aantal }, (_, i) =>
      new VormLaag({ maakCanvas, systeem: SYSTEMEN[(i * 2) % SYSTEMEN.length].id, zaad: 1 + i }));
    this.gekozen = 0;
  }

  get laag() { return this.lagen[this.gekozen]; }
  kies(i) {
    const n = (i + this.lagen.length) % this.lagen.length;
    if (n === this.gekozen) return;
    this.gekozen = n;
    this.emit('change');
  }
  stapSysteem(richting, laag = this.laag) {
    const i = SYSTEMEN.findIndex((s) => s.id === laag.sys.id);
    laag.zetSysteem(SYSTEMEN[(i + richting + SYSTEMEN.length) % SYSTEMEN.length].id);
    this.emit('change');
  }
  zetSysteem(id, laag = this.laag) { laag.zetSysteem(id); this.emit('change'); }
  wisselAan(laag = this.laag) { laag.aan = !laag.aan; this.emit('change'); }
  volgendeMengvorm(laag = this.laag) {
    laag.mengvorm = MENGVORMEN[(MENGVORMEN.indexOf(laag.mengvorm) + 1) % MENGVORMEN.length];
    this.emit('change');
  }
  zetDekking(v, laag = this.laag) { laag.dekking = clamp01(v); }
}
