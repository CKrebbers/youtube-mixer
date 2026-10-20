#!/usr/bin/env node
/**
 * De telling voor v2: wat Clay's handen ECHT doen, uit KOPIEËN van de handelingenlogs
 * (`set-*.acties.jsonl`, docs/HANDELINGENLOG.md). Leest alleen. Schrijft één JSON:
 * standaard naar stdout, met --uit naar een bestand (nooit over een ander bestand heen,
 * nooit in de map met logs).
 *
 *   node v2/telling/tel.mjs <map-met-logs> [--uit telling.json]
 *
 * Hergebruikt, niet gekopieerd:
 * - src/handen/telling.js: normaliseer, groep, legeTelling, telLog, top (de telling van docs/HANDEN.md §4);
 * - src/control/handelingen.js: leesLog (kop, duur uit de t-kolom, kapotte regels);
 * - tools/handen/register.mjs: bouwRegister (de 3251 actions van actions.js op dubbels, zoals handenkaart.mjs);
 * - src/control/mapping.js: resolveTarget ({focus} {speel} {plek} in de standaardmappings).
 *
 * Wat het log NIET zegt: de bron van een handeling (MIDI, muis, toets). En het register kent alleen
 * wat actions.js zelf bindt; wat de aanhakers van de werkruimte binden (werk.*, plan.*, set.*, …)
 * staat onder `nietInRegister` als het in een log voorkomt (docs/HANDEN.md §6).
 * Zie v2/telling/LEESMIJ.md. Exit: 0 goed, 1 verkeerd aangeroepen, 2 --uit mag niet.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseer, groep, legeTelling, telLog, top } from '../../src/handen/telling.js';
import { leesLog } from '../../src/control/handelingen.js';
import { resolveTarget } from '../../src/control/mapping.js';

const WORTEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SOORT = 'varve-telling';
export const VERSIE = 1;
/** De standaardmappings die meetellen (het fragment vorm alleen met ?vormen=1, apart). */
export const MAPPINGS = ['apc40mk2.json', 'apc40mk2-vormen.json', 'maschine-mk2.json', 'xboard49.json'];
/** Een avond loopt over middernacht: vóór 06:00 telt bij de dag ervóór (zoals het setboek). */
const AVOND_GRENS_UUR = 6;

const TZ = 'Europe/Amsterdam';
const dagFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const tijdFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dag = (ms) => (Number.isFinite(ms) ? dagFmt.format(new Date(ms)) : null);
const avond = (ms) => (Number.isFinite(ms) ? dagFmt.format(new Date(ms - AVOND_GRENS_UUR * 3600e3)) : null);
const klok = (ms) => (Number.isFinite(ms) ? tijdFmt.format(new Date(ms)).replace(' ', 'T') : null);
const rond = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;

/**
 * Het begin van een log in ms: `kop.begon`, anders de naam `set-JJJJMMDD-UUMMSS` (lokale tijd van
 * de Mac, dus Amsterdam), anders null.
 */
