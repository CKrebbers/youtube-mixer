// De uitlijnweergave (werkruimte S2, docs/werkruimte/S2.md, docs/WERKRUIMTE.md D4 "S2"):
// het rekenwerk (src/uitlijn/reken.js) met tracks waarvan het antwoord bekend is, de
// tekenbeslissing van de weergave (src/uitlijn/teken.js) op een nep-DOM, en de grenzen van
// het losse venster (uitlijn.html: geen AudioContext, geen MIDI, geen Web Lock).
// Puur rekenwerk en een nep-DOM; geen browser. In Chrome: tools/headless/uitlijn.mjs.
// Draai met: node test/uitlijn.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { Beatgrid } from '../src/engine/beatgrid.js';
import {
  maakAs, stukken, lijnen, getallen, faseTussen, vouw, stapels, sleutel, kleurVan, gehoord,
  reken, zoomVoor, verschuiving, ijkpunt, naarX, invoerVanEngine, alsGrid,
} from '../src/uitlijn/reken.js';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const bij = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const WORTEL = fileURLToPath(new URL('..', import.meta.url));

// ---- een paar tracks waarvan het antwoord bekend is --------------------------

const NU = 100, V = 0.0213;
let segIds = 0;
/** Een tijdlijn zoals Deck.tijdlijn() hem geeft. */
const tijdlijn = (o) => ({ segId: ++segIds, gridVersie: 1, T: NU - 5, P: 0, R: 1, loop: null, rem: null, vorig: null,
  speelt: true, wacht: false, remt: false, rate: 1, ...o });
/** Een baan die op klokmoment `NU − V` (wat je nu hoort) op tracktijd `hoor` staat. */
function baan(id, { bpm, anker = 0.13, hoor, rate = 1, ...rest }) {
  const grid = new Beatgrid({ bpm, firstBeat: anker });
  const T = NU - 5;
  const tl = tijdlijn({ T, P: hoor - (NU - V - T) * rate, R: rate, rate, ...(rest.tl || {}) });
  return { id, nr: id.charCodeAt(0) - 64, titel: id, grid, tijdlijn: tl, duur: 600, tellen: rest.tellen ?? null, klappen: rest.klappen ?? null, inhoud: 0 };
}
const invoer = (decks, maatgever = 'A', extra = {}) => ({ decks, maatgever, V, nu: NU, ...extra });

const gA = new Beatgrid({ bpm: 124, firstBeat: 0.13 });
const hA = gA.timeOf(201.3);            // A hoort tel 201,3 (maat 51, tel 2)
const RB = 124 / 128.3;
const gB = new Beatgrid({ bpm: 128.3, firstBeat: 0.07 });
/** B in de pas met A (zelfde fase en zelfde tel in de maat), plus `voor` seconden klok. */
const bInPas = (voor = 0, extraTellen = 0, o = {}) => baan('B', { bpm: 128.3, anker: 0.07, hoor: gB.timeOf(81.3 + extraTellen) + voor * RB, rate: RB, ...o });
const A = baan('A', { bpm: 124, hoor: hA });

console.log('de as: in tellen van de maatgever, zoals je hem hoort');
{
  const as = maakAs(invoer([A, bInPas()]));
  ok('de as staat op wat je hoort van de maatgever', bij(as.bM, 201.3, 1e-9), as.bM);
  ok('Lc = de tel van de maatgever op de klok', bij(as.Lc, 60 / 124, 1e-12));
  ok('een pagina van twee maten begint op een even "1"', as.pagina === 200 && as.tellen === 8, `${as.pagina}`);
  ok('de speelkop staat op 1,3 van 8 tellen', bij(as.kop, 1.3 / 8, 1e-9));
  const een = maakAs(invoer([A]), { maten: 1 });
  ok('een pagina van één maat', een.pagina === 200 && een.tellen === 4);
  ok('geen maatgever: geen as', maakAs(invoer([A], null)) === null);
}

