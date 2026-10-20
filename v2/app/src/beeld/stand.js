/**
 * De stand van het beeld als één object (oogst beeld-025): wat de bus aan het beeld verandert staat
 * HIER, en elke mixer (het paneel in het hoofdvenster én het losse venster) leest dezelfde stand bij
 * elk beeld. Er is dus geen "overnemen" per veld zoals in v1 (neemOver): een nieuwe knop in de stand
 * zit vanzelf in beide vensters. Geen DOM, geen WebGL: te testen in Node.
 *
 *   stand.fx         { pixel, spiegel, rgb, kleur, sporen, korrel } 0..1 (instellingen.js)
 *   stand.modus      de mengvorm (MODI)
 *   stand.puls       hoe hard er op de tel van de klok gepulst wordt (0 = uit)
 *   stand.pulsDoel   wat er pulst (PULS_DOELEN)
 *   stand.fit        passend | vullen (de video's)
 *   stand.clips      de deck-video's aan (true) of alleen eigen beeld (false, het zaalbeeld)
 *   stand.bronnen    per track (index n − 1) de url van zijn video, of null
 *   eind             de noodknoppen (eindbeeld.js), op de wandklok
 *   vormen           VormLagen (de twee vormlagen) of null; lagen = de beeldlagen voor de mixer
 *   router           de routes "reageren op de mix" (analyse/router.js) of null
 *
 * 'verander' na elke wijziging (voor het scherm); knoppen volgen de stand ook via bus.lees.
 */
import { Emitter } from '../kern/emitter.js';
import { VIDEO_FX, MODI } from './instellingen.js';
import { PULS_DOELEN } from './puls.js';
import { FITS } from './passen.js';
import { Eindbeeld, wandklok } from './eindbeeld.js';

const klem = (v) => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0));
const volgende = (lijst, nu) => lijst[(lijst.indexOf(nu) + 1) % lijst.length];

export class Beeld extends Emitter {
  /**
   * @param tracks  hoeveel tracks (8)
   * @param vormen  VormLagen of null
   * @param router  Router of null
   * @param klok    wandklok in ms (de noodknoppen; tests geven een nep)
   */
  constructor({ tracks = 8, vormen = null, router = null, klok = wandklok } = {}) {
    super();
    this.klok = klok;
    this.stand = {
      fx: Object.fromEntries(VIDEO_FX.map((f) => [f.id, f.standaard])),
      modus: MODI[0],
      puls: 0,
      pulsDoel: PULS_DOELEN[0],
      fit: FITS[0],
      clips: true,
      bronnen: new Array(tracks).fill(null),
    };
    this.eind = new Eindbeeld();
    this.vormen = vormen;
    this.router = router;
    this.vasthouden = {};   // fx-id -> stand van vóór een .hold, of afwezig
  }

  /** De beeldlagen voor de mixer: { aan, dekking, mengvorm, frame(t) }. */
  get lagen() { return this.vormen?.lagen ?? []; }

  _veranderd() { this.emit('verander'); }

  zetFx(id, v) { if (id in this.stand.fx) { this.stand.fx[id] = klem(v); } }
  /** Vol aan zolang je drukt, daarna terug naar wat het was (v1 video.fx.*.hold). */
  houdFx(id, aan) {
    if (!(id in this.stand.fx)) return;
    if (aan && !(id in this.vasthouden)) { this.vasthouden[id] = this.stand.fx[id]; this.stand.fx[id] = 1; }
    else if (!aan && id in this.vasthouden) { this.stand.fx[id] = this.vasthouden[id]; delete this.vasthouden[id]; }
  }
  volgendeModus() { this.stand.modus = volgende(MODI, this.stand.modus); this._veranderd(); }
  zetPuls(v) { this.stand.puls = klem(v); }
  volgendPulsDoel() { this.stand.pulsDoel = volgende(PULS_DOELEN, this.stand.pulsDoel); this._veranderd(); }
  volgendeFit() { this.stand.fit = volgende(FITS, this.stand.fit); this._veranderd(); }
  zetClips(aan) { this.stand.clips = !!aan; this._veranderd(); }

  /** Welke video er op track n hoort (url), of null. */
  zetBron(n, url) {
    const i = n - 1;
    if (i < 0 || i >= this.stand.bronnen.length) return;
    if (this.stand.bronnen[i] === (url || null)) return;
    this.stand.bronnen[i] = url || null;
    this._veranderd();
  }
  bron(n) { return this.stand.bronnen[n - 1] ?? null; }

  // De noodknoppen, op de wandklok (eindbeeld.js: die loopt ook als de AudioContext stilstaat).
  zetZwart(aan) { this.eind.zetZwart(aan, this.klok()); this._veranderd(); }
  zetZwartVast(aan) { this.eind.zetZwartVast(aan, this.klok()); this._veranderd(); }
  zetBevroren(aan) { this.eind.zetBevroren(aan, this.klok()); this._veranderd(); }
  zetMaster(v) { this.eind.zetMaster(v); }
  flits() { this.eind.flits(this.klok()); }
  flitsNu() { return this.eind.flitsNu(this.klok()); }
}
