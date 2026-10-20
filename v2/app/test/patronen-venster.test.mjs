// Het venster van de patronen (src/kern/patronen/venster.js): 384 PPQN, swing, micro, omlopen,
// halfopen vensters (elke noot precies één keer), start en stop. Overgenomen uit v1
// test/patronen.test.mjs deel 2. Erbij (v2): plannen op de MAATKLOK zelf (src/kern/klok.js) met
// vensters in klok-ticks, zoals een speler het hoort te doen: met tempowissels en glijden van de
// klok, een haperende timer en willekeurige grenzen komt elke noot precies één keer, op de tijd
// die de klok voor zijn tick zegt.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../src/kern/patronen/model.js');
const V = await import('../src/kern/patronen/venster.js');
const { Klok } = await import('../src/kern/klok.js');
const { PPQN } = V;
const dicht = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('venster: 384 PPQN, 64 maten kick precies op elke tel, swing en micro', () => {
  const kick = M.normaliseerPatroon({ noten: [0, 4, 8, 12].map((stap) => ({ stap, noot: 36 })) });
  const s0 = { basis: 0, start: 0, stop: Infinity };
  const alle = V.notenInVenster(kick, s0, 0, 64 * 4 * PPQN);
  assert.ok(PPQN === 384 && V.stapTicks(kick) === 96 && V.omloopTicks(kick) === 16 * 96);
  assert.ok(alle.length === 256 && alle.every((n, i) => n.tick === i * PPQN));
  assert.ok(V.swingTicks(1, 50, 96) === 0 && V.swingTicks(4, 66.67, 96) === 0);
  assert.ok(dicht(V.swingTicks(1, 66.666667, 96), 32, 0.01));
  const sw = M.normaliseerPatroon({ swing: 75, noten: [{ stap: 1, noot: 42 }, { stap: 2, noot: 42 }] });
  const swn = V.notenInVenster(sw, s0, 0, V.omloopTicks(sw));
  assert.ok(swn[0].tick === 96 + 48 && swn[1].tick === 192, 'swing 75: stap 1 een halve stap later, stap 2 niet');
  const mic = M.normaliseerPatroon({ noten: [{ stap: 0, noot: 36, micro: -0.25 }, { stap: 4, noot: 38, micro: 0.25 }] });
  const mn = V.notenInVenster(mic, s0, 0, 2 * V.omloopTicks(mic));
  assert.equal(mn.find((n) => n.noot === 38 && n.omloop === 0).tick, 4 * 96 + 24);
  assert.ok(mn[0].tick === 0 && mn[0].omloop === 0, 'negatieve micro op stap 0: in de eerste omloop op de start');
  assert.ok(mn.some((n) => n.noot === 36 && n.omloop === 1 && n.tick === 16 * 96 - 24), '… en daarna vóór zijn omloop (hij hoort bij zijn eigen omloop)');
  const zestienden = M.normaliseerPatroon({ noten: Array.from({ length: 16 }, (_, stap) => ({ stap, noot: 36 })) });
  let ergst = 0;
  V.notenInVenster(zestienden, s0, 0, 64 * 4 * PPQN).forEach((n, i) => { ergst = Math.max(ergst, Math.abs(n.tick / PPQN * 0.5 - i * 0.125)); });
  assert.ok(ergst < 1e-9, `64 maten zestienden op 120 bpm: drift ${(ergst * 1e6).toFixed(3)} µs`);
});

