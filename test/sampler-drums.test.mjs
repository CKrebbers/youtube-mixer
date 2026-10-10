// Crossover stap 1 (docs/INSTRUMENTEN.md "Uit de sampler"): een sampler-pad als drumpad
// op de Drums, op dezelfde fysieke Maschine-pad (S1–S4 → 13–16, S5–S8 → 9–12). Nep-Web
// Audio (overgenomen uit test/instrumenten.test.mjs), de echte engine en de echte bus. In
// Chromium met echte audio: tools/headless/sampler-drums.mjs.
// Draai met: node test/sampler-drums.test.mjs
import { readFileSync } from 'node:fs';

let NOW = 0;
let CURVES = 0;                      // setValueCurveAtTime: verboden (CLAUDE.md, overgangen)
const LIJNEN = [];                   // { van, naar }: wat er nu verbonden is
const OSCS = [];                     // elke oscillator die gemaakt is
const param = (v = 0) => ({ value: v, ev: [],
  setValueAtTime(x, t) { this.ev.push(['set', x, t]); this.value = x; },
  linearRampToValueAtTime(x, t) { this.ev.push(['ramp', x, t]); this.value = x; },
  setTargetAtTime(x, t, tau) { this.ev.push(['target', x, t, tau]); this.value = x; },
  setValueCurveAtTime() { CURVES++; },
  cancelAndHoldAtTime(t) { this.ev.push(['hold', t]); },
  cancelScheduledValues(t) { this.ev.push(['cancel', t]); },
});
const node = (type) => ({
  type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0), offset: param(0), delayTime: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, curve: null, oversample: 'none',
  connect(naar) { LIJNEN.push({ van: this, naar }); return naar; },
  disconnect(naar) { for (let i = LIJNEN.length - 1; i >= 0; i--) if (LIJNEN[i].van === this && (naar === undefined || LIJNEN[i].naar === naar)) LIJNEN.splice(i, 1); },
  getByteTimeDomainData(b) { b.fill(128); },
  getFloatFrequencyData(b) { b.fill(-100); },
});
const verbonden = (van, naar) => LIJNEN.some((l) => l.van === van && l.naar === naar);
const bron = (type) => {
  const n = node(type);
  n._start = null; n._stop = null; n._klaar = false;
  n.start = (t = 0) => { n._start = t; };
  n.stop = (t = 0) => { n._stop = t; };
  return n;
};
/** Wat in de echte browser vanzelf gebeurt: onended zodra de stoptijd voorbij is. */
const vuurEinden = () => { for (const o of OSCS) if (!o._klaar && o._stop !== null && o._stop <= NOW) { o._klaar = true; o.onended?.(); } };
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0.005; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { const n = node('biquad'); n.type = 'lowpass'; return n; }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { return node('delay'); }
  createWaveShaper() { return node('shaper'); }
  createChannelMerger() { return node('merger'); }
  createOscillator() { const o = bron('osc'); o.type = 'sine'; o.frequency.value = 440; o.setPeriodicWave = (w) => { o.type = 'custom'; o.golf = w; }; OSCS.push(o); return o; }
  createConstantSource() { return bron('constant'); }
  // Wat FM (MediSynth) gebruikt: een eigen golfvorm en een panner per stem.
  createPeriodicWave(re, im) { return { re, im }; }
  createStereoPanner() { const n = node('panner'); n.pan = param(0); return n; }
  createBufferSource() {
    const s = bron('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    const stop = s.stop; s.stop = (t) => { stop(t); queueMicrotask(() => s.onended?.()); };
    return s;
  }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};
