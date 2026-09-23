// De library: tracks, peaks en vooral de effect-racks per link.
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { Library, SCHEMA, normaliseerGrid } = await import('../server/library.js');
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
  ok('v4 wordt v5', l4.versie === 5);
  const m = l4.track('metgrid').grid;
  ok('bestaand grid wordt één stuk', m && m.stukken.length === 1 && m.stukken[0].bpm === 128.25
    && Math.abs(m.stukken[0].anker - 0.42) < 1e-9 && m.stukken[0].van === 0 && m.beatsPerBar === 3);
  ok('zonder grid blijft zonder grid', l4.track('zonder').grid === null);
  ok('zonder anker: anker 0, maat van 4', l4.track('geenanker').grid.stukken[0].anker === 0 && l4.track('geenanker').grid.beatsPerBar === 4);
  l4.sluit();
  const l5 = new Library(pad4);
  ok('opnieuw openen migreert niet nog een keer', l5.versie === 5 && l5.track('metgrid').grid.stukken.length === 1);
  l5.sluit();
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
