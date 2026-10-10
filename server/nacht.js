import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ZEKER } from './kaart.js';

/**
 * De nachtwachtrij: de kaart langzaam binnenhalen, met een rem (docs/KAART.md,
 * contract §2 "Regels van de nachtwachtrij").
 *
 * De zes regels, en waar ze zitten:
 * 1. Alleen binnen het venster (01:00–07:00), alleen als `aan`, nooit op een
 *    speeldag of als `vandaagNiet`. Standaard UIT.             -> magNu()
 * 2. Eerst de wensen (oudste eerst), dan de standaardvolgorde van de kaart
 *    (vertrouwd, dan eigen likes; met de uitsluitingen).         -> volgende()
 * 3. Eén nummer tegelijk door de bestaande ingest-Wachtrij, alleen audio;
 *    tussen twee nummers een willekeurige pauze pauze.min–max s.  -> run()
 * 4. Stopt meteen als er een deck gaat spelen; verder de volgende nacht.
 * 5. Bij HTTP 403/429 of drie mislukkingen op rij: stop met `reden`, pas de
 *    volgende nacht weer. Geen enkele cookie-optie, nooit.
 * 6. Elke run in `nacht_runs` (kaart.db) en in het serverlog.
 *
 * Alles wat met tijd, decks of netwerk te maken heeft komt van buiten
 * (`klok`, `speeltDeck`, `haal`, `wacht`, `toeval`): de tests draaien de
 * regels één voor één zonder echte tijd en zonder één byte van internet.
 * `haal(wens)` is in de server een wrapper om de ingest-wachtrij (video:
 * false, geen stems) die pas terugkomt als het nummer af is.
 *
 * Eén "nacht" is de nacht die bij een DATUM hoort: 01:00–07:00 op 11 okt is
 * de nacht van 10 okt (`nachtDatum`: vóór 12:00 telt de vorige dag). Zo dekt
 * "nooit op een speeldag" ook de nacht ná de proefavond, en geldt "vandaag
 * niet" voor de komende nacht, hoe laat je het ook aanzet.
 */

export const STANDAARD = Object.freeze({
  aan: false,
  venster: { van: '01:00', tot: '07:00' },
  perNacht: 80,
  pauze: { min: 20, max: 90 },
  vandaagNietDatum: null,        // de nachtDatum waarvoor "vandaag niet" geldt
  speeldagen: ['2026-10-10'],    // de proefavond
  standaardVolgorde: true,       // na de wensen ook de kaart afwerken (vertrouwd, eigen likes)
});

/** Hoe vaak de klok gepeild wordt als de server draait. */
export const PEIL_MS = 60 * 1000;
/** Zoveel mislukkingen op rij = stop (regel 5). */
export const MAX_OP_EEN_RIJ = 3;
/** Een fout die zegt dat YouTube ons tegenhoudt: stoppen, niet doorbeuken (regel 5). */
export const isBlokkade = (fout) => /\b(403|429)\b|forbidden|too many requests|rate.?limit|sign in to confirm/i.test(String(fout ?? ''));

const twee = (n) => String(n).padStart(2, '0');
export const datumVan = (d) => `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}`;
/** De datum waar deze nacht bij hoort: vóór 12:00 de dag ervóór. */
export function nachtDatum(d) {
  const x = new Date(d.getTime());
  if (x.getHours() < 12) x.setDate(x.getDate() - 1);
  return datumVan(x);
}
const isDatum = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTijd = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const minuten = (t) => { const [u, m] = t.split(':').map(Number); return u * 60 + m; };

/** Zit `d` in het venster? Een venster mag over middernacht lopen (23:00–06:00). */
export function inVenster(d, { van, tot }) {
  const nu = d.getHours() * 60 + d.getMinutes();
  const a = minuten(van), b = minuten(tot);
  if (a === b) return false;
  return a < b ? nu >= a && nu < b : nu >= a || nu < b;
}

