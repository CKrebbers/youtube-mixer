// Secties (docs/SECTIES.md): het nummer in stukken die je speelt.
//  1. Het rekenwerk (server/secties.js) op synthetische nummers met een bekend
//     antwoord: EDM met en zonder stems, een popnummer met een opmaat, ambient
//     zonder drums, zonder grid, en een mix van een uur (hooguit 40 secties).
//  2. Dezelfde nummers door ffmpeg en de worker (maakSecties), zoals de server.
//  3. De regels van de library: normaliseren, wanneer opnieuw, hand en slot.
//  4. De engine: SectieKaart, de sprong op de volgende maat (sectieDoel),
//     deck.naarSectie, de actions en hun lampjes, met een nep-AudioContext.
//  5. De server: GET /api/library/<id>/secties?maak=1 op een eigen poort, met
//     een tijdelijke database en mediamap. Je echte library blijft buiten schot.
// Draai met: node test/secties.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const S = await import('../server/secties.js');
const { synthNummer, stemsInterleaved, PLAN } = await import('./synth-nummer.mjs');
const { Beatgrid } = await import('../src/engine/beatgrid.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const NAMEN = ['vocals', 'drums', 'bass', 'other'];
const zelfde = (a, b, tol = 0.01) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < tol);
const lijst = (k) => k.stukken.map((s) => (s.label === 'deel' ? s.groep : `${s.label} ${s.groep}`)).join(' · ');
const verwacht = (plan) => plan.map((p) => (p[0] === 'deel' ? p[1] : `${p[0]} ${p[1]}`)).join(' · ');

// ---- 1. het rekenwerk -----------------------------------------------------------------

console.log('rekenwerk: synthetische nummers met een bekend antwoord');
const POP = [
  ['intro', 'A', 4, { pad: 1, hats: 1 }, [60, 55], 0.4],
  ['deel', 'B', 16, { kick: 1, hats: 1, bas: 1, pad: 1, zang: 1 }, [60, 55, 57, 53], 0.65],
  ['drop', 'C', 8, { kick: 1, hats: 1, snare: 1, bas: 1, pad: 1, zang: 1, lead: 1 }, [53, 55, 60, 60], 0.9],
  ['deel', 'B', 16, { kick: 1, hats: 1, bas: 1, pad: 1, zang: 1 }, [60, 55, 57, 53], 0.65],
  ['drop', 'C', 8, { kick: 1, hats: 1, snare: 1, bas: 1, pad: 1, zang: 1, lead: 1 }, [53, 55, 60, 60], 0.9],
  ['break', 'D', 8, { pad: 1, zang: 1 }, [57, 53], 0.45],
  ['drop', 'C', 8, { kick: 1, hats: 1, snare: 1, bas: 1, pad: 1, zang: 1, lead: 1 }, [53, 55, 60, 60], 0.9],
  ['outro', 'E', 4, { pad: 1 }, [60], 0.3],
];
const AMBIENT = [
  ['intro', 'A', 8, { pad: 1 }, [50], 0.3],
  ['deel', 'B', 16, { pad: 1, lead: 1 }, [50, 53, 48, 55], 0.5],
  ['deel', 'C', 16, { pad: 1, zang: 1, bas: 1 }, [45, 48], 0.6],
  ['deel', 'B', 16, { pad: 1, lead: 1 }, [50, 53, 48, 55], 0.5],
  ['outro', 'A', 8, { pad: 1 }, [50], 0.25],
];
const kaartVan = (s, { metStems = true, grid = s.grid } = {}) => {
  const fk = S.frameKenmerken(s.mix, s.sr);
  const stems = metStems ? S.stemNiveaus(stemsInterleaved(s.stems, NAMEN, s.sr, S.STEMS_SR), 8, S.STEMS_SR) : null;
  return S.sectieKaart({ fk, stems, stemNamen: metStems ? NAMEN : [], grid, duur: s.duur });
};

