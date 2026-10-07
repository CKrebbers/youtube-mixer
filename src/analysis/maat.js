import { clamp } from '../lib/emitter.js';
import { klokTrack, klinkt, pulsVorm, maatgever as engineMaatgever } from '../video/puls.js';
import { hoorbaar, naVertraging } from '../engine/hoorbaar.js';

/**
 * De maat als bron voor de vormlagen (router.js), naast de banden uit de
 * master-analyse (luisteraar.js). Vier bronnen, allemaal 0..1 (regel 2):
 *
 *   maatklap  de KLAPPEN van de maatgever uit de offline onset-analyse
 *             (deck.onsets, tracktijd, de server heeft de ijking van 68,5 ms
 *             er al af). Loopt in KLAP_OP seconden op tot 1 PRECIES op de
 *             klap en dooft uit met KLAP_TAU. Omdat de klappen vooraf bekend
 *             zijn, kan de opkomst vóór de klap liggen: de piek valt op wat je
 *             hoort, niet een beeld later.
 *   tel       de tel van de maatgever, dezelfde vorm als video.pulse
 *             (pulsVorm uit puls.js): vol op de tel, na een halve tel 8%.
 *   sectie.energie
 *             de energie (0..1 binnen het nummer, server/secties.js) van de
 *             sectie van de maatgever die je HOORT (deck.sectieKaart,
 *             docs/SECTIES.md). Springt mee op een grens, een sectie-loop of
 *             een hotcue: wat je hoort, zie je.
 *   sectie.nieuw
 *             een nieuwe sectie begint: de vorm van een klap op elke grens
 *             die je hoort (niet het begin van het nummer), met NIEUW_TAU: een
 *             accent, langer dan een klap. Ook de video-puls slaat erop
 *             (video-mixer.js, _accentNu).
 *   Beide komen van een SectieLezer (hieronder): die kent ook wat je vlak na
 *   een sprong of een loop die rondgaat hoort, telt elke grens één keer en
 *   maakt geen afval. Hij werkt los, voor wie alleen de secties wil.
 *
 * Maatgever = de maatgever van de ENGINE (Engine.maatgever, met hysterese:
 * 3 dB en 250 ms), via maatgever() uit puls.js: dezelfde track als de
 * video-puls, de MAAT-badge, sync, sampler en de bussen, zodat vorm en video
 * op dezelfde tel slaan en niet heen en weer springen als twee tracks
 * ongeveer even hard klinken. Maar alleen zolang je hem HOORT (speelt, wacht
 * niet op de maat, remt niet, klinkt()): een track die je niet hoort geeft
 * geen tel. Zonder engine (`maatgever` niet meegegeven): klokTrack op de
 * lijst, de hardste zonder geduld.
 *
 * Tijd (regel 3): alles volgt uit de POSITIE van het deck, en die komt van de
 * audioklok (bron.positie). Hoorbaar = positie min uitgangsvertraging × rate,
 * zoals de video-puls en de LED-fase. Uitdoven gaat in KLOKtijd: op 1,25×
 * dooft een klap in 0,1 s echte tijd, niet in 0,1 s tracktijd. Geen eigen
 * teller, geen timer: `lees(t)` wordt aangeroepen vlak voor een vormlaag zijn
 * beeld maakt. Op 30, 60 en 120 beelden per seconde staat een waarde op
 * hetzelfde moment even hoog (de test meet het).
 *
 * Geen sprong die het beeld laat schokken:
 *   - De uitvoer zakt nooit sneller dan de puls zelf uitdooft
 *     (max(nieuw, vorige × exp(-dt/τ))). Stopt de maatgever, springt hij
 *     (hotcue, sync, loop) of valt hij weg, dan sterft de staart gewoon uit.
 *     Zolang er niets gebeurt, is dat precies de vorm zelf. Omhoog mag een
 *     sprong van dezelfde track wel: een loop die rondgaat of een hotcue op
 *     de tel geeft een klap die je hoort, dus ook ziet.
 *   - Neemt een ANDERE track de maat over terwijl hij al speelde, dan tellen
 *     alleen klappen en tellen vanaf het vorige beeld (zoals elke klap: een
 *     beeld later, nog bijna vol). Anders sprong het beeld naar het midden van
 *     een klap die 80 ms eerder op de nieuwe track viel. Die grens vervalt
 *     zodra hij terugspringt tot ervóór (loop rond, hotcue). Begint de nieuwe
 *     maatgever net te spelen, dan telt alles: zijn eerste tel ligt dan nog
 *     vóór wat je hoort, en die wil je zien.
 *   - Komen de klappen van de maatgever later binnen (ze worden na het laden
 *     opgehaald), dan geldt hetzelfde als bij een wissel. Voor de secties
 *     (SectieLezer): een andere maatgever of een sectiekaart die later
 *     binnenkomt (laden.js) geeft geen nieuwe sectie voor een grens van net;
 *     de energie glijdt dan (ENERGIE_TAU) in plaats van te springen.
 *
 * Afval: `lees` draait elk beeld. Het waarden-object en de Set van wie
 * speelde worden hergebruikt, de SectieLezer maakt geen objecten. Klap en tel
 * maken nog wel een paar kleine objecten per beeld (de closures met hun
 * { v, tau }, telPuls, kies() en engineTracks). Gemeten (review 6 okt, v8
 * total_allocated_bytes): ~1,1 KB per beeld, was ~1,5 KB.
 *
 * Zonder maatgever, zonder grid, zonder klappen of zonder secties: 0, geen fout.
 */

