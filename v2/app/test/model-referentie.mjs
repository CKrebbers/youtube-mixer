// Een kleine, ONAFHANKELIJKE referentie voor klok + koppeling + track (voor test/model.test.mjs).
// Geen test zelf. Importeert niets uit src/: grid, klok en track zijn hier opnieuw geschreven,
// uit het ontwerp (v2/ontwerp/maatklok.json, klok-B01..B15) en de contracten in ARCHITECTUUR.md.
//
// Wat hij WEL modelleert:
//   - een tempokaart van één of twee stukken (met de overgangstel van het grid), zekerheid per
//     stuk, twijfel 'maat', een eigen maat-anker per stuk, slot;
//   - de klok als stuksgewijs lineaire functie { T, C, R } (start, houd, richt, stop);
//   - per track de plek als functie van de tijd: tijdvakken 'stil' / 'vrij' / 'gekoppeld' /
//     'wacht' (starten op de maat: stil tot de KLOK een tel bereikt, dan gekoppeld);
//   - play, pauze, sync aan/uit, klok naar dit nummer, jog, nudge, pitch (met soft-takeover
//     als meetkundige regel: pas grijpen als de fader langs de stand van de klok komt),
//     seek, starten op de maat, klok-tempo, klok stoppen, fader, crossfader, kant.
// Wat hij NIET modelleert: cue, kills, EQ, filters, tap tempo, het pitchbereik wisselen, het
// laden als commando op de bus (de weigering over een spelende track), meldingen, de
// hoorbare klok (uitgangsvertraging), pagina's en geluid.
//
// Waar het ontwerp zwijgt, volgt de referentie wat de engine doet (en dat staat erbij).

const EPS = 1e-9;
const mod = (a, n) => ((a % n) + n) % n;

export const ZEKER_VANAF = 0.65;    // ontwerp: zeker vanaf 0,65 (BEATGRID.md)
export const KLOK_MIN = 40, KLOK_MAX = 300;
export const BEREIK = 0.16;          // pitchbereik ±16%
export const BEND = 0.04;            // nudge: 4%
export const GRIJP = 0.01;           // soft-takeover: zo dicht bij de stand van de klok telt als erlangs
export const HOORBAAR = 0.001;       // −60 dB
export const PER_MAAT = 4;

/** Een tempokaart van één of twee stukken, zelf uitgerekend. */
export class RefGrid {
  constructor({ stukken, slot = false }) {
    if (stukken.length < 1 || stukken.length > 2) throw new Error('RefGrid: één of twee stukken');
    this.s = stukken.map((x) => ({ ...x }));
    this.slot = slot;
    const s0 = this.s[0];
    this.a0 = s0.anker;
    this.L0 = 60 / s0.bpm;
    if (this.s[1]) {
      const s1 = this.s[1];
      this.L1 = 60 / s1.bpm;
      // De eerste tel van stuk 2 ligt op of na zijn begin.
      this.start = s1.anker + Math.ceil((s1.van - s1.anker) / this.L1 - EPS) * this.L1;
      // De laatste tel van stuk 1 vóór die tel; korter dan een halve tel = die vervalt.
      let p = Math.ceil((this.start - this.a0) / this.L0 - EPS) - 1;
      let tp = this.a0 + p * this.L0;
      if (this.start - tp < this.L0 / 2 - EPS) { p -= 1; tp -= this.L0; }
      this.p = p; this.tp = tp;            // de overgangstel: van tp tot start is tel p
    }
    // Maten: welke (doorlopende) tel een "1" is, per stuk.
    this.m0 = Number.isFinite(s0.maat) ? Math.round((s0.maat - this.a0) / this.L0) : 0;
    if (this.s[1]) {
      const s1 = this.s[1];
      this.m1 = Number.isFinite(s1.maat)
        ? this.p + 1 + Math.round((s1.maat - this.start) / this.L1)
        : this.p + 1 + mod(this.m0 - (this.p + 1), PER_MAAT);
    }
  }

  /** Tel (doorlopend) op tracktijd t. */
  beat(t) {
    if (!this.s[1] || t < this.tp) return (t - this.a0) / this.L0;
    if (t < this.start) return this.p + (t - this.tp) / (this.start - this.tp);
    return this.p + 1 + (t - this.start) / this.L1;
  }