const edm = synthNummer();
{
  const t0 = performance.now();
  const k = kaartVan(edm);
  const ms = performance.now() - t0;
  ok(`EDM met stems: de zeven grenzen precies op hun maat (${k.stukken.map((s) => s.van.toFixed(2)).join(' ')})`, zelfde(k.stukken.map((s) => s.van), edm.grenzen));
  ok(`… labels en groepen kloppen: ${lijst(k)}`, lijst(k) === verwacht(PLAN));
  ok('… de twee drops zijn dezelfde groep, de rest elk een eigen', k.stukken[3].groep === k.stukken[5].groep && new Set(k.stukken.map((s) => s.groep)).size === 6);
  ok('… de break heeft geen drums en wel zang, de drop wel drums', k.stukken[4].stems.drums === 0 && k.stukken[4].stems.vocals > 0.5 && k.stukken[3].stems.drums === 1);
  ok('… energie 0..1: de drops het hardst, de outro het zachtst', k.stukken[5].energie === 1 && Math.min(...k.stukken.map((s) => s.energie)) === k.stukken[6].energie);
  ok('… elke grens behalve de eerste heeft een zekerheid', !('zeker' in k.stukken[0]) && k.stukken.slice(1).every((s) => s.zeker > 0 && s.zeker <= 1));
  ok(`… versie, opGrid en de vingerafdruk van het grid erin; bron auto (${ms.toFixed(0)} ms)`,
    k.versie === S.SECTIE_VERSIE && k.opGrid === true && k.grid === S.gridSleutel(edm.grid) && k.bron === 'auto' && k.slot === false);
  const z = kaartVan(edm, { metStems: false });
  ok(`EDM zonder stems: dezelfde grenzen, labels en groepen (${lijst(z)})`, zelfde(z.stukken.map((s) => s.van), edm.grenzen) && lijst(z) === verwacht(PLAN) && !z.stukken.some((s) => s.stems));
}
{
  const pop = synthNummer({ plan: POP, bpm: 96, anker: 1.1 });
  const k = kaartVan(pop);
  ok(`pop (96 bpm, opmaat van 1,1 s): acht grenzen op hun maat, ook couplet → refrein (${k.stukken.map((s) => s.van.toFixed(1)).join(' ')})`,
    zelfde(k.stukken.map((s) => s.van), pop.grenzen));
  ok(`… het refrein komt drie keer terug als dezelfde groep, het luidste = drop: ${lijst(k)}`, lijst(k) === verwacht(POP));
  ok('… de opmaat (0–1,1 s) zit in de eerste sectie: die begint op 0', k.stukken[0].van === 0 && k.stukken[1].van > 1.1);
}
{
  const amb = synthNummer({ plan: AMBIENT, bpm: 70, anker: 0 });
  const k = kaartVan(amb);
  ok(`ambient met stems (geen drums): de grenzen, en nergens een "drop" (${lijst(k)})`,
    zelfde(k.stukken.map((s) => s.van), amb.grenzen) && !k.stukken.some((s) => s.label === 'drop') && k.stukken[1].groep === k.stukken[3].groep);
  const ongr = synthNummer({ plan: AMBIENT, bpm: 70, anker: 0 });
  ongr.grid.stukken[0].zekerheid = 0.1;
  const k2 = kaartVan(ongr, { metStems: false });
  ok('ambient zonder stems, grid zonder zekere puls: ook geen "drop"', !k2.stukken.some((s) => s.label === 'drop'));
}
{
  const k = kaartVan(edm, { metStems: false, grid: null });
  const naast = edm.grenzen.map((g) => Math.min(...k.stukken.map((s) => Math.abs(s.van - g))));
  ok(`zonder grid: stukken van 2 s, elke grens binnen een nep-maat plus een frame (${naast.map((x) => x.toFixed(1)).join(' ')}), opGrid false, geen vingerafdruk`,
    k.opGrid === false && k.grid === null && k.stukken.length === edm.grenzen.length && naast.every((x) => x <= 2.5));
}
{
  const lang = synthNummer({ plan: Array.from({ length: 24 }, () => PLAN).flat() });
  const t0 = performance.now();
  const k = kaartVan(lang, { metStems: false });
  const s = (performance.now() - t0) / 1000;
  ok(`een mix van ${(lang.duur / 60).toFixed(0)} minuten: hooguit 40 secties (${k.stukken.length}), op volgorde, in ${s.toFixed(1)} s`,
    k.stukken.length === 40 && k.stukken.every((x, i) => i === 0 || x.van > k.stukken[i - 1].van) && s < 30);
}
{
  const g = edm.grid, g2 = { ...g, stukken: [{ ...g.stukken[0], bpm: 125 }] };
  ok('gridSleutel: hetzelfde grid = dezelfde sleutel, een ander tempo = een andere, geen grid = null',
    S.gridSleutel(g) === S.gridSleutel(JSON.parse(JSON.stringify(g))) && S.gridSleutel(g) !== S.gridSleutel(g2) && S.gridSleutel(null) === null
    && S.gridSleutel(g) === S.gridSleutel(Beatgrid.van(g)));
  const { maten } = S.maatGrenzen(g, edm.duur);
  ok('maatGrenzen: de opmaat (0–0,3 s) als eigen maat, dan elke "1"', maten[0] === 0 && Math.abs(maten[1] - 0.3) < 1e-9 && Math.abs(maten[2] - maten[1] - 4 * 60 / 124) < 1e-9);
  ok('labels: een luid couplet naast een luider refrein heet geen drop', S.labels(
    [{ energie: 0.1, drums: null, stijging: 0 }, { energie: 0.82, drums: null, stijging: 0 }, { energie: 1, drums: null, stijging: 0 }, { energie: 0.82, drums: null, stijging: 0 }, { energie: 1, drums: null, stijging: 0 }],
    [0, 1, 2, 1, 2]).join() === 'intro,deel,drop,deel,drop');
}

