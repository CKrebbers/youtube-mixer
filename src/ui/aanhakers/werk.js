// Aanhaker 'werk' (spoor S3, docs/WERKRUIMTE.md D4, docs/werkruimte/S3.md): de werkruimte in de
// mixer. Alleen dit spoor raakt dit bestand; wat ctx bevat staat in src/ui/aanhakers.js.
//
// Zet op: de APC-adapter (src/werk/apparaten.js), de Werkruimte (src/werk/werkruimte.js), de
// actions (src/control/acties-werk.js), de werk-balk (src/ui/werk-balk.js) en het peilen (elke
// 3 s, met de ETag: meestal een 304). Welke werkruimte bij het opstarten: ?werk=<naam> (onthouden),
// anders een stand die net geactiveerd is (/api/standen/actief: mixer.werkruimte, één keer per
// activering), anders de laatst gekozen (localStorage 'varve.werkruimte'), anders 'standaard'.
//
// Na de opzet: ctx.werk = de Werkruimte (voor de aanhakers erna: S4–S8) en window.werk (de
// headless tools en de console).
import { Werkruimte, maakHaler, plekkenVan } from '../../werk/werkruimte.js';
import { maakApcAdapter, registreerApparaat, aanwezigVan } from '../../werk/apparaten.js';
import { naamGeldig } from '../../werk/model.js';
import { bindWerk } from '../../control/acties-werk.js';
import { herbindLagen, bijInvoke } from '../../control/actions.js';
import { opzetWerkBalk } from '../werk-balk.js';
import { leesWeg } from '../../lib/antwoord.js';

export const SLEUTEL = 'varve.werkruimte';
export const STAND_SLEUTEL = 'varve.werkruimte.stand';
const GEZIEN = 'varve.werkruimte.gezien.';
export const PEIL_MS = 3000;
/** Hoe lang het opstarten wacht op een apparaat dat de werkruimte vereist, vóór de terugval. */
export const WACHT_MS = 4000;

const opslag = {
  lees(k) { try { return globalThis.localStorage?.getItem(k) ?? null; } catch (_) { return null; } },
  zet(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch (_) {} },
};

/**
 * Welke werkruimte bij het opstarten. Puur (de test): `url` (?werk=), `stand` (wat
 * /api/standen/actief over de mixer zegt: { naam, sinds } of null), `lees(k)` (localStorage).
 * Geeft { naam, onthoud: { sleutel: waarde } } (wat er daarna in localStorage moet).
 */
export function kiesStart({ url = 'http://x/', stand = null, lees = () => null } = {}) {
  let q = null;
  try { q = new URL(url).searchParams.get('werk'); } catch (_) {}
  if (q && naamGeldig(q)) return { naam: q, onthoud: { [SLEUTEL]: q }, door: 'adres' };
  if (stand?.naam && naamGeldig(stand.naam) && stand.sinds && stand.sinds !== lees(STAND_SLEUTEL)) {
    return { naam: stand.naam, onthoud: { [SLEUTEL]: stand.naam, [STAND_SLEUTEL]: stand.sinds }, door: 'stand' };
  }
  const l = lees(SLEUTEL);
  return { naam: l && naamGeldig(l) ? l : 'standaard', onthoud: {}, door: 'onthouden' };
}

