/**
 * Lampjes en ringen: de stand van de bus (bus.lees) op het apparaat, volgens de
 * indeling die NU geldt. De lampjes lezen de INDELING, niet de engine: koppel je
 * een pad aan iets anders, dan verhuist zijn lampje vanzelf mee (v1 bediening-031).
 *
 * Kleurtaal (v1 B4, bediening-032), uit wat de actie leest:
 *   null           uit (niets te doen: een hotcue op een lege track)
 *   0 / false      donkergrijs: leeg maar bruikbaar   (kleur.uit)
 *   ertussen       de DONKERE tint (n+1): gevuld, dicht (kleur.half)
 *   1 / true       de volle kleur: actief             (kleur.aan)
 * Een eenkleurig lampje is aan bij half en aan. Een ring toont de stand zelf.
 *
 * Knipperen op de tel rekenen we ZELF (bediening-034), niet met het knipperkanaal
 * van de APC: `tel()` geeft de fase 0..1 van de klok zoals je hem hoort (of
 * { fase, een } met een = dit is de "1" van de maat, of null). Een regel met
 * led.tel 'aan' is in de stand aan fel op de tel (een kwart tel, op de "1" een
 * halve) en gedimd ertussen; een eenkleurig lampje gaat op de tel even uit.
 *
 * Er wordt gediffed: alleen wat veranderd is gaat naar buiten (en daar door de
 * wachtrij van midi.js, 16 per 4 ms). Een eigen timer van 33 ms (niet
 * requestAnimationFrame: die staat stil als het venster achter iets anders zit),
 * plus wek() na elke actie op de bus: alleen lampjes, meteen (microtaak, hooguit
 * één per 4 ms). Ringen alleen op de tik van 33 ms (bediening-035: een ring na
 * elke knopstap botst met een APC die de ring als knopwaarde overneemt).
 */

import { isLaagActie } from './indeling.js';

export const TIK_MS = 33;
export const TEL_VENSTER = 0.25;
export const TEL_VENSTER_EEN = 0.5;
export const WEK_MS = 4;
/** Vangnet per tik; het spreiden doet de wachtrij. Een volledige verversing is ~141 berichten. */
export const MAX_PER_TIK = 200;

const standaardKlok = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const standaardTimers = () => ({
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t),
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t),
});

/** Drie standen uit een lees: 'aan', 'half', 'uit' (null = helemaal uit, apart). */
export const standVan = (v) => (v >= 0.99 ? 'aan' : v > 0.01 ? 'half' : 'uit');

const pak = (b) => (b[0] << 16) | (b[1] << 8) | b[2];
const uitpak = (v) => [v >> 16, (v >> 8) & 0xff, v & 0xff];

export class Lampjes {
  /**
   * @param indeling   Indeling (indeling.js): regels, lagen, lees()
   * @param stuur      (bytes, opties) -> naar de controller (de wachtrij van midi.js)
   * @param stuurSysex (bytes) -> de init
   * @param tel        () -> fase 0..1 | { fase, een } | null
   * @param meta       (actie) -> meta van de bus (voor bipolair: de pan-ring)
   */
  constructor({ indeling, apparaat = indeling.apparaat, bus = indeling.bus, stuur, stuurSysex = stuur, tel = () => null,
    meta = (id) => bus?.zoek?.(id)?.def?.meta ?? null, nu = standaardKlok, timers = standaardTimers() }) {
    this.indeling = indeling;
    this.apparaat = apparaat;
    this.bus = bus;
    this.stuur = stuur;
    this.stuurSysex = stuurSysex;
    this.tel = tel;
    this.meta = meta;
    this.nu = nu;
    this.timers = timers;
    this.vorige = new Map();     // sleutel -> laatst verstuurde bytes (gepakt)
    this.klaar = false;
    this.verstuurd = 0;
    this.tikken = 0;
    this._plan = null;
    this._planSleutel = null;
    this._interval = null;
    this._wekker = null;
    this._laatsteTik = -Infinity;
    this._los = [];
  }

  /** Timer aan en luisteren naar de bus en de indeling. */
  start() {
    if (this._interval !== null) return this;
    this._interval = this.timers.setInterval(() => this.tik(), TIK_MS);
    if (this.bus?.on) this._los.push(this.bus.on('actie', () => this.wek()));
    for (const e of ['shift', 'laag', 'verander']) this._los.push(this.indeling.on(e, () => this.wek({ alles: true })));
    return this;
  }

