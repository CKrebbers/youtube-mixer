import { Mapping, resolveTarget } from '../control/mapping.js';
import { GROEPEN, LAAGNAAM, Lagen } from '../control/lagen.js';
import apc from '../control/devices/apc40mk2.js';
import { esc } from './dom.js';
import { beschrijf } from './apc-beschrijf.js';
import { laadEigen } from './mapping-opslag.js';
import { hubAdres } from './vlag.js';
import { SOORTEN, soortVan } from './soorten.js';
import { lijstWerkruimtes, laadVoorbeeld, delenVan, zetFragmenten, zetApcMapjes, apcStandVan, houdMapjes, mapjeNaam } from './spiekbrief.js';

/**
 * De interactieve APC-kaart (apc.html).
 *
 * Eén tekening van de APC40 mkII, knoppen op hun ECHTE plek: uitgemeten op
 * de Features-tekening in de User Guide v1.0 (p4). Het apparaat loopt daar van
 * x 70–1040 en y 392–970; elke positie hieronder is dat, omgerekend naar
 * procenten. Zie docs/APC40-onderzoek.md.
 *
 * Wat een knop doet komt NIET uit deze pagina maar uit de mapping (je eigen
 * versie van de server, anders de standaard) via dezelfde `Mapping.kies()` als
 * de app. Schakelaars bovenaan kiezen grid-modus, strip/rack en shift; de
 * labels wisselen direct mee. Is de APC aangesloten, dan luistert de pagina
 * zelf mee (alleen lezen, stuurt niets): een aangeraakte knop licht op, en
 * modus en shift volgen wat je op het apparaat doet.
 *
 * WERKRUIMTE (spoor S6, docs/werkruimte/S6.md): een kiezer werkruimte + deel toont wat de APC in
 * dat deel doet ZONDER het te activeren (voorbeeldmodus): de stukken van die werkruimte komen als
 * fragment op de mapping van deze pagina, hun nieuwe mapjes (fx-matrix, uitlijn …) krijgen een
 * knop, het deel zet de modi, en onderaan staan de houd-mapjes (wat een knop doet zolang je een
 * andere vasthoudt, ook op de Maschine). Er gaat niets naar de mixer of de APC.
 */

// ---- plaatsing (procenten van het apparaat) --------------------------------

const X0 = 70, Y0 = 392, B = 970, H = 578;
const px = (x) => ((x - X0) / B) * 100;
const py = (y) => ((y - Y0) / H) * 100;
const K = (sig, x, y, soort, deel) => ({ sig, x: px(x), y: py(y), soort, deel });

const kolom = (i) => 115 + i * 74;          // x van kolom 1..8 (i = 0..7)
const MASTERKOL = 697;
const RIJEN_GRID = [497, 533, 568, 604, 639];
export const PLAAT = [];
for (let i = 0; i < 8; i++) {
  const x = kolom(i);
  PLAAT.push(K(`cc:0:${48 + i}`, x, 438, 'draai', 'kolom'));
  RIJEN_GRID.forEach((y, r) => PLAAT.push(K(`note:0:${apc.gridNote(i + 1, r + 1)}`, x, y, 'pad', 'grid')));
  PLAAT.push(K(`note:${i}:52`, x, 678, 'knop', 'kolom'));        // clip stop
  PLAAT.push(K(`note:${i}:51`, x, 717, 'breed', 'kolom'));       // track select
  PLAAT.push(K(`note:${i}:50`, x - 18, 752, 'mini', 'kolom'));   // activator (nummer)
  PLAAT.push(K(`note:${i}:66`, x + 18, 752, 'mini', 'kolom'));   // A|B
  PLAAT.push(K(`note:${i}:49`, x - 18, 787, 'mini', 'kolom'));   // S
  PLAAT.push(K(`note:${i}:48`, x + 18, 787, 'mini', 'kolom'));   // ●
  PLAAT.push(K(`cc:${i}:7`, x, 885, 'fader', 'kolom'));
}
RIJEN_GRID.forEach((y, s) => PLAAT.push(K(`note:0:${82 + s}`, MASTERKOL, y, 'scene', 'master')));
PLAAT.push(K('note:0:81', MASTERKOL, 678, 'knop', 'master'));       // stop all clips
PLAAT.push(K('note:0:80', MASTERKOL, 717, 'breed', 'master'));      // master
PLAAT.push(K('cc:0:47', MASTERKOL, 770, 'draaiklein', 'master'));   // cue level
PLAAT.push(K('cc:0:14', MASTERKOL, 885, 'fader', 'master'));        // masterfader
// rechterdeel: drie rijen, tempo rechts ervan
[['note:0:87', 758, 485], ['note:0:91', 840, 485], ['note:0:93', 915, 485], ['note:0:102', 988, 485],
  ['note:0:88', 758, 527], ['note:0:90', 832, 527], ['note:0:99', 907, 527],
  ['note:0:89', 758, 567], ['note:0:100', 832, 567], ['note:0:101', 907, 567]]
  .forEach(([s, x, y]) => PLAAT.push(K(s, x, y, 'knop', 'rechts')));
