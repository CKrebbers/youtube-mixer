// Herkomst: v1 youtube-mixer/src/engine/instrumenten/schaal.js @ 6a640ac (het instrument) plus de
// speelwijze van v1 src/engine/klankschaal.js (de globale klankschaal: kern en acht velden van de
// ladder aanslaan, wrijven, dempen, met de hand een toon). In v1 waren dat twee wegen naar hetzelfde
// geluid; in v2 is de klankschaal gewoon een instrument op een track (oogst produceren-029), met
// de strip, de cue en de patronen van die track. Wat verder anders is: `toon()` geeft TEKST
// ('Am') of null (stemming.js leest hem), zetParam(k, v, t) met een tijd, het instrument meldt
// zijn knoppen zelf ('param'), en het toeval van de hand (jit) komt uit een eigen zaad, zodat
// een set die opnieuw gerenderd wordt hetzelfde klinkt.
import { clamp, expMap, Emitter } from '../../kern/emitter.js';
import { zetHellingen, startDrempel } from '../overgang.js';
import { ParamLijn, nootHz, nootVan, tijdOp, laadModule, meldWorkletFout, foutReden, komma } from './hulp.js';
import { stemming, leesToon, leesToonsoort, kortNaam, STANDAARD_TOON, LADDERS, TRANSPOSITIE_MAX } from './stemming.js';
import { KLANKEN, LICHAAM } from './klankschaal-kern.js';
import { NOOTVELDEN, VELD_STEM, KLANK_NAMEN } from './schaal-kern.js';

/**
 * Klankschaal: het geluid van de Waterschaal als instrument op een track.
 *
 * HOE EEN MIDI-NOOT KLINKT: elke noot krijgt een eigen NOTENVELD dat op precies zijn toonhoogte
 * gestemd wordt (A4 = 69 = 440 Hz; chromatisch, geen toonladderslot). Tien velden = tien noten
 * tegelijk. Dezelfde noot nog eens slaat HETZELFDE veld opnieuw aan. Een nieuwe noot neemt een
 * veld dat uitgeklonken is; anders het oudste dat los is, anders het oudste (stemroof). Een veld
 * dat nog klinkt wordt vóór een vooruit geplande noot in 20 ms gedempt; live gaat de staart
 * naadloos mee in de nieuwe toon (de resonator houdt zijn amplitude: geen tik).
 *
 * DE KERN staat op de grondtoon van wat je hoort (`toon()`, rond D3), in dezelfde stemming als de
 * noten: A440 + de cent van wat je hoort + FIJN. Wrijven laat hem zingen: aftertouch, modwiel, de
 * knop WRIJF of wrijf(true) (de sterkste telt). Noten op zijn boventonen klinken mee.
 *
 * DE LADDER (de speelwijze van de klankschaal van v1): slaKern() en slaVeld(1..8) slaan de kern en
 * de acht velden van de ladder op de toon van wat je hoort aan (Kurd bij mineur, majeur bij
 * majeur, of een vaste ladder; past hij niet, de relatieve toonsoort). Zo'n veld klinkt vrij uit
 * zoals op een handpan. demp() legt een hand op de schaal.
 *
 * Snelheid = hoe hard de stok raakt: luidheid, een kortere klop en meer glijden bij hard.
 * noteOff dempt het veld tot de uitklank van LOSLATEN (helemaal links = vrij); is alles los (geen
 * toets, geen pedaal, niet wrijven), dan ook de kern. Galm en echo: de sends van de track.
 */

/** Luidheid naast een nummer van −14 LUFS (v1 gemeten: −13,93 LUFS; v2: tools/proef-instr.mjs). */
export const OPHOGING = 2.73;
/** Zoals de klankschaal: de velden klonken 10–15 dB zachter dan de kern. */
const VELD_OPHOGING = 2.5;
/** Zo lang vóór een geplande noot wordt een gestolen veld gedempt (t60 0,04 s: −30 dB). */
const VOORDEMP = 0.02;
const BUIG = 200;
const WRIJF_TOEREN = 1.1;