// ---- 2. door ffmpeg en de worker, zoals de server --------------------------------------

console.log('\nworker: audio.wav en stems.wav door ffmpeg, zoals de server ze leest');
const map = mkdtempSync(join(tmpdir(), 'varve-secties-'));
const media = join(map, 'media');
function schrijfWav(pad, kanalen, sr) {
  const n = kanalen[0].length, K = kanalen.length;
  let piek = 1e-9;
  for (const x of kanalen) for (let i = 0; i < n; i++) piek = Math.max(piek, Math.abs(x[i]));
  const y = new Int16Array(n * K);
  for (let i = 0; i < n; i++) for (let k = 0; k < K; k++) y[i * K + k] = Math.round(32767 * 0.8 * kanalen[k][i] / piek);
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(K, 22);
  kop.writeUInt32LE(sr, 24); kop.writeUInt32LE(sr * 2 * K, 28); kop.writeUInt16LE(2 * K, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  mkdirSync(join(pad, '..'), { recursive: true });
  writeFileSync(pad, Buffer.concat([kop, Buffer.from(y.buffer)]));
  return pad;
}
const BR = 48000;
const edm48 = synthNummer({ sr: BR });
// De stems in dezelfde schaal als de mix (de som van de stems = de mix, zoals Demucs).
const piekMix = edm48.mix.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const audio = schrijfWav(join(media, 'edm', 'audio.wav'), [edm48.mix], BR);
const stemKanalen = NAMEN.flatMap((nm) => [edm48.stems[nm], edm48.stems[nm]]);
stemKanalen.push(Float32Array.of(piekMix));   // dezelfde piek als de mix: niets valt weg in de schaal
const stemsWav = schrijfWav(join(media, 'edm', 'stems.wav'), stemKanalen.slice(0, 8).map((x) => x), BR);
const { maakSecties } = await import('../server/analyze.js');
{
  const t0 = performance.now();
  const r = await maakSecties(audio, edm48.grid, { bestand: stemsWav, namen: NAMEN });
  const s = (performance.now() - t0) / 1000;
  ok(`maakSecties (worker, ffmpeg 48 kHz → 11025 Hz, stems 4000 Hz): dezelfde zeven grenzen en labels in ${s.toFixed(1)} s (${r.ok ? lijst(r.secties) : r.fout})`,
    r.ok && zelfde(r.secties.stukken.map((x) => x.van), edm48.grenzen) && lijst(r.secties) === verwacht(PLAN) && r.secties.stukken.every((x) => x.stems));
  const z = await maakSecties(audio, edm48.grid, null);
  ok('zonder stems: dezelfde grenzen, geen stems per sectie', z.ok && zelfde(z.secties.stukken.map((x) => x.van), edm48.grenzen) && !z.secties.stukken.some((x) => x.stems));
  const kapot = await maakSecties(audio, edm48.grid, { bestand: join(media, 'edm', 'bestaatniet.wav'), namen: NAMEN });
  ok('stems.wav onleesbaar: dan zonder stems, geen fout', kapot.ok && !kapot.secties.stukken.some((x) => x.stems));
  const weg = await maakSecties(join(media, 'niets.wav'), null, null);
  ok(`audio onleesbaar: { ok: false, fout } (${weg.fout})`, weg.ok === false && /lezen/.test(weg.fout));
}

// ---- 3. de regels van de library -------------------------------------------------------

console.log('\nlibrary: normaliseren, wanneer opnieuw, hand en slot');
const { Library, normaliseerSecties, moetSectieAnalyse, SCHEMA } = await import('../server/library.js');
{
  const goed = { versie: 1, opGrid: true, grid: 'abcdef01', stukken: [{ van: 0.2, label: 'intro', groep: 'A', energie: 0.2 }, { van: 16, label: 'drop', groep: 'B', energie: 1.4, zeker: 0.9, stems: { drums: 1, 'x y': 1 } }], bron: 'auto' };
  const n = normaliseerSecties(goed);
  ok('normaliseren: de eerste op 0, energie geklemd, rare stemnamen weg, slot false', n && n.stukken[0].van === 0 && n.stukken[1].energie === 1
    && JSON.stringify(n.stukken[1].stems) === '{"drums":1}' && n.slot === false && n.bron === 'auto' && n.grid === 'abcdef01');
  ok('ongeldig: geen stukken, niet oplopend, onbekend label, kleine letter als groep, negatieve tijd',
    [null, {}, { stukken: [] }, { stukken: [{ van: 0, label: 'intro', groep: 'A' }, { van: 0, label: 'drop', groep: 'B' }] },
      { stukken: [{ van: 0, label: 'refrein', groep: 'A' }] }, { stukken: [{ van: 0, label: 'intro', groep: 'a' }] },
      { stukken: [{ van: -1, label: 'intro', groep: 'A' }] }].every((k) => normaliseerSecties(k) === null));
  const k = normaliseerSecties(goed);
  ok('opnieuw: leeg ja; actueel nee; ander grid ja; geen grid meer ja; oudere versie ja; stems erbij ja; met de hand of op slot nooit',
    moetSectieAnalyse(null) && !moetSectieAnalyse(k, { grid: 'abcdef01' }) && moetSectieAnalyse(k, { grid: '12345678' })
    && moetSectieAnalyse(k, { grid: null }) && moetSectieAnalyse(k, { grid: 'abcdef01', versie: 2 })
    && moetSectieAnalyse({ ...k, stukken: [{ ...k.stukken[0], stems: undefined }] }, { grid: 'abcdef01', metStems: true }) === true
    && !moetSectieAnalyse(k, { grid: 'abcdef01', metStems: true })
    && !moetSectieAnalyse({ ...k, bron: 'hand' }, { grid: '12345678' }) && !moetSectieAnalyse({ ...k, slot: true }, { grid: '12345678' }));
  ok('schema: de laatste versie is secties_json', /secties_json/.test(SCHEMA.at(-1)));
  const lib = new Library(join(map, 'regels.db'));
  lib.bewaarTrack({ id: 't1', url: 'https://example.com/t1', titel: 't1', uploader: 't', duur: 160, audio: 'media/edm/audio.wav',
    video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  ok('een nieuw nummer moet secties krijgen; de lijst noemt de kolom niet', lib.moetSecties('t1') && lib.teSectieAnalyseren().includes('t1')
    && !('secties_json' in lib.track('t1')) && !('secties' in lib.track('t1')));
  const b = lib.bewaarAutoSecties('t1', { ...goed, grid: null });
  ok('auto bewaard; daarna (zelfde grid: geen) niet meer nodig', b.bewaard && lib.secties('t1')?.stukken.length === 2 && !lib.moetSecties('t1'));
  lib.bewaarGrid('t1', edm.grid);
  ok('een grid erbij: opnieuw nodig (de maten veranderen)', lib.moetSecties('t1'));
  lib.bewaarSecties('t1', { ...goed, bron: 'hand' });
  const w = lib.bewaarAutoSecties('t1', goed);
  ok(`met de hand: auto mag er niet overheen (${w.reden})`, !w.bewaard && /hand/.test(w.reden) && lib.secties('t1').bron === 'hand' && !lib.moetSecties('t1'));
  let gooit = false;
  try { lib.bewaarSecties('t1', { stukken: [] }); } catch { gooit = true; }
  ok('een ongeldige kaart bewaren gooit; null wist', gooit && lib.bewaarSecties('t1', null) === null && lib.moetSecties('t1'));
  lib.sluit();
}

// ---- 4. de engine: kaart, sprong op de maat, deck, actions --------------------------------

console.log('\nengine: SectieKaart, sectieDoel, deck.naarSectie, actions en lampjes');
let NOW = 0;
const param = (v = 0) => ({ value: v, setTargetAtTime(x) { this.value = x; }, setValueAtTime(x) { this.value = x; },
  linearRampToValueAtTime(x) { this.value = x; }, setValueCurveAtTime(c) { this.value = c[c.length - 1]; },
  cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
const node = (type) => ({ type, gain: param(1), frequency: param(1000), Q: param(1), detune: param(0),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
  fftSize: 1024, smoothingTimeConstant: 0, connect(n) { return n; }, disconnect() {}, getByteTimeDomainData(b) { b.fill(128); } });
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.state = 'running'; this.baseLatency = 0; this.outputLatency = 0; this.destination = node('dest'); }
  get currentTime() { return NOW; }
  createGain() { return node('gain'); }
  createBiquadFilter() { return node('biquad'); }
  createDynamicsCompressor() { return node('comp'); }
  createAnalyser() { return node('analyser'); }
  createDelay() { const n = node('delay'); n.delayTime = param(0); return n; }
  createWaveShaper() { const n = node('shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createChannelMerger() { return node('merger'); }
  createChannelSplitter() { return node('splitter'); }
  createStereoPanner() { const n = node('pan'); n.pan = param(0); return n; }
  createOscillator() { const n = node('osc'); n.type = 'sine'; n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() { const s = node('src'); s.playbackRate = param(1); s.loop = false; s.loopStart = 0; s.loopEnd = 0;
    s.start = () => {}; s.stop = () => {}; return s; }
  createBuffer(ch, len, sr) { const d = [...Array(ch)].map(() => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => d[i] }; }
  resume() { return Promise.resolve(); }
};
const { SectieKaart, sectieDoel, groepKleur } = await import('../src/engine/secties.js');
const { Engine } = await import('../src/engine/engine.js');
const { bindEngine, invoke, read, has } = await import('../src/control/actions.js');

const KAART = { versie: 1, opGrid: true, grid: null, bron: 'auto', slot: false, stukken: [
  { van: 0, label: 'intro', groep: 'A', energie: 0.2 }, { van: 16, label: 'drop', groep: 'B', energie: 1 },
  { van: 32, label: 'break', groep: 'C', energie: 0.3 }, { van: 48, label: 'drop', groep: 'B', energie: 1 }, { van: 56, label: 'deel', groep: 'D', energie: 0.6 }] };
{
  const k = SectieKaart.van(KAART);
  ok('SectieKaart: index op elke plek, begin en einde, naam', k.aantal === 5 && k.index(0) === 0 && k.index(15.99) === 0 && k.index(16) === 1
    && k.index(1000) === 4 && k.begin(2) === 32 && k.eind(2, 60) === 48 && k.eind(4, 60) === 60 && k.begin(5) === null
    && k.naam(1) === 'drop B' && k.naam(4) === 'D');
  ok('zonder stukken: null; dezelfde groep = dezelfde kleur', SectieKaart.van({ stukken: [] }) === null && SectieKaart.van(null) === null
    && groepKleur('B') === groepKleur('B') && groepKleur('A') !== groepKleur('B'));
  const g = Beatgrid.van({ stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true });   // maat = 2 s
  ok('sectieDoel: halverwege een maat (tel 3) landt hij een halve maat vóór de sectie: op de maatstreep valt hij in',
    Math.abs(sectieDoel(g, 5, 16) - 15) < 1e-9);
  ok('… op de "1": meteen de sectie, met de fase in de tel', Math.abs(sectieDoel(g, 8, 16) - 16) < 1e-9 && Math.abs(sectieDoel(g, 8.01, 16) - 16.01) < 1e-9);
  ok('… vlak vóór de "1" ook de sectie zelf (geen hele maat aanloop)', Math.abs(sectieDoel(g, 7.99, 16) - 15.99) < 1e-9);
  ok('… een sectie op 0 heeft geen aanloop: dan in haar eerste maat, op dezelfde plek', Math.abs(sectieDoel(g, 5, 0) - 1) < 1e-9);
  ok('… zonder grid of onzeker: het begin zelf', sectieDoel(null, 5, 16) === 16 && sectieDoel(g, 5, 16, () => false) === 16);
}
const eng = new Engine();
bindEngine(eng);
const d = eng.deck('A');
d.load(eng.ctx.createBuffer(2, 48000 * 60, 48000), 'zestig');
{
  ok('na het laden geen kaart; de actions bestaan voor 40 pads en lezen null', d.sectieKaart === null && has('track.1.section.40') && has('track.1.section.40.loop')
    && has('track.1.section.next') && !has('track.1.section.41') && read('track.1.section.1') === null);
  d.setGrid({ stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true });
  d.setSectieKaart(KAART);
  const snap = eng.snapshot().decks.A;
  ok('setSectieKaart: kaart op het deck, de snapshot geeft de stukken en de sectie die je hoort', d.sectieKaart.aantal === 5 && snap.secties?.length === 5 && snap.sectie === 0);
  ok('stilstaand: naar sectie 2 = de speelkop op 16 (geen aanloop)', d.naarSectie(1).ok && Math.abs(d.position - 16) < 1e-6 && read('track.1.section.2') === 1 && read('track.1.section.1') === 0.5);
  d.seek(5); d.play();
  const r = d.naarSectie(1);
  ok('spelend op tel 3 van een maat: aanloop, de speelkop op 15', r.ok && Math.abs(d.position - 15) < 1e-6);
  ok('… tijdens de aanloop hoor je nog de maat ervóór, maar volgende/vorige rekenen al vanaf de drop', d.sectieHier === 0 && d.sectieOpDeMaat === 1);
  NOW += 1;
  ok('… een seconde later (de maatstreep) is hij precies op 16: de drop valt in op de "1"', Math.abs(d.position - 16) < 1e-6);
  NOW += 0.01;
  ok('… en dan hoor je hem ook (lampje van pad 2 fel)', d.sectieHier === 1 && read('track.1.section.2') === 1 && read('track.1.section.1') === 0.5);
  NOW += 0.49;
  invoke('track.1.section.3.loop', true);
  ok('shift op tel 2: sectie 3 als loop (32–48, 32 tellen), met drie tellen aanloop (30,5)', d.loop && d.loop.start === 32 && d.loop.end === 48 && d.loopBeats === 32
    && Math.abs(d.position - 30.5) < 1e-6 && read('track.1.section.3.loop') === 1 && read('track.1.section.2.loop') === 0.5);
  NOW += 20;
  ok('… en hij blijft erin rondgaan', d.position >= 32 && d.position < 48);
  invoke('track.1.section.3.loop', true);
  ok('nog eens: de loop eraf', !d.loop && read('track.1.section.3.loop') === 0.5);
  invoke('track.1.section.4.loop', false);
  invoke('track.1.section.4.loop', true);
  invoke('track.1.section.2', true);
  ok('een sectie-pad tijdens een loop: de loop eraf en naar die sectie', !d.loop && d.sectieKaart.index(d.position + 1.9) === 1);
  invoke('track.1.section.next', true);
  ok('volgende tijdens die aanloop: sectie 3, niet nog eens 2', d.sectieOpDeMaat === 2);
  invoke('track.1.section.prev', true);
  ok('vorige: weer sectie 2', d.sectieOpDeMaat === 1);
  ok('een pad voorbij de laatste sectie: null en geen sprong', read('track.1.section.6') === null && d.naarSectie(5).waarom === 'geen');
  d.setGrid(null);
  const p0 = d.position;
  d.naarSectie(3);
  ok(`zonder grid springt hij gewoon naar het begin (${p0.toFixed(2)} → ${d.position.toFixed(2)})`, Math.abs(d.position - 48) < 1e-6);
  d.load(eng.ctx.createBuffer(2, 48000 * 10, 48000), 'ander');
  ok('een ander nummer laden: de kaart is weg', d.sectieKaart === null && eng.snapshot().decks.A.secties === null && d.naarSectie(0).waarom === 'geensecties');
}

// ---- 5. de server -----------------------------------------------------------------------

console.log('\nserver: GET /api/library/<id>/secties?maak=1');
const db = join(map, 'test.db');
{
  const lib = new Library(db);
  lib.bewaarTrack({ id: 'edm', url: 'https://example.com/edm', titel: 'edm', uploader: 't', duur: edm48.duur, audio: 'media/edm/audio.wav',
    video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  lib.bewaarGrid('edm', { ...edm48.grid, slot: true });
  lib.sluit();
}
const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_OPNAMES: join(map, 'opnames'), VARVE_MEDIA: media, VARVE_HERANALYSE: 'uit' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (x) => { log += x; });
server.stderr.on('data', (x) => { log += x; });
const B = `http://localhost:${poort}`;
try {
  for (let i = 0; i < 80; i++) {
    const r = await fetch(`${B}/api/opnames`).catch(() => null);
    if (r?.ok) break;
    await new Promise((z) => setTimeout(z, 100));
  }
  const leeg = await (await fetch(`${B}/api/library/edm/secties`)).json();
  ok('zonder maak: nog geen secties (null)', leeg.secties === null);
  const t0 = performance.now();
  const m = await (await fetch(`${B}/api/library/edm/secties?maak=1`)).json();
  ok(`?maak=1: berekend en bewaard in ${((performance.now() - t0) / 1000).toFixed(1)} s (${m.secties ? lijst(m.secties) : m.fout})`,
    m.secties && zelfde(m.secties.stukken.map((x) => x.van), edm48.grenzen) && lijst(m.secties) === verwacht(PLAN) && /\[secties\] edm: 7 secties/.test(log));
  const nog = await (await fetch(`${B}/api/library/edm/secties?maak=1`)).json();
  ok('nog eens ?maak=1: niet opnieuw (actueel), dezelfde kaart', JSON.stringify(nog.secties) === JSON.stringify(m.secties) && log.match(/\[secties\] edm:/g).length === 1);
  const lijstje = await (await fetch(`${B}/api/library`)).json();
  ok('de lijst (/api/library) draagt geen secties: die blijft klein', lijstje.tracks?.length === 1 && !('secties' in lijstje.tracks[0]) && !('secties_json' in lijstje.tracks[0]));
  ok('onbekend nummer: 404', (await fetch(`${B}/api/library/bestaatniet/secties?maak=1`)).status === 404);
} finally {
  server.kill();
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
