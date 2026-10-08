// De speelapparaten in VARVE (docs/MASCHINE.md): de Maschine MK2 zoals de AV-app-hub
// hem doorgeeft (src/control/maschine.js, devices/maschine-mk2.js, mappings/maschine-mk2.json),
// de schermen (maschine-scherm.js), de Xboard49 (knop 9–16, de schuif) en de regel dat een
// speelapparaat nooit "de controller" wordt (midi.js). Nep-engine, nep-instrumenten, nep-klok;
// de echte Noten en Mapping. Hub en Chromium: tools/headless/speelapparaten.mjs.
// Draai met: node test/maschine.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const dicht = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const { parseMessage, MidiHub, isSpeelapparaat } = await import('../src/control/midi.js');
const { Noten, leesMasterVolume } = await import('../src/control/noten.js');
const { Maschine, BRON, FLITS_MS, SCHERM_MS, KANDIDAAT_MS, KEUZES, KLEUREN } = await import('../src/control/maschine.js');
const M = await import('../src/control/devices/maschine-mk2.js');
const S = await import('../src/control/maschine-scherm.js');
const { PALETTE } = await import('../src/control/devices/apc40mk2.js');
const { INSTRUMENTEN } = await import('../src/engine/instrumenten/index.js');
const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
const lees = (pad) => JSON.parse(readFileSync(new URL(pad, import.meta.url), 'utf8'));

// ---- nep-engine met nep-instrumenten (het contract van docs/INSTRUMENTEN.md §3) ------
const DECKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const PARAMS = {
  poly: ['golf', 'ontstem', 'filter', 'reso', 'env', 'attack', 'decay/rel', 'sustain'],
  drums: ['TOON', 'DECAY', 'FILTER', 'DRIVE', 'KICK', 'SNARE', 'HATS', 'NIVEAU'],
  fm: ['index', 'ratio', 'aanslag', 'verval', 'release', 'zweving', 'filter', 'warmte'],
  schaal: ['karakter', 'uitklank', 'kracht', 'klank', 'fijn', 'slag', 'loslaten', 'wrijf'],
};
class NepInst {
  constructor(soort) {
    this.soort = soort;
    this.naam = INSTRUMENTEN.find((x) => x.soort === soort).naam;
    this.params = PARAMS[soort].map((label, i) => ({ id: label, label, standaard: 0.5, eenheid: i === 2 ? (v) => `${Math.round(60 + v * 17940)} Hz` : undefined }));
    this.w = this.params.map(() => 0.5);
    this.log = [];
    this.vast = new Set();
  }
  noteOn(n, v) { this.log.push(['aan', n, v]); this.vast.add(n); }
  noteOff(n) { this.log.push(['uit', n]); this.vast.delete(n); }
  druk(w, n) { this.log.push(['druk', w, n]); }
  buig(w) { this.log.push(['buig', w]); }
  mod(w) { this.log.push(['mod', w]); }
  houd(a) { this.log.push(['houd', a]); }
  stil() { this.log.push(['stil']); }
  alleUit() { this.log.push(['alleUit']); }
  zetParam(k, v) { if (k >= 1 && k <= 8) this.w[k - 1] = v; }
  leesParam(k) { return k >= 1 && k <= this.params.length ? this.w[k - 1] : null; }
  stand() {
    const s = { soort: this.soort, naam: this.naam, klinkt: this.vast.size, params: [...this.w] };
    if (this.soort === 'drums') s.pads = Array.from({ length: 16 }, (_, i) => ({ pad: i + 1, noot: 36 + i, gevuld: i < 8, kit: i < 8 }));
    return s;
  }
}
const eng = {
  focus: 'A', inst: {}, _speel: null, weiger: 0,
  decks: Object.fromEntries(DECKS.map((d) => [d, { buffer: null }])),
  speeltrack() { if (this.inst[this.focus]) return this.focus; if (this._speel && this.inst[this._speel]) return this._speel; return DECKS.find((d) => this.inst[d]) ?? null; },
  instrumentOp(id) { return this.inst[id] ?? null; },
  deck(id) { return this.decks[id]; },
  setFocus(id) { this.focus = id; if (this.inst[id]) this._speel = id; },
  zet(id, soort) { if (soort) this.inst[id] = new NepInst(soort); else delete this.inst[id]; if (soort && this.focus === id) this._speel = id; },
};
// De bus, zoveel als hier nodig: focus, instrumentknoppen, kiezen, FX-knoppen, fader.
const aangeroepen = [];
const stand = {};
const trackId = (nr) => DECKS[nr - 1];
const invoke = (id, v) => {
  aangeroepen.push([id, v]);
  let m;
  if ((m = /^track\.(\d)\.focus$/.exec(id)) && v) eng.setFocus(trackId(+m[1]));
  else if ((m = /^track\.(\d)\.inst\.knob\.(\d)$/.exec(id))) eng.inst[trackId(+m[1])]?.zetParam(+m[2], v);
  else if ((m = /^track\.(\d)\.inst\.choose$/.exec(id))) {
    if (eng.weiger > 0) { eng.weiger--; return true; }   // een spelend nummer: eerst een melding
    eng.zet(trackId(+m[1]), KEUZES[Math.round(v * (KEUZES.length - 1))]);
  } else if (!globalThis.__busPatronen?.(id, v) && !globalThis.__busSecties?.(id, v)) stand[id] = v;
  return true;
};
const read = (id) => {
  let m;
  if ((m = /^track\.(\d)\.inst\.knob\.(\d)$/.exec(id))) return eng.inst[trackId(+m[1])]?.leesParam(+m[2]) ?? null;
  const pv = globalThis.__leesPatronen?.(id);
  if (pv !== undefined) return pv;
  const sv = globalThis.__leesSecties?.(id);
  if (sv !== undefined) return sv;
  return id in stand ? stand[id] : null;
};

let nu = 1000;
const noten = new Noten({ engine: eng, read, invoke, nu: () => nu });
noten.laadMapping(lees('../mappings/xboard49.json'));

// ---- 1. het profiel en de indeling --------------------------------------------------------
console.log('het profiel (virtuele MIDI van de hub) en mappings/maschine-mk2.json');
ok('48 knoppen; groep A–H = noot 24–31, SHIFT 39, PLAY 36, het wiel 23, ENTER 21 (kanaal 1)',
  M.KNOPPEN.length === 48 && M.GROEPEN.join() === 'groepA,groepB,groepC,groepD,groepE,groepF,groepG,groepH'
  && M.knopNoot('groepA') === 24 && M.knopNoot('shift') === 39 && M.knopNoot('play') === 36 && M.knopNoot('wiel') === 23 && M.knopNoot('enter') === 21);
ok('pads 36–51 op kanaal 0, pad 1 = 36; draaiknoppen CC 16–23, het wiel CC 24',
  M.padNoot(1) === 36 && M.padNoot(16) === 51 && M.padVanNoot(35) === null && M.padVanNoot(52) === null
  && M.encoderSig(1) === 'cc:0:16' && M.encoderSig(8) === 'cc:0:23' && M.WIEL_SIG === 'cc:0:24');
ok('de namen bij de bits zijn die van de hub (src/devices/maschine-mk2.js)', M.KNOPPEN[0] === 'f1' && M.KNOPPEN[9] === 'step' && M.KNOPPEN[37] === 'rec' && M.KNOPPEN[47] === 'mute');
ok('het profiel noemt elk element (label), geen enkele action', M.maschineMk2.label('note:1:39') === 'SHIFT' && M.maschineMk2.label('note:0:36') === 'pad 1'
  && !JSON.stringify([...M.maschineMk2.controls.values()]).includes('track.'));
const kaart = lees('../mappings/maschine-mk2.json');
const ms0 = new Maschine({ engine: eng, noten, read, invoke, nu: () => nu });
const uitKaart = ms0.laadMapping(kaart);
// 64 regels sinds de knoppagina's (studio/maschine-dj): de 32 van spelen en patronen, plus Strip en Rack (elk 8 + 8 fijn).
// 69 sinds bladeren (docs/MASCHINE.md §5e): BROWSE, en in de laag bladeren ◄ ►, ENTER en het wiel indrukken.
// 73 sinds de padmodus sampler (§5f): in de laag sampler draaiknop 5 (volume, + fijn) en ◄ ► (tellen).
ok('mappings/maschine-mk2.json laadt zonder fouten: 73 regels, shift = note:1:39', uitKaart.aantal === 73 && !uitKaart.fouten.length && ms0.mapping.shiftSig === 'note:1:39');
ok('groep A–H -> track.1–8.focus (trigger)', kaart.rules.slice(0, 8).every((r, i) => r.in === `note:1:${24 + i}` && r.action === `track.${i + 1}.focus` && r.mode === 'trigger'));
ok('draaiknop 1–8 -> track.{speel}.inst.knob.1–8, relatief (tweecomplement), 1/1000 per tel, met shift 1/5000',
  kaart.rules.slice(8, 24).every((r) => r.mode === 'relative-2c' && /^track\.\{speel\}\.inst\.knob\.[1-8]$/.test(r.action) && r.step === (r.shift ? 0.0002 : 0.001)));
{
  // Zonder laag (de stand spelen); de lagen bladeren en sampler hebben hun eigen controles.
  const regel = (sig, shift = false) => kaart.rules.find((r) => r.in === sig && !!r.shift === shift && !r.laag)?.action;
  ok('transport: PLAY = track.{speel}.pattern.{plek} (SHIFT: .now), RESTART = .pattern.stop (SHIFT: .now), REC = patterns.record, ERASE = .pattern.clear, SHIFT + ◄ ► = korter/langer',
    regel('note:1:36') === 'track.{speel}.pattern.{plek}' && regel('note:1:36', true) === 'track.{speel}.pattern.{plek}.now'
    && regel('note:1:32') === 'track.{speel}.pattern.stop' && regel('note:1:32', true) === 'track.{speel}.pattern.stop.now'
    && regel('note:1:37') === 'patterns.record' && regel('note:1:38') === 'track.{speel}.pattern.clear'
    && regel('note:1:33', true) === 'track.{speel}.pattern.length.down' && regel('note:1:34', true) === 'track.{speel}.pattern.length.up'
    && !regel('note:1:33') && !regel('note:1:34') && !regel('note:1:9') && !regel('note:1:41'));
  const inLaag = (sig, laag, shift = false) => kaart.rules.find((r) => r.in === sig && r.laag === laag && !!r.shift === shift)?.action;
  ok('laag sampler: ◄ ► = sampler.length.down/up, draaiknop 5 = sampler.volume (SHIFT fijn)',
    inLaag('note:1:33', 'sampler') === 'sampler.length.down' && inLaag('note:1:34', 'sampler') === 'sampler.length.up'
    && inLaag('cc:0:20', 'sampler') === 'sampler.volume' && inLaag('cc:0:20', 'sampler', true) === 'sampler.volume');
}
ok('elke action in de indeling bestaat in de uitleg (apc-beschrijf), ook {speel}', kaart.rules.every((r) => !beschrijf(r.action).lang.startsWith('?') && beschrijf(r.action).kort !== r.action)
  && /speeltrack/.test(beschrijf('track.{speel}.inst.knob.1').lang) && !/\?/.test(beschrijf('track.3.inst.choose').lang));

