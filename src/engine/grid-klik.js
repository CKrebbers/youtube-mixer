/**
 * DE CONTROLEKLIK (docs/BEATGRID.md §11, 6 okt): een tik op elke gridlijn van
 * één deck, met een accent op de "1". Zo HOOR je of het grid klopt, in plaats
 * van het op het scherm te zoeken: valt de tik op de kick, dan klopt het; loopt
 * hij ervoor of erachter, dan zie je in de zoom waar.
 *
 * Op de audioklok (regel 3): de tikken worden een eindje vooruit ingepland op
 * deck.ctxTimeOf(tel), dezelfde brug als de effecten op de tel. Een timer
 * bepaalt alleen WANNEER er gepland wordt. Na een sprong, een gridbewerking of
 * een pauze begint het plannen opnieuw bij de speelkop.
 *
 * Waarheen: de engine geeft de koptelefoon (de cue-som, na de deckketen: even
 * laat als de track zelf in de koptelefoon) als die er is, anders de master
 * (dan hoort de zaal het ook — bedoeld voor voorbereiden).
 *
 * Geen DOM, geen MIDI. Een tik is een AudioBufferSourceNode per tel: een
 * paar per seconde, op de hoofdthread, niet in het audiopad.
 */

/** Zo ver vooruit (s) worden tikken ingepland; de timer loopt elke PLAN_MS. */
const VOORUIT = 0.15;
const PLAN_MS = 30;

/** Een korte tik: een sinus die in ~6 ms wegsterft. */
function maakTik(ctx, freq, sterkte) {
  const sr = ctx.sampleRate, n = Math.round(sr * 0.03);
  const buf = ctx.createBuffer(1, n, sr);
  const x = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = sterkte * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / 0.006) * Math.min(1, i / 8);
  }
  return buf;
}

export class GridKlik {
  /** @param {BaseAudioContext} ctx  @param {AudioNode} uitgang */
  constructor(ctx, uitgang) {
    this.ctx = ctx;
    this.uit = ctx.createGain();
    this.uit.gain.value = 0.5;
    this.uit.connect(uitgang);
    this._een = maakTik(ctx, 1760, 0.9);
    this._tel = maakTik(ctx, 1175, 0.55);
    this.deck = null;
    this._timer = null;
    this._gepland = [];       // { bron, op }: om te kunnen stoppen
    this._laatste = null;     // het telnummer van de laatst ingeplande tik
    this._versie = -1;        // deck.gridVersie toen er gepland werd
    this.aantal = 0;          // hoeveel tikken er sinds het maken zijn ingepland (voor de tests)
  }

  get aan() { return this.deck !== null; }

  /** Klikken op het grid van dit deck (een ander deck stopt eerst). */
  start(deck) {
    this.stop();
    this.deck = deck;
    this._timer = setInterval(() => this._plan(), PLAN_MS);
    this._timer?.unref?.();
    this._plan();
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    this.deck = null;
    this._wis();
  }

  /** Wat al ingepland is maar nog niet klonk: weg (een sprong, een andere tel). */
  _wis() {
    const nu = this.ctx.currentTime;
    for (const g of this._gepland) if (g.op > nu) { try { g.bron.stop(); } catch {} }
    this._gepland = [];
    this._laatste = null;
  }

  _plan() {
    const d = this.deck;
    if (!d?.grid || !d.playing) { if (this._laatste !== null) this._wis(); return; }
    const nu = this.ctx.currentTime;
    this._gepland = this._gepland.filter((g) => g.op > nu - 0.1);
    // Ander grid (bewerkt) of een sprong terug: opnieuw vanaf de speelkop.
    const hier = d.grid.beatAt(d.position);
    if (d.gridVersie !== this._versie || (this._laatste !== null && hier < this._laatste - 2)) {
      this._wis();
      this._versie = d.gridVersie;
    }
    const snel = Math.abs(d.snelheid ?? d.rate ?? 1) || 1;
    for (const b of d.grid.beatsBetween(d.position, d.position + VOORUIT * snel + 0.01, 16)) {
      if (this._laatste !== null && b.beat <= this._laatste) continue;
      const op = d.ctxTimeOf(b.tijd);
      if (op === null || !Number.isFinite(op) || op < nu) continue;
      const bron = this.ctx.createBufferSource();
      bron.buffer = b.maatbegin ? this._een : this._tel;
      bron.connect(this.uit);
      bron.start(op);
      this._gepland.push({ bron, op });
      this._laatste = b.beat;
      this.aantal++;
    }
  }
}
