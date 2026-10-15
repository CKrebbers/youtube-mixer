import { Emitter } from '../lib/emitter.js';
import { houd as gedeeldHoud } from './houd.js';

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
 *           Shift + Detail View opent BEELD (6 okt, spoor beeld, docs/BEELD.md):
 *           de Stroommachine op de pc, knop 1–8 = de acht macro's, scene 1–5 =
 *           ontdek · volgende · vasthouden · flits · vrij, Stop All Clips =
 *           paniek. Een device-mapje en geen grid-modus: alleen de device-groep
 *           kan de device knobs wisselen (de faders zijn de kern), en een regel
 *           in een device-mapje wint ook op de scene-knoppen van elke grid-modus
 *           (de mapping zoekt edit → device → grid). Shift + scene kiest nog
 *           steeds een grid-modus; Clip/Device View gaat terug naar de strip.
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
 *           Secties (6 okt, docs/SECTIES.md): Shift + scene 1, of ▲ ▼ (na
 *           patronen). De 40 pads = de secties van de FOCUS-track op volgorde
 *           (rij 1 = 1–8, rij 2 = 9–16 …): drukken = daarheen, en hij valt in
 *           op de volgende maat; shift = die sectie als loop. Hemelsblauw.
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
 *   houd    (14 okt, werkruimte S4, docs/werkruimte/S4.md) HOUD-MAPJES: open
 *           zolang je een knop vasthoudt, meer tegelijk, gedeeld over alle
 *           apparaten. Geen stand in deze groep: het register in houd.js weet
 *           wat open is (en van welk apparaat). Leeg tot iemand er een
 *           declareert met voegMapjeToe('houd', naam, …); dan maakt
 *           herbindLagen() de knop `layer.houd.<naam>` op de bus (indrukken =
 *           open, loslaten = dicht). Een Mapping zet de open houd-mapjes vóór
 *           zijn eigen mapjes (mapping.js); actief() hieronder kent ze niet.
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
    // inst alleen als de focus-track een instrument heeft (zie OP_AANVRAAG); master met Shift + Clip/Device View;
    // beeld (de Stroommachine) met Shift + Detail View.
    knoppen: { view: ['strip', 'rack', 'inst'], master: ['master'], beeld: ['beeld'] },
  },
  grid: {
    naam: 'grid', standaard: 'hotcues',
    knoppen: { hotcues: ['hotcues'], loops: ['loops'], sampler: ['sampler'], video: ['video'], klank: ['klank'], auto: ['auto'], stems: ['stems'], patronen: ['patronen'], secties: ['secties'] },
    volgorde: ['hotcues', 'loops', 'sampler', 'video', 'klank', 'auto', 'stems', 'patronen', 'secties'],
  },
  // Houd-mapjes (S4): geen stand, geen standaard; elke kiesknop heeft precies zijn eigen mapje.
  houd: {
    naam: 'houd-mapjes', houd: true,
    knoppen: {},
  },
};

/**
 * Het mapje "vorm" (vormlagen) onder Detail View. Alleen met ?vormen=1:
 * opzetVormen() roept dit aan VÓÓR bindLagen, zodat er zonder vlag geen
 * action layer.device.detail bestaat en apc.html geen lege rij toont.
 * Sinds 14 okt (werkruimte S0) een gewone aanroep van voegMapjeToe: zelfde
 * GROEPEN, zelfde LAAGNAAM (test/aanhaakpunten.test.mjs vergelijkt ze).
 */
export function voegVormMapjeToe() {
  voegMapjeToe('device', 'vorm', { naam: LAAGNAAM['device.vorm'], kiesknop: 'detail' });
}

/**
 * Mapjes die alleen meedoen als ze er nu iets te doen hebben: rondlopen met
 * de kiesknop slaat ze over, tenzij `beschikbaar` (een optie van Lagen) ja
 * zegt. Het mapje inst (instrument) hoort alleen bij een track met een
 * instrument: zonder dat blijft Clip/Device View strip ↔ rack, zoals altijd.
 */
export const OP_AANVRAAG = new Set(['device.inst']);

