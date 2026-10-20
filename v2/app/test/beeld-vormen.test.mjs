// De 26 Vormmachines als beeldlagen in de kern (oogst beeld-043 … -053), overgenomen uit v1
// test/vormen.test.mjs en werker.test.mjs: elk systeem draait met zaad bit voor bit herhaalbaar, zonder
// Math.random of DOM, op 640 × 360, met g.kwaliteit; de laag doet stappen van 1/60 s op de klok van buiten;
// knoppen zijn plekken, modulatie een offset; de Worker met een nep-Worker; het budget met een nep-klok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEMEN, SYSTEEM, draaiKnoppen, maakRng, ACHTERGROND } from '../src/beeld/vormen/systemen.js';
import { VormLaag, VormLagen, STAP, MAX_STAPPEN, LAAG_BREEDTE, LAAG_HOOGTE } from '../src/beeld/vormen/laag.js';
import { draaiWerker } from '../src/beeld/vormen/werker.js';
import { Budget, BUDGET_HOOFD, BUDGET_WERKER, KWALITEIT_MIN, VER } from '../src/beeld/vormen/budget.js';
import { maten, cellen } from '../src/beeld/vormen/hulp.js';
import { BREEDTE, HOOGTE } from '../src/beeld/mixer.js';
import { Router, offsets, leesKenmerken, BRONNEN } from '../src/beeld/analyse/router.js';
import { KlokLezer } from '../src/beeld/analyse/maat.js';
import { Klok } from '../src/kern/klok.js';
import { nep2D } from './beeld-nep.mjs';

const bij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const draadMs = () => { const t = process.threadCpuUsage(); return (t.user + t.system) / 1000; };

/** Alle getallen in de toestand van een systeem, om NaN te vinden. */
function getallen(s, uit = [], diep = 0) {
  if (diep > 3 || s == null) return uit;
  if (typeof s === 'number') uit.push(s);
  else if (ArrayBuffer.isView(s)) { for (let i = 0; i < s.length; i += Math.max(1, s.length >> 6)) uit.push(s[i]); }
  else if (Array.isArray(s)) s.slice(0, 64).forEach((x) => getallen(x, uit, diep + 1));
  else if (typeof s === 'object' && !s.getContext && !s.px) Object.values(s).forEach((x) => getallen(x, uit, diep + 1));
  return uit;
}

/** Een canvas dat elke tekenaanroep MET argumenten in een hash stopt (ook van de roosters). */
const hashCanvassen = (st = { h: 2166136261 }) => (w, h) => {
  const mix = (v) => {
    const s = typeof v === 'number' ? v.toFixed(4) : typeof v === 'string' ? v : '';
    for (let i = 0; i < s.length; i++) st.h = Math.imul(st.h ^ s.charCodeAt(i), 16777619) >>> 0;
  };
  const doel = { createImageData: (b, hh) => ({ data: new Uint8ClampedArray(b * hh * 4) }) };
  const ctx = new Proxy(doel, {
    get(o, k) {
      if (k in o) return o[k];
      return (...a) => {
        mix(k);
        for (const x of a) {
          if (x?.data) { const d = x.data; for (let i = 0; i < d.length; i += 4 * 7) mix(d[i] + d[i + 1] * 256 + d[i + 2] * 65536); } else mix(x);
        }
      };
    },
    set(o, k, v) { mix(k); mix(v); o[k] = v; return true; },
  });
  return { width: w, height: h, getContext: () => ctx, st };
};

test('26 systemen, elk een uniek id, met 1–6 draaiknoppen', () => {
  assert.equal(SYSTEMEN.length, 26);
  assert.equal(new Set(SYSTEMEN.map((s) => s.id)).size, 26);
  for (const s of SYSTEMEN) {
    const k = draaiKnoppen(s);
    assert.ok(k.length >= 1 && k.length <= 6, `${s.id}: ${k.length} draaiknoppen`);
  }
});

test('elk systeem: 180 stappen zonder fout, zonder NaN, zonder Math.random, en hij tekent', () => {
  const echt = Math.random;
  Math.random = () => { throw new Error('Math.random gebruikt'); };
  try {
    for (const sys of SYSTEMEN) {
      const laag = new VormLaag({ maakCanvas: nep2D, systeem: sys.id, zaad: 7, werker: false, nu: () => 0 });
      for (let i = 0; i < 180; i++) laag.frame(i * STAP);
      assert.ok(getallen(laag.s).every(Number.isFinite), `${sys.id}: geen NaN in de toestand`);
      assert.ok(laag.canvas.tel.n > 0, `${sys.id}: tekent`);
    }
  } finally { Math.random = echt; }
});

