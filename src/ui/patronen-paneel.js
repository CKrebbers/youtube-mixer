import { read as readAction, invoke, trackVanDeck } from '../control/actions.js';
import { knobVan } from './controls.js';
import { meld } from './meldingen.js';
import { opzetPatronenOpslag } from './patronen-opslag.js';
import { STANDAARD_LENGTE, MAX_LENGTE } from '../engine/patronen/model.js';
import { instrumentDef } from '../engine/instrumenten/index.js';
import { zetTekst } from './dom.js';

/*
 * De PATROON-rij (docs/PATRONEN.md §5): voor de track met focus de vijf
 * plekken (starten en stoppen op de maat, zoals de pads in de modus patronen
 * op de APC), de stappen van de gekozen plek (klik = de laatst gespeelde noot
 * erop of eraf), lengte, swing, opnemen, stoppen, wissen, en het eigen tempo
 * als er geen maatgever is. Openen en sluiten met de knop in de balk
 * (onthouden, standaard dicht), zoals INSTRUMENT.
 *
 * Alles gaat over de bus (`track.N.pattern.*`, `patterns.*`): de knoppen staan
 * vast in index.html en vensters.js bindt ze; de stappen tekent deze module en
 * die roepen hun action zelf aan (`track.N.pattern.step.S`). Zoals de
 * INSTRUMENT-rij schrijft hij de track in de data-action om als de focus wisselt.
 *
 * Noten gaan niet over de bus: wat je speelt (MIDI-keyboard, het
 * schermtoetsenbord, straks de Maschine via de hub) komt via noten.js binnen;
 * deze module geeft het door aan de speler (de laatste noot voor stap voor
 * stap, en live opnemen). Bewaren op de server: patronen-opslag.js.
 */
const OPEN = 'varve.patronen.open';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

const NAMEN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const nootNaam = (n) => `${NAMEN[n % 12]}${Math.floor(n / 12) - 1}`;

