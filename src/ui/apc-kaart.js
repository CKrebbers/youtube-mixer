import { Mapping, resolveTarget } from '../control/mapping.js';
import { GROEPEN, LAAGNAAM } from '../control/lagen.js';
import apc from '../control/devices/apc40mk2.js';
import { esc } from './dom.js';
import { beschrijf } from './apc-beschrijf.js';

/**
 * De APC-kaarten: per mapje een tekening van de APC40 mkII met wat elke knop
 * doet, plus een tabel. Niets hiervan staat met de hand in deze pagina: hij
 * leest dezelfde mapping als de app (je eigen versie als die er is, anders de
 * standaard) en vraagt aan dezelfde `Mapping.kies()` welke regel geldt. Pas je
 * de mapping aan, dan klopt deze pagina vanzelf.
 *
 * De tekening is een schema: de plaats van de knoppen is bij benadering.
 */

// ---- het apparaat, schematisch (x, y in procenten) ------------------------

const K = (sig, x, y, soort) => ({ sig, x, y, soort });
const kolX = (i) => 5 + i * 7;
const PLAAT = [];
for (let i = 0; i < 8; i++) {
  PLAAT.push(K(`cc:0:${48 + i}`, kolX(i), 5, 'knop-rond'));                       // track knobs
  for (let rij = 1; rij <= 5; rij++) PLAAT.push(K(`note:0:${apc.gridNote(i + 1, rij)}`, kolX(i), 9 + rij * 6.2, 'pad'));
  PLAAT.push(K(`note:${i}:52`, kolX(i), 47, 'knop'));                              // clip stop
  PLAAT.push(K(`note:${i}:51`, kolX(i), 52, 'knop'));                              // track select
  PLAAT.push(K(`note:${i}:50`, kolX(i), 57, 'knop'));                              // activator
  PLAAT.push(K(`note:${i}:49`, kolX(i), 62, 'knop'));                              // solo
  PLAAT.push(K(`note:${i}:48`, kolX(i), 67, 'knop'));                              // record arm
  PLAAT.push(K(`note:${i}:66`, kolX(i), 72, 'knop'));                              // A/B
  PLAAT.push(K(`cc:${i}:7`, kolX(i), 84, 'fader'));
}
for (let s = 1; s <= 5; s++) PLAAT.push(K(`note:0:${81 + s}`, 62, 9 + s * 6.2, 'scene'));
PLAAT.push(K('note:0:81', 62, 47, 'knop'));            // stop all clips
PLAAT.push(K('cc:0:14', 62, 84, 'fader'));             // master
PLAAT.push(K('cc:0:15', 30, 96, 'xfader'));            // crossfader
// rechts: kiesknoppen, device-sectie, transport
[['note:0:87', 72], ['note:0:88', 79], ['note:0:89', 86]].forEach(([s, x]) => PLAAT.push(K(s, x, 5, 'knop')));
PLAAT.push(K('cc:0:13', 94, 5, 'encoder'));
for (let i = 0; i < 8; i++) PLAAT.push(K(`cc:0:${16 + i}`, 72 + (i % 4) * 7.3, i < 4 ? 15 : 24, 'knop-rond'));
[['note:0:58', 72, 33], ['note:0:59', 79.3, 33], ['note:0:60', 86.6, 33], ['note:0:61', 93.9, 33],
  ['note:0:62', 72, 38], ['note:0:63', 79.3, 38], ['note:0:64', 86.6, 38], ['note:0:65', 93.9, 38]]
  .forEach(([s, x, y]) => PLAAT.push(K(s, x, y, 'knop')));
PLAAT.push(K('note:0:98', 72, 47, 'knop'));            // shift
PLAAT.push(K('note:0:103', 79.3, 47, 'knop'));         // bank lock
PLAAT.push(K('note:0:94', 90, 45, 'pijl'));
PLAAT.push(K('note:0:97', 86, 50, 'pijl'));
PLAAT.push(K('note:0:96', 94, 50, 'pijl'));
PLAAT.push(K('note:0:95', 90, 55, 'pijl'));
[['note:0:99', 72, 63], ['note:0:100', 79.3, 63], ['note:0:101', 86.6, 63]].forEach(([s, x, y]) => PLAAT.push(K(s, x, y, 'knop')));
PLAAT.push(K('cc:0:47', 94, 63, 'encoder'));
[['note:0:91', 72, 72], ['note:0:93', 79.3, 72], ['note:0:102', 86.6, 72], ['note:0:90', 93.9, 72]]
  .forEach(([s, x, y]) => PLAAT.push(K(s, x, y, 'knop')));

const naamVan = (sig) => apc.label(sig) ?? sig;

// ---- de kaarten ------------------------------------------------------------

const STANDAARD = Object.fromEntries(Object.entries(GROEPEN).map(([g, d]) => [g, d.standaard]));

/** Welke kaarten er zijn: de kern, shift, en elk mapje. */
function kaarten() {
  const lijst = [
    { id: 'kern', titel: 'Vaste kern', uitleg: 'Wat altijd hetzelfde doet, in welk mapje je ook zit. Hier grijp je blind naar.',
      stand: STANDAARD, shift: false, filter: (r) => !r.laag },
    { id: 'shift', titel: 'Met shift', uitleg: 'Houd SHIFT vast. Wat hier niet oplicht, doet met shift hetzelfde als zonder.',
      stand: STANDAARD, shift: true, filter: (r) => r.shift },
  ];
  for (const [g, d] of Object.entries(GROEPEN)) {
    for (const [knop, lagen] of Object.entries(d.knoppen)) {
      for (const laag of lagen) {
        const id = `${g}.${laag}`;
        lijst.push({ id, groep: g, titel: `${d.naam}: ${LAAGNAAM[id] ?? laag}`, kiesknop: `layer.${g}.${knop}`,
          uitleg: g === 'grid' ? 'Kies met SHIFT + scene launch, of blader met pijl ▲ ▼.' : 'Kies met de oplichtende kiesknop. Vasthouden = even gluren.',
          stand: { ...STANDAARD, [g]: laag }, shift: false, filter: (r) => r.laag === id, metShift: true });
      }
    }
  }
  return lijst;
}

