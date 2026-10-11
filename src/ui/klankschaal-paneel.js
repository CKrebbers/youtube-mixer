import { meld } from './meldingen.js';
import { schrijfInstelling } from './instellingen-opslag.js';

/*
 * De KLANKSCHAAL-rij onder de sampler: openen en sluiten (knop in de balk),
 * de instellingen bewaren tussen sessies, en per frame laten zien waar de
 * schaal op staat. Spelen gaat, zoals alles, over de bus (data-action):
 * vensters.js bindt de knoppen en draaiknoppen, de renderloop volgt de knoppen.
 *
 * De rij is standaard dicht: dan kost hij niets (de worklet laadt pas bij de
 * eerste aanslag, of bij het openen van de rij).
 */
const OPEN = 'varve.klankschaal.open';
const INSTELLINGEN = 'varve.klankschaal';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
// De instrument-sleutels gaan ook naar de server (instellingen-opslag.js); de rest alleen localStorage.
const schrijf = schrijfInstelling;

/** "Bb3" → "B♭3", "F#4" → "F♯4": zoals de toonsoort elders op het scherm. */
const mooi = (n) => (n || '').replace(/^([A-G])b/, '$1♭').replace('#', '♯');
const VOLG_TEKST = { maat: 'volgt maat', focus: 'volgt focus', hand: 'met de hand' };

export function opzetKlankschaal({ engine }) {
  const ks = engine.klankschaal;
  const rij = document.getElementById('klankschaal');
  const knop = document.getElementById('klankschaal-btn');
  const volgKnop = rij.querySelector('.ks-volg');
  const toonEl = rij.querySelector('.ks-toon');
  const toonHoofd = toonEl.querySelector('b'), toonOnder = toonEl.querySelector('small');
  const ladderKnop = rij.querySelector('.ks-ladder');
  const klankKnop = rij.querySelector('.ks-klank');
  const nulKnop = rij.querySelector('.ks-nul');
  const wrijfKnop = rij.querySelector('.ks-wrijf');
  const pads = [...rij.querySelectorAll('.ks-pad')];      // kern, veld 1..8

  try { ks.herstel(JSON.parse(lees(INSTELLINGEN) || 'null')); } catch (_) {}
  let bewaard = JSON.stringify(ks.instellingen());
  let laatstBewaard = 0;

  const laad = () => ks.start().catch((err) => meld(`klankschaal: ${err.message}`, 'fout'));
  const zet = (open) => {
    rij.classList.toggle('hidden', !open);
    knop.classList.toggle('on', open);
    knop.style.color = open ? 'var(--text)' : '';
    schrijf(OPEN, open ? '1' : '0');
    if (open) laad();
  };
  knop.addEventListener('click', () => zet(rij.classList.contains('hidden')));
  if (lees(OPEN) === '1') zet(true);

  const tekst = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };

  /** Eén frame (renderloop). Bewaart hooguit elke 2 s, en alleen als er iets veranderde. */
  function teken() {
    const nu = performance.now();
    if (nu - laatstBewaard > 2000) {
      laatstBewaard = nu;
      const s = JSON.stringify(ks.instellingen());
      if (s !== bewaard) { bewaard = s; schrijf(INSTELLINGEN, s); }
    }
    if (rij.classList.contains('hidden')) return;

    const s = ks.stand();
    tekst(volgKnop, VOLG_TEKST[s.volg]);
    const waar = s.volg === 'hand' ? 'vast' : s.nr ? `track ${s.nr}` : 'geen track';
    const tr = s.transpositie ? ` ${s.transpositie > 0 ? '+' : '−'}${Math.abs(s.transpositie)}` : '';
    const ct = Math.round(s.cent);
    tekst(toonHoofd, `${s.toon} ${s.ladderNaam}${tr}`);
    tekst(toonOnder, `${waar}${ct ? ` · ${ct > 0 ? '+' : '−'}${Math.abs(ct)} ct` : ''}`);
    klasse(toonEl, 'geen', s.geen);
    titel(toonEl, s.geen
      ? `${waar} heeft hier geen toonsoort: de schaal blijft op de laatste (${s.bronToon}). Draai TOON of zet volgen op "met de hand".`
      : `volgt ${s.bronToon}${s.volg === 'hand' ? '' : ` (${waar}, zoals je hem hoort)`}${s.relatief ? ` → relatief ${s.toon} voor ${s.ladderNaam}` : ''}${s.onzeker ? ' · toonsoort onzeker' : ''}`);
    tekst(ladderKnop, s.ladder === 'auto' ? `auto: ${s.ladderNaam}` : s.ladderNaam);
    tekst(klankKnop, s.klank);
    klasse(nulKnop, 'on', !!(s.transpositie || s.fijn));
    klasse(wrijfKnop, 'on', s.wrijft);
    tekst(pads[0].lastElementChild, mooi(s.kern));
    for (let i = 0; i < 8; i++) tekst(pads[i + 1].lastElementChild, mooi(s.velden[i]));
    for (let v = 0; v < pads.length; v++) klasse(pads[v], 'raak', s.raak[v]);
  }

  return { teken };
}
