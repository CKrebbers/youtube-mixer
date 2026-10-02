import { OVERGANGEN, fragment, kenmerken, kiesOvergang, camelotAfstand, tempoAfwijking, overgangSec } from '../auto/planner.js';
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
 * @param plan    genormaliseerd (plan-model.js)
 * @param tracks  Map id → library-nummer
 * @returns { stappen: [...], totaal }
 */
export function voorspel(plan, tracks) {
  const uit = [];
  let vorige = null;          // { track, f, k (kenmerken op het eind), start, duur }
  for (const s of plan.stappen) {
    const track = tracks.get(s.track) || null;
    if (!track) {
      uit.push({ id: s.id, ontbreekt: true, stap: s, titel: s.track, start: vorige ? vorige.start + vorige.duur : 0, duur: 0 });
      continue;
    }
    const f = fragment(track, { van: s.van, speelduur: s.speelduur, rnd: () => 0.5 });
    const kin = kenmerken(track, f.van);
    const duur = Math.max(0, f.tot - f.van);
    const regel = {
      id: s.id, stap: s, titel: track.titel || s.track, duurNummer: track.duur ?? null,
      van: f.van, tot: f.tot, duur, vanGekozen: s.van === null, duurGekozen: s.speelduur === null,
      bpm: kin.bpm, gridZeker: kin.gridZeker, k: kin.k, toonZeker: kin.toonZeker,
      toon: kortNaam(kin.k), camelot: camelot(kin.k),
      overgang: null, afstand: null, tempo: null, start: 0, overlap: 0,
    };
    if (vorige) {
      // De uitgaande op het mengpunt: zo ver vóór zijn eind als de overgang lang is.
      const bpmUit = vorige.k.bpm;
      const secGuess = overgangSec({ type: s.overgang === 'auto' ? 'ambient' : s.overgang, lengte: s.lengte, bpm: bpmUit });
      const kUit = kenmerken(vorige.track, Math.max(vorige.f.van, vorige.f.tot - secGuess));
      const o = kiesOvergang(kUit, kin, { voorkeur: s.overgang });
      const sec = overgangSec({ type: o.type, lengte: s.lengte, bpm: o.type === 'ambient' ? null : kUit.bpm });
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
    vorige = { track, f, k: kin, start: regel.start, duur };
    // Het eind van deze stap is waar de volgende gemengd wordt: kenmerken daar.
    vorige.k = kenmerken(track, Math.max(f.van, f.tot - 1));
  }
  const laatste = uit[uit.length - 1];
  return { stappen: uit, totaal: laatste ? laatste.start + laatste.duur : 0 };
}

/** Kleur van een toonstap: 'goed' (0–1), 'let' (2), 'botst' (≥ 3), null (onbekend). */
export const toonKleur = (afstand) => (afstand === null ? null : afstand <= 1 ? 'goed' : afstand === 2 ? 'let' : 'botst');

export { OVERGANGEN };
