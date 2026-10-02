import { normaliseerPlan, bewerk, verschil } from './plan-model.js';
import { voorspel, toonKleur } from './tijdlijn.js';

/*
 * Het planvenster (plan.html): de hele programmering zien, inrichten en live
 * volgen. docs/PLAN.md.
 *
 * Geopend vanuit de mixer (knop "plan") leest het daar rechtstreeks de
 * automaat en de engine (window.opener.varvePlan, zoals het beamervenster) en
 * stuurt de knoppen over de bus van de mixer: dit venster maakt geen
 * AudioContext, praat niet met MIDI en neemt de Web Lock niet. Los geopend is
 * het alleen een editor (de library en het plan via de server).
 *
 * Opslaan gaat met versie (PUT /api/plannen/<naam>): heeft iemand anders
 * (Claude, een ander venster) het intussen gewijzigd, dan zegt het dat en kies
 * jij. Is er hier niets gewijzigd, dan komt een nieuwe versie vanzelf binnen.
 */

const $ = (s) => document.querySelector(s);
const NAAM = /^[\w-]{1,60}$/;
const SOORT_NAAM = { auto: 'auto', blend: 'lange blend', filter: 'filter-uit', ambient: 'overvloeien' };
const KLEUR = { blend: '#4ad9c4', filter: '#ffbe3c', ambient: '#c48cff' };
const mmss = (s) => {
  if (!Number.isFinite(s)) return '–';
  const t = Math.max(0, Math.round(s)), u = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return u ? `${u}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
/** "2:57", "1:02:03", "177" → seconden; "" → null; onzin → undefined. */
function leesTijd(t) {
  const s = String(t ?? '').trim().replace(',', '.');
  if (!s) return null;
  const delen = s.split(':').map(Number);
  if (delen.some((x) => !Number.isFinite(x) || x < 0) || delen.length > 3) return undefined;
  return delen.reduce((a, x) => a * 60 + x, 0);
}
const koppeling = () => { try { const o = window.opener; return o && !o.closed ? o.varvePlan ?? null : null; } catch (_) { return null; } };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const staat = {
  naam: 'auto-plan', plan: normaliseerPlan({ stappen: [] }).plan, versie: null, bewaard: '',
  terug: [], vooruit: [], gekozen: null, tracks: new Map(), bieb: [], v: { stappen: [], totaal: 0 },
  flits: new Set(), conflict: null,
};

// ---- server ----------------------------------------------------------------

async function haalBieb() {
  const k = koppeling();
  const uitMixer = k?.library?.();
  if (uitMixer?.length) return uitMixer;
  const r = await fetch('/api/library?aantal=500');
  return r.ok ? (await r.json()).tracks || [] : [];
}

async function laad(naam) {
  const r = await fetch(`/api/plannen/${encodeURIComponent(naam)}`);
  staat.naam = naam;
  if (r.status === 404) {
    staat.plan = normaliseerPlan({ naam, stappen: [] }).plan;
    staat.versie = null;
  } else {
    const d = await r.json();
    staat.plan = d.plan ?? normaliseerPlan({ naam, stappen: [] }).plan;
    staat.versie = d.versie;
    if (d.fouten?.length) melding(`bij het lezen: ${d.fouten.slice(0, 3).join('; ')}`);
  }
  staat.bewaard = JSON.stringify(staat.plan);
  staat.terug = []; staat.vooruit = [];
  staat.conflict = null;
  $('.pl-naam').value = naam;
  $('.pl-uitleg textarea').value = staat.plan.uitleg || '';
  render();
}

async function vulKiezer() {
  const r = await fetch('/api/plannen');
  const lijst = r.ok ? (await r.json()).plannen : [];
  const sel = $('.pl-kies');
  const namen = [...new Set([staat.naam, ...lijst.map((p) => p.naam)])];
  sel.innerHTML = namen.map((n) => `<option value="${esc(n)}"${n === staat.naam ? ' selected' : ''}>${esc(n)}</option>`).join('')
    + '<option value="">+ nieuw plan…</option>';
}

const gewijzigd = () => JSON.stringify(staat.plan) !== staat.bewaard;

async function opslaan({ versie = staat.versie } = {}) {
  const naam = $('.pl-naam').value.trim();
  if (!NAAM.test(naam)) { melding('een plannaam is letters, cijfers, - en _ (zonder spaties)'); return; }
  const nieuweNaam = naam !== staat.naam;
  const plan = { ...staat.plan, naam };
  const r = await fetch(`/api/plannen/${encodeURIComponent(naam)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, versie: nieuweNaam ? null : versie }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 409) {
    if (nieuweNaam) { melding(`er bestaat al een plan "${naam}": kies een andere naam`); return; }
    staat.conflict = d;
    render();
    const vs = d.plan ? verschil(d.plan, staat.plan) : null;
    melding(`het plan is intussen gewijzigd (door Claude of een ander venster)${vs ? `: ${beschrijf(vs)}` : ''}`, [
      ['hun versie laden', () => { staat.plan = d.plan; staat.versie = d.versie; staat.bewaard = JSON.stringify(d.plan); staat.conflict = null; melding(null); render(); }],
      ['mijn versie eroverheen', () => { staat.conflict = null; melding(null); opslaan({ versie: d.versie }); }],
    ]);
    return;
  }
  if (!r.ok) { melding(`opslaan mislukt: ${d.fout || r.status}`); return; }
  staat.naam = naam;
  staat.plan = d.plan;
  staat.versie = d.versie;
  staat.bewaard = JSON.stringify(d.plan);
  staat.conflict = null;
  melding(d.fouten?.length ? `opgeslagen, met opmerkingen: ${d.fouten.slice(0, 3).join('; ')}` : null);
  koppeling()?.bewaard?.(d.plan, d.versie, naam);
  if (nieuweNaam) vulKiezer();
  render();
}

