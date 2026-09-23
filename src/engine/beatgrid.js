/**
 * Het beatgrid: waar liggen de tellen in een track.
 *
 * Een TEMPOKAART: een lijst stukken { van, bpm, anker }, gesorteerd op `van`.
 * Een stuk geldt vanaf `van` tot het volgende stuk; het eerste stuk geldt ook
 * vóór zijn `van` (dan is er altijd een tel, ook links van de eerste marker).
 * `anker` is een tracktijd waarop een tel van dat stuk valt; alle tellen van
 * het stuk liggen op anker + k × 60/bpm. Eén stuk is het oude grid (één tempo,
 * één anker) — alles wat op een klok gemaakt is. Albums, nummers zonder klik
 * en rubato krijgen er meer.
 *
 * De tellen worden DOORGENUMMERD over de stukken heen: tel 0 ligt op het anker
 * van het eerste stuk, en de index loopt door. beatAt(t) en timeOf(beat) zijn
 * daardoor monotoon en continu, en elkaars inverse. Binnen een stuk lineair.
 * Op een grens: de laatste tel van het vorige stuk vóór de eerste tel van het
 * nieuwe (die op of na `van` valt) is één "overgangstel" van afwijkende lengte.
 * Is die korter dan een halve tel van het vorige stuk, dan vervalt de laatste
 * tel van het vorige stuk — anders krijg je een flits van een tel.
 *
 * Alle tijden zijn TRACKTIJD in seconden, niet afspeeltijd. Draait een deck op
 * 1,05x, dan verschuift het grid niet — de track klinkt alleen sneller. Wie de
 * hoorbare bpm wil, vermenigvuldigt zelf met de rate.
 *
 * Bewerken gebeurt "vanaf hier": elke bewerking krijgt een tracktijd en raakt
 * alleen het stuk waarin die valt.
 *
 * Deze module kent geen engine, geen deck en geen DOM: alleen rekenwerk.
 */

export const MIN_BPM = 40;
export const MAX_BPM = 300;

const klem = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
const EPS = 1e-9;
const eindig = (x) => typeof x === 'number' && Number.isFinite(x);

/** Een stuk netjes maken; null als het onbruikbaar is. */
function stukVan(s) {
  if (!s) return null;
  const bpm = Number(s.bpm), anker = Number(s.anker ?? s.firstBeat ?? 0), van = Number(s.van ?? 0);
  if (!eindig(bpm) || bpm <= 0 || !eindig(anker) || !eindig(van)) return null;
  const uit = { van, bpm: klem(bpm), anker };
  if (eindig(s.zekerheid)) uit.zekerheid = Math.max(0, Math.min(1, s.zekerheid));
  return uit;
}

export class Beatgrid {
  /**
   * @param data  { stukken: [{ van, bpm, anker, zekerheid? }], beatsPerBar?, zeker?, slot? }
   *              of het oude { bpm, firstBeat, beatsPerBar } (= één stuk).
   */
  constructor(data = {}) {
    const d = data || {};
    let stukken = Array.isArray(d.stukken)
      ? d.stukken.map(stukVan).filter(Boolean)
      : [stukVan({ van: 0, bpm: d.bpm ?? 120, anker: d.firstBeat ?? 0 })].filter(Boolean);
    if (!stukken.length) stukken = [{ van: 0, bpm: 120, anker: 0 }];
    this._stukken = stukken;
    this.beatsPerBar = Number.isInteger(d.beatsPerBar) && d.beatsPerBar > 0 ? d.beatsPerBar : 4;
    // `slot`: met de hand bevestigd — een automatisch voorstel (stap C) mag
    // dit grid nooit overschrijven. `zeker`: wat de analyse ervan vond.
    this.slot = !!d.slot;
    this.zeker = typeof d.zeker === 'boolean' ? d.zeker : null;
    this._bouw();
  }

  // ---- de kaart --------------------------------------------------------------

