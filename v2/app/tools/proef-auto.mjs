/**
 * Proef in echte Chrome (headless): de auto-DJ maakt met de demonummers van de app een overgang
 * van begin tot eind, via de bus met bron 'auto'.
 *
 *   node tools/proef-auto.mjs [--scherm uit.png]
 *
 * Gemeten:
 *   - de inkomende valt op de "1": het eerste geluid van de nieuwe (zijn speler, vóór de fader)
 *     tegen het begin van de overgang op de klok, en zijn kicks tegen die van de uitgaande;
 *   - nooit twee bassen open: elke 5 ms, op de knoppen (wat de automaat zette) en op de
 *     AudioParams zelf (lowshelf > −20 dB, fader open, geen highpass boven 150 Hz);
 *   - nooit stilte: de langste stilte op de master (na de limiter) vanaf de eerste klank;
 *   - wat er over de bus ging: hoeveel acties met bron 'auto', en dat niets anders van hem kwam.
 * Gebruikt de automaat van de app als die er is (window.varveAuto), anders maakt hij er een met
 * de library van de app (window.varveLibrary) en drie demonummers.
 * Playwright staat globaal (deze machine: /opt/node22; elders PLAYWRIGHT_MODULE).
 */
import { opzet } from '../../meting/gemeen.mjs';

const POORT = 8821;
const schermPad = process.argv.includes('--scherm') ? process.argv[process.argv.indexOf('--scherm') + 1] : null;
const p = await opzet({ poort: POORT });
const { page, fouten } = p;

