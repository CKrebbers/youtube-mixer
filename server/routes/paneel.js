import { join } from 'node:path';
import { PaneelRelais, PaneelSchrijf, origineGoed, COOKIE } from '../paneel.js';
import { MAX_POST } from '../../src/paneel/protocol.js';

/**
 * Routes van spoor S7: het paneel voor mac-2 en de iPad (werkruimte S7, docs/WERKRUIMTE.md C4,
 * docs/werkruimte/S7.md). Na alle controles van server/index.js (Host/Origin, alleen JSON voor
 * een POST op /api/), vóór de 404.
 *
 *   POST /api/paneel/van-mixer  { tab, berichten }   alleen vanaf deze Mac (vanDezeMac): 403 anders.
 *                                                    Antwoord { kijkers, vers }.
 *   GET  /api/paneel/kijkers                         { kijkers, vers } (de mixer zonder kijker: alleen dit)
 *   GET  /api/paneel/live?s=<scherm>                 SSE: eerst de volledige stand, daarna elk bericht
 *   GET  /api/paneel/ping                            { t } de klok van de server in ms (voor het klokverschil)
 *   GET  /api/paneel/stand                           { bytes, vers, kijkers, stats } (nakijken, geen inhoud)
 *
 * DE SCHRIJFWEG (S8, W1 = ja; server/paneel.js PaneelSchrijf, docs/werkruimte/S8.md):
 *   GET    /api/paneel/schrijf              { aan, code, apparaten, mixer, vast, stats }       alleen deze Mac
 *   POST   /api/paneel/schrijf              { aan: true|false }                                alleen deze Mac
 *   POST   /api/paneel/schrijf/code         { code, geldig_ms } (aan moet aan staan)           alleen deze Mac
 *   DELETE /api/paneel/schrijf/apparaat/<id>  intrekken                                        alleen deze Mac
 *   GET    /api/paneel/naar-mixer?tab=      SSE naar de mixer: invoke, los, uit, hb            alleen deze Mac
 *   POST   /api/paneel/antwoord             { n, ok, reden?, read? } de mixer zegt wat hij deed alleen deze Mac
 *   GET    /api/paneel/wie                  { gekoppeld, naam, scherm }  (404 als de schrijfweg uit staat)
 *   POST   /api/paneel/koppel               { code, naam, scherm } -> Set-Cookie (404 uit; Origin verplicht)
 *   POST   /api/paneel/invoke               invokeBericht (protocol.js) -> 200/403/409/429/503/504 met { ok, reden }
 *                                           (404 uit, 403 verkeerde/geen Origin, 401 geen geldig token)
 * De route naar de iPad staat standaard UIT (404), tot Clay hem in de Controlekamer aanzet.
 */
export const relais = new PaneelRelais();
let schrijf = null;
/** De schrijfweg (één per server; het bestand met de gekoppelde apparaten naast de library). */
export function schrijfweg(ctx) {
  schrijf ??= new PaneelSchrijf({ relais,
    bestand: process.env.VARVE_PANEEL_APPARATEN || (ctx?.MEDIA ? join(ctx.MEDIA, 'paneel-apparaten.json') : null) });
  return schrijf;
}
// Alleen deze Mac: vanDezeMac (Host localhost, geen proxykop), en ook geen andere proxykop (forwarded,
// x-forwarded-host) en geen verzoek van een andere site (Sec-Fetch-Site: cross-site, bv. een <img> of een no-cors
// GET van een andere pagina in dezelfde Chrome: die stuurt geen Origin mee; review S8 ronde 1).
const lokaal = (req, res, ctx) => {
  const h = req.headers ?? {};
  const vreemd = h.forwarded !== undefined || h['x-forwarded-host'] !== undefined || h['x-forwarded-proto'] !== undefined
    || (h['sec-fetch-site'] !== undefined && h['sec-fetch-site'] !== 'same-origin' && h['sec-fetch-site'] !== 'none');
  if (ctx.vanDezeMac(req) && !vreemd) return true;
  req.resume?.(); ctx.json(res, 403, { fout: 'alleen op deze Mac (de Controlekamer)' }); return false;
};
const vanBuiten = (req, res, ctx, { origin = true } = {}) => {
  const s = schrijfweg(ctx);
  // Uit: deze routes bestaan niet (zelfde antwoord als een onbekend eindpunt).
  if (!s.aan) { req.resume?.(); ctx.json(res, 404, { fout: 'onbekend eindpunt' }); return null; }
  if (origin && !origineGoed(req)) { req.resume?.(); ctx.json(res, 403, { fout: 'alleen vanaf de eigen pagina (Origin)' }); return null; }
  return s;
};
// Secure: via tailscale serve is het https; op localhost accepteert Chrome hem ook over http.
const cookie = (token) => `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/paneel; Max-Age=31536000`;

