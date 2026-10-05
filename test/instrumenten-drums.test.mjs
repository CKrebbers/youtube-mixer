// Het drum-instrument (src/engine/instrumenten/drums.js, docs/INSTRUMENTEN.md §8)
// tegen een nep-Web Audio: het contract, noot → pad, choke, stemroof, stil()
// zonder sprong, laadPad/wisPad, de parameters. Wat het in Chrome echt doet
// (klinkt, spectrum, choke in samples, luidheid, sample-exact plannen) meet
// tools/headless/drums.mjs.
// Draai met: node test/instrumenten-drums.test.mjs
import { readFileSync } from 'node:fs';
import { maakTijdlijn } from './nep-tijdlijn.mjs';

const fails = [];
const ok = (name, cond, extra = '') => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name + (extra ? ` (${extra})` : '')); };

// ---- de nep-Web Audio ----------------------------------------------------------
// Net zo streng als Chrome waar het ertoe doet: stop() vóór start() gooit,
// start() twee keer gooit, een buffer van 0 lang gooit, en onended komt pas
// als de audioklok voorbij het einde is (en dan asynchroon), niet bij stop().
// Elke AudioParam heeft een tijdlijn (nep-tijdlijn.mjs): wat de parameter op
// elk moment doet is uit te rekenen, dus een sprong is te meten.
let NOW = 0;
const { param, stats } = maakTijdlijn(() => NOW);
const PARAMS = [];
const p = (v) => {
  const x = param(v);
  // Zoals Chrome (en de spec): cancelAndHoldAtTime zet alleen een punt op t als
  // er een helling doorgesneden wordt of een setTarget liep. Anders begint een
  // helling die erna komt bij het VORIGE punt: een fade van 6 ms werd zo een
  // fade vanaf het begin van de noot (in Chrome gemeten, tools/headless/drums.mjs).
  // nep-tijdlijn zet er altijd een, en verborg dat.
  const houd = x.cancelAndHoldAtTime.bind(x);
  x.cancelAndHoldAtTime = (t = NOW) => {
    const lopend = x._ev.find((e) => e.t > t), vorige = x._ev.filter((e) => e.t < t).at(-1);
    houd(t);
    if (lopend?.type !== 'lin' && vorige?.type !== 'target') x._ev.pop();
  };
  PARAMS.push(x);
  return x;
};
const fout = (naam, w) => Object.assign(new Error(`${naam}: ${w}`), { name: naam });

let BRONNEN = [];
const node = (soort) => ({
  soort, naar: [], los: 0,
  connect(n) { this.naar.push(n); return n; },
  disconnect() { this.naar = []; this.los++; },
});

class NepContext {
  constructor(sr = 48000) { this.sampleRate = sr; this.baseLatency = 0.005; this.destination = node('dest'); this.bronnen = []; }
  get currentTime() { return NOW; }
  createGain() { const n = node('gain'); n.gain = p(1); return n; }
  createBiquadFilter() { const n = node('biquad'); n.frequency = p(350); n.Q = p(1); n.gain = p(0); return n; }
  createStereoPanner() { const n = node('panner'); n.pan = p(0); return n; }
  createWaveShaper() { const n = node('shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createBuffer(ch, len, sr) {
    if (!(ch >= 1) || !(len >= 1) || !(sr > 0)) throw fout('NotSupportedError', 'createBuffer');
    const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] };
  }
  createBufferSource() {
    const s = node('src');
    s.playbackRate = p(1); s.buffer = null; s.loop = false; s.onended = null;
    s.startOp = null; s.stopOp = null; s.klaar = false;
    s.start = (w = 0, vanaf = 0) => {
      if (s.startOp !== null) throw fout('InvalidStateError', 'start twee keer');
      s.startOp = Math.max(w, NOW); s.vanaf = vanaf;
    };
    s.stop = (w = 0) => {
      if (s.startOp === null) throw fout('InvalidStateError', 'stop vóór start');
      if (!s.klaar) s.stopOp = Math.max(w, NOW);       // de laatste stop telt (spec)
    };
    s.eind = () => Math.min(s.stopOp ?? Infinity, s.startOp + (s.buffer ? s.buffer.duration / s.playbackRate.value : 0));
    this.bronnen.push(s);
    BRONNEN.push(s);
    return s;
  }
}

/** De klok vooruit: bronnen voorbij hun einde zijn klaar, onended komt asynchroon. */
async function tik(dt) {
  NOW += dt;
  for (const s of BRONNEN) {
    if (!s.klaar && s.startOp !== null && s.eind() <= NOW) { s.klaar = true; queueMicrotask(() => s.onended?.()); }
  }
  await Promise.resolve();
  await Promise.resolve();
}

/** De grootste stap van een parameter tussen t0 en t1 in stapjes van 0,1 ms. */
function grootsteStap(prm, t0, t1, dt = 0.0001) {
  let max = 0, vorige = prm.waarde(t0);
  for (let t = t0 + dt; t <= t1 + 1e-12; t += dt) { const v = prm.waarde(t); max = Math.max(max, Math.abs(v - vorige)); vorige = v; }
  return max;
}

const M = await import('../src/engine/instrumenten/drums.js');
const { DRUMS, Drums, KIT, PARAMS: DEF, padVanNoot, MAX_STEMMEN, KAP, STIL, UIT_OPHOGING, snelheidGain } = M;
const { INSTRUMENTEN, instrumentDef } = await import('../src/engine/instrumenten/index.js');
const { startDrempel } = await import('../src/engine/overgang.js');
const { faderGain } = await import('../src/engine/audio-graph.js');

