import { join } from 'node:path';
import { Sets, SetFout } from '../sets.js';
import { naamGeldig, NAAM_UITLEG } from '../../src/sets/model.js';
import { voorspel } from '../../src/plan/tijdlijn.js';
import { ZEKER_VANAF as GRID_ZEKER } from '../../src/engine/beatgrid.js';
import { ZEKER_VANAF as TOON_ZEKER } from '../../src/engine/toonsoort.js';
import { datumVan, nachtDatum } from '../nacht.js';

/**
 * Routes van spoor S9 (docs/PLAN-SET.md §3 en §6). Na alle controles van server/index.js
 * (Host/Origin, alleen JSON voor een POST op /api/), vóór de 404.
 *
 * SETS (opslaan en terugladen; de map VARVE_SETS, anders <wortel>/sets, niet in git):
 *   GET  /api/sets                          { sets: [{ naam, titel, gewijzigd, nummers, duur, werkruimte, patronen, moment }] }
 *   GET  /api/sets/<naam>                   { set, versie, fouten }
 *   PUT  /api/sets/<naam>                   { set, versie }: 200, 409 (met wat er nu staat), 413. Alleen deze Mac.
 *   POST /api/sets/<naam>/kopie             { naar }: dupliceren (409 als naar al bestaat). Alleen deze Mac.
 *   POST /api/sets/<naam>/hernoem           { naar, versie }. Alleen deze Mac.
 *   GET  /api/sets/<naam>/versies           { versies: [bestandsnamen] }
 *
 * KLAAR VOOR DE SET:
 *   POST /api/set/klaar      { ids }: per nummer grid, toon, stems, secties, video (alleen lezen)
 *   POST /api/set/klaarmaken { ids, stems?: 2|4 }: wat ontbreekt de bestaande rijen in (stems, secties).
 *                            409 als er een deck speelt of het een speeldag is. Alleen deze Mac.
 *   GET  /api/set/klaarmaken de stand van het secties-werk
 *
 * DE LIVE-STAND (voor het vak `plan` op de iPad, werk.html):
 *   POST /api/set/live       { stand } van de mixer (alleen deze Mac); antwoord { kijker }: is er de laatste 10 s gekeken
 *   GET  /api/set/live       { stand, t } (of { stand: null })
 */
let opslag = null, opslagMap = null;
function sets(ctx) {
  const map = process.env.VARVE_SETS || join(ctx.WORTEL, 'sets');
  if (!opslag || opslagMap !== map) { opslagMap = map; opslag = new Sets({ map }); }
  return opslag;
}

const EEN = /^\/api\/sets\/([^/]+)$/;
const KOPIE = /^\/api\/sets\/([^/]+)\/kopie$/;
const HERNOEM = /^\/api\/sets\/([^/]+)\/hernoem$/;
const VERSIES = /^\/api\/sets\/([^/]+)\/versies$/;
const MAX_IDS = 400;

function naamUit(req, res, ctx, re) {
  let naam;
  try { naam = decodeURIComponent(re.exec(new URL(req.url, 'http://x').pathname)[1]); } catch { naam = ''; }
  if (!naamGeldig(naam)) { req.resume?.(); ctx.json(res, 400, { fout: NAAM_UITLEG }); return null; }
  return naam;
}
const metFout = (handler) => async (req, res, ctx) => {
  try { return await handler(req, res, ctx); } catch (err) {
    if (!(err instanceof SetFout)) throw err;
    req.resume?.();
    return ctx.json(res, err.code, { fout: err.message });
  }
};
const alleenMac = (handler, wat) => async (req, res, ctx) => {
  if (!ctx.vanDezeMac(req)) { req.resume(); return ctx.json(res, 403, { fout: `${wat} mag alleen op deze Mac` }); }
  return handler(req, res, ctx);
};
const isJson = (req) => String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() === 'application/json';

/** De verwachte duur van het plan van een set, met de library van de server (voor de lijst). */
function duurVan(set, lib) {
  if (!set?.plan?.stappen?.length) return null;
  const tracks = new Map();
  for (const s of set.plan.stappen) { const t = lib.track(s.track); if (t) tracks.set(t.id, t); }
  try { return Math.round(voorspel(set.plan, tracks).totaal); } catch { return null; }
}

// ---- klaar voor de set -------------------------------------------------------------------

