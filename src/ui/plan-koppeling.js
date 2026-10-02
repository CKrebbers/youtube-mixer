import { meld } from './meldingen.js';

/*
 * De mixer en het setplan (docs/PLAN.md):
 *   - welk plan actief is (onthouden, standaard "auto-plan");
 *   - het plan ophalen met zijn versie, voor de automaat;
 *   - elke paar seconden kijken of het plan veranderde (de planpagina sloeg op,
 *     of Claude schreef het bestand) en het dan live aan de automaat geven;
 *   - `window.varvePlan` voor het planvenster (plan.html): dat leest de
 *     automaat en de engine hier rechtstreeks, zoals het beamervenster
 *     (window.opener, zelfde thread), en stuurt knoppen over DEZE bus, zodat
 *     het ene tabblad met de APC het ene tabblad blijft;
 *   - de knop "plan" in de balk.
 */
const ACTIEF = 'varve.plan.actief';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const KIJK_MS = 3000;

export function opzetPlanKoppeling({ auto, engine, invoke, library }) {
  let naam = lees(ACTIEF) || 'auto-plan';
  let versie = null;

  async function haal() {
    const r = await fetch(`/api/plannen/${encodeURIComponent(naam)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`plan ${r.status}`);
    const d = await r.json();
    versie = d.versie;
    if (d.fouten?.length) meld(`plan "${naam}": ${d.fouten.slice(0, 2).join('; ')}`, 'info');
    return d.plan ? { plan: d.plan, versie: d.versie } : null;
  }

  /** Veranderd? Dan live naar de automaat (alleen als die aan staat; anders leest hij het bij het aanzetten). */
  async function kijk() {
    if (!auto.aan) return;
    try {
      const r = await fetch(`/api/plannen/${encodeURIComponent(naam)}`);
      if (!r.ok) return;
      const d = await r.json();
      if (d.versie && d.versie !== versie && d.plan) {
        versie = d.versie;
        auto.vervangPlan({ plan: d.plan, versie: d.versie });
        meld(`plan bijgewerkt: ${d.plan.naam}`, 'info');
      }
    } catch (_) {}
  }
  setInterval(kijk, KIJK_MS);

  /** De planpagina sloeg op: meteen, niet pas bij de volgende kijkbeurt. */
  function bewaard(plan, nieuweVersie, planNaam = naam) {
    if (planNaam !== naam) return;
    versie = nieuweVersie;
    if (auto.aan) auto.vervangPlan({ plan, versie: nieuweVersie });
  }

  /** Een ander plan actief maken (vanaf de planpagina). Staat de automaat aan, dan meteen. */
  async function gebruik(planNaam) {
    naam = planNaam;
    schrijf(ACTIEF, planNaam);
    const p = await haal().catch(() => null);
    if (auto.aan && p) auto.vervangPlan(p);
    return p;
  }

  window.varvePlan = {
    engine, auto, invoke,
    naam: () => naam,
    versie: () => versie,
    bewaard, gebruik,
    library: () => auto.tracks?.length ? auto.tracks : null,
  };

  document.getElementById('plan-btn')?.addEventListener('click', () => {
    // Dezelfde naam: een open venster komt naar voren in plaats van een tweede.
    window.open('plan.html', 'varve-plan', 'popup,width=1280,height=860');
  });

  return { haal, naam: () => naam };
}
