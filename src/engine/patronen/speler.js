import { Emitter } from '../../lib/emitter.js';
import { startDrempel } from '../overgang.js';
import { uitgangsVertraging } from '../hoorbaar.js';
import { Klok } from './klok.js';
import { PPQN, stapTicks, omloopTicks, swingTicks, notenInVenster, stapOp } from './venster.js';
import {
  PLEKKEN, TEMPO, STANDAARD_LENGTE, leegSet, normaliseerSet, nieuwPatroon, idsVan, gevuld,
  metNoot, zonderNoot, wisselNoot, metDuur, metLengte, metSwing, leeg, notenOp,
} from './model.js';

/**
 * De sequencer: speelt de patronen van de set op de instrumenten van de
 * tracks (docs/PATRONEN.md, STUDIO S4). Kent geen MIDI en geen DOM (regel 1):
 * de engine geeft hem een audioklok, de maatgever en de instrumenten.
 *
 * TIJD (regel 3). Een timer beslist alleen WANNEER er gekeken wordt (elke
 * TIK_MS); wat er klinkt wordt gepland met `t` op de audioklok, VOORUIT
 * seconden vooruit, via `noteOn(noot, snelheid, t)` en `noteOff(noot, t)`. De
 * klok (klok.js) vertaalt klok-tellen naar audiokloktijd; per spel houdt de
 * speler bij tot welke klok-tick hij gepland heeft (`gepland`), en elk venster
 * sluit precies aan op het vorige. Zo komt elke noot één keer, ook als de klok
 * onder de patronen verschuift (pitch, sprong, andere maatgever).
 *
 * VOLGEN. Met een maatgever (de track die je het hardst hoort, met grid: sync,
 * bussen en sampler gebruiken dezelfde) loopt de klok op diens tellen, via
 * fxKlok (tempo en tel van wat je HOORT) en zijn maat-anker. Zonder maatgever
 * een eigen tempo (`set.tempo`, standaard 120). Valt de maatgever weg terwijl
 * er iets speelt, dan houdt de klok het laatste tempo vast (niet terugvallen:
 * dat verspringt midden in een set, zoals de echo op de maat); pas als er niets
 * meer speelt geldt het eigen tempo weer.
 *
 * STARTEN, WISSELEN, STOPPEN: op het volgende maatbegin van de klok (zoals
 * play.quant), gerekend vanaf wat al gepland is: wat binnen de vooruitblik
 * valt, ligt al vast, dus dan de maat erna. Een ander patroon op dezelfde
 * track wisselt op de maat; stoppen ook, of "meteen" (shift: zodra het
 * geplande op is, hooguit VOORUIT). Op het moment van stoppen of wisselen
 * `alleUit(t)`, vóór de eerste noot van het nieuwe patroon: geen hangende
 * noten. Gaat het instrument weg, dan stopt het patroon (de engine liet al los);
 * komt er een ander instrument, dan speelt het patroon daarop verder.
 *
 * Alle overgangen staan in klok-TICKS, niet in seconden: verschuift de klok
 * terwijl een start wacht, dan valt hij nog steeds op hetzelfde maatbegin.
 */

/** Hoe ver vooruit er gepland wordt (s), zoals Elektronlearn. */
export const VOORUIT = 0.12;
/** Hoe vaak de timer kijkt (ms). */
export const TIK_MS = 25;
/** Een noot die meer dan dit te laat is (de timer haperde) valt weg in plaats van alsnog te klinken. */
export const LAAT_MAX = 0.1;
/** Zonder maatgever en zonder iets dat speelt: zo ver na de drempel begint de klok. */
const MARGE = 0.01;

/**
 * Wat de klok van een maatgever nodig heeft, uit een deck: zijn volgende tel
 * op de audioklok (`a`), seconden per tel (`L`), het telnummer `n` van die tel
 * in zijn grid, en waar die tel in zijn maat staat (`q`, 0 = de "1", volgens
 * het maat-anker van zijn stuk). Null als hij geen maat geeft (stil, remt,
 * geen grid: fxKlok null).
 */