const nieuw = (sr = 48000) => {
  NOW = 1;
  BRONNEN = [];
  const ctx = new NepContext(sr);
  const uit = node('chain.input');
  const d = DRUMS.maak(ctx, { uit, klok: null, toon: null });
  return { ctx, uit, d };
};
const laatste = (ctx) => ctx.bronnen.at(-1);
/** Van een bron: zijn versterking (bron → [vorm] → filter → g). */
const keten = (s) => {
  const eerste = s.naar[0];
  const vorm = eerste.soort === 'shaper' ? eerste : null;
  const filter = vorm ? vorm.naar[0] : eerste;
  const g = filter.naar[0];
  return { vorm, filter, g, pan: g.naar[0] };
};
const drempel = startDrempel({ sampleRate: 48000, baseLatency: 0.005 });

// ---- 1. de definitie en het contract -------------------------------------------
console.log('definitie en contract');
{
  ok('DRUMS: soort "drums" ([a-z0-9-]), naam, maak', DRUMS.soort === 'drums' && /^[a-z0-9-]+$/.test(DRUMS.soort) && DRUMS.naam === 'Drums' && typeof DRUMS.maak === 'function');
  ok('in INSTRUMENTEN, instrumentDef("drums") geeft hem', INSTRUMENTEN.includes(DRUMS) && instrumentDef('drums') === DRUMS);
  const { ctx, uit, d } = nieuw();
  ok('maak() geeft een Drums, aangesloten op uit', d instanceof Drums && d.uit.naar.includes(uit));
  ok('soort en naam zoals de definitie', d.soort === 'drums' && d.naam === 'Drums');
  for (const lid of ['start', 'noteOn', 'noteOff', 'alleUit', 'stil', 'druk', 'buig', 'mod', 'houd', 'zetParam', 'leesParam', 'stand', 'vernietig', 'laadPad', 'wisPad']) {
    ok(`lid ${lid}() bestaat`, typeof d[lid] === 'function');
  }
  ok('params: acht, elk { id, label, standaard 0..1, eenheid → tekst }', d.params.length === 8
    && d.params.every((q) => typeof q.id === 'string' && typeof q.label === 'string' && q.standaard >= 0 && q.standaard <= 1
      && [0, 0.25, 0.5, 0.75, 1].every((v) => typeof q.eenheid(v) === 'string' && q.eenheid(v).length > 0)));
  ok('de ids: toon decay filter drive kick snare hats niveau', d.params.map((q) => q.id).join(' ') === 'toon decay filter drive kick snare hats niveau');
  ok('leesParam(1..8) = standaard; 0, 9, "x" en 1,5 = null', [1, 2, 3, 4, 5, 6, 7, 8].every((k) => d.leesParam(k) === d.params[k - 1].standaard)
    && d.leesParam(0) === null && d.leesParam(9) === null && d.leesParam('x') === null && d.leesParam(1.5) === null);
  d.zetParam(2, 1.7); d.zetParam(4, -3); d.zetParam(9, 0.3); d.zetParam(0, 0.3); d.zetParam(5, NaN);
  ok('zetParam klemt op 0..1; plek 0, 9 doen niets; NaN = 0', d.leesParam(2) === 1 && d.leesParam(4) === 0 && d.leesParam(5) === 0);
  const s = d.stand();
  ok('stand(): { soort, naam, klinkt, params[8] }', s.soort === 'drums' && s.naam === 'Drums' && s.klinkt === 0 && s.params.length === 8 && s.params[1] === 1);
  ok('stand().pads: zestien, noot 36..51, kit 1–8 met naam', s.pads.length === 16 && s.pads.every((q, i) => q.pad === i + 1 && q.noot === 36 + i)
    && s.pads.slice(0, 8).every((q) => q.kit && q.naam) && s.pads.slice(8).every((q) => !q.kit && !q.gevuld && q.naam === null));
  ok('maak zonder uit: op ctx.destination', DRUMS.maak(ctx, {}).uit.naar.includes(ctx.destination));
}

