// De uitleg van de actions van spoor S8 (inrichten, docs/werkruimte/S8.md). Puur: action -> { kort, lang } of null.
const UITLEG = {
  'werk.terug': { kort: 'terug', lang: 'Terug naar de vorige inrichting van deze werkruimte (de vorige versie op de server; een 409 als iemand intussen opsloeg). Alleen op het scherm van de Mac.' },
};
export default function beschrijf(action) { return UITLEG[action] ?? null; }
