import { CURVES, neemOp } from '../engine/rack.js';
import { esc, pct } from './dom.js';
import { toonWaarde } from '../engine/fx.js';
import { Knob } from './controls.js';

/**
 * De rack-editor: racks maken met de muis in plaats van JSON te schrijven.
 *
 * Opgebouwd zoals een DJ denkt, niet zoals het rack is opgeslagen:
 *
 *   bovenaan  de acht KNOPPEN — wat je straks op de APC vastpakt, met naam,
 *             live stand en in één regel wat ze doen
 *   daaronder de KETEN als echte effecten met draaiknoppen in ms, Hz en %;
 *             een parameter die door een knop gestuurd wordt draait mee
 *   rechts    de gekozen knop: DICHT en OPEN, en wat hij verandert
 *
 * Instellen gaat op het gehoor. Zet een knop op DICHT: hij gaat naar 0 en
 * elke draai aan een effect wordt zijn dichte stand. Zet hem op OPEN: idem
 * voor knop 1. Getallen (van/tot, venster, curve) zitten achter "meer".
 *
 * Werkt op een KOPIE van het rack van het deck, en elke wijziging gaat meteen
 * naar het deck zodat je hoort wat je doet. Drie soorten wijzigingen:
 *
 *   keten (effect erbij, weg, volgorde, aan/uit)
 *       bouwt de keten opnieuw, met kruisfade, en houdt je knopstanden vast
 *   parameter (een draaiknop in de keten)
 *       zet één waarde, geen nieuwe keten
 *   knoppen (bereik, venster, curve, naam)
 *       past alleen getallen aan; er wordt geen node aangeraakt
 *
 * Tijdens het slepen wordt er NIET opnieuw getekend: dan zou je je greep op
 * de schuif of knop halverwege kwijtraken.
 *
 * Deze module praat niet met de server. Bewaren is een callback, zodat app.js
 * bijhoudt welk rack bij welk nummer hoort.
 */

const KNOPPEN = [1, 2, 3, 4, 5, 6, 7, 8];

// Glijtijd op een schuif: het eerste stukje is "direct", daarna 1 s tot 5 min
// exponentieel — het verschil tussen 1 en 5 s voel je, tussen 4:00 en 4:04 niet.
const GLIJ_MAX = 300;
const schuifNaarGlide = (v) => (v < 0.02 ? 0 : Math.pow(GLIJ_MAX, (v - 0.02) / 0.98));
const glideNaarSchuif = (sec) => (sec > 0 ? 0.02 + 0.98 * Math.log(Math.max(1, sec)) / Math.log(GLIJ_MAX) : 0);
const glideTekst = (sec) => (!sec ? 'direct' : sec < 60 ? `${Math.round(sec)} s`
  : `${(sec / 60).toFixed(sec < 600 ? 1 : 0).replace('.', ',').replace(',0', '')} min`);
const CURVENAAM = { lin: 'gelijkmatig', exp: 'traag → snel', log: 'snel → traag', s: 'zacht in en uit' };

export class RackEditor {
  constructor({ root, engine, effecten, onBewaar, naamVan = (id) => `deck ${id}`,
    trackVan = () => 1, kanBewaren = () => true }) {
    this.root = root;
    this.engine = engine;
    this.effecten = effecten;
    this.onBewaar = onBewaar;
    this.naamVan = naamVan;
    this.trackVan = trackVan;
    this.kanBewaren = kanBewaren;
    this.deckId = null;
    this.kopie = null;
    this.melding = null;
    this.gekozen = 1;               // welke knop rechts in detail staat
    this.meerOpen = new Set();      // "plek:link" waarvan de extra's openstaan
    this.plekKnoppen = [];
    this.paramKnoppen = [];
    this.modus = null;              // { plek, kant: 'dicht'|'open', vorige } tijdens instellen
    this._verversTimer = null;

    this.el = {
      deck: root.querySelector('.re-deck'),
      naam: root.querySelector('.re-naam'),
      status: root.querySelector('.re-status'),
      plekken: root.querySelector('.re-plekken'),
      keten: root.querySelector('.re-keten'),
      macros: root.querySelector('.re-macros'),
    };

    root.querySelector('.re-sluit').addEventListener('click', () => this.sluit());
    root.querySelector('.re-bewaar').addEventListener('click', () => this.bewaar(false));
    root.querySelector('.re-nieuw').addEventListener('click', () => this.bewaar(true));
    root.querySelector('.re-status').addEventListener('click', (e) => {
      const k = e.target.closest('[data-hoorbaar]');
      if (!k || !this.fx) return;
      if (k.dataset.hoorbaar === 'aan') this.fx.setBypass(false);
      else this.fx.setMix(0.5);
      this.melding = null;
      this._tekenStatus();
    });
    this.el.naam.addEventListener('input', () => {
      if (!this.kopie) return;
      this.kopie.name = this.el.naam.value;
      this.fx.hernoem(this.el.naam.value);      // de FX-rij toont meteen de nieuwe naam
    });

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
    //
    // Op een timer en niet in de animatielus: die staat stil zodra het venster
    // achter iets anders zit, en een APC-knop draai je ook dan.
    setInterval(() => {
      if (!this.open || !this.fx) return;
      if (this.fx.rack !== this._rackRef) { this.openVoor(this.deckId); return; }
      this._controleerModus();
    }, 200);
  }

