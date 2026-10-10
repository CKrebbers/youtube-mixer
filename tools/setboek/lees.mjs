/**
 * Het setboek: wat er op een avond KLONK, uit de handelingenlogs
 * (`opnames/set-<id>.acties.jsonl`, docs/HANDELINGENLOG.md). Een tracklist
 * "hoorbaar (benaderd)", wat geladen maar niet gehoord werd, het gebruik, en
 * een leeg verslagblok voor Clay. Puur: leest tekst, schrijft niets, geen fs
 * (de CLI `setboek.mjs` doet de bestanden; morgenochtend, stap 2b).
 *
 * Alleen lezen, en altijd op een KOPIE van de logs. Het log is de partituur
 * van de bus, geen opname van het geluid: wat het niet ziet staat onderaan de
 * uitvoer en in tools/setboek/LEESMIJ.md (stap 2b).
 *
 *   rijgLogs(bestanden)        meerdere logs van één avond op één klok
 *   laadmomenten(log)          welk nummer wanneer op welke track kwam
 *   toestand(log, opties)      de stand per track na elke regel (generator)
 *   hoort(tr, g, xg, opties)   klinkt deze track nu?
 *   hoorbaar(log, opties)      de hoorbare stukken van één log
 *   setboek(bestanden, opties) alles samen; naarMarkdown / naarJson
 *
 * De regel "hoorbaar": de track speelt, er staat een nummer op, niet alle
 * drie de EQ-banden weg (kill, of de knop onderaan), niet alle stems dicht
 * (elke stem onder de drempel), de master boven de drempel (faderGain: master
 * > 1/3), en 20·log10(klinkt(fader, kant) × trim × 2) boven de drempel (−30 dB). `klinkt`
 * is dezelfde als die van de video-puls (src/video/puls.js), en de curves zijn
 * die van de engine (faderGain, xfaderGains): het setboek en het beeld
 * bedoelen met "je hoort hem" hetzelfde.
 */
import { leesLog } from '../../src/control/handelingen.js';
import { xfaderGains, eqDb, EQ_KILL_DB, faderGain } from '../../src/engine/audio-graph.js';
import { klinkt } from '../../src/video/puls.js';
import { tellingen } from './gebruik.mjs';

export const STANDAARD = {
  drempelDb: -30,       // zachter dan dit telt niet als gespeeld: de track, de master en elke stem apart
  minDuur: 20,          // s: korter is een flits, geen nummer (zoals tools/lokaal: < 20 s overslaan)
  samenvoegen: 5,       // s: een gat korter dan dit (een kill, een fader even dicht, de grens van twee logs) is één stuk
  langSpelen: 20 * 60,  // s: zonder lengte is een "stop" na zo lang spelen misschien een start na het einde
  lang: 20 * 60,        // s: een nummer zo lang (of een positie zo ver) is een mix: Buma/Stemra "titel onbekend"
  gatMin: 2,            // s: een gat tussen twee logs dat langer is, wordt gemeld
  filterRand: 0.1,      // filterknop ≤ 0,1 of ≥ 0,9: de aantekening "gefilterd"
  proefMarge: 2 * 3600, // s: proefpunten verder dan dit van de logs af horen niet bij deze avond
  lengte: null,         // (nummerId) => seconden | null: uit een kopie van library.db (stap 2b, --db)
  vanafMs: null,        // logs die eerder begonnen overslaan (CLI --vanaf HH:MM)
};

const TZ = 'Europe/Amsterdam';
/** Uit src/engine/deck.js en engine.js (test/setboek.test.mjs vergelijkt ze): geen engine importeren voor drie lijstjes. */
export const PITCH_BEREIKEN = [0.08, 0.16, 0.5];
export const RATE = { min: 0.5, max: 2 };
export const KANTEN = ['A', 'B', 'thru'];
/** De remtijd uit deck.js (REM_MIN, REM_MAX, REM_STANDAARD): de knop track.N.brake.time is exponentieel. */
export const REM = { min: 0.1, max: 5, standaard: 1 };
/** Zoveel instrumenten (instrumenten/index.js, INSTRUMENTEN): inst.choose kiest round(v × INSTRUMENT_AANTAL), 0 = geen. */
export const INSTRUMENT_AANTAL = 4;
/** De master waarmee de engine begint (engine.js, masterLevel). */
export const MASTER_STANDAARD = 0.8;
const standaardKant = (nr) => (nr === 1 ? 'A' : nr === 2 ? 'B' : 'thru');
const BANDEN = ['low', 'mid', 'high'];
const getal = (v, anders) => (typeof v === 'number' && Number.isFinite(v) ? v : anders);
const klem01 = (v) => Math.min(1, Math.max(0, v));
const tijdVan = (r) => (Array.isArray(r) ? r[0] : r?.t);
/** De lengte van een nummer in s (opties.lengte, uit een kopie van library.db), of null. */
function lengteUit(o, nummer) {
  if (typeof o.lengte !== 'function' || nummer == null) return null;
  const L = o.lengte(nummer);
  return Number.isFinite(L) && L > 0 ? L : null;
}

const pad = (n) => String(n).padStart(2, '0');
const klokFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dagFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const datumFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, day: 'numeric', month: 'short' });
/** 21:14:05 (Amsterdam), uit milliseconden. */
export const kloktijd = (ms) => (Number.isFinite(ms) ? klokFmt.format(new Date(ms)) : '?');
/** '6 okt' (Amsterdam). */
export const datumKort = (ms) => (Number.isFinite(ms) ? datumFmt.format(new Date(ms)).replace(/\.$/, '') : '?');
/** De kloktijd, met de datum ervoor als het een andere dag is dan `dag` ('JJJJ-MM-DD'). */
const klokOp = (ms, dag) => (Number.isFinite(ms) && dag && dagFmt.format(new Date(ms)) !== dag ? `${datumKort(ms)} ${kloktijd(ms)}` : kloktijd(ms));

/**
 * Milliseconden van `uu:mm` op dag 'JJJJMMDD' in Amsterdam (zomer- of wintertijd), of null.
 * Voor --vanaf in de CLI.
 */
