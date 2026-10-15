// De benchmark van het automatische beatgrid als test (docs/BEATGRID.md §12):
// synthetische nummers met bekende tellen en "1"-en (tools/beatmeting/synth/),
// de tellen zoals Beat This! ze geeft (met zijn soorten fouten), en de oude
// analyse op een paar nummers. Elke check hieronder faalt op de code van vóór
// 14 okt (studio/afmaken 7debab6), behalve de controles dat schone gevallen
// gelijk blijven. Draai met: node test/beatbench.test.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { gridUitTellen, meetGrid, vergelijk, oordeelStuk, dansFactor, dansOctaven, maatMening, DANS_MIN, DANS_MAX, VERSIE } = await import('../src/engine/tellen.js');
const { Beatgrid, ZEKER_VANAF } = await import('../src/engine/beatgrid.js');
const { NAMEN, nummer, wavVan } = await import('../tools/beatmeting/synth/nummers.mjs');
const { nepTellen, VARIANTEN } = await import('../tools/beatmeting/synth/nep-beatthis.mjs');
const { scoor } = await import('../tools/beatmeting/synth/scoor.mjs');
const { blokDrift, kantelOpPieken, DRIFT_TEL } = await import('../server/detect.js');
const analyze = await import('../server/analyze.js');

const fails = [];
const ok = (naam, cond, info = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (cond || !info ? '' : `  (${info})`)); };
const pct = (x) => `${Math.round(x * 100)}%`;

// ---- de tellen-route op alle nummers × alle soorten fouten --------------------
// Zoals de server (pasTellenToe): gridUitTellen, dan vergelijk met een tweede mening. Hier drie:
//   geen    geen tweede mening (de oude analyse mislukte, of zegt hier niets);
//   goed    een die klopt: het grid uit de ECHTE tellen en "1"-en van het nummer;
//   tegen   dezelfde, een halve tel opgeschoven (een tweede mening die de offbeat hoort).
// De echte oude analyse op een paar nummers staat verderop (en in bench.mjs op alle).
const ZES = ['bt', 'ruis', 'half', 'dubbel', 'wissel', 'eenfout'];
const tweede = {};
for (const naam of NAMEN) {
  const n = nummer(naam, { audio: false });
  if (!n.tellen.length) { tweede[naam] = { geen: null, goed: null, tegen: null }; continue; }
  const goed = gridUitTellen(n.tellen, n.eenen, { duur: n.duur });
  const tegen = structuredClone(goed);
  for (const st of tegen.stukken) { const L = 60 / st.bpm; st.anker += L / 2; if (Number.isFinite(st.maat)) st.maat += L / 2; }
  tweede[naam] = { geen: null, goed: new Beatgrid(goed), tegen: new Beatgrid(tegen) };
}
const uit = {}, alleMeningen = [];
for (const naam of NAMEN) {
  const n = nummer(naam, { audio: false });
  for (const v of VARIANTEN) {
    const t = nepTellen(n, v);
    for (const [wie, ander] of Object.entries(tweede[naam])) {
      const kaart = vergelijk(gridUitTellen(t.beats, t.downbeats, { duur: n.duur }), t.beats, ander);
      const r = { s: scoor(kaart, n), n, kaart };
      alleMeningen.push([`${naam}/${v}/${wie}`, r]);
      if (wie === 'goed') uit[`${naam}/${v}`] = r;
    }
  }
}
// De ene combinatie die niets kan zien: Beat This! telt dubbel, zijn downbeats liggen op de "en", EN de
// tweede mening hoort ook de offbeat. Twee bronnen die elkaar bevestigen in dezelfde fout; de tellen zelf
// zijn symmetrisch. Die staat apart (een bekende grens, docs/BEATGRID.md §12 "Wat niet opgelost is"), al het andere moet schoon.
const blind = (k) => k.includes('/dubbel-laat/tegen');
const vals = alleMeningen.filter(([k, x]) => x.s.valsZeker && !blind(k)).map(([k, x]) => `${k} ${pct(x.s.vals)}`);
ok(`${alleMeningen.length - alleMeningen.filter(([k]) => blind(k)).length} gevallen (${NAMEN.length} nummers × ${VARIANTEN.length} soorten fouten × 3 tweede meningen, `
  + 'zonder de blinde combinatie): nergens vals zeker', vals.length === 0, vals.join(', '));
