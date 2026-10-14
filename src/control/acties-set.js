/**
 * De actions van spoor S9 (docs/PLAN-SET.md §7): een set live spelen. Alles op de bus, dus ook
 * vanaf de APC, de Maschine en de iPad (via de schrijfweg van S8, alleen als `mag` ze noemt);
 * Clay verdeelt de knoppen zelf, geen mapping verandert.
 *
 * `log: 'overslaan'`: terugspelen herhaalt de GEVOLGEN (wat de automaat over de bus stuurde: sync,
 * op de maat, faders), niet de knop zelf. Anders zou een log de automaat opnieuw laten beslissen.
 *
 * Geen DOM, geen fetch: `bindPlanActies` krijgt de automaat en `define` van de bus. De set-actions
 * (bewaren, terugladen) staan in src/ui/sets.js, die ook de server kent.
 */
const OVERSLAAN = { log: 'overslaan', beginstand: false };

export function bindPlanActies({ auto, define }) {
  const zeg = (tekst) => auto.emit?.('melding', { tekst, soort: 'info' });
  const kan = (doe) => (on) => {
    if (!on) return;
    if (!auto.aan) { zeg('staat uit — zet hem eerst aan (knop "uit/aan" in de AUTO-rij)'); return; }
    doe();
  };
  const goWacht = () => !!auto.volgende?.goWacht && !auto.volgende?.goGegeven;
  define('plan.go', 'trigger', kan(() => auto.go()), {
    label: 'Set: GO — de klaarstaande overgang nu',
    // 1 = een stap wacht op GO (fel), 0,5 = er staat iets klaar, null = niets.
    read: () => (!auto.aan || !auto.volgende || auto.fase !== 'klaar' ? null : goWacht() ? 1 : 0.5), ...OVERSLAAN });
  define('plan.buiten', 'trigger', kan(() => auto.buiten()), {
    label: 'Set: buiten het plan (de automaat laat los) / terug',
    read: () => (!auto.aan ? null : auto.buitenPlan || auto.fase === 'buiten' ? 1 : 0), ...OVERSLAAN });
  define('plan.terug', 'trigger', kan(() => auto.terug()), {
    label: 'Set: terug naar het plan (wat nu klinkt wordt de hoofdtrack)',
    read: () => (!auto.aan ? null : auto.buitenPlan || auto.fase === 'buiten' ? 1 : 0), ...OVERSLAAN });
  const laag = () => auto.lagen?.find((l) => ['wacht', 'klaar', 'laden'].includes(l.status));
  define('plan.laag.nu', 'trigger', kan(() => auto.laagNu()), {
    label: 'Set: de volgende laag nu starten',
    read: () => (!auto.aan || !laag() ? null : laag().status === 'klaar' ? 1 : 0.5), ...OVERSLAAN });
  define('plan.laag.skip', 'trigger', kan(() => auto.laagSkip()), {
    label: 'Set: de volgende laag overslaan',
    read: () => (!auto.aan || !laag() ? null : 0), ...OVERSLAAN });
}
