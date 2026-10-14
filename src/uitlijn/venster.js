/**
 * uitlijn.html: de uitlijnweergave als los venster (werkruimte S2,
 * docs/werkruimte/S2.md). Een VENSTER van de mixer, zoals het beamervenster
 * en plan.html: het leest `window.opener.varveUitlijn` (zelfde oorsprong,
 * zelfde thread, geen berichten) en tekent op zijn eigen requestAnimationFrame.
 *
 * GEEN AudioContext, GEEN MIDI, GEEN Web Lock (test/uitlijn.test.mjs volgt de
 * hele importboom): de klok is die van de mixer (de invoer draagt hem), en
 * slepen gaat over de bus van de mixer, zodat het ene tabblad met de APC het
 * ene tabblad blijft. Los geopend (zonder mixer): een melding, verder niets.
 */
import { UitlijnWeergave, VORMEN } from './teken.js';

const VORM = 'varve.uitlijn.vorm', MATEN = 'varve.uitlijn.maten';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const koppeling = () => { try { const o = window.opener; return o && !o.closed ? o.varveUitlijn ?? null : null; } catch (_) { return null; } };

const plek = document.getElementById('ul-plek');
const los = document.getElementById('ul-los');
// ?vorm=vouw&maten=1 (een werkruimte of een bladwijzer) gaat voor wat dit venster onthield.
const vraag = new URLSearchParams(location.search);
let vorm = [vraag.get('vorm'), lees(VORM)].find((v) => VORMEN.includes(v)) ?? 'pagina';
let maten = (vraag.get('maten') ?? lees(MATEN)) === '1' ? 1 : 2;

const weergave = new UitlijnWeergave(plek, {
  vorm, maten,
  invoer: () => koppeling()?.invoer() ?? null,
  invoke: (id, v) => koppeling()?.invoke(id, v),
  metaOf: (id) => koppeling()?.metaOf(id),
  read: (id) => koppeling()?.read(id),
});

function knoppen() {
  for (const b of document.querySelectorAll('[data-vorm]')) b.classList.toggle('aan', b.dataset.vorm === vorm);
  for (const b of document.querySelectorAll('[data-maten]')) { b.classList.toggle('aan', Number(b.dataset.maten) === maten); b.disabled = vorm === 'strook'; }
}
document.querySelector('.ul-knoppen').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.vorm) { vorm = b.dataset.vorm; schrijf(VORM, vorm); weergave.zetVorm(vorm); }
  if (b.dataset.maten) { maten = Number(b.dataset.maten); schrijf(MATEN, String(maten)); weergave.zetMaten(maten); }
  knoppen();
});
knoppen();

// Voor de headless proef (tools/headless/uitlijn.mjs) en de console. `pauze`: niet rekenen en
// niet tekenen (de proef vergelijkt zo hetzelfde venster stil en lopend).
window.uitlijn = { weergave, pauze: false, get stats() { return weergave.stats; } };

let wasLos = null;
function beeld() {
  const k = koppeling();
  if (!k !== wasLos) { los.hidden = !!k; plek.hidden = !k; wasLos = !k; }
  if (k && !window.uitlijn.pauze) weergave.stap();
  requestAnimationFrame(beeld);
}
requestAnimationFrame(beeld);
