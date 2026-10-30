/**
 * Processen: één knop, en de opstelling verandert over MINUTEN. Je weet WAT een proces doet (groeien,
 * vervallen, zwerven …), maar HOE het over vijf minuten klinkt volgt uit het zaad en uit wat jij intussen
 * doet. Clay, 30 okt: "ik kan alleen 1 knop in het begin doen en daardoor totaal niet meer weten hoe het over
 * 5 minuten zal klinken ondanks dat ik wel weet wat het doet."
 *
 * Puur: `stand(proces, p, tel, zaad)` geeft voor voortgang p (0..1, of doorlopend bij een eindeloos proces)
 * wat het proces op dit moment wil:
 *   { macros: { <rol>: offset −1..1 }, rij: 1..5 | null, gebaren: { <naam>: 0..1 }, muteer: bool }
 * De engine (acties-opstelling.js) telt de offsets op bij wat jij zet (zoals de drift), zet de partituur op de
 * maat en speelt de gebaren mee. Meerdere processen tegelijk tellen op. Toeval alleen uit het zaad.
 */
import { stroom } from './zaad.js';

export const STANDAARD_MATEN = 64;      // ± 2 minuten op 124 BPM; SHIFT = de helft, lang vasthouden = het dubbele
const glad = (x) => { const v = Math.min(1, Math.max(0, x)); return v * v * (3 - 2 * v); };
/** Gladde ruis −1..1 over de tel (twee punten per `per` tellen), herhaalbaar per zaad en tag. */
function ruis(zaad, tag, tel, per) {
  const x = tel / per, i = Math.floor(x), f = glad(x - i);
  const a = stroom(zaad, 'proces', tag, i).r() * 2 - 1, b = stroom(zaad, 'proces', tag, i + 1).r() * 2 - 1;
  return a + (b - a) * f;
}

/** De processen, in de volgorde van de pads (1–8). `eindeloos`: loopt tot je hem stopt (p loopt rond). */
export const PROCESSEN = Object.freeze([
  { id: 'groei', naam: 'groei', uitleg: 'van kaal naar vol: sporen erbij, dichter, droger, feller' },
  { id: 'verval', naam: 'verval', uitleg: 'alles vergaat langzaam: dunner, doffer, meer ruimte, tot korrels' },
  { id: 'zwerven', naam: 'zwerven', uitleg: 'de knoppen dwalen ver weg en komen terug, nooit hetzelfde', eindeloos: true },
  { id: 'ademen', naam: 'ademen', uitleg: 'trage golven in dichtheid, licht en ruimte', eindeloos: true },
  { id: 'storm', naam: 'storm', uitleg: 'spanning bouwt op, stotteren aan het eind, dan een breuk', },
  { id: 'oplossen', naam: 'oplossen', uitleg: 'het geluid valt uiteen in korrels en bevriest tot een wolk' },
  { id: 'thuis', naam: 'naar huis', uitleg: 'alles glijdt terug naar het begin van het recept, rij 3' },
  { id: 'evolutie', naam: 'evolutie', uitleg: 'elke 8 maten een mutatie: de opstelling verandert zelf', eindeloos: true },
]);
export const procesVan = (id) => PROCESSEN.find((p) => p.id === id) ?? null;

/**
 * @param id    het proces
 * @param p     voortgang 0..1 (een eindeloos proces: maakt niet uit, het leest `tel`)
 * @param tel   de maatklok (tellen), voor wat golft of dwaalt
 * @param zaad  het zaad van de opstelling + het nummer van deze start
 * @param maten de duur in maten (voor een eindeloos proces: de periode)
 */
export function stand(id, p, tel, zaad, maten = STANDAARD_MATEN) {
  const per = Math.max(4, maten * 4);
  const uit = { macros: {}, rij: null, gebaren: {}, muteer: false };
  switch (id) {
    case 'groei': {
      const g = glad(p);
      Object.assign(uit.macros, { dichtheid: -0.5 + g, schaal: 0.25 - 0.5 * g, ruimte: 0.25 - 0.45 * g, helderheid: -0.3 + 0.6 * g });
      uit.rij = 1 + Math.min(4, Math.floor(g * 5));
      break;
    }
    case 'verval': {
      const g = glad(p);
      Object.assign(uit.macros, { dichtheid: -0.95 * g, schaal: 0.45 * g, ruimte: 0.55 * g, helderheid: -0.5 * g, beweging: -0.3 * g });
      uit.rij = 5 - Math.min(4, Math.floor(g * 5));
      if (g > 0.55) uit.gebaren.korrel = Math.min(1, (g - 0.55) * 2.2);
      break;
    }
    case 'zwerven': {
      for (const rol of ['schaal', 'dichtheid', 'beweging', 'vervorming', 'kleur', 'ruimte']) uit.macros[rol] = 0.4 * ruis(zaad, rol, tel, per / 4);
      break;
    }
    case 'ademen': {
      const a = Math.sin((2 * Math.PI * tel) / per);
      const b = Math.sin((2 * Math.PI * tel) / (per * 1.618) + 1.3);
      Object.assign(uit.macros, { dichtheid: 0.35 * a, helderheid: 0.3 * b, ruimte: -0.25 * a });
      break;
    }
    case 'storm': {
      const g = glad(p);
      Object.assign(uit.macros, { vervorming: 0.7 * g, beweging: 0.6 * g, dichtheid: 0.3 * g, ruimte: -0.2 * g });
      uit.rij = g > 0.4 ? 5 : 4;
      // De laatste 12%: stotteren dat steeds korter wordt; daarna (p ≥ 1) een breuk.
      if (p > 0.88 && p < 1) uit.gebaren.stotter = Math.min(1, (p - 0.88) * 8.5);
      if (p >= 0.995) uit.gebaren.breuk = 1;
      break;
    }
    case 'oplossen': {
      const g = glad(p);
      uit.gebaren['alles.korrel'] = Math.min(1, g * 1.25);
      if (g > 0.7) uit.gebaren.korrelvast = Math.min(1, (g - 0.7) * 3.3);
      Object.assign(uit.macros, { ruimte: 0.4 * g, dichtheid: -0.3 * g });
      break;
    }
    case 'thuis':
      uit.rij = 3;
      uit.terug = glad(p);      // 0..1: hoe ver de macro's al terug zijn bij hun beginstand
      break;
    case 'evolutie':
      uit.muteer = true;        // de engine muteert elke 8 maten zolang dit loopt
      break;
    default:
      break;
  }
  return uit;
}
