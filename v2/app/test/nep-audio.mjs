// Een nagebouwde audiolaag voor de engine-tests: een klok die je zelf verzet,
// en speler, strip en mixer die alleen onthouden wat ze kregen. Geen test zelf.
// De klok staat stil tot je hem verzet: zo is elke test exact herhaalbaar.

export function nepCtx({ sampleRate = 48000, baseLatency = 0.005, outputLatency = 0.02 } = {}) {
  return { currentTime: 0, sampleRate, baseLatency, outputLatency };
}

export function nepAudio() {
  return {
    mixer() {
      const w = { xfader: 0.5, master: 0.8 };
      return { zet: (k, v) => { w[k] = v; }, lees: (k) => w[k] };
    },
    strip() {
      const w = { trim: 0.5, laag: 0.5, mid: 0.5, hoog: 0.5, filter: 0.5, fader: 1 };
      return {
        in: {}, kills: {}, kantStand: 'thru',
        zet(k, v) { w[k] = v; }, lees: (k) => w[k],
        kill(b, aan) { this.kills[b] = aan; }, kant(k) { this.kantStand = k; }, vernietig() {},
      };
    },
    async speler() {
      return {
        node: null, segs: [], pcm: null, plannen: 0,
        laad(pcm) { this.pcm = pcm; }, plan(segs) { this.segs = segs.map((s) => ({ ...s })); this.plannen++; },
        leeg() { this.pcm = null; }, vernietig() {},
        // Plek op t volgens wat de speler kreeg, met de formule van de motor.
        positie(t) {
          let s = this.segs[0];
          for (const x of this.segs) if (x.T <= t) s = x;
          return s ? s.P + (t - s.T) * s.R : 0;
        },
        speeltOp(t) { let s = this.segs[0]; for (const x of this.segs) if (x.T <= t) s = x; return !!s?.speelt; },
      };
    },
  };
}

/** Een nummer met een grid: één stuk, of meer. */
export function nepNummer({ id = 'x', bpm = 124, anker = 0, maat, duur = 300, stukken, zekerheid, twijfel, slot } = {}) {
  const stuk = { van: 0, bpm, anker };
  if (maat !== undefined) stuk.maat = maat;
  if (zekerheid !== undefined) stuk.zekerheid = zekerheid;
  if (twijfel !== undefined) stuk.twijfel = twijfel;
  return {
    id, titel: id, duur,
    grid: { stukken: stukken ?? [stuk], beatsPerBar: 4, slot: !!slot },
    haal: async () => ({ sr: 48000, kanalen: 2, frames: Math.round(duur * 48000), paginas: [] }),
  };
}
