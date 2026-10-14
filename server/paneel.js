import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isBericht, pasToe, legeStand, alsBericht, MAX_STAND, grootte, isInvoke } from '../src/paneel/protocol.js';

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
    this._gestopt = new Set();  // tab:sessie die 'weg' zeiden (hooguit 64)
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
    // Een sessie van de zender die al 'weg' zei: wat er nog onderweg was, telt niet meer.
    const sessie = typeof body?.sessie === 'string' ? `${tab}:${body.sessie.slice(0, 32)}` : null;
    if (sessie && this._gestopt.has(sessie)) { this.stats.genegeerd++; return { kijkers: this.aantal, vers: false, genegeerd: true }; }
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
      if (b.t === 'weg') {
        if (this.vers) { this.vers = false; door.push({ t: 'weg' }); }
        this.tabT = 0;
        if (sessie) { this._gestopt.add(sessie); if (this._gestopt.size > 64) this._gestopt.delete(this._gestopt.values().next().value); }
        continue;
      }
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
    // (Weghalen vóór end(): zijn 'close' ziet hem dan niet meer en meldt de pagina niet als weg.)
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
    const weg = () => {
      const was = this.kijkers.delete(k);
      if (!this.kijkers.size) { this.vers = false; this._stopHb(); }
      // S8: de pagina is weg (geen andere verbinding met dezelfde id): wat hij vasthield gaat los.
      if (was && pagina && ![...this.kijkers].some((x) => x.pagina === pagina)) { try { this.bijWeg?.(pagina); } catch (_) {} }
    };
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

// ================================================================================================
// DE SCHRIJFWEG (werkruimte S8, Clay 14 okt W1 = ja: "iPad mag de mixer ook bedienen", en de iPhone
// als xy-pad; docs/WERKRUIMTE.md C4 "Veiligheid", docs/werkruimte/S8.md). De eerste weg waarlangs
// iets van BUITEN de Mac de mixer stuurt. Lagen, van buiten naar binnen:
//   1. de schakelaar: uit = elke route van de iPad 404 (ook koppelen). Na een herstart van de server
//      staat hij UIT (bewust: aanzetten is een handeling in de Controlekamer, nooit een overblijfsel);
//   2. Host/Origin: server/index.js (vreemdVerzoek: alleen localhost of VARVE_HOSTS, de tailnet),
//      en hier: de Origin moet er ZIJN en precies de eigen pagina zijn;
//   3. koppelen: een code van 6 cijfers uit de Controlekamer (60 s, één keer, 5 pogingen) geeft een
//      token van 32 bytes in een HttpOnly; Secure; SameSite=Strict-cookie. Bewaard wordt alleen de
//      SHA-256 ervan, per apparaat een naam en het scherm waarvoor het gekoppeld is;
//   4. de rem (120 invokes/s per apparaat en scherm, 429) en `seq` tegen dubbel;
//   5. de MIXER beslist (src/paneel/uitvoer.js): alleen wat in de panelen van dat scherm in het
//      actieve deel staat, magOpScherm, VAST_NOOIT. Hij antwoordt per invoke; dat antwoord gaat terug.
// Loslaten bij wegvallen: hoorde de server van een pagina die iets vasthoudt 1,5 s niets (een invoke,
// een ping met ?k=, of zijn SSE ging dicht), dan zegt hij de mixer `los` voor die pagina. De mixer
// laat zelf ook alles los als dit kanaal 1,5 s stil is (de server weg).
// ================================================================================================

export const CODE_MS = 60000;
export const CODE_POGINGEN = 5;
export const REM_PER_S = 120;
export const LOS_MS = 1500;
export const ANTWOORD_MS = 1000;
export const MIXER_HB_MS = 500;
export const MAX_APPARATEN = 16;
export const COOKIE = 'varve_paneel';
const SEQ_ONTHOUD = 256;

