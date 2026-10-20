// Modelgebaseerd en eigenschapsgebaseerd testen van klok + koppeling + engine (meetpunten M11 en M4,
// v2/meting/BUDGET.md). Geen afhankelijkheden: een eigen geseede PRNG (xorshift32).
//
// M11: MODEL_N willekeurige reeksen (standaard 10000, ~17 s) van 20–60 handelingen op 2–4 tracks.
//      Na elke stap: invarianten (continuïteit, klok continu en stijgend, gekoppeld = klok-tel + v,
//      motor = track, segmenten, weigeren met reden, koppelen nooit op een onzeker stuk) en een
//      vergelijking met een kleine onafhankelijke referentie (test/model-referentie.mjs).
//      Een falend geval print zijn zaad en de reeks, gekrompen tot een kleine reproductie.
//        MODEL_N=1000            minder reeksen
//        MODEL_ZAAD=1234         alleen die reeks, met het verloop van elke stap
//      De referentie is het ONTWERP (zie de kop van model-referentie.mjs, besluiten 1–8): er wordt
//      niets nagespeeld of overgeslagen. Een afwijking van de engine is een fout in de engine en
//      staat als todo-test onderaan, met de kleinste reproductie.
// M4:  2 uur gesimuleerde tijd, twee gekoppelde tracks met een tempokaart: de grootste afwijking
//      van de tel tussen wat de motor gepland kreeg en een exacte berekening (tik elke 250 ms, 1 s,
//      en 60 s zoals een verborgen tabblad dat Chrome tot 1/min knijpt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { HORIZON } from '../src/engine/track.js';
import { Beatgrid } from '../src/kern/grid.js';
import { nepCtx, nepAudio } from './nep-audio.mjs';
import { RefGrid, RefSet, BEREIK } from './model-referentie.mjs';

// ---- toeval ---------------------------------------------------------------------

