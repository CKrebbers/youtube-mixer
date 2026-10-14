/**
 * De uitlijnweergave, het rekenwerk (werkruimte S2, docs/werkruimte/S2.md,
 * docs/WERKRUIMTE.md A7 en D4 "S2"). Clay, 13 okt, punt 4: "alle tracks
 * tegelijk zien lopen (grid en tracks), om ze gelijk te laten lopen".
 *
 * PUUR: geen DOM, geen Web Audio, geen imports uit ui/, control/ of server/
 * (regels.test.mjs). Alleen de pure rekenmodules van de engine. Zo draait
 * dezelfde code in het werkvak, in het losse venster (uitlijn.html) en straks
 * op de iPad, die alleen segmenten van buiten en een eigen klok heeft.
 *
 * DE INVOER is één object `{ decks, maatgever, V, nu }`:
 *   decks      [{ id, nr, titel, grid (Beatgrid of zijn JSON), tijdlijn
 *               (Deck.tijdlijn(): { segId, gridVersie, T, P, R, loop, rem,
 *               vorig, speelt, wacht, rate }), duur, tellen (Float64Array, de
 *               gevonden tellen in tracktijd), klappen (Float64Array, de
 *               onsets), inhoud (getal: verandert als peaks/tellen/klappen
 *               veranderen) }]
 *   maatgever  het id van de maatgever (de track waarin de as telt), of null
 *   V          de uitgangsvertraging in seconden (hoorbaar.js)
 *   nu         de audioklok (ctx.currentTime, of op de iPad zijn eigen klok
 *              plus het klokverschil)
 * `invoerVanEngine(engine)` maakt hem uit de mixer.
 *
 * DE AS staat in TELLEN VAN DE MAATGEVER ZOALS JE HEM HOORT (regel 3: alles
 * uit de audioklok en de segmenten, geen eigen teller). Een x op de as is een
 * telnummer b van de maatgever; de klok op die x is
 *     c(b) = nu + (b − b_nu) × Lc
 * met b_nu = beatAt(wat je NU van de maatgever hoort) en Lc de hoorbare
 * tellengte van de maatgever op de klok (tel / R). Wat je op die klok van
 * track i hoort is
 *     pos = positieIn(tijdlijn_i, c(b) − V)
 * Dat is "positie − V × rate" (hoorbaar.js), maar dan precies: in een loop
 * vouwt hij goed (geen sprong als de loop rondgaat), een track die op de
 * maat WACHT staat stil op zijn startpunt tot hij invalt (en valt dan in op
 * de "1" waar hij invalt), een rem remt, en een geplande sprong met keylock
 * speelt `vorig` tot hij ingaat.
 *
 * Een track is per stuk (`stukken`) een rechte lijn van (x0, p0) naar (x1, p1)
 * in (tel van de maatgever, tracktijd): een loop knipt hem op de naad, een
 * wachtende track begint met een stuk zonder tracktijd. Gridlijnen, gevonden
 * tellen en klappen gaan zo van tracktijd naar x. Een track die STIL staat
 * (pauze) wordt getekend alsof hij nu zou starten, vastgemaakt aan de
 * speelkop (`soort: 'stil'`): zo zie je ook in pauze waar zijn tellen vallen.
 *
 * DE GETALLEN per track (`getallen`): grid Δ (zoals engine.faseVerschil, op
 * wat je hoort), muziek Δ (`faseTussen`: de gevonden tellen van de track
 * tegen die van de maatgever), drift (ms per 16 tellen), maat (tellen naast
 * de "1"), en een waarschuwing als het grid naast zijn muziek ligt
 * (`afwijkingBij`). Teken: + = de track loopt VOOR op de maatgever.
 *
 * DE SLEUTEL (`sleutel`): wat er op een baan staat verandert alleen met een
 * nieuw segment (van de track of van de maatgever), een andere gridversie,
 * een andere pagina, breedte of zoom, of nieuwe inhoud. Geen JSON.stringify
 * van een grid per beeld.
 */

