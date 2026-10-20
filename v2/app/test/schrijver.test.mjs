/**
 * De schrijver van opname en log: opnieuw proberen zolang de server weg is (in volgorde, één
 * melding die op "weer goed" eindigt), een volle rij laat het NIEUWE stuk vallen, een 4xx hooguit
 * drie keer. Met een nep-fetch en een nep-wacht (geen tijd, geen netwerk).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schrijver } from '../src/ui/schrijver.js';

function nep({ wegTot = 0, status = 200 } = {}) {
  const ontvangen = [];
  let pogingen = 0;
  const haal = async (url, o) => {
    pogingen++;
    if (pogingen <= wegTot) throw new TypeError('fetch failed');
    ontvangen.push({ url, body: o.body });
    return { ok: status < 300, status, json: async () => ({ fout: 'nee' }), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { haal, ontvangen, pogingen: () => pogingen };
}
const maak = (n, extra = {}) => {
  const meldingen = [];
  const s = new Schrijver({
    naam: 'log', url: (x) => `/api/v2/log/set-1?van=${x.van}`, body: (x) => ({ body: x.tekst, type: 'text/plain' }),
    grootte: (x) => x.tekst.length, max: 100, meld: (t, soort, k) => meldingen.push({ t, soort, k }),
    haal: n.haal, wacht: async () => {}, ...extra,
  });
  return { s, meldingen };
};

test('server even weg: alles komt aan, in volgorde, met één melding en "weer goed"', async () => {
  const n = nep({ wegTot: 5 });
  const { s, meldingen } = maak(n);
  s.zet({ van: 0, tekst: 'aaa' }); s.zet({ van: 3, tekst: 'bbb' }); s.zet({ van: 6, tekst: 'cc' });
  await s.leeg();
  assert.deepEqual(n.ontvangen.map((x) => x.url), ['/api/v2/log/set-1?van=0', '/api/v2/log/set-1?van=3', '/api/v2/log/set-1?van=6']);
  assert.equal(meldingen.filter((m) => m.soort === 'fout').length, 1, 'één melding voor de hele storing');
  assert.match(meldingen.at(-1).t, /weer goed/);
  assert.ok(meldingen.every((m) => m.k === 'log'), 'onder één sleutel');
});

test('een volle rij: het nieuwe stuk valt weg (het begin van de storing blijft)', async () => {
  const n = nep({ wegTot: 1e9 });
  const { s } = maak(n, { wacht: () => new Promise(() => {}) });   // de server komt niet terug: de eerste blijft hangen
  s.zet({ van: 0, tekst: 'x'.repeat(60) });
  s.zet({ van: 60, tekst: 'y'.repeat(30) });
  s.zet({ van: 90, tekst: 'z'.repeat(30) });       // past niet meer (60 + 30 + 30 > 100)
  assert.equal(s.weg, 1);
  assert.deepEqual(s.rij.map((x) => x.van), [0, 60]);
});

test('de server zegt nee: hooguit drie keer, dan door met het volgende stuk', async () => {
  const n = nep({ status: 400 });
  const { s, meldingen } = maak(n);
  s.zet({ van: 0, tekst: 'a' });
  await s.leeg();
  assert.equal(n.pogingen(), 3);
  assert.equal(s.weg, 1);
  assert.ok(meldingen.some((m) => /kwam niet aan/.test(m.t)));
});