test('zelfde zaad = precies dezelfde tekening, ander zaad = een andere (alle 26)', () => {
  const tekening = (id, zaad) => {
    const l = new VormLaag({ maakCanvas: hashCanvassen(), systeem: id, zaad, werker: false, nu: () => 0 });
    for (let i = 0; i < 20; i++) l.frame(i * STAP);
    return l.canvas.st.h;
  };
  const anders = SYSTEMEN.filter((s) => tekening(s.id, 7) !== tekening(s.id, 7)).map((s) => s.id);
  assert.deepEqual(anders, [], 'herhaalbaar');
  assert.notEqual(tekening('bd', 7), tekening('bd', 8));
  assert.notEqual(tekening('cc', 7), tekening('cc', 8));
  const r = maakRng(1);
  const reeks = Array.from({ length: 1000 }, r);
  assert.ok(reeks.every((x) => x >= 0 && x < 1) && Math.abs(reeks.reduce((s, x) => s + x, 0) / 1000 - 0.5) < 0.05);
});

test('het doek is 640 × 360 (16:9, precies 2× naar 1280 × 720), g kent W, H en D, geen S', () => {
  assert.equal(LAAG_BREEDTE * 9, LAAG_HOOGTE * 16);
  assert.ok(BREEDTE / LAAG_BREEDTE === 2 && HOOGTE / LAAG_HOOGTE === 2);
  const laag = new VormLaag({ maakCanvas: nep2D, systeem: 'hg', werker: false });
  assert.deepEqual([laag.canvas.width, laag.canvas.height], [640, 360]);
  assert.ok(laag.g.W === 640 && laag.g.H === 360 && bij(laag.g.D, 360 / 320) && !('S' in laag.g));
  assert.equal(laag.ctx.fillStyle, ACHTERGROND);
  const m = maten(640, 360);
  assert.ok(bij(m.D, 1.125));
  const c = cellen({ ...m }, 128);
  assert.deepEqual([c.nx, c.ny], [171, 96], 'cellen(g, 128) = 171 × 96');
});

test('g.kwaliteit: op 0,25 draait elk systeem nog, zonder NaN (het beeld grover, nooit trager)', () => {
  for (const sys of SYSTEMEN) {
    const laag = new VormLaag({ maakCanvas: nep2D, systeem: sys.id, zaad: 3, werker: false, nu: () => 0, kwaliteit: KWALITEIT_MIN });
    assert.equal(laag.g.kwaliteit, KWALITEIT_MIN, `${sys.id}: g.kwaliteit gezet`);
    for (let i = 0; i < 60; i++) laag.frame(i * STAP);
    assert.ok(getallen(laag.s).every(Number.isFinite), `${sys.id}: geen NaN op kwaliteit 0,25`);
  }
  // Een zwaar systeem tekent op lage kwaliteit minder (minder deeltjes / omvallers / punten).
  const tel = (k) => {
    const l = new VormLaag({ maakCanvas: nep2D, systeem: 'fl', zaad: 3, werker: false, nu: () => 0, kwaliteit: k });
    for (let i = 0; i < 30; i++) l.frame(i * STAP);
    return l.canvas.tel.n;
  };
  assert.ok(tel(0.25) < tel(1), 'fl: minder tekenwerk op kwaliteit 0,25');
});

test('rekentijd per stap (threadtijd, beste van 3): geen enkel systeem boven 60 ms', () => {
  // Grof: een vangnet tegen een systeem dat ontspoort, geen budget (dat meet de Mac, meting/MAC.md).
  const traag = [];
  for (const sys of SYSTEMEN) {
    const laag = new VormLaag({ maakCanvas: nep2D, systeem: sys.id, zaad: 5, werker: false, nu: () => 0 });
    for (let i = 0; i < 10; i++) laag.frame(i * STAP);
    let beste = Infinity;
    for (let poging = 0; poging < 3 && beste > 60; poging++) {
      const t0 = draadMs();
      for (let i = 10; i < 30; i++) laag.frame(i * STAP);
      beste = Math.min(beste, (draadMs() - t0) / 20);
    }
    if (beste > 60) traag.push(`${sys.id} ${beste.toFixed(1)} ms`);
  }
  assert.deepEqual(traag, []);
});

