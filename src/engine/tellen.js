/**
 * TELLEN (docs/BEATGRID.md §11, 6 okt): van gevonden tellen naar een
 * tempokaart, en meten hoe goed een grid op die tellen valt. De tellen komen
 * van Beat This! (een neurale beat- en downbeatdetector, server/tellen/).
 * Puur rekenwerk, geen DOM, geen Web Audio: de server maakt er het
 * automatische grid mee, het scherm meet en bewaakt er live mee.
 *
 * Clay (6 okt): "ik wil er eigenlijk altijd zeker van zijn dat het klopt".
 * Daarom is ZEKER hier een METING, geen schatting:
 *   - het grid valt op de gevonden tellen: per stuk het deel van de tellen
 *     binnen RAAK van een gridlijn, en de systematische afwijking (de mediaan
 *     over blokken van VENSTER tellen, zie meetGrid);
 *   - en een tweede, onafhankelijke analyse (de oude, op de onset-envelope)
 *     zegt hetzelfde (vergelijk). Zijn ze het oneens, dan is het stuk
 *     onzeker, met de reden erbij, tot jij het controleert. Half of dubbel
 *     tempo telt als eens (een notitie: het octaaf), niet als fout.
 *
 * NAUWKEURIGHEID (gemeten 6 okt): Beat This! rekent in frames van 20 ms; met
 * het zwaartepunt van de piek erbij ligt een losse tel op vaste muziek
 * mediaan ~5 ms en in 95% binnen ~20-30 ms van een rechte lijn. Eén tel zegt
 * dus weinig; een lijn door veel tellen ligt op een paar ms. Daarom meten we
 * de afwijking per blok tellen, niet per tel, en is RAAK ruim.
 *
 * Gemeten op Clay's library (6 okt, 11 nummers): het oude grid zat er vaak
 * een octaaf naast (154 waar Beat This! 77 hoort), de "1" klopte bijna nooit
 * (geen downbeat-detectie), en waar het grid met de hand gezet was, viel 80%
 * van de gevonden tellen erop.
 */

import { Beatgrid, ZEKER_VANAF, GEEN_PULS, TWIJFELS, MIN_BPM, MAX_BPM } from './beatgrid.js';

/** Een tel valt "raak" als hij hooguit zo ver van een gridlijn ligt (s): de ruis van de detector. */
export const RAAK = 0.025;
/** Zoveel tellen samen geven één meting van de systematische afwijking. */
export const VENSTER = 16;
/**
 * Een grid ligt systematisch naast de tellen als de mediaan van een blok
 * verder weg ligt dan dit (s). Op een vinylmix (jungle, 6 okt) lagen de
 * blokken van een goed gevolgd stuk binnen ±5 ms, met uitschieters tot 12
 * waar de DJ bijstuurde; ruis van de detector over 16 tellen is ~2 ms.
 */
export const DRIFT = 0.012;
/** Zo kort mag een stuk met een eigen tempo zijn (tellen); korter = rubato of een overgang. */
export const MIN_TELLEN = 8;
/**
 * De versie van de methode; de server maakt grids van een oudere versie
 * opnieuw (alleen automatische: nooit op slot of met de hand, wilTellenGrid
 * in server/index.js). 2 (14 okt): het DJ-tempo (dansOctaven), het begin van
 * een stuk na extra tellen (beginPeriode), een tempo dat het oude rooster
 * kruist (staartKnip), tellen boven 300 bpm (MIN_L). Bij het opstarten
 * rekent de server zo elk automatisch grid uit de tellen opnieuw, zonder
 * GPU: gridUitTellen + vergelijk zijn milliseconden, maar de TWEEDE MENING
 * (de oude analyse, maakGrid met ffmpeg) kost 0,7-4 s per nummer van drie
 * minuten (gemeten 14 okt) zolang hij niet bewaard is (tweede-mening.json,
 * server/tellen.js; sinds review ronde 1). Die wacht zolang er een deck
 * speelt (gridsUitTellen in server/index.js). Een volgende VERSIE met een
 * bewaarde tweede mening: milliseconden.
 */
export const VERSIE = 2;

/** Verder dan dit (deel van een tel) van het rooster: deze tel hoort er niet bij. */
const LOS = 0.25;
/** Zoveel losse tellen achter elkaar: hier begint iets anders (tempo- of fasesprong). */
const LOS_ACHTEREEN = 3;
/** Tijdens het opbouwen: zoveel tellen samen bepalen of het tempo wegloopt, en vanaf hoeveel (s). */
const BREEK_VENSTER = 8;
const BREEK = 0.010;
/** Geen tel voor zoveel perioden: het stuk stopt (een volgend stuk op hetzelfde rooster plakt er weer aan). */
const GAT_PERIODEN = 2.6;
/**
 * Pas een gat van zoveel seconden (en minstens GEEN_PULS_TELLEN tellen)
 * zonder tellen is "geen puls". Korter is een break: de muziek stopt even, de
 * puls loopt door, en het stuk ervoor loopt door tot het volgende begint.
 */
const GEEN_PULS_S = 4;
const GEEN_PULS_TELLEN = 6;
/**
 * Het bereik van een tel (s) waarin de tellen een stuk kunnen vormen: 500 tot
 * 30 bpm. Sneller dan 300 (MAX_BPM) gebeurt als Beat This! de achtsten telt;
 * vroeger was alles onder 0,2 s "geen puls" en verloor jungle op 344 zijn hele
 * grid (benchmark 14 okt). Het DJ-tempo (dansOctaven) brengt het daarna terug.
 */
const MIN_L = 0.12, MAX_L = 2;
/** Tweede mening: tempo's binnen zoveel (log2, ~4%) zijn hetzelfde octaaf. */
const OCTAAF_MARGE = 0.057;
/**
 * Tweede mening: per blok van zoveel tellen de fase. Vanaf FASE_STABIEL
 * samenhang binnen een blok en FASE_SAMEN tussen de blokken is de ander
 * stabiel. Ligt hij dan meer dan FASE_ANDERE_TEL (deel van een tel van de
 * fijnste) naast de tellen, dan kiest hij een andere tel. Minder is een
 * grover grid: de oude analyse lag op Loving arms 35-60 ms (0,1-0,15 tel)
 * naast een band zonder klik, dat is onnauwkeurig, geen tegenspraak.
 */
const FASE_BLOK = 16;
const FASE_STABIEL = 0.6;
const FASE_SAMEN = 0.8;
const FASE_ANDERE_TEL = 0.3;
/** Een twijfel zet de zekerheid hieronder: sync en beat-loops weigeren tot je het controleert. */
const ONZEKER = Math.round((ZEKER_VANAF - 0.05) * 1000) / 1000;

