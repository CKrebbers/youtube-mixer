// De koppeling met de Stroommachine (src/koppel/beeld.js) zonder browser en zonder netwerk, op de ECHTE
// engine (nep-audio, de klok verzet je zelf) en de echte maatklok. Een nep-zender schrijft op wat de
// koppeling vraagt; voor de volgorde op de lijn de ECHTE zender (varve-beeld-zender.js) op een nep-WebSocket
// met nep-timers. Herkomst van de gevallen: v1 test/beeld.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine/engine.js';
import { nepCtx, nepAudio, nepNummer } from './nep-audio.mjs';
import {
  BeeldKoppeling, controleerAdres, klemLatentie, stabieleId, kiesKant, kenmerkenVan, wisselVraagtBevestiging,
  MACROS, REGIE, MACRO_STANDAARD, ADRES_MAX, TIK_MS, ONBEREIKBAAR_MS, BEELD_VERS_MS, OPNIEUW_MS, STIL_MS, BEELD_ADRESSEN,
} from '../src/koppel/beeld.js';

const dicht = (a, b, eps = 1e-9, wat = '') => assert.ok(Math.abs(a - b) < eps, `${wat} ${a} ≉ ${b}`);

// ---- nep-tijd (ms, voor de zender en de tik) ------------------------------------------
function nepTijd() {
  const tijd = { T: 1000, taken: [] };
  tijd.timers = {
    setInterval: (f, ms) => { const t = { f, ms, next: tijd.T + ms, rep: true }; tijd.taken.push(t); return t; },
    clearInterval: (t) => { if (t) t.dood = true; },
    setTimeout: (f, ms) => { const t = { f, ms, next: tijd.T + ms, rep: false }; tijd.taken.push(t); return t; },
    clearTimeout: (t) => { if (t) t.dood = true; },
  };
  tijd.nu = () => tijd.T;
  tijd.loop = (ms) => {
    const eind = tijd.T + ms;
    for (;;) {
      const t = tijd.taken.filter((x) => !x.dood && x.next <= eind).sort((a, b) => a.next - b.next)[0];
      if (!t) break;
      tijd.T = t.next; t.f();
      if (t.rep) t.next += t.ms; else t.dood = true;
    }
    tijd.T = eind;
  };
  tijd.levend = () => tijd.taken.filter((x) => !x.dood).length;
  return tijd;
}

// ---- nep-zender: schrijft op wat de koppeling vraagt ------------------------------------
function nepZenderMaker() {
  const gemaakt = [];
  const maak = (opties) => {
    const z = {
      opties, gestart: false, gestopt: false, status: { verbonden: false, beeld: null, verstuurd: 0, ontvangen: 0 },
      tracks: [], mixen: [], poorten: [], luisteraars: [],
      start() { this.gestart = true; }, stop() { this.gestopt = true; this.status.verbonden = false; },
      track(deck, info) { if (!this.status.verbonden) return false; this.tracks.push([deck, { ...info }]); return true; },
      mix(m) { this.mixen.push(JSON.parse(JSON.stringify(m))); },
      poort(id, w) { if (!this.status.verbonden) return false; this.poorten.push(w === undefined ? [id] : [id, w]); return true; },
      on(e, f) { this.luisteraars.push(f); return () => { this.luisteraars = this.luisteraars.filter((x) => x !== f); }; },
      verbind(v = true) { this.status.verbonden = v; for (const f of this.luisteraars) f(this.status); },
      beeld(b) { this.status.beeld = b; for (const f of this.luisteraars) f(this.status); },
    };
    gemaakt.push(z);
    return z;
  };
  return { maak, gemaakt };
}

/**
 * De Stroommachine is er: elke seconde een beeld-status en een ping met haar oplopende teller (09o-dj.js).
 * `.herlaad()` = een nieuwe pagina (de teller begint bij 1).
 */
function stroomLeeft(tijd, z, k, scene = 'Ruimte') {
  let teller = 0;
  const zeg = () => {
    if (!z.status.verbonden) return;
    k.hoorBericht(JSON.stringify({ naar: 'varvedj', type: 'ping', id: ++teller, t0: 1, van: 'stroommachine' }));
    z.beeld({ regime: 'Diepte', scene, fps: 60, volgt: true, bpm: 124 });
  };
  zeg();
  const taak = tijd.timers.setInterval(zeg, 1000);
  const weg = () => tijd.timers.clearInterval(taak);
  weg.herlaad = () => { teller = 0; zeg(); };
  return weg;
}

