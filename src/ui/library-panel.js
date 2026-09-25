import { fmtTime } from '../lib/emitter.js';
import { esc } from './dom.js';
import { gridStatus, libraryBpm, STATUS_TEKST } from './grid-strook.js';
import { IngestStrook } from './ingest-strook.js';

/** Het label per bron (server/links.js: bronVan). */
const BRON_LABEL = { youtube: 'YT', tiktok: 'TikTok', bestand: 'bestand', web: 'web' };

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
  constructor({ root, onLaad, onGrid = () => {}, decks = ['A', 'B'], label = (d) => d, stand = () => 'leeg' }) {
    this.root = root;
    this.onLaad = onLaad;
    this.onGrid = onGrid;        // (trackId, grid) na "opnieuw analyseren": op de decks zetten
    this.decks = decks;
    this.label = label;
    this.stand = stand;          // (deck) => 'leeg' | 'geladen' | 'speelt'
    this.zeker = null;           // { soort, sleutel, tot } voor 'nog eens klikken'
    this.tracks = [];
    this.bezig = new Set();     // tracks die nu geladen worden
    this.analyseert = new Set(); // tracks waarvan het grid nu opnieuw geanalyseerd wordt
    this.melding = null;
    this.zoek = '';

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

    // Binnenhalen, wachtrij en voortgang: de strook (ingest-strook.js). Hij
    // luistert zelf naar het invoerveld en "haal binnen".
    this.strook = new IngestStrook({
      el: this.el.jobs, url: this.el.url, haal: this.el.haal,
      decks, label, stand, open: () => this.open,
      meld: (tekst, goed) => { this.melding = { tekst, goed }; this.tekenStatus(); },
      bevestigd: (soort, sleutel) => this._bevestigd(soort, sleutel),
      laad: (track, deck) => this._laadTrack(track, deck),
      laadNaIngest: (track, deck) => this._laadNaIngest(track, deck),
      onNieuw: () => this.ververs(),
    });
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
    this.el.zoek.addEventListener('input', () => { this.zoek = this.el.zoek.value.trim(); this.ververs(); });

    this.el.rijen.addEventListener('click', (e) => {
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
        // Over een grid op SLOT (door jou bevestigd) alleen na een tweede klik.
        const t = this.tracks.find((x) => x.id === her.dataset.her);
        if (t?.grid?.slot && !this._bevestigd('her', t.id)) {
          this.melding = { tekst: `het grid van "${t.titel}" staat op slot — klik nog eens op ↻ om het toch te vervangen`, goed: false };
          return this.tekenStatus();
        }
        return this.heranalyseer(her.dataset.her, !!t?.grid?.slot);
      }
      const weg = e.target.closest('button[data-weg]');
      if (weg) {
        // Weghalen gooit ook het grid en de racks van dit nummer weg.
        if (!this._bevestigd('weg', weg.dataset.weg)) {
          const t = this.tracks.find((x) => x.id === weg.dataset.weg);
          this.melding = { tekst: `"${t?.titel ?? weg.dataset.weg}" weghalen, met grid en racks? Klik nog eens op ×`, goed: false };
          return this.tekenStatus();
        }
        return this.verwijder(weg.dataset.weg);
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

  /** Een nummer uit de strook laden (de strook vroeg al de tweede klik over een spelende track). */
  _laadTrack(track, deck) {
    if (!track) return;
    if (!this.tracks.some((t) => t.id === track.id)) this.tracks.unshift(track);
    return this.laad(track.id, deck);
  }

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
    const track = this.tracks.find((t) => t.id === id);
    if (!track || this.bezig.has(id)) return;
    this.bezig.add(id);
    this.tekenRijen();
    try {
      const r = await this.onLaad(deck, track);
      this.melding = { tekst: `${track.titel} staat op track ${this.label(deck)}`
        + (r?.hint ? ` — ${r.hint}` : ''), goed: true };
      fetch(`/api/library/${id}/geladen`, { method: 'POST' }).catch(() => {});
    } catch (err) {
      this.melding = { tekst: `laden mislukt: ${err.message}`, goed: false };
    }
    this.bezig.delete(id);
    this.tekenStatus();
    this.tekenRijen();
  }

  /** Het grid opnieuw laten voorstellen door de server (in een worker, een paar seconden). */
  async heranalyseer(id, forceer = false) {
    const track = this.tracks.find((t) => t.id === id);
    if (!track || this.analyseert.has(id)) return;
    this.analyseert.add(id);
    this.melding = { tekst: `grid van "${track.titel}" wordt opnieuw geanalyseerd…`, goed: true };
    this.tekenStatus();
    this.tekenRijen();
    try {
      const r = await fetch(`/api/library/${id}/grid/analyseer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forceer }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.fout || `${r.status}`);
      if (j.bewaard) {
        track.grid = j.grid;
        this.onGrid(id, j.grid);
        const st = gridStatus(j.grid, track.duur);
        this.melding = { tekst: `${track.titel}: ${j.grid.stukken.length} stuk${j.grid.stukken.length === 1 ? '' : 'ken'}, `
          + `${Math.round((st.aandeel ?? 0) * 100)}% zeker`, goed: true };
      } else {
        this.melding = { tekst: `${track.titel}: niet vervangen (${j.reden})`, goed: false };
      }
    } catch (err) {
      this.melding = { tekst: `analyseren mislukt: ${err.message}`, goed: false };
    }
    this.analyseert.delete(id);
    this.tekenStatus();
    this.tekenRijen();
  }

  async verwijder(id) {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    // Alleen uit de library; de bestanden laat ik staan. Wissen van schijf is
    // onomkeerbaar en hoort een bewuste handeling te zijn, geen klik naast.
    await fetch(`/api/library/${id}`, { method: 'DELETE' }).catch(() => {});
    this.melding = { tekst: `${track.titel} uit de lijst (bestanden staan er nog)`, goed: true };
    this.ververs();
  }

  async ververs() {
    try {
      const r = await fetch('/api/library' + (this.zoek ? `?zoek=${encodeURIComponent(this.zoek)}` : ''));
      const j = await r.json();
      this.tracks = j.tracks || [];
    } catch { this.tracks = []; }
    this.tekenStatus();
    this.tekenRijen();
  }

  tekenStatus() {
    const n = this.tracks.length;
    const m = this.melding
      ? `<b class="${this.melding.goed ? 'goed' : 'bad'}">${esc(this.melding.tekst)}</b> &nbsp;·&nbsp; ` : '';
    this.el.status.innerHTML = m + `${n} nummer${n === 1 ? '' : 's'} in de library`;
  }

  tekenRijen() {
    if (!this.tracks.length) {
      this.el.rijen.innerHTML = `<div class="lib-leeg">nog niets binnengehaald — plak hierboven een YouTube- of TikTok-link, of sleep je eigen audio en video hierheen</div>`;
      return;
    }
    this.el.rijen.innerHTML = this.tracks.map((t) => {
      const lufs = t.loudness_i != null ? `${t.loudness_i.toFixed(1)} → ${t.doel_loudness} LUFS` : '—';
      const laadt = this.bezig.has(t.id);
      const gs = gridStatus(t.grid, t.duur);
      const n = t.grid?.stukken?.length ?? 0;
      const gridTitel = gs.status === 'geen' ? 'nog geen grid — wordt op de achtergrond geanalyseerd, of tik het tempo'
        : `${n} stuk${n === 1 ? '' : 'ken'}${gs.aandeel !== null && gs.status !== 'slot' && gs.status !== 'hand' ? `, ${Math.round(gs.aandeel * 100)}% van de tijd zeker` : ''}`;
      const her = this.analyseert.has(t.id);
      return `<div class="lib-rij">
        <span class="lib-titel" title="${esc(t.url)}"><i class="lib-bron ${esc(t.bron || 'web')}">${esc(BRON_LABEL[t.bron] || 'web')}</i>${esc(t.titel)}</span>
        <span class="lib-uploader">${esc(t.uploader || '')}</span>
        <span class="lib-duur">${fmtTime(t.duur || 0).replace(/\.\d+$/, '')}</span>
        <span class="lib-bpm" title="tempo van het grid bij het begin">${esc(libraryBpm(t.grid))}</span>
        <span class="lib-grid ${gs.status}" title="${esc(gridTitel)}">${esc(STATUS_TEKST[gs.status])}</span>
        <span class="lib-lufs">${esc(lufs)}</span>
        <span class="lib-racks">${t.racks ? `${t.racks} rack${t.racks === 1 ? '' : 's'}` : '—'}</span>
        <span class="lib-knoppen">
          ${this.decks.map((d) => `<button class="btn sm lib-trk ${this.stand(d)}" data-deck="${d}" data-id="${esc(t.id)}" title="laad op track ${this.label(d)} (${this.stand(d)})"${laadt ? ' disabled' : ''}>${laadt ? '…' : this.label(d)}</button>`).join('')}
          <button class="btn sm lib-her${her ? ' bezig' : ''}" data-her="${esc(t.id)}" title="grid opnieuw analyseren${t.grid?.slot ? ' (staat op slot: tweede klik)' : ''}">${her ? '…' : '↻'}</button>
          <button class="btn sm lib-weg" data-weg="${esc(t.id)}" title="uit de lijst halen">×</button>
        </span>
      </div>`;
    }).join('');
  }
}