const zes = Object.entries(uit).filter(([k]) => ZES.includes(k.split('/')[1])).map(([, x]) => x.s);
const gem = (k) => { const v = zes.map((s) => s[k]).filter((x) => x != null); return v.reduce((a, b) => a + b, 0) / v.length; };
ok(`de ${zes.length} gewone gevallen (met een tweede mening die klopt): gemiddeld zeker op ≥ 95% van de duidelijke tellen`, gem('dekking') >= 0.95, pct(gem('dekking')));
ok('… gemiddeld ≤ 2% van de tellen > 0,1 tel naast', gem('naast') <= 0.02, pct(gem('naast')));
ok('… gemiddeld ≥ 95% op het DJ-tempo', gem('dj') >= 0.95, pct(gem('dj')));

// HALVEREN (review 14 okt): telt Beat This! het dubbele tempo, dan zeggen de tellen niet welke
// van de twee de tel is. Zeker alleen als downbeats en tweede mening het eens zijn.
{
  const gehalveerd = alleMeningen.filter(([k, x]) => k.endsWith('/geen') && x.kaart.stukken.some((st) => st.halvering));
  const zekerZonder = gehalveerd.filter(([, x]) => x.kaart.stukken.some((st) => st.halvering && st.zekerheid >= ZEKER_VANAF));
  ok(`gehalveerd zonder tweede mening (${gehalveerd.length} gevallen): nooit zeker, twijfel 'tel'`, gehalveerd.length >= 10 && zekerZonder.length === 0
    && gehalveerd.every(([, x]) => x.kaart.stukken.filter((st) => st.halvering).every((st) => st.twijfel === 'tel' || st.twijfel === 'drift' || st.twijfel === 'rubato')),
  zekerZonder.map(([k]) => k).join(', '));
  // Boven 300 (het netwerk telt de achtsten, halveren MOET): downbeats op de "en" tegen een tweede mening die klopt = oneens.
  const laat = alleMeningen.filter(([k]) => /\/dubbel-laat\/goed$/.test(k) && ['vast-160', 'jungle-172', 'vast-178', 'vast-186'].includes(k.split('/')[0]));
  ok('boven 300: downbeats op de "en" (dubbel-laat) tegen een tweede mening die klopt: oneens, niet zeker', laat.length === 4
    && laat.every(([, x]) => x.s.zekerSec === 0 && x.kaart.stukken.some((st) => st.twijfel === 'oneens')), laat.map(([k, x]) => `${k} ${x.s.zekerSec} s`).join(', '));
  // Onder 300 halveert alleen een BEVESTIGING (review ronde 1): zijn downbeats en tweede mening het oneens over de tel,
  // dan blijft het tempo van het netwerk (zoals vóór 14 okt): elke echte tel is een lijn, dus niet vals; het octaaf
  // staat erbij. De prijs: de "1" kan op de "en" staan (hieronder geteld, niet geëist).
  const onder = alleMeningen.filter(([k]) => /\/(dubbel-laat\/goed|dubbel\/tegen)$/.test(k) && ['house-124', 'vast-140', 'wals-150'].includes(k.split('/')[0]));
  ok('onder 300, downbeats en tweede mening oneens over de tel: niet gehalveerd, het octaaf genoteerd, niets vals zeker', onder.length === 6
    && onder.every(([, x]) => !x.s.valsZeker && x.kaart.stukken.filter((st) => st.zekerheid >= ZEKER_VANAF).every((st) => st.bpm > 200 && st.octaaf === 0.5)),
  onder.map(([k, x]) => `${k} ${x.kaart.stukken[0].bpm} "1" ${pct(x.s.een ?? 0)}`).join(', '));
  const kaal = ['vast-160', 'vast-178', 'jungle-172'].map((naam) => [naam, alleMeningen.find(([k]) => k === `${naam}/dubbel-kaal/goed`)[1]]);
  ok('boven 300 bpm zonder downbeats, het netwerk begint op de "en": de tweede mening schuift het grid op de tel, maar het blijft onzeker',
    kaal.every(([, x]) => x.s.zekerSec === 0 && x.s.naast <= 0.02 && x.kaart.stukken[0].twijfel === 'tel'), kaal.map(([k, x]) => `${k} naast ${pct(x.s.naast)}`).join(', '));
  const tegen = ['vast-160', 'jungle-172', 'vast-186'].map((naam) => [naam, alleMeningen.find(([k]) => k === `${naam}/dubbel/tegen`)[1]]);
  ok('boven 300: downbeats goed, de tweede mening hoort de offbeat: oneens, niet zeker', tegen.every(([, x]) => x.s.zekerSec === 0), tegen.map(([k, x]) => `${k} ${x.s.zekerSec} s`).join(', '));
}