const mediaan = (xs) => {
  if (!xs.length) return NaN;
  const s = Array.from(xs).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const rond = (x, n = 1000) => Math.round(x * n) / n;

/**
 * Kleinste kwadraten t ≈ a + k·L, bij te houden tel voor tel. Rekent ten
 * opzichte van het eerste punt (k0, t0): bij duizenden tellen van een uur
 * lang blijven de sommen zo klein genoeg om niets te verliezen.
 */
class Lijn {
  constructor(k0, t0) { this.k0 = k0; this.t0 = t0; this.n = 0; this.sk = 0; this.st = 0; this.skk = 0; this.skt = 0; this.stt = 0; }
  voeg(k, t, w = 1) {
    const x = k - this.k0, y = t - this.t0;
    this.n += w; this.sk += w * x; this.st += w * y; this.skk += w * x * x; this.skt += w * x * y; this.stt += w * y * y;
  }
  haalWeg(k, t) { this.voeg(k, t, -1); }
  /** Som van de kwadraten van wat de lijn mist (s²). */
  get rest() {
    const { n, sk, st, skk, skt, stt } = this;
    if (n < 3) return 0;
    const xx = skk - sk * sk / n, xy = skt - sk * st / n, yy = stt - st * st / n;
    return xx > 1e-9 ? Math.max(0, yy - xy * xy / xx) : 0;
  }
  /** { a, L }: tel k ligt op a + k·L. Null met te weinig punten. */
  get() {
    const { n, sk, st, skk, skt } = this;
    const d = n * skk - sk * sk;
    if (n < 2 || Math.abs(d) < 1e-9) return null;
    const L = (n * skt - sk * st) / d;
    const b = (st - L * sk) / n;                  // y = b + L·x
    return { a: this.t0 + b - L * this.k0, L };
  }
  static door(punten) {
    const l = new Lijn(punten[0].k, punten[0].t);
    for (const p of punten) l.voeg(p.k, p.t);
    return l.get();
  }
}

/**
 * Waar het tempo wisselde: het punt c (in de laatste 4 × BREEK_VENSTER tellen)
 * waar een lijn door punten[0..c) plus een lijn door punten[c..] het minst
 * missen. Minstens twee punten links.
 */
function knip(punten) {
  const n = punten.length;
  const kop = new Lijn(punten[0].k, punten[0].t);
  for (const p of punten) kop.voeg(p.k, p.t);
  const staart = new Lijn(punten[n - 1].k, punten[n - 1].t);
  let beste = n - BREEK_VENSTER, minst = Infinity;
  for (let c = n - 1; c >= Math.max(2, n - 4 * BREEK_VENSTER); c--) {
    kop.haalWeg(punten[c].k, punten[c].t);
    staart.voeg(punten[c].k, punten[c].t);
    if (n - c < 3) continue;
    const r = kop.rest + staart.rest;
    if (r < minst) { minst = r; beste = c; }
  }
  return Math.max(1, beste);
}

/**
 * De periode waarmee een stuk begint (s), uit de eerstvolgende tellen. De
 * mediaan van de afstanden ging mis met twee extra tellen op een rij (een
 * snare op de achtsten, benchmark van 14 okt: 124 werd 164): nu wint de
 * kandidaat (een afstand, de som van twee, of de periode van het vorige
 * stuk) waarop de volgende BEGIN_TELLEN tellen het best passen: plekken met
 * een tel, min de helft van de lege plekken (anders wint de halve periode
 * zodra er één extra tel bij zit); bij gelijke stand de grootste, en de
 * periode van het vorige stuk als die even goed past (na een gat loopt het
 * tempo meestal door).
 */
const BEGIN_TELLEN = 12;
/** Het beste rooster vanaf tel i: { L, score, treffers } (zie beginPeriode). */
function besteRooster(B, i, vorigeL) {
  const eind = Math.min(B.length, i + BEGIN_TELLEN + 1);
  if (eind - i < 3) return null;
  const kand = [];
  for (let j = i + 1; j < Math.min(eind, i + 9); j++) {
    kand.push(B[j] - B[j - 1]);
    if (j + 1 < eind) kand.push(B[j + 1] - B[j - 1]);
  }
  if (vorigeL) kand.push(vorigeL);
  let beste = null;
  for (const L of kand) {
    if (!(L > MIN_L && L < MAX_L)) continue;
    // Plekken op het rooster met een tel, min de helft van de lege plekken:
    // de halve periode vangt ook de extra tellen op de offbeat, maar laat dan
    // de helft van zijn plekken leeg.
    const raak = new Set();
    for (let j = i + 1; j < eind; j++) {
      const x = (B[j] - B[i]) / L;
      if (Math.abs(x - Math.round(x)) <= LOS) raak.add(Math.round(x));
    }
    const plekken = Math.round((B[eind - 1] - B[i]) / L);
    const score = raak.size - 0.5 * Math.max(0, plekken - raak.size) + (L === vorigeL ? 0.25 : 0);
    if (!beste || score > beste.score + 1e-9 || (Math.abs(score - beste.score) < 1e-9 && L > beste.L)) {
      beste = { L, score, treffers: raak.size, n: eind - i - 1, eind };
    }
  }
  return beste;
}
function beginPeriode(B, i, vorigeL = null) {
  const r = besteRooster(B, i, vorigeL);
  // Valt minder dan de helft van de tellen op het beste rooster, of past het
  // vanaf de VOLGENDE tel duidelijk beter, dan is deze tel zelf los (een extra
  // tel tussen twee echte): hier begint niets.
  if (!r || r.treffers < Math.max(3, 0.5 * r.n)) return NaN;
  const zonder = besteRooster(B, i + 1, vorigeL);
  if (zonder && zonder.score > r.score + 2) return NaN;
  // Verfijnen: de mediaan van de afstanden die bij deze periode horen (een veelvoud dichtbij).
  const bij = [];
  for (let j = i + 1; j < r.eind; j++) {
    const d = B[j] - B[j - 1], m = Math.round(d / r.L);
    if (m >= 1 && Math.abs(d / m - r.L) <= LOS * r.L / m) bij.push(d / m);
  }
  return bij.length >= 2 ? mediaan(bij) : r.L;
}

/**
 * Hoort het eind van een stuk eigenlijk bij iets anders? De plek c (zoals
 * knip) waar twee lijnen het best passen, als de tellen vanaf c meer dan
 * STAART_FOUT naast de lijn van de rest liggen én samen een ander tempo
 * hebben (> 1%): dan een index om af te knippen, anders null. Ruis van de
 * detector (σ ≤ 10 ms) haalt STAART_FOUT niet.
 */
const STAART_FOUT = 0.02;
function staartKnip(punten) {
  const n = punten.length;
  if (n < MIN_TELLEN + 3) return null;
  const c = knip(punten);
  if (c < MIN_TELLEN || n - c < 3 || n - c > 4 * BREEK_VENSTER) return null;
  const kop = Lijn.door(punten.slice(0, c)), staart = Lijn.door(punten.slice(c));
  if (!kop || !staart) return null;
  const fout = Math.sqrt(punten.slice(c).reduce((s, p) => s + (p.t - (kop.a + p.k * kop.L)) ** 2, 0) / (n - c));
  return fout > STAART_FOUT && Math.abs(staart.L / kop.L - 1) > 0.01 ? c : null;
}

/**
 * Stukken met één tempo die de tellen volgen. Begin bij een tel, geef elke
 * volgende tel zijn nummer op het rooster tot nu toe (een overgeslagen tel is
 * zo een gat, geen tempowissel) en voorspel waar hij hoort. Het stuk stopt
 * waar de voorspelling systematisch misloopt (de mediaan van de laatste
 * BREEK_VENSTER tellen ligt verder dan BREEK weg: het tempo verschuift), waar
 * LOS_ACHTEREEN tellen achter elkaar niet op het rooster vallen (een sprong),
 * of bij een gat. Een losse tel ernaast (een dubbele detectie) telt niet mee.
 * @returns {{ a: number, L: number, punten: {k:number,t:number,i:number}[], los: number, eerste: number, laatste: number }[]}
 */
function segmenteer(B) {
  const segs = [];
  let i = 0;
  while (i < B.length - 1) {
    // Een beginperiode uit de eerstvolgende tellen; geen regelmaat = hier geen puls.
    const L0 = beginPeriode(B, i, segs.length ? segs[segs.length - 1].L : null);
    if (!(L0 > MIN_L && L0 < MAX_L)) { i++; continue; }
    const lijn = new Lijn(0, B[i]);
    lijn.voeg(0, B[i]);
    let a = B[i], L = L0;
    const punten = [{ k: 0, t: B[i], i, e: 0 }];
    const recent = [];
    let los = 0, eersteLos = -1, losTotaal = 0, eind = B.length;
    for (let j = i + 1; j < B.length; j++) {
      const t = B[j];
      const vorige = punten[punten.length - 1];
      if (t - vorige.t > GAT_PERIODEN * L) { eind = los ? eersteLos : j; break; }
      const k = Math.round((t - a) / L);
      const e = t - (a + k * L);
      if (k <= vorige.k || Math.abs(e) > LOS * L) {
        if (los++ === 0) eersteLos = j;
        if (los >= LOS_ACHTEREEN) {
          eind = eersteLos;
          // Een nieuw tempo dat het oude rooster KRUIST (124 -> 131 in een
          // mix): de eerste tellen ervan vielen nog net binnen LOS, met een
          // fout die per tel 26 ms verschuift, door nul heen, dus de mediaan
          // bleef klein. Die horen bij wat volgt, niet bij dit stuk.
          const c = staartKnip(punten);
          if (c !== null) { eind = punten[c].i; punten.length = c; }
          break;
        }
        continue;
      }
      losTotaal += los; los = 0;
      punten.push({ k, t, i: j, e });
      recent.push(e);
      if (recent.length > BREEK_VENSTER) recent.shift();
      if (recent.length === BREEK_VENSTER) {
        const m = mediaan(recent);
        if (Math.abs(m) > BREEK) {
          // Het tempo loopt weg. Knip waar het begon: de eerste tellen na een
          // wissel passen vaak nog net op het oude rooster (een iets sneller
          // tempo haalt het in), dus kies het punt waar twee rechte lijnen
          // samen het best passen. De rest begint opnieuw.
          const c = knip(punten);
          eind = punten[c].i;
          punten.length = c;
          break;
        }
      }
      lijn.voeg(k, t);
      // Pas met een handvol tellen is de lijn beter dan de beginperiode.
      if (punten.length >= 4) ({ a, L } = lijn.get());
    }
    const f = punten.length >= 2 ? Lijn.door(punten) : { a: B[i], L: L0 };
    segs.push({ a: f.a, L: f.L, punten, los: losTotaal, eerste: punten[0].t, laatste: punten[punten.length - 1].t });
    i = Math.max(i + 1, eind);
  }
  return segs;
}

/** Past deze lijn op deze tellen: geen tel los, en geen blok van BREEK_VENSTER dat er systematisch naast ligt? */
function pastOp(punten, f) {
  const e = punten.map((p) => p.t - (f.a + p.k * f.L));
  if (e.some((x) => Math.abs(x) > LOS * f.L)) return false;
  for (let i = 0; i + BREEK_VENSTER <= e.length; i += BREEK_VENSTER >> 1) {
    if (Math.abs(mediaan(e.slice(i, i + BREEK_VENSTER))) > BREEK) return false;
  }
  return true;
}

/**
 * Buren op hetzelfde rooster weer aan elkaar: een break (een paar tellen
 * zonder klap), een losse misser of een vals alarm van de knip splitst een
 * stuk dat eigenlijk doorloopt. Plakt alleen als één lijn door allebei net
 * zo goed past als twee: dan loopt de puls door, ook over een stilte heen.
 */
function plak(segs) {
  const uit = [];
  for (const s of segs) {
    const v = uit[uit.length - 1];
    if (v && v.punten.length >= MIN_TELLEN && s.punten.length >= MIN_TELLEN) {
      const erbij = s.punten.map((p) => ({ k: Math.round((p.t - v.a) / v.L), t: p.t, i: p.i }));
      if (erbij[0].k > v.punten[v.punten.length - 1].k) {
        const alle = [...v.punten, ...erbij];
        const f = Lijn.door(alle);
        if (f && pastOp(alle, f)) {
          Object.assign(v, { a: f.a, L: f.L, punten: alle, los: v.los + s.los, laatste: s.laatste });
          continue;
        }
      }
    }
    uit.push(s);
  }
  return uit;
}

/**
 * De "1" van een stuk uit de downbeats: per downbeat zijn telnummer op het
 * rooster van het stuk, modulo de maat; de meest gekozen fase wint.
 * @returns {{ maat: number, stem: number, n: number }} maat = tracktijd van een tel 1, stem = deel van de downbeats dat het eens is
 */
function maatVan(seg, D, perMaat) {
  const telling = new Array(perMaat).fill(0);
  let n = 0;
  for (const d of D) {
    if (d < seg.eerste - seg.L / 2 || d > seg.laatste + seg.L / 2) continue;
    const k = Math.round((d - seg.a) / seg.L);
    if (Math.abs(d - (seg.a + k * seg.L)) > LOS * seg.L) continue;
    telling[((k % perMaat) + perMaat) % perMaat]++;
    n++;
  }
  let beste = 0;
  for (let f = 1; f < perMaat; f++) if (telling[f] > telling[beste]) beste = f;
  // De eerste tel van het stuk met die fase (op of na het begin).
  let k = Math.round((seg.eerste - seg.a) / seg.L);
  while (((k % perMaat) + perMaat) % perMaat !== beste) k++;
  return { maat: seg.a + k * seg.L, stem: n ? telling[beste] / n : 0, n };
}

/**
 * Tellen per maat ZOALS BEAT THIS! TELT: hoeveel van zijn tellen er tussen
 * twee downbeats liggen (2, 3, 4, 6 of 8; anders 4). Telt het netwerk het
 * dubbele tempo, dan zijn het er 8 (of 6 in een wals); het grid zelf krijgt
 * zijn maat pas na het DJ-tempo (maatNa).
 */
function tellenPerMaat(B, D) {
  const per = [];
  let j = 0;
  for (let i = 1; i < D.length; i++) {
    while (j < B.length && B[j] <= D[i - 1] + 0.03) j++;
    let n = 1;
    for (let m = j; m < B.length && B[m] < D[i] - 0.03; m++) n++;
    if (n >= 2 && n <= 8) per.push(n);
  }
  const m = Math.round(mediaan(per));
  return [2, 3, 4, 6, 8].includes(m) ? m : 4;
}

/** De maat van het grid als Beat This! `per` tellen per maat telt en het tempo met `f` vermenigvuldigd wordt: 3 of 4. */
function maatNa(per, f) {
  const p = per * f;
  if (p === 3 || p === 4) return p;
  return per === 3 || per === 6 ? 3 : 4;
}

// ---- het DJ-tempo --------------------------------------------------------------

/**
 * HET DANSBEREIK (14 okt, docs/BEATGRID.md §12): Beat This! kiest zelf welk
 * octaaf het telt, en dat is vaak niet wat een DJ telt: 77 waar Clay 153
 * tikt (Ciel), 75 waar de oude analyse 150 hoorde (het album), 86 voor
 * jungle op 172, 70 voor half-time op 140. Een tempo onder DANS_MIN wordt
 * verdubbeld, boven DANS_MAX gehalveerd. Gekozen voor Clay's repertoire:
 * house ~124 en techno 140 blijven staan, jungle/dnb 160-178 ook, en alles
 * wat Beat This! als halve tel hoort (75-88) komt in het bereik waar je het
 * mixt. Wat ermee verloren gaat: een nummer dat écht op 70-87 telt
 * (reggae, downtempo, trip-hop) krijgt het dubbele (een loop van 4 tellen is
 * dan 2 van de jouwe; ×2/½ in grid-modus zet het terug, en dat is een
 * bewerking met de hand: de analyse komt er nooit meer overheen).
 * Hiphop rond 90-100 blijft staan.
 */
export const DANS_MIN = 88;
export const DANS_MAX = 180;
/** Hoe ver een stuk buiten het bereik mag om bij het tempo van de rest van het nummer te blijven. */
const DANS_RUIM_MIN = DANS_MIN * 0.9, DANS_RUIM_MAX = DANS_MAX * 1.1;

/** De macht van twee die `bpm` in het dansbereik brengt. */
export function dansFactor(bpm) {
  if (!(bpm > 0)) return 1;
  let f = 1;
  while (bpm * f < DANS_MIN) f *= 2;
  while (bpm * f > DANS_MAX) f /= 2;
  return f;
}

/**
 * Het DJ-tempo van het nummer: per stuk zijn tempo × een macht van twee, zo
 * dicht mogelijk bij het tempo van het NUMMER (zodat een nummer dat op 89
 * begint en op 87 eindigt niet halverwege naar 174 springt, en een stuk waar
 * Beat This! even het halve tempo hoort bij de rest blijft).
 * Het tempo van het nummer: het octaaf waarin de meeste tellen in het bereik
 * vallen; hoort meer dan een vijfde van het nummer (in dezelfde puls) het
 * hogere octaaf, dan dat (Beat This! hoort vaker de halve tel dan de dubbele).
 * Halveren alleen als het MOET: boven MAX_BPM (300) telt het netwerk de
 * achtsten. Daaronder blijft het tempo van het netwerk staan, ook boven
 * DANS_MAX (review ronde 1, 14 okt: jungle, dnb en hardcore op 181-300 die
 * Beat This! goed telt werden gehalveerd en onzeker). Telt het netwerk daar
 * toch het dubbele, dan halveert pas vergelijk(), als de tweede mening het
 * halve tempo hoort in de fase van de downbeats (gridUitTellen: `halveer`).
 * Een wals (3 per maat) wordt niet verdubbeld: die tel je in zijn tel.
 * @param {{ bpm: number, gewicht: number }[]} delen
 * @param {number} per  tellen per maat van Beat This!
 * @returns {number[]} de factor per deel
 */
export function dansOctaven(delen, per = 4) {
  if (!delen.length) return [];
  const toegestaan = (d, f) => {
    if (f > 1 && (per === 3) && d.bpm * f / 2 >= MIN_BPM) return false;
    if (f < 1 && d.bpm * f * 2 <= MAX_BPM) return false;
    return d.bpm * f >= MIN_BPM && d.bpm * f <= MAX_BPM;
  };
  // Wat het bereik zegt, per deel (zonder halveren als het niet moet).
  const eigen = delen.map((d) => {
    let f = dansFactor(d.bpm);
    while (f < 1 && !toegestaan(d, f)) f *= 2;
    while (f > 1 && !toegestaan(d, f)) f /= 2;
    return f;
  });
  // Het tempo van het nummer: per puls (tempo gevouwen op een octaaf) het meeste gewicht.
  const vouw = (bpm) => { let x = Math.log2(bpm / DANS_MIN); return x - Math.floor(x); };
  const totaal = delen.reduce((s, d) => s + d.gewicht, 0) || 1;
  let besteKlas = null;
  for (const d of delen) {
    const v = vouw(d.bpm);
    const bij = delen.filter((e) => Math.min(Math.abs(vouw(e.bpm) - v), 1 - Math.abs(vouw(e.bpm) - v)) < 0.03);
    const g = bij.reduce((s, e) => s + e.gewicht, 0);
    if (!besteKlas || g > besteKlas.g) besteKlas = { g, bij };
  }
  const tempo = new Map();
  for (const e of besteKlas.bij) {
    const t = Math.round(Math.log2(e.bpm * eigen[delen.indexOf(e)]) * 1000);
    tempo.set(t, (tempo.get(t) ?? 0) + e.gewicht);
  }
  const octaven = [...tempo.entries()].sort((a, b) => a[0] - b[0]);
  // De octaven van deze puls samen: hoger wint als het meer dan een vijfde van het nummer is.
  const klassen = [];
  for (const [t, g] of octaven) {
    const k = klassen.find((x) => Math.abs(x.t - t) < 500);
    if (k) { k.g += g; } else klassen.push({ t, g });
  }
  klassen.sort((a, b) => b.t - a.t);
  const hoog = klassen.find((k) => k.g >= 0.2 * totaal) ?? klassen.sort((a, b) => b.g - a.g)[0];
  const doel = 2 ** (hoog.t / 1000);
  // Alleen naar het tempo van het nummer als het daar ook echt bij hoort
  // (binnen DANS_BIJ): een eigen stuk op 95 in een mix op 175 blijft 95 (190
  // lag "dichter bij" en werd het, review 14 okt); anders wat het bereik zegt.
  return delen.map((d, i) => {
    let beste = eigen[i], afstand = DANS_BIJ;
    for (const f of [0.25, 0.5, 1, 2, 4]) {
      const b = d.bpm * f;
      if (b < DANS_RUIM_MIN || b > DANS_RUIM_MAX || !toegestaan(d, f)) continue;
      const a = Math.abs(Math.log2(b / doel));
      if (a < afstand - 1e-9) { afstand = a; beste = f; }
    }
    return beste;
  });
}
/** Zo dicht (log2: 6%, de tempogrens van de auto-DJ) moet een stuk bij het tempo van het nummer liggen om zijn octaaf te volgen. */
const DANS_BIJ = Math.log2(1.06);

/**
 * Een tempokaart uit gevonden tellen en downbeats (tracktijden, s).
 * Stukken { van, bpm, anker, maat, zekerheid, twijfel? }: de zekerheid is
 * GEMETEN (meetGrid op het grid zelf): het deel van de tellen dat raak valt,
 * onder ZEKER_VANAF als het grid ergens systematisch naast de tellen ligt
 * ('drift') of het tempo beweegt ('rubato'). Waar geen puls is: een stuk met
 * zekerheid 0 dat het rooster van zijn buur doortrekt (sync en beat-loops
 * weigeren daar). vergelijk() kan de zekerheid daarna nog omlaag halen, en
 * een GEHALVEERD stuk (twijfel 'tel', `halvering`, alleen boven MAX_BPM) alleen
 * zij weer zeker maken. Een stuk boven DANS_MAX met downbeats krijgt een
 * voorstel `halveer` ({ bpm, anker, raak }); alleen vergelijk() voert het uit
 * (en haalt het weg). De library bewaart geen van beide.
 * @param {ArrayLike<number>} beats
 * @param {ArrayLike<number>} [downbeats]
 * @param {{ duur?: number|null }} [opties]
 */
export function gridUitTellen(beats, downbeats = [], { duur = null } = {}) {
  const B = Array.from(beats).filter(Number.isFinite).sort((a, b) => a - b);
  const D = Array.from(downbeats).filter(Number.isFinite).sort((a, b) => a - b);
  const perBT = tellenPerMaat(B, D);
  const leeg = () => ({ stukken: [{ van: 0, bpm: 120, anker: 0, zekerheid: 0, twijfel: 'geen puls' }], beatsPerBar: maatNa(perBT, 1), methode: 'tellen', versie: VERSIE });
  if (B.length < MIN_TELLEN) return leeg();

  // Korte stukken naast elkaar: rubato of een overgang. Samen één stuk dat
  // de tellen niet goed volgt (en dat zegt), in plaats van tien stukjes.
  const groepen = [];
  for (const s of plak(segmenteer(B))) {
    const kort = s.punten.length < MIN_TELLEN;
    const vorige = groepen[groepen.length - 1];
    if (kort && vorige?.kort && s.eerste - vorige.laatste < GAT_PERIODEN * Math.max(s.L, vorige.L)) {
      vorige.segs.push(s); vorige.laatste = s.laatste;
    } else groepen.push({ kort, segs: [s], eerste: s.eerste, laatste: s.laatste, L: s.L });
  }

  const delen = [];
  for (const g of groepen) {
    let seg = g.segs[0];
    let rubato = false;
    if (g.kort) {
      // Eén lijn door alle tellen van de groep, met hun eigen telnummers.
      const B2 = B.filter((b) => b >= g.eerste - 1e-9 && b <= g.laatste + 1e-9);
      // Een paar tellen zonder buren (een losse klap, een fill) is geen rubato: dat is geen puls.
      if (B2.length < MIN_TELLEN) continue;
      const L = mediaan(B2.slice(1).map((b, i) => b - B2[i]));
      const punten = [{ k: 0, t: B2[0] }];
      for (let i = 1; i < B2.length; i++) punten.push({ k: punten[i - 1].k + Math.max(1, Math.round((B2[i] - B2[i - 1]) / L)), t: B2[i] });
      const f = Lijn.door(punten);
      if (!f) continue;
      seg = { a: f.a, L: f.L, punten, eerste: g.eerste, laatste: g.laatste };
      rubato = true;
    }
    if (!(seg.L > MIN_L && seg.L < MAX_L)) continue;
    delen.push({ seg, rubato });
  }
  if (!delen.length) return leeg();

  // De stukken; een gat tussen twee delen (of aan het begin of eind) is geen puls.
  const stukken = [];
  const extra = new Map();
  const geenPuls = (van, buur) => {
    const s = { van, bpm: buur.bpm, anker: buur.anker, maat: buur.maat, zekerheid: 0, twijfel: 'geen puls' };
    extra.set(s, { geen: true, buur });
    return s;
  };
  delen.forEach(({ seg, rubato }, n) => {
    const L = seg.L;
    const anker = seg.a + Math.round((seg.eerste - seg.a) / L) * L;
    const { maat, stem, n: nDown } = maatVan(seg, D, perBT);
    const vorige = n ? delen[n - 1].seg : null;
    if (vorige && seg.eerste - vorige.laatste > Math.max(GEEN_PULS_S, GEEN_PULS_TELLEN * Math.max(L, vorige.L))) {
      stukken.push(geenPuls(vorige.laatste + vorige.L / 2, stukken[stukken.length - 1]));
    }
    const stuk = { van: seg.eerste - L / 2, bpm: 60 / L, anker, maat };
    // Halveren kan alleen als de downbeats zeggen welke tel de tel is.
    extra.set(stuk, { rubato, maatTwijfel: nDown >= 4 && stem < 0.6, gewicht: seg.punten.length, kanHalveren: nDown >= 4 && stem >= 0.6 });
    stukken.push(stuk);
  });
  // Het begin: het eerste stuk geldt ook ervoor, tenzij er lang niets is.
  const eerste = delen[0].seg;
  if (eerste.eerste > Math.max(GEEN_PULS_S, GEEN_PULS_TELLEN * eerste.L)) stukken.unshift(geenPuls(0, stukken[0]));
  else stukken[0].van = 0;
  const laatste = delen[delen.length - 1].seg;
  if (duur && duur - laatste.laatste > Math.max(GEEN_PULS_S, GEEN_PULS_TELLEN * laatste.L)) {
    stukken.push(geenPuls(laatste.laatste + laatste.L / 2, stukken[stukken.length - 1]));
  }

  // Het DJ-tempo (dansOctaven): ×2 houdt anker en "1" (elke tel van het
  // netwerk blijft een lijn); ½ houdt de tellen die op de "1" vallen.
  const echte = stukken.filter((st) => !extra.get(st).geen);
  const factoren = dansOctaven(echte.map((st) => ({ bpm: st.bpm, gewicht: extra.get(st).gewicht })), perBT);
  const halfVanaf = (st, L2) => st.maat + Math.ceil((st.anker - st.maat) / L2 - 1e-9) * L2;
  echte.forEach((st, i) => {
    const f = factoren[i];
    const x = extra.get(st);
    x.f = f;
    // Boven het dansbereik maar onder MAX_BPM: het tempo van het netwerk blijft
    // staan (echte 181-300). Een VOORSTEL om te halveren, op de tellen die op de
    // "1" vallen, alleen als de downbeats het eens zijn EN om de 8 (of 6) tellen
    // van het netwerk vallen: twee maten van 4 (3) per maat, dus het netwerk
    // telt het dubbele. Bij echte 186 vallen ze om de 4; daar zei de oude
    // analyse op 93, met een "1" een tel te laat, toevallig hetzelfde, en werd
    // 186 93 (vast-186/eenfout). Alleen vergelijk() voert het uit, als de
    // tweede mening het halve tempo in die fase hoort (review ronde 1, 14 okt).
    if (f === 1 && x.kanHalveren && (perBT === 8 || perBT === 6) && st.bpm > DANS_MAX && st.bpm / 2 >= MIN_BPM) {
      x.voorstel = { bpm: st.bpm / 2, anker: halfVanaf(st, 120 / st.bpm) };
    }
    if (f === 1) return;
    st.bpm *= f;
    if (f < 1) {
      st.anker = halfVanaf(st, 60 / st.bpm);
      x.half = true;
    }
  });
  for (const st of stukken) {
    const x = extra.get(st);
    if (!x.geen) continue;
    let b = x.buur;
    while (extra.get(b)?.geen) b = extra.get(b).buur;
    Object.assign(st, { bpm: b.bpm, anker: b.anker, maat: b.maat });
  }
  // De maat van het grid: die van het zwaarste stuk na zijn factor.
  const zwaarste = echte.reduce((a, b) => (extra.get(b).gewicht > extra.get(a).gewicht ? b : a), echte[0]);
  const beatsPerBar = maatNa(perBT, extra.get(zwaarste).f);

  // Meten op het grid zelf: zo is de zekerheid wat er op het scherm staat.
  const grid = new Beatgrid({ stukken: stukken.map(({ van, bpm, anker, maat }) => ({ van, bpm, anker, maat })), beatsPerBar });
  const meting = meetGrid(grid, B);
  // En het grid met de voorstellen uitgevoerd: zo weet vergelijk() hoe raak het gehalveerde stuk is.
  const voorstellen = stukken.some((s) => extra.get(s)?.voorstel);
  const metingHalf = voorstellen ? meetGrid(new Beatgrid({
    stukken: stukken.map((s) => ({ van: s.van, maat: s.maat, ...(extra.get(s)?.voorstel ?? { bpm: s.bpm, anker: s.anker }) })), beatsPerBar,
  }), B) : null;
  stukken.forEach((s, i) => {
    const x = extra.get(s);
    if (!x || x.geen) return;
    const m = meting.stukken[i];
    s.zekerheid = m.raak != null ? rond(m.raak) : 0;
    if (x.rubato) { s.twijfel = 'rubato'; s.zekerheid = Math.min(s.zekerheid, ONZEKER); }
    else if (m.afwijking != null && m.afwijking > DRIFT) { s.twijfel = 'drift'; s.zekerheid = Math.min(s.zekerheid, ONZEKER); }
    else if (x.half) {
      // GEHALVEERD (review 14 okt): de tellen liggen om en om op de tel en de
      // halve tel, dus ZIJ zeggen niet welke van de twee de tel is; dat deden
      // de downbeats (of, zonder, de eerste tel: een gok). Raak meten ze
      // allebei (fijner). Zeker pas als een tweede mening de fase bevestigt
      // (vergelijk, grid tegen grid); tot dan onzeker met de reden 'tel'.
      s.halvering = { raak: s.zekerheid, downbeats: x.kanHalveren, maatTwijfel: x.maatTwijfel };
      s.twijfel = 'tel';
      s.zekerheid = Math.min(s.zekerheid, ONZEKER);
    } else if (x.maatTwijfel) s.twijfel = 'maat';
    if (s.zekerheid < ZEKER_VANAF && !s.twijfel) s.twijfel = 'los';
    // Het voorstel alleen voor een stuk dat zelf in orde is (anders is halveren geen verbetering).
    // (Een voorstel heeft downbeats die het eens zijn, dus nooit twijfel 'maat'.)
    if (x.voorstel && !s.twijfel) {
      const mh = metingHalf.stukken[i];
      s.halveer = { bpm: rond(x.voorstel.bpm, 1e4), anker: rond(x.voorstel.anker, 1e5), raak: mh.raak != null ? rond(mh.raak) : 0 };
    }
  });
  // Getallen netjes (de JSON staat in de library): 0,1 ms voor tijden, 1e-4 voor bpm.
  for (const s of stukken) { s.van = rond(s.van, 1e4); s.anker = rond(s.anker, 1e5); s.maat = rond(s.maat, 1e5); s.bpm = rond(s.bpm, 1e4); }
  return { stukken, beatsPerBar, methode: 'tellen', versie: VERSIE };
}

/**
 * Liggen deze tellen (gesorteerd) om en om op de tel en de halve tel van een
 * grid met tellen van L s? Dan telt het netwerk het dubbele tempo (en halveerde
 * het DJ-tempo het grid). Niet hetzelfde als een grid dat een halve tel naast
 * ligt: daar liggen de tellen een HELE tel uit elkaar, allemaal op de halve.
 * Ook niet een stuk met een fasesprong: daar liggen ze per blok op één plek.
 * En de lijnen moeten de MEERDERHEID dragen (review 14 okt): telt Beat This!
 * maar in een deel van het stuk ook de achtsten, dan liggen bij een grid dat
 * een halve tel naast ligt de meeste tellen op de halve lijnen; vouwen maakte
 * dat 100% raak. Bij een goed grid liggen alle echte tellen op de lijnen en
 * alleen de extra's op de helften; telt het netwerk overal dubbel, dan is het
 * gelijk op (en zeggen de tellen niet welke van de twee de tel is: dat is
 * waarom een gehalveerd stuk een tweede mening nodig heeft, vergelijk).
 * `grid`: om de lijnen te vinden (timeOf/beatAt); `L`: de tel daar (s).
 */
function fijner(bs, L, grid) {
  if (bs.length < MIN_TELLEN) return false;
  let half = 0;
  for (let j = 1; j < bs.length; j++) if (Math.abs((bs[j] - bs[j - 1]) / L - 0.5) <= 0.12) half++;
  if (half < 0.3 * (bs.length - 1)) return false;
  let opLijn = 0, opHelft = 0;
  for (const b of bs) {
    if (Math.abs(b - grid.timeOf(Math.round(grid.beatAt(b)))) <= L / 4) opLijn++; else opHelft++;
  }
  return opLijn >= LIJN_MEERDERHEID * opHelft;
}
/** Zoveel keer de tellen op de halve lijnen moeten er minstens op de lijnen liggen om te vouwen (ruis bij "gelijk op"). */
const LIJN_MEERDERHEID = 0.8;
/** Een fout op de halve tel (bij tellen die fijner zijn dan het grid) naar de halve lijn. */
const vouwHalf = (e, L, fijn) => (fijn && Math.abs(e) > L / 4 ? e - Math.sign(e) * L / 2 : e);

/**
 * Hoe goed valt een grid op de tellen? Per stuk van het grid:
 *   n         hoeveel gevonden tellen er in vallen;
 *   raak      het deel binnen RAAK van een gridlijn;
 *   mediaan   de mediane afwijking (s; + = de tel komt na de lijn), over de tellen die bij een lijn horen;
 *   afwijking de grootste |mediaan| van een blok van VENSTER tellen (s):
 *             het grid ligt hier systematisch naast (drift, verkeerde fase);
 *   offbeat   het deel dat precies tussen twee lijnen valt (een halve tel verkeerd);
 *   een       met downbeats: het deel daarvan dat op een "1" van het grid valt.
 * `grid`: een Beatgrid. `beats`/`downbeats`: gesorteerde tracktijden.
 */
export function meetGrid(grid, beats, downbeats = null) {
  const per = grid.stukken.map((s) => ({ van: s.van, n: 0, raakN: 0, offN: 0, fouten: [], eenN: 0, eenOk: 0 }));
  const tot = { n: 0, raakN: 0, offN: 0, fouten: [], eenN: 0, eenOk: 0 };
  // Telt Beat This! in een stuk het dubbele van het grid (het DJ-tempo halveerde), dan horen
  // de tellen op de halve tel erbij (fijner): per stuk eerst kijken, dan meten.
  const perStuk = grid.stukken.map(() => []);
  for (const b of beats) perStuk[grid.stukIndex(b)].push(b);
  const fijn = perStuk.map((bs, i) => fijner(bs, 60 / grid.stukken[i].bpm, grid));
  for (const b of beats) {
    const k = Math.round(grid.beatAt(b));
    const L = 60 / grid.bpmAt(b);
    const i = grid.stukIndex(b);
    const e = vouwHalf(b - grid.timeOf(k), L, fijn[i]);
    const p = per[i];
    for (const x of [p, tot]) {
      x.n++;
      if (Math.abs(e) <= RAAK) x.raakN++;
      if (Math.abs(Math.abs(e / L) - 0.5) < 0.15) x.offN++;
      if (Math.abs(e) <= LOS * L) x.fouten.push(e);
    }
  }
  if (downbeats) {
    for (const d of downbeats) {
      const k = Math.round(grid.beatAt(d));
      if (Math.abs(d - grid.timeOf(k)) > 2 * RAAK) continue;
      const p = per[grid.stukIndex(d)];
      const een = grid.isMaatbegin(k);
      for (const x of [p, tot]) { x.eenN++; if (een) x.eenOk++; }
    }
  }
  const blokAfwijking = (f) => {
    if (f.length < MIN_TELLEN) return null;
    let max = 0;
    for (let i = 0; i === 0 || i + VENSTER <= f.length; i += VENSTER >> 1) {
      const m = Math.abs(mediaan(f.slice(i, i + VENSTER)));
      if (m > max) max = m;
    }
    return max;
  };
  const af = (x) => ({
    n: x.n,
    raak: x.n ? x.raakN / x.n : null,
    mediaan: x.fouten.length ? mediaan(x.fouten) : null,
    afwijking: blokAfwijking(x.fouten),
    offbeat: x.n ? x.offN / x.n : null,
    een: x.eenN ? x.eenOk / x.eenN : null,
  });
  // fijn: Beat This! telt hier het dubbele (de tellen op de halve tel tellen mee als raak), dus de tellen
  // zeggen niet welke van de twee de tel is (oordeelStuk zegt het erbij).
  const stukken = per.map((x, i) => ({ van: x.van, ...af(x), ...(fijn[i] ? { fijn: true } : {}) }));
  // Het totaal: de grootste afwijking van alle stukken (over een grens heen meten mengt twee roosters).
  const totaal = af(tot);
  const afw = stukken.map((s) => s.afwijking).filter((x) => x !== null);
  totaal.afwijking = afw.length ? Math.max(...afw) : null;
  return { totaal, stukken };
}

/**
 * Wijkt het grid HIER af? De mediane afwijking (s) van de laatste `n` tellen
 * vóór t (binnen 20 s), en welk deel daarvan raak is. Voor de bewaking
 * tijdens het spelen: een binaire zoektocht en `n` keer rekenen, geen
 * analyse. Null zonder genoeg tellen in de buurt.
 * `beats` gesorteerd (Float64Array of array).
 */
export function afwijkingBij(grid, beats, t, n = VENSTER) {
  if (!beats?.length || beats[0] > t) return null;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (beats[m] <= t) lo = m; else hi = m - 1; }
  const hier = [];
  for (let i = lo; i >= 0 && hier.length < n && t - beats[i] < 20; i--) hier.push(beats[i]);
  if (hier.length < Math.min(MIN_TELLEN, n)) return null;
  hier.reverse();
  const L = 60 / grid.bpmAt(t), fijn = fijner(hier, L, grid);
  const fouten = [];
  let raak = 0;
  for (const b of hier) {
    const e = vouwHalf(b - grid.timeOf(Math.round(grid.beatAt(b))), L, fijn);
    fouten.push(e);
    if (Math.abs(e) <= RAAK) raak++;
  }
  return { mediaan: mediaan(fouten), raak: raak / fouten.length, n: fouten.length };
}

