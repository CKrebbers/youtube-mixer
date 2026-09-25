import { Emitter } from '../lib/emitter.js';
import { SYSTEMEN, SYSTEEM, LUTS, ACHTERGROND, maakRng, draaiKnoppen } from './systemen.js';
import { maten } from './hulp.js';
import { MENGVORMEN, MAX_BEELDLAGEN } from '../video/lagen.js';
import { Budget, BUDGET_HOOFD, BUDGET_WERKER, KWALITEIT_MIN } from './budget.js';

/**
 * Een vormlaag: één Vormmachine die op zijn eigen canvas tekent, voor de
 * videomixer. En VormLagen: de twee lagen samen, met welke er gekozen is.
 *
 * Tijd (regel 3): de laag krijgt de tijd van BUITEN, in seconden van de
 * audioklok (wat je hoort). Een systeem doet stappen van 1/60 s; zoveel als
 * er sinds de vorige keer verstreken zijn, hooguit MAX_STAPPEN. Zo draait
 * een vorm even snel op 30 als op 120 beelden per seconde, en loopt hij niet
 * in te halen na een hapering. Staat de audioklok stil (AudioContext nog niet
 * gestart), dan staat het beeld ook stil.
 *
 * Knoppen (regel 2): een knop is 0..1. De laag schaalt naar min..max van het
 * systeem en rondt af op zijn stap. Welke knoppen er zijn: draaiKnoppen() —
 * geen keuzelijsten, geen knoppen die een nieuwe start vragen.
 *
 * Twee modi (stap 3, docs/plugins/01-plan.md):
 *   werker  standaard in de browser (Worker + OffscreenCanvas bestaan). Het
 *           systeem draait in src/vormen/werker.js; de hoofdthread stuurt de
 *           tijd en de parameters, en krijgt per beeld een ImageBitmap terug.
 *           frame(t) wacht NOOIT: hij geeft het laatst ontvangen beeld (of
 *           het lege canvas tot het eerste binnen is) en vraagt pas een nieuw
 *           als het vorige antwoord er is — zo loopt er geen rij berichten op.
 *   hoofd   alles hier, op de hoofdthread: in de tests, in oude browsers, en
 *           als de Worker niet start (dan meldt hij 'modus'). In de Worker
 *           draait deze zelfde klasse in hoofd-modus: één waarheid.
 *
 * Tijdsbudget (budget.js): de laag meet hoe lang zijn stappen per beeld duren
 * (performance.now, alleen om te METEN; de systemen zelf zien geen klok) en
 * zet `g.kwaliteit` (0,25..1) omlaag of omhoog. Een systeem schaalt zijn
 * zware lussen daarmee. Noodrem: 'noodrem'-event.
 *
 * Kent geen DOM: het canvas komt uit `maakCanvas` (OffscreenCanvas in de
 * browser, een nep-canvas in de tests).
 */

export const STAP = 1 / 60;
export const MAX_STAPPEN = 3;
/**
 * Het doek van een vormlaag: 16:9 zoals het videobeeld (ROADMAP 7), zodat er
 * op de mixer niets wegvalt en niets scheef wordt opgerekt. 640 × 360:
 *   - oppervlakte 230 400 pixels, 12% MINDER dan het oude vierkant van 512²:
 *     wat met het doek meegroeit (clear/fade, blit, de ImageBitmap-kopie in
 *     de Worker, de upload naar de GPU) wordt niet duurder, dus de budgetten
 *     van budget.js (4 ms hoofdthread, 12 ms Worker) hoeven niet opnieuw;
 *   - precies 2× naar het doek van de mixer (1280 × 720): elke pixel wordt
 *     2 × 2, geen scheve resampling. Van het oude vierkant was maar
 *     512 × 288 te zien, 2,5× opgeschaald; nu is alles te zien en scherper;
 *   - precies 16:9 (ggd 40): een rooster met ny een veelvoud van 9 heeft
 *     exact vierkante cellen (hulp.js, cellen()).
 * g.D = korte zijde / 320 = 1,125: lijnen zijn ten opzichte van de vorm even
 * dik als vroeger (512 / 320 op het vierkant).
 */