/** Opkomst van een klap, VÓÓR de klap (seconden kloktijd). */
export const KLAP_OP = 0.012;
/** Uitdoven na de klap (seconden kloktijd), zoals de live-klap (ONSET_TAU in features.js). */
export const KLAP_TAU = 0.1;
/** pulsVorm = exp(-TEL_STEIL × fase): hoe snel de tel uitdooft, als deel van een tel. */
export const TEL_STEIL = 5;
/**
 * Wat hieronder zakt is 0: een staart die eindeloos uitdooft zou elk beeld
 * een nieuwe parameter naar de Worker sturen. Een tel komt nooit zo laag
 * (pulsVorm zakt tot exp(-5) = 0,007); een klap na ~0,9 s.
 */
export const NUL = 1e-4;
/**
 * Uitdoven van een nieuwe sectie (seconden kloktijd). Een accent: twee keer
 * een klap, na 300 ms nog 22% (de flits-noodknop is dan weg), ver onder een
 * maat. Een aanname, niet op Clay's beamer bekeken (VRAGEN SVV).
 */
export const NIEUW_TAU = 0.2;
/** Glijden van de sectie-energie bij een wissel van maatgever of kaart (seconden kloktijd). */
export const ENERGIE_TAU = 0.25;
/** Zo dicht bij zijn doel stopt het glijden: daarna volgt de energie weer meteen. */
const GLIJ_KLAAR = 1e-3;

/** Index van de laatste klap op of vóór `pos`, of -1. Binair zoeken: een uur is ~18.000 klappen. */
export function laatsteKlap(onsets, pos) {
  let lo = 0, hi = onsets.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] <= pos) lo = m + 1; else hi = m; }
  return lo - 1;
}

/**
 * De vorm van één klap, `d` seconden (kloktijd) na de klap: 0 tot KLAP_OP
 * ervoor, dan recht omhoog naar 1 op de klap, daarna exp(-d/τ).
 */
export function klapVorm(d, op = KLAP_OP, tau = KLAP_TAU) {
  if (!(d > -op)) return 0;                  // ook NaN
  if (d < 0) return 1 + d / op;
  return Math.exp(-d / tau);
}

/**
 * De klappen op tracktijd `pos` voor een deck op `rate`: de hoogste van de
 * laatste klap (uitdovend) en de volgende (opkomend). Afstanden in tracktijd
 * worden kloktijd door te delen door de rate. Een klap vóór `vanaf`
 * (tracktijd) telt niet: zie de wissel van maatgever hierboven.
 */
export function klapOmhullende(onsets, pos, rate = 1, vanaf = -Infinity) {
  if (!onsets?.length || !Number.isFinite(pos)) return 0;
  const r = rate > 0 ? rate : 1;
  const i = laatsteKlap(onsets, pos);
  let v = 0;
  if (i >= 0 && onsets[i] >= vanaf) v = klapVorm((pos - onsets[i]) / r);
  if (i + 1 < onsets.length && onsets[i + 1] >= vanaf) v = Math.max(v, klapVorm((pos - onsets[i + 1]) / r));
  return v;
}

/**
 * De tel op tracktijd `pos`: pulsVorm van de fase binnen de tel, precies wat
 * de video-puls doet. Plus hoe lang deze tel duurt (tracktijd), voor het
 * uitdoven; met een tempokaart kan dat per tel verschillen (overgangen).
 * Een tel die vóór `vanaf` begon telt niet.
 */
