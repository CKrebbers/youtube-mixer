import { Maschine } from '../control/maschine.js';
import { HoudRegister } from '../control/houd.js';
import { tekenScherm, leesPixel, BREED, HOOG } from '../control/maschine-scherm.js';
import { esc } from './dom.js';
import { beschrijf } from './apc-beschrijf.js';
import { soortNaam } from './soorten.js';
import {
  PLAATS, OPDRUK, DELEN, idVanSig, leesAlles, perStand, naamVan,
  padmodusVan, zetPadmodus, neemStand, zetStand, padmodiVan, paginasVan, maakVoorbeeldMaschine,
} from './maschine-kaart-plan.js';
import { naamUitData } from '../control/maschine.js';
import { lijstWerkruimtes, laadVoorbeeld, delenVan } from './spiekbrief.js';

/**
 * De Maschine-kaart (maschine.html): de Maschine MK2 van bovenaf, en per
 * knop, pad en draaiknop wat hij NU doet.
 *
 * De teksten komen van een eigen Maschine-exemplaar (src/control/maschine.js)
 * met dezelfde indeling als de mixer: `legUit()` is de uitleg van CONTROL
 * (maschine-kaart-plan.js). Zonder mixer is dat een Maschine zonder engine
 * (focus op track 1, geen instrument, geen nummer).
 *
 * LIVE: is deze pagina geopend vanuit de mixer en heeft die een Maschine (met
 * ?hub=, `window.maschine` in app.js), dan krijgt het eigen exemplaar de engine
 * van de mixer, neemt het de stand van het apparaat over (pagina, padmodus,
 * shift), licht de knop op die je aanraakt (`maschine.geraakt`) en tonen de
 * schermen wat er naar de Maschine ging (`maschine.schermen`). Alleen lezen: deze
 * pagina stuurt niets naar de Maschine of de bus (invoke doet hier niets).
 * Kies je zelf een stand, dan stopt het volgen tot "volg de Maschine".
 *
 * WERKRUIMTE (spoor S6, docs/werkruimte/S6.md): een kiezer werkruimte + deel laat zien wat de
 * Maschine in dat deel doet ZONDER het te activeren (voorbeeldmodus): de stukken van die werkruimte
 * komen als fragment op het eigen exemplaar, de mapjes van het deel worden gezet (spiekbrief.js).
 * Volgt de kaart de mixer, dan neemt hij de fragmenten van de mixer-Maschine over (alleen lezen).
 * Padmodi en pagina's uit een stuk krijgen een eigen knop bovenaan.
 */

/** Zonder mixer: een Maschine zonder nummer, instrument of rack. */
const ZONDER = { focus: 'A', speeltrack: () => null, instrumentOp: () => null, deck: () => null };
const ELKE_MS = 200;
/** De kleuren van het scherm (zoals in het ontwerp: blauwig LCD). */
const LCD_ACHTER = [0x16, 0x23, 0x3a], LCD_PIXEL = [0xd9, 0xe8, 0xff];

let doc = null;              // mappings/maschine-mk2.json
let bron = undefined;        // de Maschine van de mixer (of null) waar `m` bij hoort
let m = null;                // het eigen exemplaar waar de kaart uit leest
let volgen = true;           // de stand van het apparaat overnemen
let shiftKnop = false;       // ⇧ shift bovenaan
let shiftToets = false;      // Shift op het toetsenbord vastgehouden (even gluren)
let shiftApparaat = false;   // SHIFT op de Maschine (live, als de kaart volgt)
let shift = false;           // wat de kaart toont: een van de drie
let gekozen = null;          // id van het aangeklikte control
let zoek = '';
let laatstGeraakt = '';      // sig@t van de laatst verwerkte aanraking (primitief: geen verwijzing naar de mixer vasthouden)
let vorigeSleutel = '';
let voorbeeld = null;        // de gekozen werkruimte als voorbeeld (spiekbrief.js laadVoorbeeld), of null
let voorbeeldDeel = null;    // het deel daarvan
let bronVersie = -1;         // de versie van de regels van de mixer-Maschine die we overnamen
const schermSleutel = ['', ''];

const plaat = document.getElementById('plaat');
const detail = document.getElementById('detail');
const live = document.getElementById('live');
const volgKnop = document.getElementById('volg');

/** De Maschine van de mixer die deze pagina opende, of null. */
function mixerMaschine() {
  try { return window.opener && !window.opener.closed ? window.opener.maschine ?? null : null; } catch (_) { return null; }
}

