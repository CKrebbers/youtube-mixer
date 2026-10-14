// De nep-iPad (werkruimte S7, docs/werkruimte/S7.md): werk.html?s=ipad in een EIGEN browsercontext
// op http://127.0.0.1 (geen opener, eigen opslag), via de server (SSE + ping), naast de echte mixer
// op http://localhost. Loopt de acceptatie van S7 na voor de server-tak:
//   - zonder kijker zendt de mixer niets (geen POST); een tweede mixer-tabblad zonder lock ook niet;
//   - twee kijkers krijgen bij verbinden de volledige stand (≤ 16 kB) en daarna alleen verschillen;
//   - één tijdlijn per nieuwe segId; in rust ≤ 2 berichten/s per deck;
//   - de hoorbare positie die de iPad uitrekent ligt binnen 5 ms van hoorbaar() in de mixer, over
//     60 s, ook na seek, loop en rem;
//   - de iPad doet nul POST's (W1: alleen kijken);
//   - server weg: de rode balk; binnen 3 s na terugkomst weer de volledige stand.
// Wat alleen op de echte iPad te bevestigen is (Safari, het beginscherm, Wake Lock, wifi): zie
// docs/werkruimte/S7.md.
//
// Gebruik:  node tools/headless/werk-ipad.mjs [--duur 60]
// Poorten:  VARVE_KIJK_POORT (server, standaard 8970) en VARVE_KIJK_DEBUG (DevTools, 8971).
import { harnas, mixerKlaar, wacht } from './werk-scherm.mjs';

const arg = (naam, std) => { const i = process.argv.indexOf(naam); return i >= 0 ? process.argv[i + 1] : std; };
const DUUR = Number(arg('--duur', 60));
const poort = Number(process.env.VARVE_KIJK_POORT) || 8970, debug = Number(process.env.VARVE_KIJK_DEBUG) || 8971;
const checks = [];
const ok = (naam, cond, extra = '') => { checks.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const mediaan = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const p = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

const h = await harnas({ poort, debug, naam: 'werk-ipad' });
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
  ok('de iPad ziet het binnen ~4 s: geen oude stand, wel de server (◐, geen rode balk)', stil !== false, `${((Date.now() - tStd) / 1000).toFixed(1)} s`);
  await h.ev(M, "window.werk.kies('proef').then(() => true)");
  ok('weer een werkruimte: de iPad krijgt de stand terug', await h.totdat(I1, 'window.paneel.verb.compleet', 8000) !== false);

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
const fout = checks.filter(([, c]) => !c);
console.log(fout.length ? `\n${fout.length} van ${checks.length} FOUT` : `\nAlles groen (${checks.length}).`);
process.exit(fout.length ? 1 : 0);
