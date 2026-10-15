import { Emitter } from '../lib/emitter.js';
import { normaliseerWerkruimte, samenstellen, mapjesVanDeel, delenLijst, telNieuwePlekken, bekendUitGroepen,
  DEEL_GROEPEN, STANDAARD, naamGeldig, leesMapjeSleutel } from './model.js';
import { apparaat, apparaten, aanwezigVan, bijApparaten } from './apparaten.js';
import { GROEPEN, voegMapjeToe, haalMapjeWeg, zetVolgorde } from '../control/lagen.js';

/**
 * De werkruimte in de mixer (werkruimte S3, docs/WERKRUIMTE.md C2, docs/werkruimte/S3.md):
 * welke werkruimte actief is, welk deel, wie het koos, wat er per deel onthouden is, en wat er
 * gebeurt als een apparaat wegvalt. Geen DOM: het scherm (rijen, onderpaneel) komt via `rijen`
 * en `scherm` binnen, en alles wat op het scherm hoort te veranderen gaat via `plan` (de
 * aanhaker: in het volgende beeld, niet in het MIDI-bericht).
 *
 * Een DEELWISSEL zet alleen mapjes (via de adapters, src/werk/apparaten.js), rijen, het
 * onderpaneel en het werkvak (een event). Nooit een klank: geen invoke buiten layer.* (de APC-
 * adapter drukt op kiesknoppen) en werk.* (test/werkruimte.test.mjs: bus-spion).
 *
 * Een WERKRUIMTEWISSEL haalt eerst alles van de vorige weg (fragmenten, mapjes, volgorde) en
 * zet dan de nieuwe op: stukken als fragment `stuk:<naam>`, de eigen regels als `werk:<naam>`
 * (mapping.vervangFragment, een eigen regel wint), nieuwe mapjes met lagen.voegMapjeToe.
 *
 * VEREIST/TERUGVAL: ontbreekt een apparaat dat de werkruimte vereist (bij het kiezen, of omdat
 * het wegvalt), dan geldt de terugval, met ÉÉN melding. Komt het terug, dan niet vanzelf terug:
 * één melding met een knop (en de knop op de werk-balk), want midden in een set wisselt de
 * indeling niet zonder dat jij het vraagt.
 */
export class Werkruimte extends Emitter {
  /**
   * @param mapping        de APC-mapping (fragmenten van de APC; een adapter kan zijn eigen meegeven)
   * @param herbind        herbindLagen uit actions.js (na mapjes erbij of eraf)
   * @param meld           (tekst, soort, knop?) knop = { tekst, doe() } (de melding met een knop)
   * @param rijen          { rij(naam), rijNamen() } (rijen.js)
   * @param scherm         { onderpaneel(naam, open), onderpaneelOpen(naam) }
   * @param conditie       (naam) => boolean voor focus.*, speel.*, hub (apparaat.* rekent hij zelf)
   * @param midi           de MidiHub (voor aanwezigVan zonder adapter)
   * @param haal           async (naam) => { werkruimte (ruw), versie, bron } | null
   * @param haalStuk       async (naam) => stuk-document | null
   * @param bewaar         async (naam, ruw, versie) => { ok, versie?, status, fout? }
   * @param standaarden    { apparaat: mapping-document } (vrije plekken nakijken)
   * @param plan           (fn) => void: schermwerk (standaard meteen)
   * @param basislijn      { lees(naam), zet(naam, plekken) } voor "⚠ N nieuw" (A11), of null
   * @param now            ms, voor de tweede druk van vastleggen
   */
  constructor({ mapping = null, herbind = () => {}, meld = () => {}, rijen = null, scherm = null, conditie = () => false, midi = null,
    haal = async () => null, haalStuk = async () => null, bewaar = async () => ({ ok: false, fout: 'niet bewaard' }), standaarden = {},
    plan = (fn) => fn(), basislijn = null, now = () => (globalThis.performance?.now() ?? Date.now()) } = {}) {
    super();
    Object.assign(this, { mapping, herbind, meld, rijen, scherm, conditieVan: conditie, midi, haal, haalStuk, bewaar, standaarden, plan, basislijn, now });
    this.def = normaliseerWerkruimte(STANDAARD).werkruimte;
    this.ruw = STANDAARD;
    this.naam = 'standaard';
    this.versie = null;
    this.bron = 'standaard';
    this.deel = null;
    this.door = null;
    this.onthouden = new Map();     // deel -> { apparaat: { groep: laag } } (sessietoestand, nergens bewaard)
    this.waarschuwingen = [];
    this.samenstelling = null;
    this.nieuw = { aantal: 0, sleutels: [], waarschuwing: null };
    this.terug = null;              // { naam, mag } als we in een terugval zitten (naam = wat je koos)
    this._fragmenten = [];          // [{ mapping, bron }]
    this._mapjes = [];              // [{ groep, laag }]
    this._volgorde = [];            // groepen met een eigen volgorde
    this._rijenOpen = new Set();    // rijen die een deel openzette (alleen die gaan weer dicht)
    this._onderOpen = null;
    this._laad = 0;
    this._vastleggen = null;        // tijdstip van de eerste druk
    this._nogEens = false;          // een poortwissel tijdens kies/peil: daarna controleerAanwezig
    this._peilt = false;            // een peilverzoek onderweg (nooit twee tegelijk)
    this._volgers = new Map();      // apparaat -> afmelden van zijn bij()
    for (const [id, a] of apparaten()) this._luisterNaar(id, a);
    this._afApparaten = bijApparaten((id) => { this._luisterNaar(id, apparaat(id)); this.controleerAanwezig(); });
    this._afMidi = midi?.on?.('state', () => this.controleerAanwezig()) ?? null;
  }