export function xorshift32(zaad) {
  let x = (zaad >>> 0) || 0x9e3779b9;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
const kies = (rng, lijst) => lijst[Math.floor(rng() * lijst.length)];
const tussen = (rng, a, b) => a + rng() * (b - a);

// ---- opzet: engine + nagebouwde audio die elke planning toetst ------------------------

const MAX_SEGMENTEN = 64;   // src/audio/speler-kern.js
const MAX_PLAN = 60;        // besluit 7: hooguit 60 segmenten per plan

async function opzet(aantal) {
  const ctx = nepCtx();
  const basis = nepAudio();
  const fouten = [];
  const audio = {
    ...basis,
    async speler(c) {
      const s = await basis.speler(c);
      const plan = s.plan.bind(s);
      s.geplandOp = -Infinity;
      s.plan = (segs) => {
        // Wat de echte Speler.plan() weigert (schoon in speler.js) én de afspraken van de motor.
        if (segs.length > Math.min(MAX_SEGMENTEN, MAX_PLAN)) fouten.push(['segs:aantal', `${segs.length} segmenten (hooguit ${MAX_PLAN})`]);
        let vorige = -Infinity;
        for (const [i, x] of segs.entries()) {
          if (!Number.isFinite(x.T) || !Number.isFinite(x.P)) fouten.push(['segs:eindig', `segment ${i}: T ${x.T}, P ${x.P}`]);
          if (x.speelt && !(x.R > 0 && Number.isFinite(x.R))) fouten.push(['segs:R', `segment ${i} speelt met R ${x.R}`]);
          if (x.T < vorige) fouten.push(['segs:volgorde', `segment ${i} op T ${x.T} ligt vóór het vorige (${vorige})`]);
          vorige = x.T;
        }
        s.geplandOp = ctx.currentTime;
        plan(segs);
      };
      return s;
    },
  };
  const e = new Engine({ ctx, audio, tracks: aantal, timer: false });
  await e.klaar;
  return { ctx, e, ref: new RefSet(aantal), fouten, aantal, momenten: new Set() };
}

// ---- nummers met een willekeurig grid ------------------------------------------------------

function maakStuk(rng, van, bpm, anker) {
  const s = { van, bpm, anker };
  const r = rng();
  if (r < 0.12) s.zekerheid = tussen(rng, 0.2, 0.6);                    // onzeker
  else if (r < 0.22) { s.zekerheid = 0.9; s.twijfel = 'maat'; }         // twijfel over de "1"
  if (rng() < 0.3) s.maat = anker + Math.floor(rng() * 4) * (60 / bpm); // een eigen "1"
  return s;
}

export function maakNummer(rng, id) {
  const duur = Math.round(tussen(rng, 150, 600));
  const haal = async () => ({ sr: 48000, kanalen: 2, frames: duur * 48000, paginas: [] });
  if (rng() < 0.08) return { id, titel: id, duur, grid: null, haal, refGrid: null };
  const bpm0 = tussen(rng, 70, 180);
  const stukken = [maakStuk(rng, 0, bpm0, rng() < 0.2 ? 0 : rng() * (60 / bpm0))];
  if (rng() < 0.35) {
    const van = tussen(rng, 20, 120);
    const bpm1 = rng() < 0.5 ? bpm0 * (1 + tussen(rng, -0.15, 0.15)) : tussen(rng, 70, 180);
    stukken.push(maakStuk(rng, van, bpm1, van + tussen(rng, -2, 2)));
  }
  const slot = rng() < 0.05;
  const grid = { stukken, beatsPerBar: 4, slot };
  return { id, titel: id, duur, grid, haal, refGrid: new RefGrid({ stukken, slot }) };
}

// ---- handelingen ------------------------------------------------------------------------------

const bpmUit01 = (v) => 40 + v * 260;
const JOG_TEL = 1 / 32;

function kiesHandeling(rng, o, nr) {
  const n = 1 + Math.floor(rng() * o.aantal);
  const t = o.ref.track(n);
  const r = rng() * 100;
  if (r < 7) return { h: 'laad', n, nummer: maakNummer(rng, `nr${nr}`) };
  if (r < 17) return { h: 'play', n };
  if (r < 21) return { h: 'play.quant', n };
  if (r < 28) return { h: 'sync', n };
  if (r < 30.5) return { h: 'sync.klok', n };
  if (r < 35) return { h: 'jog', n, v: 0.5 + kies(rng, [1 / 8, 1 / 4, 1 / 2, 1, rng()]) * kies(rng, [-1, 1]) / 2 };
  if (r < 38) {
    // Eén nudge-knop tegelijk: een tweede druk zonder loslaten kan een hand niet.
    if (t.bend) return { h: 'nudge', n, richting: t.bend, aan: false };
    return { h: 'nudge', n, richting: kies(rng, [1, -1]), aan: true };
  }
  if (r < 42) {
    // Loslaten: meestal de knop die vastzit.
    const vast = o.ref.tracks.filter((x) => x.bend);
    if (vast.length && rng() < 0.85) { const x = kies(rng, vast); return { h: 'nudge', n: x.n, richting: x.bend, aan: false }; }
    return { h: 'nudge', n, richting: kies(rng, [1, -1]), aan: false };
  }
  if (r < 50) {
    const v = rng() < 0.5 ? rng() : Math.min(1, Math.max(0, t.pitch + tussen(rng, -0.06, 0.06)));
    return { h: 'pitch', n, v };
  }
  if (r < 54) return { h: 'fader', n, v: kies(rng, [0, 1, 1, 0.5]) };
  if (r < 56.5) return { h: 'xfader', v: kies(rng, [0, 0.5, 1]) };
  if (r < 58) return { h: 'kant', n };
  if (r < 61) {
    const nu = o.e.klok.loopt ? o.e.klok.bpm(o.e.straks()) : 120;
    const bpm = rng() < 0.5 ? tussen(rng, 40, 300) : Math.min(300, Math.max(40, nu + tussen(rng, -3, 3)));
    return { h: 'klok.tempo', v: (bpm - 40) / 260 };
  }
  if (r < 64.5) return { h: 'seek', n, v: rng() };
  if (r < 65.3) return { h: 'klok.stop' };
  if (r < 88) return { h: 'tijd', dt: Math.exp(tussen(rng, Math.log(0.001), Math.log(30))) };
  return { h: 'tik' };
}

const tekst = (a) => {
  const { nummer, ...rest } = a;
  if (nummer) rest.grid = nummer.grid ? { stukken: nummer.grid.stukken, slot: nummer.grid.slot } : null, rest.duur = nummer.duur;
  return JSON.stringify(rest);
};

// Welke handelingen de klok mogen veranderen.
const KLOK_MAG = new Set(['klok.tempo', 'pitch', 'sync.klok', 'klok.stop']);
const KLOK_START = new Set(['play', 'play.quant', 'sync', 'sync.klok']);

/** Voert een handeling uit op engine én referentie. Geeft het antwoord van beide. */
async function voerUit(o, a) {
  const { e, ref, ctx } = o;
  const A = e.straks();
  const bus = e.bus;
  let ant, refAnt;
  switch (a.h) {
    case 'laad': {
      await e.laad(a.n, a.nummer);
      ref.track(a.n).laad(A, { grid: a.nummer.refGrid, duur: a.nummer.duur });
      break;
    }
    case 'play': ant = bus.doe(`track.${a.n}.play`, true); bus.doe(`track.${a.n}.play`, false); refAnt = ref.track(a.n).speel(A); break;
    case 'play.quant': ant = bus.doe(`track.${a.n}.play.quant`, true); refAnt = ref.track(a.n).startOpDeMaat(A); break;
    case 'sync': {
      const aan = !ref.track(a.n).sync;
      ant = bus.doe(`track.${a.n}.sync`, true);
      refAnt = ref.track(a.n).zetSync(A, aan);
      break;
    }
    case 'sync.klok': ant = bus.doe(`track.${a.n}.sync.klok`, true); refAnt = ref.track(a.n).klokNaarMij(A); break;
    case 'jog': {
      ant = bus.doe(`track.${a.n}.jog`, a.v);
      const d = (a.v - 0.5) * 2;
      if (Math.abs(d) > 1e-6) ref.track(a.n).jog(A, d * 8 * JOG_TEL);
      break;
    }
    case 'nudge': ant = bus.doe(`track.${a.n}.nudge.${a.richting > 0 ? 'voor' : 'terug'}`, a.aan); ref.track(a.n).nudge(A, a.richting, a.aan); break;
    case 'pitch': {
      ant = bus.doe(`track.${a.n}.pitch`, a.v);
      ref.track(a.n).zetPitch(A, a.v);
      break;
    }
    case 'fader': ant = bus.doe(`track.${a.n}.fader`, a.v); ref.track(a.n).fader = a.v; break;
    case 'xfader': ant = bus.doe('mixer.xfader', a.v); ref.xfader = a.v; break;
    case 'kant': {
      ant = bus.doe(`track.${a.n}.kant`, true);
      const t = ref.track(a.n);
      t.kant = { A: 'B', B: 'thru', thru: 'A' }[t.kant];
      break;
    }
    case 'klok.tempo': ant = bus.doe('klok.tempo', a.v); ref.zetKlokTempo(A, bpmUit01(a.v)); break;
    case 'seek': {
      ant = bus.doe(`track.${a.n}.seek`, a.v);
      const t = ref.track(a.n);
      if (t.geladen) t.zoek(A, a.v * t.duur);
      break;
    }
    case 'klok.stop': ant = bus.doe('klok.stop', true); refAnt = ref.klokStop(A, ctx.currentTime); break;
    case 'tijd': ctx.currentTime += a.dt; break;
    case 'tik': e.tik(); break;
    default: throw new Error(a.h);
  }
  return { ant, refAnt, A };
}

// ---- invarianten ------------------------------------------------------------------------------

class Schending extends Error {
  constructor(soort, wat) { super(`[${soort}] ${wat}`); this.soort = soort; }
}
const eis = (ok, soort, wat) => { if (!ok) throw new Schending(soort, typeof wat === 'function' ? wat() : wat); };

/** Wat de grootste afwijking was tussen motor en track (voor het verslag). */
export const gemeten = { spelerPlek: 0, spelerTel: 0, glijMax: 0, glijMin: Infinity, handelingen: {}, geweigerd: {}, koppelingen: 0, wachten: 0 };
const getal = (x) => (typeof x === 'number' ? Number(x.toPrecision(12)) : x);

/** De plek van een tijdvak van de engine, met zijn eigen formule (los van _vak). */
function vakPlek(e, tr, x, t) {
  if (x.soort === 'stil') return x.P;
  if (x.soort === 'vrij') return x.P + (t - x.van) * x.R;
  return tr.grid.timeOf(e.klok.tel(t) + x.v);
}

function momentopname(o, A) {
  const { e } = o;
  const tracks = e.tracks.map((tr) => ({
    P: tr.plek(A),
    b: tr.grid ? tr.grid.beatAt(tr.plek(A)) : null,
    gekoppeld: tr.gekoppeldOp(A),
    speelt: tr.speeltOp(A),
    v: tr.verschuiving,
  }));
  const loopt = e.klok.loopt;
  const tellen = loopt ? [0, 0.5, 3, 20].map((d) => e.klok.tel(A + d)) : null;
  return { tracks, loopt, tellen, bpm: loopt ? e.klok.bpm(A) : null };
}

/** Wat elke handeling op het moment A met de plek van zijn track mag doen. */
function controleerSprong(o, a, voor, na, ant) {
  const { e } = o;
  for (let i = 0; i < o.aantal; i++) {
    const n = i + 1, v0 = voor.tracks[i], v1 = na.tracks[i];
    const tr = e.track(n);
    const dP = v1.P - v0.P;
    const dB = v0.b !== null && v1.b !== null ? v1.b - v0.b : null;
    const wat = () => `track ${n}, ${a.h}: plek ${getal(v0.P)} -> ${getal(v1.P)} (Δtel ${getal(dB)})`;
    if (n !== a.n || ['fader', 'kant', 'pitch', 'nudge'].includes(a.h)) {
      if (a.h === 'laad' && n === a.n) continue;
      eis(Math.abs(dP) <= 1e-9, 'sprong:handeling', wat);
      continue;
    }
    switch (a.h) {
      case 'laad': case 'seek': break;
      case 'play': case 'sync':
        // Koppelen springt hooguit een halve tel (klok-B07); verder niets.
        if (v1.gekoppeld && !v0.gekoppeld && dB !== null) eis(Math.abs(dB) <= 0.5 + 1e-9, 'sprong:handeling', wat);
        else if (a.h === 'sync' && v1.gekoppeld && v0.gekoppeld && dB !== null) eis(Math.abs(dB) <= 0.5 + 1e-9, 'sprong:handeling', wat);
        else eis(Math.abs(dP) <= 1e-9, 'sprong:handeling', wat);
        break;
      case 'play.quant':
        if (!voor.loopt) { if (v1.gekoppeld && dB !== null) eis(Math.abs(dB) <= 0.5 + 1e-9, 'sprong:handeling', wat); else eis(Math.abs(dP) <= 1e-9, 'sprong:handeling', wat); }
        else eis(Math.abs(dP) <= 1e-9, 'sprong:handeling', wat);
        break;
      case 'sync.klok':
        if (!voor.loopt && dB !== null) eis(Math.abs(dB) <= 0.5 + 1e-9, 'sprong:handeling', wat);
        else eis(Math.abs(dP) <= 1e-9, 'sprong:handeling', wat);
        break;
      case 'jog': {
        // Jog = precies de jogwaarde: gekoppeld in tellen, anders in seconden (op 0 geklemd).
        const tellen = (a.v - 0.5) * 2 * 8 * JOG_TEL;
        if (v0.gekoppeld) eis(Math.abs(dB - tellen) <= 1e-9, 'sprong:jog', wat);
        else {
          const L = tr.grid ? tr.grid.beatLengthAt(v0.P) : 0.5;
          eis(Math.abs(v1.P - Math.max(0, v0.P + tellen * L)) <= 1e-9, 'sprong:jog', wat);
        }
        break;
      }
      default: eis(Math.abs(dP) <= 1e-9, 'sprong:handeling', wat);
    }
  }
  // De klok: alleen klokbediening (en de eerste start) verandert hem, en dan zonder sprong.
  const magStarten = !voor.loopt && KLOK_START.has(a.h);
  if (!KLOK_MAG.has(a.h) && !magStarten) {
    eis(voor.loopt === na.loopt, 'klok:veranderd', () => `${a.h} zette de klok ${na.loopt ? 'aan' : 'uit'}`);
    if (voor.loopt) {
      for (let k = 0; k < voor.tellen.length; k++) {
        eis(Math.abs(voor.tellen[k] - na.tellen[k]) <= 1e-12, 'klok:veranderd', () => `${a.h} op track ${a.n} veranderde de klok (${getal(voor.tellen[k])} -> ${getal(na.tellen[k])})`);
      }
    }
  } else if (voor.loopt && na.loopt) {
    eis(Math.abs(voor.tellen[0] - na.tellen[0]) <= 1e-9, 'klok:sprong', () => `${a.h}: de klok sprong op A (${voor.tellen[0]} -> ${na.tellen[0]})`);
  }
  // Pitch: het klok-tempo verandert hooguit zoveel als de fader bewoog (soft-takeover, klok-B14).
  if (a.h === 'pitch' && voor.loopt && na.loopt) {
    const tr = e.track(a.n);
    const dBpm = Math.abs(na.bpm - voor.bpm);
    const was = o.pitchVoor;
    const grens = Math.abs(a.v - was) * 2 * BEREIK * (tr.grid ? tr.grid.bpmAt(voor.tracks[a.n - 1].P) : 0) + 1e-6;
    eis(dBpm <= grens, 'pitch:tempo-sprong', () => `pitch ${getal(was)} -> ${getal(a.v)} op track ${a.n} zette de klok van ${getal(voor.bpm)} naar ${getal(na.bpm)} bpm (mag hooguit ${getal(grens)})`);
  }
  // Weigeren alleen met een reden; engine en referentie weigeren hetzelfde.
  if (ant?.geweigerd !== undefined) eis(typeof ant.geweigerd === 'string' && ant.geweigerd.length > 0, 'weigering:reden', `${a.h}: geweigerd zonder reden`);
}

/** Wat altijd moet gelden, na elke stap. */
function controleerAltijd(o, { naTik = false } = {}) {
  const { e, ref, ctx, fouten } = o;
  const nu = ctx.currentTime;
  if (fouten.length) { const [s, w] = fouten[0]; throw new Schending(s, w); }
  // De klok: continu, stijgend, segmenten oplopend.
  const seg = e.klok.seg;
  for (let i = 0; i < seg.length; i++) {
    eis(seg[i].R > 0 && Number.isFinite(seg[i].R), 'klok:daalt', `klok-segment ${i} heeft R ${seg[i].R}`);
    if (i > 0) {
      eis(seg[i].T > seg[i - 1].T, 'klok:volgorde', `klok-segment ${i} T ${seg[i].T} na ${seg[i - 1].T}`);
      const verwacht = seg[i - 1].C + (seg[i].T - seg[i - 1].T) * seg[i - 1].R;
      eis(Math.abs(seg[i].C - verwacht) <= 1e-9 * Math.max(1, Math.abs(verwacht)), 'klok:sprong', `de klok springt op ${seg[i].T}: ${verwacht} -> ${seg[i].C}`);
    }
  }
  eis(e.klok.loopt === ref.klok.loopt, 'ref:klok', `klok loopt: engine ${e.klok.loopt}, referentie ${ref.klok.loopt}`);

  // Momenten om te vergelijken: nu, straks, wat willekeurige in de komende 12 s, en elke grens.
  // Vaste momenten (geen toeval): dan blijft een schending staan als het krimpen een handeling weglaat.
  const tijden = [nu, e.straks(), nu + 0.1, nu + 0.6, nu + 2.3, nu + 7.1, nu + 12];
  for (const tr of e.tracks) for (const x of tr.vakken) if (x.van > nu && x.van < nu + 30) tijden.push(x.van - 1e-6, x.van + 1e-6);
  for (const t of ref.tracks) { const w = t.wachtOp(nu); if (w !== null) tijden.push(w - 1e-6, w + 1e-6); }

  if (e.klok.loopt) {
    for (const t of tijden) {
      eis(Math.abs(e.klok.tel(t) - ref.klok.tel(t)) <= 1e-6, 'ref:klok', () => `klok-tel op ${getal(t)}: engine ${e.klok.tel(t)}, referentie ${ref.klok.tel(t)}`);
      eis(Math.abs(e.klok.bpm(t) - ref.klok.bpm(t)) <= 1e-6, 'ref:klok', () => `klok-bpm op ${getal(t)}: engine ${e.klok.bpm(t)}, referentie ${ref.klok.bpm(t)}`);
    }
  }

  for (const tr of e.tracks) {
    const rt = ref.track(tr.n);
    const naam = `track ${tr.n}`;
    eis(tr.sync === rt.sync, 'ref:sync', `${naam}: sync engine ${tr.sync}, referentie ${rt.sync}`);
    // Gekoppeld (vanaf straks, of gepland) zonder sync: de knop zegt uit, het nummer zit vast. Wat vóór
    // straks() ligt, klinkt al en staat vast (ook een sync uit gaat pas op straks() in).
    const S = e.straks();
    const gepland = tr.vakken.filter((x, i) => x.soort === 'gekoppeld' && (tr.vakken[i + 1]?.van ?? Infinity) > S);
    eis(!gepland.length || tr.sync, 'sync:gekoppeld', `${naam} is gekoppeld (of wordt dat op ${getal(gepland[0]?.van)}) terwijl sync uit staat`);
    // Tijdvakken oplopend, en geen sprong op een gepland moment (alleen een handeling mag springen).
    for (let i = 1; i < tr.vakken.length; i++) {
      const x = tr.vakken[i], w = tr.vakken[i - 1];
      eis(x.van >= w.van, 'vakken:volgorde', `${naam}: tijdvak op ${x.van} na een op ${w.van}`);
      if (x.van > nu && !o.momenten.has(x.van) && tr.grid && e.klok.loopt) {
        const links = vakPlek(e, tr, w, x.van), rechts = vakPlek(e, tr, x, x.van);
        eis(Math.abs(links - rechts) <= 1e-6, 'sprong:gepland', () => `${naam}: op het geplande moment ${getal(x.van)} (${w.soort} -> ${x.soort}) springt de plek van ${getal(links)} naar ${getal(rechts)}`);
      }
      // Een geplande koppeling begint nooit op een onzekere plek (klok-B08).
      if (x.soort === 'gekoppeld' && w.soort !== 'gekoppeld' && x.van > nu && !o.momenten.has(x.van) && rt.grid) {
        const P = vakPlek(e, tr, x, x.van);
        eis(rt.grid.zeker(P), 'onzeker:gekoppeld', () => `${naam} wordt op ${getal(x.van)} gekoppeld op plek ${getal(P)}, waar het grid onzeker is`);
      }
    }
    // Engine en referentie zijn het eens.
    for (const t of tijden) {
      eis(tr.speeltOp(t) === rt.speeltOp(t), 'ref:speelt', () => `${naam} op ${getal(t)}: speelt engine ${tr.speeltOp(t)}, referentie ${rt.speeltOp(t)}`);
      eis(tr.gekoppeldOp(t) === rt.gekoppeldOp(t), 'ref:gekoppeld', () => `${naam} op ${getal(t)}: gekoppeld engine ${tr.gekoppeldOp(t)}, referentie ${rt.gekoppeldOp(t)}`);
      eis(Math.abs(tr.plek(t) - rt.plek(t)) <= 1e-6, 'ref:plek', () => `${naam} op ${getal(t)}: plek engine ${tr.plek(t)}, referentie ${rt.plek(t)}`);
    }
    const w1 = tr.wacht, w2 = rt.wachtOp(e.straks());
    eis((w1 === null) === (w2 === null) && (w1 === null || Math.abs(w1 - w2) <= 1e-6), 'ref:wacht', `${naam}: wacht engine ${w1}, referentie ${w2}`);

    // Wat de afspeelmotor kreeg, geeft dezelfde plek (zelfde formule, regel 3), binnen de horizon.
    const sp = tr.speler;
    const van = Math.max(nu, sp.geplandOp), tot = sp.geplandOp + HORIZON - 1e-3;
    const proeven = [];
    if (tot > van) for (const f of [0, 0.013, 0.21, 0.5, 0.77, 0.999]) proeven.push(van + f * (tot - van));
    if (naTik) for (const d of [0.01, 0.12, 0.249]) proeven.push(nu + d);
    for (const t of proeven) {
      const p1 = sp.positie(t), p2 = tr.plek(t);
      gemeten.spelerPlek = Math.max(gemeten.spelerPlek, Math.abs(p1 - p2));
      eis(sp.speeltOp(t) === tr.speeltOp(t), 'speler:speelt', () => `${naam} op ${getal(t)}: motor speelt ${sp.speeltOp(t)}, track ${tr.speeltOp(t)} (gepland op ${getal(sp.geplandOp)})`);
      eis(Math.abs(p1 - p2) <= 1e-9, 'speler:plek', () => `${naam} op ${getal(t)}: motor ${p1}, track ${p2} (gepland op ${getal(sp.geplandOp)}, Δ ${p1 - p2})`);
      // Een gekoppelde track ligt op klok-tel + v (in wat de motor speelt).
      const x = tr._vak(t);
      if (x.soort === 'gekoppeld' && tr.grid) {
        const d = tr.grid.beatAt(p1) - e.klok.tel(t) - x.v;
        gemeten.spelerTel = Math.max(gemeten.spelerTel, Math.abs(d));
        eis(Math.abs(d) <= 1e-9, 'speler:tel', () => `${naam} op ${getal(t)}: tel van de motor − klok-tel − v = ${d}`);
      }
    }
  }
}

// ---- één reeks ----------------------------------------------------------------------------------

/**
 * Een reeks uitvoeren. `volgende(i, o)` geeft de i-de handeling (of null = klaar): zo kan dezelfde
 * functie een willekeurige reeks maken én een vaste lijst opnieuw draaien (krimpen, todo-tests).
 */
async function voerReeksUit(aantal, volgende, { zaad = 0, verbose = false } = {}) {
  const o = await opzet(aantal);
  const reeks = [];
  try {
    for (let i = 0; ; i++) {
      const a = volgende(i, o);
      if (!a) break;
      reeks.push(a);
      const handeling = a.h !== 'tijd' && a.h !== 'tik';
      const A = o.e.straks();
      const voor = handeling ? momentopname(o, A) : null;
      if (a.h === 'pitch') o.pitchVoor = o.e.track(a.n).pitch;
      let uit;
      try { uit = await voerUit(o, a); } catch (err) {
        if (err instanceof Schending) throw err;
        throw new Schending('uitzondering', `${a.h}: ${err.stack?.split('\n').slice(0, 3).join(' | ')}`);
      }
      if (handeling) {
        o.momenten.add(A);
        const na = momentopname(o, A);
        controleerSprong(o, a, voor, na, uit.ant);
        gemeten.handelingen[a.h] = (gemeten.handelingen[a.h] ?? 0) + 1;
        if (uit.ant?.geweigerd) gemeten.geweigerd[a.h] = (gemeten.geweigerd[a.h] ?? 0) + 1;
        if (a.n && na.tracks[a.n - 1].gekoppeld && !voor.tracks[a.n - 1].gekoppeld) gemeten.koppelingen++;
        if (a.h === 'play.quant' && o.e.track(a.n).wacht !== null) gemeten.wachten++;
        if (a.h === 'sync.klok' && voor.loopt && o.e.klok.seg.length >= 2) {
          // Hoe hard de klok tijdelijk loopt tijdens het glijden, t.o.v. het snelste van oud en nieuw.
          const sg = o.e.klok.seg, R1 = sg.at(-2).R, R2 = sg.at(-1).R, R0 = voor.bpm / 60;
          if (sg.at(-2).T === A) { gemeten.glijMax = Math.max(gemeten.glijMax, R1 / Math.max(R0, R2)); gemeten.glijMin = Math.min(gemeten.glijMin, R1 / Math.min(R0, R2)); }
        }
        // Koppelen gebeurt nooit op een onzekere plek (klok-B08).
        const tr = o.e.track(a.n ?? 1), rt = o.ref.track(a.n ?? 1);
        if (a.n && ['play', 'sync', 'sync.klok', 'play.quant', 'nudge'].includes(a.h)
          && na.tracks[a.n - 1].gekoppeld && !voor.tracks[a.n - 1].gekoppeld && rt.grid) {
          eis(rt.grid.zeker(tr.plek(A)), 'onzeker:gekoppeld', () => `${a.h} koppelt track ${a.n} op plek ${getal(tr.plek(A))}, waar het grid onzeker is`);
        }
        const g1 = !!uit.ant?.geweigerd, g2 = !!uit.refAnt?.geweigerd;
        eis(g1 === g2, 'ref:weigering', `${a.h} op track ${a.n}: engine ${g1 ? `weigert (${uit.ant.geweigerd})` : 'doet het'}, referentie ${g2 ? `weigert (${uit.refAnt.geweigerd})` : 'doet het'}`);
      }
      try { controleerAltijd(o, { naTik: a.h === 'tik' }); } catch (err) {
        if (err instanceof Schending) throw err;
        throw new Schending('uitzondering', `na ${a.h}: ${err.stack?.split('\n').slice(0, 3).join(' | ')}`);
      }
      if (verbose) console.log(i, tekst(a), 't =', o.ctx.currentTime.toFixed(4), 'klok', o.e.klok.loopt ? o.e.klok.bpm(o.ctx.currentTime).toFixed(3) : '-');
    }
    return null;
  } catch (err) {
    if (!(err instanceof Schending)) throw err;
    return { zaad, aantal, soort: err.soort, bericht: err.message, stap: reeks.length - 1, acties: reeks, reeks: reeks.map(tekst) };
  } finally {
    o.e.vernietig();
  }
}

/** Een willekeurige reeks bij dit zaad: 2–4 tracks, 20–60 handelingen, eerst elke track een nummer. */
function reeksVan(zaad) {
  const rng = xorshift32(zaad);
  const aantal = 2 + Math.floor(rng() * 3);
  const lengte = 20 + Math.floor(rng() * 41);
  const volgende = (i, o) => (i >= lengte ? null
    : i < aantal ? { h: 'laad', n: i + 1, nummer: maakNummer(rng, `nr${i}`) } : kiesHandeling(rng, o, i));
  return { aantal, volgende };
}

export async function draaiReeks(zaad, opties = {}) {
  const { aantal, volgende } = reeksVan(zaad);
  return voerReeksUit(aantal, volgende, { zaad, ...opties });
}

/** Een vaste lijst handelingen opnieuw draaien. */
export function draaiLijst(aantal, acties, zaad = 0, opties = {}) {
  return voerReeksUit(aantal, (i) => acties[i] ?? null, { zaad, ...opties });
}

/** Krimpen: handelingen weglaten zolang dezelfde soort schending blijft (voor een kleine reproductie). */
export async function krimp(f) {
  let acties = f.acties.slice(0, f.stap + 1);
  let beste = f;
  for (let ronde = 0; ronde < 4; ronde++) {
    let kleiner = false;
    for (let i = acties.length - 1; i >= 0; i--) {
      const proef = acties.filter((_, j) => j !== i);
      const r = await draaiLijst(beste.aantal, proef, f.zaad);
      if (r && r.soort === f.soort) { acties = r.acties; beste = r; kleiner = true; i = Math.min(i, acties.length); }
    }
    if (!kleiner) break;
  }
  return beste;
}

const verslag = (f) => `zaad ${f.zaad}, stap ${f.stap}: ${f.bericht}\n  reeks:\n${f.reeks.map((r, i) => `   ${String(i).padStart(2)} ${r}`).join('\n')}`;

// ---- de referentie zelf ---------------------------------------------------------------------------

test('referentie: het eigen grid rekent hetzelfde als Beatgrid (één of twee stukken, maat, zekerheid)', () => {
  const rng = xorshift32(77);
  let n = 0;
  for (let k = 0; k < 3000; k++) {
    const nr = maakNummer(rng, `g${k}`);
    if (!nr.grid) continue;
    const g = new Beatgrid(nr.grid), r = nr.refGrid;
    for (let j = 0; j < 20; j++) {
      const t = tussen(rng, -2, nr.duur);
      const b = g.beatAt(t);
      assert.ok(Math.abs(r.beat(t) - b) <= 1e-9, `beat op ${t}: ${r.beat(t)} ≠ ${b} (${JSON.stringify(nr.grid)})`);
      assert.ok(Math.abs(r.tijd(b) - g.timeOf(b)) <= 1e-9, `tijd van ${b}`);
      const m = g.barPhase(t) * 4, rm = r.inMaat(t);
      assert.ok(Math.min(Math.abs(m - rm), 4 - Math.abs(m - rm)) <= 1e-6, `in de maat op ${t}: ${rm} ≠ ${m} (${JSON.stringify(nr.grid)})`);
      assert.equal(r.zeker(t), g.zekerBij(t));
      assert.equal(r.maatZeker(t), g.syncBij(t));
      assert.equal(r.bpmOp(t), g.bpmAt(t));
      const bi = Math.round(b);
      assert.equal(r.isEen(bi), g.isMaatbegin(bi), `isEen(${bi})`);
      n++;
    }
  }
  assert.ok(n > 40000);
});

// ---- M11 -----------------------------------------------------------------------------------------

const N = Number(process.env.MODEL_N ?? 10000);
const ZAAD = process.env.MODEL_ZAAD !== undefined ? Number(process.env.MODEL_ZAAD) : null;
async function draaiVeel() {
  const lijst = ZAAD !== null ? [ZAAD] : Array.from({ length: N }, (_, i) => 1000 + i);
  const fouten = [];
  const t0 = performance.now();
  let stappen = 0;
  for (const z of lijst) {
    const f = await draaiReeks(z, { verbose: ZAAD !== null });
    stappen += f ? f.stap + 1 : 0;
    if (f) fouten.push(f);
  }
  const s = (performance.now() - t0) / 1000;
  const perSoort = {};
  for (const f of fouten) (perSoort[f.soort] ??= []).push(f.zaad);
  console.log(`M11: ${lijst.length} reeksen in ${s.toFixed(1)} s, ${fouten.length} met een schending`);
  for (const [soort, z] of Object.entries(perSoort)) console.log(`  ${soort}: ${z.length} (eerste zaden ${z.slice(0, 5).join(', ')})`);
  console.log(`  grootste afwijking motor − track: ${gemeten.spelerPlek.toExponential(2)} s, in de tel ${gemeten.spelerTel.toExponential(2)} tel`);
  console.log(`  handelingen: ${JSON.stringify(gemeten.handelingen)}`);
  console.log(`  geweigerd: ${JSON.stringify(gemeten.geweigerd)}; koppelingen ${gemeten.koppelingen}, wachten op de maat ${gemeten.wachten}`);
  console.log(`  klok naar dit nummer: tijdens het glijden hooguit ${gemeten.glijMax.toFixed(2)}× het snelste, minstens ${gemeten.glijMin.toFixed(2)}× het traagste tempo`);
  for (const k of Object.keys(gemeten)) gemeten[k] = typeof gemeten[k] === 'number' ? (k === 'glijMin' ? Infinity : 0) : {};
  return { fouten, perSoort, lijst };
}

async function verslagVan(fouten, perSoort) {
  const klein = [];
  for (const z of Object.values(perSoort)) klein.push(await krimp(fouten.find((f) => f.zaad === z[0])));
  return `${fouten.length} reeksen met een schending; per soort de eerste, gekrompen:\n${klein.map(verslag).join('\n\n')}`;
}

/**
 * Afwijkingen engine ↔ ontwerp die nog open staan (todo-tests K10–K18 onderaan). Zolang deze lijst niet
 * leeg is, is M11 een todo: hij draait en telt wel, maar breekt de suite niet. Niets wordt overgeslagen;
 * hersteld = de K-test slaagt, haal hem dan hier weg (en van zijn todo).
 */
const OPEN = [];   // K10–K18 hersteld op 19 okt

test(`M11: ${ZAAD !== null ? `zaad ${ZAAD}` : `${N} willekeurige reeksen`} tegen de referentie (het ontwerp), 0 schendingen`, { timeout: 1800000, todo: OPEN.length ? `engine wijkt af van het ontwerp: ${OPEN.join(', ')}` : false }, async () => {
  const { fouten, perSoort } = await draaiVeel();
  if (fouten.length) assert.fail(await verslagVan(fouten, perSoort));
});

// ---- M4: twee uur ---------------------------------------------------------------------------------

/**
 * Een tempokaart zoals een live opname of een album: elke `elke` seconden een nieuw stuk met een
 * iets ander tempo (en één grotere stap), op een eigen anker.
 */
function tempokaart(rng, bpm, { elke = 900, tot = 7400, grote = null }) {
  const stukken = [{ van: 0, bpm, anker: rng() * 0.3 }];
  for (let van = elke; van < tot; van += elke) {
    const b = grote && Math.abs(van - grote.van) < elke / 2 ? grote.bpm : bpm * (1 + tussen(rng, -0.006, 0.006));
    stukken.push({ van, bpm: b, anker: van + rng() * (60 / b) });
  }
  return { stukken, beatsPerBar: 4 };
}

/**
 * M4: klok 124, twee gekoppelde tracks met een tempokaart, elke 30 s een kleine tempowijziging van de
 * klok, af en toe een jog, tik() elke `tikElke` s. Gemeten: de tel van wat de MOTOR gepland kreeg
 * (grid.beatAt(speler.positie(t))) tegen een exacte berekening (eigen klok-lijn + verschuiving), elke
 * 20 ms over 2 uur. Geeft de grootste afwijking in ms (tijd: tellen / tellen per seconde).
 */
async function m4({ tikElke, metTempo = true, metJog = true, duur = 7200, zaad = 4 }) {
  const rng = xorshift32(zaad);
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: nepAudio(), tracks: 2, timer: false });
  await e.klaar;
  const kaarten = [tempokaart(rng, 124, { elke: 900 }), tempokaart(rng, 128, { elke: 700, grote: { van: 3500, bpm: 136 } })];
  for (let i = 0; i < 2; i++) {
    const g = kaarten[i];
    await e.laad(i + 1, { id: `m4-${i}`, titel: 'm4', duur: duur + 300, grid: g, haal: async () => ({ sr: 48000, kanalen: 2, frames: 1, paginas: [] }) });
  }
  // De exacte klok: eigen lijst, eigen formule.
  const lijn = [];
  const telEx = (t) => { let s = lijn[0]; for (let i = lijn.length - 1; i >= 0; i--) if (lijn[i].T <= t) { s = lijn[i]; break; } return s.C + (t - s.T) * s.R; };
  const rateEx = (t) => { let s = lijn[0]; for (let i = lijn.length - 1; i >= 0; i--) if (lijn[i].T <= t) { s = lijn[i]; break; } return s.R; };
  let A = e.straks();
  e.bus.doe('klok.tempo', (124 - 40) / 260);
  lijn.push({ T: A, C: 0, R: 124 / 60 });
  const v = [];
  for (let n = 1; n <= 2; n++) {
    e.bus.doe(`track.${n}.play`, true);       // vrij op plek 0 (sync staat nog uit)
    e.bus.doe(`track.${n}.sync`, true);       // koppelen: dichtstbijzijnde tel
    const g = new Beatgrid(kaarten[n - 1]);
    v.push(Math.round(g.beatAt(0) - telEx(A)));
  }
  assert.deepEqual(v, [e.track(1).verschuiving, e.track(2).verschuiving], 'koppeling zoals verwacht');
  const vLijst = v.map((x) => [{ A: -Infinity, v: x }]);
  const vOp = (i, t) => { const l = vLijst[i]; for (let k = l.length - 1; k >= 0; k--) if (l[k].A <= t) return l[k].v; return l[0].v; };
  const grids = [e.track(1).grid, e.track(2).grid];

  // De gebeurtenissen, op tijd.
  const gebeurt = [];
  for (let t = tikElke; t < duur; t += tikElke) gebeurt.push({ t, h: 'tik' });
  let bpm = 124;
  if (metTempo) for (let t = 30; t < duur; t += 30) {
    bpm = Math.min(130, Math.max(118, bpm + tussen(rng, -0.5, 0.5) * kies(rng, [1, 0.1])));
    gebeurt.push({ t: t + 0.0137, h: 'tempo', bpm });
  }
  if (metJog) for (let t = 100; t < duur; t += tussen(rng, 90, 240)) gebeurt.push({ t, h: 'jog', n: kies(rng, [1, 2]), tellen: kies(rng, [-1, 1]) * kies(rng, [1 / 32, 1 / 16, 1 / 8]) });
  gebeurt.sort((a, b) => a.t - b.t);

  let maxMs = 0, waar = null, klokMs = 0, bijGrens = 0;
  const grenzen = grids.map((g) => g.wissels());
  let gi = 0;
  for (let t = 0.02; t < duur; t += 0.02) {
    while (gi < gebeurt.length && gebeurt[gi].t <= t) {
      const g = gebeurt[gi++];
      ctx.currentTime = g.t;
      if (g.h === 'tik') e.tik();
      else if (g.h === 'tempo') {
        A = e.straks();
        lijn.push({ T: A, C: telEx(A), R: g.bpm / 60 });
        e.bus.doe('klok.tempo', (g.bpm - 40) / 260);
      } else {
        // De jog gaat in op straks(), net als in de engine: tot dan geldt de oude verschuiving.
        vLijst[g.n - 1].push({ A: e.straks(), v: vOp(g.n - 1, Infinity) + g.tellen });
        e.bus.doe(`track.${g.n}.jog`, 0.5 + g.tellen * 4 / 2);   // tellen = (v − 0,5) · 2 · 8/32
      }
    }
    const R = rateEx(t);
    klokMs = Math.max(klokMs, Math.abs(e.klok.tel(t) - telEx(t)) / R * 1000);
    for (let i = 0; i < 2; i++) {
      const p = e.track(i + 1).speler.positie(t);
      const ms = Math.abs(grids[i].beatAt(p) - telEx(t) - vOp(i, t)) / R * 1000;
      if (ms > maxMs) { maxMs = ms; waar = { t, track: i + 1, plek: p }; }
      if (grenzen[i].some((w) => Math.abs(w - p) < 30)) bijGrens = Math.max(bijGrens, ms);
    }
  }
  e.vernietig();
  return { maxMs, waar, klokMs, bijGrens };
}

