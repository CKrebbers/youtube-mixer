// De Klankschaal als instrument (src/audio/instrumenten/schaal.js) op de nep-Web Audio met een
// nep-worklet: wat hij naar de worklet stuurt en wanneer. Overgenomen uit v1
// test/instrumenten-fm-schaal.test.mjs deel 2, plus wat in v2 nieuw is: toon() als TEKST, de
// speelwijze van de klankschaal (kern, ladder, wrijven, dempen, met de hand), knoppen met een
// tijd, één worklet-laad per context, 'stop' bij weghalen en de melding bij een processorerror.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installeer } from './web-audio-mock.mjs';
import { instrOmgeving, schoneTijdlijn } from './instr-nep.mjs';

installeer();
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class extends Event { constructor(t, o = {}) { super(t); this.detail = o.detail; } };
}
const { SCHAAL, Schaal, OPHOGING, loslatenVan } = await import('../src/audio/instrumenten/schaal.js');
const { NOOTVELDEN, VELD_STEM } = await import('../src/audio/instrumenten/schaal-kern.js');
const { LICHAAM } = await import('../src/audio/instrumenten/klankschaal-kern.js');
const { startDrempel } = await import('../src/audio/overgang.js');

const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

async function maak(toon = () => null) {
  const omg = instrOmgeving();
  const uit = omg.ctx.createGain();
  const sc = SCHAAL.maak(omg.ctx, { uit, toon, klok: null });
  const B = () => sc.node?.port.berichten ?? [];
  return { omg, ctx: omg.ctx, uit, sc, B };
}

test('Klankschaal: zonder start geen worklet; noten vóór start gooien niet en laden wel', async () => {
  const { sc, omg } = await maak();
  assert.ok(sc instanceof Schaal && SCHAAL.soort === 'schaal' && sc.naam === 'Klankschaal' && sc.params.length === 8);
  assert.ok(omg.modules.length === 0 && sc.node === null);
  sc.noteOn(69, 0.8); sc.druk(0.5); sc.buig(1); sc.zetParam(1, 0.3); sc.slaKern(); sc.slaVeld(3);
  assert.equal(omg.modules.length, 1, 'begint wel met laden');
  await sc.start();
  await sc.start();
  assert.ok(omg.worklets.length === 1 && omg.modules.length === 1 && omg.worklets[0].naam === 'varve-schaal-instrument', 'één worklet, één keer geladen');
  assert.ok(omg.heeft(sc.node, sc.uitGain) && sc.uitGain.gain.value === OPHOGING);
  const vers = (await maak()).sc;
  assert.equal(vers.params[0].eenheid(0.1), '10% schaal');
  assert.equal(vers.params[1].eenheid(0.375), '4,3 s');
  assert.equal(vers.params[3].eenheid(1), 'gong');
  assert.equal(vers.params[6].eenheid(0.01), 'vrij');
  assert.ok(vers.params[7].gebaar === true, 'wrijf is een gebaar (niet onthouden)');
  // Een tweede Klankschaal in dezelfde context: dezelfde module, een eigen node.
  const tweede = SCHAAL.maak(omg.ctx, { uit: omg.ctx.createGain() });
  await tweede.start();
  assert.ok(omg.modules.length === 1 && omg.worklets.length === 2);
});

test('Klankschaal: de kern volgt de TEKST van toon() (en de cent), nooit terug naar D', async () => {
  let toon = 'Am';
  const { sc, B } = await maak(() => toon);
  await sc.start();
  const kern = B().filter((m) => m.t === 'kern');
  assert.ok(kern.length >= 1 && bijna(kern.at(-1).hz, 110), 'A mineur: kern op A2 = 110 Hz');
  B().length = 0;
  toon = { toonsoort: 'Am', cent: 43 };
  sc.noteOn(69, 0.8);
  assert.equal(B().find((m) => m.t === 'param')?.fijn, 43, 'de cent van de plaat gaat mee in fijn');
  const slag = B().find((m) => m.t === 'slag');
  assert.ok(slag.hz === 440 && slag.j >= 0 && slag.j < NOOTVELDEN && slag.v === VELD_STEM[slag.j] && slag.a.length === 4 && slag.lijf > 0);
  B().length = 0;
  toon = null;
  sc.noteOn(69, 0.8);
  assert.ok(!B().some((m) => m.t === 'kern' || m.t === 'param'), 'geen toonsoort: de laatste houden');
  toon = 'C#m';
  sc.stand();
  assert.ok(bijna(B().filter((m) => m.t === 'kern').at(-1).hz, 440 * Math.pow(2, (49 - 69) / 12)), 'C♯ mineur: kern C♯3');
  toon = 'rommel';
  B().length = 0;
  sc.stand();
  assert.ok(!B().some((m) => m.t === 'kern'), 'onleesbaar = geen toonsoort');
});

