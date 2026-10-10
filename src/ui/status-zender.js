/**
 * De mixer meldt zijn stand aan de Controlekamer (controle.html) over een
 * BroadcastChannel: APC, audio, wat er speelt, en of de Stroommachine (beeld)
 * meekijkt. Alleen lezen, en in één richting: de Controlekamer opent zelf
 * nooit MIDI, dus er komt nooit een tweede client op de APC.
 *
 * Alleen het tabblad met de Web Lock (tabblad.js) meldt; een tweede
 * mixer-tabblad zwijgt. Elke seconde, en meteen als de Controlekamer erom
 * vraagt ({ vraag: 'status' }): een tabblad op de achtergrond knijpt zijn
 * timers (na 5 min tot één keer per minuut als er niets klinkt), een bericht
 * komt wel meteen binnen.
 *
 * Met `naarServer` (docs/COMPANION.md stap 2) gaat hetzelfde bericht ook naar
 * `POST /api/mixer`, voor iPad en iPhone: hooguit één per SERVER_MS, nooit een
 * tweede zolang de eerste onderweg is, na een 404 of een weigering een minuut
 * rust, na een netwerkfout 10 s. Nooit wachten in de interval: de POST loopt
 * los, en wat hij ook doet (gooien, afwijzen, hangen) komt niet in de mixer.
 */
import { beeldBericht } from './beeld-weergave.js';

export const KANAAL = 'varve-status';

const toonTekst = (t) => (t?.camelot ? `${t.camelot} ${t.kort ?? ''}`.trim() : null);
/** Afgerond op 1/f, of null als het geen eindig getal is. */
const rond = (x, f) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * f) / f : null);

/** De beeld-noodknoppen als { zwart, bevroren, master 0..1 }, of null (alleen app.js vult ze). */
function eindBericht(eind) {
  if (!eind || typeof eind !== 'object') return null;
  const m = rond(eind.master, 1000);
  return { zwart: !!eind.zwart, bevroren: !!eind.bevroren, master: m === null ? 1 : Math.min(1, Math.max(0, m)) };
}

/**
 * Het bericht, uit een engine-snapshot en de MIDI-status. Puur.
 * `beeld` = status() van de BeeldKoppeling (src/koppel/beeld.js), mag
 * ontbreken: dan staat er beeld: null in het bericht (beeld-weergave.js).
 * `eind` (zwart/bevroren/master) en `tab` (een id per laden van de mixerpagina)
 * zijn voor de companion (docs/COMPANION.md stap 2); ontbreken = null.
 */
export function maakStatus({ snap, midi, audio = null, auto = false, opname = false, beeld = null, eind = null, tab = null, nu = Date.now() }) {
  const tracks = Object.values(snap?.decks ?? {})
    .filter((d) => d.loaded)
    .map((d) => ({ id: d.id, titel: d.title ?? null, speelt: !!d.playing,
                   bpm: Number.isFinite(d.bpm) ? Math.round(d.bpm * 10) / 10 : null, toon: toonTekst(d.toon),
                   // voor "nog mm:ss" op de companion: positie en duur op 0,1 s, rate op 0,001
                   positie: rond(d.position, 10), duur: rond(d.duration, 10), rate: rond(d.rate, 1000) }));
  return {
    t: nu, audio,
    midi: midi ? {
      aan: !!midi.enabled, ondersteund: midi.supported !== false, fout: midi.error ? String(midi.error) : null,
      invoer: midi.input?.name ?? null, uitvoer: midi.output?.name ?? null,
      rx: midi.rx ?? 0, echoes: midi.echoes ?? 0, verkeerdePoort: !!midi.verkeerdePoort,
    } : null,
    tracks, focus: snap?.focus ?? null, maat: snap?.maat ?? null, auto: !!auto, opname: !!opname,
    beeld: beeldBericht(beeld),
    eind: eindBericht(eind),
    tab: typeof tab === 'string' ? tab : null,
  };
}

/** Hooguit één POST naar de server per zoveel ms (en ook de time-out van één POST). */
export const SERVER_MS = 900;
/** Rust na een 404 (een oudere server) of een weigering (403, 400, 413). */
export const RUST_WEIGER_MS = 60_000;
/** Rust na een netwerkfout of een 5xx. */
export const RUST_FOUT_MS = 10_000;

/**
 * @param {object} o
 * @param {() => object} o.lees     geeft { snap, midi, audio, auto, opname, beeld?, eind?, tab? }
 * @param {() => boolean} o.isEerste  heeft dit tabblad de Web Lock?
 * @param {boolean} o.naarServer   ook POST /api/mixer (standaard uit; alleen app.js zet hem aan)
 * @param {Function} o.haalFn      fetch (tests: een nagebouwde)
 * @param {() => number} o.klok    ms (tests: een nepklok)
 */
export function startStatusZender({ lees, isEerste = () => true, interval = 1000, naarServer = false,
  haalFn = globalThis.fetch?.bind(globalThis), klok = () => Date.now() }) {
  const heeftKanaal = typeof BroadcastChannel !== 'undefined';
  if (!heeftKanaal && !naarServer) return null;
  const kanaal = heeftKanaal ? new BroadcastChannel(KANAAL) : null;

  let onderweg = false, laatstePost = -Infinity, rustTot = -Infinity;
  const naarDeServer = (bericht) => {
    if (!naarServer || onderweg || typeof haalFn !== 'function') return;
    const nu = klok();
    if (nu - laatstePost < SERVER_MS || nu < rustTot) return;
    laatstePost = nu;
    onderweg = true;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const wekker = setTimeout(() => ac?.abort(), SERVER_MS);
    let p;
    try {
      p = Promise.resolve(haalFn('/api/mixer', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bericht), cache: 'no-store', signal: ac?.signal }));
    } catch (err) { p = Promise.reject(err); }
    p.then((r) => {
      if (r?.ok) return;
      rustTot = klok() + (r?.status >= 400 && r?.status < 500 ? RUST_WEIGER_MS : RUST_FOUT_MS);
    }, (err) => {
      // Te traag (onze eigen time-out): gewoon de volgende keer weer. Weg of kapot: 10 s rust.
      if (err?.name !== 'AbortError') rustTot = klok() + RUST_FOUT_MS;
    }).finally(() => { clearTimeout(wekker); onderweg = false; });
  };

  const stuur = () => {
    if (!isEerste()) return;
    let bericht;
    try { bericht = maakStatus(lees()); } catch (_) { return; }   // een melding mag de mixer nooit storen
    try { kanaal?.postMessage(bericht); } catch (_) { /* idem */ }
    try { naarDeServer(bericht); } catch (_) { /* idem */ }
  };
  if (kanaal) kanaal.onmessage = (e) => { if (e.data?.vraag === 'status') stuur(); };
  const id = setInterval(stuur, interval);
  stuur();
  return { stuur, stop() { clearInterval(id); kanaal?.close(); } };
}
