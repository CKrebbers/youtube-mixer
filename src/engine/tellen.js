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
 * rekent de server zo elk automatisch grid uit de tellen opnieuw (uit
 * tellen.json, zonder GPU: milliseconden per nummer).
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
 * Halveren (de tellen van het netwerk zijn achtsten) kan alleen als de "1"
 * zegt welke van de twee de tel is (`kanHalveren`), of moet boven MAX_BPM.
 * Een wals (3 per maat) wordt niet verdubbeld: die tel je in zijn tel.
 * @param {{ bpm: number, gewicht: number, kanHalveren: boolean }[]} delen
 * @param {number} per  tellen per maat van Beat This!
 * @returns {number[]} de factor per deel
 */
export function dansOctaven(delen, per = 4) {
  if (!delen.length) return [];
  const toegestaan = (d, f) => {
    if (f > 1 && (per === 3) && d.bpm * f / 2 >= MIN_BPM) return false;
    if (f < 1 && !d.kanHalveren && d.bpm * f * 2 <= MAX_BPM) return false;
    return d.bpm * f >= MIN_BPM && d.bpm * f <= MAX_BPM;
  };
  // Wat het bereik zegt, per deel (zonder halveren als het niet mag).
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
  return delen.map((d, i) => {
    let beste = eigen[i], afstand = Infinity;
    for (const f of [0.25, 0.5, 1, 2, 4]) {
      const b = d.bpm * f;
      if (b < DANS_RUIM_MIN || b > DANS_RUIM_MAX || !toegestaan(d, f)) continue;
      const a = Math.abs(Math.log2(b / doel));
      if (a < afstand - 1e-9) { afstand = a; beste = f; }
    }
    return beste;
  });
}

/**
 * Een tempokaart uit gevonden tellen en downbeats (tracktijden, s).
 * Stukken { van, bpm, anker, maat, zekerheid, twijfel? }: de zekerheid is
 * GEMETEN (meetGrid op het grid zelf): het deel van de tellen dat raak valt,
 * onder ZEKER_VANAF als het grid ergens systematisch naast de tellen ligt
 * ('drift') of het tempo beweegt ('rubato'). Waar geen puls is: een stuk met
 * zekerheid 0 dat het rooster van zijn buur doortrekt (sync en beat-loops
 * weigeren daar). vergelijk() kan de zekerheid daarna nog omlaag halen.
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
  const factoren = dansOctaven(echte.map((st) => ({ bpm: st.bpm, gewicht: extra.get(st).gewicht, kanHalveren: extra.get(st).kanHalveren })), perBT);
  echte.forEach((st, i) => {
    const f = factoren[i];
    extra.get(st).f = f;
    if (f === 1) return;
    st.bpm *= f;
    if (f < 1) {
      const L2 = 60 / st.bpm;
      st.anker = st.maat + Math.ceil((st.anker - st.maat) / L2 - 1e-9) * L2;
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
  stukken.forEach((s, i) => {
    const x = extra.get(s);
    if (!x || x.geen) return;
    const m = meting.stukken[i];
    s.zekerheid = m.raak != null ? rond(m.raak) : 0;
    if (x.rubato) { s.twijfel = 'rubato'; s.zekerheid = Math.min(s.zekerheid, ONZEKER); }
    else if (m.afwijking != null && m.afwijking > DRIFT) { s.twijfel = 'drift'; s.zekerheid = Math.min(s.zekerheid, ONZEKER); }
    else if (x.maatTwijfel) s.twijfel = 'maat';
    if (s.zekerheid < ZEKER_VANAF && !s.twijfel) s.twijfel = 'los';
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
 */
function fijner(bs, L) {
  if (bs.length < MIN_TELLEN) return false;
  let half = 0;
  for (let j = 1; j < bs.length; j++) if (Math.abs((bs[j] - bs[j - 1]) / L - 0.5) <= 0.12) half++;
  return half >= 0.3 * (bs.length - 1);
}
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
  const fijn = perStuk.map((bs, i) => fijner(bs, 60 / grid.stukken[i].bpm));
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
  const stukken = per.map((x) => ({ van: x.van, ...af(x) }));
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
  const L = 60 / grid.bpmAt(t), fijn = fijner(hier, L);
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
 * Verandert `kaart` en geeft hem terug.
 */
