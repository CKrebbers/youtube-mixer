// De Controlekamer zonder browser: de opslag van de speellijst
// (server/proef.js), de speellijst zelf (src/controle/speellijst.js), het
// bericht dat de mixer stuurt (src/ui/status-zender.js) en de tegel Stems
// (src/ui/stems-weergave.js). Op een tijdelijke map.
// Draai met: node test/controle.test.mjs
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const { Proef, ID, STATUSSEN } = await import('../server/proef.js');
const { SPEELLIJST, allePunten } = await import('../src/controle/speellijst.js');
const { maakStatus } = await import('../src/ui/status-zender.js');

console.log('de speellijst');
{
  const punten = allePunten();
  const ids = punten.map((p) => p.id);
  ok(`elk punt-id is uniek (${ids.length} punten)`, new Set(ids).size === ids.length);
  ok('elk punt-id past op de server (letters, cijfers, - en _)', ids.every((id) => ID.test(id)));
  ok('elk punt heeft een doe en een let', punten.every((p) => p.doe && p.let));
  ok('elk blok heeft een titel, minuten en punten', SPEELLIJST.every((b) => b.titel && b.minuten > 0 && b.punten.length));
  ok('blok-ids zijn uniek', new Set(SPEELLIJST.map((b) => b.id)).size === SPEELLIJST.length);
  // De stand op de server hangt aan het id: een punt dat al bestond, blijft bestaan
  // (anders raakt zijn notitie kwijt). De punten van vóór 6 okt:
  const EERDER = ['start-apc', 'start-audio', 'start-scherm', 'dr-laden', 'dr-opdemaat', 'dr-beatjump', 'dr-loop',
    'dr-quantize', 'dr-rem', 'dr-mix', 'kl-modus', 'kl-kill', 'kl-kleuren', 'kl-knipper', 'to-pitch', 'to-klopt',
    'to-sorteer', 'to-hotcue', 'in-drie', 'in-dubbel', 'in-playlist', 'au-aan', 'au-overgang', 'au-knoppen', 'au-apc',
    'au-glad', 'pl-open', 'pl-live', 'pl-mist', 'ks-toon', 'ks-vol', 'ks-wissel', 'be-los', 'be-achter', 'be-vormen',
    'be-zwart', 'be-nood', 'kp-apparaat', 'kp-cue', 'kp-mix', 'kp-opname', 'ra-hotcue', 'ra-gate', 'ra-backup'];
  const weg = EERDER.filter((id) => !ids.includes(id));
  ok(`de ${EERDER.length} punten van vóór 6 okt bestaan nog${weg.length ? ` (weg: ${weg.join(', ')})` : ''}`, !weg.length);
  // Een vraagcode tussen haakjes in een let-tekst ("(S21)", "(I4, O2)", "(VRAGEN AU2)") bestaat in docs/VRAGEN.md.
  const vragen = readFileSync(new URL('../docs/VRAGEN.md', import.meta.url), 'utf8');
  const vraagcodes = (tekst) => [...tekst.matchAll(/\((?:VRAGEN )?([A-Z]{1,3}\d{1,2}(?:, [A-Z]{1,3}\d{1,2})*)\)/g)]
    .flatMap((m) => m[1].split(', '));
  // Ook codes van drie letters (de sporen van de secties: SVC1, …): anders liep een onbekende code er stil doorheen.
  ok('vraagcodes: ook drie letters, en een lijst', JSON.stringify(vraagcodes('Klopt het? (SVC1) En (S21, SVC2)')) === '["SVC1","S21","SVC2"]');
  const codes = [...new Set(punten.flatMap((p) => vraagcodes(p.let)))];
  const onbekend = codes.filter((c) => !new RegExp(`\\*\\*${c}[. ]`).test(vragen));
  ok(`elke vraagcode in de speellijst staat in docs/VRAGEN.md (${codes.length} codes${onbekend.length ? `; onbekend: ${onbekend.join(', ')}` : ''})`,
    codes.length > 0 && !onbekend.length);
}