  /** Tracktijd van tel b. */
  tijd(b) {
    if (!this.s[1] || b < this.p) return this.a0 + b * this.L0;
    if (b < this.p + 1) return this.tp + (b - this.p) * (this.start - this.tp);
    return this.start + (b - this.p - 1) * this.L1;
  }

  /** Seconden per tel rond tel b, aan de rechterkant (de tel die op b begint). */
  telLengteBijBeat(b) {
    if (!this.s[1] || b < this.p) return this.L0;
    if (b < this.p + 1) return this.start - this.tp;
    return this.L1;
  }

  _stuk(t) { return this.s[1] && this.s[1].van <= t + EPS ? 1 : 0; }
  bpmOp(t) { return this.s[this._stuk(t)].bpm; }
  telLengteOp(t) { return 60 / this.bpmOp(t); }

  /** Zeker over de tel (koppelen mag). */
  zeker(t) {
    if (this.slot) return true;
    const z = this.s[this._stuk(t)].zekerheid;
    return !Number.isFinite(z) || z >= ZEKER_VANAF;
  }

  /** Zeker over de tel én de "1" (starten op de maat mag). */
  maatZeker(t) {
    if (!this.zeker(t)) return false;
    if (this.slot) return true;
    const s = this.s[this._stuk(t)];
    return s.ok === true || s.twijfel !== 'maat';
  }

  _maatVanTijd(t) { return this.s[1] && t >= this.start ? this.m1 : this.m0; }
  _maatVanBeat(b) { return this.s[1] && b >= this.p + 1 ? this.m1 : this.m0; }

  /** Waar in de maat tracktijd t valt: 0 (de "1") tot 4. */
  inMaat(t) { return mod(this.beat(t) - this._maatVanTijd(t), PER_MAAT); }

  /** Is tel b een "1"? */
  isEen(b) { return mod(b - this._maatVanBeat(b), PER_MAAT) === 0; }
}

const klemBpm = (bpm) => Math.min(KLOK_MAX, Math.max(KLOK_MIN, bpm));

/** De klok: een stuksgewijs lineaire, continue, stijgende functie tel(t). */
export class RefKlok {
  constructor() { this.lijn = []; }
  get loopt() { return this.lijn.length > 0; }
  start(T, C, bpm) { this.lijn = [{ T, C, R: klemBpm(bpm) / 60 }]; }
  stop() { this.lijn = []; }
  _op(t) { let s = this.lijn[0]; for (const x of this.lijn) { if (x.T <= t) s = x; else break; } return s; }
  tel(t) { const s = this._op(t); return s.C + (t - s.T) * s.R; }
  rate(t) { return this._op(t).R; }
  bpm(t) { return this.rate(t) * 60; }
  tijd(c) { let s = this.lijn[0]; for (const x of this.lijn) { if (x.C <= c) s = x; else break; } return s.T + (c - s.C) / s.R; }
  volgendeMaat(c) { return Math.ceil(c / PER_MAAT - 1e-9) * PER_MAAT; }
  houd(A, bpm) {
    const c = this.tel(A);
    this.lijn = this.lijn.filter((s) => s.T < A).concat([{ T: A, C: c, R: klemBpm(bpm) / 60 }]);
  }
  /**
   * Naar de doellijn "tel N op audiokloktijd a, een tel duurt L" (N = de dichtstbijzijnde
   * hele klok-tel bij a): vanaf A een rechte lijn die minstens één tel duurt en op een tel
   * van de doellijn uitkomt, met minstens een kwart van het doeltempo; daarna de doellijn.
   * Ligt de klok er al op: niets.
   */
  richt(a, L, A) {
    const N = Math.round(this.tel(a));
    const z = this.lijn.at(-1);
    if (Math.abs(z.R * L - 1) < 1e-9 && Math.abs(z.C + (a - z.T) * z.R - N) * L < 1e-5) return { veranderd: false, N };
    const cA = this.tel(A);
    let k = Math.ceil((A + L - a) / L - 1e-9);
    let A2, R1;
    for (let i = 0; i <= 16; i++, k++) {
      A2 = a + k * L;
      R1 = (N + k - cA) / (A2 - A);
      if (R1 >= 0.25 / L) break;
    }
    this.lijn = this.lijn.filter((s) => s.T < A).concat([{ T: A, C: cA, R: R1 }, { T: A2, C: N + k, R: 1 / L }]);
    return { veranderd: true, N, klaar: A2 };
  }
}

