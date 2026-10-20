// Herkomst: v1 youtube-mixer/src/video/beamer-venster.js @ 039b372. Anders in v2: het leest de STAND
// van het hoofdvenster (window.opener.varveBeeld.beeld) bij elk beeld, in plaats van per veld te kopiëren.
import { VideoMixer } from './mixer.js';

/**
 * Het losse venster (beeld.html): de beamer. Het MENGT ZELF (oogst beeld-022): eigen <video>'s in DIT
 * document en een eigen WebGL-canvas, op de animatielus van DIT venster. Die blijft lopen als het
 * hoofdtabblad verborgen is, en een verborgen tabblad decodeert geen video meer (oogst beeld-021).
 *
 * Wat het leest komt van het hoofdvenster (window.opener, same-origin, zelfde thread):
 * `varveBeeld` = { engine, beeld, tracks, meldAan, meldAf, rolLos, meldPas, meldFout }. Alleen lezen:
 * de stand (effecten, noodknoppen, bronnen), de beeldlagen (dezelfde objecten: een vorm rekent één
 * keer, voor wie er mengt) en de engine (posities van de audioklok van het hoofdvenster).
 *
 * Inloop (beamer.js): net aangemeld en het hoofdvenster mengde al? Dan zet DAT zijn beeld op ons
 * canvas (mixer.toonBeeld, vanuit zijn eigen lus) en stuurt dit venster zijn eigen video's alleen bij
 * (mixer.loopIn). Lopen die in de pas, dan mengt het zelf, vanaf dat beeld.
 *
 * Herladen (oogst beeld-028):
 *   dit venster   pagehide meldt af; het nieuwe document meldt zich weer aan
 *   hoofdvenster  varveBeeld is even weg (dan blijft het laatste beeld staan en pauzeren de video's),
 *                 daarna is er een nieuwe: opnieuw aanmelden
 *   hoofdvenster dicht: een korte tekst, geen beeld
 * Geen tekst op de beamer behalve het hulpje bij het eerste koppelen en als de app echt weg is: dit
 * scherm ziet de zaal. Fouten gaan naar de meldingen van het hoofdvenster.
 */

const canvas = document.querySelector('canvas');
const hint = document.querySelector('.hint');
let app = null;
let mixer = null;
let hintTimer = 0;
let ooitGekoppeld = false;

/** varveBeeld van het hoofdvenster, of null (dicht, andere site, nog aan het laden). */
function leesApp() {
  try {
    const o = window.opener;
    return o && !o.closed ? o.varveBeeld ?? null : null;
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
    // Het hoofdvenster herladen duurt een tel: dan blijft het laatste beeld staan, zonder tekst.
    let weg = true;
    try { weg = !window.opener || window.opener.closed; } catch (_) {}
    if (weg || !ooitGekoppeld) toonHint(weg && ooitGekoppeld ? 'de app is dicht — open dit venster opnieuw vanuit de app' : 'geen app gevonden — open dit venster vanuit de app (knop "los venster")', false);
    return;
  }
  if (!mixer) {
    mixer = new VideoMixer({ canvas, tracks: app.tracks, maakVideo: () => document.createElement('video'), ...(app.maat ?? {}) });
    window.beeldMixer = mixer;            // voor de console en tools/proef-beeld.mjs
  }
  mixer.onFout = (n, tekst) => app?.meldFout(n, tekst);
  // Zonder WebGL2 niet aanmelden: dan blijft het hoofdvenster mengen.
  if (mixer.fout) { app.meldFout(null, `los venster: ${mixer.fout}`); return; }
  app.meldAan(window, mixer);
  if (!ooitGekoppeld) toonHint('dubbelklik voor volledig scherm · sleep dit venster naar het tweede scherm', true);
  else hint.style.opacity = 0;
  ooitGekoppeld = true;
}

let laatsteKlacht = 0;
const TITEL = document.title;
function frame() {
  try {
    const nu = leesApp();
    if (nu !== app) koppel(nu);
    if (app && mixer && !mixer.fout) {
      // Clips uit (het zaalbeeld) in de venstertitel, niet op het doek: daar kijkt de zaal.
      const titel = app.beeld.stand.clips === false ? `${TITEL} · alleen eigen beeld` : TITEL;
      if (document.title !== titel) document.title = titel;
      let rol = app.rolLos(window);
      // Inlopen: eigen video's bijsturen; het beeld zet het hoofdvenster erop. In de pas (of te lang)? Zelf mengen.
      if (rol === 'inloop' && !app.meldPas(window, mixer.loopIn(app.engine, app.beeld))) rol = 'mengt';
      if (rol === 'mengt') mixer.teken(app.engine, app.beeld);
      else if (rol !== 'inloop') mixer.pauzeerAlles();
    }
  } catch (err) {
    if (performance.now() - laatsteKlacht > 1000) { laatsteKlacht = performance.now(); console.error('[beeld]', err); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => { try { app?.meldAf(window); } catch (_) {} });
document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
});
