/**
 * De speeltuin (30 okt): de toestellen beginnen leeg en de indeling groeit knop voor knop terwijl je speelt.
 *
 *   Raak een lege knop aan   -> hij krijgt meteen voorstel 1 en doet het al (je hoort het bij dezelfde druk).
 *   Maschine F1–F4           -> een ander voorstel uit het rijtje op het linker scherm, meteen live.
 *   F5 ANDER / F7 TERUG      -> het volgende / vorige rijtje van vier.
 *   F6 LEEG                  -> de knop weer leeg.
 *   F8 GOED                  -> "dit klopt" (alleen een vinkje in het logboek; bewaard wordt er altijd).
 *
 * F1–F8 gaan altijd over de LAATST AANGERAAKTE knop, ook een die al iets doet: zo verander je een keuze
 * door de knop aan te raken en dan een F-knop. Alles wat er op een knop staat, staat in de indeling
 * "speeltuin" (per apparaat) en wordt bewaard zodra het verandert ('bewaar'). F1–F8 zelf zijn niet te
 * vullen: dat is de prijs van kiezen zonder scherm. Shift blijft shift; met shift vast vul je de
 * shift-laag van een knop.
 *
 * Kent geen DOM en geen hardware: gebeurtenissen komen van controllers.js, de regels gaan via Indeling.
 */
import { Emitter } from '../kern/emitter.js';
import { sleutelVan } from './indeling.js';
import { FAMILIES, VOORSTELLEN, VOLGORDE, EERST } from './speeltuin-kaart.js';
import {
  leegScherm, tekst, pasIn, tekenDeelLabels, LABEL_H, KOLOM, tekstBreedte, BREED,
} from './maschine-scherm.js';

export const NAAM = 'speeltuin';
export const PER_RIJ = 4;
/** De keuzeknoppen boven de schermen van de Maschine. */
export const KEUZE = Object.freeze({ f1: 0, f2: 1, f3: 2, f4: 3, f5: 'ander', f6: 'leeg', f7: 'terug', f8: 'goed' });

/** Een lege indeling voor dit apparaat. */
export const leegDoc = (apparaat) => ({
  schema: 1, naam: NAAM, apparaat: apparaat.id, ...(apparaat.shift ? { shift: apparaat.shift } : {}),
  uitleg: 'De speeltuin: begon leeg, elke knop is spelend gekozen.', regels: [],
});