const nepLuisteraar = (w = { laag: 0.5, midden: 0.2, hoog: 0.9, onset: 1, rms: 0.3 }) => ({ waarden: w, gelezen: 0, lees() { this.gelezen++; return this.waarden; } });
const ADRES = 'ws://192.168.1.20:7702/app';

/** De echte engine op nep-audio, met een koppeling. */
async function opzet({ mag = true, luisteraar = nepLuisteraar(), WebSocketImpl, metZender = true } = {}) {
  const ctx = nepCtx();
  const e = new Engine({ ctx, audio: nepAudio(), timer: false });
  await e.klaar;
  const tijd = nepTijd();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: e, luisteraar, timers: tijd.timers, nu: tijd.nu, mag,
    ...(metZender ? { maakZender: nz.maak } : {}), ...(WebSocketImpl ? { WebSocketImpl } : {}) });
  const zet = (t) => { ctx.currentTime = t; e.tik(); };
  return { e, ctx, bus: e.bus, k, nz, tijd, zet };
}

// ---- puur ---------------------------------------------------------------------------------

test('adres: leeg = uit, alleen ws:// of wss://, getrimd, grenzen, slechte poorten', () => {
  assert.equal(controleerAdres('').leeg, true);
  assert.equal(controleerAdres('   ').leeg, true);
  assert.equal(controleerAdres(null).leeg, true);
  assert.deepEqual(controleerAdres(`  ${ADRES}  `), { ok: true, adres: ADRES });
  assert.ok(controleerAdres('wss://pc.local:7702/app').ok);
  assert.equal(controleerAdres('WS://Omarchy.Local:7702/app').adres, 'ws://omarchy.local:7702/app');
  for (const slecht of ['http://192.168.1.20:7702/app', 'https://x/app', '192.168.1.20:7702', 'javascript:alert(1)', 'ws://',
    'ws://ge bruiker:7702/app', 'ws://a:b@pc:7702/app', 'ws://pc:7702/app#x', 'ws://pc:99999/app']) {
    const r = controleerAdres(slecht);
    assert.ok(r.ok === false && !r.leeg && typeof r.reden === 'string', slecht);
  }
  assert.match(controleerAdres('ws://pc:6000/app').reden, /6000/);
  assert.ok(controleerAdres('ws://pc:7702/app').ok && controleerAdres('ws://pc/app').ok);
  assert.equal(controleerAdres('ws://pc/' + 'a'.repeat(ADRES_MAX)).ok, false);
  assert.ok(controleerAdres('ws://pc/' + 'a'.repeat(ADRES_MAX - 8)).ok);
  for (const a of BEELD_ADRESSEN) assert.equal(controleerAdres(a.adres).adres, a.adres, a.sleutel);
  assert.deepEqual(BEELD_ADRESSEN.map((a) => a.sleutel), ['lokaal', 'pc']);
});

test('latentie: geklemd op −200 … +500, hele ms, onzin = 0, komma mag', () => {
  assert.equal(klemLatentie(900), 500);
  assert.equal(klemLatentie(-900), -200);
  assert.equal(klemLatentie(80), 80);
  assert.equal(klemLatentie('abc'), 0);
  assert.equal(klemLatentie(NaN), 0);
  assert.equal(klemLatentie(undefined), 0);
  assert.equal(klemLatentie('12,6'), 13);
  assert.equal(klemLatentie(' -40 '), -40);
});

test('stabiele id per nummer: yt, andere site, lokaal, demo, los bestand', () => {
  assert.equal(stabieleId({ id: 'dQw4w9WgXcQ' }), 'yt:dQw4w9WgXcQ');
  assert.equal(stabieleId({ id: 'a-b_cdEFghI' }), 'yt:a-b_cdEFghI');
  assert.equal(stabieleId({ id: 'tiktok-7300000000000000001' }), 'tiktok:7300000000000000001');
  assert.equal(stabieleId({ id: 'lokaal-0123456789ab' }), 'lokaal:0123456789ab');
  assert.equal(stabieleId({ id: 'demo-124', demo: true }), 'varve:demo-124');
  // 'demo-wissel' is 11 tekens: zonder de demo-regel eerst werd het een YouTube-id.
  assert.equal(stabieleId({ id: 'demo-wissel' }), 'varve:demo-wissel');
  assert.equal(stabieleId({ id: 'pad', demo: true }), 'varve:demo-pad');
  assert.equal(stabieleId({ id: 'raar_id' }), 'varve:raar_id');
  assert.equal(stabieleId({ titel: 'set.wav' }), 'bestand:set.wav');
  assert.equal(stabieleId({ id: 'dQw4w9WgXcQ', titel: 'a' }), stabieleId({ id: 'dQw4w9WgXcQ', titel: 'b' }));
});