/** Eén track in de referentie. */
export class RefTrack {
  constructor(set, n) {
    this.set = set;
    this.n = n;
    this.geladen = false;
    this.grid = null;
    this.duur = 0;
    this.sync = false;
    this.pitch = 0.5;
    this.bend = 0;
    this.bendWas = null;
    this.vakken = [{ van: -Infinity, soort: 'stil', P: 0 }];
    this.fader = 1;
    this.kant = n === 1 ? 'A' : n === 2 ? 'B' : 'thru';
  }

  get klok() { return this.set.klok; }

  _vak(t) { let x = this.vakken[0]; for (const v of this.vakken) { if (v.van <= t) x = v; else break; } return x; }

  /** De soort op t; een wachtende track is stil tot de klok zijn tel bereikt. */
  soortOp(t) {
    const x = this._vak(t);
    if (x.soort === 'wacht') return this.klok.loopt && this.klok.tel(t) >= x.C ? 'gekoppeld' : 'stil';
    return x.soort;
  }

  plek(t) {
    const x = this._vak(t);
    const s = this.soortOp(t);
    if (s === 'stil') return x.P;
    if (s === 'vrij') return x.P + (t - x.van) * x.R;
    return this.grid.tijd(this.klok.tel(t) + x.v);
  }

  /** Seconden nummer per seconde audioklok op t, aan de rechterkant. */
  snelheid(t) {
    const x = this._vak(t);
    const s = this.soortOp(t);
    if (s === 'stil') return 0;
    if (s === 'vrij') return x.R;
    return this.klok.rate(t) * this.grid.telLengteBijBeat(this.klok.tel(t) + x.v);
  }

  speeltOp(t) { return this.soortOp(t) !== 'stil'; }
  gekoppeldOp(t) { return this.soortOp(t) === 'gekoppeld'; }
  /** De verschuiving op t (alleen gekoppeld), anders null. */
  verschuivingOp(t) { return this.gekoppeldOp(t) ? this._vak(t).v : null; }

  /** Wacht hij op A op een start op de maat? Geeft het startmoment of null. */
  wachtOp(A) {
    const x = this._vak(A);
    if (x.soort === 'wacht' && this.klok.loopt && this.klok.tel(A) < x.C) return this.klok.tijd(x.C);
    // Zoals de engine: een later tijdvak dat speelt, terwijl hij nu stil staat.
    if (this.soortOp(A) !== 'stil') return null;
    const later = this.vakken.find((v) => v.van > A && v.soort !== 'stil');
    return later ? later.van : null;
  }

  get pitchRate() { return 1 + (this.pitch - 0.5) * 2 * BEREIK; }
  zeker(P) { return !!this.grid && this.grid.zeker(P); }
  maatZeker(P) { return !!this.grid && this.grid.maatZeker(P); }

  _zet(A, vak) {
    this.vakken = this.vakken.filter((v) => v.van < A);
    this.vakken.push({ ...vak, van: A });
  }

  _koppelStart(A, P, rate) {
    // De klok begint hier (klok-B05): tel 0 is de "1" van dit nummer, tempo = wat je hoort.
    this.klok.start(A, this.grid.inMaat(P), this.grid.bpmOp(P) * rate);
    return this.grid.beat(P) - this.klok.tel(A);
  }

  // ---- handelingen; A = het moment waarop het ingaat -------------------------

  laad(A, { grid, duur }) {
    this.geladen = true;
    this.grid = grid;
    this.duur = duur;
    this.pitch = 0.5;
    this._zet(A, { soort: 'stil', P: 0 });
  }

  speel(A) {
    if (!this.geladen) return { geweigerd: 'geen nummer' };
    if (this.wachtOp(A) !== null) { this._zet(A, { soort: 'stil', P: this.plek(A) }); return; }
    if (this.speeltOp(A)) { this._zet(A, { soort: 'stil', P: this.plek(A) }); return; }
    const P = this.plek(A);
    if (!this.klok.loopt && this.zeker(P)) {
      this.sync = true;
      this._zet(A, { soort: 'gekoppeld', v: this._koppelStart(A, P, this.pitchRate) });
      return;
    }
    if (this.sync && this.klok.loopt && this.zeker(P)) {
      this._zet(A, { soort: 'gekoppeld', v: Math.round(this.grid.beat(P) - this.klok.tel(A)) });
      return;
    }
    this._zet(A, { soort: 'vrij', P, R: this.pitchRate });
  }

