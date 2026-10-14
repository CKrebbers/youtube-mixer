import { clamp, expMap } from '../lib/emitter.js';
import { LFO_DELINGEN } from './fx-lfo.js';

/**
 * Modulators voor een rack (spoor S10, docs/EFFECTEN-MEER.md): een bron die een
 * parameter, een knop (`plek.K`) of de diepte van een andere modulator
 * (`mod.N.diepte`) laat bewegen, zoals in Bitwig. Vier soorten:
 *
 *   lfo     een golf, vrij in Hz of op de maat (deling): −1..1
 *   stap    een reeks van 1–16 standen op de maat: 0..1
 *   volger  de luidheid van wat er IN het rack gaat (omhullende): 0..1
 *   toeval  een nieuwe willekeurige stand per deling, uit een ZAAD: −1..1
 *
 * Wat eruit komt is een OFFSET op de basis (de knopstand, of de eigen stand van
 * de parameter): de knop zelf beweegt niet mee, dus scherm, LED-ring en
 * soft-takeover blijven kloppen (zoals `zetModulatie` bij de vormlagen).
 *
 * Regel 3: alles is een functie van de AUDIOKLOK. De timer van InsertSlot zegt
 * alleen WANNEER er gerekend wordt (elke 33 ms, zoals glijden); de stand komt
 * van `t` (ctx.currentTime) en, op de maat, van de klok van het deck
 * (`fxKlok()`: tellengte, het anker van de volgende tel en de maat). Staat de
 * klok stil, dan staat de modulatie stil.
 *
 * Dit is een BESTURING, geen audiosnelheid: elke stap gaat via zet() van het
 * effect, dat zelf glijdt (τ 20 ms). Vrij daarom hooguit 8 Hz.
 *
 * Puur: geen Web Audio, geen DOM, geen Math.random. In Node te toetsen.
 */

export const MOD_SOORTEN = ['lfo', 'stap', 'volger', 'toeval'];
export const MOD_VORMEN = ['sinus', 'driehoek', 'blok', 'zaag', 'omlaag'];
/** Vrij: zo snel mag een LFO of toeval hooguit (een besturing, geen audiosnelheid). */
export const MOD_HZ_MIN = 0.02, MOD_HZ_MAX = 8;
export const STAPPEN_MAX = 16;
/** Zonder ooit een tel gezien: 120 bpm (zoals de delay en de LFO van tremolo). */
const TEL_ZONDER = 0.5;

const tellenVan = (id) => LFO_DELINGEN.find((d) => d.id === id)?.tellen ?? null;
const frac = (x) => x - Math.floor(x);

/** Een modulator netjes maken: onbekende soort = `null` (blijft in het rack staan, doet niets). */
export function leesMod(m) {
  if (!m || !MOD_SOORTEN.includes(m.soort)) return null;
  const getal = (v, std, a = 0, b = 1) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : std);
  const uit = {
    soort: m.soort,
    diepte: getal(m.diepte, 1),
    sync: m.soort === 'stap' ? true : m.sync !== false,
    deling: tellenVan(m.deling) ? m.deling : (m.soort === 'stap' ? '1/16' : '1/1'),
    hz: getal(m.hz, 0.5, MOD_HZ_MIN, MOD_HZ_MAX),
    fase: getal(m.fase, 0),
    doelen: Array.isArray(m.doelen) ? m.doelen : [],
  };
  if (m.soort === 'lfo') uit.vorm = MOD_VORMEN.includes(m.vorm) ? m.vorm : 'sinus';
  if (m.soort === 'stap') {
    const s = Array.isArray(m.stappen) ? m.stappen.slice(0, STAPPEN_MAX).map((v) => getal(v, 0)) : [];
    uit.stappen = s.length ? s : [1, 0, 0, 0];
    uit.glad = getal(m.glad, 0);
  }
  if (m.soort === 'toeval') { uit.zaad = Number.isInteger(m.zaad) ? m.zaad : 1; uit.glad = getal(m.glad, 0); }
  if (m.soort === 'volger') {
    uit.aanzet = getal(m.aanzet, 0.01, 0.001, 1);
    uit.verval = getal(m.verval, 0.3, 0.01, 4);
    uit.gevoel = getal(m.gevoel, 0.5);
  }
  return uit;
}

