// Een kleine, ONAFHANKELIJKE referentie voor klok + koppeling + track (voor test/model.test.mjs).
// Geen test zelf. Importeert niets uit src/: grid, klok en track zijn hier opnieuw geschreven,
// uit het ONTWERP: v2/ontwerp/maatklok.json (klok-B01..B15, klok-S01..S21), v2/ontwerp/track.json,
// v2/WENSEN.md en de vastgelegde besluiten van 19 okt (hieronder "besluit 1..8"). De referentie
// is het ontwerp, geen kopie van de engine: wijkt de engine af, dan is dat een fout in de engine
// (een todo-test in model.test.mjs), niet iets om hier na te spelen.
//
// Wat hij WEL modelleert:
//   - een tempokaart van één of twee stukken (met de overgangstel van het grid), zekerheid per
//     stuk, twijfel 'maat', een eigen maat-anker per stuk, slot;
//   - de klok als stuksgewijs lineaire functie { T, C, R } (start, houd, richt, stop);
//   - per track de plek als functie van de tijd: tijdvakken 'stil' / 'vrij' / 'gekoppeld' /
//     'wacht' (starten op de maat: stil tot de KLOK een tel bereikt, dan gekoppeld);
//   - laden, play, pauze, sync aan/uit, klok naar dit nummer, jog, nudge, pitch (met
//     soft-takeover), seek, starten op de maat, klok-tempo, klok stoppen, fader, crossfader, kant.
// Wat hij NIET modelleert: cue, kills, EQ, filters, tap tempo, het pitchbereik wisselen, de
// weigering van laden over een spelende track (track-S02), meldingen, de hoorbare klok
// (uitgangsvertraging), pagina's en geluid.
//
// De besluiten (19 okt), en waar ze hieronder staan:
//   1 laad          alles van het vorige nummer vervalt meteen (ook wat al klonk); stil op 0, pitch
//                   0,5, bend 0; sync (de knop) blijft staan. ("grijpt" volgt uit besluit 6.)
//   2 startOpDeMaat de "1" van het nummer valt op een "1" van de klok; het startmoment hangt aan een
//                   KLOK-tel en schuift mee als de klok verandert (klok-S11, B07; K5).
//   3 zetSync(uit)  wat gekoppeld is of gekoppeld zou worden (wachten op de maat, klok naar mij)
//                   wordt vrij, op plek en tempo van dat moment, zonder sprong (K1).
//   4 nudge         loslaten wist de bend altijd; sync aan = gekoppeld op de plek van nu, sync uit (of
//                   geen grid) = vrij op het tempo van vóór de bend (K2).
//   5 klokStop      alleen als niets speelt of op de klok wacht; anders geweigerd (K3).
//   6 zetPitch      soft-takeover: na koppelen en na een tempowissel van de klok door iets anders
//                   grijpt de fader pas als hij erlangs komt (tolerantie 1e-6); een nummer dat je
//                   niet hoort verzet de klok nooit (K4, klok-B13, B14). Uitgewerkt als meetkunde:
//                   de fader grijpt als hij op de stand van de klok staat of erlangs komt; dat dekt
//                   ook een tempowissel in het grid (seek, klok-S09), die het besluit niet apart noemt.
//   7 snelheid      exact (geen numerieke afgeleide); de motor-eisen (oplopend, horizon 90 s, ≤ 60
//                   segmenten) toetst model.test.mjs (K6, K7, K9).
//   8 zoek          landt een gekoppelde track op een onzeker stuk: vrij, sync uit (met een melding).
//
// Waar het ontwerp zwijgt, kiest de referentie (en dat staat erbij, met "ZWIJGT"):
//   - jog of seek op een track die wacht = opnieuw starten op de maat vanaf de nieuwe plek (zoals
//     cue verzetten); alleen als de klok loopt.
//   - pitch, jog, seek of nudge tijdens "klok naar dit nummer" (de track is nog vrij): aan het eind
//     van het glijden wordt hij gekoppeld vanaf zijn NIEUWE lijn (verschuiving uit de plek), behalve
//     als die plek onzeker is (klok-B08); bij een seek daarheen geldt besluit 8 (vrij, sync uit).
//   - "klok naar dit nummer" terwijl de klok nog naar een lijn glijdt: koppelen pas als hij er is.
//   - een geplande koppeling na het glijden rekent zijn verschuiving uit de plek op dat moment:
//     verandert de klok intussen, dan springt er niets (klok-B06/B07: nooit een fasesprong).
//   - een nudge-knop blijft "ingedrukt" tot hij losgelaten wordt of er een ander nummer komt;
//     sync, klok naar mij of starten op de maat laten hem niet los (besluit 4 gaat over loslaten).
//   - na seek op een onzeker stuk (besluit 8 = sync uit) zet de pitchfader zich zoals bij sync uit.
//   - pitch tijdens een nudge: vrij op de pitchfader (de bend vervalt, de knop blijft vast).
//   - de klok stoppen geldt meteen; "speelt" is op A (straks), "wacht op de klok" is een gekoppeld
//     tijdvak of een start op de maat die na nu nog komt.
// model.test.mjs drukt één nudge-knop tegelijk (een tweede druk zonder loslaten kan een hand niet).

