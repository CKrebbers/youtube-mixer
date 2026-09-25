import { Emitter } from '../lib/emitter.js';

/**
 * Mapjes (lagen): dezelfde fysieke knoppen doen iets anders naargelang het
 * mapje dat open staat. Er zijn meer functies dan knoppen op een controller;
 * zo passen ze toch, zonder dat je hoeft te zoeken.
 *
 * Twee groepen, elk met één actief mapje (herzien 23 september 2026 na het
 * onderzoek in docs/APC40-onderzoek.md: de kern — fader, play/cue, filter,
 * EQ — zit NOOIT in een mapje; alleen wat je niet bij elke overgang nodig hebt):
 *   device  de acht device knobs rechts, voor de track met focus: de strip
 *           (trim · high · mid · low / sends · fx) of het rack. Eén
 *           oplichtende knop wisselt; twee standen, niet meer. Detail View
 *           opent een derde: de gekozen VORMLAAG (Vormmachines, alleen met
 *           ?vormen=1; zonder dat staan er geen regels in en doet hij niets).
 *   grid    het 5×8-grid: hotcues · loops · sampler · video · klank, gekozen
 *           met de scene-knoppen ernaast (klank: Shift + scene 5, want scene 5
 *           zelf is "loop weg"), of rondlopend met ▲ ▼. Elk een eigen kleur.
 *           Klank (Clay 25 sep, "Voorstel A"): per kolom kill hoog · mid ·
 *           laag (vasthouden; met shift vastzetten) · rem · op de maat starten.
 *
 *   edit    de grid-modus (stap D, docs/BEATGRID.md): Shift + Metronome zet
 *           hem aan of uit. Aan = scene-knoppen, nudge, cue level en Lock
 *           bewerken het beatgrid van de focus-track; alles wat de grid-modus
 *           niet definieert (faders, play, filter, pads) doet gewoon zijn werk.
 *           Een SCHAKELAAR, geen kiesknop: drukken wisselt, vasthouden is
 *           geen gluren. Staat vooraan in GROEPEN: bij twee mapjes op
 *           dezelfde knop wint de grid-modus, want de mapping zoekt in de
 *           volgorde van `actief()`.
 *
 * Een KIESKNOP opent een mapje. Kort drukken zet het vast. Vasthouden is
 * "even gluren": laat je los, dan ben je terug waar je was. Zit er meer dan
 * één mapje onder dezelfde kiesknop (Clip/Device View: strip, dan rack), dan loopt nog
 * eens drukken erdoorheen.
 *
 * Deze laag kent geen MIDI en geen DOM. De mapping vraagt `actief()` om te
 * kiezen welke regel geldt; de action-bus drukt op de kiesknoppen.
 * Clay koos deze opzet op 23 september 2026 (VRAGEN B3).
 */

export const GLUREN = 400;   // ms: langer vasthouden = even gluren, loslaten = terug

export const GROEPEN = {
  edit: {
    naam: 'grid-modus', standaard: 'uit', schakel: true,
    knoppen: { toggle: ['aan'] },
  },
  device: {
    naam: 'device knobs', standaard: 'strip',
    knoppen: { view: ['strip', 'rack'] },
  },
  grid: {
    naam: 'grid', standaard: 'hotcues',
    knoppen: { hotcues: ['hotcues'], loops: ['loops'], sampler: ['sampler'], video: ['video'], klank: ['klank'] },
    volgorde: ['hotcues', 'loops', 'sampler', 'video', 'klank'],
  },
};

/**
 * Het mapje "vorm" (vormlagen) onder Detail View. Alleen met ?vormen=1:
 * opzetVormen() roept dit aan VÓÓR bindLagen, zodat er zonder vlag geen
 * action layer.device.detail bestaat en apc.html geen lege rij toont.
 */
export function voegVormMapjeToe() { GROEPEN.device.knoppen.detail = ['vorm']; }

/** Hoe een mapje op het scherm heet. */
export const LAAGNAAM = {
  'device.strip': 'strip (trim · high · mid · low / echo · galm · fx)', 'device.rack': 'rack (fx 1–8)',
  'device.vorm': 'vormlaag (knoppen 1–6 · dekking)',
  'edit.aan': 'grid-modus (beatgrid bewerken)', 'edit.uit': 'uit',
  'grid.hotcues': 'hotcues', 'grid.loops': 'loops', 'grid.sampler': 'sampler', 'grid.video': 'video',
  'grid.klank': 'klank (kill · rem · op de maat)',
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
    if (g.schakel) {
      // Schakelaar: bij het indrukken om, loslaten doet niets.
      if (on) this.zet(groep, this.stand[groep] === lijst[0] ? g.standaard : lijst[0]);
      return;
    }
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
