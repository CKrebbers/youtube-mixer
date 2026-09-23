import { Engine, DECK_IDS } from '../engine/engine.js';
import { esc, mmss, mb } from './dom.js';
import { EFFECTEN } from '../engine/fx.js';
import { bindEngine, bindVideo, bindApp, bijFout, invoke, read as readAction, metaOf, trackVanDeck } from '../control/actions.js';
import { attachKeyboard, isTypen } from '../control/keyboard.js';
import { MidiHub } from '../control/midi.js';
import { Mapping } from '../control/mapping.js';
import { Feedback } from '../control/feedback.js';
import { MidiLearn } from '../control/midi-learn.js';
import { MappingPanel } from './mapping-panel.js';
import { LearnMode } from './learn-mode.js';
import { LibraryPanel } from './library-panel.js';
import { RackEditor } from './rack-editor.js';
import { VideoMixer } from '../video/video-mixer.js';
import { Opnemer } from '../opname/opnemer.js';
import apc40mk2 from '../control/devices/apc40mk2.js';
import generic from '../control/devices/generic.js';
import { MidiMonitor } from './midi-monitor.js';
import { Beatgrid } from '../engine/beatgrid.js';
import { WaveformView } from './waveform.js';
import { Knob, bindButtons } from './controls.js';
import { computePeaks, rmsDb, laadPeaks } from '../analysis/peaks.js';
import { renderDemoTrack } from '../analysis/demo-track.js';
import { fmtTime } from '../lib/emitter.js';

const engine = new Engine();
bindEngine(engine);
window.engine = engine;   // handig in de console tijdens bouwen

const perDeck = (maak) => Object.fromEntries(DECK_IDS.map((id) => [id, maak(id)]));

// ---- video ----------------------------------------------------------------
// Een eigen laag die de engine alleen uitleest (regel 1). Mengt de video's van
// alle acht tracks op één canvas; het losse venster krijgt DAT canvas als
// stream, zodat er maar één keer gemengd wordt.
const videoPaneel = document.getElementById('video-panel');
const videoMixer = new VideoMixer({ canvas: videoPaneel.querySelector('.vid-canvas'), engine, decks: DECK_IDS });
window.videoMixer = videoMixer;
bindVideo(videoMixer);
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

// ---- opnemen --------------------------------------------------------------
// Wat uit de master komt, naar opnames/ op deze schijf. De lengte komt van
// de audioklok (de worklet telt frames), niet van een timer.
const opnemer = new Opnemer({ engine });
opnemer.onFout = (f) => meld(`opname: ${f}`, 'fout', 8000);
window.opnemer = opnemer;
// De tab sluiten of herladen tijdens een opname: eerst vragen. De audio staat
// grotendeels veilig op schijf, maar de laatste seconde en de video niet.
window.addEventListener('beforeunload', (e) => { if (opnemer.bezig) { e.preventDefault(); e.returnValue = ''; } });
const opnameKnop = document.getElementById('opname-btn');
const opnameSoort = document.getElementById('opname-soort');
// Je laatste keuze onthouden: gemak per browser, geen gegevens die ertoe doen.
try { opnameSoort.value = localStorage.getItem('varve.opnameSoort') || 'audio'; } catch (_) {}
opnameSoort.addEventListener('change', () => { try { localStorage.setItem('varve.opnameSoort', opnameSoort.value); } catch (_) {} });
opnameKnop.addEventListener('click', async () => {
  opnameKnop.classList.remove('gelukt', 'mislukt');
  if (!opnemer.bezig) {
    await engine.resume().catch(() => {});
    const r = await opnemer.start({ video: opnameSoort.value === 'video' ? videoMixer.canvas : null });
    if (!r.ok) { opnameKnop.textContent = 'opnemen mislukt'; opnameKnop.classList.add('mislukt'); opnameKnop.title = r.fout; }
    return;
  }
  // Stoppen vraagt een tweede klik binnen 3 s: één misklik mag een set niet afbreken.
  if (!opnameKnop.dataset.zeker) {
    opnameKnop.dataset.zeker = '1';
    opnameKnop.textContent = 'nog eens = stoppen';
    setTimeout(() => { delete opnameKnop.dataset.zeker; }, 3000);
    return;
  }
  delete opnameKnop.dataset.zeker;
  opnameKnop.textContent = 'afronden…';
  const r = await opnemer.stop();
  opnameKnop.classList.add(r.ok ? 'gelukt' : 'mislukt');
  opnameKnop.textContent = r.ok ? `✓ ${mmss(r.duur)} bewaard` : 'afronden mislukt';
  opnameKnop.title = r.ok
    ? `opnames/${r.bestand}${r.video ? ` en opnames/${r.video} (${mb(r.videoBytes)})` : ''}${r.waarschuwing ? ' — let op: ' + r.waarschuwing : ''}`
    : r.fout;
  setTimeout(() => { if (!opnemer.bezig) { opnameKnop.textContent = '● opnemen'; opnameKnop.classList.remove('gelukt'); } }, 6000);
});
const analysis = perDeck(() => null);
const views = {};
const knobs = [];

// ---- vensters en tracks ---------------------------------------------------
// Acht tracks, twee vensters. Een venster is een grote weergave (golfvorm,
// transport, FX) plus zijn mixerstrook, en toont één track naar keuze. Het
// venster weet dat alleen via zijn data-action-attributen: wisselen is die
// omschrijven. Knoppen lezen hun action bij het indrukken, de renderloop leest
// ze elke frame — er hoeft niets opnieuw gebonden te worden.