// De stand van een bevestiging (tweede druk binnen 3 s) loopt op performance.now().
let KLOK_MS = 0;
Object.defineProperty(globalThis.performance, 'now', { value: () => KLOK_MS, configurable: true, writable: true });

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const dicht = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- crossover: sampler-pad -> drumpad op dezelfde Maschine-pad ------------------
const { Engine } = await import('../src/engine/engine.js');
const { bindEngine, invoke, read, has, list, metaOf, DRUMPAD_VAN_SAMPLER, drumMelding, stemsInKnip } = await import('../src/control/actions.js');
const DP = await import('../src/control/drumpads.js');
const { EERSTE_NOOT, KIT_PADS } = await import('../src/engine/instrumenten/drums.js');
const { OVERSLAAN } = await import('../src/control/terugspelen.js');
const { kleurVoor } = await import('../src/control/feedback.js');
const { beschrijf } = await import('../src/ui/apc-beschrijf.js');
const { STEM_STANDEN } = await import('../src/engine/deck.js');
const eng = new Engine();
bindEngine(eng);
const meldingen = [];
eng.on('melding', (m) => meldingen.push(m));
const laatste = () => meldingen.at(-1)?.tekst ?? '';
NOW = 100;

console.log('de tabel: dezelfde fysieke pad als in de padmodus sampler');
ok('DRUMPAD_VAN_SAMPLER = 13 14 15 16 9 10 11 12 (S1–S4 bovenste rij, S5–S8 tweede rij)', DRUMPAD_VAN_SAMPLER.join() === '13,14,15,16,9,10,11,12');
ok('actions.js her-exporteert de tabel uit drumpads.js (apc-beschrijf leest hem zonder engine)', DRUMPAD_VAN_SAMPLER === DP.DRUMPAD_VAN_SAMPLER);
ok('drumpadNoot(p) = de noot van de Drums (pad 1 = 36): 13 → 48, 12 → 47', [...Array(16)].every((_, k) => DP.drumpadNoot(k + 1) === EERSTE_NOOT + k) && DP.drumpadNoot(13) === 48 && DP.drumpadNoot(12) === 47);
ok('alleen pads 9–16 (de kit 1–8 blijft heel)', DRUMPAD_VAN_SAMPLER.every((p) => p > KIT_PADS && p <= 16) && new Set(DRUMPAD_VAN_SAMPLER).size === 8);
ok('nootnamen: 48 = C3, 47 = B2, 44 = G#2', DP.nootNaamDrum(48) === 'C3' && DP.nootNaamDrum(47) === 'B2' && DP.nootNaamDrum(44) === 'G#2');

