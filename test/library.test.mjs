// De library: tracks, peaks en vooral de effect-racks per link.
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { Library, SCHEMA, normaliseerGrid } = await import('../server/library.js');
const { TOON_VERSIE } = await import('../server/toon.js');
const { DatabaseSync } = await import('node:sqlite');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

const map = mkdtempSync(join(tmpdir(), 'varve-lib-'));
const pad = join(map, 'library.db');
let lib = new Library(pad);

const nummer = (id, titel) => ({
  id, url: `https://youtu.be/${id}`, titel, uploader: 'ADRIANA', duur: 1860,
  audio: `media/${id}/audio.wav`, video: `media/${id}/video.mp4`, thumbnail: '',
  loudness: { I: -19.4, TP: -0.8, LRA: 6.2, drempel: -30.1, offset: 0.4 },
  doelLoudness: -14, ytdlp: '2026.8.19',
});

// ---- schema ---------------------------------------------------------------

const versieNa = lib.versie;
ok('schema wordt aangelegd', versieNa >= 1);
lib.sluit();
lib = new Library(pad);
ok('opnieuw openen migreert niet nog een keer', lib.versie === versieNa);

// ---- tracks ---------------------------------------------------------------

const t = lib.bewaarTrack(nummer('abc123', 'Eerste nummer'));
ok('track bewaard', t.id === 'abc123' && t.titel === 'Eerste nummer');
ok('loudness gaat mee de database in', Math.abs(t.loudness_i + 19.4) < 1e-9);
ok('doel-loudness ook', t.doel_loudness === -14);
ok('en met welke yt-dlp hij binnenkwam', t.ytdlp === '2026.8.19');

lib.bewaarTrack({ ...nummer('abc123', 'Zelfde nummer, nieuwe titel') });
ok('opnieuw binnenhalen overschrijft in plaats van te verdubbelen',
  lib.tracks().length === 1 && lib.track('abc123').titel === 'Zelfde nummer, nieuwe titel');

lib.bewaarTrack(nummer('def456', 'Tweede nummer'));
ok('twee nummers in de lijst', lib.tracks().length === 2);
ok('nieuwste eerst', lib.tracks()[0].id === 'def456');
ok('zoeken op titel', lib.tracks({ zoek: 'Tweede' }).length === 1);
ok('zoeken op uploader', lib.tracks({ zoek: 'ADRIANA' }).length === 2);
ok('zoeken zonder treffer', lib.tracks({ zoek: 'bestaat niet' }).length === 0);

lib.geladen('abc123');
ok('laden wordt geteld', lib.track('abc123').keer_geladen === 1);
lib.geladen('abc123');
ok('en blijft tellen', lib.track('abc123').keer_geladen === 2);

// ---- effect-racks: het punt van deze hele tabel ---------------------------

ok('een nieuw nummer heeft nog geen racks', lib.racks('abc123').length === 0);

const r1 = lib.bewaarRack({ trackId: 'abc123', naam: 'dub delay', data: { slots: { 1: 'delay.tijd', 2: 'delay.feedback' } } });
const r2 = lib.bewaarRack({ trackId: 'abc123', naam: 'filter sweep', data: { slots: { 1: 'filter.freq' } } });
ok('meerdere racks per nummer', lib.racks('abc123').length === 2);
ok('de inhoud komt terug zoals hij erin ging', lib.rack(r1.id).data.slots['2'] === 'delay.feedback');
ok('nog geen rack actief', lib.actiefRack('abc123') === null);

lib.zetActiefRack('abc123', r2.id);
ok('een rack actief zetten', lib.actiefRack('abc123').naam === 'filter sweep');
lib.zetActiefRack('abc123', r1.id);
ok('wisselen van rack', lib.actiefRack('abc123').naam === 'dub delay');
ok('er is er altijd maar één actief', lib.racks('abc123').filter((r) => r.actief).length === 1);

const bij = lib.bewaarRack({ id: r1.id, trackId: 'abc123', naam: 'dub delay v2', data: { slots: { 1: 'delay.mix' } } });
ok('een bestaand rack bijwerken maakt geen nieuw rack', lib.racks('abc123').length === 2);
ok('en de nieuwe inhoud staat erin', bij.naam === 'dub delay v2' && bij.data.slots['1'] === 'delay.mix');

lib.bewaarRack({ trackId: 'def456', naam: 'ander nummer', data: {} });
ok('racks van het ene nummer horen niet bij het andere',
  lib.racks('abc123').length === 2 && lib.racks('def456').length === 1);
ok('de lijst toont hoeveel racks een nummer heeft', lib.tracks({ zoek: 'Zelfde' })[0].racks === 2);

