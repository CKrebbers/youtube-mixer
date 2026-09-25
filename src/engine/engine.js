import { Emitter, clamp, piek } from '../lib/emitter.js';
import { Deck } from './deck.js';
import { createMasterChain, xfaderGains, faderGain } from './audio-graph.js';
import { InsertSlot, startDrempel } from './fx.js';
import { Sampler } from './sampler.js';

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

/** De melding als sync of een beat-loop weigert omdat het grid daar onzeker is. */
export const ONZEKER_WAT = 'tik eerst het tempo of zet het grid op slot';
export const ONZEKER = `grid hier onzeker — ${ONZEKER_WAT}`;

/**
 * De twee send-bussen. Gewone racks in een gewone insert-slot, maar dan
 * helemaal nat: er zit geen droog signaal op een bus, dat komt al via de
 * track zelf. Knop 1..3 per bus zijn plekken, net als bij de tracks.
 */
export const SEND_RACKS = {
  // Standaard op de maat, 1/4 tel (knop 3/7 van de acht delingen). Knop 4
  // schakelt naar vrij; dan is knop 1 weer milliseconden.
  A: { schema: 1, name: 'Echo', chain: [{ slot: 'a', type: 'delay', params: { tijd: 3 / 7, feedback: 0.5, toon: 0.5, sync: 1 } }],
    macros: [
      { place: 1, label: 'tijd', default: 3 / 7, links: [{ target: 'a.tijd', from: 0, to: 1 }] },
      { place: 2, label: 'herhaling', default: 0.5, links: [{ target: 'a.feedback', from: 0, to: 1 }] },
      { place: 3, label: 'toon', default: 0.5, links: [{ target: 'a.toon', from: 0, to: 1 }] },
      { place: 4, label: 'op de maat', default: 1, links: [{ target: 'a.sync', from: 0, to: 1 }] },
    ] },
  B: { schema: 1, name: 'Galm', chain: [{ slot: 'a', type: 'reverb', params: { grootte: 0.7, toon: 0.5, meng: 1, freeze: 0 } }],
    macros: [
      { place: 1, label: 'grootte', default: 0.7, links: [{ target: 'a.grootte', from: 0, to: 1 }] },
      { place: 2, label: 'toon', default: 0.5, links: [{ target: 'a.toon', from: 0, to: 1 }] },
      { place: 3, label: 'vasthouden', default: 0, links: [{ target: 'a.freeze', from: 0, to: 1 }] },
    ] },
};
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

    this.sends = {};
    // De bussen lopen op de maat van wat je hoort: dezelfde klok als sync en sampler.
    const maatKlok = () => { const d = this.syncMaster(); return d ? d.fxKlok() : null; };
    for (const [bus, rack] of Object.entries(SEND_RACKS)) {
      const slot = new InsertSlot(this.ctx);
      slot.setKlok(maatKlok);
      slot.setMix(1);                        // helemaal nat
      slot.zetRack(rack);
      slot.out.connect(this.master.input);
      for (const id of DECK_IDS) this.decks[id][`send${bus}`].connect(slot.in);
      this.sends[bus] = slot;
    }

    // De sampler speelt op de maat van wat je hoort: dezelfde klok als sync.
    this.sampler = new Sampler(this.ctx, this.master.input, { klok: maatKlok });

    /*
     * Bussen en sampler horen bij geen enkel deck, dus niemand herankert ze
     * vanzelf. Elke wijziging aan een deck (tempo, grid, play, seek, fader)
     * of aan de mixer (crossfader) kan de maat veranderen. Ze rekenen zelf
     * uit of er echt iets anders is; meestal gebeurt er niets.
     */
    this._opDeMaat = {};         // id -> { tellen }: wacht op de maat (startOpDeMaat)
    const volgMaat = () => {
      for (const s of Object.values(this.sends)) s.heranker();
      this.sampler.heranker();
      this._volgWachtenden();
    };
    for (const id of DECK_IDS) this.decks[id].on('change', volgMaat);
    this.on('change', volgMaat);

    this.xfader = 0.5;
    this.xfaderCurve = 'smooth';
    this.masterLevel = 0.8;
    this.focus = 'A';
    this.quantize = false;       // zie setQuantize

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
   * Quantize, voor de HELE engine: cue, hotcues en loop in/out op de tel,
   * hotcue-sprongen fasebehoudend (zie Deck._snap en _faseDoel).
   *
   * Eén schakelaar in plaats van één per track: met acht tracks wil je niet
   * per track onthouden of hij aan stond, het kost op de APC één knop in
   * plaats van acht, en rekordbox, Traktor en Serato doen het ook zo. Het
   * deck draagt de vlag, zodat hij zelf niets van de engine hoeft te weten.
   */
  setQuantize(aan) {
    this.quantize = !!aan;
    for (const id of DECK_IDS) this.decks[id].quantize = this.quantize;
    this.emit('change');
  }

  /**
   * Starten op de maat (play.quant): het geluid begint op het volgende
   * MAATBEGIN van de maatgever (syncMaster: de track die je het hardst hoort),
   * zodat de track in fase en op de "1" invalt. Zonder spelende maatgever met
   * een zeker grid: meteen, zoals gewone play.
   *
   * Maat en geen tel: dat vroeg de blauwdruk ("start op volgende maat") en
   * het plan ("een track die precies op de volgende maat invalt"), en het is
   * wat de APC in Ableton ook doet (launch op de volgende maat). Wachten is
   * hooguit één maat (2 s op 120 bpm). `tellen` = 1 geeft de volgende tel.
   * Het maatbegin is dat van het grid: tel 0 van het eerste stuk en elke
   * vierde tel daarna, zoals de golfvorm het tekent.
   *
   * Fase: de tel van deze track die het dichtst bij het startpunt ligt, valt
   * precies op dat maatbegin. Staat het startpunt een fractie naast zijn tel
   * (cue zonder quantize), dan begint het geluid evenveel eerder of later, en
   * valt de klap toch op de "1". Zonder zeker grid op deze track geldt het
   * startpunt zelf als tel.
   *
   * Regel 3: het moment komt van de audioklok (ctxTimeOf van de maatgever),
   * en de bron begint daar sample-exact. Geen timer. Ligt het maatbegin
   * binnen de uitgangsbuffer (startDrempel), dan de maat erna. Tijdens het
   * wachten loopt hij mee als die tel verschuift (_volgWachtenden).
   *
   * @returns {{ ok: boolean, op: number|null, master?: string, reden?: string }}
   */
  startOpDeMaat(id, { tellen = null } = {}) {
    const d = this.decks[id];
    if (!d?.buffer) return { ok: false, op: null, reden: `track ${nrVan(id)} is leeg` };
    if (d.playing) return { ok: false, op: null };
    const m = this.syncMaster(id);
    const k = m?.playing ? m.fxKlok() : null;
    if (!k) { d.play(); return { ok: true, op: null }; }
    if (!m.gridZekerHier) {
      d.play();
      return { ok: true, op: null, master: m.id, reden: `grid van track ${nrVan(m.id)} is daar onzeker — meteen gestart` };
    }
    const { n, telOp } = this._tellenVan(m, k);
    const off = this._naastDeTel(d);
    const grens = this.ctx.currentTime + startDrempel(this.ctx);
    const per = tellen ?? m.grid.beatsPerBar;
    let b = m.grid.volgendeVeelvoud(n, per);
    let op = telOp(b) + off;
    for (let i = 0; i < 64 && !(op >= grens); i++) { b += per; op = telOp(b) + off; }
    if (!Number.isFinite(op) || !(op >= grens)) { d.play(); return { ok: true, op: null, master: m.id }; }
    d.play({ op });
    // Welke TEL van de maatgever het werd (audioklok), voor _volgWachtenden.
    this._opDeMaat[id] = { tel: op - off };
    return { ok: true, op, master: m.id };
  }

  /**
   * De tellen van maatgever `m` op de audioklok: `telOp(b)` = wanneer tel b
   * valt, `n` = zijn eerstvolgende tel. In een loop via de klok `k` (tellen
   * van gelijke lengte vanaf de volgende tel): ctxTimeOf kent geen tel voorbij
   * het loopeinde, en een beat-loop is toch een heel aantal tellen.
   */
  _tellenVan(m, k) {
    const g = m.grid;
    const n = Math.ceil(g.beatAt(m.position) - 1e-9);
    return { n, telOp: (b) => (m.loop ? k.ankerCtx + (b - n) * k.beatLengte : m.ctxTimeOf(g.timeOf(b))) };
  }

  /** Waar de tel van track `d` ligt ten opzichte van zijn startpunt, in afspeeltijd. */
  _naastDeTel(d) {
    const p = d.position >= d.duration - 0.01 ? 0 : d.position;
    return d.grid && d.grid.zekerBij(p) ? (p - d.grid.timeOf(Math.round(d.grid.beatAt(p)))) / d.rate : 0;
  }

  /**
   * Wachtende tracks lopen mee met de maat, zoals de sampler-pads: verschuift
   * de tel van de maatgever waarop een track zou beginnen (tempo, sprong of
   * grid van de maatgever, of een andere maatgever), of verandert het eigen
   * tempo of startpunt, dan opnieuw plannen. Een vast startmoment viel anders
   * naast de 1: +3% op de maatgever halverwege een maat van 120 bpm = 35 ms.
   *
   * Het volgt DEZELFDE tel (de dichtstbijzijnde bij de geplande), niet
   * opnieuw "de volgende maat": in een loop korter dan een maat telt de klok
   * door, en dan schoof de start bij elke ronde (en elke fader-'change') een
   * loop op, zodat hij nooit begon. Niet meer als de start al in de
   * uitgangsbuffer zit, en niet op een maatgever die zelf wacht of stilstaat:
   * dan blijft het plan. Bend telt niet mee (geen 'change'), net als bij de sampler.
   */
  _volgWachtenden() {
    for (const id of DECK_IDS) {
      const plan = this._opDeMaat[id];
      if (!plan) continue;
      const d = this.decks[id];
      const T = d.bron.wachtTot;
      if (T == null) { this._opDeMaat[id] = null; continue; }
      const grens = this.ctx.currentTime + startDrempel(this.ctx);
      if (T < grens) continue;
      const m = this.syncMaster(id);
      const k = m?.playing && !m.wacht ? m.fxKlok() : null;
      if (!k || !(k.beatLengte > 0) || !m.gridZekerHier) continue;
      const { n, telOp } = this._tellenVan(m, k);
      // Schatten met de lengte van de volgende tel, dan de echte dichtstbijzijnde
      // zoeken: over een stukgrens van de tempokaart zijn de tellen niet even lang.
      const afstand = (b) => Math.abs(telOp(b) - plan.tel);
      let b = n + Math.round((plan.tel - k.ankerCtx) / k.beatLengte);
      for (let i = 0; i < 16 && afstand(b + 1) < afstand(b); i++) b++;
      for (let i = 0; i < 16 && afstand(b - 1) < afstand(b); i++) b--;
      const tel = telOp(b);
      const op = tel + this._naastDeTel(d);
      if (!Number.isFinite(op) || op < grens) continue;
      plan.tel = tel;
      if (Math.abs(op - T) > 1e-6) d.herplan(op);
    }
  }

  /**
   * Naar wie synct deze track? Er is geen "het andere deck" meer.
   *
   * De track die je het HARDST hoort: fader maal crossfader, en hij moet
   * spelen en een grid hebben. Speelt er niets, dan de eerste geladen track
   * met een grid. Gelijke stand: het laagste nummer. Saai en voorspelbaar,
   * en in de praktijk precies de track waar je op wilt landen.
   *
   * Een track die op zijn start op de maat WACHT (deck.wacht) speelt al, maar
   * klinkt nog niet: die telt pas mee als er verder niets klinkt. Anders nam
   * hij met een hogere fader de maat over tot een maat voordat je hem hoort:
   * sync van een derde track ging naar zijn tempo, en echo en sampler liepen
   * er al op. Op zijn start meldt het deck zich (Deck._heranker).
   */
  syncMaster(id) {
    const hardste = (wachtendMag) => {
      let beste = null, besteGain = -1;
      for (const k of DECK_IDS) {
        const d = this.decks[k];
        if (k === id || !d.buffer || !d.grid || !d.playing || (d.wacht && !wachtendMag)) continue;
        const g = faderGain(d.ui.fader) * this.xfadeGain(k);
        if (g > besteGain + 1e-9) { beste = d; besteGain = g; }
      }
      return beste;
    };
    return hardste(false) || hardste(true)
      || DECK_IDS.map((k) => this.decks[k]).find((d) => d.id !== id && d.buffer && d.grid) || null;
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
    // Een onzeker grid (van de analyse, niet op slot) is erger dan geen grid:
    // de sync lijkt te lukken en loopt na een paar maten een tel weg.
    if (!slave.gridZekerHier) return { ok: false, reden: ONZEKER };
    if (!master.gridZekerHier) return { ok: false, reden: `grid van track ${nrVan(master.id)} is daar onzeker — ${ONZEKER_WAT}` };

    // Tempo op de plek waar beide NU zijn: met een tempokaart verschilt dat per stuk.
    const doelBpm = master.bpm;
    const rate = doelBpm / slave.grid.bpmAt(slave.position);
    if (rate < 0.5 || rate > 2) {
      return { ok: false, reden: `tempoverschil te groot (${rate.toFixed(2)}x) — probeer bpm x2 of /2` };
    }
    slave.setRate(rate);

    if (!master.playing || !slave.playing) {
      return { ok: true, tempo: true, fase: false, rate, bpm: doelBpm, master: master.id,
        reden: 'tempo gelijk; de fase pas als beide tracks spelen' };
    }
    // Wacht een van beide nog op zijn start op de maat, dan staat zijn
    // positie stil en zegt de fase nu niets. De fase komt dan van die start.
    if (master.wacht || slave.wacht) {
      return { ok: true, tempo: true, fase: false, rate, bpm: doelBpm, master: master.id,
        reden: 'tempo gelijk; de fase komt van de start op de maat' };
    }

    const beat = slave.grid.beatLengthAt(slave.position);
    let delta = (master.grid.phase(master.position) - slave.grid.phase(slave.position)) * beat;
    if (delta > beat / 2) delta -= beat;
    if (delta < -beat / 2) delta += beat;
    // Fasecorrectie binnen een loop blijft in de loop: een halve tel over de
    // grens wordt teruggevouwen. Een gewone seek daar zou de loop verlaten.
    slave.seek(slave.position + delta, { binnenLoop: true });

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
    const beat = a.grid.beatLengthAt(a.position) / a.rate;   // hoorbare tellengte hier (sneller = korter)
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
      grid: d.grid ? d.grid.toJSON() : null, gridZeker: d.gridZekerHier, bpm: d.bpm, loopBeats: d.loopBeats ?? null,
      fx: { effect: d.fx.effectId, naam: d.fx.rackNaam ?? null,
            mix: d.fx.mix, bypass: d.fx.bypass,
            plekken: [1, 2, 3, 4, 5, 6, 7, 8]
              .map((k) => ({ plek: k, naam: d.fx.plekNaam(k), waarde: d.fx.leesPlek(k),
                             bipolair: d.fx.plekBipolair(k) }))
              .filter((p) => p.naam !== null),
            ketens: d.fx.nodeAantal },
      hotcues: d.hotcues.slice(), loop: d.loop ? { ...d.loop } : null,
      loopIn: d.loopInPunt, wacht: d.wacht, sprongTellen: d.sprongTellen,
      ui: { ...d.ui }, level: d.level(), kant: this.kant[d.id],
    });
    const decks = {}, fase = {};
    for (const id of DECK_IDS) { decks[id] = deckState(this.decks[id]); fase[id] = this.faseVerschil(id); }
    return {
      focus: this.focus, quantize: this.quantize,
      xfader: this.xfader, xfaderCurve: this.xfaderCurve,
      master: this.masterLevel, masterPeak: this.masterPeak(),
      fase, decks,
      // Welke track geeft nu de maat (sync, sampler, video-puls)?
      maat: this.syncMaster()?.id ?? null,
    };
  }
}