console.log('\nde actions');
ok('8 actions sampler.N.drums, allemaal trigger', [1, 2, 3, 4, 5, 6, 7, 8].every((n) => has(`sampler.${n}.drums`) && metaOf(`sampler.${n}.drums`)?.type === 'trigger'));
ok('geen sampler.N.drums.clear (W8: pas als Clay het mist)', ![1, 2, 3, 4, 5, 6, 7, 8].some((n) => has(`sampler.${n}.drums.clear`)) && !list().some((a) => /drums\.clear$/.test(a.id ?? a)));
ok('label noemt de drumpad en de Maschine-pad', /drumpad 13 .*Maschine-pad 13/.test(metaOf('sampler.1.drums')?.label ?? '') && /drumpad 12 .*Maschine-pad 12/.test(metaOf('sampler.8.drums')?.label ?? ''));
ok('lege sampler-pad: geweigerd met reden', eng.samplerNaarDrums(0, { pad: 13 }).ok === false && /sampler-pad 1 is leeg/.test(eng.samplerNaarDrums(0, { pad: 13 }).reden));
{
  // Review 1, punt 4: geen stille standaard-pad in de engine (de oude jury-tabel zette S1 op 9).
  const zonder = eng.samplerNaarDrums(0, {}), kaal = eng.samplerNaarDrums(0), kit = eng.samplerNaarDrums(0, { pad: 5 }), te = eng.samplerNaarDrums(0, { pad: 17 });
  ok(`zonder pad: geweigerd met "geen drumpad gekozen" (${zonder.reden}), ook zonder opties`, zonder.ok === false && zonder.reden === 'geen drumpad gekozen' && kaal.ok === false && kaal.reden === 'geen drumpad gekozen');
  ok(`pad buiten 9–16: geweigerd (${kit.reden}; ${te.reden})`, !kit.ok && /alleen 9–16 \(1–8 is de kit\)/.test(kit.reden) && !te.ok && /alleen 9–16/.test(te.reden) && !eng.samplerNaarDrums(0, { pad: 13.5 }).ok);
}
const b = eng.ctx.createBuffer(2, 23226, 48000);
b.getChannelData(0).fill(0.25); b.getChannelData(1).fill(-0.25);
eng.sampler.pads[0] = { buffer: b, bpm: 124, bron: 1, tellen: 1, van: 10, tot: 10.484, deckId: 'A', gewichten: null, stemNamen: null, speelt: false, src: null, g: null };
ok('geen instrument: geweigerd', eng.samplerNaarDrums(0, { pad: 13 }).ok === false && /nergens een instrument/.test(eng.samplerNaarDrums(0, { pad: 13 }).reden));
invoke('sampler.1.drums', true);
ok('… en de action zegt het als fout, zonder "sampler pad 1:" ervoor (de reden noemt de pad al)', meldingen.at(-1)?.soort === 'fout' && /^er staat nergens een instrument/.test(laatste()));
eng.setFocus('C');
eng.zetInstrument('C', 'poly');
ok('Poly op de speeltrack en geen Drums: geweigerd (alleen de Drums)', /track 3: .*alleen de Drums/.test(eng.samplerNaarDrums(0, { pad: 13 }).reden ?? ''));
ok('read null met alleen Poly', read('sampler.1.drums') === null);
eng.zetInstrument('C', 'drums');
const dr = eng.instrumentOp('C');
ok('Drums op C, speeltrack C', dr?.soort === 'drums' && eng.speeltrack() === 'C' && eng.drumsDoel().id === 'C');
ok('read 0,5: kan', read('sampler.1.drums') === 0.5);
ok('read null: sampler-pad 2 leeg', read('sampler.2.drums') === null);
invoke('sampler.1.drums', true);
const p13 = dr.stand().pads[12];
ok(`S1 → drumpad 13, noot 48, naam "S1 · track 1" (${p13.naam})`, p13.gevuld && p13.noot === 48 && p13.naam === 'S1 · track 1' && !p13.kit);
ok('drumpad 9 (de oude plek uit de jury-proef) blijft leeg', !dr.stand().pads[8].gevuld);
ok('de kopie is een andere buffer met in-fade (eerste sample 0) en dezelfde lengte', dr.pads[12].buffer !== b && dr.pads[12].buffer.length === b.length
  && dr.pads[12].buffer.getChannelData(0)[0] === 0 && dr.pads[12].buffer.getChannelData(0)[5000] === 0.25);
ok('de sampler-pad blijft staan', eng.sampler.pads[0]?.buffer === b);
ok('read 1 = gevuld', read('sampler.1.drums') === 1);
ok(`melding: "S1 staat op drumpad 13 van track 3 (noot C3 · 48)" (${laatste()})`, /^S1 staat op drumpad 13 van track 3 \(noot C3 · 48\)/.test(laatste()) && meldingen.at(-1).soort === 'info');
ok('zonder maat: geen tempowaarschuwing; zonder stems: geen stems-tekst', !/let op|stems/.test(laatste()));
NOW = 101;
dr.noteOn(48, 0.8, 101.1);
const st = dr.stemmen.at(-1);
ok('noteOn(48) speelt drumpad 13 op t (audioklok)', st && st.pad === 12 && st.src._start === 101.1 && st.src.buffer === dr.pads[12].buffer);
eng.sampler.pads[7] = { ...eng.sampler.pads[0], bron: 2 };
invoke('sampler.8.drums', true);
ok('S8 → drumpad 12, noot 47, naam "S8 · track 2"', dr.stand().pads[11].gevuld && dr.stand().pads[11].noot === 47 && dr.stand().pads[11].naam === 'S8 · track 2');
ok('… en de melding zegt B2 · 47', /^S8 staat op drumpad 12 van track 3 \(noot B2 · 47\)/.test(laatste()));

