// Uitzenden, stap 1 (docs/UITZENDEN.md): server/uitzend.js volgt de opname die groeit en
// duwt hem in één ffmpeg naar een bestand, een lokale RTMP-ontvanger of udp op 127.0.0.1 (OBS).
// Nooit een echte dienst: elke ontvanger hier is een ffmpeg op deze machine, elke map een mkdtemp.
//
// Draai met: node test/uitzend.test.mjs                          (P, S en R, ~40 s)
//            VARVE_TEST_ECHTETIJD=1 node test/uitzend.test.mjs   (+ E1-E6 in echte tijd, ~75 s extra)
//
// P = puur (geen ffmpeg), S = met ffmpeg maar sneller dan echte tijd gevoerd, E = echte tijd (H11:
// traag en gevoelig voor load, daarom niet standaard). Een regel '  -- …' is een notitie of een
// check die hier niet kon draaien; alles.mjs telt die als "overgeslagen", nooit stil groen.
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';

const U = await import('../server/uitzend.js');
const O = await import('../server/opname.js');
const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const notitie = (t) => console.log(`  -- ${t}`);
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));

// Vangnet: een hangende ffmpeg mag de hele suite niet laten hangen.
const tijdslimiet = setTimeout(() => { console.log('FAIL  tijdslimiet: de suite duurde langer dan 6 minuten'); U._reset(); process.exit(1); }, 360000);
tijdslimiet.unref();

const heeftFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const encoders = heeftFfmpeg ? spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout : '';
const heeftVT = /h264_videotoolbox/.test(encoders);
const heeftOpus = /libopus/.test(encoders);
const echteTijd = process.env.VARVE_TEST_ECHTETIJD === '1';

const tmp = mkdtempSync(join(tmpdir(), 'varve-uitzend-'));
const opnames = join(tmp, 'opnames');
const uitzendMap = join(tmp, 'uitzend');
const uitMap = join(tmp, 'uit');
mkdirSync(opnames); mkdirSync(uitzendMap); mkdirSync(uitMap);
// Vangnet (review 2, L3): een start zonder uitMap schrijft zo in de tijdelijke map, nooit in ~/Movies/VARVE-uitzend.
process.env.VARVE_UITZEND_UIT = uitMap;
const ontvangers = [];

// ---- hulp ----------------------------------------------------------------------

/** Een vrije poort op 127.0.0.1 (tcp of udp), uit 20000-39999. */
async function vrijePoort(udp = false) {
  for (let i = 0; i < 50; i++) {
    const p = 20000 + Math.floor(Math.random() * 20000);
    const vrij = await new Promise((r) => {
      if (udp) { const s = createSocket('udp4'); s.once('error', () => r(false)); s.bind(p, '127.0.0.1', () => s.close(() => r(true))); }
      else { const s = createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))); }
    });
    if (vrij) return p;
  }
  throw new Error('geen vrije poort');
}

/** Een ffmpeg die luistert of leest (de "kijker" op deze machine). */
function ontvanger(args) {
  const kind = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  kind.stderr.on('data', (b) => { err += b; });
  const klaar = new Promise((r) => kind.on('close', (code) => r({ code, err })));
  ontvangers.push(kind);
  return { kind, klaar };
}

/** Tot `ms` wachten op een ontvanger; daarna SIGINT (dan schrijft ffmpeg zijn bestand netjes af). */
async function wachtOp(o, ms) {
  const r = await Promise.race([o.klaar, wacht(ms).then(() => null)]);
  if (r) return r;
  try { o.kind.kill('SIGINT'); } catch { /* weg */ }
  return Promise.race([o.klaar, wacht(3000).then(() => { try { o.kind.kill('SIGKILL'); } catch { /* weg */ } return { code: 'gedood', err: '' }; })]);
}

const probeJson = (pad) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate:format=duration', '-of', 'json', pad], { encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { return {}; }
};
const stroom = (p, soort) => (p.streams || []).find((s) => s.codec_type === soort) || {};
/** Pakketten van één stroom: [{ pts, dur, key }]. */
function pakketten(pad, sel) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'packet=pts_time,duration_time,flags', '-of', 'csv=p=0', pad], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return (r.stdout || '').trim().split('\n').map((l) => l.split(',')).map(([pts, dur, fl]) => ({ pts: Number(pts), dur: Number(dur) || 0, key: /K/.test(fl || '') }))
    .filter((p) => Number.isFinite(p.pts));
}
/** Hoe lang een stroom echt is: laatste pts + duur - eerste pts. */
const duurVan = (pad, sel) => { const p = pakketten(pad, sel); return p.length ? p.at(-1).pts + p.at(-1).dur - p[0].pts : 0; };
const grootsteKeyAfstand = (pad) => {
  const k = pakketten(pad, 'v:0').filter((p) => p.key).map((p) => p.pts);
  let m = 0; for (let i = 1; i < k.length; i++) m = Math.max(m, k[i] - k[i - 1]);
  return { aantal: k.length, max: m };
};

/** Stilte met één luide stoot van 0,2 s op `op` s (s16le, 48 kHz, stereo): zo zie je waar de golf valt. */
const stootPcm = (sec, op) => spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='if(between(t,${op},${op + 0.2}),0.9*sin(2*PI*440*t),0)':s=48000:d=${sec}`,
  '-ac', '2', '-f', 's16le', '-'], { maxBuffer: 1 << 28 }).stdout;
/**
 * Waar wordt de stoot zichtbaar? De gemiddelde helderheid (YAVG) van een strook van 100 px rond het midden, per
 * beeld: in stilte is de golf daar een streep, bij de stoot een vol vlak (gemeten: zwart 16 -> 88, de plaat 31 -> 51
 * bij 2 fps). Geeft `basis` (de mediaan vóór 2,5 s) en de tijd van het eerste beeld dat er meer dan 8 van afwijkt.
 */
function stootZichtbaar(pad) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-f', 'lavfi', `movie=${pad},crop=1280:100:0:310,signalstats`, '-show_entries', 'frame=pts_time:frame_tags=lavfi.signalstats.YAVG',
    '-of', 'csv=p=0'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const rij = (r.stdout || '').trim().split('\n').map((l) => l.split(',').map(Number)).filter(([t, y]) => Number.isFinite(t) && Number.isFinite(y));
  const voor = rij.filter(([t]) => t < 2.5).map(([, y]) => y).sort((a, b) => a - b);
  if (!voor.length) return { t: null, basis: null, rij };
  const basis = voor[Math.floor(voor.length / 2)];
  return { t: rij.find(([, y]) => Math.abs(y - basis) > 8)?.[0] ?? null, basis, rij };
}

/** PCM zoals de opnemer hem stuurt: s16le, 48 kHz, stereo. */
const pcm = (sec) => spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-ac', '2', '-t', String(sec), '-f', 's16le', '-'],
  { maxBuffer: 1 << 28 }).stdout;

/**
 * Een gefragmenteerde mp4 met de cadans van Clay's Chrome (H2): een keyframe en een fragment per
 * 101 beelden (3,37 s bij 30 fps). Geeft { init, frags: [{ buf, eind }] } met `eind` in seconden.
 * `fps`/`gop` anders: Chrome's fps varieert (29,07 gemeten), en -g telt beelden, geen seconden.
 */
function fmp4(codecA, { fps = 30, gop = 101 } = {}) {
  const buf = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=${fps}`, '-f', 'lavfi', '-i', 'sine=r=48000', '-t', '12',
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-c:a', codecA, '-ac', '2', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-'], { maxBuffer: 1 << 28 }).stdout;
  const bx = U.boxen(buf);
  const moov = bx.find((b) => b.type === 'moov');
  const init = buf.subarray(0, moov.begin + moov.grootte);
  const moofs = bx.filter((b) => b.type === 'moof');
  // ffmpeg zet aan het eind een mfra (index); Chrome's MediaRecorder niet: de fragmenten stoppen ervóór.
  const staart = bx.find((b) => b.type === 'mfra')?.begin ?? buf.length;
  const frags = moofs.map((m, i) => ({ buf: buf.subarray(m.begin, i + 1 < moofs.length ? moofs[i + 1].begin : staart), eind: Math.min(12, ((i + 1) * gop) / fps) }));
  return { buf, init, frags, boxen: bx };
}

