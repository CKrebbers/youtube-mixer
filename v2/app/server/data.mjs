/**
 * De eigen data van v2, los van de v1-library (die blijft alleen lezen):
 *   nummers/<id>.json        wat bij een nummer hoort (hotcues, cue): de app bewaart, de app leest
 *   opnames/set-<id>.wav     opgenomen sets (de master ná de limiter), per stuk op zijn frame
 *   opnames/set-<id>.acties.jsonl   het handelingenlog van die set, per stuk op zijn byte
 *
 * Waar: VARVE_V2_DATA, anders ~/.varve/v2. Nooit in git en nooit in iCloud (v1 systeem-020: code
 * en data in iCloud konden alle decks tegelijk stilleggen). Elk stuk komt op ZIJN plek
 * (?frame=N, ?van=B), niet erachter: een herhaling na een verloren antwoord schrijft hetzelfde
 * nog eens op dezelfde plek, en een stuk dat nooit aankwam is stilte op zijn plek (v1 opname.js).
 */
import { mkdirSync, openSync, writeSync, readSync, closeSync, readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const SR = 48000;
export const KOP = 44;                       // WAV-kop: 16-bit stereo 48 kHz
export const MAX_STUK = 4 * 1024 * 1024;     // een stuk opname of log
export const MAX_NUMMER = 64 * 1024;
const ID_NUMMER = /^[\w.:-]{1,128}$/;
const ID_SET = /^set-\d{8}-\d{6}$/;

export function kiesData(env = process.env) { return env.VARVE_V2_DATA || join(homedir(), '.varve', 'v2'); }

/** De WAV-kop voor `frames` frames (16-bit stereo, SR). */
export function wavKop(frames) {
  const b = Buffer.alloc(KOP), data = frames * 4;
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

export class Data {
  constructor(map = kiesData()) {
    this.map = map;
    this.herstel();
  }

  /** De mappen pas bij het eerste schrijven (een server die alleen leest maakt niets aan). */
  _zeker(sub) { mkdirSync(join(this.map, sub), { recursive: true }); }

  // ---- nummers ----------------------------------------------------------------

  leesNummer(id) {
    if (!ID_NUMMER.test(id)) return { fout: 400, reden: 'id klopt niet' };
    const p = join(this.map, 'nummers', `${encodeURIComponent(id)}.json`);
    if (!existsSync(p)) return { data: {} };
    try { return { data: JSON.parse(readFileSync(p, 'utf8')) }; } catch { return { data: {} }; }
  }

  /** Alleen wat we kennen, gecontroleerd; schrijven via een tijdelijk bestand (nooit half). */
  schrijfNummer(id, in_) {
    if (!ID_NUMMER.test(id)) return { fout: 400, reden: 'id klopt niet' };
    if (!in_ || typeof in_ !== 'object') return { fout: 400, reden: 'verwacht een object' };
    const uit = {};
    if ('hotcues' in in_) {
      const h = in_.hotcues;
      if (!Array.isArray(h) || h.length > 8 || !h.every((x) => x === null || (typeof x === 'number' && x >= 0 && x < 86400))) return { fout: 400, reden: 'hotcues: hooguit 8, null of seconden' };
      uit.hotcues = h;
    }
    if ('cue' in in_) {
      if (typeof in_.cue !== 'number' || !(in_.cue >= 0 && in_.cue < 86400)) return { fout: 400, reden: 'cue: seconden' };
      uit.cue = in_.cue;
    }
    const oud = this.leesNummer(id).data;
    this._zeker('nummers');
    const p = join(this.map, 'nummers', `${encodeURIComponent(id)}.json`);
    writeFileSync(p + '.tmp', JSON.stringify({ ...oud, ...uit }));
    renameSync(p + '.tmp', p);
    return { data: { ...oud, ...uit } };
  }

  // ---- instellingen (geleerde indelingen, indeling per nummer) ---------------------

  leesInstelling(naam) {
    if (!/^[\w-]{1,64}$/.test(naam)) return { fout: 400, reden: 'naam klopt niet' };
    const p = join(this.map, 'instellingen', `${naam}.json`);
    if (!existsSync(p)) return { data: null };
    try { return { data: JSON.parse(readFileSync(p, 'utf8')) }; } catch { return { data: null }; }
  }

  schrijfInstelling(naam, waarde) {
    if (!/^[\w-]{1,64}$/.test(naam)) return { fout: 400, reden: 'naam klopt niet' };
    if (waarde === undefined) return { fout: 400, reden: 'leeg' };
    this._zeker('instellingen');
    const p = join(this.map, 'instellingen', `${naam}.json`);
    writeFileSync(p + '.tmp', JSON.stringify(waarde));
    renameSync(p + '.tmp', p);
    return { data: { ok: true } };
  }

  // ---- opnames ----------------------------------------------------------------

  _pad(id, soort) { return join(this.map, 'opnames', soort === 'wav' ? `${id}.wav` : `${id}.acties.jsonl`); }

  /** Een stuk audio (Int16 stereo) op frame N. De kop krijgt pas bij 'klaar' zijn lengte. */
  opnameStuk(id, frame, buf) {
    if (!ID_SET.test(id)) return { fout: 400, reden: 'id klopt niet' };
    if (!Number.isInteger(frame) || frame < 0 || frame > SR * 3600 * 12) return { fout: 400, reden: 'frame klopt niet' };
    if (buf.length % 4 !== 0) return { fout: 400, reden: 'geen hele frames' };
    this._zeker('opnames');
    const p = this._pad(id, 'wav');
    const fd = openSync(p, existsSync(p) ? 'r+' : 'w+');
    try {
      if (fstatSync(fd).size < KOP) writeSync(fd, wavKop(0), 0, KOP, 0);
      writeSync(fd, buf, 0, buf.length, KOP + frame * 4);
    } finally { closeSync(fd); }
    return { data: { ok: true } };
  }

  /** Klaar: de kop krijgt de lengte; een staart die nooit aankwam wordt stilte (tot `frames`). */
  opnameKlaar(id, frames) {
    if (!ID_SET.test(id)) return { fout: 400, reden: 'id klopt niet' };
    const p = this._pad(id, 'wav');
    if (!existsSync(p)) return { fout: 404, reden: 'geen opname' };
    const fd = openSync(p, 'r+');
    try {
      const nu = Math.floor((fstatSync(fd).size - KOP) / 4);
      const n = Number.isInteger(frames) && frames >= nu ? frames : nu;
      if (n > nu) writeSync(fd, Buffer.alloc(4), 0, 4, KOP + n * 4 - 4);   // een gat aan het eind = nullen
      writeSync(fd, wavKop(n), 0, KOP, 0);
    } finally { closeSync(fd); }
    return { data: { ok: true } };
  }

  /** Een stuk van het log (ASCII) op byte B. */
  logStuk(id, van, buf) {
    if (!ID_SET.test(id)) return { fout: 400, reden: 'id klopt niet' };
    if (!Number.isInteger(van) || van < 0) return { fout: 400, reden: 'van klopt niet' };
    for (const c of buf) if (c > 127) return { fout: 400, reden: 'alleen ASCII' };
    this._zeker('opnames');
    const p = this._pad(id, 'log');
    const fd = openSync(p, existsSync(p) ? 'r+' : 'w+');
    try { writeSync(fd, buf, 0, buf.length, van); } finally { closeSync(fd); }
    return { data: { ok: true } };
  }

  /** De opnames, nieuwste eerst; een kop die nooit 'klaar' kreeg wordt eerst hersteld. */
  lijst() {
    const uit = [];
    if (!existsSync(join(this.map, 'opnames'))) return uit;
    for (const f of readdirSync(join(this.map, 'opnames'))) {
      const m = /^(set-\d{8}-\d{6})\.wav$/.exec(f);
      if (!m) continue;
      const s = statSync(join(this.map, 'opnames', f));
      uit.push({ id: m[1], bytes: s.size, seconden: Math.max(0, (s.size - KOP) / 4 / SR), log: existsSync(this._pad(m[1], 'log')) });
    }
    return uit.sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  /** Na een crash: koppen met lengte 0 krijgen de lengte uit de bestandsgrootte (v1 lijst()). */
  herstel() {
    if (!existsSync(join(this.map, 'opnames'))) return;
    for (const f of readdirSync(join(this.map, 'opnames'))) {
      if (!/^set-\d{8}-\d{6}\.wav$/.test(f)) continue;
      const p = join(this.map, 'opnames', f);
      const fd = openSync(p, 'r+');
      try {
        const size = fstatSync(fd).size;
        if (size < KOP) continue;
        const kop = Buffer.alloc(KOP);
        readSync(fd, kop, 0, KOP, 0);
        const frames = Math.floor((size - KOP) / 4);
        if (kop.readUInt32LE(40) !== frames * 4) writeSync(fd, wavKop(frames), 0, KOP, 0);
      } finally { closeSync(fd); }
    }
  }
}
