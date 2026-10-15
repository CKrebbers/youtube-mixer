// Spoor S10 (docs/EFFECTEN-MEER.md): de rack-editor in echte Chrome, zoals Clay hem gebruikt.
// Eigen server (VARVE_TESTSERVER=1, alle VARVE_* in een tijdelijke map, ook VARVE_SJABLONEN),
// headless Chrome, geen MIDI. Alles met de muis via CDP (Input.dispatchMouseEvent): klikken,
// draaien aan knoppen, een kromme trekken. Telt de HANDELINGEN voor "een nieuw effect maken en als
// sjabloon bewaren", en kijkt of de editor niet opnieuw tekent tijdens het slepen.
//
//   VARVE_CHROME=<chrome> node tools/headless/rack-editor.mjs [--poort 8931] [--debug 9531]
import { harnas, wacht } from './werk-scherm.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const arg = (n, std) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : std; };
const poort = arg('poort', 8931), debug = arg('debug', 9531);
const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam + (extra ? ` (${extra})` : '')); };

const sjabloonMap = mkdtempSync(join(process.env.VARVE_TMP || tmpdir(), 'varve-sjablonen-'));
const h = await harnas({ poort, debug, naam: 'rack-editor', extraEnv: { VARVE_SJABLONEN: join(sjabloonMap, 'eigen.json') }, werkruimtes: [] });
const { ev, totdat, nieuwePagina, cdp } = h;
let handelingen = 0;
let s;

