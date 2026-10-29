/**
 * De Tocht op de bus (src/kern/tocht): het spel dat je langs alles leidt wat er kan, en je smaak
 * die uit je keuzes groeit. Lijm: luistert naar de bus (wat JIJ doet, kern/tocht/model.js
 * BRONNEN_SPELER) en telt maten op de maatklok; bewaren doet de schermlaag (gebeurtenis 'bewaar').
 *
 *   tocht.toon          trigger  zolang je drukt (CONTROL): de schermen tonen de opdracht
 *   tocht.overslaan     trigger  dit hoofdstuk overslaan (je bent vrij; terug kan altijd)
 *   tocht.vorige        trigger  een hoofdstuk terug
 *   tocht.spelen        trigger  het einde: verder met wat je verzamelde
 *   tocht.bouwen        trigger  het einde: verder bouwen aan het spel (de bouwwensen)
 *   tocht.stem.{n}      trigger  een stem op bouwwens n (de volgorde van WENSEN)
 *
 * Smaak (kern/tocht/smaak.js): bewaren +3 op alle kenmerken van de opstelling van nu, terughalen +1,
 * elke 8 maten spelen +0,25, binnen 4 maten wegrollen −0,4 op wat je wegrolde.
 */
import { Emitter } from '../kern/emitter.js';
import {
  HOOFDSTUKKEN, WENSEN, leegStaat, normaliseerStaat, verwerk, overslaan, naar, kies, stem, huidig, doelStand, wensenOpVolgorde,
} from '../kern/tocht/model.js';
import { leegSmaak, normaliseerSmaak, beloon, kenmerkenVan, BELONING, top } from '../kern/tocht/smaak.js';

const TRIG = { beginstand: false, log: 'overslaan' };
const GESPEELD_MATEN = 8;
const WEGGEROLD_MATEN = 4;