/**
 * Zegt een tweede analyse (`ander`, een Beatgrid) hetzelfde als de tellen,
 * stuk voor stuk van `kaart` (de JSON van gridUitTellen)? Oneens betekent:
 * allebei zeker van hun zaak, en toch iets anders. Dus:
 *   - het tempo: de verhouding moet 1, 2 of ½ zijn (OCTAAF: dubbel of half
 *     telt als eens en wordt genoteerd); 3/2 of iets anders is oneens;
 *   - de fase: waar vallen de gevonden tellen in de tel van de ander (bij ½:
 *     in de halve tel)? Per blok van FASE_BLOK tellen een gemiddelde fase;
 *     liggen die blokken allemaal op dezelfde plek maar niet op 0, dan kiest
 *     de ander een andere tel (de offbeat): oneens. Draait de fase van blok
 *     tot blok, dan volgt de ander een tempo dat beweegt minder fijn (een
 *     grover grid dat langzaam langs de tellen schuift, geen tegenspraak):
 *     geen stem.
 * Een stuk waar de ander zelf niet zeker was, of met te weinig tellen, stemt
 * ook niet. Oneens: `twijfel: 'oneens'` en een zekerheid onder ZEKER_VANAF.
 * Een gehalveerd stuk gaat anders: grid tegen grid (bevestigHalvering).
 * Verandert `kaart` en geeft hem terug.
 */