PLAAT.push(K('cc:0:13', 975, 545, 'draaigroot', 'rechts'));
[765, 840, 913, 988].forEach((x, i) => PLAAT.push(K(`cc:0:${16 + i}`, x, 625, 'draai', 'rechts')));
[765, 840, 913, 988].forEach((x, i) => PLAAT.push(K(`cc:0:${20 + i}`, x, 700, 'draai', 'rechts')));
[['note:0:58', 757, 760], ['note:0:59', 828, 760], ['note:0:60', 905, 760], ['note:0:61', 978, 760],
  ['note:0:62', 757, 800], ['note:0:63', 828, 800], ['note:0:64', 905, 800], ['note:0:65', 978, 800],
  ['note:0:98', 905, 840], ['note:0:103', 978, 840]]
  .forEach(([s, x, y]) => PLAAT.push(K(s, x, y, 'knop', 'rechts')));
[['note:0:94', 790, 836], ['note:0:97', 766, 858], ['note:0:96', 814, 858], ['note:0:95', 790, 880]]
  .forEach(([s, x, y]) => PLAAT.push(K(s, x, y, 'pijl', 'rechts')));
PLAAT.push(K('cc:0:15', 918, 932, 'xfader', 'rechts'));

const naamVan = (sig) => apc.label(sig) ?? sig;
const PER_SIG = new Map(PLAAT.map((k) => [k.sig, k]));

// ---- soorten (kleur op de kaart): ui/soorten.js, gedeeld met de Maschine-kaart ----

export { SOORTEN, soortVan };

// ---- toestand ------------------------------------------------------------------

const lagen = new Lagen();
let shift = false;
let gekozen = null;          // sig van de aangeklikte knop
let zoek = '';
let mapping = null;

/** De regel voor een knop, eventueel in een andere stand dan de huidige. */
function regelVan(sig, { metShift = shift, stand = null } = {}) {
  if (!stand) return mapping.kies(sig, { shift: metShift });
  const oud = mapping.lagen;
  mapping.lagen = () => Object.entries(stand).map(([g, l]) => `${g}.${l}`);
  const r = mapping.kies(sig, { shift: metShift });
  mapping.lagen = oud;
  return r;
}
const tekst = (r) => (r ? beschrijf(resolveTarget(r.action, {})) : null);

// ---- tekenen -----------------------------------------------------------------

const plaat = document.getElementById('plaat');
const detail = document.getElementById('detail');

function tekenPlaat() {
  plaat.innerHTML = '<b class="logo">APC40<sup>mkII</sup></b><b class="akai">AKAI professional</b>'
    + '<i class="vak vak-grid"></i><i class="vak vak-device"></i><i class="vak vak-pijlen"></i>'
    + PLAAT.map((k) => {
      const r = regelVan(k.sig);
      const b = tekst(r);
      const soort = soortVan(r?.action);
      const hoogte = zoek && b ? (b.lang + ' ' + b.kort + ' ' + naamVan(k.sig)).toLowerCase().includes(zoek) : false;
      const cls = ['c', k.soort, `s-${soort}`, gekozen === k.sig ? 'gekozen' : '',
        zoek ? (hoogte ? 'treffer' : 'mis') : '', r?.shift ? 'shiftregel' : ''].join(' ');
      return `<button class="${cls}" data-sig="${esc(k.sig)}" style="left:${k.x.toFixed(2)}%;top:${k.y.toFixed(2)}%"
        title="${esc(naamVan(k.sig))}${b ? ` — ${esc(b.lang)}` : ' — vrij'}"><i></i><span>${b ? esc(b.kort) : ''}</span></button>`;
    }).join('');
  document.querySelectorAll('[data-modus]').forEach((el) => {
    const [g, l] = el.dataset.modus.split('.');
    el.classList.toggle('aan', lagen.stand[g] === l);
  });
  document.getElementById('shift').classList.toggle('aan', shift);
  document.getElementById('gridmodus').classList.toggle('aan', lagen.stand.edit === 'aan');
}

