import { esc } from './dom.js';
import { gridStatus } from './grid-strook.js';
import { libraryToon, KIEZER } from './toon-weergave.js';
import { ToonKaart, camelot, kortNaam, volleNaam } from '../engine/toonsoort.js';
import {
  RIJ_H, PaginaCache, lijstUrl, zichtbaar, volgendeSortering, leesSortering, bewaarSortering,
  kolomSjabloon, kopHtml, cellenHtml, standaardOpslag,
} from './library-lijst.js';

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
    stand = () => 'leeg', opslag = standaardOpslag() }) {
    this.root = root;
    this.onLaad = onLaad;
    this.onGrid = onGrid;        // (trackId, grid) na "opnieuw analyseren": op de decks zetten
    this.onToon = onToon;        // (trackId, toon) na kiezen in de library: op de decks zetten
    this.kiezer = null;          // track-id waarvan de toonsoortkiezer open staat
    this.decks = decks;
    this.label = label;
    this.stand = stand;          // (deck) => 'leeg' | 'geladen' | 'speelt'
    this.zeker = null;           // { soort, sleutel, tot } voor 'nog eens klikken'
    this.opdrachten = [];
    this.bezig = new Set();     // tracks die nu geladen worden
    this.analyseert = new Set(); // tracks waarvan grid en toonsoort nu opnieuw geanalyseerd worden
    this.melding = null;
    this.zoek = '';
    // De lijst: pagina's van de server, alleen zichtbare rijen getekend (library-lijst.js).
    this.opslag = opslag;
    this.sortering = leesSortering(opslag);
    this.cache = new PaginaCache(async (vraag, pagina) => {
      const r = await fetch(lijstUrl(vraag, pagina));
      const j = await r.json();
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      return j;
    });

    this.uploads = [];          // { sleutel, naam, pct, fout } — lokaal, tot de server een opdracht heeft
    this.naLaden = new Map();   // opdracht-id -> deck: na de ingest op die track laden (gesleept op een track)

    this.el = {
      url: root.querySelector('.lib-url'),
      haal: root.querySelector('.lib-haal'),
      bestand: root.querySelector('.lib-bestand'),
      bestanden: root.querySelector('.lib-bestanden'),
      zoek: root.querySelector('.lib-zoek'),
      status: root.querySelector('.lib-status'),
      jobs: root.querySelector('.lib-jobs'),
      rijen: root.querySelector('.lib-rijen'),
    };

    this.el.haal.addEventListener('click', () => this.haalBinnen());
    this.el.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.haalBinnen(); });
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
    // Zoeken op de server: even wachten tot je uitgetypt bent, en dan bovenaan beginnen.
    let zoekTimer = null;
    this.el.zoek.addEventListener('input', () => {
      clearTimeout(zoekTimer);
      zoekTimer = setTimeout(() => {
        const zoek = this.el.zoek.value.trim();
        if (zoek !== this.zoek) { this.zoek = zoek; this.ververs({ bovenaan: true }); }
      }, 120);
    });

    // Kop, lege ruimte zo hoog als de hele lijst, en het venster met de rijen die je ziet.
    this.el.rijen.innerHTML = '<div class="lib-kop"></div><div class="lib-ruimte"><div class="lib-venster"></div></div>';
    this.el.kop = this.el.rijen.querySelector('.lib-kop');
    this.el.ruimte = this.el.rijen.querySelector('.lib-ruimte');
    this.el.venster = this.el.rijen.querySelector('.lib-venster');
    root.style.setProperty('--lib-rij-h', `${RIJ_H}px`);
    root.style.setProperty('--lib-kolommen', kolomSjabloon());
    this.tekenKop();
    let beeld = 0;
    const volg = () => {
      if (beeld) return;
      beeld = requestAnimationFrame(() => { beeld = 0; this.tekenRijen(); this._haalZichtbaar(); });
    };
    this.el.rijen.addEventListener('scroll', volg, { passive: true });
    // Het paneel opent (0 -> 340 px hoog): dan pas weten we hoeveel rijen er passen.
    if (typeof ResizeObserver === 'function') new ResizeObserver(volg).observe(this.el.rijen);

    this.el.rijen.addEventListener('click', (e) => {
      const kop = e.target.closest('button[data-sorteer]');
      if (kop) return this.sorteer(kop.dataset.sorteer);
      // Toonsoort: klik op de badge = de kiezer onder die rij, open of dicht.
      const toon = e.target.closest('button[data-toon]');
      if (toon) {
        this.kiezer = this.kiezer === toon.dataset.toon ? null : toon.dataset.toon;
        return this.tekenRijen();
      }
      const tk = e.target.closest('button[data-tk]');
      if (tk) {
        if (tk.dataset.tk === 'sluit') { this.kiezer = null; return this.tekenRijen(); }
        return this.kiesToon(tk.dataset.id, tk.dataset.tk);
      }
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
    });

    this.ververs();
    this.pollen();
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

  /** Klik op een kolomkop. */
  sorteer(sleutel) {
    const nieuw = volgendeSortering(this.sortering, sleutel);
    if (nieuw === this.sortering) return;
    this.sortering = nieuw;
    bewaarSortering(this.opslag, nieuw);
    this.tekenKop();
    this.ververs({ bovenaan: true });
  }

  async haalBinnen() {
    const url = this.el.url.value.trim();
    if (!url) return;
    this.el.haal.disabled = true;
    try {
      const r = await fetch('/api/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const j = await r.json();
      if (!r.ok) { this.melding = { tekst: j.fout || 'kon de ingest niet starten', goed: false }; }
      else { this.el.url.value = ''; this.melding = { tekst: 'binnenhalen gestart', goed: true }; }
    } catch (err) {
      this.melding = { tekst: `server niet bereikbaar: ${err.message}`, goed: false };
    }
    this.el.haal.disabled = false;
    this.tekenStatus();
    this.pollJobs();
  }

  /** Meerdere bestanden: één voor één uploaden (de ingest loopt daarna op de server). */
  async uploadBestanden(files) {
    const goed = files.filter(isMediaBestand);
    const fout = files.filter((f) => !isMediaBestand(f));
    if (fout.length) {
      this.melding = { tekst: `overgeslagen: ${fout.map((f) => f.name).join(', ')} — ik neem ${BESTAND_EXT.join(', ')}`, goed: false };
      this.tekenStatus();
    }
    for (const f of goed) await this.uploadBestand(f);
  }

  /**
   * Eén eigen bestand naar de server: /api/upload, daarna dezelfde pijplijn
   * als een link (loudness, golfvorm, grid, video). Met XMLHttpRequest en
   * niet fetch: alleen die meldt hoe ver de upload is.
   *
   * naDeck: na de ingest meteen op die track laden (het bestand werd op een
   * track gesleept). Speelt die track dan, dan NIET eroverheen: dat zou de
   * zaal stilleggen zonder dat je nog iets deed.
   * Geeft de opdracht van de server terug, of null.
   */
  uploadBestand(file, { naDeck = null } = {}) {
    const up = { sleutel: `${file.name}:${file.size}:${Date.now()}`, naam: file.name, pct: 0, fout: null };
    this.uploads.push(up);
    this.tekenJobs();
    return new Promise((klaar) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload?naam=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) { up.pct = (e.loaded / e.total) * 100; this.tekenJobs(); }
      };
      const klaarMet = (opdracht, fout) => {
        this.uploads = this.uploads.filter((u) => u !== up);
        if (fout) this.melding = { tekst: `${file.name}: ${fout}`, goed: false };
        else if (opdracht) {
          this.melding = { tekst: opdracht.bestond ? `${file.name} staat al in de library` : `${file.name} geüpload — wordt verwerkt`, goed: true };
          if (naDeck) this.naLaden.set(opdracht.id, naDeck);
        }
        this.tekenStatus();
        this.pollJobs();
        klaar(opdracht ?? null);
      };
      xhr.onload = () => {
        let j = null;
        try { j = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && j) klaarMet(j, null);
        else klaarMet(null, j?.fout || `upload mislukt (${xhr.status})`);
      };
      // Een verbroken verbinding: de server sluit bij een te groot bestand, of hij draait niet.
      xhr.onerror = () => klaarMet(null, 'upload afgebroken — te groot (grens 8 GB), of de server is weg');
      xhr.send(file);
    });
  }

  /** Klaar met een opdracht die op een track moest? Dan nu laden — als dat mag. */
  _laadNaIngest(o) {
    const deck = this.naLaden.get(o.id);
    if (!deck || o.status === 'bezig') return;
    this.naLaden.delete(o.id);
    if (o.status !== 'klaar' || !o.track) return;
    if (this.stand(deck) === 'speelt') {
      this.melding = { tekst: `${o.track.titel} is binnen, maar track ${this.label(deck)} speelt — laad hem hier in de lijst`, goed: false };
      this.tekenStatus();
      return;
    }
    if (!this._track(o.track.id)) this.cache.extra.set(o.track.id, o.track);
    this.laad(o.track.id, deck);
  }

  async laad(id, deck) {
    const track = this._track(id);
    if (!track || this.bezig.has(id)) return;
    this.bezig.add(id);
    this.tekenRijen();
    try {
      const r = await this.onLaad(deck, track);
      this.melding = { tekst: `${track.titel} staat op track ${this.label(deck)}`
        + (r?.hint ? ` — ${r.hint}` : ''), goed: true };
      fetch(`/api/library/${id}/geladen`, { method: 'POST' }).catch(() => {});
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
      delen.push(`grid ${grid.stukken.length} stuk${grid.stukken.length === 1 ? '' : 'ken'}, ${Math.round((st.aandeel ?? 0) * 100)}% zeker`);
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
   * Een track bewaarde een toonsoort die op het deck bewerkt is: de lijst toont
   * hem ook. Het nummer hoeft niet in beeld te staan: `_track` zoekt in ALLE
   * geladen pagina's (en in wat net binnenkwam). Staat het in geen enkele
   * geladen pagina, dan is er niets bij te werken: die pagina komt later van
   * de server, en die heeft de kaart dan al.
   */
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

  async verwijder(id) {
    const track = this._track(id);
    if (!track) return;
    // Alleen uit de library; de bestanden laat ik staan. Wissen van schijf is
    // onomkeerbaar en hoort een bewuste handeling te zijn, geen klik naast.
    await fetch(`/api/library/${id}`, { method: 'DELETE' }).catch(() => {});
    this.melding = { tekst: `${track.titel} uit de lijst (bestanden staan er nog)`, goed: true };
    this.ververs();
  }

  /**
   * De lijst opnieuw van de server: het stuk dat je ziet, in één keer
   * geruild (geen flits). `bovenaan`: nieuwe zoekterm of sortering, dan
   * begin je bovenaan; anders (nummer weg, ingest klaar) blijf je waar je was.
   */
  async ververs({ bovenaan = false } = {}) {
    // Nieuwe zoekterm of sortering: de kiezer hoort bij een rij die nu ergens anders staat.
    if (bovenaan) { this.el.rijen.scrollTop = 0; this.kiezer = null; }
    const { van, tot } = this._venster(Math.max(this.cache.totaal, 1));
    try {
      if (!(await this.cache.ververs({ zoek: this.zoek, ...this.sortering }, van, tot))) return;
    } catch (err) {
      this.melding = { tekst: `library niet geladen: ${err.message}`, goed: false };
    }
    this.tekenStatus();
    this.tekenRijen();
    this._haalZichtbaar();
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

  async pollJobs() {
    try {
      const r = await fetch('/api/ingest');
      const j = await r.json();
      const vorigeKlaar = this.opdrachten.filter((o) => o.status === 'klaar').length;
      this.opdrachten = j.opdrachten || [];
      const nuKlaar = this.opdrachten.filter((o) => o.status === 'klaar').length;
      if (nuKlaar > vorigeKlaar) await this.ververs();
      for (const o of this.opdrachten) if (this.naLaden.has(o.id)) this._laadNaIngest(o);
      this.tekenJobs();
    } catch {}
  }

  /** Alleen kijken zolang er iets loopt of het paneel open staat. */
  pollen() {
    setInterval(() => {
      const loopt = this.opdrachten.some((o) => o.status === 'bezig') || this.naLaden.size > 0;
      if (loopt || this.open) this.pollJobs();
    }, 1200);
  }

  tekenStatus() {
    const n = this.cache.totaal;
    const m = this.melding
      ? `<b class="${this.melding.goed ? 'goed' : 'bad'}">${esc(this.melding.tekst)}</b> &nbsp;·&nbsp; ` : '';
    this.el.status.innerHTML = m + (this.zoek
      ? `${n} gevonden voor "${esc(this.zoek)}"`
      : `${n} nummer${n === 1 ? '' : 's'} in de library`);
  }

  tekenJobs() {
    const lopend = this.opdrachten.filter((o) => o.status === 'bezig' || Date.now() - (o.klaar || 0) < 20000);
    const ups = this.uploads.map((u) => ({ status: 'bezig', stap: 'upload', tekst: `uploaden — ${u.naam}`, pct: u.pct }));
    this.el.jobs.innerHTML = [...ups, ...lopend].map((o) => {
      const kl = o.status === 'mislukt' ? 'mislukt' : (o.status === 'klaar' ? 'klaar' : 'bezig');
      return `<div class="lib-job ${kl}">
        <span class="lib-job-stap">${esc(o.stap || o.status)}</span>
        <span class="lib-job-tekst">${esc(o.tekst || '')}</span>
        ${o.pct != null ? `<span class="lib-job-balk"><i style="width:${o.pct}%"></i></span>` : ''}
      </div>`;
    }).join('');
    this.el.jobs.classList.toggle('hidden', lopend.length + ups.length === 0);
  }

  /** De kolomkop: sorteerknoppen, en onzichtbare knoppen zodat de kolommen gelijk lopen met de rijen. */
  tekenKop() {
    this.el.kop.innerHTML = kopHtml(this.sortering,
      this.decks.map((d) => `<button class="btn sm lib-trk" tabindex="-1">${esc(this.label(d))}</button>`).join('')
      + '<button class="btn sm" tabindex="-1">↻</button><button class="btn sm" tabindex="-1">×</button>');
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
        ? `<div class="lib-leeg">niets gevonden voor "${esc(this.zoek)}"</div>`
        : `<div class="lib-leeg">nog niets binnengehaald — plak hierboven een YouTube- of TikTok-link, of sleep je eigen audio en video hierheen</div>`;
      return;
    }
    const { van, tot } = this._venster();
    this.el.ruimte.style.height = `${totaal * RIJ_H}px`;
    this.el.venster.style.transform = `translateY(${van * RIJ_H}px)`;
    const nu = Date.now();
    // Per deck één keer vragen, niet per rij.
    const standen = this.decks.map((d) => this.stand(d));
    const staat = { kiezer: this.kiezer };
    const rijen = [];
    let kiezer = '';
    for (let i = van; i < tot; i++) {
      const t = this.cache.rij(i);
      if (!t) { rijen.push('<div class="lib-rij laadt"><span class="lib-titel">…</span></div>'); continue; }
      const laadt = this.bezig.has(t.id);
      const her = this.analyseert.has(t.id);
      rijen.push(`<div class="lib-rij">${cellenHtml(t, nu, staat)}
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
