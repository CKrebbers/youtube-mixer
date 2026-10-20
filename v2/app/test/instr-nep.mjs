// Uitbreiding van test/web-audio-mock.mjs voor de instrumenten (geen test zelf). ADDITIEF: de
// mock zelf verandert niet; dit bestand zet er alleen bij wat de instrumenten nodig hebben, en
// alleen in het proces van een test die het importeert.
//
//   - createConstantSource (offset als AudioParam), createPeriodicWave, oscillator.setPeriodicWave
//   - EINDE OP TIJD: in de mock vuurt een bron onended meteen na stop() (een microtaak). Een
//     instrument stopt zijn oscillatoren vooruit (na de release); met `eindeOpTijd(omg)` vuurt
//     onended pas als je de klok voorbij de stoptijd zet en `omg.vuurEinden()` aanroept.
//   - STRENGER ZOALS CHROME (v1, oogst produceren-021): cancelAndHoldAtTime midden in een
//     setTargetAtTime zet in Chrome geen bruikbaar beginpunt; een lineaire helling die daarop
//     volgt zonder een setValueAtTime op dat moment telt als HOLD_ZONDER_PUNT.
import { NepAudioContext, NepAudioParam, NepOmgeving } from './web-audio-mock.mjs';

const P = NepAudioParam.prototype;
if (!P.__instr) {
  P.__instr = true;
  const hold = P.cancelAndHoldAtTime, set = P.setValueAtTime, lin = P.linearRampToValueAtTime, doel = P.setTargetAtTime;
  P.cancelAndHoldAtTime = function (t) {
    let vorige = null;
    for (const e of this._ev) { if (e.t > t) break; vorige = e; }
    const lopend = this._ev.find((e) => e.t > t);
    this._wachtPunt = vorige?.type === 'target' && lopend?.type !== 'lin' ? t : null;
    return hold.call(this, t);
  };
  P.setValueAtTime = function (x, t) {
    if (this._wachtPunt !== null && this._wachtPunt !== undefined && t === this._wachtPunt) this._wachtPunt = null;
    return set.call(this, x, t);
  };
  P.linearRampToValueAtTime = function (x, t) {
    if (this._wachtPunt !== null && this._wachtPunt !== undefined) {
      this.omg.stats.HOLD_ZONDER_PUNT = (this.omg.stats.HOLD_ZONDER_PUNT ?? 0) + 1;
      this._wachtPunt = null;
    }
    return lin.call(this, x, t);
  };
  P.setTargetAtTime = function (x, t, tau) { this._wachtPunt = null; return doel.call(this, x, t, tau); };

  const C = NepAudioContext.prototype;
  const osc = C.createOscillator, buf = C.createBufferSource;
  const opTijd = (ctx, b) => {
    if (!ctx._omg.eindeOpTijd) return b;
    b.stop = function (t = 0) {
      if (this.gestart === null) throw Object.assign(new Error('InvalidStateError: stop: niet gestart'), { name: 'InvalidStateError' });
      if (!(t >= 0) || !Number.isFinite(t)) throw new RangeError(`stop: tijd ${t}`);
      this.gestopt = t;
    };
    return b;
  };
  C.createOscillator = function () {
    const o = opTijd(this, osc.call(this));
    o.setPeriodicWave = (golf) => { if (!golf?.periodicWave) throw new TypeError('setPeriodicWave: geen PeriodicWave'); o.type = 'custom'; o.golf = golf; };
    return o;
  };
  C.createBufferSource = function () { return opTijd(this, buf.call(this)); };
  C.createConstantSource = function () {
    const b = opTijd(this, osc.call(this));      // een bron met start/stop/onended, zoals de mock ze maakt
    b.soort = 'constantsource';
    b.offset = new NepAudioParam(this._omg, 1);
    b.offset.node = b;
    delete b.frequency; delete b.detune;
    // De start van de mock bewaart zijn tweede argument als `offset` (voor een bufferbron): niet hier.
    const start = b.start;
    b.start = function (t) { const param = this.offset; start.call(this, t); this.offset = param; };
    return b;
  };
  C.createPeriodicWave = function (re, im) {
    if (!(re?.length >= 2) || re.length !== im?.length) throw Object.assign(new Error('IndexSizeError: createPeriodicWave'), { name: 'IndexSizeError' });
    return { periodicWave: true, re: Float32Array.from(re), im: Float32Array.from(im) };
  };
}

/** Een omgeving waarin onended pas op de stoptijd komt (zie boven), met vuurEinden(). */
export function instrOmgeving(opties) {
  const omg = new NepOmgeving(opties);
  omg.eindeOpTijd = true;
  omg.stats.HOLD_ZONDER_PUNT = 0;
  omg.vuurEinden = () => {
    for (const b of omg.bronnen) {
      if (b._klaar || b.gestopt === null || b.gestopt > omg.nu) continue;
      b._klaar = true;
      b.onended?.();
    }
  };
  return omg;
}

/** Geen setValueCurveAtTime, geen afgebroken curve, geen overlap, geen helling zonder beginpunt. */
export const schoneTijdlijn = (omg) => omg.stats.CURVES === 0 && omg.stats.CURVE_BREUK === 0
  && omg.stats.OVERLAP_FOUTEN === 0 && (omg.stats.HOLD_ZONDER_PUNT ?? 0) === 0;
