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
 * MATEN (25 september 2026): elk stuk heeft een maat-anker `maat`, de
 * tracktijd van een tel 1. De tellen lopen door over de grenzen, de maten niet
 * per se: na een tempowissel begint een nieuw nummer vaak op een eigen "1".
 * Een stuk zonder `maat` (een grid van vóór deze versie, de analyse, een nieuw
 * stuk) krijgt er een bij het inlezen: de maten lopen dan door vanaf het
 * vorige stuk, precies zoals ze vroeger telden (het eerste stuk: zijn anker
 * is tel 1). Daarna houdt elk stuk zijn eigen maat vast, ook als je een ander
 * stuk bewerkt. Een maat die erbij komt is de eerste tel 1 op of na het begin
 * van het stuk; een bestaande blijft staan waar hij staat.
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

const EPS = 1e-9;
const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
const mod = (a, n) => ((a % n) + n) % n;

export const MIN_BPM = 40;
export const MAX_BPM = 300;

/**
 * Zekerheid per stuk (0..1, van de automatische analyse): vanaf ZEKER_VANAF
 * mag je erop syncen en beat-loopen, onder GEEN_PULS is er geen puls. De
 * getallen komen uit de verdeling op Clay's library; zie server/analyze.js,
 * waar dezelfde twee staan (server.test controleert dat ze gelijk zijn).
 */
export const ZEKER_VANAF = 0.65;
export const GEEN_PULS = 0.15;

/**
 * Wat een zekerheid betekent: 'zeker', 'onzeker' of 'geenpuls'. Een stuk
 * zonder zekerheid is met de hand gezet (tap, of van vóór de analyse) en
 * telt als zeker; een grid op slot is overal zeker.
 */
export function soortZekerheid(zekerheid, slot = false) {
  if (slot || !eindig(zekerheid)) return 'zeker';
  if (zekerheid >= ZEKER_VANAF) return 'zeker';
  return zekerheid < GEEN_PULS ? 'geenpuls' : 'onzeker';
}

const klem = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));

/** Een stuk netjes maken; null als het onbruikbaar is. */
function stukVan(s) {
  if (!s) return null;
  const bpm = Number(s.bpm), anker = Number(s.anker ?? s.firstBeat ?? 0), van = Number(s.van ?? 0);
  if (!eindig(bpm) || bpm <= 0 || !eindig(anker) || !eindig(van)) return null;
  const uit = { van, bpm: klem(bpm), anker };
  if (eindig(s.zekerheid)) uit.zekerheid = Math.max(0, Math.min(1, s.zekerheid));
  // Geen maat (oud grid) = niets; null telt niet als 0.
  const maat = s.maat === null || s.maat === undefined || s.maat === '' ? NaN : Number(s.maat);
  if (eindig(maat)) uit.maat = maat;
  // Van de tellen (src/engine/tellen.js): waarom het stuk onzeker is, en of de
  // oude analyse het dubbele of halve tempo hoorde. Alleen bekende waarden.
  if (TWIJFELS.includes(s.twijfel)) uit.twijfel = s.twijfel;
  if (s.octaaf === 2 || s.octaaf === 0.5) uit.octaaf = s.octaaf;
  // Met het oor gecontroleerd (de controleklik, keurGoed): zeker, wat de tellen ook zeggen.
  if (s.ok === true) uit.ok = true;
  return uit;
}

/** De redenen van twijfel die een stuk kan hebben (tellen.js, TWIJFEL_TEKST). */
export const TWIJFELS = ['geen puls', 'rubato', 'drift', 'los', 'maat', 'oneens'];

