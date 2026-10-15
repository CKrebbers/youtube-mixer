// De melding van de mixer aan de server (server/mixer-melding.js, docs/COMPANION.md
// stap 2) als rekenwerk: wat een melding is, wie mag schrijven (alleen de mixer op
// deze Mac), en de stand die iPad en iPhone lezen (leeftijd, twee mixers). Geen
// server, geen klok van zichzelf.
// Draai met: node test/mixer-melding.test.mjs
const { isMelding, vanDezeMac, MixerStand, TRACKS, MAX_BYTES, TWEE_MS, KIJK_MS } = await import('../server/mixer-melding.js');
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
ok('een tweede tab-id na de eerste, de eerste nog niet opnieuw: (nog) niet twee (kan een herladen zijn)', stand.lees(11_100).twee === false);
stand.zet(melding, 12_000);
ok('om beurten: 1, 2, 1 binnen 5 s → twee (twee mixers open)', stand.lees(12_100).twee === true);
stand.zet(melding, 13_000);
stand.zet(melding, 15_000);
stand.zet(melding, 16_100);
ok(`de tweede zwijgt langer dan ${TWEE_MS / 1000} s: weer één`, stand.lees(16_100).twee === false);
ok('... en de laatste melding is die van de eerste', stand.lees(16_100).melding.tab === 'tab-proef-1' && stand.lees(16_100).leeftijd_ms === 0);
ok('na 5 s stilte van allebei: niet twee, de leeftijd loopt op', stand.lees(30_000).twee === false && stand.lees(30_000).leeftijd_ms === 13_900);

// AR16: kijkt er iemand (GET /api/mixer)? Het antwoord op de POST zegt het de mixer.
{
  const k = new MixerStand();
  ok('AR16: nog nooit gelezen → geen kijker', k.kijker(1000) === false);
  k.kijk(5000);
  ok(`AR16: gelezen op 5 s → kijker tot ${(5000 + KIJK_MS) / 1000} s, daarna niet`, k.kijker(5000) && k.kijker(5000 + KIJK_MS - 1) && !k.kijker(5000 + KIJK_MS));
  ok('AR16: KIJK_MS ruim boven de 4 s van de rustige mixer (anders valt een kijker tussen twee POSTs weg)', KIJK_MS > 4000 * 2);
}

// Review ronde 2, fix 2: herladen (app.js maakt per laden een nieuwe TAB_ID) is geen tweede mixer.
console.log('\nherladen is geen tweede mixer; twee echte mixers wel');
const herladen = new MixerStand();
for (let t = 0; t <= 10_000; t += 1000) herladen.zet({ ...melding, tab: 'tab-oud' }, t);          // de oude: 0..10 s
for (let t = 12_000; t <= 15_000; t += 1000) herladen.zet({ ...melding, tab: 'tab-nieuw' }, t);    // herladen, de nieuwe vanaf 12 s
const opMomenten = [12_000, 13_000, 14_000, 15_000].map((t) => herladen.lees(t).twee);
ok(`herladen: oude id 0..10 s, nieuwe vanaf 12 s → twee false op 12, 13, 14, 15 s (${opMomenten.join(', ')})`, opMomenten.every((x) => x === false));
const direct = new MixerStand();
for (let t = 0; t <= 10_000; t += 1000) direct.zet({ ...melding, tab: 'tab-oud' }, t);
direct.zet({ ...melding, tab: 'tab-nieuw' }, 10_050);                                              // de nieuwe meteen erna (snelle laadtijd)
for (let t = 11_000; t <= 14_000; t += 1000) direct.zet({ ...melding, tab: 'tab-nieuw' }, t);
ok('herladen met de nieuwe 50 ms na de laatste van de oude: ook geen alarm', [10_050, 11_000, 12_000, 14_000].every((t) => direct.lees(t).twee === false));
const tweeEcht = new MixerStand();
tweeEcht.zet({ ...melding, tab: 'tab-localhost' }, 0);
tweeEcht.zet({ ...melding, tab: 'tab-127' }, 400);
ok('twee echte mixers, half verschoven: na de eerste melding van elk nog niet', tweeEcht.lees(450).twee === false);
tweeEcht.zet({ ...melding, tab: 'tab-localhost' }, 1000);
ok('... na de tweede melding van de eerste (1 s): twee', tweeEcht.lees(1000).twee === true);
for (let t = 1400; t <= 8400; t += 1000) { tweeEcht.zet({ ...melding, tab: 'tab-127' }, t); tweeEcht.zet({ ...melding, tab: 'tab-localhost' }, t + 600); }
ok('... en zolang ze allebei melden blijft het twee', [2000, 5000, 9000].every((t) => tweeEcht.lees(t).twee === true));
for (let t = 10_000; t <= 16_000; t += 1000) tweeEcht.zet({ ...melding, tab: 'tab-localhost' }, t);   // 127.0.0.1 dicht
ok('één van de twee dicht: na 5 s weer één', tweeEcht.lees(14_500).twee === false && tweeEcht.lees(16_000).twee === false);
const zelfdeMs = new MixerStand();
zelfdeMs.zet({ ...melding, tab: 'tab-proef-1' }, 1000);
zelfdeMs.zet({ ...melding, tab: 'tab-proef-2' }, 1300);
zelfdeMs.zet({ ...melding, tab: 'tab-proef-1' }, 1300);
ok('om beurten in dezelfde milliseconde (1, 2, 1 met 2 en 1 op 1300 ms): toch twee (de volgorde telt, niet de klok)', zelfdeMs.lees(1300).twee === true);
const herladenZelfdeMs = new MixerStand();
herladenZelfdeMs.zet({ ...melding, tab: 'tab-oud' }, 1000);
herladenZelfdeMs.zet({ ...melding, tab: 'tab-oud' }, 2000);
herladenZelfdeMs.zet({ ...melding, tab: 'tab-nieuw' }, 2000);
herladenZelfdeMs.zet({ ...melding, tab: 'tab-nieuw' }, 3000);
ok('herladen met de nieuwe in dezelfde milliseconde als de laatste van de oude: geen alarm', herladenZelfdeMs.lees(3000).twee === false);

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
