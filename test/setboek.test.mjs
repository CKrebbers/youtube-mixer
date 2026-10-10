// Het setboek (tools/setboek/lees.mjs, spoor produceren-uit stap 2a): wat er
// op een avond KLONK, uit synthetische handelingenlogs in het echte formaat
// (ASCII met \uXXXX via asciiJson, kop, stand, laad, actieregels, eind).
// Puur: geen server, geen bestanden.
// Draai met: node test/setboek.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (name, cond, extra = '') => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name + (extra && !cond ? ` — ${extra}` : '')); };
const dicht = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const { asciiJson } = await import('../src/control/handelingen.js');
const S = await import('../tools/setboek/lees.mjs');
const { tellingen } = await import('../tools/setboek/gebruik.mjs');
const { xfaderGains } = await import('../src/engine/audio-graph.js');

// 10 okt 2026 20:00 in Amsterdam (CEST = UTC+2).
const BEGIN = Date.parse('2026-10-10T18:00:00.000Z');

/** Een track in de beginstand, zoals leesStand hem schrijft. */
const tr = (track, titel, o = {}) => ({
  track, bron: titel ? 'library' : 'leeg', nummer: titel ? (o.nummer ?? `n${track}`) : undefined, titel: titel ?? null,
  positie: o.positie ?? 0, speelt: !!o.speelt, wacht: false, rate: o.rate ?? 1, bereik: 0.16, cue: o.cue ?? 0,
  hotcues: o.hotcues ?? [null, null, null, null], loop: o.loop ?? null, grid: null, secties: o.secties ?? null,
  kant: o.kant ?? (track === 1 ? 'A' : track === 2 ? 'B' : 'thru'), kill: { low: false, mid: false, high: false, ...(o.kill || {}) },
  stemKill: o.stemKill ?? null, sprong: 4,
});

/** Een log als tekst. `tracks`: overschrijvingen per track; `waarden`: extra waarden in de stand. */
function logTekst({ begon = BEGIN, opname = null, tracks = {}, waarden = {}, regels = [], eind = 'auto', curve = 0 } = {}) {
  const lijst = Array.from({ length: 8 }, (_, i) => tracks[i + 1] ?? tr(i + 1, null));
  const w = { 'mixer.xfader': 0.5, 'mixer.master': 0.8 };
  for (let i = 1; i <= 8; i++) Object.assign(w, { [`track.${i}.fader`]: 1, [`track.${i}.trim`]: 0.5, [`track.${i}.filter`]: 0.5 });
  const rijen = [
    { t: 0, e: 'kop', versie: 1, begon: new Date(begon).toISOString(), klok: 12.5, opname, sampleRate: 48000, tracks: 8 },
    { t: 0, e: 'stand', focus: 1, tracks: lijst, waarden: { ...w, ...waarden }, rond: { 'mixer.xfader.curve': curve }, pads: [], herinneringen: [] },
    ...regels,
  ];
  if (eind === 'auto') rijen.push({ t: Math.max(...rijen.map((r) => (Array.isArray(r) ? r[0] : r.t))), e: 'eind', regels: rijen.length + 1 });
  else if (typeof eind === 'number') rijen.push({ t: eind, e: 'eind', regels: rijen.length + 1 });
  return rijen.map(asciiJson).join('\n') + '\n';
}
const druk = (t, id) => [[t, id, true], [t + 0.1, id, false]];
const laad = (t, track, titel, nummer = `n-${titel}`) => ({ t, e: 'laad', track, bron: 'library', nummer, titel, duur: 0.4, grid: null });
const een = (tekst, opties) => S.hoorbaar(JSON.parse(JSON.stringify(S.rijgLogs([{ bestand: 'set-20261010-200000.acties.jsonl', tekst }]).logs[0].log)), opties);
const rond = (x) => Math.round(x);

console.log('constanten gelijk aan de engine');
{
  const deck = readFileSync(new URL('../src/engine/deck.js', import.meta.url), 'utf8');
  const engine = readFileSync(new URL('../src/engine/engine.js', import.meta.url), 'utf8');
  const acties = readFileSync(new URL('../src/control/actions.js', import.meta.url), 'utf8');
  ok('PITCH_BEREIKEN = deck.js', deck.includes(`export const PITCH_BEREIKEN = [${S.PITCH_BEREIKEN.join(', ')}];`));
  ok('RATE 0,5–2 = actions.js (track.N.tempo)', acties.includes(`const RATE_MIN = ${S.RATE.min};`) && acties.includes(`const RATE_MAX = ${S.RATE.max};`));
  ok("KANTEN = engine.js (XFADE_KANTEN, de volgorde van xfade.side)", engine.includes(`export const XFADE_KANTEN = ['A', 'B', 'thru'];`) && S.KANTEN.join() === 'A,B,thru');
}

