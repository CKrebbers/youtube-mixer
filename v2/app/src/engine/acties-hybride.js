/**
 * Hybride (Symbiose-lab, v2/HYBRIDE.md): het APC-grid is de kaart, ankers veranderen nooit, de
 * Maschine-schermen zijn etiketten, geluid bevestigt. Dit bestand is de engine-kant van de ruimtes
 * Thuis/Klank en Patch; de indeling (indelingen/apc40mk2-hybride.json) legt ze op de APC.
 *
 * Thuis (de kaart van bronnen):
 *   bron.{k}             trigger  rij 1: track k klinkt of zwijgt. Met een nummer: spelen/pauze; zonder: een drone
 *                                 in de toonsoort op het instrument van die kolom (W1: cel tikken, fader 1 omhoog)
 *   beweging.{k}         trigger  rij 2: een patroon uit het zaad op track k, aan/uit op de maat
 *   moment.{k}           trigger  rij 5 (tijd): leeg = de stand bewaren (faders, macro's, patch), gevuld = terug
 *   moment.{k}.wis       trigger  SHIFT: leegmaken
 * Patch (rij = bron, kolom = doel, helderheid = sterkte):
 *   patch.cel.{r}.{k}    trigger  bron r op doel k kiezen; een lege cel begint op 50%; de gekozen cel nog eens = uit
 *   patch.sterkte        waarde   de sterkte van de gekozen cel (device-knop 1: W2)
 *   patch.snelheid       waarde   hoe snel de bron van de gekozen rij gaat (device-knop 2)
 *   patch.leeg           trigger  alle koppelingen uit (alles terug zoals het stond)
 * Overal:
 *   klankje(ruimte)      zacht toontje bij een ruimtewissel, op de toonsoort (thuis = grondtoon)
 *
 * Bronnen r: 1 LFO (1 maat), 2 LFO (4 maten), 3 stap (per tel een nieuwe waarde), 4 dwaal (gladde ruis),
 * 5 Lorenz (chaos). Doelen k = het alfabet (kern/opstelling/model.js ROLLEN): met een opstelling macro k,
 * anders een vaste plek (DOEL_ZONDER). Modulatie is een offset op de stand van het doel; draai je zelf aan
 * het doel, dan schuift de stand mee. Toeval alleen uit een zaad (kern/opstelling/zaad.js).
 */
import { ROLLEN } from '../kern/opstelling/model.js';
import { stroom } from '../kern/opstelling/zaad.js';
import { maakPatroon, toonVan } from '../kern/opstelling/patroon.js';

export const BRON_INSTRUMENT = Object.freeze(['korrel', 'schaal', 'poly', 'fm', 'korrel', 'poly', 'schaal', 'fm']);
export const BRONNEN = Object.freeze(['lfo 1 maat', 'lfo 4 maten', 'stap', 'dwaal', 'lorenz']);
/** Doel k zonder opstelling ({f} = de track met focus). */
export const DOEL_ZONDER = Object.freeze(['track.{f}.filter', 'track.{f}.inst.knop.2', 'video.pulse', 'track.{f}.fx.mix',
  'track.{f}.hoog', 'video.master', 'track.{f}.inst.knop.7', 'track.{f}.send.b']);
/** Hoe ver een bron op volle sterkte duwt (± rond de stand). */
export const DIEPTE = 0.5;
/** Klankjes: halve tonen boven de grondtoon per ruimte. */
export const RUIMTE_TOON = Object.freeze({ thuis: 0, patch: 7, beeld: 4, tijd: 12 });

const TOONKLASSE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const klem01 = (v) => Math.min(1, Math.max(0, v));

