/**
 * Alle acties van plak 1 op de bus. Eén definitie per actie, met de
 * trackparameter {n} (ontwerp track-B13). Waarden 0..1, triggers boolean;
 * hier wordt geschaald.
 */
import { MIN_BPM, MAX_BPM } from '../kern/klok.js';

const bpmUit01 = (v) => MIN_BPM + v * (MAX_BPM - MIN_BPM);
const bpmNaar01 = (bpm) => (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM);
const KANTEN = ['A', 'B', 'thru'];
/** Eén tik van de jog in tellen: grof en fijn (shift). */
export const JOG_TEL = 1 / 32;

export function definieerActies(engine) {
  const bus = engine.bus;
  const T = (n) => engine.track(n);

  // ---- transport ---------------------------------------------------------------
  bus.defineer({
    id: 'track.{n}.play', soort: 'trigger', label: 'play / pauze',
    doe: (v, n) => (v ? T(n).speel() : undefined),
    lees: (n) => (!T(n).geladen ? null : T(n).wacht !== null ? 1 : T(n).speelt ? 0.5 : 0),
  });
  bus.defineer({
    id: 'track.{n}.play.quant', soort: 'trigger', label: 'starten op de maat',
    doe: (v, n) => (v ? T(n).startOpDeMaat() : undefined),
    lees: (n) => (!T(n).geladen ? null : T(n).wacht !== null ? 1 : 0),
  });
  bus.defineer({
    id: 'track.{n}.seek', soort: 'waarde', label: 'plek in het nummer',
    doe: (v, n) => { const t = T(n); if (t.geladen) t.zoek(v * t.nummer.duur); },
    lees: (n) => { const t = T(n); return t.geladen ? t.plek(engine.nu()) / t.nummer.duur : null; },
  });
  bus.defineer({
    id: 'track.{n}.cue', soort: 'trigger', label: 'cue',
    doe: (v, n) => {
      const t = T(n);
      if (!v || !t.geladen) return;
      if (t.speelt) { t.zoek(t.cue); t.pauze(); } else { t.cue = t.plek(engine.nu()); }
    },
    lees: (n) => (T(n).geladen ? 0 : null),
  });

  // ---- sync en de klok ------------------------------------------------------------
  bus.defineer({
    id: 'track.{n}.sync', soort: 'trigger', label: 'sync aan/uit',
    doe: (v, n) => (v ? T(n).zetSync(!T(n).sync) : undefined),
    lees: (n) => (T(n).geladen ? (T(n).sync ? 1 : 0) : null),
  });
  bus.defineer({
    id: 'track.{n}.sync.klok', soort: 'trigger', label: 'klok naar dit nummer',
    doe: (v, n) => (v ? T(n).klokNaarMij() : undefined),
  });
  bus.defineer({
    id: 'track.{n}.pitch', soort: 'waarde', label: 'pitch',
    doe: (v, n) => T(n).zetPitch(v),
    lees: (n) => T(n).pitch,
  });
  bus.defineer({
    id: 'track.{n}.jog', soort: 'waarde', label: 'jog (0,5 = stil)',
    meta: { beginstand: false },
    doe: (v, n) => { const d = (v - 0.5) * 2; if (Math.abs(d) > 1e-6) T(n).jog(d * 8 * JOG_TEL); },
  });
  for (const [richting, naam] of [[1, 'voor'], [-1, 'terug']]) {
    bus.defineer({
      id: `track.{n}.nudge.${naam}`, soort: 'trigger', label: `nudge ${naam}`,
      meta: { beginstand: false },
      doe: (v, n) => T(n).nudge(richting, v),
    });
  }
  bus.defineer({
    id: 'klok.tempo', soort: 'waarde', label: 'tempo van de klok',
    doe: (v) => engine.zetKlokTempo(bpmUit01(v)),
    lees: () => (engine.klok.loopt ? bpmNaar01(engine.klok.bpm(engine.nu())) : null),
  });
  for (const [stap, naam] of [[0.1, 'op'], [-0.1, 'neer'], [1, 'op.grof'], [-1, 'neer.grof']]) {
    bus.defineer({
      id: `klok.tempo.${naam}`, soort: 'trigger', label: `tempo ${stap > 0 ? '+' : ''}${stap}`,
      doe: (v) => { if (v && engine.klok.loopt) engine.zetKlokTempo(engine.klok.bpm(engine.straks()) + stap); },
    });
  }
  bus.defineer({
    id: 'klok.tap', soort: 'trigger', label: 'tap tempo',
    meta: { beginstand: false },
    doe: (v) => {
      if (!v) return;
      const r = engine.tap.tap(engine.nu() * 1000);
      const bpm = r?.bpm ?? (typeof r === 'number' ? r : null);
      if (bpm) engine.zetKlokTempo(bpm);
    },
  });
  bus.defineer({
    id: 'klok.stop', soort: 'trigger', label: 'klok stoppen', meta: { gevaarlijk: true },
    doe: (v) => { if (v && !engine.tracks.some((t) => t.speelt)) engine.klok.stop(); else if (v) return { geweigerd: 'er speelt nog iets' }; },
  });

  // ---- strip ------------------------------------------------------------------------
  for (const naam of ['trim', 'laag', 'mid', 'hoog', 'filter', 'fader']) {
    bus.defineer({
      id: `track.{n}.${naam}`, soort: 'waarde', label: naam,
      doe: (v, n) => T(n).strip.zet(naam, v),
      lees: (n) => T(n).strip.lees(naam),
    });
  }
  for (const band of ['laag', 'mid', 'hoog']) {
    bus.defineer({
      id: `track.{n}.kill.${band}`, soort: 'trigger', label: `kill ${band}`,
      doe: (v, n) => { if (!v) return; const t = T(n); t.kills ??= {}; t.kills[band] = !t.kills[band]; t.strip.kill(band, t.kills[band]); },
      lees: (n) => (T(n).kills?.[band] ? 1 : 0),
    });
  }
  bus.defineer({
    id: 'track.{n}.kant', soort: 'trigger', label: 'crossfaderkant A → B → thru',
    doe: (v, n) => { if (!v) return; const t = T(n); t.kant = KANTEN[(KANTEN.indexOf(t.kant) + 1) % 3]; t.strip.kant(t.kant); },
    lees: (n) => KANTEN.indexOf(T(n).kant) / 2,
  });
  bus.defineer({ id: 'mixer.xfader', soort: 'waarde', label: 'crossfader', doe: (v) => engine.mixer.zet('xfader', v), lees: () => engine.mixer.lees('xfader') });
  bus.defineer({ id: 'mixer.master', soort: 'waarde', label: 'master', doe: (v) => engine.mixer.zet('master', v), lees: () => engine.mixer.lees('master') });

  // ---- laden (een commando, track-B05) -----------------------------------------------
  bus.defineer({
    id: 'track.{n}.laad', soort: 'commando', label: 'nummer laden',
    meta: { nummer: true },
    doe: (nummer, n) => {
      const t = T(n);
      if (t.speelt && engine.hoorbaar(n) && !nummer?.zeker) return { geweigerd: `track ${n} speelt: nog eens om te vervangen` };
      engine.laad(n, nummer);
    },
  });
}