// Het DJ-tempo: wat Beat This! als halve of dubbele tel hoort, komt in het dansbereik.
for (const [k, wat] of [['jungle-172/bt', 'jungle: Beat This! hoort 86, het grid zegt 172'],
  ['halftime-140/bt', 'half-time: 70 wordt 140'], ['indie-154/bt', 'band zonder klik op 154 (zoals Ciel): 77 wordt 154'],
  ['house-124/half', 'house, het halve tempo gehoord: 62 wordt 124'], ['house-124/dubbel', 'house, het dubbele gehoord: 248 wordt 124'],
  ['reggae-75/bt', 'reggae 75 telt een DJ als 150 (een keuze, zie DANS_MIN)'], ['vast-72/bt', 'downtempo 72 wordt 144']]) {
  ok(`DJ-tempo: ${wat}`, uit[k].s.dj >= 0.95 && uit[k].s.dekking >= 0.9, `dj ${pct(uit[k].s.dj)}, dekking ${pct(uit[k].s.dekking)}`);
}
// Sneller dan 300 bpm (Beat This! telt de achtsten) was "geen puls": het hele grid weg.
// Met downbeats en een tweede mening die de fase bevestigt. De band zonder klik (indie) heeft korte stukken
// met minder dan vier eigen downbeats: daar is maar één bron voor de fase, en die blijven onzeker ('tel').
for (const [k, min] of [['jungle-172/dubbel', 0.95], ['vast-178/dubbel', 0.95], ['indie-154/dubbel', 0.85]]) {
  ok(`${k}: boven 300 bpm toch een grid, zeker (≥ ${pct(min)}) en op het DJ-tempo`, uit[k].s.dekking >= min && uit[k].s.dj >= 0.95, `dekking ${pct(uit[k].s.dekking)}, dj ${pct(uit[k].s.dj)}`);
}
// Boven het dansbereik maar onder 300 (review ronde 1, 14 okt): wat Beat This! goed telt blijft staan, zeker,
// met of zonder tweede mening (was: gehalveerd naar 93/96 en onzeker 'tel'). Halveren daar alleen als de
// tweede mening het halve tempo hoort in de fase van de downbeats; zonder blijft het netwerktempo (de prijs).
{
  const zelf = (naam, v, wie) => alleMeningen.find(([k]) => k === `${naam}/${v}/${wie}`)[1];
  const schoon = ['vast-186', 'vast-192'].flatMap((naam) => ['geen', 'goed'].map((wie) => [`${naam}/bt/${wie}`, zelf(naam, 'bt', wie)]));
  ok('schoon 186 en 192 met downbeats (Beat This! telt goed): zeker op het echte tempo, met en zonder tweede mening',
    schoon.every(([, x]) => x.s.dj >= 0.95 && x.s.dekking >= 0.95 && x.kaart.stukken.every((st) => !st.twijfel && st.bpm > 180)),
    schoon.map(([k, x]) => `${k} dj ${pct(x.s.dj)} dekking ${pct(x.s.dekking)} ${x.kaart.stukken.map((st) => `${st.bpm} ${st.twijfel ?? ''}`).join('/')}`).join(', '));
  const geen = zelf('house-124', 'dubbel', 'geen'), goed = zelf('house-124', 'dubbel', 'goed');
  ok('house dubbel geteld (248) zonder tweede mening: niet gehalveerd (geen tweede bron), niet vals; met een die 124 hoort: 124, zeker',
    Math.abs(geen.kaart.stukken[0].bpm - 248) < 0.01 && !geen.s.valsZeker && Math.abs(goed.kaart.stukken[0].bpm - 124) < 0.01 && goed.s.dekking >= 0.95,
    `${geen.kaart.stukken[0].bpm} / ${goed.kaart.stukken[0].bpm} ${pct(goed.s.dekking)}`);
  const n186 = nummer('vast-186', { audio: false });
  const t186 = nepTellen(n186, 'bt');
  ok('echte 186: de downbeats om de 4 tellen van het netwerk, dus geen voorstel om te halveren',
    gridUitTellen(t186.beats, t186.downbeats, { duur: n186.duur }).stukken.every((st) => !st.halveer));
  const n = nummer('house-124', { audio: false });
  const t = nepTellen(n, 'dubbel');
  const k = gridUitTellen(t.beats, t.downbeats, { duur: n.duur });
  const vh = k.stukken[0].halveer;
  ok('248 met de downbeats om de 8 (het netwerk telt dubbel): een voorstel om te halveren (op de "1"), de kaart zelf blijft 248',
    Math.abs(k.stukken[0].bpm - 248) < 0.01 && vh && Math.abs(vh.bpm - 124) < 0.01 && Math.abs(((vh.anker - k.stukken[0].maat) / (60 / 124)) % 1) < 1e-3, JSON.stringify(k.stukken[0]));
  const na = vergelijk(structuredClone(k), t.beats, null);
  const { normaliseerGrid } = await import('../server/library.js');
  ok('… zonder tweede mening voert niemand het uit, en de library bewaart `halveer` niet',
    Math.abs(na.stukken[0].bpm - 248) < 0.01 && normaliseerGrid(k).stukken.every((st) => !('halveer' in st)));
}
// Een nieuw tempo dat het oude rooster kruist (124 -> 131) hoorde nog 4,5 s bij het oude stuk, zeker.
ok('mix 124 -> 131 met ruis: de grens binnen een seconde, niets vals zeker', uit['wissel-124-131/ruis'].s.grens < 1 && !uit['wissel-124-131/ruis'].s.valsZeker,
  `grens ${uit['wissel-124-131/ruis'].s.grens?.toFixed(1)} s`);