/**
 * Een opname voeren zoals de browser: per seconde een stuk op ?frame=N, om de `tussen` ms.
 * Met `video`: elk fragment zodra de WAV voorbij zijn eind + `fragNa` s is (Chrome: timeslice).
 * Na het laatste stuk: wat er nog aan video ligt, dan `sluit` (de route "klaar").
 */
async function voer({ id, pcmBuf, sec, tussen, video, fragNa = 0, elkeSeconde, sluiten = true }) {
  let k = 0;
  for (let i = 0; i < sec; i++) {
    const r = await O.voegToe(opnames, id, pcmBuf.subarray(i * 192000, (i + 1) * 192000), i * 48000);
    if (!r.ok) throw new Error(`voegToe ${i}: ${r.fout}`);
    if (video) while (k < video.frags.length && video.frags[k].eind + fragNa <= i + 1 + 1e-9) await O.voegVideoToe(opnames, id, 'mp4', video.frags[k++].buf);
    await elkeSeconde?.(i + 1);
    await wacht(tussen);
  }
  if (video) while (k < video.frags.length) await O.voegVideoToe(opnames, id, 'mp4', video.frags[k++].buf);
  return sluiten ? O.sluit(opnames, id) : null;
}

let nu = new Date(2026, 9, 10, 13, 0, 0);
const nieuweOpname = async () => { nu = new Date(nu.getTime() + 1000); const s = await O.start(opnames, { nu }); if (!s.ok) throw new Error(s.fout); return s.id; };
const doelenJson = (doelen) => writeFileSync(join(uitzendMap, 'doelen.json'), JSON.stringify({ versie: 1, doelen }, null, 2));
const basis = { opnames, uitzendMap, uitMap };
const eindigtOp = (args, staart) => staart.every((x, i) => args[args.length - staart.length + i] === x);

