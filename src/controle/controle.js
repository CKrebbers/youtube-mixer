import { SPEELLIJST, allePunten } from './speellijst.js';
import { KANAAL } from '../ui/status-zender.js';
import { LOCK_NAAM } from '../ui/tabblad.js';
import { stemsTegel } from '../ui/stems-weergave.js';
import { beeldTegel } from '../ui/beeld-weergave.js';
import { backupTegel } from './backup-tegel.js';
import { serverTegel } from './server-tegel.js';
import { avondpakketTegel } from './avondpakket-tegel.js';

/**
 * De Controlekamer (controle.html, docs/CONTROLEKAMER.md). Leest:
 * - de server: /api/tooling, /api/library (aantal), /api/ingest, /api/stems, /api/proef,
 *   /api/backups (de laatste kopie van library.db), /api/secties (hoeveel nummers nog
 *   geen actuele secties hebben), /api/avondpakket (vertrek/aankomst, docs/AVONDPAKKET.md:
 *   NIET elke 2 s, zie leesAvondpakket);
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
  avondpakket: null,   // antwoord van /api/avondpakket, { ontbreekt } of { fout }; null = nog niets
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
  const sleutel = pad.split('?')[0];   // de rust geldt voor de route, welke vraag er ook achter staat
  if (Date.now() < (rustTot.get(sleutel) ?? 0)) return undefined;
  try {
    const r = await fetch(pad, { cache: 'no-store', signal: AbortSignal.timeout(WACHT_MS) });
    if (r.ok) { rustTot.delete(sleutel); return { data: await r.json() }; }
    rustTot.set(sleutel, Date.now() + RUST_MS);
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

/*
 * Het avondpakket (docs/AVONDPAKKET.md): kan ik vertrekken, kan ik hier beginnen.
 * De meting start kindprocessen (system_profiler, find): daarom NIET in ververs()
 * maar bij het openen, bij een andere keuze, bij een klik op de tegel, en als de
 * mixer dichtging terwijl de tegel "niet gemeten" zei. Verder elke 5 minuten
 * automatisch, maar alleen als de pagina in beeld is en met `auto=1`: dan geeft
 * de server de cache of alleen het goedkope (pmset, df), nooit system_profiler
 * of find (review 2, fix 4: de server ziet alleen een spelend deck, en op de
 * iPhone ziet deze pagina de Web Lock van de mixer niet). Staat de mixer open
 * (Web Lock), dan meet de pagina niet vanzelf: de tweede laag naast de server,
 * die zelf bevriest zolang er een deck speelt. Een klik of een keuze mag wel (de
 * server geeft dan de bevroren stand).
 * Het profiel onthoudt deze browser; de fase niet (thuis zou anders dagenlang
 * "aankomst" in het rood staan). Een onthouden profiel dat niet meer bestaat,
 * wordt vergeten (review 2, fix 6).
 */
const AP_ELKE_MS = 5 * 60 * 1000;
const AP_PROFIEL = 'varve.avondpakket.profiel';
const ap = { profiel: '', fase: 'auto', bezig: false, nogEens: null, paklijst: '', laatst: 0, mixerOpen: false };
try { ap.profiel = localStorage.getItem(AP_PROFIEL) || ''; } catch (_) { /* privévenster: dan het standaardprofiel */ }

