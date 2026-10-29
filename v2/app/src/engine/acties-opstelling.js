/**
 * Opstellingen op de bus (src/kern/opstelling): een recept (template) + een zaad wordt een
 * speelbare opstelling, en die bespeel je met acht macro's (het alfabet), scenes en bewerkingen
 * die hem elke keer anders maken. Lijm: geen DOM, geen Web Audio-nodes; wat buiten de engine
 * ligt (de library, het beeld, bewaren) geeft de schermlaag met `zetBronnen`.
 *
 *   opstelling.macro.{n}   waarde  macro n = rol n van het alfabet (1 schaal … 8 ruimte), dezelfde
 *                                  plek in elk recept; null als het recept die rol niet heeft
 *   opstelling.scene.{n}   trigger scene n (1..8): de macro's naar de stand van die scene (elke keer net anders)
 *   opstelling.herrol      trigger hetzelfde recept, een nieuw zaad: andere nummers, patronen, waarden
 *   opstelling.muteer      trigger een stap opzij (macro's, en soms één keuze opnieuw)
 *   opstelling.kruis       trigger half deze, half de vorige
 *   opstelling.terug       trigger de vorige opstelling terug (tot 32 stappen)
 *   opstelling.genereer    trigger een NIEUW recept uit de bouwdoos, meteen klaargezet
 *   opstelling.volgende / .vorige   trigger een ander recept kiezen (nog niet laden: het scherm toont hem)
 *   opstelling.laad        trigger het gekozen recept klaarzetten (met een nieuw zaad)
 *   opstelling.start       trigger alles op de volgende "1": patronen aan, nummers spelen (gesynct)
 *   opstelling.stop        trigger patronen stoppen
 *   opstelling.bewaar      trigger deze opstelling als nieuw recept bewaren (zo groeit de verzameling)
 *
 * Klaarzetten start nooit geluid (zoals een stand of set in v1): pas `opstelling.start` speelt.
 * Een macro zet zijn links via de bus (bron 'opstelling'), dus alles staat in het handelingenlog.
 * De drift (de opstelling beweegt uit zichzelf, macro "variatie") loopt in `tik(t)`, op de maatklok.
 */
import { normaliseerRecept, ROLLEN } from '../kern/opstelling/model.js';
import { realiseer, macroActies, sceneWaarden, PATROON_PLEK } from '../kern/opstelling/realiseer.js';
import { muteer, kruis, drift, genereer } from '../kern/opstelling/varieer.js';
import { volgendZaad } from '../kern/opstelling/zaad.js';
import { Emitter } from '../kern/emitter.js';

export const GESCHIEDENIS = 32;
/** Zo vaak per tel hooguit een drift-stap naar de bus (de bus en het log blijven rustig). */
export const DRIFT_PER_TEL = 4;
const TRIG = { beginstand: false };

