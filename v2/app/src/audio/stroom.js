/**
 * Streamen: welke pagina's van een nummer moeten in de audiothread staan, en het ophalen zelf
 * (budget M7: ≤ 50 MB per track, ook voor een album van 31 minuten; zonder streamen 357 MB).
 *
 * Zoals v1 (StreamBron, 23 sep): een pagina-cache op samplepositie, geen ringbuffer. Een deck
 * springt en gaat achteruit, dus "wat er nodig is" volgt uit het PLAN: de segmenten van de
 * speler vanaf nu tot VOORUIT seconden verder, plus vastgepinde plekken (het cuepunt) die
 * direct moeten klinken. Wat niet nodig is gaat weg, maar pas na LOS seconden (een sprong heen
 * en terug haalt niets opnieuw op). Een pagina die er nog niet is, is stilte in de kern
 * (speler-kern.js vloeit uit en in rond een gat), nooit een herhaling.
 *
 * Geen DOM en geen Web Audio: `paginasNodig` is puur, `Stroom` krijgt een lees-functie en een
 * stuur-functie mee. De pagina's zelf gaan naar de worklet (overgedragen); hier blijft alleen
 * de boekhouding over.
 */
import { PAGINA } from './speler-kern.js';

export const VOORUIT = 30;        // seconden audioklok vooruit (op tempo R dus R × 30 s nummer)
export const ACHTER = 1;          // pagina's achter de plek (een loop of een kleine sprong terug)
export const LOS = 2;             // seconden niet meer nodig voordat een pagina weggaat
export const TEGELIJK = 3;        // zoveel verzoeken tegelijk per track
export const MAX_PAGINAS = 48;    // hooguit (~66 s, ~25 MB stereo): wat erboven komt, wacht

/**
 * De pagina's die nodig zijn, in volgorde van wanneer (de eerste eerst).
 * @param lijn  segmenten { T, P, R, speelt } oplopend in T (de speler: het geldende plus de rest)
 * @param nu    audiokloktijd
 * @param pins  plekken in het nummer (seconden) die direct moeten kunnen klinken
 * @returns {number[]} pagina-indices, uniek, hooguit MAX_PAGINAS
 */
export function paginasNodig(lijn, nu, { sr, frames, pins = [], vooruit = VOORUIT } = {}) {
  const n = Math.ceil(frames / PAGINA);
  const uit = [], gezien = new Set();
  const erbij = (i) => {
    if (i < 0 || i >= n || gezien.has(i) || uit.length >= MAX_PAGINAS) return;
    gezien.add(i); uit.push(i);
  };
  const pagina = (P) => Math.floor((P * sr) / PAGINA);
  const tot = nu + vooruit;
  // Het segment dat nu geldt (het laatste met T ≤ nu), en alles daarna tot `tot`.
  let i0 = 0;
  for (let i = 0; i < lijn.length; i++) if (lijn[i].T <= nu) i0 = i;
  for (let i = i0; i < lijn.length; i++) {
    const s = lijn[i];
    const a = Math.max(s.T, nu);
    if (a > tot) break;
    const b = Math.min(i + 1 < lijn.length ? lijn[i + 1].T : Infinity, tot);
    const Pa = s.speelt ? s.P + (a - s.T) * s.R : s.P;
    if (!s.speelt) { erbij(pagina(Pa)); erbij(pagina(Pa) + 1); continue; }
    if (s.lb !== undefined && s.lb > s.la) {
      // Een lus: wat er nog vóór de lus komt, dan de lus zelf met de naad (en wat ervóór staat).
      const P0 = Pa >= s.lb ? s.la : Pa;
      for (let p = pagina(Math.max(0, Math.min(P0, s.la) - 0.01)); p <= pagina(s.lb); p++) erbij(p);
      continue;
    }
    const Pb = s.P + (b - s.T) * s.R;
    const p0 = pagina(Pa), p1 = pagina(Pb);
    erbij(p0);
    for (let p = p0 + 1; p <= p1; p++) erbij(p);
    for (let k = 1; k <= ACHTER; k++) erbij(p0 - k);
  }
  for (const P of pins) { erbij(pagina(P)); erbij(pagina(P) + 1); }
  return uit;
}

/**
 * Het ophalen voor één nummer op één speler. `lees(i, signaal)` -> Promise<Int16Array> (pagina i,
 * stereo, PAGINA frames of minder aan het eind); `stuur(bericht, transfer)` naar de worklet.
 */
export class Stroom {
  constructor({ id, sr, frames, kanalen = 2, lees, stuur, klok = () => performance.now() / 1000, onfout = null }) {
    Object.assign(this, { id, sr, frames, kanalen, lees, stuur, klok, onfout });
    this.binnen = new Set();         // in de worklet
    this.onderweg = new Map();       // i -> AbortController
    this.overbodig = new Map();      // i -> sinds (klok) niet meer nodig
    this.gesloten = false;
    this.fouten = 0;
  }

  /** Bijwerken naar wat nodig is (lijst uit paginasNodig, eerste eerst). */
  bij(nodig) {
    if (this.gesloten) return;
    const nu = this.klok();
    const wil = new Set(nodig);
    // Weg wat al LOS seconden overbodig is; afbreken wat niet meer nodig is.
    for (const i of this.binnen) {
      if (wil.has(i)) { this.overbodig.delete(i); continue; }
      const sinds = this.overbodig.get(i);
      if (sinds === undefined) this.overbodig.set(i, nu);
      else if (nu - sinds >= LOS) { this.binnen.delete(i); this.overbodig.delete(i); this.stuur({ type: 'weg', id: this.id, i }); }
    }
    for (const [i, a] of this.onderweg) if (!wil.has(i)) { a.abort(); this.onderweg.delete(i); }
    // Ophalen in volgorde, hooguit TEGELIJK.
    for (const i of nodig) {
      if (this.onderweg.size >= TEGELIJK) break;
      if (this.binnen.has(i) || this.onderweg.has(i)) continue;
      this._haal(i);
    }
  }

  _haal(i) {
    const a = new AbortController();
    this.onderweg.set(i, a);
    Promise.resolve().then(() => this.lees(i, a.signal)).then((data) => {
      if (this.onderweg.get(i) !== a) return;            // afgebroken of vervangen
      this.onderweg.delete(i);
      if (this.gesloten) return;
      if (!(data instanceof Int16Array)) throw new TypeError(`pagina ${i} is geen Int16Array`);
      this.binnen.add(i);
      this.stuur({ type: 'pagina', id: this.id, i, data }, [data.buffer]);
    }).catch((e) => {
      if (this.onderweg.get(i) === a) this.onderweg.delete(i);
      if (a.signal.aborted || this.gesloten) return;
      // Eén melding per nummer; de volgende tik probeert het opnieuw (een gat is stilte).
      if (this.fouten++ === 0 && this.onfout) this.onfout(`pagina ${i} niet binnen: ${e?.message ?? e}`);
    });
  }

  /** Weg: alles afbreken. De worklet laat de pagina's los bij de volgende laad of leeg. */
  sluit() {
    this.gesloten = true;
    for (const a of this.onderweg.values()) a.abort();
    this.onderweg.clear();
  }

  /** Bytes in de worklet (voor de meting). */
  get bytes() { return this.binnen.size * PAGINA * 2 * this.kanalen; }
}