export function maatVan(d) {
  const k = d?.fxKlok?.();
  if (!k || !(k.beatLengte > 0) || !Number.isFinite(k.ankerCtx) || !d.grid) return null;
  const g = d.grid;
  const per = Number.isInteger(g.beatsPerBar) && g.beatsPerBar > 0 ? g.beatsPerBar : 4;
  const n = Math.ceil(g.beatAt(d.position) - 1e-9);
  const b = typeof g.volgendeVeelvoud === 'function' ? g.volgendeVeelvoud(n, per) : n;
  const q = (((n - b) % per) + per) % per;
  return { id: d.id, a: k.ankerCtx, L: k.beatLengte, n, q, per };
}

const zelfdeKlank = (a, b) => !!b && a.soort === b.soort && (a.params?.length ?? 0) === (b.params?.length ?? 0)
  && (a.params ?? []).every((v, i) => v === b.params[i]);

export class PatroonSpeler extends Emitter {
  /**
   * @param ctx         de AudioContext (alleen currentTime en de vertraging)
   * @param ids         de tracks ('A'..'H'); track nr = plek in de lijst + 1
   * @param instrument  (id) => instrument-object of null (engine.instrumentOp)
   * @param maat        () => maatVan(maatgever) of null
   * @param elke, stopElke  de timer (tests: niets, en zelf tik() aanroepen)
   */
  constructor({ ctx, ids, instrument, maat = () => null,
    elke = (fn, ms) => { const h = setInterval(fn, ms); h?.unref?.(); return h; }, stopElke = (h) => clearInterval(h) }) {
    super();
    this.ctx = ctx;
    this.ids = ids;
    this.instrument = instrument;
    this.maat = maat;
    this.elke = elke;
    this.stopElke = stopElke;
    this.set = leegSet();
    this.klok = new Klok();
    // Per track: het patroon dat speelt (spel), dat wacht op zijn start
    // (wacht), en welke plek gekozen is om te bewerken (scherm, Maschine).
    this.sporen = Object.fromEntries(ids.map((id) => [id, { spel: null, wacht: null, gekozen: 1 }]));
    this.opnemen = false;
    this.bron = null;            // 'maat' | 'eigen' | null (klok staat stil)
    this.maatId = null;
    this._eigenBpm = this.set.tempo;
    this.geplandTot = null;      // audiokloktijd tot waar gepland is (null: niets loopt)
    this._timer = null;
    this._laatste = {};          // id -> laatst gespeelde noot (stap voor stap)
    this._open = new Map();      // `${id}|${noot}` -> wat er opgenomen wordt (tot het loslaten)
    this.stats = { noten: 0, laat: 0, gemist: 0, herankerd: 0 };
  }

  // ---- de set -------------------------------------------------------------------

  nr(id) { return String(this.ids.indexOf(id) + 1); }

  /** Het patroon op plek `plek` (1..5) van track `id`, of null. */
  patroon(id, plek) { return this.set.tracks[this.nr(id)]?.[plek - 1] ?? null; }

  /** Een set van de server (of van Claude): wat speelt blijft spelen, met de nieuwe noten. */
  laadSet(doc) {
    const { set, fouten } = normaliseerSet(doc);
    this.set = set;
    if (!this._actief()) this._eigenBpm = set.tempo;
    this.emit('stand');
    return { fouten };
  }

  _zet(id, plek, p) {
    const nr = this.nr(id);
    this.set.tracks[nr][plek - 1] = p;
    const k = this._klank(id);
    if (k && p) this.set.instrumenten[nr] = k;
    this.emit('bewerkt', { id, plek });
  }

  /**
   * Wat de set onthoudt van het instrument op track `id` (model.js):
   * { soort, params } of null. Een knop die een gebaar is (`gebaar: true`,
   * zoals wrijven op de Schaal: hij maakt zelf klank) wordt niet onthouden.
   */
  _klank(id) {
    const inst = this.instrument(id);
    if (!inst?.soort) return null;
    const lijst = Array.isArray(inst.params) && typeof inst.leesParam === 'function' ? inst.params.slice(0, 8) : [];
    const params = lijst.map((p, i) => {
      const v = p?.gebaar ? null : inst.leesParam(i + 1);
      return Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null;
    });
    return { soort: inst.soort, params: params.length ? params : null };
  }