  zetSync(A, aan) {
    const P = this.plek(A);
    if (!aan) {
      this.sync = false;
      if (this.speeltOp(A) && this.gekoppeldOp(A)) {
        const R = this.snelheid(A);
        this.pitch = Math.min(1, Math.max(0, 0.5 + (R - 1) / (2 * BEREIK)));
        this._zet(A, { soort: 'vrij', P, R });
      }
      // Zoals de engine: een wachtende start of een geplande koppeling blijft staan
      // (het ontwerp zegt hier niets; de invariant "gekoppeld ⇒ sync" kijkt ernaar).
      return;
    }
    if (!this.grid) return { geweigerd: 'geen grid' };
    if (!this.zeker(P)) return { geweigerd: 'het grid is hier onzeker' };
    this.sync = true;
    if (!this.speeltOp(A)) return;
    if (!this.klok.loopt) {
      this._zet(A, { soort: 'gekoppeld', v: this._koppelStart(A, P, this.snelheid(A)) });
      return;
    }
    this._zet(A, { soort: 'gekoppeld', v: Math.round(this.grid.beat(P) - this.klok.tel(A)) });
  }

  klokNaarMij(A) {
    const P = this.plek(A);
    if (!this.grid) return { geweigerd: 'geen grid' };
    if (!this.zeker(P)) return { geweigerd: 'onzeker' };
    if (!this.speeltOp(A)) return { geweigerd: 'speelt niet' };
    if (!this.klok.loopt) { this.zetSync(A, true); return; }
    if (this.gekoppeldOp(A)) return;
    const R = this.snelheid(A);
    const bA = Math.ceil(this.grid.beat(P) - 1e-9);
    const a = A + (this.grid.tijd(bA) - P) / R;
    const L = (this.grid.tijd(bA + 1) - this.grid.tijd(bA)) / R;
    const r = this.klok.richt(a, L, A);
    this.sync = true;
    if (!r.veranderd) { this._zet(A, { soort: 'gekoppeld', v: bA - r.N }); return; }
    this._zet(A, { soort: 'vrij', P, R });
    this.vakken.push({ van: r.klaar, soort: 'gekoppeld', v: bA - r.N });
  }

  /** Pitchfader. Gekoppeld en hoorbaar = het klok-tempo, met soft-takeover (klok-B13, B14). */
  zetPitch(A, v01) {
    const was = this.pitch;
    this.pitch = v01;
    if (this.gekoppeldOp(A)) {
      if (!this.set.hoorbaar(this.n, A)) return;
      const nodig = 0.5 + (this.snelheid(A) - 1) / (2 * BEREIK);
      const inGreep = Math.abs(was - nodig) < 1e-9;
      const erlangs = inGreep || (was - nodig) * (v01 - nodig) <= 0 || Math.abs(v01 - nodig) < GRIJP;
      if (!erlangs) return;
      this.set.zetKlokTempo(A, this.grid.bpmOp(this.plek(A)) * this.pitchRate);
      return;
    }
    if (this.speeltOp(A)) this._zet(A, { soort: 'vrij', P: this.plek(A), R: this.pitchRate });
  }

  jog(A, tellen) {
    const x = this._vak(A);
    if (this.gekoppeldOp(A)) { this._zet(A, { soort: 'gekoppeld', v: x.v + tellen }); return; }
    const L = this.grid ? this.grid.telLengteOp(this.plek(A)) : 0.5;
    const P = Math.max(0, this.plek(A) + tellen * L);
    // Zoals de engine: een jog op een wachtende track maakt hem stil (de wacht vervalt).
    if (this.soortOp(A) === 'vrij') this._zet(A, { soort: 'vrij', P, R: x.R });
    else this._zet(A, { soort: 'stil', P });
  }

