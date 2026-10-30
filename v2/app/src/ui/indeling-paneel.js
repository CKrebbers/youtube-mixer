/**
 * De indeling op het scherm (WENSEN 19 okt: "modulair… tijdens het bouwen switchen en testen…
 * per nummer een andere layout"): welke indeling actief is, wisselen, een eigen kopie maken,
 * aan het nummer op de focus-track hangen, en LEREN door aanwijzen: zet leren aan, klik een knop
 * op het scherm (die actie), beweeg een control op de APC (die plek). Bewaren gaat via de
 * instellingen op de server (app.js).
 */
export function opzetIndelingPaneel({ ctl, engine, knop, paneel, bewaarEigen, bewaarPerNummer, meld }) {
  const el = (tag, attr = {}, tekst = '') => { const e = document.createElement(tag); Object.assign(e, attr); if (tekst) e.textContent = tekst; return e; };
  const kiezer = el('select', { title: 'actieve indeling (APC)' });
  const kopie = el('button', { type: 'button' }, 'kopie');
  const perNummer = el('label', { className: 'mini' });
  const vink = el('input', { type: 'checkbox' });
  perNummer.append(vink, document.createTextNode(' bij dit nummer'));
  const leer = el('button', { type: 'button', className: 'leer' }, 'leren');
  const uitleg = el('div', { className: 'ind-uitleg' }, '');
  paneel.append(el('strong', {}, 'INDELING'), kiezer, kopie, perNummer, leer, uitleg);

  const apc = ctl.apc;
  let leren = false;
  const focusId = () => engine.track(engine.focus).nummer?.id ?? null;

  function teken() {
    const namen = apc.namen();
    if (kiezer.options.length !== namen.length || [...kiezer.options].some((o, i) => o.value !== namen[i])) {
      kiezer.replaceChildren(...namen.map((n) => el('option', { value: n }, n)));
    }
    kiezer.value = apc.actief?.naam ?? '';
    const id = focusId();
    vink.disabled = !id;
    vink.checked = !!id && apc.perNummer.get(String(id)) === apc.actief?.naam;
    knop.textContent = `⌨ ${apc.actief?.naam ?? '—'}`;
    leer.classList.toggle('aan', leren);
    uitleg.textContent = leren ? (ctl.leren.apc.bezig ? `beweeg nu een control op de APC voor ${ctl.leren.apc.actie}` : 'klik een knop of schuif op het scherm') : '';
  }

  knop.addEventListener('click', () => { paneel.hidden = !paneel.hidden; teken(); });
  kiezer.addEventListener('change', () => {
    // Standaard of Hybride is het hele systeem: die wordt de standaard (en dit tabblad onthoudt hem).
    if (['standaard', 'hybride'].includes(kiezer.value)) {
      apc.zetStandaard(kiezer.value);
      try { localStorage.setItem('varve.v2.indeling', kiezer.value); } catch { /* geen opslag: niet erg */ }
    }
    apc.kies(kiezer.value);
    teken();
  });
  kopie.addEventListener('click', () => {
    const bron = apc.naarJSON();
    if (!bron) return;
    let i = 1;
    while (apc.namen().includes(`eigen-${i}`)) i++;
    const doc = { ...bron, naam: `eigen-${i}` };
    apc.voegToe(doc);
    apc.kies(doc.naam);
    bewaarEigen('apc', doc);
    meld(`indeling eigen-${i} gemaakt (kopie van ${bron.naam})`, 'info', 'indeling');
    teken();
  });
  vink.addEventListener('change', () => {
    const id = focusId();
    if (!id) return;
    apc.koppelNummer(id, vink.checked ? apc.actief.naam : null);
    bewaarPerNummer({ apc: apc.perNummerJSON() });
    teken();
  });
  leer.addEventListener('click', () => { leren = !leren; if (!leren) ctl.stopLeren(); teken(); });
  // Leren: de eerste klik op een bedieningselement kiest de actie (en doet hem niet).
  document.addEventListener('pointerdown', (e) => {
    if (!leren || e.target.closest('#ind-paneel')) return;
    const x = e.target.closest('[data-actie], [data-waarde]');
    if (!x) return;
    e.preventDefault(); e.stopPropagation();
    const actie = x.dataset.waarde ?? x.dataset.actie;
    ctl.leer(actie, 'apc');
    teken();
  }, true);
  ctl.on('geleerd', () => { meld('geleerd en bewaard', 'info', 'indeling'); teken(); });
  apc.on('verander', teken);
  engine.on('focus', teken);
  paneel.hidden = true;
  teken();
  return { teken };
}
