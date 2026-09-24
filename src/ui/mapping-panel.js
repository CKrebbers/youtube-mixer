import { list } from '../control/actions.js';
import { esc } from './dom.js';

/**
 * Het koppelpaneel: elke action met zijn huidige knop, een leerknop ernaast,
 * en import/export van de mapping als bestand.
 *
 * De lijst komt uit de action-bus zelf, niet uit een tweede tabel. Alles wat in
 * `actions.js` gedefinieerd is, is hier koppelbaar — ook wat er later bij komt.
 */


const MODUSNAAM = {
  trigger: 'knop', absolute: 'absoluut',
  'relative-2c': 'relatief 2c', 'relative-bin': 'relatief bin', endless: 'eindeloos',
};

export class MappingPanel {
  constructor({ root, mapping, learn, device, onReset }) {
    this.root = root;
    this.mapping = mapping;
    this.learn = learn;
    this.device = device;
    this.onReset = onReset;
    this.filter = '';
    this.vuil = true;

    this.el = {
      rows: root.querySelector('.map-rows'),
      filter: root.querySelector('.map-filter'),
      status: root.querySelector('.map-status'),
      exporteer: root.querySelector('.map-export'),
      importeer: root.querySelector('.map-import input'),
      reset: root.querySelector('.map-reset'),
    };

    this.el.filter.addEventListener('input', () => {
      this.filter = this.el.filter.value.trim().toLowerCase();
      this.vuil = true;
    });

    this.el.rows.addEventListener('click', (e) => {
      const knop = e.target.closest('button[data-doe]');
      if (!knop) return;
      const action = knop.dataset.action;
      if (knop.dataset.doe === 'leer') {
        if (this.learn.busy && this.learn.action === action) this.learn.stop();
        else this.learn.start(action);
      } else {
        this.learn.vergeet(action);
      }
      this.vuil = true;
    });

    this.el.exporteer.addEventListener('click', () => this.exporteer());
    this.el.importeer.addEventListener('change', (e) => this.importeer(e.target.files[0]));
    // Standaard herstellen gooit je eigen koppelingen weg: tweede klik binnen 3 s.
    this.el.reset.addEventListener('click', () => {
      if (this._zekerReset && Date.now() < this._zekerReset) { this._zekerReset = 0; this.el.reset.textContent = 'standaard herstellen'; this.onReset?.(); return; }
      this._zekerReset = Date.now() + 3000;
      this.el.reset.textContent = 'nog eens = je eigen koppelingen weg';
      setTimeout(() => { this.el.reset.textContent = 'standaard herstellen'; }, 3000);
    });

    mapping.on('change', () => { this.vuil = true; });
    learn.on('armed', () => { this.vuil = true; });
    learn.on('done', () => { this.vuil = true; });
    learn.on('bound', (b) => {
      this.melding = b.overschrijft
        ? `${b.sig} gekoppeld aan ${b.action} — stond eerst op ${b.overschrijft}`
        : `${b.sig} gekoppeld aan ${b.action} (${MODUSNAAM[b.mode] || b.mode})`;
      this.vuil = true;
    });
    learn.on('forgotten', (f) => {
      this.melding = f.sigs.length ? `${f.action} losgekoppeld` : `${f.action} had geen koppeling`;
      this.vuil = true;
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.learn.busy) { this.learn.stop(); this.vuil = true; }
    });
  }

  /** Alleen tekenen als er iets veranderd is en het paneel open staat. */
  tick() {
    if (!this.vuil || this.root.classList.contains('hidden')) return;
    this.render();
    this.vuil = false;
  }

  statusregel() {
    if (this.learn.busy) {
      return `<b class="bad">beweeg nu de knop die je aan <u>${esc(this.learn.action)}</u> wilt koppelen</b> — Esc om te stoppen`;
    }
    const n = this.mapping.rules.size;
    // Hoeveel daarvan van JOU zijn: alleen dat wordt bewaard (als verschil met
    // de standaard), de rest volgt de standaard, ook als die verandert.
    const v = this.mapping.verschil?.();
    const eigen = v ? v.rules.length + v.removed.length + Object.keys(v.top).length : null;
    return (this.melding ? `<b class="good">${esc(this.melding)}</b> &nbsp;·&nbsp; ` : '')
      + `${esc(this.mapping.name)} · ${n} koppeling${n === 1 ? '' : 'en'}`
      + (eigen === null ? '' : eigen ? ` · ${eigen} eigen (de rest volgt de standaard)` : ' · precies de standaard');
  }

  render() {
    this.el.status.innerHTML = this.statusregel();

    const rijen = list().filter((a) => {
      if (!this.filter) return true;
      const sigs = this.mapping.forAction(a.id).join(' ');
      return (a.id + ' ' + (a.meta.label || '') + ' ' + sigs).toLowerCase().includes(this.filter);
    });

    this.el.rows.innerHTML = rijen.map((a) => {
      const sigs = this.mapping.forAction(a.id);
      const leert = this.learn.busy && this.learn.action === a.id;
      const koppeling = sigs.length
        ? sigs.map((s) => {
          const regel = this.mapping.rules.get(s);
          const naam = this.device?.label?.(s.replace(':*:', ':0:'));
          return `<span class="map-bind" title="${esc(s)}">${esc(naam || s)}
            <i>${esc(MODUSNAAM[regel?.mode] || regel?.mode || '')}</i></span>`;
        }).join('')
        : '<span class="map-leeg">—</span>';

      return `<div class="map-row${leert ? ' leert' : ''}">
        <span class="map-id">${esc(a.id)}</span>
        <span class="map-label">${esc(a.meta.label || '')}${a.meta.todo ? ' <i>(' + esc(a.meta.todo) + ')</i>' : ''}</span>
        <span class="map-binds">${koppeling}</span>
        <span class="map-knoppen">
          <button class="btn sm${leert ? ' on' : ''}" data-doe="leer" data-action="${esc(a.id)}">${leert ? 'wacht…' : 'leer'}</button>
          <button class="btn sm" data-doe="wis" data-action="${esc(a.id)}"${sigs.length ? '' : ' disabled'}>wis</button>
        </span>
      </div>`;
    }).join('') || '<div class="map-row"><span class="map-leeg">niets gevonden</span></div>';
  }

  exporteer() {
    const tekst = this.mapping.export();
    const naam = (this.mapping.name || 'mapping').replace(/[^\w.-]+/g, '-').toLowerCase() + '.json';
    const url = URL.createObjectURL(new Blob([tekst], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = naam;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.melding = `geëxporteerd als ${naam}`;
    this.vuil = true;
  }

  async importeer(bestand) {
    if (!bestand) return;
    try {
      const { aantal, fouten, gemigreerd } = this.mapping.load(await bestand.text());
      this.melding = `${bestand.name}: ${aantal} regels geladen`
        + (gemigreerd ? ` — ${gemigreerd} omgezet van deck naar track` : '')
        + (fouten.length ? ` — ${fouten.length} genegeerd` : '');
      fouten.forEach((f) => console.warn('[mapping]', f));
    } catch (err) {
      this.melding = `${bestand.name} kon niet gelezen worden: ${err.message}`;
    }
    this.el.importeer.value = '';
    this.vuil = true;
  }
}
