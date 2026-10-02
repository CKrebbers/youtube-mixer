// Een nep-AudioParam met een TIJDLIJN, voor de tests (geen test zelf): hij
// onthoudt wat er gepland is (setValueAtTime, linearRampToValueAtTime,
// setTargetAtTime, cancelAndHoldAtTime) en rekent uit wat de parameter op
// elk moment doet, zoals Chrome. Zo is te meten of een overgang een gladde
// helling is of een trapje, en of ingrijpen een sprong geeft.
//
// Net zo streng als de mock van engine.test: een setValueCurveAtTime die
// overlapt gooit NotSupportedError, en cancelAndHoldAtTime midden in een
// curve telt als CURVE_BREUK (Chrome speelt dan het afgekapte stuk opnieuw).
//
// Gebruik: const { param, stats } = maakTijdlijn(() => NOW);

const overlapFout = () => Object.assign(new Error('NotSupportedError: overlapt met een lopende setValueCurveAtTime'), { name: 'NotSupportedError' });

export function maakTijdlijn(klok) {
  const stats = { CURVE_BREUK: 0, OVERLAP_FOUTEN: 0 };

  function param(v0 = 0) {
    return {
      _v0: v0, _ev: [], _curves: [],
      n: { set: 0, lin: 0, target: 0, hold: 0, curve: 0 },
      get value() { return this.waarde(klok()); },
      set value(x) { this._voeg({ type: 'set', v: x, t: klok() }); },

      /** De waarde op tijd t (s, audioklok). */
      waarde(t) {
        let v = this._v0, tv = -Infinity, doel = null;
        const verval = (tt) => (doel ? doel.v + (v - doel.v) * Math.exp(-(tt - tv) / doel.tau) : v);
        for (const e of this._ev) {
          if (e.t > t) {
            if (e.type === 'lin') { const v0 = verval(tv); return v0 + (e.v - v0) * (t - tv) / (e.t - tv); }
            break;
          }
          if (e.type === 'target') { v = verval(e.t); tv = e.t; doel = e; } else { v = e.v; tv = e.t; doel = null; }
        }
        return verval(t);
      },

      _check(t) {
        for (const c of this._curves) if (t >= c.a && t < c.b) { stats.OVERLAP_FOUTEN++; throw overlapFout(); }
      },
      _voeg(e) {
        let i = this._ev.length;
        while (i > 0 && this._ev[i - 1].t > e.t) i--;
        this._ev.splice(i, 0, e);
        if (this._ev.length > 96) this._snoei(klok() - 0.25);
      },
      /** Alles vóór `grens` samenvatten in één punt (exact: een helling erna begint op dat punt). */
      _snoei(grens) {
        const blijft = this._ev.filter((e) => e.t > grens);
        const v = this.waarde(grens);
        let doel = null;
        for (const e of this._ev) { if (e.t > grens) break; doel = e.type === 'target' ? e : null; }
        this._v0 = v;
        this._ev = [{ type: 'set', v, t: grens }, ...(doel ? [{ ...doel, t: grens, v: doel.v }] : []), ...blijft];
        this._curves = this._curves.filter((c) => c.b > grens);
      },

      setValueAtTime(x, t = klok()) { this._check(t); this.n.set++; this._voeg({ type: 'set', v: x, t }); },
      linearRampToValueAtTime(x, t) { this._check(t); this.n.lin++; this._voeg({ type: 'lin', v: x, t }); },
      exponentialRampToValueAtTime(x, t) { this._check(t); this.n.lin++; this._voeg({ type: 'lin', v: x, t }); },
      setTargetAtTime(x, t = klok(), tau = 0.01) { this._check(t); this.n.target++; this._voeg({ type: 'target', v: x, t, tau }); },
      setValueCurveAtTime(c, t = klok(), d = 0) {
        for (const k of this._curves) if (t < k.b && t + d > k.a) { stats.OVERLAP_FOUTEN++; throw overlapFout(); }
        this.n.curve++;
        this._curves.push({ a: t, b: t + d });
        // Benadering: lineair langs de punten (genoeg om te meten wat erna komt).
        for (let i = 0; i < c.length; i++) this._voeg({ type: i ? 'lin' : 'set', v: c[i], t: t + d * i / Math.max(1, c.length - 1) });
      },
      // Volgens de spec: alles wat op of na t begint verdwijnt.
      cancelScheduledValues(t = klok()) { this._ev = this._ev.filter((e) => e.t < t); this._curves = this._curves.filter((c) => c.a < t); },
      // Vasthouden op t: een lopende helling eindigt op t met zijn waarde
      // daar, een lopend doel (setTarget) blijft daar staan.
      cancelAndHoldAtTime(t = klok()) {
        if (this._curves.some((c) => c.a < t && t < c.b)) stats.CURVE_BREUK++;
        this._curves = this._curves.filter((c) => c.a < t).map((c) => ({ a: c.a, b: Math.min(c.b, t) }));
        this.n.hold++;
        const v = this.waarde(t);
        const lopend = this._ev.find((e) => e.t > t);
        this._ev = this._ev.filter((e) => e.t < t);
        this._ev.push({ type: lopend?.type === 'lin' ? 'lin' : 'set', v, t });
      },
    };
  }

  return { param, stats };
}
