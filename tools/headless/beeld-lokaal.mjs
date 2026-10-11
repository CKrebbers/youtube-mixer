// Beeld op één machine (spoor beeld-een-machine, docs/BEELD.md §1 "Eén machine",
// docs/BEAMER.md "Zaalbeeld"): kan de Stroommachine op deze Mac draaien naast
// VARVE, en wat kost dat? Fps van de Stroommachine, CPU en geheugen per proces,
// en krijgt het geluid van VARVE gaten?
//
// Wat er draait (alles eigen, alles op 127.0.0.1, niets van Clay):
//   - de relay uit de Stroommachine-repo op 7712 (NIET 7702: dat is die van Clay),
//     zonder --stil, de uitvoer in de tijdelijke map (relay.log)
//   - een eigen VARVE-server op 8801: tijdelijke database, media-, opname-,
//     patronen-, plannen- en proefmap, een niet-bestaande kaart, een eigen
//     kaart.db, de nep-yt-dlp (test/nep-ytdlp.mjs) en geen heranalyse
//   - twee headless Chromes for Testing op Metal, elk een eigen tijdelijk
//     profiel: de Stroommachine (debug 9391) en VARVE (debug 9392, zonder
//     requestMIDIAccess: veilig met de APC aangesloten). --mute-audio: er klinkt
//     niets, het echte apparaat blijft de klok (A2 in het ontwerp).
//
// De drie meters (5-ontwerp-definitief.md, H1–H3):
//   - fps: een eigen rAF-meter in de Stroommachine-tab (alleen tijdstempels, geen
//     canvas), en ter controle __stroom.kwInfo().ms. Die zegt alleen iets met
//     &fps in de hash (zonder blijft ms 16,7), dus elke meet-URL heeft &fps en
//     "kwInfo().fps === true en ms niet constant" is een harde check.
//   - gaten in het geluid: een hartslag-worklet in VARVE's eigen AudioContext
//     (engine.ctx), via een Blob-URL: het grootste gat tussen twee process()-
//     aanroepen en het aantal gaten > 15 ms (rust ≈ 6 ms). Aan het eind van elke
//     run een POSITIEVE CONTROLE: een aparte context blokkeert 40 ms; ziet de
//     meter dat niet, dan is hij blind en is de run FAIL.
//   - NIET de fps uit beeld-status (de tooltip in VARVE): die is vast 63.
//
// Gebruik:
//   node tools/headless/beeld-lokaal.mjs --zelftest
//        zonder GPU en zonder Stroommachine, ≤ 20 s: de controles vooraf, de
//        warmtemeter, de hartslag met zijn positieve controle in een stille
//        headless Chrome, de fps-logica op een nep-kwInfo, en de opruiming.
//   node tools/headless/beeld-lokaal.mjs [uitmap] [--standen nul,licht-1080,…] [--warm 20] [--meet 120] [--accu]
//        de volledige run (≈ 14 min). Standaardvolgorde: nul, licht-1080, nul,
//        normaal-1080, nul, vormen, licht-720. Duur per stand: nul 120 s de eerste
//        keer en 60 s daarna, licht-1080 120 s, de rest 60 s; --meet overschrijft.
//        Uitvoer: <uitmap>/beeld-lokaal.json en één regel per stand.
//   node tools/headless/beeld-lokaal.mjs --kijk [--duur 600]
//        tijdens een echte proef (tools/beeld-lokaal.sh, stap 7): elke seconde
//        kwInfo() van de Stroommachine via 127.0.0.1:9393 en ps (CPU, RSS) naar
//        <uitmap>/kijk-<datum>.jsonl. Raakt niets, verbindt niet met de relay.
//   node tools/headless/beeld-lokaal.mjs --opruimen
//        stopt ALLEEN processen van deze meting: met het tmp-voorvoegsel
//        varve-beeld-lokaal- in hun argumenten (de Chromes via hun profiel, de
//        proefserver via --meting=<tmp>), of varve-relay.js op 7712.
// Ctrl-C (SIGINT/SIGTERM) stopt alle kinderen (ze draaien in een eigen
// procesgroep) en ruimt de tijdelijke map op, ook in --zelftest.
// Standen: nul (Stroommachine leeg), licht-1080, normaal-1080, licht-720 (de
//   vergelijking met ontwerp B §3), vormen (zaalbeeld: vormen in het losse
//   venster, zonder clips), en op aanvraag samen (zaalbeeld + Licht) en auto-1080.
// Omgeving: VARVE_STROOM_REPO (~/Projects/stroommachine), VARVE_RELAY_POORT (7712),
//   VARVE_BL_POORT (8801), VARVE_BL_DEBUG (9391; VARVE +1), VARVE_BL_KIJK_DEBUG (9393),
//   VARVE_CHROME, VARVE_BL_FORCEER=1 (meten ondanks een druk proces of geluid; wordt
//   gelogd; zie tools/README.md wanneer dat mag), VARVE_BL_BEWAAR=1 (de tijdelijke
//   map laten staan).
//
// NIET op een speeldag en niet terwijl Clay speelt: de volledige run trekt minuten
// lang twee Chromes op de GPU. Hij weigert te starten als er geluid uit de Mac komt
// (pmset audio-out) of een ander proces > 20 % van een kern trekt, en breekt af
// als het audioproces van Clay's Chrome tijdens de run gaat rekenen. Systeemdaemons
// (/System/, /usr/libexec/, …: mediaanalysisd, fileproviderd, Spotlight) houden hem
// niet tegen: die pieken op deze Mac geregeld en zijn geen andere testrun; ze komen
// als "achtergrond" in de JSON, ook per stand (begin en eind).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, existsSync, rmSync, appendFileSync, openSync, closeSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
export const VOORVOEGSEL = 'varve-beeld-lokaal-';
export const VOLGORDE = ['nul', 'licht-1080', 'nul', 'normaal-1080', 'nul', 'vormen', 'licht-720'];
export const GAT_MS = 15;              // een gat in de hartslag (rust ≈ 6 ms in de probe van de critici)
export const CONTROLE_MS = 40;         // de positieve controle blokkeert zoveel
export const VREEMD_KERN = 0.2;        // een ander proces boven 20 % van een kern: niet meten
export const AUDIO_KLAAG_S = 0.1;      // Clay's audioproces rekent > 0,1 s per 5 s: afbreken

/** Wat elke stand met de Stroommachine-tab en de vormen doet. */
export const STANDEN = {
  nul: { stroom: null, vormen: false, uitleg: 'Stroommachine leeg (about:blank): de lopende nulmeting' },
  'licht-1080': { stroom: { hash: 'licht&vast&fps', b: 1920, h: 1080 }, vormen: false, uitleg: 'Stroommachine Licht op 1920×1080' },
  'normaal-1080': { stroom: { hash: 'normaal&vast&fps', b: 1920, h: 1080 }, vormen: false, uitleg: 'Stroommachine Normaal op 1920×1080' },
  'licht-720': { stroom: { hash: 'licht&vast&fps', b: 1280, h: 720 }, vormen: false, uitleg: 'Licht op 1280×720 (vergelijking met ontwerp B §3)' },
  vormen: { stroom: null, vormen: true, uitleg: 'zaalbeeld: vormen in het losse venster, zonder clips' },
  samen: { stroom: { hash: 'licht&vast&fps', b: 1920, h: 1080 }, vormen: true, uitleg: 'zaalbeeld en Licht tegelijk' },
  'auto-1080': { stroom: { hash: 'auto&fps', b: 1920, h: 1080 }, vormen: false, uitleg: 'Auto (adaptieve schaal) op 1920×1080' },
};

// ---- puur: opties, duur, adressen -------------------------------------------------

/** De opdrachtregel en de omgeving, gelezen. Onbekende standen staan in `onbekend`. */
export function leesOpties(argv = [], env = {}) {
  const metWaarde = new Set(['--standen', '--warm', '--meet', '--duur']);
  const waarde = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const getal = (k, standaard) => {
    const v = waarde(k);
    if (v === undefined) return standaard;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const los = argv.filter((a, i) => !a.startsWith('--') && !metWaarde.has(argv[i - 1]));
  const standen = String(waarde('--standen') ?? VOLGORDE.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const debug = Number(env.VARVE_BL_DEBUG) || 9391;
  return {
    uit: los[0] ? resolve(los[0]) : join(WORTEL, 'tools/headless/uit'),
    standen,
    onbekend: standen.filter((s) => !(s in STANDEN)),
    warm: getal('--warm', 20),
    meet: getal('--meet', null),
    duur: getal('--duur', null),
    zelftest: argv.includes('--zelftest'),
    kijk: argv.includes('--kijk'),
    opruimen: argv.includes('--opruimen'),
    accu: argv.includes('--accu'),
    repo: env.VARVE_STROOM_REPO || join(homedir(), 'Projects/stroommachine'),
    relay: Number(env.VARVE_RELAY_POORT) || 7712,
    poort: Number(env.VARVE_BL_POORT) || 8801,
    debugStroom: debug,
    debugVarve: debug + 1,
    kijkDebug: Number(env.VARVE_BL_KIJK_DEBUG) || 9393,
    chrome: env.VARVE_CHROME || null,
    forceer: env.VARVE_BL_FORCEER === '1',
    bewaar: env.VARVE_BL_BEWAAR === '1',
  };
}

/** Een getaloptie die geen getal ≥ 0 is (NaN uit leesOpties), als tekst; null als alles klopt. */
export function optieFout(o) {
  const mis = [['--warm', o.warm], ['--meet', o.meet], ['--duur', o.duur]].filter(([, v]) => v !== null && !Number.isFinite(v)).map(([k]) => k);
  return mis.length ? `${mis.join(', ')} moet een getal ≥ 0 zijn (in seconden)` : null;
}

/** Hoe lang stand i meet (s): `nul` de eerste keer 120 en daarna 60, licht-1080 120, de rest 60. */
export function duurVan(standen, i, meet = null) {
  if (meet != null && Number.isFinite(meet)) return meet;
  const s = standen[i];
  if (s === 'nul') return standen.indexOf('nul') === i ? 120 : 60;
  if (s === 'licht-1080') return 120;
  return 60;
}

/** De Stroommachine met de relay op deze Mac, in de dj-stand. */
export function stroomUrl(repo, relayPoort, hash) {
  const hub = encodeURIComponent(`ws://127.0.0.1:${relayPoort}/app`);
  return `${pathToFileURL(join(repo, 'index.html')).href}?hub=${hub}&dj#${hash}`;
}

// ---- puur: ps lezen en optellen ---------------------------------------------------

/** cputime van ps naar seconden: macOS "M:SS.cc" (minuten lopen door boven 60), Linux "[D-][H:]MM:SS". */
export function cputijd(tekst) {
  const m = String(tekst).trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)$/);
  if (!m) return NaN;
  const [, d = 0, h = 0, mi, s] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(mi) * 60 + Number(String(s).replace(',', '.'));
}

