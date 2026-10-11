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
  ok('REM = deck.js (REM_MIN, REM_MAX, REM_STANDAARD)', deck.includes(`export const REM_MIN = ${S.REM.min};`) && deck.includes(`export const REM_MAX = ${S.REM.max};`) && deck.includes(`export const REM_STANDAARD = ${S.REM.standaard};`));
  const inst = readFileSync(new URL('../src/engine/instrumenten/index.js', import.meta.url), 'utf8');
  const lijst = /export const INSTRUMENTEN = \[([^\]]*)\];/.exec(inst)?.[1] ?? '';
  ok('INSTRUMENT_AANTAL = INSTRUMENTEN.length (instrumenten/index.js)', lijst.split(',').filter((x) => x.trim()).length === S.INSTRUMENT_AANTAL, lijst);
  ok('MASTER_STANDAARD = engine.js (masterLevel)', engine.includes(`this.masterLevel = ${S.MASTER_STANDAARD};`));
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
  const geen = met([[50, 'track.1.stem.vocals', 0], [50, 'track.1.stem.inst', 0]]);
  ok('stem-acties op een nummer zonder stems (beginstand: stemKill null): de engine negeert ze, dus nog hoorbaar', geen.stukken.length === 1 && geen.stukken[0].tot === 200, JSON.stringify(geen.stukken));
  const zang = met([[50, 'track.1.stem.vocals.kill', true]], { stemKill: { vocals: false, inst: false } });
  ok('alleen de zang weg = nog hoorbaar', zang.stukken.length === 1 && zang.stukken[0].tot === 200);
  const vier = met([[50, 'track.1.stem.vocals', 0], [50, 'track.1.stem.drums.kill', true], [50, 'track.1.stem.bass.kill', true], [50, 'track.1.stem.other.hold', true], [150, 'track.1.stem.other.hold', false]],
    { stemKill: { vocals: false, inst: false, drums: false, bass: false, other: false } });
  ok('vier stems: zang 0 + drums, bas, overig dicht = stil, ook als inst open staat; loslaten = terug', vier.stukken.length === 2 && vier.stukken[0].tot === 50 && vier.stukken[1].van === 150, JSON.stringify(vier.stukken));
  const master = met([[50, 'mixer.master', 0], [150, 'mixer.master', 0.8]]);
  ok('master dicht = niets hoorbaar', master.stukken.length === 2 && master.stukken[0].tot === 50 && master.stukken[1].van === 150);
  const fade = met([[50, 'mixer.master', 0.1], [150, 'mixer.master', 0.5]]);
  ok('master 0,1 (−40,5 dB, faderGain) = stil; 0,5 (−22,5 dB) = hoorbaar: een fade-out met de master telt', fade.stukken.length === 2 && fade.stukken[0].tot === 50 && fade.stukken[1].van === 150, JSON.stringify(fade.stukken));
  const grens = met([[50, 'mixer.master', 0.3], [150, 'mixer.master', 0.35]]);
  ok('de grens ligt op master 1/3 (−30 dB): 0,3 stil, 0,35 hoorbaar', grens.stukken.length === 2 && grens.stukken[0].tot === 50 && grens.stukken[1].van === 150);
  const stemZacht = met([[50, 'track.1.stem.vocals', 0.02], [50, 'track.1.stem.inst', 0.02], [150, 'track.1.stem.inst', 0.05]], { stemKill: { vocals: false, inst: false } });
  ok('stems op 0,02 (−34 dB) = dicht, 0,05 (−26 dB) = open (grens 10^(−30/20) ≈ 0,03)', stemZacht.stukken.length === 2 && stemZacht.stukken[0].tot === 50 && stemZacht.stukken[1].van === 150, JSON.stringify(stemZacht.stukken));
  const kills = met([[50, 'track.1.kill.low', true], [50, 'track.1.kill.mid', true], [50, 'track.1.kill.high.hold', true], [150, 'track.1.kill.high.hold', false]]);
  ok('drie kills (twee schakelaars + één vastgehouden) = niet hoorbaar; loslaten = terug', kills.stukken.length === 2 && kills.stukken[0].tot === 50 && kills.stukken[1].van === 150);
  const knoppen = met([[50, 'track.1.low', 0], [50, 'track.1.mid', 0.02], [50, 'track.1.kill.high', true], [150, 'track.1.mid', 0.2]]);
  ok('EQ-knoppen onderaan (< 3% = kill, eqDb) tellen als kill: laag 0 + midden 0,02 + hoog-kill = stil; midden op 0,2 = terug',
    knoppen.stukken.length === 2 && knoppen.stukken[0].tot === 50 && knoppen.stukken[1].van === 150, JSON.stringify(knoppen.stukken));
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
    regels: [...druk(60, 'track.1.brake'), ...druk(60.5, 'track.1.brake'), ...druk(120, 'track.1.brake'), [200, 'mixer.xfader', 0]] }));
  ok('rem = stil, nog eens TIJDENS de rem (standaard 1 s) = los: één stuk 0–120', rem.stukken.length === 1 && rem.stukken[0].tot === 120, JSON.stringify(rem.stukken));
  const remNa = een(logTekst({ tracks: { 1: tr(1, 'Rem', { speelt: true }) }, waarden: { 'mixer.xfader': 0 },
    regels: [...druk(60, 'track.1.brake'), ...druk(62, 'track.1.brake'), [200, 'mixer.xfader', 0]] }));
  ok('na de rem (1 s) staat hij stil: een tweede druk 2 s later start niets (deck.rem op een stil deck)', remNa.stukken.length === 1 && remNa.stukken[0].tot === 60, JSON.stringify(remNa.stukken));
  const remLang = een(logTekst({ tracks: { 1: tr(1, 'Rem', { speelt: true }) }, waarden: { 'mixer.xfader': 0, 'track.1.brake.time': 1 },
    regels: [...druk(60, 'track.1.brake'), ...druk(62, 'track.1.brake'), [200, 'mixer.xfader', 0]] }));
  ok('brake.time 1 in de stand = 5 s remmen: 2 s later is nog tijdens de rem, dus los (één stuk 0–200)', remLang.stukken.length === 1 && remLang.stukken[0].tot === 200, JSON.stringify(remLang.stukken));
  const remKort = een(logTekst({ tracks: { 1: tr(1, 'Rem', { speelt: true }) }, waarden: { 'mixer.xfader': 0 },
    regels: [[10, 'track.1.brake.time', 0], ...druk(60, 'track.1.brake'), ...druk(60.5, 'track.1.brake'), [200, 'mixer.xfader', 0]] }));
  ok('brake.time 0 als actie = 0,1 s: 0,5 s later staat hij al stil', remKort.stukken.length === 1 && remKort.stukken[0].tot === 60, JSON.stringify(remKort.stukken));
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
  const klein = een(logTekst({ tracks: { 4: tr(4, 'Blijft') }, regels: [[10, 'track.4.inst.choose', 0.05], ...druk(20, 'track.4.play'), [200, 'mixer.master', 0.8]] }));
  ok('inst.choose 0,05: round(0,05 × 4) = 0 = "geen", het nummer blijft en speelt (20–200)', klein.stukken.length === 1 && klein.stukken[0].titel === 'Blijft' && klein.stukken[0].van === 20, JSON.stringify(klein.stukken));
  const net = een(logTekst({ tracks: { 4: tr(4, 'Weg') }, regels: [[10, 'track.4.inst.choose', 0.13], ...druk(20, 'track.4.play'), [200, 'mixer.master', 0.8]] }));
  ok('inst.choose 0,13: round(0,52) = 1 = het eerste instrument, het nummer is eraf', net.stukken.length === 0, JSON.stringify(net.stukken));
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
  const opnieuw = een(logTekst({ tracks: { 1: tr(1, 'Kort', { speelt: true, nummer: 'kort' }) }, waarden: { 'mixer.xfader': 0 }, regels: [...druk(200, 'track.1.play'), [400, 'mixer.xfader', 0]] }),
    { lengte: () => 180 });
  const o2 = opnieuw.stukken.map((s) => `${s.van}-${s.tot} [${S.positieInBron(s)}]`).join(' ');
  ok('play op het einde begint opnieuw op 0 (deck.play): 0–180 en 200–380, in de bron 0:00–3:00', o2 === '0-180 [0:00–3:00] 200-380 [0:00–3:00]', o2);
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
  const kaart = (regels) => een(logTekst({ tracks: { 1: tr(1, 'Lang', { speelt: true, secties }) }, waarden: { 'mixer.xfader': 0 }, regels: [...regels, [60, 'mixer.xfader', 0]] }));
  const vol = kaart([[30, 'track.1.section.next', true, { van: 30 }], [30.1, 'track.1.section.next', false]]);
  ok("section.next vanaf 30 (intro) springt naar 120 (drop): '0:00–0:30, 2:00–2:30'", S.positieInBron(vol.stukken[0]) === '0:00–0:30, 2:00–2:30', S.positieInBron(vol.stukken[0]));
  const terug = een(logTekst({ tracks: { 1: tr(1, 'Lang', { speelt: true, secties, positie: 150 }) }, waarden: { 'mixer.xfader': 0 },
    regels: [[30, 'track.1.section.prev', true, { van: 180 }], [60, 'mixer.xfader', 0]] }));
  ok("section.prev vanaf 180 (drop, `van` ijkt) springt naar 0 (intro): '2:30–3:00, 0:00–0:30'", S.positieInBron(terug.stukken[0]) === '2:30–3:00, 0:00–0:30', S.positieInBron(terug.stukken[0]));
  const lus = kaart([[30, 'track.1.section.2.loop', true, { van: 30 }]]);
  ok("section.2.loop vanaf 30: naar 120 en de aantekening loop", S.positieInBron(lus.stukken[0]) === '0:00–0:30, 2:00–2:30' && lus.stukken[0].loop, JSON.stringify(lus.stukken[0]));
  const erin = kaart([[30, 'track.1.section.1.loop', true, { van: 30 }]]);
  ok('section.1.loop terwijl hij al in sectie 1 speelt: geen sprong, wel loop', S.positieInBron(erin.stukken[0]) === '0:00–1:00' && erin.stukken[0].loop);
  const zonderKaart = een(logTekst({ tracks: { 1: tr(1, 'Geen kaart', { speelt: true }) }, waarden: { 'mixer.xfader': 0 }, regels: [[30, 'track.1.section.next', true], [60, 'mixer.xfader', 0]] }));
  ok("section.next zonder kaart: de engine doet niets (actions.js: !d.sectieKaart), dus geen sprong ('0:00–1:00')", S.positieInBron(zonderKaart.stukken[0]) === '0:00–1:00', S.positieInBron(zonderKaart.stukken[0]));
  const zonderKaartVan = een(logTekst({ tracks: { 1: tr(1, 'Geen kaart', { speelt: true, positie: 10 }) }, waarden: { 'mixer.xfader': 0 },
    regels: [[30, 'track.1.section.prev', true, { van: 50 }], [60, 'mixer.xfader', 0]] }));
  ok("section.prev zonder kaart met `van`: alleen ijken, geen sprong ('0:10–0:40, 0:50–1:20')", S.positieInBron(zonderKaartVan.stukken[0]) === '0:10–0:40, 0:50–1:20', S.positieInBron(zonderKaartVan.stukken[0]));
  const kaartGeenPos = een(logTekst({ tracks: { 1: tr(1, 'Lang', { speelt: true, secties, nummer: 's' }) }, waarden: { 'mixer.xfader': 0 },
    regels: [[10, 'track.1.seek', 0.5], [30, 'track.1.section.next', true], [60, 'mixer.xfader', 0]] }));
  ok("section.next met kaart maar zonder positie (seek zonder lengte): '0:00–0:10, ?'", S.positieInBron(kaartGeenPos.stukken[0]) === '0:00–0:10, ?', S.positieInBron(kaartGeenPos.stukken[0]));
  const lp = (id) => een(logTekst({ tracks: { 1: tr(1, 'Loop', { speelt: true }) }, waarden: { 'mixer.xfader': 0 }, regels: [[30, id, true], [60, 'mixer.xfader', 0]] }), { lengte: () => 1000 }).stukken[0].loop;
  ok('loop.exit, loop.in, loop.halve: geen loop; loop.out, loop.4, reloop, loop.toggle, beatloop.8: wel',
    !lp('track.1.loop.exit') && !lp('track.1.loop.in') && !lp('track.1.loop.halve') && lp('track.1.loop.out') && lp('track.1.loop.4') && lp('track.1.loop.reloop')
    && lp('track.1.loop.toggle') && lp('track.1.beatloop.8'));
  const toggle = een(logTekst({ tracks: { 1: tr(1, 'Lus', { speelt: true, positie: 150 }) }, waarden: { 'mixer.xfader': 0 },
    regels: [...druk(20, 'track.1.loop.toggle'), [400, 'mixer.xfader', 0]] }), { lengte: () => 180 });
  ok('loop.toggle (Clip Stop op de APC) bij het einde, met lengte 180: geen einde geschat, één stuk 0–400 met loop (engine: setBeatLoop/setLoop)',
    toggle.stukken.length === 1 && toggle.stukken[0].van === 0 && toggle.stukken[0].tot === 400 && toggle.stukken[0].loop, JSON.stringify(toggle.stukken));
  ok("met de lengte komt de positie in de bron niet voorbij het einde ('2:30–3:00', niet '2:30–9:10')", S.positieInBron(toggle.stukken[0]) === '2:30–3:00', S.positieInBron(toggle.stukken[0]));
  const GRID = { versie: 1, stukken: [{ van: 0.1, bpm: 124 }] };
  const ctl = een(logTekst({ tracks: { 1: { ...tr(1, 'Controle'), grid: GRID } }, waarden: { 'mixer.xfader': 0 },
    regels: [...druk(10, 'track.1.grid.controle'), ...druk(100, 'track.1.grid.controle'), [200, 'mixer.xfader', 0]] }));
  ok('grid.controle op een stil deck met grid start hem (actions.js: naar het eerste stuk en spelen): 10–200, (onzeker), positie ?; nog eens = alleen de controle uit',
    ctl.stukken.length === 1 && ctl.stukken[0].van === 10 && ctl.stukken[0].tot === 200 && ctl.stukken[0].onzeker && S.positieInBron(ctl.stukken[0]) === null, JSON.stringify(ctl.stukken));
  const geenGrid = een(logTekst({ tracks: { 1: tr(1, 'Geen grid') }, waarden: { 'mixer.xfader': 0 }, regels: [...druk(10, 'track.1.grid.controle'), [200, 'mixer.xfader', 0]] }));
  ok('grid.controle zonder grid (stand: grid null): alleen een melding in de engine, hij start niet', geenGrid.stukken.length === 0 && geenGrid.nietHoorbaar[0]?.titel === 'Geen grid', JSON.stringify(geenGrid.stukken));
  const laterGrid = een(logTekst({ waarden: { 'mixer.xfader': 0 },
    regels: [{ ...laad(5, 1, 'Later grid'), grid: null }, { t: 8, e: 'grid', track: 1, grid: GRID }, ...druk(10, 'track.1.grid.controle'), [200, 'mixer.xfader', 0]] }));
  ok("een laad zonder grid en daarna een gebeurtenis 'grid': grid.controle start hem wel (10–200)", laterGrid.stukken.length === 1 && laterGrid.stukken[0].van === 10, JSON.stringify(laterGrid.stukken));
  const oudLog = een(logTekst({ waarden: { 'mixer.xfader': 0 },
    regels: [(({ grid, ...x }) => x)(laad(5, 1, 'Oud')), ...druk(10, 'track.1.grid.controle'), [200, 'mixer.xfader', 0]] }));
  ok('een laad zonder grid-veld (grid onbekend): zoals vroeger, starten en "(onzeker)"', oudLog.stukken.length === 1 && oudLog.stukken[0].onzeker, JSON.stringify(oudLog.stukken));
  const check = (regels, o = {}) => een(logTekst({ tracks: { 1: { ...tr(1, 'Check', { speelt: true }), grid: o.grid === undefined ? GRID : o.grid } }, waarden: { 'mixer.xfader': 0 }, regels: [...regels, [60, 'mixer.xfader', 0]] }));
  ok("grid.check.next (actions.js naarStuk: een seek): positie '?' vanaf daar ('0:00–0:30, ?')", S.positieInBron(check(druk(30, 'track.1.grid.check.next')).stukken[0]) === '0:00–0:30, ?');
  ok('grid.check.prev zonder grid: niets (de engine: !d.grid)', S.positieInBron(check(druk(30, 'track.1.grid.check.prev'), { grid: null }).stukken[0]) === '0:00–1:00');
  ok('grid.ok buiten de controle: alleen goedkeuren, geen sprong', S.positieInBron(check(druk(30, 'track.1.grid.ok')).stukken[0]) === '0:00–1:00');
  ok("grid.ok in de controle (kan naar de volgende plek springen): positie '?'",
    S.positieInBron(check([...druk(20, 'track.1.grid.controle'), ...druk(30, 'track.1.grid.ok')]).stukken[0]) === '0:00–0:30, ?');
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
  ok('het lege log onder overgeslagen (0 acties, niets speelde)', r.overgeslagen.length === 1 && r.overgeslagen[0].id === '20261010-202000' && r.overgeslagen[0].reden === '0 acties, niets speelde');
  ok('een gat van 90 s gemeld (opname tot 20:15:00, los log vanaf 20:16:30); los → opname geen gat', r.gaten.length === 1 && rond(r.gaten[0].s) === 90 && r.gaten[0].voor === '20261010-201500', JSON.stringify(r.gaten));
  ok('de opname is herkend (kop.opname)', r.logs[1].opname === '20261010-201000' && r.logs[0].opname === null);
  const boek = S.setboek(bestanden);
  const lijst = boek.stukken.map((s) => `${s.titel}@${S.kloktijd(s.klokVan)}-${S.kloktijd(s.klokTot)}`).join(' ');
  ok('één tracklist op de klok: Een 20:00–20:15 (over de grens los log → opname gelijmd), Twee 20:16:30–20:18:30', lijst === 'Een@20:00:00-20:15:00 Twee@20:16:30-20:18:30', lijst);
  ok('het gelijmde stuk: beide logs, in de bron 0:00–15:00 in één deel', boek.stukken[0].log.join() === '20261010-200000,20261010-201000' && S.positieInBron(boek.stukken[0]) === '0:00–15:00', JSON.stringify(boek.stukken[0]));
  ok('avondtijden lopen door over de logs (Twee begint op 16:30)', boek.stukken[1].avondVan === 990);
  const md = S.naarMarkdown(boek);
  ok('Markdown: kop, logs, het gat, overgeslagen, tracklist, verslagblok, Buma/Stemra',
    md.startsWith('# Setboek 2026-10-10') && md.includes('gat van 1:30: log opnieuw begonnen 20:16:30 (herladen?)') && md.includes('overgeslagen: 20261010-202000 (0 acties, niets speelde)')
    && md.includes('| 2 | 16:30–18:30 | 20:16:30 | T2 | Twee | library |') && md.includes('## Wat werkte') && md.includes('## Buma/Stemra'), md);
  const json = JSON.parse(S.naarJson(boek));
  ok('JSON: zonder de ruwe logs en zonder interne sleutels, met dezelfde stukken', !('log' in json.logs[0]) && json.stukken.length === 2 && json.melding === null && !('sleutels' in json.stukken[0]));
  const niets = S.setboek([{ bestand: 'set-20261010-202000.acties.jsonl', tekst: leeg }]);
  ok('alleen lege logs: melding "geen log van die dag met acties", geen lege tracklist',
    niets.melding === 'geen log van die dag met acties' && niets.stukken.length === 0 && S.naarMarkdown(niets).includes('geen log van die dag met acties') && !S.naarMarkdown(niets).includes('## Tracklist'));
  ok('nul logs: dezelfde melding', S.setboek([]).melding === 'geen log van die dag met acties');
}