console.log('\nde opslag (proef/sessie.json)');
{
  const map = mkdtempSync(join(tmpdir(), 'varve-proef-'));
  try {
    const p = new Proef(map);
    const leeg = await p.lees();
    ok('zonder bestand: leeg, niet begonnen', leeg.begonnen === null && Object.keys(leeg.items).length === 0);

    let r = await p.zet('dr-rem', { status: 'fout', notitie: '  klikt aan het eind  ' });
    ok('fout met notitie: 200, notitie zonder witruimte eromheen', r.code === 200 && r.antwoord.item.notitie === 'klikt aan het eind');
    const d = JSON.parse(readFileSync(join(map, 'sessie.json'), 'utf8'));
    ok('op schijf: begonnen gezet, het punt met status, notitie en tijd', d.begonnen && d.items['dr-rem'].status === 'fout'
      && typeof d.items['dr-rem'].tijd === 'string');

    r = await p.zet('dr-rem', { status: 'open', notitie: '' });
    ok('open zonder notitie haalt het punt weg', r.code === 200 && r.antwoord.item === null && !(await p.lees()).items['dr-rem']);
    r = await p.zet('dr-loop', { status: 'open', notitie: 'nog niet geprobeerd, wel een vraag' });
    ok('open MET notitie blijft staan', (await p.lees()).items['dr-loop']?.notitie.startsWith('nog niet'));

    ok('verkeerde status: 400', (await p.zet('x', { status: 'misschien' })).code === 400);
    ok('verkeerd id: 400', (await p.zet('../x', { status: 'ok' })).code === 400 && (await p.zet('', { status: 'ok' })).code === 400);
    ok('notitie geen tekst: 400', (await p.zet('x', { status: 'ok', notitie: 5 })).code === 400);
    ok('notitie te lang: 413', (await p.zet('x', { status: 'ok', notitie: 'a'.repeat(2001) })).code === 413);
    ok(`statussen: ${STATUSSEN.join(', ')}`, STATUSSEN.join() === 'open,ok,fout,overslaan');

    // twintig punten tegelijk (twee tabbladen, snel klikken): niets gaat verloren
    await Promise.all(Array.from({ length: 20 }, (_, i) => p.zet(`p${i}`, { status: 'ok' })));
    const veel = await p.lees();
    ok('twintig tegelijk gezet: alle twintig staan erin', Array.from({ length: 20 }, (_, i) => veel.items[`p${i}`]?.status === 'ok').every(Boolean));
    ok('geen tijdelijke bestanden achtergebleven', !readdirSync(map).some((f) => f.endsWith('.tmp')));

    writeFileSync(join(map, 'sessie.json'), '{ kapot');
    ok('kapot bestand: leeg in plaats van een fout', Object.keys((await p.lees()).items).length === 0);
    await p.zet('a', { status: 'ok' });

    const n = await p.nieuw();
    ok('nieuwe ronde: de oude sessie in archief/', n.gearchiveerd?.startsWith('archief/') && readdirSync(join(map, 'archief')).length === 1);
    const na = await p.lees();
    ok('... en daarna leeg', na.begonnen === null && Object.keys(na.items).length === 0);
    ok('nieuwe ronde op een lege sessie bewaart niets', (await p.nieuw()).gearchiveerd === null && readdirSync(join(map, 'archief')).length === 1);
  } finally { rmSync(map, { recursive: true, force: true }); }
}

