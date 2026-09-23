import { Emitter, clamp } from '../lib/emitter.js';
import { Deck } from './deck.js';
import { createMasterChain, xfaderGains, faderGain } from './audio-graph.js';

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
    this.decks = {
      A: new Deck(this.ctx, 'A'),
      B: new Deck(this.ctx, 'B'),
    };
    for (const d of Object.values(this.decks)) d.chain.output.connect(this.master.input);

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

  applyXfader() {
    const { a, b } = xfaderGains(this.xfader, this.xfaderCurve);
    const now = this.ctx.currentTime;
    this.decks.A.chain.xfade.gain.setTargetAtTime(a, now, 0.008);
    this.decks.B.chain.xfade.gain.setTargetAtTime(b, now, 0.008);
  }

  setMaster(norm) {
    this.masterLevel = clamp(norm);
    this.master.gain.gain.setTargetAtTime(faderGain(this.masterLevel), this.ctx.currentTime, 0.02);
    this.emit('change');
  }

  /** Het andere deck. Met acht tracks wordt dit een aangewezen master. */
  ander(id) { return this.decks[id === 'A' ? 'B' : 'A']; }

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
    const master = this.ander(id);
    if (!slave?.buffer) return { ok: false, reden: `deck ${id} is leeg` };
    if (!master.buffer) return { ok: false, reden: `deck ${master.id} is leeg` };
    if (!slave.grid) return { ok: false, reden: `deck ${id} heeft nog geen beatgrid` };
    if (!master.grid) return { ok: false, reden: `deck ${master.id} heeft nog geen beatgrid` };

    const doelBpm = master.grid.bpm * master.rate;
    const rate = doelBpm / slave.grid.bpm;
    if (rate < 0.5 || rate > 2) {
      return { ok: false, reden: `tempoverschil te groot (${rate.toFixed(2)}x) — probeer bpm x2 of /2` };
    }
    slave.setRate(rate);

    if (!master.playing || !slave.playing) {
      return { ok: true, tempo: true, fase: false, rate, bpm: doelBpm,
        reden: 'tempo gelijk; fase pas als beide decks spelen' };
    }

    const beat = slave.grid.beatLength;
    let delta = (master.grid.phase(master.position) - slave.grid.phase(slave.position)) * beat;
    if (delta > beat / 2) delta -= beat;
    if (delta < -beat / 2) delta += beat;
    slave.seek(slave.position + delta);

    this.emit('change');
    return { ok: true, tempo: true, fase: true, rate, bpm: doelBpm, verschoven: delta };
  }

  /**
   * Hoe ver lopen de twee decks uit de pas, in seconden?
   * Positief = dit deck loopt vóór. Null als het niet te zeggen is.
   */
  faseVerschil(id) {
    const a = this.decks[id], b = this.ander(id);
    if (!a?.grid || !b?.grid || !a.buffer || !b.buffer) return null;
    const beat = a.grid.beatLength * a.rate;        // hoorbare tellengte
    let d = (a.grid.phase(a.position) - b.grid.phase(b.position)) * beat;
    if (d > beat / 2) d -= beat;
    if (d < -beat / 2) d += beat;
    return d;
  }

  masterPeak() {
    const a = this.master.analyser;
    const buf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
    return peak;
  }

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
      ui: { ...d.ui }, level: d.level(),
    });
    return {
      focus: this.focus,
      xfader: this.xfader, xfaderCurve: this.xfaderCurve,
      master: this.masterLevel, masterPeak: this.masterPeak(),
      fase: { A: this.faseVerschil('A'), B: this.faseVerschil('B') },
      decks: { A: deckState(this.decks.A), B: deckState(this.decks.B) },
    };
  }
}