async function leesAvondpakket({ vers = false, gevraagd = false, auto = false } = {}) {
  // Loopt er al een, dan geen tweede tegelijk; een keuze of klik komt erna alsnog aan de beurt.
  if (ap.bezig) { if (gevraagd) ap.nogEens = { vers, gevraagd }; return; }
  if (!gevraagd && stand.mixer?.open) {
    // Nog niets gemeten en de mixer staat open: zeg het, in plaats van "…".
    if (!stand.avondpakket) { stand.avondpakket = { overgeslagen: 'mixer open: klik om te meten' }; tekenStand(); }
    return;
  }
  ap.bezig = true;
  try {
    const q = new URLSearchParams();
    if (ap.profiel) q.set('profiel', ap.profiel);
    if (ap.fase !== 'auto') q.set('fase', ap.fase);
    if (vers) q.set('vers', '1');
    else if (auto) q.set('auto', '1');
    const a = await haalLos(`/api/avondpakket${q.toString() ? `?${q}` : ''}`);
    if (a === undefined || a === null) return;   // rust na een 404/fout, of geen antwoord: houd wat er staat
    stand.avondpakket = a.data ?? a;
    ap.laatst = Date.now();
    if (stand.avondpakket.profielOnbekend) { ap.profiel = ''; try { localStorage.removeItem(AP_PROFIEL); } catch (_) {} }
    tekenAvondpakket();
  } finally {
    ap.bezig = false;
    tekenStand();
    if (ap.nogEens) { const n = ap.nogEens; ap.nogEens = null; leesAvondpakket(n); }
  }
}

/** De keuzelijsten, de punten, de paklijst en wat Varve dan kan (in de <details> onder de tegels). */
function tekenAvondpakket() {
  const a = stand.avondpakket;
  if (!a || !Array.isArray(a.punten)) return;
  const kies = $('ap-profiel');
  const opties = (a.profielen || []).map((p) => `${p.id}\t${p.titel}`).join('\n');
  if (kies.dataset.opties !== opties) {
    kies.innerHTML = (a.profielen || []).map((p) => `<option value="${esc(p.id)}">${esc(p.titel)} (${esc(p.id)})</option>`).join('');
    kies.dataset.opties = opties;
  }
  kies.value = a.profiel;
  // Een vaste fase in profielen.json (`fase`): dan is "auto" in de keuzelijst niet waar.
  if (a.faseBron && a.faseBron !== 'gekozen') {
    $('ap-fase').querySelector('option[value="auto"]').textContent = a.faseBron === 'data' ? `standaard: ${a.fase} (profielen.json)` : 'auto (niets aangesloten = vertrek)';
  }
  $('ap-punten').innerHTML = a.punten.map((p) => `<li data-licht="${esc(p.licht)}"><i class="led"></i><b>${esc(p.naam)}</b>
    <span class="ap-waarde">${esc(p.waarde)}</span>${p.sub ? `<span class="ap-sub">${esc(p.sub)}</span>` : ''}</li>`).join('');
  // De speellijst: alleen info, niet in het oordeel (ontwerp W15).
  const sl = a.info?.speellijst;
  const info = $('ap-info');
  info.hidden = !Number.isFinite(sl?.totaal);
  info.textContent = info.hidden ? '' : `speellijst: ${sl.gedaan} van ${sl.totaal} punten gedaan${sl.fout ? `, ${sl.fout} fout` : ''} (telt niet mee in het oordeel)`;
  // De paklijst alleen opnieuw tekenen als hij anders is: anders verdwijnen de vinkjes elke meting.
  const pak = JSON.stringify([a.profiel, a.paklijst || []]);
  if (pak !== ap.paklijst) {
    ap.paklijst = pak;
    $('ap-paklijst-profiel').textContent = `(${a.profiel})`;
    $('ap-paklijst').innerHTML = (a.paklijst || []).map((x, i) => `<li><label><input type="checkbox" id="ap-pak-${i}">
      ${esc(x.replace(/^☐\s*/, ''))}</label></li>`).join('');
  }
  const lijst = (l) => (l || []).map((x) => `<li>${esc(x)}</li>`).join('');
  $('ap-kan').innerHTML = lijst(a.kan);
  $('ap-kanniet').innerHTML = lijst(a.kanNiet);
  $('ap-let').innerHTML = lijst(a.let);
}

/** Het automatische moment (elke 5 min): alleen als deze pagina in beeld is, en dan alleen het goedkope. */
function apAutomatisch() {
  if (document.visibilityState !== 'visible') return;
  leesAvondpakket({ auto: true });
}
document.addEventListener('visibilitychange', () => {
  // Terug in beeld na meer dan 5 min verborgen: bijwerken (ook dan alleen het goedkope).
  if (document.visibilityState === 'visible' && Date.now() - ap.laatst > AP_ELKE_MS) apAutomatisch();
});

