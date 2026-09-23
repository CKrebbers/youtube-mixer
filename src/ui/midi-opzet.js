import { invoke, read as readAction, metaOf, trackVanDeck } from '../control/actions.js';
import { isTypen } from '../control/keyboard.js';
import { MidiHub } from '../control/midi.js';
import { Mapping } from '../control/mapping.js';
import { Feedback } from '../control/feedback.js';
import { MidiLearn } from '../control/midi-learn.js';
import apc40mk2 from '../control/devices/apc40mk2.js';
import generic from '../control/devices/generic.js';
import { MappingPanel } from './mapping-panel.js';
import { LearnMode } from './learn-mode.js';
import { MidiMonitor } from './midi-monitor.js';
import { meld } from './meldingen.js';
import { tabblad, isEersteTabblad } from './tabblad.js';

/**
 * Alles rond MIDI aan de schermkant: hub, mapping, LED-laag, leren, het
 * MIDI-paneel met monitor, paletproef en koppellijst, en je eigen mapping in
 * localStorage.
 *
 * hub (bytes) -> mapping (betekenis) -> action-bus. Drie lagen die elkaars
 * binnenkant niet kennen: de hub weet van geen actions, de mapping van geen
 * hardware, en de engine van geen van beide.
 */
/**
 * @param geraakt  (sig, regelSig) -> void: een control op de controller is
 *                 aangeraakt en deed iets. De spiegel op het scherm licht dan
 *                 het bijbehorende element even op.
 */
