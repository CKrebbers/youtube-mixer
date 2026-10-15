// Streamen: de rekenkern, het WAV-formaat en de StreamBron, zonder browser.
// Draai met: node test/stream.test.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const K = await import('../src/engine/stream-kern.js');
const { PAGINA, positieOp, ctxTijdVan, leesWavKop, controleerWav, plan, reeksen, renderBlok, VOORUIT, VOORUIT_HOORBAAR } = K;

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const dichtbij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/**
 * Een AudioWorkletNode zoals de echte: numberOfOutputs (standaard 1),
 * outputChannelCount moet even lang zijn (anders IndexSizeError), en
 * connect(doel, uitgang) gooit IndexSizeError bij een uitgang die er niet is.
 * Wat hij stuurt komt in `berichten`; wat hij verbindt in `verbindingen`.
 * Een mock die makkelijker is dan de echte API verbergt bugs.
 */
const indexFout = (w) => Object.assign(new Error(`IndexSizeError: ${w}`), { name: 'IndexSizeError' });
function nepWorkletNode(berichten, nodes = []) {
  return class {
    constructor(_ctx, naam, opties = {}) {
      this.naam = naam;
      this.numberOfInputs = opties.numberOfInputs ?? 1;
      this.numberOfOutputs = opties.numberOfOutputs ?? 1;
      if (opties.outputChannelCount && opties.outputChannelCount.length !== this.numberOfOutputs) throw indexFout('outputChannelCount past niet bij numberOfOutputs');
      this.outputChannelCount = opties.outputChannelCount ?? Array(this.numberOfOutputs).fill(1);
      this.verbindingen = [];
      // Zoals een echte MessagePort: na close() komt niets meer aan (en gooit hij niet).
      this.port = { dicht: false, postMessage(m) { if (!this.dicht) berichten.push(m); }, onmessage: null, close() { this.dicht = true; } };
      nodes.push(this);
    }
    connect(doel, uitgang = 0) {
      if (!(Number.isInteger(uitgang) && uitgang >= 0 && uitgang < this.numberOfOutputs)) throw indexFout(`uitgang ${uitgang} bestaat niet`);
      this.verbindingen.push({ doel, uitgang });
      return doel;
    }
    disconnect() { this.verbindingen = []; }
  };
}

