// De zeven browser-instellingen: server eerst, localStorage als reserve
// (src/ui/instellingen-opslag.js, extra-3 B4). Tegen een nagebouwde server die
// net zo streng is als de echte (witte lijst, tekst of null), en aan het eind
// één ronde tegen de echte server op een eigen poort met een tijdelijke db.
// Draai met: node test/instellingen-opslag.test.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const io = await import('../src/ui/instellingen-opslag.js');
const { maakInstellingenOpslag, INSTELLING_SLEUTELS, ONVERZONDEN, VORIGE, VORIGE_MAX } = io;

const fails = [];
const ok = (naam, cond, info = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (!cond && info ? `  (${info})` : '')); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));

/** localStorage zoals Chrome: alleen tekst. */
function nepOpslag(begin = {}) {
  const m = new Map(Object.entries(begin));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    get size() { return m.size; },
    alles: () => Object.fromEntries(m),
  };
}

/** De server: zelfde regels als server/index.js. `stand`: 'ok' | 'weg' | 'fout' | 'hangt'. */
function nepServer(begin = {}) {
  const db = new Map(Object.entries(begin));
  const s = { db, stand: 'ok', puts: [], gets: 0 };
  const antw = (status, j) => ({ ok: status >= 200 && status < 300, status, json: async () => j });
  s.haal = async (pad, init = {}) => {
    if (s.stand === 'weg') throw new TypeError('Failed to fetch');
    if (s.stand === 'hangt') return new Promise((_, nee) => init.signal?.addEventListener('abort', () => nee(Object.assign(new Error('afgebroken'), { name: 'AbortError' }))));
    if (s.stand === 'fout') return antw(500, { fout: 'kapot' });
    const methode = init.method || 'GET';
    if (pad === '/api/instellingen' && methode === 'GET') {
      s.gets++;
      // Een server die meer teruggeeft dan de lijst: de opslag neemt alleen de lijst over.
      return antw(200, { instellingen: { ...Object.fromEntries(db), 'varve.iets.anders': 'nee' } });
    }
    const m = /^\/api\/instellingen\/([^/]+)$/.exec(pad);
    if (!m) return antw(404, {});
    const k = decodeURIComponent(m[1]);
    if (!INSTELLING_SLEUTELS.includes(k)) return antw(400, { fout: 'onbekende instelling' });
    if (methode === 'PUT') {
      if (init.headers?.['Content-Type'] !== 'application/json') return antw(415, {});
      const b = JSON.parse(init.body);
      if (!('waarde' in b) || (b.waarde !== null && typeof b.waarde !== 'string')) return antw(400, {});
      s.puts.push([k, b.waarde]);
      db.set(k, b.waarde);
      return antw(200, { ok: true });
    }
    return antw(405, {});
  };
  return s;
}

const RACK = '{"naam":"Warm","herkomst":"s:2"}';

// ==========================================================================
console.log('server gevuld: de browser volgt de server');
{
  const srv = nepServer({ 'varve.master.rack': RACK, 'varve.koptelefoon.omgewisseld': '1', 'varve.vormen': null });
  const opslag = nepOpslag({ 'varve.koptelefoon.omgewisseld': '0', 'varve.vormen': '1', 'varve.klankschaal.open': '1' });
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 5 });
  const v = await o.start();
  ok('één verzoek voor alle zeven', srv.gets === 1);
  ok('bereikbaar, drie van de server', v.serverBereikbaar && v.vanServer.length === 3 && v.omhoog.length === 0, JSON.stringify(v));
  ok('lege browser: de serverwaarde staat nu in localStorage', opslag.getItem('varve.master.rack') === RACK);
  ok('verschil: de SERVER wint (0 in de browser wordt 1)', opslag.getItem('varve.koptelefoon.omgewisseld') === '1');
  ok('op de server gewist (null): ook uit de browser', opslag.getItem('varve.vormen') === null);
  ok('een sleutel buiten de lijst blijft staan en gaat niet mee', opslag.getItem('varve.klankschaal.open') === '1' && opslag.getItem('varve.iets.anders') === null);
  ok('niets omhoog geschreven', srv.puts.length === 0);
}

