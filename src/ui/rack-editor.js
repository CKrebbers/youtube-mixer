import { CURVES } from '../engine/rack.js';

/**
 * De rack-editor: racks maken met de muis in plaats van JSON te schrijven.
 *
 * Werkt op een KOPIE van het rack van het deck, en elke wijziging gaat meteen
 * naar het deck zodat je hoort wat je doet. Twee soorten wijzigingen, met een
 * bewust verschil in hoe ze landen:
 *
 *   keten (effect erbij, weg, omhoog, aan/uit)
 *       bouwt de keten opnieuw, met kruisfade, en houdt je knopstanden vast
 *   macro's (bereik, venster, curve, label)
 *       past alleen getallen aan; er wordt geen node aangeraakt
 *
 * En bij het schuiven aan een bereik wordt het scherm NIET opnieuw getekend:
 * dan zou je je greep op de schuif halverwege het slepen kwijtraken.
 *
 * Deze module praat niet met de server. Bewaren is een callback, zodat app.js
 * bijhoudt welk rack bij welk nummer hoort.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const getal = (v) => (typeof v === 'number' ? v : 0).toFixed(2);
const PLEKKEN = [1, 2, 3, 4, 5, 6, 7, 8];
const CURVENAAM = { lin: 'lineair', exp: 'traag → snel', log: 'snel → traag', s: 'zacht' };

export class RackEditor {
  constructor({ root, engine, effecten, onBewaar, naamVan = (id) => `deck ${id}` }) {
    this.root = root;
    this.engine = engine;
    this.effecten = effecten;
    this.onBewaar = onBewaar;
    this.naamVan = naamVan;
    this.deckId = null;
    this.kopie = null;
    this.melding = null;

    this.el = {
      deck: root.querySelector('.re-deck'),
      naam: root.querySelector('.re-naam'),
      status: root.querySelector('.re-status'),
      keten: root.querySelector('.re-keten'),
      macros: root.querySelector('.re-macros'),
    };

    root.querySelector('.re-sluit').addEventListener('click', () => this.sluit());
    root.querySelector('.re-bewaar').addEventListener('click', () => this.bewaar(false));
    root.querySelector('.re-nieuw').addEventListener('click', () => this.bewaar(true));
    this.el.naam.addEventListener('input', () => { if (this.kopie) this.kopie.name = this.el.naam.value; });

    // Alles via delegatie: de inhoud wordt opnieuw getekend, de luisteraars niet.
    root.addEventListener('click', (e) => this._klik(e));
    root.addEventListener('change', (e) => this._wijzig(e));
    root.addEventListener('input', (e) => this._schuif(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.sluit();
    });

    // Volgen: kiest iemand een ander rack (kiezer, FX-knop, MIDI), dan hoort
    // de editor dat rack te tonen en niet door te werken op een oude kopie.
    // zetRack() maakt altijd een nieuw rack-object, bewerkMacros() niet —
    // dus objectidentiteit zegt precies wat we willen weten.
    setInterval(() => {
      if (this.open && this.fx && this.fx.rack !== this._rackRef) this.openVoor(this.deckId);
    }, 200);
  }

  get open() { return !this.root.classList.contains('hidden'); }
  get fx() { return this.deckId ? this.engine.deck(this.deckId).fx : null; }

  openVoor(deckId) {
    this.deckId = deckId;
    this.kopie = JSON.parse(JSON.stringify(this.fx.naarJSON()));
    this.melding = null;
    this.el.deck.textContent = this.naamVan(deckId);
    this.el.naam.value = this.kopie.name || '';
    this._rackRef = this.fx.rack;
    this.root.classList.remove('hidden');
    this.teken();
  }

  sluit() {
    this.root.classList.add('hidden');
    this.deckId = null;
    this.kopie = null;
    this._rackRef = null;
  }

  // ---- wijzigingen doorzetten naar het deck -----------------------------

  _ketenGewijzigd() {
    const { fouten } = this.fx.zetRack(this.kopie, { behoudStanden: true });
    this._rackRef = this.fx.rack;
    this._fouten(fouten);
    this.teken();
  }

  _macrosGewijzigd({ tekenen = true } = {}) {
    const { fouten } = this.fx.bewerkMacros(this.kopie.macros);
    this._fouten(fouten);
    if (tekenen) this.teken();
    else this._tekenStatus();
  }

  _fouten(fouten) {
    this.melding = fouten.length ? { tekst: fouten.join(' · '), goed: false } : null;
  }

  // ---- gebeurtenissen ----------------------------------------------------

  _knoop(e) { return e.target.closest('[data-doe]'); }

  _klik(e) {
    const k = this._knoop(e);
    if (!k || !this.kopie) return;
    const doe = k.dataset.doe;
    const i = Number(k.dataset.i);
    const plek = Number(k.dataset.plek);
    const l = Number(k.dataset.link);
    const keten = this.kopie.chain;

    if (doe === 'omhoog' && i > 0) { [keten[i - 1], keten[i]] = [keten[i], keten[i - 1]]; this._ketenGewijzigd(); }
    else if (doe === 'omlaag' && i < keten.length - 1) { [keten[i + 1], keten[i]] = [keten[i], keten[i + 1]]; this._ketenGewijzigd(); }
    else if (doe === 'aanuit') { keten[i].bypass = !keten[i].bypass; this._ketenGewijzigd(); }
    else if (doe === 'weg') {
      const slot = keten[i].slot;
      keten.splice(i, 1);
      // Links naar dit slot hebben geen doel meer. Opruimen in plaats van ze
      // te laten staan als stille verwijzingen naar niets.
      for (const m of this.kopie.macros) m.links = m.links.filter((x) => !x.target.startsWith(slot + '.'));
      this._ketenGewijzigd();
    } else if (doe === 'plek-erbij') {
      const doel = this.fx.doelen()[0];
      this.kopie.macros.push({ place: plek, label: doel ? doel.param : `plek ${plek}`, default: 0.5,
        links: doel ? [{ target: doel.target, from: 0, to: 1 }] : [] });
      this.kopie.macros.sort((a, b) => a.place - b.place);
      this._macrosGewijzigd();
    } else if (doe === 'plek-weg') {
      this.kopie.macros = this.kopie.macros.filter((m) => m.place !== plek);
      this._macrosGewijzigd();
    } else if (doe === 'link-erbij') {
      const m = this._macro(plek);
      const doel = this.fx.doelen().find((d) => !m.links.some((x) => x.target === d.target)) || this.fx.doelen()[0];
      if (doel) m.links.push({ target: doel.target, from: 0, to: 1 });
      this._macrosGewijzigd();
    } else if (doe === 'link-weg') {
      this._macro(plek).links.splice(l, 1);
      this._macrosGewijzigd();
    }
  }

  _wijzig(e) {
    const k = this._knoop(e);
    if (!k || !this.kopie) return;
    const doe = k.dataset.doe;

    if (doe === 'effect-erbij' && k.value) {
      const gebruikt = new Set(this.kopie.chain.map((n) => n.slot));
      let slot = 'a';
      for (let c = 97; c < 123; c++) { const s = String.fromCharCode(c); if (!gebruikt.has(s)) { slot = s; break; } }
      const eff = this.effecten.find((x) => x.id === k.value);
      this.kopie.chain.push({ slot, type: k.value, typeVersion: 1, bypass: false, params: { ...(eff?.standaard || {}) } });
      k.value = '';
      this._ketenGewijzigd();
      return;
    }

    const m = this._macro(Number(k.dataset.plek));
    if (!m) return;
    const l = Number(k.dataset.link);
    if (doe === 'doel') { m.links[l].target = k.value; this._macrosGewijzigd(); }
    else if (doe === 'curve') { m.links[l].curve = k.value; this._macrosGewijzigd(); }
    else if (doe === 'label') { m.label = k.value; this._macrosGewijzigd({ tekenen: false }); }
  }

  /** Schuiven: getallen bijwerken, NIET opnieuw tekenen. */
  _schuif(e) {
    const k = this._knoop(e);
    if (!k || !this.kopie || e.target.type !== 'range') return;
    const m = this._macro(Number(k.dataset.plek));
    if (!m) return;
    const v = parseFloat(e.target.value);
    const l = Number(k.dataset.link);
    const doe = k.dataset.doe;

    if (doe === 'default') {
      m.default = v;
      // De default is ook waar de knop nu heen gaat: dan hoor je wat je bewaart.
      this.fx.setPlek(m.place, v);
    } else {
      const link = m.links[l];
      if (doe === 'van') link.from = v;
      else if (doe === 'tot') link.to = v;
      else if (doe === 'in0') link.in = [v, (link.in || [0, 1])[1]];
      else if (doe === 'in1') link.in = [(link.in || [0, 1])[0], v];
    }
    const uitlees = k.parentElement.querySelector('output');
    if (uitlees) uitlees.textContent = getal(v);
    this._macrosGewijzigd({ tekenen: false });
  }

  _macro(plek) { return this.kopie?.macros.find((m) => m.place === plek) || null; }

  async bewaar(alsNieuw) {
    if (!this.kopie) return;
    this.kopie.name = this.el.naam.value.trim() || this.kopie.name || 'rack';
    try {
      await this.onBewaar({ deckId: this.deckId, naam: this.kopie.name, data: this.fx.naarJSON(), alsNieuw });
      this.melding = { tekst: `"${this.kopie.name}" bewaard bij dit nummer`, goed: true };
    } catch (err) {
      this.melding = { tekst: `bewaren mislukt: ${err.message}`, goed: false };
    }
    this._tekenStatus();
  }

  // ---- tekenen -----------------------------------------------------------

  teken() {
    if (!this.kopie) return;
    this._tekenStatus();
    this._tekenKeten();
    this._tekenMacros();
  }

  _tekenStatus() {
    if (!this.melding) {
      const n = this.kopie.macros.length;
      this.el.status.innerHTML = `${this.kopie.chain.length} effect${this.kopie.chain.length === 1 ? '' : 'en'}`
        + ` · ${n} ${n === 1 ? 'plek' : 'plekken'} in gebruik · wijzigingen hoor je meteen`;
      return;
    }
    this.el.status.innerHTML = `<b class="${this.melding.goed ? 'goed' : 'bad'}">${esc(this.melding.tekst)}</b>`;
  }

  _tekenKeten() {
    const keten = this.kopie.chain;
    const rijen = keten.map((n, i) => {
      const eff = this.effecten.find((x) => x.id === n.type);
      return `<div class="re-node${n.bypass ? ' uit' : ''}">
        <span class="re-slot">${esc(n.slot)}</span>
        <span class="re-effect">${esc(eff?.naam || n.type)}${eff ? '' : ' <i>(onbekend)</i>'}</span>
        <button class="btn sm" data-doe="aanuit" data-i="${i}">${n.bypass ? 'aan' : 'uit'}</button>
        <button class="btn sm" data-doe="omhoog" data-i="${i}"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn sm" data-doe="omlaag" data-i="${i}"${i === keten.length - 1 ? ' disabled' : ''}>↓</button>
        <button class="btn sm re-weg" data-doe="weg" data-i="${i}" title="effect weghalen">×</button>
      </div>`;
    }).join('');
    const kiezer = `<select data-doe="effect-erbij"><option value="">+ effect toevoegen…</option>`
      + this.effecten.map((e) => `<option value="${e.id}">${esc(e.naam)}</option>`).join('') + '</select>';
    this.el.keten.innerHTML = `<div class="re-kop">Keten <i>— signaal loopt van boven naar beneden</i></div>`
      + (rijen || '<div class="re-leeg">nog geen effecten</div>') + kiezer;
  }

  _tekenMacros() {
    const doelen = this.fx.doelen();
    const schuif = (doe, plek, link, waarde, titel) =>
      `<label class="re-schuif" title="${titel}" data-doe="${doe}" data-plek="${plek}" data-link="${link}">
        <span>${titel}</span>
        <input type="range" min="0" max="1" step="0.01" value="${waarde}">
        <output>${getal(waarde)}</output>
      </label>`;

    this.el.macros.innerHTML = `<div class="re-kop">Plekken <i>— knop 1 t/m 8 van de bank</i></div>`
      + PLEKKEN.map((plek) => {
        const m = this._macro(plek);
        if (!m) {
          return `<div class="re-plek leeg">
            <span class="re-nr">${plek}</span>
            <button class="btn sm" data-doe="plek-erbij" data-plek="${plek}"${doelen.length ? '' : ' disabled'}>+ gebruiken</button>
          </div>`;
        }
        const links = m.links.map((x, l) => {
          const [in0, in1] = x.in || [0, 1];
          const opties = doelen.map((d) =>
            `<option value="${esc(d.target)}"${d.target === x.target ? ' selected' : ''}>${esc(d.effect)} · ${esc(d.param)}${d.uit ? ' (uit)' : ''}</option>`).join('');
          const curves = CURVES.map((c) =>
            `<option value="${c}"${(x.curve || 'lin') === c ? ' selected' : ''}>${CURVENAAM[c]}</option>`).join('');
          return `<div class="re-link">
            <select data-doe="doel" data-plek="${plek}" data-link="${l}">${opties}</select>
            ${schuif('van', plek, l, x.from ?? 0, 'van')}
            ${schuif('tot', plek, l, x.to ?? 1, 'tot')}
            ${schuif('in0', plek, l, in0, 'vanaf knop')}
            ${schuif('in1', plek, l, in1, 'tot knop')}
            <select data-doe="curve" data-plek="${plek}" data-link="${l}">${curves}</select>
            <button class="btn sm re-weg" data-doe="link-weg" data-plek="${plek}" data-link="${l}" title="link weghalen">×</button>
          </div>`;
        }).join('');
        return `<div class="re-plek">
          <div class="re-plek-kop">
            <span class="re-nr">${plek}</span>
            <input class="re-label" data-doe="label" data-plek="${plek}" value="${esc(m.label)}" placeholder="naam van de knop">
            ${schuif('default', plek, -1, m.default ?? 0, 'begint op')}
            <button class="btn sm" data-doe="link-erbij" data-plek="${plek}">+ link</button>
            <button class="btn sm re-weg" data-doe="plek-weg" data-plek="${plek}" title="plek vrijmaken">×</button>
          </div>
          ${links || '<div class="re-leeg">deze knop doet nog niets — voeg een link toe</div>'}
        </div>`;
      }).join('');
  }
}