console.log('\n10b. een nummer over de grens van twee logs (opname aan/uit)');
{
  // Los log: A speelt; B wordt op 4:45 geladen en gestart (thru, track 3). Op 5:00 start de opname:
  // het losse log sluit, de opname begint een nieuw log met B in de beginstand; 15 s later fader dicht.
  const los = logTekst({ tracks: { 1: tr(1, 'A', { speelt: true }) }, waarden: { 'mixer.xfader': 0 }, regels: [laad(285, 3, 'B', 'b'), ...druk(285.5, 'track.3.play')], eind: 300 });
  const opn = logTekst({ begon: BEGIN + 300e3, opname: '20261010-200500', waarden: { 'mixer.xfader': 0 },
    tracks: { 1: tr(1, 'A', { speelt: true, positie: 300 }), 3: tr(3, 'B', { speelt: true, positie: 14.5, nummer: 'b' }), 4: tr(4, 'C', { nummer: 'c' }) },
    regels: [[15, 'track.3.fader', 0], [200, 'mixer.xfader', 0]], eind: 200 });
  const los2 = logTekst({ begon: BEGIN + 500e3, tracks: { 4: tr(4, 'C', { nummer: 'c' }) }, regels: [[30, 'track.1.fader', 1]], eind: 30 });
  const boek = S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: los }, { bestand: 'set-20261010-200500.acties.jsonl', tekst: opn },
    { bestand: 'set-20261010-200820.acties.jsonl', tekst: los2 }]);
  const lijst = boek.stukken.map((s) => `${s.titel}@${S.kloktijd(s.klokVan)}-${S.kloktijd(s.klokTot)}`).join(' ');
  ok('A één keer (20:00:00–20:08:20); B 14,5 s + 15 s = 29,5 s: in de tracklist (20:04:45–20:05:15)', lijst === 'A@20:00:00-20:08:20 B@20:04:45-20:05:15', lijst);
  const b = boek.stukken.find((s) => s.titel === 'B');
  ok('B in de bron 0:00–0:30, uit twee logs', b && S.positieInBron(b) === '0:00–0:30' && b.log.length === 2, JSON.stringify(b));
  ok('B staat niet onder "geladen maar niet hoorbaar"', !boek.nietHoorbaar.some((x) => x.titel === 'B'), JSON.stringify(boek.nietHoorbaar));
  ok('C (geladen, nooit gespeeld, in twee beginstanden) staat er één keer', boek.nietHoorbaar.filter((x) => x.titel === 'C').length === 1, JSON.stringify(boek.nietHoorbaar));
  const ver = S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: los },
    { bestand: 'set-20261010-201000.acties.jsonl', tekst: logTekst({ begon: BEGIN + 600e3, waarden: { 'mixer.xfader': 0 }, tracks: { 1: tr(1, 'A', { speelt: true, positie: 600 }) }, regels: [[60, 'mixer.xfader', 0]] }) }]);
  ok('een gat van 5 min tussen de logs (herladen): twee stukken A, niet gelijmd', ver.stukken.filter((s) => s.titel === 'A').length === 2, JSON.stringify(ver.stukken.map((s) => s.klokVan)));
  const ander = S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: los },
    { bestand: 'set-20261010-200500.acties.jsonl', tekst: logTekst({ begon: BEGIN + 300e3, waarden: { 'mixer.xfader': 0 }, tracks: { 1: tr(1, 'Ander', { speelt: true, nummer: 'x' }) }, regels: [[60, 'mixer.xfader', 0]] }) }]);
  ok('een ander nummer op dezelfde track aan het begin van het volgende log: niet gelijmd', ander.stukken.map((s) => s.titel).join() === 'A,Ander', ander.stukken.map((s) => s.titel).join());
}

