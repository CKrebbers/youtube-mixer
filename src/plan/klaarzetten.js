import { normaliseerPlan } from './plan-model.js';
import { voorspel } from './tijdlijn.js';
import { fragment, kenmerken, kiesOvergang, tempoAfwijking, camelotAfstand } from '../auto/planner.js';
import { beoordeel } from '../ui/past-bij.js';

/**
 * Snel een hele set klaarzetten (docs/PLAN-SET.md §2). Puur: geen DOM, geen fetch, geen
 * toeval. Uit een lijst nummers (een krat, een selectie, een "past bij"-keten) een plan in de
 * vorm van plan-model.js, met een voorstel voor de volgorde en een lengte of eindtijd.
 *
 * Volgorde: elk nummer krijgt een ENERGIE (bpm, luidheid, de energie van de luidste sectie als er
 * een kaart is), genormaliseerd binnen de keuze. De set volgt een vorm (`boog`: rustig begin, piek
 * op 70%, iets terug; `oplopend`; `zoals`: de volgorde van de keuze). Gulzig: elke plek neemt het
 * nummer met de laagste kosten = afstand tot de vorm + de kosten van de overgang vanaf het vorige
 * (tempo, toon na de sync zoals de bewakers, en welke soort overgang de bewakers ervan maken).
 * Gelijke kosten: de volgorde van de keuze. Zo geeft dezelfde keuze altijd dezelfde set.
 */

export const VORMEN = ['boog', 'oplopend', 'zoals'];
/** Een stuk wordt nooit korter dan dit (s) als de set in een duur moet passen. */
export const MIN_STUK = 120;
/** Zoveel mag een set langer zijn dan gevraagd voor hij nummers laat vallen (s). */
const SPELING = 30;

const eindig = (x) => typeof x === 'number' && Number.isFinite(x);

/** De doelenergie op plek x (0..1) in de set. */
export function vorm(soort, x) {
  if (soort === 'oplopend') return 0.1 + 0.9 * x;
  return x <= 0.7 ? 0.15 + 0.85 * (x / 0.7) : 1 - 0.4 * ((x - 0.7) / 0.3);
}

/** De ruwe energie-kenmerken van een nummer: bpm (op een zeker grid), luidheid, sectie-energie. */
export function kenmerkenVoorEnergie(track, kaart = null) {
  const f = fragment(track, { rnd: () => 0.5 });
  const k = kenmerken(track, f.van);
  const st = Array.isArray(kaart?.stukken) ? kaart.stukken.filter((s) => eindig(s.energie)) : [];
  return {
    bpm: k.gridZeker && eindig(k.bpm) ? k.bpm : null,
    luid: eindig(track?.loudness_i) ? track.loudness_i : null,
    sectie: st.length ? Math.max(...st.map((s) => s.energie)) : null,
  };
}

/** Energie 0..1 per nummer, genormaliseerd binnen de keuze (wat ontbreekt telt als het midden). */
export function energieën(tracks, secties = null) {
  const r = tracks.map((t) => kenmerkenVoorEnergie(t, secties?.get?.(t.id) ?? null));
  const schaal = (k) => {
    const w = r.map((x) => x[k]).filter(eindig);
    const lo = Math.min(...w), hi = Math.max(...w);
    return (x) => (!eindig(x) || !(hi > lo) ? 0.5 : (x - lo) / (hi - lo));
  };
  const sb = schaal('bpm'), sl = schaal('luid'), ss = schaal('sectie');
  return r.map((x) => {
    const delen = [sb(x.bpm), sl(x.luid), ...(eindig(x.sectie) ? [ss(x.sectie)] : [])];
    return delen.reduce((a, b) => a + b, 0) / delen.length;
  });
}

/** De kenmerken die een overgang nodig heeft: aan het eind van het stuk (uit) en aan het begin (in). Eén keer per nummer. */
function randen(t) {
  const f = fragment(t, { rnd: () => 0.5 });
  return { uit: kenmerken(t, Math.max(f.van, f.tot - 30)), inn: kenmerken(t, f.van) };
}

/** Wat een overgang kost (0 = mooi) uit de randen: tempo, toon, en de soort die de bewakers kiezen. */
function kostenVan(uit, inn) {
  const o = kiesOvergang(uit, inn);
  let k = o.type === 'blend' ? 0 : o.type === 'filter' ? 0.25 : 0.5;
  const ta = tempoAfwijking(uit.bpm, inn.bpm);
  if (ta !== null) k += Math.min(1.5, ta * 10);
  const ka = Number.isInteger(uit.k) && Number.isInteger(inn.k) ? camelotAfstand(uit.k, inn.k) : null;
  if (ka !== null) k += Math.min(1.2, ka * 0.3);
  return k;
}