const VENSTERS = ['L', 'R'];
const venster = { L: 'A', R: 'B' };                       // venster -> deck-id
const vensterVan = (deckId) => VENSTERS.find((v) => venster[v] === deckId) || null;
const vensterRoots = (v) => [document.getElementById(`venster-${v}`),
  document.querySelector(`.strip[data-venster="${v}"]`)];

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
  vulRackKiezer(deckId);
  // De editor hoort bij wat je ziet. Toonde hij de track die hier wegging,
  // dan gaat hij mee naar de nieuwe.
  if (rackEditor.open && !vensterVan(rackEditor.deckId)) rackEditor.openVoor(deckId);
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

// ---- library --------------------------------------------------------------
// Het paneel praat met de server; het laden op een deck loopt hierlangs, want
// hier wordt ook de golfvorm-analyse bijgehouden.

/** Welk nummer staat op welk deck — nodig om het grid bij de juiste link te bewaren. */
const deckTrack = perDeck(() => null);
const laadTeller = perDeck(() => 0);
const nieuweLaad = (id) => ++laadTeller[id];
const nogDeLaatste = (id, nr) => laadTeller[id] === nr;

/**
 * Een los bestand of de demotrack hoort bij GEEN library-nummer. Zonder dit
 * bleef de track aan het vorige nummer hangen, en werd een getikt grid bij
 * dat nummer bewaard.
 */
function losVanLibrary(id) {
  nieuweLaad(id);
  deckTrack[id] = null;
  gridBewaard[id] = null;
  rackCache[id] = [];
  vulRackKiezer(id);
}
const gridBewaard = perDeck(() => null);

/*
 * Sampler-pads bij het nummer. Laad je een nummer, dan komen zijn bewaarde
 * pads als herinnering op de sampler: één klik op die (lege) pad knipt het
 * stuk opnieuw van schijf. Een pad die je vult van een library-nummer wordt
 * bewaard; shift op een lege, bewaarde pad vergeet hem.
 */
const sampler = engine.sampler;
// Een track die iets anders laadt, neemt zijn herinneringen mee weg.
for (const id of DECK_IDS) {
  engine.deck(id).on('load', () => {
    sampler.herinneringen.forEach((h, i) => { if (h?.deckId === id) sampler.herinneringen[i] = null; });
  });
}
async function haalSamples(deckId, trackId) {
  try {
    const r = await fetch(`/api/library/${trackId}/samples`);
    if (!r.ok) throw new Error(`${r.status}`);
    const { samples } = await r.json();
    if (deckTrack[deckId] !== trackId) return;      // intussen iets anders geladen
    for (const x of samples) {
      sampler.herinneringen[x.pad - 1] = { deckId, van: x.van, tot: x.tot, bpm: x.bpm, tellen: x.tellen, bron: trackVanDeck(deckId) };
    }
    if (samples.length) meld(`${samples.length} bewaarde sampler-pad${samples.length === 1 ? '' : 's'} van track ${trackVanDeck(deckId)} — klik een lege pad om hem terug te halen`);
  } catch (err) { meld(`sampler-pads van dit nummer niet geladen (${err.message})`, 'fout'); }
}
sampler.onGevuld = (n, info) => {
  const trackId = deckTrack[info.deckId];
  if (!trackId) return;                               // los bestand of demo: niets te bewaren
  sampler.herinneringen[n] = { ...info, bron: trackVanDeck(info.deckId) };
  fetch(`/api/library/${trackId}/samples`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pad: n + 1, van: info.van, tot: info.tot, tellen: info.tellen, bpm: info.bpm }),
  }).then((r) => { if (!r.ok) throw new Error(`${r.status}`); })
    .catch((err) => meld(`pad ${n + 1} niet bewaard (${err.message})`, 'fout'));
};
sampler.onVergeet = (n, h) => {
  const trackId = deckTrack[h.deckId];
  if (!trackId) return;
  fetch(`/api/library/${trackId}/samples/${n + 1}`, { method: 'DELETE' })
    .then((r) => { if (!r.ok) throw new Error(`${r.status}`); meld(`pad ${n + 1} vergeten`); })
    .catch((err) => meld(`pad ${n + 1} niet vergeten (${err.message})`, 'fout'));
};

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
  const knop = vensterVan(deck) ? els[vensterVan(deck)].tap : null;
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
    haalRacks(deckId);
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
window.library = library;

const toggleLib = () => {
  if (libPaneel.classList.contains('hidden')) sluitOnderpanelen('lib');
  libPaneel.classList.toggle('hidden');
  if (!libPaneel.classList.contains('hidden')) library.ververs();
};

/*
 * Eén paneel tegelijk onderin: library, rack-editor en MIDI lagen over
 * elkaar, en dan zag je niet welke bovenop lag. Openen sluit de andere;
 * Esc sluit wat er open is.
 */
function sluitOnderpanelen(behalve = null) {
  if (behalve !== 'lib') libPaneel.classList.add('hidden');
  if (behalve !== 'midi') midiPanel.classList.add('hidden');
  if (behalve !== 'rack' && rackEditor.open) rackEditor.sluit();
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !isTypen(e.target)) { libPaneel.classList.add('hidden'); midiPanel.classList.add('hidden'); }
});
document.getElementById('lib-btn').addEventListener('click', toggleLib);
libPaneel.querySelector('.lib-close').addEventListener('click', toggleLib);
window.addEventListener('keydown', (e) => {
  // B van bibliotheek. L was ook hotcue 3 rechts: dan deed één toets twee dingen.
  if (e.code === 'KeyB' && !isTypen(e.target)) toggleLib();
});

// ---- effect-racks per link ------------------------------------------------
// Een rack hoort bij het NUMMER, niet bij het deck. Laad je hetzelfde nummer
// morgen op een ander deck, dan komen zijn racks mee.

const rackCache = perDeck(() => []);


