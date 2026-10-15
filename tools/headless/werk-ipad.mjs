// De nep-iPad (werkruimte S7, docs/werkruimte/S7.md): werk.html?s=ipad in een EIGEN browsercontext
// op http://127.0.0.1 (geen opener, eigen opslag), via de server (SSE + ping), naast de echte mixer
// op http://localhost. Loopt de acceptatie van S7 na voor de server-tak:
//   - zonder kijker zendt de mixer niets (geen POST); een tweede mixer-tabblad zonder lock ook niet;
//   - twee kijkers krijgen bij verbinden de volledige stand (≤ 16 kB) en daarna alleen verschillen;
//   - één tijdlijn per nieuwe segId; in rust ≤ 2 berichten/s per deck;
//   - de hoorbare positie die de iPad uitrekent ligt binnen 5 ms van hoorbaar() in de mixer, over
//     60 s, ook na seek, loop en rem;
//   - een kijker die niet gekoppeld is doet nul POST's;
//   - S8 (bedienen, W1 = ja): standaard 404; een nep-iPhone koppelt met een code en veegt over de
//     xy-pad (de vertraging als meting), een nep-iPad bedient een knop, wordt geweigerd buiten `mag`,
//     valt weg met een .hold vast (los binnen 1,5 s), record.start en een vrije play worden geweigerd,
//     het log draagt de bron; uit in de Controlekamer = weer kijken. --zonder-bedienen slaat dit over;
//   - server weg: de rode balk; binnen 3 s na terugkomst weer de volledige stand.
// Wat alleen op de echte iPad te bevestigen is (Safari, het beginscherm, Wake Lock, wifi): zie
// docs/werkruimte/S7.md.
//
// Gebruik:  node tools/headless/werk-ipad.mjs [--duur 60]
// Poorten:  VARVE_KIJK_POORT (server, standaard 8970) en VARVE_KIJK_DEBUG (DevTools, 8971).
import { harnas, mixerKlaar, wacht, PROEF } from './werk-scherm.mjs';

/**
 * S8: dezelfde proefwerkruimte, met wat de iPad en een iPhone mogen bedienen (Clay kiest dat zelf;
 * dit is een proef). De iPad: kills en (om te zien dat het geweigerd wordt) opnemen en play in `mag`;
 * het filter en de fader van het paneel vier staan er bewust NIET in. De iPhone: de xy-pad in FX.
 * Een paneel "rec" in het deel KAAL met record.start en play: die moet de mixer altijd weigeren.
 */
const PROEF_S8 = {
  ...PROEF,
  delen: { ...PROEF.delen,
    kaal: { ...PROEF.delen.kaal, schermen: { ...PROEF.delen.kaal.schermen, ipad: { vakken: ['paneel:rec'] } } },
    fx: { ...PROEF.delen.fx, schermen: { ...PROEF.delen.fx.schermen, iphone: { vakken: ['paneel:xy'] } } } },
  panelen: { ...PROEF.panelen, rec: { titel: 'REC', items: [{ soort: 'knop', action: 'record.start' }, { soort: 'knop', action: 'track.1.play' }] } },
  schermen: { ...PROEF.schermen,
    ipad: { soort: 'ipad', mag: ['track.*.kill.*', 'record.*', 'track.*.play'] },
    iphone: { soort: 'iphone', mag: ['track.*.fx.*', 'track.*.send.*'] } },
};