export function vergelijk(kaart, beats, ander) {
  if (!ander) return kaart;
  kaart.stukken.forEach((st, i) => {
    if (st.twijfel === 'geen puls') return;
    const van = st.van, tot = i + 1 < kaart.stukken.length ? kaart.stukken[i + 1].van : Infinity;
    const hier = beats.filter((b) => b >= van && b < tot);
    if (hier.length < MIN_TELLEN) return;
    const midden = hier[hier.length >> 1];
    if (ander.zekerheidBij && ander.zekerheidBij(midden) !== 'zeker') return;   // de ander weet het hier zelf niet
    const r = Math.log2(ander.bpmAt(midden) / st.bpm);
    const octaaf = Math.abs(r) < OCTAAF_MARGE ? 1 : Math.abs(r - 1) < OCTAAF_MARGE ? 2 : Math.abs(r + 1) < OCTAAF_MARGE ? 0.5 : null;
    let oneens = octaaf === null;
    if (!oneens) {
      // Bij ½ is de ander grover: een gevonden tel valt op zijn tel of precies ertussen; tel die twee als één.
      const f = octaaf === 0.5 ? 2 : 1;
      let X = 0, Y = 0, blokken = 0;
      for (let j = 0; j + MIN_TELLEN <= hier.length; j += FASE_BLOK) {
        let x = 0, y = 0, n = 0;
        for (const b of hier.slice(j, j + FASE_BLOK)) {
          const fase = 2 * Math.PI * f * ander.beatAt(b);
          x += Math.cos(fase); y += Math.sin(fase); n++;
        }
        const R = Math.hypot(x, y);
        if (R / n < FASE_STABIEL) continue;                     // binnen dit blok al verspreid: geen stem
        X += x / R; Y += y / R; blokken++;
      }
      // Draait de fase van blok tot blok, dan schuift de ander langs de tellen: geen stem.
      if (blokken && Math.hypot(X, Y) / blokken >= FASE_SAMEN) {
        // Hoe ver naast, in tellen van de fijnste van de twee (met f = 2 bij ½ zijn dat de gevonden tellen).
        const naast = Math.abs(Math.atan2(Y, X)) / (2 * Math.PI);
        oneens = naast > FASE_ANDERE_TEL;
      }
    }
    if (!oneens) {
      if (octaaf !== 1) st.octaaf = octaaf;
      return;
    }
    // Rubato zegt al genoeg (dan is een tweede mening geen nieuws).
    if (st.twijfel !== 'rubato') st.twijfel = 'oneens';
    st.zekerheid = Math.min(st.zekerheid ?? 1, ONZEKER);
  });
  return kaart;
}
/** Wat een twijfel betekent, voor op het scherm. */
export const TWIJFEL_TEKST = {
  'geen puls': 'hier hoort de analyse geen puls: geen sync of beat-loops',
  rubato: 'het tempo beweegt (rubato): een vast grid volgt het niet',
  drift: 'het grid loopt hier van de tellen weg',
  los: 'veel tellen vallen hier naast het grid',
  maat: 'de "1" is niet zeker: de downbeats zijn het onderling oneens',
  oneens: 'twee analyses zijn het hier oneens: controleer even',
};
export { TWIJFELS };

// ---- het oordeel, voor op het scherm ------------------------------------------

/** Live: vanaf zoveel (s) mediane afwijking van de laatste tellen ligt het grid hier naast de muziek. */
export const LIVE_DRIFT = 0.015;

const procent = (x) => `${Math.round(x * 100)}%`;
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
  const raak = gemeten ? `${procent(m.raak)} van de gevonden tellen valt op het grid` : null;
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