/** Rechtstreeks uit de DOM: `els` wordt pas verderop aangemaakt. Null als de track niet in beeld is. */
const fxEl = (deckId, klasse) => {
  const v = vensterVan(deckId);
  return v ? document.querySelector(`#venster-${v} ${klasse}`) : null;
};

/**
 * Racks van het nummer ophalen en het actieve laden. Dat laatste gebeurt ook
 * als de track niet in een venster staat: een rack klinkt, of je hem nu ziet
 * of niet.
 */
async function haalRacks(deckId) {
  const trackId = deckTrack[deckId];
  rackCache[deckId] = [];
  if (trackId) {
    try {
      const r = await fetch(`/api/library/${trackId}/racks`);
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      rackCache[deckId] = j.racks || [];
    } catch (err) { meld(`racks van dit nummer niet geladen (${err.message})`, 'fout'); }
  }
  // Intussen weer iets anders geladen? Dan hoort dit rack er niet bij.
  if (deckTrack[deckId] !== trackId) return;
  const actief = rackCache[deckId].find((x) => x.actief);
  const fx = engine.deck(deckId).fx;
  if (actief) {
    const fouten = fx.zetRack(actief.data, { herkomst: actief.id }).fouten;
    fouten.forEach((f) => console.warn(`[rack ${deckId}]`, f));
  } else if (typeof fx.herkomst === 'number') {
    // Een nummer zonder eigen rack mag het rack van het VORIGE nummer niet
    // houden: dan schreef "bewaar" daar overheen. Terug naar het standaardeffect.
    fx.standaard();
  }
  vulRackKiezer(deckId);
}

/**
 * De kiezer toont wat er KLINKT, niet wat er ooit gekozen is. Dat staat in
 * `fx.herkomst`: het library-id van het rack, of null als er intussen iets
 * anders in zit (volgend effect, een los effect). Dan staat er "niet bewaard"
 * en kan "bewaar" niet stilletjes over een bewaard rack heen schrijven.
 */
function vulRackKiezer(deckId) {
  const sel = fxEl(deckId, '.fx-rack');
  if (!sel) return;
  const eigen = deckTrack[deckId]
    ? `<optgroup label="van dit nummer">${rackCache[deckId].map((x) => `<option value="${x.id}">${esc(x.naam)}</option>`).join('')
      || '<option disabled>nog geen</option>'}</optgroup>`
    : '';
  const kant = sjablonen.length
    ? `<optgroup label="kant-en-klaar">${sjablonen.map((r, i) => `<option value="s:${i}">${esc(r.name)}</option>`).join('')}</optgroup>`
    : '';
  sel.innerHTML = '<option value="" disabled>— niet bewaard —</option>' + eigen + kant;
  volgRackKiezer(deckId);
}

/**
 * Kant-en-klare racks, uit `racks/sjablonen.json`. Data, geen code. Een
 * sjabloon laden geeft herkomst "s:<nr>": de kiezer weet dan wat er klinkt,
 * en bewaren maakt er een eigen rack van het nummer van — het sjabloon zelf
 * wordt nooit overschreven.
 */
let sjablonen = [];
fetch('racks/sjablonen.json')
  .then((r) => (r.ok ? r.json() : { racks: [] }))
  .then((d) => { sjablonen = d.racks || []; for (const v of VENSTERS) vulRackKiezer(venster[v]); })
  .catch((err) => console.warn('[rack] sjablonen niet geladen:', err.message));

function volgRackKiezer(deckId) {
  const sel = fxEl(deckId, '.fx-rack');
  if (!sel || document.activeElement === sel) return;
  const waarde = String(engine.deck(deckId).fx.herkomst ?? '');
  if (sel.value !== waarde) sel.value = waarde;
}


/**
 * Eén manier van bewaren, voor de FX-rij én de editor.
 *
 * Komt wat er klinkt uit een bewaard rack, dan gaat het daaroverheen. Anders
 * (of met alsNieuw) wordt het een nieuw rack. Daarna is het nieuwe of
 * bijgewerkte rack het actieve, en staat de kiezer erop.
 */
