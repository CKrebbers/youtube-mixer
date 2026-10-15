// De handenkaart (docs/HANDEN.md): src/handen/kaart.js en telling.js (puur),
// handen/voorstel.json, tools/handen/handenkaart.mjs, en het blok hub-f0 in de
// speellijst. Zes checks uit het ontwerp (extra-2 §3.2): (1) elke `in` van elke
// mapping is een bekende control, (2) elke action in een mapping bestaat,
// (3) de vrije plekken zijn precies wat het ontwerp telde (§1.6), (4) elke actie
// zonder plek heeft een voorstel of een uitzondering, (5) kaart.js en telling.js
// importeren niets uit src/engine/ en doen geen I/O, (6) de telling rekent als de
// telling van 10 okt. Geen hardware, geen server, geen netwerk.
// Draai met: node test/handen.test.mjs
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };
const lees = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(lees(p));

const { maakHandenkaart, plekNaam, rijVanBoven, sigPast, patroonPast, labelsKort, LPD8 } = await import('../src/handen/kaart.js');
const T = await import('../src/handen/telling.js');
const { APC_CONTROLS } = await import('../src/handen/apc-controls.js');
const M = await import('../src/control/devices/maschine-mk2.js');
const { UITLEG } = await import('../src/control/maschine.js');
const { PARAMS } = await import('../src/control/hub.js');
const { resolveTarget } = await import('../src/control/mapping.js');
const { bouwRegister } = await import('../tools/handen/register.mjs');
const H = await import('../tools/handen/handenkaart.mjs');

const mappings = { apc: json('mappings/apc40mk2.json'), vormen: json('mappings/apc40mk2-vormen.json'), maschine: json('mappings/maschine-mk2.json'), xboard: json('mappings/xboard49.json') };
const voorstel = json('handen/voorstel.json');
const register = bouwRegister();
const knoppen = M.KNOPPEN.map((naam) => ({ naam, label: M.KNOP_LABEL[naam] ?? naam, sig: M.knopSig(naam) }));
const kaart = maakHandenkaart({ mappings, controls: APC_CONTROLS, knoppen, eigen: UITLEG, params: PARAMS, register: register.ids, voorstel });

console.log('de controls van de APC');
{
  ok(`148 controls, ids uniek (${APC_CONTROLS.length})`, APC_CONTROLS.length === 148 && new Set(APC_CONTROLS.map((c) => c.id)).size === 148);
  ok('rijentaal: pad5-3 = rij 1 · kolom 3, pad1-1 = rij 5 (de hub telt van onder)', plekNaam({ id: 'pad5-3', label: 'pad 5·3' }) === 'rij 1 · kolom 3 (pad5-3)'
    && rijVanBoven(1) === 5 && plekNaam({ id: 'detail', label: 'detail view' }) === 'detail view (detail)');
  // De bovenste rij (pad5-x) is noot 32–39, zoals gridNote(kolom, rij 1) in Varve's eigen profiel.
  const { gridNote } = await import('../src/control/devices/apc40mk2.js');
  ok('pad5-k = gridNote(k, 1), pad1-k = gridNote(k, 5)', [1, 2, 3, 4, 5, 6, 7, 8].every((k) => APC_CONTROLS.find((c) => c.id === `pad5-${k}`).n === gridNote(k, 1)
    && APC_CONTROLS.find((c) => c.id === `pad1-${k}`).n === gridNote(k, 5)));
  const gezet = process.env.VARVE_HUB_REPO;
  const hubRepo = gezet || fileURLToPath(new URL('../../av-app-hub', import.meta.url));
  const pad = `${hubRepo}/src/devices/apc40mk2.js`;
  if (existsSync(pad)) {
    const { CONTROLS } = await import(pad);
    const vorm = (c) => [c.id, c.soort, c.t, c.n, c.ch, c.label].join('|');
    ok('de ingebakken kopie is gelijk aan de controltabel van de hub (id, soort, noot/cc, kanaal, label)', JSON.stringify(CONTROLS.map(vorm)) === JSON.stringify(APC_CONTROLS.map(vorm)));
    const { controls, bron } = await H.leesControls(hubRepo);
    ok('de CLI leest de hub als die er is', controls === CONTROLS && bron.startsWith('de hub'));
  } else if (gezet) ok(`VARVE_HUB_REPO=${gezet} bevat geen src/devices/apc40mk2.js`, false);
  else console.log('  --  ingebakken APC-controls niet met de hub vergeleken (geen av-app-hub naast deze map; zet VARVE_HUB_REPO)');
}