import { positieIn, positieOp } from '../engine/stream-kern.js';
import { Beatgrid } from '../engine/beatgrid.js';
import { afwijkingBij, DRIFT } from '../engine/tellen.js';
import { uitgangsVertraging } from '../engine/hoorbaar.js';

/** Kleurgrenzen (ms): groen eronder, dan geel, daarboven rood (WERKRUIMTE.md A7). */
export const GROEN_MS = 3;
export const GEEL_MS = 10;
/** Zoveel gehoorde tellen telt muziek Δ (de mediaan). */
export const MUZIEK_TELLEN = 8;
/** Minder paren dan dit: geen muziek Δ. */
const MUZIEK_MIN = 4;
/** De vouw: zoveel gehoorde tellen (acht maten). */
export const VOUW_TELLEN = 32;
/** Drift: in ms per zoveel tellen van de maatgever. */
export const DRIFT_TELLEN = 16;
/** Een rem is geen rechte lijn: in zoveel stukjes. */
const REM_STUKJES = 24;
/** Hooguit zoveel stukken per baan (een loop van 1/32 tel over twee maten is er 256). */
const MAX_STUKKEN = 512;
/** Klappen zonder tellen: zo grof is muziek Δ dan (Beatgrid RAAK_KLAP, docs/BEATGRID.md). */
export const GROF_MS = 15;

/** groen · geel · rood, of null zonder getal. */
export function kleurVan(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const a = Math.abs(ms);
  return a < GROEN_MS ? 'groen' : a < GEEL_MS ? 'geel' : 'rood';
}

const gridCache = new WeakMap();
/** Een Beatgrid, ook als hij als JSON binnenkwam (de iPad): één keer bouwen per object. */
export function alsGrid(g) {
  if (!g) return null;
  if (typeof g.beatAt === 'function') return g;
  let b = gridCache.get(g);
  if (!b) { b = new Beatgrid(g); gridCache.set(g, b); }
  return b;
}

const mod = (a, n) => ((a % n) + n) % n;
/** Vouw d (s) in [−L/2, L/2). */
const vouwTel = (d, L) => d - L * Math.floor(d / L + 0.5);

/** Wat je NU hoort van een tijdlijn (tracktijd), geklemd op de duur. Stil of wachtend: P. */
export function gehoord(tl, nu, V, duur = Infinity) {
  if (!tl) return null;
  const p = tl.speelt ? positieIn(tl, tl.vorig, nu - V) : tl.P;
  return p > duur ? duur : p;
}

/** Hoe snel de track loopt als hij speelt (tracktijd per s): het segment, anders de pitch. */
const loopSnelheid = (tl) => (tl.speelt && tl.R > 0 ? tl.R : (tl.rate > 0 ? tl.rate : 1));

/**
 * De as: { M (de maatgever-baan), g (zijn grid), bM (tel die je nu hoort),
 * Lc (s per tel op de klok), nu, V, maten, tellen (per pagina), bpb,
 * pagina (eerste tel van de pagina, een heel getal), kop (0..1 op de pagina),
 * loopt (hoor je de maatgever bewegen) }. Null zonder maatgever met grid.
 * `maten`: 1 of 2 tellen per pagina × de maat.
 */
export function maakAs(invoer, { maten = 2 } = {}) {
  const M = invoer?.decks?.find((d) => d.id === invoer.maatgever) ?? null;
  const g = alsGrid(M?.grid);
  if (!M || !g || !M.tijdlijn) return null;
  const { nu, V } = invoer;
  const tl = M.tijdlijn;
  const hM = gehoord(tl, nu, V, M.duur);
  const bM = g.beatAt(hM);
  const loopt = !!tl.speelt && nu - V >= tl.T && !(tl.rem && tl.rem.a < 0 && nu - V > tl.T - tl.R / tl.rem.a);
  const Lc = g.beatLengthAt(hM) / loopSnelheid(tl);
  const bpb = g.beatsPerBar || 4;
  const n = maten === 1 ? 1 : 2;
  const tellen = n * bpb;
  // De "1" van de maat die je hoort; bij twee maten per pagina de even maat.
  const een = Math.round(bM - g.barPhase(hM) * bpb);
  const maat = Math.floor(een / bpb);
  const pagina = n === 2 && mod(maat, 2) === 1 ? een - bpb : een;
  return { M, g, hM, bM, Lc, nu, V, maten: n, tellen, bpb, pagina, kop: (bM - pagina) / tellen, loopt };
}