// ---- 2. de Maschine: pads, groepen, draaiknoppen, wiel ---------------------------------------
console.log('\nde Maschine in de speelmodus');
const leds = [], schermen = [];
const poort = {
  in: { id: BRON, name: 'Maschine MK2 (hub)', state: 'connected', onmidimessage: null, onstatechange: null },
  uit: { id: 'uit', name: 'Maschine MK2 (hub)', state: 'connected', send: (b) => leds.push([...b]) },
  scherm: (nr, data) => schermen.push({ nr, data, t: nu }),
};
const ms = new Maschine({ engine: eng, noten, read, invoke, nu: () => nu });
ms.laadMapping(kaart);
ms.koppel(poort);
const stuur = (...b) => poort.in.onmidimessage({ data: Uint8Array.from(b), timeStamp: nu });
const knop = (naam, aan = true) => stuur(aan ? 0x91 : 0x81, M.knopNoot(naam), aan ? 127 : 0);
const tik = (naam) => { knop(naam, true); knop(naam, false); };

stuur(0x90, 36, 100);
ok('pad zonder instrument ergens: niets (noten meldt "geen")', noten.vast.size === 0);
stuur(0x80, 36, 0);
eng.zet('B', 'drums');
tik('groepB');
ok('groep B -> track.2.focus (over de bus), loslaten naar dezelfde action', eng.focus === 'B'
  && JSON.stringify(aangeroepen.slice(-2)) === JSON.stringify([['track.2.focus', true], ['track.2.focus', false]]));
const dr = eng.inst.B;
stuur(0x90, 36, 102);
ok('pad 1 (noot 36, velocity 102) -> noteOn(36, 102/127) op de speeltrack (de drums)', JSON.stringify(dr.log.at(-1)) === JSON.stringify(['aan', 36, 102 / 127]) && noten.ingedrukt('B').has(36));
stuur(0xa0, 36, 64);
ok('polyfone aftertouch -> druk(64/127, 36)', dr.log.at(-1)[0] === 'druk' && dicht(dr.log.at(-1)[1], 64 / 127) && dr.log.at(-1)[2] === 36);
stuur(0x80, 36, 0);
ok('pad los -> noteOff(36)', JSON.stringify(dr.log.at(-1)) === JSON.stringify(['uit', 36]) && !noten.ingedrukt('B').has(36));
stuur(0x90, 51, 90);
ok('pad 16 = noot 51 (de drums liggen precies op 36–51)', dr.log.at(-1)[1] === 51);
eng.zet('A', 'poly');
tik('groepA');
stuur(0x80, 51, 0);
ok('focus wisselt met pad 16 nog vast: zijn loslaten gaat naar de drums (track 2), niet naar de Poly', dr.log.at(-1)[0] === 'uit' && dr.log.at(-1)[1] === 51 && !eng.inst.A.log.length);
stuur(0x90, 40, 80);
ok('een ander instrument (Poly op track 1) krijgt dezelfde noten (40 = E2)', eng.inst.A.log.at(-1)[0] === 'aan' && eng.inst.A.log.at(-1)[1] === 40);
stuur(0x80, 40, 0);

// Draaiknoppen: relatief, in tellen van de hub (pas na 12 tellen, ±1000 per omwenteling).
const p = eng.inst.A;
stuur(0xb0, 16, 12);
ok('draaiknop 1 rechtsom 12 tellen: knop 1 van de speeltrack 0,5 -> 0,512', dicht(p.leesParam(1), 0.512));
stuur(0xb0, 23, 128 - 50);
ok('draaiknop 8 linksom 50 tellen (tweecomplement 78): knop 8 0,5 -> 0,45', dicht(p.leesParam(8), 0.45));
knop('shift', true);
stuur(0xb0, 16, 50);
ok('met SHIFT fijn: 50 tellen = +0,01', dicht(p.leesParam(1), 0.522));
knop('shift', false);
ok('SHIFT gaat niet over de bus', !aangeroepen.some(([id]) => id === 'shift'));
for (let i = 0; i < 100; i++) stuur(0xb0, 16, 63);
ok('een hele omwenteling en meer: geklemd op 1', p.leesParam(1) === 1);
tik('groepC');
stuur(0xb0, 17, 20);
ok('focus op een lege track: de draaiknoppen blijven op de speeltrack (track 1)', eng.focus === 'C' && dicht(p.leesParam(2), 0.52));

// Het masterwiel: kiezen op het scherm, indrukken = zetten.
const voor = aangeroepen.length;
stuur(0xb0, 24, 1);
ok('wiel één klik: een keuze voor de focus-track (track 3: Poly), nog niets gezet', ms.stand().kandidaat?.naam === INSTRUMENTEN[0].naam && aangeroepen.length === voor && !eng.inst.C);
stuur(0xb0, 24, 2);
ok('nog twee klikken: het derde instrument in de rij', ms.stand().kandidaat?.naam === INSTRUMENTEN[2].naam);
ok('… ENTER brandt zolang er een keuze staat', ms.ledBeeld().get(`1:${M.knopNoot('enter')}`) === 127);
tik('wiel');
ok('wiel indrukken -> track.3.inst.choose = 3/(n-1): het instrument staat erop, de keuze is weg',
  aangeroepen.some(([id, v]) => id === 'track.3.inst.choose' && dicht(v, 3 / (KEUZES.length - 1))) && eng.inst.C?.soort === INSTRUMENTEN[2].soort && ms.stand().kandidaat === null);
stuur(0xb0, 24, 127);
ok('wiel linksom vanaf het derde: het tweede', ms.stand().kandidaat?.naam === INSTRUMENTEN[1].naam);
nu += KANDIDAAT_MS + 1;
ok(`een keuze verloopt na ${KANDIDAAT_MS / 1000} s`, ms.stand().kandidaat === null && !ms.zetKeuze());
stuur(0xb0, 24, 1);
tik('groepA');
ok('focus wisselt: de keuze voor de oude focus vervalt', ms.stand().kandidaat === null);
tik('groepC');
stuur(0xb0, 24, 127 - 2);   // drie terug: -3 -> 'geen'
ok('wiel tot "geen"', ms.stand().kandidaat?.naam === 'geen');
eng.weiger = 1;            // er speelt een nummer: de bus wil een tweede druk binnen 3 s
tik('enter');
ok('ENTER zet ook; speelt er een nummer: "druk nog eens" op het scherm, de keuze blijft', ms.stand().melding?.includes('nog eens') && ms.stand().kandidaat?.naam === 'geen' && !!eng.inst.C);
tik('enter');
ok('… tweede druk: weg (geen instrument meer op track 3)', !eng.inst.C && ms.stand().kandidaat === null);
ok('wiel en ENTER zonder keuze: niets', !ms.zetKeuze());

// ---- 3. lampjes ------------------------------------------------------------------------
console.log('\nlampjes');
tik('groepB');                      // focus en speeltrack: de drums
let b = ms.ledBeeld();
const pad = (n) => b.get(`0:${35 + n}`);
const groep = (l) => b.get(`1:${M.knopNoot(`groep${l}`)}`);
ok(`pads: de kleur van het instrument gedimd (drums = ${KLEUREN.drums}donker), lege pads 9–16 donkergrijs`,
  pad(1) === PALETTE[`${KLEUREN.drums}donker`] && pad(8) === PALETTE[`${KLEUREN.drums}donker`] && pad(9) === PALETTE.donkergrijs && pad(16) === PALETTE.donkergrijs);