/** Het eigen exemplaar (opnieuw) maken: met de engine van de mixer, of zonder. */
function maak(van) {
  const vorig = m ? neemStand(m) : null;
  if (voorbeeld) {
    // Voorbeeldmodus: de stukken van de gekozen werkruimte en de mapjes van het deel; niets naar de mixer.
    m = maakVoorbeeldMaschine({ doc, v: voorbeeld, deel: voorbeeldDeel, engine: van?.engine ?? ZONDER, read: van?.read ?? (() => null),
      beschrijf, library: van?.library ?? null, nu: van?.nu });
  } else {
    m = new Maschine({
      engine: van?.engine ?? ZONDER,
      read: van?.read ?? (() => null),
      invoke: () => {},                    // de kaart stuurt nooit iets
      nu: van?.nu,
      beschrijf,
      library: van?.library ?? null,      // met de library open: de lijst op de schermen (alleen lezen)
      houd: new HoudRegister(),           // een houd-knop op de kaart opent niets in de mixer
    });
    if (doc) m.laadMapping(doc);
    // Volgt de kaart de mixer: dezelfde stukken als daar (alleen de regels; de kaart stuurt niets).
    for (const [b, lijst] of van?.mapping?.extra ?? []) m.mapping.vervangFragment(b, { rules: lijst.map(({ bron: _, ...r }) => r) });
    bronVersie = van?.mapping?._versie ?? -1;
    if (vorig) zetStand(m, vorig);
  }
  knoppenUitData();
  bron = van;
  // Wat er al was aangeraakt vóór de kaart (of deze mixer) er was, is geen aanraking van nu.
  laatstGeraakt = van?.geraakt ? `${van.geraakt.sig}@${van.geraakt.t}` : '';
}

const isLive = () => !!bron && bron.poort?.in?.state === 'connected';

// ---- tekenen ------------------------------------------------------------------------

function tekenPlaat(alles) {
  const vak = (l, t, w, h) => `<i class="vak" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%"></i>`;
  const op = (tekst, l, t) => `<b class="opschrift" style="left:${l}%;top:${t}%">${tekst}</b>`;
  plaat.innerHTML = vak(1.5, 2.5, 18, 26) + vak(1.5, 30, 21, 26.5) + vak(1.5, 55.5, 25, 13) + vak(1.5, 71, 25, 14)
    + vak(31.5, 42.5, 9, 52) + vak(43.5, 42.5, 54, 52)
    + op('Master', 2.5, 30.8) + op('Groups', 2.5, 56.2) + op('Transport', 2.5, 71.8) + op('Pads', 44.5, 43.2)
    + '<b class="logo">MASCHINE MK2</b>'
    + '<div class="lcd" style="left:24%"><canvas width="256" height="64" aria-label="linkerscherm"></canvas></div>'
    + '<div class="lcd" style="left:62%"><canvas width="256" height="64" aria-label="rechterscherm"></canvas></div>'
    + PLAATS.map(([id, vorm, x, y]) => {
      const r = alles.get(id);
      const binnen = ['knop', 'f', 'kolom', 'pad'].includes(vorm);
      const treffer = zoek ? `${r.kort} ${r.tekst} ${OPDRUK[id]} ${naamVan(id)}`.toLowerCase().includes(zoek) : false;
      const cls = ['c', `v-${vorm}`, `s-${r.soort}`, binnen ? 'binnen' : '', gekozen === id ? 'gekozen' : '',
        zoek ? (treffer ? 'treffer' : 'mis') : '', shift && r.shiftRegel ? 'shiftregel' : ''].join(' ');
      const label = vorm === 'pad' ? r.kort : r.kort || OPDRUK[id];
      return `<button type="button" class="${cls}" data-id="${esc(id)}" style="left:${x}%;top:${y}%"
        title="${esc(OPDRUK[id])} — ${esc(r.vrij ? 'vrij' : r.tekst)}"><i></i>${vorm === 'pad' ? `<b>${id.slice(3)}</b>` : ''}<span>${esc(label)}</span></button>`;
    }).join('');
  schermSleutel[0] = schermSleutel[1] = '';
}

/** Een scherm (2048 bytes, 1 bit) op zijn canvas, alleen als het veranderde. */
function tekenScherm1(nr, bytes) {
  const sleutel = bytes.join(',');
  if (schermSleutel[nr] === sleutel) return;
  schermSleutel[nr] = sleutel;
  const cv = plaat.querySelectorAll('.lcd canvas')[nr];
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const beeld = ctx.createImageData(BREED, HOOG);
  for (let y = 0; y < HOOG; y++) {
    for (let x = 0; x < BREED; x++) {
      const kl = leesPixel(bytes, x, y) ? LCD_PIXEL : LCD_ACHTER;
      const i = (y * BREED + x) * 4;
      beeld.data[i] = kl[0]; beeld.data[i + 1] = kl[1]; beeld.data[i + 2] = kl[2]; beeld.data[i + 3] = 255;
    }
  }
  ctx.putImageData(beeld, 0, 0);
}

