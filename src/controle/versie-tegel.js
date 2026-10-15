/**
 * De tegel "Versie" van de Controlekamer (16 okt; Clay: "hoe kan ik snel en makkelijk zien dat ik in de
 * juiste laatste versie zit?"), uit GET /api/versie (server/versie.js). Puur: geen DOM, dus
 * test/versie.test.mjs rekent hem na. Groen betekent alle vier:
 *   - de server draait de commit die op schijf staat (anders: na git pull nog niet herstart);
 *   - die commit is wat main op GitHub heeft (anders: git pull, of nog niet gepusht);
 *   - de werkmap staat op main;
 *   - deze pagina is geladen op de code die nu op schijf staat (anders: herlaad; de pagina's laden hun code
 *     van schijf, met no-store, dus na een git pull is een open tabblad oud).
 * Wat het eerst gedaan moet worden staat bovenaan (`sub`); de rest staat eronder (`regel`). Een klik op de
 * tegel kijkt meteen opnieuw (ook naar GitHub, anders hooguit eens per 10 min).
 *
 * @param {object|null} v       het antwoord van /api/versie; { ontbreekt: true } = een oudere server (404);
 *                              null = nog niets of de server is weg
 * @param {object} [o]
 * @param {string|null} [o.geladen]  de commit die `opSchijf` zei toen deze pagina laadde
 */
export function versieTegel(v, { geladen = null } = {}) {
  const naam = 'Versie', id = 'versie';
  if (!v) return { id, naam, licht: 'uit', waarde: '…', sub: '', regel: '' };
  if (v.ontbreekt) return { id, naam, licht: 'half', waarde: 'onbekend', sub: 'de server is ouder dan deze tegel: herstart hem', regel: '' };
  const d = v.draait, s = v.opSchijf, gh = v.github;
  if (!d) return { id, naam, licht: 'half', waarde: 'onbekend', sub: `git: ${v.startFout ?? 'niets gelezen'}`, regel: '' };

  const taken = [];   // [tekst, ernst] in de volgorde waarin je ze doet
  if (s?.commit && s.commit !== d.commit) taken.push([`op schijf staat ${s.kort} (${datum(s.datum)}): herstart de server`, 'fout']);
  if (gh?.bereikt && gh.verhouding === 'github verder') taken.push([`GitHub heeft ${gh.kort}: git pull, dan de server herstarten`, 'half']);
  const tak = s?.tak ?? d.tak;
  if (tak && v.hoortTak && tak !== v.hoortTak) taken.push([`tak ${tak}, niet ${v.hoortTak}: git checkout ${v.hoortTak}`, 'half']);
  if (geladen && s?.commit && geladen !== s.commit) taken.push(['deze pagina is van een oudere versie: herlaad hem (en de mixer, als er niets speelt)', 'half']);

  const info = [];
  // Hoe je herstart, als dat moet: de lus en de server stoppen, dan VARVE (start de lus opnieuw, met de nieuwe code).
  if (taken.some(([t]) => /herstarten|herstart de server/.test(t))) info.push(HERSTART);
  if (!gh) info.push('GitHub: kijken…');
  else if (gh.bereikt && gh.verhouding === 'gelijk') info.push('gelijk met GitHub');
  else if (gh?.bereikt && gh.verhouding === 'hier verder') info.push('verder dan GitHub (nog niet gepusht)');
  else if (gh && !gh.bereikt) info.push(`GitHub niet bereikt (${gh.reden})`);
  if (Number.isInteger(s?.gewijzigd) && s.gewijzigd > 0) info.push(`${s.gewijzigd} ${s.gewijzigd === 1 ? 'bestand' : 'bestanden'} gewijzigd, niet gecommit`);

  const licht = taken.some(([, e]) => e === 'fout') ? 'fout' : taken.length ? 'half' : gh?.bereikt ? 'ok' : 'half';
  const sub = taken.length ? taken[0][0] : `${datum(d.datum)} · ${d.onderwerp}`.slice(0, 90);
  const regel = [...taken.slice(1).map(([t]) => t), ...info].join('\n');
  return { id, naam, licht, waarde: `${d.kort}${tak ? ` · ${tak}` : ''}`, sub, regel };
}

/** Hoe je de server herstart (docs/CONTROLEKAMER.md "Versie"). */
export const HERSTART = 'herstarten: mixer dicht, in Terminal sh tools/varve-app/server-lus.sh stop, dan VARVE in het Dock';

/** "16 okt 14:02" uit een ISO-datum (de klok van deze pagina). */
export function datum(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  const m = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'][d.getMonth()];
  return `${d.getDate()} ${m} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