export function telPuls(grid, pos, vanaf = -Infinity) {
  if (!grid || !Number.isFinite(pos)) return { v: 0, lengte: null };
  const b = grid.beatAt(pos);
  if (!Number.isFinite(b)) return { v: 0, lengte: null };
  const n = Math.floor(b);
  const begin = grid.timeOf(n);
  const lengte = grid.timeOf(n + 1) - begin;
  if (begin < vanaf) return { v: 0, lengte };
  return { v: pulsVorm(b - n), lengte };
}

/**
 * Index van de sectie waarin tracktijd `pos` valt (het laatste begin op of
 * vóór pos), of −1 ervóór. `gok` = de index van het vorige beeld: meestal is
 * het dezelfde of de volgende, dan hoeft er niets gezocht te worden; anders
 * binair. De gok wordt altijd nagekeken, dus een gok van een andere kaart of
 * van vóór een sprong kan geen kwaad. Getal erin, getal eruit: geen afval.
 * Zonder marge (anders dan SectieKaart.index): dit is wat je HOORT.
 */
export function laatsteBegin(stukken, pos, gok = -1) {
  const n = stukken?.length ?? 0;
  if (!n || !(pos >= stukken[0].van)) return -1;               // ook NaN
  if (gok >= 0 && gok < n && stukken[gok].van <= pos) {
    if (gok + 1 >= n || pos < stukken[gok + 1].van) return gok;
    if (gok + 2 >= n || pos < stukken[gok + 2].van) return gok + 1;
  }
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (stukken[m].van <= pos) lo = m; else hi = m - 1; }
  return lo;
}

/** Een sprong: zoveel (tracktijd, s) wijkt de positie af van waar hij na het vorige beeld moest zijn. */
const SPRONG_MARGE = 0.01;
/**
 * Zo lang (s) niet gelezen = een gat: de puls of de route stond dicht, of het
 * beeld stond stil. Een grens uit dat gat telt niet meer (een klap uit het
 * verleden), en een sprong in het gat is geen sprong.
 */
export const GAT = 1;
/**
 * Zo lang (s, kloktijd) zonder maatgever blijft de energie staan: korter is
 * meestal een cut in de mix (fader of crossfader van de maatgever dicht: de
 * hysterese van Engine.maatgever geeft dan ~250 ms niemand) en de muziek
 * speelt door. Pas daarna (pauze, stop) glijdt hij naar 0 (review sec-hub).
 */
export const HOUD = 0.5;
/**
 * Hetzelfde sectiebegin opnieuw horen binnen zoveel van een maat na de vorige
 * keer (een loop korter dan een maat, een hotcue- of pad-stutter) is GEEN
 * nieuwe sectie: anders een klap per rondgang, een stroboscoop op de beamer
 * (17 per seconde bij een loop van 1/8 tel). Een sectie-loop (minstens een
 * maat) telt wel, elke ronde. 0,99: een loop van precies een maat telt.
 */
const HERHAAL_MAAT = 0.99;

// De getallen van een SectieLezer staan in een Float64Array: een double in een
// gewoon veld kost in V8 bij elke keer opslaan een HeapNumber (16 B), in een
// Float64Array niets.
const G_T = 0, G_POSITIE = 1, G_HOOR = 2, G_SPRONG = 3, G_MARGE = 4, G_GRENS = 5, G_NIEUW = 6, G_ENERGIE = 7,
  G_V = 8, G_LEEG = 9, G_HERHAAL = 10, G_DOEL = 11;

/** Een maat in kloktijd rond tracktijd `b` (zonder grid: 2 s tracktijd, een maat van 120 bpm). Alleen bij een grens. */
function maatKlok(d, b, r) {
  const gr = d.grid;
  if (!gr) return 2 / r;
  const m = gr.timeOf(gr.beatAt(b) + (gr.beatsPerBar || 4)) - b;
  return (m > 0 ? m : 2) / r;
}