/*
 * MAPJES ERBIJ, VAN BUITEN (14 okt, werkruimte S0, docs/werkruimte/S0.md).
 *
 * Een spoor (uitlijn, fx-matrix, houd-mapjes, een eigen leeg mapje) zet een
 * mapje erbij zonder dit bestand te raken: voegMapjeToe, en daarna
 * herbindLagen() uit actions.js (die maakt de layer.*-actions opnieuw). Wat
 * erbij kwam staat in TOEGEVOEGD, zodat haalMapjeWeg alleen weghaalt wat er
 * van buiten bij kwam: een standaardmapje gaat nooit weg (een werkruimte haalt
 * niets weg, WERKRUIMTE.md A12).
 *
 * Alleen in een groep die al bestaat en mapjes heeft (device, grid; edit is
 * een schakelaar): een groep erbij
 * vraagt een stand in elke Lagen, en die rekent de constructor uit.
 */

/** 'groep.laag' -> { groep, laag, kiesknop, kleur } van elk mapje dat er van buiten bij kwam. */
export const TOEGEVOEGD = new Map();

/** Kleur per mapje ('groep.laag' -> naam uit het APC-palet), alleen als hij er een kreeg. Data. */
export const MAPJE_KLEUR = {};

/** De volgorde van ▲ ▼ zoals hij hier staat; zetVolgorde(groep, null) zet hem terug. */
const STANDAARD_VOLGORDE = Object.fromEntries(Object.entries(GROEPEN).map(([g, d]) => [g, d.volgorde ? [...d.volgorde] : null]));

/** De Lagen die er zijn: een mapje dat weggaat terwijl het open staat, gaat dicht (naar de standaard). */
const ALLE_LAGEN = new Set();

/** Welke kiesknop van deze groep heeft dit mapje onder zich (of null)? */
function knopVan(groep, laag) {
  const g = GROEPEN[groep];
  for (const [knop, lijst] of Object.entries(g.knoppen)) if (lijst.includes(laag)) return knop;
  return null;
}

/** Bestaat dit mapje (onder een kiesknop, in de volgorde, de standaard, of van buiten)? */
function bestaatMapje(groep, laag) {
  const g = GROEPEN[groep];
  return !!g && (g.standaard === laag || knopVan(groep, laag) !== null || !!g.volgorde?.includes(laag)
    || TOEGEVOEGD.has(`${groep}.${laag}`));
}

/**
 * Een mapje erbij in een bestaande groep.
 *
 * @param groep      'device', 'grid' of 'edit'
 * @param laag       naam van het mapje (a-z, 0-9, -)
 * @param naam       hoe het op het scherm heet (LAAGNAAM)
 * @param kiesknop   onder welke kiesknop (layer.<groep>.<knop>); standaard het mapje zelf.
 *                   Bestaat die knop al, dan komt het mapje erachter (nog eens drukken = het
 *                   volgende). null = geen kiesknop: alleen te openen met lagen.zet (een deel).
 * @param kleur      naam uit het APC-palet (MAPJE_KLEUR), of weg
 * @param opAanvraag doet alleen mee met rondlopen als `beschikbaar` ja zegt (OP_AANVRAAG)
 *
 * Nog eens met dezelfde kiesknop = alleen naam en kleur bijwerken. Een
 * standaardmapje, of hetzelfde mapje onder een andere kiesknop: een fout.
 */
export function voegMapjeToe(groep, laag, { naam, kiesknop = laag, kleur, opAanvraag = false } = {}) {
  const g = GROEPEN[groep];
  if (!g) throw new Error(`mapje ${groep}.${laag}: de groep "${groep}" bestaat niet`);
  if (g.schakel) throw new Error(`mapje ${groep}.${laag}: ${g.naam} is een schakelaar, geen groep met mapjes`);
  // Een houd-knop opent precies zijn eigen mapje (geen rondlopen, geen gluren).
  if (g.houd && kiesknop !== laag) throw new Error(`houd-mapje ${laag}: de kiesknop is het mapje zelf (layer.houd.${laag})`);
  if (typeof laag !== 'string' || !/^[a-z0-9-]{1,32}$/.test(laag)) throw new Error(`mapje ${groep}.${laag}: geen geldige naam`);
  if (kiesknop !== null && (typeof kiesknop !== 'string' || !/^[a-z0-9-]{1,32}$/.test(kiesknop) || kiesknop === 'next' || kiesknop === 'prev')) {
    throw new Error(`mapje ${groep}.${laag}: "${kiesknop}" is geen kiesknop`);
  }
  const id = `${groep}.${laag}`;
  const was = TOEGEVOEGD.get(id);
  if (was && was.kiesknop !== kiesknop) throw new Error(`mapje ${id} staat al onder een andere kiesknop`);
  if (!was && bestaatMapje(groep, laag)) throw new Error(`mapje ${id} bestaat al`);
  if (!was && kiesknop !== null) (g.knoppen[kiesknop] ??= []).push(laag);
  TOEGEVOEGD.set(id, { groep, laag, kiesknop, kleur: kleur ?? null, naamWas: was ? was.naamWas : LAAGNAAM[id] });
  if (typeof naam === 'string') LAAGNAAM[id] = naam;
  if (typeof kleur === 'string') MAPJE_KLEUR[id] = kleur; else delete MAPJE_KLEUR[id];
  if (opAanvraag) OP_AANVRAAG.add(id); else OP_AANVRAAG.delete(id);
}

