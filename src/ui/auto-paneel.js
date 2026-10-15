/*
 * De AUTO-rij: wat de auto-DJ nu doet en wat hij van plan is, met ok /
 * overslaan / langer / nu. Openen met de knop "auto" in de balk (onthouden).
 * De knoppen gaan over de bus (data-action), de tekst leest automaat.stand().
 */
import { zetTekst } from './dom.js';
import { registreerRij } from './rijen.js';
import { bindButtons } from './controls.js';
import { maakLiveLezer } from '../plan/live.js';
import { voorspel } from '../plan/tijdlijn.js';
import { read, has } from '../control/actions.js';
const OPEN = 'varve.auto.open';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const FASE = { uit: 'uit', wacht: 'kiest…', laden: 'laadt…', klaar: 'klaar', bezig: 'mixt', overgenomen: 'jij mixt' };

export function opzetAuto({ auto }) {
  const rij = document.getElementById('auto');
  const knop = document.getElementById('auto-btn');
  const aanKnop = rij.querySelector('.au-aan');
  const nuEl = rij.querySelector('.au-nu');
  const volgEl = rij.querySelector('.au-volgende');
  const volgTitel = volgEl.querySelector('b'), volgOnder = volgEl.querySelector('small');
  const balk = rij.querySelector('.au-balk i');
  const okKnop = rij.querySelector('[data-action="auto.ok"]');
  const planEl = rij.querySelector('.au-plan');
  // Spoor S9 (docs/PLAN-SET.md §4): GO, en wat er daarna komt met de verwachte eindtijd. Na het
  // opstarten gemaakt (opzetVensters bond de knoppen van index.html al), dus hier zelf binden.
  const goKnop = document.createElement('button');
  goKnop.className = 'btn sm au-go';
  goKnop.dataset.kind = 'button';
  goKnop.dataset.action = 'plan.go';
  goKnop.title = 'GO: de klaarstaande overgang nu. Een stap die op GO wacht begint alleen zo (of op het laatste moment: nooit stilte)';
  goKnop.textContent = 'GO';
  rij.querySelector('[data-action="auto.nu"]')?.after(goKnop);
  const setEl = document.createElement('span');
  setEl.className = 'au-plan au-set';
  planEl.before(setEl);
  bindButtons(rij);
  const live = maakLiveLezer(auto, { voorspel });
  let liveTekst = { daarna: '', eind: '', laag: '' }, liveT = 0, liveBezig = false;

  const zet = (open) => {
    rij.classList.toggle('hidden', !open);
    knop.style.color = open ? 'var(--text)' : '';
    schrijf(OPEN, open ? '1' : '0');
  };
  knop.addEventListener('click', () => zet(rij.classList.contains('hidden')));
  registreerRij('auto', { zet, isOpen: () => !rij.classList.contains('hidden') });   // rijen.js: een deel zet hem open
  if (lees(OPEN) === '1') zet(true);

  const tekst = zetTekst;   // de bestaande tekstknoop, geen nieuwe (dom.js)
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };

  function teken() {
    // Ook met de rij dicht: de knop in de balk laat zien dat hij aan staat.
    klasse(knop, 'au-actief', auto.aan);
    if (rij.classList.contains('hidden')) return;
    const s = auto.stand();
    tekst(aanKnop, s.aan ? `aan · ${FASE[s.fase] ?? s.fase}` : 'uit');
    klasse(aanKnop, 'on', s.aan);
    tekst(nuEl, s.nu ? `▶ ${s.nu.nr} · ${s.nu.titel}${s.nu.rest !== null && s.aan ? ` · nog ${mmss(s.nu.rest)}` : ''}` : s.aan ? '—' : 'zet aan: ik kies, mix en leg uit');
    titel(nuEl, s.nu?.titel ?? '');
    const v = s.volgende;
    if (v) {
      const wanneer = v.voortgang !== null ? `bezig ${Math.round(v.voortgang * 100)}%`
        : v.maten !== null ? `over ${v.maten} maten` : v.over !== null ? `over ${mmss(v.over)}` : '';
      tekst(volgTitel, `→ ${v.nr} · ${v.titel}${v.toon ? ` (${v.toon})` : ''}`);
      tekst(volgOnder, [v.soort, wanneer, v.bron === 'plan' ? 'plan' : null].filter(Boolean).join(' · '));
      titel(volgEl, [v.waarom, ...(v.redenen || [])].filter(Boolean).join('\n'));
      stijl(balk, v.voortgang ?? 0);
    } else {
      tekst(volgTitel, s.aan ? (s.fase === 'overgenomen' ? 'jij hebt de overgang' : 'kiest de volgende…') : '');
      tekst(volgOnder, s.aan && s.melding ? s.melding.tekst : '');
      titel(volgEl, '');
      stijl(balk, 0);
    }
    klasse(okKnop, 'on', !!v?.bevestigd);
    // GO brandt als een stap erop wacht; de rest van de set: hooguit 2× per seconde gerekend.
    klasse(goKnop, 'on', has('plan.go') && read('plan.go') === 1);
    if (v?.go?.wacht) tekst(volgOnder, ['wacht op GO', v.go.uiterlijk != null ? `uiterlijk over ${mmss(v.go.uiterlijk)}` : null, v.soort].filter(Boolean).join(' · '));
    const nuMs = Date.now();
    if (!liveBezig && nuMs - liveT > 500) {
      liveBezig = true;
      liveT = nuMs;
      live(nuMs).then((l) => { liveTekst = s.aan ? { daarna: l.daarna ? l.tekst.daarna : '', eind: l.tekst.eind, laag: l.tekst.laag } : { daarna: '', eind: '', laag: '' }; })
        .catch(() => {}).finally(() => { liveBezig = false; });
    }
    tekst(setEl, [s.buiten ? 'BUITEN PLAN' : null, liveTekst.laag || null, liveTekst.daarna || null, liveTekst.eind || null].filter(Boolean).join(' · '));
    tekst(planEl, s.plan ? `${s.plan.naam} · ${s.plan.stap}/${s.plan.totaal}` : 'geen plan: ik kies zelf');
  }
  function stijl(el, p) { const w = `${(p * 100).toFixed(1)}%`; if (el.style.width !== w) el.style.width = w; }

  return { teken };
}
