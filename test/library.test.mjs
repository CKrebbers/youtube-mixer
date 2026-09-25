// De library: tracks, peaks en vooral de effect-racks per link.
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { Library, SCHEMA, normaliseerGrid, sorteertitel, SORTERING, MAX_HOTCUES } = await import('../server/library.js');
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
  // Niet op een vast getal: een ander spoor voegt ook een versie toe.
  ok(`v4 wordt de nieuwste (v${SCHEMA.length})`, l4.versie === SCHEMA.length);
  const m = l4.track('metgrid').grid;
  ok('bestaand grid wordt één stuk', m && m.stukken.length === 1 && m.stukken[0].bpm === 128.25
    && Math.abs(m.stukken[0].anker - 0.42) < 1e-9 && m.stukken[0].van === 0 && m.beatsPerBar === 3);
  ok('zonder grid blijft zonder grid', l4.track('zonder').grid === null);
  ok('zonder anker: anker 0, maat van 4', l4.track('geenanker').grid.stukken[0].anker === 0 && l4.track('geenanker').grid.beatsPerBar === 4);
  ok('na de migratie heeft een oud nummer een titelsleutel (sorteren op titel)',
    l4.db.prepare('SELECT titel_sleutel FROM tracks WHERE id = ?').get('geenanker').titel_sleutel === 'geen anker');
  ok('en een lege hotcue-tabel', l4.hotcues('metgrid').length === 0);
  l4.sluit();
  const l5 = new Library(pad4);
  ok('opnieuw openen migreert niet nog een keer', l5.versie === SCHEMA.length && l5.track('metgrid').grid.stukken.length === 1);
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

// ---- hotcues: horen bij het nummer, zoals de sampler-pads -------------------

ok('een nieuw nummer heeft geen hotcues', lib.hotcues('abc123').length === 0);
lib.bewaarHotcue('abc123', { nr: 1, tijd: 12.5 });
lib.bewaarHotcue('abc123', { nr: 3, tijd: 64.25 });
ok('hotcues bewaard, op volgorde van plek', JSON.stringify(lib.hotcues('abc123')) === JSON.stringify([{ nr: 1, tijd: 12.5 }, { nr: 3, tijd: 64.25 }]));
const hc = lib.bewaarHotcue('abc123', { nr: 1, tijd: 13 });
ok('dezelfde plek opnieuw: overschrijven, niet verdubbelen', hc.tijd === 13 && lib.hotcues('abc123').length === 2);
lib.bewaarHotcue('def456', { nr: 1, tijd: 2 });
ok('hotcue 1 van een ander nummer staat los', lib.hotcues('def456')[0].tijd === 2 && lib.hotcues('abc123')[0].tijd === 13);
ok('wissen', lib.verwijderHotcue('def456', 1) && lib.hotcues('def456').length === 0);
ok('wissen wat er niet is: false', lib.verwijderHotcue('def456', 1) === false);
ok('ruimte voor meer plekken dan het deck nu heeft', MAX_HOTCUES >= 4);
let hcFout = false;
try { lib.bewaarHotcue('bestaatniet', { nr: 1, tijd: 1 }); } catch { hcFout = true; }
ok('een hotcue bij een onbekend nummer kan niet (foreign key)', hcFout);

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
ok('en zijn hotcues', lib.hotcues('abc123').length === 0
  && lib.db.prepare('SELECT COUNT(*) AS n FROM hotcues WHERE track_id = ?').get('abc123').n === 0);
ok('het andere nummer blijft staan', lib.track('def456') !== null && lib.racks('def456').length === 1);

lib.sluit();