/**
 * Een mapje dat er van buiten bij kwam weer weg (een standaardmapje niet: false).
 * Staat het ergens open, dan gaat die groep naar zijn standaard (met 'change').
 * Daarna herbindLagen(), anders blijft layer.<groep>.<knop> bestaan.
 */
export function haalMapjeWeg(groep, laag) {
  const id = `${groep}.${laag}`;
  const t = TOEGEVOEGD.get(id);
  if (!t) return false;
  const g = GROEPEN[groep];
  if (t.kiesknop !== null) {
    const lijst = g.knoppen[t.kiesknop];
    const i = lijst ? lijst.indexOf(laag) : -1;
    if (i >= 0) lijst.splice(i, 1);
    if (lijst && !lijst.length) delete g.knoppen[t.kiesknop];
  }
  if (g.volgorde?.includes(laag)) g.volgorde = g.volgorde.filter((l) => l !== laag);
  TOEGEVOEGD.delete(id);
  // De naam van vóór voegMapjeToe terug (vorm staat al in LAAGNAAM; een nieuw mapje niet).
  if (t.naamWas === undefined) delete LAAGNAAM[id]; else LAAGNAAM[id] = t.naamWas;
  delete MAPJE_KLEUR[id];
  OP_AANVRAAG.delete(id);
  for (const l of ALLE_LAGEN) {
    if (g.houd) l.houd?.sluit(laag);
    else if (l.stand[groep] === laag) l.zet(groep, g.standaard);
  }
  return true;
}

/**
 * De volgorde van ▲ ▼ in een groep (layer.<groep>.next/prev). null = de
 * standaardvolgorde (zonder volgorde: geen ▲ ▼). Alleen mapjes die bestaan; wat
 * uit de standaardvolgorde valt moet een kiesknop hebben, anders kon je er niet
 * meer bij (WERKRUIMTE.md B3: alles blijft bereikbaar). Daarna herbindLagen().
 */
export function zetVolgorde(groep, lijst) {
  const g = GROEPEN[groep];
  if (!g) throw new Error(`volgorde: de groep "${groep}" bestaat niet`);
  if (lijst === null) {
    if (STANDAARD_VOLGORDE[groep]) g.volgorde = [...STANDAARD_VOLGORDE[groep]]; else delete g.volgorde;
    return;
  }
  if (!Array.isArray(lijst) || !lijst.length) throw new Error(`volgorde ${groep}: een lijst met mapjes, of null`);
  const onbekend = lijst.filter((l) => !bestaatMapje(groep, l));
  if (onbekend.length) throw new Error(`volgorde ${groep}: onbekend mapje ${onbekend.join(', ')}`);
  if (new Set(lijst).size !== lijst.length) throw new Error(`volgorde ${groep}: een mapje staat er twee keer in`);
  const kwijt = (STANDAARD_VOLGORDE[groep] ?? []).filter((l) => !lijst.includes(l) && knopVan(groep, l) === null);
  if (kwijt.length) throw new Error(`volgorde ${groep}: ${kwijt.join(', ')} heeft geen kiesknop en zou onbereikbaar worden`);
  g.volgorde = [...lijst];
}

