/**
 * De Tocht: een spel dat je helemaal uitspeelt en dat je onderweg langs alles leidt wat er kan.
 * Niets zit op slot (je bent altijd vrij): de hoofdstukken zijn een weg, geen hek. Onderweg wordt
 * alles bewaard als data: wat je ontdekte, wat je maakte, en daaruit je smaak (smaak.js). Aan het
 * eind kies je: SPELEN (verder met wat je verzamelde) of BOUWEN (verder aan het spel zelf: de
 * bouwwensen hieronder, waar je op stemt; Claude leest ze als bouwopdracht).
 *
 * Puur: `verwerk(staat, gebeurtenis)` geeft een nieuwe staat. Gebeurtenissen:
 *   { soort: 'actie', id, v, bron }      een handeling op de bus (alleen wat JIJ doet telt mee)
 *   { soort: 'maat', variatie }           er ging een maat voorbij terwijl er een opstelling speelde
 *
 *   staat = { schema: 1, hoofdstuk: i, voortgang: { <doel-sleutel>: telling | [verschillende] },
 *             klaar: [hoofdstuk-id], ontdekt: { <kaartje>: eerste-keer-volgnummer }, stap: n,
 *             einde: null | 'spelen' | 'bouwen', wensen: { <wens-id>: stemmen } }
 */

export const SCHEMA = 1;

/** Wie telt als "jij" (niet de opstelling, de auto-DJ of de drift). */
export const BRONNEN_SPELER = Object.freeze(['apc', 'maschine', 'toetsen', 'scherm', 'hub', 'muis']);

/**
 * Een doel: { sleutel, wat (tekst), soort: 'aantal'|'verschillend'|'maten', match (regex op de actie-id),
 * nodig, waar? (voor maten: { variatie: min }), alleenNu? (telt alleen in zijn eigen hoofdstuk) }.
 */
const D = (sleutel, wat, soort, match, nodig, extra = {}) => Object.freeze({ sleutel, wat, soort, match, nodig, ...extra });

export const HOOFDSTUKKEN = Object.freeze([
  { id: 'klank', titel: 'Eerste klank', uitleg: 'Kies met het wiel een recept, druk het wiel in om het klaar te zetten en PLAY om te beginnen.',
    doelen: [D('klank.laad', 'zet een recept klaar', 'aantal', /^opstelling\.(laad|genereer)$/, 1), D('klank.start', 'start op de 1', 'aantal', /^opstelling\.start$/, 1)] },
  { id: 'knoppen', titel: 'Acht knoppen', uitleg: 'De draaiknoppen boven de schermen zijn de acht macro\'s. Overal dezelfde volgorde: schaal, dichtheid, beweging, vervorming, kleur, helderheid, variatie, ruimte.',
    doelen: [D('knoppen.vijf', 'draai vijf verschillende macro\'s', 'verschillend', /^opstelling\.macro\.(\d)$/, 5)] },
  { id: 'scenes', titel: 'Scenes', uitleg: 'De middelste pads zijn scenes: in één klap een andere stand van alle macro\'s, en elke keer net anders.',
    doelen: [D('scenes.drie', 'speel drie verschillende scenes', 'verschillend', /^opstelling\.scene\.(\d)$/, 3)] },
  { id: 'zaad', titel: 'Het zaad', uitleg: 'Pad 13 (linksboven) geeft een nieuw zaad: hetzelfde recept, maar andere nummers, patronen en klanken.',
    doelen: [D('zaad.drie', 'rol drie keer opnieuw', 'aantal', /^opstelling\.herrol$/, 3)] },
  { id: 'muteer', titel: 'Muteren en terug', uitleg: 'Muteren (pad 14) is een stap opzij in plaats van een sprong. Terug (pad 16) haalt de vorige terug: niets is ooit weg.',
    doelen: [D('muteer.twee', 'muteer twee keer', 'aantal', /^opstelling\.muteer$/, 2), D('muteer.terug', 'ga één keer terug', 'aantal', /^opstelling\.terug$/, 1)] },
  { id: 'kruis', titel: 'Kruisen', uitleg: 'Kruisen (pad 15) mengt deze opstelling met de vorige: de helft van elk.',
    doelen: [D('kruis.een', 'kruis één keer', 'aantal', /^opstelling\.kruis$/, 1)] },
  { id: 'variatie', titel: 'Laat hem los', uitleg: 'Macro 7 is variatie: hoe hoger, hoe meer de opstelling uit zichzelf beweegt. Draai hem open en luister.',
    doelen: [D('variatie.maten', 'laat acht maten spelen met variatie boven 70%', 'maten', null, 8, { waar: { variatie: 0.7 } })] },
  { id: 'stems', titel: 'Stems', uitleg: 'De onderste pads halen een stem weg zolang je drukt (zang, drums, bas, overig) van de track met focus. Met SHIFT blijft hij weg.',
    doelen: [D('stems.twee', 'haal twee verschillende stems weg', 'verschillend', /^track\.\d+\.stem\.(\w+)\.kill/, 2)], kanZonder: 'stems' },
  { id: 'focus', titel: 'Focus', uitleg: 'De groepknoppen A–H kiezen de track met focus, zoals Track Select op de APC. De stems en de effecten volgen die track.',
    doelen: [D('focus.drie', 'geef drie tracks focus', 'verschillend', /^track\.(\d+)\.focus$/, 3), D('focus.fx', 'draai aan een effect', 'aantal', /^track\.\d+\.fx\./, 1)] },
  { id: 'bouwdoos', titel: 'De bouwdoos', uitleg: 'AUTO maakt een heel nieuw recept uit alles wat er is. Hoe meer je speelt, hoe meer het naar jouw smaak kiest.',
    doelen: [D('bouwdoos.drie', 'maak drie nieuwe recepten', 'aantal', /^opstelling\.genereer$/, 3)] },
  { id: 'bewaar', titel: 'Wat je mooi vindt', uitleg: 'DUPLICATE bewaart de opstelling van nu als nieuw recept. Zo groeit je eigen verzameling, en zo leert het spel wat je mooi vindt.',
    doelen: [D('bewaar.twee', 'bewaar twee opstellingen', 'aantal', /^opstelling\.bewaar$/, 2)] },
  { id: 'avond', titel: 'Je eigen avond', uitleg: 'Speel nu zonder opdracht: 32 maten, met minstens drie scenes onderweg. Daarna kies je hoe je verder wilt.',
    doelen: [D('avond.maten', 'speel 32 maten', 'maten', null, 32, { alleenNu: true }), D('avond.scenes', 'met drie verschillende scenes', 'verschillend', /^opstelling\.scene\.(\d)$/, 3, { alleenNu: true })] },
]);