/**
 * De secties van één track zoals je ze HOORT: de sectie, haar energie en
 * label, en een nieuwe sectie als een klap (`nieuw`, 0..1, NIEUW_TAU) en als
 * teller (`grenzen`: elke grens die je hoort precies één keer). Geen DOM,
 * geen klok: de tijd `t` komt van buiten (audioklok min vertraging, zoals
 * laag.frame hem krijgt), de positie van het deck (regel 3). Geen objecten,
 * arrays of closures per beeld; gemeten blijft ~45 B per beeld over: doubles
 * die over een functiegrens gaan (de t, de positie), HeapNumbers van 16 B.
 * Het videopad maakte vóór de review ~1,6 KB per beeld.
 *
 * Wat je hoort is positie min vertraging × rate (hoorbaar.js), BEHALVE vlak
 * na een sprong (hotcue, seek, sectie, beatjump, een loop die rondgaat): dan
 * ligt positie − vertraging vóór het doel, op een plek die je nooit hoort
 * ("Bekend" in hoorbaar.js), en hoor je nog `vertraging` lang het stuk van
 * vóór de sprong. Een sprong = de positie wijkt meer dan SPRONG_MARGE af van
 * de vorige plus dt × rate. Tot hij te horen is staat alles stil: dezelfde
 * sectie en energie, geen nieuwe sectie, geen opkomst (de klap dooft gewoon
 * verder uit). Bij een loop die rondgaat weet hij precies wanneer je de
 * sprong hoort (positie − loopbegin); bij een andere sprong neemt hij aan:
 * net nu (hooguit één beeld te laat). Het rekent op de ruwe positie, niet op
 * een correctie in hoorbaar.js: komt de loop-correctie van deck.sectieHier
 * ooit in hoorbaar.js zelf, dan blijft dit kloppen (stilstaan tot de sprong
 * hoorbaar is, dan het nieuwe stuk).
 *
 * Een nieuwe sectie (grens = elk sectiebegin behalve het eerste):
 *   - je hoort hem doorlopend passeren (vorige < begin ≤ nu);
 *   - een sprong wordt hoorbaar en het nieuwe stuk begint op (of vlak voor) het
 *     begin van de sectie (een hotcue of een sectie-loop op het begin); een
 *     sprong midden in een sectie is geen nieuwe sectie;
 *   - de track begint te spelen op het begin van een sectie, ook een NIEUWE
 *     maatgever terwijl de vorige stilvalt (A stopt, B start op zijn cue, in
 *     dezelfde lezing): de grens telt als hij binnen het laatste beeld ligt.
 *   Niet: een grens van een track die de maat overneemt van een maatgever die
 *   doorspeelt (overnemen), een kaart die later binnenkomt, of uit
 *   een gat. En niet: hetzelfde sectiebegin opnieuw binnen een maat na de
 *   vorige keer (HERHAAL_MAAT: een korte loop, een stutter). De klap dooft uit
 *   in kloktijd vanaf het moment dat je de grens hoorde. De opkomst (KLAP_OP
 *   vóór de grens) alleen als je hem ook haalt: niet als de loop vóór die
 *   grens rondgaat (de opbouw loopen tot de drop: de drop hoor je nooit).
 *
 * Energie: de sectie die je hoort; zelfde deck en kaart = meteen, anders
 * glijden (ENERGIE_TAU) tot hij er bijna is. Zonder maatgever blijft hij eerst
 * HOUD staan (een cut in de mix), daarna glijdt hij naar 0. `energieDoel` =
 * waar hij heen glijdt (de energie van de sectie zelf).
 *
 * De tijd: t = audioklok − vertraging. Wordt de vertraging groter (een ander
 * uitgangsapparaat, de limiter), dan loopt t even terug: dat is geen nieuwe
 * klok (geen reset, alles blijft staan tot t weer verder is) en geen sprong
 * (de verwachte positie rekent met de audioklok, t + V). Alleen een sprong
 * terug van meer dan GAT is een nieuwe klok.
 *
 * Gebruik: `lees(t)` vraagt de track aan `deck()` (de maatgever die je hoort,
 * of null); `stap(t, deck, V?)` als je hem (en de vertraging) zelf al hebt
 * (MaatLezer, de video-mixer). Dezelfde t
 * twee keer (of een kleine stap terug) = niets veranderd. Voor een teller-gebruiker (de hub): onthoud
 * `grenzen` en meld een nieuwe sectie als hij veranderd is. Lees hem geregeld
 * (vaker dan GAT): wat in een gat gebeurt, telt niet.
 */
export class SectieLezer {
  /**
   * @param deck       () -> deck of null: de track waarvan je de secties hoort (de maatgever, alleen als je hem hoort)
   * @param vertraging () -> seconden tussen de positie en wat je hoort (uitgangsVertraging)
   */
  constructor({ deck = () => null, vertraging = () => 0 } = {}) {
    this.deckVan = deck;
    this.vertraging = vertraging;
    this.g = new Float64Array(12);
    this.reset();
  }

