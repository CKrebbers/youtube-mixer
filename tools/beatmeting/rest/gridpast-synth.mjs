// "Het grid moet passen per stuk": synthetische scenario's, waarvan de echte kicks bekend
// zijn. analyseerGrid vóór (12776ba) tegen nu. Leest niets uit media/.
//   node tools/beatmeting/rest/gridpast-synth.mjs [naam ...]   (LANGE_MIX=1: ook de mix van 20 minuten)
// Per stuk: tempo, zekerheid (* = zeker), grootste afwijking van een kick tot het grid,
// aandeel kicks > 30 ms en > 0,15 tel naast. VALS ZEKER = zeker en meer dan 5% > 0,15 tel.
// B en S1-S8: de scenario's van de tweede kans (fills op 107 bpm, schone brokjes);
// F1-F5: schone sprongen, tempowissels en schone stukken; V: een versnelling van een tel in 16 s.
import { d, detectVan } from './lib.mjs';
import { ZEKER_VANAF } from '../../../src/engine/beatgrid.js';

const oud = await detectVan('12776ba');
const SR = 11025;
function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2147483648 - 1);
}
function spoorVan(duur, events, { vloer = 0.01, seed = 5 } = {}) {
  const rnd = prng(seed);
  const x = new Float32Array(Math.round(SR * duur));
  for (let i = 0; i < x.length; i++) x[i] = vloer * rnd();
  for (const [t, a, soort] of events) {
    const s0 = Math.round(t * SR);
    const lang = soort === 'hat' ? 600 : 2500;
    for (let i = 0; i < lang && s0 + i < x.length; i++) {
      x[s0 + i] += soort === 'hat'
        ? a * rnd() * Math.exp(-i / 150)
        : a * Math.exp(-i / 600) * Math.sin(2 * Math.PI * (55 * i / SR + 1.8 * (1 - Math.exp(-i / 330))));
    }
  }
  return x;
}
const envVan = (x, d) => { const { env, envRate, tijdOffset } = d.onsetEnvelope(x, SR); return { env: d.normaliseerEnvelope(env, envRate), envRate, tijdOffset }; };

function maak(duur, segmenten, seed = 7) {
  const r = prng(seed), ev = [], echt = [];
  for (const s of segmenten) {
    const p = 60 / s.bpm;
    let t = s.anker; while (t < s.van) t += p;
    for (; t < s.tot; t += p) {
      const jit = s.jitter ? s.jitter * r() : 0;
      ev.push([t + jit, s.amp ?? 0.5, 'kick']); echt.push(t + jit);
      if (s.hats) ev.push([t + p / 2, 0.15, 'hat']);
    }
    if (s.fills) {
      const brok = s.brokjes || [];
      for (let t0 = s.van + 0.3; t0 < s.tot - 1; t0 += 2.5) {
        if (brok.some(([a, b]) => t0 >= a - 2 && t0 <= b)) continue;
        const f = t0 + 0.8 * (r() * 0.5 + 0.5);
        for (let j = 0; j < 4; j++) ev.push([f + j * 60 / 107, 0.9, 'hat']);
      }
    }
  }
  return { x: spoorVan(duur, ev, { vloer: 0.01, seed: seed + 1 }), echt: echt.sort((a, b) => a - b) };
}

function beoordeel(st, echt) {
  return st.map((s) => {
    const p = 60 / s.bpm;
    const fouten = echt.filter((t) => t >= s.van && t < s.tot).map((t) => {
      const k = Math.round((t - s.anker) / p);
      return Math.abs(t - (s.anker + k * p)) * 1000;
    });
    const max = fouten.length ? Math.max(...fouten) : 0;
    const boven = fouten.length ? fouten.filter((f) => f > 30).length / fouten.length : 0;
    const tel15 = fouten.length ? fouten.filter((f) => f > 150 * p).length / fouten.length : 0;
    const zeker = s.zekerheid >= ZEKER_VANAF;
    const vals = zeker && tel15 > 0.05;
    return `${s.van.toFixed(0)}-${s.tot.toFixed(0)} ${s.bpm?.toFixed(2)} z${s.zekerheid.toFixed(2)}${zeker ? '*' : ' '} max ${max.toFixed(0)} ms, >30ms ${(boven * 100).toFixed(0)}%, >0,15 tel ${(tel15 * 100).toFixed(0)}%${vals ? '  <-- VALS ZEKER' : ''}`;
  });
}

