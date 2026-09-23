import { Engine, DECK_IDS } from '../engine/engine.js';
import { bindEngine, bindVideo, bindApp, bindLagen } from '../control/actions.js';
import { Lagen } from '../control/lagen.js';
import { opzetMapjeBalk } from './mapje-balk.js';
import { attachKeyboard } from '../control/keyboard.js';
import { meld, koppelMeldingen } from './meldingen.js';
import { opzetVideo } from './video-paneel.js';
import { opzetOpname } from './opname-knop.js';
import { opzetVensters } from './vensters.js';
import { opzetSpiegel } from './spiegel.js';
import { opzetRacks } from './racks.js';
import { opzetSamplerOpslag } from './sampler-opslag.js';
import { opzetLaden } from './laden.js';
import { opzetOnderpanelen } from './onderpanelen.js';
import { opzetMidi } from './midi-opzet.js';
import { startRenderloop } from './renderloop.js';
import { tabblad } from './tabblad.js';

/**
 * Het instappunt van de schermlaag: maakt de engine en zet de modules in
 * volgorde op. Wat de modules delen staat in `staat` of gaat als parameter
 * mee; niets via globals. De `window.*`-haakjes zijn er om in de console van
 * Chrome te kunnen testen (en `window.videoMixer` voor het losse videovenster).
 *
 * Volgorde: een module die iets van een LATERE module nodig heeft, krijgt
 * een pijlfunctie die die pas bij aanroepen opzoekt (`laden`, `racks`,
 * `midiDelen` hieronder). Dat mag alleen omdat die aanroepen pas bij een klik
 * gebeuren, als alles al opgezet is. Wie hier iets tijdens het opzetten laat
 * aanroepen, krijgt een ReferenceError (TDZ).
 */

const engine = new Engine();
bindEngine(engine);
window.engine = engine;   // handig in de console tijdens bouwen

const perDeck = (maak) => Object.fromEntries(DECK_IDS.map((id) => [id, maak(id)]));

koppelMeldingen(engine);
window.meld = meld;

// ---- één VARVE-tabblad luistert naar de APC ------------------------------
// Een tweede tabblad krijgt anders elke knopdruk ook, en stuurt zijn eigen
// LED's. Wie de lock heeft is het eerste (zie tabblad.js); midi-opzet.js
// vraagt het met isEersteTabblad().
{
  const t = tabblad();
  let melding = null;
  t.on('tweede', () => {
    document.body.classList.add('tweede-tabblad');
    melding = meld('er is al een VARVE-tabblad open — dit tabblad luistert niet naar de APC (sluit het andere, dan neemt dit het over)', 'fout');
  });
  t.on('eerste', () => {
    if (!document.body.classList.contains('tweede-tabblad')) return;
    document.body.classList.remove('tweede-tabblad');
    melding?.remove();
    meld('het andere VARVE-tabblad is dicht — dit tabblad luistert nu naar de APC');
  });
  window.tabblad = t;
}

/** Wat meerdere modules lezen én schrijven. */
const staat = {
  venster: { L: 'A', R: 'B' },          // L = track met focus, R = de vorige focus (zie vensters.js)
  deckTrack: perDeck(() => null),       // welk library-nummer op welke track (null = los bestand, demo, leeg)
  analysis: perDeck(() => null),        // golfvorm-peaks per track
};

// ---- video ----------------------------------------------------------------
const video = opzetVideo({ engine });
const { videoMixer } = video;
window.videoMixer = videoMixer;
bindVideo(videoMixer);

// ---- opnemen --------------------------------------------------------------
const opname = opzetOpname({ engine, videoMixer });
window.opnemer = opname.opnemer;

// ---- het scherm als spiegel van de APC, en de track met focus -------------
// Eerst de spiegel: die zet de kolommen en het focusdeel neer, en pas daarna
// kan opzetVensters alle knoppen en faders binden.
const spiegel = opzetSpiegel({ engine, staat, loadFile: (...a) => laden.loadFile(...a) });
window.spiegel = spiegel;
const vensters = opzetVensters({
  engine,
  venster: staat.venster,
  laadBuffer: (...a) => laden.laadBuffer(...a),
  loadFile: (...a) => laden.loadFile(...a),
  naFocus: (deckId) => racks.volgFocus(deckId),
});

// ---- effect-racks, sampler-pads, laden en library -------------------------
const racks = opzetRacks({ engine, staat });
const samplerOpslag = opzetSamplerOpslag({ engine, staat });
const laden = opzetLaden({
  engine, staat, videoMixer,
  racks, haalSamples: samplerOpslag.haalSamples,
});
window.library = laden.library;

const onderpanelen = opzetOnderpanelen({ library: laden.library, rackEditor: racks.rackEditor });

// ---- audio unlock + help --------------------------------------------------

const audioBtn = document.getElementById('audio-btn');
const audioAan = async () => {
  await engine.resume();
  midiDelen.midi.init();
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

attachKeyboard(engine, { onHelp: toggleHelp, venster: (v) => staat.venster[v] });

// ---- MIDI -----------------------------------------------------------------
// Mapjes op de controller (VRAGEN B3): welke laag van de knoppen open staat.
const lagen = new Lagen();
bindLagen(lagen);
window.lagen = lagen;
const midiDelen = opzetMidi({ engine, sluitOnderpanelen: onderpanelen.sluitOnderpanelen, lagen,
  geraakt: (sig, regelSig) => spiegel.markeer(sig, regelSig) });
spiegel.koppel({ mapping: midiDelen.mapping, lagen });
opzetMapjeBalk({ lagen, mapping: midiDelen.mapping, vars: () => midiDelen.mapping.vars() });
window.midi = midiDelen.midi;         // handig in de console tijdens bouwen
window.mapping = midiDelen.mapping;
window.feedback = midiDelen.feedback;
window.learn = midiDelen.learn;
window.latency = midiDelen.latency;
window.midiMonitor = midiDelen.monitor;
window.leerModus = midiDelen.leerModus;
window.mapPanel = midiDelen.mapPanel;

// ---- renderloop -----------------------------------------------------------
startRenderloop({
  engine, staat,
  views: vensters.views, knobs: vensters.knobs, faders: vensters.faders,
  stappen: {
    spiegel: spiegel.teken,
    volgRackKiezer: racks.volgRackKiezer,
    koppelpaneel: () => midiDelen.mapPanel.tick(),
    opnemen: opname.teken,
    video: video.teken,
  },
});

// ---- wat de schermlaag doet, ook op de bus (voor de APC) ------------------
bindApp({
  toon: (v, id) => vensters.toonInVenster(v, id),
  venster: () => staat.venster,
  opnemer: opname.opnemer,
  opnameStart: opname.opnameStart,
  opnameStop: opname.opnameStop,
  opnameSoort: opname.wisselSoort,
  rackStap: racks.rackStap,
});
