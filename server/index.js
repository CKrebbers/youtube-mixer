import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, rm } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { ingest, ingestBestand, onderzoek, werkmap, controleerTooling, YTDLP_GETEST_OP } from './ingest.js';
import { normaliseerLink, ontsmetNaam, BESTAND_EXT } from './links.js';
import { Library, normaliseerGrid, SORTERING, isSortering, MAX_PER_PAGINA, MAX_HOTCUES } from './library.js';
import { ZEKER_VANAF } from './analyze.js';
import { maakOnset, verfijnUitBestand, maakGrid, maakOnsets } from './analyze.js';
import * as opname from './opname.js';

/**
 * Kleine server, geen framework. Doet drie dingen: statische bestanden
 * serveren, ingest-opdrachten aannemen, en vertellen hoe ze aflopen.
 *
 * Hij serveert met `no-store`. Chrome houdt ES-modules anders hardnekkig vast
 * en dan debug je een versie die niet meer bestaat.
 */

const WORTEL = fileURLToPath(new URL('..', import.meta.url));
const POORT = Number(process.env.PORT) || 8777;
// Instelbaar voor de tests: zo komt een testserver nooit aan Clay's media/
// (ook het opruimen van .bezig-mappen bij het opstarten niet — dat wiste
// anders de werkmap van een ingest die op de echte server liep).
const MEDIA = process.env.VARVE_MEDIA || join(WORTEL, 'media');

/**
 * Paden in de database zijn relatief ("media/<id>/audio.wav"), zoals de browser
 * ze opvraagt. Deze twee vertalen naar en van de schijf.
 */
const opSchijf = (rel) => {
  const p = String(rel).replace(/^\/+/, '');
  return p.startsWith('media/') ? join(MEDIA, p.slice('media/'.length)) : join(WORTEL, p);
};
const alsPad = (abs) => 'media/' + relative(MEDIA, abs).split(sep).join('/');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

/** Opdrachten leven in het geheugen. Wat af is, gaat de database in. */
const opdrachten = new Map();
// Instelbaar voor de tests: een eigen database en opnamemap, niet de jouwe.
const lib = new Library(process.env.VARVE_DB || join(WORTEL, 'media', 'library.db'));

/**
 * Cross-origin isolation. Nodig zodra de decks via een AudioWorklet met
 * SharedArrayBuffer gaan draaien; nu alvast aan, want vandaag breekt het niets
 * (de pagina heeft geen enkele cross-origin verwijzing) en straks zou je moeten
 * zoeken naar wat er stuk ging. localhost is een secure context, dus dit werkt
 * zonder HTTPS.
 *
 * Let op als de thumbnail ooit in beeld komt: die staat als i.ytimg.com-URL in
 * de database en wordt dan geblokkeerd. Oplossing is hem bij de ingest
 * binnenhalen, net als audio en video.
 */
const ISOLATIE = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const json = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...ISOLATIE });
  res.end(body);
};

async function leesJson(req, max = 64 * 1024) {
  return new Promise((klaar) => {
    let data = '';
    req.on('data', (d) => {
      data += d;
      if (data.length > max) { req.destroy(); klaar(null); }
    });
    req.on('end', () => { try { klaar(JSON.parse(data || '{}')); } catch { klaar(null); } });
    req.on('error', () => klaar(null));
  });
}

/** Ruwe bytes, voor opname-stukken. Eén seconde stereo 16-bit is 192 kB. */
async function leesRuw(req, max = 4 * 1024 * 1024) {
  return new Promise((klaar) => {
    const delen = [];
    let n = 0;
    req.on('data', (d) => {
      n += d.length;
      if (n > max) { req.destroy(); klaar(null); return; }
      delen.push(d);
    });
    req.on('end', () => klaar(Buffer.concat(delen)));
    req.on('error', () => klaar(null));
  });
}

/** Start een ingest van een link en laat hem op de achtergrond lopen. */
function startIngest(url) {
  return startOpdracht(url, url, (onStap) => ingest(url, { mediaDir: MEDIA, onStap }));
}

/**
 * Een opdracht op de achtergrond: `werk(onStap)` geeft wat ingest() geeft.
 * `sleutel` voorkomt dubbel werk: dezelfde link (of hetzelfde bestand) twee
 * keer terwijl de eerste nog loopt geeft de lopende terug.
 */
