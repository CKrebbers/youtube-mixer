// Aanhaker 'uitlijn' (werkruimte S2, docs/werkruimte/S2.md, docs/WERKRUIMTE.md D4).
// Alleen dit spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// De uitlijnweergave in de mixer: alle tracks in tellen van de maatgever.
//   - window.varveUitlijn: voor het losse venster (uitlijn.html, zoals de beamer en
//     plan.html): de invoer (engine, klok, peaks), en de bus voor slepen;
//   - een knop "uitlijn" achteraan de transportrij van de focus-track die dat venster opent;
//   - toonInWerkvak(el, vorm): de weergave in een element van de mixer (S3/S7 roepen
//     dit per deel aan); hij tekent op ctx.renderloop, alleen zolang hij er staat.
// Geen actions: openen is scherm, zoals de knop plan.
import { UitlijnWeergave, vakVorm } from '../../uitlijn/teken.js';
import { invoerVanEngine } from '../../uitlijn/reken.js';

export default async function opzet(ctx) {
  const { engine, staat, invoke, metaOf, read, renderloop } = ctx;
  // Zonder engine of zonder document (een test die alle aanhakers in Node laadt): niets te doen.
  if (!engine || typeof document === 'undefined') return;
  // Elke aanroep een verse invoer van NU (de audioklok, de segmenten): regel 3.
  const invoer = () => invoerVanEngine(engine, { analysis: staat?.analysis ?? null });
  let volg = 0;

  /**
   * De weergave in een element van de mixer. `vorm`: 'strook' (standaard: één maat,
   * klein), 'pagina' of 'vouw'. Geeft { weergave, zetVorm, stop }.
   */
  function toonInWerkvak(el, vorm = 'strook', { maten = 2 } = {}) {
    const weergave = new UitlijnWeergave(el, { invoer, vorm, maten, invoke, metaOf, read });
    const weg = renderloop.stap(`uitlijn-${++volg}`, () => weergave.stap());
    return {
      weergave,
      zetVorm: (v) => weergave.zetVorm(v),
      stop() { weg(); weergave.vernietig(); },
    };
  }

  /**
   * Een vak uit een werkruimte (`"werkvak": "uitlijn-strook"`, docs/werkruimte/S2.md):
   * de naam kiest vorm en maten (vakVorm in teken.js). Geen uitlijnvak: null.
   */
  function toonVak(el, naam) {
    const v = vakVorm(naam);
    return v ? toonInWerkvak(el, v.vorm, { maten: v.maten }) : null;
  }

  /**
   * Het losse venster: met dezelfde naam komt een open venster naar voren. Met een vaknaam
   * opent hij in die vorm (uitlijn.html?vorm=…&maten=…); zonder onthoudt het venster zelf.
   */
  function open(naam = null) {
    const v = vakVorm(naam);
    const url = v ? `uitlijn.html?vorm=${v.vorm}&maten=${v.maten}` : 'uitlijn.html';
    return window.open(url, 'varve-uitlijn', 'popup,width=1440,height=640');
  }

  // `analysis` (de peaks per track, staat.analysis) alleen voor de console en de headless proef.
  window.varveUitlijn = { engine, invoer, invoke, metaOf, read, toonInWerkvak, toonVak, open, analysis: staat?.analysis ?? null };

  // De knop staat achteraan de transportrij van de track met focus (na de gridknoppen: daar
  // ben je als je tracks gelijk zet; die rij heeft op 1440 px ruimte over). NIET in de
  // bovenbalk (in rust nog 4 px over op 1440 px, gemeten 14 okt) en niet in de kop van de
  // focus-track (die breekt dan af naar twee regels).
  const rij = document.querySelector('#focus-deck .deck-transport');
  if (rij && !document.getElementById('uitlijn-btn')) {
    const knop = document.createElement('button');
    knop.id = 'uitlijn-btn';
    knop.className = 'btn sm ul-open';
    knop.textContent = 'uitlijn';
    knop.title = 'uitlijn: alle tracks tegelijk in tellen van de maatgever, met grid Δ, muziek Δ, drift en maat (apart venster)';
    knop.addEventListener('click', () => open());
    rij.appendChild(knop);
  }
}