  get open() { return !this.root.classList.contains('hidden'); }
  get fx() { return this.deckId ? this.engine.deck(this.deckId).fx : null; }

  openVoor(deckId) {
    const zelfde = deckId === this.deckId;
    // Naar een andere track: de knop die op de oude op 0 of 1 stond, eerst
    // terug. Anders bleef die track op DICHT of OPEN hangen. Zelfde track met
    // een ander rack: dat rack begint toch op zijn eigen standen.
    if (this.modus && !zelfde && this.deckId) this._uitModus({ tekenen: false });
    this.modus = null;
    this.deckId = deckId;
    this.kopie = JSON.parse(JSON.stringify(this.fx.naarJSON()));
    this.el.deck.textContent = this.naamVan(deckId);
    this.el.naam.value = this.kopie.name || '';
    this._rackRef = this.fx.rack;
    this.melding = this._stilteMelding();
    if (!zelfde || !this._macro(this.gekozen)) this.gekozen = this.kopie.macros[0]?.place ?? 1;
    const bewaarbaar = this.kanBewaren(deckId);
    for (const k of this.root.querySelectorAll('.re-bewaar, .re-nieuw')) {
      k.disabled = !bewaarbaar;
      k.dataset.titel ??= k.title;
      k.title = bewaarbaar ? k.dataset.titel : 'bewaren kan alleen met een nummer uit de library';
    }
    const wasDicht = !this.open;
    this.root.classList.remove('hidden');
    this.teken();
    if (wasDicht) this._volg();
  }

  /**
   * Hoor je straks iets van wat je hier doet? Met MIX op 0 of het effect uit
   * niet — en dan lijkt de editor kapot. Staat de track stil, dan zetten we
   * de MIX zelf op de helft: er klinkt toch niets. Speelt hij, dan draaien
   * we niet ongevraagd aan wat de zaal hoort, maar zeggen we het.
   */
  _stilteMelding({ zelfZetten = true } = {}) {
    const fx = this.fx, deck = this.engine.deck(this.deckId);
    if (fx.bypass) return { tekst: 'het effect staat UIT (knop "uit" in de FX-rij) — je hoort je wijzigingen niet', goed: false, knop: 'aan' };
    if (fx.mix >= 0.05) return null;
    if (!deck.playing && zelfZetten) { fx.setMix(0.5); return { tekst: 'MIX op 50% gezet, zodat je hoort wat je doet', goed: true }; }
    return { tekst: 'MIX staat op 0 — je hoort je wijzigingen niet', goed: false, knop: 'mix' };
  }

  sluit() {
    this._uitModus();
    this.root.classList.add('hidden');
    this.deckId = null;
    this.kopie = null;
    this._rackRef = null;
  }

  // ---- DICHT en OPEN -------------------------------------------------------

