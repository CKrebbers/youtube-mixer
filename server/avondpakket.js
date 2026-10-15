import { wanneer } from '../src/controle/backup-tegel.js';

/**
 * Het avondpakket (docs/AVONDPAKKET.md): één alleen-lezen controle die op twee
 * momenten dezelfde vraag beantwoordt, "kan ik met deze tas vertrekken" en
 * "kan ik hier beginnen".
 *
 * Dit bestand is het PURE deel: parsers voor de uitvoer van pmset, ioreg, df,
 * defaults, system_profiler, tailscale en find (op Linux: GNU stat, lsusb en
 * sysfs), de profielen als data (avondpakket/profielen.json), de keuze van de fase en het oordeel. Geen I/O,
 * geen kindprocessen, geen klok: `nu` komt van buiten. De sondes (meet), de
 * cache en de bevriezing staan in server/avondpakket-meet.js; de route in
 * server/index.js, de CLI in tools/avondpakket.mjs. Die voeren alleen de
 * commando's uit; wat ze opleveren gaat hier doorheen.
 *
 * Een meting is per sonde het geparste object, of { onbekend: '<reden>' }:
 * dat punt wordt altijd grijs, nooit rood.
 *
 * Lichten zoals de andere tegels: 'ok' (groen), 'half' (oranje), 'fout'
 * (rood), 'uit' (grijs: info, paklijst, niet gemeten, of bewust "bekend").
 *
 * Privacy: het rapport bevat geen absolute paden (alleen <id>/<bestand>),
 * geen backupnamen (alleen tijden), geen IP-adressen en geen omgevingsvariabelen.
 */

export const FASEN = ['auto', 'vertrek', 'aankomst'];
export const WAARDEN = ['verwacht', 'optioneel', 'nee'];
export const LICHTEN = ['ok', 'half', 'fout', 'uit'];

export const STANDAARD_GRENZEN = Object.freeze({
  schijfRoodGiB: 20, schijfOranjeGiB: 50, accuRoodProcent: 20, accuVertrekProcent: 80, laderMinW: 30,
});
const STANDAARD_VIRTUEEL = 'blackhole|soundflower|loopback';

/**
 * Mappen in de projectwortel waarvan een uitgeplaatst bestand onderweg een dode set betekent.
 * Ook `avondpakket/`: profielen.json is Clay's eigen instelling, en de route leest hem bij
 * elk verzoek (review 2, fix 5). Ook `standen/` (spoor standen, docs/STANDEN.md): Clay's
 * eigen opstellingen; een uitgeplaatste stand laat de server na 2 s 503 geven, dus de
 * controle vóór vertrek moet hem zien (integratie 11 okt, verzoek van spoor standen).
 */
export const INSTELLINGEN_MAPPEN = ['mappings', 'racks', 'patronen', 'plannen', 'Input', 'proef', 'avondpakket', 'standen'];
/** Bestanden bovenin media/ die niet zonder kunnen. */
const KERN_DB = /^(library|kaart)\.db(-wal|-shm)?$/;

const GIB = 1024 ** 3;
const tekst = (t) => (typeof t === 'string' ? t : t == null ? '' : String(t));
const rond1 = (x) => Math.round(x * 10) / 10;
const komma = (x) => String(x).replace('.', ',');

function jsonVan(j) {
  if (j && typeof j === 'object') return j;
  try { return JSON.parse(tekst(j)); } catch { return null; }
}

/**
 * Privacy (review F5): wat er uit een foutmelding of een commando in het rapport
 * komt. Een absoluut pad wordt alleen de laatste naam (onder een map "media":
 * <id>/<bestand>), de naam van een backup wordt "de kopie", een IPv4-adres "<ip>".
 * Elk punt gaat hier doorheen (`punt()` in beoordeel), dus ook een fout van
 * backup.js of een kindproces die het meetdeel niet al opschoonde.
 */
