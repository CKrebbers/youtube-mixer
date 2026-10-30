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
 * De partituur (de APC: kolom = spoor, rij = variant van rustig naar vol; wisselt op de volgende maat):
 *   opstelling.variant.{k}.{r}   trigger  spoor k naar variant r (1..5); leest 1 = speelt, 0,5 = wacht op de maat, 0 = kan
 *   opstelling.rij.{r}           trigger  elk spoor naar variant r
 *   opstelling.stop.{k}          trigger  spoor k uit/aan op de maat (zijn fader)
 *   opstelling.glij.{s}          trigger  in vier maten naar scene s glijden (een opbouw)
 *   opstelling.b.{s}             trigger  scene s als eindpunt van de crossfader (de morph begint bij wat er nu staat)
 *   opstelling.morph             waarde   0 = waar je was, 1 = de gekozen scene; alles ertussen = een mengsel
 *
 * Laten lopen (kern/opstelling/verloop.js): één knop en de opstelling wordt een heel nummer.
 *   opstelling.loop              trigger  aan/uit: intro, opbouw, vol, breuk, vol, uitloop, elke maat op de maat;
 *                                         de scenes glijden mee; wat JIJ aanraakt gaat voor tot het volgende deel
 *   opstelling.laadloop          trigger  het gekozen recept klaarzetten en meteen laten lopen
 *
 * Processen (kern/opstelling/proces.js): één knop, en de opstelling verandert over minuten.
 *   opstelling.proces.{k}        trigger  proces k (1..8: groei, verval, zwerven, ademen, storm, oplossen, naar huis,
 *                                         evolutie) starten, of stoppen als hij loopt; duur STANDAARD_MATEN maten
 *   opstelling.proces.{k}.kort   trigger  hetzelfde, half zo lang (SHIFT)
 *   opstelling.proces.stop       trigger  alle processen stoppen (wat ze deden glijdt terug naar jouw stand)
 *   Ze tellen op bij wat jij zet (zoals de drift); groei en naar huis bakken hun eindstand in, verval en oplossen
 *   houden hun eindstand tot je ze stopt, storm eindigt met een breuk.
 *
 * De avond: thuis klaarzetten, live laten lopen zolang het interessant is.
 *   avond.lopen                  trigger  aan/uit: station na station (recept + zaad, of zijn take), elk met zijn verloop;
 *                                         na de uitloop het volgende, met een nieuw zaad: elke ronde anders
 *   avond.volgende               trigger  meteen naar het volgende station (op de maat)
 *   avond.vrij                   trigger  volgorde of vrij (vrij = gekozen op je smaak, nooit twee keer hetzelfde)
 *   zaal.mee                     trigger  de zaal speelt mee: zaal.beweging en zaal.geluid (de schermlaag meet ze met
 *                                         camera en microfoon) duwen dichtheid en beweging een stukje mee
 *
 * Vastleggen (kern/opstelling/take.js): wat je speelt als automation bewaren, en weer weg als het niets is.
 *   opstelling.neem              trigger  opnemen aan/uit (begint en eindigt op hele maten; ook het verloop als het liep)
 *   opstelling.take.speel        trigger  de gekozen take afspelen (zet zijn opstelling terug), nog eens = stop
 *   opstelling.take.weg          trigger  de gekozen take naar de prullenbak (niets is echt weg)
 *   opstelling.take.terug        trigger  de laatste uit de prullenbak terug
 *   opstelling.take.volgende / .vorige   trigger  een andere take kiezen
 *
 * Klaarzetten start nooit geluid (zoals een stand of set in v1): pas `opstelling.start` speelt.
 * Een macro zet zijn links via de bus (bron 'opstelling'), dus alles staat in het handelingenlog.
 * De drift (de opstelling beweegt uit zichzelf, macro "variatie") loopt in `tik(t)`, op de maatklok.
 */
