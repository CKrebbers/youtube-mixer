import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { readFile, readdir, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, basename, isAbsolute, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import {
  parsePmset, parsePmsetAc, parseIoregAccu, parseDf, parseOptimize, parseAudio, parseBluetooth, parseUsbHost,
  parseIoregUsb, voegUsbSamen, parseTailscale, parseBestanden, parseInstellingen, vergelijkCompleet,
  leesProfielen, beoordeel, schoon,
} from './avondpakket.js';
import { kopieen } from './backup.js';

/**
 * Het meetdeel van het avondpakket (docs/AVONDPAKKET.md, ontwerp §2.5-2.7):
 * de alleen-lezen commando's in kindprocessen, met een time-out per sonde, de
 * cache met de bevriezing, en de bundel voor de route in server/index.js.
 * Het oordeel zelf is puur en staat in server/avondpakket.js.
 *
 * - Alles wat media/ leest, loopt via `find` in een KINDPROCES (H4): geen
 *   readdir of fs.stat per bestand in het serverproces. `find -H`: een gelinkte
 *   mediamap (worktree) wordt gevolgd, anders telde hij 0 bestanden.
 * - Een sonde die faalt of te lang duurt, wordt { onbekend: '<reden>' }: grijs,
 *   nooit rood. De reden noemt nooit een pad of een opdrachtregel.
 * - Speelt er een deck (`speeltDeck()`), dan meet de cache niets nieuws: het
 *   laatste rapport komt terug met `bevroren`. Met `vers` mogen alleen de
 *   goedkope sondes (GOEDKOOP) opnieuw: nooit system_profiler, ioreg, lsof of find.
 * - VARVE_AVONDPAKKET_NEP=<map>: geen enkel commando, alles uit fixtures
 *   (`<map>/nep.json`, zie maakNep). Voor de tests en de headless-check.
 */

/** Time-out per sonde (ms). In de tests 50 ms (H13). */
export const STANDAARD_TIMEOUTS = Object.freeze({
  bestanden: 2000, instellingen: 1500, icloud: 1000, schijf: 1000, accu: 1000, audio: 2500,
  bluetooth: 1500, usb: 2500, avhub: 800, servers: 2000, tailscale: 1500, backup: 2000,
});
/** Wat ook mag terwijl er een deck speelt (met `vers`): pmset, df, defaults, pgrep, één TCP-verbinding. */
export const GOEDKOOP = Object.freeze(['icloud', 'schijf', 'accu', 'avhub', 'servers']);
/** De sondes die commando's uitvoeren (backup alleen in de CLI zonder server). */
export const SONDES = Object.freeze(['bestanden', 'instellingen', 'icloud', 'schijf', 'accu', 'audio', 'bluetooth', 'usb', 'avhub', 'servers', 'tailscale']);
/** De poort van de AV-app-hub (~/Projects/AV-app-hub, config.json). */
export const AVHUB_POORT = 7700;
/** Het standaardpad van de muziekkaart; hetzelfde als STANDAARD_PAD in server/kaart.js (test/avondpakket-meet.test.mjs bewaakt dat). */
export const KAART_STANDAARD = `${homedir()}/Desktop/3. Resources/Data/Muziekkaart/varve-kaart.json`;
const TAILSCALE = ['tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];

const fout = (reden) => Object.assign(new Error(reden), { kort: true });
const reden = (err) => (err?.kort ? err.message : schoon(String(err?.message || err || 'onbekend')).slice(0, 120));

/**
 * Eén commando, alleen lezen. Lost op met stdout; `codes` zijn exitcodes die ook
 * goed zijn (find: 1 = een map niet leesbaar maar de rest wel; lsof/pgrep: 1 =
 * niets gevonden). Een fout zegt alleen wat er misging, nooit de opdrachtregel
 * (die bevat paden): "time-out", "<naam> niet gevonden", "bestaat niet",
 * "<naam> gaf code 2". Bij de time-out wordt het kind gedood (SIGKILL).
 */
export function voerUit(cmd, args = [], { timeout = 1000, codes = [0] } = {}) {
  const naam = basename(cmd);
  return new Promise((klaar, mis) => {
    try {
      execFile(cmd, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (err, stdout, stderr) => {
        if (!err) return klaar(stdout);
        if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return mis(fout(`${naam}: te veel uitvoer`));
        if (err.killed || err.signal === 'SIGKILL') return mis(fout('time-out'));
        if (err.code === 'ENOENT') return mis(fout(`${naam} niet gevonden`));
        if (/No such file or directory/i.test(stderr || '') && !String(stdout || '').trim()) return mis(fout('bestaat niet'));
        if (typeof err.code === 'number' && codes.includes(err.code)) return klaar(stdout);
        mis(fout(`${naam} gaf code ${err.code ?? err.signal}`));
      });
    } catch { mis(fout(`${naam} niet te starten`)); }
  });
}

/** Is er iets dat luistert op 127.0.0.1:<poort>? Eén verbinding, meteen weer dicht; nooit een byte gestuurd. */
export function poortOpen(poort, { timeout = 800, host = '127.0.0.1' } = {}) {
  return new Promise((klaar) => {
    const s = connect({ port: poort, host });
    const eind = (open) => { clearTimeout(w); s.destroy(); klaar(open); };
    const w = setTimeout(() => eind(false), timeout);
    s.once('connect', () => eind(true));
    s.once('error', () => eind(false));
  });
}

/** Een belofte met een eigen grens: wat te lang duurt, wordt "time-out" (ook als de exec zelf niet stopt). */
function metGrens(belofte, ms) {
  let w;
  return Promise.race([belofte, new Promise((_, mis) => { w = setTimeout(() => mis(fout('time-out')), ms); })]).finally(() => clearTimeout(w));
}

const regels = (t) => String(t || '').split('\n').map((r) => r.trim()).filter(Boolean);

// ---- de sondes ------------------------------------------------------------------

/**
 * Per sonde: async ({ exec, verbind, paden, t, goedkoop, vorige }) → het geparste object.
 * Gooien mag: meet() maakt er { onbekend } van.
 */
const METERS = {
  async bestanden({ exec, paden, t }) {
    if (!paden.media) throw fout('geen mediamap');
    const opts = { timeout: t, codes: [0, 1] };
    let stat, dataless;
    try {
      [stat, dataless] = await Promise.all([
        exec('find', ['-H', paden.media, '-type', 'f', '-exec', 'stat', '-f', '%z %N', '{}', '+'], { ...opts, sleutel: 'find-stat' }),
        exec('find', ['-H', paden.media, '-type', 'f', '-flags', '+dataless'], { ...opts, sleutel: 'find-dataless' }),
      ]);
    } catch (err) {
      if (err?.message === 'bestaat niet') return { bestaat: false };
      throw err;
    }
    const b = parseBestanden(stat, dataless, paden.media);
    return { ...b, bestaat: true };
  },

  async instellingen({ exec, paden, t }) {
    if (!paden.wortel) throw fout('geen projectmap');
    const w = paden.wortel.replace(/\/+$/, '');
    // .git, node_modules, media/ (eigen sonde) en opnames/ (geen instellingen) overslaan.
    const args = ['-H', w, '(', '-name', '.git', '-o', '-name', 'node_modules', '-o', '-path', `${w}/media`, '-o', '-path', `${w}/opnames`, ')', '-prune',
      '-o', '-type', 'f', '-flags', '+dataless', '-print'];
    const extra = [];
    for (const e of (typeof paden.extra === 'function' ? paden.extra() : paden.extra) || []) {
      if (!e?.map || e.map === w || e.map.startsWith(w + '/')) continue;   // binnen de wortel: al meegenomen
      if (await access(e.map).then(() => true, () => false)) extra.push(e);
    }
    const [binnen, buiten] = await Promise.all([
      exec('find', args, { timeout: t, codes: [0, 1], sleutel: 'find-instellingen' }),
      extra.length ? exec('find', ['-H', ...extra.map((e) => e.map), '-type', 'f', '-flags', '+dataless', '-print'], { timeout: t, codes: [0, 1], sleutel: 'find-extra' }) : '',
    ]);
    return parseInstellingen(`${binnen}\n${buiten}`, w, extra);
  },

  async icloud({ exec, t }) {
    const v = parseOptimize(await exec('defaults', ['read', 'com.apple.bird', 'optimize-storage'], { timeout: t, sleutel: 'optimize' }));
    if (v === null) throw fout('onleesbaar');
    return v;
  },

  async schijf({ exec, paden, t }) {
    const d = parseDf(await exec('df', ['-k', paden.media || paden.wortel || '/'], { timeout: t, codes: [0, 1], sleutel: 'df' }));
    if (!d) throw fout('onleesbaar');
    return d;
  },

  async accu({ exec, t, goedkoop, vorige }) {
    const [batt, ac, io] = await Promise.allSettled([
      exec('pmset', ['-g', 'batt'], { timeout: t, sleutel: 'pmset-batt' }),
      exec('pmset', ['-g', 'ac'], { timeout: t, sleutel: 'pmset-ac' }),
      goedkoop ? Promise.reject(fout('overgeslagen')) : exec('ioreg', ['-rn', 'AppleSmartBattery'], { timeout: t, sleutel: 'ioreg-accu' }),
    ]);
    if (batt.status !== 'fulfilled') throw batt.reason;
    const p = parsePmset(batt.value);
    if (!p) throw fout('onleesbaar');
    const lader = ac.status === 'fulfilled' ? parsePmsetAc(ac.value) : null;
    const gezond = io.status === 'fulfilled' ? parseIoregAccu(io.value)
      : goedkoop && vorige && !('onbekend' in vorige) ? { gezondheid: vorige.gezondheid ?? null, cycli: vorige.cycli ?? null } : null;
    return { ...p, laderW: lader?.laderW ?? null, gezondheid: gezond?.gezondheid ?? null, cycli: gezond?.cycli ?? null };
  },

  async audio({ exec, t }) {
    const a = parseAudio(await exec('system_profiler', ['SPAudioDataType', '-json'], { timeout: t, sleutel: 'audio' }));
    if (!a) throw fout('onleesbaar');
    return a;
  },

  async bluetooth({ exec, t }) {
    const b = parseBluetooth(await exec('system_profiler', ['SPBluetoothDataType', '-json'], { timeout: t, sleutel: 'bluetooth' }));
    if (!b) throw fout('onleesbaar');
    return b;
  },

  async usb({ exec, t }) {
    const [host, io] = await Promise.allSettled([
      exec('system_profiler', ['SPUSBHostDataType', '-json'], { timeout: t, sleutel: 'usbhost' }),
      exec('ioreg', ['-p', 'IOUSB', '-w0', '-r', '-c', 'IOUSBHostDevice', '-l'], { timeout: t, codes: [0, 1], sleutel: 'ioreg-usb' }),
    ]);
    if (host.status !== 'fulfilled' && io.status !== 'fulfilled') throw host.reason;
    return voegUsbSamen(host.status === 'fulfilled' ? parseUsbHost(host.value) : [], io.status === 'fulfilled' ? parseIoregUsb(io.value) : []);
  },

  async avhub({ verbind, t }) {
    return { draait: await verbind(AVHUB_POORT, { timeout: t }) };
  },

  async servers({ exec, paden, t, goedkoop, vorige }) {
    const [op, alle] = await Promise.allSettled([
      goedkoop || !paden.db ? Promise.reject(fout('overgeslagen')) : exec('lsof', ['-t', '--', paden.db], { timeout: t, codes: [1], sleutel: 'lsof' }),
      exec('pgrep', ['-f', 'server/index\\.js'], { timeout: t, codes: [1], sleutel: 'pgrep' }),
    ]);
    if (op.status !== 'fulfilled' && alle.status !== 'fulfilled') throw alle.reason;
    const opDb = op.status === 'fulfilled' ? new Set(regels(op.value)).size
      : goedkoop && Number.isFinite(vorige?.opDb) ? vorige.opDb : null;
    return { opDb, varve: alle.status === 'fulfilled' ? regels(alle.value).length : null };
  },

  async tailscale({ exec, t }) {
    let laatste;
    for (const cmd of TAILSCALE) {
      try {
        const ts = parseTailscale(await exec(cmd, ['status', '--json'], { timeout: t, codes: [1], sleutel: 'tailscale' }));
        if (!ts) throw fout('onleesbaar');
        return ts;
      } catch (err) {
        laatste = err;
        if (!/niet gevonden$/.test(err?.message || '')) break;   // alleen bij ENOENT de volgende plek proberen
      }
    }
    throw laatste?.message?.endsWith('niet gevonden') ? fout('tailscale niet geïnstalleerd') : laatste;
  },
};

/**
 * Alle sondes parallel, elk met zijn eigen grens. Nooit een throw.
 * @param {object} o
 * @param {(cmd, args, opts) => Promise<string>} [o.exec]   standaard voerUit; opts.sleutel noemt de fixture (nep)
 * @param {(poort, { timeout }) => Promise<boolean>} [o.verbind]
 * @param {{ media?, wortel?, db?, extra?: [{ map, groep }] | (() => [{ map, groep }]) }} o.paden
 * @param {object} [o.timeouts]
 * @param {Iterable<string>} [o.alleen]   alleen deze sondes (de rest uit `vorige`, of onbekend)
 * @param {object} [o.vorige]            de vorige metingen (voor de goedkope ronde)
 * @param {string} [o.waarom]            de reden voor een sonde die niet draaide
 * @returns {Promise<object>} per sonde het object of { onbekend }
 */
export async function meet({ exec = voerUit, verbind = poortOpen, paden = {}, timeouts = {}, alleen = null, vorige = null, waarom = 'niet gemeten terwijl er een deck speelt' } = {}) {
  const t = { ...STANDAARD_TIMEOUTS, ...timeouts };
  const wel = alleen ? new Set(alleen) : null;
  const goedkoop = !!wel;
  const uit = {};
  await Promise.all(SONDES.map(async (id) => {
    if (wel && !wel.has(id)) { uit[id] = vorige?.[id] !== undefined ? vorige[id] : { onbekend: waarom }; return; }
    try {
      uit[id] = await metGrens(Promise.resolve().then(() => METERS[id]({ exec, verbind, paden, t: t[id], goedkoop, vorige: vorige?.[id] })), t[id] + 50);
    } catch (err) {
      uit[id] = { onbekend: reden(err) };
    }
  }));
  return uit;
}

/**
 * De cache op de metingen (ontwerp §2.7): hooguit één lopende meting (een tweede
 * vraag wacht op dezelfde), `ttlMs` hergebruik, `vers` binnen `versMs` ook.
 * Speelt er een deck: geen nieuwe meting maar de laatste met `bevroren`; met
 * `vers` alleen de goedkope sondes, de rest uit de vorige meting.
 * @returns {{ metingen({ vers }): Promise<{ metingen, t, duurMs, bevroren? }>, laatste }}
 */
export function maakCache({ meet: meter, ttlMs = 10000, versMs = 2000, speeltDeck = () => false, klok = Date.now } = {}) {
  let laatste = null;
  let lopend = null;
  const draai = (opties = {}) => {
    if (lopend) return lopend;
    const t0 = klok();
    lopend = Promise.resolve().then(() => meter(opties))
      .then((metingen) => (laatste = { metingen, t: t0, duurMs: Math.max(0, klok() - t0), goedkoop: !!opties.alleen }))
      .finally(() => { lopend = null; });
    return lopend;
  };
  const BEVROREN = 'er speelt een deck';
  return {
    async metingen({ vers = false } = {}) {
      if (speeltDeck()) {
        const recent = laatste && klok() - laatste.t < versMs;
        if (!vers || recent) return laatste ? { ...laatste, bevroren: BEVROREN } : { metingen: {}, t: klok(), duurMs: 0, bevroren: BEVROREN };
        if (lopend) return { ...(await lopend), bevroren: BEVROREN };
        return { ...(await draai({ alleen: GOEDKOOP, vorige: laatste?.metingen ?? null })), bevroren: BEVROREN };
      }
      if (lopend) return lopend;
      // Een goedkope (bevroren) meting is geen volledige: na het spelen meteen opnieuw.
      if (laatste && !laatste.goedkoop && klok() - laatste.t < (vers ? versMs : ttlMs)) return laatste;
      return draai({});
    },
    get laatste() { return laatste; },
  };
}

// ---- nep: fixtures in plaats van commando's -------------------------------------

/**
 * VARVE_AVONDPAKKET_NEP=<map>: `<map>/nep.json` zegt per sleutel (opts.sleutel van
 * een sonde) welke uitvoer er komt:
 *   "<bestand>" (relatief aan de map of absoluut) | { "tekst": "…" } |
 *   { "fout": "time-out" } (de sonde faalt) | { "nooit": true } (antwoordt nooit).
 * Plus "avhub": true|false, "backups": ["library-….db", …] (voor de CLI zonder
 * server), "server": { bereikbaar, nummers } en "paden": { media, wortel } (de
 * paden waar de find-fixtures onder staan). Een sleutel die ontbreekt: de sonde
 * faalt met "geen fixture".
 */
export function maakNep(map) {
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(map, 'nep.json'), 'utf8')); } catch (err) { cfg = { _fout: reden(err) }; }
  const geteld = new Map();
  const exec = (cmd, args, { sleutel } = {}) => {
    geteld.set(sleutel, (geteld.get(sleutel) || 0) + 1);
    const v = cfg[sleutel];
    if (v == null) return Promise.reject(fout(`geen fixture (${sleutel})`));
    if (typeof v === 'object' && v.nooit) return new Promise(() => {});
    if (typeof v === 'object' && v.fout) return Promise.reject(fout(String(v.fout)));
    if (typeof v === 'object' && typeof v.tekst === 'string') return Promise.resolve(v.tekst);
    return readFile(isAbsolute(String(v)) ? String(v) : join(map, String(v)), 'utf8').catch(() => Promise.reject(fout(`fixture ontbreekt (${sleutel})`)));
  };
  const verbind = async () => cfg.avhub === true;
  return { exec, verbind, cfg, geteld, paden: cfg.paden || null, backups: Array.isArray(cfg.backups) ? cfg.backups : null, server: cfg.server ?? null };
}