  /** Kopieën: wie wil wijzigen, gebruikt de methoden hieronder. */
  get stukken() { return this._stukken.map((s) => ({ ...s })); }
  get aantalStukken() { return this._stukken.length; }

  /**
   * De kaart uitrekenen als lineaire delen { t0, b0, L }: beatAt(t) = b0 + (t - t0) / L
   * vanaf t0 tot het volgende deel. Het eerste deel geldt ook links van t0.
   * `stuk` = index van het stuk waar het deel bij hoort (overgangen: het nieuwe).
   */
  _bouw() {
    this._stukken.sort((a, b) => a.van - b.van);
    // Twee stukken op dezelfde plek: de laatste wint, niet allebei half.
    this._stukken = this._stukken.filter((s, i, l) => i === l.length - 1 || l[i + 1].van - s.van > EPS);
    const s0 = this._stukken[0];
    // sT/sB: waar een deel begint, om in te zoeken. Het eerste deel geldt ook
    // links van zijn anker, dus daar is dat -oneindig.
    const delen = [{ t0: s0.anker, b0: 0, L: 60 / s0.bpm, stuk: 0, eerste: true, sT: -Infinity, sB: -Infinity }];
    for (let i = 1; i < this._stukken.length; i++) {
      const s = this._stukken[i];
      const L = 60 / s.bpm;
      // Eerste tel van dit stuk: op of na `van`.
      const start = s.anker + Math.ceil((s.van - s.anker) / L - EPS) * L;
      for (;;) {
        const vorig = delen.at(-1);
        // Laatste tel van het vorige stuk vóór `start`.
        let p = Math.ceil(vorig.b0 + (start - vorig.t0) / vorig.L - EPS) - 1;
        let tp = vorig.t0 + (p - vorig.b0) * vorig.L;
        if (start - tp < vorig.L / 2 - EPS) { p -= 1; tp -= vorig.L; }
        if (tp < vorig.t0 - EPS && !vorig.eerste) {
          // Het vorige stuk is zo kort dat er geen tel van overblijft: het
          // valt weg (samen met zijn overgang) en we rekenen vanaf het stuk daarvoor.
          delen.pop();
          if (delen.at(-1)?.overgang) delen.pop();
          continue;
        }
        delen.push({ t0: tp, b0: p, L: start - tp, stuk: i, overgang: true, sT: tp, sB: p });
        delen.push({ t0: start, b0: p + 1, L, stuk: i, sT: start, sB: p + 1 });
        break;
      }
    }
    this._delen = delen;
  }

