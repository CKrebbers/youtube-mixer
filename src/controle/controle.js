import { SPEELLIJST, allePunten } from './speellijst.js';
import { KANAAL } from '../ui/status-zender.js';
import { LOCK_NAAM } from '../ui/tabblad.js';
import { stemsTegel } from '../ui/stems-weergave.js';
import { beeldTegel } from '../ui/beeld-weergave.js';
import { backupTegel } from './backup-tegel.js';
import { serverTegel } from './server-tegel.js';
import { standTegel, mixerAdres, verschilTekst, activeerMelding, LABEL as STAND_LABEL, MIXER_VIA_HUB } from './stand-tegel.js';

/**
 * De Controlekamer (controle.html, docs/CONTROLEKAMER.md). Leest:
 * - de server: /api/tooling, /api/library (aantal), /api/ingest, /api/stems, /api/proef,
 *   /api/backups (de laatste kopie van library.db), /api/secties (hoeveel nummers nog
 *   geen actuele secties hebben), /api/standen (de opstelling: welke actief is, docs/STANDEN.md);
 * - de Web Lock van de mixer (tabblad.js): is er een mixer open, wacht er een tweede;
 * - het kanaal van de mixer (status-zender.js): APC, audio, wat er speelt, beeld.
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
  standen: null,       // antwoord van /api/standen ({ standen, actief, label }), { ontbreekt } / { fout }, null = onbekend
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

/*
 * Een trage of hangende server (een telefoon via het LAN): elk verzoek geeft het
 * na WACHT_MS op, en ververs() begint pas opnieuw als de vorige klaar is. Anders
 * stapelden de verzoeken zich elke 2 s op (16 open na 14 s).
 */
const WACHT_MS = 6000;
/** Een losse route die 404 of een fout gaf: hooguit eens per minuut opnieuw (niet elke 2 s een rode regel in de console). */
const RUST_MS = 60000;
const rustTot = new Map();   // pad → tijdstip waarop hij weer gevraagd wordt

async function haal(pad, { wacht = WACHT_MS } = {}) {
  const r = await fetch(pad, { cache: 'no-store', signal: AbortSignal.timeout(wacht) });
  if (!r.ok) throw new Error(`${pad}: ${r.status}`);
  return r.json();
}

/**
 * Een losse route, die een oudere server misschien niet kent: { data } bij 200,
 * { ontbreekt: true } bij 404, { fout: status } bij een andere fout, null als de
 * server niet (op tijd) antwoordt. Na een 404 of fout rust de route RUST_MS:
 * dan `undefined` (= houd wat je had), zonder verzoek.
 */
async function haalLos(pad) {
  if (Date.now() < (rustTot.get(pad) ?? 0)) return undefined;
  try {
    const r = await fetch(pad, { cache: 'no-store', signal: AbortSignal.timeout(WACHT_MS) });
    if (r.ok) { rustTot.delete(pad); return { data: await r.json() }; }
    rustTot.set(pad, Date.now() + RUST_MS);
    return r.status === 404 ? { ontbreekt: true } : { fout: r.status };
  } catch { return null; }
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
  const b = await haalLos('/api/backups');
  if (b !== undefined) stand.backup = b?.data ?? null;
}

/**
 * De stems-rij (docs/STEMS.md §2): wat loopt, wat wacht, of de splitter er is.
 * Los van leesServer: een server van vóór de stems kent de route niet (404),
 * en dat is geen reden om de server als "weg" te tonen.
 */
async function leesStems() {
  const a = await haalLos('/api/stems');
  if (a !== undefined) stand.stems = a?.data ?? (a?.ontbreekt ? a : null);
}

/**
 * Hoeveel nummers (nog) geen actuele secties hebben (docs/SECTIES.md §4). Los,
 * zoals de stems: een oudere server kent de route niet (404, "onbekend") en
 * draait toch; een fout (500) is "onbekend (fout)". De server cachet de
 * telling, dus elke 2 s vragen kost hem bijna niets.
 */
