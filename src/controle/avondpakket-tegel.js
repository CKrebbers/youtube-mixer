/**
 * De tegel "Avondpakket" van de Controlekamer, uit GET /api/avondpakket
 * (server/avondpakket.js, docs/AVONDPAKKET.md). Puur: geen DOM, dus
 * test/avondpakket.test.mjs rekent hem na.
 *
 * Een tegel is { naam, licht, waarde, sub, regel } zoals de andere, plus twee
 * optionele velden: `id` (wordt data-id op de tegel) en `titel` (de hele
 * uitleg als tekst, voor de title bij hoveren: één regel per punt).
 *
 * - null: nog niets gehoord;
 * - { ontbreekt: true }: een oudere server zonder de route (404);
 * - { fout: status }: een fout van de server;
 * - een rapport: "klaar", "klaar · let op 2" of "2 rood", met als regel de
 *   uitleg van het eerste rode punt (anders het eerste oranje).
 */
export function avondpakketTegel(a, nu = new Date()) {
  const basis = { id: 'avondpakket', naam: 'Avondpakket', regel: '', titel: '' };
  if (!a) return { ...basis, licht: 'uit', waarde: '…', sub: '' };
  if (a.ontbreekt) return { ...basis, licht: 'uit', waarde: 'onbekend', sub: 'oudere server' };
  if (a.fout) return { ...basis, licht: 'uit', waarde: 'onbekend (fout)', sub: typeof a.fout === 'number' ? `status ${a.fout}` : String(a.fout) };
  const punten = Array.isArray(a.punten) ? a.punten : [];
  const telling = a.telling || { ok: 0, half: 0, fout: 0, uit: 0 };
  const waarde = telling.fout ? `${telling.fout} rood` : telling.half ? `klaar · let op ${telling.half}` : 'klaar';
  const sub = a.bevroren ? `bevroren: ${a.bevroren}` : [a.profiel, a.fase, tijd(a.t, nu)].filter(Boolean).join(' · ');
  const eerste = punten.find((p) => p.licht === 'fout') || punten.find((p) => p.licht === 'half');
  const regel = eerste ? `${eerste.naam}: ${eerste.sub || eerste.waarde}` : '';
  const teken = { ok: '●', half: '◐', fout: '✕', uit: '○' };
  const titel = punten.map((p) => `${teken[p.licht] ?? '○'} ${p.naam}: ${p.waarde}${p.sub ? ` — ${p.sub}` : ''}`).join('\n');
  return { ...basis, licht: LICHT.has(a.licht) ? a.licht : 'uit', waarde, sub, regel, titel };
}

const LICHT = new Set(['ok', 'half', 'fout', 'uit']);

/** "14:05" vandaag, anders "8 okt 14:05". */
function tijd(ms, nu) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hm = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const zelfdeDag = d.getFullYear() === nu.getFullYear() && d.getMonth() === nu.getMonth() && d.getDate() === nu.getDate();
  return zelfdeDag ? hm : `${d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }).replace('.', '')} ${hm}`;
}
