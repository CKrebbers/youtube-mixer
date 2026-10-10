import { esc } from './dom.js';
import { RIJ_H, PaginaCache, zichtbaar, kolomSjabloon, kopHtml, cellenHtml, standaardOpslag } from './library-lijst.js';
import {
  kolommenVoor, effectieveSortering, sorteringBijKrat, TABS, leesTab, bewaarTab, leesSortering, bewaarSortering, volgendeSortering, kaartUrl, alsPagina, alsRij,
  wisselFilter, filterKnoppenHtml, standCelHtml, kratOptiesHtml, kratVan, moetBevestigen, bevestigingsTekst, wensUitkomst,
  zekereKandidaat, kieslijstHtml, wensTelling, wensTellingTekst, laatsteRunTekst, nachtStandTekst, nachtWijziging, speeldagenTekst, SPEELT_UITLEG,
} from './kaart-lijst.js';

/**
 * De tab "kaart" in het library-paneel: de muziekkaart als zoeklaag
 * (scratchpad CONTRACT-KAART.md deel 3). Zoeken, kratten, filters, sorteren
 * op de kolomkop, per nummer "haal binnen" / "zoek" / laden op een track, de
 * wenslijst per krat en het blok Nachtwachtrij.
 *
 * Praat alleen met de server (/api/kaart, /api/nacht, /api/library/<id>). Het
 * laden op een track is een callback (het library-paneel doet het, zoals de
 * ingest-strook), dus de engine komt hier niet voor. Of een deck speelt weet
 * het paneel via `stand(deck)`, dezelfde functie als het library-paneel.
 *
 * De lijst is dezelfde virtuele lijst als de library (library-lijst.js): de
 * server pagineert, alleen zichtbare rijen staan in de DOM. De PaginaCache
 * krijgt de rijen met `id` = sleutel (alsPagina), zodat library-lijst.js
 * ongewijzigd blijft. Peilen (/api/nacht, /api/kaart/wensen) alleen zolang
 * de tab open is, elke 5 s; de stand-cellen worden dan los bijgewerkt.
 */
