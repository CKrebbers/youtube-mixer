/**
 * De worklet van het streamende deck. Draait op de audiothread.
 *
 * Hij doet bewust bijna niets zelf: pagina's bewaren die de hoofdthread
 * stuurt, en per blok `renderBlok()` uit de kern aanroepen. Welke pagina's
 * er moeten zijn, wanneer, en wat er weg mag, beslist de hoofdthread. Op de
 * audiothread wil je geen beslissingen, alleen rekenwerk met een vaste duur.
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
    this.paginas = new Map();
    this.duur = 0;
    this.trackRate = sampleRate;
    this.eindeGemeld = false;
    this.port.onmessage = ({ data: m }) => {
      if (m.type === 'segment') { this.seg = m.seg; this.eindeGemeld = false; }
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
    const r = renderBlok({
      seg: this.seg, paginas: this.paginas, uit, frames: uit[0].length,
      t0: currentFrame / sampleRate, ctxRate: sampleRate, trackRate: this.trackRate, duur: this.duur,
    });
    if (r === 'einde' && !this.eindeGemeld) {
      this.eindeGemeld = true;
      this.port.postMessage({ type: 'einde' });
    }
    return true;
  }
}

registerProcessor('stream-lezer', StreamLezer);
