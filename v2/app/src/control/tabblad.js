/**
 * Eén tabblad praat met de controller (v1 src/ui/tabblad.js, bediening-040).
 *
 * Twee tabbladen tegelijk krijgen allebei elk MIDI-bericht en sturen allebei
 * lampjes: één druk op PLAY gaat naar twee mixers, en op 23 sep legde dat met
 * vier tabbladen Chrome's MIDI-dienst om. Daarom een Web Lock: wie hem heeft is
 * HET tabblad. Een tweede tabblad vraagt GEEN MIDI-toegang en wacht in de rij;
 * sluit (of crasht) het eerste, dan krijgt het tweede de lock vanzelf.
 *
 * `locks` komt van buiten (navigator.locks, of een nagebouwde in de test).
 * Tot de lock beslist is telt een tabblad NIET als eerste: liever een paar ms
 * geen MIDI dan een dubbele PLAY.
 */
import { Emitter } from '../kern/emitter.js';

export const LOCK_NAAM = 'varve-v2-mixer';

/** Emitter met .eerste en .beslist, en de events 'eerste' en 'tweede'. */
export function bewaakTabblad(locks, naam = LOCK_NAAM) {
  const t = new Emitter();
  t.eerste = false;
  t.beslist = false;
  const wordEerste = () => {
    t.eerste = true;
    t.beslist = true;
    t.emit('eerste');
    return new Promise(() => {});   // nooit loslaten: de lock hoort bij dit tabblad tot het sluit
  };
  // Pas na deze beurt vragen: wie het object krijgt kan eerst zijn luisteraars ophangen.
  queueMicrotask(() => {
    if (!locks?.request) { wordEerste(); return; }
    locks.request(naam, { ifAvailable: true }, (lock) => {
      if (lock) return wordEerste();
      t.beslist = true;
      t.emit('tweede');
      locks.request(naam, () => wordEerste()).catch(() => {});
      return undefined;
    }).catch(() => {});
  });
  return t;
}
