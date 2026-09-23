import { fmtTime } from '../lib/emitter.js';
import { esc } from './dom.js';
import { gridStatus, libraryBpm, STATUS_TEKST } from './grid-strook.js';

/**
 * Het library-paneel: URL erin, track eruit, één klik op een deck.
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
    this.opdrachten = [];
    this.bezig = new Set();     // tracks die nu geladen worden
    this.analyseert = new Set(); // tracks waarvan het grid nu opnieuw geanalyseerd wordt
    this.melding = null;
    this.zoek = '';

    this.el = {
      url: root.querySelector('.lib-url'),
      haal: root.querySelector('.lib-haal'),
      zoek: root.querySelector('.lib-zoek'),
      status: root.querySelector('.lib-status'),
      jobs: root.querySelector('.lib-jobs'),
      rijen: root.querySelector('.lib-rijen'),
    };

    this.el.haal.addEventListener('click', () => this.haalBinnen());
    this.el.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.haalBinnen(); });
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

  async pollJobs() {
    try {
      const r = await fetch('/api/ingest');
      const j = await r.json();
      const vorigeKlaar = this.opdrachten.filter((o) => o.status === 'klaar').length;
      this.opdrachten = j.opdrachten || [];
      const nuKlaar = this.opdrachten.filter((o) => o.status === 'klaar').length;
      if (nuKlaar > vorigeKlaar) this.ververs();
      this.tekenJobs();
    } catch {}
  }

  /** Alleen kijken zolang er iets loopt of het paneel open staat. */
  pollen() {
    setInterval(() => {
      const loopt = this.opdrachten.some((o) => o.status === 'bezig');
      if (loopt || this.open) this.pollJobs();
    }, 1200);
  }

  tekenStatus() {
    const n = this.tracks.length;
    const m = this.melding
      ? `<b class="${this.melding.goed ? 'goed' : 'bad'}">${esc(this.melding.tekst)}</b> &nbsp;·&nbsp; ` : '';
    this.el.status.innerHTML = m + `${n} nummer${n === 1 ? '' : 's'} in de library`;
  }

  tekenJobs() {
    const lopend = this.opdrachten.filter((o) => o.status === 'bezig' || Date.now() - (o.klaar || 0) < 20000);
    this.el.jobs.innerHTML = lopend.map((o) => {
      const kl = o.status === 'mislukt' ? 'mislukt' : (o.status === 'klaar' ? 'klaar' : 'bezig');
      return `<div class="lib-job ${kl}">
        <span class="lib-job-stap">${esc(o.stap || o.status)}</span>
        <span class="lib-job-tekst">${esc(o.tekst || '')}</span>
        ${o.pct != null ? `<span class="lib-job-balk"><i style="width:${o.pct}%"></i></span>` : ''}
      </div>`;
    }).join('');
    this.el.jobs.classList.toggle('hidden', lopend.length === 0);
  }

  tekenRijen() {
    if (!this.tracks.length) {
      this.el.rijen.innerHTML = `<div class="lib-leeg">nog niets binnengehaald — plak hierboven een YouTube-URL</div>`;
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
        <span class="lib-titel" title="${esc(t.url)}">${esc(t.titel)}</span>
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