async function bewaarRack(deckId, { naam, alsNieuw = false } = {}) {
  const trackId = deckTrack[deckId];
  if (!trackId) throw new Error('alleen een nummer uit de library kan een rack bewaren');
  const fx = engine.deck(deckId).fx;
  if (naam) fx.hernoem(naam);
  // Alleen een echt library-id mag overschreven worden; een sjabloon niet.
  const id = alsNieuw || typeof fx.herkomst !== 'number' ? null : fx.herkomst;
  const res = await fetch(`/api/library/${trackId}/racks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, naam: fx.rackNaam, data: fx.naarJSON(), actief: true }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const { rack } = await res.json();
  fx.herkomst = rack.id;
  // Niet haalRacks(): die zet het actieve rack opnieuw, en dan hoor je een
  // kruisfade op iets wat al klinkt. Alleen de lijst bijwerken.
  const lijst = rackCache[deckId].filter((x) => x.id !== rack.id).map((x) => ({ ...x, actief: false }));
  rackCache[deckId] = [...lijst, rack].sort((a, b) => a.gemaakt - b.gemaakt);
  vulRackKiezer(deckId);
  return { rack, nieuw: id === null };
}

/**
 * Een melding onderaan het scherm, een paar seconden. Voor wat misgaat en
 * niet bij één knop hoort: een mislukte sync, een stream die hapert, een
 * bestand dat niet te lezen is. Tot nu toe stond dat alleen in de console,
 * en die leest niemand tijdens een set.
 */
const meldingen = document.getElementById('meldingen');
function meld(tekst, soort = 'info', duur = 5000) {
  const el = document.createElement('div');
  el.className = `melding ${soort}`;
  el.textContent = tekst;
  meldingen.append(el);
  while (meldingen.children.length > 4) meldingen.firstElementChild.remove();
  setTimeout(() => { el.classList.add('weg'); setTimeout(() => el.remove(), 400); }, duur);
  if (soort === 'fout') console.warn('[melding]', tekst);
}
window.meld = meld;
// Meldingen uit de engine en de bus: sync die niet kan, een pad die niet
// vult, een stream die hapert, een action die faalt.
engine.on('melding', ({ tekst, soort }) => meld(tekst, soort));
for (const id of DECK_IDS) engine.deck(id).on('fout', (tekst) => meld(`track ${trackVanDeck(id)}: ${tekst}`, 'fout'));
bijFout((id, err) => meld(`${id} faalde: ${err.message}`, 'fout'));

/** Kort op de knop zelf laten zien wat er gebeurde; de console leest niemand. */
function meldOpKnop(knop, tekst, goed) {
  clearTimeout(knop._melding);
  knop.dataset.tekst ??= knop.textContent;
  knop.textContent = tekst;
  knop.classList.toggle('gelukt', goed);
  knop.classList.toggle('mislukt', !goed);
  knop._melding = setTimeout(() => {
    knop.textContent = knop.dataset.tekst;
    knop.classList.remove('gelukt', 'mislukt');
  }, goed ? 1500 : 4000);
}

for (const v of VENSTERS) {
  const kiezer = document.querySelector(`#venster-${v} .fx-rack`);
  kiezer.addEventListener('change', () => {
    const id = venster[v];
    if (kiezer.value.startsWith('s:')) {
      const sjabloon = sjablonen[Number(kiezer.value.slice(2))];
      if (sjabloon) engine.deck(id).fx.zetRack(sjabloon, { herkomst: kiezer.value }).fouten.forEach((f) => console.warn(`[rack ${id}]`, f));
      kiezer.blur();
      return;
    }
    const rack = rackCache[id].find((x) => String(x.id) === kiezer.value);
    if (!rack) return;
    zetRackVan(id, rack);
    kiezer.blur();
  });

  const knop = document.querySelector(`#venster-${v} .fx-bewaar`);
  knop.addEventListener('click', async () => {
    const id = venster[v];
    const fx = engine.deck(id).fx;
    if (!deckTrack[id]) { meldOpKnop(knop, 'geen library-nummer', false); return; }
    // Een nieuw rack heeft een naam nodig. Geen prompt(): zo'n venster legt
    // de hele pagina stil, ook MIDI, LED's en het ophalen van de stream.
    // De editor heeft een naamveld; daar gaan we heen.
    if (typeof fx.herkomst !== 'number') {
      rackEditor.openVoor(id);
      const veld = document.querySelector('#rack-editor .re-naam');
      veld.focus(); veld.select();
      meld('geef het rack een naam en klik "bewaar"');
      return;
    }
    try {
      const { nieuw } = await bewaarRack(id, {});
      meldOpKnop(knop, nieuw ? 'nieuw ✓' : 'bewaard ✓', true);
    } catch (err) {
      meldOpKnop(knop, 'mislukt', false);
      knop.title = err.message;
    }
  });
}

// ---- rack-editor ----------------------------------------------------------

const rackEditor = new RackEditor({
  root: document.getElementById('rack-editor'),
  engine,
  naamVan: (id) => `track ${trackVanDeck(id)}`,
  trackVan: trackVanDeck,
  effecten: EFFECTEN,
  kanBewaren: (id) => !!deckTrack[id],
  onBewaar: async ({ deckId, naam, alsNieuw }) => bewaarRack(deckId, { naam, alsNieuw }),
});
rackEditor.onOpen = () => sluitOnderpanelen('rack');

for (const v of VENSTERS) {
  document.querySelector(`#venster-${v} .fx-bewerk`).addEventListener('click', () => {
    const id = venster[v];
    if (rackEditor.open && rackEditor.deckId === id) rackEditor.sluit();
    else rackEditor.openVoor(id);
  });
}
for (const v of VENSTERS) vulRackKiezer(venster[v]);
/** Een rack van een nummer aanzetten, zoals de kiezer het doet. */
function zetRackVan(id, rack) {
  rackCache[id].forEach((x) => { x.actief = x === rack; });
  engine.deck(id).fx.zetRack(rack.data, { herkomst: rack.id }).fouten.forEach((f) => console.warn(`[rack ${id}]`, f));
  fetch(`/api/library/${deckTrack[id]}/racks/${rack.id}`, { method: 'POST' }).catch(() => {});
}

// Door de racks bladeren (APC): eerst die van het nummer, dan de kant-en-klare.
function rackStap(id, stap) {
  const lijst = [...rackCache[id].map((r) => ({ herkomst: r.id, zet: () => zetRackVan(id, r) })),
    ...sjablonen.map((r, i) => ({ herkomst: `s:${i}`, zet: () => engine.deck(id).fx.zetRack(r, { herkomst: `s:${i}` }) }))];
  if (!lijst.length) return;
  const nu = lijst.findIndex((x) => x.herkomst === engine.deck(id).fx.herkomst);
  lijst[(nu + stap + lijst.length) % lijst.length].zet();
  vulRackKiezer(id);
}

// ---- audio unlock + help --------------------------------------------------

const audioBtn = document.getElementById('audio-btn');
const audioAan = async () => {
  await engine.resume();
  midi.init();
  audioBtn.textContent = `audio actief · ${engine.ctx.sampleRate / 1000} kHz · ${Math.round(engine.ctx.baseLatency * 1000)} ms`;
  audioBtn.classList.remove('primary');
};
audioBtn.addEventListener('click', audioAan);
// De browser wil een klik voordat er geluid mag. Elke eerste klik telt: PLAY
// indrukken vóór "audio starten" gaf anders een deck dat speelt zonder geluid.
document.addEventListener('pointerdown', () => { if (engine.ctx.state !== 'running') audioAan().catch(() => {}); }, { capture: true });

const help = document.getElementById('help');
const toggleHelp = () => help.classList.toggle('hidden');
document.getElementById('help-btn').addEventListener('click', toggleHelp);
help.addEventListener('click', (e) => { if (e.target === help) toggleHelp(); });
window.addEventListener('keydown', (e) => { if (e.code === 'Escape') help.classList.add('hidden'); });

attachKeyboard(engine, { onHelp: toggleHelp, venster: (v) => venster[v] });

// ---- MIDI -----------------------------------------------------------------
// hub (bytes) -> mapping (betekenis) -> action-bus. Drie lagen die elkaars
// binnenkant niet kennen: de hub weet van geen actions, de mapping van geen
// hardware, en de engine van geen van beide.

const DEVICES = [apc40mk2, generic];   // generic matcht alles, dus als laatste
const pickDevice = (naam) => DEVICES.find((d) => d.match.test(naam || '')) || generic;

const midi = new MidiHub();
const mapping = new Mapping({
  read: readAction,
  invoke,
  vars: () => ({ focus: trackVanDeck(engine.focus) }),
});
let device = generic;

const feedback = new Feedback({
  device, mapping, read: readAction, meta: metaOf,
  send: (b, o) => midi.send(b, o),
  sendSysex: (b, o) => midi.sendSysex(b, o),
});

window.midi = midi;         // handig in de console tijdens bouwen
window.mapping = mapping;
window.feedback = feedback;

midi.on('input', (port) => {
  device = pickDevice(port?.name);
  console.log(`[midi] ${port ? port.name : 'geen invoer'} -> profiel ${device.id}`);
});

// De uitvoerpoort bepaalt de LED-laag. Elke keer dat hij verschijnt — bij
// starten, of nadat je de controller opnieuw aansluit — gaat de init-sysex
// eruit. Zonder dat blijven de LED's dood, hoe vaak je ze ook aanstuurt.
midi.on('output', (port) => {
  feedback.device = pickDevice(port?.name);
  feedback.klaar = false;
  if (!port) return;
  feedback.init();
  console.log(`[midi] LED-laag wakker op ${port.name} (${feedback.device.id})`);
});

// Een andere mapping betekent andere lampjes op andere plekken.
mapping.on('change', () => { if (feedback.klaar) { feedback.ringTypes(); feedback.invalidate(); } });

// LED's lopen op hun eigen klok, niet op de renderloop. requestAnimationFrame
// staat stil zodra het venster naar de achtergrond gaat, en dan zouden de
// lampjes op de controller bevriezen terwijl de muziek doorspeelt.
setInterval(() => feedback.tick(), 33);

// Laat de controller niet met oude lampjes achter. Bij het sluiten is er geen
// volgende tik meer, dus dit gaat direct — en alleen wat echt brandt, niet de
// volledige veegbeurt van 110 berichten.
window.addEventListener('pagehide', () => {
  try { feedback.blackout({ alles: false, direct: true }); } catch (_) {}
});

const learn = new MidiLearn({ mapping, device });
window.learn = learn;
midi.on('input', () => { learn.device = device; });

/**
 * Ronde MIDI->audio-latency.
 *
 * Twee stukken: de tijd tussen de hardware-timestamp en onze handler (dat is
 * het stuk waar wij iets aan kunnen doen), en de uitvoerlatency die de browser
 * zelf opgeeft. Een echte meting zou een microfoon of loopback vragen; dit is
 * de eerlijkste schatting die je zonder extra hardware kunt maken.
 */
const latency = {
  buf: [], max: 60,
  voeg(ms) { this.buf.push(ms); if (this.buf.length > this.max) this.buf.shift(); },
  mediaan() {
    if (!this.buf.length) return null;
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  },
  audioMs() {
    const c = engine.ctx;
    return ((c.baseLatency || 0) + (c.outputLatency || 0)) * 1000;
  },
  totaal() { const m = this.mediaan(); return m === null ? null : m + this.audioMs(); },
  tekst() {
    const m = this.mediaan();
    if (m === null) return 'latency: nog niets gemeten';
    const t = this.totaal();
    const kleur = t > 15 ? 'bad' : 'good';
    return `latency: ${m.toFixed(1)} in + ${this.audioMs().toFixed(1)} audio = <b class="${kleur}">${t.toFixed(1)} ms</b>`;
  },
};
window.latency = latency;

// Deze handler staat bewust VOOR de monitor: hij vult msg.hit, zodat de monitor
// naast het ruwe bericht ook laat zien wat het raakte.
midi.onInput((msg) => {
  msg.control = device.label(msg.sig);
  // Tijdens het leren gaan berichten NIET door de mapping: anders verzet je je
  // filter terwijl je een knop aan het koppelen bent.
  if (learn.busy) { msg.leer = learn.feed(msg); return; }
  msg.hit = mapping.handle(msg);
  if (msg.hit?.taken && msg.lag != null) latency.voeg(msg.lag);
});

const midiPanel = document.getElementById('midi-panel');
const monitor = new MidiMonitor(midi, midiPanel);
window.midiMonitor = monitor;

monitor.extra = () => {
  const los = mapping.takeoverStatus().length;
  return `mapping: ${mapping.name} · ${mapping.rules.size} regels`
       + (los ? ` · <b class="bad">${los} los</b>` : '')
       + ' &nbsp;·&nbsp; ' + latency.tekst();
};
mapping.on('change', () => { monitor.dirty = true; });
mapping.on('takeover', () => { monitor.dirty = true; });

// ---- paletproef -----------------------------------------------------------
// De kleurtabel uit het protocoldocument één keer met eigen ogen controleren,
// in plaats van 60 velocity-waarden op goed vertrouwen in de code te zetten.

const palPaneel = midiPanel.querySelector('.mon-palette');
const palGrid = midiPanel.querySelector('.pal-grid');
const palPages = midiPanel.querySelector('.pal-pages');
let palPagina = 0;

function tekenPalet() {
  const dev = feedback.device;
  const cellen = feedback.paletteProef(palPagina);
  palGrid.innerHTML = cellen.map((c) => {
    if (c.vel === null) return '<div class="pal-cel onbekend"></div>';
    const hex = dev.paletteHex?.[c.vel];
    return `<div class="pal-cel${hex ? '' : ' onbekend'}"${hex ? ` style="background:${hex}"` : ''}>
      <span>${c.vel}</span></div>`;
  }).join('');
  [...palPages.children].forEach((b, i) => b.classList.toggle('on', i === palPagina));
}

palPages.innerHTML = [0, 1, 2, 3].map((i) =>
  `<button class="btn sm">${i * 40}–${Math.min(i * 40 + 39, 127)}</button>`).join('');
[...palPages.children].forEach((b, i) => b.addEventListener('click', () => { palPagina = i; tekenPalet(); }));

midiPanel.querySelector('.mon-pal').addEventListener('click', () => {
  const aan = palPaneel.classList.toggle('hidden');
  if (aan) { feedback.stopProef(); } else { palPagina = 0; tekenPalet(); }
});
midiPanel.querySelector('.pal-stop').addEventListener('click', () => {
  palPaneel.classList.add('hidden');
  feedback.stopProef();
});

// ---- koppelen door aan te wijzen ------------------------------------------
// Elk bedienbaar element in de UI draagt al zijn action-id. De koppelmodus
// onderschept de klik en geeft die id door aan MIDI-learn; er is dus geen
// aparte lijst van koppelbare dingen die uit de pas kan lopen met het scherm.

const leerModus = new LearnMode({
  learn, mapping, device: apc40mk2, meta: metaOf,
  balk: document.getElementById('leer-balk'),
  knop: document.getElementById('leer-btn'),
});
window.leerModus = leerModus;
document.getElementById('leer-btn').addEventListener('click', () => leerModus.toggle());

// ---- koppelpaneel (de lijst, voor naslag) ---------------------------------

const mapPaneel = midiPanel.querySelector('.mon-map');
const mapPanel = new MappingPanel({
  root: mapPaneel, mapping, learn, device: apc40mk2,
  onReset: () => loadMapping('mappings/apc40mk2.json'),
});
window.mapPanel = mapPanel;

midiPanel.querySelector('.mon-map-knop').addEventListener('click', () => {
  const dicht = mapPaneel.classList.toggle('hidden');
  if (dicht) learn.stop(); else mapPanel.vuil = true;
});

async function loadMapping(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { aantal, fouten } = mapping.load(await res.json());
    fouten.forEach((f) => console.warn('[mapping]', f));
    console.log(`[mapping] ${mapping.name}: ${aantal} regels`);
    monitor.note(`mapping geladen: ${mapping.name} — ${aantal} regels`);
  } catch (err) {
    console.warn('[mapping] laden mislukt:', err);
    monitor.note(`mapping laden mislukt: ${err.message}`);
  }
}
/*
 * Je eigen koppelingen bewaren. Wat je met "koppelen" aan de APC hing, was bij
 * herladen weg: er werd altijd de standaardmapping geladen. Nu staat je laatste
 * mapping in de browser (localStorage, per browser), en die gaat voor.
 */
