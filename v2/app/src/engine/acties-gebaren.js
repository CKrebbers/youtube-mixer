/**
 * Gebaren: vasthouden = iets gebeurt, loslaten = terug zoals het was. Hoe hard je drukt, zo diep
 * (de Maschine-pads met aanslag en druk, control/indeling.js gedrag 'druk'). Welke er zijn en welke
 * op de pads liggen: kern/opstelling/gebaren.js.
 *
 *   gebaar.<naam>          waarde 0..1   het gebaar zelf (ook voor de APC, leren en het toetsenbord)
 *   gebaar.pad.{1..16}     waarde 0..1   pad k van de padstand gebaren: 1–8 vast, 9–16 die van het recept
 *   korrel.veld.{1..16}    waarde 0..1   de granular sampler (padstand korrels): de eerste druk bevriest wat de
 *                                        track met focus net speelde; pad k = plek k in dat stuk (1 = net, 16 ≈ 3 s
 *                                        terug), druk = hoe vol; loslaten van de laatste pad = terug
 *   korrel.vang            trigger       de korrelwolk (instrument) vangt de laatste VANG_TELLEN tellen van wat er
 *                                        speelt (de track met focus, anders het eerste nummer dat je hoort; met stems
 *                                        wat je HOORT) en wordt daarmee op toonhoogte speelbaar
 *   gebaar.optel           trigger       loslaten op de tel aan/uit (standaard aan): wat je loslaat,
 *                                        gaat pas op de volgende tel terug, zodat de terugkeer strak valt
 *   speel.drum.{1..16}     waarde        pad k speelt drumnoot 35+k op het drumspoor, met aanslag; 0 = los
 *   speel.noot.{1..16}     waarde        pad k speelt trap k−1 van de toonladder van de opstelling
 *
 * COMBINEREN: elke parameter heeft een STAPEL. Het eerste gebaar dat hem raakt legt vast wat er
 * stond; elk gebaar is een laag (doel, kromme, diepte), in de volgorde waarin je ze indrukte; pas als
 * de laatste laag weg is, gaat hij precies terug. Twee pads tegelijk = één gecombineerd gebaar
 * (dof + galm = onder water), en dof + dun op hetzelfde filter laat nooit iets hangen.
 * RACK-GEBAREN (opbouw, band, wegspoelen, oplossen, bevries) laden een rack uit racks/sjablonen.json op
 * de track en zetten bij het loslaten het rack van daarvoor terug (wisselen kruisfadet, BOUWREGELS).
 * Alles via de bus (bron 'gebaar'); noten NIET over het log (engine.noot; v1: anders loopt het log vol).
 */
import { kromme } from '../kern/opstelling/model.js';
import { LADDERS } from '../kern/opstelling/patroon.js';
import { GEBAREN, padGebaren } from '../kern/opstelling/gebaren.js';
import { knipBereik, knipPcm } from './sampler.js';

/** Zoveel tellen vangt de korrelwolk (korrel.vang); zonder zeker grid zoveel seconden. */
export const VANG_TELLEN = 4;
export const VANG_ZONDER_GRID_S = 2;
const TOONKLASSE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** De grondnoot van een gevangen stuk uit de toonsoort van zijn nummer ('Am', 'F#', 'Bb'), dicht bij C4; anders C4. */
export function grondVan(toon) {
  const m = /^\s*([A-Ga-g])\s*(#|♯|b|♭)?/.exec(String(toon ?? ''));
  if (!m) return 60;
  const k = (TOONKLASSE[m[1].toLowerCase()] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0) + 12) % 12;
  return 60 + (k > 6 ? k - 12 : k);
}

/**
 * Bevriezen heeft een verleden nodig: staat de Korrelwolk al op de track (zijn ring loopt mee), dan
 * meteen; laadt het gebaar hem net, dan eerst zo lang vangen (de ring van een nieuw rack is leeg).
 */
export const VANG_S = 1.5;
/** Stotteren: hoe dieper je drukt, hoe korter de lus (tellen). */
export const STOTTER = Object.freeze([0.5, 0.25, 0.125]);
/** Zoveel seconden vóór de tel gaat een loslaten al (de tik loopt elke 50 ms). */
export const VOOR_DE_TEL = 0.03;
const META = { beginstand: false };
const NOOT_META = { log: 'overslaan', beginstand: false };

