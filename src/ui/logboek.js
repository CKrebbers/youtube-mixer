import { DECK_IDS } from '../engine/engine.js';
import { bijInvoke, invoke, read, has, list, TRACKS, trackVanDeck, bindLog } from '../control/actions.js';
import { Handelingenlog, leesStand, leesLog, rackStand, herinneringenVan, busNaarLog, koppelSectiedruk, LOG_VERSIE } from '../control/handelingen.js';
import { Terugspeler, maakUitvoerder, kentSecties } from '../control/terugspelen.js';
import { meld } from './meldingen.js';
import { esc, mmss, zetTekst } from './dom.js';

/**
 * Het handelingenlog in de schermlaag (docs/HANDELINGENLOG.md): de knop naast
 * de opnameknop, de lijst om terug te spelen, en wat het log moet zien maar
 * niet op de bus staat.
 *
 * VASTLEGGEN
 * - Elke action op de bus (bijInvoke), van MIDI, toetsenbord, muis of
 *   terugspelen, met de tijd op de audioklok.
 * - Laden (laden.js roept naLaad): welk nummer op welke track, met het grid.
 * - Focus: meteen, bij elke 'change' van de engine (de banen zetten focus
 *   buiten de bus om).
 * - Rack, grid, hotcues, sectiekaart en bewaarde pads: VERGELEKEN, niet gemeld. Na elke
 *   knopdruk (een microtask, dus direct achter de action) en elke 100 ms: de
 *   rack-editor, de tap-verfijning van de server, "opnieuw analyseren" en de
 *   hotcues die na het laden uit de library terugkomen (hotcue-opslag.js)
 *   gaan buiten de bus om, en die wil je bij terugspelen ook terug. Zonder
 *   de hotcues ZETTE een hotcue-knop bij terugspelen een nieuwe hotcue waar
 *   hij toen naar een bewaarde sprong. De sectiekaart komt na het laden van
 *   de server (laden.js, haalSecties); zonder hem in het log sprong
 *   `section.5` na een herberekening ergens anders heen.
 * - Loopt er een opname, dan hoort het log erbij met hetzelfde id: het begint
 *   en stopt met de opname. Een los log dat al liep wordt dan afgesloten en
 *   gaat na de opname als nieuw los log verder.
 *
 * TERUGSPELEN (terugspelen.js): eerst de beginstand (nummers laden, standen
 * zetten), dan de regels op hun moment. Wat in de library bewaard wordt
 * (grid, pads) blijft voor die tracks dicht tot er gewoon iets anders op
 * geladen wordt: staat.terugspeelDecks, zie laden.js.
 */