export function amsterdamMs(dag, uumm) {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(String(dag)), k = /^(\d{1,2}):(\d{2})$/.exec(String(uumm));
  if (!d || !k) return null;
  const utc = Date.UTC(+d[1], +d[2] - 1, +d[3], +k[1], +k[2]);
  for (const uur of [1, 2, 0, 3]) {
    const ms = utc - uur * 3600e3;
    if (kloktijd(ms).slice(0, 5) === `${pad(+k[1])}:${k[2]}` && dagFmt.format(new Date(ms)) === `${d[1]}-${d[2]}-${d[3]}`) return ms;
  }
  return null;
}
/** 2:05 of 1:02:05. */
export function duurTekst(s) {
  if (!Number.isFinite(s)) return '?';
  const x = Math.max(0, Math.round(s)), h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(x % 60)}` : `${m}:${pad(x % 60)}`;
}
const idUit = (bestand) => String(bestand).split(/[\\/]/).pop().replace(/\.acties\.jsonl$/, '').replace(/^set-/, '');

// ---- meerdere logs op één avond --------------------------------------------------

/**
 * Logs van één avond op volgorde van `kop.begon`. Een avond is vaak meer dan
 * één log: een los log, dan een opname (die het losse log afsluit en een
 * eigen log met zijn id begint), dan weer los, of opnieuw na herladen. Elk log
 * houdt zijn eigen t-as; de kloktijd is kop.begon + t.
 *
 * @param bestanden [{ bestand, tekst }]
 * @returns { dag ('JJJJ-MM-DD', Amsterdam), logs: [{ id, bestand, begonMs, duur, acties, opname, af, afgebroken, kapot, log }],
 *            gaten: [{ na, voor, vanMs, totMs, s }], overgeslagen: [{ id, reden }] }
 */
export function rijgLogs(bestanden, opties = {}) {
  const o = { ...STANDAARD, ...opties };
  const alle = bestanden.map(({ bestand, tekst }) => {
    const log = leesLog(tekst);
    const begonMs = Date.parse(log.kop?.begon ?? '');
    return {
      id: idUit(bestand), bestand, begonMs: Number.isFinite(begonMs) ? begonMs : null, duur: log.duur,
      acties: log.regels.filter((r) => Array.isArray(r)).length, opname: log.kop?.opname ?? null,
      af: !!log.eind && !log.eind.afgebroken, afgebroken: log.eind ? (log.eind.afgebroken ?? null) : 'geen eind (afgebroken)',
      kapot: log.kapot, log,
    };
  });
  alle.sort((a, b) => (a.begonMs ?? Infinity) - (b.begonMs ?? Infinity) || (a.id < b.id ? -1 : 1));
  const vroeg = (x) => Number.isFinite(o.vanafMs) && x.begonMs !== null && x.begonMs < o.vanafMs;
  const logs = alle.filter((x) => x.acties > 0 && x.begonMs !== null && !vroeg(x));
  const overgeslagen = alle.filter((x) => !logs.includes(x)).map((x) => ({
    id: x.id, reden: x.begonMs === null ? 'geen kop' : x.acties === 0 ? '0 acties' : `begon vóór ${kloktijd(o.vanafMs).slice(0, 5)} (--vanaf)`,
  }));
  const gaten = [];
  for (let i = 1; i < logs.length; i++) {
    const a = logs[i - 1], b = logs[i];
    const vanMs = a.begonMs + a.duur * 1000, s = (b.begonMs - vanMs) / 1000;
    if (s > o.gatMin) gaten.push({ na: a.id, voor: b.id, vanMs, totMs: b.begonMs, s });
  }
  return { dag: logs.length ? dagFmt.format(new Date(logs[0].begonMs)) : null, logs, gaten, overgeslagen };
}

/** Elke laad (en wat er in de beginstand al stond): { t, klokMs, track, titel, nummer, bron, uitStand }. */
export function laadmomenten(log, begonMs = null) {
  const uit = [];
  const klok = (t) => (begonMs === null ? null : begonMs + t * 1000);
  for (const r of log.regels) {
    if (r?.e === 'stand') {
      for (const tr of r.tracks || []) {
        if (tr.bron && tr.bron !== 'leeg') uit.push({ t: r.t, klokMs: klok(r.t), track: tr.track, titel: tr.titel ?? null, nummer: tr.nummer ?? null, bron: tr.bron, uitStand: true });
      }
    } else if (r?.e === 'laad') {
      uit.push({ t: r.t, klokMs: klok(r.t), track: r.track, titel: r.titel ?? null, nummer: r.nummer ?? null, bron: r.bron ?? null, uitStand: false });
    }
  }
  return uit;
}

// ---- de toestand per track -------------------------------------------------------

function nieuweTrack(nr) {
  return {
    nr, titel: null, nummer: null, bron: null, laadId: 0,
    speelt: false, sindsStart: null, eind: null, remT: null, remTijd: REM.standaard, instT: null,
    kant: standaardKant(nr), fader: 1, trim: 0.5, filter: 0.5,
    kill: { low: false, mid: false, high: false }, killVast: { low: false, mid: false, high: false }, eq: { low: 0.5, mid: 0.5, high: 0.5 },
    stems: false, geenStems: false, stemNiveau: {}, stemKill: {}, stemVast: {},
    positie: null, tStand: 0, rate: 1, bereik: 0.16, cue: 0, opCue: null,
    hotcues: [null, null, null, null], secties: null, loop: false, onzeker: false,
  };
}

/** Waar de speelkop van een track op log-tijd t staat (tracktijd), of null als dat niet te weten is. */
export const positieOp = (tr, t) => (tr.positie === null ? null : tr.positie + (tr.speelt ? (t - tr.tStand) * tr.rate : 0));

/**
 * Loopt het log af en geeft na elke regel (en op elk berekend trackeinde) de
 * stand: { t, tracks: [per track], xfader, curve, master, waarom }. Dat is
 * steeds HETZELFDE object: lees het meteen, bewaar het niet.
 *
 * Per track: speelt (play/play.quant = wisselen, cue volgens deck.cue(), laad
 * = stop), kant, fader, trim, filter, kills (schakelaar en vasthouden), stems
 * (niveau, kill, vasthouden), positie in de bron (benaderd), rate, cue,
 * hotcues, sectiekaart, loop (gezien), onzeker.
 *
 * Trackeinde: het log ziet het niet (laad.duur is de LAADtijd). Met
 * `opties.lengte(nummer)` stopt een track op tStart + (lengte − positie)/rate,
 * zolang er geen loop gezien is. Zonder lengte: een stop met play na
 * `langSpelen` spelen kan een START na het einde zijn geweest; de track wordt
 * dan "onzeker" tot de speelkop ergens heen springt of er iets anders laadt.
 */
export function* toestand(log, opties = {}) {
  const o = { ...STANDAARD, ...opties };
  const T = [];
  const track = (nr) => {
    const i = Number(nr);
    if (!Number.isInteger(i) || i < 1 || i > 64) return null;
    while (T.length < i) T.push(nieuweTrack(T.length + 1));
    return T[i - 1];
  };
  track(Math.max(8, getal(log.kop?.tracks, 8)));
  const g = { t: 0, tracks: T, xfader: 0.5, curve: 'smooth', master: MASTER_STANDAARD, waarom: null };
  let gridControle = null;   // de track waarop de gridcontrole loopt (engine.gridControleDeck: één tegelijk)

  const lengteVan = (tr) => lengteUit(o, tr.nummer);
  const anker = (tr, t) => { tr.positie = positieOp(tr, t); tr.tStand = t; };
  const zetEind = (tr) => {
    const L = lengteVan(tr);
    tr.eind = tr.speelt && L !== null && !tr.loop && tr.positie !== null && tr.rate > 0 ? tr.tStand + Math.max(0, L - tr.positie) / tr.rate : null;
  };
  const start = (tr, t) => {
    anker(tr, t);
    // deck.play(): staat de speelkop op het einde (at ≥ duration − 0,01), dan begint hij opnieuw op 0.
    const L = lengteVan(tr);
    if (L !== null && tr.positie !== null && tr.positie >= L - 0.01) tr.positie = 0;
    tr.speelt = true; tr.sindsStart = t; tr.opCue = false; tr.remT = null;
  };
  const stop = (tr, t) => { anker(tr, t); tr.speelt = false; tr.eind = null; };
  const springNaar = (tr, t, p) => { anker(tr, t); tr.positie = p; tr.opCue = false; tr.onzeker = false; };
  const leeg = (tr, t, { titel = null, nummer = null, bron = null } = {}) => {
    Object.assign(tr, {
      titel, nummer, bron, laadId: tr.laadId + 1, speelt: false, sindsStart: null, eind: null, remT: null, instT: null,
      positie: 0, tStand: t, rate: 1, cue: 0, opCue: true, hotcues: [null, null, null, null], secties: null,
      loop: false, onzeker: false, stems: false, geenStems: false, stemNiveau: {}, stemKill: {}, stemVast: {},
    });
    if (gridControle === tr.nr) gridControle = null;   // een nieuw nummer: geen controle meer
  };

  function actie(tr, a, v, extra, t) {
    let m;
    if (a === 'play' || a === 'play.quant') {
      // Een druk wisselt (togglePlay); play.quant start op de volgende maat: binnen een maat, dat is hier "nu".
      if (v !== true || !tr.titel) return;
      if (tr.speelt) {
        if (lengteVan(tr) === null && tr.sindsStart !== null && t - tr.sindsStart >= o.langSpelen) tr.onzeker = true;
        stop(tr, t);
      } else start(tr, t);
    } else if (a === 'cue') {
      // deck.cue(): speelt -> terug naar het cuepunt en stil; stil op het cuepunt -> spelen;
      // stil elders -> het cuepunt hier zetten (en niet spelen).
      if (v !== true || !tr.titel) return;
      if (tr.speelt) { stop(tr, t); tr.positie = tr.cue; tr.opCue = true; }
      else if (tr.opCue === true) start(tr, t);
      else if (tr.opCue === false) { anker(tr, t); if (tr.positie !== null) tr.cue = tr.positie; tr.opCue = true; }
      else { start(tr, t); tr.onzeker = true; }
    } else if (a === 'seek') {
      const L = lengteVan(tr);
      springNaar(tr, t, L !== null && typeof v === 'number' ? klem01(v) * L : null);
    } else if ((m = /^hotcue\.(\d+)$/.exec(a))) {
      if (v !== true || !tr.titel) return;
      const i = Number(m[1]) - 1, h = tr.hotcues[i];
      if (Number.isFinite(h)) springNaar(tr, t, h);
      else tr.hotcues[i] = positieOp(tr, t);           // een lege hotcue ZET hem hier
    } else if ((m = /^hotcue\.(\d+)\.delete$/.exec(a))) {
      if (v === true) tr.hotcues[Number(m[1]) - 1] = null;
    } else if ((m = /^section\.(\d+)$/.exec(a))) {
      if (v !== true || !tr.titel) return;
      // `van` (vierde element) is waar de speelkop bij de druk stond: een gratis ijkpunt.
      if (Number.isFinite(extra?.van)) { tr.positie = extra.van; tr.tStand = t; }
      const doel = tr.secties?.stukken?.[Number(m[1]) - 1]?.van;
      if (Number.isFinite(doel)) springNaar(tr, t, doel);
    } else if ((m = /^section\.(next|prev)$/.exec(a))) {
      // deck.naarSectieStap: de sectie waar de speelkop staat (vanaf `van`) ± 1. Zonder kaart
      // in het log weten we niet waar hij landt: positie "?".
      if (v !== true || !tr.titel) return;
      if (Number.isFinite(extra?.van)) { tr.positie = extra.van; tr.tStand = t; }
      const st = Array.isArray(tr.secties?.stukken) ? tr.secties.stukken : [];
      const p = positieOp(tr, t);
      if (!st.length || p === null) { anker(tr, t); tr.positie = null; return; }
      let i = -1;
      st.forEach((s, k) => { if (Number.isFinite(s?.van) && s.van <= p + 1e-6) i = k; });
      const doel = st[i + (m[1] === 'next' ? 1 : -1)]?.van;
      if (Number.isFinite(doel)) springNaar(tr, t, doel);   // aan het eind of het begin: een melding, geen sprong
    } else if ((m = /^section\.(\d+)\.loop$/.exec(a))) {
      // deck.naarSectie(i, { loop }): de sectie wordt de loop; staat de speelkop er al in, dan blijft hij.
      if (v !== true || !tr.titel) return;
      if (Number.isFinite(extra?.van)) { tr.positie = extra.van; tr.tStand = t; }
      const st = tr.secties?.stukken, i = Number(m[1]) - 1, doel = st?.[i]?.van;
      if (!Number.isFinite(doel)) return;
      const p = positieOp(tr, t), tot = getal(st[i + 1]?.van, Infinity);
      if (!(p !== null && p >= doel && p < tot)) springNaar(tr, t, doel);
      tr.loop = true;
    } else if (/^(loop\.(\d|out|reloop)|beatloop\.)/.test(a)) {
      // Een loop gezien (loop.<s>, loop.out, reloop, beatloop.<n>): geen trackeinde meer te voorspellen.
      // loop.in zet alleen een beginpunt; loop.exit, halve en double maken er geen.
      if (v !== false) tr.loop = true;
    } else if (a === 'fader' || a === 'trim' || a === 'filter') {
      tr[a] = getal(v, tr[a]);
    } else if (a === 'fader.glide' || a === 'filter.glide') {
      // De auto-DJ (AUTO-DJ.md §2b): "glijd hierheen in 0,5 s". Hier meteen: een halve seconde valt in de afronding.
      const k = a.slice(0, -'.glide'.length);
      tr[k] = getal(v, tr[k]);
    } else if (a === 'low' || a === 'mid' || a === 'high') {
      tr.eq[a] = getal(v, tr.eq[a]);                    // de EQ-knop: onderaan (< 3%) is ook een kill (eqDb)
    } else if ((m = /^kill\.(low|mid|high)$/.exec(a))) {
      if (v === true) tr.kill[m[1]] = !tr.kill[m[1]];
    } else if ((m = /^kill\.(low|mid|high)\.hold$/.exec(a))) {
      tr.killVast[m[1]] = v === true;
    } else if (tr.geenStems && /^stem\./.test(a)) {
      // Dit nummer heeft geen stems (de beginstand zegt het: stemKill null); de engine negeert ze (stemBestaat).
    } else if ((m = /^stem\.(vocals|inst|drums|bass|other)$/.exec(a))) {
      tr.stems = true; tr.stemNiveau[m[1]] = getal(v, 1);
    } else if ((m = /^stem\.(vocals|inst|drums|bass|other)\.kill$/.exec(a))) {
      if (v === true) { tr.stems = true; tr.stemKill[m[1]] = !tr.stemKill[m[1]]; }
    } else if ((m = /^stem\.(vocals|inst|drums|bass|other)\.hold$/.exec(a))) {
      tr.stems = true; tr.stemVast[m[1]] = v === true;
    } else if (a === 'xfade.side') {
      if (v === true) tr.kant = KANTEN[(KANTEN.indexOf(tr.kant) + 1) % KANTEN.length];
    } else if ((m = /^xfade\.(a|b|thru)$/.exec(a))) {
      if (v === true) tr.kant = { a: 'A', b: 'B', thru: 'thru' }[m[1]];
    } else if (a === 'pitch') {
      if (typeof v === 'number') { anker(tr, t); tr.rate = 1 + (klem01(v) * 2 - 1) * tr.bereik; }
    } else if (a === 'pitch.range') {
      if (v === true) tr.bereik = PITCH_BEREIKEN[(PITCH_BEREIKEN.indexOf(tr.bereik) + 1) % PITCH_BEREIKEN.length];
    } else if (a === 'tempo') {
      if (typeof v === 'number') { anker(tr, t); tr.rate = RATE.min + klem01(v) * (RATE.max - RATE.min); }
    } else if (a === 'inst' || a === 'inst.next' || a === 'inst.prev' || a === 'inst.choose') {
      // Een track draagt een nummer óf een instrument (actions.js, kiesInstrument): een instrument
      // kiezen haalt het nummer eraf; speelt het, dan pas bij een tweede druk binnen 3 s.
      // inst.choose: de engine kiest round(v × INSTRUMENT_AANTAL); 0 is "geen" (en dan blijft het nummer).
      const kiest = a === 'inst.choose' ? typeof v === 'number' && Math.round(klem01(v) * INSTRUMENT_AANTAL) > 0 : v === true;
      if (!kiest || !tr.titel) return;
      if (tr.speelt && !(tr.instT !== null && t - tr.instT < 3)) { tr.instT = t; return; }
      stop(tr, t);
      leeg(tr, t);
    } else if (a === 'brake.time') {
      if (typeof v === 'number') tr.remTijd = REM.min * Math.pow(REM.max / REM.min, klem01(v));
    } else if (a === 'brake') {
      // deck.rem(): remmen tot stil in de remtijd (track.N.brake.time, standaard 1 s); nog eens drukken
      // TIJDENS het remmen = los. Daarna staat hij stil, en op een stil deck doet een rem niets.
      if (v !== true || !tr.titel) return;
      if (tr.remT !== null && t - tr.remT < tr.remTijd) { start(tr, t); tr.remT = null; }
      else if (tr.speelt) { stop(tr, t); tr.remT = t; }
    } else if (a === 'grid.controle') {
      // actions.js: de gridcontrole aan (nog eens = uit). Staat de track stil, dan springt hij naar het
      // eerste stuk om te controleren en SPEELT: waar dat is, en of er een grid was, ziet het log niet.
      if (v !== true || !tr.titel) return;
      if (gridControle === tr.nr) { gridControle = null; return; }
      gridControle = tr.nr;
      if (!tr.speelt) { start(tr, t); tr.positie = null; tr.onzeker = true; }
    }
    // De rest (sync, beatjump, nudge, bend, EQ-knoppen, sends, racks, keylock, …) verandert
    // niet OF je hem hoort; sync en beatjump wel waar hij is: de positie heet daarom "benaderd".
  }

  function gebeurtenis(r, t) {
    if (r.e === 'stand') {
      for (const x of r.tracks || []) {
        const tr = track(x.track);
        if (!tr) continue;
        leeg(tr, t, x.bron && x.bron !== 'leeg' ? { titel: x.titel ?? null, nummer: x.nummer ?? null, bron: x.bron } : {});
        if (!tr.titel && x.bron && x.bron !== 'leeg') tr.titel = '(zonder titel)';
        Object.assign(tr, {
          positie: getal(x.positie, 0), rate: getal(x.rate, 1), bereik: getal(x.bereik, tr.bereik), cue: getal(x.cue, 0),
          hotcues: Array.isArray(x.hotcues) ? [...x.hotcues] : tr.hotcues, secties: x.secties ?? null,
          kant: KANTEN.includes(x.kant) ? x.kant : standaardKant(tr.nr), loop: !!x.loop,
          kill: { low: !!x.kill?.low, mid: !!x.kill?.mid, high: !!x.kill?.high },
          // stemKill staat in de stand alleen als het nummer stems heeft (leesStand); null = geen stems.
          stems: !!x.stemKill, geenStems: x.stemKill === null, stemKill: { ...(x.stemKill || {}) },
        });
        tr.opCue = Math.abs(tr.positie - tr.cue) < 0.005;
        // Wachtte hij op de maat, dan begon hij binnen een maat: hier "nu".
        if (tr.titel && (x.speelt || x.wacht)) { tr.speelt = true; tr.sindsStart = t; }
      }
      for (const [k, v] of Object.entries(r.waarden || {})) {
        let m;
        if (k === 'mixer.xfader') g.xfader = getal(v, g.xfader);
        else if (k === 'mixer.master') g.master = getal(v, g.master);
        else if ((m = /^track\.(\d+)\.(fader|trim|filter)$/.exec(k))) { const tr = track(m[1]); if (tr) tr[m[2]] = getal(v, tr[m[2]]); }
        else if ((m = /^track\.(\d+)\.(low|mid|high)$/.exec(k))) { const tr = track(m[1]); if (tr) tr.eq[m[2]] = getal(v, 0.5); }
        else if ((m = /^track\.(\d+)\.stem\.(vocals|inst|drums|bass|other)$/.exec(k))) { const tr = track(m[1]); if (tr) tr.stemNiveau[m[2]] = getal(v, 1); }
        else if ((m = /^track\.(\d+)\.brake\.time$/.exec(k))) { const tr = track(m[1]); if (tr && typeof v === 'number') tr.remTijd = REM.min * Math.pow(REM.max / REM.min, klem01(v)); }
      }
      if (r.rond && 'mixer.xfader.curve' in r.rond) g.curve = r.rond['mixer.xfader.curve'] === 1 ? 'sharp' : 'smooth';
    } else if (r.e === 'laad') {
      const tr = track(r.track);
      // BufferBron.laad() roept stop(): het oude nummer is weg, het nieuwe staat stil op 0.
      if (tr) leeg(tr, t, { titel: r.titel ?? '(zonder titel)', nummer: r.nummer ?? null, bron: r.bron ?? null });
    } else if (r.e === 'hotcues') {
      const tr = track(r.track);
      if (tr && Array.isArray(r.hotcues)) tr.hotcues = [...r.hotcues];
    } else if (r.e === 'secties') {
      const tr = track(r.track);
      if (tr) tr.secties = r.secties ?? null;
    }
  }

  function* einden(tot) {
    for (;;) {
      let eerst = null;
      for (const tr of T) if (tr.speelt && tr.eind !== null && tr.eind <= tot && (!eerst || tr.eind < eerst.eind)) eerst = tr;
      if (!eerst) return;
      const te = eerst.eind;
      anker(eerst, te);
      eerst.positie = lengteVan(eerst);
      eerst.speelt = false;
      eerst.eind = null;
      g.t = te; g.waarom = { e: 'trackeinde', track: eerst.nr };
      yield g;
    }
  }

  let laatste = 0;
  for (const r of log.regels) {
    const t = tijdVan(r);
    if (!Number.isFinite(t)) continue;
    yield* einden(t);
    laatste = Math.max(laatste, t);
    if (Array.isArray(r)) {
      const [, id, v, extra] = r;
      let m;
      if (id === 'mixer.xfader') g.xfader = getal(v, g.xfader);
      else if (id === 'mixer.master') g.master = getal(v, g.master);
      else if (id === 'mixer.xfader.curve') { if (v === true) g.curve = g.curve === 'sharp' ? 'smooth' : 'sharp'; }
      else if (typeof id === 'string' && (m = /^track\.(\d+)\.(.+)$/.exec(id))) { const tr = track(m[1]); if (tr) actie(tr, m[2], v, extra, t); }
    } else if (r && typeof r === 'object') gebeurtenis(r, t);
    for (const tr of T) zetEind(tr);
    g.t = t; g.waarom = r;
    yield g;
  }
  const eind = Math.max(laatste, getal(log.eind?.t, 0), getal(log.duur, 0));
  yield* einden(eind);
  g.t = eind; g.waarom = { e: 'einde log', afgebroken: !log.eind };
  yield g;
}

// ---- hoorbaar --------------------------------------------------------------------

/** Zijn alle stems van deze track dicht (kill, vasthouden of niveau onder `stil`)? Bij vier stems is `inst` de groep drums + bas + overig. */
function stemsDicht(tr, stil) {
  const dicht = (s) => !!(tr.stemKill[s] || tr.stemVast[s]) || getal(tr.stemNiveau[s], 1) < stil;
  const vier = ['drums', 'bass', 'other'].some((s) => s in tr.stemNiveau || s in tr.stemKill);
  return dicht('vocals') && (dicht('inst') || (vier && dicht('drums') && dicht('bass') && dicht('other')));
}

/**
 * Klinkt deze track nu? `xg` = xfaderGains(g.xfader, g.curve).
 * @returns { ja, db, gefilterd }
 */
export function hoort(tr, g, xg, opties = {}) {
  const o = { ...STANDAARD, ...opties };
  const gefilterd = tr.filter <= o.filterRand || tr.filter >= 1 - o.filterRand;
  if (!tr.speelt || !tr.titel) return { ja: false, db: -Infinity, gefilterd };
  const kantGain = tr.kant === 'A' ? xg.a : tr.kant === 'B' ? xg.b : 1;
  const gain = klinkt(tr.fader, kantGain) * tr.trim * 2;
  const db = gain > 0 ? 20 * Math.log10(gain) : -Infinity;
  const bandWeg = (b) => tr.kill[b] || tr.killVast[b] || eqDb(tr.eq[b]) === EQ_KILL_DB;
  // De master gaat door faderGain (engine.js setMaster): dicht onder de drempel, dus master ≤ 1/3.
  const masterOpen = 20 * Math.log10(faderGain(getal(g.master, MASTER_STANDAARD))) > o.drempelDb;
  // Een stem is een lineaire factor (deck.stemNiveaus): dicht onder 10^(drempel/20) ≈ 0,03.
  const stil = 10 ** (o.drempelDb / 20);
  const ja = db > o.drempelDb && masterOpen && !BANDEN.every(bandWeg) && !(tr.stems && stemsDicht(tr, stil));
  return { ja, db, gefilterd };
}

/** Het sectielabel op tracktijd p, uit een sectiekaart ({ stukken: [{ van, label }] }). */
export function sectieOp(secties, p) {
  if (!Number.isFinite(p) || !Array.isArray(secties?.stukken)) return null;
  let label = null;
  for (const s of secties.stukken) if (Number.isFinite(s?.van) && s.van <= p + 1e-6) label = s.label ?? null;
  return label;
}

/** Een sprong in de bron (hotcue, sectie, seek, cue) binnen een hoorbaar stuk: verschil met wat er had moeten staan. */
const SPRONG = 0.5;
const verder = (a, t) => (a.positie === null ? null : a.positie + (a.speelt ? (t - a.tStand) * a.rate : 0));

/** Delen in de bron netjes: lege (< SPRONG) weg, aansluitende samen, onbekende (null) niet dubbel. */
function schoneDelen(delen) {
  const uit = [];
  for (const d of delen) {
    if (d.van !== null && d.tot !== null && Math.abs(d.tot - d.van) < SPRONG) continue;
    const v = uit[uit.length - 1];
    if (v && v.van === null && d.van === null) continue;
    if (v && v.tot !== null && d.van !== null && Math.abs(d.van - v.tot) < SPRONG) { v.tot = d.tot; continue; }
    uit.push({ ...d });
  }
  return uit;
}

/**
 * De flitsen eruit (korter dan minDuur); hun seconden gaan naar "geladen maar niet hoorbaar".
 * `per`: sleutel → geladen item (twee sleutels kunnen naar hetzelfde item wijzen: hetzelfde
 * nummer over de grens van twee logs). `lijst`: elk item één keer.
 */
function zonderFlitsen(samen, lijst, per, duur, o) {
  const stukken = [];
  for (const s of samen) {
    if (duur(s) >= o.minDuur) stukken.push(s);
    else for (const x of new Set(s.sleutels.map((k) => per.get(k)).filter(Boolean))) x.kortHoorbaar += duur(s);
  }
  const gehoord = new Set(stukken.flatMap((s) => s.sleutels.map((k) => per.get(k))));
  return { stukken, nietHoorbaar: lijst.filter((x) => !gehoord.has(x)) };
}

/** Interne velden weg (sleutels), voor de uitvoer. */
const netjes = (x) => { const { sleutels, sleutel, ...rest } = x; return rest; };

/**
 * De hoorbare stukken van één log.
 * @returns { stukken: [{ track, laadId, titel, nummer, bron, lengte, van, tot, delen: [{ van, tot }] (in de bron), posVan, posTot,
 *                        sectie, gefilterd, onzeker, loop }],
 *            nietHoorbaar: [{ track, laadId, titel, nummer, bron, t, kortHoorbaar }], eind, afgebroken }
 * Met `opties.ruw`: de stukken nog MET de flitsen (setboek() lijmt eerst over de logs heen),
 * elk met `sleutels`, en `geladen` (alles wat er stond, met `sleutel`) in plaats van nietHoorbaar.
 */
export function hoorbaar(log, opties = {}) {
  const o = { ...STANDAARD, ...opties };
  const open = new Map(), ruw = [], geladen = new Map();
  const sluit = (s, t) => {
    s.tot = t;
    s.delen[s.delen.length - 1].tot = verder(s.anker, t);
    delete s.anker;
    ruw.push(s);
  };
  let eind = 0, afgebroken = false;
  for (const g of toestand(log, o)) {
    eind = g.t;
    if (g.waarom?.e === 'einde log') afgebroken = g.waarom.afgebroken;
    const xg = xfaderGains(g.xfader, g.curve);
    for (const tr of g.tracks) {
      const sleutel = `${tr.nr}:${tr.laadId}`;
      if (tr.titel && !geladen.has(sleutel)) geladen.set(sleutel, { track: tr.nr, laadId: tr.laadId, titel: tr.titel, nummer: tr.nummer, bron: tr.bron, t: g.t, kortHoorbaar: 0 });
      const h = hoort(tr, g, xg, o);
      let s = open.get(tr.nr);
      if (s && s.laadId === tr.laadId) {
        s.onzeker ||= tr.onzeker;
        s.loop ||= tr.loop;
        if (h.ja) s.gefilterd ||= h.gefilterd;
        // Sprong in de bron? Dan een nieuw deel: "1:23–1:50, 0:30–1:01".
        const verwacht = verder(s.anker, g.t), nu = positieOp(tr, g.t), deel = s.delen[s.delen.length - 1];
        if ((verwacht === null) !== (nu === null) || (nu !== null && Math.abs(nu - verwacht) > SPRONG)) { deel.tot = verwacht; s.delen.push({ van: nu, tot: nu }); }
        else deel.tot = nu;
        s.anker = { positie: tr.positie, tStand: tr.tStand, rate: tr.rate, speelt: tr.speelt };
      }
      if (s && (!h.ja || s.laadId !== tr.laadId)) { sluit(s, g.t); open.delete(tr.nr); s = null; }
      if (h.ja && !s) {
        const p = positieOp(tr, g.t);
        open.set(tr.nr, {
          track: tr.nr, laadId: tr.laadId, titel: tr.titel, nummer: tr.nummer, bron: tr.bron, lengte: lengteUit(o, tr.nummer),
          van: g.t, delen: [{ van: p, tot: p }],
          secties: tr.secties, gefilterd: h.gefilterd, onzeker: tr.onzeker, loop: tr.loop,
          anker: { positie: tr.positie, tStand: tr.tStand, rate: tr.rate, speelt: tr.speelt },
        });
      }
    }
  }
  for (const s of open.values()) sluit(s, eind);

  // Samenvoegen per laad (een kill of een fader die even dicht ging), dan de flitsen eruit.
  ruw.sort((a, b) => a.track - b.track || a.laadId - b.laadId || a.van - b.van);
  const samen = [];
  for (const s of ruw) {
    const v = samen[samen.length - 1];
    if (v && v.track === s.track && v.laadId === s.laadId && s.van - v.tot < o.samenvoegen) {
      v.tot = s.tot; v.delen.push(...s.delen);
      v.gefilterd ||= s.gefilterd; v.onzeker ||= s.onzeker; v.loop ||= s.loop;
    } else samen.push({ ...s, delen: [...s.delen] });
  }
  for (const s of samen) {
    s.delen = schoneDelen(s.delen);
    s.posVan = s.delen[0]?.van ?? null;
    s.posTot = s.delen[s.delen.length - 1]?.tot ?? null;
    s.sectie = sectieOp(s.secties, s.posVan);
    delete s.secties;
    s.sleutels = [`${s.track}:${s.laadId}`];
  }
  const lijst = [...geladen.entries()].map(([k, x]) => ({ ...x, sleutel: k }));
  if (o.ruw) return { stukken: samen, geladen: lijst, eind, afgebroken };
  const per = new Map(lijst.map((x) => [x.sleutel, x]));
  const { stukken, nietHoorbaar } = zonderFlitsen(samen, lijst, per, (s) => s.tot - s.van, o);
  stukken.sort((a, b) => a.van - b.van || a.track - b.track);
  nietHoorbaar.sort((a, b) => a.t - b.t || a.track - b.track);
  return { stukken: stukken.map(netjes), nietHoorbaar: nietHoorbaar.map(netjes), eind, afgebroken };
}

/**
 * Van–tot in de bron als tekst ('1:23–2:24'; met een sprong '1:23–1:50, 0:30–1:01'),
 * of null als de positie nergens te weten was.
 */
export function positieInBron(stuk) {
  const delen = stuk.delen ?? [{ van: stuk.posVan, tot: stuk.posTot }];
  if (!delen.some((d) => Number.isFinite(d.van) && Number.isFinite(d.tot))) return null;
  return delen.map((d) => (Number.isFinite(d.van) && Number.isFinite(d.tot) ? `${duurTekst(d.van)}–${duurTekst(d.tot)}` : '?')).join(', ');
}

// ---- de proefsessie (Controlekamer) -------------------------------------------------

/**
 * De punten van een proefsessie (`proef/sessie.json`: { begonnen, items: { id: { status, notitie, tijd } } },
 * server/proef.js) op de klok van de avond. Alleen punten met status 'fout' of met een notitie.
 * `tijd` is wanneer het punt het laatst werd afgevinkt, niet wanneer het misging: "rond".
 * Per punt ook wat er toen klonk (de stukken die de tijd omvatten).
 *
 * De sessie wordt alleen leeggemaakt met "nieuwe ronde" (Controlekamer), en `begonnen` is het
 * EERSTE VINKJE, geen startknop (proef.js: d.begonnen ??= nu). Met `venster` ({ van, tot } in ms,
 * de logs ± proefMarge) komen punten daarbuiten niet op de tijdlijn maar in `buiten`, en telt
 * `begonnen` alleen als hij erin valt.
 * @returns { begonnenMs | null, begonnenBuitenMs | null, punten, buiten: { eerder, later, oudsteMs, nieuwsteMs } }
 */
export function proefpunten(sessie, stukken = [], venster = null) {
  const items = sessie && typeof sessie.items === 'object' && sessie.items ? sessie.items : {};
  const b = Date.parse(sessie?.begonnen ?? '');
  const binnen = (ms) => !venster || (ms >= venster.van && ms <= venster.tot);
  const punten = [], buiten = { eerder: 0, later: 0, oudsteMs: null, nieuwsteMs: null };
  for (const [id, x] of Object.entries(items)) {
    const klokMs = Date.parse(x?.tijd ?? '');
    const notitie = typeof x?.notitie === 'string' ? x.notitie.trim() : '';
    if (!(x?.status === 'fout' || notitie)) continue;
    if (Number.isFinite(klokMs) && !binnen(klokMs)) {
      buiten[klokMs < venster.van ? 'eerder' : 'later']++;
      buiten.oudsteMs = Math.min(buiten.oudsteMs ?? Infinity, klokMs);
      buiten.nieuwsteMs = Math.max(buiten.nieuwsteMs ?? -Infinity, klokMs);
      continue;
    }
    const klonk = Number.isFinite(klokMs) ? stukken.filter((s) => s.klokVan <= klokMs && klokMs <= s.klokTot).map((s) => `T${s.track} ${s.titel}`) : [];
    punten.push({ id, status: x.status ?? 'open', notitie, klokMs: Number.isFinite(klokMs) ? klokMs : null, klonk });
  }
  punten.sort((a, b) => (a.status === 'fout' ? 0 : 1) - (b.status === 'fout' ? 0 : 1) || (a.klokMs ?? Infinity) - (b.klokMs ?? Infinity));
  return {
    begonnenMs: Number.isFinite(b) && binnen(b) ? b : null,
    begonnenBuitenMs: Number.isFinite(b) && !binnen(b) ? b : null,
    punten, buiten,
  };
}

// ---- alles samen -----------------------------------------------------------------

/**
 * Het setboek van een avond.
 * @param bestanden [{ bestand, tekst }]: kopieën van de logs
 * @returns { dag, logs, gaten, overgeslagen, stukken, nietHoorbaar, gebruik, onzeker, instellingen, melding }
 */
export function setboek(bestanden, opties = {}) {
  const o = { ...STANDAARD, ...opties };
  const r = rijgLogs(bestanden, o);
  const begin = r.logs[0]?.begonMs ?? 0;
  const ruwe = [], lijst = [], per = new Map(), alleRegels = [];
  const wie = (x) => (x.nummer != null ? `n:${x.nummer}` : `t:${x.titel}`);
  let vorigLog = new Map();   // track → geladen item aan het eind van het vorige log
  for (const l of r.logs) {
    const off = (l.begonMs - begin) / 1000;
    const h = hoorbaar(l.log, { ...o, ruw: true });
    for (const s of h.stukken) {
      ruwe.push({ ...s, sleutels: s.sleutels.map((k) => `${l.id}:${k}`), log: [l.id],
        avondVan: off + s.van, avondTot: off + s.tot, klokVan: l.begonMs + s.van * 1000, klokTot: l.begonMs + s.tot * 1000 });
    }
    // Een opname starten of stoppen sluit het log en begint een nieuw (HANDELINGENLOG): wat in de
    // beginstand van dit log op een track staat en aan het eind van het vorige log daar ook stond,
    // is DEZELFDE laad, geen nieuwe.
    const ditLog = new Map();
    for (const x of h.geladen) {
      const item = { ...x, sleutel: `${l.id}:${x.sleutel}`, log: l.id, klokMs: l.begonMs + x.t * 1000 };
      const vorig = vorigLog.get(x.track);
      const zelfde = x.t === 0 && x.laadId === 1 && vorig && wie(vorig) === wie(item);
      if (zelfde) per.set(item.sleutel, vorig);
      else { per.set(item.sleutel, item); lijst.push(item); }
      ditLog.set(x.track, per.get(item.sleutel));
    }
    vorigLog = ditLog;
    for (const x of l.log.regels) alleRegels.push(Array.isArray(x) ? [x[0] + off, x[1]] : x);
  }
  // Lijmen over de grens van twee logs: dezelfde laad (zie boven) en een gat korter dan `samenvoegen`.
  // Pas daarna de flitsen eruit: 14 s vóór de grens + 15 s erna is één nummer van 29 s.
  ruwe.sort((a, b) => a.klokVan - b.klokVan || a.track - b.track);
  const samen = [], laatste = new Map();
  for (const s of ruwe) {
    const v = laatste.get(s.track);
    if (v && per.get(v.sleutels[0]) === per.get(s.sleutels[0]) && s.klokVan - v.klokTot < o.samenvoegen * 1000) {
      v.klokTot = Math.max(v.klokTot, s.klokTot);
      v.avondTot = Math.max(v.avondTot, s.avondTot);
      v.tot = v.van + (v.klokTot - v.klokVan) / 1000;   // van/tot: seconden in het eerste log van het stuk
      v.delen = schoneDelen([...v.delen, ...s.delen]);
      v.posTot = v.delen[v.delen.length - 1]?.tot ?? null;
      for (const id of s.log) if (!v.log.includes(id)) v.log.push(id);
      v.sleutels.push(...s.sleutels);
      v.gefilterd ||= s.gefilterd; v.onzeker ||= s.onzeker; v.loop ||= s.loop;
      v.lengte ??= s.lengte;
    } else { samen.push(s); laatste.set(s.track, s); }
  }
  const h = zonderFlitsen(samen, lijst, per, (s) => (s.klokTot - s.klokVan) / 1000, o);
  const stukken = h.stukken.sort((a, b) => a.klokVan - b.klokVan || a.track - b.track).map(netjes);
  const nietHoorbaar = h.nietHoorbaar.sort((a, b) => a.klokMs - b.klokMs || a.track - b.track).map(netjes);
  // De proefsessie: alleen punten rond deze avond (de logs ± proefMarge).
  const eindMs = Math.max(...r.logs.map((l) => l.begonMs + l.duur * 1000));
  const venster = r.logs.length ? { van: begin - o.proefMarge * 1000, tot: eindMs + o.proefMarge * 1000 } : null;
  const proef = o.proef ? proefpunten(o.proef, stukken, venster) : null;
  if (proef?.begonnenMs != null) for (const s of stukken) s.deel = s.klokVan >= proef.begonnenMs ? 'speellijst' : 'vrij';
  return {
    dag: r.dag,
    logs: r.logs.map(({ id, bestand, begonMs, duur, acties, opname, af, afgebroken, kapot }) => ({ id, bestand, begonMs, duur, acties, opname, af, afgebroken, kapot })),
    gaten: r.gaten, overgeslagen: r.overgeslagen, stukken, nietHoorbaar,
    gebruik: tellingen(alleRegels),
    onzeker: stukken.filter((s) => s.onzeker).length,
    instellingen: { drempelDb: o.drempelDb, minDuur: o.minDuur, samenvoegen: o.samenvoegen, lang: o.lang, lengte: typeof o.lengte === 'function' },
    proef,
    melding: r.logs.length ? null : 'geen log van die dag met acties',
  };
}

export const naarJson = (res) => JSON.stringify(res, null, 2);

const cel = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Het setboek als Markdown (Nederlands), voor Clay en de agent van de volgende ochtend. */
export function naarMarkdown(res) {
  const r = [];
  r.push(`# Setboek ${res.dag ?? ''}`.trim(), '');
  if (res.melding) {
    r.push(`**${res.melding}.** Liep er een log (● opname, ○ log, of het vinkje "altijd" achter ↺)?`, '');
    if (res.overgeslagen.length) r.push(`Overgeslagen: ${res.overgeslagen.map((x) => `${x.id} (${x.reden})`).join(', ')}.`, '');
    return r.join('\n');
  }
  r.push('## Logs', '');
  for (const l of res.logs) {
    r.push(`- ${l.id}: ${kloktijd(l.begonMs)}–${kloktijd(l.begonMs + l.duur * 1000)} (${duurTekst(l.duur)}), ${l.acties} acties, `
      + `${l.opname ? `opname ${l.opname}` : 'los log'}, ${l.af ? 'netjes af' : `niet netjes af (${l.afgebroken})`}${l.kapot ? `, ${l.kapot} kapotte regel(s)` : ''}`);
  }
  for (const gat of res.gaten) r.push(`- gat van ${duurTekst(gat.s)}: log opnieuw begonnen ${kloktijd(gat.totMs)} (herladen?)`);
  if (res.overgeslagen.length) r.push(`- overgeslagen: ${res.overgeslagen.map((x) => `${x.id} (${x.reden})`).join(', ')}`);
  r.push('', '## Tracklist (hoorbaar, benaderd)', '');
  if (!res.stukken.length) r.push('Niets was langer dan ' + res.instellingen.minDuur + ' s hoorbaar.');
  else {
    r.push('| # | avond | klok | track | titel | bron | in de bron | opmerking |', '|---|---|---|---|---|---|---|---|');
    res.stukken.forEach((s, i) => {
      const inBron = [positieInBron(s), s.sectie].filter(Boolean).join(' · ') || '?';
      const opm = [s.gefilterd && 'gefilterd', s.loop && 'loop', s.onzeker && '(onzeker)'].filter(Boolean).join(', ');
      r.push(`| ${i + 1} | ${duurTekst(s.avondVan)}–${duurTekst(s.avondTot)} | ${kloktijd(s.klokVan)} | T${s.track} | ${cel(s.titel)} | ${cel(s.bron)} | ${inBron} | ${opm} |`);
    });
  }
  if (res.proef) {
    const p = res.proef;
    r.push('', '## Proefpunten (Controlekamer)', '');
    if (p.begonnenMs !== null) {
      const n = (d) => res.stukken.filter((s) => s.deel === d).length;
      r.push(`Eerste proefpunt afgevinkt ${klokOp(p.begonnenMs, res.dag)} (\`begonnen\` in de sessie: het eerste vinkje, geen startknop). `
        + `Daarvóór ${n('vrij')} stuk(ken) (vrij spelen?), daarna ${n('speellijst')} (de speellijst?).`, '');
    }
    const bu = p.buiten ?? { eerder: 0, later: 0 }, nb = bu.eerder + bu.later;
    if (nb || p.begonnenBuitenMs != null) {
      const wanneer = bu.later === 0 ? 'eerder' : bu.eerder === 0 ? 'later' : 'een andere dag';
      const datums = nb === 1 ? datumKort(bu.oudsteMs) : bu.eerder && !bu.later ? `oudste ${datumKort(bu.oudsteMs)}` : `${datumKort(bu.oudsteMs)}–${datumKort(bu.nieuwsteMs)}`;
      r.push((nb ? `${nb} ${nb === 1 ? 'punt' : 'punten'} van ${wanneer} (${datums}), niet getoond. ` : '')
        + (p.begonnenBuitenMs != null ? `De sessie begon ${datumKort(p.begonnenBuitenMs)} ${kloktijd(p.begonnenBuitenMs)}: geen splitsing vrij/speellijst. ` : '')
        + 'Archiveer de sessie vóór een avond (Controlekamer: nieuwe ronde).', '');
    }
    if (!p.punten.length) r.push(`Geen punt${nb ? ' van deze avond' : ''} met "fout" of een notitie.`);
    for (const x of p.punten) {
      r.push(`- ${x.status === 'fout' ? '**fout**' : x.status} · ${x.id} · rond ${klokOp(x.klokMs, res.dag)}${x.notitie ? ` · "${cel(x.notitie)}"` : ''}${x.klonk.length ? ` · toen hoorbaar: ${x.klonk.map(cel).join(', ')}` : ''}`);
    }
  }
  r.push('', '## Geladen maar niet hoorbaar', '');
  if (!res.nietHoorbaar.length) r.push('Geen.');
  for (const x of res.nietHoorbaar) r.push(`- ${kloktijd(x.klokMs)} · T${x.track} · ${x.titel}${x.kortHoorbaar > 0 ? ` (${Math.round(x.kortHoorbaar)} s hoorbaar)` : ''}`);
  const gb = res.gebruik;
  r.push('', '## Gebruik', '', `${gb.acties} acties, ${gb.laads} keer geladen, ${gb.actieveMinuten} actieve minuten.`, '');
  for (const x of gb.top) r.push(`- ${x.id}: ${x.n}`);
  r.push('', '## Wat werkte', '', '- ', '', '## Wat niet', '', '- ', '', '## Volgende keer', '', '- ');
  r.push('', '## Buma/Stemra (hoorbare nummers)', '');
  const gezien = new Set(), LANG = res.instellingen.lang ?? STANDAARD.lang;
  for (const s of res.stukken) {
    // Een mix: het nummer is lang (lengte uit --db), of de speelkop kwam voorbij LANG. Welke titel er
    // in die mix klonk, weet het setboek niet: "titel onbekend: deel van …".
    const lang = (Number.isFinite(s.lengte) && s.lengte >= LANG) || (s.delen ?? []).some((d) => Number.isFinite(d.tot) && d.tot >= LANG);
    const pos = positieInBron(s), ergensVraag = (s.delen ?? []).some((d) => !Number.isFinite(d.van) || !Number.isFinite(d.tot));
    const regel = lang ? `titel onbekend: deel van "${s.titel}" ${pos ?? '(positie onbekend)'}`
      : !Number.isFinite(s.lengte) && ergensVraag ? `${s.titel} (lengte onbekend)` : s.titel;
    if (!gezien.has(regel)) { gezien.add(regel); r.push(`- ${regel}`); }
  }
  if (!res.stukken.length) r.push('Geen.');
  else if (!res.instellingen.lengte) r.push('', `Zonder --db: een lange mix die je vóór ${duurTekst(LANG)} verliet, staat hier als gewone titel.`);
  const i = res.instellingen;
  r.push('', '## Hoe dit gemaakt is', '',
    `Hoorbaar = de track speelt, er staat een nummer op, fader × crossfaderkant × trim boven ${i.drempelDb} dB, niet alle drie de EQ-banden weg (kill of knop onderaan), niet alle stems dicht, master boven ${i.drempelDb} dB (faderGain). `
    + `Korter dan ${i.minDuur} s telt niet; gaten korter dan ${i.samenvoegen} s zijn gelijmd, ook over de grens van twee logs. Tijden en posities in de bron zijn benaderd (het log is de partituur van de bus, geen meting van het geluid).`,
    '',
    `Het log ziet niet: het einde van een nummer${i.lengte ? ' (geschat uit de lengte in de library, alleen zonder loop)' : ' (zonder library-kopie niet geschat)'}, `
    + 'waar sync, beatjump en loops de speelkop zetten, welk tempo sync kiest (dan lopen positie en einde weg), of een geladen nummer stems heeft, '
    + 'de sampler, instrumenten en patronen, en effecten die het geluid dichtdraaien.',
    '', `${res.onzeker} stuk(ken) "(onzeker)": de speelkop of het spelen is daar niet zeker uit het log af te leiden.`);
  return r.join('\n') + '\n';
}