/** Per nummer wat klaar is (docs/PLAN-SET.md §3). Alleen lezen. */
export function klaarVan(lib, id, { inRij = () => false } = {}) {
  const t = lib.track(id);
  if (!t) return { id, bestaat: false };
  const gs = t.grid?.stukken || [];
  const gz = gs.filter((s) => t.grid.slot || (s.zekerheid ?? 0) >= GRID_ZEKER).length;
  const ts = t.toon?.stukken || [];
  const tz = ts.filter((s) => t.toon.slot || (s.zekerheid ?? 0) >= TOON_ZEKER).length;
  const sec = lib.secties(id);
  return {
    id, bestaat: true, titel: t.titel, audio: !!t.audio,
    grid: !gs.length ? 'geen' : gz === gs.length ? 'zeker' : gz ? 'deels' : 'onzeker',
    toon: !ts.length ? 'geen' : tz === ts.length ? 'zeker' : tz ? 'deels' : 'gok',
    stems: t.stems?.aantal ?? (inRij(id) ? 'rij' : null),
    secties: !sec ? 'geen' : lib.moetSecties(id) ? 'oud' : 'ja',
    video: !!t.video,
  };
}

/** Is het vandaag een speeldag (of de nacht erna)? Dan maakt "maak klaar" niets aan. */
export function isSpeeldag(nacht, nu = new Date()) {
  const dagen = nacht?.instellingen?.speeldagen ?? [];
  return dagen.includes(datumVan(nu)) || dagen.includes(nachtDatum(nu));
}

// De secties die nog gerekend moeten worden: één tegelijk, wacht zolang er een deck speelt.
const sectiesRij = { ids: [], bezig: null, klaar: 0, fouten: [], loopt: false };
async function werkSecties(ctx) {
  if (sectiesRij.loopt) return;
  sectiesRij.loopt = true;
  try {
    while (sectiesRij.ids.length) {
      while (ctx.speeltDeck()) await new Promise((z) => { const t = setTimeout(z, 2000); t.unref?.(); });
      const id = sectiesRij.ids.shift();
      sectiesRij.bezig = id;
      try {
        if (ctx.lib.track(id) && ctx.lib.moetSecties(id)) {
          const r = await ctx.analyseerSecties(id);
          if (r && r.ok === false && r.fout) sectiesRij.fouten.push(`${id}: ${r.fout}`);
        }
        sectiesRij.klaar++;
      } catch (err) { sectiesRij.fouten.push(`${id}: ${err.message}`); }
    }
  } finally { sectiesRij.bezig = null; sectiesRij.loopt = false; }
}

// ---- de live-stand ---------------------------------------------------------------------
const live = { stand: null, t: 0, gekeken: 0 };
const KIJK_MS = 10 * 1000;