// ---- 2. vóór start(), en start() --------------------------------------------------
console.log('\nvóór start(), en start()');
{
  const { ctx, d } = nieuw();
  let gegooid = null;
  try {
    d.noteOn(36, 0.8); d.noteOn(36, 0.8, NOW + 0.1); d.noteOff(36); d.alleUit(); d.stil();
    d.druk(0.5); d.druk(0.5, 36); d.buig(0.5); d.mod(0.3); d.houd(true); d.houd(false);
  } catch (e) { gegooid = e; }
  ok('alles vóór start(): gooit niet, maakt geen bron', gegooid === null && ctx.bronnen.length === 0 && d.fouten === 0);
  ok('stand() vóór start(): kit-pads nog niet gevuld', d.stand().pads.slice(0, 8).every((q) => !q.gevuld));
  const a = d.start(), b = d.start();
  ok('start() geeft een Promise, twee keer dezelfde (idempotent)', a instanceof Promise && a === b);
  await a;
  ok('na start(): de acht kitgeluiden staan klaar, mono, op ctx.sampleRate', d.pads.slice(0, 8).every((q) => q.buffer && q.buffer.numberOfChannels === 1 && q.buffer.sampleRate === 48000 && q.buffer.length > 1000));
  ok('pads 9–16 blijven leeg', d.pads.slice(8).every((q) => q.buffer === null));
  const kick = d.pads[0].buffer.getChannelData(0);
  let piek = 0; for (const v of kick) piek = Math.max(piek, Math.abs(v));
  ok('elk kitgeluid: piek 0,92, eindig, laatste sample precies 0 (fade, geen tik)', d.pads.slice(0, 8).every((q) => {
    const x = q.buffer.getChannelData(0); let m = 0, eindig = true;
    for (const v of x) { if (!Number.isFinite(v)) eindig = false; m = Math.max(m, Math.abs(v)); }
    return eindig && Math.abs(m - 0.92) < 1e-6 && x[x.length - 1] === 0;
  }));
  const tweede = nieuw().d; await tweede.start();
  ok('met een zaad: een tweede instrument rekent precies dezelfde kit', tweede.pads.slice(0, 8).every((q, i) => {
    const x = q.buffer.getChannelData(0), y = d.pads[i].buffer.getChannelData(0);
    return x.length === y.length && x.every((v, j) => v === y[j]);
  }));
  const ander = nieuw(44100).d; await ander.start();
  ok('op 44,1 kHz: op die sampleRate gerekend (kick 0,60 s = 26 460 samples)', ander.pads[0].buffer.sampleRate === 44100 && ander.pads[0].buffer.length === 26460);
  ok('namen: KICK SNARE CLAP HAT TOM RIM BAS HAT OPEN', KIT.map((k) => k.naam).join(' ') === 'KICK SNARE CLAP HAT TOM RIM BAS HAT OPEN');
}

// ---- 3. noot → pad -------------------------------------------------------------------
console.log('\nnoot → pad');
{
  ok('padVanNoot: 36 → 1, 51 → 16, 52 → 1, 35 → 16, 0 → 13, 127 → 12', padVanNoot(36) === 1 && padVanNoot(51) === 16 && padVanNoot(52) === 1
    && padVanNoot(35) === 16 && padVanNoot(0) === 13 && padVanNoot(127) === 12);
  let alle = true;
  for (let n = 0; n < 128; n++) { const q = padVanNoot(n); if (!(q >= 1 && q <= 16) || q !== ((((n - 36) % 16) + 16) % 16) + 1) alle = false; }
  ok('elke noot 0..127 valt op een pad 1..16 = (noot − 36) mod 16 + 1', alle);
  const { ctx, d } = nieuw(); await d.start();
  let goed = true;
  for (let i = 0; i < 8; i++) { d.noteOn(36 + i, 0.8, NOW + 0.1 + i); if (laatste(ctx).buffer !== d.pads[i].buffer) goed = false; }
  ok('noot 36..43: de kitgeluiden van pad 1..8', goed && ctx.bronnen.length === 8);
  const voor = ctx.bronnen.length;
  for (let n = 44; n <= 51; n++) d.noteOn(n, 0.8);
  ok('noot 44..51 (pads 9–16 leeg): stil, geen bron, geen fout', ctx.bronnen.length === voor && d.fouten === 0);
  d.noteOn(100, 0.8, NOW + 20);             // (100 − 36) mod 16 = 0 → pad 1
  d.noteOn(3, 0.8, NOW + 21);               // (3 − 36) mod 16 = 15 → pad 16, leeg
  d.noteOn(27, 0.8, NOW + 22);              // (27 − 36) mod 16 = 7 → pad 8
  ok('buiten 36–51: 100 → KICK, 3 → (leeg), 27 → HAT OPEN', ctx.bronnen.length === voor + 2
    && ctx.bronnen[voor].buffer === d.pads[0].buffer && ctx.bronnen[voor + 1].buffer === d.pads[7].buffer);
  const n0 = ctx.bronnen.length;
  for (const [noot, snelheid] of [[NaN, 0.8], [undefined, 0.8], [36, 0], [36, -1], [36, NaN], ['x', 0.5]]) d.noteOn(noot, snelheid);
  ok('rare invoer (NaN, undefined, snelheid 0 of negatief): niets, geen fout', ctx.bronnen.length === n0 && d.fouten === 0);
  d.noteOn(36.4, 0.8, NOW + 30);
  ok('een gebroken noot wordt afgerond (36,4 → pad 1)', laatste(ctx).buffer === d.pads[0].buffer);
}