/** Iemand anders sloeg op (Claude schreef het bestand)? Zonder eigen wijzigingen: overnemen, en laten zien wat. */
async function kijkServer() {
  if (staat.conflict) return;
  const r = await fetch(`/api/plannen/${encodeURIComponent(staat.naam)}`).catch(() => null);
  if (!r?.ok) return;
  const d = await r.json();
  if (!d.versie || d.versie === staat.versie || !d.plan) return;
  if (gewijzigd()) {
    staat.conflict = d;
    render();
    melding('het plan is op de server gewijzigd terwijl jij ook iets veranderde', [
      ['hun versie laden', () => { staat.plan = d.plan; staat.versie = d.versie; staat.bewaard = JSON.stringify(d.plan); staat.conflict = null; melding(null); render(); }],
      ['mijn versie bewaren', () => { staat.conflict = null; melding(null); opslaan({ versie: d.versie }); }],
    ]);
    return;
  }
  const vs = verschil(staat.plan, d.plan);
  staat.flits = new Set([...vs.erbij, ...vs.anders.map((a) => a.id)]);
  staat.plan = d.plan;
  staat.versie = d.versie;
  staat.bewaard = JSON.stringify(d.plan);
  $('.pl-uitleg textarea').value = d.plan.uitleg || '';
  melding(`het plan is bijgewerkt (van buiten dit venster): ${beschrijf(vs)}`);
  setTimeout(() => melding(null), 8000);
  render();
}

function beschrijf(vs) {
  const d = [];
  if (vs.erbij.length) d.push(`${vs.erbij.length} erbij`);
  if (vs.weg.length) d.push(`${vs.weg.length} weg`);
  if (vs.anders.length) d.push(`${vs.anders.length} anders`);
  if (vs.volgorde) d.push('volgorde anders');
  return d.join(', ') || 'alleen tekst';
}

// ---- bewerken ----------------------------------------------------------------

function wijzig(b) {
  const nieuw = typeof b === 'function' ? b(staat.plan) : bewerk(staat.plan, b, { door: 'clay' });
  if (nieuw === staat.plan) { render(); return; }
  staat.terug.push(staat.plan);
  if (staat.terug.length > 200) staat.terug.shift();
  staat.vooruit = [];
  staat.plan = nieuw;
  render();
}
function ongedaan() { if (!staat.terug.length) return; staat.vooruit.push(staat.plan); staat.plan = staat.terug.pop(); render(); }
function opnieuw() { if (!staat.vooruit.length) return; staat.terug.push(staat.plan); staat.plan = staat.vooruit.pop(); render(); }

// ---- tekenen: de lijst ---------------------------------------------------------