  /** Nudge: zolang je drukt 4% sneller of trager; loslaten laat altijd los (klok-S04). */
  nudge(A, richting, aan) {
    if (aan) {
      if (this.bend) return;
      if (!this.speeltOp(A)) return;
      this.bend = richting;
      this.bendWas = this.gekoppeldOp(A) ? 'gekoppeld' : 'vrij';
      this._zet(A, { soort: 'vrij', P: this.plek(A), R: this.snelheid(A) * (1 + BEND * richting) });
      return;
    }
    if (this.bend !== richting) return;
    this.bend = 0;
    if (!this.speeltOp(A)) return;
    if (this.gekoppeldOp(A)) return;               // intussen (weer) gekoppeld: dat blijft (klok-B04)
    const P = this.plek(A);
    if (this.bendWas === 'gekoppeld' && this.sync && this.klok.loopt && this.zeker(P)) {
      this._zet(A, { soort: 'gekoppeld', v: this.grid.beat(P) - this.klok.tel(A) });
    } else {
      this._zet(A, { soort: 'vrij', P, R: this.pitchRate });
    }
  }

  zoek(A, P2) {
    P2 = Math.max(0, Math.min(P2, this.duur));
    const x = this._vak(A);
    const s = this.soortOp(A);
    if (s === 'gekoppeld') {
      const c = this.klok.tel(A) + x.v;
      this._zet(A, { soort: 'gekoppeld', v: x.v + Math.round(this.grid.beat(P2) - c) });
    } else if (s === 'vrij') this._zet(A, { soort: 'vrij', P: P2, R: x.R });
    else this._zet(A, { soort: 'stil', P: P2 });   // zoals de engine: een wachtende start vervalt
  }

  /** Starten op de maat (klok-S11): de tel van het startpunt op de volgende "1" van de klok. */
  startOpDeMaat(A) {
    if (!this.geladen) return { geweigerd: 'geen nummer' };
    if (this.wachtOp(A) !== null) { this._zet(A, { soort: 'stil', P: this.plek(A) }); return; }
    if (this.speeltOp(A)) { this._zet(A, { soort: 'stil', P: this.plek(A) }); return; }
    const P0 = this.plek(A);
    if (!this.klok.loopt) return this.speel(A);
    if (!this.maatZeker(P0)) return { geweigerd: 'de "1" is hier niet zeker' };
    const b0 = this.grid.beat(P0);
    const bn = Math.round(b0);
    let Cn = this.klok.volgendeMaat(this.klok.tel(A));
    if (Cn + (b0 - bn) < this.klok.tel(A)) Cn += PER_MAAT;
    this.sync = true;
    // De start hangt aan de KLOK-tel, niet aan een vaste tijd: verandert de klok tijdens
    // het wachten, dan valt de start nog steeds op die "1".
    this._zet(A, { soort: 'wacht', P: P0, C: Cn + (b0 - bn), v: bn - Cn });
  }
}

/** De hele set: klok, tracks, mixer. */
export class RefSet {
  constructor(aantal) {
    this.klok = new RefKlok();
    this.tracks = [];
    for (let n = 1; n <= aantal; n++) this.tracks.push(new RefTrack(this, n));
    this.xfader = 0.5;
  }
  track(n) { return this.tracks[n - 1]; }

  kantVersterking(kant) {
    const x = this.xfader;
    return kant === 'A' ? Math.cos(x * Math.PI / 2) : kant === 'B' ? Math.sin(x * Math.PI / 2) : 1;
  }

  hoorbaar(n, A) {
    const t = this.track(n);
    return t.speeltOp(A) && t.fader * this.kantVersterking(t.kant) > HOORBAAR;
  }

  zetKlokTempo(A, bpm) {
    if (!this.klok.loopt) { this.klok.start(A, 0, bpm); return; }
    if (Math.abs(this.klok.bpm(A) - bpm) < 1e-6) return;
    this.klok.houd(A, bpm);
  }

  klokStop(A) {
    if (this.tracks.some((t) => t.speeltOp(A))) return { geweigerd: 'er speelt nog iets' };
    // Wie op de maat wachtte, blijft staan: zonder klok is er geen "1".
    for (const t of this.tracks) if (t.wachtOp(A) !== null) t._zet(A, { soort: 'stil', P: t.plek(A) });
    this.klok.stop();
  }
}
