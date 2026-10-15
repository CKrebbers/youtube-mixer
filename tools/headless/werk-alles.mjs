// De totaalmeting van de werkruimte (S8, docs/WERKRUIMTE.md C6): wat ALLES samen de hoofdthread van de
// mixer kost, tegen de nulmeting (`standaard`, zonder werkruimte). Headless Chrome, eigen server
// (poorten 8990/8991), alles in een tijdelijke map, een nep-APC (zonder uitgang tikt de LED-laag niet).
//
// Standen, elk na 2 s inlopen `--sec` seconden (standaard 8), afwisselend (nul, alles, nul, alles …,
// `--rondes`, standaard 2), zodat een machine die intussen drukker wordt beide kanten raakt:
//   nul    acht tracks spelend, werkruimte standaard (VARVE zoals vóór de werkruimte), en DEZELFDE hand: 20×/s
//          een draaiknop (de echo-send) via de nep-APC. Zo meet het verschil wat de werkruimte kost, niet
//          wat het scherm kost om een bewegende knop te volgen (dat doet het ook als hij van de APC komt);
//   alles  dezelfde acht tracks, plus: een werkruimte met het werkvak (de uitlijnstrook), een venster mac-2
//          met de uitlijnweergave groot (zelfde thread als de mixer), de zender naar de server met een
//          iPad-kijker (SSE), de schrijfweg AAN met een gekoppelde iPhone die 20 invokes/s stuurt (zoals een
//          vinger op de xy-pad; de ontvanger voert ze uit) en ✎ inrichten opgezet. iPad en iPhone zijn hier
//          node-clients op het netwerk, geen tabbladen: in het echt tekenen ze op hun EIGEN apparaat, en in
//          headless zou hun software-GL de beeldsnelheid van de mixer drukken (gemeten: 29 -> 21 beelden/s
//          bij gelijke taak). Hoe de pagina's zelf werken: tools/headless/werk-ipad.mjs. De Maschine NIET: die gaat alleen via de hub (VARVE_HUB_REPO, niet in elke
//          omgeving); de LED-laag van de Maschine zit dan niet in de meting (zie het verslag).
//   rust   alles aan, de tracks GESTOPT: wat er dan nog getekend wordt (Mpx/s).
// Per stand: taak ms/s (Performance.getMetrics), beelden/s, ms per beeld (taak / beelden), stijl ms/s,
// lange taken > 50 ms (PerformanceObserver), de duur van elke LED-tik (feedback.tick, p50/p99) en Mpx/s
// opnieuw getekend op de canvassen (de teller van tools/headless/tekenen.mjs).
// Budget (C6): ms per beeld ≤ nul + 2 · geen lange taak > 50 ms · LED-tik p99 ≤ nul × 1,1 · rust ≤ 3 Mpx/s.
//
// Gebruik: VARVE_CHROME=<chrome> node tools/headless/werk-alles.mjs [--sec 8] [--rondes 2] [--uit meting.json]
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { harnas, wacht, PROEF } from './werk-scherm.mjs';

