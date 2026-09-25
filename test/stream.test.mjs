// Streamen: de rekenkern, het WAV-formaat en de StreamBron, zonder browser.
// Draai met: node test/stream.test.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const K = await import('../src/engine/stream-kern.js');
const { PAGINA, positieOp, ctxTijdVan, leesWavKop, controleerWav, plan, reeksen, renderBlok } = K;

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const dichtbij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- het segment ------------------------------------------------------------

console.log('segment');
{
  const seg = { T: 10, P: 30, R: 1.05, loop: null, speelt: true };
  ok('positie loopt met de rate', dichtbij(positieOp(seg, 12), 30 + 2 * 1.05));
  ok('stil = P', positieOp({ ...seg, speelt: false }, 99) === 30);
  ok('ctxTijdVan is het omgekeerde', dichtbij(positieOp(seg, ctxTijdVan(seg, 41)), 41));
  const lus = { T: 0, P: 4, R: 1, loop: { start: 4, end: 6 }, speelt: true };
  ok('loop vouwt terug', dichtbij(positieOp(lus, 2.5), 4.5) && dichtbij(positieOp(lus, 5), 5));
  ok('een bericht dat te laat komt rekent door vanaf T', dichtbij(positieOp(seg, 10.003), 30 + 0.003 * 1.05));
}

// ---- WAV: tegen ffmpeg zelf ---------------------------------------------------

