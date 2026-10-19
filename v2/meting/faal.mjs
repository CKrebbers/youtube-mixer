/**
 * M7 + M8 — geheugen per track en herstel na verstoringen, in headless Chrome.
 *
 *   node v2/meting/faal.mjs
 *
 * M7  een nummer van 31 minuten laden (zoals het ADRIANA-album in v1): hoeveel geheugen?
 * M8a tabblad op de achtergrond: timers worden geknepen. Blijft een gekoppelde track over
 *     een grens van zijn tempokaart heen op de klok? (de motor speelt wat gepland is)
 * M8b een fout in de worklet van de afspeelmotor: komt er binnen 1 s een melding?
 * M8c de AudioContext gepauzeerd (zoals na slaap): zie je het, en komt hij terug?
 * Niet hier: de Scarlett eruit trekken (alleen op de Mac, zie MAC.md).
 */
import { opzet, LAAD_IN_PAGINA } from './gemeen.mjs';

const o = await opzet({ poort: 8803 });
const r = {};
try {
  await o.page.evaluate(LAAD_IN_PAGINA);
  const geheugen = async () => {
    await o.cdp.send('HeapProfiler.collectGarbage');
    return o.page.evaluate(async () => (await performance.measureUserAgentSpecificMemory()).bytes / 1e6);
  };

  // ---- M7 ------------------------------------------------------------------------
  const voor = await geheugen();
  await o.page.evaluate(() => window.__laad(1, { toon: 220, duur: 31 * 60 }));
  const na = await geheugen();
  r.M7 = { nummerMinuten: 31, extraMB: +(na - voor).toFixed(1), grens: 50, geslaagd: na - voor <= 50 };

  // ---- M8a -------------------------------------------------------------------------
  await o.page.evaluate(async () => {
    const e = window.varve;
    await window.__laad(2, { demo: 'demo-124', duur: 600 });
    await window.__laad(3, { demo: 'demo-wissel', duur: 600 });   // 126 → 132 op 60 s
    e.bus.doe('track.2.play', true);
    await new Promise((r) => setTimeout(r, 300));
    e.bus.doe('track.3.seek', 40 / 600);
    e.bus.doe('track.3.play', true);
    e.bus.doe('track.3.sync', true);
    // Tel hoe vaak de engine vooruit plant.
    window.__tikken = 0;
    const tik = e.tik.bind(e);
    e.tik = () => { window.__tikken++; tik(); };
  });
  const tweede = await o.browser.newPage();
  await tweede.goto('about:blank');
  await tweede.bringToFront();
  await o.page.waitForTimeout(1000);
  const zicht = await o.page.evaluate(() => document.visibilityState);
  const t0 = Date.now();
  await o.page.waitForTimeout(45000);
  // Gemeten terwijl hij nog verborgen is: wat de motor speelt (de laatst geplande segmenten)
  // tegen waar de track hoort te zijn.
  r.M8a = await o.page.evaluate(() => {
    const e = window.varve, t = e.track(3), nu = e.nu();
    let grootste = 0;
    for (let dt = 0; dt < 2; dt += 0.05) {
      const echt = t.plek(nu + dt), motor = t.speler.positie(nu + dt);
      grootste = Math.max(grootste, Math.abs(echt - motor));
    }
    return { plekNu: t.plek(nu), voorbijGrens: t.plek(nu) > 60, tikkenVerborgen: window.__tikken, grootsteAfwijkingMs: +(grootste * 1000).toFixed(3) };
  });
  r.M8a.zichtbaarheid = zicht;
  r.M8a.secondenVerborgen = Math.round((Date.now() - t0) / 1000);
  r.M8a.geslaagd = r.M8a.grootsteAfwijkingMs <= 1;
  await o.page.bringToFront();
  await tweede.close();

  // ---- M8b -------------------------------------------------------------------------
  r.M8b = await o.page.evaluate(async () => {
    const e = window.varve;
    const t0 = performance.now();
    const melding = new Promise((res) => e.on('melding', (m) => { if (/afspeelmotor/.test(m.tekst)) res(performance.now() - t0); }));
    // Een plan dat de worklet niet kan lezen: zo'n bericht kan in de praktijk alleen door een fout komen.
    e.track(2).speler.node.port.postMessage({ type: 'plan', segmenten: [{ T: 'x' }] });
    const ms = await Promise.race([melding, new Promise((r) => setTimeout(() => r(null), 2000))]);
    return { meldingNaMs: ms === null ? null : Math.round(ms), geslaagd: ms !== null && ms <= 1000 };
  });

  // ---- M8c -------------------------------------------------------------------------
  r.M8c = await o.page.evaluate(async () => {
    const e = window.varve;
    const meldingen = [];
    e.on('melding', (m) => meldingen.push(m.tekst));
    await e.ctx.suspend();
    await new Promise((r) => setTimeout(r, 500));
    const knop = document.querySelector('#start');
    const zichtbaar = !knop.hidden;
    const engineMeldt = meldingen.some((m) => /audio|geluid|stil/i.test(m));
    // Een handeling (zoals een druk op de APC): komt het geluid vanzelf terug?
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const naHandeling = e.ctx.state;
    knop.click();
    await new Promise((r) => setTimeout(r, 500));
    return { knopGeluidAanZichtbaar: zichtbaar, meldingVanDeEngine: engineMeldt, naEenHandeling: naHandeling, naDeKnop: e.ctx.state,
      geslaagd: zichtbaar && engineMeldt && naHandeling === 'running' };
  });
} finally { await o.sluit(); }
r.fouten = o.fouten.filter((f) => !/afspeelmotor|varve-speler|fout/i.test(f)).slice(0, 10);
console.log(JSON.stringify(r, null, 2));