// Twee extra tellen op een rij na een gat maakten een stuk op 164 (beginPeriode).
{
  const n = nummer('wissel-124-131', { audio: false });
  const t = nepTellen(n, 'ruis');
  const k = gridUitTellen(t.beats, t.downbeats, { duur: n.duur });
  const raar = k.stukken.filter((s) => s.twijfel !== 'geen puls' && Math.abs(s.bpm - 124) > 1 && Math.abs(s.bpm - 131) > 1);
  ok('na een gat met extra tellen: geen stuk op een verzonnen tempo', raar.length === 0, JSON.stringify(raar.map((s) => [s.van, s.bpm])));
}
// Het octaaf wisselt halverwege (Beat This! hoort ineens de halve tel): één tempo.
for (const k of ['vast-178/wissel', 'wissel-124-131/wissel', 'oplopend/wissel', 'indie-154/wissel']) {
  ok(`${k}: het halve tempo halverwege valt terug op het hele`, uit[k].s.dj >= 0.95, `dj ${pct(uit[k].s.dj)}`);
}
// Schone gevallen blijven wat ze waren.
{
  const n = nummer('house-124', { audio: false });
  const t = nepTellen(n, 'bt');
  const k = gridUitTellen(t.beats, t.downbeats, { duur: n.duur });
  ok('house 124: één zeker stuk op 124,00, de "1" goed', k.stukken.length === 1 && Math.abs(k.stukken[0].bpm - 124) < 0.01
    && k.stukken[0].zekerheid >= ZEKER_VANAF && uit['house-124/bt'].s.een === 1 && k.versie === VERSIE, JSON.stringify(k.stukken));
  ok('ambient: nooit zeker, met welke fouten ook', VARIANTEN.every((v) => uit[`ambient/${v}`].s.zekerSec === 0));
}

// ---- het dansbereik als rekenwerk -------------------------------------------