console.log('\nWAV-kop, tegen ffmpeg');
const map = mkdtempSync(join(tmpdir(), 'varve-stream-'));
try {
  const wav = join(map, 'toon.wav');
  // Metadata erbij: dan zet ffmpeg een LIST-chunk vóór de data. Wie op 44
  // bytes rekent, leest dan de verkeerde samples.
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=331:sample_rate=48000:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=517:sample_rate=48000:duration=3',
    '-filter_complex', 'join=inputs=2:channel_layout=stereo',
    '-metadata', 'title=varve streamtest', '-c:a', 'pcm_s16le', wav]);
  ok('ffmpeg maakt een testbestand', r.status === 0);
  const bestand = readFileSync(wav);
  const buf = bestand.buffer.slice(bestand.byteOffset, bestand.byteOffset + bestand.byteLength);
  const kop = leesWavKop(buf.slice(0, 65536));
  ok('kop gelezen: 48 kHz, stereo, 16 bit', kop.sampleRate === 48000 && kop.kanalen === 2 && kop.bits === 16);
  ok('data begint niet op 44 (er staat metadata voor)', kop.dataStart > 44);
  ok('dit formaat wordt geaccepteerd', controleerWav(kop) === null);
  ok('24-bit wordt geweigerd met een reden', /24-bit/.test(controleerWav({ ...kop, bits: 24 })));

  const raw = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', wav, '-f', 's16le', '-c:a', 'pcm_s16le', '-'],
    { maxBuffer: 1 << 26 }).stdout;
  const vanFfmpeg = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const vanKop = new Int16Array(buf.slice(kop.dataStart, kop.dataStart + kop.dataLengte));
  let gelijk = vanFfmpeg.length === vanKop.length;
  for (let i = 0; gelijk && i < vanKop.length; i++) if (vanKop[i] !== vanFfmpeg[i]) gelijk = false;
  ok('samples vanaf dataStart zijn bit voor bit die van ffmpeg', gelijk);
  ok('duur klopt', dichtbij(kop.dataLengte / 4 / 48000, 3, 1e-3));

  // ---- renderen uit pagina's ------------------------------------------------

  console.log('\nrenderen');
  const paginas = new Map();
  for (let p = 0; p * PAGINA * 2 < vanKop.length; p++) {
    paginas.set(p, vanKop.slice(p * PAGINA * 2, (p + 1) * PAGINA * 2));
  }
  const blok = (seg, t0, frames = 128) => {
    const uit = [new Float32Array(frames), new Float32Array(frames)];
    const r = renderBlok({ seg, paginas, uit, frames, t0, ctxRate: 48000, trackRate: 48000, duur: 3 });
    return { uit, r };
  };
  // Over een paginagrens heen, op rate 1: exact de samples.
  const n0 = PAGINA - 40;
  const { uit } = blok({ T: 0, P: n0 / 48000, R: 1, loop: null, speelt: true }, 0);
  let exact = true;
  for (let i = 0; i < 128; i++) {
    if (uit[0][i] !== vanKop[(n0 + i) * 2] / 32768 || uit[1][i] !== vanKop[(n0 + i) * 2 + 1] / 32768) exact = false;
  }
  ok('rate 1: exact de samples, ook over een paginagrens', exact);

  // Met een ctx-klok die niet op nul begint: dezelfde formule, dezelfde samples.
  const t = 1234.5;
  const b2 = blok({ T: t, P: 1, R: 1, loop: null, speelt: true }, t + 256 / 48000).uit;
  ok('audioklok ver van nul: nog steeds exact', b2[0][0] === vanKop[(48000 + 256) * 2] / 32768);

  // Halve snelheid op een sinus: cubisch moet heel dicht bij de echte sinus zitten.
  const traag = blok({ T: 0, P: 0.5, R: 0.5, loop: null, speelt: true }, 0, 512).uit[0];
  let maxFout = 0;
  for (let i = 0; i < 512; i++) {
    const tt = 0.5 + (i / 48000) * 0.5;
    // Referentie: de wiskundige sinus op ffmpeg's amplitude (1/8). De
    // afrondfout van 16 bit is 1/65536; alles daarboven is interpolatiefout.
    const echt = Math.sin(2 * Math.PI * 331 * tt) * 0.125;
    maxFout = Math.max(maxFout, Math.abs(traag[i] - echt));
  }
  ok(`halve snelheid: cubisch volgt de sinus (max fout ${maxFout.toExponential(1)})`, maxFout < 2e-3);

  const zonder = new Map(paginas); zonder.delete(1);
  const gat = new Float32Array(128), gat2 = new Float32Array(128);
  renderBlok({ seg: { T: 0, P: (PAGINA + 10) / 48000, R: 1, loop: null, speelt: true },
    paginas: zonder, uit: [gat, gat2], frames: 128, t0: 0, ctxRate: 48000, trackRate: 48000, duur: 3 });
  ok('ontbrekende pagina geeft stilte, geen oude herhaling', gat.every((v) => v === 0));

  const eind = blok({ T: 0, P: 3 - 64 / 48000, R: 1, loop: null, speelt: true }, 0);
  ok('trackeinde wordt gemeld, daarna stilte', eind.r === 'einde' && eind.uit[0].slice(70).every((v) => v === 0));

  const lusSeg = { T: 0, P: 1, R: 1, loop: { start: 1, end: 1 + 100 / 48000 }, speelt: true };
  const lusUit = blok(lusSeg, 0, 256).uit[0];
  ok('loop herhaalt precies', lusUit[5] === lusUit[105] && lusUit[5] === vanKop[(48000 + 5) * 2] / 32768);
  ok('stilstaan geeft stilte', blok({ ...lusSeg, speelt: false }, 0).uit[0].every((v) => v === 0));

  // De tik op de naad. Een loop die niet op een hele golf eindigt heeft een
  // sprong van einde naar begin. Met de naad-fade mag geen stap tussen twee
  // samples groter zijn dan wat de toon zelf maximaal doet.
  const lusStart = 1.0, lusEind = 1.0 + 0.3017;
  const ruw = Math.abs(vanKop[Math.round(lusEind * 48000 - 1) * 2] - vanKop[Math.round(lusStart * 48000) * 2]) / 32768;
  const toonStap = 0.125 * 2 * Math.PI * 331 / 48000;
  const lang = blok({ T: 0, P: lusStart, R: 1, loop: { start: lusStart, end: lusEind }, speelt: true }, 0, 48000).uit[0];
  let grootste = 0;
  for (let i = 1; i < lang.length; i++) grootste = Math.max(grootste, Math.abs(lang[i] - lang[i - 1]));
  ok(`zonder naad zou de sprong ${(ruw / toonStap).toFixed(0)}x een normale stap zijn`, ruw > 5 * toonStap);
  // Tijdens een equal-power fade tellen twee niet-gelijke stukken op tot
  // hooguit √2 (1,41x); daarboven is het een sprong, en een sprong is een tik.
  ok(`met naad: grootste stap ${(grootste / toonStap).toFixed(2)}x een normale stap (geen tik)`, grootste < 1.5 * toonStap);
  const midden = blok({ T: 0, P: lusStart, R: 1, loop: { start: lusStart, end: lusEind }, speelt: true }, 0, 4800).uit[0];
  ok('buiten de naad nog steeds exact de samples', midden[100] === vanKop[(48000 + 100) * 2] / 32768);

  // Een loop die op (bijna) 0 s begint heeft niets vóór zijn begin om naar
  // over te vloeien. De naad mengde daar naar stilte: een dip vlak voor elke
  // herhaling. Nu: geen naad (op 0) of een naad zo lang als er ruimte is.
  const nulEind = 0.3017, nulN = Math.round(nulEind * 48000);
  const vanNul = blok({ T: 0, P: 0, R: 1, loop: { start: 0, end: nulEind }, speelt: true }, 0, nulN).uit[0];
  let dip = 0;
  for (let i = nulN - 240; i < nulN; i++) dip = Math.max(dip, Math.abs(vanNul[i] - vanKop[i * 2] / 32768));
  ok(`loop vanaf 0 s: de laatste 5 ms zijn de gewone samples (afwijking ${dip.toExponential(1)})`, dip < 1e-9);
  const bijna = 0.002;                    // 96 frames ruimte vóór het begin
  const eindN = Math.round((bijna + nulEind) * 48000);
  const vanBijna = blok({ T: 0, P: bijna, R: 1, loop: { start: bijna, end: bijna + nulEind }, speelt: true }, 0, eindN - 96).uit[0];
  const iBuiten = eindN - 96 - 150 - 1;    // 150 frames vóór het einde: buiten een naad van 96
  ok('loop vanaf 2 ms: de naad is geklemd op wat er vóór het begin staat',
    Math.abs(vanBijna[iBuiten] - vanKop[(96 + iBuiten) * 2] / 32768) < 1e-9);

  // Seek midden in de toon: zonder overgang een sprong in de golfvorm (tik).
  const maxStap = (x) => { let m = 0; for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const oudSeg = { T: 0, P: 1.0, R: 1, loop: null, speelt: true };
  const nieuwSeg = { T: 0.01, P: 2.00731, R: 1, loop: null, speelt: true };
  const blokSeek = (metOvergang) => {
    const uit = [new Float32Array(1024), new Float32Array(1024)];
    renderBlok({ seg: nieuwSeg, paginas, uit, frames: 1024, t0: 0.01, ctxRate: 48000, trackRate: 48000, duur: 3,
      ...(metOvergang ? { vorig: oudSeg, wisselT: 0.01 } : {}) });
    return uit[0];
  };
  const toonStap2 = 0.125 * 2 * Math.PI * 331 / 48000;
  const oudBlok = new Float32Array(1025);
  renderBlok({ seg: oudSeg, paginas, uit: [oudBlok, new Float32Array(1025)], frames: 1025, t0: 0.01 - 1 / 48000, ctxRate: 48000, trackRate: 48000, duur: 3 });
  const seekZonder = Float32Array.of(oudBlok[0], ...blokSeek(false));
  const seekMet = Float32Array.of(oudBlok[0], ...blokSeek(true));
  ok(`seek zonder overgang: sprong ${(maxStap(seekZonder) / toonStap2).toFixed(0)}x een normale stap`, maxStap(seekZonder) > 5 * toonStap2);
  ok(`seek met overgang: grootste stap ${(maxStap(seekMet) / toonStap2).toFixed(2)}x (geen tik)`, maxStap(seekMet) < 1.5 * toonStap2);

  // Gat: pagina 1 ontbreekt; aanlopen tegen het gat moet uitvloeien, niet afkappen.
  const metGat = new Map(paginas); metGat.delete(1);
  const staat = { env: 1 };
  const aanloop = [new Float32Array(600), new Float32Array(600)];
  renderBlok({ seg: { T: 0, P: (PAGINA - 400) / 48000, R: 1, loop: null, speelt: true }, paginas: metGat,
    uit: aanloop, frames: 600, t0: 0, ctxRate: 48000, trackRate: 48000, duur: 3, staat });
  ok(`tegen een gat aan: grootste stap ${(maxStap(aanloop[0]) / toonStap2).toFixed(2)}x (uitgevloeid, geen tik)`, maxStap(aanloop[0]) < 1.5 * toonStap2);
  ok('in het gat: stil', aanloop[0].slice(450).every((v) => v === 0));
} finally {
  rmSync(map, { recursive: true, force: true });
}