console.log('\n1–2. een overgang met de crossfader, en een flits');
{
  const tekst = logTekst({
    tracks: { 1: tr(1, 'Nummer A', { speelt: true }) }, waarden: { 'mixer.xfader': 0 },
    regels: [laad(60, 2, 'Nummer B'), ...druk(61, 'track.2.play'),
      [100, 'mixer.xfader', 0.5], [110, 'mixer.xfader', 0.9], [120, 'mixer.xfader', 1],
      laad(130, 3, 'Flits C'), ...druk(131, 'track.3.play'), [140, 'track.3.fader', 0], [300, 'track.1.fader', 1]],
  });
  const h = een(tekst);
  const a = h.stukken.find((s) => s.titel === 'Nummer A'), b = h.stukken.find((s) => s.titel === 'Nummer B');
  ok('A van 0:00 tot 2:00 (xfader 0,9 = −16,1 dB: nog hoorbaar; 1 = weg)', a && a.van === 0 && a.tot === 120, JSON.stringify(a));
  ok('B van 1:40 (xfader 0,5) tot het eind (5:00)', b && b.van === 100 && b.tot === 300, JSON.stringify(b));
  ok('xfaderGains(0,9).a = −16,1 dB (de grens die A nog laat horen)', dicht(20 * Math.log10(xfaderGains(0.9).a), -16.1, 0.05));
  ok('de flits van 9 s staat niet in de tracklist', !h.stukken.some((s) => s.titel === 'Flits C') && h.stukken.length === 2);
  const c = h.nietHoorbaar.find((x) => x.titel === 'Flits C');
  ok('maar wel onder "geladen maar niet hoorbaar", met 9 s hoorbaar', c && rond(c.kortHoorbaar) === 9, JSON.stringify(h.nietHoorbaar));
}

console.log('\n3. de kant van de crossfader');
{
  const tekst = logTekst({
    tracks: { 2: tr(2, 'Op B', { speelt: true }) }, waarden: { 'mixer.xfader': 0 },
    regels: [[30, 'track.2.xfade.a', true], [30.1, 'track.2.xfade.a', false], [90, 'track.2.xfade.side', true], [200, 'mixer.master', 0.8]],
  });
  const h = een(tekst);
  ok('op kant B met de crossfader op A: niet hoorbaar; xfade.a maakt hem hoorbaar; side (A → B) weer niet',
    h.stukken.length === 1 && h.stukken[0].van === 30 && h.stukken[0].tot === 90, JSON.stringify(h.stukken));
  const thru = een(logTekst({ tracks: { 5: tr(5, 'Thru', { speelt: true }) }, waarden: { 'mixer.xfader': 1 }, regels: [[60, 'mixer.master', 0.8]] }));
  ok('thru hoort de crossfader niet (track 5, crossfader op B)', thru.stukken.length === 1 && thru.stukken[0].tot === 60);
  const scherp = een(logTekst({ tracks: { 1: tr(1, 'Scherp', { speelt: true }) }, curve: 1, waarden: { 'mixer.xfader': 0.7 }, regels: [[60, 'mixer.master', 0.8]] }));
  ok('scherpe curve (rond: 1): A is op 0,7 al weg (1 − 0,2 × 8 < 0)', scherp.stukken.length === 0);
}