const pct = (v) => `${Math.round(clamp(v) * 100)}%`;
const tijd = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${komma(s, s < 10 ? 1 : 0)} s`);

export const uitklankVan = (v) => 0.4 + clamp(v) * 1.6;                     // × 0,4 .. × 2
export const klankVan = (v) => Math.round(clamp(v) * (KLANK_NAMEN.length - 1));
export const fijnVan = (v) => Math.round((clamp(v) - 0.5) * 1000) / 10;     // −50..+50 cent
/** t60 na loslaten in s; 0 = vrij (laten klinken). */
export const loslatenVan = (v) => (clamp(v) < 0.02 ? 0 : expMap(1 - clamp(v), 0.12, 30));
/** Druk van de wrijfstok uit de sterkste bediening. */
const stokDruk = (w) => (w > 0.02 ? 0.15 + 0.55 * clamp(w) : 0);
const panVan = (n) => clamp((n - 60) / 48, -1, 1) * 0.5;

const WORKLET = new URL('./schaal-worklet.js', import.meta.url);

export class Schaal extends Emitter {
  /**
   * @param ctx   de AudioContext van de engine
   * @param uit   waar het instrument op aansluit (de ingang van de strip van de track)
   * @param toon  () => toonsoort-tekst ('Am') of null: wat je hoort; de kern volgt zijn grondtoon
   * @param klok  de maatklok (of null); de Klankschaal gebruikt hem niet
   * @param zaad  het toeval van de hand (jit): dezelfde zaad, dezelfde aanslagen
   */
  constructor(ctx, uit, { toon = null, klok = null, zaad = 1 } = {}) {
    super();
    this.ctx = ctx;
    this.soort = 'schaal';
    this.naam = 'Klankschaal';
    this.toonVan = typeof toon === 'function' ? toon : null;
    this.klok = klok;
    this._zaad = (zaad >>> 0) || 1;
    this.uitGain = ctx.createGain();
    this.uitGain.gain.value = OPHOGING;
    this.uitGain.connect(uit);
    this.node = null;
    this._start = null;
    this._weg = false;

    this.params = Object.freeze([
      { id: 'karakter', label: 'karakter', standaard: 0.1,
        eenheid: (v) => (clamp(v) < 0.03 ? 'handpan' : clamp(v) > 0.97 ? 'schaal' : `${pct(v)} schaal`) },
      { id: 'uitklank', label: 'uitklank', standaard: 0.375, eenheid: (v) => tijd(this._veldT60(this.ctx.currentTime, v)) },
      { id: 'kracht', label: 'kracht', standaard: 0.7, eenheid: pct },
      { id: 'klank', label: 'klank', standaard: 0, eenheid: (v) => KLANK_NAMEN[klankVan(v)] },
      { id: 'fijn', label: 'fijn', standaard: 0.5,
        eenheid: (v) => { const c = fijnVan(v); return c === 0 ? '0 ct' : `${c > 0 ? '+' : '−'}${komma(Math.abs(c))} ct`; } },
      { id: 'slag', label: 'slag', standaard: 0.3, eenheid: (v) => (clamp(v) < 0.03 ? 'midden' : `${pct(v)} rand`) },
      { id: 'loslaten', label: 'loslaten', standaard: 0.5, eenheid: (v) => (loslatenVan(v) ? tijd(loslatenVan(v)) : 'vrij') },
      { id: 'wrijf', label: 'wrijf', standaard: 0, gebaar: true, eenheid: (v) => (clamp(v) < 0.02 ? 'uit' : pct(v)) },
    ].map((p) => Object.freeze(p)));
    this._lijn = this.params.map((p) => new ParamLijn(p.standaard));
    this._P = Object.fromEntries(this.params.map((p, i) => [p.id, i]));

    /** Wat de hoofdthread van elk veld weet: welke noot, sinds wanneer, tot wanneer hij hoorbaar is (t60). */
    this.velden = Array.from({ length: NOOTVELDEN }, () => ({ noot: null, t: -Infinity, einde: -Infinity, vast: false, gehouden: false }));
    this.pedaal = false;
    this.kanaalDruk = 0;
    this.drukNoot = new Map();
    this.modW = 0;
    this._wrijft = false;         // wrijf(true): de stok op de schaal
    this._dempt = false;
    this._p = 0;                  // stokdruk zoals de worklet hem heeft
    this._buig = 0;               // cent
    this._kernLos = false;        // kern en lichaam zijn losgelaten (korte uitklank)
    this._toon = STANDAARD_TOON;  // de laatste toonsoort die hij kon volgen (nooit terug naar D)
    this._cent = 0;               // de stemming van wat je hoort (cent), ook de laatste die er was
    this._centWorklet = 0;
    this._kernHz = 0;
    this._hand = null;            // een vaste toonsoort (0..23) in plaats van wat je hoort, of null
    this.ladder = 'auto';
    this.transpositie = 0;
    this._geslagen = new Float64Array(9).fill(-Infinity);   // kern (0) en ladderveld 1..8: wanneer
  }

  /** Toeval van de hand, uit het eigen zaad (LCG): −1..1. */
  _rnd() { this._zaad = (Math.imul(this._zaad, 1664525) + 1013904223) >>> 0; return this._zaad / 2147483648 - 1; }
  _jit(x, amt) { return x * (1 + this._rnd() * amt); }

  _w(id, t = this.ctx.currentTime) { return this._lijn[this._P[id]].op(t); }

  // ---- het contract ----------------------------------------------------------

  /** De worklet pas laden als het instrument er is: zonder kost hij niets. Idempotent. */
  start() {
    if (!this._start) {
      this._start = laadModule(this.ctx, WORKLET).then(() => {
        if (this._weg || this.node) return;
        const node = new AudioWorkletNode(this.ctx, 'varve-schaal-instrument', { numberOfInputs: 0, outputChannelCount: [2] });
        node.onprocessorerror = (e) => this._workletFout(node, e);
        node.connect(this.uitGain);
        this.node = node;
        this._post({ t: 'opt', fric: 1, org: 1 });
        this._stuurParams(this.ctx.currentTime);
        this._kernHz = 0;
        this._volgToon();
        if (this._buig) this._post({ t: 'buig', c: this._buig });
        if (this._dempt) this._post({ t: 'demp', v: -1, aan: true });
        this._p = -1;
        this._stuurWrijf();
      }).catch((err) => { this._start = null; throw err; });
    }
    return this._start;
  }

  noteOn(noot, snelheid, t) {
    const n = nootVan(noot);
    if (this._weg || n === null) return;
    if (!(snelheid > 0)) { this.noteOff(n, t); return; }
    this._slaan(n, nootHz(n), snelheid, t, true);
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
    this._wrijft = false;
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

  /** Plek k (1..8) vanaf `t` (leeg = nu): karakter, uitklank, klank en fijn gaan op hun tijd naar de worklet. */
  zetParam(k, v, t) {
    if (this._weg || !Number.isInteger(k) || k < 1 || k > this.params.length || !Number.isFinite(v)) return;
    const nu = this.ctx.currentTime, t1 = tijdOp(this.ctx, t);
    const lijn = this._lijn[k - 1];
    lijn.ruim(nu);
    lijn.zet(v, t1);
    const id = this.params[k - 1].id;
    if (id === 'karakter' || id === 'uitklank' || id === 'klank' || id === 'fijn') this._stuurParams(t1);
    else if (id === 'wrijf') this._stuurWrijf(t1);
    this.emit('param', { k, v: lijn.op(t1), t: t1 });
  }

  leesParam(k, t) {
    return Number.isInteger(k) && k >= 1 && k <= this.params.length ? this._lijn[k - 1].op(Number.isFinite(t) ? t : this.ctx.currentTime) : null;
  }

  stand() {
    if (!this._weg && this.node) this._volgToon();
    const nu = this.ctx.currentTime;
    const klinkt = this.velden.filter((v) => v.t <= nu && v.einde > nu).length;
    return { soort: this.soort, naam: this.naam, klinkt, params: this.params.map((_, i) => this._lijn[i].op(nu)), ladder: this.ladderStand() };
  }

  vernietig() {
    if (this._weg) return;
    this.stil();
    this._weg = true;
    const h = setTimeout(() => {
      // 'stop' eerst: daarna geeft de worklet false uit process() en mag de browser hem
      // opruimen. Alleen de poort sluiten liet hem in v1 voor altijd draaien.
      try { this.node?.port.postMessage({ t: 'stop' }); } catch (_) {}
      try { this.node?.disconnect(); } catch (_) {}
      try { this.node?.port.close(); } catch (_) {}
      try { this.uitGain.disconnect(); } catch (_) {}
      if (this.node) this.node.onprocessorerror = null;
      this.node = null;
    }, (startDrempel(this.ctx) + 0.03) * 1000 + 100);
    h?.unref?.();
  }

  // ---- de ladder (de speelwijze van de klankschaal) ------------------------------

  /** De stemming waar de ladder nu op staat (stemming.js), zonder de cent: die zit in fijn. */
  _ladder() {
    return stemming({ k: this._hand ?? this._toon, ladder: this.ladder, transpositie: this.transpositie });
  }

  /**
   * Veld j (1..8) van de ladder aanslaan, op de toon van wat je hoort. Het veld klinkt vrij
   * uit zoals op een handpan (loslaten geldt hier niet).
   */
  slaVeld(j, snelheid = 0.8, t) {
    if (this._weg || !(Number.isInteger(j) && j >= 1 && j <= 8)) return;
    this._volgToonVeilig();
    const v = this._ladder().velden[j - 1];
    if (this._slaan(v.midi, nootHz(v.midi), snelheid, t, false)) this._geslagen[j] = tijdOp(this.ctx, t);
  }

  /** De kern aanslaan (Waterschaal strikeKern): zes paren boventonen, met het lichaam erbij. */
  slaKern(snelheid = 0.8, t) {
    if (this._weg) return;
    if (!this.node) { this.start().catch(() => {}); return; }
    const t0 = tijdOp(this.ctx, t);
    this._volgToon();
    const snel = clamp(snelheid);
    const vel = this._jit((0.25 + 0.75 * this._w('kracht', t0)) * Math.pow(snel, 1.5), 0.08);
    const phi = (this._rnd() + 1) * Math.PI / 2, a = [];
    const amps = [1, 0.8, 0.6, 0.45, 0.3, 0.2];
    for (let k = 0; k < 6; k++) {
      const n = k + 2, amp = this._jit(amps[k] * vel * 0.55 * Math.pow(0.86, k), 0.12);
      a.push(amp * Math.cos(n * phi), amp * Math.sin(n * phi));
    }
    const klank = KLANKEN[KLANK_NAMEN[klankVan(this._w('klank', t0))]];
    if (this._kernLos) { this._post({ t: 'kernlos', tijd: t0, t60: 0 }); this._kernLos = false; }
    this._post({ t: 'slag', tijd: t0, v: 0, a, ms: 3.5, pe: vel * vel * 5 * klank.glijden });
    this._post({ t: 'slag', tijd: t0, v: LICHAAM, a: [vel * 0.15] });
    this._geslagen[0] = t0;
  }

  /** Wrijven zolang `aan`: de kern gaat zingen (stick-slip, bouwt in ~½ s op), met de kracht van KRACHT. */
  wrijf(aan) {
    if (this._weg) return;
    this._wrijft = !!aan;
    if (this._wrijft && !this.node) this.start().catch(() => {});
    this._stuurWrijf();
  }

  /** Dempen zolang `aan`: alles zwijgt binnen ~0,1 s (een hand op de schaal). */
  demp(aan, t) {
    if (this._weg) return;
    this._dempt = !!aan;
    this._post({ t: 'demp', v: -1, aan: this._dempt, tijd: tijdOp(this.ctx, t) });
  }

  /** De ladder: 'auto' (Kurd bij mineur, majeur bij majeur) of een vaste (stemming.js LADDERS). */
  zetLadder(l) { if (LADDERS.includes(l)) this.ladder = l; }

  /** Een vaste toonsoort ('Am', 'F#', of 0..23) in plaats van wat je hoort; null = weer volgen. */
  zetHand(toonsoort) {
    if (toonsoort === null || toonsoort === undefined) { this._hand = null; this._volgToonVeilig(); return; }
    const k = leesToonsoort(toonsoort);
    if (k === null) return;
    this._hand = k;
    this._volgToonVeilig();
  }

  /** Halve tonen erbij voor de ladder (hooguit ±12). Noten blijven noten. */
  zetTranspositie(n) {
    if (!Number.isFinite(n)) return;
    this.transpositie = Math.max(-TRANSPOSITIE_MAX, Math.min(TRANSPOSITIE_MAX, Math.round(n)));
  }

  /** Voor het scherm: op welke toon de schaal staat, de namen van kern en velden, wat net klonk. */
  ladderStand() {
    const st = stemming({ k: this._hand ?? this._toon, cent: this._cent, ladder: this.ladder, transpositie: this.transpositie });
    const nu = this.ctx.currentTime;
    return {
      toon: kortNaam(st.k), hand: this._hand !== null, ladder: st.ladder, ladderNaam: st.ladderNaam, relatief: st.relatief,
      cent: st.cent, kern: st.kernNaam, velden: st.velden.map((v) => v.naam),
      raak: Array.from(this._geslagen, (t) => nu - t >= 0 && nu - t < 0.25), wrijft: this._wrijft, dempt: this._dempt,
    };
  }

  // ---- binnenkant ----------------------------------------------------------------

  /**
   * Eén aanslag op een notenveld op toonhoogte `hz`, met `noot` als sleutel (zelfde noot =
   * zelfde veld). `vast` = een toets die je vasthoudt (noteOff laat los); false = vrij uitklinken.
   * Geeft false als de worklet er nog niet is (dan wordt hij geladen; de aanslag is stil).
   */
  _slaan(n, hzNoot, snelheid, t, vast) {
    // Vóór start() klaar is: stil (mag volgens het contract), wel alvast laden.
    if (!this.node) { this.start().catch(() => {}); return false; }
    const nu = this.ctx.currentTime;
    const t0 = tijdOp(this.ctx, t);
    this._volgToon();
    const j = this._kiesVeld(n, t0);
    const veld = this.velden[j];
    if (veld.noot !== null && veld.noot !== n && veld.einde > t0 && t0 - VOORDEMP >= nu + startDrempel(this.ctx)) {
      this._post({ t: 'los', tijd: t0 - VOORDEMP, j, t60: 0.04 });
    }
    // Hoe hard: kracht en snelheid samen, dan waar je slaat (rand = minder grondtoon).
    const snel = clamp(snelheid), r = this._w('slag', t0);
    const v0 = this._jit((0.25 + 0.75 * this._w('kracht', t0)) * Math.pow(snel, 1.5), 0.1) * (1 - 0.55 * r);
    const v = v0 * VELD_OPHOGING;
    const f1 = v * (1 - 0.65 * r), p2 = v * (0.45 + 0.55 * r), p3 = v * 0.3 * (0.4 + r);
    const klank = KLANKEN[KLANK_NAMEN[klankVan(this._w('klank', t0))]];
    this._post({
      t: 'slag', tijd: t0, v: VELD_STEM[j], j, hz: hzNoot, pan: panVan(n),
      a: [f1, f1, this._jit(p2, 0.15), this._jit(p3, 0.2)],
      ms: (4.5 - 2.5 * r) * (1.4 - 0.8 * snel),       // harder en meer naar de rand: een kortere klop
      pe: v0 * v0 * 7 * klank.glijden,                 // en de toon glijdt even omhoog
      lijf: v0 * 0.12,
    });
    Object.assign(veld, { noot: n, t: t0, einde: t0 + this._veldT60(t0), vast, gehouden: false });
    if (this._kernLos) { this._post({ t: 'kernlos', tijd: t0, t60: 0 }); this._kernLos = false; }
    return true;
  }

  /** De worklet gooide een fout: vanaf nu stilte. Los, melden, en de volgende noot bouwt hem opnieuw. */
  _workletFout(node, e) {
    if (node !== this.node) return;
    try { node.disconnect(); } catch (_) {}
    node.onprocessorerror = null;
    try { node.port.close(); } catch (_) {}
    this.node = null;
    this._start = null;
    if (!this._weg) meldWorkletFout(this.ctx, 'het instrument Klankschaal', { reden: foutReden(e), hint: 'de volgende noot bouwt hem opnieuw' });
  }

  _post(m) { this.node?.port.postMessage(m); }

  /** De t60 van de grondtoon van een veld op t (schaal-kern.js `_bouwVeld`): hoe lang een noot hoorbaar is. */
  _veldT60(t, uitklank = this._w('uitklank', t)) {
    const M = this._w('karakter', t);
    const K = KLANKEN[KLANK_NAMEN[klankVan(this._w('klank', t))]];
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
    const t60 = loslatenVan(this._w('loslaten', tLos));
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
    const nu = this.ctx.currentTime;
    const tLos = Math.max(Number.isFinite(t) ? t : nu, nu);
    const t60 = loslatenVan(this._w('loslaten', tLos));
    if (!(t60 > 0)) return;
    this._post({ t: 'kernlos', tijd: tLos, t60 });
    this._kernLos = true;
  }

  _stuurParams(t) {
    this._centWorklet = this._cent;
    this._post({
      t: 'param', tijd: t, karakter: this._w('karakter', t), uitklank: uitklankVan(this._w('uitklank', t)),
      klank: klankVan(this._w('klank', t)), fijn: fijnVan(this._w('fijn', t)) + this._cent,
    });
  }

  /** De stok volgt de sterkste van WRIJF, wrijf(), aftertouch (kanaal of toets) en modwiel. */
  _stuurWrijf(t) {
    const tw = tijdOp(this.ctx, t);
    let w = Math.max(this._w('wrijf', tw), this.kanaalDruk, this.modW, this._wrijft ? this._w('kracht', tw) : 0);
    for (const d of this.drukNoot.values()) w = Math.max(w, d);
    const p = stokDruk(w);
    if (!this.node || Math.abs(p - this._p) < 0.004) return;
    const begint = p > 0 && !(this._p > 0);
    this._p = p;
    if (begint) {
      this._volgToon();
      if (this._kernLos) { this._post({ t: 'kernlos', tijd: tw, t60: 0 }); this._kernLos = false; }
    }
    this._post({ t: 'wrijf', tijd: tw, p, r: p > 0 ? WRIJF_TOEREN : 0 });
    if (p === 0) this._misschienKernLos(tw);
  }

  _volgToonVeilig() { if (this.node) this._volgToon(); }

  /**
   * De kern op de grondtoon van wat je hoort (of de hand), en alles op zijn stemming (cent);
   * zonder toonsoort de laatste die er was. Onder een halve cent verschil niets opnieuw.
   */
  _volgToon() {
    let h = null;
    try { h = leesToon(this.toonVan ? this.toonVan() : null); } catch (_) { h = null; }
    if (h) { this._toon = h.k; this._cent = h.cent; }
    if (Math.abs(this._cent - this._centWorklet) >= 0.5) this._stuurParams(this.ctx.currentTime);
    const hz = stemming({ k: this._hand ?? this._toon, transpositie: this.transpositie }).kernHz;
    if (this._kernHz > 0 && Math.abs(1200 * Math.log2(hz / this._kernHz)) < 0.5) return;
    this._kernHz = hz;
    this._post({ t: 'kern', hz });
  }
}

export const SCHAAL = {
  soort: 'schaal',
  naam: 'Klankschaal',
  maak(ctx, { uit, toon = null, klok = null } = {}) { return new Schaal(ctx, uit, { toon, klok }); },
};
