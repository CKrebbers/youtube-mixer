// Toonsoort per nummer (docs/TOONSOORT.md, ROADMAP 14a): het rekenwerk op
// synthetisch materiaal met een bekend antwoord (toonsoort én stemming), door
// DEZELFDE ffmpeg-hersampler als de library (48 kHz -> 4410 Hz) en dezelfde
// worker als de server; de regels van de kaart (normaliseren, slot, hand,
// versie); en de server zelf: achtergrond en ↻, op een eigen poort met een
// tijdelijke database en mediamap. Je echte library blijft buiten schot.
// Draai met: node test/toon.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const T = await import('../server/toon.js');
const { Library, normaliseerToon, autoToonWeigert, moetToonAnalyse } = await import('../server/library.js');
const { maakToon } = await import('../server/analyze.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const map = mkdtempSync(join(tmpdir(), 'varve-toon-'));

// ---- klank -------------------------------------------------------------------
// Akkoorden (zachte zaagtand), een bas, een melodie uit de toonladder, een
// kick en een hihat, wat ruis. Vast zaad: elke keer hetzelfde materiaal.

const BR = 48000;
function rndMet(z) { let s = z >>> 0 || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
const TAB = 4096;
const zaag = new Float32Array(TAB + 1), sinus = new Float32Array(TAB + 1);
for (let i = 0; i <= TAB; i++) {
  let v = 0;
  for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * h * i / TAB) / h;
  zaag[i] = v * 0.55;
  sinus[i] = Math.sin(2 * Math.PI * i / TAB);
}
function noot(x, van, duur, f, amp, rnd, tab = zaag) {
  const a = Math.round(van * BR), n = Math.round(duur * BR);
  let fase = rnd() * TAB;
  const stap = f * TAB / BR;
  for (let i = 0; i < n && a + i < x.length; i++) {
    const t = i / BR;
    const env = Math.min(1, t / 0.02) * Math.min(1, (duur - t) / 0.15);
    const j = fase | 0, fr = fase - j;
    x[a + i] += amp * env * (tab[j] + fr * (tab[j + 1] - tab[j]));
    fase += stap; if (fase >= TAB) fase -= TAB;
  }
}
const freq = (midi, cent = 0) => 440 * 2 ** ((midi - 69 + cent / 100) / 12);
const MAJ = [0, 4, 7], MIN = [0, 3, 7];
const CADENS = { maj: [[0, MAJ], [5, MAJ], [7, MAJ], [0, MAJ]], min: [[0, MIN], [5, MIN], [7, MAJ], [0, MIN]] };
const LADDER = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 11] };