// ---- 4. de stem: plannen, snelheid, keten ----------------------------------------
console.log('\nde stem');
{
  const { ctx, d } = nieuw(); await d.start();
  d.noteOn(36, 0.8, 1.5);
  const s = laatste(ctx), k = keten(s);
  ok('t in de toekomst: start op t (1,5)', s.startOp === 1.5 && s.vanaf === 0);
  ok('... de versterking is 0 tot t en springt op t naar zijn niveau', k.g.gain.waarde(1.4999) === 0 && k.g.gain.waarde(1.5) > 0);
  ok('keten: bron → filter (laagdoorlaat) → versterking → pan → uit', k.vorm === null && k.filter.soort === 'biquad' && k.filter.type === 'lowpass'
    && k.g.soort === 'gain' && k.pan.soort === 'panner' && k.pan.naar[0] === d.uit);
  ok('filter standaard open: kantel op Nyquist (24 kHz, Chrome geeft dan door)', k.filter.frequency.value === 24000);
  const niveau08 = k.g.gain.waarde(1.6);
  ok('niveau kick bij 0,8: 0,8^1,5 × √2 (mono door de panner)', Math.abs(niveau08 - Math.pow(0.8, 1.5) * Math.SQRT2) < 1e-9, niveau08.toFixed(4));
  d.noteOn(37, 0.4, 2);
  const g04 = keten(laatste(ctx)).g.gain.waarde(2.1) / d.pads[1].niveau, g08 = niveau08 / d.pads[0].niveau;
  ok('snelheid → niveau met een curve: 0,4 tegen 0,8 = −9,0 dB', Math.abs(20 * Math.log10(g04 / g08) + 9.03) < 0.01, `${(20 * Math.log10(g04 / g08)).toFixed(2)} dB`);
  ok('snelheidGain(1) = 1, (0,5) = −9 dB', snelheidGain(1) === 1 && Math.abs(20 * Math.log10(snelheidGain(0.5)) + 9.03) < 0.01);
  d.noteOn(39, 0.8, 0.2);                          // in het verleden
  ok('t in het verleden: nu', laatste(ctx).startOp === NOW);
  d.noteOn(39, 0.8);
  ok('t weggelaten: nu', laatste(ctx).startOp === NOW);
  ok('pan van de kit: hat rechts (+0,15), rim links (−0,2), kick midden', keten(laatste(ctx)).pan.pan.value === 0.15 && d.pads[5].pan === -0.2 && d.pads[0].pan === 0);
  ok('uitgang: faderGain(0,8) × UIT_OPHOGING', Math.abs(d.uit.gain.value - faderGain(0.8) * UIT_OPHOGING) < 1e-12);
}

// ---- 5. choke en mono per pad ---------------------------------------------------------
console.log('\nchoke');
{
  const { ctx, d } = nieuw(); await d.start();
  d.noteOn(43, 0.8, 1.1);                           // open hat
  const open = laatste(ctx), go = keten(open).g.gain, nv = go.waarde(1.15);
  d.noteOn(39, 0.8, 1.2);                           // gesloten hat
  const dicht = laatste(ctx);
  ok('gesloten hat op 1,2: de open hat staat daar nog op zijn niveau', Math.abs(go.waarde(1.2) - nv) < 1e-9);
  ok(`... en is ${KAP * 1000} ms later precies 0 (binnen ~10 ms af)`, go.waarde(1.2 + KAP) === 0 && go.waarde(1.25) === 0);
  ok('... lineair: halverwege de helft (geen sprong)', Math.abs(go.waarde(1.2 + KAP / 2) - nv / 2) < 1e-9);
  ok('... grootste stap per 0,1 ms = de helling, nergens een sprong', grootsteStap(go, 1.19, 1.22) <= nv * 0.0001 / KAP * 1.01);
  ok('... de bron stopt net na de fade', open.stopOp > 1.2 + KAP && open.stopOp < 1.2 + KAP + 0.002);
  ok('de gesloten hat zelf klinkt gewoon', keten(dicht).g.gain.waarde(1.21) > 0 && dicht.stopOp === null);
  d.noteOn(43, 0.8, 2);
  const open2 = laatste(ctx), g2 = keten(open2).g.gain;
  d.noteOn(36, 0.8, 2.1);
  ok('een kick kapt de open hat NIET af', g2.waarde(2.2) > 0 && open2.stopOp === null);
  d.noteOn(39, 0.8, 3); d.noteOn(43, 0.8, 3.05);
  const dicht3 = BRONNEN.at(-2), g3 = keten(dicht3).g.gain;
  ok('de groep werkt twee kanten op: open na gesloten kapt de gesloten (die al bijna uit is)', g3.waarde(3.05 + KAP) === 0);
  d.noteOn(43, 0.8, 4); d.noteOn(39, 0.8, 3.9);
  const later = BRONNEN.at(-2);
  ok('een gesloten hat die EERDER valt dan een geplande open hat kapt die niet', keten(later).g.gain.waarde(4.1) > 0);

  // Dezelfde pad opnieuw: de vorige gaat weg (mono, zoals een drumcomputer).
  d.noteOn(36, 0.8, 5); d.noteOn(36, 0.8, 5.25);
  const k1 = BRONNEN.at(-2), gk = keten(k1).g.gain;
  ok('dezelfde pad opnieuw: de vorige kick in 6 ms naar 0, zonder sprong', gk.waarde(5.25 + KAP) === 0 && grootsteStap(gk, 5.24, 5.27) <= gk.waarde(5.249) * 0.0001 / KAP * 1.01);

  // Nu (geen t): de fade begint pas na startDrempel, anders stort hij in.
  NOW = 10;
  d.noteOn(43, 0.8);
  const open4 = laatste(ctx), g4 = keten(open4).g.gain, n4 = g4.waarde(10.001);
  d.noteOn(39, 0.8);
  ok(`nu: de choke begint na startDrempel (${(drempel * 1000).toFixed(1)} ms), niet in wat al gerenderd wordt`,
    Math.abs(g4.waarde(10 + drempel - 0.0001) - n4) < 1e-9 && g4.waarde(10 + drempel + KAP) === 0);
  ok('geen setValueCurveAtTime, geen overlap, geen afgebroken curve', PARAMS.every((q) => q.n.curve === 0) && stats.OVERLAP_FOUTEN === 0 && stats.CURVE_BREUK === 0);
}

