import { read as readAction, invoke, trackVanDeck } from '../control/actions.js';
import { Noten } from '../control/noten.js';
import { knobVan } from './controls.js';
import { meld } from './meldingen.js';
import { zetTekst } from './dom.js';

/*
 * De INSTRUMENT-rij (docs/INSTRUMENTEN.md §6): voor de track met focus het
 * instrument kiezen, zijn acht knoppen, paniek, een toetsenbord van twee
 * octaven om met de muis te proberen, en welk MIDI-keyboard er binnenkomt.
 * Openen en sluiten met de knop in de balk (onthouden, standaard dicht), zoals
 * STEMS en KOPTELEFOON.
 *
 * Kiezen, knoppen en stil gaan over de bus (`track.N.inst`, `.inst.knob.K`,
 * `.inst.stil`): vensters.js bindt ze bij het opstarten (ze staan vast in
 * index.html), de renderloop zet de draaiknoppen elke frame op hun read().
 * Deze module schrijft de track in hun data-action om als de focus wisselt
 * (zoals stems-paneel.js), en zet de namen van de plekken eronder.
 *
 * Noten gaan NIET over de bus: het toetsenbord op het scherm en elk
 * MIDI-keyboard spelen via noten.js op de SPEELTRACK (de focus-track als die
 * een instrument heeft, anders de laatste focus-track met een instrument).
 * noten.js luistert mee op de MidiHub die midi-opzet.js al heeft (geen eigen
 * requestMIDIAccess, en dus alleen in het eerste VARVE-tabblad).
 *
 * Ook hier: het mapje inst op de APC (Clip/Device View) doet alleen mee als de
 * focus-track een instrument heeft; gaat het instrument weg terwijl het mapje
 * open staat, dan terug naar de strip.
 */
const OPEN = 'varve.instrument.open';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

const NAMEN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const ZWART = new Set([1, 3, 6, 8, 10]);
const nootNaam = (n) => `${NAMEN[n % 12]}${Math.floor(n / 12) - 1}`;
/** Twee octaven en de C erboven. Begint op C3 (48). */
const TOETSEN = 25;
const LAAGSTE = 24, HOOGSTE = 96;