console.log('\nlampjes, terugspelen, uitleg');
const kl = kleurVoor('sampler.1.drums');
ok('kleur: violet / violetdonker / uit (zoals de sampler; 0,5 en 1 zijn te onderscheiden)', kl.aan === 'violet' && kl.half === 'violetdonker' && kl.uit === 'uit');
ok('de kleur van sampler.N en sampler.N.section blijft', kleurVoor('sampler.1').uit === 'donkergrijs' && kleurVoor('sampler.1.section').aan === 'hemelsblauw');
ok('terugspelen slaat sampler.N.drums over, de rest van de sampler niet',
  OVERSLAAN.test('sampler.3.drums') && !OVERSLAAN.test('sampler.3') && !OVERSLAAN.test('sampler.3.section') && !OVERSLAAN.test('sampler.3.clear') && !OVERSLAAN.test('sampler.3.drumsx'));
const u1 = beschrijf('sampler.1.drums'), u8 = beschrijf('sampler.8.drums');
ok(`uitleg S1: kort "${u1.kort}", lang noemt C3 (48) en de strip`, u1.kort === '→drum 13' && /noot C3 \(48\)/.test(u1.lang) && /fader, filter, echo, galm, fx, koptelefoon/.test(u1.lang));
ok('uitleg lampje: fel = er ligt een stuk op drumpad 13, niet per se de knip van nu (review 1, punt 9)', /fel = er ligt een stuk op drumpad 13 \(niet per se de knip van nu\)/.test(u1.lang));
ok(`uitleg S8: kort "${u8.kort}", noot B2 (47)`, u8.kort === '→drum 12' && /noot B2 \(47\)/.test(u8.lang));
ok('geen uitleg meer voor .drums.clear (valt terug op de standaard)', beschrijf('sampler.1.drums.clear').kort !== 'drum 9 −');