  /** De knop naar 0 of 1 zetten, zodat je hoort wat je instelt. Nog eens klikken = stoppen. */
  _zetModus(kant) {
    const plek = this.gekozen;
    if (!this._macro(plek)) return;
    if (this.modus?.plek === plek && this.modus.kant === kant) { this._uitModus(); return; }
    // Hoort de zaal deze track, dan springt de knop hoorbaar naar 0 of 1.
    // Niet ongevraagd: eerst zeggen, bij een tweede klik doen.
    if (!this.modus && this._hoorbaar() && this._zeker !== `${plek}:${kant}`) {
      this._zeker = `${plek}:${kant}`;
      setTimeout(() => { if (this._zeker === `${plek}:${kant}`) this._zeker = null; }, 3000);
      this.melding = { tekst: `deze track is hoorbaar: ${kant.toUpperCase()} zet knop ${plek} live op ${kant === 'dicht' ? '0' : 'vol'} — klik nog eens om door te gaan`, goed: false };
      this._tekenStatus();
      return;
    }
    this._zeker = null;
    const vorige = this.modus?.plek === plek ? this.modus.vorige : this.fx.leesPlek(plek);
    if (this.modus && this.modus.plek !== plek) this._uitModus({ tekenen: false });
    this.modus = { plek, kant, vorige };
    this.fx.setPlek(plek, kant === 'dicht' ? 0 : 1, { direct: true });
    this._tekenKeten();
    this._tekenMacros();
  }

  /** Speelt deze track en staat hij open (fader en crossfader)? */
  _hoorbaar() {
    const d = this.engine.deck(this.deckId);
    return d.playing && d.ui.fader > 0.01 && this.engine.xfadeGain(this.deckId) > 0.01;
  }

  /** Stoppen met instellen; de knop terug naar waar hij stond. */
  _uitModus({ tekenen = true } = {}) {
    if (!this.modus) return;
    const { plek, vorige } = this.modus;
    this.modus = null;
    if (this.fx && vorige !== null && vorige !== undefined) this.fx.setPlek(plek, vorige, { direct: true });
    if (tekenen && this.kopie) { this._tekenKeten(); this._tekenMacros(); }
  }

  /**
   * Draai je zelf aan de knop die je aan het instellen bent (hier, in de
   * FX-rij of op de APC), dan ben je aan het spelen, niet meer aan het
   * instellen. Niet terugzetten: je hand heeft gelijk.
   */
  _controleerModus() {
    if (!this.modus) return;
    const stand = this.fx.leesPlek(this.modus.plek);
    if (stand !== null && Math.abs(stand - (this.modus.kant === 'dicht' ? 0 : 1)) <= 0.001) return;
    this.modus = null;
    this._tekenKeten();
    this._tekenMacros();
  }

  /** Aan een effect gedraaid terwijl een knop op DICHT of OPEN staat. */
  _neemOp(slot, param, v) {
    const m = this._macro(this.modus.plek);
    if (!m) return;
    const target = `${slot}.${param}`;
    const r = neemOp(m, target, this.modus.kant, v, this.fx.paramWaarde(slot, param));
    const { fouten } = this.fx.bewerkMacros(this.kopie.macros);
    // Koppeling verdwenen omdat beide kanten gelijk werden: de parameter
    // houdt die waarde als eigen stand, anders verspringt hij.
    if (r.weg) this._paramGedraaid(slot, param, r.basis);
    this._fouten(fouten);
    this._tekenStatus();
    this._tekenBeschrijvingen();
    this._tekenMacros();
    this._straksKeten();
  }

  /**
   * De keten opnieuw tekenen (badges, ringen) — maar niet terwijl je aan een
   * knop draait, anders glipt hij onder je muis vandaan.
   */
  _straksKeten() {
    clearTimeout(this._verversTimer);
    this._verversTimer = setTimeout(() => {
      if (!this.open) return;
      if (this.paramKnoppen.some((p) => p.knob.dragging)) { this._straksKeten(); return; }
      this._tekenKeten();
    }, 350);
  }

  // ---- meebewegen ----------------------------------------------------------

  /**
   * Elke frame de knoppen gelijk trekken met wat er klinkt: draai je aan de
   * APC of aan een knop in de FX-rij, dan beweegt het hier mee, en een
   * gestuurde parameter laat zien wat zijn knop ermee doet.
   */
  _volg() {
    if (!this.open || !this.fx) return;
    try {
      const fx = this.fx;
      for (const p of this.plekKnoppen) {
        const v = fx.leesPlek(p.plek);
        if (v === null) continue;
        if (!p.knob.dragging && Math.abs(v - p.knob.value) > 0.0005) p.knob.set(v, true);
        // Glijdt het geluid nog, dan zie je waar het IS en waar het heen gaat.
        const glijdt = fx.glijdt(p.plek);
        const t = glijdt ? `${pct(fx.plekEffectief(p.plek))}→${pct(v)}` : pct(v);
        if (p.uit.textContent !== t) p.uit.textContent = t;
        p.uit.classList.toggle('glijdt', glijdt);
      }
      for (const p of this.paramKnoppen) {
        const v = fx.paramWaarde(p.slot, p.param);
        if ((p.vast || !p.knob.dragging) && Math.abs(v - p.knob.value) > 0.0005) p.knob.set(v, true);
        const t = toonWaarde(p.type, p.param, v, (q) => fx.paramWaarde(p.slot, q));
        if (p.uit.textContent !== t) p.uit.textContent = t;
      }
    } catch (err) {
      console.warn('[rack-editor] meebewegen:', err.message);
    }
    requestAnimationFrame(() => this._volg());
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
    else { this._tekenStatus(); this._tekenBeschrijvingen(); }
  }