  /**
   * De knoppen bijhouden (VRAGEN S15): heeft het instrument op een track met
   * patronen een andere soort of knopstand dan de set onthoudt, dan komt dat
   * in de set en volgt 'bewerkt' (de opslag bewaart). Een instrument meldt
   * zelf niets, dus de opslag roept dit elke paar seconden aan. Gaat het
   * instrument weg (er komt een nummer), dan blijft het onthouden.
   */
  onthoudKlank() {
    let anders = false;
    for (const id of this.ids) {
      const nr = this.nr(id);
      if (!this.set.tracks[nr].some(Boolean)) continue;
      const k = this._klank(id);
      if (!k || zelfdeKlank(k, this.set.instrumenten[nr])) continue;
      this.set.instrumenten[nr] = k;
      anders = true;
    }
    if (anders) this.emit('bewerkt', { klank: true });
    return anders;
  }

  /** Het patroon om te bewerken; bestaat het niet, dan een nieuw (leeg). */
  _bewerkbaar(id, plek) {
    return this.patroon(id, plek) ?? nieuwPatroon({ lengte: STANDAARD_LENGTE }, idsVan(this.set));
  }

  // ---- bewerken (scherm, Maschine) ------------------------------------------------

  /** Welke plek er bewerkt wordt op deze track (1..5). */
  gekozen(id) { return this.sporen[id]?.gekozen ?? 1; }
  kies(id, plek) {
    const sp = this.sporen[id];
    if (!sp || !(plek >= 1 && plek <= PLEKKEN)) return;
    sp.gekozen = plek;
    this.emit('stand');
  }

  /** De laatst gespeelde noot op deze track (voor stap voor stap); zonder: kick bij drums, anders C4. */
  laatsteNoot(id) {
    return this._laatste[id] ?? (this.instrument(id)?.soort === 'drums' ? 36 : 60);
  }

  /** Een noot op een stap zetten (of vervangen). `noot` weggelaten = de laatst gespeelde. */
  zetStap(id, plek, stap, { noot = this.laatsteNoot(id), snelheid, duur, micro } = {}) {
    this._zet(id, plek, metNoot(this._bewerkbaar(id, plek), { stap, noot, snelheid, duur, micro }));
  }

  /** Een noot van een stap halen; zonder `noot` alles op die stap. */
  wisStap(id, plek, stap, noot = null) {
    const p = this.patroon(id, plek);
    if (p) this._zet(id, plek, zonderNoot(p, stap, noot));
  }

  /** Stap voor stap: de (laatst gespeelde) noot erop, of eraf als hij er al stond. */
  wisselStap(id, plek, stap, noot = this.laatsteNoot(id)) {
    const p = this._bewerkbaar(id, plek);
    if (!(stap >= 0 && stap < p.lengte)) return;
    this._zet(id, plek, wisselNoot(p, stap, noot));
  }

  zetLengte(id, plek, n) { this._zet(id, plek, metLengte(this._bewerkbaar(id, plek), n)); }
  zetSwing(id, plek, s) { this._zet(id, plek, metSwing(this._bewerkbaar(id, plek), s)); }
  /** Alle noten eraf (de plek blijft, met lengte en swing). */
  wis(id, plek) { const p = this.patroon(id, plek); if (p) this._zet(id, plek, leeg(p)); }

  // ---- tempo en opnemen ---------------------------------------------------------------

  /** Het eigen tempo (zonder maatgever), bpm. */
  get tempo() { return this.set.tempo; }
  zetTempo(bpm) {
    if (!Number.isFinite(bpm)) return;
    this.set.tempo = Math.min(TEMPO.max, Math.max(TEMPO.min, bpm));
    this._eigenBpm = this.set.tempo;
    this.emit('bewerkt', { tempo: this.set.tempo });
  }