/**
 * Wat er nog gebouwd kan worden (uit de inventaris van 29 okt 2026, docs in v2/OPSTELLING.md):
 * het pad BOUWEN. Stemmen zijn data; Claude leest ze uit ~/.varve/v2/instellingen/tocht.json.
 */
export const WENSEN = Object.freeze([
  { id: 'strata', titel: 'Strata als bron', uitleg: 'De generatieve ambient- en beatmotor van varve.nl als spoor: acht werelden, elke start anders.', waar: 'varve-site/strata-ambient' },
  { id: 'formula', titel: 'Formula Lab als beeldlaag', uitleg: 'Formules worden beeld, met mutatie en kruisen zoals hier.', waar: 'formula-lab' },
  { id: 'avkern', titel: 'AV-kern: drone, pad, korrelwolk, resonator', uitleg: 'Vier ademende klankmodules met acht knoppen: past precies op het alfabet.', waar: 'av-kern' },
  { id: 'waterschaal', titel: 'Waterschaal', uitleg: 'De modale klankschaal (brons, kristal, glas, gong) als instrument.', waar: 'waterschaal' },
  { id: 'stroommachine', titel: 'Stroommachine in de mix', uitleg: 'De rijkste beeldmotor als laag in v2, met een zaad per recept.', waar: 'stroommachine' },
  { id: 'stems-pc', titel: 'Stems maken op de pc', uitleg: 'Demucs op de videokaart, zodat elk nummer stems krijgt (nu heeft de pc-library er geen).', waar: 'v1 tools/stems' },
  { id: 'elektron', titel: 'Ritmes uit elektronlearn', uitleg: 'Kans per stap, parameter-locks en microtiming in de patronen.', waar: 'elektronlearn' },
  { id: 'werkbank', titel: 'Klanken uit de Werkbank', uitleg: 'Toevallige maar altijd kloppende synth-patches, met sloten die je vastzet.', waar: 'varve-site/werkbank' },
  { id: 'druk', titel: 'Druk op de pads', uitleg: 'Aftertouch: effecten gaan zo ver open als je drukt, de klankschaal zo hard als je slaat.', waar: 'Maschine-kaart (9 okt)' },
  { id: 'apc-laag', titel: 'De opstelling op de APC', uitleg: 'Een laag op de APC40: faders per spoor, scenes op de scene-knoppen.', waar: 'indelingen/apc40mk2.json' },
  { id: 'medisynth', titel: 'Nooit stil (MediSynth)', uitleg: 'Een grondlaag die altijd klopt en altijd ademt, ook als alles uit staat.', waar: 'medisynth' },
  { id: 'uurwerk-fx', titel: 'De effecten van Uurwerk', uitleg: 'Negentien effecten, waaronder geheugen en pitchshift, als racks.', waar: 'uurwerk' },
]);

export const leegStaat = () => ({ schema: SCHEMA, hoofdstuk: 0, voortgang: {}, klaar: [], ontdekt: {}, stap: 0, einde: null, wensen: {} });

