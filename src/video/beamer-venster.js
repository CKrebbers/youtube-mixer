import { VideoMixer } from './video-mixer.js';

/**
 * Het losse venster (video.html): de beamer. Het MENGT ZELF (beamer.js legt
 * uit waarom): eigen <video>'s in DIT document en een eigen WebGL-canvas, op
 * de animatielus van DIT venster. Die blijft lopen als het hoofdtabblad
 * verborgen is, en een verborgen tabblad decodeert geen video meer.
 *
 * Wat het leest komt van het hoofdvenster (window.opener, same-origin, zelfde
 * thread): `window.varveBeamer` met de engine, de mixer daar en wie er mengt.
 * Alleen lezen (regel 1): knoppen, bronnen en beeldlagen komen elk beeld via
 * neemOver; posities van de audioklok van het hoofdvenster (regel 3).
 *
 * Inloop (beamer.js): net aangemeld, en het hoofdvenster mengde al? Dan zet
 * DAT zijn beeld op ons canvas (mixer.toonBeeld, vanuit zijn eigen lus) en
 * stuurt dit venster zijn eigen video's alleen bij (mixer.loopIn). Lopen die
 * in de pas, dan mengt het zelf, vanaf dat beeld.
 *
 * Herladen:
 *   dit venster   pagehide meldt af; het nieuwe document meldt zich weer aan
 *   hoofdvenster  varveBeamer is even weg (dan blijft het laatste beeld
 *                 staan en pauzeren de video's), daarna is er een nieuwe:
 *                 opnieuw aanmelden, en neemOver brengt de nieuwe engine mee
 *   hoofdvenster dicht of een andere site: een melding hier, geen beeld
 *
 * Geen tekst op de beamer behalve het korte hulpje bij het eerste koppelen
 * en als de app echt weg is: dit scherm ziet de zaal. Fouten gaan naar de
 * meldingenstrook van het hoofdvenster.
 */

const canvas = document.querySelector('canvas');
const hint = document.querySelector('.hint');
let app = null;
let mixer = null;
let hintTimer = 0;
let ooitGekoppeld = false;

/** varveBeamer van het hoofdvenster, of null (dicht, andere site, nog aan het laden). */
function leesApp() {
  try {
    const o = window.opener;
    return o && !o.closed ? o.varveBeamer ?? null : null;
  } catch (_) { return null; }
}

function toonHint(tekst, verdwijn) {
  hint.textContent = tekst;
  hint.style.transition = 'none';
  hint.style.opacity = 1;
  clearTimeout(hintTimer);
  if (verdwijn) hintTimer = setTimeout(() => { hint.style.transition = 'opacity 1s'; hint.style.opacity = 0; }, 4000);
}

function koppel(nieuw) {
  app = nieuw;
  if (!app) {
    mixer?.pauzeerAlles();
    // Het hoofdvenster herladen duurt een tel: dan blijft het laatste beeld
    // gewoon staan, zonder tekst voor de zaal. Alleen als de app echt weg is.
    let weg = true;
    try { weg = !window.opener || window.opener.closed; } catch (_) {}
    if (weg || !ooitGekoppeld) toonHint(weg && ooitGekoppeld ? 'de app is dicht — open dit venster opnieuw vanuit de app' : 'geen app gevonden — open dit venster vanuit de app (knop "los venster")', false);
    return;
  }
  if (!mixer) {
    mixer = new VideoMixer({ canvas, engine: app.engine, decks: app.videoMixer.decks });
    mixer.onFout = (id, tekst) => app?.meldVideoFout(id, tekst);
    window.beamerMixer = mixer;            // voor de console en tools/headless/beamer.mjs
  }
  // Zonder WebGL2 niet aanmelden: dan blijft het hoofdvenster mengen.
  if (mixer.fout) { app.meldVideoFout(null, `los venster: ${mixer.fout}`); return; }
  mixer.neemOver(app.videoMixer);
  app.meldAan(window, mixer);
  if (!ooitGekoppeld) toonHint('dubbelklik voor volledig scherm · sleep dit venster naar het tweede scherm', true);
  else { hint.style.opacity = 0; }
  ooitGekoppeld = true;
}

let laatsteKlacht = 0;
function frame() {
  try {
    const nu = leesApp();
    if (nu !== app) koppel(nu);
    if (app && mixer) {
      mixer.neemOver(app.videoMixer);
      let rol = app.rolLos(window);
      // Inlopen: eigen video's bijsturen; het beeld zet het hoofdvenster erop.
      // In de pas (of te lang bezig)? Dan meteen zelf mengen.
      if (rol === 'inloop' && !app.meldPas(window, mixer.loopIn())) rol = 'mengt';
      if (rol === 'mengt') mixer.teken();
      else if (rol !== 'inloop') mixer.pauzeerAlles();
    }
  } catch (err) {
    // Eén slechte frame mag de beamer niet stilzetten; wel melden, hooguit één keer per seconde.
    if (performance.now() - laatsteKlacht > 1000) { laatsteKlacht = performance.now(); console.error('[beamer]', err); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => { try { app?.meldAf(window); } catch (_) {} });
// Is dit venster de bron van een lopende video-opname, dan eerst vragen:
// dicht = het beeld in die opname staat vanaf dan stil.
window.addEventListener('beforeunload', (e) => {
  try { if (app?.opnameUitLos()) { e.preventDefault(); e.returnValue = ''; } } catch (_) {}
});
document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
});
