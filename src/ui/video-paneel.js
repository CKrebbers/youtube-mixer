import { DECK_IDS } from '../engine/engine.js';
import { trackVanDeck, read as leesAction } from '../control/actions.js';
import { VideoMixer } from '../video/video-mixer.js';
import { Beamer } from '../video/beamer.js';
import { meld } from './meldingen.js';

/**
 * Het videopaneel: de kolom naast de vensters, het losse venster en wat de
 * renderloop er elk frame op zet.
 *
 * Een eigen laag die de engine alleen uitleest (regel 1). Mengt de video's van
 * alle acht tracks op één canvas. Staat het losse venster open, dan mengt
 * DAT (src/video/beamer.js): het blijft lopen als dit tabblad verborgen is.
 * Het paneel toont dan zijn beeld, er wordt nog steeds één keer gemengd.
 * Behalve tijdens de inloop: dan mengt het hoofdvenster nog, en toont het
 * losse venster dit canvas tot zijn eigen video's in de pas lopen.
 *
 * `api` wordt `window.varveBeamer`: daar meldt het losse venster zich aan en
 * leest het de engine en de mixer van hier.
 */
export function opzetVideo({ engine }) {
  const videoPaneel = document.getElementById('video-panel');
  const canvasEl = videoPaneel.querySelector('.vid-canvas');
  const voorbeeld = videoPaneel.querySelector('.vid-voorbeeld');
  const videoMixer = new VideoMixer({ canvas: canvasEl, engine, decks: DECK_IDS });
  const beamer = new Beamer();

  /** De video van een nummer ontbreekt of laadt niet: in de strook, niet alleen in de console. */
  const meldVideoFout = (id, tekst) => {
    if (!id) { meld(`video: ${tekst}`, 'fout'); return; }
    const titel = engine.deck(id)?.title;
    meld(`video van track ${trackVanDeck(id)}${titel ? ` (${titel})` : ''}: ${tekst}`, 'fout');
  };
  videoMixer.onFout = meldVideoFout;

  const paneelOpen = () => !videoPaneel.classList.contains('hidden');
  /** Waar een LOPENDE video-opname zijn beeld vandaan haalt, of null. */
  const opname = () => (window.opnemer?.metVideo ? beamer.opnameWaar : null);
  const wie = () => beamer.wieMengt({ paneelOpen: paneelOpen(), opname: opname(),
    hoofdVerborgen: document.hidden, nu: performance.now() });

  beamer.onWeg = () => {
    if (opname() === 'los') {
      meld('het losse venster ging dicht tijdens een video-opname: het beeld in die opname staat vanaf hier stil (het geluid loopt door) — stop de opname en start een nieuwe', 'fout');
    }
  };

  const toggleVideo = () => {
    videoPaneel.classList.toggle('hidden');
    if (!wie().hoofd) videoMixer.pauzeerAlles();
  };
  // Alleen de knop, geen sneltoets: V is keylock van de focus-track (keyboard.js).
  document.getElementById('video-btn').addEventListener('click', toggleVideo);
  videoPaneel.querySelector('.vid-sluit').addEventListener('click', toggleVideo);
  videoPaneel.querySelector('.vid-los').addEventListener('click', () => {
    // Na herladen van dit tabblad kennen we het venster alleen nog doordat
    // het zich weer aanmeldde: window.open met dezelfde naam zou het herladen.
    const los = beamer.levend();
    if (los) { los.venster.focus(); return; }
    window.open('video.html', 'varve-video', 'width=960,height=540');
  });
  if (videoMixer.fout) console.warn('[video]', videoMixer.fout);

  /**
   * Het beeld van het losse venster in het paneel (of niets). captureStream
   * kost weinig vergeleken met nog eens mengen; verborgen kijkt er niemand,
   * dan staat de stream uit.
   */
  let voorbeeldVan = null;
  function zetVoorbeeld(bron) {
    if (document.hidden) bron = null;
    if (bron === voorbeeldVan) return;
    voorbeeld.srcObject?.getTracks().forEach((t) => t.stop());
    voorbeeld.srcObject = null;
    voorbeeldVan = bron;
    if (bron) {
      try { voorbeeld.srcObject = bron.captureStream(30); voorbeeld.play().catch(() => {}); } catch (err) {
        console.warn('[video] voorbeeld van het losse venster:', err.message);
      }
    }
    canvasEl.classList.toggle('verstopt', !!bron);
    voorbeeld.classList.toggle('verstopt', !bron);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) zetVoorbeeld(null); });

  // De noodknoppen (zwart, bevries, flits) en het knopje clips: hun stand komt
  // van de bus (read), zoals bij elke knop die ook via de APC of een log kan wisselen.
  // Clips staat in de rij van de deck-video's (mix, passend, clips), niet in de kop:
  // daar kostte hij de statusregel 57 px (review 10 okt), en in de BEELD-rij brak
  // die op 1440 breed in twee regels.
  const busKnoppen = [...videoPaneel.querySelectorAll('.vid-nood [data-kind="button"], .vid-clips')];
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };
  // Clips uit (video.clips, het zaalbeeld): de knop video zegt het in amber, ook met
  // het paneel dicht; de tekst blijft "video", anders schuift de bovenbalk opzij
  // (8 px speling op 1440 breed). NIET op het doek: daar kijkt de zaal (docs/BEAMER.md "Zaalbeeld").
  const videoKnop = document.getElementById('video-btn');
  const VIDEO_TITEL = videoKnop.title;
  const VIDEO_TITEL_UIT = `${VIDEO_TITEL} — nu: alleen eigen beeld (clips uit, video.clips)`;
  const zetVideoKnop = () => {
    const uit = !videoMixer.clips;
    klasse(videoKnop, 'clips-uit', uit);
    titel(videoKnop, uit ? VIDEO_TITEL_UIT : VIDEO_TITEL);
  };
  // De statusregel is smal (op 1440 breed ~135 px): kort, de uitleg in de title.
  const CLIPS_UIT = 'clips uit';
  const CLIPS_UIT_UITLEG = 'alleen eigen beeld: de deck-video\'s staan uit (video.clips); vormen, effecten en zwart lopen door';

  /** Eén frame: mengen als het hier moet, en de statusregel bijwerken. */
  const teken = () => {
    const w = wie();
    const los = beamer.levend();
    if (w.hoofd) videoMixer.teken();
    else videoMixer.pauzeerAlles();
    // Inloop: dit beeld ook op het losse venster, nu het nog in de buffer staat.
    if (w.inloop) los.mixer.toonBeeld(canvasEl);
    zetVoorbeeld(w.voorbeeld ? los.mixer.canvas : null);
    zetVideoKnop();
    if (!paneelOpen()) return;
    const bron = w.hoofd || !los ? videoMixer : los.mixer;
    const st = bron.stand().filter((l) => l.video && l.speelt);
    const wat = !videoMixer.clips ? CLIPS_UIT
      : st.length ? st.map((l) => `${trackVanDeck(l.id)}: ${Math.round(l.verschil * 1000)} ms`).join(' · ') : 'geen zichtbare video';
    const tekst = bron.fout || `${w.los ? 'beamer · ' : w.inloop ? 'beamer loopt in · ' : ''}${wat}`;
    const modusEl = videoPaneel.querySelector('.vid-modus');
    if (modusEl.textContent !== videoMixer.modus) modusEl.textContent = videoMixer.modus;
    const fitEl = videoPaneel.querySelector('.vid-fit');
    if (fitEl && fitEl.textContent !== videoMixer.fit) fitEl.textContent = videoMixer.fit;
    const doelEl = videoPaneel.querySelector('.vid-pulsdoel');
    if (doelEl.textContent !== videoMixer.pulsDoel) doelEl.textContent = videoMixer.pulsDoel;
    for (const b of busKnoppen) {
      // Zwart brandt ook zolang de drukvariant vastzit (shift + vasthouden).
      const extra = b.dataset.actionShift ? leesAction(b.dataset.actionShift) === 1 : false;
      klasse(b, 'on', leesAction(b.dataset.action) === 1 || extra);
    }
    const statusEl = videoPaneel.querySelector('.vid-status');
    if (statusEl.textContent !== tekst) statusEl.textContent = tekst;
    const waar = w.los ? 'het losse venster mengt (het loopt door als dit tabblad verborgen is)'
      : w.inloop ? 'het losse venster toont dit beeld tot zijn eigen video\'s in de pas lopen; dan mengt het zelf' : '';
    titel(statusEl, videoMixer.clips ? waar : waar ? `${CLIPS_UIT_UITLEG} · ${waar}` : CLIPS_UIT_UITLEG);
  };

  /** Het canvas voor een nieuwe video-opname, en onthouden waar het vandaan komt. */
  const opnameCanvas = () => beamer.opnameCanvas(videoMixer.canvas);

  /** Wat het losse venster van hier gebruikt (window.varveBeamer). */
  const api = {
    engine,
    videoMixer,
    // performance.now() hier is die van DIT venster, ook als het losse venster
    // de functie aanroept: de inloop rekent met één klok.
    meldAan: (venster, mixer) => beamer.meldAan(venster, mixer, performance.now()),
    meldAf: (venster) => beamer.meldAf(venster),
    mengtLos: (venster) => beamer.mengtLos(venster, wie()),
    rolLos: (venster) => beamer.rolLos(venster, wie()),
    meldPas: (venster, pas) => beamer.meldPas(venster, pas, performance.now()),
    losOpen: () => !!beamer.levend(),       // voor de console en tools/headless/beamer.mjs
    opnameUitLos: () => opname() === 'los',
    meldVideoFout,
  };

  return { videoMixer, teken, opnameCanvas, api, beamer };
}