console.log('\ngesynct op 124 en 128,3 bpm: de gridlijnen vallen op elkaar');
{
  const B = bInPas();
  const as = maakAs(invoer([A, B]));
  const lA = lijnen(A, stukken(A, as, as.pagina, as.pagina + as.tellen));
  const lB = lijnen(B, stukken(B, as, as.pagina, as.pagina + as.tellen));
  const px = (x) => (x - as.pagina) / as.tellen * 1200;
  let max = 0;
  for (const l of lA) { const m = lB.reduce((b, k) => Math.min(b, Math.abs(px(k.x) - px(l.x))), Infinity); max = Math.max(max, m); }
  ok('acht lijnen per pagina, bij beide', lA.length === 8 && lB.length === 8, `${lA.length} en ${lB.length}`);
  ok('binnen 0,5 px op 1200 px', max < 0.5, `${max.toExponential(2)} px`);
  ok('de lijnen staan op hele tellen van de as', lA.every((l) => bij(l.x, Math.round(l.x), 1e-9)));
  ok('de "1" van beide op dezelfde x', lA.filter((l) => l.een).map((l) => Math.round(l.x)).join() === lB.filter((l) => l.een).map((l) => Math.round(l.x)).join()
    && lA.filter((l) => l.een).length === 2);
  const gt = getallen(B, as);
  ok('grid Δ 0', bij(gt.grid, 0, 1e-6), gt.grid);
  ok('drift 0', bij(gt.drift, 0, 1e-6), gt.drift);
  ok('maat 0', gt.maat === 0);
  ok('hoorbare bpm 124', bij(gt.bpm, 124, 1e-9));
  ok('de maatgever zelf: geen grid Δ', getallen(A, as).maatgever && getallen(A, as).grid === null);
}

console.log('\neen fase van +10 ms');
{
  const B = bInPas(0.010);
  const as = maakAs(invoer([A, B]));
  const gt = getallen(B, as);
  ok('grid Δ 10,0 ± 0,1 ms', bij(gt.grid, 10, 0.1), gt.grid.toFixed(4));
  ok('kleuren: groen < 3, geel < 10, daarboven rood', kleurVan(10.5) === 'rood' && kleurVan(9.9) === 'geel' && kleurVan(2.9) === 'groen' && kleurVan(-12) === 'rood' && kleurVan(null) === null);
  const lA = lijnen(A, stukken(A, as, as.pagina, as.pagina + as.tellen));
  const lB = lijnen(B, stukken(B, as, as.pagina - 1, as.pagina + as.tellen));
  const verschuif = lA.map((l) => { const k = lB.reduce((b, q) => (Math.abs(q.x - l.x) < Math.abs(b.x - l.x) ? q : b)); return (k.x - l.x) * as.Lc * 1000; });
  ok('de baan staat 10 ms naar links (vroeger: hij loopt voor)', verschuif.every((d) => bij(d, -10, 1e-6)), verschuif[0].toFixed(6));
  const gm = getallen(bInPas(-0.004), as);
  ok('−4 ms: grid Δ −4 en geel', bij(gm.grid, -4, 0.1) && gm.kleur.grid === 'geel');
}

console.log('\ndrift: 0,5% sneller');
{
  const B = baan('B', { bpm: 128.3, anker: 0.07, hoor: gB.timeOf(81.3), rate: RB * 1.005 });
  const as = maakAs(invoer([A, B]));
  const gt = getallen(B, as);
  const verwacht = 16 * (60 / 124) * (1 - 1 / 1.005) * 1000;
  ok('ms per 16 tellen exact', bij(gt.drift, verwacht, 1e-9), `${gt.drift.toFixed(6)} = ${verwacht.toFixed(6)}`);
  ok('+: hij loopt uit naar voren', gt.drift > 38 && gt.drift < 39);
  const C = baan('C', { bpm: 128.3, anker: 0.07, hoor: gB.timeOf(81.3), rate: RB / 1.005 });
  ok('0,5% trager: negatief', getallen(C, as).drift < -38);
  // Na 16 tellen van de maatgever is het grid Δ precies zoveel verder.
  const later = maakAs({ ...invoer([A, B]), nu: NU + 16 * 60 / 124 });
  const g2 = getallen(B, later);
  ok('na 16 tellen is grid Δ precies "drift" ms verder', bij(g2.grid - gt.grid, verwacht, 1e-6), (g2.grid - gt.grid).toFixed(6));
}

