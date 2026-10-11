#!/usr/bin/env node
// De handenkaart (docs/HANDEN.md): wat elke control van de APC40 mkII, de Maschine MK2,
// de LPD8 en de Xboard49 in Varve doet, waar nog plek is, en welke nieuwe actie er als
// voorstel op staat. Leest alleen; verandert geen mapping, geen knop, geen library.
//
// Gebruik:
//   node tools/handen/handenkaart.mjs                 docs/HANDEN.md bijwerken (tussen de markers)
//   node tools/handen/handenkaart.mjs --controleer    alleen kijken of docs/HANDEN.md nog klopt (exit 1 als niet)
//   node tools/handen/handenkaart.mjs --html [--uit <pad>]   ook een A4-afdruk (standaard tools/handen/uit/handenkaart.html, ⌘P)
//   node tools/handen/handenkaart.mjs --controller apc|maschine|lpd8|xboard|alles   dat deel op stdout, niets schrijven
//   node tools/handen/handenkaart.mjs --json          de tabellen als JSON op stdout, niets schrijven
//   node tools/handen/handenkaart.mjs --zonder-logs   zonder de telling van de handelingenlogs
//
// Bronnen: mappings/apc40mk2.json (+ -vormen.json), maschine-mk2.json, xboard49.json; de
// APC-controls van de hub (VARVE_HUB_REPO, standaard ../av-app-hub; anders de ingebakken
// kopie src/handen/apc-controls.js); de Maschine-knoppen (src/control/devices/maschine-mk2.js,
// UITLEG in maschine.js); de LPD8-rollen (PARAMS in src/control/hub.js); het action-register
// (tools/handen/register.mjs); handen/voorstel.json (bestaat hij niet, dan schrijft dit
// script de v0 uit tools/handen/voorstel-v0.mjs, nooit over een bestaand bestand heen);
// avondpakket/profielen.json als die er is; de logs in VARVE_OPNAMES of opnames/ (alleen lezen).
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { maakHandenkaart, plekTekst, rijVanBoven } from '../../src/handen/kaart.js';
import { legeTelling, telLog, perGroep } from '../../src/handen/telling.js';
import { APC_CONTROLS } from '../../src/handen/apc-controls.js';
import { KNOPPEN, KNOP_LABEL, knopSig, encoderSig, WIEL_SIG } from '../../src/control/devices/maschine-mk2.js';
import { UITLEG } from '../../src/control/maschine.js';
import { PARAMS } from '../../src/control/hub.js';
import { bouwRegister } from './register.mjs';
import { VOORSTEL_V0 } from './voorstel-v0.mjs';

const WORTEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BEGIN = '<!-- handen:begin -->';
export const EIND = '<!-- handen:eind -->';

const leesJson = (pad) => JSON.parse(readFileSync(pad, 'utf8'));

/** De APC-controls: uit de hub als die er is, anders de ingebakken kopie. */
export async function leesControls(hubRepo = process.env.VARVE_HUB_REPO || join(WORTEL, '../av-app-hub')) {
  const pad = join(hubRepo, 'src/devices/apc40mk2.js');
  if (existsSync(pad)) {
    const m = await import(pathToFileURL(pad).href);
    return { controls: m.CONTROLS, bron: 'de hub (src/devices/apc40mk2.js)' };
  }
  return { controls: APC_CONTROLS, bron: 'de ingebakken kopie (src/handen/apc-controls.js)' };
}

/** Alle `.acties.jsonl` in de map, op naam; null als de map er niet is. */
export function leesLogs(map) {
  if (!map || !existsSync(map)) return null;
  const t = legeTelling();
  for (const f of readdirSync(map).filter((x) => x.endsWith('.acties.jsonl')).sort()) telLog(t, readFileSync(join(map, f), 'utf8'), f);
  return t;
}

