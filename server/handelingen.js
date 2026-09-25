/**
 * Handelingenlogs: wat er op de action-bus gebeurde, als tekst die groeit
 * terwijl je speelt. Formaat en betekenis: docs/HANDELINGENLOG.md.
 *
 * Ze staan NAAST de opnames, als `set-<id>.acties.jsonl` in opnames/. Loopt
 * er een opname, dan heeft het log hetzelfde id als de WAV; een los log
 * (zonder opname) krijgt een eigen id uit dezelfde reeks. Wat bij elkaar
 * hoort blijft zo bij elkaar: een set kopiëren of weggooien neemt het log mee.
 *
 * Wegschrijven gaat zoals bij de WAV (opname.js): de browser stuurt elke
 * seconde een stuk met de plek erbij (`van`, in bytes vanaf het begin), en de
 * server zet het op DIE plek. Een herhaling na een verloren antwoord schrijft
 * dezelfde bytes op dezelfde plek (geen dubbele regels); een stuk dat helemaal
 * wegvalt laat een gat van nullen, dat de lezer overslaat. Een crash kost
 * hooguit de laatste seconde.
 *
 * Een stuk is ASCII (de browser zet alles daarboven om in \uXXXX), zodat een
 * teken nooit anders geteld kan worden dan het geschreven wordt: `van` klopt
 * dan altijd, wat er ook in een titel staat. Elke regel moet JSON zijn.
 *
 * Gooit nooit naar de aanroeper: elke functie geeft een resultaat terug.
 */
import { open, mkdir, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ID, LOG_EXT, nieuwId } from './opname.js';

export { LOG_EXT };
/** Een stuk is één seconde spelen; 4 MB is ruim honderd keer wat een drukke seconde geeft. */
export const MAX_STUK = 4 * 1024 * 1024;
/** Verder dan dit voorbij het eind schrijven is geen gat meer maar onzin. */
const MAX_SPRONG = 256 * 1024 * 1024;

const naamVan = (id) => `set-${id}${LOG_EXT}`;
const bestaat = (pad) => stat(pad).then(() => true, () => false);

/**
 * Een nieuw, leeg log. Met `id`: het log van die opname (de WAV moet er
 * zijn). Bestaat het log al, dan is dat een herhaalde start na een verloren
 * antwoord: gewoon goed, er wordt niets overschreven.
 */
export async function start(map, { id = null, nu } = {}) {
  try {
    await mkdir(map, { recursive: true });
    if (id !== null && id !== undefined) {
      if (typeof id !== 'string' || !ID.test(id)) return { ok: false, fout: 'ongeldig opname-id' };
      if (!(await bestaat(join(map, `set-${id}.wav`)))) return { ok: false, fout: 'opname bestaat niet' };
      try {
        await (await open(join(map, naamVan(id)), 'wx')).close();
        return { ok: true, id, bestand: naamVan(id), opname: true };
      } catch (err) {
        if (err.code === 'EEXIST') return { ok: true, id, bestand: naamVan(id), opname: true, bestond: true };
        throw err;
      }
    }
    let x = nieuwId(nu), n = 1;
    // Niet op een id dat al een opname of een log heeft (twee in dezelfde seconde).
    for (;;) {
      if (!(await bestaat(join(map, `set-${x}.wav`)))) {
        try {
          await (await open(join(map, naamVan(x)), 'wx')).close();
          return { ok: true, id: x, bestand: naamVan(x), opname: false };
        } catch (err) {
          if (err.code !== 'EEXIST') throw err;
        }
      }
      x = `${nieuwId(nu)}-${++n}`;
    }
  } catch (err) {
    return { ok: false, fout: err.code === 'ENOSPC' ? 'de schijf is vol' : err.message };
  }
}

/** Schrijf alles, ook als het OS maar een deel per keer neemt. */
async function schrijfAlles(f, buf, pos) {
  let klaar = 0;
  while (klaar < buf.length) {
    const { bytesWritten } = await f.write(buf, klaar, buf.length - klaar, pos + klaar);
    if (!bytesWritten) throw new Error(`maar ${klaar} van ${buf.length} bytes geschreven`);
    klaar += bytesWritten;
  }
}

/** Waarom deze tekst geen geldig stuk is, of null. */
export function keurStuk(tekst) {
  if (typeof tekst !== 'string' || !tekst.length) return 'een stuk is tekst';
  if (tekst.length > MAX_STUK) return 'stuk te groot';
  // Alleen afdrukbare ASCII en regeleinden: dan is één teken één byte.
  if (!/^[\x20-\x7e\n]*$/.test(tekst)) return 'alleen ASCII (de rest als \\uXXXX)';
  if (!tekst.endsWith('\n')) return 'een stuk eindigt met een regeleinde';
  for (const regel of tekst.slice(0, -1).split('\n')) {
    try { JSON.parse(regel); } catch { return 'elke regel moet JSON zijn'; }
  }
  return null;
}

