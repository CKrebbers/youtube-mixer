/**
 * De mixer meldt zijn stand aan de Controlekamer (controle.html) over een
 * BroadcastChannel: APC, audio, wat er speelt. Alleen lezen, en in één
 * richting: de Controlekamer opent zelf nooit MIDI, dus er komt nooit een
 * tweede client op de APC.
 *
 * Alleen het tabblad met de Web Lock (tabblad.js) meldt; een tweede
 * mixer-tabblad zwijgt. Elke seconde, en meteen als de Controlekamer erom
 * vraagt ({ vraag: 'status' }): een tabblad op de achtergrond knijpt zijn
 * timers (na 5 min tot één keer per minuut als er niets klinkt), een bericht
 * komt wel meteen binnen.
 */
export const KANAAL = 'varve-status';

const toonTekst = (t) => (t?.camelot ? `${t.camelot} ${t.kort ?? ''}`.trim() : null);

/** Het bericht, uit een engine-snapshot en de MIDI-status. Puur. */
export function maakStatus({ snap, midi, audio = null, auto = false, opname = false, nu = Date.now() }) {
  const tracks = Object.values(snap?.decks ?? {})
    .filter((d) => d.loaded)
    .map((d) => ({ id: d.id, titel: d.title ?? null, speelt: !!d.playing,
                   bpm: Number.isFinite(d.bpm) ? Math.round(d.bpm * 10) / 10 : null, toon: toonTekst(d.toon) }));
  return {
    t: nu, audio,
    midi: midi ? {
      aan: !!midi.enabled, ondersteund: midi.supported !== false, fout: midi.error ? String(midi.error) : null,
      invoer: midi.input?.name ?? null, uitvoer: midi.output?.name ?? null,
      rx: midi.rx ?? 0, echoes: midi.echoes ?? 0, verkeerdePoort: !!midi.verkeerdePoort,
    } : null,
    tracks, focus: snap?.focus ?? null, maat: snap?.maat ?? null, auto: !!auto, opname: !!opname,
  };
}

/**
 * @param {object} o
 * @param {() => object} o.lees     geeft { snap, midi, audio, auto, opname }
 * @param {() => boolean} o.isEerste  heeft dit tabblad de Web Lock?
 */
export function startStatusZender({ lees, isEerste = () => true, interval = 1000 }) {
  if (typeof BroadcastChannel === 'undefined') return null;
  const kanaal = new BroadcastChannel(KANAAL);
  const stuur = () => {
    if (!isEerste()) return;
    try { kanaal.postMessage(maakStatus(lees())); } catch (_) { /* een melding mag de mixer nooit storen */ }
  };
  kanaal.onmessage = (e) => { if (e.data?.vraag === 'status') stuur(); };
  const id = setInterval(stuur, interval);
  stuur();
  return { stuur, stop() { clearInterval(id); kanaal.close(); } };
}
