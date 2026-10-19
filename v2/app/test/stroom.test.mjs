/**
 * Streamen (budget M7): welke pagina's nodig zijn, het ophalen en opruimen, en door de echte kern:
 * een gestreamd nummer klinkt bit voor bit als hetzelfde nummer in het geheugen, zolang de
 * pagina's er op tijd zijn.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginasNodig, Stroom, VOORUIT, LOS, TEGELIJK, MAX_PAGINAS } from '../src/audio/stroom.js';
import { maakKern, laadBron, planSegmenten, renderBlok, zetPagina, wisPagina, PAGINA } from '../src/audio/speler-kern.js';

const SR = 48000;
const PS = PAGINA / SR;                    // seconden per pagina (~1,37)
const lang = { sr: SR, frames: 31 * 60 * SR };   // een album van 31 minuten

test('vrij spelen: van de plek tot VOORUIT s verder, plus één pagina terug', () => {
  const P = 100;
  const nodig = paginasNodig([{ T: 0, P, R: 1, speelt: true }], 0, lang);
  const p0 = Math.floor(P / PS), p1 = Math.floor((P + VOORUIT) / PS);
  assert.equal(nodig[0], p0, 'de eerste is waar hij nu is');
  for (let p = p0; p <= p1; p++) assert.ok(nodig.includes(p), `pagina ${p}`);
  assert.ok(nodig.includes(p0 - 1), 'één terug');
  assert.ok(!nodig.includes(p1 + 1));
  assert.ok(nodig.length * PAGINA * 4 / 1e6 < 10, `~${(nodig.length * PAGINA * 4 / 1e6).toFixed(1)} MB`);
});

test('op 2× tempo: twee keer zoveel nummer vooruit; een sprong in het plan: beide plekken', () => {
  const snel = paginasNodig([{ T: 0, P: 0, R: 2, speelt: true }], 0, lang);
  assert.ok(snel.includes(Math.floor(2 * VOORUIT / PS) - 1));
  const sprong = paginasNodig([{ T: 0, P: 10, R: 1, speelt: true }, { T: 5, P: 600, R: 1, speelt: true }], 0, lang);
  assert.ok(sprong.includes(Math.floor(10 / PS)) && sprong.includes(Math.floor(14 / PS)), 'tot de sprong');
  assert.ok(sprong.includes(Math.floor(600 / PS)) && sprong.includes(Math.floor(620 / PS)), 'na de sprong');
  assert.ok(!sprong.includes(Math.floor(30 / PS)), 'niet wat na de sprong niet meer klinkt');
});

test('stil: de plek en de pagina erna; het cuepunt staat er altijd', () => {
  const nodig = paginasNodig([{ T: 0, P: 50, R: 1, speelt: false }], 0, { ...lang, pins: [300] });
  assert.deepEqual(nodig, [Math.floor(50 / PS), Math.floor(50 / PS) + 1, Math.floor(300 / PS), Math.floor(300 / PS) + 1]);
  assert.deepEqual(paginasNodig([], 0, { ...lang, pins: [0] }), [0, 1], 'zonder plan: alleen de cue');
});

test('nooit meer dan MAX_PAGINAS, en nooit buiten het nummer', () => {
  const veel = paginasNodig([{ T: 0, P: 0, R: 2, speelt: true }], 0, { ...lang, vooruit: 600 });
  assert.equal(veel.length, MAX_PAGINAS);
  const kort = paginasNodig([{ T: 0, P: 0, R: 1, speelt: true }], 0, { sr: SR, frames: PAGINA * 3 });
  assert.deepEqual(kort, [0, 1, 2]);
  const eind = paginasNodig([{ T: 0, P: 3 * PS - 0.1, R: 1, speelt: true }], 0, { sr: SR, frames: PAGINA * 3 });
  assert.ok(eind.every((p) => p >= 0 && p < 3));
});

/** Een nep-bron: pagina i = een herkenbaar patroon; lees wacht tot je hem loslaat. */
function nepBron() {
  const wacht = new Map();
  const gelezen = [];
  const lees = (i, signal) => new Promise((res, rej) => {
    gelezen.push(i);
    wacht.set(i, () => res(new Int16Array(PAGINA * 2).fill(i)));
    signal.addEventListener('abort', () => rej(new Error('afgebroken')));
  });
  const geef = async (i) => { wacht.get(i)?.(); wacht.delete(i); await new Promise((r) => setTimeout(r, 0)); };
  return { lees, gelezen, geef, wacht };
}

test('Stroom: in volgorde, hooguit TEGELIJK onderweg, weg pas na LOS seconden, overbodige verzoeken afgebroken', async () => {
  const b = nepBron();
  const berichten = [];
  let nu = 0;
  const st = new Stroom({ id: 7, sr: SR, frames: lang.frames, lees: b.lees, stuur: (m) => berichten.push(m), klok: () => nu });
  const rust = () => new Promise((r) => setTimeout(r, 0));
  st.bij([5, 6, 7, 8, 9]); await rust();
  assert.deepEqual(b.gelezen, [5, 6, 7].slice(0, TEGELIJK));
  await b.geef(5);
  assert.equal(berichten[0].type, 'pagina'); assert.equal(berichten[0].id, 7); assert.equal(berichten[0].i, 5);
  st.bij([5, 6, 7, 8, 9]); await rust();
  assert.ok(b.gelezen.includes(8), 'plaats vrij: de volgende');
  // Ergens anders heen: 6–8 niet meer nodig (6, 7 onderweg: afgebroken), 5 staat er en gaat pas na LOS weg.
  st.bij([40, 41]);
  assert.ok(!st.onderweg.has(6) && !st.onderweg.has(7));
  assert.ok(st.binnen.has(5));
  nu += LOS - 0.01; st.bij([40, 41]);
  assert.ok(st.binnen.has(5), 'nog niet');
  nu += 0.02; st.bij([40, 41]);
  assert.ok(!st.binnen.has(5), 'weg');
  assert.deepEqual(berichten.at(-1), { type: 'weg', id: 7, i: 5 });
  // Na sluiten komt een late pagina nergens meer aan.
  const n = berichten.length;
  st.sluit();
  await b.geef(40);
  assert.equal(berichten.length, n);
});

