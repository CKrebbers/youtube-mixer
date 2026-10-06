import { SPEELLIJST, allePunten } from './speellijst.js';
import { KANAAL } from '../ui/status-zender.js';
import { LOCK_NAAM } from '../ui/tabblad.js';
import { stemsTegel } from '../ui/stems-weergave.js';
import { backupTegel } from './backup-tegel.js';
import { serverTegel } from './server-tegel.js';

/**
 * De Controlekamer (controle.html, docs/CONTROLEKAMER.md). Leest:
 * - de server: /api/tooling, /api/library (aantal), /api/ingest, /api/stems, /api/proef,
 *   /api/backups (de laatste kopie van library.db), /api/secties (hoeveel nummers nog
 *   geen actuele secties hebben);
 * - de Web Lock van de mixer (tabblad.js): is er een mixer open, wacht er een tweede;
 * - het kanaal van de mixer (status-zender.js): APC, audio, wat er speelt.
 * Opent zelf GEEN MIDI: de APC heeft maar één tabblad, de mixer.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const stand = {
  server: null,        // true | false (laatste verzoek gelukt?)
  tooling: null,       // antwoord van /api/tooling
  nummers: null,       // aantal in de library
  ingest: [],          // open opdrachten
  stems: null,         // antwoord van /api/stems, { ontbreekt: true } bij een server zonder stems, null = onbekend
  backup: null,        // antwoord van /api/backups
  secties: null,       // antwoord van /api/secties, { ontbreekt: true } bij een server zonder die route, null = onbekend
  mixer: null,         // { open, wachtend } uit de Web Lock
  status: null,        // laatste bericht van de mixer
  proef: { begonnen: null, items: {} },
};

function meld(tekst, soort = '') {
  const el = document.createElement('div');
  el.className = `melding ${soort}`;
  el.textContent = tekst;
  $('meldingen').append(el);
  setTimeout(() => el.remove(), soort === 'fout' ? 8000 : 3000);
}

async function haal(pad) {
  const r = await fetch(pad, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${pad}: ${r.status}`);
  return r.json();
}

// ---- de stand -----------------------------------------------------------------

async function leesServer() {
  try {
    const [lib, ingest] = await Promise.all([haal('/api/library?aantal=1'), haal('/api/ingest')]);
    stand.nummers = lib.totaal ?? null;
    stand.ingest = (ingest.opdrachten ?? []).filter((o) => o.status === 'wacht' || o.status === 'bezig');
    stand.server = true;
  } catch { stand.server = false; }
  // Los: een oudere server zonder /api/backups is nog steeds een draaiende server.
  try { stand.backup = await haal('/api/backups'); } catch { stand.backup = null; }
}

/**
 * De stems-rij (docs/STEMS.md §2): wat loopt, wat wacht, of de splitter er is.
 * Los van leesServer: een server van vóór de stems kent de route niet (404),
 * en dat is geen reden om de server als "weg" te tonen.
 */
async function leesStems() {
  try {
    const r = await fetch('/api/stems', { cache: 'no-store' });
    stand.stems = r.status === 404 ? { ontbreekt: true } : r.ok ? await r.json() : null;
  } catch { stand.stems = null; }
}

/**
 * Hoeveel nummers (nog) geen actuele secties hebben (docs/SECTIES.md §4). Los,
 * zoals de stems: een oudere server kent de route niet (404) en draait toch.
 * De server cachet de telling, dus elke 2 s vragen kost hem niets.
 */
async function leesSecties() {
  try {
    const r = await fetch('/api/secties', { cache: 'no-store' });
    stand.secties = r.status === 404 ? { ontbreekt: true } : r.ok ? await r.json() : null;
  } catch { stand.secties = null; }
}

async function leesTooling() {
  try { stand.tooling = await haal('/api/tooling'); } catch { stand.tooling = null; }
}

async function leesMixer() {
  if (!navigator.locks?.query) { stand.mixer = null; return; }
  try {
    const q = await navigator.locks.query();
    stand.mixer = {
      open: q.held.some((l) => l.name === LOCK_NAAM),
      wachtend: q.pending.filter((l) => l.name === LOCK_NAAM).length,
    };
  } catch { stand.mixer = null; }
}

