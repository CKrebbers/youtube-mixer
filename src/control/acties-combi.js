import { define as busDefine, invoke as busInvoke, read as busRead, metaOf as busMetaOf, TRACKS, trackVanDeck, STEM_LABELS } from './actions.js';
import { resolveTarget, zetVariabele } from './mapping.js';
import { normaliseerSuper, linkWaarden, legVast, linkNaarJSON, MAX_SUPER } from './superknop.js';
import { STEM_NAMEN } from '../engine/deck.js';
import { SEND_RACKS } from '../engine/engine.js';
import { clamp } from '../lib/emitter.js';

/**
 * Combinaties en effecten (14 okt, werkruimte S4, docs/werkruimte/S4.md;
 * ontwerp A8). Alles hier is de control-laag: de engine verandert niet.
 *
 *   track.N.send.a.hold / .send.b.hold   dub-worp: echo of galm vol zolang je drukt,
 *                                         loslaten = terug naar de stand van vóór
 *   track.N.fx.mix.hold                   het effect helemaal nat zolang je drukt
 *   track.N.stem.<s>.solo                 de ANDERE stems weg zolang je drukt (via hun .hold)
 *   super.1–16                            superknoppen: één knop beweegt veel (superknop.js)
 *   super.K.hold                          de superknop op 1 zolang je drukt
 *   super.K.vastA / .vastB                morph: de stand van nu als A (from) of B (to) (alleen scherm)
 *   send.a.rack.next/prev, send.b.…       een ander rack op de echo- of galmbus
 *
 * De drukvarianten werken zoals drukknop() in actions.js (een knopplek): de
 * eerste stand telt bij twee bronnen tegelijk, direct, zonder glijden. Ze gaan
 * buiten de bus om naar het deck (zoals fx.knob.K.hold), dus het log heeft
 * alleen de druk en het loslaten, en terugspelen doet hetzelfde.
 *
 * Wat ALLEEN kinderen op de bus zet (stem.solo, super.*), heeft `log:
 * 'overslaan'`: de kinderen staan in het log en spelen terug, de ouder niet
 * (anders twee keer). De auto-DJ ziet de kinderen ook (OVERNEEM in automaat.js);
 * send.a/b.hold raakt de mix buiten de bus om en zegt daarom zelf `overneem`.
 *
 * `bindCombi(opties)` definieert alles op de bus en geeft een handvat terug
 * (superknoppen zetten, bus-racks, status). Zonder opties: de echte bus.
 */

/** Hoeveel superknoppen (super.1 … super.16). */
export const SUPERKNOPPEN = MAX_SUPER;

/**
 * VOORBEELD (Clay 14 okt: jij bepaalt welke superknoppen er zijn; gooi dit weg
 * of pas het aan). Eén superknop "dub": echo en galm van de focus-track open,
 * het filter een stukje omhoog. Staat op super.1 zolang niemand iets anders zet;
 * er zit geen knop op (koppelen, of een werkruimte met `superknoppen`).
 */
export const VOORBEELD_SUPERKNOP = Object.freeze({
  naam: 'dub (voorbeeld)',
  links: [
    { target: 'track.{focus}.send.a', from: 0, to: 0.7 },
    { target: 'track.{focus}.send.b', in: [0.3, 1], from: 0, to: 0.5, curve: 'exp' },
    { target: 'track.{focus}.filter', in: [0.5, 1], from: 0.5, to: 0.8 },
  ],
});

/**
 * Welke stems gaan weg bij solo van `s`? De andere stems in het bestand. Bij
 * vier stems is `inst` drums + bas + overig samen: solo inst = alleen zang weg,
 * en solo van een van die drie laat `inst` buiten beschouwing (zang, en de
 * andere twee, gaan weg).
 */
export function andereStems(namen, s) {
  if (!Array.isArray(namen) || !namen.length) return [];
  if (s === 'inst' && !namen.includes('inst')) return namen.filter((n) => n === 'vocals');
  return namen.filter((n) => n !== s);
}

/**
 * De condities van `als` (mapping.js, witte lijst ALS) uit de engine. S3 mag
 * hem vervangen (mapping.als = …); dit is wat de combi-aanhaker zet als er nog
 * niets staat. `apparaten()` = welke apparaten er nu zijn (bv. ['apc40mk2']).
 */