ok('dansFactor: 77 -> ×2, 124 ×1, 248 ×½, 344 ×½, 30 ×4', dansFactor(77) === 2 && dansFactor(124) === 1 && dansFactor(248) === 0.5 && dansFactor(344) === 0.5 && dansFactor(30) === 4);
ok('het bereik: 88 en 180 blijven staan', dansFactor(DANS_MIN) === 1 && dansFactor(DANS_MAX) === 1);
{
  const d = (bpm, gewicht = 1, kanHalveren = true) => ({ bpm, gewicht, kanHalveren });
  ok('een tempo dat rond 88 drijft springt niet halverwege naar 174', new Set(dansOctaven([d(89, 3), d(87.5, 3), d(88.4, 2)]).map((f, i) => Math.round([89, 87.5, 88.4][i] * f / 10))).size === 1);
  ok('Beat This! hoort even de halve tel: dat stuk naar het tempo van de rest', dansOctaven([d(172, 5), d(86, 1)]).join() === '1,2');
  ok('zonder "1" niet halveren (welke van de twee is de tel?), boven MAX_BPM wel', dansOctaven([d(248, 1, false)]).join() === '1' && dansOctaven([d(344, 1, false)]).join() === '0.5');
  ok('onder MAX_BPM ook MET "1" niet halveren (echte 181-300 blijft; review ronde 1): 186, 192, 248 ×1',
    dansOctaven([d(186)]).join() === '1' && dansOctaven([d(192)]).join() === '1' && dansOctaven([d(248)]).join() === '1' && dansOctaven([d(344)]).join() === '0.5');
  ok('een wals wordt niet verdubbeld (die tel je in zijn tel), alleen onder MIN_BPM', dansOctaven([d(75)], 3).join() === '1' && dansOctaven([d(30)], 3).join() === '2');
  ok('een eigen stuk op 95 in een mix op 175 blijft 95 (190 is 8,6% van het tempo van het nummer), 87,5 daar wel 175',
    dansOctaven([d(175, 10), d(95, 1)]).join() === '1,1' && dansOctaven([d(175, 10), d(87.5, 1)]).join() === '1,2');
}

// ---- meten als het netwerk fijner telt dan het grid ---------------------------

{
  const L = 60 / 124;
  const tellen = []; for (let t = 0.3; t < 120; t += L / 2) tellen.push(t + ((tellen.length * 7919) % 11 - 5) / 1000);
  const g = new Beatgrid({ stukken: [{ van: 0, bpm: 124, anker: 0.3 }] });
  const m = meetGrid(g, tellen);
  ok('tellen op 248 tegen een grid op 124: raak (het grid is het DJ-tempo)', m.totaal.raak > 0.9 && m.totaal.afwijking < 0.006, `${pct(m.totaal.raak)} ${m.totaal.afwijking}`);
  const half = []; for (let t = 0.3; t < 120; t += L) half.push(t < 60 ? t : t + L / 2);
  const mh = meetGrid(g, half);
  ok('maar een sprong van een halve tel halverwege blijft naast (geen "fijner")', mh.totaal.raak < 0.6 && mh.totaal.offbeat > 0.4, `${pct(mh.totaal.raak)} off ${pct(mh.totaal.offbeat)}`);
}
// Telt Beat This! maar in een DEEL van het stuk ook de achtsten, dan mag een grid op slot dat een halve tel
// naast ligt niet "100% raak" worden (review 14 okt: bij 20% en 30% achtsten gebeurde dat, 🔒 in plaats van 🔒?).
{
  const L = 0.5;
  const met = (deel, anker, van = 100) => {
    const beats = [];
    for (let k = 0; k < 400; k++) { beats.push(k * L + 0.003 * Math.sin(k)); if (k >= van && k < van + 400 * deel) beats.push(k * L + L / 2); }
    beats.sort((x, y) => x - y);
    const g = new Beatgrid({ stukken: [{ van: 0, bpm: 120, anker }], beatsPerBar: 4, slot: true });
    const m = meetGrid(g, beats);
    return { m: m.stukken[0], o: oordeelStuk(g.stukken[0], m.stukken[0], true) };
  };
  const naast = [0.15, 0.2, 0.3, 0.5].map((d) => [d, met(d, L / 2)]);
  ok('achtsten in 15-50% van het stuk, slot-grid een halve tel naast: 🔒? (niet "raak")', naast.every(([, x]) => x.o.kort === '🔒?' && x.m.raak < 0.5),
    naast.map(([d, x]) => `${d}: ${x.o.kort} ${pct(x.m.raak)}`).join(', '));
  const goed = [0.2, 0.3, 0.5].map((d) => [d, met(d, 0)]);
  ok('… en het goede grid met dezelfde achtsten blijft 🔒, raak', goed.every(([, x]) => x.o.kort === '🔒' && x.m.raak > 0.95), goed.map(([d, x]) => `${d}: ${x.o.kort} ${pct(x.m.raak)}`).join(', '));
  const vol = met(1, L / 2, 0);
  ok('telt het netwerk OVERAL dubbel, dan scoort ook het verkeerde grid raak (de tellen zeggen het niet), maar de uitleg zegt dat erbij',
    vol.m.fijn === true && /dubbele tempo/.test(vol.o.uitleg), vol.o.uitleg);
}