console.log('\n(1) elke `in` van elke mapping is een bekende control');
{
  const apcSigs = new Set(APC_CONTROLS.map((c) => `${c.t}:${c.ch}:${c.n}`));
  const apcOnbekend = [...mappings.apc.rules, ...mappings.vormen.rules].map((r) => r.in).filter((s) => ![...apcSigs].some((x) => sigPast(s, x)));
  ok(`APC (standaard + fragment vorm): alle ${mappings.apc.rules.length + mappings.vormen.rules.length} regels${apcOnbekend.length ? `; onbekend: ${[...new Set(apcOnbekend)].join(', ')}` : ''}`, !apcOnbekend.length);
  ok('APC: de shift-toets van de mapping is een control (shift, noot 98)', APC_CONTROLS.some((c) => c.id === 'shift' && `${c.t}:${c.ch}:${c.n}` === mappings.apc.shift));
  const ms = M.default.controls;
  const msOnbekend = mappings.maschine.rules.map((r) => r.in).filter((s) => !ms.has(s));
  ok(`Maschine: alle ${mappings.maschine.rules.length} regels op een knop, pad, draaiknop of het wiel${msOnbekend.length ? `; onbekend: ${msOnbekend.join(', ')}` : ''}`, !msOnbekend.length);
  ok('Maschine: de shift van de mapping is de knop SHIFT', mappings.maschine.shift === M.knopSig('shift'));
  const xbOnbekend = mappings.xboard.rules.map((r) => r.in).filter((s) => !(s === 'master-volume' || /^cc:(\*|\d{1,2}):(\d{1,3})$/.test(s) && Number(s.split(':')[2]) <= 127));
  ok(`Xboard: CC 0–127 op elk kanaal of master-volume (${mappings.xboard.rules.length} regels)`, !xbOnbekend.length);
  ok('sigPast: * past op elk kanaal, verder alleen precies', sigPast('cc:*:21', 'cc:3:21') && !sigPast('cc:*:21', 'cc:3:22') && sigPast('note:0:80', 'note:0:80') && !sigPast('note:0:80', 'note:1:80'));
}

console.log('\n(2) elke action in een mapping bestaat in het register');
{
  ok(`het register is volledig gebouwd (${register.ids.length} actions${register.fouten.length ? `; fouten: ${register.fouten.join('; ')}` : ''})`, register.ids.length > 3000 && !register.fouten.length);
  const ids = new Set(register.ids);
  const uitvouwen = (action) => {
    const uit = [];
    for (let t = 1; t <= 8; t++) for (let p = 1; p <= 5; p++) uit.push(resolveTarget(action, { focus: t, speel: t, plek: p }));
    return [...new Set(uit)];
  };
  for (const [naam, m] of Object.entries(mappings)) {
    const onbekend = [...new Set(m.rules.flatMap((r) => uitvouwen(r.action)).filter((a) => !ids.has(a)))];
    ok(`${naam}: alle actions bestaan (sjablonen {focus} {speel} {plek} uitgevouwen)${onbekend.length ? `; onbekend: ${onbekend.slice(0, 8).join(', ')}` : ''}`, !onbekend.length);
  }
  ok('elke LPD8-rol van Varve wijst naar een bestaande action', PARAMS.every((p) => ids.has(p.action)));
}

