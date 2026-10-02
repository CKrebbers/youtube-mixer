// De wachtrij van de ingest, zonder server en zonder netwerk: volgorde,
// annuleren (ook midden in een download van een nep-yt-dlp), playlists
// weigeren, dubbel herkennen, voortgangsberichten.
// Draai met: node test/wachtrij.test.mjs
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const { Wachtrij, isOpen } = await import('../server/wachtrij.js');
const { bekijkLink } = await import('../server/links.js');
const ing = await import('../server/ingest.js');
const { maakOnset, maakToon } = await import('../server/analyze.js');
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

  console.log('\nwachtrij: vooraan (op een track gesleept, VRAGEN J12)');
  {
    const q = new Wachtrij();
    const w = { a: handWerk(), b: handWerk(), c: handWerk(), d: handWerk(), e: handWerk() };
    const o = {};
    o.a = q.voegToe({ sleutel: 'a', werk: w.a.werk }).opdracht;
    o.b = q.voegToe({ sleutel: 'b', werk: w.b.werk }).opdracht;
    o.c = q.voegToe({ sleutel: 'c', werk: w.c.werk }).opdracht;
    o.d = q.voegToe({ sleutel: 'd', werk: w.d.werk, vooraan: true }).opdracht;
    o.e = q.voegToe({ sleutel: 'e', werk: w.e.werk, vooraan: true }).opdracht;
    ok(`vooraan: vóór wat gewoon wacht, achter een eerdere vooraan; wat loopt blijft lopen (${['b', 'c', 'd', 'e'].map((k) => k + o[k].plek).join(' ')})`,
      o.a.status === 'bezig' && o.d.plek === 1 && o.e.plek === 2 && o.b.plek === 3 && o.c.plek === 4);
    await wacht(0);
    w.a.klaar({ ok: true, track: track('A') });
    await wacht(5);
    ok('... en daarna begint de vooraan-opdracht, niet de oudste', o.d.status === 'bezig' && w.d.gestart && !w.b.gestart);
    for (const k of ['d', 'e', 'b', 'c']) { w[k].klaar({ ok: true, track: track(k) }); await wacht(5); }
    await q.stil();
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
  // "videoseries" en "live_stream" zijn 11 tekens, maar geen video-id.
  ok('een ingesloten playlist (embed/videoseries?list=): playlist, niet watch?v=videoseries',
    ['https://www.youtube.com/embed/videoseries?list=PLabc', 'https://www.youtube-nocookie.com/embed/videoseries?list=PLx']
      .every((u) => bekijkLink(u).playlist === true));
  ok('embed/live_stream?channel=: de livestream van een kanaal, geweigerd',
    bekijkLink('https://www.youtube.com/embed/live_stream?channel=UC123').playlist === true);
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
  ok('stappen: link met video, bestand zonder', ing.stappenVoor().join() === 'metadata,audio,meten,normaliseren,peaks,onset,grid,toon,video'
    && ing.stappenVoor({ link: false, video: false }).join() === 'meten,normaliseren,peaks,onset,grid,toon');

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
      st.map((s) => s.stand[0]).join('') === 'ggnssssss' && st[1].naam === 'download' && st[4].naam === 'golfvorm'
      && st[7].naam === 'toonsoort');
    ok('klaar: alles gedaan; wacht: niets', stappenStand({ status: 'klaar', stap: 'klaar', stappen: ['a', 'b'] }).every((s) => s.stand === 'gedaan')
      && stappenStand({ status: 'wacht', stap: 'wachten', stappen: ['a', 'b'] }).every((s) => s.stand === 'straks'));

    // Een op een track gesleept bestand waarvan de server de opdracht niet meer
    // kent (herstart: de rij staat in zijn geheugen) komt nooit af: niet eeuwig
    // blijven pollen. Maar een upload die terugkomt terwijl een poll onderweg
    // is, mag dat oudere antwoord niet wissen.
    const { IngestStrook } = await import('../src/ui/ingest-strook.js');
    const [fetch0, interval0] = [globalThis.fetch, globalThis.setInterval];
    let houdVast = null;
    globalThis.fetch = async () => { await houdVast; return { json: async () => ({ opdrachten: [] }) }; };
    globalThis.setInterval = () => 0;
    const el = { addEventListener() {}, classList: { toggle() {} }, innerHTML: '', contains: () => true };
    const strook = new IngestStrook({ el });
    globalThis.setInterval = interval0;
    await wacht(0);
    strook.naLaden.set('weg-na-herstart', 'A');
    await strook.poll();
    ok('na een herstart van de server: niet blijven wachten op een opdracht die hij niet meer kent', !strook.naLaden.has('weg-na-herstart'));
    let laat;
    houdVast = new Promise((z) => { laat = z; });
    const onderweg = strook.poll();
    strook.naLaden.set('net-geupload', 'B');
    laat();
    await onderweg;
    ok('een upload die terugkwam terwijl een poll onderweg was, blijft wachten', strook.naLaden.get('net-geupload') === 'B');

    // Na een herstart van de server is de rij leeg (hij staat in zijn geheugen).
    // De strook zegt dat, en zet met één klik terug wat de browser nog weet.
    const posts = [];
    let antwoord = null, postFout = false;
    globalThis.fetch = async (u, opties = {}) => {
      if (opties.method === 'POST') {
        const body = JSON.parse(opties.body);
        posts.push(body);
        if (postFout) throw new Error('server weg');
        return { ok: true, status: 202, json: async () => ({ resultaten: body.urls.map((x) => ({ code: 202, url: x, status: 'wacht' })) }) };
      }
      const a = typeof antwoord === 'function' ? await antwoord() : antwoord;
      return { json: async () => a };
    };
    // Een upload via een nep-XMLHttpRequest: de server zet hem in de rij (wacht).
    const xhr0 = globalThis.XMLHttpRequest;
    let volgendeUpload = 'b1';
    globalThis.XMLHttpRequest = class {
      constructor() { this.upload = {}; }
      open() {} setRequestHeader() {} abort() {}
      send() { const id = volgendeUpload; setTimeout(() => { this.status = 202; this.responseText = JSON.stringify({ id, status: 'wacht', soort: 'bestand' }); this.onload(); }, 0); }
    };
    globalThis.setInterval = () => 0;
    const meldingen = [], buiten = [];
    let paneelOpen = true;
    const el2 = { addEventListener() {}, classList: { toggle() {} }, innerHTML: '', contains: () => true };
    const buitenWeg = [];
    const s2 = new IngestStrook({ el: el2, meld: (t) => meldingen.push(t), open: () => paneelOpen,
      meldBuiten: (t) => { buiten.push(t); return { remove: () => buitenWeg.push(t) }; } });
    globalThis.setInterval = interval0;
    const bestand = { name: 'eigen.wav', size: 10 };
    const L1 = { id: 'l1', soort: 'link', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', status: 'bezig', stappen: [] };
    const L2 = { id: 'l2', soort: 'link', url: 'http://127.0.0.1:9/nummer-b', status: 'wacht', plek: 1 };
    const L3 = { id: 'l3', soort: 'link', url: 'http://127.0.0.1:9/toch-opnieuw', status: 'wacht', plek: 2, opnieuw: true };
    const B1 = { id: 'b1', soort: 'bestand', url: 'bestand:eigen.wav', titel: 'eigen', status: 'wacht', plek: 3 };
    const B2 = { id: 'b2', soort: 'bestand', url: 'bestand:ander.mp4', titel: 'ander', status: 'wacht', plek: 4 };
    const K = { id: 'k', soort: 'link', url: 'http://127.0.0.1:9/al-klaar', status: 'klaar', klaar: Date.now() };
    // Zoals de server: vlak na de upload staat hij in de lijst, en de lijst
    // staat op NIEUWSTE EERST (lijst()). Terugzetten moet in de volgorde van de rij.
    antwoord = { opdrachten: [B1], server: 'run-1' };
    await s2.uploadBestand(bestand, { naDeck: 'C' });
    await wacht(0);
    ok('een upload die in de rij staat: de strook onthoudt het bestand (en de track)', s2.bestanden.get('b1')?.file === bestand && s2.bestanden.get('b1')?.naDeck === 'C');
    antwoord = { opdrachten: [K, B2, B1, L3, L2, L1], server: 'run-1' };
    await s2.poll();
    antwoord = { opdrachten: [K, B2, B1, L3, L1], server: 'run-1' };
    await s2.poll();
    ok('dezelfde server, een opdracht minder (af en weggeklikt): geen herstart', s2.herstart === null && !/herstart/.test(el2.innerHTML));
    antwoord = { opdrachten: [K, B2, B1, L3, L2, L1], server: 'run-1' };
    await s2.poll();
    // Een tweede upload komt terug, maar vóór de volgende poll gaat de server om:
    // die staat alleen in `bestanden`, niet in de vorige lijst.
    const laatBestand = { name: 'laat.wav', size: 20 };
    volgendeUpload = 'b3';
    antwoord = async () => { throw new Error('server weg'); };
    await s2.uploadBestand(laatBestand);
    await wacht(0);
    ok('een upload die terugkwam terwijl de server al wegviel: ook onthouden', s2.bestanden.get('b3')?.file === laatBestand);
    // Een late poll van de OUDE server kan pas na de nieuwe terugkomen.
    let laatOud;
    antwoord = () => new Promise((z) => { laatOud = () => z({ opdrachten: [K, B2, B1, L3, L2, L1], server: 'run-1' }); });
    const oudOnderweg = s2.poll();
    await wacht(0);
    paneelOpen = false;
    antwoord = { opdrachten: [], server: 'run-2' };
    await s2.poll();
    ok(`andere server: wat wachtte of liep is weg, gemeld ("${meldingen.at(-1)}")`,
      /de server is herstart: 6 opdrachten uit de wachtrij zijn weg/.test(meldingen.at(-1)) && /opnieuw/.test(meldingen.at(-1)));
    ok(`het paneel is dicht: ook onderaan gemeld ("${buiten.at(-1)}")`, buiten.length === 1 && /6 opdrachten.*open de library/.test(buiten[0]));
    ok('de strook toont het bovenaan, met "opnieuw" en welk bestand opnieuw gesleept moet',
      /ing-rij herstart/.test(el2.innerHTML) && /data-herstart="opnieuw"/.test(el2.innerHTML) && /6 opdrachten/.test(el2.innerHTML) && /opnieuw slepen: ander/.test(el2.innerHTML));
    ok('in de volgorde van de rij (niet nieuwste eerst): links, bewaarde bestanden (ook de late), het onbekende apart; wat klaar was niet',
      s2.herstart?.links.join() === [L1.url, L2.url, L3.url].join() && s2.herstart.opnieuw.join() === L3.url
      && s2.herstart.bestanden.map((x) => x.file.name).join() === 'eigen.wav,laat.wav' && s2.herstart.kwijt.join() === 'ander');
    const n0 = meldingen.length;
    laatOud();
    await oudOnderweg;
    ok('een laat antwoord van de oude server telt niet (geen "herstart" terug, de lijst blijft leeg)',
      meldingen.length === n0 && s2.server === 'run-2' && s2.opdrachten.length === 0 && s2.herstart?.links.length === 3);
    await s2.poll();
    ok('de volgende poll (zelfde nieuwe server): niet nog eens', meldingen.length === n0 && buiten.length === 1 && s2.herstart?.links.length === 3);
    paneelOpen = true;
    const opnieuw = [];
    s2.uploadBestand = async (file, opties) => { opnieuw.push({ file, ...opties }); };
    const klik = (herstart) => s2._klik({ target: { closest: () => ({ dataset: { herstart } }) } });
    postFout = true;
    await klik('opnieuw');
    ok('opnieuw terwijl de server nog weg is: de melding blijft staan, niets kwijt', s2.herstart?.links.length === 3 && /lukte niet/.test(meldingen.at(-1)));
    postFout = false;
    posts.length = 0;
    await klik('opnieuw');
    ok(`opnieuw: de links terug in de rij, "toch opnieuw" apart (${JSON.stringify(posts)})`, posts.length === 2
      && posts[0].urls.join() === [L1.url, L2.url].join() && !posts[0].opnieuw && posts[1].urls.join() === L3.url && posts[1].opnieuw === true);
    ok('en de melding onderaan is weg (je koos al)', buitenWeg.length === 1 && buitenWeg[0] === buiten[0]);
    ok('en de bewaarde bestanden opnieuw geüpload, naar dezelfde track', opnieuw.length === 2 && opnieuw[0].file === bestand && opnieuw[0].naDeck === 'C'
      && opnieuw[1].file === laatBestand && !opnieuw[1].naDeck);
    ok(`de melding zegt hoeveel ("${meldingen.at(-1)}"), de strook is weer gewoon`, /3 in de wachtrij/.test(meldingen.at(-1)) && s2.herstart === null && !/herstart/.test(el2.innerHTML));
    antwoord = { opdrachten: [L1], server: 'run-2' };
    await s2.poll();
    antwoord = { opdrachten: [], server: 'run-3' };
    await s2.poll();
    ok('paneel open: alleen in het paneel, niet onderaan', buiten.length === 1 && /1 opdracht uit de wachtrij is weg/.test(meldingen.at(-1)));
    posts.length = 0;
    await klik('laat');
    ok('× bij de herstartmelding: weg, niets opnieuw', s2.herstart === null && posts.length === 0);
    const s3 = new IngestStrook({ el: el2, meld: (t) => meldingen.push(t) });
    antwoord = { opdrachten: [], server: 'run-4' };
    await s3.poll();
    ok('een pagina die net geladen is: niets te melden', s3.herstart === null);
    globalThis.XMLHttpRequest = xhr0;
    globalThis.fetch = fetch0;
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
    // De toonsoort (ronde 1) is ook een stap van de pijplijn: die stopt net zo.
    const ac3 = new AbortController();
    const t2 = Date.now();
    const pt = maakToon(lang, { signal: ac3.signal });
    setTimeout(() => ac3.abort(), 150);
    const rt = await pt;
    ok(`toonsoort-worker: stopt ook meteen (${Date.now() - t2} ms)`, rt.afgebroken === true && Date.now() - t2 < 2000);
    await wacht(800);
    let kinderen = '';
    try { kinderen = execFileSync('pgrep', ['-P', String(process.pid), 'ffmpeg']).toString().trim(); } catch {}
    ok(`en zijn ffmpeg is ook weg (${kinderen || 'geen'})`, kinderen === '');

    /*
     * Zombies. De ffmpeg van een worker hoort bij de lus van die worker; een
     * terminate() liet hem als <defunct> onder ons staan tot het proces stopte
     * (pgrep hierboven ziet dat niet: een zombie heeft geen naam meer). ps
     * telt ze wel. Gemeten vóór het herstel: 5× annuleren = 5 zombies.
     */
    const onzeKinderen = () => execFileSync('ps', ['-A', '-o', 'pid=,ppid=,stat=,comm=']).toString().split('\n')
      .map((l) => l.trim().split(/\s+/)).filter((d) => Number(d[1]) === process.pid && d[3] !== 'ps')
      .map(([pid, , stat, comm]) => `${pid} ${stat} ${comm}`);
    /*
     * Wat BLIJFT staan. Onder zware belasting (load 130) zag ps één keer een
     * kind dat nog aan het starten of stoppen was ("?NE (node)"; welk is niet
     * vastgesteld, vermoedelijk de ps van nakomelingen() uit een eerdere
     * check). Zoiets is even later weg; een zombie blijft tot het proces stopt.
     */
    const blijvend = async () => {
      for (let i = 0; i < 30; i++) { if (!onzeKinderen().length) return []; await wacht(100); }
      return onzeKinderen();
    };
    const { maakPeaks, maakGrid, maakOnsets, verfijnUitBestand, STOP_NOODREM_MS } = await import('../server/analyze.js');
    const duren = [];
    for (let i = 0; i < 5; i++) {
      const ac5 = new AbortController();
      const t = Date.now();
      const p5 = (i % 2 ? maakPeaks : maakOnset)(lang, join(map, `z${i}.bin`), { signal: ac5.signal });
      setTimeout(() => ac5.abort(), 150);
      const r5 = await p5;
      duren.push(r5.afgebroken ? Date.now() - t : -1);
    }
    const over = await blijvend();
    ok(`5× annuleren midden in golfvorm/ritme (${duren.join(', ')} ms): alle 5 geannuleerd`, duren.every((d) => d > 0 && d < 2000));
    ok(`  en er blijft niets onder ons staan, ook geen zombie (${over.join('; ') || 'niets'})`, over.length === 0);

    // Het grid leest per stuk 40 s audio (ook ffmpeg): kort audiobestand met een puls.
    const kort = join(map, 'kort.wav');
    await ing.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', "aevalsrc='0.8*sin(2*PI*900*t)*exp(-60*mod(t,0.5))':s=48000:d=40", '-ac', '2', kort]);
    const on = await maakOnset(kort, join(map, 'kort.bin'));
    const acG = new AbortController();
    const pG = maakGrid(join(map, 'kort.bin'), on.envRate, on.tijdOffset, kort, { signal: acG.signal });
    setTimeout(() => acG.abort(), 60);
    const rG = await pG;
    const overG = await blijvend();
    ok(`grid annuleren: geannuleerd, niets over (${overG.join('; ') || 'niets'})`, on.ok && rG.afgebroken === true && overG.length === 0);

    /*
     * Annuleren terwijl de worker REKENT (zijn ffmpeg is al gelezen): 'stop'
     * komt pas aan als de lus vrij is. Dan de noodrem: terminate() na
     * STOP_NOODREM_MS. Er loopt op dat moment geen ffmpeg, dus ook geen zombie.
     */
    const acR = new AbortController();
    const tR = Date.now();
    const pR = maakOnset(lang, join(map, 'reken.bin'), { signal: acR.signal });
    let zag = false, rekent = false;
    for (let i = 0; i < 3000 && !rekent; i++) {
      const k = onzeKinderen().some((x) => x.endsWith('ffmpeg'));
      if (k) zag = true;
      else if (zag) rekent = true;
      if (!rekent) await wacht(10);
    }
    const tStop = Date.now();
    acR.abort();
    const rR = await pR;
    const dR = Date.now() - tStop;
    const overR = await blijvend();
    ok(`annuleren tijdens het rekenen (ffmpeg klaar na ${tStop - tR} ms${rekent ? '' : ', NIET gezien'}): `
      + `${rR.afgebroken ? 'gestopt' : `"${rR.fout ?? 'klaar'}"`} na ${dR} ms (noodrem ${STOP_NOODREM_MS} ms), over: ${overR.join('; ') || 'niets'}`,
    rekent && rR.afgebroken === true && dR < STOP_NOODREM_MS + 1500 && overR.length === 0);

    // Zonder signal (tap-verfijning, achtergrond-heranalyse, onsets): ongewijzigd.
    const g = await maakGrid(join(map, 'kort.bin'), on.envRate, on.tijdOffset, kort);
    const v = await verfijnUitBestand(join(map, 'kort.bin'), on.envRate, 120, on.tijdOffset, { rond: 20, audio: kort });
    const o = await maakOnsets(join(map, 'kort.bin'), on.envRate, on.tijdOffset);
    ok(`zonder signal: grid (${g.grid?.stukken?.[0]?.bpm?.toFixed(1)} bpm), verfijning (${v.bpm?.toFixed(2)}) en onsets werken`,
      g.ok && Math.abs(g.grid.stukken[0].bpm - 120) < 1 && v.ok && Math.abs(v.bpm - 120) < 0.5 && o.ok && o.tijden.length > 50);
    // De worker luistert nu naar 'stop'; na zijn antwoord moet hij toch vanzelf stoppen,
    // anders blijft er per analyse een thread hangen. Een los proces zonder
    // process.exit() eindigt alleen als dat zo is.
    // Als bestand, niet met -e: een worker erft de vlaggen van node, en --input-type mag daar niet.
    const script = join(map, 'los.mjs');
    writeFileSync(script, `const m = await import(${JSON.stringify(new URL('../server/analyze.js', import.meta.url).href)});\n`
      + `const r = await m.maakOnsets(${JSON.stringify(join(map, 'kort.bin'))}, ${on.envRate}, ${on.tijdOffset});\nconsole.log(r.ok);\n`);
    const tL = Date.now();
    let los = '';
    try { los = execFileSync(process.execPath, [script], { timeout: 15000 }).toString().trim(); } catch (err) { los = `hing of viel om: ${err.message.split('\n')[0]}`; }
    ok(`een worker stopt vanzelf na zijn antwoord (los proces eindigt na ${Date.now() - tL} ms: ${los})`, los === 'true');
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

    // Livestreams: meteen na de metadata geweigerd, nooit een download (die
    // liep anders tot de time-out van 30 min en mislukte dan alsnog).
    for (const [link, wat, reden] of [['nu-live', 'een lopende livestream (live_status is_live)', /livestream die nu loopt/],
      ['straks-live', 'een aangekondigde livestream (is_upcoming)', /nog niet begonnen/],
      ['oud-live', 'alleen is_live: true (zonder live_status)', /livestream die nu loopt/]]) {
      const voor = regels().length;
      const tL = Date.now();
      const rl = await ing.ingest(`http://127.0.0.1:9/${link}`, { mediaDir: media });
      const wat2 = regels().slice(voor).map((x) => x.wat);
      ok(`${wat}: geweigerd na ${Date.now() - tL} ms, zonder download ("${rl.fout}")`,
        !rl.ok && rl.live === true && reden.test(rl.fout) && /Nep /.test(rl.fout) && wat2.join() === 'meta');
    }
    const voorWas = regels().length;
    const rw2 = await ing.ingest('http://127.0.0.1:9/was-live', { mediaDir: media, video: false });
    ok(`een afgelopen livestream (was_live) is gewoon een video: binnengehaald (${rw2.fout ?? rw2.track?.id})`,
      rw2.ok && rw2.track.id === 'generic-was-live' && regels().slice(voorWas).some((x) => x.wat === 'download'));
    ok('liveReden: alleen is_live en is_upcoming; was_live, post_live en not_live niet',
      !!ing.liveReden({ live_status: 'is_live' }) && !!ing.liveReden({ live_status: 'is_upcoming' }) && !!ing.liveReden({ is_live: true })
      && ['was_live', 'post_live', 'not_live'].every((s) => ing.liveReden({ live_status: s, is_live: false }) === null)
      && ing.liveReden({ is_live: true, live_status: 'was_live' }) === null && ing.liveReden({}) === null && ing.liveReden(null) === null);
    // In de wachtrij: mislukt met de reden, en de volgende begint meteen.
    const qL = new Wachtrij();
    const oL = qL.voegToe({ sleutel: 'l', werk: (onStap, signal) => ing.ingest('http://127.0.0.1:9/nu-live', { mediaDir: media, onStap, signal }) }).opdracht;
    const oN = qL.voegToe({ sleutel: 'n', werk: async () => ({ ok: true, track: track('N') }) }).opdracht;
    await qL.stil();
    ok(`in de wachtrij: "mislukt" met de reden, live: true, en de volgende loopt (${oL.tekst.slice(0, 60)}…)`,
      oL.status === 'mislukt' && oL.live === true && /livestream/.test(oL.fout) && oN.status === 'klaar');
    ok('nergens een werkmap achtergebleven', werkmappen().length === 0);
    delete process.env.VARVE_YTDLP;
  }
} finally {
  rmSync(map, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
