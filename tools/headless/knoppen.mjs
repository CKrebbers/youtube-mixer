// Elke knop op het scherm: doet hij iets? (Clay, 5 okt: "heel veel knoppen zijn wel in te
// klikken met de muis en de knop doet dan ook iets maar ze werken niet".)
//
// De app in een headless Chromium, met een eigen server en zonder MIDI, twee
// demotracks (124 bpm, met grid) en een instrument op track 3. Dan elke zichtbare
// knop één voor één met een ECHTE muisklik (CDP: indrukken, even vasthouden,
// loslaten), en vóór, tijdens en na de klik vastleggen wat er is: wat elke
// action op de bus leest, welke panelen open zijn (alles met een id), het mapje,
// focus, tracks (speelt, positie, titel, instrument), meldingen, geluid dat start,
// verzoeken naar de server, bestandskiezers, vensters en links, en fouten.
// Een knop die NIETS verandert is verdacht; een knop met een fout is stuk.
// Wat een klik opent (een rij, een paneel, een andere grid-modus) wordt daarna
// ook doorlopen: de lijst groeit tot alles gezien is.
//
// Vóór elke klik: niets speelt, track 1 en 2 geladen, instrument op 3 (een
// eerdere klik kan dat veranderd hebben). confirm() zegt "nee" (niets wordt
// echt gewist), prompt() geeft niets, links en bestandskiezers worden genoteerd
// en niet gevolgd.
//
// Gebruik:  node tools/headless/knoppen.mjs [uitmap]     (rapport: uitmap/knoppen.json)
// Poorten:  VARVE_KIJK_POORT (standaard 8833), VARVE_KIJK_DEBUG (9433).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8833, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9433;
const tmp = mkdtempSync(join(tmpdir(), 'varve-knoppen-'));

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
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let ws, volg = 0;
const wachtend = new Map();
const meldingen = [];
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
/** Twee beelden van de renderloop afwachten (die tekent de rij); headless kan een beeld lang duren. */
const beeld = () => evalueer(`Promise.race([
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
  new Promise((r) => setTimeout(() => r(false), 5000))])`);
const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };
const meld = (tekst) => console.log(`   ·  ${tekst}`);


