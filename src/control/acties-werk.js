import { define as busDefine } from './actions.js';
import { apparaten } from '../werk/apparaten.js';
import { LABEL_KLEUR, DEEL_KLEUR } from '../werk/kleuren.js';

/**
 * De actions van de werkruimte (werkruimte S3, docs/WERKRUIMTE.md D4, docs/werkruimte/S3.md).
 * Eerst define(), dan pas UI en mapping (CLAUDE.md). Alle met meta `log: 'overslaan'`:
 * het deel dat open staat is sessietoestand, en terugspelen zet nooit een indeling om
 * (zoals layer.*), en `beginstand: false`.
 *
 *   werk.deel.<naam>   dat deel (read 1 = actief, 0 = niet, null = bestaat niet in deze werkruimte)
 *   werk.deel.1–8      het deel op die plek (F1–F8, de tabs van de werk-balk)
 *   werk.deel.next/prev
 *   werk.thuis         deel = start, de standaardmapjes, gluren en vasthouden los (A9)
 *   werk.vastleggen    de open mapjes en rijen worden het deel (tweede druk binnen 3 s)
 *   werk.kies          een werkruimte kiezen, 0..1 = plek in de lijst (alleen op het scherm:
 *                      meta alleenScherm, een mapping weigert hem op een knop)
 *
 * `werk` is de Werkruimte (src/werk/werkruimte.js). `lijst()` geeft de namen van de werkruimtes
 * zoals de werk-balk ze toont (voor werk.kies).
 */
export function bindWerk(werk, { define = busDefine, lijst = () => [] } = {}) {
  const meta = (label, extra = {}) => ({ label, log: 'overslaan', beginstand: false, ...extra });
  const op = (fn) => (on) => { if (on) fn(); };

  define('werk.deel.next', 'trigger', op(() => werk.stapDeel(1, { door: door('werk.deel.next') })), meta('Werkruimte: het volgende deel'));
  define('werk.deel.prev', 'trigger', op(() => werk.stapDeel(-1, { door: door('werk.deel.prev') })), meta('Werkruimte: het vorige deel'));
  for (let nr = 1; nr <= 8; nr++) {
    define(`werk.deel.${nr}`, 'trigger', op(() => werk.kiesDeelNr(nr, { door: door(`werk.deel.${nr}`) })),
      meta(`Werkruimte: deel ${nr} (F${nr})`, { read: () => werk.deelNrStand(nr) }));
  }
  define('werk.thuis', 'trigger', op(() => werk.thuis({ door: door('werk.thuis', 'THUIS') })),
    meta('THUIS: deel = start, de standaardmapjes, gluren en vasthouden los; klank en faders blijven staan'));
  define('werk.vastleggen', 'trigger', op(() => { werk.vastleggen(); }),
    meta('Leg vast in dit deel: de open mapjes en rijen (nog eens binnen 3 s)'));
  define('werk.kies', 'value', (v) => {
    const namen = lijst();
    if (!namen.length || typeof v !== 'number' || !isFinite(v)) return;
    const naam = namen[Math.min(namen.length - 1, Math.max(0, Math.round(v * (namen.length - 1))))];
    if (naam && naam !== werk.naam) werk.kies(naam);
  }, meta('Werkruimte kiezen (alleen op het scherm, nooit op een knop)', { alleenScherm: true,
    read: () => { const namen = lijst(); const i = namen.indexOf(werk.naam); return i < 0 ? null : namen.length > 1 ? i / (namen.length - 1) : 0; } }));

  // werk.deel.<naam> voor de acht vaste namen (A3, ook zonder werkruimte: een log dat ze noemt
  // speelt dan netjes terug zonder ze uit te voeren) en elk deel dat een werkruimte erbij noemt.
  // Een action gaat nooit van de bus af (een deel dat er niet is: read null, drukken = een melding).
  const al = new Set();
  const LABELS = Object.fromEntries(Object.entries(DEEL_KLEUR).map(([n, k]) => [n, Object.keys(LABEL_KLEUR).find((l) => LABEL_KLEUR[l] === k) ?? n.toUpperCase()]));
  const perNaam = () => {
    for (const { naam, label } of [...Object.keys(DEEL_KLEUR).map((naam) => ({ naam, label: LABELS[naam] })), ...werk.delen()]) {
      if (al.has(naam)) continue;
      al.add(naam);
      define(`werk.deel.${naam}`, 'trigger', op(() => werk.kiesDeel(naam, { door: door(`werk.deel.${naam}`) })),
        meta(`Werkruimte: deel ${label}`, { read: () => werk.deelStand(naam) }));
    }
  };
  perNaam();
  werk.on('change', perNaam);
  return { perNaam };
}

/**
 * Wie het koos (A5: "F3 · Maschine"): de knop die nu vastzit op een apparaat en deze action
 * indrukte (mapping.vast wordt gezet vóór de action loopt), anders het scherm. Klein: vast
 * bevat alleen wat je nu vasthoudt.
 */
export function door(action, anders = 'scherm') {
  for (const [id, a] of apparaten()) {
    const v = a.mapping?.vast;
    if (!v?.size) continue;
    for (const [sig, x] of v) if (x.target === action) return `${x.rule?.label ?? sig} · ${a.naam ?? id}`;
  }
  return anders;
}