// ---- in het serverproces: backup, achtergrond, compleet -----------------------------

/** Wat geen absoluut pad mag zijn in een fouttekst van backup.js: de bekende mappen worden hun naam. */
function zonderPaden(tekst, paden) {
  let s = String(tekst ?? '');
  const lijst = [paden.wortel, paden.media, paden.backups, homedir()].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of lijst) s = s.split(p.replace(/\/+$/, '')).join(basename(p));
  return schoon(s);
}

/** De backup uit backups.stand(), zonder paden of backupnamen in de fout. */
export function backupMeting(stand, paden = {}) {
  if (!stand || typeof stand !== 'object') return { onbekend: 'geen stand' };
  const { laatste, ...rest } = stand;
  return { ...rest, laatste: laatste ? { tijd: laatste.tijd, bytes: laatste.bytes ?? null } : null, fout: stand.fout ? zonderPaden(stand.fout, paden) : null };
}

/** De nieuwste kopie uit de namen in de backupmap (CLI zonder server): de tijd uit de naam, lokale tijd. */
export function backupUitNamen(namen) {
  const k = kopieen(Array.isArray(namen) ? namen : [])[0];
  if (!k) return { laatste: null, bron: 'map', fout: null, bezig: false };
  const m = /^library-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(k.naam);
  const tijd = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return { laatste: { tijd }, bron: 'map', fout: null, bezig: false, aantal: kopieen(namen).length };
}