function startOpdracht(sleutel, url, werk) {
  for (const o of opdrachten.values()) if (o.sleutel === sleutel && o.status === 'bezig') return o;
  const id = randomUUID().slice(0, 8);
  const opdracht = {
    id, sleutel, url, status: 'bezig', stap: 'wachten', tekst: 'in de wachtrij',
    pct: null, begonnen: Date.now(), klaar: null, fout: null, track: null,
  };
  opdrachten.set(id, opdracht);

  werk((s) => { Object.assign(opdracht, s); }).then((r) => {
    opdracht.klaar = Date.now();
    if (r.ok) {
      opdracht.status = 'klaar';
      opdracht.stap = 'klaar';
      opdracht.pct = null;
      opdracht.tekst = r.track.videoFout
        ? `klaar (zonder video: ${r.track.videoFout}) — ${r.track.titel}`
        : `klaar — ${r.track.titel}`;
      // Paden relatief maken: de browser vraagt ze straks op via deze server.
      opdracht.track = { ...r.track,
        audio: alsPad(r.track.audio),
        video: r.track.video ? alsPad(r.track.video) : null };
      if (r.track.peaks) {
        opdracht.track.peaks = { ...r.track.peaks, bestand: alsPad(r.track.peaks.bestand) };
      }
      if (r.track.onset) {
        opdracht.track.onset = { ...r.track.onset, bestand: alsPad(r.track.onset.bestand) };
      }
      try {
        lib.bewaarTrack(opdracht.track);
        if (opdracht.track.peaks) lib.bewaarPeaks(opdracht.track.id, opdracht.track.peaks);
        // De ingest rekende de envelope al uit; zonder dit deed de eerste tap
        // het hele werk nog een keer.
        if (opdracht.track.onset) lib.bewaarOnset(opdracht.track.id, opdracht.track.onset);
        // Het grid-voorstel van de ingest. Nooit over een grid op slot, en bij
        // opnieuw binnenhalen ook niet over een grid dat je met de hand bewerkte.
        if (opdracht.track.grid) {
          const g = lib.bewaarAutoGrid(opdracht.track.id, opdracht.track.grid);
          console.log(`[grid] ${opdracht.track.titel}: ${g.bewaard ? gridSamenvatting(g.grid) : `voorstel niet bewaard (${g.reden})`}`);
        }
        onsetCache.delete(opdracht.track.id);
      } catch (err) {
        // De ingest is gelukt; dat mag niet alsnog omvallen op de database.
        console.error('[server] track niet in library gekregen:', err?.message || err);
      }
    } else {
      opdracht.status = 'mislukt';
      opdracht.fout = r.fout;
      opdracht.tekst = `mislukt — ${r.fout}`;
    }
  }).catch((err) => {
    // Hier mag niets doorheen glippen: een kapotte ingest is normaal bedrijf.
    opdracht.status = 'mislukt';
    opdracht.fout = String(err?.message || err);
    opdracht.tekst = `mislukt — ${opdracht.fout}`;
    opdracht.klaar = Date.now();
  });

  return opdracht;
}

/**
 * Hoe groot een eigen bestand mag zijn. Standaard 8 GB (een uur 4K past
 * erin); VARVE_UPLOAD_MAX in bytes zet het anders — de tests doen dat.
 */
const UPLOAD_MAX = Number(process.env.VARVE_UPLOAD_MAX) > 0 ? Number(process.env.VARVE_UPLOAD_MAX) : 8 * 1024 ** 3;

/**
 * Een eigen bestand binnenhalen: POST /api/upload?naam=<bestandsnaam>, de
 * body is het bestand zelf (application/octet-stream, audio/* of video/*).
 *
 * - GESTREAMD naar een werkmap (media/.bezig-upload-*), nooit in het geheugen:
 *   een video kan gigabytes zijn. Onderweg wordt geteld en gehasht.
 * - Boven UPLOAD_MAX: 413, en wat er al stond gaat weg.
 * - Daarna ffprobe: geen geluidsspoor of geen media = een nette 415.
 * - De id is `lokaal-` + de eerste 12 tekens van de SHA-256 van de inhoud.
 *   Hetzelfde bestand nog eens = hetzelfde nummer; dan wordt er niets
 *   opnieuw gedaan.
 * - De naam is alleen een TITEL (ontsmet), nooit een pad.
 */
async function upload(req, res, url) {
  const naam = ontsmetNaam(url.searchParams.get('naam'));
  if (!naam) return weigerUpload(req, res, 415, { fout: `geen audio- of videobestand — ik neem ${BESTAND_EXT.join(', ')}` });
  const lengte = Number(req.headers['content-length']);
  if (Number.isFinite(lengte) && lengte > UPLOAD_MAX) {
    return weigerUpload(req, res, 413, { fout: `te groot: ${gb(lengte)}, de grens is ${gb(UPLOAD_MAX)}` });
  }

  const map = await werkmap(MEDIA, 'upload');
  const bron = join(map, `bron.${naam.ext}`);
  const hash = createHash('sha256');
  let n = 0;
  const schrijf = createWriteStream(bron);
  /*
   * Met de hand in plaats van pipeline(): bij "te groot" moet het antwoord
   * 413 nog ÉRGENS heen. pipeline() vernietigt bij een fout ook `req`, en
   * daarmee de verbinding — dan zag de browser alleen "verbinding verbroken".
   * Tegendruk: schrijft de schijf trager dan het netwerk, dan wacht req.
   */
  const uitkomst = await new Promise((klaar) => {
    let gemeld = false;
    const eind = (x) => { if (!gemeld) { gemeld = true; klaar(x); } };
    req.on('data', (stuk) => {
      if (gemeld) return;
      n += stuk.length;
      if (n > UPLOAD_MAX) { req.pause(); eind('te groot'); return; }
      hash.update(stuk);
      if (!schrijf.write(stuk)) { req.pause(); schrijf.once('drain', () => { if (!gemeld) req.resume(); }); }
    });
    req.on('end', () => schrijf.end(() => eind('ok')));
    req.on('error', () => eind('afgebroken'));
    req.on('close', () => { if (!req.complete) eind('afgebroken'); });
    schrijf.on('error', (err) => eind(`schrijven mislukt: ${err.message}`));
  });
  if (uitkomst !== 'ok') {
    schrijf.destroy();
    await rm(map, { recursive: true, force: true }).catch(() => {});
    // Na het antwoord de verbinding dicht: de rest van de upload willen we niet.
    res.setHeader('Connection', 'close');
    res.on('finish', () => req.destroy());
    if (uitkomst === 'te groot') return json(res, 413, { fout: `te groot: meer dan ${gb(UPLOAD_MAX)}` });
    return json(res, 400, { fout: `upload ${uitkomst}` });
  }
  if (n === 0) {
    await rm(map, { recursive: true, force: true }).catch(() => {});
    return json(res, 400, { fout: 'leeg bestand' });
  }

  const info = await onderzoek(bron);
  if (!info.ok) {
    await rm(map, { recursive: true, force: true }).catch(() => {});
    return json(res, 415, { fout: `"${naam.naam}": ${info.fout}` });
  }

  const id = `lokaal-${hash.digest('hex').slice(0, 12)}`;
  // Al in de library (en de audio staat er nog)? Dan is er niets te doen.
  const al = lib.track(id);
  if (al && await stat(opSchijf(al.audio)).then(() => true, () => false)) {
    await rm(map, { recursive: true, force: true }).catch(() => {});
    const opdracht = {
      id: randomUUID().slice(0, 8), sleutel: id, url: al.url, status: 'klaar', stap: 'klaar',
      tekst: `al in de library — ${al.titel}`, pct: null, begonnen: Date.now(), klaar: Date.now(),
      fout: null, track: al, bestond: true,
    };
    opdrachten.set(opdracht.id, opdracht);
    return json(res, 200, opdracht);
  }

  // Loopt hetzelfde bestand al (twee keer gesleept)? Dan die, en deze kopie weg.
  const loopt = [...opdrachten.values()].find((o) => o.sleutel === id && o.status === 'bezig');
  if (loopt) {
    await rm(map, { recursive: true, force: true }).catch(() => {});
    return json(res, 202, loopt);
  }
  const titel = info.tags.titel || naam.titel;
  return json(res, 202, startOpdracht(id, `bestand:${naam.naam}`, (onStap) => ingestBestand(bron, {
    id, map, mediaDir: MEDIA, onStap, heeftVideo: info.video,
    info: { url: `bestand:${id.slice('lokaal-'.length)}:${naam.naam}`, titel, uploader: info.tags.artiest },
  })));
}