console.log('\n(3) de vrije plekken zijn precies §1.6 van het ontwerp (extra-2/klad/vrij-apc.tsv)');
{
  // Verandert de standaardmapping, dan valt dit om, en dus de kaart op: kijk of de plek bewust
  // bezet is, pas dan de lijst hieronder aan en draai node tools/handen/handenkaart.mjs.
  const v = kaart.vrij;
  ok('APC zonder enige regel: Shift, Bank, footswitch', JSON.stringify(v.apc.zonderRegel) === '["shift","bank","voet"]');
  ok('APC alleen met shift: Detail View', JSON.stringify(v.apc.alleenShift) === '["detail"]');
  const SHIFT_VRIJ = ['ab1', 'ab2', 'ab3', 'ab4', 'ab5', 'ab6', 'ab7', 'ab8', 'devL', 'devR', 'devOn', 'lock', 'mastersel', 'stopall',
    'pan', 'sends', 'user', 'play', 'up', 'down', 'right', 'left', 'voet'];
  ok(`APC: de 23 knoppen waarvan Shift + knop vrij is (A|B 1–8, Device ◀ ▶, On/Off, Lock, master, Stop All, Pan, Sends, User, Play, ▲ ▼ ◀ ▶, footswitch)${v.apc.shiftVrij.length !== 23 ? ` — nu ${v.apc.shiftVrij.length}: ${v.apc.shiftVrij.join(', ')}` : ''}`,
    JSON.stringify([...v.apc.shiftVrij].sort()) === JSON.stringify([...SHIFT_VRIJ].sort()));
  ok('APC: Bank (de hubtoets) en Shift staan niet bij "Shift + knop vrij"', !v.apc.shiftVrij.includes('bank') && !v.apc.shiftVrij.includes('shift'));
  const rij4 = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => `pad2-${k}`);
  ok('APC modus sampler: rij 4 van boven (pad2-1…2-8, noot 8–15) is helemaal vrij', rij4.every((p) => v.apc.inModus['grid.sampler'].includes(p)));
  ok('APC modus sampler: rij 1–3 en linksonder zijn bezet', !v.apc.inModus['grid.sampler'].some((p) => /^pad[345]-/.test(p) || p === 'pad1-1'));
  const MASCHINE_VRIJ = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'all', 'auto', 'volume', 'swing', 'tempo', 'noteRepeat', 'grid', 'padMode',
    'navigate', 'duplicate', 'select', 'solo', 'mute'];
  ok(`Maschine: 21 vrij (F1–F8, ALL, AUTO, VOLUME, SWING, TEMPO, NOTE REPEAT, GRID, PAD MODE, NAVIGATE, DUPLICATE, SELECT, SOLO, MUTE), 27 in gebruik`,
    JSON.stringify(v.maschine) === JSON.stringify(MASCHINE_VRIJ) && kaart.maschine.inGebruik.length === 27);
  ok('LPD8 in Varve: K1, K3, K5–K8 vrij', JSON.stringify(v.lpd8) === '["K1","K3","K5","K6","K7","K8"]');
  ok('LPD8: K2 = video.master, K4 = video.pulse, P1 = video.black.hold (de rollen van hub.js)',
    ['K2:video.master', 'K4:video.pulse', 'P1:video.black.hold'].every((x) => { const [id, a] = x.split(':'); return kaart.lpd8.rijen.find((r) => r.id === id)?.varve?.action === a; }));
  ok('LPD8: zestien plekken, P2–P8 van de hub', LPD8.length === 16 && kaart.lpd8.rijen.filter((r) => /^P[2-8]$/.test(r.id)).every((r) => r.hub && !r.vrij));
  ok('Xboard: niets vrij, 16 knoppen en de schuif', v.xboard.length === 0 && kaart.xboard.rijen.length === 17);
}

