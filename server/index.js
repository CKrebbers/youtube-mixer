import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, rm } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { ingest, ingestBestand, onderzoek, werkmap, controleerTooling, stappenVoor, YTDLP_GETEST_OP } from './ingest.js';
import { bekijkLink, ontsmetNaam, BESTAND_EXT } from './links.js';
import { Wachtrij, isOpen } from './wachtrij.js';
import {
  Library, normaliseerGrid, normaliseerToon, moetAnalyse, moetToonAnalyse,
  SORTERING, isSortering, MAX_PER_PAGINA, MAX_HOTCUES,
} from './library.js';
import { ZEKER_VANAF } from './analyze.js';
import { maakOnset, verfijnUitBestand, maakGrid, maakOnsets, maakToon } from './analyze.js';
import { toonSamenvatting } from './toon.js';
import * as opname from './opname.js';
import * as handelingen from './handelingen.js';
import { Plannen, NAAM as PLANNAAM } from './plannen.js';
import { Proef } from './proef.js';
import { Splitter, StemsRij, maakStems, wisStemsBestanden, isAantal, isStemsKeuze, STEMS_STANDAARD } from './stems.js';
import { Backups, ELKE_MS as BACKUP_ELKE } from './backup.js';

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
// Opnames en handelingenlogs. Ook de statische /opnames/-paden komen hieruit,
// anders las een testserver (of een andere opnamemap) uit de projectmap.
const OPNAMES = process.env.VARVE_OPNAMES || join(WORTEL, 'opnames');
/** Setplannen van de auto-DJ (docs/PLAN.md). Eigen map voor de tests: VARVE_PLANNEN. */
const PLANNEN = process.env.VARVE_PLANNEN || join(WORTEL, 'plannen');
// De speellijst van de Controlekamer (proef/sessie.json, docs/CONTROLEKAMER.md).
const PROEF = process.env.VARVE_PROEF || join(WORTEL, 'proef');
const plannen = new Plannen(PLANNEN);
const proef = new Proef(PROEF);

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

/**
 * Opdrachten leven in het geheugen, in de wachtrij (één tegelijk, links en
 * eigen bestanden door elkaar). Wat af is, gaat de database in.
 */
const wachtrij = new Wachtrij();
/*
 * Welke run van de server dit is. De rij staat alleen in het geheugen: na een
 * herstart is hij leeg, en wat wachtte of liep is weg. De browser ziet aan een
 * ANDERE waarde dat dat gebeurde, en biedt aan ze opnieuw in de rij te zetten.
 * Niet afleiden uit een ontbrekende opdracht: een die intussen af was, kan
 * ook (in een ander tabblad) weggeklikt zijn.
 */
const SERVER_RUN = randomUUID();
/*
 * Stems (docs/STEMS.md): een eigen rij naast de ingest, ook één tegelijk. De
 * ingest-rij wacht er nooit op: een nummer is speelbaar zodra audio.wav er
 * staat, de stems komen erna.
 */
const splitter = new Splitter();
const stemsRij = new StemsRij();
// Instelbaar voor de tests: een eigen database en opnamemap, niet de jouwe.
const DB = process.env.VARVE_DB || join(WORTEL, 'media', 'library.db');
const lib = new Library(DB);

/*
 * Backups van de library (server/backup.js, docs/LIBRARY.md "Backup"):
 * bij het opstarten en elk uur als er iets veranderde, in een worker. Standaard
 * in de map `backups/` naast de database (media/backups/, buiten git), met
 * VARVE_BACKUPS naar een andere schijf. VARVE_BACKUP_ELKE (ms) alleen voor de
 * tests. NIET via de witte lijst te lezen: alleen GET /api/backups (naam, tijd).
 */
const BACKUPS = process.env.VARVE_BACKUPS || join(dirname(DB), 'backups');
const backupElke = Number(process.env.VARVE_BACKUP_ELKE);
const backups = new Backups({
  db: DB, map: BACKUPS, wijzigingen: () => lib.wijzigingen(),
  elke: Number.isFinite(backupElke) && backupElke >= 100 ? backupElke : BACKUP_ELKE,
});

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

/**
 * Een JSON-body. De pakketten worden als BYTES verzameld en pas aan het eind
 * één keer gedecodeerd: `data += d` decodeerde elk pakket los, en een
 * UTF-8-teken dat over een pakketgrens viel werd dan twee keer U+FFFD (een
 * racknaam met een é, een mapping met een “). `max` telt bytes.
 */