// ---- 6. stemroof ---------------------------------------------------------------------------
console.log('\nstemroof');
{
  const { ctx, d } = nieuw(); await d.start();
  const lang = ctx.createBuffer(2, 48000 * 3, 48000);
  for (let c = 0; c < 2; c++) lang.getChannelData(c).fill(0.5);
  for (let q = 9; q <= 16; q++) d.laadPad(q, lang, `lang ${q}`);
  // Zestien verschillende pads, elk lang genoeg om te blijven klinken.
  const t = (i) => 1.1 + i * 0.01;
  d.zetParam(7, 1);                                  // HATS lang: ook de hats klinken nog
  for (let i = 0; i < 16; i++) d.noteOn(36 + i, 0.8, t(i));
  const bronnen = ctx.bronnen.slice(-16);
  const op = 1.1 + 15 * 0.01 + 0.001;
  const klinkend = bronnen.filter((s) => keten(s).g.gain.waarde(op + KAP + 0.002) > 0);
  ok(`zestien pads tegelijk: hooguit ${MAX_STEMMEN} klinken`, klinkend.length === MAX_STEMMEN, `${klinkend.length}`);
  const weg = bronnen.filter((s) => keten(s).g.gain.waarde(op + 0.05) === 0).map((s) => bronnen.indexOf(s));
  ok('... de vier oudsten zijn weg (de eerste vier aanslagen)', weg.join(',') === '0,1,2,3', weg.join(','));
  // De gesloten hat (3) ging al bij de open hat (7): de choke-groep. Daarna
  // waren er nog elf; de 13e, 14e en 15e aanslag verdringen kick, snare, clap.
  const wanneer = [t(13), t(14), t(15), t(7)];
  ok('... elk op vol niveau tot de aanslag die hem verdringt (of de open hat), dan pas de helling', bronnen.slice(0, 4).every((s, i) => {
    const g = keten(s).g.gain;
    return Math.abs(g.waarde(wanneer[i]) - g.waarde(t(i) + 0.001)) < 1e-9 && g.waarde(wanneer[i] + KAP) === 0;
  }));
  ok('... elk weg met een helling zonder sprong', bronnen.slice(0, 4).every((s, i) => {
    const g = keten(s).g.gain, v = g.waarde(wanneer[i]);
    return grootsteStap(g, wanneer[i] - 0.002, wanneer[i] + 0.01) <= v * 0.0001 / KAP * 1.01 + 1e-12;
  }));
  ok('stand().klinkt telt alleen wat op dit moment klinkt', d.stand().klinkt === 0);
  await tik(0.26);
  ok('stand().klinkt na de laatste aanslag: 12', d.stand().klinkt === MAX_STEMMEN, `${d.stand().klinkt}`);
}

// ---- 7. stil() --------------------------------------------------------------------------------
console.log('\nstil()');
{
  const { ctx, d } = nieuw(); await d.start();
  const lang = ctx.createBuffer(1, 48000 * 2, 48000);
  lang.getChannelData(0).fill(0.7);
  d.laadPad(9, lang);
  d.noteOn(44, 1, 1.0);                          // een lange: klinkt nog
  d.zetParam(2, 0.5);                            // DECAY: de volgende krijgt een staart van ~0,3 s
  d.noteOn(36, 0.8, 1.0);                        // midden in zijn staart als stil() komt
  d.zetParam(2, 1);
  d.noteOn(38, 0.9, 1.6);                        // gepland, begint pas na stil()
  await tik(0.15);
  const [s1, s2, s3] = ctx.bronnen.slice(-3), kk = [s1, s2, s3].map(keten), [g1, g2, g3] = kk.map((k) => k.g.gain);
  const v2 = g2.waarde(NOW + drempel);
  ok('voor stil(): de lange op vol niveau, de kick midden in zijn staart', g1.waarde(NOW) > 0.9 && v2 > 0 && v2 < g2.waarde(1.0));
  const nu = NOW;
  d.stil();
  const klaar = nu + drempel + STIL;
  ok('stil(): de lange staat tot het houdpunt (nu + startDrempel) nog op vol niveau', Math.abs(g1.waarde(nu + drempel) - g1.waarde(nu)) < 1e-9 && g1.waarde(nu) > 0.9);
  ok(`stil(): alles op ${((drempel + STIL) * 1000).toFixed(1)} ms precies 0`, [g1, g2, g3].every((g) => g.waarde(klaar) === 0 && g.waarde(klaar + 1) === 0));
  ok('... zonder sprong: grootste stap per 0,1 ms = de helling van 12 ms',
    grootsteStap(g1, nu, klaar + 0.01) <= g1.waarde(nu) * 0.0001 / STIL * 1.01 && grootsteStap(g2, nu, klaar + 0.01) <= v2 * 0.0001 / STIL * 1.01);
  ok('... ook midden in een staart: hij houdt vast waar hij is en gaat van daar naar 0', Math.abs(g2.waarde(nu + drempel) - v2) < 1e-9);
  ok('... de geplande snare (1,6) klinkt nooit', g3.waarde(1.6) === 0 && g3.waarde(1.7) === 0 && s3.eind() <= klaar + 0.002);
  ok('... alle bronnen stoppen', [s1, s2, s3].every((s) => s.stopOp !== null && s.stopOp <= klaar + 0.002));
  await tik(0.1);
  ok('daarna ruimt onended op: geen stemmen meer, nodes los', d.stemmen.length === 0 && [s1, s2, s3].every((s) => s.los > 0) && kk.every((k) => k.g.naar.length === 0 && k.filter.los > 0));
  d.noteOn(36, 0.8);
  ok('na stil() speelt een nieuwe aanslag gewoon', keten(laatste(ctx)).g.gain.waarde(NOW + 0.001) > 0);
}

