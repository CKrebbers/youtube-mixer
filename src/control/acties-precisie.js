/**
 * PRECISIE (14 okt, werkruimte S1, docs/werkruimte/S1.md, WERKRUIMTE.md A6):
 * een track met precisie op zijn plek zetten, met actions op de bus.
 *
 *   track.N.phase.offset         value: de fase t.o.v. de maatgever, 0,5 = gelijk, ±½ tel lineair.
 *                                Draaien = duwen. Eén tik op de APC (1/127) = 3,81 ms op 124 bpm.
 *   track.N.phase.offset.fine    idem over ±1/16 tel: één tik = 0,48 ms op 124 bpm.
 *   track.N.jog.back/.fwd        1/16 tel (fijn: .jog.fine.*, 1/64); zonder grid 5 ms (fijn 1 ms).
 *   track.N.nudge.fine.back/.fwd precies 1 ms.
 *   track.N.beatjump.quarter|half|beat.back|fwd  vaste beatjump van ¼, ½ of 1 tel.
 *   track.N.bar.align            "op de 1": −2…+2 tellen naar de "1" van de maatgever.
 *   track.N.bend.amount          hoe hard bend duwt, 1–16% (standaard 4%).
 *   track.N.duoklik              in de koptelefoon een hoge tik op deze track en een lage op de maatgever.
 *
 * Regel 2: alles is 0..1 of een trigger; ms en tellen staan HIER, nooit in een
 * mapping. Regel 3: duwen en jog zijn nudge/seek op het deck (fasebehoudend,
 * met keylock gepland); de positie komt altijd van het deck. De samenvoegtimer
 * (Duwer, 15 ms) zegt alleen WANNEER er gesprongen wordt.
 *
 * De engine kent niets van dit bestand (regel 1): hij krijgt alleen
 * deck.bendSterkte (een getal), een lengte bij beatjump en engine.duoklik().
 */
import { define, TRACKS } from './actions.js';
import { ONZEKER } from '../engine/engine.js';

/** Hooguit één nudge/seek per zoveel ms per track (snel draaien wordt samengevoegd). */
export const SAMEN_MS = 15;
/** Jog: een zestiende tel, fijn een vierenzestigste; zonder grid zoveel seconden (wat je hoort). */
export const JOG_TEL = 1 / 16;
export const JOG_FIJN_TEL = 1 / 64;
export const JOG_ZONDER_GRID = 0.005;
export const JOG_FIJN_ZONDER_GRID = 0.001;
/** nudge.fine: precies zoveel seconden (wat je hoort). */
export const DUW_FIJN = 0.001;
/** phase.offset.fine: het bereik is ±1/(2 × FIJN) tel = ±1/16 tel. */
export const FIJN = 8;
/** Bend-sterkte: 1–16% (track.N.bend.amount 0..1). */
export const BEND_MIN = 0.01;
export const BEND_MAX = 0.16;
/** "Op de 1": binnen zoveel tel van de "1" van de maatgever = lampje aan. */
export const OP_DE_EEN = 0.01;
/** "Op de 1" springt hooguit zoveel tellen. */
export const OP_DE_EEN_MAX = 2;
/** Vaste beatjumps (los van de beatjump-lengte van Bank ◀ ▶). */
export const VASTE_SPRONGEN = [['quarter', 0.25, '¼ tel'], ['half', 0.5, '½ tel'], ['beat', 1, '1 tel']];

/** Naar [−½, ½): een fase als afstand op een cirkel van één tel. */
export const omtrek = (x) => x - Math.floor(x + 0.5);
const klem = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** De meldingen van de bestaande beatjump (actions.js), dezelfde woorden. */
const SPRONG_MELDING = {
  geengrid: 'beatjump kan niet zonder beatgrid — tik eerst het tempo (TAP)',
  onzeker: ONZEKER,
  rand: 'beatjump: de loop komt dan buiten het nummer te liggen',
  einde: 'beatjump: dat valt voorbij het einde van het nummer — niet gesprongen',
  begin: 'beatjump: dat valt vóór het begin van het nummer — niet gesprongen',
};

