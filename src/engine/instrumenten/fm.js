import { clamp, expMap } from '../../lib/emitter.js';
import { komma, hz } from '../../lib/notatie.js';
import { houdVast, startDrempel } from '../overgang.js';

/**
 * FM: de stemmen van MediSynth als instrument op een track (docs/INSTRUMENTEN.md §7).
 *
 * Overgenomen uit MediSynth-hub (`src/audio/engine.js`, `noteOn`, en de stem
 * van de stemming "Glass" in `src/core/mood.js`): harmonische FM met een
 * modulatie-index die uitklinkt, een draaggolf als PeriodicWave (zachte,
 * donkere boventonen), twee draaggolven in unison die een vast aantal Hz
 * tegen elkaar zweven (`detuneCents`: in de bas net zo traag als in de
 * hoogte), een lowpass, een envelope en een panner. Twaalf stemmen.
 *
 * Wat NIET meekomt (ST4: de regels van MediSynth gelden hier niet): de
 * toonladder (een MIDI-noot is een toonhoogte, A4 = 69 = 440 Hz), de
 * minimale aanslag van 200 ms, het plafond op de helderheid, de weer-laag,
 * de galm, de korrelwolk, de tape-warmte en de bewaker (normaliser, limiter):
 * galm en echo komen van de sends van de track, de limiter van de master.
 * Het instrument is droog en hangt aan `uit` (de kanaalstrip), niet aan
 * `ctx.destination`. Alleen gewone Web Audio-nodes: niets om te laden.
 *
 * Per stem:
 *
 *   mod (sinus, hz × ratio) ─► vorm (1 → 5%) ─► diepte (Hz) ─┬─► draag 1 .frequency
 *                                                             └─► draag 2 .frequency
 *   draag 1, draag 2 (PeriodicWave, ± de helft van de zweving) ─► filter ─► env ─► pan ─► som
 *   buiging (ConstantSource, cent) en vibrato (LFO × diepte, cent) ─► .detune van alle drie
 *
 *   som ─┬─► droog (1 − w) ──────────────────────────────┬─► uitGain ─► uit
 *        └─► voor ─► tanh (WaveShaper, 4×) ─► na (w) ─────┘
 *
 * Regels: noten op de audioklok (`t`), envelopes van houdVast met
 * hellingen en setTargetAtTime (nooit setValueCurveAtTime), stemroof en
 * paniek met een lineaire helling van 8 ms na startDrempel.
 */

/** De draaggolf van "Glass" (mood.js voice.spectrum): sinuscoëfficiënten van de boventonen. */
const SPECTRUM = [1, 0.5, 0.22, 0.1, 0.05, 0.02];
export const STEMMEN = 12;
/** Zo snel dooft een stem bij stemroof en bij stil() (lineair, na startDrempel). */
export const ROOF = 0.008;
/**
 * Luidheid naast een nummer van −14 LUFS: een akkoord van drie noten (C4 E4 G4)
 * op snelheid 0,8, drie seconden vastgehouden, standaardknoppen, gemeten met
 * BS.1770 in Chrome (`tools/headless/instrumenten.mjs`). Zie INSTRUMENTEN.md §7.
 */
export const OPHOGING = 0.55;
/** Pitchbend ± 2 halve tonen; modwiel = vibrato tot ± 30 cent op 5,5 Hz. */
const BUIG = 200;
const VIBRATO_HZ = 5.5;
const VIBRATO_MAX = 30;
/** Aftertouch: de index tot × 2,5 en het filter tot × 1,5 open. */
const DRUK_INDEX = 1.5;
const DRUK_FILTER = 0.5;
/** Waar een parameter heen glijdt als je draait (s, setTargetAtTime). */
const GLIJ = 0.02;

/** De verhoudingen modulator : draaggolf. Hele getallen klinken harmonisch; 1,41 en 2,76 als klok. */
export const RATIOS = [0.5, 1, 1.41, 2, 2.76, 3, 3.5, 4, 5, 7];

// ---- de knoppen: één formule voor het geluid én voor wat het scherm zegt -------

const indexVan = (v) => 8 * clamp(v) * clamp(v);
const ratioVan = (v) => RATIOS[Math.round(clamp(v) * (RATIOS.length - 1))];
const aanslagVan = (v) => expMap(v, 0.001, 4);
/** Het verval: de index zakt met τ = verval/2 (zoals MediSynth), het volume met τ = 3 × verval; helemaal open = geen verval. */
const vervalVan = (v) => (clamp(v) >= 0.995 ? Infinity : expMap(v, 0.05, 20));
const releaseVan = (v) => expMap(v, 0.005, 10);
/** De zweving tussen de twee draaggolven in Hz (MediSynth: unisonBeatHz 1,0). */
const zwevingVan = (v) => 6 * clamp(v) * clamp(v);
/** Kantelfrequentie bij A4; het filter volgt de noot voor de helft (√(hz/440)). */
const filterVan = (v) => expMap(v, 200, 18000);
const warmteVan = (v) => clamp(v);