const p150 = 60 / 150;
const SCEN = {
  B: () => {
    const r = prng(77), ev = [], echt = [];
    const A156 = 60.15, p156 = 60 / 156;
    const brokjes = [[60, 66], [84, 90], [114, 120], [144, 150]];
    for (let t = 0.2; t < 60; t += 60 / 140) { ev.push([t, 0.5, 'kick']); echt.push(t); }
    for (let t = A156; t < 150; t += p156) { ev.push([t, 0.3, 'kick']); echt.push(t); }
    for (let k = 0; k < brokjes.length - 1; k++) {
      const a = brokjes[k][1], b = brokjes[k + 1][0];
      for (let t = a + 0.3; t < b - 1; t += 2.5) {
        const t0 = t + 0.8 * (r() * 0.5 + 0.5);
        for (let j = 0; j < 4; j++) ev.push([t0 + j * 60 / 107, 0.9, 'hat']);
      }
    }
    for (let t = 150.1; t < 210; t += 60 / 150) { ev.push([t, 0.5, 'kick']); echt.push(t); }
    return { x: spoorVan(210, ev, { vloer: 0.01, seed: 78 }), echt };
  },
  S1: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 60, tot: 200, bpm: 150, anker: 60.2 + p150 / 2, amp: 0.3, fills: true, brokjes: [[66, 72], [100, 106], [140, 146]] },
  ]),
  S1b: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.5, fills: true, brokjes: [[44, 56]] },
    { van: 60, tot: 200, bpm: 150, anker: 60.2 + p150 / 2, amp: 0.5 },
  ]),
  S2: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 60, tot: 200, bpm: 154, anker: 60.1, amp: 0.3, fills: true, brokjes: [[66, 72], [100, 106], [140, 146]] },
  ]),
  S2b: () => maak(200, [
    { van: 0, tot: 70, bpm: 150, anker: 0.2, amp: 0.3, fills: true, brokjes: [[50, 62]] },
    { van: 70, tot: 200, bpm: 153, anker: 70.13, amp: 0.5 },
  ]),
  S3: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 60, tot: 70, bpm: 150, anker: 0.2, amp: 0.4 },
    { van: 70, tot: 110, bpm: 75, anker: 0.2, amp: 0.4, fills: true },
    { van: 110, tot: 118, bpm: 150, anker: 0.2, amp: 0.4 },
    { van: 118, tot: 200, bpm: 150, anker: 0.2, amp: 0.4, fills: true, brokjes: [[150, 156]] },
  ]),
  S3b: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 60, tot: 70, bpm: 150, anker: 0.2, amp: 0.4 },
    { van: 70, tot: 110, bpm: 75, anker: 70.2 + p150 / 2, amp: 0.4, fills: true },
    { van: 110, tot: 200, bpm: 150, anker: 110.1 + p150 / 3, amp: 0.4, fills: true, brokjes: [[112, 120]] },
  ]),
  S4: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.3, fills: true, brokjes: [[44, 56]] },
    { van: 75, tot: 200, bpm: 150, anker: 75.2, amp: 0.5 },
  ]),
  S4b: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.3, fills: true, brokjes: [[44, 56]] },
    { van: 65, tot: 200, bpm: 150, anker: 65.2, amp: 0.5 },
  ]),
  S4c: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.3, fills: true, brokjes: [[44, 56]] },
    { van: 75, tot: 200, bpm: 150, anker: 75.4, amp: 0.5 },
  ]),
  S5: () => maak(200, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 60, tot: 100, bpm: 150, anker: 0.2, amp: 0.2, fills: true, brokjes: [[70, 76]] },
    { van: 100, tot: 200, bpm: 150, anker: 0.2, amp: 0.5 },
  ]),
  S6: () => maak(220, [
    { van: 0, tot: 50, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 50, tot: 110, bpm: 150, anker: 0.2, amp: 0.3, fills: true, brokjes: [[80, 90]] },
    { van: 110, tot: 170, bpm: 150, anker: 110.0, amp: 0.3, fills: true, brokjes: [[124, 134]] },
    { van: 170, tot: 220, bpm: 150, anker: 110.0, amp: 0.5 },
  ]),
  S7: () => maak(380, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.3, fills: true, brokjes: [[44, 56]] },
    { van: 60, tot: 380, bpm: 150, anker: 60.0, amp: 0.5 },
  ]),
  S8: () => maak(380, [
    { van: 0, tot: 60, bpm: 150, anker: 0.2, amp: 0.3, fills: true, brokjes: [[20, 30], [44, 56]] },
    { van: 60, tot: 380, bpm: 152.5, anker: 60.0, amp: 0.5 },
  ]),
  // Nieuw voor deze stap: schoon, geen fills.
  // F1: zelfde tempo, halve tel verschoven op 100 s (twee schone nummers aan elkaar).
  F1: () => maak(200, [
    { van: 0, tot: 100, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 100, tot: 200, bpm: 150, anker: 100.2 + p150 / 2, amp: 0.5 },
  ]),
  // F1q: een kwart tel verschoven.
  F1q: () => maak(200, [
    { van: 0, tot: 100, bpm: 124, anker: 0.2, amp: 0.5 },
    { van: 100, tot: 200, bpm: 124, anker: 0.2 + 207 * 60 / 124 + 60 / 124 / 4, amp: 0.5 },
  ]),
  // F2: nummerwissel op bijna hetzelfde tempo (150 -> 153, 2%).
  F2: () => maak(200, [
    { van: 0, tot: 100, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 100, tot: 200, bpm: 153, anker: 100.1, amp: 0.5 },
  ]),
  // F2b: 128 -> 129,5 (1,2%).
  F2b: () => maak(240, [
    { van: 0, tot: 120, bpm: 128, anker: 0.2, amp: 0.5 },
    { van: 120, tot: 240, bpm: 129.5, anker: 120.3, amp: 0.5 },
  ]),
  // F3: een schoon stuk, moet zeker blijven.
  F3: () => maak(200, [{ van: 0, tot: 200, bpm: 128, anker: 0.3, amp: 0.5, hats: true }]),
  // F3j: schoon met menselijke speling (±15 ms), moet zeker blijven.
  F3j: () => maak(200, [{ van: 0, tot: 200, bpm: 122, anker: 0.3, amp: 0.5, jitter: 0.015 }]),
  // F4: faseverspringing kort (15 s) aan het eind van een lang stuk.
  F4: () => maak(215, [
    { van: 0, tot: 200, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 200, tot: 215, bpm: 150, anker: 200.2 + p150 / 2, amp: 0.5 },
  ]),
  // F5: drie nummers op 150, telkens een andere fase.
  F5: () => maak(300, [
    { van: 0, tot: 100, bpm: 150, anker: 0.2, amp: 0.5 },
    { van: 100, tot: 200, bpm: 150, anker: 100.2 + p150 / 2, amp: 0.5 },
    { van: 200, tot: 300, bpm: 150, anker: 200.2 + p150 / 4, amp: 0.5 },
  ]),
};


