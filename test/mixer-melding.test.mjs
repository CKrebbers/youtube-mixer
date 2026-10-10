// De melding van de mixer aan de server (server/mixer-melding.js, docs/COMPANION.md
// stap 2) als rekenwerk: wat een melding is, wie mag schrijven (alleen de mixer op
// deze Mac), en de stand die iPad en iPhone lezen (leeftijd, twee mixers). Geen
// server, geen klok van zichzelf.
// Draai met: node test/mixer-melding.test.mjs
const { isMelding, vanDezeMac, MixerStand, TRACKS, MAX_BYTES, TWEE_MS } = await import('../server/mixer-melding.js');
const { maakStatus } = await import('../src/ui/status-zender.js');
const { DECK_IDS } = await import('../src/engine/engine.js');

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };

/** Een snapshot van acht geladen decks, zoals engine.snapshot() hem geeft (alleen wat maakStatus leest). */
const snap = {
  focus: 'A', maat: 'A',
  decks: Object.fromEntries(DECK_IDS.map((id, i) => [id, { id, loaded: true, playing: id === 'A', title: `Proef ${id}`,
    bpm: 120 + i, toon: { camelot: '8A', kort: 'Am' }, position: 600.04, duration: 3600, rate: 1.0004 }])),
};
const melding = maakStatus({ snap, midi: null, audio: 'running', tab: 'tab-proef-1', eind: { zwart: false, bevroren: true, master: 0.8 }, nu: 1000 });

console.log('wat een melding is (isMelding)');
ok(`de tracks van de server zijn de decks van de engine (${TRACKS.join('')})`, TRACKS.join() === DECK_IDS.join());
ok('de uitvoer van maakStatus met acht tracks is een melding', melding.tracks.length === 8 && isMelding(melding));
ok('JSON heen en terug: nog steeds een melding', isMelding(JSON.parse(JSON.stringify(melding))));
ok('null, [], een getal of tekst: nee', [null, undefined, [], 5, 'x'].every((b) => !isMelding(b)));
ok('zonder t, of t geen eindig getal: nee', !isMelding({ ...melding, t: undefined }) && !isMelding({ ...melding, t: Infinity }) && !isMelding({ ...melding, t: '1' }));
ok('zonder tab, of een tab van 3 of 65 tekens: nee', !isMelding({ ...melding, tab: undefined }) && !isMelding({ ...melding, tab: 'abc' })
  && !isMelding({ ...melding, tab: 'x'.repeat(65) }) && isMelding({ ...melding, tab: 'abcd' }));
ok('tracks als object, of ontbrekend: nee', !isMelding({ ...melding, tracks: { A: {} } }) && !isMelding({ t: 1, tab: 'abcd' }));
ok('negen tracks: nee', !isMelding({ ...melding, tracks: [...melding.tracks, { ...melding.tracks[0] }] }));
ok('id I of een lege id: nee; E en H wel', !isMelding({ ...melding, tracks: [{ id: 'I' }] }) && !isMelding({ ...melding, tracks: [{ id: '' }] })
  && isMelding({ ...melding, tracks: [{ id: 'E' }, { id: 'H' }] }));
ok('positie "x" of duur NaN: nee; ontbrekend of null: wel', !isMelding({ ...melding, tracks: [{ id: 'A', positie: 'x' }] })
  && !isMelding({ ...melding, tracks: [{ id: 'A', duur: NaN }] }) && isMelding({ ...melding, tracks: [{ id: 'A', positie: null }] })
  && isMelding({ ...melding, tracks: [{ id: 'A' }] }));
ok('geen tracks (niets geladen) mag', isMelding({ ...melding, tracks: [] }));
const grootte = Buffer.byteLength(JSON.stringify(melding));
ok(`een melding met acht tracks is ${grootte} bytes, ruim onder de grens van ${MAX_BYTES}`, grootte < MAX_BYTES / 4);

console.log('\nwie mag schrijven (vanDezeMac, poort 8777)');
const req = (headers) => ({ headers });
const P = 8777;
ok('localhost zonder Origin (de mixer op deze Mac, curl): ja', vanDezeMac(req({ host: 'localhost:8777' }), P));
ok('localhost met de eigen Origin: ja', vanDezeMac(req({ host: 'localhost:8777', origin: 'http://localhost:8777' }), P));
ok('[::1] en 127.0.0.1 op de eigen poort: ja', vanDezeMac(req({ host: '[::1]:8777' }), P) && vanDezeMac(req({ host: '127.0.0.1:8777', origin: 'http://127.0.0.1:8777' }), P));
ok('localhost met Origin https://<ts-naam>: nee', !vanDezeMac(req({ host: 'localhost:8777', origin: 'https://varve.proef-net.ts.net' }), P));
ok('Host = de ts-naam (via tailscale serve): nee', !vanDezeMac(req({ host: 'varve.proef-net.ts.net' }), P));
ok('127.0.0.1 op een andere poort: nee', !vanDezeMac(req({ host: '127.0.0.1:8778' }), P));
ok('localhost zonder poort: nee', !vanDezeMac(req({ host: 'localhost' }), P));
ok('localhost met x-forwarded-for: nee', !vanDezeMac(req({ host: 'localhost:8777', 'x-forwarded-for': '100.64.0.7' }), P));
ok('localhost met tailscale-user-login: nee', !vanDezeMac(req({ host: 'localhost:8777', 'tailscale-user-login': 'clay@example.com' }), P));
ok('localhost met de Origin van 127.0.0.1 (een andere oorsprong): nee', !vanDezeMac(req({ host: 'localhost:8777', origin: 'http://127.0.0.1:8777' }), P));
ok('zonder koppen: nee', !vanDezeMac({}, P) && !vanDezeMac(null, P));

console.log('\nde stand die iPad en iPhone lezen (MixerStand)');
const stand = new MixerStand();
const leeg = stand.lees(5000);
ok('nog niets: leeftijd null, geen melding, niet twee', leeg.leeftijd_ms === null && leeg.melding === null && leeg.twee === false);
stand.zet(melding, 10_000);
ok('leeftijd volgens de meegegeven klok (10 000 → 10 750: 750 ms)', stand.lees(10_750).leeftijd_ms === 750 && stand.lees(10_750).melding === melding);
ok('een klok die terugloopt geeft geen negatieve leeftijd', stand.lees(9_000).leeftijd_ms === 0);
stand.zet({ ...melding, tab: 'tab-proef-2' }, 11_000);
ok('een tweede tab-id binnen 5 s: twee', stand.lees(11_100).twee === true);
stand.zet(melding, 13_000);
stand.zet(melding, 15_000);
stand.zet(melding, 16_100);
ok(`de tweede zwijgt langer dan ${TWEE_MS / 1000} s: weer één`, stand.lees(16_100).twee === false);
ok('... en de laatste melding is die van de eerste', stand.lees(16_100).melding.tab === 'tab-proef-1' && stand.lees(16_100).leeftijd_ms === 0);
ok('na 5 s stilte van allebei: niet twee, de leeftijd loopt op', stand.lees(30_000).twee === false && stand.lees(30_000).leeftijd_ms === 13_900);

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