  /** Waar de klok nu op loopt (bpm), of null als hij stilstaat. */
  klokBpm() {
    if (this.klok.leeg || !this._actief()) return null;
    return 60 * this.klok.rate(this.ctx.currentTime);
  }

  neemOp(aan) { this.opnemen = !!aan; if (!this.opnemen) this._open.clear(); this.emit('stand'); }

  /**
   * Een noot die je speelt (noten.js: keyboard, scherm, straks de Maschine):
   * `snelheid` > 0 = aan, 0 = los. Onthoudt de laatste noot (stap voor stap).
   * Met opnemen aan en een patroon dat op deze track speelt: erin, op de
   * dichtstbijzijnde stap van wat je HOORDE (de klok op nu min de
   * uitgangsvertraging), erbij (overdub). Klinkt die stap in deze omloop nog,
   * dan slaat de speler hem één keer over: je hoort hem al van je vinger.
   */
  noot(id, noot, snelheid) {
    const aan = snelheid > 0;
    if (aan) this._laatste[id] = noot;
    const sleutel = `${id}|${noot}`;
    const s = this.sporen[id]?.spel;
    if (!this.opnemen || !s || this.klok.leeg) { if (!aan) this._open.delete(sleutel); return; }
    const c = this.klok.tel(this.ctx.currentTime - uitgangsVertraging(this.ctx)) * PPQN;
    if (aan) {
      if (c < s.start || (s.stop != null && c >= s.stop)) return;
      let p = this._bewerkbaar(id, s.plek);
      const st = stapTicks(p);
      const r = Math.round((c - s.basis) / st);
      const stap = ((r % p.lengte) + p.lengte) % p.lengte;
      const nominaal = s.basis + r * st;
      p = metNoot(p, { stap, noot, snelheid, duur: 1, micro: 0 });
      this._zet(id, s.plek, p);
      if (nominaal + swingTicks(stap, p.swing, st) >= s.gepland) s.overslaan.add(`${nominaal}|${noot}`);
      this._open.set(sleutel, { plek: s.plek, pid: p.id, stap, c0: c });
      return;
    }
    const o = this._open.get(sleutel);
    this._open.delete(sleutel);
    const p = o && this.patroon(id, o.plek);
    if (!p || p.id !== o.pid) return;
    const duur = Math.max(1, Math.round((c - o.c0) / stapTicks(p)));
    if (notenOp(p, o.stap).some((n) => n.noot === noot)) this._zet(id, o.plek, metDuur(p, o.stap, noot, duur));
  }

  // ---- transport ------------------------------------------------------------------

  _actief() {
    for (const id of this.ids) { const sp = this.sporen[id]; if (sp.spel || sp.wacht) return true; }
    return false;
  }

  /** Het vroegste klok-tick waarop iets kan veranderen: na de drempel, en na wat al gepland is. */
  _vroegst(nu) {
    const t = Math.max(nu + startDrempel(this.ctx), this.geplandTot ?? -Infinity);
    return this.klok.tel(t) * PPQN;
  }

  /** De klok staat stil en er gaat iets beginnen: opnieuw aanzetten, op de maatgever of op het eigen tempo. */
  _zetKlok(nu) {
    const m = this.maat();
    if (m) {
      // Klok-tellen = de tellen van de maatgever: tel n op a.
      this.klok.zet(m.a, m.n, 1 / m.L);
      this.klok.zetMaat(m.n, m.q, m.per);
      this.bron = 'maat';
      this.maatId = m.id;
      this._maatL = m.L;
    } else {
      this._eigenBpm = this.set.tempo;
      this.klok.zet(nu + startDrempel(this.ctx) + MARGE, 0, this._eigenBpm / 60);
      this.klok.zetMaat(0, 0, 4);
      this.bron = 'eigen';
      this.maatId = null;
    }
    this.geplandTot = null;
  }

