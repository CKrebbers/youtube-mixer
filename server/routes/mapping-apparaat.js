// Routes van spoor S5: de eigen mapping per apparaat (docs/werkruimte/S5.md, docs/WERKRUIMTE.md D4).
//
//   GET    /api/mapping/<apparaat>   { mapping }: je verschil met de standaard (of null)
//   POST   /api/mapping/<apparaat>   { mapping } bewaren (een verschil of een volledige kopie, met "rules")
//   DELETE /api/mapping/<apparaat>   weg: de app volgt weer mappings/<apparaat>.json
//
// <apparaat> is apc40mk2, maschine-mk2, xboard49 of toetsen. De APC staat onder DEZELFDE
// sleutel als de oude route /api/mapping ('mapping' in de instellingen-tabel): Clay's
// verschil verhuist niet, en beide routes lezen en schrijven hetzelfde document. De andere
// apparaten onder 'mapping:<apparaat>'. Dezelfde validatie als de oude route; Host/Origin en
// "alleen JSON" doet server/index.js al vóór elke route van een spoor.
//
// Eén regel erbij die de oude route niet heeft: een document dat zegt dat het voor een ANDER
// apparaat is, wordt geweigerd (400). Zo kan een Maschine-regel nooit in de APC-mapping
// belanden, ook niet door een fout in de app. Een document zonder `device` mag (zoals
// /api/mapping): normaliseer() maakt er 'generic' van, en dat laadt de app toch niet als
// verschil voor dit apparaat.
//
// Ook de proefpagina van de Maschine (tools/proef/maschine-ijk.html) staat hier op de witte lijst.

/** De apparaten met een eigen mapping, en waar hun verschil staat. */
export const APPARATEN = Object.freeze(['apc40mk2', 'maschine-mk2', 'xboard49', 'toetsen']);
export const sleutelVan = (apparaat) => (apparaat === 'apc40mk2' ? 'mapping' : `mapping:${apparaat}`);

const PAD = /^\/api\/mapping\/([^/]+)$/;
const apparaatVan = (req) => {
  const naam = PAD.exec(new URL(req.url, 'http://localhost').pathname)?.[1] ?? '';
  return APPARATEN.includes(naam) ? naam : null;
};
const onbekend = (ctx, res) => ctx.json(res, 404, { fout: `onbekend apparaat; kies uit ${APPARATEN.join(', ')}` });

async function lees(req, res, ctx) {
  const a = apparaatVan(req);
  if (!a) return onbekend(ctx, res);
  return ctx.json(res, 200, { mapping: ctx.lib.haal(sleutelVan(a), null) });
}

async function bewaar(req, res, ctx) {
  const a = apparaatVan(req);
  if (!a) return onbekend(ctx, res);
  const b = await ctx.leesJson(req);
  if (!b?.mapping || !Array.isArray(b.mapping.rules)) return ctx.json(res, 400, { fout: 'een mapping heeft rules nodig' });
  const device = b.mapping.device;
  if (device !== undefined && device !== a) return ctx.json(res, 400, { fout: `deze mapping is voor "${device}", niet voor "${a}"` });
  ctx.lib.zet(sleutelVan(a), b.mapping);
  return ctx.json(res, 200, { ok: true, regels: b.mapping.rules.length });
}

// "Standaard herstellen" van één apparaat: alleen zijn eigen sleutel.
async function wis(req, res, ctx) {
  const a = apparaatVan(req);
  if (!a) return onbekend(ctx, res);
  ctx.lib.zet(sleutelVan(a), null);
  return ctx.json(res, 200, { ok: true });
}

export default {
  routes: [
    { methode: 'GET', pad: PAD, handler: lees },
    { methode: 'POST', pad: PAD, handler: bewaar },
    { methode: 'DELETE', pad: PAD, handler: wis },
  ],
  mag: [/^\/tools\/proef\/maschine-ijk\.html$/],
};
