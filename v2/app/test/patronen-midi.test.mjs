// Patronen als MIDI-bestand voor Logic (src/kern/patronen-smf.js; v1 src/export/patronen-smf.js,
// docs/PATRONEN.md §8): de regels S1–S13 en L1–L2 elk met een check, de kick
// bytegewijs tegen een met de hand uitgeschreven hex-reeks en tegen de gouden
// bestanden in test/fixtures/midi/, 500 willekeurige patronen tegen de speler
// (zijn vensters) en terug met de meta (rondreis).
// Puur: geen server, geen mido, geen Python.
// Overgenomen uit v1 test/patronen-midi.test.mjs (zonder deel 6, de CLI: niet overgenomen); de sets zijn
// in de v1-vorm geschreven en lezen via de migratie. De v2-uitbreidingen staan onderaan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const ok = (name, cond, extra = '') => assert.ok(cond, name + (extra && !cond ? ` — ${extra}` : ''));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const gelijk = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const gooit = (f, soort = Error) => { try { f(); return false; } catch (e) { return e instanceof soort; } };
const fixture = (naam) => new Uint8Array(readFileSync(new URL(`./fixtures/midi/${naam}`, import.meta.url)));

const M = await import('../src/kern/patronen/model.js');
const V = await import('../src/kern/patronen/venster.js');
const L = await import('../src/kern/smf.js');
const E = await import('../src/kern/patronen-smf.js');
const { setNaarSmf, smfNaarPatronen, klinkendeNoten, META, CONTEXT, MAX_CONTEXT, DRUM_KANAAL, SAMPLE_PADS } = E;

/** Een set met één patroon op `track`/plek 1. */
const setMet = (p, { soort = 'drums', track = 1, tempo = 120, naam = 'set' } = {}) =>
  ({ naam, tempo, tracks: { [track]: [p] }, instrumenten: soort ? { [track]: { soort } } : {} });
const patroon = (noten, extra = {}) => ({ id: 'p-t', naam: '', lengte: 16, deling: 4, swing: 50, noten, ...extra });
/** De events van spoor `i`. */
const spoor = (bytes, i = 1) => L.leesSmf(bytes).sporen[i];
const aanTicks = (bytes, i = 1) => spoor(bytes, i).filter((e) => e.st === 0x90).map((e) => e.t);
const eindTick = (bytes, i = 1) => spoor(bytes, i).find((e) => e.meta === 0x2f).t;
const tekst = (e) => String.fromCharCode(...e.data);

// De kick uit het ontwerp: vier op de vloer, 120 bpm, track 1 drums.
const KICK = { id: 'p-kick', naam: 'kick', lengte: 16, deling: 4, swing: 50, noten: [0, 4, 8, 12].map((s) => ({ stap: s, noot: 36, snelheid: 0.8, duur: 1, micro: 0 })) };
const KICK_SET = setMet(KICK);

// ---- 1. bytegewijs ---------------------------------------------------------------
test('de kick, bytegewijs', async () => {
  // Met de hand uitgeschreven (5-ontwerp-definitief.md §4.3), niet met de exporter gemaakt.
  const HAND = [
    '4d 54 68 64 00 00 00 06 00 01 00 02 01 80',            // MThd, type 1, 2 sporen, 384 PPQN
    '4d 54 72 6b 00 00 00 1a',                               // MTrk 0 (26 bytes)
    '00 ff 03 03 73 65 74',                                  //   naam "set"
    '00 ff 51 03 07 a1 20',                                  //   500 000 µs = 120 bpm
    '00 ff 58 04 04 02 18 08',                               //   4/4
    '00 ff 2f 00',
    '4d 54 72 6b 00 00 00 3e',                               // MTrk 1 (62 bytes)
    '00 ff 03 12 54 31 20 50 31 20 6b 69 63 6b 20 28 64 72 75 6d 73 29',   // "T1 P1 kick (drums)"
    '00 99 24 66 60 89 24 00',                               //   stap 0: aan (kanaal 10, v 102), 96 later uit
    '82 20 99 24 66 60 89 24 00',                            //   stap 4 (288 ticks later)
    '82 20 99 24 66 60 89 24 00',                            //   stap 8
    '82 20 99 24 66 60 89 24 00',                            //   stap 12
    '82 20 ff 2f 00',                                        //   einde op tick 1536
  ].join(' ');
  const zonder = setNaarSmf(KICK_SET, { track: 1, plek: 1, meta: false });
  ok('kick zonder meta = de 118 bytes met de hand', zonder.length === 118 && hex(zonder) === HAND, hex(zonder));
  ok('kick zonder meta = test/fixtures/midi/kick-goud-zonder-meta.mid', gelijk(zonder, fixture('kick-goud-zonder-meta.mid')));
  const met = setNaarSmf(KICK_SET, { track: 1, plek: 1 });
  ok('kick met meta = 431 bytes = test/fixtures/midi/kick-goud.mid', met.length === 431 && gelijk(met, fixture('kick-goud.mid')));
  ok('met meta: MTrk 1 is 00 00 01 77 lang, de meta begint met 00 ff 01 82 34 (308 bytes)',
    hex(met.slice(48, 56)) === '4d 54 72 6b 00 00 01 77' && hex(met.slice(78, 83)) === '00 ff 01 82 34', hex(met.slice(48, 83)));
  ok('dezelfde invoer, dezelfde bytes; de set wordt niet veranderd', (() => {
    const voor = JSON.stringify(KICK_SET);
    const a = setNaarSmf(KICK_SET), b = setNaarSmf(KICK_SET);
    return gelijk(a, b) && JSON.stringify(KICK_SET) === voor;
  })());
  ok('hele set zonder track/plek = dezelfde bytes (er is maar één patroon)', gelijk(setNaarSmf(KICK_SET), met));
});