// ---- welke pagina's ----------------------------------------------------------

console.log('\npagina-plan');
{
  const sr = 48000, s = PAGINA / sr;                  // seconden per pagina
  const p = plan({ positie: 100, duur: 3600, sr, vastpunten: [10, null, 2000], loop: null });
  ok('wat nu klinkt staat vooraan', p[0] === Math.floor(100 / s));
  ok('vooruit ~20 s', p.includes(Math.floor(119 / s)) && !p.includes(Math.floor(125 / s)));
  ok('achteruit ~5 s', p.includes(Math.floor(96 / s)) && !p.includes(Math.floor(90 / s)));
  ok('hotcues vastgepind', p.includes(Math.floor(10 / s)) && p.includes(Math.floor(2000 / s)));
  ok('null-hotcue telt niet', !p.includes(0));
  ok('geen dubbelen', new Set(p).size === p.length);
  const n = p.length;
  ok(`klein: ${n} pagina's = ${(n * PAGINA * 4 / 1e6).toFixed(1)} MB voor een uur`, n * PAGINA * 4 < 12e6);
  const snel = plan({ positie: 100, rate: 2, duur: 3600, sr });
  ok('dubbele snelheid kijkt verder vooruit', snel.includes(Math.floor(139 / s)));
  const lus = plan({ positie: 50, duur: 3600, sr, loop: { start: 50, end: 58 } });
  ok('loop zit er helemaal in', lus.includes(Math.floor(57.9 / s)));
  const eind = plan({ positie: 3599, duur: 3600, sr });
  ok('niet voorbij het einde', Math.max(...eind) === Math.ceil(3600 * sr / PAGINA) - 1);
  ok('reeksen voegen samen', JSON.stringify(reeksen([5, 3, 4, 9, 10, 20])) ===
    JSON.stringify([{ van: 3, tot: 5 }, { van: 9, tot: 10 }, { van: 20, tot: 20 }]));
  ok('reeksen hooguit max lang', reeksen([1, 2, 3, 4, 5], 2).length === 3);
}

