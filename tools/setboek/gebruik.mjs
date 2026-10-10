/**
 * Wat er op een avond gebruikt werd, uit de regels van een of meer
 * handelingenlogs: de meest gebruikte actions, het aantal laads en de
 * actieve minuten. Eén teller, zodat een later `tools/gebruik.mjs` (alle
 * avonden) geen tweede telregel krijgt. Puur: geen fs.
 *
 * Telregels:
 *   - een action telt bij elke regel in het log, dus een knop twee keer
 *     (indrukken en loslaten) en een fader bij elke stap (zo staat het in het log)
 *   - `track.3.fader` en `track.5.fader` tellen samen als `track.N.fader`
 *   - een actieve minuut = een minuut (op de klok) met minstens één action
 *
 * @param regels  rijen uit leesLog(): [t, id, waarde] of { t, e, ... }
 * @param offset  seconden die bij t opgeteld worden (meerdere logs op één klok)
 */
export function tellingen(regels, { top = 10, offset = 0 } = {}) {
  const per = new Map();
  const minuten = new Set();
  let acties = 0, laads = 0;
  for (const r of regels) {
    if (Array.isArray(r) && typeof r[1] === 'string') {
      acties++;
      const id = r[1].replace(/^track\.\d+\./, 'track.N.');
      per.set(id, (per.get(id) ?? 0) + 1);
      if (Number.isFinite(r[0])) minuten.add(Math.floor((r[0] + offset) / 60));
    } else if (r?.e === 'laad') laads++;
  }
  return {
    acties, laads, actieveMinuten: minuten.size,
    top: [...per].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, top).map(([id, n]) => ({ id, n })),
  };
}