// ---- 2. het raster ---------------------------------------------------------------
test('ticks, swing en micro (S1, S2)', async () => {
  ok('384 is deelbaar door elke deling (1, 2, 3, 4, 6, 8)', M.DELINGEN.every((d) => 384 % d === 0) && V.PPQN === 384);
  const een = (n, extra) => aanTicks(setNaarSmf(setMet(patroon([n], extra)), { meta: false }));
  ok('swing 66,7: stap 1 op tick 128', een({ stap: 1, noot: 36 }, { swing: 66.7 })[0] === 128, String(een({ stap: 1, noot: 36 }, { swing: 66.7 })));
  ok('swing 75: stap 1 op tick 144', een({ stap: 1, noot: 36 }, { swing: 75 })[0] === 144);
  ok('micro +0,1 op stap 6: tick 586 (585,6 afgerond)', een({ stap: 6, noot: 36, micro: 0.1 })[0] === 586);
  ok('micro −0,3 op stap 0: tick 0 (niet vóór de start, zoals de speler)', een({ stap: 0, noot: 36, micro: -0.3 })[0] === 0);
  const twee = aanTicks(setNaarSmf(setMet(patroon([{ stap: 0, noot: 36, micro: -0.3 }])), { meta: false, omlopen: 2 }));
  ok('2 omlopen: de tweede keer op 1507 (1536 − 28,8), vóór de omloopgrens', gelijk(twee, [0, 1507]), String(twee));
  const rand = setNaarSmf(setMet(patroon([{ stap: 15, noot: 36, micro: 0.5 }], { swing: 75 })), { meta: false });
  ok('stap 15, swing 75, micro +0,5 = tick 1536: staat erin, spoor eindigt op 1632', gelijk(aanTicks(rand), [1536]) && eindTick(rand) === 1632, `${aanTicks(rand)} / ${eindTick(rand)}`);
  ok('deling 3 (triolen): stap 1 op tick 128', aanTicks(setNaarSmf(setMet(patroon([{ stap: 1, noot: 36 }], { deling: 3 })), { meta: false }))[0] === 128);
  ok('omlopen 0 of 1,5 gooit RangeError', gooit(() => setNaarSmf(KICK_SET, { omlopen: 0 }), RangeError) && gooit(() => setNaarSmf(KICK_SET, { omlopen: 1.5 }), RangeError));
});