export default async function opzet(ctx) {
  // Zonder mapjes en mapping (de lege proef in aanhaakpunten.test) valt er niets op te zetten.
  if (!ctx?.lagen || !ctx?.mapping || typeof document === 'undefined') return;
  const { lagen, mapping, midi, engine } = ctx;

  const plan = (fn) => {
    // In het volgende beeld; staat het tabblad op de achtergrond (geen rAF), dan na 100 ms.
    let klaar = false;
    const doe = () => { if (klaar) return; klaar = true; fn(); };
    try { requestAnimationFrame(doe); } catch (_) {}
    setTimeout(doe, 100);
  };
  const meld = (tekst, soort = 'info', duur, knop) => {
    const el = ctx.meld?.(tekst, soort, duur);
    if (!knop || !el?.append) return el;
    const b = document.createElement('button');
    b.className = 'werk-melding-knop';
    b.textContent = knop.tekst;
    b.addEventListener('click', () => { el.remove(); knop.doe(); }, { once: true });
    el.append(b);
    return el;
  };

  const adapter = maakApcAdapter({ lagen, invoke: ctx.invoke, bijInvoke, mapping, naam: 'APC',
    aanwezig: () => /apc40/i.test(midi?.input?.()?.name ?? '') });
  registreerApparaat('apc40mk2', adapter);

  const haal = maakHaler({ fetch: (...a) => fetch(...a), leesWeg });
  const haalStuk = async (naam) => {
    const r = await fetch(`mappings/stukken/${encodeURIComponent(naam)}.json`);
    if (!r.ok) { await leesWeg(r); return null; }
    return r.json();
  };
  const bewaar = async (naam, ruw, versie) => {
    const r = await fetch(`/api/werkruimtes/${encodeURIComponent(naam)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ werkruimte: ruw, versie }) });
    const d = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, versie: d?.versie, fout: d?.fout };
  };
  const standaarden = {};   // gevuld vóór de eerste werkruimte (zie start hieronder)

  const focusDeck = () => engine?.decks?.[engine.focus] ?? null;
  const conditie = (c) => {
    switch (c) {
      case 'focus.instrument': return !!engine?.instrumentOp?.(engine.focus);
      case 'focus.nummer': return (focusDeck()?.duration ?? 0) > 0;
      case 'focus.stems': return !!focusDeck()?.stems;
      case 'focus.leeg': return !engine?.instrumentOp?.(engine.focus) && !((focusDeck()?.duration ?? 0) > 0);
      case 'speel.instrument': return !!engine?.speeltrack?.();
      default: return false;
    }
  };

  const werk = new Werkruimte({
    mapping, herbind: herbindLagen, meld, midi, standaarden, plan, haal, haalStuk, bewaar, conditie,
    rijen: ctx.rijen,
    scherm: {
      // De library zoals de knop hem opent (onderpanelen.js: één onderpaneel tegelijk), niet over de bus.
      onderpaneel: (naam, open) => { if (naam === 'library' && !!ctx.laden?.library?.open !== open) document.getElementById('lib-btn')?.click(); },
      onderpaneelOpen: (naam) => (naam === 'library' ? !!ctx.laden?.library?.open : false),
    },
    basislijn: {
      lees: (naam) => { try { return JSON.parse(opslag.lees(GEZIEN + naam) ?? 'null'); } catch (_) { return null; } },
      zet: (naam, p) => opslag.zet(GEZIEN + naam, JSON.stringify(p ?? plekkenVan(werk.samenstelling))),
    },
  });

  let namen = [];
  bindWerk(werk, { lijst: () => namen });
  const lijst = async () => {
    const r = await fetch('/api/werkruimtes');
    if (!r.ok) { await leesWeg(r); return []; }
    return (await r.json()).werkruimtes ?? [];
  };
  const balk = opzetWerkBalk({ el: document.getElementById('werk-balk'), werk, invoke: ctx.invoke, lijst, namen: (n) => { namen = n; }, plan });
  // De keuze onthouden (de laatst gekozen werkruimte komt bij het opstarten terug).
  werk.on('change', (s) => { if (!werk.terug && s.naam) opslag.zet(SLEUTEL, s.naam); });

  ctx.werk = werk;
  window.werk = werk;
  window.werkBalk = balk;

  // Opstarten op de achtergrond: de aanhakers na deze (S4–S8) wachten niet op de server.
  window.werkStart = (async () => {
    try {
      const r = await fetch('mappings/apc40mk2.json');
      if (r.ok) standaarden.apc40mk2 = await r.json(); else await leesWeg(r);
    } catch (_) {}
    // Wat er gekozen is, met de stand die net geactiveerd werd.
    let stand = null;
    try {
      const r = await fetch('/api/standen/actief');
      if (r.ok) stand = (await r.json())?.mixer?.werkruimte ?? null; else await leesWeg(r);
    } catch (_) {}
    const start = kiesStart({ url: location.href, stand, lees: (k) => opslag.lees(k) });
    for (const [k, v] of Object.entries(start.onthoud)) opslag.zet(k, v);
    if (start.naam !== 'standaard') {
      // Vraagt hij een apparaat dat nog niet verbonden is (de hub, de APC na "audio starten"),
      // dan eerst even wachten (hooguit WACHT_MS) voordat de terugval geldt.
      const eerst = await haal(start.naam).catch(() => null);
      const vereist = Array.isArray(eerst?.werkruimte?.vereist) ? eerst.werkruimte.vereist : [];
      if (vereist.length) await wachtOp(() => vereist.every((x) => aanwezigVan(x, midi)), midi, WACHT_MS);
      await werk.kies(start.naam, { vanzelf: true });
    }
    try { namen = (await lijst()).map((x) => x.naam); } catch (_) {}
  })();

  // Elke 3 s kijken of het bestand veranderde (Claude schreef het, een ander venster sloeg op).
  setInterval(() => { if (werk.naam !== 'standaard') werk.peil().catch(() => {}); }, PEIL_MS);
}

/** Wachten tot `klaar()` (bij elke poortwissel en elke 250 ms gekeken), hooguit `ms`. */
function wachtOp(klaar, midi, ms) {
  return new Promise((z) => {
    const t0 = Date.now();
    let af = null, iv = null;
    const kijk = () => {
      if (!klaar() && Date.now() - t0 < ms) return;
      af?.(); clearInterval(iv); z();
    };
    af = midi?.on?.('state', kijk) ?? null;
    iv = setInterval(kijk, 250);
    kijk();
  });
}
