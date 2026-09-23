import { DECK_IDS } from '../engine/engine.js';
import { invoke, trackVanDeck } from '../control/actions.js';
import { WaveformView } from './waveform.js';
import { Knob, bindButtons } from './controls.js';
import { renderDemoTrack } from '../analysis/demo-track.js';

/**
 * Vensters en tracks.
 *
 * Acht tracks, twee vensters. Een venster is een grote weergave (golfvorm,
 * transport, FX) plus zijn mixerstrook, en toont één track naar keuze. Het
 * venster weet dat alleen via zijn data-action-attributen: wisselen is die
 * omschrijven. Knoppen lezen hun action bij het indrukken, de renderloop leest
 * ze elke frame — er hoeft niets opnieuw gebonden te worden.
 *
 * Hier staat ook het binden van alle knoppen, draaiknoppen en faders op het
 * scherm, want dat kan pas als de trackrij er staat.
 */

export const VENSTERS = ['L', 'R'];

/**
 * `venster` is het gedeelde object venster -> deck-id (in `staat`). Laden en
 * racks komen van buiten: die modules worden pas na deze opgezet, maar hun
 * functies worden alleen bij een klik aangeroepen.
 */
export function opzetVensters({ engine, venster, laadBuffer, loadFile, naWissel }) {
  const vensterVan = (deckId) => VENSTERS.find((v) => venster[v] === deckId) || null;
  const vensterRoots = (v) => [document.getElementById(`venster-${v}`),
    document.querySelector(`.strip[data-venster="${v}"]`)];
  const views = {};
  const knobs = [];

  /** De rij met acht smalle tracks. Eerst bouwen: daarna worden alle knoppen gebonden. */
  const tracksEl = document.getElementById('tracks');
  tracksEl.innerHTML = DECK_IDS.map((id) => {
    const nr = trackVanDeck(id);
    return `<div class="trk" data-deck="${id}">
    <div class="trk-kop">
      <button data-kind="button" data-action="track.${nr}.focus" class="trk-nr" title="focus op deze track (spatie, sampler en de APC volgen hem)">${nr}</button>
      <button data-kind="button" data-action="track.${nr}.play" class="trk-play" title="play/pauze">▶</button>
      <span class="trk-titel">— leeg —</span>
    </div>
    <div class="meter trk-meter"><i></i></div>
    <input type="range" class="hfader trk-fader" min="0" max="1" step="0.001" value="1" data-action="track.${nr}.fader" title="fader">
    <div class="trk-sends">
      <div class="knob sm" data-action="track.${nr}.send.a" data-label="ECHO" data-value="0" data-default="0" title="send naar de gedeelde echo"></div>
      <div class="knob sm" data-action="track.${nr}.send.b" data-label="GALM" data-value="0" data-default="0" title="send naar de gedeelde galm"></div>
    </div>
    <div class="trk-knoppen">
      <div class="trk-kanten" title="crossfader: kant A, thru (altijd hoorbaar) of kant B">
        <button data-kind="button" data-action="track.${nr}.xfade.a" class="btn sm trk-kant" data-kant="A">A</button>
        <button data-kind="button" data-action="track.${nr}.xfade.thru" class="btn sm trk-kant" data-kant="thru">thru</button>
        <button data-kind="button" data-action="track.${nr}.xfade.b" class="btn sm trk-kant" data-kant="B">B</button>
      </div>
      <button class="btn sm trk-toon" data-toon="L" title="toon in het linkervenster">L</button>
      <button class="btn sm trk-toon" data-toon="R" title="toon in het rechtervenster">R</button>
    </div>
  </div>`;
  }).join('');

  document.querySelectorAll('.knob').forEach((el) => knobs.push(new Knob(el)));
  bindButtons(document.body);

  const faders = [...document.querySelectorAll('input[type=range][data-action]')];
  faders.forEach((el) => {
    el.addEventListener('input', () => invoke(el.dataset.action, parseFloat(el.value)));
  });
  // Na loslaten de focus teruggeven: een fader met focus volgt MIDI niet meer
  // (volgEngine slaat hem over) en vangt de pijltjestoetsen.
  document.addEventListener('pointerup', (e) => {
    const el = e.target.closest?.('input[type=range]');
    if (el) setTimeout(() => el.blur(), 0);
  });
  document.addEventListener('change', (e) => { if (e.target.matches?.('select')) e.target.blur(); });

  tracksEl.addEventListener('click', (e) => {
    const knop = e.target.closest('.trk-toon');
    if (knop) toonInVenster(knop.dataset.toon, knop.closest('.trk').dataset.deck);
  });

  /**
   * Zet een track in een venster. Staat hij al in het andere, dan ruilen ze:
   * twee vensters op dezelfde track is alleen verwarrend.
   */
  function toonInVenster(v, deckId) {
    const ander = VENSTERS.find((x) => x !== v && venster[x] === deckId);
    if (ander) { venster[ander] = venster[v]; herschrijfVenster(ander); }
    venster[v] = deckId;
    herschrijfVenster(v);
    engine.setFocus(deckId);
  }

  function herschrijfVenster(v) {
    const deckId = venster[v];
    const nr = trackVanDeck(deckId);
    const naarTrack = (a) => a.replace(/^track\.\d+\./, `track.${nr}.`);
    for (const root of vensterRoots(v)) {
      root.dataset.deck = deckId;
      root.querySelectorAll('[data-action]').forEach((el) => {
        el.dataset.action = naarTrack(el.dataset.action);
        if (el.dataset.actionShift) el.dataset.actionShift = naarTrack(el.dataset.actionShift);
      });
    }
    for (const k of knobs) if (vensterRoots(v).some((r) => r.contains(k.el))) k.action = k.el.dataset.action;
    document.querySelector(`#venster-${v} .deck-id`).textContent = nr;
    // Rackkiezer en rack-editor volgen de nieuwe track (zie racks.js).
    naWissel(deckId);
  }

  for (const v of VENSTERS) {
    const root = document.getElementById(`venster-${v}`);
    views[v] = {
      zoom: new WaveformView(root.querySelector('.wave-zoom'), { mode: 'zoom', color: v === 'L' ? '#4ad9c4' : '#c48cff' }),
      overview: new WaveformView(root.querySelector('.wave-overview'), { mode: 'overview', color: v === 'L' ? '#2f8e81' : '#7d5aa8' }),
      root,
    };

    // klikken op overview = springen
    root.querySelector('.wave-overview').addEventListener('pointerdown', (e) => {
      const d = engine.deck(venster[v]);
      if (!d.buffer) return;
      const r = e.currentTarget.getBoundingClientRect();
      d.seek(((e.clientX - r.left) / r.width) * d.duration);
    });

    // focus volgt de klik
    root.addEventListener('pointerdown', () => engine.setFocus(venster[v]));

    // drop
    root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drag'); });
    root.addEventListener('dragleave', () => root.classList.remove('drag'));
    root.addEventListener('drop', async (e) => {
      e.preventDefault(); root.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (file) await loadFile(venster[v], file);
    });

    root.querySelector('.demo-btn').addEventListener('click', async () => {
      await engine.resume();
      const id = venster[v];
      const buf = renderDemoTrack(engine.ctx, { seed: DECK_IDS.indexOf(id), bars: 16 });
      await laadBuffer(id, buf, `demo ${trackVanDeck(id)} — 124 bpm`);
    });
  }

  return { vensterVan, toonInVenster, views, knobs, faders, tracksEl };
}