console.log('\nhet bericht van de mixer (status-zender.js)');
{
  const snap = {
    focus: 'A', maat: 'B',
    decks: {
      A: { id: 'A', loaded: true, playing: true, title: 'let it all go', bpm: 169.62, toon: { camelot: '2B', kort: 'F#' } },
      B: { id: 'B', loaded: true, playing: false, title: 'zoned out', bpm: null, toon: null },
      C: { id: 'C', loaded: false, playing: false, title: null, bpm: null, toon: null },
    },
  };
  const midi = { supported: true, enabled: true, error: null, input: { name: 'APC40 mkII' }, output: { name: 'APC40 mkII' },
    rx: 12, echoes: 0, verkeerdePoort: false };
  const s = maakStatus({ snap, midi, audio: 'running', auto: true, opname: false, nu: 1000 });
  ok('alleen geladen tracks', s.tracks.map((t) => t.id).join() === 'A,B');
  ok('bpm op één decimaal, toonsoort als "2B F#"', s.tracks[0].bpm === 169.6 && s.tracks[0].toon === '2B F#');
  ok('geen bpm of toon: null', s.tracks[1].bpm === null && s.tracks[1].toon === null);
  ok('APC: invoer, echo-teller en geen verkeerde poort', s.midi.invoer === 'APC40 mkII' && s.midi.echoes === 0 && s.midi.verkeerdePoort === false);
  ok('focus, maat, audio, auto, tijd', s.focus === 'A' && s.maat === 'B' && s.audio === 'running' && s.auto === true && s.t === 1000);
  ok('het bericht is te klonen (BroadcastChannel)', JSON.stringify(structuredClone(s)) === JSON.stringify(s));
  const zonder = maakStatus({ snap: null, midi: null });
  ok('zonder engine en MIDI: lege lijst, midi null', zonder.tracks.length === 0 && zonder.midi === null);
  const fout = maakStatus({ snap, midi: { ...midi, enabled: false, error: new Error('geweigerd'), input: null } });
  ok('een MIDI-fout wordt tekst', fout.midi.fout === 'Error: geweigerd' && fout.midi.invoer === null);
}

console.log('\nde tegel Stems (stems-weergave.js)');
{
  const { stemsTegel } = await import('../src/ui/stems-weergave.js');
  const t = (a) => stemsTegel(a);
  ok('nog niets: uit, "…"', t(null).licht === 'uit' && t(null).waarde === '…' && t(null).naam === 'Stems');
  ok('een server zonder stems (404): onbekend, met uitleg', t({ ontbreekt: true }).waarde === 'onbekend' && /\/api\/stems/.test(t({ ontbreekt: true }).sub));
  const weg = t({ opdrachten: [], beschikbaar: false, reden: 'demucs ontbreekt in ~/.varve/stems-venv' });
  ok('splitter weg: rood, met de reden', weg.licht === 'fout' && weg.waarde === 'splitter ontbreekt' && /demucs ontbreekt/.test(weg.sub));
  ok('splitter weg zonder reden: toch een uitleg', t({ opdrachten: [], beschikbaar: false }).sub.length > 0);
  const druk = t({ beschikbaar: true, opdrachten: [
    { id: 'a', track: 'x', titel: 'een album', aantal: 4, status: 'bezig', voortgang: 0.31 },
    { id: 'b', track: 'y', aantal: 2, status: 'wacht' }, { id: 'c', track: 'z', aantal: 2, status: 'wacht' },
    { id: 'd', track: 'q', aantal: 2, status: 'klaar' }] });
  ok(`wat loopt en wat wacht ("${druk.waarde}", "${druk.sub}")`, druk.licht === 'half' && druk.waarde === '1 bezig, 2 wacht'
    && druk.sub === 'een album · in 4 · 31%');
  ok('alleen wachtend: half, "wacht op de splitter"', /wacht op de splitter/.test(t({ opdrachten: [{ id: 'b', status: 'wacht', aantal: 2 }] }).sub));
  const leeg = t({ opdrachten: [{ id: 'd', status: 'klaar', aantal: 2 }], beschikbaar: true });
  ok('niets open: groen, "splitter klaar"', leeg.licht === 'ok' && leeg.waarde === 'leeg' && leeg.sub === 'splitter klaar');
  const mis = t({ opdrachten: [{ id: 'e', track: 't', titel: 'oud', status: 'fout', fout: 'kapot', klaar: 1 },
    { id: 'f', track: 't2', titel: 'nieuw', status: 'fout', fout: 'geheugen op', klaar: 2 }] });
  ok('de laatste mislukte staat erbij (half)', mis.licht === 'half' && /nieuw \(geheugen op\)/.test(mis.sub));
  ok('de tegel is te klonen zoals de andere (gewone data)', JSON.stringify(structuredClone(druk)) === JSON.stringify(druk));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
