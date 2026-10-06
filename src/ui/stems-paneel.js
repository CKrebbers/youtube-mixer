import { read as readAction, invoke, metaOf, trackVanDeck } from '../control/actions.js';
import { DECK_IDS } from '../engine/engine.js';
import { knobVan } from './controls.js';
import { meld } from './meldingen.js';
import { VOLGORDE, aantalOpBus, rijStand, kolomTeken, stemUitleg } from './stems-weergave.js';
import { verschuivingTekst } from './toon-weergave.js';

/*
 * De STEMS-rij (docs/STEMS.md §4): voor de track met focus per stem een naam,
 * een niveauschuif en een kill-knop, en het stemkanaal (§5): drie kleine
 * draaiknoppen (filter, echo, galm) en een cue. Openen en sluiten met de knop
 * "stems" in de balk (onthouden, standaard dicht), zoals KLANKSCHAAL en AUTO.
 *
 * Alles gaat over de bus (`track.N.stem.<s>`, `.kill`, `.hold`): vensters.js
 * bindt de knoppen en schuiven bij het opstarten (ze staan vast in index.html),
 * de renderloop zet de schuiven elke frame op hun read(). Deze module schrijft
 * de track in hun data-action om als de focus wisselt, en laat zien welke
 * stems er zijn: wat read() null geeft bestaat in deze stand niet. Ontbreken
 * de stem-actions helemaal (een engine van vóór de stems), dan leest alles
 * null en staat er "geen stems": niets crasht.
 *
 * Zonder stems: wat er is (los bestand, wacht, 42%, klaar maar nog niet
 * geladen, mislukt) en de splitsknoppen 2 · 4 voor een library-nummer.
 *
 * Ook hier: het teken in de kolomkop (`kolomTeken`, spiegel.js vraagt het per
 * kolom) en de meldingen als een split klaar is of mislukt.
 */
const OPEN = 'varve.stems.open';
const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const schrijf = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