// ---- de lijst: meer dan 200, sorteren, pagina's ----------------------------
// Vroeger gaf tracks() stilletjes hooguit 200 nummers terug. Nu: alles, of een
// pagina; sorteren op titel, bpm, duur, toegevoegd en laatst gespeeld.
{
  const lg = new Library(join(map, 'groot.db'));
  const N = 450;
  const titels = ['Élan', 'alpha', 'Zulu', 'beta', 'Track 10', 'Track 2', 'track 1'];
  lg.db.exec('BEGIN');
  for (let i = 0; i < N; i++) {
    lg.bewaarTrack({ ...nummer(`n${i}`, i < titels.length ? titels[i] : `Nummer ${String(i).padStart(3, '0')}`), duur: 60 + ((i * 37) % 500) });
    // Een derde zonder grid, de rest een bpm; een kwart ooit geladen.
    if (i % 3) lg.bewaarGrid(`n${i}`, { bpm: 80 + (i % 90), firstBeat: 0 });
  }
  // Toegevoegd vastzetten (alles kwam in dezelfde paar ms binnen).
  lg.db.prepare('UPDATE tracks SET toegevoegd = 1000000 + CAST(substr(id, 2) AS INTEGER) * 1000').run();
  lg.db.exec('COMMIT');
  const geladen = [];
  for (let i = 0; i < N; i += 4) geladen.push(`n${i}`);
  let klok = 5e12;
  const echteNu = Date.now;
  Date.now = () => ++klok;             // elke laad een eigen, oplopend moment
  for (const id of geladen) lg.geladen(id);
  Date.now = echteNu;

  ok(`meer dan 200: alle ${N} komen terug (vroeger 200)`, lg.tracks().length === N && lg.aantalTracks() === N);

  const ids = (l) => l.map((t) => t.id);
  const alle = (sorteer, richting) => {
    const uit = [];
    for (let van = 0; van < N; van += 100) uit.push(...lg.tracks({ sorteer, richting, van, aantal: 100 }));
    return uit;
  };
  for (const s of Object.keys(SORTERING)) {
    for (const r of ['op', 'af']) {
      const p = ids(alle(s, r));
      ok(`${s} ${r}: pagina's achter elkaar = de hele lijst, elk nummer één keer`,
        p.length === N && new Set(p).size === N && JSON.stringify(p) === JSON.stringify(ids(lg.tracks({ sorteer: s, richting: r }))));
    }
    ok(`${s}: omgekeerd sorteren is de lijst achterstevoren, op wat geen waarde heeft na`, (() => {
      const op = ids(lg.tracks({ sorteer: s, richting: 'op' })), af = ids(lg.tracks({ sorteer: s, richting: 'af' }));
      const leeg = new Set(lg.tracks({ sorteer: s }).filter((t) => (s === 'bpm' ? t.grid_bpm : s === 'gespeeld' ? t.laatst_geladen : 1) == null).map((t) => t.id));
      const zonder = (l) => l.filter((id) => !leeg.has(id));
      const achteraan = (l) => leeg.size === 0 || l.slice(-leeg.size).every((id) => leeg.has(id));
      return JSON.stringify(zonder(op).reverse()) === JSON.stringify(zonder(af)) && achteraan(op) && achteraan(af);
    })());
  }

  const tOp = lg.tracks({ sorteer: 'titel', richting: 'op' });
  const sleutels = tOp.map((t) => sorteertitel(t.titel));
  ok('titel op: gesorteerd op de sleutel', sleutels.every((k, i) => i === 0 || sleutels[i - 1] <= k));
  ok('titel: hoofdletters tellen niet (alpha, beta vóór Élan en Zulu)', tOp.findIndex((t) => t.titel === 'alpha') < tOp.findIndex((t) => t.titel === 'beta'));
  ok('titel: een accent telt niet (Élan tussen de e en de f, niet na Zulu)',
    tOp.findIndex((t) => t.titel === 'Élan') < tOp.findIndex((t) => t.titel === 'Nummer 007')
    && tOp.findIndex((t) => t.titel === 'Élan') > tOp.findIndex((t) => t.titel === 'beta'));
  ok('titel: getallen op waarde (track 1, Track 2, Track 10)', (() => {
    const i1 = tOp.findIndex((t) => t.titel === 'track 1'), i2 = tOp.findIndex((t) => t.titel === 'Track 2'), i10 = tOp.findIndex((t) => t.titel === 'Track 10');
    return i1 < i2 && i2 < i10;
  })());
  ok('titelsleutel: "Élan" = "elan", 007 = 7', sorteertitel('Élan') === 'elan' && sorteertitel('a 007') === sorteertitel('a 7'));
  ok('standaardrichting per kolom: titel op, toegevoegd af',
    SORTERING.titel.eerst === 'op' && SORTERING.toegevoegd.eerst === 'af'
    && lg.tracks({ sorteer: 'toegevoegd', aantal: 1 })[0].id === `n${N - 1}`);

  const bOp = lg.tracks({ sorteer: 'bpm', richting: 'op' }), bAf = lg.tracks({ sorteer: 'bpm', richting: 'af' });
  const bpms = (l) => l.filter((t) => t.grid_bpm != null).map((t) => t.grid_bpm);
  ok('bpm op: oplopend, zonder grid achteraan', bpms(bOp).every((b, i, a) => i === 0 || a[i - 1] <= b) && bOp.at(-1).grid === null && bOp[0].grid !== null);
  ok('bpm af: aflopend, zonder grid OOK achteraan', bpms(bAf).every((b, i, a) => i === 0 || a[i - 1] >= b) && bAf.at(-1).grid === null && bAf[0].grid !== null);
  ok('bpm-sortering volgt wat de lijst toont (eerste stuk)', bOp[0].grid.stukken[0].bpm === bOp[0].grid_bpm);

  const dOp = lg.tracks({ sorteer: 'duur', richting: 'op' }).map((t) => t.duur);
  ok('duur op', dOp.every((d, i) => i === 0 || dOp[i - 1] <= d));

  const gAf = lg.tracks({ sorteer: 'gespeeld' });
  ok('laatst gespeeld (standaard af): de laatst geladen bovenaan', gAf[0].id === geladen.at(-1) && gAf[1].id === geladen.at(-2));
  ok('nooit geladen: achteraan', gAf.slice(geladen.length).every((t) => t.laatst_geladen === null)
    && gAf.slice(0, geladen.length).every((t) => t.laatst_geladen !== null));
  ok('laatst gespeeld op: de langst niet gespeelde eerst, nooit geladen nog steeds achteraan',
    lg.tracks({ sorteer: 'gespeeld', richting: 'op', aantal: 1 })[0].id === geladen[0]
    && lg.tracks({ sorteer: 'gespeeld', richting: 'op' }).at(-1).laatst_geladen === null);

  ok('zoeken + pagina + telling', lg.aantalTracks({ zoek: 'Nummer 1' }) === 100
    && lg.tracks({ zoek: 'Nummer 1', sorteer: 'titel', aantal: 50, van: 90 }).length === 10
    && lg.tracks({ zoek: 'Nummer 1', sorteer: 'titel', aantal: 50, van: 90 })[0].titel === 'Nummer 190');
  lg.bewaarTrack(nummer('pct', 'Gratis 100% vinyl'));
  lg.bewaarTrack(nummer('under', 'a_b'));
  ok('% en _ zoeken letterlijk (geen jokers)', lg.aantalTracks({ zoek: '100%' }) === 1 && lg.aantalTracks({ zoek: '%' }) === 1
    && lg.aantalTracks({ zoek: 'a_b' }) === 1 && lg.aantalTracks({ zoek: '_' }) === 1);
  ok('voorbij het einde: een lege pagina', lg.tracks({ sorteer: 'titel', van: 10000, aantal: 100 }).length === 0);
  ok('ook ver voorbij 2^31 (niet in 32 bits rondgerekend naar rij 0 of 1)',
    lg.tracks({ sorteer: 'titel', van: 2 ** 31, aantal: 5 }).length === 0 && lg.tracks({ sorteer: 'titel', van: 2 ** 32 + 1, aantal: 5 }).length === 0);
  let sortFout = false;
  try { lg.tracks({ sorteer: 'titel; DROP TABLE tracks' }); } catch { sortFout = true; }
  ok('onbekende sortering gooit (en komt niet in de SQL)', sortFout && lg.aantalTracks() === N + 2);
  const protoFouten = ['constructor', 'toString', '__proto__'].map((s) => {
    try { lg.tracks({ sorteer: s, aantal: 1 }); return 'geen fout'; } catch (e) { return e.message; }
  });
  ok(`een naam van Object (constructor, toString) is ook onbekend, geen SQL-fout (${protoFouten.join(' / ')})`,
    protoFouten.every((m) => /onbekende sortering/.test(m)));
  const r0 = lg.tracks({ sorteer: 'titel', aantal: 1 })[0];
  ok('een rij uit een pagina heeft alles om te laden (audio, peaks-veld, grid, racks)',
    'audio' in r0 && 'peaks' in r0 && 'grid' in r0 && r0.racks === 0 && !('titel_sleutel' in r0) && !('_rij' in r0));
  lg.bewaarTrack(nummer('n5', '0 eerst'));
  ok('opnieuw binnenhalen met een nieuwe titel: de sleutel gaat mee', lg.tracks({ sorteer: 'titel', aantal: 1 })[0].id === 'n5');
  lg.sluit();
}

rmSync(map, { recursive: true, force: true });

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
