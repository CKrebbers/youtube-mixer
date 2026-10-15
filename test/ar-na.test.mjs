// tools/proef/ar-na.mjs, het nameetscript van de proefavond van de architectuurronde
// (docs/verslagen/2026-10-15/ar-proef.md), op synthetisch materiaal waarvan het antwoord bekend is:
// een WAV met een gat, een handelingenlog met een gat, het echte log van de herstartlus uit de
// droogloop van 16 okt, een library.db en tellen.json met een grid dat er een bekend aantal ms naast
// ligt. En: droog leest en schrijft niets, --meet laat de bronnen staan en ruimt zijn kladmap op.
// Draai met: node test/ar-na.test.mjs
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as A from '../tools/proef/ar-na.mjs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const tmp = mkdtempSync(join(tmpdir(), 'varve-ar-na-test-'));

/** Een 16-bit stereo-WAV van `sec` s ruis op 48 kHz met nullen in `gaten` ([van, duur] in s); kop 44 of 80 (JUNK, zoals de opname). */
function maakWav(pad, sec, gaten, { junk = true } = {}) {
  const sr = 48000, n = Math.round(sec * sr);
  const data = Buffer.alloc(n * 4);
  let z = 12345;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const stil = gaten.some(([v, d]) => t >= v && t < v + d);
    for (let k = 0; k < 2; k++) {
      z = (z * 1103515245 + 12345) & 0x7fffffff;
      data.writeInt16LE(stil ? 0 : ((z % 2000) - 1000) | 1, i * 4 + k * 2);   // | 1: nooit precies 0
    }
  }
  const delen = [];
  if (junk) { const j = Buffer.alloc(8 + 28); j.write('JUNK', 0, 'latin1'); j.writeUInt32LE(28, 4); delen.push(j); }
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'latin1'); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(2, 10);
  fmt.writeUInt32LE(sr, 12); fmt.writeUInt32LE(sr * 4, 16); fmt.writeUInt16LE(4, 20); fmt.writeUInt16LE(16, 22);
  delen.push(fmt);
  const dk = Buffer.alloc(8); dk.write('data', 0, 'latin1'); dk.writeUInt32LE(data.length, 4); delen.push(dk);
  const kop = Buffer.concat(delen);
  const riff = Buffer.alloc(12); riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(4 + kop.length + data.length, 4); riff.write('WAVE', 8, 'latin1');
  writeFileSync(pad, Buffer.concat([riff, kop, data]));
  return 12 + kop.length;
}

// De [lus]-regels uit de droogloop (16 okt, tools/varve-app/server-lus.sh op Linux met de echte server: kill -9, een
// tweede server, SIGTERM, opnieuw, stop), met een startregel van VARVE.app en regels van de server ertussen zoals in
// ~/.varve-server.log.
const LUSLOG = `--- 15-10 11:12:22 gestart door VARVE.app
[lus] 15-10 11:12:23 server gestart (pid 550)
VARVE DJ  ·  http://localhost:8971
[lus] 15-10 11:12:24 de server viel om (exitcode 137): over 1 s opnieuw (1/5 in 60 s)
[lus] 15-10 11:12:25 server gestart (pid 634) — herstart 1
[server] poort 8971 is bezet: er draait al een server (of iets anders). Deze stopt.
[lus] 15-10 11:12:31 de server is gestopt (signaal 15): niet opnieuw gestart
[lus] 15-10 11:12:33 server gestart (pid 742)
[lus] 15-10 11:12:34 gestopt (server exitcode 143)
`;