/** Regels van `ps -axo pid=,ppid=,cputime=,rss=,command=` als objecten (rss in kB, cpu in s). */
export function leesPs(tekst) {
  const rijen = [];
  for (const regel of String(tekst).split('\n')) {
    const m = regel.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (m) rijen.push({ pid: Number(m[1]), ppid: Number(m[2]), cpu: cputijd(m[3]), rss: Number(m[4]), cmd: m[5] });
  }
  return rijen;
}

/** Een proces en al zijn nakomelingen (ppid-keten): Chrome's helpers hangen onder de browser. */
export function boom(rijen, wortel) {
  const kinderen = new Map();
  for (const r of rijen) {
    if (!kinderen.has(r.ppid)) kinderen.set(r.ppid, []);
    kinderen.get(r.ppid).push(r.pid);
  }
  const uit = new Set([wortel]);
  const rij = [wortel];
  while (rij.length) {
    for (const k of kinderen.get(rij.pop()) || []) if (!uit.has(k)) { uit.add(k); rij.push(k); }
  }
  return uit;
}

/**
 * CPU (in kernen) en RSS (MB) per groep tussen twee ps-momenten. `wortels`:
 * naam → pid van het proces dat wij startten (of een functie die de pids geeft).
 */
export function cpuPerGroep(voor, na, wortels, dtS) {
  const oud = new Map(voor.map((r) => [r.pid, r.cpu]));
  const uit = {};
  for (const [naam, w] of Object.entries(wortels)) {
    const pids = typeof w === 'function' ? w(na) : w ? boom(na, w) : new Set();
    let cpu = 0, rss = 0, n = 0;
    for (const r of na) {
      if (!pids.has(r.pid)) continue;
      cpu += Math.max(0, r.cpu - (oud.get(r.pid) ?? r.cpu));
      rss += r.rss;
      n++;
    }
    uit[naam] = { kern: dtS > 0 ? cpu / dtS : 0, rssMB: rss / 1024, n };
  }
  return uit;
}

/** Een commando kort genoeg voor een regel (zonder de lange --vlaggen van Chrome). */
export const kortCmd = (cmd) => { const s = String(cmd).split(' --')[0]; return s.length > 90 ? `…${s.slice(-89)}` : s; };

/** De grootste CPU-gebruikers tussen twee ps-momenten, behalve `uitsluiten` (pids). */
export function topGebruikers(voor, na, dtS, uitsluiten = new Set()) {
  const oud = new Map(voor.map((r) => [r.pid, r]));
  return na.filter((r) => oud.has(r.pid) && !uitsluiten.has(r.pid))
    .map((r) => ({ pid: r.pid, kern: dtS > 0 ? Math.max(0, r.cpu - oud.get(r.pid).cpu) / dtS : 0, cmd: kortCmd(r.cmd) }))
    .sort((a, b) => b.kern - a.kern);
}

/** Een proces van macOS zelf (mediaanalysisd, fileproviderd, mds, WindowServer …), geen andere testrun. */
export const SYSTEEM = /^(\/System\/|\/usr\/libexec\/|\/usr\/sbin\/|\/sbin\/|\/Library\/Apple\/)/;
export const isSysteem = (cmd) => SYSTEEM.test(String(cmd));

/**
 * De CPU-poort (H7): boven `grens` (kern) stopt een ANDER proces de meting;
 * een systeemproces niet, dat is achtergrond (vastgelegd, geen stop). Elke rij
 * krijgt `systeem: true/false`.
 */
export function cpuPoort(top, grens = VREEMD_KERN) {
  const rij = (t) => ({ pid: t.pid, kern: +t.kern.toFixed(3), cmd: t.cmd, systeem: isSysteem(t.cmd) });
  const boven = top.filter((t) => t.kern > grens).map(rij);
  return { ander: boven.filter((t) => !t.systeem), achtergrond: boven.filter((t) => t.systeem), top5: top.slice(0, 5).map(rij) };
}

/**
 * Een korte naam voor een regel: de naam van het programma (een pad mag spaties
 * hebben, "Google Chrome") en van padargumenten de laatste twee stukken:
 * mediaanalysisd · node test/x.test.mjs · Google Chrome Helper.
 */
export function kortNaam(cmd) {
  const [prog, ...args] = String(cmd).split(' --')[0].split(' /');
  const naam = prog.startsWith('/') ? prog.split('/').pop() : prog;
  return [naam, ...args.map((a) => a.split('/').slice(-2).join('/'))].join(' ');
}

/** Het audioproces van Clay's Chrome (/Applications/Google Chrome.app), of null. */
export function claysAudio(rijen) {
  return rijen.find((r) => r.cmd.includes('/Applications/Google Chrome.app/') && r.cmd.includes('--utility-sub-type=audio.mojom.AudioService')) || null;
}