test('noten (S3–S5, S7, S8, S11)', async () => {
  const b = setNaarSmf(setMet(patroon([{ stap: 3, noot: 40, micro: 0.5 }, { stap: 4, noot: 40, micro: -0.5, snelheid: 1 }])), { meta: false });
  const aan = spoor(b).filter((e) => e.st === 0x90);
  ok('S3: twee noten op dezelfde (noot, tick): één, de laatste (stap 4, v 127)', aan.length === 1 && aan[0].t === 336 && aan[0].v === 127, JSON.stringify(aan));
  const o = setNaarSmf(setMet(patroon([{ stap: 0, noot: 36, duur: 6 }, { stap: 2, noot: 36, duur: 1 }])), { meta: false });
  const ev = spoor(o).filter((e) => e.st);
  ok('S4: zelfoverlap: de eerste 36 gaat uit op 192, waar de tweede begint',
    ev.map((e) => `${e.st === 0x90 ? 'aan' : 'uit'}@${e.t}`).join() === 'aan@0,uit@192,aan@192,uit@288', ev.map((e) => `${e.st}@${e.t}`).join());
  ok('S7: op dezelfde tick eerst noot-uit, dan noot-aan', ev[1].st === 0x80 && ev[2].st === 0x90 && ev[1].t === ev[2].t);
  const v = (s) => spoor(setNaarSmf(setMet(patroon([{ stap: 0, noot: 36, snelheid: s }])), { meta: false })).find((e) => e.st === 0x90).v;
  ok('S5: velocity 0,01 → 1, 1 → 127, 0,8 → 102', v(0.01) === 1 && v(1) === 127 && v(0.8) === 102, `${v(0.01)} ${v(1)} ${v(0.8)}`);
  ok('S5: noot-uit met velocity 0', ev.filter((e) => e.st === 0x80).every((e) => e.v === 0));
  const lang = setNaarSmf(setMet(patroon([{ stap: 14, noot: 48, duur: 6 }])), { meta: false });
  ok('S8: een noot die over het einde klinkt verlengt het spoor (14 + 6 stappen = 1920)', eindTick(lang) === 1920);
  ok('S8: de tempotrack eindigt op 0', eindTick(lang, 0) === 0);
  const twee = setNaarSmf(KICK_SET, { omlopen: 2, meta: false });
  ok('omlopen 2: acht kicks, het spoor eindigt op 3072', aanTicks(twee).length === 8 && eindTick(twee) === 3072);
  const voorbij = setNaarSmf(setMet(patroon([{ stap: 0, noot: 36 }, { stap: 12, noot: 38 }], { lengte: 8 })));
  const metaTekst = spoor(voorbij).find((e) => e.meta === 1);
  ok('S11: een noot voorbij de lengte klinkt niet, maar staat wel in de meta',
    gelijk(aanTicks(voorbij), [0]) && JSON.parse(tekst(metaTekst).slice(META.length)).noten.some((n) => n.stap === 12 && n.noot === 38));
  ok('meta: false = geen FF 01 in het bestand', !spoor(setNaarSmf(KICK_SET, { meta: false })).some((e) => e.meta === 1));
});

test('kanalen en namen (S6, S9, S10, S12)', async () => {
  const st = (soort) => spoor(setNaarSmf(setMet(patroon([{ stap: 0, noot: 36 }]), { soort }), { meta: false })).find((e) => e.st === 0x90).kanaal;
  ok(`S6: drums op kanaal ${DRUM_KANAAL} (0x99), poly en zonder instrument op kanaal 1 (0x90)`, st('drums') === 10 && st('poly') === 1 && st(null) === 1);
  const pads = setNaarSmf(setMet(patroon(Array.from({ length: 8 }, (_, i) => ({ stap: i, noot: 44 + i })))), { meta: false });
  const padNoten = spoor(pads).filter((e) => e.st === 0x90);
  ok(`S6: noot ${SAMPLE_PADS[0]}–${SAMPLE_PADS[1]} (sample-pads) op drums: 0x99 en de noot ongewijzigd`,
    padNoten.length === 8 && padNoten.every((e, i) => e.kanaal === 10 && e.noot === 44 + i) && hex(pads).includes('99 2c') && hex(pads).includes('99 33'));
  const naam = (p, soort) => tekst(spoor(setNaarSmf(setMet(p, { soort }))).find((e) => e.meta === 3));
  ok("S10: spoornaam 'T1 P1 een (drums)' voor een patroon dat 'één' heet", naam(patroon([{ stap: 0, noot: 36 }], { naam: 'één' }), 'drums') === 'T1 P1 een (drums)');
  ok("S10: zonder naam en instrument: 'T1 P1'", naam(patroon([{ stap: 0, noot: 36 }]), null) === 'T1 P1');
  const ruim = { naam: 'Köln → nacht', tempo: 120, instrumenten: { 1: { soort: 'drums' }, 3: { soort: 'poly' } },
    tracks: { 3: [null, patroon([{ stap: 0, noot: 60 }], { id: 'p-c', naam: 'c' })], 1: [patroon([{ stap: 0, noot: 36 }], { id: 'p-a', naam: 'a' }), null, null, null, patroon([{ stap: 1, noot: 38 }], { id: 'p-b', naam: 'b' })], 5: [patroon([], { id: 'p-leeg' })] } };
  const r = L.leesSmf(setNaarSmf(ruim));
  ok('S12: hele set = tempotrack + drie gevulde patronen, op volgorde track dan plek, het lege overgeslagen',
    r.sporen.length === 4 && r.sporen.slice(1).map((s) => tekst(s.find((e) => e.meta === 3))).join('|') === 'T1 P1 a (drums)|T1 P5 b (drums)|T3 P2 c (poly)');
  ok('S9: de tempotrack heet naar de set (ASCII: "Koln -> nacht")', tekst(r.sporen[0].find((e) => e.meta === 3)) === 'Koln -> nacht');
  ok('S12: track 1 plek 5 alleen = één patroon', L.leesSmf(setNaarSmf(ruim, { track: 1, plek: 5 })).sporen.length === 2);
  ok('S12: lege set = null; een lege plek kiezen = null', setNaarSmf({}) === null && setNaarSmf(ruim, { track: 1, plek: 2 }) === null && setNaarSmf(ruim, { track: 5, plek: 1 }) === null);
  ok('S12: alleen track 1 = zijn twee patronen', L.leesSmf(setNaarSmf(ruim, { track: 1 })).sporen.length === 3);
});

