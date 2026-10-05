import { Engine, DECK_IDS } from '../engine/engine.js';
import { bindEngine, bindVideo, bindApp, bindLagen, bindAuto, invoke, bijInvoke } from '../control/actions.js';
import { Lagen } from '../control/lagen.js';
import { opzetMapjeBalk } from './mapje-balk.js';
import { attachKeyboard } from '../control/keyboard.js';
import { meld, koppelMeldingen } from './meldingen.js';
import { opzetVideo } from './video-paneel.js';
import { opzetOpname } from './opname-knop.js';
import { opzetLogboek } from './logboek.js';
import { opzetVensters } from './vensters.js';
import { opzetSpiegel } from './spiegel.js';
import { opzetRacks } from './racks.js';
import { opzetSamplerOpslag } from './sampler-opslag.js';
import { opzetKlankschaal } from './klankschaal-paneel.js';
import { opzetAuto } from './auto-paneel.js';
import { opzetStems } from './stems-paneel.js';
import { opzetKoptelefoon, koptelefoonOpties } from './koptelefoon-paneel.js';
import { StemsWachtrij } from './stems-wachtrij.js';
import { Automaat } from '../auto/automaat.js';
import { opzetPlanKoppeling } from './plan-koppeling.js';
import { opzetHotcueOpslag } from './hotcue-opslag.js';
import { opzetLaden } from './laden.js';
import { opzetOnderpanelen } from './onderpanelen.js';
import { opzetMidi } from './midi-opzet.js';
import { startRenderloop } from './renderloop.js';
import { tabblad } from './tabblad.js';
import { startStatusZender } from './status-zender.js';
import { vormenAan } from './vlag.js';

/**
 * Het instappunt van de schermlaag: maakt de engine en zet de modules in
 * volgorde op. Wat de modules delen staat in `staat` of gaat als parameter
 * mee; niets via globals. De `window.*`-haakjes zijn er om in de console van
 * Chrome te kunnen testen (en `window.varveBeamer` voor het losse videovenster).
 *
 * Volgorde: een module die iets van een LATERE module nodig heeft, krijgt
 * een pijlfunctie die die pas bij aanroepen opzoekt (`laden`, `racks`,
 * `midiDelen` hieronder). Dat mag alleen omdat die aanroepen pas bij een klik
 * gebeuren, als alles al opgezet is. Wie hier iets tijdens het opzetten laat
 * aanroepen, krijgt een ReferenceError (TDZ).
 */

// De koptelefoon (zaal en koptelefoon omgewisseld?) is bedrading: alleen bij het maken.
const engine = new Engine({ koptelefoon: koptelefoonOpties() });
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
  deckHerkomst: perDeck(() => null),    // waar de track vandaan komt: library, demo of los (voor het handelingenlog)
  terugspeelDecks: new Set(),           // tracks die terugspelen laadde: daarvan wordt niets in de library bewaard
  analysis: perDeck(() => null),        // golfvorm-peaks per track
  deckStems: perDeck(() => null),       // stems volgens de library bij het laden: { aantal, mislukt } of null (laden.js)
};

// De stems-rij van de server (docs/STEMS.md §2): één keer voor de library-kolom,
// de STEMS-rij en het teken in de kolomkop.
const stemsWachtrij = new StemsWachtrij();
window.stemsWachtrij = stemsWachtrij;

// ---- video ----------------------------------------------------------------
const video = opzetVideo({ engine });
const { videoMixer } = video;
window.videoMixer = videoMixer;
// Het losse venster (video.html) meldt zich hier aan en mengt zelf (src/video/beamer.js).
window.varveBeamer = video.api;
bindVideo(videoMixer);
// Vormlagen (Vormmachines) over de video: alleen met ?vormen=1 (docs/plugins/01-plan.md).
// Vóór opzetVensters, die bindt alle knoppen die er dan staan.
const vormen = vormenAan() ? (await import('./vorm-paneel.js')).opzetVormen({ videoMixer }) : null;
window.vormen = vormen?.vormen;

// ---- opnemen --------------------------------------------------------------
const opname = opzetOpname({ engine, videoCanvas: video.opnameCanvas });
window.opnemer = opname.opnemer;

// ---- het scherm als spiegel van de APC, en de track met focus -------------
// Eerst de spiegel: die zet de kolommen en het focusdeel neer, en pas daarna
// kan opzetVensters alle knoppen en faders binden.
const spiegel = opzetSpiegel({ engine, staat, loadFile: (...a) => laden.loadFile(...a),
  stemsVan: (id) => stemsPaneel.kolomTeken(id) });
