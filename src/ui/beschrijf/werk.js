// De uitleg van de actions van spoor S3 ('werk', docs/werkruimte/S3.md): { kort, lang } zoals
// beschrijf() in apc-beschrijf.js, of null (dan beschrijft apc-beschrijf.js hem zelf). Puur:
// geen DOM en geen bus (apc.html en maschine.html laden dit statisch).
const VAST = {
  'werk.thuis': { kort: 'THUIS', lang: 'Terug naar de basis: deel = het startdeel, de standaardmapjes op elk apparaat (hotcues, strip, grid-modus uit), gluren en vasthouden los. Klank, faders en wat er speelt blijven zoals ze zijn.' },
  'werk.vastleggen': { kort: 'leg vast', lang: 'Wat je nu open hebt (mapjes per apparaat, open rijen) wordt dit deel van de werkruimte. Twee keer drukken binnen 3 s; opgeslagen met versie (een botsing overschrijft niets).' },
  'werk.kies': { kort: 'werkruimte', lang: 'Een andere werkruimte kiezen. Alleen op het scherm of in de Controlekamer, nooit op een knop: zo krijg je midden in een set geen andere indeling.' },
  'werk.deel.next': { kort: 'deel ▶', lang: 'Het volgende deel van de werkruimte (alleen mapjes, panelen en rijen; nooit een klank).' },
  'werk.deel.prev': { kort: '◀ deel', lang: 'Het vorige deel van de werkruimte (alleen mapjes, panelen en rijen; nooit een klank).' },
};
const LABEL = { mix: 'MIX', uitlijn: 'UITLIJN', fx: 'FX', stems: 'STEMS', secties: 'SECTIES', spelen: 'SPELEN', beeld: 'BEELD', bladeren: 'LIBRARY' };

export default (action) => {
  if (typeof action !== 'string' || !action.startsWith('werk.')) return null;
  if (VAST[action]) return VAST[action];
  const m = /^werk\.deel\.(\d)$/.exec(action);
  if (m) return { kort: `deel ${m[1]}`, lang: `Deel ${m[1]} van de werkruimte (F${m[1]} op de Maschine, de ${m[1]}e tab op de werk-balk): zet de mapjes, panelen en rijen van dat deel open, nooit een klank.` };
  const d = /^werk\.deel\.([a-z]{2,16})$/.exec(action);
  if (d) {
    const naam = LABEL[d[1]] ?? d[1].toUpperCase();
    return { kort: naam, lang: `Het deel ${naam} van de werkruimte: zet zijn mapjes, panelen en rijen open, nooit een klank. Bestaat het deel niet in deze werkruimte, dan doet hij niets.` };
  }
  return null;
};
