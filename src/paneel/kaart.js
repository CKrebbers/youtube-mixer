/**
 * Het paneel KAART (werkruimte S7, docs/WERKRUIMTE.md A5, docs/werkruimte/S7.md): per apparaat de
 * open mapjes en wat elke knop daarin NU doet, groot (goud voor in het donker).
 *
 * Twee delen:
 *   kaartVan(...)   PUUR rekenwerk in de mixer: uit de Mapping van elk apparaat (`kies()` via
 *                   `actieveRegels()`, de regels van het open mapje) en `beschrijf()`. Klein van
 *                   vorm, want het gaat ook over de lijn naar de iPad (≤ 64 knoppen per apparaat).
 *   KaartWeergave   de weergave in werk.html (en in het werkvak): tekent alleen bij een nieuwe sleutel.
 *
 * De kaart toont alleen wat in een OPEN MAPJE zit (de regels met een `laag`): de kern doet in elk
 * deel hetzelfde (WERKRUIMTE.md A2) en zou de kaart alleen vullen. Zonder open mapje: "kern".
 */
import { resolveTarget } from '../control/mapping.js';
import { soortVan } from '../ui/soorten.js';

export const MAX_KNOPPEN = 64;

/**
 * @param apparaten [{ id, naam, mapping, device }] (device.label(sig) = de naam van de control)
 * @param beschrijf (action) => { kort, lang } | null
 * @returns { sleutel, apparaten: [{ id, naam, mapjes: [laag], knoppen: [[control, kort, soort, action]], meer }] }
 */
export function kaartVan(apparaten, beschrijf = () => null) {
  const uit = [];
  for (const a of apparaten ?? []) {
    const m = a?.mapping;
    if (!m?.actieveRegels) continue;
    const open = m.lagen?.() ?? [];
    const vars = typeof m.vars === 'function' ? m.vars() : (m.vars ?? {});
    const knoppen = [];
    let meer = 0;
    for (const [sig, r] of m.actieveRegels({ shift: false })) {
      if (!r?.laag || !open.includes(r.laag)) continue;
      if (knoppen.length >= MAX_KNOPPEN) { meer++; continue; }
      const action = resolveTarget(r.action, vars);
      const b = beschrijf(r.action) ?? beschrijf(action);
      knoppen.push([a.device?.label?.(sig) ?? sig, (b?.kort ?? action).slice(0, 32), soortVan(action), action]);
    }
    uit.push({ id: a.id, naam: a.naam ?? a.id, mapjes: open.slice(0, 12), knoppen, meer });
  }
  const sleutel = uit.map((a) => `${a.id}:${a.mapjes.join(',')}:${a.knoppen.map((k) => k[3]).join(',')}`).join('|');
  return { sleutel, apparaten: uit };
}

export class KaartWeergave {
  constructor(el) {
    this.el = el;
    this.doc = el.ownerDocument;
    this.root = this.doc.createElement('div');
    this.root.className = 'wk-kaart';
    el.appendChild(this.root);
    this._sleutel = null;
  }

  /** De kaart tonen (alleen als de sleutel anders is: geen werk per beeld). */
  toon(kaart) {
    const s = kaart?.sleutel ?? '';
    if (s === this._sleutel) return false;
    this._sleutel = s;
    this.root.replaceChildren();
    const lijst = kaart?.apparaten ?? [];
    if (!lijst.length) { this._maak('div', 'wk-kaart-leeg', this.root, 'geen apparaat met een mapje'); return true; }
    for (const a of lijst) {
      const blok = this._maak('section', 'wk-kaart-app', this.root);
      const kop = this._maak('div', 'wk-kaart-kop', blok);
      this._maak('span', 'wk-kaart-naam', kop, a.naam);
      this._maak('span', 'wk-kaart-mapjes', kop, a.mapjes.length ? a.mapjes.join(' · ') : 'kern (geen mapje open)');
      const raster = this._maak('div', 'wk-kaart-knoppen', blok);
      for (const [control, kort, soort] of a.knoppen) {
        const k = this._maak('div', `wk-kaart-knop s-${soort}`, raster);
        this._maak('span', 'wk-kaart-control', k, control);
        this._maak('span', 'wk-kaart-doet', k, kort);
      }
      if (a.meer) this._maak('div', 'wk-kaart-meer', blok, `+ ${a.meer} meer`);
    }
    return true;
  }

  _maak(tag, klasse, ouder, tekst) {
    const e = this.doc.createElement(tag);
    e.className = klasse;
    if (tekst != null) e.textContent = tekst;
    ouder.appendChild(e);
    return e;
  }

  vernietig() { this.root.remove(); }
}