lib.verwijderRack(r2.id);
ok('een rack weghalen', lib.racks('abc123').length === 1);

// ---- beatgrid: hoort bij de link, net als de racks ------------------------

ok('een nieuw nummer heeft nog geen grid', lib.track('abc123').grid === null);
lib.bewaarGrid('abc123', { bpm: 124.5, firstBeat: 0.37, beatsPerBar: 4 });
const gr = lib.track('abc123').grid;
ok('oud formaat bewaard als één stuk', gr && gr.stukken.length === 1
  && Math.abs(gr.stukken[0].bpm - 124.5) < 1e-9 && Math.abs(gr.stukken[0].anker - 0.37) < 1e-9 && gr.stukken[0].van === 0);
ok('en komt mee in de lijst', lib.tracks({ zoek: 'Zelfde' })[0].grid.stukken[0].bpm === 124.5);
ok('het andere nummer heeft nog steeds geen grid', lib.track('def456').grid === null);

lib.bewaarTrack(nummer('abc123', 'Opnieuw binnengehaald'));
ok('opnieuw binnenhalen gooit het grid niet weg', lib.track('abc123').grid.stukken[0].bpm === 124.5);

const kaart = { stukken: [{ van: 0, bpm: 120, anker: 0.1 }, { van: 95.5, bpm: 150.25, anker: 95.6, zekerheid: 0.8 }],
  beatsPerBar: 4, slot: true, zeker: true };
lib.bewaarGrid('abc123', kaart);
const gk = lib.track('abc123').grid;
ok('tempokaart bewaard: stukken, zekerheid, slot', gk.stukken.length === 2 && gk.stukken[1].bpm === 150.25
  && gk.stukken[1].zekerheid === 0.8 && gk.slot === true && gk.zeker === true);
ok('de oude kolommen krijgen het eerste stuk (voor een oudere versie)',
  (() => { const r = lib.db.prepare('SELECT grid_bpm, grid_first_beat FROM tracks WHERE id = ?').get('abc123');
    return r.grid_bpm === 120 && Math.abs(r.grid_first_beat - 0.1) < 1e-9; })());
let gegooid = false;
try { lib.bewaarGrid('abc123', { stukken: [{ van: 0, bpm: 'veel', anker: 0 }] }); } catch { gegooid = true; }
ok('een ongeldig grid gooit en laat het bewaarde staan', gegooid && lib.track('abc123').grid.stukken.length === 2);
ok('normaliseer: bpm buiten 40-300 geweigerd', normaliseerGrid({ bpm: 500 }) === null);
ok('normaliseer: stukken gesorteerd', normaliseerGrid({ stukken: [{ van: 9, bpm: 100, anker: 9 }, { van: 0, bpm: 120, anker: 0 }] }).stukken[0].van === 0);

lib.bewaarGrid('abc123', null);
ok('grid wissen kan', lib.track('abc123').grid === null);
lib.bewaarGrid('abc123', kaart);            // voor het opruimen hieronder

// ---- migratie v4 -> v5 op een echte v4-database ----------------------------
{
  const pad4 = join(map, 'v4.db');
  const db = new DatabaseSync(pad4);
  for (let v = 0; v < 4; v++) db.exec(SCHEMA[v]);
  db.exec('PRAGMA user_version = 4');
  const ins = db.prepare(`INSERT INTO tracks (id, url, titel, audio, toegevoegd, grid_bpm, grid_first_beat, grid_beats_per_bar)
    VALUES (?,?,?,?,?,?,?,?)`);
  ins.run('metgrid', 'https://youtu.be/metgrid', 'met grid', 'media/metgrid/audio.wav', 1, 128.25, 0.42, 3);
  ins.run('zonder', 'https://youtu.be/zonder', 'zonder grid', 'media/zonder/audio.wav', 2, null, null, null);
  ins.run('geenanker', 'https://youtu.be/geenanker', 'geen anker', 'media/x/audio.wav', 3, 99, null, null);
  db.close();
  const l4 = new Library(pad4);
  // Niet op een hard nummer: er komen versies bij (toonsoort, en wat andere sporen toevoegen).
  ok(`v4 wordt de nieuwste (v${SCHEMA.length})`, l4.versie === SCHEMA.length);
  const m = l4.track('metgrid').grid;
  ok('bestaand grid wordt één stuk', m && m.stukken.length === 1 && m.stukken[0].bpm === 128.25
    && Math.abs(m.stukken[0].anker - 0.42) < 1e-9 && m.stukken[0].van === 0 && m.beatsPerBar === 3);
  ok('zonder grid blijft zonder grid', l4.track('zonder').grid === null);
  ok('zonder anker: anker 0, maat van 4', l4.track('geenanker').grid.stukken[0].anker === 0 && l4.track('geenanker').grid.beatsPerBar === 4);
  l4.sluit();
  const l5 = new Library(pad4);
  ok('opnieuw openen migreert niet nog een keer', l5.versie === SCHEMA.length && l5.track('metgrid').grid.stukken.length === 1);
  l5.sluit();
}

