// De keuzelogica van de lokale import, zonder netwerk en zonder server:
// welke bestanden, hoe ze heten, en welke `lokaal-`-id ze krijgen. Alles wat
// hier staat is puur en getest (test/lokaal-importeer.test.mjs); het praten
// met de server zit in importeer.mjs.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, basename, extname, relative } from 'node:path';

/** Audio die we meenemen. mp4 alleen als er geen gelijknamige .wav naast staat. */
export const AUDIO_EXT = ['mp3', 'wav', 'aiff', 'aif', 'flac', 'm4a', 'ogg', 'opus'];
export const VIDEO_EXT = ['mp4'];

/** Korter dan dit (seconden) is geen nummer maar een sample of een klik. */
export const MIN_DUUR = 20;

/** Zoals de server: `lokaal-` + de eerste 12 hex van de SHA-256 van de inhoud. */
export const idVanHash = (hex) => `lokaal-${String(hex).slice(0, 12)}`;

/** De SHA-256 van een bestand, gestreamd; geeft de `lokaal-`-id. */
export function hashBestand(pad) {
  return new Promise((klaar, faal) => {
    const h = createHash('sha256');
    createReadStream(pad)
      .on('data', (d) => h.update(d))
      .on('error', faal)
      .on('end', () => klaar(idVanHash(h.digest('hex'))));
  });
}

const ext = (naam) => extname(naam).slice(1).toLowerCase();

/**
 * Alle bestanden onder `map`, recursief, als paden relatief aan `map`,
 * gesorteerd. Verborgen bestanden en mappen (.DS_Store, .git) doen niet mee.
 */
export async function verzamel(map) {
  const uit = [];
  const loop = async (dir) => {
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
    items.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      const vol = join(dir, it.name);
      if (it.isDirectory()) await loop(vol);
      else if (it.isFile()) uit.push(relative(map, vol));
    }
  };
  await loop(map);
  return uit;
}

/**
 * Welke van deze (relatieve) paden gaan door, en welke vallen af en waarom.
 * Geeft [{ pad, overslaan? }]; wat geen audio of video is (txt, jpg) komt
 * niet terug, behalve `.acties.jsonl`: dat is het handelingenlog naast een
 * opname en staat met reden in de tabel, zodat je ziet dat het bewust is.
 *
 * mp4 naast een gelijknamige wav: de wav IS de opname (de mp4 is het beeld
 * erbij); dan slaan we de mp4 over. De wav krijgt die mp4 als `zus`: staat
 * de mp4 al in de library (zo zijn de sets van 23 sep binnengekomen), dan is
 * de wav hetzelfde geluid en dus ook "al binnen" (beoordeel()).
 */
export function kiesBestanden(paden) {
  const kleine = new Map(paden.map((p) => [p.toLowerCase(), p]));
  const uit = [];
  for (const pad of paden) {
    const naam = basename(pad);
    if (naam.endsWith('.acties.jsonl')) { uit.push({ pad, overslaan: 'handelingenlog (.acties.jsonl)' }); continue; }
    const e = ext(naam);
    const stam = pad.slice(0, -e.length);
    if (AUDIO_EXT.includes(e)) {
      const mp4 = e === 'wav' ? VIDEO_EXT.map((v) => kleine.get((stam + v).toLowerCase())).find(Boolean) : null;
      uit.push(mp4 ? { pad, zus: mp4 } : { pad });
      continue;
    }
    if (VIDEO_EXT.includes(e)) {
      const wavNaast = kleine.has((stam + 'wav').toLowerCase());
      uit.push(wavNaast ? { pad, overslaan: 'mp4 naast een gelijknamige wav (de wav is de opname)' } : { pad });
    }
  }
  return uit;
}

/** Nederlandse maandafkortingen voor de set-titel. */
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/**
 * Een eigen opname uit opnames/: `set-YYYYMMDD-HHMMSS` → "Set 23 sep 2026 13:12"
 * met artiest "Clay (Varve)". Anders null.
 */
export function setTitel(basis) {
  const m = /^set-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(basis);
  if (!m) return null;
  const [, j, mnd, d, u, mi] = m;
  const maand = MAANDEN[Number(mnd) - 1];
  if (!maand) return null;
  return { titel: `Set ${Number(d)} ${maand} ${j} ${u}:${mi}`, artiest: 'Clay (Varve)' };
}