/** Alles inlezen en de kaart maken. */
export async function bouw({ zonderLogs = false, schrijfVoorstel = true } = {}) {
  const voorstelPad = join(WORTEL, 'handen/voorstel.json');
  let voorstelGeschreven = false;
  if (!existsSync(voorstelPad) && schrijfVoorstel) {
    mkdirSync(dirname(voorstelPad), { recursive: true });
    writeFileSync(voorstelPad, JSON.stringify(VOORSTEL_V0, null, 2) + '\n');
    voorstelGeschreven = true;
  }
  const voorstel = existsSync(voorstelPad) ? leesJson(voorstelPad) : VOORSTEL_V0;
  const m = (f) => leesJson(join(WORTEL, 'mappings', f));
  const mappings = { apc: m('apc40mk2.json'), vormen: m('apc40mk2-vormen.json'), maschine: m('maschine-mk2.json'), xboard: m('xboard49.json') };
  const { controls, bron: controlsBron } = await leesControls();
  const profielPad = join(WORTEL, 'avondpakket/profielen.json');
  const profielen = existsSync(profielPad) ? leesJson(profielPad) : null;
  const logMap = process.env.VARVE_OPNAMES || join(WORTEL, 'opnames');
  const telling = zonderLogs ? null : leesLogs(logMap);
  const register = bouwRegister();
  const knoppen = KNOPPEN.map((naam) => ({ naam, label: KNOP_LABEL[naam] ?? naam, sig: knopSig(naam) }));
  const draaiknoppen = [...Array.from({ length: 8 }, (_, i) => ({ naam: `knop${i + 1}`, label: `draaiknop ${i + 1}`, sig: encoderSig(i + 1) })),
    { naam: 'wiel', label: 'masterwiel (draaien)', sig: WIEL_SIG }];
  const kaart = maakHandenkaart({ mappings, controls, knoppen, draaiknoppen, eigen: UITLEG, params: PARAMS, register: register.ids, voorstel, profielen, telling });
  const logNamen = telling ? telling.perLog.map(([n]) => n) : [];
  return { kaart, mappings, voorstel, voorstelGeschreven, telling, bronnen: { controls: controlsBron, profielen: profielen ? 'avondpakket/profielen.json' : null,
    logs: telling ? { map: logMap === join(WORTEL, 'opnames') ? 'opnames/' : 'VARVE_OPNAMES', aantal: telling.logs, eerste: logNamen[0] ?? null, laatste: logNamen.at(-1) ?? null } : null,
    register: { acties: register.ids.length, fouten: register.fouten } } };
}

// ---- markdown ---------------------------------------------------------------------------------

const code = (s) => (s ? `\`${s}\`` : '—');
const cel = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const tabel = (kop, rijen) => [`| ${kop.join(' | ')} |`, `|${kop.map(() => '---').join('|')}|`, ...rijen.map((r) => `| ${r.map(cel).join(' | ')} |`)].join('\n');
const padNaam = (id) => { const m = /^pad(\d)-(\d)$/.exec(id); return m ? `r${rijVanBoven(Number(m[1]))}k${m[2]}` : id; };
/** Pads per rij van boven: "rij 4 (k1–8), rij 5 (k2–8)". */
function padsTekst(ids) {
  const per = new Map();
  for (const id of ids) { const m = /^pad(\d)-(\d)$/.exec(id); if (!m) continue; const r = rijVanBoven(Number(m[1])); if (!per.has(r)) per.set(r, []); per.get(r).push(Number(m[2])); }
  return [...per.entries()].sort((a, b) => a[0] - b[0]).map(([r, k]) => {
    k.sort((a, b) => a - b);
    const aaneen = k.every((x, i) => i === 0 || x === k[i - 1] + 1);
    return `rij ${r} (${k.length === 8 ? 'heel' : aaneen && k.length > 2 ? `k${k[0]}–${k.at(-1)}` : k.map((x) => `k${x}`).join(', ')})`;
  }).join(', ') || '—';
}

function voorstelOp(kaart, controller, id) {
  return kaart.voorstellen.filter((v) => v[controller]?.plekken?.includes(id)).map((v) => `**voorstel ${code(v.actie)}**`).join(', ');
}