  // ---- lezen -------------------------------------------------------------------------------

  /** De delen in volgorde: [{ naam, nr, label, kleur }]. */
  delen() { return delenLijst(this.def); }
  deelDef(naam = this.deel) { return naam ? this.def.delen[naam] ?? null : null; }
  /** Read van werk.deel.<naam>: 1 actief, 0 niet, null bestaat niet. */
  deelStand(naam) { return this.def.delen[naam] ? (this.deel === naam ? 1 : 0) : null; }
  deelNrStand(nr) { const d = this.delen()[nr - 1]; return d ? this.deelStand(d.naam) : null; }
  get actief() { return this.delen().length > 0; }

  conditie(naam) {
    if (typeof naam === 'string' && naam.startsWith('apparaat.')) return aanwezigVan(naam.slice(9), this.midi);
    if (naam === 'hub' && this.midi?.status) return !!this.midi.status()?.hub;
    try { return !!this.conditieVan(naam); } catch (_) { return false; }
  }

  // ---- een werkruimte kiezen ---------------------------------------------------------------

  /**
   * Een werkruimte activeren op naam. `vanzelf`: bij het opstarten (een fout is dan info).
   * Geeft { naam, terugval?: true } of null als hij niet bestaat (dan blijft wat er was).
   */
  async kies(naam, { vanzelf = false, behoudDeel = false, terugVan = null } = {}) {
    const nr = ++this._laad;
    if (!naamGeldig(naam)) { this.meld(`werkruimte "${naam}": geen geldige naam`, 'fout'); return null; }
    this._bezig = true;
    try {
      let gehaald = null;
      try { gehaald = await this.haal(naam); } catch (err) { gehaald = null; this.meld(`werkruimte ${naam}: ${err?.message || err}`, vanzelf ? 'info' : 'fout'); }
      if (nr !== this._laad) return null;
      if (!gehaald?.werkruimte && naam === 'standaard') gehaald = { werkruimte: STANDAARD, versie: null, bron: 'standaard' };
      if (!gehaald?.werkruimte) {
        if (!gehaald) this.meld(`geen werkruimte "${naam}"`, vanzelf ? 'info' : 'fout');
        else this.meld(`werkruimte ${naam} is niet te lezen: ${gehaald.fouten?.[0] ?? 'kapot'}`, 'fout');
        return null;
      }
      const ruw = gehaald.werkruimte;
      // Vereist: ontbreekt er iets, dan de terugval; mist die zelf iets, dan standaard. Eén melding.
      const vereist = Array.isArray(ruw.vereist) ? ruw.vereist.filter((a) => typeof a === 'string') : [];
      const mist = vereist.filter((a) => !aanwezigVan(a, this.midi));
      if (mist.length && naam !== 'standaard') {
        const naar = !terugVan && naamGeldig(ruw.terugval) && ruw.terugval !== naam ? ruw.terugval : 'standaard';
        if (!terugVan) this.meld(`${mist.map(apparaatNaam).join(' en ')} ${mist.length > 1 ? 'zijn' : 'is'} er niet: werkruimte ${naar} in plaats van ${naam}`, 'info', 8000);
        this._bezig = false;
        const uit = await this.kies(naar, { vanzelf, behoudDeel, terugVan: terugVan ?? { naam, vereist } });
        return uit ? { ...uit, terugval: true } : null;
      }
      // De stukken, allemaal vóór we iets weghalen (zo staat er tussendoor nooit een halve indeling).
      const stukNamen = Array.isArray(ruw.stukken) ? ruw.stukken.filter((x) => naamGeldig(x)) : [];
      const stukken = {};
      await Promise.all(stukNamen.map(async (x) => { try { const d = await this.haalStuk(x); if (d) stukken[x] = d; } catch (_) {} }));
      if (nr !== this._laad) return null;
      // Eerst zeggen of dit een terugval is: wie op 'change' luistert (onthouden wat je koos) ziet het dan al.
      this.terug = terugVan ? { naam: terugVan.naam, vereist: terugVan.vereist, mag: false } : null;
      this._zetOp(naam, ruw, gehaald, stukken, { behoudDeel });
      this.emit('change', this.stand());
      return { naam };
    } finally { if (nr === this._laad) { this._bezig = false; this._klaar(); } }
  }