// ==========================================================================
console.log('\nlege server, gevulde browser: één keer omhoog');
{
  const srv = nepServer();
  const opslag = nepOpslag({ 'varve.master.rack': RACK, 'varve.klankschaal': '{"volgen":"maat"}', 'varve.stems.standaard': '4', 'varve.log.altijd': '1' });
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 5 });
  const v = await o.start();
  ok('drie sleutels omhoog, in de volgorde van de lijst', JSON.stringify(v.omhoog) === JSON.stringify(['varve.master.rack', 'varve.klankschaal', 'varve.stems.standaard']), JSON.stringify(v.omhoog));
  ok('de server heeft precies wat de browser had', srv.db.get('varve.master.rack') === RACK && srv.db.get('varve.stems.standaard') === '4' && srv.db.get('varve.klankschaal') === '{"volgen":"maat"}');
  ok('een gemak-sleutel (log.altijd) niet', !srv.db.has('varve.log.altijd') && srv.puts.length === 3);
  ok('niets meer als onverzonden gemarkeerd', opslag.getItem(ONVERZONDEN) === null);
  // Tweede start (herladen): de server is nu gevuld, dus niets meer omhoog.
  const v2 = await maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 5 }).start();
  ok('herladen: niets meer omhoog (eenmalig)', v2.omhoog.length === 0 && srv.puts.length === 3 && v2.vanServer.length === 3);
  // Een tweede browser (lege localStorage) krijgt het nu van de server.
  const ander = nepOpslag();
  await maakInstellingenOpslag({ haal: srv.haal, opslag: ander, wacht: 5 }).start();
  ok('een nieuwe browser (nieuw Chrome-profiel) krijgt master-rack en klankschaal terug', ander.getItem('varve.master.rack') === RACK && ander.getItem('varve.klankschaal') === '{"volgen":"maat"}');
  ok('…zonder iets terug te schrijven', srv.puts.length === 3);
}

// ==========================================================================
console.log('\nlege server, lege browser');
{
  const srv = nepServer();
  const opslag = nepOpslag();
  const v = await maakInstellingenOpslag({ haal: srv.haal, opslag }).start();
  ok('niets te doen', v.serverBereikbaar && v.vanServer.length === 0 && v.omhoog.length === 0 && srv.puts.length === 0 && opslag.size === 0);
}

// ==========================================================================
console.log('\nserver weg: de browser is de reserve');
for (const stand of ['weg', 'fout', 'hangt']) {
  const srv = nepServer({ 'varve.master.rack': 'ANDERS' });
  srv.stand = stand;
  const opslag = nepOpslag({ 'varve.master.rack': RACK, 'varve.beeld.adres': 'ws://clayk:7702/app' });
  const t0 = Date.now();
  const v = await maakInstellingenOpslag({ haal: srv.haal, opslag, tijdslimiet: 60 }).start();
  ok(`${stand}: start gooit niet, zegt dat de server er niet is`, v.serverBereikbaar === false && typeof v.fout === 'string', JSON.stringify(v));
  ok(`${stand}: de browser blijft wat hij was`, opslag.getItem('varve.master.rack') === RACK && opslag.getItem('varve.beeld.adres') === 'ws://clayk:7702/app');
  if (stand === 'hangt') ok('hangt: na de tijdslimiet door (de mixer laadt)', Date.now() - t0 < 1000 && v.fout === 'geen antwoord');
}
{
  const v = await maakInstellingenOpslag({ haal: null, opslag: nepOpslag() }).start();
  ok('zonder haal (Node, file://): niets, geen fout', v.serverBereikbaar === false && !v.fout);
}

// ==========================================================================
console.log('\nschrijven: browser meteen, server kort daarna, één keer');
{
  const srv = nepServer();
  const opslag = nepOpslag();
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 20 });
  await o.start();
  o.schrijf('varve.beeld.latentie', 10);
  ok('localStorage meteen, als tekst', opslag.getItem('varve.beeld.latentie') === '10');
  ok('nog niet naar de server (wacht)', srv.puts.length === 0);
  ok('tot hij er is: als onverzonden gemarkeerd', JSON.parse(opslag.getItem(ONVERZONDEN)).includes('varve.beeld.latentie'));
  o.schrijf('varve.beeld.latentie', 20);
  o.schrijf('varve.beeld.latentie', 30);
  await wacht(60); await o.klaar();
  ok('een schuif van drie stappen: één PUT met de laatste', srv.puts.length === 1 && srv.puts[0][1] === '30', JSON.stringify(srv.puts));
  ok('afgevinkt', opslag.getItem(ONVERZONDEN) === null);
  o.spiegel('varve.beeld.latentie', '30');
  await wacht(40); await o.klaar();
  ok('dezelfde waarde nog eens: geen PUT', srv.puts.length === 1);
  o.wis('varve.beeld.latentie');
  await o.klaar();
  ok('wissen: uit de browser, null op de server', opslag.getItem('varve.beeld.latentie') === null && srv.db.get('varve.beeld.latentie') === null && srv.puts.length === 2);
  o.schrijf('varve.klankschaal.open', '1');
  await wacht(40); await o.klaar();
  ok('een sleutel buiten de lijst: wel de browser, niet de server', opslag.getItem('varve.klankschaal.open') === '1' && srv.puts.length === 2);
}

