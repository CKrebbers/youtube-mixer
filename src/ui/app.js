import { Engine } from '../engine/engine.js';
import { bindEngine, invoke, read as readAction, metaOf } from '../control/actions.js';
import { attachKeyboard } from '../control/keyboard.js';
import { MidiHub } from '../control/midi.js';
import { Mapping } from '../control/mapping.js';
import { Feedback } from '../control/feedback.js';
import { MidiLearn } from '../control/midi-learn.js';
import { MappingPanel } from './mapping-panel.js';
import { LearnMode } from './learn-mode.js';
import { LibraryPanel } from './library-panel.js';
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

const analysis = { A: null, B: null };
const views = {};
const knobs = [];

// ---- UI opbouwen ----------------------------------------------------------

document.querySelectorAll('.knob').forEach((el) => knobs.push(new Knob(el)));
bindButtons(document.body);

const faders = [...document.querySelectorAll('input[type=range][data-action]')];
faders.forEach((el) => {
  el.addEventListener('input', () => invoke(el.dataset.action, parseFloat(el.value)));
});

for (const id of ['A', 'B']) {
  const root = document.getElementById(`deck-${id}`);
  views[id] = {
    zoom: new WaveformView(root.querySelector('.wave-zoom'), { mode: 'zoom', color: id === 'A' ? '#4ad9c4' : '#c48cff' }),
    overview: new WaveformView(root.querySelector('.wave-overview'), { mode: 'overview', color: id === 'A' ? '#2f8e81' : '#7d5aa8' }),
    root,
  };

  // klikken op overview = springen
  root.querySelector('.wave-overview').addEventListener('pointerdown', (e) => {
    const d = engine.deck(id);
    if (!d.buffer) return;
    const r = e.currentTarget.getBoundingClientRect();
    d.seek(((e.clientX - r.left) / r.width) * d.duration);
  });

  // focus volgt de klik
  root.addEventListener('pointerdown', () => engine.setFocus(id));

  // drop
  root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drag'); });
  root.addEventListener('dragleave', () => root.classList.remove('drag'));
  root.addEventListener('drop', async (e) => {
    e.preventDefault(); root.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) await loadFile(id, file);
  });

  root.querySelector('.demo-btn').addEventListener('click', async () => {
    await engine.resume();
    const buf = renderDemoTrack(engine.ctx, { seed: id === 'A' ? 0 : 1, bars: 16 });
    engine.deck(id).load(buf, `demo ${id} — 124 bpm`);
    analysis[id] = computePeaks(buf);
  });
}

async function loadFile(id, file) {
  await engine.resume();
  const arr = await file.arrayBuffer();
  const buf = await engine.ctx.decodeAudioData(arr);
  engine.deck(id).load(buf, file.name.replace(/\.[^.]+$/, ''));
  analysis[id] = computePeaks(buf);
  console.log(`[deck ${id}] ${file.name} — ${buf.duration.toFixed(1)}s — RMS ${rmsDb(buf).toFixed(1)} dBFS`);
}

// ---- library --------------------------------------------------------------
// Het paneel praat met de server; het laden op een deck loopt hierlangs, want
// hier wordt ook de golfvorm-analyse bijgehouden.

/** Welk nummer staat op welk deck — nodig om het grid bij de juiste link te bewaren. */
const deckTrack = { A: null, B: null };
const gridBewaard = { A: null, B: null };

/**
 * Het beatgrid hoort bij de link, dus het wordt daar bewaard.
 *
 * Dit draait op een eigen klok en niet vanuit de renderloop: een debounce die
 * je elk frame opnieuw start, vuurt nooit.
 */