function render() {
  staat.v = voorspel(staat.plan, staat.tracks);
  const n = staat.plan.stappen.length;
  $('.pl-info').textContent = n ? `${n} stappen · ~${mmss(staat.v.totaal)}` : 'nog leeg: zoek rechts een nummer';
  const st = $('.pl-status');
  st.textContent = staat.conflict ? 'botsing' : gewijzigd() ? 'niet opgeslagen' : staat.versie ? 'opgeslagen' : 'nieuw';
  st.className = `pl-status ${staat.conflict ? 'fout' : gewijzigd() ? 'gewijzigd' : ''}`;
  $('.pl-ongedaan').disabled = !staat.terug.length;
  $('.pl-opnieuw').disabled = !staat.vooruit.length;
  const rijen = $('.pl-rijen');
  // De focus bewaren: na Tab staat hij al in het volgende veld, dat zo opnieuw gemaakt wordt.
  const actief = document.activeElement;
  const terugFocus = actief?.closest?.('.pl-rij') ? { id: actief.closest('.pl-rij').dataset.id, klasse: [...actief.classList].find((c) => c.startsWith('pl-')) } : null;
  const scroll = $('.pl-lijst').scrollTop;
  rijen.innerHTML = '';
  if (!n) { rijen.innerHTML = '<div class="pl-leeg">Nog geen stappen. Kies rechts een nummer, of vraag Claude om een plan.</div>'; }
  staat.v.stappen.forEach((r, i) => {
    if (i > 0) rijen.append(tussen(r));
    rijen.append(rij(r, i));
  });
  staat.flits.clear();
  $('.pl-lijst').scrollTop = scroll;
  if (terugFocus?.klasse) document.querySelector(`.pl-rij[data-id="${CSS.escape(terugFocus.id)}"] .${terugFocus.klasse}`)?.focus();
  tekenStrook();
  vulBieb();
}

function tussen(r) {
  const el = document.createElement('div');
  el.className = 'pl-tussen';
  if (!r.overgang) return el;
  const k = toonKleur(r.afstand);
  const toon = r.afstand === null ? 'toon onbekend' : r.afstand === 0 ? 'zelfde toon' : `toon ${r.afstand} ${r.afstand === 1 ? 'stap' : 'stappen'}`;
  const tempo = r.tempo === null ? '' : `tempo ${r.tempo < 0.005 ? 'gelijk' : `${Math.round(r.tempo * 100)}%`}`;
  el.innerHTML = `<span class="stap ${k ?? ''}">${toon}</span>${tempo ? `<span>${tempo}</span>` : ''}<span>overgang ~${Math.round(r.overgang.sec)} s</span>`;
  return el;
}