export default {
  routes: [
    { methode: 'GET', pad: /^\/api\/sets$/, handler: metFout(async (req, res, ctx) => ctx.json(res, 200, { sets: await sets(ctx).lijst() })) },
    { methode: 'GET', pad: VERSIES, handler: metFout(async (req, res, ctx) => {
      const naam = naamUit(req, res, ctx, VERSIES);
      if (naam) ctx.json(res, 200, { naam, versies: await sets(ctx).versies(naam) });
    }) },
    { methode: 'GET', pad: EEN, handler: metFout(async (req, res, ctx) => {
      const naam = naamUit(req, res, ctx, EEN);
      if (!naam) return;
      const s = await sets(ctx).lees(naam);
      return s ? ctx.json(res, 200, s) : ctx.json(res, 404, { fout: `geen set "${naam}"` });
    }) },
    { methode: 'PUT', pad: EEN, handler: alleenMac(metFout(async (req, res, ctx) => {
      const naam = naamUit(req, res, ctx, EEN);
      if (!naam) return;
      if (!isJson(req)) { req.resume(); return ctx.json(res, 415, { fout: 'alleen application/json' }); }
      const body = await ctx.leesJson(req, 1200 * 1024);
      if (!body || typeof body !== 'object' || !body.set || typeof body.set !== 'object') return ctx.json(res, 400, { fout: 'stuur { set, versie }' });
      const r = await sets(ctx).schrijf(naam, body.set, typeof body.versie === 'string' ? body.versie : null,
        { samenvatting: { duur: duurVan(body.set, ctx.lib) } });
      return ctx.json(res, r.code, r.antwoord);
    }), 'een set opslaan') },
    { methode: 'POST', pad: KOPIE, handler: alleenMac(metFout(async (req, res, ctx) => {
      const naam = naamUit(req, res, ctx, KOPIE);
      if (!naam) return;
      const body = await ctx.leesJson(req);
      const r = await sets(ctx).kopie(naam, body?.naar);
      return ctx.json(res, r.code, r.antwoord);
    }), 'een set kopiëren') },
    { methode: 'POST', pad: HERNOEM, handler: alleenMac(metFout(async (req, res, ctx) => {
      const naam = naamUit(req, res, ctx, HERNOEM);
      if (!naam) return;
      const body = await ctx.leesJson(req);
      const r = await sets(ctx).hernoem(naam, body?.naar, typeof body?.versie === 'string' ? body.versie : null);
      return ctx.json(res, r.code, r.antwoord);
    }), 'een set hernoemen') },

    { methode: 'POST', pad: /^\/api\/set\/klaar$/, handler: async (req, res, ctx) => {
      const body = await ctx.leesJson(req, 64 * 1024);
      const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string' && /^[\w-]{1,64}$/.test(x)).slice(0, MAX_IDS) : null;
      if (!ids) return ctx.json(res, 400, { fout: 'stuur { ids: [...] }' });
      const rij = new Set((ctx.stemsRij?.lijst?.() || []).filter((o) => o.status === 'wacht' || o.status === 'bezig').map((o) => o.track));
      return ctx.json(res, 200, { nummers: [...new Set(ids)].map((id) => klaarVan(ctx.lib, id, { inRij: (x) => rij.has(x) })),
        secties: { wacht: sectiesRij.ids.length, bezig: sectiesRij.bezig } });
    } },
    { methode: 'GET', pad: /^\/api\/set\/klaarmaken$/, handler: async (req, res, ctx) => ctx.json(res, 200,
      { wacht: sectiesRij.ids.length, bezig: sectiesRij.bezig, klaar: sectiesRij.klaar, fouten: sectiesRij.fouten.slice(-10) }) },
    { methode: 'POST', pad: /^\/api\/set\/klaarmaken$/, handler: alleenMac(async (req, res, ctx) => {
      const body = await ctx.leesJson(req, 64 * 1024);
      const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x) => typeof x === 'string' && /^[\w-]{1,64}$/.test(x)))].slice(0, MAX_IDS) : null;
      if (!ids) return ctx.json(res, 400, { fout: 'stuur { ids: [...] }' });
      // De regels van de nachtwachtrij en de ingest: nooit als er een deck speelt, nooit op een speeldag.
      if (ctx.speeltDeck()) return ctx.json(res, 409, { fout: 'er speelt een deck: klaarmaken kan pas als alles stil is' });
      if (isSpeeldag(ctx.nacht)) return ctx.json(res, 409, { fout: 'vandaag is een speeldag (de speeldagen van de nachtwachtrij): klaarmaken staat uit' });
      const aantal = body.stems === 2 ? 2 : 4;
      const stems = { gestart: [], al: [], fout: null };
      const secties = [];
      for (const id of ids) {
        const t = ctx.lib.track(id);
        if (!t) continue;
        if (!t.stems && ctx.nieuweStems) {
          const r = await ctx.nieuweStems(id, aantal);
          if (r.code === 202) stems.gestart.push(id);
          else if (r.code === 200) stems.al.push(id);
          else if (r.code === 503) { stems.fout = r.antwoord?.reden || r.antwoord?.fout || 'de splitter is er niet'; }
        }
        if (ctx.lib.moetSecties(id) && !sectiesRij.ids.includes(id) && sectiesRij.bezig !== id) { sectiesRij.ids.push(id); secties.push(id); }
      }
      if (secties.length && ctx.analyseerSecties) werkSecties(ctx);
      return ctx.json(res, 200, { stems, secties: { gepland: secties.length, wacht: sectiesRij.ids.length } });
    }, 'klaarmaken') },

    { methode: 'POST', pad: /^\/api\/set\/live$/, handler: alleenMac(async (req, res, ctx) => {
      const body = await ctx.leesJson(req, 32 * 1024);
      if (!body || typeof body !== 'object' || typeof body.stand !== 'object') return ctx.json(res, 400, { fout: 'stuur { stand }' });
      live.stand = body.stand;
      live.t = Date.now();
      return ctx.json(res, 200, { kijker: Date.now() - live.gekeken < KIJK_MS });
    }, 'de live-stand zenden') },
    { methode: 'GET', pad: /^\/api\/set\/live$/, handler: async (req, res, ctx) => {
      live.gekeken = Date.now();
      return ctx.json(res, 200, { stand: live.stand, t: live.t, nu: Date.now() });
    } },
  ],
  mag: [],
};