function tekenKaart(mapping, kaart) {
  const lagen = Object.entries(kaart.stand).map(([g, l]) => `${g}.${l}`);
  mapping.lagen = () => lagen;
  const rij = [];
  const knoppen = PLAAT.map((k) => {
    const regel = mapping.kies(k.sig, { shift: kaart.shift });
    const hoort = regel && kaart.filter(regel);
    const kies = regel && kaart.kiesknop && regel.action === kaart.kiesknop;
    const metShift = kaart.metShift && hoort ? mapping.kies(k.sig, { shift: true }) : null;
    if (hoort) rij.push({ k, regel, metShift: metShift && metShift !== regel ? metShift : null });
    const b = regel ? beschrijf(resolveTarget(regel.action, {})) : null;
    const cls = ['apc-c', k.soort, hoort ? 'aan' : regel ? 'dof' : 'leeg', kies ? 'kies' : ''].join(' ');
    return `<div class="${cls}" style="left:${k.x}%;top:${k.y}%" title="${esc(naamVan(k.sig))}${regel ? ` — ${esc(beschrijf(regel.action).lang)}` : ''}">
      <i></i><span>${hoort || kies ? esc(b.kort) : ''}</span></div>`;
  }).join('');

  // Tabel: wat per kolom hetzelfde doet ("clip stop 1–8") wordt één regel.
  const groepen = new Map();
  for (const { k, regel, metShift } of rij) {
    const knop = naamVan(k.sig);
    const m = /(\d)(\/\d)?$/.exec(knop);
    const n = m ? m[1] : null;
    const alg = (t) => (n ? t.replaceAll(`track ${n}`, 'track N').replaceAll(`sampler-pad ${n}`, 'sampler-pad N') : t);
    const doet = alg(beschrijf(regel.action).lang);
    const shift = metShift ? alg(beschrijf(metShift.action).lang) : '';
    const sleutel = [n ? knop.replace(/(\d)(\/\d)?$/, 'N$2') : knop, doet, shift].join('|');
    if (!groepen.has(sleutel)) groepen.set(sleutel, { knop, n: [], doet, shift, tpl: n ? knop.replace(/(\d)(\/\d)?$/, '#$2') : null });
    if (n) groepen.get(sleutel).n.push(n);
  }
  const bereik = (ns) => (ns.length > 2 && ns.every((x, i) => i === 0 || +x === +ns[i - 1] + 1) ? `${ns[0]}–${ns.at(-1)}` : ns.join(', '));
  const leesbaar = (t, meer) => (meer ? t.replaceAll('track N', 'de track van die kolom').replaceAll('sampler-pad N', 'de sampler-pad van die kolom') : t.replaceAll('track N', 'track').replaceAll('sampler-pad N', 'sampler-pad'));
  const tabel = [...groepen.values()].map((g) => {
    const meer = g.n.length > 1;
    const knop = g.tpl ? g.tpl.replace('#', meer ? bereik(g.n) : g.n[0]) : g.knop;
    const eén = (t) => (meer ? leesbaar(t, true) : t.replaceAll('track N', `track ${g.n[0]}`).replaceAll('sampler-pad N', `sampler-pad ${g.n[0]}`));
    return `<tr><td>${esc(knop)}</td><td>${esc(eén(g.doet))}</td>
      ${kaart.metShift ? `<td>${g.shift ? esc(eén(g.shift)) : '<span class="dim">—</span>'}</td>` : ''}</tr>`;
  }).join('');

  return `<section class="apc-kaart" id="${esc(kaart.id)}">
    <h2>${esc(kaart.titel)}</h2>
    <p>${esc(kaart.uitleg)}</p>
    <div class="apc-plaat">${knoppen}<b class="apc-deel links">clip-grid en trackstrips</b><b class="apc-deel rechts">device en transport</b></div>
    <table class="apc-tabel"><thead><tr><th>knop</th><th>doet</th>${kaart.metShift ? '<th>met shift</th>' : ''}</tr></thead>
      <tbody>${tabel || '<tr><td colspan="3" class="dim">niets in dit mapje</td></tr>'}</tbody></table>
  </section>`;
}

async function laadMapping() {
  try {
    const r = await fetch('/api/mapping');
    const j = r.ok ? await r.json() : null;
    if (j?.mapping?.rules?.length) return { doc: j.mapping, bron: 'jouw eigen mapping (van de server)' };
  } catch (_) {}
  const r = await fetch('mappings/apc40mk2.json');
  return { doc: await r.json(), bron: 'de standaardmapping' };
}

const { doc, bron } = await laadMapping();
const mapping = new Mapping({ read: () => null, invoke: () => {} });
mapping.load(doc);
const lijst = kaarten();
document.getElementById('bron').textContent = `Gelezen uit ${bron}: ${mapping.rules.size} regels.`;
document.getElementById('inhoud').innerHTML = lijst.map((k) => `<a href="#${esc(k.id)}">${esc(k.titel)}</a>`).join('');
document.getElementById('kaarten').innerHTML = lijst.map((k) => tekenKaart(mapping, k)).join('');
// De kaarten bestaan pas nu: een link naar #mapje springt daarom hier pas.
if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
