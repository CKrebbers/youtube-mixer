/**
 * De uitlijnweergave, het tekenen (werkruimte S2, docs/werkruimte/S2.md).
 * Het rekenwerk staat in reken.js (puur); dit bestand maakt er een stuk DOM
 * van in een element, in elk document: het werkvak van de mixer, het losse
 * venster (uitlijn.html), straks een paneel op de iPad.
 *
 * DE KOSTEN (CLAUDE.md: elke teken-actie is een upload naar de GPU):
 *   - Per track een VOORGETEKENDE STROOK in tracktijd (golfvorm, gevonden
 *     tellen, klappen), in tegels van TEGEL px op een zoom die een macht van
 *     2 is. Een tegel wordt één keer getekend en bewaard (hooguit TEGELS per
 *     track).
 *   - Per baan één doek. Dat wordt alleen opnieuw getekend als de SLEUTEL
 *     verandert (reken.js `sleutel`: segment, grid, pagina, breedte, zoom,
 *     inhoud): drawImage uit de tegels met schaal tel × rate, plus de
 *     gridlijnen als rechthoekjes (scherp, op de halve pixel goed).
 *   - De speelkop is een CSS-transform. Wat er op een doek staat en
 *     verschuift (pauze, de maatgever stil, drift) schuift ook met een
 *     transform; pas als het meer dan een kwart pagina is, opnieuw tekenen.
 *   - Getallen: tekst alleen schrijven als hij verandert. Muziek Δ twee keer
 *     per tel, niet elk beeld.
 *   - Geen opmaak lezen in een lus: de breedte komt van een ResizeObserver.
 *
 * Vormen: 'pagina' (standaard: twee maten, slaat om), 'strook' (één maat,
 * klein: het werkvak) en 'vouw' (per track één maat, elke gehoorde tel een
 * stip op zijn fase).
 *
 * Een baan slepen = `track.N.phase.offset` (spoor S1) met de versleepte
 * fractie, als die action bestaat (`metaOf`); anders gebeurt er niets.
 * Naar rechts slepen = later (de track terug duwen).
 */

import { maakAs, getallen, faseTussen, stukken, lijnen, sleutel, zoomVoor, verschuiving, ijkpunt, vouw, kleurVan, gehoord, alsGrid } from './reken.js';

export const VORMEN = ['pagina', 'strook', 'vouw'];
/**
 * De namen waarmee een werkruimte (docs/WERKRUIMTE.md B2, `werkvak`/`vakken`) de weergave
 * plaatst, met hun vorm. Data, geen code: Clay schrijft "uitlijn-vouw" in zijn werkruimte.
 * Een vak `uitlijn:<vorm>:<maten>` mag ook (bv. "uitlijn:pagina:1").
 */
export const VAKKEN = { uitlijn: 'pagina', 'uitlijn-pagina': 'pagina', 'uitlijn-strook': 'strook', 'uitlijn-vouw': 'vouw' };
/** Vaknaam -> { vorm, maten }, of null als het geen uitlijnvak is. Puur. */
export function vakVorm(naam) {
  if (typeof naam !== 'string') return null;
  if (VAKKEN[naam]) return { vorm: VAKKEN[naam], maten: 2 };
  const m = /^uitlijn:(pagina|strook|vouw)(?::([12]))?$/.exec(naam);
  return m ? { vorm: m[1], maten: m[2] === '1' ? 1 : 2 } : null;
}
/** Breedte van een tegel van de strook (px). */
const TEGEL = 1024;
/** Zoveel tegels per track bewaren (de laatst gebruikte). */
const TEGELS = 24;
/** Hoogte van een baan per vorm (css px). */
const HOOGTE = { pagina: 46, strook: 16, vouw: 46 };
/**
 * Zoveel pagina's links en rechts extra op een doek: ruimte om te verschuiven zonder te tekenen
 * (pas bij de helft ervan opnieuw). Meer marge = meer pixels per tekenbeurt.
 */
const MARGE = 0.25;

const KLEUREN = { golf: 'rgba(160,178,196,.55)', golfStil: 'rgba(160,178,196,.3)', een: '#dfe7ee', tel: 'rgba(223,231,238,.45)',
  telStreep: 'rgba(74,217,196,.95)', klap: 'rgba(255,190,60,.8)', wacht: 'rgba(223,231,238,.5)', eigen: '#4ad9c4', mg: 'rgba(223,231,238,.55)',
  as: 'rgba(223,231,238,.35)', asEen: '#dfe7ee', asTekst: '#8a96a2' };