async function bewaarGrid() {
  {
    for (const id of ['A', 'B']) {
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
  const knop = els[deck]?.tap;
  knop?.classList.add('bezig');
  try {
    const res = await fetch(`/api/library/${trackId}/grid/verfijn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bpm }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const r = await res.json();
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
  onLaad: async (deckId, track) => {
    // NIET wachten op engine.resume(): zonder gebruikersgebaar lost die belofte
    // nooit in en blijft het laden eeuwig hangen. Decoderen kan prima op een
    // gepauzeerde context; hervatten proberen we daarna, en lukt dat niet dan
    // zeggen we het gewoon.
    const res = await fetch('/' + track.audio.replace(/^\//, ''));
    if (!res.ok) throw new Error(`audio niet gevonden (${res.status})`);
    const buf = await engine.ctx.decodeAudioData(await res.arrayBuffer());
    engine.deck(deckId).load(buf, track.titel);
    // Golfvorm uit de cache; alleen als die er niet is rekenen we hem zelf uit.
    const uitCache = track.peaks ? await laadPeaks('/' + track.peaks.bestand.replace(/^\//, ''),
      // Duur uit de LIBRARY, niet uit de buffer: straks is er geen buffer meer
      // omdat het deck streamt.
      { samplesPerBucket: track.peaks.perBucket, duration: track.duur || buf.duration }) : null;
    analysis[deckId] = uitCache || computePeaks(buf);
    deckTrack[deckId] = track.id;
    // Een eerder uitgemeten grid komt mee met de link.
    engine.deck(deckId).setGrid(track.grid || null);
    haalRacks(deckId);
    gridBewaard[deckId] = track.grid ? JSON.stringify(track.grid) : 'null';
    console.log(`[deck ${deckId}] ${track.titel} — ${buf.duration.toFixed(1)}s`
      + ` — golfvorm ${uitCache ? 'uit cache' : 'zelf berekend'}`);

    engine.resume().catch(() => {});
    if (engine.ctx.state !== 'running') {
      return { hint: 'druk op "audio starten" om geluid te krijgen' };
    }
    return null;
  },
});
window.library = library;

const toggleLib = () => {
  libPaneel.classList.toggle('hidden');
  if (!libPaneel.classList.contains('hidden')) library.ververs();
};
document.getElementById('lib-btn').addEventListener('click', toggleLib);
libPaneel.querySelector('.lib-close').addEventListener('click', toggleLib);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyL' && !e.target.matches('input, textarea, select')) toggleLib();
});

// ---- effect-racks per link ------------------------------------------------
// Een rack hoort bij het NUMMER, niet bij het deck. Laad je hetzelfde nummer
// morgen op een ander deck, dan komen zijn racks mee.

const rackCache = { A: [], B: [] };

/** Rechtstreeks uit de DOM: `els` wordt pas verderop aangemaakt. */
const fxEl = (deckId, klasse) => document.querySelector(`#deck-${deckId} ${klasse}`);

async function haalRacks(deckId) {
  const trackId = deckTrack[deckId];
  const sel = fxEl(deckId, '.fx-rack');
  if (!sel) return;
  if (!trackId) {
    rackCache[deckId] = [];
    sel.innerHTML = '<option value="">— geen nummer —</option>';
    return;
  }
  try {
    const r = await fetch(`/api/library/${trackId}/racks`);
    const j = await r.json();
    rackCache[deckId] = j.racks || [];
  } catch (_) { rackCache[deckId] = []; }
  const actief = rackCache[deckId].find((x) => x.actief);
  sel.innerHTML = '<option value="">— los effect —</option>'
    + rackCache[deckId].map((x) =>
        `<option value="${x.id}"${x.actief ? ' selected' : ''}>${x.naam}</option>`).join('');
  if (actief) {
    const fouten = engine.deck(deckId).fx.zetRack(actief.data).fouten;
    fouten.forEach((f) => console.warn(`[rack ${deckId}]`, f));
  }
}

for (const id of ['A', 'B']) {
  fxEl(id, '.fx-rack').addEventListener('change', () => {
    const keuze = fxEl(id, '.fx-rack').value;
    const rack = rackCache[id].find((x) => String(x.id) === keuze);
    const fx = engine.deck(id).fx;
    if (rack) {
      fx.zetRack(rack.data).fouten.forEach((f) => console.warn(`[rack ${id}]`, f));
      fetch(`/api/library/${deckTrack[id]}/racks/${rack.id}`, { method: 'POST' }).catch(() => {});
    }
  });

  fxEl(id, '.fx-bewaar').addEventListener('click', async () => {
    const trackId = deckTrack[id];
    if (!trackId) { console.warn('[rack] geen nummer op dit deck'); return; }
    const fx = engine.deck(id).fx;
    const voorstel = fx.rackNaam === 'nieuw rack' ? fx.effectId || 'rack' : fx.rackNaam;
    const naam = prompt('Naam voor dit rack:', voorstel);
    if (!naam) return;
    try {
      const res = await fetch(`/api/library/${trackId}/racks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naam, data: fx.naarJSON(), actief: true }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      console.log(`[rack ${id}] "${naam}" bewaard bij dit nummer`);
      await haalRacks(id);
    } catch (err) {
      console.warn('[rack] bewaren mislukt:', err.message);
    }
  });
}

// ---- audio unlock + help --------------------------------------------------

const audioBtn = document.getElementById('audio-btn');
audioBtn.addEventListener('click', async () => {
  await engine.resume();
  midi.init();
  audioBtn.textContent = `audio actief · ${engine.ctx.sampleRate / 1000} kHz · ${Math.round(engine.ctx.baseLatency * 1000)} ms`;
  audioBtn.classList.remove('primary');
});

const help = document.getElementById('help');
const toggleHelp = () => help.classList.toggle('hidden');
document.getElementById('help-btn').addEventListener('click', toggleHelp);
help.addEventListener('click', (e) => { if (e.target === help) toggleHelp(); });
window.addEventListener('keydown', (e) => { if (e.code === 'Escape') help.classList.add('hidden'); });

attachKeyboard(engine, { onHelp: toggleHelp });

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
  vars: () => ({ focus: engine.focus }),
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
loadMapping('mappings/apc40mk2.json');

const toggleMidi = () => {
  midiPanel.classList.toggle('hidden');
  if (!midiPanel.classList.contains('hidden')) { monitor.dirty = true; midi.init(); }
};
document.getElementById('midi-btn').addEventListener('click', toggleMidi);
midiPanel.querySelector('.mon-close').addEventListener('click', toggleMidi);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.target.matches('input, textarea, select')) toggleMidi();
});

// Chrome kan voor de sysex-permissie een gebruikersgebaar eisen. Daarom een
// poging bij laden, en nog een zodra er sowieso geklikt wordt.
midi.init();

// ---- renderloop -----------------------------------------------------------
// Eén rAF voor de hele UI. De engine wordt alleen uitgelezen, nooit aangestuurd.

const els = {};
for (const id of ['A', 'B']) {
  const r = views[id].root;
  els[id] = {
    title: r.querySelector('.deck-title'),
    pos: r.querySelector('.t-pos'),
    rem: r.querySelector('.t-rem'),
    play: r.querySelector('.play'),
    pitch: r.querySelector('.pitch-val'),
    meter: document.querySelector(`.strip[data-deck="${id}"] .ch-meter i`),
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
  volgEngine();

  for (const id of ['A', 'B']) {
    const d = s.decks[id], e = els[id];
    views[id].zoom.draw(d, analysis[id]);
    views[id].overview.draw(d, analysis[id]);

    e.title.textContent = d.title;
    e.pos.textContent = fmtTime(d.position);
    e.rem.textContent = '-' + fmtTime(Math.max(0, d.duration - d.position));
    e.play.classList.toggle('on', d.playing);
    e.pitch.textContent = ((d.rate - 1) * 100).toFixed(1) + '%';
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
      const halveTel = (60 / d.grid.bpm) * d.rate / 2;
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

    const ander = s.decks[id === 'A' ? 'B' : 'A'];
    e.sync.classList.toggle('gelijk', !!(d.bpm && ander.bpm && Math.abs(d.bpm - ander.bpm) < 0.05));
    e.beatBtns.forEach((b) => {
      b.classList.toggle('dood', !d.grid);
      const n = parseFloat(b.dataset.action.split('.').pop());
      b.classList.toggle('on', d.loopBeats === n);
    });

    d.hotcues.forEach((t, i) => e.hotcues[i].classList.toggle('set', t !== null));
    e.loopBtns.forEach((b) => b.classList.toggle('on', !!d.loop && !b.classList.contains('warn')));
    views[id].root.classList.toggle('focused', s.focus === id);
  }

  mapPanel.tick();

  masterMeter.style.width = (s.masterPeak * 100).toFixed(1) + '%';
  masterMeter.classList.toggle('clip', s.masterPeak > 0.98);
  curveBtn.textContent = 'curve: ' + s.xfaderCurve;
}
requestAnimationFrame(frame);