const datum = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Achtergrondwerk uit de rijen en de nacht (route, 0 ms). `nachtDatum` (vóór 12:00
 * de vorige dag) telt mee zoals Nacht.magNu.
 */
export function achtergrondMeting({ ingest = [], stems = [], nacht = null, speelt = false, nu = new Date() } = {}) {
  const tel = (l, s) => (Array.isArray(l) ? l.filter((o) => o?.status === s).length : 0);
  const vandaag = datum(nu);
  const nachtDag = nu.getHours() < 12 ? datum(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() - 1)) : vandaag;
  const dagen = Array.isArray(nacht?.speeldagen) ? nacht.speeldagen : [];
  return {
    ingestBezig: tel(ingest, 'bezig') > 0 || !!nacht?.bezig, ingestWacht: tel(ingest, 'wacht'),
    stemsBezig: tel(stems, 'bezig') > 0, stemsWacht: tel(stems, 'wacht'),
    nachtAan: !!nacht?.aan, vandaagSpeeldag: dagen.includes(vandaag) || dagen.includes(nachtDag), speelt: !!speelt,
  };
}

/**
 * De bundel voor de route (server/index.js): `rapport({ profiel, fase, vers })`
 * geeft wat GET /api/avondpakket teruggeeft. Leest profielen.json bij elk verzoek
 * (klein, in de projectmap; zo is een wijziging meteen zichtbaar).
 * @param {object} o
 * @param {{ media, wortel, db, backups, extra }} o.paden
 * @param {string} o.profielenPad
 * @param {() => object} [o.backupStand]       backups.stand()
 * @param {() => object} [o.rijen]             { ingest: wachtrij.lijst(), stems: stemsRij.lijst(), nacht: nacht.stand() }
 * @param {() => { sleutel: string, tracks: () => object[] }} [o.library]   sleutel = wijzigingen + data_version
 * @param {() => boolean} [o.speeltDeck]
 * @param {string} [o.nep]                     VARVE_AVONDPAKKET_NEP
 */
