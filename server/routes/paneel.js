import { PaneelRelais } from '../paneel.js';
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
 * W1 (Clay, nog open): in dit spoor KIJKT de iPad alleen. Er is bewust GEEN route waarmee
 * een kijker iets naar de mixer stuurt; elke andere methode op /api/paneel/* = 405.
 */
export const relais = new PaneelRelais();

const SCHERM = /^[a-z0-9-]{1,24}$/;
const alleen = (methode) => (req, res, ctx) => { req.resume?.(); ctx.json(res, 405, { fout: `alleen ${methode}` }); };

export default {
  routes: [
    { methode: 'POST', pad: /^\/api\/paneel\/van-mixer$/, handler: async (req, res, ctx) => {
      if (!ctx.vanDezeMac(req)) { req.resume(); return ctx.json(res, 403, { fout: 'alleen de mixer op deze Mac meldt zich' }); }
      const body = await ctx.leesJson(req, MAX_POST);
      if (!body || typeof body !== 'object' || !Array.isArray(body.berichten)) return ctx.json(res, 400, { fout: 'stuur { tab, berichten: [...] }' });
      return ctx.json(res, 200, relais.vanMixer(body));
    } },
    { methode: 'GET', pad: /^\/api\/paneel\/kijkers$/, handler: (req, res, ctx) => ctx.json(res, 200, relais.status()) },
    { methode: 'GET', pad: /^\/api\/paneel\/ping$/, handler: (req, res, ctx) => ctx.json(res, 200, { t: performance.timeOrigin + performance.now() }) },
    { methode: 'GET', pad: /^\/api\/paneel\/stand$/, handler: (req, res, ctx) => {
      const s = relais.standBericht();
      ctx.json(res, 200, { bytes: s.bytes, vers: s.vers, past: s.past, kijkers: relais.aantal, tab: relais.tab, stats: relais.stats });
    } },
    { methode: 'GET', pad: /^\/api\/paneel\/live$/, handler: (req, res) => {
      let s = null;
      try { s = new URL(req.url, 'http://x').searchParams.get('s'); } catch (_) {}
      relais.kijk(req, res, { scherm: s && SCHERM.test(s) ? s : null });
    } },
    ...['PUT', 'DELETE', 'PATCH'].map((methode) => ({ methode, pad: /^\/api\/paneel\/van-mixer$/, handler: alleen('POST') })),
    ...['POST', 'PUT', 'DELETE', 'PATCH'].map((methode) => ({ methode, pad: /^\/api\/paneel\/(live|ping|kijkers|stand)$/, handler: alleen('GET') })),
  ],
  mag: [],
};
