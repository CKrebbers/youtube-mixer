/**
 * De sampler: acht pads die een stuk van een nummer vasthouden en het als lus spelen OP DE
 * MAATKLOK (plak 5; v1 src/engine/sampler.js, anders gebouwd).
 *
 * Een pad is een kleine track met DEZELFDE afspeelmotor (v1, Clay 23 sep: één afspeelmotor): een
 * eigen speler met het geknipte stuk als bron, gekoppeld aan de klok met een lus over het hele
 * stuk. Zijn plek is (tel van de klok − starttel) × de tellengte van het stuk, teruggevouwen in de
 * lus. Daardoor loopt een pad nooit weg van de maat (v1 rekende met playbackRate en moest
 * herankeren bij elke wissel; hier is er niets om te herankeren: een tempowissel van de klok
 * zit in de segmenten), en elke start, stop en wissel is klikvrij in de kern.
 *
 * Knippen gaat in TELLEN op het grid van de track met focus: de laatste N tellen tot de laatste
 * tel vóór wat je hoort (v1 knipBereik). Vraagt een zeker grid.
 */
import { PAGINA } from '../audio/speler-kern.js';

export const PADS = 8;
export const TELLEN = [1, 2, 4, 8, 16];
export const TELLEN_BEGIN = 4;
/** Hoe ver vooruit een pad gepland wordt (zoals een track: de motor speelt door als de tik hapert). */
const HORIZON = 90;

/**
 * Welk stuk tracktijd hoort bij "de laatste N tellen"? Puur (v1 knipBereik): eindigend op de
 * laatste tel vóór `positie`, in hele tellen; vlak na het begin minder tellen (nooit een
 * afgekapt stuk dat als N tellen gaat lopen).
 * @returns {{ van, tot, tellen }} of null als er geen hele tel past
 */
export function knipBereik(grid, positie, tellen) {
  const laatste = Math.floor(grid.beatAt(positie) + 1e-9);
  const eerste = Math.ceil(grid.beatAt(0) - 1e-9);
  const n = Math.min(tellen, laatste - eerste);
  if (!(n >= 1)) return null;
  return { van: grid.timeOf(laatste - n), tot: grid.timeOf(laatste), tellen: n };
}

/**
 * Een stuk (seconden van..tot) uit een bron als stereo Int16-pagina's die bij 0 beginnen. Een bron
 * met stems (4 of 8 kanalen) wordt gemengd met `gewichten` per paar (wat je HOORT: een pad die je
 * knipt terwijl de zang weg is, klinkt zonder zang; v1 knip met gewichten). Zonder: de som.
 */
export async function knipPcm(bron, van, tot, gewichten = null) {
  const sr = bron.sr, kc = bron.kanalen ?? 2, paren = kc >> 1;
  const f0 = Math.max(0, Math.round(van * sr)), f1 = Math.min(bron.frames, Math.round(tot * sr));
  const frames = f1 - f0;
  if (frames <= 0) return null;
  const leesPagina = bron.paginas ? async (i) => bron.paginas[i] : (i) => bron.stroom.lees(i);
  const p0 = Math.floor(f0 / PAGINA), p1 = Math.floor((f1 - 1) / PAGINA);
  const bronPag = new Map();
  for (let p = p0; p <= p1; p++) bronPag.set(p, await leesPagina(p));
  const paginas = [];
  for (let van2 = 0; van2 < frames; van2 += PAGINA) {
    const n = Math.min(PAGINA, frames - van2);
    const uit = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      const f = f0 + van2 + i, pag = bronPag.get(Math.floor(f / PAGINA)), j = (f % PAGINA) * kc;
      if (!pag || j + kc - 1 >= pag.length) continue;
      if (kc === 2) { uit[2 * i] = pag[j]; uit[2 * i + 1] = pag[j + 1]; continue; }
      let l = 0, r = 0;
      for (let p = 0; p < paren; p++) { const g = gewichten ? (gewichten[p] ?? 0) : 1; l += g * pag[j + 2 * p]; r += g * pag[j + 2 * p + 1]; }
      uit[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l)));
      uit[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r)));
    }
    paginas.push(uit);
  }
  return { sr, kanalen: 2, frames, paginas };
}

class Pad {
  constructor(k, sampler) {
    this.k = k;
    this.s = sampler;
    this.speler = null;
    this.stuk = null;        // { id, titel, van, tot, tellen, duur } (duur = seconden van het stuk)
    this.startTel = null;    // speelt sinds deze tel van de klok (null = stil)
  }

  get gevuld() { return this.stuk !== null; }
  get speelt() { return this.startTel !== null; }

