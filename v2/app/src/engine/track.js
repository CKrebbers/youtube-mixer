/**
 * Eén track: wat hij draagt, hoe hij speelt en hoe hij aan de klok vastzit.
 *
 * De track houdt zijn eigen gebroken lijn bij, als TIJDVAKKEN { van, soort, … }:
 *   'stil'       staat op plek P
 *   'vrij'       vanaf T op plek P met R seconden nummer per seconde audioklok
 *   'gekoppeld'  plek = grid.timeOf(klok.tel(t) + v)        (kern/koppeling.js)
 * Een handeling voegt een tijdvak toe vanaf moment A (net in de toekomst: wat al
 * klinkt staat vast). Uit de tijdvakken volgen de segmenten voor de afspeelmotor,
 * en met DEZELFDE formule de plek die het scherm toont. Er is geen teller: de
 * plek komt altijd van de audioklok (regel 3).
 *
 * De track weet niets van de bus of het scherm; de engine roept hem aan.
 */
import { Emitter } from '../kern/emitter.js';
import { segmenten, verschuivingBijKoppelen, verschuivingUitPlek } from '../kern/koppeling.js';

/** Hoe ver vooruit een gekoppelde track gepland wordt (de laatste lijn loopt daarna door). */
export const HORIZON = 8;
/** Nudge: zolang je drukt 4% sneller of trager (v1: bend). */
export const BEND = 0.04;
/** Pitchbereiken, als fractie (±8, ±16, ±50%). */
export const BEREIKEN = [0.08, 0.16, 0.5];
/** Soft-takeover van de pitchfader: zo dicht moet hij bij de stand van de klok komen. */
const GRIJP = 0.01;

export class Track extends Emitter {
  constructor({ n, engine, speler, strip }) {
    super();
    this.n = n;
    this.engine = engine;
    this.speler = speler;
    this.strip = strip;
    this.nummer = null;        // { id, titel, artiest, duur, grid } (grid: Beatgrid of null)
    this.sync = false;         // de knop: wil gekoppeld zijn (blijft over een laad heen)
    this.vakken = [{ van: -Infinity, soort: 'stil', P: 0 }];
    this.pitch = 0.5;          // de fader, 0..1
    this.bereik = 0.16;
    this.grijpt = true;        // soft-takeover van de pitchfader
    this.bend = 0;             // -1, 0, 1
    this.cue = 0;
    this.kant = n === 1 ? 'A' : n === 2 ? 'B' : 'thru';   // zoals v1: 1 op A, 2 op B, de rest thru
  }

  // ---- lezen -----------------------------------------------------------------

  get klok() { return this.engine.klok; }
  get grid() { return this.nummer?.grid ?? null; }
  get geladen() { return !!this.nummer; }

  _vak(t) {
    let x = this.vakken[0];
    for (const v of this.vakken) { if (v.van <= t) x = v; else break; }
    return x;
  }

  /** Plek in het nummer op audiokloktijd t (dezelfde formule als de segmenten). */
  plek(t) {
    const x = this._vak(t);
    if (x.soort === 'stil') return x.P;
    if (x.soort === 'vrij') return x.P + (t - x.van) * x.R;
    return this.grid.timeOf(this.klok.tel(t) + x.v);
  }

  /** Seconden nummer per seconde audioklok op t. */
  snelheid(t) {
    const x = this._vak(t);
    if (x.soort === 'stil') return 0;
    if (x.soort === 'vrij') return x.R;
    const c = this.klok.tel(t) + x.v;
    return this.klok.rate(t) * (this.grid.timeOf(c + 1e-3) - this.grid.timeOf(c - 1e-3)) / 2e-3;
  }

  // De getters hieronder lezen de stand op straks(): wat je net gedaan hebt telt al,
  // ook al gaat het pas over een paar ms in.

  /** Speelt hij op t? */
  speeltOp(t) { return this._vak(t).soort !== 'stil'; }
  get speelt() { return this.speeltOp(this.engine.straks()); }

  /** Wacht hij op een start op de maat? Geeft het startmoment of null. */
  get wacht() {
    const nu = this.engine.straks();
    if (this._vak(nu).soort !== 'stil') return null;
    const later = this.vakken.find((v) => v.van > nu && v.soort !== 'stil');
    return later ? later.van : null;
  }