/** In de pagina: wat er is (staat), en welke knoppen er te klikken zijn (lijst). */
const HELPER = `window.__a = (() => {
  const rec = { meld: [], fetch: [], start: 0, open: [], fouten: [] };
  // Een nieuwe melding, of dezelfde die opnieuw oplicht (flits): allebei een antwoord op de klik.
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.addedNodes) if (n.textContent) rec.meld.push(n.textContent.slice(0, 200));
      if (m.type === 'attributes' && m.target.classList?.contains('flits') && !(m.oldValue || '').includes('flits')) rec.meld.push(m.target.textContent.slice(0, 200));
    }
  }).observe(document.getElementById('meldingen'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  const ef = window.fetch;
  // Stukken van een lopende opname gaan vanzelf: geen effect van een klik.
  window.fetch = (u, i) => { const m = (i?.method || 'GET').toUpperCase(); if (m !== 'GET' && !/\\/stuk(\\?|$)/.test(String(u))) rec.fetch.push(m + ' ' + String(u)); return ef(u, i); };
  const st = AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start = function (...a) { rec.start++; return st.apply(this, a); };
  window.open = (...a) => { rec.open.push('venster ' + a[0]); return null; };
  window.confirm = (t) => { rec.open.push('vraag: ' + String(t).slice(0, 80)); return false; };
  window.prompt = (t) => { rec.open.push('prompt: ' + String(t).slice(0, 80)); return null; };
  window.alert = (t) => { rec.open.push('alert: ' + String(t).slice(0, 80)); };
  const ic = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () { if (this.type === 'file') { rec.open.push('bestandskiezer'); return; } return ic.call(this); };
  const ac = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download || String(this.href).startsWith('blob:')) { rec.open.push('download ' + this.download); return; } return ac.call(this); };
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (a && !a.getAttribute('href').startsWith('#') && !a.getAttribute('href').startsWith('javascript:')) { e.preventDefault(); rec.open.push('link ' + a.getAttribute('href')); }
  }, true);
  window.addEventListener('error', (e) => rec.fouten.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => rec.fouten.push('promise: ' + String(e.reason?.message || e.reason)));
  let A = null;
  const SEL = 'button, [data-kind="button"], [role="button"], a[href], summary, .baan, label.knop, [data-tab]';
  const zichtbaar = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || el.disabled) return null;
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 30);
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { r, buiten: true };
    const top = document.elementFromPoint(x, y);
    if (!top || !(top === el || el.contains(top))) return { r, bedekt: top ? (top.id || top.className || top.tagName) : '?' };
    return { r, x, y };
  };
  const pad = (el) => { const p = []; let n = el; while (n && n !== document.body && p.length < 4) { if (n.id) { p.unshift('#' + n.id); break; } n = n.parentElement; } return p.join(' '); };
  const naam = (el) => [el.tagName.toLowerCase(), el.id ? '#' + el.id : '', [...el.classList].filter((c) => !/^(on|aan|uit|actief|hidden|dof|leeg|gelukt|mislukt|half|knipper|spg-\\w+-?\\d*)$/.test(c)).slice(0, 4).map((c) => '.' + c).join(''),
    el.dataset.action ? ' [' + el.dataset.action + ']' : '', el.dataset.sig ? ' {' + el.dataset.sig + '}' : '',
    ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 30) + '"', ' in ' + pad(el)].join('');
  return {
    rec,
    async staat() {
      A ??= await import('/src/control/actions.js');
      const bus = {};
      for (const a of A.list()) { let v; try { v = A.read(a.id); } catch (e) { v = 'FOUT'; } bus[a.id] = v === null || v === undefined ? null : typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v; }
      const dom = {};
      for (const el of document.querySelectorAll('[id]')) dom[el.id] = (el.getClientRects().length ? 'v ' : '- ') + el.className
        + (el.tagName === 'BUTTON' ? ' "' + el.textContent.trim().slice(0, 40) + '"' : '');
      const e = window.engine;
      const decks = Object.fromEntries(['A','B','C','D','E','F','G','H'].map((id) => { const d = e.deck(id);
        return [id, [Math.round(d.position * 100), d.playing, d.title, e.instrumentOp(id)?.soort ?? null, d.loop ? 1 : 0,
          d.grid ? JSON.stringify(d.grid.toJSON()) : '', d.cuePoint, d.hotcues.join(','), d.rate, d.keylock, d.transpositie].join('|')]; }));
      return { bus, dom, lagen: JSON.stringify(window.lagen?.actief?.() ?? null), decks, focus: e.focus,
        meld: rec.meld.length, fetch: rec.fetch.length, start: rec.start, open: rec.open.length, fouten: rec.fouten.length };
    },
    els: [],
    lijst() {
      const uit = [];
      this.els = [];
      for (const el of document.querySelectorAll(SEL)) {
        const z = zichtbaar(el);
        if (!z) continue;
        this.els.push(el);
        uit.push({ i: this.els.length - 1, naam: naam(el), bedekt: z.bedekt ?? null, buiten: !!z.buiten, titel: (el.title || '').slice(0, 160) });
      }
      return uit;
    },
    /**
     * Knop i klikbaar maken: in beeld scrollen, en ligt er een rij (lade) over,
     * die dichtdoen met zijn eigen knop bovenin. Geeft { x, y } of { bedekt }.
     */
    async klaar(i) {
      const el = this.els[i];
      if (!el?.isConnected) return { weg: true };
      for (let n = 0; n < 4; n++) {
        let z = zichtbaar(el);
        if (!z) return { weg: true };
        if (z.buiten) { el.scrollIntoView({ block: 'center', inline: 'center' }); await new Promise((r) => requestAnimationFrame(r)); z = zichtbaar(el); }
        if (z && z.x !== undefined && !z.bedekt && !z.buiten) return { x: z.x, y: z.y };
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 30));
        const rij = top?.closest?.('section[id], #lib-panel, #midi-panel, .overlay[id]');
        const knop = rij && (document.getElementById(rij.id + '-btn') || rij.querySelector('.lib-close, .mon-close, .re-sluit, .vid-sluit'));
        if (!knop) return { bedekt: (z?.bedekt ?? '?') + ' (open: ' + [...document.querySelectorAll('section[id]:not(.hidden), #lib-panel:not(.hidden), #midi-panel:not(.hidden)')].map((x) => x.id).join(',') + ')' };
        knop.click();
        await new Promise((r) => setTimeout(r, 60));
      }
      return { bedekt: 'blijft bedekt' };
    },
    staartVan(n, veld) { return rec[veld].slice(n); },
  };
})(); true`;

