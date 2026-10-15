/**
 * De schrijver van een paneelpagina op de iPad of de iPhone (werkruimte S8, docs/werkruimte/S8.md):
 * wat `ServerVerbinding.zetSchrijver(fn)` krijgt. Alleen als dit apparaat GEKOPPELD is (een
 * HttpOnly-cookie die de pagina zelf niet kan lezen: `wie()` vraagt het de server).
 *
 * - Elke invoke is één POST /api/paneel/invoke (de waarden per beeld al gebundeld door vrij.js).
 *   Gaat het netwerk mis, dan nog één keer met DEZELFDE seq: de server voert hem dan niet dubbel uit.
 * - Zolang er iets vastzit (druk 'aan' zonder 'los'), elke 500 ms GET /api/paneel/ping?k=<pagina>:
 *   houdt de server 1,5 s niets van deze pagina, dan laat de mixer alles los (wifi weg, iPad op slot).
 * - Een weigering (403 met een reden, 429 te snel) gaat naar `meld`, hooguit één per seconde.
 *
 * Geen DOM, geen AudioContext, geen MIDI. Elke fetch leest zijn antwoord.
 */
import { leesWeg } from '../lib/antwoord.js';

export const PING_VAST_MS = 500;
/**
 * Een WAARDE per action hooguit eens per WAARDE_MS (de laatste wint, en de laatste gaat altijd): een xy-pad stuurt twee
 * waarden per beeld, op 120 Hz 240/s, boven de rem van de server (120/s per scherm). Zo blijft hij eronder (twee assen
 * = 100/s), en een "terug" bij loslaten wordt nooit weggegooid (review S8 ronde 1, punt 3).
 */
export const WAARDE_MS = 20;

export function maakSchrijver({ pagina, fetch: f = (...a) => globalThis.fetch(...a), meld = () => {}, nu = () => globalThis.performance.now(),
  setInterval: si = (...a) => globalThis.setInterval(...a), clearInterval: ci = (...a) => globalThis.clearInterval(...a),
  setTimeout: st = (...a) => globalThis.setTimeout(...a) } = {}) {
  const vast = new Set();
  const stats = { verstuurd: 0, ok: 0, geweigerd: 0, fouten: 0, herhaald: 0, pings: 0, rondreis: [] };
  let pinger = null, laatsteMelding = -Infinity;
  const zeg = (t) => { const n = nu(); if (n - laatsteMelding > 1000) { laatsteMelding = n; meld(t); } };

  const ping = () => {
    if (!vast.size) { ci(pinger); pinger = null; return; }
    stats.pings++;
    f(`/api/paneel/ping?k=${encodeURIComponent(pagina)}`, { cache: 'no-store' }).then(leesWeg, () => {});
  };

  const post = (body) => f('/api/paneel/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'same-origin', cache: 'no-store' });

  let gestopt = false;
  const laatsteWaarde = new Map();   // id -> tijd van de laatste verzonden waarde
  const wachtend = new Map();        // id -> { b, klaar: [resolve] }
  function schrijf(b) {
    if (b.druk) return stuur(b);
    const n = nu(), t = laatsteWaarde.get(b.id) ?? -Infinity;
    const w = wachtend.get(b.id);
    if (w) { w.b = b; return new Promise((z) => w.klaar.push(z)); }   // de laatste wint
    if (n - t >= WAARDE_MS) { laatsteWaarde.set(b.id, n); return stuur(b); }
    const nieuw = { b, klaar: [] };
    wachtend.set(b.id, nieuw);
    st(() => {
      if (gestopt || wachtend.get(b.id) !== nieuw) { for (const z of nieuw.klaar) z({ ok: false, reden: 'gestopt' }); return; }
      wachtend.delete(b.id);
      laatsteWaarde.set(b.id, nu());
      stuur(nieuw.b).then((r) => { for (const z of nieuw.klaar) z(r); });
    }, WAARDE_MS - (n - t));
    return new Promise((z) => nieuw.klaar.push(z));
  }

  async function stuur(b) {
    if (b.druk === 'aan') { vast.add(b.id); if (!pinger) pinger = si(ping, PING_VAST_MS); }
    if (b.druk === 'los') vast.delete(b.id);
    const body = JSON.stringify(b);
    const t0 = nu();
    stats.verstuurd++;
    let r;
    try { r = await post(body); } catch (_) {
      // Eén herhaling met dezelfde seq (de server telt hem dan niet dubbel).
      stats.herhaald++;
      await new Promise((k) => st(k, 100));
      try { r = await post(body); } catch (err) { stats.fouten++; zeg('geen verbinding: niet uitgevoerd'); if (b.druk === 'aan') vast.delete(b.id); return { ok: false, reden: 'netwerk' }; }
    }
    const d = await r.json().catch(() => null);
    if (d === null) await leesWeg(r);
    if (stats.rondreis.length < 2000) stats.rondreis.push(nu() - t0);
    if (r.ok && d?.ok) { stats.ok++; return d; }
    stats.geweigerd++;
    if (b.druk === 'aan') vast.delete(b.id);
    if (r.status === 401) zeg('dit scherm is niet (meer) gekoppeld');
    else if (b.druk !== 'los') zeg(d?.reden ?? `geweigerd (${r.status})`);
    return { ok: false, status: r.status, reden: d?.reden ?? null };
  }
  schrijf.stats = stats;
  schrijf.vast = vast;
  schrijf.stop = () => { ci(pinger); pinger = null; vast.clear(); gestopt = true; wachtend.clear(); };
  schrijf.wachtend = wachtend;
  return schrijf;
}

/** Is dit apparaat gekoppeld? { aan: false } als de schrijfweg uit staat (404), anders { aan, gekoppeld, naam, scherm }. */
export async function wie({ fetch: f = (...a) => globalThis.fetch(...a) } = {}) {
  let r;
  try { r = await f('/api/paneel/wie', { cache: 'no-store', credentials: 'same-origin' }); } catch (_) { return null; }
  if (r.status === 404) { await leesWeg(r); return { aan: false, gekoppeld: false }; }
  if (!r.ok) { await leesWeg(r); return null; }
  const d = await r.json().catch(() => null);
  return d ? { aan: true, ...d } : null;
}

/** Koppelen met de code uit de Controlekamer. Geeft { ok, apparaat } of { ok: false, fout }. */
export async function koppel({ code, naam, scherm }, { fetch: f = (...a) => globalThis.fetch(...a) } = {}) {
  let r;
  try {
    r = await f('/api/paneel/koppel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ code: String(code ?? '').replace(/\D/g, ''), naam, scherm }) });
  } catch (_) { return { ok: false, fout: 'geen verbinding' }; }
  const d = await r.json().catch(() => null);
  if (d === null) await leesWeg(r);
  if (r.status === 404) return { ok: false, fout: 'bedienen staat uit (zet het aan in de Controlekamer)' };
  return r.ok && d?.ok ? { ok: true, apparaat: d.apparaat } : { ok: false, fout: d?.fout ?? `fout ${r.status}` };
}
