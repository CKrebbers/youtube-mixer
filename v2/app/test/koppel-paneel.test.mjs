// Het paneel van de koppeling (src/ui/koppel-paneel.js) en zijn weergave (koppel-weergave.js), op een
// kleine nagebouwde DOM: waar de rij komt, bewaren en terugzetten, aan/uit over de bus, adres weigeren,
// de knopjes "deze Mac · pc" met de tweede klik, latentie klemmen, en: uit = geen timer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus } from '../src/kern/bus.js';
import { BeeldKoppeling, BEELD_ADRESSEN, WISSEL_BEVESTIG_MS } from '../src/koppel/beeld.js';
import { definieerKoppeling } from '../src/koppel/acties.js';
import { opzetKoppelPaneel, SLEUTELS, HERLEES_MS } from '../src/ui/koppel-paneel.js';
import { koppelStand, koppelTitel } from '../src/ui/koppel-weergave.js';

// ---- een kleine DOM: alleen wat het paneel gebruikt -------------------------------------------
class El {
  constructor(tag, doc) {
    Object.assign(this, { tagName: tag.toUpperCase(), ownerDocument: doc, children: [], parent: null, dataset: {}, style: {},
      className: '', textContent: '', title: '', value: '', luister: {}, attrs: {} });
    const el = this;
    this.classList = {
      contains: (n) => el.className.split(/\s+/).includes(n),
      toggle: (n, aan) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); if (aan ?? !s.has(n)) s.add(n); else s.delete(n); el.className = [...s].join(' '); },
    };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...c) { for (const x of c) { x.parent = this; this.children.push(x); } }
  prepend(...c) { for (const x of c.reverse()) { x.parent = this; this.children.unshift(x); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  addEventListener(t, f) { (this.luister[t] ||= []).push(f); }
  vuur(t, e = {}) { for (const f of this.luister[t] ?? []) f({ currentTarget: this, preventDefault() {}, ...e }); }
  blur() { /* zoals de browser: 'change' alleen als de waarde veranderde, en dat vuurt de test zelf */ }
  *alles() { for (const c of this.children) { yield c; yield* c.alles(); } }
  querySelector(sel) { const cls = sel.replace(/^\./, ''); for (const c of this.alles()) if (c.classList.contains(cls)) return c; return null; }
}
const nepDoc = () => { const doc = { createElement: (t) => new El(t, doc) }; return doc; };
const nepOpslag = (begin = {}) => { const m = new Map(Object.entries(begin)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const nepTimers = () => {
  const t = { lijst: new Set(), setInterval(f, ms) { const h = { f, ms }; t.lijst.add(h); return h; }, clearInterval(h) { t.lijst.delete(h); },
    setTimeout(f, ms) { const h = { f, ms, eens: true }; t.lijst.add(h); return h; }, clearTimeout(h) { t.lijst.delete(h); } };
  return t;
};
function nepZenderMaker() {
  const gemaakt = [];
  return {
    gemaakt,
    maak(opties) {
      const z = { opties, status: { verbonden: false, beeld: null }, ls: [], start() {}, stop() { this.status.verbonden = false; },
        track: () => true, mix() {}, poort: () => true, on(e, f) { this.ls.push(f); return () => {}; },
        verbind() { this.status.verbonden = true; for (const f of this.ls) f(this.status); } };
      gemaakt.push(z);
      return z;
    },
  };
}
const duckEngine = { tracks: [], nu: () => 0, vertraging: () => 0, klok: { loopt: false }, mixer: { lees: () => 0.5 } };

function opzet({ opslag = nepOpslag(), metBediening = true } = {}) {
  const doc = nepDoc();
  const wortel = doc.createElement('div');
  wortel.id = 'paneel-beeld';
  let bediening = null;
  if (metBediening) {
    bediening = doc.createElement('div');
    bediening.className = 'beeld-bediening';
    const nood = doc.createElement('div');
    nood.className = 'beeld-rij beeld-nood';
    bediening.append(nood);
    wortel.append(bediening);
  }
  const zt = nepTimers(), pt = nepTimers();
  const nz = nepZenderMaker();
  const k = new BeeldKoppeling({ engine: duckEngine, maakZender: nz.maak, timers: zt, nu: () => 0, mag: true });
  const bus = new Bus();
  const doen = [];
  bus.on('actie', (a) => doen.push(a));
  definieerKoppeling(bus, k);
  const meldingen = [];
  let klok = 0;
  const kp = opzetKoppelPaneel({ koppeling: k, bus, wortel, opslag, doc, timers: pt, nu: () => klok, meld: (t, s, sl) => meldingen.push({ t, s, sl }) });
  const vind = (cls) => kp.rij.children.find((c) => c.classList.contains(cls)) ?? kp.rij.querySelector(`.${cls}`);
  return { k, bus, kp, wortel, bediening, opslag, nz, zt, pt, meldingen, doen, vind, verder: (ms) => { klok += ms; } };
}

test('koppelStand: uit, elders, fout, geen adres, zoekt, half, ok', () => {
  assert.deepEqual(koppelStand({ aan: false }), { tekst: 'uit', soort: 'uit' });
  assert.equal(koppelStand({ aan: true, elders: true }).soort, 'geen');
  assert.equal(koppelStand({ aan: true, fout: 'x' }).soort, 'fout');
  assert.equal(koppelStand({ aan: true, adres: '' }).soort, 'geen');
  assert.equal(koppelStand({ aan: true, adres: 'ws://a/', verbonden: false }).soort, 'zoekt');
  assert.equal(koppelStand({ aan: true, adres: 'ws://a/', verbonden: true, beeld: null }).soort, 'half');
  const ok = koppelStand({ aan: true, adres: 'ws://a/', verbonden: true, beeld: { regime: 'Diepte', scene: 'Veld', volgt: true, fps: 60, bpm: 124 } });
  assert.deepEqual(ok, { tekst: 'verbonden · Diepte · Veld · volgt de klok', soort: 'ok' });
  assert.equal(koppelStand({ aan: false }, 'poort').soort, 'fout', 'een geweigerd adres gaat voor');
  assert.match(koppelTitel({ beeld: { fps: 59.6, bpm: 124.25, volgt: true } }, ok), /60 fps, 124,3 bpm, volgt de klok/);
});

test('de rij komt bovenaan de bediening van het tabblad Beeld; zonder bediening onderaan de wortel', () => {
  const a = opzet();
  assert.equal(a.bediening.children[0], a.kp.rij, 'eerste in .beeld-bediening');
  assert.ok(a.bediening.children[1].classList.contains('beeld-nood'), 'de noodknoppen blijven staan');
  assert.ok(a.kp.rij.classList.contains('beeld-rij'), 'de bestaande klasse van het paneel');
  const b = opzet({ metBediening: false });
  assert.equal(b.wortel.children.at(-1), b.kp.rij);
});

test('uit: geen zender, geen timer van het paneel; stand "uit"', () => {
  const { nz, pt, zt, vind } = opzet();
  assert.equal(nz.gemaakt.length, 0);
  assert.equal(pt.lijst.size + zt.lijst.size, 0);
  assert.equal(vind('kp-stand').textContent, 'uit');
  assert.equal(vind('kp-aan').textContent, 'uit');
});

test('bewaarde instellingen terug; aan/uit over de bus en bewaard; herlezen alleen zolang hij loopt', () => {
  const opslag = nepOpslag({ [SLEUTELS.aan]: '1', [SLEUTELS.adres]: 'ws://pc:7702/app', [SLEUTELS.latentie]: '40' });
  const { k, nz, pt, vind, doen } = opzet({ opslag });
  assert.ok(k.loopt && k.instellingen.latentie === 40 && nz.gemaakt.length === 1);
  assert.equal(vind('kp-adres').value, 'ws://pc:7702/app');
  assert.equal(vind('kp-latentie').value, '40');
  assert.match(vind('kp-stand').textContent, /zoekt de relay/);
  assert.equal(pt.lijst.size, 1, 'herlezen zolang de zender loopt');
  assert.equal([...pt.lijst][0].ms, HERLEES_MS);
  vind('kp-aan').vuur('click');
  assert.deepEqual(doen.map((d) => [d.id, d.v]), [['beeld.aan', true], ['beeld.aan', false]], 'via de bus');
  assert.ok(!k.loopt);
  assert.equal(opslag.m.get(SLEUTELS.aan), '0', 'bewaard');
  assert.equal(pt.lijst.size, 0, 'uit: de herlees-timer weg');
  assert.equal(vind('kp-aan').textContent, 'uit');
});

test('aan/uit van een controller (de bus) wordt ook bewaard', () => {
  const { bus, opslag } = opzet();
  bus.doe('beeld.aan', true); bus.doe('beeld.aan', false);
  assert.equal(opslag.m.get(SLEUTELS.aan), '1');
});

test('een geweigerd adres: rood, een melding, niet bewaard; een goed adres genormaliseerd en bewaard', () => {
  const { k, vind, opslag, meldingen } = opzet({ opslag: nepOpslag({ [SLEUTELS.adres]: 'ws://pc:7702/app' }) });
  const veld = vind('kp-adres');
  veld.value = 'http://pc:7702/app';
  veld.vuur('change');
  assert.equal(vind('kp-stand').dataset.soort, 'fout');
  assert.equal(veld.style.borderColor, 'var(--kill)');
  assert.equal(meldingen.at(-1).s, 'fout');
  assert.equal(opslag.m.get(SLEUTELS.adres), 'ws://pc:7702/app', 'het laatst geldige blijft bewaard');
  veld.value = '  WS://Omarchy.Local:7702/app ';
  veld.vuur('change');
  assert.equal(veld.value, 'ws://omarchy.local:7702/app');
  assert.equal(opslag.m.get(SLEUTELS.adres), 'ws://omarchy.local:7702/app');
  assert.equal(k.instellingen.adres, 'ws://omarchy.local:7702/app');
  assert.equal(veld.style.borderColor, 'var(--lijn)');
});

test('de knopjes "deze Mac · pc": meteen als je niet verbonden bent, anders eerst een tweede klik', () => {
  const { k, nz, vind, verder, meldingen } = opzet();
  const knop = (s) => vind('kp-adres').parent.children.find((c) => c.dataset.sleutel === s);
  knop('pc').vuur('click');
  assert.equal(k.instellingen.adres, BEELD_ADRESSEN[1].adres, 'uit: meteen');
  assert.equal(knop('pc').dataset.stand, 'aan', 'het knopje van het adres brandt');
  k.zet({ aan: true });
  nz.gemaakt.at(-1).verbind();
  knop('lokaal').vuur('click');
  assert.equal(k.instellingen.adres, BEELD_ADRESSEN[1].adres, 'verbonden met de pc: nog niet');
  assert.match(meldingen.at(-1).t, /nog eens/);
  verder(WISSEL_BEVESTIG_MS + 1);
  knop('lokaal').vuur('click');
  assert.equal(k.instellingen.adres, BEELD_ADRESSEN[1].adres, 'te laat: weer de eerste klik');
  verder(500);
  knop('lokaal').vuur('click');
  assert.equal(k.instellingen.adres, BEELD_ADRESSEN[0].adres, 'tweede klik binnen de tijd: wissel');
  k.zet({ aan: false });
});

test('latentie: geklemd, toegepast en bewaard', () => {
  const { k, vind, opslag } = opzet();
  const v = vind('kp-latentie') ?? vind('kp-adres').parent.querySelector('.kp-latentie');
  v.value = '9000';
  v.vuur('change');
  assert.equal(v.value, '500');
  assert.equal(k.instellingen.latentie, 500);
  assert.equal(opslag.m.get(SLEUTELS.latentie), '500');
});

test('vernietig: timers weg en de rij uit het paneel', () => {
  const { kp, bediening, pt } = opzet({ opslag: nepOpslag({ [SLEUTELS.aan]: '1', [SLEUTELS.adres]: 'ws://pc:7702/app' }) });
  assert.equal(pt.lijst.size, 1);
  kp.vernietig();
  assert.equal(pt.lijst.size, 0);
  assert.ok(!bediening.children.includes(kp.rij));
});