// ---- 8. pads 9–16: laadPad en wisPad --------------------------------------------------
console.log('\nlaadPad en wisPad');
{
  const { ctx, d } = nieuw(); await d.start();
  const buf = ctx.createBuffer(2, 24000, 48000);
  for (let c = 0; c < 2; c++) buf.getChannelData(c).fill(c ? -0.5 : 0.5);
  ok('laadPad(9, buffer, naam): true', d.laadPad(9, buf, 'stuk 1') === true);
  d.noteOn(44, 0.8, 1.5);
  const s = laatste(ctx);
  ok('noot 44 speelt pad 9', s && s.startOp === 1.5 && s.buffer && s.buffer.length === 24000);
  ok('... een KOPIE (het origineel blijft van de sampler)', s.buffer !== buf && buf.getChannelData(0)[0] === 0.5);
  const x = s.buffer.getChannelData(0);
  ok('... met fades: eerste en laatste sample 0, midden gelijk', x[0] === 0 && x[x.length - 1] === 0 && x[12000] === 0.5 && s.buffer.getChannelData(1)[12000] === -0.5);
  ok('... stereo: geen √2 (de panner geeft stereo op het midden door)', Math.abs(keten(s).g.gain.waarde(1.6) - Math.pow(0.8, 1.5)) < 1e-9);
  ok('stand(): pad 9 gevuld, met zijn naam', d.stand().pads[8].gevuld && d.stand().pads[8].naam === 'stuk 1');
  d.laadPad(10, buf);
  ok('zonder naam: "PAD 10"', d.stand().pads[9].naam === 'PAD 10');
  ok('laadPad op een kit-pad (3), pad 0 of 17: false, kit blijft', d.laadPad(3, buf) === false && d.laadPad(0, buf) === false && d.laadPad(17, buf) === false && d.pads[2].buffer.numberOfChannels === 1);
  ok('laadPad zonder (geldige) buffer: false', d.laadPad(11, null) === false && d.laadPad(11, {}) === false && d.laadPad(11, { length: 0, numberOfChannels: 1, getChannelData() {} }) === false);
  const vier = ctx.createBuffer(4, 4800, 48000);
  ok('vier kanalen (stems): de kopie heeft er twee', d.laadPad(12, vier) && d.pads[11].buffer.numberOfChannels === 2);
  const kort = ctx.createBuffer(1, 3, 44100);
  kort.getChannelData(0).fill(1);
  ok('heel kort (3 samples, 44,1 kHz): mag, op zijn eigen sampleRate', d.laadPad(13, kort) && d.pads[12].buffer.sampleRate === 44100 && d.pads[12].buffer.length === 3);
  d.noteOn(48, 0.8, 2);
  ok('... en een mono eigen buffer krijgt wel √2', Math.abs(keten(laatste(ctx)).g.gain.waarde(2) / Math.pow(0.8, 1.5) - Math.SQRT2) < 1e-9);
  NOW = 1.55;
  ok('wisPad(9) terwijl hij klinkt: true', d.wisPad(9) === true);
  const gw = keten(s).g.gain;
  ok('... en wat klonk fadet weg (na startDrempel, 6 ms)', gw.waarde(1.55 + drempel + KAP) === 0 && grootsteStap(gw, 1.55, 1.6) <= gw.waarde(1.55) * 0.0001 / KAP * 1.01
    && Math.abs(gw.waarde(1.55 + drempel) - gw.waarde(1.55)) < 1e-9);
  const n0 = ctx.bronnen.length;
  d.noteOn(44, 0.8);
  ok('daarna is noot 44 stil, zonder fout', ctx.bronnen.length === n0 && d.fouten === 0 && !d.stand().pads[8].gevuld && d.stand().pads[8].naam === null);
  ok('wisPad op een lege pad, een kit-pad of 17: false', d.wisPad(9) === false && d.wisPad(1) === false && d.wisPad(17) === false && d.pads[0].buffer);
}

