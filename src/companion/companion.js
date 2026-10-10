import { esc } from '../ui/dom.js';
import {
  filterKnoppenHtml, wisselFilter, kaartUrl, wensTelling, wensTellingTekst, nachtStandTekst, speeldagenTekst,
  effectieveSortering, sorteringBijKrat, STANDAARD_SORTERING,
} from '../ui/kaart-lijst.js';
import * as L from './companion-lijst.js';

/*
 * De companion (companion.html, docs/COMPANION.md): de pagina voor iPad en
 * iPhone. Het rekenwerk staat in companion-lijst.js (puur, getest); hier alleen
 * het scherm, de verzoeken en de timers.
 *
 * Grenzen: alleen fetch naar /api/… en /mappings/companion.json. Geen geluid,
 * geen MIDI, geen tabblad-slot (test/regels-companion.test.mjs volgt de hele
 * importboom). Stuurt nooit "meteen", "bevestig" of "zoek", haalt nooit iets
 * weg. "Haal nu" gaat via POST /api/nacht/nu: de server weigert zelf op een
 * speeldag en als er een deck speelt.
 */

const $ = (id) => document.getElementById(id);
const opslag = (() => { try { return window.localStorage; } catch { return null; } })();

const st = {
  config: L.STANDAARD_CONFIG,
  tab: 'nu',
  pins: L.leesPins(opslag),
  server: null,              // true | false: lukte het laatste verzoek?
  mixer: undefined,          // antwoord van GET /api/mixer, { ontbreekt }, { fout }, null (weg); undefined = nog niet gevraagd
  kaart: null,               // GET /api/kaart
  wensen: [],                // GET /api/kaart/wensen
  kandidaten: new Map(),     // sleutel -> kandidaten (wens op `kies`)
  nacht: null,               // GET /api/nacht
  zoek: '', krat: '', filters: [],
  rijen: [], totaal: 0, pagina: 0, vraag: 0, lijstFout: null,
  bezig: new Set(),          // sleutels waarvoor een verzoek loopt
  open: null,                // sleutel met de kieslijst open
};
const PAGINA = L.paginaUitUrl(location.search);
const meldingen = [];        // de laatste meldingen (ook voor de headless-proef)
window.companion = { klaar: false, st, meldingen };

function meld(tekst, soort = '') {
  meldingen.push({ tekst, soort });
  if (meldingen.length > 20) meldingen.shift();
  const el = document.createElement('div');
  el.className = `melding ${soort}`;
  el.textContent = tekst;
  $('meldingen').append(el);
  setTimeout(() => el.remove(), soort === 'fout' ? 8000 : 4500);
}

// ---- verzoeken ------------------------------------------------------------------

/*
 * Een trage telefoon of een hotspot: elk verzoek geeft het na WACHT_MS op. Eigen
 * AbortController met een timer (AbortSignal.timeout bestaat pas sinds iOS 16).
 */
const WACHT_MS = 6000;
const RUST_MS = 60000;       // een route die 404 of een fout gaf: hooguit eens per minuut opnieuw
const rustTot = new Map();

function metTijd(ms) {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, klaar: () => clearTimeout(id) };
}

/** { status, ok, j } of een fout (netwerk, tijd op). Zet st.server. */
async function haal(pad, init = {}) {
  const t = metTijd(WACHT_MS);
  try {
    const r = await fetch(pad, { cache: 'no-store', ...init, signal: t.signal });
    const j = await r.json().catch(() => null);
    zetServer(true);
    return { status: r.status, ok: r.ok, j };
  } catch (err) {
    zetServer(false);
    throw err;
  } finally { t.klaar(); }
}