function tekenDetail() {
  if (!gekozen) {
    detail.innerHTML = '<h3>Klik op een knop</h3><p class="dim">…of druk hem in op de APC. Hier zie je wat hij nu doet, wat hij met shift doet, en wat hij in elke modus doet.</p>'
      + '<p class="dim">Zoek hierboven op een functie ("loop", "filter", "cue") om te zien waar hij zit.</p>';
    return;
  }
  const k = PER_SIG.get(gekozen);
  const lang = (r) => (r ? esc(tekst(r).lang) : '<span class="dim">niets (vrij)</span>');
  const gewoon = regelVan(gekozen, { metShift: false });
  const metShift = regelVan(gekozen, { metShift: true });
  const rijen = [];
  for (const [g, d] of Object.entries(GROEPEN)) {
    // Een schakelaar (grid-modus) heeft ook zijn standaardstand ('uit') als laag.
    const perLaag = [...new Set([...(d.schakel ? [d.standaard] : []), ...Object.values(d.knoppen).flat()])]
      .map((l) => ({ l, r: regelVan(gekozen, { metShift: false, stand: { ...lagen.stand, [g]: l } }) }));
    if (new Set(perLaag.map((x) => x.r?.action ?? '')).size > 1) {
      for (const { l, r } of perLaag) {
        rijen.push(`<tr class="${lagen.stand[g] === l ? 'nu' : ''}"><td>${esc(LAAGNAAM[`${g}.${l}`] ?? l)}</td><td>${lang(r)}</td></tr>`);
      }
    }
  }
  const waar = { grid: 'grid-pad', kolom: 'in de kolom van een track', master: 'masterkolom (rechts van het grid)', rechts: 'rechterdeel' }[k.deel];
  detail.innerHTML = `
    <h3><i class="stip s-${soortVan(gewoon?.action)}"></i>${esc(naamVan(gekozen))}</h3>
    <p class="dim">${esc(waar)}</p>
    <dl>
      <dt>doet nu</dt><dd>${lang(gewoon)}</dd>
      <dt>met shift</dt><dd>${metShift && metShift !== gewoon ? lang(metShift) : '<span class="dim">hetzelfde</span>'}</dd>
    </dl>
    ${rijen.length ? `<h4>per modus</h4><table>${rijen.join('')}</table>` : ''}`;
}

/**
 * De houd-mapjes (uit een stuk, ook die van de Maschine: houd.js deelt ze over alle apparaten): welke
 * APC-knop wat doet zolang je de houd-knop vasthoudt. Een houd-mapje zonder APC-knop staat er ook,
 * met hoe je er een koppelt.
 */
function houdLijst() {
  const perNaam = new Map(houdMapjes(mapping).map((h) => [h.naam, h.regels]));
  for (const mj of Object.values(voorbeeld?.samenstelling?.apparaten ?? {}).flatMap((a) => a.mapjes)) {
    if (mj.groep === 'houd' && !perNaam.has(mj.laag)) perNaam.set(mj.laag, []);
  }
  if (!perNaam.size) return '';
  const rij = (naam, r) => `<tr data-sig="${esc(r.in)}"><td><i class="stip s-${soortVan(r.action)}"></i>${esc(naam.toUpperCase())} vast + ${esc(naamVan(r.in))}${r.shift ? ' + shift' : ''}</td><td>${esc(tekst(r)?.lang ?? r.action)}</td></tr>`;
  return `<section><h3>Vasthouden (houd-mapjes${voorbeeld ? `, werkruimte ${esc(voorbeeld.naam)}` : ''})</h3><table>${[...perNaam].map(([naam, regels]) => (regels.length
    ? regels.map((r) => rij(naam, r)).join('')
    : `<tr><td>${esc(naam.toUpperCase())} vast</td><td class="dim">nog geen APC-knop: houd ${esc(naam.toUpperCase())} vast en koppel er een (de regel komt in houd.${esc(naam)})</td></tr>`)).join('')}</table></section>`;
}

