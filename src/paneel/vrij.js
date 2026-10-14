/**
 * Een vrij paneel (werkruimte S7, docs/WERKRUIMTE.md B2/B3, docs/werkruimte/S7.md): een paneel
 * uit `panelen` van de werkruimte, met items `draai`, `knop`, `schuif`, `lamp`, `xy`, `rij` (met
 * `herhaal` en `{k}`) en `tekst`. Clay bepaalt in de JSON wat er op staat; dit is de bouwsteen.
 *
 * Het paneel kent geen bus en geen engine: alles gaat via een BRON (src/paneel/verbinding.js in
 * werk.html, de bus zelf in het werkvak van de mixer):
 *   bron.read(id)          de stand (0..1, een boolean of null), elk beeld gelezen
 *   bron.invoke(id, v)     of null: dan KIJKT het paneel alleen (de iPad, W1)
 *   bron.metaOf(id)        { type, label } of null (onbekend = grijs, één melding)
 *   bron.label(id)         de korte uitleg (beschrijf().kort) of null
 *   bron.vars()            { focus, speel, tweede, maatgever, … }: voor resolveTarget
 *   bron.badges(id)        ['APC device knob 3', …]: welke control in de open mapjes ernaar wijst
 *   bron.geraakt(id)       ms van de laatste keer dat de action liep, of 0, op de klok van bron.nu()
 *   bron.nu()              die klok (de opener heeft zijn eigen performance.now: een ander nulpunt)
 *   bron.meld(tekst)       één melding (onbekende action)
 *
 * Semantiek zoals controls.js: indrukken LEEST de action (met de vars van dat moment), loslaten
 * gaat naar DEZELFDE action, ook als het deel, de focus of het paneel intussen wisselde. Per
 * pointerId (meerdere vingers op de iPad of het tweede scherm: elke vinger laat los naar wat
 * hij indrukte).
 *
 * Twee soorten:
 *   modus 'los'    (werk.html) het paneel tekent en volgt alles zelf (teken() elk beeld)
 *   modus 'mixer'  (het werkvak) draai, schuif en knop krijgen de gewone controls van de mixer
 *                  (`.knob`, `input[type=range]`, `[data-kind=button]`): vensters.bind(root)
 *                  bindt ze en meldt ze bij de renderloop aan; teken() doet de rest (lamp, xy,
 *                  badges, oplichten, grijs)
 *
 * Regels van 14 okt: schrijven alleen wat verandert (geen opmaak lezen in een lus), geen werk in
 * een MIDI-bericht (oplichten komt uit bron.geraakt, gelezen in het volgende beeld).
 */
import { resolveTarget } from '../control/mapping.js';
import { soortVan } from '../ui/soorten.js';
import { plat, xyActions } from './protocol.js';

/** Zo lang licht een item op als zijn control wordt aangeraakt (zoals spiegel.markeer). */
export const OPLICHT_MS = 300;
export const SOORTEN = ['draai', 'knop', 'schuif', 'lamp', 'xy', 'rij', 'tekst'];

/** De vars voor een paneel: `doel` (focus, speel, tweede, maatgever) is wat {focus} hier betekent. */
export function varsVoor(vars, doel) {
  const v = { ...(vars ?? {}) };
  if (doel && doel !== 'focus' && v[doel] != null) v.focus = v[doel];
  return v;
}

/** Een action invullen, of null als er nog een {…} in staat (geen focus, geen maatgever). */
export function vul(action, vars) {
  if (typeof action !== 'string') return null;
  const a = resolveTarget(action, vars);
  return a.includes('{') ? null : a;
}

/** Een getal van een read: 0..1, of null. Een boolean telt als 0/1. */
const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null);
const klem = (v) => Math.min(1, Math.max(0, v));

export class VrijPaneel {
  /**
   * @param el     het element waarin het paneel komt
   * @param def    het paneel uit de werkruimte: { titel, doel, items }
   * @param bron   zie boven
   * @param opties { modus: 'los' | 'mixer', id, knobVan (alleen de mixer) }
   */
  constructor(el, def, bron, { modus = 'los', id = '', knobVan = null } = {}) {
    this.knobVan = knobVan;   // in de mixer: controls.js (de Knob van een element), voor een nieuwe action na een focuswissel
    this.el = el;
    this.doc = el.ownerDocument;
    this.def = def ?? { items: [] };
    this.bron = bron;
    this.modus = modus === 'mixer' ? 'mixer' : 'los';
    this.id = id;
    this.items = [];
    this._vast = new Map();        // pointerId -> { item, action, … }
    this._gemeld = new Set();
    this._varsSleutel = '';
    this._bouw();
  }

