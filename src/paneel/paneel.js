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
import { VrijPaneel, bouwsteenDef } from './vrij.js';
import { KaartWeergave } from './kaart.js';
import { vakSoort } from './protocol.js';
import { UitlijnWeergave, vakVorm } from '../uitlijn/teken.js';
import { hexVan, tekstOp, kleurVanDeel } from '../werk/kleuren.js';

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
      // Slepen = duwen: alleen als venster van de mixer (mac-2). De iPad kijkt (W1).
      invoke: verb.kanBedienen ? (a, x) => verb.invoke(a, x) : null,
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
    const def = bouwsteenDef(naam, { bestaat: (a) => !!verb.metaOf(a), vars: verb.vars() });
    const p = new VrijPaneel(el, def, verb, { modus: 'los', id: naam });
    return { naam, el, stap: () => p.teken(), stop: () => { p.vernietig(); el.remove(); }, paneel: p };
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
 */
function libraryVak(naam, el) {
  const kop = document.createElement('div');
  kop.className = 'wp-lib-kop';
  const zoek = document.createElement('input');
  zoek.type = 'search'; zoek.placeholder = 'zoeken'; zoek.className = 'wp-lib-zoek';
  kop.appendChild(zoek);
  el.appendChild(kop);
  const lijst = document.createElement('div');
  lijst.className = 'wp-lib';
  el.appendChild(lijst);
  let bezig = false, vraag = null, timer = null, gestopt = false;
  async function haal() {
    if (bezig || gestopt) return;
    bezig = true;
    try {
      const q = new URLSearchParams({ sorteer: 'toegevoegd', van: '0', aantal: '200' });
      if (zoek.value.trim()) q.set('zoek', zoek.value.trim());
      const r = await fetch(`/api/library?${q}`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!gestopt) teken(r.ok ? d?.tracks ?? [] : []);
    } catch (_) { /* de rode balk zegt het al */ } finally { bezig = false; }
  }
  function teken(tracks) {
    lijst.replaceChildren();
    if (!tracks.length) { const p = document.createElement('div'); p.className = 'wp-dim'; p.textContent = 'niets gevonden'; lijst.appendChild(p); return; }
    for (const t of tracks) {
      const rij = document.createElement('div');
      rij.className = 'wp-lib-rij';
      const titel = document.createElement('span'); titel.className = 'wp-lib-titel';
      titel.textContent = [t.artiest, t.titel ?? t.title].filter(Boolean).join(' — ') || t.id;
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
  haal();
  return { naam, el, stap() {}, stop: () => { gestopt = true; clearTimeout(timer); clearTimeout(vraag); el.remove(); } };
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
  if (verb.soort === 'server') verb.opnieuw('zichtbaar');
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
  verb, scherm, get vakken() { return vakken; },
  hoorbaarOp: (id, srv) => verb.hoorbaarOp?.(id, srv) ?? null,
};