test('kiesKant: wie speelt (fader open) gaat voor, dan wie het laatst begon of laadde; thru hoort nergens bij', () => {
  const t = (id, kant, geladen, speelt, laatst, open = true) => ({ id, kant, geladen, speelt, laatst, open });
  assert.equal(kiesKant([t(1, 'A', true, false, 1), t(2, 'B', true, false, 2)], 'A'), 1);
  assert.equal(kiesKant([t(3, 'thru', true, true, 9)], 'A'), null);
  assert.equal(kiesKant([t(1, 'A', false, false, 9)], 'A'), null);
  assert.equal(kiesKant([t(1, 'A', true, true, 1), t(3, 'A', true, false, 5)], 'A'), 1, 'klaarzetten wisselt niets');
  assert.equal(kiesKant([t(1, 'A', true, true, 1), t(3, 'A', true, true, 5)], 'A'), 3);
  assert.equal(kiesKant([t(1, 'A', true, false, 7), t(3, 'A', true, false, 5)], 'A'), 1);
  assert.equal(kiesKant([t(1, 'A', true, true, 1, true), t(3, 'A', true, true, 5, false)], 'A'), 1, 'voorbeluisteren met de fader dicht');
  assert.equal(kiesKant([t(3, 'A', true, true, 5, false), t(1, 'A', true, false, 9)], 'A'), 3);
});

test('kenmerkenVan: mix.* uit de analyse, maat.* uit de tel, niveau gaat voor de vaste schaal', () => {
  const w = kenmerkenVan({ laag: 0.5, midden: 0.2, hoog: 0.9, onset: 1, rms: 0.3 }, { beat: 41.125 });
  assert.deepEqual([w['mix.laag'], w['mix.midden'], w['mix.hoog'], w['mix.klap'], w['mix.luid']], [0.5, 0.2, 0.9, 1, 0.3]);
  dicht(w['maat.tel'], 0.125);
  assert.equal(w['maat.klap'], 1);
  const w2 = kenmerkenVan(null, { beat: 41.5 });
  assert.equal(w2['maat.klap'], 0);
  assert.ok(!('mix.laag' in w2));
  assert.ok(!('maat.tel' in kenmerkenVan({ laag: 0 }, null)));
  const w3 = kenmerkenVan({ laag: 1, midden: 1, hoog: 1, rms: 1, onset: 0.3 }, null, { laag: 0.2, midden: 0.4, hoog: 0.6, luid: 0.8 });
  assert.deepEqual([w3['mix.laag'], w3['mix.luid'], w3['mix.klap']], [0.2, 0.8, 0.3]);
});

test('wisselVraagtBevestiging: alleen aan + verbonden met een ánder adres', () => {
  const w = (aan, verbonden, adres, naar) => wisselVraagtBevestiging({ aan, verbonden, adres }, naar);
  const PC = BEELD_ADRESSEN[1].adres, MAC = BEELD_ADRESSEN[0].adres;
  assert.ok(w(true, true, PC, MAC));
  assert.ok(!w(false, true, PC, MAC) && !w(true, false, PC, MAC) && !w(true, true, MAC, MAC));
  assert.ok(!wisselVraagtBevestiging(null, MAC));
});

// ---- de tel op de maatklok ---------------------------------------------------------------------

test('klok: de tel zoals je hem HOORT op de maatklok, met de extra latentie; klok stil = speelt:false met de laatste tel', async () => {
  const { e, bus, k, zet, ctx } = await opzet();
  assert.equal(k.klok(), null, 'nog nooit een tel: niets');
  await e.laad(1, nepNummer({ bpm: 120 }));
  zet(1);
  bus.doe('track.1.play', true);
  zet(10);
  const V = e.vertraging();
  assert.ok(V > 0.02, `de engine heeft een vertraging (${V})`);
  let c = k.klok();
  assert.equal(c.speelt, true);
  dicht(c.bpm, 120, 1e-9, 'bpm');
  dicht(c.beat, e.klok.tel(10 - V), 1e-9, 'tel = klok.tel(nu − vertraging)');
  dicht(c.beat, e.hoorbareTel(), 1e-9, 'dezelfde als engine.hoorbareTel()');
  k.zet({ latentie: 80 });
  dicht(k.klok().beat, e.klok.tel(10 - V + 0.08), 1e-9, '+80 ms: de tel 80 ms vóór');
  dicht(k.klok().beat - e.hoorbareTel(), 0.08 * 2, 1e-9, '+80 ms op 120 bpm = 0,16 tel');
  k.zet({ latentie: -100 });
  dicht(k.klok().beat, e.klok.tel(10 - V - 0.1), 1e-9, '−100 ms: later');
  k.zet({ latentie: 9000 });
  assert.equal(k.instellingen.latentie, 500);
  k.zet({ latentie: 0 });
  assert.ok(k.klok().beat > 4, 'doorlopend, niet modulo de maat');
  // tempo van de klok veranderen: bpm volgt (wat je hoort)
  e.zetKlokTempo(126, e.straks());
  zet(12);
  dicht(k.klok().bpm, 126, 1e-6, 'bpm van de klok');
  // de klok stil
  const laatste = k.klok().beat;
  e.klok.stop();
  c = k.klok();
  assert.equal(c.speelt, false);
  dicht(c.beat, laatste, 1e-12, 'de laatste tel');
  dicht(c.bpm, 126, 1e-6);
  // een AudioContext die stilstaat = transport stil
  e.klok.start(12, 0, 120);
  ctx.state = 'suspended';
  assert.equal(k.klok().speelt, false, 'context stil');
  ctx.state = 'running';
  assert.equal(k.klok().speelt, true);
});