const fmt = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d).replace('.', ',')}`);
const fmtBpm = (b) => (Number.isFinite(b) ? b.toFixed(2).replace('.', ',') : '–');
/** `hidden` alleen zetten als hij verandert. */
function zichtbaar(el, aan) { if (el._h !== aan) { el.hidden = !aan; el._h = aan; } }
/** Een getal voor data-ms: twee decimalen, nooit "-0.00". */
const msTekst = (x) => { const r = Math.round(x * 100) / 100; return (r === 0 ? 0 : r).toFixed(2); };
const nu = () => (globalThis.performance?.now?.() ?? Date.now());

/** Tekst en klasse van een element alleen zetten als ze veranderen. */
function zet(el, tekst, klasse) {
  if (el._t !== tekst) { el.textContent = tekst; el._t = tekst; }
  if (klasse !== undefined && el._k !== klasse) { el.className = klasse; el._k = klasse; }
}

/** De voorgetekende strook van één track: tegels in tracktijd. */
class Strook {
  constructor(doc, hoogte) { this.doc = doc; this.h = hoogte; this.tegels = new Map(); this.inhoud = null; this.getekend = 0; }
  /** Leeg als de inhoud (peaks, tellen, klappen) of de hoogte verandert. */
  bij(baan, h) {
    if (this.inhoud !== baan.inhoud || this.h !== h) { this.tegels.clear(); this.inhoud = baan.inhoud; this.h = h; }
  }
  tegel(baan, z, i) {
    const k = z * 1e6 + i;
    let c = this.tegels.get(k);
    if (c) { this.tegels.delete(k); this.tegels.set(k, c); return c; }      // als laatst gebruikt
    c = this.doc.createElement('canvas');
    c.width = TEGEL; c.height = this.h;
    this._teken(c.getContext('2d'), baan, z, i);
    this.getekend++;
    this.tegels.set(k, c);
    if (this.tegels.size > TEGELS) this.tegels.delete(this.tegels.keys().next().value);
    return c;
  }
  _teken(g, baan, z, i) {
    const h = this.h, t0 = (i * TEGEL) / z, dt = 1 / z;
    const pk = baan.peaks;
    if (pk?.peaks && pk.count && baan.duur) {
      const bps = pk.count / baan.duur, data = pk.peaks;
      // Eén pad met een rechthoek per kolom en één fill: één tekenopdracht, geen 1024
      // (elke opdracht is werk voor de GPU-draad; gemeten 14 okt, docs/werkruimte/S2.md).
      g.fillStyle = KLEUREN.golf;
      g.beginPath();
      for (let x = 0; x < TEGEL; x++) {
        const ta = t0 + x * dt;
        if (ta < 0 || ta > baan.duur) continue;
        let b0 = Math.floor(ta * bps), b1 = Math.max(b0 + 1, Math.ceil((ta + dt) * bps));
        if (b1 > pk.count) b1 = pk.count;
        let mn = 1, mx = -1;
        for (let b = b0; b < b1; b++) { const lo = data[2 * b], hi = data[2 * b + 1]; if (lo < mn) mn = lo; if (hi > mx) mx = hi; }
        if (mx < mn) continue;
        const y0 = (1 - mx) * h / 2, y1 = (1 - mn) * h / 2;
        g.rect(x, y0, 1, Math.max(1, y1 - y0));
      }
      g.fill();
    }
    // Gevonden tellen onderaan, klappen bovenaan (korte streepjes).
    const streep = (rij, kleur, y, hoog) => {
      if (!rij?.length) return;
      g.fillStyle = kleur;
      let lo = 0, hi = rij.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (rij[m] < t0) lo = m + 1; else hi = m; }
      const t1 = t0 + TEGEL / z;
      g.beginPath();
      for (let k = lo; k < rij.length && rij[k] < t1; k++) g.rect(Math.round((rij[k] - t0) * z) - 1, y, 2, hoog);
      g.fill();
    };
    streep(baan.tellen, KLEUREN.telStreep, h - Math.max(3, h * 0.12), Math.max(3, h * 0.12));
    streep(baan.klappen, KLEUREN.klap, 0, Math.max(2, h * 0.08));
  }
  /** Tracktijd [p0, p1] naar x [x0, x1] op het doek. */
  tekenOp(g, baan, z, p0, p1, x0, x1) {
    if (!(p1 > p0)) return;
    const lo = Math.max(0, p0), hi = Math.min(baan.duur || p1, p1);
    if (!(hi > lo)) return;
    const schaal = (x1 - x0) / (p1 - p0);
    for (let i = Math.floor((lo * z) / TEGEL); i * TEGEL / z < hi; i++) {
      const ta = (i * TEGEL) / z, tb = ((i + 1) * TEGEL) / z;
      const a = Math.max(lo, ta), b = Math.min(hi, tb);
      if (!(b > a)) continue;
      const c = this.tegel(baan, z, i);
      g.drawImage(c, (a - ta) * z, 0, (b - a) * z, this.h, x0 + (a - p0) * schaal, 0, (b - a) * schaal, this.h);
    }
  }
}

export class UitlijnWeergave {
  /**
   * @param el      het element waarin de weergave komt (elk document)
   * @param opties  { invoer: () => { decks, maatgever, V, nu } (reken.js),
   *                  vorm, maten (1|2, standaard 2; strook altijd 1),
   *                  invoke, metaOf, read (de bus van de mixer: alleen voor slepen),
   *                  breedte (vast, voor tests; anders gemeten), dpr }
   */
  constructor(el, { invoer, vorm = 'pagina', maten = 2, invoke = null, metaOf = null, read = null, breedte = null, dpr = null, marge = MARGE } = {}) {
    this.el = el;
    this.doc = el.ownerDocument;
    this._invoer = invoer;
    this._invoke = invoke; this._metaOf = metaOf; this._read = read;
    this.vorm = VORMEN.includes(vorm) ? vorm : 'pagina';
    this.maten = maten === 1 ? 1 : 2;
    this.marge = marge;
    this.dpr = dpr ?? (this.doc.defaultView?.devicePixelRatio || 1);
    this.breedte = breedte ?? 0;
    this._vasteBreedte = breedte != null;
    this.stats = { beelden: 0, tekenbeurten: 0, px: 0, rekenMs: 0, rekenMax: 0, rekenSom: 0, tekenMs: 0 };
    this._rijen = new Map();
    this._stroken = new Map();
    this._ids = '';
    this._as = null;
    this._sleep = this._sleep.bind(this);
    this._bouw();
  }

  _maak(tag, klasse, ouder) {
    const e = this.doc.createElement(tag);
    if (klasse) e.className = klasse;
    if (ouder) ouder.appendChild(e);
    return e;
  }

  _bouw() {
    this.root = this._maak('div', `ul ul-${this.vorm}`, this.el);
    const kop = this._maak('div', 'ul-kop', this.root);
    this._mg = this._maak('div', 'ul-mg', kop);
    this._asVlak = this._maak('div', 'ul-asvlak', kop);
    this._asDoek = this._maak('canvas', 'ul-as', this._asVlak);
    this._banen = this._maak('div', 'ul-banen', this.root);
    this._kopVlak = this._maak('div', 'ul-kopvlak', this.root);
    this._kop = this._maak('div', 'ul-kopstreep', this._kopVlak);
    this._leeg = this._maak('div', 'ul-leeg', this.root);
    zet(this._leeg, 'geen maatgever: laad een nummer met een grid');
    this._asSleutel = '';
    // Slepen: één luisteraar op de banen (pointer events, ook met een vinger).
    this._omlaag = (e) => {
      const rij = e.target?.closest?.('.ul-baan');
      if (!rij || e.button > 0) return;
      e.preventDefault?.();
      e.target.setPointerCapture?.(e.pointerId);
      this._sleepX0 = e.clientX;
      this._sleep(rij.dataset.deck, 0);
    };
    this._beweeg = (e) => { if (this._sleepStaat) this._sleep(this._sleepStaat.id, e.clientX - this._sleepX0); };
    this._los = () => this._sleepLos();
    this._banen.addEventListener('pointerdown', this._omlaag);
    this._banen.addEventListener('pointermove', this._beweeg);
    this._banen.addEventListener('pointerup', this._los);
    this._banen.addEventListener('pointercancel', this._los);
    // De breedte van het tekenvlak: van een ResizeObserver, nooit in een lus gelezen.
    const RO = this.doc.defaultView?.ResizeObserver;
    if (!this._vasteBreedte && RO) {
      this._ro = new RO((items) => {
        const w = Math.round(items[0]?.contentRect?.width || 0);
        if (w && w !== this.breedte) this.zetBreedte(w);
      });
      this._ro.observe(this._asVlak);
    }
  }

  get _tellenPerPagina() { return this.vorm === 'strook' ? 1 : this.maten; }

  zetVorm(vorm) {
    if (!VORMEN.includes(vorm) || vorm === this.vorm) return;
    this.vorm = vorm;
    this.root.className = `ul ul-${vorm}`;
    for (const r of this._rijen.values()) { r.sleutel = ''; r.vouwSleutel = ''; }
    this._asSleutel = '';
    this._zetMaten();
  }

  zetMaten(n) { this.maten = n === 1 ? 1 : 2; this._asSleutel = ''; for (const r of this._rijen.values()) r.sleutel = ''; }

  zetBreedte(w) {
    this.breedte = Math.max(0, Math.round(w));
    this._zetMaten();
  }

  /** De maten van de doeken (alleen bij een andere breedte, vorm of rij: geen opmaak per beeld). */
  _zetMaten() {
    const w = this.breedte, d = this.dpr;
    this._asDoek.width = Math.max(1, Math.round(w * d)); this._asDoek.height = Math.round(14 * d);
    this._asDoek.style.width = `${w}px`;
    this._asSleutel = '';
    for (const r of this._rijen.values()) this._maatRij(r);
  }

  _maatRij(r) {
    const w = this.breedte, d = this.dpr, h = HOOGTE[this.vorm];
    const breed = this.vorm === 'vouw' ? 1 : 1 + 2 * this.marge;
    r.doek.width = Math.max(1, Math.round(w * breed * d)); r.doek.height = Math.round(h * d);
    r.doek.style.width = `${w * breed}px`; r.doek.style.height = `${h}px`;
    r.doek.style.left = this.vorm === 'vouw' ? '0px' : `${-w * this.marge}px`;
    r.doek.style.transform = ''; r.dx = 0;
    r.sleutel = ''; r.vouwSleutel = '';
  }

  _rij(baan) {
    let r = this._rijen.get(baan.id);
    if (r) return r;
    const rij = this._maak('div', 'ul-baan', this._banen);
    rij.dataset.deck = baan.id;
    const info = this._maak('div', 'ul-info', rij);
    r = {
      el: rij, info,
      nr: this._maak('b', 'ul-nr', info), bpm: this._maak('span', 'ul-bpm', info),
      grid: this._maak('span', 'ul-g', info), muz: this._maak('span', 'ul-g', info),
      drift: this._maak('span', 'ul-g', info), maat: this._maak('span', 'ul-g', info),
      warn: this._maak('span', 'ul-warn', info), staat: this._maak('span', 'ul-staat', info),
      vlak: this._maak('div', 'ul-vlak', rij), sleutel: '', vouwSleutel: '', ref: null, dx: 0, muziek: null, muziekSleutel: '',
    };
    r.doek = this._maak('canvas', 'ul-doek', r.vlak);
    this._maatRij(r);
    this._rijen.set(baan.id, r);
    return r;
  }

  /** Eén beeld. `t` wordt niet gebruikt: alles komt van de audioklok in de invoer (regel 3). */
  stap() {
    if (!this.breedte) return;
    const t0 = nu();
    const inv = this._invoer?.();
    if (!inv) return;
    const as = maakAs(inv, { maten: this._tellenPerPagina });
    this._as = as;
    const decks = inv.decks || [];
    const ids = decks.map((d) => d.id).join();
    if (ids !== this._ids) {
      for (const [id, r] of this._rijen) if (!decks.some((d) => d.id === id)) { r.el.remove(); this._rijen.delete(id); this._stroken.delete(id); }
      // In de volgorde van de tracks.
      for (const d of decks) this._banen.appendChild(this._rij(d).el);
      this._ids = ids;
    }
    // Het rekenwerk van dit beeld (zonder tekenen).
    const rekening = [];
    if (as) {
      for (const baan of decks) {
        const r = this._rij(baan);
        const gt = getallen(baan, as, { muziek: false });
        // Muziek Δ twee keer per tel (of bij een nieuw segment), niet elk beeld.
        if (gt && !gt.maatgever) {
          const mk = `${baan.tijdlijn?.segId}:${as.M.tijdlijn.segId}:${Math.floor(as.bM * 2)}:${baan.inhoud}`;
          if (mk !== r.muziekSleutel) { r.muziek = faseTussen(baan, as); r.muziekSleutel = mk; }
          gt.muziek = r.muziek;
          gt.kleur.muziek = kleurVan(r.muziek?.ms);
        }
        rekening.push([baan, r, gt]);
      }
    }
    const t1 = nu();
    const ms = t1 - t0;
    this.stats.rekenMs = this.stats.beelden ? this.stats.rekenMs * 0.95 + ms * 0.05 : ms;
    if (ms > this.stats.rekenMax) this.stats.rekenMax = ms;
    this.stats.rekenSom += ms;
    this.stats.beelden++;
    // Alleen schrijven wat verandert: ook een attribuut met dezelfde waarde maakt de stijl ongeldig,
    // en in het hoofdvenster kostte dat elk beeld een nieuwe raster (gemeten 14 okt, uitlijn.mjs).
    zichtbaar(this._leeg, !as);
    zichtbaar(this._kopVlak, !!as && this.vorm !== 'vouw');
    if (!as) { zet(this._mg, 'maatgever ▸ –'); return; }
    zet(this._mg, `maatgever ▸ ${as.M.nr} · ${fmtBpm(60 / as.Lc)}`);
    // De speelkop: alleen een transform.
    const kx = Math.round(as.kop * this.breedte * 10) / 10;
    if (kx !== this._kx) { this._kop.style.transform = `translateX(${kx}px)`; this._kx = kx; }
    this._tekenAs(as);
    for (const [baan, r, gt] of rekening) {
      this._tekst(baan, r, gt, as);
      if (this.vorm === 'vouw') this._tekenVouw(baan, r, as);
      else this._tekenBaan(baan, r, as);
    }
    this.stats.tekenMs = nu() - t1;
  }

  _tekenAs(as) {
    const k = `${as.M.id}|${as.pagina}|${as.tellen}|${this.breedte}|${this.vorm}`;
    if (k === this._asSleutel) return;
    this._asSleutel = k;
    const c = this._asDoek, g = c.getContext('2d'), W = c.width, H = c.height, d = this.dpr;
    g.clearRect(0, 0, W, H);
    if (this.vorm === 'vouw') {
      // De tellen van één maat, gecentreerd: tel 1 … bpb.
      g.fillStyle = KLEUREN.asTekst; g.font = `${10 * d}px ui-sans-serif, system-ui, sans-serif`;
      for (let t = 0; t < as.bpb; t++) g.fillText(String(t + 1), ((t + 0.5) / as.bpb) * W - 3 * d, 11 * d);
    } else {
      g.font = `${10 * d}px ui-sans-serif, system-ui, sans-serif`;
      for (let b = 0; b < as.tellen; b++) {
        const x = Math.round((b / as.tellen) * W);
        const een = as.g.isMaatbegin(as.pagina + b);
        g.fillStyle = een ? KLEUREN.asEen : KLEUREN.as;
        g.fillRect(x, een ? 0 : H * 0.5, een ? 2 * d : d, een ? H : H * 0.5);
        if (een) { g.fillStyle = KLEUREN.asTekst; g.fillText(String(Math.round(b / as.bpb) + 1), x + 4 * d, 10 * d); }
      }
    }
    this.stats.tekenbeurten++; this.stats.px += W * H;
  }

  _tekst(baan, r, gt, as) {
    zet(r.nr, String(baan.nr), `ul-nr${baan.id === as.M.id ? ' mg' : ''}`);
    if (!gt) { zet(r.bpm, '–'); zet(r.grid, ''); zet(r.muz, ''); zet(r.drift, ''); zet(r.maat, ''); zet(r.warn, ''); zet(r.staat, 'geen grid'); return; }
    zet(r.bpm, fmtBpm(gt.bpm));
    const tl = baan.tijdlijn;
    const staat = gt.maatgever ? '(maatgever)' : gt.wacht ? `wacht · valt in over ${fmt(gt.wacht.maten).replace('+', '')} maat`
      : !tl?.speelt ? 'pauze' : '';
    zet(r.staat, staat);
    zet(r.warn, gt.afwijking ? `⚠ grid ${fmt(gt.afwijking.ms)} ms naast de tellen` : '');
    if (gt.maatgever) { zet(r.grid, ''); zet(r.muz, ''); zet(r.drift, ''); zet(r.maat, ''); if (r.grid.dataset.ms !== '') r.grid.dataset.ms = ''; return; }
    const kort = this.vorm === 'strook';
    zet(r.grid, kort ? '' : `grid ${fmt(gt.grid)}`, `ul-g ${gt.kleur.grid ?? ''}`);
    const m = gt.muziek;
    zet(r.muz, m ? `${kort ? '' : 'muz '}${fmt(m.ms)}${m.grof ? ' ±15' : ''}` : (kort ? fmt(gt.grid) : 'muz –'),
      `ul-g ${(m ? gt.kleur.muziek : (kort ? gt.kleur.grid : '')) ?? ''}${m?.grof ? ' grof' : ''}`);
    zet(r.drift, kort ? '' : `drift ${fmt(gt.drift)}/16`, `ul-g ${gt.kleur.drift ?? ''}`);
    zet(r.maat, kort ? (gt.maat ? `${fmt(gt.maat, 0)}t` : '') : `maat ${gt.maat ? fmt(gt.maat, 0) : '0'}`, `ul-g ${gt.maat ? 'rood' : ''}`);
    const ds = msTekst(gt.grid);
    if (r.grid.dataset.ms !== ds) r.grid.dataset.ms = ds;
    const dm = m ? msTekst(m.ms) : '';
    if (r.muz.dataset.ms !== dm) r.muz.dataset.ms = dm;
  }

  _strook(baan, h) {
    let s = this._stroken.get(baan.id);
    if (!s) { s = new Strook(this.doc, h); this._stroken.set(baan.id, s); }
    s.bij(baan, h);
    return s;
  }

  _tekenBaan(baan, r, as) {
    const W = r.doek.width;
    const z = zoomVoor(baan, as, (W / (1 + 2 * this.marge)));
    const k = `${sleutel(baan, as, this.breedte, z)}|${this.vorm}|${this.dpr}`;
    if (k === r.sleutel) {
      // Niets nieuws: hooguit verschuiven (transform), pas bij een kwart pagina opnieuw tekenen.
      const dx = verschuiving(baan, as, r.ref);
      if (Math.abs(dx) < this.marge / 2 * as.tellen) {
        const px = Math.round((dx / as.tellen) * this.breedte * 10) / 10;
        if (px !== r.dx) { r.doek.style.transform = px ? `translateX(${px}px)` : ''; r.dx = px; }
        return;
      }
    }
    r.sleutel = k;
    r.ref = ijkpunt(baan, as);
    if (r.dx) { r.doek.style.transform = ''; r.dx = 0; }
    const g = r.doek.getContext('2d'), H = r.doek.height, d = this.dpr;
    const xa = as.pagina - this.marge * as.tellen, xb = as.pagina + (1 + this.marge) * as.tellen;
    const naarPx = (x) => ((x - xa) / (xb - xa)) * W;
    g.clearRect(0, 0, W, H);
    const st = stukken(baan, as, xa, xb);
    const strook = this._strook(baan, H);
    const stil = st.length && st.every((s) => s.soort === 'stil');
    g.globalAlpha = stil ? 0.5 : 1;
    for (const s of st) {
      if (s.soort === 'wacht') {
        // Wat er straks valt: gestippeld.
        g.fillStyle = KLEUREN.wacht;
        const a = naarPx(s.x0), b = naarPx(s.x1);
        for (let x = Math.ceil(a / (6 * d)) * 6 * d; x < b; x += 6 * d) g.fillRect(x, H / 2 - d / 2, 3 * d, d);
        continue;
      }
      strook.tekenOp(g, baan, z, s.p0, s.p1, naarPx(s.x0), naarPx(s.x1));
    }
    // De gridlijnen van de track op zijn eigen tellen: de "1" vol, de rest kort.
    const ls = lijnen(baan, st);
    g.fillStyle = KLEUREN.tel;
    g.beginPath();
    for (const l of ls) if (!l.een) g.rect(naarPx(l.x) - d / 2, H * 0.22, d, H * 0.56);
    g.fill();
    g.fillStyle = KLEUREN.een;
    g.beginPath();
    for (const l of ls) if (l.een) g.rect(naarPx(l.x) - d, 0, 2 * d, H);
    g.fill();
    g.globalAlpha = 1;
    this.stats.tekenbeurten++; this.stats.px += W * H;
  }

  _tekenVouw(baan, r, as) {
    const tl = baan.tijdlijn;
    const g0 = alsGrid(baan.grid);
    if (!g0 || !tl) return;
    // Opnieuw bij een nieuwe gehoorde tel van de track of de maatgever.
    const h = gehoord(tl, as.nu, as.V, baan.duur);
    const k = `${tl.segId}:${as.M.tijdlijn.segId}:${Math.floor(g0.beatAt(h))}:${Math.floor(as.bM)}:${baan.inhoud}|${this.breedte}|${this.dpr}`;
    if (k === r.vouwSleutel) return;
    r.vouwSleutel = k;
    const v = vouw(baan, as);
    const c = r.doek, g = c.getContext('2d'), W = c.width, H = c.height, d = this.dpr;
    g.clearRect(0, 0, W, H);
    // Een lijn per tel van de maatgever (het midden van elk vak).
    g.fillStyle = KLEUREN.as;
    for (let t = 0; t < as.bpb; t++) g.fillRect(((t + 0.5) / as.bpb) * W - d / 2, 0, d, H);
    if (v) {
      const n = 32;
      for (const p of v.punten) {
        const x = ((p.tel - 1 + 0.5 + p.ms / 1000 / as.Lc) / as.bpb) * W;
        const y = 2 * d + (p.k / n) * (H - 4 * d);
        g.fillStyle = p.wie === 'eigen' ? KLEUREN.eigen : KLEUREN.mg;
        g.fillRect(x - 1.5 * d, y - 1.5 * d, 3 * d, 3 * d);
      }
    }
    this.stats.tekenbeurten++; this.stats.px += W * H;
  }

  // ---- slepen ------------------------------------------------------------

  /**
   * Een baan slepen: x = pixels sinds het indrukken (0 = begin). Een halve
   * tel slepen = een halve tel duwen, naar rechts = later. Alleen als de
   * action `track.N.phase.offset` bestaat; zijn read is 0,5 + fase (spoor S1).
   */
  _sleep(id, x) {
    const as = this._as;
    if (!as || !this.breedte) return;
    if (!this._sleepStaat || this._sleepStaat.id !== id) {
      const baan = this._invoer?.()?.decks?.find((d) => d.id === id);
      const actie = baan ? `track.${baan.nr}.phase.offset` : null;
      if (!actie || !this._metaOf?.(actie) || !this._invoke) { this._sleepStaat = null; return; }
      const v0 = this._read?.(actie);
      if (!Number.isFinite(v0)) { this._sleepStaat = null; return; }
      const g = alsGrid(baan.grid), h = gehoord(baan.tijdlijn, as.nu, as.V, baan.duur);
      const Li = g ? g.beatLengthAt(h) / (baan.tijdlijn.rate > 0 ? baan.tijdlijn.rate : 1) : as.Lc;
      this._sleepStaat = { id, actie, v0, verhouding: as.Lc / Li, laatst: null };
      return;
    }
    const s = this._sleepStaat;
    const tellen = (x / this.breedte) * as.tellen * s.verhouding;
    const v = Math.max(0, Math.min(1, s.v0 - tellen));
    if (v !== s.laatst) { s.laatst = v; this._invoke(s.actie, v); }
  }

  _sleepLos() { this._sleepStaat = null; }

  vernietig() {
    this._ro?.disconnect();
    this._banen.removeEventListener('pointerdown', this._omlaag);
    this._banen.removeEventListener('pointermove', this._beweeg);
    this._banen.removeEventListener('pointerup', this._los);
    this._banen.removeEventListener('pointercancel', this._los);
    this.root.remove();
    this._rijen.clear(); this._stroken.clear();
  }
}
