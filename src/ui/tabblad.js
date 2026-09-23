import { Emitter } from '../lib/emitter.js';

/**
 * Twee VARVE-tabbladen tegelijk: allebei krijgen ze elk MIDI-bericht van de
 * APC binnen, allebei sturen ze LED's. Dan gaat één druk op PLAY naar twee
 * mixers, en vechten twee LED-lagen om dezelfde lampjes.
 *
 * Daarom een Web Lock (`navigator.locks`): wie hem heeft is HET tabblad en
 * luistert naar de APC. Een tweede tabblad wacht in de rij; sluit je het
 * eerste, dan krijgt het tweede de lock vanzelf en wordt het alsnog het
 * eerste ('eerste'-event). Een lock verdwijnt ook als het tabblad crasht,
 * dus er blijft nooit een spook hangen — dat kan BroadcastChannel niet.
 *
 * Tot de lock beslist is, telt een tabblad NIET als eerste: liever een paar
 * milliseconden geen MIDI dan een dubbele PLAY.
 */
export const LOCK_NAAM = 'varve-mixer';

/**
 * @param locks  `navigator.locks` (of een nagebouwde, voor de test). Zonder
 *               locks (oude browser, geen secure context) is elk tabblad het
 *               eerste: zo werkt de app zoals vroeger.
 * @returns emitter met `.eerste` (boolean), `.beslist` (boolean) en de events
 *          'eerste' (dit tabblad luistert nu naar de APC) en 'tweede'
 *          (er is al een ander tabblad, dit tabblad wacht).
 */
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
  // Pas na deze beurt vragen: wie het object krijgt, kan eerst zijn
  // luisteraars ophangen voordat 'eerste' of 'tweede' valt.
  queueMicrotask(() => {
    if (!locks?.request) { wordEerste(); return; }
    locks.request(naam, { ifAvailable: true }, (lock) => {
      if (lock) return wordEerste();
      t.beslist = true;
      t.emit('tweede');
      // In de rij gaan staan: sluit het andere tabblad, dan zijn wij aan de beurt.
      locks.request(naam, () => wordEerste()).catch(() => {});
      return undefined;
    }).catch(() => {});
  });
  return t;
}

let gedeeld = null;
/** Het tabblad-object van deze pagina (één keer aangemaakt). */
export function tabblad() {
  gedeeld ??= bewaakTabblad(globalThis.navigator?.locks);
  return gedeeld;
}

/** Luistert dit tabblad naar de APC (MIDI-invoer en LED-uitvoer)? */
export const isEersteTabblad = () => tabblad().eerste;