const arg = (naam, std) => { const i = process.argv.indexOf(naam); return i >= 0 ? process.argv[i + 1] : std; };
const DUUR = Number(arg('--duur', 60));
const poort = Number(process.env.VARVE_KIJK_POORT) || 8970, debug = Number(process.env.VARVE_KIJK_DEBUG) || 8971;
const checks = [];
const ok = (naam, cond, extra = '') => { checks.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const mediaan = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const p = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

const h = await harnas({ poort, debug, naam: 'werk-ipad', werkruimtes: [PROEF_S8] });
try {
  const ipadUrl = `http://127.0.0.1:${poort}/werk.html?s=ipad`;
  console.log('de mixer, zonder kijker');
  const M = await h.nieuwePagina(`${h.basis}/?werk=proef`);
  await mixerKlaar(h, M, { tracks: 2 });
  ok('de zender staat (werkruimte proef)', await h.totdat(M, 'window.varveSchermen?.zender', 10000) !== false);
  const za = await h.ev(M, '({ ...window.varveSchermen.zender.stats })');
  await wacht(4000);
  const z0 = await h.ev(M, '({ ...window.varveSchermen.zender.stats, kijkers: window.varveSchermen.zender.kijkers })');
  ok('zonder kijker: geen POST, alleen 1×/s vragen of er iemand kijkt', z0.posts === 0 && z0.vragen - za.vragen >= 3 && z0.vragen - za.vragen <= 5,
    `${z0.posts} POST's, ${z0.vragen - za.vragen} keer gevraagd in 4 s`);

  // Een tweede tabblad van de mixer (dezelfde browser, dus zonder de Web Lock).
  const M2 = await h.nieuwePagina(`${h.basis}/?werk=proef`);
  await h.totdat(M2, 'window.varveSchermen?.zender', 30000);

  console.log('\ntwee kijkers (eigen browsercontext, http://127.0.0.1, geen opener)');
  const I1 = await h.nieuwePagina(ipadUrl, { context: true, breed: 1024, hoog: 1366, mobiel: true });
  const I2 = await h.nieuwePagina(ipadUrl, { context: true, breed: 1024, hoog: 1366, mobiel: true });
  const compleet = 'window.paneel?.verb?.compleet && window.paneel.verb.verschil !== null';
  const t1 = await h.totdat(I1, compleet, 10000), t2 = await h.totdat(I2, compleet, 10000);
  ok('beide kijkers hebben de volledige stand', t1 !== false && t2 !== false, `${t1} ms, ${t2} ms`);
  const soort = await h.ev(I1, "({ soort: window.paneel.verb.soort, kan: window.paneel.verb.kanBedienen, kijkt: !!document.querySelector('.vp-kijkt'), body: document.body.classList.contains('wp-kijkt') })");
  ok('via de server, kijkt alleen (W1)', soort.soort === 'server' && !soort.kan && soort.kijkt && soort.body, JSON.stringify(soort));
  ok('de vakken van het deel: stand, uitlijn, paneel', await h.totdat(I1, "document.querySelector('.wp-vak-stand .wp-stand-rij') && document.querySelector('.wp-vak-uitlijn .ul-baan') && document.querySelectorAll('.vp-item').length === 6", 8000) !== false);
  const s1 = await h.ev(I1, 'window.paneel.verb.stats'), s2 = await h.ev(I2, 'window.paneel.verb.stats');
  const server = await fetch(`${h.basis}/api/paneel/stand`).then((r) => r.json());
  ok('bij verbinden de volledige stand, ≤ 16 kB', s1.standen === 1 && s2.standen === 1 && server.bytes <= 16384 && s1.standBytes <= 16384,
    `server ${server.bytes} B, kijker ${s1.standBytes} tekens, ${server.kijkers} kijkers`);
  const tabs = await h.ev(M, 'window.varveSchermen.tab');
  const z2 = await h.ev(M2, '({ posts: window.varveSchermen.zender?.stats.posts ?? 0, vragen: window.varveSchermen.zender?.stats.vragen ?? 0 })');
  ok('een tweede tabblad zonder lock zendt niets; de server hoort alleen het eerste', z2.posts === 0 && server.tab === tabs && server.stats.genegeerd === 0, JSON.stringify({ z2, tab: server.tab === tabs }));

  // In rust: alleen verschillen, geen nieuwe tijdlijn zonder nieuw segment.
  console.log('\nin rust (10 s, beide tracks spelen)');
  const a = await h.ev(I1, 'JSON.parse(JSON.stringify(window.paneel.verb.stats))');
  await wacht(10000);
  const b = await h.ev(I1, 'JSON.parse(JSON.stringify(window.paneel.verb.stats))');
  const delta = (k) => (b.soorten[k] ?? 0) - (a.soorten[k] ?? 0);
  const zonderHb = Object.keys(b.soorten).reduce((s, k) => s + (k === 'hb' ? 0 : delta(k)), 0);
  ok('daarna alleen verschillen (geen tweede stand)', b.standen === 1, JSON.stringify(b.soorten));
  ok('in rust geen nieuwe tijdlijn (dezelfde segId)', delta('tijdlijn') === 0, `${delta('tijdlijn')} tijdlijnen`);
  ok('in rust ≤ 2 berichten/s per deck', zonderHb / 10 / 2 <= 2, `${(zonderHb / 10).toFixed(1)} berichten/s voor 2 decks (+ ${(delta('hb') / 10).toFixed(1)} hb/s van de server)`);

  // ---- de hoorbare positie, 60 s, met seek, loop en rem --------------------------------------
  console.log(`\nde hoorbare positie (${DUUR} s, met seek, loop en rem)`);
  const gebeurtenissen = [
    [0.15, 'seek A', "window.varvePaneel.invoke('track.1.seek', 0.3)"],
    [0.3, 'loop A aan', "window.varvePaneel.invoke('track.1.loop.toggle', true), window.varvePaneel.invoke('track.1.loop.toggle', false)"],
    [0.5, 'loop A uit', "window.varvePaneel.invoke('track.1.loop.toggle', true), window.varvePaneel.invoke('track.1.loop.toggle', false)"],
    [0.6, 'rem B', "window.varvePaneel.invoke('track.2.brake', true), window.varvePaneel.invoke('track.2.brake', false)"],
    [0.75, 'B weer play', "window.varvePaneel.invoke('track.2.play', true), window.varvePaneel.invoke('track.2.play', false)"],
    [0.85, 'seek B', "window.varvePaneel.invoke('track.2.seek', 0.1)"],
  ].map(([f, naam, js]) => ({ t: f * DUUR * 1000, naam, js, gedaan: false }));
  // currentTime springt per blok van de audiothread (in headless 512 frames, 10,7 ms): hoorbaar() in
  // de mixer schommelt dus zelf over een blok. Naast elke losse meting daarom ook een REEKS: 100 ms
  // lang zo vaak als het kan, het gemiddelde verschil (de schommeling middelt uit; wat overblijft
  // is de fout van de iPad zelf).
  const stappen = await h.ev(M, `(async () => { const c = window.engine.ctx; const st = new Set(); let v = c.currentTime; const t0 = performance.now();
    while (performance.now() - t0 < 300) { const ct = c.currentTime; if (ct !== v) { st.add(Math.round((ct - v) * c.sampleRate)); v = ct; } await new Promise((r) => setTimeout(r, 0)); }
    return [...st].sort((a, b) => a - b); })()`);
  console.log(`        currentTime springt in deze container per ${stappen.join('/')} frames (meestal ${(512 / 48).toFixed(2)} ms): zoveel schommelt hoorbaar() in de mixer zelf`);
  const fouten = { model: [], totaal: [], glad: [] };
  const naEvent = [];
  let laatsteEvent = -Infinity, monsters = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < DUUR * 1000) {
    const nu = Date.now() - t0;
    for (const g of gebeurtenissen) if (!g.gedaan && nu >= g.t) { g.gedaan = true; await h.ev(M, `(${g.js}, true)`); laatsteEvent = Date.now(); console.log(`        ${(nu / 1000).toFixed(1)} s: ${g.naam}`); }
    for (const id of ['A', 'B']) {
      const m = await h.ev(M, `(async () => { const z = window.varveSchermen.zender; const d = window.engine.deck('${id}');
        const reeks = []; const t0 = performance.now();
        while (performance.now() - t0 < 100) { reeks.push([window.varvePaneel.hoorbaar('${id}'), performance.now() + z.verschil]); await new Promise((r) => setTimeout(r, 0)); }
        return { pos: window.varvePaneel.hoorbaar('${id}'), srv: performance.now() + z.verschil, reeks, segId: d.tijdlijn()?.segId,
          rate: d.playing && !d.wacht ? (d.remt ? d.snelheid : d.rate) : 0, loop: !!d.loop, remt: !!d.remt }; })()`);
      const i = await h.ev(I1, `(() => { const v = window.paneel.verb; const r = ${JSON.stringify(m.reeks)};
        return { model: v.hoorbaarOp('${id}', ${m.srv}), eigen: v.hoorbaarOp('${id}'), srv: v.srvNu(), reeks: r.map(([, s]) => v.hoorbaarOp('${id}', s)) }; })()`);
      if (i.model === null || m.pos === null) continue;
      monsters++;
      const sindsEvent = Date.now() - laatsteEvent;
      const fout = Math.abs(i.model - m.pos) * 1000;
      if (sindsEvent < 300) { naEvent.push(fout); continue; }
      fouten.model.push(fout);
      if (process.env.VARVE_UITSCHIETERS && fout > Number(process.env.VARVE_UITSCHIETERS)) console.log(`        uitschieter ${id} ${(nu / 1000).toFixed(2)} s: ${fout.toFixed(1)} ms ${JSON.stringify({ m, i })}`);
      // De reeks: alleen als hij binnen één segment en één ronde van een loop bleef (geen sprong erin).
      const ds = m.reeks.map(([pos], k) => i.reeks[k] - pos).filter((x) => Number.isFinite(x));
      if (ds.length >= 5 && Math.max(...ds) - Math.min(...ds) < 0.03) {
        const g = Math.abs(ds.reduce((a2, b2) => a2 + b2, 0) / ds.length) * 1000;
        fouten.glad.push(g);
        if (g > 5) console.log(`        reeks boven 5 ms: ${id} op ${(nu / 1000).toFixed(1)} s, ${g.toFixed(2)} ms (loop ${m.loop}, rem ${m.remt}, rate ${m.rate?.toFixed?.(3)}, ${(Date.now() - laatsteEvent) / 1000} s na een gebeurtenis)`);
      }
      // Met de eigen klok van de iPad (zijn klokverschil met de server erbij): alleen waar het
      // deck rechtlijnig loopt (geen loop en geen rem). De reeks van de mixer doorgetrokken naar
      // het moment van de iPad, gemiddeld (de schommeling van currentTime middelt uit).
      if (!m.loop && !m.remt && ds.length >= 5) {
        const door = m.reeks.map(([pos, srv]) => pos + ((i.srv - srv) / 1000) * m.rate);
        fouten.totaal.push(Math.abs(i.eigen - door.reduce((a2, b2) => a2 + b2, 0) / door.length) * 1000);
      }
    }
    await wacht(200);
  }
  const max = (a) => Math.max(...a);
  // Ter informatie (geen check): tegen één losse hoorbaar(), die zelf over een blok van currentTime schommelt.
  console.log(`        los, tegen één hoorbaar(): max ${max(fouten.model).toFixed(2)} ms, mediaan ${mediaan(fouten.model).toFixed(2)}, p99 ${p(fouten.model, 0.99).toFixed(2)} (${fouten.model.length} metingen; de stap van currentTime telt hier zelf mee)`);
  ok(`gemiddeld over een reeks van 100 ms (de schommeling van currentTime uitgemiddeld): max ${max(fouten.glad).toFixed(2)} ms`, fouten.glad.length > 100 && max(fouten.glad) <= 5,
    `mediaan ${mediaan(fouten.glad).toFixed(2)}, p99 ${p(fouten.glad, 0.99).toFixed(2)}`);
  ok(`met de eigen klok van de iPad (zijn klokverschil erbij), over een reeks: max ${max(fouten.totaal).toFixed(2)} ms`, fouten.totaal.length > 50 && max(fouten.totaal) <= 5,
    `mediaan ${mediaan(fouten.totaal).toFixed(2)}, p99 ${p(fouten.totaal, 0.99).toFixed(2)}, ${fouten.totaal.length} metingen`);
  console.log(`        binnen 300 ms na een gebeurtenis (het nieuwe segment onderweg): ${naEvent.length} metingen, max ${naEvent.length ? max(naEvent).toFixed(1) : '–'} ms`);
  const tl = await h.ev(I1, 'window.paneel.verb.stats.tijdlijnen');
  const dubbel = tl.length - new Set(tl).size;
  ok('één tijdlijn per nieuwe segId (geen dubbele)', dubbel === 0, `${tl.length} tijdlijnen`);

  // ---- nul POST's van de iPad -------------------------------------------------------------
  const posts = [I1, I2].flatMap((s) => h.sessies.get(s).verzoeken.filter((v) => v.methode !== 'GET' && v.methode !== 'HEAD'));
  const tellers = await h.ev(I1, 'window.__teller');
  ok('de iPad doet nul POST\'s (W1)', posts.length === 0 && tellers.posts.length === 0, posts.map((v) => `${v.methode} ${v.url}`).join(', '));
  ok('de iPad: geen AudioContext, geen MIDI, geen Web Lock', tellers.ac === 0 && tellers.midi === 0 && tellers.lock === 0, JSON.stringify(tellers));

  // ---- de mixer houdt op met zenden (terug naar standaard) ------------------------------------------
  console.log('\nde mixer terug naar standaard, en weer terug');
  const tStd = Date.now();
  await h.ev(M, "window.werk.kies('standaard').then(() => true)");
  const stil = await h.totdat(I1, "!window.paneel.verb.compleet && document.getElementById('wp-balk').hidden && document.getElementById('wp-status').textContent === '◐'", 8000, 50);
  ok('de iPad ziet het meteen (de mixer zegt zelf weg): geen oude stand, wel de server (◐, geen rode balk)', stil !== false, `${((Date.now() - tStd) / 1000).toFixed(1)} s`);
  await h.ev(M, "window.werk.kies('proef').then(() => true)");
  ok('weer een werkruimte: de iPad krijgt de stand terug', await h.totdat(I1, 'window.paneel.verb.compleet', 8000) !== false);

  // ---- bedienen (S8, W1 = ja): koppelen, de xy-pad op de iPhone, weigeren, loslaten bij wegvallen ----
  if (!process.argv.includes('--zonder-bedienen')) await bedienen(M);

  // ---- de server valt weg en komt terug ------------------------------------------------------
  console.log('\nde server valt weg');
  const standenVoor = await h.ev(I1, 'window.paneel.verb.stats.standen');
  const tWeg = Date.now();
  await h.stopServer();
  const balk = await h.totdat(I1, "!document.getElementById('wp-balk').hidden", 8000, 25);
  ok('de rode balk "geen verbinding"', balk !== false, `${((Date.now() - tWeg) / 1000).toFixed(1)} s na het wegvallen`);
  await wacht(1500);
  h.startServer();
  let tOp = null;
  for (let i = 0; i < 200 && tOp === null; i++) { if (await fetch(`${h.basis}/api/paneel/kijkers`).then((r) => r.ok).catch(() => false)) tOp = Date.now(); else await wacht(25); }
  const terug = await h.totdat(I1, `window.paneel.verb.stats.standen > ${standenVoor} && window.paneel.verb.compleet && document.getElementById('wp-balk').hidden`, 10000, 25);
  const sinds = terug === false ? null : Date.now() - tOp;
  ok('binnen 3 s na terugkomst de volledige stand (en de balk weg)', sinds !== null && sinds <= 3000, `${sinds} ms na de eerste 200 van de server`);
  const terug2 = await h.totdat(I2, `window.paneel.verb.stats.standen > 1 && window.paneel.verb.compleet`, 5000);
  ok('… ook de tweede kijker', terug2 !== false);

  const fout = [...h.sessies.values()].flatMap((s) => s.fouten).filter((f) => !/ERR_CONNECTION|EventSource|favicon|net::|Failed to load resource/.test(f));
  ok('geen fouten in de console', fout.length === 0, fout.slice(0, 3).join(' | '));
  console.log(`        (${monsters} monsters; klokverschil iPad rondreis ${(await h.ev(I1, 'window.paneel.verb.rondreis'))?.toFixed?.(2)} ms)`);
} catch (e) {
  console.error(e);
  checks.push(['geen uitzondering', false]);
} finally {
  await h.stop();
}
/**
 * S8: de schrijfweg in echte Chrome-pagina's. De iPhone (390×844, een eigen browsercontext op
 * http://127.0.0.1, geen opener) koppelt met een code en veegt over de xy-pad; de iPad drukt
 * knoppen. De vertraging = van het muisbericht (CDP) tot de action in de mixer (bijInvoke), op één
 * klok (performance.timeOrigin + now, dezelfde machine). Wifi en touch zitten er NIET in.
 */