export class Beatgrid {
  /**
   * @param data  { stukken: [{ van, bpm, anker, zekerheid?, maat? }], beatsPerBar?, zeker?, slot? }
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
    // `bron`: 'auto' = voorstel van de analyse, 'hand' = daarna met de hand
    // bewerkt (het deck zet dat bij elke bewerking), null = van vóór stap C.
    // De server analyseert bij het opstarten alleen null opnieuw.
    this.bron = d.bron === 'auto' || d.bron === 'hand' ? d.bron : null;
    // `methode`: 'tellen' = gemaakt uit de tellen van Beat This! (versie: van
    // de methode); zonder = de oude analyse, of met de hand.
    this.methode = d.methode === 'tellen' ? 'tellen' : null;
    this.versie = Number.isInteger(d.versie) && d.versie > 0 ? d.versie : null;
    this._bouw();
  }

  // ---- de kaart --------------------------------------------------------------

  /** Kopieën: wie wil wijzigen, gebruikt de methoden hieronder. */
  get stukken() {
    // Altijd in dezelfde volgorde (zoals de server hem bewaart): wie JSON vergelijkt, ziet alleen echte verschillen.
    return this._stukken.map((s) => {
      const k = { van: s.van, bpm: s.bpm, anker: s.anker };
      if (eindig(s.zekerheid)) k.zekerheid = s.zekerheid;
      if (eindig(s.maat)) k.maat = s.maat;
      if (s.twijfel) k.twijfel = s.twijfel;
      if (s.octaaf) k.octaaf = s.octaaf;
      if (s.ok) k.ok = true;
      return k;
    });
  }
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
        // De overgangstel is de laatste tel van het vorige stuk: die telt nog in ZIJN maat.
        delen.push({ t0: tp, b0: p, L: start - tp, stuk: i, overgang: true, sT: tp, sB: p, maatStuk: vorig.stuk });
        delen.push({ t0: start, b0: p + 1, L, stuk: i, sT: start, sB: p + 1 });
        break;
      }
    }
    this._delen = delen;

    /*
     * Maten per stuk: `_maatB[i]` = het (doorlopende) telnummer van een tel 1
     * in stuk i. Zonder eigen `maat` telt een stuk de maten van het vorige
     * door; dat was vroeger het hele verhaal (tel 0 = anker van het eerste
     * stuk = tel 1), dus een oud grid ziet er precies zo uit als toen. Zo'n
     * maat wordt daarna vastgelegd als de eerste tel 1 op of na `van`, op het
     * eigen rooster van het stuk.
     */
    const per = this.beatsPerBar;
    const hoofd = [];
    for (const d of delen) if (!d.overgang) hoofd[d.stuk] = d;
    this._maatB = [];
    let vorige = 0;
    for (let i = 0; i < this._stukken.length; i++) {
      const s = this._stukken[i], d = hoofd[i];
      if (!d) {                                           // viel weg: geen eigen tellen
        if (!eindig(s.maat)) delete s.maat;
        this._maatB[i] = vorige;
        continue;
      }
      if (eindig(s.maat)) {
        // Een eigen maat blijft staan waar hij staat (niet "netjes" verplaatsen:
        // na ×2 zijn er twee kandidaten voor de "1", en ½ moet de oude terugvinden).
        this._maatB[i] = vorige = d.b0 + Math.round((s.maat - d.t0) / d.L);
        continue;
      }
      const eerste = d.b0 + Math.ceil((s.van - d.t0) / d.L - EPS);
      const b = eerste + mod(vorige - eerste, per);
      s.maat = d.t0 + (b - d.b0) * d.L;
      this._maatB[i] = vorige = b;
    }
  }

  /** Telnummer van een tel 1 in de maat van deel d. */
  _maatVan(d) { return this._maatB[d.maatStuk ?? d.stuk]; }

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

  /** 'zeker', 'onzeker' of 'geenpuls' op tracktijd t (zie soortZekerheid). */
  zekerheidBij(t) { return soortZekerheid(this._stukken[this.stukIndex(t)].zekerheid, this.slot); }

  /**
   * Mag je op t syncen en beat-loopen? Op slot altijd; anders alleen in een
   * stuk dat zeker is. Een onzeker grid gebruiken is erger dan niets doen: de
   * sync loopt dan na een paar maten een tel weg zonder dat je weet waarom.
   */
  zekerBij(t) { return this.zekerheidBij(t) === 'zeker'; }

  /**
   * De zekerheidsstrook onder de golfvorm: per stuk { van, tot, soort },
   * aaneengesloten van 0 tot `duur`. Buren met dezelfde soort blijven
   * aparte stukken: de grens is ook informatie.
   */
  strook(duur) {
    const s = this._stukken;
    const uit = [];
    for (let i = 0; i < s.length; i++) {
      const van = i === 0 ? 0 : Math.max(0, s[i].van);
      const tot = i + 1 < s.length ? Math.min(duur, s[i + 1].van) : duur;
      if (tot > van) uit.push({ van, tot, soort: soortZekerheid(s[i].zekerheid, this.slot) });
    }
    return uit;
  }

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

  /**
   * Positie binnen de maat, 0..1, geteld vanaf de maat van het stuk waar t in
   * valt. Hiermee lijn je twee decks op de "1" uit.
   */
  barPhase(t) {
    const d = this._deelBijTijd(t);
    const x = (d.b0 + (t - d.t0) / d.L - this._maatVan(d)) / this.beatsPerBar;
    return x - Math.floor(x);
  }

  /**
   * Welke tel van de maat klinkt er op t: 1..beatsPerBar (tussen twee tellen:
   * de vorige). Voor lampjes die op de "1" anders knipperen.
   */
  telInMaat(t) {
    const d = this._deelBijTijd(t);
    const b = Math.floor(d.b0 + (t - d.t0) / d.L + 1e-6);
    return mod(b - this._maatVan(this._deelBijBeat(b)), this.beatsPerBar) + 1;
  }

  /** Is tel `b` (doorlopend telnummer) een tel 1? */
  isMaatbegin(b) { return mod(b - this._maatVan(this._deelBijBeat(b)), this.beatsPerBar) === 0; }

  /**
   * Tracktijd `tellen` tellen verder dan t (negatief = terug): een beatjump.
   * In TELLEN, niet in seconden: over een stukgrens van de tempokaart is een
   * tel niet overal even lang, en zo blijft de fase binnen de tel precies
   * gelijk (t op 0,3 van zijn tel landt op 0,3 van de doeltel).
   */
  verschuif(t, tellen) { return this.timeOf(this.beatAt(t) + tellen); }

  /**
   * Waar je naartoe springt als de fase moet blijven lopen (quantize): het
   * punt bij `doel` dat op dezelfde plek in zijn tel zit als `t`, hooguit een
   * halve tel van `doel` af. Een hotcue op de tel, ingedrukt op 0,3 van een
   * tel, landt zo op 0,3 na de hotcue: het ritme struikelt niet.
   */
  metFaseVan(doel, t) {
    const bd = this.beatAt(doel), bt = this.beatAt(t);
    let d = (bt - Math.floor(bt)) - (bd - Math.floor(bd));
    if (d >= 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return this.timeOf(bd + d);
  }

  /**
   * De eerste tel op of na tel `b` die `per` tellen na een "1" valt (een
   * veelvoud van `per`, geteld vanaf de "1" van het stuk waar hij in valt):
   * met per = beatsPerBar het volgende MAATbegin. Sinds het maat-anker per
   * stuk (`maat`, 25 sep) is dat de "1" van dat stuk, zoals de golfvorm hem
   * tekent en de lampjes hem knipperen (isMaatbegin/telInMaat), niet een
   * maat die vanaf tel 0 van het eerste stuk doortelt. Oude grids zonder
   * `maat` tellen door vanaf het vorige stuk, dus daar is het hetzelfde.
   */
  volgendeVeelvoud(b, per = this.beatsPerBar) {
    let n = Math.ceil(b - EPS);
    // Binnen één stuk is het er na hooguit `per` tellen; over een stukgrens
    // (een andere "1") hooguit twee keer zoveel. 8× is ruim.
    for (let i = 0; i < 8 * per && mod(n - this._maatVan(this._deelBijBeat(n)), per) !== 0; i++) n++;
    return n;
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
    // Met stap > 1: uitlijnen op de maat van het stuk waar de tel in valt,
    // opnieuw bij elk stuk (een nieuw stuk kan een eigen "1" hebben).
    const lijn = (b) => {
      if (stap <= 1) return b;
      // Tel voor tel: de uitgelijnde tel kan in een volgend stuk vallen, met een andere "1".
      for (let n = 0; n < 8 * stap && mod(b - this._maatVan(this._deelBijBeat(b)), stap) !== 0; n++) b++;
      return b;
    };
    let b = lijn(Math.ceil(this.beatAt(van) - EPS));
    for (let i = 0; i < max; i++) {
      const t = this.timeOf(b);
      if (t > tot) break;
      uit.push({ tijd: t, beat: b, maatbegin: this.isMaatbegin(b) });
      b = lijn(b + 1);
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
      // Vanaf de tel die blijft liggen telt de maat hetzelfde aantal tellen
      // door: een tempo bijstellen verschuift de "1" niet naar een andere tel.
      const P = ankerTijd ?? (bij !== null ? this._roosterTel(s, bij) : s.anker);
      const k = Math.round((s.maat - P) * s.bpm / 60);
      s.anker = P;
      s.bpm = klem(bpm);
      if (eindig(s.maat)) s.maat = P + k * 60 / s.bpm;
    });
  }

  /** Tempo en/of tel in één keer, voor het stuk rond t (een tap, de verfijning). */
  zetStuk(t, { bpm, anker, zekerheid } = {}) {
    return this._pas(this._i(t), (s) => {
      // De tel bij t houdt zijn plek in de maat: een tap zet tempo en tel,
      // niet de "1" (die zet "tel 1 hier").
      const plek = eindig(t) ? t : s.anker;
      const k = Math.round((this._roosterTel(s, plek) - s.maat) * s.bpm / 60);
      if (eindig(bpm)) s.bpm = klem(bpm);
      if (eindig(anker)) s.anker = anker;
      if (eindig(zekerheid)) s.zekerheid = Math.max(0, Math.min(1, zekerheid));
      else delete s.zekerheid;
      if (eindig(s.maat)) s.maat = this._roosterTel(s, plek) - k * 60 / s.bpm;
    });
  }

  /**
   * ×2 en ½ voor het stuk rond `bij`. ×2: de tel het dichtst bij `bij` blijft
   * liggen. ½: de "1" blijft een tel, dus de tellen op 1 en 3 blijven (zoals
   * DJ-software halveert; Clay 26 sep, VRAGEN J26). Vroeger bleef de tel bij
   * `bij`: op tel 2 of 4 schoof de "1" dan een tel op, en ×2 daarna gaf hem
   * niet terug. Zonder maat-anker de oude regel.
   */
  verdubbel(bij = null) { return this._schaal(2, bij); }
  halveer(bij = null) { return this._schaal(0.5, bij); }
  _schaal(f, bij) {
    return this._pas(this._i(bij), (s) => {
      if (f < 1 && eindig(s.maat)) s.anker = this._roosterTel(s, s.maat);
      else if (bij !== null) s.anker = this._roosterTel(s, bij);
      s.bpm = klem(s.bpm * f);
      // De "1" blijft waar hij was: bij ×2 ligt hij nog op het rooster, bij ½ is hij het anker.
      if (eindig(s.maat)) s.maat = this._roosterTel(s, s.maat);
    });
  }

  /** Het stuk rond `bij` opschuiven, in seconden. */
  schuif(seconden, bij = null) { return this._pas(this._i(bij), (s) => { s.anker += seconden; s.maat += seconden; }); }

  /**
   * Het stuk rond `bij` een deel van ZIJN tel opschuiven: 0,5 = een halve tel.
   * Voor een grid dat op de offbeat staat (tel op de hi-hat in plaats van de
   * kick); voor- of achteruit is bij een halve tel hetzelfde rooster.
   */
  schuifTel(fractie, bij = null) {
    return this._pas(this._i(bij), (s) => { const d = fractie * 60 / s.bpm; s.anker += d; s.maat += d; });
  }

  /**
   * "Tel 1 hier": leg een tel precies hier (in het stuk rond t), en maak hem
   * de "1" van de maat. Gebruik je als je op de "1" drukt.
   */
  ankerHier(t) { return this._pas(this._i(t), (s) => { s.anker = t; s.maat = t; }); }

  /**
   * Schuif het stuk rond t zo dat zijn dichtstbijzijnde tel op t komt te liggen.
   * Handig als het tempo klopt maar het grid een fractie verschoven staat.
   */
  lijnUitOp(t) { return this._pas(this._i(t), (s) => { const d = t - this._roosterTel(s, t); s.anker += d; s.maat += d; }); }

  /**
   * Met de hand bevestigd: het stuk rond t telt als zeker. Een stuk zonder
   * zekerheid is met de hand gezet (soortZekerheid), dus de zekerheid van de
   * analyse gaat eraf. Na elke bewerking met de hand (actions, `bewerk`):
   * wie het grid hier gelijkzet, heeft het gecontroleerd. Vóór 5 okt bleef
   * het stuk onzeker en weigerden sync en beat-loops na het corrigeren nog
   * steeds ("tik eerst … of zet op slot").
   */
  bevestig(t) { return this._pas(this._i(t), (s) => { delete s.zekerheid; delete s.twijfel; delete s.octaaf; delete s.ok; }); }

  /**
   * GOEDGEKEURD (de controle, docs/BEATGRID.md §11): je hebt het stuk rond t
   * met de controleklik beluisterd en het klopt. Zeker, met `ok` erbij: ook
   * waar de gevonden tellen het niet met het grid eens zijn (rubato, een live
   * band) wint jouw oor. Een bewerking daarna (bevestig) haalt `ok` weer weg:
   * dan is het een ander grid dan je hoorde.
   */
  keurGoed(t) { return this._pas(this._i(t), (s) => { delete s.zekerheid; delete s.twijfel; delete s.octaaf; s.ok = true; }); }

  /**
   * De "1" van het stuk rond t `tellen` tellen opschuiven. De tellen zelf
   * blijven liggen: alleen welke tel de maat begint (de analyse vindt geen
   * downbeat, dus de eerste tel van een stuk is de "1").
   */
  maatSchuif(t, tellen = 1) {
    return this._pas(this._i(t), (s) => {
      const L = 60 / s.bpm;
      const een = eindig(s.maat) ? this._roosterTel(s, s.maat) : s.anker;
      s.maat = een + Math.round(tellen) * L;
    });
  }

  /**
   * VASTZETTEN (een "pin", 5 okt): de tel hoort HIER. Het tempo van het stuk
   * rond t wordt zo gezet dat er tussen zijn anker (waar je "1" zette, of de
   * vorige pin) en t precies een geheel aantal tellen ligt, en vanaf t begint
   * een nieuw stuk met t als anker: een volgende pin rekent vanaf hier. Zo
   * haal je drift weg met twee drukken (tel 1 aan het begin, vast een paar
   * minuten later), en zet je een live opgenomen mix stuk voor stuk vast.
   *
   * Weigert (ok: false, met een reden) als het grid hier meer dan 0,4 tel
   * naast t ligt (dan is niet te zeggen welke tel het is) of als het tempo
   * meer dan `maxAfwijking` zou veranderen. Dichter dan `minTellen` bij het
   * anker: alleen de fase (lijnUitOp), een tempo valt daar niet uit te halen.
   * @returns {{ ok: boolean, reden?: string, bpm?: number, was?: number, tellen?: number, naast?: number, alleenFase?: boolean }}
   */
  pin(t, { minTellen = 4, maxAfwijking = 0.04 } = {}) {
    if (!eindig(t)) return { ok: false, reden: 'geen plek' };
    const i = this._i(t), s = this._stukken[i];
    const L = 60 / s.bpm;
    const naast = (t - this._roosterTel(s, t)) / L;          // in tellen: hoe ver het grid hier ernaast ligt
    if (Math.abs(naast) > 0.4) {
      return { ok: false, naast, reden: `het grid ligt hier ${Math.round(Math.abs(naast) * 100)}% van een tel naast: dan is niet te zeggen welke tel dit is. Zet eerst een pin dichterbij, of schuif met ‹ ›` };
    }
    const tellen = Math.round((t - s.anker) / L);
    if (Math.abs(tellen) < minTellen) {
      this.lijnUitOp(t);
      this.bevestig(t);
      return { ok: true, alleenFase: true, tellen, naast, bpm: s.bpm, was: s.bpm };
    }
    const bpm = (60 * tellen) / (t - s.anker);
    if (!(bpm > 0) || Math.abs(bpm / s.bpm - 1) > maxAfwijking) {
      return { ok: false, naast, reden: `dat zou het tempo ${Math.round(Math.abs(bpm / s.bpm - 1) * 1000) / 10}% veranderen: klopt het anker van dit stuk (zet eerst "1" op een tel)?` };
    }
    const was = s.bpm;
    this._pas(i, (st) => {
      // De "1" blijft dezelfde tel (geteld vanaf het anker), op het nieuwe tempo.
      const k = eindig(st.maat) ? Math.round((st.maat - st.anker) / L) : 0;
      st.bpm = klem(bpm);
      if (eindig(st.maat)) st.maat = st.anker + k * (60 / st.bpm);
      delete st.zekerheid;
    });
    // Vanaf t een nieuw stuk met t als anker (zelfde tempo, dus hoorbaar niets anders).
    if (t > this._stukken[i].van + EPS && this.splits(t)) {
      this._pas(this.stukIndex(t), (st) => { const d = t - this._roosterTel(st, t); st.anker = t; if (eindig(st.maat)) st.maat += d; delete st.zekerheid; });
    }
    return { ok: true, bpm: klem(bpm), was, tellen, naast };
  }

  /**
   * Nieuw stuk vanaf t: zelfde tempo en fase als het stuk waar je in zat, dus
   * er verandert hoorbaar niets — pas je daarna iets aan, dan alleen vanaf hier.
   * False als er op t al een stuk begint.
   */
  splits(t) {
    if (!eindig(t) || this._stukken.some((s) => Math.abs(s.van - t) < EPS)) return false;
    const s = this._stukken[this.stukIndex(t)];
    // Dezelfde maten: de eerste "1" op of na t, op het rooster van DIT stuk.
    // Niet via timeOf: in de laatste maat vóór een volgend stuk valt die "1"
    // in dat stuk, op een ander tempo, en dan kreeg de rest van de maat een
    // "1" op de verkeerde tel (controleur, 25 sep).
    let maat;
    if (eindig(s.maat)) {
      const L = 60 / s.bpm, per = this.beatsPerBar;
      const een = s.anker + Math.round((s.maat - s.anker) / L) * L;
      const k = Math.ceil((t - een) / L - EPS);
      maat = een + (k + mod(-k, per)) * L;
    } else {
      // Een stuk zonder eigen tellen (weggevallen): zoals het nu klinkt.
      let b = Math.ceil(this.beatAt(t) - EPS);
      for (let n = 0; n < 8 * this.beatsPerBar && !this.isMaatbegin(b); n++) b++;
      maat = this.timeOf(b);
    }
    this._stukken.push({ van: t, bpm: s.bpm, anker: s.anker, maat });
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
    if (this.bron) uit.bron = this.bron;
    if (this.methode) uit.methode = this.methode;
    if (this.versie) uit.versie = this.versie;
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
 * Snappen naar een klap: de onset-piek die het dichtst bij t ligt, als die
 * binnen `venster` seconden valt; anders t zelf. `onsets` is een gesorteerde
 * lijst tracktijden (Float64Array of array) of null — dan wordt er niet
 * gesnapt. Voor "tel 1 hier": je drukt altijd een fractie naast de klap,
 * de analyse weet waar hij echt zit.
 */
export const SNAP_VENSTER = 0.03;
export function snapNaarOnset(onsets, t, venster = SNAP_VENSTER) {
  if (!onsets || !onsets.length || !eindig(t)) return t;
  let lo = 0, hi = onsets.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] < t) lo = m + 1; else hi = m; }
  // lo = eerste onset >= t (of de laatste); zijn buur ervoor kan dichterbij liggen.
  let beste = onsets[lo];
  if (lo > 0 && Math.abs(onsets[lo - 1] - t) < Math.abs(beste - t)) beste = onsets[lo - 1];
  return Math.abs(beste - t) <= venster + EPS ? beste : t;
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
