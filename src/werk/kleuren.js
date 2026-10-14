import { PALETTE, PALETTE_HEX } from '../control/devices/apc40mk2.js';

/**
 * Eén kleurtaal (docs/WERKRUIMTE.md A10, werkruimte S3): elk deel heeft één kleur, een
 * naam uit het APC-palet, en die is overal dezelfde: het tabblad op de werk-balk, de kop van
 * een tweede scherm en de iPad, en de pads van de Maschine (hetzelfde palet).
 *
 * Een werkruimte zet de kleur zelf per deel (`kleur`); dit is wat een deel krijgt als je
 * er een maakt met een van de acht vaste namen, en wat de werk-balk toont als er iets mis is.
 */
export const DEEL_KLEUR = Object.freeze({
  mix: 'wit', uitlijn: 'groen', fx: 'violet', stems: 'zeegroen', secties: 'hemelsblauw',
  spelen: 'oranje', beeld: 'geel', bladeren: 'grijs',
});
/** Hetzelfde op het label (MIX, UITLIJN … LIBRARY), voor een deel met een eigen naam. */
export const LABEL_KLEUR = Object.freeze({
  MIX: 'wit', UITLIJN: 'groen', FX: 'violet', STEMS: 'zeegroen', SECTIES: 'hemelsblauw',
  SPELEN: 'oranje', BEELD: 'geel', LIBRARY: 'grijs',
});

/** De paletnaam van een deel: zijn eigen kleur, anders die van zijn naam of label, anders grijs. */
export function kleurVanDeel(naam, deel = null) {
  if (deel?.kleur && Object.hasOwn(PALETTE, deel.kleur)) return deel.kleur;
  return DEEL_KLEUR[naam] ?? LABEL_KLEUR[deel?.label] ?? 'grijs';
}

/** De hex van een paletnaam (zoals de LED hem toont), voor CSS. Onbekend: grijs. */
export function hexVan(paletnaam) {
  const v = PALETTE[paletnaam];
  return PALETTE_HEX[v ?? PALETTE.grijs] ?? '#7F7F7F';
}

/**
 * Leesbare tekstkleur op een tab in deze kleur: donker op licht (wit, geel, limoen …), licht op
 * donker. Op de waargenomen helderheid van de hex, niet op de naam.
 */
export function tekstOp(paletnaam) {
  const h = hexVan(paletnaam).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.55 ? '#07090b' : '#f4f7fa';
}