console.log('\n4. wat een track stil maakt');
{
  const met = (regels, o = {}) => een(logTekst({ tracks: { 1: tr(1, 'X', { speelt: true, ...o }) }, waarden: { 'mixer.xfader': 0 }, regels: [...regels, [200, 'mixer.xfader', 0]] }));
  const trim = met([[50, 'track.1.trim', 0], [150, 'track.1.trim', 0.5]]);
  ok('trim dicht = niet hoorbaar (50–150)', trim.stukken.length === 2 && trim.stukken[0].tot === 50 && trim.stukken[1].van === 150, JSON.stringify(trim.stukken));
  const stems = met([[50, 'track.1.stem.vocals.kill', true], [50, 'track.1.stem.inst', 0], [150, 'track.1.stem.inst', 1]], { stemKill: { vocals: false, inst: false } });
  ok('alle stems dicht (zang weg, rest op 0) = niet hoorbaar', stems.stukken.length === 2 && stems.stukken[0].tot === 50 && stems.stukken[1].van === 150, JSON.stringify(stems.stukken));
  const zang = met([[50, 'track.1.stem.vocals.kill', true]], { stemKill: { vocals: false, inst: false } });
  ok('alleen de zang weg = nog hoorbaar', zang.stukken.length === 1 && zang.stukken[0].tot === 200);
  const vier = met([[50, 'track.1.stem.vocals', 0], [50, 'track.1.stem.drums.kill', true], [50, 'track.1.stem.bass.kill', true], [50, 'track.1.stem.other.hold', true], [150, 'track.1.stem.other.hold', false]],
    { stemKill: { vocals: false, inst: false, drums: false, bass: false, other: false } });
  ok('vier stems: zang 0 + drums, bas, overig dicht = stil, ook als inst open staat; loslaten = terug', vier.stukken.length === 2 && vier.stukken[0].tot === 50 && vier.stukken[1].van === 150, JSON.stringify(vier.stukken));
  const master = met([[50, 'mixer.master', 0], [150, 'mixer.master', 0.8]]);
  ok('master dicht = niets hoorbaar', master.stukken.length === 2 && master.stukken[0].tot === 50 && master.stukken[1].van === 150);
  const kills = met([[50, 'track.1.kill.low', true], [50, 'track.1.kill.mid', true], [50, 'track.1.kill.high.hold', true], [150, 'track.1.kill.high.hold', false]]);
  ok('drie kills (twee schakelaars + één vastgehouden) = niet hoorbaar; loslaten = terug', kills.stukken.length === 2 && kills.stukken[0].tot === 50 && kills.stukken[1].van === 150);
  const twee = met([[50, 'track.1.kill.low', true], [50, 'track.1.kill.mid', true]]);
  ok('twee kills = nog hoorbaar', twee.stukken.length === 1);
  const zacht = met([[50, 'track.1.fader', 0.3], [150, 'track.1.fader', 0.4]]);
  ok('fader 0,3 = −31,5 dB (stil), 0,4 = −27 dB (hoorbaar)', zacht.stukken.length === 2 && zacht.stukken[0].tot === 50 && zacht.stukken[1].van === 150, JSON.stringify(zacht.stukken));
  const glij = met([[50, 'track.1.fader.glide', 0.2], [150, 'track.1.fader.glide', 0.9]]);
  ok('de glijdende fader van de auto-DJ (fader.glide) telt als fader', glij.stukken.length === 2 && glij.stukken[0].tot === 50 && glij.stukken[1].van === 150);
  const kort = met([[50, 'track.1.fader', 0], [53, 'track.1.fader', 1]]);
  ok('fader 3 s dicht = één stuk (gaten < 5 s gelijmd)', kort.stukken.length === 1 && kort.stukken[0].van === 0 && kort.stukken[0].tot === 200);
}

console.log('\n5. voorluisteren');
{
  const h = een(logTekst({ regels: [laad(10, 3, 'Voorluisteren'), [11, 'track.3.fader', 0], ...druk(12, 'track.3.play'), [120, 'track.3.fader', 0]] }));
  ok('fader op 0 en spelen = geladen maar niet hoorbaar (0 s)', h.stukken.length === 0 && h.nietHoorbaar.length === 1 && h.nietHoorbaar[0].kortHoorbaar === 0 && h.nietHoorbaar[0].titel === 'Voorluisteren');
}

console.log('\n6. cue, play en laad (deck.cue, BufferBron.laad)');
{
  const h = een(logTekst({
    tracks: { 1: tr(1, 'Cue', { speelt: true }) }, waarden: { 'mixer.xfader': 0 },
    regels: [...druk(60, 'track.1.cue'),       // speelt: terug naar het cuepunt en stil
      ...druk(100, 'track.1.cue'),              // stil OP het cuepunt: spelen
      ...druk(160, 'track.1.play'),             // stil (elders)
      ...druk(170, 'track.1.cue'),              // stil elders: cuepunt hier, NIET spelen
      ...druk(180, 'track.1.cue'),              // nu op het cuepunt: spelen
      laad(250, 1, 'Daarna'),                   // laad tijdens spelen: stop, nieuwe titel, stil
      ...druk(280, 'track.1.play'), [400, 'mixer.xfader', 0]],
  }));
  const r = h.stukken.map((s) => `${s.titel}:${s.van}-${s.tot}`).join(' ');
  ok('cue tijdens spelen = stop (0–60); cue stil op het cuepunt = start (100–160)', r.startsWith('Cue:0-60 Cue:100-160'), r);
  ok('cue stil elders zet het cuepunt (geen start bij 170); de tweede cue start (180–250)', r.includes('Cue:180-250') && !r.includes('Cue:170'), r);
  ok('laad tijdens spelen = stop en een nieuwe titel; play start hem (280–400)', r.endsWith('Daarna:280-400') && h.stukken.length === 4, r);
  ok('na een cue-stop staat de positie op het cuepunt: het stuk 100–160 begint in de bron op 0:00', dicht(h.stukken[1].posVan, 0) && dicht(h.stukken[1].posTot, 60));
  const rem = een(logTekst({ tracks: { 1: tr(1, 'Rem', { speelt: true }) }, waarden: { 'mixer.xfader': 0 },
    regels: [...druk(60, 'track.1.brake'), ...druk(62, 'track.1.brake'), ...druk(120, 'track.1.brake'), [200, 'mixer.xfader', 0]] }));
  ok('rem = stil, nog eens binnen 5 s = los (één stuk 0–120 met een gat van 2 s gelijmd)', rem.stukken.length === 1 && rem.stukken[0].tot === 120, JSON.stringify(rem.stukken));
  const quant = een(logTekst({ regels: [laad(5, 1, 'Op de maat'), ...druk(10, 'track.1.play.quant'), ...druk(70, 'track.1.play.quant'), [100, 'mixer.xfader', 0]] }));
  ok('play.quant start en stopt zoals play', quant.stukken.length === 1 && quant.stukken[0].van === 10 && quant.stukken[0].tot === 70);
}

