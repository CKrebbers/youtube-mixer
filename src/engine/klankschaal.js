import { clamp } from '../lib/emitter.js';
import { faderGain } from './audio-graph.js';
import { SPELLING, isMineur, tonica, relatief, kortNaam } from './toonsoort.js';
import { bouwModi, KLANKEN, VELDEN, LICHAAM } from './klankschaal-kern.js';

/**
 * De klankschaal: een instrument dat meespeelt op de toon van wat je hoort.
 *
 * Het geluid is de Waterschaal (klankschaal-kern.js, in een worklet). Deze
 * module beslist WELKE toon: standaard volgt de schaal de toonsoort die je
 * hoort van de track die de maat geeft (dezelfde als sync, sampler en de
 * MAAT-badge), met zijn stemming in cent en de pitch erbij (deck.toonsoort,
 * docs/TOONSOORT.md). Zo staat de schaal op de toon van de plaat, ook als die
 * 43 cent hoog gestemd is of op +6% draait.
 *
 * Wat je zelf kunt veranderen, bovenop wat hij volgt:
 *   - volg: 'maat' (de track die de maat geeft), 'focus' (de track met focus)
 *     of 'hand' (een vaste toonsoort, `hand`);
 *   - toonladder: 'auto' (Kurd bij mineur, majeur bij majeur) of een vaste.
 *     Past de ladder niet bij de toonsoort (Kurd op C majeur), dan komt hij op
 *     de RELATIEVE toonsoort (A Kurd): dezelfde tonen als de plaat;
 *   - transpositie in halve tonen en fijn in cent.
 *
 * Volgt hij en heeft de track geen toonsoort (nog niet geanalyseerd, of "~"),
 * dan blijft de laatste toon staan die hij wel had; zonder die: `hand`.
 *
 * Regel 1: geen DOM, geen MIDI. Regel 3: de flits van een aanslag staat op
 * de audioklok. De stemming wordt per aanslag opnieuw bekeken, en per frame
 * zolang het scherm hem toont (stand()); wat klinkt schuift dan mee.
 */

/** Stappen in halve tonen t.o.v. de tonica, voor de acht velden (Waterschaal: D Kurd = A3 B♭3 C4 D4 E4 F4 G4 A4). */
export const TOONLADDERS = {
  kurd: { naam: 'Kurd', mineur: true, stappen: [-5, -4, -2, 0, 2, 3, 5, 7] },
  celtic: { naam: 'Celtic', mineur: true, stappen: [-5, -2, 0, 2, 3, 5, 7, 10] },
  penta: { naam: 'penta mineur', mineur: true, stappen: [-5, -2, 0, 3, 5, 7, 10, 12] },
  hijaz: { naam: 'Hijaz', mineur: true, stappen: [-5, -4, -1, 0, 2, 3, 5, 7] },
  majeur: { naam: 'majeur', mineur: false, stappen: [-5, -3, -1, 0, 2, 4, 5, 7] },
  pentaMajeur: { naam: 'penta majeur', mineur: false, stappen: [-5, -3, 0, 2, 4, 7, 9, 12] },
};
export const LADDERS = ['auto', ...Object.keys(TOONLADDERS)];
export const VOLGEN = ['maat', 'focus', 'hand'];
export const KLANKSOORTEN = Object.keys(KLANKEN);
/** Zonder iets om te volgen: D mineur, de toon van de Waterschaal. */
export const STANDAARD_TOON = 14;
export const TRANSPOSITIE_MAX = 12;
export const FIJN_MAX = 50;
/** Uitklank 0..1 → × 0,4 .. × 2 (Waterschaal-schuif); 0,375 = × 1. */
const uitklankFactor = (v) => 0.4 + clamp(v) * 1.6;

const mod12 = (x) => ((x % 12) + 12) % 12;
const isSleutel = (k) => Number.isInteger(k) && k >= 0 && k < 24;
const hz = (midi, cent) => 440 * Math.pow(2, (midi - 69 + cent / 100) / 12);
const noot = (midi) => SPELLING[mod12(midi)] + (Math.floor(midi / 12) - 1);