  _deelBijTijd(t) {
    const d = this._delen;
    let lo = 0, hi = d.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (d[m].sT <= t) lo = m; else hi = m - 1; }
    return d[lo];
  }

  _deelBijBeat(b) {
    const d = this._delen;
    let lo = 0, hi = d.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (d[m].sB <= b) lo = m; else hi = m - 1; }
    return d[lo];
  }

  /** Index van het stuk waar tracktijd t in valt (vóór het eerste stuk: 0). */
  stukIndex(t) {
    const s = this._stukken;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m].van <= t + EPS) lo = m; else hi = m - 1; }
    return lo;
  }

  /** Het stuk rond t, als kopie, met zijn index. */
  stukBij(t) { const i = this.stukIndex(t); return { index: i, ...this._stukken[i] }; }

  /** Tempo (tracktijd) op t. */
  bpmAt(t) { return this._stukken[this.stukIndex(t)].bpm; }
  /** Seconden per tel op t (tracktijd). */
  beatLengthAt(t) { return 60 / this.bpmAt(t); }

  /**
   * Tracktijden waar de kaart van tempo wisselt: begin van een overgangstel
   * en begin van een nieuw stuk. Voor wie moet herankeren als de speelkop er
   * langs komt (effecten op de tel).
   */
  wissels() { return this._delen.slice(1).map((d) => d.t0); }

  /** De eerstvolgende wissel na t, of null. */
  volgendeWissel(t) {
    for (const d of this._delen) if (!d.eerste && d.t0 > t + EPS) return d.t0;
    return null;
  }

  /*
   * Voor één-stuks-grids en de tests: tempo en anker van het EERSTE stuk.
   * Code die met een positie werkt gebruikt bpmAt/beatLengthAt — met meerdere
   * stukken zegt `bpm` niets over waar je bent.
   */
  get bpm() { return this._stukken[0].bpm; }
  get beatLength() { return 60 / this._stukken[0].bpm; }
  get firstBeat() { return this._stukken[0].anker; }
  get barLength() { return this.beatLength * this.beatsPerBar; }

  // ---- rekenen ---------------------------------------------------------------

  /** Welke beat hoort bij deze tracktijd? Mag gebroken en negatief zijn. */
  beatAt(t) { const d = this._deelBijTijd(t); return d.b0 + (t - d.t0) / d.L; }

  /** Tracktijd van een beatnummer. */
  timeOf(beat) { const d = this._deelBijBeat(beat); return d.t0 + (beat - d.b0) * d.L; }

  /** Dichtstbijzijnde beat, als tijd. */
  nearest(t) { return this.timeOf(Math.round(this.beatAt(t))); }

  /** Eerstvolgende beat op of na t. */
  next(t) { return this.timeOf(Math.ceil(this.beatAt(t) - EPS)); }

  /** Positie binnen de huidige beat, 0..1. */
  phase(t) {
    const b = this.beatAt(t);
    return b - Math.floor(b);
  }

  /** Positie binnen de maat, 0..1. Hiermee lijn je twee decks op de "1" uit. */
  barPhase(t) {
    const b = this.beatAt(t) / this.beatsPerBar;
    return b - Math.floor(b);
  }

  /** Staat deze tijd op de eerste tel van een maat? */
  isDownbeat(t, tolerantie = 0.02) {
    const p = this.barPhase(t);
    const maat = this.beatLengthAt(t) * this.beatsPerBar;
    return p < tolerantie / maat || p > 1 - tolerantie / maat;
  }

  /**
   * Alle beattijden in een venster. Voor het tekenen van de golfvorm — daar wil
   * je geen lijst van duizenden beats waarvan je er dertig ziet.
   * `stap` slaat tellen over (4 = alleen maatbegin), handig bij ver uitzoomen.
   */
  beatsBetween(van, tot, max = 4096, stap = 1) {
    const uit = [];
    const per = this.beatsPerBar;
    let b = Math.ceil(this.beatAt(van) - EPS);
    if (stap > 1) b += ((stap - (b % stap)) % stap + stap) % stap;
    for (let i = 0; i < max; i++, b += stap) {
      const t = this.timeOf(b);
      if (t > tot) break;
      uit.push({ tijd: t, beat: b, maatbegin: ((b % per) + per) % per === 0 });
    }
    return uit;
  }

  // ---- bewerken: alleen het stuk rond t ----------------------------------------
  // Zonder t: het stuk op 0 (het eerste), zoals het oude grid met één stuk.

  _i(t) { return this.stukIndex(t ?? -Infinity); }

  _pas(i, fn) {
    fn(this._stukken[i]);
    this._bouw();
    return this;
  }

  /** Dichtstbijzijnde tel op het rooster van stuk s (niet de overgang). */
  _roosterTel(s, t) {
    const L = 60 / s.bpm;
    return s.anker + Math.round((t - s.anker) / L) * L;
  }

  /**
   * Tempo van het stuk rond `bij` (of rond `ankerTijd`) zetten. Met een
   * ankerTijd komt er een tel precies daar te liggen; zonder blijft de tel
   * die het dichtst bij `bij` lag op zijn plek. Zo glijdt er niets weg waar
   * je bent.
   */
  setBpm(bpm, { ankerTijd = null, bij = null } = {}) {
    return this._pas(this._i(ankerTijd ?? bij), (s) => {
      if (ankerTijd !== null) s.anker = ankerTijd;
      else if (bij !== null) s.anker = this._roosterTel(s, bij);
      s.bpm = klem(bpm);
    });
  }

  /** Tempo en/of tel in één keer, voor het stuk rond t (een tap, de verfijning). */
  zetStuk(t, { bpm, anker, zekerheid } = {}) {
    return this._pas(this._i(t), (s) => {
      if (eindig(bpm)) s.bpm = klem(bpm);
      if (eindig(anker)) s.anker = anker;
      if (eindig(zekerheid)) s.zekerheid = Math.max(0, Math.min(1, zekerheid));
      else delete s.zekerheid;
    });
  }

  /** ×2 en ½ voor het stuk rond `bij`; de tel het dichtst bij `bij` blijft liggen. */
  verdubbel(bij = null) { return this._schaal(2, bij); }
  halveer(bij = null) { return this._schaal(0.5, bij); }
  _schaal(f, bij) {
    return this._pas(this._i(bij), (s) => {
      if (bij !== null) s.anker = this._roosterTel(s, bij);
      s.bpm = klem(s.bpm * f);
    });
  }

  /** Het stuk rond `bij` opschuiven, in seconden. */
  schuif(seconden, bij = null) { return this._pas(this._i(bij), (s) => { s.anker += seconden; }); }

  /** Leg een tel precies hier (in het stuk rond t). Gebruik je als je op de "1" tikt. */
  ankerHier(t) { return this._pas(this._i(t), (s) => { s.anker = t; }); }

  /**
   * Schuif het stuk rond t zo dat zijn dichtstbijzijnde tel op t komt te liggen.
   * Handig als het tempo klopt maar het grid een fractie verschoven staat.
   */
  lijnUitOp(t) { return this._pas(this._i(t), (s) => { s.anker += t - this._roosterTel(s, t); }); }

  /**
   * Nieuw stuk vanaf t: zelfde tempo en fase als het stuk waar je in zat, dus
   * er verandert hoorbaar niets — pas je daarna iets aan, dan alleen vanaf hier.
   * False als er op t al een stuk begint.
   */
  splits(t) {
    if (!eindig(t) || this._stukken.some((s) => Math.abs(s.van - t) < EPS)) return false;
    const s = this._stukken[this.stukIndex(t)];
    this._stukken.push({ van: t, bpm: s.bpm, anker: s.anker });
    this._bouw();
    return true;
  }

  /** Het stuk rond t samenvoegen met het vorige: het vorige loopt dan door. False op het eerste stuk. */
  voegSamen(t) {
    const i = this.stukIndex(t);
    if (i === 0) return false;
    this._stukken.splice(i, 1);
    this._bouw();
    return true;
  }

  // ---- opslaan ---------------------------------------------------------------

  toJSON() {
    const uit = { stukken: this.stukken, beatsPerBar: this.beatsPerBar };
    if (this.slot) uit.slot = true;
    if (this.zeker !== null) uit.zeker = this.zeker;
    return uit;
  }

  /** Leest het nieuwe én het oude formaat ({ bpm, firstBeat }). */
  static van(data) {
    if (!data) return null;
    if (!Array.isArray(data.stukken) && !eindig(Number(data.bpm))) return null;
    return new Beatgrid(data);
  }

  kopie() { return new Beatgrid(this.toJSON()); }
}