test('Stroom: een pagina die niet binnenkomt geeft één melding; de volgende ronde probeert opnieuw', async () => {
  const fouten = [];
  let keer = 0;
  const st = new Stroom({
    id: 1, sr: SR, frames: lang.frames, stuur: () => {}, klok: () => 0, onfout: (m) => fouten.push(m),
    lees: async () => { keer++; throw new Error('server weg'); },
  });
  st.bij([0]); await new Promise((r) => setTimeout(r, 0));
  st.bij([0]); await new Promise((r) => setTimeout(r, 0));
  assert.equal(keer, 2, 'opnieuw geprobeerd');
  assert.equal(fouten.length, 1);
  assert.match(fouten[0], /server weg/);
});

test('kern: een pagina hoort bij één laad (een late pagina van het vorige nummer doet niets)', () => {
  const k = maakKern(SR);
  laadBron(k, SR, PAGINA * 4, [], 1);
  const p = new Int16Array(PAGINA * 2).fill(100);
  assert.equal(zetPagina(k, 1, 2, p), true);
  assert.equal(k.bronPag[k.bron][2], p);
  laadBron(k, SR, PAGINA * 4, [], 2);
  zetPagina(k, 1, 3, new Int16Array(PAGINA * 2));   // hoort bij de oude bron (die nog uitvloeit)
  assert.equal(k.bronPag[k.bron][3], undefined, 'de nieuwe bron kreeg hem niet');
  assert.equal(zetPagina(k, 2, 99, p), false, 'buiten het nummer');
  assert.equal(zetPagina(k, 2, 1, new Int16Array(3)), false, 'oneven');
  zetPagina(k, 2, 1, p); wisPagina(k, 2, 1);
  assert.equal(k.bronPag[k.bron][1], undefined);
});

test('door de kern: gestreamd = in het geheugen, bit voor bit, ook over een sprong (pagina\'s op tijd)', async () => {
  const frames = PAGINA * 40;
  const bron = [];
  for (let p = 0; p < 40; p++) {
    const a = new Int16Array(PAGINA * 2);
    for (let i = 0; i < PAGINA; i++) { const v = Math.round(12000 * Math.sin((p * PAGINA + i) * 0.0123) + 3000 * Math.sin((p * PAGINA + i) * 0.31)); a[2 * i] = v; a[2 * i + 1] = -v; }
    bron.push(a);
  }
  const plan = [{ T: 0, P: 1, R: 1.03, speelt: true }, { T: 4, P: 30, R: 0.97, speelt: true }];
  // In het geheugen.
  const km = maakKern(SR);
  laadBron(km, SR, frames, bron.map((a) => a.slice()), 1);
  planSegmenten(km, plan);
  // Gestreamd: de Stroom haalt direct (een microtaak), de kern krijgt de pagina's via de berichten.
  const ks = maakKern(SR);
  laadBron(ks, SR, frames, [], 1);
  planSegmenten(ks, plan);
  let tNu = 0;
  const st = new Stroom({
    id: 1, sr: SR, frames, klok: () => tNu,
    lees: async (i) => bron[i].slice(),
    stuur: (m) => { if (m.type === 'pagina') zetPagina(ks, m.id, m.i, m.data); else if (m.type === 'weg') wisPagina(ks, m.id, m.i); },
  });
  st.bij(paginasNodig(plan, 0, { sr: SR, frames }));
  await new Promise((r) => setTimeout(r, 0));
  const Lm = new Float32Array(128), Rm = new Float32Array(128), Ls = new Float32Array(128), Rs = new Float32Array(128);
  let verschil = 0, klonk = 0;
  for (let b = 0; b < Math.round(8 * SR / 128); b++) {
    km.klok[0] = b * 128; ks.klok[0] = b * 128; tNu = (b * 128) / SR;
    if (b % 94 === 0) { st.bij(paginasNodig(plan, tNu, { sr: SR, frames })); await new Promise((r) => setTimeout(r, 0)); }
    renderBlok(km, Lm, Rm, 128); renderBlok(ks, Ls, Rs, 128);
    for (let i = 0; i < 128; i++) { verschil = Math.max(verschil, Math.abs(Lm[i] - Ls[i]), Math.abs(Rm[i] - Rs[i])); klonk = Math.max(klonk, Math.abs(Lm[i])); }
  }
  assert.ok(klonk > 0.3, 'er klonk iets');
  assert.equal(verschil, 0, `grootste verschil ${verschil}`);
  const MB = st.bytes / 1e6;
  assert.ok(MB < 50, `${MB.toFixed(1)} MB in de audiothread`);
});
