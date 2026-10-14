import { NAAM, GERESERVEERD, MAX_TITEL, MAX_UITLEG } from '../standen/stand-model.js';

/**
 * De bewerker van een opstelling in de Controlekamer (docs/STANDEN.md): per
 * deel een keuzelijst, zodat Clay een stand instelt zonder JSON (pijler 4,
 * VISIE §5.3). Puur: HTML als tekst en waarden → stand, geen DOM, geen fetch;
 * test/stand-bewerker.test.mjs rekent het na.
 *
 * Wat hier te kiezen is, zijn precies de delen die de server vandaag aanneemt
 * (nacht als rem, mapping, krat, master-rack, hub-set, mixer via de hub,
 * avondpakket). Wat de bewerker niet kent (beeld, koptelefoon, vormen, een
 * onbekend deel) blijft zoals het in het bestand staat. Je huidige mapping in
 * een stand zetten doet de knop "leg vast" (POST …/vastleggen), niet de lijst.
 */

/** De delen die de bewerker zet; de rest van een stand blijft staan. */
export const BEWERKBAAR = Object.freeze(['pakket', 'nacht', 'mapping', 'kaart', 'master', 'hub']);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Een nieuwe naam voor "bewaar als": dezelfde regel als de server (kleine letters, cijfers, - en _). */
export const nieuweNaamGeldig = (n) => typeof n === 'string' && NAAM.test(n) && !GERESERVEERD.has(n);

/**
 * Wat Clay in het naamveld typt → de naam waaronder het bewaard wordt: zonder
 * spaties eromheen en in kleine letters ("Avond3" → "avond3"), zodat hij
 * niet om een hoofdletter geweigerd wordt. Spaties en leestekens blijven
 * staan: die weigert nieuweNaamGeldig met een melding.
 */
export const nieuweNaam = (n) => (typeof n === 'string' ? n.trim().toLowerCase() : '');

/** De nacht als keuze: '' (ongemoeid), 'uit', 'vannacht', 'beide'. */
export function nachtKeuze(n) {
  if (!n || typeof n !== 'object') return '';
  const uit = n.aan === false, vannacht = n.vannacht === false;
  return uit && vannacht ? 'beide' : uit ? 'uit' : vannacht ? 'vannacht' : '';
}

function opties(lijst, gekozen, onbekend = 'niet gevonden') {
  const rijen = [...lijst];
  if (gekozen && !rijen.some((o) => o.waarde === gekozen)) rijen.push({ waarde: gekozen, tekst: `${gekozen} (${onbekend})` });
  return rijen.map((o) => `<option value="${esc(o.waarde)}"${o.waarde === (gekozen ?? '') ? ' selected' : ''}>${esc(o.tekst)}</option>`).join('');
}

const veld = (label, binnen, uitleg = '') => `<label class="bw-veld"><span class="bw-label">${esc(label)}</span>${binnen}${uitleg ? `<span class="bw-hint">${esc(uitleg)}</span>` : ''}</label>`;

/**
 * De velden voor één stand. `keuzes` is GET /api/standen/keuzes:
 * { sjablonen, sjablonenFout?, kratten: [{ id, naam, aantal }], profielen | null, bekendeProfielen?, hubSets | null, mappingNu }.
 */