  /** Fouten gaan voor; anders blijft staan dat je niets hoort, zolang dat zo is. */
  _fouten(fouten) {
    this.melding = fouten.length ? { tekst: fouten.join(' · '), goed: false } : this._stilteMelding({ zelfZetten: false });
  }

  // ---- namen -------------------------------------------------------------

  /** "Delay", of "Delay 2" als er twee delays in de keten zitten. */
  _slotNaam(slot) {
    const keten = this.kopie.chain;
    const node = keten.find((n) => n.slot === slot);
    if (!node) return slot;
    const naam = this.effecten.find((e) => e.id === node.type)?.naam || node.type;
    const zelfde = keten.filter((n) => n.type === node.type);
    return zelfde.length > 1 ? `${naam} ${zelfde.indexOf(node) + 1}` : naam;
  }

  /** De andere parameters van hetzelfde effect, voor eenheden die ervan afhangen (delay op de maat). */
  _leesVan(target) {
    const slot = target.slice(0, target.indexOf('.'));
    return (q) => this.fx.paramWaarde(slot, q);
  }

  _typeVan(target) {
    const slot = target.slice(0, target.indexOf('.'));
    return this.kopie.chain.find((n) => n.slot === slot)?.type;
  }

  _doelNaam(target) {
    const punt = target.indexOf('.');
    return `${this._slotNaam(target.slice(0, punt))} ${target.slice(punt + 1)}`;
  }

  /** In één regel wat een knop doet: "Delay feedback ↑ · Filter freq ↓". */
  _beschrijf(m) {
    if (!m.links.length) return 'doet nog niets';
    return (m.glide > 0 ? `⟿ ${glideTekst(m.glide)} · ` : '') + m.links.map((l) => `${this._doelNaam(l.target)} ${(l.to ?? 1) >= (l.from ?? 0) ? '↑' : '↓'}`).join(' · ');
  }

  // ---- gebeurtenissen ----------------------------------------------------

  _knoop(e) { return e.target.closest('[data-doe]'); }

  /** Een doel dat nog door geen enkele knop gestuurd wordt; anders het eerste. */
  _vrijDoel(uitsluiten = []) {
    const doelen = this.fx.doelen().filter((d) => !d.uit);
    const bezet = new Set(this.kopie.macros.flatMap((m) => m.links.map((l) => l.target)));
    return doelen.find((d) => !bezet.has(d.target) && !uitsluiten.includes(d.target))
      || doelen.find((d) => !uitsluiten.includes(d.target)) || null;
  }