/** p50 en p99 (ms) van de laatste rondjes server -> mixer -> server. */
function duurStats(d) {
  if (!d?.length) return { mixer_p50: null, mixer_p99: null };
  const x = [...d].sort((a, b) => a - b);
  return { mixer_p50: Math.round(x[x.length >> 1] * 100) / 100, mixer_p99: Math.round(x[Math.min(x.length - 1, Math.floor(x.length * 0.99))] * 100) / 100 };
}
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

/** De cookie `naam` uit een Cookie-kop, of null. */
export function leesCookie(kop, naam = COOKIE) {
  for (const deel of String(kop ?? '').split(';')) {
    const i = deel.indexOf('=');
    if (i > 0 && deel.slice(0, i).trim() === naam) return deel.slice(i + 1).trim() || null;
  }
  return null;
}

/**
 * De oorsprong van de eigen pagina zoals de browser hem stuurt: http://localhost:8777 op de Mac,
 * https://<naam>.ts.net via tailscale serve (Host zonder poort, of :443). null = geen Host.
 */
export function eigenOrigin(req) {
  const host = String(req?.headers?.host ?? '').toLowerCase();
  if (!host) return null;
  if (/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) return `http://${host}`;
  return `https://${host.replace(/:443$/, '')}`;
}

/** Moet precies de eigen pagina zijn (en er zijn: zonder Origin is het geen browser op onze pagina). */
export function origineGoed(req) {
  const o = req?.headers?.origin;
  if (typeof o !== 'string') return false;
  const eigen = eigenOrigin(req);
  return !!eigen && o.toLowerCase() === eigen;
}

export class PaneelSchrijf {
  /**
   * @param bestand  waar de gekoppelde apparaten staan (JSON, alleen hashes), of null (geheugen)
   * @param klok     ms
   */
  constructor({ bestand = null, klok = () => performance.timeOrigin + performance.now(), setInterval: si = setInterval,
    clearInterval: ci = clearInterval, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout, relais = null } = {}) {
    Object.assign(this, { bestand, klok, _si: si, _ci: ci, _st: st, _ct: ct, relais });
    this.aan = false;
    this.code = null;               // { code, tot, pogingen }
    this.apparaten = new Map();     // id -> { id, naam, scherm, hash, sinds, laatst }
    this.mixers = new Set();        // { res, tab }
    this._n = 0;
    this._wacht = new Map();        // n -> { klaar, timer }
    this._seqs = new Map();         // `${apparaat}:${k}` -> Map(seq -> antwoord-promise)
    this._rem = new Map();          // `${apparaat}:${scherm}` -> [tijden]
    this._vast = new Map();         // k -> { scherm, apparaat, ids: Set, laatst }
    this.stats = { invokes: 0, doorgestuurd: 0, dubbel: 0, te_snel: 0, geweigerd: 0, los: 0, zonderMixer: 0, traag: 0 };
    this._lees();
    if (relais) relais.bijWeg = (k) => this._weg(k);
    this._klok = null;
  }

  // ---- schakelaar en apparaten (alleen vanaf deze Mac, de Controlekamer) ----------------------

  zetAan(aan) {
    this.aan = !!aan;
    if (!this.aan) {
      this.code = null;
      // Uit: alles wat iemand vasthoudt los, en de mixer weet dat er niets meer komt.
      for (const k of [...this._vast.keys()]) this._laatLos(k, 'schrijfweg uit');
      this._naarMixer({ t: 'uit' });
      this._stopKlok();
    } else this._startKlok();
    return this.stand();
  }

  /** Een nieuwe koppelcode (de vorige vervalt). */
  nieuweCode() {
    if (!this.aan) return null;
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    this.code = { code, tot: this.klok() + CODE_MS, pogingen: 0 };
    return { code, geldig_ms: CODE_MS };
  }

  stand() {
    const nu = this.klok();
    return {
      aan: this.aan,
      code: this.code && this.code.tot > nu ? { code: this.code.code, nog_ms: Math.round(this.code.tot - nu) } : null,
      apparaten: [...this.apparaten.values()].map((a) => ({ id: a.id, naam: a.naam, scherm: a.scherm, sinds: a.sinds, laatst: a.laatst })),
      mixer: this.mixers.size > 0,
      vast: [...this._vast.values()].reduce((n, v) => n + v.ids.size, 0),
      stats: { ...this.stats, ...duurStats(this._duur) },
    };
  }