function tekenSchermen() {
  const stand = m.stand();
  for (const nr of [0, 1]) {
    // Volgt de kaart het apparaat: precies wat er naar de Maschine ging. Anders: wat hij in deze stand zou tonen.
    const echt = volgen && isLive() ? bron.schermen?.[nr]?.data : null;
    tekenScherm1(nr, echt ?? tekenScherm(stand, nr));
  }
}

/**
 * Knoppen voor de pagina's en padmodi die een stuk erbij zet (spoor S6), naast die van de pagina zelf.
 * Alleen opnieuw als de lijst verandert.
 */
let dataSleutel = '';
function knoppenUitData() {
  const paginas = paginasVan(m).filter((p) => !document.querySelector(`[data-pagina="${CSS.escape(p)}"]:not(.uit-data)`));
  const padmodi = padmodiVan(m).filter((p) => p.data);
  const sleutel = JSON.stringify([paginas, padmodi.map((p) => p.id)]);
  if (sleutel === dataSleutel) return;
  dataSleutel = sleutel;
  document.querySelectorAll('.uit-data').forEach((el) => el.remove());
  const bij = (sel, html) => document.querySelector(sel)?.closest('.k-groep')?.insertAdjacentHTML('beforeend', html);
  for (const p of paginas) bij('[data-pagina]', `<button class="k-knop uit-data" data-pagina="${esc(p)}" title="uit een stuk (laag pagina.${esc(p)})">${esc(naamUitData(p))}</button>`);
  for (const p of padmodi) bij('[data-padmodus]', `<button class="k-knop uit-data" data-padmodus="${esc(p.id)}" title="uit een stuk (laag pads.${esc(p.id)})">${esc(p.id)}</button>`);
}

/** De kiezer werkruimte + deel (voorbeeldmodus), bovenaan naast de pagina's. */
async function opzetKiezer() {
  const plek = document.getElementById('shift');
  if (!plek) return;
  plek.insertAdjacentHTML('beforebegin', `<div class="k-groep" id="werk-kiezer"><span>werkruimte</span>
    <select id="werk-kies" class="k-knop" title="bekijk een werkruimte zonder hem te activeren"><option value="">— (zoals de Maschine nu is)</option></select>
    <select id="deel-kies" class="k-knop" title="het deel (F1–F8)" hidden></select>
    <a class="k-knop" id="spiek" href="spiekbrief.html" target="_blank" rel="noopener" title="de spiekbrief: per deel wat elke knop doet, om te printen">spiekbrief</a></div>`);
  const werkKies = document.getElementById('werk-kies'), deelKies = document.getElementById('deel-kies');
  for (const w of await lijstWerkruimtes(haalJson)) werkKies.insertAdjacentHTML('beforeend', `<option value="${esc(w.naam)}">${esc(w.naam)}${w.titel && w.titel !== w.naam ? ` · ${esc(w.titel)}` : ''}</option>`);
  const toonDelen = () => {
    const delen = voorbeeld ? delenVan(voorbeeld).filter((d) => d.naam) : [];
    deelKies.hidden = !delen.length;
    deelKies.innerHTML = delen.map((d) => `<option value="${esc(d.naam)}"${d.naam === voorbeeldDeel ? ' selected' : ''}>F${d.nr} ${esc(d.label)}</option>`).join('');
  };
  werkKies.addEventListener('change', async () => {
    const naam = werkKies.value;
    voorbeeld = naam ? await laadVoorbeeld(naam, haalJson) : null;
    voorbeeldDeel = voorbeeld ? delenVan(voorbeeld).find((d) => d.naam)?.naam ?? null : null;
    if (voorbeeld) volgen = false;
    document.getElementById('spiek').href = `spiekbrief.html${naam ? `?werk=${encodeURIComponent(naam)}` : ''}`;
    toonDelen();
    maak(mixerMaschine());
    teken({ altijd: true });
  });
  deelKies.addEventListener('change', () => { voorbeeldDeel = deelKies.value || null; maak(mixerMaschine()); teken({ altijd: true }); });
}

async function haalJson(url) {
  const r = await fetch(url);
  if (!r.ok) { try { await r.body?.cancel(); } catch (_) {} return null; }
  return r.json();
}