test('de tempotrack (S9) en de context', async () => {
  const t = (b) => hex(L.leesSmf(b).sporen[0].find((e) => e.meta === 0x51).data);
  ok('bpm 124 vervangt set.tempo 120: 07 62 1f', t(setNaarSmf(KICK_SET, { bpm: 124 })) === '07 62 1f');
  ok('bpm buiten 40..240 gooit RangeError', gooit(() => setNaarSmf(KICK_SET, { bpm: 39 }), RangeError) && gooit(() => setNaarSmf(KICK_SET, { bpm: 241 }), RangeError) && gooit(() => setNaarSmf(KICK_SET, { bpm: NaN }), RangeError));
  ok('set.tempo 300 wordt 240 (normaliseerSet, zoals de speler)', t(setNaarSmf({ ...KICK_SET, tempo: 300 })) === '03 d0 90');
  const ctx = { maatgever: { titel: 'Köln', bpm: 124 } };
  const b = setNaarSmf(KICK_SET, { context: ctx });
  const c = L.leesSmf(b).sporen[0].find((e) => e.meta === 1);
  ok('context: FF 01 op de tempotrack, alleen ASCII (\\u00f6), terug te lezen als hetzelfde object',
    !!c && tekst(c) === `${CONTEXT}{"maatgever":{"titel":"K\\u00f6ln","bpm":124}}` && isDeepStrictEqual(JSON.parse(tekst(c).slice(CONTEXT.length)), ctx), c && tekst(c));
  const zonderCtx = L.leesSmf(setNaarSmf(KICK_SET)), metCtx = L.leesSmf(b);
  ok('context verandert de patroonsporen niet', isDeepStrictEqual(zonderCtx.sporen[1], metCtx.sporen[1]));
  ok('zonder context is de tempotrack die van het gouden bestand (bytes 14..47)', gelijk(setNaarSmf(KICK_SET).slice(14, 48), fixture('kick-goud.mid').slice(14, 48)));
  ok(`context van precies ${MAX_CONTEXT} bytes mag, een byte meer gooit RangeError`,
    !!setNaarSmf(KICK_SET, { context: { a: 'x'.repeat(MAX_CONTEXT - 22) } }) && gooit(() => setNaarSmf(KICK_SET, { context: { a: 'x'.repeat(MAX_CONTEXT - 21) } }), RangeError));
});

test('S13: geen running status, en het bestand leest terug tot dezelfde bytes', async () => {
  const proef = fixture('proef-set.mid');
  const r = L.leesSmf(proef);
  const opnieuw = L.smf(r.sporen.map((ev) => {
    const eind = ev.find((e) => e.meta === 0x2f).t;
    const b = ev.filter((e) => e.meta !== 0x2f).map((e, i) => ({
      t: e.t, orde: i,
      b: e.meta !== undefined ? L.meta(e.meta, [...e.data]) : e.st ? [e.st | (e.kanaal - 1), e.noot, e.v] : e.overig,
    }));
    return L.mtrk(b, eind);
  }), { type: r.type, ppqn: r.ppqn });
  ok('proef-set.mid: lezen en opnieuw schrijven met elk statusbyte = bytegewijs hetzelfde (dus geen running status)', gelijk(opnieuw, proef));
});

