// Aanhaker 'precisie' (spoor S1, docs/werkruimte/S1.md, WERKRUIMTE.md D4).
// Alleen dat spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// 1. De actions van de precisie op de bus (bindPrecisie): altijd, ze doen niets
//    tot iemand ze aanroept (een koppeling, het toetsenbord, een paneel).
// 2. Het stuk `uitlijn` (mappings/stukken/uitlijn.json: ⇧ Lock = acht fasemeters)
//    alleen met de vlag ?uitlijn=1, zolang de werkruimte-kern (S3) de stukken nog
//    niet zelf laadt. Zo kan Clay hem los proeven; zonder vlag verandert er op de
//    APC niets. De vlag wordt onthouden (?uitlijn=0 zet hem weer uit), zoals ?vormen=1.
import { bindPrecisie } from '../../control/acties-precisie.js';
import { voegMapjeToe } from '../../control/lagen.js';
import { herbindLagen } from '../../control/actions.js';

const SLEUTEL = 'varve.uitlijn';
/** De bron van het fragment in de mapping (WERKRUIMTE.md B1: een stuk = `stuk:<naam>`). */
export const STUK_BRON = 'stuk:uitlijn';

/** Staat de vlag aan? ?uitlijn=1 / ?uitlijn=0 zetten hem (en onthouden), anders wat er onthouden is. */
export function uitlijnAan(url = globalThis.location?.href ?? 'http://x/', opslag = veiligeOpslag()) {
  const v = new URL(url).searchParams.get('uitlijn');
  try {
    if (v === '1') opslag?.setItem(SLEUTEL, '1');
    else if (v === '0') opslag?.removeItem(SLEUTEL);
    return v === '1' || (v !== '0' && opslag?.getItem(SLEUTEL) === '1');
  } catch (_) {
    return v === '1';
  }
}

function veiligeOpslag() {
  try { return globalThis.localStorage ?? null; } catch (_) { return null; }
}

/**
 * Een stuk opzetten op een APC-mapping (WERKRUIMTE.md B4): eerst de nieuwe
 * mapjes (voegMapjeToe + herbindLagen), dan de regels als fragment
 * (vervangFragment: alleen aanvullen, een eigen regel op dezelfde plek wint;
 * twee keer = één keer). Alleen de mapjes en regels van `apparaat`.
 * Geeft { mapjes, regels } (hoeveel erbij kwamen).
 */
export function zetStukOp(mapping, stuk, { apparaat = 'apc40mk2', bron = `stuk:${stuk.stuk}` } = {}) {
  let mapjes = 0;
  for (const [sleutel, m] of Object.entries(stuk.mapjes?.nieuw ?? {})) {
    const [app, groep, laag] = sleutel.split('.');
    if (app !== apparaat) continue;
    // De kiesknop is de regel layer.<groep>.<laag> in de regels hieronder.
    voegMapjeToe(groep, laag, { naam: m.naam, kleur: m.kleur, kiesknop: m.kiesknop === null ? null : laag });
    mapjes++;
  }
  if (mapjes) herbindLagen();
  const r = mapping.vervangFragment(bron, { device: apparaat, version: 3, rules: stuk.regels?.[apparaat] ?? [] });
  return { mapjes, regels: r.aantal };
}

export default async function opzet(ctx) {
  if (!ctx?.engine) return;          // zonder engine (de lege proef in aanhaakpunten.test) niets te binden
  const duwer = bindPrecisie(ctx.engine);
  // Voor de headless meting (tools/headless/precisie.mjs) en om in de console te kijken.
  globalThis.varvePrecisie = { duwer };
  if (!uitlijnAan()) return;
  // Mislukt het stuk, dan zeggen we DAT (de actions staan er al): gooien gaf de
  // melding "aanhaker precisie niet gestart", en dat klopte niet (Review ronde 1).
  let stuk;
  try {
    const res = await fetch('mappings/stukken/uitlijn.json');
    if (!res.ok) { await res.arrayBuffer().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
    stuk = await res.json();
    if (ctx.mapping) zetStukOp(ctx.mapping, stuk);
  } catch (err) {
    ctx.meld?.(`uitlijn (proef): het stuk mappings/stukken/uitlijn.json kwam niet binnen (${err?.message || err}). De precisie-actions werken wel; ⇧ Lock doet niets nieuws.`, 'fout');
    return;
  }
  ctx.meld?.('uitlijn (proef): ⇧ Lock = acht fasemeters op de device knobs (⇧ = fijn), Device ◀ ▶ = jog, On/Off = op de 1. Uit met ?uitlijn=0.', 'info');
}
