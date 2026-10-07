import { clamp } from '../lib/emitter.js';
import { startOpDeTel, startOpDeEen, startDrempel } from './fx.js';
import { sectieEen } from './secties.js';

/**
 * De sampler: acht pads die een stukje van een track vasthouden en het als
 * loop terugspelen, op de tel en op het tempo van wat je hoort.
 *
 * Knippen gebeurt in TRACKTIJD, netjes op het beatgrid: "de laatste maat"
 * eindigt op de laatste tel vóór de positie. Afspelen start op de volgende
 * tel van de track die het hardst klinkt (dezelfde klok als sync en de
 * video-puls), en op diens tempo: een sample van 124 bpm in een set van
 * 120 bpm loopt 120/124 zo snel.
 *
 * Een hele SECTIE (6 okt, docs/SECTIES.md): van haar "1" tot de "1" van de
 * volgende, in hele maten (knipSectie). Zo'n pad start op de "1" van de
 * maatgever, en houdt bij herankeren ook de maat vast, niet alleen de tel.
 *
 * Alles op de audioklok (regel 3): de start wordt ingepland op ctx-tijd,
 * niet met een timer.
 */

export const TELLEN = [1, 2, 4, 8];
export const AANTAL = 8;
const NAAD = 0.005;          // zo lang wordt het einde in het begin overgevloeid
const FADE_UIT = 0.02;

/**
 * De grens voor een sectie in een pad. Een pad houdt de audio vast: stereo
 * float op 48 kHz is ~23 MB per minuut, en bij het knippen van een nummer met
 * stems komt daar even het hele stuk stems.wav bij (vijf paren, ~20 bytes per
 * frame). 32 maten is de langste sectie die de analyse maakt (langer splitst
 * hij op een frasegrens, server/secties.js), dus elke automatische sectie
 * past, tot 86 bpm ook in seconden. 90 s houdt één pad onder ~35 MB en acht
 * volle pads onder ~280 MB. Langer (een mix, een traag nummer): een melding,
 * en als loop op de track zelf kan het wel (secties-modus, shift + pad).
 */
export const SECTIE_MAX_MATEN = 32;
export const SECTIE_MAX_SEC = 90;

/**
 * Is een pad van zoveel tellen een sectie (start op de "1", houdt de maat
 * vast)? Een gewone pad komt nooit verder dan de lengteknop (TELLEN), een
 * sectie is minstens 4 maten. Zo weet ook een pad die terugkomt uit de
 * library of het log wat hij is, zonder extra veld: daar staan alleen van,
 * tot, tellen en bpm. Een sectie van 2 maten of korter start op de tel.
 */
export const opDeMaat = (tellen) => Number.isFinite(tellen) && tellen > TELLEN[TELLEN.length - 1];

/**
 * Welk stuk tracktijd hoort bij sectie i, als pad? Puur.
 *
 *   van     de "1" van de sectie (sectieEen, dezelfde als waar de sprong
 *           landt): bij de eerste sectie de eerste "1", niet 0 (de opmaat
 *           hoort bij geen pad)
 *   tot     de "1" van de volgende sectie, of het einde van het nummer, maar
 *           altijd in HELE maten vanaf `van`: een loop van 5,75 maat loopt
 *           uit de maat. Van "1" naar "1" van het NUMMER: komt er een maat
 *           die geen `beatsPerBar` tellen lang is (een stuk met een eigen
 *           "1", een maat van 6 tellen), dan stopt de pad op de "1" ervóór;
 *           daarna zouden de maten van het nummer en die van de pad uit elkaar
 *           lopen (review 6 okt, punt 3).
 *   tellen  hele maten × tellen per maat
 *   bpm     zoals knipBereik: van het stuk van de sectie, of gemiddeld als
 *           er een tempowissel in ligt. Van `van`, niet van `tot`: daar
 *           begint vaak een nieuw stuk van de tempokaart.
 *   afgekapt  hele tellen van de sectie die daardoor wegvallen (anders 0)
 *
 * @param grid   Beatgrid
 * @param kaart  SectieKaart
 * @param i      sectie (vanaf 0)
 * @param duur   lengte van het nummer (s)
 * @returns {{ van: number, tot: number, tellen: number, bpm: number, afgekapt: number } | null}
 *          null zonder grid, kaart of sectie, of zonder één hele maat
 */