export const LAAG_BREEDTE = 640;
export const LAAG_HOOGTE = 360;
export const AANTAL_LAGEN = MAX_BEELDLAGEN;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const naar01 = (k, v) => (k.max === k.min ? 0 : clamp01((v - k.min) / (k.max - k.min)));
function vanaf01(k, v) {
  const x = k.min + clamp01(v) * (k.max - k.min);
  const r = k.step ? Math.round((x - k.min) / k.step) * k.step + k.min : x;
  return Math.max(k.min, Math.min(k.max, +r.toFixed(6)));
}

/** Kan deze omgeving de vormen in een Worker draaien? */
export function kanWerker() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
}
const standaardWerker = () => new Worker(new URL('./werker.js', import.meta.url), { type: 'module' });
const standaardKlok = () => performance.now();

export class VormLaag extends Emitter {
  /**
   * @param maakCanvas (w, h) -> canvas met getContext('2d')
   * @param zaad       begin van het toeval; zelfde zaad = zelfde beeld
   * @param breedte, hoogte  het doek in pixels (standaard 640 × 360)
   * @param werker     undefined = automatisch (Worker als het kan), false =
   *                   hoofdthread, of een functie die een Worker(-achtig) maakt
   * @param budgetMs   ms per beeld; standaard 4 op de hoofdthread, 12 in de Worker
   * @param nu         klok om te METEN (ms), alleen voor het budget
   * @param kwaliteit  beginstand van g.kwaliteit
   */
  constructor({ maakCanvas, systeem = SYSTEMEN[0].id, zaad = 1, breedte = LAAG_BREEDTE, hoogte = LAAG_HOOGTE,
    werker, budgetMs, nu = standaardKlok, kwaliteit }) {
    super();
    this.maakCanvas = maakCanvas;
    this.zaad = zaad;
    this.canvas = maakCanvas(breedte, hoogte);
    this.ctx = this.canvas.getContext('2d');
    this.breedte = breedte;
    this.hoogte = hoogte;
    this.nu = nu;
    this.aan = false;
    this.dekking = 0.8;
    this.mengvorm = MENGVORMEN[0];
    this.kwaliteitPer = {};             // per systeem wat hij de vorige keer haalde
    this.kwaliteit = 1;
    this.ms = null;                     // EMA van de rekentijd per beeld
    this.teZwaar = false;
    this.versie = 0;                    // telt elk beeld waarin iets getekend is
    this.eigenBudget = budgetMs;

    this.werker = null;
    const maak = werker === undefined ? (kanWerker() ? standaardWerker : null) : (werker || null);
    if (maak) {
      try { this._startWerker(maak); } catch (e) { this.werker = null; this.werkerFout = e.message; }
    }
    this.modus = this.werker ? 'werker' : 'hoofd';
    this.budgetMs = budgetMs ?? (this.werker ? BUDGET_WERKER : BUDGET_HOOFD);
    if (!this.werker) this.budget = new Budget({ ms: this.budgetMs });
    else {
      // Tot het eerste beeld binnen is: de achtergrond van een vorm, die de
      // shader eraf trekt. Zo is er altijd iets om te uploaden.
      this.ctx.fillStyle = ACHTERGROND;
      this.ctx.fillRect(0, 0, breedte, hoogte);
    }
    this.zetSysteem(systeem, kwaliteit);
  }