console.log('\n10c. een log zonder acties waarin muziek speelt; de beginstand net na t = 0');
{
  // Los log (acties) → een opname van 3 min waarin Clay niets aanraakt (0 acties, A speelt door) → los log.
  const los1 = logTekst({ tracks: { 1: tr(1, 'A', { speelt: true }) }, waarden: { 'mixer.xfader': 0 }, regels: [[100, 'track.2.fader', 1]], eind: 300 });
  const stil = logTekst({ begon: BEGIN + 300e3, opname: '20261010-200500', tracks: { 1: tr(1, 'A', { speelt: true, positie: 300 }) }, waarden: { 'mixer.xfader': 0 }, regels: [], eind: 180 });
  const los2 = logTekst({ begon: BEGIN + 480e3, tracks: { 1: tr(1, 'A', { speelt: true, positie: 480 }) }, waarden: { 'mixer.xfader': 0 }, regels: [[120, 'track.2.fader', 1]], eind: 120 });
  const boek = S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: los1 }, { bestand: 'set-20261010-200500.acties.jsonl', tekst: stil },
    { bestand: 'set-20261010-200800.acties.jsonl', tekst: los2 }]);
  const a = boek.stukken.filter((s) => s.titel === 'A');
  ok('A één stuk over drie logs (20:00:00–20:10:00), ook door de opname met 0 acties; in de bron 0:00–10:00',
    a.length === 1 && S.kloktijd(a[0].klokVan) === '20:00:00' && S.kloktijd(a[0].klokTot) === '20:10:00' && a[0].log.length === 3 && S.positieInBron(a[0]) === '0:00–10:00', JSON.stringify(boek.stukken));
  ok('de opname met 0 acties staat bij de logs, niet onder overgeslagen', boek.logs.length === 3 && boek.overgeslagen.length === 0, JSON.stringify(boek.overgeslagen));
  // Na ■: het losse log met 0 acties waarin B uitspeelt tot het eind van dat log.
  const met = logTekst({ tracks: { 2: tr(2, 'B', { speelt: true }) }, waarden: { 'mixer.xfader': 1 }, regels: [[60, 'track.1.fader', 1]], eind: 120 });
  const na = logTekst({ begon: BEGIN + 120e3, tracks: { 2: tr(2, 'B', { speelt: true, positie: 120 }) }, waarden: { 'mixer.xfader': 1 }, regels: [], eind: 200 });
  const b = S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: met }, { bestand: 'set-20261010-200200.acties.jsonl', tekst: na }]);
  ok('een laatste log met 0 acties waarin B speelt: B loopt tot het eind van dat log (20:05:20)', b.stukken.length === 1 && S.kloktijd(b.stukken[0].klokTot) === '20:05:20', JSON.stringify(b.stukken));
  const laadOnly = S.rijgLogs([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: logTekst({ regels: [laad(10, 1, 'Alleen geladen')] }) }]);
  ok('een log met alleen een laad (0 acties) telt ook mee', laadOnly.logs.length === 1 && laadOnly.overgeslagen.length === 0);
  // De beginstand staat op klok() − t0: de audioklok kan binnen één taak 2,67 ms verder staan.
  const L1 = logTekst({ tracks: { 1: tr(1, 'A', { speelt: true, nummer: 'a' }) }, regels: [[290, 'track.1.fader', 1]], eind: 300 });
  const L2 = logTekst({ begon: BEGIN + 300e3, tracks: { 1: tr(1, 'A', { speelt: true, nummer: 'a', positie: 300 }) }, regels: [[100, 'track.1.fader', 1]], eind: 100 })
    .replace('{"t":0,"e":"stand"', '{"t":0.002667,"e":"stand"');
  const r4 = S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: L1 }, { bestand: 'set-20261010-200500.acties.jsonl', tekst: L2 }]);
  ok('de tweede beginstand op t = 0,002667: nog steeds één stuk A (0–400 s), niet in tweeën', L2.includes('{"t":0.002667,"e":"stand"') && r4.stukken.length === 1
    && Math.round((r4.stukken[0].klokTot - r4.stukken[0].klokVan) / 1000) === 400 && r4.nietHoorbaar.length === 0, JSON.stringify(r4.stukken.map((s) => [s.klokVan - BEGIN, s.klokTot - BEGIN])));
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
  ok('Markdown: proefpunten met de kloktijd, en het eerste vinkje als grens (eerlijk benoemd)', md.includes('**fout** · apc-fader · rond 20:02:00 · "fader 3 sprong" · toen hoorbaar: T1 Eerste')
    && md.includes('Eerste proefpunt afgevinkt 20:05:00 (`begonnen` in de sessie: het eerste vinkje, geen startknop). Daarvóór 1 stuk(ken) (vrij spelen?), daarna 0 (de speellijst?).'), md);
  const oud = { begonnen: '2026-10-06T19:14:00.000Z', items: { 'oud-punt': { status: 'fout', notitie: 'fader 3 sprong (6 okt)', tijd: '2026-10-06T19:20:00.000Z' } } };
  const boekOud = S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst }], { proef: oud });
  const mdOud = S.naarMarkdown(boekOud);
  ok('een sessie van 6 okt (niet gearchiveerd): geen splitsing, geen punt op de tijdlijn, wel "1 punt van eerder (6 okt)"',
    !/Eerste proefpunt|Speellijst begonnen/.test(mdOud) && !mdOud.includes('oud-punt') && mdOud.includes('1 punt van eerder (6 okt), niet getoond.') && mdOud.includes('nieuwe ronde')
    && boekOud.stukken.every((s) => s.deel === undefined) && mdOud.includes('Geen punt van deze avond met "fout" of een notitie.'), mdOud);
  const nacht = { begonnen: new Date(BEGIN + 4 * 3600e3).toISOString(), items: { laat: { status: 'fout', notitie: '', tijd: new Date(BEGIN + 4.5 * 3600e3).toISOString() } } };
  const lang = logTekst({ tracks: { 1: tr(1, 'Eerste', { speelt: true }) }, waarden: { 'mixer.xfader': 0 }, regels: [[4 * 3600, 'mixer.xfader', 0]] });
  const mdNacht = S.naarMarkdown(S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: lang }], { proef: nacht }));
  ok('een punt na middernacht (binnen de avond): met de datum ervoor', mdNacht.includes('**fout** · laat · rond 11 okt 00:30:00'), mdNacht.split('\n').filter((l) => /laat|Eerste proefpunt/.test(l)).join(' / '));
}

