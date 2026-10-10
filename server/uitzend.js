/**
 * Uitzenden van de eigen set: een UITGANG, geen bron (docs/UITZENDEN.md).
 *
 * De module volgt het opnamebestand dat al groeit (opnames/set-<id>.wav, of
 * set-<id>.mp4 als er met beeld wordt opgenomen) en duwt de nieuwe bytes in één
 * ffmpeg-kind, dat ze naar een doel uit uitzend/doelen.json stuurt: een bestand,
 * een lokale RTMP-ontvanger of OBS via udp op 127.0.0.1. Verder dan deze Mac
 * komt Varve zelf niet, tot Clay U1b beslist (docs/VRAGEN.md blok U).
 *
 * Harde grenzen (het onderscheid uit docs/VISIE.md §4, in code):
 *   G1  de bron is alleen de eigen set: set-<id>.wav / .mp4 in de opnamemap. Nooit
 *       media/, nooit library.db. Deze module importeert alleen node:* en kopVan/ID
 *       uit ./opname.js; het id moet aan opname.ID voldoen, er is geen padargument.
 *   G2  doelen alleen van schijf: wie start, noemt een naam. Een url van buiten
 *       bestaat niet in de API.
 *   G3  lokaal-slot: bestand; rtmp:// naar letterlijk 127.0.0.1 of [::1]; udp://
 *       naar letterlijk 127.0.0.1 (poort >= 1024). Geen gebruikersnaam, en de url
 *       moet al genormaliseerd zijn. Al het andere is dicht. Een slot tegen
 *       vergissing, niet tegen opzet (een lokale relay kan het omzeilen).
 *   G4  het opnamepad blijft onaangeroerd: hier wordt alleen gelezen. Een
 *       uitzending die faalt laat de opname niets merken.
 *   G5  geen uitzending zonder opname.
 *   G6  één uitzending tegelijk. Stoppen: stdin dicht, 3 s, SIGINT, 3 s, SIGKILL
 *       (snel: 1,5 s / 1,5 s). Nooit SIGTERM.
 *   G7  een sleutel komt nergens: een doel met sleutel* is ongeldig, en elke
 *       stderr-regel gaat door maskeer().
 *   G8  inhoudsgrens: het mengcanvas bevat deck-clips van anderen. Een niet-lokaal
 *       doel met beeld bestaat niet (in v1 bestaat geen enkel niet-lokaal doel);
 *       lokale beeld-doelen dragen de waarschuwing "alleen thuis (I78)".
 *   G9  uitgang buiten iCloud en buiten opnames/: standaard ~/Movies/VARVE-uitzend/,
 *       nooit overschrijven (eerste vrije naam), na stop een .mp4 naast de .flv.
 *
 * Elke functie geeft een resultaat terug ({ ok, … }) en gooit nooit, zoals opname.js.
 */
