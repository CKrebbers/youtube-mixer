/**
 * De tegel "Server" van de Controlekamer: draait hij, hoeveel nummers, een
 * regel over de herstarts van de herstartlus (AR9) en een regel over de secties
 * (docs/SECTIES.md): hoeveel nummers (nog) geen actuele sectiekaart hebben, uit
 * GET /api/secties. Puur: geen DOM, dus test/sec-controle.test.mjs rekent hem na.
 *
 * Een tegel is { naam, licht, waarde, sub, regel }; `regel` is wat er onder `sub`
 * staat ('' = niets), meer regels gescheiden door een '\n' (de opmaak breekt daar).
 *
 * @param {{ server: boolean|null, nummers?: number|null, secties?: object|null, lus?: object|null, nu?: number }} stand
 *   server: true = het laatste verzoek lukte, false = niet, null = nog niets gehoord.
 *   lus: `lus` uit GET /api/leeft (server/lus.js), null = onbekend (een oudere server). nu: ms (voor de test).
 */
export function serverTegel({ server, nummers = null, secties = null, lus = null, nu = Date.now() } = {}) {
  const naam = 'Server';
  if (server === false) return { naam, licht: 'fout', waarde: 'niet bereikbaar', sub: 'start hem op de Mac (docs/HANDOFF.md)', regel: '' };
  const h = server ? herstartRegel(lus, nu) : { tekst: '', recent: false };
  return { naam, licht: server ? (h.recent ? 'half' : 'ok') : 'uit', waarde: server ? 'draait' : '…',
    sub: nummers === null ? '' : `library: ${nummers} nummers`,
    regel: server ? [h.tekst, sectiesRegel(secties)].filter(Boolean).join('\n') : '' };
}

/** Zo lang na een herstart is de tegel oranje (daarna weer groen; de regel blijft staan). */
export const HERSTART_RECENT_MS = 10 * 60 * 1000;

/**
 * De regel over de herstarts (AR9), uit `lus` van GET /api/leeft ({ onder, sinds, aantal, herstarts }):
 * - null (een oudere server, of nog niets gehoord): geen regel;
 * - niet onder de lus (met de hand gestart, of de LaunchAgent): "zonder herstartlus" (valt hij om, dan
 *   start niemand hem opnieuw);
 * - onder de lus zonder herstart: geen regel (niets te melden);
 * - anders de laatste: "herstart om 22:14 (viel om, exitcode 137) · 1 keer sinds 21:30", of "(hing, de
 *   wachter zette hem neer)" na een hang (AR18). `recent` = de laatste is minder dan 10 minuten oud.
 * De klok is de lokale tijd van deze pagina.
 * @returns {{ tekst: string, recent: boolean }}
 */
export function herstartRegel(lus, nu = Date.now()) {
  const geen = { tekst: '', recent: false };
  if (!lus || typeof lus !== 'object') return geen;
  if (!lus.onder) return { tekst: 'zonder herstartlus (valt hij om, dan start niemand hem opnieuw)', recent: false };
  const lijst = Array.isArray(lus.herstarts) ? lus.herstarts.filter((h) => Number.isFinite(h?.t) && Number.isInteger(h?.code)) : [];
  const laatste = lijst.at(-1);
  if (!laatste) return geen;
  const aantal = Number.isInteger(lus.aantal) && lus.aantal >= lijst.length ? lus.aantal : lijst.length;
  const hoe = laatste.hang ? 'hing, de wachter zette hem neer' : `viel om, exitcode ${laatste.code}`;
  const sinds = Number.isFinite(lus.sinds) ? ` sinds ${klok(lus.sinds)}` : '';
  return { tekst: `herstart om ${klok(laatste.t)} (${hoe}) · ${aantal}\u00a0keer${sinds}`, recent: nu - laatste.t < HERSTART_RECENT_MS };
}

const klok = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/**
 * De regel over de secties, uit het antwoord van GET /api/secties:
 * { totaal, zonder, verouderd } (Library.sectieTelling).
 * - null (nog niets, of de server niet bereikbaar): geen regel;
 * - { ontbreekt: true }: een oudere server zonder de route (404), "onbekend";
 * - { fout: status }: een fout van de server (bv. 500 op een library.db met de
 *   v9 van een andere tak, zonder secties_json): "onbekend (fout)";
 * - een lege library, of een antwoord dat niet klopt: geen regel.
 * `zonder` = nog geen kaart (komt bij het laden, of na een herstart op de
 * achtergrond); `verouderd` = wel een kaart, maar de server rekent hem opnieuw
 * (oudere SECTIE_VERSIE, een ander grid, stems erbij). Met de hand of op slot
 * telt als actueel.
 * Binnen een deel harde spaties: in een smalle tegel breekt de regel bij de
 * " · ", niet midden in "12 nog zonder".
 */
export function sectiesRegel(s) {
  if (!s) return '';
  if (s.ontbreekt) return 'secties: onbekend (oudere server)';
  if (s.fout) return 'secties: onbekend (fout)';
  const heel = (x) => Number.isInteger(x) && x >= 0;
  if (!heel(s.totaal) || !heel(s.zonder) || !heel(s.verouderd) || s.totaal === 0) return '';
  const delen = [];
  if (s.zonder) delen.push(`${s.zonder} nog zonder`);
  if (s.verouderd) delen.push(`${s.verouderd} verouderd`);
  return `secties: ${delen.length ? delen.map((d) => d.replaceAll(' ', '\u00a0')).join(' · ') : 'alles actueel'}`;
}