console.log('\nmaat');
{
  const as = maakAs(invoer([A, bInPas(0, 1)]));
  const gt = getallen(bInPas(0, 1), as);
  ok('één tel voor: maat +1, grid Δ 0', gt.maat === 1 && bij(gt.grid, 0, 1e-6), `${gt.maat}`);
  ok('een tel achter: maat −1', getallen(bInPas(0, -1), as).maat === -1);
  ok('twee tellen naast: ±2', Math.abs(getallen(bInPas(0, 2), as).maat) === 2);
  ok('een hele maat naast: maat 0', getallen(bInPas(0, 4), as).maat === 0);
  ok('één tel en 8 ms voor: maat +1, grid Δ +8', (() => { const g = getallen(bInPas(0.008, 1), as); return g.maat === 1 && bij(g.grid, 8, 0.1); })());
  ok('een tel en 0,45 tel achter: maat −1 (de rest is fase)', (() => { const g = getallen(bInPas(-0.45 * 60 / 124, -1), as); return g.maat === -1; })());
}

console.log('\neen loop die rondgaat: geen sprong');
{
  // B in een loop van één tel, die vlak na nu rondgaat.
  const L = 60 / 128.3;
  const begin = gB.timeOf(81), eind = gB.timeOf(82);
  const tl = tijdlijn({ T: NU - V - 0.98 * L / RB, P: begin + 0.02 * L, R: RB, rate: RB, loop: { start: begin, end: eind } });
  const B = { ...bInPas(), tijdlijn: tl };
  // A in de pas: A hoort nu tel 202, B hoort nu begin + L (de naad), dus weer zijn tel 81.
  const Ap = baan('A', { bpm: 124, hoor: gA.timeOf(202) });
  const vlak = (dt) => maakAs({ ...invoer([Ap, B]), nu: NU + dt });
  const voor = getallen(B, vlak(0)), na = getallen(B, vlak(0.002)), ver = getallen(B, vlak(0.3));
  ok('grid Δ vóór en na de naad gelijk', bij(voor.grid, na.grid, 1e-6) && bij(na.grid, ver.grid, 1e-6), `${voor.grid.toFixed(4)} ${na.grid.toFixed(4)} ${ver.grid.toFixed(4)}`);
  ok('wat je hoort gaat terug naar het loopbegin', gehoord(B.tijdlijn, NU + 0.002, V) < begin + 0.01);
  const as0 = vlak(0), as1 = vlak(0.002);
  const st = stukken(B, as0, as0.pagina, as0.pagina + 8);
  ok('de pagina knipt op elke naad: een stuk per tel', st.length >= 8 && st.length <= 10, `${st.length} stukken`);
  const l0 = lijnen(B, st).map((l) => l.x), l1 = lijnen(B, stukken(B, as1, as1.pagina, as1.pagina + 8)).map((l) => l.x);
  ok('de lijnen staan na de naad op dezelfde x', l0.length === l1.length && l0.every((x, i) => bij(x, l1[i], 1e-6)));
  ok('en elke lijn op een hele tel van de as (de loop is één tel)', l0.every((x) => bij(x, Math.round(x), 1e-6)));
  ok('dezelfde sleutel (zelfde segment, zelfde pagina)', sleutel(B, as0, 1200, 512) === sleutel(B, as1, 1200, 512));
}

console.log('\neen track die op de maat wacht staat op de "1" waar hij invalt');
{
  // C start op de volgende "1" van A (tel 204 van A, wat je hoort). Gepland zoals de engine:
  // het geluid begint op T; dat is het moment dat A's POSITIE op die "1" staat.
  const gC = new Beatgrid({ bpm: 128.3, firstBeat: 0.2 });
  const tA = A.tijdlijn;
  const T = tA.T + (gA.timeOf(204) - tA.P) / tA.R;
  const P = gC.timeOf(64);                                       // een "1" van C
  const C = { id: 'C', nr: 3, grid: gC, duur: 600, inhoud: 0, tijdlijn: tijdlijn({ T, P, R: RB, rate: RB, wacht: true }) };
  const as = maakAs(invoer([A, C]));
  const st = stukken(C, as, as.pagina, as.pagina + 8);
  ok('eerst een wachtstuk zonder tracktijd', st[0].soort === 'wacht' && st[0].p0 === P && st[0].p1 === P);
  const eerste = lijnen(C, st)[0];
  ok('de eerste lijn is zijn "1", op x = 204 (de "1" van de maatgever)', eerste.een && bij(eerste.x, 204, 1e-9), eerste.x);
  ok('en dat is een "1" van de maatgever', gA.isMaatbegin(Math.round(eerste.x)));
  const gt = getallen(C, as);
  ok('valt in over 0,675 maat', bij(gt.wacht?.maten, (204 - 201.3) / 4, 1e-9), gt.wacht?.maten);
  ok('grid Δ 0 en maat 0 (zo valt hij in)', bij(gt.grid, 0, 1e-6) && gt.maat === 0, `${gt.grid} ${gt.maat}`);
}