/**
 * De stemming van de schaal. Puur.
 *
 * @param k            toonsoort 0..23 (toonsoort.js), of null: STANDAARD_TOON
 * @param cent         afwijking van wat je hoort (−50..+50), uit deck.toonsoort
 * @param ladder       'auto' of een sleutel van TOONLADDERS
 * @param transpositie halve tonen erbij (heel)
 * @param fijn         cent erbij
 * @returns { k, ladder, ladderNaam, relatief, tonica, cent, kernHz, kernNaam, velden: [{ hz, naam, midi }] }
 *   `k` is de toonsoort waar de schaal op staat (na relatief en transpositie).
 *   De kern ligt rond D3 (G♯2..G3), de ring een octaaf hoger: zo blijft de
 *   schaal in het register waarvoor de Waterschaal gemaakt is, welke toon ook.
 */
export function stemming({ k = null, cent = 0, ladder = 'auto', transpositie = 0, fijn = 0 } = {}) {
  const sleutel = isSleutel(k) ? k : STANDAARD_TOON;
  const naam = ladder === 'auto' || !TOONLADDERS[ladder] ? (isMineur(sleutel) ? 'kurd' : 'majeur') : ladder;
  const L = TOONLADDERS[naam];
  const past = L.mineur === isMineur(sleutel);
  const basis = past ? sleutel : relatief(sleutel);
  const t = mod12(tonica(basis) + Math.round(Number.isFinite(transpositie) ? transpositie : 0));
  const kernMidi = 50 + (mod12(t - 2 + 6) - 6);          // D3 = 50, G♯2..G3
  const c = clamp(Number.isFinite(cent) ? cent : 0, -FIJN_MAX, FIJN_MAX) + clamp(Number.isFinite(fijn) ? fijn : 0, -FIJN_MAX, FIJN_MAX);
  const velden = L.stappen.map((s) => {
    const midi = kernMidi + 12 + s;
    return { midi, hz: hz(midi, c), naam: noot(midi) };
  });
  return {
    k: (L.mineur ? 12 : 0) + t, ladder: naam, ladderNaam: L.naam, relatief: !past,
    tonica: t, cent: c, kernHz: hz(kernMidi, c), kernNaam: noot(kernMidi), velden,
  };
}

/** De worklet-module één keer per AudioContext laden (zoals bron.js). */
const modules = new WeakMap();
function laadModule(ctx) {
  if (!modules.has(ctx)) {
    const p = ctx.audioWorklet.addModule(new URL('./klankschaal-worklet.js', import.meta.url));
    p.catch(() => modules.delete(ctx));
    modules.set(ctx, p);
  }
  return modules.get(ctx);
}

/**
 * Luidheid naast een track (gemeten 29 sep, tools: test/klankschaal.test.mjs
 * meet de toon, de luidheid staat hier). De Waterschaal had een compressor en
 * een master achter de schaal; in Varve staat hij naast tracks van −14 LUFS.
 * Zonder ophoging piekte een veld op −28..−33 dBFS bij volume 0,8: onhoorbaar.
 * UIT_OPHOGING (+8 dB) op alles, VELD_OPHOGING (+8 dB) op de velden: die
 * klonken 10–15 dB zachter dan de kern. Nu bij volume 0,8, kracht 0,7:
 * kern ~−9 dBFS piek, velden ~−12..−17, wrijven ~−18 dBFS rms. De limiter
 * van de master (−1,5 dB) vangt volume en kracht vol open op.
 */
const UIT_OPHOGING = 2.5;
const VELD_OPHOGING = 2.5;

/** Zo lang licht een veld op na een aanslag (audioklok). */
const FLITS = 0.25;
const jit = (x, amt, org) => x * (1 + (Math.random() * 2 - 1) * amt * org);

export class Klankschaal {
  /**
   * @param uitgang  waar hij op klinkt (de master-ingang)
   * @param sends    { A, B }: ingangen van de send-bussen (echo, galm)
   * @param toon     (volg) => { nr, toonsoort } | null: wat de track die hij volgt laat horen
   */
  constructor(ctx, uitgang, { sends = {}, toon = () => null } = {}) {
    this.ctx = ctx;
    this.toonVan = toon;
    this.vol = ctx.createGain();
    this.vol.connect(uitgang);
    this.sendGain = {};
    for (const [bus, ingang] of Object.entries(sends)) {
      const g = ctx.createGain();
      g.gain.value = 0;
      this.vol.connect(g);
      g.connect(ingang);
      this.sendGain[bus] = g;
    }
    this.node = null;
    this._start = null;

    this.volg = 'maat';
    this.hand = STANDAARD_TOON;          // toonsoort bij 'hand', en de terugval
    this.ladder = 'auto';
    this.klank = 'brons';
    this.transpositie = 0;
    this.fijn = 0;                       // cent
    this.karakter = 0.1;                 // 0..1
    this.uitklank = 0.375;               // 0..1, × 1
    this.kracht = 0.7;                   // 0..1
    this.volume = 0.8;
    this.send = { A: 0, B: 0.35 };
    this.wrijft = false;
    this.dempt = false;

    this._laatste = null;                // { k, cent }: de laatste toon die hij wel kon volgen
    this._sleutel = null;                // wat de worklet nu heeft
    this._vf = [];                       // frequenties per stem, voor meeresoneren
    this._geslagen = new Float64Array(VELDEN + 1).fill(-Infinity);
    this.setVolume(this.volume);
    for (const bus of Object.keys(this.sendGain)) this.setSend(bus, this.send[bus] ?? 0);
  }