stuur(0x90, 37, 100);
b = ms.ledBeeld();
ok('een aanslag: fel (de volle kleur)', pad(2) === PALETTE[KLEUREN.drums]);
stuur(0x80, 37, 0);
b = ms.ledBeeld();
ok(`… en na het loslaten nog even (minstens ${FLITS_MS} ms: een drumslag duurt op de pad maar ~15 ms)`, pad(2) === PALETTE[KLEUREN.drums]);
nu += FLITS_MS + 1;
b = ms.ledBeeld();
ok('… daarna weer gedimd', pad(2) === PALETTE[`${KLEUREN.drums}donker`]);
eng.decks.D.buffer = {};            // een nummer op track 4
b = ms.ledBeeld();
ok('groepen: instrument = zijn kleur (focus vol, anders gedimd), nummer = wit gedimd, leeg = uit',
  groep('B') === PALETTE[KLEUREN.drums] && groep('A') === PALETTE[`${KLEUREN.poly}donker`] && groep('D') === PALETTE.grijs && groep('E') === PALETTE.uit);
tik('groepD');
b = ms.ledBeeld();
ok('… de focus op een nummer: wit; een lege focus: donkergrijs', groep('D') === PALETTE.wit && (tik('groepE'), ms.ledBeeld().get(`1:${M.knopNoot('groepE')}`) === PALETTE.donkergrijs));
ok('pads volgen de SPEELTRACK (focus op een lege track: de laatste met een instrument)', ms.ledBeeld().get('0:36') === PALETTE[`${KLEUREN.drums}donker`]);
knop('shift', true);
ok('SHIFT: zacht aan, fel zolang hij vastzit', ms.ledBeeld().get(`1:${M.knopNoot('shift')}`) === 127);
knop('shift', false);
ok('… los: zacht', ms.ledBeeld().get(`1:${M.knopNoot('shift')}`) === 16);
ok('elke kleur is een geldige paletindex, elke helderheid 0..127', [...ms.ledBeeld().values()].every((v) => Number.isInteger(v) && v >= 0 && v <= 127));
ok('zonder patroonspeler: STEP, PATTERN, PLAY, REC, ERASE, ◄ ► uit', ['step', 'pattern', 'play', 'rec', 'erase', 'restart', 'stapL', 'stapR'].every((k) => ms.ledBeeld().get(`1:${M.knopNoot(k)}`) === 0));

// tik(): alleen wat veranderde, via de uitgang van de nep-poort.
leds.length = 0;
ms.vergeet();
ms.tik();
const eerste = leds.length;
// 11 knoppen sinds de padmodus secties (6 okt): SCENE heeft nu ook een lampje (was 10, samen 34).
// 14 sinds de knoppagina's (studio/maschine-dj): ◄ ► links boven en CONTROL (uitleg) erbij.
// 17 sinds bladeren (§5e): BROWSE (uit zolang de bus geen library.toggle kent, zoals hier) en ◄ ► bij het wiel (altijd gezet).
// 18 sinds de padmodus sampler (§5f): SAMPLING.
ok(`eerste tik: alle lampjes (16 pads, 8 groepen, 18 knoppen = 42), als noot aan op hun nummer (${eerste})`,
  eerste === 42 && leds.every((m) => m.length === 3 && (m[0] === 0x90 || m[0] === 0x91) && m[2] <= 127));
leds.length = 0;
ms.tik();
ok('tweede tik zonder verandering: niets', leds.length === 0);
stuur(0x90, 38, 100);
ms.tik();
ok('een aanslag: precies één lampje (pad 3 fel)', leds.length === 1 && JSON.stringify(leds[0]) === JSON.stringify([0x90, 38, PALETTE[KLEUREN.drums]]));
stuur(0x80, 38, 0);

// ---- 4. de schermen ------------------------------------------------------------------------
console.log('\nde schermen');
schermen.length = 0;
ms.vergeet();
nu += 1000;
ms.tik();
ok('na vergeet: beide schermen, elk 2048 bytes', schermen.length === 2 && schermen.every((s) => s.data instanceof Uint8Array && s.data.length === 2048) && schermen[0].nr === 0 && schermen[1].nr === 1);
nu += 500;
ms.tik();
ok('niets veranderd: niets opnieuw', schermen.length === 2);
tik('groepB');                          // de focus wissel verandert de kop rechts: eerst laten bijwerken
nu += 1000;
ms.tik();
const n0 = schermen.length;
ok('een focuswissel: alleen het rechterscherm (focus-kop), links blijft', n0 === 3 && schermen.at(-1).nr === 1);
nu += 1000;
stuur(0xb0, 16, 30);
ms.tik();
ok('een knop draaien: het linkerscherm opnieuw (knop 1 staat links), het rechter niet', schermen.length === n0 + 1 && schermen.at(-1).nr === 0);
stuur(0xb0, 16, 30);
nu += SCHERM_MS / 2;
ms.tik();
ok(`binnen ${SCHERM_MS} ms nog eens gedraaid: wacht (tempo begrensd)`, schermen.length === n0 + 1);
nu += SCHERM_MS;
ms.tik();
ok('… daarna wel', schermen.length === n0 + 2);
const st = ms.stand();
ok('stand: speeltrack + instrument, acht knoppen met naam, waarde en tekst in eenheden', st.speel.nr === 2 && st.speel.naam === 'Drums' && st.knoppen.length === 8
  && st.knoppen[0].label === 'TOON' && dicht(st.knoppen[0].waarde, 0.56) && st.knoppen[2].tekst === `${Math.round(60 + 0.5 * 17940)} Hz` && st.knoppen[1].tekst === '50%');

// ---- 5. de verbinding valt weg ------------------------------------------------------------
console.log('\nde hub weg en terug');
stuur(0x90, 36, 100);
knop('shift', true);
poort.in.state = 'disconnected'; poort.uit.state = 'disconnected';
poort.in.onstatechange({});
ok('weg: de pad die vastzat laat los (noten), shift los', JSON.stringify(dr.log.at(-1)) === JSON.stringify(['uit', 36]) && !ms.mapping.shift);
leds.length = 0; schermen.length = 0;
ms.tik();
ok('weg: niets sturen', leds.length === 0 && schermen.length === 0);
poort.in.state = 'connected'; poort.uit.state = 'connected';
poort.in.onstatechange({});
nu += 1000;
ms.tik();
ok('terug: alle lampjes (42, met SCENE, ◄ ►, CONTROL, BROWSE, ◄ ► bij het wiel en SAMPLING) en beide schermen opnieuw', leds.length === 42 && schermen.length === 2);


