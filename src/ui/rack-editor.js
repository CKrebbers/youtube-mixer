import { CURVES, neemOp, muteer, pasCurve, pasKromme, isPlekDoel, isModDoel, MAX_MODS, MAX_DOELEN } from '../engine/rack.js';
import { esc, pct } from './dom.js';
import { toonWaarde, effectVan } from '../engine/fx.js';
import { MOD_SOORTEN, MOD_VORMEN, STAPPEN_MAX, MOD_HZ_MIN, MOD_HZ_MAX } from '../engine/modulatie.js';
import { LFO_DELINGEN } from '../engine/fx-lfo.js';
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
 *
 * Spoor S10 (docs/EFFECTEN-MEER.md) voegt toe:
 *   - per effect "∥": droog/nat van dat ene effect (een knop `nat` op de kaart);
 *   - per effect "kopie", en "plak" in de kiezer (ook naar een ander rack of een andere track);
 *   - een knop kan een andere knop sturen of de diepte van een modulator (in "stuurt");
 *   - "eigen kromme" in "meer": vijf punten om met de muis te trekken;
 *   - MODULATORS onder de keten: lfo, stappen, volger, toeval, op de klok of de maat;
 *   - A/B vergelijken, muteren en willekeurig (met zaad: hetzelfde getal = hetzelfde rack),
 *     en "als sjabloon" bewaren (of een eigen sjabloon wissen) via callbacks.
 */