export function opzetInstrument({ engine, midi, lagen }) {
  const rij = document.getElementById('instrument');
  const knop = document.getElementById('instrument-btn');
  const trackEl = rij.querySelector('.in-track');
  const kiesEl = rij.querySelector('.in-kies');
  const stilEl = rij.querySelector('.in-stil');
  const knoppen = [...rij.querySelectorAll('.in-knop')];
  const klavier = rij.querySelector('.in-klavier');
  const keyboardEl = rij.querySelector('.in-keyboard');

  const tekst = zetTekst;   // de bestaande tekstknoop, geen nieuwe (dom.js)
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };
  const isDicht = () => rij.classList.contains('hidden');

  // ---- noten: MIDI-keyboards en het schermtoetsenbord ------------------------
  const noten = new Noten({ engine, read: readAction, invoke });
  fetch('mappings/xboard49.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((doc) => noten.laadMapping(doc))
    .catch((err) => meld(`instrument: de knoppen van het keyboard (mappings/xboard49.json) niet geladen (${err.message})`, 'fout'));
  if (midi) noten.hoorHub(midi);
  let laatsteGeen = 0;
  noten.on('geen', () => {
    const nu = performance.now();
    if (nu - laatsteGeen < 5000) return;
    laatsteGeen = nu;
    meld('het MIDI-keyboard speelt, maar er staat nergens een instrument — kies er een in de INSTRUMENT-rij (knop "instrument" in de balk)');
  });

  // ---- open / dicht -----------------------------------------------------------
  const zet = (open) => {
    rij.classList.toggle('hidden', !open);
    knop.style.color = open ? 'var(--text)' : '';
    schrijf(OPEN, open ? '1' : '0');
  };
  knop.addEventListener('click', () => zet(isDicht()));
  if (lees(OPEN) === '1') zet(true);

  // ---- de track met focus ----------------------------------------------------
  let nr = null;
  function herschrijf(n) {
    nr = n;
    for (const el of rij.querySelectorAll('[data-action]')) {
      el.dataset.action = el.dataset.action.replace(/^track\.\d+\./, `track.${n}.`);
      const k = knobVan.get(el);
      if (k) k.action = el.dataset.action;
    }
    tekst(trackEl, `track ${n}`);
  }
  herschrijf(trackVanDeck(engine.focus));

  // Het mapje inst (APC) zonder instrument op de focus-track: terug naar de strip.
  engine.on('change', () => {
    if (lagen?.stand.device === 'inst' && !engine.instrumentOp(engine.focus)) lagen.zet('device', 'strip');
  });

  // ---- het toetsenbord op het scherm ---------------------------------------------
  let basis = 48;
  const ingedrukt = new Map();          // pointerId -> noot
  let toetsEls = [];
  function bouwKlavier() {
    for (const n of ingedrukt.values()) noten.laat(n);
    ingedrukt.clear();
    const witten = [];
    for (let i = 0; i < TOETSEN; i++) if (!ZWART.has((basis + i) % 12)) witten.push(basis + i);
    const breed = 100 / witten.length;
    let html = '';
    for (let i = 0; i < TOETSEN; i++) {
      const n = basis + i;
      if (ZWART.has(n % 12)) {
        const links = (witten.indexOf(n - 1) + 1) * breed;
        html += `<i class="in-toets zwart" data-noot="${n}" style="left:calc(${links.toFixed(3)}% - ${(breed * 0.3).toFixed(3)}%);width:${(breed * 0.6).toFixed(3)}%" title="${nootNaam(n)}"></i>`;
      } else {
        html += `<i class="in-toets wit" data-noot="${n}" style="left:${(witten.indexOf(n) * breed).toFixed(3)}%;width:${breed.toFixed(3)}%" title="${nootNaam(n)}">${n % 12 === 0 ? `<b>${nootNaam(n)}</b>` : ''}</i>`;
      }
    }
    klavier.innerHTML = html;
    toetsEls = [...klavier.querySelectorAll('.in-toets')];
  }
  bouwKlavier();
  const snelheidVan = (el, e) => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0.15, 0.25 + 0.75 * ((e.clientY - r.top) / (r.height || 1))));
  };
  klavier.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.in-toets');
    if (!el) return;
    e.preventDefault();
    engine.resume().catch(() => {});
    const n = Number(el.dataset.noot);
    if (ingedrukt.has(e.pointerId)) noten.laat(ingedrukt.get(e.pointerId));
    ingedrukt.set(e.pointerId, n);
    noten.speel(n, snelheidVan(el, e));
    try { klavier.setPointerCapture(e.pointerId); } catch (_) {}
  });
  // Glijden over de toetsen (met de knop ingedrukt) speelt de volgende.
  klavier.addEventListener('pointermove', (e) => {
    if (!ingedrukt.has(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.in-toets');
    const n = el ? Number(el.dataset.noot) : null;
    if (n === null || n === ingedrukt.get(e.pointerId)) return;
    noten.laat(ingedrukt.get(e.pointerId));
    ingedrukt.set(e.pointerId, n);
    noten.speel(n, snelheidVan(el, e));
  });
  const los = (e) => {
    if (!ingedrukt.has(e.pointerId)) return;
    noten.laat(ingedrukt.get(e.pointerId));
    ingedrukt.delete(e.pointerId);
  };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) klavier.addEventListener(t, los);
  for (const b of rij.querySelectorAll('.in-oct')) {
    b.addEventListener('click', () => {
      basis = Math.min(HOOGSTE - TOETSEN + 1, Math.max(LAAGSTE, basis + Number(b.dataset.stap)));
      bouwKlavier();
    });
  }
  // Het venster verliest de focus: wat de MUIS vasthoudt los (een MIDI-keyboard speelt door).
  window.addEventListener('blur', () => { for (const n of ingedrukt.values()) noten.laat(n); ingedrukt.clear(); });

  // ---- welk keyboard er binnenkomt (twee keer per seconde bijgewerkt) -------------
  let keyboardTekst = '', keyboardTijd = 0;
  function keyboards() {
    const nu = performance.now();
    if (nu - keyboardTijd < 500) return keyboardTekst;
    keyboardTijd = nu;
    if (!midi?.enabled) {
      keyboardTekst = midi?.error ? `MIDI: ${midi.error}` : 'MIDI staat uit (alleen het eerste VARVE-tabblad, of nog geen toestemming)';
      return keyboardTekst;
    }
    const namen = midi.ports().inputs.filter((p) => p.state === 'connected' && !noten.isApc(p.name)).map((p) => p.name);
    // Met ?hub=: de speelapparaten van de hub (eigen nep-poorten, niet in de lijst van de MidiHub).
    for (const s of Object.values(midi.status?.().hub?.speelt ?? {})) if (s.verbonden) namen.push(s.naam);
    keyboardTekst = namen.length ? `keyboard: ${namen.join(', ')}` : 'geen MIDI-keyboard aangesloten';
    return keyboardTekst;
  }

  // ---- elk frame ---------------------------------------------------------------------
  let vorigInst;
  function teken() {
    const n = trackVanDeck(engine.focus);
    if (n !== nr) herschrijf(n);
    if (isDicht()) return;
    const inst = engine.instrumentOp(engine.focus);
    const speel = engine.speeltrack();
    // Kiezen: de naam, of uitnodigen.
    tekst(kiesEl, inst ? inst.naam : '+ instrument');
    klasse(kiesEl, 'gekozen', !!inst);
    // De acht plekken: de namen (en wat ze nu doen) van dit instrument.
    if (inst !== vorigInst) {
      vorigInst = inst;
      knoppen.forEach((el, i) => {
        const p = inst?.params?.[i];
        const lab = el.querySelector('.knob-label');
        if (lab) lab.textContent = p ? p.label : String(i + 1);
        el.dataset.default = String(p?.standaard ?? 0);
        klasse(el, 'dood', !p);
      });
    }
    if (inst) {
      knoppen.forEach((el, i) => {
        const p = inst.params[i];
        if (!p) return;
        const v = inst.leesParam(i + 1);
        titel(el, `${p.label}: ${p.eenheid ? p.eenheid(v) : v.toFixed(2)} (dubbelklik: standaard)`);
      });
    }
    const st = readAction(stilEl.dataset.action);
    klasse(stilEl, 'dood', st === null);
    klasse(stilEl, 'klinkt', st !== null && st > 0.01);
    // Waar het toetsenbord heen speelt.
    const doel = speel && speel !== engine.focus ? `speelt op track ${trackVanDeck(speel)}` : '';
    titel(klavier, speel ? `speelt op track ${trackVanDeck(speel)} (${engine.instrumentOp(speel)?.naam ?? ''})`
      : 'er staat nergens een instrument: kies er eerst een');
    klasse(klavier, 'dood', !speel);
    const aan = speel ? noten.ingedrukt(speel) : new Set();
    for (const el of toetsEls) klasse(el, 'aan', aan.has(Number(el.dataset.noot)));
    // Het keyboard: welke er zijn, en oplichten als er net iets binnenkwam.
    const actief = noten.actief(300);
    tekst(keyboardEl, `${keyboards()}${doel ? ` · ${doel}` : ''}`);
    klasse(keyboardEl, 'actief', !!actief);
    titel(keyboardEl, actief ? `${actief.naam}${actief.laatsteNoot != null ? ` · laatste noot ${nootNaam(actief.laatsteNoot)}` : ''}`
      : 'welk MIDI-keyboard er binnenkomt (elke ingang behalve de APC); de knoppen 1–8 van een Xboard49 sturen de acht plekken, 9–16 de FX-knoppen en de schuif het volume van de speeltrack (te controleren met een proef)');
  }

  return { teken, noten };
}
