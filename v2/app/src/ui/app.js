/**
 * Het instappunt: AudioContext, engine, scherm. Het scherm stuurt alleen via de
 * bus en leest elke frame de stand terug; tekenen gebeurt alleen als iets
 * veranderde (v1: elke teken-actie is een upload naar de GPU).
 */
import { Engine } from '../engine/engine.js';
import { maakAudio } from '../audio/index.js';
import { maakKnop, maakFader, maakJog, bindKnoppen, bindSchuiven, bindLampjes } from './bediening.js';
import { Opnemer } from '../audio/opnemer.js';
import { maakSamplerUitgang } from '../audio/sampler-uitgang.js';
import { setId } from '../engine/log.js';
import { schrijversVoor } from './schrijver.js';
import { opzetLibrary } from './library.js';
import { opzetControllers } from './controllers.js';
import { opzetIndelingPaneel } from './indeling-paneel.js';
import { opzetTrackPaneel, instrumentSectie, effectSectie, stemsSectie, patroonSectie } from './track-paneel.js';
import { Automaat } from '../auto/automaat.js';
import { opzetBeeld } from '../beeld/opzet.js';
import { BeeldKoppeling } from '../koppel/beeld.js';
import { definieerKoppeling } from '../koppel/acties.js';
import { opzetKoppelPaneel } from './koppel-paneel.js';
import { Luisteraar } from '../beeld/analyse/luisteraar.js';
import { definieerAuto } from '../engine/acties-auto.js';
import { opzetAutoPaneel, maakLaad } from './auto-paneel.js';
import { opzetOpstelling } from './opstelling.js';

