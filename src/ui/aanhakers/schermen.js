// Aanhaker 'schermen' (spoor S7, docs/WERKRUIMTE.md C4 en D4 "S7", docs/werkruimte/S7.md).
// Alleen dit spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// Zet in de mixer op:
//   - window.varvePaneel: wat werk.html als VENSTER van de mixer leest (mac-2, zoals de beamer):
//     de bus (read/invoke/metaOf), labels, vars, badges, oplichten, de werkruimte, de kaart, de
//     invoer van de uitlijnweergave en de decks;
//   - de zender naar de server (src/ui/live-zender.js) voor de iPad: alleen als dit tabblad de
//     APC heeft (zoals statusVanMij in app.js) en alleen als er een kijker is;
//   - het werkvak (#werkvak): het vak van het deel (`schermen.hoofd.werkvak`), via het event
//     'werkruimte' van S3. Met `standaard` blijft het hidden;
//   - "open schermen" op de werk-balk: de vensters van de werkruimte op hun eigen scherm
//     (Window Management API), met een waarschuwing als het beamervenster daar ook staat.
import { resolveTarget } from '../../control/mapping.js';
import { bijInvoke } from '../../control/actions.js';
import { beschrijf } from '../apc-beschrijf.js';
import { opslagVan } from '../mapping-opslag.js';
import { apc40mk2 } from '../../control/devices/apc40mk2.js';
import { tabblad } from '../tabblad.js';
import { hubAdres } from '../vlag.js';
import { voegKnopToe } from '../werk-balk.js';
import { aangemeld } from '../renderloop.js';
import { knobVan } from '../controls.js';
import { uitgangsVertraging, hoorbaar } from '../../engine/hoorbaar.js';

/**
 * src/paneel/ en de zender laden pas als er een werkruimte is (niet `standaard`): zonder
 * werkruimte doet de mixer bit voor bit wat hij deed, en laadt hij niets van src/paneel/
 * (test/regels-werk.test.mjs). Eén keer; daarna blijven ze (een terugkeer naar `standaard`
 * stopt de zender, de modules blijven in het geheugen).
 */
let P = null;
let laden = null;
export function laadPaneel() {
  laden ??= Promise.all([
    import('../../paneel/protocol.js'), import('../../paneel/vrij.js'), import('../../paneel/kaart.js'), import('../live-zender.js'),
    import('../../paneel/uitvoer.js'),
  ]).then(([protocol, vrij, kaart, zender, uitvoer]) => { P = { ...protocol, ...vrij, ...kaart, ...zender, ...uitvoer }; return P; });
  return laden;
}

/** De variabelen die een paneel kan gebruiken (WERKRUIMTE.md B5). */
export const VARS = ['focus', 'speel', 'tweede', 'maatgever', 'L', 'R', 'plek'];
/** Kort op een badge. */
const KORT = { apc40mk2: 'APC', 'maschine-mk2': 'Maschine', xboard49: 'Xboard', toetsen: 'toets' };
/** Waar een venster zijn scherm onthoudt (werk.html schrijft, de mixer leest). */
export const PLEK = 'varve.scherm.';

/** De variabelen van een Mapping (een functie, of een object in een test). */
const varsVan = (m) => (typeof m?.vars === 'function' ? m.vars() : (m?.vars ?? {}));

const opslag = {
  lees(k) { try { return JSON.parse(globalThis.localStorage?.getItem(k) ?? 'null'); } catch (_) { return null; } },
};

