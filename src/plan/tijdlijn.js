import { OVERGANGEN, fragment, planMoment, momentArgs, sectiesVan, kenmerken, kiesOvergang, camelotAfstand, tempoAfwijking, overgangSec } from '../auto/planner.js';
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
 * Elke overgang rekent zoals de automaat (_overgangVoor, docs/AUTO-DJ.md §3b):
 * de soort met de bewakers op het eind van het stuk van de uitgaande, en het
 * moment met planMoment(momentArgs({ … })): dezelfde argumenten, dus ook
 * `zeker` op het grid van de uitgaande (ook bij beatloos) en `mag` (de
 * bewakers op elk sectiebegin). De overgang begint op dat moment en de
 * uitgaande is klaar aan het eind ervan; de nieuwe begint aan het begin van
 * de overgang (blend, beatloos) of aan het eind (filter). Zonder secties is
 * dat het moment op de frasegrens (blend: de laatste 16-maatsgrens die nog
 * past), niet meer "de overgang eindigt op het eind van het stuk".
 * Verschil met de automaat: die plant vanaf waar de uitgaande dan is; hier
 * vanaf het begin van zijn stuk (positie = van, vooruit 0).
 *
 * Secties: met `secties` (Map id → sectiekaart, zoals GET
 * /api/library/<id>/secties hem geeft) gaan de stukken van de kaart (alleen
 * een kaart op het grid, sectiesVan) en de gekozen `in`/`uit` naar de planner:
 *   fragment(track, { van, speelduur, rnd, secties, inSectie })
 *   planMoment(momentArgs({ …, kaart: die van de UITGAANDE, uitSectie }))
 * Het moment staat per stap in `moment` (tracktijd van de uitgaande, met
 * `sectie` als hij op een sectie begint), of null.
 *
 * @param plan    genormaliseerd (plan-model.js)
 * @param tracks  Map id → library-nummer
 * @param secties Map id → sectiekaart ({ stukken, opGrid, … }) of null; een id zonder kaart = geen secties
 * @param planner { fragment?, planMoment? }: alleen voor de tests (een spion); standaard planner.js
 * @returns { stappen: [...], totaal }
 */
export function voorspel(plan, tracks, { secties = null, planner = null } = {}) {
  const P = { fragment: planner?.fragment ?? fragment, planMoment: planner?.planMoment ?? planMoment };
  const kaartVan = (id) => secties?.get?.(id) ?? null;
  // Voor het venster (banden, keuzelijsten): de stukken zoals ze zijn. Voor de planner: sectiesVan.
  const stukkenVan = (id) => { const st = kaartVan(id)?.stukken; return Array.isArray(st) && st.length ? st : null; };
  const uit = [];
  let vorige = null;          // { track, stap, regel, f, start, duur }
  for (const s of plan.stappen) {
    const track = tracks.get(s.track) || null;
    if (!track) {
      uit.push({ id: s.id, ontbreekt: true, stap: s, titel: s.track, start: vorige ? vorige.start + vorige.duur : 0, duur: 0 });
      continue;
    }
    const f = P.fragment(track, { van: s.van, speelduur: s.speelduur, rnd: () => 0.5, secties: sectiesVan(kaartVan(s.track)), inSectie: s.in ?? null });
    const kin = kenmerken(track, f.van);
    const duur = Math.max(0, f.tot - f.van);
    const regel = {
      id: s.id, stap: s, titel: track.titel || s.track, duurNummer: track.duur ?? null,
      van: f.van, tot: f.tot, duur, vanGekozen: s.van === null, duurGekozen: s.speelduur === null,
      bpm: kin.bpm, gridZeker: kin.gridZeker, k: kin.k, toonZeker: kin.toonZeker,
      toon: kortNaam(kin.k), camelot: camelot(kin.k), secties: stukkenVan(s.track),
      overgang: null, afstand: null, tempo: null, start: 0, overlap: 0, moment: null,
    };
    if (vorige) {
      // De soort: de bewakers op het eind van het stuk van de uitgaande (zoals _overgangVoor).
      const kUit = kenmerken(vorige.track, vorige.f.tot);
      const o = kiesOvergang(kUit, kin, { voorkeur: s.overgang });
      const moment = momentVan(P.planMoment, momentArgs({ type: o.type, grid: vorige.track.grid ?? null, uit: vorige.track, inn: kin,
        positie: vorige.f.van, eind: vorige.f.tot, rate: 1, vooruit: 0, lengte: s.lengte,
        kaart: kaartVan(vorige.stap.track), uitSectie: vorige.stap.uit ?? null }));
      regel.moment = moment;
      const sec = moment?.lengte ?? overgangSecVan(o.type, s.lengte, kUit.bpm);
      if (moment) {
        // De overgang begint op het moment van de planner; de uitgaande is klaar aan het eind ervan.
        const eindUit = Math.max(vorige.f.van, Math.min(vorige.track.duur ?? Infinity, moment.start + moment.lengte));
        vorige.duur = eindUit - vorige.f.van;
        vorige.regel.tot = eindUit;
        vorige.regel.duur = vorige.duur;
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
    vorige = { track, stap: s, regel, f, start: regel.start, duur };
  }
  const laatste = uit[uit.length - 1];
  return { stappen: uit, totaal: laatste ? laatste.start + laatste.duur : 0 };
}

/** Zonder moment (een planner die gooit): de lengte zoals vroeger, en de overgang eindigt op het eind van het stuk. */
function overgangSecVan(type, lengte, bpm) {
  return overgangSec({ type, lengte, bpm: type === 'ambient' ? null : bpm });
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
