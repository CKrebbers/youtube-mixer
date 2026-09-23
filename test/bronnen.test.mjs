// Bronnen naast YouTube: TikTok-links (zonder netwerk), eigen bestanden
// onderzoeken met ffprobe, en een eigen VIDEObestand door de hele pipeline.
// ffmpeg maakt zijn eigen testmateriaal, net als in ingest.test.
// Draai met: node test/bronnen.test.mjs
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { normaliseerLink, bronVan, trackIdVoor, tiktokHint, ontsmetNaam } = await import('../server/links.js');
const ing = await import('../server/ingest.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

console.log('TikTok-links');
ok('www.tiktok.com/@naam/video/<id> blijft zoals hij is',
  normaliseerLink('https://www.tiktok.com/@tiktok/video/7047596209028074758') === 'https://www.tiktok.com/@tiktok/video/7047596209028074758');
// yt-dlp's TikTokIE eist "www." — zonder viel hij op de generic extractor.
ok('zonder www: krijgt www (anders herkent yt-dlp hem niet)',
  normaliseerLink('https://tiktok.com/@tiktok/video/7047596209028074758') === 'https://www.tiktok.com/@tiktok/video/7047596209028074758');
ok('m.tiktok.com ook', normaliseerLink('http://m.tiktok.com/@a.b_c/video/123') === 'https://www.tiktok.com/@a.b_c/video/123');
// Clay's link, zoals de deelknop hem geeft: met of zonder parameters hetzelfde nummer.
const clay = 'https://www.tiktok.com/@lennonstella/video/7031697544472251694';
ok('querystring en #… eraf (?is_copy_url=1&is_from_webapp=v1)',
  normaliseerLink(`${clay}?is_copy_url=1&is_from_webapp=v1`) === clay && normaliseerLink(`${clay}/?lang=nl#x`) === clay
  && normaliseerLink(`https://tiktok.com/@lennonstella/video/7031697544472251694?lang=nl`) === clay);
ok('geen video-pad (profiel, /t/): niet herschreven', normaliseerLink('https://www.tiktok.com/@lennonstella?x=1') === 'https://www.tiktok.com/@lennonstella?x=1');
ok('korte links (vm., vt., /t/) blijven staan: yt-dlp volgt ze zelf',
  normaliseerLink('https://vm.tiktok.com/ZMabc123/') === 'https://vm.tiktok.com/ZMabc123/'
  && normaliseerLink('https://www.tiktok.com/t/ZTRabc/') === 'https://www.tiktok.com/t/ZTRabc/'
  && normaliseerLink(' https://vt.tiktok.com/ZSx/ ') === 'https://vt.tiktok.com/ZSx/');
ok('YouTube ongemoeid', normaliseerLink('https://youtu.be/dQw4w9WgXcQ') === 'https://youtu.be/dQw4w9WgXcQ');
ok('geen http(s): null', normaliseerLink('javascript:alert(1)') === null && normaliseerLink('') === null
  && normaliseerLink('file:///etc/passwd') === null && normaliseerLink(null) === null);

ok('bron: youtube, youtu.be en m.youtube', ['https://www.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://m.youtube.com/watch?v=x']
  .every((u) => bronVan(u) === 'youtube'));
ok('bron: tiktok (ook korte links)', ['https://www.tiktok.com/@a/video/1', 'https://vm.tiktok.com/Z/', 'https://www.tiktok.com/t/Z/']
  .every((u) => bronVan(u) === 'tiktok'));
ok('bron: bestand', bronVan('bestand:abc:set.mp4') === 'bestand');
ok('bron: al het andere is web (ook een nep-tiktok)', bronVan('https://vimeo.com/1') === 'web'
  && bronVan('https://tiktok.com.evil.example/x') === 'web' && bronVan('onzin') === 'web');

ok('YouTube-id blijft zoals hij was (bestaande nummers)', trackIdVoor({ id: 'dQw4w9WgXcQ', extractor: 'Youtube' }) === 'dQw4w9WgXcQ');
ok('TikTok-id krijgt tiktok- ervoor (getallen van twee sites mogen niet botsen)',
  trackIdVoor({ id: '7047596209028074758', extractor: 'TikTok' }) === 'tiktok-7047596209028074758');
ok('en past in de id-controle van de server', /^[\w-]{1,64}$/.test(trackIdVoor({ id: '7047596209028074758', extractor: 'TikTok' })));
ok('onveilige id: null', trackIdVoor({ id: '../../x', extractor: 'generic' }) === null
  && trackIdVoor({ id: 'a'.repeat(80), extractor: 'Youtube' }) === null && trackIdVoor({ id: null }) === null);

ok('TikTok zonder curl_cffi: zegt wat je moet installeren', /curl_cffi/.test(tiktokHint('ERROR: [TikTok] 123: This request requires browser impersonation') || ''));
ok('ingelogd nodig: noemt cookies als optie, bouwt niets in', /cookies-from-browser/.test(tiktokHint('This post may not be comfortable for some audiences. Log in for access') || ''));
ok('een gewone fout: geen hint', tiktokHint('HTTP Error 404: Not Found') === null);

console.log('\nbestandsnamen (alleen titel, nooit pad)');
ok('pad eraf', ontsmetNaam('../../etc/passwd.mp3')?.naam === 'passwd.mp3' && ontsmetNaam('C:\\x\\y\\set.MP4')?.ext === 'mp4');
ok('titel zonder achtervoegsel', ontsmetNaam('Mijn_set 2026.mov')?.titel === 'Mijn set 2026');
ok('ander achtervoegsel: geweigerd', ontsmetNaam('x.txt') === null && ontsmetNaam('x.mp3.exe') === null && ontsmetNaam('geen') === null);
ok('stuurtekens eruit', !/[\u0000-\u001f]/.test(ontsmetNaam('a\u0000b\nc.wav').naam));

// ---- ffprobe: is het media, en zit er beeld in? ---------------------------

const map = mkdtempSync(join(tmpdir(), 'varve-bronnen-'));
const ff = (...a) => ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

console.log('\nonderzoek (ffprobe)');
const wav = join(map, 'toon.wav');
await ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2', wav);
const o1 = await ing.onderzoek(wav);
ok('wav: audio, geen beeld', o1.ok && o1.audio && !o1.video && Math.abs(o1.duur - 3) < 0.1);

const hoesje = join(map, 'hoesje.mp3');
const hoesPng = join(map, 'hoes.png');
await ff('-f', 'lavfi', '-i', 'color=c=red:size=300x300', '-frames:v', '1', hoesPng);
await ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-i', hoesPng,
  '-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', '-id3v2_version', '3',
  '-metadata', 'title=Mijn titel', '-metadata', 'artist=Varve', hoesje);
