/**
 * Leren (MIDI-learn, en ook op het toetsenbord): kies een actie, beweeg of druk
 * een control, en er staat een regel in de actieve indeling.
 *
 * v1 raadde het gedrag uit een reeks CC-waarden (raadModus). In v2 weet het
 * APPARAAT wat elke control is, dus het gedrag volgt meteen (bediening-027,
 * zonder het gokken):
 *   fader                 -> absoluut (met soft-takeover)
 *   ringknop, encoder     -> eindeloos (alleen het verschil)
 *   knop, pad, scene, voet -> trigger op een trigger-actie, schakelaar op een waarde-actie
 * De regel komt in de laag die open staat, en met shift vast in de shift-laag
 * (zoals v1). Een commando (laden) gaat niet op een knop.
 *
 * Zolang er geleerd wordt, gaat een gebeurtenis NIET naar de indeling (anders
 * verzet je tijdens het koppelen je filter). Behalve de shiftknop: die zegt of
 * het een shift-regel wordt.
 */
import { Emitter } from '../kern/emitter.js';
import { isLaagActie } from './indeling.js';

/** Het gedrag voor deze control en deze actie, of { fout }. */
export function raadGedrag(control, soortActie) {
  if (soortActie === 'commando') return { fout: 'een commando gaat niet op een knop' };
  const laag = soortActie === 'laag';
  switch (control.soort) {
    case 'fader':
      return soortActie === 'waarde' || soortActie === null ? { gedrag: 'absoluut' } : { fout: 'een fader stuurt een waarde, geen druk' };
    case 'draai':
    case 'rel':
      return soortActie === 'waarde' || soortActie === null ? { gedrag: 'eindeloos' } : { fout: 'een draaiknop stuurt een waarde; een knopactie hoort op een knop' };
    default:
      if (laag) return { gedrag: 'trigger' };
      return { gedrag: soortActie === 'waarde' ? 'schakelaar' : 'trigger' };
  }
}

export class Leren extends Emitter {
  constructor({ indeling }) {
    super();
    this.indeling = indeling;
    this.actie = null;
    this.laag = null;
  }

  get bezig() { return this.actie !== null; }

  /**
   * Wachten op een control voor deze actie (mag {focus} bevatten, of een laag).
   * `laag`: in welke laag de regel komt; standaard de laag die nu open is.
   */
  start(actie, { laag } = {}) {
    this.actie = actie;
    this.laag = laag !== undefined ? laag : (this.indeling.open[0] ?? null);
    this.emit('wacht', { actie, laag: this.laag });
  }

  stop() {
    const was = this.actie;
    this.actie = null;
    this.laag = null;
    if (was) this.emit('klaar', { actie: was });
  }

  /** Een gebeurtenis van het apparaat terwijl er geleerd wordt. Geeft de nieuwe regel, of null. */
  voer(g) {
    if (!this.bezig) return null;
    const ind = this.indeling;
    const shiftKnop = ind.actief?.shift ?? ind.apparaat.shift;
    if (shiftKnop && (g.control === shiftKnop || g.control === ind._shiftVan)) return ind.verwerk(g);
    if (g.soort === 'los') return null;
    const c = ind.apparaat.controls.get(g.control);
    if (!c) return null;
    const soort = isLaagActie(this.actie) ? 'laag' : ind.soortVan(this.actie.replace(/\{\w+\}/g, '1'));
    const raad = raadGedrag(c, soort);
    if (raad.fout) { this.emit('niet', { control: c.id, reden: raad.fout }); return null; }
    const shift = g.shift ?? ind.shift;
    const regel = { control: c.id, actie: this.actie, gedrag: raad.gedrag, ...(shift ? { shift: true } : {}), ...(this.laag ? { laag: this.laag } : {}) };
    const r = ind.zetRegel(regel);
    if (r.fout) { this.emit('niet', { control: c.id, reden: r.fout }); return null; }
    const uitslag = { regel: r.regel, was: r.was && r.was.actie !== this.actie ? r.was.actie : null, label: ind.apparaat.label?.(c.id) ?? c.id };
    this.emit('gekoppeld', uitslag);
    this.stop();
    return uitslag;
  }

  /** Alle regels naar deze actie weghalen (in de actieve indeling). */
  vergeet(actie) {
    const ind = this.indeling;
    const weg = [...(ind.actief?.op.values() ?? [])].filter((r) => r.actie === actie);
    let n = 0;
    for (const r of weg) if (ind.haalWeg(`${r.control}${r.shift ? '#shift' : ''}${r.laag ? `@${r.laag}` : ''}`)) n++;
    return n;
  }
}