  /** Na kies/peil: een poortwissel die intussen kwam alsnog bekijken (in een volgende taak). */
  _klaar() {
    if (!this._nogEens) return;
    this._nogEens = false;
    Promise.resolve().then(() => { if (!this._bezig) this.controleerAanwezig(); else this._nogEens = true; });
  }

  /**
   * Synchroon: de vorige weg, de nieuwe erop.
   *
   * HERLADEN (behoudDeel: peilen, de peil na een 409, een terugval) mag je indeling niet
   * veranderen zonder dat je iets indrukt (review ronde 2). _ruimOp haalt de mapjes van de
   * werkruimte weg, en haalMapjeWeg zet een open mapje dan naar de standaard: dat gebeurt nu
   * STIL (geen volgt-melding, `_stil`), en daarna gaat per apparaat weer open wat er vóór
   * stond, als het in de nieuwe samenstelling nog bestaat. Pas als dat niet lukt (het mapje is
   * weg) of als het deel voor dat apparaat veranderde, geldt het deel.
   */
  _zetOp(naam, ruw, gehaald, stukken, { behoudDeel }) {
    const vorigDeel = this.deel;
    const vorigeDef = vorigDeel ? this.def?.delen?.[vorigDeel] ?? null : null;
    const vorigeDelen = this.def?.delen ?? {};
    const voor = behoudDeel && vorigDeel ? this._momentopname() : null;
    let s, w, werkruimte, fouten, waarschuwingen;
    const nietGebruikt = [];
    this._stil(() => {
      this._ruimOp();
      this._neemProefStukkenOver(ruw, stukken);
      const bekend = bekendUitGroepen(GROEPEN);
      ({ werkruimte, fouten, waarschuwingen } = normaliseerWerkruimte(ruw, { standaarden: this.standaarden, stukken, bekend }));
      w = werkruimte ?? normaliseerWerkruimte(STANDAARD).werkruimte;
      s = samenstellen(this.standaarden, stukken, w, { bekend });
      // Mapjes eerst (de regels verwijzen ernaar), dan de regels, dan de volgorde.
      for (const [app, a] of Object.entries(s.apparaten)) {
        const adapter = apparaat(app);
        const map = app === 'apc40mk2' ? (adapter?.mapping ?? this.mapping) : adapter?.mapping ?? null;
        for (const mj of a.mapjes) {
          if (app !== 'apc40mk2') continue;   // de Maschine zet zijn mapjes zelf (S6)
          try {
            voegMapjeToe(mj.groep, mj.laag, { naam: mj.naam, kleur: mj.kleur ?? undefined, kiesknop: mj.kiesknop });
            this._mapjes.push({ groep: mj.groep, laag: mj.laag });
          } catch (err) { s.waarschuwingen.push(`mapje ${mj.groep}.${mj.laag}: ${err?.message || err}`); }
        }
        if (map) {
          for (const f of a.fragmenten) {
            const r = map.vervangFragment(f.bron, f.doc);
            this._fragmenten.push({ mapping: map, bron: f.bron });
            if (r?.fouten?.length) nietGebruikt.push(...r.fouten);
          }
        }
        if (app === 'apc40mk2') {
          for (const [groep, lijst] of Object.entries(a.volgorde)) {
            try { zetVolgorde(groep, lijst); this._volgorde.push(groep); } catch (err) { s.waarschuwingen.push(`volgorde ${groep}: ${err?.message || err}`); }
          }
        }
      }
      this.herbind();
    });
    this.waarschuwingen = [...fouten, ...waarschuwingen, ...s.fouten, ...s.waarschuwingen.filter((x) => !waarschuwingen.includes(x))];
    if (fouten.length) this.meld(`werkruimte ${naam}: ${fouten.length} fout(en), die delen doen niets: ${fouten[0]}`, 'fout');
    if (nietGebruikt.length) {
      this.waarschuwingen.push(...nietGebruikt);
      this.meld(`werkruimte ${naam}: ${nietGebruikt.length} regel(s) kan deze VARVE nog niet (bv. ${nietGebruikt[0]})`, 'info', 8000);
    }
    this.def = w;
    this.ruw = ruw;
    this.naam = naam;
    this.versie = gehaald.versie ?? null;
    this.bron = gehaald.bron ?? null;
    this.samenstelling = s;
    // Onthouden is sessietoestand: bij een herlaad blijft hij voor de delen die niet veranderden.
    const gelijk = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (behoudDeel) { for (const d of [...this.onthouden.keys()]) if (!w.delen[d] || !gelijk(vorigeDelen[d], w.delen[d])) this.onthouden.delete(d); }
    else this.onthouden.clear();
    this.nieuw = telNieuwePlekken(this.basislijn?.lees(naam) ?? null, s);
    // Het deel: bij herladen (Claude schreef het bestand) blijft het deel staan als het er nog is.
    const start = behoudDeel && vorigDeel && w.delen[vorigDeel] ? vorigDeel : w.deel.start;
    this.deel = null;
    const herlaad = behoudDeel && start === vorigDeel;
    // Wat er vóór stond weer open (stil), per apparaat; hersteld[id] = alles staat weer.
    const hersteld = {};
    if (herlaad && voor) {
      this._stil(() => {
        for (const [id, a] of apparaten()) {
          const m = voor[id];
          if (!m) continue;
          let nu = {};
          try { nu = a.mapjes() ?? {}; } catch (_) {}
          const doel = {};
          for (const [g, l] of Object.entries(m)) if (typeof l === 'string' && nu[g] !== l) doel[g] = l;
          if (!Object.keys(doel).length) { hersteld[id] = true; continue; }
          try { const r = a.zetMapjes(doel); hersteld[id] = !r?.niet?.length; } catch (_) { hersteld[id] = false; }
        }
      });
    }
    // Herladen met hetzelfde deel: alleen de apparaten waarvoor het deel echt veranderde (of waar
    // het vorige mapje niet meer bestaat) krijgen de mapjes van het deel; de rest houdt wat je had.
    const zelfde = herlaad ? (id) => hersteld[id] !== false && gelijk(vorigeDef?.[id], w.delen[start]?.[id]) : null;
    if (start) this.kiesDeel(start, { door: herlaad ? this.door : 'start', stil: true, herlaad, sla: zelfde });
    else { this.door = null; this._planScherm(); }
  }

