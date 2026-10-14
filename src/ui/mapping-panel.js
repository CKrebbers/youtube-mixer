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
    // Per apparaat een eigen mapping (werkruimte S5): zolang er maar één is (de APC),
    // is er geen kiezer en is alles zoals vroeger.
    this.apparaten = new Map();     // naam -> { titel, mapping, learn, device, onReset }
    this.apparaat = null;           // de naam van wat er nu getoond wordt (null = alleen de APC)
    this.onApparaat = null;         // (naam) -> void: de gebruiker koos hier een ander apparaat

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

    this._luister(mapping, learn);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.learn.busy) { this.learn.stop(); this.vuil = true; }
    });
  }

  /**
   * Luisteren naar een mapping en zijn leren. Alleen wat bij het GETOONDE apparaat
   * hoort telt (na een wissel blijven de oude luisteraars hangen, maar zwijgen).
   */
  _luister(mapping, learn) {
    const hier = () => this.mapping === mapping && this.learn === learn;
    mapping.on('change', () => { if (hier()) this.vuil = true; });
    learn.on('armed', () => { if (hier()) this.vuil = true; });
    learn.on('done', () => { if (hier()) this.vuil = true; });
    learn.on('bound', (b) => {
      if (!hier()) return;
      this.melding = b.overschrijft
        ? `${b.sig} gekoppeld aan ${b.action} — stond eerst op ${b.overschrijft}`
        : `${b.sig} gekoppeld aan ${b.action} (${MODUSNAAM[b.mode] || b.mode})`;
      this.vuil = true;
    });
    learn.on('forgotten', (f) => {
      if (!hier()) return;
      this.melding = f.sigs.length ? `${f.action} losgekoppeld` : `${f.action} had geen koppeling`;
      this.vuil = true;
    });
    learn.on('niet', (n) => {
      if (!hier()) return;
      this.melding = `${this.device?.label?.(n.sig) || n.sig}: ${n.reden}`;
      this.vuil = true;
    });
  }

  /**
   * Een apparaat erbij in de kiezer (APC · Maschine · Xboard · toetsen). Het eerste
   * dat erbij komt, maakt van wat het paneel al toonde (de APC) een keuze `eersteNaam`.
   * Elk apparaat heeft zijn eigen mapping, leren en "standaard herstellen": wat je
   * hier op de Maschine koppelt of herstelt, raakt de APC niet.
   */
  voegApparaatToe(naam, { titel, mapping, learn, device = null, onReset = null }, { eersteNaam = 'apc40mk2', eersteTitel = 'APC' } = {}) {
    if (!this.apparaten.size) {
      this.apparaten.set(eersteNaam, { titel: eersteTitel, mapping: this.mapping, learn: this.learn, device: this.device, onReset: this.onReset });
      this.apparaat = eersteNaam;
    }
    if (this.apparaten.has(naam)) return;
    this.apparaten.set(naam, { titel: titel || naam, mapping, learn, device, onReset });
    this._luister(mapping, learn);
    this._kiezer();
  }

  /** Dit apparaat tonen (en daar leren). Een lopende leerbeurt op het vorige stopt. */
  kiesApparaat(naam) {
    const a = this.apparaten.get(naam);
    if (!a || naam === this.apparaat) return !!a;
    this.learn.stop();
    Object.assign(this, { mapping: a.mapping, learn: a.learn, device: a.device, onReset: a.onReset, apparaat: naam });
    this.melding = null;
    this._zekerReset = 0;
    if (this.el.reset) this.el.reset.textContent = 'standaard herstellen';
    this._kiezer();
    this.vuil = true;
    return true;
  }

  /** De kiezer bovenin het paneel: één knop per apparaat, de getoonde staat aan. */
  _kiezer() {
    if (this.apparaten.size < 2) return;
    let rij = this.root.querySelector('.map-apparaten');
    if (!rij) {
      rij = document.createElement('div');
      rij.className = 'map-apparaten';
      // styles.css is van niemand in de werkruimte (WERKRUIMTE.md D2): de paar regels hier.
      rij.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;color:var(--dim);border-bottom:1px solid var(--line)';
      rij.title = 'welk apparaat je koppelt: elk heeft zijn eigen mapping (standaard + wat jij koppelde)';
      rij.addEventListener('click', (e) => {
        const knop = e.target.closest('button[data-apparaat]');
        if (!knop || !this.kiesApparaat(knop.dataset.apparaat)) return;
        this.onApparaat?.(knop.dataset.apparaat);
      });
      this.root.prepend(rij);
    }
    rij.innerHTML = `koppelen op: ${[...this.apparaten].map(([naam, a]) =>
      `<button class="btn sm${naam === this.apparaat ? ' on' : ''}" data-apparaat="${esc(naam)}">${esc(a.titel)}</button>`).join(' ')}`;
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
    const titel = this.apparaat ? `${esc(this.apparaten.get(this.apparaat)?.titel ?? this.apparaat)}: ` : '';
    return (this.melding ? `<b class="good">${esc(this.melding)}</b> &nbsp;·&nbsp; ` : '')
      + `${titel}${esc(this.mapping.name)} · ${n} koppeling${n === 1 ? '' : 'en'}`
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
      const tekst = await bestand.text();
      // Een bestand voor een ander apparaat hoort niet in de Maschine, de Xboard of de toetsen
      // (de APC laat alles toe, zoals altijd: daar komt ook een generieke controller in).
      const voor = this.apparaat && this.apparaat !== 'apc40mk2' ? (JSON.parse(tekst)?.device || 'generic') : null;
      if (voor !== null && voor !== this.apparaat) {
        this.melding = `${bestand.name} is een mapping voor "${voor}", niet voor ${this.apparaten.get(this.apparaat)?.titel ?? this.apparaat}: niet geladen`;
        this.el.importeer.value = '';
        this.vuil = true;
        return;
      }
      const { aantal, fouten, gemigreerd } = this.mapping.load(tekst);
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