const rect = (sel) => ev(s, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
const muis = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1, ...extra }, s);
async function klik(sel, { tel = true } = {}) {
  await ev(s, `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
  const r = await rect(sel);
  if (!r) throw new Error(`niet gevonden: ${sel}`);
  await muis('mousePressed', r.x, r.y); await muis('mouseReleased', r.x, r.y);
  if (tel) handelingen++;
  await wacht(60);
}
/** Een keuzelijst: telt als TWEE handelingen (openklikken en kiezen). */
async function kies(sel, waarde, { tel = true } = {}) {
  await ev(s, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(waarde)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  if (tel) handelingen += 2;
  await wacht(80);
}
/** Een knop draaien: indrukken, omhoog slepen (dy px), loslaten. Telt of de editor intussen opnieuw tekende. */
async function draai(sel, dy, { tel = true } = {}) {
  await ev(s, `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
  const r = await rect(sel);
  if (!r) throw new Error(`niet gevonden: ${sel}`);
  await ev(s, `window.__opnieuw = 0; window.__mo?.disconnect(); window.__mo = new MutationObserver((l) => { for (const m of l) if (m.type === 'childList' && m.target.classList?.contains('re-keten')) window.__opnieuw++; }); window.__mo.observe(document.querySelector('#rack-editor'), { childList: true, subtree: true })`);
  await muis('mousePressed', r.x, r.y, { buttons: 1 });
  for (let i = 1; i <= 8; i++) { await muis('mouseMoved', r.x, r.y - dy * i / 8, { buttons: 1 }); await wacht(16); }
  const tijdens = await ev(s, 'window.__opnieuw');
  await muis('mouseReleased', r.x, r.y - dy);
  if (tel) handelingen++;
  await wacht(60);
  return tijdens;
}

try {
  s = await nieuwePagina(`http://localhost:${poort}/`);
  ok('de mixer laadt', !!(await totdat(s, 'window.engine && document.querySelector(".fx-bewerk")', 30000)));
  // Zonder klik op de pagina loopt de AudioContext niet altijd: een klik zet hem aan.
  await klik('body', { tel: false });
  await ev(s, 'window.engine.ctx.resume?.()').catch(() => {});
  ok('de sjablonen staan in de kiezer (kant-en-klaar)', !!(await totdat(s, 'document.querySelectorAll(".fx-rack option[value^=\'s:\']").length >= 30', 10000)));

  console.log('\nnieuw effect maken en als sjabloon bewaren (de handelingen tellen)');
  handelingen = 0;
  await klik('.fx-bewerk');
  ok('de editor gaat open', await ev(s, '!document.querySelector("#rack-editor").classList.contains("hidden")'));
  // Leeg beginnen: alle effecten van het standaardrack weg (elke klik telt).
  let weg = 0;
  while (await ev(s, 'document.querySelectorAll("#rack-editor .re-kaart").length')) { await klik('#rack-editor [data-doe="weg"]'); weg++; }
  await kies('#rack-editor [data-doe="effect-erbij"]', 'kam');
  await kies('#rack-editor [data-doe="effect-erbij"]', 'reverb');
  ok('twee effecten in de keten (kam → galm)', (await ev(s, '[...document.querySelectorAll("#rack-editor .re-effect")].map((e) => e.textContent).join(",")')) === 'Kam,Reverb');
  // Knop 1: kiezen, "gebruiken" zet hem meteen op OPEN.
  await klik('#rack-editor .re-tegel[data-plek="1"]');
  await klik('#rack-editor [data-doe="plek-erbij"]');
  ok('knop 1 staat op OPEN', await ev(s, '!!document.querySelector("#rack-editor .re-kant.aan[data-kant=open]")'));
  const tekende1 = await draai('#rack-editor .re-param[data-slot="a"][data-param="meng"] .knob', 60);
  const tekende2 = await draai('#rack-editor .re-param[data-slot="b"][data-param="meng"] .knob', 50);
  ok(`tijdens het slepen tekent de keten niet opnieuw (${tekende1} + ${tekende2} keer)`, tekende1 === 0 && tekende2 === 0);
  // DICHT: knop dicht = droog (beide meng helemaal omlaag), dan nog eens DICHT om te stoppen.
  await klik('#rack-editor .re-kant[data-kant="dicht"]');
  await draai('#rack-editor .re-param[data-slot="a"][data-param="meng"] .knob', -200);
  await draai('#rack-editor .re-param[data-slot="b"][data-param="meng"] .knob', -200);
  await klik('#rack-editor .re-kant[data-kant="dicht"]');
  const links = await ev(s, 'window.engine.deck(window.engine.focus).fx.rack.macros[0]?.links.map((l) => `${l.target}:${l.from.toFixed(2)}→${l.to.toFixed(2)}`).join(" ")');
  ok(`knop 1 stuurt nu kam-meng en galm-meng, dicht = droog (${links})`, /a\.meng:0\.00→0\.\d+/.test(links) && /b\.meng:0\.00→0\.\d+/.test(links));
  await ev(s, 'const n = document.querySelector("#rack-editor .re-naam"); n.value = "Zingende ruimte"; n.dispatchEvent(new Event("input", { bubbles: true }))');
  handelingen++;
  await klik('#rack-editor [data-doe="als-sjabloon"]');
  ok('bewaard als eigen sjabloon (POST /api/sjablonen)', !!(await totdat(s, '/als eigen sjabloon/.test(document.querySelector("#rack-editor .re-status").textContent)', 5000)),
    await ev(s, 'document.querySelector("#rack-editor .re-status").textContent'));
  const opSchijf = JSON.parse(readFileSync(join(sjabloonMap, 'eigen.json'), 'utf8'));
  ok('op schijf: het sjabloon met zijn keten en knop, droog in de beginstand (knop 1 op 0, beide meng 0)', opSchijf.racks[0]?.name === 'Zingende ruimte' && opSchijf.racks[0].chain.length === 2
    && opSchijf.racks[0].macros[0].links.length === 2 && opSchijf.racks[0].macros[0].default === 0 && opSchijf.racks[0].macros[0].links.every((l) => l.from === 0));
  ok('in de kiezer onder "eigen sjablonen", en de kiezer staat erop', await ev(s, `(() => { const g = [...document.querySelectorAll('.fx-rack optgroup')].find((x) => x.label === 'eigen sjablonen'); const sel = document.querySelector('.fx-rack'); return !!g && g.textContent.includes('Zingende ruimte') && sel.selectedOptions[0]?.textContent === 'Zingende ruimte'; })()`));
  console.log(`  ..  handelingen: ${handelingen} = bewerk 1 · ${weg}× effect weg · 2 keuzelijsten (2 klikken elk) · knop 1 + gebruiken 2 · 2× draaien (OPEN) · DICHT, 2× draaien, DICHT uit 4 · naam 1 · als sjabloon 1`);
  ok(`een nieuw effect met één knop (open en dicht ingesteld), als sjabloon bewaard: ${handelingen - weg} handelingen, plus ${weg} om het standaardrack leeg te maken`, handelingen - weg <= 16);

  console.log('\nmodulators');
  await kies('#rack-editor [data-doe="mod-erbij"]', 'lfo', { tel: false });
  ok('een LFO erbij, met een doel', await ev(s, 'window.engine.deck(window.engine.focus).fx.rack.mods?.length === 1 && window.engine.deck(window.engine.focus).fx.rack.mods[0].doelen.length === 1'));
  await kies('#rack-editor input[data-doe="mod-sync"]', '', { tel: false });
  await ev(s, `(() => { const c = document.querySelector('#rack-editor input[data-doe="mod-sync"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await ev(s, `(() => { const r = document.querySelector('#rack-editor [data-doe="mod-hz"] input'); r.value = String(Math.log(2 / 0.02) / Math.log(8 / 0.02)); r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(s, 'window.engine.ctx.resume?.()').catch(() => {});
  const t0 = await ev(s, 'window.engine.ctx.currentTime');
  await wacht(700);
  const t1 = await ev(s, 'window.engine.ctx.currentTime');
  const meters = [];
  for (let i = 0; i < 6; i++) { meters.push(await ev(s, 'document.querySelector("#rack-editor .re-mod-meter span").style.transform')); await wacht(110); }
  ok(`de meter van de LFO beweegt (2 Hz, vrij; klok ${(t1 - t0).toFixed(2)} s verder)`, new Set(meters).size >= 3, meters.join(' '));
  const st = await ev(s, 'window.engine.deck(window.engine.focus).fx.modStanden()[0]?.soort');
  ok('modStanden: lfo', st === 'lfo');

  console.log('\ndroog/nat per effect, kopiëren en plakken');
  await klik('#rack-editor .re-kaart:nth-of-type(1) [data-doe="parallel"]', { tel: false });
  ok('∥: een knop "nat" op de kaart', await ev(s, '!!document.querySelector("#rack-editor .re-param.nat[data-slot=a]")'));
  await draai('#rack-editor .re-param.nat[data-slot="a"] .knob', -40, { tel: false });
  const meng = await ev(s, 'window.engine.deck(window.engine.focus).fx.rack.chain[0].meng');
  ok(`de nat-knop zet meng van dat effect (${meng?.toFixed?.(2)})`, typeof meng === 'number' && meng < 1);
  await klik('#rack-editor [data-doe="kopieer"]', { tel: false });
  ok('plak staat in "+ effect…"', await ev(s, '!!document.querySelector("#rack-editor [data-doe=effect-erbij] option[value=plak]")'));
  await kies('#rack-editor [data-doe="effect-erbij"]', 'plak', { tel: false });
  ok('geplakt: een tweede kam met dezelfde instellingen', await ev(s, `(() => { const c = window.engine.deck(window.engine.focus).fx.rack.chain; return c.length === 3 && c[2].type === 'kam' && c[2].meng === c[0].meng; })()`));

  console.log('\neigen kromme');
  await klik('#rack-editor .re-tegel[data-plek="1"]', { tel: false });
  await klik('#rack-editor [data-doe="meer"][data-link="0"]', { tel: false });
  await kies('#rack-editor [data-doe="curve"][data-link="0"]', 'eigen', { tel: false });
  ok('er staat een kromme', !!(await rect('#rack-editor canvas.re-kromme')));
  await ev(s, `document.querySelector('#rack-editor canvas.re-kromme').scrollIntoView({ block: 'center' })`);
  const r = await rect('#rack-editor canvas.re-kromme');
  // r is het midden van de kromme: daar indrukken (het middelste punt) en 25 px omhoog slepen.
  await muis('mousePressed', r.x, r.y, { buttons: 1 });
  for (let i = 1; i <= 5; i++) { await muis('mouseMoved', r.x, r.y - i * 5, { buttons: 1 }); await wacht(16); }
  await muis('mouseReleased', r.x, r.y - 25);
  const kromme = await ev(s, 'window.engine.deck(window.engine.focus).fx.rack.macros[0].links[0].kromme');
  ok(`het middelste punt omhoog getrokken (${kromme?.join(' ')})`, Array.isArray(kromme) && kromme.length === 5 && kromme[2] > 0.6);

  console.log('\nA/B, muteren, willekeurig');
  const voor = await ev(s, 'JSON.stringify(window.engine.deck(window.engine.focus).fx.naarJSON().chain)');
  await klik('#rack-editor [data-doe="ab"][data-kant="B"]', { tel: false });
  await klik('#rack-editor [data-doe="muteer"]', { tel: false });
  const na = await ev(s, 'JSON.stringify(window.engine.deck(window.engine.focus).fx.naarJSON().chain)');
  ok('muteren verandert de keten', na !== voor);
  await klik('#rack-editor [data-doe="ab"][data-kant="A"]', { tel: false });
  ok('A = weer wat er was', (await ev(s, 'JSON.stringify(window.engine.deck(window.engine.focus).fx.naarJSON().chain)')) === voor);
  await klik('#rack-editor [data-doe="ab"][data-kant="B"]', { tel: false });
  ok('B = de gemuteerde', (await ev(s, 'JSON.stringify(window.engine.deck(window.engine.focus).fx.naarJSON().chain)')) === na);
  await klik('#rack-editor [data-doe="willekeurig"]', { tel: false });
  ok('willekeurig: geen fout, alles binnen 0..1', await ev(s, `window.engine.deck(window.engine.focus).fx.naarJSON().chain.every((n) => Object.values(n.params).every((v) => v >= 0 && v <= 1))`));

  console.log('\nsjablonen en de XY-pad');
  const dub = await ev(s, `[...document.querySelectorAll('.fx-rack option')].find((o) => o.textContent === 'Dub-echo')?.value`);
  await kies('.fx-rack', dub, { tel: false });
  ok('Dub-echo laden: de editor volgt (uitleg in de status)', !!(await totdat(s, '/3\\/16/.test(document.querySelector("#rack-editor .re-status").textContent)', 3000)));
  await ev(s, `(async () => (await import('/src/control/actions.js')).invoke('track.' + (Object.keys(window.engine.decks).indexOf(window.engine.focus) + 1) + '.fx.xy.y', 0.8))()`);
  ok('track.N.fx.xy.y zet de knop die het sjabloon kiest (Dub-echo: knop 3 "Dof")', Math.abs((await ev(s, 'window.engine.deck(window.engine.focus).fx.leesPlek(3)')) - 0.8) < 1e-9);
  await klik('#rack-editor [data-doe="wis-sjabloon"]', { tel: false }).catch(() => {});
  ok('"wis sjabloon" alleen bij een eigen sjabloon (hier verborgen)', await ev(s, 'document.querySelector("#rack-editor [data-doe=wis-sjabloon]").hidden'));

  const fouten = [...h.sessies.values()].flatMap((x) => x.fouten);
  ok(`geen fouten in de console (${fouten.length})`, fouten.length === 0, fouten.slice(0, 3).join(' | '));
} catch (err) {
  ok(`geen uitzondering (${err.message})`, false);
} finally {
  await h.stop?.();
  rmSync(sjabloonMap, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
