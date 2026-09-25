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
 * Berichten erin:
 *   { type: 'segment', seg }        nieuwe afspeelstand
 *   { type: 'bron', duur, sr }      nieuw bestand: alles leeg
 *   { type: 'pagina', i, data }     Int16Array, overgedragen, niet gekopieerd
 *   { type: 'weg', i }              pagina mag weg
 * Berichten eruit:
 *   { type: 'einde' }               trackeinde bereikt (één keer per segment)
 */
import { renderBlok, STIL } from './stream-kern.js';

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
    this.staat = { env: 1 };
    // De argumenten van renderBlok: elk blok bijgewerkt, niet elk blok een
    // nieuw object. NaN voor wat een double wordt: dan is het veld dat meteen,
    // en een double-veld schrijft V8 ter plekke over.
    this.blok = {
      seg: STIL, paginas: this.paginas, uit: null, frames: 0,
      t0: NaN, ctxRate: sampleRate, trackRate: sampleRate, duur: NaN,
      vorig: null, wisselT: -Infinity, staat: this.staat,
    };
    this.port.onmessage = ({ data: m }) => {
      if (m.type === 'segment') {
        // Het nieuwe segment niet hard erin zetten maar overvloeien vanaf
        // het huidige blok. Een segment dat niet speelt en niet speelde
        // hoeft geen overgang.
        if (this.seg.speelt || m.seg.speelt) { this.vorig = this.seg; this.wisselT = currentFrame / sampleRate; }
        this.seg = m.seg;
        this.segId = m.id;
        this.eindeGemeld = false;
      }
      else if (m.type === 'pagina') this.paginas.set(m.i, m.data);
      else if (m.type === 'weg') this.paginas.delete(m.i);
      else if (m.type === 'bron') {
        this.paginas.clear();
        this.seg = STIL;
        this.duur = m.duur;
        this.trackRate = m.sr;
      }
    };
  }

  process(_, outputs) {
    const uit = outputs[0];
    if (uit.length < 2) return true;
    const b = this.blok;
    b.seg = this.seg; b.uit = uit; b.frames = uit[0].length;
    b.t0 = currentFrame / sampleRate; b.trackRate = this.trackRate; b.duur = this.duur;
    b.vorig = this.vorig; b.wisselT = this.wisselT;
    const r = renderBlok(b);
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
