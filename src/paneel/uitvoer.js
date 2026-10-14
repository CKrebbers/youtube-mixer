/**
 * Een invoke van buiten de Mac (de iPad, de iPhone) uitvoeren, of weigeren met een reden
 * (werkruimte S8, Clay 14 okt W1 = ja; docs/WERKRUIMTE.md C4 "Veiligheid", docs/werkruimte/S8.md).
 * DE MIXER BESLIST, niet de server en niet de pagina: de server weet wie er gekoppeld is, maar
 * alleen de mixer kent het deel van nu, de panelen en de vars ({focus} …).
 *
 * Een action mag alleen als hij
 *   1. in een paneel of bouwsteen staat die de werkruimte in het ACTIEVE deel op DAT scherm zet,
 *      ingevuld met de vars van nu (`toegestaan(scherm)`: een Set, schermen.js rekent hem), en
 *   2. door `waaromNietOpScherm` komt (model.js): VAST_NOOIT (opnemen, log, mappings, werkruimtes,
 *      library, laden) wint altijd, dan `nooit`, dan tijdkritisch (tenzij het scherm het aanzet),
 *      dan `mag`;
 *   3. op de bus bestaat en geen `alleenScherm` heeft, met de juiste soort waarde (regel 2).
 * Loslaten gaat ALTIJD naar wat die pagina indrukte (ook als het deel of de focus intussen wisselde),
 * en alleen daarheen. Valt een pagina weg, dan laat `laatLos(k)` alles los wat hij vasthield.
 * In het handelingenlog draagt elke regel de bron (`invoke(id, v, { bron })`, vierde kolom).
 *
 * Puur genoeg om te testen: geen DOM, geen netwerk; alles komt van buiten.
 */
import { waaromNietOpScherm } from '../werk/model.js';

export class Uitvoerder {
  /**
   * @param invoke      (id, v, opties) de bus
   * @param read        (id) de bus
   * @param metaOf      (id) de meta van de bus, of null (bestaat niet)
   * @param werkruimte  () => de genormaliseerde werkruimte (def), of null
   * @param toegestaan  (scherm) => Set met de ingevulde actions op dat scherm in het deel van nu
   */
  constructor({ invoke, read = () => null, metaOf = () => null, werkruimte = () => null, toegestaan = () => new Set() } = {}) {
    Object.assign(this, { _invoke: invoke, _read: read, _metaOf: metaOf, _werk: werkruimte, _toegestaan: toegestaan });
    this.vast = new Map();   // k -> Map(id -> bron)
    this.losSeq = new Map(); // `${k}|${id}` -> seq van de laatste 'los' (een oudere 'aan' die later binnenkomt telt niet)
    this.stats = { uitgevoerd: 0, geweigerd: 0, losgelaten: 0 };
  }

  /** Waarom niet (een tekst), of null als het mag. */
  waaromNiet(b) {
    const w = this._werk();
    if (!w || w.naam === 'standaard') return 'geen werkruimte in de mixer';
    const meta = this._metaOf(b.id);
    if (!meta) return `${b.id} bestaat niet`;
    if (meta.meta?.alleenScherm || meta.alleenScherm) return `${b.id} kan alleen op het scherm van de Mac`;
    const reden = waaromNietOpScherm(w, b.scherm, b.id);
    if (reden) return reden;
    if (!this._toegestaan(b.scherm)?.has(b.id)) return `${b.id} staat niet in een paneel van "${b.scherm}" in dit deel`;
    const type = meta.type ?? meta.meta?.type;
    if (b.druk && type !== 'trigger') return `${b.id} is geen knop: indrukken en loslaten alleen bij een knop`;
    if (type === 'trigger' && typeof b.v !== 'boolean') return `${b.id} is een knop (true/false)`;
    if (type === 'value' && typeof b.v !== 'number') return `${b.id} is een waarde (0..1)`;
    return null;
  }

  /** Eén invoke: { t: 'invoke', id, v, druk, seq, scherm, k }. Geeft { ok, reden?, read? }. */
  voer(b) {
    const k = typeof b?.k === 'string' ? b.k : 'zonder';
    const bron = /^[a-z0-9-]{1,16}$/.test(b?.scherm ?? '') ? b.scherm : 'buiten';
    if (b?.druk === 'los') {
      // Loslaten: alleen wat deze pagina vasthoudt, en altijd (het deel kan intussen gewisseld zijn).
      const sk = `${k}|${b.id}`;
      if (Number.isSafeInteger(b.seq) && !(this.losSeq.get(sk) >= b.seq)) {
        this.losSeq.set(sk, b.seq);
        if (this.losSeq.size > 512) this.losSeq.delete(this.losSeq.keys().next().value);
      }
      const v = this.vast.get(k);
      if (!v?.has(b.id)) return { ok: false, reden: 'niets vast' };
      v.delete(b.id);
      if (!v.size) this.vast.delete(k);
      this._los(b.id, bron);
      return { ok: true, read: this._leesVeilig(b.id) };
    }
    const reden = this.waaromNiet(b);
    if (reden) { this.stats.geweigerd++; return { ok: false, reden }; }
    // Een 'aan' die ná zijn eigen 'los' binnenkomt (twee verbindingen, een herhaling): niet meer indrukken.
    if (b.druk === 'aan' && Number.isSafeInteger(b.seq) && this.losSeq.get(`${k}|${b.id}`) > b.seq) { this.stats.geweigerd++; return { ok: false, reden: 'al losgelaten' }; }
    // Dezelfde knop nog eens 'aan' terwijl hij al vastzit: niet nog eens (de server zou ook dubbel tellen).
    if (b.druk === 'aan' && this.vast.get(k)?.has(b.id)) return { ok: true, read: this._leesVeilig(b.id), al: true };
    this._invoke(b.id, b.v, { bron });
    this.stats.uitgevoerd++;
    if (b.druk === 'aan') {
      let v = this.vast.get(k);
      if (!v) { v = new Map(); this.vast.set(k, v); }
      v.set(b.id, bron);
    }
    return { ok: true, read: this._leesVeilig(b.id) };
  }

  /** Pagina k is weg (of de server, of de schrijfweg ging uit): alles los wat hij vasthield. */
  laatLos(k) {
    const v = this.vast.get(k);
    if (!v) return 0;
    this.vast.delete(k);
    for (const [id, bron] of v) this._los(id, bron);
    return v.size;
  }

  laatAllesLos() {
    let n = 0;
    for (const k of [...this.vast.keys()]) n += this.laatLos(k);
    return n;
  }

  get aantalVast() { let n = 0; for (const v of this.vast.values()) n += v.size; return n; }

  _los(id, bron) {
    this.stats.losgelaten++;
    try { this._invoke(id, false, { bron }); } catch (_) {}
  }

  _leesVeilig(id) {
    try { const v = this._read(id); return typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : (typeof v === 'boolean' || v === null ? v : null); } catch (_) { return null; }
  }
}