/**
 * Tap tempo.
 *
 * Een RECHTE LIJN door de tikken (kleinste kwadraten): dat geeft tempo én
 * fase, en elke tik telt mee in plaats van alleen de tussenpozen. Eerst een
 * robuuste schatting (mediaan van de tussenpozen, mediaan van de fase), dan
 * vallen tikken weg die meer dan een kwart tel naast die lijn liggen — één
 * keer te laat tikken trekt de lijn dan niet scheef. Een overgeslagen tel
 * wordt herkend (tussenpoos ≈ 2 tellen).
 *
 * Als de track speelt, gaat de lijn door de TRACKTIJDEN van de tikken: die
 * geven het tempo in tracktijd rechtstreeks, welke rate er ook op staat.
 * Staat hij stil (of zijn er geen tracktijden), dan door de kloktijden: dat
 * is wat je HOORDE, de aanroeper deelt dan zelf door de rate.
 *
 * Te lang wachten begint een nieuwe reeks, want dan was je aan het luisteren
 * en niet aan het tellen.
 */
export class TapTempo {
  constructor({ maxGat = 2500, minTaps = 2 } = {}) {
    this.maxGat = maxGat;
    this.minTaps = minTaps;
    this.taps = [];
  }

  reset() { this.taps = []; }
  get count() { return this.taps.length; }