export function bewerkerHtml(stand, keuzes = {}) {
  const d = stand?.delen ?? {};
  const k = keuzes ?? {};
  const mappingDoc = d.mapping && typeof d.mapping === 'object';
  const mapping = d.mapping === 'standaard' ? 'standaard' : mappingDoc ? 'bewaard' : '';
  const regels = mappingDoc ? (d.mapping.rules?.length ?? 0) + (d.mapping.removed?.length ?? 0) : 0;
  const profielen = Array.isArray(k.profielen) ? k.profielen : Array.isArray(k.bekendeProfielen) ? k.bekendeProfielen : [];
  const hubSets = Array.isArray(k.hubSets) ? k.hubSets : [];
  const blijft = Object.keys(d).filter((x) => !BEWERKBAAR.includes(x));
  return [
    veld('titel', `<input name="titel" type="text" maxlength="${MAX_TITEL}" value="${esc(stand?.titel)}">`),
    veld('uitleg', `<input name="uitleg" type="text" maxlength="${MAX_UITLEG}" value="${esc(stand?.uitleg)}">`),
    veld('nacht', `<select name="nacht">${opties([
      { waarde: '', tekst: 'ongemoeid' }, { waarde: 'uit', tekst: 'uit' },
      { waarde: 'vannacht', tekst: 'vannacht niet' }, { waarde: 'beide', tekst: 'uit en vannacht niet' },
    ], nachtKeuze(d.nacht))}</select>`, 'een opstelling kan de nacht alleen remmen'),
    veld('mapping', `<select name="mapping">${opties([
      { waarde: '', tekst: 'ongemoeid' }, { waarde: 'standaard', tekst: 'standaard (je eigen regels eraf)' },
      ...(mappingDoc ? [{ waarde: 'bewaard', tekst: `zoals bewaard (eigen, ${regels} regel${regels === 1 ? '' : 's'})` }] : []),
    ], mapping)}</select>`, `nu: ${k.mappingNu ?? '?'}; je huidige erin zetten = "leg vast"`),
    veld('krat', `<select name="krat">${opties([{ waarde: '', tekst: '—' },
      ...(k.kratten ?? []).map((x) => ({ waarde: x.id, tekst: `${x.naam} (${x.aantal ?? '?'})` }))], d.kaart?.krat ?? '')}</select>`, 'kies hem daarna zelf in de kaart'),
    // racks/sjablonen.json niet te lezen (iCloud?): dat zeggen, en een gekozen sjabloon is dan "niet nagekeken", niet "niet gevonden".
    veld('master-rack', `<select name="master">${opties([{ waarde: '', tekst: '—' },
      ...(k.sjablonen ?? []).map((n) => ({ waarde: n, tekst: n }))], d.master?.sjabloon ?? '', k.sjablonenFout ? 'niet nagekeken' : 'niet gevonden')}</select>`,
    k.sjablonenFout ? `${k.sjablonenFout}; probeer het straks opnieuw` : 'de mixer volgt nog niet'),
    veld('hub-set', `<select name="hubSet">${opties([{ waarde: '', tekst: '—' },
      ...hubSets.map((n) => ({ waarde: n, tekst: n }))], d.hub?.set ?? '')}</select>`, k.hubSets ? 'start hem zelf' : 'geen hub gevonden op deze Mac'),
    veld('mixer openen', `<select name="mixerVia">${opties([
      { waarde: '', tekst: 'niet noemen' }, { waarde: 'nee', tekst: 'gewoon' }, { waarde: 'ja', tekst: 'via de hub' },
    ], d.hub?.mixerVia === true ? 'ja' : d.hub?.mixerVia === false ? 'nee' : '')}</select>`),
    veld('avondpakket', `<select name="profiel">${opties([{ waarde: '', tekst: '—' },
      ...profielen.map((n) => ({ waarde: n, tekst: n }))], d.pakket?.profiel ?? '')}</select>`, k.profielen ? '' : 'avondpakket nog niet samengevoegd: niet nagekeken'),
    blijft.length ? `<p class="bw-blijft">blijft zoals in het bestand: ${esc(blijft.join(', '))}</p>` : '',
  ].join('');
}

/**
 * Waarden uit het formulier (Object.fromEntries(new FormData(form))) → een
 * stand (schema 1). `oud` is de stand die bewerkt werd: wat de bewerker niet
 * kent blijft staan, en "zoals bewaard" neemt zijn mapping-document over.
 * Een lege keuze laat het deel weg (ongemoeid).
 */
export function leesBewerker(w = {}, oud = null) {
  const tekst = (x) => (typeof x === 'string' ? x.trim() : '');
  const delen = {};
  if (w.profiel) delen.pakket = { profiel: w.profiel };
  if (w.nacht === 'uit') delen.nacht = { aan: false };
  else if (w.nacht === 'vannacht') delen.nacht = { vannacht: false };
  else if (w.nacht === 'beide') delen.nacht = { aan: false, vannacht: false };
  if (w.mapping === 'standaard') delen.mapping = 'standaard';
  else if (w.mapping === 'bewaard' && oud?.delen?.mapping && typeof oud.delen.mapping === 'object') delen.mapping = oud.delen.mapping;
  if (w.krat) delen.kaart = { krat: w.krat };
  if (w.master) delen.master = { sjabloon: w.master };
  const hub = {};
  if (w.hubSet) hub.set = w.hubSet;
  if (w.mixerVia === 'ja') hub.mixerVia = true;
  else if (w.mixerVia === 'nee') hub.mixerVia = false;
  if (Object.keys(hub).length) delen.hub = hub;
  for (const [deel, v] of Object.entries(oud?.delen ?? {})) if (!BEWERKBAAR.includes(deel)) delen[deel] = v;
  return { schema: 1, titel: tekst(w.titel), uitleg: tekst(w.uitleg), delen };
}