  /** Is hij op t gekoppeld aan de klok? */
  gekoppeldOp(t) { return this._vak(t).soort === 'gekoppeld'; }
  get gekoppeld() { return this.gekoppeldOp(this.engine.straks()); }

  /** Verschuiving t.o.v. de klok in tellen (alleen gekoppeld), anders null. */
  get verschuiving() { const x = this._vak(this.engine.straks()); return x.soort === 'gekoppeld' ? x.v : null; }

  /** Hoorbare bpm op t: grid × snelheid (null zonder grid). */
  bpm(t) {
    if (!this.grid) return null;
    const r = this.speeltOp(t) ? this.snelheid(t) : this.pitchRate;
    return this.grid.bpmAt(this.plek(t)) * r;
  }

  /** De rate die de pitchfader vraagt (zonder klok). */
  get pitchRate() { return 1 + (this.pitch - 0.5) * 2 * this.bereik; }

  /** Mag deze plek gekoppeld worden (zeker over de tel)? */
  telZeker(P) { return !!this.grid && this.grid.zekerBij(P); }
  /** En op de "1" gestart (zeker over de tel én de maat)? */
  maatZeker(P) { return !!this.grid && this.grid.syncBij(P); }

  // ---- tijdvakken ------------------------------------------------------------

  /** Vanaf A een nieuw tijdvak; alles daarna vervalt. */
  _zet(A, vak) {
    // Net gekoppeld: de pitchfader staat waar hij stond, dus eerst erlangs (soft-takeover).
    if (vak.soort === 'gekoppeld' && !this.gekoppeldOp(A)) this.grijpt = false;
    this.vakken = this.vakken.filter((v) => v.van < A);
    this.vakken.push({ ...vak, van: A });
    // Opruimen: alles wat helemaal voorbij is, op één na.
    const nu = this.engine.nu();
    while (this.vakken.length > 1 && this.vakken[1].van <= nu) this.vakken.shift();
    this.plan();
    this.emit('verander');
  }

  /** De segmenten voor de afspeelmotor, vanaf nu. */
  segmenten() {
    const nu = this.engine.nu();
    const uit = [];
    const vakken = this.vakken;
    const i0 = vakken.indexOf(this._vak(nu));
    for (let i = i0; i < vakken.length; i++) {
      const x = vakken[i];
      const van = Math.max(x.van, nu);
      const tot = vakken[i + 1]?.van ?? Infinity;
      if (x.soort === 'stil') uit.push({ T: van, P: x.P, R: 0, speelt: false });
      else if (x.soort === 'vrij') uit.push({ T: van, P: x.P + (van - x.van) * x.R, R: x.R, speelt: true });
      else {
        const eind = Math.min(tot, nu + HORIZON);
        for (const s of segmenten(this.klok, this.grid, x.v, van, Math.max(eind, van + 1e-3))) {
          if (s.T < tot) uit.push({ ...s, speelt: true });
        }
      }
    }
    return uit;
  }

  plan() { if (this.speler) this.speler.plan(this.segmenten()); }

  // ---- handelingen (A = het moment waarop het ingaat) -----------------------

  laad(nummer) {
    this.nummer = nummer;
    this.cue = 0;
    this.grijpt = true;
    this.pitch = 0.5;
    this._zet(this.engine.straks(), { soort: 'stil', P: 0 });
  }

  leeg() {
    this.nummer = null;
    this._zet(this.engine.straks(), { soort: 'stil', P: 0 });
    this.speler?.leeg();
  }

  /** Play: speelt hij, dan pauze; wacht hij op de maat, dan annuleren; anders starten. */
  speel() {
    if (!this.geladen) return { geweigerd: 'geen nummer' };
    const A = this.engine.straks();
    if (this.wacht !== null) { this._zet(A, { soort: 'stil', P: this.plek(A) }); return; }
    if (this.speeltOp(A)) { this.pauze(); return; }
    const P = this.plek(A);
    // Loopt de klok nog niet, dan begint hij bij het eerste dat start (klok-B05).
    if (!this.klok.loopt && this.telZeker(P)) {
      this.engine.startKlokVan(this, A, P, this.pitchRate);
      this.sync = true;
      this._zet(A, { soort: 'gekoppeld', v: this._vVanStart(A, P) });
      return;
    }
    if (this.sync && this.klok.loopt && this.telZeker(P)) {
      this._zet(A, { soort: 'gekoppeld', v: verschuivingBijKoppelen(this.klok, this.grid, A, P) });
      return;
    }
    this._zet(A, { soort: 'vrij', P, R: this.pitchRate });
  }