console.log('\nmuziek Δ: de gevonden tellen');
{
  // Tellen op het grid van A; B zijn tellen 12 ms vroeg (een flam), maar de grids staan gelijk.
  const telsA = Float64Array.from({ length: 400 }, (_, k) => gA.timeOf(k));
  const telsB = Float64Array.from({ length: 400 }, (_, k) => gB.timeOf(k) - 0.012 * RB);
  const Am = { ...A, tellen: telsA };
  const B = { ...bInPas(), tellen: telsB };
  const as = maakAs(invoer([Am, B]));
  const m = faseTussen(B, as);
  ok('12 ± 1 ms, ook met de grids gelijk', bij(m?.ms, 12, 1) && bij(getallen(B, as).grid, 0, 1e-6), `${m?.ms?.toFixed(3)} ms uit ${m?.n}`);
  ok('niet grof', m.grof === false);
  ok('over de laatste 8 gehoorde tellen', m.n === 8);
  // Ruis van de detector (±5 ms) en een misser: de mediaan.
  const ruis = Float64Array.from(telsB, (t, k) => t + ((k * 7919) % 11 - 5) / 1000);
  const r = faseTussen({ ...B, tellen: ruis }, as);
  ok('met ±5 ms ruis nog 12 ± 2', bij(r?.ms, 12, 2), r?.ms?.toFixed(3));
  // Alleen klappen.
  const kl = faseTussen({ ...B, tellen: null, klappen: telsB }, maakAs(invoer([{ ...A, tellen: null, klappen: telsA }, { ...B, tellen: null, klappen: telsB }])));
  ok('alleen klappen: hetzelfde getal, maar grof', bij(kl?.ms, 12, 1) && kl.grof === true);
  ok('zonder tellen en klappen: geen muziek Δ', faseTussen(bInPas(), maakAs(invoer([A, bInPas()]))) === null);
  // Het grid van B ligt 20 ms naast zijn tellen: afwijkingBij zegt het (⚠; vanaf DRIFT = 12 ms).
  const B20 = { ...B, tellen: Float64Array.from({ length: 400 }, (_, k) => gB.timeOf(k) - 0.020 * RB) };
  ok('⚠: het grid ligt naast zijn muziek', getallen(B20, as).afwijking?.wie === 'track' && bij(Math.abs(getallen(B20, as).afwijking.ms), 20, 0.5), JSON.stringify(getallen(B20, as).afwijking));
  ok('geen ⚠ als het grid op de tellen ligt', getallen({ ...B, tellen: Float64Array.from({ length: 400 }, (_, k) => gB.timeOf(k)) }, as).afwijking === null);
  // In de pas met de kicks, het grid 10 ms ernaast: het grid zegt 10, de muziek 0.
  const Bg = { ...bInPas(0.010), tellen: Float64Array.from({ length: 400 }, (_, k) => gB.timeOf(k) + 0.010 * RB) };
  const g2 = getallen(Bg, as);
  ok('grid zegt +10, de muziek 0', bij(g2.grid, 10, 0.1) && bij(g2.muziek.ms, 0, 1), `${g2.grid.toFixed(2)} / ${g2.muziek.ms.toFixed(2)}`);
}