  get kijkt() { return typeof this.bron?.invoke !== 'function'; }

  _maak(tag, klasse, ouder, tekst) {
    const e = this.doc.createElement(tag);
    if (klasse) e.className = klasse;
    if (tekst != null) e.textContent = tekst;
    if (ouder) ouder.appendChild(e);
    return e;
  }

  _bouw() {
    this.root = this._maak('div', `vp vp-${this.modus}${this.kijkt ? ' vp-kijkt' : ''}`, this.el);
    this.root.dataset.paneel = this.id;
    const kop = this._maak('div', 'vp-kop', this.root);
    this._titel = this._maak('span', 'vp-titel', kop, this.def.titel ?? this.id ?? 'paneel');
    this._badge = this._maak('span', 'vp-badge', kop, '');
    this._lijst = this._maak('div', 'vp-items', this.root);
    for (const it of plat(this.def)) this.items.push(this._item(it));
    this._herlees(true);
    // Eén luisteraar per paneel (pointer events, per vinger). In de mixer doen de gewone
    // controls hun eigen invoer; daar alleen xy.
    this._omlaag = (e) => this._druk(e);
    this._beweeg = (e) => this._sleep(e);
    this._los = (e) => this._laat(e);
    this.root.addEventListener('pointerdown', this._omlaag);
    this.root.addEventListener('pointermove', this._beweeg);
    this.root.addEventListener('pointerup', this._los);
    this.root.addEventListener('pointercancel', this._los);
    this.root.addEventListener('lostpointercapture', this._los);
  }

  _item(it) {
    const soort = SOORTEN.includes(it.soort) ? it.soort : 'tekst';
    const el = this._maak('div', `vp-item vp-${soort}`, this._lijst);
    const item = { ...it, _ruw: it.action ?? null, soort, el, waarde: undefined, action: null, actions: [], kleur: '', grijs: false, licht: false, badge: '' };
    if (soort === 'tekst') { this._maak('span', 'vp-tekst-in', el, it.tekst ?? it.label ?? ''); return item; }
    const mixer = this.modus === 'mixer';
    if (soort === 'draai') {
      if (mixer) { item.ctl = this._maak('div', 'knob', el); item.ctl.dataset.label = ''; }
      else {
        item.dial = this._maak('div', 'vp-dial', el);
        item.ind = this._maak('div', 'vp-ind', item.dial);
      }
    } else if (soort === 'schuif') {
      if (mixer) { item.ctl = this._maak('input', 'vp-fader', el); Object.assign(item.ctl, { type: 'range', min: 0, max: 1, step: 0.001 }); }
      else { item.baan = this._maak('div', 'vp-baan', el); item.vul = this._maak('div', 'vp-vul', item.baan); }
    } else if (soort === 'knop') {
      item.ctl = this._maak('button', 'vp-knop', el);
      if (mixer) item.ctl.dataset.kind = 'button';
    } else if (soort === 'lamp') {
      item.lamp = this._maak('div', 'vp-lampje', el);
    } else if (soort === 'xy') {
      item.vlak = this._maak('div', 'vp-vlak', el);
      item.punt = this._maak('div', 'vp-punt', item.vlak);
    }
    item.labelEl = this._maak('span', 'vp-label', el, '');
    item.badgeEl = this._maak('span', 'vp-ibadge', el, '');
    return item;
  }

