/**
 * De kant-en-klare racks (v2/app/racks/sjablonen.json, een ongewijzigde kopie van v1
 * racks/sjablonen.json @ e27018f). Data, geen code: { versie, uitleg, racks: [rack in de vorm van
 * v1] }. Een rack in de vorm van het bouwplan mag er ook in staan; leesRack zet het om.
 *
 * Laden gebeurt één keer bij het opstarten (de schermlaag): `laadSjablonen()` geeft de lijst, of
 * null als het bestand er niet is of niet klopt (dan blijven de racks per effect, acties-fx.js).
 * Herkomst en bewaren van EIGEN racks horen hier niet bij (later, via de server).
 */
import { leesRack } from './rack.js';
import { effectVan } from './fx.js';

export const SJABLONEN_URL = new URL('../../../racks/sjablonen.json', import.meta.url);

/** De racks uit het document die zonder fouten lezen (een kapot sjabloon valt eruit, met de reden). */
export function sjablonenUit(doc) {
  const racks = Array.isArray(doc) ? doc : Array.isArray(doc?.racks) ? doc.racks : [];
  const goed = [], fout = [];
  for (const r of racks) {
    try {
      const { fouten } = leesRack(r, { bekendType: (t) => !!effectVan(t) });
      if (fouten.length) fout.push({ naam: r?.name ?? r?.naam ?? '?', fouten });
      else goed.push(r);
    } catch (e) {
      fout.push({ naam: r?.name ?? '?', fouten: [String(e?.message ?? e)] });
    }
  }
  return { racks: goed, fout };
}

/** Het bestand ophalen (fetch). Null als dat niet lukt. */
export async function laadSjablonen(url = SJABLONEN_URL, { haal = globalThis.fetch } = {}) {
  if (typeof haal !== 'function') return null;
  try {
    const res = await haal(url, { cache: 'no-store' });
    if (!res.ok) { await res.text?.().catch(() => {}); return null; }
    const { racks } = sjablonenUit(await res.json());
    return racks.length ? racks : null;
  } catch (_) {
    return null;
  }
}
