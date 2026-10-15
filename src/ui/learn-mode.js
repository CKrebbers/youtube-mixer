/**
 * Koppelen door aan te wijzen: klik een knop op het scherm, beweeg de knop op
 * je controller, klaar.
 *
 * Dit werkt omdat elk bedienbaar element in de UI al een `data-action` heeft —
 * dezelfde action-id waar de mapping naartoe wijst. De koppelmodus onderschept
 * alleen de klik voordat het element hem zelf afhandelt, en geeft de action
 * door aan MIDI-learn. Er is dus geen aparte lijst van "koppelbare dingen" die
 * uit de pas kan lopen met de UI.
 */

/** Het MIDI-paneel bedient zichzelf; daar willen we niet koppelen. */
const BUITEN = '#midi-panel';

/**
 * Het aanwijs-signaal voor ✎ inrichten (werkruimte S8, src/ui/aanhakers/inrichten.js): zolang er een
 * aanwijzer is, wordt de volgende klik op een element met `data-action` NIET uitgevoerd maar
 * doorgegeven: fn({ action, el }). Eén klik, daarna is de aanwijzer weg. Wat buiten telt (het
 * MIDI-paneel, het inrichtpaneel zelf: `.ir-paneel`) gaat gewoon door. Zonder aanwijzer: niets.
 */
let aanwijzer = null;
let aanwijsLuisteraar = null;
let geslikt = -Infinity;
export function zetAanwijzer(fn) {
  aanwijzer = typeof fn === 'function' ? fn : null;
  if (aanwijzer && !aanwijsLuisteraar && typeof document !== 'undefined') {
    aanwijsLuisteraar = (e) => {
      if (!aanwijzer) return;
      const el = e.target?.closest?.('[data-action]');
      if (!el || el.closest(`${BUITEN}, .ir-paneel`)) return;
      e.preventDefault();
      e.stopPropagation();
      const fn2 = aanwijzer;
      aanwijzer = null;
      geslikt = performance.now();
      try { fn2({ action: el.dataset.action, el }); } catch (err) { console.warn('[aanwijzen]', err); }
    };
    document.addEventListener('pointerdown', aanwijsLuisteraar, true);
    // De klik die bij die pointerdown hoort ook tegenhouden (een knop zou anders alsnog afgaan).
    document.addEventListener('click', (e) => { if (performance.now() - geslikt < 600 && e.target?.closest?.('[data-action]')) { e.stopPropagation(); geslikt = -Infinity; } }, true);
  }
}
/** Staat er een aanwijzer klaar? */
export const aanwijzerKlaar = () => !!aanwijzer;

export class LearnMode {
  constructor({ learn, mapping, device, meta, balk, knop }) {
    this.learn = learn;
    this.mapping = mapping;
    this.device = device;
    this.meta = meta;
    this.balk = balk;
    this.knop = knop;
    this.actief = false;
    this.melding = null;
    // Per apparaat (werkruimte S5): koppelen in de mapping van het gekozen apparaat.
    // Zolang alleen de APC er is: geen keuze, alles zoals vroeger.
    this.apparaten = new Map();     // naam -> { titel, mapping, learn, device }
    this.apparaat = null;
    this.onApparaat = null;         // (naam) -> void: de gebruiker koos in de balk een ander apparaat

    // Capture: we willen de klik hebben vóór de knop zelf hem afhandelt,
    // anders verzet je de waarde die je aan het koppelen bent.
    document.addEventListener('pointerdown', (e) => this._klik(e), true);
    document.addEventListener('click', (e) => { if (this.actief && this._doel(e)) e.stopPropagation(); }, true);

    window.addEventListener('keydown', (e) => {
      if (!this.actief) return;
      if (e.code === 'Escape') { this.learn.busy ? this.learn.stop() : this.uit(); e.preventDefault(); }
    });

    this._luister(mapping, learn);
    // De kiezer in de balk (alleen met meer dan één apparaat).
    balk?.addEventListener?.('click', (e) => {
      const knop = e.target.closest?.('button[data-apparaat]');
      if (!knop || !this.kiesApparaat(knop.dataset.apparaat)) return;
      this.onApparaat?.(knop.dataset.apparaat);
    });
  }

  /** Luisteren naar een mapping en zijn leren; alleen het gekozen apparaat telt. */
  _luister(mapping, learn) {
    const hier = () => this.mapping === mapping && this.learn === learn;
    learn.on('bound', (b) => {
      if (!hier()) return;
      const naam = this.device?.label?.(b.sig.replace(':*:', ':0:')) || b.sig;
      const ook = this.mapping.forAction(b.action).length - 1;
      this.melding = { tekst: `${this._label(b.action)} ← ${naam}`, goed: true };
      if (b.overschrijft) this.melding.tekst += ` — nam dit af van ${this._label(b.overschrijft)}`;
      else if (ook > 0) this.melding.tekst += ` — staat nu op ${ook + 1} knoppen`;
      this.ververs();
    });
    learn.on('niet', (n) => {
      if (!hier()) return;
      this.melding = { tekst: `${this.device?.label?.(n.sig) || n.sig}: ${n.reden}`, goed: false };
      this.ververs();
    });
    learn.on('done', () => { if (hier()) this.ververs(); });
    learn.on('armed', () => { if (hier()) { this.melding = null; this.ververs(); } });
    mapping.on('change', () => { if (hier()) this.ververs(); });
  }

