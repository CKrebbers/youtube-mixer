// ✎ inrichten in de echte mixer (werkruimte S8, docs/werkruimte/S8.md): headless Chrome op een eigen
// server (poorten 8980/8981, alles in een tijdelijke map). Loopt na:
//   - ✎ op de werk-balk opent het inrichtpaneel; met `standaard` zegt het eerst een werkruimte te kiezen;
//   - aanwijzen: een klik op een knop op het scherm gaat NIET af (de read blijft), en wordt het juiste
//     item op het paneel (focus-track = {focus}); daarna staat het in het werkvak;
//   - een control bewegen (nep-APC: track knob 2 = track.2.filter): dat item erbij;
//   - de zoeker: de top-40 bovenaan; een klik zet het item erop;
//   - weghalen met twee klikken; terug naar de vorige inrichting; geen fouten in de console.
// Gebruik: VARVE_CHROME=<chrome> node tools/headless/inrichten.mjs
import { harnas, mixerKlaar, wacht, PROEF } from './werk-scherm.mjs';

const poort = Number(process.env.VARVE_IR_POORT) || 8980, debug = Number(process.env.VARVE_IR_DEBUG) || 8981;
const checks = [];
const ok = (naam, cond, extra = '') => { checks.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

const h = await harnas({ poort, debug, naam: 'inrichten', werkruimtes: [PROEF] });
try {
  const M = await h.nieuwePagina(`${h.basis}/?werk=proef`);
  await mixerKlaar(h, M, { tracks: 2 });
  await h.totdat(M, "window.varveInrichten && window.werk.naam === 'proef'", 15000);
  ok('lui: zolang niemand ✎ indrukt is er geen inrichtpaneel en geen inrichten.js', await h.ev(M, "!document.querySelector('.ir-paneel') && !performance.getEntriesByType('resource').some((r) => /werk\\/inrichten\\.js|top40\\.json/.test(r.name))"));
  ok('✎ staat op de werk-balk', await h.ev(M, "!!document.querySelector('#werk-balk .werk-inrichten')"));
  await h.ev(M, "document.querySelector('#werk-balk .werk-inrichten').click(), true");
  ok('het inrichtpaneel gaat open, met de panelen van de werkruimte', await h.totdat(M, "!document.querySelector('.ir-paneel').hidden && [...document.querySelectorAll('.ir-paneel-kies option')].some((o) => o.value === 'vier')", 5000) !== false);
  ok('de zoeker: de top-40 bovenaan (fader, filter …)', await h.ev(M, "[...document.querySelectorAll('.ir-vond')].slice(0, 2).map((b) => b.textContent).join() === '1. track.{focus}.fader,2. track.{focus}.filter'"),
    await h.ev(M, "[...document.querySelectorAll('.ir-vond')].slice(0, 3).map((b) => b.textContent).join(' | ')"));
  // Paneel vier kiezen en aanwijzen: de sync-knop van track 1 (de focus-track) op het scherm.
  await h.ev(M, "(() => { const s = document.querySelector('.ir-paneel-kies'); s.value = 'vier'; s.dispatchEvent(new Event('change')); return true; })()");
  const voorItems = await h.ev(M, 'window.werk.ruw.panelen.vier.items.length');
  await h.ev(M, "document.querySelector('.ir-aanwijs').click(), true");
  const sel = '[data-action="track.1.sync"]';
  const syncVoor = await h.ev(M, "window.varvePaneel.read('track.1.sync')");
  const p = await h.ev(M, `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await h.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 }, M);
  await h.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }, M);
  const erbij = await h.totdat(M, `window.werk.ruw.panelen.vier.items.length === ${voorItems + 1}`, 8000);
  const laatste = await h.ev(M, 'window.werk.ruw.panelen.vier.items.at(-1)');
  ok('aanwijzen van een knop: het juiste item op het paneel (focus = {focus})', erbij !== false && laatste.soort === 'knop' && laatste.action === 'track.{focus}.sync', JSON.stringify(laatste));
  ok('… en de knop ging NIET af (de read is gelijk)', await h.ev(M, "window.varvePaneel.read('track.1.sync')") === syncVoor);
  ok('… opgeslagen als eigen werkruimte en opnieuw geladen (het werkvak toont het item)', await h.totdat(M, "window.werk.bron === 'eigen' && document.querySelectorAll('#werkvak .vp-item').length === 7", 8000) !== false);
  // Een control bewegen: track knob 2 (cc:0:49) = track.2.filter, als bericht van een nep-poort door de
  // MidiHub (zoals de echte APC: onInput -> de mapping, en dan 'message' met wat het raakte).
  await h.ev(M, "document.querySelector('.ir-aanwijs').click(), true");
  await h.ev(M, `(() => { const m = window.midi; m.inputId = 'nep-apc';
    m._onMessage({ id: 'nep-apc', name: 'APC40 mkII (nep)' }, { data: new Uint8Array([0xb0, 49, 70]), timeStamp: performance.now() }); return true; })()`);
  const knop = await h.totdat(M, "window.werk.ruw.panelen.vier.items.at(-1)?.action === 'track.2.filter'", 8000);
  ok('een control bewegen (nep-APC track knob 2): track.2.filter als draai erbij', knop !== false && (await h.ev(M, 'window.werk.ruw.panelen.vier.items.at(-1).soort')) === 'draai');
  // Zoeken en klikken.
  await h.ev(M, "(() => { const z = document.querySelector('.ir-zoek'); z.value = 'xfader'; z.dispatchEvent(new Event('input')); return true; })()");
  await h.totdat(M, "[...document.querySelectorAll('.ir-vond')].some((b) => /mixer\\.xfader/.test(b.textContent))", 3000);
  await h.ev(M, "[...document.querySelectorAll('.ir-vond')].find((b) => /mixer\\.xfader/.test(b.textContent)).click(), true");
  ok('de zoeker: mixer.xfader als schuif erbij', await h.totdat(M, "window.werk.ruw.panelen.vier.items.at(-1)?.action === 'mixer.xfader' && window.werk.ruw.panelen.vier.items.at(-1).soort === 'schuif'", 8000) !== false);
  // Weghalen: twee klikken.
  const n = await h.ev(M, 'window.werk.ruw.panelen.vier.items.length');
  await h.ev(M, "[...document.querySelectorAll('.ir-item')].at(-1).click(), true");
  await wacht(200);
  ok('één klik op een item: nog niets weg (een vraag)', await h.ev(M, 'window.werk.ruw.panelen.vier.items.length') === n && await h.ev(M, "!!document.querySelector('.ir-item.vraag')"));
  await h.ev(M, "[...document.querySelectorAll('.ir-item')].at(-1).click(), true");
  ok('de tweede klik binnen 3 s: weg', await h.totdat(M, `window.werk.ruw.panelen.vier.items.length === ${n - 1}`, 8000) !== false);
  // Op een scherm zetten: de iPhone in dit deel.
  await h.ev(M, "[...document.querySelectorAll('.ir-knop')].find((b) => b.textContent === 'iphone').click(), true");
  ok('op scherm iphone in dit deel', await h.totdat(M, "(window.werk.ruw.delen.mix.schermen.iphone?.vakken ?? []).includes('paneel:vier') && window.werk.ruw.schermen.iphone?.soort === 'iphone'", 8000) !== false);
  // Terug: de vorige inrichting (zonder het iphone-scherm).
  await h.ev(M, "document.querySelector('.ir-terug').click(), true");
  ok('↶ terug: de vorige inrichting (het iphone-scherm weer weg)', await h.totdat(M, '!window.werk.ruw.delen.mix.schermen.iphone', 8000) !== false);
  ok('werk.terug staat op de bus (ook zonder ✎), alleen voor het scherm', await h.ev(M, "(() => { const m = window.varvePaneel.metaOf('werk.terug'); return !!m && m.alleenScherm === true && m.log === 'overslaan'; })()"));
  const fout = [...h.sessies.values()].flatMap((s) => s.fouten).filter((f) => !/ERR_CONNECTION|favicon|net::|Failed to load resource/.test(f));
  ok('geen fouten in de console', fout.length === 0, fout.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  checks.push(['geen uitzondering', false]);
} finally {
  await h.stop();
}
const fout = checks.filter(([, c]) => !c);
console.log(fout.length ? `\n${fout.length} van ${checks.length} FOUT` : `\nAlles groen (${checks.length}).`);
process.exit(fout.length ? 1 : 0);