const o2 = await ing.onderzoek(hoesje);
ok(`mp3 met hoesje: het hoesje is GEEN beeld (${o2.ok ? `video=${o2.video}` : o2.fout})`, o2.ok && o2.audio && !o2.video);
ok('titel en artiest uit de tags', o2.tags?.titel === 'Mijn titel' && o2.tags?.artiest === 'Varve');

const stom = join(map, 'stom.mp4');
await ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', stom);
const o3 = await ing.onderzoek(stom);
ok(`video zonder geluid: nette fout ("${o3.fout}")`, !o3.ok && /geluid/.test(o3.fout));

const tekst = join(map, 'nep.mp3');
writeFileSync(tekst, 'hallo, dit is geen muziek\n'.repeat(50));
const o4 = await ing.onderzoek(tekst);
ok(`tekst met .mp3 erachter: geen media ("${o4.fout}")`, !o4.ok && o4.fout.length > 0);
ok('onbestaand bestand: nette fout', !(await ing.onderzoek(join(map, 'weg.wav'))).ok);

// ---- een eigen STAAND videobestand door de hele pipeline -----------------
// 9:16 zoals TikTok, 1080×1920 zodat de schaalstap echt iets doet, met
// klikken op 120 bpm zodat er ook een grid uit kan komen.