  intrekken(id) {
    const a = this.apparaten.get(id);
    if (!a) return false;
    this.apparaten.delete(id);
    for (const [k, v] of [...this._vast]) if (v.apparaat === id) this._laatLos(k, 'ingetrokken');
    this._schrijf();
    return true;
  }

  // ---- koppelen (de iPad) --------------------------------------------------------------------

  /** { code, naam, scherm } -> { ok, token, apparaat } of { status, fout }. */
  koppel({ code, naam, scherm } = {}) {
    if (!this.aan) return { status: 404, fout: 'onbekend eindpunt' };
    const c = this.code;
    const nu = this.klok();
    if (!c || c.tot <= nu) { this.code = null; return { status: 403, fout: 'geen geldige code: maak er een in de Controlekamer (60 s geldig)' }; }
    if (typeof code !== 'string' || !/^\d{6}$/.test(code) || code !== c.code) {
      if (++c.pogingen >= CODE_POGINGEN) this.code = null;
      return { status: 403, fout: this.code ? 'verkeerde code' : 'verkeerde code; deze code is nu ongeldig, maak een nieuwe' };
    }
    if (typeof scherm !== 'string' || !/^[a-z0-9-]{1,16}$/.test(scherm)) return { status: 400, fout: 'scherm ontbreekt (?s=ipad in het adres)' };
    this.code = null;                                  // één keer
    if (this.apparaten.size >= MAX_APPARATEN) {
      const oudste = [...this.apparaten.values()].sort((a, b) => a.laatst - b.laatst)[0];
      this.apparaten.delete(oudste.id);
    }
    const token = randomBytes(32).toString('base64url');
    const id = randomBytes(6).toString('hex');
    const nm = typeof naam === 'string' && naam.trim() ? naam.trim().slice(0, 32) : scherm;
    const a = { id, naam: nm, scherm, hash: sha(token), sinds: Date.now(), laatst: Date.now() };
    this.apparaten.set(id, a);
    this._schrijf();
    return { ok: true, token, apparaat: { id, naam: nm, scherm } };
  }

  /** Het apparaat bij deze cookie, of null. */
  apparaatVan(req) {
    const t = leesCookie(req?.headers?.cookie);
    if (!t || t.length > 100) return null;
    const h = sha(t);
    for (const a of this.apparaten.values()) if (a.hash === h) return a;
    return null;
  }

  // ---- invoke (de iPad) ----------------------------------------------------------------------

