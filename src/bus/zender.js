/**
 * De mixer op de koppelbus (docs/BUS.md): stuurt muziek en beeld naar de hub,
 * en zet acties van de bus om in invoke() op de action-bus.
 *
 * Werkt als status-zender.js: alleen het tabblad met de Web Lock stuurt, en
 * alles wat er gestuurd wordt komt uit `lees()`. Deze module raakt de engine
 * niet (regel 1). De timer wekt alleen; tel, fase en ctx komen uit lees(), dus
 * uit ctx.currentTime (regel 3). Acties van buiten gaan door invoke() met een
 * waarde 0..1 of een boolean (regel 2).
 *
 * lees() geeft:
 *   { maat, bpm, tel, fase, ctx, energie: {rms, laag, midden, hoog} | null,
 *     decks: [{ id, nummer: {id, titel} | null, toon: {camelot, naam, zekerheid} | null }],
 *     beeld: { lagen: [{aan, systeem, dekking, mengvorm, knoppen[6]}], video: {mode, fx} } | null }
 *
 * Een tabblad op de achtergrond knijpt zijn timers als er niets klinkt; tijdens
 * een set klinkt er altijd iets. Tel-berichten komen binnen één tik (33 ms);
 * wie strakker wil, rekent verder met fase en bpm uit de stand
 * (td/bouw_varve.py doet dat tussen twee standen in).
 */
export const URL_STANDAARD = 'ws://127.0.0.1:8778';
export const HALLO = {
  baan: 'hub', type: 'hallo', app: 'varve', versie: 1,
  luistert: ['acties', 'apc'], stuurt: ['muziek', 'beeld', 'acties', 'apc'],
};
const FX = ['pixel', 'spiegel', 'rgb', 'kleur', 'sporen', 'korrel'];
const ENERGIE = ['rms', 'laag', 'midden', 'hoog'];

const klem = (x) => Math.min(1, Math.max(0, x));
const rond = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
const getal01 = (x) => (Number.isFinite(x) ? rond(klem(x)) : 0);

/** Het stand-bericht uit lees(). Puur. */
export function maakStand(s = {}, t = Date.now()) {
  const m = { baan: 'muziek', type: 'stand', van: 'varve', t };
  if (Number.isFinite(s.ctx)) m.ctx = rond(s.ctx, 3);
  m.maat = typeof s.maat === 'string' || Number.isInteger(s.maat) ? s.maat : null;
  m.bpm = Number.isFinite(s.bpm) && s.bpm > 0 ? rond(s.bpm, 2) : null;
  m.tel = Number.isInteger(s.tel) && s.tel >= 1 && s.tel <= 16 ? s.tel : null;
  m.fase = Number.isFinite(s.fase) ? rond(klem(s.fase)) : null;
  m.energie = s.energie && typeof s.energie === 'object'
    ? Object.fromEntries(ENERGIE.map((k) => [k, getal01(s.energie[k])]))
    : null;
  return m;
}

/** Het beeld-bericht (zonder t), of null. Puur; alles naar de vorm uit BUS.md. */
export function maakBeeld(b) {
  if (!b || typeof b !== 'object') return null;
  const lagen = (Array.isArray(b.lagen) ? b.lagen : []).slice(0, 8).map((l, i) => ({
    nr: i + 1,
    aan: !!l?.aan,
    systeem: l?.systeem == null ? null : String(l.systeem),
    dekking: getal01(l?.dekking),
    mengvorm: typeof l?.mengvorm === 'string' ? l.mengvorm : 'screen',
    knoppen: Array.from({ length: 6 }, (_, k) => getal01(l?.knoppen?.[k])),
  }));
  const fx = b.video?.fx ?? {};
  const video = b.video ? {
    mode: typeof b.video.mode === 'string' ? b.video.mode : 'mix',
    fx: Object.fromEntries(FX.map((k) => [k, getal01(fx[k])])),
  } : null;
  return { baan: 'beeld', type: 'lagen', van: 'varve', lagen, video };
}

/**
 * @param {object} o
 * @param {() => object} o.lees
 * @param {() => boolean} [o.isEerste]   heeft dit tabblad de Web Lock? (tabblad.js)
 * @param {{bijInvoke?: Function, invoke?: Function}} [o.actions]  de action-bus
 * @param {(app: string|null) => void} [o.bijApc]  de hub meldt wie de APC heeft
 */
