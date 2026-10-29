/**
 * De korrelwolk als effect (contract van fx.js EFFECTEN): wat de track speelt valt uiteen in korrels.
 * De rekenkern staat in korrel-kern.js en draait in fx-worklet.js ('varve-fx-korrel'); tot die er is
 * klinkt het effect droog (zoals de kam, fx-s10.js).
 *
 *   in ─┬─► droog ────────────────────────────────────┐
 *       └─► inloop ─► korrel (worklet) ─► nat ────────┴─► uit
 *
 * Parameters 0..1, de schaling hier (en `eenheid` met dezelfde formule):
 *   grootte    10 ms … 500 ms per korrel          dichtheid  2 … 120 korrels per seconde
 *   terug      30 ms … 3 s: waar in het verleden   spray      0 … 1,5 s toeval rond die plek
 *   toon       0 … 24 halve tonen spreiding        omkeer     kans dat een korrel achteruit speelt
 *   breedte    stereo                              bevries    ≥ 50% = de ring staat stil (de wolk blijft)
 *   meng       droog ↔ nat (equal power)
 */
import { clamp, expMap } from '../../kern/emitter.js';
import { pct, ms } from './notatie.js';
import { zetter, opStandaard, metWorklet, lineair, inloop, mengNaar, WORKLET_FADE } from './fx-meer.js';

export const grootteKorrel = (t) => expMap(t, 0.01, 0.5);
export const dichtheidKorrel = (t) => expMap(t, 2, 120);
export const terugKorrel = (t) => expMap(t, 0.03, 3);
export const sprayKorrel = (t) => clamp(t) * 1.5;
export const toonKorrel = (t) => clamp(t) * 24;
const SCHAAL = {
  grootte: ['grootte', grootteKorrel], dichtheid: ['dichtheid', dichtheidKorrel], terug: ['terug', terugKorrel],
  spray: ['spray', sprayKorrel], toon: ['toon', toonKorrel], omkeer: ['omkeer', clamp], breedte: ['breedte', clamp],
  bevries: ['bevries', (t) => (clamp(t) >= 0.5 ? 1 : 0)],
};

export const korrel = {
  id: 'korrel',
  naam: 'Korrelwolk',
  params: ['grootte', 'dichtheid', 'terug', 'spray', 'toon', 'omkeer', 'breedte', 'bevries', 'meng'],
  standaard: { grootte: 0.45, dichtheid: 0.55, terug: 0.4, spray: 0.35, toon: 0, omkeer: 0, breedte: 0.6, bevries: 0, meng: 0.6 },
  eenheid: {
    grootte: (t) => ms(grootteKorrel(t)),
    dichtheid: (t) => `${Math.round(dichtheidKorrel(t))}/s`,
    terug: (t) => ms(terugKorrel(t)),
    spray: (t) => ms(sprayKorrel(t)),
    toon: (t) => `±${Math.round(toonKorrel(t))} ht`,
    omkeer: pct,
    breedte: pct,
    bevries: (t) => (clamp(t) >= 0.5 ? 'vast' : 'los'),
    meng: pct,
  },
  bouw(ctx) {
    const doel = zetter(ctx);
    const ingang = ctx.createGain(), uitgang = ctx.createGain();
    const droog = ctx.createGain(), nat = ctx.createGain();
    ingang.connect(droog).connect(uitgang);
    nat.connect(uitgang);
    droog.gain.value = 1; nat.gain.value = 0;
    const staat = { meng: korrel.standaard.meng, geladen: false, waarden: {} };
    for (const [naam, [, f]] of Object.entries(SCHAAL)) staat.waarden[naam] = f(korrel.standaard[naam]);
    const w = metWorklet(ctx, 'varve-fx-korrel',
      { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' },
      (node, meteen) => {
        for (const [naam, [p]] of Object.entries(SCHAAL)) node.parameters.get(p).value = staat.waarden[naam];
        ingang.connect(inloop(ctx)).connect(node);
        node.connect(nat);
        staat.geladen = true;
        const d = Math.cos(staat.meng * Math.PI / 2), wt = Math.sin(staat.meng * Math.PI / 2);
        if (meteen) { droog.gain.value = d; nat.gain.value = wt; }
        else { lineair(droog.gain, d, ctx, WORKLET_FADE); lineair(nat.gain, wt, ctx, WORKLET_FADE); }
      });
    return opStandaard(korrel, ctx, {
      in: ingang, out: uitgang,
      zet(naam, v, now) {
        const t = clamp(v);
        if (naam === 'meng') { staat.meng = t; if (staat.geladen) mengNaar(doel, t, droog, nat, now); return; }
        const s = SCHAAL[naam];
        if (!s) return;
        staat.waarden[naam] = s[1](t);
        // Bevriezen springt (aan/uit); de rest glijdt zoals elk effect.
        const p = w.node?.parameters.get(s[0]);
        if (p) { if (naam === 'bevries') p.value = staat.waarden[naam]; else doel(p, staat.waarden[naam], now); }
      },
      // De langste korrel plus het verste verleden: zolang klinkt er nog iets na als de invoer stopt.
      staart: () => (staat.waarden.bevries ? 4 : Math.min(4, staat.waarden.grootte + staat.waarden.terug + staat.waarden.spray) + 0.05),
      vernietig: () => w.stop(),
      _n: { w, droog, nat, staat },
    });
  },
};
