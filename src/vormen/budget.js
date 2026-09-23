/**
 * Het tijdsbudget van een vormlaag, in MILLISECONDEN per beeld. Geen "max
 * drie lagen": de systemen verschillen tot dertig keer in wat ze kosten
 * (docs/plugins/02-analyses.md, risico-prestatie), dus tellen beschermt niets.
 *
 * Puur rekenwerk: iemand anders meet de duur (laag.js, met performance.now,
 * op de hoofdthread of in de Worker) en geeft hem hier door. Dit bestand
 * kent geen klok, dus in de tests is de tijd gewoon een getal.
 *
 * Regeling:
 *   - een EMA van de gemeten duur per beeld (alle stappen van dat beeld samen);
 *   - boven budget: g.kwaliteit een stapje omlaag (tot KWALITEIT_MIN);
 *   - ruim eronder (onder de helft): een stapje omhoog, maar trager dan omlaag,
 *     zodat het niet heen en weer pendelt. Een stapje van 0,125 kost hooguit
 *     ×1,5 (van 0,25 naar 0,375), en de helft × 1,5 blijft onder het budget;
 *   - na elke wijziging een paar beelden rust: de EMA moet de nieuwe stand
 *     eerst zien;
 *   - NOODREM: drie beelden achter elkaar meer dan VER × het budget, dan
 *     meteen naar KWALITEIT_MIN en dat melden. Niet stilzwijgend uit: een laag
 *     die verdwijnt midden in een set is erger dan een grovere laag.
 */

export const BUDGET_HOOFD = 4;       // ms per laag per beeld op de hoofdthread: daar draaien ook MIDI, LED's en de StreamBron
export const BUDGET_WERKER = 12;     // ms in de Worker: die blokkeert niets, maar een beeld duurt 16,7 ms
export const KWALITEIT_MIN = 0.25;
export const KWALITEIT_STAP = 0.125;
export const VER = 2;                // "ver over budget": meer dan twee keer
export const NOODREM_BEELDEN = 3;
const RUST_OMLAAG = 6;               // beelden wachten na een stap omlaag
const RUST_OMHOOG = 45;              // en na een stap omhoog of een noodrem
const OPWARMEN = 4;                  // eerst een paar metingen: de eerste is vaak de duurste (init, JIT)

const klem = (k) => Math.max(KWALITEIT_MIN, Math.min(1, k));

export class Budget {
  /**
   * @param ms         het budget per beeld
   * @param kwaliteit  beginstand (bijv. wat dit systeem de vorige keer haalde)
   * @param alfa       hoe snel de EMA volgt
   */
  constructor({ ms, kwaliteit = 1, alfa = 0.25 } = {}) {
    this.ms = ms;
    this.alfa = alfa;
    this.kwaliteit = klem(kwaliteit);
    this.ema = null;
    this.rust = 0;
    this.teVer = 0;
    this.teZwaar = false;            // op de laagste stand en nog steeds over budget
    this.n = 0;                      // metingen sinds het begin
  }

  /** Opnieuw beginnen (ander systeem): EMA leeg, kwaliteit naar keuze. */
  herstel(kwaliteit = 1) {
    this.kwaliteit = klem(kwaliteit);
    this.ema = null;
    this.rust = 0;
    this.teVer = 0;
    this.teZwaar = false;
    this.n = 0;
  }

  /** Met de hand zetten: de regeling gaat daarna vanaf daar verder. */
  zet(kwaliteit) {
    this.kwaliteit = klem(kwaliteit);
    this.rust = RUST_OMLAAG;
  }

  /**
   * Eén beeld gemeten. Geeft terug wat er gebeurde:
   *   { kwaliteit, veranderd, noodrem }
   * `noodrem` is alleen waar op het beeld waarop hij ingreep (één melding,
   * geen stroom): stond hij al op de laagste stand, dan meldt hij niets meer.
   */
  meet(duur) {
    const voor = this.kwaliteit;
    this.ema = this.ema === null ? duur : this.ema + this.alfa * (duur - this.ema);
    let noodrem = false;
    this.n++;

    if (duur > this.ms * VER) this.teVer++;
    else this.teVer = 0;

    if (this.teVer >= NOODREM_BEELDEN) {
      this.teVer = 0;
      noodrem = this.kwaliteit > KWALITEIT_MIN;
      this.teZwaar = !noodrem;
      this.kwaliteit = KWALITEIT_MIN;
      this.rust = RUST_OMHOOG;
    } else if (this.rust > 0) {
      this.rust--;
    } else if (this.n < OPWARMEN) {
      // nog niets besluiten op één of twee metingen
    } else if (this.ema > this.ms) {
      if (this.kwaliteit > KWALITEIT_MIN) {
        this.kwaliteit = klem(this.kwaliteit - KWALITEIT_STAP);
        this.rust = RUST_OMLAAG;
      } else this.teZwaar = true;
    } else if (this.ema < this.ms * 0.5) {
      this.teZwaar = false;
      if (this.kwaliteit < 1) {
        this.kwaliteit = klem(this.kwaliteit + KWALITEIT_STAP);
        this.rust = RUST_OMHOOG;
      }
    } else {
      this.teZwaar = false;
    }
    return { kwaliteit: this.kwaliteit, veranderd: this.kwaliteit !== voor, noodrem };
  }
}