// ---- 9. de parameters --------------------------------------------------------------------
console.log('\nparameters');
{
  const { ctx, d } = nieuw(); await d.start();
  const e = (k, v) => DEF[k - 1].eenheid(v);
  ok('eenheden: TOON 0 / +12 / −12 halve tonen', e(1, 0.5) === '0' && e(1, 1) === '+12 halve tonen' && e(1, 0) === '−12 halve tonen' && e(1, 0.5 + 1 / 24) === '+1 halve toon');
  ok('eenheden: DECAY vol / 30 ms, FILTER open / 50 Hz, DRIVE uit', e(2, 1) === 'vol' && e(2, 0) === '30 ms' && e(3, 1) === 'open' && e(3, 0) === '50 Hz' && e(4, 0) === 'uit' && e(4, 1) === '100%');
  ok('eenheden: KICK 48 Hz, SNARE snaar 50%, HATS open 550 ms, NIVEAU 0,0 dB / stil', e(5, 0.5) === '48 Hz' && e(6, 0.5) === 'snaar 50%' && e(7, 0.5) === 'open 550 ms' && e(8, 0.8) === '0,0 dB' && e(8, 0) === 'stil' && e(8, 1) === '+9,0 dB',
    [e(5, 0.5), e(6, 0.5), e(7, 0.5), e(8, 0.8), e(8, 1)].join(' · '));

  // TOON: nieuwe aanslagen en wat klinkt.
  d.noteOn(36, 0.8, 1.2);
  const s0 = laatste(ctx);
  d.zetParam(1, 1);
  d.noteOn(37, 0.8, 1.3);
  ok('TOON 1: rate 2 (+12) voor een nieuwe aanslag', laatste(ctx).playbackRate.value === 2);
  ok('... en wat al klinkt glijdt mee (setTargetAtTime, geen sprong)', s0.playbackRate.n.target === 1 && Math.abs(s0.playbackRate.waarde(NOW + 1) - 2) < 1e-6 && s0.playbackRate.waarde(NOW) === 1);
  d.zetParam(1, 0.5);
  d.buig(1);
  d.noteOn(37, 0.8, 1.4);
  ok('buig(1): +2 halve tonen', Math.abs(laatste(ctx).playbackRate.value - Math.pow(2, 2 / 12)) < 1e-12);
  d.buig(-5);
  ok('buig klemt op −1', d.buiging === -1);
  d.buig(0);

  // FILTER
  d.zetParam(3, 0.5);
  d.noteOn(36, 0.8, 1.5);
  const f = keten(laatste(ctx)).filter;
  ok('FILTER 0,5: ~1,1 kHz, laagdoorlaat, Q 1 dB', Math.abs(f.frequency.value - 50 * Math.sqrt(480)) < 1e-6 && f.Q.value === 1, `${Math.round(f.frequency.value)} Hz`);
  d.zetParam(3, 1);
  ok('... open gezet: wat klinkt glijdt naar Nyquist', Math.abs(f.frequency.waarde(NOW + 1) - 24000) < 1e-3);

  // DRIVE
  d.zetParam(4, 0.5);
  d.noteOn(36, 0.8, 1.6); const v1 = keten(laatste(ctx)).vorm;
  d.noteOn(37, 0.8, 1.7); const v2 = keten(laatste(ctx)).vorm;
  ok('DRIVE 0,5: een WaveShaper in de keten (2x oversample)', v1 && v1.oversample === '2x' && v1.curve.length === 2049);
  ok('... de kromme is gedeeld (één per trap, niet per aanslag) en 0 blijft 0', v1.curve === v2.curve && v1.curve[1024] === 0);
  ok('... monotoon en symmetrisch', v1.curve.every((y, i) => i === 0 || y > v1.curve[i - 1]) && v1.curve.every((y, i) => Math.abs(y + v1.curve[2048 - i]) < 1e-7));
  d.zetParam(4, 0);
  d.noteOn(36, 0.8, 1.8);
  ok('DRIVE 0: geen WaveShaper', keten(laatste(ctx)).vorm === null);

  // KICK / SNARE / HATS: opnieuw gerekend bij de volgende aanslag.
  const kickVoor = d.pads[0].buffer, hatVoor = d.pads[3].buffer;
  d.zetParam(5, 1); d.zetParam(5, 0.9); d.zetParam(5, 0.8);
  ok('KICK draaien rekent niet bij elke stap (pas bij de volgende aanslag)', d.pads[0].buffer === kickVoor && d.pads[0].vuil);
  d.noteOn(36, 0.8, 1.9);
  ok('... de volgende kick wel, met de nieuwe toon (zelfde lengte, andere golf)', d.pads[0].buffer !== kickVoor && laatste(ctx).buffer === d.pads[0].buffer
    && d.pads[0].buffer.length === kickVoor.length && d.pads[0].buffer.getChannelData(0)[2000] !== kickVoor.getChannelData(0)[2000]);
  d.zetParam(7, 1);
  d.noteOn(39, 0.8, 2);
  ok('HATS 1: de gesloten hat ×2,86 zo lang', Math.abs(d.pads[3].buffer.length / hatVoor.length - 1 / 0.35) < 0.01);
  ok('... de open hat ook (pas bij zijn aanslag)', d.pads[7].vuil === true);
  const snareVoor = d.pads[1].buffer.getChannelData(0).slice();
  d.zetParam(6, 0); d.noteOn(37, 0.8, 2.1);
  const snareVel = d.pads[1].buffer.getChannelData(0);
  ok('SNARE 0: alleen het vel (de toon van 186 Hz, geen ruis)', snareVel.some((v, i) => v !== snareVoor[i]) && Math.abs(snareVel[Math.round(48000 / 186 / 4)]) > 0.5);

  // DECAY
  d.zetParam(2, 0);
  d.noteOn(36, 0.8, 3);
  const sd = laatste(ctx), gd = keten(sd).g.gain;
  ok('DECAY 0: de kick stopt na 30 ms, eerst vast, dan in hellingen naar precies 0', sd.stopOp <= 3.0315 && gd.waarde(3.005) === gd.waarde(3.0) && gd.waarde(3.03) === 0
    && gd.waarde(3.02) < gd.waarde(3.01) && grootsteStap(gd, 3.0001, 3.04) < gd.waarde(3.001) * 0.12);
  d.zetParam(2, 1);
  d.noteOn(36, 0.8, 3.5);
  ok('DECAY vol: geen envelope, geen stop (het geluid zelf loopt af)', laatste(ctx).stopOp === null && keten(laatste(ctx)).g.gain.n.lin === 0);

  // NIVEAU
  d.zetParam(8, 1);
  ok('NIVEAU 1: de uitgang glijdt naar faderGain(1) × UIT_OPHOGING (+9 dB)', Math.abs(d.uit.gain.waarde(NOW + 1) - UIT_OPHOGING) < 1e-6 && d.uit.gain.n.target === 1);
  ok('nergens setValueCurveAtTime', PARAMS.every((q) => q.n.curve === 0) && stats.OVERLAP_FOUTEN === 0 && stats.CURVE_BREUK === 0);
  ok('geen vangnet-fouten in noteOn', d.fouten === 0, d.laatsteFout?.message ?? '');
}