SCEN.V = () => {
  // 150, dan 16 s op 153,75 (de muziek loopt precies een tel voor), dan weer 150.
  const ev = [], echt = [];
  for (let t = 0.2; t < 200; t += 60 / (t >= 80 && t < 96 ? 153.75 : 150)) { ev.push([t, 0.5, 'kick']); echt.push(t); }
  return { x: spoorVan(200, ev, { vloer: 0.01, seed: 17 }), echt };
};
if (process.env.LANGE_MIX === '1') {
  // Twintig minuten, zes nummers van 200 s op 150/151,5/149 in vier fasen, zonder gat.
  SCEN.LANG = () => {
    const tempi = [150, 150, 151.5, 150, 149, 150], seg = [];
    for (let i = 0; i < 6; i++) seg.push({ van: 200 * i, tot: 200 * (i + 1), bpm: tempi[i], anker: 200 * i + 0.2 + (i % 4) * 0.1, amp: 0.5 });
    return maak(1200, seg, 11);
  };
}

const kies = process.argv.slice(2);
let vals = { oud: 0, nieuw: 0 };
for (const [naam, f] of Object.entries(SCEN)) {
  if (kies.length && !kies.includes(naam)) continue;
  const { x, echt } = f();
  const m = envVan(x, d);
  console.log(`=== ${naam}`);
  for (const [n, det] of [['oud', oud], ['nieuw', d]]) {
    const t0 = performance.now();
    const st = det.analyseerGrid(m.env, m.envRate, m.tijdOffset);
    const regels = beoordeel(st, echt);
    vals[n] += regels.filter((r) => r.includes('VALS')).length;
    console.log(`  ${n} (${((performance.now() - t0) / 1000).toFixed(1)} s):`);
    for (const r of regels) console.log(`    ${r}`);
  }
}
console.log(`\nVals zeker: oud ${vals.oud}, nieuw ${vals.nieuw}.`);