/**
 * Een upload weigeren voordat hij gelezen is. Klein (≤ 64 MB): de rest nog
 * leeglezen, anders ziet de browser "verbinding verbroken" in plaats van de
 * reden. Groot of onbekend: antwoorden en de verbinding dichtdoen.
 */
function weigerUpload(req, res, code, data) {
  const lengte = Number(req.headers['content-length']);
  if (Number.isFinite(lengte) && lengte <= 64 * 1024 ** 2) {
    req.resume();
    return json(res, code, data);
  }
  res.setHeader('Connection', 'close');
  res.on('finish', () => req.destroy());
  return json(res, code, data);
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(n < 1024 ** 3 ? 3 : 1)} GB`;

/** Eén regel voor de serverlog: hoeveel stukken, hoeveel ervan zeker. */
function gridSamenvatting(g) {
  if (!g) return 'geen grid';
  const zeker = g.stukken.filter((s) => s.zekerheid === undefined || s.zekerheid >= ZEKER_VANAF).length;
  const tempi = [...new Set(g.stukken.map((s) => s.bpm.toFixed(1)))].slice(0, 6).join('/');
  return `${g.stukken.length} stuk${g.stukken.length === 1 ? '' : 'ken'}, ${zeker} zeker, ${tempi} bpm`;
}

/**
 * De onset-envelope van een nummer, en maak hem als hij er nog niet is
 * (nummers van vóór die functie). Eén tegelijk per nummer: de verfijning,
 * "opnieuw analyseren" en de achtergrond wilden hem anders alle drie maken.
 */
const onsetBezig = new Map();
async function zorgVoorOnset(track) {
  if (track.onset) return { ok: true, onset: track.onset };
  if (!onsetBezig.has(track.id)) {
    const doel = join(MEDIA, track.id, 'onset.bin');
    onsetBezig.set(track.id, maakOnset(opSchijf(track.audio), doel).then((r) => (r.ok
      ? { ok: true, onset: lib.bewaarOnset(track.id, { ...r, bestand: alsPad(doel) }) }
      : { ok: false, fout: r.fout })).finally(() => onsetBezig.delete(track.id)));
  }
  return onsetBezig.get(track.id);
}

/** Het grid-voorstel voor een nummer uit de library (in een worker). */
async function analyseer(track) {
  const o = await zorgVoorOnset(track);
  if (!o.ok) return o;
  return maakGrid(opSchijf(o.onset.bestand), o.onset.envRate, o.onset.tijdOffset, opSchijf(track.audio));
}

/*
 * Onset-pieken per nummer, in het geheugen: ze veranderen alleen als de
 * envelope verandert (opnieuw binnenhalen). Een uur is ~18.000 tijden.
 */
const onsetCache = new Map();

/**
 * Op de achtergrond: elk nummer zonder grid, of met een grid van vóór de
 * automatische analyse (geen slot, geen bron), krijgt een voorstel. Eén
 * tegelijk, pas na het opstarten, en niet terwijl er binnengehaald wordt:
 * dit is het minst belangrijke werk van de server. Het rekenwerk zit in een
 * worker, dus de decks merken er niets van (server.test meet dat).
 *
 * VARVE_HERANALYSE: 'uit' = niet doen (tests die het niet meten), een getal =
 * zoveel ms wachten na het opstarten (standaard 5000).
 */
async function heranalyseOpAchtergrond() {
  const ids = lib.teAnalyseren();
  if (!ids.length) return;
  console.log(`[grid] ${ids.length} nummer${ids.length === 1 ? '' : 's'} zonder automatisch grid — analyse op de achtergrond, één tegelijk`);
  for (const id of ids) {
    while ([...opdrachten.values()].some((o) => o.status === 'bezig')) await new Promise((z) => setTimeout(z, 2000));
    const track = lib.track(id);
    // Intussen getikt, op slot gezet of weggehaald? Dan niet meer.
    if (!track || !lib.teAnalyseren().includes(id)) continue;
    const t0 = Date.now();
    const r = await analyseer(track);
    if (!r.ok) { console.log(`[grid] ${track.titel}: overgeslagen (${r.fout})`); continue; }
    const b = lib.bewaarAutoGrid(id, r.grid, { alleenOud: true });
    console.log(`[grid] ${track.titel}: ${b.bewaard ? gridSamenvatting(b.grid) : `niet bewaard (${b.reden})`}`
      + ` — ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  console.log('[grid] achtergrondanalyse klaar');
}