console.log('\n6b. een instrument haalt het nummer eraf (actions.js, kiesInstrument)');
{
  const h = een(logTekst({ tracks: { 3: tr(3, 'Speelt', { speelt: true }), 4: tr(4, 'Stil') },
    regels: [...druk(60, 'track.3.inst'), ...druk(120, 'track.3.inst'), ...druk(121.5, 'track.3.inst'), [200, 'track.4.inst.choose', 0.25], ...druk(210, 'track.4.play'), [300, 'mixer.master', 0.8]] }));
  ok('spelend nummer: één druk = alleen een melding (speelt door), twee binnen 3 s = eraf (0–121,5)',
    h.stukken.length === 1 && h.stukken[0].titel === 'Speelt' && h.stukken[0].tot === 121.5, JSON.stringify(h.stukken));
  ok('stil nummer: inst.choose > 0 haalt het er meteen af; play daarna start niets (geen nummer)', !h.stukken.some((x) => x.titel === 'Stil') && h.nietHoorbaar.some((x) => x.titel === 'Stil'));
}

console.log('\n7. het einde van een nummer (zit niet in het log)');
{
  const regels = [...druk(1500, 'track.1.seek'), [1500, 'track.1.seek', 0], ...druk(1500.5, 'track.1.play'), [1800, 'mixer.xfader', 0]];
  const tekst = logTekst({ tracks: { 1: tr(1, 'Kort', { speelt: true, nummer: 'kort' }) }, waarden: { 'mixer.xfader': 0 }, regels });
  const met = een(tekst, { lengte: (id) => (id === 'kort' ? 180 : null) });
  const r = met.stukken.map((s) => `${s.van}-${s.tot}${s.onzeker ? '?' : ''}`).join(' ');
  ok('met lengte(): speelt uit op 180 s; na de seek naar 0 is play een START (1500,5–1680,5)', r === '0-180 1500.5-1680.5', r);
  const zonder = een(tekst);
  const z = zonder.stukken.map((s) => `${s.van}-${s.tot}${s.onzeker ? '?' : ''}`).join(' ');
  ok('zonder lengte(): het model denkt dat hij 25 min speelt en de play-druk stopt: dat stuk is "(onzeker)"', z === '0-1500.5?', z);
  const loop = een(logTekst({ tracks: { 1: tr(1, 'Kort', { speelt: true, nummer: 'kort', loop: { start: 0, end: 8, tellen: 16 } }) }, waarden: { 'mixer.xfader': 0 }, regels: [[600, 'mixer.xfader', 0]] }),
    { lengte: () => 180 });
  ok('met een loop geen einde: speelt door tot 600, met de aantekening loop', loop.stukken.length === 1 && loop.stukken[0].tot === 600 && loop.stukken[0].loop);
  const rate = een(logTekst({ tracks: { 1: tr(1, 'Sneller', { speelt: true, nummer: 'x', positie: 60, rate: 1.2 }) }, waarden: { 'mixer.xfader': 0 }, regels: [[600, 'mixer.xfader', 0]] }), { lengte: () => 180 });
  ok('einde = (lengte − positie) / rate: (180 − 60) / 1,2 = 100 s', rate.stukken.length === 1 && dicht(rate.stukken[0].tot, 100) && dicht(rate.stukken[0].posTot, 180));
}