import { normaliseerRecept, ROLLEN } from '../kern/opstelling/model.js';
import { realiseer, macroActies, sceneWaarden, PATROON_PLEK, RIJEN, MIDDEN } from '../kern/opstelling/realiseer.js';
import { muteer, kruis, drift, genereer } from '../kern/opstelling/varieer.js';
import { volgendZaad } from '../kern/opstelling/zaad.js';
import { maakVerloop, standOp } from '../kern/opstelling/verloop.js';
import { dun, legtVast, normaliseerTake, nogVast } from '../kern/opstelling/take.js';
import { PROCESSEN, procesVan, stand as procesStand, STANDAARD_MATEN } from '../kern/opstelling/proces.js';
import { stroom } from '../kern/opstelling/zaad.js';
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
  let actief = {};          // spoor -> variant die speelt
  let wacht = new Map();    // spoor -> variant die op de volgende maat komt (of 'stop'/'aan')
  let uitGezet = new Map();      // spoor -> fader van voor het uitzetten
  let glij = null;          // { van: [...], naar: Map(i -> v), t0, duur }
  let morph = { a: null, b: null, m: 0, naam: null };
  let loop = null;          // { v: verloop, start: maat of null, gepland, deel, hand: Set(spoor) }
  let takes = [];           // alle takes (genormaliseerd), op volgorde van maken
  let prullenbak = [];      // weggegooide takes (de laatste 50)
  let takeKeuze = -1;       // index in takes
  let opname = null;        // { start: tel of null, acties, recept, zaad, loop: { van } | null }
  let afspelen = null;      // { take, start: tel of null, i, laatst: Map }
  let avond = null;            // { stations: [{ recept, zaad?, take? }], i, vrij, ronde } of null
  let avondVrij = false;
  let zaalMee = false;
  const processen = new Map();  // id -> { start: tel | null, maten, zaad, rij, gebaren: Map, gemuteerd }

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
    if (afspelen && afspelen.take.recept !== nieuw.recept) stopAfspelen(false);
    stopProcessen(false);
    o = nieuw;
    actief = Object.fromEntries(Object.keys(o.varianten ?? {}).map((n) => [n, MIDDEN]));
    wacht = new Map();
    uitGezet = new Map();
    glij = null;
    morph = { a: null, b: null, m: 0, naam: null };
    loop = null;
    basis = o.macros.map((m) => m.waarde);
    nu = basis.slice();
    uit.emit('verander');
    const laden = [];
    for (const sp of o.sporen) {
      if (sp.soort === 'nummer' && sp.nummer && bronnen.laadNummer) laden.push(Promise.resolve(bronnen.laadNummer(sp.n, sp.nummer.id)).catch(() => {}));
      // Hetzelfde instrument staat er al: laten staan (herrollen tijdens het spelen zonder gat).
      if (sp.soort === 'instrument' && sp.instrument && engine.track(sp.n)?.instrument?.soort !== sp.instrument) laden.push(engine.zetInstrument(sp.n, sp.instrument));
    }
    await Promise.all(laden);
    if (o !== nieuw) return;   // een nieuwere opstelling won
    for (const sp of o.sporen) {
      if (sp.rack) engine.fx?.kiesRack?.(sp.n, sp.rack.naam);
      for (const [actie, v] of Object.entries(sp.waarden)) zetWaarde(actie, v);
    }
    for (const p of o.patronen) engine.patronen?.zetPatroon(p.n, p.plek, p.patroon);
    // Een korrelwolk met een bron vangt uit het nummer van dat spoor (vanaf zijn cue: er hoeft nog niets te spelen).
    for (const sp of o.sporen) if (sp.instrument === 'korrel' && sp.bron && engine.gebaren?.vang) { try { await engine.gebaren.vang(sp.n, sp.bron); } catch { /* geen nummer */ } }
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
      doe: (v) => { const i = macroVanRol(rol); if (i >= 0) { glij?.naar.delete(i); zetMacro(i, v); uit.emit('verander'); } },
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
  function startAlles() {
    for (const p of o.patronen) engine.patronen?.wissel(p.n, p.plek);
    for (const sp of o.sporen) {
      if (sp.soort !== 'nummer' || !sp.nummer) continue;
      const t = engine.track(sp.n);
      if (t?.speelt) continue;
      try { if (engine.klok.loopt) bus.doe(`track.${sp.n}.sync`, true, { bron: 'opstelling' }); bus.doe(`track.${sp.n}.sync`, false, { bron: 'opstelling' }); } catch { /* geen grid */ }
      try { bus.doe(`track.${sp.n}.play.quant`, true, { bron: 'opstelling' }); bus.doe(`track.${sp.n}.play.quant`, false, { bron: 'opstelling' }); } catch { /* nog niet geladen */ }
    }
  }
  const speeltIets = () => !!engine.patronen?.speelt || engine.tracks.some((t) => t.speelt);
  trig('opstelling.start', 'opstelling: alles starten op de volgende "1"', () => {
    if (!o) return { geweigerd: 'nog geen opstelling' };
    startAlles();
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

  // ---- de partituur ---------------------------------------------------------------------
  function pasVariantToe(n, r) {
    const v = o?.varianten?.[n]?.[r - 1];
    if (!v) return;
    if (v.patroon) engine.patronen?.zetPatroon(Number(n), PATROON_PLEK, v.patroon);
    for (const [actie, w] of Object.entries(v.waarden ?? {})) zetWaarde(actie, w);
    actief[n] = r;
  }
  function pasStopToe(n) {
    if (uitGezet.has(n)) { zetWaarde(`track.${n}.fader`, uitGezet.get(n)); uitGezet.delete(n); }
    else { const f = bus.lees(`track.${n}.fader`); if (typeof f === 'number') { uitGezet.set(n, f); zetWaarde(`track.${n}.fader`, 0); } }
  }
  /** Wat op de maat wacht nu doen (of meteen, als de klok stilstaat). */
  function opDeMaat(t) {
    if (!wacht.size) return;
    if (engine.klok?.loopt && engine.klok.volgendeEen(t) - t > 0.15) return;
    for (const [n, x] of wacht) {
      if (x === 'stop') pasStopToe(n);
      else if (typeof x === 'object') { if (uitGezet.has(n)) pasStopToe(n); pasVariantToe(n, x.rij); }   // het verloop: spoor aan op rij r
      else pasVariantToe(n, x);
    }
    wacht = new Map();
    uit.emit('verander');
  }
  for (let k = 1; k <= 8; k++) {
    for (let r = 1; r <= RIJEN; r++) {
      bus.defineer({
        id: `opstelling.variant.${k}.${r}`, soort: 'trigger', label: `partituur: spoor ${k} variant ${r}`, meta: TRIG,
        doe: (v, _n, c) => { if (!v || !o?.varianten?.[k]) return undefined; if (c?.bron !== 'opstelling') loop?.hand.add(String(k)); wacht.set(String(k), r); opDeMaat(engine.nu()); uit.emit('verander'); return undefined; },
        lees: () => {
          if (!o?.varianten?.[k]?.[r - 1]) return null;
          const w = wacht.get(String(k));
          if (w === r || w?.rij === r) return 0.5;
          return actief[k] === r && !uitGezet.has(String(k)) ? 1 : 0;
        },
      });
    }
    bus.defineer({
      id: `opstelling.stop.${k}`, soort: 'trigger', label: `partituur: spoor ${k} uit/aan op de maat`, meta: TRIG,
      doe: (v, _n, c) => { if (!v || !o?.sporen.some((s) => s.n === k)) return undefined; if (c?.bron !== 'opstelling') loop?.hand.add(String(k)); wacht.set(String(k), 'stop'); opDeMaat(engine.nu()); uit.emit('verander'); return undefined; },
      lees: () => (o?.sporen.some((s) => s.n === k) ? (uitGezet.has(String(k)) ? 0 : 1) : null),
    });
  }
  for (let r = 1; r <= RIJEN; r++) {
    bus.defineer({
      id: `opstelling.rij.${r}`, soort: 'trigger', label: `partituur: alles naar rij ${r}`, meta: TRIG,
      doe: (v) => { if (!v || !o) return undefined; for (const n of Object.keys(o.varianten ?? {})) wacht.set(n, r); opDeMaat(engine.nu()); zeg(`rij ${r} op de maat`); return undefined; },
      lees: () => (o && Object.keys(o.varianten ?? {}).length ? (Object.values(actief).every((x) => x === r) ? 1 : 0) : null),
    });
  }
  for (let k = 1; k <= 8; k++) {
    bus.defineer({
      id: `opstelling.glij.${k}`, soort: 'trigger', label: `opstelling: in vier maten naar scene ${k}`, meta: TRIG,
      doe: (v) => {
        if (!v || !o) return undefined;
        const w = sceneWaarden(o, k, volgendZaad(o.zaad, 200 + teller++));
        if (!w) return { geweigerd: `scene ${k} bestaat niet` };
        const naar = new Map(Object.entries(w).map(([rol, x]) => [macroVanRol(rol), x]).filter(([i]) => i >= 0));
        if (!engine.klok?.loopt) { for (const [i, x] of naar) zetMacro(i, x); zeg(`scene ${o.scenes[k - 1].naam}`); return undefined; }
        glij = { van: basis.slice(), naar, t0: engine.klok.tel(engine.nu()), duur: 16, naam: o.scenes[k - 1].naam };
        zeg(`glijdt naar ${glij.naam} (4 maten)`);
        return undefined;
      },
      lees: () => (o?.scenes?.[k - 1] ? (glij?.naam === o.scenes[k - 1].naam ? 1 : 0) : null),
    });
    bus.defineer({
      id: `opstelling.b.${k}`, soort: 'trigger', label: `crossfader: scene ${k} als eindpunt`, meta: TRIG,
      doe: (v) => {
        if (!v || !o) return undefined;
        const w = sceneWaarden(o, k, volgendZaad(o.zaad, 300 + teller++));
        if (!w) return { geweigerd: `scene ${k} bestaat niet` };
        morph = { a: basis.slice(), b: new Map(Object.entries(w).map(([rol, x]) => [macroVanRol(rol), x]).filter(([i]) => i >= 0)), m: 0, naam: o.scenes[k - 1].naam };
        zeg(`crossfader: naar ${morph.naam}`);
        return undefined;
      },
      lees: () => (o?.scenes?.[k - 1] ? (morph.naam === o.scenes[k - 1].naam ? 1 : 0) : null),
    });
  }
  // ---- laten lopen ------------------------------------------------------------------------
  const perMaat = () => engine.klok?.perMaat ?? 4;
  function zetLoop(aan, { van = 0 } = {}) {
    if (!aan) { if (loop) { loop = null; zeg('lopen: uit (je speelt zelf verder)'); } return; }
    const v = maakVerloop(o, o.zaad);
    if (!v.delen.length) return;
    loop = { v, start: null, gepland: van - 1, deel: -1, hand: new Set(), van };
    if (!speeltIets()) startAlles();
    if (engine.klok?.loopt) loop.start = Math.floor(engine.klok.tel(engine.nu()) / perMaat()) + 1 - van;
    plan(van);
    zeg(`lopen: ${v.maten} maten (${v.delen.map((d) => d.naam.replace(/\d$/, '')).join(' · ')})`);
  }
  /** Maat `rel` van het verloop klaarzetten (de wachtrij zet het op de maat). */
  function plan(rel) {
    if (!loop || !o) return;
    loop.gepland = rel;
    const st = standOp(loop.v, rel);
    if (!st) {
      loop = null;
      if (avond) { volgendStation(); return; }
      engine.patronen?.stopAlles();
      zeg('lopen: klaar');
      return;
    }
    if (st.i !== loop.deel) {
      loop.deel = st.i;
      loop.hand.clear();
      if (st.deel.scene && engine.klok?.loopt) {
        const w = sceneWaarden(o, st.deel.scene, volgendZaad(o.zaad, 400 + st.i));
        if (w) {
          const naar = new Map(Object.entries(w).map(([rol, x]) => [macroVanRol(rol), x]).filter(([i]) => i >= 0));
          const t0 = (loop.start ?? Math.ceil(engine.klok.tel(engine.nu()) / perMaat())) * perMaat() + rel * perMaat();
          glij = { van: basis.slice(), naar, t0, duur: Math.min(st.deel.maten, 8) * perMaat(), naam: o.scenes[st.deel.scene - 1].naam };
        }
      }
      zeg(`lopen: ${st.deel.naam.replace(/\d$/, '')} (${st.deel.maten} maten)`);
    }
    for (const [n, rij] of Object.entries(st.sporen)) {
      if (loop.hand.has(n) || !o.varianten?.[n] && rij > 0 && !uitGezet.has(n)) continue;
      if (rij === 0) { if (!uitGezet.has(n)) wacht.set(n, 'stop'); }
      else if (uitGezet.has(n) || actief[n] !== rij) wacht.set(n, { rij });
    }
    uit.emit('verander');
  }
  bus.defineer({ id: 'opstelling.loop', soort: 'trigger', label: 'opstelling: laten lopen (een heel nummer) aan/uit', meta: TRIG,
    doe: (v) => { if (!v) return undefined; if (!o) return { geweigerd: 'nog geen opstelling: kies een recept' }; zetLoop(!loop); return undefined; },
    lees: () => (o ? (loop ? 1 : 0) : null) });
  trig('opstelling.laadloop', 'opstelling: het gekozen recept klaarzetten en laten lopen', () => {
    const r = recepten[gekozen];
    if (!r) return { geweigerd: 'geen recepten' };
    zet(maak(r, nieuwZaad())).then(() => zetLoop(true));
    return undefined;
  });

  // ---- de avond ----------------------------------------------------------------------------------
  const stationsNu = () => recepten.map((r) => ({ recept: r.id }));
  async function speelStation(i) {
    if (!avond) return;
    avond.i = i;
    const s = avond.stations[i];
    const r = recepten.find((x) => x.id === s.recept);
    if (!r) { volgendStation(); return; }
    const t = s.take ? takes.find((x) => x.id === s.take) : null;
    if (t) { takeKeuze = takes.indexOf(t); await speelTake(); }
    else { await zet(maak(r, s.zaad ?? volgendZaad(o?.zaad ?? 7, 600 + avond.ronde * 31 + i))); zetLoop(true); }
    zeg(`avond: ${r.naam} (${i + 1}/${avond.stations.length}${avond.vrij ? ', vrij' : ''})`);
  }
  function volgendStation() {
    if (!avond) return;
    const n = avond.stations.length;
    let j = (avond.i + 1) % n;
    if (avond.vrij && n > 1) {
      // Vrij: gewogen op je smaak (wat je bewaarde en lang speelde komt vaker), nooit hetzelfde als net.
      const sm = bronnen.catalogus?.()?.smaak ?? null;
      const r = stroom(o?.zaad ?? 7, 'avond', avond.ronde, avond.i);
      const kandidaten = avond.stations.map((_, k) => k).filter((k) => k !== avond.i);
      const w = kandidaten.map((k) => 1 + Math.max(0, sm?.kenmerken?.[`recept:${avond.stations[k].recept}`] ?? 0) * 0.3);
      let x = r.r() * w.reduce((a, b) => a + b, 0);
      j = kandidaten.find((_, q) => (x -= w[q]) <= 0) ?? kandidaten.at(-1);
    }
    if (j === 0) avond.ronde++;
    speelStation(j);
  }
  bus.defineer({ id: 'avond.lopen', soort: 'trigger', label: 'avond: station na station laten lopen (aan/uit)', meta: TRIG,
    doe: (v) => {
      if (!v) return undefined;
      if (avond) { avond = null; zeg('avond: uit (wat nu loopt, loopt door tot het eind)'); return undefined; }
      const stations = stationsNu();
      if (!stations.length) return { geweigerd: 'geen recepten' };
      avond = { stations, i: 0, vrij: avondVrij, ronde: 0 };
      // Speelt er al een opstelling: die is het eerste station (niets onderbreken); anders het eerste recept.
      const nu = o ? stations.findIndex((s) => s.recept === o.recept) : -1;
      if (nu >= 0) { avond.i = nu; if (!loop) zetLoop(true); zeg(`avond: loopt, vanaf ${o.naam}`); }
      else speelStation(0);
      return undefined;
    },
    lees: () => (recepten.length ? (avond ? 1 : 0) : null) });
  trig('avond.volgende', 'avond: naar het volgende station', () => { if (!avond) return { geweigerd: 'de avond loopt niet (avond.lopen)' }; loop = null; volgendStation(); return undefined; });
  bus.defineer({ id: 'avond.vrij', soort: 'trigger', label: 'avond: op volgorde of vrij', meta: TRIG,
    doe: (v) => { if (!v) return undefined; avondVrij = !avondVrij; if (avond) avond.vrij = avondVrij; zeg(`avond: ${avondVrij ? 'vrij (op je smaak)' : 'op volgorde'}`); return undefined; },
    lees: () => (avondVrij ? 1 : 0) });
  bus.defineer({ id: 'zaal.mee', soort: 'trigger', label: 'de zaal speelt mee (camera en microfoon)', meta: TRIG,
    doe: (v) => { if (!v) return undefined; zaalMee = !zaalMee; zeg(zaalMee ? 'de zaal speelt mee' : 'de zaal kijkt alleen'); return undefined; },
    lees: () => (zaalMee ? 1 : 0) });

  // ---- processen ---------------------------------------------------------------------------------
  function stopProces(id, { bak = false } = {}) {
    const pr = processen.get(id);
    if (!pr) return;
    processen.delete(id);
    for (const [g, v] of pr.gebaren) if (v > 0) { try { bus.doe(`gebaar.${g}`, 0, { bron: 'proces' }); } catch { /* weg */ } }
    // Inbakken: wat het proces met de macro's deed, wordt jouw stand (er springt niets terug).
    if (bak) basis = nu.slice();
    uit.emit('verander');
  }
  function stopProcessen(melding = true) {
    if (!processen.size) return;
    for (const id of [...processen.keys()]) stopProces(id);
    if (melding) zeg('processen: alles gestopt');
  }
  PROCESSEN.forEach((def, i) => {
    const k = i + 1;
    const start = (maten) => {
      if (!o) return { geweigerd: 'nog geen opstelling' };
      if (processen.has(def.id)) { stopProces(def.id, { bak: def.id === 'groei' || def.id === 'thuis' }); zeg(`${def.naam}: gestopt`); return undefined; }
      processen.set(def.id, { start: null, maten, zaad: volgendZaad(o.zaad, 500 + teller++), rij: null, gebaren: new Map(), gemuteerd: -1,
        thuis: def.id === 'thuis' ? o.macros.map((m, j) => ({ van: basis[j], naar: recepten.find((r) => r.id === o.recept)?.macros[j] ? (recepten.find((r) => r.id === o.recept).macros[j].start[0] + recepten.find((r) => r.id === o.recept).macros[j].start[1]) / 2 : basis[j] })) : null });
      if (!speeltIets()) startAlles();
      zeg(`${def.naam}: ${def.eindeloos ? 'loopt tot je hem stopt' : `${maten} maten`} (${def.uitleg})`);
      return undefined;
    };
    bus.defineer({ id: `opstelling.proces.${k}`, soort: 'trigger', label: `proces: ${def.naam}`, meta: TRIG,
      doe: (v) => (v ? start(STANDAARD_MATEN) : undefined), lees: () => (o ? (processen.has(def.id) ? 1 : 0) : null) });
    bus.defineer({ id: `opstelling.proces.${k}.kort`, soort: 'trigger', label: `proces: ${def.naam} (kort)`, meta: TRIG,
      doe: (v) => (v ? start(STANDAARD_MATEN / 2) : undefined), lees: () => (o ? (processen.has(def.id) ? 1 : 0) : null) });
  });
  trig('opstelling.proces.stop', 'processen: alles stoppen', () => { stopProcessen(); return undefined; });

  /** Elke drift-stap: wat alle processen nu willen, opgeteld (offsets per macro), plus partituur, gebaren, mutaties. */
  function procesStap(tel, doel) {
    if (zaalMee) {
      // De zaal: beweging duwt de dichtheid, geluid de beweging (rond 0,4 = neutraal), hooguit ±0,3.
      const lees = (id) => { try { const v = bus.lees(id); return typeof v === 'number' ? v : null; } catch { return null; } };
      const zb = lees('zaal.beweging'), zg = lees('zaal.geluid');
      const d = macroVanRol('dichtheid'), b = macroVanRol('beweging');
      doel = doel.slice();
      if (zb !== null && d >= 0) doel[d] = Math.min(1, Math.max(0, doel[d] + Math.max(-0.3, Math.min(0.3, (zb - 0.4) * 0.75))));
      if (zg !== null && b >= 0) doel[b] = Math.min(1, Math.max(0, doel[b] + Math.max(-0.3, Math.min(0.3, (zg - 0.4) * 0.6))));
    }
    if (!processen.size) return doel;
    const pm = perMaat();
    const extra = new Array(doel.length).fill(0);
    for (const [id, pr] of [...processen]) {
      const def = procesVan(id);
      if (pr.start === null) pr.start = tel;
      const ruw = (tel - pr.start) / (pr.maten * pm);
      const p = def.eindeloos ? ruw % 1 : Math.min(1, ruw);
      const st = procesStand(id, p, tel - pr.start, pr.zaad, pr.maten);
      for (const [rol, x] of Object.entries(st.macros)) { const i = macroVanRol(rol); if (i >= 0) extra[i] += x; }
      if (pr.thuis) pr.thuis.forEach((t, i) => { if (i < doel.length) extra[i] += (t.van + (t.naar - t.van) * (st.terug ?? 0)) - basis[i]; });
      // De partituur: alleen bij een wissel van rij, op de maat; wat jij zelf aanraakte laat het verloop met rust.
      if (st.rij && st.rij !== pr.rij && o?.varianten) {
        pr.rij = st.rij;
        for (const n of Object.keys(o.varianten)) if (!loop?.hand.has(n) && !uitGezet.has(n) && actief[n] !== st.rij) wacht.set(n, st.rij);
      }
      // Gebaren: alleen wat verandert.
      for (const [g, v] of Object.entries(st.gebaren)) {
        if (Math.abs((pr.gebaren.get(g) ?? 0) - v) < 0.02) continue;
        pr.gebaren.set(g, v);
        try { bus.doe(`gebaar.${g}`, v, { bron: 'proces' }); } catch { /* dat gebaar kan hier niet */ }
      }
      // Evolutie: elke 8 maten een spoor naar een andere rij en de knoppen een stap opzij (zonder opnieuw te laden).
      if (st.muteer) {
        const gen = Math.floor((tel - pr.start) / (8 * pm));
        if (gen > pr.gemuteerd) {
          pr.gemuteerd = gen;
          const r = stroom(pr.zaad, 'evolutie', gen);
          const sporen = Object.keys(o?.varianten ?? {});
          if (gen > 0 && sporen.length) { const n = r.kies(sporen); if (!loop?.hand.has(n)) wacht.set(n, r.geheel(1, 5)); }
          if (gen > 0) basis = basis.map((b, i) => (o.macros[i]?.rol === 'variatie' ? b : r.rond(b, 0.12)));
        }
      }
      // Einde: groei en naar huis bakken in, storm laat zijn breuk los, verval en oplossen houden hun eindstand.
      if (!def.eindeloos && ruw >= 1) {
        if (id === 'groei' || id === 'thuis') { doel.forEach((v, i) => { nu[i] = Math.min(1, Math.max(0, v + extra[i])); }); stopProces(id, { bak: true }); zeg(`${def.naam}: klaar`); }
        else if (id === 'storm' && ruw >= 1 + 1 / pr.maten) { stopProces(id); zeg('storm: voorbij'); }
      }
    }
    return doel.map((v, i) => Math.min(1, Math.max(0, v + extra[i])));
  }

  // ---- vastleggen: takes ----------------------------------------------------------------------
  const SPELER = new Set(['apc', 'maschine', 'toetsen', 'scherm', 'hub']);
  const volgendeMaatTel = () => (Math.floor(engine.klok.tel(engine.nu()) / perMaat()) + 1) * perMaat();
  const bewaarTakes = () => { try { bronnen.bewaarTakes?.({ takes, prullenbak }); } catch { /* bewaren mag nooit het spelen stoppen */ } };
  bus.on('actie', (a) => {
    if (!opname || !SPELER.has(a.bron) || !legtVast(a.id) || !engine.klok?.loopt) return;
    if (bus.zoek(a.id)?.def?.soort === 'commando') return;
    if (opname.start === null) opname.start = volgendeMaatTel() - perMaat();   // de maat waarin je begon
    const tel = engine.klok.tel(engine.nu()) - opname.start;
    if (tel >= 0) opname.acties.push({ tel, id: a.id, v: a.v });
  });
  function neem() {
    if (opname) {
      const o2 = opname;
      opname = null;
      if (!o2.acties.length || o2.start === null) { zeg('vastleggen: er was niets te bewaren'); return; }
      const eind = engine.klok.tel(engine.nu()) - o2.start;
      const maten = Math.max(1, Math.ceil(eind / perMaat() - 1e-6));
      const nr = takes.filter((x) => x.recept === o2.recept).length + 1;
      const t = normaliseerTake({ id: `take-${o2.recept}-${o2.zaad}-${teller++}`.slice(0, 80), naam: `${o?.naam ?? o2.recept} ${nr}`,
        recept: o2.recept, zaad: o2.zaad, maten, gemaakt: takes.length + prullenbak.length + 1, loop: o2.loop, acties: dun(o2.acties) });
      takes.push(t);
      takeKeuze = takes.length - 1;
      bewaarTakes();
      zeg(`vastgelegd: ${t.naam} (${maten} maten, ${t.acties.length} handelingen)`);
      return;
    }
    if (!o) return { geweigerd: 'nog geen opstelling' };
    if (!speeltIets()) startAlles();
    const begin = engine.klok?.loopt ? volgendeMaatTel() - perMaat() : null;
    opname = { start: begin, acties: [], recept: o.recept, zaad: o.zaad,
      loop: loop && begin !== null ? { van: Math.max(0, Math.round(begin / perMaat()) - loop.start) } : null };
    zeg('vastleggen: speel maar (nog eens = klaar)');
    return undefined;
  }
  function stopAfspelen(melding = true) {
    if (!afspelen) return;
    for (const [id, v] of nogVast(afspelen.take.acties.slice(0, afspelen.i))) { try { bus.doe(id, v, { bron: 'take' }); } catch { /* weg */ } }
    afspelen = null;
    if (melding) zeg('take: stop');
  }
  async function speelTake() {
    if (afspelen) { stopAfspelen(); return; }
    const t = takes[takeKeuze];
    if (!t) { zeg('take: er is er nog geen (REC = vastleggen)'); return; }
    // Eerst de opstelling van toen (recept + zaad), als die niet al staat.
    const r = recepten.find((x) => x.id === t.recept);
    if (r && (o?.recept !== t.recept || o?.zaad !== t.zaad)) await zet(maak(r, t.zaad));
    if (!o) return;
    if (t.loop) zetLoop(true, { van: t.loop.van });
    else if (!speeltIets()) startAlles();
    afspelen = { take: t, start: engine.klok?.loopt ? volgendeMaatTel() : null, i: 0 };
    zeg(`take: ${t.naam} speelt (${t.maten} maten)`);
  }
  bus.defineer({ id: 'opstelling.neem', soort: 'trigger', label: 'opstelling: vastleggen aan/uit (een take)', meta: TRIG,
    doe: (v) => (v ? neem() : undefined), lees: () => (o ? (opname ? 1 : 0) : null) });
  trig('opstelling.take.speel', 'take: afspelen / stoppen', () => { speelTake(); return undefined; });
  trig('opstelling.take.weg', 'take: naar de prullenbak', () => {
    const t = takes[takeKeuze];
    if (!t) return { geweigerd: 'geen take gekozen' };
    if (afspelen?.take === t) stopAfspelen(false);
    takes.splice(takeKeuze, 1);
    prullenbak = [...prullenbak, t].slice(-50);
    takeKeuze = Math.min(takeKeuze, takes.length - 1);
    bewaarTakes();
    zeg(`weg: ${t.naam} (terug kan: take terug)`);
    return undefined;
  });
  trig('opstelling.take.terug', 'take: de laatste uit de prullenbak terug', () => {
    const t = prullenbak.at(-1);
    if (!t) return { geweigerd: 'de prullenbak is leeg' };
    prullenbak = prullenbak.slice(0, -1);
    takes.push(t);
    takeKeuze = takes.length - 1;
    bewaarTakes();
    zeg(`terug: ${t.naam}`);
    return undefined;
  });
  for (const [id, r] of [['opstelling.take.volgende', 1], ['opstelling.take.vorige', -1]]) {
    trig(id, `take: ${r > 0 ? 'volgende' : 'vorige'} kiezen`, () => {
      if (!takes.length) return { geweigerd: 'nog geen takes' };
      takeKeuze = ((takeKeuze + r) % takes.length + takes.length) % takes.length;
      zeg(`take: ${takes[takeKeuze].naam} (${takes[takeKeuze].maten} maten)`);
      return undefined;
    });
  }

  bus.defineer({
    id: 'opstelling.morph', soort: 'waarde', label: 'crossfader: van waar je was naar de gekozen scene',
    doe: (v) => {
      morph.m = v;
      if (!o || !morph.b) return;
      for (const [i, x] of morph.b) zetMacro(i, morph.a[i] + (x - morph.a[i]) * v);
      uit.emit('verander');
    },
    lees: () => (o ? morph.m : null),
  });

  return Object.assign(uit, {
    /** Wat buiten de engine ligt: catalogus(), laadNummer(n, id), zetVorm(id, dekking), bewaar(recept). */
    zetBronnen(b) { bronnen = { ...bronnen, ...b }; },
    /** Bewaarde takes terug (instelling 'takes': { takes, prullenbak }). */
    laadTakes(x) {
      takes = (Array.isArray(x?.takes) ? x.takes : []).map(normaliseerTake).filter(Boolean);
      prullenbak = (Array.isArray(x?.prullenbak) ? x.prullenbak : []).map(normaliseerTake).filter(Boolean).slice(-50);
      takeKeuze = takes.length - 1;
      uit.emit('verander');
    },
    takes: () => takes,
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
      if (!o) return;
      if (loop && engine.klok?.loopt) {
        const tel = engine.klok.tel(t), pm = perMaat();
        if (loop.start === null) loop.start = Math.ceil(tel / pm - 1e-6) - (loop.van ?? 0);
        const volgende = Math.floor(tel / pm) + 1, rel = volgende - loop.start;
        if (rel > loop.gepland && engine.klok.tijd(volgende * pm) - t < 0.2) plan(rel);
      }
      if (afspelen && engine.klok?.loopt) {
        const tel = engine.klok.tel(t);
        if (afspelen.start === null) afspelen.start = (Math.floor(tel / perMaat()) + 1) * perMaat();
        const rel = tel - afspelen.start, a = afspelen.take.acties;
        while (afspelen.i < a.length && a[afspelen.i].tel <= rel + 0.02) {
          const x = a[afspelen.i++];
          try { bus.doe(x.id, x.v, { bron: 'take' }); } catch { /* er is iets niet meer */ }
        }
        if (rel >= afspelen.take.maten * perMaat()) { stopAfspelen(false); zeg('take: klaar'); }
      }
      opDeMaat(t);
      if (!engine.klok?.loopt) return;
      const tel = engine.klok.tel(t);
      if (glij) {
        const f = Math.min(1, Math.max(0, (tel - glij.t0) / glij.duur));
        const g = f * f * (3 - 2 * f);
        for (const [i, x] of glij.naar) zetMacro(i, glij.van[i] + (x - glij.van[i]) * g);
        if (f >= 1) { zeg(`scene ${glij.naam}`); glij = null; } else uit.emit('verander');
      }
      if (!(tel - laatsteDrift >= 1 / DRIFT_PER_TEL)) return;
      laatsteDrift = tel;
      const vi = macroVanRol('variatie');
      const vari = vi >= 0 ? basis[vi] : 0;
      const doel = procesStap(tel, drift(o, tel, vari, basis));
      doel.forEach((v, i) => { if (Math.abs(v - nu[i]) > 0.002) zetMacro(i, v, { metBasis: false }); });
    },
    stand() {
      return {
        naam: o?.naam ?? null, recept: o?.recept ?? null, zaad: o?.zaad ?? null, melding,
        kandidaat: recepten[gekozen]?.naam ?? null, gekozen, aantal: recepten.length, terug: vorige.length,
        toon: o?.toon ?? null,
        macros: ROLLEN.map((rol) => { const i = macroVanRol(rol); return i >= 0 ? { rol, naam: o.macros[i].naam, waarde: basis[i], nu: nu[i] } : null; }),
        scenes: (o?.scenes ?? []).map((s) => s.naam),
        partituur: Object.fromEntries(Object.entries(o?.varianten ?? {}).map(([n, v]) => [n, { actief: actief[n], wacht: wacht.get(n) ?? null, uit: uitGezet.has(n), namen: v.map((x) => x.naam) }])),
        glij: glij ? glij.naam : null, morph: morph.naam ? { naar: morph.naam, m: morph.m } : null,
        avond: avond ? { station: avond.i + 1, van: avond.stations.length, ronde: avond.ronde + 1, vrij: avond.vrij } : null,
        zaalMee,
        processen: [...processen].map(([id, pr]) => {
          const def = procesVan(id), tel = engine.klok?.loopt ? engine.klok.tel(engine.nu()) : null;
          const p = pr.start === null || tel === null ? 0 : (tel - pr.start) / (pr.maten * perMaat());
          return { id, naam: def.naam, eindeloos: !!def.eindeloos, p: def.eindeloos ? null : Math.min(1, p), maten: pr.maten };
        }),
        take: { neemt: !!opname, maten: opname?.start != null && engine.klok?.loopt ? Math.max(0, Math.floor((engine.klok.tel(engine.nu()) - opname.start) / perMaat()) + 1) : 0,
          aantal: takes.length, prullenbak: prullenbak.length, keuze: takes[takeKeuze]?.naam ?? null, speelt: afspelen?.take.naam ?? null,
          lijst: takes.map((x, i) => ({ naam: x.naam, maten: x.maten, gekozen: i === takeKeuze, loop: !!x.loop })) },
        loop: loop ? (() => { const st = standOp(loop.v, Math.max(0, loop.gepland)); return st ? { deel: st.deel.naam.replace(/\d$/, ''), m: st.m + 1, maten: st.deel.maten, gedaan: Math.max(0, loop.gepland), totaal: loop.v.maten } : null; })() : null,
        sporen: (o?.sporen ?? []).map((s) => ({ n: s.n, soort: s.soort, wat: s.nummer?.titel ?? s.instrument ?? '—', rack: s.rack?.naam ?? null,
          patroon: o.patronen.find((p) => p.n === s.n)?.uitleg ?? null })),
      };
    },
  });
}
