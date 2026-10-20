/**
 * Alle acties van plak 1 op de bus. Eén definitie per actie, met de
 * trackparameter {n} (ontwerp track-B13). Waarden 0..1, triggers boolean;
 * hier wordt geschaald.
 */
import { MIN_BPM, MAX_BPM } from '../kern/klok.js';
import { HOTCUES } from './track.js';

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
      if (t.speelt) { t.zoek(t.cue); t.pauze(); }
      else { t.cue = t.plek(engine.nu()); engine.emit('cue', { n, id: t.nummer.id, P: t.cue }); }   // het cuepunt hoort bij het nummer
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
    doe: (v) => { if (!v) return; if (engine.klokNodig()) return { geweigerd: 'er speelt of wacht nog iets op de klok' }; engine.klok.stop(); },
  });

  // ---- lus, beatjump, hotcues ---------------------------------------------------------
  bus.defineer({
    id: 'track.{n}.loop', soort: 'trigger', label: 'lus aan/uit', meta: { nummer: true },
    doe: (v, n) => (v ? T(n).lusWissel() : undefined),
    lees: (n) => (!T(n).geladen ? null : T(n).lus ? 1 : 0),
  });
  for (const [r, naam] of [[-1, 'halveer'], [1, 'verdubbel']]) {
    bus.defineer({
      id: `track.{n}.loop.${naam}`, soort: 'trigger', label: `lus ${naam}`,
      doe: (v, n) => (v ? T(n).lusLengteStap(r) : undefined),
      lees: (n) => (T(n).geladen ? 0 : null),
    });
  }
  for (const [r, naam] of [[1, 'voor'], [-1, 'terug']]) {
    bus.defineer({
      id: `track.{n}.beatjump.${naam}`, soort: 'trigger', label: `beatjump ${naam}`, meta: { nummer: true },
      doe: (v, n) => (v ? T(n).beatjump(r) : undefined),
      lees: (n) => (T(n).geladen ? 0 : null),
    });
  }
  for (let k = 1; k <= HOTCUES; k++) {
    // Lampje: null = geen nummer, 0 = leeg, 0,5 = gezet.
    bus.defineer({
      id: `track.{n}.hotcue.${k}`, soort: 'trigger', label: `hotcue ${k}`, meta: { nummer: true },
      doe: (v, n) => (v ? T(n).hotcue(k - 1) : undefined),
      lees: (n) => (!T(n).geladen ? null : T(n).hotcues[k - 1] === null ? 0 : 0.5),
    });
    bus.defineer({
      id: `track.{n}.hotcue.${k}.wis`, soort: 'trigger', label: `hotcue ${k} wissen`, meta: { nummer: true },
      doe: (v, n) => (v ? T(n).hotcueWis(k - 1) : undefined),
      lees: (n) => (!T(n).geladen ? null : T(n).hotcues[k - 1] === null ? 0 : 0.5),
    });
  }

  // ---- focus en wat de lampjes van de klok lezen -------------------------------------
  bus.defineer({
    id: 'track.{n}.focus', soort: 'trigger', label: 'focus op deze track', meta: { log: 'overslaan' },
    doe: (v, n) => { if (v) engine.zetFocus(n); },
    lees: (n) => (engine.focus === n ? 1 : 0),
  });
  // Alleen lezen (knipperen op de tel): de fase van de klok zoals je hem HOORT, 0..1 per tel en per maat.
  bus.defineer({
    id: 'klok.fase', soort: 'waarde', label: 'fase in de tel (lezen)', meta: { log: 'overslaan', beginstand: false },
    doe: () => ({ geweigerd: 'alleen lezen' }),
    lees: () => { const c = engine.hoorbareTel(); return c === null ? null : c - Math.floor(c); },
  });
  bus.defineer({
    id: 'klok.maat', soort: 'waarde', label: 'fase in de maat (lezen)', meta: { log: 'overslaan', beginstand: false },
    doe: () => ({ geweigerd: 'alleen lezen' }),
    lees: () => { const c = engine.hoorbareTel(); if (c === null) return null; const m = engine.klok.perMaat; return (c - m * Math.floor(c / m)) / m; },
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

  // ---- instrumenten (plak 5) -------------------------------------------------------------
  // Rondlopen: geen -> elk instrument -> geen. Over een spelend, hoorbaar nummer pas bij een
  // tweede druk binnen 3 s (v1, zoals laden).
  const instDruk = new Map();
  bus.defineer({
    id: 'track.{n}.inst', soort: 'trigger', label: 'instrument op deze track (rondlopen)',
    doe: (v, n) => {
      if (!v) return;
      const t = T(n), lijst = engine.instrumenten.map((d) => d.soort);
      if (!lijst.length) return { geweigerd: 'geen instrumenten' };
      const nu = engine.nu();
      if (t.speelt && engine.hoorbaar(n) && !(instDruk.get(n) > nu - 3)) { instDruk.set(n, nu); return { geweigerd: `track ${n} speelt: druk nog eens om het nummer te vervangen` }; }
      instDruk.delete(n);
      const i = t.instrument ? lijst.indexOf(t.instrument.soort) : -1;
      engine.zetInstrument(n, i + 1 < lijst.length ? lijst[i + 1] : null);
    },
    lees: (n) => (T(n).instrument ? 1 : 0),
  });
  for (let k = 1; k <= 8; k++) {
    bus.defineer({
      id: `track.{n}.inst.knop.${k}`, soort: 'waarde', label: `instrument knop ${k}`,
      doe: (v, n) => { T(n).instrument?.inst.zetParam?.(k, v); },
      lees: (n) => T(n).instrument?.inst.leesParam?.(k) ?? null,
    });
  }
  bus.defineer({
    id: 'track.{n}.inst.stil', soort: 'trigger', label: 'instrument stil (paniek)', meta: { beginstand: false },
    doe: (v, n) => { if (v) T(n).instrument?.inst.stil?.(); },
    lees: (n) => (T(n).instrument ? 0 : null),
  });

  // ---- opnemen -------------------------------------------------------------------------
  bus.defineer({
    id: 'opname', soort: 'trigger', label: 'opnemen aan/uit', meta: { log: 'overslaan', beginstand: false },
    doe: (v) => (v ? engine.opname(!engine.opnemer?.loopt) : undefined),
    lees: () => (engine.opnemer ? (engine.opnemer.loopt ? 1 : 0) : null),
  });

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