test('kenmerken: null als er niets klinkt, door zolang de master klinkt, en niet lezen zonder verbinding', async () => {
  const stil = nepLuisteraar({ laag: 0, midden: 0.002, hoog: 0, onset: 0, rms: 0.001 });
  const { e, bus, k, tijd, zet, nz } = await opzet({ luisteraar: stil });
  await e.laad(1, nepNummer({ bpm: 120 }));
  assert.equal(k.kenmerken(), null, 'niets speelt, master stil');
  k.luisteraar = nepLuisteraar();
  assert.equal(k.kenmerken()?.['mix.laag'], 0.5, 'master klinkt (een staart, een instrument)');
  k.luisteraar = stil;
  assert.equal(k.kenmerken()?.['mix.laag'], 0, 'net stil: nog even door, naar ~0');
  tijd.T += STIL_MS + 1;
  assert.equal(k.kenmerken(), null, `${STIL_MS} ms stil`);
  k.luisteraar = nepLuisteraar();
  zet(1); bus.doe('track.1.play', true); zet(3);
  const w = k.kenmerken();
  assert.equal(Object.keys(w).length, 7, 'speelt: zeven kenmerken');
  dicht(w['maat.tel'], e.hoorbareTel() - Math.floor(e.hoorbareTel()), 1e-9, 'maat.tel = fase van de hoorbare klok');
  const kaal = new BeeldKoppeling({ engine: e, timers: tijd.timers, nu: tijd.nu, maakZender: nz.maak });
  assert.deepEqual(Object.keys(kaal.kenmerken()).sort(), ['maat.klap', 'maat.tel'], 'zonder luisteraar alleen maat.*');
  kaal.vernietig();
  // aan maar niet verbonden: null en de analyser niet gelezen
  const l = nepLuisteraar();
  k.luisteraar = l;
  k.zet({ aan: true, adres: ADRES });
  assert.equal(k.kenmerken(), null);
  assert.equal(l.gelezen, 0);
  nz.gemaakt[0].verbind(true);
  assert.equal(Object.keys(k.kenmerken() ?? {}).length, 7);
  assert.equal(l.gelezen, 1);
  k.zet({ aan: false });
});

// ---- uit = niets -------------------------------------------------------------------------------

test('uit, zonder adres of niet het eerste tabblad: geen zender, geen WebSocket, geen timer', async () => {
  let ws = 0;
  const { k, nz, tijd } = await opzet({ WebSocketImpl: class { constructor() { ws++; } } });
  assert.ok(!k.loopt && nz.gemaakt.length === 0 && tijd.levend() === 0);
  k.zet({ aan: false, adres: ADRES });
  k.zet({ aan: true, adres: '' });
  tijd.loop(30000);
  assert.ok(nz.gemaakt.length === 0 && ws === 0 && tijd.levend() === 0, 'na 30 s nog niets');
  let meldingen = 0;
  k.on('melding', () => meldingen++);
  tijd.loop(60000);
  assert.equal(meldingen, 0, 'geen melding');
  k.zet({ adres: ADRES });
  assert.ok(nz.gemaakt.length === 1 && nz.gemaakt[0].gestart && nz.gemaakt[0].opties.url === ADRES);
  k.zet({ latentie: 40 });
  k.zet({ adres: ADRES + ' ' });
  assert.equal(nz.gemaakt.length, 1, 'latentie of hetzelfde adres: niet opnieuw');
  k.zet({ adres: 'ws://10.0.0.5:7702/app' });
  assert.ok(nz.gemaakt.length === 2 && nz.gemaakt[0].gestopt);
  k.zet({ aan: false });
  assert.ok(nz.gemaakt[1].gestopt && !k.loopt && tijd.levend() === 0, 'uit: 0 timers');
});

