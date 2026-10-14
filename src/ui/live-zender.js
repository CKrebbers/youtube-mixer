/**
 * De mixer zendt naar de server, voor panelen op een ander apparaat (werkruimte S7,
 * docs/WERKRUIMTE.md C4, docs/werkruimte/S7.md): POST /api/paneel/van-mixer.
 *
 * - Alleen het tabblad dat `isEerste()` is (de lockhouder, met ?hub= het verbonden tabblad:
 *   statusVanMij in app.js). Een tweede tabblad zendt niets (en de server negeert het ook).
 * - Alleen als er een KIJKER is: de server zegt het in elk antwoord. Zonder kijker vraagt hij
 *   hooguit 1×/s GET /api/paneel/kijkers (geen POST, niets gebouwd).
 * - Gebundeld: één POST per BUNDEL_MS (20 ms), nooit twee tegelijk. Reads alleen bij verschil,
 *   ≤ 10/s per id; een tijdlijn bij elke nieuwe segId (of gridVersie, wacht, rem); de klok 1×/s (en
 *   meteen, hooguit 10×/s, als de audioklok > 1 ms versprong: een haper van het apparaat);
 *   de maatgever en de werkruimte (panelen, labels, badges, kaart) als ze veranderen.
 * - Elke fetch leest zijn antwoord (leesWeg/json): anders houdt Chrome hem vast.
 * - Valt de server weg: terug naar 1×/s vragen, en bij een kijker eerst een volledige stand.
 *
 * Wat de mixer weet komt van `bron` (src/ui/aanhakers/schermen.js): nodig() = de actions die de
 * panelen lezen, read(id), decks() = { id: { info, tl } }, maatgever(), werkBericht() (met
 * zijn sleutel). De zender zelf kent geen engine en geen DOM.
 *
 * Regel 3: de timer zegt alleen WANNEER er gekeken wordt; posities gaan als segment mee.
 */
import { MAX_POST, BUNDEL_MS, KLOK_MS, KLOK_SPRONG_MS, PING_RONDJES, rond, readsVerschil, tijdlijnKlein, tijdlijnSleutel, besteMeting, klokVerschil } from '../paneel/protocol.js';
import { leesWeg } from '../lib/antwoord.js';

export const VRAAG_MS = 1000;
const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
export const PING_MS = 10000;
/** Een klokbericht hooguit zo vaak (alleen als de audioklok verspringt; anders 1×/s). */
export const KLOK_MIN_MS = 100;
const WERK_MS = 250;

