/**
 * werk.html?s=<scherm>: de paneelpagina (werkruimte S7, docs/WERKRUIMTE.md A5 en C4,
 * docs/werkruimte/S7.md). Toont de VAKKEN die de werkruimte in het actieve deel op dit scherm
 * zet (`delen.<deel>.schermen.<s>.vakken`) en volgt het deel:
 *   uitlijn…      de uitlijnweergave (src/uitlijn/teken.js) uit de segmenten
 *   paneel:<id>   een vrij paneel uit `panelen` (src/paneel/vrij.js)
 *   kaart         per apparaat wat elke knop in het open mapje nu doet (src/paneel/kaart.js)
 *   stand         wat er speelt: per track nummer, titel, bpm, tijd
 *   secties       de secties van de focus-track, de sectie die je hoort gemarkeerd
 *
 * Twee manieren (src/paneel/verbinding.js): als VENSTER van de mixer (mac-2, window.opener,
 * mag bedienen) of via de server (de iPad: alleen kijken). GEEN AudioContext, GEEN MIDI, GEEN
 * Web Lock (test/regels-werk.test.mjs volgt de hele importboom). Clay bepaalt wat er staat en
 * waar: dit is het mechaniek, de indeling is data in de werkruimte.
 *
 * Als podiumapparaat (de iPad): schermvullend vanaf het beginscherm (werk.webmanifest), het
 * scherm blijft wakker (Screen Wake Lock, opnieuw bij visibilitychange), geen zoom of scroll
 * bij tikken (touch-action), meerdere vingers (pointer events per pointerId, in vrij.js),
 * herverbinden bij visibilitychange en online, en een grote rode balk "geen verbinding".
 */
import { maakVerbinding } from './verbinding.js';
import { maakSchrijver, wie, koppel } from './schrijver.js';
import { itemVoor } from '../werk/inrichten.js';
import { VrijPaneel, bouwsteenDef } from './vrij.js';
import { KaartWeergave } from './kaart.js';
import { vakSoort } from './protocol.js';
import { UitlijnWeergave, vakVorm } from '../uitlijn/teken.js';
import { hexVan, tekstOp, kleurVanDeel } from '../werk/kleuren.js';
import { leesZoekregel, filterNaarQuery } from '../library/indeling.js';

const PLEK = 'varve.scherm.';
const vraag = new URLSearchParams(location.search);
const heeftOpener = (() => { try { return !!window.opener && !window.opener.closed; } catch (_) { return false; } })();
const scherm = /^[a-z0-9-]{1,24}$/.test(vraag.get('s') ?? '') ? vraag.get('s') : (heeftOpener ? 'mac-2' : 'ipad');

const verb = maakVerbinding({ scherm });
verb.start();

const $ = (id) => document.getElementById(id);
const kop = { deel: $('wp-deel'), naam: $('wp-naam'), scherm: $('wp-scherm'), soort: $('wp-soort'), status: $('wp-status') };
const balk = $('wp-balk');
const vakkenEl = $('wp-vakken');
const leegEl = $('wp-leeg');
const zet = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const toon = (el, aan) => { if (el && el.hidden === aan) el.hidden = !aan; };
document.title = `VARVE — ${scherm}`;
zet(kop.scherm, scherm);
zet(kop.soort, verb.kanBedienen ? 'bedient' : 'kijkt');
document.body.classList.toggle('wp-kijkt', !verb.kanBedienen);

// ---- de vakken -------------------------------------------------------------------------------
let vakken = [];       // [{ naam, stap(), stop() }]
let sleutel = null;