console.log('\n(4) elke actie zonder plek heeft een voorstel of een uitzondering');
{
  const onbekend = kaart.zonderPlek.filter((z) => z.status === 'onbekend').map((z) => z.actie);
  ok(`geen actie zonder plek en zonder besluit (${kaart.zonderPlek.length} zonder plek)${onbekend.length ? `; zet in handen/voorstel.json: ${onbekend.join(', ')}` : ''}`, !onbekend.length);
  ok('geen achterhaald voorstel (een voorstel voor een actie die al in een mapping staat)', !kaart.verouderd.length);
  ok('elke regel in voorstel.json heeft een status (voorstel, geen of standaard) en een waarom', voorstel.acties.every((a) => ['voorstel', 'geen', 'standaard'].includes(a.status) && a.waarom));
  ok('elke uitzondering heeft een reden, en past op minstens één actie', voorstel.uitzonderingen.every((u) => u.reden && kaart.zonderPlek.some((z) => z.patroon === u.patroon)));
  // Een voorstelplek moet vandaag echt vrij zijn, in de context waar hij gaat gelden.
  const v = kaart.vrij.apc;
  for (const a of voorstel.acties.filter((x) => x.status === 'voorstel')) {
    if (a.apc) {
      const vrij = a.apc.laag ? v.inModus[a.apc.laag] ?? [] : a.apc.shift ? v.shiftVrij : v.zonderRegel;
      ok(`${a.actie}: de APC-plek (${a.apc.shift ? 'Shift + ' : ''}${a.apc.plekken.join(', ')}${a.apc.laag ? ` in ${a.apc.laag}` : ''}) is vrij`, a.apc.plekken.every((p) => vrij.includes(p)));
    }
    if (a.maschine) ok(`${a.actie}: de Maschine-plek (${a.maschine.plekken.join(', ')}) is vrij`, a.maschine.plekken.every((p) => kaart.vrij.maschine.includes(p)));
  }
  ok('sampler.N.drums op de Maschine nooit met SHIFT (K10: SHIFT + pad = leegmaken)', !voorstel.acties.find((a) => a.actie === 'sampler.N.drums').maschine.plekken.includes('shift'));
  ok('broadcast.toggle bewust op geen enkele controller', voorstel.acties.some((a) => a.actie === 'broadcast.toggle' && a.status === 'geen' && !a.apc && !a.maschine));
  ok('LPD8-voorstel alleen op een vrije knop', (voorstel.lpd8 || []).every((x) => kaart.vrij.lpd8.includes(x.plek)));
  // Wat de crossover- en beeld-tak toevoegen (nog niet op main) valt onder een voorstel, niet onder "onbekend".
  const naMerge = maakHandenkaart({ mappings, controls: APC_CONTROLS, knoppen, eigen: UITLEG, params: PARAMS, register: [...register.ids, 'sampler.3.drums', 'video.clips', 'iets.nieuws'], voorstel });
  ok('na het mergen van #23 en #26: video.clips en sampler.N.drums hebben een voorstel; iets nieuws valt op',
    naMerge.zonderPlek.find((z) => z.actie === 'video.clips')?.status === 'voorstel' && naMerge.zonderPlek.find((z) => z.actie === 'sampler.N.drums')?.status === 'voorstel'
    && naMerge.zonderPlek.find((z) => z.actie === 'iets.nieuws')?.status === 'onbekend');
  // Staat een voorgestelde actie in een mapping (stap 4 van het ontwerp), dan is het voorstel achterhaald.
  const metRegel = { ...mappings, apc: { ...mappings.apc, rules: [...mappings.apc.rules, { in: 'note:0:80', action: 'video.clips', mode: 'trigger', shift: true }] } };
  const later = maakHandenkaart({ mappings: metRegel, controls: APC_CONTROLS, knoppen, eigen: UITLEG, params: PARAMS, register: [...register.ids, 'video.clips'], voorstel });
  ok('video.clips in de standaard: het voorstel is achterhaald en Shift + master is niet meer vrij', JSON.stringify(later.verouderd) === '["video.clips"]' && !later.vrij.apc.shiftVrij.includes('mastersel'));
  // Brede uitzonderingen slikken nieuwe actions stil in; daarom het aantal per patroon vast.
  // Valt dit om: kijk of de nieuwe actie echt bij de uitzondering hoort, en pas dan het getal aan.
  const BREED = { 'video.fx.*': 6, 'video.layer.*': 4, 'track.N.stem.*': 45, 'track.N.pattern.*': 3, 'track.N.loop.*': 4, 'track.N.grid.*': 4, 'klankschaal.*': 18, 'patterns.*': 2 };
  const perPatroon = (p) => kaart.zonderPlek.filter((z) => z.status === 'uitzondering' && z.patroon === p).map((z) => z.actie);
  for (const [p, n] of Object.entries(BREED)) {
    const acties = perPatroon(p);
    ok(`uitzondering ${p}: precies ${n} actions${acties.length !== n ? ` — nu ${acties.length}: ${acties.join(', ')}` : ''}`, acties.length === n);
  }
  ok('patroonPast: * over punten heen, zonder * alleen precies', patroonPast('track.N.stem.*', 'track.N.stem.drums.send.a') && !patroonPast('track.N.stem.*', 'track.N.stemx')
    && patroonPast('*.glide', 'track.N.fader.glide') && !patroonPast('log.toggle', 'log.toggle.x'));
}

