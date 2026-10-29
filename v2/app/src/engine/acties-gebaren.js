/**
 * Gebaren: vasthouden = iets gebeurt, loslaten = terug zoals het was. Hoe hard je drukt, zo diep
 * (de Maschine-pads met aanslag en druk, control/indeling.js gedrag 'druk'). Live het verschil
 * tussen "een knop omzetten" en "iets doen": een echo-worp, een filterzwiep, stotteren, alles even weg.
 *
 *   gebaar.<naam>          waarde 0..1  op de track met focus
 *   gebaar.alles.<naam>    waarde 0..1  op elke track die iets draagt (nummer of instrument)
 *   gebaar.breuk           waarde 0..1  alles behalve de track met focus zakt weg (een breakdown)
 *   speel.drum.{1..16}     waarde       pad k speelt drumnoot 35+k op het drumspoor, met aanslag; 0 = los
 *   speel.noot.{1..16}     waarde       pad k speelt trap k−1 van de toonladder van de opstelling, op het melodiespoor
 *
 * Een gebaar onthoudt bij het begin (0 -> >0) wat er stond, en zet het terug bij 0. Alles gaat via
 * de bus (bron 'gebaar'), dus het staat in het log zoals elke andere handeling. Noten gaan, zoals
 * altijd, NIET over het log (engine.noot; v1: anders loopt het log vol).
 */
import { kromme } from '../kern/opstelling/model.js';
import { LADDERS } from '../kern/opstelling/patroon.js';

/** Gebaren op één track: welke actie, waar hij heen gaat, met welke kromme. */
export const OP_TRACK = Object.freeze({
  echo: { actie: 'send.a', naar: 0.85, kromme: 'log', label: 'echo-worp' },
  galm: { actie: 'send.b', naar: 0.9, kromme: 'log', label: 'galm-worp' },
  dof: { actie: 'filter', naar: 0.06, kromme: 's', label: 'dof (lowpass)' },
  dun: { actie: 'filter', naar: 0.94, kromme: 's', label: 'dun (highpass)' },
  bas: { actie: 'laag', naar: 0, kromme: 'lin', label: 'zonder bas' },
  weg: { actie: 'fader', naar: 0, kromme: 'log', label: 'weg' },
  fx: { actie: 'fx.mix', naar: 1, kromme: 'lin', label: 'effect erin' },
});
/** Stotteren: hoe dieper je drukt, hoe korter de lus (tellen). */
export const STOTTER = Object.freeze([0.5, 0.25, 0.125]);
const META = { beginstand: false };
const NOOT_META = { log: 'overslaan', beginstand: false };