console.log('\nBuma/Stemra: een lange mix');
{
  const mix = logTekst({ tracks: { 1: tr(1, 'Deep House Mix 2024', { speelt: true, nummer: 'mix' }) }, waarden: { 'mixer.xfader': 0 }, regels: [[480, 'mixer.xfader', 0]] });
  const metDb = S.naarMarkdown(S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: mix }], { lengte: (id) => (id === 'mix' ? 7200 : null) }));
  ok('lengte 7200 en gespeeld 0:00–8:00: "titel onbekend: deel van …" (de lengte telt, niet alleen de positie)', metDb.includes('- titel onbekend: deel van "Deep House Mix 2024" 0:00–8:00'), metDb.split('## Buma')[1]);
  const zonder = S.naarMarkdown(S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: mix }]));
  ok('zonder --db: de titel, met de waarschuwing dat een lange mix zo niet te zien is', zonder.includes('- Deep House Mix 2024\n') && zonder.includes('Zonder --db: een lange mix'), zonder.split('## Buma')[1]);
  const vraag = logTekst({ tracks: { 1: tr(1, 'Waar', { speelt: true, nummer: 'w' }) }, waarden: { 'mixer.xfader': 0 }, regels: [[30, 'track.1.seek', 0.5], [300, 'mixer.xfader', 0]] });
  const onbekend = S.naarMarkdown(S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: vraag }]));
  ok('positie ergens "?" (seek zonder lengte) en geen lengte: "(lengte onbekend)"', onbekend.includes('- Waar (lengte onbekend)\n'), onbekend.split('## Buma')[1]);
  const ver = logTekst({ tracks: { 1: tr(1, 'Ver', { speelt: true, nummer: 'v', positie: 1500 }) }, waarden: { 'mixer.xfader': 0 }, regels: [[60, 'mixer.xfader', 0]] });
  ok('positie voorbij 20 min (zonder lengte): ook "titel onbekend"', S.naarMarkdown(S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: ver }])).includes('- titel onbekend: deel van "Ver" 25:00–26:00'));
  // Een loop aan het eind van een nummer van 5:30, 20 min vastgehouden: het model telt door, de speelkop niet.
  const lus = logTekst({ tracks: { 1: tr(1, 'Kort in een loop', { speelt: true, nummer: 'k', positie: 300 }) }, waarden: { 'mixer.xfader': 0 },
    regels: [...druk(10, 'track.1.loop.toggle'), [1300, 'mixer.xfader', 0]] });
  const lusDb = S.naarMarkdown(S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: lus }], { lengte: () => 330 }));
  const lusZonder = S.naarMarkdown(S.setboek([{ bestand: 'set-20261010-200000.acties.jsonl', tekst: lus }]));
  ok('een loop van 20 min op een nummer van 5:30: met --db (lengte 330) de gewone titel, niet "titel onbekend"', lusDb.includes('- Kort in een loop\n') && !lusDb.includes('titel onbekend'), lusDb.split('## Buma')[1]);
  ok('zonder --db: ook de gewone titel (een positie na een loop zegt niets over een mix)', lusZonder.includes('- Kort in een loop\n') && !lusZonder.includes('titel onbekend'), lusZonder.split('## Buma')[1]);
}