/** Wat "kopie" op een effect onthoudt, voor "plak" in elk rack (ook na herladen, in deze browser). */
const KLEMBORD = 'varve.rack.klembord';
const leesKlembord = () => { try { return JSON.parse(localStorage.getItem(KLEMBORD) || 'null'); } catch (_) { return null; } };
const schrijfKlembord = (v) => { try { localStorage.setItem(KLEMBORD, JSON.stringify(v)); } catch (_) {} };
const MOD_NAAM = { lfo: 'LFO', stap: 'stappen', volger: 'volger', toeval: 'toeval' };
/** Een nieuwe modulator van een soort, met de diepte en doelen van de vorige (bij wisselen van soort). */
const nieuweMod = (soort, oud = {}) => ({
  soort, diepte: oud.diepte ?? 0.5, doelen: oud.doelen ?? [],
  ...(soort === 'lfo' ? { vorm: 'sinus', sync: true, deling: '1/1', hz: 0.5 } : {}),
  ...(soort === 'stap' ? { deling: '1/16', stappen: [1, 0, 0.5, 0, 1, 0, 0.75, 0.25], glad: 0.1 } : {}),
  ...(soort === 'toeval' ? { sync: true, deling: '1/4', hz: 2, zaad: 1, glad: 0 } : {}),
  ...(soort === 'volger' ? { aanzet: 0.01, verval: 0.3, gevoel: 0.5 } : {}),
});
const hzNaarSchuif = (hz) => Math.log(hz / MOD_HZ_MIN) / Math.log(MOD_HZ_MAX / MOD_HZ_MIN);
const schuifNaarHz = (v) => MOD_HZ_MIN * Math.pow(MOD_HZ_MAX / MOD_HZ_MIN, v);
const komma = (x, n) => x.toFixed(n).replace('.', ',');

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
    trackVan = () => 1, kanBewaren = () => true,
    onBewaarSjabloon = null, onWisSjabloon = null, eigenSjabloon = () => null, eigenNamen = () => [] }) {
    this.eigenNamen = eigenNamen;
    this.onBewaarSjabloon = onBewaarSjabloon;
    this.onWisSjabloon = onWisSjabloon;
    this.eigenSjabloon = eigenSjabloon;
    this.ab = null;                  // { A, B, kant } zolang je vergelijkt (S10)
    this.zaad = 1;
    this.modMeters = [];
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
      mods: root.querySelector('.re-mods'),
      extra: root.querySelector('.re-extra'),
    };
    if (this.el.extra) {
      this.el.extra.innerHTML = `<button class="btn sm" data-doe="ab" data-kant="A" title="vergelijken: stand A (wat je had)">A</button>`
        + `<button class="btn sm" data-doe="ab" data-kant="B" title="vergelijken: stand B (een kopie om mee te spelen)">B</button>`
        + `<button class="btn sm" data-doe="muteer" title="alle parameters en de open kanten een beetje anders (het zaad ernaast; nog eens = een andere)">muteer</button>`
        + `<button class="btn sm" data-doe="willekeurig" title="alle parameters en de open kanten willekeurig (de filterfrequentie en de knoppen zelf blijven)">willekeurig</button>`
        + `<label class="re-zaad" title="hetzelfde zaad = hetzelfde resultaat">zaad <input type="number" min="1" max="999999" step="1" data-doe="zaad" value="1"></label>`
        + `<button class="btn sm" data-doe="als-sjabloon" title="bewaren als eigen sjabloon (voor elk nummer te kiezen); een andere naam = een kopie">als sjabloon</button>`
        + `<button class="btn sm re-weg" data-doe="wis-sjabloon" title="dit eigen sjabloon wissen (wat er klinkt blijft)" hidden>wis sjabloon</button>`;
    }

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
      // Een ander rack van buiten (kiezer, APC): A/B begint opnieuw.
      if (this.fx.rack !== this._rackRef) { this.ab = null; this.openVoor(this.deckId); return; }
      this._controleerModus();
    }, 200);
  }

  get open() { return !this.root.classList.contains('hidden'); }
  get fx() { return this.deckId ? this.engine.deck(this.deckId).fx : null; }

  openVoor(deckId) {
    this.onOpen?.();                 // de app sluit dan de andere onderpanelen
    const zelfde = deckId === this.deckId;
    // Naar een andere track: de knop die op de oude op 0 of 1 stond, eerst
    // terug. Anders bleef die track op DICHT of OPEN hangen. Zelfde track met
    // een ander rack: dat rack begint toch op zijn eigen standen.
    if (this.modus && !zelfde && this.deckId) this._uitModus({ tekenen: false });
    this.modus = null;
    if (!zelfde) this.ab = null;
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
    // Koppeling verdwenen omdat beide kanten gelijk werden: de parameter houdt die waarde als eigen
    // stand, anders verspringt hij. EERST zetten, dan pas de macro's: anders zette _herstelLos hem
    // even terug op de oude eigen stand (bij de delay een kopwissel naar de verkeerde tijd).
    if (r.weg) this._paramGedraaid(slot, param, r.basis);
    const { fouten } = this.fx.bewerkMacros(this.kopie.macros);
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
      if (this.modMeters.length) {
        const st = fx.modStanden();
        for (let i = 0; i < this.modMeters.length; i++) {
          const el = this.modMeters[i], w = st[i]?.waarde ?? 0;
          const t = `scaleX(${Math.max(-1, Math.min(1, w)).toFixed(3)})`;
          if (el.style.transform !== t) el.style.transform = t;
        }
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
    // Een knop wijst nu naar het droog/nat van een effect dat dat pad nog niet heeft: keten opnieuw.
    if (this.fx.natOntbreekt()) { this._ketenGewijzigd(); return; }
    this._fouten(fouten);
    if (tekenen) this.teken();
    else { this._tekenStatus(); this._tekenBeschrijvingen(); }
  }

  /** Modulators veranderd (S10): geen nieuwe keten, tenzij een doel een droog/nat-pad vraagt. */
  _modsGewijzigd({ tekenen = true, kaart = null } = {}) {
    const { fouten, opnieuw } = this.fx.bewerkMods(this.kopie.mods || [], { kaart });
    if (opnieuw) { this._ketenGewijzigd(); return; }
    this._fouten(fouten);
    this._tekenStatus();
    if (tekenen) this._tekenMods();
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
    if (isPlekDoel(target)) { const k = Number(target.slice(5)); return `knop ${k}${this._macro(k)?.label ? ` (${this._macro(k).label})` : ''}`; }
    if (isModDoel(target)) return `diepte M${target.split('.')[1]}`;
    const punt = target.indexOf('.');
    const param = target.slice(punt + 1);
    return `${this._slotNaam(target.slice(0, punt))} ${param === '_nat' ? 'nat' : param}`;
  }

  /** Alles waar een knop (vanPlek) of een modulator naar kan wijzen (S10): keten, nat, knoppen, dieptes. */
  _alleDoelen(vanPlek = null, vanMod = null) {
    const uit = this.fx.doelen().filter((d) => d.param !== '_nat' || this.kopie.chain.find((n) => n.slot === d.slot)?.meng !== undefined)
      .map((d) => ({ target: d.target, naam: this._doelNaam(d.target) + (d.uit ? ' (staat uit)' : '') }));
    for (const m of this.kopie.macros) if (m.place !== vanPlek) uit.push({ target: `plek.${m.place}`, naam: this._doelNaam(`plek.${m.place}`) });
    (this.kopie.mods || []).forEach((_, i) => { if (i !== vanMod) uit.push({ target: `mod.${i + 1}.diepte`, naam: this._doelNaam(`mod.${i + 1}.diepte`) }); });
    return uit;
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
    // Niet het droog/nat van een effect (S10): dat haalde een effect half weg bij "link erbij".
    const doelen = this.fx.doelen().filter((d) => !d.uit && d.soort !== 'nat');
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
    if (this._klikS10(doe, k)) return;
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
      for (const m of this.kopie.mods || []) if (Array.isArray(m?.doelen)) m.doelen = m.doelen.filter((x) => typeof x?.target !== 'string' || !x.target.startsWith(slot + '.'));
      // Een knop die ALLEEN dit effect stuurde doet nu niets meer: die gaat mee (S10: een nieuw rack
      // begint zo met acht vrije knoppen als je het standaardeffect weghaalt).
      const leeg = this.kopie.macros.filter((m) => geraakt.includes(m.place) && !m.links.length).map((m) => m.place);
      this.kopie.macros = this.kopie.macros.filter((m) => !leeg.includes(m.place));
      for (const m of this.kopie.macros) m.links = m.links.filter((x) => !isPlekDoel(x.target) || !leeg.includes(Number(x.target.slice(5))));
      if (!this._macro(this.gekozen)) this.gekozen = this.kopie.macros[0]?.place ?? 1;
      this._ketenGewijzigd();
      const rest = geraakt.filter((p) => !leeg.includes(p));
      if (geraakt.length) {
        this.melding = { tekst: [leeg.length ? `knop ${leeg.join(', ')} stuurde alleen dit effect en is weg` : '',
          rest.length ? `knop ${rest.join(', ')} stuurde dit effect ook aan en is daar nu vanaf` : ''].filter(Boolean).join(' · '), goed: false };
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

    if (this._wijzigS10(doe, k)) return;
    if (doe === 'effect-erbij' && k.value === 'plak') {
      const kb = leesKlembord();
      k.value = '';
      if (!kb?.type) return;
      this.kopie.chain.push({ ...JSON.parse(JSON.stringify(kb)), slot: this._vrijSlot(), bypass: false });
      this._ketenGewijzigd();
      this.melding = { tekst: `${this.effecten.find((x) => x.id === kb.type)?.naam ?? kb.type} geplakt, met zijn instellingen (zonder knoppen)`, goed: true };
      this._tekenStatus();
      return;
    }
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
    else if (doe === 'curve') {
      const link = m.links[l];
      if (k.value === 'eigen') {
        // Vijf punten op de curve die er stond: dan verandert er bijna niets (een rechte tussen de punten: tot 0,035 naast s).
        link.kromme = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(pasCurve(t, link.curve) * 1000) / 1000);
        delete link.curve;
      } else { delete link.kromme; link.curve = k.value; }
      this._macrosGewijzigd();
    }
    else if (doe === 'label') { m.label = k.value; this._macrosGewijzigd({ tekenen: false }); this._tekenPlekken(); }
  }

  /** Schuiven: getallen bijwerken, NIET opnieuw tekenen. */
  _schuif(e) {
    const k = this._knoop(e);
    if (!k || !this.kopie || e.target.type !== 'range') return;
    if (this._schuifS10(k, e.target)) return;
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
    if (param === '_nat') { node.meng = v; this.fx.zetParam(slot, '_nat', v); return; }
    node.params = { ...(node.params || {}), [param]: v };
    this.fx.zetParam(slot, param, v);
  }

  /** Een vrije slotletter in de kopie. */
  _vrijSlot() {
    const gebruikt = new Set(this.kopie.chain.map((n) => n.slot));
    for (let c = 97; c < 123; c++) { const x = String.fromCharCode(c); if (!gebruikt.has(x)) return x; }
    return `s${this.kopie.chain.length}`;
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
    this._tekenMods();
    this._tekenExtra();
  }

  /** De knoppen bovenaan (S10): welke kant van A/B, en of er een eigen sjabloon te wissen is. */
  _tekenExtra() {
    if (!this.el.extra) return;
    for (const b of this.el.extra.querySelectorAll('[data-doe="ab"]')) b.classList.toggle('aan', !!this.ab && this.ab.kant === b.dataset.kant);
    const zaad = this.el.extra.querySelector('[data-doe="zaad"]');
    if (zaad && document.activeElement !== zaad) zaad.value = String(this.zaad);
    const wis = this.el.extra.querySelector('[data-doe="wis-sjabloon"]');
    if (wis) wis.hidden = !this.onWisSjabloon || !this.eigenSjabloon(this.deckId);
    const als = this.el.extra.querySelector('[data-doe="als-sjabloon"]');
    if (als) als.hidden = !this.onBewaarSjabloon;
  }

  _tekenStatus() {
    if (!this.melding) {
      const n = this.kopie.macros.length;
      const m = (this.kopie.mods || []).length;
      this.el.status.innerHTML = (this.kopie.uitleg ? `<span class="re-sjabloon-uitleg">${esc(this.kopie.uitleg)}</span><br>` : '')
        + `${this.kopie.chain.length} effect${this.kopie.chain.length === 1 ? '' : 'en'}`
        + ` · ${n} van 8 knoppen in gebruik${m ? ` · ${m} modulator${m === 1 ? '' : 's'}` : ''}`
        + `${this.ab ? ` · je vergelijkt: ${this.ab.kant}` : ''} · wat je verandert hoor je meteen`;
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
        <div class="knob sm" data-action="track.${nr}.fx.knob.${plek}" data-value="${this.fx.leesPlek(plek) ?? 0}"></div>
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
      }).join('') + (eff && n.meng !== undefined ? this._natParam(n) : '');
      // Een onbekend effect klinkt nooit (bouwKeten slaat het over), ook als
      // zijn eigen bypass false is: die bewaart rack.js alleen voor later.
      return `<div class="re-kaart${n.bypass || !eff ? ' uit' : ''}">
        <div class="re-kaart-kop">
          <span class="re-effect">${esc(this._slotNaam(n.slot))}${eff ? '' : ' <i>(onbekend)</i>'}</span>
          <button class="btn sm" data-doe="aanuit" data-i="${i}" title="${n.bypass ? 'effect aanzetten' : 'effect overslaan'}">${n.bypass ? 'aan' : 'uit'}</button>
          <button class="btn sm" data-doe="omhoog" data-i="${i}"${i === 0 ? ' disabled' : ''} title="eerder in de keten">←</button>
          <button class="btn sm" data-doe="omlaag" data-i="${i}"${i === keten.length - 1 ? ' disabled' : ''} title="later in de keten">→</button>
          ${eff ? `<button class="btn sm${n.meng !== undefined ? ' aan' : ''}" data-doe="parallel" data-i="${i}" title="${n.meng !== undefined ? 'droog/nat van dit effect weghalen (helemaal in de keten)' : 'droog/nat voor dit ene effect: een knop "nat" erbij'}">∥</button>` : ''}
          <button class="btn sm" data-doe="kopieer" data-i="${i}" title="dit effect met zijn instellingen onthouden, om in een ander rack te plakken">kopie</button>
          <button class="btn sm re-weg" data-doe="weg" data-i="${i}" title="effect weghalen">×</button>
        </div>
        <div class="re-params">${params || '<span class="re-leeg">onbekend effect: blijft bewaard, klinkt niet</span>'}</div>
      </div>`;
    }).join('<span class="re-pijl">→</span>');
    const kb = leesKlembord();
    const kiezer = `<select data-doe="effect-erbij"><option value="">+ effect…</option>`
      + (kb?.type ? `<option value="plak">plak: ${esc(this.effecten.find((e) => e.id === kb.type)?.naam ?? kb.type)}</option>` : '')
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

  /** De knop "nat" van één effect (S10): zoals een parameter, met de badges van de knoppen die hem sturen. */
  _natParam(n) {
    const { plekken, wint } = this.fx.stuurders(n.slot, '_nat');
    const gestuurd = wint !== null;
    const neemtOp = !!this.modus && (!gestuurd || wint === this.modus.plek);
    const vast = gestuurd && !neemtOp;
    const badges = plekken.map((k) => `<button class="re-badge${k === wint ? '' : ' verliest'}" data-doe="kies" data-plek="${k}">${k}</button>`).join('');
    return `<div class="re-param nat${gestuurd ? ' gestuurd' : ''}${vast ? ' vast' : ''}${neemtOp ? ' neemt-op' : ''}" data-slot="${esc(n.slot)}" data-param="_nat"
        title="hoeveel van dit effect je hoort (droog/nat van alleen dit effect)">
      <div class="knob sm" data-value="${this.fx.paramWaarde(n.slot, '_nat')}"></div>
      <span class="re-pnaam">nat</span>
      <output class="re-pwaarde"></output>
      <span class="re-badges">${badges}</span>
    </div>`;
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

    const alle = this._alleDoelen(plek);
    const links = m.links.map((x, l) => {
      const param = x.target.slice(x.target.indexOf('.') + 1);
      const type = this._typeVan(x.target);
      const [in0, in1] = x.in || [0, 1];
      const opties = alle.map((d) =>
        `<option value="${esc(d.target)}"${d.target === x.target ? ' selected' : ''}>${esc(d.naam)}</option>`).join('');
      const curves = CURVES.map((c) =>
        `<option value="${c}"${!x.kromme && (x.curve || 'lin') === c ? ' selected' : ''}>${CURVENAAM[c]}</option>`).join('')
        + `<option value="eigen"${x.kromme ? ' selected' : ''}>eigen kromme (trek met de muis)</option>`;
      const open = this.meerOpen.has(`${plek}:${l}`);
      const afwijkend = (x.curve && x.curve !== 'lin') || x.kromme || in0 !== 0 || in1 !== 1;
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
          ${x.kromme ? `<canvas class="re-kromme" width="200" height="72" data-plek="${plek}" data-link="${l}" title="sleep de punten: links = knop dicht, rechts = knop open"></canvas>` : ''}
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
    for (const c of this.el.macros.querySelectorAll('canvas.re-kromme')) this._kromme(c);
  }

  // ---- eigen kromme (S10) ------------------------------------------------------

  /** Een kromme om met de muis te trekken. Tekent alleen zijn eigen canvas, ook tijdens het slepen. */
  _kromme(canvas) {
    const plek = Number(canvas.dataset.plek), l = Number(canvas.dataset.link);
    const link = () => this._macro(plek)?.links[l];
    const W = canvas.width, H = canvas.height, R = 4;
    const xVan = (i, n) => R + (W - 2 * R) * i / (n - 1);
    const yVan = (v) => H - R - (H - 2 * R) * v;
    const teken = () => {
      const k = link()?.kromme;
      const g = canvas.getContext('2d');
      if (!k || !g) return;
      g.clearRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.12)';
      g.beginPath(); g.moveTo(R, yVan(0)); g.lineTo(W - R, yVan(1)); g.stroke();
      g.strokeStyle = '#3fd0b6'; g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= W - 2 * R; x += 2) { const y = yVan(pasKromme(x / (W - 2 * R), k)); if (x === 0) g.moveTo(R + x, y); else g.lineTo(R + x, y); }
      g.stroke();
      g.fillStyle = '#ffbe3c';
      k.forEach((v, i) => { g.beginPath(); g.arc(xVan(i, k.length), yVan(v), R, 0, Math.PI * 2); g.fill(); });
    };
    let vak = null, punt = -1;
    const zet = (e) => {
      const k = link()?.kromme;
      if (!k || !vak) return;
      const x = (e.clientX - vak.left) / vak.width * W, y = (e.clientY - vak.top) / vak.height * H;
      if (punt < 0) punt = Math.max(0, Math.min(k.length - 1, Math.round((x - R) / (W - 2 * R) * (k.length - 1))));
      k[punt] = Math.round(Math.max(0, Math.min(1, (H - R - y) / (H - 2 * R))) * 1000) / 1000;
      this.fx.bewerkMacros(this.kopie.macros);     // alleen getallen: geen node, geen nieuwe keten
      teken();
    };
    canvas.addEventListener('pointerdown', (e) => {
      vak = canvas.getBoundingClientRect();         // één keer per greep, niet per beweging
      punt = -1;
      canvas.setPointerCapture?.(e.pointerId);
      zet(e);
    });
    canvas.addEventListener('pointermove', (e) => { if (vak) zet(e); });
    const los = () => { if (!vak) return; vak = null; this._tekenBeschrijvingen(); };
    canvas.addEventListener('pointerup', los);
    canvas.addEventListener('pointercancel', los);
    teken();
  }

  // ---- modulators (S10) -----------------------------------------------------------

  _tekenMods() {
    if (!this.el.mods) return;
    const mods = this.kopie.mods || [];
    const delingen = (m, i) => `<select data-doe="mod-deling" data-mod="${i}">${LFO_DELINGEN.map((d) => `<option${d.id === m.deling ? ' selected' : ''}>${d.id}</option>`).join('')}</select>`;
    const schuif = (doe, i, waarde, titel, tekst, { min = 0, max = 1, d = '' } = {}) =>
      `<label class="re-schuif" data-doe="${doe}" data-mod="${i}"${d !== '' ? ` data-d="${d}"` : ''}><span>${titel}</span>
        <input type="range" min="${min}" max="${max}" step="0.01" value="${waarde}"><output>${esc(tekst)}</output></label>`;
    const kaarten = mods.map((m, i) => {
      if (!MOD_SOORTEN.includes(m?.soort)) {
        return `<div class="re-mod"><div class="re-mod-kop"><b>M${i + 1}</b> <i>onbekende soort "${esc(String(m?.soort))}": blijft bewaard, doet niets</i>
          <button class="btn sm re-weg" data-doe="mod-weg" data-mod="${i}">×</button></div></div>`;
      }
      const soorten = MOD_SOORTEN.map((x) => `<option value="${x}"${x === m.soort ? ' selected' : ''}>${MOD_NAAM[x]}</option>`).join('');
      let velden = '';
      const klok = m.soort === 'stap' ? delingen(m, i)
        : `<label class="re-zaad"><input type="checkbox" data-doe="mod-sync" data-mod="${i}"${m.sync !== false ? ' checked' : ''}> op de maat</label>`
          + (m.sync !== false ? delingen(m, i) : schuif('mod-hz', i, hzNaarSchuif(m.hz ?? 0.5), 'snelheid', `${komma(m.hz ?? 0.5, 2)} Hz`));
      if (m.soort === 'lfo') velden = `<select data-doe="mod-vorm" data-mod="${i}">${MOD_VORMEN.map((v) => `<option${v === (m.vorm ?? 'sinus') ? ' selected' : ''}>${v}</option>`).join('')}</select>${klok}`;
      else if (m.soort === 'stap') {
        const st = m.stappen ?? [];
        velden = `${klok}<select data-doe="mod-aantal" data-mod="${i}" title="aantal stappen">${Array.from({ length: STAPPEN_MAX }, (_, n) => `<option${n + 1 === st.length ? ' selected' : ''}>${n + 1}</option>`).join('')}</select>
          <span class="re-stappen">${st.map((v, j) => `<button class="re-stap" data-doe="stap" data-mod="${i}" data-i="${j}" title="klik: 0 → ½ → 1"><span style="height:${Math.round(v * 100)}%"></span></button>`).join('')}</span>
          ${schuif('mod-glad', i, m.glad ?? 0, 'glad', pct(m.glad ?? 0))}`;
      } else if (m.soort === 'toeval') {
        velden = `${klok}<label class="re-zaad">zaad <input type="number" min="1" max="999999" data-doe="mod-zaad" data-mod="${i}" value="${m.zaad ?? 1}"></label>${schuif('mod-glad', i, m.glad ?? 0, 'glad', pct(m.glad ?? 0))}`;
      } else if (m.soort === 'volger') {
        velden = schuif('mod-aanzet', i, Math.log((m.aanzet ?? 0.01) / 0.001) / Math.log(1000), 'aanzet', `${Math.round((m.aanzet ?? 0.01) * 1000)} ms`)
          + schuif('mod-verval', i, Math.log((m.verval ?? 0.3) / 0.01) / Math.log(400), 'verval', `${Math.round((m.verval ?? 0.3) * 1000)} ms`)
          + schuif('mod-gevoel', i, m.gevoel ?? 0.5, 'gevoel', pct(m.gevoel ?? 0.5));
      }
      const alle = this._alleDoelen(null, i);
      const doelen = (m.doelen || []).map((d, j) => `<div class="re-mod-doel">
          <select data-doe="mod-doel" data-mod="${i}" data-d="${j}">${alle.map((x) => `<option value="${esc(x.target)}"${x.target === d.target ? ' selected' : ''}>${esc(x.naam)}</option>`).join('')}</select>
          ${schuif('mod-ddiepte', i, d.diepte ?? 0.5, 'diepte', `${Math.round((d.diepte ?? 0.5) * 100)}%`, { min: -1, d: j })}
          <button class="btn sm re-weg" data-doe="mod-doel-weg" data-mod="${i}" data-d="${j}" title="dit doel weg">×</button>
        </div>`).join('');
      return `<div class="re-mod">
        <div class="re-mod-kop"><b>M${i + 1}</b><select data-doe="mod-soort" data-mod="${i}">${soorten}</select>
          <span class="re-mod-meter" title="wat hij nu doet"><span></span></span>
          <button class="btn sm re-weg" data-doe="mod-weg" data-mod="${i}" title="modulator weg">×</button></div>
        <div class="re-mod-velden">${velden}${schuif('mod-diepte', i, m.diepte ?? 1, 'diepte', pct(m.diepte ?? 1))}</div>
        ${doelen}
        ${(m.doelen || []).length < MAX_DOELEN ? `<button class="btn sm" data-doe="mod-doel-erbij" data-mod="${i}">+ doel</button>` : ''}
      </div>`;
    }).join('');
    const erbij = mods.length < MAX_MODS
      ? `<select data-doe="mod-erbij"><option value="">+ modulator…</option>${MOD_SOORTEN.map((x) => `<option value="${x}">${MOD_NAAM[x]}</option>`).join('')}</select>` : '';
    this.el.mods.innerHTML = `<div class="re-kop">Modulators <i>— laten een knop of parameter bewegen, op de klok of de maat; de knop zelf blijft staan</i></div>${kaarten}${erbij}`;
    this.modMeters = [...this.el.mods.querySelectorAll('.re-mod-meter span')];
  }

  // ---- de handelingen van S10 ---------------------------------------------------------

  _mod(k) { return this.kopie.mods?.[Number(k.dataset.mod)] ?? null; }

  /** Klikken van spoor S10; true = afgehandeld. */
  _klikS10(doe, k) {
    const keten = this.kopie.chain;
    const i = Number(k.dataset.i);
    if (doe === 'parallel') {
      const alleenNat = !!effectVan(keten[i].type)?.alleenNat;
      if (keten[i].meng === undefined) keten[i].meng = alleenNat ? 0 : 1;
      else {
        delete keten[i].meng;
        for (const m of this.kopie.macros) m.links = m.links.filter((x) => x.target !== `${keten[i].slot}._nat`);
        for (const m of this.kopie.mods || []) if (Array.isArray(m?.doelen)) m.doelen = m.doelen.filter((x) => x?.target !== `${keten[i].slot}._nat`);
      }
      this._ketenGewijzigd();
      if (alleenNat && keten[i].meng !== undefined) {
        // De delay geeft alleen echo: met ∥ wordt "nat" een stuur en blijft het droge vol (een dub-worp).
        // Begint op 0: wat al in de echo zit rolt uit, en de knop "nat" zet de worp.
        this.melding = { tekst: 'delay met ∥: het droge blijft vol en "nat" is hoeveel er de echo in gaat (0 = niets erin, de staart rolt door)', goed: true };
        this._tekenStatus();
      }
      return true;
    }
    if (doe === 'kopieer') {
      const { slot, onbekend, _bypass, ...rest } = keten[i];
      schrijfKlembord(JSON.parse(JSON.stringify(rest)));
      this.melding = { tekst: `${this._slotNaam(slot)} onthouden: "plak" staat nu bovenaan in "+ effect…" (ook in een ander rack)`, goed: true };
      this._tekenStatus();
      this._tekenKeten();
      return true;
    }
    if (doe === 'ab') { this._ab(k.dataset.kant); return true; }
    if (doe === 'muteer' || doe === 'willekeurig') {
      this.kopie = muteer(this.kopie, { zaad: this.zaad, sterkte: doe === 'muteer' ? 0.15 : 1, effectVan });
      const was = this.zaad;
      this.zaad = this.zaad >= 999999 ? 1 : this.zaad + 1;
      this._ketenGewijzigd();
      this.melding = { tekst: `${doe === 'muteer' ? 'gemuteerd' : 'willekeurig'} met zaad ${was} (typ ${was} terug in "zaad" en druk nog eens voor hetzelfde)${this.ab ? '' : ' · tip: druk eerst B om met het oude te kunnen vergelijken'}`, goed: true };
      this._tekenStatus();
      return true;
    }
    if (doe === 'als-sjabloon') { this._alsSjabloon(); return true; }
    if (doe === 'wis-sjabloon') { this._wisSjabloon(); return true; }
    if (doe === 'stap') {
      const m = this._mod(k);
      if (!m?.stappen) return true;
      const j = Number(k.dataset.i);
      m.stappen[j] = m.stappen[j] >= 0.99 ? 0 : m.stappen[j] >= 0.49 ? 1 : 0.5;
      const bar = k.querySelector('span');
      if (bar) bar.style.height = `${Math.round(m.stappen[j] * 100)}%`;
      this._modsGewijzigd({ tekenen: false });
      return true;
    }
    if (doe === 'mod-weg') {
      const n = Number(k.dataset.mod);
      this.kopie.mods.splice(n, 1);
      // De modulators erachter schuiven een plek op en houden hun eigen stand (niet die van de weggehaalde).
      const kaart = this.kopie.mods.map((_, j) => (j < n ? j : j + 1));
      // Wat naar de diepte van een modulator wees, schuift mee (of valt weg).
      const herschrijf = (t) => {
        if (typeof t !== 'string' || !isModDoel(t)) return t;
        const j = Number(t.split('.')[1]) - 1;
        return j === n ? null : `mod.${j > n ? j : j + 1}.diepte`;
      };
      for (const m of this.kopie.macros) m.links = m.links.map((x) => ({ ...x, target: herschrijf(x.target) })).filter((x) => x.target);
      for (const m of this.kopie.mods) if (Array.isArray(m?.doelen)) m.doelen = m.doelen.map((x) => ({ ...x, target: herschrijf(x?.target) })).filter((x) => x.target);
      this._macrosGewijzigd({ tekenen: false });
      this._modsGewijzigd({ kaart });
      this._tekenMacros();
      return true;
    }
    if (doe === 'mod-doel-erbij') {
      const m = this._mod(k);
      const bezet = new Set((m.doelen || []).map((x) => x.target));
      const vrij = this._alleDoelen(null, Number(k.dataset.mod)).find((x) => !bezet.has(x.target));
      if (vrij) (m.doelen ||= []).push({ target: vrij.target, diepte: 0.3 });
      this._modsGewijzigd();
      return true;
    }
    if (doe === 'mod-doel-weg') {
      this._mod(k).doelen.splice(Number(k.dataset.d), 1);
      this._modsGewijzigd();
      return true;
    }
    return false;
  }

  /** Keuzelijsten en vinkjes van spoor S10; true = afgehandeld. */
  _wijzigS10(doe, k) {
    if (doe === 'zaad') { const z = Math.round(Number(k.value)); if (z >= 1) this.zaad = Math.min(999999, z); return true; }
    if (doe === 'mod-erbij') {
      if (k.value) {
        const m = nieuweMod(k.value);
        const eerste = this._alleDoelen().find((x) => !isModDoel(x.target));
        if (eerste) m.doelen = [{ target: eerste.target, diepte: 0.3 }];
        (this.kopie.mods ||= []).push(m);
        this._modsGewijzigd();
      }
      return true;
    }
    if (!/^mod-/.test(doe)) return false;
    const m = this._mod(k), n = Number(k.dataset.mod);
    if (!m) return true;
    if (doe === 'mod-soort') this.kopie.mods[n] = nieuweMod(k.value, m);
    else if (doe === 'mod-vorm') m.vorm = k.value;
    else if (doe === 'mod-deling') m.deling = k.value;
    else if (doe === 'mod-sync') m.sync = k.checked;
    else if (doe === 'mod-zaad') m.zaad = Math.max(1, Math.round(Number(k.value)) || 1);
    else if (doe === 'mod-aantal') {
      const st = m.stappen ?? [];
      const nieuw = Number(k.value);
      m.stappen = Array.from({ length: nieuw }, (_, j) => st[j] ?? 0);
    } else if (doe === 'mod-doel') m.doelen[Number(k.dataset.d)].target = k.value;
    else return false;
    this._modsGewijzigd();
    return true;
  }

  /** Schuiven van spoor S10 (modulators): getallen bijwerken, niet opnieuw tekenen. */
  _schuifS10(k, invoer) {
    const doe = k.dataset.doe;
    if (!/^mod-/.test(doe)) return false;
    const m = this._mod(k);
    if (!m) return true;
    const v = parseFloat(invoer.value);
    let tekst = pct(v);
    if (doe === 'mod-hz') { m.hz = schuifNaarHz(v); tekst = `${komma(m.hz, 2)} Hz`; }
    else if (doe === 'mod-glad') m.glad = v;
    else if (doe === 'mod-gevoel') m.gevoel = v;
    else if (doe === 'mod-aanzet') { m.aanzet = 0.001 * Math.pow(1000, v); tekst = `${Math.round(m.aanzet * 1000)} ms`; }
    else if (doe === 'mod-verval') { m.verval = 0.01 * Math.pow(400, v); tekst = `${Math.round(m.verval * 1000)} ms`; }
    else if (doe === 'mod-diepte') m.diepte = v;
    else if (doe === 'mod-ddiepte') { m.doelen[Number(k.dataset.d)].diepte = v; tekst = `${Math.round(v * 100)}%`; }
    const uit = k.querySelector('output');
    if (uit) uit.textContent = tekst;
    this._modsGewijzigd({ tekenen: false });
    return true;
  }

  /**
   * A/B (S10): de eerste klik bewaart wat er is als A en maakt een kopie als B; daarna wissel je
   * tussen de twee (elk houdt wat je eraan veranderde). Een ander rack laden begint opnieuw.
   */
  _ab(kant) {
    const kopie = () => JSON.parse(JSON.stringify(this.kopie));
    if (!this.ab) this.ab = { A: kopie(), B: kopie(), kant: 'B' };
    if (this.ab.kant === kant) { this._tekenExtra(); this._tekenStatus(); return; }
    this.ab[this.ab.kant] = kopie();
    this.ab.kant = kant;
    this.kopie = JSON.parse(JSON.stringify(this.ab[kant]));
    this.el.naam.value = this.kopie.name || '';
    this._ketenGewijzigd();
  }

  async _alsSjabloon() {
    if (!this.onBewaarSjabloon) return;
    const naam = (this.el.naam.value || '').trim();
    if (!naam) { this.melding = { tekst: 'geef het sjabloon eerst een naam (het veld bovenaan)', goed: false }; this._tekenStatus(); this.el.naam.focus(); return; }
    // Over een ANDER eigen sjabloon heen: eerst vragen (tweede klik binnen 3 s), zoals wissen.
    const bestaat = this.eigenNamen().includes(naam) && this.eigenSjabloon(this.deckId) !== naam;
    if (bestaat && this._zekerOver !== naam) {
      this._zekerOver = naam;
      setTimeout(() => { if (this._zekerOver === naam) this._zekerOver = null; }, 3000);
      this.melding = { tekst: `er is al een eigen sjabloon "${naam}": klik nog eens om het te vervangen (of kies een andere naam)`, goed: false };
      this._tekenStatus();
      return;
    }
    this._zekerOver = null;
    try {
      const { naam: n } = await this.onBewaarSjabloon({ deckId: this.deckId, naam });
      this._rackRef = this.fx.rack;
      this.melding = { tekst: `"${n}" bewaard als eigen sjabloon: te kiezen voor elk nummer (kiezer, rack ◀ ▶ op de APC en de iPad)`, goed: true };
    } catch (err) {
      this.melding = { tekst: `als sjabloon bewaren mislukt: ${err.message}`, goed: false };
    }
    this._tekenStatus();
    this._tekenExtra();
  }

  async _wisSjabloon() {
    const naam = this.eigenSjabloon(this.deckId);
    if (!naam || !this.onWisSjabloon) return;
    // Destructief: tweede klik binnen 3 s.
    if (this._zekerWis !== naam) {
      this._zekerWis = naam;
      setTimeout(() => { if (this._zekerWis === naam) this._zekerWis = null; }, 3000);
      this.melding = { tekst: `eigen sjabloon "${naam}" wissen? klik nog eens (wat er klinkt blijft klinken)`, goed: false };
      this._tekenStatus();
      return;
    }
    this._zekerWis = null;
    try {
      await this.onWisSjabloon(naam);
      this.melding = { tekst: `eigen sjabloon "${naam}" gewist`, goed: true };
    } catch (err) {
      this.melding = { tekst: `wissen mislukt: ${err.message}`, goed: false };
    }
    this._tekenStatus();
    this._tekenExtra();
  }
}
