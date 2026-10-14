import { normaliseerPlan, bewerk, verschil, SECTIE_VELDEN, KENT, normaliseerTracks } from './plan-model.js';
import { maakSet, pastBijKeten, secondenTot } from './klaarzetten.js';
import { voorspel, toonKleur } from './tijdlijn.js';
import { LABEL_TEKST } from '../engine/secties.js';
import { tekenStrook as tekenOp, mmss } from './strook.js';

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
 *
 * Secties (docs/PLAN.md §2): per nummer de sectiekaart (GET
 * /api/library/<id>/secties, ZONDER ?maak=1: een plan van dertig nummers zou
 * anders dertig nummers tegelijk laten rekenen). De strook toont ze als
 * banden in de groepskleur; per stap kies je een sectie als in- en als
 * uitpunt. Geen kaart = geen keuze, de rest werkt zoals altijd.
 */

const $ = (s) => document.querySelector(s);
const NAAM = /^[\w-]{1,60}$/;
const SOORT_NAAM = { auto: 'auto', blend: 'lange blend', filter: 'filter-uit', ambient: 'overvloeien' };
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
/** "drop B", "B" voor een gewoon deel; werkt voor een stuk van de kaart en voor een keuze { sectie, label, groep }. */
const sectieNaam = (x) => [LABEL_TEKST[x?.label] ?? x?.label ?? '', x?.groep ?? ''].filter(Boolean).join(' ');
/** Hoeveel stappen in/uit hebben (om te zien of de server ze bewaarde). */
const metSecties = (p) => (p?.stappen || []).filter((s) => s.in || s.uit).length;