// ---- StreamBron met een nagemaakte browser ------------------------------------

console.log('\nStreamBron');
{
  // Een WAV van een uur, zonder een uur aan bytes te maken: de nep-server
  // bouwt elk gevraagd stuk on the fly. Sample n heeft waarde n % 30000.
  const DUUR = 3600, SR = 48000, FRAMES = DUUR * SR;
  const kopBytes = new ArrayBuffer(44);
  const v = new DataView(kopBytes);
  const zet = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  zet(0, 'RIFF'); v.setUint32(4, 36 + FRAMES * 4, true); zet(8, 'WAVE');
  zet(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  zet(36, 'data'); v.setUint32(40, FRAMES * 4, true);
  const verzoeken = [];
  const haal = async (url, init) => {
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range).map(Number);
    verzoeken.push([a, b]);
    const uit = new Uint8Array(b - a + 1);
    for (let byte = a; byte <= b; byte++) {
      if (byte < 44) { uit[byte - a] = new Uint8Array(kopBytes)[byte]; continue; }
      const s = Math.floor((byte - 44) / 2), frame = Math.floor(s / 2);
      const waarde = frame % 30000;
      uit[byte - a] = (byte - 44) % 2 === 0 ? waarde & 0xff : (waarde >> 8) & 0xff;
    }
    return { ok: true, status: 206, arrayBuffer: async () => uit.buffer };
  };

  const berichten = [];
  globalThis.AudioWorkletNode = class {
    constructor() { this.port = { postMessage: (m) => berichten.push(m), onmessage: null }; }
    connect() {} disconnect() {}
  };
  const ctx = { currentTime: 0, audioWorklet: { addModule: async () => {} } };
  const { StreamBron } = await import('../src/engine/bron.js');
  const bron = new StreamBron(ctx, {}, { haal, interval: 1e9 });
  bron.vastpunten = () => [1800];
  await bron.laad({ url: '/media/x/audio.wav' });

  ok('duur uit de kop', dichtbij(bron.duur, DUUR));
  ok('buffer is waar, maar geen AudioBuffer', !!bron.buffer && bron.buffer.stream === true);
  const paginasIn = () => new Set(berichten.filter((m) => m.type === 'pagina').map((m) => m.i));
  ok('begin en hotcue zijn er vóór play', paginasIn().has(0) && paginasIn().has(Math.floor(1800 * SR / PAGINA)));
  const eerste = berichten.find((m) => m.type === 'pagina' && m.i === 1);
  ok('pagina-inhoud klopt (frame 65536+7)', eerste && eerste.data[7 * 2] === (PAGINA + 7) % 30000);
  ok(`geheugen na laden: ${(bron.geheugen / 1e6).toFixed(1)} MB (een uur uitgepakt: 1382 MB)`, bron.geheugen < 12e6);

  bron.start(0);
  ctx.currentTime = 2;
  ok('positie uit de audioklok', dichtbij(bron.positie, 2));
  bron.setRate(1.1);
  ctx.currentTime = 3;
  ok('pitch halverwege: positie loopt door zonder sprong', dichtbij(bron.positie, 2 + 1.1));
  const seg = berichten.filter((m) => m.type === 'segment').pop().seg;
  ok('worklet krijgt hetzelfde segment', dichtbij(positieOp(seg, 3), bron.positie));

  berichten.length = 0;
  bron.start(3000);
  await bron.bijvullen();
  await bron.bijvullen();
  ok('na een sprong: nieuwe plek opgehaald', paginasIn().has(Math.floor(3000 * SR / PAGINA)));
  ok('en het oude gebied opgeruimd', berichten.some((m) => m.type === 'weg' && m.i === 5)
    && !bron.geladen.has(5));
  ok('hotcue blijft staan na de sprong',
    bron.geladen.has(Math.floor(1800 * SR / PAGINA)));
  ok(`geheugen blijft klein: ${(bron.geheugen / 1e6).toFixed(1)} MB`, bron.geheugen < 16e6);

  bron.pauzeer();
  const stil = bron.positie;
  ctx.currentTime = 10;
  ok('pauze houdt de positie vast', bron.positie === stil);
  bron.plaats(42);
  ok('plaats zet de positie', bron.positie === 42);

  let eindeGezien = 0;
  bron.onEinde = () => eindeGezien++;
  bron.start(10);
  bron.node.port.onmessage({ data: { type: 'einde' } });
  ok('einde van de worklet: stil, positie op het einde, één melding',
    !bron.speelt && bron.positie === DUUR && eindeGezien === 1);
  bron.node.port.onmessage({ data: { type: 'einde' } });
  ok('een tweede einde telt niet', eindeGezien === 1);

  bron.vernietig();
  ok('vernietig ruimt op', !bron.buffer && bron.geheugen === 0 && bron.node === null);

  // Race: twee keer snel laden. De eerste is traag; de tweede moet winnen en
  // de eerste mag geen pagina's meer in de tweede schuiven.
  const traag = new StreamBron(ctx, {}, { interval: 1e9, haal: async (url, init) => {
    if (url.includes('eerste')) await new Promise((r) => setTimeout(r, 60));
    return haal(url, init);
  } });
  const eersteLaad = traag.laad({ url: '/media/eerste/audio.wav' }).then(() => 'klaar', (e) => (e.vervangen ? 'vervangen' : e.message));
  await new Promise((r) => setTimeout(r, 5));
  const tweede = await traag.laad({ url: '/media/tweede/audio.wav' }).then(() => 'klaar', (e) => e.message);
  ok('twee keer snel laden: de laatste wint', tweede === 'klaar' && (await eersteLaad) === 'vervangen'
    && traag.bestand.url.includes('tweede'));
  traag.vernietig();
  const opgeruimd = new StreamBron(ctx, {}, { interval: 1e9, haal: async (u, i) => { await new Promise((r) => setTimeout(r, 30)); return haal(u, i); } });
  const halfweg = opgeruimd.laad({ url: '/media/x/audio.wav' }).then(() => 'klaar', (e) => (e.vervangen ? 'vervangen' : e.message));
  await new Promise((r) => setTimeout(r, 5));
  opgeruimd.vernietig();
  ok('vernietigd tijdens het laden: geeft op, bouwt niets meer op', (await halfweg) === 'vervangen' && opgeruimd._timer === null);
}

