/**
 * De klankschaal als rekenwerk: een modaal model, zonder Web Audio.
 *
 * Overgenomen uit de Waterschaal (~/Projects/waterschaal/td/waterschaal-lokaal.html,
 * 28 sep 2026: `class Engine` en `rebuild()`). Elke trilvorm (modus) is een
 * resonator van twee polen: een aanslag stopt er energie in, wrijven voedt hem
 * via een stick-slip-model, en hij klinkt uit met zijn eigen t60.
 *
 * Stemmen (v): 0 = de kern (de schaal zelf, zes paren boventonen met
 * zweving), 1..8 = de acht toonvelden op de ring, 9 = het lichaam (een doffe
 * klop een octaaf onder de kern).
 *
 * Verschillen met het origineel, voor het audiopad van Varve (docs/AUDIOPAD.md):
 *   - geen afval per blok: geen closures, geen arrays, geen berichten terug;
 *   - toeval alleen uit de eigen LCG (`rnd`), nooit Math.random op de audiothread;
 *   - de kern SLAAPT als er niets meer klinkt en niemand wrijft: dan kost een
 *     blok bijna niets en schrijft hij stilte;
 *   - de "lucht" (een zachte ruis) klinkt alleen tijdens het wrijven: in een
 *     DJ-set wil je geen ruisbed onder een stille schaal;
 *   - geen weer, adem, vulling of ruimte: de galm komt van send B van Varve.
 *
 * Wat erin gaat zijn berichten (`bericht(d)`), wat eruit komt is een stereoblok
 * (`render(L, R, n)`). Stemmen en aanslaan rekent de hoofdthread uit
 * (src/engine/klankschaal.js); hier alleen wat per sample moet.
 */

export const MAX_MODI = 64;
export const STEMMEN = 12;
export const VELDEN = 8;
export const LICHAAM = 9;

/**
 * Soorten kern (Waterschaal `KERN_TYPES`): verhoudingen van de zes
 * boventonen, zweving per paar (Hz), uitklinktijd t60 (s), sterkte, en hoe ver
 * de toon na een harde aanslag even omhoog glijdt. Brons en kristal zijn
 * gemeten waarden uit de literatuur; glas en gong zijn benaderingen.
 */
export const KLANKEN = {
  brons: { naam: 'brons', r: [1, 2.77, 5.17, 8.13, 11.6, 15.6], split: [0.8, 1.7, 2.6, 3.5, 4.4, 5.3], t: [40, 22, 12, 7, 4.5, 3], g: [1, 0.55, 0.35, 0.22, 0.14, 0.09], glijden: 1 },
  kristal: { naam: 'kristal', r: [1, 2.77, 5.17, 8.13, 11.6, 15.6], split: [0.06, 0.1, 0.15, 0.2, 0.25, 0.3], t: [55, 18, 7, 4, 2.5, 2], g: [1, 0.16, 0.05, 0.02, 0.01, 0.005], glijden: 0.3 },
  glas: { naam: 'glas', r: [1, 2.32, 4.25, 6.63, 9.4, 12.6], split: [0.2, 0.4, 0.6, 0.8, 1, 1.2], t: [22, 12, 6, 4, 2.5, 2], g: [1, 0.35, 0.18, 0.08, 0.04, 0.02], glijden: 0.5 },
  gong: { naam: 'gong', r: [1, 1.52, 2.0, 2.83, 3.42, 4.9], split: [0.4, 0.9, 1.4, 2, 2.6, 3], t: [28, 20, 14, 9, 6, 4], g: [1, 0.8, 0.7, 0.5, 0.4, 0.3], glijden: 3 },
};

/** Hoe sterk de wrijfstok elke boventoon voedt: zacht leer (grondtoon) ↔ hout (boventoon). */
const WRIJF_ZACHT = [1, 0.3, 0.12, 0.06, 0.03, 0.02];
const WRIJF_HARD = [0.3, 1, 0.4, 0.15, 0.06, 0.03];

/** De acht velden op de ring, zoals op een handpan: laag onderaan, zigzag omhoog. Voor het stereobeeld. */
export const HOEK = [90, 45, 135, 0, 180, -45, 225, -90].map((a) => (a * Math.PI) / 180);

/**
 * De trilvormen van de hele schaal (Waterschaal `rebuild`), klaar voor een
 * bericht { t: 'modi', m }.
 *
 * @param kernHz    grondtoon van de kern
 * @param veldHz    acht frequenties voor de velden
 * @param klank     sleutel van KLANKEN
 * @param karakter  0 = handpan (zuivere velden) .. 1 = schaal (inharmonisch, lang)
 * @param zweving   factor op de zweving van de kernparen
 * @param hardheid  0 = leren stok (grondtoon) .. 1 = houten stok (boventoon)
 * @param uitklank  factor op alle uitklinktijden
 * @param organisch true: de tweede helft van een paar klinkt iets korter (zoals echt metaal)
 */