export function maakAls(engine, { hub = false, apparaten = () => [] } = {}) {
  return (naam) => {
    const focus = engine.focus;
    const d = engine.deck?.(focus) ?? engine.decks?.[focus];
    const inst = engine.instrumentOp?.(focus) ?? null;
    switch (naam) {
      case 'focus.instrument': return !!inst;
      case 'focus.nummer': return !!d?.buffer && !inst;
      case 'focus.stems': return !!d?.stems;
      case 'focus.leeg': return !inst && !d?.buffer;
      case 'speel.instrument': return !!engine.speeltrack?.();
      case 'hub': return !!hub;
      default: return naam.startsWith('apparaat.') ? apparaten().includes(naam.slice(9)) : false;
    }
  };
}

/**
 * Een drukknop op een waarde: indrukken = `naar`, loslaten = de stand van vóór. De eerste druk telt.
 * `wie()` (optioneel): waar de stand bij hoort (het rack); is dat bij loslaten iets anders, dan
 * niet terugzetten (zoals drukknop() in actions.js: een oude stand betekent in een ander rack iets anders).
 */
function drukStand(lees, zet, { naar = 1, wie = () => null } = {}) {
  let vast = null, van = null;
  return {
    fn(on) {
      if (on) {
        if (vast !== null) return;
        const s = lees();
        if (typeof s !== 'number') return;      // niets om naar terug te gaan
        vast = s;
        van = wie();
        zet(naar);
      } else if (vast !== null) {
        const s = vast;
        vast = null;
        if (wie() === van) zet(s);
      }
    },
    ingedrukt: () => (vast !== null ? 1 : 0),
  };
}

