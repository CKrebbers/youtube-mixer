/**
 * Proef in echte Chrome (headless, OfflineAudioContext met VIER kanalen): doet de koptelefoon wat
 * hij belooft? De echte strip en de echte mixer (met de limiter-worklet), een toon van 440 Hz in
 * track 1, steeds 2 s gerenderd:
 *
 *   1. VOORBELUISTEREN MET DE FADER DICHT: de zaal (1/2) is stil (echt 0), de koptelefoon (3/4)
 *      geeft de toon op het koptelefoonvolume. Grens: zaal = 0, koptelefoon binnen 0,1 dB.
 *   2. CUE EN ZAAL GELIJK: fader open, voorbeluisteren, mix 0. De cue loopt even laat als de zaal
 *      (de vooruitblik van de limiter): kanaal 3 ÷ koptelefoongain = kanaal 1 ÷ mastergain, sample
 *      voor sample. Grens: grootste verschil < 1e-4 (een kamfilter in de mix zou dat ver overschrijden).
 *   3. GEEN CUE = DE ZAAL: niets voorbeluisterd, dan is de koptelefoon de zaal (× zijn volume).
 *   4. OMGEWISSELD: de zaal op 3/4, de koptelefoon op 1/2.
 *   5. TWEE KANALEN: dan bestaat de koptelefoon niet, en de master is bit voor bit dezelfde als
 *      zonder de koptelefoon in de code (een render met koptelefoon: false als referentie).
 *
 *   node tools/proef-koptelefoon.mjs [--json]
 *
 * Playwright staat globaal op de machine; de app zelf heeft geen afhankelijkheden. Schrijft niets.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const POORT = 8794;
const alsJson = process.argv.includes('--json');

const data = mkdtempSync(join(tmpdir(), 'varve-v2-proef-kop-'));
const { maakServer } = await import('../server.mjs');
const server = maakServer({ media: '/geen-media', data });
await new Promise((r) => server.listen(POORT, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const fouten = [];
page.on('pageerror', (e) => fouten.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
await page.route('**/proef/leeg.html', (r) => r.fulfill({
  status: 200, contentType: 'text/html; charset=utf-8',
  headers: { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' },
  body: '<!doctype html><meta charset="utf-8"><title>proef-koptelefoon</title><body></body>',
}));

