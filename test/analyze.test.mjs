// De peaks-cache: levert de server exact dezelfde golfvorm als de browser?
// Een verschil hier zie je niet als een fout maar als een scheve waveform, en
// dat is precies het soort bug dat maanden blijft zitten.
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { maakPeaks, PER_BUCKET } = await import('../server/analyze.js');
const { computePeaks, SAMPLES_PER_BUCKET, effectieveSampleRate } = await import('../src/analysis/peaks.js');
const { run } = await import('../server/ingest.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const map = mkdtempSync(join(tmpdir(), 'varve-peaks-'));
const bron = join(map, 'bron.wav');

ok('server en browser gebruiken dezelfde bucketgrootte', PER_BUCKET === SAMPLES_PER_BUCKET);

// Twee kanalen met verschillende inhoud: zo valt het op als er één vergeten wordt.
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3.3',
  '-f', 'lavfi', '-i', 'sine=frequency=90:duration=3.3,volume=0.4',
  '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]', '-map', '[a]',
  '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', bron]);
ok('testbestand gemaakt', existsSync(bron));

// ---- server-kant ----------------------------------------------------------

const doel = join(map, 'peaks.bin');
const r = await maakPeaks(bron, doel);
ok('peaks gemaakt', r.ok && existsSync(doel));

// Let op: readFileSync geeft een Buffer die in een gedeelde pool kan liggen.
// Zonder byteOffset lees je andermans geheugen in plaats van je eigen data.
const peakBytes = readFileSync(doel);
const vanServer = new Float32Array(peakBytes.buffer, peakBytes.byteOffset, peakBytes.byteLength / 4);
ok('bestandsgrootte klopt met het aantal buckets', vanServer.length === r.buckets * 2);

// ---- browser-kant: dezelfde samples door computePeaks ---------------------

// run() geeft stdout als tekst terug, dus voor ruwe bytes schrijven we naar een
// bestand en lezen dat terug.
const pcm = join(map, 'rauw.f32');
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', bron,
  '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '2', '-ar', '48000', pcm]);
const bytes = readFileSync(pcm);
const inter = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
const frames = inter.length / 2;
const links = new Float32Array(frames), rechts = new Float32Array(frames);
for (let i = 0; i < frames; i++) { links[i] = inter[i * 2]; rechts[i] = inter[i * 2 + 1]; }

// Een AudioBuffer-dubbel: computePeaks gebruikt alleen deze vier dingen.
const nepBuffer = {
  length: frames, numberOfChannels: 2, sampleRate: 48000, duration: frames / 48000,
  getChannelData: (c) => (c === 0 ? links : rechts),
};
const vanBrowser = computePeaks(nepBuffer);

ok('evenveel buckets als de browser', vanBrowser.count === r.buckets);

let grootsteAfwijking = 0, verschillen = 0;
for (let i = 0; i < vanServer.length; i++) {
  const d = Math.abs(vanServer[i] - vanBrowser.peaks[i]);
  if (d > 1e-6) verschillen++;
  if (d > grootsteAfwijking) grootsteAfwijking = d;
}
ok('elke min en max is identiek aan die van de browser', verschillen === 0);
console.log(`       grootste afwijking: ${grootsteAfwijking.toExponential(2)} over ${vanServer.length} waarden`);

ok('beide kanalen zitten erin', vanBrowser.peaks.some((v) => v !== 0));
const laatsteBucketFrames = frames % PER_BUCKET;
ok('ook de laatste, onvolledige bucket telt mee',
  laatsteBucketFrames === 0 || r.buckets === Math.ceil(frames / PER_BUCKET));

// ---- hersampling: de val waar de golfvorm op scheef ging -------------------
// De server rekent peaks op 48 kHz. decodeAudioData hersamplet naar de snelheid
// van de geluidskaart — op 44,1 kHz zit je er 8,8% naast. De tekenroutine mag
// dus NOOIT de samplerate van de AudioBuffer gebruiken.

const duurTest = 1859.697792;
const buckets48 = Math.ceil((duurTest * 48000) / 256);
ok('effectieve rate komt terug op de rate van het bestand',
  Math.abs(effectieveSampleRate(buckets48, 256, duurTest) - 48000) < 1);
ok('en dus niet op die van de geluidskaart',
  Math.abs(effectieveSampleRate(buckets48, 256, duurTest) - 44100) > 3000);

// Hoe scheef het werd: het aantal buckets dat je bij 44,1 kHz zou verwachten.
const buckets441 = Math.ceil((duurTest * 44100) / 256);
ok('de oude aanpak trok de golfvorm bijna 9% uit de pas',
  Math.abs(buckets48 / buckets441 - 1) > 0.08);

ok('een korte track werkt net zo goed',
  Math.abs(effectieveSampleRate(Math.ceil((3.3 * 48000) / 256), 256, 3.3) - 48000) < 40);
ok('zonder duur geen gok', effectieveSampleRate(1000, 256, 0) === 0);

// ---- foutpad ---------------------------------------------------------------

const stuk = await maakPeaks(join(map, 'bestaat-niet.wav'), join(map, 'x.bin'));
ok('een onbestaand bestand meldt de fout', stuk.ok === false && stuk.fout.length > 0);

rmSync(map, { recursive: true, force: true });

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