export function bindCombi({
  engine,
  define = busDefine, invoke = busInvoke, read = busRead, metaOf = busMetaOf,
  vars = () => ({ focus: trackVanDeck(engine.focus) }),
  meld = () => {},
  racks = () => [],                 // de kant-en-klare racks (racks/sjablonen.json) voor de bussen
  onthoudBus = () => {},            // (bus, naam): de schermlaag bewaart het (localStorage)
} = {}) {
  // ---- drukvarianten per track ----------------------------------------------
  for (const [nr, id] of TRACKS) {
    const d = engine.deck(id);
    const n = `track.${nr}`;
    for (const bus of ['A', 'B']) {
      const druk = drukStand(() => d.ui[`send${bus}`], (v) => d.set(`send${bus}`, v));
      define(`${n}.send.${bus.toLowerCase()}.hold`, 'trigger', druk.fn,
        { label: `Track ${nr} ${bus === 'A' ? 'echo' : 'galm'} vol zolang je drukt (worp)`, read: druk.ingedrukt, overneem: true });
    }
    const mix = drukStand(() => d.fx?.mix, (v) => d.fx?.setMix(v), { wie: () => d.fx?.rack ?? null });
    define(`${n}.fx.mix.hold`, 'trigger', mix.fn,
      { label: `Track ${nr} FX helemaal nat zolang je drukt`, read: mix.ingedrukt });

    // Solo per stem: de andere stems weg via hun .hold (die gaan over de bus, dus in het log).
    // Geteld per stem: twee solo's tegelijk, dan pas terug als de laatste die hem wegzette loslaat.
    const wegDoor = {};                    // stem -> hoeveel solo's van deze track hem nu weg houden
    for (const st of STEM_NAMEN) {
      let weg = null;                      // de stems die deze druk wegzette
      define(`${n}.stem.${st}.solo`, 'trigger', (on) => {
        if (on) {
          if (weg || !d.stemBestaat?.(st)) return;
          weg = andereStems(d.stems?.namen, st);
          for (const o of weg) if ((wegDoor[o] = (wegDoor[o] || 0) + 1) === 1) invoke(`${n}.stem.${o}.hold`, true);
        } else if (weg) {
          const w = weg;
          weg = null;
          for (const o of w) if (--wegDoor[o] === 0) invoke(`${n}.stem.${o}.hold`, false);
        }
      }, { label: `Track ${nr} stem ${STEM_LABELS[st] ?? st} solo zolang je drukt (de andere stems weg)`,
           read: () => (!d.stemBestaat?.(st) ? null : weg ? 1 : 0), log: 'overslaan' });
    }
  }

  // ---- superknoppen ----------------------------------------------------------
  const supers = [];
  for (let k = 1; k <= SUPERKNOPPEN; k++) supers[k] = { naam: null, links: [], stand: 0, grijs: new Set(), gemeld: new Set(), vast: null };

  /** Bestaat dit doel als value-action? Anders grijs, met één melding per doel. */
  const geldig = (k, sup, doel) => {
    const m = metaOf(doel);
    if (m && m.type === 'value') { sup.grijs.delete(doel); return true; }
    sup.grijs.add(doel);
    if (!sup.gemeld.has(doel)) {
      sup.gemeld.add(doel);
      meld(`superknop ${k}: "${doel}" ${m ? 'is geen draaiknop (geen value-action)' : 'bestaat niet'}, die link doet niets`, 'fout');
    }
    return false;
  };

  /** De superknop op stand v: elke link via de bus (glijdend als hij dat vraagt en het kan). */
  const zetSuper = (k, v) => {
    const sup = supers[k];
    sup.stand = clamp(v);
    if (!sup.links.length) return;
    const w = linkWaarden(sup.stand, sup.links);
    const vv = vars();
    sup.links.forEach((l, i) => {
      const doel = resolveTarget(l.target, vv);
      if (!geldig(k, sup, doel)) return;
      if (l.glide && metaOf(`${doel}.glide`)) invoke(`${doel}.glide`, w[i]);
      else invoke(doel, w[i]);
    });
  };

  for (let k = 1; k <= SUPERKNOPPEN; k++) {
    const sup = supers[k];
    define(`super.${k}`, 'value', (v) => zetSuper(k, v),
      { label: `Superknop ${k}`, read: () => (sup.links.length ? sup.stand : null),
        // De kinderen staan in het log en in de beginstand; de superknop zelf niet (anders twee keer).
        log: 'overslaan', beginstand: false });
    define(`super.${k}.hold`, 'trigger', (on) => {
      if (on) { if (sup.vast !== null || !sup.links.length) return; sup.vast = sup.stand; zetSuper(k, 1); }
      else if (sup.vast !== null) { const s = sup.vast; sup.vast = null; zetSuper(k, s); }
    }, { label: `Superknop ${k} vol zolang je drukt`, read: () => (!sup.links.length ? null : sup.vast !== null ? 1 : 0), log: 'overslaan' });
    for (const kant of ['A', 'B']) {
      define(`super.${k}.vast${kant}`, 'trigger', (on) => {
        if (!on || !sup.links.length) return;
        const vv = vars();
        sup.links = legVast(sup.links, kant, (t) => read(resolveTarget(t, vv)));
      }, { label: `Superknop ${k}: leg de stand van nu vast als ${kant} (${kant === 'A' ? 'begin' : 'eind'} van de knop)`,
           alleenScherm: true, log: 'overslaan' });
    }
  }

  /** Een superknop (her)definiëren. null/undefined = leeg. Geeft de fouten. */
  const zetSuperknop = (k, def) => {
    const sup = supers[k];
    if (!sup) return [`superknop ${k} bestaat niet (1–${SUPERKNOPPEN})`];
    if (!def) { Object.assign(sup, { naam: null, links: [], grijs: new Set(), gemeld: new Set(), vast: null }); return []; }
    const { superknop, fouten } = normaliseerSuper(def);
    Object.assign(sup, { naam: superknop.naam, links: superknop.links, grijs: new Set(), gemeld: new Set(), vast: null });
    // Meteen kijken welke links grijs zijn (één melding per doel).
    const vv = vars();
    for (const l of sup.links) geldig(k, sup, resolveTarget(l.target, vv));
    if (fouten.length) meld(`superknop ${k}: ${fouten.join('; ')}`, 'fout');
    return fouten;
  };

  // ---- bus-racks ---------------------------------------------------------------
  // Een bus is helemaal nat (mix 1): een gewoon insert-rack geeft in zijn beginstand het droge
  // signaal door, en dan werkt de send als volumeknop. Daarom alleen de eigen echo en galm, en
  // racks die zeggen dat ze voor een bus zijn ("bus": true in racks/sjablonen.json): dat kiest Clay.
  const lijstVoor = (bus) => [SEND_RACKS[bus], SEND_RACKS[bus === 'A' ? 'B' : 'A'], ...racks().filter((r) => r?.bus === true)]
    .filter((r) => r && typeof r.name === 'string');
  /** Een rack op de bus op naam (een sjabloon, of de eigen echo/galm). Via zetRack: kruisfade, nooit herbedraden. */
  const zetBusRack = (bus, naam) => {
    const B = String(bus).toUpperCase();
    const slot = engine.sends?.[B];
    if (!slot) return false;
    const r = lijstVoor(B).find((x) => x.name === naam);
    if (!r) return false;
    if (slot.rackNaam === r.name) return true;
    const { fouten } = slot.zetRack(r);
    if (fouten?.length) meld(`${B === 'A' ? 'echo' : 'galm'}-bus: ${fouten.join('; ')}`, 'fout');
    onthoudBus(B, r.name);
    return true;
  };
  const busRackStap = (bus, stap) => {
    const lijst = lijstVoor(bus);
    const slot = engine.sends?.[bus];
    if (!slot || !lijst.length) return;
    const i = lijst.findIndex((r) => r.name === slot.rackNaam);
    const j = i < 0 ? (stap > 0 ? 0 : lijst.length - 1) : (i + stap + lijst.length) % lijst.length;
    zetBusRack(bus, lijst[j].name);
  };
  for (const bus of ['A', 'B']) {
    const b = bus.toLowerCase();
    const wat = bus === 'A' ? 'echo' : 'galm';
    // Zoals track.N.rack.next: niet teruggespeeld (relatief; een ander begin geeft een ander rack).
    define(`send.${b}.rack.next`, 'trigger', (on) => { if (on) busRackStap(bus, 1); }, { label: `Send ${bus} (${wat}): volgend rack`, log: 'overslaan' });
    define(`send.${b}.rack.prev`, 'trigger', (on) => { if (on) busRackStap(bus, -1); }, { label: `Send ${bus} (${wat}): vorig rack`, log: 'overslaan' });
  }

  return {
    supers,
    zetSuperknop,
    /** De superknoppen van een werkruimte (S3): de lijst op 1, 2, … ; de rest leeg. */
    zetSuperknoppen(lijst = []) {
      const fouten = [];
      for (let k = 1; k <= SUPERKNOPPEN; k++) fouten.push(...zetSuperknop(k, lijst[k - 1] ?? null));
      return fouten;
    },
    /** Hoe een superknop er nu uitziet: naam, stand, links (als data) met `grijs`. */
    superStatus(k) {
      const sup = supers[k];
      if (!sup) return null;
      const vv = vars();
      return { naam: sup.naam, stand: sup.stand,
        links: sup.links.map((l) => ({ ...linkNaarJSON(l), grijs: sup.grijs.has(resolveTarget(l.target, vv)) })) };
    },
    zetBusRack,
    busRackStap,
    busRacks: (bus) => lijstVoor(String(bus).toUpperCase()).map((r) => r.name),
  };
}