let uit, ok;
try {
  await page.goto(`http://127.0.0.1:${POORT}/proef/leeg.html`);
  uit = await page.evaluate(async () => {
    const SR = 48000, N = 2 * SR;
    const { maakMixer } = await import('/src/audio/mixer.js');
    const { maakStrip, faderGain } = await import('/src/audio/strip.js');

    async function render({ kanalen = 4, fader = 1, pfl = false, mix = 0, volume = 1, omgewisseld = false, koptelefoon = true }) {
      const ctx = new OfflineAudioContext(kanalen, N, SR);
      const m = maakMixer(ctx, { omgewisseld, koptelefoon });
      await m.klaar;
      const st = maakStrip(ctx, m);
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const g = ctx.createGain(); g.gain.value = 0.3;
      osc.connect(g); g.connect(st.in); osc.start(0);
      st.zet('fader', fader);
      if (m.koptelefoon?.beschikbaar) { m.koptelefoon.zetVolume(volume); m.koptelefoon.zetMix(mix); }
      if (pfl) st.pfl(true);
      const buf = await ctx.startRendering();
      return { kanalen: Array.from({ length: kanalen }, (_, i) => buf.getChannelData(i)), m, beschikbaar: !!m.koptelefoon?.beschikbaar, soort: m.soort };
    }
    // Vanaf 0,2 s: na de hellingen van 5 ms, de setTargetAtTime van de knoppen en de inloop van de limiter.
    const VAN = Math.round(0.2 * SR);
    const rms = (a) => { let s = 0; for (let i = VAN; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length - VAN)); };
    const piek = (a) => { let p = 0; for (let i = VAN; i < a.length; i++) p = Math.max(p, Math.abs(a[i])); return p; };
    const db = (x) => 20 * Math.log10(x);
    const r = {};

    // 1. Fader dicht, voorbeluisteren.
    {
      const k = await render({ fader: 0, pfl: true, volume: 0.8 });
      const verwacht = (0.3 / Math.SQRT2) * faderGain(0.8);
      r.dicht = { limiter: k.soort, zaalPiek: piek(k.kanalen[0]), kopDb: db(rms(k.kanalen[2])), verwachtDb: db(verwacht) };
      r.dicht.ok = r.dicht.zaalPiek === 0 && Math.abs(r.dicht.kopDb - r.dicht.verwachtDb) < 0.1 && k.beschikbaar;
    }
    // 2. Fader open, voorbeluisteren, mix 0: cue en zaal liggen op elkaar.
    {
      const k = await render({ fader: 1, pfl: true, mix: 0, volume: 0.8 });
      const kg = faderGain(0.8), mg = faderGain(0.8);   // koptelefoonvolume en master (beginstand 0,8)
      let grootste = 0;
      for (let i = VAN; i < N; i++) grootste = Math.max(grootste, Math.abs(k.kanalen[2][i] / kg - k.kanalen[0][i] / mg));
      // Ter vergelijking: hetzelfde verschil als de cue NIET vertraagd zou zijn (72 samples eerder).
      const d = Math.round(k.m.vertraging * SR);
      let zonder = 0;
      for (let i = VAN; i < N - d; i++) zonder = Math.max(zonder, Math.abs(k.kanalen[2][i + d] / kg - k.kanalen[0][i] / mg));
      r.gelijk = { limiter: k.soort, vertragingSamples: d, grootsteVerschil: grootste, alsNietVertraagd: zonder, ok: grootste < 1e-4 };
    }
    // 3. Geen cue: de koptelefoon is de zaal.
    {
      const k = await render({ fader: 1, pfl: false, volume: 1 });
      let grootste = 0;
      for (let i = VAN; i < N; i++) grootste = Math.max(grootste, Math.abs(k.kanalen[2][i] - k.kanalen[0][i]), Math.abs(k.kanalen[3][i] - k.kanalen[1][i]));
      r.zaal = { grootsteVerschil: grootste, zaalDb: db(rms(k.kanalen[0])), ok: grootste < 1e-6 && rms(k.kanalen[0]) > 0.01 };
    }
    // 4. Omgewisseld.
    {
      const k = await render({ fader: 0, pfl: true, volume: 1, omgewisseld: true });
      r.omgewisseld = { zaalOp34Piek: piek(k.kanalen[2]), kopOp12Db: db(rms(k.kanalen[0])) };
      r.omgewisseld.ok = r.omgewisseld.zaalOp34Piek === 0 && rms(k.kanalen[0]) > 0.01;
    }
    // 5. Twee kanalen: bit voor bit dezelfde master als zonder koptelefoon.
    {
      const a = await render({ kanalen: 2, fader: 1 });
      const b = await render({ kanalen: 2, fader: 1, koptelefoon: false });
      let gelijk = true;
      for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) if (a.kanalen[c][i] !== b.kanalen[c][i]) { gelijk = false; break; }
      r.tweeKanalen = { beschikbaar: a.beschikbaar, bitVoorBit: gelijk, ok: !a.beschikbaar && gelijk };
    }
    return r;
  });
  ok = Object.values(uit).every((x) => x.ok) && fouten.length === 0;
} finally {
  await browser.close();
  server.close();
  rmSync(data, { recursive: true, force: true });
}

if (alsJson) console.log(JSON.stringify({ ...uit, fouten }, null, 2));
else {
  const f = (v, n = 2) => v.toFixed(n).replace('.', ',');
  const ja = (x) => (x ? 'ok' : 'FOUT');
  console.log('proef-koptelefoon: OfflineAudioContext met vier kanalen, 48 kHz, de echte strip en mixer\n');
  console.log(`1. fader dicht, voorbeluisteren (${uit.dicht.limiter}): zaal piek ${uit.dicht.zaalPiek}, koptelefoon ${f(uit.dicht.kopDb)} dB (verwacht ${f(uit.dicht.verwachtDb)})  ${ja(uit.dicht.ok)}`);
  console.log(`2. cue en zaal (${uit.gelijk.limiter}, vertraging ${uit.gelijk.vertragingSamples} samples): grootste verschil ${uit.gelijk.grootsteVerschil.toExponential(2)} (onvertraagd zou het ${uit.gelijk.alsNietVertraagd.toExponential(2)} zijn)  ${ja(uit.gelijk.ok)}`);
  console.log(`3. geen cue: koptelefoon = zaal, grootste verschil ${uit.zaal.grootsteVerschil.toExponential(2)}  ${ja(uit.zaal.ok)}`);
  console.log(`4. omgewisseld: 3/4 piek ${uit.omgewisseld.zaalOp34Piek}, koptelefoon op 1/2 ${f(uit.omgewisseld.kopOp12Db)} dB  ${ja(uit.omgewisseld.ok)}`);
  console.log(`5. twee kanalen: koptelefoon ${uit.tweeKanalen.beschikbaar ? 'WEL' : 'niet'} gemaakt, master bit voor bit gelijk: ${uit.tweeKanalen.bitVoorBit ? 'ja' : 'NEE'}  ${ja(uit.tweeKanalen.ok)}`);
  if (fouten.length) console.log('\nFOUTEN in de pagina:\n' + fouten.join('\n'));
  console.log(`\n${ok ? 'alles binnen de grens' : 'NIET alles binnen de grens'}`);
}
process.exitCode = ok ? 0 : 1;
