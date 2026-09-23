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

// ---- onset-pieken en grid-voorstel (stap C) --------------------------------

console.log('\nonset-pieken en grid-voorstel');
const { onsetPieken, maakOnset, maakOnsets, maakGrid, ZEKER_VANAF, GEEN_PULS } = await import('../server/analyze.js');
{
  // Puur: pieken boven de drempel, één per aanzet, de hoogste wint binnen de minimumafstand.
  const env = new Float32Array(200);
  env[10] = 5; env[12] = 3; env[13] = 7; env[50] = 1.5; env[80] = 4; env[81] = 4;
  const t = onsetPieken(env, 100, 0.061, { drempel: 2, minAfstand: 0.05 });
  ok(`lokale maxima boven de drempel, 13 wint van 10 (${[...t].map((x) => x.toFixed(3)).join(' ')})`,
    t.length === 2 && Math.abs(t[0] - (0.13 + 0.061)) < 1e-9 && Math.abs(t[1] - (0.80 + 0.061)) < 1e-9);
  ok('gesorteerd, Float64Array', t instanceof Float64Array && t[0] < t[1]);
}
{
  // Klikspoor op 126 bpm, eerste klik op 0,30 s: 40 s, 48 kHz stereo zoals de ingest levert.
  const wav = join(map, 'klik.wav');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `aevalsrc='if(lt(mod(t-0.3\\,60/126)\\,0.005)*gte(t\\,0.3)\\,0.8*sin(2*PI*900*t)*exp(-mod(t-0.3\\,60/126)*400)\\,0)':s=48000:d=40`,
    '-ac', '2', '-c:a', 'pcm_s16le', wav]);
  const onsetBin = join(map, 'onset.bin');
  const on = await maakOnset(wav, onsetBin);
  ok('envelope gemaakt', on.ok && existsSync(onsetBin));
  const o = await maakOnsets(onsetBin, on.envRate, on.tijdOffset);
  const P = 60 / 126;
  const naast = o.tijden.map((x) => { const k = Math.round((x - 0.3) / P); return x - (0.3 + k * P); }).sort((a, b) => a - b);
  const med = naast[naast.length >> 1], spreid = naast[Math.floor(naast.length * 0.9)] - naast[Math.floor(naast.length * 0.1)];
  // Een scherpe klik valt ~15 ms vroeg (zie piekVertraging); ruim binnen de ±30 ms van "tel 1 hier".
  ok(`klappen op de kliks: ${o.tijden.length} pieken (verwacht ~84), mediaan ${(med * 1000).toFixed(1)} ms, spreiding p10-p90 ${(spreid * 1000).toFixed(1)} ms`,
    o.ok && o.tijden.length >= 78 && o.tijden.length <= 90 && Math.abs(med) < 0.02 && spreid < 0.015);
  const { piekVertraging } = await import('../server/analyze.js');
  const gemeten = await piekVertraging({ meet: true });
  ok(`piekijking klopt nog (vast ${((await piekVertraging()) * 1000).toFixed(1)} ms, gemeten ${(gemeten * 1000).toFixed(1)} ms)`,
    Math.abs(gemeten - await piekVertraging()) < 0.002);
  ok('de tijden zijn gesorteerd', o.tijden.every((x, i) => i === 0 || x > o.tijden[i - 1]));
  const g = await maakGrid(onsetBin, on.envRate, on.tijdOffset, wav);
  const st = g.grid?.stukken ?? [];
  ok(`grid-voorstel: bron auto, niet op slot, zekerheid per stuk (${st.map((x) => `${x.bpm.toFixed(2)} z${x.zekerheid.toFixed(2)}`).join(' | ')})`,
    g.ok && g.grid.bron === 'auto' && g.grid.slot === false && st.length >= 1 && st.every((x) => Number.isFinite(x.zekerheid)));
  const tel = st[0] ? st[0].anker - Math.round((st[0].anker - 0.3) / P) * P : NaN;
  ok(`126 bpm, zeker, de tel op de klik (${((tel - 0.3) * 1000).toFixed(1)} ms)`,
    st.every((x) => Math.abs(x.bpm - 126) < 0.1 && x.zekerheid >= ZEKER_VANAF) && Math.abs(tel - 0.3) < 0.012 && g.grid.zeker === true);
  ok('drempels: zeker boven geen puls, allebei tussen 0 en 1', GEEN_PULS > 0 && GEEN_PULS < ZEKER_VANAF && ZEKER_VANAF < 1);
  const kort = await maakGrid(join(map, 'bestaat-niet.bin'), 86, 0.061, null);
  ok('onleesbare envelope: een fout, geen crash', kort.ok === false && /onleesbaar/.test(kort.fout));
}

// ---- foutpad ---------------------------------------------------------------

const stuk = await maakPeaks(join(map, 'bestaat-niet.wav'), join(map, 'x.bin'));
ok('een onbestaand bestand meldt de fout', stuk.ok === false && stuk.fout.length > 0);

rmSync(map, { recursive: true, force: true });

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