/**
 * SAMENVOEGEN: duwen en jog tellen hun verschuiving per deck op (tracktijd,
 * seconden) en voeren hooguit één nudge/seek per SAMEN_MS uit. De eerste tik
 * wacht dus hooguit 15 ms; snel draaien geeft geen honderd sprongen (elke
 * sprong is een nieuw segment en een overvloei van 4 ms in de streamkern).
 *
 * Met keylock is een sprong GEPLAND (~98 ms later, bron.js KEYLOCK EN TOON):
 * tot T speelt het vorige segment. Een tweede sprong in dat gat rekent vanaf de
 * positie van het vorige segment en gooit de eerste weg. Daarom: zolang er een
 * geplande sprong onderweg is (deck.tijdlijn().vorig en nu < T), wachten tot
 * hij ingaat. Wat al gepland is telt intussen mee in `open()` (de read van
 * phase.offset toont dus meteen waar hij heen gaat).
 *
 * `sprong(id, fn)` voor sprongen in TELLEN (vaste beatjump, op de 1): meteen
 * als er niets openstaat, anders na de duw die nog openstaat (en met keylock
 * pas als die is ingegaan). Rekent op het moment dat hij springt, niet bij de druk.
 *
 * `na` is de timer (een test geeft een nep-klok); de timer zegt alleen
 * WANNEER, de positie komt van het deck.
 */
export class Duwer {
  constructor(engine, { na = (fn, ms) => setTimeout(fn, ms), samen = SAMEN_MS } = {}) {
    this.engine = engine;
    this._na = na;
    this.samen = samen;
    this._st = new Map();     // deckId -> { sec, loop, timer, sprongen, onderweg }
    this.uitgevoerd = 0;      // hoeveel nudge/seek er werkelijk gingen (voor de tests en de meting)
  }

  _stand(id) {
    let s = this._st.get(id);
    if (!s) {
      s = { sec: 0, loop: false, timer: null, sprongen: [], onderweg: null };
      this._st.set(id, s);
      // Een ander nummer: wat openstond hoort bij het oude.
      this.engine.deck(id).on?.('load', () => { s.sec = 0; s.loop = false; s.sprongen.length = 0; s.onderweg = null; });
    }
    return s;
  }

  /**
   * Wat er nog niet te horen is, in tracktijd (s): wat openstaat plus wat met
   * keylock gepland is maar nog niet ingegaan.
   */
  open(id) {
    const s = this._st.get(id);
    if (!s) return 0;
    const o = s.onderweg;
    if (o && !(this.engine.ctx.currentTime < o.T)) s.onderweg = null;
    return s.sec + (s.onderweg ? s.onderweg.sec : 0);
  }

  /** Een verschuiving in tracktijd (s). `binnenLoop`: in pauze teruggevouwen in de loop (duwen); jog niet. */
  duw(id, sec, { binnenLoop = false } = {}) {
    if (!sec || !Number.isFinite(sec)) return;
    const s = this._stand(id);
    s.sec += sec;
    if (binnenLoop) s.loop = true;
    this._plan(id, s, this.samen);
  }

  /** Een sprong die zelf rekent (fn), na wat er nog openstaat. */
  sprong(id, fn) {
    const d = this.engine.deck(id);
    const s = this._stand(id);
    if (!s.timer && s.sec === 0 && !s.sprongen.length && this._wachtMs(d) === 0) { fn(); return; }
    s.sprongen.push(fn);
    this._plan(id, s, s.sec === 0 ? 0 : this.samen);
  }

  _plan(id, s, ms) {
    if (s.timer !== null) return;
    s.timer = this._na(() => { s.timer = null; this._voer(id); }, ms);
    s.timer?.unref?.();
  }

  /** Hoeveel ms er nog een geplande sprong (keylock) onderweg is op dit deck, of 0. */
  _wachtMs(d) {
    if (!d.playing) return 0;
    const tl = d.tijdlijn?.();
    const nu = this.engine.ctx.currentTime;
    return tl?.vorig && nu < tl.T ? (tl.T - nu) * 1000 : 0;
  }