// ==========================================================================
console.log('\nniet aangekomen: de browser wint bij de volgende start');
{
  const srv = nepServer({ 'varve.master.rack': 'OUD' });
  const opslag = nepOpslag();
  const meldingen = [];
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 5, meld: (t, s) => meldingen.push([t, s]) });
  await o.start();
  ok('begin: de oude serverwaarde', opslag.getItem('varve.master.rack') === 'OUD');
  srv.stand = 'weg';
  o.schrijf('varve.master.rack', RACK);
  o.schrijf('varve.klankschaal', '{"a":1}');
  await wacht(30); await o.klaar();
  ok('één melding, ook bij twee mislukte sleutels', meldingen.length === 1 && meldingen[0][1] === 'fout' && /niet op de server bewaard/.test(meldingen[0][0]), JSON.stringify(meldingen));
  ok('beide als onverzonden gemarkeerd', JSON.stringify(JSON.parse(opslag.getItem(ONVERZONDEN)).sort()) === JSON.stringify(['varve.klankschaal', 'varve.master.rack']));
  // De server komt terug, met nog de OUDE waarde; deze browser heeft de nieuwe.
  srv.stand = 'ok';
  const v = await maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 5 }).start();
  ok('volgende start: de onverzonden sleutels gaan omhoog', v.omhoog.includes('varve.master.rack') && v.omhoog.includes('varve.klankschaal'), JSON.stringify(v));
  ok('de oude serverwaarde overschreef je laatste keuze NIET', opslag.getItem('varve.master.rack') === RACK && srv.db.get('varve.master.rack') === RACK);
  ok('daarna niets meer onverzonden', opslag.getItem(ONVERZONDEN) === null);
}
{
  // Onverzonden, maar de server heeft intussen al dezelfde waarde (een andere weg): alleen afvinken.
  const srv = nepServer({ 'varve.vormen': '1' });
  const opslag = nepOpslag({ 'varve.vormen': '1', [ONVERZONDEN]: JSON.stringify(['varve.vormen', 'varve.niet.op.de.lijst']) });
  const v = await maakInstellingenOpslag({ haal: srv.haal, opslag }).start();
  ok('onverzonden maar gelijk: geen PUT, afgevinkt, de rommel in de lijst genegeerd', srv.puts.length === 0 && v.omhoog.length === 0 && opslag.getItem(ONVERZONDEN) === null);
}
{
  // Een kapotte onverzonden-lijst in de browser: gewoon verder.
  const srv = nepServer({ 'varve.vormen': '1' });
  const opslag = nepOpslag({ [ONVERZONDEN]: '{kapot' });
  const v = await maakInstellingenOpslag({ haal: srv.haal, opslag }).start();
  ok('kapotte lijst: genegeerd, de server wint', v.serverBereikbaar && opslag.getItem('varve.vormen') === '1');
}
{
  // Een opslag die gooit (geblokkeerde sitedata): niets gooit door.
  const gooit = { getItem() { throw new Error('geblokkeerd'); }, setItem() { throw new Error('geblokkeerd'); }, removeItem() { throw new Error('geblokkeerd'); } };
  const srv = nepServer({ 'varve.vormen': '1' });
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag: gooit, wacht: 1 });
  let goed = true;
  try { await o.start(); o.schrijf('varve.vormen', '0'); await o.klaar(); } catch (_) { goed = false; }
  ok('geblokkeerde localStorage: start en schrijven gooien niet', goed);
}