console.log('\nde vouw');
{
  const telsA = Float64Array.from({ length: 400 }, (_, k) => gA.timeOf(k));
  const telsB = Float64Array.from({ length: 400 }, (_, k) => gB.timeOf(k) - 0.012 * RB);
  const Am = { ...A, tellen: telsA };
  const as = maakAs(invoer([Am, { ...bInPas(), tellen: telsB }]));
  const v = vouw({ ...bInPas(), tellen: telsB }, as);
  ok('flam van 12 ms: twee stapels', stapels(v.punten) === 2, `${stapels(v.punten)}`);
  ok('de eigen stapel op +12 ms', v.punten.filter((p) => p.wie === 'eigen').every((p) => bij(p.ms, 12, 1e-6)));
  ok('32 eigen tellen, de nieuwste k = 0', v.punten.filter((p) => p.wie === 'eigen').length === 32 && v.punten.some((p) => p.k === 0));
  ok('elke tel in de maat (1–4) komt voor', [1, 2, 3, 4].every((t) => v.punten.some((p) => p.tel === t)));
  const gelijk = vouw({ ...bInPas(), tellen: Float64Array.from({ length: 400 }, (_, k) => gB.timeOf(k)) }, as);
  ok('gelijk: één stapel', stapels(gelijk.punten) === 1);
  const drift = vouw({ ...baan('B', { bpm: 128.3, anker: 0.07, hoor: gB.timeOf(81.3), rate: RB * 1.005 }), tellen: Float64Array.from({ length: 400 }, (_, k) => gB.timeOf(k)) }, as);
  const eigen = drift.punten.filter((p) => p.wie === 'eigen').sort((a, b) => b.k - a.k);
  ok('drift: een schuin spoor (de fase loopt op met de tijd)', eigen.every((p, i) => i === 0 || p.ms > eigen[i - 1].ms) && eigen.at(-1).ms - eigen[0].ms > 60);
  ok('zonder tellen: de gridlijnen', vouw(bInPas(), as).bron === 'grid');
}

console.log('\nde sleutel: tekenen alleen als er iets verandert');
{
  const B = bInPas();
  let tekenbeurten = 0, vorige = null;
  // 60 beelden, de klok loopt door (een seconde), er verandert niets: zelfde pagina.
  for (let k = 0; k < 60; k++) {
    const as = maakAs({ ...invoer([A, B]), nu: NU + k / 60 });
    const s = sleutel(B, as, 1200, zoomVoor(B, as, 1200));
    if (s !== vorige) { tekenbeurten++; vorige = s; }
  }
  ok('60 beelden zonder verandering: 1 keer tekenen (het eerste) = 0 keer opnieuw', tekenbeurten === 1, tekenbeurten);
  const as = maakAs(invoer([A, B]));
  const s = sleutel(B, as, 1200, 512);
  ok('een nieuw segment: andere sleutel', sleutel({ ...B, tijdlijn: { ...B.tijdlijn, segId: 999 } }, as, 1200, 512) !== s);
  ok('een nieuw segment van de maatgever: andere sleutel', sleutel(B, maakAs(invoer([{ ...A, tijdlijn: { ...A.tijdlijn, segId: 998 } }, B])), 1200, 512) !== s);
  ok('een andere gridversie: andere sleutel', sleutel({ ...B, tijdlijn: { ...B.tijdlijn, gridVersie: 2 } }, as, 1200, 512) !== s);
  ok('een andere breedte: andere sleutel', sleutel(B, as, 1100, 512) !== s);
  ok('een andere pagina: andere sleutel', sleutel(B, maakAs({ ...invoer([A, B]), nu: NU + 4 }), 1200, 512) !== s);
  ok('nieuwe inhoud (peaks/tellen): andere sleutel', sleutel({ ...B, inhoud: 7 }, as, 1200, 512) !== s);
  ok('geen JSON van het grid in de sleutel', s.length < 120 && !s.includes('{'), s);
  ok('zoom: een macht van 2, minstens zo fijn als het scherm', (() => { const z = zoomVoor(B, as, 2400); const nodig = 2400 / (8 * as.Lc * RB); return z >= nodig && z < 2 * nodig && Number.isInteger(Math.log2(z)); })());
}

console.log('\nverschuiving: wat er getekend is schuift mee, zonder opnieuw te tekenen');
{
  const B = bInPas(), as0 = maakAs(invoer([A, B]));
  const ref = ijkpunt(B, as0);
  const as1 = maakAs({ ...invoer([A, B]), nu: NU + 1 });
  ok('samen spelen: 0', bij(verschuiving(B, as1, ref), 0, 1e-9));
  const Bstil = { ...B, tijdlijn: { ...B.tijdlijn, speelt: false, P: gehoord(B.tijdlijn, NU, V) } };
  const refStil = ijkpunt(Bstil, as0);
  ok('pauze: schuift met de speelkop mee (2,07 tel per seconde)', bij(verschuiving(Bstil, as1, refStil), 124 / 60, 1e-9));
  const Astil = { ...A, tijdlijn: { ...A.tijdlijn, speelt: false, P: hA } };
  const asStil0 = maakAs(invoer([Astil, B])), asStil1 = maakAs({ ...invoer([Astil, B]), nu: NU + 1 });
  ok('de maatgever stil, de track speelt: naar links', bij(verschuiving(B, asStil1, ijkpunt(B, asStil0)), -124 / 60, 1e-9));
  const pauzeStuk = stukken(Bstil, as0, as0.pagina, as0.pagina + 8);
  ok('een pauze wordt getekend alsof hij nu start (soort stil)', pauzeStuk.every((s) => s.soort === 'stil') && pauzeStuk.length >= 1);
  ok('en zijn lijnen vallen dan op die van A (in de pas)', lijnen(Bstil, pauzeStuk).every((l) => bij(l.x, Math.round(l.x), 1e-6)));
}