console.log('\n(5) kaart.js en telling.js: puur, niets uit src/engine/');
{
  // De importboom van src/handen/ nalopen (statisch en import()), zoals hub.test dat voor de mixer doet.
  const gezien = new Set();
  const loop = (url) => {
    if (gezien.has(url.href)) return;
    gezien.add(url.href);
    const tekst = readFileSync(url, 'utf8');
    for (const m of tekst.matchAll(/(?:^|\n)\s*(?:import|export)[^'"`;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
      const doel = m[1] || m[2];
      if (doel.startsWith('.')) loop(new URL(doel, url));
      else gezien.add(doel);
    }
  };
  for (const f of ['kaart.js', 'telling.js', 'apc-controls.js']) loop(new URL(`../src/handen/${f}`, import.meta.url));
  const alles = [...gezien];
  ok(`de importboom blijft in src/handen/ (${alles.length} bestanden: ${alles.map((x) => x.split('/').slice(-2).join('/')).join(', ')})`,
    alles.every((x) => x.includes('/src/handen/')));
  ok('geen node:-modules (geen I/O)', !alles.some((x) => x.startsWith('node:')));
  const bron = ['kaart.js', 'telling.js', 'apc-controls.js'].map((f) => lees(`src/handen/${f}`)).join('\n');
  ok('geen DOM, geen fetch, geen process', !/\b(document|window|fetch|process)\./.test(bron.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
}

console.log('\n(6) de telling rekent als de telling van 10 okt (extra-2/klad/telling.mjs)');
{
  // De normalisatie en de groepen, letterlijk uit klad/telling.mjs (10 okt), als referentie.
  const refNorm = (a) => a.replace(/^track\.\d+\./, 'track.N.').replace(/^sampler\.\d+\./, 'sampler.N.').replace(/\.(\d+)$/, '.K').replace(/\.knob\.\d+/, '.knob.K').replace(/\.hotcue\.\d+/, '.hotcue.K').replace(/\.section\.\d+/, '.section.K').replace(/\.step\.\d+/, '.step.K').replace(/\.pattern\.\d+/, '.pattern.K').replace(/\.layer\.\d+/, '.layer.K');
  const refGroep = (a) => a.startsWith('video.') ? 'video/vormen' : a.startsWith('beeld.') ? 'beeld (Stroommachine)' : a.startsWith('sampler.') ? 'sampler' : a.startsWith('layer.') ? 'mapjes' : a.includes('.fx.') || a.startsWith('fx.') || a.includes('send.') ? 'effecten/sends' : a.includes('.stem.') ? 'stems' : a.includes('.pattern') || a.startsWith('patterns.') ? 'patronen' : a.includes('.inst') ? 'instrument' : a.startsWith('klankschaal.') ? 'klankschaal' : a.startsWith('master.') ? 'master' : a.startsWith('auto.') ? 'auto-dj' : a.startsWith('library.') ? 'library' : a.startsWith('headphone.') || a.includes('.pfl') ? 'koptelefoon' : a.startsWith('track.N.') ? 'track (transport/mixer)' : 'overig';
  const refTel = (teksten) => {
    const telling = new Map(); let totaal = 0, regels = 0;
    for (const txt of teksten) for (const line of txt.split('\n')) {
      if (!line) continue; regels++;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!Array.isArray(r)) continue;
      const norm = refNorm(String(r[1]));
      telling.set(norm, (telling.get(norm) || 0) + 1); totaal++;
    }
    return { telling, totaal, regels };
  };
  // Een synthetisch log dat elke regel van de normalisatie raakt, plus kop, stand, een kapotte regel en lege regels.
  const ACTIES = ['track.1.fader', 'track.8.fader', 'track.3.fx.knob.2', 'track.2.send.a', 'track.4.hotcue.3', 'track.1.section.12',
    'track.2.pattern.step.17', 'track.5.pattern.3', 'track.5.pattern.3.now', 'video.layer.knob.4', 'video.layer.select.1', 'sampler.4.drums',
    'sampler.2', 'sampler.volume', 'mixer.xfader', 'layer.grid.hotcues', 'klankschaal.veld.7', 'headphone.level', 'track.6.pfl',
    'track.1.stem.drums.send.b', 'track.3.inst.knob.8', 'master.fx.knob.5', 'auto.aan', 'library.next', 'beeld.macro.intensiteit',
    'patterns.record', 'track.7.beatloop.0.25', 'window.R.show.3', 'track.1.play'];
  const log = (zaad) => {
    const regels = [JSON.stringify({ t: 0, e: 'kop', versie: 1, begon: '2026-10-10T17:09:59.460Z' }), JSON.stringify({ t: 0, e: 'stand', focus: 1, tracks: [] })];
    let x = zaad;
    for (let i = 0; i < 400; i++) { x = (x * 1103515245 + 12345) % 2147483648; regels.push(JSON.stringify([i / 10, ACTIES[x % ACTIES.length], (x % 100) / 100])); }
    regels.splice(50, 0, '{ kapot', '', '[1,"track.1.fader"', JSON.stringify({ t: 3, e: 'laad', track: 1 }));
    return regels.join('\n') + '\n';
  };
  const logs = [log(7), log(42), ''];
  const t = T.legeTelling();
  logs.forEach((l, i) => T.telLog(t, l, `set-${i}.acties.jsonl`));
  const ref = refTel(logs);
  ok(`zelfde aantal handelingen (${t.acties}) en regels (${t.regels})`, t.acties === ref.totaal && t.regels === ref.regels);
  ok(`zelfde telling per genormaliseerde actie (${t.per.size} soorten)`, JSON.stringify([...t.per].sort()) === JSON.stringify([...ref.telling].sort()));
  ok('zelfde groepen', [...t.per.keys()].every((a) => T.groep(a) === refGroep(a)));
  ok('per log: aantal en naam', t.logs === 3 && JSON.stringify(t.perLog.map(([n, a]) => [n, a])) === JSON.stringify([['set-0.acties.jsonl', 400], ['set-1.acties.jsonl', 400], ['set-2.acties.jsonl', 0]]));
  ok('normaliseer: track.3.fx.knob.2 → track.N.fx.knob.K, sampler.4.drums → sampler.N.drums, track.5.pattern.3 → track.N.pattern.K',
    T.normaliseer('track.3.fx.knob.2') === 'track.N.fx.knob.K' && T.normaliseer('sampler.4.drums') === 'sampler.N.drums' && T.normaliseer('track.5.pattern.3') === 'track.N.pattern.K');
  const top = T.top(t, 3);
  ok('top: hoogste eerst', top.length === 3 && top[0][1] >= top[1][1] && top[1][1] >= top[2][1]);
  const g = T.perGroep(t);
  ok('per groep telt op tot het totaal', g.reduce((s, [, n]) => s + n, 0) === t.acties);
  // De top-40 van de kaart wijst de hand aan uit de mappings.
  const metLog = maakHandenkaart({ mappings, controls: APC_CONTROLS, knoppen, eigen: UITLEG, params: PARAMS, register: register.ids, voorstel, telling: t });
  const fader = metLog.top.rijen.find((r) => r.actie === 'track.N.fader');
  ok('top: track.N.fader → APC fader 1–8 en de Xboard-schuif', fader?.plekken.join(' / ') === 'APC: fader 1–8 / Xboard: schuif');
  ok('top: video.layer.knob.K → het mapje vorm (?vormen=1)', metLog.top.rijen.find((r) => r.actie === 'video.layer.knob.K')?.plekken.some((p) => p.includes('device.vorm, ?vormen=1')));
  ok('labelsKort: reeksen en pads', labelsKort(['fader 1', 'fader 2', 'fader 3', 'play']) === 'fader 1–3, play' && labelsKort(['pad r1k1', 'pad r1k2']) === '2 pads');
}

console.log('\nde CLI en docs/HANDEN.md');
{
  const doc = lees('docs/HANDEN.md');
  ok('HANDEN.md heeft de markers, een keer elk, in de goede volgorde', doc.split(H.BEGIN).length === 2 && doc.split(H.EIND).length === 2 && doc.indexOf(H.BEGIN) < doc.indexOf(H.EIND));
  ok('HANDEN.md heeft de proefvolgorde (hub-middag) en de kernset (K1–K4)', /## 2\. Eén proefvolgorde/.test(doc) && /2a hub-middag/.test(doc) && /## 3\. De kernset onderweg/.test(doc)
    && ['K1 APC alleen', 'K2 APC + Maschine', 'K3 Maschine alleen', 'K4 APC + LPD8'].every((k) => doc.includes(k)));
  ok('het gegenereerde deel staat erin (vrije plekken, voorstel, zonder plek)', doc.includes('### APC40 mkII') && doc.includes('### Acties zonder plek op een controller'));
  ok('vervangTussenMarkers vervangt alleen wat ertussen staat', H.vervangTussenMarkers(`a\n${H.BEGIN}\noud\n${H.EIND}\nb`, 'nieuw') === `a\n${H.BEGIN}\n\nnieuw\n\n${H.EIND}\nb`);
  let gooit = false; try { H.vervangTussenMarkers('zonder markers', 'x'); } catch { gooit = true; }
  ok('zonder markers: een fout, niets overschreven', gooit);
  const b = { kaart, mappings, voorstel, telling: null, bronnen: { controls: 'de ingebakken kopie', profielen: null, logs: null, register: { acties: register.ids.length, fouten: [] } } };
  const md = H.markdown(b);
  ok('markdown: alle delen, de rollen met de vijf profielen, geen "onbekend"', ['### Rol per controller', '### APC40 mkII', '### Maschine MK2', '### LPD8', '### Xboard49', '### Acties zonder plek', '### Wat de handen doen'].every((k) => md.includes(k))
    && ['`laptop`', '`apc`', '`maschine`', '`alles`', '`beeld`'].every((p) => md.includes(p)) && md.includes('**Zonder plek en zonder besluit:** geen.'));
  ok('markdown: master-knop met voorstel video.clips, DUPLICATE met sampler.N.drums', /\| master \(mastersel.*voorstel `video\.clips`/.test(md) && /\| DUPLICATE .*voorstel `sampler\.N\.drums`/.test(md));
  const html = H.html(md);
  ok('html: A4 liggend, een tabel per deel, geen script', html.includes('size: A4 landscape') && (html.match(/<table>/g) || []).length >= 8 && !/<script/i.test(html));
  ok('de bronregel hangt niet af van waar de controls vandaan komen (hub of kopie)', H.mdBron({ ...b, bronnen: { ...b.bronnen, controls: 'de hub' } }) === H.mdBron(b));
  const metTop = `a\n${H.BEGIN}\n\nx\n\n${H.KOP_TOP} (top-40)\n\n| 1 |\n\n${H.EIND}\nb`;
  ok('topUitDoc en zetTop: zonder logs blijft de top-40 die er stond', H.topUitDoc(metTop) === `${H.KOP_TOP} (top-40)\n\n| 1 |`
    && H.zetTop(`y\n\n${H.KOP_TOP}\n\nGeen`, H.topUitDoc(metTop)) === `y\n\n${H.KOP_TOP} (top-40)\n\n| 1 |` && H.topUitDoc('geen markers') === null);
  const { VOORSTEL_V0 } = await import('../tools/handen/voorstel-v0.mjs');
  ok('de v0 in tools/handen/voorstel-v0.mjs heeft dezelfde acties als handen/voorstel.json (beginpunt)', JSON.stringify(VOORSTEL_V0.acties.map((a) => a.actie)) === JSON.stringify(voorstel.acties.map((a) => a.actie)));
}

console.log('\nde CLI als programma (spawnSync; schrijft niets in de repo)');
{
  const cli = fileURLToPath(new URL('../tools/handen/handenkaart.mjs', import.meta.url));
  const docUrl = new URL('../docs/HANDEN.md', import.meta.url), voorstelUrl = new URL('../handen/voorstel.json', import.meta.url);
  const stand = () => [readFileSync(docUrl, 'utf8'), statSync(docUrl).mtimeMs, readFileSync(voorstelUrl, 'utf8')].join('\0');
  const voor = stand();
  const tmp = mkdtempSync(join(tmpdir(), 'varve-handen-'));
  const env = { ...process.env, VARVE_OPNAMES: join(tmp, 'opnames') };
  const draai = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  const j = draai('--json');
  let geparst = null; try { geparst = JSON.parse(j.stdout); } catch { /* blijft null */ }
  ok(`--json door een pipe: heel (${j.stdout.length} bytes, meer dan 64 KiB) en te parsen`, j.status === 0 && j.stdout.length > 65536 && geparst?.apc?.length === 148 && Array.isArray(geparst.zonderPlek));
  const tekst = join(tmp, 'tekst.txt');
  writeFileSync(tekst, 'iets van Clay\n');
  const r1 = draai('--html', '--uit', tekst);
  ok('--html --uit op een bestaand bestand dat geen handenkaart is: exit 2, bestand heel', r1.status === 2 && readFileSync(tekst, 'utf8') === 'iets van Clay\n');
  const r2 = draai('--html', '--uit', tmp);
  ok('--html --uit op een map: exit 2', r2.status === 2 && /is een map/.test(r2.stderr));
  const kaartPad = join(tmp, 'oud.html');
  writeFileSync(kaartPad, H.html('### oud'));
  ok('uitWeigering: een eerdere handenkaart en een nieuw pad mogen, een gewoon bestand niet', H.uitWeigering(kaartPad) === null && H.uitWeigering(join(tmp, 'nieuw', 'k.html')) === null && H.uitWeigering(tekst) !== null);
  const r3 = draai('--controller');
  ok('--controller zonder waarde: exit 2', r3.status === 2 && /zonder waarde/.test(r3.stderr));
  const r4 = draai('--controleer');
  ok(`--controleer zonder logs: meldt "top-40 niet vergeleken", geen crash (exit ${r4.status})`, [0, 1].includes(r4.status) && /top-40 niet vergeleken/.test(r4.stdout));
  mkdirSync(join(tmp, 'opnames', 'map.acties.jsonl'), { recursive: true });
  ok('leesLogs: een map met een .acties.jsonl-naam wordt overgeslagen (geen EISDIR)', H.leesLogs(join(tmp, 'opnames')) === null);
  writeFileSync(join(tmp, 'opnames', 'set-1.acties.jsonl'), '[0,"track.1.fader",0.5]\n');
  ok('leesLogs: het echte log ernaast telt wel', H.leesLogs(join(tmp, 'opnames'))?.logs === 1);
  ok('docs/HANDEN.md en handen/voorstel.json onaangeroerd na al deze runs', stand() === voor);
  rmSync(tmp, { recursive: true, force: true });
}

console.log('\nde speellijst: blok hub-f0 (de hub-middag)');
{
  const { SPEELLIJST } = await import('../src/controle/speellijst.js');
  const i = SPEELLIJST.findIndex((b) => b.id === 'hub-f0');
  const hub = SPEELLIJST.findIndex((b) => b.id === 'hub');
  // Tussen de hub-middag en het opstarten mag alleen ga-proef staan (14 okt: twee proeven die ook zonder hub gaan).
  const tussen = SPEELLIJST.slice(i + 1, hub).map((b) => b.id);
  ok('hub-f0 staat vóór "Avond 2 · Opstarten met de hub" (alleen ga-proef ertussen), na het laatste blok van avond 1',
    i >= 0 && hub > i && tussen.every((id) => id === 'ga-proef') && SPEELLIJST[i - 1].titel.startsWith('Avond 1 · '));
  const blok = SPEELLIJST[i];
  ok('titel "Avond 2 · Hub-middag…", 80 minuten', blok.titel.startsWith('Avond 2 · Hub-middag') && blok.minuten === 80);
  ok('zes punten, allemaal met het nieuwe voorvoegsel hf-', JSON.stringify(blok.punten.map((p) => p.id)) === '["hf-dicht","hf-doctor","hf-proef","hf-speel","hf-push","hf-check"]');
  const tekst = blok.punten.map((p) => `${p.doe} ${p.let}`).join(' ');
  ok('alleen commando\'s die de hub kent: doctor, proef, proef speelapparaten, check -- studio', ['node src/cli.js doctor', 'node src/cli.js proef:', 'node src/cli.js proef speelapparaten', 'npm run check -- studio'].every((c) => tekst.includes(c)));
  ok('geen hf-id elders in de lijst', SPEELLIJST.filter((b) => b.id !== 'hub-f0').every((b) => b.punten.every((p) => !p.id.startsWith('hf-'))));
}

console.log('\ndocs/VRAGEN.md: blok HA');
{
  const vragen = lees('docs/VRAGEN.md');
  // Niet "het laatste blok": volgende takken voegen hun blok ook onderaan toe.
  ok('blok HA bestaat één keer, na blok O', vragen.split('\n## HA. ').length === 2 && vragen.indexOf('\n## HA. ') > vragen.indexOf('\n## O. ') && vragen.includes('\n## O. '));
  ok('HA1–HA10 bestaan, elk één keer', Array.from({ length: 10 }, (_, k) => `**HA${k + 1}. `).every((c) => vragen.split(c).length === 2));
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