const fmt = (r) => `grootste afwijking ${r.maxMs.toPrecision(3)} ms (track ${r.waar?.track} op t = ${r.waar?.t.toFixed(2)} s, plek ${r.waar?.plek.toFixed(2)} s); klok zelf ${r.klokMs.toPrecision(3)} ms; binnen 30 s van een grens van de tempokaart ${r.bijGrens.toPrecision(3)} ms`;

test('M4: 2 uur, tik elke 250 ms: de tel van een gekoppelde track wijkt ≤ 1 ms af', { timeout: 120000 }, async () => {
  const r = await m4({ tikElke: 0.25 });
  console.log(`M4 (tik 250 ms): ${fmt(r)}`);
  assert.ok(r.maxMs <= 1, fmt(r));
});

test('M4: 2 uur, tik elke 1 s (verborgen tabblad, normaal geknepen): ≤ 1 ms', { timeout: 120000 }, async () => {
  const r = await m4({ tikElke: 1 });
  console.log(`M4 (tik 1 s): ${fmt(r)}`);
  assert.ok(r.maxMs <= 1, fmt(r));
});

// Een verborgen tabblad dat Chrome tot 1/min knijpt: de motor speelt na de horizon (8 s) het laatste
// segment door, en een grens van de tempokaart daarna mist hij tot de volgende planning.
const m4min = await m4({ tikElke: 60 });
const m4minKaal = await m4({ tikElke: 60, metTempo: false, metJog: false });
test(`M4: tik eens per 60 s: ≤ 1 ms (gemeten ${m4min.maxMs.toPrecision(3)} ms met tempowijzigingen elke 30 s, ${m4minKaal.maxMs.toPrecision(3)} ms zonder)`,
  { todo: m4min.maxMs > 1 || m4minKaal.maxMs > 1 ? `te groot: ${m4min.maxMs.toPrecision(3)} / ${m4minKaal.maxMs.toPrecision(3)} ms` : false }, () => {
    console.log(`M4 (tik 60 s, tempo elke 30 s): ${fmt(m4min)}`);
    console.log(`M4 (tik 60 s, verder niets): ${fmt(m4minKaal)}`);
    assert.ok(m4min.maxMs <= 1 && m4minKaal.maxMs <= 1);
  });