/** Welke racks een rack-gebaar laadt, en wat de druk met hun knoppen doet. */
const RACKS = {
  opbouw: { rack: 'Opbouw', alles: true, knoppen: (v) => ({ 1: v, 2: v * 0.6 }) },
  band: { rack: 'Band zakt weg', knoppen: (v) => ({ 1: v }) },
  'alles.band': { rack: 'Band zakt weg', alles: true, knoppen: (v) => ({ 1: v }) },
  wegspoelen: { rack: 'Wegspoelen', knoppen: (v) => ({ 1: v }) },
  oplossen: { rack: 'Oplossen', knoppen: (v) => ({ 1: v, 6: v }) },
  bevries: { rack: 'Ruimte bevriezen', knoppen: (v) => ({ 1: 1, 3: v > 0.6 ? 1 : 0 }) },
  // De korrelwolk (fx-korrel.js): knop 1 uiteen, 2 grootte, 3 spray, 4 terug, 5 toon, 6 achteruit, 7 breedte, 8 bevries.
  korrel: { rack: 'Korrelwolk', knoppen: (v) => ({ 1: Math.min(1, 0.35 + v * 0.65), 3: 0.15 + v * 0.6, 5: v > 0.75 ? (v - 0.75) * 2 : 0 }) },
  'alles.korrel': { rack: 'Korrelwolk', alles: true, knoppen: (v) => ({ 1: Math.min(1, 0.35 + v * 0.65), 3: 0.15 + v * 0.6 }) },
  korrelvast: { rack: 'Korrelwolk', vries: true, knoppen: (v) => ({ 1: 1, 3: 0.1 + v * 0.8, 2: 0.6 }) },
  achteruit: { rack: 'Korrelwolk', knoppen: (v) => ({ 1: Math.min(1, 0.5 + v * 0.5), 2: 0.85, 3: 0.02, 4: 0.35, 6: 1, 7: 0.3 }) },
};

/** Plek k van het korrelveld: zoveel seconden terug (de ring van korrel-kern.js is 4 s). */
export const veldSeconden = (k) => 0.1 + ((k - 1) / 15) * 2.8;
/** De knop "terug" van het rack Korrelwolk (fx-korrel.js terugKorrel = 0,03 · 100^t) voor zoveel seconden. */
export const terugKnop = (s) => Math.min(1, Math.max(0, Math.log(s / 0.03) / Math.log(100)));