export function knipSectie(grid, kaart, i, duur) {
  if (!grid || !kaart || !Number.isInteger(i) || i < 0 || i >= kaart.aantal) return null;
  const per = grid.beatsPerBar;
  const bVan = Math.round(grid.beatAt(sectieEen(grid, kaart.begin(i))));
  const bNummer = grid.beatAt(duur);
  const bEind = i + 1 < kaart.aantal ? Math.min(bNummer, grid.beatAt(sectieEen(grid, kaart.begin(i + 1)))) : bNummer;
  // Maat voor maat, langs de "1"-en van het nummer (met het maat-anker per stuk).
  let b = bVan, scheef = false;
  for (let n = 0; n < 100000; n++) {
    const volgende = grid.volgendeVeelvoud(b + 1);
    if (volgende > bEind + 1e-6) break;
    if (volgende - b !== per) { scheef = true; break; }
    b = volgende;
  }
  const tellen = b - bVan;
  if (!(tellen >= per)) return null;
  const van = grid.timeOf(bVan), tot = grid.timeOf(b);
  const wissel = grid.volgendeWissel(van);
  const eenStuk = wissel === null || wissel >= tot - 1e-9;
  const bpm = eenStuk ? grid.bpmAt(van) : (60 * tellen) / (tot - van);
  return { van, tot, tellen, bpm, afgekapt: scheef ? Math.max(0, Math.floor(bEind - b + 1e-6)) : 0 };
}

/**
 * Welk stuk tracktijd hoort bij "de laatste N tellen"?
 * Zonder grid: gewoon de laatste N halve seconden, en geen tempo.
 * @returns { van, tot, bpm|null }
 */
export function knipBereik(grid, positie, tellen) {
  if (!grid) return { van: Math.max(0, positie - tellen * 0.5), tot: positie, bpm: null, tellen };
  // In TELLEN rekenen: met een tempokaart is een tel niet overal even lang,
  // dus van en tot komen allebei van timeOf.
  const laatste = Math.floor(grid.beatAt(positie) + 1e-9);
  const laatsteTel = grid.timeOf(laatste);
  const tot = laatsteTel > 0 ? laatsteTel : positie;
  // Vlak na het begin passen er geen N tellen in. Dan minder HELE tellen
  // nemen, niet een afgekapt stuk dat als N tellen gaat loopen en uit de
  // maat loopt.
  const eersteNaNul = Math.ceil(grid.beatAt(0) - 1e-9);
  const passen = Math.max(0, laatste - eersteNaNul);
  const n = laatsteTel > 0 ? Math.min(tellen, passen) : 0;
  const van = n > 0 ? grid.timeOf(laatste - n) : tot;
  // Het tempo van de sample zelf: dat van het stuk, of — ligt er een
  // tempowissel in — gemiddeld over wat er geknipt is.
  const wissel = grid.volgendeWissel(van);
  const eenStuk = n === 0 || wissel === null || wissel >= tot - 1e-9;
  const bpm = eenStuk ? grid.bpmAt(tot) : (60 * n) / (tot - van);
  return { van, tot, bpm, tellen: n };
}

/**
 * Een loop zonder tik: het laatste stukje wordt equal-power overgevloeid
 * naar wat er vlak VÓÓR het begin stond, zodat het einde naadloos in het
 * begin overloopt. Hetzelfde idee als de loop-naad in de streamkern.
 *
 * @param kanalen  Float32Arrays met `voor` frames extra aan het begin
 * @param voor     hoeveel frames vóór het eigenlijke begin er zijn
 * @returns nieuwe Float32Arrays zonder die voorloop
 */
export function naadloos(kanalen, voor) {
  return kanalen.map((x) => {
    const uit = x.slice(voor);
    const n = uit.length;
    const f = Math.min(voor, Math.floor(n / 4));
    for (let i = 0; i < f; i++) {
      const w = (i + 1) / f;                     // 0 -> 1 naar het einde toe
      const a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2);
      const j = n - f + i;
      uit[j] = uit[j] * a + x[voor - f + i] * b;
    }
    return uit;
  });
}

