// De uitleg van de actions van spoor S6 ('maschine'): { kort, lang } zoals beschrijf() in
// apc-beschrijf.js, of null (dan beschrijft apc-beschrijf.js hem zelf). Puur: geen DOM, geen bus, en
// geen import van control/maschine.js (dit bestand laadt ook zonder ?hub=; test/hub.test.mjs).
//
// Wat hier staat:
//   layer.pads.<x>, layer.pagina.<x>, layer.wiel.<x>   kiesknoppen die een stuk op de Maschine zet
//                                                       (de Maschine doet ze zelf, niet de bus)
//   track.N.jog, .jog.fine, .rack, .section             de basis van een regel met mode `stappen`
//                                                       (het wiel: per klik <action>.fwd of .back)

const TRACK = /^track\.(\d+)\.(.+)$/;

/** De basis van een stappen-regel: per klik .fwd of .back (mapping.js, mode stappen). */
const STAPPEN = {
  jog: ['jog', 'jog: per klik 1/16 tel vooruit of terug, fasebehoudend en ook in pauze (het cuepunt blijft staan)'],
  'jog.fine': ['jog fijn', 'jog fijn: per klik 1/64 tel vooruit of terug'],
  rack: ['rack ◀▶', 'per klik het volgende of vorige rack'],
  section: ['sectie ◀▶', 'per klik de volgende of vorige sectie, valt in op de volgende "1"'],
};

export default function beschrijfMaschine(action) {
  if (typeof action !== 'string') return null;
  const k = /^layer\.(pads|pagina|wiel)\.([a-z0-9-]+)$/.exec(action);
  if (k) {
    const [, g, n] = k;
    if (g === 'pads') return { kort: `pads ${n}`, lang: `padmodus ${n} op de Maschine aan (nog eens: weer spelen); wat de pads dan doen staat in de regels van laag pads.${n}` };
    if (g === 'pagina') return { kort: `pagina ${n}`, lang: `knoppagina ${n} op de Maschine: de draaiknoppen doen wat laag pagina.${n} zegt` };
    return { kort: `wiel ${n}`, lang: `het masterwiel doet wat laag wiel.${n} zegt (nog eens: weer het instrument kiezen)` };
  }
  const t = TRACK.exec(action);
  const s = t ? STAPPEN[t[2]] : null;
  if (s) return { kort: s[0], lang: `${s[1]} — track ${t[1]}` };
  return null;
}
