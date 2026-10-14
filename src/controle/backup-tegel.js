/**
 * De tegel "Backup" van de Controlekamer, uit GET /api/backups
 * (server/backup.js). Puur: geen DOM, dus test/backup.test.mjs rekent hem na.
 *
 * - fout bij de laatste poging: rood, met de reden;
 * - nog nooit een kopie: oranje (de eerste komt bij het opstarten);
 * - anders groen met het tijdstip van de laatste kopie. Een oude datum is
 *   geen fout: zonder wijziging komt er bewust geen nieuwe kopie.
 */
export function backupTegel(b, nu = new Date()) {
  const naam = 'Backup';
  if (!b) return { naam, licht: 'uit', waarde: '…', sub: '' };
  if (b.fout) return { naam, licht: 'fout', waarde: 'mislukt', sub: b.fout };
  if (!b.laatste) return { naam, licht: b.bezig ? 'uit' : 'half', waarde: b.bezig ? 'bezig…' : 'nog geen', sub: 'library.db heeft nog geen kopie' };
  const n = b.aantal ?? 0;
  return { naam, licht: 'ok', waarde: wanneer(b.laatste.tijd, nu),
    sub: `${n} kopie${n === 1 ? '' : 'ën'}${b.laatste.bytes ? ` · ${(b.laatste.bytes / 1e6).toFixed(1).replace('.', ',')} MB` : ''}` };
}

/** "14:05" vandaag, "gisteren 22:10", anders "28 sep 22:10". Ook voor de tegel Avondpakket. */
export function wanneer(ms, nu) {
  if (!Number.isFinite(ms)) return 'onbekend';
  const d = new Date(ms);
  const tijd = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const dag = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const verschil = Math.round((dag(nu) - dag(d)) / 864e5);
  if (verschil === 0) return tijd;
  if (verschil === 1) return `gisteren ${tijd}`;
  return `${d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }).replace('.', '')} ${tijd}`;
}