function rij(r, i) {
  const s = r.stap;
  const el = document.createElement('div');
  el.className = `pl-rij${staat.gekozen === s.id ? ' gekozen' : ''}${r.ontbreekt ? ' ontbreekt' : ''}${staat.flits.has(s.id) ? ' nieuw' : ''}`;
  el.dataset.id = s.id;
  const lengteEenheid = (r.overgang?.gekozen ?? s.overgang) === 'ambient' ? 's' : 'maten';
  const lengteWaarde = s.lengte ? (s.lengte.maten ?? s.lengte.sec) : '';
  const wordt = r.overgang
    ? `→ ${r.overgang.naam}${r.overgang.afgewezen ? ` (je vroeg ${SOORT_NAAM[s.overgang]})` : ''}` : 'begin van de set';
  el.innerHTML = `
    <span class="pl-greep" draggable="true" title="slepen om te verplaatsen">⋮⋮</span>
    <span class="pl-nr">${i + 1}</span>
    <span class="pl-titel" title="${esc(r.titel)}">${esc(r.titel)}${r.ontbreekt ? ' (niet in de library)'
      : `<small>${mmss(r.start)} in de set · stuk ${mmss(r.van)}–${mmss(r.tot)}${r.duurNummer ? ` van ${mmss(r.duurNummer)}` : ''}</small>`}</span>
    <span class="pl-toon ${r.toonZeker ? '' : 'pl-onzeker'}" title="${r.camelot ? `Camelot ${r.camelot}` : ''}${r.toonZeker ? '' : ' (onzeker)'}">${esc(r.toon ?? '–')}${r.toon && !r.toonZeker ? '?' : ''}</span>
    <span class="${r.gridZeker ? '' : 'pl-onzeker'}" title="${r.gridZeker ? 'grid zeker' : 'grid onzeker: geen blend'}">${r.bpm ? Math.round(r.bpm) : '–'}${r.bpm && !r.gridZeker ? '?' : ''}</span>
    <input class="pl-van" value="${s.van === null ? '' : mmss(s.van)}" placeholder="${r.ontbreekt ? '' : `auto ${mmss(r.van)}`}" title="beginpunt in het nummer (m:ss); leeg = de app kiest">
    <input class="pl-duur" value="${s.speelduur === null ? '' : mmss(s.speelduur)}" placeholder="${r.ontbreekt ? '' : `auto ${mmss(r.duur)}`}" title="hoe lang (m:ss); leeg = de app kiest">
    <span class="pl-overgang">
      <span class="rij2">
        <select class="pl-soort"${i === 0 ? ' disabled title="de eerste stap begint de set"' : ''}>
          ${['auto', 'blend', 'filter', 'ambient'].map((o) => `<option value="${o}"${s.overgang === o ? ' selected' : ''}>${SOORT_NAAM[o]}</option>`).join('')}
        </select>
        <input class="pl-lengte" value="${lengteWaarde}" placeholder="${lengteEenheid}" title="lengte van de overgang in ${lengteEenheid}; leeg = standaard"${i === 0 ? ' disabled' : ''}>
      </span>
      <span class="pl-wordt${r.overgang?.afgewezen ? ' afgewezen' : ''}" title="${esc((r.overgang?.redenen || []).join('\n'))}">${esc(wordt)}</span>
    </span>
    <input class="pl-waarom" value="${esc(s.waarom)}" placeholder="waarom (voor jezelf en voor Claude)">
    <span class="pl-door ${s.door ?? ''}" title="wie deze stap het laatst veranderde">${s.door === 'claude' ? 'Claude' : s.door === 'clay' ? 'jij' : ''}</span>
    <button class="pl-weg" title="weg (Del)">✕</button>
    <span class="pl-badge" hidden></span><span class="pl-voortgang"></span>`;

  el.addEventListener('pointerdown', () => kies(s.id, false));
  el.addEventListener('focusin', () => kies(s.id, false));
  const zet = (velden) => wijzig({ soort: 'zet', id: s.id, velden });
  const tijdVeld = (sel, veld) => el.querySelector(sel).addEventListener('change', (e) => {
    const t = leesTijd(e.target.value);
    if (t === undefined) { melding('tijd als m:ss (bv. 2:57) of seconden; leeg = de app kiest'); render(); return; }
    zet({ [veld]: t });
  });
  tijdVeld('.pl-van', 'van');
  tijdVeld('.pl-duur', 'speelduur');
  el.querySelector('.pl-soort').addEventListener('change', (e) => zet({ overgang: e.target.value }));
  el.querySelector('.pl-lengte').addEventListener('change', (e) => {
    const x = Number(String(e.target.value).replace(',', '.'));
    const leeg = !String(e.target.value).trim();
    if (!leeg && !(x > 0)) { melding('lengte: een getal (maten, of seconden bij overvloeien)'); render(); return; }
    zet({ lengte: leeg ? null : lengteEenheid === 's' ? { sec: x } : { maten: x } });
  });
  el.querySelector('.pl-waarom').addEventListener('change', (e) => zet({ waarom: e.target.value }));
  el.querySelector('.pl-weg').addEventListener('click', () => wijzig({ soort: 'weg', id: s.id }));

  // Slepen aan de greep: een regel verplaatsen.
  el.querySelector('.pl-greep').addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('sleep-boven'); });
  el.addEventListener('dragleave', () => el.classList.remove('sleep-boven'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('sleep-boven');
    const id = e.dataTransfer.getData('text/plain');
    if (!id || id === s.id) return;
    const van = staat.plan.stappen.findIndex((x) => x.id === id);
    const naar = staat.plan.stappen.findIndex((x) => x.id === s.id);
    wijzig({ soort: 'verplaats', id, naar: van < naar ? naar - 1 : naar });
  });
  return el;
}