export function definieerGebaren(engine) {
  const bus = engine.bus;
  const T = (n) => engine.track(n);
  const draagt = (n) => !!(T(n)?.nummer || T(n)?.instrument);
  const metIets = () => engine.tracks.filter((t) => draagt(t.n)).map((t) => t.n);
  const zet = (id, v) => { try { if (bus.lees(id) === null) return; bus.doe(id, v, { bron: 'gebaar' }); } catch { /* er is niets */ } };
  const lees = (id) => { try { return bus.lees(id); } catch { return null; } };
  let optel = true;
  let volg = 0;
  // Het korrelveld: één rack-gebaar, de plek volgt de laatst ingedrukte pad.
  let veldKnop = terugKnop(veldSeconden(1));
  const veldVast = new Set();
  const rackVan = (naam) => (naam === 'korrelveld'
    ? { rack: 'Korrelwolk', vries: true, knoppen: (v) => ({ 1: Math.min(1, 0.45 + v * 0.55), 4: veldKnop, 3: 0.03, 2: 0.55, 7: 0.5 }) }
    : RACKS[naam]);

  // ---- de stapel per parameter --------------------------------------------------------
  const stapels = new Map();   // actie -> { basis, lagen: Map(gebaar -> { naar, kromme, v, volg, wachtTel }) }
  const pasToe = (actie) => {
    const s = stapels.get(actie);
    if (!s) return;
    if (!s.lagen.size) { zet(actie, s.basis); stapels.delete(actie); return; }
    let x = s.basis;
    for (const l of [...s.lagen.values()].sort((a, b) => a.volg - b.volg)) if (!l.wachtTel) x += (l.naar - x) * kromme(l.kromme, l.v);
    zet(actie, x);
  };

  /** Wat een gebaar raakt, op het moment dat je drukt: [[actie, naar, kromme, opTel?]] of een rack, stotter, beeld. */
  function doelenVan(naam) {
    const f = engine.focus;
    const allen = metIets();
    const op = (lijst, actie, naar, k = 'lin', opTel = false) => lijst.map((n) => [`track.${n}.${actie}`, naar, k, opTel]);
    switch (naam) {
      case 'echo': return op([f], 'send.a', 0.85, 'log');
      case 'galm': return op([f], 'send.b', 0.9, 'log');
      case 'dof': return op([f], 'filter', 0.06, 's');
      case 'dun': return op([f], 'filter', 0.94, 's');
      case 'bas': return op([f], 'laag', 0, 'lin');
      case 'weg': return op([f], 'fader', 0, 'log');
      case 'fx': return op([f], 'fx.mix', 1, 'lin');
      case 'alles.dof': return op(allen, 'filter', 0.06, 's');
      case 'alles.dun': return op(allen, 'filter', 0.94, 's');
      case 'alles.galm': return op(allen, 'send.b', 0.9, 'log');
      case 'alles.echo': return op(allen, 'send.a', 0.85, 'log');
      case 'alles.bas': return op(allen, 'laag', 0, 'lin');
      case 'breuk': return op(allen.filter((n) => n !== f), 'fader', 0, 'log');
      case 'stilte': return op(allen, 'fader', 0, 'log');
      // Vast: de worp gaat er meteen in, het droge geluid valt op de volgende tel weg (sends zitten ná de fader:
      // wat er dan in de echo of galm zit, blijft hangen).
      case 'echovast': return [[`track.${f}.send.a`, 1, 'log'], ['send.a.knop.2', 0.97, 'log'], [`track.${f}.fader`, 0, 'log', true]];
      case 'galmvast': return [[`track.${f}.send.b`, 1, 'log'], ['send.b.knop.3', 1, 'lin', true], [`track.${f}.fader`, 0, 'log', true]];
      default: return null;
    }
  }

  // ---- de gebaren ------------------------------------------------------------------------
  const actief = new Map();    // naam -> { v, soort, ..., losOp }

  function start(naam, v) {
    const g = { v, volg: ++volg, losOp: null };
    if (rackVan(naam)) {
      const r = rackVan(naam);
      if (!(engine.fx?.sjablonen() ?? []).some((x) => x.name === r.rack)) return null;
      const sporen = (r.alles ? metIets() : [engine.focus]).filter((n) => ![...actief.values()].some((x) => x.rack && x.sporen.some((s) => s.n === n)));
      g.rack = r;
      g.sporen = sporen.map((n) => ({
        n, naam: engine.fx.rackNaam(n), mix: lees(`track.${n}.fx.mix`), aan: lees(`track.${n}.fx.aan`),
        knoppen: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((k) => [k, lees(`track.${n}.fx.knop.${k}`)])),
      }));
      g.t0 = engine.nu();
      for (const s of g.sporen) {
        // Staat dit rack er al, dan niet opnieuw laden: dan houdt hij zijn verleden (de korrelwolk zijn ring).
        s.alGeladen = s.naam === r.rack;
        if (!s.alGeladen) engine.fx.kiesRack(s.n, r.rack);
        if (lees(`track.${s.n}.fx.aan`) === 0) { bus.doe(`track.${s.n}.fx.aan`, true, { bron: 'gebaar' }); bus.doe(`track.${s.n}.fx.aan`, false, { bron: 'gebaar' }); }
        zet(`track.${s.n}.fx.mix`, 1);
      }
    } else if (naam === 'stotter') {
      const t = T(engine.focus);
      if (!t?.geladen) return null;
      g.stotter = { n: t.n, lengte: t.lusLengte, lus: !!t.lus };
    } else if (naam === 'flits' || naam === 'zwart') {
      g.beeld = naam === 'flits' ? 'video.flash' : 'video.black.hold';
      try { bus.doe(g.beeld, true, { bron: 'gebaar' }); if (naam === 'flits') bus.doe(g.beeld, false, { bron: 'gebaar' }); } catch { /* geen beeld */ }
    } else {
      const doelen = doelenVan(naam);
      if (!doelen) return null;
      g.doelen = [];
      for (const [actie, naar, k, opTel] of doelen) {
        const b = lees(actie);
        if (typeof b !== 'number') continue;
        if (!stapels.has(actie)) stapels.set(actie, { basis: b, lagen: new Map() });
        stapels.get(actie).lagen.set(naam, { naar, kromme: k, v, volg: g.volg, wachtTel: opTel && engine.klok?.loopt ? volgendeTel() : null });
        g.doelen.push(actie);
      }
    }
    actief.set(naam, g);
    return g;
  }

  function werk(naam, g, v) {
    g.v = v;
    if (g.rack) {
      for (const s of g.sporen) {
        for (const [k, x] of Object.entries(g.rack.knoppen(v))) zet(`track.${s.n}.fx.knop.${k}`, x);
        // Bevriezen (knop 8 van de Korrelwolk): meteen als hij al meeliep, anders na VANG_S vangen.
        if (g.rack.vries) zet(`track.${s.n}.fx.knop.8`, s.alGeladen || engine.nu() - g.t0 >= VANG_S ? 1 : 0);
      }
    }
    else if (g.stotter) {
      const t = T(g.stotter.n);
      const l = STOTTER[Math.min(STOTTER.length - 1, Math.floor(v * STOTTER.length))];
      if (t.lusLengte !== l || !t.lus) { if (t.lus) t.lusUit(); t.lusLengte = l; t.lusAan(); engine.emit('track', t.n); }
    } else if (g.doelen) for (const actie of g.doelen) { const l = stapels.get(actie)?.lagen.get(naam); if (l) { l.v = v; pasToe(actie); } }
  }

  function stop(naam) {
    const g = actief.get(naam);
    if (!g) return;
    actief.delete(naam);
    if (g.rack) {
      const bekend = new Set((engine.fx?.sjablonen() ?? []).map((x) => x.name));
      for (const s of g.sporen) {
        if (s.naam && bekend.has(s.naam)) engine.fx.kiesRack(s.n, s.naam);
        for (const [k, x] of Object.entries(s.knoppen)) if (typeof x === 'number') zet(`track.${s.n}.fx.knop.${k}`, x);
        if (typeof s.mix === 'number') zet(`track.${s.n}.fx.mix`, s.mix);
        if (s.aan === 0 && lees(`track.${s.n}.fx.aan`) === 1) { bus.doe(`track.${s.n}.fx.aan`, true, { bron: 'gebaar' }); bus.doe(`track.${s.n}.fx.aan`, false, { bron: 'gebaar' }); }
      }
    } else if (g.stotter) {
      const t = T(g.stotter.n);
      if (t) { if (t.lus) t.lusUit(); t.lusLengte = g.stotter.lengte; if (g.stotter.lus) t.lusAan(); engine.emit('track', t.n); }
    } else if (g.beeld === 'video.black.hold') {
      try { bus.doe(g.beeld, false, { bron: 'gebaar' }); } catch { /* geen beeld */ }
    } else if (g.doelen) for (const actie of g.doelen) { stapels.get(actie)?.lagen.delete(naam); pasToe(actie); }
  }

  const volgendeTel = () => { const k = engine.klok; const t = engine.nu(); return k.tijd(Math.floor(k.tel(t) + 1e-9) + 1); };

  /** Het gebaar `naam` op diepte v (0 = los: meteen, of op de volgende tel). */
  function gebaar(naam, v) {
    let g = actief.get(naam);
    if (v > 0) {
      if (!g) g = start(naam, v);
      if (!g) return { geweigerd: `${GEBAREN[naam]?.kort ?? naam}: kan hier niet` };
      g.losOp = null;
      werk(naam, g, v);
      return undefined;
    }
    if (!g) return undefined;
    if (optel && engine.klok?.loopt && !g.beeld) g.losOp = volgendeTel();
    else stop(naam);
    return undefined;
  }

  for (const naam of Object.keys(GEBAREN)) {
    bus.defineer({ id: `gebaar.${naam}`, soort: 'waarde', label: `gebaar: ${GEBAREN[naam].uitleg}`, meta: META,
      doe: (v) => gebaar(naam, v), lees: () => actief.get(naam)?.v ?? 0 });
  }
  // De pads: pad k = het gebaar van nu op plek k; wat je indrukte laat je ook los (ook als het recept intussen wisselde).
  const opPad = new Map();
  const padNamen = () => padGebaren(engine.opstelling?.huidige?.()?.gebaren ?? null);
  for (let k = 1; k <= 16; k++) {
    bus.defineer({ id: `gebaar.pad.${k}`, soort: 'waarde', label: `gebaar op pad ${k}`, meta: META,
      doe: (v) => {
        const naam = v > 0 ? (opPad.get(k) ?? padNamen()[k - 1]) : opPad.get(k);
        if (!naam) return undefined;
        if (v > 0) opPad.set(k, naam); else opPad.delete(k);
        return gebaar(naam, v);
      },
      lees: () => actief.get(opPad.get(k) ?? padNamen()[k - 1])?.v ?? 0 });
  }
  for (let k = 1; k <= 16; k++) {
    bus.defineer({ id: `korrel.veld.${k}`, soort: 'waarde', label: `korrelveld: plek ${k} (${veldSeconden(k).toFixed(1)} s terug)`, meta: META,
      doe: (v) => {
        if (v > 0) { veldVast.add(k); veldKnop = terugKnop(veldSeconden(k)); return gebaar('korrelveld', v); }
        veldVast.delete(k);
        if (veldVast.size) { veldKnop = terugKnop(veldSeconden([...veldVast].at(-1))); const g = actief.get('korrelveld'); if (g) werk('korrelveld', g, g.v); return undefined; }
        return gebaar('korrelveld', 0);
      },
      lees: () => (actief.has('korrelveld') ? (veldVast.has(k) ? actief.get('korrelveld').v : 0) : 0) });
  }
  bus.defineer({ id: 'gebaar.optel', soort: 'trigger', label: 'gebaren: loslaten op de tel aan/uit', meta: META,
    doe: (v) => { if (v) { optel = !optel; engine.meld?.(`gebaren: loslaten ${optel ? 'op de tel' : 'meteen'}`, 'info', 'gebaar'); } }, lees: () => (optel ? 1 : 0) });

  // ---- de korrelwolk als instrument: vangen ---------------------------------------------------
  /** Vang voor korrelspoor `doel` (of het eerste) uit track `bron` (of de focus, of wat je hoort). */
  async function vang(doel = null, bron = null) {
    const d = doel ?? (T(engine.focus)?.instrument?.soort === 'korrel' ? engine.focus : engine.tracks.find((t) => t.instrument?.soort === 'korrel')?.n ?? null);
    const inst = d ? T(d)?.instrument?.inst : null;
    if (!inst?.laadBron) return { geweigerd: 'geen Korrelwolk op een track: zet het instrument erop (track.n.inst)' };
    const b = bron ?? (T(engine.focus)?.geladen ? engine.focus : engine.tracks.find((t) => t.geladen && engine.hoorbaar(t.n))?.n ?? engine.tracks.find((t) => t.geladen)?.n ?? null);
    const t = b ? T(b) : null;
    if (!t?.geladen || !t._haal) return { geweigerd: 'niets om te vangen: laad een nummer' };
    const P = t.plek(engine.nu() - engine.vertraging());
    const r = t.grid && t.telZeker?.(P) ? knipBereik(t.grid, P, VANG_TELLEN) : null;
    const van = r ? r.van : Math.max(0, P - VANG_ZONDER_GRID_S), tot = r ? r.tot : Math.max(P, van + VANG_ZONDER_GRID_S);
    const pcm = await knipPcm(await t._haal(), van, tot, t.stems ? t.stemGewichten() : null);
    if (!pcm || !inst.laadBron(pcm, { grond: grondVan(t._toon ?? t.nummer?.toon), titel: t.nummer?.titel ?? null })) return { geweigerd: 'vangen mislukt' };
    engine.meld?.(`korrelwolk ${d}: ${r ? `${r.tellen} tellen` : `${VANG_ZONDER_GRID_S} s`} van ${t.nummer?.titel ?? `track ${b}`}`, 'info', `korrel:${d}`);
    engine.emit('track', d);
    return undefined;
  }
  bus.defineer({ id: 'korrel.vang', soort: 'trigger', label: 'korrelwolk: vang de laatste tellen van wat er speelt', meta: META,
    doe: (v) => { if (v) vang().then((x) => { if (x?.geweigerd) engine.meld?.(x.geweigerd, 'fout', 'korrel'); }); },
    lees: () => (engine.tracks.some((t) => t.instrument?.soort === 'korrel') ? 0 : null) });

  // ---- zelf spelen: drums en noten ------------------------------------------------------
  const opstelling = () => engine.opstelling?.huidige?.() ?? null;
  const drumSpoor = () => {
    const s = opstelling()?.sporen.find((x) => x.instrument === 'drums' && T(x.n)?.instrument?.soort === 'drums');
    return s?.n ?? engine.tracks.find((t) => t.instrument?.soort === 'drums')?.n ?? null;
  };
  const melodieSpoor = () => {
    const f = T(engine.focus)?.instrument;
    if (f && f.soort !== 'drums') return engine.focus;
    const s = opstelling()?.sporen.find((x) => x.instrument && x.instrument !== 'drums' && T(x.n)?.instrument);
    return s?.n ?? engine.tracks.find((t) => t.instrument && t.instrument.soort !== 'drums')?.n ?? null;
  };
  const nootVan = (k) => {
    const toon = opstelling()?.toon ?? { grond: 48, ladder: 'mineur' };
    const l = LADDERS[toon.ladder] ?? LADDERS.mineur;
    const g = k - 1;
    return toon.grond + 12 + l[g % l.length] + 12 * Math.floor(g / l.length);
  };
  const ingedrukt = new Map();   // id -> { n, noot, v }
  const speel = (id, n, noot, v) => {
    if (v > 0) {
      if (ingedrukt.has(id)) { const o = ingedrukt.get(id); engine.noot(o.noot, 0, { n: o.n }); }
      if (n === null || !engine.noot(noot, v, { n })) return { geweigerd: 'geen instrument om op te spelen' };
      ingedrukt.set(id, { n, noot, v });
    } else {
      const o = ingedrukt.get(id);
      if (o) { engine.noot(o.noot, 0, { n: o.n }); ingedrukt.delete(id); }
    }
    return undefined;
  };
  for (let k = 1; k <= 16; k++) {
    bus.defineer({ id: `speel.drum.${k}`, soort: 'waarde', label: `drumpad ${k}`, meta: NOOT_META,
      doe: (v) => speel(`d${k}`, drumSpoor(), 35 + k, v), lees: () => (drumSpoor() === null ? null : ingedrukt.get(`d${k}`)?.v ?? 0) });
    bus.defineer({ id: `speel.noot.${k}`, soort: 'waarde', label: `noot ${k} van de toonladder`, meta: NOOT_META,
      doe: (v) => speel(`n${k}`, melodieSpoor(), nootVan(k), v), lees: () => (melodieSpoor() === null ? null : ingedrukt.get(`n${k}`)?.v ?? 0) });
  }

  return {
    /** De tel: loslaten op de tel en wat pas op de tel mag beginnen (echo vast, galm vast). Elke tik. */
    tik(t = engine.nu()) {
      for (const [naam, g] of actief) if (g.losOp !== null && t >= g.losOp - VOOR_DE_TEL) stop(naam);
      // Een bevriezend rack-gebaar dat nog aan het vangen was: na VANG_S de wolk vastzetten.
      for (const [naam, g] of actief) if (g.rack?.vries && !g.bevroren && t - g.t0 >= VANG_S) { g.bevroren = true; werk(naam, g, g.v); }
      for (const [actie, s] of stapels) {
        let iets = false;
        for (const l of s.lagen.values()) if (l.wachtTel !== null && t >= l.wachtTel - VOOR_DE_TEL) { l.wachtTel = null; iets = true; }
        if (iets) pasToe(actie);
      }
    },
    actief: () => [...actief.keys()],
    /** De korte namen van de 16 pads van nu (voor het scherm). */
    padLabels: () => padNamen().map((n) => GEBAREN[n]?.kort ?? n),
    naamVanPad: (k) => opPad.get(k) ?? padNamen()[k - 1] ?? null,
    optel: () => optel,
    vang,
  };
}