export function vergelijk(kaart, beats, ander) {
  if (!ander) return kaart;
  kaart.stukken.forEach((st, i) => {
    const voorstel = st.halveer;
    delete st.halveer;
    if (st.twijfel === 'geen puls') return;
    const van = st.van, tot = i + 1 < kaart.stukken.length ? kaart.stukken[i + 1].van : Infinity;
    const hier = beats.filter((b) => b >= van && b < tot);
    if (hier.length < MIN_TELLEN) return;
    const midden = hier[hier.length >> 1];
    if (ander.zekerheidBij && ander.zekerheidBij(midden) !== 'zeker') return;   // de ander weet het hier zelf niet
    const r = Math.log2(ander.bpmAt(midden) / st.bpm);
    const octaaf = Math.abs(r) < OCTAAF_MARGE ? 1 : Math.abs(r - 1) < OCTAAF_MARGE ? 2 : Math.abs(r + 1) < OCTAAF_MARGE ? 0.5 : null;
    if (octaaf !== null && st.halvering) { bevestigHalvering(st, hier, ander, octaaf); return; }
    let oneens = octaaf === null;
    if (!oneens) {
      // Bij ½ is de ander grover: een gevonden tel valt op zijn tel of precies ertussen; tel die twee als één.
      const naast = faseTegen(ander, hier, octaaf === 0.5 ? 2 : 1);
      oneens = naast !== null && naast > FASE_ANDERE_TEL;
    }
    if (!oneens) {
      if (octaaf !== 1) st.octaaf = octaaf;
      if (voorstel && octaaf === 0.5) voerHalverenUit(st, hier, ander, voorstel);
      return;
    }
    // Rubato zegt al genoeg (dan is een tweede mening geen nieuws).
    if (st.twijfel !== 'rubato') st.twijfel = 'oneens';
    st.zekerheid = Math.min(st.zekerheid ?? 1, ONZEKER);
  });
  return kaart;
}

