/**
 * Het instappunt: AudioContext, engine, scherm. Het scherm stuurt alleen via de
 * bus en leest elke frame de stand terug; tekenen gebeurt alleen als iets
 * veranderde (v1: elke teken-actie is een upload naar de GPU).
 */
import { Engine } from '../engine/engine.js';
import { maakAudio } from '../audio/index.js';
import { maakKnop, maakFader, maakJog, bindKnoppen, bindSchuiven } from './bediening.js';
import { overzicht, overzichtUitPeaks, maakDemo, DEMOS, stroomVanWav } from './bronnen.js';

const $ = (s, w = document) => w.querySelector(s);
const tijd = (s) => { if (!Number.isFinite(s)) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

// ---- opzet ----------------------------------------------------------------------

const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
const audio = maakAudio();
const engine = new Engine({ ctx, audio });
window.varve = engine;   // voor de console en de headless proeven
const bus = engine.bus;
const overzichten = new Map();   // n -> Float32Array

// ---- tracks opbouwen ---------------------------------------------------------------

const tpl = $('#tpl-track');
const tracksEl = $('#tracks');
const vakken = [];
for (const t of engine.tracks) {
  const n = t.n;
  const frag = tpl.content.cloneNode(true);
  const el = frag.querySelector('.track');
  el.dataset.n = n;
  for (const x of el.querySelectorAll('[data-actie], [data-waarde], [data-kill], [data-jog]')) {
    for (const k of ['actie', 'waarde', 'kill', 'jog']) if (x.dataset[k]) x.dataset[k] = x.dataset[k].replace('{n}', n);
  }
  el.querySelector('.t-nr').textContent = n;
  tracksEl.append(el);
  const knoppen = [...el.querySelectorAll('.knop')].map((k) => maakKnop(k, bus));
  const [pitch, vol] = [...el.querySelectorAll('.fader')].map((f) => maakFader(f, bus));
  maakJog(el.querySelector('.jog'), bus, n);
  const cv = el.querySelector('.t-overzicht');
  cv.addEventListener('pointerdown', (e) => {
    if (!t.geladen) return;
    const r = cv.getBoundingClientRect();
    bus.doe(`track.${n}.seek`, (e.clientX - r.left) / r.width);
  });
  // Slepen vanuit de library.
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('sleep-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('sleep-over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('sleep-over'); const id = e.dataTransfer.getData('text/varve-nummer'); if (id) laadOp(n, id); });
  vakken.push({
    t, n, el, knoppen, pitch, vol, cv, sleutel: '',
    titel: el.querySelector('.t-titel b'), sub: el.querySelector('.t-titel small'),
    rest: el.querySelector('.t-rest'), bpm: el.querySelector('.t-bpm'),
    fase: el.querySelector('.t-fase i'), kant: el.querySelector('.t-kant'),
    knop: (s) => el.querySelector(s),
  });
}
bindKnoppen(document.body, bus);
const schuiven = bindSchuiven(document.body, bus);

// ---- meldingen ----------------------------------------------------------------------

const meldEl = $('#meldingen');
const metSleutel = new Map();
engine.on('melding', ({ tekst, soort, sleutel }) => {
  let m = sleutel ? metSleutel.get(sleutel) : null;
  if (!m) {
    m = document.createElement('div');
    m.innerHTML = '<span></span><button aria-label="weg">×</button>';
    m.querySelector('button').onclick = () => { m.remove(); if (sleutel) metSleutel.delete(sleutel); };
    meldEl.append(m);
    if (sleutel) metSleutel.set(sleutel, m);
  }
  m.className = `melding ${soort}`;
  m.querySelector('span').textContent = tekst;
  // Een fout blijft staan tot je hem wegklikt (v1); de rest gaat na 4 s.
  clearTimeout(m._weg);
  if (soort !== 'fout') m._weg = setTimeout(() => { m.remove(); if (sleutel) metSleutel.delete(sleutel); }, 4000);
});
engine.on('laad', ({ n, stand }) => { if (stand !== 'klaar') return; engine.meld(`track ${n}: ${engine.track(n).nummer.titel}`, 'info', `laad:${n}`); });

