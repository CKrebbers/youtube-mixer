/**
 * Video-effecten op de tel. Puur rekenwerk: geen DOM, geen WebGL.
 *
 * De maat komt van wat je HOORT: de maatgever van de engine (de track die het
 * hardst klinkt, speelt en een beatgrid heeft, met hysterese; zie
 * Engine.maatgever). Dezelfde als sync, sampler en de MAAT-badge. De puls
 * komt bovenop de stand van de knop: RGB op 30% springt op de tel omhoog en
 * zakt terug naar 30%.
 */

/** Wat er kan pulsen. "flits" is geen effectknop maar een lichtflits op de tel. */
export const PULS_DOELEN = ['rgb', 'pixel', 'spiegel', 'korrel', 'flits'];

/**
 * De vorm van één tel: vol op de tel, dan snel uitdoven. Op een halve tel
 * is er nog 8% over; zo blijft het een klap en geen golf.
 * @param fase 0..1 binnen de tel
 */
export const pulsVorm = (fase) => Math.exp(-5 * Math.max(0, Math.min(1, fase)));

/**
 * De effectstanden met de puls erbovenop.
 * @returns { fx, flits } — fx is een nieuw object, het origineel blijft staan
 */
export function metPuls(fx, doel, diepte, vorm) {
  const extra = Math.max(0, Math.min(1, diepte)) * vorm;
  if (doel === 'flits') return { fx: { ...fx }, flits: extra };
  if (!(doel in fx)) return { fx: { ...fx }, flits: 0 };
  return { fx: { ...fx, [doel]: Math.min(1, fx[doel] + extra) }, flits: 0 };
}
