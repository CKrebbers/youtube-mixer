/**
 * De noodknoppen van de beamer: zwart, bevriezen, master en flits. Puur: geen
 * DOM, geen WebGL, te testen in Node. De mixer past ze toe in de LAATSTE stap
 * (tonen), dus voor de zaal, het losse venster en de video-opname gelijk.
 *
 *   zwart     schakelaar met een zachte fade (ZWART_FADE), plus een drukvariant
 *             die DIRECT zwart is zolang je drukt
 *   bevriezen het eerste beeld na het indrukken blijft staan; de video's lopen
 *             door (de mixer blijft ze bijsturen en uploaden), zodat loslaten
 *             meteen het goede beeld geeft
 *   master    helderheid van het eindbeeld 0..1, standaard 1; 0 = zwart
 *   flits     wit dat in FLITS_DUUR uitdooft
 *
 * Volgorde in de toonstap: eerst de flits (naar wit), dan × master × (1 − zwart).
 * Zwart wint dus van alles, ook van een flits: "zwart moet altijd kunnen".
 *
 * DE KLOK. Niet de audioklok: die staat stil zolang de AudioContext nog niet
 * loopt (voor de eerste klik) of hapert, en een fade op een stilstaande klok
 * wordt nooit klaar — dan zou zwart nooit zwart worden. Ook niet een eigen
 * teller (regel 3). Wel performance.timeOrigin + performance.now(): de klok
 * van requestAnimationFrame, maar dan als ABSOLUTE tijd. Het losse venster
 * heeft een eigen performance.now() met een ander nulpunt; zo rekenen beide
 * vensters met dezelfde getallen (neemOver kopieert de overgangen letterlijk).
 * Een verborgen tabblad houdt deze klok gewoon bij (alleen timers worden daar
 * geknepen), dus een fade die het hoofdvenster begon loopt in het losse
 * venster netjes af.
 */

// Zwart als schakelaar: 250 ms. Kort genoeg voor een noodknop (een kwart
// tel op 120 bpm, ~15 beelden), lang genoeg om geen harde klap in de zaal te
// zijn. Uit gaat even snel terug. De drukvariant is direct: die is voor
// ritmisch knippen op de tel, en daar is een fade een vertraging.
export const ZWART_FADE = 0.25;   // s
// De flits: vol wit, kwadratisch uitdovend, na 300 ms precies weg.
export const FLITS_DUUR = 0.3;    // s

/** De klok van de noodknoppen in ms, gelijk in het hoofdvenster en het losse venster. */
export const wandklok = () => performance.timeOrigin + performance.now();

const klem = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Waar een lineaire overgang { van, naar, t0 (ms), duur (s) } op `nu` (ms) staat. */
export function standOp(o, nu) {
  if (!o) return 0;
  if (!(o.duur > 0)) return o.naar;
  const f = (nu - o.t0) / (o.duur * 1000);
  if (f >= 1) return o.naar;
  if (f <= 0) return o.van;
  return o.van + (o.naar - o.van) * f;
}

/** Hoe fel een flits die op `t0` (ms) begon nu nog is: 1 -> 0 in FLITS_DUUR, daarna precies 0. */
export function flitsOp(t0, nu) {
  if (t0 === null || t0 === undefined) return 0;
  const f = (nu - t0) / (FLITS_DUUR * 1000);
  if (f >= 1) return 0;
  if (f <= 0) return 1;
  return (1 - f) * (1 - f);
}

export class Eindbeeld {
  constructor() {
    this.zwartAan = false;     // de schakelaar (video.black)
    this.zwartVast = false;    // de drukvariant (video.black.hold)
    this.zwart = { van: 0, naar: 0, t0: 0, duur: 0 };   // hoe zwart, als overgang
    this.bevroren = false;
    this.bevrorenSinds = 0;    // wandklok (ms) van het indrukken: het eerste beeld daarna blijft staan
    this.master = 1;
    this.flitsT0 = null;       // wandklok (ms) van de laatste flits
  }

  _naarZwart(nu, duur) {
    const doel = this.zwartAan || this.zwartVast ? 1 : 0;
    if (doel === this.zwart.naar && standOp(this.zwart, nu) === doel) return;
    this.zwart = { van: standOp(this.zwart, nu), naar: doel, t0: nu, duur };
  }

  /** De schakelaar: met een fade van ZWART_FADE, vanaf waar hij nu staat. */
  zetZwart(aan, nu) { this.zwartAan = !!aan; this._naarZwart(nu, ZWART_FADE); }

  /** De drukvariant: direct. Loslaten gaat direct terug naar wat de schakelaar zegt. */
  zetZwartVast(aan, nu) { this.zwartVast = !!aan; this._naarZwart(nu, 0); }

  zetBevroren(aan, nu) {
    aan = !!aan;
    if (aan && !this.bevroren) this.bevrorenSinds = nu;
    this.bevroren = aan;
  }

  zetMaster(v) { this.master = klem(v); }

  flits(nu) { this.flitsT0 = nu; }

  /** Hoe zwart nu (0..1). */
  zwartNu(nu) { return standOp(this.zwart, nu); }

  flitsNu(nu) { return flitsOp(this.flitsT0, nu); }

  /**
   * Wat de toonstap nodig heeft: `helder` (vermenigvuldiger, 0 = zwart) en
   * `flits` (0..1 naar wit). Helemaal zwart is PRECIES 0, niet bijna.
   */
  uniforms(nu) {
    const z = this.zwartNu(nu);
    return { helder: z >= 1 ? 0 : this.master * (1 - z), flits: this.flitsNu(nu) };
  }

  /** Staat er iets anders dan het gewone beeld? (Voor de status.) */
  isNeutraal(nu) {
    return this.master === 1 && this.zwartNu(nu) === 0 && this.flitsNu(nu) === 0 && !this.bevroren;
  }

  /**
   * Het losse venster neemt de stand over van het hoofdvenster: letterlijk,
   * want beide rekenen met dezelfde wandklok. Een kopie, geen gedeeld object:
   * dan houdt het losse venster niets vast van een hoofdvenster dat herlaadt.
   */
  neemOver(ander) {
    if (!ander) return;
    this.zwartAan = ander.zwartAan;
    this.zwartVast = ander.zwartVast;
    const z = ander.zwart;
    if (this.zwart.van !== z.van || this.zwart.naar !== z.naar || this.zwart.t0 !== z.t0 || this.zwart.duur !== z.duur) {
      this.zwart = { van: z.van, naar: z.naar, t0: z.t0, duur: z.duur };
    }
    this.bevroren = ander.bevroren;
    this.bevrorenSinds = ander.bevrorenSinds;
    this.master = ander.master;
    this.flitsT0 = ander.flitsT0;
  }
}
