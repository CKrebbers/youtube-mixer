import { VormLagen } from '../vormen/laag.js';
import { SYSTEMEN } from '../vormen/systemen.js';
import { bindVormen, VORM_KNOPPEN } from '../control/actions.js';

/**
 * De vormlagen op het scherm: een rij onder de video-effecten, alleen als de
 * vlag aan staat. Zet ?vormen=1 achter de url (en ?vormen=0 om uit te zetten);
 * de browser onthoudt het. Zonder vlag wordt hier niets gemaakt, gebonden of
 * geladen: de app is dan dezelfde als zonder dit bestand.
 *
 * Moet vóór opzetVensters draaien: die zoekt alle `.knob` en `[data-action]`
 * in het document op en bindt ze. Wat hier neergezet wordt, doet dus vanzelf
 * mee met de muis, de APC en het terugvolgen via read().
 */

const SLEUTEL = 'varve.vormen';

export function vormenAan(url = location.href) {
  const v = new URL(url).searchParams.get('vormen');
  try {
    if (v === '1') localStorage.setItem(SLEUTEL, '1');
    if (v === '0') localStorage.removeItem(SLEUTEL);
    return localStorage.getItem(SLEUTEL) === '1';
  } catch (_) {
    return v === '1';
  }
}

/** Een 2D-canvas buiten het document: OffscreenCanvas waar het kan. */
const maakCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(w, h)
  : Object.assign(document.createElement('canvas'), { width: w, height: h }));

export function opzetVormen({ videoMixer }) {
  const vormen = new VormLagen({ maakCanvas });
  vormen.lagen.forEach((laag) => videoMixer.voegBeeldlaagToe(laag));
  bindVormen(vormen);

  const rij = document.createElement('div');
  rij.className = 'vid-vorm';
  rij.innerHTML = `
    <span class="vid-vorm-kop">VORM</span>
    ${vormen.lagen.map((_, i) => `<button data-kind="button" data-action="video.layer.select.${i + 1}" class="btn sm vorm-kies">${i + 1}</button>`).join('')}
    <button data-kind="button" data-action="video.layer.on" class="btn sm vorm-aan" title="laag aan of uit (APC: On/Off in het mapje vorm)">uit</button>
    <button data-kind="button" data-action="video.layer.prev" class="btn sm" title="vorige vorm (APC: Device ◀)">◀</button>
    <select class="vorm-kies-systeem" title="welke vorm">${SYSTEMEN.map((s) => `<option value="${s.id}">${s.naam}</option>`).join('')}</select>
    <button data-kind="button" data-action="video.layer.next" class="btn sm" title="volgende vorm (APC: Device ▶)">▶</button>
    <button data-kind="button" data-action="video.layer.blend" class="btn sm vorm-meng" title="hoe de vorm over de video valt">screen</button>
    <span class="vid-sep"></span>
    <div class="knob sm" data-action="video.layer.opacity" data-label="DEKKING" data-value="0.8" data-default="0.8"></div>
    ${Array.from({ length: VORM_KNOPPEN }, (_, k) => `<div class="knob sm vorm-knop" data-action="video.layer.knob.${k + 1}" data-label="" data-value="0.5"></div>`).join('')}
  `;
  document.querySelector('#video-panel .vid-fx').after(rij);

  const kiezer = rij.querySelector('.vorm-kies-systeem');
  kiezer.addEventListener('change', () => vormen.zetSysteem(kiezer.value));

  /** Wat niet via read() terugkomt: namen, welke laag, aan/uit, mengvorm. */
  function volg() {
    const laag = vormen.laag;
    kiezer.value = laag.sys.id;
    rij.querySelectorAll('.vorm-kies').forEach((b, i) => b.classList.toggle('on', i === vormen.gekozen));
    const aan = rij.querySelector('.vorm-aan');
    aan.classList.toggle('on', laag.aan);
    aan.textContent = laag.aan ? 'aan' : 'uit';
    rij.querySelector('.vorm-meng').textContent = laag.mengvorm;
    rij.querySelectorAll('.vorm-knop').forEach((el, k) => {
      const kn = laag.knoppen[k];
      el.classList.toggle('leeg', !kn);
      const label = el.querySelector('.knob-label');
      if (label) label.textContent = kn ? kn.l.toUpperCase() : '';
      el.title = kn ? `${kn.l} (${kn.min}–${kn.max})` : '';
    });
  }
  vormen.on('change', volg);
  // De Knob-elementen worden pas in opzetVensters opgebouwd: dan pas labels zetten.
  queueMicrotask(volg);

  return { vormen };
}