const SCHERM = /^[a-z0-9-]{1,24}$/;
const alleen = (methode) => (req, res, ctx) => { req.resume?.(); ctx.json(res, 405, { fout: `alleen ${methode}` }); };

export default {
  routes: [
    { methode: 'POST', pad: /^\/api\/paneel\/van-mixer$/, handler: async (req, res, ctx) => {
      if (!ctx.vanDezeMac(req)) { req.resume(); return ctx.json(res, 403, { fout: 'alleen de mixer op deze Mac meldt zich' }); }
      const body = await ctx.leesJson(req, MAX_POST);
      if (!body || typeof body !== 'object' || !Array.isArray(body.berichten)) return ctx.json(res, 400, { fout: 'stuur { tab, berichten: [...] }' });
      return ctx.json(res, 200, { ...relais.vanMixer(body), schrijf: !!schrijf?.aan });
    } },
    { methode: 'GET', pad: /^\/api\/paneel\/kijkers$/, handler: (req, res, ctx) => ctx.json(res, 200, { ...relais.status(), schrijf: !!schrijf?.aan }) },
    { methode: 'GET', pad: /^\/api\/paneel\/ping$/, handler: (req, res, ctx) => {
      // Met ?k=<pagina>: ook een teken van leven voor wat die pagina vasthoudt (S8, loslaten na 1,5 s).
      if (schrijf?.aan && req.url.includes('k=')) { try { schrijf.levend(new URL(req.url, 'http://x').searchParams.get('k')); } catch (_) {} }
      ctx.json(res, 200, { t: performance.timeOrigin + performance.now() });
    } },
    // ---- de schrijfweg (S8) ----
    { methode: 'GET', pad: /^\/api\/paneel\/schrijf$/, handler: (req, res, ctx) => { if (lokaal(req, res, ctx)) ctx.json(res, 200, schrijfweg(ctx).stand()); } },
    { methode: 'POST', pad: /^\/api\/paneel\/schrijf$/, handler: async (req, res, ctx) => {
      if (!lokaal(req, res, ctx)) return;
      const b = await ctx.leesJson(req, 1024);
      if (typeof b?.aan !== 'boolean') return ctx.json(res, 400, { fout: 'stuur { aan: true } of { aan: false }' });
      ctx.json(res, 200, schrijfweg(ctx).zetAan(b.aan));
    } },
    { methode: 'POST', pad: /^\/api\/paneel\/schrijf\/code$/, handler: async (req, res, ctx) => {
      if (!lokaal(req, res, ctx)) return;
      req.resume?.();
      const c = schrijfweg(ctx).nieuweCode();
      if (!c) return ctx.json(res, 409, { fout: 'zet de schrijfweg eerst aan' });
      ctx.json(res, 200, c);
    } },
    { methode: 'DELETE', pad: /^\/api\/paneel\/schrijf\/apparaat\/[0-9a-f]{12}$/, handler: (req, res, ctx) => {
      if (!lokaal(req, res, ctx)) return;
      const id = req.url.split('?')[0].split('/').pop();
      ctx.json(res, schrijfweg(ctx).intrekken(id) ? 200 : 404, schrijfweg(ctx).stand());
    } },
    { methode: 'GET', pad: /^\/api\/paneel\/naar-mixer$/, handler: (req, res, ctx) => {
      if (!lokaal(req, res, ctx)) return;
      let tab = null;
      try { tab = new URL(req.url, 'http://x').searchParams.get('tab'); } catch (_) {}
      schrijfweg(ctx).mixer(req, res, { tab: typeof tab === 'string' ? tab.slice(0, 64) : null });
    } },
    { methode: 'POST', pad: /^\/api\/paneel\/antwoord$/, handler: async (req, res, ctx) => {
      if (!lokaal(req, res, ctx)) return;
      const b = await ctx.leesJson(req, 4096);
      ctx.json(res, 200, { gezien: schrijfweg(ctx).antwoord(b) });
    } },
    { methode: 'GET', pad: /^\/api\/paneel\/wie$/, handler: (req, res, ctx) => {
      const s = vanBuiten(req, res, ctx, { origin: false });
      if (!s) return;
      const a = s.apparaatVan(req);
      ctx.json(res, 200, a ? { gekoppeld: true, naam: a.naam, scherm: a.scherm } : { gekoppeld: false });
    } },
    { methode: 'POST', pad: /^\/api\/paneel\/koppel$/, handler: async (req, res, ctx) => {
      const s = vanBuiten(req, res, ctx);
      if (!s) return;
      const b = await ctx.leesJson(req, 1024);
      const r = s.koppel(b ?? {});
      if (!r.ok) return ctx.json(res, r.status, { fout: r.fout });
      res.setHeader('Set-Cookie', cookie(r.token));
      ctx.json(res, 200, { ok: true, apparaat: r.apparaat });
    } },
    { methode: 'POST', pad: /^\/api\/paneel\/invoke$/, handler: async (req, res, ctx) => {
      const s = vanBuiten(req, res, ctx);
      if (!s) return;
      const a = s.apparaatVan(req);
      if (!a) { req.resume?.(); return ctx.json(res, 401, { ok: false, reden: 'niet gekoppeld: koppel dit scherm met een code uit de Controlekamer' }); }
      const b = await ctx.leesJson(req, 2048);
      const r = await s.invoke(a, b);
      ctx.json(res, r.status, r.antwoord);
    } },
    { methode: 'GET', pad: /^\/api\/paneel\/stand$/, handler: (req, res, ctx) => {
      const s = relais.standBericht();
      ctx.json(res, 200, { bytes: s.bytes, vers: s.vers, past: s.past, kijkers: relais.aantal, tab: relais.tab, stats: relais.stats });
    } },
    { methode: 'GET', pad: /^\/api\/paneel\/live$/, handler: (req, res) => {
      let s = null, k = null;
      try { const q = new URL(req.url, 'http://x').searchParams; s = q.get('s'); k = q.get('k'); } catch (_) {}
      relais.kijk(req, res, { scherm: s && SCHERM.test(s) ? s : null, pagina: k && /^[a-z0-9]{8,40}$/.test(k) ? k : null });
    } },
    ...['PUT', 'DELETE', 'PATCH'].map((methode) => ({ methode, pad: /^\/api\/paneel\/van-mixer$/, handler: alleen('POST') })),
    ...['POST', 'PUT', 'DELETE', 'PATCH'].map((methode) => ({ methode, pad: /^\/api\/paneel\/(live|ping|kijkers|stand|naar-mixer)$/, handler: alleen('GET') })),
    ...['GET', 'PUT', 'DELETE', 'PATCH'].map((methode) => ({ methode, pad: /^\/api\/paneel\/(antwoord|schrijf\/code)$/, handler: alleen('POST') })),
  ],
  mag: [],
};