// ---- migratie naar de toonsoort op een echte database van vóór toon_json ----
{
  const pad5 = join(map, 'v5.db');
  const db = new DatabaseSync(pad5);
  const v = SCHEMA.findIndex((sql) => /toon_json/.test(sql));
  for (let i = 0; i < v; i++) db.exec(SCHEMA[i]);
  db.exec(`PRAGMA user_version = ${v}`);
  db.prepare(`INSERT INTO tracks (id, url, titel, audio, toegevoegd, grid_json) VALUES (?,?,?,?,?,?)`)
    .run('oud', 'https://youtu.be/oud', 'oud nummer', 'media/oud/audio.wav', 1, JSON.stringify({ stukken: [{ van: 0, bpm: 100, anker: 0.5 }], slot: true }));
  db.close();
  const l = new Library(pad5);
  const kolommen = l.db.prepare('PRAGMA table_info(tracks)').all().map((k) => k.name);
  ok(`een database zonder toon_json krijgt de kolom (schema v${v} -> v${l.versie})`, v > 0 && kolommen.includes('toon_json') && l.versie === SCHEMA.length);
  ok('een bestaand nummer: toon null, grid ongeschonden', l.track('oud').toon === null && l.track('oud').grid.slot === true);
  ok('en moet dus een toonsoort krijgen (achtergrond)', l.teToonAnalyseren().includes('oud'));
  l.sluit();
}

// ---- toonsoort: hoort bij de link, net als grid en racks ---------------------