export function schoon(t) {
  const kort = (pad) => {
    const i = pad.lastIndexOf('/media/');
    return i >= 0 ? pad.slice(i + '/media/'.length) : pad.replace(/\/+$/, '').split('/').pop();
  };
  return tekst(t)
    .replace(/'(\/[^'\n]*)'/g, (_, pad) => `'${kort(pad)}'`)
    .replace(/(^|[\s"`(=])((?:\/[^\s'"`/,;:()]+)+\/?)/g, (_, voor, pad) => voor + kort(pad))
    .replace(/library-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?\.db/g, 'de kopie')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>');
}

/** Een regex uit de data; een ongeldige geeft null (nooit een throw). */
function regex(bron) {
  if (typeof bron !== 'string' || !bron) return null;
  try { return new RegExp(bron, 'i'); } catch { return null; }
}

/**
 * Een USB-id als "0x09e8" (vier hex-cijfers, klein). Een GETAL is decimaal (ioreg:
 * idVendor = 2536); een TEKST is altijd hex, met of zonder 0x ("0x09e8",
 * "09e8", "0x1235  (Focusrite)", en "0029" uit profielen.json). Anders null.
 */
export function hexId(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 0xffff ? '0x' + v.toString(16).padStart(4, '0') : null;
  const m = /^(?:0x)?([0-9a-f]{1,4})\b/i.exec(tekst(v).trim());
  return m ? '0x' + m[1].toLowerCase().padStart(4, '0') : null;
}

// ---- parsers --------------------------------------------------------------

/**
 * `pmset -g batt`. De bron komt uit de EERSTE regel ("Now drawing from 'AC Power'"),
 * niet uit de toestand: "AC attached; not charging" bij 80 % is gewoon aan de lader.
 * @returns {{ bron: 'AC'|'accu'|null, procent: number|null, toestand: string|null, resterend: string|null }|null}
 */
export function parsePmset(t) {
  const s = tekst(t);
  const bronM = /drawing from '([^']+)'/i.exec(s);
  const bron = !bronM ? null : /AC Power/i.test(bronM[1]) ? 'AC' : /Battery Power/i.test(bronM[1]) ? 'accu' : null;
  const regel = s.split('\n').find((r) => /\d+%;/.test(r));
  if (!bronM && !regel) return null;
  let procent = null, toestand = null, resterend = null;
  if (regel) {
    procent = Number(/(\d+)%;/.exec(regel)[1]);
    const delen = regel.slice(regel.indexOf('%;') + 2).split(';').map((d) => d.replace(/present:.*$/, '').trim()).filter(Boolean);
    toestand = /not charging/i.test(regel) ? 'not charging' : (delen[0] ?? null);
    const r = /(\d+:\d{2}) remaining/.exec(regel);
    resterend = r ? r[1] : null;
  }
  return { bron, procent, toestand, resterend };
}

/** `pmset -g ac`: "Wattage = 8W" → { laderW: 8 }; "No adapter attached." → { laderW: null }. */
export function parsePmsetAc(t) {
  const s = tekst(t);
  if (/No adapter/i.test(s)) return { laderW: null };
  const m = /Wattage\s*=\s*(\d+)\s*W/i.exec(s);
  return m ? { laderW: Number(m[1]) } : null;
}

/**
 * `ioreg -rn AppleSmartBattery`: cycli en gezondheid = FullChargeCapacity / DesignCapacity.
 * MaxCapacity (altijd 100 op Apple silicon) wordt genegeerd. De sleutels staan los
 * ("CycleCount" = 591) of in BatteryData ({"FullChargeCapacity"=3413,…}).
 */
export function parseIoregAccu(t) {
  const s = tekst(t);
  const getal = (sleutel) => { const m = new RegExp(`"${sleutel}"\\s*=\\s*(\\d+)`).exec(s); return m ? Number(m[1]) : null; };
  const cycli = getal('CycleCount');
  const vol = getal('FullChargeCapacity'), ontwerp = getal('DesignCapacity');
  const gezondheid = vol && ontwerp ? Math.round((vol / ontwerp) * 100) : null;
  if (cycli === null && gezondheid === null) return null;
  return { cycli, gezondheid };
}

/** `df -k <map>`: de laatste regel → { vrijGiB, totaalGiB } (één decimaal). */
export function parseDf(t) {
  const regels = tekst(t).trim().split('\n').filter((r) => r.trim());
  for (let i = regels.length - 1; i >= 0; i--) {
    const m = /\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%/.exec(regels[i]);
    if (m) return { totaalGiB: rond1((Number(m[1]) * 1024) / GIB), vrijGiB: rond1((Number(m[3]) * 1024) / GIB) };
  }
  return null;
}

/** `defaults read com.apple.bird optimize-storage`: "1" → true, "0" → false, al het andere → null. */
export function parseOptimize(t) {
  const s = tekst(t).trim();
  return s === '1' ? true : s === '0' ? false : null;
}

/**
 * `system_profiler SPAudioDataType -json` → per ITEM (niet per naam: de AirPods staan er
 * twee keer in, als invoer en als uitvoer):
 * { naam, transport, uit, in, standaardUit, standaardSysteem }.
 * transport = de staart van coreaudio_device_type_… (builtin, usb, bluetooth, virtual,
 * unknown; aggregate is een aanname tot de hardware-uitvoer gezien is).
 * standaardUit is wat Chrome gebruikt; standaardSysteem is voor meldingen.
 */
export function parseAudio(json) {
  const j = jsonVan(json);
  if (!j || !Array.isArray(j.SPAudioDataType)) return null;
  const uit = [];
  for (const groep of j.SPAudioDataType) {
    for (const i of Array.isArray(groep?._items) ? groep._items : []) {
      if (!i || typeof i !== 'object') continue;
      uit.push({
        naam: tekst(i._name),
        transport: tekst(i.coreaudio_device_transport).replace(/^coreaudio_device_type_/, '') || 'unknown',
        uit: Number(i.coreaudio_device_output) || 0,
        in: Number(i.coreaudio_device_input) || 0,
        standaardUit: i.coreaudio_default_audio_output_device === 'spaudio_yes',
        standaardSysteem: i.coreaudio_default_audio_system_device === 'spaudio_yes',
      });
    }
  }
  return uit;
}

const AUDIO_SOORT = /headphones|headset|speaker|audio|earbud|hifi|loudspeaker/i;

/** `system_profiler SPBluetoothDataType -json` → { aan, verbonden: [naam], audio: [naam] }. */
export function parseBluetooth(json) {
  const j = jsonVan(json);
  const b = j && Array.isArray(j.SPBluetoothDataType) ? j.SPBluetoothDataType[0] : null;
  if (!b || typeof b !== 'object') return null;
  const staat = tekst(b.controller_properties?.controller_state);
  const verbonden = [], audio = [];
  for (const o of Array.isArray(b.device_connected) ? b.device_connected : []) {
    for (const [naam, v] of Object.entries(o || {})) {
      verbonden.push(naam);
      if (AUDIO_SOORT.test(tekst(v?.device_minorType))) audio.push(naam);
    }
  }
  return { aan: /on/i.test(staat) && !/off/i.test(staat), verbonden, audio };
}

/**
 * `system_profiler SPUSBHostDataType -json` → [{ naam, vid, pid }]. De bovenste laag zijn
 * de bussen ("USB 3.1 Bus"); apparaten zitten (genest) in `_items`. Vendor en product
 * uit elke sleutel die op /vendor.?id/ of /product.?id/ past: welke sleutels een
 * aangesloten apparaat hier echt heeft, is nog niet gezien (stap 7a).
 */
export function parseUsbHost(json) {
  const j = jsonVan(json);
  if (!j || !Array.isArray(j.SPUSBHostDataType)) return [];
  const uit = [];
  const loop = (lijst) => {
    for (const o of Array.isArray(lijst) ? lijst : []) {
      if (!o || typeof o !== 'object') continue;
      let vid = null, pid = null;
      for (const [k, v] of Object.entries(o)) {
        if (vid === null && /vendor.?id/i.test(k)) vid = hexId(v);
        if (pid === null && /product.?id/i.test(k)) pid = hexId(v);
      }
      uit.push({ naam: tekst(o._name), vid, pid });
      loop(o._items);
    }
  };
  for (const bus of j.SPUSBHostDataType) loop(bus?._items);
  return uit;
}

/** `ioreg -p IOUSB -w0 -r -c IOUSBHostDevice -l` → [{ naam, vid, pid }] (idVendor/idProduct decimaal). */
export function parseIoregUsb(t) {
  const uit = [];
  let nu = null;
  for (const regel of tekst(t).split('\n')) {
    const kop = /\+-o (.+?)@[0-9a-f]+\s+<class/i.exec(regel);
    if (kop) { nu = { naam: kop[1].trim(), vid: null, pid: null }; uit.push(nu); continue; }
    if (!nu) continue;
    const m = /"([^"]+)"\s*=\s*(.+)$/.exec(regel.trim());
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'USB Product Name' || k === 'kUSBProductString') nu.naam = v.replace(/^"|"$/g, '');
    else if (k === 'idVendor') nu.vid = hexId(Number(v));
    else if (k === 'idProduct') nu.pid = hexId(Number(v));
  }
  return uit;
}

// ---- Linux (de Omarchy-pc; docs/AVONDPAKKET.md "Op Linux") ----------------------

/** Root hubs van de kernel (vendor 1d6b, "Linux Foundation"): geen apparaat. */
const ROOT_HUB = '0x1d6b';

/**
 * `lsusb` (usbutils): "Bus 003 Device 005: ID 1235:8210 Focusrite-Novation Scarlett 2i2 3rd Gen"
 * → [{ naam, vid, pid }]. De naam komt uit usb.ids en kan ontbreken ("ID 09e8:0029" en verder
 * niets): dan herkent de USB-id hem nog. Root hubs tellen niet.
 */
export function parseLsusb(t) {
  const uit = [];
  for (const regel of tekst(t).split('\n')) {
    const m = /^Bus\s+\d+\s+Device\s+\d+:\s+ID\s+([0-9a-f]{4}):([0-9a-f]{4})\s*(.*)$/i.exec(regel.trim());
    if (!m) continue;
    const vid = hexId(m[1]), pid = hexId(m[2]);
    if (vid === ROOT_HUB) continue;
    uit.push({ naam: m[3].trim(), vid, pid });
  }
  return uit;
}

/**
 * sysfs zonder lsusb: `find -L /sys/bus/usb/devices -mindepth 2 -maxdepth 2 -type f ( -name idVendor
 * -o -name idProduct -o -name product -o -name manufacturer ) -exec grep -H '' {} +` → regels
 * "<map>/<veld>:<waarde>" → [{ naam, vid, pid }] (naam = product, anders manufacturer). Alleen
 * mappen met een idVendor; root hubs (1d6b) niet. Het pad zelf komt nooit in het resultaat.
 */
export function parseSysUsb(t) {
  const per = new Map();
  for (const regel of tekst(t).split('\n')) {
    const m = /^(.*)\/(idVendor|idProduct|product|manufacturer):(.*)$/.exec(regel.trim());
    if (!m) continue;
    if (!per.has(m[1])) per.set(m[1], {});
    per.get(m[1])[m[2]] = m[3].trim();
  }
  const uit = [];
  for (const v of per.values()) {
    const vid = hexId(v.idVendor), pid = hexId(v.idProduct);
    if (!vid || vid === ROOT_HUB) continue;
    uit.push({ naam: v.product || v.manufacturer || '', vid, pid });
  }
  return uit;
}

const STATUS_LINUX = { charging: 'charging', discharging: 'discharging', full: 'charged', 'not charging': 'not charging' };

/**
 * sysfs: `find -L /sys/class/power_supply -mindepth 2 -maxdepth 2 -name uevent -type f -exec grep -H '' {} +`
 * → regels "<map>/uevent:POWER_SUPPLY_<VELD>=<waarde>" → hetzelfde object als de Mac
 * ({ bron, procent, toestand, resterend, laderW, gezondheid, cycli }), of null zonder
 * accu van het systeem (een vaste pc). Een accu met SCOPE=Device (muis, koptelefoon) telt
 * niet. bron: een Mains/USB-voeding met ONLINE=1 = 'AC'; is er een voeding en geen online,
 * 'accu'; zonder voedingsknoop uit de STATUS van de accu. laderW alleen uit een USB-PD-bron
 * met VOLTAGE_MAX × CURRENT_MAX (µV × µA; een AANNAME tot het op de pc gezien is); een
 * Mains-adapter zegt geen vermogen (null). Gezondheid = (ENERGY|CHARGE)_FULL / _FULL_DESIGN.
 * CYCLE_COUNT 0 is vaak "niet ondersteund": dan null. Meerdere accu's: naar energie gewogen.
 */
export function parsePowerSupply(t) {
  const per = new Map();
  for (const regel of tekst(t).split('\n')) {
    const m = /^(.*)\/uevent:POWER_SUPPLY_([A-Z0-9_]+)=(.*)$/.exec(regel.trim());
    if (!m) continue;
    if (!per.has(m[1])) per.set(m[1], {});
    per.get(m[1])[m[2]] = m[3].trim();
  }
  const getal = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const vanSysteem = (v) => (v.SCOPE || 'System').toLowerCase() !== 'device';
  const alle = [...per.values()].filter(vanSysteem);
  const accus = alle.filter((v) => /^battery$/i.test(v.TYPE || '') && v.PRESENT !== '0');
  if (!accus.length) return null;
  const voedingen = alle.filter((v) => v.TYPE && !/^battery$/i.test(v.TYPE));
  const online = voedingen.filter((v) => v.ONLINE === '1');
  const status = (accus[0].STATUS || '').toLowerCase();
  const bron = online.length ? 'AC' : voedingen.length ? 'accu'
    : status === 'discharging' ? 'accu' : ['charging', 'full', 'not charging'].includes(status) ? 'AC' : null;
  const vol = (v) => getal(v.ENERGY_FULL) ?? getal(v.CHARGE_FULL);
  const ontwerp = (v) => getal(v.ENERGY_FULL_DESIGN) ?? getal(v.CHARGE_FULL_DESIGN);
  const nu = (v) => getal(v.ENERGY_NOW) ?? getal(v.CHARGE_NOW);
  let procent = null;
  if (accus.length > 1 && accus.every((v) => nu(v) !== null && vol(v))) {
    procent = Math.round((accus.reduce((s, v) => s + nu(v), 0) / accus.reduce((s, v) => s + vol(v), 0)) * 100);
  } else {
    const c = accus.map((v) => getal(v.CAPACITY)).filter((x) => x !== null);
    procent = c.length ? Math.round(c.reduce((s, x) => s + x, 0) / c.length) : null;
  }
  const v0 = vol(accus[0]), o0 = ontwerp(accus[0]);
  const gezondheid = v0 && o0 ? Math.round((v0 / o0) * 100) : null;
  const cycli = getal(accus[0].CYCLE_COUNT) || null;
  const pd = online.map((v) => (getal(v.VOLTAGE_MAX) ?? 0) * (getal(v.CURRENT_MAX) ?? 0) / 1e12).filter((w) => w > 0);
  const laderW = pd.length ? Math.round(Math.max(...pd)) : null;
  return { bron, procent, toestand: STATUS_LINUX[status] ?? (status || null), resterend: null, laderW, gezondheid, cycli };
}

/** Twee (of meer) USB-lijsten samen; een apparaat dat in beide staat, telt één keer. */
export function voegUsbSamen(...lijsten) {
  const gezien = new Map();
  for (const l of lijsten) {
    for (const a of Array.isArray(l) ? l : []) {
      const sleutel = a.vid && a.pid ? `${a.vid}:${a.pid}` : `naam:${tekst(a.naam).toLowerCase()}`;
      if (!gezien.has(sleutel)) gezien.set(sleutel, { ...a });
    }
  }
  return [...gezien.values()];
}

/**
 * Welke apparaten uit de data hangen eraan? `apparaten` komt uit profielen.json
 * ({ id: { naam: '<regex>', usb: ['vid:pid'] } }): een nieuwe controller of
 * geluidskaart is een regel data, geen code.
 * @returns {{ [id: string]: boolean }}
 */
export function herkenUsb(lijst, apparaten = {}) {
  const uit = {};
  const l = Array.isArray(lijst) ? lijst : [];
  for (const [id, a] of Object.entries(apparaten || {})) {
    const re = regex(a?.naam);
    const ids = (Array.isArray(a?.usb) ? a.usb : []).map((u) => {
      const [v, p] = tekst(u).split(':');
      return `${hexId(v)}:${hexId(p)}`;
    });
    uit[id] = l.some((x) => (re && re.test(tekst(x.naam))) || (x.vid && x.pid && ids.includes(`${x.vid}:${x.pid}`)));
  }
  return uit;
}

/** `tailscale status --json` → { backend, naam, peers: [{ naam, online, direct, relay }] }. Geen IP's. */
export function parseTailscale(json) {
  const j = jsonVan(json);
  if (!j || typeof j !== 'object' || typeof j.BackendState !== 'string') return null;
  const peers = Object.values(j.Peer || {}).map((p) => ({
    naam: tekst(p?.HostName), online: !!p?.Online, direct: !!p?.CurAddr, relay: tekst(p?.Relay) || null,
  }));
  return { backend: j.BackendState, naam: tekst(j.Self?.HostName) || null, peers };
}

/** Een absoluut pad relatief maken aan een map; erbuiten: alleen de bestandsnaam (nooit /Users/…). */
function relatief(pad, map) {
  const p = tekst(pad).trim();
  const m = tekst(map).replace(/\/+$/, '');
  if (m && p.startsWith(m + '/')) return p.slice(m.length + 1);
  return p.split('/').pop();
}

/**
 * De mediamap uit twee find-uitvoeren:
 * - `find <MEDIA> -type f -exec stat -f '%z %N' {} +` → regels "<bytes> <pad>";
 * - `find <MEDIA> -type f -flags +dataless` → regels "<pad>" (uitgeplaatst naar iCloud;
 *   leest geen byte en haalt niets binnen).
 * @returns {{ totaal, bytesTotaal, dataless: [{ pad, bytes }], paden: Set<string>, bytes: Map<string, number> }}
 */
export function parseBestanden(statTekst, datalessTekst, mediaMap) {
  const paden = new Set(), bytes = new Map();
  let bytesTotaal = 0;
  for (const regel of tekst(statTekst).split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(regel);
    if (!m) continue;
    const rel = relatief(m[2], mediaMap);
    paden.add(rel);
    bytes.set(rel, Number(m[1]));
    bytesTotaal += Number(m[1]);
  }
  const dataless = tekst(datalessTekst).split('\n').map((r) => r.trim()).filter(Boolean)
    .map((r) => { const pad = relatief(r, mediaMap); return { pad, bytes: bytes.get(pad) ?? null }; });
  return { totaal: paden.size, bytesTotaal, dataless, paden, bytes };
}

/**
 * Uitgeplaatste bestanden buiten media/: `find <WORTEL> … -flags +dataless -print`.
 * Groep: 'instellingen' (mappings/, racks/, patronen/, plannen/, Input/, proef/),
 * 'media' (media/, telt bij het punt media) of 'code' (de rest).
 * `extra`: mappen (VARVE_*) of losse bestanden (het kaartbestand) buiten de
 * wortel, als [{ map, groep }]; een los bestand houdt alleen zijn naam.
 */
export function parseInstellingen(t, wortel, extra = []) {
  const uit = [];
  for (const r of tekst(t).split('\n').map((x) => x.trim()).filter(Boolean)) {
    const buiten = (Array.isArray(extra) ? extra : []).find((e) => e?.map && (r === tekst(e.map) || r.startsWith(tekst(e.map).replace(/\/+$/, '') + '/')));
    if (buiten && r === tekst(buiten.map)) { uit.push({ pad: r.split('/').pop(), groep: buiten.groep || 'instellingen' }); continue; }
    if (buiten) { uit.push({ pad: `${tekst(buiten.map).split('/').pop()}/${relatief(r, buiten.map)}`, groep: buiten.groep || 'instellingen' }); continue; }
    const pad = relatief(r, wortel);
    const eerste = pad.includes('/') ? pad.split('/')[0] : '';
    const groep = INSTELLINGEN_MAPPEN.includes(eerste) ? 'instellingen' : eerste === 'media' ? 'media' : 'code';
    uit.push({ pad, groep });
  }
  return uit;
}

/**
 * Welke bestanden een nummer uit de library hoort te hebben, relatief aan media/
 * (<id>/<bestand>): audio, video (als niet null), peaks.bestand, onset.bestand en
 * stems.bestand, ALLEEN als ze in de rij staan (Library._verrijk). Paden in de
 * library zijn relatief aan de projectmap ("media/<id>/audio.wav").
 */
export function verwachteBestanden(track, mediaMap = 'media') {
  if (!track || typeof track !== 'object') return [];
  const m = tekst(mediaMap).replace(/\/+$/, '').split('/').pop() || 'media';
  const kandidaten = [track.audio, track.video, track.peaks?.bestand, track.onset?.bestand, track.stems?.bestand];
  return kandidaten.filter((p) => typeof p === 'string' && p).map((p) => {
    const delen = p.split('/');
    const i = delen.lastIndexOf(m);
    return i >= 0 ? delen.slice(i + 1).join('/') : delen.slice(-2).join('/');
  });
}

/**
 * "Library compleet": de verwachte bestanden naast wat find zag (geen fs.stat per bestand).
 * @returns {{ nummers, verwacht, ontbreekt: [{ id, bestand }], leeg: [{ id, bestand }] }}
 */
export function vergelijkCompleet(tracks, bestanden, mediaMap = 'media') {
  const ontbreekt = [], leeg = [];
  let verwacht = 0;
  const lijst = Array.isArray(tracks) ? tracks : [];
  for (const t of lijst) {
    // Een rij uit de library, of al teruggebracht tot { id, paden } (verwachtePaden, review 2 fix 16).
    for (const rel of Array.isArray(t?.paden) ? t.paden : verwachteBestanden(t, mediaMap)) {
      verwacht++;
      const bestand = rel.split('/').slice(1).join('/') || rel;
      if (!bestanden?.paden?.has(rel)) ontbreekt.push({ id: t.id, bestand });
      else if (bestanden.bytes?.get(rel) === 0) leeg.push({ id: t.id, bestand });
    }
  }
  return { nummers: lijst.length, verwacht, ontbreekt, leeg };
}

/**
 * Alleen wat `vergelijkCompleet` nodig heeft: [{ id, paden }] in plaats van de hele
 * rij uit `_verrijk` (die de route anders tussen twee wijzigingen vasthoudt).
 */
export function verwachtePaden(tracks, mediaMap = 'media') {
  return (Array.isArray(tracks) ? tracks : []).map((t) => ({ id: t?.id, paden: verwachteBestanden(t, mediaMap) }));
}

// ---- de data: avondpakket/profielen.json ----------------------------------

const TERUGVAL_PROFIEL = {
  titel: 'Alleen de laptop', geluid: 'optioneel', avhub: 'nee', usbhub: 'nee', voeding: 'verwacht', tailscale: 'optioneel', beeld: 'nee',
  kan: ['alles met muis en toetsenbord (KEYMAP)'], kanNiet: [],
};

function terugval(fout) {
  return { standaard: 'laptop', fase: 'auto', hardwareBevestigd: false, bekend: [], grenzen: { ...STANDAARD_GRENZEN },
    apparaten: {}, virtueel: STANDAARD_VIRTUEEL, paklijst: [], profielen: { laptop: { ...TERUGVAL_PROFIEL } }, fout };
}

/**
 * profielen.json lezen. Gooit nooit: kapotte of onbruikbare data geeft de terugval
 * (alleen `laptop`, geen apparaten) plus `fout`. Onbekende velden zijn geen fout:
 * de data mag vooruitlopen op de code.
 */
export function leesProfielen(t) {
  const j = jsonVan(t);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return terugval('geen geldige JSON');
  // "__proto__" als sleutel zou het prototype van het object zetten in plaats van een profiel (review 2, fix 7).
  const profielen = {};
  for (const [naam, p] of Object.entries(j.profielen && typeof j.profielen === 'object' ? j.profielen : {})) {
    if (naam !== '__proto__' && p && typeof p === 'object' && !Array.isArray(p)) profielen[naam] = p;
  }
  if (!Object.keys(profielen).length) return terugval('geen profielen');
  const apparaten = {};
  for (const [id, a] of Object.entries(j.apparaten && typeof j.apparaten === 'object' ? j.apparaten : {})) {
    if (id !== '__proto__' && a && typeof a === 'object') apparaten[id] = { titel: tekst(a.titel) || id, naam: tekst(a.naam), usb: Array.isArray(a.usb) ? a.usb.map(tekst) : [], via: tekst(a.via), kabel: tekst(a.kabel) };
  }
  const grenzen = { ...STANDAARD_GRENZEN };
  for (const [k, v] of Object.entries(j.grenzen && typeof j.grenzen === 'object' ? j.grenzen : {})) {
    if (k in grenzen && Number.isFinite(v)) grenzen[k] = v;
  }
  return {
    standaard: heeftProfiel({ profielen }, j.standaard) ? j.standaard : Object.keys(profielen)[0],
    fase: FASEN.includes(j.fase) ? j.fase : 'auto',
    hardwareBevestigd: j.hardwareBevestigd === true,
    bekend: Array.isArray(j.bekend) ? j.bekend.filter((x) => typeof x === 'string') : [],
    grenzen, apparaten,
    virtueel: regex(j.virtueel) ? j.virtueel : STANDAARD_VIRTUEEL,
    paklijst: leesPaklijst(j.paklijst),
    profielen,
  };
}

/**
 * De paklijst uit de data (review F2): [{ wat, profielen: '*' | [naam, …] }].
 * De apparaten, de PD-hub en de rest die het pakket zelf kent, staan er niet in
 * (die komen uit `apparaten` en `usbhub`). Gooit nooit: een onbruikbare regel
 * valt weg, een onbruikbare lijst is [].
 */
function leesPaklijst(lijst) {
  if (!Array.isArray(lijst)) return [];
  return lijst.filter((r) => r && typeof r === 'object' && typeof r.wat === 'string' && r.wat.trim()
    && (r.profielen === '*' || (Array.isArray(r.profielen) && r.profielen.every((x) => typeof x === 'string'))))
    .map((r) => ({ wat: r.wat.trim(), profielen: r.profielen === '*' ? '*' : [...r.profielen] }));
}

/**
 * Bestaat dit profiel echt in de data? Alleen eigen sleutels: `constructor`,
 * `toString` of `__proto__` staan op elk object en zijn geen profiel (review 2, fix 7).
 */
export function heeftProfiel(data, naam) {
  return typeof naam === 'string' && !!data?.profielen && Object.hasOwn(data.profielen, naam);
}

/**
 * Alle paklijstregels van een profiel, in de volgorde van docs/AVONDPAKKET.md §6:
 * eerst wat het pakket zelf kent (de verwachte apparaten met hun kabel, de
 * PD-hub), dan de regels uit de data. Ongeacht de fase: ook `laptop`, dat altijd
 * `aankomst` is, heeft een paklijst.
 */
export function paklijstVan(naam, data) {
  if (!heeftProfiel(data, naam)) return [];
  const p = data.profielen[naam];
  const uit = [];
  if (waardeVan(p, 'usbhub') === 'verwacht') uit.push('USB-C-hub met PD-ingang (lader in de hub)');
  for (const [id, a] of Object.entries(data.apparaten || {})) {
    if (waardeVan(p, id) === 'verwacht') uit.push(`${a.titel}${a.kabel ? ` + ${a.kabel}` : ''}`);
  }
  for (const r of Array.isArray(data.paklijst) ? data.paklijst : []) {
    if (r.profielen === '*' || r.profielen.includes(naam)) uit.push(r.wat);
  }
  return uit;
}

// ---- fase ------------------------------------------------------------------

const onbekend = (m) => m == null || (typeof m === 'object' && !Array.isArray(m) && 'onbekend' in m);
const waardeVan = (profiel, veld) => (WAARDEN.includes(profiel?.[veld]) ? profiel[veld] : 'nee');

/**
 * Wat er gezien is: { [apparaatId]: boolean }, uit USB en (voor geluidskaarten) uit
 * de audio-items MET TRANSPORT usb. Een samengesteld of virtueel apparaat dat
 * "Scarlett + koptelefoon" heet, telt niet: dat kan blijven bestaan terwijl de
 * Scarlett zelf in de tas zit (review F7; of de Scarlett echt `usb` meldt, is
 * pas na stap 7a gezien).
 */
function gezienApparaten(metingen, data) {
  const usb = onbekend(metingen.usb) ? [] : metingen.usb;
  const uit = herkenUsb(usb, data.apparaten);
  const audio = onbekend(metingen.audio) ? [] : metingen.audio.filter((i) => i.transport === 'usb');
  for (const [id, a] of Object.entries(data.apparaten)) {
    const re = regex(a.naam);
    if (!uit[id] && re && audio.some((i) => re.test(i.naam))) uit[id] = true;
  }
  return uit;
}

function standaardUitvoer(metingen) {
  return onbekend(metingen.audio) ? null : metingen.audio.find((i) => i.standaardUit && i.uit > 0) ?? null;
}

function isVirtueel(item, data) {
  return !!item && (item.transport === 'virtual' || !!regex(data.virtueel)?.test(item.naam));
}

/**
 * De fase bij `auto`: hangt er geen enkel apparaat van het profiel aan, dan
 * `vertrek`; anders `aankomst`. Een standaarduitvoer met 4 of meer kanalen die
 * niet ingebouwd, Bluetooth of virtueel is (het samengestelde apparaat) telt ook
 * als "aangekomen"; een HDMI-scherm of een USB-C-dongle met 2 kanalen niet
 * (review F4: thuis hangt de iiyama via HDMI). Een profiel zonder iets om in te
 * pakken (alleen de laptop) is altijd `aankomst`.
 */
export function kiesFase(metingen = {}, profiel = {}, data = {}) {
  if (!heeftInTePakken(profiel, data)) return 'aankomst';
  const apparaten = Object.keys(data.apparaten || {});
  const gezien = gezienApparaten(metingen, { apparaten: {}, ...data });
  if (apparaten.some((id) => waardeVan(profiel, id) !== 'nee' && gezien[id])) return 'aankomst';
  const std = standaardUitvoer(metingen);
  if (std && std.uit >= 4 && !['builtin', 'bluetooth'].includes(std.transport) && !isVirtueel(std, data)) return 'aankomst';
  return 'vertrek';
}

/** Heeft het profiel iets om in te pakken (een apparaat dat niet `nee` is, of geluid `verwacht`)? Zo niet: altijd aankomst. */
function heeftInTePakken(profiel, data) {
  return Object.keys(data?.apparaten || {}).some((id) => waardeVan(profiel, id) !== 'nee') || waardeVan(profiel, 'geluid') === 'verwacht';
}

// ---- het oordeel -------------------------------------------------------------

/** "HH:MM": dezelfde weergave als de tegel Backup (`wanneer` uit backup-tegel.js, review F14). */
const hhmm = (ms) => (Number.isFinite(ms) ? wanneer(ms, new Date(ms)) : '?');

function gb(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return bytes >= 1e9 ? `${komma((bytes / 1e9).toFixed(1))} GB` : `${komma((bytes / 1e6).toFixed(1))} MB`;
}

const ERG = { fout: 3, half: 2, ok: 1, uit: 0 };

/** Het veld `via` uit de data als zin: 'direct' en 'hub-pd' kent de paklijst; de rest staat er letterlijk. */
const VIA = { direct: 'direct in de Mac', 'hub-pd': 'aan de PD-hub' };
const viaTekst = (via) => (!via ? '' : VIA[via] || `via ${via}`);

/**
 * Het rapport. Puur: `nu` (een Date) is de enige klok.
 * @param {object} metingen  per sonde het geparste object of { onbekend }; zie meet() (stap 2)
 * @param {{ profiel?: string, fase?: string, data: object, nu?: Date }} o  data = leesProfielen(…)
 */
export function beoordeel(metingen = {}, { profiel: gevraagd = null, fase: faseIn = null, data = terugval('geen data'), nu = new Date() } = {}) {
  const m = metingen || {};
  const g = data.grenzen || STANDAARD_GRENZEN;
  const punten = [];
  const inpakken = [];
  const punt = (id, naam, licht, waarde, sub = '') => punten.push({ id, naam, licht, waarde: schoon(waarde), sub: schoon(sub) });
  const nietGemeten = (x) => `niet gemeten${x?.onbekend ? `: ${x.onbekend}` : ''}`;
  // Waar dit gemeten is (metingen.platform, van meet): op de Mac "deze Mac", elders "deze machine" (AR19).
  const machine = !m.platform || m.platform === 'darwin' ? 'deze Mac' : 'deze machine';

  // profiel en fase
  const naam = gevraagd && heeftProfiel(data, gevraagd) ? gevraagd : data.standaard;
  const p = data.profielen[naam];
  const profielOnbekend = gevraagd && !heeftProfiel(data, gevraagd) ? String(gevraagd) : undefined;
  // De fase: gekozen (tegel/CLI), anders een vaste fase uit profielen.json (`fase`, review 2
  // fix 8), anders auto. Alleen bij auto raadt het pakket.
  const faseGekozen = faseIn === 'vertrek' || faseIn === 'aankomst';
  const faseBron = faseGekozen ? 'gekozen' : data.fase === 'vertrek' || data.fase === 'aankomst' ? 'data' : 'auto';
  const fase = faseBron === 'gekozen' ? faseIn : faseBron === 'data' ? data.fase : kiesFase(m, p, data);
  const aankomst = fase === 'aankomst';
  const streng = data.hardwareBevestigd ? 'fout' : 'half';   // H5: niet-geziene hardware-uitvoer nooit vals rood

  if (data.fout) punt('profielen', 'Profielen', 'half', 'niet leesbaar', `profielen.json niet leesbaar: ${data.fout}; nu: alleen de laptop`);
  if (profielOnbekend) punt('profiel', 'Profiel', 'half', 'onbekend', `profiel ${profielOnbekend} bestaat niet (meer); nu: ${naam}`);
  // Review 2, fix 1: "niets gezien" is niet "niet gemeten". Zijn USB en geluid allebei niet
  // gemeten (time-out, of de server meet niet omdat er een deck speelt), dan kan auto de fase
  // niet kiezen: vertrek zou elk apparaat een grijze paklijstregel maken, en dan bleef alleen
  // groen over. Oranje, nooit rood (onbekend is nooit rood).
  const faseNietTeBepalen = faseBron === 'auto' && onbekend(m.usb) && onbekend(m.audio) && heeftInTePakken(p, data);
  if (faseNietTeBepalen) {
    const reden = m.usb?.onbekend || m.audio?.onbekend;
    punt('fase', 'Fase', 'half', 'niet te bepalen', `USB en geluid niet gemeten${reden ? ` (${reden})` : ''}: kies vertrek of aankomst`);
  }
  // Review ronde 3 (spoorrapport §5): ook bij een gekozen fase (tegel, CLI of profielen.json),
  // of bij auto die "vertrek" koos, is het licht nooit groen als de kern van die fase niet
  // gemeten is. Vertrek: media en instellingen (het thuiswerk); aankomst: USB en geluid (wat
  // er aanhangt; zonder iets om in te pakken, zoals `laptop`: media en instellingen). Anders
  // bleven alleen backup en achtergrond (in het serverproces) groen over, bijvoorbeeld als
  // Clay "aankomst" kiest terwijl er een deck speelt en de server nog nooit gemeten heeft.
  // Oranje, nooit rood (onbekend is nooit rood); niet naast het punt fase (dat zegt het al).
  if (!faseNietTeBepalen) {
    const opAankomst = fase === 'aankomst' && heeftInTePakken(p, data);
    const kern = opAankomst ? [m.usb, m.audio] : [m.bestanden, m.instellingen];
    if (kern.every((x) => onbekend(x))) {
      const reden = kern.map((x) => x?.onbekend).find(Boolean);
      const wat = opAankomst ? 'USB en geluid' : 'media en instellingen';
      punt('meting', 'Meting', 'half', 'niet gemeten', `${wat} niet gemeten${reden ? ` (${reden})` : ''}: meet opnieuw vóór je ${fase === 'aankomst' ? 'begint' : 'vertrekt'}`);
    }
  }

  // media lokaal
  {
    const b = m.bestanden;
    const verwacht = !onbekend(m.compleet) && Number.isFinite(m.compleet?.verwacht) ? m.compleet.verwacht : null;
    if (onbekend(b)) punt('media', 'Media lokaal', 'uit', '?', nietGemeten(b));
    else if (b.bestaat === false) punt('media', 'Media lokaal', 'uit', 'geen map', 'de mediamap ontbreekt: niets om te controleren');
    else if (!b.totaal) punt('media', 'Media lokaal', 'uit', 'leeg', 'de mediamap is leeg: niets om te controleren');
    else {
      const inNummer = b.dataless.filter((d) => d.pad.includes('/') ? !/^backup/i.test(d.pad) : KERN_DB.test(d.pad));
      const lijst = (l) => l.slice(0, 3).map((d) => `${d.pad}${d.bytes ? ` (${gb(d.bytes)})` : ''}`).join(', ');
      if (inNummer.length) {
        punt('media', 'Media lokaal', 'fout', `${inNummer.length} in iCloud`,
          `${lijst(inNummer)}${inNummer.length > 3 ? ` en ${inNummer.length - 3} meer` : ''}: open in de Finder, klik het wolkje, thuis`);
      } else if (b.dataless.length) {
        punt('media', 'Media lokaal', 'half', `${b.dataless.length} buiten de nummers`, `${lijst(b.dataless)}: uitgeplaatst, onderweg niet nodig`);
      } else if (verwacht !== null && b.totaal < verwacht) {
        punt('media', 'Media lokaal', 'half', `${b.totaal} van ${verwacht}`, 'minder bestanden dan de library verwacht (zie compleet)');
      } else {
        // datalessNvt: op Linux bestaat de iCloud-vlag niet (avondpakket-meet.js); dat zegt het punt dan ook.
        punt('media', 'Media lokaal', 'ok', `${b.totaal} lokaal`, [b.bytesTotaal ? `${gb(b.bytesTotaal)} in media/` : '',
          b.datalessNvt ? 'iCloud-uitplaatsing n.v.t. op dit platform' : ''].filter(Boolean).join(' · '));
      }
    }
  }

  // instellingen lokaal
  {
    const x = m.instellingen;
    if (onbekend(x)) punt('instellingen', 'Instellingen lokaal', 'uit', '?', nietGemeten(x));
    else {
      const inst = x.filter((i) => i.groep === 'instellingen');
      const code = x.filter((i) => i.groep === 'code');
      const waarom = (pad) => (/^mappings\//.test(pad) ? ': zonder internet een dode APC'
        : /^avondpakket\//.test(pad) ? ': zonder internet geen profielen' : ': zonder internet niet te lezen');
      if (inst.length) punt('instellingen', 'Instellingen lokaal', 'fout', `${inst.length} in iCloud`, `${inst[0].pad}${waarom(inst[0].pad)}${inst.length > 1 ? ` (+${inst.length - 1})` : ''}`);
      else if (code.length) punt('instellingen', 'Instellingen lokaal', 'half', `${code.length} code in iCloud`, `${code.slice(0, 3).map((i) => i.pad).join(', ')}: haal ze thuis binnen`);
      else punt('instellingen', 'Instellingen lokaal', 'ok', 'lokaal', 'mappings, racks, patronen, plannen, proef, avondpakket');
    }
  }

  // iCloud (Optimaliseer opslag)
  {
    const aan = onbekend(m.icloud) ? null : m.icloud;
    const vrij = onbekend(m.schijf) ? null : m.schijf?.vrijGiB;
    if (aan === null || typeof aan !== 'boolean') punt('icloud', 'iCloud', 'uit', '?', nietGemeten(m.icloud));
    else if (!aan) punt('icloud', 'iCloud', 'ok', 'opslag optimaliseren uit', 'macOS zet niets uit zichzelf in de cloud');
    else if (Number.isFinite(vrij) && vrij >= g.schijfOranjeGiB) punt('icloud', 'iCloud', 'ok', 'optimaliseren aan', 'aan; pas een risico bij weinig ruimte');
    else punt('icloud', 'iCloud', 'half', 'optimaliseren aan', `aan${Number.isFinite(vrij) ? ` en ${komma(vrij)} GiB vrij` : ''}: macOS kan media/ naar de cloud zetten`);
  }

  // schijf
  {
    const s = m.schijf;
    if (onbekend(s) || !Number.isFinite(s?.vrijGiB)) punt('schijf', 'Schijf', 'uit', '?', nietGemeten(s));
    else {
      const licht = s.vrijGiB >= g.schijfOranjeGiB ? 'ok' : s.vrijGiB >= g.schijfRoodGiB ? 'half' : 'fout';
      punt('schijf', 'Schijf', licht, `${komma(Math.round(s.vrijGiB))} GiB vrij`,
        licht === 'ok' ? `van ${komma(Math.round(s.totaalGiB ?? 0))} GiB` : `minder dan ${licht === 'half' ? g.schijfOranjeGiB : g.schijfRoodGiB} GiB: ruim op vóór vertrek`);
    }
  }

  // accu en lader
  {
    const a = m.accu;
    if (onbekend(a) || !Number.isFinite(a?.procent)) punt('accu', 'Accu', 'uit', '?', nietGemeten(a));
    else {
      const lader = a.bron === 'AC' ? (Number.isFinite(a.laderW) ? `aan ${a.laderW} W-lader` : 'aan de lader') : 'op de accu';
      const gezond = [Number.isFinite(a.gezondheid) && `gezondheid ${a.gezondheid} %`, Number.isFinite(a.cycli) && `${a.cycli} cycli`].filter(Boolean).join(' · ');
      const sub = (zin) => [zin, lader, gezond].filter(Boolean).join(' · ');
      const waarde = `${a.procent} %`;
      const zwak = a.bron === 'AC' && Number.isFinite(a.laderW) && a.laderW < g.laderMinW;
      if (a.procent < g.accuRoodProcent && a.bron !== 'AC') punt('accu', 'Accu', 'fout', waarde, sub('bijna leeg: lader erin'));
      else if (a.procent < g.accuRoodProcent && zwak) punt('accu', 'Accu', 'fout', waarde, sub(`bijna leeg aan een zwakke lader (${a.laderW} W): onder last loopt hij verder leeg; een lader van ${g.laderMinW} W of meer`));
      else if (!aankomst) {
        if (a.procent >= g.accuVertrekProcent) punt('accu', 'Accu', 'ok', waarde, sub(''));
        else punt('accu', 'Accu', 'half', waarde, sub(`laad vóór vertrek tot ${g.accuVertrekProcent} %`));
      } else if (a.bron === 'AC') {
        if (Number.isFinite(a.laderW) && a.laderW < g.laderMinW) punt('accu', 'Accu', 'half', waarde, sub(`zwakke lader (${a.laderW} W): kan onder last leeglopen`));
        else punt('accu', 'Accu', 'ok', waarde, sub(''));
      } else if (waardeVan(p, 'voeding') === 'verwacht') punt('accu', 'Accu', 'half', waarde, sub('lader erin'));
      else punt('accu', 'Accu', 'ok', waarde, sub(''));
    }
  }

  // geluid
  {
    const w = waardeVan(p, 'geluid');
    const std = standaardUitvoer(m);
    const btZaal = p.zaal === 'bluetooth';
    const latentie = 'Bluetooth-zaal: 150-250 ms latency, geen cue (ONDERZOEK.md:243)';
    const beschrijf = (i) => (i ? `${i.naam} · ${i.uit} uit` : 'geen standaarduitvoer');
    if (w === 'nee') { /* niet getoond */ } else if (!aankomst) {
      if (w === 'verwacht') {
        punt('geluid', 'Geluid', 'uit', 'inpakken', `inpakken: bedrade koptelefoon, speakerkabels${btZaal ? ` · ${latentie}` : ''}`);
      } else punt('geluid', 'Geluid', 'uit', onbekend(m.audio) ? '?' : beschrijf(std), 'optioneel');
    } else if (onbekend(m.audio)) punt('geluid', 'Geluid', 'uit', '?', nietGemeten(m.audio));
    else if (btZaal) {
      if (std?.transport === 'bluetooth') punt('geluid', 'Geluid', 'ok', beschrijf(std), latentie);
      else punt('geluid', 'Geluid', 'half', beschrijf(std), `de Bluetooth-speaker is niet de standaarduitvoer · ${latentie}`);
    } else if (w === 'optioneel') {
      if (std?.transport === 'bluetooth') punt('geluid', 'Geluid', 'half', beschrijf(std), 'Bluetooth als standaard: latency');
      else punt('geluid', 'Geluid', 'ok', beschrijf(std), std ? std.transport : '');
    } else {
      const goed = (i) => i && i.uit >= 4 && !isVirtueel(i, data) && i.transport !== 'bluetooth';
      if (goed(std)) punt('geluid', 'Geluid', 'ok', beschrijf(std), 'zaal en koptelefoon apart (STUDIO §3)');
      else {
        const reden = !std ? 'geen standaarduitvoer gezien'
          : std.transport === 'bluetooth' ? `Bluetooth (${std.naam}): latency, geen cue: zet Bluetooth uit`
            : isVirtueel(std, data) ? `virtueel apparaat (${std.naam})`
              : `${std.uit} kanalen: geen aparte cue (STUDIO §3)`;
        const beter = m.audio.find((i) => goed(i) && i !== std);
        punt('geluid', 'Geluid', streng, beschrijf(std), beter ? `${reden}; kies ${beter.naam} in Systeeminstellingen › Geluid vóór de mixer opent` : reden);
      }
    }
  }

  // Bluetooth (alleen bij aankomst, en alleen als het geluid ertoe doet)
  if (aankomst && waardeVan(p, 'geluid') === 'verwacht') {
    const b = m.bluetooth;
    if (onbekend(b)) punt('bluetooth', 'Bluetooth', 'uit', '?', nietGemeten(b));
    else if (!b.aan) punt('bluetooth', 'Bluetooth', 'ok', 'uit', '');
    else if (b.audio.length && p.zaal !== 'bluetooth') punt('bluetooth', 'Bluetooth', 'half', `${b.audio[0]} verbonden`, `de ${b.audio[0]} pakken de standaarduitvoer: zet Bluetooth uit`);
    else punt('bluetooth', 'Bluetooth', 'ok', 'aan', b.audio.length ? `${b.audio.join(', ')} (Bluetooth-zaal)` : 'geen audio-apparaat verbonden');
  }

  // de apparaten (uit de data)
  {
    const usbOnbekend = onbekend(m.usb);
    const gezien = gezienApparaten(m, data);
    for (const [id, a] of Object.entries(data.apparaten)) {
      const w = waardeVan(p, id);
      if (w === 'nee' && !(aankomst && gezien[id])) continue;
      if (gezien[id]) { punt(id, a.titel, w === 'nee' ? 'uit' : 'ok', 'aangesloten', w === 'nee' ? 'niet in dit profiel' : viaTekst(a.via)); continue; }
      if (!aankomst) {
        if (w === 'verwacht') punt(id, a.titel, 'uit', 'inpakken', `inpakken: ${a.titel}${a.kabel ? ` + ${a.kabel}` : ''}`);
        else punt(id, a.titel, 'uit', 'optioneel', 'niet aangesloten (optioneel)');
      } else if (usbOnbekend) punt(id, a.titel, 'uit', '?', nietGemeten(m.usb));
      else if (w === 'verwacht') punt(id, a.titel, streng, 'niet gezien', `${a.titel} aansluiten${a.via ? ` (${viaTekst(a.via)})` : ''}`);
      else punt(id, a.titel, 'uit', 'niet aangesloten', 'optioneel');
    }
  }

  // AV-hub (poort 7700)
  {
    const w = waardeVan(p, 'avhub');
    const h = m.avhub;
    if (onbekend(h)) { if (w !== 'nee') punt('avhub', 'AV-hub', 'uit', '?', nietGemeten(h)); }
    else if (w === 'nee') { if (h.draait) punt('avhub', 'AV-hub', 'half', 'draait', 'niet in dit profiel: de hub kan de APC vergrendelen (lease)'); }
    else if (h.draait) punt('avhub', 'AV-hub', 'ok', 'draait', p.set ? `set ${p.set}` : '');
    else if (w === 'optioneel') punt('avhub', 'AV-hub', 'uit', 'dicht', 'optioneel');
    // Vertrek: thuis hoort de hub dicht te zijn; het ritueel start hem pas bij aankomst
    // (review F3: W1 gaat voor de tabel in ontwerp §2.6).
    else if (!aankomst) punt('avhub', 'AV-hub', 'uit', 'dicht', `straks bij aankomst: npm start -- ${p.set || 'studio'} in ~/Projects/AV-app-hub`);
    else punt('avhub', 'AV-hub', 'fout', 'dicht', `start de hub: npm start -- ${p.set || 'studio'} in ~/Projects/AV-app-hub`);
  }

  // USB-hub met PD-ingang: niet meetbaar zonder aannames, alleen de paklijst
  if (waardeVan(p, 'usbhub') !== 'nee') {
    if (!aankomst) punt('usbhub', 'USB-hub', 'uit', 'inpakken', 'inpakken: USB-C-hub met PD-ingang (lader in de hub)');
    else punt('usbhub', 'USB-hub', 'uit', 'niet gemeten', 'lader → PD-hub → Mac; APC direct in de Mac');
  }

  // servers op library.db
  {
    const s = m.servers;
    if (onbekend(s)) punt('servers', 'Servers', 'uit', '?', nietGemeten(s));
    else {
      const varve = Number.isFinite(s.varve) ? `${s.varve} Varve-server${s.varve === 1 ? '' : 's'} op ${machine}` : '';
      if (Number.isFinite(s.opDb) && s.opDb >= 2) punt('servers', 'Servers', 'fout', `${s.opDb} op library.db`, `twee processen op library.db: stop er één${varve ? ` · ${varve}` : ''}`);
      else if (s.opDb === 1) punt('servers', 'Servers', 'ok', 'één op library.db', varve);
      else if (s.opDb === 0) punt('servers', 'Servers', 'uit', 'geen', `geen proces op library.db${varve ? ` · ${varve}` : ''}`);
      else if (Number.isFinite(s.varve) && s.varve >= 2) punt('servers', 'Servers', 'half', `${s.varve} Varve-servers`, `${s.varve} Varve-servers; welke op deze library.db is niet gezien`);
      else punt('servers', 'Servers', 'uit', '?', `library.db niet gecontroleerd${varve ? ` · ${varve}` : ''}`);
    }
  }

  // Tailscale
  {
    const w = waardeVan(p, 'tailscale');
    const t = m.tailscale;
    const peers = Array.isArray(p.peers) ? p.peers : [];
    if (w === 'nee') { /* niet getoond */ } else if (onbekend(t)) punt('tailscale', 'Tailscale', 'uit', '?', nietGemeten(t));
    else {
      const sub = peers.map((naam) => {
        const x = t.peers.find((q) => q.naam === naam);
        return !x ? `${naam}: niet in de tailnet` : `${naam} ${x.online ? 'online' : 'offline'}${x.online ? (x.direct ? ', direct' : `, relay${x.relay ? ` ${x.relay}` : ''}`) : ''}`;
      }).join(' · ');
      if (t.backend !== 'Running') {
        if (w === 'verwacht') punt('tailscale', 'Tailscale', aankomst ? 'fout' : 'half', t.backend || 'uit', 'Tailscale aanzetten (beeld en iPhone hebben het nodig)');
        else punt('tailscale', 'Tailscale', 'uit', t.backend || 'uit', 'optioneel: Varve zelf speelt zonder internet');
      } else {
        const offline = peers.filter((naam) => !t.peers.find((q) => q.naam === naam)?.online);
        if (offline.length && aankomst && waardeVan(p, 'beeld') === 'verwacht') punt('tailscale', 'Tailscale', 'half', 'aan', `${sub}: zet ${offline.join(', ')} aan`);
        else punt('tailscale', 'Tailscale', 'ok', 'aan', sub);
      }
    }
  }

  // backup van library.db
  {
    const b = m.backup;
    const tas = `kopie staat op ${machine} (gaat mee in de tas)`;
    // Een machine zonder library (de pc, AR19): niets om te kopiëren, dus grijs, nooit rood.
    if (b?.geenLibrary) punt('backup', 'Backup', 'uit', 'geen library', `geen library.db op ${machine}: niets om te kopiëren (de live-mixer draait op de Mac)`);
    else if (onbekend(b)) punt('backup', 'Backup', 'uit', '?', nietGemeten(b));
    else if (b.fout) punt('backup', 'Backup', 'fout', 'mislukt', tekst(b.fout));
    else if (b.bezig) punt('backup', 'Backup', 'uit', 'bezig…', tas);
    else if (!b.laatste) punt('backup', 'Backup', 'fout', 'nog nooit', 'library.db heeft nog geen kopie: start de server, die maakt er een');
    else if (b.bron === 'map') punt('backup', 'Backup', 'uit', wanneer(b.laatste.tijd, nu), `laatste kopie uit de map (server niet gezien) · ${tas}`);
    else if (b.gewijzigdSinds === true) punt('backup', 'Backup', 'half', wanneer(b.laatste.tijd, nu), `wijziging nog in geen kopie; de server kijkt uiterlijk ${hhmm((b.gekeken ?? nu.getTime()) + 36e5)}`);
    else if (b.gewijzigdSinds === null) punt('backup', 'Backup', 'uit', wanneer(b.laatste.tijd, nu), `of er sindsdien iets veranderde is niet te zien · ${tas}`);
    else punt('backup', 'Backup', 'ok', wanneer(b.laatste.tijd, nu), tas);
  }

  // achtergrondwerk en de nacht
  {
    const a = m.achtergrond;
    if (onbekend(a)) punt('achtergrond', 'Achtergrond', 'uit', '?', nietGemeten(a));
    else {
      const bezig = [a.stemsBezig && 'een split', a.ingestBezig && 'een ingest'].filter(Boolean);
      const wacht = (a.ingestWacht || 0) + (a.stemsWacht || 0);
      // "vandaag niet" (de knop in de mixer, KAART › NACHTWACHTRIJ) houdt de nacht net zo goed tegen (review 2, fix 3).
      const nacht = a.nachtAan && !a.vandaagSpeeldag && !a.vannachtUit;
      if (bezig.length && aankomst) punt('achtergrond', 'Achtergrond', 'fout', `${bezig.join(' en ')} bezig`, 'kost CPU tijdens het spelen: wacht of stop hem');
      else if (bezig.length) punt('achtergrond', 'Achtergrond', 'half', `${bezig.join(' en ')} bezig`, 'wacht tot hij klaar is, of stop hem');
      else if (wacht) punt('achtergrond', 'Achtergrond', 'half', `${wacht} in de wachtrij`, 'leeg de wachtrij of laat hem thuis aflopen');
      else if (nacht) punt('achtergrond', 'Achtergrond', 'half', 'nacht aan', "zet 'vandaag niet' aan of de nachtwachtrij uit (mixer › KAART › NACHTWACHTRIJ)");
      else punt('achtergrond', 'Achtergrond', 'ok', 'rustig', !a.nachtAan ? 'wachtrijen leeg, nacht uit' : a.vandaagSpeeldag ? 'nacht aan, vandaag speeldag' : 'nacht aan, vannacht niet');
    }
  }

  // library compleet
  {
    const c = m.compleet;
    if (onbekend(c)) punt('compleet', 'Library compleet', 'uit', '?', nietGemeten(c));
    else {
      const mis = [...(c.ontbreekt || []).map((x) => ({ ...x, w: 'ontbreekt' })), ...(c.leeg || []).map((x) => ({ ...x, w: '0 B' }))];
      const zin = mis.slice(0, 3).map((x) => `${x.id}/${x.bestand} (${x.w})`).join(', ') + (mis.length > 3 ? ` en ${mis.length - 3} meer` : '');
      if (c.oud) punt('compleet', 'Library compleet', 'uit', mis.length ? `${mis.length} mist` : `${c.nummers} nummers`, `niet vernieuwd (er speelt een deck)${zin ? `: ${zin}` : ''}`);
      else if (mis.length) punt('compleet', 'Library compleet', 'fout', `${mis.length} mist`, zin);
      else punt('compleet', 'Library compleet', 'ok', `${c.nummers} nummers`, 'elk verwacht bestand is er en is niet leeg');
    }
  }

  // server (alleen de CLI zonder route levert dit)
  if (m.server !== undefined) {
    const s = m.server;
    if (onbekend(s)) punt('server', 'Server', 'uit', '?', nietGemeten(s));
    else if (s.bereikbaar) punt('server', 'Server', 'ok', 'bereikbaar', Number.isFinite(s.nummers) ? `${s.nummers} nummers` : '');
    else punt('server', 'Server', aankomst ? 'fout' : 'half', 'niet bereikbaar', 'start VARVE in het Dock');
  }

  // bekend: een oranje punt dat Clay bewust accepteert, wordt grijs (rood nooit)
  for (const x of punten) {
    if (x.licht === 'half' && data.bekend.includes(x.id)) Object.assign(x, { licht: 'uit', bekend: true, sub: `bekend: ${x.sub || x.waarde}` });
  }

  const telling = { ok: 0, half: 0, fout: 0, uit: 0 };
  for (const x of punten) telling[x.licht]++;
  const licht = punten.reduce((erg, x) => (ERG[x.licht] > ERG[erg] ? x.licht : erg), 'uit');
  const oordeel = telling.fout ? (aankomst ? 'nog niet beginnen' : 'nog niet vertrekken') : 'klaar';
  const lijst = (v) => (Array.isArray(v) ? v.map(tekst) : []);
  const paklijst = paklijstVan(naam, data);
  if (!aankomst) inpakken.push(...paklijst);
  const rapport = {
    profiel: naam, fase, faseGekozen, faseBron, t: nu.getTime(), hardwareBevestigd: !!data.hardwareBevestigd,
    licht, telling, oordeel,
    letOp: punten.filter((x) => x.licht === 'half').map((x) => x.id),
    inpakken, paklijst, punten,
    titel: tekst(p.titel) || naam,
    kan: lijst(p.kan), kanNiet: lijst(p.kanNiet), let: lijst(p.let),
    profielen: Object.entries(data.profielen).map(([id, x]) => ({ id, titel: tekst(x.titel) || id })),
  };
  if (profielOnbekend) rapport.profielOnbekend = profielOnbekend;
  if (m.speellijst !== undefined) rapport.info = { speellijst: m.speellijst };
  return rapport;
}