const EIGEN_MAPPING = 'varve.mapping';
let mappingGeladen = false;
function bewaarEigenMapping() {
  if (!mappingGeladen) return;               // niet de lege begintoestand bewaren
  try { localStorage.setItem(EIGEN_MAPPING, JSON.stringify(mapping.toJSON())); } catch (_) {}
}
mapping.on('change', bewaarEigenMapping);
(async () => {
  let eigen = null;
  try { eigen = JSON.parse(localStorage.getItem(EIGEN_MAPPING) || 'null'); } catch (_) {}
  if (eigen?.rules?.length) {
    const { aantal } = mapping.load(eigen);
    monitor.note(`jouw eigen mapping geladen — ${aantal} regels ("standaard herstellen" zet de APC-standaard terug)`);
  } else {
    await loadMapping('mappings/apc40mk2.json');
  }
  mappingGeladen = true;
})();

const toggleMidi = () => {
  if (midiPanel.classList.contains('hidden')) sluitOnderpanelen('midi');
  midiPanel.classList.toggle('hidden');
  if (!midiPanel.classList.contains('hidden')) { monitor.dirty = true; midi.init(); }
};
document.getElementById('midi-btn').addEventListener('click', toggleMidi);
midiPanel.querySelector('.mon-close').addEventListener('click', toggleMidi);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !isTypen(e.target)) toggleMidi();
});

