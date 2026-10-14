import { isBericht, pasToe, legeStand, alsBericht, MAX_STAND, grootte } from '../src/paneel/protocol.js';

/**
 * De relais voor de panelen op een ander apparaat (werkruimte S7, docs/WERKRUIMTE.md C4,
 * docs/werkruimte/S7.md). ALLEEN KIJKEN (W1): de mixer meldt wat er is, de server houdt de
 * volledige stand bij en duwt elk bericht door naar de kijkers (SSE). Er gaat in dit spoor
 * NIETS de andere kant op: geen route waarmee een kijker de mixer stuurt (dat is S8, na
 * Clay's ja).
 *
 * Nul dependencies: Server-Sent Events met node:http (een `text/event-stream` die open
 * blijft). Puur genoeg om te testen met nep-antwoorden: `res` hoeft alleen writeHead,
 * write, end en on('close') te kennen.
 *
 * Eén mixer tegelijk: berichten van een ander tabblad (een andere `tab`) tellen niet,
 * tenzij het vorige tabblad TAB_STIL_MS niets meer zei en het nieuwe met een volledige
 * stand begint. De mixer zendt zelf alleen vanuit het tabblad met de Web Lock (of met
 * ?hub= het verbonden tabblad); dit is het vangnet.
 */
export const HB_MS = 1000;
export const TAB_STIL_MS = 3000;
/**
 * Zegt de mixer zo lang niets, dan is hij weg (gecrasht): 'weg' naar de kijkers. Ruim, want een
 * verborgen tabblad krijgt van Chrome na 5 min nog maar 1 timer per minuut, en die mixer leeft
 * gewoon. Een mixer die bewust stopt (terug naar standaard, het tabblad dicht) zegt zelf 'weg'.
 */
export const MIXER_WEG_MS = 70000;
/** Hooguit zoveel kijkers tegelijk (een iPad, een tweede scherm, een proef); meer = de oudste eruit. */
export const MAX_KIJKERS = 16;
/** Een kijker die niet meer leest (de buffer loopt vol): weg, in plaats van geheugen vasthouden. */
const MAX_ACHTER = 1024 * 1024;

export class PaneelRelais {
  constructor({ klok = () => performance.timeOrigin + performance.now(), hbMs = HB_MS, setInterval: si = setInterval, clearInterval: ci = clearInterval } = {}) {
    this.klok = klok;
    this.stand = legeStand();
    this.vers = false;          // is de stand bijgehouden sinds er een kijker kwam?
    this.kijkers = new Set();
    this.tab = null;            // het tabblad van de mixer dat nu telt
    this.tabT = 0;
    this.stats = { berichten: 0, genegeerd: 0, posts: 0, naarKijkers: 0, bytes: 0, standBytes: 0 };
    this._hbMs = hbMs; this._si = si; this._ci = ci; this._hb = null;
  }

  /** Het aantal kijkers (de mixer zendt alleen als dit > 0 is). */
  get aantal() { return this.kijkers.size; }

  /**
   * Een POST van de mixer: { tab, berichten: [...] }. Geeft { kijkers, vers } terug (wat
   * de mixer moet weten: is er iemand, en moet hij een volledige stand sturen?).
   */
  vanMixer(body) {
    this.stats.posts++;
    const tab = typeof body?.tab === 'string' ? body.tab.slice(0, 64) : null;
    const lijst = Array.isArray(body?.berichten) ? body.berichten.filter(isBericht) : [];
    const nu = this.klok();
    const heeftStand = lijst.some((b) => b.t === 'stand');
    if (this.tab && tab !== this.tab) {
      // Een ander tabblad: alleen overnemen als het vorige stil is en dit met een stand begint.
      if (!(heeftStand && nu - this.tabT > TAB_STIL_MS)) {
        this.stats.genegeerd += lijst.length;
        return { kijkers: this.aantal, vers: false, genegeerd: true };
      }
    }
    if (!this.tab || tab !== this.tab) this.vers = false;
    this.tab = tab; this.tabT = nu;
    const door = [];
    for (const b of lijst) {
      // De mixer stopt bewust (terug naar standaard, het tabblad gaat dicht): de stand klopt niet meer.
      if (b.t === 'weg') { if (this.vers) { this.vers = false; door.push({ t: 'weg' }); } this.tabT = 0; continue; }
      if (!this.vers && b.t !== 'stand') continue;   // eerst een stand, anders klopt er niets
      pasToe(this.stand, b);
      if (b.t === 'stand') this.vers = true;
      door.push(b);
    }
    this.stats.berichten += door.length;
    if (door.length && this.kijkers.size) this._stuur(door);
    return { kijkers: this.aantal, vers: this.vers };
  }