function bouwVak(naam, w) {
  const { soort, id } = vakSoort(naam);
  const el = document.createElement('section');
  el.className = `wp-vak wp-vak-${soort ?? 'onbekend'}`;
  el.dataset.vak = naam;
  vakkenEl.appendChild(el);
  const titel = (t) => { const h = document.createElement('div'); h.className = 'wp-vak-kop'; h.textContent = t; el.appendChild(h); };
  if (soort === 'uitlijn') {
    const v = vakVorm(naam) ?? { vorm: 'pagina', maten: 2 };
    const plek = document.createElement('div');
    el.appendChild(plek);
    const weergave = new UitlijnWeergave(plek, {
      vorm: v.vorm, maten: v.maten,
      invoer: () => verb.invoer(),
      // Slepen = duwen: alleen als venster van de mixer (mac-2). Op de iPad is de uitlijn geen paneel:
      // de mixer zou het weigeren (S8: alleen wat in de panelen van dit scherm staat).
      invoke: verb.soort === 'opener' ? (a, x) => verb.invoke(a, x) : null,
      metaOf: (a) => verb.metaOf(a), read: (a) => verb.read(a),
    });
    return { naam, el, stap: () => weergave.stap(), stop: () => { weergave.vernietig(); el.remove(); }, weergave };
  }
  if (soort === 'paneel') {
    const def = w?.panelen?.[id];
    if (!def) { titel(`paneel "${id}" staat niet in de werkruimte`); return { naam, el, stap() {}, stop: () => el.remove() }; }
    const p = new VrijPaneel(el, def, verb, { modus: 'los', id });
    return { naam, el, stap: () => p.teken(), stop: () => { p.vernietig(); el.remove(); }, paneel: p };
  }
  if (soort === 'kaart') {
    const k = new KaartWeergave(el);
    return { naam, el, stap: () => k.toon(verb.kaart()), stop: () => { k.vernietig(); el.remove(); } };
  }
  if (soort === 'bouwsteen') {
    // Spoor S9: de set (plan, sets) krijgt de live-stand boven zijn knoppen.
    const set = /^(plan|sets)$/.test(naam) ? setVak(naam, el) : null;
    const def = bouwsteenDef(naam, { bestaat: (a) => !!verb.metaOf(a), vars: verb.vars() });
    const p = new VrijPaneel(el, def, verb, { modus: 'los', id: naam });
    return { naam, el, stap: () => { set?.stap(); p.teken(); }, stop: () => { set?.stop(); p.vernietig(); el.remove(); }, paneel: p };
  }
  if (soort === 'library') return libraryVak(naam, el);
  if (soort === 'stand') return standVak(naam, el);
  if (soort === 'secties') return sectiesVak(naam, el);
  titel(`vak "${naam}" ken ik niet`);
  return { naam, el, stap() {}, stop: () => el.remove() };
}

const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–');
const bpmT = (b) => (Number.isFinite(b) ? b.toFixed(2).replace('.', ',') : '–');

/**
 * De library als vak: zoeken en de lijst (GET /api/library, alleen lezen). Als VENSTER van de mixer
 * staan er laadknoppen 1–8 bij (via de mixer, met de tweede druk over een spelende track); op de
 * iPad niet (laden staat in VAST_NOOIT: nooit van buiten de Mac).
 * Spoor S11 (docs/LIBRARY-TAGS.md): een keuzelijst met de categorieën, en het zoekveld leest de
 * zoekregel (#tag -#tag @categorie bpm:70-90 toon:8A grid:zeker stems energie:hoog). Taggen gaat hier
 * niet (geen nummer-id op de bus): daarvoor is de bouwsteen `tags` (het nummer op de track).
 */
