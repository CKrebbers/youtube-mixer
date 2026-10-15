import { EFFECTEN, effectVan } from '../engine/fx.js';
import { rackVanEffect } from '../engine/rack.js';
import { read as readAction } from '../control/actions.js';
import { esc, zetTekst } from './dom.js';
import { meld } from './meldingen.js';
import { grTekst, grHoogte, houdGr, kiesWaarde, bewaarVorm, leesBewaard, sjabloonHerkomst, OPSLAG } from './master-weergave.js';
import { registreerRij } from './rijen.js';

/*
 * De MASTER-rij (docs/MASTER.md): effecten op het geheel en de limiter.
 * Een rack kiezen (de kant-en-klare uit racks/sjablonen.json, of een los
 * effect), aan/uit, MIX en de acht knoppen, en hoeveel de limiter afneemt
 * (gain reduction). Spelen gaat over de bus (data-action): vensters.js bindt
 * de knoppen, de renderloop volgt de draaiknoppen; deze module tekent de
 * namen, de stand en de gain reduction. Openen en sluiten met de knop in de
 * balk (onthouden, standaard dicht), zoals KLANKSCHAAL, STEMS en KOPTELEFOON.
 *
 * De gain reduction staat ook altijd naast de mastermeter in het focusdeel
 * (een dunne rode balk die van boven naar beneden groeit), ook als de rij dicht is.
 *
 * Het master-rack hangt aan geen nummer: welk rack er in zit staat in
 * localStorage (`varve.master.rack`: de inhoud, en van welk sjabloon hij
 * kwam, op naam). Na herladen klinkt hetzelfde rack, met MIX op 0 en de
 * knoppen op hun standaard: de live stand is sessietoestand, net als bij een
 * track, en een master die nat opstart wil je nooit.
 */
const OPEN = 'varve.master.open';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const ms = (s) => `${(s * 1000).toFixed(1).replace('.', ',')} ms`;

