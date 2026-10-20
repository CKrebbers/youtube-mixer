/**
 * Knoppen, faders, toetsen en de jog op het scherm. Ze sturen ALLEEN via de bus
 * en lezen elke frame hun stand terug via bus.lees (v1-les: zonder dat loopt het
 * scherm achter zodra er een tweede bron is, zoals een controller).
 *
 * Bediening: slepen (verticaal), Shift = fijn, scrollwiel, pijltjes op het
 * toetsenbord, dubbelklik = terug naar de beginstand.
 */

const BEGIN = { trim: 0.5, laag: 0.5, mid: 0.5, hoog: 0.5, filter: 0.5, pitch: 0.5, fader: 1 };
const beginVan = (id) => BEGIN[id.split('.').at(-1)] ?? 0.5;

/** Hoe een waarde 0..1 er voor de mens uitziet. */
export function toon(id, v) {
  if (v === null || v === undefined) return '—';
  const naam = id.split('.').at(-1);
  if (naam === 'filter') {
    if (Math.abs(v - 0.5) < 0.004) return 'uit';
    return v < 0.5 ? `LP ${Math.round((0.5 - v) * 200)}` : `HP ${Math.round((v - 0.5) * 200)}`;
  }
  if (naam === 'trim') return `${((v - 0.5) * 24).toFixed(1).replace('.', ',')} dB`;
  if (['laag', 'mid', 'hoog'].includes(naam)) {
    if (v < 0.02) return 'weg';
    const db = v >= 0.5 ? (v - 0.5) * 12 : -(0.5 - v) * 48;
    return `${db >= 0 ? '+' : ''}${db.toFixed(1).replace('.', ',')}`;
  }
  return `${Math.round(v * 100)}`;
}

function sleepbaar(el, { bus, id, n, leesStand }) {
  let start = null;
  el.tabIndex = 0;
  const zet = (v) => bus.doe(id, Math.min(1, Math.max(0, v)));
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    el.setPointerCapture(e.pointerId);
    start = { y: e.clientY, v: leesStand() ?? beginVan(id) };
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const hoogte = el.classList.contains('fader') ? el.querySelector('.baan').clientHeight : 160;
    const fijn = e.shiftKey ? 0.15 : 1;
    zet(start.v + ((start.y - e.clientY) / hoogte) * fijn);
  });
  const los = () => { start = null; };
  el.addEventListener('pointerup', los);
  el.addEventListener('pointercancel', los);
  el.addEventListener('dblclick', () => zet(beginVan(id)));
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zet((leesStand() ?? 0.5) - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.02));
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const stap = e.shiftKey ? 0.002 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { zet((leesStand() ?? 0.5) + stap); e.preventDefault(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { zet((leesStand() ?? 0.5) - stap); e.preventDefault(); }
  });
}

/** Een draaiknop: canvas met een boog, naam, waarde en eventueel een kill-knop. */
export function maakKnop(el, bus, { tekst = null } = {}) {
  const id = el.dataset.waarde;
  el.innerHTML = '<canvas width="60" height="60"></canvas><div><span class="naam"></span><span class="waarde"></span></div>';
  el.querySelector('.naam').textContent = el.dataset.label;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', el.dataset.label);
  let kill = null;
  if (el.dataset.kill) {
    kill = document.createElement('button');
    kill.className = 'kill'; kill.textContent = 'KILL'; kill.dataset.actie = el.dataset.kill;
    el.append(kill);
  }
  const cv = el.querySelector('canvas');
  const g = cv.getContext('2d');
  const waardeEl = el.querySelector('.waarde');
  let laatst = NaN, laatstKill = null;
  sleepbaar(el, { bus, id, leesStand: () => bus.lees(id) });
  return {
    teken() {
      const v = bus.lees(id);
      if (kill) {
        const k = bus.lees(el.dataset.kill) === 1;
        if (k !== laatstKill) { kill.classList.toggle('aan', k); laatstKill = k; }
      }
      if (v === laatst) return;
      laatst = v;
      waardeEl.textContent = v === null || v === undefined ? '—' : tekst ? tekst(v) : toon(id, v);
      el.setAttribute('aria-valuenow', String(v ?? ''));
      const s = cv.width, c = s / 2, r = s * 0.38;
      g.clearRect(0, 0, s, s);
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      g.lineWidth = s * 0.09; g.lineCap = 'round';
      g.strokeStyle = '#2a2e34'; g.beginPath(); g.arc(c, c, r, a0, a1); g.stroke();
      if (v === null) return;
      const bipolair = el.classList.contains('filter') || id.endsWith('.trim') || /\.(laag|mid|hoog)$/.test(id);
      const am = bipolair ? (a0 + a1) / 2 : a0;
      const av = a0 + (a1 - a0) * v;
      g.strokeStyle = '#e8eaed'; g.beginPath(); g.arc(c, c, r, Math.min(am, av), Math.max(am, av)); g.stroke();
      g.strokeStyle = '#e8eaed'; g.lineWidth = s * 0.06;
      g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(av) * r * 0.9, c + Math.sin(av) * r * 0.9); g.stroke();
    },
  };
}