export function opzetStems({ engine, staat, wachtrij, library = null }) {
  const rij = document.getElementById('stems');
  const knop = document.getElementById('stems-btn');
  const trackEl = rij.querySelector('.st-track');
  const lijst = rij.querySelector('.st-stemmen');
  const geenEl = rij.querySelector('.st-geen');
  const tekstEl = rij.querySelector('.st-tekst');
  const splitsEl = rij.querySelector('.st-splitsen');
  const splitsKnoppen = [...rij.querySelectorAll('.st-splits')];
  const balk = rij.querySelector('.st-balk');
  const balkI = balk.querySelector('i');
  const xKnop = rij.querySelector('.st-x');
  const strips = Object.fromEntries([...rij.querySelectorAll('.st-stem')].map((el) => [el.dataset.stem, {
    el, naam: el.querySelector('.st-naam'), niveau: el.querySelector('.st-niveau'), kill: el.querySelector('.st-kill'),
    cue: el.querySelector('.st-cue'), toon: el.querySelector('.st-toon'), toonw: el.querySelector('.st-toonw'),
  }]));

  const tekst = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const klasse = (el, naam, aan) => { if (el.classList.contains(naam) !== aan) el.classList.toggle(naam, aan); };
  const titel = (el, t) => { if (el.title !== t) el.title = t; };
  const isDicht = () => rij.classList.contains('hidden');

  const zet = (open) => {
    rij.classList.toggle('hidden', !open);
    knop.style.color = open ? 'var(--text)' : '';
    schrijf(OPEN, open ? '1' : '0');
    if (open) wachtrij.peil();
  };
  knop.addEventListener('click', () => zet(isDicht()));
  if (lees(OPEN) === '1') zet(true);
  // Peilen zolang de rij open staat: dan zie je de voortgang van een split.
  wachtrij.kijk(() => !isDicht());

  // ---- de track met focus -----------------------------------------------------
  let nr = null;
  /** De actions van de rij naar track `n`; schuiven en knoppen lezen ze bij elke beweging. */
  function herschrijf(n) {
    nr = n;
    for (const el of rij.querySelectorAll('[data-action]')) {
      el.dataset.action = el.dataset.action.replace(/^track\.\d+\./, `track.${n}.`);
      if (el.dataset.actionShift) el.dataset.actionShift = el.dataset.actionShift.replace(/^track\.\d+\./, `track.${n}.`);
      // Een draaiknop onthoudt zijn action (de renderloop volgt k.action): die ook.
      const k = knobVan.get(el);
      if (k) k.action = el.dataset.action;
    }
    tekst(trackEl, `track ${n}`);
  }
  herschrijf(trackVanDeck(engine.focus));

  // Dubbelklik op een schuif: terug op vol, zoals een draaiknop terug naar zijn standaard.
  for (const { niveau } of Object.values(strips)) {
    niveau.addEventListener('dblclick', () => {
      const a = niveau.dataset.action;
      if (metaOf(a)?.type === 'value') invoke(a, 1);
    });
  }
  // Een klik op het getal naast de toonknop: terug naar 0 (zoals de dubbelklik op de knop).
  for (const { toon, toonw } of Object.values(strips)) {
    toonw?.addEventListener('click', () => {
      const a = toon?.dataset.action;
      if (a) invoke(`${a}.reset`, true);
    });
  }

  // ---- splitsen en annuleren (een library-nummer zonder stems) ----------------
  let zeker = null;   // { id, tot }: tweede klik op × binnen 3 s
  for (const b of splitsKnoppen) {
    b.addEventListener('click', async () => {
      const id = staat.deckTrack[engine.focus];
      if (!id) return;
      const aantal = Number(b.dataset.aantal);
      // Het nummer op de track met focus: daar ben je mee bezig, dus vooraan in de rij.
      const r = await wachtrij.splits(id, aantal, { vooraan: true });
      if (!r.ok) meld(`stems: niet gesplitst — ${r.fout}`, 'fout');
      else if (r.al) {
        meld(`dit nummer heeft al ${aantal} stems — laad het opnieuw om ze te horen`);
        library?.ververs();
      }
    });
  }
  xKnop.addEventListener('click', async () => {
    const o = wachtrij.opdrachten.find((x) => x.id === xKnop.dataset.opdracht);
    if (!o) return;
    // Een lopende split stoppen gooit werk weg: eerst een tweede klik (zoals de ingest).
    if (o.status === 'bezig' && !(zeker?.id === o.id && Date.now() < zeker.tot)) {
      zeker = { id: o.id, tot: Date.now() + 3000 };
      meld('klik nog eens op × om het splitsen te stoppen (het werk tot nu toe gaat weg)');
      return;
    }
    zeker = null;
    const r = await wachtrij.annuleer(o.id);
    if (!r.ok) meld(`stems: annuleren lukte niet — ${r.fout}`, 'fout');
  });

  // ---- meldingen uit de stems-rij van de server --------------------------------
  // Klaar terwijl het nummer al op een track staat: NIET vanzelf wisselen (het
  // speelt misschien), wel zeggen dat herladen ze geeft.
  const welkeTracks = (trackId) => DECK_IDS.filter((id) => staat.deckTrack[id] === trackId);
  wachtrij.on('klaar', (o) => {
    const op = welkeTracks(o.track).filter((id) => !aantalOpBus(readAction, trackVanDeck(id)));
    if (op.length) {
      meld(`${o.aantal} stems van "${o.titel || o.track}" staan klaar — laad het nummer opnieuw op track ${op.map(trackVanDeck).join(', ')} om ze te horen`, 'info', 8000);
    }
  });
  wachtrij.on('fout', (o) => meld(`stems van "${o.titel || o.track}" mislukt: ${o.fout || 'geen reden gegeven'}`, 'fout'));
  wachtrij.on('herstart', (n) => meld(`de server is herstart: ${n} stems-opdracht${n === 1 ? '' : 'en'} uit de rij ${n === 1 ? 'is' : 'zijn'} weg — splits opnieuw in de library of hier`, 'fout'));

  // ---- elk frame ---------------------------------------------------------------
  let vorigAantal = -1;
  /** De strips in de volgorde van deze stand: twee = zang, rest; vier = drums, bas, overig, zang | rest. */
  function zetStand(aantal) {
    vorigAantal = aantal;
    const zichtbaar = VOLGORDE[aantal] ?? [];
    for (const [s, st] of Object.entries(strips)) {
      klasse(st.el, 'hidden', !zichtbaar.includes(s));
      klasse(st.el, 'groep', aantal === 4 && s === 'inst');
      titel(st.naam, stemUitleg(s, aantal));
    }
    for (const s of zichtbaar) lijst.append(strips[s].el);   // verplaatsen houdt de luisteraars
    klasse(lijst, 'hidden', !zichtbaar.length);
    klasse(geenEl, 'hidden', zichtbaar.length > 0);
  }

  function teken() {
    const n = trackVanDeck(engine.focus);
    if (n !== nr) herschrijf(n);
    if (isDicht()) return;
    const aantal = aantalOpBus(readAction, n);
    if (aantal !== vorigAantal) zetStand(aantal);
    if (aantal) {
      // De schuiven en draaiknoppen volgt de renderloop (read() per frame);
      // hier de kills en de cue (null = geen koptelefoonuitgang: dof).
      for (const s of VOLGORDE[aantal]) {
        const st = strips[s];
        const weg = readAction(`track.${n}.stem.${s}.kill`) === 1;
        klasse(st.kill, 'on', weg);
        klasse(st.el, 'weg', weg);
        const cue = readAction(`track.${n}.stem.${s}.pfl`);
        klasse(st.cue, 'on', cue === 1);
        klasse(st.cue, 'dood', cue === null);
        // De eigen toon (halve tonen) en de toonsoort die je van deze stem hoort.
        if (st.toonw) {
          const d = engine.deck(engine.focus);
          const t = d.stemToon?.(s) ?? 0;
          tekst(st.toonw, verschuivingTekst(t) || '0');
          klasse(st.toonw, 'on', t !== 0);
          const k = t ? d.stemToonsoort?.(s) : null;
          titel(st.toonw, t ? `toon ${verschuivingTekst(t)} halve tonen${k?.naam ? ` — je hoort ${k.camelot} · ${k.naam}` : ''} (klik: terug naar 0)`
            : 'toon van deze stem (halve tonen; draai de knop ernaast, klik hier: terug naar 0)');
        }
      }
      return;
    }
    const id = engine.focus;
    const d = engine.deck(id);
    const nummer = staat.deckTrack[id];
    const st = rijStand({
      aantal, geladen: !!d.buffer, nummer, opdracht: nummer ? wachtrij.voor(nummer) : null,
      mislukt: staat.deckStems?.[id]?.mislukt ?? null, beschikbaar: wachtrij.beschikbaar, reden: wachtrij.reden,
    });
    tekst(tekstEl, st.tekst);
    titel(tekstEl, st.tekst);
    if (geenEl.dataset.soort !== st.soort) geenEl.dataset.soort = st.soort;
    klasse(splitsEl, 'hidden', !st.splits);
    for (const b of splitsKnoppen) {
      if (b.disabled !== !!st.uit) b.disabled = !!st.uit;
      titel(b, st.uit ? `kan niet splitsen: ${st.uit}` : b.dataset.aantal === '4' ? 'drums · bas · overig · zang' : 'zang en rest');
    }
    klasse(balk, 'hidden', !(st.soort === 'open' && st.bezig));
    if (st.soort === 'open' && st.bezig) {
      const w = `${(st.voortgang * 100).toFixed(1)}%`;
      if (balkI.style.width !== w) balkI.style.width = w;
    }
    klasse(xKnop, 'hidden', st.soort !== 'open');
    if (st.soort === 'open' && xKnop.dataset.opdracht !== st.annuleer) xKnop.dataset.opdracht = st.annuleer;
    titel(xKnop, st.bezig ? 'splitsen stoppen (tweede klik: het werk tot nu toe gaat weg)' : 'uit de rij halen');
  }

  /** Het teken in de kolomkop van track `deckId` (spiegel.js), of null. */
  function kolomTekenVan(deckId) {
    const nummer = staat.deckTrack[deckId];
    return kolomTeken({
      aantal: aantalOpBus(readAction, trackVanDeck(deckId)), nummer,
      opdracht: nummer ? wachtrij.voor(nummer) : null, mislukt: staat.deckStems?.[deckId]?.mislukt ?? null,
    });
  }

  return { teken, kolomTeken: kolomTekenVan };
}