const EPS = 1e-9;
const mod = (a, n) => ((a % n) + n) % n;

export const ZEKER_VANAF = 0.65;    // ontwerp: zeker vanaf 0,65 (BEATGRID.md)
export const KLOK_MIN = 40, KLOK_MAX = 300;
export const BEREIK = 0.16;          // pitchbereik ±16%
export const BEND = 0.04;            // nudge: 4%
export const GRIJP = 1e-6;           // soft-takeover (besluit 6): zo dicht bij de stand van de klok telt als erlangs
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
    return this.start + (b - (this.p + 1)) * this.L1;
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
    let A2, R1, C2;
    for (let i = 0; i <= 16; i++, k++) {
      A2 = a + k * L;
      C2 = N + k;
      R1 = (C2 - cA) / (A2 - A);
      if (R1 >= 0.25 / L) break;
    }
    this.lijn = this.lijn.filter((s) => s.T < A).concat([{ T: A, C: cA, R: R1 }, { T: A2, C: C2, R: 1 / L }]);
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
    this.bend = 0;             // welke nudge-knop vastzit (−1, 0, 1)
    this.bendR = null;         // het tempo van vóór de bend
    this.vakken = [{ van: -Infinity, soort: 'stil', P: 0 }];
    this.fader = 1;
    this.kant = n === 1 ? 'A' : n === 2 ? 'B' : 'thru';
  }

  get klok() { return this.set.klok; }

  _i(t) { let i = 0; for (let k = 0; k < this.vakken.length; k++) { if (this.vakken[k].van <= t) i = k; else break; } return i; }
  _vak(t) { return this.vakken[this._i(t)]; }
  _eind(i) { return this.vakken[i + 1]?.van ?? Infinity; }

  /**
   * Wanneer een tijdvak gekoppeld begint. Een wachtende track begint op de KLOK-tel C (besluit 2):
   * verandert de klok tijdens het wachten, dan schuift het moment mee.
   */
  _koppelVan(x) {
    if (x.soort === 'wacht') return this.klok.loopt ? this.klok.tijd(x.C) : Infinity;
    return x.van;
  }

  /** De verschuiving van tijdvak i. Na het glijden: uit de plek van de vrije lijn op dat moment. */
  _v(i) {
    const x = this.vakken[i];
    if (!x.uitPlek) return x.v;
    const w = this.vakken[i - 1];
    return this.grid.beat(w.P + (x.van - w.van) * w.R) - this.klok.tel(x.van);
  }

  /** De soort op t; een wachtende track is stil tot de klok zijn tel bereikt. */
  soortOp(t) {
    const x = this._vak(t);
    if (x.soort === 'wacht') return t >= this._koppelVan(x) ? 'gekoppeld' : 'stil';
    return x.soort;
  }

  plek(t) {
    const i = this._i(t), x = this.vakken[i];
    const s = this.soortOp(t);
    if (s === 'stil') return x.P;
    if (s === 'vrij') return x.P + (t - x.van) * x.R;
    return this.grid.tijd(this.klok.tel(t) + this._v(i));
  }

  /** Seconden nummer per seconde audioklok op t, aan de rechterkant, exact (besluit 7). */
  snelheid(t) {
    const i = this._i(t), x = this.vakken[i];
    const s = this.soortOp(t);
    if (s === 'stil') return 0;
    if (s === 'vrij') return x.R;
    return this.klok.rate(t) * this.grid.telLengteBijBeat(this.klok.tel(t) + this._v(i));
  }

  speeltOp(t) { return this.soortOp(t) !== 'stil'; }
  gekoppeldOp(t) { return this.soortOp(t) === 'gekoppeld'; }
  /** De verschuiving op t (alleen gekoppeld), anders null. */
  verschuivingOp(t) { return this.gekoppeldOp(t) ? this._v(this._i(t)) : null; }

  /** Wacht hij op A op een start (op de maat, of een geplande vrije start)? Geeft het startmoment of null. */
  wachtOp(A) {
    const x = this._vak(A);
    if (x.soort === 'wacht' && this.klok.loopt && A < this._koppelVan(x)) return this._koppelVan(x);
    if (this.soortOp(A) !== 'stil') return null;
    const later = this.vakken.find((v) => v.van > A && v.soort !== 'stil');
    return later ? later.van : null;
  }

  /** Heeft hij de klok nodig op of na nu (gekoppeld, of wachtend op de klok)? */
  heeftKlokNodig(nu) {
    return this.vakken.some((v, i) => (v.soort === 'gekoppeld' || v.soort === 'wacht') && this._eind(i) > nu && this._koppelVan(v) < this._eind(i));
  }

  get pitchRate() { return 1 + (this.pitch - 0.5) * 2 * BEREIK; }
  zeker(P) { return !!this.grid && this.grid.zeker(P); }
  maatZeker(P) { return !!this.grid && this.grid.maatZeker(P); }
  _pitchVoor(R) { return Math.min(1, Math.max(0, 0.5 + (R - 1) / (2 * BEREIK))); }

  /**
   * Vanaf A een nieuw tijdvak; alles daarna vervalt. ZWIJGT: liep er een "klok naar dit nummer"
   * (een geplande koppeling na het glijden) en is de nieuwe lijn vrij met sync aan, dan blijft die
   * koppeling, vanaf de nieuwe lijn; maar nooit op een onzekere plek (klok-B08). Geeft false als de
   * geplande koppeling daardoor verviel.
   */
  _zet(A, vak) {
    const glij = this.vakken.find((v) => v.naGlijden && v.van > A);
    this.vakken = this.vakken.filter((v) => v.van < A);
    this.vakken.push({ ...vak, van: A });
    if (!glij || vak.soort !== 'vrij' || !this.sync) return true;
    if (!this.zeker(vak.P + (glij.van - A) * vak.R)) return false;
    this.vakken.push({ van: glij.van, soort: 'gekoppeld', naGlijden: true, uitPlek: true });
    return true;
  }

  /** De klok begint hier (klok-B05): tel 0 is de "1" van dit nummer, tempo = wat je hoort. */
  _koppelStart(A, P, rate) {
    this.klok.start(A, this.grid.inMaat(P), this.grid.bpmOp(P) * rate);
    return this.grid.beat(P) - this.klok.tel(A);
  }

  // ---- handelingen; A = het moment waarop het ingaat -------------------------

  /** Besluit 1: alles van het vorige nummer vervalt meteen, ook wat al klonk. Sync blijft staan. */
  laad(A, { grid, duur }) {
    this.geladen = true;
    this.grid = grid;
    this.duur = duur;
    this.pitch = 0.5;
    this.bend = 0;
    this.bendR = null;
    this.vakken = [{ van: -Infinity, soort: 'stil', P: 0 }];
  }

  pauze(A) { this._zet(A, { soort: 'stil', P: this.plek(A) }); }

  speel(A) {
    if (!this.geladen) return { geweigerd: 'geen nummer' };
    if (this.wachtOp(A) !== null) return this.pauze(A);   // wachten annuleren
    if (this.speeltOp(A)) return this.pauze(A);
    const P = this.plek(A);
    if (!this.klok.loopt && this.zeker(P)) {
      // klok-B05: de klok begint op het tempo van deze fader (die staat dus op de stand).
      this.sync = true;
      this._zet(A, { soort: 'gekoppeld', v: this._koppelStart(A, P, this.pitchRate) });
      return;
    }
    if (this.sync && this.klok.loopt && this.zeker(P)) {
      this._zet(A, { soort: 'gekoppeld', v: Math.round(this.grid.beat(P) - this.klok.tel(A)) });   // klok-B07
      return;
    }
    this._zet(A, { soort: 'vrij', P, R: this.pitchRate });
  }

  zetSync(A, aan) {
    const P = this.plek(A);
    if (!aan) {
      // Besluit 3: wat gekoppeld is, of gekoppeld zou worden, wordt vrij op plek en tempo van dat moment.
      this.sync = false;
      if (this.gekoppeldOp(A)) this.pitch = this._pitchVoor(this.snelheid(A));
      const nieuw = [];
      for (let i = 0; i < this.vakken.length; i++) {
        const x = this.vakken[i], eind = this._eind(i);
        if ((x.soort !== 'gekoppeld' && x.soort !== 'wacht') || eind <= A) { nieuw.push(x); continue; }
        const s = this._koppelVan(x);
        const van = Math.max(s, A);
        if (van >= eind) { nieuw.push(x.soort === 'wacht' ? { van: x.van, soort: 'stil', P: x.P } : x); continue; }
        if (x.van < van) nieuw.push(x.soort === 'wacht' && s >= A ? { van: x.van, soort: 'stil', P: x.P } : x);
        nieuw.push({ van, soort: 'vrij', P: this.plek(van), R: this.snelheid(van) });
      }
      this.vakken = nieuw;
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
    if (this.gekoppeldOp(A)) return;
    this._zet(A, { soort: 'gekoppeld', v: Math.round(this.grid.beat(P) - this.klok.tel(A)) });
  }

  /** Klok naar dit nummer (klok-B06): de klok glijdt naar de lijn van wat je hoort; dan gekoppeld. */
  klokNaarMij(A) {
    if (!this.grid) return { geweigerd: 'geen grid' };
    const P = this.plek(A);
    if (!this.zeker(P)) return { geweigerd: 'onzeker' };
    if (!this.speeltOp(A)) return { geweigerd: 'speelt niet' };
    if (!this.klok.loopt) return this.zetSync(A, true);
    if (this.gekoppeldOp(A)) return;
    const R = this.snelheid(A);
    const bA = Math.ceil(this.grid.beat(P) - 1e-9);
    const a = A + (this.grid.tijd(bA) - P) / R;
    const L = (this.grid.tijd(bA + 1) - this.grid.tijd(bA)) / R;
    const r = this.klok.richt(a, L, A);
    this.sync = true;
    // De klok ligt (straks) op de lijn: koppelen op het moment dat hij er echt op ligt, nooit eerder
    // (lag hij er al op, dan nu: K9).
    const klaar = Math.max(A, this.klok.lijn.at(-1).T);
    this.vakken = this.vakken.filter((v) => v.van < A);
    if (klaar > A) {
      this.vakken.push({ van: A, soort: 'vrij', P, R });
      this.vakken.push({ van: klaar, soort: 'gekoppeld', naGlijden: true, uitPlek: true });
    } else this.vakken.push({ van: A, soort: 'gekoppeld', v: bA - r.N });
  }

  /**
   * Pitchfader. Gekoppeld en hoorbaar = het klok-tempo (klok-B13), met soft-takeover (besluit 6,
   * klok-B14): de fader heeft de klok alleen als hij op de stand van de klok staat of erlangs komt.
   * De stand is de fader waarbij "bpm van het nummer hier × pitch" het tempo van de klok is (dezelfde
   * formule als waarmee de fader de klok zet; in de overgangstel van een tempokaart is dat NIET
   * 0,5 + (snelheid − 1) / (2 · bereik): die tel is korter of langer dan het stuk zegt). Die
   * verschuift na koppelen, na een tempowissel van de klok door iets anders, na een fader die
   * bewoog terwijl je hem niet hoorde, en ook als het nummer in een stuk met een ander tempo komt
   * (seek, een grens van de tempokaart: klok-S09). Daarom meetkundig, zonder vlag "grijpt": een
   * fader die de klok had staat precies op de stand (tolerantie 1e-6) en grijpt dus meteen.
   */
  zetPitch(A, v01) {
    const was = this.pitch;
    this.pitch = v01;
    if (this.gekoppeldOp(A)) {
      if (!this.set.hoorbaar(this.n, A)) return;   // klok-B14
      const bpm = this.grid.bpmOp(this.plek(A));
      const nodig = 0.5 + (this.klok.bpm(A) / bpm - 1) / (2 * BEREIK);
      const erlangs = (was - nodig) * (v01 - nodig) <= 0 || Math.abs(v01 - nodig) < GRIJP || Math.abs(was - nodig) < GRIJP;
      if (erlangs) this.set.zetKlokTempo(A, bpm * this.pitchRate);
      return;
    }
    if (this.speeltOp(A)) this._zet(A, { soort: 'vrij', P: this.plek(A), R: this.pitchRate });
  }

  /** ZWIJGT: verzetten terwijl hij wacht = opnieuw starten op de maat vanaf de nieuwe plek. */
  _naarCue(A, P) {
    const wachtte = this.wachtOp(A) !== null;
    this._zet(A, { soort: 'stil', P });
    if (wachtte && this.klok.loopt) this.startOpDeMaat(A);
  }

  jog(A, tellen) {
    const i = this._i(A), x = this.vakken[i];
    if (this.gekoppeldOp(A)) { this._zet(A, { soort: 'gekoppeld', v: this._v(i) + tellen }); return; }   // klok-B03, B15
    const L = this.grid ? this.grid.telLengteOp(this.plek(A)) : 0.5;
    const P = Math.max(0, this.plek(A) + tellen * L);
    if (this.soortOp(A) === 'vrij') this._zet(A, { soort: 'vrij', P, R: x.R });
    else this._naarCue(A, P);
  }

  /** Besluit 4 (klok-S04): zolang je drukt 4% sneller of trager; loslaten wist de bend altijd. */
  nudge(A, richting, aan) {
    if (aan) {
      if (this.bend || !this.speeltOp(A)) return;
      this.bend = richting;
      this.bendR = this.snelheid(A);
      this._zet(A, { soort: 'vrij', P: this.plek(A), R: this.bendR * (1 + BEND * richting) });
      return;
    }
    if (this.bend !== richting) return;
    this.bend = 0;
    if (!this.speeltOp(A)) return;
    const P = this.plek(A);
    if (this.sync && this.klok.loopt && this.zeker(P)) {
      this._zet(A, { soort: 'gekoppeld', v: this.grid.beat(P) - this.klok.tel(A) });   // fractie mag
    } else {
      this._zet(A, { soort: 'vrij', P, R: this.bendR });
    }
  }

  zoek(A, P2) {
    P2 = Math.max(0, Math.min(P2, this.duur));
    const i = this._i(A), x = this.vakken[i];
    const s = this.soortOp(A);
    if (s === 'gekoppeld') {
      // klok-S12: fasebehoudend, de verschuiving blijft (op hele tellen).
      const v0 = this._v(i);
      const v = v0 + Math.round(this.grid.beat(P2) - (this.klok.tel(A) + v0));
      const doel = this.grid.tijd(this.klok.tel(A) + v);
      if (!this.zeker(doel)) {
        // Besluit 8: vrij, sync uit.
        const R = this.snelheid(A);
        this.sync = false;
        this.pitch = this._pitchVoor(R);
        this._zet(A, { soort: 'vrij', P: P2, R });
        return { melding: 'onzeker: vrij, sync uit' };
      }
      this._zet(A, { soort: 'gekoppeld', v });
    } else if (s === 'vrij') {
      if (!this._zet(A, { soort: 'vrij', P: P2, R: x.R })) {
        // Besluit 8 ook tijdens het glijden: de geplande koppeling zou op een onzeker stuk landen.
        this.sync = false;
        return { melding: 'onzeker: vrij, sync uit' };
      }
    } else this._naarCue(A, P2);
  }

  /**
   * Besluit 2 (klok-S11, B07): vanaf startpunt P is m de "1" van de maat van P; het nummer begint
   * op de eerste "1" van de klok waarop het, binnenkomend op tel b0, zijn eigen "1" op een "1" van
   * de klok heeft. Het startmoment is een KLOK-tel (startTel): verandert de klok, dan schuift het mee.
   */
  startOpDeMaat(A) {
    if (!this.geladen) return { geweigerd: 'geen nummer' };
    if (this.wachtOp(A) !== null) return this.pauze(A);
    if (this.speeltOp(A)) return this.pauze(A);
    const P0 = this.plek(A);
    if (!this.klok.loopt) return this.speel(A);
    if (!this.maatZeker(P0)) return { geweigerd: 'de "1" is hier niet zeker' };
    const b0 = this.grid.beat(P0);
    const m = b0 - this.grid.inMaat(P0);
    const k = Math.ceil((this.klok.tel(A) + 1e-6 - (b0 - m)) / PER_MAAT);
    const startTel = k * PER_MAAT + (b0 - m);
    this.sync = true;
    this._zet(A, { soort: 'wacht', P: P0, C: startTel, v: b0 - startTel });
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

  /**
   * Besluit 5: alleen als niets speelt (op A) en niets de klok nog nodig heeft (gekoppeld tot na nu,
   * of wachtend op de maat). Stoppen geldt meteen.
   */
  klokStop(A, nu = A) {
    if (this.tracks.some((t) => t.speeltOp(A) || t.heeftKlokNodig(nu))) return { geweigerd: 'er speelt of wacht nog iets op de klok' };
    this.klok.stop();
  }
}
