/**
 * De live-stand van een set (docs/PLAN-SET.md §4): NU / VOLGENDE / DAARNA, de volgende laag, GO
 * en de verwachte eindtijd. Puur: uit automaat.stand(), het plan en de voorspelling (tijdlijn.js
 * voorspel). Voor de AUTO-rij, het planvenster en het vak `plan` op werk.html (mac-2, de iPad).
 *
 * De eindtijd is een VERWACHTING op de wandklok (alleen tekst): wat er nog klinkt van NU, en
 * daarna de voorspelde duur van de rest van het plan, met de overlap van de overgangen. Live
 * corrigeert hij zichzelf (de rest van NU komt van de positie van de hoofdtrack, regel 3).
 */

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);
export const mmss = (s) => (eindig(s) ? `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}` : '–');
const klok = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/**
 * @param stand        automaat.stand()
 * @param plan         het plan van de automaat (genormaliseerd) of null
 * @param voorspelling voorspel(plan, tracks) of null
 * @param titelVan     (track-id) => titel
 * @param nuMs         de wandklok (ms), voor de eindtijd
 * @returns { aan, fase, buiten, nu, volgende, daarna, laag, eind, tekst }
 */
export function liveStand({ stand, plan = null, voorspelling = null, titelVan = (id) => id, nuMs = Date.now() } = {}) {
  const s = stand || {};
  const stappen = plan?.stappen || [];
  const regels = voorspelling?.stappen || [];
  const p = s.plan || null;
  const index = Number.isInteger(p?.index) ? p.index : 0;
  // Wat komt er na de klaarstaande: de stap na de VOLGENDE (als die uit het plan komt), anders de stap op planIndex.
  const iVolg = p?.volgendeStap ? stappen.findIndex((x) => x.id === p.volgendeStap) : -1;
  const iDaarna = iVolg >= 0 ? iVolg + 1 : s.volgende ? index : index + 1;
  const daarnaStap = stappen[iDaarna] ?? null;
  const nu = s.nu ? { nr: s.nu.nr, titel: s.nu.titel, rest: s.nu.rest, stap: p?.hoofdStap ?? null } : null;
  const v = s.volgende;
  const volgende = v ? {
    nr: v.nr, titel: v.titel, soort: v.soort, bron: v.bron, maten: v.maten, over: v.over, voortgang: v.voortgang,
    go: v.go ?? null, stap: p?.volgendeStap ?? null,
  } : (stappen[index] && s.aan ? { titel: titelVan(stappen[index].track), soort: null, bron: 'plan', stap: stappen[index].id, gepland: true } : null);
  const daarna = daarnaStap ? { titel: titelVan(daarnaStap.track), stap: daarnaStap.id, go: daarnaStap.go === 'wacht' } : null;
  // De eindtijd: rest van NU, min de overlap met de stap die erna begint, plus de rest van het plan vanaf die stap.
  let eind = null;
  if (nu && eindig(nu.rest)) {
    const k = iVolg >= 0 ? iVolg : index;
    const r = regels[k];
    const rest = r && eindig(voorspelling?.totaal) ? Math.max(0, voorspelling.totaal - r.start) - (r.overlap || 0) : 0;
    const sec = nu.rest + Math.max(0, rest);
    eind = { sec, klok: klok(nuMs + sec * 1000) };
  } else if (voorspelling && eindig(voorspelling.totaal) && regels[index]) {
    const sec = Math.max(0, voorspelling.totaal - regels[index].start);
    eind = { sec, klok: klok(nuMs + sec * 1000), voorspeld: true };
  }
  const laag = s.laag ?? null;
  const tekst = {
    nu: nu ? `NU ${nu.nr ? `${nu.nr} · ` : ''}${nu.titel}${eindig(nu.rest) ? ` · nog ${mmss(nu.rest)}` : ''}` : 'NU —',
    volgende: volgende ? `VOLGENDE ${volgende.titel}${volgende.go?.wacht ? ` · wacht op GO${eindig(volgende.go.uiterlijk) ? ` (uiterlijk over ${mmss(volgende.go.uiterlijk)})` : ''}`
      : volgende.maten != null ? ` · over ${volgende.maten} maten` : eindig(volgende.over) ? ` · over ${mmss(volgende.over)}` : ''}${volgende.soort ? ` · ${volgende.soort}` : ''}` : 'VOLGENDE —',
    daarna: daarna ? `DAARNA ${daarna.titel}${daarna.go ? ' · GO' : ''}` : 'DAARNA —',
    laag: laag ? `LAAG ${laag.titel}${laag.wanneer ? ` · ${laag.wanneer}` : ''}` : '',
    eind: eind ? `klaar ~${eind.klok} (nog ${mmss(eind.sec)})` : '',
  };
  return { aan: !!s.aan, fase: s.fase ?? 'uit', buiten: !!s.buiten, nu, volgende, daarna, laag, eind, tekst };
}
