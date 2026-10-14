// De berichtenplannen van het meetinstrument tools/headless/latentie.mjs (controller-invoer, review ronde 1,
// 14 okt). Een vast rooster hield de fase t.o.v. rAF een hele ronde gelijk en maakte de p50 per ronde toeval;
// nu jitter met een vast zaad. Wat hier vastligt: hetzelfde zaad = hetzelfde plan, de jitter verandert de
// volgorde en de waarden niet, een loslaten komt na zijn indrukken, de fase t.o.v. een beeld is verspreid
// (binnen een ronde én tussen rondes), en zonder jitter het oude rooster bit voor bit.
import { readFileSync } from 'node:fs';
import { maakPlan, UITLEG, BEELD_MS } from '../tools/headless/latentie-plan.mjs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${!cond && extra ? ` (${extra})` : ''}`); };
const NAMEN = Object.keys(UITLEG);
const zelfde = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. Hetzelfde zaad = hetzelfde plan (vóór en na krijgen dezelfde berichten), een ander zaad een ander.
for (const naam of NAMEN) {
  const a = maakPlan(naam, { duur: 2000, zaad: 3 }), b = maakPlan(naam, { duur: 2000, zaad: 3 }), c = maakPlan(naam, { duur: 2000, zaad: 4 });
  ok(`${naam}: zelfde zaad, zelfde plan; ander zaad, andere tijden`, zelfde(a, b) && !zelfde(a.map((x) => x[0]), c.map((x) => x[0])));
}

// 2. Zonder jitter: het oude vaste rooster (zoals latentie.mjs vóór review ronde 1 rekende).
{
  const oud = [];
  for (let i = 0; i < 240; i++) { const f = i % 254, v = f < 127 ? f + 1 : 254 - f; oud.push([i * 1000 / 120, 0xb0, 7, v]); }
  ok('fader zonder jitter = het oude rooster i * 1000 / 120, bit voor bit', zelfde(maakPlan('fader', { duur: 2000, jitter: false }), oud));
  const oudPads = [];
  for (let i = 0; i < 32; i++) { const t = i * 1000 / 16, nr = [32, 33, 34, 35][i % 4]; oudPads.push([t, 0x90, nr, 127], [t + 1000 / 16 / 2, 0x80, nr, 0]); }
  ok('pads zonder jitter = het oude rooster', zelfde(maakPlan('pads', { duur: 2000, jitter: false }), oudPads));
}

// 3. De jitter verandert per control niets aan volgorde en waarden: dezelfde berichten, alleen andere tijden.
const perControl = (plan) => { const m = new Map(); for (const [, a, b, c] of plan) { const k = `${a}:${b}`; if (!m.has(k)) m.set(k, []); m.get(k).push(c); } return m; };
for (const naam of NAMEN) {
  const met = maakPlan(naam, { duur: 3000, zaad: 7 }), zonder = maakPlan(naam, { duur: 3000, jitter: false });
  const a = perControl(met), b = perControl(zonder);
  const gelijk = a.size === b.size && [...b].every(([k, xs]) => zelfde(a.get(k), xs));
  const opTijd = met.every((x, i) => i === 0 || x[0] >= met[i - 1][0]);
  ok(`${naam}: met jitter dezelfde berichten per control in dezelfde volgorde, het plan op tijd gesorteerd`, gelijk && opTijd);
}

// 4. Een loslaten komt na zijn indrukken, en vóór de volgende druk op dezelfde knop.
for (const naam of ['pads', 'shift', 'mapje']) {
  let goed = true;
  for (let zaad = 1; zaad <= 20; zaad++) {
    const open = new Map();
    for (const [, a, b] of maakPlan(naam, { duur: 3000, zaad })) {
      const k = b, aan = (a & 0xf0) === 0x90, uit = (a & 0xf0) === 0x80;
      if (aan) { if (open.get(k)) goed = false; open.set(k, true); }
      if (uit) { if (!open.get(k)) goed = false; open.set(k, false); }
    }
  }
  ok(`${naam}: elke druk wordt losgelaten vóór de volgende druk op die knop (20 zaden)`, goed);
}

// 5. De fase t.o.v. een beeld (60 Hz): zonder jitter staat de fader op twee vaste plekken, met jitter verspreid.
const vakken = (plan, n = 8) => { const v = new Array(n).fill(0); for (const [t] of plan) v[Math.floor(((t % BEELD_MS) / BEELD_MS) * n) % n]++; return v; };
{
  // Afstand tot 0 of een half beeld (met omslag), in ms: zonder jitter valt alles daarop.
  const naarVast = (t) => { const f = t % BEELD_MS; return Math.min(f, Math.abs(f - BEELD_MS / 2), BEELD_MS - f); };
  const zonder = Math.max(...maakPlan('fader', { duur: 4000, jitter: false }).map(([t]) => naarVast(t)));
  const met = vakken(maakPlan('fader', { duur: 4000, zaad: 1 }));
  ok('fader zonder jitter: alle berichten op twee plekken in het beeld (dat maakte de p50 per ronde toeval)', zonder < 0.001, `tot ${zonder} ms ernaast`);
  ok('fader met jitter: in elk achtste van een beeld vallen berichten (min ≥ 5% van het totaal)', Math.min(...met) >= 0.05 * 480, met.join(','));
  const eerste = [];
  for (let zaad = 1; zaad <= 16; zaad++) eerste.push(maakPlan('fader', { duur: 1000, zaad })[0][0] % BEELD_MS);
  ok('fader: de beginfase verschilt per ronde (16 zaden spreiden over > 10 ms van een beeld)', Math.max(...eerste) - Math.min(...eerste) > 10, eerste.map((x) => x.toFixed(1)).join(','));
}

// 6. latentie.mjs gebruikt deze plannen (geen tweede kopie die kan afwijken) en geeft het zaad mee.
{
  const bron = readFileSync(new URL('../tools/headless/latentie.mjs', import.meta.url), 'utf8');
  ok('latentie.mjs haalt zijn plannen uit latentie-plan.mjs en schrijft zaad en jitter in de uitkomst',
    /from '\.\/latentie-plan\.mjs'/.test(bron) && /maakPlan\(naam, \{ duur: DUUR, zaad: ZAAD, jitter: JITTER \}\)/.test(bron)
    && /zaad: ZAAD, jitter: JITTER/.test(bron) && !/function sweep\(/.test(bron));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