// ---- 3. de fixtures --------------------------------------------------------------
// Dezelfde set als waarmee test/fixtures/midi/proef-set.mid gemaakt is (stap 0: in Logic slepen).
const PROEF_SET = {
  naam: 'proef', tempo: 124, instrumenten: { 1: { soort: 'drums' }, 3: { soort: 'poly' } },
  tracks: {
    1: [KICK, { id: 'p-hats', naam: 'hats', lengte: 16, deling: 4, swing: 66.7, noten: Array.from({ length: 16 }, (_, s) => ({ stap: s, noot: 39, snelheid: s % 2 ? 0.5 : 0.9, duur: 0.5, micro: s === 6 ? 0.1 : 0 })) }],
    3: [{ id: 'p-bas', naam: 'bas', lengte: 16, deling: 4, swing: 50, noten: [{ stap: 0, noot: 36, duur: 3 }, { stap: 6, noot: 43, duur: 1.5, micro: -0.2 }, { stap: 10, noot: 39, duur: 2 }, { stap: 14, noot: 48, duur: 6 }] }],
  },
};
test('de fixtures voor de Logic-proef', async () => {
  const b = setNaarSmf(PROEF_SET, { omlopen: 2 });
  ok('proef-set.mid = setNaarSmf(PROEF_SET, { omlopen: 2 }) (3 patronen, 124 bpm, swing 66,7)', gelijk(b, fixture('proef-set.mid')));
  const terug = smfNaarPatronen(fixture('proef-set.mid'));
  ok('proef-set.mid terug: drie patronen uit de meta, met hun spoornaam',
    terug.length === 3 && terug.every((x) => x.bron === 'meta' && x.fouten.length === 0) && terug.map((x) => x.naam).join('|') === 'T1 P1 kick (drums)|T1 P2 hats (drums)|T3 P1 bas (poly)');
  ok('proef-set.mid terug: de hats zijn precies het patroon (swing 66,7, micro 0,1)', isDeepStrictEqual(terug[1].patroon, M.normaliseerPatroon(PROEF_SET.tracks[1][1])));
});

// ---- 4. tegen de speler, en de rondreis ------------------------------------------
test('500 willekeurige patronen', async () => {
  let zaad = 20261010;
  const r = () => ((zaad = (zaad * 1103515245 + 12345) % 2147483648) / 2147483648);
  let zelfde = 0, rond = 0, eerstFout = '';
  for (let k = 0; k < 500; k++) {
    const lengte = M.LENGTES[Math.floor(r() * M.LENGTES.length)], deling = M.DELINGEN[Math.floor(r() * M.DELINGEN.length)];
    const p = M.normaliseerPatroon({
      id: `p-r${k}`, naam: r() < 0.2 ? 'één → twee' : '', lengte, deling, swing: r() < 0.3 ? 50 : 50 + r() * 25,
      noten: Array.from({ length: 1 + Math.floor(r() * 24) }, () => ({ stap: Math.floor(r() * (lengte + 2)), noot: 30 + Math.floor(r() * 30),
        snelheid: 0.01 + r() * 0.99, duur: 0.05 + r() * (r() < 0.8 ? 2 : 20), micro: r() < 0.5 ? 0 : r() - 0.5 })),
    });
    const omlopen = 1 + Math.floor(r() * 3);
    const set = setMet(p, { soort: r() < 0.5 ? 'drums' : 'poly', track: 1 + Math.floor(r() * 8) });
    const bytes = setNaarSmf(set, { omlopen });
    // De speler plant in vensters die op elkaar aansluiten (speler.js, 120 ms vooruit): de unie
    // van willekeurige vensters over de eerste omlopen, met S3 (één per noot en tick).
    const L0 = V.omloopTicks(p), tot = (omlopen + 1) * L0, verwacht = new Set();
    for (let van = 0; van < tot;) {
      const t2 = Math.min(tot, van + 1 + Math.floor(r() * L0));
      for (const n of V.notenInVenster(p, { basis: 0 }, van, t2)) if (n.omloop < omlopen) verwacht.add(`${Math.round(n.tick)}:${n.noot}`);
      van = t2;
    }
    const inBestand = new Set(spoor(bytes).filter((e) => e.st === 0x90).map((e) => `${e.t}:${e.noot}`));
    const aantal = spoor(bytes).filter((e) => e.st === 0x90).length;
    if (inBestand.size === verwacht.size && aantal === verwacht.size && [...verwacht].every((x) => inBestand.has(x))) zelfde++;
    else if (!eerstFout) eerstFout = `patroon ${k}: bestand ${aantal}, speler ${verwacht.size}`;
    const terug = smfNaarPatronen(bytes);
    if (terug.length === 1 && terug[0].bron === 'meta' && isDeepStrictEqual(terug[0].patroon, M.normaliseerPatroon(p))) rond++;
  }
  ok('elke noot-aan in het bestand = een noot die de speler in zijn vensters plant (500/500)', zelfde === 500, `${zelfde}/500; ${eerstFout}`);
  ok('rondreis met meta: smfNaarPatronen(setNaarSmf(p)) = normaliseerPatroon(p) (500/500)', rond === 500, `${rond}/500`);
  ok('klinkendeNoten(p, 2) = de eerste twee omlopen van notenInVenster', (() => {
    const p = M.normaliseerPatroon(PROEF_SET.tracks[1][1]);
    return klinkendeNoten(p, 2).length === 32 && klinkendeNoten(p, 1).length === 16;
  })());
});