export function opzetMidi({ engine, sluitOnderpanelen, lagen, geraakt = null }) {
  const DEVICES = [apc40mk2, generic];   // generic matcht alles, dus als laatste
  const pickDevice = (naam) => DEVICES.find((d) => d.match.test(naam || '')) || generic;

  const midi = new MidiHub();
  /*
   * Maar één VARVE-tabblad praat met de APC (tabblad.js, Web Lock). Een tweede
   * tabblad vraagt helemaal GEEN MIDI-toegang aan: dan kan het ook niets
   * sturen. Twee of drie tabbladen die tegelijk init en LED's naar de APC
   * sturen, lieten Chrome's MIDI-dienst crashen (23 sep 2026, net als de
   * vier crashes op 22 sep). Wordt dit tabblad later het eerste (het andere
   * sloot), dan pas MIDI openen.
   */
  const echteInit = midi.init.bind(midi);
  midi.init = (...a) => (isEersteTabblad() ? echteInit(...a) : Promise.resolve(false));
  tabblad().on('eerste', () => { echteInit().catch(() => {}); });
  const mapping = new Mapping({
    read: readAction,
    invoke,
    vars: () => ({ focus: trackVanDeck(engine.focus) }),
    lagen: () => lagen?.actief() ?? [],
  });
  let device = generic;

  const feedback = new Feedback({
    device, mapping, read: readAction, meta: metaOf,
    send: (b, o) => midi.send(b, o),
    sendSysex: (b, o) => midi.sendSysex(b, o),
  });

  midi.on('input', (port) => {
    device = pickDevice(port?.name);
    // Echofilter per apparaat (feedback-lussen via LED-ringen); zie devices/*.js.
    midi.echoFilter = device.echoFilter !== false;
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
  setInterval(() => { if (isEersteTabblad()) feedback.tick(); }, 33);

  // Laat de controller niet met oude lampjes achter. Bij het sluiten is er geen
  // volgende tik meer, dus dit gaat direct — en alleen wat echt brandt, niet de
  // volledige veegbeurt van 110 berichten.
  window.addEventListener('pagehide', () => {
    try { feedback.blackout({ alles: false, direct: true }); } catch (_) {}
  });

  const learn = new MidiLearn({ mapping, device });
  midi.on('input', () => { learn.device = device; });
  // Controller weg (losgetrokken): shift en ingedrukte knoppen loslaten, anders
  // blijft na terugkomen shift hangen of een bend doorlopen.
  midi.on('input', (port) => { if (!port) mapping.losgekoppeld(); });

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

  // Deze handler staat bewust VOOR de monitor: hij vult msg.hit, zodat de monitor
  // naast het ruwe bericht ook laat zien wat het raakte.
  midi.onInput((msg) => {
    msg.control = device.label(msg.sig);
    // Tijdens het leren gaan berichten NIET door de mapping: anders verzet je je
    // filter terwijl je een knop aan het koppelen bent.
    // De shiftknop gaat altijd naar de mapping, ook tijdens koppelen: zo kun
    // je een shift-regel koppelen door shift vast te houden.
    if (learn.busy && msg.sig !== mapping.shiftSig) { msg.leer = learn.feed(msg); return; }
    msg.hit = mapping.handle(msg);
    if (msg.hit && geraakt) { try { geraakt(msg.sig, msg.hit.rule?.in); } catch (_) {} }
    if (msg.hit?.taken && msg.lag != null) latency.voeg(msg.lag);
  });

  const midiPanel = document.getElementById('midi-panel');
  const monitor = new MidiMonitor(midi, midiPanel);

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
  document.getElementById('leer-btn').addEventListener('click', () => leerModus.toggle());

  // ---- koppelpaneel (de lijst, voor naslag) ---------------------------------

  const mapPaneel = midiPanel.querySelector('.mon-map');
  const mapPanel = new MappingPanel({
    root: mapPaneel, mapping, learn, device: apc40mk2,
    // Je eigen versie echt weggooien (server en browser), niet de standaard
    // als "eigen" bewaren: anders volgt de app nooit meer een nieuwe standaard.
    onReset: () => herstelStandaard(),
  });

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
   * mapping op de SERVER (library-database, overleeft een andere browser en
   * gewiste sitedata) én in de browser (localStorage, als reserve als de server
   * even niet bereikbaar is). Bij het opstarten: server eerst.
   */
  const EIGEN_MAPPING = 'varve.mapping';
  let mappingGeladen = false;
  let naarServer = null;
  function bewaarEigenMapping() {
    if (!mappingGeladen) return;               // niet de lege begintoestand bewaren
    const doc = mapping.toJSON();
    try { localStorage.setItem(EIGEN_MAPPING, JSON.stringify(doc)); } catch (_) {}
    // Koppelen geeft soms een reeks wijzigingen vlak na elkaar: één keer sturen.
    clearTimeout(naarServer);
    naarServer = setTimeout(() => {
      fetch('/api/mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping: doc }) })
        .then((r) => { if (!r.ok) throw new Error(`${r.status}`); })
        .catch((err) => meld(`mapping niet op de server bewaard (${err.message}) — staat wel in deze browser`, 'fout'));
    }, 500);
  }
  mapping.on('change', bewaarEigenMapping);
  async function herstelStandaard() {
    mappingGeladen = false;
    clearTimeout(naarServer);
    try { localStorage.removeItem(EIGEN_MAPPING); } catch (_) {}
    try { await fetch('/api/mapping', { method: 'DELETE' }); } catch (err) { meld(`eigen mapping op de server niet gewist (${err.message})`, 'fout'); }
    await loadMapping('mappings/apc40mk2.json');
    mappingGeladen = true;
  }
  (async () => {
    let vanServer = null, lokaal = null, serverBereikbaar = true;
    try {
      const r = await fetch('/api/mapping');
      if (!r.ok) throw new Error(`${r.status}`);
      vanServer = (await r.json()).mapping;
    } catch (_) { serverBereikbaar = false; }
    try { lokaal = JSON.parse(localStorage.getItem(EIGEN_MAPPING) || 'null'); } catch (_) {}
    const eigen = vanServer?.rules?.length ? vanServer : lokaal?.rules?.length ? lokaal : null;
    if (eigen) {
      const { aantal } = mapping.load(eigen);
      const waar = eigen === vanServer ? 'van de server' : serverBereikbaar ? 'uit deze browser' : 'uit deze browser (server niet bereikbaar)';
      monitor.note(`jouw eigen mapping geladen ${waar} — ${aantal} regels ("standaard herstellen" zet de APC-standaard terug)`);
    } else {
      await loadMapping('mappings/apc40mk2.json');
    }
    mappingGeladen = true;
    // Stond hij alleen in de browser (van vóór deze versie)? Dan nu ook naar de server.
    if (eigen && eigen !== vanServer && serverBereikbaar) bewaarEigenMapping();
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

  return { midi, mapping, feedback, learn, latency, monitor, leerModus, mapPanel };
}