// ---- 5b. patronen: de stapmodus en het transport ------------------------------------------------
console.log('\npatronen op de Maschine (stapmodus, PATTERN, transport)');
{
  // Een nep-patroonspeler en zijn actions (de echte: test/patronen*.test.mjs, en samen met de
  // Maschine in tools/headless/speelapparaten.mjs).
  const pats = {};
  const spoor = (id) => (pats[id] ??= { gekozen: 1, plekken: [null, null, null, null, null], speelt: null, stap: null, rec: false });
  const pt = (id, plek) => spoor(id).plekken[plek - 1];
  eng.patronen = {
    gekozen: (id) => spoor(id).gekozen,
    kies: (id, plek) => { spoor(id).gekozen = plek; },
    patroon: (id, plek) => pt(id, plek),
    stand: (id) => ({ gekozen: spoor(id).gekozen, speelt: spoor(id).speelt, wacht: null, stopt: false, stap: spoor(id).stap, laatsteNoot: 36 }),
    laatsteNoot: () => 36,
  };
  let rec = false;
  const vorigInvoke = invoke;
  const busPatronen = (id, v) => {
    let m;
    if ((m = /^track\.(\d)\.pattern\.step\.(\d+)$/.exec(id))) {
      if (!v) return true;
      const d = trackId(+m[1]), sp = spoor(d), s0 = +m[2] - 1;
      const p = (sp.plekken[sp.gekozen - 1] ??= { lengte: 16, stappen: new Set() });
      if (s0 < p.lengte) { if (p.stappen.has(s0)) p.stappen.delete(s0); else p.stappen.add(s0); }
      return true;
    }
    if ((m = /^track\.(\d)\.pattern\.length\.(up|down)$/.exec(id)) && v) {
      const sp = spoor(trackId(+m[1]));
      const p = (sp.plekken[sp.gekozen - 1] ??= { lengte: 16, stappen: new Set() });
      p.lengte = Math.max(16, Math.min(64, p.lengte + (m[2] === 'up' ? 16 : -16)));
      return true;
    }
    if (id === 'patterns.record') { if (v) rec = !rec; return true; }
    return false;
  };
  globalThis.__busPatronen = busPatronen;
  const leesPatronen = (id) => {
    let m;
    if ((m = /^track\.(\d)\.pattern\.step\.(\d+)$/.exec(id))) {
      const d = trackId(+m[1]); if (!eng.inst[d]) return null;
      const p = pt(d, spoor(d).gekozen), s0 = +m[2] - 1;
      if (s0 >= (p?.lengte ?? 16)) return null;
      return p?.stappen.has(s0) ? 1 : 0;
    }
    if ((m = /^track\.(\d)\.pattern\.([1-5])$/.exec(id))) { const d = trackId(+m[1]); return !eng.inst[d] ? null : spoor(d).speelt === +m[2] ? 1 : pt(d, +m[2])?.stappen.size ? 0.5 : 0; }
    if ((m = /^track\.(\d)\.pattern\.stop$/.exec(id))) { const d = trackId(+m[1]); return !eng.inst[d] ? null : spoor(d).speelt ? 0.5 : 0; }
    if ((m = /^track\.(\d)\.pattern\.clear$/.exec(id))) { const d = trackId(+m[1]); return !eng.inst[d] ? null : pt(d, spoor(d).gekozen)?.stappen.size ? 0.5 : 0; }
    if (id === 'patterns.record') return rec ? 1 : 0;
    return undefined;
  };
  globalThis.__leesPatronen = leesPatronen;
  const lamp = (naam) => ms.ledBeeld().get(`1:${M.knopNoot(naam)}`);
  const padLamp = (pad) => ms.ledBeeld().get(`0:${35 + pad}`);
  tik('groepB');                                   // speeltrack: de drums op track 2
  ok('met een patroonspeler: STEP en PATTERN zacht aan, REC zacht, PLAY/ERASE zacht (leeg)', lamp('step') === 16 && lamp('pattern') === 16 && lamp('rec') === 16 && lamp('play') === 8 && lamp('erase') === 8);
  const voor = aangeroepen.length;
  const dlog = dr.log.length;
  tik('step');
  ok('STEP: stapmodus, lampje fel', ms.modus === 'stappen' && lamp('step') === 127 && aangeroepen.length === voor);
  stuur(0x90, 36, 100); stuur(0x80, 36, 0);
  ok('pad 1 in de stapmodus -> track.2.pattern.step.1 (indrukken en los, over de bus), geen noot',
    JSON.stringify(aangeroepen.slice(voor)) === JSON.stringify([['track.2.pattern.step.1', true], ['track.2.pattern.step.1', false]]) && dr.log.length === dlog);
  ok('… lampje stap 1 = de read (1: de laatste noot staat erop) = de volle kleur; stap 2 leeg = donkergrijs', padLamp(1) === PALETTE[KLEUREN.drums] && padLamp(2) === PALETTE.donkergrijs);
  spoor('B').speelt = 1; spoor('B').stap = 2;
  ok('het gekozen patroon speelt: de stap die je hoort (3) is wit, PLAY fel', padLamp(3) === PALETTE.wit && lamp('play') === 127 && lamp('restart') === 32);
  spoor('B').speelt = null; spoor('B').stap = null;
  ok('16 stappen: ◄ ► uit (geen andere bladzijde)', lamp('stapL') === 0 && lamp('stapR') === 0);
  knop('shift', true); tik('stapR'); knop('shift', false);
  ok('SHIFT + ► -> track.2.pattern.length.up (de mapping): 32 stappen', aangeroepen.some(([a, v]) => a === 'track.2.pattern.length.up' && v === true) && pt('B', 1).lengte === 32 && ms.stand().patroon.bladzijden === 2);
  ok('… ► brandt nu (er is een tweede bladzijde)', lamp('stapR') === 32 && lamp('stapL') === 0);
  tik('stapR');
  stuur(0x90, 36, 100); stuur(0x80, 36, 0);
  ok('► : bladzijde 2, pad 1 = stap 17', ms.bladzijde === 1 && aangeroepen.some(([a]) => a === 'track.2.pattern.step.17') && pt('B', 1).stappen.has(16));
  tik('stapR');
  ok('… voorbij de laatste bladzijde: blijft staan', ms.bladzijde === 1);
  tik('stapL');
  ok('◄ : terug naar bladzijde 1', ms.bladzijde === 0);
  // Modus wisselen terwijl een pad vastzit: het loslaten gaat naar waar het indrukken heen ging.
  stuur(0x90, 37, 100);
  tik('step');
  const n0 = dr.log.length;
  stuur(0x80, 37, 0);
  ok('pad 2 vast in de stapmodus, STEP, los: het loslaten gaat naar de stap-action, niet naar noten', aangeroepen.at(-1)?.[0] === 'track.2.pattern.step.2' && aangeroepen.at(-1)[1] === false && dr.log.length === n0);
  stuur(0x90, 38, 90);
  tik('step');
  stuur(0x80, 38, 0);
  ok('pad 3 vast in de speelmodus, STEP, los: noteOff naar de drums (niets blijft hangen)', JSON.stringify(dr.log.at(-1)) === JSON.stringify(['uit', 38]) && ms.modus === 'stappen');
  stuur(0xa0, 39, 50);
  ok('aftertouch van een pad in de stapmodus: niet naar noten', dr.log.at(-1)[0] !== 'druk' || dr.log.at(-1)[2] !== 39);
  tik('step');
  ok('STEP nog eens: weer spelen', ms.modus === 'spelen');
  // PATTERN + pad = een plek kiezen.
  knop('pattern', true);
  ok('PATTERN vast: lampje fel; pads 1–5 = de plekken (1 gevuld = gedimd, de gekozen wit), 6–16 uit',
    lamp('pattern') === 127 && padLamp(1) === PALETTE.wit && padLamp(2) === PALETTE.donkergrijs && padLamp(6) === PALETTE.uit && padLamp(16) === PALETTE.uit);
  const voorKies = aangeroepen.length;
  stuur(0x90, 38, 100); stuur(0x80, 38, 0);
  ok('PATTERN + pad 3: plek 3 gekozen (engine.patronen.kies), niets gespeeld, niets op de bus', eng.patronen.gekozen('B') === 3 && aangeroepen.length === voorKies && JSON.stringify(dr.log.at(-1)) === JSON.stringify(['uit', 38]));
  ok('… het scherm: "kies patroon" met de vijf plekken', ms.stand().patroonVast && ms.stand().patroon?.plekken.length === 5 && ms.stand().patroon.plek === 3);
  stuur(0x90, 50, 100); stuur(0x80, 50, 0);
  ok('… pad 15 met PATTERN vast: niets', eng.patronen.gekozen('B') === 3);
  knop('pattern', false);
  // Transport via de mapping, op de gekozen plek van de speeltrack.
  const t0 = aangeroepen.length;
  tik('play');
  knop('shift', true); tik('play'); tik('restart'); knop('shift', false);
  tik('restart'); tik('rec'); tik('erase');
  const aan = aangeroepen.slice(t0).filter(([, v]) => v === true).map(([a]) => a);
  ok(`PLAY, SHIFT+PLAY, SHIFT+RESTART, RESTART, REC, ERASE -> de actions van het gekozen patroon (${aan.join(', ')})`,
    JSON.stringify(aan) === JSON.stringify(['track.2.pattern.3', 'track.2.pattern.3.now', 'track.2.pattern.stop.now', 'track.2.pattern.stop', 'patterns.record', 'track.2.pattern.clear']));
  ok('REC fel zolang er opgenomen wordt (de read)', lamp('rec') === 127);
  // Het scherm in de stapmodus.
  tik('step');
  const st = ms.stand();
  ok('stand in de stapmodus: plek, lengte, 16 stappen van deze bladzijde (voorbij de lengte null), noot, REC',
    st.modus === 'stappen' && st.patroon.plek === 3 && st.patroon.lengte === 16 && st.patroon.stappen.length === 16 && st.patroon.stappen.every((x) => x === 0) && st.patroon.noot === 'C2' && st.patroon.opnemen === true);
  const links = S.tekenScherm(st, 0), spelen = S.tekenScherm({ ...st, modus: 'spelen', patroon: null }, 0);
  ok('… het linkerscherm toont het patroon (16 vakjes), niet de knoppen', !links.every((x, i) => x === spelen[i]) && S.leesPixel(links, 1, 30) && S.leesPixel(links, 241, 43));
  ok('… het rechterscherm blijft knop 5–8', S.tekenScherm(st, 1).every((x, i) => x === S.tekenScherm({ ...st, modus: 'spelen', patroon: null }, 1)[i]));
  tik('step');
  eng.patronen = undefined;
}