export function definieerOpstelling(engine) {
  const bus = engine.bus;
  const uit = new Emitter();
  let bronnen = { catalogus: () => ({}), laadNummer: null, zetVorm: null, bewaar: null };
  let recepten = [];
  let gekozen = 0;          // index in recepten: wat volgende/vorige aanwijst
  let o = null;             // de opstelling van nu
  let basis = [];           // per macro: wat de speler zette (de drift beweegt eromheen)
  let nu = [];              // per macro: wat er nu op de bus staat
  let teller = 1;           // voor nieuwe zaden zonder toeval
  let laatsteDrift = -Infinity;
  const vorige = [];        // geschiedenis voor terug en kruis
  let melding = '';

  const zeg = (t) => { melding = t; engine.meld?.(`opstelling: ${t}`, 'info', 'opstelling'); uit.emit('verander'); };
  const catalogus = () => { try { return bronnen.catalogus() ?? {}; } catch { return {}; } };
  const nieuwZaad = () => volgendZaad(o?.zaad ?? 7, teller++);
  const macroVanRol = (rol) => (o ? o.macros.findIndex((m) => m.rol === rol) : -1);

  function zetMacro(i, v, { metBasis = true } = {}) {
    const m = o?.macros[i];
    if (!m) return;
    if (metBasis) basis[i] = v;
    nu[i] = v;
    for (const [actie, w] of macroActies(m, v)) zetWaarde(actie, w);
  }

  /** Eén waarde op de bus; wat er nu niet is (een stem zonder stems, geen instrument) slaan we stil over. */
  function zetWaarde(actie, w) {
    if (!bus.heeft(actie)) return;
    try { if (bus.lees(actie) === null) return; bus.doe(actie, w, { bron: 'opstelling' }); } catch { /* een link naar iets dat er nu niet is */ }
  }

  /** Een opstelling klaarzetten: nummers laden, instrumenten, racks, patronen, beeld, macro's. */
  async function zet(nieuw, { bewaarVorige = true } = {}) {
    if (bewaarVorige && o) { vorige.push(o); if (vorige.length > GESCHIEDENIS) vorige.shift(); }
    // Tracks die de vorige opstelling gebruikte en deze niet: zijn patroon op plek 5 en zijn instrument weg.
    const blijft = new Set(nieuw.sporen.map((s) => s.n));
    for (const sp of o?.sporen ?? []) {
      if (blijft.has(sp.n)) continue;
      if (o.patronen.some((p) => p.n === sp.n)) engine.patronen?.zetPatroon(sp.n, PATROON_PLEK, null);
      if (sp.soort === 'instrument' && engine.track(sp.n)?.instrument?.soort === sp.instrument) engine.zetInstrument(sp.n, null);
    }
    o = nieuw;
    basis = o.macros.map((m) => m.waarde);
    nu = basis.slice();
    uit.emit('verander');
    const wacht = [];
    for (const sp of o.sporen) {
      if (sp.soort === 'nummer' && sp.nummer && bronnen.laadNummer) wacht.push(Promise.resolve(bronnen.laadNummer(sp.n, sp.nummer.id)).catch(() => {}));
      // Hetzelfde instrument staat er al: laten staan (herrollen tijdens het spelen zonder gat).
      if (sp.soort === 'instrument' && sp.instrument && engine.track(sp.n)?.instrument?.soort !== sp.instrument) wacht.push(engine.zetInstrument(sp.n, sp.instrument));
    }
    await Promise.all(wacht);
    if (o !== nieuw) return;   // een nieuwere opstelling won
    for (const sp of o.sporen) {
      if (sp.rack) engine.fx?.kiesRack?.(sp.n, sp.rack.naam);
      for (const [actie, v] of Object.entries(sp.waarden)) zetWaarde(actie, v);
    }
    for (const p of o.patronen) engine.patronen?.zetPatroon(p.n, p.plek, p.patroon);
    if (o.beeld && bronnen.zetVorm) { try { bronnen.zetVorm(o.beeld.lagen[0], o.beeld.opacity); } catch { /* geen beeld */ } }
    o.macros.forEach((m, i) => zetMacro(i, basis[i]));
    uit.emit('verander');
  }

  function maak(recept, zaad) {
    return realiseer(recept, zaad, catalogus(), { focus: engine.focus ?? 1 });
  }

  const recept = () => recepten.find((r) => r.id === o?.recept) ?? null;

  // ---- de bus --------------------------------------------------------------------------
  for (let k = 1; k <= ROLLEN.length; k++) {
    const rol = ROLLEN[k - 1];
    bus.defineer({
      id: `opstelling.macro.${k}`, soort: 'waarde', label: `opstelling: macro ${k} (${rol})`,
      doe: (v) => { const i = macroVanRol(rol); if (i >= 0) { zetMacro(i, v); uit.emit('verander'); } },
      lees: () => { const i = macroVanRol(rol); return i >= 0 ? basis[i] : null; },
    });
  }
  for (let k = 1; k <= 8; k++) {
    bus.defineer({
      id: `opstelling.scene.${k}`, soort: 'trigger', label: `opstelling: scene ${k}`, meta: TRIG,
      doe: (v) => {
        if (!v || !o) return undefined;
        const w = sceneWaarden(o, k, volgendZaad(o.zaad, 100 + teller++));
        if (!w) return { geweigerd: `scene ${k} bestaat niet in ${o.naam}` };
        for (const [rol, x] of Object.entries(w)) { const i = macroVanRol(rol); if (i >= 0) zetMacro(i, x); }
        zeg(`scene ${o.scenes[k - 1].naam}`);
        return undefined;
      },
      lees: () => (o?.scenes?.[k - 1] ? 0 : null),
    });
  }
  const trig = (id, label, fn) => bus.defineer({ id, soort: 'trigger', label, meta: TRIG, doe: (v) => (v ? fn() : undefined), lees: () => (o || recepten.length ? 0 : null) });
  trig('opstelling.herrol', 'opstelling: nieuw zaad (alles opnieuw binnen het recept)', () => {
    const r = recept();
    if (!r) return { geweigerd: 'nog geen opstelling' };
    const z = nieuwZaad();
    zet(maak(r, z));
    zeg(`${r.naam} #${z}`);
    return undefined;
  });
  trig('opstelling.muteer', 'opstelling: muteren (een stap opzij)', () => {
    if (!o) return { geweigerd: 'nog geen opstelling' };
    const vari = nu[macroVanRol('variatie')] ?? 0.4;
    const { opstelling, wat } = muteer({ ...o, macros: o.macros.map((m, i) => ({ ...m, waarde: basis[i] })) }, nieuwZaad(), vari, catalogus());
    zet(opstelling);
    zeg(`gemuteerd: ${wat}`);
    return undefined;
  });
  trig('opstelling.kruis', 'opstelling: kruisen met de vorige', () => {
    if (!o) return { geweigerd: 'nog geen opstelling' };
    const b = [...vorige].reverse().find((x) => x.recept === o.recept);
    const { opstelling, wat } = kruis({ ...o, macros: o.macros.map((m, i) => ({ ...m, waarde: basis[i] })) }, b, nieuwZaad());
    zet(opstelling);
    zeg(wat);
    return undefined;
  });
  trig('opstelling.terug', 'opstelling: terug naar de vorige', () => {
    const v = vorige.pop();
    if (!v) return { geweigerd: 'niets om naar terug te gaan' };
    zet(v, { bewaarVorige: false });
    zeg('terug');
    return undefined;
  });
  trig('opstelling.genereer', 'opstelling: nieuw recept uit de bouwdoos', () => {
    const z = nieuwZaad();
    const r = genereer(catalogus(), z, { beeld: !!bronnen.zetVorm });
    recepten = [...recepten.filter((x) => x.id !== r.id), r];
    gekozen = recepten.length - 1;
    zet(maak(r, z));
    zeg(`nieuw: ${r.naam}`);
    return undefined;
  });
  for (const [id, r] of [['opstelling.volgende', 1], ['opstelling.vorige', -1]]) {
    trig(id, `opstelling: ${r > 0 ? 'volgend' : 'vorig'} recept kiezen`, () => {
      if (!recepten.length) return { geweigerd: 'geen recepten' };
      gekozen = ((gekozen + r) % recepten.length + recepten.length) % recepten.length;
      zeg(`kies: ${recepten[gekozen].naam} (laad = klaarzetten)`);
      return undefined;
    });
  }
  trig('opstelling.laad', 'opstelling: het gekozen recept klaarzetten', () => {
    const r = recepten[gekozen];
    if (!r) return { geweigerd: 'geen recepten' };
    const z = nieuwZaad();
    zet(maak(r, z));
    zeg(`${r.naam} #${z} staat klaar: start = spelen`);
    return undefined;
  });
  trig('opstelling.start', 'opstelling: alles starten op de volgende "1"', () => {
    if (!o) return { geweigerd: 'nog geen opstelling' };
    for (const p of o.patronen) engine.patronen?.wissel(p.n, p.plek);
    for (const sp of o.sporen) {
      if (sp.soort !== 'nummer' || !sp.nummer) continue;
      const t = engine.track(sp.n);
      if (t?.speelt) continue;
      try { if (engine.klok.loopt) bus.doe(`track.${sp.n}.sync`, true, { bron: 'opstelling' }); bus.doe(`track.${sp.n}.sync`, false, { bron: 'opstelling' }); } catch { /* geen grid */ }
      try { bus.doe(`track.${sp.n}.play.quant`, true, { bron: 'opstelling' }); bus.doe(`track.${sp.n}.play.quant`, false, { bron: 'opstelling' }); } catch { /* nog niet geladen */ }
    }
    zeg('start');
    return undefined;
  });
  trig('opstelling.stop', 'opstelling: patronen stoppen', () => { engine.patronen?.stopAlles(); zeg('patronen stil'); return undefined; });
  trig('opstelling.bewaar', 'opstelling: bewaren als nieuw recept', () => {
    if (!o) return { geweigerd: 'nog geen opstelling' };
    const r = recept();
    if (!r) return { geweigerd: 'het recept is weg' };
    const id = `${r.id.replace(/-b\d+$/, '')}-b${o.zaad}`.slice(0, 64);
    // De macro's beginnen voortaan rond waar ze nu staan; de rest van het recept blijft gelijk.
    const { recept: nieuw } = normaliseerRecept({ ...r, id, naam: `${r.naam} ${o.zaad % 1000}`,
      macros: r.macros.map((m) => { const i = macroVanRol(m.rol); const v = i >= 0 ? basis[i] : 0.5; return { ...m, start: [Math.max(0, v - 0.05), Math.min(1, v + 0.05)] }; }) });
    recepten = [...recepten.filter((x) => x.id !== id), nieuw];
    gekozen = recepten.length - 1;
    Promise.resolve(bronnen.bewaar?.(nieuw)).then(() => zeg(`bewaard: ${nieuw.naam}`), (e) => zeg(`bewaren mislukt: ${e?.message ?? e}`));
    return undefined;
  });

  return Object.assign(uit, {
    /** Wat buiten de engine ligt: catalogus(), laadNummer(n, id), zetVorm(id, dekking), bewaar(recept). */
    zetBronnen(b) { bronnen = { ...bronnen, ...b }; },
    /** De recepten (ruw of al genormaliseerd); geeft de fouten terug per recept. */
    zetRecepten(lijst) {
      const fouten = {};
      recepten = (Array.isArray(lijst) ? lijst : []).map((x) => { const { recept: r, fouten: f } = normaliseerRecept(x); if (f.length) fouten[r.id] = f; return r; });
      gekozen = Math.min(gekozen, Math.max(0, recepten.length - 1));
      uit.emit('verander');
      return fouten;
    },
    recepten: () => recepten,
    /** De opstelling van nu (de tocht leest er de kenmerken van voor je smaak). */
    huidige: () => o,
    /** Direct klaarzetten (de tests en het scherm). */
    zet: (r, zaad) => zet(maak(typeof r === 'string' ? recepten.find((x) => x.id === r) : r, zaad ?? nieuwZaad())),
    /**
     * De drift: op de maatklok, hooguit DRIFT_PER_TEL keer per tel. Wie hem aanroept (de schermlaag,
     * elke tik) zegt alleen WANNEER; WAT de tijd is zegt de klok (ARCHITECTUUR, uitgangspunt 2).
     */
    tik(t = engine.nu()) {
      if (!o || !engine.klok?.loopt) return;
      const tel = engine.klok.tel(t);
      if (!(tel - laatsteDrift >= 1 / DRIFT_PER_TEL)) return;
      laatsteDrift = tel;
      const vi = macroVanRol('variatie');
      const vari = vi >= 0 ? basis[vi] : 0;
      const doel = drift(o, tel, vari, basis);
      doel.forEach((v, i) => { if (Math.abs(v - nu[i]) > 0.002) zetMacro(i, v, { metBasis: false }); });
    },
    stand() {
      return {
        naam: o?.naam ?? null, recept: o?.recept ?? null, zaad: o?.zaad ?? null, melding,
        kandidaat: recepten[gekozen]?.naam ?? null, gekozen, aantal: recepten.length, terug: vorige.length,
        toon: o?.toon ?? null,
        macros: ROLLEN.map((rol) => { const i = macroVanRol(rol); return i >= 0 ? { rol, naam: o.macros[i].naam, waarde: basis[i], nu: nu[i] } : null; }),
        scenes: (o?.scenes ?? []).map((s) => s.naam),
        sporen: (o?.sporen ?? []).map((s) => ({ n: s.n, soort: s.soort, wat: s.nummer?.titel ?? s.instrument ?? '—', rack: s.rack?.naam ?? null,
          patroon: o.patronen.find((p) => p.n === s.n)?.uitleg ?? null })),
      };
    },
  });
}