  /** De actions opnieuw invullen als de vars (focus …) veranderden. Alleen schrijven wat verandert. */
  _herlees(eerst = false) {
    // Zegt de bron zelf wanneer de vars veranderen (varsSleutel), dan per beeld alleen die vergelijking.
    const vs = this.bron?.varsSleutel?.() ?? null;
    if (!eerst && vs !== null && vs === this._vsBron) return false;
    this._vsBron = vs;
    const vars = varsVoor(this.bron?.vars?.() ?? {}, this.def.doel);
    const sleutel = JSON.stringify(vars);
    if (!eerst && sleutel === this._varsSleutel) return false;
    this._varsSleutel = sleutel;
    for (const it of this.items) {
      if (it.soort === 'tekst') continue;
      const acts = it.soort === 'xy' ? xyActions(it._ruw).map((a) => vul(a, vars)) : [vul(it._ruw, vars)];
      const a = acts[0];
      it.actions = acts;
      if (a === it.action && !eerst) continue;
      it.action = a;
      const meta = a ? this.bron?.metaOf?.(a) : null;
      // Onbekend (bestaat niet, of nog een {focus} zonder focus): grijs, één melding per action.
      const grijs = !a || !meta;
      if (grijs !== it.grijs) { it.grijs = grijs; it.el.classList.toggle('vp-grijs', grijs); }
      if (grijs && it._ruw && !this._gemeld.has(it._ruw)) {
        this._gemeld.add(it._ruw);
        this.bron?.meld?.(`paneel ${this.id}: ${a ?? it._ruw} bestaat niet (grijs)`);
      }
      it.type = meta?.type ?? null;
      const label = it.label ?? this.bron?.label?.(a) ?? meta?.label ?? a ?? it._ruw;
      if (it.labelEl.textContent !== label) it.labelEl.textContent = label;
      if (it.ctl?.tagName === 'BUTTON' && it.ctl.textContent !== label) it.ctl.textContent = label;
      const kleur = `s-${soortVan(a)}`;
      if (kleur !== it.kleur) { if (it.kleur) it.el.classList.remove(it.kleur); it.el.classList.add(kleur); it.kleur = kleur; }
      // In de mixer: de gewone controls lezen hun action uit data-action (vensters.bind).
      if (it.ctl && this.modus === 'mixer') {
        if (a) it.ctl.dataset.action = a; else delete it.ctl.dataset.action;
        const knob = this.knobVan?.get(it.ctl);
        if (knob) knob.action = a;
      }
      it.el.title = `${label}\n${a ?? it._ruw}`;
    }
    return true;
  }

  /**
   * Elk beeld: volgen (read), badges en oplichten. Alleen wat verandert wordt geschreven.
   * `nu` = de klok van de bron (bron.nu), anders performance.now() van dit document.
   */
  teken(nu = this.bron?.nu?.() ?? this.doc.defaultView?.performance?.now?.() ?? 0) {
    const nieuweActions = this._herlees();
    // Badges alleen opnieuw als de bron zegt dat ze veranderden (mapjes, mapping, focus): op
    // mac-2 draait dit in de thread van de mixer, dus niets per beeld wat niet hoeft.
    const bs = this.bron?.badgeSleutel?.() ?? null;
    const badges = nieuweActions || bs === null || bs !== this._bs;
    this._bs = bs;
    let paneelBadges = badges ? new Set() : null;
    for (const it of this.items) {
      if (it.soort === 'tekst' || !it.action) continue;
      if (it.soort === 'xy') this._toonXy(it);
      else if (this.modus === 'los' || it.soort === 'lamp' || it.soort === 'knop') this._toon(it, this.bron.read(it.action));
      if (badges) {
        // Welke control ernaar wijst (in de open mapjes, per apparaat).
        let b = '';
        for (const a of it.actions) for (const x of (a ? this.bron?.badges?.(a) ?? [] : [])) b = b ? `${b} · ${x}` : x;
        if (b !== it.badge) { it.badge = b; it.badgeEl.textContent = b; it.el.classList.toggle('vp-heeft-badge', !!b); }
        if (b) for (const x of b.split(' · ')) paneelBadges.add(x.split(' ')[0]);
      }
      // Oplichten: 300 ms na de laatste keer dat de action liep (de APC, de Maschine, een klik).
      let t = 0;
      for (const a of it.actions) { const g = a ? this.bron?.geraakt?.(a) ?? 0 : 0; if (g > t) t = g; }
      const licht = t > 0 && nu - t < OPLICHT_MS;
      if (licht !== it.licht) { it.licht = licht; it.el.classList.toggle('vp-geraakt', licht); }
    }
    if (paneelBadges) {
      const pb = [...paneelBadges].join(' · ');
      if (pb !== this._pb) { this._pb = pb; this._badge.textContent = pb; }
    }
  }

  /** De actions en labels opnieuw (de bron kent nu meer, bv. na een nieuwe werkruimte-melding). */
  ververs() { this._herlees(true); this._bs = undefined; }

  _toon(it, ruw) {
    const v = getal(ruw);
    const key = v === null ? 'x' : Math.round(v * 1000);
    if (key === it.waarde) return;
    it.waarde = key;
    it.el.classList.toggle('vp-leeg', v === null);
    if (it.soort === 'draai' && it.ind) it.ind.style.transform = `rotate(${-140 + (v ?? 0) * 280}deg)`;
    else if (it.soort === 'schuif' && it.vul) it.vul.style.transform = `scaleX(${(v ?? 0).toFixed(3)})`;
    else if (it.soort === 'knop' || it.soort === 'lamp') {
      // Zoals de LED's: 1 = aan, tussenin = gedimd (gevuld/wacht), 0 = uit, null = niets te doen.
      it.el.classList.toggle('vp-aan', v !== null && v >= 0.75);
      it.el.classList.toggle('vp-half', v !== null && v > 0.05 && v < 0.75);
    }
  }