  /**
   * Een invoke van apparaat `a`. Geeft een Promise van { status, antwoord }.
   * Volgorde: seq (dubbel = hetzelfde antwoord, niets opnieuw), rem, de mixer.
   */
  invoke(a, b) {
    this.stats.invokes++;
    if (!isInvoke(b)) return Promise.resolve({ status: 400, antwoord: { ok: false, reden: 'geen invoke ({ t: "invoke", id, v, druk, seq, scherm })' } });
    if (b.scherm !== a.scherm) return Promise.resolve({ status: 403, antwoord: { ok: false, seq: b.seq, reden: `dit apparaat is gekoppeld als "${a.scherm}", niet "${b.scherm}"` } });
    const k = typeof b.k === 'string' && /^[a-z0-9]{8,40}$/.test(b.k) ? b.k : 'zonder';
    const nu = this.klok();
    a.laatst = Date.now();
    this._levend(k, nu);
    // Dubbel (een herhaalde POST na een verloren antwoord): hetzelfde antwoord, de mixer hoort het niet nog eens.
    const sk = `${a.id}:${k}`;
    let seqs = this._seqs.get(sk);
    if (!seqs) { seqs = new Map(); this._seqs.set(sk, seqs); if (this._seqs.size > 64) this._seqs.delete(this._seqs.keys().next().value); }
    const al = seqs.get(b.seq);
    if (al) { this.stats.dubbel++; return al.then((r) => ({ ...r, antwoord: { ...r.antwoord, dubbel: true } })); }
    // De rem: 120 per seconde per apparaat en scherm. Loslaten gaat er altijd door (anders blijft iets hangen).
    const rk = `${a.id}:${b.scherm}`;
    const tijden = this._rem.get(rk) ?? [];
    while (tijden.length && nu - tijden[0] >= 1000) tijden.shift();
    if (b.druk === 'los') {
      // Loslaten gaat langs de rem (anders blijft er iets hangen), maar alleen als er voor die pagina iets vastzit
      // of een 'aan' onderweg is; anders zou een vloed van 'los' de rem omzeilen (review S8 ronde 1, punt 6).
      // Ook een 'aan' waarvan het antwoord te laat kan komen (_laat): anders gaat deze 'los' verloren en zet het late
      // antwoord de knop daarna alsnog vast (review S8 ronde 2, B1).
      const zelfde = (w) => w.k === k && w.b.id === b.id && w.b.druk === 'aan';
      const vast = this._vast.get(k)?.ids.has(b.id) || [...this._wacht.values()].some(zelfde) || [...(this._laat?.values() ?? [])].some(zelfde);
      if (!vast) return Promise.resolve({ status: 200, antwoord: { t: 'antwoord', seq: b.seq, ok: false, reden: 'niets vast' } });
      // Onthouden: een laat 'ja' op een oudere 'aan' mag hem daarna niet weer vastzetten (review S8 ronde 2, B1).
      const ls = (this._losSeq ??= new Map());
      ls.set(`${k}|${b.id}`, b.seq);
      if (ls.size > 512) ls.delete(ls.keys().next().value);
    } else {
      if (tijden.length >= REM_PER_S) {
        this.stats.te_snel++;
        return Promise.resolve({ status: 429, antwoord: { ok: false, seq: b.seq, reden: `te snel: hooguit ${REM_PER_S} per seconde` } });
      }
      tijden.push(nu);
      this._rem.set(rk, tijden);
    }
    const p = this._stuur(a, b, k);
    seqs.set(b.seq, p);
    if (seqs.size > SEQ_ONTHOUD) seqs.delete(seqs.keys().next().value);
    return p;
  }

  _stuur(a, b, k) {
    if (!this.mixers.size) { this.stats.zonderMixer++; return Promise.resolve({ status: 503, antwoord: { ok: false, seq: b.seq, reden: 'de mixer luistert niet (geen werkruimte, of het tabblad met de APC is dicht)' } }); }
    const n = ++this._n;
    return new Promise((klaar) => {
      const timer = this._st(() => {
        const w = this._wacht.get(n);
        this._wacht.delete(n);
        // Nog even onthouden: een laat antwoord op een 'aan' moet de server alsnog vasthouden (zie antwoord).
        if (w) { (this._laat ??= new Map()).set(n, w); if (this._laat.size > 64) this._laat.delete(this._laat.keys().next().value); }
        this.stats.traag++;
        klaar({ status: 504, antwoord: { ok: false, seq: b.seq, reden: 'de mixer antwoordde niet binnen 1 s' } });
      }, ANTWOORD_MS);
      this._wacht.set(n, { klaar, timer, b, k, a, t0: this.klok() });
      this.stats.doorgestuurd++;
      this._naarMixer({ t: 'invoke', n, id: b.id, v: b.v, druk: b.druk, seq: b.seq, scherm: b.scherm, k, apparaat: a.naam });
    });
  }