function libraryVak(naam, el) {
  const kop = document.createElement('div');
  kop.className = 'wp-lib-kop';
  const zoek = document.createElement('input');
  zoek.type = 'search'; zoek.placeholder = 'zoeken, #tag, @categorie, bpm:70-90'; zoek.className = 'wp-lib-zoek';
  const cat = document.createElement('select');
  cat.className = 'wp-lib-cat'; cat.title = 'een categorie (gewoon: op zijn volgorde)';
  cat.innerHTML = '<option value="">alles</option>';
  kop.append(zoek, cat);
  el.appendChild(kop);
  const lijst = document.createElement('div');
  lijst.className = 'wp-lib';
  el.appendChild(lijst);
  let bezig = false, vraag = null, timer = null, gestopt = false, gehaald = null, stand = { categorieen: [], tags: [] };
  const sleutelNu = () => `${zoek.value.trim()}|${cat.value}`;
  async function haalStand() {
    try {
      const r = await fetch('/api/indeling/stand', { cache: 'no-store' });
      if (!r.ok) { await r.text().catch(() => {}); return; }
      stand = await r.json();
      const nu = cat.value;
      cat.innerHTML = '<option value="">alles</option>' + stand.categorieen.map((c) => `<option value="${c.id}">${c.soort === 'slim' ? '✦ ' : ''}${escHtml(c.naam)} (${c.aantal ?? '?'})</option>`).join('');
      cat.value = stand.categorieen.some((c) => String(c.id) === nu) ? nu : '';
    } catch (_) { /* een oudere server: geen indeling */ }
  }
  async function haal() {
    if (bezig || gestopt) return;
    bezig = true;
    gehaald = sleutelNu();
    try {
      const { filter } = leesZoekregel(zoek.value.trim(), { categorieen: stand.categorieen });
      if (cat.value) filter.categorie = Number(cat.value);
      const c = stand.categorieen.find((x) => x.id === filter.categorie);
      const plek = c && (c.soort === 'gewoon' || c.regel?.categorie != null);
      const q = filterNaarQuery(filter, new URLSearchParams({ sorteer: plek ? 'plek' : 'toegevoegd', van: '0', aantal: '200' }));
      const r = await fetch(`/api/library?${q}`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!gestopt) teken(r.ok ? d?.tracks ?? [] : [], r.ok ? null : d?.fout);
    } catch (_) { /* de rode balk zegt het al */ } finally {
      bezig = false;
      // Intussen verder getypt: nog eens, met de zoekvraag van nu.
      if (!gestopt && sleutelNu() !== gehaald) haal();
    }
  }
  function teken(tracks, fout = null) {
    lijst.replaceChildren();
    if (!tracks.length) { const p = document.createElement('div'); p.className = 'wp-dim'; p.textContent = fout || 'niets gevonden'; lijst.appendChild(p); return; }
    for (const t of tracks) {
      const rij = document.createElement('div');
      rij.className = 'wp-lib-rij';
      const titel = document.createElement('span'); titel.className = 'wp-lib-titel';
      titel.textContent = [t.artiest, t.titel ?? t.title].filter(Boolean).join(' — ') || t.id;
      if (t.tags?.length) { const g = document.createElement('small'); g.className = 'wp-lib-tags'; g.textContent = ` ${t.tags.map((x) => `#${x}`).join(' ')}`; titel.appendChild(g); }
      const bpm = document.createElement('span'); bpm.className = 'wp-bpm';
      bpm.textContent = bpmT(t.grid_bpm ?? t.bpm);
      rij.append(titel, bpm);
      if (verb.kanBedienen && verb.laad) {
        const knoppen = document.createElement('span'); knoppen.className = 'wp-lib-laad';
        for (let n = 1; n <= 8; n++) {
          const b = document.createElement('button'); b.className = 'wp-lib-knop'; b.textContent = String(n);
          b.title = `laden op track ${n}`;
          b.addEventListener('click', () => {
            const u = verb.laad(n, t);
            if (u?.vraag) { b.classList.add('vraag'); b.textContent = '?'; clearTimeout(vraag); vraag = setTimeout(() => { b.classList.remove('vraag'); b.textContent = String(n); }, 3000); }
            else { b.classList.remove('vraag'); b.textContent = String(n); }
          });
          knoppen.appendChild(b);
        }
        rij.appendChild(knoppen);
      }
      lijst.appendChild(rij);
    }
  }
  zoek.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(haal, 250); });
  cat.addEventListener('change', () => haal());
  const standTimer = setInterval(haalStand, 30000);
  haalStand().then(haal);
  return { naam, el, stap() {}, stop: () => { gestopt = true; clearTimeout(timer); clearTimeout(vraag); clearInterval(standTimer); el.remove(); } };
}

const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * De live-stand van de set (spoor S9, docs/PLAN-SET.md §4) boven de knoppen van de bouwsteen
 * `plan` of `sets`. Als venster van de mixer (mac-2) van window.opener.varveSets.live(); op de
 * iPad van GET /api/set/live (de mixer zendt hem zolang er iemand kijkt). Hooguit 2× per seconde,
 * alleen tekst die verandert.
 */