  /**
   * Starten op plek `plek`: op het volgende maatbegin (`meteen`: de volgende
   * tel). Speelt er al een ander patroon op deze track, dan wisselt het daar.
   * @returns {{ ok: boolean, op?: number, reden?: string }}  op = klok-tel van de start
   */
  start(id, plek, { meteen = false } = {}) {
    const sp = this.sporen[id];
    if (!sp || !(plek >= 1 && plek <= PLEKKEN)) return { ok: false, reden: 'geen plek' };
    if (!this.instrument(id)) return { ok: false, reden: 'er staat geen instrument op deze track' };
    sp.gekozen = plek;
    if (sp.spel?.plek === plek && sp.spel.stop == null && !sp.wacht) return { ok: true, al: true };
    // Wachtte er al een andere wissel: die vervalt (anders stopte het oude patroon
    // op diens maat en begon dit pas een maat later). Zolang een spel bestaat ligt
    // zijn stop nog na het geplande, dus terugdraaien kan altijd.
    this._annuleerWacht(sp);
    const nu = this.ctx.currentTime;
    if (!this._actief()) this._zetKlok(nu);
    const min = this._vroegst(nu) / PPQN;
    const K = (meteen ? this.klok.volgendeTel(min) : this.klok.volgendeMaat(min)) * PPQN;
    sp.wacht = { plek, start: K };
    if (sp.spel) sp.spel.stop = Math.min(sp.spel.stop ?? Infinity, K);
    this._loop();
    this.emit('stand');
    return { ok: true, op: K / PPQN };
  }

  /** Stoppen op het volgende maatbegin, of `meteen` (zodra het geplande op is). Een wachtende start vervalt. */
  stop(id, { meteen = false } = {}) {
    const sp = this.sporen[id];
    if (!sp) return;
    this._annuleerWacht(sp);
    if (sp.spel) {
      const min = this._vroegst(this.ctx.currentTime);
      const K = meteen ? Math.max(min, sp.spel.gepland) : this.klok.volgendeMaat(Math.max(min, sp.spel.gepland) / PPQN) * PPQN;
      sp.spel.stop = Math.min(sp.spel.stop ?? Infinity, K);
    }
    this._loop();
    this.emit('stand');
  }

  /** Alle tracks stoppen, allemaal op hetzelfde moment. */
  stopAlles(opties) {
    this._batch = true;
    try { for (const id of this.ids) if (this.sporen[id].spel || this.sporen[id].wacht) this.stop(id, opties); }
    finally { this._batch = false; }
    this._loop();
    this.emit('stand');
  }

  /**
   * Een pad van het APC-grid (of een plek op het scherm): speelt hij, dan
   * stoppen op de maat; wacht hij, dan niet meer; stopt hij al, dan toch door.
   * Een ander patroon op deze track: wisselen op de maat. Een LEGE plek wordt
   * alleen gekozen (om te bewerken), tenzij opnemen aan staat: dan begint hij
   * (leeg) en neem je erin op.
   */
  druk(id, plek, { meteen = false } = {}) {
    const sp = this.sporen[id];
    if (!sp || !this.instrument(id)) return { ok: false, reden: 'er staat geen instrument op deze track' };
    sp.gekozen = plek;
    // Wacht hij op zijn start: niet meer (wat er nu speelt, speelt door).
    if (sp.wacht?.plek === plek) { this._annuleerWacht(sp); this.emit('stand'); return { ok: true }; }
    const s = sp.spel;
    if (s?.plek === plek) {
      // Er wacht een wissel naar een ander patroon: die niet, deze speelt door.
      if (sp.wacht) { this._annuleerWacht(sp); this.emit('stand'); return { ok: true }; }
      // Hij stopte al op de maat: toch door.
      if (s.stop != null && !meteen) { s.stop = null; this.emit('stand'); return { ok: true }; }
      // Nog niet begonnen (hij wachtte binnen de vooruitblik): zo snel als het kan eraf.
      const c = this.klok.tel(this.ctx.currentTime) * PPQN;
      this.stop(id, { meteen: meteen || c < s.start });
      return { ok: true };
    }
    if (!gevuld(this.patroon(id, plek)) && !this.opnemen) { this.emit('stand'); return { ok: true, gekozen: true }; }
    return this.start(id, plek, { meteen });
  }

