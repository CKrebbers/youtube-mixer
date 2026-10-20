// Herkomst: v1 youtube-mixer/src/video/passen.js @ 039b372, ongewijzigd overgenomen (v2 BOUWPLAN plak 4). Wijzigingen hier, niet meer in v1.
/**
 * Hoe een video met zijn eigen beeldverhouding op het 16:9-doek komt.
 * Puur rekenwerk, zodat het zonder browser te testen is; de meng-shader in
 * video-mixer.js doet per pixel precies wat `leesLaag` hier doet.
 *
 *   passend  het hele beeld zichtbaar, zwarte randen waar het niet vult
 *            (staand 9:16 krijgt balken links en rechts, 21:9 boven en onder)
 *   vullen   het doek helemaal vol, wat uitsteekt valt weg
 *
 * Buiten het beeld is een laag DOORZICHTIG, niet zwart: staat er een liggende
 * video naast een staande, dan zie je in de balken de liggende, niet een
 * donkere versie ervan. Staat er niets anders, dan is het er zwart.
 */

export const FITS = ['passend', 'vullen'];

/**
 * Schaal van doekcoördinaat naar beeldcoördinaat, per as:
 *   beeld = (doek - 0,5) × schaal + 0,5
 * Een schaal boven 1 = het beeld is op die as smaller dan het doek (randen);
 * onder 1 = er valt iets weg. Zonder bekende maat: [1, 1] (uitrekken, zoals
 * het altijd was), zodat een video die nog laadt niet verspringt of verdwijnt.
 */
export function schaalVoor(breedte, hoogte, fit = 'passend', doekB = 1280, doekH = 720) {
  if (!(breedte > 0 && hoogte > 0 && doekB > 0 && doekH > 0)) return [1, 1];
  const r = (breedte / hoogte) / (doekB / doekH);   // < 1: smaller dan het doek (staand)
  if (Math.abs(r - 1) < 1e-3) return [1, 1];
  const passend = fit !== 'vullen';
  if (r < 1) return passend ? [1 / r, 1] : [1, r];
  return passend ? [1, r] : [1 / r, 1];
}

/** De maat van een bron: een <video> (videoWidth) of een canvas als nep-video (width). */
export function maatVan(bron) {
  const b = bron?.videoWidth || bron?.width || 0;
  const h = bron?.videoHeight || bron?.height || 0;
  return [b, h];
}

/**
 * Wat de shader per pixel doet, in JavaScript: waar in het beeld je leest, en
 * of je binnen het beeld bent (1) of in een rand (0).
 */
export function leesLaag(u, v, schaal) {
  const x = (u - 0.5) * schaal[0] + 0.5;
  const y = (v - 0.5) * schaal[1] + 0.5;
  const binnen = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? 1 : 0;
  return { x, y, binnen };
}
