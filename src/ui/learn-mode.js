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

    // Capture: we willen de klik hebben vóór de knop zelf hem afhandelt,
    // anders verzet je de waarde die je aan het koppelen bent.
    document.addEventListener('pointerdown', (e) => this._klik(e), true);
    document.addEventListener('click', (e) => { if (this.actief && this._doel(e)) e.stopPropagation(); }, true);

    window.addEventListener('keydown', (e) => {
      if (!this.actief) return;
      if (e.code === 'Escape') { this.learn.busy ? this.learn.stop() : this.uit(); e.preventDefault(); }
    });

    learn.on('bound', (b) => {
      const naam = this.device?.label?.(b.sig.replace(':*:', ':0:')) || b.sig;
      const ook = this.mapping.forAction(b.action).length - 1;
      this.melding = { tekst: `${this._label(b.action)} ← ${naam}`, goed: true };
      if (b.overschrijft) this.melding.tekst += ` — nam dit af van ${this._label(b.overschrijft)}`;
      else if (ook > 0) this.melding.tekst += ` — staat nu op ${ook + 1} knoppen`;
      this.ververs();
    });
    learn.on('done', () => this.ververs());
    learn.on('armed', () => { this.melding = null; this.ververs(); });
    mapping.on('change', () => this.ververs());
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
    if (this.learn.busy && this.melding) {
      return `<b class="goed">${this.melding.tekst}</b> <i>blijf even draaien, dan herkent hij het type</i>`;
    }
    if (this.learn.busy) {
      return `<b class="wacht">${this._label(this.learn.action)}</b> — beweeg nu de knop op je controller
              <i>Esc annuleert</i>`;
    }
    if (this.melding) {
      return `<b class="${this.melding.goed ? 'goed' : 'weg'}">${this.melding.tekst}</b>
              <i>klik het volgende aan, of Esc om te stoppen</i>`;
    }
    return `<b>Koppelmodus</b> — klik iets op het scherm en beweeg dan de knop op je controller
            <i>shift-klik maakt los · Esc stopt</i>`;
  }
}