// ---- 5c. secties: SCENE als padmodus (docs/MASCHINE.md §5b, docs/SECTIES.md) --------------------
console.log('\nsecties op de Maschine (SCENE)');
{
  const { SectieKaart } = await import('../src/engine/secties.js');
  const LABELS = ['intro', 'opbouw', 'drop', 'break', 'opbouw', 'drop', 'outro'], GROEP = 'ABCDBCE';
  const kaart7 = new SectieKaart({ stukken: LABELS.map((label, i) => ({ van: i * 16, label, groep: GROEP[i], energie: 0.5 })) });
  const kaart20 = new SectieKaart({ stukken: Array.from({ length: 20 }, (_, i) => ({ van: i * 8, label: 'deel', groep: 'ABCD'[i % 4], energie: 0.5 })) });
  // Nep-decks met wat maschine.js en de bus ervan lezen (de echte: test/secties.test.mjs, en in Chrome
  // tools/headless/sec-maschine.mjs): een nummer, zijn kaart, de sectie die je hoort en die op de volgende "1".
  const nepDeck = (kaart, hier) => ({ buffer: {}, sectieKaart: kaart, sectieHier: hier, sectieOpDeMaat: hier, vast: new Set() });
  eng.decks.D = nepDeck(kaart7, 2);                     // track 4: 7 secties, je hoort sectie 3
  eng.decks.F = nepDeck(kaart20, 0);                    // track 6: 20 secties (twee bladzijden)
  eng.decks.G = nepDeck(null, -1);                      // track 7: een nummer, (nog) geen secties
  const kaart50 = new SectieKaart({ stukken: Array.from({ length: 50 }, (_, i) => ({ van: i * 4, label: 'deel', groep: 'A', energie: 0.5 })) });
  eng.decks.H = nepDeck(kaart50, 0);                    // track 8: meer secties dan de bus kent (handwerk mag tot 64)
  const kaart36 = new SectieKaart({ stukken: Array.from({ length: 36 }, (_, i) => ({ van: i * 8, label: 'deel', groep: 'ABC'[i % 3], energie: 0.5 })) });
  // De bus zoals actions.js: track.N.section.K springt (valt in op de volgende "1": sectieOpDeMaat);
  // read: null = geen sectie op die plek, 0,5 = er is er een, 1 = die hoor je of drukt je in.
  globalThis.__busSecties = (id, v) => {
    const m = /^track\.(\d)\.section\.(\d+)$/.exec(id);
    if (!m) return false;
    const d = eng.decks[trackId(+m[1])], i = +m[2] - 1;
    if (d.vast) { if (v) d.vast.add(i); else d.vast.delete(i); }
    if (v && d.buffer && d.sectieKaart && i < d.sectieKaart.aantal) d.sectieOpDeMaat = i;
    return true;
  };
  globalThis.__leesSecties = (id) => {
    const m = /^track\.(\d)\.section\.(\d+)$/.exec(id);
    if (!m) return undefined;
    const d = eng.decks[trackId(+m[1])], i = +m[2] - 1;
    if (!d.buffer || !d.sectieKaart || i >= d.sectieKaart.aantal || i >= 40) return null;   // section.41+ bestaat niet (SECTIE_PADS)
    return d.vast?.has(i) || d.sectieHier === i ? 1 : 0.5;
  };
  const lamp = (naam) => ms.ledBeeld().get(`1:${M.knopNoot(naam)}`);
  const padLamp = (pad) => ms.ledBeeld().get(`0:${35 + pad}`);
  const pad = (p, aan = true) => stuur(aan ? 0x90 : 0x80, 35 + p, aan ? 100 : 0);
  const laatste = () => JSON.stringify(aangeroepen.at(-1));
  const sec = () => ms.stand().secties ?? {};
  const zelfde = (a, b, x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (S.leesPixel(a, x, y) !== S.leesPixel(b, x, y)) return false; return true; };
  const gelijkScherm = (a, b) => a.every((x, i) => x === b[i]);
  const cel = (p) => ({ x: ((p - 1) % 4) * 64, y: 20 + (3 - Math.floor((p - 1) / 4)) * 8 });
  // Een cel: de naam op (x+2, y); brandt hij (wit op de pad), dan omgekeerd: een vol vlak x..x+62, y-1..y+7, de letters uit.
  const celGoed = (buf, p, naam, aan) => {
    const { x, y } = cel(p), t = S.leegScherm();
    S.tekst(t, x + 2, y, naam);
    for (let yy = y; yy <= y + 6; yy++) for (let xx = x; xx <= x + 62; xx++) if (S.leesPixel(buf, xx, yy) !== (aan ? !S.leesPixel(t, xx, yy) : S.leesPixel(t, xx, yy))) return false;
    return !aan || (S.leesPixel(buf, x, y - 1) && S.leesPixel(buf, x + 62, y + 7) && !S.leesPixel(buf, x + 63, y));
  };

  tik('groepA');
  ok('SCENE uit als de focus-track geen secties heeft (track 1: de Poly)', lamp('scene') === 0);
  tik('groepD');                                        // focus: het nummer op track 4; de speeltrack blijft de drums (track 2)
  ok('SCENE zacht aan als de focus-track secties heeft', lamp('scene') === 16);
  const voor = aangeroepen.length;
  tik('scene');
  ok('SCENE: de padmodus secties, lampje fel, niets op de bus', ms.modus === 'secties' && lamp('scene') === 127 && aangeroepen.length === voor);
  ok('pads = de secties van de FOCUS-track (track 4, 7): die je hoort (3) wit, de andere donker hemelsblauw, 8–16 uit',
    padLamp(3) === PALETTE.wit && [1, 2, 4, 5, 6, 7].every((p) => padLamp(p) === PALETTE.hemelsblauwdonker) && [8, 9, 12, 16].every((p) => padLamp(p) === PALETTE.uit));
  const dlog = dr.log.length;
  pad(5);
  ok('pad 5 -> track.4.section.5 = true (over de bus: op de maat, in het log, de auto-DJ ziet het); geen noot op de speeltrack',
    laatste() === JSON.stringify(['track.4.section.5', true]) && dr.log.length === dlog && !noten.ingedrukt('B').has(40));
  ok('… zolang hij vastzit: pad 5 wit (de read)', padLamp(5) === PALETTE.wit && padLamp(3) === PALETTE.wit);
  ok('… het scherm: je hoort nog sectie 3, op de "1" komt sectie 5', sec().hoort === '3 drop C' && sec().naar === '5 opbouw B');
  const stV = ms.stand(), lV = S.tekenScherm(stV, 0);
  ok('… de ingedrukte pad (5) die je nog niet hoort brandt ook op het scherm: omgekeerd, net als 3 (die hoor je)',
    stV.secties?.aan?.[4] === true && stV.secties.aan[2] === true && celGoed(lV, 5, 'opbouw B', true) && celGoed(lV, 3, 'drop C', true) && celGoed(lV, 4, 'break D', false));
  pad(5, false);
  ok('… los -> track.4.section.5 = false; pad 5 donker hemelsblauw tot hij klinkt', laatste() === JSON.stringify(['track.4.section.5', false]) && padLamp(5) === PALETTE.hemelsblauwdonker);
  eng.decks.D.sectieHier = 4;                           // de "1": nu hoor je sectie 5
  ok('op de "1": pad 5 wit, pad 3 donker; het scherm noemt sectie 5, niets meer "op de 1"',
    padLamp(5) === PALETTE.wit && padLamp(3) === PALETTE.hemelsblauwdonker && sec().hoort === '5 opbouw B' && sec().naar === null);
  const st = ms.stand();
  st.secties ??= { namen: [], aan: [] };
  ok('stand: track 4, 7 secties, blad 1/1, de naam per pad (pad 8–16 null), wat brandt',
    st.modus === 'secties' && st.secties.nr === 4 && st.secties.aantal === 7 && st.secties.blad === 0 && st.secties.bladen === 1
    && st.secties.namen[0] === 'intro A' && st.secties.namen[3] === 'break D' && st.secties.namen[6] === 'outro E' && st.secties.namen[7] === null && st.secties.namen.length === 16
    && st.secties.aan[4] === true && st.secties.aan[2] === false);

  // Het scherm: links de sectie die je hoort (groot) en de namen zoals de pads liggen (pad 1 linksonder).
  const links = S.tekenScherm(st, 0);
  const kop = S.leegScherm(); S.tekst(kop, 2, 1, 'T4 5 opbouw B', 2);
  ok('linkerscherm: kop groot "T4 5 opbouw B" (de track en de sectie die je hoort)', zelfde(links, kop, 0, 255, 0, 15));
  ok('… pad 1 "intro A" linksonder, pad 4 "break D" rechtsonder, pad 7 "outro E" in de tweede rij van onder',
    celGoed(links, 1, 'intro A', false) && celGoed(links, 4, 'break D', false) && celGoed(links, 7, 'outro E', false));
  ok('… de sectie die je hoort (pad 5) omgekeerd: wit vlak, zwarte letters', celGoed(links, 5, 'opbouw B', true));
  ok('… pads zonder sectie (8–16): leeg', [8, 12, 13, 16].every((p) => { const { x, y } = cel(p); for (let yy = y - 1; yy <= y + 6; yy++) for (let xx = x; xx <= x + 63; xx++) if (S.leesPixel(links, xx, yy)) return false; return true; }));
  ok('… het rechterscherm blijft knop 5–8 van de speeltrack', S.tekenScherm(st, 1).every((x, i) => x === S.tekenScherm({ ...st, modus: 'spelen', secties: null }, 1)[i]));
  // tik(): het linkerscherm volgt wat je hoort.
  schermen.length = 0;
  ms.vergeet(); nu += 1000; ms.tik();
  const nS = schermen.length;
  eng.decks.D.sectieHier = 5;
  nu += 1000; ms.tik();
  ok('tik: een andere sectie hoorbaar -> alleen het linkerscherm opnieuw', nS === 2 && schermen.length === 3 && schermen.at(-1).nr === 0);
  ok('… en het lampje volgt (pad 6 wit, pad 5 donker)', padLamp(6) === PALETTE.wit && padLamp(5) === PALETTE.hemelsblauwdonker);

  // PATTERN vast gaat ook in de modus secties voor (zoals in de stapmodus): pad = een plek kiezen, geen sectie.
  let gekozen = 1;
  eng.patronen = { gekozen: () => gekozen, kies: (id, p) => { if (id === 'A') gekozen = p; }, patroon: () => null, stand: () => ({}), laatsteNoot: () => 36 };
  knop('pattern', true);
  const nP = aangeroepen.length;
  pad(2); pad(2, false);
  ok('PATTERN vast in de modus secties: pad 2 kiest plek 2 op de speeltrack (track 1), geen sectie over de bus', gekozen === 2 && aangeroepen.length === nP);
  ok('… de pads tonen de plekken (de gekozen wit, 6–16 uit), niet de secties', padLamp(2) === PALETTE.wit && padLamp(6) === PALETTE.uit);
  const stP = ms.stand();
  ok('… het linkerscherm: "kies patroon" zoals in de speelmodus, niet de secties',
    stP.patroonVast && !!stP.patroon && gelijkScherm(S.tekenScherm(stP, 0), S.tekenScherm({ ...stP, modus: 'spelen', secties: null }, 0))
    && !gelijkScherm(S.tekenScherm(stP, 0), S.tekenScherm({ ...stP, patroonVast: false }, 0)));
  eng.patronen = undefined;                             // zonder patroonspeler: PATTERN vast kiest niets, en het scherm toont geen secties
  const stQ = ms.stand();
  ok('… zonder patroonspeler: ook geen secties op het scherm (de pads kiezen dan niets)',
    stQ.patroonVast && !stQ.patroon && gelijkScherm(S.tekenScherm(stQ, 0), S.tekenScherm({ ...stQ, modus: 'spelen', secties: null }, 0)));
  knop('pattern', false);
  ok('PATTERN los: weer de secties (pad 6 wit: die hoor je)', padLamp(6) === PALETTE.wit && padLamp(2) === PALETTE.hemelsblauwdonker);

  // Meer dan 16 secties: ◄ ► (transport) bladeren, zoals in de stapmodus.
  tik('groepF');
  ok('groep F (20 secties): de pads volgen de focus; pad 1 wit (hoor je), pad 16 = sectie 16; ► half, ◄ uit',
    padLamp(1) === PALETTE.wit && padLamp(16) === PALETTE.hemelsblauwdonker && lamp('stapR') === 32 && lamp('stapL') === 0 && sec().bladen === 2);
  tik('stapR');
  ok('►: blad 2, pad 1–4 = sectie 17–20, 5–16 uit; ◄ half, ► uit',
    sec().blad === 1 && [1, 4].every((p) => padLamp(p) === PALETTE.hemelsblauwdonker) && padLamp(5) === PALETTE.uit && lamp('stapL') === 32 && lamp('stapR') === 0);
  pad(4); pad(4, false);
  ok('… pad 4 = track.6.section.20', aangeroepen.some(([a, v]) => a === 'track.6.section.20' && v === true));
  tik('stapR');
  ok('… voorbij de laatste bladzijde: blijft staan; de bladzijde van de stapmodus blijft ongemoeid', sec().blad === 1 && ms.bladzijde === 0);
  tik('stapL');
  ok('◄: terug naar blad 1', sec().blad === 0);
  // Een andere focus-track: het blad met de sectie die je daar hoort, anders blad 1 (review: het blad ging mee).
  eng.decks.C = nepDeck(kaart36, 2);                    // track 3: 36 secties, je hoort sectie 3
  eng.decks.E = nepDeck(kaart36, 17);                   // track 5: je hoort sectie 18
  tik('stapR');
  tik('groepC');
  ok('van blad 2 (track 6) naar track 3 (36 secties, je hoort 3): meteen blad 1 op de pads (het eerste lampjesbeeld), niet 17–32',
    padLamp(3) === PALETTE.wit && padLamp(1) === PALETTE.hemelsblauwdonker && sec().blad === 0);
  tik('stapR'); tik('stapR');
  ok('… ► ►: blad 3 (33–36)', sec().blad === 2 && padLamp(4) === PALETTE.hemelsblauwdonker && padLamp(5) === PALETTE.uit);
  tik('groepE');
  pad(2); pad(2, false);
  ok('naar track 5 (je hoort 18): meteen blad 2, ook zonder tik ertussen: pad 2 = track.5.section.18',
    aangeroepen.some(([a, v]) => a === 'track.5.section.18' && v === true) && !aangeroepen.some(([a]) => a === 'track.5.section.34') && sec().blad === 1 && padLamp(2) === PALETTE.wit);
  tik('groepF');
  ok('terug naar track 6 (je hoort 1): blad 1', padLamp(1) === PALETTE.wit && sec().blad === 0);
  // Meer dan 40 secties (de bus kent track.N.section.1–40): drie bladzijden, daarna niets.
  tik('groepH');
  tik('stapR'); tik('stapR'); tik('stapR');
  const nH = aangeroepen.length, hlog = eng.inst.A.log.length;
  pad(9); pad(9, false);
  ok('track 8 met 50 secties: drie bladzijden (tot 40, niet vier); pad 9 op blad 3 (= 41) doet niets, ook niet bij het loslaten',
    sec().bladen === 3 && sec().blad === 2 && aangeroepen.length === nH && eng.inst.A.log.length === hlog && padLamp(8) === PALETTE.hemelsblauwdonker && padLamp(9) === PALETTE.uit);
  eng.decks.H.sectieHier = 42; eng.decks.H.sectieOpDeMaat = 42;
  const stH = ms.stand();
  const kopH = S.leegScherm(); S.tekst(kopH, 2, 1, 'T8 43 A', 2);
  ok('je hoort sectie 43 (boven de 40: op geen pad): de kop noemt hem toch ("T8 43 A")', stH.secties?.hoort === '43 A' && zelfde(S.tekenScherm(stH, 0), kopH, 0, 255, 0, 15));
  eng.decks.H.sectieHier = 0; eng.decks.H.sectieOpDeMaat = 0;
  tik('stapL'); tik('stapL');

  // Geen secties op de focus-track.
  tik('groepG');
  ok('groep G (een nummer, nog geen secties): pads uit, SCENE fel (je zit in de modus), het scherm zegt het',
    [1, 5, 16].every((p) => padLamp(p) === PALETTE.uit) && lamp('scene') === 127 && sec().aantal === 0 && sec().wat === 'nummer');
  pad(1); pad(1, false);
  ok('… een pad gaat toch over de bus: die meldt waarom het niet kan (zoals op de APC)', laatste() === JSON.stringify(['track.7.section.1', false])
    && aangeroepen.at(-2)[0] === 'track.7.section.1');

  // Wisselen, en niets blijft hangen.
  tik('groepD');
  pad(2);
  tik('scene');
  ok('SCENE nog eens: weer spelen', ms.modus === 'spelen');
  const n0 = dr.log.length;
  pad(2, false);
  ok('pad 2 vast in de modus secties, SCENE, los: het loslaten gaat naar track.4.section.2, niet naar de drums',
    laatste() === JSON.stringify(['track.4.section.2', false]) && dr.log.length === n0 && !eng.decks.D.vast.size);
  pad(1);
  ok('… in de speelmodus speelt pad 1 weer op de speeltrack (de Poly op track 1: de laatste focus met een instrument)',
    eng.speeltrack() === 'A' && JSON.stringify(eng.inst.A.log.at(-1)?.slice(0, 2)) === JSON.stringify(['aan', 36]));
  pad(1, false);
  tik('scene'); tik('step');
  ok('STEP in de modus secties: de stapmodus (één padmodus tegelijk)', ms.modus === 'stappen');
  tik('scene');
  ok('SCENE in de stapmodus: secties', ms.modus === 'secties');
  pad(3);
  poort.in.state = 'disconnected';
  poort.in.onstatechange({});
  ok('de hub weg met een sectiepad vast: hij laat los (track.4.section.3 = false)', laatste() === JSON.stringify(['track.4.section.3', false]) && !eng.decks.D.vast.size);
  poort.in.state = 'connected';
  poort.in.onstatechange({});
  tik('scene');
  tik('groepB');
  ok('terug: spelen, focus op de drums', ms.modus === 'spelen' && eng.focus === 'B');
  globalThis.__busSecties = undefined; globalThis.__leesSecties = undefined;
}