test('de laag: stappen van 1/60 s op de tijd van buiten, hooguit 3 per beeld, stil = stil', () => {
  const laag = new VormLaag({ maakCanvas: nep2D, systeem: 'lz', werker: false, nu: () => 0 });
  const tellen = [];
  const stap = laag._stap.bind(laag);
  laag._stap = (t) => { tellen.push(t); stap(t); };
  laag.frame(1);
  assert.equal(tellen.length, 1, 'eerste beeld: één stap');
  laag.frame(1);
  assert.equal(tellen.length, 1, 'dezelfde tijd (audioklok staat stil): geen stap, stil beeld');
  laag.frame(1 + 2 * STAP + 1e-6);
  assert.equal(tellen.length, 3, 'twee stappen verstreken = twee stappen');
  laag.frame(1 + 20 * STAP);
  assert.equal(tellen.length, 3 + MAX_STAPPEN, 'achter = hooguit drie, niet inhalen');
  const v = laag.versie;
  laag.frame(0.5);
  assert.ok(laag.versie > v, 'terug in de tijd: opnieuw ijken (één stap)');
});

test('knoppen zijn plekken (0..1 naar min..max), modulatie is een offset die de stand niet raakt', () => {
  const laag = new VormLaag({ maakCanvas: nep2D, systeem: 'lz', werker: false });
  const k = laag.knoppen[0];
  laag.zetKnop(0, 1);
  assert.equal(laag.leesKnop(0), 1);
  assert.equal(laag.waarde(0), k.max);
  laag.zetKnop(0, 0.25);
  laag.zetModulatie(0, 0.5);
  assert.equal(laag.leesKnop(0), 0.25, 'de stand (scherm, ring, soft-takeover) beweegt niet mee');
  assert.ok(bij(laag.waarde(0), k.min + 0.75 * (k.max - k.min), 1e-6) || k.step, 'het systeem rekent met stand + offset');
  assert.equal(laag.leesKnop(9), null, 'een plek die het systeem niet heeft: null');
});

test('VormLagen: twee lagen, kiezen, vorm stappen, aan/uit, dekking; een wissel zet de context terug', () => {
  const v = new VormLagen({ maakCanvas: nep2D, werker: false });
  assert.equal(v.lagen.length, 2);
  assert.notEqual(v.lagen[0].sys.id, v.lagen[1].sys.id, 'elke laag een andere vorm');
  v.kies(1); assert.equal(v.gekozen, 1);
  v.kies(2); assert.equal(v.gekozen, 0, 'rondlopen');
  const was = v.laag.sys.id;
  v.laag.ctx.lineCap = 'round';
  v.stapSysteem(1);
  assert.notEqual(v.laag.sys.id, was);
  assert.equal(v.laag.ctx.lineCap, 'butt', 'ctx.reset(): niets lekt naar het volgende systeem');
  v.wisselAan(); assert.equal(v.laag.aan, true);
  v.zetDekking(3); assert.equal(v.laag.dekking, 1);
});

// ---- de Worker ----------------------------------------------------------------------

class NepBitmap { constructor(b) { this.width = b.width; this.height = b.height; } close() { this.width = 0; this.height = 0; } }
const even = (ms = 2) => new Promise((r) => setTimeout(r, ms));
async function wachtTot(f, max = 1000) { for (let t = 0; t < max && !f(); t += 2) await even(2); }
function nepWerker() {
  const buiten = {}, binnen = {};
  const bezorg = (kant, data) => setTimeout(() => (kant.message || []).forEach((f) => f({ data })), 0);
  const zelf = {
    addEventListener: (s, f) => { (binnen[s] ||= []).push(f); },
    postMessage: (data) => bezorg(buiten, data),
  };
  let dood = false;
  const w = {
    addEventListener: (s, f) => { (buiten[s] ||= []).push(f); },
    postMessage: (data) => { if (dood) throw new Error('Worker is gestopt'); bezorg(binnen, structuredClone(data)); },
    terminate: () => { dood = true; for (const k in buiten) delete buiten[k]; },
    vuurFout: (message) => (buiten.error || []).forEach((f) => f({ message, preventDefault() {} })),
  };
  draaiWerker(zelf, { maakCanvas: nep2D, maakBitmap: (c) => Promise.resolve(new NepBitmap(c)), nu: () => 0 });
  return w;
}

test('Worker: frame(t) wacht nooit, het beeld komt als ImageBitmap terug, één verzoek tegelijk', async () => {
  const laag = new VormLaag({ maakCanvas: nep2D, systeem: 'lz', werker: nepWerker });
  assert.equal(laag.modus, 'werker');
  assert.equal(laag.budgetMs, BUDGET_WERKER);
  const eerste = laag.frame(0);
  assert.equal(eerste, laag.canvas, 'tot het eerste beeld binnen is: het eigen (lege) canvas');
  assert.equal(laag.frame(STAP), laag.canvas, 'een tweede vraag terwijl de eerste loopt: niets nieuws gevraagd');
  await wachtTot(() => laag.beeld);
  assert.ok(laag.beeld instanceof NepBitmap && laag.beeld.width === 640, 'een ImageBitmap van 640 × 360');
  assert.equal(laag.frame(2 * STAP), laag.beeld);
  laag.zetKnop(0, 1);                      // gaat als bericht mee (zetParams)
  assert.equal(laag.leesKnop(0), 1);
  laag.sluit();
});

