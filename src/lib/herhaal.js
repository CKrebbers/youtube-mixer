/**
 * Opnieuw proberen zolang de server even weg is (docs/WINST.md punt 3).
 *
 * Voor wat de browser stuk voor stuk naar de server schrijft en dat op zijn
 * PLEK zet (de opname met `?frame=N`, de video met `?van=N`, het
 * handelingenlog met `van`): herhalen schrijft dan dezelfde bytes op dezelfde
 * plek, dus opnieuw proberen is altijd veilig.
 *
 * Drie soorten mislukken, drie regels:
 *   - geen antwoord (geen verbinding, een time-out, of een 5xx van een proxy
 *     zoals `tailscale serve`): de server is weg of herstart. Opnieuw, met een
 *     pauze die oploopt van WACHT_MIN tot WACHT_MAX, zolang `mag()` ja zegt;
 *   - de server zegt nee (4xx): hooguit AFGEWEZEN_MAX keer, zoals vroeger;
 *   - de schijf is vol (`vol` in het antwoord): meteen opgeven.
 *
 * Geen DOM, geen timers van zichzelf: `wacht` en `mag` komen van de aanroeper
 * (de tests geven een nep-klok).
 */

/** De pauze tussen twee pogingen loopt op van WACHT_MIN tot WACHT_MAX (ms), en begint na een antwoord weer klein. */
export const WACHT_MIN = 250, WACHT_MAX = 2000;
/** Eén verzoek dat zo lang (ms) niets terugzegt, telt als mislukt (een server die hangt). */
export const VERZOEK_MS = 10_000;
/** Een antwoord dat zegt "nee" (4xx, geen volle schijf): zo vaak proberen, zoals vroeger. */
export const AFGEWEZEN_MAX = 3;

/** Antwoordt de server niet (geen verbinding, of een 5xx van een proxy ervoor)? Dan heeft opnieuw proberen zin. */
export const isWeg = (res) => !res || res.status >= 500;

/** Een AbortSignal dat na `ms` afgaat (of niets, als de omgeving het niet kent). */
export const tijdslot = (ms = VERZOEK_MS) => (typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);

/** De gedeelde stand van één schrijver: de volgende pauze, en of de laatste poging op een time-out liep. */
export const nieuweToestand = () => ({ uitstel: WACHT_MIN, hangt: false });

/**
 * Eén verzoek, herhaald volgens de regels hierboven.
 * @param doe    () => Promise<Response>
 * @param mag    () => boolean: mag er nog een poging na deze?
 * @param wacht  (ms) => Promise
 * @param t      nieuweToestand(): de pauze loopt op over stukken heen, en begint na een antwoord opnieuw
 * @param bijWeg (fout) => void, na elke poging zonder antwoord (voor de melding)
 * @returns {Promise<{ ok: true, res } | { ok: false, fout, vol?: true, weg: boolean }>}
 *          `weg`: de laatste poging kreeg geen antwoord. Het antwoord van een
 *          gelukte poging is nog NIET gelezen: dat doet de aanroeper (leesWeg).
 */
export async function herhaal({ doe, mag, wacht, t, bijWeg = () => {} }) {
  let fout = null, afgewezen = 0;
  for (;;) {
    let weg = true;
    try {
      const res = await doe();
      t.hangt = false;
      if (res.ok) { t.uitstel = WACHT_MIN; return { ok: true, res }; }
      const j = await res.json().catch(() => ({}));
      fout = j.fout || `${res.status}`;
      if (j.vol) return { ok: false, fout, vol: true, weg: false };   // opnieuw proberen helpt niet bij een volle schijf
      weg = isWeg(res);
      if (!weg && ++afgewezen >= AFGEWEZEN_MAX) return { ok: false, fout, weg: false };
    } catch (err) {
      // Een time-out (de server hangt) onthouden: na de grens bij stoppen proberen we dan niet meer per stuk.
      t.hangt = err?.name === 'TimeoutError';
      fout = t.hangt ? 'de server antwoordt niet (time-out)' : (err?.message || String(err));
    }
    if (!mag()) return { ok: false, fout, weg };
    if (weg) bijWeg(fout);
    let ms = 250 * afgewezen;
    if (weg) { ms = t.uitstel; t.uitstel = Math.min(WACHT_MAX, ms * 2); }
    await wacht(ms);
  }
}
