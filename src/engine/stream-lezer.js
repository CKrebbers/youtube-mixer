/**
 * De worklet van het streamende deck. Draait op de audiothread.
 *
 * Hij doet bewust bijna niets zelf: pagina's bewaren die de hoofdthread
 * stuurt, en per blok `renderBlok()` uit de kern aanroepen. Welke pagina's
 * er moeten zijn, wanneer, en wat er weg mag, beslist de hoofdthread. Op de
 * audiothread wil je geen beslissingen, alleen rekenwerk met een vaste duur.
 *
 * En geen afval: process() maakt per blok niets aan (zie "geen afval op de
 * audiothread" in stream-kern.js). De argumenten van renderBlok staan in één
 * object per deck dat elk blok wordt bijgewerkt. Wat wél iets aanmaakt gebeurt
 * per BERICHT, niet per blok: een binnenkomend bericht (dat maakt de browser)
 * en de melding 'einde' (hooguit één per segment).
 *
 * STEMS (docs/STEMS.md §3): de node heeft ALTIJD vier uitgangen van twee
 * kanalen. Uitgang k speelt kanaalpaar k van het bestand (stem k); een
 * stereobestand speelt alleen op uitgang 0. Elk paar is een eigen
 * renderBlok-aanroep met een eigen `staat` (de gat-envelop), op hetzelfde
 * segment en dezelfde pagina's: de stems lopen sample voor sample samen.
 * Uitgangen zonder paar worden elk blok op nul gezet (fill, geen afval):
 * daar mag nooit iets van een vorig nummer blijven hangen.
 *
 * TWEE PADEN (keylock en toon, docs/KEYLOCK.md, gebouwd 5 okt). Een segment
 * met `rek` ({ keylock, toon }, zie rek-kern.js wilRek) speelt door een
 * Signalsmith-stretcher (het REKPAD, B); de rest zoals altijd door renderBlok
 * (A). Segmenten zonder rek komen nooit bij B: voor wie geen keylock gebruikt
 * verandert er niets (de gouden hash in renderblok.test). De stretcher wordt
 * pas gemaakt als een segment erom vraagt (de WASM laadt een paar ms; tot dan
 * speelt A), en meldt dan hoe ver hij vooruit loopt ('rek'), zodat de
 * hoofdthread een sprong precies zo ver vooruit kan plannen.
 * Wisselen van pad gaat met dezelfde overgang als een segmentwissel
 * (SEGMENT_FADE, equal-power): A → B zodra B's uitvoer geldig is (A speelt
 * tot dan door, dus keylock aanzetten tijdens het spelen geeft geen gat),
 * B → A meteen (keylock uit, een rem). Op tempo ≈ 1 zijn A en B bijna gelijk,
 * maar de stretcher draait soms de polariteit om; zonder keuze gaf de
 * overgang dan een dip tot −15 dB. Daarom kiest het pad dat erbij komt zijn
 * teken (bTeken/aTeken) op het eerste stuk van de overgang, en houdt het tot
 * het stil is.
 *
 * Berichten erin:
 *   { type: 'segment', seg }        nieuwe afspeelstand
 *   { type: 'segment', seg, gepland: true }
 *                                   start op de maat: T ligt in de toekomst;
 *                                   tot T klinkt wat er klonk (of stilte),
 *                                   op T begint de overgang
 *   { type: 'bron', duur, sr, kanalen }
 *                                   nieuw bestand: alles leeg. kanalen 2, 4 of 8
 *                                   (ontbreekt: 2)
 *   { type: 'pagina', i, data }     Int16Array, overgedragen, niet gekopieerd;
 *                                   `kanalen` samples per frame, interleaved
 *   { type: 'weg', i }              pagina mag weg
 * Berichten eruit:
 *   { type: 'einde' }               trackeinde bereikt (één keer per segment),
 *                                   van paar 0: alle paren eindigen samen
 *   { type: 'rek', uitLat, sr }     de stretcher is er; zijn uitvoerlatentie (frames), voor rekPlanT
 *   { type: 'rekfout', fout }       de stretcher laadt niet (dan blijft A spelen)
 */
import { renderBlok, STIL, KANALEN, UITGANGEN, SEGMENT_FADE } from './stream-kern.js';
import { Rekker, wilRek } from './rek-kern.js';
import fabriek from './vendor/signalsmith-stretch.js';