export class Sampler {
  /**
   * @param klok  () => { beatLengte, ankerCtx } van de track die de maat geeft, of null
   */
  constructor(ctx, uitgang, { klok = () => null } = {}) {
    this.ctx = ctx;
    this.klok = klok;
    this.uit = ctx.createGain();
    this.uit.connect(uitgang);
    this.volume = 0.8;
    this.uit.gain.value = this.volume;
    this.tellen = 4;
    this.pads = Array.from({ length: AANTAL }, () => null);
    this.bezig = new Set();
    /*
     * Wat een lege pad terug kan halen: { deckId, van, tot, bpm, tellen, bron }.
     * Pure data; wie ze vult (de app, uit de library) weet de sampler niet.
     * Een pad die gevuld wordt meldt dat via onGevuld, een herinnering die
     * vergeten wordt via onVergeet.
     */
    this.herinneringen = Array.from({ length: AANTAL }, () => null);
    this.onGevuld = null;
    this.onVergeet = null;
  }

  setVolume(v) {
    this.volume = clamp(v);
    this.uit.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  volgendeLengte() { this.tellen = TELLEN[(TELLEN.indexOf(this.tellen) + 1) % TELLEN.length]; }

  /** De laatste `tellen` van een deck in pad n. */
  async neem(n, deck, { bron = null } = {}) {
    if (!deck?.buffer) throw new Error('er staat niets op deze track');
    const bereik = knipBereik(deck.grid, deck.position, this.tellen);
    if (!(await this._vul(n, deck, { ...bereik, bron }))) return;
    this.onGevuld?.(n, { deckId: deck.id, van: bereik.van, tot: bereik.tot, bpm: bereik.bpm, tellen: bereik.tellen, bron });
  }

  /**
   * Sectie i van een deck, heel, in pad n (sampler.N.section). Weigert met
   * de reden van waaromGeenSectie; bewaard wordt hij zoals een gewone pad
   * (onGevuld: van, tot, tellen, bpm), en terughalen knipt hem opnieuw.
   */
  async neemSectie(n, deck, i, { bron = null, naam } = {}) {
    const { waarom, bereik, letOp } = this._sectie(n, deck, i, naam);
    if (waarom) throw new Error(waarom);
    await this._vul(n, deck, { ...bereik, bron });
    this.onGevuld?.(n, { deckId: deck.id, van: bereik.van, tot: bereik.tot, bpm: bereik.bpm, tellen: bereik.tellen, bron });
    // `letOp`: gelukt, maar korter dan de sectie (een eigen "1" in het grid); de action zegt het.
    return { ...bereik, letOp };
  }

  /**
   * Waarom sectie i van `deck` nu niet in pad n kan, in gewone taal, of null
   * als het kan (WAAROM NIET: een knop die stil weigert is een kapotte knop).
   * `naam` = hoe de track in de zin heet ("track 3").
   */
  waaromGeenSectie(n, deck, i, naam) { return this._sectie(n, deck, i, naam).waarom; }

  /**
   * { waarom } als het niet kan, anders { bereik, letOp }. Ook voor het lampje
   * (de read van sampler.N.section, elke tik): daarom zonder lijsten die
   * telkens opnieuw gemaakt worden.
   */
  _sectie(n, deck, i, naam = 'deze track') {
    const nee = (waarom) => ({ waarom, bereik: null, letOp: null });
    if (this.pads[n]) return nee('deze pad is al gevuld: maak hem eerst leeg (leegmaken), of kies een lege pad');
    if (this.herinneringen[n]) return nee('deze pad bewaart nog een stuk (↺): haal het terug met de pad zelf, of vergeet het met leegmaken');
    if (this.bezig.has(n)) return nee('deze pad wordt nog geknipt: even geduld');
    if (!deck?.buffer) return nee(`er staat niets op ${naam}: laad eerst een nummer`);
    const kaart = deck.sectieKaart, grid = deck.grid;
    if (!kaart) return nee(`${naam} heeft (nog) geen secties: die worden bij het laden berekend (een paar seconden)`);
    if (!grid) return nee(`${naam} heeft nog geen beatgrid, en een sectie gaat in hele maten: tik mee met TAP (vier tikken), of zet tel 1 met "1"`);
    if (!kaart.opGrid) return nee(`de secties van ${naam} zijn zonder grid berekend, dus niet op de maat: laad het nummer opnieuw, dan rekent hij ze op het grid`);
    const b = knipSectie(grid, kaart, i, deck.duration);
    if (!b) {
      return nee(kaart.begin(i) == null ? `${naam} heeft geen sectie ${i + 1}`
        : `sectie ${i + 1} heeft geen hele maat om te knippen (korter dan een maat, of het grid geeft haar eerste maat een eigen "1")`);
    }
    // Onzeker ergens in de sectie: van stuk tot stuk van het grid (volgendeWissel).
    let t = b.van, onzeker = false;
    for (let k = 0; k < 10000 && t < b.tot - 1e-6; k++) {
      if (!grid.zekerBij(t)) { onzeker = true; break; }
      const w = grid.volgendeWissel(t);
      if (w === null) break;
      t = w;
    }
    if (onzeker) return nee(`het grid van ${naam} is in deze sectie onzeker, en een pad die naast de tel loopt hoor je meteen: zet het grid eerst goed (grid-modus, Lock)`);
    const maten = b.tellen / grid.beatsPerBar, sec = b.tot - b.van;
    if (maten > SECTIE_MAX_MATEN || sec > SECTIE_MAX_SEC) {
      return nee(`deze sectie is ${maten} maten (${Math.round(sec)} s): te lang voor een pad, hooguit ${SECTIE_MAX_MATEN} maten en ${SECTIE_MAX_SEC} s `
        + '(een pad houdt de audio vast, ~23 MB per minuut). Als loop op de track zelf kan het wel: secties-modus, shift + pad');
    }
    let letOp = null;
    if (b.afgekapt > 0) {
      const bTot = Math.round(grid.beatAt(b.tot));
      const scheef = grid.volgendeVeelvoud(bTot + 1) - bTot;
      letOp = `sectie ${i + 1} geknipt tot ${b.tot.toFixed(1).replace('.', ',')} s (${maten} maten): daarna heeft het grid een maat van ${scheef} tellen `
        + `(een eigen "1"), en een pad gaat in hele maten rond. ${b.afgekapt} tellen van de sectie vallen weg`;
    }
    return { waarom: null, bereik: b, letOp };
  }

  /** Een bewaarde pad opnieuw knippen, van het deck waar zijn nummer op staat. */
  async herstel(n, deck) {
    const h = this.herinneringen[n];
    if (!h) return false;
    if (!deck?.buffer) throw new Error('het nummer van deze pad staat niet meer op een track');
    return this._vul(n, deck, h);
  }

  /** Een herinnering vergeten (shift op een lege, bewaarde pad). */
  vergeet(n) {
    const h = this.herinneringen[n];
    if (!h) return false;
    this.herinneringen[n] = null;
    this.onVergeet?.(n, h);
    return true;
  }

  async _vul(n, deck, { van, tot, bpm, tellen, bron = null }) {
    // Niet stil weigeren (review 6 okt): wie drukt, hoort waarom er niets gebeurt.
    if (this.bezig.has(n)) throw new Error('deze pad wordt nog geknipt: even geduld');
    this.bezig.add(n);
    try {
      if (tot - van < 0.05) throw new Error('te kort: speel eerst een stukje');
      const voorSec = Math.min(NAAD, van);
      // Met stems: wat je NU hoort vóór de EQ (niveau en kill per stem), zodat
      // een pad die je knipt terwijl de zang weg is ook zonder zang klinkt.
      // Een herstelde pad knipt met de stand van het moment van herstellen.
      const ruw = await deck.bron.knip(van - voorSec, tot, deck.knipGewichten?.() ?? null);
      const voor = Math.round(voorSec * ruw.sampleRate);
      const kanalen = naadloos([ruw.getChannelData(0), ruw.getChannelData(1)], voor);
      const buf = this.ctx.createBuffer(2, kanalen[0].length, ruw.sampleRate);
      buf.getChannelData(0).set(kanalen[0]);
      buf.getChannelData(1).set(kanalen[1]);
      this.stop(n);
      this.pads[n] = { buffer: buf, bpm, bron, tellen, van, tot, deckId: deck.id, speelt: false, src: null, g: null };
      return true;
    } finally {
      this.bezig.delete(n);
    }
  }

  /** Starten op de volgende tel (een sectie: op de volgende "1"), of stoppen als hij al speelt. */
  wissel(n) {
    const pad = this.pads[n];
    if (!pad) return false;
    if (pad.speelt) { this.stop(n); return true; }
    const k = this.klok();
    // Op het tempo dat je hoort; zonder tempo van één van beide: gewoon zoals hij is.
    const rate = this._rate(pad, k);
    // Op de volgende tel; ligt die al binnen de uitgangsbuffer, de tel erna.
    // Een sectie begint op haar "1", dus op de volgende "1" van de maatgever.
    const start = opDeMaat(pad.tellen) ? startOpDeEen(this.ctx, k) : startOpDeTel(this.ctx, k);
    this._startBron(pad, start, 0, rate);
    pad.speelt = true;
    pad.start = start;
    return true;
  }

  /**
   * De afspeelsnelheid die de pad precies `tellen` tellen van de maat lang
   * maakt. Uit de BUFFERLENGTE, niet uit de bpm: de buffer is op hele
   * samples geknipt en dus een fractie te lang of te kort, en dat liep op tot
   * ~5 ms per 10 minuten. Zo is één rondgang exact tellen × tellengte.
   */
  _rate(pad, k) {
    if (!k?.beatLengte || !pad.bpm) return 1;
    if (pad.tellen > 0) return pad.buffer.duration / (pad.tellen * k.beatLengte);
    return (60 / k.beatLengte) / pad.bpm;
  }

  /** Een tel in het sample, in seconden: de buffer gedeeld door zijn tellen. */
  _tel(pad) { return pad.tellen > 0 ? pad.buffer.duration / pad.tellen : 60 / pad.bpm; }

  /**
   * Een bron voor deze pad, vanaf `offset` (seconden in het sample) op `wanneer`.
   * Het segment { T, P, R } is waar de positie van de pad uit volgt (regel 3):
   * geen teller, alleen de audioklok.
   */
  _startBron(pad, wanneer, offset, rate) {
    const src = this.ctx.createBufferSource();
    src.buffer = pad.buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, wanneer);
    g.gain.linearRampToValueAtTime(1, wanneer + 0.005);
    src.connect(g).connect(this.uit);
    src.start(wanneer, offset);
    Object.assign(pad, { src, g, seg: { T: wanneer, P: offset, R: rate } });
  }

