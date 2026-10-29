/**
 * Het instrument "korrel": de korrelwolk op toonhoogte. Elk stuk geluid wordt speelbaar: een noot
 * speelt korrels uit de bron met de snelheid van die noot (noot − grondnoot van de bron). De bron is
 * de eigen klank (korrel-kern.js) tot je iets vangt (`laadBron`, de engine-actie korrel.vang knipt de
 * laatste tellen van wat er speelt; met stems wat je HOORT).
 *
 * De acht knoppen volgen het alfabet (instrumenten/gedeeld/alfabet.js, kern/opstelling/model.js):
 *   1 schaal     korrelgrootte 8 ms … 400 ms        2 dichtheid  4 … 120 korrels per seconde
 *   3 beweging   scan: 50% = stil, hoger vooruit, lager achteruit (tot ×1 de echte snelheid)
 *   4 vervorming toonspreiding 0 … ±24 halve tonen (octaven en kwinten vaker)
 *   5 kleur      plek in de bron (begin … eind)     6 helderheid aanzet en loslaten (hoog = kort en scherp)
 *   7 variatie   spray 0 … 0,5 s rond de leeskop    8 ruimte     stereobreedte
 * Contract: audio/instrumenten/index.js. De worklet laadt pas bij start() (zonder kost hij niets).
 */
import { clamp, expMap, Emitter } from '../../kern/emitter.js';
import { zetHellingen, startDrempel } from '../overgang.js';
import { ParamLijn, nootVan, tijdOp, laadModule, meldWorkletFout, foutReden, komma } from './hulp.js';
import { STEMMEN, EIGEN_GROND } from './korrel-kern.js';