/** De versie van Clay's Chrome uit het pad van een helper, of null. */
export function claysChromeVersie(rijen) {
  for (const r of rijen) {
    const m = r.cmd.match(/\/Applications\/Google Chrome\.app\/.*?\/Versions\/([\d.]+)\//);
    if (m) return m[1];
  }
  return null;
}

/** De omgevingsvariabelen van de server die een PAD zijn: in een proefserver allemaal in de tijdelijke map. */
export const PROEF_PADEN = ['VARVE_DB', 'VARVE_MEDIA', 'VARVE_OPNAMES', 'VARVE_PATRONEN', 'VARVE_PLANNEN', 'VARVE_PROEF',
  'VARVE_KAART', 'VARVE_KAART_DB', 'VARVE_BACKUPS', 'VARVE_NACHT'];

/**
 * De omgeving van een proefserver (ook voor zaalbeeld.mjs): ALLES in `tmp`, ook
 * wat de server alleen leest als het gezet is (backups, nacht), zodat een geërfde
 * VARVE_BACKUPS nooit in Clay's echte backupmap schrijft of daar dunt
 * (server/backup.js). Geen extra hosts (VARVE_HOSTS), geen heranalyse, de nep-yt-dlp.
 */
export function proefEnv(tmp, poort, ytdlp, basis = process.env) {
  return {
    ...basis, PORT: String(poort), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_KAART: join(tmp, 'geen-kaart.json'), VARVE_KAART_DB: join(tmp, 'kaart.db'),
    VARVE_BACKUPS: join(tmp, 'backups'), VARVE_NACHT: join(tmp, 'nacht.json'), VARVE_HOSTS: '',
    VARVE_YTDLP: ytdlp, VARVE_HERANALYSE: 'uit',
  };
}

// ---- puur: verdelingen en oordelen -------------------------------------------------

/** n, min, p10, p50, p90, p99, max en gemiddelde van een lijst getallen (of null als hij leeg is). */
export function verdeling(lijst) {
  const s = (lijst || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const p = (q) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  return { n: s.length, min: s[0], p10: p(0.1), p50: p(0.5), p90: p(0.9), p99: p(0.99), max: s[s.length - 1],
    gem: s.reduce((a, b) => a + b, 0) / s.length };
}

/**
 * Een rAF-reeks (ms tussen twee beelden) als fps: p50 en p10 (het tiende
 * percentiel van de FPS = het negentigste van de beeldtijd), en de beeldtijd p99.
 */
export function rafSamenvatting(deltas) {
  const v = verdeling((deltas || []).filter((d) => d > 0));
  if (!v) return null;
  return { beelden: v.n, fpsP50: 1000 / v.p50, fpsP10: 1000 / v.p90, msP50: v.p50, msP99: v.p99, msMax: v.max };
}

/**
 * Zegt kwInfo() van de Stroommachine iets? Alleen met de fps-meter aan
 * (&fps): zonder schrijft niemand KW.ms en blijft hij 16,7 (H1). Dus: elk
 * monster fps === true, en ms niet in elk monster hetzelfde.
 */
export function fpsOordeel(monsters) {
  const m = (monsters || []).filter(Boolean);
  if (!m.length) return { ok: false, tekst: 'geen kwInfo-monsters' };
  if (!m.every((k) => k.fps === true)) {
    return { ok: false, tekst: 'de fps-meter van de Stroommachine staat uit (kwInfo().fps !== true): zonder &fps blijft ms 16,7 en zegt hij niets (H1)' };
  }
  const ms = [...new Set(m.map((k) => k.ms))];
  if (m.length > 1 && ms.length < 2) return { ok: false, tekst: `kwInfo().ms is in elk monster ${ms[0]}: de meter rekent niet (H1)` };
  return { ok: true, tekst: `fps-meter aan, ms ${ms.slice(0, 4).join(' · ')}${ms.length > 4 ? ' …' : ''}` };
}

/** De hartslag als tekst: nooit "geen gaten", altijd met de meter erbij (W6). */
export function hartTekst(hart, controleOk) {
  if (!hart) return 'hartslag: niet gelezen';
  return `hartslag max ${hart.max} ms, ${hart.n15} gat${hart.n15 === 1 ? '' : 'en'} > ${GAT_MS} ms in ${hart.n} blokken`
    + ` (meter: worklet; positieve controle ${controleOk === true ? 'geslaagd' : controleOk === false ? 'MISLUKT' : 'nog niet gedraaid'})`;
}

/** Per stand het verschil met het gemiddelde van de omliggende nul-standen (ontwerp §4.10). */
export function tegenNul(resultaten, sleutel) {
  const waarde = (r) => sleutel(r);
  return resultaten.map((r, i) => {
    if (r.stand === 'nul') return null;
    const voor = resultaten.slice(0, i).reverse().find((x) => x.stand === 'nul');
    const na = resultaten.slice(i + 1).find((x) => x.stand === 'nul');
    const nul = [voor, na].filter(Boolean).map(waarde).filter(Number.isFinite);
    const v = waarde(r);
    if (!nul.length || !Number.isFinite(v)) return { stand: r.stand, verschil: null };
    return { stand: r.stand, verschil: v - nul.reduce((a, b) => a + b, 0) / nul.length };
  }).filter(Boolean);
}

// ---- in de pagina ------------------------------------------------------------------

/** De hartslag: per process() de wandklok; het grootste gat en het aantal > GAT_MS. Afvalvrij. */
export const HART_CODE = `class VarveHart extends AudioWorkletProcessor {
  constructor() { super(); this.v = 0; this.max = 0; this.n15 = 0; this.n = 0;
    this.port.onmessage = () => { this.port.postMessage({ max: this.max, n15: this.n15, n: this.n }); this.max = 0; this.n15 = 0; this.n = 0; }; }
  process() { const t = Date.now(); if (this.v) { const g = t - this.v; if (g > this.max) this.max = g; if (g > ${GAT_MS}) this.n15++; } this.v = t; this.n++; return true; }
}
registerProcessor('varve-hart', VarveHart);`;

/** Op bevel N ms de renderthread blokkeren: de positieve controle. */
export const STAL_CODE = `class VarveStal extends AudioWorkletProcessor {
  constructor() { super(); this.stal = 0; this.port.onmessage = (e) => { this.stal = e.data; }; }
  process() { if (this.stal) { const t = Date.now(); while (Date.now() - t < this.stal) {} this.port.postMessage(Date.now() - t); this.stal = 0; } return true; }
}
registerProcessor('varve-stal', VarveStal);`;

/**
 * De meters in een pagina, op de AudioContext `ctxExpr` (in VARVE engine.ctx):
 * de hartslag (gain 0 naar de uitgang), een rAF-meter en elke 250 ms de drift
 * van getOutputTimestamp en document.visibilityState. Alleen via het
 * DevTools-protocol, nooit in de app zelf.
 */
export const METERS = (ctxExpr) => `(async () => {
  if (window.__meet) return 'al';
  const c = ${ctxExpr};
  if (!c || !c.audioWorklet || typeof c.audioWorklet.addModule !== 'function') throw new Error('geen audioWorklet op ${ctxExpr.replace(/'/g, '')}');
  await c.resume().catch(() => {});
  const url = URL.createObjectURL(new Blob([${JSON.stringify(HART_CODE)}], { type: 'text/javascript' }));
  await c.audioWorklet.addModule(url);
  const hb = new AudioWorkletNode(c, 'varve-hart');
  const g0 = new GainNode(c, { gain: 0 });
  hb.connect(g0).connect(c.destination);
  const m = window.__meet = { raf: [], drift: [], zicht: [], hb, g0 };
  m.hartLees = () => new Promise((klaar) => {
    const t = setTimeout(() => klaar(null), 2000);
    hb.port.onmessage = (e) => { clearTimeout(t); klaar(e.data); };
    hb.port.postMessage(0);
  });
  let vorige = performance.now();
  const lus = (t) => { m.raf.push(t - vorige); vorige = t; requestAnimationFrame(lus); };
  requestAnimationFrame(lus);
  m.klok = setInterval(() => {
    const o = c.getOutputTimestamp();
    if (o.performanceTime) m.drift.push([+performance.now().toFixed(1), +(o.performanceTime - o.contextTime * 1000).toFixed(2)]);
    m.zicht.push(document.visibilityState);
  }, 250);
  m.neem = () => ({ raf: m.raf.splice(0), drift: m.drift.splice(0), zicht: m.zicht.splice(0), staat: c.state });
  return c.state;
})()`;

/**
 * De positieve controle: een APARTE AudioContext met de hartslag en de
 * blokkeerder; blokkeer ms; geeft { rust, gat, gestald }. Ziet de hartslag het
 * gat niet (gat.max < ms), dan is de meter blind.
 */
export const POSITIEVE_CONTROLE = (ms = CONTROLE_MS) => `(async () => {
  const c = new AudioContext();
  await c.resume().catch(() => {});
  const url = URL.createObjectURL(new Blob([${JSON.stringify(`${HART_CODE}\n${STAL_CODE}`)}], { type: 'text/javascript' }));
  await c.audioWorklet.addModule(url);
  const g0 = new GainNode(c, { gain: 0 }); g0.connect(c.destination);
  const hb = new AudioWorkletNode(c, 'varve-hart'); hb.connect(g0);
  const st = new AudioWorkletNode(c, 'varve-stal'); st.connect(g0);
  const wacht = (n) => new Promise((r) => setTimeout(r, n));
  const lees = () => new Promise((klaar) => {
    const t = setTimeout(() => klaar(null), 2000);
    hb.port.onmessage = (e) => { clearTimeout(t); klaar(e.data); };
    hb.port.postMessage(0);
  });
  await wacht(400); await lees();          // het opstarten telt niet
  await wacht(800); const rust = await lees();
  const gestald = new Promise((klaar) => { st.port.onmessage = (e) => klaar(e.data); });
  st.port.postMessage(${ms});
  const echt = await Promise.race([gestald, wacht(2000).then(() => null)]);
  await wacht(300); const gat = await lees();
  const staat = c.state;
  await c.close();
  return { rust, gat, gestald: echt, staat };
})()`;

/** Een rAF-meter in de Stroommachine-tab: alleen tijdstempels. */
export const RAF_METER = `(() => { if (window.__meetS) return 'al'; const m = window.__meetS = []; let v = performance.now();
  const lus = (t) => { m.push(t - v); v = t; requestAnimationFrame(lus); }; requestAnimationFrame(lus); return 'ok'; })()`;

export const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';
const RENDERER = `(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); if (!gl) return 'geen webgl2';
  const d = gl.getExtension('WEBGL_debug_renderer_info'); return String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); })()`;

// ---- processen, poorten, Chrome ------------------------------------------------------

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

/** Staat er iets op deze poort (127.0.0.1)? */
export const poortBezet = (poort) => new Promise((r) => {
  const s = createConnection({ host: '127.0.0.1', port: poort });
  s.once('connect', () => { s.destroy(); r(true); });
  s.once('error', () => r(false));
});

export const psNu = () => leesPs(spawnSync('ps', ['-axo', 'pid=,ppid=,cputime=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout);

/** De volledige Chrome for Testing (niet de headless shell: alleen daar is een tabblad echt zichtbaar of verborgen). */
export function zoekChrome(eigen = null) {
  if (eigen) return eigen;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) throw new Error(`geen Playwright-cache in ${cache} (zet VARVE_CHROME)`);
  const map = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const pad = map && join(cache, map, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  if (!pad || !existsSync(pad)) throw new Error(`geen Chrome for Testing gevonden in ${cache} (zet VARVE_CHROME)`);
  return pad;
}

/** Versie uit Info.plist van de .app rond een Chrome-binary (of null). */
function chromeVersie(binary) {
  const plist = resolve(binary, '../../Info.plist');
  if (!existsSync(plist)) return null;
  const r = spawnSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };

/** Wat de machine nu doet: model, belasting, accu, lader, Low Power Mode. */
function machineNu(warmte) {
  const batt = sh('pmset', ['-g', 'batt']) || '';
  const ac = sh('pmset', ['-g', 'ac']) || '';
  const lpm = (sh('pmset', ['-g']) || '').match(/lowpowermode\s+(\d)/);
  return {
    model: sh('sysctl', ['-n', 'hw.model']),
    kernen: Number(sh('sysctl', ['-n', 'hw.ncpu'])) || null,
    loadavg: sh('sysctl', ['-n', 'vm.loadavg']),
    stroom: (batt.match(/drawing from '([^']+)'/) || [])[1] || null,
    accu: Number((batt.match(/(\d+)%/) || [])[1]) || null,
    laadt: /charging;/.test(batt) && !/discharging/.test(batt),
    watt: Number((ac.match(/Wattage = (\d+)W/) || [])[1]) || null,
    lowPowerMode: lpm ? lpm[1] === '1' : null,
    warmte: warmte ? sh(warmte, []) : null,
  };
}

/** warmte.swift naar een binary in tmp (ProcessInfo.thermalState); null als swiftc er niet is. */
function maakWarmte(tmp) {
  const uit = join(tmp, 'warmte');
  const r = spawnSync('swiftc', ['-O', join(WORTEL, 'tools/headless/warmte.swift'), '-o', uit], { encoding: 'utf8', timeout: 60000 });
  return r.status === 0 && existsSync(uit) ? uit : null;
}

/** Geluid uit de Mac (een audio-out-assertie van coreaudiod)? Geeft de regels. */
function geluidUit() {
  return (sh('pmset', ['-g', 'assertions']) || '').split('\n').filter((l) => /audio-out/i.test(l)).map((l) => l.trim());
}

/**
 * Eén Chrome via het DevTools-protocol op browserniveau (zoals beamer.mjs):
 * pagina's als sessies, nieuwe vensters (het losse venster) automatisch
 * gekoppeld, uitzonderingen per sessie geteld.
 */
export class Chrome {
  constructor(naam, debug) {
    this.naam = naam; this.debug = debug; this.volg = 0; this.wachtend = new Map();
    this.fouten = new Map(); this.nieuw = []; this.versie = null;
  }
  async verbind(ms = 20000) {
    let v = null;
    for (const eind = Date.now() + ms; !v && Date.now() < eind;) {
      v = await fetch(`http://127.0.0.1:${this.debug}/json/version`).then((r) => r.json()).catch(() => null);
      if (!v) await wacht(150);
    }
    if (!v) throw new Error(`${this.naam}: geen DevTools op 127.0.0.1:${this.debug}`);
    this.versie = v.Browser;
    this.ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((ok, fout) => { this.ws.addEventListener('open', ok); this.ws.addEventListener('error', () => fout(new Error(`${this.naam}: WebSocket faalt`))); });
    this.ws.addEventListener('message', (e) => this._bericht(JSON.parse(e.data)));
  }
  _bericht(m) {
    if (m.id && this.wachtend.has(m.id)) {
      const w = this.wachtend.get(m.id); this.wachtend.delete(m.id);
      if (m.error) w.fout(new Error(`${m.error.message}${m.error.data ? `: ${m.error.data}` : ''}`)); else w.ok(m.result);
      return;
    }
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo, waitingForDebugger } = m.params;
      (async () => {
        if (targetInfo.type === 'page') {
          await this.cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI }, sessionId).catch(() => {});
          await this.cdp('Runtime.enable', {}, sessionId).catch(() => {});
        }
        if (waitingForDebugger) await this.cdp('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
        this.nieuw.push({ sessionId, ...targetInfo });
      })();
    }
    if (m.method === 'Runtime.exceptionThrown' && m.sessionId) {
      const d = m.params.exceptionDetails;
      if (!this.fouten.has(m.sessionId)) this.fouten.set(m.sessionId, []);
      this.fouten.get(m.sessionId).push(d.exception?.description?.split('\n')[0] || d.text);
    }
  }
  cdp(method, params = {}, sessionId) {
    const id = ++this.volg;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fout) => this.wachtend.set(id, { ok, fout }));
  }
  /** De eerste pagina als sessie, met Page en Runtime aan. */
  async pagina() {
    const { targetInfos } = await this.cdp('Target.getTargets');
    const doel = targetInfos.find((t) => t.type === 'page');
    if (!doel) throw new Error(`${this.naam}: geen pagina`);
    const { sessionId } = await this.cdp('Target.attachToTarget', { targetId: doel.targetId, flatten: true });
    await this.cdp('Page.enable', {}, sessionId);
    await this.cdp('Runtime.enable', {}, sessionId);
    return sessionId;
  }
  async ev(sid, expr, gebaar = false) {
    const r = await this.cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gebaar }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
    return r.result.value;
  }
  /** Wachten tot `expr` iets waars geeft (hooguit ms); geeft de laatste waarde. */
  async tot(sid, expr, ms = 20000, stap = 200) {
    let v = null;
    for (const eind = Date.now() + ms; Date.now() < eind;) {
      v = await this.ev(sid, expr).catch(() => null);
      if (v) return v;
      await wacht(stap);
    }
    return v;
  }
  /** Een schermafdruk; `clip` = { x, y, width, height, scale? } voor een uitsnede (CSS-px). */
  async foto(sid, pad, clip = null) {
    const { data } = await this.cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { scale: 1, ...clip } } : {}) }, sid);
    writeFileSync(pad, Buffer.from(data, 'base64'));
  }
  sluit() { try { this.ws?.close(); } catch (_) {} }
}