const tijd = (s) => (!Number.isFinite(s) ? '∞' : s < 1 ? `${Math.round(s * 1000)} ms` : `${komma(s, s < 10 ? 1 : 0)} s`);

/** De acht plekken (plek k = PARAMS[k - 1]). `standaard` komt dicht bij de stem van "Glass", maar speelbaar (ST4). */
export const PARAMS = [
  { id: 'index', label: 'index', standaard: 0.42, eenheid: (v) => komma(indexVan(v)) },
  { id: 'ratio', label: 'ratio', standaard: 3 / 9, eenheid: (v) => `1 : ${String(ratioVan(v)).replace('.', ',')}` },
  { id: 'aanslag', label: 'aanslag', standaard: 0.25, eenheid: (v) => tijd(aanslagVan(v)) },
  { id: 'verval', label: 'verval', standaard: 0.58, eenheid: (v) => tijd(vervalVan(v)) },
  { id: 'release', label: 'release', standaard: 0.72, eenheid: (v) => tijd(releaseVan(v)) },
  { id: 'zweving', label: 'zweving', standaard: 0.41, eenheid: (v) => `${komma(zwevingVan(v))} Hz` },
  { id: 'filter', label: 'filter', standaard: 0.57, eenheid: (v) => `${hz(filterVan(v))} bij A4` },
  { id: 'warmte', label: 'warmte', standaard: 0, eenheid: (v) => (warmteVan(v) < 0.01 ? 'uit' : `${Math.round(warmteVan(v) * 100)}%`) },
];

const nootHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
/** Cent tussen twee draaggolven die `beat` Hz tegen elkaar zweven (MediSynth `detuneCents`, zonder zijn plafond). */
const zwevingCent = (f, beat) => 1200 * Math.log2((f + beat) / f);
/** Stereo naar toonhoogte, zoals een piano: laag links, hoog rechts, hooguit ± 0,35. */
const panVan = (n) => clamp((n - 60) / 48, -1, 1) * 0.35;

/** Een tanh-kromme over ± 4: de WaveShaper krijgt ± 1, dus de voorversterking deelt door 4. */
function tanhKromme(n = 2049) {
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) k[i] = Math.tanh(4 * (i / (n - 1) * 2 - 1));
  return k;
}

export class Fm {
  /**
   * @param ctx  de AudioContext van de engine
   * @param uit  waar het instrument op aansluit (chain.input van de track)
   */
  constructor(ctx, uit) {
    this.ctx = ctx;
    this.soort = 'fm';
    this.naam = 'FM';
    this.params = PARAMS;
    this._w = PARAMS.map((p) => p.standaard);
    /** @type {any[]} */
    this.stemmen = [];
    this.pedaal = false;
    this.kanaalDruk = 0;
    this._weg = false;

    this.golf = ctx.createPeriodicWave(new Float32Array(SPECTRUM.length + 1),
      Float32Array.from([0, ...SPECTRUM]));

    // Uitgang met warmte: droog + (tanh × w). Klein signaal: precies 1×, wat w ook is.
    this.som = ctx.createGain();
    this.droog = ctx.createGain();
    this.voor = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = tanhKromme();
    this.shaper.oversample = '4x';
    this.na = ctx.createGain();
    this.uitGain = ctx.createGain();
    this.som.connect(this.droog).connect(this.uitGain);
    this.som.connect(this.voor).connect(this.shaper).connect(this.na).connect(this.uitGain);
    this.uitGain.connect(uit);
    this._zetWarmte(ctx.currentTime, true);

    // Gedeeld door alle stemmen: buiging en vibrato, in cent op .detune.
    this.buigBron = ctx.createConstantSource();
    this.buigBron.offset.value = 0;
    this.buigBron.start();
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = VIBRATO_HZ;
    this.vibrato = ctx.createGain();
    this.vibrato.gain.value = 0;
    this.lfo.connect(this.vibrato);
    this.lfo.start();
  }

  // ---- het contract ----------------------------------------------------------

  /** Niets om te laden: alles is een gewone Web Audio-node. */
  start() { return Promise.resolve(); }