  zetSysteem(id, kwaliteit) {
    const sys = SYSTEEM[id] ?? SYSTEMEN[0];
    if (this.sys) this.kwaliteitPer[this.sys.id] = this.kwaliteit;
    this.sys = sys;
    this.knoppen = draaiKnoppen(sys);
    this.p = Object.fromEntries(sys.knobs.map((k) => [k.k, k.v]));
    this.stand = this.knoppen.map((k) => naar01(k, k.v));
    this.mod = this.knoppen.map(() => 0);
    this.kwaliteit = kwaliteit ?? this.kwaliteitPer[sys.id] ?? 1;
    this.ms = null;
    this.teZwaar = false;
    this.laatst = null;
    if (this.werker) {
      this._post({ type: 'kies', systeem: sys.id, zaad: this.zaad, breedte: this.breedte, hoogte: this.hoogte,
        budgetMs: this.budgetMs, kwaliteit: this.kwaliteit });
      return;
    }
    this._initHier();
  }

  /** Het systeem hier opstarten (hoofd-modus), met de parameters zoals ze staan. */
  _initHier() {
    this.budget.herstel(this.kwaliteit);
    // Eén context voor alle systemen van deze laag: zonder terugzetten lekt
    // lineCap='round' van lz/bd/dp naar fl en sf, en imageSmoothingEnabled=false
    // van ec/cc naar de rest. In het origineel had elk systeem een eigen canvas.
    const c = this.ctx;
    if (typeof c.reset === 'function') c.reset();
    else Object.assign(c, { lineCap: 'butt', lineJoin: 'miter', lineWidth: 1, globalAlpha: 1, imageSmoothingEnabled: true, globalCompositeOperation: 'source-over' });
    c.fillStyle = ACHTERGROND; c.fillRect(0, 0, this.breedte, this.hoogte);
    this.s = { o: {}, e: {} };
    // W, H en D: hulp.js, maten().
    this.g = {
      ctx: this.ctx, ...maten(this.breedte, this.hoogte), t: 0, kwaliteit: this.kwaliteit,
      pal: this.sys.pal, L: LUTS[this.sys.pal], r: maakRng(this.zaad), maakCanvas: this.maakCanvas,
    };
    this.laatst = null;
    this.sys.init.call(this.sys, this.s, this.p, this.g);
  }

  /** Stand van knop i als 0..1, of null als het systeem die knop niet heeft. */
  leesKnop(i) { return i < this.stand.length ? this.stand[i] : null; }
  zetKnop(i, v) {
    const k = this.knoppen[i];
    if (!k) return;
    this.stand[i] = clamp01(v);
    this.zetParams({ [k.k]: vanaf01(k, this.stand[i] + this.mod[i]) });
  }
  /**
   * Modulatie (src/analysis/router.js): een offset BOVENOP de knopstand. De
   * stand (leesKnop, dus scherm, LED-ring en soft-takeover) blijft staan; het
   * systeem rekent vanaf de volgende stap met stand + offset. Via zetParams,
   * dus in werker-modus gaat hij mee naar de Worker.
   */
  zetModulatie(i, offset) {
    const k = this.knoppen[i];
    if (!k || this.mod[i] === offset) return;
    this.mod[i] = offset;
    this.zetParams({ [k.k]: vanaf01(k, this.stand[i] + offset) });
  }
  /** De echte waarde, in de eenheid van het systeem: voor het scherm. */
  waarde(i) { const k = this.knoppen[i]; return k ? this.p[k.k] : null; }

  /**
   * Parameters in de eenheid van het systeem zetten ({ naam: waarde }). Alles
   * wat een parameter verandert komt hier langs (knoppen, straks modulatie):
   * op de hoofdthread leest het systeem `this.p` direct, in werker-modus gaat
   * het als bericht mee. Onbekende namen en geen getal: genegeerd.
   */
  zetParams(p) {
    const schoon = {};
    for (const [k, v] of Object.entries(p)) if (k in this.p && Number.isFinite(v)) { this.p[k] = v; schoon[k] = v; }
    if (this.werker) this._post({ type: 'params', p: schoon });
  }

  /** Kwaliteit met de hand (0,25..1); de regeling gaat daarna vanaf daar verder. */
  zetKwaliteit(v) {
    if (this.werker) { this.kwaliteit = Math.max(KWALITEIT_MIN, Math.min(1, v)); this._post({ type: 'kwaliteit', v }); return; }
    this.budget.zet(v);
    this.kwaliteit = this.g.kwaliteit = this.budget.kwaliteit;
  }