/**
 * Waar vallen deze tijden (gesorteerd) in de tel van de ander (× f: bij f = 2
 * in zijn halve tel)? Per blok van FASE_BLOK een gemiddelde fase. Liggen de
 * blokken samen (FASE_SAMEN), dan hoe ver naast 0, in delen van een tel van
 * de fijnste van de twee (0 .. 0,5); draait de fase van blok tot blok (de
 * ander volgt een tempo dat beweegt minder fijn) of is een blok al verspreid:
 * null, geen stem.
 */
function faseTegen(ander, tijden, f) {
  let X = 0, Y = 0, blokken = 0;
  for (let j = 0; j + MIN_TELLEN <= tijden.length; j += FASE_BLOK) {
    let x = 0, y = 0, n = 0;
    for (const b of tijden.slice(j, j + FASE_BLOK)) {
      const fase = 2 * Math.PI * f * ander.beatAt(b);
      x += Math.cos(fase); y += Math.sin(fase); n++;
    }
    const R = Math.hypot(x, y);
    if (R / n < FASE_STABIEL) continue;                     // binnen dit blok al verspreid: geen stem
    X += x / R; Y += y / R; blokken++;
  }
  if (!blokken || Math.hypot(X, Y) / blokken < FASE_SAMEN) return null;
  return Math.abs(Math.atan2(Y, X)) / (2 * Math.PI);
}

