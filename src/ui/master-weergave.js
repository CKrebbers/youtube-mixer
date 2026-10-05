/**
 * De master als tekst en getal voor het scherm (docs/MASTER.md). Puur: geen
 * DOM, geen engine; de MASTER-rij (master-paneel.js) en de tests gebruiken dit.
 */

/** Zoveel dB gain reduction vult de balk helemaal. */
export const GR_SCHAAL = 12;
/** Zo snel zakt de getoonde gain reduction terug (dB per seconde): leesbaar, geen geflikker. */
export const GR_TERUG = 20;
/** De sleutel in localStorage voor het master-rack. */
export const OPSLAG = 'varve.master.rack';

/** "−3,2 dB" (gain reduction, ≤ 0), of "0 dB" als er niets af gaat. */
export function grTekst(db) {
  if (!(db < -0.05)) return '0 dB';
  return `−${Math.abs(db).toFixed(1).replace('.', ',')} dB`;
}

/** Hoe ver de balk vol is, 0..100 (%). */
export const grHoogte = (db) => Math.min(100, Math.max(0, (-db / GR_SCHAAL) * 100));

/**
 * De getoonde gain reduction: meteen omlaag (dieper), langzaam terug
 * (GR_TERUG dB/s), zodat je een korte piek ziet. `dt` in seconden.
 */
export function houdGr(getoond, nu, dt) {
  if (!Number.isFinite(getoond) || nu <= getoond) return nu;
  return Math.min(nu, getoond + GR_TERUG * Math.max(0, dt));
}

/**
 * Wat er in de rackkiezer staat: het sjabloon ("s:<nr>"), een los effect
 * ("e:<effect>", een rack van één effect zonder herkomst), of "" (iets
 * anders: niet bewaard).
 */
export function kiesWaarde(fx) {
  const h = fx?.herkomst;
  if (typeof h === 'string' && h.startsWith('s:')) return h;
  if (h == null && fx?.rack?.chain?.length === 1 && fx.effectId) return `e:${fx.effectId}`;
  return '';
}

/** Wat er bewaard wordt: welk rack (de inhoud) en waar het vandaan kwam. */
export function bewaarVorm(fx, sjablonen = []) {
  const h = typeof fx.herkomst === 'string' && fx.herkomst.startsWith('s:') ? fx.herkomst : null;
  const naam = h ? sjablonen[Number(h.slice(2))]?.name ?? fx.rackNaam ?? null : null;
  return { herkomst: h, naam, rack: fx.naarJSON() };
}

/**
 * Het bewaarde rack lezen: { rack, naam } (naam = het sjabloon waar het
 * vandaan kwam, of null). Kapot, leeg of geen rack: null (dan blijft het
 * standaardeffect).
 */
export function leesBewaard(tekst) {
  let d;
  try { d = JSON.parse(tekst || 'null'); } catch (_) { return null; }
  if (!d || typeof d !== 'object' || !d.rack || typeof d.rack !== 'object' || !Array.isArray(d.rack.chain)) return null;
  const naam = typeof d.herkomst === 'string' && d.herkomst.startsWith('s:') && typeof d.naam === 'string' ? d.naam : null;
  return { rack: d.rack, naam };
}

/**
 * De herkomst van een bewaard sjabloon, op NAAM teruggezocht: verschuift de
 * volgorde in racks/sjablonen.json, dan blijft het hetzelfde sjabloon; is
 * het er niet meer, dan null (de bewaarde inhoud klinkt gewoon, "niet bewaard").
 */
export function sjabloonHerkomst(naam, sjablonen = []) {
  if (!naam) return null;
  const i = sjablonen.findIndex((r) => r?.name === naam);
  return i >= 0 ? `s:${i}` : null;
}
