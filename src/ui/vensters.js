import { DECK_IDS } from '../engine/engine.js';
import { invoke, metaOf, trackVanDeck } from '../control/actions.js';
import { WaveformView } from './waveform.js';
import { Knob, bindButtons } from './controls.js';
import { renderDemoTrack } from '../analysis/demo-track.js';
import { volgFocus, zetTweede } from './spiegel-plan.js';

/**
 * De track met focus (bovenaan het scherm) en de vensters als MODEL.
 *
 * Er staan geen twee vensters meer op het scherm: het scherm spiegelt de APC
 * (spiegel.js). Maar het toetsenbord ({L}/{R}), `window.L/R.show.N`, video en
 * racks rekenen nog met `venster`. Betekenis sinds 23 september 2026:
 *   L = de track met focus (volgt engine.focus vanzelf)
 *   R = de track waar je daarvoor op zat, of wat je met window.R.show.N kiest
 * Zo bedient de linkerhand wat je groot ziet, en de rechterhand de track waar
 * je net vandaan komt — precies de twee tracks van een overgang.
 *
 * De focusweergave weet welke track hij toont via zijn data-action-attributen:
 * wisselen is die omschrijven. Knoppen lezen hun action bij het indrukken, de
 * renderloop leest ze elke frame — er hoeft niets opnieuw gebonden te worden.
 *
 * Hier staat ook het binden van alle knoppen, draaiknoppen en faders op het
 * scherm, want dat kan pas als de spiegel zijn elementen heeft neergezet.
 */

export const VENSTERS = ['L', 'R'];

/**
 * `venster` is het gedeelde object venster -> deck-id (in `staat`); het wordt
 * ter plekke bijgewerkt, want andere modules houden het vast. Laden komt van
 * buiten: die module wordt pas na deze opgezet, maar zijn functies worden
 * alleen bij een klik aangeroepen.
 */
export function opzetVensters({ engine, venster, laadBuffer, loadFile, naFocus }) {
  const root = document.getElementById('focus-deck');
  const knobs = [];

  document.querySelectorAll('.knob').forEach((el) => knobs.push(new Knob(el)));
  bindButtons(document.body);

  // Ook de gespiegelde faders zonder action (nog): die krijgen er een zodra
  // de mapping binnen is, en lezen hem bij elke beweging opnieuw.
  const faders = [...document.querySelectorAll('input[type=range][data-action], input[type=range].spg')];
  faders.forEach((el) => {
    el.addEventListener('input', () => {
      const a = el.dataset.action;
      if (a && metaOf(a)?.type === 'value') invoke(a, parseFloat(el.value));
    });
  });
  // Na loslaten de focus teruggeven: een fader met focus volgt MIDI niet meer
  // (volgEngine slaat hem over) en vangt de pijltjestoetsen.
  document.addEventListener('pointerup', (e) => {
    const el = e.target.closest?.('input[type=range]');
    if (el) setTimeout(() => el.blur(), 0);
  });
  document.addEventListener('change', (e) => { if (e.target.matches?.('select')) e.target.blur(); });

  /** De focusweergave (en de RACK-rij in het focusdeel) op de track met focus zetten. */
  function herschrijfFocus() {
    const deckId = venster.L;
    const nr = trackVanDeck(deckId);
    const naarTrack = (a) => a.replace(/^track\.\d+\./, `track.${nr}.`);
    for (const r of [root, document.querySelector('#focusdeel .fx-row')]) {
      r.dataset.deck = deckId;
      r.querySelectorAll('[data-action]').forEach((el) => {
        el.dataset.action = naarTrack(el.dataset.action);
        if (el.dataset.actionShift) el.dataset.actionShift = naarTrack(el.dataset.actionShift);
      });
    }
    for (const k of knobs) if (root.contains(k.el)) k.action = k.el.dataset.action;
    root.querySelector('.deck-id').textContent = nr;
  }

  /** De focus is veranderd (door wie dan ook): het model volgt, het scherm ook. */
  function volg() {
    const nieuw = volgFocus(venster, engine.focus);
    if (nieuw === venster) return;
    Object.assign(venster, nieuw);
    herschrijfFocus();
    naFocus(venster.L);
  }
  engine.on('change', volg);

  /**
   * De oude "zet een track in een venster", voor `window.L/R.show.N`:
   * L = focus erop, R = als tweede zetten (de rechterhand op het toetsenbord).
   */
  function toonInVenster(v, deckId) {
    if (v === 'L') { engine.setFocus(deckId); volg(); return; }
    Object.assign(venster, zetTweede(venster, deckId));
  }

  // Begin: L is de focus, R de track ernaast.
  if (venster.L !== engine.focus) Object.assign(venster, volgFocus(venster, engine.focus));
  herschrijfFocus();

  const views = {
    zoom: new WaveformView(root.querySelector('.wave-zoom'), { mode: 'zoom', color: '#4ad9c4' }),
    overview: new WaveformView(root.querySelector('.wave-overview'), { mode: 'overview', color: '#2f8e81' }),
    root,
  };

  // klikken op overview = springen
  root.querySelector('.wave-overview').addEventListener('pointerdown', (e) => {
    const d = engine.deck(venster.L);
    if (!d.buffer) return;
    const r = e.currentTarget.getBoundingClientRect();
    d.seek(((e.clientX - r.left) / r.width) * d.duration);
  });

  // drop op de grote weergave = laden op de track met focus
  const groot = [root.querySelector('.wave-zoom'), root.querySelector('.wave-overview')];
  for (const el of groot) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drag'); });
    el.addEventListener('dragleave', () => root.classList.remove('drag'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); root.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (file) await loadFile(venster.L, file);
    });
  }

  root.querySelector('.demo-btn').addEventListener('click', async () => {
    await engine.resume();
    const id = venster.L;
    const buf = renderDemoTrack(engine.ctx, { seed: DECK_IDS.indexOf(id), bars: 16 });
    await laadBuffer(id, buf, `demo ${trackVanDeck(id)} — 124 bpm`);
  });

  return { toonInVenster, views, knobs, faders };
}