/** De klok (audioklok min V, dus segmenttijd) op tel b van de as. */
const segTijd = (as, b) => as.nu + (b - as.bM) * as.Lc - as.V;
/** Andersom: de tel van de as op segmenttijd s. */
const telOp = (as, s) => as.bM + (s + as.V - as.nu) / as.Lc;

/** Eén segment over [sa, sb] (segmenttijd) als rechte stukken. */
function segStukken(seg, sa, sb, soort, as, uit) {
  if (sb <= sa || uit.length >= MAX_STUKKEN) return;
  if (!seg.speelt) { uit.push({ x0: telOp(as, sa), x1: telOp(as, sb), p0: seg.P, p1: seg.P, soort }); return; }
  const rem = seg.rem;
  if (rem && rem.a < 0) {
    // Een rem: in stukjes tot hij stilstaat, daarna stil. Een loopnaad in een stukje: dat stukje valt weg.
    const stil = seg.T - seg.R / rem.a;
    const eind = Math.min(sb, stil);
    if (eind > sa) {
      let s0 = sa, q0 = positieOp(seg, sa);
      for (let k = 1; k <= REM_STUKJES; k++) {
        const s1 = sa + (eind - sa) * k / REM_STUKJES, q1 = positieOp(seg, s1);
        if (q1 >= q0) uit.push({ x0: telOp(as, s0), x1: telOp(as, s1), p0: q0, p1: q1, soort });
        s0 = s1; q0 = q1;
      }
    }
    if (sb > stil) { const q = positieOp(seg, Math.max(sa, stil)); uit.push({ x0: telOp(as, Math.max(sa, stil)), x1: telOp(as, sb), p0: q, p1: q, soort }); }
    return;
  }
  const R = seg.R;
  if (!(R > 0)) { const q = positieOp(seg, sa); uit.push({ x0: telOp(as, sa), x1: telOp(as, sb), p0: q, p1: q, soort }); return; }
  const loop = seg.loop, len = loop ? loop.end - loop.start : 0;
  let s = sa;
  while (s < sb && uit.length < MAX_STUKKEN) {
    const q = positieOp(seg, s);
    // Tot de naad van de loop (als hij in de loop zit of erin loopt), anders tot sb.
    let tot = sb;
    if (len > 0 && q < loop.end) {
      const naar = s + (loop.end - q) / R;
      if (naar < tot) tot = naar;
    }
    const q1 = tot === sb ? positieOp(seg, sb) : loop.end;
    uit.push({ x0: telOp(as, s), x1: telOp(as, tot), p0: q, p1: q1 < q ? q : q1, soort });
    if (tot === sb) break;
    // Net over de naad: daar staat hij weer op loop.start (positieOp vouwt).
    s = tot + 1e-9;
  }
}

/**
 * De stukken van een baan over [b0, b1] (tellen van de as):
 * [{ x0, x1, p0, p1, soort }] met soort 'speelt', 'wacht' (stil tot hij
 * invalt: p0 = p1 = het startpunt) of 'stil' (pauze: getekend alsof hij nu
 * start, vast aan de speelkop). Oplopend in x.
 */