  /** Waar in het sample is deze pad op audiokloktijd t? */
  _positie(pad, t) {
    const { T, P, R } = pad.seg;
    const duur = pad.buffer.duration;
    const p = t <= T ? P : P + (t - T) * R;
    return ((p % duur) + duur) % duur;
  }

  /**
   * Tempo of tel van de maat veranderd (pitch, sync, seek, andere maat-track):
   * spelende pads lopen mee. De oude bron speelt door tot de volgende tel van
   * de maat; daar begint een nieuwe op het nieuwe tempo, op de dichtstbijzijnde
   * tel van het sample, en de oude vloeit er in 5 ms in over. Klopt alles al,
   * dan gebeurt er niets — dit wordt bij elke deckwijziging aangeroepen.
   *
   * Een sectie (opDeMaat) houdt ook de MAAT vast: op de tel van het sample die
   * op dezelfde plek in de maat staat als de maatgever (springt die een tel,
   * dan schuift de pad mee). Wacht hij nog op zijn eerste "1", dan opnieuw
   * plannen op de "1" van nu, tot die start in de uitgangsbuffer zit.
   */
  heranker() {
    const k = this.klok();
    if (!k?.beatLengte) return;
    const A = startOpDeTel(this.ctx, k);
    const grens = this.ctx.currentTime + startDrempel(this.ctx);
    for (const pad of this.pads) {
      if (!pad?.speelt || !pad.bpm || !pad.seg) continue;
      const rate = this._rate(pad, k);
      const maat = opDeMaat(pad.tellen);
      if (maat && pad.seg.T === pad.start && pad.seg.T >= grens) {
        // Nog niet begonnen (het eerste segment, en dat ligt nog vóór ons).
        const T = startOpDeEen(this.ctx, k);
        if (Math.abs(T - pad.seg.T) < 1e-6 && Math.abs(rate - pad.seg.R) < 1e-6) continue;
        // De volgende "1" ligt nooit verder dan een maat na de drempel. Wijst de
        // klok verder, dan klopt hij even niet: tijdens een geplande keylock-
        // sprong rekent fxKlok de tel uit het OUDE segment en zet hem op de
        // audioklok met het NIEUWE (bij een sprong terug 70 s vooruit). Dan
        // blijft het plan staan (review 6 okt, punt 2).
        if (T - grens > (k.perMaat > 0 ? k.perMaat : 4) * k.beatLengte + 1e-3) continue;
        this._ruimOud(pad);
        try { pad.src.stop(); } catch (_) {}
        this._startBron(pad, T, 0, rate);
        pad.start = T;
        continue;
      }
      const tel = this._tel(pad);                            // een tel in het sample
      const daar = this._positie(pad, A);
      const doel = maat ? this._maatDoel(pad, k, A, daar, tel) : (Math.round(daar / tel) * tel) % pad.buffer.duration;
      const faseGoed = Math.abs(daar - doel) < 0.001 || Math.abs(daar - doel) > pad.buffer.duration - 0.001;
      if (Math.abs(rate - pad.seg.R) < 1e-6 && faseGoed) continue;
      this._ruimOud(pad);
      const oud = { src: pad.src, g: pad.g };
      try {
        oud.g.gain.cancelScheduledValues?.(A);
        oud.g.gain.setValueAtTime(1, A);
        oud.g.gain.linearRampToValueAtTime(0, A + 0.005);
        oud.src.stop(A + 0.006);
      } catch (_) {}
      pad.oud = oud;
      this._startBron(pad, A, doel, rate);
    }
  }

