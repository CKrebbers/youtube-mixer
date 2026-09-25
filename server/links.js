/**
 * Waar een nummer vandaan komt, en hoe een link eruit moet zien voordat
 * yt-dlp hem krijgt. Puur rekenwerk, geen netwerk: de tests draaien zonder.
 *
 * Drie bronnen hebben een naam: YouTube, TikTok en een eigen bestand. Wat
 * yt-dlp verder nog kent (Vimeo, SoundCloud, een los mp3-adres) mag ook; dat
 * heet hier 'web'.
 */

/** Hosts per bron. Een subdomein telt mee (m.youtube.com, vm.tiktok.com). */
const HOSTS = {
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
  tiktok: ['tiktok.com', 'tiktokv.com'],
};
const hoortBij = (host, domein) => host === domein || host.endsWith('.' + domein);

/** 'youtube' | 'tiktok' | 'bestand' | 'web' — voor het label in de library. */
export function bronVan(url) {
  const tekst = String(url || '');
  if (tekst.startsWith('bestand:')) return 'bestand';
  let host;
  try { host = new URL(tekst).hostname.toLowerCase(); } catch { return 'web'; }
  for (const [bron, domeinen] of Object.entries(HOSTS)) {
    if (domeinen.some((d) => hoortBij(host, d))) return bron;
  }
  return 'web';
}

/**
 * Een geplakte link netjes maken, of null als het geen http(s)-link is.
 *
 * TikTok: yt-dlp herkent een video alleen op www.tiktok.com/@naam/video/<id>.
 * Zonder "www." (of via m.tiktok.com) viel hij terug op de generic extractor,
 * en die vindt op een TikTok-pagina niets. De querystring gaat eraf. Korte links (vm.tiktok.com/…,
 * vt.tiktok.com/…, www.tiktok.com/t/…) laten we staan: die kent yt-dlp zelf
 * en hij volgt de doorverwijzing.
 */