  /** Een wachtende start vervalt; was het een wissel, dan stopt het oude patroon daar niet meer. */
  _annuleerWacht(sp) {
    if (!sp.wacht) return;
    if (sp.spel && sp.spel.stop === sp.wacht.start) sp.spel.stop = null;
    sp.wacht = null;
  }

  /**
   * Een rij op alle tracks (scene launch): elke track met een instrument
   * speelt plek `plek` als die gevuld is (wat daar al speelt blijft lopen, een
   * wachtende wissel ervandaan vervalt), en stopt als die leeg is. Alles op
   * hetzelfde maatbegin: eerst alles klaarzetten, dan pas plannen.
   */
  rij(plek, { meteen = false } = {}) {
    this._batch = true;
    try {
      for (const id of this.ids) {
        if (!this.instrument(id)) continue;
        const sp = this.sporen[id];
        if (gevuld(this.patroon(id, plek))) {
          if (sp.wacht?.plek === plek) continue;
          if (sp.spel?.plek === plek) { this._annuleerWacht(sp); sp.spel.stop = null; continue; }
          this.start(id, plek, { meteen });
        } else if (sp.spel || sp.wacht) this.stop(id, { meteen });
      }
    } finally { this._batch = false; }
    this._loop();
    this.emit('stand');
  }

  /** Het instrument is van de track (de engine liet alles al los): niets meer spelen. */
  weg(id) {
    const sp = this.sporen[id];
    if (!sp) return;
    sp.spel = null;
    sp.wacht = null;
    for (const k of [...this._open.keys()]) if (k.startsWith(`${id}|`)) this._open.delete(k);
    this.emit('stand');
  }

  // ---- plannen -----------------------------------------------------------------------

  /** De timer aan (als er iets loopt) en meteen een kijkbeurt; in een rij of stopAlles pas aan het eind. */
  _loop() {
    if (this._batch) return;
    if (this._actief() && !this._timer) this._timer = this.elke(() => this.tik(), TIK_MS) ?? null;
    this.tik();
  }

  /**
   * Eén kijkbeurt (de timer, of meteen na een start): de klok bijsturen en
   * alles plannen tot VOORUIT na nu. Openbaar voor de tests en de headless meting.
   */
  tik() {
    const nu = this.ctx.currentTime;
    if (!this._actief()) {
      if (this._timer) { this.stopElke(this._timer); this._timer = null; }
      this.geplandTot = null;
      this.bron = null;
      return;
    }
    this._volgKlok(nu);
    const horizon = nu + VOORUIT;
    const h = this.klok.tel(horizon) * PPQN;
    let anders = false;
    for (const id of this.ids) anders = this._plan(id, h, nu) || anders;
    this.geplandTot = this.geplandTot == null ? horizon : Math.max(this.geplandTot, horizon);
    this.klok.ruim(nu - 2);
    if (anders) this.emit('stand');
  }

  /** De klok op de maatgever houden, of op het eigen tempo; alleen vanaf wat nog niet gepland is. */
  _volgKlok(nu) {
    const A = Math.max(this.geplandTot ?? nu, nu + startDrempel(this.ctx));
    const m = this.maat();
    if (m) {
      const r = this.klok.richt({ a: m.a, L: m.L }, A);
      if (r.veranderd) this.stats.herankerd++;
      // Maten van de maatgever: bij een andere maatgever of een echte sprong
      // (niet bij een pitchwissel, en niet in een korte loop: dan telt hij door).
      if (m.id !== this.maatId || (r.veranderd && Math.abs(r.fout) > 0.05)) this.klok.zetMaat(r.N, m.q, m.per);
      this.bron = 'maat';
      this.maatId = m.id;
      this._maatL = m.L;
      return;
    }
    if (this.bron === 'maat') this._eigenBpm = 60 / (this._maatL || 60 / this.set.tempo);   // vasthouden
    this.bron = 'eigen';
    this.maatId = null;
    const R = this._eigenBpm / 60;
    if (Math.abs(this.klok.eindRate - R) > 1e-9) this.klok.houd(A, R);
  }