  /**
   * @param nu tijdstip van de tik in ms
   * @param tracktijd waar de track op dat moment stond
   * @returns {{bpm:number, bpmTrack:number|null, anker:number|null, taps:number,
   *            tijden:number[], gebruikt:number}|null}
   *   bpm = hoorbaar (kloktijd), bpmTrack = in tracktijd (null als de track
   *   niet liep), anker = tracktijd van de tel bij de LAATSTE tik (op de lijn),
   *   tijden = tracktijden van de tikken.
   */
  tap(nu, tracktijd = null) {
    const vorige = this.taps.at(-1);
    if (vorige && nu - vorige.nu > this.maxGat) this.taps = [];
    this.taps.push({ nu, tracktijd });
    if (this.taps.length > 16) this.taps.shift();
    if (this.taps.length < this.minTaps) return null;

    const klok = rechteLijn(this.taps.map((x) => x.nu / 1000));
    if (!klok) return null;
    const tijden = this.taps.map((x) => x.tracktijd);
    // Tracktijden bruikbaar: allemaal getallen en oplopend (de track liep).
    const loopt = tijden.every(eindig) && tijden.every((x, i) => i === 0 || x > tijden[i - 1] + 1e-4);
    const track = loopt ? rechteLijn(tijden) : null;

    let anker = null;
    if (track) anker = track.tijdVan(track.laatsteK);
    else if (eindig(tijden.at(-1))) anker = tijden.at(-1);

    return {
      bpm: klem(60 / klok.L),
      bpmTrack: track ? klem(60 / track.L) : null,
      anker,
      taps: this.taps.length,
      tijden: loopt ? tijden.slice() : [],
      gebruikt: (track || klok).gebruikt,
    };
  }
}

const mediaan = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Rechte lijn t = a + k·L door tiktijden (seconden). Elke tik krijgt een
 * telnummer k (een tussenpoos van ~2 tellen = een overgeslagen tel).
 * Geëxporteerd voor de tests.
 */
export function rechteLijn(tijden) {
  if (tijden.length < 2) return null;
  const gaten = [];
  for (let i = 1; i < tijden.length; i++) gaten.push(tijden[i] - tijden[i - 1]);
  const L0 = mediaan(gaten);
  if (!(L0 > 0)) return null;
  const k = [0];
  for (let i = 1; i < tijden.length; i++) k.push(k[i - 1] + Math.max(1, Math.round(gaten[i - 1] / L0)));

  // Robuust begin: tempo = mediaan, fase = mediaan van wat overblijft.
  const a0 = mediaan(tijden.map((t, i) => t - k[i] * L0));
  const goed = tijden.map((t, i) => Math.abs(t - (a0 + k[i] * L0)) <= L0 / 4);
  const idx = tijden.map((_, i) => i).filter((i) => goed[i]);
  let L = L0, a = a0;
  if (idx.length >= 2) {
    const n = idx.length;
    const mk = idx.reduce((s, i) => s + k[i], 0) / n;
    const mt = idx.reduce((s, i) => s + tijden[i], 0) / n;
    let sxy = 0, sxx = 0;
    for (const i of idx) { sxy += (k[i] - mk) * (tijden[i] - mt); sxx += (k[i] - mk) ** 2; }
    if (sxx > 0 && sxy > 0) { L = sxy / sxx; a = mt - L * mk; }
  }
  return { L, a, k, gebruikt: idx.length, laatsteK: k.at(-1), tijdVan: (kk) => a + kk * L };
}