export function mdBron(b) {
  const l = b.bronnen;
  return [
    `*Gegenereerd door \`node tools/handen/handenkaart.mjs\`; niet met de hand bewerken tussen de markers.*`,
    `Bronnen: de standaardmappings (APC v${b.mappings.apc.version}, ${b.mappings.apc.rules.length} regels + ${b.mappings.vormen.rules.length} in het fragment vorm;`
      + ` Maschine ${b.mappings.maschine.rules.length} regels; Xboard ${b.mappings.xboard.rules.length} regels), de APC-controls uit ${l.controls},`
      + ` het action-register (${l.register.acties} actions${l.register.fouten.length ? `; niet gebonden: ${l.register.fouten.join('; ')}` : ''}),`
      + ` \`handen/voorstel.json\`, de profielen uit ${l.profielen ? '`avondpakket/profielen.json`' : 'de ingebakken kopie (`PROFIELEN_V0`; avondpakket bestaat nog niet op deze tak)'},`
      + ` ${l.logs ? `${l.logs.aantal} handelingenlogs (${l.logs.map}, ${l.logs.eerste} … ${l.logs.laatste})` : 'geen handelingenlogs'}.`,
  ].join('\n');
}

export function mdRollen(k) {
  const r = k.rollen;
  return `### Rol per controller in de draagbare set\n\nProfielen uit ${r.bron}: ✓ = verwacht, (✓) = optioneel, — = niet.\n\n` + tabel(
    ['Controller', 'Rol', ...r.profielen.map((p) => `\`${p.id}\``), 'Hub nodig', 'Op hardware geproefd'],
    r.rijen.map((x) => [x.naam, x.rol, ...r.profielen.map((p) => ({ verwacht: '✓', optioneel: '(✓)' })[x.per[p.id]] ?? '—'), x.hub, x.geproefd]));
}

export function mdApc(k) {
  const a = k.apc, v = a.vrij;
  const label = (id) => a.rijen.find((r) => r.id === id)?.label ?? id;
  const uit = [];
  uit.push('### APC40 mkII', '', '**Vrij in de standaardmapping** (met de hub-id; vrij betekent: geen regel, niet "getest").', '');
  uit.push(`- Zonder enige regel: ${v.zonderRegel.map((id) => `**${label(id)}** (${id}: ${v.toelichting[id]})`).join(', ')}.`);
  uit.push(`- Alleen met shift (zonder shift vrij): ${v.alleenShift.map((id) => `**${label(id)}** (${id})`).join(', ')}; met \`?vormen=1\` opent Detail View het mapje vorm.`);
  uit.push(`- Shift + knop vrij in de basis (${v.shiftVrij.length}; zolang geen open mapje hem claimt): ${v.shiftVrij.map((id) => `${label(id)}`).join(', ')}.`);
  uit.push(`- Bank is met de hub de hubtoets; de shift-toets zelf is \`${a.shiftToets}\`.`);
  uit.push('', 'Pads zonder regel per grid-modus (rijen van boven, k = kolom):', '');
  const modusVoorstel = (m) => k.voorstellen.filter((x) => x.apc?.laag === m).map((x) => `**voorstel ${code(x.actie)}** op ${padsTekst(x.apc.plekken)}`).join(', ') || '—';
  uit.push(tabel(['Modus', 'Vrije pads', 'Aantal', 'Voorstel'], Object.entries(v.inModus).map(([m, ids]) => [code(m), padsTekst(ids), ids.length, modusVoorstel(m)])));
  uit.push('', '**Alle controls behalve de pads** (basis = zonder mapje; mapjes = regels in een mapje of modus):', '');
  const rijen = a.rijen.filter((r) => r.soort !== 'pad').map((r) => {
    const lagen = [...r.lagen.map((l) => `${l.laag}${l.shift ? '+shift' : ''}: ${code(l.action)}`), ...r.vorm.map((l) => `${l.laag ?? 'basis'}${l.shift ? '+shift' : ''} (?vormen=1): ${code(l.action)}`)];
    const vrij = [!r.basis && !r.shift && !r.lagen.length ? 'helemaal' : null, v.shiftVrij.includes(r.id) ? 'shift' : null, v.alleenShift.includes(r.id) ? 'zonder shift' : null].filter(Boolean).join(', ');
    return [`${r.label} (${r.id}, \`${r.sig}\`)`, code(r.basis), code(r.shift), lagen.length ? lagen.join('<br>') : '—', vrij || '—', voorstelOp(k, 'apc', r.id) || '—'];
  });
  uit.push(tabel(['Plek', 'Basis', 'Met shift', 'Mapjes', 'Vrij', 'Voorstel'], rijen));
  return uit.join('\n');
}