  /**
   * Bijwerken tot tijd t (seconden, audioklok) en iets teruggeven dat de
   * mixer kan uploaden: het canvas, of in werker-modus het laatste ImageBitmap.
   * De eerste keer één stap, daarna zoveel stappen als er tijd verstreken is.
   */
  frame(t) {
    if (this.werker) return this._vraagWerker(t);
    let n;
    if (this.laatst === null || t < this.laatst || t - this.laatst > 1) {
      this.laatst = t;                         // begin, terug in de tijd, of lang stil: opnieuw ijken
      n = 1;
    } else {
      n = Math.floor((t - this.laatst) / STAP + 1e-9);
      if (n <= 0) return this.canvas;
      this.laatst += n * STAP;
      if (n > MAX_STAPPEN) { n = MAX_STAPPEN; this.laatst = t; }
    }
    const t0 = this.nu();
    for (let i = 0; i < n; i++) this._stap(this.laatst - (n - 1 - i) * STAP);
    this._gemeten(this.nu() - t0);
    this.versie++;
    return this.canvas;
  }

  _stap(t) {
    this.g.t = t;
    this.sys.step.call(this.sys, this.s, this.p, this.g);
  }

  /** Eén beeld gemeten (hoofd-modus): budget bijwerken, g.kwaliteit volgt. */
  _gemeten(duur) {
    const r = this.budget.meet(duur);
    this.ms = this.budget.ema;
    this.teZwaar = this.budget.teZwaar;
    if (r.veranderd) this.kwaliteit = this.g.kwaliteit = r.kwaliteit;
    if (r.noodrem) this.emit('noodrem', { systeem: this.sys.id, ms: duur, budget: this.budget.ms, kwaliteit: r.kwaliteit });
  }

  // ---- werker-modus --------------------------------------------------------

  _startWerker(maak) {
    const w = maak();
    this.werker = w;
    this.bezig = false;           // er staat een frame-verzoek uit
    this.beeld = null;            // het laatst ontvangen ImageBitmap
    this.nieuwBeeld = false;
    this.gevraagd = null;         // audiotijd van het openstaande verzoek (zonder vooruit)
    this.gestuurd = null;         // de laatst gestuurde tijd (met vooruit)
    this.vooruit = 0;             // hoeveel audiotijd er zit tussen vragen en tonen
    w.addEventListener('message', (e) => this._ontvang(e.data));
    w.addEventListener('error', (e) => { e?.preventDefault?.(); this._naarHier(e?.message || 'de Worker startte niet'); });
    w.addEventListener('messageerror', () => this._naarHier('bericht van de Worker onleesbaar'));
  }

  _post(m) {
    try { this.werker.postMessage(m); } catch (e) { this._naarHier(e.message); }
  }

  /**
   * Een beeld van de Worker komt een beeld later op het scherm. Dat verschil
   * meten we op de audioklok en vragen we de Worker vooruit, zodat de vorm
   * valt op wat je HOORT. Nooit terug in de tijd door een krimpende schatting
   * (stilstaande klok): dan zou de vorm opnieuw ijken en toch bewegen.
   */
  _vraagWerker(t) {
    if (this.nieuwBeeld) {
      this.nieuwBeeld = false;
      const d = t - this.gevraagd;
      if (d >= 0 && d < 0.25) this.vooruit += 0.2 * (d - this.vooruit);
    }
    if (!this.bezig) {
      let tw = t + this.vooruit;
      if (this.gestuurd !== null && tw < this.gestuurd && tw > this.gestuurd - 1) tw = this.gestuurd;
      this.bezig = true;
      this.gevraagd = t;
      this.gestuurd = tw;
      this._post({ type: 'frame', t: tw });
    }
    return this.beeld ?? this.canvas;
  }