function tekenLijst() {
  // Alles wat nu iets doet, per deel van het apparaat; wat per kolom gelijk is op één regel.
  const delen = [['kolom', 'Per track (kolom 1–8)'], ['grid', 'Grid (modus: ' + (LAAGNAAM[`grid.${lagen.stand.grid}`] ?? '') + ')'],
    ['master', 'Masterkolom'], ['rechts', 'Rechterdeel — de track met focus']];
  document.getElementById('lijst').innerHTML = delen.map(([deel, titel]) => {
    const groepen = new Map();
    for (const k of PLAAT.filter((x) => x.deel === deel)) {
      const r = regelVan(k.sig);
      if (!r) continue;
      const knop = naamVan(k.sig);
      const m = /(\d)(\/\d)?$/.exec(knop);
      const n = deel === 'rechts' ? null : m ? m[1] : null;
      const alg = (t) => (n ? t.replaceAll(`track ${n}`, 'track N').replaceAll(`sampler-pad ${n}`, 'sampler-pad N') : t);
      const doet = alg(tekst(r).lang);
      const sleutel = (n ? knop.replace(/(\d)(\/\d)?$/, 'N$2') : knop) + '|' + doet;
      if (!groepen.has(sleutel)) groepen.set(sleutel, { knop, tpl: n ? knop.replace(/(\d)(\/\d)?$/, '#$2') : null, ns: [], doet, soort: soortVan(r.action), sig: k.sig });
      if (n) groepen.get(sleutel).ns.push(n);
    }
    const rijen = [...groepen.values()].map((g) => {
      const meer = g.ns.length > 1;
      const knop = g.tpl ? g.tpl.replace('#', meer ? `${g.ns[0]}–${g.ns.at(-1)}` : g.ns[0]) : g.knop;
      const doet = meer ? g.doet.replaceAll('track N', 'die track').replaceAll('sampler-pad N', 'die sampler-pad')
        : g.doet.replaceAll('track N', `track ${g.ns[0]}`).replaceAll('sampler-pad N', `sampler-pad ${g.ns[0]}`);
      return `<tr data-sig="${esc(g.sig)}"><td><i class="stip s-${g.soort}"></i>${esc(knop)}</td><td>${esc(doet)}</td></tr>`;
    }).join('');
    return `<section><h3>${esc(titel)}</h3><table>${rijen}</table></section>`;
  }).join('') + houdLijst();
}

function alles() { tekenPlaat(); tekenDetail(); tekenLijst(); }

// ---- bediening op de pagina ----------------------------------------------------

plaat.addEventListener('click', (e) => {
  const el = e.target.closest('[data-sig]');
  gekozen = el ? (gekozen === el.dataset.sig ? null : el.dataset.sig) : null;
  tekenPlaat(); tekenDetail();
});
document.getElementById('lijst').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-sig]');
  if (!tr) return;
  gekozen = tr.dataset.sig;
  tekenPlaat(); tekenDetail();
  plaat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
// Eén luisteraar op de kop: ook voor de modusknoppen die een werkruimte erbij zet (voorbeeldmodus).
document.querySelector('.k-kop').addEventListener('click', (e) => {
  const el = e.target.closest('[data-modus]');
  if (!el) return;
  const [g, l] = el.dataset.modus.split('.');
  lagen.zet(g, l);
});

// ---- voorbeeldmodus: een werkruimte en een deel bekijken (spoor S6) -------------------

let voorbeeld = null;
let weg = () => {};          // haalt de fragmenten en mapjes van het voorbeeld weer weg

async function haalJson(url) {
  const r = await fetch(url);
  if (!r.ok) { try { await r.body?.cancel(); } catch (_) {} return null; }
  return r.json();
}

/** Knoppen voor de mapjes die het voorbeeld erbij zet (grid.fx, device.uitlijn …). */
function mapjesKnoppen() {
  document.querySelectorAll('.uit-werk').forEach((el) => el.remove());
  for (const mj of voorbeeld?.samenstelling?.apparaten?.apc40mk2?.mapjes ?? []) {
    if (mj.groep === 'houd') continue;
    const groep = document.querySelector(`[data-modus^="${mj.groep}."]`)?.closest('.k-groep');
    groep?.insertAdjacentHTML('beforeend', `<button class="k-knop uit-werk" data-modus="${esc(mj.groep)}.${esc(mj.laag)}" title="${esc(mapjeNaam(mj.groep, mj.laag))}">${esc(mj.laag)}</button>`);
  }
}