  _klik(e) {
    const k = this._knoop(e);
    if (!k || !this.kopie) return;
    const doe = k.dataset.doe;
    const i = Number(k.dataset.i);
    const plek = Number(k.dataset.plek);
    const l = Number(k.dataset.link);
    const keten = this.kopie.chain;

    if (doe === 'kant') { this._zetModus(k.dataset.kant); return; }
    if (doe === 'kies') {
      if (this.gekozen !== plek) {
        this._uitModus({ tekenen: false });
        this.gekozen = plek;
        this._tekenKeten();
        for (const t of this.el.plekken.querySelectorAll('.re-tegel')) t.classList.toggle('gekozen', Number(t.dataset.plek) === plek);
        this._tekenMacros();
      }
    } else if (doe === 'omhoog' && i > 0) { [keten[i - 1], keten[i]] = [keten[i], keten[i - 1]]; this._ketenGewijzigd(); }
    else if (doe === 'omlaag' && i < keten.length - 1) { [keten[i + 1], keten[i]] = [keten[i], keten[i + 1]]; this._ketenGewijzigd(); }
    else if (doe === 'aanuit') { keten[i].bypass = !keten[i].bypass; this._ketenGewijzigd(); }
    else if (doe === 'weg') {
      const slot = keten[i].slot;
      const geraakt = this.kopie.macros.filter((m) => m.links.some((x) => x.target.startsWith(slot + '.'))).map((m) => m.place);
      keten.splice(i, 1);
      // Koppelingen naar dit effect hebben geen doel meer. Opruimen, en zeggen
      // welke knoppen iets kwijt zijn — anders lijkt een knop ineens kapot.
      for (const m of this.kopie.macros) m.links = m.links.filter((x) => !x.target.startsWith(slot + '.'));
      this._ketenGewijzigd();
      if (geraakt.length) {
        this.melding = { tekst: `knop ${geraakt.join(', ')} stuurde dit effect aan en is daar nu vanaf`, goed: false };
        this._tekenStatus();
      }
    } else if (doe === 'plek-erbij') {
      // Leeg beginnen en meteen op OPEN: "draai aan een effect" is de
      // volgende stap, niet "kies een parameter uit een lijst".
      this.kopie.macros.push({ place: plek, label: `knop ${plek}`, default: 0, links: [] });
      this.kopie.macros.sort((a, b) => a.place - b.place);
      this.gekozen = plek;
      this._macrosGewijzigd();
      this._zetModus('open');
    } else if (doe === 'plek-weg') {
      this._uitModus({ tekenen: false });
      this.kopie.macros = this.kopie.macros.filter((m) => m.place !== plek);
      this._macrosGewijzigd();
    } else if (doe === 'link-erbij') {
      const m = this._macro(plek);
      const doel = this._vrijDoel(m.links.map((x) => x.target));
      if (doel) m.links.push({ target: doel.target, from: 0, to: 1 });
      this._macrosGewijzigd();
    } else if (doe === 'link-weg') {
      this._macro(plek).links.splice(l, 1);
      this._macrosGewijzigd();
    } else if (doe === 'meer') {
      const sleutel = `${plek}:${l}`;
      if (this.meerOpen.has(sleutel)) this.meerOpen.delete(sleutel); else this.meerOpen.add(sleutel);
      this._tekenMacros();
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
    else if (doe === 'label') { m.label = k.value; this._macrosGewijzigd({ tekenen: false }); this._tekenPlekken(); }
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
    let tekst = pct(v);

    if (doe === 'glide') {
      m.glide = schuifNaarGlide(v);
      tekst = glideTekst(m.glide);
    } else if (doe === 'default') {
      m.default = v;
      // De startstand is ook waar de knop nu heen gaat: dan hoor je wat je bewaart.
      this.fx.setPlek(m.place, v, { direct: true });
    } else {
      const link = m.links[l];
      if (doe === 'van' || doe === 'tot') {
        link[doe === 'van' ? 'from' : 'to'] = v;
        tekst = toonWaarde(this._typeVan(link.target), link.target.slice(link.target.indexOf('.') + 1), v, this._leesVan(link.target));
      } else if (doe === 'in0') link.in = [v, (link.in || [0, 1])[1]];
      else if (doe === 'in1') link.in = [(link.in || [0, 1])[0], v];
    }
    const uitlees = k.querySelector('output');
    if (uitlees) uitlees.textContent = tekst;
    this._macrosGewijzigd({ tekenen: false });
  }

  _paramGedraaid(slot, param, v) {
    const node = this.kopie.chain.find((n) => n.slot === slot);
    if (!node) return;
    node.params = { ...(node.params || {}), [param]: v };
    this.fx.zetParam(slot, param, v);
  }

  _macro(plek) { return this.kopie?.macros.find((m) => m.place === plek) || null; }

  async bewaar(alsNieuw) {
    if (!this.kopie) return;
    this.kopie.name = this.el.naam.value.trim() || this.kopie.name || 'rack';
    try {
      const { nieuw } = await this.onBewaar({ deckId: this.deckId, naam: this.kopie.name, alsNieuw });
      this._rackRef = this.fx.rack;
      this.melding = { tekst: `"${this.kopie.name}" ${nieuw ? 'als nieuw rack bewaard' : 'bijgewerkt'} bij dit nummer`, goed: true };
    } catch (err) {
      this.melding = { tekst: `bewaren mislukt: ${err.message}`, goed: false };
    }
    this._tekenStatus();
  }

  // ---- tekenen -----------------------------------------------------------

  teken() {
    if (!this.kopie) return;
    this._tekenStatus();
    this._tekenPlekken();
    this._tekenKeten();
    this._tekenMacros();
  }

  _tekenStatus() {
    if (!this.melding) {
      const n = this.kopie.macros.length;
      this.el.status.innerHTML = `${this.kopie.chain.length} effect${this.kopie.chain.length === 1 ? '' : 'en'}`
        + ` · ${n} van 8 knoppen in gebruik · wat je verandert hoor je meteen`;
      return;
    }
    const knop = this.melding.knop === 'mix' ? ' <button class="btn sm" data-hoorbaar="mix">MIX naar 50%</button>'
      : this.melding.knop === 'aan' ? ' <button class="btn sm" data-hoorbaar="aan">effect aan</button>' : '';
    this.el.status.innerHTML = `<b class="${this.melding.goed ? 'goed' : 'bad'}">${esc(this.melding.tekst)}</b>${knop}`;
  }

  /** De acht knoppen, zoals op de APC: naam, stand, wat ze doen. */
  _tekenPlekken() {
    const nr = this.trackVan(this.deckId);
    this.el.plekken.innerHTML = KNOPPEN.map((plek) => {
      const m = this._macro(plek);
      const gekozen = plek === this.gekozen ? ' gekozen' : '';
      if (!m) {
        return `<div class="re-tegel leeg${gekozen}" data-doe="kies" data-plek="${plek}" title="knop ${plek} is vrij — klik om te gebruiken">
          <span class="re-tegel-nr">${plek}</span>
          <span class="re-tegel-naam">vrij</span>
        </div>`;
      }
      return `<div class="re-tegel${gekozen}" data-doe="kies" data-plek="${plek}">
        <div class="knob sm" data-action="track.${nr}.fx.knop.${plek}" data-value="${this.fx.leesPlek(plek) ?? 0}"></div>
        <div class="re-tegel-tekst">
          <span class="re-tegel-naam"><span class="re-tegel-nr">${plek}</span> ${esc(m.label || `knop ${plek}`)}</span>
          <span class="re-wat" data-wat="${plek}">${esc(this._beschrijf(m))}</span>
        </div>
        <output class="re-live"></output>
      </div>`;
    }).join('');
    this.plekKnoppen = [...this.el.plekken.querySelectorAll('.re-tegel:not(.leeg)')].map((t) => ({
      plek: Number(t.dataset.plek), knob: new Knob(t.querySelector('.knob')), uit: t.querySelector('.re-live'),
    }));
  }

  /** Alleen de regels "wat doet hij" bijwerken, zonder knoppen opnieuw te maken. */
  _tekenBeschrijvingen() {
    for (const el of this.el.plekken.querySelectorAll('[data-wat]')) {
      const m = this._macro(Number(el.dataset.wat));
      if (m) el.textContent = this._beschrijf(m);
    }
  }

  _tekenKeten() {
    const keten = this.kopie.chain;
    const kaarten = keten.map((n, i) => {
      const eff = this.effecten.find((x) => x.id === n.type);
      const params = (eff?.params || []).map((p) => {
        const { plekken, wint } = this.fx.stuurders(n.slot, p);
        const gestuurd = wint !== null;
        // Tijdens DICHT/OPEN mag je alles draaien wat deze knop stuurt of wat
        // vrij is. Wat een ANDERE knop wint, blijft vast: daar draaien zou
        // niets hoorbaars doen.
        const neemtOp = !!this.modus && (!gestuurd || wint === this.modus.plek);
        const vast = gestuurd && !neemtOp;
        const badges = plekken.map((k) => `<button class="re-badge${k === wint ? '' : ' verliest'}" data-doe="kies" data-plek="${k}"
          title="${k === wint ? `gestuurd door knop ${k}` : `knop ${k} stuurt dit ook, maar knop ${wint} wint`}">${k}</button>`).join('');
        const titel = neemtOp ? `draai: wordt de ${this.modus.kant === 'dicht' ? 'DICHTE' : 'OPEN'} stand van knop ${this.modus.plek}`
          : vast ? `gestuurd door knop ${wint} — draai aan die knop` : 'draai om in te stellen';
        return `<div class="re-param${gestuurd ? ' gestuurd' : ''}${vast ? ' vast' : ''}${neemtOp ? ' neemt-op' : ''}"
            data-slot="${esc(n.slot)}" data-param="${esc(p)}" title="${titel}">
          <div class="knob sm" data-value="${this.fx.paramWaarde(n.slot, p)}"${eff.bipolair?.includes(p) ? ' data-bipolar="true"' : ''}></div>
          <span class="re-pnaam">${esc(p)}</span>
          <output class="re-pwaarde"></output>
          <span class="re-badges">${badges}</span>
        </div>`;
      }).join('');
      return `<div class="re-kaart${n.bypass ? ' uit' : ''}">
        <div class="re-kaart-kop">
          <span class="re-effect">${esc(this._slotNaam(n.slot))}${eff ? '' : ' <i>(onbekend)</i>'}</span>
          <button class="btn sm" data-doe="aanuit" data-i="${i}" title="${n.bypass ? 'effect aanzetten' : 'effect overslaan'}">${n.bypass ? 'aan' : 'uit'}</button>
          <button class="btn sm" data-doe="omhoog" data-i="${i}"${i === 0 ? ' disabled' : ''} title="eerder in de keten">←</button>
          <button class="btn sm" data-doe="omlaag" data-i="${i}"${i === keten.length - 1 ? ' disabled' : ''} title="later in de keten">→</button>
          <button class="btn sm re-weg" data-doe="weg" data-i="${i}" title="effect weghalen">×</button>
        </div>
        <div class="re-params">${params || '<span class="re-leeg">onbekend effect: blijft bewaard, klinkt niet</span>'}</div>
      </div>`;
    }).join('<span class="re-pijl">→</span>');
    const kiezer = `<select data-doe="effect-erbij"><option value="">+ effect…</option>`
      + this.effecten.map((e) => `<option value="${e.id}">${esc(e.naam)}</option>`).join('') + '</select>';
    const uitleg = this.modus
      ? `<b class="re-neemop">knop ${this.modus.plek} staat ${this.modus.kant === 'dicht' ? 'DICHT' : 'OPEN'} — wat je hier draait wordt die stand</b>`
      : '<i>— het geluid gaat van links naar rechts; draai om in te stellen</i>';
    this.el.keten.classList.toggle('neemt-op', !!this.modus);
    this.el.keten.innerHTML = `<div class="re-kop">Keten ${uitleg}</div>
      <div class="re-kaarten">${kaarten || '<span class="re-leeg">nog geen effecten</span>'}${kiezer}</div>`;

    this.paramKnoppen = [...this.el.keten.querySelectorAll('.re-param')].map((el) => {
      const slot = el.dataset.slot, param = el.dataset.param;
      const knob = new Knob(el.querySelector('.knob'));
      const vast = el.classList.contains('vast');
      if (el.classList.contains('neemt-op')) knob.onChange = (v) => this._neemOp(slot, param, v);
      else if (!vast && !el.classList.contains('gestuurd')) knob.onChange = (v) => this._paramGedraaid(slot, param, v);
      const type = this.kopie.chain.find((n) => n.slot === slot)?.type;
      // Een gestuurde parameter buiten DICHT/OPEN is ook vast: de knop wint.
      return { slot, param, type, knob, vast: vast || (!knob.onChange), uit: el.querySelector('.re-pwaarde') };
    });
  }

  /** Rechts: de gekozen knop. DICHT en OPEN bovenaan, de getallen achter "meer". */
  _tekenMacros() {
    const plek = this.gekozen;
    const m = this._macro(plek);
    const doelen = this.fx.doelen();
    if (!m) {
      this.el.macros.innerHTML = `<div class="re-kop">Knop ${plek}</div>
        <p class="re-leeg">Deze knop is vrij.</p>
        <button class="btn sm" data-doe="plek-erbij" data-plek="${plek}"${doelen.length ? '' : ' disabled title="voeg eerst een effect toe"'}>knop ${plek} gebruiken</button>`;
      return;
    }
    const schuif = (doe, link, waarde, titel, tekst) =>
      `<label class="re-schuif" data-doe="${doe}" data-plek="${plek}" data-link="${link}">
        <span>${titel}</span>
        <input type="range" min="0" max="1" step="0.01" value="${waarde}">
        <output>${esc(tekst)}</output>
      </label>`;
    const mod = this.modus?.plek === plek ? this.modus.kant : null;

    const links = m.links.map((x, l) => {
      const param = x.target.slice(x.target.indexOf('.') + 1);
      const type = this._typeVan(x.target);
      const [in0, in1] = x.in || [0, 1];
      const opties = doelen.map((d) =>
        `<option value="${esc(d.target)}"${d.target === x.target ? ' selected' : ''}>${esc(this._doelNaam(d.target))}${d.uit ? ' (staat uit)' : ''}</option>`).join('');
      const curves = CURVES.map((c) =>
        `<option value="${c}"${(x.curve || 'lin') === c ? ' selected' : ''}>${CURVENAAM[c]}</option>`).join('');
      const open = this.meerOpen.has(`${plek}:${l}`);
      const afwijkend = (x.curve && x.curve !== 'lin') || in0 !== 0 || in1 !== 1;
      return `<div class="re-link">
        <div class="re-link-kop">
          <b>${esc(this._doelNaam(x.target))}</b>
          <span class="re-kantwaarde${mod === 'dicht' ? ' actief' : ''}" title="bij knop dicht">${esc(toonWaarde(type, param, x.from ?? 0, this._leesVan(x.target)))}</span>
          <span class="re-pijl">→</span>
          <span class="re-kantwaarde${mod === 'open' ? ' actief' : ''}" title="bij knop open">${esc(toonWaarde(type, param, x.to ?? 1, this._leesVan(x.target)))}</span>
          <button class="link re-meer" data-doe="meer" data-plek="${plek}" data-link="${l}" title="precies instellen">${open ? '▾' : '▸'}${afwijkend && !open ? '•' : ''}</button>
          <button class="btn sm re-weg" data-doe="link-weg" data-plek="${plek}" data-link="${l}" title="niet meer sturen">×</button>
        </div>
        ${open ? `<div class="re-meer-vak">
          <label class="re-schuif"><span>stuurt</span>
            <select data-doe="doel" data-plek="${plek}" data-link="${l}">${opties}</select></label>
          ${schuif('van', l, x.from ?? 0, 'knop dicht', toonWaarde(type, param, x.from ?? 0, this._leesVan(x.target)))}
          ${schuif('tot', l, x.to ?? 1, 'knop open', toonWaarde(type, param, x.to ?? 1, this._leesVan(x.target)))}
          ${schuif('in0', l, in0, 'begint bij knopstand', pct(in0))}
          ${schuif('in1', l, in1, 'klaar bij knopstand', pct(in1))}
          <label class="re-schuif"><span>verloop</span>
            <select data-doe="curve" data-plek="${plek}" data-link="${l}">${curves}</select></label>
        </div>` : ''}
      </div>`;
    }).join('');

    const uitleg = mod
      ? `Knop ${plek} staat <b>${mod === 'dicht' ? 'DICHT' : 'OPEN'}</b>. Draai aan de effecten tot het klinkt zoals het moet bij een ${mod === 'dicht' ? 'dichte' : 'open'} knop. Klik nog eens om te stoppen.`
      : 'Klik DICHT of OPEN en draai aan de effecten: zo moet het klinken als de knop dicht of open staat.';

    this.el.macros.innerHTML = `<div class="re-plek-kop">
        <span class="re-kop">Knop ${plek}</span>
        <input class="re-label" data-doe="label" data-plek="${plek}" value="${esc(m.label)}" placeholder="naam, bv. Oplossen">
        <button class="btn sm re-weg" data-doe="plek-weg" data-plek="${plek}" title="knop ${plek} vrijmaken">×</button>
      </div>
      <div class="re-scene">
        <button class="re-kant${mod === 'dicht' ? ' aan' : ''}" data-doe="kant" data-kant="dicht">DICHT</button>
        <button class="re-kant${mod === 'open' ? ' aan' : ''}" data-doe="kant" data-kant="open">OPEN</button>
      </div>
      <p class="re-uitleg${mod ? ' actief' : ''}">${uitleg}</p>
      ${schuif('default', -1, m.default ?? 0, 'startstand', pct(m.default ?? 0))}
      ${schuif('glide', -1, glideNaarSchuif(m.glide || 0), 'glijden', glideTekst(m.glide || 0))}
      <div class="re-kop re-verandert">Wat knop ${plek} verandert</div>
      ${links || '<p class="re-leeg">Nog niets. Klik DICHT of OPEN en draai aan een effect.</p>'}`;
  }
}