$('ap-profiel').addEventListener('change', (e) => {
  ap.profiel = e.target.value;
  try { localStorage.setItem(AP_PROFIEL, ap.profiel); } catch (_) {}
  leesAvondpakket({ gevraagd: true });
});
$('ap-fase').addEventListener('change', (e) => { ap.fase = e.target.value; leesAvondpakket({ gevraagd: true }); });
$('ap-meet').addEventListener('click', () => leesAvondpakket({ vers: true, gevraagd: true }));
$('tegels').addEventListener('click', (e) => { if (e.target.closest('[data-id="avondpakket"]')) leesAvondpakket({ vers: true, gevraagd: true }); });
$('tegels').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-id="avondpakket"]')) { e.preventDefault(); leesAvondpakket({ vers: true, gevraagd: true }); }
});

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

  t.push(avondpakketTegel(stand.server === false ? null : stand.avondpakket));

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

/** Tegels met een `id` krijgen data-id; Avondpakket is een knop (een klik meet opnieuw). */
const KLIKBAAR = new Set(['avondpakket']);

function tekenStand() {
  // De tegels worden elke 2 s opnieuw getekend: een tegel met de toetsenbordfocus
  // (Avondpakket is een knop) krijgt hem daarna terug (review 2, fix 10).
  const focus = document.activeElement?.closest?.('#tegels [data-id]')?.dataset.id;
  // De title draagt de hele tekst: de waarde kan nog afgekapt zijn (één regel). Een
  // tegel met een eigen `titel` (Avondpakket: alle punten) gebruikt die.
  $('tegels').innerHTML = tegels().map((g) => `
    <div class="tegel" data-licht="${g.licht}"${g.id ? ` data-id="${esc(g.id)}"` : ''}${KLIKBAAR.has(g.id) ? ' role="button" tabindex="0"' : ''}
      title="${esc(g.titel || [g.waarde, g.sub].filter((x) => x && x !== '—').join(' — '))}">
      <span class="tegel-naam"><i class="led"></i>${esc(g.naam)}</span>
      <span class="tegel-waarde">${esc(g.waarde)}</span>
      <span class="tegel-sub">${esc(g.sub)}</span>${g.regel ? `
      <span class="tegel-regel">${esc(g.regel)}</span>` : ''}
    </div>`).join('');
  if (focus) $('tegels').querySelector(`.tegel[data-id="${CSS.escape(focus)}"]`)?.focus();

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

let verversBezig = false;
async function ververs() {
  if (verversBezig) return;   // de vorige loopt nog (trage server): niet stapelen
  verversBezig = true;
  try {
    await Promise.all([leesServer(), leesMixer(), leesStems(), leesSecties()]);
    // De mixer ging dicht terwijl de tegel "niet gemeten · mixer open" zei: nu meten (review 2, fix 11).
    const open = !!stand.mixer?.open;
    if (ap.mixerOpen && !open && stand.avondpakket?.overgeslagen) leesAvondpakket();
    ap.mixerOpen = open;
    tekenStand();
  } finally { verversBezig = false; }
}

klok(); setInterval(klok, 10000);
try { stand.proef = await haal('/api/proef'); } catch (_) { meld('speellijst niet geladen: is de server er?', 'fout'); }
tekenLijst();
await ververs();
leesTooling().then(tekenStand);
leesAvondpakket();
setInterval(apAutomatisch, AP_ELKE_MS);
vraagStatus();
setInterval(ververs, 2000);
setInterval(vraagStatus, 2000);
setInterval(() => leesTooling().then(tekenStand), 60000);
window.controle = { stand, ververs, leesAvondpakket, apAutomatisch };   // handig in de console en voor tools/headless/controle.mjs en avondpakket.mjs
