import { clamp } from '../lib/emitter.js';
import { faderGain, killVersterking } from './audio-graph.js';
import { startDrempel } from './overgang.js';
import { zetDoel } from './fx.js';

/*
 * De koptelefoon (PFL, ROADMAP 25 / 27 S1, docs/STUDIO.md §3): een track
 * voorbeluisteren zonder dat de zaal hem hoort.
 *
 * Eén AudioContext op één uitgang met VIER kanalen, zodat er één klok blijft
 * (regel 3). Op de Mac is dat een samengesteld apparaat: de Scarlett 2i2 voor
 * de zaal (kanaal 1/2) en de koptelefoonuitgang van de Mac (3/4).
 *
 *   track:  … -> lpf -> pfl (0 of 1) -> cue (som) -> cueKant --.
 *                   `-> fader -> …                              +--> uit (volume) -> [3/4]
 *   master: … -> limiter -> analyser -> [1/2]                    |
 *                                    `-> zaalKant ---------------'
 *
 * De cue tapt VÓÓR de fader (na trim, EQ, effect en filter): je hoort een
 * track ook met de fader dicht, zoals op elke DJ-mixer. Staat er geen enkele
 * cue aan, dan hoort de koptelefoon de zaal (je hoort altijd iets).
 *
 * Kan de uitgang geen vier kanalen, dan bestaat dit allemaal niet: geen node
 * erbij, `zaalIn` is gewoon `ctx.destination` (bit voor bit het oude pad),
 * `beschikbaar` is false en elke cue leest null.
 */

/** Zoveel kanalen moet de uitgang hebben: 1/2 de zaal, 3/4 de koptelefoon. */
export const KANALEN = 4;
/** Tijdconstante (s) waarmee volume en mix hun doel volgen: zoals een knop. */
const TAU = 0.02;
/** Standaardstanden: volume als een fader op 0,8 (−9 dB), mix helemaal cue. */
export const NIVEAU_STANDAARD = 0.8;
export const MIX_STANDAARD = 0;

/** Kan deze context een koptelefoon apart sturen? */
export function kanApart(ctx) {
  const d = ctx.destination;
  return (d?.maxChannelCount ?? 0) >= KANALEN
    && typeof ctx.createChannelMerger === 'function' && typeof ctx.createChannelSplitter === 'function';
}

/**
 * Wat cue en zaal krijgen bij een mix van 0..1 (equal power: 0 = alleen cue,
 * 1 = alleen de zaal). Zonder enige cue: alleen de zaal, vol.
 */
export function kanten(mix, iets) {
  const hoek = clamp(mix) * Math.PI / 2;
  return { cue: Math.cos(hoek), zaal: iets ? Math.sin(hoek) : 1 };
}

export class Koptelefoon {
  /**
   * @param {AudioContext} ctx
   * @param {{ omgewisseld?: boolean }} opties  omgewisseld: de zaal op 3/4 en de
   *   koptelefoon op 1/2 (een samengesteld apparaat in de andere volgorde).
   *   Alleen bij het maken: andere bedrading terwijl er geluid loopt klikt.
   */
  constructor(ctx, { omgewisseld = false } = {}) {
    this.ctx = ctx;
    this.beschikbaar = kanApart(ctx);
    this.kanalen = ctx.destination?.maxChannelCount ?? 2;
    this.omgewisseld = !!omgewisseld;
    this.niveau = NIVEAU_STANDAARD;
    this.mix = MIX_STANDAARD;
    this._pfl = new Map();             // deckId -> { gain, aan }
    if (!this.beschikbaar) { this.zaalIn = ctx.destination; return; }

    const d = ctx.destination;
    d.channelCount = KANALEN;
    d.channelCountMode = 'explicit';
    d.channelInterpretation = 'discrete';
    const merger = ctx.createChannelMerger(KANALEN);
    const zaal = ctx.createChannelSplitter(2);
    const kop = ctx.createChannelSplitter(2);
    const [z, k] = this.omgewisseld ? [2, 0] : [0, 2];
    zaal.connect(merger, 0, z); zaal.connect(merger, 1, z + 1);
    kop.connect(merger, 0, k); kop.connect(merger, 1, k + 1);
    merger.connect(d);

    this.cue = ctx.createGain();        // de som van alle tracks met cue aan
    this.cueKant = ctx.createGain();
    this.zaalKant = ctx.createGain();
    this.uit = ctx.createGain();        // het koptelefoonvolume
    this.cue.connect(this.cueKant).connect(this.uit);
    this.zaalKant.connect(this.uit);
    this.uit.connect(kop);
    const { cue, zaal: zk } = kanten(this.mix, false);
    this.cueKant.gain.value = cue;
    this.zaalKant.gain.value = zk;
    this.uit.gain.value = faderGain(this.niveau);
    this.zaalIn = zaal;
    this.merger = merger;
  }

  /** De zaal (het eind van de masterketen, na de limiter) ook in de koptelefoon. */
  hoorZaal(node) { if (this.beschikbaar) node.connect(this.zaalKant); }

  /** Een track die je kunt voorbeluisteren; `tap` is zijn punt vóór de fader. */
  voegToe(id, tap) {
    if (!this.beschikbaar || this._pfl.has(id)) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    tap.connect(gain).connect(this.cue);
    this._pfl.set(id, { gain, aan: false });
  }

  heeft(id) { return this._pfl.has(id); }
  pflAan(id) { return !!this._pfl.get(id)?.aan; }
  /** Staat er minstens één cue aan? */
  get iets() { for (const p of this._pfl.values()) if (p.aan) return true; return false; }

  /**
   * Cue aan of uit, klikvrij: dezelfde zachte S als de EQ-kill, na de
   * startdrempel (nooit setValueCurveAtTime). @returns of er iets veranderde
   */
  zetPfl(id, aan) {
    const p = this._pfl.get(id);
    if (!p || p.aan === !!aan) return false;
    p.aan = !!aan;
    killVersterking(p.gain.gain, p.aan ? 1 : 0, this.ctx.currentTime, startDrempel(this.ctx));
    this._kanten();
    return true;
  }

  wisselPfl(id) { return this.zetPfl(id, !this.pflAan(id)); }

  /** Volume 0..1, met de curve van een fader (dicht = −70 dB). */
  zetNiveau(v) {
    this.niveau = clamp(v);
    if (this.beschikbaar) zetDoel(this.uit.gain, faderGain(this.niveau), this.ctx, TAU);
  }

  /** Mix 0..1: 0 = alleen de cue, 1 = alleen de zaal. */
  zetMix(v) {
    this.mix = clamp(v);
    this._kanten();
  }

  _kanten() {
    if (!this.beschikbaar) return;
    const { cue, zaal } = kanten(this.mix, this.iets);
    zetDoel(this.cueKant.gain, cue, this.ctx, TAU);
    zetDoel(this.zaalKant.gain, zaal, this.ctx, TAU);
  }

  /** Platte stand, voor de snapshot en het scherm. */
  stand() {
    const pfl = {};
    for (const [id, p] of this._pfl) pfl[id] = p.aan;
    return { beschikbaar: this.beschikbaar, kanalen: this.kanalen, omgewisseld: this.omgewisseld,
      niveau: this.niveau, mix: this.mix, iets: this.iets, pfl };
  }
}
