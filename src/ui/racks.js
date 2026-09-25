import { DECK_IDS } from '../engine/engine.js';
import { EFFECTEN } from '../engine/fx.js';
import { trackVanDeck } from '../control/actions.js';
import { esc } from './dom.js';
import { meld, meldOpKnop } from './meldingen.js';
import { RackEditor } from './rack-editor.js';

/**
 * Effect-racks per link: ophalen, de kiezer in de RACK-rij van het focusdeel,
 * bewaren, bladeren (APC) en de rack-editor.
 *
 * Er is één RACK-rij op het scherm, en die hoort bij de track met FOCUS —
 * net als de device knobs op de APC. Een rack van een track zonder focus
 * klinkt gewoon door; alleen de kiezer toont hem niet.
 *
 * Een rack hoort bij het NUMMER, niet bij het deck. Laad je hetzelfde nummer
 * morgen op een ander deck, dan komen zijn racks mee.
 *
 * `naRack(deckId)` hoort elke rackwissel die hier gebeurt, meteen: het
 * handelingenlog (logboek.js) legt hem dan op het juiste moment vast. Wat de
 * rack-editor verandert ziet het log zelf, binnen 100 ms.
 */
export function opzetRacks({ engine, staat, naRack = () => {} }) {
  const { deckTrack } = staat;
  const rackCache = Object.fromEntries(DECK_IDS.map((id) => [id, []]));

  const rij = document.querySelector('#focusdeel .fx-row');
  /** Rechtstreeks uit de DOM, niet uit de renderloop. Null als de track geen focus heeft. */
  const fxEl = (deckId, klasse) => (deckId === engine.focus ? rij.querySelector(klasse) : null);

  /**
   * Racks van het nummer ophalen en het actieve laden. Dat laatste gebeurt ook
   * als de track geen focus heeft: een rack klinkt, of je hem nu ziet
   * of niet.
   */
  async function haalRacks(deckId) {
    const trackId = deckTrack[deckId];
    rackCache[deckId] = [];
    if (trackId) {
      try {
        const r = await fetch(`/api/library/${trackId}/racks`);
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        rackCache[deckId] = j.racks || [];
      } catch (err) { meld(`racks van dit nummer niet geladen (${err.message})`, 'fout'); }
    }
    // Intussen weer iets anders geladen? Dan hoort dit rack er niet bij.
    if (deckTrack[deckId] !== trackId) return;
    const actief = rackCache[deckId].find((x) => x.actief);
    const fx = engine.deck(deckId).fx;
    if (actief) {
      const fouten = fx.zetRack(actief.data, { herkomst: actief.id }).fouten;
      fouten.forEach((f) => console.warn(`[rack ${deckId}]`, f));
    } else if (typeof fx.herkomst === 'number') {
      // Een nummer zonder eigen rack mag het rack van het VORIGE nummer niet
      // houden: dan schreef "bewaar" daar overheen. Terug naar het standaardeffect.
      fx.standaard();
    }
    naRack(deckId);
    vulRackKiezer(deckId);
  }

  /** Een los bestand of de demotrack heeft geen racks van een nummer. */
  function losVanNummer(deckId) {
    rackCache[deckId] = [];
    vulRackKiezer(deckId);
  }

  /**
   * De kiezer toont wat er KLINKT, niet wat er ooit gekozen is. Dat staat in
   * `fx.herkomst`: het library-id van het rack, of null als er intussen iets
   * anders in zit (volgend effect, een los effect). Dan staat er "niet bewaard"
   * en kan "bewaar" niet stilletjes over een bewaard rack heen schrijven.
   */
  function vulRackKiezer(deckId) {
    const sel = fxEl(deckId, '.fx-rack');
    if (!sel) return;
    const eigen = deckTrack[deckId]
      ? `<optgroup label="van dit nummer">${rackCache[deckId].map((x) => `<option value="${x.id}">${esc(x.naam)}</option>`).join('')
        || '<option disabled>nog geen</option>'}</optgroup>`
      : '';
    const kant = sjablonen.length
      ? `<optgroup label="kant-en-klaar">${sjablonen.map((r, i) => `<option value="s:${i}">${esc(r.name)}</option>`).join('')}</optgroup>`
      : '';
    sel.innerHTML = '<option value="" disabled>— niet bewaard —</option>' + eigen + kant;
    volgRackKiezer(deckId);
  }

  /**
   * Kant-en-klare racks, uit `racks/sjablonen.json`. Data, geen code. Een
   * sjabloon laden geeft herkomst "s:<nr>": de kiezer weet dan wat er klinkt,
   * en bewaren maakt er een eigen rack van het nummer van — het sjabloon zelf
   * wordt nooit overschreven.
   */
  let sjablonen = [];
  fetch('racks/sjablonen.json')
    .then((r) => (r.ok ? r.json() : { racks: [] }))
    .then((d) => { sjablonen = d.racks || []; vulRackKiezer(engine.focus); })
    .catch((err) => console.warn('[rack] sjablonen niet geladen:', err.message));

  function volgRackKiezer(deckId) {
    const sel = fxEl(deckId, '.fx-rack');
    if (!sel || document.activeElement === sel) return;
    const waarde = String(engine.deck(deckId).fx.herkomst ?? '');
    if (sel.value !== waarde) sel.value = waarde;
  }

  /**
   * Eén manier van bewaren, voor de FX-rij én de editor.
   *
   * Komt wat er klinkt uit een bewaard rack, dan gaat het daaroverheen. Anders
   * (of met alsNieuw) wordt het een nieuw rack. Daarna is het nieuwe of
   * bijgewerkte rack het actieve, en staat de kiezer erop.
   */
  async function bewaarRack(deckId, { naam, alsNieuw = false } = {}) {
    const trackId = deckTrack[deckId];
    if (!trackId) throw new Error('alleen een nummer uit de library kan een rack bewaren');
    const fx = engine.deck(deckId).fx;
    if (naam) fx.hernoem(naam);
    // Alleen een echt library-id mag overschreven worden; een sjabloon niet.
    const id = alsNieuw || typeof fx.herkomst !== 'number' ? null : fx.herkomst;
    const res = await fetch(`/api/library/${trackId}/racks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, naam: fx.rackNaam, data: fx.naarJSON(), actief: true }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { rack } = await res.json();
    fx.herkomst = rack.id;
    // Niet haalRacks(): die zet het actieve rack opnieuw, en dan hoor je een
    // kruisfade op iets wat al klinkt. Alleen de lijst bijwerken.
    const lijst = rackCache[deckId].filter((x) => x.id !== rack.id).map((x) => ({ ...x, actief: false }));
    rackCache[deckId] = [...lijst, rack].sort((a, b) => a.gemaakt - b.gemaakt);
    vulRackKiezer(deckId);
    return { rack, nieuw: id === null };
  }

  {
    const kiezer = rij.querySelector('.fx-rack');
    kiezer.addEventListener('change', () => {
      const id = engine.focus;
      if (kiezer.value.startsWith('s:')) {
        const sjabloon = sjablonen[Number(kiezer.value.slice(2))];
        if (sjabloon) engine.deck(id).fx.zetRack(sjabloon, { herkomst: kiezer.value }).fouten.forEach((f) => console.warn(`[rack ${id}]`, f));
        naRack(id);
        kiezer.blur();
        return;
      }
      const rack = rackCache[id].find((x) => String(x.id) === kiezer.value);
      if (!rack) return;
      zetRackVan(id, rack);
      kiezer.blur();
    });

    const knop = rij.querySelector('.fx-bewaar');
    knop.addEventListener('click', async () => {
      const id = engine.focus;
      const fx = engine.deck(id).fx;
      if (!deckTrack[id]) { meldOpKnop(knop, 'geen library-nummer', false); return; }
      // Een nieuw rack heeft een naam nodig. Geen prompt(): zo'n venster legt
      // de hele pagina stil, ook MIDI, LED's en het ophalen van de stream.
      // De editor heeft een naamveld; daar gaan we heen.
      if (typeof fx.herkomst !== 'number') {
        rackEditor.openVoor(id);
        const veld = document.querySelector('#rack-editor .re-naam');
        veld.focus(); veld.select();
        meld('geef het rack een naam en klik "bewaar"');
        return;
      }
      try {
        const { nieuw } = await bewaarRack(id, {});
        meldOpKnop(knop, nieuw ? 'nieuw ✓' : 'bewaard ✓', true);
      } catch (err) {
        meldOpKnop(knop, 'mislukt', false);
        knop.title = err.message;
      }
    });
  }

  // ---- rack-editor ----------------------------------------------------------
  // `onOpen` zet onderpanelen.js: één paneel tegelijk onderin.

  const rackEditor = new RackEditor({
    root: document.getElementById('rack-editor'),
    engine,
    naamVan: (id) => `track ${trackVanDeck(id)}`,
    trackVan: trackVanDeck,
    effecten: EFFECTEN,
    kanBewaren: (id) => !!deckTrack[id],
    onBewaar: async ({ deckId, naam, alsNieuw }) => bewaarRack(deckId, { naam, alsNieuw }),
  });

  rij.querySelector('.fx-bewerk').addEventListener('click', () => {
    const id = engine.focus;
    if (rackEditor.open && rackEditor.deckId === id) rackEditor.sluit();
    else rackEditor.openVoor(id);
  });
  vulRackKiezer(engine.focus);

  /** Een rack van een nummer aanzetten, zoals de kiezer het doet. */
  function zetRackVan(id, rack) {
    rackCache[id].forEach((x) => { x.actief = x === rack; });
    engine.deck(id).fx.zetRack(rack.data, { herkomst: rack.id }).fouten.forEach((f) => console.warn(`[rack ${id}]`, f));
    naRack(id);
    fetch(`/api/library/${deckTrack[id]}/racks/${rack.id}`, { method: 'POST' }).catch(() => {});
  }

  // Door de racks bladeren (APC): eerst die van het nummer, dan de kant-en-klare.
  function rackStap(id, stap) {
    const lijst = [...rackCache[id].map((r) => ({ herkomst: r.id, zet: () => zetRackVan(id, r) })),
      ...sjablonen.map((r, i) => ({ herkomst: `s:${i}`, zet: () => { engine.deck(id).fx.zetRack(r, { herkomst: `s:${i}` }); naRack(id); } }))];
    if (!lijst.length) return;
    const nu = lijst.findIndex((x) => x.herkomst === engine.deck(id).fx.herkomst);
    lijst[(nu + stap + lijst.length) % lijst.length].zet();
    vulRackKiezer(id);
  }

  /**
   * De focus ging naar een andere track: de kiezer vult zich opnieuw. De
   * editor hoort bij wat je ziet en gaat mee naar de nieuwe focus.
   */
  function volgFocus(deckId) {
    vulRackKiezer(deckId);
    if (rackEditor.open && rackEditor.deckId !== deckId) rackEditor.openVoor(deckId);
  }

  return { haalRacks, losVanNummer, volgRackKiezer, rackStap, rackEditor, volgFocus };
}
