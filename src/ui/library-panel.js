import { esc } from './dom.js';
import { gridStatus } from './grid-strook.js';
import { libraryToon, KIEZER } from './toon-weergave.js';
import { ToonKaart, camelot, kortNaam, volleNaam } from '../engine/toonsoort.js';
import {
  RIJ_H, PaginaCache, lijstUrl, zichtbaar, volgendeSortering, leesSortering, bewaarSortering,
  kolomSjabloon, kopHtml, cellenHtml, standaardOpslag, stemsCelHtml, klemKeuze, bladerVenster, KOLOMMEN,
} from './library-lijst.js';

/** Welke kolommen weggaan zolang de kolom INDELING open staat (spoor S11). */
export const SMAL_WEG = ['lufs', 'racks'];
import { IngestStrook } from './ingest-strook.js';
import { pastBij, pastBijKop, tempoTekst } from './past-bij.js';
import { IndelingPaneel, NUMMERS_MIME, leesSleep } from './library-indeling.js';
import { leesWeg } from '../lib/antwoord.js';

/** Wat de upload aanneemt; gelijk aan BESTAND_EXT in server/links.js. */
export const BESTAND_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'wav', 'mp3', 'flac', 'm4a', 'aiff', 'aif', 'ogg', 'opus'];
const extVan = (naam) => (/\.([A-Za-z0-9]{1,5})$/.exec(naam || '')?.[1] || '').toLowerCase();
export const isMediaBestand = (file) => BESTAND_EXT.includes(extVan(file?.name));
/** Een videobestand: aan het type of, als de browser dat niet weet (mkv), aan de naam. */
export const isVideoBestand = (file) => /^video\//.test(file?.type || '') || ['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(extVan(file?.name));

/**
 * Het library-paneel: link of eigen bestand erin, track eruit, één klik op een deck.
 *
 * Praat alleen met de server via fetch. Het laden op een deck is een callback,
 * want de UI hoort de engine niet zelf aan te sturen — dat loopt via app.js,
 * die ook de golfvorm-analyse bijhoudt.
 */