/** De versterking van de volger: gevoel 0..1 → ×0,5 .. ×20 op de rms van de ingang. */
export const volgerVersterking = (g) => expMap(clamp(g), 0.5, 20);

/** Een golf op fase f ∈ [0, 1): +1 op de tel, zoals de LFO van tremolo. */
export function golf(vorm, f) {
  const x = frac(f);
  switch (vorm) {
    case 'driehoek': return 1 - 4 * Math.min(x, 1 - x);
    case 'blok': return x < 0.5 ? 1 : -1;
    case 'zaag': return 1 - 2 * x;           // van +1 op de tel naar −1
    case 'omlaag': return 2 * x - 1;         // van −1 op de tel naar +1 (opbouw)
    default: return Math.cos(2 * Math.PI * x);
  }
}

/** Een getal −1..1 uit (zaad, n), deterministisch: hetzelfde zaad = dezelfde reeks. */
export function toevalVan(zaad, n) {
  let h = (Math.imul(zaad | 0, 0x9E3779B1) ^ Math.imul((n | 0) + 0x632BE5AB, 0x85EBCA77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7FEB352D) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846CA68B) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967295) * 2 - 1;
}

/** Zacht van a naar b over u ∈ [0, 1]. */
const zacht = (a, b, u) => a + (b - a) * u * u * (3 - 2 * u);

/**
 * De stand van ÉÉN modulator bijhouden. Alles hangt van t af; de staat is
 * alleen wat continuïteit nodig heeft: de positie in tellen (zodat een golf
 * van vier maten na een sprong doorloopt) en de omhullende van de volger.
 */
export class ModStaat {
  constructor() {
    this.t = null;          // laatste t
    this.tellen = null;     // absolute positie in tellen (op de maat), congruent met de tel in de maat
    this.tel = null;        // laatst bekende tellengte (s)
    this.vrij = 0;          // fase in cycli (vrij)
    this.env = 0;           // omhullende (volger)
  }

  /**
   * De positie in tellen op t. Met een klok: de tel in de maat (of vanaf de tel
   * als de maat onbekend is), en de absolute teller loopt mee met het kleinste
   * verschil modulo de maat. Zonder klok: doorlopen op de laatst bekende tel.
   */
  _tellenOp(t, k) {
    if (k && k.beatLengte > 0 && Number.isFinite(k.ankerCtx)) {
      this.tel = k.beatLengte;
      const per = Number.isInteger(k.tellenTotEen) && k.perMaat > 0 ? k.perMaat : 1;
      const ankerIdx = per > 1 ? ((per - k.tellenTotEen) % per + per) % per : 0;
      const pos = ankerIdx - (k.ankerCtx - t) / k.beatLengte;
      if (this.tellen === null) this.tellen = pos;
      else {
        // Het verschil modulo de maat, zo dicht mogelijk bij wat de klok sinds de vorige keer
        // zegt (d0): na een hapering van meer dan een halve maat liep de teller anders terug.
        const d0 = this.t !== null && t > this.t ? (t - this.t) / k.beatLengte : 0;
        let d = pos - this.tellen;
        d -= per * Math.round((d - d0) / per);
        this.tellen += d;
      }
    } else if (this.tellen === null) {
      this.tellen = 0;
    } else if (this.t !== null && t > this.t) {
      this.tellen += (t - this.t) / (this.tel ?? TEL_ZONDER);
    }
    return this.tellen;
  }

  /**
   * De waarde op t: −1..1 (lfo, toeval) of 0..1 (stap, volger).
   * @param niveau  () => rms van de ingang (alleen voor de volger)
   */
  waarde(m, t, k, niveau) {
    const vorige = this.t;
    let uit = 0;
    if (m.soort === 'volger') {
      const doel = clamp((niveau?.() ?? 0) * volgerVersterking(m.gevoel));
      const dt = vorige === null ? 0 : Math.max(0, t - vorige);
      const tau = doel > this.env ? m.aanzet : m.verval;
      this.env = dt > 0 ? doel + (this.env - doel) * Math.exp(-dt / tau) : (vorige === null ? doel : this.env);
      uit = this.env;
    } else if (m.sync) {
      const T = tellenVan(m.deling) ?? 4;
      const pos = this._tellenOp(t, k) / T + m.fase;
      uit = this._vorm(m, pos);
    } else {
      if (vorige !== null && t > vorige) this.vrij += (t - vorige) * m.hz;
      uit = this._vorm(m, this.vrij + m.fase);
    }
    this.t = t;
    return uit;
  }