/** Vóór elke klik: niets speelt, de patronen staan stil, track 1 en 2 geladen, instrument op 3. */
const NORMAAL = `(async () => {
  const e = window.engine;
  if (window.opnemer?.bezig) { try { await window.opnemer.stop(); } catch (_) {} }
  for (const id of ['A','B','C','D','E','F','G','H']) { const d = e.deck(id); if (d.playing || d.wacht) d.pause(); if (d.remt) d.laatRemLos?.(); }
  window.patronen?.stopAlles?.({ meteen: true });
  const { renderDemoTrack } = await import('/src/analysis/demo-track.js');
  const { Beatgrid } = await import('/src/engine/beatgrid.js');
  window.__demo ??= renderDemoTrack(e.ctx, { bars: 32 });
  for (const id of ['A', 'B']) {
    const d = e.deck(id);
    if (!d.buffer || !/^demo/.test(d.title)) { if (e.instrumentOp(id)) e.zetInstrument(id, null); await d.laadGeheugen(window.__demo, 'demo ' + id); d.setGrid(new Beatgrid({ bpm: 124, firstBeat: 0 })); }
  }
  if (e.instrumentOp('C')?.soort !== 'poly') e.zetInstrument('C', 'poly');
  for (const id of ['A','B','C','D','E','F','G','H']) { const d = e.deck(id); if (d.playing || d.wacht) d.pause(); }
  return true;
})()`;