{
  // De server antwoordde niet bij het opstarten; het master-paneel schrijft zijn standaard-rack weg.
  const srv = nepServer({ 'varve.master.rack': RACK });
  srv.stand = 'hangt';
  const opslag = nepOpslag();   // nieuw Chrome-profiel
  const meldingen = [];
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 1, tijdslimiet: 40, meld: (t) => meldingen.push(t) });
  await o.start();
  srv.stand = 'ok';             // nu antwoordt hij wel (hij was alleen traag)
  o.schrijf('varve.master.rack', '{"naam":"Filter"}');
  o.schrijf('varve.klankschaal', '{}');
  await wacht(20); await o.klaar();
  ok('server niet gelezen: niets naar de server, ook als hij later wel antwoordt', srv.puts.length === 0 && srv.db.get('varve.master.rack') === RACK);
  ok('…wel in de browser, en niet als onverzonden gemarkeerd', opslag.getItem('varve.master.rack') === '{"naam":"Filter"}' && opslag.getItem(ONVERZONDEN) === null);
  ok('…één melding', meldingen.length === 1 && /niet van de server gelezen/.test(meldingen[0]), JSON.stringify(meldingen));
  ok('…die niet meer "herlaad om te bewaren" zegt, maar wat er bij de volgende start gebeurt', !/herlaad om/.test(meldingen[0]) && /volgende start neemt de server/.test(meldingen[0]) && /vorige/.test(meldingen[0]));
  await maakInstellingenOpslag({ haal: srv.haal, opslag }).start();
  ok('volgende start: het echte rack van de server komt terug (niet overschreven)', opslag.getItem('varve.master.rack') === RACK && srv.db.get('varve.master.rack') === RACK
    && !srv.puts.some(([k]) => k === 'varve.master.rack'), JSON.stringify([opslag.alles(), srv.puts]));
  ok('…en het standaard-rack van die sessie staat bij vorige', JSON.parse(opslag.getItem(VORIGE))['varve.master.rack'][0].waarde === '{"naam":"Filter"}');
  ok('…en wat de server nooit had (klankschaal) gaat dan gewoon één keer omhoog', JSON.stringify(srv.puts) === JSON.stringify([['varve.klankschaal', '{}']]));
}