export function normaliseerLink(link) {
  const tekst = String(link || '').trim();
  if (!/^https?:\/\//i.test(tekst)) return null;
  let u;
  try { u = new URL(tekst); } catch { return null; }
  const host = u.hostname.toLowerCase();
  // Een TikTok-video: altijd https://www.tiktok.com/@naam/video/<id>, zonder
  // ?is_copy_url=1&is_from_webapp=v1 en dergelijke. Dan is dezelfde video
  // met of zonder parameters ook voor de dubbele-link-controle dezelfde.
  const tt = /^\/(@[^/]*)\/video\/(\d+)\/?$/.exec(u.pathname);
  if (tt && ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(host)) {
    return `https://www.tiktok.com/${tt[1]}/video/${tt[2]}`;
  }
  return tekst;
}

/** Een YouTube-video-id: precies 11 tekens. */
const YT_ID = /^[\w-]{11}$/;

export const PLAYLIST_FOUT = 'dit is een playlist — plak de link van één nummer '
  + '(een link met v= én list= wordt gewoon dat ene nummer)';

/**
 * Wat een geplakte link wordt voordat hij de wachtrij in gaat. Puur, zonder
 * netwerk: { ok: true, link, id, sleutel, lijstEraf? } of { ok: false, fout, playlist? }.
 *
 * - link: wat yt-dlp krijgt. Een YouTube-video wordt altijd
 *   https://www.youtube.com/watch?v=<id>, zonder list=, index=, si= en de
 *   rest: dan is youtu.be/<id>, /shorts/<id> en watch?v=<id>&list=… hetzelfde
 *   nummer, en haalt yt-dlp nooit per ongeluk een hele lijst.
 * - id: de track-id als die zonder netwerk vaststaat (YouTube, TikTok), anders null.
 * - sleutel: waarop de wachtrij "staat er al in" herkent: de id, of anders de link.
 *
 * Een playlist, kanaal of profiel wordt hier geweigerd. yt-dlp zou er ALLES
 * van binnenhalen; wat hier niet herkend wordt, vangt de metadata-stap nog op
 * (_type 'playlist', zie ingest.js).
 */
export function bekijkLink(tekst) {
  const link = normaliseerLink(tekst);
  if (!link) return { ok: false, fout: 'geef een geldige http(s)-URL' };
  const u = new URL(link);
  const bron = bronVan(link);
  if (bron === 'youtube') return bekijkYoutube(u, link);
  if (bron === 'tiktok') {
    const m = /^\/@[^/]*\/video\/(\d+)$/.exec(u.pathname);
    if (m) return { ok: true, link, id: `tiktok-${m[1]}`, sleutel: `tiktok-${m[1]}` };
    if (/^\/@[^/]+\/?$/.test(u.pathname)) {
      return { ok: false, playlist: true, fout: 'dit is een TikTok-profiel, geen video — plak de link van één video' };
    }
  }
  return { ok: true, link, id: null, sleutel: link };
}

function bekijkYoutube(u, link) {
  const host = u.hostname.toLowerCase();
  const pad = u.pathname;
  const q = u.searchParams;
  let id = null;
  if (host === 'youtu.be' || host.endsWith('.youtu.be')) id = pad.split('/')[1] || null;
  else if (/^\/watch\/?$/.test(pad)) id = q.get('v');
  else id = /^\/(?:shorts|live|embed|v|e)\/([^/]+)/.exec(pad)?.[1] ?? null;
  if (id && YT_ID.test(id)) {
    return { ok: true, link: `https://www.youtube.com/watch?v=${id}`, id, sleutel: id, ...(q.has('list') ? { lijstEraf: true } : {}) };
  }
  if (q.has('list') || /^\/playlist\/?$/.test(pad)) return { ok: false, playlist: true, fout: PLAYLIST_FOUT };
  // Kanalen, zoekresultaten en overzichten: voor yt-dlp ook playlists.
  if (/^\/(@[^/]+|channel\/|c\/|user\/|results\/?$|feed\/)/.test(pad)) {
    return { ok: false, playlist: true, fout: 'dit is een kanaal of overzicht, geen nummer — plak de link van één video' };
  }
  return { ok: true, link, id: null, sleutel: link };
}

/**
 * De id waaronder een nummer in media/ en de database komt.
 *
 * YouTube houdt zijn eigen id (zo stonden alle bestaande nummers er al in).
 * Andere sites krijgen hun extractor ervoor: TikTok-id's zijn lange getallen,
 * en een getal van de ene site kan het getal van een andere zijn. Null als er
 * niets veiligs van te maken is — de id wordt een MAPNAAM.
 */
export function trackIdVoor({ id, extractor }) {
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const ruw = String(id);
  const ex = String(extractor || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const uit = !ex || ex === 'youtube' ? ruw : `${ex}-${ruw}`;
  return /^[\w-]{1,64}$/.test(uit) ? uit : null;
}

/**
 * Een foutregel van yt-dlp over TikTok, vertaald naar wat je eraan kunt doen.
 * Null als er niets bijzonders over te zeggen is.
 *
 * Gemeten op 23 september 2026 (yt-dlp 2026.08.19): TikTok werkt ALLEEN met
 * browser-imitatie. yt-dlp doet dat zelf als curl_cffi geïnstalleerd is (hier
 * wel: doel chrome-131:macos-14). Zonder curl_cffi weigert TikTok de pagina.
 */
export function tiktokHint(fout) {
  const f = String(fout || '');
  if (/impersonat|curl.?cffi/i.test(f)) {
    return 'TikTok vraagt browser-imitatie, en daarvoor mist yt-dlp curl_cffi. '
      + "Installeer het met: python3 -m pip install -U 'yt-dlp[default,curl-cffi]'";
  }
  if (/log ?in|cookies|private|priv[eé]|account|authenticat/i.test(f)) {
    return 'deze TikTok-video is alleen zichtbaar als je ingelogd bent. yt-dlp kan daarvoor cookies uit je browser lezen '
      + '(--cookies-from-browser), maar dat zit er bewust niet in — vraag het als je het wilt.';
  }
  if (/blocked|geo|country|region/i.test(f)) return 'TikTok houdt deze video tegen vanaf jouw land of IP-adres.';
  return null;
}

/** Wat de upload aanneemt. Een ander achtervoegsel wordt geweigerd voordat er één byte op schijf staat. */
export const BESTAND_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'wav', 'mp3', 'flac', 'm4a', 'aiff', 'aif', 'ogg', 'opus'];

/**
 * Een bestandsnaam uit de browser: alleen als TITEL, nooit als pad. Alles
 * voor de laatste slash of backslash gaat weg, stuurtekens ook, en hij wordt
 * kort gehouden. Geeft { naam, titel, ext } of null als het achtervoegsel
 * niet in de lijst staat.
 */
export function ontsmetNaam(ruw) {
  let naam = String(ruw || '').split(/[\\/]/).pop();
  // eslint-disable-next-line no-control-regex
  naam = naam.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(naam);
  const ext = m ? m[1].toLowerCase() : '';
  if (!BESTAND_EXT.includes(ext)) return null;
  const titel = naam.slice(0, -(ext.length + 1)).trim().replace(/[_]+/g, ' ') || 'naamloos';
  return { naam, titel, ext };
}
