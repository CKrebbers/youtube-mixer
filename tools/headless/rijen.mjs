// De rijen onder de bovenbalk (stems, koptelefoon, instrument, patronen, master,
// auto, klankschaal): blijven de acht trackkolommen met hun faders en de
// sampler in beeld, met welke rijen er ook open staan? (6 okt: met meerdere
// rijen open ging het hoofdgebied scrollen en vielen de faders en de sampler
// van Clay's MacBook-scherm.)
//
// De app in een headless Chromium, met een eigen server en zonder MIDI, twee
// demotracks en een instrument op track 3 (dan tonen de INSTRUMENT- en
// PATROON-rij alles wat ze kunnen: dat zijn de hoogste). Op 1440×790 (Clay's
// MacBook in Chrome) en 1920×1080, met 0, 1 (elke rij apart), 3 en alle rijen
// open (en met de videokolom erbij één en alle), gemeten:
//   - elke fader, knop en knob in de acht kolommen en de hele sampler (kop,
//     lengte, acht pads, VOL): helemaal binnen het scherm, niet weggeknipt door
//     een gebied dat scrolt, en niet bedekt (elementFromPoint op het midden en
//     vlak binnen elke rand);
//   - elke fader minstens 56 px hoog (de ondergrens van .kol-onder);
//   - de pagina scrolt niet (niet in de hoogte en niet opzij: niets onder de
//     bovenbalk is breder dan het scherm), en het hoofdgebied (main) ook niet.
//     Dat de BOVENBALK zelf op 1440 px te breed is (de knoppen rechts vallen
//     weg) staat er als opmerking bij: dat is een andere fout, van vóór 6 okt;
//   - elke open rij is helemaal te zien: meteen, of door het gebied van de
//     rijen zelf te scrollen (dat mag), met elke knop heel en niet bedekt;
//   - een melding staat boven de open rijen, niet over hun knoppen.
// Schermafdrukken in de uitmap: rijen-<label>-<B>x<H>-<rijen>.png.
//
// Gebruik:  node tools/headless/rijen.mjs [uitmap] [--label voor|na]
//           VARVE_WORTEL=<map> draait de app uit een andere map (bijv. `git archive`
//           van studio/integratie: de stand van vóór de reparatie).
// Poorten:  VARVE_KIJK_POORT (standaard 8863), VARVE_KIJK_DEBUG (9463).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = fileURLToPath(new URL('../..', import.meta.url));
const WORTEL = process.env.VARVE_WORTEL || HIER;
const args = process.argv.slice(2);
const LABEL = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'na';
const UIT = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--label') || join(HIER, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8863, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9463;
const tmp = mkdtempSync(join(tmpdir(), 'varve-rijen-'));

function zoekChrome() {
  if (process.env.VARVE_CHROME) return { pad: process.env.VARVE_CHROME, shell: false };
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
    if (shell) {
      const map = join(cache, shell);
      const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
      if (sub) return { pad: join(map, sub, 'chrome-headless-shell'), shell: true };
    }
  }
  for (const naam of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return { pad: execFileSync('which', [naam], { encoding: 'utf8' }).trim(), shell: false }; } catch (_) {}
  }
  throw new Error('geen Chromium gevonden (zet VARVE_CHROME)');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
    VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = zoekChrome();