console.log('\n--vanaf (amsterdamMs)');
{
  ok('amsterdamMs zomer: 20261010 17:00 = 15:00 UTC', S.amsterdamMs('20261010', '17:00') === Date.parse('2026-10-10T15:00:00Z'));
  ok('amsterdamMs winter: 20261210 17:00 = 16:00 UTC', S.amsterdamMs('20261210', '17:00') === Date.parse('2026-12-10T16:00:00Z'));
  ok('amsterdamMs: onzin = null', S.amsterdamMs('2026-10-10', '17:00') === null && S.amsterdamMs('20261010', '17u') === null);
  const middag = logTekst({ begon: BEGIN - 6 * 3600e3, tracks: { 1: tr(1, 'Opbouw', { speelt: true }) }, regels: [[60, 'mixer.xfader', 0.5]] });
  const avond = logTekst({ tracks: { 1: tr(1, 'Avond', { speelt: true }) }, regels: [[60, 'mixer.xfader', 0.5]] });
  const b = S.setboek([{ bestand: 'set-20261010-140000.acties.jsonl', tekst: middag }, { bestand: 'set-20261010-200000.acties.jsonl', tekst: avond }], { vanafMs: S.amsterdamMs('20261010', '17:00') });
  ok('vanafMs: het middaglog (14:00–14:01) onder overgeslagen ("eindigde vóór 17:00"), alleen de avond in de tracklist',
    b.logs.length === 1 && b.stukken.map((s) => s.titel).join() === 'Avond' && b.overgeslagen[0]?.reden === 'eindigde vóór 17:00 (--vanaf)' && b.gaten.length === 0, JSON.stringify(b.overgeslagen));
  // Het vinkje "altijd": één log van de opbouw (15:00) tot na de set (20:15). --vanaf knipt op de klok.
  const H = 3600, V = S.amsterdamMs('20261010', '17:00');
  const lang = logTekst({ begon: BEGIN - 5 * H * 1000, eind: 5 * H + 900, regels: [
    laad(60, 3, 'Soundcheck'), ...druk(61, 'track.3.play'), ...druk(300, 'track.3.play'),
    laad(6599, 4, 'Overloop'), ...druk(6600, 'track.4.play'), ...druk(7740, 'track.4.play'),           // 16:50–17:09
    laad(5 * H, 1, 'Opener'), ...druk(5 * H + 1, 'track.1.play'), laad(5 * H + 400, 2, 'Tweede'), ...druk(5 * H + 401, 'track.2.play')] });
  const heel = S.setboek([{ bestand: 'set-20261010-150000.acties.jsonl', tekst: lang }]);
  ok('één log 15:00–20:15 zonder --vanaf: Soundcheck, Overloop, Opener, Tweede', heel.stukken.map((s) => s.titel).join() === 'Soundcheck,Overloop,Opener,Tweede', heel.stukken.map((s) => s.titel).join());
  const v = S.setboek([{ bestand: 'set-20261010-150000.acties.jsonl', tekst: lang }], { vanafMs: V });
  const opener = v.stukken.find((s) => s.titel === 'Opener'), over = v.stukken.find((s) => s.titel === 'Overloop');
  ok('--vanaf 17:00 binnen één log: Overloop (vanaf 17:00), Opener, Tweede; het log telt mee, geen melding',
    v.stukken.map((s) => s.titel).join() === 'Overloop,Opener,Tweede' && v.logs.length === 1 && v.overgeslagen.length === 0 && v.melding === null, JSON.stringify([v.melding, v.stukken.map((s) => s.titel)]));
  ok('de kolom "avond" telt vanaf 17:00: Opener op 3:00:01', opener && S.duurTekst(opener.avondVan) === '3:00:01', opener && S.duurTekst(opener.avondVan));
  ok('Soundcheck nergens: niet in de tracklist, niet onder "geladen maar niet hoorbaar", niet in Gebruik (6 acties na 17:00: Overloop stop, Opener, Tweede; 2 laads)',
    !v.nietHoorbaar.some((x) => x.titel === 'Soundcheck') && v.gebruik.acties === 6 && v.gebruik.laads === 2 && heel.gebruik.acties === 12 && heel.gebruik.laads === 4, JSON.stringify(v.gebruik));
  ok('een stuk dat over 17:00 heen loopt (16:50–17:09): in de tracklist vanaf 17:00, met de positie in de bron van dat moment (10:00–19:00)',
    over && over.klokVan === V && S.kloktijd(over.klokTot) === '17:09:00' && over.avondVan === 0 && S.positieInBron(over) === '10:00–19:00' && over.geknipt && !over.onzeker, JSON.stringify(over));
  const md = S.naarMarkdown(v);
  ok('Markdown: de regel over --vanaf bij de logs en "klonk al vóór 17:00" bij Overloop',
    md.includes('- --vanaf 17:00: alles daarvóór weggelaten, ook binnen een log; de kolom "avond" telt vanaf 17:00') && md.includes('| 1 | 0:00–9:00 | 17:00:00 | T4 | Overloop | library | 10:00–19:00 | klonk al vóór 17:00 |')
    && md.includes('| 2 | 3:00:01–3:15:00 | 20:00:01 | T1 | Opener |'), md.split('## Geladen')[0]);
  const vroeg = S.setboek([{ bestand: 'set-20261010-140000.acties.jsonl', tekst: middag }], { vanafMs: V });
  ok('alle logs eindigden vóór --vanaf: een eigen melding en "draai zonder --vanaf", niet "liep er een log?"',
    vroeg.melding === 'alle logs van die dag eindigden vóór 17:00 (--vanaf)' && S.naarMarkdown(vroeg).includes('Draai zonder --vanaf') && !S.naarMarkdown(vroeg).includes('Liep er een log'), S.naarMarkdown(vroeg));
}