/** Een cadens (I-IV-V-I of i-iv-V-i, met leidtoon) in `tonica` (C = 0), `cent` naast A = 440. */
function stuk({ tonica, mineur = false, duur, cent = 0, zaad = 1 }) {
  const rnd = rndMet(zaad);
  const x = new Float32Array(Math.round(duur * BR));
  const R = CADENS[mineur ? 'min' : 'maj'], ladder = LADDER[mineur ? 'min' : 'maj'];
  for (let t = 0, i = 0; t < duur; t += 2, i++) {
    const [trap, soort] = R[i % R.length];
    const grond = 48 + ((tonica + trap) % 12);
    for (const iv of soort) noot(x, t, 2, freq(grond + iv, cent), 0.12, rnd);
    noot(x, t, 2, freq(grond - 12, cent), 0.2, rnd);
    for (let m = 0; m < 4; m++) {
      const n = 72 + tonica + ladder[Math.floor(rnd() * 7)];
      noot(x, t + m * 0.5, 0.5, freq(n > 84 ? n - 12 : n, cent), 0.07, rnd, sinus);
    }
  }
  for (let t = 0; t < duur - 0.3; t += 0.5) {
    const a = Math.round(t * BR);
    for (let i = 0; i < 0.2 * BR && a + i < x.length; i++) {
      const s = i / BR;
      x[a + i] += 0.5 * Math.sin(2 * Math.PI * 55 * s) * Math.exp(-s / 0.12) + 0.2 * (rnd() * 2 - 1) * Math.exp(-s / 0.015);
    }
  }
  for (let k = 0; k < x.length; k++) x[k] += 0.02 * (rnd() * 2 - 1);
  return x;
}
function ruis(duur) {
  const rnd = rndMet(11), x = new Float32Array(duur * BR);
  let b = 0;
  for (let k = 0; k < x.length; k++) { b = 0.98 * b + 0.02 * (rnd() * 2 - 1); x[k] = 3 * b + 0.05 * (rnd() * 2 - 1); }
  return x;
}
const stilte = (duur) => new Float32Array(duur * BR);
function achterElkaar(...delen) {
  const x = new Float32Array(delen.reduce((a, d) => a + d.length, 0));
  let o = 0;
  for (const d of delen) { x.set(d, o); o += d.length; }
  return x;
}
/** Mono 16-bit WAV op 48 kHz, genormaliseerd op 0,8. */
function schrijfWav(pad, x) {
  let piek = 1e-9;
  for (const v of x) piek = Math.max(piek, Math.abs(v));
  const y = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = Math.round(32767 * 0.8 * x[i] / piek);
  const kop = Buffer.alloc(44);
  kop.write('RIFF', 0); kop.writeUInt32LE(36 + y.byteLength, 4); kop.write('WAVE', 8);
  kop.write('fmt ', 12); kop.writeUInt32LE(16, 16); kop.writeUInt16LE(1, 20); kop.writeUInt16LE(1, 22);
  kop.writeUInt32LE(BR, 24); kop.writeUInt32LE(BR * 2, 28); kop.writeUInt16LE(2, 32); kop.writeUInt16LE(16, 34);
  kop.write('data', 36); kop.writeUInt32LE(y.byteLength, 40);
  mkdirSync(join(pad, '..'), { recursive: true });
  writeFileSync(pad, Buffer.concat([kop, Buffer.from(y.buffer)]));
  return pad;
}
/** Zoals analyze.js leest: mono floats op `sr` uit ffmpeg. */
function leesPcm(pad, sr = T.TOON_SR) {
  return new Promise((klaar, faal) => {
    const kind = spawn('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'error', '-i', pad,
      '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', String(sr), '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const delen = [];
    kind.stdout.on('data', (d) => delen.push(d));
    kind.on('error', faal);
    kind.on('close', (code) => {
      if (code !== 0) { faal(new Error(`ffmpeg ${code}`)); return; }
      const b = Buffer.concat(delen);
      const uit = new Float32Array(b.byteLength / 4);
      new Uint8Array(uit.buffer).set(b.subarray(0, uit.length * 4));
      klaar(uit);
    });
  });
}

const media = join(map, 'media');
const wav = (naam, x) => schrijfWav(join(media, naam, 'audio.wav'), x);
const A432 = 1200 * Math.log2(432 / 440);   // -31,8 cent
const PAD = {
  c: wav('c', stuk({ tonica: 0, duur: 40, zaad: 3 })),
  am432: wav('am432', stuk({ tonica: 9, mineur: true, duur: 40, cent: A432, zaad: 4 })),
  // Een "album": C op 440, C op +45 cent, Es op -40 cent, stilte, Fis mineur.
  album: wav('album', achterElkaar(
    stuk({ tonica: 0, duur: 80, zaad: 61 }),
    stuk({ tonica: 0, duur: 80, cent: 45, zaad: 62 }),
    stuk({ tonica: 3, duur: 80, cent: -40, zaad: 63 }),
    stilte(60),
    stuk({ tonica: 6, mineur: true, duur: 80, zaad: 64 }))),
  ruis: wav('ruis', ruis(40)),
  kort: wav('kort', stuk({ tonica: 0, duur: 2, zaad: 5 })),
};

// ---- namen ---------------------------------------------------------------------

console.log('namen');
const alle24 = Array.from({ length: 24 }, (_, k) => T.toonsoortNaam(k));
ok(`vaste spelling (${alle24.join(' ')})`, alle24.join(' ') === 'C Db D Eb E F F# G Ab A Bb B Cm Dbm Dm Ebm Em Fm F#m Gm Abm Am Bbm Bm');
ok('lezen en schrijven gaan heen en terug', alle24.every((n, k) => T.leesToonsoort(n) === k));
ok('een andere schrijfwijze van dezelfde toon: C# = Db, G#m = Abm, A#m = Bbm',
  T.leesToonsoort('C#') === 1 && T.toonsoortNaam(T.leesToonsoort('G#m')) === 'Abm' && T.toonsoortNaam(T.leesToonsoort('A#m')) === 'Bbm');
ok('onzin is null (c, H, Cmaj, "C mineur", C♯, 5)', ['c', 'H', 'Cmaj', 'C mineur', 'C♯', 5, null, ''].every((s) => T.leesToonsoort(s) === null));
ok('Camelot: C 8B, Am 8A, G 9B, Ab 4B, F#m 11A', T.camelot(0) === '8B' && T.camelot(21) === '8A' && T.camelot(7) === '9B'
  && T.camelot(8) === '4B' && T.camelot(18) === '11A');

// ---- de keten op bekend materiaal --------------------------------------------------

console.log('\nsynthetisch, via ffmpeg en de worker (zoals de ingest)');
const kaarten = {};
for (const [naam, pad] of Object.entries(PAD)) kaarten[naam] = await maakToon(pad);
const kort = (t) => (t?.ok ? t.toon.stukken.map((s) => `${s.van}s ${s.toonsoort ?? '-'} [${s.stemming} ct] z${s.zekerheid}`).join(' | ') : t?.fout);

const c = kaarten.c.toon;
ok(`C-cadens op 440: één stuk C, zeker, stemming ~0 (${kort(kaarten.c)})`,
  kaarten.c.ok && c.stukken.length === 1 && c.stukken[0].toonsoort === 'C' && c.stukken[0].zekerheid >= 0.4
  && Math.abs(c.stukken[0].stemming) < 4 && Math.abs(c.stemming) < 4);
ok('het formaat van §3: versie, stemming, stukken { van, toonsoort, stemming, zekerheid, tweede }, bron auto, niet op slot',
  c.versie === T.TOON_VERSIE && c.bron === 'auto' && c.slot === false && c.stukken[0].van === 0
  && JSON.stringify(Object.keys(c)) === '["versie","stemming","stukken","bron","slot"]'
  && JSON.stringify(Object.keys(c.stukken[0])) === '["van","toonsoort","stemming","zekerheid","tweede"]');
ok('en normaliseren verandert er niets aan', JSON.stringify(normaliseerToon(c)) === JSON.stringify(c));

const am = kaarten.am432.toon;
ok(`A mineur op A = 432 (${A432.toFixed(1)} ct): Am, stemming gemeten (${kort(kaarten.am432)})`,
  kaarten.am432.ok && am.stukken.length === 1 && am.stukken[0].toonsoort === 'Am'
  && Math.abs(am.stukken[0].stemming - A432) < 4 && am.stukken[0].zekerheid >= 0.15);

const al = kaarten.album.toon;
const verwacht = [['C', 0, 0], ['C', 45, 80], ['Eb', -40, 160], [null, null, 240], ['F#m', 0, 300]];
ok(`album: C [0] | C [+45] | Eb [-40] | stilte | F#m, grenzen binnen 12 s (${kort(kaarten.album)})`,
  kaarten.album.ok && al.stukken.length === verwacht.length && verwacht.every(([k, st, van], i) => {
    const s = al.stukken[i];
    return s.toonsoort === k && Math.abs(s.van - van) <= 12 && (st === null || Math.abs(s.stemming - st) < 5);
  }));
ok('stilte: toonsoort null met zekerheid 0', al.stukken[3]?.toonsoort === null && al.stukken[3]?.zekerheid === 0);
ok('met stemming per stuk: C op +45 heet C, niet Db (zonder: één stemming voor het geheel, synth.txt §6)',
  al.stukken[1]?.toonsoort === 'C' && al.stukken[1].stemming > 35);

// De tweede kandidaat (§5, T4: "best passend: E, of A"): bij elk stuk met een
// toonsoort, in de vaste spelling, met een ANDER Camelot-getal (de relatieve
// deelt zijn plek op de wijzer en telt niet als twijfel). Stilte heeft er geen.
const metToon = Object.values(kaarten).filter((x) => x.ok).flatMap((x) => x.toon.stukken).filter((s) => s.toonsoort !== null);
const cg = (n) => T.camelotGetal(T.leesToonsoort(n));
ok(`tweede kandidaat bij elk stuk met een toonsoort (${metToon.length}), vaste spelling, ander Camelot-getal`
  + ` (${metToon.map((s) => `${s.toonsoort}/${s.tweede}`).join(' ')})`,
  metToon.length === 7 && metToon.every((s) => typeof s.tweede === 'string' && T.toonsoortNaam(T.leesToonsoort(s.tweede)) === s.tweede
    && cg(s.tweede) !== cg(s.toonsoort)));
ok('stilte: geen tweede kandidaat', !('tweede' in al.stukken[3]));

const rz = kaarten.ruis.toon;
ok(`ruis: geen duidelijke toonsoort, zekerheid < 0,15 (${kort(kaarten.ruis)})`,
  kaarten.ruis.ok && rz.stukken.every((s) => s.zekerheid < 0.15));
ok(`2 s audio: te kort, een nette fout (${kaarten.kort.fout})`, kaarten.kort.ok === false && /kort/.test(kaarten.kort.fout));
ok('een onleesbaar bestand: een nette fout, geen crash', (await maakToon(join(map, 'bestaat-niet.wav'))).ok === false);

console.log('\nhetzelfde als het meetinstrument');
{
  // De drempels en meting.txt komen uit tools/toonsoort/toon.mjs. Dezelfde
  // pcm door beide: de kaart moet getal voor getal gelijk zijn.
  const I = await import('../tools/toonsoort/toon.mjs');
  const pcm = await leesPcm(PAD.album);
  const spI = I.spectrum(pcm, T.TOON_SR, { fmin: 27.5, fmax: 2000 });
  const okI = I.nietStil(spI.energie);
  const instrument = I.kaartPerStuk(spI, { fmin: 55, fmax: 2000 }, { hpss: true, vloer: false, compressie: 'log' },
    okI, 'temperley05', { wissel: 1.2, venster: 24 });
  const sp = T.spectrum(pcm, T.TOON_SR);
  const server = T.kaartPerStuk(sp, okI);
  // Alleen `tweede` bestaat niet in het instrument; de rest (ook de keuze van de
  // toonsoort, `k`) moet bit voor bit gelijk zijn.
  const zonderTweede = server.map(({ tweede, ...rest }) => rest);
  ok(`kaartPerStuk: ${server.length} stukken, gelijk tot op de laatste bit (zonder het veld tweede)`,
    JSON.stringify(zonderTweede) === JSON.stringify(instrument) && server.every((s) => 'tweede' in s));
  // En de tweede is kAnder uit dezelfde kies() als het instrument: de beste met een ander Camelot-getal.
  const kAnder = instrument.map((s) => {
    if (s.stil) return null;
    const a = Math.round(s.van * sp.frameRate), b = Math.round(s.tot * sp.frameRate);
    const Cs = I.chroma(I.halveTonen(spI, s.stemming, { fmin: 55, fmax: 2000, van: a, tot: b }), { hpss: true, vloer: false, compressie: 'log' }).C;
    return I.toonsoortVan(Cs, 0, b - a, okI.subarray(a, b), 'temperley05', { proeven: 32 }).kAnder;
  });
  ok(`tweede = kAnder van het instrument op dezelfde frames (${server.map((s) => T.toonsoortNaam(s.tweede) ?? '-').join(' ')})`,
    JSON.stringify(server.map((s) => s.tweede)) === JSON.stringify(kAnder));
  ok('de stemming van het geheel ook', sp.stemming === spI.stemming);
  ok('en de worker levert precies toonKaart van dezelfde pcm', JSON.stringify(T.toonKaart(pcm)) === JSON.stringify(al));
}

// ---- normaliseren ----------------------------------------------------------------

console.log('\nnormaliseren');
const hand = { versie: 1, stemming: -12.5, stukken: [{ van: 200, toonsoort: 'G#m', stemming: -30 }, { van: 0, toonsoort: 'Bb', stemming: 8, zekerheid: 1.7 }],
  bron: 'hand', slot: true };
const n = normaliseerToon(hand);
ok('gesorteerd op van, vaste spelling, zekerheid geklemd, slot en bron blijven',
  n.stukken[0].van === 0 && n.stukken[0].toonsoort === 'Bb' && n.stukken[0].zekerheid === 1
  && n.stukken[1].toonsoort === 'Abm' && n.stukken[1].zekerheid === undefined && n.slot === true && n.bron === 'hand' && n.versie === 1);
ok('toonsoort null mag (met de hand "geen toonsoort")', normaliseerToon({ stukken: [{ van: 0, toonsoort: null, stemming: 0 }] })?.stukken[0].toonsoort === null);
const kaal = normaliseerToon({ stukken: [{ van: 0, toonsoort: 'D', stemming: 12 }, { van: 30, toonsoort: 'A' }] });
ok('zonder bron: hand; zonder slot: false; zonder versie: weggelaten', kaal.bron === 'hand' && kaal.slot === false && !('versie' in kaal));
ok('zonder stemming bovenaan: die van het eerste stuk; een stuk zonder: die van het geheel',
  kaal.stemming === 12 && kaal.stukken[1].stemming === 12);
const ongeldig = {
  'geen object': 'C', 'een lijst': [], 'zonder stukken': { stemming: 0 }, 'lege stukken': { stukken: [] },
  'onbekende toonsoort': { stukken: [{ van: 0, toonsoort: 'H' }] }, 'toonsoort ontbreekt': { stukken: [{ van: 0 }] },
  'negatieve van': { stukken: [{ van: -1, toonsoort: 'C' }] }, 'van geen getal': { stukken: [{ van: '0', toonsoort: 'C' }] },
  'stemming buiten -50..50': { stukken: [{ van: 0, toonsoort: 'C', stemming: 52 }] },
  'stemming bovenaan buiten bereik': { stemming: -60, stukken: [{ van: 0, toonsoort: 'C' }] },
  'twee stukken op dezelfde plek': { stukken: [{ van: 10, toonsoort: 'C' }, { van: 10, toonsoort: 'G' }] },
  'zekerheid geen getal': { stukken: [{ van: 0, toonsoort: 'C', zekerheid: 'hoog' }] },
  'onleesbare tweede': { stukken: [{ van: 0, toonsoort: 'C', zekerheid: 0.2, tweede: 'H' }] },
  'tweede geen tekst': { stukken: [{ van: 0, toonsoort: 'C', zekerheid: 0.2, tweede: 7 }] },
  'te veel stukken': { stukken: Array.from({ length: 4097 }, (_, i) => ({ van: i, toonsoort: 'C' })) },
};
const doorgelaten = Object.entries(ongeldig).filter(([, t]) => normaliseerToon(t) !== null).map(([k]) => k);
ok(`onbruikbaar is null (${Object.keys(ongeldig).length} gevallen${doorgelaten.length ? `; DOORGELATEN: ${doorgelaten.join(', ')}` : ''})`, !doorgelaten.length);
ok('rand: -50 en +50 cent mogen', normaliseerToon({ stemming: 50, stukken: [{ van: 0, toonsoort: 'C', stemming: -50 }] }) !== null);
const tw = normaliseerToon({ bron: 'hand', stukken: [
  { van: 0, toonsoort: 'C', stemming: 0, zekerheid: 0.3, tweede: 'G' },
  { van: 30, toonsoort: 'Bbm', stemming: 0, zekerheid: 0.1, tweede: 'C#' },
  { van: 60, toonsoort: 'D', stemming: 0, tweede: 'A' },
  { van: 90, toonsoort: null, stemming: 0, zekerheid: 0, tweede: 'E' },
  { van: 120, toonsoort: 'Db', stemming: 0, zekerheid: 0.2, tweede: 'C#' },
] });
ok('tweede: blijft naast een zekerheid (ook in een kaart met de hand), in de vaste spelling, achteraan',
  tw.stukken[0].tweede === 'G' && tw.stukken[1].tweede === 'Db'
  && JSON.stringify(Object.keys(tw.stukken[0])) === '["van","toonsoort","stemming","zekerheid","tweede"]');
ok('tweede valt weg: met de hand gezet (geen zekerheid), zonder toonsoort, gelijk aan de toonsoort',
  !('tweede' in tw.stukken[2]) && !('tweede' in tw.stukken[3]) && !('tweede' in tw.stukken[4]));

// ---- de regels: slot, hand, versie -----------------------------------------------

console.log('\nregels (zoals het grid, plus de versie)');
const auto = (versie) => normaliseerToon({ versie, stemming: 0, stukken: [{ van: 0, toonsoort: 'C', stemming: 0, zekerheid: 0.5 }], bron: 'auto' });
const handK = normaliseerToon({ stukken: [{ van: 0, toonsoort: 'G', stemming: 0 }], bron: 'hand' });
const slotK = normaliseerToon({ stukken: [{ van: 0, toonsoort: 'D', stemming: 0 }], bron: 'hand', slot: true });
const slotAuto = normaliseerToon({ ...auto(1), slot: true });
ok('moet: leeg en een automatische kaart zonder versie', moetToonAnalyse(null) && moetToonAnalyse(auto(undefined)));
ok('moet niet: auto van deze versie, hand, slot', !moetToonAnalyse(auto(T.TOON_VERSIE)) && !moetToonAnalyse(handK) && !moetToonAnalyse(slotK) && !moetToonAnalyse(slotAuto));
const bump = T.TOON_VERSIE + 1;
ok('versie-bump: alleen auto opnieuw, hand en slot niet', moetToonAnalyse(auto(T.TOON_VERSIE), bump)
  && !moetToonAnalyse(handK, bump) && !moetToonAnalyse(slotK, bump) && !moetToonAnalyse(slotAuto, bump));
ok('SLOT: nooit, ook niet met overHand of door de achtergrond', /slot/.test(autoToonWeigert(slotK))
  && /slot/.test(autoToonWeigert(slotK, { overHand: true })) && autoToonWeigert(slotK, { alleenOud: true }) !== null);
ok('alleen met overSlot (tweede klik op ↻)', autoToonWeigert(slotK, { overHand: true, overSlot: true }) === null);
ok('hand: niet zonder overHand, wel met (↻)', /hand/.test(autoToonWeigert(handK)) && autoToonWeigert(handK, { overHand: true }) === null);
ok('de achtergrond: niet over een actuele auto-kaart, wel over een oude', autoToonWeigert(auto(T.TOON_VERSIE), { alleenOud: true }) !== null
  && autoToonWeigert(auto(undefined), { alleenOud: true }) === null && autoToonWeigert(auto(T.TOON_VERSIE), { alleenOud: true, versie: bump }) === null);
ok('opnieuw binnenhalen (geen opties): auto over auto mag', autoToonWeigert(auto(T.TOON_VERSIE)) === null);

// ---- de server: achtergrond en ↻ ----------------------------------------------------

console.log('\nserver: achtergrond (versie-bump) en ↻');
const db = join(map, 'test.db');
const lib = new Library(db);
const nummers = { tLeeg: 'c', tOud: 'am432', tHandOud: 'c', tSlot: 'c', tNu: 'c' };
for (const [id, audio] of Object.entries(nummers)) {
  lib.bewaarTrack({ id, url: `https://example.com/${id}`, titel: id, uploader: 't', duur: 40,
    audio: `media/${audio}/audio.wav`, video: null, thumbnail: null, loudness: {}, doelLoudness: -14, ytdlp: 'x' });
  // Een grid op slot: dan doet de achtergrond hier alleen de toonsoort.
  lib.bewaarGrid(id, { stukken: [{ van: 0, bpm: 120, anker: 0 }], slot: true });
}
const OUD = { stemming: 0, stukken: [{ van: 0, toonsoort: 'F#', stemming: 0, zekerheid: 0.9 }], bron: 'auto' };   // zonder versie = oud
lib.bewaarToon('tOud', OUD);
lib.bewaarToon('tHandOud', { ...OUD, bron: 'hand' });
lib.bewaarToon('tSlot', { ...OUD, bron: 'hand', slot: true });
lib.bewaarToon('tNu', { ...OUD, versie: T.TOON_VERSIE });
const voor = Object.fromEntries(Object.keys(nummers).map((id) => [id, JSON.stringify(lib.track(id).toon)]));
ok(`te analyseren: leeg en oud-auto (${lib.teToonAnalyseren().join(',')})`, lib.teToonAnalyseren().join(',') === 'tLeeg,tOud');
lib.sluit();

const poort = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(poort), VARVE_DB: db, VARVE_OPNAMES: join(map, 'opnames'), VARVE_TESTSERVER: '1', VARVE_MEDIA: media,
    VARVE_HERANALYSE: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
const B = `http://localhost:${poort}`;
const toonVan = async (id) => (await (await fetch(`${B}/api/library/${id}/toon`)).json()).toon;
try {
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${B}/api/opnames`).catch(() => null);
    if (r?.ok) break;
    await new Promise((z) => setTimeout(z, 100));
  }
  const t0 = performance.now();
  while (!log.includes('achtergrondanalyse klaar') && performance.now() - t0 < 120000) await new Promise((z) => setTimeout(z, 100));
  ok(`achtergrond klaar in ${((performance.now() - t0) / 1000).toFixed(1)} s, de log zegt wat er gebeurt`,
    log.includes('achtergrondanalyse klaar') && /\[toon\] 2 nummers zonder \(actuele\) toonsoort/.test(log) && /\[toon\] tLeeg: 1 stuk: C 8B/.test(log));
  ok('geen grid-analyse (alle grids op slot)', !/\[grid\] \d+ nummer/.test(log));
  const leeg = await toonVan('tLeeg'), oud = await toonVan('tOud');
  ok(`leeg: een automatische kaart (${leeg?.stukken.map((s) => s.toonsoort).join(',')}, versie ${leeg?.versie})`,
    leeg?.bron === 'auto' && leeg.versie === T.TOON_VERSIE && leeg.stukken[0].toonsoort === 'C' && leeg.stukken[0].tweede === c.stukken[0].tweede);
  ok(`auto zonder versie (oud): opnieuw, nu Am (${oud?.stukken.map((s) => s.toonsoort).join(',')})`,
    oud?.bron === 'auto' && oud.versie === T.TOON_VERSIE && oud.stukken[0].toonsoort === 'Am');
  const onaangeroerd = [];
  for (const id of ['tHandOud', 'tSlot', 'tNu']) if (JSON.stringify(await toonVan(id)) === voor[id]) onaangeroerd.push(id);
  ok(`met de hand (ook zonder versie), op slot en actueel auto: niet aangeraakt (${onaangeroerd.join(', ')})`, onaangeroerd.length === 3);
  const lijst = (await (await fetch(`${B}/api/library`)).json()).tracks;
  ok('/api/library geeft per nummer "toon" mee', lijst.length === 5 && lijst.every((t) => 'toon' in t) && lijst.find((t) => t.id === 'tLeeg').toon.stukken[0].toonsoort === 'C');
  // Het paneel vraagt PAGINA'S (library-spoor): daar moet de kaart net zo in staan.
  const pagina = await (await fetch(`${B}/api/library?sorteer=titel&richting=op&van=1&aantal=2`)).json();
  ok(`een pagina van /api/library draagt "toon" ook (${pagina.tracks?.map((t) => t.id).join(',')} van ${pagina.totaal})`,
    pagina.totaal === 5 && pagina.van === 1 && pagina.tracks.length === 2 && pagina.tracks.every((t) => 'toon' in t)
    && pagina.tracks.every((t) => JSON.stringify(t.toon) === JSON.stringify(lijst.find((x) => x.id === t.id).toon)));

  const her = (id, body = {}) => fetch(`${B}/api/library/${id}/toon/analyseer`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const rS = await (await her('tSlot')).json();
  ok(`↻ over SLOT: voorstel terug (${rS.voorstel?.stukken[0].toonsoort}), niet bewaard ("${rS.reden}")`,
    rS.bewaard === false && /slot/.test(rS.reden) && rS.voorstel.stukken[0].toonsoort === 'C'
    && JSON.stringify(rS.toon) === voor.tSlot && JSON.stringify(await toonVan('tSlot')) === voor.tSlot);
  const rS2 = await (await her('tSlot', { forceer: true })).json();
  ok('met forceer (tweede klik): bewaard, auto, niet meer op slot', rS2.bewaard === true && rS2.toon.bron === 'auto' && rS2.toon.slot === false
    && rS2.toon.stukken[0].toonsoort === 'C' && (await toonVan('tSlot')).bron === 'auto');
  const rH = await (await her('tHandOud')).json();
  ok('↻ over een kaart met de hand: bewaard (daar vroeg je om)', rH.bewaard === true && rH.toon.bron === 'auto' && rH.toon.stukken[0].toonsoort === 'C');
  ok('↻ op een onbekend nummer: 404', (await her('bestaatniet')).status === 404);
  ok('↻ als formulier: 415', (await fetch(`${B}/api/library/tNu/toon/analyseer`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status === 415);
  const [p1, p2] = await Promise.all([her('tNu'), her('tNu')].map((p) => p.then((r) => r.json())));
  ok('twee keer ↻ tegelijk: twee antwoorden, dezelfde kaart', p1.bewaard && p2.bewaard && JSON.stringify(p1.voorstel) === JSON.stringify(p2.voorstel));
} finally {
  server.kill();
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