console.log('\neigen video door de pipeline');
{
  const media = join(map, 'media');
  mkdirSync(media, { recursive: true });
  const bron = join(map, 'staand.mov');
  await ff('-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=25:duration=30',
    '-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=44100:d=30",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', bron);
  const info = await ing.onderzoek(bron);
  ok('staande video: audio én beeld, 1080×1920', info.ok && info.audio && info.video && info.breedte === 1080 && info.hoogte === 1920);
  // Zoals de upload: het bestand staat in een werkmap in media/.
  const werk = await ing.werkmap(media, 'upload');
  const inWerk = join(werk, 'bron.mov');
  copyFileSync(bron, inWerk);
  const stappen = [];
  const r = await ing.ingestBestand(inWerk, {
    id: 'lokaal-abcdef012345', map: werk, mediaDir: media, heeftVideo: info.video,
    info: { url: 'bestand:abcdef012345:staand.mov', titel: 'staand', uploader: '' },
    onStap: (s) => stappen.push(s.stap),
  });
  ok(`ingest lukt${r.ok ? '' : ` (${r.fout})`}`, r.ok === true);
  ok('zelfde stappen als een link: meten, normaliseren, peaks, onset, grid, video',
    ['meten', 'normaliseren', 'peaks', 'onset', 'grid', 'video'].every((s) => stappen.includes(s)));
  const doel = join(media, 'lokaal-abcdef012345');
  ok('audio.wav, video.mp4, peaks.bin en onset.bin in media/<id>/',
    ['audio.wav', 'video.mp4', 'peaks.bin', 'onset.bin'].every((f) => existsSync(join(doel, f))));
  ok('werkmap opgeruimd, bronbestand weg', !readdirSync(media).some((n) => n.startsWith('.bezig-')) && !existsSync(join(doel, 'bron.mov')));
  const a = await ing.run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'csv=p=0', join(doel, 'audio.wav')]);
  ok(`audio.wav is 16-bit 48k stereo (${a.stdout.trim()})`, a.stdout.trim() === 'pcm_s16le,48000,2');
  const v = await ing.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
    '-of', 'csv=p=0', join(doel, 'video.mp4')]);
  ok(`video.mp4: h264, staand, korte kant 720, 30 fps (${v.stdout.trim()})`, v.stdout.trim() === 'h264,720,1280,30/1');
  const zonderGeluid = await ing.run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', join(doel, 'video.mp4')]);
  ok('video.mp4 zonder geluidsspoor (dat komt uit de engine)', zonderGeluid.stdout.trim() === '');
  ok('het track-object klopt', r.track?.id === 'lokaal-abcdef012345' && r.track.url.startsWith('bestand:')
    && r.track.ytdlp === null && r.track.video && !r.track.videoFout);
  ok(`en er is een grid (${r.track?.grid ? r.track.grid.stukken[0].bpm.toFixed(2) + ' bpm' : 'geen'})`, Math.abs((r.track?.grid?.stukken?.[0]?.bpm ?? 0) - 120) < 0.5);

  // Een audiobestand: geen video, geen videostap.
  const werk2 = await ing.werkmap(media, 'upload');
  copyFileSync(hoesje, join(werk2, 'bron.mp3'));
  const st2 = [];
  const r2 = await ing.ingestBestand(join(werk2, 'bron.mp3'), {
    id: 'lokaal-000000000001', map: werk2, mediaDir: media, heeftVideo: false,
    info: { url: 'bestand:000000000001:hoesje.mp3', titel: 'Mijn titel', uploader: 'Varve' }, onStap: (s) => st2.push(s.stap),
  });
  ok('mp3 met hoesje: alleen audio, geen video.mp4', r2.ok && r2.track.video === null && !st2.includes('video')
    && !existsSync(join(media, 'lokaal-000000000001', 'video.mp4')));
  const r3 = await ing.ingestBestand(join(werk2, 'x.wav'), { id: '../x', map: join(media, '.bezig-leeg'), mediaDir: media, info: {} });
  ok('onveilige id: geweigerd', r3.ok === false);
}

rmSync(map, { recursive: true, force: true });

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