  reset() {
    const g = this.g;
    g.fill(0);
    g[G_HOOR] = NaN;            // wat je bij het vorige beeld hoorde (tracktijd)
    g[G_GRENS] = -Infinity;     // de t waarop je de laatste nieuwe sectie hoorde
    g[G_LEEG] = -Infinity;      // de t waarop de maatgever wegviel (voor HOUD)
    g[G_HERHAAL] = -Infinity;   // de t waarop je het laatste sectiebegin hoorde (ook een herhaling)
    this.herhaalI = -1;         // en welk (index)
    this.begonnen = false;      // al een beeld gelezen? (G_T = de t van het vorige beeld)
    this.deck = null;           // de track van het vorige beeld, of null
    this.kaart = null;          // zijn sectiekaart
    this.speelde = false;       // (G_POSITIE = zijn ruwe positie bij het vorige beeld)
    this.sprongWacht = false;   // een sprong die je nog niet hoort (G_SPRONG = de t waarop wel, G_MARGE = hoe vroeg hij al gebeurd kan zijn)
    this.sectie = -1;           // de sectie die je hoort (index), of −1
    this.grenzen = 0;           // teller: elke nieuwe sectie die je hoort, één keer
    this.glijd = false;
  }

  /** 0..1: een klap op een nieuwe sectie, uitdovend met NIEUW_TAU. */
  get nieuw() { return this.g[G_NIEUW]; }
  /** 0..1: de energie van de sectie die je hoort. */
  get energie() { return this.g[G_ENERGIE]; }
  /** 0..1: waar de energie heen glijdt (de energie van de sectie zelf; zonder maatgever na HOUD 0). */
  get energieDoel() { return this.g[G_DOEL]; }
  /** De t waarop je een sprong hoort die nog moet komen, of NaN. */
  get sprongOp() { return this.sprongWacht ? this.g[G_SPRONG] : NaN; }
  /** Wat je hoort (tracktijd), of NaN zonder track. */
  get hoor() { return this.g[G_HOOR]; }
  /** Het label van de sectie die je hoort ('drop', 'deel', …), of null. */
  get label() { return this.sectie >= 0 ? this.kaart?.stukken?.[this.sectie]?.label ?? null : null; }

  lees(t) { return this.stap(t, this.deckVan()); }

  /**
   * Is er met dit deck iets gebeurd sinds de vorige lezing: een sprong (hotcue,
   * seek, sectie), stilvallen of starten? Goedkoop, zonder iets te veranderen:
   * voor een seintje van de deck ('change' komt ook bij elke fader- of
   * EQ-beweging). `klok` = de audioklok nu (zonder vertraging).
   */
  veranderd(d, klok) {
    if (!this.begonnen || d !== this.deck) return false;
    const speelt = !!d.playing && !d.wacht;
    if (speelt !== this.speelde) return true;
    if (!speelt) return false;
    const g = this.g, r = d.remt ? d.snelheid : d.rate;
    return Math.abs(d.position - (g[G_POSITIE] + (klok - g[G_T] - g[G_V]) * (r > 0 ? r : 0))) > SPRONG_MARGE;
  }