test('Worker valt weg: verder op de hoofdthread met de parameters zoals ze staan, en een melding', () => {
  const laag = new VormLaag({ maakCanvas: nep2D, systeem: 'lz', werker: nepWerker });
  laag.zetKnop(0, 0.75);
  const meldingen = [];
  laag.on('modus', (m) => meldingen.push(m));
  laag.werker.vuurFout('kapot');
  assert.equal(laag.modus, 'hoofd');
  assert.equal(laag.budgetMs, BUDGET_HOOFD);
  assert.deepEqual(meldingen, [{ modus: 'hoofd', reden: 'kapot' }]);
  assert.equal(laag.leesKnop(0), 0.75, 'de knopstand blijft');
  assert.equal(laag.frame(1), laag.canvas, 'tekent nu zelf');
});

test('budget: boven budget een stapje omlaag, noodrem na drie beelden ver erboven (een melding, de laag blijft)', () => {
  const b = new Budget({ ms: 4 });
  for (let i = 0; i < 6; i++) b.meet(6);
  assert.ok(b.kwaliteit < 1, 'structureel erboven: lager');
  const c = new Budget({ ms: 4 });
  const ver = 4 * VER + 1;
  const r = [c.meet(ver), c.meet(ver), c.meet(ver)];
  assert.ok(!r[0].noodrem && !r[1].noodrem && r[2].noodrem, 'de derde keer: noodrem');
  assert.equal(c.kwaliteit, KWALITEIT_MIN);
  // In de laag: een nep-klok die per stap 30 ms "kost".
  let ms = 0;
  const laag = new VormLaag({ maakCanvas: nep2D, systeem: 'lz', werker: false, nu: () => ms });
  const stap = laag._stap.bind(laag);
  laag._stap = (t) => { ms += 30; stap(t); };
  const remmen = [];
  laag.on('noodrem', (x) => remmen.push(x));
  for (let i = 0; i < 6; i++) laag.frame(i * STAP);
  assert.equal(remmen.length, 1, 'één melding, geen stroom');
  assert.equal(laag.kwaliteit, KWALITEIT_MIN);
  assert.equal(laag.g.kwaliteit, KWALITEIT_MIN, 'het systeem ziet de nieuwe kwaliteit');
});

// ---- reageren op de mix en op de klok ---------------------------------------------------

test('router: offsets per plek, alleen open routes, kenmerken null = alles 0', () => {
  const r = new Router(2);
  assert.deepEqual([...r.nodig()], []);
  r.zetSterkte(0, 0.5);
  r.zetDoel(0, 3);
  r.zetBron(0, 'tel');
  assert.deepEqual([...r.nodig()], ['tel']);
  assert.deepEqual(offsets(r.routes[0], { tel: 0.8 }), [0, 0, 0.4, 0, 0, 0]);
  assert.deepEqual(offsets(r.routes[0], null), [0, 0, 0, 0, 0, 0]);
  const gezet = [];
  r.pasToe({ tel: 1 }, [{ zetModulatie: (k, o) => gezet.push([k, o]) }, { zetModulatie() {} }]);
  assert.deepEqual(gezet.filter(([, o]) => o), [[2, 0.5]]);
  assert.ok(BRONNEN.includes('een') && BRONNEN.includes('laag'));
  let mixGelezen = false;
  leesKenmerken(0, new Set(['tel']), { mix: { lees: () => { mixGelezen = true; return {}; } }, maat: { lees: () => ({ tel: 1 }) } });
  assert.equal(mixGelezen, false, 'alleen een klokbron open: de analyser wordt niet gelezen');
});

test('KlokLezer: tel = elke tel, een = alleen de "1" van de maat, stil = null', () => {
  const klok = new Klok();
  const l = new KlokLezer(klok);
  assert.equal(l.lees(1), null, 'de klok loopt niet');
  klok.start(0, 0, 120);
  const opEen = l.lees(0.001);                // tel 0,002: de "1"
  assert.ok(opEen.tel > 0.98 && opEen.een > 0.98);
  const opTwee = l.lees(0.5 + 0.001);          // tel 1
  assert.ok(opTwee.tel > 0.98 && opTwee.een === 0, 'tel 2 van de maat: geen "1"');
  const opVolgendeEen = l.lees(2 + 0.001);     // tel 4 = de volgende "1"
  assert.ok(opVolgendeEen.een > 0.98);
});