export function opzetMaster({ engine }) {
  const m = engine.master;
  const fx = m.fx;
  const rij = document.getElementById('master');
  const knop = document.getElementById('master-btn');
  const kiezer = rij.querySelector('.ms-rack');
  const aanKnop = rij.querySelector('.ms-aan');
  const plekken = [...rij.querySelectorAll('.ms-plek')];
  const grEl = rij.querySelector('.ms-gr');
  const grBalk = grEl.querySelector('i');
  const grTekstEl = rij.querySelector('.ms-gr-tekst');
  const soortEl = rij.querySelector('.ms-soort');
  // Naast de mastermeter van het focusdeel (spiegel.js zette die neer).
  document.querySelector('.master-meter')?.insertAdjacentHTML('afterend',
    '<div class="meter vmeter gr-meter" title="gain reduction van de master-limiter (hoeveel hij afneemt)"><i></i></div>');
  const grMeter = document.querySelector('.gr-meter i');

  const tekst = zetTekst;   // de bestaande tekstknoop, geen nieuwe (dom.js)
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };
  const isDicht = () => rij.classList.contains('hidden');
  const zet = (open) => {
    rij.classList.toggle('hidden', !open);
    knop.style.color = open ? 'var(--text)' : '';
    schrijf(OPEN, open ? '1' : '0');
  };
  knop.addEventListener('click', () => zet(isDicht()));
  registreerRij('master', { zet, isOpen: () => !rij.classList.contains('hidden') });   // rijen.js: een deel zet hem open
  if (lees(OPEN) === '1') zet(true);

  const meldFouten = (r) => r?.fouten?.forEach((f) => console.warn('[master-rack]', f));

  // Het bewaarde rack meteen terug (dat klinkt dan), de herkomst zodra de
  // sjablonen er zijn. Pas daarna bewaren, anders verdween de naam van het sjabloon.
  const bewaard = leesBewaard(lees(OPSLAG));
  if (bewaard) meldFouten(fx.zetRack(bewaard.rack, { herkomst: null }));
  const hersteld = fx.rack;
  let sjablonen = [];
  let magBewaren = false;
  fetch('racks/sjablonen.json')
    .then((r) => (r.ok ? r.json() : { racks: [] }))
    .then((d) => {
      sjablonen = d.racks || [];
      if (bewaard?.naam && fx.rack === hersteld) fx.herkomst = sjabloonHerkomst(bewaard.naam, sjablonen);
    })
    .catch((err) => console.warn('[master-rack] sjablonen niet geladen:', err.message))
    .finally(() => { magBewaren = true; vulKiezer(); });

  function vulKiezer() {
    kiezer.innerHTML = '<option value="" disabled>— niet bewaard —</option>'
      + (sjablonen.length ? `<optgroup label="kant-en-klaar">${sjablonen.map((r, i) => `<option value="s:${i}">${esc(r.name)}</option>`).join('')}</optgroup>` : '')
      + `<optgroup label="los effect">${EFFECTEN.map((e) => `<option value="e:${e.id}">${esc(e.naam)}</option>`).join('')}</optgroup>`;
    volgKiezer();
  }
  function volgKiezer() {
    if (document.activeElement === kiezer) return;
    const w = kiesWaarde(fx);
    if (kiezer.value !== w) kiezer.value = w;
  }
  kiezer.addEventListener('change', () => {
    const w = kiezer.value;
    if (w.startsWith('s:')) {
      const s = sjablonen[Number(w.slice(2))];
      if (s) meldFouten(fx.zetRack(s, { herkomst: w }));
    } else if (w.startsWith('e:')) {
      // Altijd opnieuw (niet zetEffect): staat er een sjabloon met hetzelfde
      // eerste effect, dan deed zetEffect niets.
      const e = effectVan(w.slice(2));
      if (e) meldFouten(fx.zetRack(rackVanEffect(e)));
    }
    kiezer.blur();
    engine.emit('change');
  });
  vulKiezer();

  /** Door de kant-en-klare racks bladeren (master.rack.next/prev, de APC). */
  function rackStap(stap) {
    if (!sjablonen.length) { meld('master: de kant-en-klare racks zijn (nog) niet geladen', 'fout'); return; }
    const nu = sjablonen.findIndex((_, i) => fx.herkomst === `s:${i}`);
    const i = nu < 0 ? (stap > 0 ? 0 : sjablonen.length - 1) : (nu + stap + sjablonen.length) % sjablonen.length;
    meldFouten(fx.zetRack(sjablonen[i], { herkomst: `s:${i}` }));
    engine.emit('change');
  }

  let laatsteRack = null, laatsteHerkomst, getoond = 0, vorigeT = performance.now();

  /** Eén frame (renderloop). */
  function teken() {
    // Bewaren als er een ander rack in zit (identiteit: zetRack maakt een nieuw object).
    if (magBewaren && (fx.rack !== laatsteRack || fx.herkomst !== laatsteHerkomst)) {
      laatsteRack = fx.rack;
      laatsteHerkomst = fx.herkomst;
      schrijf(OPSLAG, JSON.stringify(bewaarVorm(fx, sjablonen)));
    }
    // Gain reduction: meteen dieper, langzaam terug (anders flikkert het).
    const nu = performance.now();
    getoond = houdGr(getoond, m.gr(), (nu - vorigeT) / 1000);
    vorigeT = nu;
    const hoogte = `${grHoogte(getoond).toFixed(1)}%`;
    // De staande meter met transform (geen opmaak per beeld, styles.css .meter.vmeter i).
    const schaal = `scaleY(${(grHoogte(getoond) / 100).toFixed(3)})`;
    if (grMeter && grMeter.style.transform !== schaal) grMeter.style.transform = schaal;
    if (isDicht()) return;

    if (grBalk.style.width !== hoogte) grBalk.style.width = hoogte;
    tekst(grTekstEl, grTekst(getoond));
    const wl = m.soort === 'worklet';
    tekst(soortEl, wl ? `limiter ${String(m.opties.plafondDb).replace('-', '−')} dBTP · ${ms(m.vertraging)}` : `compressor · ${ms(m.vertraging)}`);
    titel(soortEl, wl
      ? `De echte limiter: plafond ${m.opties.plafondDb} dBFS true peak, ${ms(m.vertraging)} vooruitblik (die vertraging telt mee in wat je hoort), release ${m.opties.release * 1000} ms.`
      : `De limiter-worklet is (nog) niet geladen${m.fout ? `: ${m.fout}` : ''}; de oude DynamicsCompressor doet het werk (6 ms, geen true peak).`);
    klasse(soortEl, 'oud', !wl);
    const uit = readAction('master.fx.bypass');
    klasse(aanKnop, 'on', uit === 0);
    tekst(aanKnop, uit === 1 ? 'uit' : 'aan');
    for (const el of plekken) {
      const k = Number(el.dataset.plek);
      const naam = fx.plekNaam(k);
      const lab = el.querySelector('.knob-label');
      if (lab) tekst(lab, naam ?? String(k));
      klasse(el, 'dof', naam === null);
    }
    volgKiezer();
  }

  return { teken, rackStap };
}