export function mdMaschine(k) {
  const m = k.maschine;
  const uit = ['### Maschine MK2 (alleen via de hub)', '',
    `**In gebruik ${m.inGebruik.length}, vrij ${m.vrij.length}** van ${m.rijen.length} knoppen. "maschine.js" = de knop doet iets zonder mappingregel (UITLEG in maschine.js).`
    + ' Een ontwerp voor de vrije knoppen staat in `~/Projects/maschine-lab/kaart/data2.js` (status voorstel).', ''];
  uit.push(tabel(['Knop', 'Doet', 'Vrij', 'Voorstel'], m.rijen.map((r) => [
    `${r.label} (\`${r.sig}\`)`,
    [r.eigen ? `maschine.js: ${r.eigen.kort}` : null, ...r.regels.map((l) => `${[l.laag, l.shift ? 'shift' : null].filter(Boolean).join('+') || 'basis'}: ${code(l.action)}`)].filter(Boolean).join('<br>') || '—',
    r.vrij ? '**vrij**' : '—', voorstelOp(k, 'maschine', r.naam) || '—'])));
  uit.push('', 'Draaiknoppen en wiel (per knoppagina een mapje):', '');
  uit.push(tabel(['Knop', 'Doet'], m.draaiknoppen.map((r) => [`${r.label} (\`${r.sig}\`)`,
    [...new Set(r.regels.filter((l) => !l.shift).map((l) => `${l.laag ?? 'Instrument'}: ${code(l.action)}`))].join('<br>') || (r.naam === 'wiel' ? 'maschine.js: instrument kiezen; met de library open bladeren' : '—')])));
  uit.push('', 'Pads 1–16: spelen (noten 36–51 via noten.js), stappen (STEP), secties (SCENE), patroonplek (PATTERN + pad), sampler (SAMPLING); maschine.js, geen mappingregels.');
  return uit.join('\n');
}

export function mdLpd8(k) {
  const l = k.lpd8;
  const lpdVoorstel = (id) => k.lpd8Voorstel?.[id] || '';
  return ['### LPD8 (alleen via de hub)', '',
    `Vrij in Varve: ${l.vrij.join(', ')}. De knoppen zijn rollen van de hub (PROTOCOL §6): de pickup volgt de eerste app met die rol; de pads P2–P8 zijn van de hub.`, '',
    tabel(['Plek', 'Rol / hub', 'In Varve', 'Vrij', 'Voorstel'], l.rijen.map((r) => [r.id, r.rol ? code(r.rol) : r.hub, r.varve ? `${r.varve.naam}: ${code(r.varve.action)}` : '—', r.vrij ? '**vrij**' : '—', lpdVoorstel(r.id) || '—']))].join('\n');
}

export function mdXboard(k) {
  const x = k.xboard;
  const knop = x.rijen.filter((r) => r.in !== 'master-volume');
  return ['### Xboard49', '',
    '**AANNAME:** de CC-nummers komen uit Ardour\'s map en zijn door geen proef bevestigd (de proef speelapparaten van de hub meet ze). Vrij: niets. Noten, pedaal, modwiel en pitchbend doet `noten.js`.', '',
    tabel(['Knop', 'In', 'Doet'], [...knop.map((r) => [r.label, code(r.in), code(r.action)]), ...x.rijen.filter((r) => r.in === 'master-volume').map((r) => [r.label, code(r.in), code(r.action)])])].join('\n');
}