function tekenKop() {
  document.querySelectorAll('[data-pagina]').forEach((el) => el.classList.toggle('aan', m.pagina === el.dataset.pagina));
  document.querySelectorAll('[data-padmodus]').forEach((el) => el.classList.toggle('aan', padmodusVan(m) === el.dataset.padmodus));
  document.getElementById('shift').classList.toggle('aan', shift);
  // Kort, zodat de kop op één regel blijft; de uitleg staat in de tooltip.
  const [tekst, uitleg] = !bron ? ['niet live', 'open de kaart vanuit de mixer (met de hub) om de Maschine te volgen']
    : !isLive() ? ['Maschine niet verbonden', 'de mixer heeft de Maschine nu niet: draait de hub, en heeft dit tabblad hem?']
      : volgen ? ['live: volgt de Maschine', 'de kaart neemt de pagina, de padmodus en shift van het apparaat over']
        : ['live · andere stand', 'je kijkt naar een andere stand dan de Maschine: "volg de Maschine" om terug te gaan'];
  live.textContent = tekst;
  live.title = uitleg;
  live.classList.toggle('aan', isLive() && volgen);
  volgKnop.classList.toggle('zicht', isLive() && !volgen);
}

function tekenDetail(alles) {
  if (!gekozen) {
    detail.innerHTML = '<h3>Klik op een knop</h3><p class="dim">…of raak hem aan op de Maschine (vanuit de mixer, met de hub). '
      + 'Hier zie je wat hij nu doet, met shift, en in de andere pagina\'s of padmodi.</p>'
      + '<p class="dim">Zoek hierboven op een functie ("filter", "patroon", "focus") om te zien waar hij zit.</p>';
    return;
  }
  const r = alles.get(gekozen);
  const deel = DELEN.find(([, ids]) => ids.includes(gekozen))?.[0] ?? '';
  const rijen = perStand(m, gekozen);
  detail.innerHTML = `
    <h3><i class="stip s-${r.soort}"></i>${esc(naamVan(gekozen))}</h3>
    <p class="dim">${esc(deel)}${OPDRUK[gekozen] !== naamVan(gekozen) ? ` · op de knop: ${esc(OPDRUK[gekozen])}` : ''}</p>
    <dl><dt>doet nu</dt><dd>${r.vrij ? '<span class="dim">niets (vrij)</span>' : esc(r.tekst)}</dd></dl>
    ${rijen.length ? `<h4>${/^pad/.test(gekozen) ? 'per padmodus' : /^k\d$/.test(gekozen) ? 'per pagina' : 'library dicht of open'}</h4><table>${rijen.map((x) =>
    `<tr class="${x.nu ? 'nu' : ''}"><td>${esc(x.naam)}</td><td>${esc(x.tekst)}</td></tr>`).join('')}</table>` : ''}`;
}

function tekenLijst(alles) {
  document.getElementById('lijst').innerHTML = DELEN.map(([titel, ids]) => {
    const rijen = ids.map((id) => alles.get(id)).filter((r) => !r.vrij)
      .map((r) => `<tr data-id="${esc(r.id)}"><td><i class="stip s-${r.soort}"></i>${esc(OPDRUK[r.id])}</td><td>${esc(r.tekst)}</td></tr>`).join('');
    return `<section><h3>${esc(titel)}</h3>${rijen ? `<table>${rijen}</table>` : '<p class="dim">nog niets (vrij)</p>'}</section>`;
  }).join('');
}

function tekenLegenda(alles) {
  const soorten = [...new Set([...alles.values()].map((r) => r.soort))];
  document.getElementById('legenda').innerHTML = soorten.sort((a, b) => (a === 'vrij') - (b === 'vrij'))
    .map((s) => `<span><i class="stip s-${s}"></i>${esc(soortNaam(s))}</span>`).join('');
}

/** Alles opnieuw als er iets veranderde (de stand, wat de knoppen doen); de schermen altijd (die vergelijken zelf). */
function teken({ altijd = false } = {}) {
  const alles = leesAlles(m, { shift });
  // Met de tabel per stand van wat gekozen is: die kan veranderen zonder dat de stand van nu verandert.
  const sleutel = JSON.stringify([...alles.values()].map((r) => [r.kort, r.tekst, r.soort, r.vrij]))
    + `|${shift}|${gekozen}|${zoek}|${m.pagina}|${padmodusVan(m)}|${gekozen ? JSON.stringify(perStand(m, gekozen)) : ''}`;
  tekenKop();
  if (altijd || sleutel !== vorigeSleutel) {
    vorigeSleutel = sleutel;
    tekenPlaat(alles);
    tekenDetail(alles);
    tekenLijst(alles);
    tekenLegenda(alles);
  }
  tekenSchermen();
}

