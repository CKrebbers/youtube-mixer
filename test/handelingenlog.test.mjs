// Het handelingenlog (docs/HANDELINGENLOG.md): vastleggen op een nep-klok,
// wegschrijven met een haperend netwerk (herhalen zonder dubbel, een gat blijft
// een gat), terugspelen in de juiste volgorde en op de juiste tijd, veilige
// paden, een rondje met een echte engine (Web Audio-mock), de grootte van een
// uur spelen, en de routes op een EIGEN server met tijdelijke mappen.
// Draai met: node test/handelingenlog.test.mjs
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- Web Audio-mock (zoals engine.test), voor het rondje met de echte engine ----
let NOW = 0;
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({ type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, connect(n) { return n; }, disconnect() {},
  getByteTimeDomainData(b) { b.fill(128); } });
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { return node('biquad'); }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { const n = node('delay'); n.delayTime = param(0); return n; }
  createWaveShaper() { const n = node('shaper'); n.curve = null; return n; }
  createChannelMerger() { return node('merger'); }
  createOscillator() { const n = node('osc'); n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.start = () => {}; s.stop = () => { queueMicrotask(() => s.onended?.()); }; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};

const A = await import('../src/control/actions.js');
const H = await import('../src/control/handelingen.js');
const T = await import('../src/control/terugspelen.js');
const S = await import('../server/handelingen.js');
const O = await import('../server/opname.js');

const map = mkdtempSync(join(tmpdir(), 'varve-handelingen-'));

/** Timers op bestelling: de test bepaalt wanneer "een seconde" om is. */
function nepTimers() {
  const lijst = new Set();
  return {
    elke: (fn) => { const h = { fn }; lijst.add(h); return h; },
    stopElke: (h) => lijst.delete(h),
    tik: () => { for (const h of [...lijst]) h.fn(); },
    aantal: () => lijst.size,
  };
}

/**
 * Een nep-haal die de ECHTE server/handelingen.js aanroept, met storingen per
 * stuk (herkend aan zijn plek `van`: het n-de stuk dat binnenkomt).
 */
function nepServer(dir, storing = {}) {
  const stukken = [];            // van-waarden in volgorde van eerste aankomst
  const pogingen = new Map();    // van -> aantal pogingen
  const antwoord = (r) => ({ ok: r.ok, status: r.ok ? 200 : 400, json: async () => r });
  const haal = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url === '/api/handelingen/start') return antwoord(await S.start(dir, { id: body.id }));
    const m = /^\/api\/handelingen\/([\w-]+)\/stuk$/.exec(url);
    if (!m) throw new Error(`onbekend: ${url}`);
    if (!stukken.includes(body.van)) stukken.push(body.van);
    const nr = stukken.indexOf(body.van);
    const n = (pogingen.get(body.van) || 0) + 1;
    pogingen.set(body.van, n);
    if (storing.altijdWeg?.has(nr)) throw new Error('netwerk weg');
    if (storing.valWeg?.has(nr) && n === 1) throw new Error('verzoek kwijt');
    const r = await S.schrijf(dir, m[1], body.van, body.tekst);
    // De server schreef het wel, maar het antwoord komt nooit aan.
    if (storing.antwoordKwijt?.has(nr) && n === 1) throw new Error('antwoord kwijt');
    return antwoord(r);
  };
  return { haal, stukken, pogingen };
}

