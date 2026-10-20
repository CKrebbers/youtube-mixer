// Herkomst: v1 youtube-mixer/src/koppel/niveau.js; in v2 alleen de imports anders: koppel/ mag niets uit
// beeld/ lezen (test/regels.test.mjs), dus clamp komt uit kern/emitter.js en gladOpNeer staat hieronder
// als kopie van beeld/analyse/kenmerken.js (zelfde formule en τ; test/koppel-niveau.test.mjs vergelijkt ze).
/**
 * Het niveau van de beeldzender: bas, midden, hoog en luidheid op de schaal van
 * WAT ER NU KLINKT, niet op een vaste ijking.
 *
 * Waarom (v1, 13 okt, gemeten op de relay): kenmerken.js legt de banden op vaste
 * dB-grenzen (BAND_DB, RMS_DB), geijkt op de master met de fader op 0,8. Een
 * luidere master staat daar met laag en luid continu op 1,00 en midden/hoog op
 * 0,85–0,99: de Stroommachine moduleert dan met een vlakke lijn en er gebeurt
 * weinig op de maat. Afgekapte waarden zijn achteraf niet te herschalen, dus dit
 * leest de ruwe dB (Kenmerken.waarden.db).
 *
 * Per kenmerk: de dB van de laatste VENSTER_S seconden; het LAAG_P-percentiel is
 * 0, het HOOG_P-percentiel 1, met minstens MIN_BEREIK_DB ertussen (anders blaast
 * een vlak stuk ruis op tot volle uitslag). Daarna gladmaken zoals kenmerken.js
 * (snel omhoog, rustiger omlaag). Alleen voor de zender: de vormlagen van VarveDJ
 * houden hun vaste ijking.
 *
 * - Stilte telt niet mee: een monster dat op de vaste schaal < STIL_VAST is, gaat
 *   niet in het venster (na een pauze blijft de schaal van de muziek staan) en
 *   geeft zelf 0.
 * - Te weinig monsters (MIN_MONSTERS, ~1 s): de vaste schaal, zoals voorheen.
 * - Tijd komt van buiten (de audioklok); terug in de tijd = opnieuw.
 *
 * Puur: geen Web Audio, geen DOM.
 */
import { clamp } from '../kern/emitter.js';

export const VENSTER_S = 8;
export const LAAG_P = 0.10;
export const HOOG_P = 0.95;
export const MIN_BEREIK_DB = 6;
export const STIL_VAST = 0.05;
export const MIN_MONSTERS = 20;
/** kenmerk van de zender -> sleutel in Kenmerken.waarden (en in waarden.db) */
export const NIVEAU_KENMERKEN = { laag: 'laag', midden: 'midden', hoog: 'hoog', luid: 'rms' };

/** Zoals OPKOMST_TAU en UITSTERF_TAU in beeld/analyse/kenmerken.js (s). */
export const OPKOMST_TAU = 0.02;
export const UITSTERF_TAU = 0.12;

/** Eén stap gladmaken over dt seconden (kopie van glad() in beeld/analyse/kenmerken.js). */
export function glad(vorige, nieuw, dt, tau) {
  if (vorige == null || !(tau > 0)) return nieuw;
  if (!(dt > 0)) return vorige;
  return nieuw + (vorige - nieuw) * Math.exp(-dt / tau);
}

/** Gladmaken met een eigen τ omhoog en omlaag (kopie van gladOpNeer daar). */
export const gladOpNeer = (vorige, nieuw, dt, op = OPKOMST_TAU, neer = UITSTERF_TAU) =>
  glad(vorige, nieuw, dt, nieuw > vorige ? op : neer);

const percentiel = (gesorteerd, p) => {
  const i = (gesorteerd.length - 1) * p;
  const a = Math.floor(i), b = Math.ceil(i);
  return gesorteerd[a] + (gesorteerd[b] - gesorteerd[a]) * (i - a);
};

export class NiveauVolger {
  constructor({ venster = VENSTER_S } = {}) {
    this.venster = venster;
    this.reset();
  }

  reset() {
    this.t = null;
    this.monsters = {};   // kenmerk -> [{ t, db }], oudste eerst
    this.uit = {};        // kenmerk -> geglad 0..1
    for (const k of Object.keys(NIVEAU_KENMERKEN)) { this.monsters[k] = []; this.uit[k] = 0; }
  }

  /**
   * @param t     seconden (audioklok)
   * @param mix   Kenmerken.waarden: { laag, midden, hoog, rms, db: { laag, midden, hoog, rms } }
   * @returns     { laag, midden, hoog, luid } 0..1, of null zonder mix of zonder db (dan de vaste schaal)
   */
  stap(t, mix) {
    if (!mix || !mix.db) return null;
    if (this.t !== null && t < this.t) this.reset();
    if (this.t !== null && t === this.t) return { ...this.uit };
    const dt = this.t === null ? 0 : t - this.t;
    this.t = t;
    for (const [k, sleutel] of Object.entries(NIVEAU_KENMERKEN)) {
      const vast = mix[sleutel] ?? 0;
      const db = mix.db[sleutel];
      const rij = this.monsters[k];
      while (rij.length && rij[0].t < t - this.venster) rij.shift();
      let doel;
      if (!Number.isFinite(db) || vast < STIL_VAST) doel = 0;
      else {
        rij.push({ t, db });
        if (rij.length < MIN_MONSTERS) doel = vast;
        else {
          const s = rij.map((m) => m.db).sort((a, b) => a - b);
          const lo = percentiel(s, LAAG_P);
          const hi = Math.max(percentiel(s, HOOG_P), lo + MIN_BEREIK_DB);
          doel = clamp((db - lo) / (hi - lo));
        }
      }
      this.uit[k] = dt > 0 ? gladOpNeer(this.uit[k], doel, dt) : doel;
    }
    return { ...this.uit };
  }
}