  _toonXy(it) {
    const x = getal(this.bron.read(it.actions[0]));
    const y = it.actions[1] ? getal(this.bron.read(it.actions[1])) : null;
    const key = `${x === null ? 'x' : Math.round(x * 1000)}:${y === null ? 'x' : Math.round(y * 1000)}`;
    if (key === it.waarde) return;
    it.waarde = key;
    it.punt.style.transform = `translate(${((x ?? 0.5) * 100).toFixed(1)}%, ${((1 - (y ?? 0.5)) * 100).toFixed(1)}%)`;
  }

  // ---- invoer (alleen met een invoke: mac-2 via opener, het werkvak) ------------------------

  _itemBij(e) {
    const el = e.target?.closest?.('.vp-item');
    return el ? this.items.find((i) => i.el === el) ?? null : null;
  }

  _druk(e) {
    if (this.kijkt || e.button > 0) return;
    const it = this._itemBij(e);
    if (!it || it.grijs || !it.action) return;
    // In de mixer doen draai, schuif en knop hun eigen invoer (controls.js).
    if (this.modus === 'mixer' && it.soort !== 'xy') return;
    if (it.soort === 'tekst' || it.soort === 'lamp') return;
    e.preventDefault?.();
    try { e.target.setPointerCapture?.(e.pointerId); } catch (_) {}
    // De action van NU vastleggen: loslaten gaat hierheen, ook na een deelwissel tussendoor.
    const vast = { it, action: it.action, actions: [...it.actions], type: it.type, y0: e.clientY, x0: e.clientX,
      v0: getal(this.bron.read(it.action)) ?? 0, rect: null };
    if (it.soort === 'knop') {
      if (it.type === 'value') return;   // zoals controls.js: een knop op een draaiknop-action doet niets
      this._vast.set(e.pointerId, vast);
      this.bron.invoke(vast.action, true);
      it.el.classList.add('vp-in');
      return;
    }
    if (it.type !== 'value') return;
    // De maat van het vlak: één keer bij het indrukken (geen opmaak lezen per beweging).
    if (it.soort === 'schuif' || it.soort === 'xy') vast.rect = (it.vlak ?? it.baan ?? it.el).getBoundingClientRect();
    this._vast.set(e.pointerId, vast);
    it.el.classList.add('vp-in');
    if (it.soort !== 'draai') this._zetUit(vast, e);
  }

  _sleep(e) {
    const vast = this._vast.get(e.pointerId);
    if (!vast || vast.it.soort === 'knop') return;
    e.preventDefault?.();
    this._zetUit(vast, e);
  }

  _zetUit(vast, e) {
    const { it } = vast;
    if (it.soort === 'draai') {
      const v = klem(vast.v0 + (vast.y0 - e.clientY) / (e.shiftKey ? 600 : 160));
      this.bron.invoke(vast.action, v);
    } else if (vast.rect && vast.rect.width > 0) {
      const x = klem((e.clientX - vast.rect.left) / vast.rect.width);
      this.bron.invoke(vast.action, x);
      if (it.soort === 'xy' && vast.actions[1] && vast.rect.height > 0) {
        this.bron.invoke(vast.actions[1], klem(1 - (e.clientY - vast.rect.top) / vast.rect.height));
      }
    }
  }

  _laat(e) {
    const vast = this._vast.get(e.pointerId);
    if (!vast) return;
    this._vast.delete(e.pointerId);
    vast.it.el.classList.remove('vp-in');
    if (vast.it.soort === 'knop') this.bron.invoke(vast.action, false);
  }

  /** Alles wat nog vastzit loslaten (het paneel gaat weg, de verbinding valt weg). */
  laatAllesLos() {
    for (const [id] of [...this._vast]) this._laat({ pointerId: id });
  }

  vernietig() {
    this.laatAllesLos();
    this.root.removeEventListener('pointerdown', this._omlaag);
    this.root.removeEventListener('pointermove', this._beweeg);
    this.root.removeEventListener('pointerup', this._los);
    this.root.removeEventListener('pointercancel', this._los);
    this.root.removeEventListener('lostpointercapture', this._los);
    this.root.remove();
  }
}