// ---- de oude analyse: weglopen op de pieken -----------------------------------

{
  // Pieken op 128 over 8 minuten, een grid op 128,024 (wat de oude analyse van een klik maakte).
  const echt = []; for (let t = 0.2; t < 480; t += 60 / 128) echt.push(t + ((echt.length * 104729) % 13 - 6) / 1000);
  const P = Float64Array.from(echt);
  const scheef = { van: 0, bpm: 128.024, anker: 0.2 + 0.0375, tot: 480 };
  const d = blokDrift(P, scheef, 480);
  ok('blokDrift: een grid dat 0,02% te snel is ligt aan de rand > DRIFT_TEL naast', d.afwijking > DRIFT_TEL, d.afwijking);
  ok('blokDrift: het goede grid niet', blokDrift(P, { van: 0, bpm: 128, anker: 0.2 }, 480).afwijking < 0.03);
  const k = kantelOpPieken(P, scheef, 480, 240);
  ok('kantelOpPieken: terug op 128,000, de lijn in het midden op zijn plek', k && Math.abs(k.bpm - 128) < 0.002
    && Math.abs((k.anker + Math.round((240 - k.anker) * 128 / 60) * 60 / 128) - (scheef.anker + Math.round((240 - scheef.anker) * 128.024 / 60) * 60 / 128.024)) < 0.001, JSON.stringify(k));
  // 1% naast is geen kleine tempofout: de pieken vouwen om (elke 100 tellen een tel), kantelen
  // vindt het tempo niet terug, en het stuk blijft boven DRIFT_TEL: onzeker, niet "gerepareerd".
  const mis = { van: 0, bpm: 129.3, anker: 0.2 };
  const km = kantelOpPieken(P, mis, 480, 240);
  ok('een grid 1% naast: kantelen maakt het niet zeker (blijft > DRIFT_TEL)', blokDrift(P, km ? { ...mis, ...km } : mis, 480).afwijking > DRIFT_TEL);
}