// ---- 6. het scherm als pure functie ---------------------------------------------------------
console.log('\nmaschine-scherm.js');
{
  const buf = S.leegScherm();
  S.tekst(buf, 0, 0, 'T');
  ok('2048 bytes; een T op (0,0): bovenbalk aan, eronder alleen het midden', buf.length === 2048 && S.BYTES === 2048
    && [0, 1, 2, 3, 4].every((x) => S.leesPixel(buf, x, 0)) && S.leesPixel(buf, 2, 6) && !S.leesPixel(buf, 0, 6) && !S.leesPixel(buf, 5, 0));
  ok('hoogste bit = meest linkse pixel, 32 bytes per rij', buf[0] === 0xf8 && buf[32] === 0x20);
  const b2 = S.leegScherm();
  S.zetPixel(b2, 255, 63);
  ok('pixel (255, 63) = laatste byte, laagste bit', b2[2047] === 1 && S.leesPixel(b2, 255, 63));
  S.tekst(b2, 0, 10, 'A', 2);
  ok('schaal 2: een A van 10 × 14 pixels', S.leesPixel(b2, 2, 10) && S.leesPixel(b2, 3, 11) && !S.leesPixel(b2, 0, 10) && S.leesPixel(b2, 0, 12) && S.leesPixel(b2, 9, 23));
  ok('normaliseer: é -> e, − -> -, × -> x, ± blijft, onbekend -> ?', S.normaliseer('é−×±☃') === 'e-x±?');
  ok('pasIn: past al; spatie voor de eenheid weg; "halve tonen" kort; afkappen op een woord',
    S.pasIn('70%') === '70%' && S.pasIn('1,2 kHz bij A4') === '1,2kHz bij' && S.pasIn('+12 halve tonen') === '+12ht' && S.pasIn('open 550 ms') === 'open 550ms' && S.pasIn('abcdefghijklmn') === 'abcdefghij');
  // Elke echte eenheid van de instrumenten (poly, fm, drums) past in een kolom.
  const { PARAMS: POLY } = await import('../src/engine/instrumenten/poly.js');
  const { PARAMS: FM } = await import('../src/engine/instrumenten/fm.js');
  const { PARAMS: DR } = await import('../src/engine/instrumenten/drums.js');
  const teksten = [];
  for (const lijst of [POLY, FM, DR]) for (const q of lijst) { teksten.push(q.label); for (let i = 0; i <= 20; i++) teksten.push(q.eenheid(i / 20)); }
  const te = teksten.filter((t) => S.pasIn(t).length > S.KOLOM_TEKENS || !S.pasIn(t).length);
  ok(`elke naam en waarde van Poly, FM en Drums past in ${S.KOLOM_TEKENS} tekens (${teksten.length} teksten)${te.length ? `: ${te.slice(0, 3).join(' | ')}` : ''}`, te.length === 0);
  // Een volle stand: tekst blijft in zijn kolom, de balk volgt de waarde.
  const vol = { speel: { nr: 2, naam: 'Drums' }, focus: { nr: 2, wat: 'Drums' }, shift: true, kandidaat: null, melding: null,
    knoppen: Array.from({ length: 8 }, (_, i) => ({ label: 'WWWWWWWWWWWWWW', waarde: i / 7, tekst: '+12 halve tonen en meer' })) };
  const l = S.tekenScherm(vol, 0), r = S.tekenScherm(vol, 1);
  let buiten = 0;
  for (const s of [l, r]) for (let i = 0; i < 4; i++) for (let y = 21; y <= 38; y++) for (const x of [i * 64 + 61, i * 64 + 62]) if (S.leesPixel(s, x, y)) buiten++;
  ok('lange tekst blijft binnen zijn kolom (geen pixel op x+61/x+62)', buiten === 0);
  // De balk: rand op x+2 en x+60, de vulling ertussen (x+4 .. x+58).
  const vul = (s, i) => { let n = 0; for (let x = i * 64 + 4; x < i * 64 + 60; x++) if (S.leesPixel(s, x, 45)) n++; return n; };
  ok('de balk volgt de waarde: knop 1 (0) leeg, knop 8 (1) vol, ertussen oplopend', vul(l, 0) === 0 && vul(r, 3) >= 55 && vul(l, 1) < vul(l, 2) && vul(l, 2) < vul(l, 3));
  ok('kop: "T2 Drums" groot links bovenaan (pixels in rij 1–14), streep op rij 17', S.leesPixel(l, 2, 1) && S.leesPixel(l, 6, 14) && [0, 100, 255].every((x) => S.leesPixel(l, x, 17)));
  const leeg = S.tekenScherm({ speel: null, focus: { nr: 1, wat: 'leeg' }, knoppen: [] }, 0);
  let aan = 0; for (let y = 19; y < 52; y++) for (let x = 0; x < 256; x++) if (S.leesPixel(leeg, x, y)) aan++;
  let kopAan = 0; for (let y = 1; y < 16; y++) for (let x = 0; x < 256; x++) if (S.leesPixel(leeg, x, y)) kopAan++;
  ok('zonder instrument: kop "geen instrument", in de kolommen alleen de nummers (geen balken)', aan > 0 && aan < 200 && kopAan > 200 && !S.leesPixel(leeg, 30, 45));
  const kand = S.tekenScherm({ ...vol, kandidaat: { naam: 'FM' } }, 1);
  ok('een keuze van het wiel staat rechts groot, en verandert het scherm', !S.alsTekst(kand).split('\n').slice(1, 15).every((rij, y) => rij === S.alsTekst(r).split('\n')[y + 1]));
  ok('alsTekst: 64 regels van 256 tekens', S.alsTekst(l).split('\n').filter(Boolean).every((x) => x.length === 256) && S.alsTekst(l).split('\n').filter(Boolean).length === 64);
}