  /** Waarde op positie p (in cycli; voor stap: in stappen). */
  _vorm(m, p) {
    if (m.soort === 'lfo') return golf(m.vorm, p);
    const n = Math.floor(p), u = p - n;
    if (m.soort === 'stap') {
      const s = m.stappen, L = s.length;
      const nu = s[((n % L) + L) % L], was = s[(((n - 1) % L) + L) % L];
      return m.glad > 0 && u < m.glad ? zacht(was, nu, u / m.glad) : nu;
    }
    if (m.soort === 'toeval') {
      const nu = toevalVan(m.zaad, n);
      return m.glad > 0 && u < m.glad ? zacht(toevalVan(m.zaad, n - 1), nu, u / m.glad) : nu;
    }
    return 0;
  }
}

/**
 * Alle modulators van een rack. `bereken(t, klok, niveau, diepteVanKnop)` geeft
 * de offsets per doel: { plek: Map(K → offset), keten: Map(target → offset) }.
 * Een knop kan de diepte van een modulator zetten (`mod.N.diepte` als doel van
 * een link: `diepteVanKnop`), en een modulator die van een andere (doel
 * `mod.N.diepte`): die tellen op, één niveau diep.
 */
export class ModBank {
  /** @param vorige  een eerdere bank van hetzelfde rack: een modulator die dezelfde soort bleef houdt zijn stand */
  constructor(ruw = [], vorige = null) {
    this.mods = (ruw || []).map(leesMod);
    this.staten = this.mods.map((m, i) => (m && vorige?.mods?.[i]?.soort === m.soort ? vorige.staten[i] : new ModStaat()));
  }

  /** Is er een modulator op de maat met een periode (of stap) onder de 250 ms bij 120 bpm? Dan een fijnere tik. */
  get snel() {
    return this.mods.some((m) => m && m.doelen.length && ((m.sync && (tellenVan(m.deling) ?? 4) < 0.5) || (!m.sync && m.soort !== 'volger' && m.hz > 4)));
  }

  /** Doet er een iets (een bekende soort met een doel)? */
  get actief() { return this.mods.some((m) => m && m.doelen.length); }
  get volgt() { return this.mods.some((m) => m?.soort === 'volger' && m.doelen.length); }

  bereken(t, klok = null, niveau = null, diepteVanKnop = null) {
    const k = this.mods.some((m) => m?.sync) ? klok : null;
    const ruw = this.mods.map((m, i) => (m ? this.staten[i].waarde(m, t, k, niveau) : 0));
    // De diepte van elke modulator: van de knop als een knop hem stuurt, anders zijn eigen.
    const diepte = this.mods.map((m, i) => (m ? (diepteVanKnop?.has(i + 1) ? diepteVanKnop.get(i + 1) : m.diepte) : 0));
    const plus = this.mods.map(() => 0);
    this.mods.forEach((m, i) => {
      if (!m) return;
      for (const d of m.doelen) {
        if (/^mod\.\d+\.diepte$/.test(d.target)) {
          const j = Number(d.target.split('.')[1]) - 1;
          if (j !== i && j >= 0 && j < plus.length) plus[j] += ruw[i] * diepte[i] * d.diepte;
        }
      }
    });
    const plek = new Map(), keten = new Map();
    this.mods.forEach((m, i) => {
      if (!m) return;
      const sterk = clamp(diepte[i] + plus[i]) * 1;
      for (const d of m.doelen) {
        if (/^mod\./.test(d.target)) continue;
        const off = ruw[i] * sterk * d.diepte;
        if (/^plek\.[1-8]$/.test(d.target)) {
          const K = Number(d.target.slice(5));
          plek.set(K, (plek.get(K) ?? 0) + off);
        } else keten.set(d.target, (keten.get(d.target) ?? 0) + off);
      }
    });
    return { plek, keten, ruw };
  }
}
