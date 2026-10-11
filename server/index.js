import { createServer } from 'node:http';
import { createReadStream, createWriteStream, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { stat, rm, readFile, readdir } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ingest, ingestBestand, onderzoek, werkmap, controleerTooling, stappenVoor, YTDLP_GETEST_OP, GEANNULEERD } from './ingest.js';
import { bekijkLink, ontsmetNaam, BESTAND_EXT } from './links.js';
import { Wachtrij, isOpen } from './wachtrij.js';
import {
  Library, normaliseerGrid, normaliseerToon, moetAnalyse, moetToonAnalyse, autoGridWeigert,
  SORTERING, isSortering, MAX_PER_PAGINA, MAX_HOTCUES,
} from './library.js';
import { ZEKER_VANAF } from './analyze.js';
import { maakOnset, verfijnUitBestand, maakGrid, maakOnsets, maakToon, maakSecties } from './analyze.js';
import { toonSamenvatting } from './toon.js';
import { sectieSamenvatting, SECTIE_VERSIE } from './secties.js';
import * as opname from './opname.js';
import * as handelingen from './handelingen.js';
import { Plannen, NAAM as PLANNAAM } from './plannen.js';
import { Patronen, NAAM as SETNAAM } from './patronen.js';
import { Proef } from './proef.js';
import { Splitter, StemsRij, maakStems, wisStemsBestanden, isAantal, isStemsKeuze, STEMS_STANDAARD } from './stems.js';
import { Tellenzoeker, TellenRij, GpuSlot, leesTellen, wisTellen, TELLEN_BESTAND, TELLEN_VERSIE } from './tellen.js';
import { gridUitTellen, vergelijk, meetGrid, VERSIE as KAART_VERSIE } from '../src/engine/tellen.js';
import { Beatgrid } from '../src/engine/beatgrid.js';
import { Backups, ELKE_MS as BACKUP_ELKE } from './backup.js';
import { Kaart, KaartFout, STANDAARD_PAD as KAART_STANDAARD_PAD } from './kaart.js';
import { Nacht, pasToe as nachtPasToe, STANDAARD as NACHT_STANDAARD } from './nacht.js';
import { Standen, StandFout } from './standen.js';
import { naamGeldig as standNaamGeldig, NAAM_UITLEG as STAND_NAAM_UITLEG, MAX_BYTES as STAND_MAX_BYTES } from '../src/standen/stand-model.js';

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
// Standen (docs/STANDEN.md): Clay's eigen opstellingen, buiten git. VARVE_STANDEN = een map buiten iCloud.
const STANDEN = process.env.VARVE_STANDEN || join(WORTEL, 'standen');
const plannen = new Plannen(PLANNEN);
/** Patronen per set (docs/PATRONEN.md). Eigen map voor de tests: VARVE_PATRONEN. */
const patronen = new Patronen(process.env.VARVE_PATRONEN || join(WORTEL, 'patronen'));
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
// Instelbaar voor de tests: een eigen database en opnamemap, niet de jouwe.
const DB = process.env.VARVE_DB || join(WORTEL, 'media', 'library.db');
const splitter = new Splitter();
// De tellen (Beat This!) en de stems (Demucs) gebruiken allebei de GPU: om de beurt (server/tellen.js).
const gpu = new GpuSlot();
const tellenzoeker = new Tellenzoeker();
/*
 * De stems-rij overleeft een herstart (5 okt: een uur Demucs-werk in de rij
 * ging weg bij elke herstart). Wat er open staat gaat bij elke verandering
 * naar stems-rij.json naast de library; bij het opstarten komt het terug
 * (herstelStemsRij). Tijdens het afsluiten niet: dan wordt alles geannuleerd,
 * en dat is geen keuze van Clay.
 */
const STEMS_RIJ = join(dirname(DB), 'stems-rij.json');
let stemsRijBewaren = true;
let stemsRijGeschreven = null;
function bewaarStemsRij(lijst) {
  if (!stemsRijBewaren) return;
  const tekst = JSON.stringify({ versie: 1, opdrachten: lijst }, null, 1);
  if (tekst === stemsRijGeschreven) return;
  try {
    writeFileSync(`${STEMS_RIJ}.tmp`, tekst);
    renameSync(`${STEMS_RIJ}.tmp`, STEMS_RIJ);
    stemsRijGeschreven = tekst;
  } catch (err) { console.warn(`[stems] de rij niet bewaard: ${err.message}`); }
}
const stemsRij = new StemsRij({ bijWijziging: bewaarStemsRij });
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

/*
 * DE MUZIEKKAART (docs/KAART.md): een zoeklaag over alles wat Clay ooit
 * draaide, uit `varve-kaart.json` (instelling `kaart_pad` in de library, of
 * VARVE_KAART, anders het standaardpad). Wensen en het nachtlog in een EIGEN
 * `kaart.db` naast de library; de nachtwachtrij (server/nacht.js) met zijn
 * instellingen in `nacht.json` ernaast. Niets hiervan raakt library.db.
 */
const KAART_DB = process.env.VARVE_KAART_DB || join(dirname(DB), 'kaart.db');
const kaart = new Kaart({
  pad: () => process.env.VARVE_KAART || lib.haal('kaart_pad', null) || KAART_STANDAARD_PAD,
  db: KAART_DB, library: lib,
});

/*
 * "ER SPEELT EEN DECK": de server ziet dat aan zijn eigen werk. Een deck
 * streamt zijn geluid met Range-verzoeken op /media/<id>/audio.wav (of
 * stems.wav), pagina's van ~1,4 s, zolang hij speelt of vooruit buffert.
 * Elk zo'n verzoek zet `laatstGestreamd`; speelt = minder dan 30 s geleden.
 * Grof maar eerlijk: een deck dat net gepauzeerd of geladen is telt nog een
 * halve minuut als spelend (liever te voorzichtig). Wat NIET meetelt: een
 * los bestand of de demotrack (die komen uit het geheugen van de browser) en
 * een deck op een andere server.
 */