/**
 * Wat de browser mag ophalen. Een witte lijst in plaats van "alles in de
 * projectmap": anders kon /.git/config of /media/library.db gewoon mee.
 */
const MAG = [/^\/$/, /^\/(index|video|apc)\.html$/, /^\/styles\.css$/, /^\/src\//, /^\/mappings\//,
  /^\/racks\//, /^\/media\/[\w-]+\/(audio\.wav|video\.mp4|peaks\.bin|onset\.bin)$/, /^\/opnames\/set-[\w-]+\.(wav|mp4|webm)$/,
  /^\/favicon\.ico$/];

/**
 * Het pad dat de witte lijst te zien krijgt, of null.
 *
 * De lijst wordt getoetst op het pad NA decoderen en normaliseren, relatief aan
 * de projectmap — anders kwam `/src/..%2fmedia%2flibrary.db` erdoor: het
 * begint met /src/, en pas daarna werd `..` opgelost. Gecodeerde slashes,
 * backslashes, `.`/`..`-segmenten en nulbytes worden gewoon geweigerd; een
 * echte bestandsnaam heeft ze nooit nodig.
 */
function schoonPad(pad) {
  if (/%(2f|5c|00)/i.test(pad)) return null;
  let d;
  try { d = decodeURIComponent(pad); } catch { return undefined; }
  if (d.includes('\\') || d.includes('\0')) return null;
  if (!d.startsWith('/')) d = '/' + d;
  if (d.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  const abs = resolve(WORTEL, '.' + d);
  const rel = relative(WORTEL, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  const schoon = '/' + rel.split(sep).join('/') + (d.endsWith('/') && rel ? '/' : '');
  return MAG.some((r) => r.test(schoon)) ? schoon : null;
}

async function statisch(req, res, pad) {
  const schoon = schoonPad(pad);
  if (schoon === undefined) { json(res, 400, { fout: 'ongeldig pad' }); return; }
  if (schoon === null) { json(res, 404, { fout: 'niet gevonden', pad }); return; }
  const veilig = schoon.startsWith('/media/') ? opSchijf(schoon) : join(WORTEL, schoon);

  let info;
  try { info = await stat(veilig); } catch { json(res, 404, { fout: 'niet gevonden', pad }); return; }
  const bestand = info.isDirectory() ? join(veilig, 'index.html') : veilig;
  try { info = await stat(bestand); } catch { json(res, 404, { fout: 'niet gevonden', pad }); return; }

  const type = TYPES[extname(bestand).toLowerCase()] || 'application/octet-stream';
  const kop = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', ...ISOLATIE };

  // Range-verzoeken: nodig zodra de browser video gaat scrubben.
  // Een leesfout halverwege mag de server niet meenemen.
  const stuur = (stroom) => { stroom.on('error', () => res.destroy()); stroom.pipe(res); };
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      let start, eind;
      if (!m[1]) { start = Math.max(0, info.size - parseInt(m[2], 10)); eind = info.size - 1; }   // "de laatste N bytes"
      else { start = parseInt(m[1], 10); eind = m[2] ? Math.min(parseInt(m[2], 10), info.size - 1) : info.size - 1; }
      if (start >= info.size || eind < start) {
        res.writeHead(416, { ...kop, 'Content-Range': `bytes */${info.size}` });
        res.end();
        return;
      }
      res.writeHead(206, { ...kop, 'Content-Range': `bytes ${start}-${eind}/${info.size}`, 'Content-Length': eind - start + 1 });
      stuur(createReadStream(bestand, { start, end: eind }));
      return;
    }
  }
  res.writeHead(200, { ...kop, 'Content-Length': info.size });
  stuur(createReadStream(bestand));
}

/**
 * Host en Origin. Geeft de reden terug als het verzoek niet van ons is.
 *
 * HOST: tegen DNS-rebinding. Een website kan zijn eigen naam naar 127.0.0.1
 * laten wijzen; de browser vindt de pagina dan "same-origin" met deze server
 * en mag alles lezen — library, opnames. Maar de Host-kop blijft die vreemde
 * naam. Dus: alleen localhost, 127.0.0.1 of [::1], met onze eigen poort.
 *
 * ORIGIN: tegen CSRF. Alles wat iets verandert (niet GET/HEAD) moet van onze
 * eigen pagina komen. Stuurt de client geen Origin (curl, de tests), dan is
 * het geen browser op een vreemde site en mag het. "null" (sandbox, file://)
 * is wél een browser en mag niet.
 */