  /** fn() met elk apparaat stil (adapter.stil): wat er intussen wisselt is geen keuze van de gebruiker. */
  _stil(fn) {
    let f = fn;
    for (const [, a] of apparaten()) if (typeof a.stil === 'function') { const binnen = f; f = () => a.stil(binnen); }
    return f();
  }

  /**
   * Een stuk dat deze werkruimte noemt, kan er al op staan als PROEF van één pagina: S1's
   * ?uitlijn=1 (onthouden in localStorage) of S4's ?stukken=. Dan neemt de werkruimte het over:
   * eerst dat fragment en de nieuwe mapjes van dat stuk weg, anders zegt samenstellen
   * "het mapje device.uitlijn bestaat al" en doet het stuk niets (samenvoegen golf 2).
   */
  _neemProefStukkenOver(ruw, stukken) {
    const map = apparaat('apc40mk2')?.mapping ?? this.mapping;
    const namen = Array.isArray(ruw?.stukken) ? ruw.stukken : [];
    let iets = false;
    for (const naam of namen) {
      const bron = `stuk:${naam}`;
      if (typeof naam !== 'string' || !map?.extra?.has?.(bron)) continue;
      map.haalWeg(bron);
      for (const k of Object.keys(stukken?.[naam]?.mapjes?.nieuw ?? {})) {
        const m = leesMapjeSleutel(k);
        if (m && m.apparaat === 'apc40mk2') haalMapjeWeg(m.groep, m.laag);
      }
      iets = true;
    }
    if (iets) this.herbind();
  }