console.log('\nwelke Drums (W9)');
eng.zetInstrument('C', 'poly');
eng.zetInstrument('H', 'drums');
eng.sampler.pads[1] = { ...eng.sampler.pads[0] };
ok('Poly op de speeltrack, precies één Drums elders (track 8): daarheen', eng.speeltrack() === 'C' && eng.drumsDoel().id === 'H' && read('sampler.2.drums') === 0.5);
invoke('sampler.2.drums', true);
ok(`… drumpad 14 van track 8 gevuld, de melding noemt track 8 (${laatste()})`, eng.instrumentOp('H').stand().pads[13].gevuld && /drumpad 14 van track 8 \(noot C#3 · 49\)/.test(laatste()));
ok('… en de Poly op 3 is niet aangeraakt', eng.instrumentOp('C').soort === 'poly');
eng.zetInstrument('G', 'drums');
const twee = eng.samplerNaarDrums(1, { pad: 14 });
ok(`twee Drums (7 en 8), Poly op de speeltrack: geweigerd (${twee.reden})`, !twee.ok && /meer dan één Drums \(track 7 en 8\): zet de focus/.test(twee.reden));
ok('… read null', read('sampler.2.drums') === null);
invoke('sampler.2.drums', true);
ok('… de action meldt het als fout', meldingen.at(-1).soort === 'fout' && /meer dan één Drums/.test(laatste()));
eng.setFocus('G');
ok('focus op 7 (een Drums): die is het', eng.drumsDoel().id === 'G' && eng.samplerNaarDrums(1, { pad: 14 }).id === 'G');
for (const id of ['C', 'G', 'H']) eng.zetInstrument(id, null);
// Review 1, punt 2: zo werk je echt. Je knipt met de focus op het NUMMER (track 1), niet op
// een Drums. Dan beslist de speeltrack (waar noot 48 ook heen gaat): geen weigering.
eng.setFocus('A');
eng.zetInstrument('G', 'drums');
eng.zetInstrument('H', 'drums');
ok('Drums op 7 en 8, focus op 1 (een nummer), nooit een instrumenttrack gefocust: de eerste Drums (track 7), niet geweigerd',
  eng.speeltrack() === 'G' && eng.drumsDoel().id === 'G' && read('sampler.2.drums') === 0.5);
invoke('sampler.2.drums', true);
ok(`… de melding noemt track 7 (${laatste()})`, meldingen.at(-1).soort === 'info' && /^S2 staat op drumpad 14 van track 7/.test(laatste()) && eng.instrumentOp('G').stand().pads[13].gevuld);
eng.setFocus('H');
eng.setFocus('A');
ok('na focus 8 en terug naar 1: de laatst gefocuste Drums (track 8), zoals het toetsenbord', eng.speeltrack() === 'H' && eng.drumsDoel().id === 'H');
invoke('sampler.2.drums', true);
ok(`… en daar landt het stuk (${laatste()})`, /^S2 staat op drumpad 14 van track 8/.test(laatste()) && eng.instrumentOp('H').stand().pads[13].gevuld);
eng.zetInstrument('C', 'poly');
eng.setFocus('C');
eng.setFocus('A');
ok('de speeltrack is een Poly (laatst gefocust) en er zijn twee Drums: geweigerd, met de tracks erbij',
  eng.speeltrack() === 'C' && eng.drumsDoel().id === null && /meer dan één Drums \(track 7 en 8\)/.test(eng.drumsDoel().reden));
for (const id of ['C', 'G', 'H']) eng.zetInstrument(id, null);

console.log('\nwat de melding zegt: tempo (H1) en stems (W11)');
eng.setFocus('C');
eng.zetInstrument('C', 'drums');
eng.sampler.pads[2] = { ...eng.sampler.pads[0], bpm: 122 };
const { Beatgrid } = await import('../src/engine/beatgrid.js');
const echteMaster = eng.syncMaster.bind(eng);
// Een maatgever op 128: wat maatVan van een spelend deck leest (fxKlok, grid, positie).
const nepMaat = { id: 'B', grid: new Beatgrid({ bpm: 128, firstBeat: 0 }), position: 1, fxKlok: () => ({ beatLengte: 60 / 128, ankerCtx: NOW + 0.1 }) };
eng.syncMaster = () => nepMaat;
const r3 = eng.samplerNaarDrums(2, { pad: 15 });
ok(`samplerNaarDrums geeft bpm 122 en maatBpm 128 (${r3.bpm}, ${r3.maatBpm})`, r3.ok && r3.bpm === 122 && dicht(r3.maatBpm, 128, 1e-9) && r3.noot === 50);
invoke('sampler.3.drums', true);
ok(`melding: "dit stuk is 122 bpm, de maat staat op 128" (${laatste()})`, /let op: dit stuk is 122 bpm, de maat staat op 128: als drumpad speelt het op 122 \(loops blijven in de sampler\)/.test(laatste()));
nepMaat.fxKlok = () => ({ beatLengte: 60 / 122.4, ankerCtx: NOW + 0.1 });
invoke('sampler.3.drums', true);
ok('0,33 % verschil (122 tegen 122,4): geen waarschuwing (de grens is 0,5 %)', !/let op/.test(laatste()));
eng.syncMaster = echteMaster;
const r = { id: 'C', pad: 13, noot: 48, bpm: 128, maatBpm: 128 };
// De echte indelingen (deck.js STEM_STANDEN): 4 = drums, bas, overig, zang; 2 = zang, rest.
const S4 = [...STEM_STANDEN[4]], S2 = [...STEM_STANDEN[2]];
ok('stems [1, 0, 0, 0] (4 stems: drums, bass, other, vocals): " · stems: drums"', drumMelding(0, { ...r, gewichten: [1, 0, 0, 0], stemNamen: S4 }).endsWith('(noot C3 · 48) · stems: drums'));
ok('stems [0, 0, 0, 1]: in het Nederlands, " · stems: zang"', drumMelding(0, { ...r, gewichten: [0, 0, 0, 1], stemNamen: S4 }).endsWith(' · stems: zang'));
ok('2 stems [1, 0] (vocals, inst): " · stems: zang"', drumMelding(0, { ...r, gewichten: [1, 0], stemNamen: S2 }).endsWith(' · stems: zang'));
ok('dezelfde gewichten zonder namen: " · niet alle stems"', drumMelding(0, { ...r, gewichten: [1, 0, 0, 0], stemNamen: null }).endsWith(' · niet alle stems'));
ok('[1, 1, 1, 1]: geen stems-tekst', !/stems/.test(drumMelding(0, { ...r, gewichten: [1, 1, 1, 1], stemNamen: S4 })));
ok('[1,25 × 4] (schaal 0,8 van de splitter: alle stems aan): geen stems-tekst', stemsInKnip([1.25, 1.25, 1.25, 1.25], S4) === '');
ok('zang op half niveau [1, 1, 1, 0,5]: " · niet alle stems" (niets is weg, wel anders)', stemsInKnip([1, 1, 1, 0.5], S4) === 'niet alle stems');
{
  // Review 1, punt 3: de echte keten. Een deck met stems (zoals laadStems ze zet), de echte
  // kill-knoppen en deck.knipGewichten (niveau × kill × 1/schaal, met "rest" als groep bij
  // 4 stems): de index van de gewichten hoort bij die van stems.namen.
  const d = eng.deck('D');
  const stemsVoor = d.stems;
  const kill = (aan = []) => { for (const n of Object.keys(d.stemKill)) d.stemKill[n] = aan.includes(n); };
  const tekst = () => stemsInKnip(d.knipGewichten(), d.stems.namen);
  d.stems = Object.freeze({ namen: Object.freeze([...STEM_STANDEN[4]]), aantal: 4, schaal: 0.8 });
  kill();
  const alle = d.knipGewichten();
  ok(`4 stems, schaal 0,8, alles aan: [${alle.map((x) => x.toFixed(2)).join(', ')}] → geen tekst`, alle.length === 4 && alle.every((x) => dicht(x, 1.25, 1e-9)) && tekst() === '');
  kill(['bass', 'other', 'vocals']);
  ok(`4 stems, bas, overig en zang uit (de kill-knoppen): "${tekst()}" = "stems: drums"`, tekst() === 'stems: drums');
  kill(['inst']);
  ok(`4 stems, "rest" (de groep drums + bas + overig) uit: "${tekst()}" = "stems: zang"`, tekst() === 'stems: zang');
  kill();
  ok('4 stems, alles weer aan: geen tekst', tekst() === '');
  d.stems = Object.freeze({ namen: Object.freeze([...STEM_STANDEN[2]]), aantal: 2, schaal: 1 });
  kill(['vocals']);
  ok(`2 stems, zang uit: "${tekst()}" = "stems: rest"`, tekst() === 'stems: rest');
  kill();
  d.stems = stemsVoor;
}
ok('alles weg: "stems: geen (stil)"', stemsInKnip([0, 0], ['vocals', 'inst']) === 'stems: geen (stil)');
ok('geen stems (null): geen tekst', stemsInKnip(null, null) === '' && stemsInKnip([], []) === '');

console.log('\nde sampler zet gewichten en stemnamen op de pad bij het knippen');
{
  let meegegeven = 'niet aangeroepen';
  const nepDeck = { id: 'D', stems: { namen: [...STEM_STANDEN[4]], aantal: 4, schaal: 1 }, knipGewichten: () => [1, 0, 0, 0],
    bron: { knip: async (van, tot, g) => { meegegeven = g; const k = eng.ctx.createBuffer(2, Math.round((tot - van) * 48000), 48000); return k; } } };
  await eng.sampler._vul(5, nepDeck, { van: 10, tot: 10.5, bpm: 128, tellen: 1, bron: 4 });
  const sp = eng.sampler.pads[5];
  ok('de knip krijgt de gewichten (wat je hoort)', Array.isArray(meegegeven) && meegegeven.join() === '1,0,0,0');
  ok('pad.gewichten en pad.stemNamen gezet (index k hoort bij elkaar)', sp.gewichten.join() === '1,0,0,0' && sp.stemNamen.join() === 'drums,bass,other,vocals');
  const zonder = { id: 'E', stems: null, knipGewichten: () => null, bron: nepDeck.bron };
  await eng.sampler._vul(6, zonder, { van: 10, tot: 10.5, bpm: 128, tellen: 1, bron: 5 });
  ok('zonder stems: allebei null', eng.sampler.pads[6].gewichten === null && eng.sampler.pads[6].stemNamen === null && meegegeven === null);
  invoke('sampler.6.drums', true);
  ok(`en sampler.6.drums zegt "stems: drums" (${laatste()})`, /^S6 staat op drumpad 10 van track 3 \(noot A2 · 45\) · stems: drums$/.test(laatste()));
}

console.log('\nna herladen (H8)');
{
  eng.zetInstrument('C', null);
  eng.setFocus('A');
  const pt = eng.patronen;
  pt.laadSet({ tracks: { 2: [{ noten: [{ stap: 0, noot: 36 }, { stap: 4, noot: 48 }] }], 4: [{ noten: [{ stap: 0, noot: 36 }] }] }, instrumenten: { 2: { soort: 'drums' }, 4: { soort: 'drums' } } });
  const m0 = meldingen.length;
  const terug = eng.herstelInstrumenten();
  const nieuw = meldingen.slice(m0).map((m) => m.tekst);
  ok(`track 2 terug met de Drums; de patronen gebruiken noot 48 (drumpad 13): een melding (${nieuw.join(' | ')})`,
    terug.includes('B') && nieuw.some((t) => /^track 2: de patronen gebruiken drumpads 9–16, en die zijn na herladen leeg/.test(t)));
  ok('track 4 (alleen de kit, noot 36): geen melding', terug.includes('D') && !nieuw.some((t) => /^track 4:/.test(t)));
  ok('de melding zegt hoe je ze terugzet in gewone taal (de knoppen 1→13 … 8→12), niet met een action-id (review 1, punt 8)',
    nieuw.some((t) => /zet ze terug met de knoppen 1→13 … 8→12 onder de sampler, of je gekoppelde knop; bewaren komt later/.test(t)) && !nieuw.some((t) => /sampler\.N\.drums/.test(t)));
  for (const id of ['B', 'D']) eng.zetInstrument(id, null);
  pt.laadSet({ tracks: { 3: [{ noten: [{ stap: 0, noot: 60 }] }] }, instrumenten: { 3: { soort: 'drums' } } });
  const m1 = meldingen.length;
  eng.herstelInstrumenten();
  ok('noot 60 valt terug op drumpad 9 (padVanNoot): ook een melding', meldingen.slice(m1).some((m) => /^track 3: de patronen gebruiken drumpads 9–16/.test(m.tekst)));
  eng.zetInstrument('C', null);
  pt.laadSet({ tracks: { 3: [{ noten: [{ stap: 0, noot: 48 }] }] }, instrumenten: { 3: { soort: 'poly' } } });
  const m2 = meldingen.length;
  eng.herstelInstrumenten();
  ok('noot 48 op een Poly: geen melding (geen pads)', !meldingen.slice(m2).some((m) => /drumpads 9–16/.test(m.tekst)));
  eng.zetInstrument('C', null);
}

console.log('\nhet scherm (index.html, zonder DOM gelezen)');
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const knoppen = [...html.matchAll(/<button data-kind="button" data-action="sampler\.(\d)\.drums" class="btn sm"[^>]*>(\d)→(\d+)<\/button>/g)];
  ok(`precies acht knoppen data-action="sampler.N.drums" (${knoppen.length})`, knoppen.length === 8 && (html.match(/data-action="sampler\.\d\.drums"/g) ?? []).length === 8);
  ok('in de volgorde 1–8 met opschrift 1→13 … 8→12 (sampler-pad → drumpad, de tabel)', knoppen.every((m, k) => Number(m[1]) === k + 1 && Number(m[2]) === k + 1 && Number(m[3]) === DRUMPAD_VAN_SAMPLER[k]));
  ok('geen drums.clear, geen shift-variant', !/drums\.clear/.test(html) && !knoppen.some((m) => /data-action-shift/.test(m[0])));
  ok('niet met class "pad" (renderloop.js telt .pad als de acht sampler-pads)', (html.match(/class="pad"/g) ?? []).length === 8);
  const sec = html.slice(html.indexOf('<section id="sampler"'), html.indexOf('</section>', html.indexOf('<section id="sampler"')));
  ok('in de sampler-rij', (sec.match(/sampler\.\d\.drums/g) ?? []).length === 8);
}

eng.zetInstrument('C', null);
ok('instrument eraf: read null, geen fout', read('sampler.1.drums') === null);
ok('nergens setValueCurveAtTime', CURVES === 0);
console.log(fails.length ? `\n${fails.length} FAIL: ${fails.join(', ')}` : '\nalles ok');
process.exit(fails.length ? 1 : 0);