const kanaal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(KANAAL) : null;
if (kanaal) kanaal.onmessage = (e) => { if (e.data && e.data.t) { stand.status = e.data; tekenStand(); } };
const vraagStatus = () => kanaal?.postMessage({ vraag: 'status' });

/** Eén tegel: { naam, licht: 'ok'|'half'|'fout'|'uit', waarde, sub, regel? }. */
function tegels() {
  const s = stand.status;
  const vers = s && Date.now() - s.t < 5000;
  const t = [];

  t.push(serverTegel(stand));

  const tl = stand.tooling;
  t.push(!tl ? { naam: 'Binnenhalen', licht: 'uit', waarde: '…', sub: '' }
    : tl.ok ? { naam: 'Binnenhalen', licht: tl.verouderd ? 'half' : 'ok', waarde: 'werkt',
                sub: tl.verouderd ? `yt-dlp ${tl.ytdlp}, nieuwer: ${tl.nieuwsteYtdlp}` : `yt-dlp ${tl.ytdlp} · ffmpeg` }
      : { naam: 'Binnenhalen', licht: 'fout', waarde: `ontbreekt: ${tl.ontbreekt.join(', ')}`, sub: 'links binnenhalen werkt niet' });

  const bezig = stand.ingest.filter((o) => o.status === 'bezig').length;
  const wacht = stand.ingest.length - bezig;
  t.push({ naam: 'Ingest-rij', licht: stand.ingest.length ? 'half' : 'ok',
           waarde: stand.ingest.length ? `${bezig} bezig, ${wacht} wacht` : 'leeg',
           sub: stand.ingest.find((o) => o.status === 'bezig')?.titel ?? '' });

  t.push(stand.server === false ? { naam: 'Stems', licht: 'uit', waarde: '—', sub: '' } : stemsTegel(stand.stems));

  t.push(backupTegel(stand.server === false ? null : stand.backup));

  const m = stand.mixer;
  t.push(!m ? { naam: 'Mixer', licht: 'uit', waarde: 'onbekend', sub: 'deze browser kent geen Web Locks' }
    : m.wachtend ? { naam: 'Mixer', licht: 'fout', waarde: `open, plus ${m.wachtend} extra`,
                     sub: 'sluit het extra mixer-tabblad' }
      : m.open ? { naam: 'Mixer', licht: 'ok', waarde: 'open', sub: vers ? 'meldt zich' : 'wacht op melding…' }
        : { naam: 'Mixer', licht: 'uit', waarde: 'niet open', sub: 'open hem hieronder' });

  if (!m?.open || !vers) {
    t.push({ naam: 'Audio', licht: 'uit', waarde: '—', sub: '' });
    t.push({ naam: 'APC40', licht: 'uit', waarde: '—', sub: m?.open ? 'mixer op de achtergrond? klik hem even aan' : '' });
  } else {
    t.push(s.audio === 'running' ? { naam: 'Audio', licht: 'ok', waarde: 'aan', sub: '' }
      : { naam: 'Audio', licht: 'half', waarde: 'staat stil', sub: 'klik "audio starten" in de mixer' });
    const md = s.midi;
    const apc = md?.invoer && /apc/i.test(md.invoer);
    t.push(!md || !md.ondersteund ? { naam: 'APC40', licht: 'uit', waarde: 'geen MIDI', sub: 'deze browser kent geen Web MIDI' }
      : md.fout ? { naam: 'APC40', licht: 'fout', waarde: 'MIDI-fout', sub: md.fout }
        : md.verkeerdePoort ? { naam: 'APC40', licht: 'fout', waarde: 'verkeerde poort', sub: 'kies de APC in het MIDI-paneel' }
          : apc ? { naam: 'APC40', licht: 'ok', waarde: 'verbonden', sub: `echo's: ${md.echoes}` }
            : { naam: 'APC40', licht: 'half', waarde: md.invoer ? md.invoer : 'niet aangesloten', sub: 'sluit hem aan en herlaad de mixer' });
  }
  return t;
}