import { open, readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, sep, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { kopVan, ID } from './opname.js';

export const BPS = 192000;                   // 48 kHz × 2 kanalen × 2 bytes
const FRAME = 4;
export const BLOK_WAV = 48000;               // 250 ms per write: de pijp blijft kort (H1)
export const BLOK_MP4 = 256 * 1024;
const LOKAAL = new Set(['127.0.0.1', '[::1]']);
export const DICHT = 'naar buiten uitzenden staat uit tot Clay U1 beslist (CLAUDE.md r.29-31, docs/VRAGEN.md U1)';
export const I78 = 'deck-clips van anderen: alleen thuis (stappenplan I78)';
export const STANDAARD_UIT = join(homedir(), 'Movies', 'VARVE-uitzend');
const STANDAARD_MAP = join(dirname(fileURLToPath(import.meta.url)), '..', 'uitzend');

/** Als er geen uitzend/doelen.json is: twee doelen die altijd iets veiligs doen. */
export const INGEBOUWD = [
  { naam: 'proef', soort: 'bestand', bron: 'audio', beeld: 'zwart', fps: 2,
    omschrijving: 'geluid + zwart beeld naar ~/Movies/VARVE-uitzend/set-<id>.uitzend.mp4: kijk wat een kijker zou horen' },
  { naam: 'proef-alles-thuis', soort: 'bestand', bron: 'video', video: 'hercodeer', inhoud: 'alles', bitrate: '2500k',
    omschrijving: 'mengcanvas + geluid, gehercodeerd zoals voor een dienst (2,5 Mbit/s, keyframe per 2 s)', waarschuwing: I78 },
];

// ---- pure functies -----------------------------------------------------------

/** G3 (+ G8): mag dit doel? Puur; kijkt alleen naar het doel zelf. */
export function toegestaan(doel) {
  if (!doel || typeof doel !== 'object') return { ok: false, fout: DICHT };
  if (doel.soort === 'bestand') return { ok: true };
  if (doel.soort !== 'rtmp' && doel.soort !== 'udp') return { ok: false, fout: DICHT };
  let u;
  try { u = new URL(doel.url); } catch { return { ok: false, fout: 'ongeldige url' }; }
  if (u.href !== doel.url) return { ok: false, fout: 'url is niet genormaliseerd: schrijf hem precies zo: ' + maskeer(u.href) };
  if (u.username || u.password) return { ok: false, fout: DICHT };
  if (doel.soort === 'rtmp' && (u.protocol !== 'rtmp:' || !LOKAAL.has(u.hostname))) return { ok: false, fout: DICHT };
  if (doel.soort === 'udp' && (u.protocol !== 'udp:' || u.hostname !== '127.0.0.1' || !(Number(u.port) >= 1024))) return { ok: false, fout: DICHT };
  // G8: hier is het doel lokaal (bestand, 127.0.0.1, [::1]). Een niet-lokaal doel is
  // hierboven al dicht, met of zonder beeld; stap 8 (na U1b) mag dat alleen openen
  // met `rechten` en, bij bron video, inhoud 'vormen' plus beeldstand 'vormen'.
  return { ok: true };
}

const NAAM = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PNG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.png$/;   // geen /, geen .., niets wat een filtergraaf breekt
const VELDEN = new Set(['naam', 'soort', 'bron', 'beeld', 'fps', 'video', 'inhoud', 'bitrate', 'url', 'omschrijving', 'waarschuwing']);

/** Eén doel uit doelen.json controleren. Geeft { doel } of { fout }. */
function controleer(d, i) {
  const wie = `doel ${i + 1}${d && typeof d.naam === 'string' && NAAM.test(d.naam) ? ` (${d.naam})` : ''}`;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { fout: `${wie}: geen object` };
  for (const k of Object.keys(d)) {
    if (/^sleutel/i.test(k)) return { fout: `${wie}: een sleutel hoort niet in doelen.json (G7); in v1 heeft geen doel een sleutel` };
    if (!VELDEN.has(k)) return { fout: `${wie}: onbekend veld "${k}"` };
  }
  if (typeof d.naam !== 'string' || !NAAM.test(d.naam)) return { fout: `${wie}: naam moet kleine letters, cijfers en - zijn (hooguit 32)` };
  if (!['bestand', 'rtmp', 'udp'].includes(d.soort)) return { fout: `${wie}: soort moet bestand, rtmp of udp zijn` };
  if (!['audio', 'video'].includes(d.bron)) return { fout: `${wie}: bron moet audio of video zijn` };
  const doel = { naam: d.naam, soort: d.soort, bron: d.bron };
  if (d.bron === 'audio') {
    if ('video' in d || 'inhoud' in d) return { fout: `${wie}: video en inhoud horen bij bron video` };
    const beeld = d.beeld ?? 'zwart';
    if (!(beeld === 'zwart' || beeld === 'golf' || (typeof beeld === 'string' && PNG.test(beeld)))) return { fout: `${wie}: beeld moet zwart, golf of <naam>.png zijn (een plaat in uitzend/beelden/)` };
    const fps = d.fps ?? 2;
    if (!(Number.isInteger(fps) && fps >= 1 && fps <= 30)) return { fout: `${wie}: fps moet een heel getal 1..30 zijn` };
    Object.assign(doel, { beeld, fps });
  } else {
    if ('beeld' in d || 'fps' in d) return { fout: `${wie}: beeld en fps horen bij bron audio` };
    const video = d.video ?? 'hercodeer';
    if (!['hercodeer', 'kopie'].includes(video)) return { fout: `${wie}: video moet hercodeer zijn` };
    const inhoud = d.inhoud ?? 'alles';
    if (!['alles', 'vormen'].includes(inhoud)) return { fout: `${wie}: inhoud moet alles of vormen zijn` };
    Object.assign(doel, { video, inhoud });
  }
  const bitrate = d.bitrate ?? (d.bron === 'video' ? '2500k' : '300k');
  if (typeof bitrate !== 'string' || !/^\d{3,5}k$/.test(bitrate)) return { fout: `${wie}: bitrate zoals "2500k"` };
  doel.bitrate = bitrate;
  if (d.soort === 'bestand') {
    if ('url' in d) return { fout: `${wie}: een bestand-doel heeft geen url (de uitgang is ~/Movies/VARVE-uitzend/)` };
  } else {
    if (typeof d.url !== 'string') return { fout: `${wie}: ${d.soort} vraagt een url` };
    doel.url = d.url;
  }
  for (const k of ['omschrijving', 'waarschuwing']) {
    if (k in d) { if (typeof d[k] !== 'string' || d[k].length > 500) return { fout: `${wie}: ${k} is tekst (hooguit 500 tekens)` }; doel[k] = d[k]; }
  }
  // G8: elk beeld-doel draagt de waarschuwing over clips van anderen.
  if (doel.bron === 'video' && !/I78/.test(doel.waarschuwing || '')) doel.waarschuwing = doel.waarschuwing ? `${doel.waarschuwing}; ${I78}` : I78;
  const mag = toegestaan(doel);
  if (!mag.ok) return { fout: `${wie}: ${mag.fout}` };
  return { doel };
}

/** Alle doelen MET url, voor intern gebruik. Geeft nooit een sleutel (die maakt een doel ongeldig). */
async function leesDoelen(uitzendMap) {
  let tekst;
  try { tekst = await readFile(join(uitzendMap, 'doelen.json'), 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return { doelen: INGEBOUWD.map((d) => ({ ...d })), fouten: [] };
    return { doelen: INGEBOUWD.map((d) => ({ ...d })), fouten: [`doelen.json niet te lezen: ${err.code || err.message}`] };
  }
  let j;
  try { j = JSON.parse(tekst); } catch (err) {
    return { doelen: INGEBOUWD.map((d) => ({ ...d })), fouten: [`doelen.json is geen geldige JSON: ${err.message.slice(0, 120)}`] };
  }
  if (!j || j.versie !== 1 || !Array.isArray(j.doelen)) {
    return { doelen: INGEBOUWD.map((d) => ({ ...d })), fouten: ['doelen.json: verwacht { "versie": 1, "doelen": [ … ] }'] };
  }
  const doelen = [], fouten = [], namen = new Set();
  j.doelen.forEach((d, i) => {
    const r = controleer(d, i);
    if (r.fout) return fouten.push(r.fout);
    if (namen.has(r.doel.naam)) return fouten.push(`doel ${i + 1}: naam "${r.doel.naam}" komt twee keer voor`);
    namen.add(r.doel.naam);
    doelen.push(r.doel);
  });
  // Geen enkel geldig doel: dan de ingebouwde, zodat de knop altijd iets veiligs doet.
  if (!doelen.length) return { doelen: INGEBOUWD.map((d) => ({ ...d })), fouten };
  return { doelen, fouten };
}

/** De doelen voor de browser en de Controlekamer: nooit een url of sleutel (G2, G7). */
export async function laadDoelen(uitzendMap = STANDAARD_MAP) {
  try {
    const { doelen, fouten } = await leesDoelen(uitzendMap);
    return { ok: true, doelen: doelen.map(({ url, ...rest }) => rest), fouten };
  } catch (err) {
    return { ok: false, doelen: [], fouten: [err.message] };
  }
}

/** Het beeldfilter van het stil-profiel: het beeld komt uit het geluid zelf (één invoer, één klok). */
function beeldFilter(beeld, fps) {
  if (beeld === 'golf') return `[0:a]asplit[a][b];[b]showwaves=s=1280x720:rate=${fps}:mode=cline:colors=white,format=yuv420p[v]`;
  if (beeld !== 'zwart' && PNG.test(beeld)) {
    return `movie=beelden/${beeld},loop=loop=-1:size=1,fps=${fps},scale=1280:720[p];`
      + `[0:a]asplit[a][b];[b]showwaves=s=1280x720:rate=${fps}:mode=cline:colors=white@0.5[w];`
      + '[p][w]overlay=shortest=1,format=yuv420p[v]';
  }
  return `[0:a]asplit[a][b];[b]showwaves=s=1280x720:rate=${fps}:colors=black,format=yuv420p[v]`;
}

/** De argumenten voor ffmpeg (docs/UITZENDEN.md §4). Puur. `uit` is het pad of de url. */
export function bouwArgs(doel, { uit, fps } = {}) {
  const kop = ['-hide_banner', '-loglevel', 'error', '-n', '-progress', 'pipe:3', '-stats_period', '1'];
  const br = doel.bitrate || (doel.bron === 'video' ? '2500k' : '300k');
  let midden;
  if (doel.bron === 'video') {
    const map = ['-map', '0:v:0', '-map', '0:a:0'];
    if (doel.video === 'kopie') midden = ['-f', 'mp4', '-i', 'pipe:0', ...map, '-c', 'copy'];
    else {
      const k = Number(br.slice(0, -1));
      midden = ['-hwaccel', 'videotoolbox', '-f', 'mp4', '-i', 'pipe:0', ...map,
        '-c:v', 'h264_videotoolbox', '-realtime', '1', '-b:v', br, '-maxrate', br, '-bufsize', `${2 * k}k`, '-g', '60', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy'];
    }
  } else {
    const f = fps ?? doel.fps ?? 2;
    midden = ['-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
      '-filter_complex', beeldFilter(doel.beeld ?? 'zwart', f), '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-g', String(2 * f), '-b:v', br,
      '-c:a', 'aac', '-b:a', '192k'];
  }
  const muxer = doel.soort === 'udp' ? ['-f', 'mpegts', uit]
    : doel.soort === 'rtmp' ? ['-f', 'flv', '-flvflags', 'no_duration_filesize', uit]
      : ['-f', 'flv', uit];
  return [...kop, ...midden, ...muxer];
}

/** G9: set-<id>.uitzend.flv, of -2, -3 … : de eerste naam waarvan flv én mp4 nog vrij zijn. Puur. */
export function uitgangsPad(uitMap, id, bestaat) {
  for (let n = 1; n < 1000; n++) {
    const stam = join(uitMap, `set-${id}.uitzend${n === 1 ? '' : `-${n}`}`);
    if (!bestaat(`${stam}.flv`) && !bestaat(`${stam}.mp4`)) return `${stam}.flv`;
  }
  return join(uitMap, `set-${id}.uitzend-${Date.now()}.flv`);
}

/** G7: alles wat op een sleutel lijkt eruit. rtmp://host/app/**** , ?key=**** , user:pw@ . Puur. */
export function maskeer(tekst) {
  return String(tekst ?? '')
    .replace(/(\w+:\/\/)[^\s/@]*@/g, '$1****@')
    .replace(/(rtmps?:\/\/[^\s/]+\/[^\s/?#]+\/)[^\s?#]+/gi, '$1****')
    .replace(/([?&](?:key|sleutel|token|streamkey|stream_key|secret|auth|sig|password|pw)=)[^&\s]+/gi, '$1****');
}

/** De mp4-boxen op het hoogste niveau: [{ type, begin, grootte }]. Stopt bij iets dat geen box is. Puur. */
export function boxen(buf, vanaf = 0) {
  const uit = [];
  let p = vanaf;
  while (p + 8 <= buf.length) {
    let grootte = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (!/^[a-zA-Z0-9 ©_-]{4}$/.test(type)) break;
    if (grootte === 1) {
      if (p + 16 > buf.length) break;
      const groot = buf.readBigUInt64BE(p + 8);
      if (groot > BigInt(Number.MAX_SAFE_INTEGER)) break;
      grootte = Number(groot);
    } else if (grootte === 0) grootte = buf.length - p;
    if (grootte < 8) break;
    uit.push({ type, begin: p, grootte });
    p += grootte;
  }
  return uit;
}

/** Welk geluid zit er in deze (begin van een) mp4: 'mp4a', 'Opus' of null. Zoekt in moov. Puur. */
export function audioCodecVanMp4(buf) {
  const moov = boxen(buf).find((b) => b.type === 'moov');
  if (!moov) return null;
  const stuk = buf.subarray(moov.begin, Math.min(buf.length, moov.begin + moov.grootte));
  if (stuk.indexOf('mp4a', 0, 'latin1') >= 0) return 'mp4a';
  if (stuk.indexOf('Opus', 0, 'latin1') >= 0) return 'Opus';
  return null;
}

/** G9: gaat de opnamemap mee naar iCloud (Bureaublad/Documenten in iCloud Drive)? Puur. */
export function iCloudWaarschuwing(opnames, home, bestaat) {
  for (const map of ['Desktop', 'Documents']) {
    const basis = join(home, map);
    if (opnames !== basis && !opnames.startsWith(basis + sep)) continue;
    if (!bestaat(join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', map))) return null;
    return `opnames gaan mee naar iCloud (${map === 'Desktop' ? 'Bureaublad' : 'Documenten'}): tijdens een uitzending uploadt iCloud de opname over dezelfde lijn (docs/VRAGEN.md U3)`;
  }
  return null;
}

/** Ligt `kind` in `ouder` (of is het dezelfde map)? */
const binnen = (kind, ouder) => { const a = resolve(kind), b = resolve(ouder); return a === b || a.startsWith(b + sep); };
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const tekstS = (s) => s.toFixed(1).replace('.', ',');

// ---- de zending ----------------------------------------------------------------

function legeStand() {
  return {
    bezig: false, doel: null, id: null, bron: null, soort: null, sinds: null, door: null, beeldstand: null,
    bronS: 0, gevolgdS: 0, uitS: 0, achterstandS: 0, achterstandTekst: '', bitrateKbit: null,
    kwijtS: 0, sprongen: 0, fout: null, ffmpeg: 'uit', uit: null, waarschuwingen: [],
  };
}

class Zending {
  constructor() { this.s = legeStand(); this.kind = null; this.stopBelofte = null; }

  stand() {
    const s = this.s;
    return { ...s, uit: s.uit ? { ...s.uit } : null, waarschuwingen: [...s.waarschuwingen], fout: s.fout ? maskeer(s.fout) : null };
  }

  async start(o = {}) {
    try { return await this._start(o); } catch (err) { return { ok: false, fout: maskeer(err.message) }; }
  }

  async _start({
    opnames, uitzendMap = STANDAARD_MAP, uitMap = process.env.VARVE_UITZEND_UIT || STANDAARD_UIT, id, doel: naam,
    beeldstand, door, ffmpeg = 'ffmpeg', pollMs = 250, stilNa = 10000, stopNa = 30000, achterstandMax = 8, wachtMp4 = 10000,
    _argsHaak,
  } = {}) {
    if (this.s.bezig || this.kind || this.bezigMetStarten) return { ok: false, fout: 'er loopt al een uitzending' };
    if (typeof id !== 'string' || !ID.test(id)) return { ok: false, fout: 'ongeldig opname-id' };
    if (typeof opnames !== 'string' || !opnames) return { ok: false, fout: 'geen opnamemap' };
    if (beeldstand !== undefined && !['alles', 'vormen'].includes(beeldstand)) return { ok: false, fout: 'beeldstand moet alles of vormen zijn' };
    this.bezigMetStarten = true;
    try {
      const { doelen } = await leesDoelen(uitzendMap);
      const doel = doelen.find((d) => d.naam === naam);
      if (!doel) return { ok: false, fout: `onbekend doel "${String(naam).slice(0, 40)}"` };
      const mag = toegestaan(doel);                                   // dubbel: ook al in leesDoelen
      if (!mag.ok) return { ok: false, fout: mag.fout };

      // G5: geen uitzending zonder opname. G1: alleen set-<id>.wav uit de opnamemap.
      const wavPad = join(opnames, `set-${id}.wav`);
      let wav;
      try { wav = await open(wavPad, 'r'); } catch { return { ok: false, fout: 'geen opname: start eerst de opname' }; }
      const kopBuf = Buffer.alloc(16);
      const { bytesRead } = await wav.read(kopBuf, 0, 16, 0);
      const kop = kopVan(kopBuf.subarray(0, bytesRead));
      if (!kop) { await wav.close(); return { ok: false, fout: 'geen opname-kop in het bestand' }; }
      const grootte = (await wav.stat()).size;
      const dataNu = Math.max(0, grootte - kop);
      const bronS = dataNu / BPS;

      const waarschuwingen = [];
      if (doel.waarschuwing) waarschuwingen.push(doel.waarschuwing);
      const ic = iCloudWaarschuwing(resolve(opnames), homedir(), existsSync);
      if (ic) waarschuwingen.push(ic);

      // Beeld: de mp4 van de video-opname, vanaf byte 0 (v1: alleen samen met de opname).
      let mp4 = null;
      if (doel.bron === 'video') {
        const sluitWav = async (fout) => { await wav.close(); return { ok: false, fout }; };
        if (bronS >= 10) return sluitWav('video-uitzending start in v1 samen met de opname (binnen 10 s); kies een doel met bron audio');
        if (existsSync(join(opnames, `set-${id}.webm`))) return sluitWav('de video is webm: kies een doel met bron audio');
        const mp4Pad = join(opnames, `set-${id}.mp4`);
        const t0 = Date.now();
        let begin = null;
        while (Date.now() - t0 <= wachtMp4) {
          const b = await readFile(mp4Pad).catch(() => null);   // klein zolang de opname net begint
          if (b) {
            const bx = boxen(b.subarray(0, 4 * 1024 * 1024));
            const moov = bx.find((x) => x.type === 'moov');
            if (moov && moov.begin + moov.grootte <= b.length) { begin = b.subarray(0, Math.min(b.length, 64 * 1024)); break; }
          }
          await wacht(Math.min(100, wachtMp4));
        }
        if (!begin) return sluitWav('geen videobestand: start de opname met audio + video');
        const codec = audioCodecVanMp4(begin);
        if (codec === 'Opus' && doel.soort === 'rtmp') return sluitWav('mp4 met Opus: kies een doel met bron audio (een RTMP-dienst verwacht AAC)');
        if (codec === 'Opus') waarschuwingen.push('Opus in de mp4: goed voor een bestand of OBS, niet voor een RTMP-dienst');
        try { mp4 = await open(mp4Pad, 'r'); } catch { return sluitWav('geen videobestand: start de opname met audio + video'); }
      }

      // De uitgang: een vrije naam buiten opnames/ (G9), of de lokale url.
      let uit, uitInfo = null;
      if (doel.soort === 'bestand') {
        if (binnen(uitMap, opnames)) { await wav.close(); await mp4?.close(); return { ok: false, fout: 'de uitgang mag niet in de opnamemap (G9)' }; }
        await mkdir(uitMap, { recursive: true });
        uit = uitgangsPad(uitMap, id, existsSync);
        uitInfo = { flv: uit, mp4: null };
      } else uit = doel.url;

      if (doel.bron === 'audio' && doel.beeld !== 'zwart' && doel.beeld !== 'golf' && !existsSync(join(uitzendMap, 'beelden', doel.beeld))) {
        await wav.close(); await mp4?.close();
        return { ok: false, fout: `plaat uitzend/beelden/${doel.beeld} bestaat niet` };
      }

      // Het kind. cwd = de uitzendmap: dan blijft het Bureaublad-pad (spaties) uit de filtergraaf.
      await mkdir(uitzendMap, { recursive: true });
      let args = bouwArgs(doel, { uit });
      if (_argsHaak) args = _argsHaak(args);
      const kind = spawn(ffmpeg, args, { cwd: uitzendMap, stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
      const gestart = await new Promise((r) => { kind.once('spawn', () => r(true)); kind.once('error', (e) => r(e)); });
      if (gestart !== true) {
        await wav.close(); await mp4?.close();
        Object.assign(this.s, { ffmpeg: 'weg', fout: `ffmpeg start niet: ${gestart.code || gestart.message}` });
        return { ok: false, fout: this.s.fout };
      }

      // Opname jonger dan 2 s: vanaf het begin. Anders vanaf nu (midden in de set).
      const eind = kop + dataNu - (dataNu % FRAME);
      Object.assign(this, {
        kind, wav, mp4, kop, pollMs, stilNa, stopNa, achterstandMax, doelObj: doel, ffmpegPad: ffmpeg, remuxBelofte: null,
        pos: doel.bron === 'audio' ? (bronS < 2 ? kop : eind) : 0,
        eind, mp4Eind: 0, gevolgd: 0, draining: false, sprongVlag: false, pompBelofte: null, pompt: false,
        laatsteGroei: Date.now(), stderr: [], stoppen: false, stopBelofte: null,
      });
      this.s = {
        ...legeStand(), bezig: true, doel: doel.naam, id, bron: doel.bron, soort: doel.soort, sinds: Date.now(),
        door: door ?? null, beeldstand: beeldstand ?? null, bronS, ffmpeg: 'loopt', uit: uitInfo, waarschuwingen,
      };
      this._kindLuisteraars(kind);
      this.poll = setInterval(() => { this._poll().catch(() => {}); }, pollMs);
      this._poll().catch(() => {});
      return { ok: true, doel: doel.naam, bron: doel.bron, soort: doel.soort, ...(uitInfo ? { uit: uitInfo.flv } : {}), waarschuwingen: [...waarschuwingen] };
    } finally {
      this.bezigMetStarten = false;
    }
  }

  _kindLuisteraars(kind) {
    kind.on('error', (e) => { this.s.fout = maskeer(`ffmpeg: ${e.code || e.message}`); });
    kind.stdin.on('error', () => {});                                // EPIPE: ffmpeg is weg; close meldt het
    kind.stdio[3].on('error', () => {});
    kind.stderr.on('error', () => {});
    let rest = '';
    kind.stderr.on('data', (b) => {
      const regels = (rest + b.toString()).split(/\r?\n/);
      rest = regels.pop();
      for (const r of regels) if (r.trim()) { this.stderr.push(maskeer(r.trim()).slice(0, 300)); if (this.stderr.length > 5) this.stderr.shift(); }
    });
    let restP = '';
    kind.stdio[3].on('data', (b) => {                                // -progress: sleutel=waarde, één per regel
      const regels = (restP + b.toString()).split('\n');
      restP = regels.pop();
      if (this.kind !== kind) return;
      for (const r of regels) {
        let m;
        if ((m = /^out_time_us=(\d+)/.exec(r))) this.s.uitS = Number(m[1]) / 1e6;
        else if ((m = /^bitrate=\s*([\d.]+)kbits\/s/.exec(r))) this.s.bitrateKbit = Number(m[1]);
      }
    });
    kind.on('close', (code, sig) => {
      if (this.kind !== kind) return;
      this.kind = null;
      if (this.stoppen) return;                                        // stop() handelt het af
      // Onverwacht: de uitzending is voorbij, de opname loopt door (G4). v1: geen herstart.
      this.s.ffmpeg = 'weg';
      this.s.fout = this.stderr.at(-1) || `ffmpeg stopte onverwacht (${sig || `code ${code}`})`;
      this._opruimen().then(() => this._remux(false)).catch(() => {}).finally(() => { this.s.bezig = false; });
    });
  }

  async _poll() {
    if (!this.s.bezig || this.stoppen || !this.wav) return;
    const nu = Date.now();
    const grootte = (await this.wav.stat()).size;
    const data = Math.max(0, grootte - this.kop);
    const eind = this.kop + data - (data % FRAME);
    if (eind > this.eind) { this.laatsteGroei = nu; if (this.s.fout === 'bron stil') this.s.fout = null; }
    this.eind = Math.max(this.eind, eind);
    this.s.bronS = (this.eind - this.kop) / BPS;
    if (this.mp4) this.mp4Eind = (await this.mp4.stat()).size;

    this._meet();
    // Bron stil: een gesloten of hangend tabblad.
    const stil = nu - this.laatsteGroei;
    if (stil > this.stopNa) { this.s.fout = 'bron stil'; this._stopIntern('bron stil'); return; }
    if (stil > this.stilNa) this.s.fout = 'bron stil';
    if (this.s.bron === 'audio' && this.s.achterstandS > this.achterstandMax) this.sprongVlag = true;
    if (this.s.bron === 'video' && this.s.achterstandS > 20) { this.s.fout = 'achterstand'; this._stopIntern('achterstand'); return; }
    this._pomp();
  }

  /** H1: achterstand = wat nog in het bestand wacht + wat in pijp en encoder zit, tegen de WAV-klok. */
  _meet() {
    const s = this.s;
    s.gevolgdS = s.bron === 'audio' ? this.gevolgd / BPS : s.gevolgdS;
    if (s.bron === 'audio') s.achterstandS = (this.eind - this.pos) / BPS + Math.max(0, s.gevolgdS - s.uitS);
    else s.achterstandS = Math.max(0, s.bronS - s.uitS);
    s.achterstandTekst = s.bron === 'video'
      ? `≈ ${tekstS(s.achterstandS)} s achter (beeld komt per 3,4 s)`
      : `≈ ${tekstS(s.achterstandS)} s achter`;
  }

  /**
   * Schrijf wat er is, in blokken; wacht op drain als ffmpeg niet bijhoudt (en poll intussen door).
   * `pompt` is een synchrone vlag: de lus kan zonder await al klaar zijn (niets te lezen), en dan
   * loopt zijn `finally` vóór de toewijzing aan `pompBelofte`. Op die belofte wachten mag, erop
   * vertrouwen als "loopt nog" niet (dat liet de pomp eerst voor altijd stilstaan).
   */
  _pomp() {
    if (this.pompt || this.draining || !this.kind) return this.pompBelofte || Promise.resolve();
    this.pompt = true;
    this.pompBelofte = (async () => {
      try {
        while (this.kind && !this.draining && !this.stoppenHard) {
          const kind = this.kind;
          let buf;
          if (this.s.bron === 'audio') {
            if (this.sprongVlag) {                                     // H1: sprong naar het eind, op een frame
              this.sprongVlag = false;
              const over = this.eind - this.pos;
              if (over > 0) { this.pos = this.eind; this.s.kwijtS += over / BPS; this.s.sprongen++; }
            }
            const n = Math.min(BLOK_WAV, this.eind - this.pos);
            if (n <= 0) break;
            buf = Buffer.allocUnsafe(n);
            const { bytesRead } = await this.wav.read(buf, 0, n, this.pos);
            buf = buf.subarray(0, bytesRead - (bytesRead % FRAME));
            if (!buf.length) break;
            this.pos += buf.length;
            this.gevolgd += buf.length;
          } else {
            const n = Math.min(BLOK_MP4, this.mp4Eind - this.pos);
            if (n <= 0) break;
            buf = Buffer.allocUnsafe(n);
            const { bytesRead } = await this.mp4.read(buf, 0, n, this.pos);
            buf = buf.subarray(0, bytesRead);
            if (!buf.length) break;
            this.pos += buf.length;
            this.gevolgd += buf.length;
          }
          if (kind !== this.kind || kind.stdin.destroyed || kind.stdin.writableEnded) break;
          if (!kind.stdin.write(buf)) {
            this.draining = true;
            kind.stdin.once('drain', () => { this.draining = false; this._pomp(); });
          }
        }
      } catch { /* bestand weg of kind weg: de poll of close meldt het */ } finally {
        this.pompt = false;
        this._meet();
      }
    })();
    return this.pompBelofte;
  }

  /** Eén laatste ronde tot het eind van het bestand (bij opnameKlaar), hooguit `ms`. */
  async _leeg(ms = 10000) {
    const t0 = Date.now();
    while (this.kind && Date.now() - t0 < ms) {
      const grootte = (await this.wav.stat()).size;
      const data = Math.max(0, grootte - this.kop);
      this.eind = Math.max(this.eind, this.kop + data - (data % FRAME));
      if (this.mp4) this.mp4Eind = (await this.mp4.stat()).size;
      const doelPos = this.s.bron === 'audio' ? this.eind : this.mp4Eind;
      if (this.pos >= doelPos && !this.pompt) return;
      if (this.draining) { await wacht(20); continue; }
      await this._pomp();
    }
  }

  _stopIntern(reden) { this.stop().catch(() => {}); return reden; }

  stop({ snel = false } = {}) {
    if (this.stopBelofte) return this.stopBelofte;
    if (!this.s.bezig && !this.kind) return Promise.resolve({ ok: true, duurS: 0, bytes: 0, stopS: 0, ...(this.s.uit ? { uit: { ...this.s.uit } } : {}) });
    this.stopBelofte = this._stop(snel).catch((err) => ({ ok: false, fout: maskeer(err.message) }));
    return this.stopBelofte;
  }

  async _stop(snel) {
    const t0 = Date.now();
    this.stoppen = true;
    clearInterval(this.poll);
    const kind = this.kind;
    const stap = snel ? 1500 : 3000;
    if (kind) {
      const dicht = new Promise((r) => kind.once('close', r));
      const binnen = (ms) => Promise.race([dicht.then(() => true), wacht(ms).then(() => false)]);
      try { kind.stdin.end(); } catch { /* al dicht */ }
      if (!(await binnen(stap))) {
        try { kind.kill('SIGINT'); } catch { /* weg */ }
        if (!(await binnen(stap))) { try { kind.kill('SIGKILL'); } catch { /* weg */ } await binnen(2000); }
      }
      this.kind = null;
      if (this.s.ffmpeg === 'loopt') this.s.ffmpeg = 'uit';
    }
    const stopS = (Date.now() - t0) / 1000;
    await this._opruimen();
    if (snel) {
      if (this.s.uit?.flv) this.s.waarschuwingen.push(`mp4 niet gemaakt (snel stoppen): ffmpeg -i "${this.s.uit.flv}" -c copy uit.mp4`);
    } else await this._remux(true);
    const r = { ok: true, duurS: this.s.sinds ? (Date.now() - this.s.sinds) / 1000 : 0, bytes: this.gevolgd || 0, stopS, ...(this.s.uit ? { uit: { ...this.s.uit } } : {}) };
    this.s.bezig = false;
    this.stoppen = false;
    this.stopBelofte = null;
    return r;
  }

  async _opruimen() {
    clearInterval(this.poll);
    const w = this.wav, m = this.mp4;
    this.wav = null; this.mp4 = null;
    await w?.close().catch(() => {});
    await m?.close().catch(() => {});
  }

  /** W6: na stop een .mp4 naast de .flv (de flv blijft staan: niets verwijderen). Eén keer tegelijk. */
  _remux(netjes) {
    if (!this.remuxBelofte) this.remuxBelofte = this._remuxEens(netjes).finally(() => { this.remuxBelofte = null; });
    return this.remuxBelofte;
  }

  async _remuxEens(netjes) {
    const flv = this.s.uit?.flv;
    if (!flv || this.s.uit.mp4 || !existsSync(flv)) return;
    const grootte = (await stat(flv).catch(() => ({ size: 0 }))).size;
    if (!grootte) return;
    const mp4 = flv.replace(/\.flv$/, '.mp4');
    const kind = spawn(this.ffmpegPad || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-i', flv, '-c', 'copy', '-movflags', '+faststart', mp4],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let fout = '';
    kind.stderr.on('data', (b) => { fout = (fout + b.toString()).slice(-300); });
    const ms = 20000 + Math.ceil(grootte / 100e6) * 1000;
    const code = await Promise.race([
      new Promise((r) => { kind.once('close', (c) => r(c)); kind.once('error', () => r(-1)); }),
      wacht(ms).then(() => { try { kind.kill('SIGKILL'); } catch { /* weg */ } return 'tijd'; }),
    ]);
    if (code === 0 && existsSync(mp4)) this.s.uit.mp4 = mp4;
    else this.s.waarschuwingen.push(maskeer(`mp4 maken lukte niet${code === 'tijd' ? ' (duurde te lang)' : ''}${netjes ? '' : ' na een afgebroken uitzending'}: ${fout.trim().split('\n').pop() || `code ${code}`}`));
  }

  async opnameKlaar(id) {
    try {
      if (!this.s.bezig || this.s.id !== id || this.stoppen) return { ok: true };
      clearInterval(this.poll);
      await this._leeg();
      const r = await this.stop();
      return { ok: r.ok };
    } catch (err) {
      return { ok: false, fout: maskeer(err.message) };
    }
  }

  _reset() {
    clearInterval(this.poll);
    try { this.kind?.kill('SIGKILL'); } catch { /* weg */ }
    this.kind = null;
    this.wav?.close().catch(() => {}); this.mp4?.close().catch(() => {});
    this.wav = null; this.mp4 = null;
    this.stopBelofte = null; this.stoppen = false; this.bezigMetStarten = false; this.pompBelofte = null; this.pompt = false; this.draining = false;
    this.s = legeStand();
  }
}

const zending = new Zending();

/** Start een uitzending van opname `id` naar doel `doel` (een naam uit doelen.json). */
export const start = (o) => zending.start(o);
/** Stop netjes (G6). `snel`: bij het afsluiten van de server, zonder mp4-remux. */
export const stop = (o) => zending.stop(o);
/** De opname is klaar: lees tot het eind, laat ffmpeg spoelen, stop. */
export const opnameKlaar = (id) => zending.opnameKlaar(id);
/** De stand voor de UI: nooit een url of sleutel. */
export const stand = () => zending.stand();
/** Alleen voor tests: stopt alles meteen (SIGKILL) en zet de stand terug. */
export const _reset = () => zending._reset();
/** Alleen voor tests: het pid van het ffmpeg-kind. */
export const _pid = () => zending.kind?.pid ?? null;