  // Bij een klok die net op dit nummer begon: klok-tel = plek in de maat.
  _vVanStart(A, P) { return this.grid.beatAt(P) - this.klok.tel(A); }

  pauze() {
    const A = this.engine.straks();
    this._zet(A, { soort: 'stil', P: this.plek(A) });
  }

  /** Sync aan of uit (klok-B04, B07, B08). */
  zetSync(aan) {
    const A = this.engine.straks();
    const P = this.plek(A);
    if (!aan) {
      this.sync = false;
      if (this.speeltOp(A) && this.gekoppeldOp(A)) {
        const R = this.snelheid(A);
        this.pitch = Math.min(1, Math.max(0, 0.5 + (R - 1) / (2 * this.bereik)));
        this.grijpt = false;
        this._zet(A, { soort: 'vrij', P, R });
      } else this.emit('verander');
      return;
    }
    if (!this.grid) return { geweigerd: 'geen grid' };
    if (!this.telZeker(P)) return { geweigerd: 'het grid is hier onzeker: tik het tempo, zet tel 1 of zet het grid op slot' };
    this.sync = true;
    if (!this.speeltOp(A)) { this.emit('verander'); return; }
    if (!this.klok.loopt) {
      this.engine.startKlokVan(this, A, P, this.snelheid(A));
      this._zet(A, { soort: 'gekoppeld', v: this._vVanStart(A, P) });
      return;
    }
    this._zet(A, { soort: 'gekoppeld', v: verschuivingBijKoppelen(this.klok, this.grid, A, P) });
  }

  /**
   * Klok naar dit nummer (Shift + Sync, klok-B06): de klok neemt tempo en tel
   * over van wat je van deze track hoort. De track zelf blijft op zijn eigen
   * lijn tot de klok erop ligt, en is dan gekoppeld.
   */
  klokNaarMij() {
    const A = this.engine.straks();
    const P = this.plek(A);
    if (!this.grid) return { geweigerd: 'geen grid' };
    if (!this.telZeker(P)) return { geweigerd: 'het grid is hier onzeker' };
    if (!this.speeltOp(A)) return { geweigerd: 'speelt niet' };
    if (!this.klok.loopt) { this.zetSync(true); return; }
    if (this.gekoppeldOp(A)) return;   // ligt al op de klok
    const R = this.snelheid(A);
    const bA = Math.ceil(this.grid.beatAt(P) - 1e-9);
    const a = A + (this.grid.timeOf(bA) - P) / R;
    const L = (this.grid.timeOf(bA + 1) - this.grid.timeOf(bA)) / R;
    const { N } = this.klok.richt({ a, L }, A);
    const klaar = this.klok.seg.at(-1).T;
    this.sync = true;
    // Tot de klok erop ligt: vrij op de eigen lijn. Daarna gekoppeld, zonder sprong.
    this.vakken = this.vakken.filter((v) => v.van < A);
    this.vakken.push({ van: A, soort: 'vrij', P, R });
    this.vakken.push({ van: klaar, soort: 'gekoppeld', v: bA - N });
    this.plan();
    this.emit('verander');
  }

  /** Pitchfader (0..1). Gekoppeld en hoorbaar = het tempo van de klok (klok-B13, B14). */
  zetPitch(v01) {
    const A = this.engine.straks();
    if (this.gekoppeldOp(A)) {
      // Waar staat de fader voor het tempo van nu? Pas grijpen als hij erlangs komt.
      const nodig = 0.5 + (this.snelheid(A) - 1) / (2 * this.bereik);
      const was = this.pitch;
      this.pitch = v01;
      if (!this.engine.hoorbaar(this.n)) { this.grijpt = false; this.emit('verander'); return; }
      if (!this.grijpt) {
        const erlangs = (was - nodig) * (v01 - nodig) <= 0 || Math.abs(v01 - nodig) < GRIJP;
        if (!erlangs) { this.emit('verander'); return; }
        this.grijpt = true;
      }
      const bpm = this.grid.bpmAt(this.plek(A)) * this.pitchRate;
      this.engine.zetKlokTempo(bpm, A);
      return;
    }
    this.pitch = v01;
    this.grijpt = true;
    if (this.speeltOp(A)) this._zet(A, { soort: 'vrij', P: this.plek(A), R: this.pitchRate });
    else this.emit('verander');
  }