  /** Eén track tot klok-tick h. Geeft true als er een overgang was (start of stop). */
  _plan(id, h, nu) {
    const sp = this.sporen[id];
    if (!sp.spel && !sp.wacht) return false;
    const inst = this.instrument(id);
    if (!inst) { sp.spel = null; sp.wacht = null; return true; }
    let anders = false;
    const s = sp.spel;
    if (s) {
      this._speel(id, inst, s, Math.min(h, s.stop ?? Infinity), nu);
      if (s.stop != null && h >= s.stop) {
        // Eerst los, dan pas het volgende patroon: anders laat alleUit de
        // eerste noot van het nieuwe meteen weer los.
        inst.alleUit(this.klok.tijd(s.stop / PPQN));
        sp.spel = null;
        anders = true;
      }
    }
    const w = sp.wacht;
    if (w && h >= w.start && !sp.spel) {
      sp.wacht = null;
      sp.spel = { plek: w.plek, basis: w.start, start: w.start, gepland: w.start, stop: null, L: null, overslaan: new Set() };
      this._speel(id, inst, sp.spel, h, nu);
      anders = true;
    }
    return anders;
  }

  /** De noten van spel `s` in [s.gepland, tot) op de audioklok zetten. */
  _speel(id, inst, s, tot, nu) {
    const p = this.patroon(id, s.plek);
    if (p && tot > s.gepland) {
      const L = omloopTicks(p);
      // Lengte of deling veranderd terwijl hij speelt: verder vanaf dezelfde
      // plek in de omloop (of, korter geworden, vanaf die plek binnen de nieuwe).
      if (s.L != null && s.L !== L) {
        const pos = (((s.gepland - s.basis) % s.L) + s.L) % s.L;
        s.basis = s.gepland - (pos % L);
      }
      s.L = L;
      for (const n of notenInVenster(p, s, s.gepland, tot)) {
        if (s.overslaan.size && s.overslaan.delete(`${n.nominaal}|${n.noot}`)) continue;
        const t = this.klok.tijd(n.tick / PPQN);
        if (t < nu - LAAT_MAX) { this.stats.gemist++; continue; }
        if (t < nu) this.stats.laat++;
        inst.noteOn(n.noot, n.snelheid, t);
        inst.noteOff(n.noot, this.klok.tijd((n.tick + n.duur) / PPQN));
        this.stats.noten++;
        this.onNoot?.(id, n, t);           // voor de tests en de headless meting
      }
      // Overslaan geldt één omloop: wat al voorbij is, vergeten.
      if (s.overslaan.size) for (const k of s.overslaan) if (Number(k.split('|')[0]) < tot - L) s.overslaan.delete(k);
    }
    if (tot > s.gepland) s.gepland = tot;
  }

  // ---- lezen (lampjes, scherm) ---------------------------------------------------------

  /** Knipperen op de klok: de eerste helft van elke tel fel. */
  _knipper(nu) {
    const c = this.klok.leeg ? nu * 2 : this.klok.tel(nu);
    return c - Math.floor(c) < 0.5;
  }

  /**
   * De stand van een plek, voor het lampje (VRAGEN B4): null = geen instrument,
   * 0 = leeg, 0,5 = gevuld, 1 = speelt; wacht hij op de maat (starten of
   * stoppen), dan knippert hij: 1 op de eerste helft van elke tel, 0,5 erna.
   */
  lamp(id, plek) {
    const sp = this.sporen[id];
    if (!sp || !this.instrument(id)) return null;
    const nu = this.ctx.currentTime;
    const c = this.klok.leeg ? -Infinity : this.klok.tel(nu) * PPQN;
    const s = sp.spel;
    const wachtStart = sp.wacht?.plek === plek || (s?.plek === plek && c < s.start);
    const stopt = s?.plek === plek && s.stop != null;
    if (wachtStart || stopt) return this._knipper(nu) ? 1 : 0.5;
    if (s?.plek === plek) return 1;
    return gevuld(this.patroon(id, plek)) ? 0.5 : 0;
  }