const post = (pad, body) => haal(pad, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Een route die een oudere server misschien niet kent: { data } / { ontbreekt } / { fout } / null; undefined = in rust. */
async function haalLos(pad) {
  if (Date.now() < (rustTot.get(pad) ?? 0)) return undefined;
  try {
    const r = await haal(pad);
    if (r.ok) { rustTot.delete(pad); return { data: r.j }; }
    rustTot.set(pad, Date.now() + RUST_MS);
    return r.status === 404 ? { ontbreekt: true } : { fout: r.status };
  } catch { return null; }
}

function zetServer(aan) {
  if (st.server === aan) return;
  st.server = aan;
  const el = $('verbinding');
  el.textContent = aan ? location.host : 'server niet bereikbaar';
  el.classList.toggle('fout', !aan);
}

// ---- tabs ----------------------------------------------------------------------------

function zetTab(tab) {
  if (!st.config.tabs.includes(tab)) return;
  st.tab = tab;
  document.body.dataset.tab = tab;
  for (const b of document.querySelectorAll('.onderbalk button')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  L.bewaarTab(opslag, tab);
}

function pasConfigToe() {
  for (const tab of L.TABS) {
    const aan = st.config.tabs.includes(tab);
    $(tab).hidden = !aan;
    document.querySelector(`.onderbalk button[data-tab="${tab}"]`).hidden = !aan;
  }
  zetTab(L.leesTab(opslag, st.config.tabs));
}

// ---- nu en beeld ------------------------------------------------------------------------

let peilt = false;
async function peilMixer() {
  if (peilt) return;
  peilt = true;
  try {
    const a = await haalLos('/api/mixer');
    if (a === undefined) return;                       // in rust na een 404: houd wat er staat
    st.mixer = a?.data ?? (a?.ontbreekt ? { ontbreekt: true } : a?.fout ? { fout: a.fout } : null);
    tekenNu();
  } finally { peilt = false; }
}

function tekenNu() {
  $('nu-inhoud').innerHTML = L.nuHtml(st.mixer);
  const eind = st.mixer?.melding?.eind ?? null;
  $('beeld-inhoud').innerHTML = L.beeldHtml(eind);
}

// ---- de wenslijst en de nacht ----------------------------------------------------------

async function leesWensenEnNacht() {
  const [w, n] = await Promise.allSettled([haal('/api/kaart/wensen'), haal('/api/nacht')]);
  if (w.status === 'fulfilled' && w.value.ok) {
    st.wensen = w.value.j?.wensen ?? [];
    st.kandidaten = L.kandidatenPerSleutel(st.wensen);
    // Wat de laptop of de nacht intussen deed (zoeken → kies, binnen → klaar): alleen die rijen opnieuw.
    const { rijen, veranderd } = L.pasWensenToe(st.rijen, st.wensen);
    if (veranderd.length) {
      st.rijen = rijen;
      for (const s of veranderd) if (!st.bezig.has(s)) tekenRij(s);
    }
  }
  if (n.status === 'fulfilled' && n.value.ok) st.nacht = n.value.j;
  tekenWenslijst();
}

function tekenWenslijst() {
  $('wens-telling').textContent = wensTellingTekst(wensTelling(st.wensen));
  const n = st.nacht;
  $('nacht-stand').textContent = n ? `${nachtStandTekst(n, Date.parse(n.nu) || Date.now())} · speeldagen: ${speeldagenTekst(n.speeldagen, n.nu)}` : '';
  const knop = L.haalNuKnop(L.wachtAantal(st.wensen), n);
  const haalNu = $('haal-nu');
  haalNu.textContent = knop.tekst;
  haalNu.disabled = !knop.kan || !n;
  haalNu.dataset.aantal = String(knop.aantal);
  const dag = L.speeldagKnopTekst(n);
  $('speeldag').hidden = !dag;
  if (dag) $('speeldag').textContent = dag;
}

async function haalNu() {
  const aantal = Number($('haal-nu').dataset.aantal) || 1;
  const knop = $('haal-nu');
  knop.disabled = true;
  try {
    const r = await post('/api/nacht/nu', { aantal });
    if (r.status === 202) { st.nacht = r.j; meld(`run gestart (${aantal})`, 'goed'); }
    else meld(r.j?.fout || `haal nu: fout ${r.status}`, 'fout');
  } catch { meld('haal nu: de server antwoordt niet', 'fout'); }
  await leesWensenEnNacht().catch(() => {});
}

async function speeldagErbij() {
  const knop = $('speeldag');
  knop.disabled = true;
  try {
    // Vlak ervoor opnieuw lezen: de laptop kan de lijst intussen veranderd hebben.
    const vers = await haal('/api/nacht');
    if (!vers.ok) throw new Error(vers.j?.fout || String(vers.status));
    if (!L.speeldagKnopTekst(vers.j)) { st.nacht = vers.j; meld('vandaag stond al als speeldag'); return; }
    const r = await post('/api/nacht', L.speeldagErbij(vers.j));
    if (r.ok) { st.nacht = r.j; meld('vandaag is nu een speeldag: niets binnenhalen tot morgen', 'goed'); }
    else meld(r.j?.fout || `speeldag: fout ${r.status}`, 'fout');
  } catch (err) { meld(`speeldag: ${err.message || 'de server antwoordt niet'}`, 'fout'); }
  finally { knop.disabled = false; tekenWenslijst(); }
}

// ---- de kaart -----------------------------------------------------------------------------

async function leesKaart() {
  try {
    const r = await haal('/api/kaart');
    st.kaart = r.ok ? r.j : null;
  } catch { st.kaart = null; }
  tekenKratten();
}

function tekenKratten() {
  const kratten = st.kaart?.kratten ?? [];
  if (st.krat && !kratten.some((k) => k.id === st.krat)) st.krat = '';
  $('krat').innerHTML = L.kratOptiesCompanionHtml(kratten, st.krat, st.kaart?.aantal ?? null,
    { pins: st.pins, config: st.config.kaart.kratten_bovenaan });
  const ster = $('ster');
  ster.disabled = !st.krat;
  const vast = !!st.krat && st.pins.includes(st.krat);
  ster.setAttribute('aria-pressed', String(vast));
  ster.textContent = vast ? '★' : '☆';
  $('filters').innerHTML = filterKnoppenHtml(st.filters);
}

function sortering() {
  return effectieveSortering(sorteringBijKrat(STANDAARD_SORTERING, st.krat), st.krat);
}

async function laadLijst({ meer = false } = {}) {
  const nr = ++st.vraag;
  const pagina = meer ? st.pagina + 1 : 0;
  if (!meer) { st.open = null; }
  $('opnieuw').hidden = true;
  $('lijst-stand').textContent = 'laden…';
  try {
    const r = await haal(kaartUrl({ zoek: st.zoek, krat: st.krat, filters: st.filters, ...sortering() }, pagina, PAGINA));
    if (nr !== st.vraag) return;                       // intussen een nieuwere vraag
    if (!r.ok) throw new Error(r.j?.fout || `fout ${r.status}`);
    st.rijen = meer ? [...st.rijen, ...(r.j.nummers ?? [])] : (r.j.nummers ?? []);
    st.totaal = r.j.totaal ?? st.rijen.length;
    st.pagina = pagina;
    st.lijstFout = null;
  } catch (err) {
    if (nr !== st.vraag) return;
    st.lijstFout = err.name === 'AbortError' ? 'de server antwoordt niet' : (err.message || 'mislukt');
  }
  tekenLijst();
}

function rijHtml(n) {
  return L.rijHtml(n, { kandidaten: st.kandidaten.get(n.sleutel) ?? null, open: st.open === n.sleutel, bezig: st.bezig.has(n.sleutel) });
}

function tekenLijst() {
  if (st.lijstFout) {
    $('lijst-stand').textContent = `de lijst kwam niet: ${st.lijstFout}`;
    $('opnieuw').hidden = false;
  } else if (st.kaart && st.kaart.status !== 'geladen') {
    $('lijst-stand').textContent = `kaart ${st.kaart.status}${st.kaart.fout ? `: ${st.kaart.fout}` : ''}`;
  } else {
    $('lijst-stand').textContent = st.totaal === st.rijen.length ? `${st.totaal} nummers` : `${st.rijen.length} van ${st.totaal}`;
  }
  $('lijst').innerHTML = st.rijen.map(rijHtml).join('');
  $('meer').hidden = !!st.lijstFout || st.rijen.length >= st.totaal;
}

function tekenRij(sleutel) {
  const n = st.rijen.find((x) => x.sleutel === sleutel);
  const li = [...$('lijst').children].find((x) => x.dataset.sleutel === sleutel);
  if (n && li) li.outerHTML = rijHtml(n);
}

/** Eén rij opnieuw van de server (na een wens of een keuze). */
async function verversRij(sleutel) {
  try {
    const r = await haal(`/api/kaart/nummer/${encodeURIComponent(sleutel)}`);
    if (r.ok && r.j?.nummer) {
      const i = st.rijen.findIndex((x) => x.sleutel === sleutel);
      if (i >= 0) st.rijen[i] = r.j.nummer;
    }
  } catch { /* de rij blijft zoals hij was */ }
  tekenRij(sleutel);
}

async function wens(sleutel) {
  st.bezig.add(sleutel);
  tekenRij(sleutel);
  try {
    const r = await post('/api/kaart/wens', { sleutels: [sleutel] });
    if (r.ok) {
      if (!st.nacht) await leesWensenEnNacht().catch(() => {});
      const u = L.wensGevolgTekst(r.j, st.nacht);
      meld(u.tekst, u.goed ? 'goed' : 'fout');
    } else meld(r.j?.fout || `wens: fout ${r.status}`, 'fout');
  } catch { meld('wens: de server antwoordt niet', 'fout'); }
  st.bezig.delete(sleutel);
  await Promise.all([verversRij(sleutel), leesWensenEnNacht().catch(() => {})]);
}

async function kies(sleutel, youtube_id) {
  const kandidaat = (st.kandidaten.get(sleutel) ?? []).find((k) => k.youtube_id === youtube_id);
  st.bezig.add(sleutel);
  st.open = null;
  tekenRij(sleutel);
  try {
    const r = await post(`/api/kaart/nummer/${encodeURIComponent(sleutel)}/kies`, { youtube_id });
    if (r.ok) meld(`gekozen: ${kandidaat?.titel || youtube_id} · staat op de wenslijst`, 'goed');
    else meld(r.j?.fout || `kies: fout ${r.status}`, 'fout');
  } catch { meld('kies: de server antwoordt niet', 'fout'); }
  st.bezig.delete(sleutel);
  await leesWensenEnNacht().catch(() => {});
  await verversRij(sleutel);
}

// ---- bediening ------------------------------------------------------------------------------

let zoekTimer = null;
function bind() {
  document.querySelector('.onderbalk').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) zetTab(b.dataset.tab);
  });
  $('zoek').addEventListener('input', () => {
    clearTimeout(zoekTimer);
    zoekTimer = setTimeout(() => { st.zoek = $('zoek').value.trim(); laadLijst(); }, 300);
  });
  $('zoek').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(zoekTimer); st.zoek = $('zoek').value.trim(); laadLijst(); $('zoek').blur(); } });
  $('krat').addEventListener('change', () => { st.krat = $('krat').value; tekenKratten(); laadLijst(); });
  $('ster').addEventListener('click', () => {
    if (!st.krat) return;
    st.pins = L.wisselPin(opslag, st.pins, st.krat);
    tekenKratten();
  });
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    st.filters = wisselFilter(st.filters, b.dataset.filter);
    tekenKratten();
    laadLijst();
  });
  $('meer').addEventListener('click', () => laadLijst({ meer: true }));
  $('opnieuw').addEventListener('click', () => laadLijst());
  $('haal-nu').addEventListener('click', () => haalNu());
  $('speeldag').addEventListener('click', () => speeldagErbij());
  $('lijst').addEventListener('click', (e) => {
    const w = e.target.closest('[data-wens]');
    if (w) { if (!st.bezig.has(w.dataset.wens)) wens(w.dataset.wens); return; }
    const o = e.target.closest('[data-kies-open]');
    if (o) { const s = o.dataset.kiesOpen; const vorige = st.open; st.open = st.open === s ? null : s; if (vorige && vorige !== s) tekenRij(vorige); tekenRij(s); return; }
    const k = e.target.closest('[data-kies]');
    if (k) { if (!st.bezig.has(k.dataset.id)) kies(k.dataset.id, k.dataset.kies); return; }
    const d = e.target.closest('[data-kies-sluit]');
    if (d) { st.open = null; tekenRij(d.dataset.kiesSluit); }
  });
}