// ---- 5. lezen zonder meta (L2) ---------------------------------------------------
test('lezen zonder meta (L2, benaderd)', async () => {
  const kick = smfNaarPatronen(setNaarSmf(KICK_SET, { meta: false }));
  ok('kick zonder meta: stappen 0/4/8/12, noot 36, duur 1, micro 0, bron noten',
    kick.length === 1 && kick[0].bron === 'noten' && kick[0].patroon.noten.map((n) => n.stap).join() === '0,4,8,12'
    && kick[0].patroon.noten.every((n) => n.noot === 36 && n.duur === 1 && n.micro === 0 && Math.abs(n.snelheid - 102 / 127) < 1e-12));
  ok("kick zonder meta: 'benaderd' in fouten, naam van het spoor erbij", kick[0].fouten.some((f) => /benaderd/.test(f)) && kick[0].naam === 'T1 P1 kick (drums)');
  const hatsP = PROEF_SET.tracks[1][1];
  const hats = smfNaarPatronen(setNaarSmf(setMet(hatsP), { meta: false }), { swing: 66.7 });
  const h = hats[0]?.patroon;
  ok('hats (swing 66,7, micro 0,1) zonder meta: gooit niet, 16 noten, fouten niet leeg', !!h && h.noten.length === 16 && hats[0].fouten.length > 0 && h.swing === 66.7);
  ok('hats (L3): stap 1 komt terug als stap 1 met micro ≈ 0 (de swing eraf, binnen één tick); stap 6 micro ≈ 0,1',
    h.noten[1].stap === 1 && Math.abs(h.noten[1].micro) <= 1 / 96 && h.noten[6].stap === 6 && Math.abs(h.noten[6].micro - 0.1) <= 1 / 96, JSON.stringify(h?.noten.slice(0, 7)));
  const p75 = patroon([{ stap: 1, noot: 42 }, { stap: 3, noot: 42, micro: 0.4 }], { swing: 75 });
  const b75 = setNaarSmf(setMet(p75), { meta: false });
  const z75 = smfNaarPatronen(b75, { swing: 75 })[0].patroon;
  ok('L3 bij swing 75: stap 1 (tick 144, precies tussen 1 en 2) blijft stap 1; stap 3 + 0,4 (tick 374) ligt dichter bij stap 4 (−10 ticks) en wordt dat',
    z75.noten.map((n) => `${n.stap}:${Math.round(n.micro * 96)}`).join() === '1:0,4:-10', JSON.stringify(z75.noten));
  const rand = smfNaarPatronen(setNaarSmf(setMet(patroon([{ stap: 15, noot: 36, micro: 0.5 }])), { meta: false }))[0];
  ok('L3: de laatste stap met micro +0,5 (precies op de omloopgrens) blijft stap 15, niet weggelaten',
    rand.patroon.noten.length === 1 && rand.patroon.noten[0].stap === 15 && rand.patroon.noten[0].micro === 0.5 && !rand.fouten.some((f) => /weggelaten/.test(f)), JSON.stringify(rand));
  ok('… met dezelfde tick: opnieuw geschreven bytegewijs hetzelfde', gelijk(setNaarSmf(setMet({ ...z75, id: 'p-t' }), { meta: false }), b75));
  const zonderSwing = smfNaarPatronen(setNaarSmf(setMet(hatsP), { meta: false }))[0].patroon;
  ok('met het verkeerde raster (swing 50 gelezen) komt de swing terug als micro ≈ 1/3: benaderd, en zo gemeld',
    zonderSwing.noten[1].stap === 1 && Math.abs(zonderSwing.noten[1].micro - 32 / 96) < 1e-9);
  const basP = PROEF_SET.tracks[3][0];
  const bas = smfNaarPatronen(setNaarSmf(setMet(basP, { soort: 'poly' }), { meta: false }))[0].patroon;
  const n6 = bas.noten.find((n) => n.noot === 43), n14 = bas.noten.find((n) => n.noot === 48);
  ok('bas: micro −0,2 op stap 6 terug binnen één tick; duur 6 op stap 14 terug als 6',
    n6.stap === 6 && Math.abs(n6.micro - -0.2) <= 1 / 96 && n14.stap === 14 && n14.duur === 6, JSON.stringify({ n6, n14 }));
  const twee = setNaarSmf(KICK_SET, { meta: false, omlopen: 2 });
  const een = smfNaarPatronen(twee)[0], beide = smfNaarPatronen(twee, { omlopen: 2 })[0];
  ok('twee omlopen gelezen met omlopen 1: vier noten, en "weggelaten" in fouten', een.patroon.noten.length === 4 && een.fouten.some((f) => /weggelaten/.test(f)));
  ok('met omlopen 2: de tweede omloop valt op dezelfde stappen, niets weggelaten', beide.patroon.noten.map((n) => n.stap).join() === '0,4,8,12' && !beide.fouten.some((f) => /weggelaten/.test(f)));
  // Een bestand zoals Logic het zou schrijven: 480 PPQN, running status, noot-aan met v 0 als uit, geen meta.
  const body = [0x00, 0xff, 0x03, 0x04, ...'Kick'].map((x) => (typeof x === 'string' ? x.charCodeAt(0) : x))
    .concat([0x00, 0x99, 36, 100, 0x78, 36, 0, 0x82, 0x68, 38, 90, 0x78, 38, 0, 0x00, 0xff, 0x2f, 0x00]);
  const logic = Uint8Array.from([...'MThd'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 6, 0, 1, 0, 1, 0x01, 0xe0], [...'MTrk'].map((c) => c.charCodeAt(0)), [0, 0, 0, body.length], body));
  const lg = smfNaarPatronen(logic);
  ok('een "Logic"-bestand (480 PPQN, running status, v 0 = uit): stap 0 en 4, duur 1, naam Kick',
    lg.length === 1 && lg[0].naam === 'Kick' && lg[0].patroon.noten.map((n) => `${n.stap}:${n.noot}:${n.duur}`).join() === '0:36:1,4:38:1', JSON.stringify(lg[0]?.patroon.noten));
  // De rondreis ZONDER meta (L3), 1000 patronen. (a) Als het raster bekend is en de noten niet
  // dubbelzinnig zijn (|micro| ≤ 0,2, swing ≤ 62,5, duur ≤ 0,5, één omloop): bytegewijs hetzelfde.
  // (b) Helemaal willekeurig: gemeten, niet geëist (de jury mat 2851/3000); de grens bewaakt een terugval.
  let zaad = 4242;
  const rnd = () => ((zaad = (zaad * 1103515245 + 12345) % 2147483648) / 2147483648);
  const rondreis = (netjes) => {
    let zelfde = 0;
    for (let k = 0; k < 1000; k++) {
      const lengte = M.LENGTES[Math.floor(rnd() * M.LENGTES.length)], deling = M.DELINGEN[Math.floor(rnd() * M.DELINGEN.length)];
      const swing = rnd() < 0.3 ? 50 : 50 + rnd() * (netjes ? 12.5 : 25);
      const p = M.normaliseerPatroon({ id: 'p-z', lengte, deling, swing, noten: Array.from({ length: 1 + Math.floor(rnd() * 24) }, () => ({
        stap: Math.floor(rnd() * lengte), noot: 30 + Math.floor(rnd() * 30), snelheid: 0.01 + rnd() * 0.99,
        duur: netjes ? 0.05 + rnd() * 0.45 : 0.05 + rnd() * (rnd() < 0.8 ? 2 : 20), micro: rnd() < 0.5 ? 0 : (rnd() - 0.5) * (netjes ? 0.4 : 1) })) });
      const set = setMet(p, { soort: null });
      const a = setNaarSmf(set, { meta: false });
      const q = smfNaarPatronen(a, { lengte, deling, swing })[0].patroon;
      if (gelijk(setNaarSmf(setMet({ ...q, id: 'p-z' }, { soort: null }), { meta: false }), a)) zelfde++;
    }
    return zelfde;
  };
  const netjes = rondreis(true), alles = rondreis(false);
  ok(`L3-rondreis zonder meta, raster bekend en niet dubbelzinnig: bytegewijs hetzelfde (${netjes}/1000)`, netjes === 1000, `${netjes}/1000`);
  ok(`L3-rondreis zonder meta, helemaal willekeurig: ${alles}/1000 bytegewijs hetzelfde (grens 950; jury 2851/3000 op haar generator)`, alles >= 950, `${alles}/1000`);
  ok('negeerMeta: ook met meta de noten lezen', smfNaarPatronen(setNaarSmf(KICK_SET), { negeerMeta: true })[0].bron === 'noten');
  const kapot = setNaarSmf(KICK_SET);
  const i = hex(kapot).replace(/ /g, '').indexOf(Buffer.from(META + '{').toString('hex')) / 2 + META.length;
  kapot[i] = 0x21;   // '{' wordt '!': geen JSON meer
  const k2 = smfNaarPatronen(kapot)[0];
  ok('kapotte meta: de noten gelezen, met een melding', k2.bron === 'noten' && k2.fouten.some((f) => /JSON/.test(f)) && k2.patroon.noten.length === 4);
  ok('het tempospoor (geen noten, geen meta) levert geen patroon', smfNaarPatronen(fixture('kick-goud.mid')).length === 1);
});