  /**
   * Een noot aanslaan. `t` op de audioklok; undefined of voorbij = nu.
   * Dezelfde noot die nog vastgehouden wordt, gaat eerst los (MediSynth doet hetzelfde).
   */
  noteOn(noot, snelheid, t) {
    if (this._weg) return;
    const n = nootVan(noot);
    if (n === null) return;
    if (!(snelheid > 0)) { this.noteOff(n, t); return; }
    const nu = this.ctx.currentTime;
    const t0 = Number.isFinite(t) && t > nu ? t : nu;
    this._ruim(nu);
    for (const s of this.stemmen) if (s.noot === n && !s.weg && s.los === null) this._laatLos(s, t0);
    // Stemroof: eerst de oudste die al los is, anders de oudste.
    for (;;) {
      const levend = this.stemmen.filter((s) => !s.weg && s.einde > t0);
      if (levend.length < STEMMEN) break;
      const los = levend.filter((s) => s.los !== null);
      const oudste = (los.length ? los : levend).reduce((a, b) => (b.t0 < a.t0 ? b : a));
      this._dooft(oudste, Math.max(nu + startDrempel(this.ctx), t0 - ROOF));
    }
    this.stemmen.push(this._maakStem(n, clamp(snelheid), t0));
  }

  /** Los: de stem klinkt uit met zijn release. Met het pedaal ingedrukt wacht hij daarop. */
  noteOff(noot, t) {
    if (this._weg) return;
    const n = nootVan(noot);
    if (n === null) return;
    for (const s of this.stemmen) {
      if (s.noot !== n || s.weg || s.los !== null || s.gehouden) continue;
      if (this.pedaal) s.gehouden = true;
      else this._laatLos(s, t);
    }
  }

  /** Alles los (ook wat het pedaal vasthoudt); het pedaal zelf blijft zoals het is. */
  alleUit(t) {
    if (this._weg) return;
    for (const s of this.stemmen) if (!s.weg && s.los === null) this._laatLos(s, t);
  }

  /** Paniek: alles binnen startDrempel + 8 ms stil, met een helling (geen tik). Ook pedaal, druk, buiging en vibrato terug. */
  stil() {
    if (this._weg) return;
    const nu = this.ctx.currentTime;
    const t = nu + startDrempel(this.ctx);
    for (const s of this.stemmen) if (!s.weg) this._dooft(s, t);
    this.pedaal = false;
    this.kanaalDruk = 0;
    this.buigBron.offset.setTargetAtTime(0, nu, 0.005);
    this.vibrato.gain.setTargetAtTime(0, nu, 0.02);
  }

  /** Aftertouch 0..1: meer modulatie (helderder) en het filter verder open. Zonder `noot` voor het hele kanaal. */
  druk(w, noot) {
    if (this._weg) return;
    const d = clamp(w);
    const n = noot === undefined || noot === null ? null : nootVan(noot);
    if (n === null && noot !== undefined && noot !== null) return;
    if (n === null) this.kanaalDruk = d;
    const nu = this.ctx.currentTime;
    for (const s of this.stemmen) {
      if (s.weg || (n !== null && s.noot !== n)) continue;
      if (n !== null) s.druk = d;
      this._werkStemBij(s, nu, false);
    }
  }

  /** Pitchbend −1..1 = ± 2 halve tonen, op alle stemmen (ook de volgende). */
  buig(w) {
    if (this._weg) return;
    const c = clamp(Number.isFinite(w) ? w : 0, -1, 1) * BUIG;
    this.buigBron.offset.setTargetAtTime(c, this.ctx.currentTime, 0.005);
  }

  /** Modwiel 0..1 = vibrato, tot ± 30 cent op 5,5 Hz. */
  mod(w) {
    if (this._weg) return;
    this.vibrato.gain.setTargetAtTime(clamp(w) * VIBRATO_MAX, this.ctx.currentTime, 0.02);
  }

  /** Sustainpedaal: noteOff wacht tot het los is. */
  houd(aan) {
    if (this._weg) return;
    this.pedaal = !!aan;
    if (this.pedaal) return;
    for (const s of this.stemmen) if (s.gehouden && !s.weg && s.los === null) this._laatLos(s);
  }

  zetParam(k, v) {
    if (this._weg || !Number.isInteger(k) || k < 1 || k > PARAMS.length || !Number.isFinite(v)) return;
    this._w[k - 1] = clamp(v);
    const id = PARAMS[k - 1].id, nu = this.ctx.currentTime;
    if (id === 'warmte') { this._zetWarmte(nu); return; }
    // Wat meteen hoorbaar mag zijn op wat klinkt: index, ratio, zweving, filter.
    // Aanslag, verval en release horen bij de volgende noot (of de volgende noteOff).
    if (id === 'index' || id === 'ratio' || id === 'zweving' || id === 'filter') {
      for (const s of this.stemmen) if (!s.weg) this._werkStemBij(s, nu);
    }
  }