test('Klankschaal: velden kiezen, stemroof (gepland: eerst dempen), loslaten, pedaal, alleUit', async () => {
  const { sc, omg, B } = await maak();
  await sc.start();
  omg.nu = 100;
  sc.noteOn(69, 0.8, 100.5);
  const eerste = B().find((m) => m.t === 'slag');
  assert.equal(eerste.tijd, 100.5);
  sc.noteOn(69, 0.8, 101);
  assert.equal(B().filter((m) => m.t === 'slag').at(-1).j, eerste.j, 'dezelfde noot: hetzelfde veld');
  omg.nu = 110;
  sc.stil();
  omg.nu = 111;
  B().length = 0;
  const js = [];
  for (let i = 0; i < NOOTVELDEN; i++) { sc.noteOn(60 + i, 0.8); js.push(B().filter((m) => m.t === 'slag').at(-1).j); }
  assert.equal(new Set(js).size, NOOTVELDEN, 'tien noten, tien velden');
  assert.equal(sc.stand().klinkt, 10);
  sc.noteOn(80, 0.8);
  assert.equal(B().filter((m) => m.t === 'slag').at(-1).j, js[0], 'de elfde: het oudste veld');
  sc.noteOff(63);
  sc.noteOn(81, 0.8);
  assert.equal(B().filter((m) => m.t === 'slag').at(-1).j, js[3], 'eerst een veld dat los is');
  B().length = 0;
  sc.noteOn(82, 0.8, 112);
  const demp = B().find((m) => m.t === 'los');
  const slag = B().find((m) => m.t === 'slag');
  assert.ok(demp && bijna(demp.tijd, 112 - 0.02) && demp.t60 === 0.04 && slag.tijd === 112 && demp.j === slag.j, 'gepland: 20 ms vooraf dempen');
  omg.nu = 120;
  sc.stil();
  omg.nu = 120.5;
  B().length = 0;
  sc.noteOn(60, 0.8); sc.noteOn(64, 0.8);
  sc.noteOff(60);
  const los = B().filter((m) => m.t === 'los');
  assert.ok(los.length === 1 && bijna(los[0].t60, loslatenVan(0.5)) && los[0].tijd === 120.5);
  assert.ok(!B().some((m) => m.t === 'kernlos'), 'de kern nog niet: er is nog een toets');
  sc.houd(true);
  sc.noteOff(64);
  assert.equal(B().filter((m) => m.t === 'los').length, 1, 'pedaal: noteOff wacht');
  sc.houd(false);
  assert.ok(B().filter((m) => m.t === 'los').length === 2 && B().some((m) => m.t === 'kernlos' && m.t60 > 0), 'pedaal los: nu ook de kern');
  sc.noteOn(65, 0.8);
  assert.ok(B().some((m) => m.t === 'kernlos' && m.t60 === 0), 'een nieuwe noot: de kern weer vrij');
  sc.noteOn(66, 0.8);
  B().length = 0;
  sc.alleUit(122);
  assert.equal(B().filter((m) => m.t === 'los' && m.tijd === 122).length, 2);
});

test('Klankschaal: wrijven (aftertouch, modwiel, knop, wrijf()), buigen, knoppen met een tijd, stil', async () => {
  const { sc, omg, B } = await maak();
  await sc.start();
  omg.nu = 125;
  B().length = 0;
  sc.druk(0.6);
  assert.ok(B().at(-1).t === 'wrijf' && bijna(B().at(-1).p, 0.48));
  sc.mod(0.9);
  assert.ok(bijna(B().at(-1).p, 0.15 + 0.55 * 0.9), 'de sterkste telt');
  sc.druk(0); sc.mod(0);
  assert.ok(B().some((m) => m.t === 'wrijf' && m.p === 0));
  sc.wrijf(true);
  assert.ok(bijna(B().at(-1).p, 0.15 + 0.55 * 0.7), 'wrijf(): met de kracht van KRACHT');
  sc.wrijf(false);
  sc.zetParam(8, 0.3);
  assert.ok(bijna(B().filter((m) => m.t === 'wrijf').at(-1).p, 0.15 + 0.55 * 0.3), 'knop WRIJF');
  sc.zetParam(8, 0);
  B().length = 0;
  sc.buig(1); sc.buig(1.0001); sc.buig(-0.5); sc.buig(0);
  assert.equal(B().map((m) => m.c).join(','), '200,-100,0');
  B().length = 0;
  const gemeld = [];
  sc.on('param', (e) => gemeld.push(e));
  sc.zetParam(1, 0.8, 126);
  assert.ok(B().length === 1 && B()[0].t === 'param' && B()[0].tijd === 126 && bijna(B()[0].karakter, 0.8), 'param op zijn tijd naar de worklet');
  assert.ok(sc.leesParam(1) === 0.1 && sc.leesParam(1, 126) === 0.8 && gemeld[0].t === 126);
  sc.zetParam(3, 0.2);
  assert.equal(B().length, 1, 'kracht blijft op de hoofdthread');
  omg.nu = 130;
  sc.noteOn(60, 0.8);
  sc.stil();
  const g = sc.uitGain.gain, d = startDrempel(omg.ctx);
  const st = B().find((m) => m.t === 'stil');
  assert.ok(bijna(g.waarde(130 + d), OPHOGING, 1e-6) && g.waarde(130 + d + 0.01) === 0, 'uitgang na de drempel in 10 ms dicht');
  assert.ok(st && st.tijd >= 130 + d + 0.01 && g.waarde(st.tijd + 0.05) === 0 && bijna(g.waarde(st.tijd + 0.2), OPHOGING, 1e-6));
  assert.ok(!sc.pedaal && sc.stand().klinkt === 0);
  assert.ok(schoneTijdlijn(omg), JSON.stringify(omg.stats));
});