  /** Alles van de vorige werkruimte weg: fragmenten, mapjes, volgorde (de standaard blijft). */
  _ruimOp() {
    for (const f of this._fragmenten) f.mapping.haalWeg(f.bron);
    for (const m of this._mapjes) haalMapjeWeg(m.groep, m.laag);
    for (const g of this._volgorde) { try { zetVolgorde(g, null); } catch (_) {} }
    const iets = this._fragmenten.length || this._mapjes.length || this._volgorde.length;
    this._fragmenten = []; this._mapjes = []; this._volgorde = [];
    if (iets) this.herbind();
  }

  // ---- een deel kiezen ---------------------------------------------------------------------

  /**
   * Een deel kiezen (C2). `door`: wie het koos ("F3 · Maschine", "scherm", "APC (volgt)").
   * `vanApparaat`: de wissel komt uit volgt van dit apparaat; zijn mapjes zetten we NIET opnieuw
   * (geen lus, en wat jij net opende blijft open). Geeft false als het deel niet bestaat.
   */
  kiesDeel(naam, { door = 'scherm', vanApparaat = null, vorige = null, stil = false, herlaad = false, sla = null } = {}) {
    const d = this.def.delen[naam];
    if (!d) { if (!stil) this.meld(`geen deel "${naam}" in werkruimte ${this.naam}`, 'info'); return false; }
    if (naam === this.deel && !herlaad) {
      if (door !== this.door) { this.door = door; this.emit('change', this.stand()); }
      return true;
    }
    // Onthoud wat er nu open staat in het deel dat je verlaat (B2: deel.onthoud).
    if (this.deel && this.def.deel.onthoud) {
      const s = this._momentopname();
      if (vanApparaat && vorige && s[vanApparaat]) s[vanApparaat][vorige.groep] = vorige.vorige;   // wat er vóór jouw druk stond
      this.onthouden.set(this.deel, s);
    }
    this.deel = naam;
    this.door = door;
    const bewaard = this.onthouden.get(naam);
    for (const [id, a] of apparaten()) {
      if (id === vanApparaat || sla?.(id)) continue;
      const doel = bewaard?.[id] ?? mapjesVanDeel(d, id, (c) => this.conditie(c));
      if (!Object.keys(doel).length) continue;
      try { a.zetMapjes(doel); } catch (err) { console.warn(`[werk] ${id}.zetMapjes`, err); }
    }
    this._planScherm();
    this.emit('change', this.stand());
    return true;
  }

  kiesDeelNr(nr, opties) {
    const d = this.delen()[nr - 1];
    if (!d) { this.meld(`werkruimte ${this.naam} heeft geen deel ${nr}`, 'info'); return false; }
    return this.kiesDeel(d.naam, opties);
  }

  stapDeel(richting, opties) {
    const lijst = this.delen();
    if (!lijst.length) return false;
    const i = lijst.findIndex((d) => d.naam === this.deel);
    return this.kiesDeel(lijst[(i + richting + lijst.length) % lijst.length].naam, opties);
  }

  /**
   * THUIS (A9): deel = start, de standaardmapjes op elk apparaat, gluren en vasthouden los, en
   * wat er per deel onthouden was weg. Klank, faders en wat er speelt blijven staan.
   */
  thuis({ door = 'THUIS' } = {}) {
    this.onthouden.clear();
    for (const [id, a] of apparaten()) {
      try {
        if (a.standaard) a.standaard();
        else {
          const def = {};
          for (const g of DEEL_GROEPEN[id] ?? []) def[g] = null;
          a.zetMapjes(def);
        }
      } catch (err) { console.warn(`[werk] ${id} thuis`, err); }
    }
    this.deel = this.def.deel.start ?? null;
    this.door = door;
    this._planScherm();
    this.emit('change', this.stand());
    return true;
  }

  _momentopname() {
    const s = {};
    for (const [id, a] of apparaten()) {
      try { const m = a.mapjes(); if (m && typeof m === 'object') s[id] = { ...m }; } catch (_) {}
    }
    return s;
  }