try {
  console.log('ASCII en lezen');
  {
    const x = { titel: 'Café — “zoned out” 🎛', n: 0.1 + 0.2 };
    const t = H.asciiJson(x);
    ok('asciiJson: alleen ASCII, één teken = één byte', /^[\x20-\x7e]*$/.test(t) && Buffer.byteLength(t) === t.length);
    ok('en JSON.parse geeft precies hetzelfde terug', JSON.stringify(JSON.parse(t)) === JSON.stringify(x));
    const l = H.leesLog('{"t":0,"e":"kop","versie":1}\n[0.5,"a",1]\n\0\0\0\0[0.7,"b",true]\n[0.9,"c"');
    ok('leesLog: nullen (een gat) weg, halve staart overgeslagen en geteld', l.regels.length === 3 && l.kapot === 1 && l.kop?.versie === 1 && l.duur === 0.7);
  }

  console.log('\nde bus: meeluisteren');
  {
    const volgorde = [];
    A.define('test.knop', 'trigger', (on) => volgorde.push(`fn:${on}`));
    A.define('test.fader', 'value', (v) => volgorde.push(`fn:${v}`));
    const weg = A.bijInvoke((id, v) => volgorde.push(`log:${id}:${v}`));
    const stuk = A.bijInvoke(() => { throw new Error('kapotte luisteraar'); });
    A.invoke('test.knop', true);
    A.invoke('bestaat.niet', 1);
    ok('de luisteraar hoort het VÓÓR de action draait', volgorde.join(' ') === 'log:test.knop:true fn:true');
    ok('een onbekende action komt niet in het log, een kapotte luisteraar breekt de bus niet', volgorde.length === 2);
    weg(); stuk();
    A.invoke('test.fader', 0.25);
    ok('ophouden met luisteren', volgorde.length === 3);
  }

  console.log('\nvastleggen met een nep-klok');
  const dir1 = join(map, 'een');
  {
    let klokT = 100;                 // de audioklok staat niet op 0 als het log begint
    const timers = nepTimers();
    const srv = nepServer(dir1);
    const log = new H.Handelingenlog({ klok: () => klokT, haal: srv.haal, wacht: async () => {}, elke: timers.elke,
      stopElke: timers.stopElke, datum: () => new Date('2026-09-25T20:00:00Z') });
    const weg = A.bijInvoke((id, v) => log.neem(id, v));
    A.invoke('test.fader', 0.1);                // vóór de start: niets
    const begin = log.start({ stand: { focus: 1, tracks: [] } });
    ok('vastleggen begint meteen, vóór de server antwoordt', log.bezig && log.id === null);
    klokT = 100.25; A.invoke('test.fader', 0.5039370078740157);
    klokT = 100.5; A.invoke('test.knop', true);
    klokT = 100.5; A.invoke('test.knop', false);
    const r = await begin;
    ok(`de server geeft een id (${r.id})`, r.ok && /^\d{8}-\d{6}/.test(r.id) && log.id === r.id);
    timers.tik();
    klokT = 101.7; log.gebeurtenis('focus', { track: 3 });
    klokT = 102.0000004; A.invoke('test.fader', 1);
    const eind = await log.stop();
    weg();
    ok('stop: timer weg, niet meer bezig', !log.bezig && timers.aantal() === 0);
    const l = H.leesLog(readFileSync(join(dir1, `set-${r.id}.acties.jsonl`), 'latin1'));
    const acties = l.regels.filter(Array.isArray);
    ok('kop: versie, klok bij de start, wanneer', l.kop?.versie === H.LOG_VERSIE && l.kop.klok === 100 && l.kop.begon === '2026-09-25T20:00:00.000Z');
    ok('beginstand als tweede regel', l.regels[1]?.e === 'stand' && l.regels[1].focus === 1);
    ok('tijden relatief aan de start, op 1 µs', JSON.stringify(acties.map((a) => a[0])) === JSON.stringify([0.25, 0.5, 0.5, 2]));
    ok('naam en waarde precies zoals op de bus (volle precisie)', acties[0][1] === 'test.fader' && acties[0][2] === 0.5039370078740157);
    ok('triggers als true/false, in volgorde', acties[1][2] === true && acties[2][2] === false);
    ok('gebeurtenis ertussen op zijn tijd', l.regels.find((x) => x.e === 'focus')?.t === 1.7);
    ok('eind-regel, en het aantal regels klopt', l.eind?.regels === l.regels.length && eind.regels === l.regels.length);
    ok('bytes = bestandsgrootte', eind.bytes === statSync(join(dir1, `set-${r.id}.acties.jsonl`)).size);
  }

  console.log('\nwegschrijven: haperend netwerk, geen dubbele regels');
  const dir2 = join(map, 'twee');
  {
    let klokT = 0;
    const timers = nepTimers();
    // stuk 0 = kop+stand; 1: antwoord kwijt; 2: verzoek kwijt; 3: drie keer weg; 4: gewoon
    const srv = nepServer(dir2, { antwoordKwijt: new Set([1]), valWeg: new Set([2]), altijdWeg: new Set([3]) });
    const fouten = [];
    const log = new H.Handelingenlog({ klok: () => klokT, haal: srv.haal, wacht: async () => {}, elke: timers.elke, stopElke: timers.stopElke });
    log.onFout = (f) => fouten.push(f);
    const r = await log.start({ stand: { tracks: [] } });
    const verwacht = [];
    for (let sec = 1; sec <= 4; sec++) {
      for (let k = 0; k < 5; k++) {
        klokT = sec + k / 10;
        log.neem(`track.${sec}.fader`, k / 4);
        if (sec !== 3) verwacht.push(`${klokT}|track.${sec}.fader|${k / 4}`);
      }
      timers.tik();
      await log.sessie.rij;
    }
    await log.stop();
    const pad = join(dir2, `set-${r.id}.acties.jsonl`);
    const ruw = readFileSync(pad, 'latin1');
    const l = H.leesLog(ruw);
    const gelezen = l.regels.filter(Array.isArray).map((a) => `${a[0]}|${a[1]}|${a[2]}`);
    ok('antwoord kwijt: opnieuw geschreven op DEZELFDE plek, niet dubbel', srv.pogingen.get(srv.stukken[1]) === 2
      && gelezen.filter((x) => x.startsWith('1|')).length === 1);
    ok('verzoek kwijt: tweede poging kwam aan', srv.pogingen.get(srv.stukken[2]) === 2);
    ok('drie keer weg: gemeld, en een gat van nullen op zijn plek', fouten.length === 1 && /stuk kwijt/.test(fouten[0]) && ruw.includes('\0'));
    ok(`alles behalve het verloren stuk staat er precies één keer, in volgorde (${gelezen.length}/${verwacht.length})`,
      JSON.stringify(gelezen) === JSON.stringify(verwacht));
    ok('en het stuk NA het gat staat op zijn eigen plek (eind-regel leesbaar)', l.eind !== null && l.kapot === 0);
  }

  console.log('\nveilige paden en keuring (server/handelingen.js)');
  {
    const dir = join(map, 'drie');
    const s = await S.start(dir, { nu: new Date(2026, 8, 25, 9, 0, 0) });
    ok('los log: nieuw id', s.ok && !s.opname && s.id === '20260925-090000');
    const kwaad = ['../../etc/passwd', '..', 'set-x', '20260925-120000/../../x', '', null, 42];
    const r1 = await Promise.all(kwaad.map((id) => S.schrijf(dir, id, 0, '[0,"a",1]\n')));
    ok('schrijven met een onzin-id (../, leeg, getal): geweigerd', r1.every((x) => !x.ok));
    const r2 = await Promise.all(kwaad.filter((x) => x !== null).map((id) => S.start(dir, { id })));
    ok('starten met een onzin-opname-id: geweigerd', r2.every((x) => !x.ok));
    ok('pad() met ../: geweigerd', !(await S.pad(dir, '../../etc/passwd')).ok);
    ok('bij een opname die niet bestaat: geweigerd', !(await S.start(dir, { id: '20260101-000000' })).ok);
    ok('geen ASCII: geweigerd', !(await S.schrijf(dir, s.id, 0, '[0,"café",1]\n')).ok);
    ok('geen JSON: geweigerd', !(await S.schrijf(dir, s.id, 0, '[0,"a",1]\nrm -rf\n')).ok);
    ok('zonder regeleinde: geweigerd', !(await S.schrijf(dir, s.id, 0, '[0,"a",1]')).ok);
    ok('van negatief, gebroken of geen getal: geweigerd', !(await S.schrijf(dir, s.id, -1, '[0]\n')).ok
      && !(await S.schrijf(dir, s.id, 1.5, '[0]\n')).ok && !(await S.schrijf(dir, s.id, '0', '[0]\n')).ok);
    ok('van ver voorbij het eind: geweigerd', !(await S.schrijf(dir, s.id, 300 * 1024 * 1024, '[0]\n')).ok);
    ok('een log dat niet bestaat: geweigerd', !(await S.schrijf(dir, '20990101-000000', 0, '[0]\n')).ok);
    // Een opname en een los log in dezelfde seconde: nooit hetzelfde id.
    const nu = new Date(2026, 8, 25, 21, 0, 0);
    const los = await S.start(dir, { nu });
    const opn = await O.start(dir, { nu });
    ok(`opname in dezelfde seconde als een los log: eigen id (${los.id} / ${opn.id})`, los.ok && opn.ok && los.id !== opn.id);
    const bij = await S.start(dir, { id: opn.id });
    ok('log van een opname: zelfde id', bij.ok && bij.id === opn.id && bij.opname === true);
    const nogEens = await S.start(dir, { id: opn.id });
    ok('nog eens (antwoord kwijt): goed, niets overschreven', nogEens.ok && nogEens.bestond === true);
    // Maar staat er al iets in, dan is het geen herhaalde start: wie dan "ok"
    // krijgt, schrijft vanaf byte 0 over dat log heen.
    await S.schrijf(dir, opn.id, 0, '{"t":0,"e":"kop","versie":1}\n');
    const weer = await S.start(dir, { id: opn.id });
    ok(`een log dat al loopt of af is: niet nog eens beginnen (${weer.fout})`, !weer.ok
      && readFileSync(join(dir, `set-${opn.id}.acties.jsonl`), 'latin1').startsWith('{"t":0,"e":"kop"'));
    const los2 = await S.start(dir, { nu });
    ok('een los log daarna in dezelfde seconde: weer een eigen id', los2.ok && ![los.id, opn.id].includes(los2.id));
    // Samenvatting: netjes af, of afgebroken met een halve staart.
    await S.schrijf(dir, los.id, 0, '{"t":0,"e":"kop","versie":1,"begon":"2026-09-25T19:00:00.000Z"}\n[1.5,"a",1]\n{"t":2,"e":"eind","regels":3}\n');
    writeFileSync(join(dir, `set-${los2.id}.acties.jsonl`), '{"t":0,"e":"kop","versie":1}\n[3.25,"a",1]\n[4,"b",tr');
    const lijst = await S.lijst(dir);
    const a = lijst.find((x) => x.id === los.id), b = lijst.find((x) => x.id === los2.id), c = lijst.find((x) => x.id === opn.id);
    ok('lijst: af, duur en wanneer uit kop en staart', a?.af === true && a.duur === 2 && a.begon === '2026-09-25T19:00:00.000Z' && a.opname === false);
    ok('afgebroken (crash): niet af, duur tot de laatste hele regel', b?.af === false && b.duur === 3.25);
    ok('het log van de opname weet dat er een opname bij is', c?.opname === true);
    // 21:00:00-3, -2, 21:00:00, en dan dat van 09:00.
    ok(`nieuwste eerst, volgnummer als getal (${lijst.map((x) => x.id.slice(9)).join(' ')})`,
      lijst.map((x) => x.id).join() === [los2.id, opn.id, los.id, s.id].join());
    ok('opname.lijst ziet het log niet als opname', (await O.lijst(dir)).every((x) => x.bestand.endsWith('.wav')));
  }

  console.log('\nterugspelen: volgorde en tijd (nep-klok)');
  {
    let klokT = 50;
    const timers = nepTimers();
    const gedaan = [];
    let laadKlaar;
    const doe = {
      stand: async () => { gedaan.push(['stand', klokT]); klokT += 0.4; },   // laden kost tijd, de klok loopt door
      laad: (track, e) => { gedaan.push(['laad', track, e.nummer]); return new Promise((z) => { laadKlaar = z; }); },
      rack: (track, r) => gedaan.push(['rack', track, r.x]),
      grid: (track) => gedaan.push(['grid', track]),
      focus: (track) => gedaan.push(['focus', track]),
      pads: () => gedaan.push(['pads']),
    };
    const sp = new T.Terugspeler({ klok: () => klokT, invoke: (a, v) => gedaan.push([a, v, klokT]), doe, elke: timers.elke, stopElke: timers.stopElke });
    let klaar = null;
    sp.onKlaar = (x) => { klaar = x; };
    const regels = [
      { t: 0, e: 'kop', versie: 1 }, { t: 0, e: 'stand', tracks: [] },
      [0.05, 'track.1.fader', 0.5], [0.1, 'track.1.play', true], [0.1, 'track.1.play', false],
      [0.1, 'record.start', true], [0.12, 'log.toggle', true], [0.13, 'layer.grid.hotcues', true], [0.14, 'track.1.rack.next', true],
      { t: 0.2, e: 'rack', track: 1, rack: { x: 'r1' } },
      { t: 1.0, e: 'laad', track: 2, nummer: 'abc', duur: 0.3 },   // begon op 0,7
      [0.8, 'track.2.fader', 0.3], [0.9, 'track.1.fader', 0.9], [0.95, 'track.2.play', true],
      { t: 1.0, e: 'grid', track: 2, grid: null },
      [1.5, 'track.1.bend.fwd', true],
      { t: 1.6, e: 'focus', track: 2 },
      { t: 2, e: 'eind', regels: 16 },
    ];
    const plan = T.maakPlan(regels);
    ok('plan: overslaan wat niet opnieuw mag (record, log, layer, rack.next)', !plan.plan.some((x) => /^(record|log|layer)\.|rack\.next/.test(x.a || '')));
    ok('plan: laden begint zo lang vóór zijn eind als hij toen duurde', plan.plan.find((x) => x.soort === 'laad').tijd === 0.7);
    const start = sp.start({ stand: regels[1], regels, duur: 2 });
    await start;
    const T0 = 50.4;
    ok('eerst de beginstand, dan pas de klok (T0 na het laden)', gedaan[0][0] === 'stand' && sp.T0 === T0);
    // de klok in stappen van 10 ms
    const stap = async (tot) => { while (klokT < T0 + tot - 1e-9) { klokT = Math.round((klokT + 0.01) * 1000) / 1000; timers.tik(); await Promise.resolve(); } };
    await stap(0.85);
    const vroeg = gedaan.filter((x) => typeof x[0] === 'string' && x[0].startsWith('track.'));
    ok('op tijd: elke action binnen één tik (10 ms) na zijn moment', vroeg.every(([a, , k]) => {
      const t = regels.find((r) => Array.isArray(r) && r[1] === a)?.[0];
      return k - T0 >= t - 1e-9 && k - T0 - t <= 0.0100001;
    }));
    ok('zelfde tijd: in de volgorde van het log', gedaan.findIndex((x) => x[0] === 'track.1.play' && x[1] === true)
      < gedaan.findIndex((x) => x[0] === 'track.1.play' && x[1] === false));
    ok('laden is begonnen op 0,7', gedaan.some((x) => x[0] === 'laad' && x[1] === 2));
    ok('track 2 laadt nog: zijn fader wacht', !gedaan.some((x) => x[0] === 'track.2.fader'));
    await stap(1.2);
    ok('... maar track 1 loopt gewoon door', gedaan.some((x) => x[0] === 'track.1.fader' && x[1] === 0.9));
    ok('... en de grid-gebeurtenis van track 2 wacht ook', !gedaan.some((x) => x[0] === 'grid'));
    laadKlaar(true);
    await new Promise((z) => setTimeout(z, 0));
    const na = gedaan.slice(gedaan.findIndex((x) => x[0] === 'laad') + 1).map((x) => x[0]);
    ok(`geladen: wat wachtte komt in volgorde (${na.filter((x) => x !== 'track.1.fader').join(', ')})`,
      JSON.stringify(na.filter((x) => x !== 'track.1.fader')) === JSON.stringify(['track.2.fader', 'track.2.play', 'grid']));
    ok('en dat is geteld als te laat', sp.stats.laat >= 2 && sp.stats.maxLaat > 0.3);
    await stap(1.55);
    ok('een bend ingedrukt', gedaan.some((x) => x[0] === 'track.1.bend.fwd' && x[1] === true));
    sp.stop();
    ok('stoppen laat los wat nog ingedrukt was (geen hangende bend)', gedaan.some((x) => x[0] === 'track.1.bend.fwd' && x[1] === false));
    ok('stoppen: gemeld, timer weg', klaar?.reden === 'gestopt' && timers.aantal() === 0 && !sp.bezig);
    ok('focus na het stoppen niet meer', !gedaan.some((x) => x[0] === 'focus'));
    // Tot het eind: 'klaar'.
    gedaan.length = 0; klaar = null;
    const kort = [[0.01, 'track.1.fader', 0.2], { t: 0.02, e: 'focus', track: 3 }, [0.03, 'track.1.cue', true]];
    await sp.start({ regels: kort });
    const T1 = sp.T0;
    while (klokT < T1 + 0.05) { klokT = Math.round((klokT + 0.01) * 1000) / 1000; timers.tik(); }
    ok('zonder beginstand: meteen, en klaar aan het eind', klaar?.reden === 'klaar' && gedaan.map((x) => x[0]).join() === 'track.1.fader,focus,track.1.cue,track.1.cue');
    // Een log dat na zijn laatste handeling nog even doorliep (opnieuw renderen): zo lang als het origineel.
    klaar = null;
    await sp.start({ regels: kort, duur: 0.2 });
    const T1b = sp.T0;
    while (klokT < T1b + 0.15) { klokT = Math.round((klokT + 0.01) * 1000) / 1000; timers.tik(); }
    const nogBezig = sp.bezig && !klaar;
    while (klokT < T1b + 0.21) { klokT = Math.round((klokT + 0.01) * 1000) / 1000; timers.tik(); }
    ok('terugspelen duurt zo lang als het log, niet tot de laatste handeling', nogBezig && klaar?.reden === 'klaar');
    // Een track zonder zijn nummer van toen (weg uit de library, los bestand):
    // transport overslaan (anders speelt wat er toevallig staat), faders niet.
    gedaan.length = 0; klaar = null;
    let laadGelukt = false;
    const sp2 = new T.Terugspeler({ klok: () => klokT, invoke: (a, v) => gedaan.push([a, v]), elke: timers.elke, stopElke: timers.stopElke,
      doe: { ...doe, stand: async () => ({ zonder: [3] }), laad: async (track) => { gedaan.push(['laad', track]); return laadGelukt; } } });
    sp2.onKlaar = (x) => { klaar = x; };
    const regels3 = [[0.01, 'track.3.play', true], [0.01, 'track.3.play', false], [0.02, 'track.3.fader', 0.4], [0.02, 'track.3.focus', true],
      [0.02, 'track.3.focus', false], { t: 0.03, e: 'laad', track: 3, nummer: 'weg' }, [0.04, 'track.3.cue', true],
      { t: 0.05, e: 'laad', track: 3, nummer: 'x' }, [0.07, 'track.3.play', true], [0.08, 'track.3.play', false]];
    await sp2.start({ stand: { tracks: [] }, regels: regels3 });
    const T2 = sp2.T0;
    while (klokT < T2 + 0.045) { klokT = Math.round((klokT + 0.01) * 1000) / 1000; timers.tik(); await new Promise((z) => setTimeout(z, 0)); }
    laadGelukt = true;
    while (klokT < T2 + 0.1) { klokT = Math.round((klokT + 0.01) * 1000) / 1000; timers.tik(); await new Promise((z) => setTimeout(z, 0)); }
    ok(`track zonder nummer: play/cue overgeslagen, fader en focus niet; na een gelukte laad weer alles (${gedaan.map((x) => x[0]).join(', ')})`,
      gedaan.map((x) => x[0]).join() === 'track.3.fader,track.3.focus,track.3.focus,laad,laad,track.3.play,track.3.play'
      && klaar?.overgeslagen === 3 && klaar.mislukt === 1 && klaar.reden === 'klaar');
  }

  console.log('\nterugspelen: een stand midden in het log (nep-klok)');
  {
    // Een stand midden in het log (terugspelen dat toen opnam) die 0,4 s laadt:
    // alles wacht, en de klok van het log staat zolang stil. Wat erna komt valt
    // dus 0,4 s later op de audioklok, op dezelfde plek in de muziek.
    let klokT = 0;
    const timers = nepTimers();
    const gedaan = [];
    let standKlaar = null;
    const doe = {
      stand: (st) => { gedaan.push(['stand', st.naam, klokT]); if (st.naam === 'begin') return { zonder: [] };
        return new Promise((z) => { standKlaar = () => z({ zonder: [] }); }); },
      laad: async () => true, rack() {}, grid() {}, focus() {}, pads() {},
    };
    const sp = new T.Terugspeler({ klok: () => klokT, invoke: (a, v) => gedaan.push([a, v, klokT]), doe, elke: timers.elke, stopElke: timers.stopElke });
    let onStand = 0;
    sp.onStand = () => onStand++;
    const begin = { t: 0, e: 'stand', naam: 'begin' };
    const regels = [{ t: 0, e: 'kop', versie: 1 }, begin, [0.1, 'track.1.fader', 0.5], { t: 0.2, e: 'stand', naam: 'midden' },
      [0.2, 'mixer.xfader', 0.1], [0.3, 'track.1.fader', 0.7], { t: 0.5, e: 'eind', regels: 6 }];
    await sp.start({ stand: begin, regels, duur: 0.5 });
    const T0 = sp.T0;
    const stap = async (tot) => { while (klokT < tot - 1e-9) { klokT = Math.round((klokT + 0.01) * 1000) / 1000; timers.tik(); await new Promise((z) => setTimeout(z, 0)); } };
    await stap(T0 + 0.25);
    ok('de beginstand niet nog eens, de stand midden in het log wel', gedaan.filter((x) => x[0] === 'stand').map((x) => x[1]).join() === 'begin,midden');
    ok('tijdens die stand wacht alles (ook wat geen track heeft)', !gedaan.some((x) => x[0] === 'mixer.xfader'));
    await stap(T0 + 0.6);                   // de stand laadt 0,4 s
    standKlaar();
    await new Promise((z) => setTimeout(z, 0));
    const xf = gedaan.find((x) => x[0] === 'mixer.xfader');
    ok(`daarna meteen wat op het moment van de stand stond (${xf ? (xf[2] - T0).toFixed(2) : '-'} s)`, xf && Math.abs(xf[2] - (T0 + 0.6)) < 0.011);
    await stap(T0 + 0.8);
    const f7 = gedaan.find((x) => x[0] === 'track.1.fader' && x[1] === 0.7);
    ok(`en de klok van het log stond stil: 0,3 s valt op ${f7 ? (f7[2] - T0).toFixed(2) : '-'} s (0,3 + 0,4 wachten)`, f7 && Math.abs(f7[2] - (T0 + 0.7)) < 0.011);
    ok('onStand na de beginstand én na de stand midden in het log', onStand === 2);
    await stap(T0 + 1);
    ok('klaar, duur plus de wachttijd', !sp.bezig);
  }

  console.log('\nrondje met de echte engine (Web Audio-mock)');
  {
    const { Engine, DECK_IDS } = await import('../src/engine/engine.js');
    const { renderDemoTrack } = await import('../src/analysis/demo-track.js');
    const eng = new Engine();
    A.bindEngine(eng);
    NOW = 10;
    const demo = { seed: 0, bars: 4 };
    eng.deck('A').load(renderDemoTrack(eng.ctx, demo), 'demo 1');
    eng.deck('A').setGrid({ bpm: 124, firstBeat: 0 });
    const herkomst = { A: { bron: 'demo', demo } };
    const stand0 = H.leesStand({ engine: eng, tracks: A.TRACKS, herkomst: (id) => herkomst[id] ?? null, acties: A.list(), lees: A.read });
    const t1 = stand0.tracks[0], t2 = stand0.tracks[1];
    ok('beginstand: track 1 = de demo, track 2 leeg', t1.bron === 'demo' && t1.demo.seed === 0 && t1.titel === 'demo 1' && t2.bron === 'leeg');
    ok('beginstand: positie, rate, bereik, kant, grid, rack', t1.positie === 0 && t1.rate === 1 && t1.bereik === 0.16
      && t1.kant === 'A' && t1.grid?.stukken?.[0]?.bpm === 124 && typeof t1.rack.data === 'object' && 'mix' in t1.rack);
    ok('beginstand: faders op de bus, maar niet seek/pitch/tempo/grid.bpm', stand0.waarden['track.1.fader'] === 1
      && stand0.waarden['mixer.xfader'] === 0.5 && !('track.1.seek' in stand0.waarden) && !('track.1.tempo' in stand0.waarden)
      && !('track.1.grid.bpm' in stand0.waarden) && stand0.rond['mixer.xfader.curve'] === 0);
    ok('beginstand: acht pads, acht herinneringen', stand0.pads.length === 8 && stand0.herinneringen.length === 8);

    // Opnemen: het log hangt aan de bus.
    const dir = join(map, 'rondje');
    const timers = nepTimers();
    const srv = nepServer(dir);
    const log = new H.Handelingenlog({ klok: () => NOW, haal: srv.haal, wacht: async () => {}, elke: timers.elke, stopElke: timers.stopElke });
    const weg = A.bijInvoke((id, v) => log.neem(id, v));
    const r = await log.start({ stand: stand0 });
    const op = (dt, a, v) => { NOW += dt; A.invoke(a, v); };
    op(0.5, 'track.1.play', true); op(0, 'track.1.play', false);
    op(0.25, 'track.1.fader', 0.7);
    op(0.25, 'mixer.xfader', 0.2);
    op(0.5, 'track.1.hotcue.2', true); op(0.05, 'track.1.hotcue.2', false);
    op(0.2, 'track.1.fx.mix', 0.6);
    op(0.3, 'track.1.low', 0.1);
    op(0.2, 'mixer.xfader.curve', true); op(0, 'mixer.xfader.curve', false);
    op(0.3, 'track.1.focus', true); op(0, 'track.1.focus', false);
    NOW += 0.4; timers.tik();
    const eindStand = { pos: eng.deck('A').position, speelt: eng.deck('A').playing, hotcue: eng.deck('A').hotcues[1],
      fader: eng.deck('A').ui.fader, low: eng.deck('A').ui.low, x: eng.xfader, curve: eng.xfaderCurve, mix: eng.deck('A').fx.mix };
    await log.stop();
    weg();
    const l = H.leesLog(readFileSync(join(dir, `set-${r.id}.acties.jsonl`), 'latin1'));

    // Alles door elkaar gooien, en terugspelen.
    eng.deck('A').pause(); eng.deck('A').seek(0); eng.deck('A').hotcues = [null, null, null, null];
    A.invoke('track.1.fader', 0.2); A.invoke('mixer.xfader', 1); A.invoke('track.1.low', 0.5);
    eng.setXfaderCurve('smooth'); eng.deck('A').fx.setMix(0);
    eng.deck('B').load(renderDemoTrack(eng.ctx, { seed: 1, bars: 2 }), 'iets anders');
    eng.deck('B').play();
    const geladen = [];
    const doe = T.maakUitvoerder({ engine: eng, tracks: A.TRACKS, invoke: A.invoke, read: A.read, has: A.has,
      laad: async (deckId, e) => { geladen.push([deckId, e.bron, e.demo?.seed]); eng.deck(deckId).load(renderDemoTrack(eng.ctx, e.demo), e.titel); return true; } });
    const t2m = nepTimers();
    const sp = new T.Terugspeler({ klok: () => NOW, invoke: A.invoke, doe, elke: t2m.elke, stopElke: t2m.stopElke });
    let klaar = null;
    sp.onKlaar = (x) => { klaar = x; };
    await sp.start({ stand: l.stand, regels: l.regels, duur: l.duur });
    const T0 = NOW;
    ok('beginstand teruggezet: de demo opnieuw geladen op track 1', geladen.length === 1 && geladen[0][0] === 'A' && geladen[0][2] === 0);
    ok('... wat er toen niet stond speelt niet mee (track 2 stil)', !eng.deck('B').playing);
    ok('... en de faders staan weer zoals bij het begin', eng.deck('A').ui.fader === 1 && eng.xfader === 0.5 && eng.deck('A').ui.low === 0.5);
    // De demo komt zonder grid uit zijn zaad (zoals laadVoorTerugspelen hem
    // maakt); het grid van toen (hier getikt: 124 bpm) moet er weer op.
    ok(`... met het grid van toen (${eng.deck('A').grid?.bpmAt(0) ?? 'geen'} bpm)`,
      JSON.stringify(eng.deck('A').grid?.toJSON() ?? null) === JSON.stringify(stand0.tracks[0].grid));
    while (NOW < T0 + l.duur + 0.05) { NOW = Math.round((NOW + 0.01) * 1000) / 1000; t2m.tik(); }
    ok(`terugspelen klaar (${klaar?.gedaan} handelingen, ${klaar?.laat} te laat)`, klaar?.reden === 'klaar' && klaar.laat === 0);
    const d = eng.deck('A');
    ok('zelfde eindstand: speelt, fader, low, crossfader, curve, fx-mix', d.playing === eindStand.speelt && d.ui.fader === eindStand.fader
      && d.ui.low === eindStand.low && eng.xfader === eindStand.x && eng.xfaderCurve === eindStand.curve && d.fx.mix === eindStand.mix);
    ok(`hotcue 2 op dezelfde plek (${d.hotcues[1]?.toFixed(3)} / ${eindStand.hotcue.toFixed(3)} s, hooguit één tik ernaast)`,
      Math.abs(d.hotcues[1] - eindStand.hotcue) <= 0.0101);
    ok(`positie loopt gelijk op (${(d.position - (eindStand.pos + (NOW - T0 - l.duur))).toFixed(4)} s verschil)`,
      Math.abs(d.position - (eindStand.pos + (NOW - T0 - l.duur))) <= 0.0101);
    // Een rack uit het log: alleen als het anders is.
    const fx = eng.deck('A').fx;
    const rackNu = H.rackStand(fx);
    const keten0 = fx.keten;
    doe.rack(1, rackNu);
    ok('zelfde rack nog eens: geen nieuwe keten (geen kruisfade voor niets)', fx.keten === keten0);
    fx.zetEffect('reverb');
    doe.rack(1, { ...rackNu, herkomst: 17, standen: { ...rackNu.standen, 1: 0.8 } });
    ok('ander rack: teruggezet met zijn standen, zonder het library-id van toen', JSON.stringify(fx.naarJSON()) === JSON.stringify(rackNu.data)
      && fx.leesPlek(1) === 0.8 && fx.herkomst === null);
    // Stoppen terwijl de beginstand nog laadt: daarna gebeurt er niets meer.
    // Eerst zette de beginstand na het laden toch de standen en startte hij
    // alles wat toen speelde, terwijl je al op stop had gedrukt.
    {
      let laadKlaar = null;
      const doeTraag = T.maakUitvoerder({ engine: eng, tracks: A.TRACKS, invoke: A.invoke, read: A.read, has: A.has,
        laad: (deckId, e) => new Promise((z) => { laadKlaar = () => { eng.deck(deckId).load(renderDemoTrack(eng.ctx, e.demo), e.titel); z(true); }; }) });
      const t3 = nepTimers();
      const sp3 = new T.Terugspeler({ klok: () => NOW, invoke: A.invoke, doe: doeTraag, elke: t3.elke, stopElke: t3.stopElke });
      const standSpeelt = { ...l.stand, tracks: l.stand.tracks.map((t) => (t.track === 1 ? { ...t, speelt: true, positie: 1.5 } : t)) };
      eng.deck('A').pause();
      A.invoke('track.1.fader', 0.3);
      const bezig = sp3.start({ stand: standSpeelt, regels: l.regels, duur: l.duur });
      await new Promise((z) => setTimeout(z, 0));
      sp3.stop();
      laadKlaar?.();
      await bezig;
      await new Promise((z) => setTimeout(z, 0));
      const dA = eng.deck('A');
      ok(`gestopt tijdens het laden van de beginstand: daarna niets meer (speelt ${dA.playing}, positie ${dA.position.toFixed(2)}, fader ${dA.ui.fader})`,
        !!laadKlaar && !dA.playing && dA.position < 1 && dA.ui.fader === 0.3 && !sp3.bezig && t3.aantal() === 0);
    }
    // Opnieuw renderen: terugspelen terwijl er een log loopt (een opname neemt
    // er vanzelf een mee). Ook DAT log moet terug te spelen zijn, inclusief wat
    // de beginstand buiten de bus om zette: positie, tempo, hotcues, wat speelt.
    // Eerst stond dat er niet in: de derde generatie speelde niets af.
    {
      const herk = {};
      const laadDemo = (id, demo, titel) => { eng.deck(id).load(renderDemoTrack(eng.ctx, demo), titel); herk[id] = { bron: 'demo', demo }; };
      const standNu = () => H.leesStand({ engine: eng, tracks: A.TRACKS, herkomst: (id) => herk[id] ?? null, acties: A.list(), lees: A.read });
      const tk = nepTimers();
      const dir4 = join(map, 'opnieuw');
      const srv4 = nepServer(dir4);
      const nieuwLog = () => new H.Handelingenlog({ klok: () => NOW, haal: srv4.haal, wacht: async () => {}, elke: tk.elke, stopElke: tk.stopElke });
      const a = eng.deck('A'), b = eng.deck('B');
      // (1) het origineel: A speelt vanaf 1,2 s op 1,05x met hotcue 1 op 2,0 s; B staat stil op 0,5 s.
      laadDemo('A', { seed: 0, bars: 4 }, 'demo 1'); laadDemo('B', { seed: 1, bars: 2 }, 'demo 2');
      a.setRate(1.05); a.seek(1.2); a.hotcues = [2.0, null, null, null]; a.play(); b.pause(); b.seek(0.5);
      const log1 = nieuwLog();
      const weg1 = A.bijInvoke((id, v) => log1.neem(id, v));
      const r1 = await log1.start({ stand: standNu() });
      NOW += 0.3; A.invoke('track.1.fader', 0.6);
      NOW += 0.5; A.invoke('track.1.hotcue.1', true); A.invoke('track.1.hotcue.1', false);
      NOW += 0.2; A.invoke('mixer.xfader', 0.3);
      NOW += 0.5; tk.tik();
      await log1.stop(); weg1();
      const l1 = H.leesLog(readFileSync(join(dir4, `set-${r1.id}.acties.jsonl`), 'latin1'));
      // (2) door elkaar, een log aan (de opname) en terugspelen.
      const husselen = () => {
        laadDemo('A', { seed: 5, bars: 2 }, 'iets anders'); b.play();
        A.invoke('track.1.fader', 0.2); A.invoke('mixer.xfader', 0.9);
      };
      husselen();
      const log2 = nieuwLog();
      const weg2 = A.bijInvoke((id, v) => log2.neem(id, v));
      const L2 = NOW;
      const r2 = await log2.start({ stand: standNu() });
      const uitvoerder = (naLaad) => T.maakUitvoerder({ engine: eng, tracks: A.TRACKS, invoke: A.invoke, read: A.read, has: A.has,
        huidig: (id) => herk[id] ?? null,
        laad: async (deckId, e) => { laadDemo(deckId, e.demo, e.titel); naLaad?.(deckId, e); return true; } });
      // laden.js meldt elke geslaagde laad aan het log (naLaad): hier nagebootst.
      const sp4 = new T.Terugspeler({ klok: () => NOW, invoke: A.invoke, elke: tk.elke, stopElke: tk.stopElke,
        doe: uitvoerder((deckId, e) => log2.gebeurtenis('laad', { track: A.trackVanDeck(deckId), bron: 'demo', demo: e.demo, titel: e.titel, duur: 0, grid: null })) });
      // Wat logboek.js doet: elke stand die het terugspelen buiten de bus om zet, in het lopende log.
      let standen = 0;
      sp4.onStand = () => { standen++; if (log2.bezig) log2.gebeurtenis('stand', standNu()); };
      await sp4.start({ stand: l1.stand, regels: l1.regels, duur: l1.duur });
      while (sp4.bezig) { NOW = Math.round((NOW + 0.01) * 1000) / 1000; tk.tik(); await Promise.resolve(); }
      const D = NOW - L2;
      const eind2 = { pos: a.position, speelt: a.playing, rate: a.rate, hot: a.hotcues[0], bSpeelt: b.playing, bPos: b.position, fader: a.ui.fader, x: eng.xfader };
      await log2.stop(); weg2();
      const l2 = H.leesLog(readFileSync(join(dir4, `set-${r2.id}.acties.jsonl`), 'latin1'));
      ok(`tweede generatie gelijk aan het origineel (A ${eind2.pos.toFixed(2)} s, speelt ${eind2.speelt}, hotcue ${eind2.hot})`,
        eind2.speelt && eind2.rate === 1.05 && eind2.hot === 2 && !eind2.bSpeelt && eind2.fader === 0.6 && eind2.x === 0.3);
      ok('onStand na de beginstand, en de stand staat midden in het nieuwe log', standen === 1
        && l2.regels.filter((r) => r?.e === 'stand').length === 2);
      ok('een stand midden in het log komt in het draaiboek, de beginstand niet', T.maakPlan(l2.regels, { beginstand: l2.stand }).plan.filter((x) => x.soort === 'stand').length === 1
        && T.maakPlan(l2.regels).plan.filter((x) => x.soort === 'stand').length === 1);
      // (3) weer door elkaar, en die nieuwe versie terugspelen: dezelfde eindstand.
      husselen();
      const t5 = nepTimers();
      const sp5 = new T.Terugspeler({ klok: () => NOW, invoke: A.invoke, doe: uitvoerder(null), elke: t5.elke, stopElke: t5.stopElke });
      await sp5.start({ stand: l2.stand, regels: l2.regels, duur: l2.duur });
      const T5 = sp5.T0;
      while (NOW < T5 + D - 1e-9) { NOW = Math.round((NOW + 0.01) * 1000) / 1000; t5.tik(); await new Promise((z) => setTimeout(z, 0)); }
      const eind3 = { pos: a.position, speelt: a.playing, rate: a.rate, hot: a.hotcues[0], bSpeelt: b.playing, bPos: b.position, fader: a.ui.fader, x: eng.xfader };
      sp5.stop();
      ok(`de opname van een terugspeelsessie speelt zelf ook terug (A ${eind3.pos.toFixed(2)} / ${eind2.pos.toFixed(2)} s, speelt ${eind3.speelt}, B speelt ${eind3.bSpeelt})`,
        eind3.speelt === eind2.speelt && eind3.rate === eind2.rate && eind3.hot === eind2.hot && eind3.bSpeelt === eind2.bSpeelt
        && Math.abs(eind3.pos - eind2.pos) <= 0.021 && Math.abs(eind3.bPos - eind2.bPos) < 1e-9 && eind3.fader === eind2.fader && eind3.x === eind2.x);
    }
    // Naden met ronde 1 (integratie-r2): de toonsoort en de hotcues horen bij
    // het NUMMER in de library, niet bij de set.
    {
      const a = eng.deck('A');
      a.pause();
      a.load(renderDemoTrack(eng.ctx, { seed: 0, bars: 4 }), 'demo 1');
      a.setToonKaart({ versie: 1, stukken: [{ van: 0, toonsoort: 'Am', stemming: 0, zekerheid: 0.9 }], bron: 'auto' });
      const toonVoor = JSON.stringify(a.toonKaart.toJSON());
      const st = H.leesStand({ engine: eng, tracks: A.TRACKS, herkomst: () => ({ bron: 'demo', demo: { seed: 0, bars: 4 } }), acties: A.list(), lees: A.read });
      ok('beginstand: track.N.key staat er niet in (zou de toonsoortkaart bewerken)', A.read('track.1.key') !== null
        && !Object.keys(st.waarden).some((k) => /^track\.\d+\.key/.test(k)));
      const plan = T.maakPlan([[0.1, 'track.1.key.fifth.up', true], [0.1, 'track.1.key.fifth.up', false], [0.2, 'track.1.key', 0.5],
        [0.3, 'track.1.key.lock', true], [0.4, 'track.1.fader', 0.5], [0.5, 'track.1.keylock', true]]).plan;
      ok(`terugspelen slaat het corrigeren van de toonsoort over (${plan.map((x) => x.a).join(', ')})`,
        plan.map((x) => x.a).join() === 'track.1.fader,track.1.keylock');
      // Een stand terugzetten laat de kaart ongemoeid (auto blijft auto).
      const doeT = T.maakUitvoerder({ engine: eng, tracks: A.TRACKS, invoke: A.invoke, read: A.read, has: A.has,
        huidig: () => ({ bron: 'demo', demo: { seed: 0, bars: 4 } }), laad: async () => true });
      await doeT.stand(st);
      ok('een beginstand terugzetten verandert de toonsoortkaart niet', JSON.stringify(a.toonKaart.toJSON()) === toonVoor && a.toonKaart.bron === 'auto');

      // Hotcues die na het laden uit de library terugkomen (hotcue-opslag.js)
      // gaan buiten de bus om; logboek.js legt ze vast als 'hotcues'. Terug:
      // precies die tijden, zonder 'hotcue'-melding (dan stuurt de
      // hotcue-opslag niets naar de server).
      let gemeld = 0;
      const tel = () => { gemeld++; };
      a.on('hotcue', tel);
      a.hotcues = [null, 1.5, null, null];
      doeT.hotcues(1, [2.25, null, 0.5, null]);
      ok(`hotcues-gebeurtenis: precies de tijden van toen, ook de lege (${JSON.stringify(a.hotcues)})`,
        JSON.stringify(a.hotcues) === '[2.25,null,0.5,null]' && gemeld === 0);
      a.seek(3);
      A.invoke('track.1.hotcue.1', true); A.invoke('track.1.hotcue.1', false);
      ok(`... en de hotcue-knop springt dan, zoals toen (positie ${a.position.toFixed(2)})`, Math.abs(a.position - 2.25) < 1e-9 && a.hotcues[0] === 2.25);
      a.off?.('hotcue', tel);
      // Grid en hotcues horen bij het nummer: staat het nummer van toen niet
      // op de track (laden mislukt, iets anders erop), dan niet toepassen.
      const tz = nepTimers();
      const gedaan = [];
      const spz = new T.Terugspeler({ klok: () => NOW, invoke: (x) => gedaan.push(x), elke: tz.elke, stopElke: tz.stopElke,
        doe: { stand: async () => ({ zonder: [2] }), laad: async () => true, rack: () => {}, focus: () => {}, pads: () => {},
          grid: (t) => gedaan.push(`grid ${t}`), hotcues: (t, h) => gedaan.push(`hotcues ${t} ${JSON.stringify(h)}`) } });
      let klaarZ = null;
      spz.onKlaar = (x) => { klaarZ = x; };
      await spz.start({ stand: { tracks: [] }, duur: 0.1, regels: [
        { t: 0.01, e: 'hotcues', track: 1, hotcues: [1, null, null, null] }, { t: 0.02, e: 'grid', track: 2, grid: null },
        { t: 0.03, e: 'hotcues', track: 2, hotcues: [3, null, null, null] }, [0.04, 'track.2.fader', 0.5]] });
      const Tz = spz.T0;
      while (NOW < Tz + 0.11) { NOW = Math.round((NOW + 0.01) * 1000) / 1000; tz.tik(); }
      ok(`hotcues-gebeurtenis wordt toegepast; grid en hotcues op een track zonder zijn nummer niet (${gedaan.join(' | ')})`,
        gedaan.join('|') === 'hotcues 1 [1,null,null,null]|track.2.fader' && klaarZ?.overgeslagen === 2);
    }
    // Naden met ronde 3 (integratie-r3): de nieuwe standen van dj-transport
    // (quantize, beatjump-lengte, wachten op de maat) en dj-klank (kill,
    // remtijd) in de beginstand. Kill en quantize zijn TOGGLES op de bus: een
    // log dat met een kill aan begint speelde zonder die stand omgekeerd terug.
    {
      const demo = { seed: 0, bars: 4 };
      const a = eng.deck('A'), c = eng.deck('C');
      for (const d of DECK_IDS.map((id) => eng.deck(id))) d.pause();
      a.load(renderDemoTrack(eng.ctx, demo), 'demo 1');
      a.setGrid({ bpm: 124, firstBeat: 0 });
      c.load(renderDemoTrack(eng.ctx, demo), 'demo 3');
      c.setGrid({ bpm: 124, firstBeat: 0 });
      const herk = { A: { bron: 'demo', demo }, C: { bron: 'demo', demo } };
      a.setKill('low', true);
      eng.setQuantize(true);
      a.sprongTellen = 8;
      A.invoke('track.1.brake.time', 0.3);
      a.seek(0.3); a.play();
      c.seek(2 * 60 / 124);                                          // op een tel
      const opDeMaat = eng.startOpDeMaat('C');
      const st = H.leesStand({ engine: eng, tracks: A.TRACKS, herkomst: (id) => herk[id] ?? null, acties: A.list(), lees: A.read });
      const s1 = st.tracks[0], s3 = st.tracks[2];
      ok(`beginstand ronde 3: kill-schakelaars, quantize (rond), beatjump-lengte, remtijd (${JSON.stringify(s1.kill)}, q ${st.rond['transport.quantize']}, ${s1.sprong} tellen, ${st.waarden['track.1.brake.time']})`,
        s1.kill.low === true && s1.kill.mid === false && s1.kill.high === false && st.rond['transport.quantize'] === 1 && s1.sprong === 8
        && Math.abs(st.waarden['track.1.brake.time'] - 0.3) < 1e-9);
      ok(`beginstand: een track die op de maat wacht speelt nog niet, en wacht (${opDeMaat.op !== null ? 'gepland' : 'meteen'})`,
        opDeMaat.op !== null && c.wacht && s3.wacht === true && s3.speelt === false && s1.wacht === false && s1.speelt === true);
      ok('de drukvariant van kill staat niet in de stand (loslaten = weg)', !('killVast' in s1) && Object.keys(s1.kill).join() === 'low,mid,high');
      // Het log: kill laag gaat UIT (toggle), beatjump en rem gaan over het nummer.
      const regels = [[0.1, 'track.1.kill.low', true], [0.1, 'track.1.kill.low', false], [0.15, 'track.1.fader', 0.9]];
      ok('beatjump en rem horen bij het nummer (NUMMER_NODIG), kill bij de track', T.NUMMER_NODIG.test('track.1.beatjump.fwd')
        && T.NUMMER_NODIG.test('track.1.brake') && T.NUMMER_NODIG.test('track.1.play.quant') && T.NUMMER_NODIG.test('track.1.loop.in')
        && !T.NUMMER_NODIG.test('track.1.kill.low') && !T.NUMMER_NODIG.test('track.1.brake.time') && !T.NUMMER_NODIG.test('track.1.beatjump.double'));
      // Alles anders, en terugspelen.
      for (const d of DECK_IDS.map((id) => eng.deck(id))) d.pause();
      a.setKill('low', false); a.setKill('high', true);
      eng.setQuantize(false);
      a.sprongTellen = 2;
      A.invoke('track.1.brake.time', 0.9);
      const tq = nepTimers();
      const doeQ = T.maakUitvoerder({ engine: eng, tracks: A.TRACKS, invoke: A.invoke, read: A.read, has: A.has,
        huidig: (id) => herk[id] ?? null, laad: async () => true });
      const spq = new T.Terugspeler({ klok: () => NOW, invoke: A.invoke, doe: doeQ, elke: tq.elke, stopElke: tq.stopElke });
      await spq.start({ stand: st, regels, duur: 0.2 });
      ok(`na de beginstand: kill laag weer AAN, hoog uit, quantize aan, 8 tellen, remtijd 0,3 (${JSON.stringify(a.kill)})`,
        a.kill.low === true && a.kill.high === false && eng.quantize === true && a.sprongTellen === 8
        && Math.abs(A.read('track.1.brake.time') - 0.3) < 1e-9);
      ok('... en de track die toen op de maat wachtte, wacht nu weer op de maat', a.playing && !a.wacht && c.playing && c.wacht);
      const Tq = spq.T0;
      while (NOW < Tq + 0.21) { NOW = Math.round((NOW + 0.01) * 1000) / 1000; tq.tik(); }
      ok(`na het log: de toggle zette kill laag UIT, zoals toen (niet omgekeerd) (${JSON.stringify(a.kill)})`, a.kill.low === false && a.ui.fader === 0.9);
      // Een log van vóór ronde 3 (geen kill, geen quantize in de stand): toen
      // bestonden ze niet, dus uit, wat er nu ook aan staat.
      a.setKill('mid', true); eng.setQuantize(true);
      const oud = { ...st, rond: { ...st.rond }, tracks: st.tracks.map(({ kill, sprong, wacht, ...t }) => t) };
      delete oud.rond['transport.quantize'];
      await doeQ.stand(oud);
      ok(`een ouder log zonder kill/quantize: alles uit (${JSON.stringify(a.kill)}, quantize ${eng.quantize})`,
        !a.kill.low && !a.kill.mid && !a.kill.high && eng.quantize === false);
      for (const d of DECK_IDS.map((id) => eng.deck(id))) d.pause();
      a.setKill('low', false);
    }
    ok('DECK_IDS en TRACKS horen bij elkaar (acht tracks)', DECK_IDS.length === A.TRACKS.length);
  }

  console.log('\nhoe groot wordt een uur?');
  {
    // De echte regels, via de echte klasse; alleen de server telt bytes in plaats van te schrijven.
    const meet = async (perSec, namen) => {
      let bytes = 0, klokT = 0;
      const timers = nepTimers();
      const log = new H.Handelingenlog({ klok: () => klokT, elke: timers.elke, stopElke: timers.stopElke, wacht: async () => {},
        haal: async (url, init) => {
          if (url.endsWith('/start')) return { ok: true, json: async () => ({ ok: true, id: '20260925-000000', bestand: 'x' }) };
          bytes += JSON.parse(init.body).tekst.length;
          return { ok: true, json: async () => ({ ok: true }) };
        } });
      await log.start({ stand: {} });
      let z = 7;
      const rnd = () => ((z = (Math.imul(z, 1103515245) + 12345) >>> 0) / 4294967296);
      for (let sec = 0; sec < 3600; sec++) {
        for (let k = 0; k < perSec; k++) {
          klokT = sec + (k + rnd()) / perSec;
          const [naam, soort] = namen[Math.floor(rnd() * namen.length)];
          // Faders en ringen: stappen van 1/127 (ook "endless": de som van stapjes), knoppen aan/uit.
          log.neem(naam, soort === 'v' ? Math.round(rnd() * 127) / 127 + (rnd() < 0.3 ? 1e-9 : 0) : rnd() < 0.5);
        }
        timers.tik();
      }
      await log.stop();
      return bytes;
    };
    const faders = [];
    for (let t = 1; t <= 8; t++) for (const p of ['fader', 'filter', 'low', 'mid', 'high', 'fx.knob.1', 'fx.knob.2', 'send.a']) faders.push([`track.${t}.${p}`, 'v']);
    faders.push(['mixer.xfader', 'v'], ['mixer.master', 'v']);
    const knoppen = [];
    for (let t = 1; t <= 8; t++) for (const p of ['play', 'cue', 'sync', 'hotcue.1', 'beatloop.4', 'bend.fwd']) knoppen.push([`track.${t}.${p}`, 't']);
    const mix = [...faders, ...faders, ...faders, ...knoppen];   // driekwart draaien, een kwart drukken
    const rustig = await meet(5, mix);
    const druk = await meet(50, mix);
    const extreem = await meet(300, faders);
    const MB = (b) => (b / 1e6).toFixed(1);
    console.log(`        rustig (5/s): ${MB(rustig)} MB · druk (50/s): ${MB(druk)} MB · extreem (300/s, alleen draaien): ${MB(extreem)} MB per uur`);
    ok(`een druk uur (50 handelingen per seconde) is ${MB(druk)} MB: klein naast de WAV (~690 MB)`, druk < 20e6);
    ok(`zelfs 300 per seconde, een uur lang, blijft onder 100 MB (${MB(extreem)} MB)`, extreem < 100e6);
  }

  console.log('\nde routes op een eigen server');
  {
    const tmp = join(map, 'server');
    mkdirSync(join(tmp, 'media'), { recursive: true });
    const poort = 20000 + Math.floor(Math.random() * 20000);
    const server = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, PORT: String(poort), VARVE_DB: join(tmp, 'test.db'), VARVE_OPNAMES: join(tmp, 'opnames'),
        VARVE_MEDIA: join(tmp, 'media'), VARVE_HERANALYSE: 'uit' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const B = `http://localhost:${poort}`;
    try {
      for (let i = 0; i < 80; i++) {
        const r = await fetch(`${B}/api/handelingen`).catch(() => null);
        if (r?.ok) break;
        await new Promise((z) => setTimeout(z, 100));
      }
      const post = (pad, body, headers = {}) => fetch(B + pad, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const rauw = (pad, { method = 'GET', headers = {}, body = null } = {}) => new Promise((klaar) => {
        const rq = request({ host: '127.0.0.1', port: poort, path: pad, method, headers: { Host: `localhost:${poort}`, ...headers } }, (res) => {
          const delen = [];
          res.on('data', (x) => delen.push(x));
          res.on('end', () => klaar({ status: res.statusCode, body: Buffer.concat(delen).toString() }));
        });
        rq.on('error', (e) => klaar({ status: 0, body: String(e) }));
        if (body) rq.write(body);
        rq.end();
      });
      ok('lege lijst', (await (await fetch(`${B}/api/handelingen`)).json()).logs.length === 0);
      ok('starten als formulier (text/plain): 415', (await fetch(`${B}/api/handelingen/start`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status === 415);
      const s = await (await post('/api/handelingen/start', {})).json();
      ok('start: een id', s.ok && /^\d{8}-\d{6}/.test(s.id));
      const tekst = '{"t":0,"e":"kop","versie":1,"titel":"caf\\u00e9"}\n[0.5,"track.1.fader",0.5]\n';
      const st = await post(`/api/handelingen/${s.id}/stuk`, { van: 0, tekst });
      const st2 = await post(`/api/handelingen/${s.id}/stuk`, { van: 0, tekst });
      const st3 = await post(`/api/handelingen/${s.id}/stuk`, { van: tekst.length, tekst: '{"t":1,"e":"eind","regels":3}\n' });
      ok('stuk, hetzelfde stuk nog eens, volgend stuk: 200', st.status === 200 && st2.status === 200 && st3.status === 200);
      const terug = await fetch(`${B}/api/handelingen/${s.id}`);
      const inhoud = await terug.text();
      ok('GET geeft het log precies terug, zonder dubbel stuk', terug.status === 200 && inhoud === tekst + '{"t":1,"e":"eind","regels":3}\n'
        && /x-ndjson/.test(terug.headers.get('content-type')));
      const l = (await (await fetch(`${B}/api/handelingen`)).json()).logs;
      ok('in de lijst: af, 1 s, bytes', l.length === 1 && l[0].af && l[0].duur === 1 && l[0].bytes === inhoud.length);
      ok('stuk als formulier: 415', (await fetch(`${B}/api/handelingen/${s.id}/stuk`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ van: 0, tekst }) })).status === 415);
      ok('stuk zonder ASCII: 400', (await post(`/api/handelingen/${s.id}/stuk`, { van: 0, tekst: '[0,"café",1]\n' })).status === 400);
      ok('stuk dat geen JSON is: 400', (await fetch(`${B}/api/handelingen/${s.id}/stuk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{van:' })).status === 400);
      ok('vanaf een andere oorsprong: 403', (await rauw(`/api/handelingen/${s.id}/stuk`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: JSON.stringify({ van: 0, tekst }) })).status === 403);
      ok('vanaf de eigen pagina: 200', (await rauw(`/api/handelingen/${s.id}/stuk`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${poort}` }, body: JSON.stringify({ van: 0, tekst }) })).status === 200);
      const uitstapjes = ['/api/handelingen/..%2f..%2fmedia%2ftest.db', '/api/handelingen/../../server/index.js',
        '/api/handelingen/..%2fopnames', '/api/handelingen/%2e%2e', '/api/handelingen/20260925-000000%2f..%2f..%2ftest.db'];
      const codes = [];
      for (const p of uitstapjes) codes.push((await rauw(p)).status);
      ok(`lezen met ../ of een gecodeerde slash: nooit 200 (${codes.join(' ')})`, codes.every((c) => c !== 200 && c !== 0));
      ok('onbekend log: 404, onzin-id: 400', (await fetch(`${B}/api/handelingen/20990101-000000`)).status === 404
        && (await fetch(`${B}/api/handelingen/abc`)).status === 400);
      const schrijfUit = await post('/api/handelingen/..%2F..%2Fx/stuk', { van: 0, tekst });
      ok('schrijven met ../ in het id: niet 200', schrijfUit.status !== 200);
      // Bij een opname: zelfde id.
      const opn = await (await fetch(`${B}/api/opname/start`, { method: 'POST' })).json();
      const bij = await (await post('/api/handelingen/start', { id: opn.id })).json();
      ok('log bij een opname: zelfde id als de WAV', bij.ok && bij.id === opn.id && bij.opname === true);
      ok('bij een opname die niet bestaat: 400', (await post('/api/handelingen/start', { id: '20990101-000000' })).status === 400);
      ok('met een id vol ../: 400', (await post('/api/handelingen/start', { id: '../../etc' })).status === 400);
      const lijst2 = (await (await fetch(`${B}/api/handelingen`)).json()).logs;
      ok('de lijst weet welk log een opname heeft', lijst2.find((x) => x.id === opn.id)?.opname === true && lijst2.find((x) => x.id === s.id)?.opname === false);
    } finally {
      server.kill();
    }
  }
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