// ---- uitvoer -----------------------------------------------------------------------

const checks = [];
/**
 * Na een signaal (Ctrl-C, kill) of een onverwachte fout ruimt `dood()` op en sluit af.
 * Intussen loopt de hoofdlus nog even door tegen een Chrome die al weg is; wat die dan
 * nog meldt, is geen uitkomst. ok() en info() zwijgen dan, het hoofdprogramma laat de
 * exitcode aan dood() (review 2, punt 4: een misleidende FAIL-regel na Ctrl-C).
 * Ook voor zaalbeeld.mjs.
 */
let afgebroken = false;
export const isAfgebroken = () => afgebroken;
export const ok = (naam, cond, extra = '') => {
  if (afgebroken) return;
  checks.push({ naam, ok: !!cond, extra: typeof extra === 'string' ? extra : JSON.stringify(extra) });
  console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra !== '' ? ` (${typeof extra === 'string' ? extra : JSON.stringify(extra)})` : ''}`);
};
const info = (tekst) => { if (!afgebroken) console.log(`  ..  ${tekst}`); };
const n1 = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '–');

// ---- processen die wij starten, en opruimen -------------------------------------------

const processen = [];
/** Een kind in een EIGEN procesgroep (detached), zodat opruimen de hele familie raakt. Ook voor zaalbeeld.mjs. */
export function start(cmd, args, opties = {}) {
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true, ...opties });
  p.on('error', () => {});
  processen.push(p);
  return p;
}
export function stopAlles() {
  for (const p of processen) {
    if (p.exitCode !== null || p.signalCode !== null) continue;
    try { process.kill(-p.pid, 'SIGTERM'); } catch (_) { try { p.kill('SIGTERM'); } catch (__) {} }
  }
}
export async function wachtTotWeg(ms = 5000) {
  for (const eind = Date.now() + ms; Date.now() < eind;) {
    if (processen.every((p) => p.exitCode !== null || p.signalCode !== null)) return true;
    await wacht(100);
  }
  for (const p of processen) if (p.exitCode === null && p.signalCode === null) { try { process.kill(-p.pid, 'SIGKILL'); } catch (_) {} }
  return false;
}
let signaalGezet = false;
const naStop = [];
/**
 * Ctrl-C, kill, een uitzondering: alle kinderen (hun hele procesgroep) stoppen,
 * hooguit 1,5 s wachten (daarna SIGKILL), dan `bijStop` (de tijdelijke map weg)
 * en eruit. Een tweede signaal tijdens het wachten: meteen SIGKILL en eruit.
 * Zonder dit bleven na Ctrl-C de Chromes en de server draaien (eigen procesgroep;
 * review 10 okt).
 */
export function zetSignalen(bijStop = null) {
  if (bijStop) naStop.push(bijStop);
  if (signaalGezet) return;
  signaalGezet = true;
  let bezig = false;
  const dood = async (code, reden) => {
    if (bezig) {
      for (const p of processen) { try { process.kill(-p.pid, 'SIGKILL'); } catch (_) {} }
      process.exit(code);
    }
    bezig = true;
    afgebroken = true;
    console.error(`\n${reden}: alles van deze meting stoppen`);
    stopAlles();
    await wachtTotWeg(1500);
    for (const f of naStop) { try { f(); } catch (_) {} }
    console.error(`afgebroken: opgeruimd, exit ${code}`);
    process.exit(code);
  };
  process.on('SIGINT', () => dood(130, 'SIGINT'));
  process.on('SIGTERM', () => dood(143, 'SIGTERM'));
  process.on('uncaughtException', (e) => dood(1, `uitzondering: ${e.message}`));
  process.on('unhandledRejection', (e) => dood(1, `onafgehandeld: ${e?.message ?? e}`));
}

/**
 * Welke processen --opruimen zou stoppen: een PAD met ons tmp-voorvoegsel in de
 * argumenten (de Chromes: --user-data-dir=…/varve-beeld-lokaal-…; de proefserver:
 * --meting=…/varve-beeld-lokaal-…, want zijn tmp-paden staan alleen in zijn env en
 * die toont ps niet), of node met varve-relay.js op onze poort (`relayPoort` null:
 * geen relay, zoals in zaalbeeld.mjs). Nooit een shell (een `pgrep -f varve-beeld-lokaal-`
 * in zsh droeg de tekst ook, zelftest 10 okt) en nooit dit proces of wie het startte.
 */
export function teOpruimen(rijen, relayPoort = 7712, zelf = process.pid, voorvoegsel = VOORVOEGSEL) {
  const ouder = new Map(rijen.map((r) => [r.pid, r.ppid]));
  const voorouders = new Set();
  for (let p = zelf; p && !voorouders.has(p); p = ouder.get(p)) voorouders.add(p);
  const relay = relayPoort ? new RegExp(`^\\S*node\\S*\\s+\\S*varve-relay\\.js\\s+${relayPoort}(\\s|$)`) : null;
  const shell = /^(\S*\/)?-?(z|ba|da|fi|k|tc)?sh(\s|$)/;
  return rijen.filter((r) => !voorouders.has(r.pid) && !shell.test(r.cmd)
    && (r.cmd.includes(`/${voorvoegsel}`) || (relay && relay.test(r.cmd))));
}

/**
 * --opruimen (ook voor zaalbeeld.mjs): SIGTERM naar de WORTELS van wat teOpruimen
 * vindt (de browser, de server, de relay), zodat Chrome zijn helpers zelf
 * afsluit; wie na 3 s nog leeft (opnieuw gezocht: een pid wordt niet blind
 * hergebruikt, en een helper die Chrome intussen opnieuw startte telt mee) krijgt
 * SIGKILL. Eerst alles tegelijk SIGTERM liet Chrome zijn helpers herstarten en
 * bleef de browser leven (proef 10 okt, na kill -9 van zaalbeeld.mjs).
 */
export async function ruimOp(relayPoort = 7712, voorvoegsel = VOORVOEGSEL) {
  const lijst = teOpruimen(psNu(), relayPoort, process.pid, voorvoegsel);
  if (!lijst.length) { console.log('niets van deze meting gevonden'); return 0; }
  const pids = new Set(lijst.map((r) => r.pid));
  const wortels = lijst.filter((r) => !pids.has(r.ppid));
  for (const r of wortels) {
    console.log(`stop ${r.pid} ${kortCmd(r.cmd)}`);
    try { process.kill(r.pid, 'SIGTERM'); } catch (e) { console.log(`  kon niet: ${e.message}`); }
  }
  if (lijst.length > wortels.length) console.log(`  (${lijst.length - wortels.length} helper(s) gaan mee met hun ouder)`);
  let over = lijst;
  for (let i = 0; i < 30 && over.length; i++) { await wacht(100); over = teOpruimen(psNu(), relayPoort, process.pid, voorvoegsel); }
  for (const r of over) {
    console.log(`hard stop ${r.pid} ${kortCmd(r.cmd)} (na 3 s nog niet weg)`);
    try { process.kill(r.pid, 'SIGKILL'); } catch (_) {}
  }
  return 0;
}

// ---- vooraf: de controles van punt 2 ---------------------------------------------------

/**
 * De controles vóór er iets start. `volledig`: ook de audio-gate en de
 * CPU-gate laten stoppen (de zelftest meldt alleen wat ze zouden doen).
 * Geeft { stop: [redenen], vooraf, warmte, chromePad }.
 */
async function vooraf(o, tmp, { volledig }) {
  const stop = [];
  const vooraf = {};
  console.log('vooraf');
  const heeftS = existsSync(join(o.repo, 'index.html')) && existsSync(join(o.repo, 'tools/varve-relay.js'));
  ok('de Stroommachine-repo is er (index.html, tools/varve-relay.js)', heeftS, o.repo);
  if (!heeftS) stop.push(`geen Stroommachine in ${o.repo} (zet VARVE_STROOM_REPO)`);
  const poorten = [o.relay, o.poort, o.debugStroom, o.debugVarve];
  const bezet = [];
  for (const p of poorten) if (await poortBezet(p)) bezet.push(p);
  ok(`poorten ${poorten.join(', ')} zijn vrij`, !bezet.length, bezet.length ? `bezet: ${bezet.join(', ')}` : '');
  if (bezet.length) stop.push(`poort ${bezet.join(', ')} is bezet (een vorige run? node tools/headless/beeld-lokaal.mjs --opruimen)`);
  let chromePad = null;
  try { chromePad = zoekChrome(o.chrome); } catch (e) { stop.push(e.message); }
  ok('Chrome for Testing gevonden (niet de headless shell)', !!chromePad && !/headless.shell/i.test(chromePad), chromePad ? chromeVersie(chromePad) ?? chromePad : 'niet gevonden');
  vooraf.cft = chromePad ? chromeVersie(chromePad) : null;

  // Geluid uit de Mac en Clay's audioproces (H9).
  const geluid = geluidUit();
  vooraf.geluid = geluid;
  if (volledig && geluid.length && !o.forceer) stop.push(`er komt geluid uit de Mac (pmset audio-out): ${geluid[0]}`);
  else if (geluid.length) info(`geluid uit de Mac (pmset audio-out)${volledig ? ', VARVE_BL_FORCEER=1' : ''}: ${geluid.length} assertie(s)`);
  else info('geen audio-out-assertie (er speelt niets)');

  // De warmtemeter, terwijl de CPU 5 s gemeten wordt (beide ~5 s).
  const ps0 = psNu();
  const audio0 = claysAudio(ps0);
  vooraf.claysChrome = claysChromeVersie(ps0);
  const t0 = performance.now();
  const warmte = await new Promise((r) => setImmediate(() => r(maakWarmte(tmp))));
  const rest = 5000 - (performance.now() - t0);
  if (rest > 0) await wacht(rest);
  const ps1 = psNu();
  const dt = (performance.now() - t0) / 1000;
  const eigen = boom(ps1, process.pid);
  const poort = cpuPoort(topGebruikers(ps0, ps1, dt, eigen));
  vooraf.top5 = poort.top5;
  for (const t of vooraf.top5) info(`top: ${n1(t.kern * 100, 0)} % van een kern · pid ${t.pid} · ${t.cmd}${t.systeem ? ' (systeem)' : ''}`);
  vooraf.achtergrond = poort.achtergrond;
  vooraf.vreemd = poort.ander;
  if (poort.achtergrond.length) {
    info(`achtergrond (systeem, houdt de meting niet tegen): ${poort.achtergrond.map((t) => `${kortNaam(t.cmd)} ${n1(t.kern * 100, 0)} %`).join(' · ')}`);
  }
  if (poort.ander.length) {
    const v = poort.ander[0];
    const tekst = `${poort.ander.length} ander(e) proces(sen) boven ${VREEMD_KERN * 100} % van een kern, o.a. pid ${v.pid} (${n1(v.kern * 100, 0)} %, ${v.cmd})`;
    if (volledig && !o.forceer) stop.push(`${tekst} (H7; VARVE_BL_FORCEER=1 om toch te meten, zie tools/README.md)`);
    else info(`${volledig ? 'GEFORCEERD: ' : 'zou stoppen bij een volledige run: '}${tekst}`);
  }
  const audio1 = audio0 ? ps1.find((r) => r.pid === audio0.pid) : null;
  vooraf.claysAudio = audio0 ? { pid: audio0.pid, cputime: audio0.cpu, perVijfS: audio1 ? +((audio1.cpu - audio0.cpu) * 5 / dt).toFixed(3) : null } : null;
  if (audio0) {
    info(`audioproces van Clay's Chrome ${vooraf.claysChrome ?? ''}: pid ${audio0.pid}, cputime ${n1(audio0.cpu, 2)} s, ${n1(vooraf.claysAudio.perVijfS, 2)} s per 5 s`);
    if (volledig && vooraf.claysAudio.perVijfS > AUDIO_KLAAG_S && !o.forceer) stop.push(`het audioproces van Clay's Chrome rekent (${vooraf.claysAudio.perVijfS} s per 5 s): speelt er iets?`);
  } else info('geen audioproces van Clay\'s Chrome gevonden: geen bewaking tijdens de run');
  info(warmte ? `warmte: ${sh(warmte, [])}` : 'warmte: niet gemeten (geen swiftc)');
  vooraf.machine = machineNu(warmte);
  info(`machine: ${vooraf.machine.model}, ${vooraf.machine.kernen} kernen, load ${vooraf.machine.loadavg}, ${vooraf.machine.stroom ?? '?'} ${vooraf.machine.watt ?? '?'} W, accu ${vooraf.machine.accu ?? '?'} %${vooraf.machine.laadt ? ' (laadt)' : ''}, Low Power Mode ${vooraf.machine.lowPowerMode ? 'aan' : 'uit'}`);
  return { stop, vooraf, warmte, chromePad };
}