// ---- gevonden fouten: kleinste reproducties ------------------------------------------------------
//
// K1–K9 zijn hersteld en zijn gewone tests. K10 en verder zijn todo-tests: ze beschrijven wat het
// ontwerp vraagt (besluit of klok-B/S erbij) en falen nu; gevonden met M11 (zaad erbij).

async function klein(aantal = 2) {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: nepAudio(), tracks: aantal, timer: false });
  await e.klaar;
  const nummer = (bpm, anker = 0, extra = {}) => ({
    id: `n${bpm}-${anker}`, titel: 'x', duur: 300, haal: async () => ({ sr: 48000, kanalen: 2, frames: 300 * 48000, paginas: [] }),
    grid: extra.grid === null ? null : { stukken: extra.stukken ?? [{ van: 0, bpm, anker }], beatsPerBar: 4 },
  });
  return { ctx, e, bus: e.bus, nummer, zet: (t) => { ctx.currentTime = t; e.tik(); } };
}

test('K1: sync uit terwijl een track op de maat wacht: hij mag daarna niet gekoppeld starten', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124)); await e.laad(2, nummer(128, 0.1));
  bus.doe('track.1.play', true);
  zet(1);
  bus.doe('track.2.play.quant', true);          // wacht op de volgende "1", sync gaat aan
  const ts = e.track(2).wacht;
  bus.doe('track.2.sync', true);                // en meteen weer uit
  assert.equal(e.track(2).sync, false);
  zet(ts + 1);
  assert.ok(!(e.track(2).gekoppeld && !e.track(2).sync), `gekoppeld ${e.track(2).gekoppeld} met sync ${e.track(2).sync}`);
});