  leesParam(k) {
    return Number.isInteger(k) && k >= 1 && k <= PARAMS.length ? this._w[k - 1] : null;
  }

  stand() {
    const nu = this.ctx.currentTime;
    if (!this._weg) this._ruim(nu);
    const klinkt = this.stemmen.filter((s) => !s.weg && s.t0 <= nu && s.einde > nu).length;
    return { soort: this.soort, naam: this.naam, klinkt, params: [...this._w] };
  }

  vernietig() {
    if (this._weg) return;
    this.stil();
    this._weg = true;
    const weg = () => {
      for (const s of this.stemmen) this._ontkoppel(s);
      this.stemmen = [];
      for (const n of [this.lfo, this.buigBron]) { try { n.stop(); } catch (_) {} }
      for (const n of [this.lfo, this.vibrato, this.buigBron, this.som, this.droog, this.voor, this.shaper, this.na, this.uitGain]) {
        try { n.disconnect(); } catch (_) {}
      }
    };
    // Eerst de helling van stil() laten klinken: losmaken terwijl er signaal loopt tikt.
    setTimeout(weg, (startDrempel(this.ctx) + ROOF) * 1000 + 60);
  }

  // ---- de stemmen --------------------------------------------------------------

  _waarde(id) { return this._w[PARAMS.findIndex((p) => p.id === id)]; }

  /** De diepte van de frequentiemodulatie in Hz: index × modulatorfrequentie, met snelheid en druk. */
  _diepte(s) {
    const druk = Math.max(this.kanaalDruk, s.druk);
    return indexVan(this._waarde('index')) * s.hz * ratioVan(this._waarde('ratio')) * (0.4 + 0.6 * s.snel) * (1 + DRUK_INDEX * druk);
  }

  _kantel(s) {
    const druk = Math.max(this.kanaalDruk, s.druk);
    const f = filterVan(this._waarde('filter')) * Math.sqrt(s.hz / 440) * (0.75 + 0.5 * s.snel) * (1 + DRUK_FILTER * druk);
    return Math.min(20000, Math.max(30, f));
  }