const $ = (s, w = document) => w.querySelector(s);
const tijd = (s) => { if (!Number.isFinite(s)) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

// ---- opzet ----------------------------------------------------------------------

const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
const OMGEWISSELD = 'varve.v2.koptelefoon.omgewisseld';
const omgewisseld = (() => { try { return localStorage.getItem(OMGEWISSELD) === '1'; } catch (_) { return false; } })();
const audio = { ...maakAudio({ omgewisseld }), opnemer: (c, mixer) => new Opnemer(c, mixer.analyser), sampler: (c, mixer) => maakSamplerUitgang(c, mixer) };
const engine = new Engine({ ctx, audio });
// De koptelefoon bestaat alleen met een uitgang van vier kanalen (zaal 1/2, koptelefoon 3/4).
document.body.classList.toggle('koptelefoon', !!engine.mixer.koptelefoon?.beschikbaar);
document.getElementById('kop-wissel')?.addEventListener('click', (ev) => {
  const nieuw = !omgewisseld;
  try { localStorage.setItem(OMGEWISSELD, nieuw ? '1' : '0'); } catch (_) {}
  ev.currentTarget.classList.toggle('wacht', nieuw !== omgewisseld);
  engine.meld(nieuw ? 'na herladen: de zaal op 3/4, de koptelefoon op 1/2' : 'na herladen: de zaal op 1/2, de koptelefoon op 3/4', 'info', 'koptelefoon');
});
window.varve = engine;   // voor de console en de headless proeven
audio.sjablonen?.().then((lijst) => { if (lijst) engine.fx.zetSjablonen(lijst); }).catch(() => engine.meld('de effect-sjablonen kwamen niet binnen: ‹ › loopt per effect', 'fout', 'fx'));
const bus = engine.bus;
// De Stroommachine (src/koppel/): klok, kenmerken en tracks naar de relay. Uit en zonder adres gebeurt er niets.
const stroom = new BeeldKoppeling({ engine, luisteraar: new Luisteraar({ analyser: () => engine.mixer.analyser, sampleRate: () => ctx.sampleRate }), mag: false });
definieerKoppeling(bus, stroom);
window.varveStroom = stroom;
addEventListener('pagehide', () => stroom.stop());
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
  for (const x of el.querySelectorAll('[data-actie], [data-actie-shift], [data-waarde], [data-kill], [data-jog]')) {
    for (const k of ['actie', 'actieShift', 'waarde', 'kill', 'jog']) if (x.dataset[k]) x.dataset[k] = x.dataset[k].replace('{n}', n);
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
const lampjes = bindLampjes(document.body, bus);

// ---- log (altijd aan), opname en wat bij een nummer hoort -------------------------------

const schrijvers = schrijversVoor({ meld: (t, soort, sleutel) => engine.meld(t, soort, sleutel) });
// Het log begint zodra de klok van de context loopt (eerder staat zijn tijd stil), één keer per pagina (v1 J18).
const startLog = () => { if (ctx.state === 'running' && !engine.log.loopt && !startLog.gedaan) { startLog.gedaan = true; engine.log.start(setId()); } };
ctx.addEventListener('statechange', startLog);
setInterval(() => { const st = engine.log.stuk(); if (st) schrijvers.log.zet(st); }, 1000);
addEventListener('pagehide', () => { const st = engine.log.stuk(); if (st) navigator.sendBeacon?.(`/api/v2/log/${st.id}?van=${st.van}`, new Blob([st.tekst], { type: 'text/plain' })); });
if (engine.opnemer) {
  engine.opnemer.on('stuk', ({ frame, data }) => schrijvers.opname.zet({ id: engine._opnameId, frame, data }));
  engine.opnemer.on('fout', (t) => engine.meld(`opname: ${t}`, 'fout', 'opname'));
}
engine.on('opname', async ({ stand, id, frames }) => {
  if (stand === 'aan') { engine.meld(`opname loopt: ${id}`, 'info', 'opname'); return; }
  await schrijvers.opname.leeg();
  await fetch(`/api/v2/opname/${id}/klaar?frames=${frames}`, { method: 'POST' }).then((r) => r.arrayBuffer()).catch(() => {});
  engine.meld(`opname bewaard: ${id} (${tijd(frames / ctx.sampleRate)})`, 'info', 'opname');
});
// Hotcues en het cuepunt horen bij het nummer: bewaren op de server (~/.varve/v2/nummers).
const bewaarNummer = (id, data) => fetch(`/api/v2/nummer/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  .then((r) => { r.arrayBuffer().catch(() => {}); if (!r.ok) engine.meld(`bewaren van ${id} lukte niet (${r.status})`, 'fout', `nummer:${id}`); })
  .catch(() => engine.meld(`bewaren van ${id}: server niet bereikbaar`, 'fout', `nummer:${id}`));
engine.on('hotcue', ({ id, hotcues }) => { if (!id.startsWith('demo')) bewaarNummer(id, { hotcues }); });
engine.on('cue', ({ id, P }) => { if (!id.startsWith('demo')) bewaarNummer(id, { cue: P }); });
const recTijd = $('#rec-tijd');
const samplerTellen = $('#sampler-tellen');

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

const library = opzetLibrary({ engine, bus, wortel: document, overzichten });
const { laadOp } = library;
window.varveLibrary = library;   // voor de headless proeven

// ---- de auto-DJ (src/auto/): een extra bron van acties op de bus, Clay wint altijd -------------

const automaat = new Automaat({
  engine, bus, laad: maakLaad({ engine, library }),
  // Met een echte library geen demo's in de set.
  nummers: () => { const l = [...library.nummers.values()]; const echt = l.filter((x) => !x.demo); return echt.length ? echt : l; },
});
definieerAuto(bus, automaat);
window.varveAuto = automaat;
opzetAutoPaneel({ automaat, bus, paneel: $('#auto-rij') });

// ---- controllers (APC40 en toetsenbord): de indeling als module, per nummer te kiezen ----------

const ctl = opzetControllers({
  bus,
  vars: { focus: () => engine.focus ?? 1 },
  tel: () => { const t = engine.hoorbareTel(); return t === null ? null : { fase: t - Math.floor(t), een: Math.floor(t) % engine.klok.perMaat === 0 }; },
  meld: (tekst, soort, sleutel) => engine.meld(tekst, soort, sleutel),
  statusEl: $('#ctl-status'),
  // Noten van een keyboard naar het instrument van de speeltrack (niet over de bus).
  noten: {
    aan: (noot, v) => { const n = engine.speeltrack(); return n && engine.noot(noot, v, { n }) ? n : null; },
    uit: (noot, n) => { engine.noot(noot, 0, { n }); },
    houd: (aan, n = engine.speeltrack()) => { engine.track(n ?? 1)?.instrument?.inst.houd?.(aan); return n; },
    buig: (w) => { const n = engine.speeltrack(); if (n) engine.track(n).instrument?.inst.buig?.(w); },
    mod: (w) => { const n = engine.speeltrack(); if (n) engine.track(n).instrument?.inst.mod?.(w); },
  },
});
window.varveCtl = ctl;
// Eén tabblad zendt naar de Stroommachine (anders antwoorden er twee op elke ping): met de hub het
// tabblad dat de hub heeft (niet vervangen), anders het tabblad met de Web Lock.
const magZenden = (s) => (s.hub ? !s.hub.vervangen : s.tabblad === 'eerste');
ctl.on('status', (s) => stroom.magZenden(magZenden(s)));
stroom.magZenden(magZenden(ctl.status()));
// Wat je zelf leerde, en welke indeling bij welk nummer hoort, staat op de server (~/.varve/v2/instellingen).
const instelling = (naam) => fetch(`/api/v2/instelling/${naam}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const bewaarInstelling = (naam, v) => fetch(`/api/v2/instelling/${naam}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })
  .then((r) => { r.arrayBuffer().catch(() => {}); if (!r.ok) engine.meld(`${naam} bewaren lukte niet (${r.status})`, 'fout', `instelling:${naam}`); })
  .catch(() => engine.meld(`${naam} bewaren: server niet bereikbaar`, 'fout', `instelling:${naam}`));
ctl.geladen.then(async () => {
  const eigen = (await instelling('indelingen-eigen')) ?? {};
  for (const [app, docs] of Object.entries(eigen)) for (const d of docs ?? []) { try { (app === 'apc' ? ctl.apc : ctl.toetsen).voegToe(d); } catch { /* oud formaat: overslaan */ } }
  const per = await instelling('indeling-per-nummer');
  if (per?.apc) ctl.apc.laadPerNummer(per.apc);
  if (per?.toetsen) ctl.toetsen.laadPerNummer(per.toetsen);
  ctl.kiesVoorNummer(engine.track(engine.focus).nummer?.id);
});
ctl.on('geleerd', async ({ apparaat, indeling }) => {
  const eigen = (await instelling('indelingen-eigen')) ?? {};
  eigen[apparaat] = [...(eigen[apparaat] ?? []).filter((d) => d.naam !== indeling.naam), indeling];
  bewaarInstelling('indelingen-eigen', eigen);
});
ctl.geladen.then(() => opzetIndelingPaneel({
  ctl, engine, knop: $('#ind-knop'), paneel: $('#ind-paneel'), meld: (t, s, k) => engine.meld(t, s, k),
  bewaarEigen: async (app, doc) => {
    const eigen = (await instelling('indelingen-eigen')) ?? {};
    eigen[app] = [...(eigen[app] ?? []).filter((d) => d.naam !== doc.naam), doc];
    bewaarInstelling('indelingen-eigen', eigen);
  },
  bewaarPerNummer: async (deel) => bewaarInstelling('indeling-per-nummer', { ...((await instelling('indeling-per-nummer')) ?? {}), ...deel }),
}));
// De indeling volgt het nummer op de focus-track (WENSEN: "per nummer een andere layout").
engine.on('focus', (n) => ctl.kiesVoorNummer(engine.track(n).nummer?.id));
engine.on('laad', ({ n, stand }) => { if (stand === 'klaar' && n === engine.focus) ctl.kiesVoorNummer(engine.track(n).nummer?.id); });

// ---- tabbladen onder (library, focus-track, beeld) -------------------------------------

function kiesTab(naam) {
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.classList.toggle('aan', b.dataset.tab === naam);
  for (const p of document.querySelectorAll('[data-paneel]')) p.hidden = p.dataset.paneel !== naam;
  try { localStorage.setItem('varve.v2.tab', naam); } catch { /* geen opslag: niet erg */ }
}
for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => kiesTab(b.dataset.tab));
try { const t = localStorage.getItem('varve.v2.tab'); if (t) kiesTab(t); } catch { /* geen opslag */ }
const tabTrackN = $('#tab-track-n');
const trackPaneel = opzetTrackPaneel({ engine, paneel: $('#paneel-track') });
trackPaneel.sectie(effectSectie({ engine, bus, maakKnop }));
trackPaneel.sectie(stemsSectie({ bus, maakKnop }));
trackPaneel.sectie(instrumentSectie({ engine, bus, maakKnop }));
trackPaneel.sectie(patroonSectie({ engine, bus }));
// De patronen bewaren (~/.varve/v2/instellingen/patronen.json): één seconde na de laatste bewerking.
instelling('patronen').then((set) => { if (set) engine.patronen.zetSet(set); });
let patronenTimer = null;
engine.on('patronen-set', (set) => { clearTimeout(patronenTimer); patronenTimer = setTimeout(() => bewaarInstelling('patronen', set), 1000); });
// Beeld (plak 4, src/beeld/): video per track als slaaf van wat je hoort, vormlagen, het losse venster.
const beeld = opzetBeeld({ engine, bus, paneel: $('#paneel-beeld'), analyser: engine.mixer.analyser });
// Opstellingen (src/kern/opstelling): recepten + zaad, bespeeld met de Maschine, de APC of dit paneel.
const opstelling = opzetOpstelling({ engine, bus, library, beeld, ctl, paneel: $('#paneel-opstelling'), instelling, bewaarInstelling });
window.varveOpstelling = opstelling;   // voor de headless proeven
opzetKoppelPaneel({ koppeling: stroom, bus, wortel: $('#paneel-beeld'), meld: (t, so, k) => engine.meld(t, so, k) });

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
  lampjes.teken();
  for (const v of vakken) {
    const l = v.knop('.lus-lengte'), n = v.t.lus?.n ?? v.t.lusLengte;
    const tekst = n >= 1 ? String(n) : `1/${Math.round(1 / n)}`;
    if (l.textContent !== tekst) l.textContent = tekst;
    v.el.classList.toggle('focus', engine.focus === v.n);
  }
  const st = `${engine.sampler.tellen} ${engine.sampler.tellen === 1 ? 'tel' : 'tellen'}`;
  if (samplerTellen.textContent !== st) samplerTellen.textContent = st;
  if (tabTrackN.textContent !== String(engine.focus)) tabTrackN.textContent = engine.focus;
  trackPaneel.teken();
  const op = engine.opnemer;
  const rec = op?.loopt ? tijd(op.frames / ctx.sampleRate) : '';
  if (recTijd.textContent !== rec) recTijd.textContent = rec;
  const m = engine.mixer.meterMaster?.();
  if (m) {
    const h = `${Math.min(100, Math.max(0, (20 * Math.log10(m.piek + 1e-9) + 48) / 48 * 100))}%`;
    for (const i of meterM) { i.style.setProperty('--h', h); i.classList.toggle('rood', m.piek > 0.89); }
  }
  requestAnimationFrame(teken);
}

requestAnimationFrame(teken);