  _voer(id) {
    const s = this._st.get(id);
    if (!s) return;
    const d = this.engine.deck(id);
    if (!d.buffer) { s.sec = 0; s.sprongen.length = 0; return; }
    const wacht = this._wachtMs(d);
    if (wacht > 0) { this._plan(id, s, Math.ceil(wacht) + 1); return; }
    if (s.sec !== 0) {
      const sec = s.sec, loop = s.loop;
      s.sec = 0; s.loop = false;
      // Remt hij intussen, dan niet: een sprong haalt de rem eraf.
      if (!d.remt) {
        if (d.playing) d.nudge(sec);                                          // fasebehoudend, in de loop, met keylock gepland
        else d.seek(d.position + sec, loop ? { binnenLoop: true } : undefined);  // een gewone seek; het cuepunt blijft staan
        this.uitgevoerd++;
        const tl = d.tijdlijn?.();
        if (tl?.vorig && this.engine.ctx.currentTime < tl.T) s.onderweg = { sec, T: tl.T };
      }
      if (s.sprongen.length) { this._plan(id, s, Math.max(1, Math.ceil(this._wachtMs(d)) + 1)); return; }
    }
    while (s.sprongen.length) {
      s.sprongen.shift()();
      if (s.sprongen.length && this._wachtMs(d) > 0) { this._plan(id, s, Math.ceil(this._wachtMs(d)) + 1); return; }
    }
  }
}

/**
 * De fase van deck `d` t.o.v. deck `m` in tellen van `d`, in [−½, ½), op de
 * plek waar ze NU zijn (zoals Engine.faseVerschil). Null als het niet kan.
 */
export function faseTegen(d, m) {
  if (!d?.buffer || !d.grid || !m?.buffer || !m.grid || m === d) return null;
  return omtrek(d.grid.phase(d.position) - m.grid.phase(m.position));
}

/** Waar in de maat (in tellen, 0..beatsPerBar) staat tracktijd t op dit grid? */
const inMaat = (g, t) => g.barPhase(t) * g.beatsPerBar;

/**
 * "Op de 1": hoeveel tellen (geheel, −2…+2) deck `d` moet springen zodat zijn
 * plek in de maat gelijk is aan die van de maatgever `m`. Via barPhase op de
 * plek waar hij NA de sprong is (verschuif in tellen): over een stukgrens met
 * een eigen maat-anker klopt het dan ook. Nooit beat % 4.
 * Geeft { n, rest } (rest = wat er daarna nog naast is, in tellen) of null.
 */
export function naarDeEen(d, m) {
  if (!d?.grid || !m?.grid) return null;
  const doel = inMaat(m.grid, m.position);
  const bpb = d.grid.beatsPerBar;
  let beste = null;
  for (let n = -OP_DE_EEN_MAX; n <= OP_DE_EEN_MAX; n++) {
    const t = d.grid.verschuif(d.position, n);
    const x = doel - inMaat(d.grid, t);
    const rest = x - bpb * Math.floor(x / bpb + 0.5);          // naar [−bpb/2, bpb/2)
    // Gelijk (binnen 0,001 tel: na een sync is de fase op een paar ns gelijk): de kortste sprong.
    if (!beste || Math.abs(rest) < Math.abs(beste.rest) - 1e-3
        || (Math.abs(Math.abs(rest) - Math.abs(beste.rest)) <= 1e-3 && Math.abs(n) < Math.abs(beste.n))) beste = { n, rest };
  }
  return beste;
}

/**
 * De actions van de precisie op de bus, per track. `duwer` en `zeg` zijn er
 * voor de tests. Geeft de duwer terug.
 */