export function normaliseerStaat(x) {
  const s = leegStaat();
  if (!x || typeof x !== 'object') return s;
  s.hoofdstuk = Number.isInteger(x.hoofdstuk) ? Math.max(0, Math.min(HOOFDSTUKKEN.length, x.hoofdstuk)) : 0;
  s.voortgang = x.voortgang && typeof x.voortgang === 'object' ? { ...x.voortgang } : {};
  s.klaar = Array.isArray(x.klaar) ? x.klaar.filter((k) => HOOFDSTUKKEN.some((h) => h.id === k)) : [];
  s.ontdekt = x.ontdekt && typeof x.ontdekt === 'object' ? { ...x.ontdekt } : {};
  s.stap = Number.isFinite(x.stap) ? x.stap : 0;
  s.einde = x.einde === 'spelen' || x.einde === 'bouwen' ? x.einde : null;
  s.wensen = x.wensen && typeof x.wensen === 'object' ? { ...x.wensen } : {};
  return s;
}

/** Een actie-id als kaartje: track-nummers weg, zodat "stem zang weg" één ontdekking is. */
export const kaartjeVan = (id) => id.replace(/^track\.\d+\./, 'track.');

const telt = (_h, d, s) => {
  const v = s.voortgang[d.sleutel];
  return d.soort === 'verschillend' ? (Array.isArray(v) ? v.length : 0) : (Number.isFinite(v) ? v : 0);
};
/** Hoe ver een doel is: [gedaan, nodig]. */
export const doelStand = (s, d) => [Math.min(d.nodig, telt(null, d, s)), d.nodig];
export const hoofdstukKlaar = (s, h) => h.doelen.every((d) => telt(h, d, s) >= d.nodig);

/** Het hoofdstuk van nu, of null als de tocht uit is. */
export const huidig = (s) => HOOFDSTUKKEN[s.hoofdstuk] ?? null;

function schuifDoor(s) {
  let uit = s;
  while (huidig(uit) && hoofdstukKlaar(uit, huidig(uit))) {
    const h = huidig(uit);
    uit = { ...uit, klaar: uit.klaar.includes(h.id) ? uit.klaar : [...uit.klaar, h.id], hoofdstuk: uit.hoofdstuk + 1 };
  }
  return uit;
}

/**
 * Eén gebeurtenis verwerken. Doelen van ALLE hoofdstukken tellen mee (wie vooruit speelt, krijgt dat
 * later cadeau); alleen het huidige hoofdstuk schuift door. Geeft { staat, nieuw: [kaartjes], klaar: [hoofdstuk-id] }.
 */
export function verwerk(staat, g) {
  let s = { ...staat, voortgang: { ...staat.voortgang }, ontdekt: { ...staat.ontdekt } };
  const nieuw = [];
  if (g.soort === 'actie') {
    if (!BRONNEN_SPELER.includes(g.bron) || g.v === false) return { staat, nieuw, klaar: [] };
    const k = kaartjeVan(g.id);
    if (!(k in s.ontdekt)) { s.ontdekt[k] = ++s.stap; nieuw.push(k); }
    for (const h of HOOFDSTUKKEN) for (const d of h.doelen) {
      if (!d.match || (d.alleenNu && huidig(s) !== h)) continue;
      const m = d.match.exec(g.id);
      if (!m) continue;
      if (d.soort === 'verschillend') {
        const lijst = Array.isArray(s.voortgang[d.sleutel]) ? s.voortgang[d.sleutel] : [];
        if (!lijst.includes(m[1])) s.voortgang[d.sleutel] = [...lijst, m[1]];
      } else s.voortgang[d.sleutel] = (s.voortgang[d.sleutel] ?? 0) + 1;
    }
  } else if (g.soort === 'maat') {
    for (const h of HOOFDSTUKKEN) for (const d of h.doelen) {
      if (d.soort !== 'maten' || (d.alleenNu && huidig(s) !== h)) continue;
      if (d.waar?.variatie !== undefined && !(g.variatie >= d.waar.variatie)) continue;
      s.voortgang[d.sleutel] = (s.voortgang[d.sleutel] ?? 0) + 1;
    }
  }
  const voor = s.klaar.length;
  s = schuifDoor(s);
  return { staat: s, nieuw, klaar: s.klaar.slice(voor) };
}

/** Een hoofdstuk overslaan (je bent vrij): het telt niet als klaar, je kunt er later terug. */
export const overslaan = (s) => ({ ...s, hoofdstuk: Math.min(HOOFDSTUKKEN.length, s.hoofdstuk + 1) });
/** Terug naar een hoofdstuk naar keuze. */
export const naar = (s, i) => ({ ...s, hoofdstuk: Math.max(0, Math.min(HOOFDSTUKKEN.length, i)) });
/** Aan het eind: spelen of bouwen (kan altijd weer anders). */
export const kies = (s, einde) => ({ ...s, einde: einde === 'bouwen' ? 'bouwen' : 'spelen' });
/** Een stem op een bouwwens. */
export const stem = (s, id, r = 1) => (WENSEN.some((w) => w.id === id) ? { ...s, wensen: { ...s.wensen, [id]: Math.max(0, (s.wensen[id] ?? 0) + r) } } : s);
/** De wensen op volgorde van stemmen. */
export const wensenOpVolgorde = (s) => [...WENSEN].map((w) => ({ ...w, stemmen: s.wensen[w.id] ?? 0 })).sort((a, b) => b.stemmen - a.stemmen);