// ---- geluid aan (Chrome start een AudioContext pas na een handeling) ----------------------

const start = $('#start');
const zetStart = () => { start.hidden = ctx.state === 'running'; };
start.onclick = () => ctx.resume().then(zetStart);
ctx.addEventListener('statechange', zetStart);
// Elke klik zolang hij niet loopt (ook na een slaap), niet alleen de eerste.
document.addEventListener('pointerdown', () => { if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().then(zetStart); });
document.addEventListener('keydown', () => { if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().then(zetStart); });
zetStart();

// ---- de library -------------------------------------------------------------------------

const nummers = new Map();
for (const d of DEMOS) {
  // Het grid van een demo staat pas vast als hij gemaakt is; voor de lijst volstaat het tempo.
  nummers.set(d.id, { ...d, titel: d.titel, artiest: 'demo', demo: true, duur: d.duur ?? 120, gridLijst: d.pad ? null : { slot: true, stukken: [{ bpm: d.bpm }] } });
}

async function haalLibrary() {
  try {
    const r = await fetch('/api/library');
    const j = await r.json();
    for (const x of j.nummers) nummers.set(x.id, { ...x, demo: false });
    $('#bieb-bron').textContent = j.bron ? `v1-library: ${j.nummers.length} nummers (alleen lezen)` : 'geen v1-library gevonden: alleen demonummers';
  } catch {
    $('#bieb-bron').textContent = 'server niet bereikbaar: alleen demonummers';
  }
  toonLibrary();
}

function gridTekst(x) {
  const g = x.grid ?? x.gridLijst;
  const s = g?.stukken?.[0];
  if (!s) return { bpm: '—', onzeker: true };
  const z = g.slot || s.zekerheid === undefined || s.zekerheid >= 0.65;
  return { bpm: s.bpm.toFixed(1).replace('.', ','), onzeker: !z };
}

function toonLibrary() {
  const q = $('#zoek').value.trim().toLowerCase();
  const lijst = $('#bieb-lijst');
  lijst.replaceChildren();
  for (const x of nummers.values()) {
    if (q && !`${x.titel} ${x.artiest}`.toLowerCase().includes(q)) continue;
    const li = document.createElement('li');
    li.draggable = true;
    li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/varve-nummer', x.id));
    const g = gridTekst(x);
    li.innerHTML = '<span class="titel"></span><span class="cijfer bpm"></span><span class="cijfer duur"></span><span class="laad"></span>';
    li.querySelector('.titel').textContent = x.titel;
    if (x.artiest) li.querySelector('.titel').insertAdjacentHTML('beforeend', `<small></small>`), li.querySelector('.titel small').textContent = x.artiest;
    if (x.demo) li.querySelector('.titel').insertAdjacentHTML('beforeend', '<span class="demo">DEMO</span>');
    const b = li.querySelector('.bpm'); b.textContent = g.bpm; if (g.onzeker) { b.classList.add('grid-onzeker'); b.title = 'grid onzeker of ontbreekt: sync weigert'; }
    li.querySelector('.duur').textContent = tijd(x.duur);
    const laad = li.querySelector('.laad');
    for (let n = 1; n <= 8; n++) {
      const k = document.createElement('button');
      k.textContent = n; k.title = `laad op track ${n}`;
      k.onclick = () => laadOp(n, x.id);
      laad.append(k);
    }
    lijst.append(li);
  }
}
$('#zoek').addEventListener('input', toonLibrary);

