import { join } from 'node:path';
import { Werkruimtes, WerkFout, NAAM_UITLEG } from '../werkruimtes.js';
import { naamGeldig } from '../../src/werk/model.js';

/**
 * Routes van spoor S3: de werkruimtes (docs/WERKRUIMTE.md B2, docs/werkruimte/S3.md). Na alle
 * controles van server/index.js (Host/Origin), vóór de 404.
 *
 *   GET /api/werkruimtes                 { werkruimtes: [{ naam, titel, bron, versie, delen, fouten, gewijzigd }] }
 *   GET /api/werkruimtes/<naam>          { naam, ruw, werkruimte, versie, bron, fouten, waarschuwingen } (ETag: 304)
 *   PUT /api/werkruimtes/<naam>          { werkruimte, versie }: 200, 400 (met reden, niets geschreven), 409 (met wat er nu staat)
 *   GET /api/werkruimtes/<naam>/versies  { versies: [bestandsnamen] } (nieuwste eerst)
 *   POST /api/werkruimtes/<naam>/terug   { versie }: terug naar de vorige inrichting (S8); 200, 404, 409. Alleen deze Mac.
 *
 * De map: VARVE_WERKRUIMTES (tests), anders <wortel>/werkruimtes. Claude mag het bestand ook
 * direct schrijven: de mixer peilt elke 3 s (met de ETag, dus meestal een 304 zonder body).
 */
let opslag = null;
let opslagMap = null;
function werkruimtes(ctx) {
  const map = process.env.VARVE_WERKRUIMTES || join(ctx.WORTEL, 'werkruimtes');
  if (!opslag || opslagMap !== map) {
    opslagMap = map;
    opslag = new Werkruimtes({ map, voorbeelden: join(ctx.WORTEL, 'tools', 'werkruimtes', 'voorbeelden'),
      stukken: join(ctx.WORTEL, 'mappings', 'stukken'), mappings: join(ctx.WORTEL, 'mappings') });
  }
  return opslag;
}

const EEN = /^\/api\/werkruimtes\/([^/]+)$/;
const VERSIES = /^\/api\/werkruimtes\/([^/]+)\/versies$/;
const TERUG = /^\/api\/werkruimtes\/([^/]+)\/terug$/;
/** De naam uit het pad, of null (dan is er al geantwoord: 400). */
function naamUit(req, res, ctx, re) {
  let naam;
  try { naam = decodeURIComponent(re.exec(new URL(req.url, 'http://x').pathname)[1]); } catch { naam = ''; }
  if (!naamGeldig(naam)) { ctx.json(res, 400, { fout: NAAM_UITLEG }); return null; }
  return naam;
}

/** Een WerkFout (503: niet lokaal beschikbaar, iCloud?) wordt zijn code, de rest gaat door naar de 500 van de server. */
const metFout = (handler) => async (req, res, ctx) => {
  try { return await handler(req, res, ctx); } catch (err) {
    if (!(err instanceof WerkFout)) throw err;
    req.resume?.();
    return ctx.json(res, err.code, { fout: err.message });
  }
};

const alleen = (methode) => (req, res, ctx) => ctx.json(res, 405, { fout: `alleen ${methode}` });

export default {
  routes: [
    { methode: 'GET', pad: /^\/api\/werkruimtes$/, handler: metFout(async (req, res, ctx) => ctx.json(res, 200, { werkruimtes: await werkruimtes(ctx).lijst() })) },
    { methode: 'GET', pad: VERSIES, handler: metFout(async (req, res, ctx) => {
      const naam = naamUit(req, res, ctx, VERSIES);
      if (naam) ctx.json(res, 200, { naam, versies: await werkruimtes(ctx).versies(naam) });
    }) },
    { methode: 'GET', pad: EEN, handler: metFout(async (req, res, ctx) => {
      const naam = naamUit(req, res, ctx, EEN);
      if (!naam) return;
      const w = await werkruimtes(ctx).lees(naam);
      if (!w) return ctx.json(res, 404, { fout: `geen werkruimte "${naam}"` });
      const { gewijzigd: _g, ...rest } = w;
      return ctx.jsonMetEtag(req, res, rest);
    }) },
    { methode: 'PUT', pad: EEN, handler: metFout(async (req, res, ctx) => {
      // W1 (Clay, nog open; tot dan zo): de iPad en alles via Tailscale KIJKT alleen. Een
      // werkruimte opslaan (en daarmee de indeling van de mixer veranderen) mag alleen vanaf
      // deze Mac: Host localhost/127.0.0.1/[::1], geen proxykop (vanDezeMac, mixer-melding.js).
      if (!ctx.vanDezeMac(req)) { req.resume(); return ctx.json(res, 403, { fout: 'een werkruimte opslaan mag alleen op deze Mac' }); }
      const naam = naamUit(req, res, ctx, EEN);
      if (!naam) { req.resume(); return; }
      const mediatype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (mediatype !== 'application/json') { req.resume(); return ctx.json(res, 415, { fout: 'alleen application/json' }); }
      const body = await ctx.leesJson(req, 320 * 1024);
      if (!body || typeof body !== 'object' || !body.werkruimte || typeof body.werkruimte !== 'object' || Array.isArray(body.werkruimte)) {
        return ctx.json(res, 400, { fout: 'stuur geldige JSON: { werkruimte, versie }' });
      }
      const r = await werkruimtes(ctx).schrijf(naam, body.werkruimte, typeof body.versie === 'string' ? body.versie : null);
      return ctx.json(res, r.code, r.antwoord);
    }) },
    { methode: 'POST', pad: TERUG, handler: metFout(async (req, res, ctx) => {
      if (!ctx.vanDezeMac(req)) { req.resume(); return ctx.json(res, 403, { fout: 'terugzetten mag alleen op deze Mac' }); }
      const naam = naamUit(req, res, ctx, TERUG);
      if (!naam) { req.resume(); return; }
      const body = await ctx.leesJson(req, 1024);
      const r = await werkruimtes(ctx).terug(naam, typeof body?.versie === 'string' ? body.versie : null);
      return ctx.json(res, r.code, r.antwoord);
    }) },
    ...['POST', 'DELETE', 'PATCH'].map((methode) => ({ methode, pad: EEN, handler: alleen('GET of PUT') })),
    ...['POST', 'PUT', 'DELETE'].map((methode) => ({ methode, pad: /^\/api\/werkruimtes$/, handler: alleen('GET') })),
  ],
  // De top-40 van de handelingen voor de zoeker van ✎ inrichten (S8): alleen dit ene bestand uit tools/.
  mag: [/^\/tools\/werkruimtes\/top40\.json$/],
};
