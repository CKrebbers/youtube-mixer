import { DECK_IDS } from '../engine/engine.js';
import { Beatgrid } from '../engine/beatgrid.js';
import { trackVanDeck } from '../control/actions.js';
import { LibraryPanel } from './library-panel.js';
import { computePeaks, rmsDb, laadPeaks } from '../analysis/peaks.js';
import { meld } from './meldingen.js';

/**
 * Laden en wat bij het geladen nummer hoort: de demotrack en losse bestanden
 * (via laadBuffer), library-nummers (streamend), het grid bewaren bij de link
 * en de tap-verfijning door de server.
 *
 * Hier wordt ook de golfvorm-analyse (`staat.analysis`) bijgehouden en welk
 * library-nummer er op welke track staat (`staat.deckTrack`).
 */
export function opzetLaden({ engine, staat, videoMixer, vensterVan, racks, haalSamples }) {
  const { deckTrack, analysis } = staat;
  const perDeck = (maak) => Object.fromEntries(DECK_IDS.map((id) => [id, maak(id)]));

  const laadTeller = perDeck(() => 0);
  const nieuweLaad = (id) => ++laadTeller[id];
  const nogDeLaatste = (id, nr) => laadTeller[id] === nr;
  const gridBewaard = perDeck(() => null);

  /**
   * Een los bestand of de demotrack hoort bij GEEN library-nummer. Zonder dit
   * bleef de track aan het vorige nummer hangen, en werd een getikt grid bij
   * dat nummer bewaard.
   */
  function losVanLibrary(id) {
    nieuweLaad(id);
    deckTrack[id] = null;
    gridBewaard[id] = null;
    racks.losVanNummer(id);
  }

  /**
   * Een AudioBuffer op een track, via de streamkern (één afspeelmotor): loops
   * zonder tik, declick en knippen zoals bij de library. False als er intussen
   * iets anders op deze track geladen werd.
   */
  async function laadBuffer(id, buf, titel) {
    losVanLibrary(id);
    const mijnLaad = laadTeller[id];
    let gelukt;
    try {
      gelukt = await engine.deck(id).laadGeheugen(buf, titel);
    } catch (err) {
      meld(`laden mislukt: ${err.message}`, 'fout');
      return false;
    }
    if (!gelukt || !nogDeLaatste(id, mijnLaad)) return false;
    videoMixer.zetBron(id, null);
    analysis[id] = computePeaks(buf);
    return true;
  }

  async function loadFile(id, file) {
    await engine.resume();
    let buf;
    try {
      buf = await engine.ctx.decodeAudioData(await file.arrayBuffer());
    } catch (err) {
      meld(`"${file.name}" is geen audio die de browser kan lezen`, 'fout');
      return;
    }
    if (!(await laadBuffer(id, buf, file.name.replace(/\.[^.]+$/, '')))) return;
    console.log(`[deck ${id}] ${file.name} — ${buf.duration.toFixed(1)}s — RMS ${rmsDb(buf).toFixed(1)} dBFS`);
  }

  /**
   * Het beatgrid hoort bij de link, dus het wordt daar bewaard.
   *
   * Dit draait op een eigen klok en niet vanuit de renderloop: een debounce die
   * je elk frame opnieuw start, vuurt nooit.
   */
  async function bewaarGrid() {
    {
      for (const id of DECK_IDS) {
        const trackId = deckTrack[id];
        if (!trackId) continue;
        const grid = engine.deck(id).grid;
        const tekst = grid ? JSON.stringify(grid.toJSON()) : 'null';
        if (tekst === gridBewaard[id]) continue;
        gridBewaard[id] = tekst;
        try {
          const res = await fetch(`/api/library/${trackId}/grid`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grid: grid ? grid.toJSON() : null }),
          });
          // fetch gooit niet bij een 404. Zonder deze controle denkt hij dat het
          // gelukt is en probeert hij het nooit meer.
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        } catch (err) {
          gridBewaard[id] = null;              // volgende ronde opnieuw proberen
          console.warn('[grid] niet bewaard:', err.message);
        }
      }
    }
  }
  setInterval(bewaarGrid, 1500);

  /**
   * De tap-hybride.
   *
   * Vier keer meetikken geeft het octaaf en de grove fase — precies wat een
   * machine op ambient niet betrouwbaar vindt. De server pakt daarna de bewaarde
   * onset-envelope erbij en verfijnt binnen 3% marge tot op honderdsten van een
   * bpm. Samen beter dan allebei apart.
   */
  let verfijnBezig = false;
  engine.on('tap', async ({ deck, bpm, taps }) => {
    if (taps < 4 || verfijnBezig) return;
    const trackId = deckTrack[deck];
    if (!trackId) return;                       // demotrack of losgesleept bestand
    verfijnBezig = true;
    const knop = vensterVan(deck) ? document.querySelector(`#venster-${vensterVan(deck)} .tap`) : null;
    knop?.classList.add('bezig');
    try {
      const res = await fetch(`/api/library/${trackId}/grid/verfijn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bpm }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const r = await res.json();
      // Intussen een ander nummer op deze track? Dan hoort dit grid er niet bij.
      // Gooien in plaats van return: dan loopt het opruimen hieronder gewoon.
      if (deckTrack[deck] !== trackId) throw new Error('intussen een ander nummer op deze track');
      const d = engine.deck(deck);
      d.setGrid(new Beatgrid({ bpm: r.bpm, firstBeat: r.firstBeat }));
      console.log(`[tap] deck ${deck}: ${bpm.toFixed(1)} getikt -> ${r.bpm.toFixed(2)} bpm`
        + ` (${r.verschuiving >= 0 ? '+' : ''}${r.verschuiving.toFixed(2)}), tel 1 op ${r.firstBeat.toFixed(3)}s`);
      knop?.classList.add('verfijnd');
      setTimeout(() => knop?.classList.remove('verfijnd'), 1200);
    } catch (err) {
      console.warn('[tap] verfijnen mislukt, jouw tap blijft staan:', err.message);
    }
    knop?.classList.remove('bezig');
    verfijnBezig = false;
  });

  // ---- library --------------------------------------------------------------
  // Het paneel praat met de server; het laden op een deck loopt hierlangs, want
  // hier wordt ook de golfvorm-analyse bijgehouden.

  const libPaneel = document.getElementById('lib-panel');
  const library = new LibraryPanel({
    root: libPaneel,
    decks: DECK_IDS,
    label: (id) => String(trackVanDeck(id)),
    stand: (id) => { const d = engine.deck(id); return !d.buffer ? 'leeg' : d.playing ? 'speelt' : 'geladen'; },
    onLaad: async (deckId, track) => {
      // NIET wachten op engine.resume(): zonder gebruikersgebaar lost die belofte
      // nooit in en blijft het laden eeuwig hangen. Laden kan prima op een
      // gepauzeerde context; hervatten proberen we daarna, en lukt dat niet dan
      // zeggen we het gewoon.
      // Streamen: alleen de kop en de eerste pagina's, niet het hele bestand.
      // Een uur kost zo een paar MB in plaats van 1,4 GB.
      const url = '/' + track.audio.replace(/^\//, '');
      // Klik je snel een tweede nummer op dezelfde track, dan wint dat. Deze
      // laad mag daarna niets meer zetten: geen titel, golfvorm, grid of video
      // van het verkeerde nummer.
      const mijnLaad = nieuweLaad(deckId);
      if (!(await engine.deck(deckId).laadStream(url, track.titel))) return null;
      const duur = engine.deck(deckId).duration;
      // Golfvorm uit de cache. Zelf uitrekenen kan niet meer: er is geen buffer.
      const uitCache = track.peaks ? await laadPeaks('/' + track.peaks.bestand.replace(/^\//, ''),
        { samplesPerBucket: track.peaks.perBucket, duration: track.duur || duur }) : null;
      if (!nogDeLaatste(deckId, mijnLaad)) return null;
      analysis[deckId] = uitCache;
      videoMixer.zetBron(deckId, track.video ? '/' + track.video.replace(/^\//, '') : null);
      deckTrack[deckId] = track.id;
      // Een eerder uitgemeten grid komt mee met de link.
      engine.deck(deckId).setGrid(track.grid || null);
      racks.haalRacks(deckId);
      haalSamples(deckId, track.id);
      gridBewaard[deckId] = track.grid ? JSON.stringify(track.grid) : 'null';
      console.log(`[deck ${deckId}] ${track.titel} — ${duur.toFixed(1)}s — streamt`
        + (uitCache ? '' : ' — LET OP: geen peaks.bin, dus geen golfvorm'));

      engine.resume().catch(() => {});
      if (engine.ctx.state !== 'running') {
        return { hint: 'druk op "audio starten" om geluid te krijgen' };
      }
      return null;
    },
  });

  return { laadBuffer, loadFile, library, libPaneel };
}
