import { OVERGANGEN, fragment, planMoment, kenmerken, kiesOvergang, camelotAfstand, tempoAfwijking, overgangSec } from '../auto/planner.js';
import { camelot, kortNaam } from '../engine/toonsoort.js';

/**
 * Wat een plan wordt: per stap het fragment, toon en tempo, de overgang die de
 * app ECHT zal kiezen (de bewakers van planner.js, droog gedraaid), en waar hij
 * in de set valt. Puur. Voor de planpagina (en voor Claude, om een plan door te
 * rekenen voordat het klinkt). docs/PLAN.md.
 *
 * De tijden zijn een verwachting op tempo 1: een blend synct (dan loopt de
 * nieuwe op het tempo van de oude), Clay grijpt in, "langer" schuift alles op.
 * Live corrigeert de pagina met wat er echt gebeurt (automaat.geschiedenis).
 *
 * Secties (docs/SECTIES.md): met `secties` (Map id → sectiekaart, zoals
 * GET /api/library/<id>/secties hem geeft) gaan de stukken van de kaart en de
 * gekozen `in`/`uit` van de stap naar de planner. Het CONTRACT met de planner
 * (src/auto/planner.js):
 *   fragment(track, { van, speelduur, rnd, secties, inSectie })
 *   planMoment({ …, secties, uitSectie })   secties = de stukken van de UITGAANDE
 * Een planner die ze (nog) niet kent negeert ze. Heeft de uitgaande stap een
 * `uit`, dan volgt de voorspelling het moment van de planner (daar begint de
 * overgang, en de uitgaande is klaar aan het eind ervan); zonder `uit` de
 * schatting van altijd (de overgang eindigt op het eind van het stuk), zodat
 * een plan zonder secties precies zo voorspeld wordt als voorheen. Het moment
 * staat altijd in `moment` (tracktijd van de uitgaande), of null.
 *
 * @param plan    genormaliseerd (plan-model.js)
 * @param tracks  Map id → library-nummer
 * @param secties Map id → sectiekaart ({ stukken }) of null; een id zonder kaart = geen secties
 * @param planner { fragment?, planMoment? }: alleen voor de tests (een spion); standaard planner.js
 * @returns { stappen: [...], totaal }
 */
export function voorspel(plan, tracks, { secties = null, planner = null } = {}) {
  const P = { fragment: planner?.fragment ?? fragment, planMoment: planner?.planMoment ?? planMoment };
  const stukkenVan = (id) => { const st = secties?.get?.(id)?.stukken; return Array.isArray(st) && st.length ? st : null; };
  const uit = [];
  let vorige = null;          // { track, stap, regel, stukken, f, k (kenmerken op het eind), start, duur }
  for (const s of plan.stappen) {
    const track = tracks.get(s.track) || null;
    if (!track) {
      uit.push({ id: s.id, ontbreekt: true, stap: s, titel: s.track, start: vorige ? vorige.start + vorige.duur : 0, duur: 0 });
      continue;
    }
    const stukken = stukkenVan(s.track);
    const f = P.fragment(track, { van: s.van, speelduur: s.speelduur, rnd: () => 0.5, secties: stukken, inSectie: s.in ?? null });
    const kin = kenmerken(track, f.van);
    const duur = Math.max(0, f.tot - f.van);
    const regel = {
      id: s.id, stap: s, titel: track.titel || s.track, duurNummer: track.duur ?? null,
      van: f.van, tot: f.tot, duur, vanGekozen: s.van === null, duurGekozen: s.speelduur === null,
      bpm: kin.bpm, gridZeker: kin.gridZeker, k: kin.k, toonZeker: kin.toonZeker,
      toon: kortNaam(kin.k), camelot: camelot(kin.k), secties: stukken,
      overgang: null, afstand: null, tempo: null, start: 0, overlap: 0, moment: null,
    };
    if (vorige) {
      // De uitgaande op het mengpunt: zo ver vóór zijn eind als de overgang lang is.
      const bpmUit = vorige.k.bpm;
      const secGuess = overgangSec({ type: s.overgang === 'auto' ? 'ambient' : s.overgang, lengte: s.lengte, bpm: bpmUit });
      const kUit = kenmerken(vorige.track, Math.max(vorige.f.van, vorige.f.tot - secGuess));
      const o = kiesOvergang(kUit, kin, { voorkeur: s.overgang });
      let sec = overgangSec({ type: o.type, lengte: s.lengte, bpm: o.type === 'ambient' ? null : kUit.bpm });
      // Het moment zoals de automaat het plant, op tempo 1 vanaf het begin van de uitgaande.
      const moment = momentVan(P.planMoment, { type: o.type, grid: o.type === 'ambient' ? null : kUit.grid,
        positie: vorige.f.van, eind: vorige.f.tot, rate: 1, vooruit: 0, lengte: s.lengte,
        secties: vorige.stukken, uitSectie: vorige.stap.uit ?? null });
      regel.moment = moment;
      if (moment && vorige.stap.uit) {
        // Uit gekozen: de overgang begint op het moment van de planner, en de
        // uitgaande is klaar aan het eind ervan (niet aan het eind van zijn stuk).
        const eindUit = Math.max(vorige.f.van, Math.min(vorige.track.duur ?? Infinity, moment.start + moment.lengte));
        vorige.duur = eindUit - vorige.f.van;
        vorige.regel.tot = eindUit;
        vorige.regel.duur = vorige.duur;
        sec = moment.lengte;
      }
      // Blend en beatloos: de nieuwe begint aan het begin van de overgang.
      // Filter: de nieuwe valt in op het eind, de overgang zit in de oude.
      const overlap = o.type === 'filter' ? 0 : Math.min(sec, vorige.duur, duur);
      regel.overgang = { gevraagd: s.overgang, gekozen: o.type, naam: o.naam, redenen: o.redenen,
        afgewezen: s.overgang !== 'auto' && s.overgang !== o.type, sec };
      regel.afstand = kUit.toonZeker && kin.toonZeker ? camelotAfstand(kUit.k, kin.k) : null;
      regel.tempo = tempoAfwijking(kUit.bpm, kin.bpm);
      regel.overlap = overlap;
      regel.start = vorige.start + vorige.duur - overlap;
    }
    uit.push(regel);
    vorige = { track, stap: s, regel, stukken, f, k: kin, start: regel.start, duur };
    // Het eind van deze stap is waar de volgende gemengd wordt: kenmerken daar.
    vorige.k = kenmerken(track, Math.max(f.van, f.tot - 1));
  }
  const laatste = uit[uit.length - 1];
  return { stappen: uit, totaal: laatste ? laatste.start + laatste.duur : 0 };
}

/** planMoment veilig: een planner die gooit of onzin geeft, geeft geen moment (dan de oude schatting). */
function momentVan(planMoment, opties) {
  try {
    const m = planMoment(opties);
    return m && Number.isFinite(m.start) && Number.isFinite(m.lengte) && m.lengte >= 0 ? m : null;
  } catch (_) { return null; }
}

/** Kleur van een toonstap: 'goed' (0–1), 'let' (2), 'botst' (≥ 3), null (onbekend). */
export const toonKleur = (afstand) => (afstand === null ? null : afstand <= 1 ? 'goed' : afstand === 2 ? 'let' : 'botst');

export { OVERGANGEN };