{
  lib.bewaarTrack(nummer('toon1', 'Toon één'));
  ok('een nieuw nummer heeft nog geen toonsoort', lib.track('toon1').toon === null);
  const kaartT = { versie: TOON_VERSIE, stemming: 2.3,
    stukken: [{ van: 0, toonsoort: 'G', stemming: 8, zekerheid: 0.87 }, { van: 215.2, toonsoort: 'Ab', stemming: 8, zekerheid: 0.83 }],
    bron: 'auto', slot: false };
  const b = lib.bewaarToon('toon1', kaartT);
  ok('de kaart uit docs/TOONSOORT.md §3 komt terug zoals hij erin ging', JSON.stringify(b) === JSON.stringify(kaartT)
    && JSON.stringify(lib.track('toon1').toon) === JSON.stringify(kaartT));
  ok('en komt mee in de lijst', lib.tracks({ zoek: 'Toon één' })[0].toon.stukken[1].toonsoort === 'Ab');
  lib.bewaarTrack(nummer('toon1', 'Toon één, opnieuw binnengehaald'));
  ok('opnieuw binnenhalen gooit de toonsoort niet weg', lib.track('toon1').toon?.stukken.length === 2);
  let gegooidT = false;
  try { lib.bewaarToon('toon1', { stukken: [{ van: 0, toonsoort: 'H' }] }); } catch { gegooidT = true; }
  ok('een ongeldige kaart gooit en laat de bewaarde staan', gegooidT && lib.track('toon1').toon.stukken.length === 2);
  lib.bewaarToon('toon1', null);
  ok('toonsoort wissen kan', lib.track('toon1').toon === null);

  // Automatisch: nooit over slot, over hand alleen met overHand, de achtergrond alleen wat MOET.
  const autoT = { versie: TOON_VERSIE, stemming: 0, stukken: [{ van: 0, toonsoort: 'C', stemming: 0, zekerheid: 0.6 }] };
  for (const id of ['tLeeg', 'tOud', 'tSlot', 'tHand', 'tAuto']) lib.bewaarTrack(nummer(id, id));
  lib.bewaarToon('tOud', { ...autoT, versie: undefined, bron: 'auto' });
  lib.bewaarToon('tSlot', { stukken: [{ van: 0, toonsoort: 'F#m', stemming: -3 }], bron: 'hand', slot: true });
  lib.bewaarToon('tHand', { stukken: [{ van: 0, toonsoort: 'D', stemming: 0 }], bron: 'hand' });
  lib.bewaarToon('tAuto', { ...autoT, bron: 'auto' });
  const teDoenT = lib.teToonAnalyseren().filter((x) => x.startsWith('t') && x !== 'toon1');
  ok(`te analyseren: leeg en oud, niet slot/hand/actueel (${teDoenT.join(',')})`, teDoenT.join(',') === 'tLeeg,tOud');
  const bump = lib.teToonAnalyseren({ versie: TOON_VERSIE + 1 }).filter((x) => x.startsWith('t') && x !== 'toon1');
  ok(`na een versie-bump ook de actuele auto-kaart, nog steeds niet hand/slot (${bump.join(',')})`, bump.join(',') === 'tLeeg,tOud,tAuto');

  const slotVoorT = JSON.stringify(lib.track('tSlot').toon);
  ok('SLOT wordt nooit overschreven', !lib.bewaarAutoToon('tSlot', autoT).bewaard && !lib.bewaarAutoToon('tSlot', autoT, { overHand: true }).bewaard
    && !lib.bewaarAutoToon('tSlot', autoT, { alleenOud: true, versie: TOON_VERSIE + 1 }).bewaard && JSON.stringify(lib.track('tSlot').toon) === slotVoorT);
  ok('met de hand: niet zonder overHand, ook niet na een versie-bump', !lib.bewaarAutoToon('tHand', autoT).bewaard
    && !lib.bewaarAutoToon('tHand', autoT, { alleenOud: true, versie: TOON_VERSIE + 1 }).bewaard && lib.track('tHand').toon.bron === 'hand');
  ok('de achtergrond laat een actuele auto-kaart staan', !lib.bewaarAutoToon('tAuto', autoT, { alleenOud: true }).bewaard);
  const rOudT = lib.bewaarAutoToon('tOud', { ...autoT, bron: 'hand', slot: true }, { alleenOud: true });
  ok('een oude auto-kaart wordt vervangen, en een voorstel is altijd auto en nooit op slot',
    rOudT.bewaard && rOudT.toon.bron === 'auto' && rOudT.toon.slot === false && rOudT.toon.versie === TOON_VERSIE);
  ok('leeg krijgt het voorstel', lib.bewaarAutoToon('tLeeg', autoT).bewaard);
  ok('↻ (overHand) mag over hand', lib.bewaarAutoToon('tHand', autoT, { overHand: true }).bewaard && lib.track('tHand').toon.bron === 'auto');
  const rForceerT = lib.bewaarAutoToon('tSlot', autoT, { overHand: true, overSlot: true });
  ok('alleen met overSlot (tweede klik) over een slot heen, en dan niet meer op slot', rForceerT.bewaard && rForceerT.toon.slot === false);
  ok('onbekend nummer: niet bewaard', !lib.bewaarAutoToon('bestaatniet', autoT).bewaard);
  ok('na afloop hoeft niets meer', !lib.teToonAnalyseren().some((x) => x.startsWith('t') && x !== 'toon1'));
  for (const id of ['toon1', 'tLeeg', 'tOud', 'tSlot', 'tHand', 'tAuto']) lib.verwijderTrack(id);
}

// ---- peaks ----------------------------------------------------------------

lib.bewaarPeaks('abc123', { bestand: 'media/abc123/peaks.bin', buckets: 8192, perBucket: 256 });
ok('peaks onthouden', lib.peaks('abc123').buckets === 8192);
lib.bewaarPeaks('abc123', { bestand: 'media/abc123/peaks.bin', buckets: 4096, perBucket: 512 });
ok('peaks overschrijven in plaats van verdubbelen', lib.peaks('abc123').buckets === 4096);

// ---- instellingen ---------------------------------------------------------

lib.zet('laatste-deck', { A: 'abc123' });
ok('instelling bewaard', lib.haal('laatste-deck').A === 'abc123');
ok('onbekende instelling geeft de standaard', lib.haal('bestaat-niet', 'leeg') === 'leeg');

// ---- sampler-pads ---------------------------------------------------------

lib.bewaarSample('abc123', { pad: 3, van: 10, tot: 12, tellen: 4, bpm: 120 });
ok('pad bewaard bij het nummer', lib.samples('abc123').length === 1 && lib.samples('abc123')[0].van === 10);
lib.bewaarSample('abc123', { pad: 3, van: 20, tot: 21, tellen: 2, bpm: null });
ok('dezelfde pad opnieuw: overschrijven, niet verdubbelen', lib.samples('abc123').length === 1
  && lib.samples('abc123')[0].van === 20 && lib.samples('abc123')[0].bpm === null);
lib.bewaarSample('def456', { pad: 3, van: 1, tot: 2 });
ok('pad 3 van een ander nummer staat los', lib.samples('def456').length === 1 && lib.samples('abc123')[0].van === 20);
ok('vergeten', lib.verwijderSample('def456', 3) && lib.samples('def456').length === 0);
ok('vergeten wat er niet is: false', lib.verwijderSample('def456', 3) === false);

