// Herkomst: stroommachine@0f4124e koppel/varve-beeld-zender.js (ongewijzigd overgenomen; wijzig hem daar, niet hier).
/**
 * varve-beeld-zender.js — Varve DJ → beeldmachine (Stroommachine) via de Varve-relay.
 * Plain ES-module, geen dependencies, geen DOM. Kopieer naar Varve DJ (bv. src/koppel/) en hang hem aan de bestaande lezers.
 * Protocol: koppel/PROTOCOL-dj.md in de Stroommachine-repo.
 *
 *   import { maakBeeldZender } from './varve-beeld-zender.js';
 *   const zender = maakBeeldZender({
 *     url: 'ws://omarchy.local:7702/app',
 *     klok: () => ({ bpm, beat, speelt }),          // beat = doorlopende tel van de master (maat.js), speelt = transport loopt
 *     kenmerken: () => ({ 'mix.laag':…, 'mix.midden':…, 'mix.hoog':…, 'mix.klap':…, 'mix.luid':…, 'maat.tel':…, 'maat.klap':… }) | null,
 *   });
 *   zender.start();
 *   zender.track('A', { id, titel, bpm, key });     // bij laden van een track
 *   zender.mix({ xfader, a:{speelt,pos,rate}, b:{…} });  // bij verandering (wordt zelf begrensd tot 20/s)
 *   zender.poort('macro.tint', 0.6);                // APC-pagina "Beeld" → elke Stroommachine-poort (0..1) of 'regie!ontdek'
 *   zender.on('status', s => …);                    // {verbonden, beeld:{regime, scene, fps, volgt}}
 *
 * Alles 0..1 zoals de actie-bus van Varve DJ. Tijd = performance.now() van deze machine; de beeldmachine
 * rekent het klokverschil zelf uit (ping/pong, waarop deze module automatisch antwoordt).
 */

export const BRONNEN = ['mix.laag', 'mix.midden', 'mix.hoog', 'mix.klap', 'mix.luid', 'maat.tel', 'maat.klap'];

export function maakBeeldZender({
  url,
  app = 'varvedj',
  naar = 'stroommachine',
  klok = () => null,
  kenmerken = () => null,
  hz = 30,
  klokHz = 4,
  WebSocketImpl = globalThis.WebSocket,
  nu = () => globalThis.performance.now(),
  timers = { setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis), setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
  log = () => {},
} = {}) {
  if (!url || !/^wss?:\/\//.test(url)) throw new Error('beeld-zender: url moet ws:// of wss:// zijn');
  let ws = null, aan = false, tries = 0, herT = 0, tik = 0, kenT = 0, laatsteTel = null, mixT = 0, mixWacht = null, laatsteKlok = 0;
  const luisteraars = {};
  const status = { verbonden: false, beeld: null, verstuurd: 0, ontvangen: 0 };
  const emit = (e, d) => (luisteraars[e] || []).forEach((f) => { try { f(d); } catch (err) { log('luisteraar', err); } });
  const zend = (o) => { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); status.verstuurd++; return true; } catch (e) { log('zend', e); } } return false; };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const c01 = (v) => (v > 1 ? 1 : v < 0 ? 0 : v);

  function stuurKlok() {
    const k = safe(klok); if (!k || !(k.bpm > 0) || !Number.isFinite(k.beat)) return;
    zend({ naar, type: 'klok', t: r3(nu()), beat: r3(k.beat), bpm: r3(k.bpm), speelt: k.speelt !== false });
    laatsteKlok = nu();
  }
  function safe(f) { try { return f(); } catch (e) { log('lezer', e); return null; } }

  function verbind() {
    if (!aan) return;
    try { ws = new WebSocketImpl(url); } catch (e) { log('verbinden', e); opnieuw(); return; }
    ws.onopen = () => {
      tries = 0; status.verbonden = true; emit('status', status);
      zend({ app, naam: 'Varve DJ', kleur: '#3557ff', bronnen: BRONNEN, knoppen: [] });   // manifest (eerste bericht)
      stuurKlok();
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > 16384) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      status.ontvangen++;
      if (m && m.type === 'ping' && m.id != null) zend({ naar: typeof m.van === 'string' ? m.van : naar, type: 'pong', id: m.id, t0: m.t0, t1: r3(nu()) });
      else if (m && m.type === 'beeld-status') { status.beeld = { regime: String(m.regime || ''), scene: String(m.scene || ''), fps: +m.fps || 0, volgt: !!m.volgt, bpm: +m.bpm || 0 }; emit('status', status); }
    };
    ws.onerror = () => {};
    ws.onclose = () => { status.verbonden = false; emit('status', status); ws = null; opnieuw(); };
  }
  function opnieuw() {
    if (!aan) return;
    timers.clearTimeout(herT);
    const s = Math.min(10, 2 ** tries) * (0.8 + 0.4 * Math.random()); tries++;
    herT = timers.setTimeout(verbind, s * 1000);
  }

  return {
    status,
    start() {
      if (aan) return; aan = true; verbind();
      // tel-grenzen fijn volgen (20 ms) + vaste klokpuls (klokHz)
      tik = timers.setInterval(() => {
        const k = safe(klok); if (!k || !Number.isFinite(k.beat)) return;
        const tel = Math.floor(k.beat);
        if (tel !== laatsteTel || nu() - laatsteKlok > 1000 / klokHz) { laatsteTel = tel; stuurKlok(); }
      }, 20);
      kenT = timers.setInterval(() => {
        const w = safe(kenmerken); if (!w) return;
        const uit = {}; let n = 0;
        for (const b of BRONNEN) { const v = +w[b]; if (Number.isFinite(v)) { uit[b] = r3(c01(v)); n++; } }
        if (n) zend({ type: 'kenmerken', w: uit });   // de relay stuurt dit naar abonnees (de beeldmachine) en door routes.json
      }, 1000 / hz);
    },
    stop() {
      aan = false; timers.clearInterval(tik); timers.clearInterval(kenT); timers.clearTimeout(herT); timers.clearTimeout(mixT);
      if (ws) { try { ws.onclose = null; ws.close(); } catch {} ws = null; }
      status.verbonden = false;
    },
    track(deck, info = {}) {
      return zend({ naar, type: 'track', deck: deck === 'B' ? 'B' : 'A', id: info.id != null ? String(info.id).slice(0, 200) : '', titel: String(info.titel || '').slice(0, 120),
        bpm: Number.isFinite(+info.bpm) ? +info.bpm : null, key: String(info.key || '').slice(0, 8) });
    },
    mix(m = {}) {
      const doe = () => { mixT = 0; const x = mixWacht; mixWacht = null; if (x) zend({ naar, type: 'mix', ...x }); };
      mixWacht = { xfader: r3(c01(+m.xfader || 0)), a: m.a || null, b: m.b || null };
      if (!mixT) mixT = timers.setTimeout(doe, 50);   // hooguit 20 berichten per seconde, laatste stand wint
    },
    poort(id, waarde) {
      if (typeof id !== 'string' || !id) return false;
      return zend(id.includes('!') ? { naar, poort: id } : { naar, poort: id, waarde: r3(c01(+waarde || 0)) });
    },
    on(e, f) { (luisteraars[e] ||= []).push(f); return () => { luisteraars[e] = luisteraars[e].filter((x) => x !== f); }; },
  };
}