// ---- 7. de Xboard49: knop 9–16, de schuif, en een poort die wegvalt ----------------------------
console.log('\nde Xboard49 (noten.js, mappings/xboard49.json)');
{
  const doc = lees('../mappings/xboard49.json');
  ok('knop 9–16 = CC 31–38 (elk kanaal) -> track.{speel}.fx.knob.1–8, absoluut; de schuif -> track.{speel}.fader',
    doc.rules.length === 17 && doc.rules.slice(8, 16).every((r, i) => r.in === `cc:*:${31 + i}` && r.action === `track.{speel}.fx.knob.${i + 1}` && r.mode === 'absolute')
    && doc.rules[16].in === 'master-volume' && doc.rules[16].action === 'track.{speel}.fader' && doc.rules[16].mode === 'absolute');
  ok('leesMasterVolume: F0 7F 7F 04 01 ll mm F7 (14 bit), al het andere null', leesMasterVolume([0xf0, 0x7f, 0x7f, 0x04, 0x01, 0, 0x40, 0xf7]) === 8192 / 16383
    && leesMasterVolume([0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x7f, 0x7f, 0xf7]) === 1 && leesMasterVolume([0xf0, 0x7f, 0x7f, 0x04, 0x02, 0, 0x40, 0xf7]) === null && leesMasterVolume([0xf0, 0x47, 0xf7]) === null);
  const xb = { id: 'xb', name: 'Xboard49 (hub)', state: 'connected', onmidimessage: null, onstatechange: null };
  noten.koppel(xb);
  const zend = (...b) => xb.onmidimessage({ data: Uint8Array.from(b), timeStamp: nu });
  tik('groepB');                         // speeltrack: track 2 (drums)
  stand['track.2.fx.knob.3'] = 0.5;
  nu += 2000;
  zend(0xb0, 33, 64);
  ok('knop 11 (CC 33) dicht bij de stand -> track.2.fx.knob.3 (opgepakt)', dicht(stand['track.2.fx.knob.3'], 64 / 127));
  stand['track.2.fader'] = 0.8;
  const mv = (w) => zend(0xf0, 0x7f, 0x7f, 0x04, 0x01, w & 0x7f, (w >> 7) & 0x7f, 0xf7);
  nu += 10; mv(2000);
  ok('de schuif ver van de fader (0,12 tegen 0,8): nog niet opgepakt (geen sprong)', stand['track.2.fader'] === 0.8);
  nu += 10; mv(16000);
  ok('… door de stand heen: opgepakt, de fader van de speeltrack volgt (14 bit)', dicht(stand['track.2.fader'], 16000 / 16383));
  zend(0x90, 60, 100);
  ok('een noot van het keyboard speelt op de speeltrack', dr.log.at(-1)[0] === 'aan' && dr.log.at(-1)[1] === 60);
  xb.state = 'disconnected';
  xb.onstatechange({});
  ok('de poort valt weg (de hub-verbinding): zijn noot laat los', JSON.stringify(dr.log.at(-1)) === JSON.stringify(['uit', 60]));
  noten.ontkoppel(xb);
  ok('ontkoppelen zet onmidimessage en onstatechange terug', xb.onmidimessage === null && xb.onstatechange === null);
}

// ---- 8. een speelapparaat is nooit de controller (midi.js, ook zonder hub) ----------------------
console.log('\nmidi.js: een speelapparaat is nooit "de controller"');
{
  ok('isSpeelapparaat: Xboard49 en Maschine (ook de hub-poorten), de APC niet',
    isSpeelapparaat('E-MU Xboard49') && isSpeelapparaat('Xboard49 (hub)') && isSpeelapparaat('Maschine MK2 Virtual Input') && !isSpeelapparaat('APC40 mkII') && !isSpeelapparaat('LPD8'));
  const poortje = (id, name) => ({ id, name, state: 'connected', connection: 'open', onmidimessage: null, send() {} });
  const maak = (ins, outs = []) => {
    const h = new MidiHub();
    h.access = { inputs: new Map(ins.map((x) => [x.id, x])), outputs: new Map(outs.map((x) => [x.id, x])), onstatechange: null };
    h.enabled = true;
    return h;
  };
  const h1 = maak([poortje('x', 'E-MU Xboard49')]);
  h1._sync();
  ok('alleen de Xboard aangesloten (geen APC): geen controller gekozen', h1.inputId === null && h1.input() === null);
  const h2 = maak([poortje('x', 'E-MU Xboard49'), poortje('m', 'Maschine MK2 Virtual Input'), poortje('i', 'IAC Driver 1')]);
  h2._sync();
  ok('Xboard, Maschine en een doorgeefpoort: de doorgeefpoort, nooit een speelapparaat', h2.inputId === 'i');
  const h3 = maak([poortje('x', 'E-MU Xboard49'), poortje('a', 'APC40 mkII')]);
  h3.inputId = 'x'; h3.inputName = 'E-MU Xboard49';     // zoals een oude bewaarde keuze
  h3._sync();
  ok('een bewaarde keuze voor de Xboard vervalt: de APC', h3.inputId === 'a');
  h3.selectInput('x');
  ok('ook met de hand kiezen maakt hem niet de controller', h3.inputId === 'a');
  const gehoord = [];
  h3.onInput((m) => gehoord.push(m));
  h3.access.inputs.get('x').onmidimessage({ data: Uint8Array.of(0x90, 36, 100), timeStamp: 0 });
  ok('… zijn noten (36!) gaan dus nooit door de APC-mapping', gehoord.length === 0);
}