  stop() {
    if (this._interval !== null) this.timers.clearInterval(this._interval);
    this._interval = null;
    if (this._wekker !== null && this._wekker.timer) this.timers.clearTimeout(this._wekker.timer);
    this._wekker = null;
    for (const f of this._los.splice(0)) f();
  }

  /**
   * Wakker maken: init-sysex (0x42), het hele oppervlak uit (wat de vorige
   * gebruiker achterliet lijkt anders op een bug van ons), dan alles opnieuw.
   * Bij elke (her)aansluiting: na een replug staat de APC weer in 0x40.
   */
  init() {
    if (this.apparaat.init) this.stuurSysex([...this.apparaat.init]);
    this.zwart();
    this.klaar = true;
    this.tik();
  }

  /** Alles uit. `direct` alleen bij het sluiten van de pagina (er komt geen volgende tik). */
  zwart({ direct = false } = {}) {
    for (const b of this.apparaat.alleUit?.() ?? []) this.stuur(b, { direct });
    this.vorige.clear();
  }

  /** Volgende tik alles opnieuw sturen. */
  invalideer() { this.vorige.clear(); }

  /** Wat er per tik niet verandert: per control met een lampje of ring de regel, het doel en de kleur. */
  _planNu() {
    const ind = this.indeling;
    const vars = Object.keys(ind.vars ?? {}).map((k) => { const v = ind.vars[k]; return typeof v === 'function' ? v() : v; });
    const sleutel = `${ind.versie}|${ind.shift ? 1 : 0}|${vars.join(',')}`;
    if (this._plan && sleutel === this._planSleutel) return this._plan;
    const kaart = ind.actieveRegels();
    const dev = this.apparaat;
    const plan = [];
    for (const c of dev.controls.values()) {
      if (!c.led || c.led === 'geen') continue;
      const regel = kaart.get(c.id) ?? null;
      const doel = regel ? ind.vul(regel.actie) : null;
      const bron = regel ? (regel.led?.lees ? ind.vul(regel.led.lees) : doel) : null;
      if (c.led === 'ring') {
        const m = doel ? this.meta(doel) : null;
        const type = regel?.led?.ring ?? (m?.bipolair ? 'pan' : 'volume');
        plan.push({ c, ring: true, lees: this._lezer(bron), mist: this._mist(bron), type: dev.ring[type] ?? dev.ring.volume });
        continue;
      }
      plan.push({ c, lees: this._lezer(bron), mist: this._mist(bron), kleur: kleurVan(regel, c, dev), tel: regel?.led?.tel ?? null });
    }
    this._plan = plan;
    this._planSleutel = sleutel;
    return plan;
  }

  /**
   * Een lezer voor één doel, één keer per plan opgezocht: de bus zoekt een id met
   * regexen over al zijn sjablonen, en dat 140 keer per tik was het duurste deel
   * (v1 feedback: tik p50 454 -> 45 µs met een plan). Een laag leest de indeling.
   */
  _lezer(doel) {
    if (!doel) return null;
    const ind = this.indeling;
    if (isLaagActie(doel) || !this.bus?.zoek) return () => ind.lees(doel);
    const z = this.bus.zoek(doel);
    if (!z?.def?.lees) return null;
    return () => { try { return z.def.lees(z.n); } catch (_) { return null; } };
  }

  /** Een doel dat de bus (nog) niet kent: de acties van plak 2 kunnen later komen dan de controllers. */
  _mist(doel) { return doel && !isLaagActie(doel) && this.bus?.zoek && !this.bus.zoek(doel) ? doel : null; }

  /** Is het nu "op de tel"? null = er is geen tel. */
  _opDeTel() {
    let t = null;
    try { t = this.tel(); } catch (_) { t = null; }
    if (t === null || t === undefined) return null;
    const fase = typeof t === 'number' ? t : t.fase;
    if (typeof fase !== 'number' || !Number.isFinite(fase)) return null;
    const venster = typeof t === 'object' && t.een ? TEL_VENSTER_EEN : TEL_VENSTER;
    return ((fase % 1) + 1) % 1 < venster;
  }