async function bedienen(M) {
  console.log('\nbedienen (S8): koppelen, de xy-pad op de iPhone, weigeren, loslaten');
  const api = (pad, init) => fetch(`${h.basis}${pad}`, init).then((r) => r.json().then((j) => ({ status: r.status, ...j })));
  const iphoneUrl = `http://127.0.0.1:${poort}/werk.html?s=iphone`;
  ok('standaard uit: invoke 404 voor de iPad', (await fetch(`http://127.0.0.1:${poort}/api/paneel/invoke`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${poort}` }, body: '{}' })).status === 404);
  await api('/api/paneel/schrijf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aan: true }) });
  // Het log aan, en elke regel met zijn bron opvangen (ook als het log intussen naar de server spoelt).
  await h.ev(M, "(async () => { await window.engine.resume(); if (!window.logboek.log.sessie) { window.varvePaneel.invoke('log.toggle', true); window.varvePaneel.invoke('log.toggle', false); } return true; })()");
  await h.totdat(M, 'window.logboek.log.sessie', 5000);
  await h.ev(M, `(() => { const l = window.logboek.log; const o = l.neem.bind(l); window.__log = [];
    l.neem = (a, w, laat, bron) => { window.__log.push([a, w ?? null, bron ?? null]); return o(a, w, laat, bron); };
    const { bijInvoke } = window.__bus ?? {}; return true; })()`);
  await h.ev(M, `(async () => { const { bijInvoke } = await import('/src/control/actions.js'); window.__inv = [];
    bijInvoke((id, v, o) => { if (o?.bron) window.__inv.push([id, v, performance.timeOrigin + performance.now(), o.bron]); }); return true; })()`);
  // Deel FX: op de iPhone de xy-pad.
  await h.ev(M, "(() => { const i = window.varvePaneel.invoke; i('werk.deel.fx', true); i('werk.deel.fx', false); return true; })()");
  const I3 = await h.nieuwePagina(iphoneUrl, { context: true, breed: 390, hoog: 844, mobiel: true });
  ok('de iPhone: het koppelformulier (bedienen staat aan, nog niet gekoppeld)', await h.totdat(I3, "!document.getElementById('wp-koppel').hidden && window.paneel?.verb?.compleet", 10000) !== false);
  ok('nog niet gekoppeld: hij kijkt', await h.ev(I3, '!window.paneel.verb.kanBedienen'));
  const code = (await api('/api/paneel/schrijf/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).code;
  await h.ev(I3, "(() => { document.getElementById('wp-koppel-code').value = '000000'; document.getElementById('wp-koppel-knop').click(); return true; })()");
  ok('een verkeerde code: een reden, niet gekoppeld', await h.totdat(I3, "/verkeerde code/.test(document.getElementById('wp-koppel-uitleg').textContent)", 5000) !== false && await h.ev(I3, '!window.paneel.verb.kanBedienen'));
  await h.ev(I3, `(() => { document.getElementById('wp-koppel-code').value = '${code}'; document.getElementById('wp-koppel-naam').value = 'nep-iPhone'; document.getElementById('wp-koppel-knop').click(); return true; })()`);
  ok('de juiste code: gekoppeld, het formulier weg, "bedient"', await h.totdat(I3, "window.paneel.verb.kanBedienen && document.getElementById('wp-koppel').hidden && document.getElementById('wp-soort').textContent === 'bedient'", 8000) !== false);
  const koek = await h.ev(I3, 'document.cookie');
  ok('de cookie is HttpOnly (de pagina ziet hem niet)', !/varve_paneel/.test(koek));
  ok('de mixer opent zijn kanaal (de schrijfweg staat aan, dit tabblad heeft de lock)', await h.totdat(M, 'window.varveSchermen.ontvanger?.open', 8000) !== false);
  ok('de xy-pad staat er, over de volle breedte', await h.totdat(I3, "document.querySelector('.vp-xy .vp-vlak')?.getBoundingClientRect().width > 300", 8000) !== false);

  // Vegen: 60 bewegingen, elk de tijd tot de action in de mixer.
  const vlak = await h.ev(I3, "(() => { const r = document.querySelector('.vp-xy .vp-vlak').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
  const muis = (type, x, y) => h.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' }, I3);
  const sendVoor = await h.ev(M, "window.varvePaneel.read('track.1.send.a')");
  await h.ev(M, 'window.__inv.length = 0, true');
  await h.ev(I3, `(() => { const f = window.fetch; window.__post = []; window.fetch = (u, o = {}) => {
    if (String(u).includes('/api/paneel/invoke')) { try { const b = JSON.parse(o.body); if (b.id === 'track.1.send.a') window.__post.push([b.v, performance.timeOrigin + performance.now()]); } catch (_) {} }
    return f(u, o); }; return true; })()`);
  await muis('mousePressed', vlak.x + vlak.w / 2, vlak.y + vlak.h / 2);
  // Elke 60 ms een beweging (sneller dan een vinger hoeft niet: vrij.js stuurt toch hooguit één per beeld);
  // de tijden achteraf ophalen, zonder de mixer intussen te peilen (dat zou hem zelf ophouden).
  const gestuurd = [];
  for (let i = 0; i < 60; i++) {
    const fx = 0.1 + 0.8 * ((i * 37) % 60) / 60, fy = 0.1 + 0.8 * ((i * 23) % 60) / 60;
    gestuurd.push({ t0: performance.timeOrigin + performance.now(), doel: Math.round((1 - fy) * 1e4) / 1e4 });
    await muis('mouseMoved', vlak.x + fx * vlak.w, vlak.y + fy * vlak.h);
    await wacht(60);
  }
  await wacht(500);
  const aangekomen = await h.ev(M, "window.__inv.filter((x) => x[0] === 'track.1.send.a')");
  const posts = await h.ev(I3, 'window.__post');
  const lat = [], pagina = [], weg = [];
  for (const g of gestuurd) {
    const x = aangekomen.find((a) => Math.abs(a[1] - g.doel) < 0.01 && a[2] >= g.t0);
    const q = posts.find((a) => Math.abs(a[0] - g.doel) < 0.01 && a[1] >= g.t0);
    if (x) lat.push(x[2] - g.t0);
    if (x && q) { pagina.push(q[1] - g.t0); weg.push(x[2] - q[1]); }
  }
  console.log(`        waarvan muis -> POST op de iPhone (tot één beeld bundelen): p50 ${mediaan(pagina).toFixed(1)}, p99 ${p(pagina, 0.99).toFixed(1)} ms; POST -> action in de mixer: p50 ${mediaan(weg).toFixed(1)}, p99 ${p(weg, 0.99).toFixed(1)} ms`);
  const drukTijdens = await h.ev(M, "window.varvePaneel.read('track.1.fx.knob.2.hold')");
  await muis('mouseReleased', vlak.x + vlak.w / 2, vlak.y + vlak.h / 2);
  await wacht(400);
  const fr0 = await h.ev(I3, 'window.__fr'); await wacht(1000); const fps = await h.ev(I3, 'window.__fr') - fr0;
  console.log(`        vertragingen (ms, gesorteerd): ${[...lat].sort((a, b) => a - b).map((x) => x.toFixed(0)).join(' ')}; de iPhone-pagina tekent ${fps} beelden/s`);
  ok(`vegen op de iPhone: elke beweging komt aan (${lat.length} van 60)`, lat.length >= 58);
  // Een METING, geen eis: headless tekent alles met software-GL (5 pagina's op deze kernen), en de
  // vinger en de wifi zitten er niet in. Op de echte iPhone opnieuw meten (docs/werkruimte/S8.md).
  console.log(`        METING vertraging iPhone -> mixer (CDP-muis tot de action, loopback, met het bundelen per beeld): p50 ${mediaan(lat).toFixed(1)} ms, p99 ${p(lat, 0.99).toFixed(1)} ms, max ${Math.max(...lat).toFixed(1)} ms`);
  const laatste = gestuurd.at(-1).doel;
  ok('de laatste stand van het vegen komt aan (de laatste wint, niets blijft hangen)', aangekomen.some((a) => Math.abs(a[1] - laatste) < 0.01));
  const sendNa = await h.ev(M, "window.varvePaneel.read('track.1.send.a')");
  ok('loslaten = "terug": de echo-send weer op de stand van vóór het aanraken', Math.abs(sendNa - sendVoor) < 0.01, `${sendVoor} -> ${sendNa}`);
  console.log(`        (de worp ${'track.1.fx.knob.2.hold'} tijdens het vegen: read ${drukTijdens}; zonder rack op een demotrack mag dat 0 zijn)`);
  const regels = await h.ev(M, 'window.__log');
  ok('het log: de acties van de iPhone met bron "iphone"', regels.some((r) => r[0] === 'track.1.send.a' && r[2] === 'iphone') && regels.filter((r) => r[0] === 'track.1.send.a').every((r) => r[2] === 'iphone'));

  // De iPad: koppelen, een knop die mag, een die niet mag, en loslaten bij wegvallen.
  await h.ev(M, "(() => { const i = window.varvePaneel.invoke; i('werk.deel.mix', true); i('werk.deel.mix', false); return true; })()");
  const code2 = (await api('/api/paneel/schrijf/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).code;
  // Een eigen iPad-pagina (I1 en I2 blijven kijkers voor de proef hierna).
  const I1 = await h.nieuwePagina(`http://127.0.0.1:${poort}/werk.html?s=ipad`, { context: true, breed: 1024, hoog: 1366, mobiel: true });
  await h.totdat(I1, "!document.getElementById('wp-koppel').hidden", 8000);
  await h.ev(I1, `(() => { document.getElementById('wp-koppel-code').value = '${code2}'; document.getElementById('wp-koppel-knop').click(); return true; })()`);
  ok('de iPad: gekoppeld', await h.totdat(I1, 'window.paneel.verb.kanBedienen', 8000) !== false);
  ok('de iPad: het paneel vier staat er', await h.totdat(I1, "document.querySelectorAll('.wp-vak-paneel .vp-item').length === 6 && window.paneel.verb.compleet", 8000) !== false);
  await wacht(500);
  const midden = async (sel) => h.ev(I1, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  // De opmaak van de iPad-pagina kan nog verschuiven (de vakken boven het paneel groeien als de stand binnenkomt):
  // klik tot de pagina echt iets verstuurt, hooguit drie keer, en zeg hoe vaak het nodig was.
  let pogingen = 0;
  const klik = async (sel, los = true) => {
    for (let i = 0; i < 3; i++) {
      pogingen++;
      const voor = await h.ev(I1, 'window.paneel.schrijver?.stats.verstuurd ?? 0');
      const q = await midden(sel);
      await h.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', buttons: 1, clickCount: 1 }, I1);
      const raak = await h.totdat(I1, `(window.paneel.schrijver?.stats.verstuurd ?? 0) > ${voor}`, 800, 20) !== false;
      if (los || !raak) await h.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', buttons: 0, clickCount: 1 }, I1);
      if (raak) return true;
      await wacht(300);
    }
    return false;
  };
  const killVoor = await h.ev(M, "window.varvePaneel.read('track.1.kill.low')");
  await klik('.wp-vak-paneel .vp-item:nth-child(2) .vp-knop');
  const killOk = await h.totdat(M, `window.varvePaneel.read('track.1.kill.low') !== ${killVoor}`, 3000) !== false;
  ok('een knop die in het paneel én in mag staat: uitgevoerd', killOk, killOk ? '' : JSON.stringify(await h.ev(I1, "({ s: window.paneel.schrijver?.stats && { ...window.paneel.schrijver.stats, rondreis: undefined }, deel: window.paneel.verb.werk()?.deel, items: document.querySelectorAll('.wp-vak-paneel .vp-item').length, melding: document.getElementById('wp-melding').textContent, knop: document.querySelector('.wp-vak-paneel .vp-item:nth-child(2)')?.className })"))
    + JSON.stringify(await h.ev(M, "({ uit: window.varveSchermen.uitvoerder?.stats, deel: window.werk.deel, toe: window.varveSchermen.toegestaan('ipad') })")));
  const filterVoor = await h.ev(M, "window.varvePaneel.read('track.1.filter')");
  const d = await midden('.wp-vak-paneel .vp-item:nth-child(1) .vp-dial');
  await h.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: d.x, y: d.y, button: 'left', buttons: 1, clickCount: 1 }, I1);
  await h.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: d.x, y: d.y - 80, button: 'left', buttons: 1 }, I1);
  await h.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: d.x, y: d.y - 80, button: 'left', buttons: 0, clickCount: 1 }, I1);
  await wacht(500);
  ok('het filter (in het paneel, niet in mag): geweigerd, de read blijft gelijk, een melding op de iPad',
    await h.ev(M, "window.varvePaneel.read('track.1.filter')") === filterVoor && await h.ev(I1, "!document.getElementById('wp-melding').hidden && /mag/.test(document.getElementById('wp-melding').textContent)"));
  // Een .hold vast, dan valt de iPad weg (de pagina gaat dicht): los binnen 1,5 s.
  await klik('.wp-vak-paneel .vp-item:nth-child(3) .vp-knop', false);
  ok(`HOOG WEG vast vanaf de iPad (klikken nodig tot hier: ${pogingen})`, await h.totdat(M, "window.varvePaneel.read('track.1.kill.high') === 1", 3000) !== false);
  // REC en play in het deel KAAL: geweigerd (VAST_NOOIT en tijdkritisch).
  const tDicht = Date.now();
  await h.cdp('Target.closeTarget', { targetId: h.sessies.get(I1).targetId });
  const los = await h.totdat(M, "window.varvePaneel.read('track.1.kill.high') === 0", 3000, 10);
  ok(`de iPad valt weg met een .hold vast: los binnen 1,5 s (${los === false ? '–' : Date.now() - tDicht} ms)`, los !== false && Date.now() - tDicht < 1500);
  const I4 = await h.nieuwePagina(`http://127.0.0.1:${poort}/werk.html?s=ipad`, { context: true, breed: 1024, hoog: 1366, mobiel: true });
  // Een nieuwe browsercontext = geen cookie: opnieuw koppelen.
  const code3 = (await api('/api/paneel/schrijf/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).code;
  await h.totdat(I4, "!document.getElementById('wp-koppel').hidden", 8000);
  await h.ev(I4, `(() => { document.getElementById('wp-koppel-code').value = '${code3}'; document.getElementById('wp-koppel-knop').click(); return true; })()`);
  await h.totdat(I4, 'window.paneel.verb.kanBedienen', 8000);
  await h.ev(M, "(() => { const i = window.varvePaneel.invoke; i('werk.deel.kaal', true); i('werk.deel.kaal', false); return true; })()");
  await h.totdat(I4, "document.querySelectorAll('.wp-vak-paneel .vp-knop').length === 2", 5000);
  const recVoor = await h.ev(M, "window.varvePaneel.read('record.start')");
  const speeltVoor = await h.ev(M, "window.engine.deck('A').playing");
  for (const n of [1, 2]) {
    const q = await h.ev(I4, `(() => { const r = document.querySelectorAll('.wp-vak-paneel .vp-knop')[${n - 1}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await h.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', buttons: 1, clickCount: 1 }, I4);
    await h.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', buttons: 0, clickCount: 1 }, I4);
  }
  await wacht(600);
  const st = await h.ev(M, "({ uit: window.varveSchermen.uitvoerder.stats, rec: window.varvePaneel.read('record.start'), speelt: window.engine.deck('A').playing })");
  ok('record.start en een vrije play in een paneel: geweigerd (niets opgenomen, play onveranderd)', st.rec === recVoor && st.speelt === speeltVoor && st.uit.geweigerd >= 3, JSON.stringify(st.uit));
  // Uit in de Controlekamer: de iPhone kijkt weer (binnen ~5 s), en de iPad krijgt 404.
  await api('/api/paneel/schrijf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aan: false }) });
  ok('de schrijfweg weer uit: de iPhone kijkt weer', await h.totdat(I3, '!window.paneel.verb.kanBedienen', 8000) !== false);
  ok('… en de mixer sluit zijn kanaal', await h.totdat(M, '!window.varveSchermen.ontvanger?.open', 5000) !== false);
  await h.cdp('Target.closeTarget', { targetId: h.sessies.get(I4).targetId }).catch(() => {});
  await h.cdp('Target.closeTarget', { targetId: h.sessies.get(I3).targetId }).catch(() => {});
}

const fout = checks.filter(([, c]) => !c);
console.log(fout.length ? `\n${fout.length} van ${checks.length} FOUT` : `\nAlles groen (${checks.length}).`);
process.exit(fout.length ? 1 : 0);