  /** `V` = de vertraging als je hem al hebt (anders vertraging()). */
  stap(t, d, V = d ? this.vertraging() : 0) {
    const g = this.g;
    if (this.begonnen && t <= g[G_T]) {
      // Dezelfde t, of een kleine stap terug (de vertraging werd groter): niets veranderd.
      if (t > g[G_T] - GAT) return this;
      this.reset();                                                  // een echte sprong terug: een nieuwe klok
    }
    const dt = this.begonnen ? t - g[G_T] : 0;
    const dk = this.begonnen ? dt + V - g[G_V] : 0;                  // hoe ver de audioklok liep (t = klok − V)
    const gat = !this.begonnen || dt > GAT;
    this.begonnen = true;
    g[G_T] = t;
    g[G_V] = V;
    const kaart = d ? d.sectieKaart ?? null : null;
    const st = kaart && kaart.stukken && kaart.stukken.length ? kaart.stukken : null;
    const vorige = this.deck;
    const wissel = d !== this.deck || kaart !== this.kaart;
    if (wissel) { this.deck = d; this.kaart = kaart; this.glijd = true; this.herhaalI = -1; }
    if (!d && vorige !== null) g[G_LEEG] = t;                        // de maatgever viel net weg

    // Wat je hoort, en een sprong die je nog niet hoort.
    let h = NaN, r = 0, speelt = false;
    if (d) {
      speelt = !!d.playing && !d.wacht;
      r = d.remt ? d.snelheid : d.rate;
      if (!(r > 0)) r = 0;
      const p = d.position;
      h = speelt ? naVertraging(p, V, d.remt ? d.snelheid : d.rate) : p;   // = hoorbaar(d, V), met de positie één keer gelezen
      if (!speelt || wissel || gat) this.sprongWacht = false;
      else if (this.speelde) {
        const verwacht = g[G_POSITIE] + dk * r;
        if (Math.abs(p - verwacht) > SPRONG_MARGE) {
          const l = d.loop;
          const rond = !!l && r > 0 && p >= l.start && p < l.end && verwacht >= l.end - SPRONG_MARGE;
          g[G_SPRONG] = rond ? t + V - (p - l.start) / r : t + V;
          g[G_MARGE] = rond ? 1e-3 : dt * r + 1e-3;
          this.sprongWacht = true;
        }
      }
      g[G_POSITIE] = p;
      if (this.sprongWacht && t < g[G_SPRONG]) h = g[G_HOOR] + dt * r;   // nog het stuk van vóór de sprong
    } else this.sprongWacht = false;
    // Starten: deze track begon net, of hij nam het over van een maatgever die nu stilvalt (A stopt, B start
    // op zijn cue). Een track die de maat overneemt van een maatgever die doorspeelt, speelde al: dat is
    // overnemen, geen starten.
    const start = speelt && (!this.speelde || vorige === null
      || (d !== vorige && !(vorige.playing && !vorige.wacht && !vorige.remt)));
    this.speelde = speelt;
    // Tot de sprong te horen is, staat alles stil: dezelfde sectie en energie,
    // geen nieuwe sectie en geen opkomst (alleen de klap dooft verder uit). Het
    // oude stuk doortrekken zou voorbij de plek van de sprong kunnen lopen (die
    // weet je niet precies), over een grens die je nooit hoort.
    const vast = this.sprongWacht && t < g[G_SPRONG] && !wissel;

    // De sectie die je hoort, en of je net een nieuwe hoorde.
    const i = vast ? this.sectie : st && h === h ? laatsteBegin(st, h, this.sectie) : -1;
    const rr = r > 0 ? r : 1;
    const hoorbaarNu = this.sprongWacht && t >= g[G_SPRONG];
    if (i >= 1 && speelt && !gat && !vast) {
      const b = st[i].van;
      let over = false;
      if (hoorbaarNu) over = b >= h - (t - g[G_SPRONG]) * r - g[G_MARGE] && b <= h;   // het nieuwe stuk begon op (of vlak voor) het begin
      else if (start) over = b <= h && h - b <= dt * r + 1e-3;      // net begonnen, op het begin
      else if (!wissel) over = g[G_HOOR] < b && b <= h;             // doorlopend erover
      if (over) {
        const tb = t - (h - b) / rr;                                 // wanneer je het begin hoorde
        // Hetzelfde begin binnen een maat na de vorige keer: een korte loop of een stutter, geen nieuwe sectie.
        const herhaling = i === this.herhaalI && tb - g[G_HERHAAL] < HERHAAL_MAAT * maatKlok(d, b, rr);
        g[G_HERHAAL] = tb; this.herhaalI = i;
        if (!herhaling) { this.grenzen++; g[G_GRENS] = tb; }
      }
    }
    if (hoorbaarNu) this.sprongWacht = false;

    // De klap: uitdoven vanaf de laatste nieuwe sectie, opkomen naar de volgende (als je die haalt).
    const sinds = t - g[G_GRENS];
    let n = sinds >= 0 ? Math.exp(-sinds / NIEUW_TAU) : 0;
    const k = i + 1;
    if (speelt && !vast && st && k >= 1 && k < st.length && h === h) {
      const l = d.loop;
      const nooit = !!l && h < l.end && l.end <= st[k].van + 1e-6;    // de loop gaat rond vóór die grens
      const voor = (st[k].van - h) / rr;
      if (!nooit && voor < KLAP_OP) n = Math.max(n, 1 - voor / KLAP_OP);
    }
    g[G_NIEUW] = n < NUL ? 0 : n > 1 ? 1 : n;

    // De energie: meteen, of glijden na een wissel. Zonder maatgever eerst HOUD vasthouden.
    if (!d && t - g[G_LEEG] < HOUD) {
      g[G_DOEL] = g[G_ENERGIE];                                      // glijd blijft staan: daarna glijdt hij vanaf hier
    } else {
      const ruw = st ? st[i < 0 ? 0 : i].energie : 0;
      const doel = ruw > 0 ? (ruw < 1 ? ruw : 1) : 0;                  // clamp, ook NaN of zonder energie -> 0
      let e = doel;
      if (this.glijd) {
        const dg = d ? dt : Math.min(dt, t - g[G_LEEG] - HOUD);          // na HOUD: glijden vanaf het eind van het vasthouden
        e = doel + (g[G_ENERGIE] - doel) * (dg > 0 ? Math.exp(-dg / ENERGIE_TAU) : 1);
        if (Math.abs(e - doel) < GLIJ_KLAAR) { e = doel; this.glijd = false; }
      }
      g[G_ENERGIE] = e < NUL ? 0 : e > 1 ? 1 : e;
      g[G_DOEL] = doel;
    }

    g[G_HOOR] = h;
    this.sectie = i;
    return this;
  }
}