console.log('\n8. de positie in de bron (benaderd)');
{
  const secties = { versie: 1, stukken: [{ van: 0, label: 'intro' }, { van: 120, label: 'drop' }, { van: 300, label: 'break' }] };
  const h = een(logTekst({
    tracks: { 1: tr(1, 'Lang', { speelt: true, positie: 83.2, rate: 1.02, hotcues: [30.5, null, null, null], secties }) }, waarden: { 'mixer.xfader': 0 },
    regels: [[60, 'track.1.fader', 0], [100, 'track.1.fader', 1], [100, 'track.1.hotcue.1', true], [100.1, 'track.1.hotcue.1', false],
      [130, 'track.1.fader', 0], [180, 'track.1.fader', 1], [180, 'track.1.section.3', true, { van: 260 }], [180.1, 'track.1.section.3', false],
      [240, 'track.1.pitch', 0.5], [300, 'mixer.xfader', 0]],
  }));
  const [a, b, c] = h.stukken;
  ok('stand 83,2 op 1,02×, 60 s later: 83,2–144,4', a && dicht(a.posVan, 83.2) && dicht(a.posTot, 83.2 + 60 * 1.02), JSON.stringify(a));
  ok('sectielabel bij het begin van het stuk (intro)', a.sectie === 'intro');
  ok('hotcue 1 (30,5) verzet de positie: 30,5–61,1', b && dicht(b.posVan, 30.5) && dicht(b.posTot, 30.5 + 30 * 1.02));
  ok('sectie 3 springt naar 300 (break); pitch 0,5 = rate 1: 300–(300 + 60×1,02 + 60)', c && dicht(c.posVan, 300) && c.sectie === 'break' && dicht(c.posTot, 300 + 60 * 1.02 + 60), JSON.stringify(c));
  ok("positieInBron: '1:23–2:24'", S.positieInBron(a) === '1:23–2:24', S.positieInBron(a));
  const sprong = een(logTekst({ tracks: { 1: tr(1, 'Sprong', { speelt: true, positie: 83.2, hotcues: [30.5, null, null, null] }) }, waarden: { 'mixer.xfader': 0 },
    regels: [[30, 'track.1.hotcue.1', true], [30.1, 'track.1.hotcue.1', false], [60, 'mixer.xfader', 0]] }));
  ok("een hotcue midden in een hoorbaar stuk: twee delen in de bron, '1:23–1:53, 0:31–1:01'",
    sprong.stukken.length === 1 && sprong.stukken[0].delen.length === 2 && S.positieInBron(sprong.stukken[0]) === '1:23–1:53, 0:31–1:01', S.positieInBron(sprong.stukken[0] ?? {}));
  const seek = een(logTekst({ tracks: { 1: tr(1, 'S', { speelt: true, nummer: 's' }) }, waarden: { 'mixer.xfader': 0 }, regels: [[50, 'track.1.fader', 0], [100, 'track.1.seek', 0.5], [100, 'track.1.fader', 1], [160, 'mixer.xfader', 0]] }));
  ok('seek zonder lengte: positie onbekend (null), de tracklist zegt "?"', seek.stukken[1].posVan === null && S.positieInBron(seek.stukken[1]) === null);
  const seekL = een(logTekst({ tracks: { 1: tr(1, 'S', { speelt: true, nummer: 's' }) }, waarden: { 'mixer.xfader': 0 }, regels: [[50, 'track.1.fader', 0], [100, 'track.1.seek', 0.5], [100, 'track.1.fader', 1], [160, 'mixer.xfader', 0]] }), { lengte: () => 400 });
  ok('seek met lengte 400: 0,5 = 200 s', dicht(seekL.stukken[1].posVan, 200));
}

console.log('\n9. het einde van het log');
{
  const af = een(logTekst({ tracks: { 1: tr(1, 'Door', { speelt: true }) }, regels: [[90, 'track.2.fader', 0.5]], eind: 240 }));
  ok('nog hoorbaar bij eind: afgesloten op eind.t (240)', af.stukken.length === 1 && af.stukken[0].tot === 240 && !af.afgebroken);
  const crash = een(logTekst({ tracks: { 1: tr(1, 'Crash', { speelt: true }) }, regels: [[90, 'track.2.fader', 0.5]], eind: null }));
  ok('afgebroken log (geen eind): afgesloten op de laatste regel (90), afgebroken = waar', crash.stukken.length === 1 && crash.stukken[0].tot === 90 && crash.afgebroken);
  const kapot = logTekst({ tracks: { 1: tr(1, 'Kapot', { speelt: true }) }, regels: [[90, 'track.2.fader', 0.5]], eind: null }) + '[95.0,"track.1.fa';
  const r = S.rijgLogs([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: kapot }]);
  ok('een half geschreven staart: 1 kapotte regel, de rest gelezen', r.logs[0].kapot === 1 && r.logs[0].acties === 1 && r.logs[0].afgebroken === 'geen eind (afgebroken)');
}