/**
 * Een stuk (`mappings/stukken/<naam>.json`, ontwerp B4) op een Mapping zetten:
 * eerst de nieuwe mapjes (voegMapjeToe, alleen voor dit apparaat), dan de
 * regels als fragment `stuk:<naam>` (een eigen regel wint altijd). Geeft
 * { mapjes, aantal, fouten }. `herbind` = herbindLagen uit actions.js.
 * S3 (de werkruimte) zet stukken per werkruimte; dit is dezelfde stap voor één stuk.
 */
export function zetStuk(doc, { mapping, voegMapjeToe, herbind = () => {} }) {
  if (!doc || typeof doc.stuk !== 'string') throw new Error('stuk: "stuk" (de naam) ontbreekt');
  const apparaat = mapping.device;
  const mapjes = [];
  const fouten = [];
  for (const [sleutel, m] of Object.entries(doc.mapjes?.nieuw ?? {})) {
    const [dev, groep, laag] = sleutel.split('.');
    if (dev !== apparaat) continue;
    try {
      voegMapjeToe(groep, laag, { naam: m?.naam, kleur: m?.kleur, kiesknop: m?.kiesknop === null ? null : laag });
      mapjes.push(`${groep}.${laag}`);
    } catch (err) { fouten.push(err.message); }
  }
  if (mapjes.length) herbind();
  const regels = doc.regels?.[apparaat] ?? [];
  const r = mapping.vervangFragment(`stuk:${doc.stuk}`, { version: 3, rules: regels });
  return { mapjes, aantal: r.aantal, fouten: [...fouten, ...r.fouten] };
}

/** Variabelen van buiten zetten (mapping.js): {maatgever} = de track die de maat geeft. */
export function zetMaatgeverVariabele(engine) {
  // De maatgever die je hoort (zoals de MAAT-badge), niet de terugval van sync: zonder maatgever null.
  zetVariabele('maatgever', () => trackVanDeck(engine.maatgever?.()?.id) ?? null);
}