// ---- één motor: losse bestanden via de streamkern -------------------------

console.log('\nlos bestand via de streamkern');
{
  const { maakWav } = K;
  const { StreamBron, geheugenHaal } = await import('../src/engine/bron.js');
  const n = 48000 * 3;
  const L = new Float32Array(n).map((_, i) => Math.sin(i / 20) * 0.5);
  const R = new Float32Array(n).map((_, i) => (i % 100) / 100 - 0.5);
  const wav = maakWav([L, R], 48000);
  const kop = leesWavKop(wav);
  ok('maakWav: het formaat van de ingest', controleerWav(kop) === null && kop.sampleRate === 48000 && kop.dataLengte === n * 4 && kop.dataStart === 44);
  const pcm = new Int16Array(wav, 44);
  ok('samples kloppen op 16 bit', Math.abs(pcm[2000] / 32768 - L[1000]) < 1 / 16000 && Math.abs(pcm[2001] / 32768 - R[1000]) < 1 / 16000);
  ok('mono komt op beide kanalen', (() => { const m = new Int16Array(maakWav([L], 48000), 44); return m[10] === m[11]; })());
  ok('buiten -1..1 wordt geklemd, niet omgeslagen', new Int16Array(maakWav([Float32Array.of(1.5, -1.5)], 48000), 44)[0] === 32767
    && new Int16Array(maakWav([Float32Array.of(1.5, -1.5)], 48000), 44)[2] === -32768);

  const haal = geheugenHaal(wav);
  const deel = await haal('x', { headers: { Range: 'bytes=44-51' } });
  ok('geheugenHaal: Range geeft 206 en precies die bytes', deel.status === 206 && (await deel.arrayBuffer()).byteLength === 8);
  ok('voorbij het einde: 416', (await haal('x', { headers: { Range: `bytes=${wav.byteLength}-` } })).status === 416);

  const berichten = [];
  globalThis.AudioWorkletNode = class {
    constructor() { this.port = { postMessage: (m) => berichten.push(m), onmessage: null }; }
    connect() {} disconnect() {}
  };
  const ctx = {
    currentTime: 0, audioWorklet: { addModule: async () => {} },
    createBuffer: (k, len, sr) => { const d = Array.from({ length: k }, () => new Float32Array(len)); return { length: len, sampleRate: sr, duration: len / sr, getChannelData: (c) => d[c] }; },
  };
  const bron = new StreamBron(ctx, {}, { interval: 1e9, haal: async () => { throw new Error('mag niet naar het netwerk'); } });
  await bron.laad({ url: 'geheugen:A:1', haal });
  ok('StreamBron laadt uit het geheugen, niet van het netwerk', Math.abs(bron.duur - 3) < 1e-9 && berichten.some((m) => m.type === 'pagina'));
  const stuk = await bron.knip(1, 1.5);
  ok('knippen werkt ook (de sampler)', stuk.length === 24000 && Math.abs(stuk.getChannelData(0)[0] - L[48000]) < 1 / 16000);
  await bron.laad({ url: '/media/x/audio.wav' }).catch(() => {});
  ok('een volgende laad zonder haal gebruikt weer de standaard (netwerk)', bron.haal === bron.standaardHaal);
  bron.vernietig();
}