export function opzetPatronen({ engine, noten }) {
  const pt = engine.patronen;
  const rij = document.getElementById('patronen');
  const knop = document.getElementById('patronen-btn');
  const trackEl = rij.querySelector('.pt-track');
  const plekEls = [...rij.querySelectorAll('.pt-plek')];
  const stappenEl = rij.querySelector('.pt-stappen');
  const lengteEl = rij.querySelector('.pt-lengte-tekst');
  const recEl = rij.querySelector('.pt-rec');
  const wisEl = rij.querySelector('.pt-wis');
  const klokEl = rij.querySelector('.pt-klok');
  const tempoEl = rij.querySelector('.pt-tempo');
  const nootEl = rij.querySelector('.pt-noot');
  const opslagEl = rij.querySelector('.pt-opslag');
  const hunEl = rij.querySelector('.pt-hun');
  const mijnEl = rij.querySelector('.pt-mijn');

  const tekst = zetTekst;   // de bestaande tekstknoop, geen nieuwe (dom.js)
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };
  const isDicht = () => rij.classList.contains('hidden');

  // ---- noten van keyboards en het scherm naar de speler ------------------------------
  noten?.on('noot', ({ id, noot, aan, snelheid }) => pt.noot(id, noot, aan ? (snelheid ?? 0.8) : 0));

  // ---- opslag op de server ---------------------------------------------------------------
  const opslag = opzetPatronenOpslag({ engine, melding: meld });
  opslag.laad();
  hunEl.addEventListener('click', () => opslag.hunVersie());
  mijnEl.addEventListener('click', () => opslag.mijnVersie());

  // ---- open / dicht -----------------------------------------------------------------------
  const zet = (open) => {
    rij.classList.toggle('hidden', !open);
    knop.style.color = open ? 'var(--text)' : '';
    schrijf(OPEN, open ? '1' : '0');
  };
  knop.addEventListener('click', () => zet(isDicht()));
  if (lees(OPEN) === '1') zet(true);

  // ---- de track met focus -----------------------------------------------------------------
  let nr = null;
  function herschrijf(n) {
    nr = n;
    const naarTrack = (a) => a.replace(/^track\.\d+\./, `track.${n}.`);
    for (const el of rij.querySelectorAll('[data-action]')) {
      el.dataset.action = naarTrack(el.dataset.action);
      if (el.dataset.actionShift) el.dataset.actionShift = naarTrack(el.dataset.actionShift);
      const k = knobVan.get(el);
      if (k) k.action = el.dataset.action;
    }
    tekst(trackEl, `track ${n}`);
  }
  herschrijf(trackVanDeck(engine.focus));

  // ---- de stappen: 64 hokjes, zichtbaar tot de lengte, vier per tel --------------------------
  const stapEls = [];
  for (let s = 1; s <= MAX_LENGTE; s++) {
    const el = document.createElement('i');
    el.className = 'pt-stap';
    el.dataset.stap = String(s);
    if ((s - 1) % 4 === 0) el.classList.add('tel');
    stappenEl.appendChild(el);
    stapEls.push(el);
  }
  // Indrukken en loslaten naar dezelfde action, ook als de focus intussen wisselde.
  stappenEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pt-stap');
    if (!el || el.classList.contains('weg')) return;
    e.preventDefault();
    const a = `track.${nr}.pattern.step.${el.dataset.stap}`;
    invoke(a, true);
    invoke(a, false);
  });

  // ---- elk frame ---------------------------------------------------------------------------
  function teken() {
    const n = trackVanDeck(engine.focus);
    if (n !== nr) herschrijf(n);
    if (isDicht()) return;
    const id = engine.focus;
    const inst = engine.instrumentOp(id);
    const st = pt.stand(id);
    const p = pt.patroon(id, st.gekozen);

    // Plekken: het lampje zoals op de APC, en welke er bewerkt wordt.
    // (de read knippert zelf als hij op de maat wacht: 1 en 0,5 op de tel)
    plekEls.forEach((el, i) => {
      const v = readAction(el.dataset.action);
      const licht = v === null ? 'dood' : v >= 0.99 ? 'aan' : v > 0.01 ? 'half' : 'uit';
      if (el.dataset.licht !== licht) el.dataset.licht = licht;
      klasse(el, 'gekozen', st.gekozen === i + 1);
    });

    // De stappen van de gekozen plek; de afspeelkop als die plek speelt.
    const lengte = p?.lengte ?? STANDAARD_LENGTE;
    const kop = st.speelt === st.gekozen ? st.stap : null;
    for (let i = 0; i < MAX_LENGTE; i++) {
      const el = stapEls[i];
      const v = inst ? readAction(`track.${nr}.pattern.step.${i + 1}`) : null;
      klasse(el, 'weg', i >= lengte);
      klasse(el, 'dood', !inst);
      klasse(el, 'aan', v !== null && v > 0.99);
      klasse(el, 'half', v !== null && v > 0.01 && v < 0.99);
      klasse(el, 'kop', kop === i);
    }
    tekst(lengteEl, String(lengte));

    // Opnemen, wissen.
    klasse(recEl, 'on', pt.opnemen);
    klasse(wisEl, 'dood', !p?.noten.length);

    // De klok: op de maatgever, of het eigen tempo (dan de knop).
    const k = pt.klokStand();
    const m = engine.syncMaster?.();
    const metMaat = !!m?.fxKlok?.();
    klasse(tempoEl, 'hidden', metMaat);
    tekst(klokEl, k.bron === 'maat' ? `op track ${trackVanDeck(k.maatgever)} · ${(k.bpm ?? 0).toFixed(1).replace('.', ',')} bpm`
      : k.bron === 'eigen' ? `eigen tempo · ${(k.bpm ?? k.tempo).toFixed(1).replace('.', ',')} bpm`
      : metMaat ? `op de maat van track ${trackVanDeck(m.id)}` : `eigen tempo · ${k.tempo.toFixed(0)} bpm`);

    // De noot die een klik op een stap zet; bij drums de naam van de pad.
    if (!inst) {
      const voor = pt.set.instrumenten?.[String(nr)];
      const naam = voor && (instrumentDef(voor.soort)?.naam ?? voor.soort);
      tekst(nootEl, naam ? `geen instrument (de patronen hier zijn voor ${naam})` : 'geen instrument — kies er een in de INSTRUMENT-rij');
      klasse(nootEl, 'leeg', true);
    } else {
      const noot = st.laatsteNoot;
      const pad = inst.stand?.().pads?.find((x) => x.noot === 36 + (((noot - 36) % 16) + 16) % 16);
      tekst(nootEl, `noot ${nootNaam(noot)}${pad?.naam ? ` · ${pad.naam}` : ''}`);
      klasse(nootEl, 'leeg', false);
    }

    // Bewaren.
    const o = opslag.stand();
    tekst(opslagEl, o.botsing ? 'botsing' : o.fout ? 'niet bewaard' : o.vuil ? 'bewaren…' : o.versie ? 'bewaard' : '—');
    klasse(opslagEl, 'fout', o.botsing || !!o.fout);
    titel(opslagEl, o.botsing ? 'iemand anders bewaarde de patronen intussen: kies hun versie of de jouwe'
      : o.fout || `bewaard op de server (patronen/${o.naam}.json), met versie`);
    klasse(hunEl, 'hidden', !o.botsing);
    klasse(mijnEl, 'hidden', !o.botsing);
  }

  return { teken, opslag };
}