window.spiegel = spiegel;
const vensters = opzetVensters({
  engine,
  venster: staat.venster,
  laadBuffer: (...a) => laden.laadBuffer(...a),
  loadFile: (...a) => laden.loadFile(...a),
  naFocus: (deckId) => racks.volgFocus(deckId),
});

// ---- effect-racks, sampler-pads, laden en library -------------------------
const racks = opzetRacks({ engine, staat, naRack: (id) => logboek.naRack(id) });
const samplerOpslag = opzetSamplerOpslag({ engine, staat });
const klankschaal = opzetKlankschaal({ engine });
const hotcueOpslag = opzetHotcueOpslag({ engine, meld });
const laden = opzetLaden({
  engine, staat, videoMixer,
  racks, haalSamples: samplerOpslag.haalSamples, haalHotcues: hotcueOpslag.haalHotcues,
  naLaad: (info) => logboek.naLaad(info), stems: stemsWachtrij,
});
window.library = laden.library;
// De STEMS-rij voor de track met focus (standaard dicht, knop "stems").
const stemsPaneel = opzetStems({ engine, staat, wachtrij: stemsWachtrij, library: laden.library });
const koptelefoonPaneel = opzetKoptelefoon({ engine });
stemsWachtrij.peil();

// ---- handelingenlog: wat er op de bus gebeurt, om terug te spelen ---------
// Loopt vanzelf mee met een opname (zelfde id). docs/HANDELINGENLOG.md.
const logboek = opzetLogboek({ engine, staat, laden, opnemer: opname.opnemer });
window.logboek = logboek;

// ---- auto-DJ: de app kiest en mixt, Clay stuurt bij, Claude schrijft het plan
// (docs/AUTO-DJ.md). Het plan staat in plannen/auto-plan.json (mag ontbreken).
const auto = new Automaat({
  engine, invoke, bijInvoke,
  laad: (deckId, track) => laden.laadLibrary(deckId, track),
  haalLibrary: async () => {
    const r = await fetch('/api/library?aantal=500');
    if (!r.ok) throw new Error(`library ${r.status}`);
    return (await r.json()).tracks || [];
  },
  haalPlan: () => planKoppeling.haal(),
  welkNummer: (deckId) => staat.deckTrack[deckId] ?? null,
});
auto.on('melding', ({ tekst, soort }) => meld(`auto-dj: ${tekst}`, soort === 'fout' ? 'fout' : 'info'));
bindAuto(auto);
// Het setplan: ophalen met versie, live bijwerken, en window.varvePlan voor plan.html.
const planKoppeling = opzetPlanKoppeling({ auto, engine, invoke });
const autoPaneel = opzetAuto({ auto });
window.auto = auto;

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
// Het mapje "vorm" op de APC komt als fragment BIJ de mapping, niet erin:
// je eigen bewaarde mapping blijft zoals hij is (Mapping.voegToe).
if (vormen) {
  fetch('mappings/apc40mk2-vormen.json').then((r) => r.json())
    .then((doc) => midiDelen.mapping.voegToe('vormen', doc))
    .catch((err) => meld(`vormlagen: APC-indeling niet geladen (${err.message})`, 'fout'));
}
opzetMapjeBalk({ lagen, mapping: midiDelen.mapping, vars: () => midiDelen.mapping.vars() });
window.midi = midiDelen.midi;         // handig in de console tijdens bouwen
window.mapping = midiDelen.mapping;
window.feedback = midiDelen.feedback;
window.learn = midiDelen.learn;
window.latency = midiDelen.latency;
window.midiMonitor = midiDelen.monitor;
window.leerModus = midiDelen.leerModus;
window.mapPanel = midiDelen.mapPanel;

// ---- de Controlekamer (controle.html) leest mee: APC, audio, wat er speelt ----
startStatusZender({
  isEerste: () => tabblad().eerste,
  lees: () => ({ snap: engine.snapshot(), midi: midiDelen.midi.status(), audio: engine.ctx.state,
                 auto: auto.aan, opname: !!opname.opnemer.bezig }),
});

// ---- renderloop -----------------------------------------------------------
startRenderloop({
  engine, staat,
  views: vensters.views, knobs: vensters.knobs, faders: vensters.faders,
  stappen: {
    spiegel: spiegel.teken,
    volgRackKiezer: racks.volgRackKiezer,
    koppelpaneel: () => midiDelen.mapPanel.tick(),
    opnemen: opname.teken,
    logboek: logboek.teken,
    video: video.teken,
    klankschaal: klankschaal.teken,
    auto: autoPaneel.teken,
    stems: stemsPaneel.teken,
    koptelefoon: koptelefoonPaneel.teken,
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