export default async function opzet(ctx) {
  if (!ctx?.engine || !ctx?.mapping || typeof document === 'undefined') return;
  // vensters.js raakt bij het laden het document (via de golfvorm): pas hier, na de controle.
  const { bind, ontbind } = await import('../vensters.js');
  const { engine, mapping, read, invoke, metaOf, meld } = ctx;
  const nu = () => performance.now();

  // ---- de apparaten (badges, kaart) ----------------------------------------------------------
  const apparaten = () => {
    const uit = [{ id: 'apc40mk2', naam: 'APC40', mapping, device: apc40mk2 }];
    for (const id of ['maschine-mk2', 'xboard49', 'toetsen']) {
      const o = opslagVan(id);
      if (o?.mapping && o.mapping !== mapping) uit.push({ id, naam: KORT[id], mapping: o.mapping, device: o.learn?.device ?? null });
    }
    return uit;
  };

  // Eén keer per beeld rekenen, hoe vaak het ook gevraagd wordt (vrij.js vraagt per item).
  const perBeeld = (fn) => {
    let t = -1, w;
    return () => { const n = nu(); if (n - t > 8) { t = n; w = fn(); } return w; };
  };

  // ---- vars ({focus} enz.) -------------------------------------------------------------------
  const varsNu = perBeeld(() => {
    const v = {};
    for (const k of VARS) { const x = resolveTarget(`{${k}}`, varsVan(mapping)); if (!x.includes('{')) v[k] = x; }
    return { v, s: JSON.stringify(v) };
  });

  // ---- badges: welke control in de open mapjes wijst naar een action ----------------------------
  let badgeVersie = 0, badgeIndex = new Map();
  const badgeSleutels = [];
  const badgesNu = perBeeld(() => {
    const lijst = apparaten();
    const vs = varsNu().s;
    let anders = badgeSleutels.length !== lijst.length + 1 || badgeSleutels[0] !== vs;
    const maps = lijst.map((a) => a.mapping.actieveRegels({ shift: false }));   // shift wisselt bij elke druk: niet elke keer opnieuw
    if (!anders) for (let i = 0; i < maps.length; i++) if (badgeSleutels[i + 1] !== maps[i]) { anders = true; break; }
    if (!anders) return badgeVersie;
    badgeSleutels.length = 0; badgeSleutels.push(vs, ...maps);
    const index = new Map();
    lijst.forEach((a, i) => {
      const vars = varsVan(a.mapping);
      for (const [sig, r] of maps[i]) {
        const id = resolveTarget(r.action, vars);
        const naam = `${KORT[a.id] ?? a.id} ${a.device?.label?.(sig) ?? sig}`;
        const l = index.get(id);
        if (l) { if (l.length < 3) l.push(naam); } else index.set(id, [naam]);
      }
    });
    badgeIndex = index;
    return ++badgeVersie;
  });

  // ---- oplichten: wanneer liep een action het laatst (de APC, de Maschine, een klik) ------------
  const geraakt = new Map();
  let zender = null;
  bijInvoke((id) => {
    // Alleen opschrijven (geen schermwerk in het MIDI-bericht): het paneel kijkt in zijn volgende beeld.
    if (!nodig().has(id)) return;
    geraakt.set(id, nu());
    zender?.geraakt(id);
  });

  // ---- de werkruimte -------------------------------------------------------------------------
  const werk = () => ctx.werk ?? globalThis.werk ?? null;
  const nodigCache = { s: null, set: new Set() };
  /** De actions die de panelen van de werkruimte lezen (ingevuld met de vars van nu). */
  function nodig() {
    const w = werk();
    const s = `${w?.naam}:${w?.deel}:${w?.versie}:${varsNu().s}:${P ? 1 : 0}`;
    if (s === nodigCache.s) return nodigCache.set;
    const set = new Set();
    const vars = varsNu().v;
    const neem = (p, doel) => { const v = P.varsVoor(vars, doel); for (const a of P.actionsVan(p)) { const id = P.vul(a, v); if (id && metaOf(id)) set.add(id); } };
    if (P) {
      for (const p of Object.values(panelenNu())) neem(p, p.doel);
      // De bouwstenen op een scherm in het deel van NU (fx, strip:3 …): niet die van alle delen, anders
      // wordt de stand te groot en leest elke tik honderden actions. Een deelwissel = een nieuwe set.
      const namen = new Set();
      for (const sch of Object.values(w?.deelDef?.()?.schermen ?? {})) for (const n of [...(sch.vakken ?? []), sch.werkvak]) if (n) namen.add(n);
      for (const n of namen) { const b = P.bouwsteenDef(n, { bestaat: (a) => !!metaOf(a), vars }); if (b) neem(b); }
    }
    nodigCache.s = s; nodigCache.set = set;
    return set;
  }

  /**
   * S8: de actions die scherm `s` mag bedienen = wat in de panelen en bouwstenen staat die de
   * werkruimte in het deel van NU op dat scherm zet, ingevuld met de vars van nu. Alleen op een
   * invoke van de iPad/iPhone gevraagd (niet per beeld); een cache op werkruimte, deel, versie en vars.
   */
  const toeCache = new Map();
  function toegestaan(scherm) {
    const w = werk();
    const s = `${w?.naam}:${w?.deel}:${w?.versie}:${varsNu().s}`;
    const c = toeCache.get(scherm);
    if (c?.s === s) return c.set;
    const set = new Set();
    if (P && w && w.naam !== 'standaard') {
      const vars = varsNu().v;
      const panelen = panelenNu();
      const neem = (p, doel) => { const v = P.varsVoor(vars, doel); for (const a of P.actionsVan(p)) { const id = P.vul(a, v); if (id) set.add(id); } };
      for (const naam of P.vakkenVan(w.deelDef?.() ?? null, scherm)) {
        const { soort, id } = P.vakSoort(naam);
        if (soort === 'paneel' && panelen[id]) neem(panelen[id], panelen[id].doel);
        else if (soort === 'bouwsteen') { const b = P.bouwsteenDef(id, { bestaat: (a) => !!metaOf(a), vars }); if (b) neem(b); }
      }
    }
    if (toeCache.size > 16) toeCache.clear();
    toeCache.set(scherm, { s, set });
    return set;
  }

  const kaartNu = perBeeld(() => (P ? P.kaartVan(apparaten(), beschrijf) : null));
  let kaartCache = null, kaartSleutel = null;
  const kaart = () => {
    const s = `${badgesNu()}:${P ? 1 : 0}`;   // de badges veranderen precies als regels, mapjes of vars veranderen
    if (s !== kaartSleutel) { kaartSleutel = s; kaartCache = kaartNu(); }
    return kaartCache;
  };

  /** De panelen van de werkruimte, met de extra velden van de xy-pad uit het ruwe bestand (vrij.js metRuw). */
  function panelenNu() {
    const w = werk();
    const uit = {};
    for (const [n, p] of Object.entries(w?.def?.panelen ?? {})) uit[n] = P ? P.metRuw(p, w?.ruw?.panelen?.[n]) : p;
    return uit;
  }

  function werkInfo() {
    const w = werk();
    if (!w) return null;
    const d = w.deelDef?.() ?? null;
    return { naam: w.naam, titel: w.def?.titel ?? null, deel: w.deel ?? null, versie: w.versie ?? null,
      delen: (w.delen?.() ?? []).map((x) => ({ naam: x.naam, label: x.label, kleur: x.kleur })),
      kleur: d?.kleur ?? null, label: d?.label ?? null,
      panelen: panelenNu(), schermen: d?.schermen ?? {}, schermDefs: w.def?.schermen ?? {} };
  }

  const labelVan = (id) => beschrijf(id)?.kort ?? null;
  /** De naam die het rack nu op een plek zet (track.N.fx.knob.K, master.fx.knob.K), of null. */
  const naamVan = (id) => {
    let m = /^track\.(\d)\.fx\.knob\.(\d)$/.exec(id);
    if (m) { const d = engine.decks?.[Object.keys(engine.decks)[m[1] - 1]]; return d?.fx?.plekNaam?.(+m[2]) ?? null; }
    m = /^master\.fx\.knob\.(\d)$/.exec(id);
    if (m) return engine.master?.fx?.plekNaam?.(+m[1]) ?? null;
    return null;
  };
  /** Verandert als een rack wisselt (de namen van de plekken): per beeld één keer gerekend. */
  const rackSleutel = (fx) => (fx?.rack ? `${fx.rackNaam}:${fx.rack.macros?.map((m) => m.label ?? '').join(',') ?? ''}` : '');
  const labelSleutelNu = perBeeld(() => `${Object.values(engine.decks ?? {}).map((d) => rackSleutel(d?.fx)).join('|')}#${rackSleutel(engine.master?.fx)}`);

  // ---- de decks ------------------------------------------------------------------------------
  const deckInfo = new Map();   // id -> { sleutel, info }
  const sectieIds = new WeakMap(); let sectieTeller = 0;
  const sectieId = (k) => (k ? (sectieIds.get(k) ?? (sectieIds.set(k, ++sectieTeller), sectieTeller)) : 0);
  function decksVoorZender() {
    const uit = {};
    Object.keys(engine.decks || {}).forEach((id, i) => {
      const d = engine.decks[id];
      if (!d?.buffer) return;
      const bpm = d.bpm ? Math.round(d.bpm * 100) / 100 : null;
      const sleutel = `${d.title}|${d.gridVersie}|${Math.round(d.duration * 1000)}|${bpm}|${sectieId(d.sectieKaart)}`;
      let c = deckInfo.get(id);
      if (!c || c.sleutel !== sleutel) {
        c = { sleutel, info: { nr: i + 1, titel: d.title, duur: d.duration, bpm, grid: d.grid?.toJSON?.() ?? null,
          secties: d.sectieKaart?.stukken?.slice(0, 64).map((s) => ({ van: s.van, label: s.label })) ?? null } };
        deckInfo.set(id, c);
      }
      uit[id] = { sleutel, info: c.info, tl: d.tijdlijn?.() ?? null };
    });
    return uit;
  }
  const maatgever = () => engine.syncMaster?.()?.id ?? null;
  function decksNu() {
    const V = uitgangsVertraging(engine.ctx);
    const decks = [];
    Object.keys(engine.decks || {}).forEach((id, i) => {
      const d = engine.decks[id];
      if (!d?.buffer) return;
      decks.push({ id, nr: i + 1, titel: d.title, bpm: d.bpm, duur: d.duration, positie: hoorbaar(d, V), speelt: !!d.playing, wacht: !!d.wacht,
        secties: d.sectieKaart?.stukken ?? null });
    });
    return { decks, maatgever: maatgever() };
  }

  let laadVraag = null;
  const open = new Map();   // scherm -> werk-venster (geopend met "open schermen", of aangemeld)

  // ---- window.varvePaneel: voor werk.html als venster van de mixer -----------------------------
  const paneelBron = {
    read, invoke, metaOf, label: labelVan, meld: (t) => meld?.(t, 'fout'),
    vars: () => varsNu().v, varsSleutel: () => varsNu().s,
    badges: (id) => { badgesNu(); return badgeIndex.get(id) ?? []; },
    badgeSleutel: () => badgesNu(),
    geraakt: (id) => geraakt.get(id) ?? 0,
    nu,
    naam: naamVan, labelSleutel: labelSleutelNu,
  };
  window.varvePaneel = {
    ...paneelBron,
    werk: werkInfo, kaart,
    /** Verandert als werkruimte, deel of versie verandert (werk.html bouwt dan opnieuw). */
    werkSleutel: () => { const w = werk(); return w ? `${w.naam}:${w.deel}:${w.versie}` : ''; },
    invoer: () => globalThis.varveUitlijn?.invoer?.() ?? null,
    decks: decksNu,
    hoorbaar: (id) => { const d = engine.decks?.[id]; return d ? hoorbaar(d, uitgangsVertraging(engine.ctx)) : null; },
    /**
     * Een werk-venster meldt zich (elke 2 s, paneel.js): zo weet "open schermen" ook na het
     * herladen van de mixer dat het er al is (anders laadde window.open met dezelfde naam het opnieuw).
     */
    meldAan: (s, venster) => { if (typeof s === 'string' && venster && !venster.closed) open.set(s, venster); },
    /**
     * Een nummer uit de library op track `nr` laden (alleen als VENSTER van de mixer: de iPad laadt
     * nooit, VAST_NOOIT `*.load*`). Speelt die track: eerst { vraag: true }, een tweede keer binnen 3 s
     * laadt (zoals de library zelf). Via laden.laadLibrary, dus in het handelingenlog.
     */
    laad: (nr, track) => {
      const id = Object.keys(engine.decks ?? {})[Number(nr) - 1];
      const lib = ctx.laden?.library;
      if (!id || !track?.id || !lib?.laadTrack) return { ok: false };
      // Dezelfde vraag als de library (laden.js `stand`): een track die speelt, OF een instrument dat
      // klinkt, vraagt een tweede druk; en laden gaat door het paneel van de library, zoals de kaart-tab.
      const sleutel = `${nr}:${track.id}`;
      if (lib.stand?.(id) === 'speelt' && !(laadVraag?.s === sleutel && nu() - laadVraag.t < 3000)) { laadVraag = { s: sleutel, t: nu() }; return { vraag: true }; }
      laadVraag = null;
      Promise.resolve(lib.laadTrack(track, id)).catch((e) => meld?.(`laden: ${e.message}`, 'fout'));
      return { ok: true };
    },
    /** De klok van dit venster en de audioklok, voor de proef (werk-ipad.mjs). */
    klok: () => ({ perf: performance.now(), ctx: engine.ctx?.currentTime ?? null }),
  };

  // ---- de zender (de iPad) -------------------------------------------------------------------
  const hub = !!hubAdres();
  let eersteT = -1, eersteW = false;
  const isEerste = () => {
    const n = nu();
    if (n - eersteT < 250) return eersteW;
    eersteT = n;
    if (!hub) eersteW = !!tabblad().eerste;
    else {
      const h = ctx.midi?.status?.().hub ?? {};
      eersteW = !!(h.verbonden || (!h.vervangen && tabblad().eerste));
    }
    return eersteW;
  };
  const TAB = globalThis.crypto?.randomUUID?.() ?? `tab-${Math.random().toString(36).slice(2, 12)}`;
  const zenderBron = {
    nodig, read, decks: decksVoorZender, maatgever, V: () => uitgangsVertraging(engine.ctx),
    werkBericht: () => {
      const w = werkInfo();
      const ids = [...nodig()];
      const labels = {}, badges = {};
      badgesNu();
      for (const id of ids) {
        const m = metaOf(id);
        labels[id] = { type: m?.type ?? null, label: m?.label ?? null, kort: labelVan(id), naam: naamVan(id) };
        const b = badgeIndex.get(id);
        if (b) badges[id] = b;
      }
      const k = kaart();
      const inhoud = w ? { ...w, vars: varsNu().v, labels, badges, kaart: k } : null;
      return { sleutel: `${w?.naam}:${w?.deel}:${w?.versie}:${varsNu().s}:${badgeVersie}:${k?.sleutel}:${labelSleutelNu()}`, w: inhoud };
    },
  };
  /** De zender alleen met een werkruimte: met `standaard` geen timer, geen fetch. */
  let ontvanger = null, uitvoerder = null;
  async function volgZender() {
    const w = werk();
    const aan = !!w && w.naam !== 'standaard';
    if (aan && !zender) {
      await laadPaneel();
      if (!zender && werk()?.naam !== 'standaard') {
        zender = P.startLiveZender({ bron: zenderBron, isEerste, tab: TAB, ctx: () => engine.ctx, meld: (t) => meld?.(t, 'fout') });
        // S8: de ontvanger van de iPad en de iPhone. Hij opent zijn kanaal pas als de schrijfweg aan
        // staat (de zender hoort het van de server) en alleen in het tabblad met de APC.
        uitvoerder ??= new P.Uitvoerder({ invoke, read, metaOf, werkruimte: () => { const x = werk(); return x ? { ...x.def, naam: x.naam } : null; }, toegestaan });
        const z = zender;
        ontvanger = P.startOntvanger({ uitvoerder, aan: () => !!z.schrijf, isEerste, tab: TAB });
      }
    } else if (!aan && zender) { ontvanger?.stop(); ontvanger = null; zender.stop(); zender = null; }
  }

  // ---- het werkvak ---------------------------------------------------------------------------
  const vakEl = document.getElementById('werkvak');
  let vak = null;   // { sleutel, stop }
  const mixerBron = { ...paneelBron };
  function toonWerkvak(naam, def) {
    const w = werk();
    const vaknaam = !naam || naam === 'standaard' || !P ? null : P.vakkenVan(def, 'hoofd')[0] ?? null;
    const { soort, id } = P ? P.vakSoort(vaknaam) : { soort: null, id: null };
    const pdef = soort === 'paneel' ? panelenNu()[id] ?? null
      : soort === 'bouwsteen' ? P.bouwsteenDef(id, { bestaat: (a) => !!metaOf(a), vars: varsNu().v }) : null;
    const sleutel = `${vaknaam}:${pdef ? JSON.stringify(pdef) : ''}`;
    if (vak?.sleutel === sleutel) return;
    vak?.stop();
    vak = null;
    if (!vakEl) return;
    vakEl.replaceChildren();
    if (!vaknaam) { vakEl.hidden = true; return; }
    let stop = null;
    if (soort === 'uitlijn') {
      const u = globalThis.varveUitlijn?.toonVak?.(vakEl, vaknaam);
      if (u) stop = () => u.stop();
    } else if ((soort === 'paneel' || soort === 'bouwsteen') && pdef) {
      const p = new P.VrijPaneel(vakEl, pdef, mixerBron, { modus: 'mixer', id, knobVan });
      bind(vakEl);
      const weg = ctx.renderloop.stap('werkvak-paneel', () => p.teken());
      stop = () => { weg(); ontbind(vakEl); p.vernietig(); };
    } else if (soort === 'kaart') {
      const k = new P.KaartWeergave(vakEl);
      const weg = ctx.renderloop.stap('werkvak-kaart', () => k.toon(kaart()));
      stop = () => { weg(); k.vernietig(); };
    }
    if (!stop) {
      vakEl.hidden = true;
      meld?.(`werkvak: "${vaknaam}" ken ik niet${soort === 'paneel' ? ` (geen paneel "${id}" in de werkruimte)` : ''}`, 'fout');
      return;
    }
    vakEl.classList.add('wv');
    vakEl.hidden = false;
    vak = { sleutel, stop };
  }
  // De pagina gaat weg (sluiten, herladen): de zender zegt de kijkers nog 'weg'.
  window.addEventListener('pagehide', () => { ontvanger?.stop(); ontvanger = null; zender?.stop(); zender = null; });
  window.addEventListener('pageshow', (e) => { if (e.persisted) volgZender(); });   // terug uit de bfcache

  const w0 = werk();
  /** Het werkvak en de zender zoals de werkruimte van NU ze wil (ook als het event al voorbij is). */
  const volg = (naam = werk()?.naam, def = werk()?.deelDef?.()) => {
    if (naam && naam !== 'standaard' && !P) laadPaneel().then(() => toonWerkvak(werk()?.naam, werk()?.deelDef?.()));
    else toonWerkvak(naam, def);
    volgZender();
  };
  w0?.on?.('werkruimte', ({ naam, def }) => volg(naam, def));
  // Een andere werkruimte (ook terug naar standaard): de zender volgt. 'change' komt ook bij een
  // deelwissel (uit een MIDI-bericht): alleen bij een andere NAAM iets doen.
  let naamNu = w0?.naam;
  w0?.on?.('change', (st) => { if (st?.naam !== naamNu) { naamNu = st?.naam; volgZender(); } });
  // De werkruimte kan al gekozen zijn vóór deze aanhaker (de aanhakers lopen na elkaar, werkStart
  // niet): nu meteen, en nog eens als het opstarten klaar is.
  volg();
  Promise.resolve(globalThis.werkStart).then(() => volg()).catch(() => {});

  // ---- schermen openen en plaatsen ----------------------------------------------------------
  async function schermDetails() {
    if (typeof window.getScreenDetails !== 'function') return null;
    try { return await window.getScreenDetails(); } catch (_) { return null; }
  }
  /** Een werk-venster op zijn onthouden scherm openen. Zonder toestemming: gewoon window.open. */
  async function openScherm(s, details) {
    const url = `werk.html?s=${encodeURIComponent(s)}`;
    const plek = opslag.lees(PLEK + s);
    let kenmerken = 'popup,width=1280,height=760';
    if (plek) {
      const scr = details?.screens?.find((x) => plek.label && x.label === plek.label) ?? null;
      const left = scr ? scr.availLeft + Math.max(0, (plek.x ?? 0) - (plek.left ?? 0)) : plek.x;
      const top = scr ? scr.availTop + Math.max(0, (plek.y ?? 0) - (plek.top ?? 0)) : plek.y;
      kenmerken = `popup,left=${Math.round(left ?? 0)},top=${Math.round(top ?? 0)},width=${Math.round(plek.wW ?? 1280)},height=${Math.round(plek.wH ?? 760)}`;
    }
    const bestaand = open.get(s);
    if (bestaand && !bestaand.closed) { bestaand.focus(); return bestaand; }
    const v = window.open(url, `varve-werk-${s}`, kenmerken);
    if (v) open.set(s, v);
    return v;
  }
  /** Staat een werk-venster op hetzelfde scherm als het beamervenster? (geeft de namen) */
  function opBeamerScherm() {
    const b = beamerVenster;
    if (!b || b.closed) return [];
    const zelfde = (x, y) => x?.availLeft === y?.availLeft && x?.availTop === y?.availTop && x?.width === y?.width;
    const uit = [];
    for (const [s, v] of open) { try { if (!v.closed && zelfde(v.screen, b.screen)) uit.push(s); } catch (_) {} }
    return uit;
  }
  // Het beamervenster meldt zich aan bij de mixer (video-paneel.js, window.varveBeamer.meldAan):
  // hier onthouden we welk venster dat is, alleen om zijn scherm te kunnen vergelijken.
  let beamerVenster = null;
  const vb = globalThis.varveBeamer;
  if (vb?.meldAan && !vb._s7) {
    const oud = vb.meldAan;
    vb.meldAan = (venster, ...rest) => { beamerVenster = venster; return oud(venster, ...rest); };
    vb._s7 = true;
  }
  async function openSchermen() {
    const w = werk();
    const namen = Object.entries(w?.def?.schermen ?? {}).filter(([, d]) => d.soort === 'venster').map(([n]) => n);
    if (!namen.length) { meld?.('deze werkruimte heeft geen venster-schermen (schermen: { "mac-2": { "soort": "venster" } })'); return; }
    const details = await schermDetails();
    for (const s of namen) await openScherm(s, details);
    setTimeout(() => {
      const zelfde = opBeamerScherm();
      if (zelfde.length) meld?.(`let op: ${zelfde.join(', ')} staat op hetzelfde scherm als het beamervenster`, 'fout');
    }, 1500);
  }
  const knop = document.createElement('button');
  knop.className = 'ghost werk-schermen';
  knop.textContent = 'open schermen';
  knop.title = 'de vensters van deze werkruimte (bv. mac-2) openen, elk op het scherm waar het de vorige keer stond';
  knop.addEventListener('click', () => { openSchermen().catch((e) => meld?.(`schermen: ${e.message}`, 'fout')); });
  voegKnopToe(knop);

  // Voor de headless proeven en de console.
  window.varveSchermen = {
    get zender() { return zender; }, get ontvanger() { return ontvanger; }, get uitvoerder() { return uitvoerder; },
    toegestaan: (s) => [...toegestaan(s)], tab: TAB, aangemeld, geladen: () => !!P, nodig: () => [...nodig()], werkvak: () => vak?.sleutel ?? null,
    openScherm: (s) => openScherm(s, null), opBeamerScherm, open,
  };
}