  _ontvang(m) {
    if (!this.werker || !m) return;
    if (m.type === 'beeld') {
      this.bezig = false;
      if (m.bitmap) {
        // Het vorige beeld is al geüpload (dat gebeurt synchroon in teken):
        // vrijgeven, anders houdt de GPU-kant ze vast tot de GC langskomt.
        this.beeld?.close?.();
        this.beeld = m.bitmap;
        this.nieuwBeeld = true;
        this.versie++;
      }
      this.ms = m.ms;
      this.kwaliteit = m.kwaliteit;
      this.teZwaar = !!m.teZwaar;
    } else if (m.type === 'noodrem') {
      this.kwaliteit = m.kwaliteit;
      this.emit('noodrem', { systeem: m.systeem, ms: m.ms, budget: m.budget, kwaliteit: m.kwaliteit });
    } else if (m.type === 'fout') {
      this.bezig = false;
      this.emit('fout', { systeem: this.sys.id, bericht: m.bericht });
    }
  }

  /** De Worker valt weg: verder op de hoofdthread, met de parameters zoals ze staan. */
  _naarHier(reden) {
    if (!this.werker) return;
    try { this.werker.terminate(); } catch (_) {}
    this.werker = null;
    this.beeld?.close?.();
    this.beeld = null;
    this.bezig = false;
    this.modus = 'hoofd';
    this.budgetMs = this.eigenBudget ?? BUDGET_HOOFD;
    this.budget = new Budget({ ms: this.budgetMs });
    this.ms = null;
    this._initHier();
    this.emit('modus', { modus: 'hoofd', reden });
  }

  /** Worker stoppen en het laatste beeld vrijgeven. */
  sluit() {
    try { this.werker?.terminate(); } catch (_) {}
    this.werker = null;
    this.beeld?.close?.();
    this.beeld = null;
  }
}

/**
 * De lagen samen, met één GEKOZEN laag: daar werken de device knobs op
 * (mapje "vorm"), Bank ◀ ▶ kiest. 'change' bij elke wissel van systeem,
 * keuze, aan/uit of mengvorm — voor het scherm; knoppen en dekking volgt
 * het scherm zelf via read(). 'noodrem', 'modus' en 'fout' van een laag
 * komen hier door, met `laag` (index) erbij.
 */
export class VormLagen extends Emitter {
  constructor({ maakCanvas, aantal = AANTAL_LAGEN, werker, nu, budgetMs }) {
    super();
    // Elke laag een ander systeem en zaad, zodat twee lagen niet hetzelfde tonen.
    this.lagen = Array.from({ length: aantal }, (_, i) =>
      new VormLaag({ maakCanvas, systeem: SYSTEMEN[(i * 2) % SYSTEMEN.length].id, zaad: 1 + i, werker, nu, budgetMs }));
    this.lagen.forEach((laag, i) => {
      for (const soort of ['noodrem', 'modus', 'fout']) laag.on(soort, (info) => this.emit(soort, { laag: i, ...info }));
    });
    this.gekozen = 0;
  }

  get laag() { return this.lagen[this.gekozen]; }
  kies(i) {
    const n = (i + this.lagen.length) % this.lagen.length;
    if (n === this.gekozen) return;
    this.gekozen = n;
    this.emit('change');
  }
  stapSysteem(richting, laag = this.laag) {
    const i = SYSTEMEN.findIndex((s) => s.id === laag.sys.id);
    laag.zetSysteem(SYSTEMEN[(i + richting + SYSTEMEN.length) % SYSTEMEN.length].id);
    this.emit('change');
  }
  zetSysteem(id, laag = this.laag) { laag.zetSysteem(id); this.emit('change'); }
  wisselAan(laag = this.laag) { laag.aan = !laag.aan; this.emit('change'); }
  volgendeMengvorm(laag = this.laag) {
    laag.mengvorm = MENGVORMEN[(MENGVORMEN.indexOf(laag.mengvorm) + 1) % MENGVORMEN.length];
    this.emit('change');
  }
  zetDekking(v, laag = this.laag) { laag.dekking = clamp01(v); }
}