try {
  // ==== P: puur ====================================================================
  {
    const stil = U.bouwArgs({ naam: 't', soort: 'bestand', bron: 'audio', beeld: 'zwart', fps: 2 }, { uit: '/u/set-x.uitzend.flv' });
    const s = stil.join(' ');
    const GELIJK = 'setpts=PTS-4/(FR*TB),trim=start=0';             // review 1, punt 2: showwaves loopt 4 beelden achter
    ok('P1 stil/zwart fps 2: s16le 48 kHz stereo uit pipe:0, showwaves rate=2, -g 4', s.includes('-f s16le -ar 48000 -ac 2 -i pipe:0') && /showwaves=[^ ]*rate=2/.test(s) && /colors=black/.test(s) && s.includes('-g 4'));
    ok(`P1 zwart: direct na showwaves "${GELIJK}"`, s.includes(`colors=black,${GELIJK},format=yuv420p[v]`));
    ok('P1 geen -re, geen -loop, geen -y (overschrijven kan niet); eindigt op -f flv <uit>', !stil.includes('-re') && !stil.includes('-loop') && !stil.includes('-y') && stil.includes('-n') && eindigtOp(stil, ['-f', 'flv', '/u/set-x.uitzend.flv']));
    const golf = U.bouwArgs({ naam: 't', soort: 'bestand', bron: 'audio', beeld: 'golf', fps: 15 }, { uit: 'u.flv' }).join(' ');
    ok('P2 stil/golf fps 15: rate=15, mode=cline, -g 30, en de golf gelijk met het geluid', /showwaves=[^ ]*rate=15/.test(golf) && golf.includes('mode=cline') && golf.includes('-g 30')
      && golf.includes(`colors=white,${GELIJK},format=yuv420p[v]`));
    const png = U.bouwArgs({ naam: 't', soort: 'bestand', bron: 'audio', beeld: 'plaat-donker.png', fps: 2 }, { uit: 'u.flv' }).join(' ');
    ok('P3 stil/png: movie=beelden/<naam>.png met de golf erover (draw=full: review 2, L1), ook gelijk met het geluid', png.includes('movie=beelden/plaat-donker.png') && png.includes('overlay=shortest=1')
      && png.includes(`colors=white@0.5:draw=full,${GELIJK}[w]`));
    const her = U.bouwArgs({ naam: 't', soort: 'bestand', bron: 'video', video: 'hercodeer', bitrate: '2500k' }, { uit: 'u.flv' });
    const hs = her.join(' ');
    ok('P4 beeld/hercodeer: -hwaccel videotoolbox, h264_videotoolbox, -g 60, geluid -c:a copy, nergens aac als encoder',
      hs.includes('-hwaccel videotoolbox') && hs.includes('-c:v h264_videotoolbox') && hs.includes('-g 60') && hs.includes('-c:a copy') && !/-c:a aac/.test(hs) && hs.includes('-bufsize 5000k'));
    const fk = her.indexOf('-force_key_frames');
    ok('P4 een keyframe op elke 2 s in SECONDEN (-force_key_frames expr:gte(t,n_forced*2), één argv-element): -g telt beelden', fk > 0 && her[fk + 1] === 'expr:gte(t,n_forced*2)');
    const kop = U.bouwArgs({ naam: 't', soort: 'bestand', bron: 'video', video: 'kopie' }, { uit: 'u.flv' }).join(' ');
    ok('P5 beeld/kopie: -c copy', kop.includes('-map 0:v:0 -map 0:a:0 -c copy'));
    const rt = U.bouwArgs({ naam: 't', soort: 'rtmp', bron: 'audio', url: 'rtmp://127.0.0.1:1935/live/test' }, { uit: 'rtmp://127.0.0.1:1935/live/test' });
    const ud = U.bouwArgs({ naam: 't', soort: 'udp', bron: 'audio', url: 'udp://127.0.0.1:25595?pkt_size=1316' }, { uit: 'udp://127.0.0.1:25595?pkt_size=1316' });
    ok('P6 rtmp: -f flv -flvflags no_duration_filesize <url>, geen -y; udp: -f mpegts <url>?pkt_size=1316',
      eindigtOp(rt, ['-f', 'flv', '-flvflags', 'no_duration_filesize', 'rtmp://127.0.0.1:1935/live/test']) && !rt.includes('-y')
      && eindigtOp(ud, ['-f', 'mpegts', 'udp://127.0.0.1:25595?pkt_size=1316']) && ud.at(-1).endsWith('?pkt_size=1316'));

    const pad = (n) => join('/u', `set-X.uitzend${n}.flv`);
    ok('P7 uitgangsPad: niets bestaat -> set-X.uitzend.flv', U.uitgangsPad('/u', 'X', () => false) === pad(''));
    ok('P7 de eerste bestaat -> -2 (H8: nooit overschrijven)', U.uitgangsPad('/u', 'X', (p) => p === pad('')) === pad('-2'));
    ok('P7 twee bestaan -> -3; ook een losse .mp4 telt als bezet', U.uitgangsPad('/u', 'X', (p) => p === pad('') || p === pad('-2').replace(/flv$/, 'mp4')) === pad('-3'));

    ok('P8 maskeer: rtmp://host/app/<sleutel> -> ****', !U.maskeer('rtmp://a.example/live2/geheim123').includes('geheim123') && U.maskeer('rtmp://a.example/live2/geheim123').includes('rtmp://a.example/live2/'));
    ok('P8 maskeer: ?key=… en user:pw@ weg', !U.maskeer('srt://x:9000?key=abc&b=1').includes('abc') && !U.maskeer('rtmp://u:pw@h/x').includes('pw'));
    const zonderPad = U.maskeer('rtmp://u:pw@127.0.0.1:1935/live/test?key=abc', { pad: false });
    ok(`P8 maskeer met pad: false laat het pad staan, niet de gebruiker of ?key= ("${zonderPad}")`, zonderPad.includes('/live/test') && !zonderPad.includes('pw') && !zonderPad.includes('abc'));

    // P9: het lokaal-slot (G3, H12, W3)
    const t = (soort, url) => U.toegestaan({ naam: 't', soort, bron: 'audio', url });
    const open = [['bestand', undefined], ['rtmp', 'rtmp://127.0.0.1:1935/x'], ['rtmp', 'rtmp://[::1]/x'], ['udp', 'udp://127.0.0.1:25595?pkt_size=1316']];
    const dicht = [['rtmp', 'rtmp://a.rtmp.youtube.com/live2'], ['rtmp', 'rtmps://127.0.0.1/x'], ['rtmp', 'rtmp://user:pw@127.0.0.1/x'], ['rtmp', 'rtmp://localhost/x'],
      ['rtmp', 'rtmp://LOCALHOST/x'], ['rtmp', 'rtmp://127.1/x'], ['rtmp', 'rtmp://127.0.0.1.nip.io/x'], ['rtmp', 'rtmp://0x7f.1/x'], ['udp', 'udp://192.168.1.5:1234'],
      ['udp', 'udp://127.0.0.1:80'], ['whip', 'https://127.0.0.1/whip'], ['icecast', 'icecast://127.0.0.1:8000/x']];
    ok(`P9 slot open voor ${open.length} lokale doelen (bestand, 127.0.0.1, [::1], udp ≥ 1024)`, open.every(([s, u]) => t(s, u).ok));
    const fout = dicht.filter(([s, u]) => { const r = t(s, u); return r.ok || !/U1/.test(r.fout); });
    ok(`P9 slot dicht met "U1" in de fout voor ${dicht.length} andere${fout.length ? ` (open: ${fout.map((x) => x[1]).join(' ')})` : ''}`, !fout.length);
    const spatie = t('rtmp', ' rtmp://127.0.0.1/x'), tab = t('rtmp', 'rtmp://127.0.0.1/x\t');
    ok('P9 niet genormaliseerd (spatie vooraan, tab achteraan) -> dicht met "niet genormaliseerd"', !spatie.ok && /niet genormaliseerd/.test(spatie.fout) && !tab.ok && /niet genormaliseerd/.test(tab.fout));
    const lokaal = t('rtmp', ' rtmp://127.0.0.1:1935/live/test'), ver = t('rtmp', ' rtmp://a.example/live2/geheim123');
    ok(`P9 de fout bij een lokale url toont het pad letterlijk ("${lokaal.fout}"), bij een andere niet`,
      /schrijf hem precies zo: rtmp:\/\/127\.0\.0\.1:1935\/live\/test$/.test(lokaal.fout || '') && /niet genormaliseerd/.test(ver.fout || '') && !(ver.fout || '').includes('geheim123'));
    ok('P9 G8: een lokaal beeld-doel mag (v1: alles is lokaal), een niet-lokaal beeld-doel niet',
      U.toegestaan({ soort: 'udp', bron: 'video', url: 'udp://127.0.0.1:25596?pkt_size=1316' }).ok && !U.toegestaan({ soort: 'rtmp', bron: 'video', url: 'rtmp://a.rtmp.youtube.com/live2' }).ok);

    // P10: doelen van schijf (G2, G7)
    const leeg = mkdtempSync(join(tmpdir(), 'varve-uitzend-doelen-'));
    const zonder = await U.laadDoelen(leeg);
    ok('P10 geen doelen.json -> de twee ingebouwde: proef en proef-alles-thuis', zonder.ok && zonder.doelen.map((d) => d.naam).join() === 'proef,proef-alles-thuis' && !zonder.fouten.length);
    ok('P10 proef-alles-thuis draagt de waarschuwing I78 (deck-clips van anderen)', /I78/.test(zonder.doelen[1].waarschuwing || ''));
    writeFileSync(join(leeg, 'doelen.json'), '{ kapot');
    const kapot = await U.laadDoelen(leeg);
    ok('P10 kapotte JSON -> één fout plus de ingebouwde', kapot.fouten.length === 1 && kapot.doelen.length === 2);
    writeFileSync(join(leeg, 'doelen.json'), JSON.stringify({ versie: 1, doelen: [
      { naam: 'goed', soort: 'rtmp', bron: 'audio', url: 'rtmp://127.0.0.1:1935/live/test' },
      { naam: 'met-sleutel', soort: 'rtmp', bron: 'audio', url: 'rtmp://127.0.0.1/live', sleutelBestand: '~/.sleutel' },
      { naam: '../x', soort: 'bestand', bron: 'audio' },
      { naam: 'snel', soort: 'bestand', bron: 'audio', fps: 60 },
      { naam: 'raar', soort: 'bestand', bron: 'audio', kleur: 'rood' },
      { naam: 'pad1', soort: 'bestand', bron: 'audio', beeld: '../x.png' },
      { naam: 'pad2', soort: 'bestand', bron: 'audio', beeld: 'a/b.png' },
      { naam: 'yt', soort: 'rtmp', bron: 'audio', url: 'rtmp://a.rtmp.youtube.com/live2' },
      { naam: 'copy', soort: 'bestand', bron: 'video', video: 'copy' },
    ] }));
    const gemengd = await U.laadDoelen(leeg);
    const tekst = JSON.stringify(gemengd);
    ok('P10 alleen het geldige doel blijft; acht fouten (sleutel, naam, fps 60, onbekend veld, twee png-paden, youtube, video copy)', gemengd.doelen.length === 1 && gemengd.doelen[0].naam === 'goed' && gemengd.fouten.length === 8);
    ok('P10 de fout bij video "copy" noemt dat kopie alleen lokaal bestaat', /kopie bestaat alleen voor lokale proeven/.test(gemengd.fouten.find((f) => /copy/.test(f)) || ''));
    ok('P10 nergens een url of sleutel in het antwoord (de browser kent alleen namen)', !/rtmp:|"url"|sleutel"/.test(tekst.replace(/"fouten":\[.*\]/, '')));
    ok('P10 de fouten zeggen waarom (G7 sleutel, onbekend veld, U1)', /sleutel/.test(gemengd.fouten.join()) && /onbekend veld "kleur"/.test(gemengd.fouten.join()) && /U1/.test(gemengd.fouten.join()));
    // Het voorbeeld in git moet zelf geldig zijn, anders leert het Clay iets wat niet werkt.
    writeFileSync(join(leeg, 'doelen.json'), readFileSync(new URL('../uitzend/doelen.voorbeeld.json', import.meta.url)));
    const vb = await U.laadDoelen(leeg);
    ok(`P10 uitzend/doelen.voorbeeld.json laadt zonder fouten (${vb.doelen.map((d) => d.naam).join(', ')}); geen kopie, geen sleutel`,
      vb.doelen.length === 5 && !vb.fouten.length && vb.doelen.every((d) => d.video !== 'kopie'));
    rmSync(leeg, { recursive: true, force: true });

    if (heeftFfmpeg) {
      const m = fmp4('aac');
      const bx = m.boxen;
      const som = bx.reduce((a, b) => a + b.grootte, 0);
      const rest = bx.slice(2).map((b) => b.type).filter((t2, i, a) => !(t2 === 'mfra' && i === a.length - 1));
      ok(`P11 boxen: ftyp, moov, dan afwisselend moof/mdat (${m.frags.length} fragmenten, ffmpeg's mfra achteraan), som = bufferlengte`,
        bx[0].type === 'ftyp' && bx[1].type === 'moov' && rest.length >= 4 && rest.every((t2, i) => t2 === (i % 2 ? 'mdat' : 'moof')) && som === m.buf.length);
      ok('P12 audioCodecVanMp4: AAC-fmp4 -> mp4a', U.audioCodecVanMp4(m.buf.subarray(0, 65536)) === 'mp4a');
      if (heeftOpus) ok('P12 audioCodecVanMp4: Opus-fmp4 -> Opus', U.audioCodecVanMp4(fmp4('libopus').buf.subarray(0, 65536)) === 'Opus');
      else notitie('P12 Opus: geen libopus in deze ffmpeg');
    } else notitie('P11-P12: geen ffmpeg');
    ok('P12 100 willekeurige bytes -> null', U.audioCodecVanMp4(Buffer.from(Array.from({ length: 100 }, (_, i) => (i * 37 + 11) & 255))) === null);

    ok('P13 iCloudWaarschuwing: opnames op het iCloud-Bureaublad -> tekst met iCloud', /iCloud/.test(U.iCloudWaarschuwing('/Users/x/Desktop/1. Projects/Youtube mixer/opnames', '/Users/x', () => true) || ''));
    ok('P13 zonder iCloud Drive voor het Bureaublad -> null; ~/Movies -> null',
      U.iCloudWaarschuwing('/Users/x/Desktop/1. Projects/Youtube mixer/opnames', '/Users/x', () => false) === null && U.iCloudWaarschuwing('/Users/x/Movies/opnames', '/Users/x', () => true) === null);
    ok('P13 /Users/x/Desktopje telt niet als Bureaublad', U.iCloudWaarschuwing('/Users/x/Desktopje/opnames', '/Users/x', () => true) === null);

    // G1 als test: de module leest alleen node:* en kopVan/ID uit opname.js.
    const bron = readFileSync(new URL('../server/uitzend.js', import.meta.url), 'utf8');
    const code = bron.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // zonder commentaar
    const imports = [...bron.matchAll(/^import .* from '([^']+)';$/gm)].map((x) => x[1]);
    ok(`G1 uitzend.js importeert alleen node:* en ./opname.js (${imports.join(', ')})`, imports.every((i) => i.startsWith('node:') || i === './opname.js') && /import \{ kopVan, ID \} from '\.\/opname\.js'/.test(bron));
    ok('G1/G6 geen media/, library.db of SIGTERM in de code van de module', !/media\/|library\.db|SIGTERM/.test(code));
  }

  // ==== S: met ffmpeg, sneller dan echte tijd ======================================
  if (!heeftFfmpeg) notitie('S14-S26: geen ffmpeg');
  else {
    const p6 = pcm(6), p12 = pcm(12);
    const rtmpPoort = await vrijePoort(), udpPoort = await vrijePoort(true), kopiePoort = await vrijePoort();
    const testDoelen = [
      { naam: 'proef', soort: 'bestand', bron: 'audio', beeld: 'zwart', fps: 2 },
      { naam: 'golf', soort: 'bestand', bron: 'audio', beeld: 'golf', fps: 2 },
      { naam: 'golf10', soort: 'bestand', bron: 'audio', beeld: 'golf', fps: 10 },
      { naam: 'plaat', soort: 'bestand', bron: 'audio', beeld: 'plaat-donker.png', fps: 2 },
      { naam: 'plaat10', soort: 'bestand', bron: 'audio', beeld: 'plaat-donker.png', fps: 10 },
      { naam: 'rtmp-test', soort: 'rtmp', bron: 'audio', beeld: 'golf', url: `rtmp://127.0.0.1:${rtmpPoort}/live/test` },
      { naam: 'udp-test', soort: 'udp', bron: 'audio', url: `udp://127.0.0.1:${udpPoort}?pkt_size=1316` },
      { naam: 'beeld', soort: 'bestand', bron: 'video' },
      { naam: 'beeld-rtmp', soort: 'rtmp', bron: 'video', url: `rtmp://127.0.0.1:${rtmpPoort}/live/test` },
      { naam: 'kopie-rtmp', soort: 'rtmp', bron: 'video', video: 'kopie', url: `rtmp://127.0.0.1:${kopiePoort}/live/test` },
    ];
    doelenJson(testDoelen);
    const geladen = await U.laadDoelen(uitzendMap);
    ok(`S doelen.json van de test: ${testDoelen.length} doelen, 0 fouten, geen url naar de browser`, geladen.doelen.length === testDoelen.length && !geladen.fouten.length && !JSON.stringify(geladen).includes('rtmp://'));

    // S14: stil -> bestand, 6 s, met remux naar mp4 (W6)
    {
      const id = await nieuweOpname();
      const s = await U.start({ id, doel: 'proef', url: 'rtmp://a.rtmp.youtube.com/live2/x', door: 'localhost:8777' }, basis);
      ok('S14 start stil -> bestand: ok, uitgang in uitMap (buiten opnames/), een url in de body wordt genegeerd (G2)', s.ok && s.soort === 'bestand' && s.uit?.startsWith(uitMap) && s.uit.endsWith(`set-${id}.uitzend.flv`));
      ok('S14 stand: bezig, door = de Host van de start (H16), ffmpeg loopt', U.stand().bezig && U.stand().door === 'localhost:8777' && U.stand().ffmpeg === 'loopt');
      const t0 = Date.now();
      const sl = await voer({ id, pcmBuf: p6, sec: 6, tussen: 250 });
      const k = await U.opnameKlaar(id);
      const st = U.stand();
      ok(`S14 opname dicht (${r2(sl.duur)} s) en opnameKlaar ok; ffmpeg 'uit', niet meer bezig (${((Date.now() - t0) / 1000).toFixed(1)} s)`, sl.ok && sl.duur === 6 && k.ok && st.ffmpeg === 'uit' && !st.bezig);
      ok('S14 flv bestaat nog (niets verwijderen) en de mp4 staat ernaast (W6)', existsSync(st.uit?.flv || '/x') && st.uit?.mp4?.endsWith('.uitzend.mp4') && existsSync(st.uit.mp4));
      const p = probeJson(st.uit.mp4 || '/x');
      const ad = duurVan(st.uit.mp4, 'a:0');
      ok(`S14 mp4: h264 1280x720 + aac 48000, geluid ${r2(ad)} s (6 ± 0,3)`, stroom(p, 'video').codec_name === 'h264' && stroom(p, 'video').width === 1280 && stroom(p, 'video').height === 720
        && stroom(p, 'audio').codec_name === 'aac' && stroom(p, 'audio').sample_rate === '48000' && Math.abs(ad - 6) <= 0.3);
      ok('S14 geen uitzendbestand in opnames/ (G9)', !readdirSync(opnames).some((n) => /uitzend/.test(n)));
      // Nog een keer dezelfde opname: een vrije naam, niets overschreven (H8)
      const id2 = id;
      const s2 = await U.start({ id: id2, doel: 'proef' }, basis);
      ok('S14 dezelfde opname nog eens -> set-<id>.uitzend-2.flv (H8)', s2.ok && s2.uit.endsWith(`set-${id}.uitzend-2.flv`));
      await U.stop();
    }

    // S15: stil -> lokale RTMP-ontvanger (hetzelfde pad als een dienst, nooit een dienst)
    {
      const id = await nieuweOpname();
      const uit = join(tmp, 'rtmp-ontvangen.flv');
      const o = ontvanger(['-listen', '1', '-timeout', '15', '-i', `rtmp://127.0.0.1:${rtmpPoort}/live/test`, '-c', 'copy', uit]);
      await wacht(1000);
      const s = await U.start({ id, doel: 'rtmp-test' }, basis);
      ok('S15 start stil -> rtmp://127.0.0.1 ok; geen url in stand()', s.ok && s.soort === 'rtmp' && !JSON.stringify(U.stand()).includes('rtmp://'));
      await voer({ id, pcmBuf: p6, sec: 6, tussen: 250 });
      await U.opnameKlaar(id);
      const r = await wachtOp(o, 8000);
      const p = probeJson(uit);
      const ad = duurVan(uit, 'a:0');
      // "Error during demuxing: Input/output error" aan het eind van de ontvanger is normaal: de zender hangt op.
      const rest = r.err.trim().split('\n').filter((l) => l && !/Input\/output error/.test(l)).pop();
      ok(`S15 ontvangen: h264 + aac, geluid ${r2(ad)} s (6 ± 0,3)${rest ? ` [ontvanger: ${rest}]` : ''}`,stroom(p, 'video').codec_name === 'h264' && stroom(p, 'audio').codec_name === 'aac' && Math.abs(ad - 6) <= 0.3);
    }

    // S16: stil -> udp (OBS-route, W3)
    {
      const id = await nieuweOpname();
      const uit = join(tmp, 'udp-ontvangen.ts');
      const o = ontvanger(['-i', `udp://127.0.0.1:${udpPoort}?timeout=3000000`, '-c', 'copy', uit]);   // stopt 3 s na het laatste pakket
      await wacht(700);
      const s = await U.start({ id, doel: 'udp-test' }, basis);
      await voer({ id, pcmBuf: p6, sec: 6, tussen: 250 });
      await U.opnameKlaar(id);
      await wachtOp(o, 9000);
      const p = probeJson(uit);
      const ad = duurVan(uit, 'a:0');
      ok(`S16 udp://127.0.0.1 (mpegts): ontvangen h264 + aac, geluid ${r2(ad)} s (6 ± 0,5; udp kan het begin missen)`, s.ok && stroom(p, 'video').codec_name === 'h264' && stroom(p, 'audio').codec_name === 'aac' && Math.abs(ad - 6) <= 0.5);
    }

    // S17: midden in de set aan (begint bij het eind, niet bij het begin)
    {
      const id = await nieuweOpname();
      let s;
      await voer({ id, pcmBuf: p6, sec: 6, tussen: 250, sluiten: false, elkeSeconde: async (n) => { if (n === 3) s = await U.start({ id, doel: 'proef' }, basis); } });
      await O.sluit(opnames, id);
      await U.opnameKlaar(id);
      const ad = duurVan(U.stand().uit?.mp4 || '/x', 'a:0');
      ok(`S17 start na 3 van de 6 s: ontvangen geluid ${r2(ad)} s (3 ± 0,6)`, s?.ok && Math.abs(ad - 3) <= 0.6);
    }

    // S18-S19: beeld (de mp4 van de video-opname) met Chrome's cadans
    const vAac = fmp4('aac');
    if (!heeftVT) notitie('S18: geen h264_videotoolbox in deze ffmpeg');
    else {
      const id = await nieuweOpname();
      await O.voegVideoToe(opnames, id, 'mp4', vAac.init);
      const s = await U.start({ id, doel: 'beeld' }, basis);
      ok('S18 start beeld/hercodeer -> bestand: ok, met de I78-waarschuwing (G8)', s.ok && s.bron === 'video' && s.waarschuwingen.some((w) => /I78/.test(w)));
      await voer({ id, pcmBuf: p12, sec: 12, tussen: 250, video: vAac });
      await U.opnameKlaar(id);
      const st = U.stand();
      const vd = duurVan(st.uit?.mp4 || '/x', 'v:0'), kf = grootsteKeyAfstand(st.uit?.mp4 || '/x');
      ok(`S18 mp4 speelbaar: beeld ${r2(vd)} s (12 ± 0,6), ${kf.aantal} keyframes, grootste afstand ${r2(kf.max)} s (≤ 2,05)`, Math.abs(vd - 12) <= 0.6 && kf.aantal >= 5 && kf.max <= 2.05);
      ok(`S18 achterstandTekst noemt de cadans van Chrome ("${st.achterstandTekst}")`, /beeld komt per 3,4 s/.test(st.achterstandTekst));
      // Review 1, punt 3: Chrome's fps varieert (29,07 gemeten) en -g telt beelden. Op 25 fps gaf -g 60 alleen 2,4 s.
      const v25 = fmp4('aac', { fps: 25, gop: 85 });
      const id25 = await nieuweOpname();
      await O.voegVideoToe(opnames, id25, 'mp4', v25.init);
      const s25 = await U.start({ id: id25, doel: 'beeld' }, basis);
      await voer({ id: id25, pcmBuf: p12, sec: 12, tussen: 200, video: v25 });
      await U.opnameKlaar(id25);
      const kf25 = grootsteKeyAfstand(U.stand().uit?.mp4 || '/x');
      ok(`S18 ook op 25 fps (keyframe per 85 beelden): ${kf25.aantal} keyframes, grootste afstand ${r2(kf25.max)} s (≤ 2,05; met alleen -g 60: 2,4)`, s25.ok && kf25.aantal >= 6 && kf25.max <= 2.05);
    }
    {
      const id = await nieuweOpname();
      const uit = join(tmp, 'kopie-ontvangen.flv');
      const o = ontvanger(['-listen', '1', '-timeout', '15', '-i', `rtmp://127.0.0.1:${kopiePoort}/live/test`, '-c', 'copy', uit]);
      await wacht(1000);
      await O.voegVideoToe(opnames, id, 'mp4', vAac.init);
      const s = await U.start({ id, doel: 'kopie-rtmp' }, basis);
      await voer({ id, pcmBuf: p12, sec: 12, tussen: 250, video: vAac });
      await U.opnameKlaar(id);
      await wachtOp(o, 8000);
      const vd = duurVan(uit, 'v:0');
      ok(`S19 beeld/kopie -> lokale rtmp: ontvangen ${r2(vd)} s (12 ± 0,6)`, s.ok && Math.abs(vd - 12) <= 0.6);
    }

    // S20: Opus in de mp4 (H5)
    if (!heeftOpus) notitie('S20: geen libopus in deze ffmpeg');
    else {
      const vOpus = fmp4('libopus');
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      await O.voegVideoToe(opnames, id, 'mp4', vOpus.init);
      const r = await U.start({ id, doel: 'beeld-rtmp' }, { ...basis, wachtMp4: 1000 });
      ok(`S20 Opus + rtmp -> geweigerd met "Opus" (${r.fout})`, !r.ok && /Opus/.test(r.fout || ''));
      const b = await U.start({ id, doel: 'beeld' }, { ...basis, wachtMp4: 1000 });
      ok('S20 Opus + bestand -> mag, met een waarschuwing over Opus', b.ok && b.waarschuwingen.some((w) => /Opus/.test(w)));
      U._reset();
    }

    // S21: de opname merkt niets van een uitzending (G4)
    {
      const a = await nieuweOpname(), b = await nieuweOpname();
      await voer({ id: a, pcmBuf: p6, sec: 6, tussen: 0 });
      await U.start({ id: b, doel: 'proef' }, basis);
      await voer({ id: b, pcmBuf: p6, sec: 6, tussen: 250 });
      await U.opnameKlaar(b);
      const da = readFileSync(join(opnames, `set-${a}.wav`)), db = readFileSync(join(opnames, `set-${b}.wav`));
      ok('S21 WAV met en zonder uitzending: dezelfde bytes vanaf de kop (G4)', Buffer.compare(da.subarray(80), db.subarray(80)) === 0 && da.length === db.length);
    }

    // S22: ffmpeg sterft midden in een opname: de opname loopt door
    {
      const id = await nieuweOpname();
      const s = await U.start({ id, doel: 'proef' }, basis);
      let pid = null;
      const sl = await voer({ id, pcmBuf: p6, sec: 6, tussen: 300, elkeSeconde: async (n) => { if (n === 2) { pid = U._pid(); process.kill(pid, 'SIGKILL'); await wacht(400); } } });
      const st = U.stand();
      ok(`S22 ffmpeg gedood na 2 s: stand ffmpeg 'weg', fout gezet ("${st.fout}")`, s.ok && pid && st.ffmpeg === 'weg' && !!st.fout);
      ok(`S22 de opname liep door: sluit geeft duur ${sl.duur} (6), geen EPIPE-crash`, sl.ok && sl.duur === 6);
      await wacht(300);
      ok('S22 daarna niet meer bezig', !U.stand().bezig);
    }

    // S23: ffmpeg start niet (H14); een uitzendmap die nog niet bestaat wordt gemaakt
    {
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      const nieuw = join(tmp, 'bestaat-nog-niet', 'uitzend');
      const t0 = Date.now();
      const r = await U.start({ id, doel: 'proef' }, { ...basis, uitzendMap: nieuw, ffmpeg: '/bestaat/niet' });
      await wacht(Math.max(0, 1000 - (Date.now() - t0)));
      ok(`S23 ffmpeg '/bestaat/niet' -> ok:false of ffmpeg 'weg' binnen 1 s (${r.fout || U.stand().ffmpeg})`, (!r.ok && /ENOENT|start niet/.test(r.fout)) || U.stand().ffmpeg === 'weg');
      ok('S23 de uitzendmap is gemaakt (cwd van het kind)', existsSync(nieuw));
      ok('S23 niet bezig; een volgende start kan', !U.stand().bezig);
    }

    // S24: stoppen (G6)
    {
      const id = await nieuweOpname();
      await U.start({ id, doel: 'proef' }, basis);
      await voer({ id, pcmBuf: p6, sec: 2, tussen: 400, sluiten: false });
      const pid = U._pid();
      const t0 = Date.now();
      const r = await U.stop();
      const totaal = (Date.now() - t0) / 1000;
      let weg = false; try { process.kill(pid, 0); } catch (e) { weg = e.code === 'ESRCH'; }
      ok(`S24 stop(): kind weg na ${r2(r.stopS)} s (≤ 3,5), met remux ${r2(totaal)} s; pid ESRCH; niet bezig`, r.ok && r.stopS <= 3.5 && weg && !U.stand().bezig && existsSync(r.uit?.mp4 || '/x'));
      ok('S24 tweemaal stop() geeft ok', (await U.stop()).ok);
      await O.sluit(opnames, id);
      const id2 = await nieuweOpname();
      await U.start({ id: id2, doel: 'proef' }, basis);
      await voer({ id: id2, pcmBuf: p6, sec: 1, tussen: 200, sluiten: false });
      const pid2 = U._pid();
      process.kill(pid2, 'SIGSTOP');
      const t1 = Date.now();
      const r3 = await U.stop({ snel: true });
      const d = (Date.now() - t1) / 1000;
      let weg2 = false; try { process.kill(pid2, 0); } catch (e) { weg2 = e.code === 'ESRCH'; }
      ok(`S24 stop({ snel: true }) op een hangend kind (SIGSTOP): ${r2(d)} s (≤ 3,5), pid weg, nooit SIGTERM`, r3.ok && d <= 3.5 && weg2);
      ok('S24 snel stoppen maakt geen mp4 maar zegt hoe het wel kan', U.stand().waarschuwingen.some((w) => /mp4 niet gemaakt/.test(w)));
      await O.sluit(opnames, id2);
    }

    // S25: weigeringen
    {
      const geen = await U.start({ id: '20991231-235959', doel: 'proef' }, basis);
      ok(`S25 zonder opname -> "${geen.fout}" (G5)`, !geen.ok && /geen opname/.test(geen.fout));
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      const onb = await U.start({ id, doel: 'youtube' }, basis);
      ok('S25 onbekend doel -> ok:false', !onb.ok && /onbekend doel/.test(onb.fout));
      const pad = await U.start({ id: '../../etc', doel: 'proef' }, basis);
      ok('S25 id ../../etc -> ok:false (G1)', !pad.ok && /id/.test(pad.fout));
      const zv = await U.start({ id, doel: 'beeld' }, { ...basis, wachtMp4: 300 });
      ok(`S25 beeld-doel zonder mp4 (wachtMp4 300) -> "${zv.fout}"`, !zv.ok && /geen videobestand/.test(zv.fout));
      const lang = await nieuweOpname();
      await voer({ id: lang, pcmBuf: p12, sec: 11, tussen: 0, sluiten: false });
      await O.voegVideoToe(opnames, lang, 'mp4', vAac.init);
      const laat = await U.start({ id: lang, doel: 'beeld' }, basis);
      ok('S25 beeld-doel bij bronS > 10 s -> ok:false (v1: video start samen met de opname)', !laat.ok && /10 s/.test(laat.fout));
      // Review 1, punt 4: de browser kiest webm, en het eerste videostuk komt pas na de start (start samen met de opname).
      const wId = await nieuweOpname();
      const tW = Date.now();
      const wP = U.start({ id: wId, doel: 'beeld' }, { ...basis, wachtMp4: 3000 });
      await wacht(300);
      await O.voegVideoToe(opnames, wId, 'webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      const w = await wP;
      const dW = (Date.now() - tW) / 1000;
      ok(`S25 webm komt ná de start (0,3 s): "${w.fout}" na ${r2(dW)} s (≤ 1; niet de hele wachtMp4 van 3 s)`, !w.ok && /webm/.test(w.fout || '') && dW <= 1);
      const een = await U.start({ id, doel: 'proef', door: 'a' }, basis);
      const twee = await U.start({ id, doel: 'proef' }, basis);
      ok('S25 tweede start -> "er loopt al een uitzending"; door blijft "a"', een.ok && !twee.ok && twee.fout === 'er loopt al een uitzending' && U.stand().door === 'a');
      U._reset();
    }

    // S26: bron stil (tabblad dicht of hangt)
    {
      const id = await nieuweOpname();
      const s = await U.start({ id, doel: 'udp-test' }, { ...basis, stilNa: 500, stopNa: 1200, pollMs: 100 });
      await voer({ id, pcmBuf: p6, sec: 2, tussen: 100, sluiten: false });
      const t0 = Date.now();
      await wacht(800);
      const f = U.stand().fout;
      await wacht(Math.max(0, 1500 - (Date.now() - t0)));
      ok(`S26 na 0,8 s zonder groei: fout "${f}"; na 1,5 s niet meer bezig (${U.stand().bezig ? 'nog bezig' : 'gestopt'})`, s.ok && f === 'bron stil' && !U.stand().bezig);
      await O.sluit(opnames, id);
    }

    // S27: de golf valt op het geluid (review 1, punt 2). Een stoot op 3,0 s moet op 3,0 s in beeld staan; zonder
    //      setpts kwam hij op 5,0 s (2 fps) of 3,4 s (10 fps). Bij 2 fps pint dit ook de "4 beelden" vast.
    const stoot = stootPcm(6, 3);
    for (const doel of ['golf', 'golf10']) {
      const id = await nieuweOpname();
      const s = await U.start({ id, doel }, basis);
      await voer({ id, pcmBuf: stoot, sec: 6, tussen: 0 });
      await U.opnameKlaar(id);
      const z = stootZichtbaar(U.stand().uit?.mp4 || '/x');
      ok(`S27 ${doel}: de stoot op 3,0 s staat in beeld op ${z.t === null ? '-' : r2(z.t)} s (3,0 ± 0,15)`, s.ok && z.t !== null && Math.abs(z.t - 3) <= 0.15);
    }

    // S28: stil met een png-plaat, echt door ffmpeg (review 1, punt 5): movie, loop en overlay breken stil bij een update.
    //      Ook op 10 fps (review 2, L1): zonder draw=full was de stoot daar niet te zien en werd de plaat donkerder.
    mkdirSync(join(uitzendMap, 'beelden'), { recursive: true });
    spawnSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'color=c=0x202020:s=1280x720', '-frames:v', '1', join(uitzendMap, 'beelden', 'plaat-donker.png')]);
    for (const doel of ['plaat', 'plaat10']) {
      const id = await nieuweOpname();
      const s = await U.start({ id, doel }, basis);
      await voer({ id, pcmBuf: stoot, sec: 6, tussen: 0 });
      await U.opnameKlaar(id);
      const st = U.stand();
      const mp4 = st.uit?.mp4 || '/x';
      const p = probeJson(mp4);
      const ad = duurVan(mp4, 'a:0');
      ok(`S28 ${doel} stil/png -> bestand: h264 1280x720 + aac, geluid ${r2(ad)} s (6 ± 0,3)${s.ok ? '' : ` [${s.fout}]`}`, s.ok && stroom(p, 'video').codec_name === 'h264'
        && stroom(p, 'video').width === 1280 && stroom(p, 'video').height === 720 && stroom(p, 'audio').codec_name === 'aac' && Math.abs(ad - 6) <= 0.3);
      const z = stootZichtbaar(mp4);
      // "In beeld" = niet zwart (16); de plaat geeft 31. De grens ligt ertussen, niet één stap onder 31 (review 2, L2).
      const piek = Math.max(...z.rij.filter(([t]) => t >= 2.9 && t <= 3.4).map(([, y]) => y));
      ok(`S28 ${doel}: de plaat staat in beeld (helderheid in stilte ${r2(z.basis)}; zwart is 16) en de stoot op ${z.t === null ? '-' : r2(z.t)} s (3,0 ± 0,15), lichter dan de plaat (max ${r2(piek)})`,
        z.basis > 23 && z.t !== null && Math.abs(z.t - 3) <= 0.15 && piek > z.basis + 8);
    }
  }

  // ==== R: uit de code-review van 10 okt ===========================================
  if (heeftFfmpeg) {
    const p6 = pcm(6);
    // R1: een stop() tijdens het starten (wachten op de mp4) gaat niet verloren
    {
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      const tS = Date.now();
      let startDuur = null;
      const st = U.start({ id, doel: 'beeld' }, { ...basis, wachtMp4: 3000 }).then((r) => { startDuur = (Date.now() - tS) / 1000; return r; });
      await wacht(200);
      const t0 = Date.now();
      const sp = await U.stop();
      const r = await st;
      const d = (Date.now() - t0) / 1000;
      ok(`R1 stop() tijdens het wachten op de mp4 (start liep ${r2(startDuur)} s): stop ok na ${r2(d)} s (≤ 0,6), start geeft "${r.fout}", geen ffmpeg, niet bezig`,
        sp.ok && startDuur >= 0.15 && startDuur < 1 && d <= 0.6 && !r.ok && /gestopt tijdens het starten/.test(r.fout || '') && U._pid() === null && !U.stand().bezig);
      await O.sluit(opnames, id);
    }
    // R3: een fout tussen het openen van de WAV en de spawn laat geen open bestand achter
    {
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      writeFileSync(join(tmp, 'een-bestand'), 'x');
      const fds = () => readdirSync('/dev/fd').length;
      const voor = fds();
      const rs = [];
      for (let i = 0; i < 5; i++) rs.push(await U.start({ id, doel: 'proef' }, { ...basis, uitMap: join(tmp, 'een-bestand', 'uit') }));
      const na = fds();
      ok(`R3 vijf starts die op mkdir stuklopen (ENOTDIR): ok:false, open bestanden ${voor} -> ${na}`, rs.every((r) => !r.ok) && na <= voor);
      await O.sluit(opnames, id);
    }
    // R7: een link naar de opnamemap omzeilt G9 niet, en er komt niets in opnames/ bij
    {
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      const link = join(tmp, 'naar-opnames');
      spawnSync('ln', ['-s', opnames, link]);
      const voor = readdirSync(opnames).length;
      const r = await U.start({ id, doel: 'proef' }, { ...basis, uitMap: join(link, 'uit') });
      ok(`R7 uitMap via een link in opnames/ -> "${r.fout}"; opnames/ ongewijzigd`, !r.ok && /G9/.test(r.fout || '') && readdirSync(opnames).length === voor);
      await O.sluit(opnames, id);
    }
    // R8 (review 1, punt 1): een relatieve uitMap. Node toetste vanuit zijn eigen map, ffmpeg schreef vanuit de
    //    uitzendmap; met '../opnames' kwam de flv zo IN opnames/. Nu toetsen en schrijven ze hetzelfde absolute pad.
    for (const [rel, map] of [['uit-rel', ['x']], ['../opnames', ['x', 'y']]]) {
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      const cwd = process.cwd();
      const nodeMap = join(tmp, ...map);
      mkdirSync(nodeMap, { recursive: true });
      const voor = readdirSync(opnames).length;
      let r, st;
      try {
        process.chdir(nodeMap);
        r = await U.start({ id, doel: 'proef' }, { ...basis, uitMap: rel });
        await O.voegToe(opnames, id, p6.subarray(192000, 384000), 48000);
        await O.sluit(opnames, id);
        await U.opnameKlaar(id);
        st = U.stand();
      } finally { process.chdir(cwd); }
      const verwacht = join(realpathSync(nodeMap), rel);
      const flv = st?.uit?.flv || '', mp4 = st?.uit?.mp4 || '';
      ok(`R8 uitMap '${rel}' vanuit ${map.join('/')}: flv absoluut in ${verwacht.slice(realpathSync(tmp).length)}, mp4 ernaast, niets in opnames/ of in de uitzendmap`,
        r?.ok && isAbsolute(flv) && dirname(flv) === verwacht && existsSync(flv) && dirname(mp4) === verwacht && existsSync(mp4)
        && readdirSync(opnames).length === voor && !existsSync(join(uitzendMap, 'uit-rel')) && !readdirSync(opnames).some((n) => /uitzend/.test(n)));
    }
    // R9 (review 1, punt 6): uit het verzoek leest start() alleen id, doel, beeldstand en door. De route in stap 3
    //    mag de body dus doorgeven: paden, ffmpeg en een argv-haak komen alleen uit de instellingen van de server.
    {
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      const vreemd = join(tmp, 'vreemd');
      const r = await U.start({ id, doel: 'proef', ffmpeg: '/bestaat/niet', opnames: vreemd, uitzendMap: vreemd, uitMap: opnames,
        url: 'rtmp://a.rtmp.youtube.com/live2/x', _argsHaak: () => ['-version'] }, basis);
      const st = U.stand();
      ok(`R9 ffmpeg, opnames, uitzendMap, uitMap, url en _argsHaak in het verzoek: genegeerd (ffmpeg ${st.ffmpeg}, uitgang in uitMap, ${existsSync(vreemd) ? 'vreemde map gemaakt' : 'geen vreemde map'})`,
        r.ok && st.ffmpeg === 'loopt' && (st.uit?.flv || '').startsWith(uitMap) && !existsSync(vreemd));
      await U.stop({ snel: true });
      await O.sluit(opnames, id);
    }
    // R10 (review 1, punt 7): opnameKlaar en stop() tegelijk, terwijl er nog ongeschreven geluid ligt. Vroeger liep
    //     _leeg dan zonder pauze rondjes tot ffmpeg dicht was: Node op ~100 % (gemeten 35 ms CPU in 34 ms), nu ~1 ms.
    {
      let mis = 0, cpu = 0, wand = 0;
      const fouten = [];
      for (let i = 0; i < 10; i++) {
        const id = await nieuweOpname();
        const s = await U.start({ id, doel: 'udp-test' }, basis);       // udp: geen remux, dus snel
        await O.voegToe(opnames, id, p6.subarray(0, 3 * 192000), 0);   // 3 s ineens: opnameKlaar heeft nog werk
        const c0 = process.cpuUsage(), t0 = Date.now();
        const [k, sp] = await Promise.all([U.opnameKlaar(id), U.stop()]);
        const c = process.cpuUsage(c0);
        cpu += (c.user + c.system) / 1000; wand += Date.now() - t0;
        if (!s.ok || !k.ok || !sp.ok) { mis++; fouten.push(k.fout || sp.fout || s.fout); }
        await O.sluit(opnames, id);
      }
      ok(`R10 opnameKlaar en stop() tegelijk, 10 keer: ${mis} keer ok:false${fouten.length ? ` (${fouten[0]})` : ''}; daarna niet bezig`, mis === 0 && !U.stand().bezig && U._pid() === null);
      ok(`R10 en intussen geen rondjes zonder pauze: Node ${Math.round(cpu)} ms CPU in ${wand} ms (≤ de helft)`, cpu <= wand / 2);
    }
    // R11 (review 1, punt 1): staat de flv niet waar de stand hem verwacht, dan zegt de stand waarom er geen mp4 is.
    {
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p6.subarray(0, 192000), 0);
      const elders = join(tmp, 'elders.flv');
      const r = await U.start({ id, doel: 'proef' }, { ...basis, _argsHaak: (a) => [...a.slice(0, -1), elders] });
      await O.voegToe(opnames, id, p6.subarray(192000, 384000), 48000);
      await O.sluit(opnames, id);
      await U.opnameKlaar(id);
      const st = U.stand();
      const w = st.waarschuwingen.find((x) => /geen flv op/.test(x));
      ok(`R11 geen flv op de verwachte plek -> geen stille stop maar "${w}"`, r.ok && !!w && !st.uit?.mp4);
    }
    // R12 (review 2, M1): opnameKlaar terwijl de start nog op de mp4 wacht. Vroeger gaf opnameKlaar meteen ok zonder
    //     iets te doen; de start slaagde daarna alsnog en volgde een opname die al dicht was ("bron stil" na 10 s).
    if (!heeftVT) notitie('R12: geen h264_videotoolbox in deze ffmpeg');
    else {
      const p12 = pcm(12), v = fmp4('aac');
      const id = await nieuweOpname();
      await O.voegToe(opnames, id, p12.subarray(0, 192000), 0);
      const sP = U.start({ id, doel: 'beeld' }, { ...basis, wachtMp4: 3000 });
      await wacht(150);
      for (let i = 1; i < 12; i++) await O.voegToe(opnames, id, p12.subarray(i * 192000, (i + 1) * 192000), i * 48000);
      await O.voegVideoToe(opnames, id, 'mp4', v.init);
      for (const f of v.frags) await O.voegVideoToe(opnames, id, 'mp4', f.buf);
      await O.sluit(opnames, id);
      const k = await U.opnameKlaar(id);
      const s = await sP;
      const st = U.stand();
      const vd = duurVan(st.uit?.mp4 || '/x', 'v:0');
      ok(`R12 opnameKlaar tijdens het starten: start ${s.ok ? 'ok' : s.fout}, klaar ok, daarna niet bezig, geen fout ("${st.fout}"), mp4 met beeld ${r2(vd)} s (12 ± 0,6)`,
        s.ok && k.ok && !st.bezig && st.fout === null && existsSync(st.uit?.mp4 || '/x') && Math.abs(vd - 12) <= 0.6);
    }
  }

  // ==== E: echte tijd (alleen met VARVE_TEST_ECHTETIJD=1) ==========================
  if (!echteTijd) notitie('E1-E6: echte tijd overgeslagen (VARVE_TEST_ECHTETIJD=1 om ze te draaien, ~75 s)');
  else if (!heeftFfmpeg) notitie('E1-E6: geen ffmpeg');
  else {
    const p14 = pcm(14), p12 = pcm(12);
    const log = (naam, rijen) => console.log(`        ${naam}: ${rijen.map(([t, a]) => `${t}s ${r2(a)}`).join(' · ')}`);

    // E1: stil -> bestand, 8 s in echte tijd
    {
      const id = await nieuweOpname();
      await U.start({ id, doel: 'proef' }, basis);
      const rij = [];
      await voer({ id, pcmBuf: p14, sec: 8, tussen: 1000, sluiten: false, elkeSeconde: async (n) => { if (n === 4 || n === 6 || n === 8) rij.push([n, U.stand().achterstandS, U.stand().uitS]); } });
      const uitS = U.stand().uitS;
      await O.sluit(opnames, id); await U.opnameKlaar(id);
      log('E1 achterstandS', rij);
      ok(`E1 stil, echte tijd: achterstandS ≤ 2,5 na 4, 6 en 8 s; uitS na 8 s = ${r2(uitS)} (≥ 6,5)`, rij.length === 3 && rij.every(([, a]) => a <= 2.5) && uitS >= 6.5);
    }

    // E2/E3: ffmpeg hangt (SIGSTOP) 10 s, de opname loopt door (H1)
    for (const [naam, max] of [['E2', 8], ['E3', 1000]]) {
      const id = await nieuweOpname();
      await U.start({ id, doel: 'udp-test' }, { ...basis, achterstandMax: max });
      const rij = [];
      let pid = null, naCont = null, tCont = 0;
      const ref = { na6: null, na10: null };
      await voer({ id, pcmBuf: p14, sec: 14, tussen: 1000, sluiten: false, elkeSeconde: async (n) => {
        rij.push([n, U.stand().achterstandS]);
        if (n === 2) { pid = U._pid(); process.kill(pid, 'SIGSTOP'); }
        if (n === 8) ref.na6 = U.stand().achterstandS;
        if (n === 12) { ref.na10 = U.stand().achterstandS; process.kill(pid, 'SIGCONT'); tCont = Date.now(); }
        if (n === 14 && max === 8) { naCont = U.stand().achterstandS; }
      } });
      await wacht(Math.max(0, 3000 - (Date.now() - tCont)));
      const st = U.stand();
      await O.sluit(opnames, id); await U.opnameKlaar(id);
      log(`${naam} achterstandS`, rij);
      if (max === 8) {
        ok(`E2 SIGSTOP: na 6 s pauze achterstandS ${r2(ref.na6)} (≥ 4)`, ref.na6 >= 4);
        ok(`E2 sprong: sprongen ${st.sprongen} (≥ 1), kwijtS ${r2(st.kwijtS)} (≥ 7)`, st.sprongen >= 1 && st.kwijtS >= 7);
        ok(`E2 binnen 3 s na SIGCONT achterstandS ${r2(st.achterstandS)} (≤ 2,5; op 2 s: ${r2(naCont)})`, st.achterstandS <= 2.5);
      } else ok(`E3 de stand liegt niet: zonder sprong na 10 s pauze achterstandS ${r2(ref.na10)} (≥ 9)`, ref.na10 >= 9 && st.sprongen === 0);
    }

    // E4: beeld/hercodeer met Chrome's cadans (H2), gevoerd zoals de browser het doet en de kritiek het mat:
    //     elk WAV-stuk op het EIND van zijn seconde, elk fragment op precies (eind van het fragment + 1 s).
    //     (Eerder voerde E4 via voer(): WAV-stuk aan het begin van zijn seconde, fragment op de eerste hele
    //     seconde na eind + 1 s. Dat is tot 0,63 s later dan dit, en gaf 5,26 en 5,63 s: docs/UITZENDEN.md §7.)
    // E5: regressiewacht O §2.2: hetzelfde met -c:a aac (nooit FAIL, H11)
    const vAac = fmp4('aac');
    /** Taken op hun wandtijd vanaf t0, in volgorde; geeft t0. */
    const opTijd = async (taken) => {
      const t0 = Date.now();
      for (const [ms, doe] of [...taken].sort((a, b) => a[0] - b[0])) { await wacht(Math.max(0, t0 + ms - Date.now())); await doe(); }
      return t0;
    };
    if (!heeftVT) notitie('E4-E5: geen h264_videotoolbox');
    else for (const [naam, haak] of [['E4', null], ['E5', (a) => a.map((x, i) => (x === 'copy' && a[i - 1] === '-c:a' ? 'aac' : x))]]) {
      const id = await nieuweOpname();
      await O.voegVideoToe(opnames, id, 'mp4', vAac.init);
      const s = await U.start({ id, doel: 'beeld' }, { ...basis, ...(haak ? { _argsHaak: haak } : {}) });
      const rij = [];
      const tStart = Date.now();
      const meet = setInterval(() => rij.push([(Date.now() - tStart) / 1000, U.stand().achterstandS]), 250);
      let opWav12 = null;
      const taken = [
        ...Array.from({ length: 12 }, (_, i) => [(i + 1) * 1000, () => O.voegToe(opnames, id, p12.subarray(i * 192000, (i + 1) * 192000), i * 48000)]),
        ...vAac.frags.map((f) => [(f.eind + 1) * 1000, () => O.voegVideoToe(opnames, id, 'mp4', f.buf)]),
        [12900, async () => { opWav12 = U.stand().achterstandS; }],
      ];
      await opTijd(taken);
      clearInterval(meet);
      await O.sluit(opnames, id); await U.opnameKlaar(id);
      const per = [];
      for (let t = 1; t <= 13; t++) { const x = rij.find(([w]) => w >= t); if (x) per.push([t, x[1]]); }
      log(`${naam} achterstandS per s`, per);
      if (naam === 'E4') {
        const max = Math.max(...rij.filter(([t]) => t >= 3).map(([, a]) => a));
        const eerste = Math.max(...rij.filter(([t]) => t >= 3 && t < 7.5).map(([, a]) => a));
        const laatste = Math.max(...rij.filter(([t]) => t >= 7.5).map(([, a]) => a));
        const vd = duurVan(U.stand().uit?.mp4 || '/x', 'v:0');
        ok(`E4 hercodeer, Chrome-cadans: max achterstandS na 3 s ${r2(max)} (≤ 5,5 = fragmentduur + 2 s)`, s.ok && max <= 5.5);
        ok(`E4 niet groeiend: max in de tweede helft ${r2(laatste)} ≤ max in de eerste ${r2(eerste)} + 0,5`, laatste <= eerste + 0.5);
        ok(`E4 ontvangen beeld ${r2(vd)} s (12 ± 0,6)`, Math.abs(vd - 12) <= 0.6);
      } else notitie(`E5 regressiewacht: achterstand bij aac na 12 s = ${r2(opWav12)} s (verwacht > 2,5; is hij kleiner, dan is ffmpeg verbeterd: melden)`);
    }

    // E6: CPU van het stil-profiel op 15 fps (H6): alleen loggen
    {
      doelenJson([{ naam: 'golf15', soort: 'bestand', bron: 'audio', beeld: 'golf', fps: 15 }]);
      const id = await nieuweOpname();
      await U.start({ id, doel: 'golf15' }, basis);
      let cpu = null;
      await voer({ id, pcmBuf: p14, sec: 8, tussen: 1000, sluiten: false, elkeSeconde: async (n) => {
        if (n === 8) {
          const t = spawnSync('ps', ['-o', 'utime=', '-p', String(U._pid())], { encoding: 'utf8' }).stdout.trim();
          const m = /(?:(\d+):)?(\d+(?:\.\d+)?)/.exec(t);
          if (m) cpu = Number(m[1] || 0) * 60 + Number(m[2]);
        }
      } });
      await O.sluit(opnames, id); await U.opnameKlaar(id);
      notitie(`E6 cpu stil fps15 (golf, 1280x720): ${cpu === null ? '?' : r2(cpu)} s user per 8 s, alleen het ffmpeg-kind`);
    }
  }
} catch (err) {
  console.log('FAIL  onverwachte fout: ' + (err.stack || err.message));
  fails.push('onverwacht');
} finally {
  U._reset();
  for (const k of ontvangers) { try { k.kill('SIGKILL'); } catch { /* weg */ } }
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nalles ok');
process.exit(fails.length ? 1 : 0);