test('venster voor venster = alles in één keer (duizend willekeurige grenzen), polymetrie, start en stop', () => {
  const s0 = { basis: 0, start: 0, stop: Infinity };
  const vol = M.normaliseerPatroon({ swing: 61, noten: [0, 2, 3, 7, 11, 15].map((stap, i) => ({ stap, noot: 36 + i, micro: [-0.125, 0, 0.0625, -0.3125, 0.1875, 0][i] })) });
  const TOT = 32 * 4 * PPQN;
  const ref = V.notenInVenster(vol, s0, 0, TOT);
  let cur = 0, zaad = 12345;
  const stuk = [];
  while (cur < TOT) {
    zaad = (zaad * 1103515245 + 12345) & 0x7fffffff;
    const volgende = Math.min(cur + 40 + (zaad % 400) + (zaad % 7) / 3, TOT);
    stuk.push(...V.notenInVenster(vol, s0, cur, volgende));
    cur = volgende;
  }
  assert.ok(stuk.length === ref.length && stuk.every((n, i) => n.tick === ref[i].tick && n.noot === ref[i].noot), `${stuk.length} vs ${ref.length}`);
  const p15 = M.normaliseerPatroon({ lengte: 15, noten: [{ stap: 0, noot: 36 }] });
  const p16 = M.normaliseerPatroon({ lengte: 16, noten: [{ stap: 0, noot: 36 }] });
  assert.ok(V.notenInVenster(p15, s0, 0, 240 * 96).length === 16 && V.notenInVenster(p16, s0, 0, 240 * 96).length === 15);
  const kick = M.normaliseerPatroon({ noten: [0, 4, 8, 12].map((stap) => ({ stap, noot: 36 })) });
  const ss = { basis: 4 * PPQN, start: 4 * PPQN, stop: 8 * PPQN };
  const sn = V.notenInVenster(kick, ss, 0, 100 * PPQN);
  assert.ok(sn.length === 4 && sn[0].tick === 4 * PPQN && sn.at(-1).tick === 7 * PPQN);
  const laat = M.normaliseerPatroon({ lengte: 4, swing: 75, noten: [{ stap: 3, noot: 36, micro: 0.5 }] });
  assert.equal(V.notenInVenster(laat, { basis: 0, start: 0, stop: 4 * 96 }, 0, 1e6).length, 0, 'door swing en micro op de stop: weg');
  assert.equal(V.notenInVenster(M.normaliseerPatroon({ lengte: 4, noten: [{ stap: 6, noot: 36 }] }), s0, 0, 1e5).length, 0, 'voorbij de lengte klinkt niet');
  assert.ok(V.stapOp(kick, ss, 4 * PPQN + 200) === 2 && V.stapOp(kick, ss, 100) === null);
});

test('plannen op de maatklok: vensters in klok-ticks, tempo en glijden van de klok, een haperende timer — elke noot één keer, op klok.tijd(tick)', () => {
  // Zo hoort een speler te plannen (de speler bouwt de engine): elke tik tot VOORUIT na nu, het
  // venster van wat al gepland is tot klok.tel(nu + VOORUIT) × PPQN, elke noot op klok.tijd(tick / PPQN).
  // De klok verandert alleen ná wat al gepland is (A ≥ geplandTot); dan klopt elke geplande tijd ook achteraf.
  const VOORUIT = 0.12;
  const p = M.normaliseerPatroon({ swing: 58, noten: Array.from({ length: 16 }, (_, stap) => ({ stap, noot: 36 + (stap % 3), micro: stap % 5 === 0 ? -0.1 : 0 })) });
  const klok = new Klok();
  klok.start(0.5, 0, 124);
  const spel = { basis: klok.volgendeMaat(klok.tel(0.6)) * PPQN, stop: Infinity };
  spel.start = spel.basis;
  let gepland = spel.start, geplandTot = 0;
  const gespeeld = [];
  let nu = 0.5, zaad = 7;
  const veranderd = [];
  klok.on('verander', ({ van }) => veranderd.push(van));
  for (let i = 0; nu < 40; i++) {
    zaad = (zaad * 1103515245 + 12345) & 0x7fffffff;
    nu += 0.025 + (zaad % 100) / 1000;              // timer van 25 ms die tot 100 ms hapert
    // Klokbediening: tempowissels en glijden naar een doellijn, altijd vanaf wat al gepland is.
    const A = Math.max(nu + 0.01, geplandTot);
    if (i === 100) klok.houd(A, 128);
    if (i === 300) klok.richt({ a: A + 0.3, L: 60 / 119.5 }, A);
    if (i === 500) klok.houd(A, 90);
    const h = klok.tel(nu + VOORUIT) * PPQN;
    for (const n of V.notenInVenster(p, spel, gepland, h)) gespeeld.push({ ...n, t: klok.tijd(n.tick / PPQN) });
    gepland = Math.max(gepland, h);
    geplandTot = Math.max(geplandTot, nu + VOORUIT);
  }
  const ref = V.notenInVenster(p, spel, spel.start, gepland);
  assert.ok(gespeeld.length === ref.length && gespeeld.every((n, i) => n.tick === ref[i].tick && n.noot === ref[i].noot), `${gespeeld.length} vs ${ref.length}: elke noot één keer`);
  assert.ok(veranderd.length === 3 && veranderd.every((v, i) => i === 0 || v > veranderd[i - 1]));
  let afwijking = 0, oplopend = true;
  gespeeld.forEach((n, i) => {
    afwijking = Math.max(afwijking, Math.abs(n.t - klok.tijd(n.tick / PPQN)));
    if (i && n.t < gespeeld[i - 1].t - 1e-12) oplopend = false;
  });
  assert.ok(afwijking < 1e-9, `de geplande tijd klopt achteraf (${afwijking.toExponential(1)} s)`);
  assert.ok(oplopend, 'de tijden lopen op');
  assert.equal(klok.inMaat(spel.start / PPQN), 0, 'het patroon begon op een "1" van de klok');
});