test('K1b: sync uit tijdens "klok naar dit nummer": de track mag daarna niet gekoppeld worden', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124)); await e.laad(2, nummer(132, 0.05));
  bus.doe('track.1.play', true);
  zet(1); bus.doe('track.2.play', true);        // vrij op 132
  zet(2); bus.doe('track.2.sync.klok', true);   // klok glijdt naar 2, die is pas straks gekoppeld
  bus.doe('track.2.sync', true);                // sync uit
  zet(10);
  assert.ok(!(e.track(2).gekoppeld && !e.track(2).sync), `gekoppeld ${e.track(2).gekoppeld} met sync ${e.track(2).sync}`);
});

test('K2a: nudge loslaten op een gestopte track: de knop blijft niet "vast"', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(120));
  bus.doe('track.1.play', true);
  zet(1); bus.doe('track.1.nudge.voor', true);
  bus.doe('track.1.play', true);                // pauze tijdens het drukken
  bus.doe('track.1.nudge.voor', false);         // los, terwijl hij stil staat
  bus.doe('track.1.play', true);                // weer spelen (gekoppeld)
  zet(2); bus.doe('track.1.nudge.voor', true);  // opnieuw drukken
  assert.ok(Math.abs(e.track(1).snelheid(e.straks()) - 1.04) < 1e-6, `snelheid ${e.track(1).snelheid(e.straks())}`);
});

