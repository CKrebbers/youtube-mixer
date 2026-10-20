/**
 * De sampler in echte Chrome: knippen uit een spelend demonummer, het nummer op pauze, en dan
 * moet alleen de pad klinken (master-analyser), als lus op de klok: motor = (tel − starttel) ×
 * tellengte, ook na een tempowissel. Plus een schermafdruk (--scherm <pad>).
 */
import { opzet, LAAD_IN_PAGINA } from '../../meting/gemeen.mjs';
import { rmSync } from 'node:fs';

const schermPad = process.argv.includes('--scherm') ? process.argv[process.argv.indexOf('--scherm') + 1] : null;
const o = await opzet({ poort: 8807 });
let ok = true;
const eis = (v, wat) => { if (!v) { ok = false; console.log('NIET:', wat); } };
let uit;
try {
  await o.page.evaluate(LAAD_IN_PAGINA);
  await o.page.evaluate(() => window.varve.ctx.resume());
  uit = await o.page.evaluate(async () => {
    const e = window.varve, slaap = (ms) => new Promise((r) => setTimeout(r, ms));
    const an = e.mixer.analyser, buf = new Float32Array(an.fftSize);
    const piek = () => { an.getFloatTimeDomainData(buf); let m = 0; for (const x of buf) m = Math.max(m, Math.abs(x)); return m; };
    await window.__laad(1, { demo: 'demo-124', duur: 120 });
    e.bus.doe('track.1.play', true);
    await slaap(3000);
    const r = await e.sampler.vul(1);
    if (r?.geweigerd) return { geweigerd: r.geweigerd };
    e.bus.doe('track.1.play', true);          // pauze: nu alleen de pad
    await slaap(300);
    const stilVoor = piek();
    e.bus.doe('sampler.1', true);
    await slaap(2500);
    const klinkt = piek();
    const p = e.sampler.pad(1), Lb = p.stuk.duur / p.stuk.tellen;
    const afwijking = () => {
      let m = 0;
      for (let dt = 0; dt < 2; dt += 0.01) {
        const t = e.nu() + dt, x = (e.klok.tel(t) - p.startTel) * Lb, verwacht = x - p.stuk.duur * Math.floor(x / p.stuk.duur);
        m = Math.max(m, Math.abs(p.speler.positie(t) - verwacht));
      }
      return m;
    };
    const voor = afwijking();
    e.bus.doe('klok.tempo', (130 - 40) / 260);
    await slaap(1500);
    const na = afwijking();
    return { tellen: p.stuk.tellen, duur: p.stuk.duur, stilVoor, klinkt, afwijkingMs: voor * 1000, naWisselMs: na * 1000, klok: e.klok.bpm(e.nu()) };
  });
  eis(!uit.geweigerd, `geweigerd: ${uit.geweigerd}`);
  eis(uit.stilVoor < 0.01 && uit.klinkt > 0.05, `alleen de pad klinkt: ${uit.stilVoor} -> ${uit.klinkt}`);
  eis(uit.afwijkingMs < 1e-6 && uit.naWisselMs < 1e-6, `op de klok: ${uit.afwijkingMs} / ${uit.naWisselMs} ms`);
  eis(o.fouten.length === 0, `fouten: ${o.fouten.join('; ')}`);
  if (schermPad) await o.page.screenshot({ path: schermPad });
} finally { await o.sluit(); rmSync(o.data, { recursive: true, force: true }); }
console.log(JSON.stringify(uit, null, 2));
console.log(ok ? 'GESLAAGD: de pad klinkt alleen, als lus op de klok, ook na een tempowissel' : 'NIET GESLAAGD');
process.exitCode = ok ? 0 : 1;