export function startLiveZender({ bron, isEerste, tab, fetch: f = (...a) => globalThis.fetch(...a),
  nu = () => globalThis.performance.now(), setInterval: si = (...a) => globalThis.setInterval(...a),
  clearInterval: ci = (...a) => globalThis.clearInterval(...a), ctx = null, meld = null } = {}) {
  const stats = { teGroot: 0, posts: 0, vragen: 0, berichten: 0, tijdlijnen: 0, standen: 0, fouten: 0, bytes: 0 };
  let kijkers = 0;
  let moetStand = true;
  let bezig = false;
  let laatstGevraagd = -Infinity, laatsteKlok = -Infinity, laatstePing = -Infinity, laatsteWerk = -Infinity;
  let verschil = null;
  let verstuurd = null;        // het laatst verstuurde klokbericht
  const metingen = [];
  const verzonden = new Map();         // read-id -> { v, t }
  const tlSleutels = new Map();        // deck -> sleutel
  const deckSleutels = new Map();      // deck -> sleutel van de info
  let maatgever, werkSleutel = null;
  const geraakt = new Set();

  const post = async (berichten) => {
    const body = JSON.stringify({ tab, berichten });
    const bytes = encoder ? encoder.encode(body).length : body.length * 3;   // de server telt bytes (é, emoji)
    if (bytes > MAX_POST) {
      // De server breekt dit af; elke seconde opnieuw proberen helpt niet. Eén melding.
      stats.teGroot++;
      if (stats.teGroot === 1) meld?.(`schermen: wat de mixer naar de iPad stuurt is te groot (${Math.round(bytes / 1024)} kB, hooguit ${MAX_POST / 1024} kB): minder panelen of kortere`);
      const f2 = new Error('te groot'); f2.teGroot = true; throw f2;
    }
    stats.bytes += body.length;
    const r = await f('/api/paneel/van-mixer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    stats.posts++;
    const d = r.ok ? await r.json().catch(() => null) : (await leesWeg(r), null);
    if (!r.ok || !d) throw new Error(`van-mixer: ${r.status}`);
    return d;
  };

  const vraag = async () => {
    stats.vragen++;
    const r = await f('/api/paneel/kijkers', { cache: 'no-store' });
    const d = r.ok ? await r.json().catch(() => null) : (await leesWeg(r), null);
    return d;
  };

  const ping = async () => {
    const rondjes = [];
    for (let i = 0; i < PING_RONDJES; i++) {
      const a = nu();
      const r = await f('/api/paneel/ping', { cache: 'no-store' });
      const d = r.ok ? await r.json().catch(() => null) : (await leesWeg(r), null);
      const b = nu();
      if (Number.isFinite(d?.t)) rondjes.push({ a, s: d.t, b });
    }
    const k = klokVerschil(rondjes);
    if (k) verschil = k.verschil;
  };

  /** De klok: uit de metingen van de laatste ~1,2 s (besteMeting), in de klok van de server. */
  const klokBericht = () => {
    const c = ctx?.();
    if (!c || verschil === null) return null;
    const best = besteMeting(metingen);
    if (!best) return null;
    return { t: 'klok', ctxT: best.ctxT, srvT: best.perf + verschil, V: bron.V(), loopt: c.state === 'running' };
  };

  const decksBerichten = (alles) => {
    const uit = [];
    const decks = bron.decks();
    for (const id of Object.keys(decks)) {
      const { info, tl, sleutel } = decks[id];
      if (alles || deckSleutels.get(id) !== sleutel) { deckSleutels.set(id, sleutel); if (!alles) uit.push({ t: 'deck', deck: id, info }); }
      const k = tijdlijnKlein(tl);
      const ks = tijdlijnSleutel(k);
      if (alles || tlSleutels.get(id) !== ks) { tlSleutels.set(id, ks); if (!alles) { uit.push({ t: 'tijdlijn', deck: id, tl: k }); stats.tijdlijnen++; } }
    }
    for (const id of [...deckSleutels.keys()]) {
      if (decks[id]) continue;
      deckSleutels.delete(id); tlSleutels.delete(id);
      if (!alles) uit.push({ t: 'deck', deck: id, info: null }, { t: 'tijdlijn', deck: id, tl: null });
    }
    return { uit, decks };
  };

  const standBericht = (n) => {
    verzonden.clear();
    const reads = {};
    for (const id of bron.nodig()) { const v = rond(bron.read(id)); reads[id] = v; verzonden.set(id, { v, t: n }); }
    const { decks } = decksBerichten(true);
    const di = {}, tl = {};
    for (const id of Object.keys(decks)) { di[id] = decks[id].info; tl[id] = tijdlijnKlein(decks[id].tl); }
    maatgever = bron.maatgever();
    const w = bron.werkBericht();
    werkSleutel = w.sleutel;
    laatsteWerk = n;
    const k = klokBericht();
    if (k) { laatsteKlok = n; verstuurd = k; }
    geraakt.clear();
    return { t: 'stand', reads, decks: di, tijdlijn: tl, maatgever, klok: k ? { ctxT: k.ctxT, srvT: k.srvT, V: k.V, loopt: k.loopt } : null, werkruimte: w.w };
  };

  const berichtenNu = (n) => {
    if (moetStand) { moetStand = false; stats.standen++; return [standBericht(n)]; }
    const uit = [];
    const reads = {};
    for (const id of bron.nodig()) reads[id] = rond(bron.read(id));
    const v = readsVerschil(reads, verzonden, n);
    if (v || geraakt.size) uit.push({ t: 'verschil', reads: v?.reads ?? {}, ...(geraakt.size ? { geraakt: [...geraakt] } : {}) });
    geraakt.clear();
    uit.push(...decksBerichten(false).uit);
    const m = bron.maatgever();
    if (m !== maatgever) { maatgever = m; uit.push({ t: 'maatgever', id: m }); }
    if (n - laatsteWerk >= WERK_MS) {
      laatsteWerk = n;
      const w = bron.werkBericht();
      if (w.sleutel !== werkSleutel) { werkSleutel = w.sleutel; uit.push({ t: 'werkruimte', w: w.w }); }
    }
    // De klok 1×/s, en meteen (hooguit 10×/s) als de audioklok versprong ten opzichte van de vorige.
    if (n - laatsteKlok >= KLOK_MIN_MS) {
      const k = klokBericht();
      const sprong = k && verstuurd && Math.abs(k.ctxT - (verstuurd.ctxT + (k.srvT - verstuurd.srvT) / 1000)) * 1000 > KLOK_SPRONG_MS;
      if (k && (n - laatsteKlok >= KLOK_MS || sprong)) { laatsteKlok = n; verstuurd = k; uit.push(k); }
    }
    return uit;
  };

  async function tik() {
    if (bezig) return;
    if (!isEerste()) { kijkers = 0; moetStand = true; return; }
    const n = nu();
    try {
      bezig = true;
      if (kijkers <= 0) {
        if (n - laatstGevraagd < VRAAG_MS) return;
        laatstGevraagd = n;
        const d = await vraag();
        kijkers = d?.kijkers ?? 0;
        if (kijkers > 0) { moetStand = true; metingen.length = 0; }
        if (kijkers > 0 && verschil === null) { await ping(); laatstePing = nu(); }
        return;
      }
      // Een meting van de klok per tik (voor de beste van de laatste seconde).
      const c = ctx?.();
      if (c) {
        metingen.push({ ctx: c.currentTime, perf: nu() });
        if (metingen.length > 50) metingen.shift();
      }
      if (n - laatstePing >= PING_MS) { laatstePing = n; await ping(); }
      const lijst = berichtenNu(n);
      if (!lijst.length) return;
      stats.berichten += lijst.length;
      const d = await post(lijst);
      kijkers = d.kijkers ?? 0;
      if (d.genegeerd) { kijkers = 0; laatstGevraagd = nu(); }   // een ander tabblad telt nog: terug naar 1×/s vragen
      if (d.vers === false || d.genegeerd) moetStand = true;
    } catch (err) {
      stats.fouten++;
      kijkers = 0; moetStand = true; laatstGevraagd = nu();
      // Te groot: de server is er gewoon; pas over 5 s opnieuw proberen (de melding kwam al).
      if (err?.teGroot) { laatstGevraagd = nu() + 4000; return; }
      // De server is weg (of antwoordt raar): terug naar 1×/s vragen, en straks eerst een stand.
      // Een server die terugkomt is een nieuw proces met een eigen klok: eerst opnieuw pingen.
      verschil = null; verstuurd = null;
    } finally { bezig = false; }
  }

  const timer = si(() => { tik(); }, BUNDEL_MS);
  return {
    stats,
    get kijkers() { return kijkers; },
    get verschil() { return verschil; },
    /** Een action liep (bijInvoke): meegeven als hij in een paneel staat (voor het oplichten). */
    geraakt(id) { if (kijkers > 0 && bron.nodig().has(id)) geraakt.add(id); },
    tik,
    /**
     * Stoppen (terug naar standaard, de pagina gaat weg): als er iemand keek, nog één 'weg', zodat
     * de iPad de oude stand niet vasthoudt. keepalive: hij gaat ook nog als de pagina sluit.
     */
    stop() {
      ci(timer);
      if (kijkers > 0 && isEerste()) {
        try { f('/api/paneel/van-mixer', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab, berichten: [{ t: 'weg' }] }) }).then(leesWeg, () => {}); } catch (_) {}
      }
      kijkers = 0;
    },
  };
}