export function stukken(baan, as, b0, b1) {
  const uit = [];
  const tl = baan?.tijdlijn;
  if (!tl || !as) return uit;
  const sa = segTijd(as, b0), sb = segTijd(as, b1);
  if (!tl.speelt) {
    // Pauze: alsof hij nu start (vanaf wat je hoort, op de pitch, met zijn loop).
    const P = gehoord(tl, as.nu, as.V, baan.duur);
    const v = { T: as.nu - as.V, P, R: loopSnelheid(tl), loop: tl.loop, rem: null, speelt: true };
    // Vóór de speelkop terugrekenen: een rechte lijn (zonder vouw in de loop).
    const nu = as.nu - as.V;
    if (sa < nu) uit.push({ x0: telOp(as, sa), x1: telOp(as, Math.min(nu, sb)), p0: P + (sa - nu) * v.R, p1: P + (Math.min(nu, sb) - nu) * v.R, soort: 'stil' });
    if (sb > nu) segStukken(v, Math.max(sa, nu), sb, 'stil', as, uit);
    return uit;
  }
  let s = sa;
  if (s < tl.T) {
    const tot = Math.min(tl.T, sb);
    if (tl.vorig) segStukken({ ...tl.vorig, speelt: tl.vorig.speelt !== false }, s, tot, 'speelt', as, uit);
    else if (tl.wacht) uit.push({ x0: telOp(as, s), x1: telOp(as, tot), p0: tl.P, p1: tl.P, soort: 'wacht' });
    // Vóór het begin van het segment (een nudge, een sprong: wat er toen was weten we
    // niet meer): het segment terug doorgetrokken, een rechte lijn op R.
    else if (tl.R > 0) uit.push({ x0: telOp(as, s), x1: telOp(as, tot), p0: tl.P + (s - tl.T) * tl.R, p1: tl.P + (tot - tl.T) * tl.R, soort: 'speelt' });
    s = tot;
  }
  if (sb > s) segStukken(tl, s, sb, 'speelt', as, uit);
  return uit;
}