function tekenStand() {
  $('tegels').innerHTML = tegels().map((g) => `
    <div class="tegel" data-licht="${g.licht}">
      <span class="tegel-naam"><i class="led"></i>${esc(g.naam)}</span>
      <span class="tegel-waarde">${esc(g.waarde)}</span>
      <span class="tegel-sub">${esc(g.sub)}</span>${g.regel ? `
      <span class="tegel-regel">${esc(g.regel)}</span>` : ''}
    </div>`).join('');

  const s = stand.status;
  const spelen = $('spelen');
  if (!s || !stand.mixer?.open || Date.now() - s.t > 5000 || !s.tracks.length) { spelen.hidden = true; }
  else {
    spelen.hidden = false;
    const vlag = [s.auto && 'auto aan', s.opname && '● opname'].filter(Boolean).join(' · ');
    spelen.innerHTML = `<span class="spelen-kop">IN DE MIXER${vlag ? ` · ${esc(vlag)}` : ''}</span>` + s.tracks.map((d) => `
      <span class="spoor${d.speelt ? ' speelt' : ''}${d.id === s.focus ? ' focus' : ''}">
        <b>${esc(d.id)}</b>${d.speelt ? '▶ ' : ''}${esc(d.titel)}
        <i>${d.bpm ? `${d.bpm} bpm` : ''}${d.toon ? ` · ${esc(d.toon)}` : ''}${d.id === s.maat ? ' · MAAT' : ''}</i>
      </span>`).join('');
  }

  const knop = $('mixer-open');
  const open = !!stand.mixer?.open;
  if (!knop.dataset.bezig) {
    knop.disabled = open;
    knop.textContent = open ? 'mixer staat open' : 'mixer openen';
    knop.title = open ? 'er is al een mixer-tabblad: gebruik dat (een tweede luistert niet naar de APC)' : '';
  }
}

$('mixer-open').addEventListener('click', async () => {
  const knop = $('mixer-open');
  await leesMixer();
  if (stand.mixer?.open) { tekenStand(); meld('de mixer staat al open — gebruik dat tabblad', 'fout'); return; }
  window.open('/', '_blank');
  knop.dataset.bezig = '1'; knop.disabled = true; knop.textContent = 'mixer gaat open…';
  setTimeout(() => { delete knop.dataset.bezig; tekenStand(); }, 4000);
});

// ---- de speellijst --------------------------------------------------------------

const STATUS_KNOPPEN = [['ok', 'ok'], ['fout', 'fout'], ['overslaan', '—']];

function tekenLijst() {
  const items = stand.proef.items;
  $('lijst').innerHTML = SPEELLIJST.map((b) => {
    const klaar = b.punten.filter((p) => items[p.id] && items[p.id].status !== 'open').length;
    return `<section class="lijst-blok">
      <h3>${esc(b.titel)} <span class="blok-maat">${klaar}/${b.punten.length} · ~${b.minuten} min</span></h3>
      ${b.punten.map((p) => {
        const it = items[p.id] ?? { status: 'open', notitie: '' };
        return `<div class="punt" data-id="${esc(p.id)}" data-status="${esc(it.status)}">
          <div class="punt-knoppen">${STATUS_KNOPPEN.map(([st, label]) =>
            `<button class="sk" data-st="${st}" aria-pressed="${it.status === st}" title="${st}">${label}</button>`).join('')}</div>
          <div class="punt-tekst"><span class="doe">${esc(p.doe)}</span><span class="let">${esc(p.let)}</span></div>
          <input class="notitie" id="n-${esc(p.id)}" type="text" maxlength="2000" placeholder="notitie"
                 value="${esc(it.notitie)}" aria-label="notitie bij ${esc(p.doe)}">
        </div>`;
      }).join('')}
    </section>`;
  }).join('');
  tekenVoortgang();
}