console.log('\neen rem en een geplande sprong (keylock)');
{
  const B = bInPas();
  const as = maakAs(invoer([A, B]));
  const remmend = { ...B, tijdlijn: { ...B.tijdlijn, T: NU - V, P: gehoord(B.tijdlijn, NU, V), rem: { a: -RB / 1 } } };
  const st = stukken(remmend, as, as.pagina, as.pagina + 8);
  ok('een rem: stukjes, en daarna stil', st.length > 10 && st.at(-1).p0 === st.at(-1).p1);
  const xs = naarX(Float64Array.from({ length: 300 }, (_, k) => gB.timeOf(k)), st);
  ok('tijdens de rem liggen de tellen steeds verder uit elkaar', xs.length > 2 && xs.every((t, i) => i < 2 || t.x - xs[i - 1].x > xs[i - 1].x - xs[i - 2].x - 1e-6));
  const sprong = { ...B, tijdlijn: { ...B.tijdlijn, segId: 77, T: NU - V + 0.05, P: gB.timeOf(120), vorig: { T: B.tijdlijn.T, P: B.tijdlijn.P, R: RB, loop: null, rem: null, speelt: true } } };
  const s2 = stukken(sprong, as, as.pagina, as.pagina + 8);
  ok('vóór een geplande sprong speelt het vorige segment', s2[0].soort === 'speelt' && bij(s2[0].p0, stukken(B, as, as.pagina, as.pagina + 8)[0].p0, 1e-9));
  ok('erna het nieuwe', s2.some((s) => bij(s.p0, gB.timeOf(120), 1e-6)));
}

console.log('\nde hele invoer (reken) en de engine-invoer');
{
  const r = reken(invoer([A, bInPas(0.005)]));
  ok('reken: de as en een rij getallen per track', r.as && r.banen.length === 2 && bij(r.banen[1].getallen.grid, 5, 0.1));
  ok('reken zonder maatgever: banen zonder getallen', reken(invoer([A], null)).banen[0].getallen === null);
  ok('een grid als JSON (de iPad) werkt ook, één keer gebouwd', (() => { const j = gA.toJSON(); return alsGrid(j) === alsGrid(j) && alsGrid(j).bpm === 124; })());
  // Een nep-engine zoals de mixer hem heeft (duck-typed).
  const deck = (id, tl, extra = {}) => ({ id, buffer: {}, title: id, grid: gA, duration: 300, tellen: null, onsets: null, gridVersie: 1,
    tijdlijn: () => tl, position: tl?.P ?? 0, rate: 1, playing: true, ...extra });
  const engine = { ctx: { currentTime: NU, outputLatency: 0.01, baseLatency: 0.005, graafVertraging: 0.0015 },
    decks: { A: deck('A', A.tijdlijn), B: deck('B', null, { position: 12, playing: false }), C: { buffer: null } },
    syncMaster: () => engine.decks.A };
  const inv = invoerVanEngine(engine, { analysis: { A: { peaks: new Float32Array(4) } } });
  ok('invoerVanEngine: alleen tracks met een nummer, met hun tracknummer', inv.decks.length === 2 && inv.decks[0].nr === 1 && inv.decks[1].nr === 2);
  ok('V uit uitgangsVertraging (hoorbaar.js)', bij(inv.V, 0.0165, 1e-12));
  ok('de maatgever en de klok', inv.maatgever === 'A' && inv.nu === NU);
  ok('een BufferBron zonder tijdlijn krijgt een segment uit het deck', inv.decks[1].tijdlijn.P === 12 && inv.decks[1].tijdlijn.speelt === false);
  ok('peaks tellen mee in de inhoud', inv.decks[0].inhoud !== inv.decks[1].inhoud);
}

// ---- de weergave op een nep-DOM -----------------------------------------------