export function opzetLogboek({ engine, staat, laden, opnemer }) {
  const klok = () => engine.ctx.currentTime;
  const log = new Handelingenlog({ klok });
  // Eén melding voor het log (sleutel): de server die even weg was gaf anders één rode per verloren stuk.
  log.onFout = (f) => meld(`handelingenlog: ${f}`, 'fout', 8000, { sleutel: 'handelingenlog' });
  window.addEventListener('pagehide', () => log.noodstop());

  // ---- vastleggen -----------------------------------------------------------

  const gezien = { rack: {}, grid: {}, hotcues: {}, secties: {}, pads: null, focus: null };
  // Een rack verandert door zetRack (nieuw object), bewerkMacros (nieuwe lijst),
  // zetParam (nieuwe params), hernoem en aan/uit. Identiteit vergelijken is
  // goedkoop; de knopstanden horen er NIET bij, die staan als actions in het log.
  const rackSleutel = (fx) => [fx.rack, fx.rack?.macros, fx.rack?.name, fx.bypass, ...(fx.rack?.chain || []).map((n) => n.params)];
  const zelfde = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  const gridTekst = (d) => (d.grid ? JSON.stringify(d.grid.toJSON()) : 'null');
  const hotcueTekst = (d) => JSON.stringify(d.hotcues || []);
  const padsTekst = () => JSON.stringify(herinneringenVan(engine.sampler, trackVanDeck));

  /** Wat er nu staat telt als gezien: het staat al in de beginstand. */
  function onthoud() {
    for (const id of DECK_IDS) {
      const d = engine.deck(id);
      gezien.rack[id] = rackSleutel(d.fx);
      gezien.grid[id] = gridTekst(d);
      gezien.hotcues[id] = hotcueTekst(d);
      gezien.secties[id] = d.sectieKaart;
    }
    gezien.pads = padsTekst();
    gezien.focus = engine.focus;
  }

  function kijk() {
    if (!log.bezig) return;
    for (const [nr, id] of TRACKS) {
      const d = engine.deck(id);
      const s = rackSleutel(d.fx);
      if (!zelfde(s, gezien.rack[id])) { gezien.rack[id] = s; log.gebeurtenis('rack', { track: nr, rack: rackStand(d.fx) }); }
      const g = gridTekst(d);
      if (g !== gezien.grid[id]) { gezien.grid[id] = g; log.gebeurtenis('grid', { track: nr, grid: JSON.parse(g) }); }
      const h = hotcueTekst(d);
      if (h !== gezien.hotcues[id]) { gezien.hotcues[id] = h; log.gebeurtenis('hotcues', { track: nr, hotcues: JSON.parse(h) }); }
      // De sectiekaart op identiteit: setSectieKaart maakt altijd een nieuwe.
      if (d.sectieKaart !== gezien.secties[id]) {
        gezien.secties[id] = d.sectieKaart;
        log.gebeurtenis('secties', { track: nr, secties: d.sectieKaart ? d.sectieKaart.toJSON() : null });
      }
    }
    const p = padsTekst();
    if (p !== gezien.pads) { gezien.pads = p; log.gebeurtenis('pads', { herinneringen: JSON.parse(p) }); }
  }
  setInterval(kijk, 100);

  // De bus in het log (handelingen.js, busNaarLog): een knop (boolean) kan een
  // rack, grid of pad veranderen, die gebeurtenis komt direct achter de action;
  // vóór een sectiedruk eerst kijken (een kaart die net binnenkwam staat ervóór).
  bijInvoke(busNaarLog(log, kijk));
  // Een sectiedruk: de plek waarvan de sprong rekende erbij (vierde element).
  koppelSectiedruk(engine, TRACKS, log);

  engine.on('change', () => {
    if (!log.bezig || engine.focus === gezien.focus) return;
    gezien.focus = engine.focus;
    log.gebeurtenis('focus', { track: trackVanDeck(engine.focus) });
  });

  /** Een geslaagde laad (laden.js): welk nummer, waarvandaan, met welk grid. */
  function naLaad({ deckId, duur, ...info }) {
    if (!log.bezig) return;
    gezien.grid[deckId] = gridTekst(engine.deck(deckId));
    gezien.hotcues[deckId] = hotcueTekst(engine.deck(deckId));
    gezien.secties[deckId] = engine.deck(deckId).sectieKaart;     // (nog) geen: die komt erna als 'secties'
    log.gebeurtenis('laad', { track: trackVanDeck(deckId), ...info, duur: Math.round(duur * 1000) / 1000 });
  }

  const stand = () => leesStand({ engine, tracks: TRACKS, herkomst: (id) => staat.deckHerkomst[id], acties: list(), lees: read });

  /** Een mislukte start meldt het log zelf (onFout). */
  function startLog({ opname = null } = {}) {
    onthoud();
    return log.start({ opname, stand: stand(), kop: { sampleRate: engine.ctx.sampleRate, tracks: TRACKS.length } });
  }

  async function stopLog() {
    const r = await log.stop();
    if (!r.ok) return r;                  // de start mislukte al, en dat is gemeld (onFout)
    meld(`handelingenlog bewaard: opnames/${r.bestand} (${mmss(r.duur)}, ${grootte(r.bytes)})`
      + (r.waarschuwing ? ` — let op: ${r.waarschuwing}` : ''), r.waarschuwing ? 'fout' : 'info', 8000);
    return r;
  }
  const wissel = () => (log.bezig ? stopLog() : startLog());

  // Met de opname mee: zelfde id. Stop en start lopen synchroon tot hun eerste
  // await, dus er valt geen handeling tussen het oude en het nieuwe log.
  let losVoorOpname = false;
  opnemer.onBegin = (id) => {
    losVoorOpname = log.bezig && !log.opname;
    if (log.bezig) stopLog();
    startLog({ opname: id });
  };
  opnemer.onEind = (id) => {
    if (log.bezig && log.opname === id) stopLog();
    if (losVoorOpname && !log.bezig) startLog();
    losVoorOpname = false;
  };

  // ---- terugspelen ------------------------------------------------------------

  // Kent het log dat terugspeelt de sectiekaart (kentSecties), dan komt die
  // uit het log en haalt het laden hem NIET van de server; een ouder log wel.
  let sectiesUitLog = false;
  const terugspeler = new Terugspeler({
    klok, invoke,
    doe: maakUitvoerder({ engine, tracks: TRACKS, laad: (deckId, e) => laden.laadVoorTerugspelen(deckId, e, { sectiesUitLog }), meld, invoke, read, has,
      // Wat terugspelen zelf laadde (of een demo, die de library niet raakt)
      // hoeft een stand niet opnieuw te laden. Een nummer dat gewoon geladen
      // is wel: dan komt het in terugspeelDecks en bewaart het niets.
      huidig: (id) => (staat.terugspeelDecks.has(id) || staat.deckHerkomst[id]?.bron === 'demo' ? staat.deckHerkomst[id] : null) }),
  });
  // Loopt er een log terwijl we terugspelen (de opname van een nieuwe versie),
  // dan ziet dat log de actions wel, maar niet wat de stand buiten de bus om
  // zette: posities, tempo, cues, loops, wat speelt. Die stand gaat erin, zodat
  // ook die nieuwe versie terug te spelen is (terugspelen.js, Terugspeler._stand).
  terugspeler.onStand = () => { if (log.bezig) log.gebeurtenis('stand', stand()); };
  terugspeler.onFout = (f) => meld(`terugspelen: ${f}`, 'fout');
  terugspeler.onKlaar = ({ reden, gedaan, laat, maxLaat, mislukt, onbekend, overgeslagen }) => {
    speelt = null;
    meld(`terugspelen ${reden === 'klaar' ? 'klaar' : 'gestopt'}: ${gedaan} handelingen`
      + (laat ? `, ${laat} later dan 50 ms (hooguit ${Math.round(maxLaat * 1000)} ms)` : '')
      + (mislukt ? `, ${mislukt} mislukt` : '')
      + (overgeslagen ? `, ${overgeslagen} overgeslagen (track zonder zijn nummer van toen)` : '')
      + (onbekend ? `, ${onbekend} onbekende regels overgeslagen` : ''),
      mislukt || overgeslagen ? 'fout' : 'info', 10000);
  };

  let speelt = null;   // { id } van het log dat terugspeelt
  async function speel(id) {
    let tekst;
    try {
      const r = await fetch(`/api/handelingen/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).fout || `${r.status}`);
      tekst = await r.text();
    } catch (err) { meld(`terugspelen: log niet gelezen (${err.message})`, 'fout'); return; }
    const l = leesLog(tekst);
    if (l.kop?.versie > LOG_VERSIE) { meld(`terugspelen: dit log is van een nieuwere versie (${l.kop.versie})`, 'fout'); return; }
    if (!l.stand) meld('terugspelen: geen beginstand in dit log (eerste stuk kwijt) — het begint vanaf wat er nu staat', 'fout');
    if (l.kapot) meld(`terugspelen: ${l.kapot} kapotte regel${l.kapot === 1 ? '' : 's'} overgeslagen (afgebroken staart?)`, 'fout');
    await engine.resume().catch(() => {});
    if (engine.ctx.state !== 'running') { meld('terugspelen: de audio staat stil — klik eerst ergens op de pagina', 'fout'); return; }
    speelt = { id };
    sectiesUitLog = kentSecties(l);
    meld(`terugspelen: set-${id} (${mmss(l.duur)}) — nummers laden…`);
    await terugspeler.start({ stand: l.stand, regels: l.regels, duur: l.duur });
  }

  bindLog({ log, wissel, terugspeler });

  // ---- altijd aan (Clay 26 sep, VRAGEN J18) -----------------------------------
  // Een keuze die deze browser onthoudt (vinkje in de lijst achter ↺). Het log
  // begint vanzelf zodra de audio loopt: de klok van het log is de audioklok,
  // en die staat stil tot "audio starten". Eén keer per pagina: ○ log stopt
  // hem voor deze keer, herladen begint weer. Kost ~1–8 MB per uur in opnames/.
  const ALTIJD = 'varve.log.altijd';
  let altijd = false;
  try { altijd = localStorage.getItem(ALTIJD) === '1'; } catch {}
  let vanzelfGedaan = false;
  function vanzelf() {
    if (!altijd || vanzelfGedaan || log.bezig || engine.ctx.state !== 'running') return;
    vanzelfGedaan = true;
    startLog();
  }
  engine.ctx.addEventListener('statechange', vanzelf);
  vanzelf();
  function zetAltijd(aan) {
    altijd = aan;
    try { localStorage.setItem(ALTIJD, aan ? '1' : '0'); } catch {}
    // Aanzetten begint meteen (als de audio loopt); uitzetten laat een lopend log lopen.
    if (aan) { vanzelfGedaan = false; vanzelf(); }
  }

  // ---- knoppen en lijst -------------------------------------------------------

  const logKnop = document.getElementById('log-btn');
  const terugKnop = document.getElementById('terug-btn');
  const lijstEl = document.getElementById('log-lijst');
  logKnop.addEventListener('click', () => { engine.resume().catch(() => {}); wissel(); });
  terugKnop.addEventListener('click', () => {
    if (terugspeler.bezig) { terugspeler.stop(); return; }
    if (lijstEl.classList.contains('hidden')) toonLijst(); else lijstEl.classList.add('hidden');
  });
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape') lijstEl.classList.add('hidden'); });
  document.addEventListener('pointerdown', (e) => {
    if (!lijstEl.contains(e.target) && e.target !== terugKnop) lijstEl.classList.add('hidden');
  });

  /** "20260925-201302-2" -> "25-09 20:13:02" */
  const wanneer = (id) => { const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/.exec(id); return m ? `${m[3]}-${m[2]} ${m[4]}:${m[5]}:${m[6]}` : id; };

  async function toonLijst() {
    lijstEl.classList.remove('hidden');
    lijstEl.innerHTML = '<div class="log-kop">HANDELINGENLOGS</div><div class="log-rij log-klein">laden…</div>';
    let logs;
    try {
      const r = await fetch('/api/handelingen');
      if (!r.ok) throw new Error(`${r.status}`);
      logs = (await r.json()).logs || [];
    } catch (err) {
      lijstEl.innerHTML = `<div class="log-kop">HANDELINGENLOGS</div><div class="log-rij log-klein">niet gelezen (${esc(err.message)})</div>`;
      return;
    }
    lijstEl.innerHTML = '<div class="log-kop">HANDELINGENLOGS · terugspelen laadt dezelfde nummers op dezelfde tracks</div>'
      + `<label class="log-rij log-klein" title="begint vanzelf zodra de audio loopt; deze browser onthoudt het (~1–8 MB per uur)">
          <input type="checkbox" data-altijd ${altijd ? 'checked' : ''}> log altijd aan, vanaf het openen</label>`
      + (logs.length ? logs.map((l) => `<div class="log-rij">
          <span class="log-wanneer">${esc(wanneer(l.id))}</span>
          <span class="log-klein">${mmss(l.duur)} · ${grootte(l.bytes)}</span>
          ${l.opname ? '<span class="log-opn" title="er is een opname met hetzelfde id">● opname</span>' : ''}
          ${l.af ? '' : '<span class="log-klein" title="niet netjes gestopt: crash, of hij loopt nog">afgebroken</span>'}
          <button class="btn sm" data-speel="${esc(l.id)}" ${log.id === l.id ? 'disabled title="dit log loopt nu"' : ''}>speel</button>
        </div>`).join('') : '<div class="log-rij log-klein">nog geen — ○ log zet er een aan, en een opname neemt er vanzelf een mee</div>');
  }

  lijstEl.addEventListener('change', (e) => {
    if (e.target.matches('[data-altijd]')) zetAltijd(e.target.checked);
  });

  lijstEl.addEventListener('click', (e) => {
    const knop = e.target.closest('[data-speel]');
    if (!knop) return;
    // Destructief (vervangt wat er op de tracks staat): tweede klik binnen 3 s.
    const ietsGeladen = DECK_IDS.some((id) => engine.deck(id).buffer);
    if (ietsGeladen && !knop.dataset.zeker) {
      knop.dataset.zeker = '1';
      knop.textContent = 'nog eens = vervangt de tracks';
      setTimeout(() => { delete knop.dataset.zeker; knop.textContent = 'speel'; }, 3000);
      return;
    }
    lijstEl.classList.add('hidden');
    speel(knop.dataset.speel);
  });

  const grootte = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1000))} kB`);
  // Alleen schrijven wat verandert (zie renderloop.js).
  const tekst = zetTekst;   // de bestaande tekstknoop, geen nieuwe (dom.js)
  const titel = (el, t) => { if (el.title !== t) el.title = t; };

  /** Eén frame: tijd en grootte op de knop, en of er teruggespeeld wordt. */
  const teken = () => {
    tekst(logKnop, log.bezig ? `◉ log ${mmss(log.seconden)} · ${grootte(log.bytes)}` : '○ log');
    logKnop.classList.toggle('bezig', log.bezig);
    titel(logKnop, log.bezig
      ? `handelingenlog loopt${log.opname ? ` (hoort bij opname ${log.opname})` : ''} — klik om te stoppen`
      : 'handelingenlog: wat je doet, met de tijd, om de set terug te spelen (loopt vanzelf mee met een opname; altijd aan: vinkje achter ↺)');
    tekst(terugKnop, terugspeler.bezig ? `■ ${mmss(terugspeler.seconden)} / ${mmss(terugspeler.duur)}` : '↺');
    terugKnop.classList.toggle('bezig', terugspeler.bezig);
    titel(terugKnop, terugspeler.bezig ? `terugspelen: set-${speelt?.id ?? '?'} — klik om te stoppen (de tracks spelen door)` : 'een handelingenlog terugspelen');
  };

  return { log, terugspeler, naLaad, naRack: () => kijk(), teken };
}