function setVak(naam, el) {
  const blok = document.createElement('div');
  blok.className = 'wp-set';
  el.appendChild(blok);
  const regels = naam === 'plan' ? ['buiten', 'nu', 'volgende', 'daarna', 'laag', 'eind'] : ['gekozen', 'lijst'];
  const r = Object.fromEntries(regels.map((k) => { const d = document.createElement('div'); d.className = `wp-set-${k}`; blok.appendChild(d); return [k, d]; }));
  let t = 0, bezig = false, gestopt = false;
  const toonPlan = (l) => {
    zet(r.buiten, l?.buiten ? 'BUITEN PLAN' : '');
    for (const k of ['nu', 'volgende', 'daarna', 'laag', 'eind']) zet(r[k], l?.tekst?.[k] ?? '');
    if (!l) zet(r.nu, 'nog geen stand van de mixer');
  };
  const toonSets = (s) => {
    zet(r.gekozen, s?.gekozen ? `gekozen: ${s.gekozen}${s.metMoment ? ' · met mixer' : ''}${s.vraag ? ' · nog eens = zeker' : ''}` : 'nog geen sets');
    zet(r.lijst, (s?.lijst ?? []).map((x) => `${x.naam === s.gekozen ? '▶ ' : ''}${x.naam} (${x.nummers})`).join(' · '));
  };
  async function haal() {
    if (bezig || gestopt) return;
    bezig = true;
    try {
      let l = null;
      if (verb.soort === 'opener') {
        const v = window.opener?.varveSets;
        l = v ? { ...(await v.live()), sets: v.stand() } : null;
      } else {
        const res = await fetch('/api/set/live', { cache: 'no-store' });
        l = res.ok ? (await res.json()).stand : null;
      }
      if (!gestopt) { if (naam === 'plan') toonPlan(l); else toonSets(l?.sets ?? null); }
    } catch (_) { /* de rode balk zegt het al */ } finally { bezig = false; }
  }
  return {
    stap() { const n = performance.now(); if (n - t > 500) { t = n; haal(); } },
    stop() { gestopt = true; blok.remove(); },
  };
}

function standVak(naam, el) {
  const lijst = document.createElement('div');
  lijst.className = 'wp-stand';
  el.appendChild(lijst);
  const rijen = new Map();
  return {
    naam, el,
    stap() {
      const s = verb.decks();
      if (!s) return;
      const gezien = new Set();
      for (const d of s.decks) {
        gezien.add(d.id);
        let r = rijen.get(d.id);
        if (!r) {
          r = { el: document.createElement('div') };
          r.el.className = 'wp-stand-rij';
          r.nr = r.el.appendChild(document.createElement('span')); r.nr.className = 'wp-nr';
          r.titel = r.el.appendChild(document.createElement('span')); r.titel.className = 'wp-titel';
          r.bpm = r.el.appendChild(document.createElement('span')); r.bpm.className = 'wp-bpm';
          r.tijd = r.el.appendChild(document.createElement('span')); r.tijd.className = 'wp-tijd';
          rijen.set(d.id, r);
          lijst.appendChild(r.el);
        }
        zet(r.nr, String(d.nr));
        zet(r.titel, d.titel ?? '');
        zet(r.bpm, bpmT(d.bpm));
        zet(r.tijd, `${mmss(d.positie)} / ${mmss(d.duur)}`);
        const klasse = `wp-stand-rij${d.speelt ? ' speelt' : ''}${d.wacht ? ' wacht' : ''}${s.maatgever === d.id ? ' mg' : ''}`;
        if (r.el.className !== klasse) r.el.className = klasse;
      }
      for (const [id, r] of rijen) if (!gezien.has(id)) { r.el.remove(); rijen.delete(id); }
    },
    stop: () => el.remove(),
  };
}

function sectiesVak(naam, el) {
  const lijst = document.createElement('div');
  lijst.className = 'wp-secties';
  el.appendChild(lijst);
  let sl = null;
  const knoppen = [];
  return {
    naam, el,
    stap() {
      const s = verb.decks();
      const focus = verb.vars()?.focus;
      const d = s?.decks?.find((x) => String(x.nr) === String(focus)) ?? null;
      const stukken = d?.secties ?? [];
      const k = `${d?.id}:${stukken.length}:${stukken[0]?.van}`;
      if (k !== sl) {
        sl = k;
        lijst.replaceChildren();
        knoppen.length = 0;
        if (!stukken.length) { const p = document.createElement('div'); p.className = 'wp-dim'; p.textContent = d ? 'geen secties' : 'geen focus-track'; lijst.appendChild(p); }
        stukken.forEach((st, i) => { const b = document.createElement('div'); b.className = 'wp-sectie'; b.textContent = `${i + 1} ${st.label ?? ''}`; lijst.appendChild(b); knoppen.push(b); });
      }
      const p = d?.positie;
      let hier = -1;
      if (Number.isFinite(p)) for (let i = 0; i < stukken.length; i++) if (stukken[i].van <= p + 0.001) hier = i;
      knoppen.forEach((b, i) => { const aan = i === hier; if (b.classList.contains('hier') !== aan) b.classList.toggle('hier', aan); });
    },
    stop: () => el.remove(),
  };
}