// ---- starten op de maat: een gepland segment ---------------------------------
// De StreamBron plant een start op T (later dan nu); de worklet blijft tot T
// stil en begint op T precies op het startpunt. Zonder de vlag `gepland` gaf
// de formule vóór T de muziek van vóór het startpunt.

console.log('\ngepland starten (starten op de maat)');
{
  const { maakWav } = K;
  const { StreamBron, geheugenHaal } = await import('../src/engine/bron.js');
  const n = 48000 * 3;
  // Zaagtand van 0,1 s: elke plek in het bestand is aan zijn waarde te herkennen.
  const L = new Float32Array(n).map((_, i) => (i % 4800) / 4800 - 0.5);
  const wav = maakWav([L, L], 48000);
  const pcm = new Int16Array(wav, 44);

  const berichten = [];
  globalThis.AudioWorkletNode = class {
    constructor() { this.port = { postMessage: (m) => berichten.push(m), onmessage: null }; }
    connect() {} disconnect() {}
  };
  const ctx = { currentTime: 10, audioWorklet: { addModule: async () => {} } };
  const bron = new StreamBron(ctx, {}, { interval: 1e9 });
  await bron.laad({ url: 'geheugen:G:1', haal: geheugenHaal(wav) });
  const segmenten = () => berichten.filter((m) => m.type === 'segment');

  bron.start(1.0, { op: 10.5 });
  const s1 = segmenten().at(-1);
  ok('gepland: het segment begint op T, met de vlag voor de worklet', s1.gepland === true && s1.seg.T === 10.5 && s1.seg.P === 1.0 && s1.seg.speelt);
  ok('... de bron speelt al (pauze annuleert), maar wacht', bron.speelt && bron.wachtTot === 10.5);
  ctx.currentTime = 10.2;
  ok('... vóór T staat de positie stil op het startpunt', bron.positie === 1.0);
  ok('... ctxTimeOf klopt al vóór T', dichtbij(bron.ctxTimeOf(1.25), 10.75));
  bron.setRate(1.1);
  const s2 = segmenten().at(-1);
  ok('tempo tijdens het wachten: T en P blijven, R verandert', s2.gepland && s2.seg.T === 10.5 && s2.seg.P === 1.0 && s2.seg.R === 1.1);
  bron.setLoop(1.0, 2.0);
  ok('loop tijdens het wachten: T blijft', segmenten().at(-1).seg.T === 10.5 && segmenten().at(-1).seg.loop?.end === 2.0 && bron.wachtTot === 10.5);
  bron.clearLoop();
  ctx.currentTime = 10.6;
  ok('na T loopt hij, vanaf P op T', dichtbij(bron.positie, 1.0 + 0.1 * 1.1) && bron.wachtTot === null);
  bron.setRate(1);
  ok('na T is een tempowissel weer een gewoon segment (T = nu)', !segmenten().at(-1).gepland && segmenten().at(-1).seg.T === 10.6);
  const voor = segmenten().length;
  bron.start(2.0, { loop: { start: 2.0, end: 2.5 } });
  ok('start met loop: loop en positie in ÉÉN segment', segmenten().length === voor + 1
    && segmenten().at(-1).seg.loop?.start === 2.0 && segmenten().at(-1).seg.P === 2.0 && bron.loop.end === 2.5);
  bron.start(1.0, { op: 11 });
  bron.pauzeer();
  ok('pauze tijdens het wachten: stil op het startpunt', !bron.speelt && bron.positie === 1.0 && bron.wachtTot === null);
  bron.vernietig();

  // De worklet zelf, met een nagemaakte AudioWorkletGlobalScope.
  let Lezer = null;
  globalThis.sampleRate = 48000;
  globalThis.currentFrame = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {}, onmessage: null }; } };
  globalThis.registerProcessor = (_naam, k) => { Lezer = k; };
  await import('../src/engine/stream-lezer.js');
  const T = 0.1, P = 1.0, Tf = Math.round(T * 48000);
  const draai = (berichtenIn, frames = 9600) => {
    const w = new Lezer();
    const zend = (m) => w.port.onmessage({ data: m });
    zend({ type: 'bron', duur: 3, sr: 48000 });
    for (let i = 0; i * PAGINA < n; i++) zend({ type: 'pagina', i, data: pcm.slice(i * PAGINA * 2, Math.min(n, (i + 1) * PAGINA) * 2) });
    const uit = new Float32Array(frames);
    for (let f = 0; f < frames; f += 128) {
      globalThis.currentFrame = f;
      for (const [op, m] of berichtenIn) if (op === f) zend(m);
      const blok = [new Float32Array(128), new Float32Array(128)];
      w.process([], [blok]);
      uit.set(blok[0], f);
    }
    return uit;
  };
  const seg = { T, P, R: 1, loop: null, speelt: true };
  const gepland = draai([[0, { type: 'segment', seg, id: 1, gepland: true }]]);
  ok('worklet: vóór T volkomen stil (geen muziek van vóór het startpunt)', gepland.slice(0, Tf + 1).every((v) => v === 0));
  const na = Tf + Math.ceil(0.004 * 48000) + 1;                // na 4 ms invloeien
  let afw = 0;
  for (let k = na; k < na + 3000; k++) afw = Math.max(afw, Math.abs(gepland[k] - pcm[(P * 48000 + (k - Tf)) * 2] / 32768));
  ok(`worklet: vanaf T precies het startpunt, sample voor sample (afwijking ${afw.toExponential(1)})`, afw < 1e-6);
  ok('worklet: het invloeien begint op T, niet eerder', Math.abs(gepland[Tf + 100]) > 0.1);
  const zonderVlag = draai([[0, { type: 'segment', seg, id: 1 }]]);
  ok('zonder de vlag klonk vóór T de muziek van vóór het startpunt (daarom de vlag)', zonderVlag.slice(200, Tf).some((v) => Math.abs(v) > 0.1));
  const geannuleerd = draai([[0, { type: 'segment', seg, id: 1, gepland: true }],
    [2560, { type: 'segment', seg: { ...seg, T: 2560 / 48000, speelt: false }, id: 2 }]]);
  ok('worklet: pauze vóór T annuleert: helemaal stil, ook geen tikje', geannuleerd.every((v) => v === 0));
  const verzet = draai([[0, { type: 'segment', seg, id: 1, gepland: true }],
    [2560, { type: 'segment', seg: { ...seg, P: 2.0 }, id: 2, gepland: true }]]);
  let afw2 = 0;
  for (let k = na; k < na + 2000; k++) afw2 = Math.max(afw2, Math.abs(verzet[k] - pcm[(2.0 * 48000 + (k - Tf)) * 2] / 32768));
  ok('worklet: startpunt verzet tijdens het wachten (hotcue): stil tot T, dan het nieuwe punt',
    verzet.slice(0, Tf + 1).every((v) => v === 0) && afw2 < 1e-6);
  delete globalThis.registerProcessor; delete globalThis.AudioWorkletProcessor;
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