test('een ongeldig adres stopt een lopende zender en zegt waarom', async () => {
  const { k, nz, tijd } = await opzet();
  let r = k.zet({ aan: true, adres: 'http://192.168.1.20:7702/app' });
  assert.ok(r.ok === false && nz.gemaakt.length === 0 && k.status().fout === r.reden);
  r = k.zet({ adres: ADRES });
  assert.ok(r.ok && k.loopt && k.status().fout === null);
  r = k.zet({ adres: 'ws://' + 'x'.repeat(300) });
  assert.ok(r.ok === false && nz.gemaakt[0].gestopt && !k.loopt && k.instellingen.adres === '' && tijd.levend() === 0);
});

test('één tabblad zendt: mag (boolean of functie) en magZenden', async () => {
  const { k, nz, tijd } = await opzet({ mag: false });
  k.zet({ aan: true, adres: ADRES }, { vanzelf: true });
  assert.ok(nz.gemaakt.length === 0 && tijd.levend() === 0 && k.status().elders === true);
  k.magZenden(true);
  assert.ok(nz.gemaakt.length === 1 && nz.gemaakt[0].gestart && !k.status().elders);
  k.magZenden(true);
  assert.equal(nz.gemaakt.length, 1);
  k.magZenden(false);
  assert.ok(nz.gemaakt[0].gestopt && tijd.levend() === 0 && k.instellingen.aan && k.instellingen.adres === ADRES);
  let eerste = false;
  const { k: k2, nz: nz2 } = await opzet({ mag: () => eerste });
  k2.zet({ aan: true, adres: ADRES });
  assert.equal(nz2.gemaakt.length, 0, 'mag() zegt nee');
  eerste = true;
  k2.zet({});
  assert.equal(nz2.gemaakt.length, 1, 'mag() zegt ja');
  k2.zet({ aan: false });
});

test('meldingen: hooguit één per start, geen regen bij herverbinden; vanzelf = info', async () => {
  const { k, nz, tijd } = await opzet();
  const m = [];
  k.on('melding', (x) => m.push(x));
  k.zet({ aan: true, adres: ADRES });
  tijd.loop(ONBEREIKBAAR_MS + 1);
  assert.ok(m.length === 1 && m[0].soort === 'fout');
  tijd.loop(10 * 60 * 1000);
  assert.equal(m.length, 1);
  const z = nz.gemaakt[0];
  z.verbind(true);
  assert.ok(m.length === 2 && /verbonden/.test(m[1].tekst));
  for (let i = 0; i < 20; i++) { z.verbind(false); tijd.loop(1000); z.verbind(true); tijd.loop(1000); }
  assert.equal(m.length, 2);
  k.zet({ aan: false });
  k.zet({ aan: true }, { vanzelf: true });
  tijd.loop(ONBEREIKBAAR_MS + 1);
  assert.ok(m.length === 3 && m[2].soort === 'info' && /staat de pc uit/.test(m[2].tekst));
  k.zet({ aan: false });
});

// ---- track en mix: toestand ----------------------------------------------------------------------

