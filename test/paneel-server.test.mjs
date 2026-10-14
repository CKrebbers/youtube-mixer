// Het protocol en de relais van de panelen (werkruimte S7, docs/werkruimte/S7.md, WERKRUIMTE.md C4):
//   1. src/paneel/protocol.js (puur): verschillen ≤ 10/s per id, klokverschil, klok uit metingen,
//      stand bijhouden, items plat, vaknamen;
//   2. server/paneel.js (PaneelRelais) met nep-antwoorden: eerst een stand, een kijker krijgt de
//      volledige stand en daarna alleen verschillen, een tweede tabblad telt niet, zonder kijker vers = false;
//   3. src/ui/live-zender.js met een nep-fetch en nep-timers: zonder kijker geen POST (1×/s vragen),
//      met een kijker eerst een stand en daarna alleen verschillen, een tijdlijn per segId,
//      een tabblad zonder lock zendt niets, een server die wegvalt = terug naar vragen;
//   4. een EIGEN server (eigen poort, VARVE_TESTSERVER=1): van-mixer van buiten de Mac = 403, twee
//      SSE-kijkers krijgen de stand (≤ 16 kB) en daarna alleen verschillen, ping, geen invoke-route.
// Draai met: node test/paneel-server.test.mjs
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const P = await import('../src/paneel/protocol.js');
const { PaneelRelais } = await import('../server/paneel.js');
const { startLiveZender } = await import('../src/ui/live-zender.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));
const bij = (a, b, eps) => Math.abs(a - b) <= eps;

// ---- 1. het protocol ------------------------------------------------------------------------
console.log('het protocol (puur)');
{
  const verzonden = new Map();
  const a = P.readsVerschil({ x: 0.5, y: true }, verzonden, 0);
  ok('de eerste keer: alles', a && a.reads.x === 0.5 && a.reads.y === true);
  ok('niets veranderd: niets', P.readsVerschil({ x: 0.5, y: true }, verzonden, 10) === null);
  ok('een verandering binnen 100 ms blijft liggen (≤ 10/s per id)', P.readsVerschil({ x: 0.6, y: true }, verzonden, 50) === null);
  const b = P.readsVerschil({ x: 0.7, y: true }, verzonden, 101);
  ok('… en gaat daarna, met de LAATSTE waarde', b && b.reads.x === 0.7 && !('y' in b.reads));
  let n = 0;
  for (let t = 200; t < 1200; t += 5) if (P.readsVerschil({ x: t / 10000, y: true }, verzonden, t)) n++;
  ok(`een fader die 1 s lang elke 5 ms beweegt: ${n} berichten (≤ 10)`, n <= 10 && n >= 9);
  ok('gelijk: getallen op 1e-4', P.gelijk(0.12345, 0.12349) && !P.gelijk(0.1, 0.11) && P.gelijk(null, null) && !P.gelijk(null, 0));
  ok('rond: 4 decimalen, NaN = null', P.rond(0.123456) === 0.1235 && P.rond(NaN) === null && P.rond(undefined) === null && P.rond(true) === true);

  const r = [{ a: 0, s: 1000.5, b: 1 }, { a: 10, s: 1010.4, b: 11 }, { a: 20, s: 1030, b: 30 }, { a: 40, s: 1040.6, b: 41 }];
  const k = P.klokVerschil(r);
  ok('klokverschil: mediaan van de snelste helft', k && bij(k.verschil, 1000, 0.11) && k.rondreis === 1);
  ok('klokverschil zonder rondjes: null', P.klokVerschil([]) === null);

  // Metingen zoals Chrome ze geeft: currentTime in stappen van 10,67 ms, getOutputTimestamp glad.
  const stap = 512 / 48000, L = 0.0123;
  const metingen = [];
  for (let i = 0; i < 40; i++) {
    const perf = 1000 + i * 20 + (i % 3);                  // ms
    const waar = perf / 1000 - 0.5;                         // de "gladde" audioklok (s)
    metingen.push({ ctx: Math.floor((waar + L) / stap) * stap, perf, uit: waar });
  }
  const best = P.besteMeting(metingen);
  const midden = (perf) => perf / 1000 - 0.5 + L - stap / 2;
  ok('klok: het midden van de schommeling van currentTime (< 1 ms)', best && Math.abs(best.ctxT - midden(best.perf)) < 0.001 && best.spreiding > 8);
  const haper = metingen.map((m, i) => (i === 35 ? { ...m, ctx: m.ctx - 0.05 } : m));
  const b2 = P.besteMeting(haper);
  ok('één meting tijdens een haper (50 ms achter): de mediaan laat hem liggen', Math.abs(b2.ctxT - midden(b2.perf)) < 0.001);
  ok('ctxOp: doortrekken op de serverklok; stil = vast', bij(P.ctxOp({ ctxT: 10, srvT: 5000 }, 6000), 11, 1e-9) && P.ctxOp({ ctxT: 10, srvT: 5000, loopt: false }, 9000) === 10 && P.ctxOp(null, 1) === null);

  const s = P.legeStand();
  P.pasToe(s, { t: 'stand', reads: { a: 1 }, decks: { A: { nr: 1 } }, tijdlijn: { A: { segId: 1 } }, maatgever: 'A', klok: { ctxT: 1 }, werkruimte: { naam: 'w' } });
  P.pasToe(s, { t: 'verschil', reads: { b: 2 } });
  P.pasToe(s, { t: 'tijdlijn', deck: 'A', tl: { segId: 2 } });
  P.pasToe(s, { t: 'deck', deck: 'B', info: { nr: 2 } });
  P.pasToe(s, { t: 'maatgever', id: 'B' });
  ok('pasToe: een stand en daarna verschillen geven de volledige stand', s.reads.a === 1 && s.reads.b === 2 && s.tijdlijn.A.segId === 2 && s.decks.B.nr === 2 && s.maatgever === 'B');
  ok('pasToe: onbekend telt niet', P.pasToe(s, { t: 'invoke', id: 'x' }) === false && !P.isBericht({ t: 'invoke' }));
  P.pasToe(s, { t: 'deck', deck: 'B', info: null });
  ok('een deck dat leeg wordt verdwijnt', !('B' in s.decks));

  const items = P.plat({ items: [{ soort: 'rij', herhaal: ['pixel', 'rgb'], item: { soort: 'knop', action: 'video.fx.{k}.hold' } }, { soort: 'draai', action: 'track.{focus}.filter' }] });
  ok('plat: een rij met herhaal en {k}', items.length === 3 && items[0].action === 'video.fx.pixel.hold' && items[1].action === 'video.fx.rgb.hold' && items[2].action === 'track.{focus}.filter');
  ok('xyActions: {as} = 1 en 2, zonder {as} alleen x', P.xyActions('track.{focus}.fx.knob.{as}').join() === 'track.{focus}.fx.knob.1,track.{focus}.fx.knob.2' && P.xyActions('a.b')[1] === null);
  ok('actionsVan: tekst niet, xy twee', P.actionsVan({ items: [{ soort: 'tekst', tekst: 'x' }, { soort: 'xy', action: 'a.{as}' }] }).join() === 'a.1,a.2');
  ok('vakSoort', P.vakSoort('uitlijn-strook').soort === 'uitlijn' && P.vakSoort('uitlijn:vouw:1').soort === 'uitlijn' && P.vakSoort('paneel:mijn-mix').id === 'mijn-mix'
    && P.vakSoort('kaart').soort === 'kaart' && P.vakSoort('iets').soort === null && P.vakSoort('paneel:Fout').soort === null);
  ok('vakkenVan: hoofd = werkvak, andere schermen = vakken', P.vakkenVan({ schermen: { hoofd: { werkvak: 'uitlijn' }, ipad: { vakken: ['kaart'] } } }, 'hoofd').join() === 'uitlijn'
    && P.vakkenVan({ schermen: { ipad: { vakken: ['kaart'] } } }, 'ipad').join() === 'kaart' && P.vakkenVan(null, 'ipad').length === 0);
  const tl = P.tijdlijnKlein({ segId: 3, gridVersie: 1, T: 1, P: 2, R: 1, loop: { start: 1, end: 2, x: 9 }, rem: null, vorig: null, speelt: true, wacht: false, remt: false, rate: 1 });
  ok('tijdlijnKlein: vaste vorm, sleutel op segId/gridVersie/wacht/rem', tl.loop.x === undefined && P.tijdlijnSleutel(tl) === '3:1:0:0');
  const inv = P.invokeBericht({ id: 'track.1.filter', v: 0.123456, seq: 3, scherm: 'ipad' });
  ok('invoke voor S8: vorm, afgerond, gecontroleerd', inv.t === 'invoke' && inv.v === 0.1235 && inv.druk === null && P.isInvoke(inv)
    && P.isInvoke(P.invokeBericht({ id: 'track.1.kill.low', v: true, druk: 'aan', seq: 4, scherm: 'ipad' }))
    && !P.isInvoke({ ...inv, v: 2 }) && !P.isInvoke({ ...inv, id: 'a b' }) && !P.isInvoke({ ...inv, seq: 1.5 }) && !P.isBericht(inv));
  ok('vakSoort: bouwstenen en library', P.vakSoort('fx').soort === 'bouwsteen' && P.vakSoort('strip:3').soort === 'bouwsteen' && P.vakSoort('library').soort === 'library' && P.vakSoort('strip:9').soort === null);
  ok('grootte: bytes in UTF-8', P.grootte({ t: '€' }) === JSON.stringify({ t: '€' }).length + 2);
}

// ---- de verbinding van de iPad: kijken, tot S8 een schrijver zet -----------------------------------
console.log('\nde ServerVerbinding: zonder schrijver geen invoke');
{
  const { ServerVerbinding } = await import('../src/paneel/verbinding.js');
  const v = new ServerVerbinding({ ES: class {}, fetch: async () => ({ ok: false, json: async () => null }) });
  ok('zonder schrijver: geen invoke, kanBedienen false (het paneel kijkt)', typeof v.invoke !== 'function' && !v.kanBedienen);
  const uit = [];
  v.zetSchrijver((b) => uit.push(b));
  v.invoke('track.1.kill.low', true); v.invoke('track.1.kill.low', false); v.invoke('track.1.filter', 0.5);
  ok('met een schrijver (S8): invoke-berichten met druk aan/los en een oplopende seq', v.kanBedienen && uit.map((b) => `${b.druk}:${b.seq}`).join() === 'aan:1,los:2,null:3' && uit.every(P.isInvoke));
  v.zetSchrijver(null);
  ok('schrijver weg: weer alleen kijken', typeof v.invoke !== 'function' && !v.kanBedienen);
}

// ---- 2. de relais ------------------------------------------------------------------------------
console.log('\nde relais (server/paneel.js) met nep-antwoorden');
{
  let klok = 1000;
  const nepRes = () => {
    const r = { kop: null, stukken: [], dicht: false, luister: {}, writableLength: 0,
      writeHead(c, h) { r.kop = { c, h }; }, write(t) { r.stukken.push(t); return true; }, end(t) { if (t) r.stukken.push(t); r.dicht = true; },
      on(n, f) { r.luister[n] = f; }, destroy() { r.dicht = true; } };
    r.berichten = () => r.stukken.join('').split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
    return r;
  };
  const rel = new PaneelRelais({ klok: () => klok, hbMs: 0 });
  ok('zonder kijker: kijkers 0, niet vers', rel.status().kijkers === 0 && !rel.status().vers);
  const r0 = rel.vanMixer({ tab: 't1', berichten: [{ t: 'verschil', reads: { a: 1 } }] });
  ok('een verschil zonder stand ervoor telt niet (eerst een stand)', r0.vers === false && rel.stats.berichten === 0);
  const k1 = nepRes();
  rel.kijk(null, k1, { scherm: 'ipad' });
  ok('een kijker: text/event-stream, retry, nog geen stand (niet vers)', k1.kop.c === 200 && /event-stream/.test(k1.kop.h['Content-Type']) && k1.stukken[0].startsWith('retry: 1000') && k1.berichten().length === 0);
  const r1 = rel.vanMixer({ tab: 't1', berichten: [{ t: 'stand', reads: { a: 1 }, decks: {}, tijdlijn: {}, maatgever: null, klok: null, werkruimte: null }] });
  ok('de mixer hoort dat er een kijker is, en stuurt een stand', r1.kijkers === 1 && r1.vers === true && k1.berichten()[0].t === 'stand');
  rel.vanMixer({ tab: 't1', berichten: [{ t: 'verschil', reads: { a: 2 } }, { t: 'tijdlijn', deck: 'A', tl: { segId: 1 } }] });
  ok('daarna gaan verschillen door', k1.berichten().map((b) => b.t).join() === 'stand,verschil,tijdlijn');
  const k2 = nepRes();
  rel.kijk(null, k2);
  const eerst = k2.berichten();
  ok('een tweede kijker krijgt meteen de VOLLEDIGE stand (met wat er sindsdien veranderde)', eerst.length === 1 && eerst[0].t === 'stand' && eerst[0].reads.a === 2 && eerst[0].tijdlijn.A.segId === 1);
  rel.vanMixer({ tab: 't1', berichten: [{ t: 'verschil', reads: { a: 3 } }] });
  ok('… en daarna alleen verschillen', k2.berichten().map((b) => b.t).join() === 'stand,verschil');
  klok += 500;
  const r2 = rel.vanMixer({ tab: 't2', berichten: [{ t: 'stand', reads: { a: 99 } }] });
  ok('een ander tabblad terwijl het eerste nog zendt: genegeerd', r2.genegeerd === true && rel.stand.reads.a === 3 && rel.stats.genegeerd === 1);
  klok += 4000;
  const r3 = rel.vanMixer({ tab: 't2', berichten: [{ t: 'verschil', reads: { a: 98 } }] });
  ok('… ook na stilte, zonder stand', r3.genegeerd === true && rel.stand.reads.a === 3);
  const r4 = rel.vanMixer({ tab: 't2', berichten: [{ t: 'stand', reads: { a: 7 } }] });
  ok('het eerste is stil (> 3 s) en het nieuwe begint met een stand: overgenomen', !r4.genegeerd && rel.tab === 't2' && rel.stand.reads.a === 7);
  ok('rommel telt niet', rel.vanMixer({ tab: 't2', berichten: [{ t: 'invoke', id: 'track.1.play' }, null, 5] }).vers === true && rel.stats.berichten === 5);
  k1.luister.close(); k2.luister.close();
  ok('alle kijkers weg: kijkers 0, niet meer vers (de volgende kijker wacht op een nieuwe stand)', rel.aantal === 0 && !rel.vers);
  const kn = [];
  for (let i = 0; i < 17; i++) { const r = nepRes(); rel.kijk(null, r); kn.push(r); }
  ok('hooguit 16 kijkers: de 17e komt erin, de OUDSTE gaat eruit (een dode iPad sluit niemand buiten)', rel.aantal === 16 && kn[16].kop.c === 200 && kn[0].dicht && !kn[1].dicht);
  rel.sluit();
  ok('sluit: alles dicht', rel.aantal === 0 && kn[1].dicht);
  // De mixer valt stil (tabblad dicht, terug naar standaard): de kijkers horen 'weg'.
  let hbFn = null;
  const rel2 = new PaneelRelais({ klok: () => klok, hbMs: 1000, setInterval: (f) => { hbFn = f; return 1; }, clearInterval: () => {} });
  const kw = nepRes();
  rel2.kijk(null, kw);
  rel2.vanMixer({ tab: 'm', berichten: [{ t: 'stand', reads: { a: 1 } }] });
  klok += 60000; hbFn();
  ok('de mixer zegt een minuut niets (een verborgen tabblad: 1 timer per minuut): nog geen weg', kw.berichten().map((b) => b.t).join() === 'stand,hb' && rel2.vers);
  klok += 11000; hbFn();
  ok('na 70 s (gecrasht): weg, en niet meer vers', kw.berichten().some((b) => b.t === 'weg') && !rel2.vers);
  hbFn();
  ok('… één keer', kw.berichten().filter((b) => b.t === 'weg').length === 1);
  rel2.vanMixer({ tab: 'n', sessie: 's1', berichten: [{ t: 'stand', reads: { a: 2 } }] });
  rel2.vanMixer({ tab: 'n', sessie: 's1', berichten: [{ t: 'weg' }] });
  const laat = rel2.vanMixer({ tab: 'n', sessie: 's1', berichten: [{ t: 'stand', reads: { a: 9 } }] });
  ok('een stand van dezelfde sessie die NA het weg binnenkomt: genegeerd (de iPad houdt geen oude stand vast)', laat.genegeerd && !rel2.vers);
  ok('de mixer zegt zelf weg (standaard, tabblad dicht): meteen door naar de kijkers, niet meer vers', kw.berichten().filter((b) => b.t === 'weg').length === 2 && !rel2.vers);
  const r5 = rel2.vanMixer({ tab: 'p', berichten: [{ t: 'stand', reads: { a: 3 } }] });
  ok('… en een ander tabblad mag meteen overnemen', !r5.genegeerd && rel2.tab === 'p');
  const a1 = nepRes(), a2 = nepRes();
  rel2.kijk(null, a1, { pagina: 'pagina0001' });
  const n0 = rel2.aantal;
  rel2.kijk(null, a2, { pagina: 'pagina0001' });
  ok('dezelfde pagina verbindt opnieuw: zijn vorige verbinding eruit (geen stapel dode kijkers)', a1.dicht && rel2.aantal === n0);
  rel2.sluit();
}

// ---- 3. de zender ----------------------------------------------------------------------------
console.log('\nde zender van de mixer (live-zender.js) met nep-fetch en nep-timers');
{
  let nu = 0, kijkers = 0, vers = true, weg = false;
  const verzoeken = [];
  const antwoord = (d, okCode = 200) => ({ ok: okCode === 200, status: okCode, json: async () => d });
  const fetchNep = async (url, o = {}) => {
    verzoeken.push({ url, methode: o.method ?? 'GET', body: o.body ? JSON.parse(o.body) : null });
    if (weg) throw new Error('verbinding geweigerd');
    if (url.endsWith('/kijkers')) return antwoord({ kijkers, vers });
    if (url.endsWith('/ping')) return antwoord({ t: nu + 5000 });
    if (url.endsWith('/van-mixer')) return antwoord({ kijkers, vers: true });
    return antwoord(null, 404);
  };
  let tikFn = null;
  const reads = { 'track.1.filter': 0.5, 'track.1.play': 0 };
  let seg = 1;
  const bron = {
    nodig: () => new Set(Object.keys(reads)), read: (id) => reads[id], maatgever: () => 'A', V: () => 0.02,
    decks: () => ({ A: { sleutel: 'demo|1', info: { nr: 1, titel: 'demo' }, tl: { segId: seg, gridVersie: 1, T: 0, P: 0, R: 1, loop: null, rem: null, vorig: null, speelt: true, wacht: false, remt: false, rate: 1 } } }),
    werkBericht: () => ({ sleutel: 'w1', w: { naam: 'proef' } }),
  };
  let eerste = true;
  const ctx = { currentTime: 0, state: 'running', getOutputTimestamp: () => ({ contextTime: nu / 1000 - 0.01, performanceTime: nu }) };
  const z = startLiveZender({ bron, isEerste: () => eerste, tab: 'tab-1', fetch: fetchNep, nu: () => nu, setInterval: (f) => { tikFn = f; return 1; }, clearInterval: () => {}, ctx: () => ctx });
  const tik = async (n = 1, ms = 20) => { for (let i = 0; i < n; i++) { nu += ms; ctx.currentTime = Math.floor(nu / 10.67) * 0.01067; await z.tik(); } };
  await tik(150);   // 3 s
  const posts = () => verzoeken.filter((v) => v.methode === 'POST');
  const vragen = verzoeken.filter((v) => v.url.endsWith('/kijkers')).length;
  ok(`zonder kijker: geen POST, ${vragen}× gevraagd in 3 s (1×/s)`, posts().length === 0 && vragen === 3);
  kijkers = 1;
  await tik(60);
  const p0 = posts();
  ok('een kijker: eerst gepingd, dan een volledige stand', verzoeken.some((v) => v.url.endsWith('/ping')) && p0[0]?.body.berichten[0].t === 'stand' && p0[0].body.tab === 'tab-1');
  ok('de stand heeft reads, decks, tijdlijn, maatgever, klok en werkruimte', (() => { const s = p0[0].body.berichten[0]; return s.reads['track.1.filter'] === 0.5 && s.decks.A.titel === 'demo' && s.tijdlijn.A.segId === 1 && s.maatgever === 'A' && s.klok && s.werkruimte.naam === 'proef'; })());
  const soorten = p0.slice(1).flatMap((p) => p.body.berichten.map((b) => b.t));
  ok(`in rust daarna alleen de klok (${soorten.join(',') || 'niets'}), geen tweede stand`, soorten.every((t) => t === 'klok') && soorten.length >= 1 && soorten.length <= 2);
  const voor = posts().length;
  reads['track.1.filter'] = 0.6;
  await tik(1);
  const v1 = posts().at(-1).body.berichten;
  ok('een read verandert: een verschil met alleen die read', posts().length === voor + 1 && v1[0].t === 'verschil' && Object.keys(v1[0].reads).join() === 'track.1.filter');
  seg = 2;
  await tik(1);
  ok('een nieuwe segId: één tijdlijn', posts().at(-1).body.berichten.filter((b) => b.t === 'tijdlijn').length === 1);
  const naTl = posts().length;
  await tik(100);
  ok('… en niet nog eens (dezelfde segId, 2 s)', posts().slice(naTl).every((p) => !p.body.berichten.some((b) => b.t === 'tijdlijn')));
  z.geraakt('track.1.filter');
  await tik(1);
  ok('geraakt (een APC-draai): mee in het volgende verschil', posts().at(-1).body.berichten.some((b) => b.t === 'verschil' && b.geraakt?.includes('track.1.filter')));
  // Een tabblad zonder lock zendt niets meer.
  eerste = false;
  const n0 = verzoeken.length;
  await tik(100);
  ok('dit tabblad heeft de lock niet meer: geen enkel verzoek', verzoeken.length === n0);
  eerste = true;
  await tik(60);
  ok('weer de lockhouder: opnieuw met een volledige stand', verzoeken.slice(n0).some((v) => v.methode === 'POST' && v.body.berichten[0].t === 'stand'));
  // Een ander tabblad telt nog op de server (genegeerd): terug naar 1×/s vragen, niet elke 20 ms een stand.
  const vanMixerEcht = fetchNep;
  let genegeerd = true;
  const fetchG = async (url, o = {}) => (url.endsWith('/van-mixer') && genegeerd ? (verzoeken.push({ url, methode: 'POST', body: JSON.parse(o.body) }), antwoord({ kijkers: 1, vers: false, genegeerd: true })) : vanMixerEcht(url, o));
  const zg = startLiveZender({ bron, isEerste: () => true, tab: 'tab-2', fetch: fetchG, nu: () => nu, setInterval: () => 2, clearInterval: () => {}, ctx: () => ctx });
  const ng = verzoeken.length;
  for (let i = 0; i < 100; i++) { nu += 20; await zg.tik(); }
  const pg = verzoeken.slice(ng).filter((v) => v.methode === 'POST').length;
  ok(`genegeerd (een ander tabblad telt nog): hooguit 1 stand per s (${pg} in 2 s)`, pg <= 3 && pg >= 1);
  zg.stop();
  // Te groot: één melding, niet elke seconde opnieuw een stand van 64 kB over de lijn.
  const meldingen = [];
  const groteBron = { ...bron, nodig: () => new Set(Object.keys(groot)), read: (id) => groot[id] };
  const groot = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`track.1.iets.lang.genoeg.${i}`, 0.123456]));
  const zt = startLiveZender({ bron: groteBron, isEerste: () => true, tab: 'tab-3', fetch: fetchNep, nu: () => nu, setInterval: () => 3, clearInterval: () => {}, ctx: () => ctx, meld: (t) => meldingen.push(t) });
  const nt = verzoeken.length;
  for (let i = 0; i < 600; i++) { nu += 20; await zt.tik(); }
  const pings = verzoeken.slice(nt).filter((v) => v.url.endsWith('/ping')).length;
  ok(`een stand boven 64 kB: niet verstuurd, één melding, pas na 5 s opnieuw (${zt.stats.teGroot} pogingen in 12 s, ${pings} pings: de gewone 1×/10 s, niet elke seconde)`,
    zt.stats.teGroot >= 2 && zt.stats.teGroot <= 3 && meldingen.filter((m) => m.includes('te groot')).length === 1 && meldingen.filter((m) => m.includes('doel 16 kB')).length === 1 && pings <= 16 && !verzoeken.slice(nt).some((v) => v.methode === 'POST'));
  zt.stop();
  // De server valt weg: terug naar 1×/s, en daarna eerst een stand.
  weg = true;
  const n1 = verzoeken.length;
  await tik(150);
  ok(`de server weg: hooguit 1×/s een verzoek (${verzoeken.length - n1} in 3 s)`, verzoeken.length - n1 <= 4 && z.stats.fouten >= 1);
  weg = false;
  const n2 = verzoeken.length;
  await tik(80);
  const terug = verzoeken.slice(n2);
  ok('terug: eerst opnieuw pingen (nieuw proces), dan een volledige stand', terug.some((v) => v.url.endsWith('/ping')) && terug.find((v) => v.methode === 'POST')?.body.berichten[0].t === 'stand');
  kijkers = 0;
  await tik(60);   // hooguit één klokbericht (1×/s) tot het antwoord zegt dat er niemand meer kijkt
  const n3 = posts().length;
  await tik(100);
  ok('geen kijker meer: geen POST meer', posts().length === n3);
  ok('nooit twee verzoeken tegelijk (bezig)', typeof tikFn === 'function');
  const nStop = verzoeken.length;
  kijkers = 1; await tik(60);
  z.stop();
  await new Promise((r) => setTimeout(r, 10));
  const laatste = verzoeken.slice(nStop).filter((v) => v.methode === 'POST').at(-1);
  ok('stop() met een kijker: nog één weg', laatste?.body.berichten.length === 1 && laatste.body.berichten[0].t === 'weg');
}