/** Wat een overgang van a naar b kost (0 = mooi): tempo, toon na de sync, en de soort die de bewakers kiezen. */
export function overgangsKosten(a, b) {
  return kostenVan(randen(a).uit, randen(b).inn);
}

/** Zo zwaar telt de afstand tot de vorm tegen de kosten van een overgang. */
const VORM_GEWICHT = 4;

/**
 * De volgorde (indexen in `tracks`) volgens een vorm. Eerst op energie: het k-de rustigste nummer
 * op de plek met het k-de laagste doel (zo ligt elk nummer zo dicht mogelijk bij de vorm). Dan
 * ruilen zolang het beter wordt (afstand tot de vorm × VORM_GEWICHT + de overgangen), een paar
 * rondes: twee nummers met dezelfde energie in de volgorde die mooier mixt.
 */
export function ordenen(tracks, { vorm: soort = 'boog', secties = null } = {}) {
  const n = tracks.length;
  if (soort === 'zoals' || n < 3) return tracks.map((_, i) => i);
  const e = energieën(tracks, secties);
  const doel = Array.from({ length: n }, (_, p) => vorm(soort, p / (n - 1)));
  const r = tracks.map(randen);
  const kost = tracks.map((_, a) => tracks.map((__, b) => (a === b ? 0 : kostenVan(r[a].uit, r[b].inn))));
  const opEnergie = tracks.map((_, i) => i).sort((a, b) => e[a] - e[b] || a - b);
  const opDoel = doel.map((_, p) => p).sort((a, b) => doel[a] - doel[b] || a - b);
  const plek = new Array(n);
  opDoel.forEach((p, k) => { plek[p] = opEnergie[k]; });
  const totaal = (v) => {
    let t = 0;
    for (let p = 0; p < n; p++) t += VORM_GEWICHT * Math.abs(e[v[p]] - doel[p]) + (p ? kost[v[p - 1]][v[p]] : 0);
    return t;
  };
  let beste = totaal(plek);
  for (let ronde = 0; ronde < 4; ronde++) {
    let beter = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        [plek[i], plek[j]] = [plek[j], plek[i]];
        const t = totaal(plek);
        if (t < beste - 1e-9) { beste = t; beter = true; } else [plek[i], plek[j]] = [plek[j], plek[i]];
      }
    }
    if (!beter) break;
  }
  return plek;
}

/**
 * Een "past bij"-keten vanaf een nummer: steeds het best passende volgende (past-bij.js, dezelfde
 * regels als de bewakers), tot `aantal` of tot er niets meer past. Geeft [tracks], met `start` voorop.
 */
export function pastBijKeten(start, tracks, { aantal = 12 } = {}) {
  const keten = [start];
  const gebruikt = new Set([start.id]);
  while (keten.length < aantal) {
    const a = keten[keten.length - 1];
    const fa = fragment(a, { rnd: () => 0.5 });
    const uit = kenmerken(a, Math.max(fa.van, fa.tot - 30));
    let beste = null, score = Infinity;
    for (const t of tracks) {
      if (!t?.id || gebruikt.has(t.id) || t.audio === false) continue;
      const ft = fragment(t, { rnd: () => 0.5 });
      const inn = kenmerken(t, ft.van);
      const r = uit.gridZeker && inn.gridZeker ? beoordeel(uit, inn) : null;
      // Wat niet "past" mag ook (beatloos is de hoofdroute), maar achteraan: tempo en toon zoals overgangsKosten.
      const s = r ? r.score : 100 + overgangsKosten(a, t);
      if (s < score - 1e-9) { score = s; beste = t; }
    }
    if (!beste) break;
    keten.push(beste);
    gebruikt.add(beste.id);
  }
  return keten;
}

/**
 * "23:30" (of "1:30") → seconden vanaf `nu` tot de eerstvolgende keer dat de klok dat zegt; null
 * als het geen tijd is. Een eindtijd van vóór nu is morgen (een set over middernacht).
 */