// ---- 9a. TOON terwijl een lang stuk klinkt: het einde schuift mee ------------------------
console.log('\nTOON terwijl een lang stuk klinkt');
{
  const { ctx, d } = nieuw(); await d.start();
  const b = ctx.createBuffer(2, 48000, 48000);
  d.laadPad(9, b);
  d.noteOn(44, 0.8);                                 // t0 = 1, één seconde lang
  const st = d.stemmen.at(-1);
  ok('einde: t0 + 1 s', Math.abs(st.eind - 2) < 1e-9);
  NOW = 1.5;
  d.zetParam(1, 0);                                  // −12: de rest (0,5 s) duurt nu 1 s
  ok('TOON −12 halverwege: het einde schuift naar 2,5 s', Math.abs(st.eind - 2.5) < 1e-9, st.eind.toFixed(4));
  NOW = 2.2;
  ok('... en op 2,2 s telt hij nog als klinkend (en het vangnet laat hem staan)', d.stand().klinkt === 1 && d.stemmen.includes(st));
  d.zetParam(1, 1);                                  // +12: de rest (0,35 s) duurt nu 0,175 s
  ok('TOON +12 daarna: 2,2 + 0,35 / 2', Math.abs(st.eind - (2.2 + (1 - 0.5 - 0.7 * 0.5) / 2)) < 1e-9, st.eind.toFixed(4));
}

// ---- 9b. de punten van een stem = wat de AudioParam doet ----------------------------------
// _kap zet zijn beginpunt met de waarde uit de punten van de stem; die moeten dus
// precies kloppen met de tijdlijn, ook na een choke midden in een DECAY-helling.
console.log('\nde punten van een stem');
{
  const { ctx, d } = nieuw(); await d.start();
  const stemmen = [];
  for (const [decay, noot, t, kap] of [[1, 36, 1.1, null], [0.4, 37, 1.2, 1.31], [0.2, 43, 1.4, 1.43], [0.6, 39, 1.5, 1.45], [0.3, 38, 1.6, 1.6]]) {
    d.zetParam(2, decay);
    d.noteOn(noot, 0.7, t);
    const st = d.stemmen.at(-1);
    if (kap !== null) d._kap(st, kap, KAP);
    stemmen.push(st);
  }
  let max = 0;
  for (const st of stemmen) for (let t = 1; t < 2.5; t += 0.00037) max = Math.max(max, Math.abs(M.waardeOp(st.punten, t) - st.g.gain.waarde(t)));
  ok('waardeOp(punten, t) = de tijdlijn van de versterking, overal (vóór, in en na de envelope en de kap)', max < 1e-9, max.toExponential(1));
}

// ---- 10. opruimen en vernietig() ---------------------------------------------------------
console.log('\nopruimen');
{
  const { ctx, d } = nieuw(); await d.start();
  d.noteOn(36, 0.8, 1.01);
  d.noteOn(37, 0.8, 1.02);
  ok('twee stemmen in de lijst', d.stemmen.length === 2);
  await tik(0.2);
  ok('stand().klinkt = 2 terwijl ze klinken', d.stand().klinkt === 2);
  await tik(1);
  ok('voorbij hun einde: onended haalt ze weg, nodes los', d.stemmen.length === 0 && ctx.bronnen.every((s) => s.los === 1) && d.stand().klinkt === 0);
  d.noteOn(36, 0.8, NOW + 0.01);
  const s = laatste(ctx);
  d.vernietig();
  ok('vernietig(): stil (fade), nog aangesloten tot de fade klaar is', keten(s).g.gain.waarde(NOW + drempel + STIL) === 0 && d.uit.los === 0);
  await tik(0.05);
  ok('... na de laatste onended los van de uitgang', d.uit.los === 1 && d.stemmen.length === 0);
  const n0 = ctx.bronnen.length;
  let gegooid = null;
  try { d.noteOn(36, 0.8); d.zetParam(1, 0); d.laadPad(9, ctx.createBuffer(1, 10, 48000)); d.buig(1); d.stil(); d.vernietig(); } catch (e) { gegooid = e; }
  ok('daarna doet alles niets meer (en gooit niet)', gegooid === null && ctx.bronnen.length === n0 && d.leesParam(1) === 0.5);
  const leeg = nieuw().d;
  leeg.vernietig();
  ok('vernietig zonder stemmen: meteen los', leeg.uit.los === 1);
}

// ---- 11. regels ------------------------------------------------------------------------------
console.log('\nregels');
{
  const bron = readFileSync(new URL('../src/engine/instrumenten/drums.js', import.meta.url), 'utf8');
  const code = bron.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const imports = [...bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  ok('importeert alleen uit engine en lib (regel 1)', imports.length > 0 && imports.every((i) => /^\.\.\/(\.\.\/lib\/|[a-z-]+\.js$)/.test(i) && !/\/(ui|control|server)\//.test(i)), imports.join(', '));
  ok('geen DOM, geen MIDI', !/\b(document|window|navigator)\./.test(code) && !/requestMIDIAccess/.test(code));
  ok('geen eigen klok: geen setTimeout/setInterval/performance.now/Date (regel 3)', !/setTimeout|setInterval|performance\.now|Date\.now/.test(code));
  ok('geen setValueCurveAtTime, geen Math.random (de ruis heeft een zaad)', !/setValueCurveAtTime|Math\.random/.test(code));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