async function leesSecties() {
  const a = await haalLos('/api/secties');
  if (a !== undefined) stand.secties = a?.data ?? a;
}

/**
 * De opstellingen (docs/STANDEN.md): de lijst en welke actief is. Los, zoals de
 * stems: een oudere server kent de route niet (404, "onbekend") en draait toch.
 */
async function leesStanden() {
  const a = await haalLos('/api/standen');
  if (a !== undefined) stand.standen = a?.data ?? a;
}

// De tooling-controle start yt-dlp, de splitter en de tellenzoeker: die mag langer duren.
async function leesTooling() {
  try { stand.tooling = await haal('/api/tooling', { wacht: 60000 }); } catch { stand.tooling = null; }
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
  t.push(standTegel({ standen: stand.server === false ? null : stand.standen }));

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
    t.push({ naam: 'Beeld', licht: 'uit', waarde: '—', sub: '' });
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
    // De Stroommachine op de pc (docs/BEELD.md): mag ontbreken, dus uit is grijs, geen fout.
    t.push(beeldTegel(s.beeld));
  }
  return t;
}

function tekenStand() {
  // De title draagt de hele tekst: de waarde kan nog afgekapt zijn (één regel).
  $('tegels').innerHTML = tegels().map((g) => `
    <div class="tegel" data-licht="${g.licht}" title="${esc([g.waarde, g.sub].filter((x) => x && x !== '—').join(' — '))}">
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
  // Via de hub als de actieve opstelling dat zegt (hub.mixerVia): het adres staat op de knop, zodat je het ziet.
  knop.dataset.adres = mixerAdres(stand.standen?.actief);
  const viaHub = knop.dataset.adres === MIXER_VIA_HUB;
  if (!knop.dataset.bezig) {
    knop.disabled = open;
    knop.textContent = open ? 'mixer staat open' : viaHub ? 'mixer openen via de hub' : 'mixer openen';
    knop.title = open ? 'er is al een mixer-tabblad: gebruik dat (een tweede luistert niet naar de APC)'
      : viaHub ? `de opstelling zegt: via de hub (${knop.dataset.adres}); start de hub eerst` : '';
  }
  tekenKiezer();
}

$('mixer-open').addEventListener('click', async () => {
  const knop = $('mixer-open');
  await leesMixer();
  if (stand.mixer?.open) { tekenStand(); meld('de mixer staat al open — gebruik dat tabblad', 'fout'); return; }
  window.open(mixerAdres(stand.standen?.actief), '_blank');
  knop.dataset.bezig = '1'; knop.disabled = true; knop.textContent = 'mixer gaat open…';
  setTimeout(() => { delete knop.dataset.bezig; tekenStand(); }, 4000);
});

// ---- de opstelling (docs/STANDEN.md) ----------------------------------------------

$('h-opstelling').textContent = STAND_LABEL;
let kiezerSleutel = '';

/** De kiezer alleen opnieuw opbouwen als de lijst verandert, en nooit terwijl hij focus heeft. */
function tekenKiezer() {
  const kies = $('stand-kies');
  const d = stand.standen;
  const lijst = Array.isArray(d?.standen) ? d.standen : null;
  const aan = !!lijst && stand.server !== false;
  kies.disabled = !aan || !lijst?.length;
  $('stand-activeer').disabled = kies.disabled || !!$('stand-activeer').dataset.bezig;
  $('stand-terug').disabled = !aan || !!$('stand-terug').dataset.bezig;
  if (!lijst || document.activeElement === kies) return;
  const actief = d.actief?.naam ?? null;
  const sleutel = JSON.stringify([lijst.map((s) => [s.naam, s.titel, s.fouten]), actief]);
  if (sleutel === kiezerSleutel) return;
  const gekozen = kiezerSleutel ? kies.value : (actief ?? lijst[0]?.naam ?? '');
  kiezerSleutel = sleutel;
  kies.innerHTML = lijst.map((s) => `<option value="${esc(s.naam)}">${esc(s.titel)}${s.naam === actief ? ' · actief' : ''}${s.fouten ? ' · fout' : ''}</option>`).join('');
  kies.value = lijst.some((s) => s.naam === gekozen) ? gekozen : (actief ?? lijst[0]?.naam ?? '');
  toonVerschil();
}

/** Onder de kiezer: wat activeren zou veranderen (GET …/verschil), zodat de tweede klik een echte keuze is. */
let verschilNr = 0;
async function toonVerschil() {
  const naam = $('stand-kies').value;
  const nr = ++verschilNr;
  if (!naam) return;
  try {
    const v = await haal(`/api/standen/${encodeURIComponent(naam)}/verschil`);
    if (nr === verschilNr) $('stand-uitleg').textContent = `Activeren: ${verschilTekst(v)}.`;
  } catch (err) {
    if (nr === verschilNr) $('stand-uitleg').textContent = `Deze opstelling klopt niet (${err.message}); kijk het bestand na.`;
  }
}
$('stand-kies').addEventListener('change', () => { toonVerschil(); });
$('stand-kies').addEventListener('blur', () => { kiezerSleutel = '__'; tekenKiezer(); });

/** Twee klikken binnen 4 s, zoals "nieuwe ronde": de eerste vraagt "zeker?". */
function tweeKlik(knop, label, actie) {
  let klaar = null;
  knop.addEventListener('click', async () => {
    if (!klaar) {
      knop.textContent = 'zeker? klik nog eens';
      knop.classList.add('let-op');
      klaar = setTimeout(() => { klaar = null; knop.textContent = label; knop.classList.remove('let-op'); }, 4000);
      return;
    }
    clearTimeout(klaar); klaar = null;
    knop.textContent = label; knop.classList.remove('let-op');
    knop.dataset.bezig = '1'; knop.disabled = true;
    try { await actie(); } finally { delete knop.dataset.bezig; await ververs(); }
  });
}

async function postJson(pad) {
  const r = await fetch(pad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(WACHT_MS) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.fout || `${r.status}`);
  return d;
}

tweeKlik($('stand-activeer'), 'activeer', async () => {
  const naam = $('stand-kies').value;
  if (!naam) return;
  try {
    const { tekst, rood } = activeerMelding(await postJson(`/api/standen/${encodeURIComponent(naam)}/activeer`));
    meld(tekst);
    for (const r of rood.slice(0, 3)) meld(r, 'fout');
  } catch (err) { meld(`niet geactiveerd: ${err.message}`, 'fout'); }
  kiezerSleutel = '';
});

tweeKlik($('stand-terug'), 'vorige terugzetten', async () => {
  try {
    const d = await postJson('/api/standen/terug');
    meld(`vorige teruggezet: ${d.delen?.join(', ') || 'niets'}`);
    for (const f of (d.fouten ?? []).slice(0, 3)) meld(`${f.deel}: ${f.fout}`, 'fout');
  } catch (err) { meld(`niet teruggezet: ${err.message}`, 'fout'); }
  kiezerSleutel = '';
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

let verversBezig = false;
async function ververs() {
  if (verversBezig) return;   // de vorige loopt nog (trage server): niet stapelen
  verversBezig = true;
  try { await Promise.all([leesServer(), leesMixer(), leesStems(), leesSecties(), leesStanden()]); tekenStand(); }
  finally { verversBezig = false; }
}

klok(); setInterval(klok, 10000);
try { stand.proef = await haal('/api/proef'); } catch (_) { meld('speellijst niet geladen: is de server er?', 'fout'); }
tekenLijst();
await ververs();
leesTooling().then(tekenStand);
vraagStatus();
setInterval(ververs, 2000);
setInterval(vraagStatus, 2000);
setInterval(() => leesTooling().then(tekenStand), 60000);
window.controle = { stand, ververs, mixerAdres: () => mixerAdres(stand.standen?.actief) };   // handig in de console en voor tools/headless/controle.mjs