const WORKLET = new URL('./korrel-worklet.js', import.meta.url);
export const OPHOGING = 1;
const BUIG = 200;   // cent bij buig ±1
const pct = (v) => `${Math.round(clamp(v) * 100)}%`;
const tijd = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${komma(s, s < 10 ? 1 : 0)} s`);

export const grootteVan = (t) => expMap(t, 0.008, 0.4);
export const dichtheidVan = (t) => expMap(t, 4, 120);
export const scanVan = (t) => { const x = (clamp(t) - 0.5) * 2; return Math.abs(x) < 0.04 ? 0 : x * Math.abs(x); };
export const toonVan = (t) => clamp(t) * 24;
export const aanzetVan = (t) => expMap(1 - clamp(t), 0.002, 1.5);
export const loslatenVan = (t) => expMap(1 - clamp(t), 0.06, 4);
export const sprayVan = (t) => clamp(t) * 0.5;

/** Een geknipt stuk (engine/sampler.js knipPcm: Int16-pagina's, stereo) als twee Float32Array's. */
export function pcmNaarBron(pcm) {
  if (!pcm?.paginas?.length || !(pcm.frames > 0)) return null;
  const n = pcm.frames, L = new Float32Array(n), R = new Float32Array(n);
  let i = 0;
  for (const p of pcm.paginas) for (let j = 0; j + 1 < p.length && i < n; j += 2, i++) { L[i] = p[j] / 32768; R[i] = p[j + 1] / 32768; }
  return { L, R, n: i, sr: pcm.sr };
}

export class Korrel extends Emitter {
  constructor(ctx, uit, { klok = null, toon = null } = {}) {
    super();
    this.ctx = ctx;
    this.soort = 'korrel';
    this.naam = 'Korrelwolk';
    this.klok = klok;
    this.toonVan = typeof toon === 'function' ? toon : null;
    this.uitGain = ctx.createGain();
    this.uitGain.gain.value = OPHOGING;
    this.uitGain.connect(uit);
    this.node = null;
    this._start = null;
    this._weg = false;
    this.params = Object.freeze([
      { id: 'grootte', label: 'grootte', standaard: 0.55, eenheid: (v) => tijd(grootteVan(v)) },
      { id: 'dichtheid', label: 'dichtheid', standaard: 0.5, eenheid: (v) => `${Math.round(dichtheidVan(v))}/s` },
      { id: 'scan', label: 'scan', standaard: 0.6, eenheid: (v) => { const s = scanVan(v); return s === 0 ? 'stil' : `${s > 0 ? '' : '−'}×${komma(Math.abs(s), 2)}`; } },
      { id: 'toon', label: 'toon', standaard: 0, eenheid: (v) => (toonVan(v) < 0.5 ? 'zuiver' : `±${Math.round(toonVan(v))} ht`) },
      { id: 'positie', label: 'plek', standaard: 0.2, eenheid: pct },
      { id: 'aanzet', label: 'aanzet', standaard: 0.6, eenheid: (v) => tijd(aanzetVan(v)) },
      { id: 'spray', label: 'spray', standaard: 0.15, eenheid: (v) => tijd(sprayVan(v)) },
      { id: 'breedte', label: 'breedte', standaard: 0.6, eenheid: pct },
    ].map((p) => Object.freeze(p)));
    this._lijn = this.params.map((p) => new ParamLijn(p.standaard));
    this._P = Object.fromEntries(this.params.map((p, i) => [p.id, i]));
    this.stemmen = Array.from({ length: STEMMEN }, () => ({ noot: null, t: -Infinity, vast: false, gehouden: false }));
    this.grond = EIGEN_GROND;
    this.bron = null;       // { duur, titel } van wat er gevangen is; null = de eigen klank
    this.pedaal = false;
    this._buig = 0;
  }

  _w(id, t = this.ctx.currentTime) { return this._lijn[this._P[id]].op(t); }
  _post(m, transfer) { try { this.node?.port.postMessage(m, transfer ?? []); } catch (_) { /* weg */ } }

  start() {
    if (!this._start) {
      this._start = laadModule(this.ctx, WORKLET).then(() => {
        if (this._weg || this.node) return;
        const node = new AudioWorkletNode(this.ctx, 'varve-korrel-instrument', { numberOfInputs: 0, outputChannelCount: [2] });
        node.onprocessorerror = (e) => this._workletFout(node, e);
        node.connect(this.uitGain);
        this.node = node;
        this._stuurParams(this.ctx.currentTime);
        if (this._wachtBron) { const b = this._wachtBron; this._wachtBron = null; this._post({ t: 'bron', L: b.L, R: b.R, n: b.n, grond: this.grond }, [b.L.buffer, b.R.buffer]); }
      }).catch((err) => { this._start = null; throw err; });
    }
    return this._start;
  }

  /**
   * Een nieuwe bron: een geknipt stuk (knipPcm) of { L, R, n }. `grond` = de noot die het stuk "is"
   * (een noot op grond speelt de korrels op hun eigen snelheid). Zonder: C4.
   */
  laadBron(bron, { grond = EIGEN_GROND, titel = null } = {}) {
    if (this._weg) return false;
    const b = bron?.paginas ? pcmNaarBron(bron) : bron;
    if (!b || !(b.n > 0)) return false;
    if (b.sr && Math.abs(b.sr - this.ctx.sampleRate) > 1) {
      // Een andere samplerate: lineair herbemonsteren (één keer, op de hoofdthread).
      const f = b.sr / this.ctx.sampleRate, n = Math.floor(b.n / f), L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) { const p = i * f, i0 = p | 0, i1 = Math.min(b.n - 1, i0 + 1), fr = p - i0; L[i] = b.L[i0] + (b.L[i1] - b.L[i0]) * fr; R[i] = b.R[i0] + (b.R[i1] - b.R[i0]) * fr; }
      b.L = L; b.R = R; b.n = n;
    }
    this.grond = Number.isFinite(grond) ? grond : EIGEN_GROND;
    this.bron = { duur: b.n / this.ctx.sampleRate, titel };
    if (this.node) this._post({ t: 'bron', L: b.L, R: b.R, n: b.n, grond: this.grond }, [b.L.buffer, b.R.buffer]);
    else { this._wachtBron = b; this.start().catch(() => {}); }
    this.emit('bron', this.bron);
    return true;
  }

  _rate(n) { return Math.pow(2, (n - this.grond + this._buig / 100) / 12); }

  noteOn(noot, snelheid, t) {
    const n = nootVan(noot);
    if (this._weg || n === null) return;
    if (!(snelheid > 0)) { this.noteOff(n, t); return; }
    if (!this.node) { this.start().catch(() => {}); return; }
    const t0 = tijdOp(this.ctx, t);
    const s = this._kiesStem(n, t0);
    const v = 0.25 + 0.75 * clamp(snelheid);
    Object.assign(this.stemmen[s], { noot: n, t: t0, vast: true, gehouden: false, v });
    this._post({ t: 'aan', tijd: t0, stem: s, rate: this._rate(n), v });
  }

  noteOff(noot, t) {
    if (this._weg) return;
    const n = nootVan(noot);
    if (n === null) return;
    this.stemmen.forEach((st, s) => {
      if (st.noot !== n || !st.vast) return;
      if (this.pedaal) { st.vast = false; st.gehouden = true; } else this._los(s, t);
    });
  }

  _los(s, t) {
    const st = this.stemmen[s];
    st.vast = false; st.gehouden = false;
    this._post({ t: 'uit', tijd: Math.max(tijdOp(this.ctx, t), st.t), stem: s });
  }

  /** Dezelfde noot als die nog klinkt; anders een vrije stem; anders de oudste. */
  _kiesStem(n, t0) {
    const v = this.stemmen;
    let s = v.findIndex((x) => x.noot === n && (x.vast || x.gehouden));
    if (s >= 0) return s;
    s = v.findIndex((x) => !x.vast && !x.gehouden);
    if (s >= 0) return s;
    let oud = 0;
    for (let i = 1; i < v.length; i++) if (v[i].t < v[oud].t) oud = i;
    return oud;
  }

  alleUit(t) { if (!this._weg) this.stemmen.forEach((st, s) => { if (st.vast || st.gehouden) this._los(s, t); }); }

  stil() {
    if (this._weg) return;
    for (const st of this.stemmen) Object.assign(st, { noot: null, t: -Infinity, vast: false, gehouden: false });
    this.pedaal = false;
    if (!this.node) return;
    const nu = this.ctx.currentTime, wacht = startDrempel(this.ctx);
    const g = this.uitGain.gain;
    zetHellingen(g, (van) => [van, 0], nu, 0.01, wacht);
    const tStil = nu + wacht + 0.012;
    this._post({ t: 'stil', tijd: tStil });
    g.setValueAtTime(0, tStil + 0.09);
    g.linearRampToValueAtTime(OPHOGING, tStil + 0.1);
  }

  /** Aftertouch: dieper = dichter (knop 2 schuift mee, zolang je drukt). */
  druk(w) {
    if (this._weg) return;
    this._druk = clamp(w);
    this._stuurParams(this.ctx.currentTime);
  }

  /** Pitchbend ±1 = ±2 halve tonen op de stemmen die klinken. */
  buig(w) {
    if (this._weg) return;
    this._buig = clamp(Number.isFinite(w) ? w : 0, -1, 1) * BUIG;
    this.stemmen.forEach((st, s) => { if (st.noot !== null && (st.vast || st.gehouden)) this._post({ t: 'aan', stem: s, rate: this._rate(st.noot), v: st.v ?? 0.8 }); });
  }

  /** Modwiel: spray erbij. */
  mod(w) { if (!this._weg) { this._mod = clamp(w); this._stuurParams(this.ctx.currentTime); } }

  houd(aan) {
    if (this._weg) return;
    this.pedaal = !!aan;
    if (!this.pedaal) this.stemmen.forEach((st, s) => { if (st.gehouden) this._los(s); });
  }

  zetParam(k, v, t) {
    if (this._weg || !Number.isInteger(k) || k < 1 || k > this.params.length || !Number.isFinite(v)) return;
    const nu = this.ctx.currentTime, t1 = tijdOp(this.ctx, t);
    const lijn = this._lijn[k - 1];
    lijn.ruim(nu);
    lijn.zet(v, t1);
    this._stuurParams(t1);
    this.emit('param', { k, v: lijn.op(t1), t: t1 });
  }

  leesParam(k, t) {
    return Number.isInteger(k) && k >= 1 && k <= this.params.length ? this._lijn[k - 1].op(Number.isFinite(t) ? t : this.ctx.currentTime) : null;
  }

  _stuurParams(t) {
    const d = this._druk ?? 0, m = this._mod ?? 0;
    this._post({
      t: 'param', tijd: t,
      grootte: grootteVan(this._w('grootte', t)), dichtheid: dichtheidVan(Math.min(1, this._w('dichtheid', t) + d * 0.5)),
      scan: scanVan(this._w('scan', t)), toon: toonVan(this._w('toon', t)), positie: clamp(this._w('positie', t)),
      aanzet: aanzetVan(this._w('aanzet', t)), loslaten: loslatenVan(this._w('aanzet', t)),
      spray: sprayVan(Math.min(1, this._w('spray', t) + m * 0.6)), breedte: clamp(this._w('breedte', t)),
    });
  }

  stand() {
    const nu = this.ctx.currentTime;
    return { soort: this.soort, naam: this.naam, klinkt: this.stemmen.filter((s) => s.vast || s.gehouden).length,
      params: this.params.map((_, i) => this._lijn[i].op(nu)), bron: this.bron, grond: this.grond };
  }

  _workletFout(node, e) {
    if (node !== this.node) return;
    try { node.disconnect(); } catch (_) {}
    node.onprocessorerror = null;
    try { node.port.close(); } catch (_) {}
    this.node = null;
    this._start = null;
    if (!this._weg) meldWorkletFout(this.ctx, 'het instrument Korrelwolk', { reden: foutReden(e), hint: 'de volgende noot bouwt hem opnieuw (de bron is dan weer de eigen klank)' });
  }

  vernietig() {
    if (this._weg) return;
    this.stil();
    this._weg = true;
    const h = setTimeout(() => {
      try { this.node?.port.postMessage({ t: 'stop' }); } catch (_) {}
      try { this.node?.disconnect(); } catch (_) {}
      try { this.node?.port.close(); } catch (_) {}
      try { this.uitGain.disconnect(); } catch (_) {}
      if (this.node) this.node.onprocessorerror = null;
      this.node = null;
    }, (startDrempel(this.ctx) + 0.03) * 1000 + 100);
    h?.unref?.();
  }
}

export const KORREL = {
  soort: 'korrel',
  naam: 'Korrelwolk',
  maak(ctx, { uit, klok = null, toon = null } = {}) { return new Korrel(ctx, uit, { klok, toon }); },
};