/** Gedeeltelijke instellingen controleren en toepassen; gooit met een leesbare reden. */
export function pasToe(huidig, deel) {
  if (!deel || typeof deel !== 'object' || Array.isArray(deel)) throw new Error('stuur een object met instellingen');
  const n = { ...huidig, venster: { ...huidig.venster }, pauze: { ...huidig.pauze }, speeldagen: [...huidig.speeldagen] };
  for (const [k, v] of Object.entries(deel)) {
    switch (k) {
      case 'aan': case 'standaardVolgorde':
        if (typeof v !== 'boolean') throw new Error(`${k} is true of false`);
        n[k] = v; break;
      case 'perNacht':
        if (!(Number.isInteger(v) && v >= 1 && v <= 1000)) throw new Error('perNacht is 1..1000');
        n.perNacht = v; break;
      case 'venster':
        if (!v || !isTijd(v.van) || !isTijd(v.tot)) throw new Error('venster is { van: "01:00", tot: "07:00" }');
        n.venster = { van: v.van, tot: v.tot }; break;
      case 'pauze':
        if (!v || !(Number.isFinite(v.min) && Number.isFinite(v.max) && v.min >= 0 && v.max >= v.min && v.max <= 3600)) {
          throw new Error('pauze is { min, max } in seconden, 0 ≤ min ≤ max ≤ 3600');
        }
        n.pauze = { min: v.min, max: v.max }; break;
      case 'speeldagen':
        if (!Array.isArray(v) || !v.every(isDatum)) throw new Error('speeldagen is een lijst datums JJJJ-MM-DD');
        n.speeldagen = [...new Set(v)].sort(); break;
      case 'vandaagNiet':
        if (typeof v !== 'boolean') throw new Error('vandaagNiet is true of false');
        n._vandaagNiet = v; break;   // de datum erbij zet de Nacht zelf (hij kent de klok)
      default:
        throw new Error(`onbekende instelling: ${k}`);
    }
  }
  return n;
}

export class Nacht {
  /**
   * @param o.pad         nacht.json (null = niet bewaren, voor tests)
   * @param o.kaart       de Kaart (wensen, standaardvolgorde, nacht_runs)
   * @param o.haal        async (wens) => { ok, fout?, track?, bestond? } — pas terug als het nummer af is
   * @param o.zoek        async (sleutel) => { kandidaten } — een YouTube-versie zoeken (gooit KaartFout)
   * @param o.speeltDeck  () => boolean
   * @param o.klok        () => Date
   * @param o.wacht       async (ms) => void — de pauze (tests: meteen)
   * @param o.toeval      () => 0..1
   * @param o.log
   */
  constructor({ pad = null, kaart, haal, zoek = null, speeltDeck = () => false, klok = () => new Date(),
    wacht = (ms) => new Promise((z) => setTimeout(z, ms)), toeval = Math.random, log = console.log }) {
    Object.assign(this, { pad, kaart, haal, zoek, speeltDeck, klok, wacht, toeval, log });
    this.instellingen = { ...STANDAARD, venster: { ...STANDAARD.venster }, pauze: { ...STANDAARD.pauze }, speeldagen: [...STANDAARD.speeldagen] };
    this._laad();
    this._timer = null;
    this._run = null;            // de lopende run (promise) of null
    this._stop = false;          // stop gevraagd: na het lopende nummer
    this._bezig = null;          // { id, begonnen, soort, aantal, gehaald, mislukt, huidig, alleenWensen }
    this._gedaan = new Set();    // nachtDatums waarvoor deze serverrun al een nachtrun deed
    const vorige = this.kaart.laatsteRun?.();
    if (vorige?.soort === 'nacht' && vorige.begonnen) this._gedaan.add(nachtDatum(new Date(vorige.begonnen)));
  }

  // ---- instellingen -----------------------------------------------------------

  _laad() {
    if (!this.pad) return;
    try {
      const j = JSON.parse(readFileSync(this.pad, 'utf8'));
      const { vandaagNietDatum, ...rest } = j?.instellingen ?? j ?? {};
      this.instellingen = pasToe(this.instellingen, Object.fromEntries(Object.entries(rest).filter(([k]) => k in STANDAARD && k !== 'vandaagNietDatum')));
      if (isDatum(vandaagNietDatum)) this.instellingen.vandaagNietDatum = vandaagNietDatum;
    } catch (err) {
      if (err.code !== 'ENOENT') this.log?.(`[nacht] ${this.pad} niet gelezen (${err.message}); standaardinstellingen`);
    }
  }