  /** volgt: een apparaat meldt een mapje dat jij VAST openzette. */
  _luisterNaar(id, a) {
    this._volgers.get(id)?.();
    this._volgers.delete(id);
    if (!a?.bij) return;
    this._volgers.set(id, a.bij((mapje, info) => this._volg(id, a, mapje, info)));
  }

  _volg(id, a, mapje, info) {
    if (this.def.deel.kiezen !== 'volgt') return;
    const r = this.def.volgt.find((v) => v.apparaat === id && v.mapje === mapje);
    if (!r || r.deel === this.deel) return;
    this.kiesDeel(r.deel, { door: `${a.naam ?? id} (volgt)`, vanApparaat: id, vorige: info?.groep ? info : null });
  }

  // ---- het scherm --------------------------------------------------------------------------

  /**
   * Het scherm en het event 'werkruimte' (S2/S7) in het volgende beeld (`plan`), nooit in het
   * MIDI-bericht van de wissel (review ronde 2: een luisteraar die werk doet zou anders de invoer
   * vertragen). Twee wissels in één beeld: alleen de laatste telt.
   */
  _planScherm() {
    const deel = this.deel;
    const naam = this.naam;
    this.plan(() => {
      if (this.deel !== deel || this.naam !== naam) return;
      this._scherm();
      this.emit('werkruimte', { naam, deel, def: this.deelDef(deel) });
    });
  }

  /** Rijen en onderpaneel zoals het deel ze wil. Alleen wat een deel openzette gaat weer dicht. */
  _scherm() {
    const h = this.deelDef()?.schermen?.hoofd;
    const rijen = this.rijen;
    if (rijen && Array.isArray(h?.rijen)) {
      for (const n of [...this._rijenOpen]) {
        if (h.rijen.includes(n)) continue;
        const r = rijen.rij(n);
        if (r?.isOpen()) r.zet(false);
        this._rijenOpen.delete(n);
      }
      for (const n of h.rijen) {
        const r = rijen.rij(n);
        if (r && !r.isOpen()) { r.zet(true); this._rijenOpen.add(n); }
      }
    }
    const s = this.scherm;
    if (!s) return;
    const wil = h?.onderpaneel ?? null;
    if (wil) {
      if (!s.onderpaneelOpen(wil)) { s.onderpaneel(wil, true); this._onderOpen = wil; }
    } else if (this._onderOpen) {
      if (s.onderpaneelOpen(this._onderOpen)) s.onderpaneel(this._onderOpen, false);
      this._onderOpen = null;
    }
  }

  // ---- vereist / terugval ------------------------------------------------------------------

  /** Na elke poortwissel (midi 'state', een adapter erbij of weg). */
  controleerAanwezig() {
    // Bezig (kies of peil): niet weggooien, maar daarna nog eens kijken (_klaar). Anders zag een
    // apparaat dat precies tijdens het laden wegviel pas het volgende 'state'-event (review ronde 1).
    if (this._bezig) { this._nogEens = true; return; }
    if (this.terug) {
      const alles = (this.terug.vereist ?? []).every((a) => aanwezigVan(a, this.midi));
      if (alles && !this.terug.mag) {
        this.terug.mag = true;
        const naar = this.terug.naam;
        this.meld(`alles is er weer voor werkruimte ${naar}`, 'info', 30000, { tekst: `terug naar ${naar}`, doe: () => this.terugNaarKeuze() });
        this.emit('change', this.stand());
      } else if (!alles && this.terug.mag) { this.terug.mag = false; this.emit('change', this.stand()); }
      return;
    }
    const mist = (this.def.vereist ?? []).filter((a) => !aanwezigVan(a, this.midi));
    if (!mist.length) return;
    const naar = this.def.terugval ?? 'standaard';
    this.meld(`${mist.map(apparaatNaam).join(' en ')} ${mist.length > 1 ? 'zijn' : 'is'} weg: werkruimte ${naar}`, 'info', 8000);
    // behoudDeel: het deel blijft als de terugval het ook heeft, en wat er op de andere apparaten
    // open stond blijft open (review ronde 2: de APC verloor anders zijn mapje omdat de Maschine wegviel).
    this.kies(naar, { behoudDeel: true, terugVan: { naam: this.naam, vereist: [...this.def.vereist] } });
  }