  /** Jog: `tellen` tellen verder (negatief = terug). Gekoppeld: alleen de verschuiving (klok-B03, B15). */
  jog(tellen) {
    const A = this.engine.straks();
    const x = this._vak(A);
    if (x.soort === 'gekoppeld') { this._zet(A, { soort: 'gekoppeld', v: x.v + tellen }); return; }
    const L = this.grid ? this.grid.beatLengthAt(this.plek(A)) : 0.5;
    const P = Math.max(0, this.plek(A) + tellen * L);
    if (x.soort === 'vrij') this._zet(A, { soort: 'vrij', P, R: x.R });
    else this._zet(A, { soort: 'stil', P });
  }

  /** Nudge vasthouden: zolang aan, BEND sneller of trager; loslaten = gekoppeld op de nieuwe plek. */
  nudge(richting, aan) {
    const A = this.engine.straks();
    const x = this._vak(A);
    if (x.soort === 'stil') return;
    if (aan) {
      if (this.bend) return;
      this.bend = richting;
      this._bendWas = x.soort;
      this._zet(A, { soort: 'vrij', P: this.plek(A), R: this.snelheid(A) * (1 + BEND * richting) });
      return;
    }
    if (this.bend !== richting) return;
    this.bend = 0;
    const P = this.plek(A);
    if (this._bendWas === 'gekoppeld' && this.klok.loopt) {
      this._zet(A, { soort: 'gekoppeld', v: verschuivingUitPlek(this.klok, this.grid, A, P) });
    } else {
      this._zet(A, { soort: 'vrij', P, R: this.pitchRate });
    }
  }

  /** Naar een plek springen. Gekoppeld: fasebehoudend, de verschuiving blijft (klok-S12). */
  zoek(P2) {
    const A = this.engine.straks();
    const x = this._vak(A);
    const duur = this.nummer?.duur ?? Infinity;
    P2 = Math.max(0, Math.min(P2, duur));
    if (x.soort === 'gekoppeld') {
      const c = this.klok.tel(A) + x.v;
      const v = x.v + Math.round(this.grid.beatAt(P2) - c);
      this._zet(A, { soort: 'gekoppeld', v });
    } else if (x.soort === 'vrij') this._zet(A, { soort: 'vrij', P: P2, R: x.R });
    else this._zet(A, { soort: 'stil', P: P2 });
  }

  /**
   * Starten op de maat (klok-S11): op de volgende "1" van de klok, met de tel van
   * het nummer bij het startpunt erop, gekoppeld. Vraagt een zekere "1" (klok-B08).
   */
  startOpDeMaat() {
    if (!this.geladen) return { geweigerd: 'geen nummer' };
    const A = this.engine.straks();
    if (this.wacht !== null) { this._zet(A, { soort: 'stil', P: this.plek(A) }); return; }
    if (this.speeltOp(A)) { this.pauze(); return; }
    const P0 = this.plek(A);
    if (!this.klok.loopt) return this.speel();
    if (!this.maatZeker(P0)) return { geweigerd: 'de "1" is hier niet zeker: starten op de maat kan niet' };
    const b0 = this.grid.beatAt(P0);
    const bn = Math.round(b0);
    let Cn = this.klok.volgendeMaat(this.klok.tel(A));
    let ts = this.klok.tijd(Cn + (b0 - bn));
    if (ts < A) { Cn += this.klok.perMaat; ts = this.klok.tijd(Cn + (b0 - bn)); }
    this.sync = true;
    this.vakken = this.vakken.filter((v) => v.van < A);
    this.vakken.push({ van: A, soort: 'stil', P: P0 });
    this.vakken.push({ van: ts, soort: 'gekoppeld', v: bn - Cn });
    this.plan();
    this.emit('verander');
  }

  /** De klok veranderde: de lijn van een gekoppelde track moet opnieuw. */
  klokVerandert() { if (this.vakken.some((v) => v.soort === 'gekoppeld')) this.plan(); }

  vernietig() { this.speler?.vernietig(); this.strip?.vernietig(); }
}
