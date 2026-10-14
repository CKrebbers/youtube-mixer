import { define as busDefine, TRACKS } from './actions.js';

/**
 * Actions van spoor S10 (docs/EFFECTEN-MEER.md keuze 9): de XY-pad van een rack.
 *
 * Een sjabloon zegt welke twee knoppen samen op een XY-pad passen (`xy: [x, y]`).
 * `track.N.fx.xy.x` en `.y` sturen DIE plekken (zonder `xy`: knop 1 en 2), dus een
 * XY-pad op de iPad of een eigen paneel die naar deze actions wijst, speelt bij elk
 * rack de goede twee knoppen; een ander rack kiezen hoeft niets opnieuw te koppelen.
 * Hetzelfde voor de master (`master.fx.xy.*`).
 *
 * Niet in de beginstand van het log (`beginstand: false`): de plek zelf staat er al
 * in (`track.N.fx.knob.K`). Een draai komt wel in het log, als xy, en speelt terug op
 * de plek die het rack van dan op xy zette.
 */
export const XY_STANDAARD = [1, 2];
export const xyVan = (fx) => (Array.isArray(fx?.rack?.xy) && fx.rack.xy.length === 2 ? fx.rack.xy : XY_STANDAARD);

export function bindEffecten({ engine, define = busDefine } = {}) {
  const maak = (n, fxVan, label) => {
    ['x', 'y'].forEach((as, i) => {
      define(`${n}.fx.xy.${as}`, 'value', (v) => { const fx = fxVan(); if (fx) fx.setPlek(xyVan(fx)[i], v); },
        { label: `${label} XY-pad ${as === 'x' ? 'links–rechts' : 'onder–boven'} (de knop die het rack daarvoor kiest)`,
          bipolar: false, beginstand: false,
          read: () => { const fx = fxVan(); return fx ? fx.leesPlek(xyVan(fx)[i]) : null; } });
    });
  };
  for (const [nr, id] of TRACKS) maak(`track.${nr}`, () => engine.deck(id)?.fx ?? null, `Track ${nr} FX`);
  maak('master', () => engine.master?.fx ?? null, 'Master FX');
}