  /** De knop "terug naar …": de werkruimte die je koos, nu alles er weer is. */
  terugNaarKeuze() {
    if (!this.terug) return Promise.resolve(null);
    const naam = this.terug.naam;
    this.terug = null;
    return this.kies(naam);
  }

  // ---- vastleggen en "nieuw" ---------------------------------------------------------------

  /**
   * Leg vast in dit deel (A9): de open mapjes per apparaat en de open rijen worden het deel.
   * Eerste druk = een vraag; tweede binnen 3 s = opslaan met versie (409: niets overschreven).
   */
  async vastleggen() {
    const deel = this.deel;
    if (!deel) { this.meld('vastleggen: deze werkruimte heeft geen delen', 'info'); return { ok: false }; }
    const nu = this.now();
    const v = this._vastleggen;
    if (!v || v.deel !== deel || nu - v.t > 3000) {
      this._vastleggen = { deel, t: nu };
      this.meld(`nog eens binnen 3 s: leg vast in ${this.def.delen[deel].label}`, 'info', 3000);
      return { ok: false, vraag: true };
    }
    this._vastleggen = null;
    const ruw = JSON.parse(JSON.stringify(this.ruw));
    const d = ruw.delen[deel] ?? (ruw.delen[deel] = { label: this.def.delen[deel].label, kleur: this.def.delen[deel].kleur });
    const s = this._momentopname();
    for (const [app, groepen] of Object.entries(DEEL_GROEPEN)) {
      if (!s[app]) continue;
      const m = {};
      // Een conditie ({ als, dan, anders }) blijft een conditie zolang ze NU precies het open mapje
      // geeft: wie vastlegt wat de conditie al zette, bedoelt geen letterlijke stand (review ronde 1).
      const nuDef = mapjesVanDeel(this.def.delen[deel], app, (c) => this.conditie(c));
      const bestaand = isObj(d[app]) ? d[app] : {};
      for (const g of groepen) {
        if (typeof s[app][g] !== 'string') continue;
        if (isObj(bestaand[g]) && 'als' in bestaand[g] && nuDef[g] === s[app][g]) continue;
        m[g] = s[app][g];
      }
      if (Object.keys(m).length) d[app] = { ...(isObj(d[app]) ? d[app] : {}), ...m };
    }
    if (this.rijen) {
      d.schermen = isObj(d.schermen) ? d.schermen : {};
      d.schermen.hoofd = { ...(isObj(d.schermen.hoofd) ? d.schermen.hoofd : {}), rijen: this.rijen.rijNamen().filter((n) => this.rijen.rij(n)?.isOpen()) };
    }
    const n = normaliseerWerkruimte(ruw, { standaarden: this.standaarden, bekend: bekendUitGroepen(GROEPEN) });
    if (n.fouten.length) { this.meld(`vastleggen geweigerd: ${n.fouten[0]}`, 'fout'); return { ok: false, fouten: n.fouten }; }
    let r;
    try { r = await this.bewaar(this.naam, ruw, this.versie); } catch (err) { r = { ok: false, fout: String(err?.message || err) }; }
    if (!r?.ok) {
      this.meld(r?.status === 409 ? `werkruimte ${this.naam} is intussen gewijzigd (door Claude of een ander venster): niets overschreven, hij wordt opnieuw geladen`
        : `vastleggen mislukt: ${r?.fout ?? r?.status ?? 'onbekend'}`, 'fout');
      if (r?.status === 409) this.peil({ forceer: true });
      return { ok: false, status: r?.status };
    }
    this.ruw = ruw;
    this.versie = r.versie ?? this.versie;
    this.bron = 'eigen';
    this.def = n.werkruimte;
    this.onthouden.delete(deel);
    this.meld(`vastgelegd in ${this.def.delen[deel].label}`, 'info');
    this.emit('change', this.stand());
    return { ok: true, versie: this.versie };
  }

  /** "⚠ N nieuw" gezien: wat er nu staat wordt de basis voor de volgende keer (A11). */
  gezien() {
    if (!this.samenstelling) return;
    this.basislijn?.zet(this.naam, plekkenVan(this.samenstelling));
    this.nieuw = telNieuwePlekken(this.samenstelling, this.samenstelling);
    this.emit('change', this.stand());
  }

