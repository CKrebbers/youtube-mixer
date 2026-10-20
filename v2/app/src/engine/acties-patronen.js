/**
 * De patronen op de bus (plak 5): plekken starten en wisselen op de "1" van de maatklok, en stap
 * voor stap bouwen. Bewerken staat NIET in het log (de set wordt bewaard, zoals in v1: terugspelen
 * sloeg het over); starten, wisselen en stoppen wel.
 *
 *   track.{n}.patroon.1 … .5        trigger: plek kiezen; met noten: starten/wisselen/stoppen op de "1"
 *   track.{n}.patroon.stap.1 … .16  trigger: deze stap (van de pagina) aan/uit met de laatst gespeelde noot
 *   track.{n}.patroon.lengte.korter / .langer, .pagina.vorige / .volgende, .wis
 *   patronen.stop                   trigger: alles stoppen op de volgende "1"
 */
import { PLEKKEN, STAPPEN } from './patronen.js';

const BEWERK = { log: 'overslaan', beginstand: false };

export function definieerPatronen(engine) {
  const bus = engine.bus, P = engine.patronen;
  const inst = (n) => !!engine.track(n)?.instrument;
  for (let k = 1; k <= PLEKKEN; k++) {
    bus.defineer({
      id: `track.{n}.patroon.${k}`, soort: 'trigger', label: `patroon ${k}: kiezen, starten of wisselen op de 1`,
      doe: (v, n) => (v ? P.wissel(n, k) : undefined),
      lees: (n) => {
        if (!inst(n)) return null;
        const st = P.stand(n);
        if (st.speelt === k || st.wacht === k) return 1;
        return P.patroon(n, k)?.noten.length ? 0.5 : 0;
      },
    });
  }
  for (let s = 1; s <= STAPPEN; s++) {
    bus.defineer({
      id: `track.{n}.patroon.stap.${s}`, soort: 'trigger', label: `stap ${s} aan/uit`, meta: BEWERK,
      doe: (v, n) => (v ? (inst(n) ? P.wisselStap(n, s - 1) : { geweigerd: `track ${n} heeft geen instrument` }) : undefined),
      lees: (n) => (inst(n) ? P.stapStand(n, s - 1) : null),
    });
  }
  const bewerk = (id, label, fn) => bus.defineer({
    id, soort: 'trigger', label, meta: BEWERK,
    doe: (v, n) => (v ? (inst(n) ? fn(n) : { geweigerd: `track ${n} heeft geen instrument` }) : undefined),
    lees: (n) => (inst(n) ? 0 : null),
  });
  bewerk('track.{n}.patroon.lengte.korter', 'patroon korter', (n) => P.lengteStap(n, -1));
  bewerk('track.{n}.patroon.lengte.langer', 'patroon langer', (n) => P.lengteStap(n, 1));
  bewerk('track.{n}.patroon.pagina.vorige', 'vorige 16 stappen', (n) => P.paginaStap(n, -1));
  bewerk('track.{n}.patroon.pagina.volgende', 'volgende 16 stappen', (n) => P.paginaStap(n, 1));
  bewerk('track.{n}.patroon.wis', 'patroon leegmaken', (n) => P.wis(n));
  bus.defineer({
    id: 'patronen.stop', soort: 'trigger', label: 'alle patronen stoppen op de 1',
    doe: (v) => (v ? P.stopAlles() : undefined),
    lees: () => (P.speelt ? 1 : 0),
  });
}