  /** De segmenten vanaf nu: de lus op de klok, gebroken waar de klok breekt. */
  segmenten() {
    const e = this.s.engine, nu = e.nu();
    if (!this.speelt || !e.klok.loopt) return [{ T: nu, P: 0, R: 0, speelt: false }];
    const { duur, tellen } = this.stuk, Lb = duur / tellen;
    const van = Math.max(nu, e.klok.tijd(this.startTel));
    const uit = [];
    if (van > nu) uit.push({ T: nu, P: 0, R: 0, speelt: false });   // wacht op de tel
    const Ts = [van];
    for (const s of e.klok.segmentenTussen(van, nu + HORIZON)) if (s.T > van) Ts.push(s.T);
    for (const T of Ts.slice(0, 50)) uit.push({ T, P: (e.klok.tel(T) - this.startTel) * Lb, R: e.klok.rate(T) * Lb, speelt: true, la: 0, lb: duur });
    return uit;
  }

  plan() { this.speler?.plan(this.segmenten()); }
}

export class Sampler {
  /**
   * @param engine   de engine (klok, tracks, focus, nu/straks/vertraging)
   * @param uitgang  { pad(k) -> AudioNode, zet(volume 0..1), lees() } (de audiolaag), of null
   */
  constructor(engine, uitgang = null) {
    this.engine = engine;
    this.uitgang = uitgang;
    this.tellen = TELLEN_BEGIN;
    this.pads = Array.from({ length: PADS }, (_, i) => new Pad(i + 1, this));
    engine.klok.on('verander', () => { for (const p of this.pads) if (p.speelt) p.plan(); });
  }

  pad(k) { return this.pads[k - 1]; }
  get speelt() { return this.pads.some((p) => p.speelt); }

  async _speler(p) {
    if (!p.speler) {
      p.speler = await this.engine.audio.speler(this.engine.ctx);
      (p.speler.uitgang ?? p.speler.node)?.connect?.(this.uitgang.pad(p.k));
      p.speler.onfout = (b) => this.engine.meld(`sampler ${p.k}: ${b}`, 'fout', `sampler:${p.k}`);
    }
    return p.speler;
  }

  /**
   * Pad k vullen met de laatste `this.tellen` tellen van de track met focus (wat je HOORT).
   * @returns undefined, of { geweigerd }
   */
  async vul(k) {
    const e = this.engine, t = e.track(e.focus);
    if (!this.uitgang) return { geweigerd: 'de sampler kan hier niet' };
    if (!t.geladen || !t._haal) return { geweigerd: `track ${e.focus} heeft geen nummer` };
    const P = t.plek(e.nu() - e.vertraging());
    if (!t.telZeker(P)) return { geweigerd: 'geen zeker grid hier: knippen gaat in tellen' };
    const b = knipBereik(t.grid, P, this.tellen);
    if (!b) return { geweigerd: 'te dicht bij het begin' };
    const p = this.pad(k);
    // De bron opnieuw openen (de pagina's van de track zitten in zijn worklet): een stroom leest
    // alleen wat nodig is, een demo wordt opnieuw gemaakt.
    const pcm = await knipPcm(await t._haal(), b.van, b.tot, t.stems ? t.stemGewichten() : null);
    if (!pcm) return { geweigerd: 'niets te knippen' };
    const sp = await this._speler(p);
    sp.laad(pcm);
    p.stuk = { id: t.nummer.id, titel: t.nummer.titel, van: b.van, tot: b.tot, tellen: b.tellen, duur: pcm.frames / pcm.sr };
    p.startTel = null;
    p.plan();
    e.emit('sampler', { k, stand: 'gevuld' });
  }

  /** Spelen vanaf de volgende tel van de klok (start de klok als die stilstaat), of stoppen. */
  wissel(k) {
    const p = this.pad(k), e = this.engine;
    if (!p.gevuld) return this.vul(k);
    if (p.speelt) { p.startTel = null; p.plan(); e.emit('sampler', { k, stand: 'stil' }); return; }
    const A = e.straks();
    if (!e.klok.loopt) e.zetKlokTempo((p.stuk.tellen / p.stuk.duur) * 60, A);
    p.startTel = Math.ceil(e.klok.tel(A) - 1e-9);
    p.plan();
    e.emit('sampler', { k, stand: 'speelt' });
  }

  wis(k) {
    const p = this.pad(k);
    if (!p.gevuld) return;
    p.startTel = null; p.stuk = null;
    p.speler?.leeg();
    this.engine.emit('sampler', { k, stand: 'leeg' });
  }

  lengteStap(r) {
    const i = TELLEN.indexOf(this.tellen);
    this.tellen = TELLEN[Math.max(0, Math.min(TELLEN.length - 1, (i < 0 ? 2 : i) + r))];
  }

  /** Bij elke tik van de engine: spelende pads vooruit plannen (de horizon schuift mee). */
  tik() { for (const p of this.pads) if (p.speelt) p.plan(); }

  /** Lampje: null zonder sampler, 0 leeg, 0,5 gevuld, 1 speelt. */
  lees(k) { const p = this.pad(k); return !this.uitgang ? null : p.speelt ? 1 : p.gevuld ? 0.5 : 0; }
}