// ==========================================================================
console.log('\nherstelronde 1: nooit een afwijkende browserwaarde zonder kopie weg');
{
  // Review fix 1: eerst opent een vers profiel (de pc, een tweede Chrome-profiel) de mixer
  // tegen een lege server; het master-paneel schrijft bij de eerste frame zijn standaard-rack.
  const srv = nepServer();
  const vers = nepOpslag();
  const ov = maakInstellingenOpslag({ haal: srv.haal, opslag: vers, wacht: 1 });
  await ov.start();
  ov.schrijf('varve.master.rack', 'STANDAARD');
  ov.schrijf('varve.klankschaal', '{}');
  await wacht(10); await ov.klaar();
  ok('het verse profiel zette zijn standaard op de server', srv.db.get('varve.master.rack') === 'STANDAARD');
  // Daarna start Clay's eigen Chrome, met zijn echte rack en klankschaal.
  const KLANK = '{"volgen":"maat","band":3}';
  const clay = nepOpslag({ 'varve.master.rack': RACK, 'varve.klankschaal': KLANK, 'varve.vormen': '1' });
  const meldingen = [];
  const oc = maakInstellingenOpslag({ haal: srv.haal, opslag: clay, wacht: 1, meld: (t, soort) => meldingen.push([t, soort]) });
  const v = await oc.start();
  ok('de server wint nog steeds (zoals ontworpen)', clay.getItem('varve.master.rack') === 'STANDAARD' && clay.getItem('varve.klankschaal') === '{}');
  const vorige = JSON.parse(clay.getItem(VORIGE) || '{}');
  ok('maar Clay\'s echte rack staat bewaard in varve.instellingen.vorige', vorige['varve.master.rack']?.[0]?.waarde === RACK && vorige['varve.master.rack'][0].bron === 'browser'
    && typeof vorige['varve.master.rack'][0].tijd === 'string', clay.getItem(VORIGE));
  ok('…en zijn klankschaal ook', vorige['varve.klankschaal']?.[0]?.waarde === KLANK);
  ok('een sleutel die de server nooit had (vormen) gaat gewoon omhoog, niets bewaard', !vorige['varve.vormen'] && srv.db.get('varve.vormen') === '1');
  ok('het verslag noemt de bewaarde sleutels', JSON.stringify(v.bewaard) === JSON.stringify(['varve.master.rack', 'varve.klankschaal']), JSON.stringify(v));
  ok('één melding (info), die zegt waar het staat', meldingen.length === 1 && meldingen[0][1] !== 'fout' && /master\.rack, klankschaal/.test(meldingen[0][0]) && /instellingen\.herstel/.test(meldingen[0][0]), JSON.stringify(meldingen));
  ok('de opslag laat het ook zien (vorige())', oc.vorige()['varve.master.rack'][0].waarde === RACK);
  // Terugzetten: in de browser en op de server; wat er stond gaat zelf naar vorige.
  const h = await oc.herstel('varve.master.rack');
  ok('herstel: browser en server weer het echte rack', h.ok && h.opServer && clay.getItem('varve.master.rack') === RACK && srv.db.get('varve.master.rack') === RACK, JSON.stringify(h));
  ok('…en het standaard-rack staat nu bij vorige (terug te draaien)', oc.vorige()['varve.master.rack'][0].waarde === 'STANDAARD' && oc.vorige()['varve.master.rack'][0].bron === 'herstel'
    && oc.vorige()['varve.master.rack'][1].waarde === RACK);
  ok('…niets onverzonden', clay.getItem(ONVERZONDEN) === null);
  ok('herstel van iets dat er niet is: nee, geen gooien', (await oc.herstel('varve.beeld.adres')).ok === false && (await oc.herstel('varve.mapping')).ok === false);
  meldingen.length = 0;
  const v2 = await maakInstellingenOpslag({ haal: srv.haal, opslag: clay, meld: (t) => meldingen.push(t) }).start();
  ok('volgende start: gelijk aan de server, niets bewaard, geen melding', v2.bewaard.length === 0 && meldingen.length === 0 && clay.getItem('varve.master.rack') === RACK);
}
{
  // Review fix 2: de start mislukt, Clay stelt in deze sessie iets in, en herlaadt.
  const srv = nepServer({ 'varve.master.rack': 'OUD' });
  const opslag = nepOpslag({ 'varve.master.rack': 'OUD' });
  srv.stand = 'hangt';
  const meldingen = [];
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 1, tijdslimiet: 30, meld: (t) => meldingen.push(t) });
  const v = await o.start();
  ok('mislukte start meldt het meteen zelf (niet pas bij de eerste schrijfactie)', meldingen.length === 1 && /niet van de server gelezen/.test(meldingen[0]) && /geen antwoord/.test(meldingen[0]) && v.fout === 'geen antwoord');
  o.schrijf('varve.master.rack', 'NIEUW');
  await o.klaar();
  ok('…en niet nog eens bij het schrijven', meldingen.length === 1);
  srv.stand = 'ok';
  await maakInstellingenOpslag({ haal: srv.haal, opslag }).start();
  ok('herladen: de server neemt het over', opslag.getItem('varve.master.rack') === 'OUD' && srv.db.get('varve.master.rack') === 'OUD');
  ok('…en de sessiewaarde NIEUW is terug te vinden', JSON.parse(opslag.getItem(VORIGE))['varve.master.rack'][0].waarde === 'NIEUW');
}
{
  // Review fix 6: een oude onverzonden-vlag wint, maar de nieuwere serverwaarde gaat eerst naar vorige.
  const srv = nepServer({ 'varve.klankschaal': 'VAN-DE-PC' });
  const opslag = nepOpslag({ 'varve.klankschaal': 'WEKEN-OUD', [ONVERZONDEN]: JSON.stringify(['varve.klankschaal']) });
  const v = await maakInstellingenOpslag({ haal: srv.haal, opslag }).start();
  ok('onverzonden wint nog steeds', srv.db.get('varve.klankschaal') === 'WEKEN-OUD' && v.omhoog.includes('varve.klankschaal'));
  const vg = JSON.parse(opslag.getItem(VORIGE))['varve.klankschaal'];
  ok('…maar de vervangen serverwaarde staat bij vorige (bron server)', vg[0].waarde === 'VAN-DE-PC' && vg[0].bron === 'server' && v.bewaard.includes('varve.klankschaal'));
}
{
  // Hooguit VORIGE_MAX per sleutel, nieuwste eerst, geen dubbele.
  const srv = nepServer();
  const opslag = nepOpslag();
  for (let i = 0; i < VORIGE_MAX + 3; i++) {
    srv.db.set('varve.vormen', 'S');
    opslag.setItem('varve.vormen', i % 2 ? 'B' : `B${i}`);
    await maakInstellingenOpslag({ haal: srv.haal, opslag }).start();
  }
  const l = JSON.parse(opslag.getItem(VORIGE))['varve.vormen'];
  ok(`hooguit ${VORIGE_MAX} per sleutel, nieuwste eerst, geen dubbele`, l.length === VORIGE_MAX && l[0].waarde === 'B' && l[1].waarde === `B${VORIGE_MAX + 1}`
    && new Set(l.map((x) => x.waarde)).size === l.length, JSON.stringify(l.map((x) => x.waarde)));
  opslag.setItem(VORIGE, '{kapot');
  opslag.setItem('varve.vormen', 'X');
  const v = await maakInstellingenOpslag({ haal: srv.haal, opslag }).start();
  ok('een kapotte vorige-lijst: opnieuw begonnen, niet gegooid', v.serverBereikbaar && JSON.parse(opslag.getItem(VORIGE))['varve.vormen'][0].waarde === 'X');
}
{
  // Opslag vol: geen kopie mogelijk, dan ook niet overschrijven (en herstel weigert).
  const srv = nepServer({ 'varve.master.rack': 'STANDAARD', 'varve.klankschaal': '{}' });
  const opslag = nepOpslag({ 'varve.master.rack': RACK });
  const setItem = opslag.setItem;
  opslag.setItem = (k, v) => { if (k === VORIGE) throw new Error('QuotaExceededError'); setItem(k, v); };
  const meldingen = [];
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag, meld: (t, soort) => meldingen.push([t, soort]) });
  const v = await o.start();
  ok('opslag vol: het echte rack blijft in de browser staan (geen kopie = niet overschrijven)', opslag.getItem('varve.master.rack') === RACK && opslag.getItem(VORIGE) === null
    && JSON.stringify(v.nietBewaard) === JSON.stringify(['varve.master.rack']) && v.bewaard.length === 0, JSON.stringify(v));
  ok('…wat de browser niet had, komt gewoon van de server', opslag.getItem('varve.klankschaal') === '{}');
  ok('…en één foutmelding die het zegt', meldingen.length === 1 && meldingen[0][1] === 'fout' && /master\.rack NIET van de server/.test(meldingen[0][0]), JSON.stringify(meldingen));
  ok('…de server houdt de zijne', srv.db.get('varve.master.rack') === 'STANDAARD');
  opslag.setItem = setItem;
  opslag.setItem(VORIGE, JSON.stringify({ 'varve.master.rack': [{ waarde: 'OUDER', tijd: 'x', bron: 'browser' }] }));
  opslag.setItem = (k, w) => { if (k === VORIGE) throw new Error('QuotaExceededError'); setItem(k, w); };
  const h = await o.herstel('varve.master.rack');
  ok('herstel met volle opslag: weigert, niets veranderd', !h.ok && opslag.getItem('varve.master.rack') === RACK && srv.db.get('varve.master.rack') === 'STANDAARD', JSON.stringify(h));
}
{
  // Review fix 3: een melding die nergens heen kon, telt niet als gemeld.
  const srv = nepServer();
  const opslag = nepOpslag();
  const meldingen = [];
  let meldKan = false;
  const o = maakInstellingenOpslag({ haal: srv.haal, opslag, wacht: 1, meld: (t) => { if (!meldKan) return false; meldingen.push(t); return true; } });
  await o.start();
  srv.stand = 'weg';
  o.schrijf('varve.vormen', '1'); await wacht(5); await o.klaar();
  meldKan = true;
  o.schrijf('varve.vormen', '0'); await wacht(5); await o.klaar();
  o.schrijf('varve.vormen', '1'); await wacht(5); await o.klaar();
  ok('meld gaf false: de volgende fout wordt alsnog gemeld, daarna één keer per sessie', meldingen.length === 1 && /niet op de server bewaard/.test(meldingen[0]), JSON.stringify(meldingen));
}
{
  // Review fix 3, in de browser: meldingen van vóór window.meld wachten op toonInstellingMeldingen().
  // Een eigen kopie van de module (?query = een nieuwe module), met location en fetch zoals in een pagina.
  const srv = nepServer({ 'varve.master.rack': 'STANDAARD' });
  const opslag = nepOpslag({ 'varve.master.rack': RACK });
  const echteFetch = globalThis.fetch;
  globalThis.location = { protocol: 'http:' };
  globalThis.fetch = srv.haal;
  globalThis.localStorage = opslag;
  delete globalThis.meld;
  try {
    const p = await import('../src/ui/instellingen-opslag.js?pagina');
    const v = await p.startInstellingen();
    ok('pagina: de start bewaart het echte rack', v.bewaard.includes('varve.master.rack') && p.vorigeInstellingen()['varve.master.rack'][0].waarde === RACK);
    const gezien = [];
    globalThis.meld = (t, s) => { gezien.push([t, s]); };
    p.toonInstellingMeldingen();
    ok('de melding van vóór window.meld komt alsnog, één keer', gezien.length === 1 && /bijgewerkt bij het opstarten/.test(gezien[0][0]), JSON.stringify(gezien));
    p.toonInstellingMeldingen();
    ok('…en niet twee keer', gezien.length === 1);
    const h = await p.herstelInstelling('varve.master.rack');
    ok('pagina: herstelInstelling zet het rack terug, ook op de server', h.ok && h.opServer && opslag.getItem('varve.master.rack') === RACK && srv.db.get('varve.master.rack') === RACK);
  } finally {
    globalThis.fetch = echteFetch;
    delete globalThis.location; delete globalThis.localStorage; delete globalThis.meld;
  }
}