test('K2b: sync aan tijdens een nudge, dan loslaten: de track blijft gekoppeld', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124)); await e.laad(2, nummer(128));
  bus.doe('track.1.play', true);
  zet(1); bus.doe('track.2.play', true);        // vrij (sync uit)
  bus.doe('track.2.nudge.voor', true);
  bus.doe('track.2.sync', true);                // koppelen tijdens het drukken
  zet(1.5); bus.doe('track.2.nudge.voor', false);
  zet(3);
  assert.equal(e.track(2).sync, true);
  assert.equal(e.track(2).gekoppeld, true);
});

test('K2c: sync uit tijdens een nudge op een gekoppelde track, dan loslaten: vrij, niet opnieuw gekoppeld', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);                // start de klok, gekoppeld
  zet(1); bus.doe('track.1.nudge.voor', true);
  bus.doe('track.1.sync', true);                // sync uit
  zet(1.5); bus.doe('track.1.nudge.voor', false);
  assert.equal(e.track(1).sync, false);
  assert.equal(e.track(1).gekoppeld, false);
});

test('K2d: nudge vast, een nummer zonder grid laden, spelen, loslaten: geen uitzondering', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);
  zet(1); bus.doe('track.1.nudge.terug', true);
  bus.doe('track.1.play', true); zet(1.1);      // pauze
  await e.laad(1, nummer(0, 0, { grid: null }));
  bus.doe('track.1.play', true);
  assert.doesNotThrow(() => bus.doe('track.1.nudge.terug', false));
});

