/**
 * Stukken naar de server schrijven en opnieuw proberen zolang hij even weg is (v1 WINST punt 3,
 * src/kern/herhaal.js): voor de opname (`?frame=N`) en het log (`?van=B`). Elk stuk heeft zijn
 * plek, dus herhalen is veilig. Eén stuk tegelijk onderweg, in volgorde; de rij is begrensd: past
 * een NIEUW stuk er niet meer in, dan valt DAT stuk weg (een gat op zijn plek) en houd je het begin
 * van de storing (v1 AR10). Eén melding per schrijver, met een sleutel, die op "weer goed" eindigt.
 */
import { herhaal, nieuweToestand, tijdslot } from '../kern/herhaal.js';

export class Schrijver {
  /**
   * @param naam    voor de melding ('opname', 'log')
   * @param url     (stuk) => string
   * @param body    (stuk) => { body, type }
   * @param grootte (stuk) => bytes
   * @param max     bytes in de rij
   */
  constructor({ naam, url, body, grootte, max, meld, wis, haal = (u, o) => fetch(u, o), wacht = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    Object.assign(this, { naam, url, body, grootte, max, meld, wis, haal, wacht });
    this.rij = [];
    this.inRij = 0;
    this.bezig = false;
    this.t = nieuweToestand();
    this.storing = false;
    this.weg = 0;               // stukken die wegvielen (rij vol of opgegeven)
    this.gestopt = false;
  }

  /** Een stuk erbij (houdt de volgorde). */
  zet(stuk) {
    const g = this.grootte(stuk);
    if (this.inRij + g > this.max) {
      this.weg++;
      this.meld?.(`${this.naam}: de server is te lang weg; dit stuk valt weg (stilte op zijn plek)`, 'fout', this.naam);
      return;
    }
    this.rij.push(stuk); this.inRij += g;
    if (!this.bezig) this._loop();
  }

  async _loop() {
    this.bezig = true;
    while (this.rij.length) {
      const stuk = this.rij[0];
      const { body, type } = this.body(stuk);
      const r = await herhaal({
        doe: () => this.haal(this.url(stuk), { method: 'POST', headers: { 'content-type': type }, body, signal: tijdslot() }),
        mag: () => !this.gestopt || Date.now() < this.stopTot,     // na stop nog even (v1: 10 s)
        wacht: this.wacht,
        t: this.t,
        bijWeg: (fout) => {
          if (!this.storing) this.meld?.(`${this.naam}: de server antwoordt niet (${fout}); ik blijf het proberen`, 'fout', this.naam);
          this.storing = true;
        },
      });
      if (r.ok) {
        await r.res.arrayBuffer().catch(() => {});      // altijd lezen (v1 leesWeg: anders houdt Chrome het vast)
        if (this.storing) { this.storing = false; this.meld?.(`${this.naam}: weer goed`, 'info', this.naam); }
      } else {
        this.weg++;
        this.meld?.(`${this.naam}: een stuk kwam niet aan (${r.fout})`, 'fout', this.naam);
      }
      this.rij.shift(); this.inRij -= this.grootte(stuk);
    }
    this.bezig = false;
  }

  /** Stoppen: wat in de rij staat krijgt nog `ms` om aan te komen. */
  stop(ms = 10000) { this.gestopt = true; this.stopTot = Date.now() + ms; return this.leeg(ms); }

  /** Wacht tot de rij leeg is, hooguit `ms`. */
  async leeg(ms = 10000) {
    const eind = Date.now() + ms;
    while ((this.rij.length || this.bezig) && Date.now() < eind) await this.wacht(50);
    return this.rij.length === 0;
  }
}

/** De twee schrijvers van een set: de opname (Int16) en het log (ASCII). */
export function schrijversVoor({ meld }) {
  const opname = new Schrijver({
    naam: 'opname',
    url: (s) => `/api/v2/opname/${s.id}?frame=${s.frame}`,
    body: (s) => ({ body: s.data, type: 'application/octet-stream' }),
    grootte: (s) => s.data.byteLength,
    max: 300 * 48000 * 4,          // 300 s (~57 MB): de eerste 5 minuten van een storing (v1 AR10)
    meld,
  });
  const log = new Schrijver({
    naam: 'log',
    url: (s) => `/api/v2/log/${s.id}?van=${s.van}`,
    body: (s) => ({ body: s.tekst, type: 'text/plain' }),
    grootte: (s) => s.tekst.length,
    max: 16 * 1024 * 1024,
    meld,
  });
  return { opname, log };
}