  // ---- welke toon ----------------------------------------------------------

  /**
   * Wat hij volgt: { k, cent, volg, nr, geen }. `nr` = het tracknummer (1..8)
   * of null; `geen` = de track heeft geen toonsoort, dit is de laatste (of hand).
   */
  bron() {
    if (this.volg === 'hand') return { k: this.hand, cent: 0, volg: 'hand', nr: null, geen: false };
    const t = this.toonVan(this.volg);
    const h = t?.toonsoort;
    if (h && isSleutel(h.k)) {
      this._laatste = { k: h.k, cent: Number.isFinite(h.cent) ? h.cent : 0 };
      return { ...this._laatste, volg: this.volg, nr: t.nr ?? null, geen: false, soort: h.soort ?? null };
    }
    const terug = this._laatste || { k: this.hand, cent: 0 };
    return { ...terug, volg: this.volg, nr: t?.nr ?? null, geen: true };
  }

  /** De stemming zoals hij nu zou klinken (stemming() op bron()). */
  huidig() {
    const b = this.bron();
    return stemming({ k: b.k, cent: b.cent, ladder: this.ladder, transpositie: this.transpositie, fijn: this.fijn });
  }

  /**
   * Stemming uitrekenen en, als die anders is dan wat de worklet heeft, de
   * nieuwe trilvormen sturen. Wat klinkt schuift mee. Onder een halve cent
   * verschil niets: de pitchfader mag de worklet niet elk frame bestoken.
   */
  bijwerken() {
    const st = this.huidig();
    if (!this.node) return st;
    const sleutel = `${st.ladder}|${st.tonica}|${Math.round(st.cent * 2)}|${this.klank}|${this.karakter.toFixed(3)}|${this.uitklank.toFixed(3)}`;
    if (sleutel !== this._sleutel) {
      this._sleutel = sleutel;
      const m = bouwModi({
        kernHz: st.kernHz, veldHz: st.velden.map((v) => v.hz), klank: this.klank,
        karakter: this.karakter, uitklank: uitklankFactor(this.uitklank),
      });
      this._vf = [];
      for (const o of m) (this._vf[o.v] ||= []).push(o.f);
      this.node.port.postMessage({ t: 'modi', m });
    }
    return st;
  }

  // ---- de worklet ------------------------------------------------------------

  /** De worklet pas laden als je de schaal gebruikt: zonder kost hij niets. */
  start() {
    if (!this._start) {
      this._start = laadModule(this.ctx).then(() => {
        const node = new AudioWorkletNode(this.ctx, 'varve-klankschaal', { numberOfInputs: 0, outputChannelCount: [2] });
        node.connect(this.vol);
        this.node = node;
        this._sleutel = null;
        node.port.postMessage({ t: 'opt', fric: 1, org: 1 });
        this.bijwerken();
      }).catch((err) => { this._start = null; throw err; });
    }
    return this._start;
  }

  _doe(fn) {
    if (this.node) { fn(); return Promise.resolve(); }
    return this.start().then(fn);
  }

  _post(bericht) { this.node.port.postMessage(bericht); }

  // ---- spelen ----------------------------------------------------------------