/**
 * Een nep-document: net genoeg DOM voor teken.js (elementen, dataset, style,
 * events, canvas met een 2d-context die telt). Geen defaultView: dan geen
 * ResizeObserver en een vaste breedte.
 */
function maakNepDoc() {
  const doc = { defaultView: null };
  const ctx2d = (c) => ({ canvas: c, fillStyle: '', font: '', globalAlpha: 1,
    clearRect() {}, fillRect() { c.verf++; }, drawImage() { c.verf++; }, fillText() { c.verf++; }, beginPath() {}, rect() {}, fill() { c.verf++; } });
  doc.createElement = (tag) => {
    const e = { tagName: tag.toUpperCase(), ownerDocument: doc, className: '', dataset: {}, style: {}, children: [], parent: null, hidden: false,
      textContent: '', luisteraars: {},
      appendChild(k) { if (k.parent) k.remove(); k.parent = e; e.children.push(k); return k; },
      remove() { if (e.parent) { e.parent.children = e.parent.children.filter((x) => x !== e); e.parent = null; } },
      addEventListener(n, f) { (e.luisteraars[n] ||= []).push(f); },
      removeEventListener(n, f) { e.luisteraars[n] = (e.luisteraars[n] || []).filter((x) => x !== f); },
      closest(sel) { let x = e; const k = sel.replace('.', ''); while (x) { if (x.className.split(' ').includes(k)) return x; x = x.parent; } return null; } };
    if (tag === 'canvas') { e.width = 300; e.height = 150; e.verf = 0; const g = ctx2d(e); e.getContext = () => g; }
    return e;
  };
  return doc;
}

console.log('\nde weergave (teken.js) op een nep-DOM: tekent alleen als de sleutel verandert');
{
  const doc = maakNepDoc();
  const { UitlijnWeergave } = await import('../src/uitlijn/teken.js');
  const el = doc.createElement('div');
  let nu = NU;
  const B = bInPas();
  const invokes = [];
  const w = new UitlijnWeergave(el, { invoer: () => ({ ...invoer([A, B]), nu }), invoke: (id, v) => invokes.push([id, v]),
    metaOf: (id) => (id === 'track.2.phase.offset' ? { kind: 'value' } : null), read: () => 0.5, breedte: 1200, dpr: 1 });
  w.stap();
  const na1 = w.stats.tekenbeurten;
  for (let k = 1; k <= 60; k++) { nu = NU + k / 60 * 0.5; w.stap(); }
  ok('het eerste beeld tekent elke baan één keer', na1 >= 2, na1);
  ok('60 beelden zonder verandering: 0 keer opnieuw', w.stats.tekenbeurten === na1, `${w.stats.tekenbeurten - na1}`);
  ok('de speelkop beweegt wel (CSS-transform)', /translateX/.test(w._kop.style.transform));
  B.tijdlijn = { ...B.tijdlijn, segId: B.tijdlijn.segId + 100 };
  w.stap();
  ok('een nieuw segment: alleen die baan opnieuw', w.stats.tekenbeurten === na1 + 1, `${w.stats.tekenbeurten - na1}`);
  w.zetBreedte(1100); w.stap();
  ok('een andere breedte: alles opnieuw (en de kop)', w.stats.tekenbeurten >= na1 + 3);
  ok('de getallen staan in het DOM, met hun waarde in data-ms', (() => { const r = w._rijen.get('B'); return r && r.grid.dataset.ms !== undefined && Math.abs(Number(r.grid.dataset.ms)) < 0.5; })());
  // Slepen: track.2.phase.offset met de versleepte fractie (een halve tel naar rechts = later = read − ½·…).
  w._sleep('B', 0); w._sleep('B', 1100 / 8 * 0.25); w._sleepLos();
  ok('een baan slepen = track.N.phase.offset (¼ tel naar rechts = read − ¼)', invokes.length >= 1 && invokes.at(-1)[0] === 'track.2.phase.offset' && bij(invokes.at(-1)[1], 0.25, 0.01), JSON.stringify(invokes.at(-1)));
  const w2 = new UitlijnWeergave(doc.createElement('div'), { invoer: () => invoer([A, B]), invoke: (id, v) => invokes.push([id, v]), metaOf: () => null, read: () => null, breedte: 1200, dpr: 1 });
  const voor = invokes.length;
  w2.stap(); w2._sleep('B', 0); w2._sleep('B', 100); w2._sleepLos();
  ok('zonder die action (metaOf): slepen doet niets', invokes.length === voor);
  w.zetVorm('vouw'); w.stap();
  ok('vorm vouw tekent', w.vorm === 'vouw' && w.stats.tekenbeurten > 0);
  w.zetVorm('strook'); w.stap();
  ok('vorm strook: één maat', w.vorm === 'strook' && w._as?.tellen === 4);
  w.vernietig();
  ok('vernietigen haalt de weergave uit het element', el.children.length === 0);
}