/** Eerste index in een gesorteerde rij met waarde ≥ x. */
function vanaf(rij, x) {
  let lo = 0, hi = rij.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (rij[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * Tracktijden (gesorteerd) naar x over de stukken: [{ x, p }] oplopend in x.
 * Alleen stukken die lopen (een wachtstuk heeft geen tracktijd).
 */
export function naarX(rij, st, max = 4096) {
  const uit = [];
  if (!rij?.length) return uit;
  for (const s of st) {
    if (!(s.p1 > s.p0)) continue;
    const schaal = (s.x1 - s.x0) / (s.p1 - s.p0);
    for (let k = vanaf(rij, s.p0); k < rij.length && rij[k] <= s.p1 && uit.length < max; k++) {
      uit.push({ x: s.x0 + (rij[k] - s.p0) * schaal, p: rij[k] });
    }
  }
  return uit;
}

/**
 * De gridlijnen van een baan op zijn EIGEN tellen: [{ x, een, p }] (een =
 * de "1" van zijn maat). Ook vóór het grid begint niets; op een wachtstuk
 * niets (die valt pas in).
 */
export function lijnen(baan, st) {
  const g = alsGrid(baan?.grid);
  const uit = [];
  if (!g) return uit;
  for (const s of st) {
    if (!(s.p1 > s.p0)) continue;
    const schaal = (s.x1 - s.x0) / (s.p1 - s.p0);
    for (const b of g.beatsBetween(s.p0, s.p1, 512)) uit.push({ x: s.x0 + (b.tijd - s.p0) * schaal, een: b.maatbegin, p: b.tijd });
  }
  return uit;
}

/** Mediaan (kopie, de rij blijft staan). */
function mediaan(xs) {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Welke tellen hoor je van een baan: de gevonden tellen, anders de klappen. */
const telBron = (baan) => (baan?.tellen?.length ? { rij: baan.tellen, grof: false } : baan?.klappen?.length ? { rij: baan.klappen, grof: true } : null);

/**
 * Muziek Δ: de mediaan (ms) van de laatste `n` gehoorde tellen van baan i
 * tegen de dichtstbijzijnde gehoorde tel van de maatgever, op de as (dus op
 * de klok zoals je ze hoort). + = de tellen van i vallen VOOR die van de
 * maatgever. Met klappen in plaats van gevonden tellen (aan een van beide
 * kanten): `grof` (± GROF_MS). Null met te weinig tellen.
 * Geeft { ms, grof, n }.
 */
export function faseTussen(i, as, { n = MUZIEK_TELLEN } = {}) {
  if (!as || !i || i.id === as.M.id) return null;
  const bi = telBron(i), bm = telBron(as.M);
  if (!bi || !bm) return null;
  const kop = as.bM;
  // Wat je van i hoorde: de laatste n tellen vóór de speelkop (ruim terug: een loop of tempo).
  const wi = naarX(bi.rij, stukken(i, as, kop - 4 * n, kop)).filter((t) => t.x <= kop).slice(-n);
  if (wi.length < MUZIEK_MIN) return null;
  const xm = naarX(bm.rij, stukken(as.M, as, wi[0].x - 1, kop + 1)).map((t) => t.x).sort((a, b) => a - b);
  if (!xm.length) return null;
  const d = [];
  for (const t of wi) {
    const k = vanaf(xm, t.x);
    let best = Infinity;
    if (k < xm.length) best = xm[k] - t.x;
    if (k > 0 && Math.abs(xm[k - 1] - t.x) < Math.abs(best)) best = xm[k - 1] - t.x;
    if (Math.abs(best) <= 0.5) d.push(best * as.Lc);
  }
  if (d.length < MUZIEK_MIN) return null;
  return { ms: mediaan(d) * 1000, grof: bi.grof || bm.grof, n: d.length };
}

/**
 * De getallen van een baan tegen de maatgever:
 *   { grid (ms, + = voor), muziek ({ ms, grof, n } of null), drift (ms per
 *     16 tellen, + = loopt uit naar voren), maat (tellen naast de "1"),
 *     afwijking ({ ms, wie: 'track' } als het grid van DEZE track naast
 *     zijn tellen ligt, anders null; de maatgever krijgt hem op zijn eigen rij), kleur: { grid, muziek, drift },
 *     bpm (hoorbaar), wacht ({ maten } tot hij invalt) }
 * Voor de maatgever zelf: alleen bpm, afwijking en `maatgever: true`.
 * `muziek: false`: zonder muziek Δ (de weergave rekent hem twee keer per tel,
 * niet elk beeld).
 */
export function getallen(baan, as, { muziek = true } = {}) {
  const g = alsGrid(baan?.grid);
  const tl = baan?.tijdlijn;
  if (!g || !tl || !as) return null;
  const h = gehoord(tl, as.nu, as.V, baan.duur);
  const rate = tl.rate > 0 ? tl.rate : 1;
  const Li = g.beatLengthAt(h) / rate;
  const uit = { bpm: 60 / Li, maatgever: baan.id === as.M.id, grid: null, muziek: null, drift: null, maat: null, afwijking: null, wacht: null, kleur: null };
  const afw = (b, wie) => {
    if (!b?.tellen?.length) return null;
    const bg = alsGrid(b.grid);
    const r = afwijkingBij(bg, b.tellen, gehoord(b.tijdlijn, as.nu, as.V, b.duur));
    // afwijkingBij rekent in tracktijd; op de klok (wat je hoort) gedeeld door de rate.
    return r && Math.abs(r.mediaan) > DRIFT ? { ms: (r.mediaan / (b.tijdlijn.rate > 0 ? b.tijdlijn.rate : 1)) * 1000, wie } : null;
  };
  uit.afwijking = afw(baan, 'track');
  if (uit.maatgever) return uit;
  // Een track die op de maat wacht: de getallen van het moment dat hij invalt.
  let hM = as.hM;
  if (tl.wacht && tl.speelt && tl.T > as.nu - as.V) {
    uit.wacht = { maten: (telOp(as, tl.T) - as.bM) / as.bpb };
    hM = gehoord(as.M.tijdlijn, tl.T + as.V, as.V, as.M.duur);
  }
  const d = vouwTel((g.phase(h) - as.g.phase(hM)) * Li, Li);
  uit.grid = d * 1000;
  const LM = as.g.beatLengthAt(as.hM) / (as.M.tijdlijn.rate > 0 ? as.M.tijdlijn.rate : 1);
  uit.drift = DRIFT_TELLEN * (LM - Li) * 1000;
  const bpb = as.bpb;
  const xi = g.barPhase(h) * (g.beatsPerBar || 4), xm = as.g.barPhase(hM) * bpb;
  let m = Math.round(xi - xm - d / Li);
  m = mod(m, bpb);
  if (m > bpb / 2) m -= bpb;
  uit.maat = m;
  uit.muziek = muziek ? faseTussen(baan, as) : null;
  uit.kleur = { grid: kleurVan(uit.grid), muziek: kleurVan(uit.muziek?.ms), drift: kleurVan(uit.drift) };
  return uit;
}

/**
 * De vouw van een baan: de laatste `n` gehoorde tellen (de gevonden tellen,
 * anders de klappen, anders zijn gridlijnen), elk als punt op zijn fase
 * tegen de maatgever, en die van de maatgever zelf als ijkpunt. Gelijk = één
 * smalle stapel, drift = een schuin spoor, een flam = twee stapels.
 * Geeft { bron: 'tellen'|'klappen'|'grid', punten: [{ ms, tel, k, wie }] }
 * met ms de afstand tot de dichtstbijzijnde tel van de as (+ = vóór), tel de
 * tel in de maat van de maatgever (1..bpb), k = 0 voor de nieuwste.
 */
export function vouw(baan, as, { n = VOUW_TELLEN } = {}) {
  if (!as || !baan) return null;
  const kop = as.bM;
  const telVanAs = (x) => {
    const b = Math.round(x);
    return as.g.telInMaat(as.g.timeOf(b) + 1e-6);
  };
  const reeks = (b, wie) => {
    const bron = telBron(b);
    const st = stukken(b, as, kop - 2 * n - 2, kop);
    const ts = bron ? naarX(bron.rij, st) : lijnen(b, st);
    const gehoorde = ts.filter((t) => t.x <= kop).slice(-n);
    return {
      bron: bron ? (bron.grof ? 'klappen' : 'tellen') : 'grid',
      punten: gehoorde.map((t, j) => ({ ms: (Math.round(t.x) - t.x) * as.Lc * 1000, tel: telVanAs(t.x), k: gehoorde.length - 1 - j, wie })),
    };
  };
  const eigen = reeks(baan, 'eigen');
  if (baan.id !== as.M.id) eigen.punten.push(...reeks(as.M, 'maatgever').punten);
  return eigen;
}

/**
 * Hoeveel stapels heeft een vouw (punten binnen `breed` ms horen bij één
 * stapel)? Voor de test en de tekst ("twee stapels: een flam").
 */
export function stapels(punten, breed = 4) {
  const ms = punten.map((p) => p.ms).sort((a, b) => a - b);
  let n = 0, vorige = -Infinity;
  for (const m of ms) { if (m - vorige > breed) n++; vorige = m; }
  return n;
}

/**
 * De zoom van de voorgetekende strook (px per s tracktijd, een macht van 2):
 * minstens zo fijn als wat er op het scherm komt, dus drawImage verkleint
 * altijd (scherp). `breedte` in apparaatpixels.
 */
export function zoomVoor(baan, as, breedte) {
  const tl = baan?.tijdlijn;
  if (!tl || !as) return 0;
  const sec = as.tellen * as.Lc * loopSnelheid(tl);   // tracktijd op één pagina
  const nodig = breedte / Math.max(1e-3, sec);
  return 2 ** Math.min(13, Math.max(4, Math.ceil(Math.log2(nodig))));
}

/**
 * De sleutel van een baan: verandert alleen met een nieuw segment (track of
 * maatgever), gridversie, pagina, breedte, zoom, inhoud of soort. Een tekst
 * van een paar getallen, nooit een grid.
 */
export function sleutel(baan, as, breedte, zoom) {
  const tl = baan?.tijdlijn;
  if (!tl || !as) return '';
  const M = as.M.tijdlijn;
  const soort = tl.speelt ? (tl.T > as.nu - as.V ? (tl.wacht ? 'w' : 'v') : 's') : 'p';
  return `${baan.id}:${tl.segId}:${tl.gridVersie}:${baan.inhoud ?? 0}|${as.M.id}:${M.segId}:${M.gridVersie}:${as.loopt ? 1 : 0}|`
    + `${as.pagina}:${as.maten}|${breedte}|${zoom}|${soort}|${Math.round(as.V * 1e4)}`;
}

/**
 * De verschuiving (tellen van de as) van wat er op een baan getekend is,
 * sinds hij getekend werd (`ref` = { kop, h } van toen): 0 als track en
 * maatgever samen lopen. Staat de maatgever stil en speelt de track, dan
 * schuift hij naar links; staat de track stil en loopt de maatgever, dan
 * schuift hij met de speelkop mee; met drift langzaam. De weergave schuift
 * met een CSS-transform en tekent pas opnieuw als het te ver wordt.
 */
export function verschuiving(baan, as, ref) {
  const tl = baan?.tijdlijn;
  if (!tl || !as || !ref) return 0;
  const h = gehoord(tl, as.nu, as.V, baan.duur);
  const loopt = tl.speelt && as.nu - as.V >= tl.T;
  const R = loopt ? loopSnelheid(tl) : 0;
  const dh = h - ref.h;
  return (as.bM - ref.kop) - (R > 0 ? dh / (R * as.Lc) : 0);
}

/** Het ijkpunt voor `verschuiving`, op het moment van tekenen. */
export function ijkpunt(baan, as) {
  return { kop: as.bM, h: gehoord(baan.tijdlijn, as.nu, as.V, baan.duur) };
}

/**
 * Alles voor één beeld: { as, banen: [{ baan, getallen }] } (geen stukken:
 * die rekent de weergave alleen als de sleutel verandert). Null-as = geen
 * maatgever.
 */
export function reken(invoer, { maten = 2 } = {}) {
  const as = maakAs(invoer, { maten });
  const banen = (invoer?.decks ?? []).map((baan) => ({ baan, getallen: as ? getallen(baan, as) : null }));
  return { as, banen };
}

// ---- uit de mixer --------------------------------------------------------

const ids = new WeakMap();
let volgId = 0;
const idVan = (o) => { if (!o || typeof o !== 'object') return 0; let i = ids.get(o); if (!i) { i = ++volgId; ids.set(o, i); } return i; };

/**
 * De invoer uit de engine van de mixer (duck-typed, alleen lezen; regel 1:
 * dit is geen engine-code en de engine weet er niets van). `analysis` =
 * staat.analysis (de peaks per deck) voor de inhoud-sleutel. Alleen tracks
 * met iets erop (een nummer); de rest staat er niet in.
 */
export function invoerVanEngine(engine, { analysis = null, vertraging } = {}) {
  const decks = [];
  const nu = engine.ctx?.currentTime ?? 0;
  Object.keys(engine.decks || {}).forEach((id, k) => {
    const d = engine.decks[id];
    if (!d?.buffer) return;
    let tl = typeof d.tijdlijn === 'function' ? d.tijdlijn() : null;
    if (!tl) {
      // De BufferBron (reserve) heeft geen segment: één uit wat het deck zegt.
      tl = { segId: 0, gridVersie: d.gridVersie ?? 0, T: nu, P: d.position, R: d.rate, loop: d.loop ?? null, rem: null, vorig: null,
        speelt: !!d.playing, wacht: !!d.wacht, remt: !!d.remt, rate: d.rate };
    }
    const peaks = analysis?.[id] ?? null;
    decks.push({ id, nr: k + 1, titel: d.title, grid: d.grid, tijdlijn: tl, duur: d.duration,
      tellen: d.tellen?.beats ?? null, klappen: d.onsets ?? null, peaks,
      inhoud: idVan(peaks) * 1e6 + idVan(d.tellen) * 1e3 + idVan(d.onsets) });
  });
  const m = typeof engine.syncMaster === 'function' ? engine.syncMaster() : null;
  const V = vertraging ?? uitgangsVertraging(engine.ctx);
  return { decks, maatgever: m?.id ?? null, V, nu };
}