// ---- zelftest -------------------------------------------------------------------------

async function zelftest(o) {
  const t0 = performance.now();
  const tmp = mkdtempSync(join(tmpdir(), VOORVOEGSEL));
  zetSignalen(() => { if (!o.bewaar) rmSync(tmp, { recursive: true, force: true }); });
  let srv = null, chrome = null, uitslag = null;
  const json = { soort: 'zelftest', datum: new Date().toISOString(), opties: { ...o } };
  try {
    const v = await vooraf(o, tmp, { volledig: false });
    json.vooraf = v.vooraf;
    ok('de controles van punt 2 laten de volledige run starten (los van audio- en CPU-gate)', !v.stop.length, v.stop.join(' · '));
    ok('warmtemeter gecompileerd (swiftc -O warmte.swift)', !!v.warmte, v.warmte ? sh(v.warmte, []) : 'niet gemeten');

    // De fps-logica op een nep-kwInfo (H1).
    console.log('\nfps-logica op een nep-kwInfo');
    const uit1 = fpsOordeel([{ fps: false, ms: 16.7 }, { fps: false, ms: 16.7 }]);
    ok('{fps:false} geeft de FAIL-tekst "fps-meter staat uit"', !uit1.ok && /fps-meter van de Stroommachine staat uit/.test(uit1.tekst), uit1.tekst);
    const uit2 = fpsOordeel([{ fps: true, ms: 16.7 }, { fps: true, ms: 16.9 }]);
    ok('{fps:true, ms:[16,7, 16,9]} is ok', uit2.ok, uit2.tekst);
    const uit3 = fpsOordeel([{ fps: true, ms: 16.7 }, { fps: true, ms: 16.7 }, { fps: true, ms: 16.7 }]);
    ok('fps aan maar ms constant 16,7 is GEEN ok (de meter rekent niet)', !uit3.ok, uit3.tekst);

    // De hartslag en de positieve controle in een stille headless Chrome.
    // NIET op file:// (dan is de Blob-URL blob:null en weigert addModule hem):
    // een eigen http-server op 127.0.0.1, zoals VARVE op http://localhost draait.
    console.log('\nhartslag in een stille headless Chrome (geen GPU, --mute-audio)');
    srv = createServer((q, a) => { a.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); a.end('<!doctype html><title>beeld-lokaal zelftest</title><p>stil</p>'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const pagina = `http://127.0.0.1:${srv.address().port}/p.html`;
    if (!v.chromePad) throw new Error('geen Chrome for Testing');
    const cp = start(v.chromePad, ['--headless=new', `--remote-debugging-port=${o.debugStroom}`, `--user-data-dir=${join(tmp, `profiel-${o.debugStroom}`)}`,
      '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
      '--window-size=640,360', 'about:blank']);
    chrome = new Chrome('zelftest', o.debugStroom);
    await chrome.verbind();
    const sid = await chrome.pagina();
    await chrome.cdp('Page.navigate', { url: pagina }, sid);
    await chrome.tot(sid, "document.readyState === 'complete'", 10000);
    const staat = await chrome.ev(sid, `(async () => { window.__ctx = new AudioContext(); await window.__ctx.resume().catch(() => {}); return (${METERS('window.__ctx')}); })()`).catch((e) => `FOUT ${e.message}`);
    ok('de meters laden in een AudioContext via een Blob-URL (A10, op http)', staat === 'running', staat);
    await wacht(400);
    await chrome.ev(sid, 'window.__meet.hartLees()').catch(() => null);      // het opstarten telt niet als rust
    await chrome.ev(sid, 'window.__meet.neem(); true').catch(() => null);
    await wacht(1200);
    const rust = await chrome.ev(sid, 'window.__meet.hartLees()').catch(() => null);
    const reeks = await chrome.ev(sid, 'window.__meet.neem()').catch(() => null);
    ok('de hartslag telt blokken (process() loopt)', !!rust && rust.n > 100, rust ? `${rust.n} blokken, max ${rust.max} ms, ${rust.n15} > ${GAT_MS} ms`
      + (rust.n === 0 ? ' — de audioklok staat stil: geen audio-uitgang (de klep van de MacBook dicht?)' : '') : 'niets');
    const raf = rafSamenvatting(reeks?.raf);
    ok('de rAF-meter loopt', !!raf && raf.beelden > 10, raf ? `${raf.beelden} beelden, p50 ${n1(raf.fpsP50)} fps` : 'geen beelden');
    ok('document.visibilityState is visible in elk monster (H16)', !!reeks?.zicht?.length && reeks.zicht.every((z) => z === 'visible'), reeks ? `${reeks.zicht.length} monsters` : '');
    ok('de drift van getOutputTimestamp wordt gelezen (derde kolom, geen criterium)', Array.isArray(reeks?.drift), reeks ? `${reeks.drift.length} monsters` : '');
    const pc = await chrome.ev(sid, POSITIEVE_CONTROLE(CONTROLE_MS)).catch((e) => ({ fout: e.message }));
    json.positieveControle = pc;
    const gezien = !!pc?.gat && pc.gat.max >= CONTROLE_MS;
    ok(`hartslag ziet een gat van ${CONTROLE_MS} ms`, gezien, pc?.fout ?? (pc?.gat ? `max ${pc.gat.max} ms (rust ${pc.rust?.max ?? '?'} ms), geblokkeerd ${pc.gestald} ms` : 'niets gelezen'));
    json.hart = { rust, raf, controle: pc };
    console.log(`  ..  ${hartTekst(rust, gezien)}`);
    chrome.sluit(); chrome = null;
    stopAlles();
    await wachtTotWeg();
    srv.close(); srv = null;

    // Opruimen: niets van ons blijft over.
    console.log('\nopruimen');
    await wacht(300);
    ok(`na afloop luistert niets op ${o.debugStroom}`, !(await poortBezet(o.debugStroom)));
    const over = teOpruimen(psNu(), o.relay);
    ok('geen proces van deze meting over (tmp-voorvoegsel, relay op onze poort)', !over.length, over.map((r) => `${r.pid} ${kortCmd(r.cmd)}`).join(' · '));
    ok('de Chrome van de zelftest is gestopt', cp.exitCode !== null || cp.signalCode !== null);
    const duur = (performance.now() - t0) / 1000;
    ok('zelftest binnen 20 s', duur <= 20, `${n1(duur)} s`);
    json.duurS = +duur.toFixed(1);
  } catch (e) {
    ok('zelftest liep zonder uitzondering', false, e.message);
  } finally {
    chrome?.sluit();
    stopAlles();
    await wachtTotWeg();
    srv?.close();
    json.checks = checks;
    mkdirSync(o.uit, { recursive: true });
    writeFileSync(join(o.uit, 'beeld-lokaal-zelftest.json'), JSON.stringify(json, null, 1));
    if (!o.bewaar) rmSync(tmp, { recursive: true, force: true });
    uitslag = checks.filter((c) => !c.ok).length;
    if (!afgebroken) console.log(`\n${checks.length} checks, ${uitslag ? `${uitslag} FAIL` : 'alles ok'} — ${join(o.uit, 'beeld-lokaal-zelftest.json')}`);
  }
  return uitslag ? 1 : 0;
}

// ---- de volledige run -----------------------------------------------------------------

/** Clay-last in VARVE (ontwerp §4.5): vier tracks waar het kan, stems, keylock, sends, rack, filterzwaai. */
const CLAY_LAST = `(async () => {
  const a = await import('/src/control/actions.js');
  const { geheugenHaal } = await import('/src/engine/bron.js');
  const wacht = (n) => new Promise((r) => setTimeout(r, n));
  const notities = [];
  const laadDemo = async (deck) => {
    window.engine.setFocus(deck);
    document.querySelector('#focus-deck .demo-btn')?.click();
    for (let i = 0; i < 100; i++) { if (window.engine.deck(deck).title?.startsWith('demo')) break; await wacht(200); }
    const d = window.engine.deck(deck);
    if (!d.title?.startsWith('demo')) return false;
    d.setGrid({ bpm: 124, firstBeat: 0 });
    d.loop = { start: 0, end: 32 * 60 / 124 };
    return true;
  };
  // Vier stems van 3 s, elk een eigen toon (de fixture van stemkanalen.mjs).
  const SR = 48000, TONEN = { drums: 2000, bass: 2700, other: 3600, vocals: 5100 }, NAMEN4 = ['drums', 'bass', 'other', 'vocals'];
  const stemsWav = () => {
    const paren = NAMEN4.map((nm) => { const x = new Float32Array(SR * 3); for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin(2 * Math.PI * TONEN[nm] * i / SR); return [x, x]; });
    const n = paren[0][0].length, ch = paren.length * 2;
    const b = new ArrayBuffer(44 + n * ch * 2), v = new DataView(b);
    const zet = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    zet(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); zet(8, 'WAVE'); zet(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, SR, true); v.setUint32(28, SR * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); zet(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const pcm = new Int16Array(b, 44);
    for (let i = 0; i < n; i++) for (let k = 0; k < paren.length; k++) { pcm[i * ch + 2 * k] = Math.round(paren[k][0][i] * 32767); pcm[i * ch + 2 * k + 1] = Math.round(paren[k][1][i] * 32767); }
    return b;
  };
  const tracks = [];
  if (await laadDemo('A')) tracks.push(1); else notities.push('track 1: geen demo');
  if (await laadDemo('B')) tracks.push(2); else notities.push('track 2: geen demo');
  let stems = null;
  try {
    const d = window.engine.deck('C');
    await d.laadStream('geheugen:stems', 'vier stems', { haal: geheugenHaal(stemsWav()), stems: { namen: NAMEN4, schaal: 1 } });
    d.setGrid({ bpm: 124, firstBeat: 0 });
    d.loop = { start: 0, end: 4 * 60 / 124 };
    stems = 3; tracks.push(3);
  } catch (e) { notities.push('stems op track 3: ' + e.message); }
  if (await laadDemo('D')) tracks.push(4); else notities.push('track 4: geen demo');
  window.engine.setFocus('A');
  const zonderRack = [];
  for (const n of tracks) {
    if (a.read('track.' + n + '.keylock') !== 1) { a.invoke('track.' + n + '.keylock', true); a.invoke('track.' + n + '.keylock', false); }
    a.invoke('track.' + n + '.pitch', 0.65);
    a.invoke('track.' + n + '.send.a', 0.6);
    a.invoke('track.' + n + '.send.b', 0.4);
    if (a.read('track.' + n + '.fx.bypass') === null) zonderRack.push(n);
    a.invoke('track.' + n + '.fx.mix', 0.5);
    a.invoke('track.' + n + '.fader', 1);
    if (!window.engine.deck(String.fromCharCode(64 + n)).playing) { a.invoke('track.' + n + '.play', true); a.invoke('track.' + n + '.play', false); }
  }
  if (zonderRack.length) notities.push('zonder rack (fx.mix doet niets): track ' + zonderRack.join(', '));
  a.invoke('mixer.xfader', 0.5);
  let om = false;
  window.__last = setInterval(() => { om = !om; a.invoke('track.1.filter', om ? 0.3 : 0.7); a.invoke('track.2.fader', om ? 0.8 : 1); }, 2000);
  await wacht(500);
  return { tracks, stems, notities, speelt: tracks.map((n) => window.engine.deck(String.fromCharCode(64 + n)).playing),
    keylock: tracks.map((n) => a.read('track.' + n + '.keylock')) };
})()`;

async function volledigeRun(o) {
  if (o.onbekend.length) { console.error(`onbekende stand(en): ${o.onbekend.join(', ')} (kies uit ${Object.keys(STANDEN).join(', ')})`); return 2; }
  const optie = optieFout(o);
  if (optie) { console.error(optie); return 2; }
  const tmp = mkdtempSync(join(tmpdir(), VOORVOEGSEL));
  zetSignalen(() => { if (!o.bewaar) rmSync(tmp, { recursive: true, force: true }); });
  const json = { soort: 'volledig', datum: new Date().toISOString(), opties: { ...o }, standen: [], meldingen: [] };
  const v = await vooraf(o, tmp, { volledig: true });
  json.vooraf = v.vooraf;
  if (v.stop.length) {
    for (const r of v.stop) console.error(`STOP  ${r}`);
    if (!o.bewaar) rmSync(tmp, { recursive: true, force: true });
    return 2;
  }
  if (o.accu) {
    if (v.vooraf.machine.stroom !== 'Battery Power') {
      console.log('\n--accu: haal de lader eruit (ik wacht hooguit 2 minuten)');
      for (let i = 0; i < 60 && machineNu(null).stroom !== 'Battery Power'; i++) await wacht(2000);
    }
    json.stroombron = machineNu(null).stroom;
    if (json.stroombron !== 'Battery Power') {
      console.error('STOP  --accu: de Mac hangt nog aan de lader');
      if (!o.bewaar) rmSync(tmp, { recursive: true, force: true });
      return 2;
    }
  }

  let stroom = null, varve = null, varveSid = null, stroomSid = null, popup = null;
  let audioPid = v.vooraf.claysAudio?.pid ?? null;
  let audioStop = null;
  const groepen = {};
  try {
    // ---- starten ------------------------------------------------------------------
    console.log('\nstarten');
    const relayLog = openSync(join(tmp, 'relay.log'), 'a');
    groepen.relay = start(process.execPath, [join(o.repo, 'tools/varve-relay.js'), String(o.relay)], { stdio: ['ignore', relayLog, relayLog] }).pid;
    closeSync(relayLog);
    const { maakNepYtdlp } = await import(pathToFileURL(join(WORTEL, 'test/nep-ytdlp.mjs')).href);
    mkdirSync(join(tmp, 'nep'), { recursive: true });
    // --meting=<tmp>: een merkteken in de argv voor --opruimen (server/index.js leest geen argv).
    groepen.server = start(process.execPath, [join(WORTEL, 'server/index.js'), `--meting=${tmp}`], {
      env: proefEnv(tmp, o.poort, maakNepYtdlp(join(tmp, 'nep'))),
    }).pid;
    const chromeArgs = (debug, b, h) => ['--headless=new', `--remote-debugging-port=${debug}`, `--user-data-dir=${join(tmp, `profiel-${debug}`)}`,
      '--use-angle=metal', '--enable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required', `--window-size=${b},${h}`, 'about:blank'];
    groepen.stroom = start(v.chromePad, chromeArgs(o.debugStroom, 1920, 1080)).pid;
    groepen.varve = start(v.chromePad, chromeArgs(o.debugVarve, 1280, 800)).pid;
    stroom = new Chrome('Stroommachine', o.debugStroom);
    varve = new Chrome('VARVE', o.debugVarve);
    await stroom.verbind();
    await varve.verbind();
    stroomSid = await stroom.pagina();
    varveSid = await varve.pagina();
    for (let i = 0; i < 50 && !(await poortBezet(o.relay)); i++) await wacht(100);
    for (let i = 0; i < 100; i++) { if (await fetch(`http://localhost:${o.poort}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }
    ok('relay en proefserver luisteren', await poortBezet(o.relay) && await poortBezet(o.poort));

    // ---- VARVE ---------------------------------------------------------------------
    console.log('\nVARVE');
    await varve.cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI }, varveSid);
    await varve.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false }, varveSid);
    await varve.cdp('Page.navigate', { url: `http://localhost:${o.poort}/?vormen=1` }, varveSid);
    await varve.tot(varveSid, '!!(window.engine && window.beeld)', 30000);
    await varve.ev(varveSid, `localStorage.setItem('varve.beeld.aan', '1'); localStorage.setItem('varve.beeld.adres', ${JSON.stringify(`ws://127.0.0.1:${o.relay}/app`)}); localStorage.setItem('varve.vormen', '1'); true`);
    await varve.cdp('Page.reload', {}, varveSid);
    await wacht(500);
    ok('VARVE start met beeld en vormen, zonder MIDI', !!(await varve.tot(varveSid, '!!(window.engine && window.beeld && window.vormen) && !navigator.requestMIDIAccess', 30000)));
    ok('VARVE verbindt met de relay op deze Mac', (await varve.tot(varveSid, 'window.beeld.status().verbonden', 15000)) === true);
    const renderV = await varve.ev(varveSid, RENDERER).catch((e) => e.message);
    ok('VARVE rendert op de GPU (Apple M…)', /Apple M\d/.test(renderV), renderV);
    ok('engine.ctx heeft een audioWorklet (A10)', await varve.ev(varveSid, "typeof window.engine.ctx.audioWorklet.addModule === 'function'"));
    const last = await varve.ev(varveSid, CLAY_LAST).catch((e) => ({ fout: e.message }));
    json.last = last;
    ok('Clay-last: tracks spelen met keylock', !last.fout && last.tracks?.length >= 2 && last.speelt?.every(Boolean), last.fout ?? `tracks ${last.tracks?.join(', ')}${last.stems ? `, stems op ${last.stems}` : ', ZONDER stems'}${last.notities?.length ? ` · ${last.notities.join(' · ')}` : ''}`);
    const meters = await varve.ev(varveSid, METERS('window.engine.ctx')).catch((e) => `FOUT ${e.message}`);
    ok('meters in VARVE geladen (hartslag in engine.ctx, rAF, drift)', meters === 'running', meters);

    // ---- de Stroommachine: renderer ------------------------------------------------------
    const renderS = await stroom.ev(stroomSid, RENDERER).catch((e) => e.message);
    ok('de Stroommachine-Chrome rendert op de GPU (Apple M…)', /Apple M\d/.test(renderS), renderS);
    json.renderer = { varve: renderV, stroom: renderS, cft: stroom.versie };

    // ---- de standen ------------------------------------------------------------------------
    const varveFouten0 = varve.fouten.get(varveSid)?.length ?? 0;
    for (let i = 0; i < o.standen.length; i++) {
      const naam = o.standen[i];
      const st = STANDEN[naam];
      const duur = duurVan(o.standen, i, o.meet);
      console.log(`\n${naam} — ${st.uitleg} (${o.warm} s opwarmen, ${duur} s meten)`);
      const r = { stand: naam, duur, warm: o.warm, kw: [], dj: [], varve: [], cpu: [], popup: [], voor: machineNu(v.warmte) };
      // De Stroommachine
      if (st.stroom) {
        await stroom.cdp('Emulation.setDeviceMetricsOverride', { width: st.stroom.b, height: st.stroom.h, deviceScaleFactor: 1, mobile: false }, stroomSid);
        await stroom.cdp('Page.navigate', { url: stroomUrl(o.repo, o.relay, st.stroom.hash) }, stroomSid);
        const aan = await stroom.tot(stroomSid, '!!(window.__stroom && window.__stroom.dj && window.__stroom.dj().aan)', 30000);
        ok(`${naam}: de Stroommachine start met &dj binnen 30 s`, !!aan);
        await stroom.ev(stroomSid, RAF_METER).catch(() => {});
        if (naam === 'licht-1080') {
          const fris = await stroom.tot(stroomSid, '(s => s.fris && s.klok)(window.__stroom.dj())', 20000);
          ok('licht-1080: fris en klok binnen 20 s (ze volgt VARVE)', !!fris);
        }
      } else {
        await stroom.cdp('Page.navigate', { url: 'about:blank' }, stroomSid);
      }
      // Het zaalbeeld
      if (st.vormen && !popup) {
        await varve.cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
        const voor = varve.nieuw.length;
        await varve.ev(varveSid, "document.querySelector('#video-panel .vid-los').click(); true", true);
        // Op opener, niet op de url: bij het koppelen staat een nieuw venster nog op about:blank (zaalbeeld.mjs, 10 okt).
        for (let k = 0; k < 100 && !varve.nieuw.slice(voor).some((t) => t.type === 'page' && t.openerId); k++) await wacht(100);
        const doel = varve.nieuw.slice(voor).find((t) => t.type === 'page' && t.openerId);
        if (doel) {
          popup = doel;
          await varve.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, popup.sessionId).catch(() => {});
          ok(`${naam}: het losse venster mengt zelf`, !!(await varve.tot(popup.sessionId, '!!window.beamerMixer && window.beamerMixer.beelden > 0', 15000)));
        } else ok(`${naam}: het losse venster gaat open (window.open met een gebaar)`, false);
        await varve.ev(varveSid, `(async () => { const a = await import('/src/control/actions.js');
          if (a.read('video.layer.on') !== 1) { a.invoke('video.layer.on', true); a.invoke('video.layer.on', false); }
          if (a.has('video.layer.react')) a.invoke('video.layer.react', 0.6);
          if (a.has('video.clips') && a.read('video.clips') === 1) { a.invoke('video.clips', true); a.invoke('video.clips', false); }
          return { laag: a.read('video.layer.on'), clips: a.has('video.clips') ? a.read('video.clips') : 'niet gebouwd' }; })()`).then((x) => { r.zaalbeeld = x; });
      } else if (!st.vormen && popup) {
        await varve.cdp('Target.closeTarget', { targetId: popup.targetId }).catch(() => {});
        popup = null;
        await varve.ev(varveSid, `(async () => { const a = await import('/src/control/actions.js');
          if (a.read('video.layer.on') === 1) { a.invoke('video.layer.on', true); a.invoke('video.layer.on', false); }
          if (a.has('video.clips') && a.read('video.clips') === 0) { a.invoke('video.clips', true); a.invoke('video.clips', false); }
          return true; })()`).catch(() => {});
      }
      // Opwarmen, dan alle meters leeg
      await wacht(o.warm * 1000);
      await varve.ev(varveSid, 'window.__meet.hartLees()');
      await varve.ev(varveSid, 'window.__meet.neem(); true');
      if (st.stroom) await stroom.ev(stroomSid, 'window.__meetS ? (window.__meetS.length = 0, true) : false').catch(() => {});
      let ps0 = psNu(), tPs = performance.now();
      let audio0 = audioPid ? ps0.find((x) => x.pid === audioPid)?.cpu ?? null : null, tAudio = tPs;
      const beelden0 = popup ? await varve.ev(popup.sessionId, 'window.beamerMixer.beelden').catch(() => null) : null;
      let beeldenVorig = beelden0;
      for (let s = 1; s <= duur; s++) {
        await wacht(Math.max(0, tPs + 1000 - performance.now()));
        const [kw, vs, pb] = await Promise.all([
          st.stroom ? stroom.ev(stroomSid, `(() => { const k = window.__stroom.kwInfo(); const d = window.__stroom.dj();
            return { ms: k.ms, fps: k.fps, stand: k.stand, scale: k.scale, W: k.W, H: k.H, wissels: k.wissels, fris: d.fris, klok: d.klok, rtt: d.rtt, zicht: document.visibilityState }; })()`).catch(() => null) : null,
          varve.ev(varveSid, `({ verbonden: window.beeld.status().verbonden, speeltA: window.engine.deck('A').playing, zicht: document.visibilityState,
            laag: window.vormen?.laag?.aan ?? null })`).catch(() => null),
          popup ? varve.ev(popup.sessionId, '({ beelden: window.beamerMixer.beelden, clips: window.beamerMixer.clips ?? null, zicht: document.visibilityState })').catch(() => null) : null,
        ]);
        const ps1 = psNu(); const nu = performance.now();
        const cpu = cpuPerGroep(ps0, ps1, groepen, (nu - tPs) / 1000);
        // De top-5 van de rest van de Mac aan het begin en het eind van de stand:
        // een daemon-piek in één stand valt zo op (review 10 okt, punt 5).
        if (s === 1 || s === duur) {
          const p = cpuPoort(topGebruikers(ps0, ps1, (nu - tPs) / 1000, boom(ps1, process.pid)));
          (r.top ??= {})[s === 1 ? 'begin' : 'eind'] = p.top5;
          if (p.ander.length) r.ander = [...(r.ander || []), ...p.ander.map((t) => ({ ...t, s }))];
        }
        r.cpu.push(Object.fromEntries(Object.entries(cpu).map(([k, x]) => [k, { kern: +x.kern.toFixed(3), rssMB: +x.rssMB.toFixed(1) }])));
        ps0 = ps1; tPs = nu;
        if (kw) { r.kw.push(kw); }
        if (vs) r.varve.push(vs);
        if (pb) { r.popup.push({ ...pb, perS: beeldenVorig != null ? pb.beelden - beeldenVorig : null }); beeldenVorig = pb.beelden; }
        if (audioPid && nu - tAudio >= 5000) {
          const a1 = ps1.find((x) => x.pid === audioPid)?.cpu ?? null;
          if (a1 != null && audio0 != null && a1 - audio0 > AUDIO_KLAAG_S && !o.forceer) {
            audioStop = `het audioproces van Clay's Chrome rekende ${n1(a1 - audio0, 2)} s in 5 s (speelt er iets?): afgebroken in ${naam} na ${s} s`;
            break;
          }
          audio0 = a1; tAudio = nu;
        }
      }
      // Lezen en samenvatten
      r.hart = await varve.ev(varveSid, 'window.__meet.hartLees()').catch(() => null);
      const reeks = await varve.ev(varveSid, 'window.__meet.neem()').catch(() => ({ raf: [], drift: [], zicht: [] }));
      r.raf = reeks.raf; r.drift = reeks.drift; r.zichtVarve = reeks.zicht; r.ctxStaat = reeks.staat;
      r.rafS = st.stroom ? await stroom.ev(stroomSid, 'window.__meetS ? window.__meetS.splice(0) : []').catch(() => []) : [];
      r.na = machineNu(v.warmte);
      r.som = {
        stroom: rafSamenvatting(r.rafS),
        kwFps: verdeling(r.kw.map((k) => 1000 / k.ms)),
        varve: rafSamenvatting(r.raf),
        cpu: Object.fromEntries(Object.keys(groepen).map((g) => [g, verdeling(r.cpu.map((c) => c[g]?.kern))])),
        rss: Object.fromEntries(Object.keys(groepen).map((g) => [g, verdeling(r.cpu.map((c) => c[g]?.rssMB))?.max ?? null])),
        rtt: verdeling(r.kw.map((k) => k.rtt).filter((x) => x > 0))?.p50 ?? null,
        popupPerS: verdeling(r.popup.map((p) => p.perS).filter(Number.isFinite)),
        laatsteKw: r.kw.at(-1) ?? null,
      };
      json.standen.push(r);
      // Harde checks per stand
      ok(`${naam}: deck A speelt in elk monster`, r.varve.length > 0 && r.varve.every((x) => x.speeltA));
      const zicht = [...r.zichtVarve, ...r.varve.map((x) => x.zicht), ...r.kw.map((k) => k.zicht), ...r.popup.map((p) => p.zicht)];
      ok(`${naam}: document.visibilityState overal visible (H16)`, zicht.length > 0 && zicht.every((z) => z === 'visible'), `${zicht.length} monsters`);
      if (st.stroom) {
        const f = fpsOordeel(r.kw);
        ok(`${naam}: kwInfo().fps === true en ms niet constant (H1)`, f.ok, f.tekst);
      }
      if (r.ander?.length) info(`${naam}: let op, een ander proces trok > ${VREEMD_KERN * 100} %: ${r.ander.map((t) => `pid ${t.pid} ${kortNaam(t.cmd)} ${n1(t.kern * 100, 0)} % (s ${t.s})`).join(' · ')}`);
      if (st.vormen) ok(`${naam}: het losse venster tekent > 20 beelden/s`, (r.som.popupPerS?.p50 ?? 0) > 20, r.som.popupPerS ? `p50 ${r.som.popupPerS.p50}` : 'niet gemeten');
      // Eén regel
      const s = r.som;
      const cpuTekst = Object.keys(groepen).map((g) => `${g} ${n1(s.cpu[g]?.gem, 2)}`).join(' · ');
      const rssTekst = Object.keys(groepen).map((g) => `${g} ${n1(s.rss[g], 0)}`).join(' · ');
      const kwL = s.laatsteKw;
      console.log(`  ==  ${naam}: ${s.stroom ? `Stroommachine p50 ${n1(s.stroom.fpsP50)} fps · p10 ${n1(s.stroom.fpsP10)} (1000/ms ${n1(s.kwFps?.p50)}) · ${kwL?.stand} ${kwL?.scale} ${kwL?.W}×${kwL?.H} | ` : ''}`
        + `VARVE-rAF p50 ${n1(s.varve?.msP50)} ms · p99 ${n1(s.varve?.msP99)} | ${hartTekst(r.hart, null)} | CPU (kern) ${cpuTekst} | RSS (MB) ${rssTekst}`
        + `${s.rtt ? ` | rtt ${n1(s.rtt)} ms` : ''}${s.popupPerS ? ` | los venster ${s.popupPerS.p50}/s` : ''} | warmte ${r.voor.warmte ?? '?'}→${r.na.warmte ?? '?'} | ${r.na.watt ?? '?'} W, ${r.voor.accu ?? '?'}→${r.na.accu ?? '?'} %`);
      if (audioStop) break;
    }
    if (popup) { await varve.cdp('Target.closeTarget', { targetId: popup.targetId }).catch(() => {}); popup = null; }

    // ---- na de standen --------------------------------------------------------------------
    if (audioStop) { console.error(`\nAFGEBROKEN  ${audioStop}`); json.afgebroken = audioStop; }
    const fouten = (varve.fouten.get(varveSid) || []).slice(varveFouten0);
    ok('0 uitzonderingen in VARVE tijdens de standen', !fouten.length, fouten.slice(0, 3).join(' · '));
    console.log('\npositieve controle');
    const pc = await varve.ev(varveSid, POSITIEVE_CONTROLE(CONTROLE_MS)).catch((e) => ({ fout: e.message }));
    json.positieveControle = pc;
    const gezien = !!pc?.gat && pc.gat.max >= CONTROLE_MS;
    ok(`hartslag ziet een gat van ${CONTROLE_MS} ms`, gezien, pc?.fout ?? `max ${pc?.gat?.max} ms, geblokkeerd ${pc?.gestald} ms`);
    if (!gezien) console.error('FAIL  meter blind: de hartslag zag de positieve controle niet; de gatencijfers hierboven zeggen niets');
    json.tegenNul = {
      varveRafP99: tegenNul(json.standen, (x) => x.som.varve?.msP99),
      hartMax: tegenNul(json.standen, (x) => x.hart?.max),
      cpuTotaal: tegenNul(json.standen, (x) => Object.values(x.som.cpu).reduce((a, c) => a + (c?.gem ?? 0), 0)),
    };
    console.log('\ntegen de omliggende nul-standen (VARVE-rAF p99 ms · hartslag max ms · CPU totaal kern)');
    for (let k = 0; k < json.tegenNul.varveRafP99.length; k++) {
      const a = json.tegenNul.varveRafP99[k], b = json.tegenNul.hartMax[k], c = json.tegenNul.cpuTotaal[k];
      console.log(`  ..  ${a.stand}: ${a.verschil == null ? '–' : `${a.verschil >= 0 ? '+' : ''}${n1(a.verschil)}`} · ${b.verschil == null ? '–' : `${b.verschil >= 0 ? '+' : ''}${n1(b.verschil, 0)}`} · ${c.verschil == null ? '–' : `${c.verschil >= 0 ? '+' : ''}${n1(c.verschil, 2)}`}`);
    }
    await stroom.foto(stroomSid, join(o.uit, 'beeld-lokaal-stroom.png')).catch(() => {});
    await varve.foto(varveSid, join(o.uit, 'beeld-lokaal-varve.png')).catch(() => {});
  } catch (e) {
    ok('de volledige run liep zonder uitzondering', false, e.message);
  } finally {
    stroom?.sluit(); varve?.sluit();
    stopAlles();
    await wachtTotWeg();
    json.checks = checks;
    mkdirSync(o.uit, { recursive: true });
    if (existsSync(join(tmp, 'relay.log'))) json.relayLog = readFileSync(join(tmp, 'relay.log'), 'utf8').split('\n').slice(-40);
    writeFileSync(join(o.uit, 'beeld-lokaal.json'), JSON.stringify(json));
    if (!o.bewaar) rmSync(tmp, { recursive: true, force: true });
    // Na afloop: niets van ons luistert nog, Clay's server leeft.
    await wacht(300);
    const nogBezet = [];
    for (const p of [o.relay, o.poort, o.debugStroom, o.debugVarve]) if (await poortBezet(p)) nogBezet.push(p);
    ok('na afloop luistert niets meer op onze poorten', !nogBezet.length, nogBezet.join(', '));
    const clay = await fetch('http://localhost:8777/api/proef', { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => null);
    info(`Clay's server op 8777: ${clay ? 'draait' : 'antwoordt niet (draaide hij?)'}`);
  }
  const fout = checks.filter((c) => !c.ok).length;
  if (!afgebroken) console.log(`\n${checks.length} checks, ${fout ? `${fout} FAIL` : 'alles ok'} — ${join(o.uit, 'beeld-lokaal.json')}`);
  return audioStop ? 3 : fout ? 1 : 0;
}

// ---- kijken tijdens een echte proef (stap 7) -------------------------------------------

async function kijk(o) {
  const fout = optieFout(o);
  if (fout) { console.error(fout); return 2; }
  zetSignalen();
  const lijst = await fetch(`http://127.0.0.1:${o.kijkDebug}/json/list`).then((r) => r.json()).catch(() => null);
  const doel = lijst?.find((d) => d.type === 'page' && /index\.html/.test(d.url));
  if (!doel) { console.error(`geen Stroommachine op 127.0.0.1:${o.kijkDebug} (start haar met zsh tools/beeld-lokaal.sh)`); return 2; }
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let volg = 0; const wachtend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wachtend.has(m.id)) { wachtend.get(m.id)(m.result); wachtend.delete(m.id); } });
  const ev = (expression) => new Promise((r) => { const id = ++volg; wachtend.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  mkdirSync(o.uit, { recursive: true });
  const bestand = join(o.uit, `kijk-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const profiel = `--user-data-dir=${join(homedir(), '.varve-stroom-chrome')}`;
  const wortels = {
    stroom: (rijen) => { const b = rijen.find((r) => r.cmd.includes(profiel) && !r.cmd.includes('--type=')); return b ? boom(rijen, b.pid) : new Set(); },
    relay: (rijen) => new Set(rijen.filter((r) => /varve-relay\.js/.test(r.cmd)).map((r) => r.pid)),
  };
  console.log(`kijken naar ${doel.url.split('#')[0].slice(0, 80)}… → ${bestand} (Ctrl-C stopt)`);
  let ps0 = psNu(), t0 = performance.now();
  const eind = o.duur ? Date.now() + o.duur * 1000 : Infinity;
  while (Date.now() < eind) {
    await wacht(1000);
    const r = await ev(`(() => { const k = window.__stroom?.kwInfo?.(); const d = window.__stroom?.dj?.(); return { kw: k ?? null, dj: d ? { fris: d.fris, klok: d.klok, rtt: d.rtt } : null, zicht: document.visibilityState }; })()`);
    const ps1 = psNu(), nu = performance.now();
    const cpu = cpuPerGroep(ps0, ps1, wortels, (nu - t0) / 1000);
    ps0 = ps1; t0 = nu;
    appendFileSync(bestand, `${JSON.stringify({ t: new Date().toISOString(), ...(r?.result?.value ?? {}), cpu })}\n`);
  }
  ws.close();
  return 0;
}

// ---- opruimen -------------------------------------------------------------------------

function opruimen(o) {
  return ruimOp(o.relay, VOORVOEGSEL);   // een belofte: het hoofdprogramma wacht erop
}

// ---- hoofdprogramma (niet bij importeren: test/beeld-meting.test.mjs leest de pure delen) ----

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = leesOpties(process.argv.slice(2), process.env);
  const code = o.zelftest ? await zelftest(o) : o.kijk ? await kijk(o) : o.opruimen ? await opruimen(o) : await volledigeRun(o);
  if (!afgebroken) process.exit(code);   // anders sluit dood() af, met 130/143/1
}