function bouw(w) {
  for (const v of vakken) v.stop();
  vakken = [];
  const namen = w?.schermen?.[scherm]?.vakken ?? [];
  for (const n of namen) vakken.push(bouwVak(n, w));
  const kleur = kleurVanDeel(w?.deel, { kleur: w?.kleur, label: w?.label });
  document.documentElement.style.setProperty('--deel', hexVan(kleur));
  document.documentElement.style.setProperty('--deel-tekst', tekstOp(kleur));
  zet(kop.deel, w?.label ?? (w?.deel ? w.deel.toUpperCase() : '—'));
  zet(kop.naam, w ? (w.titel ?? w.naam) : 'geen werkruimte');
  toon(leegEl, !vakken.length);
  zet(leegEl, !w ? 'wacht op de mixer…'
    : w.naam === 'standaard' ? 'de werkruimte "standaard" zet niets op dit scherm: kies een werkruimte op de werk-balk van de mixer'
      : `in het deel ${w.label ?? w.deel ?? '—'} staat niets op scherm "${scherm}" (delen.${w.deel}.schermen.${scherm}.vakken)`);
}

// ---- bedienen vanaf de iPad en de iPhone (S8, W1 = ja) ---------------------------------------------
// Alleen via de server, alleen als de schrijfweg in de Controlekamer aan staat en dit apparaat
// gekoppeld is (een HttpOnly-cookie: de server zegt het). Anders kijkt de pagina, zoals in S7.
const koppelEl = $('wp-koppel');
let schrijver = null;
function zetBedienen(aan) {
  if (verb.soort !== 'server' || aan === !!schrijver) return;
  if (aan) { schrijver = maakSchrijver({ pagina: verb.pagina, meld: (t) => meldKort(t) }); verb.zetSchrijver(schrijver); }
  else {
    for (const v of vakken) v.paneel?.laatAllesLos();   // eerst los (nog met de schrijver), dan kijken
    schrijver.stop(); schrijver = null; verb.zetSchrijver(null);
  }
  zet(kop.soort, verb.kanBedienen ? 'bedient' : 'kijkt');
  document.body.classList.toggle('wp-kijkt', !verb.kanBedienen);
}
let meldTimer = null;
function meldKort(t) {
  const m = $('wp-melding');
  if (!m) return;
  zet(m, t); toon(m, true);
  clearTimeout(meldTimer); meldTimer = setTimeout(() => toon(m, false), 2500);
}
async function kijkKoppeling() {
  if (verb.soort !== 'server') return;
  const w = await wie();
  if (!w) return;                                   // geen verbinding: de rode balk zegt het al
  const goed = w.aan && w.gekoppeld && w.scherm === scherm;
  zetBedienen(goed);
  toon(koppelEl, w.aan && !goed);
  if (w.aan && w.gekoppeld && w.scherm !== scherm) zet($('wp-koppel-uitleg'), `dit apparaat is gekoppeld als "${w.scherm}": koppel opnieuw voor "${scherm}"`);
}
if (verb.soort === 'server' && koppelEl) {
  $('wp-koppel-knop')?.addEventListener('click', async () => {
    const code = $('wp-koppel-code').value;
    const naam = $('wp-koppel-naam').value.trim() || scherm;
    const r = await koppel({ code, naam, scherm });
    zet($('wp-koppel-uitleg'), r.ok ? `gekoppeld als ${r.apparaat.naam}` : r.fout);
    if (r.ok) { $('wp-koppel-code').value = ''; kijkKoppeling(); }
  });
  kijkKoppeling();
  // De schakelaar kan in de Controlekamer omgaan, of het apparaat ingetrokken worden: elke 5 s kijken.
  setInterval(kijkKoppeling, 5000);
}