  /** Is het bestand veranderd (Claude schreef het, een ander venster sloeg op)? Dan opnieuw, met hetzelfde deel. */
  async peil({ forceer = false } = {}) {
    // Nooit twee verzoeken tegelijk (review ronde 2): blijft een GET hangen (iCloud), dan start de
    // timer niet elke 2,5 s een nieuwe die de verbindingen van de StreamBron verdringt. De haler
    // heeft zelf een tijdgrens (maakHaler, HAAL_MS).
    if (this._bezig || this._peilt) return false;
    const nr = this._laad, naam = this.naam;
    let g;
    this._peilt = true;
    try { g = await this.haal(naam, { peil: true }); } catch (_) { return false; } finally { this._peilt = false; }
    if (nr !== this._laad || naam !== this.naam || this._bezig) return false;   // intussen een andere werkruimte gekozen
    if (!g || (!forceer && g.versie === this.versie) || g.niets) return false;
    if (!g.werkruimte) return false;
    this._bezig = true;
    this._laad++;
    try {
      const stukken = {};
      for (const s of (g.werkruimte.stukken ?? []).filter((x) => naamGeldig(x))) { try { const d = await this.haalStuk(s); if (d) stukken[s] = d; } catch (_) {} }
      this._zetOp(this.naam, g.werkruimte, g, stukken, { behoudDeel: true });
      this.meld(`werkruimte ${this.naam} bijgewerkt`, 'info');
      this.emit('change', this.stand());
      return true;
    } finally { this._bezig = false; this._klaar(); }
  }

  /** Alles wat de werk-balk en de schermen willen weten, in één object. */
  stand() {
    return { naam: this.naam, titel: this.def.titel, deel: this.deel, door: this.door, delen: this.delen(),
      nieuw: this.nieuw.aantal, terug: this.terug ? { naam: this.terug.naam, mag: this.terug.mag } : null,
      waarschuwingen: this.waarschuwingen.length, versie: this.versie, bron: this.bron };
  }

  stop() {
    this._afApparaten?.(); this._afMidi?.();
    for (const af of this._volgers.values()) af?.();
    this._volgers.clear();
  }
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const NAMEN = { apc40mk2: 'de APC', 'maschine-mk2': 'de Maschine', xboard49: 'de Xboard', lpd8: 'de LPD8', hub: 'de hub' };
const apparaatNaam = (a) => NAMEN[a] ?? a;

/** Een samenstelling klein, voor de basislijn van "nieuw" (localStorage). */
export function plekkenVan(s) {
  const uit = { apparaten: {} };
  for (const [app, a] of Object.entries(s?.apparaten ?? {})) {
    uit.apparaten[app] = { fragmenten: a.fragmenten.map((f) => ({ bron: f.bron, doc: { rules: f.doc.rules.map((r) => ({ in: r.in, ...(r.shift ? { shift: true } : {}), ...(r.laag ? { laag: r.laag } : {}), action: r.action, mode: r.mode, ...(r.naar !== undefined ? { naar: r.naar } : {}) })) } })) };
  }
  return uit;
}

/**
 * Peilen elke 3 s (zoals plan-koppeling.js): de werkruimte op de server ophalen met de ETag
 * van de vorige keer (304 = niets veranderd, geen body). Geeft { werkruimte, versie, bron } of
 * { niets: true } of null. `fetch` en `leesWeg` van buiten (de test, de browser).
 */
export const HAAL_MS = 5000;
export function maakHaler({ fetch: f = globalThis.fetch, leesWeg = async () => {}, basis = '', tijd = HAAL_MS } = {}) {
  const etags = new Map();
  return async function haal(naam, { peil = false } = {}) {
    const headers = peil && etags.has(naam) ? { 'If-None-Match': etags.get(naam) } : {};
    // Een tijdgrens: een verzoek dat blijft hangen houdt anders een van de zes verbindingen per host vast.
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(tijd) : undefined;
    const r = await f(`${basis}/api/werkruimtes/${encodeURIComponent(naam)}`, { headers, signal });
    if (r.status === 304) { await leesWeg(r); return { niets: true }; }
    if (r.status === 404) { await leesWeg(r); return null; }
    if (!r.ok) { await leesWeg(r); throw new Error(`werkruimte ${naam}: ${r.status}`); }
    const tag = r.headers?.get?.('etag');
    if (tag) etags.set(naam, tag);
    const d = await r.json();
    return { werkruimte: d.ruw ?? null, versie: d.versie ?? null, bron: d.bron ?? null, fouten: d.fouten ?? [] };
  };
}