/** Bij een gehalveerd stuk: zoveel (deel van een tel) naast de ander is dezelfde tel, vanaf HALF_ANDER de andere. */
const HALF_EENS = 0.2, HALF_ANDER = 0.3;

/**
 * Een GEHALVEERD stuk (gridUitTellen, `halvering`) tegen de ander, GRID TEGEN
 * GRID: de lijnen van het stuk (niet de tellen: die liggen om en om op de tel
 * en de halve tel en heffen elkaar op) in de tel van de ander. Hoort de ander
 * hetzelfde tempo of het halve, dan zegt hij welke van de twee de tel is; het
 * dubbele (zoals de tellen) zegt niets. Zeker alleen als twee bronnen het eens
 * zijn: de downbeats van Beat This! en de ander. Zonder downbeats was de fase
 * een gok: dan kiest de ander (een halve tel opschuiven als hij de andere
 * hoort), maar het stuk blijft onzeker. Zijn downbeats en ander het oneens:
 * 'oneens'. Geen stem: blijft 'tel'.
 */
function bevestigHalvering(st, hier, ander, octaaf) {
  const h = st.halvering;
  if (octaaf === 2) { st.octaaf = 2; return; }                // de ander telt wat de tellen tellen: geen stem
  const L = 60 / st.bpm;
  const lijnen = [];
  for (let k = Math.ceil((hier[0] - st.anker) / L); st.anker + k * L <= hier[hier.length - 1]; k++) lijnen.push(st.anker + k * L);
  const naast = faseTegen(ander, lijnen, octaaf === 0.5 ? 2 : 1);
  if (naast === null || (naast > HALF_EENS && naast < HALF_ANDER)) return;
  if (octaaf !== 1) st.octaaf = octaaf;
  if (naast <= HALF_EENS) {
    if (!h.downbeats) return;                                   // één bron: de fase klopt waarschijnlijk, maar onzeker
    st.zekerheid = h.raak;
    if (h.maatTwijfel) st.twijfel = 'maat';
    else if (st.zekerheid < ZEKER_VANAF) st.twijfel = 'los';
    else delete st.twijfel;
    return;
  }
  if (h.downbeats) { st.twijfel = 'oneens'; return; }         // downbeats en de ander kiezen een andere tel
  // Zonder downbeats: de tel van de ander, een halve tel verder (de "1" schuift mee: ook een gok).
  st.anker = rond(st.anker + L / 2, 1e5);
  if (Number.isFinite(st.maat)) st.maat = rond(st.maat + L / 2, 1e5);
}
/**
 * Het VOORSTEL om te halveren (gridUitTellen, `halveer`: een stuk boven
 * DANS_MAX met downbeats die het eens zijn) als de tweede mening het halve
 * tempo hoort: de lijnen van het gehalveerde stuk (op de "1") in de tel van
 * de ander, grid tegen grid. Dezelfde tel: halveren, zeker op wat het
 * gehalveerde grid raak meet (twee bronnen eens: downbeats en de ander).
 * Anders (de andere tel, daartussen, geen stem) blijft het tempo van het
 * netwerk staan, met het octaaf genoteerd, zoals vóór 14 okt. NIET 'oneens':
 * wie gelijk heeft over het TEMPO weten we dan niet. Telt Beat This! goed
 * (echte 186) en hoort de oude analyse 93, dan kiest die zijn fase op een
 * vier-op-de-vloer willekeurig (gemeten: vast-186 lag een halve tel van de
 * downbeats), en dan werd een goed stuk onzeker. Een stuk waar de ander
 * hetzelfde tempo hoort komt hier niet: dat blijft zoals het is.
 */