// ---- automatisch grid (stap C) ---------------------------------------------
// Een voorstel van de analyse mag nooit over een grid op slot, en niet over
// een met de hand bewerkt grid tenzij je er zelf om vraagt.

const auto = { stukken: [{ van: 0, bpm: 150, anker: 0.4, zekerheid: 0.8 }, { van: 60, bpm: 140, anker: 60.1, zekerheid: 0.3 }] };
for (const id of ['gLeeg', 'gOud', 'gSlot', 'gHand', 'gAuto']) lib.bewaarTrack(nummer(id, id));
lib.bewaarGrid('gOud', { bpm: 61.9, firstBeat: 2333.8 });
lib.bewaarGrid('gSlot', { stukken: [{ van: 0, bpm: 124, anker: 0.1 }], slot: true });
lib.bewaarGrid('gHand', { stukken: [{ van: 0, bpm: 128, anker: 0.2, zekerheid: 0.4 }], bron: 'hand' });
lib.bewaarGrid('gAuto', { ...auto, bron: 'auto' });
ok('normaliseerGrid bewaart bron auto/hand, niet onzin',
  normaliseerGrid({ bpm: 120, bron: 'auto' }).bron === 'auto' && normaliseerGrid({ bpm: 120, bron: 'x' }).bron === undefined);
const teDoen = lib.teAnalyseren();
ok(`bij het opstarten: leeg en oud, niet slot/hand/auto (${teDoen.filter((x) => x.startsWith('g')).join(',')})`,
  teDoen.includes('gLeeg') && teDoen.includes('gOud') && !teDoen.includes('gSlot') && !teDoen.includes('gHand') && !teDoen.includes('gAuto'));

const rOud = lib.bewaarAutoGrid('gOud', auto);
ok('oud grid (zonder bron, zonder slot) wordt vervangen', rOud.bewaard && rOud.grid.bron === 'auto' && rOud.grid.stukken.length === 2);
ok('met zekerheid per stuk, en niet op slot', rOud.grid.stukken[0].zekerheid === 0.8 && rOud.grid.stukken[1].zekerheid === 0.3 && !rOud.grid.slot);
ok('leeg krijgt het voorstel', lib.bewaarAutoGrid('gLeeg', auto).bewaard);

const slotVoor = JSON.stringify(lib.track('gSlot').grid);
const rSlot = lib.bewaarAutoGrid('gSlot', auto);
ok('SLOT wordt nooit overschreven', !rSlot.bewaard && /slot/.test(rSlot.reden) && JSON.stringify(lib.track('gSlot').grid) === slotVoor);
ok('ook niet met overHand', !lib.bewaarAutoGrid('gSlot', auto, { overHand: true }).bewaard);
ok('ook niet door de achtergrond', !lib.bewaarAutoGrid('gSlot', auto, { alleenOud: true }).bewaard);

ok('met de hand bewerkt: niet zonder overHand', !lib.bewaarAutoGrid('gHand', auto).bewaard && lib.track('gHand').grid.bron === 'hand');
ok('de achtergrond laat een auto-grid staan (intussen al een grid)', !lib.bewaarAutoGrid('gAuto', auto, { alleenOud: true }).bewaard);
ok('"opnieuw analyseren" (overHand) mag over hand', lib.bewaarAutoGrid('gHand', auto, { overHand: true }).bewaard
  && lib.track('gHand').grid.bron === 'auto');
const rForceer = lib.bewaarAutoGrid('gSlot', auto, { overHand: true, overSlot: true });
ok('alleen met overSlot (tweede klik) over een slot heen, en dan niet meer op slot', rForceer.bewaard && !rForceer.grid.slot);
ok('onbekend nummer: niet bewaard', !lib.bewaarAutoGrid('bestaatniet', auto).bewaard);
ok('na afloop hoeft niets meer', !lib.teAnalyseren().some((x) => x.startsWith('g')));

// ---- opruimen -------------------------------------------------------------

lib.verwijderTrack('abc123');
ok('track weg', lib.track('abc123') === null);
ok('zijn racks gaan mee', lib.racks('abc123').length === 0);
ok('zijn peaks ook', lib.peaks('abc123') === null);
ok('en zijn sampler-pads', lib.samples('abc123').length === 0);
ok('het andere nummer blijft staan', lib.track('def456') !== null && lib.racks('def456').length === 1);

lib.sluit();
rmSync(map, { recursive: true, force: true });

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
