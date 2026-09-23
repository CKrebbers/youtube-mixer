// De library: tracks, peaks en vooral de effect-racks per link.
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { Library } = await import('../server/library.js');

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
ok('grid bewaard', gr && Math.abs(gr.bpm - 124.5) < 1e-9 && Math.abs(gr.firstBeat - 0.37) < 1e-9);
ok('en komt mee in de lijst', lib.tracks({ zoek: 'Zelfde' })[0].grid.bpm === 124.5);
ok('het andere nummer heeft nog steeds geen grid', lib.track('def456').grid === null);

lib.bewaarTrack(nummer('abc123', 'Opnieuw binnengehaald'));
ok('opnieuw binnenhalen gooit het grid niet weg', lib.track('abc123').grid.bpm === 124.5);

lib.bewaarGrid('abc123', null);
ok('grid wissen kan', lib.track('abc123').grid === null);

// ---- peaks ----------------------------------------------------------------

lib.bewaarPeaks('abc123', { bestand: 'media/abc123/peaks.bin', buckets: 8192, perBucket: 256 });
ok('peaks onthouden', lib.peaks('abc123').buckets === 8192);
lib.bewaarPeaks('abc123', { bestand: 'media/abc123/peaks.bin', buckets: 4096, perBucket: 512 });
ok('peaks overschrijven in plaats van verdubbelen', lib.peaks('abc123').buckets === 4096);

// ---- instellingen ---------------------------------------------------------

lib.zet('laatste-deck', { A: 'abc123' });
ok('instelling bewaard', lib.haal('laatste-deck').A === 'abc123');
ok('onbekende instelling geeft de standaard', lib.haal('bestaat-niet', 'leeg') === 'leeg');

// ---- opruimen -------------------------------------------------------------

lib.verwijderTrack('abc123');
ok('track weg', lib.track('abc123') === null);
ok('zijn racks gaan mee', lib.racks('abc123').length === 0);
ok('zijn peaks ook', lib.peaks('abc123') === null);
ok('het andere nummer blijft staan', lib.track('def456') !== null && lib.racks('def456').length === 1);

lib.sluit();
rmSync(map, { recursive: true, force: true });

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