function voerHalverenUit(st, hier, ander, h) {
  const L = 60 / h.bpm;
  const lijnen = [];
  for (let k = Math.ceil((hier[0] - h.anker) / L); h.anker + k * L <= hier[hier.length - 1]; k++) lijnen.push(h.anker + k * L);
  const naast = faseTegen(ander, lijnen, 1);
  if (naast === null || naast > HALF_EENS) return;
  Object.assign(st, { bpm: h.bpm, anker: h.anker, zekerheid: h.raak });
  delete st.octaaf;
  if (st.zekerheid < ZEKER_VANAF) st.twijfel = 'los';
  else delete st.twijfel;
}

// ---- een tweede mening over de "1" ----------------------------------------------

/**
 * DE "1" UIT DE LAGE BAND (15 okt, docs/BEATGRID.md §14). De "1" van een stuk
 * rust op de downbeats van Beat This! (maatVan); zit het netwerk consequent een
 * tel naast, dan merkt niets dat (benchmark: eenfout 0%), en vergelijk() toetst
 * alleen tempo en tel. Hier een tweede mening: per tel van de maat (fase 0 = de
 * "1" van het grid) hoeveel er in de lage band BIJ komt (kick, een nieuwe
 * basnoot; laagEnvelope in server/detect.js), mediaan over de maten. Ligt de
 * "1" van het grid duidelijk zwakker dan de sterkste tel (MAAT_LAAG), dan
 * `twijfel: 'maat'`: de "1" is niet zeker (oranje, controleer), het grid zelf
 * wel (sync en loops mogen, zoals bij downbeats die het onderling oneens zijn).
 * NOOIT een andere "1" kiezen: met een kick op 1 en 3 zegt de bas niet welke
 * van de twee het is, en wie de "1" verschuift op een gok maakt een goede "1"
 * stil fout.
 * Geen mening (niets veranderd): vier op de vloer (alle tellen even sterk), te
 * weinig maten (MAAT_LAAG_MATEN), geen kick of bas die boven de vloer uitkomt
 * (MAAT_LAAG_VLOER), een stuk dat al twijfelt (een sterkere reden staat er
 * dan al), of geen lage band.
 * `laag`: { env, envRate, tijdOffset } (frame f = tracktijd f / envRate + tijdOffset).
 * Verandert `kaart` en geeft hem terug.
 */
export const MAAT_LAAG = 0.6;
export const MAAT_LAAG_MATEN = 8;
export const MAAT_LAAG_VLOER = 2;
export function maatMening(kaart, laag) {
  if (!laag?.env?.length) return kaart;
  const per = kaart.beatsPerBar || 4;
  kaart.stukken.forEach((st, i) => {
    if (st.twijfel || !Number.isFinite(st.maat) || !(st.bpm > 0)) return;
    const m = maatSterkte(st, kaart.stukken[i + 1]?.van ?? Infinity, per, laag);
    // Alleen als de sterkste tel duidelijk boven de vloer uitkomt (MAAT_LAAG_VLOER × wat er tussen de
    // tellen bijkomt): zonder kick of bas (piano, a capella) zegt de lage band niets.
    if (m && m.max > MAAT_LAAG_VLOER * m.tussen && m.een < MAAT_LAAG * m.max) st.twijfel = 'maat';
  });
  return kaart;
}

/**
 * Per tel van de maat de mediaan van de lage band rond de gridlijnen van één
 * stuk: { per: [fase 0 … per−1], een (fase 0), max, maten } of null met te
 * weinig maten; `tussen` = het GEMIDDELDE van hetzelfde midden tussen twee tellen (de
 * vloer; een mediaan van iets dat de helft van de keren 0 is, zegt bij ruis niets).
 * Per lijn: hoeveel energie er BIJ komt, de energie in het
 * venster na de lijn min die in het venster ervoor (een vijfde tel, hooguit
 * 60 ms; nooit onder 0). Een kick of een nieuwe basnoot op de tel telt; een
 * bas die over de tel doorklinkt niet.
 */
export function maatSterkte(st, tot, per, laag) {
  const L = 60 / st.bpm, { env, envRate, tijdOffset = 0 } = laag;
  const eind = Math.min(tot, env.length / envRate + tijdOffset);
  const w = Math.min(0.06, 0.2 * L), nw = Math.max(1, Math.round(w * envRate));
  const fasen = Array.from({ length: per }, () => []), tussen = [];
  for (let k = Math.ceil((st.van - st.anker) / L - 1e-9); st.anker + k * L < eind; k++) {
    const t = st.anker + k * L;
    const v = Math.round((t - tijdOffset) * envRate);
    if (v - nw < 0 || v + nw > env.length) continue;
    let na = 0, voor = 0;
    for (let j = 0; j < nw; j++) { na += env[v + j]; voor += env[v - 1 - j]; }
    const fase = ((Math.round((t - st.maat) / L) % per) + per) % per;
    fasen[fase].push(Math.max(0, na - voor));
    // En midden tussen twee tellen: wat er daar bijkomt is de vloer (ruis, of een bas op de offbeat).
    const u = Math.round((t + L / 2 - tijdOffset) * envRate);
    if (u - nw >= 0 && u + nw <= env.length) {
      na = 0; voor = 0;
      for (let j = 0; j < nw; j++) { na += env[u + j]; voor += env[u - 1 - j]; }
      tussen.push(Math.max(0, na - voor));
    }
  }
  const maten = Math.min(...fasen.map((x) => x.length));
  if (maten < MAAT_LAAG_MATEN) return null;
  const med = fasen.map((x) => mediaan(x));
  return { per: med, een: med[0], max: Math.max(...med), tussen: tussen.length ? tussen.reduce((a, b) => a + b, 0) / tussen.length : 0, maten };
}