const staat = {
  naam: 'auto-plan', plan: normaliseerPlan({ stappen: [] }).plan, versie: null, bewaard: '',
  terug: [], vooruit: [], gekozen: null, tracks: new Map(), bieb: [], v: { stappen: [], totaal: 0 },
  flits: new Set(), conflict: null,
  secties: new Map(),         // track-id → sectiekaart, of null (geen kaart)
  banden: [],                 // wat de strook tekende: [{ id, sectie, groep, x0, x1 }] (voor de console en de headless proef)
  // Spoor S9 (docs/PLAN-SET.md): de selectie rechts, wat klaar is per nummer, de sets.
  selectie: new Set(),        // track-id's die aangevinkt zijn (of uit een krat kwamen)
  klaar: new Map(),           // track-id → { grid, toon, stems, secties, video } van POST /api/set/klaar
  sets: [],                   // de lijst van GET /api/sets (of van de mixer)
  gekozenSet: null,
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
  // Alle kaarten opnieuw vragen: de mixer kan ze intussen (opnieuw) berekend hebben.
  haalSecties({ opnieuw: true });
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

/**
 * De sectiekaarten van de nummers in het plan. ZONDER ?maak=1: alleen wat er
 * al is (de mixer rekent bij het laden). Gewoon: alleen nummers die we nog
 * niet hebben. `opnieuw` (bij het laden van een plan en als het venster de
 * focus krijgt): alle, zodat een kaart die de mixer intussen opnieuw
 * berekende binnenkomt (en "kaart opnieuw berekend" kan afgaan); de oude
 * blijft staan tot de nieuwe er is. Veranderde er iets, dan opnieuw tekenen.
 */
const sectiesBezig = new Set();
let sectiesVers = 0;
function haalSecties({ opnieuw = false } = {}) {
  const ids = [...new Set(staat.plan.stappen.map((s) => s.track))]
    .filter((id) => staat.tracks.has(id) && !sectiesBezig.has(id) && (opnieuw || !staat.secties.has(id)));
  if (opnieuw) sectiesVers = Date.now();
  if (!ids.length) return;
  for (const id of ids) sectiesBezig.add(id);
  let veranderd = false;
  Promise.all(ids.map(async (id) => {
    let k = null, gelukt = false;
    try {
      const r = await fetch(`/api/library/${encodeURIComponent(id)}/secties`);
      if (r.ok) { k = (await r.json()).secties ?? null; gelukt = true; }
    } catch (_) { /* geen kaart: dan geen keuze */ }
    sectiesBezig.delete(id);
    if (!gelukt && staat.secties.get(id)) return;      // niet bereikbaar: de kaart die we hadden blijft
    const nieuw = Array.isArray(k?.stukken) && k.stukken.length ? k : null;
    if (!staat.secties.has(id) || JSON.stringify(nieuw) !== JSON.stringify(staat.secties.get(id))) veranderd = true;
    staat.secties.set(id, nieuw);
  })).then(() => { if (veranderd) render(); });
}
window.addEventListener('focus', () => { if (Date.now() - sectiesVers > 10000) haalSecties({ opnieuw: true }); });

const gewijzigd = () => JSON.stringify(staat.plan) !== staat.bewaard;

async function opslaan({ versie = staat.versie } = {}) {
  const naam = $('.pl-naam').value.trim();
  if (!NAAM.test(naam)) { melding('een plannaam is letters, cijfers, - en _ (zonder spaties)'); return; }
  const nieuweNaam = naam !== staat.naam;
  const plan = { ...staat.plan, naam };
  const r = await fetch(`/api/plannen/${encodeURIComponent(naam)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    // `kent`: dit venster kent in/uit; zonder zet de server ze terug (een oud venster, server/plannen.js).
    // `kent`: dit venster kent in/uit, go, lagen en tracks; zonder zet de server ze terug (een oud venster, server/plannen.js).
    body: JSON.stringify({ plan, versie: nieuweNaam ? null : versie, kent: KENT }),
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
  staat.versie = d.versie;
  staat.bewaard = JSON.stringify(d.plan);
  staat.conflict = null;
  if (metSecties(plan) && !metSecties(d.plan)) {
    // Een server van vóór de secties (nog niet herstart na een update) gooit in/uit weg:
    // dan houden we ze HIER, als niet opgeslagen, zodat je na een herstart opnieuw opslaat.
    staat.plan = { ...staat.plan, naam };
    melding('de server bewaarde in en uit niet: draait er nog een server van vóór de secties? Herstart hem en sla opnieuw op');
  } else {
    staat.plan = d.plan;
    melding(d.fouten?.length ? `opgeslagen, met opmerkingen: ${d.fouten.slice(0, 3).join('; ')}` : null);
  }
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
  wisLater(melding(`het plan is bijgewerkt (van buiten dit venster): ${beschrijf(vs)}`), 8000);
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
  staat.v = voorspel(staat.plan, staat.tracks, { secties: staat.secties });
  haalSecties();
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
  haalKlaar();
  tekenLagen();
  const at = $('.pl-auto-tracks');
  if (document.activeElement !== at) at.value = staat.plan.tracks?.auto?.join(',') ?? '';
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
      : `<small>${mmss(r.start)} in de set · stuk ${mmss(r.van)}–${mmss(r.tot)}${r.duurNummer ? ` van ${mmss(r.duurNummer)}` : ''}${
        s.in ? ` · in ${s.in.sectie} ${esc(sectieNaam(s.in))}` : ''}${s.uit ? ` · uit ${s.uit.sectie} ${esc(sectieNaam(s.uit))}` : ''}</small><small class="pl-tekens">${
        klaarTekens(s.track)}<span class="pl-go${s.go === 'wacht' ? ' aan' : ''}" title="wacht op GO: de automaat zet deze stap klaar, maar begint pas na GO (of op het laatste moment: nooit stilte). G = aan/uit">GO</span>${
        s.lagen?.length ? `<span class="pl-lagen-tel" title="${esc(s.lagen.map(laagTekst).join('\n'))}">+${s.lagen.length} laag</span>` : ''}</small>`}</span>
    <span class="pl-toon ${r.toonZeker ? '' : 'pl-onzeker'}" title="${r.camelot ? `Camelot ${r.camelot}` : ''}${r.toonZeker ? '' : ' (onzeker)'}">${esc(r.toon ?? '–')}${r.toon && !r.toonZeker ? '?' : ''}</span>
    <span class="${r.gridZeker ? '' : 'pl-onzeker'}" title="${r.gridZeker ? 'grid zeker' : 'grid onzeker: geen blend'}">${r.bpm ? Math.round(r.bpm) : '–'}${r.bpm && !r.gridZeker ? '?' : ''}</span>
    <span class="pl-tijd">
      <input class="pl-van" value="${s.van === null ? '' : mmss(s.van)}" placeholder="${r.ontbreekt ? '' : `auto ${mmss(r.van)}`}" title="beginpunt in het nummer (m:ss); leeg = de app kiest">
      ${r.ontbreekt ? '' : sectieKeuze('in', s, r)}
    </span>
    <span class="pl-tijd">
      <input class="pl-duur" value="${s.speelduur === null ? '' : mmss(s.speelduur)}" placeholder="${r.ontbreekt ? '' : `auto ${mmss(r.duur)}`}" title="hoe lang (m:ss); leeg = de app kiest">
      ${r.ontbreekt ? '' : sectieKeuze('uit', s, r)}
    </span>
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
    if (veld === 'van' && s.in) {
      // Het begin staat op een sectie (in): op de seconde gelijk = niets veranderd (het veld rondt af);
      // een ander begin is een ander inmixpunt, dan vervalt in (van is de waarheid).
      if (t !== null && s.van !== null && Math.abs(t - s.van) < 0.5) { render(); return; }
      zet({ van: t, in: null });
      return;
    }
    zet({ [veld]: t });
  });
  tijdVeld('.pl-van', 'van');
  tijdVeld('.pl-duur', 'speelduur');
  // In en uit: een sectie van de kaart. In zet ook van op haar begin (de terugval).
  for (const veld of SECTIE_VELDEN) el.querySelector(`.pl-${veld}`)?.addEventListener('change', (e) => {
    const k = Number(e.target.value) || 0;
    if (!k) { zet({ [veld]: null }); return; }
    const x = r.secties?.[k - 1];
    if (!x) { render(); return; }
    const keuze = { sectie: k, label: x.label ?? null, groep: x.groep ?? null };
    // Uit krijgt ook de tijd van de sectie nu: zo vindt de planner na een herberekening de goede (vindSectie).
    if (veld === 'uit') { zet({ uit: { ...keuze, van: x.van } }); return; }
    const velden = { in: keuze, van: x.van };
    if (s.uit && s.uit.sectie <= k) {
      velden.uit = null;
      melding(`uit (${s.uit.sectie} ${sectieNaam(s.uit)}) viel weg: die lag niet meer na het nieuwe begin`);
    }
    zet(velden);
  });
  el.querySelector('.pl-soort').addEventListener('change', (e) => zet({ overgang: e.target.value }));
  el.querySelector('.pl-lengte').addEventListener('change', (e) => {
    const x = Number(String(e.target.value).replace(',', '.'));
    const leeg = !String(e.target.value).trim();
    if (!leeg && !(x > 0)) { melding('lengte: een getal (maten, of seconden bij overvloeien)'); render(); return; }
    zet({ lengte: leeg ? null : lengteEenheid === 's' ? { sec: x } : { maten: x } });
  });
  el.querySelector('.pl-waarom').addEventListener('change', (e) => zet({ waarom: e.target.value }));
  el.querySelector('.pl-weg').addEventListener('click', () => wijzig({ soort: 'weg', id: s.id }));
  el.querySelector('.pl-go')?.addEventListener('click', (e) => { e.stopPropagation(); zet({ go: s.go === 'wacht' ? null : 'wacht' }); });

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

/**
 * Een keuzelijst voor in of uit: de secties van de kaart ("3 drop B"; de tijd in de tooltip).
 * Uit alleen na het begin (na in, of na van). Geen kaart en niets gekozen:
 * geen lijst. Een keuze die de kaart niet (meer) kent, die nu anders heet
 * (de kaart is opnieuw berekend), of een uit die niet meer na het begin ligt
 * (een later begin getypt) blijft staan, oranje: de planner zoekt hem terug
 * op label en groep, of valt terug op van.
 */
function sectieKeuze(veld, s, r) {
  const st = r.secties;
  const keuze = s[veld] ?? null;
  if (!st && !keuze) return '';
  const opties = [`<option value="">${veld}: —</option>`];
  let gevonden = false, waarschuwing = '';
  if (st) {
    const naIn = veld === 'uit' && s.in ? s.in.sectie : 0;
    const begin = veld === 'uit' ? (s.in ? st[s.in.sectie - 1]?.van ?? 0 : r.van ?? 0) : -Infinity;
    st.forEach((x, i) => {
      const k = i + 1, gekozen = keuze?.sectie === k;
      if (!gekozen && veld === 'uit' && (k <= naIn || x.van <= begin + 0.01)) return;
      if (gekozen) gevonden = true;
      opties.push(`<option value="${k}"${gekozen ? ' selected' : ''} title="begint op ${mmss(x.van)}">${k} ${esc(sectieNaam(x))}</option>`);
    });
    const x = gevonden ? st[keuze.sectie - 1] : null;
    if (x && ((keuze.label && x.label !== keuze.label) || (keuze.groep && x.groep !== keuze.groep))) {
      waarschuwing = `de kaart is opnieuw berekend: sectie ${keuze.sectie} is nu ${sectieNaam(x)}, gekozen was ${sectieNaam(keuze)}`;
    } else if (x && veld === 'uit' && (keuze.sectie <= naIn || x.van <= begin + 0.01)) {
      // Een later begin getypt (of in verschoven): de overgang kan niet beginnen vóór de stap begint.
      waarschuwing = `uit (${keuze.sectie} ${sectieNaam(x)}, ${mmss(x.van)}) ligt niet na het begin (${mmss(begin)}): kies een latere of haal hem weg`;
    }
  }
  if (keuze && !gevonden) {
    opties.push(`<option value="${keuze.sectie}" selected>${keuze.sectie} ${esc(sectieNaam(keuze))}${st ? ' ?' : ''}</option>`);
    waarschuwing = st ? `sectie ${keuze.sectie} staat niet (meer) op de kaart: de planner valt terug op het begin (van)`
      : 'de secties van dit nummer zijn er (nog) niet: laad het eens in de mixer';
  }
  const uitleg = veld === 'in' ? 'in: deze stap begint op die sectie (het begin wordt haar begin)'
    : 'uit: de overgang naar de volgende begint op die sectie';
  return `<select class="pl-${veld}${waarschuwing ? ' pl-onzeker' : ''}" title="${esc(waarschuwing || uitleg)}">${opties.join('')}</select>`;
}

function kies(id, scroll = true) {
  staat.gekozen = id;
  for (const el of document.querySelectorAll('.pl-rij')) el.classList.toggle('gekozen', el.dataset.id === id);
  if (scroll) document.querySelector(`.pl-rij[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  tekenStrook();
  tekenLagen();
}

// ---- de library-lijst rechts -------------------------------------------------------

let biebZoek = '';
function vulBieb() {
  const el = $('.pl-bieb');
  const z = biebZoek.toLowerCase();
  const inPlan = new Set(staat.plan.stappen.map((s) => s.track));
  const lijst = staat.bieb.filter((t) => !z || (t.titel || '').toLowerCase().includes(z)).slice(0, 200);
  el.innerHTML = '';
  $('.pl-sel-tel').textContent = `selectie: ${staat.selectie.size}`;
  for (const t of lijst) {
    const rij = document.createElement('div');
    rij.className = 'rij';
    const vink = document.createElement('input');
    vink.type = 'checkbox';
    vink.className = 'pl-vink';
    vink.checked = staat.selectie.has(t.id);
    vink.title = 'in de selectie (voor "maak set van de selectie")';
    vink.addEventListener('change', () => { if (vink.checked) staat.selectie.add(t.id); else staat.selectie.delete(t.id); $('.pl-sel-tel').textContent = `selectie: ${staat.selectie.size}`; });
    rij.append(vink);
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
    rij.append(b);
    el.append(rij);
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
  staat.banden = tekenOp(g, { v: staat.v, w, h, gekozen: staat.gekozen, live });
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
  tekenLive(k, s);
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

let meldingNr = 0;
/** Een melding (null = weg). Geeft haar nummer: zie wisLater. */
function melding(tekst, knoppen = []) {
  meldingNr++;
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
  return meldingNr;
}
/**
 * Een melding na een tijdje weghalen, maar alleen als zij er nog staat: een
 * latere (een botsing met haar keuzeknoppen) mag een oude timer niet wissen.
 */
const wisLater = (nr, ms) => setTimeout(() => { if (meldingNr === nr) melding(null); }, ms);

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
  wisLater(melding(`de auto-DJ gebruikt nu "${staat.naam}"${k.auto.aan ? '' : ' (zet auto aan om te spelen)'}`), 5000);
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
  // Spoor S9: snel per stap de overgang (1–4) en GO (G).
  const SNEL = { 1: 'auto', 2: 'blend', 3: 'filter', 4: 'ambient' };
  if (!mod && !e.altKey && i >= 0 && SNEL[e.key]) { e.preventDefault(); wijzig({ soort: 'zet', id: st[i].id, velden: { overgang: SNEL[e.key] } }); return; }
  if (!mod && !e.altKey && i >= 0 && e.key.toLowerCase() === 'g') { e.preventDefault(); wijzig({ soort: 'zet', id: st[i].id, velden: { go: st[i].go === 'wacht' ? null : 'wacht' } }); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && i >= 0) {
    e.preventDefault();
    const volgende = st[i + 1]?.id ?? st[i - 1]?.id ?? null;
    wijzig({ soort: 'weg', id: st[i].id });
    if (volgende) kies(volgende);
  }
});
window.addEventListener('beforeunload', (e) => { if (gewijzigd()) { e.preventDefault(); e.returnValue = ''; } });

// ---- spoor S9: snel klaarzetten, klaar voor de set, lagen, sets, live (docs/PLAN-SET.md) ----------

const STEM_NAAM = { vocals: 'zang', inst: 'rest', drums: 'drums', bass: 'bas', other: 'overig' };
/** Een laag als tekst: "acapella (zang) op sectie 3 · track 5 · 64 s". */
function laagTekst(l) {
  const wat = l.soort === 'nummer' ? `${staat.tracks.get(l.track)?.titel ?? l.track}${l.stem ? ` (${STEM_NAAM[l.stem] ?? l.stem})` : ''}`
    : l.soort === 'sampler' ? `sampler-pad ${l.pad}` : `patroon ${l.plek}`;
  const op = Number.isInteger(l.op?.sectie) ? `op sectie ${l.op.sectie}${l.op.label ? ` ${sectieNaam(l.op)}` : ''}` : `op ${mmss(l.op?.sec ?? 0)}`;
  return [wat, op, l.deck ? `track ${l.deck}` : null, l.duur ? `${Math.round(l.duur)} s` : null, l.start === 'jij' ? 'jij start' : null].filter(Boolean).join(' · ');
}

/** De vijf tekens van "klaar": G grid, T toon, S stems, § secties, V video (groen, oranje, grijs). */
function klaarTekens(id) {
  const k = staat.klaar.get(id);
  if (!k) return '';
  if (k.bestaat === false) return ' <span class="pl-klaar"><span class="k-nee">niet in de library</span></span>';
  const t = (teken, soort, titel) => `<span class="k-${soort}" title="${esc(titel)}">${teken}</span>`;
  const g = k.grid === 'zeker' ? 'ja' : k.grid === 'deels' ? 'half' : 'nee';
  const to = k.toon === 'zeker' ? 'ja' : k.toon === 'deels' || k.toon === 'gok' ? 'half' : 'nee';
  const st = Number.isInteger(k.stems) ? 'ja' : k.stems === 'rij' ? 'half' : 'nee';
  const se = k.secties === 'ja' ? 'ja' : k.secties === 'oud' ? 'half' : 'nee';
  return ` <span class="pl-klaar">${t('G', g, `grid: ${k.grid}`)}${t('T', to, `toon: ${k.toon}`)}${t('S', st, `stems: ${k.stems ?? 'geen'}`)}${t('§', se, `secties: ${k.secties}`)}${t('V', k.video ? 'ja' : 'nee', k.video ? 'video' : 'geen video')}</span>`;
}

let klaarSleutel = '', klaarBezig = false;
/** POST /api/set/klaar voor de nummers van het plan, alleen als die lijst veranderde (of `opnieuw`). */
async function haalKlaar({ opnieuw = false } = {}) {
  const ids = [...new Set(staat.plan.stappen.flatMap((x) => [x.track, ...(x.lagen || []).filter((l) => l.soort === 'nummer').map((l) => l.track)]))];
  const sl = ids.join(',');
  if (klaarBezig || (!opnieuw && sl === klaarSleutel) || !ids.length) return;
  klaarSleutel = sl;
  klaarBezig = true;
  try {
    const r = await fetch('/api/set/klaar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.nummers) {
      for (const k of d.nummers) staat.klaar.set(k.id, k);
      const n = d.nummers.filter((k) => k.bestaat !== false);
      const mist = n.filter((k) => !Number.isInteger(k.stems) || k.secties !== 'ja').length;
      $('.pl-klaar-info').textContent = n.length ? `${n.length - mist}/${n.length} klaar${d.secties?.wacht ? ` · secties: nog ${d.secties.wacht}` : ''}` : '';
      klaarBezig = false;
      render();
      return;
    }
  } catch (_) { /* geen server: geen tekens */ }
  klaarBezig = false;
}

$('.pl-maakklaar').addEventListener('click', async () => {
  const ids = [...new Set(staat.plan.stappen.map((x) => x.track))];
  if (!ids.length) { melding('het plan is nog leeg'); return; }
  const r = await fetch('/api/set/klaarmaken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { melding(`maak klaar: ${d.fout || r.status}`); return; }
  const delen = [];
  if (d.stems?.gestart?.length) delen.push(`${d.stems.gestart.length} nummers de stems-rij in`);
  if (d.stems?.fout) delen.push(`stems niet: ${d.stems.fout}`);
  if (d.secties?.gepland) delen.push(`${d.secties.gepland} nummers krijgen secties`);
  wisLater(melding(`maak klaar: ${delen.join(' · ') || 'alles was al klaar'}`), 8000);
  setTimeout(() => haalKlaar({ opnieuw: true }), 1500);
});

/** De kratten van de kaart (alleen als er een kaart is). */
async function vulKratten() {
  const sel = $('.pl-krat');
  try {
    const r = await fetch('/api/kaart');
    const d = r.ok ? await r.json() : null;
    for (const k of d?.kratten || []) {
      if (!k.binnen) continue;
      const o = document.createElement('option');
      o.value = k.id;
      o.textContent = `${k.naam} (${k.binnen} binnen)`;
      sel.append(o);
    }
  } catch (_) { /* geen kaart: geen kratten */ }
  if (sel.options.length <= 1) sel.hidden = true;
}
$('.pl-krat').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) return;
  try {
    const r = await fetch(`/api/kaart/nummers?krat=${encodeURIComponent(id)}&filter=binnen&sorteer=krat&aantal=500`);
    const d = await r.json();
    const ids = (d.nummers || []).map((n) => n.binnen).filter((x) => x && staat.tracks.has(x));
    staat.selectie = new Set(ids);
    staat.selectieVolgorde = ids;
    wisLater(melding(`krat: ${ids.length} nummers in de selectie (in de volgorde van de krat)`), 5000);
  } catch (err) { melding(`krat niet gelezen: ${err.message}`); }
  vulBieb();
});
$('.pl-sel-alles').addEventListener('click', () => { for (const t of staat.bieb) staat.selectie.add(t.id); staat.selectieVolgorde = null; vulBieb(); });
$('.pl-sel-geen').addEventListener('click', () => { staat.selectie.clear(); staat.selectieVolgorde = null; vulBieb(); });

/** "90" = 90 minuten, "01:30" = tot half twee; leeg = null; onzin = undefined. */
function leesDuur(t) {
  const x = String(t ?? '').trim();
  if (!x) return null;
  if (/[:.]\d{2}$/.test(x)) return secondenTot(x) ?? undefined;
  const m = Number(x.replace(',', '.'));
  return m > 0 ? Math.round(m * 60) : undefined;
}

$('.pl-maakset').addEventListener('click', () => {
  const bron = $('.pl-bron').value;
  let tracks = [];
  if (bron === 'selectie') {
    const volg = staat.selectieVolgorde?.filter((id) => staat.selectie.has(id)) ?? [];
    const rest = staat.bieb.map((t) => t.id).filter((id) => staat.selectie.has(id) && !volg.includes(id));
    tracks = [...volg, ...rest].map((id) => staat.tracks.get(id)).filter(Boolean);
  } else if (bron === 'pastbij') {
    const s0 = staat.plan.stappen.find((x) => x.id === staat.gekozen) ?? staat.plan.stappen[0];
    const start = s0 ? staat.tracks.get(s0.track) : null;
    if (!start) { melding('kies eerst een stap (of zet een nummer in het plan): de keten begint daar'); return; }
    tracks = pastBijKeten(start, staat.bieb, { aantal: 12 });
  } else tracks = staat.bieb;
  if (!tracks.length) { melding(bron === 'selectie' ? 'de selectie is leeg: vink rechts nummers aan of kies een krat' : 'geen nummers'); return; }
  const duur = leesDuur($('.pl-duur-set').value);
  if (duur === undefined) { melding('duur: minuten (90) of een eindtijd (01:30)'); return; }
  const r = maakSet(tracks, { vorm: $('.pl-vorm').value, duur, naam: staat.plan.naam, door: 'clay',
    tracks: staat.plan.tracks ?? null, bron: { selectie: 'uit de selectie', pastbij: '"past bij"-keten', library: 'de hele library' }[bron] });
  wijzig(() => ({ ...staat.plan, uitleg: staat.plan.uitleg || r.plan.uitleg, stappen: r.plan.stappen }));
  wisLater(melding(`set: ${r.plan.stappen.length} nummers, ~${mmss(r.totaal)}${r.meldingen.length ? ` — ${r.meldingen.join('; ')}` : ''} (ctrl+z = terug)`), 10000);
});

$('.pl-auto-tracks').addEventListener('change', (e) => {
  const lijst = String(e.target.value).split(/[\s,;]+/).filter(Boolean).map(Number);
  if (lijst.some((n) => !Number.isInteger(n) || n < 1 || n > 8)) { melding('tracks van de automaat: nummers 1–8, bv. 1,2'); render(); return; }
  wijzig({ soort: 'tracks', tracks: normaliseerTracks({ auto: lijst }) });
});

// ---- lagen van de gekozen stap -------------------------------------------------------------
function tekenLagen() {
  const el = $('.pl-lagen .lijst');
  const s0 = staat.plan.stappen.find((x) => x.id === staat.gekozen);
  el.replaceChildren();
  if (!s0) { el.innerHTML = '<span class="pl-info">kies een stap</span>'; return; }
  if (!s0.lagen?.length) { el.innerHTML = '<span class="pl-info">geen lagen</span>'; return; }
  for (const l of s0.lagen) {
    const r = document.createElement('div');
    r.className = 'pl-laag';
    r.innerHTML = `<span title="${esc(laagTekst(l))}">${esc(laagTekst(l))}</span><button class="pl-weg" title="weg">✕</button>`;
    r.querySelector('button').addEventListener('click', () => wijzig({ soort: 'zet', id: s0.id, velden: { lagen: s0.lagen.filter((x) => x.id !== l.id) } }));
    el.append(r);
  }
}
$('.pl-laag-erbij').addEventListener('click', () => {
  const s0 = staat.plan.stappen.find((x) => x.id === staat.gekozen);
  if (!s0) { melding('kies eerst een stap'); return; }
  const soort = $('.pl-laag-soort').value;
  const opT = $('.pl-laag-op').value.trim();
  let op;
  if (/^\d{1,2}$/.test(opT)) {
    const k = Number(opT), x = staat.secties.get(s0.track)?.stukken?.[k - 1];
    op = { sectie: k, label: x?.label ?? null, groep: x?.groep ?? null, ...(x ? { sec: Math.max(0, x.van - (s0.van ?? 0)) } : {}) };
  } else {
    const t = leesTijd(opT);
    if (t === undefined || t === null) { melding('laag: "op" is een sectienummer (bv. 3) of een tijd in de stap (m:ss)'); return; }
    op = { sec: t };
  }
  const deck = Number($('.pl-laag-deck').value) || null;
  const nr = Number($('.pl-laag-nr').value) || null;
  const duur = Number(String($('.pl-laag-duur').value).replace(',', '.')) || null;
  let laag;
  if (soort === 'nummer') {
    const gekozen = [...staat.selectie].at(-1);
    if (!gekozen) { melding('laag: vink rechts het nummer aan dat erbij moet (het laatst aangevinkte telt)'); return; }
    laag = { soort, track: gekozen, op, deck, stem: $('.pl-laag-stem').value || null, duur, start: $('.pl-laag-start').value };
  } else if (soort === 'sampler') laag = { soort, pad: nr, op };
  else laag = { soort, deck, plek: nr, op };
  const voor = s0.lagen?.length ?? 0;
  wijzig({ soort: 'zet', id: s0.id, velden: { lagen: [...(s0.lagen || []), laag] } });
  const na = staat.plan.stappen.find((x) => x.id === s0.id)?.lagen?.length ?? 0;
  if (na === voor) melding('laag niet toegevoegd: sampler vraagt een pad (1–8), patroon een track van jou en een plek (1–5)');
});

// ---- sets ----------------------------------------------------------------------------------
const mixerSets = () => { try { return window.opener && !window.opener.closed ? window.opener.varveSets ?? null : null; } catch (_) { return null; } };
async function haalSets() {
  try {
    const m = mixerSets();
    if (m) { await m.ververs(); staat.sets = m.st.lijst; }
    else { const r = await fetch('/api/sets'); staat.sets = r.ok ? (await r.json()).sets : []; }
  } catch (_) { /* later nog eens */ }
  tekenSets();
}
function tekenSets() {
  const el = $('.pl-sets .lijst');
  el.replaceChildren();
  if (!staat.sets.length) { el.innerHTML = '<span class="pl-info">nog geen sets: geef een naam en bewaar</span>'; return; }
  for (const x of staat.sets) {
    const r = document.createElement('div');
    r.className = x.naam === staat.gekozenSet ? 'gekozen' : '';
    const datum = x.gewijzigd ? new Date(x.gewijzigd).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    r.textContent = `${x.naam} · ${datum} · ${x.nummers} nrs${x.duur ? ` · ${mmss(x.duur)}` : ''}${x.moment ? ' · mixer' : ''}${x.kapot ? ' · kapot' : ''}`;
    r.title = x.uitleg || x.naam;
    r.addEventListener('click', () => { staat.gekozenSet = x.naam; $('.pl-set-naam').value = x.naam; const m = mixerSets(); if (m) m.st.gekozen = x.naam; tekenSets(); });
    el.append(r);
  }
}
$('.pl-set-moment').addEventListener('change', (e) => mixerSets()?.zetMetMoment(e.target.checked));
$('.pl-set-bewaar').addEventListener('click', async () => {
  const naam = $('.pl-set-naam').value.trim() || staat.gekozenSet;
  if (!naam || !/^[a-z0-9_-]{1,60}$/.test(naam)) { melding('een setnaam is kleine letters, cijfers, - en _'); return; }
  if (gewijzigd()) await opslaan();
  if (gewijzigd()) return;
  const m = mixerSets();
  if (!m) { melding('open dit venster via de knop "plan" in de mixer om een set te bewaren (de patronen, de werkruimte en de mixer zitten daar)'); return; }
  const r = await m.bewaar(naam, { metMoment: $('.pl-set-moment').checked });
  if (r.ok) { staat.gekozenSet = naam; wisLater(melding(`set "${naam}" bewaard`), 4000); }
  haalSets();
});
let laadKnopTimer = null;
$('.pl-set-laad').addEventListener('click', async () => {
  const naam = staat.gekozenSet || $('.pl-set-naam').value.trim();
  const m = mixerSets();
  if (!m) { melding('open dit venster via de knop "plan" in de mixer om een set terug te laden'); return; }
  if (gewijzigd() && !window.confirm('Er zijn niet-opgeslagen wijzigingen in dit plan. Toch een set terugladen?')) return;
  const r = await m.terugladen(naam, { metMoment: $('.pl-set-moment').checked });
  const b = $('.pl-set-laad');
  if (r.vraag) {
    b.classList.add('vraag'); b.textContent = 'zeker?';
    clearTimeout(laadKnopTimer);
    laadKnopTimer = setTimeout(() => { b.classList.remove('vraag'); b.textContent = 'laad'; }, 3000);
    melding('er speelt een track: klik binnen 3 s nog eens om de set met de mixer terug te laden');
    return;
  }
  b.classList.remove('vraag'); b.textContent = 'laad';
  if (r.ok) { await laad(naam); await vulKiezer(); wisLater(melding(`set "${naam}" teruggeladen: plan "${naam}" is actief${r.ontbreekt?.length ? `, ${r.ontbreekt.length} nummers ontbreken` : ''}; er speelt niets`), 8000); }
});
$('.pl-set-kopie').addEventListener('click', async () => {
  const naar = $('.pl-set-naam').value.trim(), m = mixerSets();
  if (!staat.gekozenSet || !naar || naar === staat.gekozenSet) { melding('kies een set en typ links een nieuwe naam'); return; }
  if (m) await m.kopie(staat.gekozenSet, naar);
  else await fetch(`/api/sets/${staat.gekozenSet}/kopie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naar }) });
  staat.gekozenSet = naar; haalSets();
});
$('.pl-set-hernoem').addEventListener('click', async () => {
  const naar = $('.pl-set-naam').value.trim(), m = mixerSets();
  if (!staat.gekozenSet || !naar || naar === staat.gekozenSet) { melding('kies een set en typ links de nieuwe naam'); return; }
  if (!m) { melding('hernoemen gaat via de mixer (open dit venster met de knop "plan")'); return; }
  const r = await m.hernoem(staat.gekozenSet, naar);
  if (r.ok) staat.gekozenSet = naar;
  haalSets();
});

// ---- de live-balk: NU / VOLGENDE / DAARNA, de verwachte eindtijd ------------------------------
let liveLees = 0, liveBezig = false;
function tekenLive(k, s) {
  const m = mixerSets();
  const zet = (sel, t) => { const el = $(sel); if (el.textContent !== t) el.textContent = t; };
  $('.pl-livebalk .buiten').hidden = !s.buiten;
  $('.pl-buiten-knop').classList.toggle('on', !!s.buiten);
  $('.pl-go-knop').classList.toggle('on', !!s.volgende?.go?.wacht);
  const n = Date.now();
  if (!m?.live || liveBezig || n - liveLees < 400) return;
  liveBezig = true;
  liveLees = n;
  m.live(n).then((l) => {
    zet('.pl-livebalk .nu', l.tekst.nu);
    zet('.pl-livebalk .volg', l.tekst.volgende);
    zet('.pl-livebalk .daarna', l.tekst.daarna);
    zet('.pl-livebalk .laag', l.tekst.laag);
    zet('.pl-livebalk .eind', l.tekst.eind);
    window.varvePlanLive = l;
  }).catch(() => {}).finally(() => { liveBezig = false; });
}

// ---- start --------------------------------------------------------------------------------

(async () => {
  try {
    const k = koppeling();
    const q = new URLSearchParams(location.search).get('plan');
    staat.bieb = await haalBieb();
    staat.tracks = new Map(staat.bieb.map((t) => [t.id, t]));
    await laad(q || k?.naam?.() || 'auto-plan');
    await vulKiezer();
    vulKratten();
    haalSets();
    setInterval(kijkServer, 3000);
    setInterval(haalSets, 10000);
    requestAnimationFrame(lus);
    window.varvePlanVenster = staat;           // voor de console en de headless proef
  } catch (err) {
    console.error('[plan]', err);
    melding(`het plan kon niet laden: ${err.message}`);
  }
})();