export function bouwModi({ kernHz, veldHz, klank = 'brons', karakter = 0.1, zweving = 1, hardheid = 0.2, uitklank = 1, organisch = true }) {
  const K = KLANKEN[klank] || KLANKEN.brons;
  const m = [];
  for (let k = 0; k < 6; k++) {
    const n = k + 2, f = kernHz * K.r[k];
    const rw = WRIJF_ZACHT[k] * (1 - hardheid) + WRIJF_HARD[k] * hardheid;
    const t60 = K.t[k] * uitklank;
    m.push({ f, t60, g: K.g[k], v: 0, n, b: 0, rw });
    m.push({ f: f + K.split[k] * zweving, t60: t60 * (organisch ? 0.82 : 1), g: K.g[k], v: 0, n, b: 1, rw });
  }
  const M = karakter;
  const ratios = [1, 2 + 0.77 * M, 3 + 2.17 * M];
  const tk = [3.2, 1.9, 1.1].map((x) => x * (1 + 3.5 * M) * Math.sqrt(uitklank));
  const gk = [1, 0.42, 0.28];
  for (let j = 0; j < veldHz.length && j < VELDEN; j++) {
    const f = veldHz[j];
    const pan = Math.cos(HOEK[j]) * 0.8, pl = Math.sqrt(0.5 * (1 - pan)), pr = Math.sqrt(0.5 * (1 + pan)), v = j + 1;
    m.push({ f, t60: tk[0], g: gk[0], v, pl, pr });
    m.push({ f: f + M * 0.9 * zweving, t60: tk[0], g: gk[0] * M, v, pl, pr });
    m.push({ f: f * ratios[1], t60: tk[1], g: gk[1], v, pl, pr });
    m.push({ f: f * ratios[2], t60: tk[2], g: gk[2], v, pl, pr });
  }
  m.push({ f: kernHz * 0.5, t60: 1.3, g: 0.9, v: LICHAAM });
  return m;
}

/** Onder deze uitwijking telt een modus als stil (−140 dB): dan mag de kern slapen. */
const STIL = 1e-7;

export class SchaalKern {
  constructor(fs) {
    this.fs = fs;
    const M = MAX_MODI;
    this.n = 0;
    this.a1 = new Float64Array(M); this.a2 = new Float64Array(M);
    this.d1 = new Float64Array(M); this.d2 = new Float64Array(M);
    this.y1 = new Float64Array(M); this.y2 = new Float64Array(M); this.inj = new Float64Array(M);
    this.sw = new Float64Array(M); this.nrm = new Float64Array(M); this.g = new Float64Array(M);
    this.v = new Int32Array(M); this.kn = new Int32Array(M); this.kb = new Int8Array(M); this.rw = new Float64Array(M);
    this.gl = new Float64Array(M); this.gr = new Float64Array(M); this.pj = new Float64Array(M);
    this.w0 = new Float64Array(M); this.rr = new Float64Array(M); this.rd = new Float64Array(M);
    this.dph = new Float64Array(M); this.drt = new Float64Array(M);
    this.injA = new Float64Array(M); this.injN = new Int32Array(M); this.injT = new Int32Array(M);
    this.vg = new Float64Array(STEMMEN).fill(1); this.vgT = new Float64Array(STEMMEN).fill(1);
    this.dp = new Uint8Array(STEMMEN); this.pe = new Float64Array(STEMMEN);
    this.th = 0; this.rot = 0; this.pr = 0; this.rotT = 0; this.prT = 0;
    this.seed = 987654321;
    this.fric = 1; this.fF = 0.06; this.cv = 0;
    this.org = 1;
    this.hp = 0; this.hx = 0; this.air = 0;
    this.env0 = 0; this.ly0 = 0;
    this.slaapt = true;
  }