export function mdZonderPlek(k) {
  const uit = ['### Acties zonder plek op een controller', ''];
  const vs = k.voorstellen;
  uit.push('**Het voorstel** (`handen/voorstel.json`; eerst via learn, standaard pas na de proef):', '');
  uit.push(tabel(['Actie', 'Status', 'APC', 'Maschine', 'Waarom', 'Voorwaarde', 'Vraag', 'Op deze tak'], vs.map((v) => [
    code(v.actie), v.status,
    v.apc ? `${v.apc.shift ? 'Shift + ' : ''}${v.apc.plekken.map(padNaam).join(', ')}${v.apc.laag ? ` (${v.apc.laag})` : ''}` : '—',
    v.maschine ? `${v.maschine.plekken.join(', ')}: ${v.maschine.hoe}` : '—',
    v.waarom, v.voorwaarde, v.vraag ?? '—', v.inRegister === null ? 'geen bus-action' : v.inRegister ? 'in het register' : `nog niet (${v.bron})`])));
  if (k.verouderd.length) uit.push('', `**Achterhaald** (staat al in een mapping, zet de status op "standaard"): ${k.verouderd.map(code).join(', ')}.`);
  const groepen = new Map();
  for (const z of k.zonderPlek.filter((z) => z.status === 'uitzondering')) {
    if (!groepen.has(z.patroon)) groepen.set(z.patroon, { reden: z.reden, acties: [] });
    groepen.get(z.patroon).acties.push(z.actie);
  }
  uit.push('', `**Bewust zonder plek** (${k.zonderPlek.filter((z) => z.status === 'uitzondering').length} genormaliseerde actions; ze werken op het scherm, met toetsen of via koppelen):`, '');
  uit.push(tabel(['Patroon', 'Aantal', 'Waarom'], [...groepen.entries()].map(([p, g]) => [code(p), g.acties.length, g.reden])));
  const onbekend = k.zonderPlek.filter((z) => z.status === 'onbekend');
  uit.push('', onbekend.length
    ? `**Zonder plek en zonder besluit (${onbekend.length}):** ${onbekend.map((z) => code(z.actie)).join(', ')}. Zet ze in \`handen/voorstel.json\` (voorstel of uitzondering); test/handen.test.mjs valt hierop.`
    : '**Zonder plek en zonder besluit:** geen.');
  return uit.join('\n');
}