const laatsteDruk = new Map();
function laadOp(n, id) {
  const x = nummers.get(id);
  if (!x) return;
  const nummer = {
    id: x.id, titel: x.titel, artiest: x.artiest, duur: x.duur, grid: null,
    haal: async () => {
      let pcm, grid = x.grid ?? null;
      if (x.demo) { const d = maakDemo(x); pcm = d.maakPcm(); grid = d.grid; }
      else {
        // Uit de library: streamen (M7), niet het hele bestand in het geheugen.
        pcm = await stroomVanWav(`/api/library/${encodeURIComponent(x.id)}/audio`);
      }
      nummer.grid = grid;
      overzichten.set(n, pcm.paginas ? overzicht(pcm) : null);
      if (!pcm.paginas) {
        fetch(`/api/library/${encodeURIComponent(x.id)}/peaks`)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((b) => { if (b && engine.track(n).nummer?.id === x.id) overzichten.set(n, overzichtUitPeaks(b)); })
          .catch(() => { /* geen overzicht: niet erg */ });
      }
      return pcm;
    },
  };
  // Een spelende, hoorbare track vervang je pas bij een tweede druk binnen 3 s (v1).
  const nu = performance.now();
  if (engine.track(n).speelt && engine.hoorbaar(n) && !(laatsteDruk.get(n) > nu - 3000)) {
    laatsteDruk.set(n, nu);
    engine.meld(`track ${n} speelt: druk nog eens om te vervangen`, 'info', `laad:${n}`);
    return;
  }
  laatsteDruk.delete(n);
  nummer.zeker = true;
  bus.doe(`track.${n}.laad`, nummer);
}

// ---- tekenen ------------------------------------------------------------------------------

const klokEl = $('#klok'), klokBpm = $('#klok-bpm'), klokMaat = $('#klok-maat');
const tellen = [...document.querySelectorAll('#klok-tellen i')];
tellen[0].classList.add('een');
const meterM = [...document.querySelectorAll('#meter-master i')];

function tekenOverzicht(v, nu) {
  const t = v.t, cv = v.cv;
  const w = Math.round(cv.clientWidth * devicePixelRatio), h = Math.round(cv.clientHeight * devicePixelRatio);
  if (!t.geladen || !w) { if (v.sleutel !== 'leeg') { cv.width = w; cv.getContext('2d').clearRect(0, 0, w, h); v.sleutel = 'leeg'; } return; }
  const duur = t.nummer.duur;
  const plek = t.plek(nu - engine.vertraging() * (t.speelt ? 1 : 0));
  const x = Math.round((plek / duur) * w);
  const sleutel = `${t.nummer.id}|${w}|${x}|${Math.round((t.cue / duur) * w)}|${overzichten.get(v.n) ? 1 : 0}`;   // het overzicht kan later komen (peaks)
  if (sleutel === v.sleutel) return;
  v.sleutel = sleutel;
  if (cv.width !== w) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const pk = overzichten.get(v.n);
  if (pk) {
    const mid = h / 2;
    for (let i = 0; i < w; i++) {
      const a = pk[Math.floor((i / w) * pk.length)] * mid * 0.95;
      g.fillStyle = i < x ? '#4a515b' : '#9aa3ad';
      g.fillRect(i, mid - a, 1, Math.max(1, a * 2));
    }
  }
  const grid = t.grid;
  if (grid && duur < 1200) {
    // Een streepje per maat: zie je meteen of het grid klopt.
    g.fillStyle = 'rgba(244,239,230,.18)';
    const b0 = Math.ceil(grid.beatAt(0)), b1 = grid.beatAt(duur);
    for (let b = b0; b < b1; b++) if (grid.isMaatbegin(b)) g.fillRect(Math.round((grid.timeOf(b) / duur) * w), 0, 1, h * 0.18);
  }
  g.fillStyle = '#f2a51a'; g.fillRect(Math.round((t.cue / duur) * w), 0, 2, h);
  g.fillStyle = '#ffffff'; g.fillRect(x - 1, 0, 2, h);
}