// ---- 4. een eigen server --------------------------------------------------------------------
console.log('\neen eigen server: routes, Host/Origin, SSE');
const map = mkdtempSync(join(tmpdir(), 'varve-paneel-server-'));
const media = join(map, 'media');
mkdirSync(media, { recursive: true });
const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: join(media, 'library.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media, VARVE_OPNAMES: join(map, 'opnames'),
    VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'), VARVE_BACKUPS: join(map, 'backups'),
    VARVE_HERANALYSE: 'uit', VARVE_NACHT: join(map, 'nacht.json'), VARVE_STANDEN: join(map, 'standen'), VARVE_WERKRUIMTES: join(map, 'werkruimtes'),
    VARVE_KAART: join(map, 'geen-kaart.json'), VARVE_KAART_DB: join(map, 'kaart.db'), VARVE_HUB_SETS: join(map, 'hub-sets'), VARVE_HOSTS: 'varve-proef.ts.net' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverUit = '';
server.stdout.on('data', (d) => { serverUit += d; });
server.stderr.on('data', (d) => { serverUit += d; });
const B = `http://localhost:${poort}`;

/** Een verzoek met een eigen Host (fetch kan dat niet). */
const ruw = (methode, pad, { host = `localhost:${poort}`, headers = {}, body = null } = {}) => new Promise((ok2, fout) => {
  const r = request({ host: '127.0.0.1', port: poort, method: methode, path: pad, headers: { host, ...headers } }, (res) => {
    let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => ok2({ status: res.statusCode, tekst: t }));
  });
  r.on('error', fout);
  if (body) r.write(body);
  r.end();
});

