/**
 * M5 + M6 — lang draaien: gemiste audioblokken en geheugengroei.
 *
 *   node v2/meting/soak.mjs [minuten=30] [--uit rapport.json]
 *
 * Vier demonummers spelen gekoppeld; elke 2–5 s een willekeurige handeling (sync, jog,
 * tempo, kill, filter, fader, seek). Elke 10 s meten we:
 *  - GEMISTE BLOKKEN: getOutputTimestamp koppelt audioklok aan wandklok. Loopt de audioklok
 *    meer dan een blok achter op de wandklok sinds de vorige meting, dan heeft de uitgang
 *    zitten wachten (een underrun). Plus de WebAudio-meting van DevTools: renderCapacity
 *    (belasting van de audiothread, > 1 = te laat) en de spreiding van de callbacks.
 *  NULMETING (`--nul`): dezelfde meting op een kale AudioContext met één oscillator, zonder
 *    VarveDJ. Mist die evenveel blokken, dan ligt het aan het apparaat of de machine, niet aan ons.
 *  - GEHEUGEN: performance.measureUserAgentSpecificMemory (de pagina is cross-origin
 *    geïsoleerd: COOP/COEP), na een GC via DevTools. Groei per uur na 2 min opwarmen.
 * Op deze cloudmachine is de CPU gedeeld en is er geen echte geluidskaart: de gemiste
 * blokken zijn daar indicatief. Op de Mac is dit de echte meting (draai hem tijdens een set
 * NIET: hij maakt geluid en handelingen).
 */
import { writeFileSync } from 'node:fs';
import { opzet, LAAD_IN_PAGINA } from './gemeen.mjs';

const MIN = Number(process.argv[2] || 30);
const uitPad = process.argv.includes('--uit') ? process.argv[process.argv.indexOf('--uit') + 1] : null;
const NUL = process.argv.includes('--nul');
const o = await opzet({ poort: 8802 });
const reeks = [];
try {
  if (NUL) {
    await o.page.evaluate(async () => {
      try { await window.varve?.ctx?.close(); } catch { /* geen */ }
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      const osc = ctx.createOscillator(), g = ctx.createGain();
      g.gain.value = 0.1; osc.connect(g).connect(ctx.destination); osc.start();
      await ctx.resume();
      window.varve = { ctx, klok: { bpm: () => 0 }, nu: () => ctx.currentTime };
      window.__acties = 0; window.__lag0 = null;
    });
  } else await o.page.evaluate(LAAD_IN_PAGINA);
  await o.cdp.send('WebAudio.enable');
  let ctxId = null;
  o.cdp.on('WebAudio.contextCreated', (e) => { ctxId ??= e.context.contextId; });
  // Contexten die al bestonden: opnieuw aanzetten meldt ze.
  await o.cdp.send('WebAudio.disable'); await o.cdp.send('WebAudio.enable');
  if (!NUL) await o.page.evaluate(async () => {
    const e = window.varve;
    await window.__laad(1, { demo: 'demo-124', duur: 600 });
    await window.__laad(2, { demo: 'demo-128', duur: 600 });
    await window.__laad(3, { demo: 'demo-wissel', duur: 600 });
    await window.__laad(4, { demo: 'demo-122', duur: 600 });
    for (const n of [1, 2, 3, 4]) { e.bus.doe(`track.${n}.play`, true); e.bus.doe(`track.${n}.sync`, true); await new Promise((r) => setTimeout(r, 300)); }
    // Een eigen PRNG met zaad: de reeks handelingen is herhaalbaar.
    let s = 0x9e3779b9;
    const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    const acties = [
      (n) => e.bus.doe(`track.${n}.sync`, true),
      (n) => e.bus.doe(`track.${n}.jog`, 0.5 + (r() - 0.5) * 0.2),
      () => e.bus.doe('klok.tempo', (118 + r() * 12 - 40) / 260),
      (n) => e.bus.doe(`track.${n}.kill.${['laag', 'mid', 'hoog'][Math.floor(r() * 3)]}`, true),
      (n) => e.bus.doe(`track.${n}.filter`, r()),
      (n) => e.bus.doe(`track.${n}.fader`, r() < 0.2 ? 0 : 0.5 + r() * 0.5),
      (n) => e.bus.doe(`track.${n}.seek`, r() * 0.9),
      (n) => e.bus.doe(`track.${n}.nudge.voor`, true),
      (n) => e.bus.doe(`track.${n}.nudge.voor`, false),
      () => e.bus.doe('mixer.xfader', r()),
    ];
    window.__acties = 0;
    const doe = () => {
      const n = 1 + Math.floor(r() * 4);
      try { acties[Math.floor(r() * acties.length)](n); } catch (x) { console.error('actie', x); }
      window.__acties++;
      // Een track die bijna aan zijn eind is: terug naar het begin (anders speelt hij stil uit).
      for (const t of e.tracks.slice(0, 4)) if (t.geladen && t.nummer.duur - t.plek(e.nu()) < 20) t.zoek(10);
      for (const t of e.tracks.slice(0, 4)) if (t.geladen && !t.speelt) e.bus.doe(`track.${t.n}.play`, true);
      setTimeout(doe, 2000 + r() * 3000);
    };
    doe();
    window.__lag0 = null;
  });
  const meet = async () => {
    await o.cdp.send('HeapProfiler.collectGarbage');
    const p = await o.page.evaluate(async () => {
      const ts = window.varve.ctx.getOutputTimestamp();
      const lag = ts.performanceTime / 1000 - ts.contextTime;
      if (window.__lag0 === null) window.__lag0 = lag;
      let geheugen = null, waarom = null;
      try { geheugen = (await performance.measureUserAgentSpecificMemory()).bytes; } catch (x) { waarom = `${x?.name ?? x}: ${x?.message ?? ''} (crossOriginIsolated ${self.crossOriginIsolated})`; }
      return { lag: lag - window.__lag0, geheugen, waarom, acties: window.__acties, klok: window.varve.klok.bpm(window.varve.nu()) };
    });
    // De JS-heap van de pagina na de GC, exact (performance.memory is afgerond op 10 MB zonder
    // --enable-precise-memory-info). Valt measureUserAgentSpecificMemory weg (headless), dan telt deze.
    const heap = await o.cdp.send('Runtime.getHeapUsage').catch(() => null);
    p.js = heap?.usedSize ?? null;
    p.buffers = heap?.backingStorageSize ?? null;
    p.geheugen ??= p.js;
    let rt = null;
    if (ctxId) { try { rt = (await o.cdp.send('WebAudio.getRealtimeData', { contextId: ctxId })).realtimeData; } catch { rt = null; } }
    return { t: Date.now(), ...p, rt };
  };
  const start = Date.now();
  while (Date.now() - start < MIN * 60000) {
    reeks.push(await meet());
    await new Promise((r) => setTimeout(r, 10000));
  }
  reeks.push(await meet());
} finally { await o.sluit(); }