try {
  console.log('de WAV');
  {
    const pad = join(tmp, 'a.wav');
    const data = maakWav(pad, 4, [[2.0, 0.5], [3.0, 0.005]]);
    const kop = A.leesWavKop(readFileSync(pad).subarray(0, 4096));
    ok('de kop met JUNK (80 bytes, zoals de opname): data, kanalen, sr, bits', kop?.data === data && data === 80 && kop.kanalen === 2 && kop.sr === 48000 && kop.bits === 16, JSON.stringify(kop));
    const pad44 = join(tmp, 'b.wav');
    maakWav(pad44, 0.1, [], { junk: false });
    ok('de gewone kop van 44 bytes', A.leesWavKop(readFileSync(pad44)).data === 44);
    ok('geen WAV: null', A.leesWavKop(Buffer.from('dit is geen wav, echt niet')) === null);
    const r = await A.nulReeksen(pad);
    ok('frames tellen', r.frames === 4 * 48000, `${r.frames}`);
    ok('één reeks nullen van ≥ 10 ms: op 2,0 s, 0,5 s lang (die van 5 ms telt niet)',
      r.reeksen.length === 1 && Math.abs(r.reeksen[0].van - 2) < 1e-6 && Math.abs(r.reeksen[0].duur - 0.5) < 1e-6, JSON.stringify(r.reeksen));
    const staart = join(tmp, 'c.wav');
    maakWav(staart, 1, [[0.7, 0.3]]);
    ok('nullen tot het einde tellen ook', (await A.nulReeksen(staart)).reeksen.length === 1);
    ok('het begin uit het id (lokale tijd)', A.beginVanId('20261016-201502')?.getHours() === 20 && A.beginVanId('20261016-201502').getSeconds() === 2 && A.beginVanId('x') === null);
  }

  console.log('\nhet log van de herstartlus');
  {
    const g = A.leesServerlog(LUSLOG, 2026);
    ok('de soorten op volgorde (de server-regel krijgt de tijd van de lus-regel ervoor)',
      g.map((x) => x.soort).join() === 'gestart,omgevallen,herstart,bezet,gestopt,gestart,gestopt', g.map((x) => x.soort).join());
    ok('de tijd is lokaal en het jaar komt van buiten', g[1].t.getFullYear() === 2026 && g[1].t.getMonth() === 9 && g[1].t.getDate() === 15 && g[1].t.getSeconds() === 24);
    const v = A.storingen(g);
    ok('twee storingen: omvallen 1 s (de lus startte hem), gestopt 2 s; de laatste stop is het einde',
      v.length === 2 && v[0].duur === 1 && /omgevallen/.test(v[0].hoe) && v[1].duur === 2 && v[1].hoe === 'gestopt', JSON.stringify(v.map((x) => [x.duur, x.hoe])));
    const nooit = A.storingen(A.leesServerlog('[lus] 15-10 22:00:00 server gestart (pid 1)\n[lus] 15-10 22:10:00 de server viel om (exitcode 1) en is al 5 keer herstart in 60 s: de lus stopt. Kijk hierboven waarom.\n', 2026));
    ok('een crash-lus zonder start erna: niet teruggekomen', nooit.length === 1 && nooit[0].tot === null && nooit[0].hoe === 'niet teruggekomen');
    // AR18: een hang die de wachter van de lus neerzette (de regels zoals de lus ze echt schreef, 15 okt).
    const HANGLOG = `[lus] 15-10 12:27:06 server gestart (pid 13074)
[lus] 15-10 12:28:18 de server antwoordt niet (laatste antwoord 12:27:58, 3 keer niets op /api/leeft binnen 2 s, pid 13074): kill -9, de lus start hem opnieuw
[lus] 15-10 12:28:18 de server viel om (exitcode 137): over 1 s opnieuw (1/5 in 60 s)
[lus] 15-10 12:28:19 server gestart (pid 13425) — herstart 1
[lus] 15-10 12:28:35 gestopt (server exitcode 143)
`;
    const hg = A.leesServerlog(HANGLOG, 2026);
    ok('een hang: soort hang, op het moment van het laatste antwoord (niet van de kill)',
      hg.map((x) => x.soort).join() === 'gestart,hang,omgevallen,herstart,gestopt' && hg[1].t.getMinutes() === 27 && hg[1].t.getSeconds() === 58, hg.map((x) => x.soort).join());
    const hv = A.storingen(hg);
    ok('één storing van het laatste antwoord tot de herstart (21 s): de kill -9 erna hoort erbij',
      hv.length === 1 && hv[0].duur === 21 && /hing/.test(hv[0].hoe), JSON.stringify(hv.map((x) => [x.duur, x.hoe])));
    const nacht = A.leesServerlog('[lus] 16-10 00:00:10 de server antwoordt niet (laatste antwoord 23:59:55, 3 keer niets op /api/leeft binnen 2 s, pid 9): kill -9, de lus start hem opnieuw\n', 2026);
    ok('een hang over middernacht: het laatste antwoord was de dag ervoor', nacht[0].t.getDate() === 15 && nacht[0].t.getHours() === 23);
    const h = A.leesVenster('22:10:00-22:10:30', new Date(2026, 9, 16));
    ok('een venster met de hand (een hang korter dan de wachter, of zonder de lus)', h?.duur === 30 && h.van.getHours() === 22);
    ok('een verkeerd venster: null', A.leesVenster('22:10:30-22:10:00', new Date()) === null && A.leesVenster('22:10', new Date()) === null);
  }

  console.log('\nin een storing?');
  {
    const begin = new Date(2026, 9, 16, 22, 0, 0);
    const venster = [{ van: new Date(2026, 9, 16, 22, 5, 0), tot: new Date(2026, 9, 16, 22, 5, 30) }];
    ok('een reeks midden in de storing', A.inStoring({ van: 310, duur: 0.5 }, begin, venster));
    ok('binnen de marge van 5 s', A.inStoring({ van: 296, duur: 0.1 }, begin, venster));
    ok('ver ervoor: niet', !A.inStoring({ van: 60, duur: 1 }, begin, venster));
    ok('zonder begin van de opname: niet', !A.inStoring({ van: 310, duur: 1 }, null, venster));
  }

  console.log('\nhet handelingenlog');
  {
    const goed = '{"t":0,"e":"kop","versie":1,"begon":"2026-10-16T20:00:00.000Z","klok":12.5}\n[1.5,"track.1.fader",0.8]\n[2.25,"track.1.play",true]\n{"t":3,"e":"eind","regels":4}\n';
    const l = A.leesLog(goed);
    ok('regels, eind, begon, de tijden', l.regels === 4 && l.eind && l.gaten.length === 0 && l.onleesbaar === 0 && l.begon.toISOString() === '2026-10-16T20:00:00.000Z' && l.t.join() === '0,1.5,2.25,3');
    const gat = goed.replace('[2.25,"track.1.play",true]\n', '\0'.repeat(27));
    const g = A.leesLog(gat);
    ok('een gat van NUL-bytes: gevonden, met zijn plek en grootte; de rest blijft leesbaar', g.gaten.length === 1 && g.gaten[0].bytes === 27 && g.regels === 3 && g.onleesbaar === 0);
    ok('zonder eind-regel en met een kapotte regel', (() => { const x = A.leesLog('[1,"a",1]\n{kapot\n'); return !x.eind && x.onleesbaar === 1; })());
  }

  console.log('\nhet grid tegen de tellen');
  {
    // 120 bpm vanaf 0,5 s, 4 tellen per maat; de tellen van "Beat This!" liggen er `ms` naast.
    const grid = { stukken: [{ van: 0, bpm: 120, anker: 0.5 }], beatsPerBar: 4, bron: 'hand', slot: true };
    const tellen = (ms, maatNaast = 0) => {
      const beats = [], downbeats = [];
      for (let k = 0; k < 200; k++) { const t = 0.5 + k * 0.5 + ms / 1000; beats.push(t); if ((k + maatNaast) % 4 === 0) downbeats.push(t); }
      return { beats, downbeats };
    };
    const op = A.gridTegenTellen(grid, tellen(3));
    ok('3 ms naast: op de tel, mediaan 3 ms, de "1" klopt, raak 100%', op.opTel && Math.abs(op.mediaanMs - 3) < 0.11 && op.eenGoed === true && op.raak === 1 && op.slot, JSON.stringify({ m: op.mediaanMs, een: op.een }));
    const naast = A.gridTegenTellen(grid, tellen(12));
    ok('12 ms naast: NAAST de tel (de snap mikt op ≤ 5 ms)', !naast.opTel && Math.abs(naast.mediaanMs - 12) < 0.11);
    const een = A.gridTegenTellen(grid, tellen(1, 1));
    ok('de "1" een tel naast de downbeats: eenGoed false (de tel klopt wel)', een.opTel && een.eenGoed === false && een.een === 0);
    ok('zonder downbeats: de "1" is niet te zeggen', A.gridTegenTellen(grid, { beats: tellen(1).beats }).eenGoed === null);
    ok('geen grid of geen tellen: een reden', !!A.gridTegenTellen(null, tellen(1)).fout && !!A.gridTegenTellen(grid, null).fout);
  }

  console.log('\nde opdrachtregel');
  {
    let fout = false;
    try { A.leesArgs(['--set', '../etc']); } catch { fout = true; }
    ok('--set weigert een pad', fout);
    fout = false; try { A.leesArgs(['--venster', '22:10']); } catch { fout = true; }
    ok('--venster weigert iets anders dan UU:MM:SS-UU:MM:SS', fout);
    fout = false; try { A.leesArgs(['--onzin']); } catch { fout = true; }
    ok('een onbekende vlag', fout);

    // Een avond in een kladmap: opnames/, media/ met library.db en tellen.json, een serverlog.
    const avond = join(tmp, 'avond');
    const opn = join(avond, 'opnames'), media = join(avond, 'media');
    mkdirSync(opn, { recursive: true }); mkdirSync(join(media, 'nr1'), { recursive: true });
    // De opname begon om 11:12:20; de server was weg van 11:12:24 tot 11:12:25 (het lus-log). Een gat op 4,0 s = 11:12:24.
    maakWav(join(opn, 'set-20261015-111220.wav'), 8, [[4.0, 0.3]]);
    writeFileSync(join(opn, 'set-20261015-111220.acties.jsonl'), `{"t":0,"e":"kop","versie":1,"begon":"${new Date(2026, 9, 15, 11, 12, 20).toISOString()}"}\n` + '[4.2,"track.1.fader",0.5]\n{"t":7,"e":"eind","regels":3}\n');
    writeFileSync(join(avond, 'server.log'), LUSLOG);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(media, 'library.db'));
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, titel TEXT, grid_json TEXT)');
    db.prepare('INSERT INTO tracks VALUES (?, ?, ?)').run('nr1', 'Proefnummer', JSON.stringify({ stukken: [{ van: 0, bpm: 120, anker: 0.5 }], beatsPerBar: 4, bron: 'hand' }));
    db.close();
    const beats = Array.from({ length: 100 }, (_, k) => 0.5 + k * 0.5 + 0.002);
    writeFileSync(join(media, 'nr1', 'tellen.json'), JSON.stringify({ versie: 1, beats, downbeats: beats.filter((_, k) => k % 4 === 0) }));
    const vingerafdruk = () => readdirSync(avond, { recursive: true }).sort().map((n) => {
      const p = join(avond, n); const s = statSync(p);
      return s.isFile() ? `${n}:${s.size}:${s.mtimeMs}:${createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12)}` : n;
    }).join('|');
    const voor = vingerafdruk();
    const klad = () => readdirSync(tmpdir()).filter((n) => n.startsWith('varve-ar-na-') && !n.startsWith('varve-ar-na-test-')).length;
    const kladVoor = klad();
    const argv = ['--opnames', opn, '--serverlog', join(avond, 'server.log'), '--media', media, '--nummer', 'nr1'];
    let uit = '', fouttekst = '';
    const schrijf = (s) => { uit += s; }, fout2 = (s) => { fouttekst += s; };

    let code = await A.main(argv, { schrijf, fout: fout2 });
    ok('droog (standaard): exit 0, noemt de bestanden en zegt dat er niets gelezen is', code === 0 && /droog/.test(uit) && /set-20261015-111220\.wav/.test(uit) && /library\.db/.test(uit) && /niets gelezen of geschreven/.test(uit));
    ok('droog: geen kladmap gemaakt', klad() === kladVoor);

    uit = '';
    code = await A.main(['--meet', ...argv], { schrijf, fout: fout2 });
    ok('--meet: exit 2 (het gat valt in de storing van 11:12:24)', code === 2, `exit ${code}: ${fouttekst}`);
    ok('… het rapport noemt de reeks IN DE STORING en de storing zelf', /IN DE STORING/.test(uit) && /11:12:24–11:12:25/.test(uit), uit.split('\n').filter((r) => /STORING|storingen/.test(r)).join(' / '));
    ok('… het log: 3 regels, eind-regel ja, 1 regel tijdens de storing', /3 regels · eind-regel: ja · gaten \(NUL\): 0/.test(uit) && /regels tijdens de storing\(en\): 1/.test(uit));
    ok('… het grid: op de tel (2 ms) en de "1" klopt', /oordeel: op de tel/.test(uit) && /"1" klopt/.test(uit) && /mediaan 2 ms/.test(uit), uit.split('\n').filter((r) => /GRID|oordeel|mediaan/.test(r)).join(' / '));
    ok('--meet: de bronnen zijn precies gebleven (grootte, tijd, inhoud)', vingerafdruk() === voor);
    ok('--meet: de kladmap is opgeruimd', klad() === kladVoor);

    uit = '';
    code = await A.main(['--meet', '--json', ...argv], { schrijf, fout: fout2 });
    const j = JSON.parse(uit);
    ok('--json: dezelfde uitkomst als data', code === 2 && j.opname.inStoring.length === 1 && j.nummers[0].opTel === true && j.gevonden.length === 1, JSON.stringify(j.gevonden));

    // Op de titel (hoofdletters tellen niet), en wat er gebeurt bij geen of meer dan één nummer.
    const zonderNummer = argv.filter((x, i) => x !== '--nummer' && argv[i - 1] !== '--nummer');
    uit = '';
    code = await A.main(['--meet', ...zonderNummer, '--titel', 'PROEF'], { schrijf, fout: fout2 });
    ok('--titel: het nummer gevonden in de kopie, en zijn tellen erbij gemeten', /GRID · nr1 · Proefnummer/.test(uit) && /oordeel: op de tel/.test(uit), uit.split('\n').filter((r) => /GRID|oordeel|titel/.test(r)).join(' / '));
    uit = '';
    await A.main(['--meet', ...zonderNummer, '--titel', 'bestaat niet'], { schrijf, fout: fout2 });
    ok('--titel zonder treffer: dat staat erbij', /geen nummer met die titel/.test(uit));
    const db2 = new DatabaseSync(join(media, 'library.db'));
    db2.prepare('INSERT INTO tracks VALUES (?, ?, ?)').run('nr2', 'Proefnummer twee', null);
    db2.close();
    uit = '';
    await A.main(['--meet', ...zonderNummer, '--titel', 'proef'], { schrijf, fout: fout2 });
    ok('--titel met twee treffers: allebei genoemd, kies met --nummer', /meer dan één nummer: nr1 \(Proefnummer\), nr2 \(Proefnummer twee\)/.test(uit));
    let leegFout = false; try { A.leesArgs(['--titel', ' ']); } catch { leegFout = true; }
    ok('--titel leeg: geweigerd', leegFout);

    // Zonder gat in de storing: niets mis.
    // Een opname van een minuut eerder (11:11:00), met een gat op 2 s: ver van de storing (11:12:24).
    maakWav(join(opn, 'set-20261015-111100.wav'), 8, [[2.0, 0.3]]);
    uit = '';
    code = await A.main(['--meet', '--set', '20261015-111100', ...argv], { schrijf, fout: fout2 });
    ok('nullen buiten de storing: exit 0, NIETS MIS GEVONDEN (maar de reeks staat er wel)', code === 0 && /NIETS MIS GEVONDEN/.test(uit) && /reeksen nullen ≥ 10 ms: 1, waarvan in een storing: 0/.test(uit), `exit ${code}: ${uit.split('\n').filter((r) => /GEVONDEN|reeksen/.test(r)).join(' / ')}`);

    uit = ''; fouttekst = '';
    code = await A.main(['--meet', '--opnames', join(avond, 'leeg'), '--serverlog', join(avond, 'bestaat-niet.log')], { schrijf, fout: fout2 });
    ok('niets te lezen: exit 1 met een reden', code === 1 && /niets te lezen/.test(fouttekst));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
