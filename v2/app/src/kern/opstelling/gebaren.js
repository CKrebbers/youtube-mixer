/**
 * Welke gebaren er zijn, en welke op de pads liggen (puur: alleen namen; wat ze DOEN staat in
 * engine/acties-gebaren.js). De Maschine-padstand "gebaren" heeft 16 pads:
 *
 *   rij 1–2 (pad 1–8)    VAST, in elk recept gelijk (spiergeheugen): de track met focus
 *   rij 3–4 (pad 9–16)   per RECEPT (`gebaren` in het recept, hooguit 8), anders STANDAARD_SPECIAAL;
 *                        de generator kiest ze uit SPECIALE_POOL, gewogen op je smaak ('gebaar:<naam>')
 */

export const VAST = Object.freeze(['echo', 'galm', 'dof', 'dun', 'stotter', 'bas', 'weg', 'fx']);

/** Naam -> korte tekst voor de schermen (≤ 10 tekens) en een uitleg. */
export const GEBAREN = Object.freeze({
  echo: { kort: 'echo', uitleg: 'echo-worp op de track met focus' },
  galm: { kort: 'galm', uitleg: 'galm-worp op de track met focus' },
  dof: { kort: 'dof', uitleg: 'lowpass dicht' },
  dun: { kort: 'dun', uitleg: 'highpass open' },
  stotter: { kort: 'stotter', uitleg: 'een korte lus; dieper = korter (alleen op een nummer)' },
  bas: { kort: 'zonder bas', uitleg: 'de lage band weg' },
  weg: { kort: 'weg', uitleg: 'de track zakt weg' },
  fx: { kort: 'effect', uitleg: 'het effect-rack erin' },
  'alles.dof': { kort: 'alles dof', uitleg: 'lowpass op alles' },
  'alles.dun': { kort: 'alles dun', uitleg: 'highpass op alles' },
  'alles.galm': { kort: 'alles galm', uitleg: 'galm-worp op alles' },
  'alles.echo': { kort: 'alles echo', uitleg: 'echo-worp op alles' },
  'alles.bas': { kort: 'alles bas', uitleg: 'de bas weg op alles' },
  breuk: { kort: 'breuk', uitleg: 'alles weg behalve de track met focus' },
  stilte: { kort: 'stilte', uitleg: 'alles weg: de stilte vóór de drop' },
  opbouw: { kort: 'opbouw', uitleg: 'rack Opbouw op alles: highpass omhoog, flanger, galm (een riser)' },
  band: { kort: 'band', uitleg: 'rack Band zakt weg op de track met focus: zwalken, dof, vuil' },
  'alles.band': { kort: 'alles band', uitleg: 'de bandmachine geeft het op, op alles' },
  wegspoelen: { kort: 'wegspoelen', uitleg: 'rack Wegspoelen: oplossen in galm en echo, de bas zakt weg' },
  oplossen: { kort: 'oplossen', uitleg: 'rack Oplossen: uiteenvallen in ruimte' },
  korrel: { kort: 'korrel', uitleg: 'de track met focus valt uiteen in korrels (granular); dieper = dichter en wilder' },
  'alles.korrel': { kort: 'alles korr', uitleg: 'alles valt uiteen in korrels' },
  korrelvast: { kort: 'korrel vst', uitleg: 'de korrelwolk bevriest: wat er net klonk blijft hangen; dieper = meer spray' },
  achteruit: { kort: 'achteruit', uitleg: 'lange korrels die achteruit spelen: het nummer loopt terug' },
  bevries: { kort: 'bevries', uitleg: 'rack Ruimte bevriezen: dieper drukken bevriest de wolk' },
  echovast: { kort: 'echo vast', uitleg: 'het droge geluid weg, de echo blijft op de maat herhalen' },
  galmvast: { kort: 'galm vast', uitleg: 'het droge geluid weg, de galm bevriest' },
  flits: { kort: 'flits', uitleg: 'witte flits in het beeld' },
  zwart: { kort: 'zwart', uitleg: 'het beeld zwart zolang je drukt' },
});

export const SPECIALE_POOL = Object.freeze(Object.keys(GEBAREN).filter((n) => !VAST.includes(n)));
export const STANDAARD_SPECIAAL = Object.freeze(['alles.dof', 'alles.galm', 'breuk', 'opbouw', 'band', 'echovast', 'galmvast', 'stilte']);

/** De 8 speciale gebaren van een recept: geldig, zonder dubbele, aangevuld uit de standaard. */
export function specialeVan(lijst) {
  const uit = [];
  for (const n of Array.isArray(lijst) ? lijst : []) if (SPECIALE_POOL.includes(n) && !uit.includes(n) && uit.length < 8) uit.push(n);
  for (const n of STANDAARD_SPECIAAL) if (uit.length < 8 && !uit.includes(n)) uit.push(n);
  return uit;
}

/** Alle 16 pads van de padstand gebaren (pad 1 = index 0). */
export const padGebaren = (speciaal) => [...VAST, ...specialeVan(speciaal)];