// ---- v2: de set als lijst, het kanaal van de engine, L4 (bewerkt in Logic) -------------------
test('v2: dezelfde set als lijst met (track, plek) geeft dezelfde gouden bytes', () => {
  const v2 = { versie: 2, naam: 'set', tempo: 120, patronen: [{ ...KICK, track: 1, plek: 1 }], instrumenten: { 1: { soort: 'drums' } } };
  ok('kick (v2-set) met meta = kick-goud.mid', gelijk(setNaarSmf(v2), fixture('kick-goud.mid')));
  ok('kick (v2-set) zonder meta = kick-goud-zonder-meta.mid', gelijk(setNaarSmf(v2, { meta: false }), fixture('kick-goud-zonder-meta.mid')));
  const proef = M.normaliseerSet(PROEF_SET).set;
  ok('de proef-set na normaliseren (v2-vorm) = proef-set.mid', gelijk(setNaarSmf(proef, { omlopen: 2 }), fixture('proef-set.mid')));
  const metaTekst = tekst(spoor(setNaarSmf(v2)).find((e) => e.meta === 1));
  ok('de meta is het patroon zonder zijn plek (de vorm van v1)', !/"track"|"plek"/.test(metaTekst));
});

test('v2: het kanaal komt van wat er NU op de track staat; plekken boven 5; de bak gaat niet mee', () => {
  const v2 = { patronen: [{ ...KICK, track: 2, plek: 7 }, { ...KICK, id: 'p-bak', track: null, plek: null }] };
  const zonder = L.leesSmf(setNaarSmf(v2, { meta: false }));
  ok('zonder instrument: kanaal 1, spoornaam T2 P7', zonder.sporen.length === 2 && zonder.sporen[1].find((e) => e.st === 0x90).kanaal === 1
    && tekst(zonder.sporen[1].find((e) => e.meta === 3)) === 'T2 P7 kick');
  const met = L.leesSmf(setNaarSmf(v2, { meta: false, instrumenten: { 2: 'drums' } }));
  ok('instrumenten { 2: drums }: kanaal 10 en "(drums)"', met.sporen[1].find((e) => e.st === 0x90).kanaal === 10 && tekst(met.sporen[1].find((e) => e.meta === 3)) === 'T2 P7 kick (drums)');
  const voor = L.leesSmf(setNaarSmf({ ...v2, instrumenten: { 2: { soort: 'drums' } } }, { meta: false, instrumenten: { 2: { soort: 'poly' } } }));
  ok('wat er nu staat gaat voor de hint in de set', voor.sporen[1].find((e) => e.st === 0x90).kanaal === 1);
  ok('alleen plek 7 kiezen', L.leesSmf(setNaarSmf(v2, { track: 2, plek: 7 })).sporen.length === 2 && setNaarSmf(v2, { track: 2, plek: 1 }) === null);
});

