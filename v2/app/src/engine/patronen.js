/**
 * De patronenspeler op de MAATKLOK (plak 5; v1 src/engine/patronen/speler.js, anders gebouwd).
 *
 * In v1 had de speler een eigen klok-lijn (klok-tellen <-> audioklok) die hij op de maatgever
 * richtte. In v2 IS de maatklok die lijn: een tick is klok.tel × PPQN, en klok.tijd(tel) zegt
 * wanneer hij klinkt. Eén klok voor decks, sampler en patronen (WENSEN 19 okt, "b en a").
 *
 * Plannen: een timer (TIK_MS) zegt alleen WANNEER er gekeken wordt (regel 3); de noten gaan met
 * hun tijd op de audioklok naar het instrument, VOORUIT seconden vooruit. Vensters zijn halfopen
 * in ticks (kern/patronen/venster.js): elke noot precies één keer, hoe de grenzen ook vallen.
 * Starten, wisselen en stoppen gebeuren op de eerste "1" van de klok na wat al gepland is.
 *
 * Grens (bewust): wat al gepland is staat vast in het instrument. Verandert de klok binnen
 * VOORUIT, dan klinken die paar noten nog op het oude tempo (bij 1 bpm verschil < 1 ms).
 */
import { PPQN, notenInVenster } from '../kern/patronen/venster.js';

export const PLEKKEN = 5;
export const VOORUIT = 0.12;    // s
export const TIK_MS = 25;

export class Patronen {
  constructor(engine, { timers = { zet: (f, ms) => setInterval(f, ms), weg: (id) => clearInterval(id) } } = {}) {
    this.engine = engine;
    this.timers = timers;
    // Per track: vijf plekken met een patroon (of null), en wat er speelt.
    this.plekken = Array.from({ length: engine.tracks.length + 1 }, () => new Array(PLEKKEN).fill(null));
    this.spel = new Map();       // n -> { k, basis, start, stop } (ticks); stop = Infinity tot hij stopt
    this.gepland = null;         // tot deze tick is alles gepland (null = niets loopt)
    this.tempo = 120;            // als de klok stilstaat en een patroon start
    this._timer = null;
    engine.on('instrument', ({ n, soort }) => { if (!soort) this.spel.delete(n); });
  }

  get speelt() { return this.spel.size > 0; }

  /** De tick op audiokloktijd t (de klok loopt). */
  tickOp(t) { return this.engine.klok.tel(t) * PPQN; }
  tijdVan(tick) { return this.engine.klok.tijd(tick / PPQN); }

  /** De eerste "1" van de klok op of na tick `vanaf`. */
  _maatNa(vanaf) {
    const per = this.engine.klok.perMaat * PPQN;
    return Math.ceil(vanaf / per - 1e-9) * per;
  }

  zetPatroon(n, k, p) { this.plekken[n][k - 1] = p ?? null; }
  patroon(n, k) { return this.plekken[n][k - 1]; }

  /**
   * Plek k van track n starten op de volgende "1" (of meteen met `meteen`); speelt die plek al,
   * dan stoppen op de volgende "1". Een andere plek = wisselen op de "1".
   */
  wissel(n, k, { meteen = false } = {}) {
    const e = this.engine, t = e.track(n);
    if (!t.instrument) return { geweigerd: `track ${n} heeft geen instrument` };
    if (!this.patroon(n, k)) return { geweigerd: `plek ${k} van track ${n} is leeg` };
    const A = e.straks();
    if (!e.klok.loopt) e.zetKlokTempo(this.tempo, A);
    const vanaf = Math.max(this.gepland ?? this.tickOp(A), this.tickOp(A));
    const op = meteen ? Math.ceil(vanaf) : this._maatNa(vanaf);
    const nu = this.spel.get(n);
    if (nu && nu.k === k && nu.stop === Infinity) { nu.stop = op; this._start(); return; }
    if (nu) nu.stop = op;
    // Het nieuwe begint waar het oude stopt (de wissel staat in de ticks: niets dubbel, niets weg).
    this.spel.set(n, { k, basis: op, start: op, stop: Infinity, vorige: nu ?? null });
    if (this.gepland === null) this.gepland = this.tickOp(A);
    this._start();
  }

  /** Alles stoppen op de volgende "1". */
  stopAlles({ meteen = false } = {}) {
    if (!this.speelt) return;
    const A = this.engine.straks();
    const vanaf = Math.max(this.gepland ?? this.tickOp(A), this.tickOp(A));
    const op = meteen ? Math.ceil(vanaf) : this._maatNa(vanaf);
    for (const s of this.spel.values()) s.stop = Math.min(s.stop, op);
  }

  _start() { if (this._timer === null) this._timer = this.timers.zet(() => this.tik(), TIK_MS); this.tik(); }

  /** Plannen tot nu + VOORUIT. */
  tik() {
    const e = this.engine;
    if (!this.speelt || !e.klok.loopt) { this._klaar(); return; }
    const tot = this.tickOp(e.nu() + VOORUIT);
    const van = this.gepland ?? tot;
    if (tot <= van) return;
    for (const [n, s] of [...this.spel]) {
      const inst = e.track(n).instrument?.inst;
      if (!inst) { this.spel.delete(n); continue; }
      for (const deel of [s.vorige, s]) {
        if (!deel) continue;
        const p = this.patroon(n, deel.k);
        const stop = deel === s.vorige ? s.start : deel.stop;
        for (const noot of notenInVenster(p, { basis: deel.basis, start: deel.start, stop }, van, tot)) {
          const t0 = this.tijdVan(noot.tick);
          inst.noteOn(noot.noot, noot.snelheid, t0);
          inst.noteOff(noot.noot, this.tijdVan(Math.min(noot.tick + noot.duur, stop)));
        }
      }
      if (s.vorige && s.start <= tot) s.vorige = null;
      // Gestopt: op de stoptick alles los (een noot die erover heen zou klinken, stopt daar).
      if (s.stop !== Infinity && s.stop <= tot) { inst.alleUit?.(this.tijdVan(s.stop)); this.spel.delete(n); }
    }
    this.gepland = tot;
    if (!this.speelt) this._klaar();
    e.emit('patronen');
  }

  _klaar() {
    if (this._timer !== null) { this.timers.weg(this._timer); this._timer = null; }
    this.gepland = null;
  }

  /** Welke plek speelt op track n (1..5), of null; en wacht er een start? */
  stand(n) {
    const s = this.spel.get(n);
    if (!s) return { speelt: null, wacht: false };
    const nu = this.engine.klok.loopt ? this.tickOp(this.engine.nu()) : 0;
    return { speelt: s.start <= nu ? s.k : s.vorige?.k ?? null, wacht: s.start > nu ? s.k : false, stopt: s.stop !== Infinity };
  }
}
