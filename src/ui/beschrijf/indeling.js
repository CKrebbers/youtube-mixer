// De uitleg van de actions van spoor S11 ('indeling', docs/LIBRARY-TAGS.md §3): { kort, lang } zoals
// beschrijf() in apc-beschrijf.js, of null. Puur: geen DOM, geen bus (apc.html en maschine.html laden dit statisch).
const VAST = {
  'library.category.next': ['categorie ▶', 'library: de volgende categorie als filter (alles → je categorieën → de slimme → alles); op de Maschine zie je hem bovenaan het scherm'],
  'library.category.prev': ['◀ categorie', 'library: de vorige categorie als filter'],
  'library.category.clear': ['alles', 'library: het filter leeg, de hele library (ook tags, bpm en zoektekst)'],
};

export default function indeling(action) {
  const v = VAST[action];
  if (v) return { kort: v[0], lang: v[1] };
  let m;
  if ((m = /^library\.quicktag\.([1-8])$/.exec(action))) return { kort: `snel-tag ${m[1]}`, lang: `library: snel-tag ${m[1]} aan of uit op het gekozen nummer (of op alles wat gekozen is). Welke tag dat is zet je in de library: ⋯ bij een tag, "snel ${m[1]}"` };
  if ((m = /^library\.quickfilter\.([1-8])$/.exec(action))) return { kort: `filter ${m[1]}`, lang: `library: alleen nummers met snel-tag ${m[1]} (nog eens = weer alles)` };
  if ((m = /^track\.([1-8])\.tag\.([1-8])$/.exec(action))) return { kort: `tag ${m[2]}`, lang: `snel-tag ${m[2]} aan of uit op het nummer op track ${m[1]} (het lampje: aan = heeft hem). Ook van de iPad, als de werkruimte het daar zet en mag noemt` };
  return null;
}