/** Een verticale fader (pitch of volume). */
export function maakFader(el, bus) {
  const id = el.dataset.waarde;
  el.innerHTML = '<span class="waarde"></span><div class="baan"><span class="duim"></span></div><span class="naam"></span>';
  el.querySelector('.naam').textContent = el.dataset.label;
  if (el.dataset.midden) el.querySelector('.baan').insertAdjacentHTML('afterbegin', '<span class="midden"></span>');
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', el.dataset.label);
  const duim = el.querySelector('.duim');
  const waardeEl = el.querySelector('.waarde');
  const isPitch = el.classList.contains('pitch');
  let laatst = NaN;
  sleepbaar(el, { bus, id, leesStand: () => bus.lees(id) });
  return {
    teken(extraTekst) {
      const v = bus.lees(id);
      if (v !== laatst) {
        laatst = v;
        duim.style.top = `${(1 - (v ?? 0)) * 100}%`;
      }
      const tekst = isPitch ? (extraTekst ?? '') : toon(id, v);
      if (waardeEl.textContent !== tekst) waardeEl.textContent = tekst;
    },
  };
}

/** De jog: horizontaal slepen = het nummer t.o.v. de klok schuiven. */
export function maakJog(el, bus, n) {
  let x = null, verplaatst = 0;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); x = e.clientX; });
  el.addEventListener('pointermove', (e) => {
    if (x === null) return;
    const dx = e.clientX - x;
    x = e.clientX;
    verplaatst = Math.max(-30, Math.min(30, verplaatst + dx));
    el.style.setProperty('--jog', verplaatst);
    // 1 px = 1/256 tel (Shift: 1/2048): fijn genoeg om een grid dat net naast ligt recht te zetten.
    const tellen = dx / (e.shiftKey ? 2048 : 256);
    if (tellen) bus.doe(`track.${n}.jog`, 0.5 + tellen / (2 * 8 / 32));
  });
  const los = () => { x = null; verplaatst = 0; el.style.setProperty('--jog', 0); };
  el.addEventListener('pointerup', los);
  el.addEventListener('pointercancel', los);
}

/** Knoppen met data-actie: indrukken = true, loslaten = false (naar dezelfde actie). */
export function bindKnoppen(wortel, bus) {
  wortel.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button[data-actie]');
    if (!b || b.disabled) return;
    // Met shift (of alt) de tweede betekenis, als de knop die heeft (hotcue wissen).
    const id = (e.shiftKey || e.altKey) && b.dataset.actieShift ? b.dataset.actieShift : b.dataset.actie;
    bus.doe(id, true);
    const los = () => { bus.doe(id, false); window.removeEventListener('pointerup', los); window.removeEventListener('pointercancel', los); };
    window.addEventListener('pointerup', los);
    window.addEventListener('pointercancel', los);
  });
  wortel.addEventListener('keydown', (e) => {
    const b = e.target.closest('button[data-actie]');
    if (b && (e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); bus.doe(b.dataset.actie, true); bus.doe(b.dataset.actie, false); }
  });
}

/** Schuifjes met data-waarde (crossfader, master). */
export function bindSchuiven(wortel, bus) {
  const lijst = [...wortel.querySelectorAll('input[type=range][data-waarde]')];
  for (const s of lijst) s.addEventListener('input', () => bus.doe(s.dataset.waarde, Number(s.value)));
  return { teken() { for (const s of lijst) { const v = bus.lees(s.dataset.waarde); if (v !== null && document.activeElement !== s && Number(s.value) !== v) s.value = v; } } };
}

/**
 * Lampjes op het scherm zoals op een controller: elke knop met data-actie krijgt data-stand uit
 * bus.lees() (null = uit en niet te drukken, 0 = leeg, 0,5 = gevuld, 1 = aan). Alleen wat
 * verandert wordt geschreven (v1: geen werk per beeld dat niets doet).
 */
export function bindLampjes(wortel, bus) {
  const lijst = [...wortel.querySelectorAll('button[data-actie][data-lamp]')];
  const stand = (v) => (v === null || v === undefined ? 'uit' : v >= 1 ? 'aan' : v > 0 ? 'gevuld' : 'leeg');
  return {
    teken() {
      for (const b of lijst) {
        const s = stand(bus.lees(b.dataset.actie));
        if (b.dataset.stand !== s) { b.dataset.stand = s; b.disabled = s === 'uit'; }
      }
    },
  };
}