async function leesJson(req, max = 64 * 1024) {
  return new Promise((klaar) => {
    const delen = [];
    let n = 0;
    req.on('data', (d) => {
      n += d.length;
      if (n > max) { req.destroy(); klaar(null); return; }
      delen.push(d);
    });
    req.on('end', () => {
      const data = Buffer.concat(delen).toString('utf8');
      try { klaar(JSON.parse(data || '{}')); } catch { klaar(null); }
    });
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

/** Hooguit zoveel links in één keer plakken. */
const MAX_LINKS = 100;

/** Het nummer, als zijn audio er ook echt nog staat; anders null (dan mag hij opnieuw). */
async function metAudio(t) {
  return t && await stat(opSchijf(t.audio)).then(() => true, () => false) ? t : null;
}

/**
 * Een binnengehaald nummer in de library zetten. Geeft het nummer zoals de
 * library het nu kent (dus met het grid dat er echt staat: een grid op slot
 * blijft, ook als de ingest een nieuw voorstel had).
 */
function bewaarInLibrary(r) {
  // Paden relatief maken: de browser vraagt ze straks op via deze server.
  const track = { ...r,
    audio: alsPad(r.audio),
    video: r.video ? alsPad(r.video) : null };
  if (r.peaks) track.peaks = { ...r.peaks, bestand: alsPad(r.peaks.bestand) };
  if (r.onset) track.onset = { ...r.onset, bestand: alsPad(r.onset.bestand) };
  try {
    lib.bewaarTrack(track);
    // Nieuwe audio.wav = oude stems passen niet meer (andere frames, ander
    // geluid). De rij hier, de bestanden in stemsNaIngest.
    lib.bewaarStems(track.id, null);
    if (track.peaks) lib.bewaarPeaks(track.id, track.peaks);
    // De ingest rekende de envelope al uit; zonder dit deed de eerste tap
    // het hele werk nog een keer.
    if (track.onset) lib.bewaarOnset(track.id, track.onset);
    // Het grid-voorstel van de ingest. Nooit over een grid op slot, en bij
    // opnieuw binnenhalen ook niet over een grid dat je met de hand bewerkte.
    if (track.grid) {
      const g = lib.bewaarAutoGrid(track.id, track.grid);
      console.log(`[grid] ${track.titel}: ${g.bewaard ? gridSamenvatting(g.grid) : `voorstel niet bewaard (${g.reden})`}`);
    }
    // En de toonsoort, met dezelfde regels: nooit over een slot of een kaart met de hand.
    if (track.toon) {
      const k = lib.bewaarAutoToon(track.id, track.toon);
      console.log(`[toon] ${track.titel}: ${k.bewaard ? toonSamenvatting(k.toon) : `voorstel niet bewaard (${k.reden})`}`);
    }
    onsetCache.delete(track.id);
    return { ...(lib.track(track.id) ?? track), videoFout: track.videoFout ?? null };
  } catch (err) {
    // De ingest is gelukt; dat mag niet alsnog omvallen op de database.
    console.error('[server] track niet in library gekregen:', err?.message || err);
    return track;
  }
}

/**
 * Een nummer de stems-rij in (POST /api/stems, en na een ingest). Geeft
 * { code, antwoord } zoals docs/STEMS.md het zegt:
 * - 404: geen nummer, of zijn audio staat niet op schijf;
 * - 200 + dubbel: het staat al in de rij (die opdracht, ook met een ander aantal);
 * - 200 + al: het heeft al stems met dit aantal (tenzij `opnieuw`);
 * - 503: de splitter is er niet (met de reden);
 * - 202: nieuw in de rij.
 * `hercontrole`: was de splitter er niet, kijk dan nog eens (de route; na een
 * ingest niet, dat zou elke ingest een paar seconden Python kosten).
 */
async function nieuweStems(trackId, aantal, { opnieuw = false, hercontrole = false } = {}) {
  const track = await metAudio(typeof trackId === 'string' && /^[\w-]{1,64}$/.test(trackId) ? lib.track(trackId) : null);
  if (!track) return { code: 404, antwoord: { fout: 'onbekend nummer, of zijn audio staat niet op schijf' } };
  const loopt = stemsRij.zoek(track.id);
  if (loopt) return { code: 200, antwoord: { opdracht: loopt, dubbel: true } };
  if (!opnieuw && track.stems?.aantal === aantal) return { code: 200, antwoord: { al: true, stems: track.stems } };
  const s = await splitter.controleer({ hercontrole });
  if (!s.ok) return { code: 503, antwoord: { fout: s.reden, reden: s.reden } };
  const { opdracht } = stemsRij.voegToe({
    track: track.id, titel: track.titel, aantal, opnieuw,
    werk: (onVoortgang, signal) => maakStems({ lib, media: MEDIA, splitter, trackId: track.id, aantal,
      audio: opSchijf(track.audio), onVoortgang, signal }),
  });
  return { code: 202, antwoord: { opdracht } };
}

/**
 * Na een GESLAAGDE ingest (nieuwe audio.wav): de oude stems weg (de rij in de
 * library wiste bewaarInLibrary al), een split van de OUDE audio die nog
 * loopt stoppen, en zo gevraagd het nummer de stems-rij in. Gooit nooit: de
 * ingest is gelukt, dat mag hier niet alsnog omvallen. Is de splitter er
 * niet, dan een opdracht met 'fout' en de reden — nooit stil niets.
 * Wacht niet op de controle van de splitter als die nog loopt (vlak na het
 * opstarten): de ingest-rij moet door.
 */
async function stemsNaIngest(track, aantal) {
  try {
    await wisStemsBestanden(MEDIA, track.id);
    const loopt = stemsRij.zoek(track.id);
    if (loopt?.status === 'bezig') stemsRij.annuleer(loopt.id);
    if (!aantal) return;
    const zetInRij = async () => {
      const r = await nieuweStems(track.id, aantal);
      if (r.code === 503) stemsRij.voegFoutToe({ track: track.id, titel: track.titel, aantal, fout: r.antwoord.fout });
      else if (r.code >= 400) console.warn(`[stems] ${track.titel}: niet in de rij (${r.antwoord.fout})`);
    };
    if (splitter.bekend) await zetInRij();
    else zetInRij().catch((err) => console.error('[stems] na de ingest:', err?.message || err));
  } catch (err) {
    console.error('[stems] na de ingest:', err?.message || err);
  }
}

/**
 * Een geplakte link de wachtrij in. Geeft { code, antwoord }:
 * - 400: geen link, of een playlist/kanaal (playlist: true);
 * - 200 + dubbel: hij staat al in de wachtrij (die opdracht);
 * - 200 + bestond: hij staat al in de library (een afgeronde opdracht met
 *   het nummer, zodat de browser hem meteen kan laden);
 * - 202: nieuw in de rij.
 * `opnieuw`: toch binnenhalen, ook al staat hij in de library.
 * `stems`: 0, 2 of 4 — na een geslaagde download de stems-rij in (0 = niet).
 * Wat al in de library stond (bestond) wordt NIET gesplitst: er is niets
 * binnengehaald, en een lijst opnieuw plakken zou anders de hele library
 * door Demucs halen. Splitsen kan daar met POST /api/stems.
 */
async function nieuweLink(tekst, { opnieuw = false, stems = STEMS_STANDAARD } = {}) {
  const b = bekijkLink(tekst);
  if (!b.ok) {
    return { code: 400, antwoord: { url: String(tekst ?? '').trim().slice(0, 500), fout: b.fout, ...(b.playlist ? { playlist: true } : {}) } };
  }
  const loopt = wachtrij.zoek(b.sleutel);
  if (loopt) return { code: 200, antwoord: { ...loopt, dubbel: true } };
  if (!opnieuw) {
    const al = (b.id && await metAudio(lib.track(b.id))) || await metAudio(lib.trackMetUrl(b.link));
    if (al) return { code: 200, antwoord: wachtrij.voegKlaarToe({ sleutel: al.id, url: b.link, track: al }) };
  }
  const { opdracht, dubbel } = wachtrij.voegToe({
    sleutel: b.sleutel, url: b.link, soort: 'link', stappen: stappenVoor({ link: true, video: true }),
    werk: async (onStap, signal) => {
      const r = await ingest(b.link, { mediaDir: MEDIA, onStap, signal,
        // Tweede controle, als de id bekend is: een andere link naar hetzelfde nummer.
        bestaat: opnieuw ? null : async (id) => metAudio(lib.track(id)) });
      if (r.ok && !r.bestond) {
        r.track = bewaarInLibrary(r.track);
        await stemsNaIngest(r.track, stems);
      }
      return r;
    },
  });
  if (dubbel) return { code: 200, antwoord: { ...opdracht, dubbel: true } };
  // Zichtbaar voor de browser: na een herstart van de server zet de strook
  // hem zo terug (anders "staat al in de library" en gebeurt er niets).
  if (opnieuw) opdracht.opnieuw = true;
  return { code: 202, antwoord: { ...opdracht, ...(b.lijstEraf ? { lijstEraf: true } : {}) } };
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
  // ?stems=0|2|4 (standaard 2), zoals { stems } bij POST /api/ingest.
  const stemsQ = url.searchParams.get('stems');
  const stems = stemsQ === null ? STEMS_STANDAARD : /^[024]$/.test(stemsQ) ? Number(stemsQ) : null;
  if (stems === null) return weigerUpload(req, res, 400, { fout: 'stems is 0, 2 of 4' });
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
  const al = await metAudio(lib.track(id));
  if (al) {
    await rm(map, { recursive: true, force: true }).catch(() => {});
    return json(res, 200, wachtrij.voegKlaarToe({ sleutel: id, url: al.url, soort: 'bestand', track: al }));
  }

  // Loopt of wacht hetzelfde bestand al (twee keer gesleept)? Dan die, en deze kopie weg.
  const loopt = wachtrij.zoek(id);
  if (loopt) {
    await rm(map, { recursive: true, force: true }).catch(() => {});
    return json(res, 202, loopt);
  }
  const titel = info.tags.titel || naam.titel;
  // Achter in de rij, net als een link; met ?vooraan=1 (op een track gesleept,
  // VRAGEN J12) vóór wat gewoon wacht. De werkmap met het bestand staat er
  // al: annuleer je vóór hij begint, dan gaat die weg (bijAnnuleren).
  const { opdracht } = wachtrij.voegToe({
    vooraan: url.searchParams.get('vooraan') === '1',
    sleutel: id, url: `bestand:${naam.naam}`, soort: 'bestand', titel,
    stappen: stappenVoor({ link: false, video: info.video }),
    werk: async (onStap, signal) => {
      const r = await ingestBestand(bron, {
        id, map, mediaDir: MEDIA, onStap, signal, heeftVideo: info.video,
        info: { url: `bestand:${id.slice('lokaal-'.length)}:${naam.naam}`, titel, uploader: info.tags.artiest, duur: info.duur },
      });
      if (r.ok) {
        r.track = bewaarInLibrary(r.track);
        await stemsNaIngest(r.track, stems);
      }
      return r;
    },
    bijAnnuleren: () => rm(map, { recursive: true, force: true }),
  });
  return json(res, 202, opdracht);
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

/**
 * De toonsoortkaart voor een nummer uit de library (in een worker). Eén
 * tegelijk per nummer: ↻ terwijl de achtergrond hetzelfde nummer doet krijgt
 * dezelfde uitkomst in plaats van het werk dubbel.
 */
const toonBezig = new Map();
function analyseerToon(track) {
  if (!toonBezig.has(track.id)) {
    toonBezig.set(track.id, maakToon(opSchijf(track.audio)).finally(() => toonBezig.delete(track.id)));
  }
  return toonBezig.get(track.id);
}

/*
 * Onset-pieken per nummer, in het geheugen: ze veranderen alleen als de
 * envelope verandert (opnieuw binnenhalen). Een uur is ~18.000 tijden.
 */
const onsetCache = new Map();

/**
 * Op de achtergrond: elk nummer zonder grid, of met een grid van vóór de
 * automatische analyse (geen slot, geen bron), krijgt een voorstel; en elk
 * nummer zonder toonsoort, of met een AUTOMATISCHE kaart van een oudere
 * analyseversie (TOON_VERSIE), een kaart. Per nummer eerst het grid, dan de
 * toonsoort. Eén tegelijk, pas na het opstarten, en niet terwijl er
 * binnengehaald wordt: dit is het minst belangrijke werk van de server. Het
 * rekenwerk zit in een worker, dus de decks merken er niets van (server.test
 * en gridauto.test meten dat).
 *
 * VARVE_HERANALYSE: 'uit' = niet doen (tests die het niet meten), een getal =
 * zoveel ms wachten na het opstarten (standaard 5000). Geldt voor allebei.
 */
async function heranalyseOpAchtergrond() {
  const grids = lib.teAnalyseren();
  const tonen = lib.teToonAnalyseren();
  const ids = [...grids, ...tonen.filter((id) => !grids.includes(id))];
  if (!ids.length) return;
  const n = (x) => `${x.length} nummer${x.length === 1 ? '' : 's'}`;
  if (grids.length) console.log(`[grid] ${n(grids)} zonder automatisch grid — analyse op de achtergrond, één tegelijk`);
  if (tonen.length) console.log(`[toon] ${n(tonen)} zonder (actuele) toonsoort — analyse op de achtergrond, één tegelijk`);
  // Niet terwijl er iets in de ingest-wachtrij staat (ook wachtende, niet alleen de lopende).
  const geenIngest = async () => {
    while (wachtrij.open) await new Promise((z) => setTimeout(z, 2000));
  };
  for (const id of ids) {
    await geenIngest();
    let track = lib.track(id);
    // Intussen getikt, op slot gezet of weggehaald? Dan niet meer.
    if (track && moetAnalyse(track.grid)) {
      const t0 = Date.now();
      const r = await analyseer(track);
      if (!r.ok) console.log(`[grid] ${track.titel}: overgeslagen (${r.fout})`);
      else {
        const b = lib.bewaarAutoGrid(id, r.grid, { alleenOud: true });
        console.log(`[grid] ${track.titel}: ${b.bewaard ? gridSamenvatting(b.grid) : `niet bewaard (${b.reden})`}`
          + ` — ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
    }
    await geenIngest();
    track = lib.track(id);
    // Intussen met de hand gezet of op slot? Dan niet (bewaarAutoToon kijkt nog eens, in een transactie).
    if (track && moetToonAnalyse(track.toon)) {
      const t0 = Date.now();
      const r = await analyseerToon(track);
      if (!r.ok) console.log(`[toon] ${track.titel}: overgeslagen (${r.fout})`);
      else {
        const b = lib.bewaarAutoToon(id, r.toon, { alleenOud: true });
        console.log(`[toon] ${track.titel}: ${b.bewaard ? toonSamenvatting(b.toon) : `niet bewaard (${b.reden})`}`
          + ` — ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
    }
  }
  console.log('[analyse] achtergrondanalyse klaar');
}

/**
 * Wat de browser mag ophalen. Een witte lijst in plaats van "alles in de
 * projectmap": anders kon /.git/config of /media/library.db gewoon mee.
 */
const MAG = [/^\/$/, /^\/(index|video|apc|plan|controle)\.html$/, /^\/styles\.css$/, /^\/src\//, /^\/mappings\//,
  /^\/racks\//, /^\/media\/[\w-]+\/(audio\.wav|video\.mp4|peaks\.bin|onset\.bin|stems\.wav)$/, /^\/opnames\/set-[\w-]+\.(wav|mp4|webm)$/,
  /^\/plannen\/[\w-]+\.json$/, /^\/favicon\.ico$/];

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
  // De witte lijst laat onder /opnames/ alleen set-<id>.wav/mp4/webm door: geen
  // submap, dus `join` blijft binnen OPNAMES.
  const veilig = schoon.startsWith('/media/') ? opSchijf(schoon)
    : schoon.startsWith('/opnames/') ? join(OPNAMES, schoon.slice('/opnames/'.length))
      : schoon.startsWith('/plannen/') ? join(PLANNEN, schoon.slice('/plannen/'.length))
      : join(WORTEL, schoon);

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
 *
 * TAILSCALE (docs/TAILSCALE.md): `VARVE_HOSTS=mac.tail1234.ts.net` laat die
 * namen er ook in, alleen zoals `tailscale serve` ze aflevert: Host zonder
 * poort (of :443), Origin `https://<naam>`. Wat erbij staat is een naam die
 * alleen je eigen apparaten kunnen bereiken; DNS-rebinding blijft dicht,
 * want een vreemde naam staat er nooit in.
 */
const EIGEN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const EXTRA_HOSTS = new Set();
for (const naam of String(process.env.VARVE_HOSTS || '').split(',')) {
  const n = naam.trim().toLowerCase();
  if (!n) continue;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n)) EXTRA_HOSTS.add(n);
  else console.warn(`[server] VARVE_HOSTS: "${naam.trim()}" is geen hostnaam (zonder https:// en zonder poort), genegeerd`);
}
function vreemdVerzoek(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const m = /^(localhost|127\.0\.0\.1|\[::1\]):(\d+)$/.exec(host);
  const lokaal = !!m && EIGEN_HOSTS.has(m[1]) && Number(m[2]) === POORT;
  if (!lokaal && !EXTRA_HOSTS.has(host.replace(/:443$/, ''))) return 'onbekende host';
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const origin = req.headers.origin;
  if (origin === undefined) return null;
  const o = String(origin).toLowerCase();
  if (lokaal && o === `http://${host}`) return null;
  // Ook als de proxy de Host op localhost had gezet: de oorsprong telt.
  if (o.startsWith('https://') && EXTRA_HOSTS.has(o.slice(8))) return null;
  return 'verzoek van een andere oorsprong';
}

const server = createServer(async (req, res) => {
  try {
    // Eerst: is dit verzoek wel voor ons? Zie `vreemdVerzoek`.
    const vreemd = vreemdVerzoek(req);
    if (vreemd) return json(res, 403, { fout: vreemd });

    const url = new URL(req.url, 'http://localhost');
    const pad = url.pathname;

    // De splitter erbij: { ok, reden?, python? } (plus apparaat en versies als hij er is).
    if (pad === '/api/tooling') {
      const [t, s] = await Promise.all([controleerTooling(), splitter.controleer({ hercontrole: true })]);
      return json(res, 200, { ...t, stems: s });
    }

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

    /*
     * Binnenhalen: { url } (één link) of { urls: [...] } (geplakte lijst),
     * met { opnieuw: true } om een nummer uit de library toch opnieuw te halen.
     * YouTube, TikTok of wat yt-dlp verder kent; zie links.js en nieuweLink().
     * Eén link: het antwoord van nieuweLink (400/200/202). Een lijst: 202 met
     * { resultaten: [{ code, ...opdracht of fout }] } in dezelfde volgorde.
     */
    if (pad === '/api/ingest' && req.method === 'POST') {
      const body = await leesJson(req);
      const opnieuw = body?.opnieuw === true;
      // { stems: 0|2|4 }: na een geslaagde ingest de stems-rij in (docs/STEMS.md). Standaard 2.
      const stems = body?.stems === undefined ? STEMS_STANDAARD : body.stems;
      if (!isStemsKeuze(stems)) return json(res, 400, { fout: 'stems is 0, 2 of 4' });
      if (Array.isArray(body?.urls)) {
        if (!body.urls.length || body.urls.length > MAX_LINKS) return json(res, 400, { fout: `geef 1 tot ${MAX_LINKS} links` });
        const resultaten = [];
        for (const u of body.urls) {
          const r = await nieuweLink(u, { opnieuw, stems });
          resultaten.push({ code: r.code, ...r.antwoord });
        }
        return json(res, 202, { resultaten });
      }
      const r = await nieuweLink(body?.url, { opnieuw, stems });
      return json(res, r.code, r.antwoord);
    }

    if (pad === '/api/ingest' && req.method === 'GET') {
      return json(res, 200, { opdrachten: wachtrij.lijst(), server: SERVER_RUN });
    }

    // Annuleren (wacht of bezig) of, als hij al af is, uit de lijst halen.
    const mOpdracht = /^\/api\/ingest\/([\w-]+)$/.exec(pad);
    if (mOpdracht && req.method === 'DELETE') {
      const o = wachtrij.opdrachten.get(mOpdracht[1]);
      if (!o) return json(res, 404, { fout: 'onbekende opdracht' });
      if (isOpen(o)) {
        const r = wachtrij.annuleer(o.id);
        return json(res, 200, { ok: r.ok, opdracht: r.opdracht });
      }
      return json(res, 200, { ok: wachtrij.vergeet(o.id), weg: true });
    }

    // ---- stems (docs/STEMS.md §2) ---------------------------------------
    // GET: de rij, welke run, en of de splitter er is. POST { track, aantal,
    // opnieuw? }: zie nieuweStems. DELETE: annuleren, of een afgelopen
    // opdracht uit de lijst halen — zoals bij de ingest.
    if (pad === '/api/stems' && req.method === 'GET') {
      const s = await splitter.controleer();
      return json(res, 200, { opdrachten: stemsRij.lijst(), server: SERVER_RUN, beschikbaar: s.ok, ...(s.ok ? {} : { reden: s.reden }) });
    }
    if (pad === '/api/stems' && req.method === 'POST') {
      const body = await leesJson(req);
      if (!body || typeof body !== 'object') return json(res, 400, { fout: 'stuur { track, aantal: 2|4 } als JSON' });
      if (!isAantal(body.aantal)) return json(res, 400, { fout: 'aantal is 2 (zang en rest) of 4 (drums, bas, overig, zang)' });
      const r = await nieuweStems(body.track, body.aantal, { opnieuw: body.opnieuw === true, hercontrole: true });
      return json(res, r.code, r.antwoord);
    }
    const mStemsOpdracht = /^\/api\/stems\/([\w-]+)$/.exec(pad);
    if (mStemsOpdracht && req.method === 'DELETE') {
      const o = stemsRij.opdrachten.get(mStemsOpdracht[1]);
      if (!o) return json(res, 404, { fout: 'onbekende opdracht' });
      if (o.status === 'wacht' || o.status === 'bezig') {
        const r = stemsRij.annuleer(o.id);
        return json(res, 200, { ok: r.ok, opdracht: r.opdracht });
      }
      return json(res, 200, { ok: stemsRij.vergeet(o.id), weg: true });
    }

    // ---- setplannen (docs/PLAN.md) --------------------------------------
    // GET /api/plannen: de lijst. GET /api/plannen/<naam>: { plan, versie, fouten }.
    // PUT /api/plannen/<naam> { plan, versie }: opslaan als `versie` nog klopt
    // (null = nieuw bestand), anders 409 met wat er nu staat.
    if (pad === '/api/plannen' && req.method === 'GET') return json(res, 200, { plannen: await plannen.lijst() });
    const mPlan = /^\/api\/plannen\/([^/]+)$/.exec(pad);
    if (mPlan) {
      const naam = mPlan[1];
      if (!PLANNAAM.test(naam)) return json(res, 400, { fout: 'een plannaam is letters, cijfers, - en _' });
      if (req.method === 'GET') {
        const p = await plannen.lees(naam);
        return p ? json(res, 200, p) : json(res, 404, { fout: 'geen plan met die naam' });
      }
      if (req.method === 'PUT') {
        if (mediatype !== 'application/json') return json(res, 415, { fout: 'alleen application/json' });
        const body = await leesJson(req, 600 * 1024);
        if (!body || typeof body !== 'object' || !body.plan) return json(res, 400, { fout: 'stuur { plan, versie }' });
        const r = await plannen.schrijf(naam, body.plan, typeof body.versie === 'string' ? body.versie : null);
        return json(res, r.code, r.antwoord);
      }
      return json(res, 405, { fout: 'GET of PUT' });
    }

    // ---- speellijst van de Controlekamer (docs/CONTROLEKAMER.md) ----------
    // GET /api/backups: wanneer de laatste backup van library.db was, hoeveel er
    // staan, een fout (server/backup.js). Alleen de stand; de kopieën zelf zijn
    // via HTTP nooit te lezen.
    if (pad === '/api/backups' && req.method === 'GET') return json(res, 200, backups.stand());
    // GET /api/proef: { begonnen, items }. PUT /api/proef/<id> { status, notitie }:
    // één punt. POST /api/proef/nieuw: de sessie naar proef/archief/, dan leeg.
    if (pad === '/api/proef' && req.method === 'GET') return json(res, 200, await proef.lees());
    if (pad === '/api/proef/nieuw' && req.method === 'POST') return json(res, 200, await proef.nieuw());
    const mProef = /^\/api\/proef\/([^/]+)$/.exec(pad);
    if (mProef) {
      if (req.method !== 'PUT') return json(res, 405, { fout: 'PUT' });
      if (mediatype !== 'application/json') return json(res, 415, { fout: 'alleen application/json' });
      const body = await leesJson(req, 16 * 1024);
      if (!body || typeof body !== 'object') return json(res, 400, { fout: 'stuur { status, notitie }' });
      const r = await proef.zet(mProef[1], body);
      return json(res, r.code, r.antwoord);
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
        // Een split van een nummer dat weggaat heeft geen zin meer.
        stemsRij.annuleerTrack(mTrack[1]);
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
     * De toonsoort van een nummer: een KAART in tracktijd, zoals het grid
     * (docs/TOONSOORT.md §3): { versie, stemming, stukken: [{ van, toonsoort,
     * stemming, zekerheid? }], bron, slot }. POST = met de hand: de browser
     * zet bron 'hand' (ontbreekt bron, dan wordt het 'hand') en slot =
     * bevestigd; null wist. Zelfde regels als POST .../grid, met twee
     * verschillen: een body zonder `toon` (of geen JSON) is 400 in plaats van
     * "wissen", en de body mag groter zijn (512 kB: lange opnames).
     */
    const mToon = /^\/api\/library\/([\w-]+)\/toon$/.exec(pad);
    if (mToon && req.method === 'GET') {
      const t = lib.track(mToon[1]);
      return t ? json(res, 200, { toon: t.toon }) : json(res, 404, { fout: 'onbekend nummer' });
    }
    if (mToon && req.method === 'POST') {
      const body = await leesJson(req, 512 * 1024);
      if (!lib.track(mToon[1])) return json(res, 404, { fout: 'onbekend nummer' });
      if (!body || typeof body !== 'object' || !('toon' in body)) {
        return json(res, 400, { fout: 'stuur { toon: <kaart> } of { toon: null } als JSON' });
      }
      const toon = body.toon ?? null;
      if (toon !== null && !normaliseerToon(toon)) {
        return json(res, 400, { fout: 'ongeldige toonsoort: stukken met van (s, ≥ 0, elk een eigen plek), '
          + 'toonsoort (C Db D Eb E F F# G Ab A Bb B, m voor mineur, of null) en stemming (-50..50 cent)' });
      }
      return json(res, 200, { toon: lib.bewaarToon(mToon[1], toon) });
    }

    /*
     * Toonsoort opnieuw analyseren (↻ in de library, samen met het grid).
     * Zoals .../grid/analyseer: geeft het voorstel terug en bewaart het, ook
     * over een met de hand gezette kaart; over een kaart op SLOT alleen met
     * { forceer: true } (tweede klik), anders { bewaard: false, reden }.
     */
    const mToonAnalyseer = /^\/api\/library\/([\w-]+)\/toon\/analyseer$/.exec(pad);
    if (mToonAnalyseer && req.method === 'POST') {
      const track = lib.track(mToonAnalyseer[1]);
      if (!track) return json(res, 404, { fout: 'onbekend nummer' });
      const body = await leesJson(req);
      const r = await analyseerToon(track);
      if (!r.ok) return json(res, 500, { fout: r.fout });
      const b = lib.bewaarAutoToon(track.id, r.toon, { overHand: true, overSlot: body?.forceer === true });
      console.log(`[toon] opnieuw: ${track.titel}: ${b.bewaard ? toonSamenvatting(b.toon) : `niet bewaard (${b.reden})`}`);
      return json(res, 200, { voorstel: r.toon, bewaard: b.bewaard, toon: b.toon, ...(b.reden ? { reden: b.reden } : {}) });
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

    // ---- handelingenlogs: naast de opnames, zelfde id (server/handelingen.js) ----
    // Alles JSON, ook de stukken: { van, tekst }. De tekst is ASCII, dus de
    // browser weet precies hoeveel bytes hij schreef en waar het volgende stuk komt.
    if (pad === '/api/handelingen' && req.method === 'GET') return json(res, 200, { logs: await handelingen.lijst(OPNAMES) });
    if (pad === '/api/handelingen/start' && req.method === 'POST') {
      const body = await leesJson(req);
      if (!body) return json(res, 400, { ok: false, fout: 'ongeldige JSON' });
      const r = await handelingen.start(OPNAMES, { id: body.id ?? null });
      return json(res, r.ok ? 200 : 400, r);
    }
    const mLog = /^\/api\/handelingen\/([\w-]+)(\/stuk)?$/.exec(pad);
    if (mLog?.[2] && req.method === 'POST') {
      // Rauw lezen (tot 8 MB: een stuk van 4 MB kan in JSON verdubbelen) en
      // dan pas decoderen; zo is "te groot" (413) te onderscheiden van kapot (400).
      const ruw = await leesRuw(req, 2 * handelingen.MAX_STUK + 1024);
      if (!ruw) return json(res, 413, { ok: false, fout: 'stuk te groot' });
      let body;
      try { body = JSON.parse(ruw.toString('utf8')); } catch { return json(res, 400, { ok: false, fout: 'ongeldige JSON' }); }
      const r = await handelingen.schrijf(OPNAMES, mLog[1], body?.van, body?.tekst);
      return json(res, r.ok ? 200 : 400, r);
    }
    if (mLog && !mLog[2] && req.method === 'GET') {
      const p = await handelingen.pad(OPNAMES, mLog[1]);
      if (!p.ok) return json(res, p.fout === 'log bestaat niet' ? 404 : 400, p);
      // Precies de bytes van nu: een lopend log groeit terwijl we lezen.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Length': p.bytes, ...ISOLATIE });
      if (!p.bytes) return res.end();
      const stroom = createReadStream(p.pad, { start: 0, end: p.bytes - 1 });
      stroom.on('error', () => res.destroy());
      return stroom.pipe(res);
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

    await statisch(req, res, pad === '/' ? 'index.html' : pad === '/controle' ? 'controle.html' : pad);
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

/*
 * Stoppen (SIGTERM, SIGINT): een split die loopt eerst netjes laten stoppen.
 * Ctrl-C in de terminal raakt de hele procesgroep, Demucs ook; maar na
 * `kill <server>` bleef Demucs, een eigen proces, anders nog een half uur de
 * GPU gebruiken voor een werkmap die bij de volgende start toch weggaat. Loopt er niets, dan meteen
 * weg zoals altijd (het signaal opnieuw, met de gewone afloop). Hooguit 5 s
 * (run() geeft SIGKILL na 3 s); een tweede signaal = meteen.
 */
let afsluiten = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    const weg = () => { process.removeAllListeners(sig); process.kill(process.pid, sig); };
    if (afsluiten || !stemsRij.open) return weg();
    afsluiten = true;
    console.log(`[stems] ${sig}: de splitter wordt eerst gestopt…`);
    Promise.race([stemsRij.stop(), new Promise((z) => setTimeout(z, 5000))]).finally(weg);
  });
}

// Werkmappen van een ingest of een split die nooit afkwam (server gestopt
// midden in een download, .bezig-stems-* van een onderbroken split): opruimen.
// Een goede track of een goede set stems staat nooit in zo'n map. Alleen
// binnen MEDIA (VARVE_MEDIA voor een testserver).
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
// De splitter op de achtergrond controleren (Python + torch importeren kost
// een paar seconden): de server luistert al terwijl dat loopt.
splitter.controleer().then((s) => {
  if (s.ok) console.log(`stems: Demucs klaar (${s.python ?? s.commando}, ${s.apparaat ?? '?'})`);
  else console.warn(`[stems] geen stems: ${s.reden}`);
});

server.listen(POORT, '127.0.0.1', () => {
  console.log(`VARVE DJ  ·  http://localhost:${POORT}`);
  for (const naam of EXTRA_HOSTS) console.log(`ook via  ·  https://${naam}  (Tailscale, docs/TAILSCALE.md)`);
  console.log(`library: ${lib.aantalTracks()} nummers  ·  schema v${lib.versie}`);
  console.log(`yt-dlp ${tooling.ytdlp}  ·  ffmpeg ${tooling.ffmpeg ? 'ok' : 'ONTBREEKT'}`);
  // Meteen een backup (in een worker; gooit nooit), daarna elk uur als er iets veranderde.
  backups.start();
  const her = process.env.VARVE_HERANALYSE;
  if (her !== 'uit') {
    setTimeout(() => heranalyseOpAchtergrond().catch((err) => console.error('[analyse] achtergrond:', err?.message || err)),
      Number.isFinite(Number(her)) && her !== '' && her !== undefined ? Number(her) : 5000);
  }
});