console.log('\n10–11. meerdere logs op één avond');
{
  const min = 60 * 1000;
  const los1 = logTekst({ tracks: { 1: tr(1, 'Een', { speelt: true }) }, regels: [[600, 'track.1.fader', 1]] });
  const opname = logTekst({ begon: BEGIN + 600 * 1000, opname: '20261010-201000', tracks: { 1: tr(1, 'Een', { speelt: true, positie: 600 }) }, regels: [[300, 'track.1.fader', 1]] });
  const leeg = logTekst({ begon: BEGIN + 20 * min, regels: [] });
  const los2 = logTekst({ begon: BEGIN + 15 * min + 90 * 1000, tracks: { 2: tr(2, 'Twee', { speelt: true }) }, waarden: { 'mixer.xfader': 1 }, regels: [[120, 'track.2.fader', 1]] });
  const bestanden = [
    { bestand: '/kopie/set-20261010-201500.acties.jsonl', tekst: los2 }, { bestand: '/kopie/set-20261010-200000.acties.jsonl', tekst: los1 },
    { bestand: '/kopie/set-20261010-202000.acties.jsonl', tekst: leeg }, { bestand: '/kopie/set-20261010-201000.acties.jsonl', tekst: opname },
  ];
  const r = S.rijgLogs(bestanden);
  ok('één dag (2026-10-10, Amsterdam), drie logs op volgorde van begon', r.dag === '2026-10-10' && r.logs.map((l) => l.id).join() === '20261010-200000,20261010-201000,20261010-201500');
  ok('het lege log onder overgeslagen (0 acties)', r.overgeslagen.length === 1 && r.overgeslagen[0].id === '20261010-202000' && r.overgeslagen[0].reden === '0 acties');
  ok('een gat van 90 s gemeld (opname tot 20:15:00, los log vanaf 20:16:30); los → opname geen gat', r.gaten.length === 1 && rond(r.gaten[0].s) === 90 && r.gaten[0].voor === '20261010-201500', JSON.stringify(r.gaten));
  ok('de opname is herkend (kop.opname)', r.logs[1].opname === '20261010-201000' && r.logs[0].opname === null);
  const boek = S.setboek(bestanden);
  const lijst = boek.stukken.map((s) => `${s.titel}@${S.kloktijd(s.klokVan)}-${S.kloktijd(s.klokTot)}`).join(' ');
  ok('één tracklist op de klok: Een 20:00–20:10, Een 20:10–20:15 (de opname), Twee 20:16:30–20:18:30', lijst === 'Een@20:00:00-20:10:00 Een@20:10:00-20:15:00 Twee@20:16:30-20:18:30', lijst);
  ok('avondtijden lopen door over de logs (Twee begint op 16:30)', boek.stukken[2].avondVan === 990);
  const md = S.naarMarkdown(boek);
  ok('Markdown: kop, logs, het gat, overgeslagen, tracklist, verslagblok, Buma/Stemra',
    md.startsWith('# Setboek 2026-10-10') && md.includes('gat van 1:30: log opnieuw begonnen 20:16:30 (herladen?)') && md.includes('overgeslagen: 20261010-202000 (0 acties)')
    && md.includes('| 3 | 16:30–18:30 | 20:16:30 | T2 | Twee | library |') && md.includes('## Wat werkte') && md.includes('## Buma/Stemra'), md);
  const json = JSON.parse(S.naarJson(boek));
  ok('JSON: zonder de ruwe logs, met dezelfde stukken', !('log' in json.logs[0]) && json.stukken.length === 3 && json.melding === null);
  const niets = S.setboek([{ bestand: 'set-20261010-202000.acties.jsonl', tekst: leeg }]);
  ok('alleen lege logs: melding "geen log van die dag met acties", geen lege tracklist',
    niets.melding === 'geen log van die dag met acties' && niets.stukken.length === 0 && S.naarMarkdown(niets).includes('geen log van die dag met acties') && !S.naarMarkdown(niets).includes('## Tracklist'));
  ok('nul logs: dezelfde melding', S.setboek([]).melding === 'geen log van die dag met acties');
}

console.log('\n12–14. titels, filter, gebruik');
{
  const titel = 'Café del Mar → Ibiza 🌴';
  const tekst = logTekst({ tracks: { 1: tr(1, titel, { speelt: true }) }, waarden: { 'mixer.xfader': 0 }, regels: [[30, 'track.1.filter', 0.05], [90, 'track.1.filter', 0.5]] });
  ok('de logtekst is ASCII (\\u00e9, \\u2192, surrogaatpaar)', /^[\x00-\x7f]*$/.test(tekst) && tekst.includes('Caf\\u00e9') && tekst.includes('\\ud83c\\udf34'));
  const h = een(tekst);
  ok('de titel komt terug zoals hij was', h.stukken[0]?.titel === titel);
  ok('filter op 0,05: aantekening "gefilterd", nog steeds hoorbaar (één stuk)', h.stukken.length === 1 && h.stukken[0].gefilterd && h.stukken[0].tot === 90);
  const regels = [[1, 'track.1.fader', 0.5], [2, 'track.3.fader', 0.4], [3, 'track.1.fader', 0.6], [61, 'mixer.xfader', 0.2], [62, 'track.2.play', true], [62.1, 'track.2.play', false],
    { t: 70, e: 'laad', track: 2 }, { t: 80, e: 'laad', track: 3 }, [200, 'track.2.cue', true]];
  const g = tellingen(regels);
  ok('tellingen: track.N.fader 3, de rest per id, 2 laads, 3 actieve minuten (0, 1, 3)', g.top[0].id === 'track.N.fader' && g.top[0].n === 3 && g.laads === 2 && g.actieveMinuten === 3 && g.acties === 7, JSON.stringify(g));
  ok('tellingen: top 10 op aantal, dan naam', g.top.map((x) => x.id).join() === 'track.N.fader,track.N.play,mixer.xfader,track.N.cue', JSON.stringify(g.top));
  ok('tellingen: offset schuift de minuten', tellingen([[50, 'a'], [70, 'b']], { offset: 15 }).actieveMinuten === 1);
}