export class LibraryPanel {
  constructor({ root, onLaad, onGrid = () => {}, onToon = () => {}, decks = ['A', 'B'], label = (d) => d,
    stand = () => 'leeg', opslag = standaardOpslag(), stems = null, stemsInGebruik = () => [], focus = () => null }) {
    this.root = root;
    this.onLaad = onLaad;
    this.onGrid = onGrid;        // (trackId, grid) na "opnieuw analyseren": op de decks zetten
    this.onToon = onToon;        // (trackId, toon) na kiezen in de library: op de decks zetten
    this.stems = stems;          // de stems-rij van de server (stems-wachtrij.js), of null
    this.stemsInGebruik = stemsInGebruik;   // (trackId) => tracks die dit nummer MET stems spelen
    this.kiezer = null;          // track-id waarvan de toonsoortkiezer open staat
    this.decks = decks;
    this.label = label;
    this.stand = stand;          // (deck) => 'leeg' | 'geladen' | 'speelt'
    this.focus = focus;          // () => { deck, label, trackId, t } van de focus-track (past bij), of null
    this.pastBijAan = false;     // de knop "past bij": de lijst toont wat mixt met de focus-track
    this._pb = { sleutel: null, tracks: new Map(), html: '' };
    this.zeker = null;           // { soort, sleutel, tot } voor 'nog eens klikken'
    this.bezig = new Set();     // tracks die nu geladen worden
    this.analyseert = new Set(); // tracks waarvan grid en toonsoort nu opnieuw geanalyseerd worden
    this.melding = null;
    this.gekozen = 0;            // de rij waar je met een controller op staat (bladeren, docs/MASCHINE.md §5e)
    this.gekozenId = null;       // ...en welk NUMMER dat is: een ingest bovenaan schuift de rijen op
    this.zoek = '';
    // Spoor S11 (docs/LIBRARY-TAGS.md): wat er gekozen is (cmd-klik, shift-klik) om in één keer te
    // taggen of in een categorie te zetten, en of de lijst op de volgorde van de categorie staat.
    this.selectie = new Set();
    this._anker = null;          // de rij van de laatste klik (shift-klik = een reeks vanaf hier)
    this.plek = false;
    // De lijst: pagina's van de server, alleen zichtbare rijen getekend (library-lijst.js).
    this.opslag = opslag;
    this.sortering = leesSortering(opslag);
    this.cache = new PaginaCache(async (vraag, pagina) => {
      const r = await fetch(lijstUrl(vraag, pagina));
      const j = await r.json();
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      return j;
    });

    this.el = {
      url: root.querySelector('.lib-url'),
      haal: root.querySelector('.lib-haal'),
      bestand: root.querySelector('.lib-bestand'),
      bestanden: root.querySelector('.lib-bestanden'),
      zoek: root.querySelector('.lib-zoek'),
      status: root.querySelector('.lib-status'),
      jobs: root.querySelector('.lib-jobs'),
      rijen: root.querySelector('.lib-rijen'),
      stemsKeuze: root.querySelector('.lib-stems-keuze'),
      pastBij: root.querySelector('.lib-pastbij'),
      pbLijst: root.querySelector('.lib-pastbij-lijst'),
    };

    // Binnenhalen, wachtrij en voortgang: de strook (ingest-strook.js). Hij
    // luistert zelf naar het invoerveld en "haal binnen". Is er een nummer
    // binnen, dan ververst de lijst zonder te verspringen (onNieuw), en gaat
    // het (met de keuze 2 · 4) in de stems-rij van de server: meteen peilen.
    this.strook = new IngestStrook({
      el: this.el.jobs, url: this.el.url, haal: this.el.haal, stemsKeuze: this.el.stemsKeuze, opslag,
      decks, label, stand, open: () => this.open,
      meld: (tekst, goed) => { this.melding = { tekst, goed }; this.tekenStatus(); },
      bevestigd: (soort, sleutel) => this._bevestigd(soort, sleutel),
      laad: (track, deck) => this._laadTrack(track, deck),
      laadNaIngest: (track, deck) => this._laadNaIngest(track, deck),
      onNieuw: () => { this.ververs(); this.stems?.peil(); },
    });
    // De stems-kolom volgt de stems-rij van de server: peilen zolang het paneel
    // open staat, en bij elke verandering alleen de stems-cellen bijwerken.
    if (this.stems) {
      this.stems.kijk(() => this.open);
      this.stems.on('change', () => this._stemsBijwerken());
      this.stems.on('klaar', () => this.ververs());
    }
    // Niet bijwerken terwijl je in de lijst drukt: een knop die tussen
    // indrukken en loslaten vervangen wordt krijgt geen klik (zie de strook).
    this._vast = false;
    this._later = false;
    this._stemsHtml = new Map();   // track-id -> de stems-cel zoals hij er nu staat
    this.el.rijen.addEventListener('pointerdown', () => { this._vast = true; });
    const los = () => {
      if (!this._vast) return;
      this._vast = false;
      if (this._later) { this._later = false; setTimeout(() => this._stemsBijwerken(), 0); }
    };
    globalThis.addEventListener?.('pointerup', los, true);
    globalThis.addEventListener?.('pointercancel', los, true);
    // Eigen bestanden: de knop opent de kiezer, of sleep ze op het paneel.
    this.el.bestand?.addEventListener('click', () => this.el.bestanden.click());
    this.el.bestanden?.addEventListener('change', () => {
      this.uploadBestanden([...this.el.bestanden.files]);
      this.el.bestanden.value = '';
    });
    root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); root.classList.add('drag'); } });
    root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drag'); });
    root.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      root.classList.remove('drag');
      this.uploadBestanden([...e.dataTransfer.files]);
    });
    // Zoeken op de server: even wachten tot je uitgetypt bent, en dan bovenaan beginnen. De tekst is
    // ook het filter (de zoekregel: #tag -#tag @categorie bpm:70-90 …, src/library/indeling.js).
    let zoekTimer = null;
    this.el.zoek.addEventListener('input', () => {
      clearTimeout(zoekTimer);
      zoekTimer = setTimeout(() => this._zoekNu(this.el.zoek.value.trim()), 120);
    });
    this.el.zoek.title = 'zoeken, en filteren: #tag  -#tag  #a|b  @categorie  bpm:70-90  toon:8A  grid:zeker  stems  energie:hoog';
    // De indeling (library-indeling.js): de kolom links en de tagbalk. Hij praat met het paneel via dit.
    this.indeling = new IndelingPaneel({ root, opslag, panel: {
      // Wat er in het veld STAAT (ook als het wachten op uitgetypt nog loopt): daar bouwt een klik op.
      zoekTekst: () => this.el.zoek.value.trim(),
      zetZoekTekst: (t) => { clearTimeout(zoekTimer); this.el.zoek.value = t; this._zoekNu(t.trim()); },
      doelIds: () => this.doelIds(),
      selectieGrootte: () => this.selectie.size,
      track: (id) => this._track(id),
      ververs: () => this.ververs(),
      meld: (tekst, goed) => { this.melding = { tekst, goed }; this.tekenStatus(); },
      bevestigd: (soort, sleutel) => this._bevestigd(soort, sleutel),
      naIndeling: () => this._naIndeling(),
      vraagSleutel: () => this._vraagSleutel(),
      plekAan: () => this._plekNu(),
      naKolom: () => this._zetKolommen(),
      zetPlek: (aan) => { this.plek = !!aan; this._kolomGekozen = !aan; this.tekenKop(); this.ververs({ bovenaan: true }); },
    } });
    // Sneltoetsen zolang het paneel open is: alt+T = het tagveld, alt+1…8 = snel-tag (keyboard.js
    // negeert alles met alt, dus geen botsing met de DJ-toetsen).
    globalThis.addEventListener?.('keydown', (e) => {
      if (!this.open || !this.indeling.aan || !e.altKey || e.metaKey || e.ctrlKey || this.root.classList.contains('tab-kaart')) return;
      if (e.code === 'KeyT') { e.preventDefault(); this.indeling.el.tagveld.focus(); this.indeling.el.tagveld.select(); }
      const m = /^Digit([1-8])$/.exec(e.code);
      if (m) { e.preventDefault(); this.indeling.snel(Number(m[1])); }
    });

    // "Past bij" (past-bij.js): aan/uit, en laden vanuit die lijst (zelfde tweede klik als de gewone lijst).
    this.el.pastBij?.addEventListener('click', () => this.zetPastBij(!this.pastBijAan));
    this.el.pbLijst?.addEventListener('click', (e) => {
      const knop = e.target.closest('button[data-pb-deck]');
      if (!knop) return;
      const track = this._pb.tracks.get(knop.dataset.id);
      const deck = knop.dataset.pbDeck;
      if (!track) return;
      if (this.stand(deck) === 'speelt' && !this._bevestigd('laad', `${track.id}:${deck}`)) {
        this.melding = { tekst: `track ${this.label(deck)} speelt — klik nog eens om er toch overheen te laden`, goed: false };
        return this.tekenStatus();
      }
      this._laadTrack(track, deck);
    });

    // Kop, lege ruimte zo hoog als de hele lijst, en het venster met de rijen die je ziet.
    this.el.rijen.innerHTML = '<div class="lib-kop"></div><div class="lib-ruimte"><div class="lib-venster"></div></div>';
    this.el.kop = this.el.rijen.querySelector('.lib-kop');
    this.el.ruimte = this.el.rijen.querySelector('.lib-ruimte');
    this.el.venster = this.el.rijen.querySelector('.lib-venster');
    root.style.setProperty('--lib-rij-h', `${RIJ_H}px`);
    this._zetKolommen();
    this.tekenKop();
    // Slepen (spoor S11): een rij, of wat gekozen is, naar een categorie links; in een categorie op
    // volgorde ook op een andere rij (= daarvóór zetten).
    this.el.rijen.addEventListener('dragstart', (e) => {
      const rij = e.target.closest?.('.lib-rij[data-id]');
      if (!rij || !e.dataTransfer) return;
      const id = rij.dataset.id;
      const ids = this.selectie.has(id) ? this._opVolgorde([...this.selectie]) : [id];
      e.dataTransfer.setData(NUMMERS_MIME, JSON.stringify(ids));
      e.dataTransfer.setData('text/plain', ids.map((x) => this._track(x)?.titel ?? x).join('\n'));
      e.dataTransfer.effectAllowed = 'copyMove';
      this._sleept = ids;
    });
    this.el.rijen.addEventListener('dragend', () => { this._sleept = null; this._markeerDrop(null); });
    this.el.rijen.addEventListener('dragover', (e) => {
      const rij = e.target.closest?.('.lib-rij[data-id]');
      if (!rij || !this._plekNu() || !e.dataTransfer?.types?.includes(NUMMERS_MIME) || this._sleept?.includes(rij.dataset.id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      this._markeerDrop(rij);
    });
    this.el.rijen.addEventListener('drop', (e) => {
      const rij = e.target.closest?.('.lib-rij[data-id]');
      this._markeerDrop(null);
      const cat = this._plekNu();
      if (!rij || !cat) return;
      const ids = leesSleep(e);
      if (!ids || ids.includes(rij.dataset.id)) return;
      e.preventDefault();
      this.indeling.inCategorie(cat, ids, { voor: rij.dataset.id });
    });
    let beeld = 0;
    const volg = () => {
      if (beeld) return;
      beeld = requestAnimationFrame(() => { beeld = 0; this.tekenRijen(); this._haalZichtbaar(); });
    };
    this.el.rijen.addEventListener('scroll', volg, { passive: true });
    // Het paneel opent (0 -> 340 px hoog): dan pas weten we hoeveel rijen er passen.
    if (typeof ResizeObserver === 'function') new ResizeObserver(volg).observe(this.el.rijen);

    this.el.rijen.addEventListener('click', (e) => {
      // Een tagchip in een rij: filter hierop (alt = niet), shift = van dit nummer af.
      const chip = e.target.closest('button[data-tagchip]');
      if (chip) {
        const id = chip.closest('.lib-rij[data-id]')?.dataset.id;
        if (e.shiftKey && id) return this.indeling.zetTags([id], [chip.dataset.tagchip], false);
        return this.indeling.wisselTagFilter(chip.dataset.tagchip, e.altKey);
      }
      const kop = e.target.closest('button[data-sorteer]');
      if (kop) return this.sorteer(kop.dataset.sorteer);
      // Toonsoort: klik op de badge = de kiezer onder die rij, open of dicht.
      const toon = e.target.closest('button[data-toon]');
      if (toon) {
        this.kiezer = this.kiezer === toon.dataset.toon ? null : toon.dataset.toon;
        this.tekenRijen();
        return this._kiezerInBeeld();
      }
      const tk = e.target.closest('button[data-tk]');
      if (tk) {
        if (tk.dataset.tk === 'sluit') { this.kiezer = null; return this.tekenRijen(); }
        return this.kiesToon(tk.dataset.id, tk.dataset.tk);
      }
      const st = e.target.closest('button[data-stems]');
      if (st) return this.stemsKlik(st.dataset);
      const knop = e.target.closest('button[data-deck]');
      if (knop) {
        // Over een track die SPEELT laden valt de zaal stil. Dan eerst vragen:
        // nog een keer klikken binnen 3 s.
        if (this.stand(knop.dataset.deck) === 'speelt' && !this._bevestigd('laad', `${knop.dataset.id}:${knop.dataset.deck}`)) {
          this.melding = { tekst: `track ${this.label(knop.dataset.deck)} speelt — klik nog eens om er toch overheen te laden`, goed: false };
          return this.tekenStatus();
        }
        return this.laad(knop.dataset.id, knop.dataset.deck);
      }
      const her = e.target.closest('button[data-her]');
      if (her) {
        // ↻ = grid én toonsoort opnieuw (TOONSOORT.md §4). Staat een van de
        // twee op SLOT (door jou bevestigd), dan alleen na een tweede klik.
        const t = this._track(her.dataset.her);
        const slot = [t?.grid?.slot && 'het grid', t?.toon?.slot && 'de toonsoort'].filter(Boolean);
        if (slot.length && !this._bevestigd('her', t.id)) {
          this.melding = { tekst: `${slot.join(' en ')} van "${t.titel}" ${slot.length > 1 ? 'staan' : 'staat'} op slot — klik nog eens op ↻ om toch opnieuw te analyseren`, goed: false };
          return this.tekenStatus();
        }
        return this.heranalyseer(her.dataset.her, slot.length > 0);
      }
      const weg = e.target.closest('button[data-weg]');
      if (weg) {
        // Weghalen gooit ook grid, racks, hotcues en sampler-pads van dit nummer weg.
        if (!this._bevestigd('weg', weg.dataset.weg)) {
          const t = this._track(weg.dataset.weg);
          this.melding = { tekst: `"${t?.titel ?? weg.dataset.weg}" weghalen, met grid, racks en hotcues? Klik nog eens op ×`, goed: false };
          return this.tekenStatus();
        }
        return this.verwijder(weg.dataset.weg);
      }
      // Een klik op een rij (niet op een knop) zet de keuze daar: muis en controller wijzen hetzelfde aan.
      // Cmd/ctrl-klik = erbij of eraf, shift-klik = een reeks (spoor S11: in één keer taggen).
      const rij = e.target.closest('.lib-rij[data-i]');
      if (rij && !e.target.closest('button, input, select')) {
        const i = Number(rij.dataset.i);
        this.kiesRij(i, { erbij: e.metaKey || e.ctrlKey, reeks: e.shiftKey });
        this.tekenRijen();
        this.indeling.tekenBalk();
      }
    });

    this.ververs();
  }

  /** Tweede klik op hetzelfde binnen 3 s? */
  _bevestigd(soort, sleutel) {
    const nu = Date.now();
    if (this.zeker && this.zeker.soort === soort && this.zeker.sleutel === sleutel && nu < this.zeker.tot) {
      this.zeker = null;
      return true;
    }
    this.zeker = { soort, sleutel, tot: nu + 3000 };
    return false;
  }

  get open() { return !this.root.classList.contains('hidden'); }

  // ---- de indeling (spoor S11, docs/LIBRARY-TAGS.md) -------------------------------------------

  /** Een nieuwe zoektekst (= filter): bovenaan beginnen; een andere categorie = op zijn volgorde. */
  _zoekNu(zoek) {
    if (zoek === this.zoek) return;
    const was = this.indeling.lees(this.zoek).filter.categorie ?? null;
    this.zoek = zoek;
    const nu = this.indeling.lees(zoek).filter.categorie ?? null;
    if (nu !== was) { this.plek = nu != null; this._kolomGekozen = false; }
    this.indeling.teken();
    this.ververs({ bovenaan: true });
  }

  /**
   * De stand van de indeling kwam binnen en het filter betekent nu iets anders (een @categorie in het
   * veld die nu bestaat, of niet meer): opnieuw, bovenaan. Alleen dan: een nieuwe stand na elke
   * tag-wijziging mag de lijst niet laten verspringen.
   */
  _naIndeling() {
    if (this.plek === false && this.indeling.lees(this.zoek).filter.categorie != null && !this._kolomGekozen) this.plek = true;
    this.ververs({ bovenaan: true });
  }

  /** Het filter van nu (uit het zoekveld). */
  get filter() { return this.indeling?.aan ? this.indeling.lees(this.zoek).filter : (this.zoek ? { zoek: this.zoek } : {}); }

  /**
   * De gewone categorie waarvan de lijst nu de volgorde toont (sorteer=plek), of null. Een slimme
   * die binnen een gewone zoekt: die gewone.
   */
  _plekNu() {
    if (!this.plek) return null;
    const f = this.filter;
    const c = this.indeling.categorieen.find((x) => x.id === f.categorie);
    if (!c) return null;
    return c.soort === 'gewoon' ? c.id : c.regel?.categorie ?? null;
  }

  /** De vraag voor de pagina-cache: zoek, filter, sortering. Een nieuwe vraag = een nieuwe generatie. */
  _vraag() {
    const { zoek = '', ...filter } = this.filter;
    return { zoek, filter, ...this.sortering, plek: !!this._plekNu() };
  }

  _vraagSleutel() { return JSON.stringify(this._vraag()); }

  /** Wat taggen en "→ categorie" raakt: de selectie, anders het gekozen nummer. */
  doelIds() {
    if (this.selectie.size) return this._opVolgorde([...this.selectie]);
    const id = this.gekozenId ?? this.cache.rij(this.gekozen)?.id ?? null;
    return id && this.cache.totaal ? [id] : [];
  }

  /** Ids in de volgorde van de lijst (een categorie krijgt ze zoals je ze ziet); wat niet binnen is achteraan. */
  _opVolgorde(ids) {
    const plek = new Map(ids.map((id) => [id, this.cache.index(id)]));
    return [...ids].sort((a, b) => (plek.get(a) < 0 ? Infinity : plek.get(a)) - (plek.get(b) < 0 ? Infinity : plek.get(b)));
  }

  /** Klik op rij i: alleen deze (de selectie leeg), erbij/eraf (cmd), of een reeks vanaf de vorige klik (shift). */
  kiesRij(i, { erbij = false, reeks = false } = {}) {
    const id = this.cache.rij(i)?.id;
    if (reeks && this._anker != null) {
      const [a, b] = [Math.min(this._anker, i), Math.max(this._anker, i)];
      if (!erbij) this.selectie.clear();
      for (let k = a; k <= b; k++) { const t = this.cache.rij(k); if (t) this.selectie.add(t.id); }
    } else if (erbij) {
      // De eerste cmd-klik neemt het nummer dat al gekozen was mee.
      if (!this.selectie.size && this.gekozenId && this.gekozenId !== id) this.selectie.add(this.gekozenId);
      if (id) { if (this.selectie.has(id)) this.selectie.delete(id); else this.selectie.add(id); }
      this._anker = i;
    } else {
      this.selectie.clear();
      this._anker = i;
    }
    this._zetKeuze(i);
  }

  /** Alles wat de lijst nu vindt kiezen (hooguit wat er binnen is). */
  kiesAlles() { for (const t of this.cache.geladen) this.selectie.add(t.id); this.tekenRijen(); this.indeling.tekenBalk(); }

  _markeerDrop(el) {
    for (const x of this.el.venster?.querySelectorAll('.drop-voor') ?? []) if (x !== el) x.classList.remove('drop-voor');
    el?.classList.add('drop-voor');
  }

  /** De bus (aanhaker indeling): de volgende/vorige categorie als filter; null = alles. */
  stapCategorie(stap) { const naam = this.indeling.stapCategorie(stap); this.melding = { tekst: `library: ${naam}`, goed: true }; this.tekenStatus(); return naam; }
  wisFilter() { this.indeling.zetFilter({}); }
  /** Snel-tag K aan/uit in het filter (de bus: library.quickfilter.K). */
  snelFilter(k) {
    const naam = this.indeling.stand.snel[k - 1];
    if (!naam) { this.melding = { tekst: `snel-tag ${k} is leeg`, goed: false }; this.tekenStatus(); return; }
    this.indeling.wisselTagFilter(naam);
  }

  /** Een melding onthoudt wanneer hij kwam (het scherm van de Maschine toont alleen een verse). */
  get melding() { return this._melding; }
  set melding(m) { this._melding = m; this._meldingT = Date.now(); }

  // ---- bladeren met een controller (docs/MASCHINE.md §5e) ------------------------

  /** De keuze op rij `i` (binnen de lijst), en onthouden welk nummer dat is. */
  _zetKeuze(i) {
    this.gekozen = klemKeuze(i, 0, this.cache.totaal);
    this.gekozenId = this.cache.rij(this.gekozen)?.id ?? null;
  }

  /** De rijen rond de keuze ophalen (het scherm van de Maschine, ENTER); daarna het nummer erbij onthouden. */
  async _rondKeuze() {
    const nieuw = await this.cache.zorgVoor(Math.max(0, this.gekozen - 3), this.gekozen + 4);
    if (!this.gekozenId) this.gekozenId = this.cache.rij(this.gekozen)?.id ?? null;
    if (nieuw) this._tekenStraks();
  }

  /** Eén keer tekenen bij het volgende beeld (het wiel kan 20 stappen in één bericht sturen). */
  _tekenStraks() {
    if (this._straks) return;
    this._straks = requestAnimationFrame(() => { this._straks = 0; this.tekenRijen(); });
  }

  /**
   * Na een verversing: de keuze blijft op hetzelfde NUMMER (een ingest bovenaan schuift
   * alles een rij op), anders binnen de lijst. Staat het nummer niet in de pagina's die de
   * lijst nu heeft (je keek ergens anders), dan eerst die rond de keuze ophalen.
   */
  async _volgKeuze() {
    const id = this.gekozenId;
    let i = id ? this.cache.index(id) : -1;
    if (i < 0 && id) {
      await this.cache.zorgVoor(Math.max(0, this.gekozen - 10), this.gekozen + 11);
      if (this.gekozenId !== id) return;          // intussen verder gebladerd
      i = this.cache.index(id);
    }
    if (i >= 0) this.gekozen = i;
    else this._zetKeuze(this.gekozen);
    await this._rondKeuze();
    this._tekenStraks();
  }

  /** De keuze `stap` rijen verder, in beeld, en de rijen eromheen ophalen (ook voor het scherm van de Maschine). */
  kies(stap) {
    const totaal = this.cache.totaal;
    if (!totaal) return;
    this._zetKeuze(klemKeuze(this.gekozen, stap, totaal));
    const el = this.el.rijen, kop = this.el.kop?.offsetHeight || 0;
    const boven = kop + this.gekozen * RIJ_H, onder = boven + RIJ_H;
    if (boven - kop < el.scrollTop) el.scrollTop = boven - kop;
    else if (onder > el.scrollTop + el.clientHeight) el.scrollTop = onder - el.clientHeight;
    this._tekenStraks();
    this._rondKeuze();
  }

  /**
   * Het gekozen nummer laden op `deck`. Over een track die speelt pas bij een tweede keer
   * binnen 3 s. Het NUMMER dat gekozen is, niet de rij: die kan intussen verschoven zijn.
   */
  laadGekozen(deck) {
    this.gekozen = klemKeuze(this.gekozen, 0, this.cache.totaal);
    const t = (this.gekozenId && this._track(this.gekozenId)) || this.cache.rij(this.gekozen);
    if (!t) {
      this.melding = { tekst: this.cache.totaal ? 'dat nummer is nog niet binnen, even wachten' : 'de library is leeg', goed: false };
      this._rondKeuze();
      return this.tekenStatus();
    }
    if (this.stand(deck) === 'speelt' && !this._bevestigd('laad', `${t.id}:${deck}`)) {
      this.melding = { tekst: `"${t.titel}": track ${this.label(deck)} speelt, nog eens om er toch overheen te laden`, goed: false };
      return this.tekenStatus();
    }
    return this.laad(t.id, deck);
  }

  /** Voor een klein scherm: de rijen rond de keuze, en een melding van de laatste 3 s (zo lang telt een tweede druk). */
  bladerStand(n = 5, nu = Date.now()) {
    const vers = this._melding && nu - (this._meldingT ?? 0) < 3000;
    // filter: het filter kort ("@warm #dub"), voor de kop van het scherm van de Maschine (spoor S11).
    const filter = this.indeling?.aan ? this.indeling.kort(this.filter) : '';
    return { ...bladerVenster(this.cache, this.gekozen, n), zoek: this.zoek, filter, laadt: this.bezig.size > 0, melding: vers ? this._melding.tekst : null };
  }

  /** Wat er nu van de lijst geladen is, op volgorde (console; de lijst zelf staat in `cache`). */
  get tracks() { return this.cache.geladen; }

  /** Een nummer op id: uit de geladen pagina's, of net binnengehaald. */
  _track(id) { return this.cache.vind(id); }

  /**
   * Een veld van een nummer bijwerken na een await: `track` is het object van
   * vóór het wachten, maar de lijst kan intussen nieuwe pagina's hebben (een
   * ingest werd klaar, je scrolde): dan staat het nummer er als ander object.
   */
  _werkBij(track, veld, waarde) {
    track[veld] = waarde;
    const nu = this._track(track.id);
    if (nu && nu !== track) nu[veld] = waarde;
  }

  /**
   * Het paneel is laag (340 px, een rij of zeven): een kiezer onder een van
   * de onderste rijen viel eronder weg. Dan de lijst zover schuiven dat hij
   * helemaal in beeld staat; zijn rij blijft dan ook in beeld.
   */
  _kiezerInBeeld() {
    const k = this.el.venster.querySelector('.lib-toonkiezer');
    if (!k) return;
    const onder = k.getBoundingClientRect().bottom - this.el.rijen.getBoundingClientRect().bottom;
    if (onder > 0) this.el.rijen.scrollTop += Math.ceil(onder) + 4;
  }

  /** Klik op een kolomkop. */
  sorteer(sleutel) {
    // In een categorie op volgorde: een kolom kiezen = op die kolom (nog eens: andersom).
    if (this._plekNu()) { this.plek = false; this._kolomGekozen = true; this.sortering = { sorteer: sleutel, richting: volgendeSortering(null, sleutel).richting }; bewaarSortering(this.opslag, this.sortering); this.tekenKop(); return this.ververs({ bovenaan: true }); }
    const nieuw = volgendeSortering(this.sortering, sleutel);
    if (nieuw === this.sortering) return;
    this.sortering = nieuw;
    bewaarSortering(this.opslag, nieuw);
    this.tekenKop();
    this.ververs({ bovenaan: true });
  }

  /** Wat in het invoerveld staat binnenhalen (één of meer links): de strook doet het. */
  haalBinnen() { return this.strook.haalBinnen(); }

  /** Meerdere bestanden: alleen wat we aannemen; de strook uploadt ze één voor één. */
  async uploadBestanden(files) {
    const goed = files.filter(isMediaBestand);
    const fout = files.filter((f) => !isMediaBestand(f));
    if (fout.length) {
      this.melding = { tekst: `overgeslagen: ${fout.map((f) => f.name).join(', ')} — ik neem ${BESTAND_EXT.join(', ')}`, goed: false };
      this.tekenStatus();
    }
    if (goed.length) await this.strook.uploadBestanden(goed);
  }

  /**
   * Eén eigen bestand naar de server (zie IngestStrook.uploadBestand): daarna
   * dezelfde wachtrij en pijplijn als een link.
   *
   * naDeck: na de ingest meteen op die track laden (het bestand werd op een
   * track gesleept). Speelt die track dan, dan NIET eroverheen: dat zou de
   * zaal stilleggen zonder dat je nog iets deed.
   * Geeft de opdracht van de server terug, of null.
   */
  uploadBestand(file, { naDeck = null } = {}) { return this.strook.uploadBestand(file, { naDeck }); }

  /**
   * Een nummer uit de strook laden (de strook vroeg al de tweede klik over een
   * spelende track). Staat het nog in geen geladen pagina (net binnen, de
   * lijst ververst nog), dan kent `_track` het via `cache.extra`.
   */
  _laadTrack(track, deck) {
    if (!track) return;
    if (!this._track(track.id)) this.cache.extra.set(track.id, track);
    return this.laad(track.id, deck);
  }

  /** Hetzelfde, voor buiten (de tab kaart laadt een nummer dat al in de library staat). */
  laadTrack(track, deck) { return this._laadTrack(track, deck); }

  /** Klaar met een opdracht die op een track moest? Dan nu laden — als dat mag. */
  _laadNaIngest(track, deck) {
    if (!deck || !track) return;
    if (this.stand(deck) === 'speelt') {
      this.melding = { tekst: `${track.titel} is binnen, maar track ${this.label(deck)} speelt — laad hem hier in de lijst`, goed: false };
      this.tekenStatus();
      return;
    }
    this._laadTrack(track, deck);
  }

  async laad(id, deck) {
    const track = this._track(id);
    if (!track || this.bezig.has(id)) return;
    this.bezig.add(id);
    this.tekenRijen();
    try {
      const r = await this.onLaad(deck, track);
      this.melding = { tekst: `${track.titel} staat op track ${this.label(deck)}`
        + (r?.stems ? `, met ${r.stems} stems` : '') + (r?.hint ? ` — ${r.hint}` : ''), goed: true };
      fetch(`/api/library/${id}/geladen`, { method: 'POST' }).then(leesWeg, () => {});
      // "gespeeld" meteen bijwerken, maar NIET opnieuw sorteren: de lijst
      // springt dan niet onder je muis weg terwijl je de volgende zoekt.
      track.laatst_geladen = Date.now();
      track.keer_geladen = (track.keer_geladen || 0) + 1;
    } catch (err) {
      this.melding = { tekst: `laden mislukt: ${err.message}`, goed: false };
    }
    this.bezig.delete(id);
    this.tekenStatus();
    this.tekenRijen();
  }

  /**
   * ↻: grid én toonsoort opnieuw laten voorstellen door de server (elk in een
   * worker, een paar seconden; TOONSOORT.md §4). De server koppelt ze niet,
   * dus hier twee verzoeken. `forceer` = tweede klik: ook over een slot.
   */
  async heranalyseer(id, forceer = false) {
    const track = this._track(id);
    if (!track || this.analyseert.has(id)) return;
    this.analyseert.add(id);
    this.melding = { tekst: `grid en toonsoort van "${track.titel}" worden opnieuw geanalyseerd…`, goed: true };
    this.tekenStatus();
    this.tekenRijen();
    const vraag = async (wat) => {
      const r = await fetch(`/api/library/${id}/${wat}/analyseer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forceer }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      return j;
    };
    const [g, t] = await Promise.allSettled([vraag('grid'), vraag('toon')]);
    const delen = [];
    let goed = true;
    if (g.status === 'rejected') { delen.push(`grid: analyseren mislukt (${g.reason?.message})`); goed = false; }
    else if (!g.value.bewaard) { delen.push(`grid niet vervangen (${g.value.reden})`); goed = false; }
    else {
      const grid = g.value.grid;
      this._werkBij(track, 'grid', grid);
      this.onGrid(id, grid);
      const st = gridStatus(grid, track.duur);
      delen.push(`grid${g.value.methode === 'tellen' ? ' uit de gevonden tellen' : ''}: ${grid.stukken.length} stuk${grid.stukken.length === 1 ? '' : 'ken'}, `
        + `${Math.round((st.aandeel ?? 0) * 100)}% zeker${g.value.tellen === 'in de rij' ? ' (de tellen worden nog gezocht; daarna komt het grid daaruit)' : ''}`);
    }
    if (t.status === 'rejected') { delen.push(`toonsoort: analyseren mislukt (${t.reason?.message})`); goed = false; }
    else if (!t.value.bewaard) { delen.push(`toonsoort niet vervangen (${t.value.reden})`); goed = false; }
    else {
      this._werkBij(track, 'toon', t.value.toon);
      this.onToon(id, t.value.toon);
      delen.push(`toonsoort ${libraryToon(t.value.toon, track.duur).tekst}`);
    }
    this.melding = { tekst: `${track.titel}: ${delen.join(' · ')}`, goed };
    this.analyseert.delete(id);
    this.tekenStatus();
    this.tekenRijen();
  }

  /**
   * Toonsoort met de hand (TOONSOORT.md §7): een van de 24, "geen", of
   * bevestigen (slot aan/uit zonder te veranderen). Met de hand = bron 'hand'
   * en op slot: de analyse blijft er voorgoed af. Een album (meer stukken)
   * wordt daarbij één stuk; dat gaat pas na een tweede klik, zoals laden over
   * een spelende track.
   */
  async kiesToon(id, keuze) {
    const track = this._track(id);
    if (!track) return;
    const kaart = ToonKaart.van(track.toon);
    let nieuw;
    if (keuze === 'slot') {
      if (!kaart) return;
      nieuw = kaart.kopie();
      nieuw.slot = !nieuw.slot;
    } else {
      const k = keuze === 'geen' ? null : Number(keuze);
      if (k !== null && !(Number.isInteger(k) && k >= 0 && k < 24)) return;
      if (kaart && kaart.aantalStukken > 1 && !this._bevestigd('toon', `${id}:${keuze}`)) {
        const wat = k === null ? '"geen toonsoort"' : `${camelot(k)} ${kortNaam(k)}`;
        this.melding = { tekst: `"${track.titel}" heeft ${kaart.aantalStukken} toonsoortstukken — klik nog eens om er één ${wat} van te maken`, goed: false };
        return this.tekenStatus();
      }
      nieuw = kaart ? kaart.kopie().vervangDoorEen(k) : ToonKaart.metHand(k);
      nieuw.slot = true;
    }
    nieuw.bron = 'hand';
    const json = nieuw.toJSON();
    try {
      const r = await fetch(`/api/library/${id}/toon`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toon: json }),
      });
      await leesWeg(r);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      this._werkBij(track, 'toon', json);
      this.onToon(id, json);
      this.melding = { tekst: `${track.titel}: ${libraryToon(json, track.duur).tekst}${nieuw.slot ? ' (op slot)' : ' (slot eraf)'}`, goed: true };
      if (keuze !== 'slot') this.kiezer = null;
    } catch (err) {
      this.melding = { tekst: `toonsoort niet bewaard: ${err.message}`, goed: false };
    }
    this.tekenStatus();
    this.tekenRijen();
  }

  /**
   * Een track bewaarde een grid (of toonsoort, zetToon) dat op het deck bewerkt
   * is: de lijst toont het ook, en wie het nummer opnieuw laadt krijgt het. Het nummer hoeft niet in beeld te staan: `_track` zoekt in ALLE
   * geladen pagina's (en in wat net binnenkwam). Staat het in geen enkele
   * geladen pagina, dan is er niets bij te werken: die pagina komt later van
   * de server, en die heeft de kaart dan al.
   */
  zetGrid(id, json) {
    const t = this._track(id);
    if (!t) return;
    t.grid = json;
    if (this.open) this.tekenRijen();
  }

  /** Zie zetGrid: hetzelfde voor de toonsoortkaart. */
  zetToon(id, json) {
    const t = this._track(id);
    if (!t) return;
    t.toon = json;
    if (this.open) this.tekenRijen();
  }

  /**
   * De kiezer onder een rij: 24 toonsoorten in wijzervolgorde, "geen",
   * bevestigen. `boven` = px vanaf de bovenkant van het venster (onder de rij).
   */
  kiezerHtml(t, boven = 0) {
    const kaart = ToonKaart.van(t.toon);
    const hoofd = libraryToon(t.toon, t.duur).k;
    const n = kaart?.aantalStukken ?? 0;
    const id = esc(t.id);
    return `<div class="lib-toonkiezer" style="top:${boven}px">
      <span class="lib-tk-kop">toonsoort van de plaat${n > 1 ? ` — ${n} stukken: kiezen maakt er één van (tweede klik)` : ''}</span>
      <span class="lib-tk-wijzer">${KIEZER.map((x) => `<button class="btn sm lib-tk${x.k === hoofd ? ' on' : ''}${x.mineur ? ' mineur' : ''}" data-tk="${x.k}" data-id="${id}" title="${esc(`${x.camelot} ${volleNaam(x.k)}`)}">${x.camelot}<small>${esc(x.kort)}</small></button>`).join('')}</span>
      <span class="lib-tk-rest">
        <button class="btn sm" data-tk="geen" data-id="${id}" title="geen duidelijke toonsoort (ambient, drone)">geen toonsoort</button>
        ${kaart ? `<button class="btn sm lib-tk-slot${kaart.slot ? ' on' : ''}" data-tk="slot" data-id="${id}" title="${kaart.slot ? 'het slot eraf: de analyse mag hem weer vervangen' : 'bevestigen zonder te veranderen: op slot blijft de analyse eraf'}">${kaart.slot ? 'slot eraf' : 'bevestigen'}</button>` : ''}
        <button class="btn sm" data-tk="sluit" title="dicht">×</button>
      </span>
    </div>`;
  }

  /**
   * Een knop in de stems-kolom: splitsen in 2 of 4, of annuleren (×).
   *
   * Splitsen gaat NIET als een track dit nummer nu MET stems speelt: de server
   * vervangt stems.wav bij succes (2 → 4), terwijl het deck daar nog met
   * Range-verzoeken uit leest — met een ander aantal kanalen is dat ruis.
   * Een lopende split stoppen gooit werk weg: tweede klik, zoals de ingest.
   */
  async stemsKlik({ stems: doe, id, aantal, opdracht }) {
    if (!this.stems) return;
    const t = this._track(id);
    const titel = t?.titel ?? id;
    if (doe === 'splits') {
      const n = Number(aantal);
      const bezet = this.stemsInGebruik(id);
      if (bezet.length) {
        this.melding = { tekst: `"${titel}" speelt met stems op track ${bezet.join(', ')} — laad daar eerst iets anders, opnieuw splitsen vervangt het bestand waar hij uit leest`, goed: false };
        return this.tekenStatus();
      }
      const r = await this.stems.splits(id, n);
      this.melding = !r.ok ? { tekst: `"${titel}" niet gesplitst: ${r.fout}`, goed: false }
        : r.al ? { tekst: `"${titel}" heeft al ${n} stems`, goed: true }
          : { tekst: `"${titel}" gaat in ${n === 4 ? 'vier stems (drums · bas · overig · zang)' : 'zang en rest'} — ${r.opdracht?.status === 'bezig' ? 'splitsen begonnen' : 'in de rij'}`, goed: true };
      if (r.al) this.ververs();   // de lijst wist het nog niet
      this.tekenStatus();
      return this._stemsBijwerken();
    }
    if (doe === 'annuleer') {
      const o = this.stems.opdrachten.find((x) => x.id === opdracht);
      if (!o) return;
      if (o.status === 'bezig' && !this._bevestigd('stems-x', o.id)) {
        this.melding = { tekst: `"${titel}" wordt gesplitst — klik nog eens op × om te stoppen (het werk tot nu toe gaat weg)`, goed: false };
        return this.tekenStatus();
      }
      const r = await this.stems.annuleer(o.id);
      this.melding = r.ok ? { tekst: `splitsen van "${titel}" ${o.status === 'bezig' ? 'gestopt' : 'uit de rij'}`, goed: true }
        : { tekst: `annuleren lukte niet: ${r.fout}`, goed: false };
      this.tekenStatus();
      return this._stemsBijwerken();
    }
  }

  /** Wat de stems-cellen nodig hebben uit de stems-rij van de server. */
  _stemsStaat() {
    const s = this.stems;
    return { stems: s?.perNummer() ?? new Map(), stemsUit: s && s.beschikbaar === false ? (s.reden || 'de splitter ontbreekt') : null };
  }

  /**
   * De stems-rij veranderde (voortgang, klaar, splitter weg): alleen de
   * stems-cellen die in beeld zijn, en alleen wat anders is. Niet terwijl je
   * in de lijst drukt (`_vast`): dan na het loslaten.
   */
  _stemsBijwerken() {
    const s = this.stems;
    if (this.el.stemsKeuze && s) {
      const uit = s.beschikbaar === false;
      this.el.stemsKeuze.classList.toggle('uit', uit);
      const titel = uit ? `de splitter ontbreekt${s.reden ? `: ${s.reden}` : ''} — binnenhalen werkt wel, splitsen niet`
        : 'stems bij het binnenhalen: zang + rest (2), vier, of niet splitsen (onthouden)';
      if (this.el.stemsKeuze.title !== titel) this.el.stemsKeuze.title = titel;
    }
    if (!this.open || !this.el.venster) return;
    if (this._vast) { this._later = true; return; }
    const staat = this._stemsStaat();
    // Vergelijken met wat WIJ schreven, niet met outerHTML: de browser schrijft
    // attributen anders terug (disabled="", ' in plaats van &#39;) en dan zou
    // elke cel bij elke peiling vervangen worden.
    for (const el of this.el.venster.querySelectorAll('[data-st-id]')) {
      const t = this._track(el.dataset.stId);
      if (!t || !el.parentElement) continue;
      const html = stemsCelHtml(t, staat);
      if (this._stemsHtml.get(t.id) === html) continue;
      this._stemsHtml.set(t.id, html);
      el.parentElement.innerHTML = html;
    }
  }

  async verwijder(id) {
    const track = this._track(id);
    if (!track) return;
    // Alleen uit de library; de bestanden laat ik staan. Wissen van schijf is
    // onomkeerbaar en hoort een bewuste handeling te zijn, geen klik naast.
    await fetch(`/api/library/${id}`, { method: 'DELETE' }).then(leesWeg, () => {});
    this.melding = { tekst: `${track.titel} uit de lijst (bestanden staan er nog)`, goed: true };
    this.selectie.delete(id);
    this.ververs();
    this.indeling.ververs();   // aantallen per categorie en tag
  }

  // ---- past bij (src/ui/past-bij.js) ---------------------------------------------

  /**
   * De knop "past bij": de lijst toont dan welke nummers goed of bijna goed mixen met
   * het nummer op de focus-track. Zolang hij aan staat en het paneel open is, kijkt hij
   * elke seconde of de focus-track of zijn nummer veranderde, en rekent dan opnieuw.
   */
  zetPastBij(aan) {
    this.pastBijAan = !!aan;
    this.root.classList.toggle('pastbij-aan', this.pastBijAan);
    this.el.pastBij?.classList.toggle('on', this.pastBijAan);
    this.el.pbLijst?.classList.toggle('hidden', !this.pastBijAan);
    clearInterval(this._pbTimer);
    this._pb.sleutel = null;
    if (!this.pastBijAan) { this._pbKop = null; return this.tekenStatus(); }
    this._pastBijVernieuw();
    this._pbTimer = setInterval(() => {
      if (!this.open) return;
      const f = this.focus();
      if (this._pbSleutel(f) !== this._pb.sleutel) this._pastBijVernieuw();
      else this._tekenPastBij(this._pb.lijst ?? []);   // alleen de laadknoppen (welke track speelt); zelfde html = niets
    }, 1000);
  }

  _pbSleutel(f) { return f ? `${f.deck}:${f.trackId ?? '-'}` : '-'; }

  /** De hele library van de server (een paar honderd rijen: zonder `aantal` alles) en dan rekenen. */
  async _pastBijVernieuw() {
    const f = this.focus();
    const sleutel = this._pbSleutel(f);
    this._pb.sleutel = sleutel;
    let tracks = [];
    try {
      const r = await fetch('/api/library');
      const j = await r.json();
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      tracks = j.tracks ?? [];
    } catch (err) {
      this.melding = { tekst: `past bij: library niet geladen (${err.message})`, goed: false };
      return this.tekenStatus();
    }
    if (!this.pastBijAan || this._pb.sleutel !== sleutel) return;   // intussen uit of een ander nummer
    const huidig = f?.trackId ? tracks.find((t) => t.id === f.trackId) : null;
    const uitkomst = huidig ? pastBij(huidig, tracks, { t: f.t }) : { lijst: [], reden: null, uit: null };
    this._pb.tracks = new Map(uitkomst.lijst.map((x) => [x.track.id, x.track]));
    this._pb.lijst = uitkomst.lijst;
    this._pbKop = huidig ? pastBijKop(huidig, uitkomst, f.label) : `geen nummer op de focus-track${f?.label ? ` (track ${f.label})` : ''}: laad er eerst een`;
    this.tekenStatus();
    this._tekenPastBij(uitkomst.lijst);
  }

  _tekenPastBij(lijst) {
    if (!this.el.pbLijst) return;
    const standen = this.decks.map((d) => this.stand(d));
    const kop = `<div class="pb-rij pb-kop"><span>past</span><span>titel</span><span>bpm</span><span>toon</span><span>tempo</span><span>waarom</span><span></span></div>`;
    const rijen = lijst.map((x) => `<div class="pb-rij ${x.soort}">
      <span class="pb-soort">${x.soort}</span>
      <span class="pb-titel" title="${esc(x.track.titel)}">${esc(x.track.titel)}</span>
      <span class="pb-getal">${x.bpm.toFixed(1)}</span>
      <span class="pb-getal">${esc(x.toon ?? '—')}${x.toonGegokt ? '?' : ''}</span>
      <span class="pb-getal">${esc(tempoTekst(x))}</span>
      <span class="pb-waarom" title="${esc(x.waarom)}">${esc(x.waarom)}</span>
      <span class="pb-knoppen">${this.decks.map((d, k) => `<button class="btn sm lib-trk ${standen[k]}" data-pb-deck="${d}" data-id="${esc(x.track.id)}" title="laad op track ${this.label(d)} (${standen[k]})">${this.label(d)}</button>`).join('')}</span>
    </div>`).join('');
    const html = lijst.length ? kop + rijen : '<div class="lib-leeg">niets om te tonen</div>';
    if (html !== this._pb.html) { this._pb.html = html; this.el.pbLijst.innerHTML = html; }
  }

  /**
   * De lijst opnieuw van de server: het stuk dat je ziet, in één keer
   * geruild (geen flits). `bovenaan`: nieuwe zoekterm of sortering, dan
   * begin je bovenaan; anders (nummer weg, ingest klaar) blijf je waar je was.
   */
  async ververs({ bovenaan = false } = {}) {
    // Nieuwe zoekterm of sortering: de kiezer hoort bij een rij die nu ergens anders staat.
    if (bovenaan) { this.el.rijen.scrollTop = 0; this.kiezer = null; this.gekozen = 0; this.gekozenId = null; this.selectie.clear(); this._anker = null; }
    const { van, tot } = this._venster(Math.max(this.cache.totaal, 1));
    const vraag = this._vraag();
    try {
      if (!(await this.cache.ververs(vraag, van, tot))) return;
    } catch (err) {
      this.melding = { tekst: `library niet geladen: ${err.message}`, goed: false };
    }
    this.tekenStatus();
    this.tekenKop();
    this.tekenRijen();
    this.indeling.tekenBalk();
    this._haalZichtbaar();
    this._volgKeuze();
  }

  /** Welke rijen er nu in beeld zijn (met marge). */
  _venster(totaal = this.cache.totaal) {
    return zichtbaar({ boven: this.el.rijen.scrollTop, hoogte: this.el.rijen.clientHeight || 400, totaal });
  }

  /** Scrollen naar een stuk dat nog niet binnen is: ophalen en tekenen. */
  async _haalZichtbaar() {
    const { van, tot } = this._venster();
    if (await this.cache.zorgVoor(van, tot)) { this.tekenStatus(); this.tekenRijen(); }
  }

  tekenStatus() {
    const n = this.cache.totaal;
    const m = this.melding
      ? `<b class="${this.melding.goed ? 'goed' : 'bad'}">${esc(this.melding.tekst)}</b> &nbsp;·&nbsp; ` : '';
    if (this.pastBijAan && this._pbKop) { this.el.status.innerHTML = m + esc(this._pbKop); return; }
    const kort = this.indeling?.aan ? this.indeling.kort(this.filter) : this.zoek;
    this.el.status.innerHTML = m + (this.zoek
      ? `${n} gevonden voor ${esc(kort || `"${this.zoek}"`)}${this._plekNu() ? ' — op de volgorde van de categorie (sleep een rij om hem te verzetten)' : ''}`
      : `${n} nummer${n === 1 ? '' : 's'} in de library`);
  }

  /**
   * De kolommen van de lijst. Met de kolom INDELING open (spoor S11) vallen LUFS en racks weg: zo past
   * de lijst met alle laadknoppen nog op 1440 px. ☰ dicht = alle kolommen.
   */
  _zetKolommen() {
    const smal = this.indeling?.aan && this.indeling.open;
    this.kolommen = smal ? KOLOMMEN.filter((k) => !SMAL_WEG.includes(k.id)) : KOLOMMEN;
    this.root.style.setProperty('--lib-kolommen', kolomSjabloon(this.kolommen));
    if (this.el.kop) { this.tekenKop(); this.tekenRijen(); }
  }

  /** De kolomkop: sorteerknoppen, en onzichtbare knoppen zodat de kolommen gelijk lopen met de rijen. */
  tekenKop() {
    // Op de volgorde van een categorie: geen kolom "aan" (de statusregel zegt het).
    const html = kopHtml(this._plekNu?.() ? null : this.sortering,
      this.decks.map((d) => `<button class="btn sm lib-trk" tabindex="-1">${esc(this.label(d))}</button>`).join('')
      + '<button class="btn sm" tabindex="-1">↻</button><button class="btn sm" tabindex="-1">×</button>', this.kolommen);
    if (this.el.kop._html !== html) { this.el.kop._html = html; this.el.kop.innerHTML = html; }
  }

  /**
   * Alleen de rijen die je ziet (plus een marge) staan in de DOM; de ruimte
   * eromheen is zo hoog als de hele lijst, dus de scrollbalk klopt.
   */
  tekenRijen() {
    const totaal = this.cache.totaal;
    this.el.kop.classList.toggle('hidden', !totaal);
    if (!totaal) {
      this.el.ruimte.style.height = '';
      this.el.venster.style.transform = '';
      this.el.venster.innerHTML = this.zoek
        ? `<div class="lib-leeg">niets gevonden voor ${esc(this.indeling?.aan ? this.indeling.kort(this.filter) || `"${this.zoek}"` : `"${this.zoek}"`)}</div>`
        : `<div class="lib-leeg">nog niets binnengehaald — plak hierboven een YouTube- of TikTok-link, of sleep je eigen audio en video hierheen</div>`;
      return;
    }
    const { van, tot } = this._venster();
    this.el.ruimte.style.height = `${totaal * RIJ_H}px`;
    this.el.venster.style.transform = `translateY(${van * RIJ_H}px)`;
    const nu = Date.now();
    // Per deck één keer vragen, niet per rij.
    const standen = this.decks.map((d) => this.stand(d));
    const staat = { kiezer: this.kiezer, tagKleuren: this.indeling?.kleuren, ...this._stemsStaat() };
    this._stemsHtml.clear();
    const rijen = [];
    let kiezer = '';
    for (let i = van; i < tot; i++) {
      const t = this.cache.rij(i);
      if (!t) { rijen.push(`<div class="lib-rij laadt${i === this.gekozen ? ' gekozen' : ''}" data-i="${i}"><span class="lib-titel">…</span></div>`); continue; }
      const laadt = this.bezig.has(t.id);
      const her = this.analyseert.has(t.id);
      this._stemsHtml.set(t.id, stemsCelHtml(t, staat));
      rijen.push(`<div class="lib-rij${i === this.gekozen ? ' gekozen' : ''}${this.selectie.has(t.id) ? ' sel' : ''}" data-i="${i}" data-id="${esc(t.id)}" draggable="true">${cellenHtml(t, nu, staat, this.kolommen)}
        <span class="lib-knoppen">
          ${this.decks.map((d, k) => `<button class="btn sm lib-trk ${standen[k]}" data-deck="${d}" data-id="${esc(t.id)}" title="laad op track ${this.label(d)} (${standen[k]})"${laadt ? ' disabled' : ''}>${laadt ? '…' : this.label(d)}</button>`).join('')}
          <button class="btn sm lib-her${her ? ' bezig' : ''}" data-her="${esc(t.id)}" title="grid en toonsoort opnieuw analyseren${t.grid?.slot || t.toon?.slot ? ' (staat op slot: tweede klik)' : ''}">${her ? '…' : '↻'}</button>
          <button class="btn sm lib-weg" data-weg="${esc(t.id)}" title="uit de lijst halen">×</button>
        </span>
      </div>`);
      // De kiezer ZWEEFT onder zijn rij, over de rijen eronder heen: de lijst
      // rekent met een vaste rijhoogte (scrollbalk, welke rijen in beeld), en
      // een kiezer tussen de rijen zou alles eronder laten verspringen zodra
      // zijn rij uit het getekende stuk scrollt.
      if (this.kiezer === t.id) kiezer = this.kiezerHtml(t, (i - van + 1) * RIJ_H);
    }
    this.el.venster.innerHTML = rijen.join('') + kiezer;
  }
}