// ---- de klok: peilen zolang de pagina zichtbaar is ---------------------------------------

let peilId = null, wensId = null;
function startPeilen() {
  if (peilId) return;
  peilMixer();
  peilId = setInterval(peilMixer, L.PEIL_MS);
  wensId = setInterval(() => leesWensenEnNacht().catch(() => {}), 5000);
}
function stopPeilen() {
  clearInterval(peilId); clearInterval(wensId);
  peilId = wensId = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { startPeilen(); leesWensenEnNacht().catch(() => {}); } else stopPeilen();
});

async function start() {
  if (!$('kaart')) return;                             // te oud apparaat: het voorproef-script heeft de pagina al vervangen
  try {
    const r = await haal('/mappings/companion.json');
    if (r.ok) {
      const { config, fouten } = L.leesConfig(r.j);
      st.config = config;
      for (const f of fouten) meld(`companion.json: ${f}`, 'fout');
    }
  } catch { /* standaard */ }
  pasConfigToe();
  bind();
  tekenNu();
  tekenKratten();
  if (document.visibilityState !== 'hidden') startPeilen();
  await Promise.all([leesKaart(), leesWensenEnNacht().catch(() => {})]);
  await laadLijst();
  window.companion.klaar = true;
}

start().catch((err) => meld(`companion: ${err?.message || err}`, 'fout'));