/**
 * De bestandsnaam (zonder achtervoegsel) opgeschoond tot iets dat als titel
 * kan dienen: `[SPOTDOWNLOADER.COM] `-rommel vooraan eraf, en wat erop lijkt
 * (elke [..]- of (..)-prefix met een sitenaam), tracknummers ("06 ", "21. ",
 * "1-53 ") eraf, underscores naar spaties, dubbele spaties weg.
 */
export function schoonNaam(basis) {
  let s = String(basis ?? '');
  // Rommel vooraan: [SPOTDOWNLOADER.COM], [www.site.net], (site.com) …
  for (let eerder = null; eerder !== s;) {
    eerder = s;
    s = s.replace(/^\s*[[(][^\])]*(?:\.(?:com|net|org|nl|io|co|me|to|cc|xyz|biz|info))[^\])]*[\])]\s*/i, '');
    s = s.replace(/^\s*[[(]\s*(?:spotdownloader|spotify ?downloader|spotiflyer|y2mate|ytmp3|savefrom|mp3juice|tubidy)[^\])]*[\])]\s*/i, '');
    s = s.replace(/^\s*(?:www\.)?[a-z0-9-]+\.(?:com|net|org|nl|io)\s*[-–:]\s*/i, '');
  }
  s = s.replace(/_+/g, ' ');
  // Tracknummers: "1-53 Titel", "06 Titel", "21. Titel", "03 - Titel". Niet als de hele naam een getal is.
  s = s.replace(/^\s*\d{1,2}-\d{1,3}\s+(?=\S)/, '');
  s = s.replace(/^\s*\d{1,3}\s*[.)]\s+(?=\S)/, '');
  s = s.replace(/^\s*\d{1,3}\s+-\s+(?=\S)/, '');
  s = s.replace(/^\s*\d{1,3}\s+(?=[^\d\s])/, '');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Titel en artiest voor een bestand: een eigen set gaat voor, dan de tags
 * (ffprobe: title/artist), dan de bestandsnaam. "Artiest - Titel" in de
 * naam wordt gesplitst als er geen tags zijn.
 */
export function titelArtiest(bestandsnaam, tags = {}) {
  const basis = basename(String(bestandsnaam)).replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const set = setTitel(basis);
  if (set) return set;
  const tTitel = String(tags.titel ?? '').trim();
  const tArtiest = String(tags.artiest ?? '').trim();
  const schoon = schoonNaam(basis);
  if (tTitel) return { titel: tTitel, artiest: tArtiest };
  const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(schoon);
  if (m && !tArtiest) return { titel: m[2].trim(), artiest: m[1].trim() };
  return { titel: schoon || 'naamloos', artiest: tArtiest };
}

/**
 * De stand van één bestand voor de tabel: 'nieuw', 'al binnen' of
 * 'overslaan' met een reden. `onderzoek` is wat ffprobe zei ({ ok, duur, fout }).
 */
export function beoordeel({ overslaan, id, zusId, onderzoek, binnen }) {
  if (overslaan) return { stand: 'overslaan', reden: overslaan };
  if (onderzoek && onderzoek.ok === false) return { stand: 'overslaan', reden: `onleesbaar: ${onderzoek.fout || 'ffprobe leest het niet'}` };
  if (onderzoek && !(onderzoek.duur >= MIN_DUUR)) return { stand: 'overslaan', reden: `korter dan ${MIN_DUUR} s` };
  if (id && binnen?.has(id)) return { stand: 'al binnen', reden: '' };
  if (zusId && binnen?.has(zusId)) return { stand: 'al binnen', reden: `als mp4 (${zusId})` };
  return { stand: 'nieuw', reden: '' };
}

/** Pagina's van GET /api/library samenvoegen tot een Set van id's (puur; het halen zit in importeer.mjs). */
export function idsUitPaginas(paginas) {
  const s = new Set();
  for (const p of paginas) for (const t of p?.tracks ?? []) if (t?.id) s.add(t.id);
  return s;
}

/** Een getal in MB met één decimaal, en seconden als m:ss of u:mm:ss. */
export const mb = (bytes) => (bytes / 1024 ** 2).toFixed(1);
export function duurTekst(s) {
  if (typeof s !== 'number' || !(s >= 0)) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