test('K3: de klok stoppen terwijl een track op de maat wacht: geen uitzondering', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124)); await e.laad(2, nummer(128));
  bus.doe('track.1.play', true);
  zet(1); bus.doe('track.1.play', true);        // pauze: er speelt niets
  zet(2); bus.doe('track.2.play.quant', true);  // 2 wacht op de "1" (speelt dus niet)
  assert.doesNotThrow(() => bus.doe('klok.stop', true));
});

test('K3b: de klok stoppen binnen een paar ms na pauze: geen uitzondering', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);
  zet(1); bus.doe('track.1.play', true);        // pauze gaat in op straks(), nu speelt hij nog
  assert.doesNotThrow(() => bus.doe('klok.stop', true));
});

test('K4a: de pitchfader op de stand van de klok grijpt meteen (geen afronding die hem dood laat)', async () => {
  const { e, bus, nummer } = await klein();
  await e.laad(2, nummer(104.8257675790228, 0.48448462582644397));
  bus.doe('track.2.play', true);                // klok start op dit nummer, fader op 0,5
  bus.doe('track.2.pitch', 0.8659316613338888);
  const verwacht = 104.8257675790228 * (1 + (0.8659316613338888 - 0.5) * 0.32);
  assert.ok(Math.abs(e.klok.bpm(e.straks()) - verwacht) < 1e-6, `klok ${e.klok.bpm(e.straks())}, verwacht ${verwacht}`);
});

test('K4b: na starten op de maat geldt soft-takeover: de eerste pitchbeweging laat het tempo niet springen', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(158.30385689390823)); await e.laad(2, nummer(154.7201836318709, 0.08));
  bus.doe('track.2.play', true);                // klok op 154,72
  bus.doe('track.1.play.quant', true);
  zet(3.6);                                     // 1 speelt gekoppeld op 154,72 (rate 0,977), fader nog op 0,5
  const voor = e.klok.bpm(e.straks());
  bus.doe('track.1.pitch', 0.52);               // een klein stukje omhoog: nog niet langs de stand van de klok (0,43)
  assert.ok(Math.abs(e.klok.bpm(e.straks()) - voor) < 1e-6, `klok ${voor} -> ${e.klok.bpm(e.straks())}`);
});

test('K4c: de klok-tempoknop verandert het tempo; daarna grijpt een pitchfader pas als hij erlangs komt', async () => {
  const { e, bus, nummer } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);
  bus.doe('track.1.pitch', 0.5);                // gegrepen
  bus.doe('klok.tempo', (130 - 40) / 260);      // klok naar 130 met de tempoknop
  bus.doe('track.1.pitch', 0.51);               // fader een haar omhoog (de stand van 130 is 0,65)
  assert.ok(Math.abs(e.klok.bpm(e.straks()) - 130) < 1e-6, `klok ${e.klok.bpm(e.straks())}`);
});

test('K5: de klok verandert terwijl een track op de maat wacht: hij begint nog op de "1" en op zijn startpunt', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124)); await e.laad(2, nummer(128, 0.25));
  bus.doe('track.1.play', true);
  zet(2.37);
  bus.doe('track.2.seek', 0.25 / 300);
  bus.doe('track.2.play.quant', true);
  bus.doe('klok.tempo', (100 - 40) / 260);      // voor de start: klok naar 100
  const ts = e.track(2).wacht;
  zet(ts + 0.5);
  const t = e.track(2);
  assert.ok(Math.abs(e.klok.inMaat(e.klok.tel(ts))) < 1e-6, `start op klok-tel ${e.klok.tel(ts)} (niet op een "1")`);
  assert.ok(Math.abs(t.plek(ts) - 0.25) < 1e-6, `begint op ${t.plek(ts)} in plaats van 0,25`);
});

test('K6: koppeling.segmenten: het laatste stuk krijgt de rate van zijn eigen stuk, niet van een halve seconde later', async () => {
  const { Klok } = await import('../src/kern/klok.js');
  const { segmenten, plekOp } = await import('../src/kern/koppeling.js');
  const klok = new Klok();
  klok.start(0, 0, 90);
  klok.houd(1.2, 280);                          // een knik net na het venster [1, 1.1)
  const grid = new Beatgrid({ stukken: [{ van: 0, bpm: 90, anker: 0 }] });
  const segs = segmenten(klok, grid, 0, 1, 1.1);
  const t = 1.09;
  let s = segs[0]; for (const x of segs) if (x.T <= t) s = x;
  const motor = s.P + (t - s.T) * s.R;
  assert.ok(Math.abs(motor - plekOp(klok, grid, 0, t)) < 1e-9, `motor ${motor}, juist ${plekOp(klok, grid, 0, t)}`);
});

test('K7: de motor krijgt de exacte rate (geen numerieke afgeleide): ≤ 1e-10 tel na 8 s op plek 330 s', async () => {
  const { Klok } = await import('../src/kern/klok.js');
  const { segmenten } = await import('../src/kern/koppeling.js');
  const klok = new Klok();
  klok.start(0, 0, 169.78869595564902);
  const grid = new Beatgrid({ stukken: [{ van: 0, bpm: 169.78869595564902, anker: 0.33652358906268437 }] });
  const v = 930;                                // plek ~330 s
  const [s] = segmenten(klok, grid, v, 0, 8);
  const d = grid.beatAt(s.P + 8 * s.R) - klok.tel(8) - v;
  assert.ok(Math.abs(d) <= 1e-10, `afwijking ${d} tel`);
});

test('K8: laden op een track die gekoppeld speelt (nummer zonder grid): het laden lukt, zonder uitzondering', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);
  zet(1);
  const gelukt = await e.laad(1, nummer(0, 0, { grid: null }));
  assert.equal(gelukt, true);
  assert.equal(e.track(1).grid, null);
});

test('K8b: laden op een gekoppelde track: alles van het vorige nummer vervalt meteen (besluit 1)', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);
  zet(10);
  const nu = e.ctx.currentTime;
  assert.equal(e.track(1).speeltOp(nu + 0.001), true);
  await e.laad(1, nummer(90, 0.3));
  const t = e.track(1);
  for (const d of [0, 0.001, 0.004, 0.1, 5]) {
    assert.equal(t.speeltOp(nu + d), false, `speelt op nu + ${d}`);
    assert.equal(t.plek(nu + d), 0, `plek op nu + ${d}`);
  }
  assert.ok(t.speler.segs.length > 0);
  for (const x of t.speler.segs) {
    assert.equal(x.speelt, false, `motor-segment op ${x.T} speelt`);
    assert.equal(x.P, 0, `motor-segment op ${x.T} staat op ${x.P}`);
  }
  assert.equal(t.sync, true, 'sync (de knop) blijft over een laad heen staan');
  assert.equal(t.pitch, 0.5);
  assert.equal(t.bend, 0);
});

test('K9: "klok naar dit nummer" terwijl de klok er al op ligt: segmenten blijven oplopend', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(131.56632233411074));
  bus.doe('track.1.play', true);                // klok start op dit nummer
  bus.doe('track.1.sync', true);                // sync uit: vrij, precies op de klok-lijn
  zet(0.013346452419331828);
  bus.doe('track.1.sync.klok', true);
  const segs = e.track(1).speler.segs;
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i].T >= segs[i - 1].T, `segment ${i} op ${segs[i].T} na ${segs[i - 1].T}`);
});

test('klok-S11 + klok-B07: starten op de maat vanaf een startpunt midden in de maat legt de "1" van het nummer op een "1" van de klok', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124)); await e.laad(2, nummer(124, 0));
  bus.doe('track.1.play', true);
  zet(1);
  bus.doe('track.2.seek', (60 / 124) / 300);    // startpunt op tel 2 van de maat
  bus.doe('track.2.play.quant', true);
  zet(e.track(2).wacht + 1);
  const t = e.track(2);
  const een = e.klok.tijd(e.klok.volgendeMaat(e.klok.tel(e.ctx.currentTime)));
  assert.ok(t.grid.isMaatbegin(Math.round(t.grid.beatAt(t.plek(een)))), 'op de "1" van de klok klinkt geen "1" van het nummer');
});

// ---- afwijkingen engine ↔ ontwerp die M11 vond (K10–K18, hersteld 19 okt) ---------------------------

/** De plek van track n vlak voor en vlak na zijn (eerste) geplande koppeling na het glijden. */
const rondGlijden = (t) => {
  const g = t.vakken.find((v) => v.naGlijden);
  return g ? { klaar: g.van, links: t.plek(g.van - 1e-9), rechts: t.plek(g.van + 1e-9) } : null;
};