export function mdTop(k, telling) {
  if (!k.top) return '### Wat de handen doen\n\nGeen handelingenlogs gelezen (`--zonder-logs`, of geen map).';
  const uit = ['### Wat de handen doen (top-40 uit de handelingenlogs)', '',
    `${k.top.logs} logs, ${k.top.acties.toLocaleString('nl-NL')} handelingen. Het log kent geen bron (MIDI, muis, toets): "hand" hieronder is waar de actie in een mapping staat, geen meting.`, ''];
  uit.push(tabel(['#', 'Actie', 'Aantal', 'Hand'], k.top.rijen.map((r) => [r.nr, code(r.actie), r.aantal.toLocaleString('nl-NL'), r.plekken.length ? r.plekken.join('<br>') : `geen vaste plek${r.zonder ? ` (zie \`${r.zonder}\` hierboven)` : ''}`])));
  if (telling) uit.push('', `Per groep: ${perGroep(telling).map(([g, n]) => `${g} ${n.toLocaleString('nl-NL')}`).join(' · ')}.`);
  return uit.join('\n');
}

export function markdown(b, telling = b.telling) {
  const k = b.kaart;
  k.lpd8Voorstel = Object.fromEntries((b.voorstel.lpd8 || []).map((x) => [x.plek, `${x.voorstel} (${x.vraag ?? '—'})`]));
  return [mdBron(b), mdRollen(k), mdApc(k), mdMaschine(k), mdLpd8(k), mdXboard(k), mdZonderPlek(k), mdTop(k, telling)].join('\n\n');
}

/** Zet het gegenereerde deel tussen de markers van een bestaand document. */
export function vervangTussenMarkers(doc, deel) {
  const a = doc.indexOf(BEGIN), e = doc.indexOf(EIND);
  if (a < 0 || e < a) throw new Error(`markers ${BEGIN} … ${EIND} niet gevonden`);
  return `${doc.slice(0, a + BEGIN.length)}\n\n${deel}\n\n${doc.slice(e)}`;
}

// ---- HTML (A4 liggend, ⌘P) -------------------------------------------------------------------

function mdNaarHtml(md) {
  // Genoeg voor wat markdown() maakt: kopjes, tabellen, lijstjes, **vet**, `code`, <br>.
  const inline = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/&lt;br>/g, '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
  const uit = [];
  const regels = md.split('\n');
  for (let i = 0; i < regels.length; i++) {
    const r = regels[i];
    if (r.startsWith('### ')) uit.push(`<h2>${inline(r.slice(4))}</h2>`);
    else if (r.startsWith('| ')) {
      const rij = (x) => x.slice(2, -2).split(/(?<!\\) \| /).map((c) => c.replace(/\\\|/g, '|'));
      const kop = rij(r); i++;
      const body = [];
      while (regels[i + 1]?.startsWith('| ')) { i++; body.push(rij(regels[i])); }
      uit.push(`<table><tr>${kop.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>${body.map((b) => `<tr>${b.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table>`);
    } else if (r.startsWith('- ')) uit.push(`<li>${inline(r.slice(2))}</li>`);
    else if (r.trim()) uit.push(`<p>${inline(r)}</p>`);
  }
  return uit.join('\n');
}

export function html(md) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Handenkaart</title><style>
@page { size: A4 landscape; margin: 10mm; }
body { font: 9pt/1.35 -apple-system, system-ui, sans-serif; color: #111; background: #fff; margin: 0 8mm; }
h2 { font-size: 12pt; margin: 14pt 0 4pt; break-before: page; } h2:first-of-type { break-before: auto; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0; } th, td { border: 0.5pt solid #bbb; padding: 2pt 4pt; vertical-align: top; text-align: left; }
th { background: #eee; } tr { break-inside: avoid; } code { font-size: 8pt; } li { margin-left: 12pt; } p { margin: 3pt 0; }
</style></head><body><h1 style="font-size:14pt">Handenkaart Varve</h1>
${mdNaarHtml(md)}
</body></html>
`;
}

// ---- CLI --------------------------------------------------------------------------------------

async function hoofd(argv) {
  const vlag = (n) => argv.includes(n);
  const waarde = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const b = await bouw({ zonderLogs: vlag('--zonder-logs'), schrijfVoorstel: !vlag('--json') && !vlag('--controller') });
  const { telling } = b;
  if (b.voorstelGeschreven) console.error('handen/voorstel.json bestond niet: de v0 geschreven.');
  if (vlag('--json')) {
    const k = b.kaart;
    console.log(JSON.stringify({ vrij: k.vrij, apc: k.apc.rijen, maschine: k.maschine.rijen, lpd8: k.lpd8.rijen, xboard: k.xboard.rijen,
      voorstellen: k.voorstellen, zonderPlek: k.zonderPlek, verouderd: k.verouderd, top: k.top, rollen: k.rollen }, null, 2));
    return 0;
  }
  const md = markdown(b, telling);
  const c = waarde('--controller');
  if (c) {
    const k = b.kaart;
    k.lpd8Voorstel = Object.fromEntries((b.voorstel.lpd8 || []).map((x) => [x.plek, `${x.voorstel} (${x.vraag ?? '—'})`]));
    const delen = { apc: () => mdApc(k), maschine: () => mdMaschine(k), lpd8: () => mdLpd8(k), xboard: () => mdXboard(k), alles: () => md };
    if (!delen[c]) { console.error(`onbekende controller: ${c} (apc, maschine, lpd8, xboard, alles)`); return 2; }
    console.log(delen[c]());
    return 0;
  }
  const docPad = join(WORTEL, 'docs/HANDEN.md');
  const oud = readFileSync(docPad, 'utf8');
  const nieuw = vervangTussenMarkers(oud, md);
  if (vlag('--controleer')) {
    if (nieuw === oud) { console.log('docs/HANDEN.md klopt met de data.'); return 0; }
    console.log('docs/HANDEN.md wijkt af van wat de data nu zegt: draai node tools/handen/handenkaart.mjs'); return 1;
  }
  if (nieuw !== oud) writeFileSync(docPad, nieuw);
  console.log(`docs/HANDEN.md ${nieuw === oud ? 'was al bij' : 'bijgewerkt'}.`);
  const k = b.kaart;
  console.log(`vrij: APC ${k.vrij.apc.zonderRegel.length} zonder regel, ${k.vrij.apc.alleenShift.length} alleen shift, ${k.vrij.apc.shiftVrij.length} shift vrij · Maschine ${k.vrij.maschine.length} · LPD8 ${k.vrij.lpd8.join(', ')}`);
  const onbekend = k.zonderPlek.filter((z) => z.status === 'onbekend');
  if (onbekend.length) console.log(`zonder plek en zonder besluit: ${onbekend.map((z) => z.actie).join(', ')}`);
  if (vlag('--html')) {
    const uit = waarde('--uit') || join(WORTEL, 'tools/handen/uit/handenkaart.html');
    mkdirSync(dirname(uit), { recursive: true });
    writeFileSync(uit, html(md));
    console.log(`A4-afdruk: ${uit} (open in Chrome, ⌘P)`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  hoofd(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.stack || e.message); process.exit(1); });
}