// ---- live: de Maschine van de mixer volgen -------------------------------------------------

function flits(id) {
  const el = plaat.querySelector(`[data-id="${CSS.escape(id)}"]`);
  el?.classList.add('geraakt');
  setTimeout(() => el?.classList.remove('geraakt'), 400);
}

function tik() {
  // Verborgen: niets rekenen (dit venster deelt de hoofdthread met de mixer). Terug in beeld: meteen bij.
  if (document.hidden) return;
  const van = mixerMaschine();
  // Een andere Maschine, of de werkruimte van de mixer zette andere stukken: opnieuw (de stand blijft).
  if (van !== bron || (!voorbeeld && (van?.mapping?._versie ?? -1) !== bronVersie)) maak(van);
  if (volgen && isLive()) zetStand(m, neemStand(bron));
  shiftApparaat = volgen && isLive() && !!bron.mapping?.shift;
  shift = shiftKnop || shiftToets || shiftApparaat;
  let geraakt = null;
  const g = isLive() ? bron.geraakt : null;
  if (g && `${g.sig}@${g.t}` !== laatstGeraakt) {
    laatstGeraakt = `${g.sig}@${g.t}`;
    // Ook als de kaart niet volgt: dan zie je wat die knop doet in de stand die je bekijkt.
    const id = idVanSig(g.sig);
    if (id && id !== 'shift') { gekozen = id; geraakt = id; }
  }
  teken();
  if (geraakt) flits(geraakt);
}

// ---- bediening op de pagina ---------------------------------------------------------------

/** Zelf een stand kiezen: dan volgt de kaart het apparaat niet meer (tot "volg de Maschine"). */
function zelf(fn) { fn(); volgen = false; teken(); }

plaat.addEventListener('click', (e) => {
  const el = e.target.closest('[data-id]');
  gekozen = el ? (gekozen === el.dataset.id ? null : el.dataset.id) : null;
  teken();
});
document.getElementById('lijst').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  gekozen = tr.dataset.id;
  teken();
  plaat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
// Ook voor de knoppen die een stuk erbij zet (knoppenUitData): één luisteraar op de kop.
document.querySelector('.k-kop').addEventListener('click', (e) => {
  const p = e.target.closest('[data-pagina]'), pm = e.target.closest('[data-padmodus]');
  if (p) zelf(() => m.zetPagina(p.dataset.pagina));
  else if (pm) zelf(() => zetPadmodus(m, pm.dataset.padmodus));
});
const zetShift = () => { shift = shiftKnop || shiftToets || shiftApparaat; teken(); };
document.getElementById('shift').addEventListener('click', () => { shiftKnop = !shiftKnop; zetShift(); });
volgKnop.addEventListener('click', () => {
  // Volgen = de Maschine zoals hij nu is: geen voorbeeld meer.
  if (voorbeeld) { voorbeeld = null; voorbeeldDeel = null; const k = document.getElementById('werk-kies'); if (k) k.value = ''; document.getElementById('deel-kies')?.setAttribute('hidden', ''); maak(mixerMaschine()); }
  volgen = true; tik();
});
document.getElementById('zoek').addEventListener('input', (e) => { zoek = e.target.value.trim().toLowerCase(); teken(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { gekozen = null; zoek = ''; document.getElementById('zoek').value = ''; teken(); }
  if (e.key === 'Shift' && !e.repeat && e.target.tagName !== 'INPUT') { shiftToets = true; zetShift(); }
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift' && shiftToets) { shiftToets = false; zetShift(); } });
window.addEventListener('blur', () => { if (shiftToets) { shiftToets = false; zetShift(); } });

// ---- starten ---------------------------------------------------------------------------------

try {
  doc = await (await fetch('mappings/maschine-mk2.json')).json();
  document.getElementById('bron').textContent = `mappings/maschine-mk2.json, ${doc.rules?.length ?? 0} regels`;
} catch (err) {
  document.getElementById('bron').textContent = `mappings/maschine-mk2.json kon niet gelezen worden (${err.message})`;
}
maak(mixerMaschine());
teken({ altijd: true });
opzetKiezer().catch((err) => console.warn('[maschine-kaart] kiezer', err));
setInterval(tik, ELKE_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tik(); });
// "terug naar de mixer": de mixer die deze kaart opende naar voren, geen tweede mixer in dit venster.
document.getElementById('terug').addEventListener('click', (e) => {
  try { if (window.opener && !window.opener.closed) { e.preventDefault(); window.opener.focus(); } } catch (_) { /* dan gewoon de link */ }
});