const EIGEN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
function vreemdVerzoek(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const m = /^(localhost|127\.0\.0\.1|\[::1\]):(\d+)$/.exec(host);
  if (!m || !EIGEN_HOSTS.has(m[1]) || Number(m[2]) !== POORT) return 'onbekende host';
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const origin = req.headers.origin;
  if (origin === undefined) return null;
  if (String(origin).toLowerCase() !== `http://${host}`) return 'verzoek van een andere oorsprong';
  return null;
}

const server = createServer(async (req, res) => {
  try {
    // Eerst: is dit verzoek wel voor ons? Zie `vreemdVerzoek`.
    const vreemd = vreemdVerzoek(req);
    if (vreemd) return json(res, 403, { fout: vreemd });

    const url = new URL(req.url, 'http://localhost');
    const pad = url.pathname;

    if (pad === '/api/tooling') return json(res, 200, await controleerTooling());

    // Alleen JSON: een gewoon formulier of text/plain van een willekeurige
    // website komt zo niet zonder CORS-vraag binnen. Het mediatype zelf moet
    // application/json ZIJN; `text/plain;x=application/json` is text/plain.
    const mediatype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    // Uitzondering: een eigen bestand is binair. Alleen application/octet-stream,
    // audio/* of video/* — geen van drieën mag een website zonder CORS-vraag
    // sturen, dus de bescherming van de JSON-regel blijft. Host/Origin hierboven ook.
    if (pad === '/api/upload' && req.method === 'POST') {
      if (mediatype !== 'application/octet-stream' && !/^(audio|video)\/[\w.+-]+$/.test(mediatype)) {
        return weigerUpload(req, res, 415, { fout: 'stuur het bestand als application/octet-stream' });
      }
      return upload(req, res, url);
    }
    if (req.method === 'POST' && pad !== '/api/opname/start' && !/^\/api\/opname\/[\w-]+\/(stuk|klaar|video\.\w+)$/.test(pad)
      && pad.startsWith('/api/') && mediatype !== 'application/json'
      && !/^\/api\/library\/[\w-]+\/(racks\/\d+|geladen)$/.test(pad)) {
      return json(res, 415, { fout: 'alleen application/json' });
    }

    if (pad === '/api/ingest' && req.method === 'POST') {
      const body = await leesJson(req);
      // YouTube, TikTok of wat yt-dlp verder kent; zie links.js.
      const link = normaliseerLink(body?.url);
      if (!link) return json(res, 400, { fout: 'geef een geldige http(s)-URL' });
      return json(res, 202, startIngest(link));
    }

    if (pad === '/api/ingest' && req.method === 'GET') {
      return json(res, 200, { opdrachten: [...opdrachten.values()].sort((a, b) => b.begonnen - a.begonnen) });
    }

    // ---- library ---------------------------------------------------------

    /*
     * De lijst, per pagina: ?zoek=&sorteer=titel|bpm|duur|toegevoegd|gespeeld
     * &richting=op|af&van=0&aantal=100. Geeft { tracks, totaal, van }; totaal
     * is het aantal treffers, zodat het paneel weet hoe lang de lijst is
     * zonder alles op te halen. Zonder aantal: alles (voor de meet-tools).
     * Eén pagina is hooguit MAX_PER_PAGINA rijen: deze server levert ook de
     * pagina's van spelende decks, dus geen verzoek mag hem lang bezighouden.
     */
    if (pad === '/api/library' && req.method === 'GET') {
      const q = url.searchParams;
      const zoek = q.get('zoek') || '';
      const sorteer = q.get('sorteer') || 'toegevoegd';
      if (!isSortering(sorteer)) return json(res, 400, { fout: `sorteer op ${Object.keys(SORTERING).join(', ')}` });
      const richting = q.get('richting');
      if (richting !== null && richting !== 'op' && richting !== 'af') return json(res, 400, { fout: 'richting is op of af' });
      const heel = (k) => (q.has(k) ? Number(q.get(k)) : null);
      const van = heel('van') ?? 0, aantal = heel('aantal');
      if (!(Number.isSafeInteger(van) && van >= 0)) return json(res, 400, { fout: 'van is een rijnummer vanaf 0' });
      if (aantal !== null && !(Number.isInteger(aantal) && aantal >= 1 && aantal <= MAX_PER_PAGINA)) {
        return json(res, 400, { fout: `aantal is 1..${MAX_PER_PAGINA}` });
      }
      return json(res, 200, {
        tracks: lib.tracks({ zoek, sorteer, richting, van, aantal }),
        totaal: lib.aantalTracks({ zoek }), van,
      });
    }

    const mTrack = /^\/api\/library\/([\w-]+)$/.exec(pad);
    if (mTrack) {
      if (req.method === 'GET') {
        const t = lib.track(mTrack[1]);
        return t ? json(res, 200, { track: t, racks: lib.racks(t.id) }) : json(res, 404, { fout: 'niet in de library' });
      }
      if (req.method === 'DELETE') {
        return json(res, 200, { weg: lib.verwijderTrack(mTrack[1]) });
      }
    }

    // Het grid van een nummer: een tempokaart { stukken: [{ van, bpm, anker }] }.
    // POST neemt ook het oude { bpm, firstBeat } aan (= één stuk).
    const mGrid = /^\/api\/library\/([\w-]+)\/grid$/.exec(pad);
    if (mGrid && req.method === 'GET') {
      const t = lib.track(mGrid[1]);
      return t ? json(res, 200, { grid: t.grid }) : json(res, 404, { fout: 'onbekend nummer' });
    }
    if (mGrid && req.method === 'POST') {
      const body = await leesJson(req);
      if (!lib.track(mGrid[1])) return json(res, 404, { fout: 'onbekend nummer' });
      const grid = body?.grid ?? null;
      if (grid !== null && !normaliseerGrid(grid)) {
        return json(res, 400, { fout: 'ongeldig grid: stukken met van, bpm (40-300) en anker, of { bpm, firstBeat }' });
      }
      return json(res, 200, { grid: lib.bewaarGrid(mGrid[1], grid) });
    }

    /*
     * De tap-hybride.
     *
     * Jij tikt een paar tellen mee; dat geeft het OCTAAF en de grove fase, en
     * juist dat is wat een machine op ambient niet betrouwbaar vindt. De server
     * legt een rechte lijn door je tikken, pakt de bewaarde onset-envelope
     * erbij en verfijnt binnen een marge die meeschaalt met hoe netjes je
     * tikte — de fase alleen binnen een kwart tel van jouw tap, dus nooit op
     * de offbeat. Daarna de voorflank op de audio zelf (±5 ms). Is er rond de
     * tap geen puls, dan zegt hij dat en blijft jouw tap staan.
     */
    /*
     * Opnieuw analyseren (de knop in de library). Geeft het voorstel terug en
     * bewaart het, ook over een met de hand bewerkt grid — daar vroeg je om.
     * Over een grid op SLOT alleen met { forceer: true } (de browser vraagt
     * dan eerst een tweede klik); anders { bewaard: false, reden }.
     */
    const mAnalyseer = /^\/api\/library\/([\w-]+)\/grid\/analyseer$/.exec(pad);
    if (mAnalyseer && req.method === 'POST') {
      const track = lib.track(mAnalyseer[1]);
      if (!track) return json(res, 404, { fout: 'onbekend nummer' });
      const body = await leesJson(req);
      const r = await analyseer(track);
      if (!r.ok) return json(res, 500, { fout: r.fout });
      const b = lib.bewaarAutoGrid(track.id, r.grid, { overHand: true, overSlot: body?.forceer === true });
      console.log(`[grid] opnieuw: ${track.titel}: ${b.bewaard ? gridSamenvatting(b.grid) : `niet bewaard (${b.reden})`}`);
      return json(res, 200, { voorstel: r.grid, bewaard: b.bewaard, grid: b.grid, ...(b.reden ? { reden: b.reden } : {}) });
    }

    /*
     * De onset-pieken van een nummer: { tijden: [s, ...] } gesorteerd, of
     * { tijden: null } zonder envelope. Voor "tel 1 hier" (snapt ±30 ms naar
     * een klap) en de streepjes in de zoom.
     */
    const mOnsets = /^\/api\/library\/([\w-]+)\/onsets$/.exec(pad);
    if (mOnsets && req.method === 'GET') {
      const track = lib.track(mOnsets[1]);
      if (!track) return json(res, 404, { fout: 'onbekend nummer' });
      if (!track.onset) return json(res, 200, { tijden: null });
      const sleutel = track.onset.bestand;
      let c = onsetCache.get(track.id);
      if (!c || c.sleutel !== sleutel) {
        const r = await maakOnsets(opSchijf(track.onset.bestand), track.onset.envRate, track.onset.tijdOffset);
        if (!r.ok) return json(res, 500, { fout: r.fout });
        c = { sleutel, tijden: r.tijden };
        onsetCache.set(track.id, c);
      }
      return json(res, 200, { tijden: c.tijden });
    }

    const mVerfijn = /^\/api\/library\/([\w-]+)\/grid\/verfijn$/.exec(pad);
    if (mVerfijn && req.method === 'POST') {
      const id = mVerfijn[1];
      const track = lib.track(id);
      if (!track) return json(res, 404, { fout: 'onbekend nummer' });
      const body = await leesJson(req);
      const bpm = Number(body?.bpm);
      if (!isFinite(bpm) || bpm < 40 || bpm > 300) return json(res, 400, { fout: 'geef een bpm tussen 40 en 300' });

      // Nog geen envelope (track van vóór deze functie): nu uitrekenen en
      // bewaren, dan is het de volgende keer meteen klaar.
      const o = await zorgVoorOnset(track);
      if (!o.ok) return json(res, 500, { fout: o.fout });
      const onset = o.onset;

      // Waar je tikte (tracktijd, seconden). Dan telt alleen ±45 s daaromheen:
      // op een album met tempowissels wint anders het tempo van een ander stuk.
      // Zonder positie: rond de tikken, of anders de hele track.
      const tijd = (x) => x == null ? null : Number(x);
      const geldigeTijd = (x) => x === null || (Number.isFinite(x) && x >= 0);
      const positie = tijd(body?.positie);
      if (!geldigeTijd(positie)) return json(res, 400, { fout: 'positie moet een tijd in seconden zijn' });
      // De fase van de tap: één getikte tel (anker) en/of de tikken zelf.
      const anker = tijd(body?.anker);
      if (!geldigeTijd(anker)) return json(res, 400, { fout: 'anker moet een tijd in seconden zijn' });
      let taps = null;
      if (body?.taps != null) {
        if (!Array.isArray(body.taps) || body.taps.length > 64) return json(res, 400, { fout: 'taps moet een lijst van hooguit 64 tijden zijn' });
        taps = body.taps.map(Number);
        if (!taps.every((t) => Number.isFinite(t) && t >= 0)) return json(res, 400, { fout: 'taps moeten tijden in seconden zijn' });
      }
      // Marge: meegegeven, of anders beslist de verfijning (met tikken: naar
      // hoe netjes je tikte; zonder: 3%).
      const marge = body?.marge == null ? null : Number(body.marge);
      if (marge !== null && !(marge > 0 && marge <= 0.2)) return json(res, 400, { fout: 'marge moet tussen 0 en 0,2 liggen' });
      // In een worker: 3 uur envelope scoren kostte 7,9 s op de hoofdthread.
      const r = await verfijnUitBestand(opSchijf(onset.bestand), onset.envRate, bpm, onset.tijdOffset,
        { marge, rond: positie, anker, taps, audio: opSchijf(track.audio) });
      if (!r.ok) return json(res, 500, { fout: r.fout });
      /*
       * zeker: false = geen puls rond de tap (de score komt niet boven wat
       * dezelfde zoektocht op door elkaar geschudde envelope haalt). Dan is
       * bpm/firstBeat de tap zelf, en laat de browser zijn tap staan.
       */
      return json(res, 200, {
        getikt: bpm,
        bpm: r.bpm,
        firstBeat: r.firstBeat,
        anker: r.anker,
        zeker: r.zeker,
        ...(r.reden ? { reden: r.reden } : {}),
        score: r.score,
        puls: r.puls,
        verschuiving: r.bpm - bpm,
        marge: r.marge,
        tikken: r.tikken,
        fijn: r.fijn,
        positie: r.positie ?? positie,
      });
    }

    const mGeladen = /^\/api\/library\/([\w-]+)\/geladen$/.exec(pad);
    if (mGeladen && req.method === 'POST') { lib.geladen(mGeladen[1]); return json(res, 200, { ok: true }); }

    // ---- effect-racks: horen bij de link, niet bij een fader --------------

    // ---- opnames van je set: blijven op deze schijf, gaan nergens heen -----

    const OPNAMES = process.env.VARVE_OPNAMES || join(WORTEL, 'opnames');
    if (pad === '/api/opnames' && req.method === 'GET') return json(res, 200, { opnames: await opname.lijst(OPNAMES) });
    if (pad === '/api/opname/start' && req.method === 'POST') {
      const r = await opname.start(OPNAMES);
      return json(res, r.ok ? 200 : 500, r);
    }
    const mVideo = /^\/api\/opname\/([\w-]+)\/video\.(\w+)$/.exec(pad);
    if (mVideo && req.method === 'POST') {
      const stuk = await leesRuw(req, 16 * 1024 * 1024);
      if (!stuk) return json(res, 413, { ok: false, fout: 'videostuk te groot' });
      const r = await opname.voegVideoToe(OPNAMES, mVideo[1], mVideo[2], stuk);
      return json(res, r.ok ? 200 : 400, r);
    }
    const mOpname = /^\/api\/opname\/([\w-]+)\/(stuk|klaar)$/.exec(pad);
    if (mOpname && req.method === 'POST') {
      const [, id, wat] = mOpname;
      // ?frame=N (stuk) en ?frames=N (klaar): de plek op de audioklok. Zonder: oud gedrag.
      const getal = (k) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined);
      if (wat === 'klaar') { const r = await opname.sluit(OPNAMES, id, { frames: getal('frames') }); return json(res, r.ok ? 200 : 400, r); }
      const stuk = await leesRuw(req);
      if (!stuk) return json(res, 413, { ok: false, fout: 'stuk te groot' });
      const r = await opname.voegToe(OPNAMES, id, stuk, getal('frame'));
      return json(res, r.ok ? 200 : 400, r);
    }

    const mRacks = /^\/api\/library\/([\w-]+)\/racks$/.exec(pad);
    if (mRacks) {
      const trackId = mRacks[1];
      if (req.method === 'GET') return json(res, 200, { racks: lib.racks(trackId) });
      if (req.method === 'POST') {
        const body = await leesJson(req);
        if (!body?.naam) return json(res, 400, { fout: 'een rack heeft een naam nodig' });
        if (!lib.track(trackId)) return json(res, 404, { fout: 'onbekend nummer' });
        return json(res, 200, { rack: lib.bewaarRack({
          id: body.id ?? null, trackId, naam: body.naam, data: body.data, actief: !!body.actief }) });
      }
    }

    // ---- je eigen MIDI-mapping: ook hier, niet alleen in de browser --------
    // Een andere browser of gewiste sitedata kostte anders al je koppelingen.
    if (pad === '/api/mapping' && req.method === 'GET') return json(res, 200, { mapping: lib.haal('mapping', null) });
    if (pad === '/api/mapping' && req.method === 'POST') {
      const b = await leesJson(req);
      if (!b?.mapping || !Array.isArray(b.mapping.rules)) return json(res, 400, { fout: 'een mapping heeft rules nodig' });
      lib.zet('mapping', b.mapping);
      return json(res, 200, { ok: true, regels: b.mapping.rules.length });
    }
    // "Standaard herstellen": geen eigen mapping meer, de app volgt weer mappings/apc40mk2.json.
    if (pad === '/api/mapping' && req.method === 'DELETE') { lib.zet('mapping', null); return json(res, 200, { ok: true }); }

    // ---- sampler-pads: horen bij het nummer, net als racks en grid ---------
    const mSamples = /^\/api\/library\/([\w-]+)\/samples(?:\/(\d+))?$/.exec(pad);
    if (mSamples) {
      const [, trackId, padNr] = mSamples;
      if (!padNr && req.method === 'GET') return json(res, 200, { samples: lib.samples(trackId) });
      if (!padNr && req.method === 'POST') {
        const b = await leesJson(req);
        const n = Number(b?.pad), van = Number(b?.van), tot = Number(b?.tot);
        if (!(n >= 1 && n <= 8 && Number.isInteger(n))) return json(res, 400, { fout: 'pad moet 1..8 zijn' });
        if (!(Number.isFinite(van) && Number.isFinite(tot) && van >= 0 && tot > van)) return json(res, 400, { fout: 'ongeldig stuk' });
        if (!lib.track(trackId)) return json(res, 404, { fout: 'onbekend nummer' });
        const getal = (x) => (Number.isFinite(Number(x)) && x !== null ? Number(x) : null);
        return json(res, 200, { sample: lib.bewaarSample(trackId, { pad: n, van, tot, tellen: getal(b.tellen), bpm: getal(b.bpm) }) });
      }
      if (padNr && req.method === 'DELETE') return json(res, 200, { weg: lib.verwijderSample(trackId, Number(padNr)) });
    }

    // ---- hotcues: horen bij het nummer, net als de sampler-pads -------------
    const mHotcues = /^\/api\/library\/([\w-]+)\/hotcues(?:\/(\d+))?$/.exec(pad);
    if (mHotcues) {
      const [, trackId, nrTekst] = mHotcues;
      if (!nrTekst && req.method === 'GET') return json(res, 200, { hotcues: lib.hotcues(trackId) });
      if (!nrTekst && req.method === 'POST') {
        const b = await leesJson(req);
        const nr = Number(b?.nr), tijd = b?.tijd;
        if (!(Number.isInteger(nr) && nr >= 1 && nr <= MAX_HOTCUES)) return json(res, 400, { fout: `nr moet 1..${MAX_HOTCUES} zijn` });
        if (!(typeof tijd === 'number' && Number.isFinite(tijd) && tijd >= 0)) return json(res, 400, { fout: 'tijd in seconden tracktijd, vanaf 0' });
        if (!lib.track(trackId)) return json(res, 404, { fout: 'onbekend nummer' });
        return json(res, 200, { hotcue: lib.bewaarHotcue(trackId, { nr, tijd }) });
      }
      if (nrTekst && req.method === 'DELETE') return json(res, 200, { weg: lib.verwijderHotcue(trackId, Number(nrTekst)) });
    }

    const mRack = /^\/api\/library\/([\w-]+)\/racks\/(\d+)$/.exec(pad);
    if (mRack) {
      const [, trackId, rackId] = mRack;
      if (req.method === 'DELETE') return json(res, 200, { weg: lib.verwijderRack(Number(rackId), trackId) });
      if (req.method === 'POST') {
        return json(res, 200, { rack: lib.zetActiefRack(trackId, Number(rackId)) });
      }
    }

    if (pad.startsWith('/api/')) return json(res, 404, { fout: 'onbekend eindpunt' });

    await statisch(req, res, pad === '/' ? 'index.html' : pad);
  } catch (err) {
    // Eén kapot verzoek mag de server niet meenemen.
    try { json(res, 500, { fout: String(err?.message || err) }); } catch {}
  }
});