console.log('\nlaadmomenten en een stand midden in het log');
{
  const tekst = logTekst({ tracks: { 1: tr(1, 'Begin', { speelt: true }) }, regels: [laad(40, 2, 'Erbij'),
    { t: 100, e: 'stand', focus: 1, tracks: [tr(1, 'Opnieuw', { speelt: true, positie: 10 })], waarden: { 'mixer.xfader': 0 }, rond: {} }, [160, 'mixer.xfader', 0]] });
  const log = S.rijgLogs([{ bestand: 'set-20261010-200000.acties.jsonl', tekst }]).logs[0];
  const lm = S.laadmomenten(log.log, log.begonMs);
  ok('laadmomenten: Begin (stand), Erbij (laad, 20:00:40), Opnieuw (stand)', lm.map((x) => `${x.titel}${x.uitStand ? '*' : ''}`).join() === 'Begin*,Erbij,Opnieuw*' && S.kloktijd(lm[1].klokMs) === '20:00:40');
  const h = S.hoorbaar(log.log);
  ok('een stand midden in het log (terugspelen) begint een nieuw stuk', h.stukken.map((s) => `${s.titel}:${s.van}-${s.tot}`).join() === 'Begin:0-100,Opnieuw:100-160', JSON.stringify(h.stukken));
}

console.log('\nproefpunten (Controlekamer)');
{
  const tekst = logTekst({ tracks: { 1: tr(1, 'Eerste', { speelt: true }) }, waarden: { 'mixer.xfader': 0 }, regels: [[600, 'mixer.xfader', 0]] });
  const sessie = { begonnen: new Date(BEGIN + 300 * 1000).toISOString(), items: {
    'apc-fader': { status: 'fout', notitie: 'fader 3 sprong', tijd: new Date(BEGIN + 120 * 1000).toISOString() },
    'beeld': { status: 'ok', notitie: '', tijd: new Date(BEGIN + 200 * 1000).toISOString() },
    'cue': { status: 'ok', notitie: 'klonk goed', tijd: new Date(BEGIN + 700 * 1000).toISOString() } } };
  const boek = S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst }], { proef: sessie });
  ok('alleen fout of met notitie, fout eerst; wat er toen klonk erbij',
    boek.proef.punten.map((x) => x.id).join() === 'apc-fader,cue' && boek.proef.punten[0].klonk.join() === 'T1 Eerste' && boek.proef.punten[1].klonk.length === 0, JSON.stringify(boek.proef));
  const md = S.naarMarkdown(boek);
  ok('Markdown: proefpunten met de kloktijd, en vrij spelen / speellijst', md.includes('**fout** · apc-fader · rond 20:02:00 · "fader 3 sprong" · toen hoorbaar: T1 Eerste') && md.includes('Speellijst begonnen 20:05:00'), md);
}