const verschil = (a, b, ruis) => {
  const uit = [];
  for (const k of Object.keys(b.bus)) if (a.bus[k] !== b.bus[k] && !ruis.has('bus:' + k)) uit.push(`${k}: ${a.bus[k]} → ${b.bus[k]}`);
  for (const k of Object.keys(b.dom)) if (a.dom[k] !== b.dom[k] && !ruis.has('dom:' + k)) uit.push(`#${k}: ${a.dom[k] ?? 'nieuw'} → ${b.dom[k]}`);
  for (const k of Object.keys(b.decks)) if (a.decks[k] !== b.decks[k] && !ruis.has('deck:' + k)) uit.push(`track ${k}: ${a.decks[k]} → ${b.decks[k]}`);
  for (const k of ['lagen', 'focus', 'meld', 'fetch', 'start', 'open']) if (a[k] !== b[k]) uit.push(`${k}: ${a[k]} → ${b[k]}`);
  return uit;
};
const ruisVan = (a, b) => {
  const r = new Set();
  for (const k of Object.keys(b.bus)) if (a.bus[k] !== b.bus[k]) r.add('bus:' + k);
  for (const k of Object.keys(b.dom)) if (a.dom[k] !== b.dom[k]) r.add('dom:' + k);
  for (const k of Object.keys(b.decks)) if (a.decks[k] !== b.decks[k]) r.add('deck:' + k);
  return r;
};
async function muis(type, x, y) {
  await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
}

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
    if (m.method === 'Runtime.exceptionThrown') meldingen.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') meldingen.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;' });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  await cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  for (let i = 0; i < 100; i++) { if (await evalueer('!!(window.engine && window.videoMixer && window.patronen)').catch(() => false)) break; await wacht(200); }
  await wacht(800);



  await evalueer(HELPER);
  await evalueer(NORMAAL);
  await wacht(500);
  await foto('knoppen-begin.png');
  const gezien = new Map();          // naam -> uitkomst
  const MAX = Number(process.env.KNOPPEN_MAX) || 1500;
  let ronde = 0;
  console.log('knoppen doorlopen…');
  for (; ronde < MAX; ronde++) {
    let lijst = await evalueer('window.__a?.lijst()');
    if (!lijst) {                    // de pagina is herladen (een knop deed location.reload)
      await wacht(1500);
      await evalueer(HELPER);
      await evalueer(NORMAAL);
      lijst = await evalueer('window.__a.lijst()');
    }
    // Eerst wat zonder meer te klikken is; dan wat eerst vrij moet (lade dicht, scrollen).
    const k = lijst.find((x) => !gezien.has(x.naam) && !x.bedekt && !x.buiten) || lijst.find((x) => !gezien.has(x.naam));
    if (!k) break;
    await evalueer(NORMAAL);
    await wacht(120);
    const plek = await evalueer(`window.__a.klaar(${k.i})`);
    if (plek.weg) continue;          // verdwenen (de lijst wordt opnieuw gemaakt)
    if (plek.bedekt) { gezien.set(k.naam, { naam: k.naam, titel: k.titel, uitkomst: `bedekt door ${plek.bedekt}`, effect: [] }); console.log(`  BEDEKT ${k.naam} (door ${plek.bedekt})`); continue; }
    k.x = plek.x; k.y = plek.y;
    const s0 = await evalueer('window.__a.staat()');
    await wacht(200);
    const s0b = await evalueer('window.__a.staat()');
    const ruis = ruisVan(s0, s0b);
    const fouten0 = meldingen.length, recF = s0b.fouten, recM = s0b.meld, recO = s0b.open, recFe = s0b.fetch;
    await muis('mouseMoved', k.x, k.y);
    await muis('mousePressed', k.x, k.y);
    await wacht(120);
    const sMid = await evalueer('window.__a?.staat()').catch(() => null);
    await muis('mouseReleased', k.x, k.y);
    await wacht(350);
    const s1 = await evalueer('window.__a?.staat()').catch(() => null);
    if (!s1) { gezien.set(k.naam, { naam: k.naam, titel: k.titel, uitkomst: 'herlaadt de pagina', effect: [] }); continue; }
    const effect = [...new Set([...(sMid ? verschil(s0b, sMid, ruis) : []), ...verschil(s0b, s1, ruis)])];
    const nieuweFouten = [...meldingen.slice(fouten0), ...(await evalueer(`window.__a.staartVan(${recF}, 'fouten')`))];
    const meld = await evalueer(`window.__a.staartVan(${recM}, 'meld')`);
    const open = await evalueer(`window.__a.staartVan(${recO}, 'open')`);
    const fetches = await evalueer(`window.__a.staartVan(${recFe}, 'fetch')`);
    // Alleen een melding (een uitleg waarom het nu niet kan) is ook een antwoord,
    // maar apart geteld: dat zijn de knoppen om na te lopen.
    const alleenMelding = effect.length > 0 && effect.every((x) => /^meld:/.test(x));
    const uitkomst = nieuweFouten.length ? 'FOUT' : !effect.length ? 'NIETS' : alleenMelding ? 'uitleg' : 'werkt';
    gezien.set(k.naam, { naam: k.naam, titel: k.titel, uitkomst, effect: effect.slice(0, 12), fouten: nieuweFouten.slice(0, 3), meld, open, fetches });
    if (uitkomst !== 'werkt') console.log(`  ${uitkomst.padEnd(6)} ${k.naam}${meld.length ? ` — melding: ${meld.join(' / ').slice(0, 160)}` : ''}${nieuweFouten.length ? ` — ${nieuweFouten[0]}` : ''}`);
    // Open dialogen/overlays dicht als ze de rest bedekken: Escape.
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  const alle = [...gezien.values()];
  writeFileSync(join(UIT, 'knoppen.json'), JSON.stringify(alle, null, 1));
  const tel = (u) => alle.filter((x) => x.uitkomst === u).length;
  console.log(`\n${alle.length} knoppen: ${tel('werkt')} werken, ${tel('uitleg')} zeggen waarom het nu niet kan, ${tel('NIETS')} doen niets, ${tel('FOUT')} met een fout, ${alle.filter((x) => /bedekt|buiten/.test(x.uitkomst)).length} niet te klikken (bedekt of buiten beeld), ${tel('herlaadt de pagina')} herladen; ${ronde} rondes`);
  console.log(`rapport: ${join(UIT, 'knoppen.json')}`);
  ok('alle knoppen doorlopen', ronde < MAX);
} catch (err) {
  console.error(err);
  uitkomst.push(['script', false]);
} finally {
  try { ws?.close(); } catch (_) {}
  browser.kill('SIGKILL');
  server.kill('SIGINT');
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const mis = uitkomst.filter(([, g]) => !g);
console.log(mis.length ? `\n${mis.length} FOUT(EN): ${mis.map(([n]) => n).join(', ')}` : `\nAlle ${uitkomst.length} checks groen.`);
process.exit(mis.length ? 1 : 0);
