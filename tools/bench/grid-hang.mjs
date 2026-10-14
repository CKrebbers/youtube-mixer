// Eén hangende grid-POST (de server antwoordt niet): hoeveel POSTs komen er in de 6 s erna nog,
// met elke seconde een bewerking en het vangnet van 1,5 s (zoals laden.js)? Echte timers, nep-fetch.
// Draai met: node tools/bench/grid-hang.mjs [wortel]   (wortel = een andere checkout, voor de nulmeting)
import { fileURLToPath, pathToFileURL } from 'node:url';
const W = process.argv[2] || fileURLToPath(new URL('../..', import.meta.url));
const { Emitter } = await import(pathToFileURL(W + '/src/lib/emitter.js').href);
const { maakGridBewaarder } = await import(pathToFileURL(W + '/src/ui/grid-bewaren.js').href);
class D extends Emitter { constructor() { super(); this.grid = null; this.gridVersie = 0; } zet(b) { this.grid = { toJSON: () => ({ stukken: [{ van: 0, bpm: b, anker: 0 }] }) }; this.gridVersie++; this.emit('change'); } }
const d = new D(); let n = 0;
console.warn = () => {};
const g = maakGridBewaarder({ engine: { deck: () => d }, decks: ['A'], deckTrack: { A: 'x' }, tijdslimiet: 300,
  haal: (u, init) => { n++; if (n === 1) return new Promise((_, nee) => init?.signal?.addEventListener('abort', () => nee(new Error('time-out')))); return Promise.resolve({ ok: true, json: async () => ({}) }); } });
d.zet(120); g.alsBewaard('A');
d.zet(121);
const t0 = Date.now();
const vangnet = setInterval(() => g.bewaar(), 1500);
for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 1000)); d.zet(122 + i); }
await new Promise((r) => setTimeout(r, 1000));
clearInterval(vangnet);
console.log(JSON.stringify({ wortel: W.replace(/\/$/, '').split('/').pop(), tijdslimiet: '300 ms (hier; in de app 5 s)', postsIn6s: n, laatsteBewaard: g.bewaard.A }));
process.exit(0);