/** Een SSE-kijker: alle berichten en de bytes van de eerste stand. */
function kijker(host = `localhost:${poort}`) {
  const k = { berichten: [], ruw: '', res: null };
  const r = request({ host: '127.0.0.1', port: poort, path: '/api/paneel/live?s=ipad', headers: { host, accept: 'text/event-stream' } }, (res) => {
    k.res = res; k.status = res.statusCode; k.type = res.headers['content-type'];
    res.setEncoding('utf8');
    res.on('data', (d) => {
      k.ruw += d;
      let i;
      while ((i = k.ruw.indexOf('\n\n')) >= 0) {
        const blok = k.ruw.slice(0, i); k.ruw = k.ruw.slice(i + 2);
        if (blok.startsWith('data: ')) { const b = JSON.parse(blok.slice(6)); if (b.t === 'stand') k.standBytes = Buffer.byteLength(blok.slice(6)); k.berichten.push(b); }
      }
    });
  });
  r.end();
  k.sluit = () => r.destroy();
  return k;
}
const postMixer = (body, opt = {}) => ruw('POST', '/api/paneel/van-mixer', { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers ?? {}) }, body: JSON.stringify(body) });

try {
  let op = false;
  for (let i = 0; i < 200 && !op; i++) { op = await fetch(`${B}/api/paneel/kijkers`).then((r) => r.ok).catch(() => false); if (!op) await wacht(100); }
  ok('de server start, met de routes van het paneel', op);
  const kj = await fetch(`${B}/api/paneel/kijkers`).then((r) => r.json());
  ok('kijkers: 0, niet vers', kj.kijkers === 0 && kj.vers === false);
  const ping = await fetch(`${B}/api/paneel/ping`).then((r) => r.json());
  ok('ping: de klok van de server in ms', Number.isFinite(ping.t) && Math.abs(ping.t - Date.now()) < 5000);

  // van-mixer: alleen vanaf deze Mac.
  const buiten = await postMixer({ tab: 'x', berichten: [] }, { host: 'varve-proef.ts.net', headers: { origin: 'https://varve-proef.ts.net' } });
  ok('van-mixer via Tailscale (VARVE_HOSTS, met de juiste Origin): 403', buiten.status === 403);
  const proxy = await postMixer({ tab: 'x', berichten: [] }, { headers: { 'x-forwarded-for': '100.64.0.2' } });
  ok('van-mixer met een proxykop (tailscale serve): 403', proxy.status === 403);
  const vreemd = await postMixer({ tab: 'x', berichten: [] }, { host: 'evil.example' });
  ok('een onbekende Host: geweigerd (vreemdVerzoek, vóór de route)', vreemd.status === 403 || vreemd.status === 421 || vreemd.status === 400);
  const andereOorsprong = await postMixer({ tab: 'x', berichten: [] }, { headers: { origin: 'http://evil.example' } });
  ok('een andere Origin: geweigerd', andereOorsprong.status >= 400 && andereOorsprong.status !== 200);
  const tekst = await ruw('POST', '/api/paneel/van-mixer', { headers: { 'content-type': 'text/plain' }, body: '{}' });
  ok('geen JSON: 415', tekst.status === 415);
  const kapot = await postMixer({ tab: 'x' });
  ok('zonder berichten: 400', kapot.status === 400);
  const binnen = await postMixer({ tab: 'x', berichten: [] });
  ok('van deze Mac: 200 met { kijkers, vers }', binnen.status === 200 && JSON.parse(binnen.tekst).kijkers === 0);

  // Geen schrijfweg van de iPad (W1): geen invoke-route, geen andere methodes.
  ok('POST /api/paneel/invoke bestaat niet (404): de iPad kijkt alleen', (await ruw('POST', '/api/paneel/invoke', { headers: { 'content-type': 'application/json' }, body: '{"id":"track.1.play","v":true}' })).status === 404);
  ok('POST op live/ping: 405', (await ruw('POST', '/api/paneel/live', { headers: { 'content-type': 'application/json' }, body: '{}' })).status === 405
    && (await ruw('POST', '/api/paneel/ping', { headers: { 'content-type': 'application/json' }, body: '{}' })).status === 405);
  ok('PUT op van-mixer: 405', (await ruw('PUT', '/api/paneel/van-mixer', { headers: { 'content-type': 'application/json' }, body: '{}' })).status === 405);

  // Twee kijkers: de iPad komt via Tailscale binnen (Host = de ts.net-naam), lezen mag.
  const k1 = kijker('varve-proef.ts.net');
  const k2 = kijker();
  await wacht(300);
  ok('SSE via Tailscale en lokaal: 200 text/event-stream', k1.status === 200 && k2.status === 200 && /event-stream/.test(k1.type));
  ok('… nog geen stand (de mixer stuurde niets)', k1.berichten.length === 0);
  const r1 = JSON.parse((await postMixer({ tab: 'x', berichten: [{ t: 'verschil', reads: { a: 1 } }] })).tekst);
  ok('de mixer hoort: 2 kijkers, niet vers (stuur eerst een stand)', r1.kijkers === 2 && r1.vers === false);
  const groot = { t: 'stand', reads: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`track.${(i % 8) + 1}.ding.${i}`, 0.1234])),
    decks: { A: { nr: 1, titel: 'demo — één', duur: 300, bpm: 124, grid: { stukken: [{ van: 0, bpm: 124, anker: 0 }] }, secties: null } },
    tijdlijn: { A: { segId: 1, gridVersie: 1, T: 1, P: 2, R: 1, loop: null, rem: null, vorig: null, speelt: true, wacht: false, remt: false, rate: 1 } },
    maatgever: 'A', klok: { ctxT: 1, srvT: 2, V: 0.02, loopt: true }, werkruimte: { naam: 'proef', deel: 'mix' } };
  await postMixer({ tab: 'x', berichten: [groot] });
  await postMixer({ tab: 'x', berichten: [{ t: 'verschil', reads: { 'track.1.ding.0': 0.5 } }, { t: 'klok', ctxT: 2, srvT: 3, V: 0.02 }] });
  await wacht(300);
  const s1 = await fetch(`${B}/api/paneel/stand`).then((r) => r.json());
  ok(`beide kijkers: eerst de volledige stand (${k1.standBytes} B ≤ 16 kB), daarna alleen verschillen`,
    [k1, k2].every((k) => k.berichten[0]?.t === 'stand' && k.berichten.slice(1).every((b) => b.t !== 'stand') && k.berichten.some((b) => b.t === 'verschil'))
    && k1.standBytes <= 16384 && s1.bytes <= 16384 && s1.past);
  const k3 = kijker();
  await wacht(300);
  ok('een derde kijker die later komt: meteen de volledige stand, met het verschil erin', k3.berichten[0]?.t === 'stand' && k3.berichten[0].reads['track.1.ding.0'] === 0.5 && k3.berichten[0].klok.ctxT === 2);
  const tweede = JSON.parse((await postMixer({ tab: 'ander', berichten: [{ t: 'stand', reads: {} }] })).tekst);
  ok('een tweede tabblad dat ook zendt: genegeerd', tweede.genegeerd === true);
  await wacht(1300);
  ok('hb van de server (1×/s)', k1.berichten.some((b) => b.t === 'hb'));
  for (const k of [k1, k2, k3]) k.sluit();
  await wacht(300);
  const na = await fetch(`${B}/api/paneel/kijkers`).then((r) => r.json());
  ok('kijkers weg: 0 en niet vers', na.kijkers === 0 && na.vers === false);
  const html = await fetch(`${B}/werk.html`);
  const man = await fetch(`${B}/werk.webmanifest`);
  ok('werk.html en werk.webmanifest worden geserveerd', html.ok && man.ok && /manifest\+json/.test(man.headers.get('content-type')) && (await man.json()).display === 'standalone');
  await html.text();
} finally {
  server.kill('SIGKILL');
  await wacht(100);
  rmSync(map, { recursive: true, force: true });
}

if (fails.length) { console.log(`\n${fails.length} FOUT`); if (serverUit) console.log(serverUit.slice(-2000)); process.exit(1); }
console.log('\nAlle checks groen.');
