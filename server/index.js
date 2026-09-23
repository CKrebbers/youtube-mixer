import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ingest, controleerTooling, YTDLP_GETEST_OP } from './ingest.js';
import { Library } from './library.js';
import { maakOnset, verfijnUitBestand } from './analyze.js';
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

/** Start een ingest en laat hem op de achtergrond lopen. */
function startIngest(url) {
  // Dezelfde URL twee keer plakken terwijl de eerste nog loopt: de lopende
  // teruggeven in plaats van een tweede ernaast te starten.
  for (const o of opdrachten.values()) if (o.url === url && o.status === 'bezig') return o;
  const id = randomUUID().slice(0, 8);
  const opdracht = {
    id, url, status: 'bezig', stap: 'wachten', tekst: 'in de wachtrij',
    pct: null, begonnen: Date.now(), klaar: null, fout: null, track: null,
  };
  opdrachten.set(id, opdracht);

  ingest(url, {
    mediaDir: MEDIA,
    onStap: (s) => { Object.assign(opdracht, s); },
  }).then((r) => {
    opdracht.klaar = Date.now();
    if (r.ok) {
      opdracht.status = 'klaar';
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
    if (req.method === 'POST' && pad !== '/api/opname/start' && !/^\/api\/opname\/[\w-]+\/(stuk|klaar|video\.\w+)$/.test(pad)
      && pad.startsWith('/api/') && mediatype !== 'application/json'
      && !/^\/api\/library\/[\w-]+\/(racks\/\d+|geladen)$/.test(pad)) {
      return json(res, 415, { fout: 'alleen application/json' });
    }

    if (pad === '/api/ingest' && req.method === 'POST') {
      const body = await leesJson(req);
      const link = body?.url?.trim();
      if (!link || !/^https?:\/\//i.test(link)) return json(res, 400, { fout: 'geef een geldige http(s)-URL' });
      return json(res, 202, startIngest(link));
    }

    if (pad === '/api/ingest' && req.method === 'GET') {
      return json(res, 200, { opdrachten: [...opdrachten.values()].sort((a, b) => b.begonnen - a.begonnen) });
    }

    // ---- library ---------------------------------------------------------

    if (pad === '/api/library' && req.method === 'GET') {
      return json(res, 200, { tracks: lib.tracks({ zoek: url.searchParams.get('zoek') || '' }) });
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

    const mGrid = /^\/api\/library\/([\w-]+)\/grid$/.exec(pad);
    if (mGrid && req.method === 'POST') {
      const body = await leesJson(req);
      if (!lib.track(mGrid[1])) return json(res, 404, { fout: 'onbekend nummer' });
      return json(res, 200, { grid: lib.bewaarGrid(mGrid[1], body?.grid ?? null) });
    }

    /*
     * De tap-hybride.
     *
     * Jij tikt een paar tellen mee; dat geeft het OCTAAF en de grove fase, en
     * juist dat is wat een machine op ambient niet betrouwbaar vindt. De server
     * pakt de bewaarde onset-envelope erbij en verfijnt jouw schatting binnen
     * een paar procent marge tot op honderdsten van een bpm en ~10 ms fase.
     * Samen zijn ze beter dan allebei apart.
     */
    const mVerfijn = /^\/api\/library\/([\w-]+)\/grid\/verfijn$/.exec(pad);
    if (mVerfijn && req.method === 'POST') {
      const id = mVerfijn[1];
      const track = lib.track(id);
      if (!track) return json(res, 404, { fout: 'onbekend nummer' });
      const body = await leesJson(req);
      const bpm = Number(body?.bpm);
      if (!isFinite(bpm) || bpm < 40 || bpm > 300) return json(res, 400, { fout: 'geef een bpm tussen 40 en 300' });

      let onset = track.onset;
      if (!onset) {
        // Nog geen envelope (track van vóór deze functie): nu uitrekenen en
        // bewaren, dan is het de volgende keer meteen klaar.
        const doel = join(MEDIA, id, 'onset.bin');
        const r = await maakOnset(opSchijf(track.audio), doel);
        if (!r.ok) return json(res, 500, { fout: r.fout });
        onset = lib.bewaarOnset(id, { ...r, bestand: alsPad(doel) });
      }

      // Waar je tikte (tracktijd, seconden). Dan telt alleen ±45 s daaromheen:
      // op een album met tempowissels wint anders het tempo van een ander stuk.
      // Zonder positie: de hele track.
      const positie = body?.positie == null ? null : Number(body.positie);
      if (positie !== null && !(Number.isFinite(positie) && positie >= 0)) {
        return json(res, 400, { fout: 'positie moet een tijd in seconden zijn' });
      }
      const marge = Number(body?.marge) || 0.03;
      // In een worker: 3 uur envelope scoren kostte 7,9 s op de hoofdthread.
      const r = await verfijnUitBestand(opSchijf(onset.bestand), onset.envRate, bpm, onset.tijdOffset,
        { marge, rond: positie });
      if (!r.ok) return json(res, 500, { fout: r.fout });
      return json(res, 200, {
        getikt: bpm,
        bpm: r.bpm,
        firstBeat: r.firstBeat,
        verschuiving: r.bpm - bpm,
        marge,
        positie,
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
  console.log(`library: ${lib.tracks().length} nummers  ·  schema v${lib.versie}`);
  console.log(`yt-dlp ${tooling.ytdlp}  ·  ffmpeg ${tooling.ffmpeg ? 'ok' : 'ONTBREEKT'}`);
});