test('track pas als de Stroommachine er is, met een stabiele id; laden via het engine-event', async () => {
  const { e, bus, k, nz, tijd, zet } = await opzet();
  await e.laad(1, { ...nepNummer({ id: 'dQw4w9WgXcQ', bpm: 124 }), titel: 'Eerste', toon: 'Am' });
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  tijd.loop(TIK_MS * 3);
  assert.equal(z.tracks.length, 0, 'niet verbonden');
  z.verbind(true);
  tijd.loop(TIK_MS * 5);
  assert.ok(z.tracks.length === 0 && z.mixen.length === 0, 'verbonden maar de Stroommachine is er niet: niets (de relay gooit het weg)');
  const weg = stroomLeeft(tijd, z, k);
  tijd.loop(TIK_MS);
  assert.equal(z.tracks.length, 1);
  assert.deepEqual(z.tracks[0], ['A', { id: 'yt:dQw4w9WgXcQ', bron: 'dQw4w9WgXcQ', titel: 'Eerste', bpm: 124, key: 'Am' }]);
  tijd.loop(5000);
  assert.equal(z.tracks.length, 1, 'niet opnieuw zolang er niets verandert');
  await e.laad(2, { ...nepNummer({ id: 'tiktok-7300000000000000001', bpm: 128 }), titel: 'Tweede' });
  tijd.loop(TIK_MS);
  assert.deepEqual([z.tracks.length, z.tracks[1][0], z.tracks[1][1].id], [2, 'B', 'tiktok:7300000000000000001']);
  await e.laad(3, nepNummer({ id: 'aaaaaaaaaaa' }));
  tijd.loop(TIK_MS);
  assert.equal(z.tracks.length, 2, 'een thru-track: niets');
  tijd.T += 5;
  await e.laad(1, nepNummer({ id: 'bbbbbbbbbbb' }));
  tijd.loop(TIK_MS);
  assert.equal(z.tracks.at(-1)[1].id, 'yt:bbbbbbbbbbb', 'een nieuw nummer op track 1');
  // klaarzetten op dezelfde kant terwijl er een speelt: geen wissel; starten: wel
  zet(1); bus.doe('track.1.play', true); zet(2);
  tijd.loop(TIK_MS);
  bus.doe('track.3.kant', true); bus.doe('track.3.kant', false);   // thru -> A
  assert.equal(e.track(3).kant, 'A');
  tijd.T += 5;
  await e.laad(3, nepNummer({ id: 'ccccccccccc' }));
  tijd.loop(TIK_MS * 3);
  assert.equal(z.tracks.length, 3, 'klaarzetten op kant A terwijl track 1 speelt');
  bus.doe('track.3.play', true); zet(3);
  tijd.loop(TIK_MS);
  assert.deepEqual([z.tracks.length, z.tracks[3][0], z.tracks[3][1].id], [4, 'A', 'yt:ccccccccccc'], 'starten neemt kant A over');
  // herverbinden: beide kanten en de mix opnieuw
  const voor = z.tracks.length, mixVoor = z.mixen.length;
  z.verbind(false);
  tijd.loop(TIK_MS * 5);
  assert.equal(z.tracks.length, voor);
  z.verbind(true);
  tijd.loop(1000);
  assert.equal(z.tracks.length, voor + 2);
  assert.equal(z.mixen.length, mixVoor + 1);
  // herladen (de ping-teller begint opnieuw): opnieuw, hooguit eens per OPNIEUW_MS, nooit verloren
  tijd.loop(OPNIEUW_MS);
  const n2 = z.tracks.length;
  weg.herlaad();
  tijd.loop(TIK_MS);
  assert.equal(z.tracks.length, n2 + 2, 'herladen: beide kanten opnieuw');
  tijd.loop(5000);
  assert.equal(z.tracks.length, n2 + 2, 'daarna geen herhaling');
  weg.herlaad();
  tijd.loop(TIK_MS);
  assert.equal(z.tracks.length, n2 + 2, `binnen ${OPNIEUW_MS} ms nog niet`);
  tijd.loop(OPNIEUW_MS);
  assert.equal(z.tracks.length, n2 + 4, 'na de wachttijd alsnog');
  weg();
  k.zet({ aan: false });
});

test('voorbeluisteren met de fader dicht wisselt de scène niet', async () => {
  const { e, bus, k, nz, tijd, zet } = await opzet();
  await e.laad(1, nepNummer({ id: 'aaaaaaaaaaa' }));
  bus.doe('track.3.kant', true); bus.doe('track.3.kant', false);
  await e.laad(3, nepNummer({ id: 'ccccccccccc' }));
  zet(1); bus.doe('track.1.play', true); zet(2);
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  z.verbind(true);
  const weg = stroomLeeft(tijd, z, k);
  tijd.loop(TIK_MS);
  assert.equal(z.tracks.at(-1)[1].id, 'yt:aaaaaaaaaaa');
  bus.doe('track.3.fader', 0);
  tijd.T += 5;
  bus.doe('track.3.play', true); zet(3);
  tijd.loop(TIK_MS * 3);
  assert.equal(z.tracks.length, 1, 'fader dicht: geen nieuwe track A');
  bus.doe('track.3.fader', 0.8);
  tijd.loop(TIK_MS);
  assert.deepEqual([z.tracks.length, z.tracks[1][1].id], [2, 'yt:ccccccccccc'], 'fader open: hij neemt kant A over');
  weg();
  k.zet({ aan: false });
});