// Chrome kan voor de sysex-permissie een gebruikersgebaar eisen. Daarom een
// poging bij laden, en nog een zodra er sowieso geklikt wordt.
midi.init();

// ---- renderloop -----------------------------------------------------------
// Eén rAF voor de hele UI. De engine wordt alleen uitgelezen, nooit aangestuurd.

const els = {};
for (const v of VENSTERS) {
  const r = views[v].root;
  els[v] = {
    title: r.querySelector('.deck-title'),
    pos: r.querySelector('.t-pos'),
    rem: r.querySelector('.t-rem'),
    play: r.querySelector('.play'),
    pitch: r.querySelector('.pitch-val'),
    pitchBereik: r.querySelector('.pitch-bereik'),
    meter: document.querySelector(`.strip[data-venster="${v}"] .ch-meter i`),
    hotcues: [...r.querySelectorAll('.hc')],
    loopBtns: [...r.querySelectorAll('.loops .btn:not(.bl)')],
    beatBtns: [...r.querySelectorAll('.loops .btn.bl')],
    bpm: r.querySelector('.bpm-val'),
    tap: r.querySelector('.tap'),
    sync: r.querySelector('.sync'),
    fxNaam: r.querySelector('.fx-naam'),
    fxBypass: r.querySelector('.fx-bypass'),
    fxPlekken: [...r.querySelectorAll('.fx-row .knob.fx-plek')],
    fxRack: r.querySelector('.fx-rack'),
    fxBewaar: r.querySelector('.fx-bewaar'),
    fase: r.querySelector('.fase'),
    faseWijzer: r.querySelector('.fase i'),
  };
}
const trkEls = perDeck((id) => {
  const r = tracksEl.querySelector(`.trk[data-deck="${id}"]`);
  return { root: r, titel: r.querySelector('.trk-titel'), meter: r.querySelector('.trk-meter i'),
    kanten: [...r.querySelectorAll('.trk-kant')], toon: [...r.querySelectorAll('.trk-toon')] };
});
const padEls = [...document.querySelectorAll('.pad')];
const masterMeter = document.querySelector('.master-meter i');
const curveBtn = document.querySelector('.curve');