export function maakAvondpakket({ paden, profielenPad, backupStand = null, rijen = null, library = null, speeltDeck = () => false, nep = null, timeouts = {}, ttlMs, klok = Date.now }) {
  const n = nep ? maakNep(nep) : null;
  const meetPaden = n?.paden ? { ...paden, ...n.paden } : paden;
  const cache = maakCache({
    meet: (opties) => meet({ exec: n ? n.exec : voerUit, verbind: n ? n.verbind : poortOpen, paden: meetPaden, timeouts, ...opties }),
    speeltDeck, klok, ...(ttlMs ? { ttlMs } : {}),
  });
  let lib = { sleutel: null, tracks: null };
  let compleetLaatst = null;
  return {
    cache,
    async rapport({ profiel = null, fase = null, vers = false } = {}) {
      const tekst = await readFile(profielenPad, 'utf8').catch(() => null);
      const data = tekst === null ? { ...leesProfielen(''), fout: 'niet gevonden' } : leesProfielen(tekst);
      const m = await cache.metingen({ vers });
      const metingen = { ...m.metingen };
      try { metingen.backup = backupStand ? backupMeting(backupStand(), paden) : { onbekend: 'geen server' }; } catch (err) { metingen.backup = { onbekend: reden(err) }; }
      try {
        const r = rijen ? rijen() : null;
        metingen.achtergrond = r ? achtergrondMeting({ ...r, speelt: speeltDeck(), nu: new Date(klok()) }) : { onbekend: 'geen server' };
      } catch (err) { metingen.achtergrond = { onbekend: reden(err) }; }
      // Library compleet: de verwachte paden (gecachet op de wijzigingen van de database) naast wat find zag.
      try {
        if (!library) metingen.compleet = { onbekend: 'geen server' };
        else if (m.bevroren) metingen.compleet = compleetLaatst ? { ...compleetLaatst, oud: true } : { onbekend: 'er speelt een deck' };
        else if (!metingen.bestanden || 'onbekend' in metingen.bestanden || metingen.bestanden.bestaat === false) metingen.compleet = { onbekend: 'media niet gemeten' };
        else {
          const l = library();
          if (l.sleutel !== lib.sleutel || !lib.tracks) lib = { sleutel: l.sleutel, tracks: l.tracks() };
          compleetLaatst = vergelijkCompleet(lib.tracks, metingen.bestanden, meetPaden.media);
          metingen.compleet = compleetLaatst;
        }
      } catch (err) { metingen.compleet = { onbekend: reden(err) }; }
      const fasekeuze = fase === 'vertrek' || fase === 'aankomst' ? fase : null;
      const rapport = beoordeel(metingen, { profiel, fase: fasekeuze, data, nu: new Date(m.t) });
      rapport.duurMs = m.duurMs;
      if (m.bevroren) rapport.bevroren = m.bevroren;
      return rapport;
    },
  };
}

/** Paden buiten de projectmap die toch instellingen zijn (VARVE_PLANNEN e.d.) plus het kaartbestand. */
export function extraPaden({ wortel, env = process.env, kaart = null }) {
  const w = String(wortel || '').replace(/\/+$/, '');
  const uit = [];
  for (const k of ['VARVE_PLANNEN', 'VARVE_PATRONEN', 'VARVE_PROEF']) {
    const p = env[k];
    if (!p) continue;
    const rel = relative(w, p);
    if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep)[0] === '..') uit.push({ map: p, groep: 'instellingen' });
  }
  const kp = kaart || env.VARVE_KAART || KAART_STANDAARD;
  if (kp) uit.push({ map: kp, groep: 'instellingen' });
  return uit;
}
