import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { readFile, readdir, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, basename, isAbsolute, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import {
  parsePmset, parsePmsetAc, parseIoregAccu, parseDf, parseOptimize, parseAudio, parseBluetooth, parseUsbHost,
  parseIoregUsb, voegUsbSamen, parseTailscale, parseBestanden, parseInstellingen, vergelijkCompleet, verwachtePaden,
  leesProfielen, beoordeel, schoon, parsePowerSupply, parseLsusb, parseSysUsb,
} from './avondpakket.js';
import { kopieen } from './backup.js';
import { allePunten } from '../src/controle/speellijst.js';

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
 * - `auto` (de Controlekamer, elke 5 min): uit de cache, anders alleen GOEDKOOP;
 *   nooit de dure sondes. De server ziet alleen een spelend DECK; een set met
 *   alleen patronen, sampler of instrumenten, of een iPhone die de Web Lock van
 *   de mixer niet ziet, krijgt zo toch geen system_profiler onder het geluid.
 * - VARVE_AVONDPAKKET_NEP=<map>: geen enkel commando, alles uit fixtures
 *   (`<map>/nep.json`, zie maakNep). Voor de tests en de headless-check.
 * - PLATFORM (docs/AVONDPAKKET.md "Op Linux"): de sondes hierboven zijn die van de Mac
 *   (BSD find/stat, pmset, ioreg, system_profiler, defaults). `meet({ platform })`
 *   (standaard process.platform) kiest per platform wat er gebeurt (`metersVoor`): op
 *   Linux GNU stat, sysfs en lsusb, en "niet op dit platform" (grijs) voor wat daar niet
 *   bestaat; nooit een Mac-commando dat daar iets anders betekent. Een commando dat een
 *   optie niet kent, is nooit geslaagd (`ONBEKENDE_OPTIE`), ook niet als zijn exitcode in
 *   `codes` staat: GNU find stopt op `-flags` met code 1, en die code mocht (find: een
 *   map niet leesbaar), zodat media "leeg" en instellingen vals "lokaal" werden.
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
/** Hoe lang de route wacht op een eigen bestand (profielen.json, de speellijst); uitgeplaatst en offline zou hij anders blijven hangen. */
export const LEES_MS = 1000;
/** De poort van de AV-app-hub (~/Projects/AV-app-hub, config.json). */
export const AVHUB_POORT = 7700;
/** Het standaardpad van de muziekkaart; hetzelfde als STANDAARD_PAD in server/kaart.js (test/avondpakket-meet.test.mjs bewaakt dat). */
export const KAART_STANDAARD = `${homedir()}/Desktop/3. Resources/Data/Muziekkaart/varve-kaart.json`;
const TAILSCALE = ['tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
const TAILSCALE_LINUX = ['tailscale', '/usr/bin/tailscale', '/usr/local/bin/tailscale'];
/** Op Linux elk commando met de C-locale: stderr in het Engels (ONBEKENDE_OPTIE), getallen zonder komma. */
const C = Object.freeze({ LC_ALL: 'C' });

/**
 * stderr van een commando dat een optie niet kent, of op dit platform iets anders laat
 * betekenen (GNU stat -f = bestandssysteem). Zo'n uitvoer is nooit geslaagd, welke
 * exitcode er ook bij hoort. GNU (en, nl), BSD en busybox; liever een sonde te veel
 * grijs dan één vals groen. Een gewone fout ("Permission denied") valt er niet onder.
 */
export const ONBEKENDE_OPTIE = /unknown predicate|unknown primary|unknown option|unrecognized option|unrecognised option|invalid option|illegal option|cannot read file system information|onbekend predicaat|onbekende optie|ongeldige optie|niet-herkende optie/i;

const fout = (reden) => Object.assign(new Error(reden), { kort: true });
const reden = (err) => (err?.kort ? err.message : schoon(String(err?.message || err || 'onbekend')).slice(0, 120));

/**
 * Eén commando, alleen lezen. Lost op met stdout; `codes` zijn exitcodes die ook
 * goed zijn (find: 1 = een map niet leesbaar maar de rest wel; lsof/pgrep: 1 =
 * niets gevonden). Een fout zegt alleen wat er misging, nooit de opdrachtregel
 * (die bevat paden): "time-out", "<naam> niet gevonden", "bestaat niet",
 * "<naam> gaf code 2". Bij de time-out wordt het kind gedood (SIGKILL).
 */
export function voerUit(cmd, args = [], { timeout = 1000, codes = [0], env = null } = {}) {
  const naam = basename(cmd);
  return new Promise((klaar, mis) => {
    try {
      const opties = { timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) };
      execFile(cmd, args, opties, (err, stdout, stderr) => {
        if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return mis(fout(`${naam}: te veel uitvoer`));
        if (err && (err.killed || err.signal === 'SIGKILL')) return mis(fout('time-out'));
        if (err?.code === 'ENOENT') return mis(fout(`${naam} niet gevonden`));
        // Vóór `codes` en vóór "bestaat niet": een optie die het commando niet kent is geen
        // "map niet leesbaar" en geen "niets gevonden" (GNU stat -f meldt er ook "No such file" bij).
        if (ONBEKENDE_OPTIE.test(stderr || '')) return mis(fout(`${naam}: optie onbekend op dit platform`));
        if (!err) return klaar(stdout);
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
const DARWIN = {
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

  async tailscale({ exec, t, plekken = TAILSCALE }) {
    let laatste;
    for (const cmd of plekken) {
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

/** Een sonde die op dit platform niets te meten heeft: grijs met de reden, nooit groen of rood. */
const niet = (waarom) => async () => { throw fout(waarom); };
export const NIET_HIER = 'niet op dit platform';
export const NIET_HIER_MIXER = 'niet op dit platform (de live-mixer draait op de Mac)';

/**
 * Linux (de Omarchy-pc: beeld, ontwikkelen, testen; de live-mixer draait er niet).
 * - bestanden: GNU `stat -c '%s %n'` (BSD `-f '%z %N'` betekent daar "bestandssysteem");
 *   de iCloud-vlag `dataless` bestaat niet: `datalessNvt`.
 * - instellingen en icloud: alleen de Mac kent uitgeplaatste bestanden en "Optimaliseer
 *   opslag"; hier niet te meten, dus grijs (nooit "lokaal").
 * - accu: /sys/class/power_supply, via `find … -exec grep` in een kindproces (zoals elke
 *   sonde: geen fs in het serverproces). Geen accu (vaste pc) = grijs.
 * - usb: `lsusb` en /sys/bus/usb/devices samen (de vendor:product-id's uit profielen.json
 *   werken op beide). Allebei weg = grijs.
 * - audio, bluetooth: grijs; de geluidsuitgang telt alleen op de Mac.
 * - schijf (df -k), servers (lsof, pgrep), avhub (een TCP-poort) en tailscale: zoals op de Mac.
 */
const LINUX = {
  ...DARWIN,
  async bestanden({ exec, paden, t }) {
    if (!paden.media) throw fout('geen mediamap');
    let stat;
    try {
      stat = await exec('find', ['-H', paden.media, '-type', 'f', '-exec', 'stat', '-c', '%s %n', '{}', '+'], { timeout: t, codes: [0, 1], env: C, sleutel: 'find-stat' });
    } catch (err) {
      if (err?.message === 'bestaat niet') return { bestaat: false };
      throw err;
    }
    return { ...parseBestanden(stat, '', paden.media), bestaat: true, datalessNvt: true };
  },
  instellingen: niet(NIET_HIER),
  icloud: niet(NIET_HIER),
  async schijf({ exec, paden, t }) {
    const d = parseDf(await exec('df', ['-k', paden.media || paden.wortel || '/'], { timeout: t, codes: [0, 1], env: C, sleutel: 'df' }));
    if (!d) throw fout('onleesbaar');
    return d;
  },
  async accu({ exec, t }) {
    const uit = await exec('find', ['-L', '/sys/class/power_supply', '-mindepth', '2', '-maxdepth', '2', '-name', 'uevent', '-type', 'f', '-exec', 'grep', '-H', '', '{}', '+'],
      { timeout: t, codes: [0, 1], env: C, sleutel: 'power-supply' })
      .catch((err) => { throw err?.message === 'bestaat niet' ? fout('geen voeding in sysfs') : err; });
    const a = parsePowerSupply(uit);
    if (!a) throw fout('geen accu (vaste pc?)');
    if (!Number.isFinite(a.procent)) throw fout('onleesbaar');
    return a;
  },
  audio: niet(NIET_HIER_MIXER),
  bluetooth: niet(NIET_HIER_MIXER),
  async usb({ exec, t }) {
    const [ls, sys] = await Promise.allSettled([
      exec('lsusb', [], { timeout: t, env: C, sleutel: 'lsusb' }),
      exec('find', ['-L', '/sys/bus/usb/devices', '-mindepth', '2', '-maxdepth', '2', '-type', 'f', '(', '-name', 'idVendor', '-o', '-name', 'idProduct',
        '-o', '-name', 'product', '-o', '-name', 'manufacturer', ')', '-exec', 'grep', '-H', '', '{}', '+'], { timeout: t, codes: [0, 1], env: C, sleutel: 'sys-usb' }),
    ]);
    if (ls.status !== 'fulfilled' && sys.status !== 'fulfilled') {
      const zonderLsusb = /niet gevonden$/.test(ls.reason?.message || '');
      if (zonderLsusb && sys.reason?.message === 'bestaat niet') throw fout('geen lsusb en geen USB in sysfs');
      throw zonderLsusb ? sys.reason : ls.reason;
    }
    return voegUsbSamen(ls.status === 'fulfilled' ? parseLsusb(ls.value) : [], sys.status === 'fulfilled' ? parseSysUsb(sys.value) : []);
  },
  async tailscale(o) { return DARWIN.tailscale({ ...o, plekken: TAILSCALE_LINUX }); },
};

/** Elk ander platform: alleen de AV-hub (een TCP-poort); de rest grijs. */
const ANDERS = Object.fromEntries(SONDES.map((id) => [id, id === 'avhub' ? DARWIN.avhub : niet(NIET_HIER)]));

/** De sondes van een platform (process.platform-namen): darwin, linux, of de rest. */
export function metersVoor(platform) {
  return platform === 'darwin' ? DARWIN : platform === 'linux' ? LINUX : ANDERS;
}

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
 * @param {string} [o.platform]          process.platform (standaard); de tests kiezen 'darwin' of 'linux'
 * @returns {Promise<object>} per sonde het object of { onbekend }
 */
export async function meet({ exec = voerUit, verbind = poortOpen, paden = {}, timeouts = {}, alleen = null, vorige = null, waarom = 'er speelt een deck', platform = process.platform } = {}) {
  const t = { ...STANDAARD_TIMEOUTS, ...timeouts };
  const METERS = metersVoor(platform);
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
 * `auto` (review 2, fix 4): binnen `ttlMs` de laatste, anders alleen de goedkope
 * sondes; nooit een volledige meting.
 * Elke stand draagt `volledigT`: wanneer de dure sondes voor het laatst echt
 * gemeten zijn (null = nog nooit).
 * @returns {{ metingen({ vers, auto }): Promise<{ metingen, t, duurMs, goedkoop, volledigT, bevroren? }>, laatste }}
 */
export function maakCache({ meet: meter, ttlMs = 10000, versMs = 2000, speeltDeck = () => false, klok = Date.now } = {}) {
  let laatste = null;
  let lopend = null;
  const draai = (opties = {}) => {
    if (lopend) return lopend;
    const t0 = klok();
    const goedkoop = !!opties.alleen;
    const volledigT = goedkoop ? (laatste?.volledigT ?? null) : t0;
    lopend = Promise.resolve().then(() => meter(opties))
      .then((metingen) => (laatste = { metingen, t: t0, duurMs: Math.max(0, klok() - t0), goedkoop, volledigT }))
      .finally(() => { lopend = null; });
    return lopend;
  };
  const BEVROREN = 'er speelt een deck';
  return {
    async metingen({ vers = false, auto = false } = {}) {
      if (speeltDeck()) {
        const recent = laatste && klok() - laatste.t < versMs;
        if (!vers || recent) return laatste ? { ...laatste, bevroren: BEVROREN } : { metingen: {}, t: klok(), duurMs: 0, goedkoop: false, volledigT: null, bevroren: BEVROREN };
        if (lopend) return { ...(await lopend), bevroren: BEVROREN };
        return { ...(await draai({ alleen: GOEDKOOP, vorige: laatste?.metingen ?? null })), bevroren: BEVROREN };
      }
      if (lopend) return lopend;
      if (auto && !vers) {
        if (laatste && klok() - laatste.t < ttlMs) return laatste;
        return draai({ alleen: GOEDKOOP, vorige: laatste?.metingen ?? null, waarom: 'automatisch, klik om te meten' });
      }
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
 * server), "server": { bereikbaar, nummers }, "paden": { media, wortel } (de
 * paden waar de find-fixtures onder staan) en "platform" ('darwin' | 'linux': de
 * sondes van welk platform; zonder: process.platform). Een sleutel die ontbreekt: de sonde
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
  // "platform": van welk platform de fixtures zijn (darwin, linux); de sondes van dat platform lezen ze.
  return { exec, verbind, cfg, geteld, paden: cfg.paden || null, backups: Array.isArray(cfg.backups) ? cfg.backups : null, server: cfg.server ?? null,
    platform: typeof cfg.platform === 'string' ? cfg.platform : null };
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
  // vannachtUit: de knop "vandaag niet" (nacht.stand().vandaagNiet); Nacht.magNu weigert dan net zo goed.
  const tel = (l, s) => (Array.isArray(l) ? l.filter((o) => o?.status === s).length : 0);
  const vandaag = datum(nu);
  const nachtDag = nu.getHours() < 12 ? datum(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() - 1)) : vandaag;
  const dagen = Array.isArray(nacht?.speeldagen) ? nacht.speeldagen : [];
  return {
    ingestBezig: tel(ingest, 'bezig') > 0 || !!nacht?.bezig, ingestWacht: tel(ingest, 'wacht'),
    stemsBezig: tel(stems, 'bezig') > 0, stemsWacht: tel(stems, 'wacht'),
    nachtAan: !!nacht?.aan, vandaagSpeeldag: dagen.includes(vandaag) || dagen.includes(nachtDag), vannachtUit: !!nacht?.vandaagNiet,
    speelt: !!speelt,
  };
}

/**
 * De speellijst van de Controlekamer als info (ontwerp §2.7, W15: niet in het oordeel):
 * hoeveel punten gedaan (alles behalve open), hoeveel fout, van hoeveel. Zoals
 * tekenVoortgang in controle.js: alleen ids die nog in de lijst staan.
 */
export function speellijstStand(sessie, punten = allePunten()) {
  const items = sessie?.items && typeof sessie.items === 'object' ? sessie.items : {};
  const ids = punten.map((p) => p.id);
  const st = (id) => (Object.hasOwn(items, id) ? items[id]?.status : undefined);
  return { gedaan: ids.filter((id) => st(id) && st(id) !== 'open').length, fout: ids.filter((id) => st(id) === 'fout').length, totaal: ids.length };
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
 * @param {() => Promise<object>} [o.speellijst]  proef.lees(): de sessie van de speellijst (alleen info)
 * @param {() => boolean} [o.speeltDeck]
 * @param {string} [o.nep]                     VARVE_AVONDPAKKET_NEP
 * @param {string} [o.platform]                standaard het platform van de nep-fixtures, anders process.platform
 */
export function maakAvondpakket({ paden, profielenPad, backupStand = null, rijen = null, library = null, speellijst = null, speeltDeck = () => false, nep = null, timeouts = {}, ttlMs, klok = Date.now, leesMs = LEES_MS, platform = null }) {
  const n = nep ? maakNep(nep) : null;
  const meetPaden = n?.paden ? { ...paden, ...n.paden } : paden;
  const plat = platform ?? n?.platform ?? process.platform;
  const cache = maakCache({
    meet: (opties) => meet({ exec: n ? n.exec : voerUit, verbind: n ? n.verbind : poortOpen, paden: meetPaden, timeouts, platform: plat, ...opties }),
    speeltDeck, klok, ...(ttlMs ? { ttlMs } : {}),
  });
  // Alleen de verwachte paden per nummer, niet de hele rij (review 2, fix 16).
  let lib = { sleutel: null, paden: null };
  let compleetLaatst = null;
  // profielen.json met een grens: uitgeplaatst en offline zou readFile blijven hangen (review 2, fix 5).
  // Een lezing die nog loopt, wordt hergebruikt: niet bij elk verzoek een nieuwe die blijft hangen.
  let lezing = null;
  const leesData = async () => {
    if (!lezing) lezing = readFile(profielenPad, 'utf8').then((t) => t, () => null).finally(() => { lezing = null; });
    try {
      const tekst = await metGrens(lezing, leesMs);
      return tekst === null ? { ...leesProfielen(''), fout: 'niet gevonden' } : leesProfielen(tekst);
    } catch { return { ...leesProfielen(''), fout: 'time-out (in iCloud?)' }; }
  };
  return {
    cache,
    async rapport({ profiel = null, fase = null, vers = false, auto = false } = {}) {
      const data = await leesData();
      const m = await cache.metingen({ vers, auto });
      const deels = m.goedkoop && !m.bevroren;
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
        // Automatisch (alleen het goedkope): media is niet opnieuw gemeten, dus het oordeel van de laatste volledige meting.
        else if (deels) metingen.compleet = compleetLaatst ?? { onbekend: 'automatisch, klik om te meten' };
        else if (!metingen.bestanden || 'onbekend' in metingen.bestanden || metingen.bestanden.bestaat === false) metingen.compleet = { onbekend: 'media niet gemeten' };
        else {
          const l = library();
          if (l.sleutel !== lib.sleutel || !lib.paden) lib = { sleutel: l.sleutel, paden: verwachtePaden(l.tracks(), meetPaden.media) };
          compleetLaatst = vergelijkCompleet(lib.paden, metingen.bestanden, meetPaden.media);
          metingen.compleet = compleetLaatst;
        }
      } catch (err) { metingen.compleet = { onbekend: reden(err) }; }
      // De speellijst: alleen info (W15), nooit in het oordeel; een fout laat hem weg uit het rapport.
      if (speellijst) {
        try { metingen.speellijst = speellijstStand(await metGrens(Promise.resolve().then(speellijst), leesMs)); } catch { /* geen info */ }
      }
      const fasekeuze = fase === 'vertrek' || fase === 'aankomst' ? fase : null;
      const rapport = beoordeel(metingen, { profiel, fase: fasekeuze, data, nu: new Date(m.t) });
      rapport.duurMs = m.duurMs;
      if (m.bevroren) rapport.bevroren = m.bevroren;
      // Automatisch en alleen het goedkope: zeg het, met de tijd van de laatste volledige meting.
      if (deels) rapport.deels = { volledig: Number.isFinite(m.volledigT) ? m.volledigT : null };
      return rapport;
    },
  };
}

/** Paden buiten de projectmap die toch instellingen zijn (VARVE_PLANNEN e.d.) plus het kaartbestand. */
export function extraPaden({ wortel, env = process.env, kaart = null }) {
  const w = String(wortel || '').replace(/\/+$/, '');
  const uit = [];
  for (const k of ['VARVE_PLANNEN', 'VARVE_PATRONEN', 'VARVE_PROEF', 'VARVE_STANDEN']) {
    const p = env[k];
    if (!p) continue;
    const rel = relative(w, p);
    if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep)[0] === '..') uit.push({ map: p, groep: 'instellingen' });
  }
  const kp = kaart || env.VARVE_KAART || KAART_STANDAARD;
  if (kp) uit.push({ map: kp, groep: 'instellingen' });
  return uit;
}