/**
 * De tracks zoals de maatlezer ze wil zien, uit de engine (alleen uitlezen,
 * duck-typed: deze module importeert de engine niet). `zicht` = hoe hard hij
 * klinkt (klinkt() uit puls.js, zoals de video-puls en engine.syncMaster), dus
 * dezelfde maatgever als de MAAT-badge zolang je die track hoort.
 */
export const engineTracks = (engine, ids) => ids.map((id) => {
  const deck = engine.deck(id);
  return { id, deck, zicht: deck.buffer ? klinkt(deck.ui.fader, engine.xfadeGain(id)) : 0 };
});

/**
 * Een MaatLezer op de engine: tracks uit engineTracks, de maatgever van de
 * engine (hysterese), zoals de video-puls. Voor het vormpaneel en de proeven.
 */
export const engineMaatLezer = (engine, ids, vertraging = () => 0) => new MaatLezer({
  tracks: () => engineTracks(engine, ids),
  maatgever: () => engineMaatgever(engine, ids),
  vertraging,
});

/**
 * De DOORLOPENDE tel van een deck zoals je hem hoort (niet modulo de maat),
 * met het tempo dat je hoort (grid × rate): voor de beeldmachine
 * (src/koppel/beeld.js, docs/BEELD.md), die zelf verder telt tussen twee
 * klokberichten. Dezelfde hoorbare positie als de klap en de tel hierboven
 * (hoorbaar.js, regel 3). `vertraging` mag kleiner zijn dan de
 * uitgangsvertraging: een beamer die achterloopt krijgt de tel iets vóór.
 * Null zonder grid of zonder tel op die plek.
 */
export function hoorbareTel(deck, vertraging = 0) {
  if (!deck?.grid) return null;
  const pos = hoorbaar(deck, vertraging);
  const beat = deck.grid.beatAt(pos);
  const bpm = deck.grid.bpmAt(pos) * (Number.isFinite(deck.rate) ? deck.rate : 1);
  return Number.isFinite(beat) && bpm > 0 ? { beat, bpm } : null;
}

/**
 * De tel van de maatgever van de engine (maatgever() uit puls.js: met
 * hysterese, en alleen als je hem HOORT), zoals hoorbareTel. Null als er
 * geen maatgever is die je hoort.
 */
export function engineTel(engine, ids, vertraging = 0) {
  const id = engineMaatgever(engine, ids);
  if (id === null) return null;
  const t = hoorbareTel(engine.deck(id), vertraging);
  return t ? { id, ...t } : null;
}

const leeg = () => ({ id: null, data: null, vanaf: -Infinity, tau: null });

/**
 * Leest klappen, tel en secties van de maatgever uit, met toestand voor de
 * wissels. Eén `lees(t)` per beeld; dezelfde t twee keer (twee lagen in één
 * beeld) geeft hetzelfde terug zonder iets te veranderen.
 */
export class MaatLezer {
  /**
   * @param tracks     () -> [{ id, zicht, deck }], deck: { playing, grid, onsets, sectieKaart, position, rate }
   * @param vertraging () -> seconden tussen de positie en wat je hoort (outputLatency + baseLatency)
   * @param maatgever  () -> id of null: wie de maat geeft (engineMaatgever(engine, ids)).
   *                   Zonder: de hardste uit `tracks` (klokTrack), zonder hysterese.
   */
  constructor({ tracks, vertraging = () => 0, maatgever = null } = {}) {
    this.tracks = tracks;
    this.vertraging = vertraging;
    this.kiesMaatgever = maatgever;
    // De secties: een eigen SectieLezer op de maatgever die lees() kiest. Hij
    // houdt zijn eigen toestand bij (ook over een reset hieronder heen).
    this.secties = new SectieLezer({ vertraging });
    this.reset();
  }

  reset() {
    this.t = null;
    this.maatgever = null;             // id, of null
    this.speelden = new Set();         // wie speelde bij de vorige lees
    this.bronnen = { maatklap: leeg(), tel: leeg() };
    // Eén object, elk beeld opnieuw ingevuld: de router leest het meteen uit
    // en niemand bewaart het (een nieuw object per beeld was afval).
    this.waarden = { maatklap: 0, tel: 0, 'sectie.energie': 0, 'sectie.nieuw': 0 };
  }

