#!/usr/bin/env node
/**
 * nu.json maken: wat we NU weten zonder Clay's Mac. Leest alleen:
 * - de top-40 en de telling per groep uit docs/HANDEN.md §4 ("Wat de handen doen", 27 logs t/m 10 okt);
 * - het action-register (tools/handen/register.mjs, zoals handenkaart.mjs);
 * - de standaardmappings (mappings/apc40mk2.json, -vormen.json, maschine-mk2.json, xboard49.json).
 * Schrijft alleen v2/telling/nu.json. nu.md is met de hand geschreven uit deze getallen.
 *
 *   node v2/telling/nu.mjs            nu.json (opnieuw) schrijven
 *   node v2/telling/nu.mjs --json     naar stdout, niets schrijven
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseer, groep } from '../../src/handen/telling.js';
import { bouwRegister } from '../../tools/handen/register.mjs';
import { mappingActies, MAPPINGS } from './tel.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const WORTEL = resolve(HIER, '../..');
const getal = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const rond = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;

/** De top-40 en de groepen uit docs/HANDEN.md. */
export function leesHanden(doc) {
  const k = doc.indexOf('### Wat de handen doen');
  if (k < 0) throw new Error('docs/HANDEN.md: kopje "Wat de handen doen" niet gevonden');
  const deel = doc.slice(k, doc.indexOf('<!-- handen:eind -->', k));
  const kop = /(\d+) logs \(([^ ]+) … ([^ )]+)\), ([\d.]+) handelingen/.exec(deel);
  const top = [];
  for (const m of deel.matchAll(/^\| (\d+) \| `([^`]+)` \| ([\d.]+) \| (.*) \|$/gm)) {
    top.push({ nr: Number(m[1]), actie: m[2], aantal: getal(m[3]), groep: groep(m[2]), vastePlek: !m[4].startsWith('geen vaste plek'), hand: m[4].split('<br>') });
  }
  const pg = /Per groep: (.*)\./.exec(deel);
  const groepen = pg[1].split(' · ').map((x) => { const m = /^(.*) ([\d.]+)$/.exec(x); return { groep: m[1], handelingen: getal(m[2]) }; });
  return { logs: Number(kop[1]), eerste: kop[2], laatste: kop[3], handelingen: getal(kop[4]), top, groepen };
}

export function maakNu() {
  const h = leesHanden(readFileSync(join(WORTEL, 'docs/HANDEN.md'), 'utf8'));
  const register = bouwRegister();
  const reg = new Map(); // genormaliseerd → aantal ruwe ids
  for (const id of register.ids) { const a = normaliseer(id); reg.set(a, (reg.get(a) || 0) + 1); }
  const mappings = Object.fromEntries(MAPPINGS.map((f) => [f, mappingActies(JSON.parse(readFileSync(join(WORTEL, 'mappings', f), 'utf8')))]));
  const inMapping = new Set(Object.values(mappings).flatMap((m) => [...m.keys()]));
  const inTop = new Set(h.top.map((r) => r.actie));
  const totaal = h.handelingen;

  const groepen = new Map();
  const g = (naam) => {
    if (!groepen.has(naam)) groepen.set(naam, { groep: naam, handelingen: 0, aandeel: 0, register: 0, registerRuw: 0, inMapping: 0, inTop40: 0, top40Handelingen: 0 });
    return groepen.get(naam);
  };
  for (const x of h.groepen) { g(x.groep).handelingen = x.handelingen; }
  for (const [a, n] of reg) { const x = g(groep(a)); x.register++; x.registerRuw += n; if (inMapping.has(a)) x.inMapping++; }
  for (const r of h.top) { const x = g(r.groep); x.inTop40++; x.top40Handelingen += r.aantal; }
  for (const x of groepen.values()) x.aandeel = rond(x.handelingen / totaal, 5);

  const top40Som = h.top.reduce((s, r) => s + r.aantal, 0);
  const som = (lijst) => lijst.reduce((s, a) => s + (h.top.find((r) => r.actie === a)?.aantal ?? 0), 0);
  const deel = (n) => rond(n / totaal, 5);
  const ruwInTop = register.ids.filter((id) => inTop.has(normaliseer(id))).length;
  const KANAAL = ['track.N.fader', 'track.N.filter', 'track.N.fx.knob.K', 'track.N.fx.mix', 'track.N.send.a', 'track.N.send.b', 'track.N.low', 'track.N.high', 'track.N.trim', 'mixer.xfader', 'mixer.master'];
  const AUTOMAAT = ['track.N.fader.glide', 'track.N.filter.glide', 'track.N.send.a.glide', 'track.N.send.b.glide', 'track.N.xfade.thru'];

  const nu = {
    soort: 'varve-telling-nu', versie: 1,
    bronnen: {
      handen: `docs/HANDEN.md §4: ${h.logs} logs (${h.eerste} … ${h.laatste}), top-40 + telling per groep`,
      register: `tools/handen/register.mjs: ${register.ids.length} actions (alleen wat src/control/actions.js bindt; de aanhakers van de werkruimte niet)`,
      mappings: MAPPINGS,
    },
    grens: [
      `${h.logs} logs, ${h.eerste.slice(4, 12)} t/m ${h.laatste.slice(4, 12)}; alles van daarna (werkruimte S0–S11, 14 okt) zit er niet in.`,
      'Het log kent geen bron (MIDI, muis, toets, automaat, terugspelen): een "handeling" is een action op de bus, niet per se een hand.',
      `De top-40 dekt ${Math.round(top40Som / totaal * 1000) / 10}% van de handelingen; van wat erbuiten viel (${totaal - top40Som}) weten we alleen de groep.`,
      'Een fader of knop die je draait geeft tientallen handelingen, een knop indrukken twee: aantallen vergelijken tussen soorten is appels en peren.',
    ],
    logs: { aantal: h.logs, eerste: h.eerste, laatste: h.laatste, handelingen: totaal, top40Handelingen: top40Som, top40Aandeel: deel(top40Som) },
    register: {
      ruw: register.ids.length, genormaliseerd: reg.size,
      inMapping: [...reg.keys()].filter((a) => inMapping.has(a)).length,
      inTop40: [...reg.keys()].filter((a) => inTop.has(a)).length,
      ruwInTop40: ruwInTop, ruwNietInTop40: register.ids.length - ruwInTop,
      genormaliseerdNietInTop40: [...reg.keys()].filter((a) => !inTop.has(a)).length,
    },
    mappings: Object.fromEntries(Object.entries(mappings).map(([f, m]) => [f, {
      regels: [...m.values()].reduce((s, n) => s + n, 0), acties: m.size,
      inTop40: [...m.keys()].filter((a) => inTop.has(a)).length,
      regelsInTop40: [...m.entries()].filter(([a]) => inTop.has(a)).reduce((s, [, n]) => s + n, 0),
    }])),
    mappingSamen: { acties: inMapping.size, inTop40: [...inMapping].filter((a) => inTop.has(a)).length, nietInTop40: [...inMapping].filter((a) => !inTop.has(a)).length },
    groepen: [...groepen.values()].sort((a, b) => b.handelingen - a.handelingen || b.register - a.register),
    top40: h.top.map((r) => ({ ...r, aandeel: deel(r.aantal), inRegister: reg.has(r.actie), inMapping: Object.keys(mappings).filter((f) => mappings[f].has(r.actie)) })),
    kengetallen: {
      faderFilterFxKnoppen: { acties: ['track.N.fader', 'track.N.filter', 'track.N.fx.knob.K'], handelingen: som(['track.N.fader', 'track.N.filter', 'track.N.fx.knob.K']) },
      kanaalstrip: { acties: KANAAL, handelingen: som(KANAAL) },
      top10: { handelingen: h.top.slice(0, 10).reduce((s, r) => s + r.aantal, 0) },
      automaat: { acties: AUTOMAAT, handelingen: som(AUTOMAAT), noot: 'glide en xfade.<kant> stuurt src/auto/automaat.js (regel 752, 1192, 614); geen vaste plek op een controller' },
      geenVastePlek: { acties: h.top.filter((r) => !r.vastePlek).map((r) => r.actie), handelingen: h.top.filter((r) => !r.vastePlek).reduce((s, r) => s + r.aantal, 0) },
      videoFxZonderPlek: { handelingen: h.top.filter((r) => r.actie.startsWith('video.fx.')).reduce((s, r) => s + r.aantal, 0) },
      transportKnoppen: { acties: ['track.N.play', 'track.N.hotcue.K', 'track.N.seek', 'track.N.focus'], handelingen: som(['track.N.play', 'track.N.hotcue.K', 'track.N.seek', 'track.N.focus']) },
      patronenEnAutoKnoppen: { handelingen: (h.groepen.find((x) => x.groep === 'patronen')?.handelingen ?? 0) + (h.groepen.find((x) => x.groep === 'auto-dj')?.handelingen ?? 0) },
    },
  };
  for (const k of Object.values(nu.kengetallen)) k.aandeel = deel(k.handelingen);
  return nu;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nu = maakNu();
  const json = JSON.stringify(nu, null, 2) + '\n';
  if (process.argv.includes('--json')) process.stdout.write(json);
  else { writeFileSync(join(HIER, 'nu.json'), json); console.error('v2/telling/nu.json geschreven.'); }
}