/** De kolom (= track) van een APC-knop, of null. */
export function kolomVan(id) {
  const m = /^(?:fader|tk|act|solo|rec|sel|stop|ab)(\d)$/.exec(id) ?? /^pad\d-(\d)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** Een nummer van de knop zelf (pad 5 -> 5, APC-pad rij r kolom c -> (r−1)·8 + c), of een vast getal uit de naam. */
export function nummerVan(id) {
  let m = /^pad(\d)-(\d)$/.exec(id);
  if (m) return (Number(m[1]) - 1) * 8 + Number(m[2]);
  m = /(\d+)$/.exec(id);
  if (m) return Number(m[1]);
  let h = 0;
  for (const t of id) h = (h * 31 + t.charCodeAt(0)) % 9973;
  return (h % 8) + 1;
}

/** Het gedrag van een voorstel op deze knop, of null als het niet past. */
export function gedragVoor(c, soort, voorstel, apparaatId) {
  if (soort === 'commando' || !soort) return null;
  switch (c.soort) {
    case 'fader': return soort === 'waarde' && !voorstel.terug ? 'absoluut' : null;
    case 'draai': return soort === 'waarde' && !voorstel.terug ? 'eindeloos' : null;
    case 'rel':
      if (voorstel.terug) return soort === 'trigger' ? 'trigger' : null;
      return soort === 'waarde' ? 'eindeloos' : null;
    case 'pad':
      if (voorstel.terug) return null;
      // Op de Maschine telt de druk: aanslag voor drums en noten, druk (aftertouch) voor al het andere.
      if (apparaatId === 'maschine-mk2' && soort === 'waarde') return /^speel\./.test(voorstel.id) ? 'aanslag' : 'druk';
      return 'trigger';
    default:
      // knop, scene, voet: indrukken = aan, loslaten = terug (op een waarde: vasthouden)
      return voorstel.terug ? null : 'trigger';
  }
}

export class Speeltuin extends Emitter {
  /**
   * @param bus        kern/bus.js
   * @param indelingen { apc, maschine }: Indeling-objecten
   * @param nu         ms-klok (logboek)
   */
  constructor({ bus, indelingen, nu = () => Date.now() }) {
    super();
    this.bus = bus;
    this.indelingen = indelingen;
    this.nu = nu;
    this.aan = false;
    this.hand = null;   // { app, control, label, shift, kandidaten, keuze }
  }

  /** Aanzetten: elk apparaat krijgt (als hij er nog niet is) de lege indeling en kiest hem. */
  start() {
    for (const ind of Object.values(this.indelingen)) {
      if (!ind) continue;
      if (!ind.namen().includes(NAAM)) ind.voegToe(leegDoc(ind.apparaat));
      ind.zetStandaard(NAAM);
      ind.kies(NAAM);
    }
    this.aan = true;
    this.emit('verander', this.stand());
  }

  /**
   * Een gebeurtenis van een apparaat. Geeft true als de speeltuin hem opeet (de F-knoppen); anders
   * gaat hij daarna gewoon naar de indeling, en een lege knop heeft dan al zijn eerste voorstel.
   */
  voer(app, g) {
    if (!this.aan || !g) return false;
    if (app === 'maschine' && g.control in KEUZE) {
      if (g.soort === 'druk') this.keuzeKnop(KEUZE[g.control]);
      return true;
    }
    if (g.soort === 'los' || g.soort === 'aanraak') return false;
    const ind = this.indelingen[app];
    const c = ind?.apparaat.controls.get(g.control);
    if (!c) return false;
    const shiftKnop = ind.actief?.shift ?? ind.apparaat.shift;
    if (g.control === shiftKnop) return false;
    const shift = g.shift ?? ind.shift;
    const zelfde = this.hand && this.hand.app === app && this.hand.control === c.id && this.hand.shift === shift;
    if (zelfde) return false;   // een fader stuurt een stroom: één keer vastpakken is genoeg
    const kandidaten = this.kandidaten(app, c.id);
    const regel = ind.regelVoor(c.id, { shift });
    const keuze = regel ? kandidaten.findIndex((k) => k.actie === regel.actie) : -1;
    this.hand = { app, control: c.id, label: c.label ?? c.id, shift, kandidaten, keuze, eigen: regel ? (regel.label ?? regel.actie) : null };
    if (!regel && kandidaten.length) this._zet(0, 'proef');
    else this.emit('verander', this.stand());
    return false;
  }

  /** F1–F8 (of het scherm): een voorstel uit het rijtje, ander/terug, leeg of goed. */
  keuzeKnop(wat) {
    const h = this.hand;
    if (!h) return;
    const rij = Math.max(0, Math.floor(Math.max(h.keuze, 0) / PER_RIJ));
    const rijen = Math.max(1, Math.ceil(h.kandidaten.length / PER_RIJ));
    if (typeof wat === 'number') {
      const i = rij * PER_RIJ + wat;
      if (i < h.kandidaten.length) this._zet(i, 'kies');
    } else if (wat === 'ander' || wat === 'terug') {
      const nieuw = (rij + (wat === 'ander' ? 1 : rijen - 1)) % rijen;
      this._zet(nieuw * PER_RIJ, wat);
    } else if (wat === 'leeg') {
      const ind = this.indelingen[h.app];
      const was = ind.regelVoor(h.control, { shift: h.shift });
      ind.haalWeg(sleutelVan({ control: h.control, shift: h.shift }));
      h.keuze = -1;
      h.eigen = null;
      this._log('leeg', was?.actie ?? null);
      this.emit('bewaar', { app: h.app, doc: ind.naarJSON(NAAM) });
      this.emit('verander', this.stand());
    } else if (wat === 'goed') {
      const r = this.indelingen[h.app].regelVoor(h.control, { shift: h.shift });
      if (r) { h.goed = true; this._log('goed', r.actie); this.emit('verander', this.stand()); }
    }
  }

  _zet(i, waarom) {
    const h = this.hand;
    const k = h.kandidaten[i];
    if (!k) return;
    const ind = this.indelingen[h.app];
    const regel = {
      control: h.control, actie: k.actie, gedrag: k.gedrag, label: k.naam,
      ...(k.terug ? { terug: k.terug } : {}),
      ...(h.shift ? { shift: true } : {}),
      led: { kleur: FAMILIES[k.fam].kleur },
    };
    const r = ind.zetRegel(regel);
    if (r.fout) { this.emit('melding', { tekst: `${h.label}: ${r.fout}`, soort: 'fout' }); return; }
    h.keuze = i;
    h.eigen = k.naam;
    h.goed = false;
    this._log(waarom, k.actie);
    this.emit('bewaar', { app: h.app, doc: ind.naarJSON(NAAM) });
    this.emit('verander', this.stand());
  }

  _log(wat, actie) {
    const h = this.hand;
    this.emit('log', { t: this.nu(), app: h.app, control: h.control, ...(h.shift ? { shift: true } : {}), actie, wat });
  }

  /**
   * Alle voorstellen voor deze knop, in volgorde: per rijtje één uit elke familie (de families die bij
   * zo'n knop horen eerst), en wat al op een andere knop staat achteraan.
   */
  kandidaten(app, controlId) {
    const ind = this.indelingen[app];
    const c = ind.apparaat.controls.get(controlId);
    const volgorde = VOLGORDE[c.soort] ?? VOLGORDE.knop;
    const kolom = app === 'apc' ? kolomVan(controlId) : null;
    const nr = nummerVan(controlId);
    const bezet = new Set();
    for (const [ctl, r] of ind.actieveRegels?.() ?? []) if (ctl !== controlId) bezet.add(ind.vul(r.actie));
    const perFam = new Map(volgorde.map((f) => [f, []]));
    for (const v of VOORSTELLEN) {
      if (!perFam.has(v.fam)) continue;
      if (v.pad && !['pad', 'knop', 'scene'].includes(c.soort)) continue;
      const k = v.max ? ((nr - 1) % v.max) + 1 : nr;
      const vul = (s) => s.replace('{k}', String(k)).replace('{n}', kolom ? String(kolom) : '{focus}');
      const actie = vul(v.id);
      const voorbeeld = actie.replace('{focus}', '1');
      const soort = this.bus.zoek?.(voorbeeld)?.def?.soort ?? null;
      const gedrag = gedragVoor(c, soort, v, ind.apparaat.id);
      if (!gedrag) continue;
      if (v.terug && !this.bus.zoek?.(vul(v.terug).replace('{focus}', '1'))) continue;
      perFam.get(v.fam).push({
        actie, naam: v.naam.replace('{k}', String(k)), fam: v.fam, gedrag,
        ...(v.terug ? { terug: vul(v.terug) } : {}),
        bezet: bezet.has(ind.vul(actie)),
      });
    }
    const vrij = [], later = [];
    // Een vanzelfsprekende eerste keuze: vooraan in zijn familie, en die familie vooraan.
    const eerst = app === 'apc' ? EERST[controlId] : null;
    const lijsten = [...perFam.values()];
    if (eerst) {
      const f = lijsten.findIndex((l) => l.some((k) => k.actie === eerst));
      if (f >= 0) {
        const l = lijsten.splice(f, 1)[0];
        l.unshift(...l.splice(l.findIndex((k) => k.actie === eerst), 1));
        lijsten.unshift(l);
      }
    }
    for (let i = 0; lijsten.some((l) => i < l.length); i++) {
      for (const l of lijsten) if (i < l.length) (l[i].bezet ? later : vrij).push(l[i]);
    }
    return [...vrij, ...later];
  }

  /** Voor het scherm en het paneel. */
  stand() {
    const h = this.hand;
    const tellen = {};
    for (const [app, ind] of Object.entries(this.indelingen)) tellen[app] = ind?.docs.get(NAAM)?.bron.regels.length ?? 0;
    if (!h) return { aan: this.aan, hand: null, tellen };
    const rij = Math.max(0, Math.floor(Math.max(h.keuze, 0) / PER_RIJ));
    return {
      aan: this.aan, tellen,
      hand: {
        app: h.app, control: h.control, label: h.label, shift: h.shift, eigen: h.eigen, goed: !!h.goed,
        keuze: h.keuze, rij, rijen: Math.max(1, Math.ceil(h.kandidaten.length / PER_RIJ)),
        rijtje: h.kandidaten.slice(rij * PER_RIJ, rij * PER_RIJ + PER_RIJ).map((k, j) => ({ ...k, i: rij * PER_RIJ + j, gekozen: rij * PER_RIJ + j === h.keuze })),
      },
    };
  }

  /** De twee Maschine-schermen: links het rijtje onder F1–F4, rechts de knop in je hand onder F5–F8. */
  scherm(nr) {
    const s = this.stand();
    const h = s.hand;
    if (nr === 0) {
      const rijtje = h?.rijtje ?? [];
      const delen = rijtje.map((k) => k.naam);
      const buf = tekenDeelLabels(delen, rijtje.findIndex((k) => k.gekozen), { nr: 0 });
      if (!h) {
        tekst(buf, 4, 20, 'SPEELTUIN', 2);
        tekst(buf, 4, 44, 'raak een knop aan');
        return buf;
      }
      rijtje.forEach((k, j) => {
        const x = j * KOLOM + 2;
        tekst(buf, x, LABEL_H + 4, pasIn(FAMILIES[k.fam].naam));
        if (k.bezet) tekst(buf, x, LABEL_H + 16, 'al ergens');
      });
      tekst(buf, 2, 54, `rij ${h.rij + 1}/${h.rijen}`);
      return buf;
    }
    const buf = tekenDeelLabels([null, null, null, null, 'ANDER', 'LEEG', 'TERUG', 'GOED'], -1, { nr: 1 });
    const n = (s.tellen.apc ?? 0) + (s.tellen.maschine ?? 0);
    if (!h) { tekst(buf, 2, LABEL_H + 6, `${n} knoppen gevuld`); return buf; }
    const waar = `${h.app === 'apc' ? 'APC' : 'MASCHINE'} ${h.label}${h.shift ? ' +SHIFT' : ''}`;
    tekst(buf, 2, LABEL_H + 4, pasIn(waar, Math.floor((BREED - 4) / 6)));
    const nu = h.eigen ? `= ${h.eigen}` : '= leeg';
    tekst(buf, 2, LABEL_H + 18, pasIn(nu, 20), tekstBreedte(nu, 2) < BREED - 4 ? 2 : 1);
    tekst(buf, 2, 54, `${n} gevuld${h.goed ? '  * goed' : ''}`);
    return buf;
  }
}