  /** Een apparaat erbij (zie MappingPanel.voegApparaatToe): het eerste maakt van de APC een keuze. */
  voegApparaatToe(naam, { titel, mapping, learn, device = null }, { eersteNaam = 'apc40mk2', eersteTitel = 'APC' } = {}) {
    if (!this.apparaten.size) {
      this.apparaten.set(eersteNaam, { titel: eersteTitel, mapping: this.mapping, learn: this.learn, device: this.device });
      this.apparaat = eersteNaam;
    }
    if (this.apparaten.has(naam)) return;
    this.apparaten.set(naam, { titel: titel || naam, mapping, learn, device });
    this._luister(mapping, learn);
    this.ververs();
  }

  /** Koppelen op dit apparaat. Een lopende leerbeurt op het vorige stopt. */
  kiesApparaat(naam) {
    const a = this.apparaten.get(naam);
    if (!a || naam === this.apparaat) return !!a;
    this.learn.stop();
    Object.assign(this, { mapping: a.mapping, learn: a.learn, device: a.device, apparaat: naam });
    this.melding = null;
    this.ververs();
    return true;
  }

  /** Wat er in de balk moet om te zeggen (en te kiezen) op welk apparaat je koppelt. */
  _kiezerHtml() {
    if (this.apparaten.size < 2) return '';
    return ` <span class="leer-apparaten">${[...this.apparaten].map(([naam, a]) =>
      `<button class="btn sm${naam === this.apparaat ? ' on' : ''}" data-apparaat="${naam}">${a.titel}</button>`).join(' ')}</span>`;
  }

  /** Wat je nu moet aanraken, op welk apparaat. */
  _beweeg() {
    if (this.apparaat === 'maschine-mk2') return 'houd CONTROL vast op de Maschine en raak de knop of draaiknop aan';
    if (this.apparaat === 'toetsen') return 'druk de toets (shift erbij = een shift-regel)';
    if (this.apparaat === 'xboard49') return 'beweeg een knop of de schuif van je MIDI-keyboard';
    return 'beweeg nu de knop op je controller';
  }

  toggle() { this.actief ? this.uit() : this.aan(); }

  aan() {
    this.actief = true;
    this.melding = null;
    document.body.classList.add('leermodus');
    this.knop?.classList.add('primary');
    this.balk.classList.remove('hidden');
    this.ververs();
  }

  uit() {
    this.actief = false;
    this.learn.stop();
    document.body.classList.remove('leermodus');
    this.knop?.classList.remove('primary');
    this.balk.classList.add('hidden');
    for (const el of this._elementen()) {
      el.classList.remove('gekoppeld', 'leert');
      el.removeAttribute('data-bind');
    }
  }

  _elementen() {
    return [...document.querySelectorAll('[data-action]')].filter((el) => !el.closest(BUITEN));
  }

  /** De naam die de action-bus zelf geeft — die weet ook welk deck het is. */
  _label(action) {
    return this.meta?.(action)?.label || action;
  }

  _doel(e) {
    const el = e.target.closest('[data-action]');
    return el && !el.closest(BUITEN) ? el : null;
  }

  _klik(e) {
    if (!this.actief) return;
    const el = this._doel(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();

    const action = el.dataset.action;
    if (e.shiftKey) {                       // shift-klik maakt los
      const weg = this.learn.vergeet(action);
      this.melding = { tekst: weg.length ? `${this._label(action)} losgekoppeld` : 'die had nog geen koppeling', goed: false };
    } else if (this.learn.busy && this.learn.action === action) {
      this.learn.stop();                    // nog een keer klikken = annuleren
    } else {
      this.learn.start(action);
    }
    this.ververs();
  }

  /** Badges en randen bijwerken. Alleen zichtbaar in koppelmodus. */
  ververs() {
    if (!this.actief) return;
    for (const el of this._elementen()) {
      const sigs = this.mapping.forAction(el.dataset.action);
      const namen = sigs.map((s) => this.device?.label?.(s.replace(':*:', ':0:')) || s);
      el.classList.toggle('gekoppeld', sigs.length > 0);
      el.classList.toggle('leert', this.learn.busy && this.learn.action === el.dataset.action);
      el.setAttribute('data-bind', namen.length ? namen[0] + (namen.length > 1 ? ` +${namen.length - 1}` : '') : '—');
      el.title = namen.length ? `gekoppeld aan ${sigs.join(', ')} — shift-klik maakt los` : 'nog niet gekoppeld';
    }
    this.balk.innerHTML = this._balktekst();
  }

  _balktekst() {
    // Een draaiknop is pas na een paar berichten te herkennen als encoder, dus
    // blijft learn even luisteren. Dat mag de bevestiging niet wegdrukken.
    const kies = this._kiezerHtml();
    if (this.learn.busy && this.melding) {
      return `<b class="${this.melding.goed ? 'goed' : 'weg'}">${this.melding.tekst}</b> <i>${this.melding.goed ? 'blijf even draaien, dan herkent hij het type' : this._beweeg()}</i>${kies}`;
    }
    if (this.learn.busy) {
      return `<b class="wacht">${this._label(this.learn.action)}</b> — ${this._beweeg()}
              <i>Esc annuleert</i>${kies}`;
    }
    if (this.melding) {
      return `<b class="${this.melding.goed ? 'goed' : 'weg'}">${this.melding.tekst}</b>
              <i>klik het volgende aan, of Esc om te stoppen</i>${kies}`;
    }
    return `<b>Koppelmodus</b> — klik iets op het scherm en beweeg dan de knop op je controller
            <i>shift-klik maakt los · Esc stopt</i>${kies}`;
  }
}