function zetDeel(deelNaam) {
  if (!voorbeeld) return;
  for (const [g, l] of Object.entries(apcStandVan(voorbeeld, deelNaam))) lagen.zet(g, l);
  alles();
}

async function kiesVoorbeeld(naam, deelKies) {
  weg();
  weg = () => {};
  voorbeeld = naam ? await laadVoorbeeld(naam, haalJson) : null;
  if (voorbeeld) {
    const af = zetFragmenten(mapping, voorbeeld, 'apc40mk2');
    const afMapjes = zetApcMapjes(voorbeeld);
    weg = () => { af(); afMapjes(); };
  }
  mapjesKnoppen();
  const delen = voorbeeld ? delenVan(voorbeeld).filter((d) => d.naam) : [];
  deelKies.hidden = !delen.length;
  deelKies.innerHTML = delen.map((d) => `<option value="${esc(d.naam)}">F${d.nr} ${esc(d.label)}</option>`).join('');
  document.getElementById('spiek').href = `spiekbrief.html${naam ? `?werk=${encodeURIComponent(naam)}` : ''}`;
  if (delen.length) zetDeel(delen[0].naam);
  else { for (const [g, d] of Object.entries(GROEPEN)) if (!d.houd) lagen.zet(g, d.standaard); alles(); }
}

