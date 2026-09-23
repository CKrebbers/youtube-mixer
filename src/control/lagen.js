import { Emitter } from '../lib/emitter.js';

/**
 * Mapjes (lagen): dezelfde fysieke knoppen doen iets anders naargelang het
 * mapje dat open staat. Er zijn meer functies dan knoppen op een controller;
 * zo passen ze toch, zonder dat je hoeft te zoeken.
 *
 * Drie groepen, elk met één actief mapje:
 *   top     de acht track knobs (bovenste rij), één per track
 *   device  de acht device knobs (rechts), voor de track met focus
 *   grid    het 5×8-grid
 *
 * Een KIESKNOP opent een mapje. Kort drukken zet het vast. Vasthouden is
 * "even gluren": laat je los, dan ben je terug waar je was. Zit er meer dan
 * één mapje onder dezelfde kiesknop (Sends: echo, dan galm), dan loopt nog
 * eens drukken erdoorheen.
 *
 * Deze laag kent geen MIDI en geen DOM. De mapping vraagt `actief()` om te
 * kiezen welke regel geldt; de action-bus drukt op de kiesknoppen.
 * Clay koos deze opzet op 23 september 2026 (VRAGEN B3).
 */

export const GLUREN = 400;   // ms: langer vasthouden = even gluren, loslaten = terug

export const GROEPEN = {
  top: {
    naam: 'track knobs', standaard: 'filter',
    knoppen: { pan: ['filter'], sends: ['echo', 'reverb'], user: ['low'] },
  },
  device: {
    naam: 'device knobs', standaard: 'rack',
    knoppen: { rack: ['rack'], strip: ['strip'], sends: ['sends'], video: ['video'] },
  },
  grid: {
    naam: 'grid', standaard: 'hotcues',
    knoppen: { hotcues: ['hotcues'], loops: ['loops'], sampler: ['sampler'], video: ['video'] },
    volgorde: ['hotcues', 'loops', 'sampler', 'video'],
  },
};

/** Hoe een mapje op het scherm heet. */
export const LAAGNAAM = {
  'top.filter': 'filter', 'top.echo': 'echo-send', 'top.reverb': 'galm-send', 'top.low': 'low (bass-swap)',
  'device.rack': 'rack', 'device.strip': 'strip (EQ, sends)', 'device.sends': 'send-bussen', 'device.video': 'video',
  'grid.hotcues': 'hotcues + sampler', 'grid.loops': 'loops', 'grid.sampler': 'sampler', 'grid.video': 'video',
};

export class Lagen extends Emitter {
  constructor({ now = () => (globalThis.performance?.now() ?? Date.now()) } = {}) {
    super();
    this.now = now;
    this.stand = Object.fromEntries(Object.entries(GROEPEN).map(([g, d]) => [g, d.standaard]));
    this.ingedrukt = {};      // groep -> { knop, vorige, t0 }
  }

  /** Alle open mapjes als 'groep.laag'. */
  actief() { return Object.entries(this.stand).map(([g, l]) => `${g}.${l}`); }

  /** Staat dit mapje (of een mapje onder deze kiesknop) open? */
  isOpen(groep, knop) { return (GROEPEN[groep]?.knoppen[knop] || []).includes(this.stand[groep]); }

  zet(groep, laag) {
    if (!GROEPEN[groep] || this.stand[groep] === laag) return;
    this.stand[groep] = laag;
    this.emit('change', { groep, laag, id: `${groep}.${laag}` });
  }

  /** Een kiesknop indrukken (on = true) of loslaten (on = false). */
  druk(groep, knop, on) {
    const g = GROEPEN[groep];
    const lijst = g?.knoppen[knop];
    if (!lijst) return;
    if (on) {
      const vorige = this.stand[groep];
      const i = lijst.indexOf(vorige);
      // Al open: het volgende mapje onder dezelfde knop (of blijven staan).
      this.zet(groep, i >= 0 ? lijst[(i + 1) % lijst.length] : lijst[0]);
      this.ingedrukt[groep] = { knop, vorige, t0: this.now(), wasOpen: i >= 0 };
    } else {
      const d = this.ingedrukt[groep];
      if (!d || d.knop !== knop) return;
      delete this.ingedrukt[groep];
      // Lang vastgehouden vanuit een ANDER mapje: dat was gluren, terug.
      if (!d.wasOpen && this.now() - d.t0 >= GLUREN) this.zet(groep, d.vorige);
    }
  }

  /** Door de mapjes van een groep bladeren (pijlen op/neer). */
  stap(groep, richting) {
    const g = GROEPEN[groep];
    const v = g?.volgorde;
    if (!v) return;
    const i = v.indexOf(this.stand[groep]);
    this.zet(groep, v[(i + richting + v.length) % v.length]);
  }
}