function kies(id, scroll = true) {
  staat.gekozen = id;
  for (const el of document.querySelectorAll('.pl-rij')) el.classList.toggle('gekozen', el.dataset.id === id);
  if (scroll) document.querySelector(`.pl-rij[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  tekenStrook();
}

// ---- de library-lijst rechts -------------------------------------------------------

let biebZoek = '';
function vulBieb() {
  const el = $('.pl-bieb');
  const z = biebZoek.toLowerCase();
  const inPlan = new Set(staat.plan.stappen.map((s) => s.track));
  const lijst = staat.bieb.filter((t) => !z || (t.titel || '').toLowerCase().includes(z)).slice(0, 200);
  el.innerHTML = '';
  for (const t of lijst) {
    const b = document.createElement('button');
    const toon = t.toon?.stukken?.[0]?.toonsoort ?? '–';
    const bpm = t.grid?.stukken?.[0]?.bpm;
    b.innerHTML = `${esc(t.titel)}<small>${mmss(t.duur)} · ${esc(toon)}${bpm ? ` · ${Math.round(bpm)} bpm` : ''}${inPlan.has(t.id) ? ' · al in het plan' : ''}</small>`;
    b.title = 'erbij na de gekozen stap';
    b.addEventListener('click', () => {
      const voor = new Set(staat.plan.stappen.map((s) => s.id));
      wijzig({ soort: 'erbij', stap: { track: t.id }, na: staat.gekozen ?? undefined });
      const nieuw = staat.plan.stappen.find((s) => !voor.has(s.id));
      if (nieuw) kies(nieuw.id);
    });
    el.append(b);
  }
}

// ---- de strook (tijdlijn) --------------------------------------------------------

const doek = $('.pl-strook canvas');
let live = null;          // { stap, setTijd } uit de automaat, of null

function tekenStrook() {
  const w = doek.clientWidth, h = doek.clientHeight, dpr = window.devicePixelRatio || 1;
  if (doek.width !== Math.round(w * dpr)) { doek.width = Math.round(w * dpr); doek.height = Math.round(h * dpr); }
  const g = doek.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const tot = Math.max(1, staat.v.totaal), pad = 10, sx = (t) => pad + (t / tot) * (w - 2 * pad);
  const baan = (i) => (i % 2 ? 40 : 12);
  g.font = '11px system-ui';
  staat.v.stappen.forEach((r, i) => {
    const x0 = sx(r.start), x1 = sx(r.start + r.duur), y = baan(i);
    g.fillStyle = r.ontbreekt ? '#3a1d1d' : '#1b242d';
    g.fillRect(x0, y, Math.max(2, x1 - x0), 24);
    if (r.overgang && r.overlap > 0) {
      g.fillStyle = (KLEUR[r.overgang.gekozen] || '#888') + '55';
      g.fillRect(x0, 8, Math.max(2, sx(r.start + r.overlap) - x0), 60);
    } else if (r.overgang?.gekozen === 'filter') {
      g.fillStyle = KLEUR.filter;
      g.fillRect(x0 - 1, 8, 2, 60);
    }
    const gekozen = staat.gekozen === r.id, speelt = live?.stap === r.id;
    g.strokeStyle = speelt ? '#4ad9c4' : gekozen ? '#dfe7ee' : '#2c3844';
    g.lineWidth = speelt || gekozen ? 2 : 1;
    g.strokeRect(x0 + 0.5, y + 0.5, Math.max(2, x1 - x0) - 1, 23);
    g.save();
    g.beginPath(); g.rect(x0 + 3, y, Math.max(0, x1 - x0 - 6), 24); g.clip();
    g.fillStyle = '#dfe7ee';
    g.fillText(`${i + 1} ${r.titel}`, x0 + 5, y + 16);
    g.restore();
  });
  // Tijd onderaan, en de afspeelkop.
  g.fillStyle = '#8a96a2';
  const stap = tot > 3600 ? 600 : tot > 1200 ? 300 : 60;
  for (let t = 0; t <= tot; t += stap) g.fillText(mmss(t), sx(t) + 2, h - 3);
  if (live && Number.isFinite(live.setTijd)) {
    const x = sx(live.setTijd);
    g.fillStyle = '#4ad9c4';
    g.fillRect(x - 1, 0, 2, h);
  }
}
doek.addEventListener('click', (e) => {
  const x = e.offsetX, w = doek.clientWidth, tot = Math.max(1, staat.v.totaal), t = ((x - 10) / (w - 20)) * tot;
  const r = staat.v.stappen.find((s) => t >= s.start && t <= s.start + s.duur) ?? null;
  if (r) kies(r.id);
});
window.addEventListener('resize', () => tekenStrook());

// ---- live: wat de automaat in de mixer doet --------------------------------------------

function volgLive() {
  const k = koppeling();
  const el = $('.pl-live'), tekst = $('.pl-live-tekst');
  const autoKnop = $('.pl-auto');
  for (const b of document.querySelectorAll('[data-actie]')) b.disabled = !k;
  if (!k) {
    el.classList.add('los'); tekst.textContent = 'los: alleen bewerken (open via de knop "plan" in de mixer om live te volgen)';
    live = null; zetRijen(null); return;
  }
  el.classList.remove('los');
  const auto = k.auto, s = auto.stand();
  const ditPlan = k.naam() === staat.naam;
  tekst.textContent = !ditPlan ? `de auto-DJ gebruikt een ander plan ("${k.naam()}")`
    : s.aan ? `auto ${({ wacht: 'kiest', laden: 'laadt', klaar: 'klaar', bezig: 'mixt', overgenomen: 'jij mixt' })[s.fase] ?? s.fase}` : 'verbonden · auto uit';
  autoKnop.textContent = s.aan ? 'auto aan' : 'auto uit';
  autoKnop.classList.toggle('on', s.aan);
  if (!ditPlan || !s.aan) { live = null; zetRijen(null); return; }
  zetRijen(auto, s);
}

function zetRijen(auto, s) {
  const gespeeld = new Map();
  if (auto) for (const g of auto.geschiedenis) if (g.stap) gespeeld.set(g.stap, g);
  const nu = s?.plan?.hoofdStap ?? null, volgende = s?.plan?.volgendeStap ?? null;
  let setTijd = null;
  for (const el of document.querySelectorAll('.pl-rij')) {
    const id = el.dataset.id, g = gespeeld.get(id);
    const isNu = id === nu, isVolgende = id === volgende;
    el.classList.toggle('nu', isNu);
    el.classList.toggle('volgende', isVolgende);
    el.classList.toggle('gespeeld', !!g && !isNu && !isVolgende);
    const badge = el.querySelector('.pl-badge');
    let b = '';
    if (isNu) b = 'speelt nu';
    else if (isVolgende) b = s.volgende?.maten ? `klaar · over ${s.volgende.maten} maten` : s.volgende?.over != null ? `klaar · over ${mmss(s.volgende.over)}` : s.fase === 'bezig' ? 'komt erin' : 'klaar';
    else if (g) b = g.wat === 'overgeslagen' ? 'overgeslagen' : g.wat === 'overgenomen' ? 'jij nam over' : 'gespeeld';
    if (g && g.wat === 'gespeeld' && g.gekozen && g.gevraagd && g.gevraagd !== 'auto' && g.gevraagd !== g.gekozen) b += ` · de app koos ${SOORT_NAAM[g.gekozen] ?? g.gekozen}`;
    if (g?.langer) b += ` · ${g.langer}× langer`;
    badge.hidden = !b;
    badge.textContent = b;
    const balk = el.querySelector('.pl-voortgang');
    if (isNu && auto) {
      const d = auto.engine.deck(auto.hoofd);
      const van = auto.hoofdVan ?? d.position, eind = auto.eind ?? d.duration;
      const p = eind > van ? Math.min(1, Math.max(0, (d.position - van) / (eind - van))) : 0;
      balk.style.width = `${(p * 100).toFixed(1)}%`;
      const r = staat.v.stappen.find((x) => x.id === id);
      if (r) setTijd = r.start + Math.max(0, d.position - van) / (d.rate || 1);
    } else balk.style.width = '0';
  }
  const was = live;
  live = nu ? { stap: nu, setTijd } : null;
  if (JSON.stringify(was) !== JSON.stringify(live)) tekenStrook();
}

let laatst = 0;
function lus(t) {
  if (t - laatst > 150) { laatst = t; try { volgLive(); } catch (err) { console.error('[plan]', err); } }
  requestAnimationFrame(lus);
}

// ---- meldingen ------------------------------------------------------------------------

function melding(tekst, knoppen = []) {
  const el = $('.pl-melding');
  el.classList.toggle('aan', !!tekst);
  $('.pl-melding-tekst').textContent = tekst || '';
  for (const b of el.querySelectorAll('button')) b.remove();
  for (const [naam, fn] of knoppen) {
    const b = document.createElement('button');
    b.className = 'btn sm';
    b.textContent = naam;
    b.addEventListener('click', fn);
    el.append(b);
  }
}

// ---- knoppen en toetsen ----------------------------------------------------------------

$('.pl-opslaan').addEventListener('click', () => opslaan());
$('.pl-ongedaan').addEventListener('click', ongedaan);
$('.pl-opnieuw').addEventListener('click', opnieuw);
$('.pl-gebruik').addEventListener('click', async () => {
  const k = koppeling();
  if (!k) { melding('open dit venster via de knop "plan" in de mixer om een plan te laten spelen'); return; }
  if (gewijzigd() || !staat.versie) await opslaan();
  if (gewijzigd()) return;
  await k.gebruik(staat.naam);
  melding(`de auto-DJ gebruikt nu "${staat.naam}"${k.auto.aan ? '' : ' (zet auto aan om te spelen)'}`);
  setTimeout(() => melding(null), 5000);
});
$('.pl-kies').addEventListener('change', async (e) => {
  const n = e.target.value;
  if (gewijzigd() && !window.confirm('Er zijn niet-opgeslagen wijzigingen. Toch een ander plan openen?')) { e.target.value = staat.naam; return; }
  if (!n) {
    staat.plan = normaliseerPlan({ naam: 'nieuw', stappen: [] }).plan;
    staat.naam = 'nieuw'; staat.versie = null; staat.bewaard = ''; staat.terug = []; staat.vooruit = [];
    $('.pl-naam').value = ''; $('.pl-naam').placeholder = 'naam van het nieuwe plan';
    $('.pl-uitleg textarea').value = '';
    render();
    $('.pl-naam').focus();
    return;
  }
  await laad(n);
});
$('.pl-uitleg textarea').addEventListener('change', (e) => wijzig((p) => ({ ...p, uitleg: e.target.value })));
$('.pl-zoek input').addEventListener('input', (e) => { biebZoek = e.target.value; vulBieb(); });
for (const b of document.querySelectorAll('[data-actie]')) {
  b.addEventListener('click', () => {
    const k = koppeling();
    if (!k) return;
    k.invoke(b.dataset.actie, true);
    k.invoke(b.dataset.actie, false);
  });
}
window.addEventListener('keydown', (e) => {
  const inVeld = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); e.target.blur?.(); opslaan(); return; }
  if (inVeld) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? opnieuw : ongedaan)(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); opnieuw(); return; }
  const st = staat.plan.stappen, i = st.findIndex((s) => s.id === staat.gekozen);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const stap = e.key === 'ArrowDown' ? 1 : -1;
    if (e.altKey && i >= 0) { wijzig({ soort: 'verplaats', id: st[i].id, naar: i + stap }); kies(st[i].id); return; }
    const j = Math.min(st.length - 1, Math.max(0, (i < 0 ? 0 : i + stap)));
    if (st[j]) kies(st[j].id);
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && i >= 0) {
    e.preventDefault();
    const volgende = st[i + 1]?.id ?? st[i - 1]?.id ?? null;
    wijzig({ soort: 'weg', id: st[i].id });
    if (volgende) kies(volgende);
  }
});
window.addEventListener('beforeunload', (e) => { if (gewijzigd()) { e.preventDefault(); e.returnValue = ''; } });

// ---- start --------------------------------------------------------------------------------

(async () => {
  try {
    const k = koppeling();
    const q = new URLSearchParams(location.search).get('plan');
    staat.bieb = await haalBieb();
    staat.tracks = new Map(staat.bieb.map((t) => [t.id, t]));
    await laad(q || k?.naam?.() || 'auto-plan');
    await vulKiezer();
    setInterval(kijkServer, 3000);
    requestAnimationFrame(lus);
    window.varvePlanVenster = staat;           // voor de console en de headless proef
  } catch (err) {
    console.error('[plan]', err);
    melding(`het plan kon niet laden: ${err.message}`);
  }
})();
