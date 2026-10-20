// De koptelefoon (PFL): een track voorbeluisteren zonder dat de zaal hem hoort (v1
// src/engine/koptelefoon.js @ 6a640ac, docs/STUDIO.md §3; hier een deel van de audiolaag).
//
// Eén AudioContext op één uitgang met VIER kanalen, zodat er één klok blijft (regel 3; nooit
// een tweede context met setSinkId: dat zijn twee klokken). Op de Mac een samengesteld
// apparaat: de Scarlett 2i2 voor de zaal (1/2), de koptelefoonuitgang van de Mac (3/4).
//
//   strip:  … -> naFilter (+ natte weg van de insert-slot) -> pfl (0 of 1) -> cue -> vertraging -> cueKant --.
//                                                       `-> fader -> …                                        +-> uit (volume) -> [3/4]
//   master: … -> limiter -> analyser -> [1/2]                                                                |
//                                    `-> zaalKant ----------------------------------------------------------'
//
// De cue tapt VÓÓR de fader (na trim, EQ, filter en effect): je hoort een track ook met de fader
// dicht, zoals op elke DJ-mixer. Staat er geen enkele cue aan, dan hoort de koptelefoon de zaal.
// Kan de uitgang geen vier kanalen, dan bestaat dit allemaal niet: geen node erbij, `zaalIn` is
// gewoon de uitgang (bit voor bit het pad zonder koptelefoon), `beschikbaar` is false.
import { clamp } from '../kern/emitter.js';
import { houdVast, startDrempel } from './overgang.js';
import { faderGain, killVersterking, zetDoel } from './strip.js';

/** Zoveel kanalen moet de uitgang hebben: 1/2 de zaal, 3/4 de koptelefoon. */
export const KANALEN = 4;
/** Tijdconstante (s) waarmee volume en mix hun doel volgen: zoals een knop. */
const TAU = 0.02;
/** Hooguit zoveel vertraging (s) op de cue: genoeg voor de vooruitblik van elke master. */
export const MAX_VERTRAGING = 0.05;
/** Zo lang schuift de cue mee als de master wisselt terwijl er geluid loopt (zoals zijn kruisfade). */
const VERTRAGING_GLIJ = 0.04;
/** Beginstanden: volume als een fader op 0,8 (−9 dB), mix helemaal cue. */
export const VOLUME_BEGIN = 0.8;
export const MIX_BEGIN = 0;

/** Kan deze context een koptelefoon apart sturen? */
export function kanApart(ctx) {
  const d = ctx.destination;
  return (d?.maxChannelCount ?? 0) >= KANALEN
    && typeof ctx.createChannelMerger === 'function' && typeof ctx.createChannelSplitter === 'function';
}

/** Wat cue en zaal krijgen bij een mix van 0..1 (equal power: 0 = alleen cue). Zonder cue: de zaal, vol. */
export function kanten(mix, iets) {
  const hoek = clamp(mix) * Math.PI / 2;
  return { cue: Math.cos(hoek), zaal: iets ? Math.sin(hoek) : 1 };
}

export class Koptelefoon {
  /**
   * @param {BaseAudioContext} ctx
   * @param {{ uit?: AudioNode, omgewisseld?: boolean }} opties  omgewisseld: de zaal op 3/4 en de
   *   koptelefoon op 1/2. Alleen bij het maken: andere bedrading terwijl er geluid loopt klikt.
   */
  constructor(ctx, { uit = ctx.destination, omgewisseld = false } = {}) {
    this.ctx = ctx;
    this.beschikbaar = uit === ctx.destination && kanApart(ctx);
    this.kanalen = ctx.destination?.maxChannelCount ?? 2;
    this.omgewisseld = !!omgewisseld;
    this.volume = VOLUME_BEGIN;
    this.mix = MIX_BEGIN;
    this._aan = new Set();             // de pfl-gains die aan staan
    if (!this.beschikbaar) { this.zaalIn = uit; return; }

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
    // De zaal komt NA de limiter (vooruitblik), de cue vóór de master: zonder deze vertraging loopt
    // de cue voor en geeft de mix in het midden een kamfilter. De mixer zet hem (zetVertraging).
    this.cueVertraging = ctx.createDelay(MAX_VERTRAGING);
    this.cueVertraging.delayTime.value = 0;
    this.cueKant = ctx.createGain();
    this.zaalKant = ctx.createGain();
    this.uit = ctx.createGain();        // het koptelefoonvolume
    this.cue.connect(this.cueVertraging);
    this.cueVertraging.connect(this.cueKant);
    this.cueKant.connect(this.uit);
    this.zaalKant.connect(this.uit);
    this.uit.connect(kop);
    const { cue, zaal: zk } = kanten(this.mix, false);
    this.cueKant.gain.value = cue;
    this.zaalKant.gain.value = zk;
    this.uit.gain.value = faderGain(this.volume);
    this.zaalIn = zaal;
    this.merger = merger;
    this._nodes = [merger, zaal, kop, this.cue, this.cueVertraging, this.cueKant, this.zaalKant, this.uit];
  }

  /** De zaal (het eind van de masterketen, na de limiter) ook in de koptelefoon. */
  hoorZaal(node) { if (this.beschikbaar) node.connect(this.zaalKant); }

  /** Een nieuwe pfl-ingang (gain op 0) voor een strip: hij verbindt zijn tap erop. Null zonder koptelefoon. */
  ingang() {
    if (!this.beschikbaar) return null;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.cue);
    return g;
  }

  /** Een pfl-ingang aan of uit, klikvrij (de zachte S van de EQ-kill, na startDrempel). */
  zet(g, aan) {
    if (!g || this._aan.has(g) === !!aan) return false;
    if (aan) this._aan.add(g); else this._aan.delete(g);
    killVersterking(g.gain, aan ? 1 : 0, this.ctx.currentTime, startDrempel(this.ctx));
    this._kanten();
    return true;
  }

  /** Staat er minstens één cue aan? */
  get iets() { return this._aan.size > 0; }

  /** Volume 0..1, met de curve van een fader. */
  zetVolume(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return false;
    this.volume = clamp(v);
    if (this.beschikbaar) zetDoel(this.uit.gain, faderGain(this.volume), this.ctx.currentTime, TAU);
    return true;
  }

  /** Mix 0..1: 0 = alleen de cue, 1 = alleen de zaal. */
  zetMix(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return false;
    this.mix = clamp(v);
    this._kanten();
    return true;
  }

  _kanten() {
    if (!this.beschikbaar) return;
    const { cue, zaal } = kanten(this.mix, this.iets), nu = this.ctx.currentTime;
    zetDoel(this.cueKant.gain, cue, nu, TAU);
    zetDoel(this.zaalKant.gain, zaal, nu, TAU);
  }

  /**
   * De cue even laat als de zaal: de vertraging van de master (de vooruitblik van de limiter).
   * Stil = meteen; loopt de audio, dan glijdt hij in VERTRAGING_GLIJ mee.
   */
  zetVertraging(sec) {
    if (!this.beschikbaar) return;
    const v = Math.min(MAX_VERTRAGING, Math.max(0, Number(sec) || 0));
    const p = this.cueVertraging.delayTime;
    if (this.ctx.state !== 'running') { p.value = v; return; }
    const nu = this.ctx.currentTime;
    houdVast(p, nu);
    p.linearRampToValueAtTime(v, nu + VERTRAGING_GLIJ);
  }

  vernietig() { for (const n of this._nodes ?? []) { try { n.disconnect(); } catch (_) {} } }
}
