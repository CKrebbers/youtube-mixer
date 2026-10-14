// Aanhaker 'maschine' (spoor S6, docs/werkruimte/S6.md, docs/WERKRUIMTE.md D4 "S6"): de Maschine
// in de werkruimte. Alleen dit spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// Wacht op ctx.maschine (alleen met ?hub=; zonder: meteen klaar, en er wordt NIETS van de Maschine
// geladen: test/hub.test.mjs). Daarna:
//   - de adapter (maakMaschineAdapter) bij de werkruimte (src/werk/apparaten.js): een deel zet de
//     padmodus, de knoppagina, het wiel en de schermen van de Maschine;
//   - de deelnamen en het deel van nu bovenaan de schermen, de deelkleur voor de pads;
//   - de fasescoop en de getallen (src/uitlijn/reken.js) voor de focus-track, alleen als een deel ze
//     op een scherm zet (de Maschine vraagt ze dan, hooguit eens per scherm-tik);
//   - weg of terug (de nep-poort van de hub): de werkruimte kijkt of hij nog alles heeft (terugval).
// Gebeurde de werkruimte al vóór deze aanhaker (de stukken van de Maschine misten dan hun Mapping),
// dan wordt hij één keer opnieuw opgezet met hetzelfde deel.
import { registreerApparaat } from '../../werk/apparaten.js';
import { mapjesVanDeel } from '../../werk/model.js';

export default async function opzet(ctx) {
  const maschine = await ctx?.maschine;
  if (!maschine) return;
  const [{ maakMaschineAdapter }, R] = await Promise.all([import('../../control/maschine.js'), import('../../uitlijn/reken.js')]);
  const werk = ctx.werk ?? null;
  const engine = ctx.engine;

  // ---- de fasescoop en de getallen van de focus-track -------------------------------------------
  maschine.uitlijn = (id, wat = { vouw: true, getallen: true }) => {
    if (!engine || !id) return null;
    const invoer = R.invoerVanEngine(engine);
    const as = R.maakAs(invoer);
    const baan = invoer.decks.find((d) => d.id === id);
    if (!as || !baan) return null;
    // De getallen ook voor de kop van de fasescoop (bpm), maar muziek Δ alleen als het getallen-scherm hem toont.
    return { vouw: wat.vouw ? R.vouw(baan, as) : null, getallen: R.getallen(baan, as, { muziek: !!wat.getallen }) };
  };

  // ---- de adapter -------------------------------------------------------------------------------
  const adapter = maakMaschineAdapter(maschine);
  registreerApparaat('maschine-mk2', adapter);
  if (!werk) return;

  // De deelnamen bovenaan de schermen en de kleur van het deel (pads in een padmodus uit data).
  const volg = () => {
    const delen = werk.delen();
    maschine.delen = delen.length ? { labels: delen.map((d) => d.label), actief: delen.findIndex((d) => d.naam === werk.deel) } : null;
    maschine.kleur = delen.find((d) => d.naam === werk.deel)?.kleur ?? null;
  };
  werk.on('change', volg);
  volg();

  // Weg of terug: de werkruimte beslist (vereist/terugval, één melding).
  maschine.on('poort', () => werk.controleerAanwezig());

  // Stond er al een werkruimte vóór de adapter er was: zijn Maschine-regels hadden geen Mapping.
  // Eén keer opnieuw (behoudDeel: hetzelfde deel, wat er op de APC open staat blijft). Is hij nog
  // bezig met kiezen, dan ziet hij de adapter vanzelf (_zetOp draait na zijn laatste await).
  const fragmenten = werk.samenstelling?.apparaten?.['maschine-mk2']?.fragmenten ?? [];
  const mist = fragmenten.some((f) => !maschine.mapping.extra.has(f.bron));
  if (werk.naam !== 'standaard' && mist && !werk.terug && !werk._bezig) await werk.kies(werk.naam, { behoudDeel: true });
  else if (werk.deel) {
    // De werkruimte stond al, zonder Maschine-regels: alleen de mapjes van het deel van nu.
    const def = mapjesVanDeel(werk.deelDef(), 'maschine-mk2', (c) => werk.conditie(c));
    if (Object.keys(def).length) adapter.zetMapjes(def);
  }
}