  _maakStem(noot, snel, t0) {
    const ctx = this.ctx;
    const f = nootHz(noot);
    const s = { noot, hz: f, snel, t0, druk: 0, los: null, gehouden: false, weg: false, einde: Infinity };
    const aanslag = aanslagVan(this._waarde('aanslag'));
    const verval = vervalVan(this._waarde('verval'));
    // Twee draaggolven van elk 1: samen × 0,5. Snelheid^1,5: 0,5 is −9 dB, 0,1 is −30 dB.
    const piek = OPHOGING * 0.5 * Math.pow(snel, 1.5);

    s.mod = ctx.createOscillator();
    s.mod.type = 'sine';
    s.mod.frequency.value = f * ratioVan(this._waarde('ratio'));
    s.vorm = ctx.createGain();
    s.vorm.gain.setValueAtTime(1, t0);
    // MediSynth: de index zakt na de halve aanslag naar 5% met τ = verval / 2.
    if (Number.isFinite(verval)) s.vorm.gain.setTargetAtTime(0.05, t0 + aanslag * 0.5, verval / 2);
    else s.vorm.gain.setTargetAtTime(0.05, t0 + aanslag * 0.5, 10);
    s.diepte = ctx.createGain();
    s.diepte.gain.value = this._diepte(s);
    s.mod.connect(s.vorm).connect(s.diepte);

    s.filter = ctx.createBiquadFilter();
    s.filter.type = 'lowpass';
    s.filter.Q.value = 0.6;                       // MediSynth filterQ; bij Web Audio in dB: een kleine bult
    s.filter.frequency.value = this._kantel(s);

    const spreid = zwevingCent(f, zwevingVan(this._waarde('zweving')));
    s.draag = [-0.5, 0.5].map((kant) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.golf);
      o.frequency.value = f;
      o.detune.value = kant * spreid;
      s.diepte.connect(o.frequency);
      o.connect(s.filter);
      return o;
    });
    for (const o of [s.mod, ...s.draag]) { this.buigBron.connect(o.detune); this.vibrato.connect(o.detune); }

    s.env = ctx.createGain();
    s.env.gain.value = 0;                         // een GainNode begint op 1: tot t0 dicht
    s.env.gain.setValueAtTime(0, t0);
    s.env.gain.linearRampToValueAtTime(piek, t0 + aanslag);
    if (Number.isFinite(verval)) s.env.gain.setTargetAtTime(0, t0 + aanslag, verval * 3);
    s.pan = ctx.createStereoPanner();
    s.pan.pan.value = panVan(noot);
    s.filter.connect(s.env).connect(s.pan).connect(this.som);

    for (const o of [s.mod, ...s.draag]) o.start(t0);
    s.draag[0].onended = () => this._ontkoppel(s);
    return s;
  }

  /** Index, ratio, zweving, filter en druk opnieuw op een klinkende stem (glijdend). Druk raakt alleen index en filter. */
  _werkStemBij(s, nu, alles = true) {
    s.diepte.gain.setTargetAtTime(this._diepte(s), nu, GLIJ);
    s.filter.frequency.setTargetAtTime(this._kantel(s), nu, GLIJ);
    if (!alles) return;
    s.mod.frequency.setTargetAtTime(s.hz * ratioVan(this._waarde('ratio')), nu, GLIJ);
    const spreid = zwevingCent(s.hz, zwevingVan(this._waarde('zweving')));
    s.draag[0].detune.setTargetAtTime(-0.5 * spreid, nu, 0.05);
    s.draag[1].detune.setTargetAtTime(0.5 * spreid, nu, 0.05);
  }

  /**
   * Loslaten op `t` (of nu): de envelope wordt daar vastgehouden en zakt met
   * τ = release / 5 naar nul; na 2 × release (−87 dB) stoppen de oscillatoren.
   */
  _laatLos(s, t) {
    const nu = this.ctx.currentTime;
    const tLos = Number.isFinite(t) && t > nu ? Math.max(t, s.t0) : Math.max(nu, s.t0);
    const release = releaseVan(this._waarde('release'));
    s.los = tLos;
    s.gehouden = false;
    houdVast(s.env.gain, tLos);
    s.env.gain.setTargetAtTime(0, tLos, release / 5);
    s.einde = tLos + 2 * release + 0.02;
    for (const o of [s.mod, ...s.draag]) o.stop(s.einde);
  }

  /** Stemroof en paniek: vanaf `tF` (na startDrempel) in ROOF lineair naar nul, dan stoppen. */
  _dooft(s, tF) {
    s.weg = true;
    houdVast(s.env.gain, tF);
    s.env.gain.linearRampToValueAtTime(0, tF + ROOF);
    const eind = tF + ROOF + 0.005;
    if (eind < s.einde) {
      s.einde = eind;
      for (const o of [s.mod, ...s.draag]) o.stop(eind);
    }
  }

  /** Stemmen die volgens de audioklok klaar zijn opruimen (regel 3: niet wachten op onended). */
  _ruim(nu) {
    const blijft = [];
    for (const s of this.stemmen) {
      if (s.einde + 0.05 < nu) this._ontkoppel(s);
      else blijft.push(s);
    }
    this.stemmen = blijft;
  }

  _ontkoppel(s) {
    if (s.ontkoppeld) return;
    s.ontkoppeld = true;
    for (const o of [s.mod, ...s.draag]) {
      try { this.buigBron.disconnect(o.detune); } catch (_) {}
      try { this.vibrato.disconnect(o.detune); } catch (_) {}
      try { o.disconnect(); } catch (_) {}
    }
    for (const n of [s.vorm, s.diepte, s.filter, s.env, s.pan]) { try { n.disconnect(); } catch (_) {} }
  }

  /** Warmte w: droog × (1 − w) + tanh(voor) × w. `voor` = (1 + 7w) / 4, `na` = w / (1 + 7w): klein signaal exact 1×. */
  _zetWarmte(nu, direct = false) {
    const w = warmteVan(this._waarde('warmte'));
    const drive = 1 + 7 * w;
    const zet = (param, x) => (direct ? (param.value = x) : param.setTargetAtTime(x, nu, GLIJ));
    zet(this.droog.gain, 1 - w);
    zet(this.voor.gain, drive / 4);
    zet(this.na.gain, w / drive);
  }
}

/** Een MIDI-noot 0..127 (afgerond), of null. */
function nootVan(noot) {
  if (!Number.isFinite(noot)) return null;
  const n = Math.round(noot);
  return n >= 0 && n <= 127 ? n : null;
}

export const FM = {
  soort: 'fm',
  naam: 'FM',
  maak(ctx, { uit } = {}) { return new Fm(ctx, uit); },
};
