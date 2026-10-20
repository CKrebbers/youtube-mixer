/**
 * De AudioWorklet van de afspeler. Draait op de audiothread en doet bewust
 * bijna niets zelf: berichten doorgeven aan de kern en per blok renderBlok()
 * aanroepen. Beslissingen (wat, wanneer) neemt de hoofdthread.
 *
 * Klok: currentFrame, sample-exact. Sample i van dit blok ligt op
 * (currentFrame + i) / sampleRate; geen eigen teller.
 *
 * Afval: process() maakt per blok niets aan. Wat wel iets aanmaakt gebeurt per
 * BERICHT (dat object maakt de browser al) of bij een fout (één keer).
 *
 * Berichten erin:
 *   { type: 'laad', sr, frames, paginas, kanalen? }   paginas overgedragen (transfer); kanalen 2, 4 of 8 (stems)
 *   { type: 'plan', segmenten }             [{ T, P, R, speelt }]
 *   { type: 'leeg' }                        stil, bron weg (na het uitvloeien)
 *   { type: 'stop' }                        daarna geeft process() false: de
 *                                           browser mag de node opruimen. Een
 *                                           processor die true blijft geven
 *                                           houdt zichzelf in leven.
 * Berichten eruit:
 *   { type: 'fout', bericht }               één keer per fout; daarna stilte
 *                                           tot een nieuwe 'laad' of 'leeg'.
 */
import { maakKern, laadBron, planSegmenten, leegBron, renderBlok, zetPagina, wisPagina } from './speler-kern.js';

class VarveSpeler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kern = maakKern(sampleRate);
    this.gestopt = false;
    this.kapot = false;                   // na een fout: stilte, tot laad/leeg
    this.reserve = null;                  // alleen als de uitgang ooit geen twee kanalen heeft
    // De uitgangen 1..3 (stems: paar 1..3). Eén vaste array; per blok alleen de verwijzingen.
    this.extra = new Array(6).fill(null);
    this.port.onmessage = (e) => this._bericht(e.data);
  }

  _bericht(m) {
    try {
      if (!m || this.gestopt) return;
      if (m.type === 'plan') {
        if (this.kapot) return;
        planSegmenten(this.kern, m.segmenten);
        // Een segment dat hij niet kan spelen wordt overgeslagen (de rest speelt door), maar nooit stil.
        if (this.kern.ongeldig > 0) {
          this.port.postMessage({ type: 'fout', kapot: false, bericht: `${this.kern.ongeldig} ongeldig(e) segment(en) overgeslagen` });
          this.kern.ongeldig = 0;
        }
      }
      else if (m.type === 'laad') {
        this.kapot = false;
        laadBron(this.kern, m.sr, m.frames, m.paginas, m.id ?? 0, m.kanalen ?? 2);
      } else if (m.type === 'pagina') {
        if (!this.kapot) zetPagina(this.kern, m.id, m.i, m.data);
      } else if (m.type === 'weg') {
        if (!this.kapot) wisPagina(this.kern, m.id, m.i);
      } else if (m.type === 'leeg') {
        this.kapot = false;
        leegBron(this.kern);
      } else if (m.type === 'stop') this._stop();
    } catch (e) { this._fout(e); }
  }

  _stop() {
    this.gestopt = true;
    this.port.onmessage = null;
    this.kern = null;                     // pagina's los
  }

  /**
   * Een fout: één melding, en een verse kern (stil, zonder bron). Opnieuw
   * opbouwen in plaats van wissen: na een fout is de oude toestand niet te
   * vertrouwen. Pas een nieuwe 'laad' of 'leeg' laat hem weer spelen.
   */
  _fout(e) {
    this.kern = maakKern(sampleRate);
    if (this.kapot) return;
    this.kapot = true;
    this.port.postMessage({ type: 'fout', kapot: true, bericht: String((e && (e.stack || e.message)) || e) });
  }

  process(_in, outputs) {
    if (this.gestopt) return false;
    const uit = outputs[0];
    if (!uit || uit.length === 0) return true;
    const L = uit[0];
    let R = uit.length > 1 ? uit[1] : null;
    if (R === null) {
      if (this.reserve === null || this.reserve.length !== L.length) this.reserve = new Float32Array(L.length);
      R = this.reserve;
    }
    // Vier stereo-uitgangen (speler.js maakt hem zo): de stems van paar 1..3. Anders: alles op uitgang 0.
    let extra = outputs.length >= 4;
    for (let o = 1; o < 4 && extra; o++) extra = outputs[o].length >= 2;
    if (extra) for (let o = 1; o < 4; o++) { this.extra[2 * o - 2] = outputs[o][0]; this.extra[2 * o - 1] = outputs[o][1]; }
    if (this.kapot) {
      L.fill(0); R.fill(0);
      if (extra) for (let c = 0; c < 6; c++) this.extra[c].fill(0);
      return true;
    }
    try {
      this.kern.extra = extra ? this.extra : null;
      this.kern.klok[0] = currentFrame;
      renderBlok(this.kern, L, R, L.length);
    } catch (e) {
      L.fill(0); R.fill(0);
      if (extra) for (let c = 0; c < 6; c++) this.extra[c].fill(0);
      this._fout(e);
    }
    if (uit.length === 1) for (let i = 0; i < L.length; i++) L[i] = 0.5 * (L[i] + R[i]);
    for (let c = 2; c < uit.length; c++) uit[c].fill(0);
    return true;
  }
}

registerProcessor('varve-speler', VarveSpeler);