/**
 * Een stuk tekst op byte `van`. Op de plek, niet achteraan: dan is een stuk
 * idempotent, zoals een stuk audio in opname.js.
 */
export async function schrijf(map, id, van, tekst) {
  if (typeof id !== 'string' || !ID.test(id)) return { ok: false, fout: 'ongeldig log-id' };
  if (!(Number.isSafeInteger(van) && van >= 0)) return { ok: false, fout: 'van moet een heel getal >= 0 zijn' };
  const fout = keurStuk(tekst);
  if (fout) return { ok: false, fout };
  let f;
  try {
    f = await open(join(map, naamVan(id)), 'r+');
    const { size } = await f.stat();
    if (van > size + MAX_SPRONG) return { ok: false, fout: `van ${van} ligt te ver voorbij het eind` };
    await schrijfAlles(f, Buffer.from(tekst, 'latin1'), van);
    return { ok: true };
  } catch (err) {
    if (err.code === 'ENOSPC') return { ok: false, fout: 'de schijf is vol', vol: true };
    return { ok: false, fout: err.code === 'ENOENT' ? 'log bestaat niet' : err.message };
  } finally {
    await f?.close();
  }
}

/** Het pad van een log om te lezen, of een fout. */
export async function pad(map, id) {
  if (typeof id !== 'string' || !ID.test(id)) return { ok: false, fout: 'ongeldig log-id' };
  const p = join(map, naamVan(id));
  const info = await stat(p).catch(() => null);
  return info ? { ok: true, pad: p, bytes: info.size } : { ok: false, fout: 'log bestaat niet' };
}

/** Regels uit een stuk tekst: nullen (een gat) eruit, kapotte regels (een afgebroken staart) overgeslagen. */
function regelsUit(tekst) {
  const uit = [];
  for (const r of tekst.replace(/\0+/g, '').split('\n')) {
    if (!r) continue;
    try { uit.push(JSON.parse(r)); } catch { /* half geschreven: overslaan */ }
  }
  return uit;
}

async function leesStuk(f, pos, n) {
  const b = Buffer.alloc(n);
  const { bytesRead } = await f.read(b, 0, n, pos);
  return b.subarray(0, bytesRead).toString('latin1');
}

/**
 * Wat de lijst van één log laat zien, zonder het hele bestand te lezen: de
 * kop (eerste regel) en de staart (laatste tijd, en of het netjes af is).
 */
export async function samenvatting(map, id) {
  let f;
  try {
    f = await open(join(map, naamVan(id)), 'r');
    const { size } = await f.stat();
    const kopTekst = await leesStuk(f, 0, Math.min(size, 4096));
    const eerste = kopTekst.replace(/\0+/g, '').split('\n')[0];
    let kop = null;
    try { const k = JSON.parse(eerste); if (k?.e === 'kop') kop = k; } catch { /* eerste stuk kwijt */ }
    const staartVan = Math.max(0, size - 65536);
    let staartTekst = await leesStuk(f, staartVan, size - staartVan);
    if (staartVan) staartTekst = staartTekst.slice(staartTekst.indexOf('\n') + 1);   // de eerste regel is half
    const staart = regelsUit(staartTekst);
    const tijd = (r) => (Array.isArray(r) ? r[0] : r?.t);
    let duur = 0;
    for (let i = staart.length - 1; i >= 0; i--) if (Number.isFinite(tijd(staart[i]))) { duur = tijd(staart[i]); break; }
    const eind = staart.find((r) => r?.e === 'eind');
    return {
      id, bestand: naamVan(id), bytes: size, duur,
      af: !!eind, begon: kop?.begon ?? null, versie: kop?.versie ?? null,
      opname: await bestaat(join(map, `set-${id}.wav`)),
    };
  } catch {
    return null;
  } finally {
    await f?.close();
  }
}

/** Alle logs, nieuwste eerst (zelfde volgorde als de opnames). */
export async function lijst(map) {
  const namen = await readdir(map).catch(() => []);
  const sleutel = (id) => { const [d, t, n = '1'] = id.split('-'); return [`${d}${t}`, Number(n)]; };
  const ids = namen.filter((n) => n.startsWith('set-') && n.endsWith(LOG_EXT))
    .map((n) => n.slice(4, -LOG_EXT.length)).filter((id) => ID.test(id))
    .sort((a, b) => { const [ta, na] = sleutel(a), [tb, nb] = sleutel(b); return ta === tb ? nb - na : (ta < tb ? 1 : -1); });
  const uit = [];
  for (const id of ids) {
    const s = await samenvatting(map, id);
    if (s) uit.push(s);
  }
  return uit;
}