// ==========================================================================
console.log('\nde schrijvers van de browser, in Node');
{
  const opslag = nepOpslag();
  let fetches = 0;
  const oudFetch = globalThis.fetch;
  globalThis.localStorage = opslag;
  globalThis.fetch = async () => { fetches++; throw new Error('niet in Node'); };
  io.schrijfInstelling('varve.koptelefoon.omgewisseld', '1');
  io.schrijfInstelling('varve.koptelefoon.open', '1');
  io.wisInstelling('varve.vormen');
  io.spiegelInstelling('varve.stems.standaard', '4');
  await wacht(500);
  ok('schrijfInstelling zet localStorage, ook buiten de lijst', opslag.getItem('varve.koptelefoon.omgewisseld') === '1' && opslag.getItem('varve.koptelefoon.open') === '1');
  ok('zonder pagina (geen location): geen verzoek naar een server', fetches === 0);
  const v = await io.startInstellingen();
  ok('startInstellingen zonder pagina: niets, geen fout', v.serverBereikbaar === false && fetches === 0);
  globalThis.fetch = oudFetch;
  delete globalThis.localStorage;
}

// ==========================================================================
console.log('\nde plekken in src/ die de sleutels lezen en schrijven');
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const bestanden = (map) => readdirSync(map, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? bestanden(join(map, d.name)) : d.name.endsWith('.js') ? [join(map, d.name)] : []);
  const plekken = {};
  for (const f of bestanden('src')) {
    const tekst = readFileSync(f, 'utf8');
    for (const k of INSTELLING_SLEUTELS) if (tekst.includes(`'${k}'`)) (plekken[k] ??= []).push(f);
  }
  const zonder = INSTELLING_SLEUTELS.filter((k) => !plekken[k]);
  ok('elke sleutel heeft een plek in src/ (anders klopt de witte lijst niet meer)', zonder.length === 0, zonder.join(', '));
  const los = [];
  for (const [k, fs] of Object.entries(plekken)) for (const f of fs) {
    if (f.endsWith('instellingen-opslag.js') || f.endsWith('instellingen-lijst.js')) continue;
    const t = readFileSync(f, 'utf8');
    const aangesloten = /from '(?:\.|\.\.)\/instellingen-opslag\.js'/.test(t) || (f.endsWith('control/midi.js') && /this\.bewaar\(STORE_KEY/.test(t))
      || (f.endsWith('master-weergave.js') && /OPSLAG/.test(readFileSync('src/ui/master-paneel.js', 'utf8')) && /schrijfInstelling/.test(readFileSync('src/ui/master-paneel.js', 'utf8')));
    if (!aangesloten) los.push(`${k} in ${f}`);
  }
  ok('elke plek is aangesloten (import van instellingen-opslag.js, of de bewaarder van midi.js)', los.length === 0, los.join('; '));
  ok('midi-opzet geeft de MidiHub schrijfInstelling als bewaarder', /new MidiHub\(\{ bewaar: schrijfInstelling \}\)/.test(readFileSync('src/ui/midi-opzet.js', 'utf8')));
  const app = readFileSync('src/ui/app.js', 'utf8');
  ok('app.js haalt de instellingen op vóór de engine en de panelen', app.indexOf('await startInstellingen()') > 0
    && app.indexOf('await startInstellingen()') < app.indexOf('new Engine(') && app.indexOf('await startInstellingen()') < app.indexOf('opzetMaster('));
  ok('app.js toont de uitgestelde meldingen direct na window.meld', app.indexOf('toonInstellingMeldingen();') > app.indexOf('window.meld = meld;') && app.indexOf('window.meld = meld;') > 0);
  ok('de server importeert de witte lijst uit het pure bestand, niet uit de opslag', /from '\.\.\/src\/ui\/instellingen-lijst\.js'/.test(readFileSync('server/index.js', 'utf8'))
    && !readFileSync('server/index.js', 'utf8').includes('instellingen-opslag.js'));
  ok('instellingen-lijst.js is puur (geen localStorage, fetch, document, window)', !/localStorage|fetch|document|window/.test(readFileSync('src/ui/instellingen-lijst.js', 'utf8').replace(/\/\*\*[\s\S]*?\*\//g, '')));
  ok('geen engine-bestand raakt de opslag (regel 1)', bestanden('src/engine').every((f) => !readFileSync(f, 'utf8').includes('instellingen-opslag')));
}

// ==========================================================================
console.log('\ntegen de echte server (eigen poort, tijdelijke db)');
{
  const map = mkdtempSync(join(tmpdir(), 'varve-instellingen-opslag-'));   // niet verwijderd (niets verwijderen)
  const poort = 20000 + Math.floor(Math.random() * 20000);
  const B = `http://localhost:${poort}`;
  let uit = '';
  const server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(poort), VARVE_DB: join(map, 'library.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(map, 'media'), VARVE_OPNAMES: join(map, 'opnames'),
      VARVE_PLANNEN: join(map, 'plannen'), VARVE_PATRONEN: join(map, 'patronen'), VARVE_PROEF: join(map, 'proef'),
      VARVE_BACKUPS: join(map, 'backups'), VARVE_HERANALYSE: 'uit' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { uit += d; });
  server.stderr.on('data', (d) => { uit += d; });
  try {
    let op = false;
    for (let i = 0; i < 200 && !op; i++) { op = await fetch(`${B}/api/instellingen`).then((r) => r.ok).catch(() => false); if (!op) await wacht(75); }
    ok('de server start', op, uit.slice(-500));
    const haal = (p, i) => fetch(B + p, i);
    const a = nepOpslag({ 'varve.master.rack': RACK, 'varve.midi.ports': '{"inName":"APC40 mkII"}', 'varve.vormen': '1' });
    const va = await maakInstellingenOpslag({ haal, opslag: a }).start();
    ok('browser A, lege server: drie omhoog', va.omhoog.length === 3, JSON.stringify(va));
    const oa = maakInstellingenOpslag({ haal, opslag: a, wacht: 5 });
    await oa.start();
    oa.wis('varve.vormen');
    oa.schrijf('varve.beeld.aan', '1');
    await wacht(30); await oa.klaar();
    const b = nepOpslag({ 'varve.vormen': '1' });   // een oude browser met de vormen-vlag nog aan
    const vb = await maakInstellingenOpslag({ haal, opslag: b }).start();
    ok('browser B: alles van de server, niets omhoog', vb.omhoog.length === 0 && b.getItem('varve.master.rack') === RACK
      && b.getItem('varve.midi.ports') === '{"inName":"APC40 mkII"}' && b.getItem('varve.beeld.aan') === '1', JSON.stringify(b.alles()));
    ok('browser B: de in A gewiste vormen-vlag is ook hier uit', b.getItem('varve.vormen') === null);
  } finally {
    server.kill('SIGTERM');
    await new Promise((z) => { server.on('exit', z); setTimeout(z, 3000); });
  }
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles ok');
