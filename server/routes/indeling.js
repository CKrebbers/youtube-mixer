import { IndelingFout } from '../indeling.js';

/**
 * Routes van spoor S11 (docs/LIBRARY-TAGS.md §5): de indeling van de library, na alle controles van
 * server/index.js (Host/Origin, alleen JSON voor een POST op /api/), vóór de 404. Onder /api/indeling
 * en niet onder /api/library/<x>: daar is <x> een nummer.
 *
 *   GET  /api/indeling/stand                { tags, categorieen, snel }
 *   GET  /api/indeling                      de export (namen, geen ids)
 *   POST /api/indeling[?droog=1]            importeren: samenvoegen, nooit wissen
 *   POST /api/indeling/tags/zet             { ids, tags, aan }
 *   POST /api/indeling/tags/tag             { naam, nieuw?, kleur?, samenvoegen? }
 *   POST /api/indeling/tags/wis             { naam, forceer? }
 *   POST /api/indeling/tags/snel            { snel: [8] }
 *   POST /api/indeling/categorie            { id?, naam, soort, regel?, kleur? }
 *   POST /api/indeling/categorie/wis        { id, forceer? }
 *   POST /api/indeling/categorie/nummers    { id, ids, aan, voor?, naarEind? }
 *   POST /api/indeling/categorie/volgorde   { ids }
 *   POST /api/indeling/categorie/van-kaart  { krat, naam? }
 *
 * Elke POST alleen vanaf deze Mac (403): de iPad tagt via de bus (track.N.tag.K, schrijfweg S8) en de
 * mixer op de Mac schrijft. Een IndelingFout wordt zijn code met { fout, ...extra }.
 */
const metFout = (handler) => async (req, res, ctx) => {
  try { return await handler(req, res, ctx); } catch (err) {
    if (!(err instanceof IndelingFout)) throw err;
    req.resume?.();
    return ctx.json(res, err.code, { fout: err.message, ...err.extra });
  }
};
const alleenMac = (handler) => async (req, res, ctx) => {
  if (!ctx.vanDezeMac(req)) { req.resume(); return ctx.json(res, 403, { fout: 'de indeling van de library verander je alleen op deze Mac' }); }
  return handler(req, res, ctx);
};
const body = async (req, res, ctx, max = 256 * 1024) => {
  const b = await ctx.leesJson(req, max);
  if (!b || typeof b !== 'object' || Array.isArray(b)) { ctx.json(res, 400, { fout: `geen geldige JSON (of groter dan ${Math.round(max / 1024)} kB)` }); return null; }
  return b;
};
const post = (pad, fn, max) => ({ methode: 'POST', pad, handler: alleenMac(metFout(async (req, res, ctx) => {
  const b = await body(req, res, ctx, max);
  if (!b) return;
  return ctx.json(res, 200, await fn(ctx.lib.indeling, b, ctx, req));
})) });
const id = (x) => (Number.isSafeInteger(x) && x > 0 ? x : null);
const moet = (ok, tekst) => { if (!ok) throw new IndelingFout(400, tekst); };

export default {
  routes: [
    { methode: 'GET', pad: /^\/api\/indeling\/stand$/, handler: metFout(async (req, res, ctx) => ctx.json(res, 200, ctx.lib.indeling.stand())) },
    { methode: 'GET', pad: /^\/api\/indeling$/, handler: metFout(async (req, res, ctx) => ctx.json(res, 200, ctx.lib.indeling.exporteer())) },
    post(/^\/api\/indeling$/, (ind, b, ctx, req) => {
      const droog = new URL(req.url, 'http://x').searchParams.get('droog') === '1';
      return ind.importeer(b, { droog });
    }, 8 * 1024 * 1024),
    post(/^\/api\/indeling\/tags\/zet$/, (ind, b) => {
      moet(typeof b.aan === 'boolean', 'aan is true of false');
      return ind.zetTags(b.ids, b.tags, b.aan);
    }),
    post(/^\/api\/indeling\/tags\/tag$/, (ind, b) => {
      moet(typeof b.naam === 'string', 'naam ontbreekt');
      return { tag: ind.bewerkTag({ naam: b.naam, nieuw: b.nieuw ?? null, ...(Object.hasOwn(b, 'kleur') ? { kleur: b.kleur } : {}), samenvoegen: b.samenvoegen === true }) };
    }),
    post(/^\/api\/indeling\/tags\/wis$/, (ind, b) => {
      moet(typeof b.naam === 'string', 'naam ontbreekt');
      return ind.wisTag(b.naam, { forceer: b.forceer === true });
    }),
    post(/^\/api\/indeling\/tags\/snel$/, (ind, b) => ({ snel: ind.zetSnel(b.snel) })),
    post(/^\/api\/indeling\/categorie$/, (ind, b) => ({ categorie: ind.bewaarCategorie({
      id: b.id == null ? null : id(b.id) ?? (() => { throw new IndelingFout(400, 'id is een getal'); })(),
      naam: b.naam, soort: b.soort, ...(Object.hasOwn(b, 'regel') ? { regel: b.regel } : {}), ...(Object.hasOwn(b, 'kleur') ? { kleur: b.kleur } : {}),
    }) })),
    post(/^\/api\/indeling\/categorie\/wis$/, (ind, b) => {
      moet(id(b.id), 'id ontbreekt');
      return ind.wisCategorie(b.id, { forceer: b.forceer === true });
    }),
    post(/^\/api\/indeling\/categorie\/nummers$/, (ind, b) => {
      moet(id(b.id), 'id ontbreekt');
      moet(typeof b.aan === 'boolean', 'aan is true of false');
      return ind.zetNummers(b.id, b.ids, { aan: b.aan, voor: b.voor ?? null, naarEind: b.naarEind === true });
    }, 1024 * 1024),
    post(/^\/api\/indeling\/categorie\/volgorde$/, (ind, b) => ({ volgorde: ind.zetVolgorde(b.ids) })),
    post(/^\/api\/indeling\/categorie\/van-kaart$/, (ind, b, ctx) => {
      moet(typeof b.krat === 'string' && b.krat.length <= 200, 'krat ontbreekt');
      return ind.vanKaart(ctx.kaart, b.krat, typeof b.naam === 'string' ? b.naam : null);
    }),
  ],
  mag: [],
};