async function opzetKiezer() {
  document.getElementById('gridmodus').insertAdjacentHTML('beforebegin', `<div class="k-groep" id="werk-kiezer"><span>werkruimte</span>
    <select id="werk-kies" class="k-knop" title="bekijk een werkruimte zonder hem te activeren"><option value="">— (geen)</option></select>
    <select id="deel-kies" class="k-knop" title="het deel" hidden></select>
    <a class="k-knop" id="spiek" href="spiekbrief.html" target="_blank" rel="noopener" title="de spiekbrief: per deel wat elke knop doet, om te printen">spiekbrief</a></div>`);
  const werkKies = document.getElementById('werk-kies'), deelKies = document.getElementById('deel-kies');
  for (const w of await lijstWerkruimtes(haalJson)) {
    if (w.naam === 'standaard') continue;   // "— (geen)" is de standaard
    werkKies.insertAdjacentHTML('beforeend', `<option value="${esc(w.naam)}">${esc(w.naam)}${w.titel && w.titel !== w.naam ? ` · ${esc(w.titel)}` : ''}</option>`);
  }
  werkKies.addEventListener('change', () => kiesVoorbeeld(werkKies.value, deelKies).catch((err) => console.warn('[apc-kaart] voorbeeld', err)));
  deelKies.addEventListener('change', () => zetDeel(deelKies.value));
}
document.getElementById('shift').addEventListener('click', () => { shift = !shift; alles(); });
document.getElementById('gridmodus').addEventListener('click', () => lagen.zet('edit', lagen.stand.edit === 'aan' ? 'uit' : 'aan'));
document.getElementById('zoek').addEventListener('input', (e) => { zoek = e.target.value.trim().toLowerCase(); tekenPlaat(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { gekozen = null; zoek = ''; document.getElementById('zoek').value = ''; tekenPlaat(); tekenDetail(); }
  if (e.key === 'Shift' && !e.repeat && e.target.tagName !== 'INPUT') { shift = true; alles(); }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift' && shift && e.target.tagName !== 'INPUT') { shift = false; alles(); } });
lagen.on('change', alles);

document.getElementById('legenda').innerHTML = [...SOORTEN.map(([id, naam]) => [id, naam]), ['vrij', 'vrij (doet niets)']]
  .map(([id, naam]) => `<span><i class="stip s-${id}"></i>${esc(naam)}</span>`).join('');

// ---- live meekijken met de APC (alleen lezen) --------------------------------

/**
 * De pagina opent de APC-invoer zelf. Web MIDI laat meerdere tabbladen tegelijk
 * luisteren; deze stuurt NIETS terug (geen init, geen lampjes), dus hij zit de
 * mixer niet in de weg. De eigen Mapping doet alleen shift en de modusknoppen
 * (layer.*) na, zodat de kaart volgt wat je op het apparaat doet.
 */
async function luisterMee() {
  const status = document.getElementById('live');
  // Met ?hub= bezit de AV-app-hub de APC: geen tweede Web MIDI-client ernaast.
  if (hubAdres()) { status.textContent = 'de APC is van de AV-app-hub: de kaart kijkt niet live mee'; return; }
  if (!navigator.requestMIDIAccess) { status.textContent = 'geen Web MIDI in deze browser'; return; }
  let toegang;
  try { toegang = await navigator.requestMIDIAccess({ sysex: false }); } catch (_) { status.textContent = 'MIDI niet toegestaan'; return; }
  const koppel = () => {
    const invoer = [...toegang.inputs.values()].find((p) => /apc40/i.test(p.name));
    status.textContent = invoer ? 'live: druk een knop op de APC' : 'APC niet aangesloten';
    status.classList.toggle('aan', !!invoer);
    if (!invoer) return;
    invoer.onmidimessage = ({ data }) => {
      const [st, nr, w = 0] = data;
      const soort = st & 0xf0, ch = st & 0x0f;
      if (soort !== 0x90 && soort !== 0x80 && soort !== 0xb0) return;
      const type = soort === 0xb0 ? 'cc' : 'note';
      const aan = soort === 0x90 && w > 0;
      const sig = `${type}:${ch}:${nr}`;
      const shiftVoor = shift;
      mapping.handle({ type, channel: ch, number: nr, value: w, norm: w / 127, on: aan, sig });
      shift = mapping.shift;
      if ((type === 'cc' || aan) && PER_SIG.has(sig) && sig !== mapping.shiftSig) {
        gekozen = sig;
        tekenPlaat(); tekenDetail();
        const el = plaat.querySelector(`[data-sig="${CSS.escape(sig)}"]`);
        el?.classList.add('geraakt');
        setTimeout(() => el?.classList.remove('geraakt'), 400);
      } else if (shift !== shiftVoor) alles();
    };
  };
  koppel();
  toegang.onstatechange = koppel;
}

// ---- starten ---------------------------------------------------------------------

mapping = new Mapping({
  read: () => null,
  // Alleen de modusknoppen doen hier iets; al het andere hoort bij de mixer.
  invoke: (actie, aan) => {
    const m = /^layer\.(\w+)\.(\w+)$/.exec(actie);
    if (!m) return;
    if (m[2] === 'next' || m[2] === 'prev') { if (aan) lagen.stap(m[1], m[2] === 'next' ? 1 : -1); return; }
    lagen.druk(m[1], m[2], aan);
  },
  lagen: () => lagen.actief(),
});
// Dezelfde weg als de app: standaard + jouw verschil van de server (een oude
// volledige kopie wordt alleen hier in het geheugen omgezet). Deze pagina
// leest alleen: bewaren doet de app.
let bron = 'de standaardmapping';
try {
  const v = await laadEigen(mapping, { haal: (...a) => fetch(...a) });
  if (v.bron && (v.eigen || v.weg)) bron = `jouw eigen mapping (de standaard + ${v.eigen} eigen regel${v.eigen === 1 ? '' : 's'}${v.weg ? `, ${v.weg} weggehaald` : ''})`;
} catch (err) {
  mapping.laadStandaard(await (await fetch('mappings/apc40mk2.json')).json());
  bron = `de standaardmapping (jouw eigen kon niet gelezen worden: ${err.message})`;
}
document.getElementById('bron').textContent = `Uit ${bron} (${mapping.rules.size} regels).`;
alles();
opzetKiezer().catch((err) => console.warn('[apc-kaart] kiezer', err));
// Meekijken met de APC pas na een klik: dan opent deze pagina nooit
// ongevraagd MIDI naast de mixer (zie CLAUDE.md, Chrome-crash 23 sep).
const live = document.getElementById('live');
if (hubAdres()) {
  live.textContent = 'de APC is van de AV-app-hub: de kaart kijkt niet live mee';
} else {
  live.textContent = 'live meekijken met de APC';
  live.classList.add('klikbaar');
  live.addEventListener('click', () => { live.classList.remove('klikbaar'); live.textContent = '…'; luisterMee(); }, { once: true });
}