// ---- het losse venster ---------------------------------------------------------

console.log('\nuitlijn.html: geen AudioContext, geen MIDI, geen Web Lock (de hele importboom)');
{
  const html = readFileSync(join(WORTEL, 'uitlijn.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  ok('één module: src/uitlijn/venster.js', scripts.length === 1 && scripts[0].endsWith('src/uitlijn/venster.js'), scripts.join());
  ok('geen inline script', !/<script(?![^>]*src=)[^>]*>[^<]+<\/script>/.test(html));
  const gezien = new Set(), boom = [];
  const loop = (pad) => {
    if (gezien.has(pad) || !existsSync(pad)) return;
    gezien.add(pad); boom.push(relative(WORTEL, pad));
    const bron = readFileSync(pad, 'utf8');
    for (const m of bron.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) loop(resolve(dirname(pad), m[1]));
    for (const m of bron.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) loop(resolve(dirname(pad), m[1]));
  };
  loop(join(WORTEL, 'src/uitlijn/venster.js'));
  console.log(`  boom: ${boom.join(' → ')}`);
  const zonder = (b) => b.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  for (const f of boom) {
    const b = zonder(readFileSync(join(WORTEL, f), 'utf8'));
    ok(`${f}: geen AudioContext, MIDI of Web Lock`, !/\b(AudioContext|OfflineAudioContext|webkitAudioContext|requestMIDIAccess|locks\.request|AudioWorklet)\b/.test(b));
  }
  ok('niets uit ui/, control/ of server/', boom.every((f) => !/^src\/(ui|control)\/|^server\//.test(f)));
  const srv = readFileSync(join(WORTEL, 'server/index.js'), 'utf8');
  ok('uitlijn.html staat op de witte lijst van de server', /uitlijn\|/.test(srv) || /uitlijn/.test(srv));
}

console.log('\nde aanhaker');
{
  const bron = readFileSync(join(WORTEL, 'src/ui/aanhakers/uitlijn.js'), 'utf8');
  ok('zet window.varveUitlijn', /window\.varveUitlijn\s*=/.test(bron));
  ok('een knop die uitlijn.html opent', /uitlijn\.html/.test(bron) && /window\.open\(/.test(bron));
  ok('toonInWerkvak(el, vorm)', /toonInWerkvak/.test(bron));
  ok('definieert geen actions (alleen scherm)', !/\bdefine\(/.test(bron));
  ok('toonVak(el, naam): een vak uit een werkruimte', /toonVak/.test(bron) && /vakVorm/.test(bron));
  const venster = readFileSync(join(WORTEL, 'src/uitlijn/venster.js'), 'utf8');
  ok('uitlijn.html leest ?vorm= en ?maten=', /searchParams|URLSearchParams/.test(venster) && /'vorm'/.test(venster) && /'maten'/.test(venster));
}

console.log('\nvaknamen uit een werkruimte (vakVorm)');
{
  const { vakVorm, VAKKEN } = await import('../src/uitlijn/teken.js');
  ok('"uitlijn" = pagina, twee maten', JSON.stringify(vakVorm('uitlijn')) === '{"vorm":"pagina","maten":2}');
  ok('"uitlijn-strook" en "uitlijn-vouw"', vakVorm('uitlijn-strook').vorm === 'strook' && vakVorm('uitlijn-vouw').vorm === 'vouw');
  ok('"uitlijn:pagina:1" = één maat', JSON.stringify(vakVorm('uitlijn:pagina:1')) === '{"vorm":"pagina","maten":1}');
  ok('geen uitlijnvak: null', vakVorm('paneel:super') === null && vakVorm('uitlijn:raar') === null && vakVorm(null) === null);
  ok('elke vaste naam heeft een bestaande vorm', Object.values(VAKKEN).every((v) => ['pagina', 'strook', 'vouw'].includes(v)));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
