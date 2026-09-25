import { DECK_IDS } from '../engine/engine.js';
import { trackVanDeck } from '../control/actions.js';
import { isTypen } from '../control/keyboard.js';
import { VideoMixer } from '../video/video-mixer.js';
import { meld } from './meldingen.js';

/**
 * Het videopaneel: de kolom naast de vensters, het losse venster en wat de
 * renderloop er elk frame op zet.
 *
 * Een eigen laag die de engine alleen uitleest (regel 1). Mengt de video's van
 * alle acht tracks op één canvas; het losse venster krijgt DAT canvas als
 * stream, zodat er maar één keer gemengd wordt.
 */
export function opzetVideo({ engine }) {
  const videoPaneel = document.getElementById('video-panel');
  const videoMixer = new VideoMixer({ canvas: videoPaneel.querySelector('.vid-canvas'), engine, decks: DECK_IDS });

  /** De video van een nummer ontbreekt of laadt niet: in de strook, niet alleen in de console. */
  const meldVideoFout = (id, tekst) => {
    if (!id) { meld(`video: ${tekst}`, 'fout'); return; }
    const titel = engine.deck(id)?.title;
    meld(`video van track ${trackVanDeck(id)}${titel ? ` (${titel})` : ''}: ${tekst}`, 'fout');
  };
  videoMixer.onFout = meldVideoFout;
  let losVenster = null;
  // Ook tijdens een video-opname renderen, anders neem je zwart op.
  const videoAan = () => !videoPaneel.classList.contains('hidden') || (losVenster && !losVenster.closed)
    || !!window.opnemer?.metVideo;
  const toggleVideo = () => {
    videoPaneel.classList.toggle('hidden');
    if (!videoAan()) videoMixer.pauzeerAlles();
  };
  document.getElementById('video-btn').addEventListener('click', toggleVideo);
  videoPaneel.querySelector('.vid-sluit').addEventListener('click', toggleVideo);
  videoPaneel.querySelector('.vid-los').addEventListener('click', () => {
    if (losVenster && !losVenster.closed) { losVenster.focus(); return; }
    losVenster = window.open('video.html', 'varve-video', 'width=960,height=540');
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !isTypen(e.target)) toggleVideo();
  });
  if (videoMixer.fout) console.warn('[video]', videoMixer.fout);

  /** Eén frame: mengen en de statusregel bijwerken, alleen als iemand kijkt of opneemt. */
  const teken = () => {
    if (videoAan()) {
      videoMixer.teken();
      const st = videoMixer.stand().filter((l) => l.video && l.speelt);
      const tekst = videoMixer.fout || (st.length ? st.map((l) => `${trackVanDeck(l.id)}: ${Math.round(l.verschil * 1000)} ms`).join(' · ') : 'geen zichtbare video');
      const modusEl = videoPaneel.querySelector('.vid-modus');
      if (modusEl.textContent !== videoMixer.modus) modusEl.textContent = videoMixer.modus;
      const fitEl = videoPaneel.querySelector('.vid-fit');
      if (fitEl && fitEl.textContent !== videoMixer.fit) fitEl.textContent = videoMixer.fit;
      const doelEl = videoPaneel.querySelector('.vid-pulsdoel');
      if (doelEl.textContent !== videoMixer.pulsDoel) doelEl.textContent = videoMixer.pulsDoel;
      const statusEl = videoPaneel.querySelector('.vid-status');
      if (statusEl.textContent !== tekst) statusEl.textContent = tekst;
    }
  };

  return { videoMixer, videoAan, teken };
}