export function definieerHybride(engine) {
  const bus = engine.bus;
  const T = (n) => engine.track(n);
  const zaad = () => engine.opstelling?.huidige?.()?.zaad ?? 2611;
  const zet = (id, v, bron = 'hybride') => { try { if (bus.lees(id) === null) return false; bus.doe(id, v, { bron }); return true; } catch { return false; } };
  const META = { beginstand: false };

  /** De toon van nu: de opstelling, anders wat je hoort, anders C (grondnoot MIDI in octaaf 3). */
  function grond() {
    const o = engine.opstelling?.huidige?.();
    if (o?.toon) return { grond: o.toon.grond, ladder: o.toon.ladder };
    const t = engine.hoorbareToon?.();
    const m = /^\s*([A-Ga-g])\s*(#|♯|b|♭)?\s*(m)?/.exec(String(t?.toonsoort ?? t ?? ''));
    if (!m) return { grond: 48, ladder: 'mineur' };
    const k = (TOONKLASSE[m[1].toLowerCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0) + 12) % 12;
    return { grond: 48 + k, ladder: m[3] ? 'mineur' : 'majeur' };
  }

  // ---- Thuis: bronnen, beweging, momenten -----------------------------------------------
  const drone = new Map();   // track -> [noten]
  for (let k = 1; k <= 8; k++) {
    bus.defineer({
      id: `bron.${k}`, soort: 'trigger', label: `bron ${k}: klinkt/zwijgt`, meta: META,
      doe: (v) => {
        if (!v) return undefined;
        const t = T(k);
        if (t.geladen) { bus.doe(`track.${k}.play`, true, { bron: 'hybride' }); bus.doe(`track.${k}.play`, false, { bron: 'hybride' }); return undefined; }
        if (drone.has(k)) {
          for (const n of drone.get(k)) engine.noot(n, 0, { n: k });
          drone.delete(k);
          engine.emit('track', k);
          return undefined;
        }
        const soort = BRON_INSTRUMENT[k - 1];
        const speel = () => {
          const g = grond().grond;
          const noten = [g, g + 7, g + 12];
          for (const n of noten) engine.noot(n, 0.7, { n: k });
          drone.set(k, noten);
          engine.emit('track', k);
        };
        if (t.instrument?.soort) speel();
        else engine.zetInstrument(k, soort).then(() => { if (T(k).instrument) speel(); });
        return undefined;
      },
      lees: () => (T(k).geladen ? (T(k).speelt ? 1 : 0) : drone.has(k) ? 1 : 0),
    });
    bus.defineer({
      id: `beweging.${k}`, soort: 'trigger', label: `beweging ${k}: een patroon uit het zaad, aan/uit op de maat`, meta: META,
      doe: (v) => {
        if (!v) return undefined;
        const p = engine.patronen;
        const st = p.stand(k);
        if (st.speelt === 5 && !st.stopt) { p.wissel(k, 5); return undefined; }
        const start = () => {
          const inst = T(k).instrument?.soort;
          if (!inst) return;
          const soort = inst === 'drums' ? 'drums' : inst === 'fm' ? 'bas' : inst === 'poly' ? 'akkoord' : 'lijn';
          const g = grond();
          const toon = toonVan(null, stroom(zaad(), 'hybride', 'toon', k));
          toon.grond = g.grond; toon.ladder = g.ladder === 'majeur' ? 'majeur' : 'mineur';
          const { patroon } = maakPatroon({ soort, dichtheid: [0.3, 0.6], lengte: [16, 32] }, (zaad() + k * 97) >>> 0, { n: k, toon });
          p.zetPatroon(k, 5, patroon);
          p.wissel(k, 5);
        };
        if (T(k).instrument) start();
        else if (!T(k).geladen) engine.zetInstrument(k, BRON_INSTRUMENT[k - 1]).then(start);
        return undefined;
      },
      lees: () => { const st = engine.patronen.stand(k); return st.speelt === 5 && !st.stopt ? 1 : st.wacht === 5 ? 0.5 : 0; },
    });
  }
  const momenten = new Map();
  const doelId = (k) => {
    const o = engine.opstelling?.huidige?.();
    if (o?.macros?.some((m) => m.rol === ROLLEN[k - 1])) return `opstelling.macro.${k}`;
    return DOEL_ZONDER[k - 1].replaceAll('{f}', String(engine.focus));
  };
  for (let k = 1; k <= 8; k++) {
    bus.defineer({
      id: `moment.${k}`, soort: 'trigger', label: `moment ${k}: bewaren of terug`, meta: META,
      doe: (v) => {
        if (!v) return undefined;
        const m = momenten.get(k);
        if (!m) {
          const s = { faders: engine.tracks.map((t) => bus.lees(`track.${t.n}.fader`)), macros: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => bus.lees(`opstelling.macro.${i}`)),
            patch: patch.cellen.map((rij) => rij.slice()) };
          momenten.set(k, s);
          engine.meld?.(`moment ${k} bewaard`, 'info', 'moment');
        } else {
          m.faders.forEach((f, i) => { if (typeof f === 'number') zet(`track.${i + 1}.fader`, f); });
          m.macros.forEach((x, i) => { if (typeof x === 'number') zet(`opstelling.macro.${i + 1}`, x); });
          patch.cellen = m.patch.map((rij) => rij.slice());
          patchVeranderd();
          engine.meld?.(`moment ${k} terug`, 'info', 'moment');
        }
        return undefined;
      },
      lees: () => (momenten.has(k) ? 1 : 0),
    });
    bus.defineer({ id: `moment.${k}.wis`, soort: 'trigger', label: `moment ${k} leegmaken`, meta: META,
      doe: (v) => { if (v) momenten.delete(k); }, lees: () => (momenten.has(k) ? 1 : 0) });
  }

  // ---- Patch: de matrix -----------------------------------------------------------------
  const patch = {
    cellen: BRONNEN.map(() => Array(8).fill(0)),    // [rij][kolom] sterkte 0..1
    gekozen: null,                                  // [r, k]
    snelheid: BRONNEN.map(() => 0.5),               // 0..1 -> ×0,25 … ×4
    doelen: new Map(),                              // kolom -> { id, basis }
    lorenz: { x: 0.1, y: 0, z: 0 },
    tLaatst: null,
  };
  const snelheidVan = (v) => Math.pow(16, v - 0.5);   // 0,25 … 4
  /** De waarde van bron r op dit moment, −1..1. */
  function bronWaarde(r, tel, dt) {
    const s = snelheidVan(patch.snelheid[r]);
    switch (r) {
      case 0: return Math.sin(2 * Math.PI * (tel * s) / 4);
      case 1: return Math.sin(2 * Math.PI * (tel * s) / 16);
      case 2: return stroom(zaad(), 'patch', 'stap', Math.floor(tel * s)).r() * 2 - 1;
      case 3: {
        // Gladde waardenruis: twee punten per 8 tellen, smoothstep ertussen.
        const x = (tel * s) / 8, i = Math.floor(x), f = x - i, g = f * f * (3 - 2 * f);
        const a = stroom(zaad(), 'patch', 'dwaal', i).r() * 2 - 1, b = stroom(zaad(), 'patch', 'dwaal', i + 1).r() * 2 - 1;
        return a + (b - a) * g;
      }
      case 4: {
        const L = patch.lorenz, h = Math.min(0.02, dt * s * 0.5);
        for (let n = 0; n < 4; n++) { const dx = 10 * (L.y - L.x), dy = L.x * (28 - L.z) - L.y, dz = L.x * L.y - (8 / 3) * L.z; L.x += dx * h; L.y += dy * h; L.z += dz * h; }
        return Math.max(-1, Math.min(1, L.x / 20));
      }
      default: return 0;
    }
  }
  /** Kolommen die modulatie hebben, met een vastgelegde stand; kolommen zonder: terug naar hun stand. */
  function patchVeranderd() {
    for (let k = 1; k <= 8; k++) {
      const actief = patch.cellen.some((rij) => rij[k - 1] > 0);
      const d = patch.doelen.get(k);
      if (actief && !d) {
        const id = doelId(k);
        const b = bus.lees(id);
        if (typeof b === 'number') patch.doelen.set(k, { id, basis: b });
      } else if (!actief && d) {
        zet(d.id, d.basis, 'patch');
        patch.doelen.delete(k);
      }
    }
  }
  // Draai je zelf aan een doel, dan schuift zijn stand mee (de modulatie zit erbovenop).
  bus.on('actie', (a) => {
    if (a.bron === 'patch' || typeof a.v !== 'number') return;
    for (const d of patch.doelen.values()) if (d.id === a.id) d.basis = a.v;
  });
  for (let r = 1; r <= BRONNEN.length; r++) for (let k = 1; k <= 8; k++) {
    bus.defineer({
      id: `patch.cel.${r}.${k}`, soort: 'trigger', label: `patch: ${BRONNEN[r - 1]} op ${ROLLEN[k - 1]}`, meta: META,
      doe: (v) => {
        if (!v) return undefined;
        const g = patch.gekozen;
        const al = g && g[0] === r && g[1] === k;
        if (al) { patch.cellen[r - 1][k - 1] = 0; patch.gekozen = null; }
        else { patch.gekozen = [r, k]; if (!patch.cellen[r - 1][k - 1]) patch.cellen[r - 1][k - 1] = 0.5; }
        patchVeranderd();
        engine.meld?.(al ? `patch: ${BRONNEN[r - 1]} × ${ROLLEN[k - 1]} uit` : `patch: ${BRONNEN[r - 1]} × ${ROLLEN[k - 1]} ${Math.round(patch.cellen[r - 1][k - 1] * 100)}%`, 'info', 'patch');
        return undefined;
      },
      lees: () => patch.cellen[r - 1][k - 1],
    });
  }
  bus.defineer({ id: 'patch.sterkte', soort: 'waarde', label: 'patch: sterkte van de gekozen koppeling',
    doe: (v) => { const g = patch.gekozen; if (!g) return { geweigerd: 'kies eerst een cel in de patch' }; patch.cellen[g[0] - 1][g[1] - 1] = klem01(v); patchVeranderd(); return undefined; },
    lees: () => (patch.gekozen ? patch.cellen[patch.gekozen[0] - 1][patch.gekozen[1] - 1] : null) });
  bus.defineer({ id: 'patch.snelheid', soort: 'waarde', label: 'patch: snelheid van de bron van de gekozen rij',
    doe: (v) => { const g = patch.gekozen; if (!g) return { geweigerd: 'kies eerst een cel in de patch' }; patch.snelheid[g[0] - 1] = klem01(v); return undefined; },
    lees: () => (patch.gekozen ? patch.snelheid[patch.gekozen[0] - 1] : null) });
  bus.defineer({ id: 'patch.leeg', soort: 'trigger', label: 'patch: alle koppelingen uit', meta: META,
    doe: (v) => { if (!v) return; patch.cellen = BRONNEN.map(() => Array(8).fill(0)); patch.gekozen = null; patchVeranderd(); }, lees: () => 0 });

  return {
    /** Elke tik: de patch op zijn doelen (alleen wat iets doet). De tijd zegt de klok, of de audioklok. */
    tik(t = engine.nu()) {
      if (!patch.doelen.size) { patch.tLaatst = t; return; }
      const dt = patch.tLaatst === null ? 0 : Math.max(0, Math.min(0.2, t - patch.tLaatst));
      patch.tLaatst = t;
      const tel = engine.klok?.loopt ? engine.klok.tel(t) : t * 2;
      const w = BRONNEN.map((_, r) => (patch.cellen[r].some((x) => x > 0) ? bronWaarde(r, tel, dt) : 0));
      for (const [k, d] of patch.doelen) {
        let x = d.basis;
        for (let r = 0; r < BRONNEN.length; r++) x += w[r] * patch.cellen[r][k - 1] * DIEPTE;
        zet(d.id, klem01(x), 'patch');
      }
    },
    /** Een zacht klankje voor een ruimte, op de toonsoort van nu (thuis = grondtoon). */
    klankje(ruimte) {
      const n = grond().grond + 24 + (RUIMTE_TOON[ruimte] ?? 0);
      try { engine.audio?.klankje?.(engine.ctx, engine.mixer.in, 440 * Math.pow(2, (n - 69) / 12)); } catch { /* geen geluid: niet erg */ }
    },
    stand() {
      return { gekozen: patch.gekozen, cellen: patch.cellen.map((r) => r.slice()), bronnen: BRONNEN, doelen: ROLLEN,
        drones: [...drone.keys()], momenten: [...momenten.keys()] };
    },
  };
}