  /**
   * Waar een sectie-pad op A hoort te zijn: de tel van het sample die het
   * dichtst bij `daar` ligt en op dezelfde plek in de maat staat als de
   * maatgever op A (het sample begon op een "1"). Zonder maat in de klok, of
   * als de pad geen heel aantal maten van de maatgever is: alleen de tel.
   */
  _maatDoel(pad, k, A, daar, tel) {
    const per = k.perMaat, duur = pad.buffer.duration;
    if (!(per > 0) || !Number.isInteger(k.tellenTotEen) || pad.tellen % per !== 0) return (Math.round(daar / tel) * tel) % duur;
    const j = Math.round((A - k.ankerCtx) / k.beatLengte);           // tellen van het anker tot A
    const plek = (((j - k.tellenTotEen) % per) + per) % per;          // tel van de maat op A (0 = de "1")
    const s = plek + per * Math.round((daar / tel - plek) / per);
    return (((s * tel) % duur) + duur) % duur;
  }

  /** Een eerdere overgang die nog loopt: meteen weg, anders stapelen ze. */
  _ruimOud(pad) {
    if (!pad.oud) return;
    try { pad.oud.src.stop(); } catch (_) {}
    pad.oud = null;
  }

  stop(n) {
    const pad = this.pads[n];
    if (!pad?.speelt) return;
    const nu = this.ctx.currentTime;
    // Ook een oude bron die nog tot de volgende tel doorspeelt (heranker).
    for (const b of [pad, pad.oud].filter(Boolean)) {
      try {
        b.g.gain.cancelScheduledValues?.(nu);
        b.g.gain.setValueAtTime(b.g.gain.value, nu);
        b.g.gain.linearRampToValueAtTime(0, nu + FADE_UIT);
        b.src.stop(nu + FADE_UIT + 0.01);
      } catch (_) {}
    }
    Object.assign(pad, { speelt: false, src: null, g: null, oud: null, seg: null });
  }

  wis(n) { this.stop(n); this.pads[n] = null; }

  stand() {
    return this.pads.map((p, i) => ({
      pad: i + 1, gevuld: !!p, speelt: !!p?.speelt, bezig: this.bezig.has(i),
      bron: p?.bron ?? null, tellen: p?.tellen ?? null,
      // Leeg, maar terug te halen: van welke track en hoeveel tellen.
      bewaard: !p && !!this.herinneringen[i],
      bewaardBron: this.herinneringen[i]?.bron ?? null, bewaardTellen: this.herinneringen[i]?.tellen ?? null,
    }));
  }
}