  /** Alleen de mixer vragen of er iemand kijkt (zonder iets te sturen). */
  status() { return { kijkers: this.aantal, vers: this.vers }; }

  /**
   * Een nieuwe kijker (GET /api/paneel/live): de headers, `retry`, en meteen de volledige
   * stand als die vers is (anders komt hij zodra de mixer hem stuurt: die hoort in zijn
   * volgende antwoord dat er een kijker is).
   */
  kijk(req, res, { scherm = null, pagina = null } = {}) {
    // Dezelfde pagina die opnieuw verbindt (wifi haperde, de iPad kwam uit de slaap): zijn vorige
    // verbinding eruit. Die is vaak dood zonder dat de server het weet (geen FIN); zo stapelen de
    // kijkers niet op. Op de pagina-id, niet op het adres: via tailscale serve is dat altijd 127.0.0.1.
    if (pagina) for (const k of this.kijkers) if (k.pagina === pagina) { this.kijkers.delete(k); try { k.res.end(); } catch (_) {} }
    // Nog steeds vol (veel echte kijkers): de oudste eruit.
    while (this.kijkers.size >= MAX_KIJKERS) {
      const oudste = this.kijkers.values().next().value;
      this.kijkers.delete(oudste);
      try { oudste.res.end(); } catch (_) {}
    }
    // TCP-keepalive: helpt alleen op een stille socket; met hb elke seconde beslist de
    // retransmissietime-out van het systeem. De pagina-id hierboven is wat echt opruimt.
    try { req?.socket?.setKeepAlive?.(true, 5000); } catch (_) {}
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const k = { res, scherm, pagina, sinds: this.klok() };
    // retry: 1000 ms, zodat de pagina binnen 3 s terug is als de server terugkomt.
    res.write('retry: 1000\n\n');
    this.kijkers.add(k);
    const weg = () => { this.kijkers.delete(k); if (!this.kijkers.size) { this.vers = false; this._stopHb(); } };
    res.on?.('close', weg);
    req?.on?.('close', weg);
    if (this.vers) this._schrijf(k, [alsBericht(this.stand)]);
    this._startHb();
    return k;
  }

  /** De stand als bericht (voor de test en GET /api/paneel/stand), met zijn grootte. */
  standBericht() {
    const b = alsBericht(this.stand);
    return { bericht: b, bytes: grootte(b), vers: this.vers, past: grootte(b) <= MAX_STAND };
  }

  _stuur(lijst) {
    for (const k of this.kijkers) this._schrijf(k, lijst);
  }

  _schrijf(k, lijst) {
    let tekst = '';
    for (const b of lijst) {
      const s = JSON.stringify(b);
      if (b.t === 'stand') this.stats.standBytes = Buffer.byteLength(s);
      tekst += `data: ${s}\n\n`;
    }
    this.stats.naarKijkers += lijst.length;
    this.stats.bytes += tekst.length;
    try {
      // Leest de kijker niet meer (de buffer van de socket loopt vol)? Weg ermee.
      if ((k.res.writableLength ?? 0) > MAX_ACHTER) { k.res.destroy?.(); this.kijkers.delete(k); return; }
      k.res.write(tekst);
    } catch (_) { this.kijkers.delete(k); }
  }

  _startHb() {
    if (this._hb || !this._hbMs) return;
    this._hb = this._si(() => {
      if (!this.kijkers.size) { this._stopHb(); return; }
      // Zegt de mixer MIXER_WEG_MS niets meer (gecrasht), dan is de stand niet meer waar: de
    // kijkers horen 'weg' en wachten op een nieuwe.
    if (this.vers && this.klok() - this.tabT > MIXER_WEG_MS) { this.vers = false; this._stuur([{ t: 'weg' }]); }
    this._stuur([{ t: 'hb', srvT: this.klok() }]);
    }, this._hbMs);
    this._hb?.unref?.();
  }

  _stopHb() { if (this._hb) { this._ci(this._hb); this._hb = null; } }

  /** Alle kijkers dicht (de server stopt, of de test). */
  sluit() {
    for (const k of this.kijkers) { try { k.res.end(); } catch (_) {} }
    this.kijkers.clear();
    this._stopHb();
  }
}
