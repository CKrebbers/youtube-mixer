import { Emitter, clamp, piek } from '../lib/emitter.js';
import { Deck } from './deck.js';
import { createMasterChain, xfaderGains, faderGain } from './audio-graph.js';

/**
 * Acht tracks, één per fader van de APC40 mkII. De engine noemt ze A t/m H;
 * dat track 1 = A is een afspraak van de action-bus, niet van de engine.
 */
export const DECK_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Crossfader-toewijzing per track, zoals de A|B-knoppen op de APC. Standaard
 * alleen de eerste twee aan een kant: zo klinkt een set voor twee precies als
 * vroeger, en doen de andere zes niets met de crossfader tot je het vraagt.
 */
export const XFADE_KANTEN = ['A', 'B', 'thru'];
/** Tracknummer van een deck, voor meldingen: A = 1, B = 2, … */
const nrVan = (id) => DECK_IDS.indexOf(id) + 1;

const STANDAARD_KANT = { A: 'A', B: 'B' };

/**
 * De engine kent GEEN MIDI, GEEN DOM en GEEN YouTube.
 * Hij kent decks, een mixer en een klok. Alles daarbuiten praat via actions.js.
 */
export class Engine extends Emitter {
  constructor() {
    super();
    /*
     * Vraag expliciet om 48 kHz, de snelheid waarop de ingest levert.
     *
     * Laat je dit aan de geluidskaart over, dan hersamplet decodeAudioData naar
     * bijvoorbeeld 44,1 kHz en klopt je golfvorm 8,8% niet meer — dat is de val
     * die op 22 september 2026 is gevonden. Nu draaien bron, peaks en engine
     * allemaal op dezelfde klok. Kan de kaart het niet, dan hersamplet de
     * browser aan de uitgang en blijft het intern consistent.
     */
    try {
      this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch (_) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    this.master = createMasterChain(this.ctx);
    this.decks = {};
    this.kant = {};
    for (const id of DECK_IDS) {
      this.decks[id] = new Deck(this.ctx, id);
      this.decks[id].chain.output.connect(this.master.input);
      this.kant[id] = STANDAARD_KANT[id] || 'thru';
    }

    this.xfader = 0.5;
    this.xfaderCurve = 'smooth';
    this.masterLevel = 0.8;
    this.focus = 'A';

    this.applyXfader();
    this.master.gain.gain.value = faderGain(this.masterLevel);
  }

  async resume() { if (this.ctx.state !== 'running') await this.ctx.resume(); }

  deck(id) { return this.decks[id]; }
  focused() { return this.decks[this.focus]; }
  setFocus(id) { this.focus = id; this.emit('change'); }

  setXfader(norm) { this.xfader = clamp(norm); this.applyXfader(); this.emit('change'); }
  setXfaderCurve(c) { this.xfaderCurve = c; this.applyXfader(); this.emit('change'); }

  /** 'A', 'B' of 'thru'. Iets anders wordt genegeerd, niet half toegepast. */
  setKant(id, kant) {
    if (!this.decks[id] || !XFADE_KANTEN.includes(kant)) return;
    this.kant[id] = kant;
    this.applyXfader();
    this.emit('change');
  }

  /** Wat de crossfader nu met deze track doet, 0..1. */
  xfadeGain(id) {
    const { a, b } = xfaderGains(this.xfader, this.xfaderCurve);
    const k = this.kant[id];
    return k === 'A' ? a : k === 'B' ? b : 1;
  }

  applyXfader() {
    const now = this.ctx.currentTime;
    for (const id of DECK_IDS) this.decks[id].chain.xfade.gain.setTargetAtTime(this.xfadeGain(id), now, 0.008);
  }

  setMaster(norm) {
    this.masterLevel = clamp(norm);
    this.master.gain.gain.setTargetAtTime(faderGain(this.masterLevel), this.ctx.currentTime, 0.02);
    this.emit('change');
  }

  /**
   * Naar wie synct deze track? Er is geen "het andere deck" meer.
   *
   * De track die je het HARDST hoort: fader maal crossfader, en hij moet
   * spelen en een grid hebben. Speelt er niets, dan de eerste geladen track
   * met een grid. Gelijke stand: het laagste nummer. Saai en voorspelbaar,
   * en in de praktijk precies de track waar je op wilt landen.
   */
  syncMaster(id) {
    let beste = null, besteGain = -1;
    for (const k of DECK_IDS) {
      const d = this.decks[k];
      if (k === id || !d.buffer || !d.grid || !d.playing) continue;
      const g = faderGain(d.ui.fader) * this.xfadeGain(k);
      if (g > besteGain + 1e-9) { beste = d; besteGain = g; }
    }
    if (beste) return beste;
    return DECK_IDS.map((k) => this.decks[k]).find((d) => d.id !== id && d.buffer && d.grid) || null;
  }

  /**
   * Tempo en fase van één deck gelijkzetten aan het andere.
   *
   * Tempo: de rate van de slave wordt zo gezet dat zijn HOORBARE bpm gelijk is
   * aan die van de master. Het grid staat in tracktijd en verandert dus niet.
   *
   * Fase: we verschuiven de slave zo dat zijn tel samenvalt met die van de
   * master, over maximaal een halve tel — verder weg springen is muzikaal
   * onzin, dan loop je liever een tel achter.
   *
   * Geen stille mislukking: als het niet kan, staat er waarom.
   */
  sync(id) {
    const slave = this.decks[id];
    if (!slave?.buffer) return { ok: false, reden: `track ${nrVan(id)} is leeg` };
    if (!slave.grid) return { ok: false, reden: `track ${nrVan(id)} heeft nog geen beatgrid — tik eerst het tempo (TAP)` };
    const master = this.syncMaster(id);
    if (!master) return { ok: false, reden: 'geen andere track met een beatgrid om naar te syncen' };

    const doelBpm = master.grid.bpm * master.rate;
    const rate = doelBpm / slave.grid.bpm;
    if (rate < 0.5 || rate > 2) {
      return { ok: false, reden: `tempoverschil te groot (${rate.toFixed(2)}x) — probeer bpm x2 of /2` };
    }
    slave.setRate(rate);

    if (!master.playing || !slave.playing) {
      return { ok: true, tempo: true, fase: false, rate, bpm: doelBpm, master: master.id,
        reden: 'tempo gelijk; de fase pas als beide tracks spelen' };
    }

    const beat = slave.grid.beatLength;
    let delta = (master.grid.phase(master.position) - slave.grid.phase(slave.position)) * beat;
    if (delta > beat / 2) delta -= beat;
    if (delta < -beat / 2) delta += beat;
    slave.seek(slave.position + delta);

    this.emit('change');
    return { ok: true, tempo: true, fase: true, rate, bpm: doelBpm, verschoven: delta, master: master.id };
  }

  /**
   * Hoe ver loopt deze track uit de pas met zijn syncmaster, in seconden?
   * Positief = deze track loopt vóór. Null als het niet te zeggen is.
   */
  faseVerschil(id) {
    const a = this.decks[id], b = this.syncMaster(id);
    if (!a?.grid || !b?.grid || !a.buffer || !b.buffer) return null;
    const beat = a.grid.beatLength / a.rate;        // hoorbare tellengte (sneller = korter)
    let d = (a.grid.phase(a.position) - b.grid.phase(b.position)) * beat;
    if (d > beat / 2) d -= beat;
    if (d < -beat / 2) d += beat;
    return d;
  }

  masterPeak() { return piek(this.master.analyser); }

  /**
   * Platte state-snapshot. De UI leest hem per frame; in fase 2 leest de
   * LED-renderer exact dezelfde snapshot en diff't hem tegen de vorige.
   */
  snapshot() {
    const deckState = (d) => ({
      id: d.id, title: d.title, loaded: !!d.buffer,
      playing: d.playing, position: d.position, duration: d.duration,
      rate: d.rate, cuePoint: d.cuePoint,
      grid: d.grid ? d.grid.toJSON() : null, bpm: d.bpm, loopBeats: d.loopBeats ?? null,
      fx: { effect: d.fx.effectId, naam: d.fx.rackNaam ?? null,
            mix: d.fx.mix, bypass: d.fx.bypass,
            plekken: [1, 2, 3, 4, 5, 6, 7, 8]
              .map((k) => ({ plek: k, naam: d.fx.plekNaam(k), waarde: d.fx.leesPlek(k),
                             bipolair: d.fx.plekBipolair(k) }))
              .filter((p) => p.naam !== null),
            ketens: d.fx.nodeAantal },
      hotcues: d.hotcues.slice(), loop: d.loop ? { ...d.loop } : null,
      ui: { ...d.ui }, level: d.level(), kant: this.kant[d.id],
    });
    const decks = {}, fase = {};
    for (const id of DECK_IDS) { decks[id] = deckState(this.decks[id]); fase[id] = this.faseVerschil(id); }
    return {
      focus: this.focus,
      xfader: this.xfader, xfaderCurve: this.xfaderCurve,
      master: this.masterLevel, masterPeak: this.masterPeak(),
      fase, decks,
    };
  }
}