const map = mkdtempSync(join(tmpdir(), 'varve-beatbench-'));
const oud = async (naam, x) => {
  const wav = join(map, `${naam}.wav`), onset = join(map, `${naam}.onset`);
  writeFileSync(wav, x);
  const o = await analyze.maakOnset(wav, onset);
  return o.ok ? (await analyze.maakGrid(onset, o.envRate, o.tijdOffset, wav)).grid : null;
};
try {
  // Een klik van 8 minuten op 128 (zoals gridauto.test): was 128,024, aan het begin 37 ms te laat.
  const SR = 22050, x = new Float32Array(SR * 480);
  for (let t = 0.2; t < 480; t += 60 / 128) { const s = Math.round(t * SR); for (let i = 0; i < 440 && s + i < x.length; i++) x[s + i] = 0.6 * Math.exp(-i / 80) * Math.sin(2 * Math.PI * 900 * i / SR); }
  const g = await oud('klik', wavVan(x, SR));
  const s = g?.stukken[0];
  ok('oude analyse, klik van 8 minuten: tempo op 0,002 bpm, de eerste tel op 10 ms, zeker', s && Math.abs(s.bpm - 128) < 0.002 && Math.abs(s.anker - 0.2) < 0.01 && s.zekerheid >= ZEKER_VANAF, JSON.stringify(s));

  // Een band zonder klik (±2%): de oude analyse zei 95 s zeker, waarvan 27,5 s naast.
  const n = nummer('live-drift');
  const gl = await oud('live-drift', wavVan(n.x));
  const sl = gl && scoor(gl, n);
  ok('oude analyse, live band: hooguit 8 s zeker-en-naast (was 27,5), en die stukken zeggen waarom', sl && sl.valsSec <= 8 && gl.stukken.some((st) => st.twijfel === 'drift'),
    sl && `${sl.valsSec} s van ${sl.zekerSec} s`);
  // Half-time: de oude analyse hoort 70, het grid zegt 140 (hetzelfde dansbereik als de tellen).
  const h = nummer('halftime-140');
  const gh = await oud('halftime', wavVan(h.x));
  ok('oude analyse, half-time 140: het grid op 140 (was 70)', gh && scoor(gh, h).dj >= 0.95, gh && JSON.stringify(gh.stukken.map((st) => st.bpm)));

  // De ECHTE oude analyse als tweede mening, zoals pasTellenToe, als Beat This! dubbel telt (review 14 okt:
  // met de downbeats op de "en" of zonder downbeats werd het halveren vals zeker over het hele nummer).
  const echt = [];
  for (const naam of ['house-124', 'jungle-172']) {
    const n = nummer(naam);
    const go = await oud(naam, wavVan(n.x));
    for (const v of ['dubbel', 'dubbel-laat', 'dubbel-kaal']) {
      const t = nepTellen(n, v);
      const kaart = vergelijk(gridUitTellen(t.beats, t.downbeats, { duur: n.duur }), t.beats, go && new Beatgrid(go));
      echt.push([`${naam}/${v}`, scoor(kaart, n)]);
    }
  }
  // En wat Beat This! goed telt boven 180 (review ronde 1): de echte oude analyse hoort hetzelfde (of 93 x2),
  // dus het blijft op het echte tempo en zeker. Vóór de herstelling: 93,0 en 96,0, onzeker ('tel').
  for (const naam of ['vast-186', 'vast-192']) {
    const n = nummer(naam);
    const go = await oud(naam, wavVan(n.x));
    // eenfout: elke "1" een tel te laat; dan viel de oude analyse op 93 (vast-186) in dezelfde fase en werd 186 93.
    for (const v of ['bt', 'ruis', 'eenfout']) {
      const t = nepTellen(n, v);
      const kaart = vergelijk(gridUitTellen(t.beats, t.downbeats, { duur: n.duur }), t.beats, go && new Beatgrid(go));
      const x = scoor(kaart, n);
      ok(`echte oude analyse, ${naam}/${v} goed geteld: blijft ${naam.slice(5)}, zeker`, go && x.dj >= 0.95 && x.dekking >= 0.95 && !x.valsZeker,
        `oud ${go && go.stukken.map((st) => st.bpm.toFixed(1)).join('/')}, kaart ${kaart.stukken.map((st) => `${st.bpm} z${st.zekerheid} ${st.twijfel ?? ''}`).join('/')}`);
    }
  }
  // EEN TWEEDE MENING OVER DE "1" (15 okt, BEATGRID.md §14): de lage band (kick, bas) per tel van de maat.
  // Zit Beat This! consequent een tel naast (eenfout), dan twijfel 'maat' waar de "1" een accent in de
  // lage band heeft; een goede "1" nooit; vier op de vloer zegt niets; de zekerheid verandert nergens.
  {
    const laagVan = async (naam, x) => {
      const wav = join(map, `${naam}.wav`), bin = join(map, `${naam}.laag`);
      writeFileSync(wav, x);
      const r = await analyze.maakLaag(wav, bin);
      if (!r.ok) return null;
      const b = (await import('node:fs')).readFileSync(bin);
      return { env: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), envRate: r.envRate, tijdOffset: r.tijdOffset };
    };
    const accent = ['vast-96', 'swing-118', 'wals-150', 'reggae-75', 'jungle-172', 'halftime-140', 'opmaat-126'];
    const vloer = ['house-124', 'oplopend'];
    const rest = ['live-drift', 'indie-154', 'ambient'];
    const r = {};
    for (const naam of [...accent, ...vloer, ...rest]) {
      const n = nummer(naam);
      const laag = await laagVan(naam, wavVan(n.x));
      for (const v of ['bt', 'ruis', 'eenfout']) {
        const t = nepTellen(n, v);
        const zonder = gridUitTellen(t.beats, t.downbeats, { duur: n.duur });
        const met = maatMening(structuredClone(zonder), laag);
        r[`${naam}/${v}`] = { zonder: scoor(zonder, n), met: scoor(met, n), laag: !!laag };
      }
    }
    const alle = Object.entries(r);
    ok('de lage band is er voor elk nummer (maakLaag in de worker)', alle.every(([, x]) => x.laag));
    const fout = accent.map((k) => [k, r[`${k}/eenfout`].met]);
    ok(`"1" een tel naast (eenfout) met een accent in de lage band (${accent.length} nummers): twijfel 'maat', geen foute "1" meer zonder twijfel`,
      fout.every(([, s]) => s.eenMaat >= 0.95 && s.eenVals <= 0.05), fout.map(([k, s]) => `${k} maat ${pct(s.eenMaat)} vals ${pct(s.eenVals)}`).join(', '));
    ok('… en zonder de lage band waren die "1"-en fout ZONDER twijfel (de test meet iets)', accent.every((k) => r[`${k}/eenfout`].zonder.eenVals >= 0.95));
    const goed = alle.filter(([k]) => !k.endsWith('/eenfout'));
    ok(`een goede "1" (bt en ruis, ${goed.length} gevallen) krijgt nooit twijfel 'maat' door de lage band`,
      goed.every(([, x]) => x.met.eenOnterecht <= x.zonder.eenOnterecht), goed.filter(([, x]) => x.met.eenOnterecht > x.zonder.eenOnterecht).map(([k]) => k).join(', '));
    ok('vier op de vloer (elke tel een kick): de lage band zegt niets, ook niet bij eenfout (een bekende grens)',
      vloer.every((k) => r[`${k}/eenfout`].met.eenMaat === 0));
    ok('de zekerheid verandert nergens (dekking en vals zeker gelijk; sync mag bij twijfel over de "1")',
      alle.every(([, x]) => x.met.dekking === x.zonder.dekking && x.met.valsZeker === x.zonder.valsZeker && x.met.vals === x.zonder.vals));
    // Zonder lage band, of een lage band zonder kick of bas (alleen ruis): niets.
    const n = nummer('vast-96', { audio: false }), t = nepTellen(n, 'eenfout');
    const k0 = gridUitTellen(t.beats, t.downbeats, { duur: n.duur });
    const zelfde = JSON.stringify(k0);
    ok('maatMening zonder lage band laat de kaart staan', JSON.stringify(maatMening(structuredClone(k0), null)) === zelfde);
    let z = 7;
    const ruis = new Float32Array(Math.ceil(n.duur * 250)).map(() => ((z = (Math.imul(z, 1103515245) + 12345) >>> 0) / 4294967296));
    ok('… en met een lage band die alleen ruis is (geen accent boven de vloer) ook', JSON.stringify(maatMening(structuredClone(k0), { env: ruis, envRate: 250, tijdOffset: 0 })) === zelfde);
    // Een stuk dat al twijfelt houdt zijn reden.
    const k1 = structuredClone(k0); k1.stukken[0].twijfel = 'los';
    const nv = nummer('vast-96');
    ok('een stuk met een andere twijfel houdt die (de lage band schrijft er niet overheen)', maatMening(k1, await laagVan('vast-96b', wavVan(nv.x))).stukken[0].twijfel === 'los');
  }

  const e = Object.fromEntries(echt);
  ok('echte oude analyse, Beat This! dubbel: met goede downbeats bevestigd (zeker, DJ-tempo), op de "en" of zonder: nergens vals zeker',
    e['house-124/dubbel'].dekking >= 0.95 && e['jungle-172/dubbel'].dekking >= 0.95 && e['house-124/dubbel'].dj >= 0.95 && e['jungle-172/dubbel'].dj >= 0.95
    && echt.every(([, x]) => !x.valsZeker), echt.map(([k, x]) => `${k}: zeker ${x.zekerSec} s, vals ${x.valsSec} s`).join('; '));
} finally {
  rmSync(map, { recursive: true, force: true });
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