  /** De kern aanslaan (Waterschaal strikeKern), met de kracht van `kracht`. */
  slaKern() {
    return this._doe(() => {
      this.bijwerken();
      const org = 1, vel = jit(0.25 + 0.75 * this.kracht, 0.08, org);
      const phi = Math.random() * Math.PI, a = [];
      const amps = [1, 0.8, 0.6, 0.45, 0.3, 0.2];
      for (let k = 0; k < 6; k++) {
        const n = k + 2, amp = jit(amps[k] * vel * 0.55 * Math.pow(0.86, k), 0.12, org);
        a.push(amp * Math.cos(n * phi), amp * Math.sin(n * phi));
      }
      this._post({ t: 'slag', v: 0, a, ms: 3.5, pe: org * vel * vel * 5 * (KLANKEN[this.klank]?.glijden ?? 1) });
      if (this._vf[0]) this._meeresoneer(0, this._vf[0].filter((_, i) => i % 2 === 0).map((f, k) => ({ f, a: amps[k] * vel * 0.55 })));
      this._post({ t: 'slag', v: LICHAAM, a: [vel * 0.15] });
      this._geslagen[0] = this.ctx.currentTime;
    });
  }

  /** Veld j (0..7) aanslaan (Waterschaal hitField), iets van de rand af: een ronde toon met wat boventoon. */
  slaVeld(j, rand = 0.3) {
    return this._doe(() => {
      this.bijwerken();
      const org = 1, r = clamp(rand);
      const v0 = jit(0.25 + 0.75 * this.kracht, 0.1, org) * (1 - 0.55 * r), v = v0 * VELD_OPHOGING;
      const f1 = v * (1 - 0.65 * r), p2 = v * (0.45 + 0.55 * r), p3 = v * 0.3 * (0.4 + r);
      // Het glijden hoort bij hoe hard de stok raakt, niet bij de ophoging.
      this._post({ t: 'slag', v: j + 1, a: [f1, f1, jit(p2, 0.15, org), jit(p3, 0.2, org)], ms: 4.5 - 2.5 * r, pe: org * v0 * v0 * 7 });
      const vf = this._vf[j + 1];
      if (vf) this._meeresoneer(j + 1, [{ f: vf[0], a: f1 }, { f: vf[2], a: p2 }, { f: vf[3], a: p3 }]);
      this._post({ t: 'slag', v: LICHAAM, a: [v0 * 0.12] });
      this._geslagen[j + 1] = this.ctx.currentTime;
    });
  }

  /** Velden en kern met (bijna) dezelfde toon klinken zacht mee, zoals bij een echte handpan. */
  _meeresoneer(bron, delen) {
    for (let v = 0; v <= VELDEN; v++) {
      if (v === bron || !this._vf[v]) continue;
      let iets = false;
      const a = this._vf[v].map((f) => {
        let s = 0;
        for (const p of delen) { const d = Math.abs(f / p.f - 1); if (d < 0.02) s += p.a * 0.16 * (1 - d / 0.02); }
        if (s > 0.004) iets = true;
        return s;
      });
      if (iets) this._post({ t: 'slag', v, a });
    }
  }

  /** Wrijven zolang `aan`: de schaal gaat zingen (stick-slip, bouwt in ~½ s op). */
  wrijf(aan) {
    this.wrijft = !!aan;
    if (!aan && !this.node) return Promise.resolve();
    // De stand van NU, niet die van het indrukken: loslaten terwijl de worklet
    // nog laadt, mag hem daarna niet laten zingen.
    return this._doe(() => {
      if (this.wrijft) this.bijwerken();
      this._post({ t: 'wrijf', p: this.wrijft ? 0.2 + 0.5 * this.kracht : 0, r: this.wrijft ? 1.1 : 0 });
    });
  }

  /** Dempen zolang `aan`: alles zwijgt binnen ~0,1 s (hand op de schaal). */
  demp(aan) {
    this.dempt = !!aan;
    if (this.node) this._post({ t: 'demp', v: -1, aan: !!aan });
  }

  /** Licht veld v (0 = kern, 1..8) nog op van een aanslag? */
  klinkt(v) { return this.ctx.currentTime - this._geslagen[v] < FLITS; }

  // ---- instellen -------------------------------------------------------------

  volgendeVolg() { this.zetVolg(VOLGEN[(VOLGEN.indexOf(this.volg) + 1) % VOLGEN.length]); }

  /** Naar 'hand' houdt de toon die hij nu volgde: niets verspringt. */
  zetVolg(volg) {
    if (!VOLGEN.includes(volg) || volg === this.volg) return;
    if (volg === 'hand') this.hand = this.bron().k;
    this.volg = volg;
    this.bijwerken();
  }

  /** Een vaste toonsoort (0..23): meteen 'hand'. */
  zetToon(k) {
    if (!isSleutel(k)) return;
    this.hand = k;
    this.volg = 'hand';
    this.bijwerken();
  }