  _bewaar() {
    if (!this.pad) return;
    try {
      mkdirSync(dirname(this.pad), { recursive: true });
      writeFileSync(`${this.pad}.tmp`, JSON.stringify({ versie: 1, instellingen: this.instellingen }, null, 1));
      renameSync(`${this.pad}.tmp`, this.pad);
    } catch (err) { this.log?.(`[nacht] niet bewaard: ${err.message}`); }
  }

  /** POST /api/nacht: gedeeltelijk. Gooit bij een onbruikbare waarde (de route zegt 400). */
  zet(deel) {
    const n = pasToe(this.instellingen, deel);
    if ('_vandaagNiet' in n) { n.vandaagNietDatum = n._vandaagNiet ? nachtDatum(this.klok()) : null; delete n._vandaagNiet; }
    this.instellingen = n;
    this._bewaar();
    this.log?.(`[nacht] instellingen: ${this.instellingen.aan ? 'AAN' : 'uit'}, ${this.instellingen.perNacht} per nacht, ${this.instellingen.venster.van}–${this.instellingen.venster.tot}`);
    return this.stand();
  }

  get vandaagNiet() { return this.instellingen.vandaagNietDatum === nachtDatum(this.klok()); }

  /**
   * GET /api/nacht. `vandaag` en `nachtDatum` zijn de datums volgens de klok en
   * de tijdzone van de SERVER (dezelfde regel als nu() en magNu()): een iPhone in
   * een andere tijdzone of met een verkeerde klok rekent zo niet zelf een andere
   * dag uit (review companion ronde 1, fix 9).
   */
  stand() {
    const i = this.instellingen;
    const klok = this.klok();
    return {
      aan: i.aan, venster: { ...i.venster }, perNacht: i.perNacht, pauze: { ...i.pauze },
      vandaagNiet: this.vandaagNiet, speeldagen: [...i.speeldagen], standaardVolgorde: i.standaardVolgorde,
      laatsteRun: this.kaart.laatsteRun(), volgende: this.volgende(), bezig: this._bezig ? { ...this._bezig } : null,
      nu: klok.toISOString(), vandaag: datumVan(klok), nachtDatum: nachtDatum(klok),
    };
  }

  // ---- regel 1: mag het nu? ------------------------------------------------------

  /** Waarom er nu geen nachtrun mag, of null. `nu` is een Date. */
  magNu(nu = this.klok(), { venster = true } = {}) {
    const i = this.instellingen;
    if (!i.aan) return 'staat uit';
    const nacht = nachtDatum(nu);
    if (i.speeldagen.includes(nacht) || i.speeldagen.includes(datumVan(nu))) return `speeldag (${nacht})`;
    if (i.vandaagNietDatum === nacht) return 'vandaag niet';
    if (venster && !inVenster(nu, i.venster)) return `buiten het venster ${i.venster.van}–${i.venster.tot}`;
    if (this._gedaan.has(nacht)) return 'deze nacht al gedaan';
    return null;
  }