console.log('\nde CLI (tools/setboek/setboek.mjs)');
{
  const { mkdtempSync, writeFileSync, readFileSync: lees, existsSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const cli = new URL('../tools/setboek/setboek.mjs', import.meta.url).pathname;
  const draai = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const map = mkdtempSync(join(tmpdir(), 'setboek-'));
  try {
    const kort = logTekst({ tracks: { 1: tr(1, 'Kort', { speelt: true, nummer: 'kort' }) }, waarden: { 'mixer.xfader': 0 }, regels: [[600, 'mixer.xfader', 0]] });
    const nacht = logTekst({ begon: BEGIN + 4.5 * 3600 * 1000, tracks: { 2: tr(2, 'Na middernacht', { speelt: true }) }, waarden: { 'mixer.xfader': 1 }, regels: [[120, 'mixer.xfader', 1]] });
    const ander = logTekst({ begon: BEGIN - 86400 * 1000, tracks: { 1: tr(1, 'Gisteren', { speelt: true }) }, regels: [[60, 'mixer.xfader', 0.5]] });
    writeFileSync(join(map, 'set-20261010-200000.acties.jsonl'), kort);
    writeFileSync(join(map, 'set-20261011-003000.acties.jsonl'), nacht);
    writeFileSync(join(map, 'set-20261009-200000.acties.jsonl'), ander);
    writeFileSync(join(map, 'set-20261011-120000.acties.jsonl'), ander);
    const r = draai('--dag', '20261010', '--map', map);
    ok('--dag: die dag plus de nacht erna (vóór 06:00), naar stdout', r.status === 0 && r.stdout.startsWith('# Setboek 2026-10-10') && r.stdout.includes('Na middernacht')
      && !r.stdout.includes('Gisteren') && r.stdout.includes('20261011-003000'), r.stderr + r.stdout.slice(0, 300));
    ok('zonder --db: Kort speelt door tot 10:00 (geen einde te schatten)', r.stdout.includes('| 1 | 0:00–10:00 | 20:00:00 | T1 | Kort |'), r.stdout);
    const { DatabaseSync } = await import('node:sqlite');
    const dbPad = join(map, 'library.db');
    const db = new DatabaseSync(dbPad);
    db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, titel TEXT, duur REAL)');
    db.prepare('INSERT INTO tracks (id, titel, duur) VALUES (?, ?, ?)').run('kort', 'Kort', 180);
    db.close();
    const metDb = draai('--log', join(map, 'set-20261010-200000.acties.jsonl'), '--db', dbPad, '--json');
    const j = JSON.parse(metDb.stdout);
    ok('--db (kopie, alleen lezen): Kort stopt op 3:00; --json is te lezen', metDb.status === 0 && j.stukken.length === 1 && j.stukken[0].tot === 180 && j.instellingen.lengte === true, metDb.stderr);
    const zonderDb = draai('--log', join(map, 'set-20261010-200000.acties.jsonl'), '--db', join(map, 'bestaat-niet.db'));
    ok('--db die niet bestaat: geen crash, een melding, gewoon een setboek', zonderDb.status === 0 && /bestaat niet/.test(zonderDb.stderr) && zonderDb.stdout.includes('# Setboek'));
    const twee = draai('--log', join(map, 'set-20261010-200000.acties.jsonl'), '--log', join(map, 'set-20261011-003000.acties.jsonl'), '--json');
    ok('--log herhaalbaar', twee.status === 0 && JSON.parse(twee.stdout).logs.length === 2);
    const uit = join(map, 'boek.md');
    const eerste = draai('--dag', '20261010', '--map', map, '--uit', uit);
    const inhoud = existsSync(uit) ? lees(uit, 'utf8') : '';
    const tweede = draai('--dag', '20261010', '--map', map, '--uit', uit, '--json');
    ok('--uit: schrijft; een tweede keer exit 2 en niets overschreven', eerste.status === 0 && inhoud.startsWith('# Setboek') && tweede.status === 2 && /bestaat al/.test(tweede.stderr) && lees(uit, 'utf8') === inhoud);
    const naast = draai('--log', join(map, 'set-20261010-200000.acties.jsonl'), '--naast-log');
    const naastNog = draai('--log', join(map, 'set-20261010-200000.acties.jsonl'), '--naast-log');
    ok('--naast-log: set-<id>.setboek.md naast het log, niet over een bestaande heen', naast.status === 0 && existsSync(join(map, 'set-20261010-200000.setboek.md')) && naastNog.status === 2);
    const leeg = mkdtempSync(join(tmpdir(), 'setboek-leeg-'));
    const niets = draai('--dag', '20261010', '--map', leeg);
    ok('geen logs van die dag: exit 0, de melding op stdout en stderr', niets.status === 0 && niets.stdout.includes('geen log van die dag met acties') && /geen log/.test(niets.stderr));
    rmSync(leeg, { recursive: true, force: true });
    ok('zonder argumenten: exit 1 met gebruik', draai().status === 1 && /gebruik/.test(draai().stderr));
    ok('--dag in een ander formaat: exit 1', draai('--dag', '2026-10-10', '--map', map).status === 1);
    const proefPad = join(map, 'sessie.json');
    writeFileSync(proefPad, JSON.stringify({ begonnen: new Date(BEGIN).toISOString(), items: { x: { status: 'fout', notitie: 'kapot', tijd: new Date(BEGIN + 60000).toISOString() } } }));
    const proef = draai('--log', join(map, 'set-20261010-200000.acties.jsonl'), '--proef', proefPad);
    ok('--proef: de proefpunten in het setboek', proef.status === 0 && proef.stdout.includes('## Proefpunten') && proef.stdout.includes('**fout** · x'));
    const echt = join(map, 'checkout');
    mkdirSync(join(echt, 'opnames'), { recursive: true }); mkdirSync(join(echt, 'server'));
    writeFileSync(join(echt, 'server', 'index.js'), '');
    writeFileSync(join(echt, 'opnames', 'set-20261010-200000.acties.jsonl'), kort);
    const w = draai('--log', join(echt, 'opnames', 'set-20261010-200000.acties.jsonl'));
    ok('een log in de opnames/ van een checkout: waarschuwing "lees liever een kopie" (wel gelezen)', w.status === 0 && /kopie/.test(w.stderr) && w.stdout.includes('# Setboek'));
  } finally { rmSync(map, { recursive: true, force: true }); }
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
