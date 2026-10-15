import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Sjablonen, SjabloonFout } from '../sjablonen.js';

/**
 * Routes van spoor S10 (docs/EFFECTEN-MEER.md): eigen sjablonen, na alle controles van
 * server/index.js (Host/Origin, alleen JSON voor een POST op /api/), vóór de 404.
 *
 *   GET  /api/sjablonen        { racks, versie }
 *   POST /api/sjablonen        { rack, versie }: bewaren (nieuw of over dezelfde naam). 200, 400, 409, 413. Alleen deze Mac.
 *   POST /api/sjablonen/wis    { naam, versie }: wissen. 200, 404, 409. Alleen deze Mac.
 *
 * Het bestand: VARVE_SJABLONEN, anders <wortel>/racks/eigen.json (niet in git).
 * Bewaren en wissen staan niet op de bus: de iPad kan dit niet (VAST_NOOIT is daar niet eens nodig).
 */
let opslag = null, opslagPad = null;
function sjablonen(ctx) {
  const pad = process.env.VARVE_SJABLONEN || join(ctx.WORTEL, 'racks', 'eigen.json');
  if (!opslag || opslagPad !== pad) {
    opslagPad = pad;
    opslag = new Sjablonen({ pad, ingebouwd: async () => {
      try { return (JSON.parse(await readFile(join(ctx.WORTEL, 'racks', 'sjablonen.json'), 'utf8')).racks || []).map((r) => r.name); }
      catch { return []; }
    } });
  }
  return opslag;
}

const metFout = (handler) => async (req, res, ctx) => {
  try { return await handler(req, res, ctx); } catch (err) {
    if (!(err instanceof SjabloonFout)) throw err;
    req.resume?.();
    return ctx.json(res, err.code, { fout: err.message, ...err.extra });
  }
};
const alleenMac = (handler, wat) => async (req, res, ctx) => {
  if (!ctx.vanDezeMac(req)) { req.resume(); return ctx.json(res, 403, { fout: `${wat} mag alleen op deze Mac` }); }
  return handler(req, res, ctx);
};
const body = async (req, res, ctx) => {
  const b = await ctx.leesJson(req, 600 * 1024);
  if (!b || typeof b !== 'object') { ctx.json(res, 400, { fout: 'geen geldige JSON (of groter dan 600 kB)' }); return null; }
  return b;
};

export default {
  routes: [
    { methode: 'GET', pad: /^\/api\/sjablonen$/, handler: metFout(async (req, res, ctx) => ctx.json(res, 200, await sjablonen(ctx).lees())) },
    { methode: 'POST', pad: /^\/api\/sjablonen$/, handler: alleenMac(metFout(async (req, res, ctx) => {
      const b = await body(req, res, ctx);
      if (!b) return;
      if (!b.rack || typeof b.rack !== 'object') return ctx.json(res, 400, { fout: 'rack ontbreekt' });
      ctx.json(res, 200, await sjablonen(ctx).bewaar(b.rack, b.versie ?? null));
    }), 'een sjabloon bewaren') },
    { methode: 'POST', pad: /^\/api\/sjablonen\/wis$/, handler: alleenMac(metFout(async (req, res, ctx) => {
      const b = await body(req, res, ctx);
      if (!b) return;
      if (typeof b.naam !== 'string') return ctx.json(res, 400, { fout: 'naam ontbreekt' });
      ctx.json(res, 200, await sjablonen(ctx).wis(b.naam, b.versie ?? null));
    }), 'een sjabloon wissen') },
  ],
  mag: [],
};