export function begonVan(kop, naam) {
  const k = Date.parse(kop?.begon ?? '');
  if (Number.isFinite(k)) return k;
  const m = /set-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(String(naam));
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  for (const uur of [2, 1, 0, 3]) {
    const ms = utc - uur * 3600e3;
    if (klok(ms) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`) return ms;
  }
  return null;
}

/** Alle genormaliseerde actions van een mapping (sjablonen met track 1 en plek 1 ingevuld), met het aantal regels. */
export function mappingActies(mapping) {
  const per = new Map();
  for (const r of mapping?.rules ?? []) {
    if (typeof r?.action !== 'string') continue;
    const a = normaliseer(resolveTarget(r.action, { focus: 1, speel: 1, plek: 1 }));
    per.set(a, (per.get(a) || 0) + 1);
  }
  return per;
}

/** Tel per groep: Map(groep → aantal) uit een lijst genormaliseerde actions. */
function perGroepVan(acties) {
  const g = {};
  for (const a of acties) g[groep(a)] = (g[groep(a)] || 0) + 1;
  return Object.fromEntries(Object.entries(g).sort((x, y) => y[1] - x[1]));
}

/**
 * De telling, puur (geen fs). `logs` = [{ naam, tekst }] (op naam gesorteerd is het netst),
 * `register` = alle action-ids (ruw, `track.3.fader`), `mappings` = { bestandsnaam: mapping-JSON }.
 */
export function tel(logs, { register = [], registerFouten = [], mappings = {}, map = null, nu = new Date() } = {}) {
  const totaal = legeTelling();
  const perActie = new Map(); // a → { logs:Set, avonden:Set, eersteMs, laatsteMs }
  const perLog = [];
  let kapot = 0;
  for (const { naam, tekst } of logs) {
    const schoon = String(tekst).replace(/\0+/g, ''); // zoals leesLog: een gat in het bestand is NUL
    const log = leesLog(schoon);
    kapot += log.kapot;
    const deze = telLog(legeTelling(), schoon, naam);
    telLog(totaal, schoon, naam);
    const begon = begonVan(log.kop, naam);
    const avondVan = avond(begon);
    for (const r of log.regels) {
      if (!Array.isArray(r)) continue;
      const a = normaliseer(r[1]);
      const ms = Number.isFinite(begon) && Number.isFinite(r[0]) ? begon + r[0] * 1000 : null;
      let s = perActie.get(a);
      if (!s) perActie.set(a, (s = { logs: new Set(), avonden: new Set(), eersteMs: null, laatsteMs: null }));
      s.logs.add(naam);
      if (avondVan) s.avonden.add(avondVan);
      if (ms !== null) {
        if (s.eersteMs === null || ms < s.eersteMs) s.eersteMs = ms;
        if (s.laatsteMs === null || ms > s.laatsteMs) s.laatsteMs = ms;
      }
    }
    perLog.push({
      bestand: naam, datum: dag(begon), avond: avondVan, begon: klok(begon),
      duur: rond(log.duur, 1), handelingen: deze.acties, regels: deze.regels, kapot: log.kapot,
      opname: log.kop?.opname ?? null, afgebroken: log.eind?.afgebroken ?? null,
      top5: top(deze, 5).map(([actie, aantal]) => ({ actie, aantal })),
    });
  }

  const reg = new Set(register.map(normaliseer));
  const mapActies = Object.fromEntries(Object.entries(mappings).map(([f, m]) => [f, mappingActies(m)]));
  const inMapping = (a) => Object.keys(mapActies).filter((f) => mapActies[f].has(a));
  const gebruikt = new Set(totaal.per.keys());
  const avondenAlle = new Set(perLog.map((l) => l.avond).filter(Boolean));

  const acties = top(totaal, Infinity).map(([actie, aantal], i) => {
    const s = perActie.get(actie);
    return {
      nr: i + 1, actie, groep: groep(actie), aantal, aandeel: totaal.acties ? rond(aantal / totaal.acties, 6) : 0,
      logs: s?.logs.size ?? 0, avonden: s?.avonden.size ?? 0, eerste: dag(s?.eersteMs), laatste: dag(s?.laatsteMs),
      inRegister: reg.has(actie), inMapping: inMapping(actie),
    };
  });

  // Groepen: totaal en aandeel van de handelingen, plus hoeveel actions de app in die groep kent.
  const groepen = new Map();
  const g = (naam) => { if (!groepen.has(naam)) groepen.set(naam, { groep: naam, handelingen: 0, aandeel: 0, gebruikt: 0, register: 0, registerNooit: 0, inMapping: 0, mappingNooit: 0 }); return groepen.get(naam); };
  for (const r of acties) { const x = g(r.groep); x.handelingen += r.aantal; x.gebruikt++; }
  for (const a of reg) { const x = g(groep(a)); x.register++; if (!gebruikt.has(a)) x.registerNooit++; }
  const alleMapping = new Set(Object.values(mapActies).flatMap((m) => [...m.keys()]));
  for (const a of alleMapping) { const x = g(groep(a)); x.inMapping++; if (!gebruikt.has(a)) x.mappingNooit++; }
  for (const x of groepen.values()) x.aandeel = totaal.acties ? rond(x.handelingen / totaal.acties, 6) : 0;

  const nooitReg = [...reg].filter((a) => !gebruikt.has(a)).sort();
  const ruwNooit = register.filter((id) => !gebruikt.has(normaliseer(id))).length;

  const perMapping = Object.entries(mapActies).map(([bestand, m]) => {
    const nooit = [...m.keys()].filter((a) => !gebruikt.has(a)).sort();
    const regels = [...m.values()].reduce((s, n) => s + n, 0);
    const regelsNooit = nooit.reduce((s, a) => s + m.get(a), 0);
    return {
      bestand, regels, acties: m.size, nooit: nooit.length, regelsNooit,
      perGroep: perGroepVan(nooit),
      lijst: nooit.map((a) => ({ actie: a, groep: groep(a), regels: m.get(a) })),
    };
  });
  const samenNooit = [...alleMapping].filter((a) => !gebruikt.has(a)).sort();

  return {
    soort: SOORT, versie: VERSIE, gemaakt: nu.toISOString(), map,
    grens: 'Het log kent geen bron (MIDI, muis, toets). Genormaliseerd zoals src/handen/telling.js (track.3.fader → track.N.fader). '
      + 'Het register is wat src/control/actions.js bindt (tools/handen/register.mjs); actions van de aanhakers staan onder nietInRegister.',
    bron: {
      logs: totaal.logs, avonden: avondenAlle.size, regels: totaal.regels, handelingen: totaal.acties, kapotteRegels: kapot,
      eerste: perLog.map((l) => l.begon).filter(Boolean).sort()[0] ?? null,
      laatste: perLog.map((l) => l.begon).filter(Boolean).sort().at(-1) ?? null,
      duurTotaal: rond(perLog.reduce((s, l) => s + l.duur, 0), 1),
      register: { acties: register.length, genormaliseerd: reg.size, fouten: registerFouten },
      mappings: Object.keys(mappings),
    },
    acties,
    groepen: [...groepen.values()].sort((a, b) => b.handelingen - a.handelingen || b.register - a.register),
    logs: perLog,
    nooitGebruikt: {
      uitleg: 'Actions die de app kent (register, genormaliseerd) en die in geen enkel log voorkomen.',
      genormaliseerd: nooitReg.length, vanGenormaliseerd: reg.size, ruw: ruwNooit, vanRuw: register.length,
      perGroep: perGroepVan(nooitReg),
      lijst: nooitReg.map((a) => ({ actie: a, groep: groep(a), inMapping: inMapping(a) })),
    },
    mappingNooitGebruikt: {
      uitleg: 'Actions die in een standaardmapping op een knop staan en in geen enkel log voorkomen. regelsNooit = regels (knop × laag × shift) die nooit vuurden.',
      samen: { acties: alleMapping.size, nooit: samenNooit.length, perGroep: perGroepVan(samenNooit) },
      perMapping,
    },
    nietInRegister: acties.filter((r) => !r.inRegister).map(({ actie, groep: gr, aantal }) => ({ actie, groep: gr, aantal })),
  };
}

// ---- CLI --------------------------------------------------------------------------------------

const GEBRUIK = 'gebruik: node v2/telling/tel.mjs <map-met-logs> [--uit telling.json]';
const binnen = (map, pad) => { const r = relative(resolve(map), resolve(pad)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/** Waarom --uit niet mag, of null: nieuw, of een eerdere telling; nooit in de map met logs. */
export function uitWeigering(pad, logMap) {
  if (binnen(logMap, pad)) return `--uit ${pad} ligt in de map met logs: daar schrijft dit script niets`;
  if (!existsSync(pad)) return existsSync(dirname(resolve(pad))) ? null : `--uit ${pad}: de map ${dirname(resolve(pad))} bestaat niet`;
  if (!statSync(pad).isFile()) return `--uit ${pad} is geen gewoon bestand`;
  try { if (JSON.parse(readFileSync(pad, 'utf8'))?.soort === SOORT) return null; } catch { /* geen JSON */ }
  return `--uit ${pad} bestaat al en is geen eerdere telling: niets geschreven (kies een ander pad)`;
}

function leesMappings() {
  const uit = {};
  for (const f of MAPPINGS) {
    const p = join(WORTEL, 'mappings', f);
    if (existsSync(p)) uit[f] = JSON.parse(readFileSync(p, 'utf8'));
  }
  return uit;
}

export async function hoofd(argv) {
  let map = null, uit = null;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--uit') { uit = argv[++i]; if (!uit || uit.startsWith('--')) { console.error(`--uit zonder pad\n${GEBRUIK}`); return 1; } }
    else if (k === '-h' || k === '--help') { console.log(GEBRUIK); return 0; }
    else if (k.startsWith('--')) { console.error(`onbekende vlag ${k}\n${GEBRUIK}`); return 1; }
    else if (map === null) map = k;
    else { console.error(`één map, niet meer\n${GEBRUIK}`); return 1; }
  }
  if (!map) { console.error(GEBRUIK); return 1; }
  if (!existsSync(map) || !statSync(map).isDirectory()) { console.error(`${map} is geen map`); return 1; }
  if (uit) { const w = uitWeigering(uit, map); if (w) { console.error(w); return 2; } }
  if (basename(resolve(map)) === 'opnames' && existsSync(join(resolve(map), '..', 'server', 'index.js'))) {
    console.error(`let op: ${map} is de opnames/ van een checkout (daar schrijft de server); lees liever een kopie (cp, zie v2/telling/LEESMIJ.md).`);
  }
  const namen = readdirSync(map).filter((n) => n.endsWith('.acties.jsonl') && statSync(join(map, n)).isFile()).sort();
  if (!namen.length) { console.error(`geen *.acties.jsonl in ${map}`); return 1; }
  const logs = namen.map((naam) => ({ naam, tekst: readFileSync(join(map, naam), 'utf8') }));
  // Pas laden als er iets te tellen is: het register bindt alle actions op dubbels.
  const { bouwRegister } = await import('../../tools/handen/register.mjs');
  const register = bouwRegister();
  const res = tel(logs, { register: register.ids, registerFouten: register.fouten, mappings: leesMappings(), map: resolve(map) });
  const json = JSON.stringify(res, null, 2) + '\n';
  if (uit) writeFileSync(uit, json); else process.stdout.write(json);
  const b = res.bron;
  console.error(`${b.logs} logs, ${b.avonden} avonden, ${b.handelingen} handelingen (${b.eerste ?? '?'} … ${b.laatste ?? '?'}); `
    + `register ${b.register.genormaliseerd} genormaliseerd, waarvan ${res.nooitGebruikt.genormaliseerd} nooit gebruikt; `
    + `in een standaardmapping ${res.mappingNooitGebruikt.samen.acties}, waarvan ${res.mappingNooitGebruikt.samen.nooit} nooit gebruikt.`
    + (uit ? ` Geschreven: ${uit}` : ''));
  if (b.register.fouten.length) console.error(`register niet volledig: ${b.register.fouten.join('; ')}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  hoofd(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(e.stack || e.message); process.exitCode = 1; });
}