let laatstGestreamd = 0;
const SPEELT_MS = 30 * 1000;
const speeltDeck = () => Date.now() - laatstGestreamd < SPEELT_MS;

const nacht = new Nacht({
  pad: process.env.VARVE_NACHT || join(dirname(DB), 'nacht.json'),
  kaart, speeltDeck,
  haal: (wens) => haalKaartNummer(wens),
  zoek: (sleutel) => kaart.zoek(sleutel),
});

/*
 * STANDEN (docs/STANDEN.md; "Opstelling" in de Controlekamer): één bestand per
 * situatie met beginwaarden. Activeren zet wat de server bezit (mapping, de rem
 * van de nacht), kijkt na wat hij kan zien (krat, profiel, hub-set) en legt
 * het master-rack vast voor de mixer. De routes voor mapping en nacht zelf
 * blijven zoals ze zijn. Lezen van racks/sjablonen.json, de standaardmapping,
 * avondpakket/profielen.json en de hub-sets gebeurt pas als het nodig is.
 */
const standen = new Standen({
  map: STANDEN, voorbeelden: join(WORTEL, 'tools', 'standen', 'voorbeelden'),
  lib, nacht, kaart, speeltDeck,
  valideerNacht: (deel) => nachtPasToe(NACHT_STANDAARD, deel),
  sjablonen: async () => JSON.parse(await readFile(join(WORTEL, 'racks', 'sjablonen.json'), 'utf8')).racks ?? [],
  standaardMapping: async () => JSON.parse(await readFile(join(WORTEL, 'mappings', 'apc40mk2.json'), 'utf8')),
  // null = het avondpakket (spoor draagbaar) is er nog niet; kapotte JSON gooit (dan een waarschuwing).
  profielen: async () => {
    let tekst;
    try { tekst = await readFile(join(WORTEL, 'avondpakket', 'profielen.json'), 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    const j = JSON.parse(tekst);
    return j?.profielen && typeof j.profielen === 'object' ? j.profielen : {};
  },
  // De namen in AV-app-hub/sets (alleen lezen; paden*.json zijn geen sets). null = geen hub op deze machine.
  hubSets: async () => {
    try {
      const map = process.env.VARVE_HUB_SETS || join(homedir(), 'Projects', 'AV-app-hub', 'sets');
      return (await readdir(map)).filter((f) => f.endsWith('.json') && !f.startsWith('paden')).map((f) => f.slice(0, -5)).sort();
    } catch { return null; }
  },
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
 * JSON met een ETag (sha1 van de body, 16 tekens), en 304 zonder body als de
 * vrager die ETag al heeft (If-None-Match, ook `W/"…"`, een lijst of `*`).
 * Voor wat een ander apparaat vaak peilt en zelden verandert: de lichte
 * wenslijst die de companion elke 5 s vraagt (docs/COMPANION.md). Een gewone
 * GET zonder If-None-Match krijgt precies wat `json` geeft, plus de ETag.
 */
const jsonMetEtag = (req, res, data) => {
  const body = JSON.stringify(data);
  const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  const vraag = String(req.headers['if-none-match'] ?? '');
  if (vraag && vraag.split(',').some((e) => { const x = e.trim().replace(/^W\//, ''); return x === etag || x === '*'; })) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store', ...ISOLATIE });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ETag: etag, ...ISOLATIE });
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
    // Nieuwe audio: automatische secties horen bij de oude (bij het laden komen ze opnieuw).
    sectiesGeneratie.set(track.id, (sectiesGeneratie.get(track.id) ?? 0) + 1);
    sectiesBezig.delete(track.id);
    if (lib.secties(track.id)?.bron === 'auto') lib.bewaarSecties(track.id, null);
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
async function nieuweStems(trackId, aantal, { opnieuw = false, hercontrole = false, vooraan = false } = {}) {
  const track = await metAudio(typeof trackId === 'string' && /^[\w-]{1,64}$/.test(trackId) ? lib.track(trackId) : null);
  if (!track) return { code: 404, antwoord: { fout: 'onbekend nummer, of zijn audio staat niet op schijf' } };
  const loopt = stemsRij.zoek(track.id);
  if (loopt) {
    if (vooraan) stemsRij.naarVoren(loopt.id);
    return { code: 200, antwoord: { opdracht: loopt, dubbel: true } };
  }
  if (!opnieuw && track.stems?.aantal === aantal) return { code: 200, antwoord: { al: true, stems: track.stems } };
  const s = await splitter.controleer({ hercontrole });
  if (!s.ok) return { code: 503, antwoord: { fout: s.reden, reden: s.reden } };
  const { opdracht } = zetInStemsRij(track, aantal, { opnieuw, vooraan });
  return { code: 202, antwoord: { opdracht } };
}

function zetInStemsRij(track, aantal, { opnieuw = false, vooraan = false } = {}) {
  return stemsRij.voegToe({
    track: track.id, titel: track.titel, aantal, opnieuw, duur: track.duur, vooraan,
    werk: async (onVoortgang, signal) => {
      const laat = await gpu.pak(signal);
      if (!laat) return { ok: false, fout: GEANNULEERD, afgebroken: true };
      try {
        return await maakStems({ lib, media: MEDIA, splitter, trackId: track.id, aantal,
          audio: opSchijf(track.audio), onVoortgang, signal });
      } finally { laat(); }
    },
  });
}

/**
 * Wat er voor de herstart open stond weer in de rij, in zijn volgorde (wat
 * liep eerst: het begint opnieuw, een split kan niet verder waar hij stopte).
 * Vóór de server luistert, zodat de ui bij de eerste peiling ziet dat het er
 * nog is. Niet via de controle van de splitter (die kost seconden): is
 * Demucs er niet, dan wordt de opdracht 'fout' met de reden, nooit stil
 * niets. Een nummer dat weg is, of de stems al heeft: overgeslagen.
 */
async function herstelStemsRij() {
  let d;
  try { d = JSON.parse(readFileSync(STEMS_RIJ, 'utf8')); } catch (_) { return; }
  let n = 0;
  for (const x of Array.isArray(d?.opdrachten) ? d.opdrachten : []) {
    if (typeof x?.track !== 'string' || !/^[\w-]{1,64}$/.test(x.track) || !isAantal(x.aantal)) continue;
    const track = await metAudio(lib.track(x.track));
    if (!track || (!x.opnieuw && track.stems?.aantal === x.aantal)) continue;
    zetInStemsRij(track, x.aantal, { opnieuw: x.opnieuw === true, vooraan: x.vooraan === true });
    n++;
  }
  if (n) console.log(`[stems] ${n} opdracht${n === 1 ? '' : 'en'} van voor de herstart weer in de rij`);
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

// ---- tellen: het grid uit Beat This! (docs/BEATGRID.md §11) ------------------

const ms = (x) => (x == null ? '–' : `${(x * 1000).toFixed(1)} ms`);
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

/**
 * Het grid uit de tellen van een nummer (tellen.json moet er zijn): de
 * tempokaart (gridUitTellen), getoetst aan een tweede mening (de oude
 * analyse: het grid dat er staat als dat er een van de oude analyse is,
 * anders nu uitgerekend), en bewaard als het mag (autoGridWeigert: nooit over
 * een grid op slot of met de hand bewerkt, tenzij `overHand`/`overSlot`, de
 * knop ↻). Mag het niet, dan meten we het grid dat er staat en zeggen hoe
 * het op de tellen valt. Geeft { ok, kaart?, bewaard?, grid?, reden?, fout? }.
 */
async function pasTellenToe(id, { overHand = false, overSlot = false } = {}) {
  const track = lib.track(id);
  if (!track) return { ok: false, fout: 'onbekend nummer' };
  const t = await leesTellen(MEDIA, id);
  if (!t) return { ok: false, fout: 'nog geen tellen voor dit nummer' };
  const kaart = gridUitTellen(t.beats, t.downbeats, { duur: track.duur });
  // Mag het grid toch niet vervangen worden (met de hand, op slot)? Dan geen
  // tweede mening uitrekenen (minuten voor een lange mix): alleen meten.
  const mag = !autoGridWeigert(track.grid, { overHand, overSlot });
  let ander = null;
  if (mag && track.grid?.bron === 'auto' && track.grid.methode !== 'tellen') ander = new Beatgrid(track.grid);
  else if (mag) {
    const a = await analyseer(track);
    if (a.ok) ander = new Beatgrid(a.grid);
  }
  vergelijk(kaart, t.beats, ander);
  const b = lib.bewaarAutoGrid(id, kaart, { overHand, overSlot });
  if (b.bewaard) console.log(`[tellen] ${track.titel}: ${gridSamenvatting(b.grid)}`);
  else if (track.grid) {
    const m = meetGrid(new Beatgrid(track.grid), t.beats, t.downbeats).totaal;
    console.log(`[tellen] ${track.titel}: niet bewaard (${b.reden}); het grid dat er staat: `
      + `${pct(m.raak)} van de tellen raak, slechtste blok ${ms(m.afwijking)}, "1" ${pct(m.een)}`);
  }
  return { ok: true, kaart, bewaard: b.bewaard, grid: b.grid, ...(b.reden ? { reden: b.reden } : {}) };
}

/*
 * De tellenrij houdt de GPU vast tot hij leeg is: liet hij hem tussen twee
 * nummers even los, dan pakte een wachtende split hem, en stonden de
 * volgende tellen een half uur achter die split (6 okt).
 */
let tellenGpu = null;
const laatTellenGpu = () => { const laat = tellenGpu; tellenGpu = null; laat?.(); };

/** Eén nummer in de tellenrij: Beat This! draaien (om de beurt met de stems), dan het grid. */
async function maakTellen(id, signal) {
  const track = lib.track(id);
  if (!track?.audio) return;
  if (!tellenGpu) {
    tellenGpu = await gpu.pak(signal, { voorrang: true });
    if (!tellenGpu) return;
  }
  const t0 = Date.now();
  const r = await tellenzoeker.zoek({ audio: opSchijf(track.audio), uit: join(MEDIA, id, TELLEN_BESTAND), signal, duur: track.duur });
  if (!r.ok) {
    if (!r.afgebroken) console.warn(`[tellen] ${track.titel}: ${r.fout}`);
    return;
  }
  const t = await leesTellen(MEDIA, id);
  console.log(`[tellen] ${track.titel}: ${t?.beats.length ?? '?'} tellen, ${t?.downbeats.length ?? '?'} downbeats `
    + `— ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (signal.aborted) return;
  await pasTellenToe(id);
}

const tellenRij = new TellenRij({ werk: maakTellen, bijLeeg: laatTellenGpu });

/**
 * Na een geslaagde ingest: de oude tellen weg (nieuwe audio) en het nummer
 * vooraan in de tellenrij. Gooit nooit. Staat de tellenzoeker niet klaar,
 * dan zegt de controle bij het opstarten dat al; hier niets dubbel.
 */
async function tellenNaIngest(track) {
  try {
    tellenRij.annuleer(track.id);
    await wisTellen(MEDIA, track.id);
    const z = await tellenzoeker.controleer();
    if (z.ok) tellenRij.voegToe(track.id, { vooraan: true });
  } catch (err) {
    console.error('[tellen] na de ingest:', err?.message || err);
  }
}

/** Moet het grid van dit nummer (opnieuw) uit de tellen komen? Leeg, oud, of automatisch van een oudere methode. */
const wilTellenGrid = (grid) => !grid
  || (!grid.slot && grid.bron !== 'hand' && (grid.methode !== 'tellen' || (grid.versie ?? 0) < KAART_VERSIE));

/**
 * Op de achtergrond: elk nummer zonder (actuele) tellen.json de rij in, het
 * laatst geladen eerst (daar speel je mee). Waar de tellen er al zijn maar
 * het grid nog van de oude analyse (of een oudere methode) is: alleen het
 * grid opnieuw, zonder GPU. Met de hand gezette grids en grids op slot
 * blijven staan; die worden alleen gemeten (pasTellenToe zegt hoe ze vallen).
 */
async function tellenOpAchtergrond() {
  const z = await tellenzoeker.controleer();
  if (!z.ok) return;
  const ids = lib.alleIds({ volgorde: 'laatst_geladen' });
  let rij = 0, grids = 0;
  for (const id of ids) {
    const track = lib.track(id);
    if (!track?.audio) continue;
    const t = await leesTellen(MEDIA, id);
    if (!t || t.versie < TELLEN_VERSIE) { tellenRij.voegToe(id); rij++; continue; }
    if (wilTellenGrid(track.grid)) { await pasTellenToe(id).catch((err) => console.error(`[tellen] ${id}:`, err?.message || err)); grids++; }
  }
  if (rij || grids) console.log(`[tellen] ${rij} nummer${rij === 1 ? '' : 's'} in de rij, ${grids} grid${grids === 1 ? '' : 's'} uit bestaande tellen`);
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
async function nieuweLink(tekst, { opnieuw = false, stems = STEMS_STANDAARD, video = true } = {}) {
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
    sleutel: b.sleutel, url: b.link, soort: 'link', stappen: stappenVoor({ link: true, video }),
    werk: async (onStap, signal) => {
      // `video: false` (de kaart, docs/KAART.md): alleen audio, geen beeld.
      const r = await ingest(b.link, { mediaDir: MEDIA, onStap, signal, video,
        // Tweede controle, als de id bekend is: een andere link naar hetzelfde nummer.
        bestaat: opnieuw ? null : async (id) => metAudio(lib.track(id)) });
      if (r.ok && !r.bestond) {
        r.track = bewaarInLibrary(r.track);
        await tellenNaIngest(r.track);
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
 * Een nummer van de kaart binnenhalen (docs/KAART.md): door DEZELFDE
 * ingest-wachtrij als een geplakte link, maar alleen audio en zonder stems.
 * Komt pas terug als het nummer af is (klaar, mislukt of geannuleerd), met
 * wat de ingest gaf; stond het al in de library, dan meteen { ok, bestond }.
 * Zo kan de nacht één nummer tegelijk doen en een 403 herkennen. Gooit nooit.
 */
function haalKaartNummer({ sleutel, youtube_id }) {
  if (typeof youtube_id !== 'string' || !/^[\w-]{6,20}$/.test(youtube_id)) return Promise.resolve({ ok: false, fout: `geen video-id voor ${sleutel}` });
  return nieuweLink(`https://www.youtube.com/watch?v=${youtube_id}`, { stems: 0, video: false })
    .then((r) => {
      if (r.code >= 400) return { ok: false, fout: r.antwoord?.fout || `code ${r.code}`, ...(r.antwoord?.playlist ? { playlist: true } : {}) };
      if (r.antwoord?.status === 'klaar') return { ok: true, bestond: true, track: r.antwoord.track };
      // In de rij (nieuw, of hij liep al omdat Clay hem net zelf plakte): wachten
      // tot de opdracht af is. Peilen, niet haken aan het werk: een opdracht die
      // vóór zijn start geannuleerd wordt heeft geen werk dat ooit afloopt.
      const id = r.antwoord?.id;
      return new Promise((klaar) => {
        const kijk = () => {
          const o = wachtrij.opdrachten.get(id);
          if (!o) return klaar({ ok: false, fout: 'opdracht verdwenen uit de rij' });
          if (isOpen(o)) { setTimeout(kijk, 500).unref?.(); return; }
          klaar(o.status === 'klaar' ? { ok: true, track: o.track, bestond: o.bestond } : { ok: false, fout: o.fout || o.status });
        };
        kijk();
      });
    })
    .catch((err) => ({ ok: false, fout: String(err?.message || err) }));
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
  // ?video=0: alleen de audio, ook als er beeld in zit (de lokale import van de
  // kaart, tools/lokaal). ?titel= en ?artiest=: wat de aanroeper al weet (uit tags
  // of een opgeschoonde naam); die gaan vóór de tags in het bestand. Zonder deze
  // drie gedraagt de route zich als voorheen.
  const videoQ = url.searchParams.get('video');
  const metVideo = videoQ === null || !/^(0|false|uit|nee)$/i.test(videoQ);
  // eslint-disable-next-line no-control-regex
  const tekstQ = (k) => String(url.searchParams.get(k) ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  const titelQ = tekstQ('titel'), artiestQ = tekstQ('artiest');
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
  const titel = titelQ || info.tags.titel || naam.titel;
  const artiest = artiestQ || info.tags.artiest;
  // Achter in de rij, net als een link; met ?vooraan=1 (op een track gesleept,
  // VRAGEN J12) vóór wat gewoon wacht. De werkmap met het bestand staat er
  // al: annuleer je vóór hij begint, dan gaat die weg (bijAnnuleren).
  const { opdracht } = wachtrij.voegToe({
    vooraan: url.searchParams.get('vooraan') === '1',
    sleutel: id, url: `bestand:${naam.naam}`, soort: 'bestand', titel,
    stappen: stappenVoor({ link: false, video: info.video && metVideo }),
    werk: async (onStap, signal) => {
      const r = await ingestBestand(bron, {
        id, map, mediaDir: MEDIA, onStap, signal, heeftVideo: info.video, video: metVideo,
        info: { url: `bestand:${id.slice('lokaal-'.length)}:${naam.naam}`, titel, uploader: artiest, duur: info.duur },
      });
      if (r.ok) {
        r.track = bewaarInLibrary(r.track);
        await tellenNaIngest(r.track);
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

/**
 * De sectiekaart voor een nummer (docs/SECTIES.md), in een worker, op het
 * grid en de stems van NU, en meteen bewaard (niet over een kaart met de hand
 * of op slot). Eén tegelijk per nummer: het laden en de achtergrond die
 * hetzelfde nummer vragen, krijgen dezelfde uitkomst.
 * Geeft { ok, secties, bewaard } of { ok: false, fout }.
 */
const sectiesBezig = new Map();
// Nieuwe audio (opnieuw binnenhalen) = een nieuwe generatie: een analyse die
// nog op de oude audio rekende, bewaart dan niets.
const sectiesGeneratie = new Map();
function analyseerSecties(id) {
  if (!sectiesBezig.has(id)) {
    const generatie = sectiesGeneratie.get(id) ?? 0;
    const p = (async () => {
      const t = lib.track(id);
      if (!t) return { ok: false, fout: 'onbekend nummer' };
      const stems = t.stems ? { bestand: opSchijf(t.stems.bestand), namen: t.stems.namen } : null;
      const t0 = Date.now();
      const r = await maakSecties(opSchijf(t.audio), t.grid ?? null, stems);
      if (!r.ok) { console.log(`[secties] ${t.titel}: overgeslagen (${r.fout})`); return r; }
      if ((sectiesGeneratie.get(id) ?? 0) !== generatie) return { ok: false, fout: 'het nummer is intussen opnieuw binnengehaald' };
      const b = lib.bewaarAutoSecties(id, r.secties);
      console.log(`[secties] ${t.titel}: ${b.bewaard ? sectieSamenvatting(b.secties) : `niet bewaard (${b.reden})`}`
        + ` — ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      return { ok: true, secties: b.secties, bewaard: b.bewaard };
    })().finally(() => { if (sectiesBezig.get(id) === p) sectiesBezig.delete(id); });
    sectiesBezig.set(id, p);
  }
  return sectiesBezig.get(id);
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
  // De secties mogen de rest niet meenemen (bv. een library.db met een andere v9).
  let secties = [];
  try { secties = lib.teSectieAnalyseren(); } catch (err) { console.error('[secties] lijst niet te lezen:', err?.message || err); }
  const ids = [...new Set([...grids, ...tonen, ...secties])];
  if (!ids.length) return;
  const n = (x) => `${x.length} nummer${x.length === 1 ? '' : 's'}`;
  if (grids.length) console.log(`[grid] ${n(grids)} zonder automatisch grid — analyse op de achtergrond, één tegelijk`);
  if (tonen.length) console.log(`[toon] ${n(tonen)} zonder (actuele) toonsoort — analyse op de achtergrond, één tegelijk`);
  if (secties.length) console.log(`[secties] ${n(secties)} zonder (actuele) secties — op de achtergrond, na grid en toonsoort`);
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
    // De secties als laatste: ze rekenen op het grid (en de stems) van hierboven.
    await geenIngest();
    try { if (lib.moetSecties(id)) await analyseerSecties(id); } catch (err) { console.error('[secties]', err?.message || err); }
  }
  console.log('[analyse] achtergrondanalyse klaar');
}

/**
 * Wat de browser mag ophalen. Een witte lijst in plaats van "alles in de
 * projectmap": anders kon /.git/config of /media/library.db gewoon mee.
 */
const MAG = [/^\/$/, /^\/(index|video|apc|maschine|plan|controle)\.html$/, /^\/companion\.html$/, /^\/styles\.css$/, /^\/src\//, /^\/mappings\//,
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
  if (range && /^\/media\/[\w-]+\/(audio|stems)\.wav$/.test(schoon)) laatstGestreamd = Date.now();
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
      const [t, s, z] = await Promise.all([controleerTooling(), splitter.controleer({ hercontrole: true }),
        tellenzoeker.controleer({ hercontrole: true })]);
      return json(res, 200, { ...t, stems: s, tellen: z });
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
      const r = await nieuweStems(body.track, body.aantal, { opnieuw: body.opnieuw === true, hercontrole: true, vooraan: body.vooraan === true });
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
    // PUT /api/plannen/<naam> { plan, versie, kent? }: opslaan als `versie` nog klopt
    // (null = nieuw bestand), anders 409 met wat er nu staat. `kent` = de optionele
    // velden die de schrijver kent (['in', 'uit']); zie plannen.js.
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
        const kent = Array.isArray(body.kent) ? body.kent.filter((k) => typeof k === 'string') : [];
        const r = await plannen.schrijf(naam, body.plan, typeof body.versie === 'string' ? body.versie : null, { kent });
        return json(res, r.code, r.antwoord);
      }
      return json(res, 405, { fout: 'GET of PUT' });
    }

    // ---- patronen per set (docs/PATRONEN.md) -------------------------------
    // GET /api/patronen: de lijst. GET /api/patronen/<naam>: { set, versie, fouten }.
    // PUT /api/patronen/<naam> { set, versie }: opslaan als `versie` nog klopt
    // (null = nieuw bestand), anders 409 met wat er nu staat. Zoals de setplannen.
    if (pad === '/api/patronen' && req.method === 'GET') return json(res, 200, { sets: await patronen.lijst() });
    const mSet = /^\/api\/patronen\/([^/]+)$/.exec(pad);
    if (mSet) {
      const naam = mSet[1];
      if (!SETNAAM.test(naam)) return json(res, 400, { fout: 'een setnaam is letters, cijfers, - en _' });
      if (req.method === 'GET') {
        const p = await patronen.lees(naam);
        return p ? json(res, 200, p) : json(res, 404, { fout: 'geen set met die naam' });
      }
      if (req.method === 'PUT') {
        if (mediatype !== 'application/json') return json(res, 415, { fout: 'alleen application/json' });
        const body = await leesJson(req, 3 * 1024 * 1024);
        if (!body || typeof body !== 'object' || !body.set || typeof body.set !== 'object') return json(res, 400, { fout: 'stuur { set, versie }' });
        const r = await patronen.schrijf(naam, body.set, typeof body.versie === 'string' ? body.versie : null);
        return json(res, r.code, r.antwoord);
      }
      return json(res, 405, { fout: 'GET of PUT' });
    }

    // ---- standen (docs/STANDEN.md) ------------------------------------------
    if (pad === '/api/standen' || pad.startsWith('/api/standen/')) return await standenRoute(req, res, pad, mediatype);

    // ---- speellijst van de Controlekamer (docs/CONTROLEKAMER.md) ----------
    // GET /api/backups: wanneer de laatste backup van library.db was, hoeveel er
    // staan, een fout (server/backup.js). Alleen de stand; de kopieën zelf zijn
    // via HTTP nooit te lezen.
    if (pad === '/api/backups' && req.method === 'GET') return json(res, 200, backups.stand());
    // GET /api/secties: { totaal, zonder, verouderd, versie }: hoeveel nummers (nog)
    // geen actuele secties hebben (Library.sectieTelling, docs/SECTIES.md §4). De
    // Controlekamer vraagt het elke 2 s; zonder wijziging in de database is het
    // een antwoord uit de cache.
    if (pad === '/api/secties' && req.method === 'GET') return json(res, 200, { ...lib.sectieTelling(), versie: SECTIE_VERSIE });
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
        tellenRij.annuleer(mTrack[1]);
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
    /*
     * De secties van een nummer (docs/SECTIES.md): { secties } (null = nog
     * geen). Met ?maak=1 eerst (opnieuw) berekenen als dat moet (geen kaart,
     * een ander grid, stems erbij, een nieuwe versie) en dan pas antwoorden:
     * zo laadt de app ze bij het laden, ook voor een nummer van vóór de secties.
     */
    const mSecties = /^\/api\/library\/([\w-]+)\/secties$/.exec(pad);
    if (mSecties && req.method === 'GET') {
      const id = mSecties[1];
      if (!lib.track(id)) return json(res, 404, { fout: 'onbekend nummer' });
      if (url.searchParams.get('maak') === '1' && lib.moetSecties(id)) {
        const r = await analyseerSecties(id);
        if (!r.ok) return json(res, 200, { secties: lib.secties(id), fout: r.fout });
      }
      return json(res, 200, { secties: lib.secties(id) });
    }

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
      const overSlot = body?.forceer === true;
      // Met tellen (Beat This!) het grid daaruit; zonder de oude analyse, en de tellen vooraan in de rij.
      if (await leesTellen(MEDIA, track.id)) {
        const t = await pasTellenToe(track.id, { overHand: true, overSlot });
        if (!t.ok) return json(res, 500, { fout: t.fout });
        return json(res, 200, { voorstel: t.kaart, bewaard: t.bewaard, grid: t.grid, methode: 'tellen', ...(t.reden ? { reden: t.reden } : {}) });
      }
      if (tellenzoeker.bekend?.ok) tellenRij.voegToe(track.id, { vooraan: true });
      const inRij = tellenRij.bevat(track.id) ? { tellen: 'in de rij' } : {};
      const r = await analyseer(track);
      if (!r.ok) return json(res, 500, { fout: r.fout, ...inRij });
      const b = lib.bewaarAutoGrid(track.id, r.grid, { overHand: true, overSlot });
      console.log(`[grid] opnieuw: ${track.titel}: ${b.bewaard ? gridSamenvatting(b.grid) : `niet bewaard (${b.reden})`}`);
      return json(res, 200, { voorstel: r.grid, bewaard: b.bewaard, grid: b.grid, ...inRij, ...(b.reden ? { reden: b.reden } : {}) });
    }

    /*
     * De tellen van een nummer (Beat This!): { beats, downbeats } in
     * tracktijd, gesorteerd; of { beats: null } met waarom niet (nog in de
     * rij, of de tellenzoeker staat niet klaar). Voor de streepjes in de zoom,
     * het controleren en de bewaking tijdens het spelen.
     */
    const mTellen = /^\/api\/library\/([\w-]+)\/tellen$/.exec(pad);
    if (mTellen && req.method === 'GET') {
      const track = lib.track(mTellen[1]);
      if (!track) return json(res, 404, { fout: 'onbekend nummer' });
      const t = await leesTellen(MEDIA, track.id);
      if (t) return json(res, 200, { beats: t.beats, downbeats: t.downbeats, versie: t.versie });
      const z = tellenzoeker.bekend;
      return json(res, 200, { beats: null, reden: tellenRij.bevat(track.id) ? 'in de rij' : z && !z.ok ? z.reden : 'nog niet gezocht' });
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

    // ---- de muziekkaart (docs/KAART.md) ---------------------------------
    if (pad.startsWith('/api/kaart') || pad.startsWith('/api/nacht')) {
      const r = await kaartRoute(req, res, url, pad);
      if (r !== undefined) return r;
    }

    if (pad.startsWith('/api/')) return json(res, 404, { fout: 'onbekend eindpunt' });

    await statisch(req, res, pad === '/' ? 'index.html' : pad === '/controle' ? 'controle.html' : pad === '/companion' ? 'companion.html' : pad);
  } catch (err) {
    // Eén kapot verzoek mag de server niet meenemen.
    try { json(res, 500, { fout: String(err?.message || err) }); } catch {}
  }
});

/**
 * De routes van de kaart en de nacht (contract §2). Een KaartFout wordt
 * één op één zijn code en { fout, ...extra }; alles anders is een gewone 500.
 * Geeft undefined als het pad niet van ons is (dan volgt de 404).
 */
async function kaartRoute(req, res, url, padRuw) {
  // De UI stuurt de sleutel met encodeURIComponent ("yt%3Aabc"); url.pathname
  // decodeert niet. Een sleutel is `yt:` of `sp:` plus letters, cijfers, - en _.
  let pad;
  try { pad = decodeURIComponent(padRuw); } catch { return json(res, 400, { fout: 'onleesbaar pad' }); }
  try {
    if (pad === '/api/kaart' && req.method === 'GET') return json(res, 200, kaart.stand());

    if (pad === '/api/kaart/nummers' && req.method === 'GET') {
      const q = url.searchParams;
      const heel = (k) => (q.has(k) ? Number(q.get(k)) : null);
      const stand = kaart.laad();
      if (stand.status !== 'geladen') return json(res, 404, { fout: `kaart ${stand.status}${stand.fout ? `: ${stand.fout}` : ''}`, status: stand.status, pad: kaart.pad });
      return json(res, 200, kaart.nummers({
        zoek: q.get('zoek') || '', krat: q.get('krat') || null, filter: q.get('filter') || '',
        sorteer: q.get('sorteer'), richting: q.get('richting'), van: heel('van') ?? 0, aantal: heel('aantal') ?? 100,
      }));
    }

    if (pad === '/api/kaart/wensen' && req.method === 'GET') {
      // ?licht=1 (de companion, elke 5 s): met ETag, en 304 zolang er niets veranderde (review ronde 2, fix 4).
      if (url.searchParams.get('licht') === '1') return jsonMetEtag(req, res, { wensen: kaart.wensen({ licht: true }) });
      return json(res, 200, { wensen: kaart.wensen() });
    }

    if (pad === '/api/kaart/wens' && req.method === 'POST') {
      const body = await leesJson(req, 256 * 1024);
      if (!body || typeof body !== 'object') return json(res, 400, { fout: 'stuur { sleutels: [..], meteen, bevestig } als JSON' });
      const meteen = body.meteen === true;
      if (meteen && speeltDeck()) return json(res, 409, { fout: 'er speelt een deck' });
      const r = kaart.voegWensen(body.sleutels, { bevestig: body.bevestig === true });
      if (meteen) {
        // Meteen de ingest-rij in, alleen wat een video heeft; de rest wacht op zoeken of de nacht.
        r.gestart = [];
        for (const s of r.toegevoegd) {
          const w = kaart.wens(s);
          if (!w?.youtube_id) continue;
          kaart.zetWens(s, { status: 'bezig' });
          haalKaartNummer({ sleutel: s, youtube_id: w.youtube_id }).then((u) => {
            if (!kaart.wens(s)) return;   // intussen weggehaald
            if (u.ok) kaart.zetWens(s, { status: 'klaar', fout: null, track_id: u.track?.id ?? w.youtube_id });
            else kaart.zetWens(s, { status: 'mislukt', fout: u.fout });
          });
          r.gestart.push(s);
        }
      }
      return json(res, 200, r);
    }

    const mWens = /^\/api\/kaart\/wens\/([a-z]+:[\w-]+)$/.exec(pad);
    if (mWens && req.method === 'DELETE') return json(res, 200, { ok: kaart.verwijderWens(mWens[1]) });

    const mNummer = /^\/api\/kaart\/nummer\/([a-z]+:[\w-]+)(?:\/(zoek|kies))?$/.exec(pad);
    if (mNummer) {
      const [, sleutel, actie] = mNummer;
      if (!actie && req.method === 'GET') {
        const n = kaart.nummer(sleutel);
        return n ? json(res, 200, { nummer: n }) : json(res, 404, { fout: 'niet op de kaart', status: kaart.laad().status });
      }
      if (actie === 'zoek' && req.method === 'POST') {
        if (speeltDeck()) return json(res, 409, { fout: 'er speelt een deck' });
        return json(res, 200, await kaart.zoek(sleutel));
      }
      if (actie === 'kies' && req.method === 'POST') {
        const body = await leesJson(req);
        return json(res, 200, { ok: true, wens: kaart.kies(sleutel, body?.youtube_id) });
      }
    }

    if (pad === '/api/nacht' && req.method === 'GET') return json(res, 200, nacht.stand());
    if (pad === '/api/nacht' && req.method === 'POST') {
      const body = await leesJson(req);
      try { return json(res, 200, nacht.zet(body)); } catch (err) { return json(res, 400, { fout: err.message }); }
    }
    if (pad === '/api/nacht/nu' && req.method === 'POST') {
      const body = await leesJson(req);
      try {
        // alleenWensen (de companion): alleen de wenslijst, nooit de standaardvolgorde (docs/KAART.md §3).
        const run = nacht.nu({ aantal: body?.aantal ?? 1, alleenWensen: body?.alleenWensen ?? false });
        // Niet wachten tot hij af is (dat kan uren duren): de stand, met bezig.
        run.catch(() => {});
        return json(res, 202, nacht.stand());
      } catch (err) { return json(res, err.code === 409 ? 409 : 400, { fout: err.message }); }
    }
    if (pad === '/api/nacht/stop' && req.method === 'POST') return json(res, 200, { ok: nacht.stop(), ...nacht.stand() });
    if (pad === '/api/nacht/runs' && req.method === 'GET') return json(res, 200, { runs: kaart.runs() });
    return undefined;
  } catch (err) {
    if (err instanceof KaartFout) return json(res, err.code, err.antwoord());
    throw err;
  }
}

/**
 * De routes van de standen (docs/STANDEN.md). Vaste namen (actief, keuzes,
 * terug) gaan vóór <naam>; geen stand mag zo heten. Er is geen DELETE: een
 * stand weghalen = het bestand met de hand verplaatsen (niets weggooien).
 *   GET  /api/standen                     { standen, actief, label }
 *   GET  /api/standen/actief              { naam: null } of de actieve stand met het verslag
 *   GET  /api/standen/keuzes              waaruit de bewerker kiest
 *   POST /api/standen/terug               de vorige mapping en nacht-rem terug
 *   GET  /api/standen/<naam>              { stand, versie, bron, fouten, waarschuwingen }
 *   PUT  /api/standen/<naam>              { stand, versie } → 200 / 400 / 409 / 415
 *   GET  /api/standen/<naam>/verschil     wat activeren zou veranderen
 *   POST /api/standen/<naam>/activeer     { ok, naam, sinds, verslag }
 *   POST /api/standen/<naam>/vastleggen   { versie, behoud? }
 */
async function standenRoute(req, res, pad, mediatype) {
  const alleen = (methode) => json(res, 405, { fout: methode });
  try {
    if (pad === '/api/standen') return req.method === 'GET' ? json(res, 200, await standen.overzicht()) : alleen('GET');
    if (pad === '/api/standen/actief') return req.method === 'GET' ? json(res, 200, await standen.actief()) : alleen('GET');
    if (pad === '/api/standen/keuzes') return req.method === 'GET' ? json(res, 200, await standen.keuzes()) : alleen('GET');
    if (pad === '/api/standen/terug') return req.method === 'POST' ? json(res, 200, await standen.terug()) : alleen('POST');
    const m = /^\/api\/standen\/([^/]+)(?:\/(activeer|verschil|vastleggen))?$/.exec(pad);
    if (!m) return json(res, 404, { fout: 'onbekend eindpunt' });
    let naam;
    try { naam = decodeURIComponent(m[1]); } catch { return json(res, 400, { fout: 'onleesbare naam' }); }
    if (!standNaamGeldig(naam)) return json(res, 400, { fout: STAND_NAAM_UITLEG });
    switch (m[2]) {
      case undefined:
        if (req.method === 'GET') {
          const g = await standen.lees(naam);
          return g ? json(res, 200, g) : json(res, 404, { fout: `geen stand "${naam}"` });
        }
        if (req.method === 'PUT') {
          if (mediatype !== 'application/json') return json(res, 415, { fout: 'alleen application/json' });
          // Te groot volgens de kop: meteen 413 (leesJson zou de verbinding verbreken in plaats van te antwoorden).
          if (Number(req.headers['content-length']) > STAND_MAX_BYTES + 1024) return json(res, 413, { fout: 'stand te groot (meer dan 64 KiB)' });
          const body = await leesJson(req, STAND_MAX_BYTES + 1024);
          if (!body || typeof body !== 'object' || Array.isArray(body) || !body.stand) return json(res, 400, { fout: 'stuur { stand, versie } als JSON (hooguit 64 KiB)' });
          const r = await standen.schrijf(naam, body.stand, typeof body.versie === 'string' ? body.versie : null);
          return json(res, r.code, r.antwoord);
        }
        return alleen('GET of PUT');
      case 'activeer':
        if (req.method !== 'POST') return alleen('POST');
        return json(res, 200, { ok: true, ...await standen.activeer(naam) });
      case 'verschil':
        return req.method === 'GET' ? json(res, 200, await standen.verschil(naam)) : alleen('GET');
      case 'vastleggen': {
        if (req.method !== 'POST') return alleen('POST');
        const body = await leesJson(req, 16 * 1024);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { fout: 'stuur { versie, behoud? } als JSON' });
        const r = await standen.vastleggen(naam, typeof body.versie === 'string' ? body.versie : null, body.behoud);
        return json(res, r.code, r.antwoord);
      }
    }
    return json(res, 404, { fout: 'onbekend eindpunt' });
  } catch (err) {
    if (err instanceof StandFout) return json(res, err.code, err.antwoord());
    throw err;
  }
}

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
    if (afsluiten || (!stemsRij.open && !tellenRij.open)) return weg();
    afsluiten = true;
    stemsRijBewaren = false;   // wat open staat blijft in stems-rij.json voor de volgende start
    console.log(`[server] ${sig}: de splitter en de tellenzoeker worden eerst gestopt…`);
    Promise.race([Promise.all([stemsRij.stop(), tellenRij.stop()]), new Promise((z) => setTimeout(z, 5000))]).finally(weg);
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

tellenzoeker.controleer().then((z) => {
  if (z.ok) console.log(`tellen: Beat This! klaar (${z.python ?? z.commando}, ${z.apparaat ?? '?'})`);
  else console.warn(`[tellen] geen tellen (het grid komt dan van de oude analyse): ${z.reden}`);
});

// Bij het opstarten de GPU even dicht: anders pakt de herstelde stems-rij hem
// vóór de tellen in hun rij staan (die gaan voor, zie GpuSlot). Hooguit een minuut.
const HER = process.env.VARVE_HERANALYSE;
if (HER !== 'uit') { gpu.sluit(); setTimeout(() => gpu.open(), 60000).unref?.(); }

await herstelStemsRij().catch((err) => console.error('[stems] de rij van voor de herstart:', err?.message || err));

server.listen(POORT, '127.0.0.1', () => {
  console.log(`VARVE DJ  ·  http://localhost:${POORT}`);
  for (const naam of EXTRA_HOSTS) console.log(`ook via  ·  https://${naam}  (Tailscale, docs/TAILSCALE.md)`);
  // Zonder VARVE_HOSTS krijgen iPad en iPhone (Tailscale) een 403: zeg dat hier, anders zie je het pas op de telefoon.
  if (!EXTRA_HOSTS.size) console.log('alleen op deze Mac  ·  VARVE_HOSTS is leeg: iPad en iPhone krijgen 403 (docs/COMPANION.md)');
  console.log(`library: ${lib.aantalTracks()} nummers  ·  schema v${lib.versie}`);
  console.log(`yt-dlp ${tooling.ytdlp}  ·  ffmpeg ${tooling.ffmpeg ? 'ok' : 'ONTBREEKT'}`);
  // Meteen een backup (in een worker; gooit nooit), daarna elk uur als er iets veranderde.
  backups.start();
  // De kaart: laden als het bestand er is (anders 'ontbreekt'), en de nacht gaat zijn klok peilen.
  const k = kaart.laad();
  console.log(`kaart: ${k.status === 'geladen' ? `${kaart.rijen.length} nummers, ${kaart.kratten.length} kratten` : k.status}  ·  nacht ${nacht.instellingen.aan ? 'AAN' : 'uit'} (${nacht.instellingen.venster.van}–${nacht.instellingen.venster.tot}, ${nacht.instellingen.perNacht}/nacht)`);
  nacht.start();
  const her = process.env.VARVE_HERANALYSE;
  if (her !== 'uit') {
    setTimeout(() => {
      heranalyseOpAchtergrond().catch((err) => console.error('[analyse] achtergrond:', err?.message || err));
      tellenOpAchtergrond().catch((err) => console.error('[tellen] achtergrond:', err?.message || err))
        .finally(() => gpu.open());
    }, Number.isFinite(Number(her)) && her !== '' && her !== undefined ? Number(her) : 5000);
  }
});