test('mix bij crossfader en transport, niet bij gewoon doorspelen', async () => {
  const { e, bus, k, nz, tijd, zet } = await opzet();
  await e.laad(1, nepNummer({ id: 'aaaaaaaaaaa', bpm: 120 }));
  await e.laad(2, nepNummer({ id: 'bbbbbbbbbbb', bpm: 120 }));
  zet(1);
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  z.verbind(true);
  const weg = stroomLeeft(tijd, z, k);
  tijd.loop(TIK_MS);
  assert.equal(z.mixen.length, 1);
  assert.equal(z.mixen[0].xfader, 0.5);
  assert.equal(z.mixen[0].a.speelt, false);
  tijd.loop(TIK_MS * 5);
  assert.equal(z.mixen.length, 1, 'niets veranderd');
  bus.doe('mixer.xfader', 0.8);
  tijd.loop(TIK_MS);
  assert.deepEqual([z.mixen.length, z.mixen[1].xfader], [2, 0.8]);
  bus.doe('track.1.play', true); zet(2);
  tijd.loop(TIK_MS);
  assert.deepEqual([z.mixen.length, z.mixen[2].a.speelt], [3, true]);
  dicht(z.mixen[2].a.pos, Math.round(e.track(1).plek(2 - e.vertraging()) * 100) / 100, 1e-9, 'pos = wat je hoort');
  // doorspelen: de audioklok en de tik lopen samen
  for (let i = 0; i < 5; i++) { zet(2 + (i + 1) * TIK_MS / 1000); tijd.loop(TIK_MS); }
  assert.equal(z.mixen.length, 3, 'doorspelen: geen mix');
  e.track(1).zoek(60); zet(2.6);   // een sprong (zoals een hotcue of seek)
  tijd.loop(TIK_MS);
  assert.ok(z.mixen.length === 4 && z.mixen[3].a.pos > 50, `een sprong: mix (${JSON.stringify(z.mixen.at(-1)?.a)})`);
  bus.doe('track.1.play', true); zet(3);
  tijd.loop(TIK_MS);
  assert.equal(z.mixen.at(-1).a.speelt, false, 'pauze: mix');
  weg();
  k.zet({ aan: false });
});

test('macro\'s en regie: pas met verbinding, read null zonder; herladen zet de gezette macro\'s terug', async () => {
  const { k, nz, tijd } = await opzet();
  assert.equal(k.waarde('macro.tint'), null);
  assert.equal(k.knopStand('regie!flits'), null);
  assert.equal(k.zetWaarde('macro.tint', 0.6), false);
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  z.verbind(true);
  assert.equal(k.waarde('macro.tint'), MACRO_STANDAARD['macro.tint'], 'zonder verbinding gezet = niet onthouden');
  k.zetWaarde('macro.glitch', 0.4);
  assert.equal(z.poorten.length, 0, 'verbonden maar ze is er niet: wacht');
  const weg = stroomLeeft(tijd, z, k);
  tijd.loop(TIK_MS);
  assert.deepEqual(z.poorten, [['macro.glitch', 0.4]], 'zodra ze er is');
  k.zetWaarde('macro.tint', 7);
  assert.deepEqual(z.poorten.at(-1), ['macro.tint', 1], 'geklemd');
  k.druk('regie!flits', true);
  assert.deepEqual(z.poorten.at(-1), ['regie!flits']);
  assert.equal(k.knopStand('regie!flits'), 1);
  const n = z.poorten.length;
  k.druk('regie!flits', false);
  assert.ok(z.poorten.length === n && k.knopStand('regie!flits') === 0, 'loslaten stuurt niets');
  tijd.loop(OPNIEUW_MS);
  const voor = z.poorten.length;
  weg.herlaad();
  tijd.loop(TIK_MS);
  const terug = z.poorten.slice(voor);
  assert.deepEqual(terug.map((p) => p[0]).sort(), ['macro.glitch', 'macro.tint'], 'alleen de macro\'s die je zette, geen regie');
  weg();
  z.verbind(false);
  assert.equal(k.waarde('macro.tint'), null);
  assert.ok(MACROS.length === 8 && REGIE.length === 6);
  k.zet({ aan: false });
});

test('beeld-status: verse 3 s, daarna niet meer tonen', async () => {
  const { k, nz, tijd } = await opzet();
  k.zet({ aan: true, adres: ADRES });
  const z = nz.gemaakt[0];
  z.verbind(true);
  assert.equal(k.status().beeld, null);
  z.beeld({ regime: 'Diepte', scene: 'Ruimte · Veld', fps: 58, volgt: true, bpm: 124 });
  assert.equal(k.status().beeld.scene, 'Ruimte · Veld');
  tijd.loop(BEELD_VERS_MS + 10);
  assert.equal(k.status().beeld, null);
  k.zet({ aan: false });
});

// ---- de echte zender op een nep-WebSocket ----------------------------------------------------------

