import { fmtTime } from '../lib/emitter.js';

/**
 * Het library-paneel: URL erin, track eruit, één klik op een deck.
 *
 * Praat alleen met de server via fetch. Het laden op een deck is een callback,
 * want de UI hoort de engine niet zelf aan te sturen — dat loopt via app.js,
 * die ook de golfvorm-analyse bijhoudt.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class LibraryPanel {
  constructor({ root, onLaad, decks = ['A', 'B'] }) {
    this.root = root;
    this.onLaad = onLaad;
    this.decks = decks;
    this.tracks = [];
    this.opdrachten = [];
    this.bezig = new Set();     // tracks die nu geladen worden
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
      if (knop) return this.laad(knop.dataset.id, knop.dataset.deck);
      const weg = e.target.closest('button[data-weg]');
      if (weg) return this.verwijder(weg.dataset.weg);
    });

    this.ververs();
    this.pollen();
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
      this.melding = { tekst: `${track.titel} staat op deck ${deck}`
        + (r?.hint ? ` — ${r.hint}` : ''), goed: true };
      fetch(`/api/library/${id}/geladen`, { method: 'POST' }).catch(() => {});
    } catch (err) {
      this.melding = { tekst: `laden mislukt: ${err.message}`, goed: false };
    }
    this.bezig.delete(id);
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
      return `<div class="lib-rij">
        <span class="lib-titel" title="${esc(t.url)}">${esc(t.titel)}</span>
        <span class="lib-uploader">${esc(t.uploader || '')}</span>
        <span class="lib-duur">${fmtTime(t.duur || 0).replace(/\.\d+$/, '')}</span>
        <span class="lib-lufs">${esc(lufs)}</span>
        <span class="lib-racks">${t.racks ? `${t.racks} rack${t.racks === 1 ? '' : 's'}` : '—'}</span>
        <span class="lib-knoppen">
          ${this.decks.map((d) => `<button class="btn sm" data-deck="${d}" data-id="${esc(t.id)}"${laadt ? ' disabled' : ''}>${laadt ? '…' : d}</button>`).join('')}
          <button class="btn sm lib-weg" data-weg="${esc(t.id)}" title="uit de lijst halen">×</button>
        </span>
      </div>`;
    }).join('');
  }
}