export function startBusZender({
  lees, isEerste = () => true, actions = null, bijApc = null,
  url = URL_STANDAARD, WebSocketImpl = globalThis.WebSocket,
  interval = 33, opnieuw = 3000, nu = Date.now,
} = {}) {
  if (typeof WebSocketImpl !== 'function' || typeof lees !== 'function') return null;
  let ws = null, open = false, gestopt = false, wachter = null, vanBus = false;
  const vanDeBus = new Map();   // id -> waarde die net van de bus kwam: niet terugsturen (geen echo)
  let vorig = { tel: null, beeld: null, decks: new Map() };
  const wacht = new Map();   // value-acties: per id de laatste waarde, één keer per tik weg

  const stuur = (m) => {
    if (!open || ws?.readyState !== 1) return;
    try { ws.send(JSON.stringify(m)); } catch (_) { /* de bus mag de mixer nooit storen */ }
  };

  function tik() {
    if (!open || !isEerste()) return;
    const t = nu();
    for (const [id, waarde] of wacht) stuur({ baan: 'acties', van: 'varve', t, id, waarde });
    wacht.clear();
    let s;
    try { s = lees() || {}; } catch (_) { return; }
    const stand = maakStand(s, t);
    stuur(stand);
    if (stand.tel != null && stand.tel !== vorig.tel) stuur({ baan: 'muziek', type: 'tel', van: 'varve', t, tel: stand.tel });
    vorig.tel = stand.tel;
    for (const d of Array.isArray(s.decks) ? s.decks : []) {
      if (d?.id == null) continue;
      const was = vorig.decks.get(d.id) ?? {};
      const nummerId = d.nummer?.id ?? null, camelot = d.toon?.camelot ?? null;
      if (nummerId !== (was.nummerId ?? null)) {
        stuur({ baan: 'muziek', type: 'nummer', van: 'varve', t, deck: String(d.id), id: nummerId, titel: d.nummer?.titel ?? null });
      }
      if (camelot !== (was.camelot ?? null)) {
        stuur({ baan: 'muziek', type: 'toon', van: 'varve', t, deck: String(d.id), camelot,
                naam: d.toon?.naam ?? null, zekerheid: Number.isFinite(d.toon?.zekerheid) ? rond(d.toon.zekerheid, 2) : null });
      }
      vorig.decks.set(d.id, { nummerId, camelot });
    }
    const b = maakBeeld(s.beeld);
    if (b) {
      const sleutel = JSON.stringify(b);
      if (sleutel !== vorig.beeld) { vorig.beeld = sleutel; stuur({ ...b, t }); }
    }
  }

  // Wat de mixer doet, gaat de bus op. Wat van de bus komt, gaat niet terug (geen echo).
  actions?.bijInvoke?.((id, waarde) => {
    // vanBus dekt een invoke die meteen loopt; vanDeBus ook een die later loopt
    if (vanDeBus.has(id) && vanDeBus.get(id) === waarde) { vanDeBus.delete(id); return; }
    if (vanBus || !open || !isEerste()) return;
    if (typeof waarde === 'boolean') stuur({ baan: 'acties', van: 'varve', t: nu(), id, waarde });
    else if (Number.isFinite(waarde)) wacht.set(id, waarde);
  });

  function ontvang(tekst) {
    let m;
    try { m = JSON.parse(tekst); } catch (_) { return; }
    if (m?.baan === 'acties' && typeof m.id === 'string') {
      const w = m.waarde;
      if (typeof w !== 'boolean' && !(Number.isFinite(w) && w >= 0 && w <= 1)) return;
      if (!isEerste() || typeof actions?.invoke !== 'function') return;
      wacht.delete(m.id);                                    // een oudere eigen waarde mag de bus niet overschrijven
      vanDeBus.set(m.id, w);
      vanBus = true;
      try { actions.invoke(m.id, w); } catch (_) { /* invoke gooit niet, maar toch */ } finally { vanBus = false; }
      if (vanDeBus.size > 64) vanDeBus.clear();
    } else if (m?.baan === 'apc' && m.type === 'eigenaar') {
      try { bijApc?.(m.app ?? null); } catch (_) { /* idem */ }
    }
  }

  function verbind() {
    if (gestopt) return;
    try { ws = new WebSocketImpl(url); } catch (_) { return later(); }
    const deze = ws;
    deze.onopen = () => {
      open = true;
      try { deze.send(JSON.stringify({ ...HALLO, t: nu() })); } catch (_) { /* volgende poging */ }
    };
    deze.onmessage = (e) => { if (typeof e.data === 'string') ontvang(e.data); };
    deze.onerror = () => { /* onclose volgt */ };
    deze.onclose = () => {
      open = false;
      vorig = { tel: null, beeld: null, decks: new Map() };   // na opnieuw verbinden alles één keer opnieuw
      wacht.clear();
      later();
    };
  }
  const later = () => { if (!gestopt) wachter = setTimeout(verbind, opnieuw); };

  verbind();
  const klok = setInterval(tik, interval);
  const apc = (type) => stuur({ baan: 'apc', type, van: 'varve', t: nu(), app: 'varve' });
  return {
    get verbonden() { return open; },
    tik,
    vraagApc: () => apc('vraag'),
    geefApcLos: () => apc('los'),
    stop() {
      gestopt = true;
      clearInterval(klok);
      clearTimeout(wachter);
      try { ws?.close(); } catch (_) { /* al dicht */ }
    },
  };
}
