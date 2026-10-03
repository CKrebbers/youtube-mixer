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
 */
import { renderBlok, STIL, KANALEN, UITGANGEN } from './stream-kern.js';

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
      vorig: null, wisselT: -Infinity, staat: this.staat, stride: KANALEN, paar: 0,
    };
    this.port.onmessage = ({ data: m }) => {
      if (m.type === 'segment') {
        // Het nieuwe segment niet hard erin zetten maar overvloeien vanaf
        // het huidige blok. Een segment dat niet speelt en niet speelde
        // hoeft geen overgang.
        const nu = currentFrame / sampleRate;
        // Een gepland segment dat nog niet begonnen is, klinkt niet: daar
        // valt niets uit te vloeien (zijn formule gaf vóór T de muziek vóór
        // het cuepunt, en die mag je nooit horen).
        const klinkt = this.seg.speelt && nu >= this.startT;
        if (klinkt || m.seg.speelt) {
          this.vorig = klinkt ? this.seg : STIL;
          // Gepland: de overgang begint op T. Tot dan geeft renderBlok het
          // oude segment (of stilte) en telt het nieuwe voor nul mee.
          this.wisselT = m.gepland ? Math.max(nu, m.seg.T) : nu;
        }
        this.startT = m.gepland ? m.seg.T : -Infinity;
        this.seg = m.seg;
        this.segId = m.id;
        this.eindeGemeld = false;
      }
      else if (m.type === 'pagina') this.paginas.set(m.i, m.data);
      else if (m.type === 'weg') this.paginas.delete(m.i);
      else if (m.type === 'bron') {
        this.paginas.clear();
        this.seg = STIL;
        this.startT = -Infinity;
        this.duur = m.duur;
        this.trackRate = m.sr;
        this.kanalen = m.kanalen || KANALEN;
        this.paren = Math.max(1, Math.min(UITGANGEN, this.kanalen >> 1));
        // Alle paren lopen in de pas: dezelfde envelop als paar 0, ook een
        // paar dat bij het vorige nummer niet meedeed.
        for (let k = 1; k < UITGANGEN; k++) this.staten[k].env = this.staten[0].env;
      }
    };
  }

  process(_, outputs) {
    const uit = outputs[0];
    if (uit.length < 2) return true;
    const b = this.blok;
    b.seg = this.seg; b.frames = uit[0].length;
    b.t0 = currentFrame / sampleRate; b.trackRate = this.trackRate; b.duur = this.duur;
    b.vorig = this.vorig; b.wisselT = this.wisselT; b.stride = this.kanalen;
    // Paar 0 eerst: zijn antwoord ('einde') geldt voor alle paren.
    b.uit = uit; b.paar = 0; b.staat = this.staten[0];
    const r = renderBlok(b);
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
    if (this.vorig && currentFrame / sampleRate > this.wisselT + 0.01) this.vorig = null;
    if (r === 'einde' && !this.eindeGemeld) {
      this.eindeGemeld = true;
      // Met het segment-id: een late melding van vóór een seek mag het deck
      // niet naar het einde laten springen.
      this.port.postMessage({ type: 'einde', id: this.segId });
    }
    return true;
  }
}

registerProcessor('stream-lezer', StreamLezer);
