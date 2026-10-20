/**
 * Patronen in echte Chrome (headless), met de echte drums, de maatklok en het trackpaneel:
 *
 *   1. drums op track 3, focus erop, tabblad Track: de sectie PATROON staat er;
 *   2. stap voor stap bouwen met de muis: een kick (36) op 1 5 9 13, een snare (38) op 5 en 13
 *      (eerst de noot spelen, dan de stappen: een stap schrijft de laatst gespeelde noot);
 *   3. plek 1 starten: elke noot gaat naar de drums op klok.tijd(tick / PPQN), op de "1" begonnen,
 *      afwijking < 1 µs, geen noot dubbel of vergeten in 2 omlopen;
 *   4. de afspeelkop loopt mee op het scherm;
 *   5. de set staat na 1 s op de server, en is er na herladen weer;
 *   6. schermafdruk op 1440×900 (--scherm pad), geen fouten in de pagina.
 *
 *   node tools/proef-patronen.mjs [--scherm pad.png]
 */
import { opzet } from '../../meting/gemeen.mjs';
import { rmSync } from 'node:fs';

const schermPad = process.argv.includes('--scherm') ? process.argv[process.argv.indexOf('--scherm') + 1] : null;
const o = await opzet({ poort: 8861 });
const uit = {};
let ok = true;
const eis = (v, wat) => { if (!v) { ok = false; console.log('NIET:', wat); } };
try {
  const p = o.page;
  uit.sectie = await p.evaluate(async () => {
    const e = window.varve;
    await e.zetInstrument(3, 'drums');
    e.bus.doe('track.3.focus', true);
    document.querySelector('button[data-tab="track"]').click();
    await new Promise((r) => setTimeout(r, 300));
    return { sectie: !!document.querySelector('.tp-patroon'), stappen: document.querySelectorAll('.tp-patroon .tp-stappen button').length };
  });
  eis(uit.sectie.sectie && uit.sectie.stappen === 16, `sectie: ${JSON.stringify(uit.sectie)}`);
  // 2. Bouwen met de muis.
  const stap = (s) => p.click(`.tp-stappen button[data-actie="track.3.patroon.stap.${s}"]`);
  await p.evaluate(() => window.varve.noot(36, 1, { n: 3 }));
  for (const s of [1, 5, 9, 13]) await stap(s);
  await p.evaluate(() => window.varve.noot(38, 1, { n: 3 }));
  for (const s of [5, 13]) await stap(s);
  uit.noten = await p.evaluate(() => window.varve.patronen.bewerkt(3).noten.map((n) => [n.stap, n.noot]));
  eis(JSON.stringify(uit.noten) === JSON.stringify([[0, 36], [4, 36], [4, 38], [8, 36], [12, 36], [12, 38]]), `noten: ${JSON.stringify(uit.noten)}`);
  // 3. Starten op de 1 en de tijden van elke noot.
  uit.spel = await p.evaluate(async () => {
    const e = window.varve, inst = e.track(3).instrument.inst, P = e.patronen;
    const gezien = [];
    const orig = inst.noteOn.bind(inst);
    inst.noteOn = (noot, v, t) => { gezien.push([noot, t]); return orig(noot, v, t); };
    e.klok.loopt || e.zetKlokTempo(120, e.straks());
    e.bus.doe('track.3.patroon.1', true);
    const s = P.spel.get(3);
    const tPer = 96, start = s.start;                        // zestienden: 96 ticks
    await new Promise((r) => setTimeout(r, 4600));           // ruim twee omlopen van 2 s
    const kop = !!document.querySelector('.tp-stappen button.kop');
    e.bus.doe('patronen.stop', true);
    // Wat er had moeten klinken in de eerste twee omlopen.
    const verwacht = [];
    for (let om = 0; om < 2; om++) for (const n of P.bewerkt(3).noten) verwacht.push([n.noot, e.klok.tijd((start + om * 16 * tPer + n.stap * tPer) / 384)]);
    const eerste2 = gezien.filter(([, t]) => t < e.klok.tijd((start + 2 * 16 * tPer) / 384) - 1e-9);
    let grootste = 0;
    for (const [noot, t] of verwacht) {
      const m = eerste2.filter((x) => x[0] === noot).map((x) => Math.abs(x[1] - t));
      grootste = Math.max(grootste, m.length ? Math.min(...m) : Infinity);
    }
    return { opDe1: start % (4 * 384) === 0, geteld: eerste2.length, verwacht: verwacht.length, grootsteUs: grootste * 1e6, kop };
  });
  eis(uit.spel.opDe1 && uit.spel.geteld === uit.spel.verwacht && uit.spel.grootsteUs < 1 && uit.spel.kop, `spelen: ${JSON.stringify(uit.spel)}`);
  // 5. Bewaard en terug na herladen.
  await p.waitForTimeout(1500);
  uit.server = await p.evaluate(() => fetch('/api/v2/instelling/patronen').then((r) => r.json()).then((s) => s?.patronen?.find((x) => x.track === 3 && x.plek === 1)?.noten.length ?? 0));
  if (schermPad) await p.screenshot({ path: schermPad });
  await p.reload();
  await p.waitForFunction(() => window.varve);
  await p.waitForTimeout(800);
  uit.terug = await p.evaluate(() => window.varve.patronen.patroon(3, 1)?.noten.length ?? 0);
  eis(uit.server === 6 && uit.terug === 6, `bewaard ${uit.server}, na herladen ${uit.terug}`);
  uit.fouten = o.fouten.filter((f) => !/Web MIDI/.test(f));
  eis(uit.fouten.length === 0, `fouten in de pagina: ${uit.fouten.join('; ')}`);
} finally {
  await o.sluit();
  rmSync(o.data, { recursive: true, force: true });
}
console.log(JSON.stringify(uit, null, 2));
console.log(ok ? 'GESLAAGD: patronen bouwen met de muis, op de 1 en op de klok gespeeld, bewaard en terug' : 'NIET GESLAAGD');
process.exitCode = ok ? 0 : 1;