function tekenVoortgang() {
  const punten = allePunten();
  const items = stand.proef.items;
  const gedaan = punten.filter((p) => items[p.id] && items[p.id].status !== 'open').length;
  const fout = punten.filter((p) => items[p.id]?.status === 'fout').length;
  $('voortgang').innerHTML = `${gedaan}/${punten.length} gedaan${fout ? ` · <b class="rood">${fout} fout</b>` : ''}`;
}

async function zet(id, wijziging) {
  const oud = stand.proef.items[id] ?? { status: 'open', notitie: '' };
  const nieuw = { status: wijziging.status ?? oud.status, notitie: wijziging.notitie ?? oud.notitie };
  try {
    const r = await fetch(`/api/proef/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(nieuw),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.fout || r.status);
    if (d.item) stand.proef.items[id] = d.item; else delete stand.proef.items[id];
    return true;
  } catch (err) {
    meld(`niet bewaard: ${err.message}`, 'fout');
    return false;
  }
}

$('lijst').addEventListener('click', async (e) => {
  const knop = e.target.closest('.sk');
  if (!knop) return;
  const punt = knop.closest('.punt');
  const id = punt.dataset.id;
  const huidig = stand.proef.items[id]?.status ?? 'open';
  const status = huidig === knop.dataset.st ? 'open' : knop.dataset.st;   // nog eens = terug naar open
  const notitie = punt.querySelector('.notitie').value;
  if (await zet(id, { status, notitie })) {
    punt.dataset.status = stand.proef.items[id]?.status ?? 'open';
    punt.querySelectorAll('.sk').forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.st === punt.dataset.status)));
    if (status === 'fout' && !notitie) punt.querySelector('.notitie').focus();
    tekenVoortgang();
  }
});

async function bewaarNotitie(veld) {
  const id = veld.closest('.punt').dataset.id;
  if ((stand.proef.items[id]?.notitie ?? '') === veld.value.trim()) return;
  if (await zet(id, { notitie: veld.value })) {
    veld.classList.add('bewaard');
    setTimeout(() => veld.classList.remove('bewaard'), 900);
    tekenVoortgang();
  }
}
$('lijst').addEventListener('change', (e) => { if (e.target.classList.contains('notitie')) bewaarNotitie(e.target); });
$('lijst').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('notitie')) { e.preventDefault(); e.target.blur(); }
});

let nieuwKlaar = null;
$('nieuw').addEventListener('click', async () => {
  const knop = $('nieuw');
  if (!nieuwKlaar) {
    knop.textContent = 'zeker? klik nog eens';
    knop.classList.add('let-op');
    nieuwKlaar = setTimeout(() => { nieuwKlaar = null; knop.textContent = 'nieuwe ronde'; knop.classList.remove('let-op'); }, 4000);
    return;
  }
  clearTimeout(nieuwKlaar); nieuwKlaar = null;
  knop.textContent = 'nieuwe ronde'; knop.classList.remove('let-op');
  try {
    const r = await fetch('/api/proef/nieuw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const d = await r.json();
    stand.proef = await haal('/api/proef');
    tekenLijst();
    meld(d.gearchiveerd ? `vorige ronde bewaard in proef/${d.gearchiveerd}` : 'er was nog niets om te bewaren');
  } catch (err) { meld(`niet gelukt: ${err.message}`, 'fout'); }
});

// ---- starten ------------------------------------------------------------------

function klok() { $('tijd').textContent = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }); }

async function ververs() { await Promise.all([leesServer(), leesMixer(), leesStems(), leesSecties()]); tekenStand(); }

klok(); setInterval(klok, 10000);
try { stand.proef = await haal('/api/proef'); } catch (_) { meld('speellijst niet geladen: is de server er?', 'fout'); }
tekenLijst();
await ververs();
leesTooling().then(tekenStand);
vraagStatus();
setInterval(ververs, 2000);
setInterval(vraagStatus, 2000);
setInterval(() => leesTooling().then(tekenStand), 60000);
window.controle = { stand, ververs };   // handig in de console en voor tools/headless/controle.mjs
