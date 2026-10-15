import { meldWorkletFout, foutReden } from '../worklet-fout.js';
import { clamp, expMap } from '../../lib/emitter.js';
import { zetHellingen, startDrempel } from '../overgang.js';
import { stemming, STANDAARD_TOON } from '../klankschaal.js';
import { KLANKEN } from '../klankschaal-kern.js';
import { NOOTVELDEN, VELD_STEM, KLANK_NAMEN } from './schaal-kern.js';

/**
 * Schaal: de klankschaal van Varve als instrument op een track
 * (docs/INSTRUMENTEN.md §7). Een eigen worklet per track; de globale
 * `engine.klankschaal` en zijn rij blijven zoals ze zijn.
 *
 * HOE EEN MIDI-NOOT KLINKT (de keuze, §7): elke noot krijgt een eigen
 * NOTENVELD dat op precies zijn toonhoogte gestemd wordt (A4 = 69 = 440 Hz;
 * ST4: chromatisch, geen toonladderslot). Het model laat dat toe: een veld is
 * een paar resonatoren, en een resonator stemmen is een getal veranderen.
 * Tien velden = tien noten tegelijk. Dezelfde noot nog eens slaat HETZELFDE
 * veld opnieuw aan (zoals op een handpan, en zonder zweving tegen een kopie).
 * Een nieuwe noot neemt een veld dat uitgeklonken is; zijn er geen, dan het
 * oudste dat los is, anders het oudste (stemroof). Een veld dat nog klinkt
 * wordt vóór de nieuwe noot in 20 ms gedempt als de noot ver genoeg vooruit
 * gepland is (de sequencer); live gaat de oude staart naadloos mee in de
 * nieuwe toon (de resonator houdt zijn uitwijking: geen tik).
 *
 * De KERN staat op de grondtoon van wat je hoort (`toon()`: de toonsoort van
 * de maatgever, rond D3 zoals de klankschaal), in dezelfde stemming als de
 * noten: A440 + de cent van wat je hoort (de plaat staat bv. −12 ct, met de
 * pitch erbij; VRAGEN S7, zoals de globale schaal) + FIJN. Wrijven laat hem zingen: aftertouch, modwiel of de
 * knop WRIJF (de sterkste telt). Noten op zijn boventonen klinken mee.
 *
 * Snelheid = hoe hard de stok raakt: luidheid (snelheid^1,5 × kracht), maar
 * ook een kortere klop en meer glijden bij hard. noteOff dempt het veld tot
 * de uitklank van LOSLATEN (helemaal links = vrij: laten klinken zoals een
 * handpan); is alles los (geen toets, geen pedaal, niet wrijven), dan ook de
 * kern. Galm en echo: de sends van de track.
 */

export const OPHOGING = 2.73;
/** Zoals de klankschaal: de velden klonken 10–15 dB zachter dan de kern. */
const VELD_OPHOGING = 2.5;
/** Zo lang vóór een geplande noot wordt een gestolen veld gedempt (t60 0,04 s: −30 dB). */
const VOORDEMP = 0.02;
const BUIG = 200;
const WRIJF_TOEREN = 1.1;

