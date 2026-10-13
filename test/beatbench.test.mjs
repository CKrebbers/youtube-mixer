// De benchmark van het automatische beatgrid als test (docs/BEATGRID.md §12):
// synthetische nummers met bekende tellen en "1"-en (tools/beatmeting/synth/),
// de tellen zoals Beat This! ze geeft (met zijn soorten fouten), en de oude
// analyse op een paar nummers. Elke check hieronder faalt op de code van vóór
// 14 okt (studio/afmaken 7debab6), behalve de controles dat schone gevallen
// gelijk blijven. Draai met: node test/beatbench.test.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { gridUitTellen, meetGrid, dansFactor, dansOctaven, DANS_MIN, DANS_MAX, VERSIE } = await import('../src/engine/tellen.js');
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

const uit = {};
for (const naam of NAMEN) {
  const n = nummer(naam, { audio: false });
  for (const v of VARIANTEN) {
    const t = nepTellen(n, v);
    uit[`${naam}/${v}`] = { s: scoor(gridUitTellen(t.beats, t.downbeats, { duur: n.duur }), n), n };
  }
}
const alle = Object.values(uit).map((x) => x.s);
const vals = Object.entries(uit).filter(([, x]) => x.s.valsZeker).map(([k, x]) => `${k} ${pct(x.s.vals)}`);
ok(`${alle.length} gevallen: nergens vals zeker (zeker en > 2% van die tijd naast)`, vals.length === 0, vals.join(', '));
const gem = (k) => { const v = alle.map((s) => s[k]).filter((x) => x != null); return v.reduce((a, b) => a + b, 0) / v.length; };
ok('gemiddeld zeker op ≥ 95% van de duidelijke tellen', gem('dekking') >= 0.95, pct(gem('dekking')));
ok('gemiddeld ≤ 2% van de tellen > 0,1 tel naast', gem('naast') <= 0.02, pct(gem('naast')));
ok('gemiddeld ≥ 95% op het DJ-tempo', gem('dj') >= 0.95, pct(gem('dj')));

// Het DJ-tempo: wat Beat This! als halve of dubbele tel hoort, komt in het dansbereik.
for (const [k, wat] of [['jungle-172/bt', 'jungle: Beat This! hoort 86, het grid zegt 172'],
  ['halftime-140/bt', 'half-time: 70 wordt 140'], ['indie-154/bt', 'band zonder klik op 154 (zoals Ciel): 77 wordt 154'],
  ['house-124/half', 'house, het halve tempo gehoord: 62 wordt 124'], ['house-124/dubbel', 'house, het dubbele gehoord: 248 wordt 124'],
  ['reggae-75/bt', 'reggae 75 telt een DJ als 150 (een keuze, zie DANS_MIN)'], ['vast-72/bt', 'downtempo 72 wordt 144']]) {
  ok(`DJ-tempo: ${wat}`, uit[k].s.dj >= 0.95 && uit[k].s.dekking >= 0.9, `dj ${pct(uit[k].s.dj)}, dekking ${pct(uit[k].s.dekking)}`);
}
// Sneller dan 300 bpm (Beat This! telt de achtsten) was "geen puls": het hele grid weg.
for (const k of ['jungle-172/dubbel', 'vast-178/dubbel', 'indie-154/dubbel']) {
  ok(`${k}: boven 300 bpm toch een grid, zeker en op het DJ-tempo`, uit[k].s.dekking >= 0.95 && uit[k].s.dj >= 0.95, `dekking ${pct(uit[k].s.dekking)}, dj ${pct(uit[k].s.dj)}`);
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
  ok('een wals wordt niet verdubbeld (die tel je in zijn tel), alleen onder MIN_BPM', dansOctaven([d(75)], 3).join() === '1' && dansOctaven([d(30)], 3).join() === '2');
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
} finally {
  rmSync(map, { recursive: true, force: true });
}

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