const browser = spawn(chrome.pad, [
  ...(chrome.shell ? [] : ['--headless=new']),
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,790',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const fouten = [];
function cdp(method, params = {}) {
  const id = ++volg;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, fout) => wachtend.set(id, { ok, fout }));
}
async function evalueer(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function foto(naam) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}
/** Headless tekent Chromium pas een beeld als iemand erom vraagt: een kleine schermafdruk dwingt er een af. */
const beeld = () => cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 } }).catch(() => null);
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${!cond && extra ? ` (${extra})` : ''}`); };

const RIJEN = ['stems', 'koptelefoon', 'instrument', 'patronen', 'master', 'auto', 'klankschaal'];
/**
 * Welke rijen samen open: geen, elk apart, twee keer drie (de lage en de hoge), alle;
 * en met de videokolom open (die maakt het focusdeck hoger) één en alle.
 */
const COMBINATIES = [
  [],
  ...RIJEN.map((r) => [r]),
  ['stems', 'koptelefoon', 'auto'],
  ['instrument', 'patronen', 'master'],
  RIJEN,
  ['video', 'patronen'],
  ['video', ...RIJEN],
];
const naamVan = (combi) => {
  const r = combi.filter((x) => x !== 'video'), v = combi.includes('video') ? 'video+' : '';
  return v + (r.length === 0 ? 'geen' : r.length === RIJEN.length ? 'alle' : r.join('+'));
};
/** Van deze combinaties een schermafdruk (per maat). */
const FOTO = new Set(['geen', 'patronen', 'stems+koptelefoon+auto', 'instrument+patronen+master', 'alle', 'video+alle']);

/** In de pagina: meten. */
const METEN = `window.__rijen = (() => {
  const SEL = 'button, input, select, .knob';
  const doorsnede = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  /** Het deel van el dat je ziet: binnen het scherm en binnen elk gebied dat knipt (overflow). */
  const zichtbaar = (el) => {
    const r = el.getBoundingClientRect();
    let v = doorsnede({ l: r.left, t: r.top, r: r.right, b: r.bottom }, { l: 0, t: 0, r: innerWidth, b: innerHeight });
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const q = p.getBoundingClientRect();
      v = doorsnede(v, { l: q.left + p.clientLeft, t: q.top + p.clientTop, r: q.left + p.clientLeft + p.clientWidth, b: q.top + p.clientTop + p.clientHeight });
    }
    return { r, v };
  };
  /** Helemaal te zien en te pakken? Geeft null (goed) of wat er mis is. */
  const pakbaar = (el) => {
    if (!el.getClientRects().length) return 'niet getekend';
    const { r, v } = zichtbaar(el);
    if (r.width < 2 || r.height < 2) return 'geen maat';
    if (v.r - v.l < r.width - 1 || v.b - v.t < r.height - 1) {
      return 'afgesneden (' + Math.round(Math.max(0, v.b - v.t)) + ' van ' + Math.round(r.height) + ' px hoog, '
        + Math.round(Math.max(0, v.r - v.l)) + ' van ' + Math.round(r.width) + ' px breed in beeld)';
    }
    // Het midden en vlak binnen elke rand (niet de hoeken: een ronde knop heeft daar niets).
    const i = Math.min(3, r.width / 4, r.height / 4), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const punten = [[cx, cy], [r.left + i, cy], [r.right - i, cy], [cx, r.top + i], [cx, r.bottom - i]];
    for (const [x, y] of punten) {
      const top = document.elementFromPoint(x, y);
      if (!top || !(top === el || el.contains(top))) return 'bedekt door ' + (top ? (top.id ? '#' + top.id : top.tagName.toLowerCase() + '.' + [...top.classList].join('.')) : 'niets');
    }
    return null;
  };
  const naam = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 3).map((c) => '.' + c).join('')
    + (el.dataset.action ? ' [' + el.dataset.action + ']' : el.dataset.sig ? ' {' + el.dataset.sig + '}' : '');
  /** Elementen die je moet kunnen pakken; een knob telt als geheel (niet zijn binnenkant). */
  const pakken = (wortel) => [...wortel.querySelectorAll(SEL)].filter((el) => !el.parentElement.closest('.knob') && el.getClientRects().length
    && getComputedStyle(el).visibility !== 'hidden');
  return {
    /** De rijen (en de videokolom) in deze stand zetten met hun eigen knop in de bovenbalk. */
    zet(open) {
      for (const id of ${JSON.stringify(RIJEN)}) {
        const rij = document.getElementById(id);
        if (rij.classList.contains('hidden') === open.includes(id)) document.getElementById(id + '-btn').click();
      }
      if (document.getElementById('video-panel').classList.contains('hidden') === open.includes('video')) document.getElementById('video-btn').click();
      return ${JSON.stringify(RIJEN)}.filter((id) => !document.getElementById(id).classList.contains('hidden'));
    },
    meet() {
      const main = document.querySelector('main');
      const se = document.scrollingElement;
      const uit = { kolommen: [], sampler: [], faders: [], rijen: {}, pagina: {} };
      for (const kol of document.querySelectorAll('#kolommen .kol')) {
        const mis = pakken(kol).map((el) => [naam(el), pakbaar(el)]).filter(([, m]) => m);
        uit.kolommen.push({ kolom: kol.dataset.kolom, n: pakken(kol).length, mis });
        uit.faders.push(Math.round(kol.querySelector('.vfader').getBoundingClientRect().height));
      }
      const sampler = document.getElementById('sampler');
      const sm = pakbaar(sampler);
      uit.sampler = [...(sm ? [['#sampler', sm]] : []), ...pakken(sampler).map((el) => [naam(el), pakbaar(el)]).filter(([, m]) => m)];
      uit.samplerN = pakken(sampler).length;
      const mf = document.querySelector('#fd-scenes .vfader');
      uit.masterfader = { h: Math.round(mf.getBoundingClientRect().height), mis: pakbaar(mf) };
      // Opzij: alles behalve de bovenbalk (die is op 1440 px al te breed, zie boven).
      const breed = [...document.body.children].filter((el) => !el.matches('.topbar') && el.getClientRects().length
        && getComputedStyle(el).position !== 'fixed').map((el) => Math.max(el.getBoundingClientRect().right, el.getBoundingClientRect().left + el.scrollWidth));
      uit.pagina = {
        scrolt: se.scrollHeight > innerHeight + 1 || se.scrollTop > 0 || se.scrollLeft > 0 || Math.max(...breed) > innerWidth + 1,
        maten: [Math.round(Math.max(...breed)), se.scrollHeight, innerWidth, innerHeight],
        bovenbalk: Math.round(document.querySelector('.topbar').scrollWidth),
        mainScrolt: main.scrollHeight > main.clientHeight + 1 || main.scrollWidth > main.clientWidth + 1,
        main: [main.clientHeight, main.scrollHeight],
        kolommenH: Math.round(document.getElementById('kolommen').getBoundingClientRect().height),
        focusdeck: pakbaar(document.getElementById('focus-deck')),
      };
      return uit;
    },
    /** Elke open rij: in beeld brengen door zijn eigen scrollgebied (niet de pagina, niet main) te scrollen, dan meten. */
    async rijen() {
      const uit = {};
      const open = ${JSON.stringify(RIJEN)}.filter((id) => !document.getElementById(id).classList.contains('hidden'));
      const gebieden = new Set();
      for (const id of open) {
        const rij = document.getElementById(id);
        let sc = null;
        for (let p = rij.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p !== document.querySelector('main')) { sc = p; break; }
        }
        if (sc) {
          gebieden.add(sc);
          sc.scrollTop += rij.getBoundingClientRect().top - sc.getBoundingClientRect().top;
          await new Promise((r) => requestAnimationFrame(() => r()));
        }
        const els = pakken(rij);
        const mis = els.map((el) => [naam(el), pakbaar(el)]).filter(([, m]) => m);
        const r = rij.getBoundingClientRect();
        uit[id] = { h: Math.round(r.height), n: els.length, mis, gescrold: !!sc };
      }
      for (const sc of gebieden) sc.scrollTop = 0;
      const sc = [...gebieden][0];
      return { rijen: uit, gebied: sc ? { h: sc.clientHeight, inhoud: sc.scrollHeight } : null };
    },
    /** Een melding: staat hij boven de open rijen (niet over hun knoppen)? */
    melding() {
      const m = window.meld('proef: staat deze melding boven de rijen?', 'info', 60000);
      const r = m.getBoundingClientRect();
      const open = ${JSON.stringify(RIJEN)}.filter((id) => !document.getElementById(id).classList.contains('hidden'));
      const over = [];
      for (const id of open) {
        for (const el of pakken(document.getElementById(id))) {
          const { v } = zichtbaar(el);
          if (v.r <= v.l || v.b <= v.t) continue;          // niet in beeld (het rij-gebied is weggescrold)
          if (v.l < r.right && v.r > r.left && v.t < r.bottom && v.b > r.top) over.push(id + ': ' + naam(el));
        }
      }
      const uit = { onder: Math.round(innerHeight - r.bottom), over };
      m.remove();
      return uit;
    },
  };
})(); true`;

/** Track 1 en 2 een demotrack met grid, een instrument (poly) op track 3, focus op 3. */
const KLAARZETTEN = `(async () => {
  const e = window.engine;
  const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
  const { Beatgrid } = await import('/src/engine/beatgrid.js');
  const demo = renderDemoTrack(e.ctx, { bars: 32 });
  for (const id of ['A', 'B']) { const d = e.deck(id); await d.laadGeheugen(demo, 'demo ' + id); d.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 })); }
  if (e.instrumentOp('C')?.soort !== 'poly') e.zetInstrument('C', 'poly');
  e.setFocus('C');
  return true;
})()`;

const verslag = { label: LABEL, wortel: WORTEL, maten: {} };
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null);
  }
  const pagina = doelen.find((d) => d.type === 'page');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  // Veilig met de APC aangesloten: geen MIDI in deze pagina.
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.patronen && window.meld)').catch(() => false)) break; await wacht(200); }
  await wacht(800);
  await evalueer(KLAARZETTEN);
  await evalueer(METEN);
  console.log(`rijen (${LABEL}${WORTEL !== HIER ? `, app uit ${WORTEL}` : ''})`);

  for (const [B, H] of [[1440, 790], [1920, 1080]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: B, height: H, deviceScaleFactor: 1, mobile: false });
    const maat = `${B}x${H}`;
    verslag.maten[maat] = {};
    console.log(`\n${B} × ${H}`);
    for (const combi of COMBINATIES) {
      const nm = naamVan(combi);
      const open = await evalueer(`window.__rijen.zet(${JSON.stringify(combi)})`);
      await beeld(); await wacht(150); await beeld();
      const m = await evalueer('window.__rijen.meet()');
      const r = await evalueer('window.__rijen.rijen()');
      const mel = combi.some((x) => x !== 'video') ? await evalueer('window.__rijen.melding()') : null;
      verslag.maten[maat][nm] = { open, ...m, ...r, melding: mel };
      if (FOTO.has(nm)) { await beeld(); await foto(`rijen-${LABEL}-${maat}-${nm}.png`); }

      const kolMis = m.kolommen.flatMap((k) => k.mis.map(([n, w]) => `kolom ${k.kolom} ${n}: ${w}`));
      const rijMis = Object.entries(r.rijen).flatMap(([id, x]) => x.mis.map(([n, w]) => `${id} ${n}: ${w}`));
      const kort = (l) => l.slice(0, 3).join(' | ') + (l.length > 3 ? ` | … (${l.length})` : '');
      const t = `${maat} ${nm}:`;
      ok(`${t} rijen open zoals gevraagd`, JSON.stringify(open) === JSON.stringify(RIJEN.filter((x) => combi.includes(x)))
        && (await evalueer("!document.getElementById('video-panel').classList.contains('hidden')")) === combi.includes('video'), JSON.stringify(open));
      ok(`${t} acht kolommen helemaal in beeld en te pakken (${m.kolommen.reduce((s, k) => s + k.n, 0)} elementen)`, kolMis.length === 0 && m.kolommen.length === 8, kort(kolMis));
      ok(`${t} faders ${Math.min(...m.faders)}–${Math.max(...m.faders)} px (≥ 56)`, Math.min(...m.faders) >= 56);
      ok(`${t} sampler helemaal in beeld en te pakken (${m.samplerN} elementen)`, m.sampler.length === 0, kort(m.sampler.map(([n, w]) => `${n}: ${w}`)));
      ok(`${t} de pagina en main scrollen niet`, !m.pagina.scrolt && !m.pagina.mainScrolt,
        `pagina ${m.pagina.maten.join('/')}, main ${m.pagina.main.join('/')}`);
      if (combi.some((x) => x !== 'video')) {
        ok(`${t} elke open rij helemaal te zien, zo nodig door het rij-gebied te scrollen${r.gebied ? ` (gebied ${r.gebied.h} px hoog, de rijen samen ${r.gebied.inhoud})` : ''}`, rijMis.length === 0, kort(rijMis));
        ok(`${t} een melding staat niet over de knoppen van een open rij (${mel.onder} px van onder)`, mel.over.length === 0, kort(mel.over));
      }
      console.log(`   ·  kolommen ${m.pagina.kolommenH} px, masterfader ${m.masterfader.h} px${m.masterfader.mis ? ` (${m.masterfader.mis})` : ''}, `
        + `focusdeck ${m.pagina.focusdeck ?? 'in beeld'}, rijen ${Object.entries(r.rijen).map(([id, x]) => `${id} ${x.h}`).join(' · ') || '—'}`);
      if (!combi.length && m.pagina.bovenbalk > B) console.log(`   ·  let op: de bovenbalk is ${m.pagina.bovenbalk} px breed op een scherm van ${B} (knoppen rechts vallen weg; een andere fout, niet in deze controle)`);
    }
    await evalueer('window.__rijen.zet([])');
  }
  ok('geen fouten in de pagina', fouten.length === 0, fouten.slice(0, 3).join(' | '));
} catch (err) {
  console.error(err);
  uitkomst.push(['uitvoering', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL');
  server.kill('SIGINT');
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
writeFileSync(join(UIT, `rijen-${LABEL}.json`), JSON.stringify(verslag, null, 1));
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(`\n${uitkomst.length - rood}/${uitkomst.length} ok${rood ? ` — ${rood} FAIL` : ''}  (foto's en rijen-${LABEL}.json in ${UIT})`);
process.exit(rood ? 1 : 0);