// ---- ✎ inrichten op mac-2 (S8): alleen als venster van de mixer (de iPad richt nooit in) ------------
// Klik een item van een paneel en binnen 3 s nog eens = weg; de zoeker zet een functie op het eerste
// paneel van dit scherm (de top-40 bovenaan). Opslaan doet de mixer (met versie; 409 = niets overschreven).
const ir = (() => { try { return verb.soort === 'opener' ? window.opener?.varveInrichten ?? null : null; } catch (_) { return null; } })();
if (ir) {
  const knop = document.createElement('button');
  knop.className = 'wp-ir-knop'; knop.textContent = '✎'; knop.title = 'inrichten: items weghalen (twee keer klikken) en functies erbij (zoeker)';
  const zoek = document.createElement('input');
  zoek.type = 'search'; zoek.placeholder = 'functie erbij (top-40 bovenaan)'; zoek.className = 'wp-ir-zoek'; zoek.hidden = true;
  const lijst = document.createElement('div'); lijst.className = 'wp-ir-lijst'; lijst.hidden = true;
  kop.status.before(knop, zoek);
  document.querySelector('.wp-kop')?.after(lijst);
  let aan = false, markeer = null, api = null;   // api: de inrichter van de mixer, pas geladen bij de eerste ✎
  const eerstePaneel = () => vakken.find((v) => v.paneel && /^paneel:/.test(v.naam));
  const toonLijst = () => {
    if (!api) return;
    lijst.replaceChildren(...api.zoek(zoek.value).slice(0, 30).map((x) => {
      const b = document.createElement('button'); b.className = 'wp-ir-vond'; b.textContent = `${x.top ? `${x.top}. ` : ''}${x.id}`;
      b.addEventListener('click', async () => {
        const v = eerstePaneel();
        if (!v) { meldKort('geen paneel op dit scherm in dit deel: zet er eerst een op (✎ in de mixer)'); return; }
        const r = await api.inrichter.voegToe(v.naam.slice(7), itemVoor(x.id, verb.metaOf(x.id.replace('{focus}', verb.vars().focus ?? '1'))));
        meldKort(r.ok ? `${x.id} staat op ${v.naam}` : r.reden);
      });
      return b;
    }));
  };
  zoek.addEventListener('input', toonLijst);
  knop.addEventListener('click', async () => {
    try { api ??= await ir.laad(); } catch (_) { meldKort('inrichten laadt niet in de mixer'); return; }
    aan = !aan;
    knop.classList.toggle('aan', aan); zoek.hidden = !aan; lijst.hidden = !aan;
    document.body.classList.toggle('wp-inrichten', aan);
    if (aan) toonLijst();
  });
  // In inricht-stand gaat een klik op een item niet af: hij markeert (en de tweede haalt hem weg).
  vakkenEl.addEventListener('pointerdown', async (e) => {
    if (!aan) return;
    const itemEl = e.target.closest?.('.vp-item');
    const v = vakken.find((x) => x.el.contains(e.target));
    if (!itemEl || !v?.paneel || !/^paneel:/.test(v.naam)) return;
    e.preventDefault(); e.stopPropagation();
    const plat = v.paneel.items.findIndex((it) => it.el === itemEl);
    // Het nummer in het bestand: een rij telt als één item (weghalen = de hele rij).
    const def = window.opener.varvePaneel.werk()?.panelen?.[v.naam.slice(7)];
    let i = -1, n = 0;
    def?.items?.forEach((it, k) => { const m = it?.soort === 'rij' ? (it.herhaal?.length ?? 0) : 1; if (plat >= n && plat < n + m) i = k; n += m; });
    if (i < 0) return;
    if (markeer?.i === i && markeer.v === v.naam && performance.now() - markeer.t < 3000) {
      markeer = null;
      const r = await api.inrichter.haalWeg(v.naam.slice(7), i);
      meldKort(r.ok ? 'weggehaald' : r.reden);
    } else { markeer = { i, v: v.naam, t: performance.now() }; itemEl.classList.add('wp-ir-vraag'); setTimeout(() => itemEl.classList.remove('wp-ir-vraag'), 3000); meldKort('nog eens binnen 3 s = weghalen'); }
  }, true);
}