try {
  const uitslag = await page.evaluate(async () => {
    const e = window.varve, lib = window.varveLibrary, bus = e.bus;
    const slaap = (ms) => new Promise((r) => setTimeout(r, ms));
    const { Automaat } = await import('/src/auto/automaat.js');
    const { definieerAuto } = await import('/src/engine/acties-auto.js');
    const { maakLaad } = await import('/src/ui/auto-paneel.js');
    const { basOpen } = await import('/src/auto/planner.js');
    const DEMO = ['demo-124', 'demo-128', 'demo-122'];
    let a = window.varveAuto;
    if (!a) {
      a = new Automaat({ engine: e, nummers: () => [...lib.nummers.values()].filter((x) => DEMO.includes(x.id)), laad: maakLaad({ engine: e, library: lib }), rnd: () => 0 });
      if (!bus.heeft('auto.aan')) definieerAuto(bus, a);
      window.varveAuto = a;
    }
    const acties = [];
    bus.on('actie', ({ id, v, bron }) => acties.push({ t: e.ctx.currentTime, id, v, bron }));

    // Een opnemer: de speler van track 1 en 2 (vóór de strip), om te horen wanneer de nieuwe begint.
    const code = `registerProcessor('auto-opnemer', class extends AudioWorkletProcessor {
      constructor(o) { super(); this.n = o.processorOptions.n; this.a = new Float32Array(this.n); this.b = new Float32Array(this.n); this.i = 0; this.t0 = null; }
      process(ins) {
        if (this.i >= this.n) return false;
        if (this.t0 === null) this.t0 = currentTime;
        const a = ins[0][0], b = ins[1][0];
        for (let k = 0; k < 128 && this.i < this.n; k++, this.i++) { this.a[this.i] = a ? a[k] : 0; this.b[this.i] = b ? b[k] : 0; }
        if (this.i >= this.n) this.port.postMessage({ a: this.a, b: this.b, t0: this.t0 });
        return true;
      } });`;
    // De stilte op de master, op de samples zelf (een timer die de analyser uitleest ziet headless
    // ook "stilte" als een beeld te laat komt: met één demo zonder automaat tot 80 ms). Per 10 ms
    // de piek; de langste reeks vensters onder −60 dBFS na het eerste geluid.
    const stilCode = `registerProcessor('auto-stil', class extends AudioWorkletProcessor {
      constructor() { super(); this.p = 0; this.k = 0; this.reeks = 0; this.max = 0; this.op = 0; this.begon = false;
        this.port.onmessage = () => this.port.postMessage({ maxMs: this.max * 10, op: this.op }); }
      process(ins) {
        const x = ins[0][0];
        for (let i = 0; i < 128; i++) {
          const v = x ? Math.abs(x[i]) : 0; if (v > this.p) this.p = v;
          if (++this.k === 480) {
            if (this.p > 1e-3) { this.begon = true; this.reeks = 0; }
            else if (this.begon && ++this.reeks > this.max) { this.max = this.reeks; this.op = currentTime; }
            this.p = 0; this.k = 0;
          }
        }
        return true;
      } });`;
    await e.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code + stilCode], { type: 'text/javascript' })));
    const stil = new AudioWorkletNode(e.ctx, 'auto-stil', { numberOfInputs: 1, numberOfOutputs: 0 });
    e.mixer.analyser.connect(stil);
    const leesStil = () => new Promise((r) => { stil.port.onmessage = (m) => r(m.data); stil.port.postMessage(0); });
    const neemOp = (sec) => new Promise((klaar) => {
      const node = new AudioWorkletNode(e.ctx, 'auto-opnemer', { numberOfInputs: 2, numberOfOutputs: 0, processorOptions: { n: Math.round(sec * e.ctx.sampleRate) } });
      e.track(1).speler.node.connect(node, 0, 0);
      e.track(2).speler.node.connect(node, 0, 1);
      node.port.onmessage = (m) => { e.track(1).speler.node.disconnect(node); e.track(2).speler.node.disconnect(node); klaar(m.data); };
    });

    // Elke 5 ms: twee bassen (knoppen en AudioParams).
    const meting = { tweeKnop: 0, tweeParam: 0, metingen: 0, fasen: [] };
    let fase = '';
    const kijk = setInterval(() => {
      const nu = e.ctx.currentTime;
      if (a.fase !== fase) { fase = a.fase; meting.fasen.push([Math.round(nu * 100) / 100, fase]); }
      let knop = 0, param = 0;
      for (const t of e.tracks) {
        if (!t.speeltOp(nu) || !e.hoorbaar(t.n)) continue;
        if (basOpen({ fader: t.strip.lees('fader'), laag: t.strip.lees('laag'), filter: t.strip.lees('filter') })) knop++;
        const n = t.strip.nodes;
        if (n.laag.gain.value > -20 && n.fader.gain.value > 0.003 && n.hpf.frequency.value < 150) param++;
      }
      meting.metingen++;
      if (knop > 1) meting.tweeKnop++;
      if (param > 1) meting.tweeParam++;
    }, 5);

    // De AUTO-rij op het scherm (zoals de app hem straks heeft), bovenaan over de pagina.
    let rij = document.querySelector('.auto-rij');
    if (!rij) {
      const { opzetAutoPaneel } = await import('/src/ui/auto-paneel.js');
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/src/ui/auto-paneel.css'; document.head.append(css);
      rij = document.createElement('div');
      rij.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99;background:var(--vlak)';
      document.body.append(rij);
      opzetAutoPaneel({ automaat: a, bus, paneel: rij });
    }
    const tekst = () => rij.textContent.replace(/\s+/g, ' ').trim();
    bus.doe('auto.aan', true, { bron: 'proef' });
    // Wachten tot hij speelt en de volgende klaarstaat.
    for (let i = 0; i < 400 && !(a.fase === 'klaar' && a.volgende?.moment); i++) await slaap(25);
    if (a.fase !== 'klaar') { clearInterval(kijk); return { fout: `de automaat staat niet klaar (${a.fase})`, meting }; }
    // Korter wachten: de uitgaande naar 45% (Clay mag de hoofdtrack verzetten; de automaat plant opnieuw).
    const seekT = Math.round(e.ctx.currentTime * 1000) / 1000;
    bus.doe(`track.${a.hoofd}.seek`, 0.45, { bron: 'proef' });
    await slaap(300);
    const v = a.volgende;
    const type = v.overgang.type, m = { ...v.moment };
    const startT = m.opKlok ? e.klok.tijd(m.start) : null;
    await slaap(300);
    const rijKlaar = tekst();
    // Opnemen vanaf 1 s vóór het begin, 5 s lang.
    while (e.ctx.currentTime < (startT ?? 0) - 1.2) await slaap(20);
    const klaar = new Promise((r) => { const los = a.on('overgang', ({ n }) => { if (n === v.n) { los(); r(true); } }); setTimeout(() => r(false), 120000); });
    const o = await neemOp(5);
    const rijBezig = tekst();
    await klaar;
    await slaap(1000);
    clearInterval(kijk);
    const st = await leesStil();
    meting.stilMax = st.maxMs;
    meting.stilOp = Math.round(st.op * 1000) / 1000;
    e.mixer.analyser.disconnect(stil);

    // Eerste geluid van de nieuwe tegen het begin op de klok.
    const sr = e.ctx.sampleRate;
    let eerste = -1;
    for (let i = 0; i < o.b.length; i++) if (Math.abs(o.b[i]) > 0.01) { eerste = i; break; }
    const eersteT = eerste >= 0 ? o.t0 + eerste / sr : null;
    // De kicks van de nieuwe tegen die van de uitgaande, na het begin (kruiscorrelatie van de stijgende energie).
    const vak = 12, van = Math.max(0, Math.round(((startT ?? o.t0) - o.t0 + 0.05) * sr));
    const env = (x) => { const n = Math.floor((x.length - van) / vak), u = new Float64Array(n); let vorige = 0; for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < vak; k++) s += x[van + j * vak + k] ** 2; u[j] = Math.max(0, s - vorige); vorige = s; } return u; };
    const ea = env(o.a), eb = env(o.b);
    const max = Math.floor((60 / e.klok.bpm(e.ctx.currentTime) / 2) * sr / vak);
    let best = 0, bestL = 0;
    for (let L = -max; L <= max; L++) { let s = 0; for (let j = max; j < ea.length - max; j++) s += ea[j] * eb[j + L]; if (s > best) { best = s; bestL = L; } }
    const vanAuto = acties.filter((x) => x.bron === 'auto');
    return {
      type, redenen: v.overgang.redenen, moment: m, van: v.van, nummer: v.nummer.id,
      startT, eersteT, inzetMs: eersteT !== null && startT !== null ? (eersteT - startT) * 1000 : null,
      kickMs: (bestL * vak / sr) * 1000,
      eindHoofd: a.hoofd, fase: a.fase, geschiedenis: a.geschiedenis.map((g) => `${g.wat}:${g.soort ?? ''}:${g.n}`),
      seekOp: seekT, rijKlaar, rijBezig, meting, acties: { totaal: acties.length, auto: vanAuto.length, perId: Object.entries(vanAuto.reduce((o2, x) => { const k = x.id.replace(/^track\.\d+\./, 'track.N.'); o2[k] = (o2[k] ?? 0) + 1; return o2; }, {})) },
      bpm: e.klok.bpm(e.ctx.currentTime), ctx: { sr, base: e.ctx.baseLatency, uit: e.ctx.outputLatency },
    };
  });
  if (schermPad) await page.screenshot({ path: schermPad });
  console.log(JSON.stringify(uitslag, null, 2));
  const u = uitslag;
  const regels = [
    ['een overgang van begin tot eind', !u.fout && u.eindHoofd === 2],
    ['een blend (de demo\'s hebben zekere grids, 124 en 122/128)', u.type === 'blend'],
    ['de nieuwe valt op de "1": eerste geluid ≤ 5 ms na het begin op de klok', u.inzetMs !== null && u.inzetMs >= -1 && u.inzetMs <= 5],
    ['zijn kicks op die van de uitgaande (≤ 1 ms)', Math.abs(u.kickMs) <= 1],
    ['nooit twee bassen (knoppen)', u.meting?.tweeKnop === 0],
    ['nooit twee bassen (AudioParams)', u.meting?.tweeParam === 0],
    ['nooit stilte op de master (langste < 50 ms)', u.meting?.stilMax < 50],
    ['de automaat stuurde via de bus met bron auto', u.acties?.auto > 20],
    ['de AUTO-rij zegt wat er komt en dat hij mixt', /klaar/.test(u.rijKlaar ?? '') && /over \d+ maten/.test(u.rijKlaar ?? '') && /mixt/.test(u.rijBezig ?? '')],
    ['geen fouten in de pagina', !fouten.length],
  ];
  for (const [wat, ok] of regels) console.log(`${ok ? 'ok  ' : 'FOUT'} ${wat}`);
  if (fouten.length) console.log(`fouten in de pagina:\n${fouten.join('\n')}`);
  const ok = regels.every(([, x]) => x);
  console.log(ok ? 'GESLAAGD: een automatische blend op de "1", nooit twee bassen, nooit stilte' : 'MISLUKT');
  process.exitCode = ok ? 0 : 1;
} finally {
  await p.sluit();
}
