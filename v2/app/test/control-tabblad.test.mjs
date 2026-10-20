// tabblad.js: één tabblad met de Web Lock 'varve-v2-mixer'; het tweede wacht en
// neemt het over als het eerste sluit. Met een nagebouwde navigator.locks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bewaakTabblad, LOCK_NAAM } from '../src/control/tabblad.js';

function nepLocks() {
  const gehouden = new Map();   // naam -> { los }
  const rij = [];
  const geef = (naam, cb) => {
    let los;
    const klaar = new Promise((r) => { los = r; });
    gehouden.set(naam, { los });
    Promise.resolve(cb({ name: naam })).then(() => {}, () => {});
    return klaar;
  };
  return {
    request(naam, a, b) {
      const opties = typeof a === 'function' ? {} : a;
      const cb = typeof a === 'function' ? a : b;
      if (!gehouden.has(naam)) { geef(naam, cb); return Promise.resolve(); }
      if (opties.ifAvailable) { cb(null); return Promise.resolve(); }
      rij.push({ naam, cb });
      return Promise.resolve();
    },
    /** Het tabblad dat de lock heeft sluit. */
    sluit(naam) {
      gehouden.delete(naam);
      const i = rij.findIndex((x) => x.naam === naam);
      if (i >= 0) { const [v] = rij.splice(i, 1); geef(naam, v.cb); }
    },
  };
}

test('het eerste tabblad krijgt de lock, het tweede wacht en neemt het over', async () => {
  assert.equal(LOCK_NAAM, 'varve-v2-mixer');
  const locks = nepLocks();
  const a = bewaakTabblad(locks);
  const b = bewaakTabblad(locks);
  const ev = [];
  a.on('eerste', () => ev.push('a eerste'));
  b.on('eerste', () => ev.push('b eerste'));
  b.on('tweede', () => ev.push('b tweede'));
  assert.equal(a.eerste, false, 'vóór de beslissing telt niemand als eerste');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ev, ['a eerste', 'b tweede']);
  assert.equal(b.eerste, false);
  locks.sluit(LOCK_NAAM);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ev, ['a eerste', 'b tweede', 'b eerste']);
  assert.equal(b.eerste, true);
});

test('zonder Web Locks (oude browser) is elk tabblad het eerste', async () => {
  const t = bewaakTabblad(undefined);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(t.eerste, true);
});
