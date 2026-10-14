// Het grid bewaren bij het nummer (src/ui/grid-bewaren.js, docs/BEATGRID.md §12),
// los van de engine: nep-decks, een nep-klok en een nep-wekker, dus geen
// tijdsgrens op de wandklok (alleen de time-out van AbortSignal is echt, met
// ruime marge). Wat hier vastligt (review ronde 1, 14 okt):
//   - elk antwoord wordt gelezen (leesWeg), ook bij een fout;
//   - een POST die blijft hangen legt het bewaren niet stil (time-out);
//   - de library-rij hoort het ook als de track intussen iets anders laadde;
//   - de andere tracks met hetzelfde nummer horen het pas na de reeks, één keer;
//   - terug op wat al bewaard is (↶) = geen POST.
// Draai met: node test/grid-bewaren.test.mjs
import { Emitter } from '../src/lib/emitter.js';
import { maakGridBewaarder, RUST_MS, UITERLIJK_MS } from '../src/ui/grid-bewaren.js';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? `  (${extra})` : ''}`); };
const rust = (n = 6) => new Promise((r) => { const stap = (k) => (k ? setImmediate(() => stap(k - 1)) : r()); stap(n); });
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

class NepDeck extends Emitter {
  constructor() { super(); this.grid = null; this.gridVersie = 0; }
  zet(bpm) { this.grid = bpm == null ? null : { toJSON: () => ({ stukken: [{ van: 0, bpm, anker: 0.1 }] }) }; this.gridVersie++; this.emit('change'); }
}

function opzet({ haal, tijdslimiet } = {}) {
  let nu = 0;
  const wekkers = [];
  let volg = 1;
  const wekker = {
    zet: (f, ms) => { const id = volg++; wekkers.push({ id, t: nu + Math.max(0, ms), f }); return id; },
    wis: (id) => { const i = wekkers.findIndex((w) => w.id === id); if (i >= 0) wekkers.splice(i, 1); },
  };
  const decks = { A: new NepDeck(), B: new NepDeck() };
  const engine = { deck: (id) => decks[id] };
  const deckTrack = { A: 'nummer-1', B: null };
  const posts = [], na = [], reeks = [];
  let gelezen = 0;
  const g = maakGridBewaarder({ engine, decks: ['A', 'B'], deckTrack, klok: () => nu, wekker, tijdslimiet,
    haal: haal ?? (async (url, init) => { posts.push({ t: nu, url, body: init.body }); return { ok: true, status: 200, json: async () => { gelezen++; return {}; } }; }),
    naBewaard: (trackId, json, id) => na.push({ trackId, bpm: json?.stukken?.[0]?.bpm, id, t: nu }),
    naReeks: (trackId, json, id) => reeks.push({ trackId, bpm: json?.stukken?.[0]?.bpm, id, t: nu }) });
  /** De nep-klok ms verder, wekkers op hun tijd, met de microtaken ertussen. */
  async function loop(ms) {
    const eind = nu + ms;
    for (;;) {
      wekkers.sort((a, b) => a.t - b.t || a.id - b.id);
      const w = wekkers[0];
      if (!w || w.t > eind) break;
      wekkers.shift();
      nu = w.t;
      w.f();
      await rust();
    }
    nu = eind;
    await rust();
  }
  return { decks, deckTrack, g, posts, na, reeks, loop, gelezen: () => gelezen, nu: () => nu };
}

{
  // Eén druk: één POST na RUST_MS, het antwoord gelezen, de library-rij bijgewerkt, daarna de reeks.
  const o = opzet();
  o.decks.A.zet(120); o.g.alsBewaard('A');
  await o.loop(50);
  o.decks.A.zet(240);
  await o.loop(RUST_MS - 1);
  const voor = o.posts.length;
  await o.loop(2);
  ok('één bewerking: de POST na precies de rust (250 ms), niet eerder', voor === 0 && o.posts.length === 1 && o.posts[0].t === 50 + RUST_MS, `t=${o.posts[0]?.t}`);
  ok('het antwoord is gelezen (leesWeg)', o.gelezen() === o.posts.length, `${o.gelezen()}/${o.posts.length}`);
  ok('de library-rij hoort het (naBewaard met het nummer en het nieuwe grid)', o.na.length === 1 && o.na[0].trackId === 'nummer-1' && o.na[0].bpm === 240);
  ok('de reeks is klaar: naReeks één keer, met het nieuwe grid', o.reeks.length === 1 && o.reeks[0].bpm === 240 && o.reeks[0].id === 'A');
  // ↶ terug naar wat al bewaard is: geen POST.
  o.decks.A.zet(240);
  await o.loop(2000);
  ok('terug op wat al bewaard is: geen POST en geen reeks', o.posts.length === 1 && o.reeks.length === 1);
}
{
  // Ook bij een fout wordt het antwoord gelezen, en het vangnet probeert opnieuw.
  let n = 0, gelezen = 0;
  const posts = [];
  const o = opzet({ haal: async (url, init) => { posts.push(init.body); n++; return { ok: n > 1, status: n > 1 ? 200 : 500, statusText: 'x', json: async () => { gelezen++; return {}; } }; } });
  const waarsch = console.warn; console.warn = () => {};
  o.decks.A.zet(120); o.g.alsBewaard('A');
  o.decks.A.zet(121);
  await o.loop(RUST_MS + 1);
  const naFout = { posts: posts.length, reeks: o.reeks.length, na: o.na.length };
  await o.g.bewaar(); await rust();     // het vangnet van laden.js (elke 1,5 s)
  console.warn = waarsch;
  ok('een 500: het antwoord toch gelezen, geen library-rij en geen reeks', naFout.posts === 1 && gelezen >= 1 && naFout.reeks === 0 && naFout.na === 0, JSON.stringify(naFout));
  ok('het vangnet bewaart opnieuw, en elk antwoord is gelezen; dan pas de reeks', posts.length === 2 && gelezen === 2 && o.na.length === 1 && o.reeks.length === 1,
    `posts ${posts.length}, gelezen ${gelezen}, reeks ${o.reeks.length}`);
}
{
  // Een POST die blijft hangen (de server antwoordt niet): na de time-out afgebroken, het volgende bewaren gaat door.
  let n = 0;
  const posts = [];
  const o = opzet({ tijdslimiet: 60, haal: (url, init) => {
    posts.push(init.body); n++;
    if (n === 1) return new Promise((_, nee) => init.signal?.addEventListener('abort', () => nee(init.signal.reason ?? new Error('afgebroken'))));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  } });
  const waarsch = console.warn; console.warn = () => {};
  o.decks.A.zet(120); o.g.alsBewaard('A');
  o.decks.A.zet(122);
  await o.loop(RUST_MS + 1);
  const heeftSignaal = posts.length === 1;
  await slaap(200);                     // echte tijd: AbortSignal.timeout(60)
  await rust();
  o.decks.A.zet(123);
  await o.loop(RUST_MS + 1);
  console.warn = waarsch;
  ok('een hangende POST wordt afgebroken en het bewaren loopt door', heeftSignaal && posts.length === 2 && JSON.parse(posts[1]).grid.stukken[0].bpm === 123 && o.reeks.length === 1,
    `posts ${posts.length}, reeks ${o.reeks.length}`);
}
{
  // Laadt de track tijdens de POST een ander nummer, dan hoort de rij van het OUDE nummer het grid toch.
  let los;
  const o = opzet({ haal: () => new Promise((r) => { los = () => r({ ok: true, status: 200, json: async () => ({}) }); }) });
  o.decks.A.zet(120); o.g.alsBewaard('A');
  o.decks.A.zet(125);
  await o.loop(RUST_MS + 1);
  o.deckTrack.A = 'nummer-2';           // laden.js: een ander nummer op deze track
  los(); await rust();
  ok('ander nummer geladen tijdens de POST: de library-rij van het oude nummer krijgt het grid toch', o.na.length === 1 && o.na[0].trackId === 'nummer-1' && o.na[0].bpm === 125);
  ok('… maar de reeks (andere tracks) niet: dit deck draagt dat nummer niet meer', o.reeks.length === 0);
}
{
  // Een encoder die 2 s blijft draaien (elke 100 ms een tik): tussendoor elke seconde bewaard, de reeks pas aan het eind.
  const o = opzet();
  o.decks.A.zet(120); o.g.alsBewaard('A');
  for (let i = 1; i <= 20; i++) { o.decks.A.zet(120 + i / 100); await o.loop(100); }
  const tijdens = { posts: o.posts.length, reeks: o.reeks.length };
  await o.loop(1000);
  ok('2 s draaien: tussendoor elke seconde een POST (UITERLIJK_MS), en geen enkele tussenstand naar de andere tracks', tijdens.posts === 2 && tijdens.reeks === 0
    && o.posts[0].t === UITERLIJK_MS && o.posts[1].t === 2 * UITERLIJK_MS, JSON.stringify(tijdens));
  const laatste = JSON.parse(o.posts.at(-1).body).grid.stukken[0].bpm;
  ok('na de reeks: het eindgrid bewaard en naReeks één keer, met het eindgrid, rust ms na de laatste tik', laatste === 120.2 && o.reeks.length === 1 && o.reeks[0].bpm === 120.2
    && o.reeks[0].t === 1900 + RUST_MS, `posts ${o.posts.length}, reeks ${JSON.stringify(o.reeks)}`);
  ok('elk antwoord gelezen', o.gelezen() === o.posts.length);
}
{
  // Twee tracks: B draagt hetzelfde nummer. De reeks gaat over beide, naReeks noemt het deck dat bewerkte.
  const o = opzet();
  o.deckTrack.B = 'nummer-1';
  o.decks.A.zet(120); o.g.alsBewaard('A');
  o.decks.B.zet(120); o.g.alsBewaard('B');
  o.decks.A.zet(130);
  await o.loop(RUST_MS + 1);
  ok('alleen het bewerkte deck POST en meldt de reeks', o.posts.length === 1 && o.reeks.length === 1 && o.reeks[0].id === 'A');
  // laden.js zet het grid dan op B (naGridReeks): dat is geen bewerking, dus geen POST terug en geen lus.
  o.g.bewaard.B = JSON.stringify({ stukken: [{ van: 0, bpm: 130, anker: 0.1 }] });
  o.decks.B.zet(130); o.g.alsBewaard('B');
  await o.loop(3000);
  ok('het overgenomen grid op B: geen POST en geen nieuwe reeks (geen lus A → B → A)', o.posts.length === 1 && o.reeks.length === 1);
}

console.log(fails.length ? `\n${fails.length} FOUT` : '\nalles goed');
process.exit(fails.length ? 1 : 0);
