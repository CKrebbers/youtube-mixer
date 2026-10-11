import { read as readAction } from '../control/actions.js';
import { meld } from './meldingen.js';
import { schrijfInstelling } from './instellingen-opslag.js';

/*
 * De KOPTELEFOON-rij (docs/STUDIO.md §3): per track een cue-knop, het
 * volume (VOL) en de mix cue ↔ zaal (MIX), en of er een koptelefoonuitgang
 * is. Spelen gaat over de bus (data-action): vensters.js bindt de knoppen en
 * draaiknoppen, de renderloop volgt de draaiknoppen; deze module tekent de
 * cue-lampjes en de stand. Openen en sluiten met de knop in de balk
 * (onthouden, standaard dicht), zoals KLANKSCHAAL en STEMS.
 *
 * ⇄ wisselt zaal en koptelefoon (kanaal 1/2 ↔ 3/4). Dat is bedrading, en
 * bedrading verander je niet terwijl er geluid door loopt (een klik): het
 * geldt na herladen. Daarom leest de app het bij het maken van de engine
 * (`koptelefoonOpties`).
 */
const OPEN = 'varve.koptelefoon.open';
const OMGEWISSELD = 'varve.koptelefoon.omgewisseld';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
// De instrument-sleutels gaan ook naar de server (instellingen-opslag.js); de rest alleen localStorage.
const schrijf = schrijfInstelling;

/** Voor `new Engine(...)`: wat de koptelefoon bij het maken moet weten. */
export function koptelefoonOpties() {
  return { omgewisseld: lees(OMGEWISSELD) === '1' };
}

const ZONDER = 'De uitgang heeft geen vier kanalen. Maak in Audio-MIDI-configuratie een samengesteld apparaat '
  + '(eerst de Scarlett, dan de koptelefoonuitgang van de Mac), zet het als uitvoer in Systeeminstellingen → Geluid '
  + 'en herlaad deze pagina. Zie docs/STUDIO.md §3.';

export function opzetKoptelefoon({ engine }) {
  const kt = engine.koptelefoon;
  const rij = document.getElementById('koptelefoon');
  const knop = document.getElementById('koptelefoon-btn');
  const standEl = rij.querySelector('.kp-stand');
  const cueKnoppen = [...rij.querySelectorAll('.kp-pfl')];
  const wisselKnop = rij.querySelector('.kp-wissel');

  const tekst = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };
  const isDicht = () => rij.classList.contains('hidden');

  const zet = (open) => {
    rij.classList.toggle('hidden', !open);
    knop.style.color = open ? 'var(--text)' : '';
    schrijf(OPEN, open ? '1' : '0');
  };
  knop.addEventListener('click', () => zet(isDicht()));
  if (lees(OPEN) === '1') zet(true);

  // Wat er na herladen geldt; verschilt het van nu, dan brandt ⇄.
  let gewenst = lees(OMGEWISSELD) === '1';
  wisselKnop.addEventListener('click', () => {
    gewenst = !gewenst;
    schrijf(OMGEWISSELD, gewenst ? '1' : '0');
    meld(gewenst === kt.omgewisseld
      ? 'koptelefoon: weer zoals nu'
      : `koptelefoon: na herladen de zaal op ${gewenst ? '3/4' : '1/2'} en de koptelefoon op ${gewenst ? '1/2' : '3/4'}`);
  });

  /** Eén frame (renderloop). */
  function teken() {
    if (isDicht()) return;
    if (kt.beschikbaar) {
      const [zaal, kop] = kt.omgewisseld ? ['3/4', '1/2'] : ['1/2', '3/4'];
      tekst(standEl, `zaal ${zaal} · koptelefoon ${kop}`);
      titel(standEl, `De uitgang heeft ${kt.kanalen} kanalen: de zaal op ${zaal}, de koptelefoon op ${kop}. `
        + 'Andersom? ⇄ en herladen, of de volgorde in het samengestelde apparaat omdraaien.');
    } else {
      tekst(standEl, `geen koptelefoonuitgang (${kt.kanalen} kanalen)`);
      titel(standEl, ZONDER);
    }
    klasse(standEl, 'geen', !kt.beschikbaar);
    klasse(wisselKnop, 'on', gewenst !== kt.omgewisseld);
    for (const b of cueKnoppen) {
      const v = readAction(b.dataset.action);
      klasse(b, 'on', v === 1);
      klasse(b, 'dood', v === null);
    }
  }

  return { teken };
}
