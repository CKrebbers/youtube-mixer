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
 *           oplichtende knop wisselt; twee standen, niet meer. Heeft de
 *           focus-track een INSTRUMENT (docs/INSTRUMENTEN.md §6), dan komt er
 *           een derde bij: strip → rack → inst (de acht knoppen van het
 *           instrument). Zonder instrument blijft het strip ↔ rack. Detail View
 *           opent een derde: de gekozen VORMLAAG (Vormmachines, alleen met
 *           ?vormen=1; zonder dat staan er geen regels in en doet hij niets).
 *           Shift + Clip/Device View opent de MASTER (5 okt, docs/MASTER.md):
 *           het insert-rack op het geheel, knop 1–7 = plek 1–7, knop 8 = mix
 *           (shift + knop 8 = plek 8), Device ◀ ▶ = rack, On/Off = aan/uit.
 *           Clip/Device View zelf gaat daarna weer naar de strip.
 *   grid    het 5×8-grid: hotcues · loops · sampler · video · klank · auto ·
 *           stems · patronen, gekozen met de scene-knoppen ernaast (klank: Shift +
 *           scene 5, want scene 5 zelf is "loop weg"; auto: Shift + scene 4; stems:
 *           Shift + scene 3; patronen: Shift + scene 2), of rondlopend met ▲ ▼.
 *           Elk een eigen kleur.
 *           Klank (Clay 25 sep, "Voorstel A"): per kolom kill hoog · mid ·
 *           laag (vasthouden; met shift vastzetten) · rem · op de maat starten.
 *           Auto (2 okt, VRAGEN AU1): de auto-DJ bijsturen zonder muis, op de
 *           bovenste rij: ok · overslaan · langer · nu, en rechts aan/uit.
 *           Geen vlag zoals de vormen: de auto-DJ is er altijd, dus de regels
 *           staan in de standaardmapping (en komen zo ook op apc.html, het
 *           scherm en bij een eigen mapping als verschil vanzelf binnen).
 *           Stems (5 okt, VRAGEN N1, docs/STEMS.md §5): per kolom een stem weg
 *           zolang je drukt (shift: vastzetten), van boven naar onder zang ·
 *           rest · drums · bas · overig. Achteraan in de volgorde: wat er al
 *           was, blijft op zijn plek onder ▲ ▼.
 *           Patronen (5 okt, docs/PATRONEN.md): Shift + scene 2, of ▲ ▼ (na
 *           stems). Pad = plek (rij 1–5) op de track (kolom), zoals clips in
 *           Ableton; scene 1–5 = die rij op alle tracks; Stop All Clips = alle
 *           patronen stoppen (shift: meteen). Oranje.
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
    // inst alleen als de focus-track een instrument heeft (zie OP_AANVRAAG); master met Shift + Clip/Device View.
    knoppen: { view: ['strip', 'rack', 'inst'], master: ['master'] },
  },
  grid: {
    naam: 'grid', standaard: 'hotcues',
    knoppen: { hotcues: ['hotcues'], loops: ['loops'], sampler: ['sampler'], video: ['video'], klank: ['klank'], auto: ['auto'], stems: ['stems'], patronen: ['patronen'] },
    volgorde: ['hotcues', 'loops', 'sampler', 'video', 'klank', 'auto', 'stems', 'patronen'],
  },
};

/**
 * Het mapje "vorm" (vormlagen) onder Detail View. Alleen met ?vormen=1:
 * opzetVormen() roept dit aan VÓÓR bindLagen, zodat er zonder vlag geen
 * action layer.device.detail bestaat en apc.html geen lege rij toont.
 */
export function voegVormMapjeToe() { GROEPEN.device.knoppen.detail = ['vorm']; }

/**
 * Mapjes die alleen meedoen als ze er nu iets te doen hebben: rondlopen met
 * de kiesknop slaat ze over, tenzij `beschikbaar` (een optie van Lagen) ja
 * zegt. Het mapje inst (instrument) hoort alleen bij een track met een
 * instrument: zonder dat blijft Clip/Device View strip ↔ rack, zoals altijd.
 */
export const OP_AANVRAAG = new Set(['device.inst']);

/** Hoe een mapje op het scherm heet. */
export const LAAGNAAM = {
  'device.strip': 'strip (trim · high · mid · low / echo · galm · fx)', 'device.rack': 'rack (fx 1–8)',
  'device.inst': 'instrument (de acht knoppen van het instrument · ◀ ▶ kiezen · On/Off stil)',
  'device.vorm': 'vormlaag (knoppen 1–6 · dekking)',
  'device.master': 'master (fx 1–7 · mix; shift + 8 = fx 8)',
  'edit.aan': 'grid-modus (beatgrid bewerken)', 'edit.uit': 'uit',
  'grid.hotcues': 'hotcues', 'grid.loops': 'loops', 'grid.sampler': 'sampler', 'grid.video': 'video',
  'grid.klank': 'klank (kill · rem · op de maat)',
  'grid.auto': 'auto-dj (ok · overslaan · langer · nu · aan/uit)',
  'grid.stems': 'stems (zang · rest · drums · bas · overig weg)',
  'grid.patronen': 'patronen (pad = plek per track · scene = rij op alle tracks · shift = meteen)',
};

export class Lagen extends Emitter {
  /**
   * @param beschikbaar  (groep, laag) => boolean: doet een mapje uit OP_AANVRAAG
   *                     nu mee met rondlopen? Standaard nee (app.js: alleen
   *                     met een instrument op de focus-track).
   */
  constructor({ now = () => (globalThis.performance?.now() ?? Date.now()), beschikbaar = () => false } = {}) {
    super();
    this.now = now;
    this.beschikbaar = beschikbaar;
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
      // Al open: het volgende mapje onder dezelfde knop (of blijven staan),
      // maar niet een mapje op aanvraag dat er nu niets te doen heeft.
      const mag = (l) => !OP_AANVRAAG.has(`${groep}.${l}`) || !!this.beschikbaar(groep, l);
      let volgende = lijst[0];
      if (i >= 0) {
        for (let s = 1; s <= lijst.length; s++) { const l = lijst[(i + s) % lijst.length]; if (mag(l)) { volgende = l; break; } }
      }
      this.zet(groep, volgende);
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