test('Klankschaal: de speelwijze van de klankschaal — kern, de acht velden van de ladder, dempen, met de hand', async () => {
  let toon = 'Dm';
  const { sc, omg, B } = await maak(() => toon);
  await sc.start();
  omg.nu = 200;
  B().length = 0;
  sc.slaKern(0.8);
  const kern = B().filter((m) => m.t === 'slag');
  assert.ok(kern.length === 2 && kern[0].v === 0 && kern[0].a.length === 12 && kern[1].v === LICHAAM, 'kern: zes paren, plus het lichaam');
  B().length = 0;
  const hz = [];
  for (let j = 1; j <= 8; j++) { sc.slaVeld(j, 0.8); hz.push(B().filter((m) => m.t === 'slag').at(-1).hz); }
  const ws = [220, 233.08, 261.63, 293.66, 329.63, 349.23, 392, 440];        // D Kurd van de Waterschaal
  assert.ok(hz.every((f, i) => Math.abs(1200 * Math.log2(f / ws[i])) < 0.1), `D Kurd: ${hz.map((f) => f.toFixed(2)).join(' ')}`);
  assert.equal(sc.ladderStand().velden.join(' '), 'A3 Bb3 C4 D4 E4 F4 G4 A4');
  assert.ok(sc.ladderStand().raak[1] && sc.ladderStand().raak[8], 'wat net klonk licht op');
  assert.ok(!B().some((m) => m.t === 'los'), 'een veld van de ladder klinkt vrij uit');
  toon = 'C';
  sc.slaVeld(4, 0.8);
  assert.ok(bijna(B().filter((m) => m.t === 'slag').at(-1).hz, 261.6255653005986, 1e-6), 'C majeur: veld 4 is de tonica C4');
  sc.zetLadder('kurd');
  sc.slaVeld(4, 0.8);
  assert.ok(sc.ladderStand().relatief && sc.ladderStand().toon === 'Am', 'Kurd op C majeur: relatief, A Kurd');
  sc.zetHand('F#m');
  sc.zetLadder('auto');
  assert.equal(sc.ladderStand().toon, 'F♯m');
  assert.ok(bijna(B().filter((m) => m.t === 'kern').at(-1).hz, 440 * Math.pow(2, (54 - 69) / 12)), 'met de hand: de kern meteen op F♯3 (G♯2..G3)');
  sc.zetHand(null);
  sc.zetTranspositie(2);
  assert.equal(sc.ladderStand().toon, 'D');
  sc.zetTranspositie(0);
  sc.demp(true, 201);
  assert.ok(B().at(-1).t === 'demp' && B().at(-1).aan === true && B().at(-1).v === -1 && B().at(-1).tijd === 201 && sc.ladderStand().dempt);
  sc.demp(false);
});

test('Klankschaal: vernietig stuurt eerst stop, dan los; een worklet-fout meldt één keer en herbouwt bij de volgende noot', async () => {
  const { sc, omg, uit } = await maak();
  await sc.start();
  const node = sc.node;
  sc.noteOn(60, 0.8);
  sc.vernietig();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(sc.node === null && node.port.dicht && !omg.heeft(node, sc.uitGain) && !omg.heeft(sc.uitGain, uit));
  assert.ok(node.port.berichten.some((m) => m.t === 'stop'), "eerst { t: 'stop' }");
  let gooit = false;
  try { sc.noteOn(60, 1); sc.slaKern(); sc.zetParam(1, 0.5); } catch (_) { gooit = true; }
  assert.ok(!gooit);

  const b = await maak();
  const fouten = [];
  b.ctx.addEventListener('varve-workletfout', (e) => fouten.push(e.detail));
  await b.sc.start();
  const n1 = b.sc.node;
  n1.onprocessorerror({ message: 'kapot' });
  assert.ok(b.sc.node === null && n1.port.dicht && fouten.length === 1 && /Klankschaal/.test(fouten[0].wat) && fouten[0].reden === 'kapot');
  n1.onprocessorerror?.({});
  assert.equal(fouten.length, 1);
  b.sc.noteOn(60, 0.8);
  await b.sc.start();
  assert.ok(b.sc.node && b.sc.node !== n1, 'de volgende noot bouwt een nieuwe worklet');
});