class StreamLezer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.seg = STIL;
    this.segId = 0;
    this.paginas = new Map();
    this.duur = 0;
    this.trackRate = sampleRate;
    this.eindeGemeld = false;
    this.vorig = null;               // het segment waar we uit komen, voor de overgang
    this.wisselT = -Infinity;
    this.startT = -Infinity;         // een gepland segment klinkt pas vanaf hier
    this.kanalen = KANALEN;          // per frame in de pagina's: 2, 4 of 8
    this.paren = 1;                  // zoveel uitgangen krijgen geluid
    // Per paar een eigen gat-envelop. Eén keer gemaakt, voor alle vier.
    this.staten = [];
    for (let k = 0; k < UITGANGEN; k++) this.staten.push({ env: 1 });
    this.staat = this.staten[0];
    // De argumenten van renderBlok: elk blok (en elk paar) bijgewerkt, niet
    // elk blok een nieuw object. NaN voor wat een double wordt: dan is het
    // veld dat meteen, en een double-veld schrijft V8 ter plekke over.
    this.blok = {
      seg: STIL, paginas: this.paginas, uit: null, frames: 0,
      t0: NaN, ctxRate: sampleRate, trackRate: sampleRate, duur: NaN,
      vorig: null, wisselT: -Infinity, staat: this.staat, stride: KANALEN, paar: 0, hergebruik: false,
    };
    this.totaal = 0;                 // frames in het bestand
    // Het rekpad (zie TWEE PADEN). Pas gemaakt als een segment erom vraagt.
    this.rek = null;
    this.rekLaadt = false;
    this.inB = false;                // het rekpad klinkt (of vloeit uit)
    this.naarB = false;              // A klinkt nog; over naar B zodra B's uitvoer geldig is
    this.bVan = -Infinity;           // B vloeit in vanaf hier (en klinkt niet vóór rek.geldig)
    this.bTot = Infinity;            // B vloeit uit vanaf hier; daarna stil
    this.bTeken = 1;                 // polariteit van B en van A (zie TWEE PADEN)
    this.aTeken = 1;
    this.tekenB = false;             // in het volgende blok met B het teken van B kiezen (A → B)
    this.tekenA = false;             // idem voor A (B → A)
    this.rekBlok = { paginas: this.paginas, frames: 0, t0: NaN, trackRate: sampleRate, totaal: 0, stride: KANALEN };
    // De klok van dit blok voor de hulpfuncties van het rekpad: als veld, niet
    // als argument (een double over een functiegrens is afval, stream-kern.js).
    this.t0 = NaN;
    this.port.onmessage = ({ data: m }) => {
      if (m.type === 'segment') this._segment(m);
      else if (m.type === 'pagina') this.paginas.set(m.i, m.data);
      else if (m.type === 'weg') this.paginas.delete(m.i);
      else if (m.type === 'bron') this._bron(m);
    };
    // (Klein houden: deze functie krijgt ELK bericht, ook elke segmentwissel.
    // Toen het bijladen van stretchers hier in stond, kostte elk bericht 7
    // bytes meer afval: test/renderblok, 6 okt.)
  }

  /** Een nieuw bestand (de kop): alles terug, de stretchers verdeeld over zijn paren. */
  _bron(m) {
    this.paginas.clear();
    this.seg = STIL;
    this.startT = -Infinity;
    this.duur = m.duur;
    this.trackRate = m.sr;
    this.kanalen = m.kanalen || KANALEN;
    this.totaal = Math.round(m.duur * m.sr);
    this.paren = Math.max(1, Math.min(UITGANGEN, this.kanalen >> 1));
    // Alle paren lopen in de pas: dezelfde envelop als paar 0, ook een
    // paar dat bij het vorige nummer niet meedeed.
    for (let k = 1; k < UITGANGEN; k++) this.staten[k].env = this.staten[0].env;
    this.inB = false; this.naarB = false; this.bTot = Infinity; this.aTeken = 1;
    if (this.rek) {
      // Meer stems dan stretchers: de rest erbij laden (per stem een eigen toon).
      if (this.rek.modules.length < this.paren) this._meerRek();
      this.rek.configureer(this.kanalen); this.rek.stil();
    }
  }

  /**
   * Een nieuw segment. Het rekpad klinkt: daar blijven (een geplande sprong of
   * tempo/toon/loop, rek-kern.js zet), of eruit (B vloeit uit, A neemt over).
   * Anders: A zoals altijd, en vraagt het segment om het rekpad, dan erheen.
   */
  _segment(m) {
    const nu = currentFrame / sampleRate;
    const seg = m.seg, gepland = !!m.gepland;
    this.segId = m.id;
    this.eindeGemeld = false;
    const wil = wilRek(seg);
    if (wil && !this.rek) this._laadRek();
    if (this.inB && nu < this.bTot) {
      if (wil && this.rek && seg.speelt) { this.rek.zet(seg, gepland, nu, this.trackRate); return; }
      this._uitB(seg, gepland, nu);
      return;
    }
    if (wil && this.rek && seg.speelt) {
      const aKlinkt = this.seg.speelt && nu >= this.startT;
      if (aKlinkt) this._aSegment(seg, gepland, nu);         // A speelt het tot B geldig is
      this._startB(seg, gepland, nu, aKlinkt);
      return;
    }
    this.naarB = false;
    this._aSegment(seg, gepland, nu);
  }

  /** Een segment voor renderBlok (A), zoals het altijd ging. */
  _aSegment(seg, gepland, nu) {
    // Het nieuwe segment niet hard erin zetten maar overvloeien vanaf
    // het huidige blok. Een segment dat niet speelt en niet speelde
    // hoeft geen overgang.
    // Een gepland segment dat nog niet begonnen is, klinkt niet: daar
    // valt niets uit te vloeien (zijn formule gaf vóór T de muziek vóór
    // het cuepunt, en die mag je nooit horen).
    const klinkt = this.seg.speelt && nu >= this.startT;
    if (klinkt || seg.speelt) {
      this.vorig = klinkt ? this.seg : STIL;
      // Gepland: de overgang begint op T. Tot dan geeft renderBlok het
      // oude segment (of stilte) en telt het nieuwe voor nul mee.
      this.wisselT = gepland ? Math.max(nu, seg.T) : nu;
    }
    if (!klinkt) this.aTeken = 1;
    this.startT = gepland ? seg.T : -Infinity;
    this.seg = seg;
  }

  /**
   * Het rekpad begint (leeg). `warm`: A klinkt en speelt door; process() gaat
   * over zodra B geldig is. Anders klinkt er niets en is B meteen het pad
   * (gepland: vanaf T); A zwijgt.
   */
  _startB(seg, gepland, nu, warm) {
    const r = this.rek;
    if (this.rekHerverdeel) { r.configureer(this.kanalen); this.rekHerverdeel = false; }
    r.stil();
    r.zet(seg, gepland, nu, this.trackRate);
    this.bTot = Infinity;
    this.bTeken = 1;
    this.tekenB = false;
    if (warm) { this.naarB = true; this.inB = false; return; }
    this.naarB = false;
    this.inB = true;
    this.bVan = gepland ? Math.max(nu, seg.T) : nu;
    this.seg = STIL; this.vorig = null; this.startT = -Infinity;
  }

  /** Uit het rekpad: B vloeit uit (zijn eigen segment speelt tot dan door); speelt het nieuwe, dan vloeit A in. */
  _uitB(seg, gepland, nu) {
    this.bTot = gepland && seg.speelt ? Math.max(nu, seg.T) : nu;
    this.naarB = false;
    if (seg.speelt) {
      this.vorig = STIL; this.wisselT = this.bTot;
      this.startT = gepland ? seg.T : -Infinity;
      this.aTeken = 1; this.tekenA = true;
    } else {
      this.vorig = null; this.startT = -Infinity;
    }
    this.seg = seg;
  }

  /**
   * De stretchers maken (één keer; de WASM laadt async): één per stem-paar
   * (rek-kern.js, STEMS). Vraagt wat er nu speelt erom, dan meteen erheen.
   */
  _laadRek() {
    if (this.rek || this.rekLaadt) return;
    this.rekLaadt = true;
    const n = this.paren;
    const modules = [];
    for (let k = 0; k < n; k++) modules.push(fabriek());
    Promise.all(modules).then((Ms) => {
      const r = new Rekker(Ms, sampleRate);
      r.configureer(this.kanalen);
      this.rek = r;
      if (r.modules.length < this.paren) this._meerRek();      // intussen een bestand met meer stems
      this.port.postMessage({ type: 'rek', uitLat: r.uitLat, sr: sampleRate });
      const nu = currentFrame / sampleRate, s = this.seg;
      if (!this.inB && wilRek(s) && s.speelt) this._startB(s, nu < s.T, nu, nu >= this.startT);
    }).catch((err) => {
      this.rekLaadt = false;
      this.port.postMessage({ type: 'rekfout', fout: String(err?.message || err) });
    });
  }

  /**
   * Stretchers erbij tot er één per paar is (een bestand met meer stems dan
   * het vorige). Tot ze er zijn rekent er één met alle kanalen (zonder eigen
   * toon per stem). Komen ze terwijl het rekpad klinkt, dan wachten ze op
   * het volgende bestand of de volgende keer dat het rekpad begint; anders
   * meteen verdeeld.
   */
  _meerRek() {
    // rekMeer (er worden stretchers bijgeladen) en rekHerverdeel (ze zijn er,
    // maar het rekpad klonk: verdelen bij de volgende start) ontstaan pas hier,
    // niet in de constructor: twee velden meer op elke worklet maakte de test
    // op afval per bericht wisselvallig (test/renderblok, 6 okt). Zelden nodig.
    if (this.rekMeer || !this.rek) return;
    this.rekMeer = true;
    const r = this.rek, extra = [];
    for (let k = r.modules.length; k < this.paren; k++) extra.push(fabriek());
    Promise.all(extra).then((Ms) => {
      this.rekMeer = false;
      r.voegToe(Ms);
      if (!this.inB && !this.naarB) { r.configureer(this.kanalen); r.stil(); }
      else this.rekHerverdeel = true;
    }).catch((err) => {
      this.rekMeer = false;
      this.port.postMessage({ type: 'rekfout', fout: String(err?.message || err) });
    });
  }

  process(_, outputs) {
    const uit = outputs[0];
    if (uit.length < 2) return true;
    const t0 = currentFrame / sampleRate, frames = uit[0].length;
    this.t0 = t0;
    // Het rekpad eerst: wordt het in dit blok geldig, dan vloeit A vanaf daar uit.
    let bOk = false;
    const rk = this.rek;
    if (rk !== null && (this.inB || this.naarB)) {
      const rb = this.rekBlok;
      rb.frames = frames; rb.t0 = t0; rb.trackRate = this.trackRate; rb.totaal = this.totaal; rb.stride = this.kanalen;
      bOk = rk.blok(rb);
      if (this.naarB && bOk) this._misschienNaarB(frames);
    }
    const b = this.blok;
    b.seg = this.seg; b.frames = frames;
    b.t0 = t0; b.trackRate = this.trackRate; b.duur = this.duur;
    b.vorig = this.vorig; b.wisselT = this.wisselT; b.stride = this.kanalen;
    // Paar 0 eerst: zijn antwoord ('einde') geldt voor alle paren. De paren
    // erna lezen op precies dezelfde plekken (zelfde segment, zelfde klok):
    // `hergebruik` laat renderBlok dat rekenwerk overslaan. Er zit niets
    // tussen (geen ander deck), dus wat in klad staat is nog van dit blok.
    b.uit = uit; b.paar = 0; b.staat = this.staten[0]; b.hergebruik = false;
    const r = renderBlok(b);
    b.hergebruik = true;
    const n = outputs.length < UITGANGEN ? outputs.length : UITGANGEN;
    for (let k = 1; k < n; k++) {
      const o = outputs[k];
      if (o.length < 2) continue;
      if (k < this.paren) {
        b.uit = o; b.paar = 2 * k; b.staat = this.staten[k];
        renderBlok(b);
      } else {
        o[0].fill(0); o[1].fill(0);
      }
    }
    if (this.aTeken < 0) this._keerA(outputs, frames, 0);
    if (this.inB && bOk) {
      this._mengB(outputs, frames);
      // Het trackeinde in het rekpad (zonder loop): op de positie die je hoort.
      if (this.bTot === Infinity && !this.eindeGemeld) {
        const tE = t0 + frames / sampleRate;
        const s = rk.vorig !== null && tE < rk.seg.T ? rk.vorig : rk.seg;
        if (s.speelt && !s.loop && s.P + (tE - s.T) * s.R >= this.duur) {
          this.eindeGemeld = true;
          this.port.postMessage({ type: 'einde', id: this.segId });
        }
      }
    }
    if (this.inB && t0 > this.bTot + SEGMENT_FADE) { this.inB = false; this.bTot = Infinity; rk.stil(); }
    if (this.vorig && currentFrame / sampleRate > this.wisselT + 0.01) this.vorig = null;
    if (r === 'einde' && !this.eindeGemeld) {
      this.eindeGemeld = true;
      // Met het segment-id: een late melding van vóór een seek mag het deck
      // niet naar het einde laten springen.
      this.port.postMessage({ type: 'einde', id: this.segId });
    }
    return true;
  }

  /**
   * A → B zodra B's uitvoer geldig is (en een overgang van A zelf voorbij):
   * A vloeit uit vanaf daar, B in. Ligt dat moment na dit blok, dan het
   * volgende blok opnieuw.
   */
  _misschienNaarB(frames) {
    const rk = this.rek, t0 = this.t0;
    let van = rk.geldig > t0 ? rk.geldig : t0;
    if (this.vorig && this.wisselT + SEGMENT_FADE > van) van = this.wisselT + SEGMENT_FADE;
    if (!(van < t0 + frames / sampleRate)) return;
    this.naarB = false; this.inB = true;
    this.bVan = van; this.bTot = Infinity; this.tekenB = true;
    this.vorig = this.seg.speelt ? this.seg : null;
    this.seg = STIL; this.wisselT = van; this.startT = -Infinity;
  }

  /** De uitvoer van A omkeren (aTeken −1), vanaf frame i0, voor de paren die klinken. */
  _keerA(outputs, frames, i0) {
    const n = outputs.length < this.paren ? outputs.length : this.paren;
    for (let k = 0; k < n; k++) {
      const o = outputs[k];
      if (o.length < 2) continue;
      const L = o[0], R = o[1];
      for (let i = i0; i < frames; i++) { L[i] = -L[i]; R[i] = -R[i]; }
    }
  }

  /**
   * B bij de uitvoer (die A al schreef): stil vóór max(bVan, rek.geldig),
   * equal-power in vanaf daar en uit vanaf bTot. Eerst, bij een wissel, het
   * teken van het pad dat erbij komt (zie TWEE PADEN).
   */
  _mengB(outputs, frames) {
    const rk = this.rek, sr = sampleRate, t0 = this.t0;
    const van = rk.geldig > this.bVan ? rk.geldig : this.bVan, tot = this.bTot;
    if (this.tekenB || this.tekenA) {
      const L = outputs[0][0], R = outputs[0][1], bl = rk.uit[0], br = rk.uit[1];
      const vanaf = this.tekenB ? van : this.wisselT;
      let i0 = Math.ceil((vanaf - t0) * sr);
      if (i0 < 0) i0 = 0;
      if (i0 < frames) {
        let som = 0;
        for (let i = i0; i < frames; i++) som += L[i] * bl[i] + R[i] * br[i];
        if (this.tekenB) { this.bTeken = som < 0 ? -1 : 1; this.tekenB = false; }
        else {
          if (som * this.bTeken < 0) { this.aTeken = -1; this._keerA(outputs, frames, 0); }
          this.tekenA = false;
        }
      }
    }
    const n = outputs.length < this.paren ? outputs.length : this.paren;
    const teken = this.bTeken;
    for (let k = 0; k < n; k++) {
      const o = outputs[k];
      if (o.length < 2) continue;
      const L = o[0], R = o[1], bl = rk.uit[2 * k], br = rk.uit[2 * k + 1];
      for (let i = 0; i < frames; i++) {
        const t = t0 + i / sr;
        if (t < van || t >= tot + SEGMENT_FADE) continue;
        let g = teken;
        if (t < van + SEGMENT_FADE) g *= Math.sin(((t - van) / SEGMENT_FADE) * (Math.PI / 2));
        if (t >= tot) g *= Math.cos(((t - tot) / SEGMENT_FADE) * (Math.PI / 2));
        L[i] += g * bl[i]; R[i] += g * br[i];
      }
    }
  }
}

registerProcessor('stream-lezer', StreamLezer);