export function definieerTocht(engine) {
  const bus = engine.bus;
  const uit = new Emitter();
  let staat = leegStaat();
  let smaak = leegSmaak();
  let toont = false;
  let laatsteMaat = null;
  let matenOpstelling = 0;      // maten sinds de opstelling van nu begon
  let vorigeO = null;
  let laatsteNieuw = null;      // { tekst, stap } voor het scherm
  let naTerug = false;
  const gedrukt = new Set();    // gebaar-pads die nu vastgehouden worden (één beloning per druk)          // de volgende opstelling is er een die je terughaalde

  const veranderd = (bewaren = true) => { uit.emit('verander'); if (bewaren) uit.emit('bewaar', { tocht: staat, smaak }); };
  const zet = (s) => { staat = s; veranderd(); };

  function gebeurt(g) {
    const voor = staat;
    const { staat: s, nieuw, klaar } = verwerk(staat, g);
    if (s === voor) return;
    staat = s;
    if (nieuw.length) laatsteNieuw = { tekst: `ontdekt: ${nieuw[0]}`, stap: staat.stap };
    for (const id of klaar) {
      const h = HOOFDSTUKKEN.find((x) => x.id === id);
      engine.meld?.(`tocht: "${h.titel}" klaar${huidig(staat) ? ` — nu: ${huidig(staat).titel}` : ' — de tocht is uit: kies spelen of bouwen'}`, 'info', 'tocht');
    }
    veranderd(nieuw.length > 0 || klaar.length > 0 || g.soort === 'maat');
  }

  function smaakErbij(o, gewicht) {
    const k = kenmerkenVan(o);
    if (!k.length) return;
    smaak = beloon(smaak, k, gewicht);
  }

  // Wat je doet op de bus: de tocht, en de smaak.
  bus.on('actie', (a) => {
    if (a.id.startsWith('tocht.')) return;
    gebeurt({ soort: 'actie', id: a.id, v: a.v, bron: a.bron });
    if (!['apc', 'maschine', 'toetsen', 'scherm', 'hub'].includes(a.bron)) return;
    // Een gebaar dat je speelt (bij het indrukken): je smaak voor dat gebaar (de generator legt het vaker op de pads).
    const gp = /^gebaar\.pad\.(\d+)$/.exec(a.id);
    if (gp && a.v > 0 && !gedrukt.has(a.id)) {
      gedrukt.add(a.id);
      const naam = engine.gebaren?.naamVanPad?.(Number(gp[1]));
      if (naam) smaak = beloon(smaak, [`gebaar:${naam}`], BELONING.gekozen);
    } else if (gp && a.v === 0) gedrukt.delete(a.id);
    if (a.v !== true) return;
    const o = engine.opstelling?.huidige?.();
    if (a.id === 'opstelling.bewaar') smaakErbij(o, BELONING.bewaar);
    else if (a.id === 'opstelling.terug') naTerug = true;
    else if (a.id === 'opstelling.herrol' && o && matenOpstelling < WEGGEROLD_MATEN) smaakErbij(o, BELONING.weggerold);
  });
  // Elke nieuwe opstelling: de teller opnieuw.
  engine.opstelling?.on?.('verander', () => {
    const o = engine.opstelling.huidige?.();
    if (o && o !== vorigeO) {
      vorigeO = o;
      matenOpstelling = 0;
      if (naTerug) { naTerug = false; smaakErbij(o, BELONING.terug); }
    }
  });

  const trig = (id, label, fn) => bus.defineer({ id, soort: 'trigger', label, meta: TRIG, doe: (v) => (v ? fn() : undefined), lees: () => 0 });
  bus.defineer({ id: 'tocht.toon', soort: 'trigger', label: 'tocht: de opdracht op de schermen (vasthouden)', meta: TRIG,
    doe: (v) => { toont = !!v; veranderd(false); }, lees: () => (toont ? 1 : 0) });
  trig('tocht.overslaan', 'tocht: dit hoofdstuk overslaan', () => zet(overslaan(staat)));
  trig('tocht.vorige', 'tocht: een hoofdstuk terug', () => zet(naar(staat, staat.hoofdstuk - 1)));
  trig('tocht.spelen', 'tocht: verder spelen met wat je verzamelde', () => zet(kies(staat, 'spelen')));
  trig('tocht.bouwen', 'tocht: verder bouwen aan het spel', () => zet(kies(staat, 'bouwen')));
  WENSEN.forEach((w, i) => trig(`tocht.stem.${i + 1}`, `tocht: stem op "${w.titel}"`, () => zet(stem(staat, w.id))));

  return Object.assign(uit, {
    /** Wat er bewaard was (~/.varve/v2/instellingen/tocht.json en smaak.json). */
    laad({ tocht = null, smaak: sm = null } = {}) { staat = normaliseerStaat(tocht); smaak = normaliseerSmaak(sm); veranderd(false); },
    smaak: () => smaak,
    /** Op de maatklok (de schermlaag roept hem elke tik; WAT de tijd is zegt de klok). */
    tik(t = engine.nu()) {
      const o = engine.opstelling?.huidige?.();
      if (!o || !engine.klok?.loopt) { laatsteMaat = null; return; }
      const speelt = engine.patronen?.speelt || engine.tracks?.some((x) => x.speelt);
      const maat = Math.floor(engine.klok.tel(t) / (engine.klok.perMaat ?? 4));
      if (laatsteMaat === null) { laatsteMaat = maat; return; }
      if (maat <= laatsteMaat) return;
      laatsteMaat = maat;
      if (!speelt) return;
      matenOpstelling++;
      if (matenOpstelling % GESPEELD_MATEN === 0) smaakErbij(o, BELONING.gespeeld);
      gebeurt({ soort: 'maat', variatie: bus.lees('opstelling.macro.7') ?? 0 });
    },
    stand() {
      const h = huidig(staat);
      return {
        hoofdstuk: staat.hoofdstuk, aantal: HOOFDSTUKKEN.length, toont, einde: staat.einde,
        titel: h?.titel ?? null, uitleg: h?.uitleg ?? null, kanZonder: h?.kanZonder ?? null,
        doelen: h ? h.doelen.map((d) => { const [gedaan, nodig] = doelStand(staat, d); return { wat: d.wat, gedaan, nodig }; }) : [],
        klaar: staat.klaar.length, ontdekt: Object.keys(staat.ontdekt).length, laatsteNieuw,
        hoofdstukken: HOOFDSTUKKEN.map((x, i) => ({ id: x.id, titel: x.titel, klaar: staat.klaar.includes(x.id), nu: i === staat.hoofdstuk })),
        wensen: wensenOpVolgorde(staat).map((w) => ({ ...w, nr: WENSEN.findIndex((x) => x.id === w.id) + 1 })),
        smaak: top(smaak, 8),
      };
    },
  });
}
