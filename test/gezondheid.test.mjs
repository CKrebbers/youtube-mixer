// De AudioContext bewaken (src/ui/gezondheid.js, spoor A 15 okt): het pure deel en de
// opzet met een nep-context, nep-klok en nep-MIDI. Zonder browser.
// Draai met: node test/gezondheid.test.mjs
const G = await import('../src/ui/gezondheid.js');
const { audioMelding, KlokWachter, opzetGezondheid, AUDIO_SLEUTEL, WEER_GOED, KLOK_MS } = G;

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

console.log('audioMelding (puur)');
ok('vóór de audio ooit liep: niets (de gewone beginstand)', audioMelding({ state: 'suspended', gestart: false }) === null);
ok('loopt: niets', audioMelding({ state: 'running' }) === null);
ok('dicht (closed): niets (dat is opzet, geen storing)', audioMelding({ state: 'closed' }) === null);
const s = audioMelding({ state: 'suspended' });
ok(`stil na het starten: een fout die zegt wat je doet ("${s?.tekst}")`, s?.soort === 'fout' && /suspended/.test(s.tekst) && /knop/.test(s.tekst));
ok('interrupted (een andere toestand van de browser) telt ook', audioMelding({ state: 'interrupted' })?.soort === 'fout');
const k = audioMelding({ state: 'running', klokStil: true });
ok(`loopt maar de klok staat stil: een fout over de uitgang ("${k?.tekst}")`, k?.soort === 'fout' && /uitgang/.test(k.tekst));

console.log('\nKlokWachter (puur)');
{
  const w = new KlokWachter();
  ok('eerste meting: nog niets te vergelijken', w.meet(0, 0, true) === false);
  ok('klok loopt mee: niets', w.meet(1, 1000, true) === false && w.meet(2.0, 2000, true) === false);
  ok('één keer 0,9 s achter (de Mac sliep, een hapering): nog niets', w.meet(2.1, 3000, true) === false);
  ok('daarna weer gewoon: teller terug', w.meet(3.1, 4000, true) === false && w.teller === 0);
  w.meet(3.2, 5000, true);
  ok('twee keer achter elkaar > 0,5 s achter: staat stil', w.meet(3.3, 6000, true) === true && Math.abs(w.laatsteAchter - 0.9) < 1e-9);
  ok('blijft stil zolang hij niet loopt', w.meet(3.3, 7000, true) === true);
  ok('loopt hij weer: meteen niet meer stil', w.meet(4.3, 8000, true) === false);
  ok('precies 0,5 s achter telt niet (meer dan)', (() => { const x = new KlokWachter(); x.meet(0, 0, true); x.meet(0.5, 1000, true); return x.meet(1, 2000, true) === false; })());
  w.meet(5, 9000, true); w.meet(5, 10000, true); w.meet(5, 11000, true);
  ok('context loopt niet (suspended): de wachter zegt niets en begint opnieuw', w.meet(5, 12000, false) === false && w.vorig === null && w.teller === 0);
  ok('rommel (NaN) telt niet', w.meet(NaN, 1, true) === false);
}

console.log('\nopzetGezondheid (nep-context)');
{
  class NepCtx extends EventTarget {
    constructor() { super(); this.state = 'suspended'; this.currentTime = 0; this.hervat = 0; this.kanHervatten = true; }
    zet(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
    resume() { this.hervat++; if (this.kanHervatten) queueMicrotask(() => this.zet('running')); return new Promise(() => {}); }
  }
  const ctx = new NepCtx();
  const meldingen = [];
  const meld = (tekst, soort, duur, { sleutel } = {}) => meldingen.push({ tekst, soort, duur, sleutel });
  let invoer = null;
  const midi = { onInput(fn) { invoer = fn; } };
  const venster = new EventTarget();
  let wand = 0, tikFn = null, tikMs = null;
  const g = opzetGezondheid({ ctx, meld, midi, venster, nu: () => wand, elke: (fn, ms) => { tikFn = fn; tikMs = ms; } });
  ok('meet elke seconde, en luistert naar de controller', tikFn && tikMs === KLOK_MS && typeof invoer === 'function');
  invoer({ sig: 'note:0:53' });
  venster.dispatchEvent(new Event('keydown'));
  ok('vóór de audio ooit liep: een druk probeert niets (dat doet "audio starten")', ctx.hervat === 0);
  for (let i = 0; i < 4; i++) { wand += 1000; tikFn(); }
  ok('vóór de audio liep: geen melding, ook niet van de klok', meldingen.length === 0);
  ctx.zet('running');
  ok('de audio start: geen melding (er stond niets)', meldingen.length === 0 && g.stand().gestart);
  ctx.zet('suspended');
  ok('daarna stil (suspend): één fout met de sleutel audio', meldingen.length === 1 && meldingen[0].soort === 'fout' && meldingen[0].sleutel === AUDIO_SLEUTEL);
  invoer({ sig: 'note:0:53' });
  await new Promise((r) => setTimeout(r, 0));
  ok('een druk op de controller: resume(), en hij loopt weer', ctx.hervat === 1 && ctx.state === 'running');
  ok('… dan dezelfde sleutel: "audio loopt weer" (info, verdwijnt vanzelf)', meldingen.length === 2 && meldingen[1].tekst === WEER_GOED.tekst
    && meldingen[1].soort === 'info' && meldingen[1].sleutel === AUDIO_SLEUTEL && meldingen[1].duur > 0);
  invoer({ sig: 'note:0:53' });
  ok('loopt hij al: een druk doet niets', ctx.hervat === 1);
  ctx.zet('suspended');
  venster.dispatchEvent(new Event('keydown'));
  await new Promise((r) => setTimeout(r, 0));
  ok('het toetsenbord zet hem ook weer aan', ctx.hervat === 2 && ctx.state === 'running' && meldingen.at(-1).tekst === WEER_GOED.tekst);
  ctx.kanHervatten = false;
  ctx.zet('suspended');
  invoer({});
  invoer({});
  await new Promise((r) => setTimeout(r, 0));
  ok('lukt hervatten niet (geen gebaar): de fout blijft staan, elke druk probeert het opnieuw', ctx.state === 'suspended' && ctx.hervat === 4 && meldingen.at(-1).soort === 'fout');
  ctx.kanHervatten = true;
  invoer({});
  await new Promise((r) => setTimeout(r, 0));
  // De klok: running, maar currentTime loopt niet.
  const voor = meldingen.length;
  ctx.currentTime = 10; wand += 1000; tikFn();
  ctx.currentTime = 11; wand += 1000; tikFn();
  ok('klok loopt mee: niets', meldingen.length === voor);
  wand += 1000; tikFn();
  ok('één seconde stil: nog niets', meldingen.length === voor);
  wand += 1000; tikFn();
  ok('twee keer stil: "audio-uitgang staat stil" (fout, sleutel audio)', meldingen.length === voor + 1 && /uitgang staat stil/.test(meldingen.at(-1).tekst)
    && meldingen.at(-1).soort === 'fout' && meldingen.at(-1).sleutel === AUDIO_SLEUTEL);
  wand += 1000; tikFn();
  ok('… niet elke seconde opnieuw', meldingen.length === voor + 1);
  ctx.currentTime = 12; wand += 1000; tikFn();
  ok('loopt de klok weer: "audio loopt weer"', meldingen.length === voor + 2 && meldingen.at(-1).tekst === WEER_GOED.tekst);
  ctx.zet('closed');
  ok('dicht (closed): geen fout', meldingen.at(-1).soort !== 'fout');
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