test('v2 L4: is het bestand in Logic bewerkt (de noten wijken af van de meta), dan winnen de noten', () => {
  const b = fixture('kick-goud.mid').slice();
  const h = hex(b).replace(/ /g, '');
  const i = h.indexOf('992466', h.indexOf('4d54726b', 60)) / 2;   // de eerste kick in spoor 1
  b[i + 2] = 0x40;                                                // velocity 102 → 64
  const r = smfNaarPatronen(b);
  ok('één patroon, uit de noten, met de melding "bewerkt"', r.length === 1 && r[0].bron === 'noten' && r[0].fouten.some((f) => /bewerkt/.test(f)), JSON.stringify(r[0]?.fouten));
  const p = r[0].patroon;
  ok('id, naam en raster van de meta; de noten van het bestand', p.id === 'p-kick' && p.naam === 'kick' && p.lengte === 16 && p.deling === 4
    && p.noten.map((n) => n.stap).join() === '0,4,8,12' && Math.abs(p.noten[0].snelheid - 64 / 127) < 1e-12 && Math.abs(p.noten[1].snelheid - 102 / 127) < 1e-12);
  ok('onbewerkt: de meta (L1), zonder melding', smfNaarPatronen(fixture('kick-goud.mid'))[0].bron === 'meta' && smfNaarPatronen(fixture('proef-set.mid')).every((x) => x.bron === 'meta'));
  // Alle noten in Logic weggehaald: een leeg patroon met het raster van de meta, niet weg.
  const leeg = L.smf([
    L.mtrk([{ t: 0, orde: 0, b: L.meta(0x03, L.ascii('set')) }], 0),
    L.mtrk([{ t: 0, orde: -2, b: L.meta(0x03, L.ascii('T1 P1 kick (drums)')) }, { t: 0, orde: -1, b: L.meta(0x01, L.ascii(META + JSON.stringify(KICK))) }], 1536),
  ]);
  const lr = smfNaarPatronen(leeg);
  ok('alle noten weg: een leeg patroon (id en raster van de meta)', lr.length === 1 && lr[0].bron === 'noten' && lr[0].patroon.noten.length === 0 && lr[0].patroon.id === 'p-kick');
});