  /** sleutel -> gewilde bytes (gepakt). `lampjes`: zonder ringen (wektik). */
  _wil(lampjes) {
    const plan = this._planNu();
    const dev = this.apparaat;
    const wil = new Map();
    const opTel = this._opDeTel();
    // Eens per ~seconde kijken of een ontbrekende actie er intussen is: dan een nieuw plan.
    if (this.tikken % 30 === 0 && plan.some((e) => e.mist && this.bus.zoek(e.mist))) this._plan = null;
    for (const e of plan) {
      let v = e.lees ? e.lees() : null;
      if (typeof v === 'boolean') v = v ? 1 : 0;
      if (typeof v !== 'number' || !Number.isFinite(v)) v = null;
      if (e.ring) {
        if (lampjes) continue;
        wil.set(`type:${e.c.id}`, pak(dev.ringType(e.c, v === null ? dev.ring.uit : e.type)));
        wil.set(e.c.id, pak(dev.ledBericht(e.c, { waarde: v ?? 0 })));
        continue;
      }
      let staat;
      if (v === null) staat = e.c.led === 'rgb' || e.c.led === 'ab' ? { kleur: 0 } : { aan: false };
      else {
        let stand = standVan(v);
        const knipper = e.tel === 'aan' && stand === 'aan' && opTel !== null;
        if (e.c.led === 'rgb' || e.c.led === 'ab') {
          if (knipper && !opTel) stand = 'half';
          const naam = e.kleur[stand];
          staat = { kleur: (e.c.led === 'ab' ? dev.tweekleur?.[naam] : dev.kleur[naam]) ?? 0 };
        } else {
          let aan = stand !== 'uit';
          if (knipper && opTel) aan = false;
          staat = { aan };
        }
      }
      wil.set(e.c.id, pak(dev.ledBericht(e.c, staat)));
    }
    return wil;
  }

  /** Wat er nu zou moeten branden, als bytes (voor tests en de proef). */
  gewild() {
    const uit = new Map();
    for (const [k, v] of this._wil(false)) uit.set(k, uitpak(v));
    return uit;
  }

  /** Stuurt alleen de verschillen. Geeft het aantal berichten. */
  tik({ lampjes = false } = {}) {
    if (!this.klaar) return 0;
    this.tikken++;
    this._laatsteTik = this.nu();
    let n = 0;
    for (const [k, v] of this._wil(lampjes)) {
      if (this.vorige.get(k) === v) continue;
      this.stuur(uitpak(v));
      this.vorige.set(k, v);
      this.verstuurd++;
      if (++n >= MAX_PER_TIK) break;
    }
    return n;
  }

  /**
   * Zo snel mogelijk een tik, ná wat er nu gebeurt (de bus meldt 'actie' VÓÓR de
   * actie: daarom een microtaak). Samengevoegd: één tik per taak, hooguit één per
   * WEK_MS. Alleen lampjes, tenzij `alles` (shift, laag, andere indeling).
   */
  wek({ alles = false } = {}) {
    if (!this.klaar) return;
    if (this._wekker) { this._wekker.alles ||= alles; return; }
    const w = { alles, timer: null };
    this._wekker = w;
    const doe = () => {
      if (this._wekker !== w) return;
      this._wekker = null;
      if (this.klaar) this.tik({ lampjes: !w.alles });
    };
    const wacht = WEK_MS - (this.nu() - this._laatsteTik);
    if (wacht <= 0) queueMicrotask(doe);
    else w.timer = this.timers.setTimeout(doe, wacht);
  }
}

/**
 * De drie kleuren van een regel: led.kleur als naam (volle kleur, donkere tint,
 * donkergrijs) of { aan, half, uit }. Een laagknop is dicht in zijn eigen donkere
 * tint, niet donkergrijs: zo zie je welke lagen er zijn en welke open is (v1).
 */
export function kleurVan(regel, c, dev) {
  const k = regel?.led?.kleur;
  if (k && typeof k === 'object') return { aan: k.aan ?? 'wit', half: k.half ?? k.aan ?? 'wit', uit: k.uit ?? 'donkergrijs' };
  if (c.led === 'ab') return { aan: 'oranje', half: 'geel', uit: 'uit' };
  const naam = typeof k === 'string' ? k : 'wit';
  const donker = dev.donker ? dev.donker(naam) : naam;
  return { aan: naam, half: donker, uit: regel && isLaagActie(regel.actie) ? donker : 'donkergrijs' };
}