  /** Wie geeft de maat, en de lijst waaruit gekozen werd. */
  kies() {
    const lijst = this.tracks?.() ?? [];
    const id = this.kiesMaatgever ? this.kiesMaatgever() : klokTrack(lijst.map((tr) => ({
      id: tr.id, speelt: !!tr.deck?.playing && !tr.deck?.wacht && !tr.deck?.remt, heeftGrid: !!tr.deck?.grid, zicht: tr.zicht ?? 0,
    })));
    const tr = id === null ? null : lijst.find((x) => x.id === id) ?? null;
    return { tr, lijst };
  }

  /** De waarden op tijd t (seconden, audioklok, wat je hoort). */
  lees(t) {
    if (this.t !== null && t === this.t) return this.waarden;
    if (this.t !== null && (t < this.t || t - this.t > 1)) this.reset();   // nieuwe klok of lang stil
    const dt = this.t === null ? 0 : t - this.t;
    this.t = t;

    const { tr, lijst } = this.kies();
    const d = tr?.deck ?? null;
    const id = tr?.id ?? null;
    this.maatgever = id;
    const rate = d && d.rate > 0 ? d.rate : 1;
    const pos = d ? hoorbaar(d, this.vertraging()) : NaN;         // de maatgever speelt altijd
    // Een wissel naar een track die al speelde = overnemen: alleen wat sinds
    // het vorige beeld komt telt (een klap in dat laatste beeld verschijnt
    // zoals elke klap: één beeld later, nog bijna vol). Naar een track die
    // net begint = starten: alles telt.
    const vanaf = id !== null && this.speelden.has(id) ? pos - dt * rate : -Infinity;

    const w = this.waarden;
    w.maatklap = this._bron('maatklap', id, d?.onsets ?? null, vanaf, pos, dt,
      (v0) => ({ v: klapOmhullende(d.onsets, pos, rate, v0), tau: KLAP_TAU }), w.maatklap);
    w.tel = this._bron('tel', id, d?.grid ?? null, vanaf, pos, dt, (v0) => {
      const { v, lengte } = telPuls(d.grid, pos, v0);
      return { v, tau: lengte > 0 ? lengte / (TEL_STEIL * rate) : null };
    }, w.tel);
    // De secties (docs/SECTIES.md): de SectieLezer, op dezelfde maatgever.
    const s = this.secties.stap(t, d);
    w['sectie.nieuw'] = s.nieuw;
    w['sectie.energie'] = s.energie;

    // Een track die op zijn start op de maat wacht, speelt voor het oor nog
    // niet: begint hij, dan is dat starten (alles telt), geen overnemen.
    // (Dezelfde Set, elk beeld opnieuw gevuld: een nieuwe Set met filter en map was afval.)
    const sp = this.speelden;
    sp.clear();
    for (let k = 0; k < lijst.length; k++) { const x = lijst[k]; if (x.deck?.playing && !x.deck?.wacht) sp.add(x.id); }
    return w;
  }

  /**
   * Eén bron een stap verder. `data` = de klappen of het grid van de
   * maatgever: verandert de maatgever of zijn data, dan is het een wissel,
   * en vanaf dan telt alleen wat op of na `vanaf` (tracktijd) valt. Die grens
   * geldt tot de hoorbare positie `pos` er weer vóór komt (een loop die
   * rondgaat, een hotcue terug): wat daar ligt hoor je opnieuw, dus dat telt.
   */
  _bron(naam, id, data, vanaf, pos, dt, reken, vorige) {
    const b = this.bronnen[naam];
    this._wissel(b, id, data, vanaf, pos);
    let nieuw = 0;
    if (id !== null && data) {
      const r = reken(b.vanaf);
      nieuw = r.v;
      if (r.tau > 0) b.tau = r.tau;
    }
    return this._staart(b, nieuw, dt, vorige);
  }

  /** Is het een wissel (andere maatgever of andere data)? Zet de grens `b.vanaf` (zie _bron). */
  _wissel(b, id, data, vanaf, pos) {
    if (id !== b.id || data !== b.data) {
      b.vanaf = Number.isFinite(vanaf) ? vanaf : -Infinity;
      b.id = id;
      b.data = data;
    } else if (pos < b.vanaf) b.vanaf = -Infinity;
  }

  /** De staart: nooit sneller omlaag dan de puls zelf uitdooft. */
  _staart(b, nieuw, dt, vorige) {
    const tau = b.tau ?? KLAP_TAU;
    const staart = dt > 0 ? vorige * Math.exp(-dt / tau) : vorige;
    const v = Math.max(nieuw, staart);
    return v < NUL ? 0 : clamp(v);
  }
}