  /** Het antwoord van de mixer: { n, ok, reden?, read? }. */
  antwoord(d) {
    const w = this._wacht.get(d?.n);
    if (!w) {
      // Te laat (na de time-out van 1 s): de iPad kreeg 504, maar de mixer voerde het wel uit. Hield hij iets
      // vast, dan weet de server het nu alsnog: valt de pagina weg, dan gaat het los (review S8 ronde 1, punt 2).
      const l = this._laat?.get(d?.n);
      const losNa = this._losSeq?.get(`${l?.k}|${l?.b.id}`) > l?.b.seq;
      if (l && d.ok === true && l.b.druk === 'aan' && !losNa) this._houd(l.k, l.b.scherm, l.a.id, l.b.id);
      if (l && d.ok === true && l.b.druk === 'los') this._vast.get(l.k)?.ids.delete(l.b.id);
      this._laat?.delete(d?.n);
      return false;
    }
    this._wacht.delete(d.n);
    this._ct(w.timer);
    // Hoe lang de mixer erover deed (server -> mixer -> server), de laatste 256: voor de Controlekamer en de proef.
    (this._duur ??= []).push(this.klok() - w.t0);
    if (this._duur.length > 256) this._duur.shift();
    const ok = d.ok === true;
    if (!ok) this.stats.geweigerd++;
    // Wat met druk 'aan' binnenkwam en uitgevoerd werd, houdt de pagina vast tot 'los' (of wegvallen).
    if (ok && w.b.druk === 'aan') this._houd(w.k, w.b.scherm, w.a.id, w.b.id);
    if (w.b.druk === 'los' && ok) this._vast.get(w.k)?.ids.delete(w.b.id);
    w.klaar({ status: ok ? 200 : d.status === 409 ? 409 : 403,
      antwoord: { t: 'antwoord', seq: w.b.seq, ok, ...(typeof d.reden === 'string' ? { reden: d.reden.slice(0, 200) } : {}), ...(d.read !== undefined ? { read: d.read } : {}) } });
    return true;
  }

  // ---- levend en loslaten --------------------------------------------------------------------

  /** Een teken van leven van pagina k (een invoke, een ping met ?k=). */
  levend(k) { if (typeof k === 'string') this._levend(k, this.klok()); }
  _levend(k, nu) { const v = this._vast.get(k); if (v) v.laatst = nu; }

  _houd(k, scherm, apparaat, id) {
    let v = this._vast.get(k);
    if (!v) { v = { scherm, apparaat, ids: new Set(), laatst: this.klok() }; this._vast.set(k, v); }
    v.ids.add(id);
  }

  /** De SSE van pagina k ging dicht: meteen los. */
  _weg(k) { if (this._vast.has(k)) this._laatLos(k, 'verbinding weg'); }

  _laatLos(k, reden) {
    const v = this._vast.get(k);
    this._vast.delete(k);
    if (!v) return;
    this.stats.los++;
    this._naarMixer({ t: 'los', k, scherm: v.scherm, reden });
  }

  /** Elke 250 ms: wie 1,5 s niets zei terwijl hij iets vasthoudt, laat los. */
  kijk() {
    const nu = this.klok();
    for (const [k, v] of [...this._vast]) {
      if (!v.ids.size) { this._vast.delete(k); continue; }
      if (nu - v.laatst > LOS_MS) this._laatLos(k, `1,5 s niets van ${v.scherm}`);
    }
    this._naarMixer({ t: 'hb' });
  }

  _startKlok() {
    if (this._klok || !this._si) return;
    this._klok = this._si(() => this.kijk(), 250);
    this._klok?.unref?.();
  }
  _stopKlok() { if (this._klok) { this._ci(this._klok); this._klok = null; } }

  // ---- het kanaal naar de mixer (SSE, alleen vanaf deze Mac) -----------------------------------