const komma = (x, d = 1) => x.toFixed(d).replace('.', ',');
const pct = (v) => `${Math.round(clamp(v) * 100)}%`;
const tijd = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${komma(s, s < 10 ? 1 : 0)} s`);

const uitklankVan = (v) => 0.4 + clamp(v) * 1.6;                       // × 0,4 .. × 2 (de klankschaal)
const klankVan = (v) => Math.round(clamp(v) * (KLANK_NAMEN.length - 1));
const fijnVan = (v) => Math.round((clamp(v) - 0.5) * 1000) / 10;       // −50..+50 cent
/** t60 na loslaten in s; 0 = vrij (laten klinken). */
const loslatenVan = (v) => (clamp(v) < 0.02 ? 0 : expMap(1 - clamp(v), 0.12, 30));
/** Druk van de wrijfstok uit de sterkste bediening (klankschaal: 0,2 + 0,5 × kracht). */
const stokDruk = (w) => (w > 0.02 ? 0.15 + 0.55 * clamp(w) : 0);
const isSleutel = (k) => Number.isInteger(k) && k >= 0 && k < 24;
const nootHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
const panVan = (n) => clamp((n - 60) / 48, -1, 1) * 0.5;
const jit = (x, amt) => x * (1 + (Math.random() * 2 - 1) * amt);

/** De worklet-module één keer per AudioContext laden (zoals klankschaal.js). */
const modules = new WeakMap();
function laadModule(ctx) {
  if (!modules.has(ctx)) {
    const p = ctx.audioWorklet.addModule(new URL('./schaal-worklet.js', import.meta.url));
    p.catch(() => modules.delete(ctx));
    modules.set(ctx, p);
  }
  return modules.get(ctx);
}

export class Schaal {
  /**
   * @param ctx   de AudioContext van de engine
   * @param uit   waar het instrument op aansluit (chain.input van de track)
   * @param toon  () => deck.toonsoort van de maatgever (of null): de kern volgt zijn grondtoon
   */
  constructor(ctx, uit, { toon = null } = {}) {
    this.ctx = ctx;
    this.soort = 'schaal';
    this.naam = 'Klankschaal';
    this.toonVan = typeof toon === 'function' ? toon : null;
    this.uitGain = ctx.createGain();
    this.uitGain.gain.value = OPHOGING;
    this.uitGain.connect(uit);
    this.node = null;
    this._start = null;
    this._weg = false;

    this.params = [
      { id: 'karakter', label: 'karakter', standaard: 0.1,
        eenheid: (v) => (clamp(v) < 0.03 ? 'handpan' : clamp(v) > 0.97 ? 'schaal' : `${pct(v)} schaal`) },
      { id: 'uitklank', label: 'uitklank', standaard: 0.375, eenheid: (v) => tijd(this._veldT60(v)) },
      { id: 'kracht', label: 'kracht', standaard: 0.7, eenheid: pct },
      { id: 'klank', label: 'klank', standaard: 0, eenheid: (v) => KLANK_NAMEN[klankVan(v)] },
      { id: 'fijn', label: 'fijn', standaard: 0.5,
        eenheid: (v) => { const c = fijnVan(v); return c === 0 ? '0 ct' : `${c > 0 ? '+' : '−'}${komma(Math.abs(c))} ct`; } },
      { id: 'slag', label: 'slag', standaard: 0.3, eenheid: (v) => (clamp(v) < 0.03 ? 'midden' : `${pct(v)} rand`) },
      { id: 'loslaten', label: 'loslaten', standaard: 0.5, eenheid: (v) => (loslatenVan(v) ? tijd(loslatenVan(v)) : 'vrij') },
      { id: 'wrijf', label: 'wrijf', standaard: 0, gebaar: true, eenheid: (v) => (clamp(v) < 0.02 ? 'uit' : pct(v)) },
    ];
    this._w = this.params.map((p) => p.standaard);

    /** Wat de hoofdthread van elk veld weet: welke noot, sinds wanneer, tot wanneer hij hoorbaar is (t60). */
    this.velden = Array.from({ length: NOOTVELDEN }, () => ({ noot: null, t: -Infinity, einde: -Infinity, vast: false, gehouden: false }));
    this.pedaal = false;
    this.kanaalDruk = 0;
    this.drukNoot = new Map();
    this.modW = 0;
    this._p = 0;                 // stokdruk zoals de worklet hem heeft
    this._buig = 0;              // cent
    this._kernLos = false;       // kern en lichaam zijn losgelaten (korte uitklank)
    this._toon = STANDAARD_TOON; // de laatste toonsoort die hij kon volgen (nooit terug naar D)
    this._cent = 0;              // de stemming van wat je hoort (cent), ook de laatste die er was
    this._centWorklet = 0;       // de cent die de worklet in zijn fijn heeft
    this._kernHz = 0;
  }

  // ---- het contract ----------------------------------------------------------

  /** De worklet pas laden als het instrument er is: zonder kost hij niets. Idempotent. */
  start() {
    if (!this._start) {
      this._start = laadModule(this.ctx).then(() => {
        if (this._weg || this.node) return;
        const node = new AudioWorkletNode(this.ctx, 'varve-schaal-instrument', { numberOfInputs: 0, outputChannelCount: [2] });
        node.onprocessorerror = (e) => this._workletFout(node, e);
        node.connect(this.uitGain);
        this.node = node;
        this._post({ t: 'opt', fric: 1, org: 1 });
        this._stuurParams();
        this._kernHz = 0;
        this._volgToon();
        if (this._buig) this._post({ t: 'buig', c: this._buig });
        this._p = -1;
        this._stuurWrijf();
      }).catch((err) => { this._start = null; throw err; });
    }
    return this._start;
  }

  noteOn(noot, snelheid, t) {
    if (this._weg) return;
    const n = nootVan(noot);
    if (n === null) return;
    if (!(snelheid > 0)) { this.noteOff(n, t); return; }
    // Vóór start() klaar is: stil (mag volgens het contract), wel alvast laden.
    if (!this.node) { this.start().catch(() => {}); return; }
    const nu = this.ctx.currentTime;
    const t0 = Number.isFinite(t) && t > nu ? t : nu;
    this._volgToon();
    const j = this._kiesVeld(n, t0);
    const veld = this.velden[j];
    if (veld.noot !== null && veld.noot !== n && veld.einde > t0 && t0 - VOORDEMP >= nu + startDrempel(this.ctx)) {
      this._post({ t: 'los', tijd: t0 - VOORDEMP, j, t60: 0.04 });
    }
    // Hoe hard (klankschaal slaVeld, met snelheid): kracht en snelheid samen, dan waar je slaat.
    const snel = clamp(snelheid), r = this._waarde('slag');
    const v0 = jit((0.25 + 0.75 * this._waarde('kracht')) * Math.pow(snel, 1.5), 0.1) * (1 - 0.55 * r);
    const v = v0 * VELD_OPHOGING;
    const f1 = v * (1 - 0.65 * r), p2 = v * (0.45 + 0.55 * r), p3 = v * 0.3 * (0.4 + r);
    const klank = KLANKEN[KLANK_NAMEN[klankVan(this._waarde('klank'))]];
    this._post({
      t: 'slag', tijd: t0, v: VELD_STEM[j], j, hz: nootHz(n), pan: panVan(n),
      a: [f1, f1, jit(p2, 0.15), jit(p3, 0.2)],
      ms: (4.5 - 2.5 * r) * (1.4 - 0.8 * snel),       // harder en meer naar de rand: een kortere klop
      pe: v0 * v0 * 7 * klank.glijden,                 // en de toon glijdt even omhoog
      lijf: v0 * 0.12,
    });
    Object.assign(veld, { noot: n, t: t0, einde: t0 + this._veldT60(), vast: true, gehouden: false });
    if (this._kernLos) { this._post({ t: 'kernlos', tijd: t0, t60: 0 }); this._kernLos = false; }
  }

  noteOff(noot, t) {
    if (this._weg) return;
    const n = nootVan(noot);
    if (n === null) return;
    if (this.drukNoot.delete(n)) this._stuurWrijf();
    this.velden.forEach((veld, j) => {
      if (veld.noot !== n || !veld.vast) return;
      if (this.pedaal) { veld.vast = false; veld.gehouden = true; } else this._laatLos(j, t);
    });
  }

  alleUit(t) {
    if (this._weg) return;
    this.velden.forEach((veld, j) => { if (veld.vast || veld.gehouden) this._laatLos(j, t); });
    this._misschienKernLos(t);
  }

  /** Paniek: de uitgang in 10 ms dicht (na startDrempel), dan alles op nul, 0,1 s later weer open. */
  stil() {
    if (this._weg) return;
    for (const veld of this.velden) Object.assign(veld, { noot: null, t: -Infinity, einde: -Infinity, vast: false, gehouden: false });
    this.pedaal = false;
    this.kanaalDruk = 0;
    this.drukNoot.clear();
    this.modW = 0;
    this._p = 0;
    this._buig = 0;
    this._kernLos = false;
    if (!this.node) return;
    const nu = this.ctx.currentTime, wacht = startDrempel(this.ctx);
    const g = this.uitGain.gain;
    zetHellingen(g, (van) => [van, 0], nu, 0.01, wacht);
    const tStil = nu + wacht + 0.012;
    this._post({ t: 'stil', tijd: tStil });
    g.setValueAtTime(0, tStil + 0.09);
    g.linearRampToValueAtTime(OPHOGING, tStil + 0.1);
  }

  /** Aftertouch: wrijven. Met `noot` per toets (de sterkste telt), zonder voor het hele kanaal. */
  druk(w, noot) {
    if (this._weg) return;
    const d = clamp(w);
    if (noot === undefined || noot === null) this.kanaalDruk = d;
    else {
      const n = nootVan(noot);
      if (n === null) return;
      if (d > 0) this.drukNoot.set(n, d); else this.drukNoot.delete(n);
    }
    this._stuurWrijf();
  }

  /** Pitchbend −1..1 = ± 2 halve tonen op de notenvelden (de kern blijft op de toon van de plaat). */
  buig(w) {
    if (this._weg) return;
    const c = clamp(Number.isFinite(w) ? w : 0, -1, 1) * BUIG;
    if (Math.abs(c - this._buig) < 0.25 && !(c === 0 && this._buig !== 0)) return;
    this._buig = c;
    this._post({ t: 'buig', c });
  }

  /** Modwiel: wrijven, zoals aftertouch. */
  mod(w) {
    if (this._weg) return;
    this.modW = clamp(w);
    this._stuurWrijf();
  }

  houd(aan) {
    if (this._weg) return;
    this.pedaal = !!aan;
    if (this.pedaal) return;
    this.velden.forEach((veld, j) => { if (veld.gehouden) this._laatLos(j); });
  }

  zetParam(k, v) {
    if (this._weg || !Number.isInteger(k) || k < 1 || k > this.params.length || !Number.isFinite(v)) return;
    this._w[k - 1] = clamp(v);
    const id = this.params[k - 1].id;
    if (id === 'karakter' || id === 'uitklank' || id === 'klank' || id === 'fijn') this._stuurParams();
    else if (id === 'wrijf') this._stuurWrijf();
  }

  leesParam(k) {
    return Number.isInteger(k) && k >= 1 && k <= this.params.length ? this._w[k - 1] : null;
  }

  stand() {
    if (!this._weg && this.node) this._volgToon();
    const nu = this.ctx.currentTime;
    const klinkt = this.velden.filter((v) => v.t <= nu && v.einde > nu).length;
    return { soort: this.soort, naam: this.naam, klinkt, params: [...this._w] };
  }

  vernietig() {
    if (this._weg) return;
    this.stil();
    this._weg = true;
    setTimeout(() => {
      // 'stop' eerst: daarna geeft de worklet false uit process() en mag de
      // browser hem opruimen. Alleen de poort sluiten liet hem voor altijd draaien.
      try { this.node?.port.postMessage({ t: 'stop' }); } catch (_) {}
      try { this.node?.disconnect(); } catch (_) {}
      try { this.node?.port.close(); } catch (_) {}
      try { this.uitGain.disconnect(); } catch (_) {}
      this.node = null;
    }, (startDrempel(this.ctx) + 0.03) * 1000 + 100);
  }

  // ---- binnenkant ----------------------------------------------------------------

  /**
   * De worklet gooide een fout: vanaf nu stilte. Los, melden, en de volgende
   * noot bouwt hem opnieuw (noteOn roept start() aan zonder node).
   */
  _workletFout(node, e) {
    if (node !== this.node) return;
    try { node.disconnect(); } catch (_) {}
    node.onprocessorerror = null;
    try { node.port.close(); } catch (_) {}
    this.node = null;
    this._start = null;
    if (!this._weg) meldWorkletFout(this.ctx, 'het instrument Klankschaal', { reden: foutReden(e), hint: 'de volgende noot bouwt hem opnieuw' });
  }

  _waarde(id) { return this._w[this.params.findIndex((p) => p.id === id)]; }

  _post(m) { this.node?.port.postMessage(m); }

  /** De t60 van de grondtoon van een veld (schaal-kern.js `_bouwVeld`): hoe lang een noot hoorbaar is. */
  _veldT60(uitklank = this._waarde('uitklank')) {
    const M = this._waarde('karakter');
    const K = KLANKEN[KLANK_NAMEN[klankVan(this._waarde('klank'))]];
    return 3.2 * (1 + 3.5 * M) * Math.sqrt(uitklankVan(uitklank)) * (K.t[0] / 40);
  }

  /** Hetzelfde veld als die noot nog klinkt; anders een vrij veld; anders de oudste die los is; anders de oudste. */
  _kiesVeld(n, t0) {
    const v = this.velden;
    let j = v.findIndex((x) => x.noot === n && x.einde > t0);
    if (j >= 0) return j;
    const kies = (ok) => {
      let beste = -1;
      for (let i = 0; i < v.length; i++) if (ok(v[i]) && (beste < 0 || v[i].t < v[beste].t)) beste = i;
      return beste;
    };
    j = kies((x) => x.einde <= t0);
    if (j < 0) j = kies((x) => !x.vast && !x.gehouden);
    if (j < 0) j = kies(() => true);
    return j;
  }

  _laatLos(j, t) {
    const veld = this.velden[j];
    const nu = this.ctx.currentTime;
    const tLos = Math.max(Number.isFinite(t) ? t : nu, nu, veld.t);
    veld.vast = false;
    veld.gehouden = false;
    const t60 = loslatenVan(this._waarde('loslaten'));
    if (t60 > 0) {
      this._post({ t: 'los', tijd: tLos, j, t60 });
      veld.einde = Math.min(veld.einde, tLos + t60);
    }
    this._misschienKernLos(tLos);
  }

  /** Niets houdt de schaal nog vast (geen toets, geen pedaal, niet wrijven): kern en lichaam ook los. */
  _misschienKernLos(t) {
    if (this._kernLos || this.pedaal || this._p > 0) return;
    if (this.velden.some((v) => v.vast || v.gehouden)) return;
    const t60 = loslatenVan(this._waarde('loslaten'));
    if (!(t60 > 0)) return;
    const nu = this.ctx.currentTime;
    this._post({ t: 'kernlos', tijd: Math.max(Number.isFinite(t) ? t : nu, nu), t60 });
    this._kernLos = true;
  }

  _stuurParams() {
    this._centWorklet = this._cent;
    this._post({
      t: 'param', karakter: this._waarde('karakter'), uitklank: uitklankVan(this._waarde('uitklank')),
      klank: klankVan(this._waarde('klank')), fijn: fijnVan(this._waarde('fijn')) + this._cent,
    });
  }

  /** De stok volgt de sterkste van WRIJF, aftertouch (kanaal of toets) en modwiel. */
  _stuurWrijf() {
    let w = Math.max(this._waarde('wrijf'), this.kanaalDruk, this.modW);
    for (const d of this.drukNoot.values()) w = Math.max(w, d);
    const p = stokDruk(w);
    if (!this.node || Math.abs(p - this._p) < 0.004) return;
    const begint = p > 0 && !(this._p > 0);
    this._p = p;
    if (begint) {
      this._volgToon();
      if (this._kernLos) { this._post({ t: 'kernlos', t60: 0 }); this._kernLos = false; }
    }
    this._post({ t: 'wrijf', p, r: p > 0 ? WRIJF_TOEREN : 0 });
    if (p === 0) this._misschienKernLos();
  }

  /**
   * De kern op de grondtoon van wat de maatgever laat horen, en alles op zijn
   * stemming (cent); zonder toonsoort de laatste die er was.
   */
  _volgToon() {
    let h = null;
    try { h = this.toonVan ? this.toonVan() : null; } catch (_) { h = null; }
    const ts = h && typeof h.toonsoort === 'object' && h.toonsoort !== null ? h.toonsoort : h;
    if (ts && isSleutel(ts.k)) {
      this._toon = ts.k;
      this._cent = Number.isFinite(ts.cent) ? Math.max(-50, Math.min(50, ts.cent)) : 0;
    }
    if (Math.abs(this._cent - this._centWorklet) >= 0.5) this._stuurParams();
    const hz = stemming({ k: this._toon }).kernHz;
    if (this._kernHz > 0 && Math.abs(1200 * Math.log2(hz / this._kernHz)) < 0.5) return;
    this._kernHz = hz;
    this._post({ t: 'kern', hz });
  }
}

/** Een MIDI-noot 0..127 (afgerond), of null. */
function nootVan(noot) {
  if (!Number.isFinite(noot)) return null;
  const n = Math.round(noot);
  return n >= 0 && n <= 127 ? n : null;
}

export const SCHAAL = {
  soort: 'schaal',
  naam: 'Klankschaal',
  maak(ctx, { uit, toon } = {}) { return new Schaal(ctx, uit, { toon }); },
};
