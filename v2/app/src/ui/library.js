/**
 * De library op het scherm: een VIRTUELE lijst (alleen de zichtbare rijen bestaan; een library
 * van duizenden nummers kost niets), kolomkoppen om te sorteren, de keuze (een controller
 * bladert met library.volgende/.vorige en laadt met library.laad op de track met focus), slepen
 * op een track, en laden met de tweede druk over een spelende track (v1).
 */
import { LibraryLijst, gridVan } from './library-lijst.js';
import { overzicht, overzichtUitPeaks, maakDemo, DEMOS, stroomVanWav } from './bronnen.js';

export const RIJ = 26;              // px, vast: de lijst rekent ermee
const tijd = (s) => { if (!Number.isFinite(s)) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

export function opzetLibrary({ engine, bus, wortel, overzichten }) {
  const $ = (s) => wortel.querySelector(s);
  const lijst = new LibraryLijst();
  const nummers = new Map();
  for (const d of DEMOS) nummers.set(d.id, { ...d, artiest: 'demo', demo: true, duur: d.duur ?? 120, toegevoegd: -1, gridLijst: d.pad ? null : { slot: true, stukken: [{ bpm: d.bpm }] } });

  const vak = $('#bieb-lijst');
  const binnen = document.createElement('div');
  binnen.className = 'bieb-binnen';
  vak.append(binnen);
  let getekend = '';

  function teken(forceer = false) {
    const h = vak.clientHeight, top = vak.scrollTop;
    const van = Math.max(0, Math.floor(top / RIJ) - 6), tot = Math.min(lijst.rijen.length, Math.ceil((top + h) / RIJ) + 6);
    const sleutel = `${van}|${tot}|${lijst.rijen.length}|${lijst.gekozen}|${lijst.sleutel}|${lijst.richting}|${lijst.zoek}`;
    if (!forceer && sleutel === getekend) return;
    getekend = sleutel;
    binnen.style.height = `${lijst.rijen.length * RIJ}px`;
    const frag = document.createDocumentFragment();
    for (let i = van; i < tot; i++) frag.append(rij(lijst.rijen[i], i));
    binnen.replaceChildren(frag);
    for (const k of wortel.querySelectorAll('[data-sorteer]')) {
      k.classList.toggle('aan', k.dataset.sorteer === lijst.sleutel);
      k.dataset.richting = k.dataset.sorteer === lijst.sleutel ? (lijst.richting > 0 ? '↑' : '↓') : '';
    }
  }

  function rij(x, i) {
    const li = document.createElement('div');
    li.className = 'bieb-rij';
    li.style.top = `${i * RIJ}px`;
    if (x.id === lijst.gekozen) li.classList.add('gekozen');
    li.draggable = true;
    li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/varve-nummer', x.id));
    li.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) { lijst.kies(x.id); teken(true); } });
    li.addEventListener('dblclick', () => laadOp(engine.focus, x.id));
    const g = gridVan(x);
    li.innerHTML = '<span class="titel"></span><span class="cijfer bpm"></span><span class="cijfer toon"></span><span class="cijfer duur"></span><span class="laad"></span>';
    const t = li.querySelector('.titel');
    t.textContent = x.titel;
    if (x.artiest && !x.demo) { const s = document.createElement('small'); s.textContent = x.artiest; t.append(s); }
    if (x.demo) t.insertAdjacentHTML('beforeend', '<span class="demo">DEMO</span>');
    const b = li.querySelector('.bpm');
    b.textContent = g.bpm ? g.bpm.toFixed(1).replace('.', ',') : '—';
    if (!g.zeker) { b.classList.add('grid-onzeker'); b.title = 'grid onzeker of ontbreekt: sync weigert'; }
    li.querySelector('.toon').textContent = x.toon ?? '';
    li.querySelector('.duur').textContent = tijd(x.duur);
    const laad = li.querySelector('.laad');
    for (let n = 1; n <= engine.tracks.length; n++) {
      const k = document.createElement('button');
      k.textContent = n; k.title = `laad op track ${n}`;
      k.onclick = () => laadOp(n, x.id);
      laad.append(k);
    }
    return li;
  }

  /** Zorg dat de keuze in beeld is (na bladeren met een controller). */
  function inBeeld() {
    const i = lijst.index;
    if (i < 0) return;
    const y = i * RIJ;
    if (y < vak.scrollTop) vak.scrollTop = y;
    else if (y + RIJ > vak.scrollTop + vak.clientHeight) vak.scrollTop = y + RIJ - vak.clientHeight;
  }

  vak.addEventListener('scroll', () => teken());
  new ResizeObserver(() => teken(true)).observe(vak);
  $('#zoek').addEventListener('input', (e) => { lijst.zoeken(e.target.value); vak.scrollTop = 0; teken(true); });
  for (const k of wortel.querySelectorAll('[data-sorteer]')) k.addEventListener('click', () => { lijst.sorteer(k.dataset.sorteer); teken(true); });

  async function haal() {
    try {
      const r = await fetch('/api/library');
      const j = await r.json();
      for (const x of j.nummers) nummers.set(x.id, { ...x, demo: false });
      $('#bieb-bron').textContent = j.bron ? `v1-library: ${j.nummers.length} nummers (alleen lezen)` : 'geen v1-library gevonden: alleen demonummers';
    } catch {
      $('#bieb-bron').textContent = 'server niet bereikbaar: alleen demonummers';
    }
    lijst.zet([...nummers.values()]);
    teken(true);
  }

  // Laden: een spelende, hoorbare track vervang je pas bij een tweede druk binnen 3 s (v1).
  const laatsteDruk = new Map();
  function laadOp(n, id) {
    const x = nummers.get(id);
    if (!x) return;
    const nu = performance.now();
    if (engine.track(n).speelt && engine.hoorbaar(n) && !(laatsteDruk.get(n) > nu - 3000)) {
      laatsteDruk.set(n, nu);
      engine.meld(`track ${n} speelt: druk nog eens om te vervangen`, 'info', `laad:${n}`);
      return;
    }
    laatsteDruk.delete(n);
    const nummer = {
      id: x.id, titel: x.titel, artiest: x.artiest, duur: x.duur, grid: null, zeker: true,
      haal: async () => {
        let pcm, grid = x.grid ?? null;
        if (x.demo) { const d = maakDemo(x); pcm = d.maakPcm(); grid = d.grid; }
        else pcm = await stroomVanWav(`/api/library/${encodeURIComponent(x.id)}/audio`);   // streamen (M7)
        nummer.grid = grid;
        if (!x.demo) {
          // Wat bij dit nummer bewaard is (hotcues, cue). Lukt het niet, dan laden we zonder.
          const d = await fetch(`/api/v2/nummer/${encodeURIComponent(x.id)}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
          nummer.hotcues = d.hotcues ?? null;
          nummer.cue = d.cue ?? 0;
        }
        overzichten.set(n, pcm.paginas ? overzicht(pcm) : null);
        if (!pcm.paginas) {
          fetch(`/api/library/${encodeURIComponent(x.id)}/peaks`)
            .then((r) => (r.status === 200 ? r.arrayBuffer() : null))
            .then((b) => { if (b && engine.track(n).nummer?.id === x.id) overzichten.set(n, overzichtUitPeaks(b)); })
            .catch(() => { /* geen overzicht: niet erg */ });
        }
        return pcm;
      },
    };
    bus.doe(`track.${n}.laad`, nummer);
  }

  // De bus: bladeren en laden (een controller, het toetsenbord). Niet in het log: de laad zelf staat erin.
  const stap = (d) => { lijst.stap(d); inBeeld(); teken(true); };
  bus.defineer({ id: 'library.volgende', soort: 'trigger', label: 'library: volgende', meta: { log: 'overslaan', beginstand: false }, doe: (v) => { if (v) stap(1); }, lees: () => 0 });
  bus.defineer({ id: 'library.vorige', soort: 'trigger', label: 'library: vorige', meta: { log: 'overslaan', beginstand: false }, doe: (v) => { if (v) stap(-1); }, lees: () => 0 });
  bus.defineer({
    id: 'library.laad', soort: 'trigger', label: 'library: laad op de focus-track', meta: { log: 'overslaan', beginstand: false },
    doe: (v) => { if (!v) return; if (lijst.gekozen === null) return { geweigerd: 'niets gekozen in de library' }; laadOp(engine.focus, lijst.gekozen); },
    lees: () => (lijst.gekozen === null ? 0 : 1),
  });

  haal();
  return { laadOp, lijst, nummers, teken };
}