/** Wat een twijfel betekent, voor op het scherm. */
export const TWIJFEL_TEKST = {
  'geen puls': 'hier hoort de analyse geen puls: geen sync of beat-loops',
  rubato: 'het tempo beweegt (rubato): een vast grid volgt het niet',
  drift: 'het grid loopt hier van de tellen weg',
  los: 'veel tellen vallen hier naast het grid',
  maat: 'de "1" is niet zeker: de downbeats zijn het onderling oneens, of de kick en de bas vallen vooral op een andere tel',
  oneens: 'twee analyses zijn het hier oneens: controleer even',
  tel: 'Beat This! telt hier het dubbele tempo: welke van de twee de tel is, is niet bevestigd (controleer, of ½ tel opschuiven)',
};
export { TWIJFELS };

// ---- het oordeel, voor op het scherm ------------------------------------------

/** Live: vanaf zoveel (s) mediane afwijking van de laatste tellen ligt het grid hier naast de muziek. */
export const LIVE_DRIFT = 0.015;

const procent = (x) => `${Math.round(x * 100)}%`;
const FIJN_TEKST = ' (Beat This! telt hier het dubbele tempo: welke van de twee de tel is, zeggen de tellen niet)';
const OCTAAF_TEKST = { 2: ' (de oude analyse hoorde het dubbele tempo)', 0.5: ' (de oude analyse hoorde het halve tempo)' };

/**
 * Wat het scherm over één stuk zegt: { soort, kort, uitleg }.
 *   vast       op slot (met de hand gecontroleerd), en de tellen spreken het niet tegen;
 *   zeker      gemeten: de tellen vallen erop (of met de hand gezet, zonder tellen om te meten);
 *   controleer er is een reden om te twijfelen (die staat in de uitleg);
 *   geenpuls   hier hoort de analyse geen puls.
 * `stuk`: een stuk van het grid (met zekerheid/twijfel/octaaf), `m`: zijn
 * meting (meetGrid(...).stukken[i]) of null, `slot`: het grid staat op slot.
 * Een met de hand gezet stuk (geen zekerheid) wordt aan de tellen gemeten:
 * Clay wil zeker weten dat het klopt, ook als hij het zelf zette.
 */
export function oordeelStuk(stuk, m = null, slot = false) {
  const gemeten = !!m && m.n >= MIN_TELLEN && m.raak != null;
  // Telt Beat This! hier het dubbele (m.fijn), dan valt elke halve tel ook "raak": zeg erbij dat de
  // tellen dan niet zeggen welke van de twee de tel is (een grid een halve tel naast scoort net zo).
  const raak = gemeten ? `${procent(m.raak)} van de gevonden tellen valt op het grid${m.fijn ? FIJN_TEKST : ''}` : null;
  const naast = gemeten && m.afwijking != null && m.afwijking > DRIFT ? `, en een stuk ligt ${Math.round(m.afwijking * 1000)} ms naast de tellen` : '';
  const klopt = gemeten && m.raak >= ZEKER_VANAF && !naast;
  const octaaf = OCTAAF_TEKST[stuk.octaaf] ?? '';
  if (slot) {
    if (gemeten && !klopt) return { soort: 'controleer', kort: '🔒?', uitleg: `op slot, maar ${raak}${naast}` };
    return { soort: 'vast', kort: '🔒', uitleg: `op slot: met de hand gecontroleerd${raak ? ` — ${raak}` : ''}` };
  }
  if (stuk.ok) return { soort: 'zeker', kort: '✓', uitleg: `door jou gecontroleerd${raak ? ` — ${raak}` : ''}` };
  const z = stuk.zekerheid;
  if (Number.isFinite(z) && z < GEEN_PULS) return { soort: 'geenpuls', kort: '–', uitleg: TWIJFEL_TEKST['geen puls'] };
  if (stuk.twijfel && TWIJFEL_TEKST[stuk.twijfel]) {
    return { soort: 'controleer', kort: '?', uitleg: `${TWIJFEL_TEKST[stuk.twijfel]}${octaaf}${raak ? ` — ${raak}` : ''}` };
  }
  if (Number.isFinite(z) && z < ZEKER_VANAF) return { soort: 'controleer', kort: '?', uitleg: `onzeker: ${raak ?? 'de analyse is er niet zeker van'}` };
  if (!Number.isFinite(z)) {
    if (!gemeten) return { soort: 'zeker', kort: '✓', uitleg: 'met de hand gezet' };
    if (klopt) return { soort: 'zeker', kort: '✓', uitleg: `met de hand gezet, en het klopt: ${raak}` };
    return { soort: 'controleer', kort: '?', uitleg: `met de hand gezet, maar ${raak}${naast}` };
  }
  return { soort: 'zeker', kort: '✓', uitleg: `${raak ?? `zeker (${procent(z)})`}${octaaf}` };
}

/**
 * Het oordeel op tracktijd t: dat van het stuk daar, tenzij de live bewaking
 * (`live`: afwijkingBij rond de speelkop) ziet dat het grid hier naast de
 * gevonden tellen ligt — dan 'wijkt', met hoeveel en welke kant op.
 */
export function oordeelBij(grid, t, meting = null, live = null) {
  const i = grid.stukIndex(t);
  const o = oordeelStuk(grid.stukBij(t), meting?.stukken[i] ?? null, grid.slot);
  if (live && o.soort !== 'geenpuls' && Math.abs(live.mediaan) > LIVE_DRIFT && live.raak < 0.5) {
    const ms = Math.round(Math.abs(live.mediaan) * 1000);
    return { soort: 'wijkt', kort: `⚠ ${ms} ms`, index: i,
      uitleg: `het grid wijkt hier ${ms} ms af van de gevonden tellen: de tel komt ${live.mediaan < 0 ? 'vóór' : 'na'} de lijn` };
  }
  return { ...o, index: i };
}

/**
 * De stukken om te controleren (indexen, op volgorde): waar het oordeel
 * 'controleer' is. Met `alles`: elk stuk met een puls dat je nog niet
 * goedkeurde (ook als het er goed uitziet: je luistert alles na).
 */
export function teControleren(grid, meting = null, { alles = false } = {}) {
  const uit = [];
  grid.stukken.forEach((s, i) => {
    const o = oordeelStuk(s, meting?.stukken[i] ?? null, grid.slot);
    if (o.soort === 'controleer' || (alles && !s.ok && o.soort !== 'geenpuls')) uit.push(i);
  });
  return uit;
}

/** Te controleren stukken met minder dan zoveel seconden ertussen horen bij dezelfde plek. */
export const PLEK_GAT = 8;

/**
 * De te controleren stukken samengenomen tot PLEKKEN: aaneengesloten, of met
 * minder dan PLEK_GAT s ertussen. [{ van, tot }] (indexen van stukken). Een
 * live opname gaf 100 losse stukken om na te lopen, de meeste korter dan
 * 20 s (6 okt); als plekken 55, en binnen een plek luister je gewoon door.
 */
export function plekkenTeControleren(grid, meting = null, opties = {}) {
  const st = grid.stukken;
  const uit = [];
  for (const i of teControleren(grid, meting, opties)) {
    const p = uit[uit.length - 1];
    if (p && (i === p.tot + 1 || st[i].van - st[p.tot + 1].van < PLEK_GAT)) p.tot = i;
    else uit.push({ van: i, tot: i });
  }
  return uit;
}

/**
 * Het eerste stuk van de volgende plek om te controleren na het stuk rond t
 * (`stap` 1), of van de vorige (`stap` -1); rondom. Null als er niets (meer)
 * te controleren is.
 */
export function volgendTeControleren(grid, meting, t, { stap = 1, alles = false } = {}) {
  const plekken = plekkenTeControleren(grid, meting, { alles });
  if (!plekken.length) return null;
  const hier = grid.stukIndex(t);
  if (stap > 0) return (plekken.find((p) => p.van > hier) ?? plekken[0]).van;
  return ([...plekken].reverse().find((p) => p.tot < hier) ?? plekken[plekken.length - 1]).van;
}
