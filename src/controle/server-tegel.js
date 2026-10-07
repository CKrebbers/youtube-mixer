/**
 * De tegel "Server" van de Controlekamer: draait hij, hoeveel nummers, en een
 * regel over de secties (docs/SECTIES.md): hoeveel nummers (nog) geen actuele
 * sectiekaart hebben, uit GET /api/secties. Puur: geen DOM, dus
 * test/sec-controle.test.mjs rekent hem na.
 *
 * Een tegel is { naam, licht, waarde, sub, regel }; `regel` is een extra regel
 * onder `sub` ('' = geen).
 *
 * @param {{ server: boolean|null, nummers?: number|null, secties?: object|null }} stand
 *   server: true = het laatste verzoek lukte, false = niet, null = nog niets gehoord.
 */
export function serverTegel({ server, nummers = null, secties = null } = {}) {
  const naam = 'Server';
  if (server === false) return { naam, licht: 'fout', waarde: 'niet bereikbaar', sub: 'start hem op de Mac (docs/HANDOFF.md)', regel: '' };
  return { naam, licht: server ? 'ok' : 'uit', waarde: server ? 'draait' : '…',
    sub: nummers === null ? '' : `library: ${nummers} nummers`, regel: server ? sectiesRegel(secties) : '' };
}

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