  /** GET /api/paneel/naar-mixer?tab=: de mixer luistert. Eén tegelijk: het tabblad van de relais, anders de eerste. */
  mixer(req, res, { tab = null } = {}) {
    // Eén mixer: hetzelfde tabblad dat opnieuw verbindt vervangt zijn vorige verbinding; een ANDER tabblad
    // (bv. localhost en 127.0.0.1: twee oorsprongen, elk een eigen Web Lock) wordt geweigerd zolang de eerste
    // leeft, anders gooien ze elkaar om de 500 ms eruit en komt een 'los' bij de verkeerde (review S8 ronde 1, punt 1).
    // En het tabblad dat de stand zendt (de relais) wint: de iPad ziet de stand van dat tabblad, dus daar horen zijn
    // invokes ook heen (review S8 ronde 2, B2). Een ander tabblad dat zich meldt terwijl de relais een levend tabblad
    // heeft, wordt geweigerd; het tabblad van de relais neemt een verbinding van een ander tabblad over.
    const r = this.relais;
    const zendt = r?.tab && r.klok() - r.tabT <= TAB_STIL_MS ? r.tab : null;
    const weiger = () => {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ fout: 'een ander tabblad van de mixer luistert al' }));
      return null;
    };
    if (zendt && tab !== zendt) return weiger();
    for (const m of this.mixers) {
      if (m.tab !== tab && m.tab !== null && tab !== zendt && !m.res.destroyed && !m.res.writableEnded) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ fout: 'een ander tabblad van de mixer luistert al' }));
        return null;
      }
    }
    for (const m of this.mixers) { this.mixers.delete(m); try { m.res.end(); } catch (_) {} }
    try { req?.socket?.setKeepAlive?.(true, 2000); req?.socket?.setNoDelay?.(true); } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 500\n\ndata: ${JSON.stringify({ t: 'hallo', aan: this.aan })}\n\n`);
    const m = { res, tab };
    this.mixers.add(m);
    const weg = () => {
      if (!this.mixers.delete(m)) return;
      // Geen mixer meer: wie nu nog wacht, krijgt meteen een antwoord.
      for (const [n, w] of [...this._wacht]) { this._ct(w.timer); this._wacht.delete(n); w.klaar({ status: 503, antwoord: { ok: false, seq: w.b.seq, reden: 'de mixer is weg' } }); }
    };
    res.on?.('close', weg);
    req?.on?.('close', weg);
    // Een hartslag ook als de schrijfweg uit staat: de mixer ziet zo dat de server er is.
    if (!this._mhb && this._si) { this._mhb = this._si(() => { if (!this.aan) this._naarMixer({ t: 'hb' }); }, MIXER_HB_MS); this._mhb?.unref?.(); }
    return m;
  }

  _naarMixer(b) {
    if (!this.mixers.size) return;
    const tekst = `data: ${JSON.stringify(b)}\n\n`;
    for (const m of this.mixers) { try { m.res.write(tekst); } catch (_) { this.mixers.delete(m); } }
  }

  sluit() {
    this._stopKlok();
    if (this._mhb) { this._ci(this._mhb); this._mhb = null; }
    for (const m of this.mixers) { try { m.res.end(); } catch (_) {} }
    this.mixers.clear();
    for (const w of this._wacht.values()) this._ct(w.timer);
    this._wacht.clear();
  }

  // ---- bewaren (alleen hashes) ---------------------------------------------------------------

  _lees() {
    if (!this.bestand) return;
    try {
      const d = JSON.parse(readFileSync(this.bestand, 'utf8'));
      for (const a of Array.isArray(d?.apparaten) ? d.apparaten : []) {
        if (a && /^[0-9a-f]{12}$/.test(a.id) && /^[0-9a-f]{64}$/.test(a.hash) && typeof a.scherm === 'string') {
          this.apparaten.set(a.id, { id: a.id, naam: String(a.naam ?? a.scherm).slice(0, 32), scherm: a.scherm, hash: a.hash, sinds: a.sinds ?? 0, laatst: a.laatst ?? 0 });
        }
      }
    } catch (_) { /* geen bestand: niemand gekoppeld */ }
  }

  _schrijf() {
    if (!this.bestand) return;
    try {
      mkdirSync(dirname(this.bestand), { recursive: true });
      const tmp = `${this.bestand}.tmp`;
      writeFileSync(tmp, JSON.stringify({ apparaten: [...this.apparaten.values()] }, null, 1), { mode: 0o600 });
      renameSync(tmp, this.bestand);
    } catch (err) { console.warn('[paneel] gekoppelde apparaten niet bewaard:', err?.message || err); }
  }
}