export function bindPrecisie(engine, { duwer = new Duwer(engine), zeg } = {}) {
  const melding = zeg ?? ((tekst, soort = 'info') => engine.emit('melding', { tekst, soort, duur: 8000 }));
  for (const [nr, id] of TRACKS) {
    const d = engine.deck(id);
    const n = `track.${nr}`;
    /** De maatgever voor deze track (null als dat deze track zelf is: dan is er niets om tegen te duwen). */
    const maatgever = () => { const m = engine.syncMaster(); return m && m !== d ? m : null; };
    /** De fase met wat er nog openstaat erbij (in tellen), of null. */
    const fase = () => {
      const f = faseTegen(d, maatgever());
      if (f === null) return null;
      const open = duwer.open(id);
      return open ? omtrek(f + open / d.grid.beatLengthAt(d.position)) : f;
    };
    /** Waarom deze track nu niet geduwd of gejogd kan worden, of null. */
    const nietNu = () => {
      if (!d.buffer) {
        const inst = engine.instrumentOp?.(id);
        return inst ? `track ${nr} speelt een instrument, geen nummer: duwen hoort bij een nummer`
          : `track ${nr} is leeg: laad eerst een nummer (library, of sleep een bestand op de kolom).`;
      }
      if (d.remt) return `track ${nr} remt: eerst los (play of nog eens rem), dan duwen`;
      return null;
    };
    const duwTel = (tellen) => {
      if (nietNu()) { melding(nietNu()); return; }
      duwer.duw(id, tellen * d.grid.beatLengthAt(d.position), { binnenLoop: true });
    };

    // ---- fase duwen ---------------------------------------------------------
    // read = 0,5 + f: in het midden = gelijk met de maatgever. Lineair over een
    // hele tel; draaien over de rand gaat rond (de afstand op de cirkel telt,
    // niet de getallen). bipolar: de pan-ring van de APC, midden = gelijk.
    define(`${n}.phase.offset`, 'value', (v) => {
      const f = fase();
      if (f === null) return;
      duwTel(omtrek(klem(v) - (0.5 + f)));
    }, { label: `Track ${nr} fase t.o.v. de maatgever (draaien = duwen, midden = gelijk, ±½ tel)`,
         bipolar: true, beginstand: false, overneem: true,
         read: () => { const f = fase(); return f === null ? null : 0.5 + f; } });
    define(`${n}.phase.offset.fine`, 'value', (v) => {
      const f = fase();
      if (f === null) return;
      duwTel((klem(v) - klem(0.5 + FIJN * f)) / FIJN);
    }, { label: `Track ${nr} fase fijn (±1/16 tel, midden = gelijk)`,
         bipolar: true, beginstand: false, overneem: true,
         read: () => { const f = fase(); return f === null ? null : klem(0.5 + FIJN * f); } });

    // ---- jog en ±1 ms -------------------------------------------------------
    // Spelend fasebehoudend en in de loop (nudge); stil of in pauze een gewone
    // seek, en het cuepunt blijft waar het stond.
    const jog = (richting, tel, zonder) => (on) => {
      if (!on) return;
      const r = nietNu();
      if (r) { melding(r); return; }
      const sec = d.grid ? tel * d.grid.beatLengthAt(d.position) : zonder * d.rate;
      duwer.duw(id, richting * sec);
    };
    for (const [richting, naam, tekst] of [[-1, 'back', 'terug'], [1, 'fwd', 'vooruit']]) {
      define(`${n}.jog.${naam}`, 'trigger', jog(richting, JOG_TEL, JOG_ZONDER_GRID),
        { label: `Track ${nr} jog ${tekst} (1/16 tel; zonder grid 5 ms; ook in pauze)`, overneem: true,
          read: () => (d.buffer ? 0 : null) });
      define(`${n}.jog.fine.${naam}`, 'trigger', jog(richting, JOG_FIJN_TEL, JOG_FIJN_ZONDER_GRID),
        { label: `Track ${nr} jog fijn ${tekst} (1/64 tel; zonder grid 1 ms)`, overneem: true,
          read: () => (d.buffer ? 0 : null) });
      define(`${n}.nudge.fine.${naam}`, 'trigger', (on) => {
        if (!on) return;
        const r = nietNu();
        if (r) { melding(r); return; }
        duwer.duw(id, richting * DUW_FIJN * d.rate, { binnenLoop: true });
      }, { label: `Track ${nr} 1 ms ${tekst} duwen`, overneem: true, read: () => (d.buffer ? 0 : null) });
    }

    // ---- vaste beatjumps ----------------------------------------------------
    // Zelfde weigerregels en meldingen als beatjump.back/fwd; de lengte van Bank
    // ◀ ▶ (sprongTellen) blijft staan.
    const spring = (richting, tellen) => {
      const r = d.beatjump(richting, { tellen });
      if (!r.ok && SPRONG_MELDING[r.waarom]) melding(`track ${nr}: ${SPRONG_MELDING[r.waarom]}`, 'fout');
      else if (!r.ok && r.waarom === 'leeg') melding(`track ${nr} is leeg: laad eerst een nummer (library, of sleep een bestand op de kolom).`);
      return r;
    };
    for (const [soort, tellen, tekst] of VASTE_SPRONGEN) {
      for (const [richting, naam, wat] of [[-1, 'back', 'terug'], [1, 'fwd', 'vooruit']]) {
        let ingedrukt = false;
        define(`${n}.beatjump.${soort}.${naam}`, 'trigger', (on) => {
          ingedrukt = !!on;
          if (!on) return;
          if (!d.buffer || d.remt) { melding(nietNu()); return; }
          duwer.sprong(id, () => spring(richting, tellen));
        }, { label: `Track ${nr} beatjump ${tekst} ${wat}`, overneem: true,
             read: () => (!d.buffer || !d.grid || d.gridZekerHier === false ? null : ingedrukt ? 1 : 0) });
      }
    }

    // ---- op de 1 --------------------------------------------------------------
    // Sync zet de TEL gelijk, niet de maat. Dit springt −2…+2 tellen zodat de
    // "1" van deze track op die van de maatgever valt. Alleen met twee zekere grids.
    define(`${n}.bar.align`, 'trigger', (on) => {
      if (!on) return;
      if (!d.buffer || d.remt) { melding(nietNu()); return; }
      const m = maatgever();
      if (!m) { melding(`track ${nr}, op de 1: er is geen andere track die de maat geeft`); return; }
      if (!d.grid || !m.grid) { melding(`track ${nr}, op de 1: ${!d.grid ? `track ${nr}` : `track ${trackNr(m.id)}`} heeft nog geen beatgrid`); return; }
      if (!d.gridZekerHier || !m.gridZekerHier) {
        melding(`track ${nr}, op de 1: kan alleen met twee zekere grids — ${!d.gridZekerHier ? `het grid van track ${nr}` : `het grid van track ${trackNr(m.id)}`} is hier onzeker`, 'fout');
        return;
      }
      duwer.sprong(id, () => {
        const mg = maatgever();
        const b = mg ? naarDeEen(d, mg) : null;
        if (!b || b.n === 0) return;
        spring(Math.sign(b.n), Math.abs(b.n));
      });
    }, { label: `Track ${nr} op de 1: −2…+2 tellen naar de "1" van de maatgever (lampje = staat goed)`, overneem: true,
         read: () => {
           const m = maatgever();
           if (!d.buffer || !d.grid || !m?.grid) return null;
           const b = naarDeEen(d, m);
           return b && b.n === 0 && Math.abs(b.rest) < OP_DE_EEN ? 1 : 0;
         } });

    // ---- bend-sterkte ---------------------------------------------------------
    define(`${n}.bend.amount`, 'value', (v) => {
      d.bendSterkte = BEND_MIN + klem(v) * (BEND_MAX - BEND_MIN);
      if (d.buigt) d.bend(d.buigt);       // drukt hij al: meteen met de nieuwe sterkte
    }, { label: `Track ${nr} bend-sterkte (1–16%, standaard 4%)`,
         read: () => klem((d.bendSterkte - BEND_MIN) / (BEND_MAX - BEND_MIN)) });

    // ---- duoklik --------------------------------------------------------------
    define(`${n}.duoklik`, 'trigger', (on) => {
      if (!on) return;
      if (engine.duoklikDeck === id) { engine.duoklik(null); return; }
      if (!d.buffer) { melding(nietNu()); return; }
      if (!d.grid) { melding(`track ${nr} heeft nog geen beatgrid: de duoklik tikt op de tellen`); return; }
      engine.duoklik(id);
      if (!engine.koptelefoon?.beschikbaar) melding(`duoklik: geen koptelefoonuitgang, dus de tikken klinken in de zaal (docs/STUDIO.md §3)`);
      else if (!maatgever()) melding(`duoklik track ${nr}: er is nog geen maatgever, dus alleen de hoge tik (de lage komt zodra er een andere track de maat geeft)`);
    }, { label: `Track ${nr} duoklik: hoog op deze track, laag op de maatgever (koptelefoon)`,
         log: 'overslaan', beginstand: false,
         read: () => (!d.buffer ? null : engine.duoklikDeck === id ? 1 : 0) });
  }
  return duwer;
}

const trackNr = (deckId) => TRACKS.find(([, d]) => d === deckId)?.[0] ?? '?';