  transponeer(stap) {
    this.transpositie = Math.max(-TRANSPOSITIE_MAX, Math.min(TRANSPOSITIE_MAX, this.transpositie + Math.round(stap)));
    this.bijwerken();
  }

  /** Transpositie en fijn terug op nul. */
  herstelToon() { this.transpositie = 0; this.fijn = 0; this.bijwerken(); }

  /** 0..1 → −50..+50 cent. */
  setFijn(v) { this.fijn = Math.round((clamp(v) - 0.5) * 2 * FIJN_MAX * 10) / 10; this.bijwerken(); }

  volgendeLadder() { this.ladder = LADDERS[(LADDERS.indexOf(this.ladder) + 1) % LADDERS.length]; this.bijwerken(); }
  zetLadder(l) { if (LADDERS.includes(l)) { this.ladder = l; this.bijwerken(); } }

  volgendeKlank() { this.zetKlank(KLANKSOORTEN[(KLANKSOORTEN.indexOf(this.klank) + 1) % KLANKSOORTEN.length]); }
  zetKlank(k) { if (KLANKEN[k]) { this.klank = k; this.bijwerken(); } }

  setKarakter(v) { this.karakter = clamp(v); this.bijwerken(); }
  setUitklank(v) { this.uitklank = clamp(v); this.bijwerken(); }
  setKracht(v) { this.kracht = clamp(v); }

  setVolume(v) {
    this.volume = clamp(v);
    this.vol.gain.setTargetAtTime(faderGain(this.volume) * UIT_OPHOGING, this.ctx.currentTime, 0.02);
  }

  setSend(bus, v) {
    if (!this.sendGain[bus]) return;
    this.send[bus] = clamp(v);
    this.sendGain[bus].gain.setTargetAtTime(this.send[bus], this.ctx.currentTime, 0.02);
  }

  // ---- lezen -----------------------------------------------------------------

  /** Voor het scherm: wat hij volgt, waar hij op staat, en welke velden oplichten. */
  stand() {
    const b = this.bron();
    const st = this.bijwerken();
    const raak = [];
    for (let v = 0; v <= VELDEN; v++) raak.push(this.klinkt(v));
    return {
      geladen: !!this.node, volg: this.volg, nr: b.nr, geen: b.geen, onzeker: !!b.soort && b.soort !== 'zeker',
      bronToon: kortNaam(b.k), toon: kortNaam(st.k), relatief: st.relatief,
      ladder: this.ladder, ladderNaam: st.ladderNaam, klank: this.klank,
      transpositie: this.transpositie, fijn: this.fijn, cent: st.cent,
      kern: st.kernNaam, velden: st.velden.map((v) => v.naam), raak,
      wrijft: this.wrijft, dempt: this.dempt,
    };
  }

  /** Wat bewaard wordt tussen sessies (de schermlaag bewaart het). */
  instellingen() {
    return {
      volg: this.volg, hand: this.hand, ladder: this.ladder, klank: this.klank,
      transpositie: this.transpositie, fijn: this.fijn, karakter: this.karakter, uitklank: this.uitklank,
      kracht: this.kracht, volume: this.volume, send: { ...this.send },
    };
  }

  herstel(o = {}) {
    if (!o || typeof o !== 'object') return;
    if (isSleutel(o.hand)) this.hand = o.hand;
    if (VOLGEN.includes(o.volg)) this.volg = o.volg;
    if (LADDERS.includes(o.ladder)) this.ladder = o.ladder;
    if (KLANKEN[o.klank]) this.klank = o.klank;
    if (Number.isFinite(o.transpositie)) this.transpositie = Math.max(-TRANSPOSITIE_MAX, Math.min(TRANSPOSITIE_MAX, Math.round(o.transpositie)));
    if (Number.isFinite(o.fijn)) this.fijn = clamp(o.fijn, -FIJN_MAX, FIJN_MAX);
    if (Number.isFinite(o.karakter)) this.karakter = clamp(o.karakter);
    if (Number.isFinite(o.uitklank)) this.uitklank = clamp(o.uitklank);
    if (Number.isFinite(o.kracht)) this.kracht = clamp(o.kracht);
    if (Number.isFinite(o.volume)) this.setVolume(o.volume);
    for (const bus of Object.keys(this.sendGain)) if (Number.isFinite(o.send?.[bus])) this.setSend(bus, o.send[bus]);
    this.bijwerken();
  }
}
