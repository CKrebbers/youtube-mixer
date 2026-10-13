/**
 * Kleine hulpjes voor de schermlaag. Stonden eerst in vijf bestanden los,
 * elk net iets anders — de MIDI-monitor ontsnapte geen aanhalingstekens,
 * terwijl hij in een value="…" werd gebruikt.
 */

/** Tekst veilig in HTML, ook binnen een attribuut. */
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Tekst in een element zetten, alleen als hij anders is, en dan in de BESTAANDE
 * tekstknoop (`data`) in plaats van `textContent` (dat gooit de knoop weg en zet
 * een nieuwe: elk beeld een knoop eruit en erin, en daarmee opmaak voor die
 * knoop en wat er een :has() op heeft; controller-invoer, 14 okt).
 */
export function zetTekst(el, t) {
  const n = el.firstChild;
  if (n && n.nodeType === 3 && !n.nextSibling) { if (n.data !== t) n.data = t; }
  else if (el.textContent !== t) el.textContent = t;
}

/** 0..1 als procent. */
export const pct = (v) => `${Math.round((typeof v === 'number' ? v : 0) * 100)}%`;

/** Seconden als m:ss. */
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Bytes als MB of GB, in het Nederlands. */
export const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(b / 1e6)} MB`);