export function secondenTot(tijd, nu = new Date()) {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(tijd ?? ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const doel = new Date(nu.getTime());
  doel.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (doel.getTime() <= nu.getTime()) doel.setDate(doel.getDate() + 1);
  return Math.round((doel.getTime() - nu.getTime()) / 1000);
}

/**
 * De duur van een set: "90" = 90 minuten, "1,5" of "2u" = uren (een set van minder dan 10 minuten
 * bestaat niet, review S9 b7), "01:30" = tot half twee (een eindtijd); leeg = null; onzin = undefined.
 */
export function leesDuur(t, nu = new Date()) {
  const x = String(t ?? '').trim().toLowerCase();
  if (!x) return null;
  if (/^\d{1,2}[:.]\d{2}$/.test(x)) return secondenTot(x, nu) ?? undefined;
  const u = /^(\d+(?:[.,]\d+)?)\s*(u|uur|h)$/.exec(x);
  if (u) { const h = Number(u[1].replace(',', '.')); return h > 0 ? Math.round(h * 3600) : undefined; }
  const m = Number(x.replace(',', '.'));
  if (!(m > 0)) return undefined;
  return Math.round(m < 10 ? m * 3600 : m * 60);
}

/**
 * De set: een plan uit `tracks` (library-nummers), in een voorgestelde volgorde, passend in
 * `duur` (s, of null = zo lang als hij is).
 *
 * @param opties.vorm     'boog' | 'oplopend' | 'zoals'
 * @param opties.duur     gewenste lengte in seconden, of null
 * @param opties.secties  Map id → sectiekaart (voor de energie en de voorspelling), of null
 * @param opties.naam, opties.door, opties.tracks ({ auto } of null), opties.bron (tekst voor de uitleg)
 * @returns { plan, totaal, meldingen: [tekst] }
 */
export function maakSet(tracks, { vorm: soort = 'boog', duur = null, secties = null, naam = 'set', door = 'clay', tracks: autoTracks = null, bron = '' } = {}) {
  const meldingen = [];
  const bruikbaar = [];
  const gezien = new Set();
  for (const t of tracks || []) {
    if (!t?.id || gezien.has(t.id)) continue;
    gezien.add(t.id);
    if (t.audio === false || !(t.duur > 0)) { meldingen.push(`${t.titel || t.id}: geen audio, overgeslagen`); continue; }
    bruikbaar.push(t);
  }
  if (!VORMEN.includes(soort)) soort = 'boog';
  const volgorde = ordenen(bruikbaar, { vorm: soort, secties });
  const e = energieën(bruikbaar, secties);
  const opPlek = volgorde.map((i) => bruikbaar[i]);
  const waarom = (i) => `energie ${Math.round(e[i] * 100)}%`;
  let stappen = volgorde.map((i) => ({ track: bruikbaar[i].id, overgang: 'auto', waarom: waarom(i), door }));
  const kaart = new Map(opPlek.map((t) => [t.id, t]));
  const maak = (st) => normaliseerPlan({
    naam, door: door === 'claude' ? 'Claude' : '', tracks: autoTracks ?? undefined,
    uitleg: `${bron ? `${bron}, ` : ''}${st.length} nummers, vorm: ${soort}${duur ? `, ${Math.round(duur / 60)} min` : ''}`,
    stappen: st,
  }).plan;
  let plan = maak(stappen);
  let v = voorspel(plan, kaart, { secties });
  if (eindig(duur) && duur > 0) {
    if (v.totaal > duur + SPELING) {
      // Eerst elk stuk korter (nooit korter dan MIN_STUK, nooit langer dan het stuk zelf), een paar rondes.
      const natuurlijk = v.stappen.map((r) => r.duur);
      let f = 1;
      for (let ronde = 0; ronde < 6 && v.totaal > duur + SPELING; ronde++) {
        f *= duur / v.totaal;
        stappen = stappen.map((s, i) => ({ ...s, speelduur: Math.round(Math.max(Math.min(MIN_STUK, natuurlijk[i]), Math.min(natuurlijk[i], natuurlijk[i] * f))) }));
        plan = maak(stappen);
        v = voorspel(plan, kaart, { secties });
      }
      // Dan de laatste nummers eraf.
      let weg = 0;
      while (stappen.length > 1 && v.totaal > duur + SPELING) {
        stappen = stappen.slice(0, -1);
        weg++;
        plan = maak(stappen);
        v = voorspel(plan, kaart, { secties });
      }
      if (f < 0.999) meldingen.push(`stukken ingekort (tot ${Math.round(f * 100)}% van hun lengte, nooit korter dan ${MIN_STUK / 60} min)`);
      if (weg) meldingen.push(`${weg} ${weg === 1 ? 'nummer viel' : 'nummers vielen'} af om binnen ${Math.round(duur / 60)} min te blijven`);
    } else if (v.totaal < duur - 5 * 60) {
      meldingen.push(`de set duurt ~${Math.round(v.totaal / 60)} min, korter dan gevraagd (${Math.round(duur / 60)} min): kies meer nummers`);
    }
  }
  return { plan, totaal: v.totaal, meldingen };
}
