// De wachtrij van de ingest, zonder server en zonder netwerk: volgorde,
// annuleren (ook midden in een download van een nep-yt-dlp), playlists
// weigeren, dubbel herkennen, voortgangsberichten.
// Draai met: node test/wachtrij.test.mjs
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const { Wachtrij, isOpen } = await import('../server/wachtrij.js');
const { bekijkLink } = await import('../server/links.js');
const ing = await import('../server/ingest.js');
const { maakOnset } = await import('../server/analyze.js');
const { maakNepYtdlp } = await import('./nep-ytdlp.mjs');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const wacht = (ms) => new Promise((z) => setTimeout(z, ms));
const map = mkdtempSync(join(tmpdir(), 'varve-wachtrij-'));

/** Werk dat de test zelf afmaakt: { werk, klaar(r), gestart, signal } */
function handWerk() {
  const w = { gestart: false, signal: null, meld: null };
  w.werk = (onStap, signal) => {
    w.gestart = true; w.signal = signal; w.meld = onStap;
    return new Promise((k) => {
      w.klaar = k;
      signal.addEventListener('abort', () => setTimeout(() => k({ ok: false, fout: 'code 143' }), 20));
    });
  };
  return w;
}
const track = (id) => ({ id, titel: `titel ${id}` });

try {
  console.log('wachtrij: volgorde en één tegelijk');
  {
    const q = new Wachtrij();
    const [a, b, c] = [handWerk(), handWerk(), handWerk()];
    const oa = q.voegToe({ sleutel: 'a', url: 'u-a', stappen: ['metadata', 'audio'], werk: a.werk }).opdracht;
    const ob = q.voegToe({ sleutel: 'b', url: 'u-b', werk: b.werk }).opdracht;
    const oc = q.voegToe({ sleutel: 'c', url: 'u-c', werk: c.werk }).opdracht;
    ok('de eerste is meteen bezig (status al gezet bij terugkomst)', oa.status === 'bezig' && oa.stap === 'metadata');
    ok('de rest wacht, met hun plek', ob.status === 'wacht' && ob.plek === 1 && oc.status === 'wacht' && oc.plek === 2);
    await wacht(0);
    ok('alleen het werk van de eerste is gestart', a.gestart && !b.gestart && !c.gestart);
    const dub = q.voegToe({ sleutel: 'b', url: 'u-b', werk: handWerk().werk });
    ok('dezelfde sleutel nog eens: dezelfde opdracht, dubbel', dub.dubbel === true && dub.opdracht === ob && q.lijst().length === 3);
    ok('zoek vindt wacht en bezig', q.zoek('a') === oa && q.zoek('c') === oc && q.zoek('x') === null && q.open);

    // Voortgang: pct alleen als de melding hem noemt, en niet buiten 0..100.
    a.meld({ stap: 'audio', tekst: 'audio downloaden', pct: 42, titel: 'Een titel', status: 'klaar', id: 'hack' });
    ok('stap, tekst, pct en titel worden gezet', oa.stap === 'audio' && oa.pct === 42 && oa.titel === 'Een titel');
    ok('status en id niet (die zijn van de wachtrij)', oa.status === 'bezig' && oa.id !== 'hack');
    a.meld({ stap: 'meten', tekst: 'meten' });
    ok('een melding zonder pct wist het percentage (geen 100% blijven staan)', oa.stap === 'meten' && oa.pct === null);
    a.meld({ stap: 'meten', pct: 140 });
    ok('pct wordt geklemd', oa.pct === 100);

    a.klaar({ ok: true, track: track('A') });
    await wacht(5);
    ok('klaar: tekst met titel, track erbij, de volgende begint', oa.status === 'klaar' && oa.track.id === 'A'
      && /klaar — titel A/.test(oa.tekst) && ob.status === 'bezig' && b.gestart && !c.gestart && oc.plek === 1);
    b.klaar({ ok: false, fout: 'HTTP 404', playlist: false });
    await wacht(5);
    ok('mislukt: fout en tekst, en weer de volgende', ob.status === 'mislukt' && ob.fout === 'HTTP 404' && /mislukt — HTTP 404/.test(ob.tekst) && c.gestart);
    c.klaar({ ok: true, bestond: true, track: track('C') });
    await q.stil();
    ok('bestond: "al in de library", en de rij is stil', oc.status === 'klaar' && oc.bestond === true && /al in de library/.test(oc.tekst) && !q.open);
  }

  console.log('\nwachtrij: annuleren');
  {
    const q = new Wachtrij();
    const [a, b, c] = [handWerk(), handWerk(), handWerk()];
    let opgeruimd = 0;
    const oa = q.voegToe({ sleutel: 'a', werk: a.werk }).opdracht;
    const ob = q.voegToe({ sleutel: 'b', werk: b.werk, bijAnnuleren: async () => { opgeruimd++; } }).opdracht;
    const oc = q.voegToe({ sleutel: 'c', werk: c.werk }).opdracht;
    await wacht(0);
    const rb = q.annuleer(ob.id);
    await wacht(0);
    ok('een wachtende: meteen geannuleerd, uit de rij, opgeruimd', rb.ok && ob.status === 'geannuleerd' && opgeruimd === 1 && oc.plek === 1);
    const ra = q.annuleer(oa.id);
    ok('de lopende: signal af, maar nog bezig (stoppen) tot het werk echt stopt', ra.ok && a.signal.aborted && oa.status === 'bezig' && oa.stap === 'stoppen');
    a.meld({ stap: 'audio', pct: 50 });
    ok('na annuleren telt een late voortgangsmelding niet', oa.stap === 'stoppen' && oa.pct === null);
    ok('de volgende wacht tot de lopende gestopt is', !c.gestart);
    await wacht(60);
    ok('daarna geannuleerd (niet mislukt), en de volgende begint', oa.status === 'geannuleerd' && oa.fout === null && c.gestart);
    ok('de geannuleerde wachtende is nooit begonnen', !b.gestart);
    ok('annuleren van iets dat af is: nee', !q.annuleer(oa.id).ok && q.annuleer('bestaatniet').reden === 'onbekende opdracht');
    ok('een open opdracht vergeten mag niet', !q.vergeet(oc.id));
    c.klaar({ ok: true, track: track('C') });
    await q.stil();
    ok('een afgelopen opdracht vergeten wel', q.vergeet(oa.id) && !q.lijst().includes(oa));
    // Werk dat gooit of niets teruggeeft: mislukt, de rij loopt door.
    const og = q.voegToe({ sleutel: 'g', werk: () => { throw new Error('boem'); } }).opdracht;
    const on = q.voegToe({ sleutel: 'n', werk: async () => undefined }).opdracht;
    await q.stil();
    ok('werk dat gooit wordt "mislukt", de wachtrij leeft', og.status === 'mislukt' && og.fout === 'boem' && on.status === 'mislukt');
    const k = q.voegKlaarToe({ sleutel: 'x', url: 'u', track: track('X') });
    ok('voegKlaarToe: afgerond record met bestond, niet in de rij', k.status === 'klaar' && k.bestond && !q.open && q.lijst().includes(k));
    const klein = new Wachtrij({ bewaar: 3 });
    for (let i = 0; i < 6; i++) klein.voegKlaarToe({ sleutel: `s${i}`, track: track(`T${i}`) });
    ok('onthoudt niet eindeloos', klein.lijst().length === 3 && klein.lijst().every((o) => !isOpen(o)));
  }

  console.log('\nlinks: playlist weigeren, list eraf, id zonder netwerk');
  const yt = bekijkLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=3&si=xyz');
  ok('v= én list=: alleen die video, list eraf', yt.ok && yt.link === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' && yt.id === 'dQw4w9WgXcQ' && yt.lijstEraf === true);
  ok('youtu.be, shorts, m. en music. worden dezelfde link', ['https://youtu.be/dQw4w9WgXcQ?si=a', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM1']
    .every((u) => { const b = bekijkLink(u); return b.ok && b.sleutel === 'dQw4w9WgXcQ' && b.link === yt.link; }));
  const pl = bekijkLink('https://www.youtube.com/playlist?list=PLabc');
  ok(`playlist-link: geweigerd met reden ("${pl.fout}")`, !pl.ok && pl.playlist && /playlist/.test(pl.fout));
  ok('watch zonder v maar met list: ook een playlist', bekijkLink('https://www.youtube.com/watch?list=PLabc').playlist === true);
  ok('kanalen en zoekresultaten: geweigerd', ['https://www.youtube.com/@varve', 'https://www.youtube.com/@varve/videos',
    'https://www.youtube.com/channel/UC123', 'https://www.youtube.com/results?search_query=x'].every((u) => bekijkLink(u).playlist === true));
  ok('TikTok-video: id zonder netwerk; profiel geweigerd', bekijkLink('https://tiktok.com/@a/video/123?x=1').id === 'tiktok-123'
    && bekijkLink('https://www.tiktok.com/@a').playlist === true);
  ok('een andere site: sleutel is de link, id onbekend', (() => { const b = bekijkLink('https://vimeo.com/1'); return b.ok && b.id === null && b.sleutel === 'https://vimeo.com/1'; })());
  ok('geen link: nette fout', !bekijkLink('javascript:x').ok && !bekijkLink('').ok && !bekijkLink(null).ok);

  console.log('\nvoortgang lezen');
  ok('eigen sjabloon: binnen/totaal', ing.leesDownload('[varve] 250 1000 NA') === 25);
  ok('sjabloon zonder totaal: de schatting', ing.leesDownload('[varve] 500 NA 2000') === 25);
  ok('sjabloon zonder iets: null', ing.leesDownload('[varve] 500 NA NA') === null);
  ok('de gewone yt-dlp-regel (met kleurcodes)', ing.leesDownload('[download] \u001b[0;94m 45.3%\u001b[0m of 3.45MiB') === 45.3
    && ing.leesDownload('[download]  12.0% of 3MiB at 1MiB/s') === 12);
  ok('andere regels: null', ing.leesDownload('[info] x: Downloading 1 format(s)') === null && ing.leesDownload('') === null);
  ok('ffmpeg -progress: out_time_us en out_time_ms (ook µs)', ing.leesFfmpegTijd('out_time_us=2500000') === 2.5
    && ing.leesFfmpegTijd('out_time_ms=1000000') === 1 && ing.leesFfmpegTijd('out_time=N/A') === null && ing.leesFfmpegTijd('progress=end') === null);
  ok('stappen: link met video, bestand zonder', ing.stappenVoor().join() === 'metadata,audio,meten,normaliseren,peaks,onset,grid,video'
    && ing.stappenVoor({ link: false, video: false }).join() === 'meten,normaliseren,peaks,onset,grid');

  console.log('\nde strook in de browser (pure delen)');
  {
    const { splitsLinks, zichtbaar, stappenStand, BLIJFT } = await import('../src/ui/ingest-strook.js');
    const geplakt = 'https://youtu.be/a1\r\n  https://youtu.be/b2,\n<https://vimeo.com/3>\nhier geen link\n"https://youtu.be/a1"\thttps://x.nl/4;';
    ok(`links uit geplakte regels: volgorde, zonder dubbel en leestekens (${splitsLinks(geplakt).join(' ')})`,
      splitsLinks(geplakt).join(' ') === 'https://youtu.be/a1 https://youtu.be/b2 https://vimeo.com/3 https://x.nl/4');
    ok('geen links: leeg', splitsLinks('zomaar tekst').length === 0 && splitsLinks(null).length === 0 && splitsLinks('http://').length === 0);
    const nu = 1e6;
    const lijst = [
      { id: 'k1', status: 'klaar', klaar: nu - 1000, begonnen: 1 },
      { id: 'k2', status: 'klaar', klaar: nu - BLIJFT.klaar - 1, begonnen: 2 },
      { id: 'b1', status: 'klaar', bestond: true, klaar: nu - BLIJFT.klaar - 1, begonnen: 3 },
      { id: 'm1', status: 'mislukt', klaar: nu - 3600e3, begonnen: 4 },
      { id: 'g1', status: 'geannuleerd', klaar: nu - BLIJFT.geannuleerd - 1, begonnen: 5 },
      { id: 'w2', status: 'wacht', plek: 2, begonnen: 6 },
      { id: 'w1', status: 'wacht', plek: 1, begonnen: 7 },
      { id: 'z', status: 'bezig', begonnen: 8 },
    ];
    ok(`zichtbaar: bezig, wachtend op plek, dan af; oud weg, mislukt blijft (${zichtbaar(lijst, nu).map((o) => o.id).join(',')})`,
      zichtbaar(lijst, nu).map((o) => o.id).join(',') === 'z,w1,w2,k1,b1,m1');
    const st = stappenStand({ status: 'bezig', stap: 'meten', stappen: ing.stappenVoor() });
    ok('stappen: gedaan tot de huidige, die is "nu", de rest straks',
      st.map((s) => s.stand[0]).join('') === 'ggnsssss' && st[1].naam === 'download' && st[4].naam === 'golfvorm');
    ok('klaar: alles gedaan; wacht: niets', stappenStand({ status: 'klaar', stap: 'klaar', stappen: ['a', 'b'] }).every((s) => s.stand === 'gedaan')
      && stappenStand({ status: 'wacht', stap: 'wachten', stappen: ['a', 'b'] }).every((s) => s.stand === 'straks'));
  }

  console.log('\nrun() en de analyse-worker annuleren');
  {
    const ac = new AbortController();
    const t0 = Date.now();
    const p = ing.run('sleep', ['30'], { signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const r = await p;
    ok(`een lopend proces stopt op het signal (${Date.now() - t0} ms)`, r.afgebroken === true && r.ok === false && Date.now() - t0 < 3000);
    const r2 = await ing.run('sleep', ['30'], { signal: AbortSignal.abort() });
    ok('al geannuleerd: niet eens gestart', r2.afgebroken === true && r2.code === -1);
    // Regels die over twee stukken data vallen worden heel gemaakt, ook zonder slot-newline.
    const regels = [];
    await ing.run(process.execPath, ['-e', "process.stdout.write('[varve] 1 '); setTimeout(() => process.stdout.write('4 NA\\nlaatste'), 50)"], { onUit: (l) => regels.push(l) });
    ok(`onUit krijgt hele regels (${JSON.stringify(regels)})`, regels[0] === '[varve] 1 4 NA' && regels[1] === 'laatste');

    const lang = join(map, 'lang.wav');
    await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=600', '-ac', '2', '-ar', '48000', lang]);
    const ac2 = new AbortController();
    const t1 = Date.now();
    const pw = maakOnset(lang, join(map, 'onset.bin'), { signal: ac2.signal });
    setTimeout(() => ac2.abort(), 150);
    const rw = await pw;
    ok(`analyse-worker: stopt meteen (${Date.now() - t1} ms)`, rw.afgebroken === true && Date.now() - t1 < 2000);
    await wacht(800);
    let kinderen = '';
    try { kinderen = execFileSync('pgrep', ['-P', String(process.pid), 'ffmpeg']).toString().trim(); } catch {}
    ok(`en zijn ffmpeg is ook weg (${kinderen || 'geen'})`, kinderen === '');
  }

  console.log('\nde pijplijn met een nep-yt-dlp: annuleren midden in de download');
  {
    const media = join(map, 'media');
    mkdirSync(media, { recursive: true });
    const bron = join(map, 'bron.wav');
    await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=44100:d=12", '-ac', '2', bron]);
    const log = join(map, 'nep.log');
    process.env.VARVE_YTDLP = maakNepYtdlp(map);
    process.env.NEP_LOG = log;
    process.env.NEP_BRON = bron;
    const regels = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    const werkmappen = () => readdirSync(media).filter((n) => n.startsWith('.bezig-'));

    const ac = new AbortController();
    const stappen = [];
    const p = ing.ingest('http://127.0.0.1:9/nummer-traag', { mediaDir: media, video: false, signal: ac.signal, onStap: (s) => stappen.push({ ...s }) });
    // Wachten tot hij echt aan het downloaden is (voortgang binnen).
    for (let i = 0; i < 100 && !stappen.some((s) => s.stap === 'audio' && s.pct > 0); i++) await wacht(50);
    const pcts = stappen.filter((s) => s.stap === 'audio' && s.pct != null).map((s) => s.pct);
    ok(`voortgang uit yt-dlp (${pcts.map((x) => x.toFixed(0)).join(', ')}%)`, pcts.length > 0 && pcts[0] > 0 && pcts[0] < 100);
    ok('met de titel uit de metadata', stappen.some((s) => s.titel === 'Nep nummer-traag'));
    ok('tijdens de download staat er een werkmap', werkmappen().length === 1);
    const pid = regels().find((r) => r.wat === 'download')?.pid;
    ac.abort();
    const t0 = Date.now();
    const r = await p;
    ok(`uitkomst: geannuleerd (${r.fout}), binnen ${Date.now() - t0} ms`, r.ok === false && r.afgebroken === true && r.fout === 'geannuleerd' && Date.now() - t0 < 4000);
    let leeft = true;
    try { process.kill(pid, 0); } catch { leeft = false; }
    ok('de nep-yt-dlp kreeg SIGINT (zoals Ctrl-C), stopte zelf en is weg', !leeft && regels().some((x) => x.wat === 'gestopt' && x.pid === pid));
    ok('de werkmap is opgeruimd, er staat niets in media/', werkmappen().length === 0 && readdirSync(media).length === 0);

    // yt-dlp met ffmpeg als downloader (livestream, HLS): dat kind schrijft in
    // ONZE pijpen. Met SIGTERM viel yt-dlp om, liep het kind door en hield de
    // pijp vast: run() kwam pas terug als het kind klaar was — bij een
    // livestream nooit, en de wachtrij stond stil ("stoppen").
    const leeftNog = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
    for (const [link, wat] of [['nummer-kind-traag', 'yt-dlp met een kind op onze pijp: ruimt het zelf op (SIGINT)'],
      ['nummer-kind-doof-traag', 'reageert hij niet op SIGINT: na 3 s hij én zijn kind SIGKILL']]) {
      const ac3 = new AbortController();
      const p3 = ing.ingest(`http://127.0.0.1:9/${link}`, { mediaDir: media, video: false, signal: ac3.signal });
      let k;
      for (let i = 0; i < 200 && !(k = regels().find((x) => x.wat === 'kind' && x.url.endsWith(link))); i++) await wacht(50);
      const ouder = k?.pid, kleinkind = k?.kind;
      ac3.abort();
      const t3 = Date.now();
      const r3 = await Promise.race([p3, wacht(10000).then(() => null)]);
      ok(`${wat}: geannuleerd na ${Date.now() - t3} ms`, !!k && r3?.afgebroken === true && Date.now() - t3 < 8000);
      await wacht(100);
      ok('  yt-dlp en zijn kind zijn allebei weg, geen werkmap', !!k && !leeftNog(ouder) && !leeftNog(kleinkind) && werkmappen().length === 0);
      // Faalde het, dan niets laten slingeren (alleen wat deze test zelf startte).
      for (const x of [ouder, kleinkind]) if (x) { try { process.kill(x, 'SIGKILL'); } catch {} }
      await p3;
    }

    // Een gewone: loopt helemaal door, met voortgang van ffmpeg ook.
    const st2 = [];
    const r2 = await ing.ingest('http://127.0.0.1:9/nummer-b', { mediaDir: media, video: false, onStap: (s) => st2.push({ ...s }) });
    ok(`zonder annuleren: klaar (${r2.fout ?? r2.track?.id})`, r2.ok && r2.track.id === 'generic-nummer-b');
    ok('metadata vroeg --flat-playlist (een playlist wordt niet afgelopen)', regels().filter((x) => x.wat === 'meta').every((x) => x.args.includes('--flat-playlist')));
    ok('meten en normaliseren melden een percentage uit ffmpeg', ['meten', 'normaliseren'].every((k) => st2.some((s) => s.stap === k && s.pct > 0)));
    // Dubbel: de library zegt "heb ik al" → geen download.
    const vorige = regels().length;
    const r3 = await ing.ingest('http://127.0.0.1:9/nummer-b?andere=link', { mediaDir: media, video: false, bestaat: async (id) => (id === 'generic-nummer-b' ? { id, titel: 'al' } : null) });
    const nieuw = regels().slice(vorige).map((x) => x.wat);
    ok(`bestaat al (na de metadata): geen download (${nieuw.join(',')})`, r3.ok && r3.bestond && r3.track.titel === 'al' && !nieuw.includes('download'));
    const r4 = await ing.ingest('http://127.0.0.1:9/een-lijst', { mediaDir: media });
    ok(`playlist uit de metadata: geweigerd ("${r4.fout}")`, !r4.ok && r4.playlist === true && /playlist \(3 nummers\)/.test(r4.fout));
    const r5 = await ing.ingest('http://127.0.0.1:9/kapot', { mediaDir: media });
    ok('een kapotte link: de foutregel van yt-dlp', !r5.ok && /kapotte link/.test(r5.fout));
    ok('nergens een werkmap achtergebleven', werkmappen().length === 0);
    delete process.env.VARVE_YTDLP;
  }
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
