/**
 * Het toetsenbord als controller: KeyboardEvent -> dezelfde indeling-vorm als de
 * APC (apparaat 'toetsen', control = KeyboardEvent.code). Wat een toets doet
 * staat in indelingen/toetsen.json, niet hier.
 *
 * Regels uit v1 (bediening-030), hard bevochten:
 * - niets met Cmd/Ctrl/Alt: dat is van de browser (Cmd+F startte een hotcue);
 * - niets tijdens TYPEN in een veld (isTypen van de aanroeper), en niets wat een
 *   schermknop met focus al gebruikte (e.defaultPrevented: pijltjes op een knop);
 * - geen auto-repeat: een toets is één druk;
 * - loslaten gaat naar de actie van het indrukken (ook als shift intussen los is:
 *   dat regelt de indeling);
 * - blur of een verborgen tabblad = alles los (anders komt er nooit een keyup).
 *
 * Geen DOM-import: `koppel(venster, document)` krijgt de objecten mee.
 */
import { NOOIT } from './apparaten/toetsen.js';

/** Is dit een veld waarin getypt wordt? (Een element van de aanroeper; hier wordt niets in het DOM gezocht.) */
export const isTypenVeld = (el) => !!el?.matches?.('input[type=text], input[type=search], input[type=url], input[type=number], input:not([type]), textarea, select, [contenteditable]');

export class Toetsen {
  /**
   * @param indeling een Indeling op het apparaat 'toetsen'
   * @param isTypen  (target) -> boolean
   * @param leren    een Leren op dezelfde indeling (optioneel)
   */
  constructor({ indeling, isTypen = isTypenVeld, leren = null }) {
    this.indeling = indeling;
    this.isTypen = isTypen;
    this.leren = leren;
    this.ingedrukt = new Set();   // toetsen waarvan het indrukken iets deed
    this.geslikt = new Set();     // toetsen die gekoppeld werden: hun keyup gaat nergens heen
  }

  /** keydown. Geeft true als de toets iets deed (dan preventDefault). */
  neer(e) {
    // Een schermknop met focus gebruikte de toets al (pijltjes, Enter in src/ui/bediening.js): die wint.
    if (e.defaultPrevented) return false;
    if (this.isTypen(e.target)) return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const code = e.code;
    if (!code || NOOIT.includes(code) || !this.indeling.apparaat.controls.has(code)) return false;
    if (this.leren?.bezig) {
      e.preventDefault?.();
      if (!e.repeat && !this.geslikt.has(code)) {
        this.leren.voer({ control: code, soort: 'druk', waarde: 1, shift: !!e.shiftKey });
        this.geslikt.add(code);
      }
      return true;
    }
    // Auto-repeat doet niets (maar slikken we wel, als de toets iets deed).
    if (e.repeat) {
      const bezet = this.ingedrukt.has(code) || this.geslikt.has(code);
      if (bezet) e.preventDefault?.();
      return bezet;
    }
    // Een echte nieuwe druk terwijl het loslaten nooit kwam (onder Cmd): eerst los.
    this.geslikt.delete(code);
    if (this.ingedrukt.delete(code)) this.indeling.verwerk({ control: code, soort: 'los', waarde: 0 });
    const r =this.indeling.verwerk({ control: code, soort: 'druk', waarde: 1, shift: !!e.shiftKey });
    if (!r) return false;
    this.ingedrukt.add(code);
    e.preventDefault?.();
    return true;
  }

  /** keyup: naar wat het indrukken deed. */
  op(e) {
    const code = e.code;
    if (this.geslikt.delete(code)) return false;
    if (!this.ingedrukt.delete(code)) return false;
    this.indeling.verwerk({ control: code, soort: 'los', waarde: 0 });
    return true;
  }

  /** Alles los: blur, verborgen tabblad. */
  blur() {
    this.geslikt.clear();
    this.ingedrukt.clear();
    this.indeling.laatAllesLos();
  }

  /** Aan een venster hangen. Geeft een functie die het weer losmaakt. */
  koppel(venster, document = null) {
    const neer = (e) => this.neer(e);
    const op = (e) => this.op(e);
    const blur = () => this.blur();
    const zicht = () => { if (document?.visibilityState === 'hidden') this.blur(); };
    venster.addEventListener('keydown', neer);
    venster.addEventListener('keyup', op);
    venster.addEventListener('blur', blur);
    document?.addEventListener?.('visibilitychange', zicht);
    return () => {
      venster.removeEventListener('keydown', neer);
      venster.removeEventListener('keyup', op);
      venster.removeEventListener('blur', blur);
      document?.removeEventListener?.('visibilitychange', zicht);
    };
  }
}