test('K10: de klok verandert tijdens "klok naar dit nummer": de track wordt aan het eind gekoppeld zonder sprong', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124)); await e.laad(2, nummer(132, 0.05));
  bus.doe('track.1.play', true);                // klok op 124, 1 gekoppeld
  zet(1); bus.doe('track.2.play', true);        // 2 vrij op 132 (sync uit)
  zet(2); bus.doe('track.2.sync.klok', true);   // klok glijdt naar 2; 2 wordt straks gekoppeld
  bus.doe('klok.tempo', (100 - 40) / 260);      // meteen daarna: klok naar 100
  const r = rondGlijden(e.track(2));
  assert.ok(r, 'er is een geplande koppeling');
  assert.ok(Math.abs(r.links - r.rechts) < 1e-6, `op ${r.klaar} springt de plek van ${r.links} naar ${r.rechts}`);
});

test('K11a: sync uit tijdens een nudge, dan loslaten: vrij op het tempo van vóór de bend (besluit 4)', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);                // klok start op 1: gekoppeld, snelheid 1
  zet(1); bus.doe('track.1.nudge.voor', true);  // 4% sneller
  bus.doe('track.1.sync', true);                // sync uit (de knop blijft ingedrukt)
  zet(1.5); bus.doe('track.1.nudge.voor', false);
  assert.ok(Math.abs(e.track(1).snelheid(e.straks()) - 1) < 1e-9, `snelheid ${e.track(1).snelheid(e.straks())}, verwacht 1`);
});

test('K11b: "klok naar dit nummer" tijdens een nudge, dan loslaten: gekoppeld op de plek van nu (besluit 4)', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);
  zet(1); bus.doe('track.1.nudge.voor', true);  // vrij op 1,04
  bus.doe('track.1.sync.klok', true);           // klok glijdt naar de lijn van wat je hoort
  bus.doe('track.1.nudge.voor', false);         // loslaten met sync aan
  assert.equal(e.track(1).gekoppeld, true);
});

test('K12: soft-takeover grijpt alleen als de fader langs de stand van de klok komt (tolerantie 1e-6, niet 0,01)', async () => {
  const { e, bus, nummer } = await klein();
  await e.laad(1, nummer(124));
  bus.doe('track.1.play', true);                // klok op 124, fader op 0,5
  bus.doe('klok.tempo', (123 - 40) / 260);      // klok naar 123: de stand van de fader is nu 0,4748
  bus.doe('track.1.pitch', 0.48);               // een stukje omlaag, nog niet erlangs
  assert.ok(Math.abs(e.klok.bpm(e.straks()) - 123) < 1e-6, `klok ${e.klok.bpm(e.straks())}, verwacht 123`);
});

test('K13: een gekoppeld nummer komt in een stuk met een ander tempo: de pitchfader laat de klok niet springen', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(120, 0, { stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 10, bpm: 90, anker: 10 }] }));
  bus.doe('track.1.play', true);                // klok op 120, fader op 0,5 (gegrepen)
  zet(12);                                      // het nummer speelt nu het stuk op 90 (rate 1,33)
  bus.doe('track.1.pitch', 0.49);               // de stand van de klok is 1,54 (buiten de fader)
  assert.ok(Math.abs(e.klok.bpm(e.straks()) - 120) < 1e-6, `klok ${e.klok.bpm(e.straks())}, verwacht 120`);
});

test('K14: twee keer "klok naar dit nummer" tijdens het glijden: geen sprong', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(2, nummer(164, 0.35));
  bus.doe('klok.tempo', (120 - 40) / 260);      // de klok loopt op 120
  bus.doe('track.2.play', true);                // vrij op 164 (sync uit)
  zet(0.5); bus.doe('track.2.sync.klok', true);
  const t = e.track(2), A = e.straks();
  const voor = [0, 0.05, 0.2, 0.5, 2].map((d) => t.plek(A + d));
  bus.doe('track.2.sync.klok', true);           // nog eens, tijdens het glijden
  const na = [0, 0.05, 0.2, 0.5, 2].map((d) => t.plek(A + d));
  for (let i = 0; i < voor.length; i++) assert.ok(Math.abs(voor[i] - na[i]) < 1e-9, `plek ${voor[i]} -> ${na[i]}`);
});

test('K15: jog op een track met een geplande start terwijl de klok stilstaat: hij start niet, de klok ook niet', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124)); await e.laad(2, nummer(124));
  bus.doe('track.1.play', true);                // klok start op 1
  zet(0.5); bus.doe('track.2.play.quant', true); // 2 wacht op de "1"
  bus.doe('track.2.sync', true);                // sync uit: 2 start op dat moment vrij (besluit 3)
  bus.doe('track.1.play', true);                // 1 pauze
  zet(0.6);
  assert.equal(bus.doe('klok.stop', true)?.geweigerd, undefined, 'de klok mag stoppen');
  bus.doe('track.2.jog', 0.5 + 1 / 8);
  assert.equal(e.klok.loopt, false, 'een jog zette de klok aan');
  assert.equal(e.track(2).speelt, false, 'een jog liet de track spelen');
});

test('K16: seek tijdens "klok naar dit nummer" naar een onzeker stuk: geen koppeling daar, vrij en sync uit', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(125, 0, { stukken: [{ van: 0, bpm: 125, anker: 0 }, { van: 60, bpm: 126, anker: 60.2, zekerheid: 0.3 }] }));
  await e.laad(2, nummer(72));
  bus.doe('track.2.play', true);                // klok op 72
  bus.doe('track.1.play', true);                // 1 vrij op 125
  bus.doe('track.1.sync.klok', true);           // klok glijdt naar 1
  bus.doe('track.1.seek', 140 / 300);           // naar het onzekere stuk
  zet(5);
  assert.equal(e.track(1).gekoppeld, false, 'gekoppeld op een onzeker stuk');
  assert.equal(e.track(1).sync, false);
});

test('K17: seek van een gekoppelde track naar een onzeker stuk zet de pitchfader zoals sync uit', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(1, nummer(124));
  await e.laad(2, nummer(130, 0, { stukken: [{ van: 0, bpm: 130, anker: 0 }, { van: 100, bpm: 130, anker: 100, zekerheid: 0.2 }] }));
  bus.doe('track.1.play', true);                // klok op 124
  bus.doe('track.2.sync', true);                // sync aan (stil)
  bus.doe('track.2.play', true);                // gekoppeld: rate 124/130
  zet(1); bus.doe('track.2.seek', 200 / 300);   // onzeker: vrij, sync uit
  const R = e.track(2).snelheid(e.straks());
  bus.doe('track.2.play', true); zet(1.1); bus.doe('track.2.play', true);   // pauze, play
  assert.ok(Math.abs(e.track(2).snelheid(e.straks()) - R) < 1e-9, `na play ${e.track(2).snelheid(e.straks())}, voor de pauze ${R}`);
});

test('K18: in de overgangstel van een tempokaart is de stand van de pitchfader die van bpm × pitch, niet van de snelheid', async () => {
  const { e, bus, nummer, zet } = await klein();
  await e.laad(2, nummer(120));
  // Stuk 2 (70 bpm) begint op 10,2 s; de overgangstel loopt van 10,0 tot 10,49 (0,49 s, stuk 1 zegt 0,5, stuk 2 0,857).
  await e.laad(1, nummer(120, 0, { stukken: [{ van: 0, bpm: 120, anker: 0 }, { van: 10.2, bpm: 70, anker: 10.49 }] }));
  bus.doe('track.2.play', true);                // klok op 120
  bus.doe('track.1.play.quant', true);          // 1 begint op de volgende "1", gekoppeld
  const t = e.track(1);
  while (!(t.gekoppeld && t.plek(e.straks()) > 10.25)) zet(e.ctx.currentTime + 0.01);
  assert.ok(t.plek(e.straks()) < 10.45, `plek ${t.plek(e.straks())}`);
  // Snelheid 2 × 0,49 = 0,98: "stand" 0,4375 volgens de snelheid; 2,73 volgens 70 bpm × pitch = 120.
  bus.doe('track.1.pitch', 0.43);
  assert.ok(Math.abs(e.klok.bpm(e.straks()) - 120) < 1e-6, `klok ${e.klok.bpm(e.straks())}, verwacht 120`);
});
