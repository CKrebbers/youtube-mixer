// Aanhaker 'combi' (spoor S4, docs/werkruimte/S4.md): combinaties en effecten.
// Alleen dat spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// Wat hier gebeurt (zonder werkruimte verandert er voor de knoppen niets):
// - de actions van acties-combi.js op de bus (worpen, solo, superknoppen, bus-racks);
// - {maatgever} als variabele voor elke mapping, en de condities van `als` op de
//   APC-mapping (als S3 er nog geen zette);
// - welk rack er op de echo- en galmbus zit: onthouden op naam (localStorage) en
//   bij het starten terugzetten, zoals het master-rack;
// - een stuk proberen zonder werkruimte: ?stukken=fx-matrix,mix-extra (alleen
//   deze pagina, niets bewaard); of in de console varveCombi.stuk('fx-matrix').
import { bindCombi, zetStuk, zetMaatgeverVariabele, maakAls, VOORBEELD_SUPERKNOP } from '../../control/acties-combi.js';
import { voegMapjeToe } from '../../control/lagen.js';
import { herbindLagen } from '../../control/actions.js';
import { leesWeg } from '../../lib/antwoord.js';

const busSleutel = (bus) => `varve.send.${bus.toLowerCase()}.rack`;
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

export default async function opzet(ctx) {
  const { engine, meld } = ctx;
  // Zonder engine of bus (een kale ctx, zoals in test/aanhaakpunten.test.mjs) is er niets om aan te haken.
  if (!engine || typeof ctx.define !== 'function' || typeof location === 'undefined') return;
  let sjablonen = [];
  const combi = bindCombi({
    engine, define: ctx.define, invoke: ctx.invoke, read: ctx.read, metaOf: ctx.metaOf, meld,
    // Superknop-links met {focus}, {R}/{tweede}, {speel}, {maatgever}: dezelfde variabelen als de APC-mapping.
    ...(ctx.mapping?.vars ? { vars: () => ctx.mapping.vars() } : {}),
    racks: () => sjablonen,
    onthoudBus: (bus, naam) => schrijf(busSleutel(bus), naam),
  });
  zetMaatgeverVariabele(engine);
  if (ctx.mapping && typeof ctx.mapping.als !== 'function') {
    ctx.mapping.als = maakAls(engine, { hub: !!new URLSearchParams(location.search).get('hub') });
  }
  // VOORBEELD (gooi weg of pas aan, docs/werkruimte/S4.md): super.1 = "dub". Geen knop zit erop.
  combi.zetSuperknop(1, VOORBEELD_SUPERKNOP);

  // De racks van de bussen: de kant-en-klare, en wat je de vorige keer koos.
  fetch('racks/sjablonen.json')
    .then((r) => (r.ok ? r.json() : leesWeg(r).then(() => null)))
    .then((d) => {
      sjablonen = d?.racks || [];
      for (const bus of ['A', 'B']) {
        const naam = lees(busSleutel(bus));
        if (naam && !combi.zetBusRack(bus, naam)) meld(`${bus === 'A' ? 'echo' : 'galm'}-bus: rack "${naam}" bestaat niet meer`, 'info');
      }
    })
    .catch((err) => console.warn('[combi] sjablonen niet geladen:', err.message));

  const stuk = async (naam) => {
    if (!/^[a-z0-9-]{1,60}$/.test(naam)) throw new Error(`stuk "${naam}": geen geldige naam`);
    const r = await fetch(`mappings/stukken/${naam}.json`);
    if (!r.ok) { await leesWeg(r); throw new Error(`stuk "${naam}" niet gevonden (${r.status})`); }
    const uit = zetStuk(await r.json(), { mapping: ctx.mapping, voegMapjeToe, herbind: herbindLagen });
    if (uit.fouten.length) meld(`stuk ${naam}: ${uit.fouten.join('; ')}`, 'fout');
    return uit;
  };
  const gevraagd = (new URLSearchParams(location.search).get('stukken') || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const naam of gevraagd) {
    // Staat het stuk er al (de werkruimte noemt het, S3), dan niet nog eens: zijn mapje "bestaat al".
    if (ctx.mapping?.extra?.has?.(`stuk:${naam}`)) { meld(`stuk ${naam}: staat er al (uit de werkruimte)`, 'info'); continue; }
    try { const u = await stuk(naam); meld(`stuk ${naam}: ${u.aantal} regels erbij (alleen deze pagina)`, 'info'); }
    catch (err) { meld(err.message, 'fout'); }
  }

  window.varveCombi = { ...combi, stuk };
}