console.log('\nde CLI (tools/setboek/setboek.mjs)');
{
  const { mkdtempSync, writeFileSync, readFileSync: lees, existsSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = fileURLToPath(new URL('../tools/setboek/setboek.mjs', import.meta.url));   // niet .pathname: de echte checkout heeft spaties
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
    const middag = logTekst({ begon: BEGIN - 6 * 3600e3, tracks: { 1: tr(1, 'Opbouw', { speelt: true }) }, regels: [[60, 'mixer.xfader', 0.5]] });
    writeFileSync(join(map, 'set-20261010-140000.acties.jsonl'), middag);
    const zonderVanaf = draai('--dag', '20261010', '--map', map);
    const vanaf = draai('--dag', '20261010', '--map', map, '--vanaf', '17:00');
    ok('--vanaf 17:00: het log van 14:00 eruit (overgeslagen), dat van 20:00 en de nacht erin',
      zonderVanaf.stdout.includes('Opbouw') && vanaf.status === 0 && !vanaf.stdout.includes('| Opbouw |') && vanaf.stdout.includes('20261010-140000 (eindigde vóór 17:00 (--vanaf))') && vanaf.stdout.includes('Na middernacht'), vanaf.stderr + vanaf.stdout.slice(0, 600));
    ok('--vanaf zonder --dag, of in een ander formaat: exit 1', draai('--log', join(map, 'set-20261010-200000.acties.jsonl'), '--vanaf', '17:00').status === 1
      && draai('--dag', '20261010', '--map', map, '--vanaf', '17u').status === 1);
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