let vorigeTel = -1;
function teken() {
  const nu = engine.nu();
  // De klok, zoals je hem hoort.
  const c = engine.hoorbareTel();
  klokEl.classList.toggle('stil', c === null);
  if (c === null) {
    if (klokBpm.textContent !== '—') { klokBpm.textContent = '—'; klokMaat.textContent = 'klok staat stil'; }
    for (const i of tellen) i.classList.remove('aan');
  } else {
    const bpm = engine.klok.bpm(nu).toFixed(2).replace('.', ',');
    if (klokBpm.textContent !== bpm) klokBpm.textContent = bpm;
    const tel = Math.floor(c), inMaat = ((tel % 4) + 4) % 4;
    if (tel !== vorigeTel) {
      vorigeTel = tel;
      tellen.forEach((i, k) => i.classList.toggle('aan', k === inMaat));
      klokMaat.textContent = `maat ${Math.floor(tel / 4) + 1} · tel ${inMaat + 1}`;
    }
    // Een kwart tel aan, dan uit: de tel knippert op wat je hoort.
    const frac = c - tel;
    tellen[inMaat].classList.toggle('aan', frac < 0.25);
  }
  for (const v of vakken) {
    const t = v.t;
    for (const k of v.knoppen) k.teken();
    const r = t.geladen ? t.pitchRate : null;
    const pct = (x) => `${x >= 1 ? '+' : '−'}${Math.abs((x - 1) * 100).toFixed(1).replace('.', ',')}%`;
    v.pitch.teken(t.gekoppeld ? pct(t.snelheid(nu)) : r !== null ? pct(r) : '');
    v.vol.teken();
    const titel = t.nummer?.titel ?? '—', sub = t.nummer ? (t.nummer.artiest || (t.grid ? '' : 'geen grid: speelt vrij')) : 'leeg';
    if (v.titel.textContent !== titel) v.titel.textContent = titel;
    if (v.sub.textContent !== sub) v.sub.textContent = sub;
    const rest = t.geladen ? t.nummer.duur - t.plek(nu) : NaN;
    const restT = t.geladen ? `−${tijd(rest)}` : '—';
    if (v.rest.textContent !== restT) v.rest.textContent = restT;
    v.rest.classList.toggle('kort', t.speelt && rest < 30);
    const bpm = t.geladen ? t.bpm(nu) : null;
    const bpmT = bpm ? bpm.toFixed(1).replace('.', ',') : '—';
    if (v.bpm.textContent !== bpmT) v.bpm.textContent = bpmT;
    // Fasemeter: waar ligt het nummer t.o.v. de klok (−½ … +½ tel)?
    let fase = null;
    if (t.geladen && t.grid && engine.klok.loopt && t.speelt) {
      const d = t.grid.beatAt(t.plek(nu)) - engine.klok.tel(nu);
      fase = d - Math.round(d);
    }
    v.el.classList.toggle('gekoppeld', t.gekoppeld);
    v.el.classList.toggle('vrij-grid', !t.gekoppeld && fase !== null);
    if (fase !== null) v.fase.style.left = `${50 + fase * 100}%`;
    const play = bus.lees(`track.${v.n}.play`);
    v.knop('.b-play').classList.toggle('aan', play === 0.5);
    v.knop('.b-play').classList.toggle('wacht', play === 1);
    v.knop('.b-quant').classList.toggle('wacht', play === 1);
    v.knop('.b-sync').classList.toggle('aan', bus.lees(`track.${v.n}.sync`) === 1);
    for (const s of ['.b-play', '.b-cue', '.b-sync', '.b-klok', '.b-quant']) v.knop(s).disabled = !t.geladen;
    if (v.kant.textContent !== t.kant) { v.kant.textContent = t.kant; v.kant.className = `t-kant ${t.kant}`; }
    tekenOverzicht(v, nu);
  }
  schuiven.teken();
  const m = engine.mixer.meterMaster?.();
  if (m) {
    const h = `${Math.min(100, Math.max(0, (20 * Math.log10(m.piek + 1e-9) + 48) / 48 * 100))}%`;
    for (const i of meterM) { i.style.setProperty('--h', h); i.classList.toggle('rood', m.piek > 0.89); }
  }
  requestAnimationFrame(teken);
}

haalLibrary();
requestAnimationFrame(teken);