/** Een WAV met `paren` stereoparen (16 bit, interleaved), zoals stems.wav. */
function maakWavParen(paren, sr) {
  const ch = paren.length * 2, n = paren[0][0].length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const zet = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  zet(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); zet(8, 'WAVE');
  zet(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  zet(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const pcm = new Int16Array(buf, 44);
  const naar16 = (x) => { const c = Math.max(-1, Math.min(1, x)); return Math.round(c < 0 ? c * 32768 : c * 32767); };
  for (let i = 0; i < n; i++) for (let k = 0; k < paren.length; k++) {
    pcm[i * ch + 2 * k] = naar16(paren[k][0][i]);
    pcm[i * ch + 2 * k + 1] = naar16(paren[k][1][i]);
  }
  return buf;
}

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
  // Wat je hoort houdt een minuut vooruit (docs/WINST.md punt 3): de server mag even weg zijn.
  ok('standaard vooruit = VOORUIT (20 s)', VOORUIT === 20 && VOORUIT_HOORBAAR === 60
    && JSON.stringify(plan({ positie: 100, duur: 3600, sr, vooruit: undefined })) === JSON.stringify(plan({ positie: 100, duur: 3600, sr })));
  const lang = plan({ positie: 100, duur: 3600, sr, vooruit: VOORUIT_HOORBAAR });
  ok('vooruit 60: tot ~160 s, niet verder', lang.includes(Math.floor(159 / s)) && !lang.includes(Math.floor(165 / s)));
  ok('vooruit 60: wat nu klinkt nog steeds vooraan, en achteruit blijft 5 s', lang[0] === Math.floor(100 / s)
    && lang.includes(Math.floor(96 / s)) && !lang.includes(Math.floor(90 / s)));
  const extra = (lang.length - plan({ positie: 100, duur: 3600, sr }).length) * PAGINA * 4;
  ok(`vooruit 60 kost ${(extra / 1e6).toFixed(1)} MB extra per stereotrack (~8 MB)`, extra > 7e6 && extra < 9e6);
  const snel60 = plan({ positie: 100, rate: 1.5, duur: 3600, sr, vooruit: 60 });
  ok('vooruit 60 op 1,5×: 90 s tracktijd vooruit', snel60.includes(Math.floor(189 / s)) && !snel60.includes(Math.floor(195 / s)));
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
  globalThis.AudioWorkletNode = nepWorkletNode(berichten);
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
  // Het deck geeft een getal door (bron.vooruit, de engine beslist): de bron houdt dan 60 s vooruit.
  const voor20 = bron.geladen.size;
  bron.vooruit = VOORUIT_HOORBAAR;
  for (let i = 0; i < 4; i++) await bron.bijvullen();
  const pos = bron.positie;
  ok(`bron.vooruit = 60: pagina's tot een minuut verder (${voor20} -> ${bron.geladen.size})`,
    bron.geladen.has(Math.floor((pos + 59) * SR / PAGINA)) && bron.geladen.size > voor20 + 25);
  bron.vooruit = VOORUIT;
  await bron.bijvullen();
  ok('terug naar 20: wat verder ligt gaat weer weg', !bron.geladen.has(Math.floor((pos + 59) * SR / PAGINA)) && bron.geladen.size <= voor20 + 1);

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

// ---- rem (vinylstop): één formule, hoofdthread en worklet -----------------------

console.log('\nrem (vinylstop)');
{
  const { snelheidOp, remStil, REM_UIT, maakWav } = K;
  const SR = 48000;
  const seg = { T: 10, P: 30, R: 1.2, loop: null, speelt: true, rem: { a: -1.2 / 0.8 } };      // 0,8 s remmen
  ok('zonder rem (rem = null, of geen rem) precies de oude regel',
    positieOp({ ...seg, rem: null }, 12) === 30 + (12 - 10) * 1.2 && positieOp({ T: 10, P: 30, R: 1.2, loop: null, speelt: true }, 12) === 30 + (12 - 10) * 1.2);
  ok('begint met snelheid R, positie P', snelheidOp(seg, 10) === 1.2 && dichtbij(positieOp(seg, 10), 30));
  ok('positie = P + R·dt + a·dt²/2', dichtbij(positieOp(seg, 10.3), 30 + 1.2 * 0.3 + 0.5 * seg.rem.a * 0.09));
  ok('stil na R/|a| s, op P + R·D/2, en daar blijft hij',
    dichtbij(remStil(seg), 10.8) && dichtbij(positieOp(seg, 10.8), 30 + 1.2 * 0.8 / 2)
    && positieOp(seg, 99) === positieOp(seg, 10.8) && snelheidOp(seg, 11) === 0);
  ok('ctxTijdVan is het omgekeerde, ook tijdens de rem',
    [30.1, 30.3, 30.47].every((x) => dichtbij(positieOp(seg, ctxTijdVan(seg, x, 10.05)), x)));
  ok('voorbij de plek waar hij stilvalt: nooit (null)', ctxTijdVan(seg, 30.49, 10) === null);
  const lus = { T: 0, P: 4, R: 1, loop: { start: 4, end: 4.3 }, speelt: true, rem: { a: -1 / 2 } };
  ok('rem in een loop: vouwt terug', dichtbij(positieOp(lus, 0.5), 4 + ((0.5 - 0.0625) % 0.3)));
  ok('… en ctxTijdVan kent de ronde', dichtbij(positieOp(lus, ctxTijdVan(lus, 4.1, 0.5)), 4.1) && ctxTijdVan(lus, 4.1, 0.5) > 0.5);

  // Materiaal: een helling (frame n heeft waarde n % 30000, dus uit de
  // uitvoer is terug te lezen WELKE positie de worklet las) en een sinus.
  const DUUR = 6, n = DUUR * SR;
  const helling = new Float32Array(n).map((_, i) => (i % 30000) / 32767);
  const sinus = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) sinus[2 * i] = sinus[2 * i + 1] = Math.round(Math.sin(2 * Math.PI * 331 * i / SR) * 0.125 * 32767);
  const sinPag = new Map();
  for (let p = 0; p * PAGINA * 2 < sinus.length; p++) sinPag.set(p, sinus.slice(p * PAGINA * 2, (p + 1) * PAGINA * 2));

  // Een StreamBron met een nagemaakte worklet: wat hij stuurt vangen we op.
  const { StreamBron, geheugenHaal } = await import('../src/engine/bron.js');
  const berichten = [];
  globalThis.AudioWorkletNode = nepWorkletNode(berichten);
  const ctx = { currentTime: 0, audioWorklet: { addModule: async () => {} } };
  const bron = new StreamBron(ctx, {}, { interval: 1e9, haal: async () => { throw new Error('mag niet naar het netwerk'); } });
  const haal = geheugenHaal(maakWav([helling], SR));
  await bron.laad({ url: 'geheugen:rem', haal });
  const paginas = new Map();
  for (const m of berichten) if (m.type === 'pagina') paginas.set(m.i, m.data);
  const laatsteSeg = () => berichten.filter((m) => m.type === 'segment').pop().seg;

  ctx.currentTime = 1;
  bron.start(0.7);
  ctx.currentTime = 1.1;                         // positie 0,8
  let klaar = 0;
  bron.onRemKlaar = () => klaar++;
  const D = 0.25;
  ok('rem geweigerd zonder geldige tijd', !bron.rem(0) && !bron.remt);
  ok('rem: de bron remt, en speelt nog', bron.rem(D) && bron.remt && bron.speelt);
  const remSeg = laatsteSeg();
  ok('de worklet krijgt één segment met de rem erin', remSeg.rem.a === -1 / D && remSeg.T === 1.1 && dichtbij(remSeg.P, 0.8));

  // De worklet: blok voor blok vanaf T, per frame terug te lezen welke positie
  // hij las. De hoofdthread: bron.positie op dezelfde audiokloktijd.
  const F = Math.round((D + 0.05) * SR);
  const uit = [new Float32Array(F), new Float32Array(F)];
  for (let i = 0; i < F; i += 128) {
    renderBlok({ seg: remSeg, paginas, uit: [uit[0].subarray(i, i + 128), uit[1].subarray(i, i + 128)],
      frames: Math.min(128, F - i), t0: 1.1 + i / SR, ctxRate: SR, trackRate: SR, duur: DUUR });
  }
  let verschil = 0, gat = false, vol = 0;
  const volTot = Math.floor(D * (1 - REM_UIT) * SR);           // tot hier klinkt hij vol
  for (let i = 0; i < volTot; i++) {
    ctx.currentTime = 1.1 + i / SR;
    const hoofd = bron.positie * SR;
    const worklet = uit[0][i] * 32768 + 30000;                 // frames 30000..59999 = waarde 0..29999
    verschil = Math.max(verschil, Math.abs(worklet - hoofd));
    if (uit[0][i] === 0) gat = true;
    vol++;
  }
  ok(`positie hoofdthread = worklet, frame voor frame over ${vol} frames (grootste verschil ${verschil.toExponential(1)} frame)`, verschil < 0.01);
  ok('geen gat tijdens het remmen', !gat);
  const stilVanaf = Math.ceil(D * SR) + 1;
  ok('na stilstand: stilte, exact', uit[0].subarray(stilVanaf).every((v) => v === 0) && uit[1].subarray(stilVanaf).every((v) => v === 0));
  let daalt = true;
  for (let i = volTot + 1; i < stilVanaf; i++) if (Math.abs(uit[0][i]) > Math.abs(uit[0][i - 1]) + 1e-6) daalt = false;
  ok(`het laatste deel (${Math.round(D * REM_UIT * 1000)} ms) dooft uit tot 0`, daalt && Math.abs(uit[0][stilVanaf - 2]) < 1e-3);
  ctx.currentTime = 1.1 + D + 0.01;
  ok('hoofdthread: stil op P + R·D/2', dichtbij(bron.positie, 0.8 + D / 2) && bron.snelheid === 0);
  // Tussen stilstand en de timer (die loopt niet op de audioklok): de stand
  // komt van de klok. Geen rem meer, geen spelen; tempo zetten in dat gat
  // start hem niet, maar maakt de pauze (met de melding).
  ok('stil, de timer heeft nog niet gevuurd: remt niet meer en speelt niet', !bron.remt && !bron.speelt && klaar === 0);
  bron.setRate(1);
  ok('tempo zetten in dat gat start hem niet: het wordt de pauze, met de melding',
    !bron.speelt && !laatsteSeg().speelt && klaar === 1 && dichtbij(laatsteSeg().P, 0.8 + D / 2) && dichtbij(bron.positie, 0.8 + D / 2));

  // Stilstand wordt een pauze op die plek (een timer zegt WANNEER, de
  // formule WAAR). Daarna gewoon play.
  await new Promise((r) => setTimeout(r, 300));
  const pauze = laatsteSeg();
  ok('na de rem: gepauzeerd op de plek waar hij stilviel, één melding',
    !bron.speelt && !bron.remt && klaar === 1 && !pauze.speelt && dichtbij(pauze.P, 0.8 + D / 2) && dichtbij(bron.positie, 0.8 + D / 2));
  bron.start(bron.positie);
  ctx.currentTime += 0.5;
  ok('play daarna: gewoon verder, op tempo', bron.speelt && !bron.remt && dichtbij(bron.positie, 0.8 + D / 2 + 0.5));

  // Tijdens het remmen: tempo onthouden, loop aan/uit remt door, start haalt hem eraf.
  bron.rem(1);
  const stilOp = remStil(bron.seg);
  const segVoor = bron.seg;
  ctx.currentTime += 0.2;
  bron.setRate(1.1);
  ok('tempo tijdens het remmen: rem loopt door (zelfde segment), tempo onthouden', bron.seg === segVoor && bron.rate === 1.1);
  const p0 = bron.positie;
  bron.setLoop(p0 - 0.05, p0 + 0.3);
  ok('loop aan tijdens het remmen: remt door, stilstand op hetzelfde moment, geen sprong',
    bron.remt && dichtbij(remStil(bron.seg), stilOp) && dichtbij(bron.positie, p0) && dichtbij(bron.snelheid, 0.8));
  ctx.currentTime += 0.3;
  const p1 = bron.positie;
  bron.clearLoop();
  ok('loop uit tijdens het remmen: idem', bron.remt && dichtbij(remStil(bron.seg), stilOp) && dichtbij(bron.positie, p1) && !bron.seg.loop);
  bron.start(bron.positie);
  ok('start (play, seek, hotcue) haalt de rem eraf, met het onthouden tempo', !bron.remt && bron.seg.rem === null && bron.seg.R === 1.1);
  bron.vernietig();

  // Klikvrij, op een sinus, zoals de worklet het krijgt: het remsegment komt
  // 3 ms na T binnen, de pauze 5 ms na stilstand. Geen stap tussen twee
  // samples mag groter zijn dan wat de toon op volle snelheid zelf doet.
  const toon = 0.125 * 2 * Math.PI * 331 / SR;
  const maxStap = (x) => { let m = 0; for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const draai = (stappen, tot) => {
    const alles = [];
    const staat = { env: 1 };
    let seg = stappen[0].seg, vorig = null, wisselT = -Infinity, k = 1;
    for (let t0 = stappen[0].t; t0 < tot; t0 += 128 / SR) {
      if (k < stappen.length && t0 >= stappen[k].t) { vorig = seg; seg = stappen[k].seg; wisselT = t0; k++; }
      const u = [new Float32Array(128), new Float32Array(128)];
      renderBlok({ seg, paginas: sinPag, uit: u, frames: 128, t0, ctxRate: SR, trackRate: SR, duur: DUUR, vorig, wisselT, staat });
      alles.push(...u[0]);
    }
    return Float32Array.from(alles);
  };
  const T = 2, D2 = 0.4;
  const oud = { T: 1, P: 1.5, R: 1, loop: null, speelt: true, rem: null };
  const rem = { T, P: positieOp(oud, T), R: 1, loop: null, speelt: true, rem: { a: -1 / D2 } };
  const stil = { T: T + D2 + 0.005, P: positieOp(rem, T + D2), R: 1, loop: null, speelt: false, rem: null };
  const geluid = draai([{ t: T - 0.02, seg: oud }, { t: T + 0.003, seg: rem }, { t: stil.T, seg: stil }], T + D2 + 0.03);
  // Het begin is een gewone segmentwissel: equal-power over 4 ms, en twee
  // (bijna) gelijke stukken tellen daarin op tot hooguit √2 (zoals bij seek).
  // Daarna, de rem zelf en zijn einde: nooit meer dan een normale stap.
  const naWissel = Math.ceil((0.02 + 0.003 + K.SEGMENT_FADE) * SR) + 128;
  ok(`remmen tot stilstand en pauze: grootste stap ${(maxStap(geluid) / toon).toFixed(2)}x (de wissel aan het begin), `
    + `daarna ${(maxStap(geluid.subarray(naWissel)) / toon).toFixed(2)}x een normale stap (geen tik)`,
  maxStap(geluid) < 1.5 * toon && maxStap(geluid.subarray(naWissel)) <= toon * 1.001);
  const telStil = Math.ceil((0.02 + D2) * SR) + 1;
  ok('na stilstand exact stil, ook door de overgang naar de pauze heen', geluid.subarray(telStil).every((v) => v === 0));
  let blokGat = false;
  for (let b = 0; b + 128 < (0.02 + D2 * (1 - REM_UIT)) * SR; b += 128) if (maxStap(geluid.subarray(b, b + 128)) === 0 && Math.max(...geluid.subarray(b, b + 128).map(Math.abs)) < 1e-3) blokGat = true;
  ok('geen stil blok zolang hij vol klinkt', !blokGat);
  // Los tijdens het remmen (halve snelheid): overvloeien naar de volle snelheid.
  const los = { T: T + D2 / 2, P: positieOp(rem, T + D2 / 2), R: 1, loop: null, speelt: true, rem: null };
  const losGeluid = draai([{ t: T - 0.02, seg: oud }, { t: T + 0.003, seg: rem }, { t: los.T + 0.003, seg: los }], los.T + 0.05);
  ok(`los tijdens het remmen: grootste stap ${(maxStap(losGeluid) / toon).toFixed(2)}x (geen tik)`, maxStap(losGeluid) < 1.5 * toon);

  // Een loop aan in het laatste kwart (daar dooft hij uit), zoals de
  // StreamBron hem stuurt: het geluid gaat gewoon door zoals zonder loop
  // (hij valt stil voordat de loop rondgaat). Het nieuwe segment nam eerst
  // de snelheid van DAT moment als beginsnelheid, en dan stond het uitdoven
  // ineens weer vol, vlak voor stilstand.
  {
    const ctx2 = { currentTime: 1, audioWorklet: { addModule: async () => {} } };
    const b2 = new StreamBron(ctx2, {}, { interval: 1e9, haal: async () => { throw new Error('mag niet naar het netwerk'); } });
    await b2.laad({ url: 'geheugen:rem-lus', haal });
    b2.start(1.5);
    const begin = b2.seg;
    ctx2.currentTime = T;
    b2.rem(D2);
    const remmend = b2.seg;
    const LUS = T + 0.35;                            // snelheid nog 12,5%: midden in het uitdoven
    ctx2.currentTime = LUS;
    b2.setLoop(b2.positie, b2.positie + 0.3);
    const verder = b2.seg;
    b2.vernietig();
    const zonder = draai([{ t: T - 0.02, seg: begin }, { t: T + 0.003, seg: remmend }], T + D2 + 0.01);
    const met = draai([{ t: T - 0.02, seg: begin }, { t: T + 0.003, seg: remmend }, { t: LUS + 0.003, seg: verder }], T + D2 + 0.01);
    // Vanaf na de overgang (4 ms equal-power, op een blokgrens) tot stilstand.
    const van = Math.ceil((LUS - (T - 0.02) + 0.003 + K.SEGMENT_FADE) * SR) + 256, tot = Math.floor((D2 + 0.02) * SR);
    let verschil = 0, piek = 0;
    for (let i = van; i < tot; i++) { verschil = Math.max(verschil, Math.abs(met[i] - zonder[i])); piek = Math.max(piek, Math.abs(met[i])); }
    ok(`loop aan in het laatste kwart van de rem: dooft uit zoals zonder loop (verschil ${verschil.toExponential(1)}, piek ${piek.toFixed(3)} tegen ${Math.max(...zonder.subarray(van, tot).map(Math.abs)).toFixed(3)})`,
      verschil < 1e-4 && remStil(verder) === remStil(remmend));
  }
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
  globalThis.AudioWorkletNode = nepWorkletNode(berichten);
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
  globalThis.AudioWorkletNode = nepWorkletNode(berichten);
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

// ---- keylock en toon: de StreamBron plant sprongen (docs/KEYLOCK.md, K3) -------------
// Met rek is elke start een sprong op het zoekrooster van de stretcher: tot T
// speelt wat er speelde (positieIn), daarna exact de nieuwe plek. Doorlopend
// (sync, nudge, beatjump) landt waar hij met een sprong NU op T zou zijn.

console.log('\nkeylock en toon (StreamBron)');
{
  const { maakWav } = K;
  const { StreamBron, geheugenHaal } = await import('../src/engine/bron.js');
  const { rekPlanT, rekUitLatStandaard, REK_MARGE } = await import('../src/engine/rek-kern.js');
  const L = new Float32Array(48000 * 30);
  const wav = maakWav([L, L], 48000);
  const berichten = [];
  const nodes = [];
  globalThis.AudioWorkletNode = nepWorkletNode(berichten, nodes);
  const ctx = { currentTime: 20, sampleRate: 48000, audioWorklet: { addModule: async () => {} } };
  const bron = new StreamBron(ctx, {}, { interval: 1e9 });
  await bron.laad({ url: 'geheugen:K:1', haal: geheugenHaal(wav) });
  const segmenten = () => berichten.filter((m) => m.type === 'segment');
  const VELDEN = 'T,P,R,loop,speelt,rem,rek';
  ok('elk segment heeft zeven velden in vaste volgorde (één vorm voor de worklet)', Object.keys(bron.seg).join() === VELDEN);
  ok('zonder keylock en toon: rek null', bron.seg.rek === null && !bron.keylock && bron.toon === 0);
  bron.start(5);
  const s0 = segmenten().at(-1);
  ok('zonder rek: een start is meteen (T = nu), zoals altijd', !s0.gepland && s0.seg.T === 20 && s0.seg.rek === null);
  ctx.currentTime = 21;
  bron.zetRek({ keylock: true });
  const s1 = segmenten().at(-1);
  ok('keylock aan tijdens het spelen: een segment op T = nu, vanaf waar hij is, met rek (geen sprong)',
    !s1.gepland && s1.seg.T === 21 && dichtbij(s1.seg.P, 6) && s1.seg.rek?.keylock === true && s1.seg.rek.toon === 0
    && Object.keys(s1.seg).join() === VELDEN && bron.keylock);
  ctx.currentTime = 22;
  const uitLat = rekUitLatStandaard(48000);
  bron.start(15);
  const s2 = segmenten().at(-1);
  const T = rekPlanT(22 + uitLat / 48000 + REK_MARGE, uitLat, 48000);
  ok(`een sprong met keylock: gepland op het zoekrooster (${((s2.seg.T - 22) * 1000).toFixed(1)} ms later), exact naar P`,
    s2.gepland === true && s2.seg.T === T && s2.seg.P === 15 && dichtbij(((s2.seg.T * 48000 - uitLat) / 128) % 1, 0, 1e-6)
    && s2.seg.T - 22 > 0.09 && s2.seg.T - 22 < 0.105);
  ok('… geen start op de maat: wachtTot blijft null', bron.wachtTot === null && bron.speelt);
  ctx.currentTime = 22.05;
  ok('… tot T speelt het vorige segment (de positie loopt door)', dichtbij(bron.positie, 7.05));
  ok('… ctxTimeOf: een plek die vóór T nog langskomt op het vorige', dichtbij(bron.ctxTimeOf(7.06), 22.06));
  bron.start(16, { doorlopend: true });
  const s3 = segmenten().at(-1);
  ok('nog een sprong tijdens het wachten: het vorige blijft wat je hoort; doorlopend landt op P + (T − nu)·R',
    dichtbij(bron.positie, 7.05) && dichtbij(s3.seg.P, 16 + (s3.seg.T - 22.05)));
  bron.setRate(1.05);
  const s4 = segmenten().at(-1);
  ok('tempo tijdens het wachten: het moment blijft (geen sprong verloren)', s4.gepland && s4.seg.T === s3.seg.T && s4.seg.R === 1.05);
  ctx.currentTime = s4.seg.T + 0.1;
  ok('na T: de nieuwe plek', dichtbij(bron.positie, s3.seg.P + 0.1 * 1.05));
  bron.pauzeer();
  const pauzePos = bron.positie;
  bron.start(pauzePos);
  const s5 = segmenten().at(-1);
  ctx.currentTime += 0.03;
  ok('play met keylock vanuit pauze: gepland, en tot T stil op P (er speelde niets)', s5.gepland && !bron._vorig && bron.positie === pauzePos);
  ctx.currentTime += 0.2;
  // De worklet meldt zijn gemeten uitvoerlatentie: die gebruikt de planning.
  nodes.at(-1).port.onmessage({ data: { type: 'rek', uitLat: 4448, sr: 48000 } });
  bron.start(3);
  const s6 = segmenten().at(-1);
  ok('de gemeten latentie van de worklet bepaalt het rooster', dichtbij(((s6.seg.T * 48000 - 4448) / 128) % 1, 0, 1e-6));
  ctx.currentTime = s6.seg.T - 0.05;
  bron.pauzeer();
  ok('pauze tijdens een geplande sprong: stil op de plek die je hoorde (het vorige segment)', !bron.speelt && !bron._vorig
    && segmenten().at(-1).seg.speelt === false);
  bron.zetRek({ keylock: false, toon: -2 });
  ok('toon zonder keylock (K8): rek met toon, keylock uit', bron.seg.rek?.toon === -2 && bron.seg.rek.keylock === false && bron.toon === -2);
  bron.zetRek({ toon: 0 });
  ok('keylock uit en toon 0: rek weer null', bron.seg.rek === null);
  bron.vernietig();
}

// ---- stems: 4 en 8 kanalen (docs/STEMS.md §3) ---------------------------------
// Een stems-bestand heeft twee of vier stereoparen naast elkaar. renderBlok
// leest er één paar per aanroep uit (stride, paar). De stereoweg is de gouden
// (renderblok.test.mjs), dus elk paar moet bit voor bit gelijk zijn aan
// hetzelfde paar als los stereobestand: exact, cubisch, over een paginagrens,
// loop-naad, gat (uit en weer in), rem, overgang en trackeinde.

console.log('\nstems: meer kanalen');
{
  const { maakWav, bytesPerFrame, UITGANGEN } = K;
  ok('controleerWav: 2, 4 en 8 kanalen mogen (stereo, twee of vier stems)',
    [2, 4, 8].every((c) => controleerWav({ formaat: 1, bits: 16, kanalen: c }) === null));
  ok('… 1, 6 en 16 niet, met een reden', [1, 6, 16].every((c) => /kanalen/.test(controleerWav({ formaat: 1, bits: 16, kanalen: c }) || '')));
  ok('bytes per frame uit de kop (16 bit × kanalen)', bytesPerFrame({ kanalen: 8, bits: 16 }) === 16 && bytesPerFrame({ kanalen: 2, bits: 16 }) === 4);

  // Vier verschillende stereoparen (tonen + ruis), iets meer dan drie
  // pagina's: de laatste is afgekapt.
  const SR = 48000, N = 3 * PAGINA + 1234, DUUR = N / SR;
  let zaad = 7;
  const ruis = () => { zaad = (Math.imul(zaad, 1103515245) + 12345) >>> 0; return ((zaad >>> 8) / 16777216 - 0.5) * 0.05; };
  const tonen = [[55, 82.5], [331, 517], [1200, 1800], [97, 3001]];
  const pcmParen = tonen.map(([fl, fr], k) => {
    const p = new Int16Array(N * 2);
    for (let i = 0; i < N; i++) {
      p[2 * i] = Math.round((0.3 * Math.sin(2 * Math.PI * fl * i / SR) + ruis()) * 32767 * (1 - 0.1 * k));
      p[2 * i + 1] = Math.round((0.25 * Math.sin(2 * Math.PI * fr * i / SR) + ruis()) * 32767);
    }
    return p;
  });
  const vlecht = (aantal) => {
    const ch = aantal * 2, p = new Int16Array(N * ch);
    for (let i = 0; i < N; i++) for (let k = 0; k < aantal; k++) { p[i * ch + 2 * k] = pcmParen[k][2 * i]; p[i * ch + 2 * k + 1] = pcmParen[k][2 * i + 1]; }
    return p;
  };
  const pagineer = (pcm, ch) => {
    const m = new Map();
    for (let q = 0; q * PAGINA < N; q++) m.set(q, pcm.slice(q * PAGINA * ch, Math.min(N, (q + 1) * PAGINA) * ch));
    return m;
  };
  const stereoPag = pcmParen.map((p) => pagineer(p, 2));
  const pcm4 = vlecht(2), pcm8 = vlecht(4);
  const pag = { 4: pagineer(pcm4, 4), 8: pagineer(pcm8, 8) };
  ok(`de laatste pagina is afgekapt (${pag[8].get(3).length / 8} frames)`, pag[8].get(3).length === 1234 * 8);

  // In blokken van 128 met één staat, zoals de worklet; met `vorig` alleen in het eerste blok.
  const render = (paginas, seg, { frames = 4096, t0 = 0, stride = 2, paar = 0, vorig = null, wisselT = -Infinity } = {}) => {
    const L = new Float32Array(frames), R = new Float32Array(frames);
    const staat = { env: 1 };
    let eindes = 0;
    for (let i = 0; i < frames; i += 128) {
      const f = Math.min(128, frames - i);
      const r = renderBlok({ seg, paginas, uit: [L.subarray(i, i + f), R.subarray(i, i + f)], frames: f, t0: t0 + i / SR,
        ctxRate: SR, trackRate: SR, duur: DUUR, vorig, wisselT, staat, stride, paar });
      if (r === 'einde') eindes++;
    }
    return { L, R, eindes };
  };
  const bitGelijk = (a, b) => {
    if (a.length !== b.length) return false;
    const x = new Uint32Array(a.buffer, a.byteOffset, a.length), y = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  };
  const zonder = (m, q) => { const k = new Map(m); k.delete(q); return k; };
  const seg = (P, R, extra = {}) => ({ T: 0, P, R, loop: null, speelt: true, rem: null, ...extra });
  const gevallen = [
    ['exact (rate 1, heel frame)', seg(1, 1), {}],
    ['cubisch (1,0004)', seg(0.7, 1.0004), {}],
    ['cubisch over een paginagrens (0,97)', seg((PAGINA - 300) / SR, 0.97), {}],
    ['loop met naad (krom, 0,92)', seg(1.2, 0.92, { loop: { start: 1.2, end: 1.2 + 0.3017 } }), { frames: 40000 }],
    ['loop vanaf 1 ms (naad geklemd)', seg(0.001, 1.08, { loop: { start: 0.001, end: 0.0615 } }), { frames: 9000 }],
    ['een gat: uitvloeien', seg((PAGINA - 400) / SR, 1.08), { frames: 2000, gat: 1 }],
    ['een gat: weer invloeien', seg((2 * PAGINA - 300) / SR, 1), { frames: 2000, gat: 1 }],
    ['rem tot stilstand', seg(2, 1.1, { rem: { a: -1.1 / 0.3 } }), { frames: Math.round(0.35 * SR) }],
    ['overgang (seek)', seg(2.00731, 1.03, { T: 0.01 }), { t0: 0.01, vorig: seg(1, 1), wisselT: 0.01 }],
    ['trackeinde (afgekapte pagina)', seg(DUUR - 0.01, 1), { frames: 1024 }],
  ];
  for (const ch of [4, 8]) {
    let allesGelijk = true, mis = [];
    for (const [naam, sg, opt] of gevallen) {
      for (let k = 0; k < ch / 2; k++) {
        const p = opt.gat ? zonder(pag[ch], opt.gat) : pag[ch];
        const sp = opt.gat ? zonder(stereoPag[k], opt.gat) : stereoPag[k];
        const a = render(p, sg, { ...opt, stride: ch, paar: 2 * k });
        const b = render(sp, sg, opt);
        if (!bitGelijk(a.L, b.L) || !bitGelijk(a.R, b.R) || a.eindes !== b.eindes) { allesGelijk = false; mis.push(`${naam}/paar ${k}`); }
      }
    }
    ok(`${ch} kanalen: elk paar bit voor bit gelijk aan dat paar als stereobestand, in ${gevallen.length} gevallen${mis.length ? ` (anders: ${mis.join(', ')})` : ''}`, allesGelijk);
  }
  // En rechtstreeks tegen de samples: op rate 1 en een heel frame het sample zelf, ook over een paginagrens.
  {
    const n0 = PAGINA - 40;
    let exact = true;
    for (let k = 0; k < 4; k++) {
      const { L, R } = render(pag[8], seg(n0 / SR, 1), { frames: 256, stride: 8, paar: 2 * k });
      for (let i = 0; i < 256; i++) if (L[i] !== pcm8[(n0 + i) * 8 + 2 * k] / 32768 || R[i] !== pcm8[(n0 + i) * 8 + 2 * k + 1] / 32768) exact = false;
    }
    ok('8 kanalen, rate 1: per paar exact de samples uit het bestand, ook over een paginagrens', exact);
    const gat = render(zonder(pag[8], 1), seg((PAGINA + 10) / SR, 1), { frames: 128, stride: 8, paar: 6 });
    ok('8 kanalen, ontbrekende pagina: stilte op elk paar', gat.L.every((v) => v === 0) && gat.R.every((v) => v === 0));
    const eind = render(pag[8], seg(DUUR - 64 / SR, 1), { frames: 128, stride: 8, paar: 4 });
    ok('8 kanalen, trackeinde: gemeld, daarna stilte', eind.eindes === 1 && eind.L.slice(70).every((v) => v === 0));
  }

  // Hergebruik (de worklet, paar 1–3): waar elk frame leest en de gat-envelop
  // komen van het paar ervoor in hetzelfde blok. Bit voor bit hetzelfde als
  // zelf rekenen; en een paar dat met een ANDERE envelop begint rekent zelf.
  {
    const p = zonder(pag[8], 1);
    const sg2 = seg((PAGINA - 200) / SR, 1.08, { loop: { start: (PAGINA - 200) / SR, end: (PAGINA + 9000) / SR } });
    const blok = (paar, staat, hergebruik) => {
      const L = new Float32Array(128), R = new Float32Array(128);
      renderBlok({ seg: sg2, paginas: p, uit: [L, R], frames: 128, t0: 0.05, ctxRate: SR, trackRate: SR, duur: DUUR,
        vorig: seg(1, 1), wisselT: 0.049, staat, stride: 8, paar, hergebruik });
      return { L, R, env: staat.env };
    };
    let gelijk = true, eigen = true;
    for (const env0 of [1, 0.4, 0]) {
      blok(0, { env: env0 }, false);
      const her = blok(4, { env: env0 }, true), zelf = blok(4, { env: env0 }, false);
      if (!bitGelijk(her.L, zelf.L) || !bitGelijk(her.R, zelf.R) || her.env !== zelf.env) gelijk = false;
      blok(0, { env: env0 }, false);
      const anders = blok(2, { env: 0.7 }, true), zelf2 = blok(2, { env: 0.7 }, false);
      if (!bitGelijk(anders.L, zelf2.L) || anders.env !== zelf2.env) eigen = false;
    }
    ok('hergebruik (paar 1–3 van hetzelfde blok): bit voor bit gelijk aan zelf rekenen, ook in een gat en een overgang', gelijk);
    ok('… een paar dat met een andere envelop begint, rekent zijn envelop zelf', eigen);
  }

  // ---- de worklet: vier uitgangen -------------------------------------------
  let Lezer = null;
  globalThis.sampleRate = SR;
  globalThis.currentFrame = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { const uit = []; this.port = { uit, postMessage: (m) => uit.push(m), onmessage: null }; } };
  globalThis.registerProcessor = (_naam, kl) => { Lezer = kl; };
  await import('../src/engine/stream-lezer.js?stems');
  ok('de worklet kent vier uitgangen', UITGANGEN === 4 && typeof Lezer === 'function');
  const draaiLezer = (kanalen, pcm, sg, frames = 2048) => {
    globalThis.currentFrame = 0;                   // de berichten komen op 0 binnen, zoals de referentie
    const w = new Lezer();
    const zend = (m) => w.port.onmessage({ data: m });
    zend({ type: 'bron', duur: DUUR, sr: SR, ...(kanalen ? { kanalen } : {}) });
    const ch = kanalen || 2;
    for (let q = 0; q * PAGINA < N; q++) zend({ type: 'pagina', i: q, data: pcm.slice(q * PAGINA * ch, Math.min(N, (q + 1) * PAGINA) * ch) });
    zend({ type: 'segment', id: 1, seg: sg });
    const uit = Array.from({ length: 4 }, () => [new Float32Array(frames), new Float32Array(frames)]);
    for (let f = 0; f < frames; f += 128) {
      globalThis.currentFrame = f;
      // Vuilnis vooraf: een uitgang zonder paar moet de worklet zelf op nul zetten.
      const blok = Array.from({ length: 4 }, () => [new Float32Array(128).fill(0.5), new Float32Array(128).fill(-0.5)]);
      w.process([], blok);
      for (let k = 0; k < 4; k++) { uit[k][0].set(blok[k][0], f); uit[k][1].set(blok[k][1], f); }
    }
    return { uit, eindes: w.port.uit.filter((m) => m.type === 'einde').length, w };
  };
  const sg = seg(0.5, 1.03);
  // De worklet vloeit het eerste segment in vanuit stilte (vorig = STIL op 0): de referentie ook.
  const ref = (k) => render(stereoPag[k], sg, { frames: 2048, vorig: K.STIL, wisselT: 0 });
  const acht = draaiLezer(8, pcm8, sg);
  ok('worklet, 8 kanalen: uitgang k = paar k, bit voor bit (vier uitgangen)',
    [0, 1, 2, 3].every((k) => { const b = ref(k); return bitGelijk(acht.uit[k][0], b.L) && bitGelijk(acht.uit[k][1], b.R); }));
  const vier = draaiLezer(4, pcm4, sg);
  ok('worklet, 4 kanalen: uitgang 0 en 1 de twee stems, 2 en 3 op nul (ook met vuilnis erin)',
    [0, 1].every((k) => { const b = ref(k); return bitGelijk(vier.uit[k][0], b.L) && bitGelijk(vier.uit[k][1], b.R); })
    && [2, 3].every((k) => vier.uit[k][0].every((v) => v === 0) && vier.uit[k][1].every((v) => v === 0)));
  const stereo = draaiLezer(null, pcmParen[0], sg);
  ok('worklet, stereo (bron zonder kanalen): uitgang 0 zoals altijd, 1–3 op nul',
    bitGelijk(stereo.uit[0][0], ref(0).L) && bitGelijk(stereo.uit[0][1], ref(0).R) && [1, 2, 3].every((k) => stereo.uit[k][0].every((v) => v === 0)));
  const einde = draaiLezer(8, pcm8, seg(DUUR - 0.01, 1), 1024);
  ok('worklet, 8 kanalen: één einde-melding (van paar 0), niet vier', einde.eindes === 1);
  // Een volgend nummer zonder stems op dezelfde node: de paren gaan terug naar één.
  {
    const w = acht.w;
    w.port.onmessage({ data: { type: 'bron', duur: DUUR, sr: SR, kanalen: 2 } });
    for (let q = 0; q * PAGINA < N; q++) w.port.onmessage({ data: { type: 'pagina', i: q, data: stereoPag[0].get(q) } });
    w.port.onmessage({ data: { type: 'segment', id: 2, seg: seg(0.5, 1, { T: 4096 / SR }) } });
    globalThis.currentFrame = 4096;
    const blok = Array.from({ length: 4 }, () => [new Float32Array(128).fill(0.5), new Float32Array(128).fill(0.5)]);
    w.process([], blok);
    ok('daarna een stereonummer op dezelfde node: alleen uitgang 0 klinkt', blok[0][0].some((v) => v !== 0 && v !== 0.5)
      && [1, 2, 3].every((k) => blok[k][0].every((v) => v === 0) && blok[k][1].every((v) => v === 0)));
  }
  delete globalThis.registerProcessor; delete globalThis.AudioWorkletProcessor;

  // ---- de StreamBron met een stems-bestand -----------------------------------
  const { StreamBron, geheugenHaal } = await import('../src/engine/bron.js');
  const kort = 2 * PAGINA + 500;                  // drie pagina's, de laatste afgekapt
  const vlak = (k, c) => new Float32Array(kort).map((_, i) => (c ? -1 : 1) * (0.05 * (k + 1)) + 0.2 * Math.sin(i / (30 + 7 * k + 3 * c)));
  const paren = [0, 1, 2, 3].map((k) => [vlak(k, 0), vlak(k, 1)]);
  const wav8 = maakWavParen(paren, SR), wav4 = maakWavParen(paren.slice(0, 2), SR);
  const p8 = new Int16Array(wav8, 44);
  const berichten = [], nodes = [];
  globalThis.AudioWorkletNode = nepWorkletNode(berichten, nodes);
  const ctx = {
    currentTime: 0, audioWorklet: { addModule: async () => {} },
    createBuffer: (k, len, sr) => { const d = Array.from({ length: k }, () => new Float32Array(len)); return { length: len, sampleRate: sr, duration: len / sr, getChannelData: (c) => d[c] }; },
  };
  const ingangen = [{ naam: 'g0' }, { naam: 'g1' }, { naam: 'g2' }, { naam: 'g3' }];
  const bron = new StreamBron(ctx, ingangen, { interval: 1e9, haal: async () => { throw new Error('mag niet naar het netwerk'); } });
  await bron.laad({ url: 'geheugen:stems8', haal: geheugenHaal(wav8), kanalen: 8 });
  const node = nodes.at(-1);
  ok('de node: vier uitgangen van twee kanalen', node.numberOfOutputs === 4 && node.outputChannelCount.join() === '2,2,2,2' && node.numberOfInputs === 0);
  ok('uitgang k naar ingang k (de stemIn van het deck)', node.verbindingen.length === 4 && node.verbindingen.every((v, k) => v.doel === ingangen[k] && v.uitgang === k));
  ok('kanalen en duur uit de kop (16 bytes per frame)', bron.kanalen === 8 && dichtbij(bron.duur, kort / SR));
  const bronBericht = berichten.find((m) => m.type === 'bron');
  ok('de worklet hoort hoeveel kanalen', bronBericht?.kanalen === 8);
  const pag0 = berichten.find((m) => m.type === 'pagina' && m.i === 0), pag2 = berichten.find((m) => m.type === 'pagina' && m.i === 2);
  ok('een pagina is PAGINA frames × 8 kanalen', pag0?.data.length === PAGINA * 8 && pag0.data[7 * 8 + 5] === p8[7 * 8 + 5]);
  ok('de laatste pagina afgekapt op hele frames', pag2?.data.length === 500 * 8 && pag2.data[499 * 8 + 7] === p8[(2 * PAGINA + 499) * 8 + 7]);
  ok(`geheugen: ${(bron.geheugen / 1e6).toFixed(1)} MB voor drie pagina's van 8 kanalen`, bron.geheugen === (2 * PAGINA + 500) * 16);

  // Knippen voor de sampler: de som van de paren met de gewichten van het deck.
  const w = [0.5, 0, 1.25, 2];
  const stuk = await bron.knip(1, 1.01, w);
  const a0 = Math.round(1 * SR);
  let fout = 0;
  for (let i = 0; i < stuk.length; i++) {
    let l = 0, r = 0;
    for (let k = 0; k < 4; k++) { l += w[k] * p8[(a0 + i) * 8 + 2 * k] / 32768; r += w[k] * p8[(a0 + i) * 8 + 2 * k + 1] / 32768; }
    fout = Math.max(fout, Math.abs(stuk.getChannelData(0)[i] - l), Math.abs(stuk.getChannelData(1)[i] - r));
  }
  ok(`knip met gewichten per paar (zang weg = 0): de gewogen som (afwijking ${fout.toExponential(1)})`, stuk.length === 480 && fout < 1e-6);
  const som = await bron.knip(1, 1.001);
  ok('knip zonder gewichten: elk paar telt voor 1', Math.abs(som.getChannelData(0)[3] - [0, 1, 2, 3].reduce((t, k) => t + p8[(a0 + 3) * 8 + 2 * k] / 32768, 0)) < 1e-6);

  // Verkeerd aantal kanalen: weigeren met een reden, vóór er iets verandert.
  let reden = null;
  await bron.laad({ url: 'geheugen:stems8b', haal: geheugenHaal(wav8), kanalen: 4 }).catch((e) => { reden = e.message; });
  ok(`8 kanalen waar er 4 verwacht worden: geweigerd ("${reden}")`, /8 kanalen/.test(reden || '') && /verwacht 4/.test(reden));
  reden = null;
  await bron.laad({ url: 'geheugen:stems4', haal: geheugenHaal(wav4), kanalen: 2 }).catch((e) => { reden = e.message; });
  ok(`stems.wav zonder stems opgegeven: geweigerd ("${reden}")`, /verwacht stereo/.test(reden || ''));
  reden = null;
  await bron.laad({ url: 'geheugen:stereo', haal: geheugenHaal(maakWav([paren[0][0], paren[0][1]], SR)), kanalen: 8 }).catch((e) => { reden = e.message; });
  ok('een stereobestand waar 4 stems verwacht worden: geweigerd', /2 kanalen/.test(reden || ''));
  await bron.laad({ url: 'geheugen:stems4', haal: geheugenHaal(wav4), kanalen: 4 });
  ok('daarna gewoon twee stems laden: kanalen 4, dezelfde node', bron.kanalen === 4 && nodes.length === 1 && berichten.filter((m) => m.type === 'bron').at(-1).kanalen === 4);
  bron.vernietig();

  // Eén node als uitgang: alle vier uitgangen daarheen (de som).
  const een = { naam: 'som' };
  const b1 = new StreamBron(ctx, een, { interval: 1e9 });
  await b1.laad({ url: 'geheugen:stereo2', haal: geheugenHaal(maakWav([paren[0][0], paren[0][1]], SR)) });
  ok('één node als uitgang: alle vier de uitgangen gaan erheen', nodes.at(-1).verbindingen.length === 4
    && nodes.at(-1).verbindingen.every((v, k) => v.doel === een && v.uitgang === k));
  const st = await b1.knip(1, 1.001);
  ok('stereo knippen zonder gewichten: de samples zelf, zoals altijd', st.getChannelData(0)[5] === new Int16Array(maakWav([paren[0][0], paren[0][1]], SR), 44)[(a0 + 5) * 2] / 32768);
  b1.vernietig();

  // Vervangen onder het spelen: de server zet een nieuwe stems.wav neer (2 -> 4)
  // terwijl dit deck de oude streamt. Elk Range-verzoek opent het bestand
  // opnieuw; de totale grootte in Content-Range verraadt het nieuwe bestand.
  // Dan geen pagina's meer (dat zou ruis zijn), één melding, en wat er al was
  // speelt uit.
  let huidig = wav4;
  const serverHaal = async (_url, init) => {
    const r = await geheugenHaal(huidig)(_url, init);
    const m = /bytes=(\d+)-(\d*)/.exec(init.headers.Range);
    const totaal = huidig.byteLength, eind = Math.min(Number(m[2] || totaal - 1), totaal - 1);
    return new Response(await r.arrayBuffer(), { status: 206, headers: { 'Content-Range': `bytes ${m[1]}-${eind}/${totaal}` } });
  };
  const b2 = new StreamBron(ctx, ingangen, { interval: 1e9, haal: serverHaal });
  const meldingen = [];
  b2.onFout = (t) => meldingen.push(t);
  await b2.laad({ url: '/media/x/stems.wav', kanalen: 4 });
  ok('het totaal uit Content-Range wordt bij de laad onthouden', b2.bestand.totaal === wav4.byteLength && !b2.bestand.vervangen);
  const voor = berichten.filter((m) => m.type === 'pagina').length;
  huidig = wav8;                                   // de server verving het bestand
  b2.geladen.clear();                              // alsof de pagina's weg moesten (verder gesprongen)
  await b2.bijvullen();
  ok('een ander totaal: geen pagina\'s uit het nieuwe bestand', berichten.filter((m) => m.type === 'pagina').length === voor && b2.bestand.vervangen);
  ok(`één melding ("${meldingen[0]}")`, meldingen.length === 1 && /vervangen/.test(meldingen[0]) && /opnieuw/.test(meldingen[0]));
  await b2.bijvullen();
  ok('daarna haalt hij niets meer op en meldt niets meer', meldingen.length === 1 && berichten.filter((m) => m.type === 'pagina').length === voor);
  let knipFout = null;
  await b2.knip(1, 1.01).catch((e) => { knipFout = e.message; });
  ok('knippen uit een vervangen bestand weigert met de reden', /vervangen/.test(knipFout || ''));
  await b2.laad({ url: '/media/x/stems.wav', kanalen: 8 });
  ok('opnieuw laden neemt het nieuwe bestand gewoon', b2.kanalen === 8 && !b2.bestand.vervangen && b2.bestand.totaal === wav8.byteLength);
  b2.vernietig();
}

// ---- opruimen en worklet-fouten (spoor A, 15 okt) -----------------------------------
// Een AudioWorkletNode waarvan process() true blijft geven, wordt nooit opgeruimd
// (met zijn stretchers). Vernietigen stuurt 'stop' en sluit de poort; herladen niet.
// Een processorerror bouwt één keer een nieuwe node op dezelfde plek.
console.log('\nopruimen en worklet-fouten');
{
  let Lezer = null;
  globalThis.sampleRate = 48000;
  globalThis.currentFrame = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage() {}, close() {} }; } };
  globalThis.registerProcessor = (_naam, k) => { Lezer = k; };
  await import('../src/engine/stream-lezer.js?stop');
  const w = new Lezer();
  const zend = (m) => w.port.onmessage({ data: m });
  const blok = () => Array.from({ length: 4 }, () => [new Float32Array(128), new Float32Array(128)]);
  zend({ type: 'bron', duur: 1, sr: 48000 });
  const toon = new Int16Array(PAGINA * 2).map((_, i) => Math.round(8000 * Math.sin(i / 20)));
  zend({ type: 'pagina', i: 0, data: toon });
  zend({ type: 'segment', id: 1, seg: { T: 0, P: 0, R: 1, loop: null, speelt: true, rem: null, rek: null } });
  const b0 = blok();
  ok('worklet: vóór stop geeft process() true (en klinkt)', w.process([], b0) === true && b0[0][0].some((v) => v !== 0));
  zend({ type: 'stop' });
  ok('worklet: na stop geeft process() false, pagina\'s weg, geen berichten meer',
    w.process([], blok()) === false && w.paginas.size === 0 && w.port.onmessage === null && w.rek === null);
  globalThis.currentFrame = 128;
  ok('worklet: en blijft false', w.process([], blok()) === false);
  delete globalThis.registerProcessor; delete globalThis.AudioWorkletProcessor;

  const { maakWav } = K;
  const { StreamBron, geheugenHaal } = await import('../src/engine/bron.js');
  const L = new Float32Array(48000 * 3).map((_, i) => 0.3 * Math.sin(i / 30));
  const wav = maakWav([L, L], 48000);
  const berichten = [], nodes = [];
  globalThis.AudioWorkletNode = nepWorkletNode(berichten, nodes);
  const ctx = { currentTime: 1, sampleRate: 48000, audioWorklet: { addModule: async () => {} } };
  const uit = {};
  const bron = new StreamBron(ctx, uit, { interval: 1e9 });
  await bron.laad({ url: 'geheugen:S:1', haal: geheugenHaal(wav) });
  const node = bron.node;
  const info1 = bron.buffer;
  ok('buffer: één object per geladen bestand, niet per aanroep (afval per beeld, spoor A)',
    info1 && info1 === bron.buffer && info1.stream === true && info1.duration === bron.duur);
  await bron.laad({ url: 'geheugen:S:2', haal: geheugenHaal(wav) });
  ok('… een nieuwe laad: een nieuw object', bron.buffer && bron.buffer !== info1);
  ok('herladen: dezelfde node, geen stop, de poort blijft open',
    bron.node === node && nodes.length === 1 && !berichten.some((m) => m.type === 'stop') && !node.port.dicht && node.port.onmessage);
  bron.vernietig();
  ok('vernietig: eerst leeg, dan stop, de poort dicht, losgekoppeld',
    berichten.at(-1)?.type === 'stop' && berichten.at(-2)?.type === 'bron' && berichten.at(-2).duur === 0
    && node.port.dicht && node.port.onmessage === null && node.verbindingen.length === 0 && bron.node === null);

  // processorerror: één keer opnieuw opbouwen op dezelfde plek, daarna stil met een melding.
  const b2 = new StreamBron(ctx, uit, { interval: 1e9 });
  const meld = [];
  b2.onFout = (t) => meld.push(t);
  await b2.laad({ url: 'geheugen:S:3', haal: geheugenHaal(wav) });
  ctx.currentTime = 2;
  b2.start(0.5);
  const n1 = b2.node, seg1 = b2.seg, voorNodes = nodes.length;
  berichten.length = 0;
  ctx.currentTime = 2.3;
  const h1 = n1.onprocessorerror;                 // een event dat al in de rij stond, komt ook na het losmaken nog
  h1({ message: 'RangeError: nep' });
  const n2 = b2.node;
  ok('processorerror: een nieuwe node, aangesloten; de oude los en dicht',
    n2 && n2 !== n1 && nodes.length === voorNodes + 1 && n2.verbindingen.length === 4 && n1.verbindingen.length === 0 && n1.port.dicht);
  const segNa = berichten.filter((m) => m.type === 'segment').at(-1);
  ok('… met het bestand opnieuw en HETZELFDE segment {T, P, R} (regel 3: hij speelt waar hij nu hoort te zijn)',
    berichten.findIndex((m) => m.type === 'bron') === 0 && berichten[0].duur === b2.duur
    && segNa && segNa.seg.T === seg1.T && segNa.seg.P === seg1.P && segNa.seg.R === seg1.R && segNa.seg.speelt && !segNa.gepland
    && Math.abs(b2.positie - (0.5 + 0.3)) < 1e-9);
  for (let i = 0; i < 20 && !berichten.some((m) => m.type === 'pagina'); i++) await new Promise((r) => setTimeout(r, 0));
  ok('… en de pagina\'s opnieuw naar de nieuwe worklet', berichten.some((m) => m.type === 'pagina') && b2.geladen.size > 0);
  ok(`… met een melding ("${meld[0]}")`, meld.length === 1 && /opnieuw opgebouwd/.test(meld[0]) && /RangeError: nep/.test(meld[0]));
  h1({});
  ok('een late fout van de oude node doet niets', b2.node === n2 && meld.length === 1);
  const h2 = n2.onprocessorerror;
  h2({});
  ok('nog een fout na het opbouwen: geen derde node, stil, en een melding die blijft staan',
    b2.node === null && nodes.length === voorNodes + 1 && meld.length === 2 && /blijft stil/.test(meld[1]) && n2.port.dicht);
  b2.start(1);
  ok('daarna gooit spelen niet (er is geen node)', b2.speelt);
  await b2.laad({ url: 'geheugen:S:4', haal: geheugenHaal(wav) });
  ok('de volgende laad bouwt een nieuwe node (en mag weer één keer opnieuw opbouwen)', b2.node && b2.node !== n2 && b2._herbouwd === false);
  const h3 = b2.node.onprocessorerror;
  b2.vernietig();
  h3({});
  ok('een fout na vernietigen doet niets', meld.length === 2 && b2.node === null);
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
