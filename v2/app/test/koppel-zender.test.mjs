// Herkomst: stroommachine@0f4124e koppel/varve-beeld-zender.test.mjs (alleen het importpad is anders).
// node koppel/varve-beeld-zender.test.mjs — test de zender tegen een nep-WebSocket, zonder browser of netwerk.
import { maakBeeldZender, BRONNEN } from '../src/koppel/varve-beeld-zender.js';

let fouten = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fouten++; console.log('✗', m); } };

// nep-klok en nep-timers: alles deterministisch
let T = 1000;
const taken = [];
const timers = {
  setInterval: (f, ms) => { const t = { f, ms, next: T + ms, rep: true }; taken.push(t); return t; },
  clearInterval: (t) => { if (t) t.dood = true; },
  setTimeout: (f, ms) => { const t = { f, ms, next: T + ms, rep: false }; taken.push(t); return t; },
  clearTimeout: (t) => { if (t) t.dood = true; },
};
function loop(ms) {
  const eind = T + ms;
  for (;;) {
    const t = taken.filter((x) => !x.dood && x.next <= eind).sort((a, b) => a.next - b.next)[0];
    if (!t) break;
    T = t.next; t.f();
    if (t.rep) t.next += t.ms; else t.dood = true;
  }
  T = eind;
}
const socks = [];
class NepWS {
  constructor(url) { this.url = url; this.readyState = 0; this.uit = []; socks.push(this); }
  send(s) { this.uit.push(JSON.parse(s)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  krijg(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
  sluit() { this.readyState = 3; this.onclose && this.onclose(); }
}

let beat = 0, bpm = 124, speelt = true;
const z = maakBeeldZender({
  url: 'ws://test:7702/app', WebSocketImpl: NepWS, nu: () => T, timers,
  klok: () => ({ bpm, beat, speelt }),
  kenmerken: () => ({ 'mix.laag': 0.5, 'mix.midden': 0.2, 'mix.hoog': 1.4, 'mix.klap': -1, 'mix.luid': 0.3, 'maat.tel': 0.25, 'maat.klap': 0 }),
});

ok(socks.length === 0, 'nog niet verbonden vóór start');
z.start();
ok(socks.length === 1 && socks[0].url === 'ws://test:7702/app', 'verbindt bij start');
const s = socks[0];
s.open();
ok(s.uit[0].app === 'varvedj' && Array.isArray(s.uit[0].bronnen) && s.uit[0].bronnen.length === BRONNEN.length, 'eerste bericht = manifest');
ok(s.uit.some((m) => m.type === 'klok' && m.naar === 'stroommachine'), 'meteen een klokbericht na verbinden');

// 1 s laten lopen met 124 BPM: ~2 tellen
const tick = () => { beat += (bpm / 60) * 0.02; };
taken.push({ f: tick, ms: 20, next: T + 20, rep: true });
s.uit.length = 0;
loop(1000);
const klok = s.uit.filter((m) => m.type === 'klok');
ok(klok.length >= 4 && klok.length <= 8, `klokberichten in 1 s: ${klok.length} (4 Hz + tel-grenzen)`);
ok(klok.every((m) => m.bpm === 124 && typeof m.t === 'number' && m.speelt === true), 'klok bevat t, bpm, speelt');
const ken = s.uit.filter((m) => m.type === 'kenmerken');
ok(ken.length >= 28 && ken.length <= 31, `kenmerken op ~30 Hz: ${ken.length}`);
ok(ken[0].w['mix.hoog'] === 1 && ken[0].w['mix.klap'] === 0 && !('naar' in ken[0]), 'kenmerken begrensd 0..1, via de relay (geen naar)');

// ping → pong naar de afzender
s.uit.length = 0;
s.krijg({ type: 'ping', id: 7, t0: 5, van: 'stroommachine' });
const pong = s.uit.find((m) => m.type === 'pong');
ok(pong && pong.naar === 'stroommachine' && pong.id === 7 && pong.t0 === 5 && pong.t1 === T, 'antwoordt op ping met pong (t1 = eigen tijd)');

// track, mix (begrensd), poort
s.uit.length = 0;
z.track('B', { id: 'yt:abc', titel: 'Test', bpm: 128, key: '8A' });
ok(s.uit.some((m) => m.type === 'track' && m.deck === 'B' && m.id === 'yt:abc' && m.bpm === 128), 'track-bericht');
for (let i = 0; i <= 10; i++) z.mix({ xfader: i / 10 });
ok(s.uit.filter((m) => m.type === 'mix').length === 0, 'mix wacht (begrenzing)');
loop(60);
const mixen = s.uit.filter((m) => m.type === 'mix');
ok(mixen.length === 1 && mixen[0].xfader === 1, 'mix: één bericht met de laatste stand');
z.poort('macro.tint', 0.61234); z.poort('regie!ontdek');
ok(s.uit.some((m) => m.poort === 'macro.tint' && m.waarde === 0.612 && m.naar === 'stroommachine'), 'poort met waarde');
ok(s.uit.some((m) => m.poort === 'regie!ontdek' && !('waarde' in m)), 'actie-poort zonder waarde');

// status van de beeldmachine
let st = null; z.on('status', (x) => { st = x; });
s.krijg({ type: 'beeld-status', regime: 'Diepte', scene: 'Ruimte', fps: 58, volgt: true, bpm: 124 });
ok(st && st.beeld && st.beeld.regime === 'Diepte' && st.beeld.volgt === true, 'beeld-status komt binnen');

// herverbinden met backoff
s.sluit();
ok(!z.status.verbonden, 'status: verbroken');
loop(1500);
ok(socks.length === 2, 'herverbindt na ~1 s');
socks[1].open();
ok(z.status.verbonden && socks[1].uit[0].app === 'varvedj', 'opnieuw manifest na herverbinden');

// gestopt transport en stop()
speelt = false; socks[1].uit.length = 0; loop(300);
ok(socks[1].uit.some((m) => m.type === 'klok' && m.speelt === false), 'speelt:false wordt doorgegeven');
z.stop(); const n = socks[1].uit.length; loop(1000);
ok(socks[1].uit.length === n, 'na stop geen berichten meer');
let fout = null; try { maakBeeldZender({ url: 'http://x' }); } catch (e) { fout = e; }
ok(fout, 'weigert een niet-ws-url');

console.log(`${checks} checks · ${fouten ? fouten + ' FOUT' : 'alles groen'}`);
process.exit(fouten ? 1 : 0);
