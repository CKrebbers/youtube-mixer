// Aanhaker 'set' (spoor S9, docs/PLAN-SET.md): een set klaarzetten en live bijmixen, sets bewaren
// en terugladen. Alleen dit spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// Wat hier gebeurt:
// - de actions plan.* (GO, buiten/terug, lagen; src/control/acties-set.js) en set.* (bewaren,
//   kiezen, terugladen, met of zonder de mixer) op de bus. Geen knop zit erop: Clay verdeelt ze;
//   een voorbeeld staat in mappings/stukken/set-voorbeeld.json (?stukken=set-voorbeeld);
// - window.varveSets voor het planvenster en het vak `sets` op werk.html (mac-2);
// - de live-stand (NU / VOLGENDE / DAARNA) naar de server voor het vak `plan` op de iPad: alleen
//   vanuit het tabblad met de APC, elke seconde als er iemand kijkt, anders elke 5 s.
// Niets in het MIDI-bericht: de actions zetten iets en de automaat kijkt bij zijn tik.
import { bindPlanActies } from '../../control/acties-set.js';
import { TRACKS, has, list } from '../../control/actions.js';
import { leesStand } from '../../control/handelingen.js';
import { maakUitvoerder } from '../../control/terugspelen.js';
import { maakSets, maakZetMoment } from '../sets.js';
import { maakLiveLezer } from '../../plan/live.js';
import { tabblad } from '../tabblad.js';
import { hubAdres } from '../vlag.js';
import { leesWeg } from '../../lib/antwoord.js';

const lees = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };

export default async function opzet(ctx) {
  const { engine, meld, staat, laden } = ctx;
  const auto = globalThis.window?.auto;
  // Een kale ctx (test/aanhaakpunten.test.mjs) of geen automaat: niets om aan te haken.
  if (!engine || !auto || typeof ctx.define !== 'function' || typeof location === 'undefined') return;
  const { define, invoke, read } = ctx;

  bindPlanActies({ auto, define });

  const deckVan = (nr) => TRACKS.find(([n]) => n === nr)?.[1] ?? null;
  const uitvoerder = maakUitvoerder({ engine, tracks: TRACKS, invoke, read, has, meld,
    laad: (deckId, e) => laden.laadVoorTerugspelen(deckId, e),
    huidig: (id) => staat.deckHerkomst[id] ?? null });
  async function heleLibrary() {
    const uit = [];
    for (let van = 0; van < 20000; van += 500) {
      const r = await fetch(`/api/library?sorteer=toegevoegd&van=${van}&aantal=500`);
      if (!r.ok) { await leesWeg(r); break; }
      const d = await r.json();
      uit.push(...(d.tracks || []));
      if ((d.tracks || []).length < 500) break;
    }
    return uit;
  }
  const sets = maakSets({
    meld,
    plan: () => window.varvePlan ?? null,
    werk: () => ctx.werk ?? null,
    patronenNaam: () => lees('varve.patronen.set') || 'set',
    speelt: (nr) => { const d = engine.deck(deckVan(nr)); return !!d && (d.playing || d.wacht); },
    moment: () => leesStand({ engine, tracks: TRACKS, herkomst: (id) => staat.deckHerkomst[id], acties: list(), lees: read }),
    zetMoment: maakZetMoment({ engine, tracks: TRACKS, laadLibrary: (id, t) => laden.laadLibrary(id, t), uitvoerder,
      herkomst: (id) => staat.deckHerkomst[id] ?? null, meld }),
    library: heleLibrary,
  });
  sets.ververs().catch(() => {});

  const OVERSLAAN = { log: 'overslaan', beginstand: false };
  const geen = () => (sets.st.lijst.length ? 0 : null);
  define('set.bewaar', 'trigger', (on) => { if (on) sets.bewaar().catch((e) => meld(`set: ${e.message}`, 'fout')); },
    { label: 'Set: bewaar de gekozen set (plan, patronen, werkruimte; met de mixer als dat aan staat)', read: geen, ...OVERSLAAN });
  define('set.next', 'trigger', (on) => { if (on && sets.kies(1)) meld(`set: ${sets.st.gekozen}`, 'info'); },
    { label: 'Set: volgende in de lijst', read: geen, ...OVERSLAAN });
  define('set.prev', 'trigger', (on) => { if (on && sets.kies(-1)) meld(`set: ${sets.st.gekozen}`, 'info'); },
    { label: 'Set: vorige in de lijst', read: geen, ...OVERSLAAN });
  define('set.terugladen', 'trigger', (on) => { if (on) sets.terugladen().catch((e) => meld(`set: ${e.message}`, 'fout')); },
    { label: 'Set: de gekozen set terugladen (over een spelende track met de mixer: tweede druk binnen 3 s)',
      read: () => (!sets.st.gekozen ? null : sets.stand().vraag ? 1 : 0.5), ...OVERSLAAN });
  define('set.moment', 'trigger', (on) => { if (on) sets.zetMetMoment(!sets.st.metMoment); },
    { label: 'Set: met of zonder de mixer (momentopname) bewaren en terugladen', read: () => (sets.st.metMoment ? 1 : 0), ...OVERSLAAN });

  const live = maakLiveLezer(auto);
  // Wat de iPad van de sets ziet (klein: de POST mag hooguit 32 kB).
  const lijstVoorLive = () => {
    const st = sets.stand();
    return { gekozen: st.gekozen, metMoment: st.metMoment, vraag: st.vraag, bezig: st.bezig,
      lijst: st.lijst.slice(0, 60).map(({ naam, titel, nummers, duur, moment }) => ({ naam, titel, nummers, duur, moment })) };
  };
  setInterval(() => { sets.ververs().catch(() => {}); }, 15000);
  window.varveSets = { ...sets, live };

  // ---- de live-stand naar de server (het vak `plan` op de iPad) ---------------------------------
  const hub = !!hubAdres();
  const isEerste = () => {
    if (!hub) return !!tabblad().eerste;
    const h = ctx.midi?.status?.().hub ?? {};
    return !!(h.verbonden || (!h.vervangen && tabblad().eerste));
  };
  let kijker = false, laatst = 0, bezig = false;
  setInterval(async () => {
    const n = Date.now();
    if (bezig || !isEerste() || n - laatst < (kijker ? 1000 : 5000)) return;
    bezig = true;
    laatst = n;
    try {
      const s = await live(n);
      const r = await fetch('/api/set/live', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stand: { ...s, sets: lijstVoorLive() } }) });
      const d = r.ok ? await r.json().catch(() => null) : (await leesWeg(r), null);
      kijker = !!d?.kijker;
    } catch (_) { /* de server is even weg: de volgende beurt */ } finally { bezig = false; }
  }, 500);
}
