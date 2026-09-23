import { VormLaag } from './laag.js';
import { BUDGET_WERKER } from './budget.js';

/**
 * De Worker van een vormlaag (stap 3, docs/plugins/01-plan.md): hier draait
 * het systeem op een OffscreenCanvas, zodat een zware vorm (cl, ln, gs, sp —
 * sp piekt tot 82 ms) de hoofdthread niet stillegt. Daar lopen MIDI, de
 * LED's, de StreamBron-pagina's en de videosync; een lange taak daar is een
 * late cue.
 *
 * Eén Worker per laag: een zware laag houdt de andere niet op, en elke laag
 * heeft zijn eigen budget. Binnen de Worker draait gewoon een VormLaag in
 * hoofd-modus (laag.js): dezelfde stappen van 1/60 s, hetzelfde budget, één
 * waarheid. Alleen het budget is ruimer (BUDGET_WERKER): hier blokkeert niets.
 *
 * Berichten van de hoofdthread (alleen gegevens, geen functies):
 *   { type: 'kies', systeem, zaad, maat, budgetMs, kwaliteit }  systeem (opnieuw) starten
 *   { type: 'params', p: { naam: waarde } }                      parameters in eigen eenheid
 *   { type: 'kwaliteit', v }                                     kwaliteit met de hand
 *   { type: 'frame', t }                                         bijwerken tot t (audioklok, s)
 * Terug:
 *   { type: 'beeld', bitmap | null, ms, kwaliteit, teZwaar }     op ELK frame-verzoek precies één
 *   { type: 'noodrem', systeem, ms, budget, kwaliteit }
 *   { type: 'fout', bericht }                                    ook dan geen 'beeld'
 *
 * Het beeld gaat als ImageBitmap terug (transferable, geen kopie over de
 * grens). Met createImageBitmap(canvas), NIET transferToImageBitmap(): dat
 * laat het canvas leeg achter, en de meeste vormen tekenen verder op hun
 * vorige beeld (sporen, fade). Een kopie van 512² kost weinig.
 *
 * `draaiWerker(zelf, …)` is de logica als functie van een 'self'-achtig
 * object, zodat de test hem in Node kan draaien zonder echte Worker. Alleen
 * als dit bestand ECHT als Worker geladen is, start hij vanzelf.
 */

export function draaiWerker(zelf, { maakCanvas, maakBitmap, nu }) {
  let laag = null;
  const stand = () => ({ ms: laag.ms, kwaliteit: laag.kwaliteit, teZwaar: laag.teZwaar });
  const fout = (e) => zelf.postMessage({ type: 'fout', bericht: e?.message ?? String(e) });

  function kies(m) {
    if (!laag) {
      laag = new VormLaag({ maakCanvas, werker: false, systeem: m.systeem, zaad: m.zaad, maat: m.maat,
        budgetMs: m.budgetMs ?? BUDGET_WERKER, nu, kwaliteit: m.kwaliteit });
      laag.on('noodrem', (info) => zelf.postMessage({ type: 'noodrem', ...info }));
    } else {
      laag.zaad = m.zaad;
      laag.zetSysteem(m.systeem, m.kwaliteit);
    }
  }

  function frame(m) {
    if (!laag) { zelf.postMessage({ type: 'beeld', bitmap: null, ms: null, kwaliteit: 1, teZwaar: false }); return; }
    const voor = laag.versie;
    laag.frame(m.t);
    if (laag.versie === voor) { zelf.postMessage({ type: 'beeld', bitmap: null, ...stand() }); return; }
    const gemeten = stand();
    maakBitmap(laag.canvas).then(
      (bitmap) => zelf.postMessage({ type: 'beeld', bitmap, ...gemeten }, [bitmap]),
      fout);
  }

  zelf.addEventListener('message', (e) => {
    const m = e.data;
    try {
      if (m.type === 'kies') kies(m);
      else if (m.type === 'params') laag?.zetParams(m.p);
      else if (m.type === 'kwaliteit') laag?.zetKwaliteit(m.v);
      else if (m.type === 'frame') frame(m);
    } catch (err) {
      fout(err);
    }
  });
}

// Alleen als echte Worker: in Node (tests) of op de hoofdthread gebeurt hier niets.
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  draaiWerker(globalThis, {
    maakCanvas: (w, h) => new OffscreenCanvas(w, h),
    maakBitmap: (c) => createImageBitmap(c),
    nu: () => performance.now(),
  });
}