// Uitwerken.
const BLOK = 128 / 48000;
let gemist = 0, grootsteSprong = 0;
for (let i = 1; i < reeks.length; i++) {
  const d = reeks[i].lag - reeks[i - 1].lag;
  if (d > BLOK) { gemist += Math.round(d / BLOK); }
  grootsteSprong = Math.max(grootsteSprong, d);
}
const opgewarmd = reeks.filter((x) => x.t - reeks[0].t >= 120000 && x.geheugen);
let groeiPerUur = null;
if (opgewarmd.length >= 2) {
  // Kleinste-kwadratenlijn door geheugen(t): de helling, per uur.
  const xs = opgewarmd.map((x) => (x.t - opgewarmd[0].t) / 3600000), ys = opgewarmd.map((x) => x.geheugen / 1e6);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  groeiPerUur = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
}
const cap = reeks.map((x) => x.rt?.renderCapacity).filter((x) => x != null);
// Wie heeft het gemist? Een renderCapacity boven 1 = onze audiothread was te traag (onze fout);
// liep de klok achter terwijl de belasting laag bleef, dan kwam de callback van het apparaat
// zelf niet (op deze cloudmachine: de nep-geluidskaart die de CPU moet delen).
const teTraag = cap.filter((c) => c >= 1).length;
const rapport = {
  minuten: MIN, metingen: reeks.length, handelingen: reeks.at(-1).acties,
  gemisteBlokken: gemist, perUur: gemist / (MIN / 60), grootsteAchterstandMs: grootsteSprong * 1000,
  renderCapacity: cap.length ? { gem: cap.reduce((a, b) => a + b) / cap.length, max: Math.max(...cap) } : null,
  geheugenMB: { begin: reeks.find((x) => x.geheugen)?.geheugen / 1e6, eind: reeks.at(-1).geheugen / 1e6, groeiPerUur },
  teTraagMetingen: teTraag,
  geheugenBron: reeks.some((x) => x.waarom === null && x.geheugen) ? 'measureUserAgentSpecificMemory' : `JS-heap via DevTools (${reeks.find((x) => x.waarom)?.waarom ?? '?'})`,
  fouten: o.fouten.slice(0, 20),
};
console.log(JSON.stringify(rapport, null, 2));
if (uitPad) writeFileSync(uitPad, JSON.stringify({ rapport, reeks }, null, 1));
const okM5 = rapport.perUur === 0, okM6 = groeiPerUur !== null && groeiPerUur <= 20;
console.log(`M5 ${okM5 ? 'GESLAAGD' : 'NIET GEHAALD'} (${rapport.perUur.toFixed(1)} gemiste blokken per uur)`);
console.log(`M6 ${okM6 ? 'GESLAAGD' : 'NIET GEHAALD'} (${groeiPerUur?.toFixed(1)} MB per uur)`);