  /** Het eerstvolgende moment waarop een nachtrun kan beginnen (ISO), of null als hij uit staat. */
  volgende(nu = this.klok()) {
    const i = this.instellingen;
    if (!i.aan) return null;
    const [u, m] = i.venster.van.split(':').map(Number);
    for (let dag = 0; dag < 60; dag++) {
      let t = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + dag, u, m);
      if (dag === 0 && t < nu) t = inVenster(nu, i.venster) ? new Date(nu.getTime()) : null;
      if (!t) continue;
      if (!this.magNu(t)) return t.toISOString();
    }
    return null;
  }

  // ---- de timer ------------------------------------------------------------------

  start() {
    this._timer = setInterval(() => this.peil(), PEIL_MS);
    this._timer.unref?.();
    return this;
  }

  stopTimer() { clearInterval(this._timer); this._timer = null; }

  /** Eén blik op de klok: begint een nachtrun als dat mag. Geeft de reden waarom niet, of null. */
  peil() {
    if (this._run) return 'bezig';
    const reden = this.magNu();
    if (reden) return reden;
    if (this.speeltDeck()) return 'er speelt een deck';
    this._gedaan.add(nachtDatum(this.klok()));
    this.run({ aantal: this.instellingen.perNacht, soort: 'nacht' }).catch((err) => this.log?.(`[nacht] run: ${err?.message || err}`));
    return null;
  }

  // ---- regel 2: wat is het volgende nummer? --------------------------------------

  /**
   * Het volgende te halen: een wens die wacht (oudste eerst), anders het eerste
   * uit de standaardvolgorde van de kaart (als die aan staat). Een item is
   * { sleutel, youtube_id, bron }. null = niets meer.
   * `alleenWensen`: nooit de standaardvolgorde, ook als die aan staat ("haal de
   * wenslijst nu op" op de companion belooft de wenslijst, niet de kaart).
   */
  volgendeItem({ alleenWensen = false } = {}) {
    const w = this.kaart.volgendeWens();
    if (w) return { sleutel: w.sleutel, youtube_id: w.youtube_id, bron: 'wens' };
    if (alleenWensen || !this.instellingen.standaardVolgorde) return null;
    const [s] = this.kaart.standaardVolgorde({ grens: 1 });
    if (!s) return null;
    const n = this.kaart.perSleutel.get(s);
    return { sleutel: s, youtube_id: n?.youtube_id ?? null, bron: 'nacht' };
  }

  // ---- regels 3–6: de run ---------------------------------------------------------

  /** POST /api/nacht/stop: na het lopende nummer. */
  stop() { if (this._bezig) { this._stop = true; return true; } return false; }

  /**
   * POST /api/nacht/nu { aantal, alleenWensen }: een run nu. Weigert (gooit met
   * .code 409) als er al een loopt, een deck speelt, of vandaag een speeldag is.
   * `alleenWensen` (standaard false, dan als altijd): alleen wat op de wenslijst
   * wacht, nooit de standaardvolgorde. Zonder die vlag haalde een wens die op
   * `kies` eindigde (Spotify zonder zekere versie) een nummer van de kaart in
   * zijn plaats (review companion ronde 1, fix 1).
   */
  nu({ aantal = 1, alleenWensen = false } = {}) {
    if (typeof alleenWensen !== 'boolean') { const e = new Error('alleenWensen is true of false'); e.code = 400; throw e; }
    if (!(Number.isInteger(aantal) && aantal >= 1 && aantal <= 1000)) { const e = new Error('aantal is 1..1000'); e.code = 400; throw e; }
    if (this._run) { const e = new Error('er loopt al een run'); e.code = 409; throw e; }
    if (this.speeltDeck()) { const e = new Error('er speelt een deck'); e.code = 409; throw e; }
    const nu = this.klok();
    if (this.instellingen.speeldagen.includes(datumVan(nu)) || this.instellingen.speeldagen.includes(nachtDatum(nu))) {
      const e = new Error('vandaag is een speeldag'); e.code = 409; throw e;
    }
    return this.run({ aantal, soort: 'nu', alleenWensen });
  }

  /**
   * De run zelf. Haalt hooguit `aantal` nummers; stopt eerder op elke regel.
   * Geeft { gehaald, mislukt, reden } en logt in nacht_runs. Loopt er al een,
   * dan die.
   */
  run({ aantal, soort = 'nacht', alleenWensen = false }) {
    if (this._run) return this._run;
    this._stop = false;
    this._run = this._doeRun({ aantal, soort, alleenWensen }).finally(() => { this._run = null; this._bezig = null; });
    return this._run;
  }

  async _doeRun({ aantal, soort, alleenWensen = false }) {
    const begonnen = this.klok().getTime();
    const id = this.kaart.beginRun(soort, begonnen);
    this._bezig = { id, begonnen, soort, aantal, gehaald: 0, mislukt: 0, huidig: null, alleenWensen };
    this.log?.(`[nacht] run ${id} (${soort}${alleenWensen ? ', alleen de wenslijst' : ''}): hooguit ${aantal} nummer${aantal === 1 ? '' : 's'}`);
    let opEenRij = 0;
    let reden = null;
    const b = this._bezig;
    try {
      while (b.gehaald < aantal) {
        if (this._stop) { reden = 'gestopt'; break; }
        if (this.speeltDeck()) { reden = 'er speelt een deck'; break; }                                  // regel 4
        if (soort === 'nacht' && !inVenster(this.klok(), this.instellingen.venster)) { reden = 'venster voorbij'; break; }
        const item = this.volgendeItem({ alleenWensen });
        if (!item) { reden = 'niets meer te halen'; break; }
        b.huidig = item.sleutel;
        // Uit de standaardvolgorde: eerst een wens-rij (bron 'nacht'), zodat hij
        // nooit twee keer gepakt wordt en in /api/kaart/wensen zichtbaar is.
        if (item.bron === 'nacht') this.kaart.voegWensen([item.sleutel], { bron: 'nacht' });

        // Een wens zonder video: eerst een versie zoeken. Zeker (≥ 0,9) = kiezen en
        // doorgaan; anders blijft hij op 'kies' staan voor Clay en gaan we verder.
        if (!item.youtube_id) {
          if (!this.zoek) { this.kaart.zetWens(item.sleutel, { status: 'kies', fout: 'geen video; kies er een' }); continue; }
          let r;
          try { r = await this.zoek(item.sleutel); } catch (err) {
            if (isBlokkade(err?.message)) { reden = `geblokkeerd bij zoeken: ${err.message}`; break; }           // regel 5
            opEenRij++;
            if (opEenRij >= MAX_OP_EEN_RIJ) { reden = `${MAX_OP_EEN_RIJ} mislukkingen op rij (${err?.message || err})`; break; }
            continue;
          }
          const beste = r.kandidaten?.[0];
          if (!beste || beste.score < ZEKER) {
            // Niet zeker: Clay kiest (status 'kies', de kandidaten erbij). Nooit gokken.
            this.kaart.zetWens(item.sleutel, { status: 'kies', kandidaten: r.kandidaten ?? [] });
            this.log?.(`[nacht] ${item.sleutel}: geen zekere versie (${beste ? beste.score : 'niets'}), wacht op een keuze`);
            continue;
          }
          this.kaart.kies(item.sleutel, beste.youtube_id);
          item.youtube_id = beste.youtube_id;
          this.log?.(`[nacht] ${item.sleutel}: ${beste.youtube_id} gekozen (${beste.score}, ${beste.reden})`);
        }

        this.kaart.zetWens(item.sleutel, { status: 'bezig', fout: null, youtube_id: item.youtube_id });
        let r;
        try { r = await this.haal({ sleutel: item.sleutel, youtube_id: item.youtube_id }); } catch (err) { r = { ok: false, fout: String(err?.message || err) }; }
        if (r?.ok) {
          this.kaart.zetWens(item.sleutel, { status: 'klaar', fout: null, track_id: r.track?.id ?? item.youtube_id });
          b.gehaald++; opEenRij = 0;
          this.log?.(`[nacht] ${item.sleutel}: klaar (${r.bestond ? 'stond al in de library' : r.track?.titel ?? item.youtube_id}), ${b.gehaald}/${aantal}`);
        } else {
          const fout = r?.fout || 'onbekende fout';
          this.kaart.zetWens(item.sleutel, { status: 'mislukt', fout });
          b.mislukt++; opEenRij++;
          this.log?.(`[nacht] ${item.sleutel}: mislukt (${fout})`);
          if (isBlokkade(fout)) { reden = `geblokkeerd: ${fout}`; break; }                                 // regel 5
          if (opEenRij >= MAX_OP_EEN_RIJ) { reden = `${MAX_OP_EEN_RIJ} mislukkingen op rij`; break; }
        }
        b.huidig = null;
        if (b.gehaald >= aantal) break;
        if (this._stop) { reden = 'gestopt'; break; }
        const { min, max } = this.instellingen.pauze;                                                    // regel 3
        await this.wacht(Math.round((min + this.toeval() * (max - min)) * 1000));
      }
      if (!reden) reden = `klaar: ${b.gehaald} gehaald`;
    } catch (err) {
      reden = `fout: ${err?.message || err}`;
    }
    const klaar = this.klok().getTime();
    this.kaart.eindRun(id, { klaar, gehaald: b.gehaald, mislukt: b.mislukt, reden });                      // regel 6
    this.log?.(`[nacht] run ${id} klaar: ${b.gehaald} gehaald, ${b.mislukt} mislukt — ${reden}`);
    return { id, gehaald: b.gehaald, mislukt: b.mislukt, reden, begonnen, klaar };
  }
}