test('de echte zender op een nep-WebSocket: manifest eerst, klok, track, mix, kenmerken, pong, herverbinden, herladen', async () => {
  const socks = [];
  class NepWS {
    constructor(url) { this.url = url; this.readyState = 0; this.uit = []; this.luister = []; socks.push(this); }
    addEventListener(type, f) { if (type === 'message') this.luister.push(f); }
    send(s) { this.uit.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen && this.onopen(); }
    krijg(o) { const ev = { data: JSON.stringify(o) }; for (const f of this.luister) f(ev); this.onmessage && this.onmessage(ev); }
    sluit() { this.readyState = 3; this.onclose && this.onclose(); }
  }
  const { e, bus, k, tijd, zet } = await opzet({ WebSocketImpl: NepWS, metZender: false });
  await e.laad(1, { ...nepNummer({ id: 'dQw4w9WgXcQ', bpm: 124 }), titel: 'Een' });
  zet(1); bus.doe('track.1.play', true); zet(20);
  k.zet({ aan: true, adres: ADRES });
  assert.ok(socks.length === 1 && socks[0].url === ADRES);
  const status = () => ({ type: 'beeld-status', naar: 'varvedj', van: 'stroommachine', regime: 'Gloed', scene: 'Filament', bpm: 124, volgt: true, fps: 60 });
  let ping = 0;
  const stroom = tijd.timers.setInterval(() => {
    const s = socks.at(-1);
    if (s.readyState !== 1) return;
    s.krijg({ naar: 'varvedj', type: 'ping', id: ++ping, t0: 1, van: 'stroommachine' });
    s.krijg(status());
  }, 1000);
  socks[0].open();
  tijd.loop(TIK_MS + 5);
  assert.ok(socks[0].uit.some((m) => m.type === 'klok') && !socks[0].uit.some((m) => m.type === 'track'), 'klok wel, track nog niet');
  socks[0].krijg(status());
  tijd.loop(TIK_MS + 5);
  const lijn = socks[0].uit;
  assert.equal(lijn[0].app, 'varvedj', 'eerste bericht = het manifest');
  const klok = lijn.find((m) => m.type === 'klok');
  assert.ok(klok.naar === 'stroommachine' && klok.speelt === true && Math.abs(klok.bpm - 124) < 0.01);
  assert.ok(Math.abs(klok.beat - e.klok.tel(20 - e.vertraging())) < 0.002, `tel = de hoorbare klok (${klok.beat})`);
  const tr = lijn.find((m) => m.type === 'track');
  assert.ok(tr && tr.deck === 'A' && tr.id === 'yt:dQw4w9WgXcQ' && tr.titel === 'Een' && lijn.indexOf(tr) > 0);
  tijd.loop(100);
  const mix = socks[0].uit.find((m) => m.type === 'mix');
  assert.ok(mix && mix.xfader === 0.5 && mix.a?.speelt === true);
  const ken = socks[0].uit.filter((m) => m.type === 'kenmerken');
  assert.ok(ken.length >= 5 && !('naar' in ken[0]) && Object.keys(ken[0].w).length === 7, 'kenmerken op ~30 Hz, zonder naar');
  socks[0].krijg({ type: 'ping', id: 3, t0: 7, van: 'stroommachine' });
  assert.ok(socks[0].uit.some((m) => m.type === 'pong' && m.id === 3), 'pong (de zender zelf)');
  socks[0].sluit();
  assert.equal(k.verbonden, false);
  tijd.loop(1500);
  assert.equal(socks.length, 2, 'herverbindt vanzelf');
  socks[1].open();
  tijd.loop(1000 + TIK_MS + 5);
  assert.equal(socks[1].luister.length, 1, 'de koppeling luistert mee op de socket van de zender');
  assert.ok(socks[1].uit[0].app === 'varvedj' && socks[1].uit.some((m) => m.type === 'track' && m.id === 'yt:dQw4w9WgXcQ'), 'weer manifest, dan track A');
  tijd.loop(OPNIEUW_MS);
  const voor = socks[1].uit.filter((m) => m.type === 'track').length;
  ping = 0;   // de Stroommachine herladen
  tijd.loop(1000 + TIK_MS + 5);
  assert.equal(socks[1].uit.filter((m) => m.type === 'track').length, voor + 1, 'herladen: track A opnieuw over de lijn');
  k.zet({ aan: false });
  tijd.timers.clearInterval(stroom);
  const n = socks[1].uit.length;
  tijd.loop(5000);
  assert.ok(socks[1].uit.length === n && tijd.levend() === 0 && socks.length === 2, 'uit: geen berichten, geen timers, geen WebSocket');
});

test('vernietig: niet meer naar het laden luisteren', async () => {
  const { e, k } = await opzet();
  k.vernietig();
  await e.laad(1, nepNummer({ id: 'zzzzzzzzzzz' }));
  assert.equal(k.nummers[1], undefined);
});