  /** Een rij (scene): 1 = er speelt iets in deze rij, knippert als er iets wacht, 0,5 = gevuld, 0 = leeg, null = nergens een instrument. */
  rijLamp(plek) {
    let er = false, gevuldErgens = false, speelt = false, wacht = false;
    for (const id of this.ids) {
      const l = this.lamp(id, plek);
      if (l === null) continue;
      er = true;
      const sp = this.sporen[id];
      if (sp.wacht?.plek === plek || (sp.spel?.plek === plek && sp.spel.stop != null)) wacht = true;
      else if (sp.spel?.plek === plek) speelt = true;
      if (gevuld(this.patroon(id, plek))) gevuldErgens = true;
    }
    if (!er) return null;
    if (wacht) return this._knipper(this.ctx.currentTime) ? 1 : 0.5;
    return speelt ? 1 : gevuldErgens ? 0.5 : 0;
  }

  /**
   * Een stap van de gekozen plek, voor het scherm: null = geen instrument of
   * voorbij de lengte, 1 = de laatst gespeelde noot staat erop, 0,5 = een
   * andere noot, 0 = leeg.
   */
  stapLamp(id, stap) {
    if (!this.instrument(id)) return null;
    const p = this.patroon(id, this.gekozen(id));
    const lengte = p?.lengte ?? STANDAARD_LENGTE;
    if (!(stap >= 0 && stap < lengte)) return null;
    const hier = notenOp(p, stap);
    if (!hier.length) return 0;
    return hier.some((n) => n.noot === this.laatsteNoot(id)) ? 1 : 0.5;
  }

  /** Welke stap je nu HOORT op deze track (plek die speelt), of null. */
  stapNu(id) {
    const s = this.sporen[id]?.spel;
    if (!s || this.klok.leeg) return null;
    const c = this.klok.tel(this.ctx.currentTime - uitgangsVertraging(this.ctx)) * PPQN;
    return stapOp(this.patroon(id, s.plek), s, c);
  }

  /** Alles over één track, voor het scherm en de Maschine. */
  stand(id) {
    const sp = this.sporen[id];
    if (!sp) return null;
    const nu = this.ctx.currentTime;
    const c = this.klok.leeg ? -Infinity : this.klok.tel(nu) * PPQN;
    return {
      gekozen: sp.gekozen,
      speelt: sp.spel && c >= sp.spel.start ? sp.spel.plek : null,
      wacht: sp.wacht?.plek ?? (sp.spel && c < sp.spel.start ? sp.spel.plek : null),
      stopt: sp.spel?.stop != null,
      stap: this.stapNu(id),
      laatsteNoot: this.laatsteNoot(id),
      plekken: Array.from({ length: PLEKKEN }, (_, i) => { const p = this.patroon(id, i + 1); return p ? { lengte: p.lengte, noten: p.noten.length } : null; }),
    };
  }

  /** De klok: { bron: 'maat'|'eigen'|null, maatgever, bpm (wat hij nu loopt), tempo (het eigen tempo) }. */
  klokStand() {
    return { bron: this._actief() ? this.bron : null, maatgever: this.maatId, bpm: this.klokBpm(), tempo: this.set.tempo };
  }

  /** Welke plekken er nu spelen: [{ id, plek }] (de beginstand van het handelingenlog). */
  spelend() {
    const uit = [];
    for (const id of this.ids) { const sp = this.sporen[id]; const p = sp.spel?.plek ?? sp.wacht?.plek; if (p) uit.push({ id, plek: p }); }
    return uit;
  }

  vernietig() {
    if (this._timer) { this.stopElke(this._timer); this._timer = null; }
    for (const id of this.ids) { const sp = this.sporen[id]; if (sp.spel) { try { this.instrument(id)?.alleUit(); } catch (_) {} } sp.spel = null; sp.wacht = null; }
  }
}