/**
 * Schermknoppen bijwerken vanuit de engine.
 *
 * De UI stuurt de engine aan via actions, maar hij moet hem ook VOLGEN: sinds
 * er MIDI bij is gekomen is de muis niet meer de enige bron. Een knop die je
 * vasthoudt laten we met rust, anders vecht de renderloop met je vinger.
 */
function volgEngine() {
  for (const k of knobs) {
    if (k.dragging || !k.action) continue;
    const v = readAction(k.action);
    if (v !== null && Math.abs(v - k.value) > 0.0005) k.set(v, true);
  }
  for (const el of faders) {
    if (el === document.activeElement) continue;
    const v = readAction(el.dataset.action);
    if (v !== null && Math.abs(parseFloat(el.value) - v) > 0.0005) el.value = v;
  }
}

/**
 * Elk onderdeel van het frame zijn eigen vangnet. Eerst stond er één try om
 * alles: gooide het videopaneel, dan werden sampler, opnameteller en meters
 * nooit meer bijgewerkt, zonder dat je zag waarom. Nu valt alleen dat ene
 * stuk stil, met hooguit één melding per seconde per onderdeel.
 */
const laatsteFout = {};
function veilig(naam, fn) {
  try { fn(); } catch (err) {
    const nu = performance.now();
    if (!laatsteFout[naam] || nu - laatsteFout[naam] > 1000) {
      laatsteFout[naam] = nu;
      console.error(`[ui] ${naam} overgeslagen:`, err);
    }
  }
}

/*
 * Eén exceptie in deze lus stopte vroeger het plannen van het volgende frame,
 * en daarmee bevroor de hele UI: tijd, meters, golfvorm. Voor een instrument
 * dat live draait is dat het verkeerde gedrag — beter één scheve frame dan een
 * dood scherm. De fout wordt wel gemeld, maar hooguit één keer per seconde,
 * anders vult hij je console sneller dan je hem kunt lezen.
 */
let laatsteKlacht = 0;
function frame() {
  try { tekenFrame(); } catch (err) {
    if (performance.now() - laatsteKlacht > 1000) {
      laatsteKlacht = performance.now();
      console.error('[ui] frame overgeslagen:', err);
    }
  }
  requestAnimationFrame(frame);
}