export class KaartPanel {
  constructor({ root, decks = ['A', 'B'], label = (d) => d, stand = () => 'leeg', laad = async () => {}, opslag = standaardOpslag(),
    peilMs = 5000 }) {
    this.root = root;
    this.decks = decks;
    this.label = label;
    this.stand = stand;          // (deck) => 'leeg' | 'geladen' | 'speelt'
    this.laad = laad;            // (track, deck) => laden op een track (het library-paneel)
    this.opslag = opslag;
    this.tab = leesTab(opslag);
    this.sortering = leesSortering(opslag);
    this.zoek = '';
    this.krat = '';
    this.filters = [];
    this.kratten = [];
    this.kaart = null;           // GET /api/kaart: { status, pad, gebouwd, aantal, fout }
    this.nacht = null;           // GET /api/nacht
    this.wensen = [];            // GET /api/kaart/wensen
    this.melding = null;
    this.zeker = null;           // tweede klik binnen 3 s
    this.bezig = new Set();      // sleutels waar een verzoek voor loopt
    this.gekozen = new Map();    // sleutel -> { youtube_id, titel } (na "zoek")
    this.kandidaten = new Map(); // sleutel -> kandidaten van de laatste zoekopdracht
    this.kieslijst = null;       // { sleutel } als het kieslijstje open staat
    this.bevestig = null;        // { sleutels, naam } als er een bevestiging openstaat
    this._speelde = false;
    this._standHtml = new Map();
    this.cache = new PaginaCache(async (vraag, pagina) => {
      const r = await fetch(kaartUrl(vraag, pagina));
      const j = await r.json();
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      return alsPagina(j);
    });

    const q = (s) => root.querySelector(s);
    this.el = {
      tabs: root.querySelectorAll('.lib-tabs button[data-tab]'),
      deel: q('.kaart-deel'),
      zoek: q('.kaart-zoek'),
      krat: q('.kaart-krat'),
      filters: q('.kaart-filters'),
      kratWens: q('.kaart-krat-wens'),
      status: q('.kaart-status'),
      rijen: q('.kaart-rijen'),
      nacht: q('.kaart-nacht'),
    };
    if (!this.el.deel) throw new Error('kaart-panel: de markup (.kaart-deel) ontbreekt in index.html');

    // De tabs: library | kaart. De keuze blijft staan (localStorage).
    for (const b of this.el.tabs) b.addEventListener('click', () => this.zetTab(b.dataset.tab));

    // Zoeken: even wachten tot je uitgetypt bent, dan bovenaan.
    let zoekTimer = null;
    this.el.zoek.addEventListener('input', () => {
      clearTimeout(zoekTimer);
      zoekTimer = setTimeout(() => {
        const zoek = this.el.zoek.value.trim();
        if (zoek !== this.zoek) { this.zoek = zoek; this.ververs({ bovenaan: true }); }
      }, 120);
    });
    this.el.krat.addEventListener('change', () => {
      this.krat = this.el.krat.value;
      // Een krat kiezen met de standaardsortering = de volgorde van de krat (zoals de server zonder `sorteer`).
      this.sortering = sorteringBijKrat(this.sortering, this.krat);
      this.tekenKop();
      this.ververs({ bovenaan: true });
    });
    this.el.filters.innerHTML = filterKnoppenHtml(this.filters);
    this.el.filters.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-filter]');
      if (!b) return;
      this.filters = wisselFilter(this.filters, b.dataset.filter);
      this.el.filters.innerHTML = filterKnoppenHtml(this.filters);
      this.ververs({ bovenaan: true });
    });
    this.el.kratWens.addEventListener('click', () => this.kratOpWenslijst());
    this.el.status.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-bevestig]');
      if (!b) return;
      const bev = this.bevestig;
      this.bevestig = null;
      if (b.dataset.bevestig === 'ja' && bev) this._wens(bev.sleutels, { bevestig: true, naam: bev.naam });
      else this.tekenStatus();
    });

    // Het blok Nachtwachtrij: knoppen en velden sturen een gedeeltelijke POST /api/nacht.
    this.el.nacht.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-nacht]');
      if (!b) return;
      const veld = b.dataset.nacht;
      if (veld === 'aan' || veld === 'vandaagNiet') this.zetNacht(nachtWijziging(veld, !this.nacht?.[veld]));
    });
    this.el.nacht.addEventListener('change', (e) => {
      const inp = e.target.closest('input[data-nacht]');
      if (!inp) return;
      const w = nachtWijziging(inp.dataset.nacht, inp.value, this.nacht || {});
      if (w) this.zetNacht(w);
      else { this.melding = { tekst: `"${inp.value}" is geen geldige waarde voor ${inp.dataset.nacht}`, goed: false }; this.tekenStatus(); this.tekenNacht(); }
    });

    // Kop, lege ruimte zo hoog als de hele lijst, en het venster met de rijen die je ziet.
    this.el.rijen.innerHTML = '<div class="lib-kop"></div><div class="lib-ruimte"><div class="lib-venster"></div></div>';
    this.el.kop = this.el.rijen.querySelector('.lib-kop');
    this.el.ruimte = this.el.rijen.querySelector('.lib-ruimte');
    this.el.venster = this.el.rijen.querySelector('.lib-venster');
    this.el.rijen.style.setProperty('--lib-rij-h', `${RIJ_H}px`);
    this.el.rijen.style.setProperty('--lib-kolommen', kolomSjabloon(this.kolommen));
    let beeld = 0;
    const volg = () => {
      if (beeld || !this.open) return;
      beeld = requestAnimationFrame(() => {
        beeld = 0;
        if (!this.cache.vraag) return this.ververs();
        this.tekenRijen();
        this._haalZichtbaar();
      });
    };
    this.el.rijen.addEventListener('scroll', volg, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(volg).observe(this.el.rijen);

    // Niet bijwerken terwijl je in de lijst drukt (zie library-panel.js).
    this._vast = false;
    this._later = false;
    this.el.rijen.addEventListener('pointerdown', () => { this._vast = true; });
    const los = () => {
      if (!this._vast) return;
      this._vast = false;
      if (this._later) { this._later = false; setTimeout(() => this._standBijwerken(), 0); }
    };
    globalThis.addEventListener?.('pointerup', los, true);
    globalThis.addEventListener?.('pointercancel', los, true);

    this.el.rijen.addEventListener('click', (e) => this._klik(e));

    // Peilen alleen met de tab open: de nachtwachtrij en de wensen elke 5 s,
    // en elke seconde of er intussen een deck is gaan spelen (de knoppen).
    this._peilTimer = setInterval(() => { if (this.open) this._peil(); }, peilMs);
    this._speeltTimer = setInterval(() => { if (this.open && this.speelt() !== this._speelde) this._standBijwerken(); }, 1000);

    this.zetTab(this.tab, { bewaar: false });
  }

  /** Staat de kaart in beeld: het paneel open én deze tab gekozen. */
  get open() { return !this.root.classList.contains('hidden') && this.tab === 'kaart'; }

  /** Speelt er een deck? Dan geen "haal binnen" en geen "zoek" (contract deel 3). */
  speelt() { return this.decks.some((d) => this.stand(d) === 'speelt'); }

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

  zetTab(tab, { bewaar = true } = {}) {
    if (!TABS.includes(tab)) return;
    this.tab = tab;
    if (bewaar) bewaarTab(this.opslag, tab);
    this.root.classList.toggle('tab-kaart', tab === 'kaart');
    for (const b of this.el.tabs) {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    this.el.deel.classList.toggle('hidden', tab !== 'kaart');
    // Kop en rijen van de kaart bestaan alleen zolang haar tab open staat: de
    // library (en tools/headless/library.mjs) zoekt op .lib-kop en .lib-rij in
    // het hele paneel, en moet niets van de kaart tegenkomen.
    if (tab !== 'kaart') { this.el.kop.innerHTML = ''; this.el.venster.innerHTML = ''; this.el.ruimte.style.height = ''; this._standHtml.clear(); }
    else this.tekenKop();
    if (this.open) { this.ververs(); this._peil(); }
  }

  /** Een nummer op sleutel, uit de geladen pagina's. */
  _nummer(sleutel) { return this.cache.vind(sleutel); }

  async _klik(e) {
    const kop = e.target.closest('button[data-sorteer]');
    if (kop) return this.sorteer(kop.dataset.sorteer);
    const deck = e.target.closest('button[data-deck]');
    if (deck) return this.laadOpDeck(deck.dataset.id, deck.dataset.track, deck.dataset.deck);
    const haal = e.target.closest('button[data-haal]');
    if (haal) return this.haalBinnen(haal.dataset.haal);
    const zoek = e.target.closest('button[data-zoek]');
    if (zoek) return this.zoekVideo(zoek.dataset.zoek);
    const weg = e.target.closest('button[data-weg]');
    if (weg) return this.wensWeg(weg.dataset.weg);
    const anders = e.target.closest('button[data-anders]');
    if (anders) return this.toonKieslijst(anders.dataset.anders);
    const kies = e.target.closest('button[data-kies]');
    if (kies) return this.kies(kies.dataset.id, kies.dataset.kies);
    const sluit = e.target.closest('button[data-kies-sluit]');
    if (sluit) { this.kieslijst = null; return this.tekenRijen(); }
  }

  /** Klik op een kolomkop. */
  sorteer(sleutel) {
    const nieuw = volgendeSortering(this.sortering, sleutel);
    if (nieuw === this.sortering) return;
    this.sortering = nieuw;
    bewaarSortering(this.opslag, nieuw);
    this.tekenKop();
    this.ververs({ bovenaan: true });
  }

  /** De kolommen van nu: met een krat de kratkolom vooraan (kolommenVoor). */
  get kolommen() { return kolommenVoor(!!this.krat); }

  /** De sortering die echt naar de server gaat (sorteer=krat alleen met een krat). */
  get sorteringEcht() { return effectieveSortering(this.sortering, this.krat); }

  _vraag() { return { zoek: this.zoek, krat: this.krat, filters: this.filters, ...this.sorteringEcht }; }

  /** GET /api/kaart: de stand van de kaart en de kratten (met aantal en hoeveel binnen). */
  async haalKaart() {
    try {
      const r = await fetch('/api/kaart');
      const j = await r.json();
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      this.kaart = j;
      this.kratten = Array.isArray(j.kratten) ? j.kratten : [];
    } catch (err) {
      this.kaart = { status: 'fout', fout: err.message };
      this.kratten = [];
    }
    this.tekenKratten();
  }

  /**
   * De lijst opnieuw van de server, het stuk dat je ziet in één keer geruild.
   * `bovenaan`: nieuwe zoekterm, krat, filter of sortering.
   */
  async ververs({ bovenaan = false } = {}) {
    if (bovenaan) { this.el.rijen.scrollTop = 0; this.kieslijst = null; }
    const { van, tot } = this._venster(Math.max(this.cache.totaal, 1));
    const kaart = this.haalKaart();
    try {
      if (!(await this.cache.ververs(this._vraag(), van, tot))) return;
    } catch (err) {
      this.melding = { tekst: `kaart niet geladen: ${err.message}`, goed: false };
    }
    await kaart;
    this.tekenStatus();
    this.tekenRijen();
    this._haalZichtbaar();
  }

  _venster(totaal = this.cache.totaal) {
    return zichtbaar({ boven: this.el.rijen.scrollTop, hoogte: this.el.rijen.clientHeight || 400, totaal });
  }

  async _haalZichtbaar() {
    const { van, tot } = this._venster();
    if (await this.cache.zorgVoor(van, tot)) { this.tekenStatus(); this.tekenRijen(); }
  }

  /** Eén rij opnieuw van de server (na haal binnen, kies, weg): de stand klopt dan meteen. */
  async _vernieuwRij(sleutel) {
    try {
      const r = await fetch(`/api/kaart/nummer/${encodeURIComponent(sleutel)}`);
      if (!r.ok) return;
      // De server geeft { nummer } (docs/KAART.md §3); de nep deed dat eerst niet.
      const j = await r.json();
      const n = alsRij(j.nummer ?? j);
      if (!n.sleutel) return;
      const oud = this._nummer(sleutel);
      if (oud) Object.assign(oud, n);
    } catch {}
    this._standBijwerken();
  }

  // ---- per nummer ---------------------------------------------------------------

  /** Laden op een track: het nummer staat als track `trackId` in de library. */
  async laadOpDeck(sleutel, trackId, deck) {
    const n = this._nummer(sleutel);
    if (!n || this.bezig.has(sleutel)) return;
    if (this.stand(deck) === 'speelt' && !this._bevestigd('laad', `${sleutel}:${deck}`)) {
      this.melding = { tekst: `track ${this.label(deck)} speelt — klik nog eens om er toch overheen te laden`, goed: false };
      return this.tekenStatus();
    }
    this.bezig.add(sleutel);
    this._standBijwerken();
    try {
      const r = await fetch(`/api/library/${encodeURIComponent(trackId)}`);
      if (r.status === 404) throw new Error('staat niet (meer) in de library');
      if (!r.ok) throw new Error(`${r.status}`);
      const { track } = await r.json();
      await this.laad(track, deck);
      this.melding = { tekst: `${n.artiest} – ${n.titel} staat op track ${this.label(deck)}`, goed: true };
    } catch (err) {
      this.melding = { tekst: `laden mislukt: ${err.message}`, goed: false };
      if (/niet \(meer\)/.test(err.message)) this.ververs();
    }
    this.bezig.delete(sleutel);
    this.tekenStatus();
    this._standBijwerken();
  }

  /** "haal binnen": nu, via de ingest-wachtrij (meteen: true). Niet als er een deck speelt. */
  async haalBinnen(sleutel) {
    if (this.speelt()) { this.melding = { tekst: SPEELT_UITLEG, goed: false }; return this.tekenStatus(); }
    if (this.bezig.has(sleutel)) return;
    this.bezig.add(sleutel);
    this._standBijwerken();
    await this._wens([sleutel], { meteen: true });
    this.bezig.delete(sleutel);
    await this._vernieuwRij(sleutel);
  }

  /**
   * POST /api/kaart/wens. Meer dan 20 zonder bevestiging geeft 409: dan vragen
   * we het (met de schatting in MB) en gaat het pas na "ja".
   */
  async _wens(sleutels, { meteen = false, bevestig = false, naam = 'deze krat' } = {}) {
    let j;
    try {
      const r = await fetch('/api/kaart/wens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sleutels, meteen, bevestig }),
      });
      j = await r.json().catch(() => ({}));
      if (r.status === 409 && /meer dan 20/.test(j.fout || '')) {
        this.bevestig = { sleutels, naam };
        return this.tekenStatus();
      }
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
    } catch (err) {
      this.melding = { tekst: `wenslijst: ${err.message}`, goed: false };
      return this.tekenStatus();
    }
    this.melding = wensUitkomst(j, { meteen });
    this.tekenStatus();
    this._peil();
    if (sleutels.length > 1) this.ververs();
  }

  /** × bij een wens die wacht of mislukte: van de wenslijst. */
  async wensWeg(sleutel) {
    try {
      const r = await fetch(`/api/kaart/wens/${encodeURIComponent(sleutel)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`${r.status}`);
      const n = this._nummer(sleutel);
      if (n) n.wens = null;
      this.gekozen.delete(sleutel);
      this.melding = { tekst: `${n ? `${n.artiest} – ${n.titel}` : sleutel} van de wenslijst`, goed: true };
    } catch (err) {
      this.melding = { tekst: `niet van de wenslijst: ${err.message}`, goed: false };
    }
    this.tekenStatus();
    await this._vernieuwRij(sleutel);
    this._peil();
  }

  /**
   * "zoek": kandidaten van de server (yt-dlp, zonder cookies). Score ≥ 0,9 =
   * meteen gekozen ("gekozen: …" met "anders"); anders het kieslijstje.
   */
  async zoekVideo(sleutel) {
    if (this.speelt()) { this.melding = { tekst: SPEELT_UITLEG, goed: false }; return this.tekenStatus(); }
    const n = this._nummer(sleutel);
    if (!n || this.bezig.has(sleutel)) return;
    this.bezig.add(sleutel);
    this._standBijwerken();
    let kandidaten;
    try {
      const r = await fetch(`/api/kaart/nummer/${encodeURIComponent(sleutel)}/zoek`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      kandidaten = Array.isArray(j.kandidaten) ? j.kandidaten : [];
    } catch (err) {
      this.bezig.delete(sleutel);
      this.melding = { tekst: `zoeken mislukt: ${err.message}`, goed: false };
      this.tekenStatus();
      return this._standBijwerken();
    }
    this.bezig.delete(sleutel);
    this.kandidaten.set(sleutel, kandidaten);
    const zeker = zekereKandidaat(kandidaten);
    if (zeker) {
      await this.kies(sleutel, zeker.youtube_id, { stil: true });
      this.melding = { tekst: `${n.artiest} – ${n.titel}: zeker gevonden (${zeker.titel || zeker.youtube_id}, score ${zeker.score.toFixed(2).replace('.', ',')}) — "anders" voor een andere`, goed: true };
      return this.tekenStatus();
    }
    this.melding = { tekst: kandidaten.length ? `${kandidaten.length} kandidaten voor ${n.artiest} – ${n.titel}: kies er een` : `niets gevonden voor ${n.artiest} – ${n.titel}`, goed: kandidaten.length > 0 };
    this.tekenStatus();
    this.toonKieslijst(sleutel);
  }

  /** Het kieslijstje onder de rij (ook via "anders"). Nog geen kandidaten: eerst zoeken. */
  toonKieslijst(sleutel) {
    if (!this.kandidaten.has(sleutel)) return this.zoekVideo(sleutel);
    this.kieslijst = { sleutel };
    this.tekenRijen();
    this._kieslijstInBeeld();
  }

  /** POST .../kies: deze video wordt het, de wens gaat (weer) wachten. */
  async kies(sleutel, youtubeId, { stil = false } = {}) {
    const n = this._nummer(sleutel);
    const kandidaat = (this.kandidaten.get(sleutel) || []).find((k) => k.youtube_id === youtubeId) || { youtube_id: youtubeId };
    try {
      const r = await fetch(`/api/kaart/nummer/${encodeURIComponent(sleutel)}/kies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ youtube_id: youtubeId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      this.gekozen.set(sleutel, { youtube_id: youtubeId, titel: kandidaat.titel || youtubeId });
      if (!stil) this.melding = { tekst: `${n ? `${n.artiest} – ${n.titel}` : sleutel}: ${kandidaat.titel || youtubeId} gekozen, staat op de wenslijst`, goed: true };
    } catch (err) {
      this.melding = { tekst: `kiezen mislukt: ${err.message}`, goed: false };
    }
    this.kieslijst = null;
    this.tekenStatus();
    this.tekenRijen();
    await this._vernieuwRij(sleutel);
    this._peil();
  }

  // ---- de krat op de wenslijst ------------------------------------------------------

  /** Alle sleutels van een krat die nog niet binnen zijn (pagina's van 500). */
  async _kratSleutels(kratId) {
    const uit = [];
    for (let p = 0; p < 200; p++) {
      const r = await fetch(kaartUrl({ krat: kratId, filters: ['niet-binnen'], sorteer: 'beurten', richting: 'af' }, p, 500));
      const j = await r.json();
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      for (const n of j.nummers || []) uit.push(n.sleutel);
      if (uit.length >= (j.totaal ?? 0) || !(j.nummers || []).length) break;
    }
    return uit;
  }

  /** De knop "alles in deze krat op de wenslijst": bij meer dan 20 eerst bevestigen. */
  async kratOpWenslijst() {
    const krat = kratVan(this.kratten, this.krat);
    if (!krat) { this.melding = { tekst: 'kies eerst een krat in de kiezer hiernaast', goed: false }; return this.tekenStatus(); }
    let sleutels;
    try { sleutels = await this._kratSleutels(krat.id); } catch (err) {
      this.melding = { tekst: `krat niet gelezen: ${err.message}`, goed: false };
      return this.tekenStatus();
    }
    if (!sleutels.length) { this.melding = { tekst: `alles uit "${krat.naam}" staat al in de library`, goed: true }; return this.tekenStatus(); }
    if (moetBevestigen(sleutels.length)) { this.bevestig = { sleutels, naam: `"${krat.naam}"` }; return this.tekenStatus(); }
    await this._wens(sleutels, { naam: `"${krat.naam}"` });
  }

  // ---- nachtwachtrij -------------------------------------------------------------------

  async zetNacht(wijziging) {
    if (!wijziging) return;
    try {
      const r = await fetch('/api/nacht', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wijziging) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      this.nacht = j;
    } catch (err) {
      this.melding = { tekst: `nachtwachtrij niet ingesteld: ${err.message}`, goed: false };
      this.tekenStatus();
    }
    this.tekenNacht();
  }

  /** De peiling: nachtwachtrij en wensen; de wensen gaan in de rijen die er zijn. */
  async _peil() {
    if (this._peilt) return;
    this._peilt = true;
    const [n, w] = await Promise.allSettled([
      fetch('/api/nacht').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
      fetch('/api/kaart/wensen').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
    ]);
    this._peilt = false;
    if (n.status === 'fulfilled') this.nacht = n.value;
    else this.nacht = { fout: n.reason?.message };
    let klaarErbij = false;
    if (w.status === 'fulfilled') {
      const wensen = Array.isArray(w.value?.wensen) ? w.value.wensen : [];
      const per = new Map(wensen.map((x) => [x.sleutel, x]));
      for (const rij of this.cache.geladen) {
        const x = per.get(rij.sleutel);
        if (x) {
          if (x.status === 'klaar' && !rij.binnen) klaarErbij = true;
          rij.wens = { status: x.status, fout: x.fout ?? null, youtube_id: x.youtube_id ?? null };
        } else if (rij.wens && rij.wens.status !== 'klaar') rij.wens = null;   // van de wenslijst gehaald
      }
      this.wensen = wensen;
    }
    this.tekenNacht();
    this._standBijwerken();
    // Een wens die klaar is maar in de lijst nog niet "binnen": de lijst opnieuw (met `binnen`).
    if (klaarErbij) this.ververs();
  }

  // ---- tekenen --------------------------------------------------------------------------

  tekenKratten() {
    const huidig = this.el.krat.value;
    this.el.krat.innerHTML = kratOptiesHtml(this.kratten, this.krat, this.kaart?.aantal ?? null);
    if (this.krat && !kratVan(this.kratten, this.krat)) { this.krat = ''; }
    if (this.el.krat.value !== huidig && this.el.krat.value !== this.krat) this.el.krat.value = this.krat;
    const krat = kratVan(this.kratten, this.krat);
    this.el.kratWens.disabled = !krat;
    this.el.kratWens.title = krat
      ? `alle nummers uit "${krat.naam}" die nog niet binnen zijn op de wenslijst (meer dan 20: eerst bevestigen)`
      : 'kies eerst een krat';
  }

  tekenStatus() {
    const n = this.cache.totaal;
    const k = this.kaart;
    let tekst;
    if (k?.status === 'ontbreekt') tekst = `de kaart ontbreekt${k.pad ? ` (${esc(k.pad)})` : ''} — bouw hem in de muziekkaart (stap "varve")`;
    else if (k?.status === 'fout') tekst = `kaart: ${esc(k.fout || 'fout')}`;
    else {
      const krat = kratVan(this.kratten, this.krat);
      const waar = krat ? ` in krat "${esc(krat.naam)}"` : '';
      const filt = this.filters.length ? ` (${this.filters.map((f) => f.replace('-', ' ')).join(', ')})` : '';
      tekst = this.zoek ? `${n} gevonden voor "${esc(this.zoek)}"${waar}${filt}` : `${n} nummer${n === 1 ? '' : 's'}${waar || ' op de kaart'}${filt}`;
      if (k?.gebouwd) tekst += ` <small title="gebouwd ${esc(k.gebouwd)}">· kaart van ${esc(String(k.gebouwd).slice(0, 10))}</small>`;
    }
    const m = this.melding ? `<b class="${this.melding.goed ? 'goed' : 'bad'}">${esc(this.melding.tekst)}</b> &nbsp;·&nbsp; ` : '';
    const bev = this.bevestig
      ? `<span class="kaart-bevestig"><b class="bad">${esc(bevestigingsTekst(this.bevestig.sleutels.length, this.bevestig.naam))}</b>`
        + ` <button class="btn sm" data-bevestig="ja">ja, op de wenslijst</button> <button class="btn sm" data-bevestig="nee">nee</button></span> &nbsp;·&nbsp; `
      : '';
    this.el.status.innerHTML = bev + m + tekst;
  }

  tekenKop() {
    const kolommen = this.kolommen;
    this.el.rijen.style.setProperty('--lib-kolommen', kolomSjabloon(kolommen));
    this.el.kop.innerHTML = kopHtml(this.sorteringEcht, '', kolommen);
  }

  /** Wat de stand-cellen nodig hebben. */
  _staat() {
    const speelt = this.speelt();
    this._speelde = speelt;
    return { decks: this.decks, label: this.label, standen: this.decks.map((d) => this.stand(d)), speelt, bezig: this.bezig, gekozen: this.gekozen };
  }

  /** Alleen de stand-cellen in beeld, en alleen wat anders is. Niet terwijl je in de lijst drukt. */
  _standBijwerken() {
    if (!this.open || !this.el.venster) return;
    if (this._vast) { this._later = true; return; }
    const staat = this._staat();
    for (const el of this.el.venster.querySelectorAll('[data-stand]')) {
      const n = this._nummer(el.dataset.stand);
      if (!n) continue;
      const html = standCelHtml(n, staat);
      if (this._standHtml.get(n.sleutel) === html) continue;
      this._standHtml.set(n.sleutel, html);
      el.innerHTML = html;
    }
  }

  tekenNacht() {
    if (this.el.nacht.contains(document.activeElement) && document.activeElement !== document.body) return;   // niet onder je vingers vandaan
    const n = this.nacht;
    if (!n || n.fout) {
      this.el.nacht.innerHTML = `<span class="kaart-nacht-kop">NACHTWACHTRIJ</span><span class="kaart-nacht-stand bad">${n?.fout ? `niet bereikbaar (${esc(n.fout)})` : '…'}</span>`;
      return;
    }
    const t = wensTelling(this.wensen);
    const v = n.venster || { van: '01:00', tot: '07:00' };
    this.el.nacht.innerHTML = `<span class="kaart-nacht-kop">NACHTWACHTRIJ</span>
      <button class="btn sm kaart-nacht-aan${n.aan ? ' on' : ''}" data-nacht="aan" aria-pressed="${!!n.aan}" title="${n.aan ? 'de nachtwachtrij staat aan: uitzetten' : 'de nachtwachtrij staat uit (standaard): aanzetten'}">${n.aan ? 'aan' : 'uit'}</button>
      <label title="hoeveel nummers per nacht, hooguit">per nacht <input class="kaart-nacht-per" type="number" min="1" max="500" data-nacht="perNacht" value="${esc(n.perNacht ?? 80)}"></label>
      <label title="alleen tussen deze tijden">venster <input type="time" data-nacht="van" value="${esc(v.van)}"> – <input type="time" data-nacht="tot" value="${esc(v.tot)}"></label>
      <button class="btn sm${n.vandaagNiet ? ' on' : ''}" data-nacht="vandaagNiet" aria-pressed="${!!n.vandaagNiet}" title="vannacht overslaan (speeldag)">vandaag niet</button>
      <span class="kaart-nacht-speeldagen" title="speeldagen: op die datum (en de nacht erna) haalt de nacht niets">speeldagen: ${esc(speeldagenTekst(n.speeldagen, n.nu))}</span>
      <span class="kaart-nacht-run" title="de laatste run">laatste run: ${esc(laatsteRunTekst(n.laatsteRun))}</span>
      <span class="kaart-nacht-wensen" title="de wenslijst: wat wacht, wat binnen is, wat mislukte">wenslijst: ${esc(wensTellingTekst(t))}</span>
      <span class="kaart-nacht-stand${n.bezig ? ' bezig' : ''}">${esc(nachtStandTekst(n))}${n.pauze ? ` · pauze ${esc(n.pauze.min)}–${esc(n.pauze.max)} s` : ''}</span>`;
  }

  /** Het kieslijstje onder een van de onderste rijen: de lijst zover schuiven dat hij in beeld staat. */
  _kieslijstInBeeld() {
    const k = this.el.venster.querySelector('.kaart-kieslijst');
    if (!k) return;
    const onder = k.getBoundingClientRect().bottom - this.el.rijen.getBoundingClientRect().bottom;
    if (onder > 0) this.el.rijen.scrollTop += Math.ceil(onder) + 4;
  }

  /** Alleen de rijen die je ziet (plus marge); de ruimte eromheen zo hoog als de hele lijst. */
  tekenRijen() {
    if (this.tab !== 'kaart') return;
    const totaal = this.cache.totaal;
    this.el.kop.classList.toggle('hidden', !totaal);
    if (!totaal) {
      this.el.ruimte.style.height = '';
      this.el.venster.style.transform = '';
      const k = this.kaart;
      this.el.venster.innerHTML = k?.status === 'ontbreekt' ? `<div class="lib-leeg">de kaart is nog niet gebouwd${k.pad ? ` — verwacht op ${esc(k.pad)}` : ''}</div>`
        : this.zoek || this.filters.length || this.krat ? `<div class="lib-leeg">niets gevonden${this.zoek ? ` voor "${esc(this.zoek)}"` : ''}${this.krat ? ' in deze krat' : ''}${this.filters.length ? ' met deze filters' : ''}</div>`
          : '<div class="lib-leeg">de kaart is leeg</div>';
      return;
    }
    const { van, tot } = this._venster();
    this.el.ruimte.style.height = `${totaal * RIJ_H}px`;
    this.el.venster.style.transform = `translateY(${van * RIJ_H}px)`;
    const nu = Date.now();
    const staat = this._staat();
    const kolommen = this.kolommen;
    // Gesorteerd op de krat: het rangnummer in de krat in de kratkolom (op: 1, 2, …; af: van achteren).
    const s = this.sorteringEcht;
    const opKrat = s.sorteer === 'krat';
    this._standHtml.clear();
    const rijen = [];
    let kieslijst = '';
    for (let i = van; i < tot; i++) {
      const n = this.cache.rij(i);
      if (!n) { rijen.push(`<div class="lib-rij kaart-rij laadt" data-i="${i}"><span class="kaart-artiest">…</span></div>`); continue; }
      staat.volgnr = opKrat ? (s.richting === 'op' ? i + 1 : totaal - i) : null;
      this._standHtml.set(n.sleutel, standCelHtml(n, staat));
      rijen.push(`<div class="lib-rij kaart-rij${n.klasse === 'twijfel' ? ' twijfel' : ''}" data-i="${i}" data-sleutel="${esc(n.sleutel)}">${cellenHtml(n, nu, staat, kolommen)}<span class="lib-knoppen"></span></div>`);
      // Het kieslijstje zweeft onder zijn rij, zoals de toonsoortkiezer in de library.
      if (this.kieslijst?.sleutel === n.sleutel) {
        kieslijst = kieslijstHtml(n.sleutel, this.kandidaten.get(n.sleutel) || [], (i - van + 1) * RIJ_H, { gekozen: this.gekozen.get(n.sleutel)?.youtube_id ?? null });
      }
    }
    this.el.venster.innerHTML = rijen.join('') + kieslijst;
  }
}