// ---- de lus ----------------------------------------------------------------------------------
let wasStaat = null;
function beeld() {
  try {
    // Drie standen: verbonden (de stand van de mixer is binnen), de server is er maar de mixer
    // zendt niets (geen werkruimte, of het tabblad met de APC is dicht), of weg (rode balk).
    const verbonden = verb.soort === 'opener' ? verb.verbonden : verb.verbonden && verb.compleet;
    const staat = verbonden ? 'aan' : verb.soort === 'server' && verb.bereikbaar ? 'stil' : 'weg';
    if (staat !== wasStaat) {
      wasStaat = staat;
      toon(balk, staat === 'weg');
      zet(balk, verb.soort === 'opener' ? 'geen mixer: dit venster hoort bij de mixer (open het daar met "open schermen")' : 'geen verbinding met de mixer');
      zet(kop.status, staat === 'aan' ? '●' : staat === 'stil' ? '◐' : '○');
      document.body.classList.toggle('wp-weg', staat === 'weg');
      if (staat !== 'aan') {
        for (const v of vakken) v.stop();
        vakken = []; sleutel = null;
        toon(leegEl, true);
        zet(leegEl, staat === 'stil' ? 'verbonden met de server, maar de mixer zendt niets: kies een werkruimte in de mixer (niet "standaard"), en houd het tabblad met de APC open'
          : 'wacht op de mixer…');
      }
    }
    if (staat === 'aan') {
      const s = verb.werkSleutel();
      if (s !== sleutel) { sleutel = s; bouw(verb.werk()); }
      for (const v of vakken) v.stap();
    }
  } catch (err) {
    if (!beeld.klacht || performance.now() - beeld.klacht > 2000) { beeld.klacht = performance.now(); console.error('[werk]', err); }
  }
  requestAnimationFrame(beeld);
}
requestAnimationFrame(beeld);

// ---- podiumapparaat --------------------------------------------------------------------------
let slot = null;
async function wakker() {
  if (verb.soort !== 'server' || document.visibilityState !== 'visible' || slot) return;
  try {
    slot = await navigator.wakeLock?.request?.('screen');
    slot?.addEventListener?.('release', () => { slot = null; });
  } catch (_) { slot = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  wakker();
  if (verb.soort === 'server') { verb.opnieuw('zichtbaar'); kijkKoppeling(); }
});
window.addEventListener('online', () => { if (verb.soort === 'server') verb.opnieuw('online'); });
// Vingers die het scherm verlaten (Begeleide toegang, een melding van iOS): alles los.
window.addEventListener('blur', () => { for (const v of vakken) v.paneel?.laatAllesLos(); });
wakker();

// ---- plaatsing (mac-2): onthouden op welk scherm dit venster staat -------------------------------
async function schermLabel() {
  try {
    const p = await navigator.permissions?.query?.({ name: 'window-management' });
    if (p?.state !== 'granted' || typeof window.getScreenDetails !== 'function') return null;
    return (await window.getScreenDetails()).currentScreen?.label ?? null;
  } catch (_) { return null; }
}
let plekSleutel = '';
async function onthoudPlek() {
  if (verb.soort !== 'opener') return;
  // Bij de mixer aanmelden (na het herladen van de mixer weet "open schermen" zo dat dit venster er is).
  try { window.opener?.varvePaneel?.meldAan?.(scherm, window); } catch (_) {}
  const s = window.screen;
  const plek = { x: window.screenX, y: window.screenY, wW: window.outerWidth, wH: window.outerHeight,
    left: s.availLeft ?? 0, top: s.availTop ?? 0, w: s.width, h: s.height };
  const k = JSON.stringify(plek);
  if (k === plekSleutel) return;
  plekSleutel = k;
  plek.label = await schermLabel();
  try { localStorage.setItem(PLEK + scherm, JSON.stringify(plek)); } catch (_) {}
}
setInterval(onthoudPlek, 2000);
onthoudPlek();

// Voor de headless proeven en de console.
window.paneel = {
  verb, scherm, get vakken() { return vakken; }, get schrijver() { return schrijver; }, kijkKoppeling,
  hoorbaarOp: (id, srv) => verb.hoorbaarOp?.(id, srv) ?? null,
};