const arg = (n, s) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : s; };
const SEC = Number(arg('--sec', 8)), RONDES = Number(arg('--rondes', 2));
const poort = Number(process.env.VARVE_ALLES_POORT) || 8990, debug = Number(process.env.VARVE_ALLES_DEBUG) || 8991;
const checks = [];
const ok = (naam, cond, extra = '') => { checks.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const kw = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

/** De werkruimte van de meting: zoals C6 hem beschrijft (werkvak = uitlijnstrook, mac-2 = uitlijn groot). */
const ALLES = {
  ...PROEF, naam: 'alles', titel: 'totaalmeting S8',
  delen: { ...PROEF.delen,
    mix: { label: 'MIX', kleur: 'wit', schermen: { hoofd: { werkvak: 'uitlijn-strook' }, 'mac-2': { vakken: ['uitlijn'] },
      ipad: { vakken: ['stand', 'uitlijn', 'paneel:vier'] }, iphone: { vakken: ['paneel:xy'] } } } },
  schermen: { ...PROEF.schermen, ipad: { soort: 'ipad', mag: ['track.*.kill.*'] }, iphone: { soort: 'iphone', mag: ['track.*.fx.*', 'track.*.send.*'] } },
};

// In de mixer, vóór alles: een nep-APC (in én uit), lange taken, en de canvasteller van tekenen.mjs.
const VOORAF = String.raw`(() => {
  const T = window.__m = { longtasks: [], tx: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) T.longtasks.push(e.duration); }).observe({ type: 'longtask', buffered: false }); } catch (_) {}
  let h = null;
  const pin = { id: 'nep-apc-in', name: 'APC40 mkII', manufacturer: 'Akai', type: 'input', state: 'connected', connection: 'open', onstatechange: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(pin, 'onmidimessage', { get: () => h, set: (f) => { h = f; }, enumerable: true });
  const pout = { id: 'nep-apc-uit', name: 'APC40 mkII', manufacturer: 'Akai', type: 'output', state: 'connected', connection: 'open', onstatechange: null, send() { T.tx++; }, addEventListener() {}, removeEventListener() {} };
  const access = { inputs: new Map([[pin.id, pin]]), outputs: new Map([[pout.id, pout]]), sysexEnabled: true, onstatechange: null, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
  // Dezelfde hand in de nulmeting: 20×/s device knob 5 (in strip = de echo-send van de focus-track) via de nep-APC.
  let n = 0, stroom = null;
  T.apcStroom = (aan) => { clearInterval(stroom); stroom = aan ? setInterval(() => { n++; h?.({ data: new Uint8Array([0xb0, 20, 64 + Math.round(30 * Math.sin(n / 10))]), timeStamp: performance.now() }); }, 50) : null; };
  const merk = (proto, namen, naar) => { for (const n of namen) { const o = proto[n]; if (!o) continue; proto[n] = function (...a) { const c = naar(this); if (c) c.__vuil = true; return o.apply(this, a); }; } };
  merk(CanvasRenderingContext2D.prototype, ['fillRect','clearRect','strokeRect','drawImage','putImageData','fill','stroke','fillText','strokeText'], (x) => x.canvas);
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (P) merk(P.prototype, ['drawArrays','drawElements','clear'], (x) => x.canvas);
  T.px = 0;
  const tel = () => { for (const c of document.querySelectorAll('canvas')) { if (!c.__vuil) continue; c.__vuil = false; T.px += c.width * c.height; } requestAnimationFrame(tel); };
  requestAnimationFrame(tel);
})();`;

const h = await harnas({ poort, debug, naam: 'werk-alles', werkruimtes: [ALLES] });
const uitkomst = { sec: SEC, rondes: RONDES, nul: [], alles: [], rust: null };
try {
  const M = await h.nieuwePagina('about:blank');
  await h.cdp('Page.addScriptToEvaluateOnNewDocument', { source: VOORAF }, M);
  await h.cdp('Page.navigate', { url: `${h.basis}/?werk=standaard` }, M);
  ok('de mixer start', await h.totdat(M, 'window.engine && window.werk && window.werkStart && window.aanhakers && window.feedback', 40000) !== false);
  await h.ev(M, 'window.werkStart.then(() => window.aanhakers).then(() => true)');
  ok('de nep-APC is gekozen en de LED-laag tikt', await h.totdat(M, 'window.feedback.klaar && window.feedback.tikken > 5', 15000) !== false);
  // Acht tracks met de demotrack, spelend.
  await h.ev(M, `(async () => { const e = window.engine; await e.resume(); const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
    const ids = 'ABCDEFGH'; for (let k = 0; k < 8; k++) { const d = e.deck(ids[k]); await d.laadGeheugen(renderDemoTrack(e.ctx, { bpm: 124, bars: 64, seed: k }), 'demo ' + (k + 1));
      d.setGrid({ stukken: [{ van: 0, bpm: 124, anker: 0, zekerheid: 0.9 }], slot: true }); }
    for (const id of ids) e.deck(id).play(); return true; })()`);
  // De LED-tik getimed (elke aanroep van feedback.tick).
  await h.ev(M, `(() => { const f = window.feedback, o = f.tick.bind(f); window.__m.tik = [];
    f.tick = (...a) => { const t0 = performance.now(); try { return o(...a); } finally { window.__m.tik.push(performance.now() - t0); } }; return true; })()`);
  const metriek = async () => Object.fromEntries((await h.cdp('Performance.getMetrics', {}, M)).metrics.map((m) => [m.name, m.value]));
  await h.cdp('Performance.enable', {}, M).catch(() => {});

  async function stand(naam) {
    await wacht(2000);
    await h.ev(M, 'window.__m.longtasks.length = 0, window.__m.tik.length = 0, window.__m.px0 = window.__m.px, window.__fr0 = window.__fr, window.__t0 = performance.now(), true');
    const a = await metriek();
    await wacht(SEC * 1000);
    const b = await metriek();
    const p = await h.ev(M, '({ lang: window.__m.longtasks.slice(), tik: window.__m.tik.slice(), px: window.__m.px - window.__m.px0, fr: window.__fr - window.__fr0, dt: (performance.now() - window.__t0) / 1000 })');
    const r = (k) => ((b[k] - a[k]) * 1000) / p.dt;
    const rij = { naam, taak: r('TaskDuration'), script: r('ScriptDuration'), stijl: r('RecalcStyleDuration'), opmaak: r('LayoutDuration'), fps: p.fr / p.dt,
      lang: p.lang.length, langMax: p.lang.length ? Math.max(...p.lang) : 0, tikP50: kw(p.tik, 0.5), tikP99: kw(p.tik, 0.99), tikken: p.tik.length, mpx: p.px / p.dt / 1e6 };
    rij.perBeeld = rij.taak / Math.max(1, rij.fps);
    console.log(`| ${naam} | ${rij.taak.toFixed(1)} | ${rij.fps.toFixed(0)} | ${rij.perBeeld.toFixed(2)} | ${rij.stijl.toFixed(1)} | ${rij.lang} (max ${rij.langMax.toFixed(0)}) | ${rij.tikP50.toFixed(3)} / ${rij.tikP99.toFixed(3)} (${rij.tikken}) | ${rij.mpx.toFixed(2)} |`);
    return rij;
  }

  // Alles aanzetten (eenmalig opbouwen; daarna wisselen we alleen de werkruimte: standaard <-> alles).
  let W = null, kijker = null, iphone = null;
  const LOK = `localhost:${poort}`;
  /** Een SSE-kijker (de iPad): leest alles wat de server stuurt. */
  function sse(pad) {
    const k = { berichten: 0 };
    const r = request({ host: '127.0.0.1', port: poort, path: pad, headers: { host: LOK, accept: 'text/event-stream' } }, (res) => { res.on('data', () => { k.berichten++; }); });
    r.on('error', () => {}); r.end();
    k.sluit = () => r.destroy();
    return k;
  }
  const post = (pad, body, headers = {}) => new Promise((z) => {
    const r = request({ host: '127.0.0.1', port: poort, method: 'POST', path: pad, headers: { host: LOK, 'content-type': 'application/json', ...headers } }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => z({ status: res.statusCode, headers: res.headers, json: (() => { try { return JSON.parse(t); } catch (_) { return null; } })() }));
    });
    r.on('error', () => z({ status: 0 })); r.end(JSON.stringify(body));
  });
  /** De iPhone: koppelen met een code, dan 20 invokes/s op de echo-send (de y van de xy-pad). */
  async function maakIphone() {
    await post('/api/paneel/schrijf', { aan: true });
    const code = (await post('/api/paneel/schrijf/code', {})).json.code;
    const ORIGIN = { origin: `http://${LOK}` };
    const k = await post('/api/paneel/koppel', { code, naam: 'nep-iPhone', scherm: 'iphone' }, ORIGIN);
    const cookie = String(k.headers['set-cookie'] ?? '').split(';')[0];
    const ip = { status: {}, seq: 0, aan: false };
    const tik = async () => {
      if (!ip.aan) return;
      const v = Math.round((0.5 + 0.4 * Math.sin(ip.seq / 10)) * 1e4) / 1e4;
      const r = await post('/api/paneel/invoke', { t: 'invoke', id: 'track.1.send.a', v, druk: null, seq: ++ip.seq, scherm: 'iphone', k: 'nepiphone001' }, { ...ORIGIN, cookie });
      ip.status[r.status] = (ip.status[r.status] ?? 0) + 1;
    };
    ip.timer = setInterval(tik, 50);
    return ip;
  }
  async function allesAan({ mac2 = true } = {}) {
    await h.ev(M, "window.werk.kies('alles').then(() => true)");
    // --deel <naam>: een ander deel dan MIX (bv. kaal: geen werkvak), om te zien wat het werkvak zelf kost.
    if (arg('--deel', null)) await h.ev(M, `(() => { const i = window.varvePaneel.invoke; i('werk.deel.${arg('--deel', null)}', true); i('werk.deel.${arg('--deel', null)}', false); return true; })()`);
    else await h.totdat(M, "window.varveSchermen?.werkvak()?.startsWith('uitlijn-strook')", 10000);
    if (mac2 && !W) {
      await h.ev(M, "window.open('werk.html?s=mac-2', 'varve-werk-mac-2', 'popup,width=1280,height=760') && true");
      W = await h.sessieVan('werk.html?s=mac-2');
      await h.totdat(W, "document.querySelector('.wp-vak-uitlijn')", 10000);
    }
    if (!mac2 && W) {
      await h.ev(M, "(() => { const v = window.varveSchermen.open.get('mac-2'); v?.close(); window.varveSchermen.open.delete('mac-2'); return true; })()");
      for (const [id, x] of h.sessies) if (x.url.includes('werk.html?s=mac-2')) h.sessies.delete(id);
      W = null;
      await wacht(500);
    }
    kijker ??= sse('/api/paneel/live?s=ipad&k=nepipad00001');
    await h.ev(M, 'window.__m.apcStroom(false), true');
    iphone ??= await maakIphone();
    iphone.aan = true;
    ok('alles staat: werkvak, mac-2, een iPad-kijker, de zender zendt, de ontvanger luistert en voert de iPhone uit',
      await h.totdat(M, 'window.varveSchermen.zender?.kijkers > 0 && window.varveSchermen.ontvanger?.open && window.varveSchermen.uitvoerder?.stats.uitgevoerd > 10', 10000) !== false);
  }
  async function nulAan() {
    if (iphone) iphone.aan = false;
    await h.ev(M, 'window.__m.apcStroom(true), true');
    await h.ev(M, "window.werk.kies('standaard').then(() => true)");
    await h.totdat(M, '!window.varveSchermen.zender', 5000);
  }

  console.log(`\n| stand (8 tracks, ${SEC} s) | taak ms/s | beelden/s | ms/beeld | stijl ms/s | lange taken > 50 ms | LED-tik p50 / p99 ms (aantal) | Mpx/s |\n|---|---|---|---|---|---|---|---|`);
  uitkomst.zonder = [];
  for (let r = 0; r < RONDES; r++) {
    await nulAan();
    uitkomst.nul.push(await stand(`nul ${r + 1}`));
    await allesAan({ mac2: false });
    uitkomst.zonder.push(await stand(`alles zonder mac-2 ${r + 1}`));
    await allesAan();
    uitkomst.alles.push(await stand(`alles ${r + 1}`));
  }
  // Rust: alles aan, de tracks gestopt.
  await h.ev(M, "(() => { for (const id of 'ABCDEFGH') window.engine.deck(id).pause?.() ?? window.engine.deck(id).stop?.(); return true; })()");
  await wacht(1000);
  if (process.argv.includes('--profiel')) {
    await h.cdp('Profiler.enable', {}, M); await h.cdp('Profiler.setSamplingInterval', { interval: 200 }, M); await h.cdp('Profiler.start', {}, M);
  }
  uitkomst.rust = await stand('alles, in rust (gestopt)');
  if (process.argv.includes('--profiel')) {
    const { profile } = await h.cdp('Profiler.stop', {}, M);
    const zelf = new Map(), ids = new Map(profile.nodes.map((n) => [n.id, n])), tot = new Map();
    const ouder = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) ouder.set(c, n.id);
    const naam = (n) => `${n.callFrame.functionName || '(anoniem)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
    profile.samples.forEach((id, i) => { const dt = profile.timeDeltas[i] || 0; zelf.set(naam(ids.get(id)), (zelf.get(naam(ids.get(id))) || 0) + dt);
      const gezien = new Set(); for (let x = id; x; x = ouder.get(x)) { const k = naam(ids.get(x)); if (gezien.has(k)) continue; gezien.add(k); tot.set(k, (tot.get(k) || 0) + dt); } });
    const top = (m) => [...m].filter(([k]) => !/^\((idle|program|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18);
    console.log('zelftijd (ms/s):'); for (const [k, us] of top(zelf)) console.log(`  ${(us / 1000 / SEC).toFixed(1).padStart(6)}  ${k}`);
    console.log('totaal (ms/s):'); for (const [k, us] of top(tot)) console.log(`  ${(us / 1000 / SEC).toFixed(1).padStart(6)}  ${k}`);
  }
  await nulAan();
  uitkomst.rustNul = await stand('nul, in rust (gestopt)');

  const gem = (l, k) => l.reduce((s, x) => s + x[k], 0) / l.length;
  const samen = (l) => ({ perBeeld: gem(l, 'perBeeld'), tikP99: gem(l, 'tikP99'), taak: gem(l, 'taak'), stijl: gem(l, 'stijl'), fps: gem(l, 'fps') });
  const nul = samen(uitkomst.nul), zo = samen(uitkomst.zonder), al = samen(uitkomst.alles);
  uitkomst.samen = { nul, zonder: zo, alles: al };
  for (const [n, x] of [['nul', nul], ['alles zonder mac-2', zo], ['alles', al]]) console.log(`gemiddeld ${n}: taak ${x.taak.toFixed(1)} ms/s, ${x.fps.toFixed(0)} beelden/s, ${x.perBeeld.toFixed(2)} ms/beeld, stijl ${x.stijl.toFixed(1)} ms/s, LED-tik p99 ${x.tikP99.toFixed(3)} ms`);
  // Twee manieren om "per beeld" te lezen. (1) taak / beelden zoals gemeten: telt mee dat headless met
  // software-GL minder beelden haalt zodra er een tweede venster tekent. (2) het VERSCHIL in taak per
  // seconde gedeeld door 60 (een beeld op een scherm van 60 Hz): wat de werkruimte de hoofdthread kost.
  const extra60 = (al.taak - nul.taak) / 60;
  console.log(`extra per beeld: (1) gemeten ${(al.perBeeld - nul.perBeeld).toFixed(2)} ms (zonder mac-2 ${(zo.perBeeld - nul.perBeeld).toFixed(2)} ms); (2) Δtaak / 60 = ${extra60.toFixed(2)} ms (zonder mac-2 ${((zo.taak - nul.taak) / 60).toFixed(2)} ms)`);
  ok(`budget: ≤ 2 ms per beeld extra, als Δtaak / 60 (${extra60.toFixed(2)} ms)`, extra60 <= 2);
  ok(`budget: ≤ 2 ms per beeld extra zonder mac-2, gemeten per beeld (${(zo.perBeeld - nul.perBeeld).toFixed(2)} ms)`, zo.perBeeld - nul.perBeeld <= 2);
  ok(`budget: geen lange taak > 50 ms met alles aan (${uitkomst.alles.reduce((s, x) => s + x.lang, 0)}; nul: ${uitkomst.nul.reduce((s, x) => s + x.lang, 0)})`, uitkomst.alles.every((x) => x.lang === 0) && uitkomst.zonder.every((x) => x.lang === 0) && uitkomst.rust.lang === 0);
  ok(`budget: LED-tik p99 ≤ nul + 10% (${al.tikP99.toFixed(3)} tegen ${(nul.tikP99 * 1.1).toFixed(3)} ms)`, al.tikP99 <= nul.tikP99 * 1.1);
  ok(`budget: in rust ≤ 3 Mpx/s getekend (${uitkomst.rust.mpx.toFixed(2)} Mpx/s; nul in rust ${uitkomst.rustNul.mpx.toFixed(2)})`, uitkomst.rust.mpx <= 3);
  if (iphone) { clearInterval(iphone.timer); console.log(`de nep-iPhone: ${JSON.stringify(iphone.status)} (status -> aantal); de iPad-kijker kreeg ${kijker.berichten} stukken`); kijker.sluit(); }
  ok('de iPhone werd uitgevoerd (200) en nooit afgeremd', (iphone?.status[200] ?? 0) > 100 && !iphone?.status[429]);
  const fout = [...h.sessies.values()].flatMap((s) => s.fouten).filter((f) => !/ERR_CONNECTION|favicon|net::|Failed to load resource/.test(f));
  ok('geen fouten in de console', fout.length === 0, fout.slice(0, 3).join(' | '));
  const uit = arg('--uit', null);
  if (uit) writeFileSync(uit, JSON.stringify(uitkomst, null, 1));
} catch (e) {
  console.error(e);
  checks.push(['geen uitzondering', false]);
} finally {
  await h.stop();
}
const fout = checks.filter(([, c]) => !c);
console.log(fout.length ? `\n${fout.length} van ${checks.length} FOUT` : `\nAlles groen (${checks.length}).`);
process.exit(fout.length ? 1 : 0);
