/**
 * De aanhakers van de werkruimte (14 okt, werkruimte S0, docs/werkruimte/S0.md).
 *
 * Elk spoor van de werkruimte (docs/WERKRUIMTE.md D4) zet zijn eigen deel van
 * de mixer op in ÉÉN bestand, `src/ui/aanhakers/<naam>.js`, met
 * `export default async function opzet(ctx) {}`. app.js roept ze hier aan, één
 * keer, na alle bestaande opzet. Zo raakt een spoor app.js nooit.
 *
 * Vaste volgorde (een latere aanhaker mag rekenen op wat een eerdere
 * definieerde, nooit andersom). Elke aanhaker wacht op de vorige.
 * Een aanhaker die gooit (ook bij het laden van zijn module): één melding
 * via ctx.meld, en de rest gaat door. Een kapot spoor legt de mixer niet stil.
 *
 * ctx = {
 *   engine, mapping (de APC-mapping), lagen, midi (de MidiHub), staat, meld,
 *   invoke, define, read, metaOf (de bus, actions.js), laden (laden.js),
 *   videoMixer,
 *   renderloop   { stap(naam, fn) }: fn(t) elk beeld (zie maakRenderloop),
 *   rijen        { registreerRij, rij, rijNamen } (rijen.js),
 *   maschine     Promise: de Maschine-instantie als speelapparaten.js hem
 *                maakte (alleen met ?hub=), anders null,
 * }
 */
export const AANHAKERS = ['precisie', 'uitlijn', 'werk', 'combi', 'apparaten', 'maschine', 'schermen', 'inrichten', 'set', 'effecten', 'indeling'];

/**
 * Alle aanhakers in volgorde. Geeft { gestart: [namen], mislukt: [{ naam, fout }] }.
 * `laad` is er voor de test (standaard: de module van die naam importeren).
 */
export async function startAanhakers(ctx, { namen = AANHAKERS, laad = (naam) => import(`./aanhakers/${naam}.js`) } = {}) {
  const gestart = [], mislukt = [];
  for (const naam of namen) {
    try {
      const mod = await laad(naam);
      const opzet = mod?.default;
      if (typeof opzet !== 'function') throw new Error('geen opzetfunctie (export default async function opzet(ctx))');
      await opzet(ctx);
      gestart.push(naam);
    } catch (err) {
      mislukt.push({ naam, fout: err });
      console.warn(`[aanhaker ${naam}]`, err);   // de melding is voor Clay, dit voor wie het uitzoekt
      try { ctx.meld?.(`aanhaker ${naam} niet gestart: ${err?.message || err}`, 'fout'); } catch (_) {}
    }
  }
  return { gestart, mislukt };
}

/**
 * Een kleine renderloop voor de aanhakers: stap(naam, fn) laat fn(t) elk beeld
 * draaien (requestAnimationFrame, t = zijn tijdstempel). Pas een eigen beeld als
 * er een stap is; zonder stappen kost hij niets. Een stap die gooit wordt één
 * keer gemeld en draait daarna niet meer (geen fout per beeld in de console).
 * Geeft een functie terug die de stap weer weghaalt.
 *
 * Bewust NAAST renderloop.js en niet erin: dat bestand is van een ander spoor
 * (S7), en een aanhaker mag de renderloop van de mixer niet kunnen breken.
 * Regel 3: een stap leest de stand (de audioklok), hij telt niet zelf.
 */
export function maakRenderloop({ raf = (f) => globalThis.requestAnimationFrame(f), meld = () => {} } = {}) {
  const stappen = new Map();
  let loopt = false;
  const beeld = (t) => {
    if (!stappen.size) { loopt = false; return; }
    for (const [naam, fn] of stappen) {
      try { fn(t); } catch (err) {
        stappen.delete(naam);
        console.warn(`[aanhaker-stap ${naam}]`, err);
        try { meld(`stap ${naam} gestopt: ${err?.message || err}`, 'fout'); } catch (_) {}
      }
    }
    raf(beeld);
  };
  return {
    stap(naam, fn) {
      if (typeof fn !== 'function') throw new Error(`stap ${naam}: geen functie`);
      stappen.set(naam, fn);
      if (!loopt) { loopt = true; raf(beeld); }
      return () => { if (stappen.get(naam) === fn) stappen.delete(naam); };
    },
    get stappen() { return [...stappen.keys()]; },
  };
}