// ---- 10. knoppagina's en uitleg (tak studio/maschine-dj) ---------------------------------------
console.log("\nknoppagina's (◄ ► links boven) en uitleg (CONTROL)");
{
  const MS = await import('../src/control/maschine.js');
  const gelijk = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // Track 3 draagt een nummer, met een rack van zes plekken (plek 2 bipolair).
  eng.decks.C = { buffer: {}, title: 'Proefnummer', duration: 200, position: 20, bpm: 124, toonsoort: { camelot: '8A', kort: 'Am' },
    fx: { rackNaam: 'Oplossen', plekNaam: (k) => (k <= 6 ? ['ruimte', 'toon', 'duur', 'meng', 'diepte', 'snelheid'][k - 1] : null), plekBipolair: (k) => k === 2 } };
  const p2 = {
    in: { id: BRON, name: 'Maschine MK2 (hub)', state: 'connected', onmidimessage: null, onstatechange: null },
    uit: { id: 'uit2', name: 'Maschine MK2 (hub)', state: 'connected', send: () => {} },
    scherm: () => {},
  };
  const m2 = new Maschine({ engine: eng, noten, read, invoke, nu: () => nu, beschrijf });
  m2.laadMapping(kaart);
  m2.koppel(p2);
  const st = (...b) => p2.in.onmidimessage({ data: Uint8Array.from(b), timeStamp: nu });
  const kn = (naam, aan = true) => st(aan ? 0x91 : 0x81, M.knopNoot(naam), aan ? 127 : 0);
  const tk = (naam) => { kn(naam, true); kn(naam, false); };
  const draai = (k, tellen) => st(0xB0, 15 + k, tellen >= 0 ? tellen : 128 + tellen);
  const led = (naam) => m2.ledBeeld().get(`1:${M.knopNoot(naam)}`);
  const laatste = () => aangeroepen[aangeroepen.length - 1];

  ok('begint op de pagina Instrument; ◄ uit, ► half, CONTROL zacht', m2.pagina === 'instrument' && led('browseL') === 0 && led('browseR') === 32 && led('control') === 16);
  tk('groepC');
  tk('browseR');
  ok('► = de pagina Strip (een open mapje voor de mapping: pagina.strip); ◄ en ► nu allebei half', m2.pagina === 'strip' && led('browseL') === 32 && led('browseR') === 32);
  delete stand['track.3.trim'];
  draai(1, 20);
  ok('Strip: knop 1 = track.{focus}.trim, relatief: 20 tellen = +0,02 vanaf het midden', laatste()[0] === 'track.3.trim' && dicht(laatste()[1], 0.52));
  kn('shift', true); draai(1, 20); kn('shift', false);
  ok('… met SHIFT fijn: 20 tellen = +0,004', laatste()[0] === 'track.3.trim' && dicht(laatste()[1], 0.524));
  draai(8, -30);
  ok('… knop 8 = het filter van de focus-track (op de APC zit dat op de trackknop)', laatste()[0] === 'track.3.filter' && dicht(laatste()[1], 0.47));
  draai(2, 5);
  ok('… knop 2 = hoog; de knop die je net draaide staat omgekeerd, tot GEDRAAID_MS voorbij is', laatste()[0] === 'track.3.high' && m2.stand().gedraaid === 1
    && (nu += MS.GEDRAAID_MS + 1, m2.stand().gedraaid === null));
  Object.assign(stand, { 'track.3.trim': 0.5, 'track.3.high': 0.01, 'track.3.mid': 1, 'track.3.low': 0.5, 'track.3.send.a': 0.25, 'track.3.send.b': 0, 'track.3.fx.mix': 0.4, 'track.3.filter': 0.5 });
  let k = m2.stand().knoppen;
  ok('Strip op het scherm: trim, hoog, mid, laag, echo, galm, fx-mix, filter', k.map((x) => x.label).join() === 'trim,hoog,mid,laag,echo,galm,fx-mix,filter');
  ok('… in echte eenheden: 0 dB, kill, +8,0 dB (eqDb), 25%, open; EQ, trim en filter vanuit het midden',
    k[0].tekst === '0 dB' && k[1].tekst === 'kill' && k[2].tekst === '+8,0 dB' && k[4].tekst === '25%' && k[7].tekst === 'open'
    && k[0].bipolair && k[1].bipolair && k[7].bipolair && !k[4].bipolair);
  ok('… het filter zoals de engine het zet: links lowpass, rechts highpass (filterDoelen)', /^LP /.test(MS.filterTekst(0.2)) && /^HP /.test(MS.filterTekst(0.8)) && MS.filterTekst(0.501) === 'open');
  const dj = m2.stand().dj;
  ok('… de kop: de focus-track met titel, bpm, toonsoort en resterende tijd', dj.nr === 3 && dj.titel === 'Proefnummer' && dj.bpm === '124,0' && dj.toon === '8A Am' && dj.rest === '-3:00' && dj.wat === 'nummer');
  const schermStrip = S.tekenScherm(m2.stand(), 0);
  tk('browseR');
  Object.assign(stand, { 'track.3.fx.knob.1': 0.3, 'track.3.fx.knob.2': 0.75, 'track.3.fx.knob.3': 0.5, 'track.3.fx.knob.4': 1, 'track.3.fx.knob.5': 0, 'track.3.fx.knob.6': 0.6 });
  k = m2.stand().knoppen;
  ok('► = Rack: de namen die het rack zelf geeft (fx.plekNaam), plek 7 en 8 bestaan niet', m2.pagina === 'rack' && k[0].label === 'ruimte' && k[5].label === 'snelheid' && k[6].waarde === null && k[7].waarde === null);
  ok('… procenten, bipolair met teken (plek 2: +50%)', k[0].tekst === '30%' && k[1].tekst === '+50%' && k[1].bipolair && !k[0].bipolair);
  draai(3, 10);
  ok('… knop 3 = track.{focus}.fx.knob.3', laatste()[0] === 'track.3.fx.knob.3' && dicht(laatste()[1], 0.51));
  ok('… het scherm: de naam van het rack in de kop, en anders dan Strip', !gelijk([...schermStrip], [...S.tekenScherm(m2.stand(), 0)]));
  tk('browseR');
  ok('► op de laatste pagina: blijft Rack, ► uit', m2.pagina === 'rack' && led('browseR') === 0);
  tk('browseL'); tk('browseL');
  eng.zet('B', 'drums');
  const voor = eng.inst.B.leesParam(1);
  draai(1, 50);
  ok('◄ ◄ = terug op Instrument: knop 1 = weer de instrumentknop van de speeltrack', m2.pagina === 'instrument' && laatste()[0] === 'track.2.inst.knob.1' && dicht(eng.inst.B.leesParam(1), voor + 0.05));

  // Uitleg: CONTROL vasthouden.
  const focusVoor = eng.focus, aantal = aangeroepen.length;
  kn('control', true);
  ok('CONTROL vast: de uitleg (nog niets aangeraakt), CONTROL fel', m2.stand().uitleg && m2.stand().uitleg.titel === null && led('control') === 127);
  tk('groepA');
  ok('… groep A: NIET uitgevoerd (geen focus, niets op de bus)', eng.focus === focusVoor && aangeroepen.length === aantal);
  ok('… maar uitgelegd met de tekst van apc-beschrijf.js', m2.stand().uitleg.titel === 'groep A' && m2.stand().uitleg.tekst === beschrijf('track.1.focus').lang);
  draai(5, 20);
  ok('… een draaiknop: uitgelegd voor deze pagina, niets op de bus', aangeroepen.length === aantal && /draaiknop 5 \(Instrument\)/.test(m2.stand().uitleg.titel));
  tk('browseR');
  ok('… ◄ ► links boven: eigen uitleg, de pagina blijft staan', m2.pagina === 'instrument' && /knoppagina/.test(m2.stand().uitleg.tekst));
  const vastVoor = noten.vast.size;
  st(0x90, 40, 100);
  ok('… een pad: wat hij speelt, en hij speelt niet', noten.vast.size === vastVoor && /speelt E2 op/.test(m2.stand().uitleg.tekst));
  kn('control', false);
  st(0x80, 40, 0);
  ok('CONTROL los: geen uitleg meer; het loslaten van de pad uit de uitleg gaat nergens heen', m2.stand().uitleg === null && noten.vast.size === vastVoor && aangeroepen.length === aantal);
  st(0x90, 41, 100);
  kn('control', true);
  st(0x80, 41, 0);
  ok('een pad die al vóór CONTROL in zat, laat tijdens de uitleg gewoon los (niets blijft hangen)', noten.vast.size === vastVoor);
  const fel = led('browseR');
  nu += MS.KNIPPER_MS;
  ok('tijdens de uitleg knippert wat iets doet (◄ ►, STEP, PLAY …), de groepen houden hun kleur',
    fel !== led('browseR') && [fel, led('browseR')].sort((a, b) => a - b).join() === '8,127' && led('groepB') === PALETTE[`${KLEUREN.drums}donker`]);
  const links = S.tekenScherm(m2.stand(), 0);
  kn('control', false);
  tk('groepA');
  ok('… het scherm: UITLEG (anders dan spelen); daarna werkt groep A weer gewoon', !gelijk([...links], [...S.tekenScherm(m2.stand(), 0)]) && eng.focus === 'A');
  ok('regels(): woorden over regels van hooguit n letters', S.regels('een twee drie vier', 9).join('|') === 'een twee|drie vier' && S.regels('abcdefghijk', 5).join() === 'abcde');
}

// ---- 9. regels: zonder ?hub= laadt niets hiervan ------------------------------------------------
console.log('\nalleen met ?hub=');
{
  const app = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  const statisch = /^\s*import\s[^;]*['"][./]*(speelapparaten|control\/maschine|maschine-scherm)[^'"]*['"]/m.test(app);
  ok('app.js importeert speelapparaten.js / maschine.js niet statisch', !statisch && /await import\('\.\/speelapparaten\.js'\)/.test(app));
  const blok = app.slice(app.indexOf('if (hubUrl) {'), app.indexOf('window.midi = midiDelen.midi'));
  ok('… alleen binnen if (hubUrl)', /await import\('\.\/speelapparaten\.js'\)/.test(blok));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