function tekenFrame() {
  const s = engine.snapshot();
  veilig('volgen', () => {
    volgEngine();
  });
  veilig('trackrij', () => {
    for (const id of DECK_IDS) {
      const d = s.decks[id], t = trkEls[id];
      if (t.titel.textContent !== (d.title || '— leeg —')) t.titel.textContent = d.title || '— leeg —';
      t.meter.style.width = (d.level * 100).toFixed(1) + '%';
      t.root.classList.toggle('speelt', d.playing);
      t.root.classList.toggle('leeg', !d.loaded);
      t.root.classList.toggle('focused', s.focus === id);
    t.root.classList.toggle('maat', s.maat === id);
      t.kanten.forEach((b) => b.classList.toggle('on', b.dataset.kant === d.kant));
      t.toon.forEach((b) => b.classList.toggle('on', venster[b.dataset.toon] === id));
    }
  });
  veilig('vensters', () => {
    for (const v of VENSTERS) {
      const id = venster[v];
      const d = s.decks[id], e = els[v];
      views[v].zoom.draw(d, analysis[id]);
      views[v].overview.draw(d, analysis[id]);

      e.title.textContent = d.title;
      e.pos.textContent = fmtTime(d.position);
      e.rem.textContent = '-' + fmtTime(Math.max(0, d.duration - d.position));
      e.play.classList.toggle('on', d.playing);
      e.pitch.textContent = ((d.rate - 1) * 100).toFixed(1) + '%';
      const bereik = `±${Math.round(engine.deck(id).pitchBereik * 100)}`;
      if (e.pitchBereik.textContent !== bereik) e.pitchBereik.textContent = bereik;
      e.meter.style.width = (d.level * 100).toFixed(1) + '%';
      // bpm: wat je HOORT, dus inclusief pitch.
      e.bpm.textContent = d.bpm ? d.bpm.toFixed(1) : '—';
      e.bpm.classList.toggle('leeg', !d.bpm);
      e.tap.classList.toggle('actief', !!d.grid);

      // Fasemeter: hoe ver dit deck voor of achter loopt, over een halve tel.
      // Handig bij handmatig beatmatchen én als controle op de sync.
      const f = s.fase?.[id];
      e.fase.classList.toggle('leeg', f === null || f === undefined);
      if (f !== null && f !== undefined && d.grid) {
        const halveTel = (60 / d.grid.bpm) / d.rate / 2;   // hoorbare tel: sneller = korter
        const uit = Math.max(-1, Math.min(1, f / halveTel));
        e.faseWijzer.style.left = `${50 + uit * 46}%`;
        e.faseWijzer.classList.toggle('strak', Math.abs(f) < 0.006);
        e.fase.title = `${f >= 0 ? '+' : ''}${(f * 1000).toFixed(0)} ms`;
      }
      // De knoppen wijzen naar een PLEK; wissel je van effect, dan verandert
      // alleen wat er onder die plek zit. Daarom lopen de labels mee.
      e.fxNaam.textContent = d.fx.naam || '—';
      e.fxBypass.classList.toggle('on', d.fx.bypass);
      // Een plek zonder macro staat er wel, maar dof en dood: zo zie je in één
      // oogopslag hoeveel knoppen dit rack gebruikt.
      e.fxPlekken.forEach((el, i) => {
        const p = d.fx.plekken.find((x) => x.plek === i + 1);
        const label = el.querySelector('.knob-label');
        const tekst = p?.naam || String(i + 1);
        if (label && label.textContent !== tekst) label.textContent = tekst;
        el.classList.toggle('leeg', !p);
      });

      e.sync.classList.toggle('gelijk', readAction(`track.${trackVanDeck(id)}.sync`) === 1);
      e.beatBtns.forEach((b) => {
        b.classList.toggle('dood', !d.grid);
        const n = parseFloat(b.dataset.action.split('.').pop());
        b.classList.toggle('on', d.loopBeats === n);
      });

      d.hotcues.forEach((t, i) => e.hotcues[i].classList.toggle('set', t !== null));
      e.loopBtns.forEach((b) => b.classList.toggle('on', !!d.loop && !b.classList.contains('warn')));
      views[v].root.classList.toggle('focused', s.focus === id);
      volgRackKiezer(id);
    }
  });
  veilig('koppelpaneel', () => {
    mapPanel.tick();
  });
  veilig('sampler', () => {
    // Sampler-pads: leeg, gevuld (met van welke track en hoeveel tellen), speelt.
    const lengteKnop = document.querySelector('.sampler-lengte');
    const lengteTekst = `${engine.sampler.tellen} tel${engine.sampler.tellen === 1 ? '' : 'len'}`;
    if (lengteKnop.textContent !== lengteTekst) lengteKnop.textContent = lengteTekst;
    for (const p of engine.sampler.stand()) {
      const el = padEls[p.pad - 1];
      el.classList.toggle('gevuld', p.gevuld);
      el.classList.toggle('speelt', p.speelt);
      el.classList.toggle('bezig', p.bezig);
      el.classList.toggle('bewaard', p.bewaard);
      const t = p.gevuld ? `track ${p.bron} · ${p.tellen}` : p.bewaard ? `↺ track ${p.bewaardBron} · ${p.bewaardTellen ?? '?'}` : '';
      if (el.lastElementChild.textContent !== t) el.lastElementChild.textContent = t;
    }
  });
  veilig('opnemen', () => {
    if (opnemer.bezig && !opnameKnop.dataset.zeker) {
      const t = `■ ${mmss(opnemer.seconden)} · ${mb(opnemer.bytes)}${opnemer.metVideo ? ` + ${mb(opnemer.videoBytes)} video` : ''}`;
      if (opnameKnop.textContent !== t) opnameKnop.textContent = t;
      opnameKnop.classList.add('bezig');
      opnameSoort.disabled = true;
      opnameKnop.title = opnemer.fout || `opnemen naar opnames/${opnemer.bestand} — klik om te stoppen`;
    } else { opnameKnop.classList.remove('bezig'); opnameSoort.disabled = false; }
  });
  veilig('video', () => {
    if (videoAan()) {
      videoMixer.teken();
      const st = videoMixer.stand().filter((l) => l.video && l.speelt);
      const tekst = videoMixer.fout || (st.length ? st.map((l) => `${trackVanDeck(l.id)}: ${Math.round(l.verschil * 1000)} ms`).join(' · ') : 'geen zichtbare video');
      const modusEl = videoPaneel.querySelector('.vid-modus');
      if (modusEl.textContent !== videoMixer.modus) modusEl.textContent = videoMixer.modus;
      const doelEl = videoPaneel.querySelector('.vid-pulsdoel');
      if (doelEl.textContent !== videoMixer.pulsDoel) doelEl.textContent = videoMixer.pulsDoel;
      const statusEl = videoPaneel.querySelector('.vid-status');
      if (statusEl.textContent !== tekst) statusEl.textContent = tekst;
    }
  });
  veilig('master', () => {
    masterMeter.style.width = (s.masterPeak * 100).toFixed(1) + '%';
    masterMeter.classList.toggle('clip', s.masterPeak > 0.98);
    curveBtn.textContent = 'curve: ' + s.xfaderCurve;
  });
}
requestAnimationFrame(frame);

// ---- wat de schermlaag doet, ook op de bus (voor de APC) ------------------
bindApp({
  toon: (v, id) => toonInVenster(v, id),
  venster: () => venster,
  opnemer,
  opnameStart: async () => {
    const r = await opnemer.start({ video: opnameSoort.value === 'video' ? videoMixer.canvas : null });
    if (!r.ok) meld(`opnemen: ${r.fout}`, 'fout');
  },
  opnameStop: async () => {
    const r = await opnemer.stop();
    meld(r.ok ? `opname bewaard: opnames/${r.bestand}` : `afronden mislukt: ${r.fout}`, r.ok ? 'info' : 'fout');
  },
  opnameSoort: () => { opnameSoort.value = opnameSoort.value === 'video' ? 'audio' : 'video'; opnameSoort.dispatchEvent(new Event('change')); },
  rackStap,
});