  /** Toeval uit een LCG: −1..1. Nooit Math.random op de audiothread. */
  rnd() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 2147483648 - 1; }

  /**
   * Berichten:
   *   { t: 'modi', m: [{ f, t60, g, v, n?, b?, rw?, pl?, pr? }] }  nieuwe stemming; wat klinkt klinkt door
   *   { t: 'slag', v, a: [amplitude per modus van die stem], ms?, pe? }  aanslag (ms = zachte klop, pe = glijden)
   *   { t: 'wrijf', p, r }      druk 0..1 en draaisnelheid van de stok (0 = los)
   *   { t: 'demp', v, aan }     stem v dempen (v = −1: alles)
   *   { t: 'opt', fric?, org? } wrijfmodel (1 = stick-slip) en hoe organisch (0..2)
   */
  bericht(d) {
    if (d.t === 'modi') {
      const m = d.m;
      this.n = Math.min(m.length, MAX_MODI);
      for (let i = 0; i < this.n; i++) {
        const o = m[i];
        const w = (2 * Math.PI * Math.min(o.f, this.fs * 0.45)) / this.fs;
        const r = Math.exp(-6.91 / (o.t60 * this.fs)), rd = Math.exp(-6.91 / (0.12 * this.fs));
        this.a1[i] = 2 * r * Math.cos(w); this.a2[i] = r * r;
        this.d1[i] = 2 * rd * Math.cos(w); this.d2[i] = rd * rd;
        this.w0[i] = w; this.rr[i] = r; this.rd[i] = rd;
        if (!this.drt[i]) { this.dph[i] = (this.rnd() + 1) * Math.PI; this.drt[i] = 0.03 + (this.rnd() + 1) * 0.045; }
        this.sw[i] = Math.sin(w); this.nrm[i] = Math.sin(w) * Math.sqrt(2 * (1 - r * r));
        this.g[i] = o.g; this.v[i] = o.v; this.kn[i] = o.n || 0; this.kb[i] = o.b ? 1 : 0; this.rw[i] = o.rw || 0;
        if (o.v === 0) {
          const f = o.b ? Math.sin : Math.cos;
          this.gl[i] = f(o.n * 0.35); this.gr[i] = f(o.n * 1.2);
        } else {
          this.gl[i] = o.pl == null ? 0.75 : o.pl; this.gr[i] = o.pr == null ? 0.75 : o.pr;
        }
      }
      // Wat er niet meer is, zwijgt.
      for (let i = this.n; i < MAX_MODI; i++) { this.y1[i] = 0; this.y2[i] = 0; this.inj[i] = 0; this.injN[i] = 0; }
    } else if (d.t === 'slag') {
      const T = d.ms ? Math.max(1, Math.round((d.ms * this.fs) / 1000)) : 1;
      let k = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.v[i] !== d.v) continue;
        const a = (d.a[k] || 0) * this.sw[i]; k++;
        if (T <= 1) this.inj[i] += a;
        else {
          // Een tweede klop tijdens de eerste: wat er nog niet in zat gaat mee.
          this.injA[i] = a + (this.injN[i] > 0 ? (this.injA[i] * this.injN[i]) / this.injT[i] : 0);
          this.injN[i] = T; this.injT[i] = T;
        }
      }
      if (d.pe && d.v >= 0 && d.v < STEMMEN) this.pe[d.v] = Math.max(this.pe[d.v], d.pe);
      this.slaapt = false;
    } else if (d.t === 'wrijf') {
      this.prT = d.p; this.rotT = d.r;
      if (d.p > 0) this.slaapt = false;
    } else if (d.t === 'demp') {
      if (d.v < 0) this.dp.fill(d.aan ? 1 : 0);
      else if (d.v < STEMMEN) this.dp[d.v] = d.aan ? 1 : 0;
    } else if (d.t === 'opt') {
      if (d.fric != null) this.fric = d.fric ? 1 : 0;
      if (d.org != null) this.org = d.org;
    }
  }

  render(L, R, len) {
    if (this.slaapt) {
      for (let s = 0; s < len; s++) { L[s] = 0; R[s] = 0; }
      return;
    }
    const n = this.n, W = (2 * Math.PI) / this.fs;
    // Organisch: langzame drift per modus (enkele cent) en een korte glijder na een harde aanslag.
    let glijdt = false;
    for (let v = 0; v < STEMMEN; v++) if (this.pe[v] > 0.01) { glijdt = true; break; }
    if (this.org > 0 || glijdt) {
      const dt = len / this.fs, pd = Math.exp(-dt / 0.22);
      for (let i = 0; i < n; i++) {
        this.dph[i] += 6.283185307 * this.drt[i] * dt;
        const c = this.org * 0.9 * Math.sin(this.dph[i]) + this.pe[this.v[i]];
        const w = this.w0[i] * Math.pow(2, c / 1200), cw = Math.cos(w);
        this.a1[i] = 2 * this.rr[i] * cw; this.d1[i] = 2 * this.rd[i] * cw;
      }
      for (let v = 0; v < STEMMEN; v++) this.pe[v] *= pd;
    }
    for (let s = 0; s < len; s++) {
      this.pr += (this.prT - this.pr) * 0.0005; this.rot += (this.rotT - this.rot) * 0.0002;
      this.th += W * this.rot; if (this.th > 6.283185307179586) this.th -= 6.283185307179586;
      let e = 0, force = 0;
      if (this.fric) {
        const tg = this.prT > 0.02 ? 0.08 + this.pr * 0.3 : 0; this.cv += (tg - this.cv) * 0.00004;
        if (this.cv > 0.015 && this.prT > 0.02) {
          let vs = 0;
          for (let i = 0; i < n; i++) {
            if (this.rw[i] > 0) { const a = this.kn[i] * this.th; const p = this.kb[i] ? Math.sin(a) : Math.cos(a); this.pj[i] = p; vs += this.rw[i] * p * this.y1[i]; }
          }
          const dv = this.cv - vs + this.rnd() * 0.002;
          const t = Math.abs(dv * 3) + 0.75; const bt = Math.min(1, 1 / (t * t * t * t));
          force = dv * bt * this.fF * Math.min(1, this.pr * 2.5);
        }
      } else {
        e = this.rnd() * this.pr * 0.6;
        for (let i = 0; i < n; i++) {
          if (this.rw[i] > 0) { const a = this.kn[i] * this.th; this.pj[i] = this.kb[i] ? Math.sin(a) : Math.cos(a); }
        }
      }
      // Rammelen: bij lichte druk en een snelle stok verliest de stok contact
      // en tikt hij terug op de rand, op de nuldoorgang van de grondtoon.
      let rat = 0; const y0 = this.y1[0];
      if (this.pr > 0.03 && this.pr < 0.32 && this.rot > 1.3) {
        this.env0 = Math.max(Math.abs(y0), this.env0 * 0.9995);
        const kans = (this.rnd() + 1) * 0.5;
        if (y0 > 0 && this.ly0 <= 0 && this.env0 > 0.05 && kans < Math.min(0.9, (this.rot - 1.2) * 0.6)) {
          rat = Math.min(0.35, this.env0 * 1.2) * (0.6 + 0.2 * (this.rnd() + 1));
        }
      }
      this.ly0 = y0;
      const tiny = (s & 1) ? 1e-18 : -1e-18;
      let l = 0, r = 0;
      for (let i = 0; i < n; i++) {
        let x = this.inj[i] + tiny; this.inj[i] = 0;
        if (this.injN[i] > 0) { const T = this.injT[i], kk = T - this.injN[i]; x += (this.injA[i] * (1 - Math.cos((6.283185307 * (kk + 0.5)) / T))) / T; this.injN[i]--; }
        if (this.rw[i] > 0) {
          const p = this.pj[i];
          x += (this.fric ? force * this.rw[i] * p * this.sw[i] : e * this.rw[i] * p * this.nrm[i]) + rat * this.rw[i] * p * this.sw[i];
        }
        const vi = this.v[i]; const dm = this.dp[vi];
        const y = (dm ? this.d1[i] : this.a1[i]) * this.y1[i] - (dm ? this.d2[i] : this.a2[i]) * this.y2[i] + x;
        this.y2[i] = this.y1[i]; this.y1[i] = y;
        const o = y * this.g[i] * this.vg[vi] * (vi === 0 && this.fric ? 3.5 : 1);
        l += o * this.gl[i]; r += o * this.gr[i];
      }
      if (this.org > 0 && this.pr > 1e-4) {
        // Schuren van de stok (hoog, heel zacht, draait mee) en een vleug lucht: alleen tijdens het wrijven.
        const nz = this.rnd(); this.hp = 0.6 * (this.hp + nz - this.hx); this.hx = nz;
        const sc = this.hp * this.pr * Math.min(1, this.rot) * this.org * 0.012;
        this.air += (this.rnd() - this.air) * 0.02; const ar = this.air * this.org * 0.0025 * Math.min(1, this.pr * 4);
        const ct = Math.cos(this.th); l += sc * (1 + ct) + ar; r += sc * (1 - ct) + ar;
      }
      if (rat) { const ck = rat * 0.08 * this.rnd(); l += ck; r += ck; }
      L[s] = Math.tanh(l * 0.3); R[s] = Math.tanh(r * 0.3);
    }
    for (let v = 0; v < STEMMEN; v++) this.vg[v] += (this.vgT[v] - this.vg[v]) * 0.06;
    this._misschienSlapen();
  }

  /** Niets klinkt, niemand wrijft, niets onderweg: slapen (en de resonatoren echt op nul). */
  _misschienSlapen() {
    if (this.prT > 0.02 || this.pr > 1e-4 || this.cv > 1e-4) return;
    for (let i = 0; i < this.n; i++) {
      if (this.injN[i] > 0 || Math.abs(this.y1[i]) > STIL || Math.abs(this.y2[i]) > STIL) return;
    }
    for (let i = 0; i < this.n; i++) { this.y1[i] = 0; this.y2[i] = 0; }
    this.slaapt = true;
  }
}