// Laatste vangnet. Zonder dit legt één losse promise de hele server om.
// Een upload van gigabytes duurt langer dan de standaard 5 minuten die Node
// een verzoek geeft. Dit is een server op 127.0.0.1 voor één gebruiker.
server.requestTimeout = 60 * 60 * 1000;

process.on('unhandledRejection', (r) => console.error('[server] losse promise:', r));
process.on('uncaughtException', (e) => console.error('[server] onafgevangen:', e?.message || e));

// Werkmappen van een ingest die nooit afkwam (server gestopt midden in een
// download): opruimen. Een goede track staat nooit in zo'n map.
try {
  const { readdir, rm: weg } = await import('node:fs/promises');
  for (const n of await readdir(MEDIA).catch(() => [])) {
    if (n.startsWith('.bezig-')) await weg(join(MEDIA, n), { recursive: true, force: true });
  }
} catch (_) {}

const tooling = await controleerTooling();
if (!tooling.ok) console.warn(`[server] LET OP: ${tooling.ontbreekt.join(', ')} ontbreekt — ingest werkt niet`);
if (tooling.versieWijkt) console.warn(`[server] yt-dlp is ${tooling.ytdlp}, getest op ${YTDLP_GETEST_OP}`);
if (tooling.verouderd) console.warn(`[server] yt-dlp is verouderd (nieuwste ${tooling.nieuwsteYtdlp}) — ${tooling.bijwerken}`);

server.listen(POORT, '127.0.0.1', () => {
  console.log(`VARVE DJ  ·  http://localhost:${POORT}`);
  console.log(`library: ${lib.aantalTracks()} nummers  ·  schema v${lib.versie}`);
  console.log(`yt-dlp ${tooling.ytdlp}  ·  ffmpeg ${tooling.ffmpeg ? 'ok' : 'ONTBREEKT'}`);
  const her = process.env.VARVE_HERANALYSE;
  if (her !== 'uit') {
    setTimeout(() => heranalyseOpAchtergrond().catch((err) => console.error('[grid] achtergrond:', err?.message || err)),
      Number.isFinite(Number(her)) && her !== '' && her !== undefined ? Number(her) : 5000);
  }
});
