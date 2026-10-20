/**
 * M3 — van handeling tot het eerste geluid, zonder de uitgangsbuffer van het apparaat.
 *
 *   node v2/meting/latentie.mjs [aantal]
 *
 * Een toon (sinus, constant) op track 1. Een opnemer-worklet op de strip (na het filter)
 * meldt per blok de audiokloktijd van de eerste sample boven een drempel. We doen een
 * handeling via de bus op een willekeurig moment en meten audioklok(eerste geluid) −
 * audioklok(handeling): wat de engine en de motor samen toevoegen. Daar komt op het
 * apparaat nog outputLatency bij (die staat erbij, maar is van het apparaat, niet van ons).
 * Gemeten handelingen: play (start), kill laag (dicht) en fader (dicht).
 */
import { opzet, LAAD_IN_PAGINA, stats } from './gemeen.mjs';

const N = Number(process.argv[2] || 40);
const o = await opzet({ poort: 8801 });
try {
  await o.page.evaluate(LAAD_IN_PAGINA);
  const uit = await o.page.evaluate(async (N) => {
    const e = window.varve, slaap = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__laad(1, { toon: 100, duur: 600 });
    const code = `registerProcessor('wachter', class extends AudioWorkletProcessor {
      constructor() { super(); this.vorig = 0; this.port.onmessage = () => { this.vorig = -1; }; }
      process(ins) {
        const x = ins[0][0];
        if (!x) return true;
        for (let i = 0; i < x.length; i++) {
          const a = Math.abs(x[i]);
          const aan = a > 0.003;   // −50 dBFS: het begin van de inloop
          if (this.vorig !== -1 && aan !== (this.vorig > 0.003)) { this.port.postMessage({ t: (currentFrame + i) / sampleRate, aan }); }
          this.vorig = a;
        }
        return true;
      } });`;
    await e.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const w = new AudioWorkletNode(e.ctx, 'wachter');
    e.track(1).strip.naFilter.connect(w);
    const omslagen = [];
    w.port.onmessage = (m) => omslagen.push(m.data);
    const wachtOp = async (aan, na, max = 1) => {
      const t0 = performance.now();
      while (performance.now() - t0 < max * 1000) {
        const x = omslagen.find((o) => o.aan === aan && o.t >= na - 0.0005);
        if (x) return x.t;
        await slaap(5);
      }
      return null;
    };
    const res = { play: [], kill: [], fader: [] };
    for (let k = 0; k < N; k++) {
      await slaap(150 + Math.random() * 200);
      // play: van stil naar geluid
      omslagen.length = 0;
      let t = e.ctx.currentTime;
      e.bus.doe('track.1.play', true);
      let g = await wachtOp(true, t);
      if (g !== null) res.play.push((g - t) * 1000);
      await slaap(120 + Math.random() * 100);
      // fader dicht: van geluid naar stil (fader 0 = echte stilte, maar de naFilter-tap zit vóór de fader: meet daarom kill)
      omslagen.length = 0;
      t = e.ctx.currentTime;
      e.bus.doe('track.1.kill.laag', true);   // 100 Hz zit in de lage band: kill = −70 dB
      g = await wachtOp(false, t);
      if (g !== null) res.kill.push((g - t) * 1000);
      e.bus.doe('track.1.kill.laag', true);   // terug open
      await slaap(150);
      e.bus.doe('track.1.play', true);         // pauze
      await slaap(120);
    }
    return { res, base: e.ctx.baseLatency, uit: e.ctx.outputLatency, sr: e.ctx.sampleRate };
  }, N);
  const rapport = {
    play_ms: stats(uit.res.play),
    kill_ms: stats(uit.res.kill),
    apparaat_ms: { baseLatency: uit.base * 1000, outputLatency: uit.uit * 1000 },
    let_op: 'kill meet tot het geluid onder −50 dBFS zakt: de S-overgang van 5 ms zit erin. play meet tot het begin van de inloop (4 ms).',
  };
  console.log(JSON.stringify(rapport, null, 2));
  const ok = rapport.play_ms.p95 <= 10 && rapport.play_ms.spreiding <= 3;
  console.log(ok ? 'M3 GESLAAGD (play: p95 ≤ 10 ms, spreiding ≤ 3 ms)' : 'M3 NIET GEHAALD');
  if (o.fouten.length) console.log('fouten in de pagina:', o.fouten);
  process.exitCode = ok ? 0 : 1;
} finally { await o.sluit(); }