export function definieerGebaren(engine) {
  const bus = engine.bus;
  const T = (n) => engine.track(n);
  const draagt = (n) => !!(T(n)?.nummer || T(n)?.instrument);
  const zet = (id, v) => { try { if (bus.lees(id) === null) return; bus.doe(id, v, { bron: 'gebaar' }); } catch { /* er is niets */ } };
  const stand = new Map();   // gebaar-id -> { v, basis: Map(actie -> waarde van voor het gebaar) }

  /** Een gebaar dat waarden van tracks wegduwt en bij 0 terugzet. `doelen()` = [[actie, naar, kromme]]. */
  function gebaar(id, label, doelen) {
    bus.defineer({
      id, soort: 'waarde', label, meta: META,
      doe: (v) => {
        let st = stand.get(id);
        if (v > 0 && !st) {
          st = { v: 0, basis: new Map() };
          for (const [actie] of doelen()) { const b = bus.lees(actie); if (typeof b === 'number') st.basis.set(actie, b); }
          stand.set(id, st);
        }
        if (!st) return;
        st.v = v;
        for (const [actie, b] of st.basis) {
          const d = doelen().find((x) => x[0] === actie);
          zet(actie, v > 0 && d ? b + (d[1] - b) * kromme(d[2], v) : b);
        }
        if (v <= 0) stand.delete(id);
      },
      lees: () => stand.get(id)?.v ?? 0,
    });
  }

  for (const [naam, g] of Object.entries(OP_TRACK)) {
    gebaar(`gebaar.${naam}`, `gebaar: ${g.label} (track met focus)`, () => [[`track.${engine.focus}.${g.actie}`, g.naar, g.kromme]]);
    gebaar(`gebaar.alles.${naam}`, `gebaar: ${g.label} (alles)`, () => engine.tracks.filter((t) => draagt(t.n)).map((t) => [`track.${t.n}.${g.actie}`, g.naar, g.kromme]));
  }
  gebaar('gebaar.breuk', 'gebaar: breakdown (alles behalve de focus-track weg)', () => engine.tracks
    .filter((t) => t.n !== engine.focus && draagt(t.n)).map((t) => [`track.${t.n}.fader`, 0, 'log']));

  // Stotteren: een korte lus op het nummer met focus, korter naarmate je dieper drukt.
  let stotter = null;   // { n, lengte, lus }
  bus.defineer({
    id: 'gebaar.stotter', soort: 'waarde', label: 'gebaar: stotteren (een korte lus, dieper = korter)', meta: META,
    doe: (v) => {
      const t = T(stotter?.n ?? engine.focus);
      if (!t?.geladen) return v > 0 ? { geweigerd: 'stotteren kan alleen op een nummer' } : undefined;
      if (v > 0) {
        if (!stotter) stotter = { n: t.n, lengte: t.lusLengte, lus: !!t.lus, v };
        const l = STOTTER[Math.min(STOTTER.length - 1, Math.floor(v * STOTTER.length))];
        stotter.v = v;
        if (t.lusLengte !== l || !t.lus) {
          if (t.lus) t.lusUit();
          t.lusLengte = l;
          t.lusAan();
        }
      } else if (stotter) {
        if (t.lus) t.lusUit();
        t.lusLengte = stotter.lengte;
        if (stotter.lus) t.lusAan();
        stotter = null;
      }
      engine.emit('track', t.n);
      return undefined;
    },
    lees: () => stotter?.v ?? 0,
  });

  // ---- zelf spelen: drums en noten ------------------------------------------------------
  const opstelling = () => engine.opstelling?.huidige?.() ?? null;
  const drumSpoor = () => {
    const o = opstelling();
    const s = o?.sporen.find((x) => x.instrument === 'drums' && T(x.n)?.instrument?.soort === 'drums');
    return s?.n ?? engine.tracks.find((t) => t.instrument?.soort === 'drums')?.n ?? null;
  };
  const melodieSpoor = () => {
    const f = T(engine.focus)?.instrument;
    if (f && f.soort !== 'drums') return engine.focus;
    const o = opstelling();
    const s = o?.sporen.find((x) => x.instrument && x.instrument !== 'drums' && T(x.n)?.instrument);
    return s?.n ?? engine.tracks.find((t) => t.instrument && t.instrument.soort !== 'drums')?.n ?? null;
  };
  const nootVan = (k) => {
    const toon = opstelling()?.toon ?? { grond: 48, ladder: 'mineur' };
    const l = LADDERS[toon.ladder] ?? LADDERS.mineur;
    const g = k - 1;
    return toon.grond + 12 + l[g % l.length] + 12 * Math.floor(g / l.length);
  };
  const ingedrukt = new Map();   // id -> { n, noot }
  const speel = (id, n, noot, v) => {
    if (v > 0) {
      if (ingedrukt.has(id)) { const o = ingedrukt.get(id); engine.noot(o.noot, 0, { n: o.n }); }
      if (n === null || !engine.noot(noot, v, { n })) return { geweigerd: 'geen instrument om op te spelen' };
      ingedrukt.set(id, { n, noot, v });
    } else {
      const o = ingedrukt.get(id);
      if (o) { engine.noot(o.noot, 0, { n: o.n }); ingedrukt.delete(id); }
    }
    return undefined;
  };
  for (let k = 1; k <= 16; k++) {
    bus.defineer({ id: `speel.drum.${k}`, soort: 'waarde', label: `drumpad ${k}`, meta: NOOT_META,
      doe: (v) => speel(`d${k}`, drumSpoor(), 35 + k, v), lees: () => (drumSpoor() === null ? null : ingedrukt.get(`d${k}`)?.v ?? 0) });
    bus.defineer({ id: `speel.noot.${k}`, soort: 'waarde', label: `noot ${k} van de toonladder`, meta: NOOT_META,
      doe: (v) => speel(`n${k}`, melodieSpoor(), nootVan(k), v), lees: () => (melodieSpoor() === null ? null : ingedrukt.get(`n${k}`)?.v ?? 0) });
  }

  return { actief: () => [...stand.keys(), ...(stotter ? ['gebaar.stotter'] : [])] };
}