/** Hoe een mapje op het scherm heet. */
export const LAAGNAAM = {
  'device.strip': 'strip (trim · high · mid · low / echo · galm · fx)', 'device.rack': 'rack (fx 1–8)',
  'device.inst': 'instrument (de acht knoppen van het instrument · ◀ ▶ kiezen · On/Off stil)',
  'device.vorm': 'vormlaag (knoppen 1–6 · dekking)',
  'device.master': 'master (fx 1–7 · mix; shift + 8 = fx 8)',
  'device.beeld': 'beeld (Stroommachine: macro 1–8 · scene = regie · Stop All = paniek)',
  'edit.aan': 'grid-modus (beatgrid bewerken)', 'edit.uit': 'uit',
  'grid.hotcues': 'hotcues', 'grid.loops': 'loops', 'grid.sampler': 'sampler', 'grid.video': 'video',
  'grid.klank': 'klank (kill · rem · op de maat)',
  'grid.auto': 'auto-dj (ok · overslaan · langer · nu · aan/uit)',
  'grid.stems': 'stems (zang · rest · drums · bas · overig weg)',
  'grid.patronen': 'patronen (pad = plek per track · scene = rij op alle tracks · shift = meteen)',
  'grid.secties': 'secties van de focus-track (pad = sectie, valt in op de maat · shift = als loop)',
  'houd.dicht': 'losgelaten (de knoppen doen weer wat ze deden)',
};

export class Lagen extends Emitter {
  /**
   * @param beschikbaar  (groep, laag) => boolean: doet een mapje uit OP_AANVRAAG
   *                     nu mee met rondlopen? Standaard nee (app.js: alleen
   *                     met een instrument op de focus-track).
   */
  /**
   * @param houd  het register van de houd-mapjes (houd.js); standaard het gedeelde.
   *              Verandert het, dan meldt deze Lagen een 'change' (groep 'houd'),
   *              zodat scherm en mapje-balk het zien zoals een gewoon mapje.
   */
  constructor({ now = () => (globalThis.performance?.now() ?? Date.now()), beschikbaar = () => false, houd = gedeeldHoud } = {}) {
    super();
    this.now = now;
    this.beschikbaar = beschikbaar;
    this.houd = houd;
    // De houd-groep heeft geen stand: wat open is, staat in het register.
    this.stand = Object.fromEntries(Object.entries(GROEPEN).filter(([, d]) => !d.houd).map(([g, d]) => [g, d.standaard]));
    this.ingedrukt = {};      // groep -> { knop, vorige, t0 }
    // Dicht (loslaten, losgekoppeld) meldt zich als 'houd.dicht': de mapje-balk zegt dan niet de naam van wat net wegging.
    houd?.on('change', ({ naam, open }) => this.emit('change', open ? { groep: 'houd', laag: naam, id: `houd.${naam}`, open }
      : { groep: 'houd', laag: 'dicht', id: 'houd.dicht', open: false, naam }));
    ALLE_LAGEN.add(this);
  }

  /**
   * Alle open mapjes als 'groep.laag'. Dezelfde (bevroren) lijst zolang er
   * niets verandert: de mapping vraagt dit bij ELK MIDI-bericht en de LED-laag
   * dertig keer per seconde (docs/verslagen/2026-10-14/controller-invoer.md:
   * dat waren 700 nieuwe lijsten per LED-tik). Ook wie `stand` direct zet
   * krijgt een nieuwe lijst: we vergelijken de stand, niet een teller.
   */
  actief() {
    const c = this._actief;
    if (c) {
      let n = 0, gelijk = true;
      for (const g in this.stand) { n++; if (c.stand[g] !== this.stand[g]) { gelijk = false; break; } }
      if (gelijk && n === c.n) return c.lijst;
    }
    const stand = { ...this.stand };
    const lijst = Object.freeze(Object.entries(stand).map(([g, l]) => `${g}.${l}`));
    this._actief = { stand, n: lijst.length, lijst };
    return lijst;
  }

  /** Staat dit mapje (of een mapje onder deze kiesknop) open? Een houd-mapje: in het register. */
  isOpen(groep, knop) {
    if (GROEPEN[groep]?.houd) return !!this.houd?.isOpen(knop);
    return (GROEPEN[groep]?.knoppen[knop] || []).includes(this.stand[groep]);
  }

  zet(groep, laag) {
    if (!GROEPEN[groep] || GROEPEN[groep].houd || this.stand[groep] === laag) return;
    this.stand[groep] = laag;
    this.emit('change', { groep, laag, id: `${groep}.${laag}` });
  }

  /** Een kiesknop indrukken (on = true) of loslaten (on = false). */
  druk(groep, knop, on) {
    const g = GROEPEN[groep];
    const lijst = g?.knoppen[knop];
    if (!lijst) return;
    if (g.houd) {
      // Over de bus (scherm, toetsenbord): het apparaat heet 'bus'. Een Mapping
      // stuurt layer.houd.* zelf naar het register, met zijn eigen apparaat.
      this.houd?.druk('bus', lijst[0], !!on);
      return;
    }
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
