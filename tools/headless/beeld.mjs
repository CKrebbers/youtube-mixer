// Het scherm van spoor beeld (docs/BEELD.md), headless en zonder pc: de knop
// "beeld" in de bovenbalk, de BEELD-rij, het lampje, de meldingen en de tegel
// in de Controlekamer. De relay is hier een nep-relay van een paar regels
// (node:http + de WebSocket-handdruk), dus de Stroommachine-repo is niet nodig;
// de echte keten staat in beeld-e2e.mjs.
//
// Wat er draait: een eigen VARVE-server op een eigen poort met een tijdelijke
// database en mappen (Clay's library blijft heel), één headless Chrome zonder
// requestMIDIAccess (veilig met de APC aangesloten, CLAUDE.md "ÉÉN
// VARVE-tabblad"), en de nep-relay op 127.0.0.1.
//
// Gemeten:
//   - opstarten zonder adres (een vers profiel): 0 uitzonderingen, 0
//     console.error, 0 fouten in het Log-domein, geen enkele WebSocket, geen
//     lampje, de rij dicht;
//   - de bovenbalk op 1440×790, 1440×900 en 1920×1080, met en zonder de knop
//     (display:none = de stand van vóór de knop): één regel, niet breder dan
//     het scherm, even hoog; het lampje maakt de knop niet breder;
//   - de rij: opent en sluit met de knop (onthouden), even hoog als KOPTELEFOON
//     en MASTER, alles erin heel te zien, en de pagina scrolt niet;
//   - de velden: latentie geklemd (777 → 500), cijfers typen in het getalveld
//     zijn geen sneltoetsen, een geweigerd adres = één melding per poging, het
//     veld rood en NIET bewaard, Enter = toepassen;
//   - de stand: zoekt (niemand op de poort), verbonden (de nep-relay), de
//     beeld-status (volgt de klok), na 3 s zonder beeld-status weer "wacht op
//     de Stroommachine"; manifest als eerste bericht; één melding "verbonden";
//   - relay weg: geen nieuwe meldingen, geen fouten van onze code;
//   - de tegel Beeld in de Controlekamer (een tweede tabblad, controle.html);
//   - uit = de WebSocket dicht, geen lampje; na herladen alles terug, en uit
//     maakt na herladen geen WebSocket;
//   - de knopjes "deze Mac · pc" (BEELD_ADRESSEN): een echte muisklik zet het
//     adres in veld, localStorage en koppeling, het knopje brandt (ook na
//     herladen). Met beeld UIT: er gaat niets naar 127.0.0.1:7702 of de pc.
//     Verbonden met de nep-relay: één klik wisselt NIET (een melding), een ander
//     knopje of een klik na 3 s ook niet, een tweede klik binnen 3 s wel (review 2,
//     punt 6). De adressen van Clay leidt de pagina dan om naar de lege poort:
//     ook dan gaat er niets naar 127.0.0.1:7702 of de pc.
// Een mislukte WebSocket-verbinding logt Chrome zelf (Log-domein, bron
// "network"): geen JavaScript kan dat onderdrukken. Die worden apart geteld.
//
// Gebruik:  node tools/headless/beeld.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8785), VARVE_KIJK_DEBUG (9385), VARVE_KIJK_RELAY
//           (8786, de nep-relay), VARVE_KIJK_LEEG (8787, waar niemand luistert).
//           Eigen standaarden: 8791–8799 en 9337–9347 gebruiken andere tools al.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = fileURLToPath(new URL('../..', import.meta.url));
const UIT = process.argv[2] || join(HIER, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8785;
const DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9385;
const RELAY = Number(process.env.VARVE_KIJK_RELAY) || 8786;
const LEEG = Number(process.env.VARVE_KIJK_LEEG) || 8787;
const RELAY_ADRES = `ws://127.0.0.1:${RELAY}/app`;
const LEEG_ADRES = `ws://127.0.0.1:${LEEG}/app`;
const tmp = mkdtempSync(join(tmpdir(), 'varve-beeld-'));

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const uitkomst = [];
const ok = (naam, cond, extra = '') => {
  uitkomst.push([naam, !!cond]);
  console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${!cond && extra !== '' ? ` (${typeof extra === 'string' ? extra : JSON.stringify(extra)})` : ''}`);
};
const info = (t) => console.log(`   ·  ${t}`);

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
const poortBezet = (poort) => new Promise((r) => {
  const s = createConnection({ host: '127.0.0.1', port: poort });
  s.once('connect', () => { s.destroy(); r(true); });
  s.once('error', () => r(false));
});

// ---- de nep-relay: handdruk, berichten tellen, beeld-status sturen ----------
const relay = { sockets: new Set(), berichten: [], verbindingen: 0 };
function stuurTekst(sock, tekst) {
  const p = Buffer.from(tekst);
  const kop = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  sock.write(Buffer.concat([kop, p]));
}
/** Frames van de browser (altijd gemaskeerd) uit elkaar halen; tekst bewaren, close beantwoorden. */
function leesFrames(sock, st, stuk) {
  st.buf = Buffer.concat([st.buf, stuk]);
  for (;;) {
    const b = st.buf;
    if (b.length < 2) return;
    let len = b[1] & 127, pos = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); pos = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); pos = 10; }
    const masker = b[1] & 128 ? 4 : 0;
    if (b.length < pos + masker + len) return;
    const m = b.subarray(pos, pos + masker), data = Buffer.from(b.subarray(pos + masker, pos + masker + len));
    if (masker) for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3];
    const op = b[0] & 15;
    if (op === 1) relay.berichten.push(data.toString('utf8'));
    if (op === 8) { try { sock.end(Buffer.from([0x88, 0])); } catch (_) {} }
    st.buf = b.subarray(pos + masker + len);
  }
}
const relayServer = createServer((req, res) => { res.writeHead(426); res.end(); });
relayServer.on('upgrade', (req, sock) => {
  const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  relay.sockets.add(sock);
  relay.verbindingen++;
  const st = { buf: Buffer.alloc(0) };
  sock.on('data', (d) => leesFrames(sock, st, d));
  sock.on('close', () => relay.sockets.delete(sock));
  sock.on('error', () => {});
});
const beeldStatus = (extra = {}) => JSON.stringify({ type: 'beeld-status', regime: 'drift', scene: 'golven', fps: 59.6, volgt: true, bpm: 124, ...extra });
const stuurAlle = (t) => { for (const s of relay.sockets) stuurTekst(s, t); };

// ---- een tabblad via het DevTools-protocol ----------------------------------
class Tab {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.volg = 0; this.wachtend = new Map(); this.js = []; this.log = []; }
  async verbind() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((r) => this.ws.addEventListener('open', r));
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.wachtend.has(m.id)) { const w = this.wachtend.get(m.id); this.wachtend.delete(m.id); m.error ? w.fout(new Error(m.error.message)) : w.ok(m.result); }
      if (m.method === 'Runtime.exceptionThrown') this.js.push(`uitzondering: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.js.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        const e = m.params.entry;
        this.log.push(`${e.source}: ${e.text}${e.url && !e.text.includes(e.url) ? ` (${e.url.replace(/^https?:\/\/[^/]+/, '')})` : ''}`);
      }
    });
    await this.cdp('Page.enable');
    await this.cdp('Runtime.enable');
    await this.cdp('Log.enable');
  }
  /** Eén opdracht; geen antwoord binnen 20 s = een fout (nooit eindeloos wachten). */
  cdp(method, params = {}) {
    const id = ++this.volg;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok_, fout) => {
      const t = setTimeout(() => { this.wachtend.delete(id); fout(new Error(`${method}: geen antwoord binnen 20 s`)); }, 20000);
      this.wachtend.set(id, { ok: (v) => { clearTimeout(t); ok_(v); }, fout: (e) => { clearTimeout(t); fout(e); } });
    });
  }
  async evalueer(expr) {
    const r = await this.cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async foto(naam) {
    const { data } = await this.cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
  }
  /** Headless tekent Chromium pas als iemand erom vraagt: een kleine schermafdruk dwingt een beeld (en de renderloop) af. */
  beeld() { return this.cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 4, height: 4, scale: 1 } }).catch(() => null); }
  async tot(expr, ms = 10000, stap = 200) {
    const eind = Date.now() + ms;
    let v;
    do { await this.beeld(); v = await this.evalueer(expr).catch(() => null); if (v) return v; await wacht(stap); } while (Date.now() < eind);
    return v;
  }
  async toets(key, code, tekst) {
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: tekst, unmodifiedText: tekst,
      windowsVirtualKeyCode: key === 'Enter' ? 13 : key.charCodeAt(0) });
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key === 'Enter' ? 13 : key.charCodeAt(0) });
  }
}

/** In de pagina: meten en bedienen. */
const HULP = `window.__b = {
  rij: () => document.getElementById('beeld'),
  knop: () => document.getElementById('beeld-btn'),
  stand: () => document.querySelector('#beeld .bd-stand').textContent,
  lamp: () => document.getElementById('beeld-btn').dataset.lamp ?? null,
  meldingen: () => [...document.querySelectorAll('#meldingen .melding')].map((m) => m.className.replace('melding', '').trim() + ': ' + m.firstChild.textContent),
  balk() {
    const bar = document.querySelector('.topbar'), r = document.querySelector('.topbar-right');
    const kids = [...r.children].filter((el) => el.getClientRects().length);
    const tops = kids.map((el) => el.getBoundingClientRect().top);
    const se = document.scrollingElement;
    return { h: bar.offsetHeight, sw: bar.scrollWidth, cw: bar.clientWidth, rsw: r.scrollWidth, rcw: r.clientWidth,
      rechts: Math.round(Math.max(...kids.map((el) => el.getBoundingClientRect().right))), breed: innerWidth,
      eenRegel: Math.max(...tops) - Math.min(...tops) < 10, knoppen: kids.length,
      knopB: Math.round(document.getElementById('beeld-btn').getBoundingClientRect().width * 10) / 10,
      paginaOpzij: se.scrollWidth > innerWidth + 1 };
  },
  /** Elk element heel te zien en niet bedekt (midden en vlak binnen de randen). */
  heel(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return 'geen maat';
    if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return 'buiten het scherm';
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const q = p.getBoundingClientRect();
      if (r.left < q.left - 0.5 || r.right > q.right + 0.5 || r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) return 'afgesneden door ' + (p.id || p.className);
    }
    const i = Math.min(3, r.width / 4, r.height / 4), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    for (const [x, y] of [[cx, cy], [r.left + i, cy], [r.right - i, cy]]) {
      const top = document.elementFromPoint(x, y);
      if (!top || !(top === el || el.contains(top) || top.contains(el))) return 'bedekt door ' + (top ? top.tagName + '.' + top.className : 'niets');
    }
    return null;
  },
  zetVeld(sel, waarde) { const v = document.querySelector(sel); v.focus(); v.value = waarde; v.dispatchEvent(new Event('change', { bubbles: true })); v.blur(); return v.value; },
}; true`;

const opslag = (k) => `localStorage.getItem(${JSON.stringify(k)})`;
/**
 * Elke WebSocket die de pagina maakt, tellen (`__ws`: het adres dat VARVE vroeg,
 * `__wsEcht`: waar hij echt heen ging). De twee adressen van Clay (BEELD_ADRESSEN:
 * de relay op deze Mac en die op de pc) gaan naar de lege poort: een test die met
 * beeld aan wisselt, raakt Clay's relay of de pc nooit.
 */
const OMLEIDEN = { 'ws://127.0.0.1:7702/app': LEEG_ADRES, 'ws://clayk:7702/app': LEEG_ADRES };
const WS_TEL = `(() => { const W = window.WebSocket, om = ${JSON.stringify(OMLEIDEN)}; window.__ws = []; window.__wsEcht = [];
    window.WebSocket = class extends W { constructor(u, ...r) { super(om[String(u)] ?? u, ...r); window.__ws.push(String(u)); window.__wsEcht.push(this.url); } }; })();`;
const processen = [];
let tab = null, ktab = null;
try {
  for (const p of [POORT, DEBUG, RELAY, LEEG]) if (await poortBezet(p)) throw new Error(`poort ${p} is al bezet (zie de omgevingsvariabelen bovenin)`);
  await new Promise((r) => relayServer.listen(RELAY, '127.0.0.1', r));
  processen.push(spawn(process.execPath, [join(HIER, 'server/index.js')], {
    env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_MEDIA: join(tmp, 'media'),
      VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'),
      VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit' },
    stdio: 'ignore',
  }));
  const chrome = zoekChrome();
  processen.push(spawn(chrome.pad, [
    ...(chrome.shell ? [] : ['--headless=new']),
    `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,790',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' }));

  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  tab = new Tab(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await tab.verbind();
  // Veilig met de APC aangesloten: geen MIDI. En elke WebSocket die de pagina maakt, tellen.
  await tab.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;
    ${WS_TEL}` });
  await tab.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${POORT}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- 1. opstarten zonder adres -------------------------------------------
  console.log('opstarten zonder adres (vers profiel)');
  await tab.cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  await tab.tot('!!(window.engine && window.beeld && window.meld)', 30000);
  await tab.evalueer(HULP);
  for (let i = 0; i < 12; i++) { await tab.beeld(); await wacht(250); }   // drie seconden renderloop
  const s0 = await tab.evalueer('window.beeld.status()');
  ok('de koppeling staat uit, zonder adres, en loopt niet', !s0.aan && !s0.adres && !s0.loopt && !s0.verbonden, s0);
  ok('geen enkele WebSocket gemaakt', (await tab.evalueer('window.__ws.length')) === 0, await tab.evalueer('window.__ws'));
  ok('de rij is dicht, de knop heeft geen lampje en zijn gewone titel', await tab.evalueer(
    "__b.rij().classList.contains('hidden') && __b.lamp() === null && !__b.knop().title.includes('nu:')"));
  ok('de statusregel zegt "uit", de aan-knop "uit"', await tab.evalueer("__b.stand() === 'uit' && document.querySelector('#beeld .bd-aan').textContent === 'uit'"));
  ok('geen melding over beeld', !(await tab.evalueer('__b.meldingen()')).some((m) => /beeld/.test(m)), await tab.evalueer('__b.meldingen()'));
  ok(`0 uitzonderingen en 0 console.error (${tab.js.length})`, tab.js.length === 0, tab.js.slice(0, 3).join(' | '));
  // Wat Chrome zelf logt (netwerk): een 404 van een bestand dat (in een vers profiel, met een lege
  // database) nog niet bestaat hoort niet bij beeld; een WebSocket wel, en die mag er niet zijn.
  ok(`geen netwerkfout over een WebSocket in het Log-domein (${tab.log.length} regels: ${tab.log.join(' | ') || 'geen'})`,
    !tab.log.some((r) => /websocket/i.test(r)));
  ok('bus-actions van de APC-pagina bestaan (beeld.macro.tint, beeld.regie.flits)', await tab.evalueer(
    "import('/src/control/actions.js').then((a) => a.list().some((x) => x.id === 'beeld.macro.tint') && a.list().some((x) => x.id === 'beeld.regie.flits'))"));

  // ---- 2. de bovenbalk -------------------------------------------------------
  console.log('\nde bovenbalk, met en zonder de knop "beeld"');
  for (const [B, H] of [[1440, 790], [1440, 900], [1920, 1080]]) {
    await tab.cdp('Emulation.setDeviceMetricsOverride', { width: B, height: H, deviceScaleFactor: 1, mobile: false });
    await tab.beeld(); await wacht(100);
    const zonder = await tab.evalueer("(() => { __b.knop().style.display = 'none'; const m = __b.balk(); __b.knop().style.display = ''; return m; })()");
    const met = await tab.evalueer('__b.balk()');
    const lamp = await tab.evalueer("(() => { __b.knop().dataset.lamp = 'volgt'; const m = __b.balk(); delete __b.knop().dataset.lamp; return m; })()");
    info(`${B}×${H}: zonder knop ${zonder.knoppen} items, balk ${zonder.h} px hoog, rechts ${zonder.rechts}/${B}; met knop ${met.knoppen} items, ${met.h} px, rechts ${met.rechts}/${B}, knop ${met.knopB} px`);
    ok(`${B}×${H}: met de knop één regel, even hoog als zonder (${zonder.h} → ${met.h} px)`, met.eenRegel && met.h === zonder.h, { zonder, met });
    ok(`${B}×${H}: de balk loopt niet over (scrollWidth ${met.sw} ≤ clientWidth ${met.cw}, rechts ${met.rechts} ≤ ${B})`,
      met.sw <= met.cw && met.rsw <= met.rcw && met.rechts <= B && !met.paginaOpzij, met);
    ok(`${B}×${H}: het lampje maakt de knop niet breder (${met.knopB} → ${lamp.knopB} px) en de balk niet hoger`, lamp.knopB === met.knopB && lamp.h === met.h, { met, lamp });
  }
  await tab.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  await tab.beeld(); await wacht(100);
  await tab.foto('beeld-balk-1440x790.png');

  // ---- 3. de rij openen en sluiten -----------------------------------------
  console.log('\nde rij');
  const hoogte = async (id) => tab.evalueer(`(() => { const k = document.getElementById('${id}-btn'); k.click(); const h = document.getElementById('${id}').getBoundingClientRect().height; k.click(); return Math.round(h); })()`);
  const hKop = await hoogte('koptelefoon'), hMaster = await hoogte('master');
  await tab.evalueer('__b.knop().click()');
  await tab.beeld(); await wacht(150); await tab.beeld();
  const open = await tab.evalueer(`({ open: !__b.rij().classList.contains('hidden'), bewaard: ${opslag('varve.beeld.open')}, h: Math.round(__b.rij().getBoundingClientRect().height),
    kleur: __b.knop().style.color, mis: [...__b.rij().querySelectorAll('button, input, .bd-stand')].map((el) => [el.className, __b.heel(el)]).filter(([, m]) => m),
    scrolt: document.scrollingElement.scrollHeight > innerHeight + 1 || document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight + 1 })`);
  ok('de knop opent de rij (onthouden: varve.beeld.open = 1, de knop licht op)', open.open && open.bewaard === '1' && open.kleur === 'var(--text)', open);
  ok(`even hoog als KOPTELEFOON en MASTER (${open.h} / ${hKop} / ${hMaster} px)`, open.h === hKop && open.h === hMaster, { beeld: open.h, hKop, hMaster });
  ok('alles in de rij heel te zien (aan, adres, latentie, stand)', open.mis.length === 0, open.mis);
  ok('op 1440×790 scrollen pagina en main niet met de rij open', !open.scrolt);
  await tab.foto('beeld-rij-uit-1440x790.png');

  // ---- 4. de velden ----------------------------------------------------------
  console.log('\nde velden');
  const lat = await tab.evalueer(`[__b.zetVeld('#beeld .bd-latentie', '777'), ${opslag('varve.beeld.latentie')}, window.beeld.status().latentie]`);
  ok(`latentie 777 → geklemd op 500 (veld, localStorage, koppeling: ${lat.join(', ')})`, lat[0] === '500' && lat[1] === '500' && lat[2] === 500, lat);
  // Typen in het getalveld: cijfers zijn anders loops (Digit1 = loop 1 op de linkerhand).
  await tab.evalueer("(() => { const v = document.querySelector('#beeld .bd-latentie'); v.focus(); v.select(); return true; })()");
  for (const c of ['8', '0']) await tab.toets(c, `Digit${c}`, c);
  await tab.toets('Enter', 'Enter', '\r');
  const lat2 = await tab.evalueer(`[document.querySelector('#beeld .bd-latentie').value, ${opslag('varve.beeld.latentie')}, document.activeElement === document.querySelector('#beeld .bd-latentie')]`);
  ok(`"80" typen + Enter: de cijfers komen in het veld (geen sneltoetsen), toegepast, veld verlaten (${lat2.slice(0, 2).join(', ')})`,
    lat2[0] === '80' && lat2[1] === '80' && lat2[2] === false, lat2);

  const m0 = (await tab.evalueer('__b.meldingen()')).length;
  // Typen zoals een mens (insertText): een waarde die een script zet, geeft bij het verlaten geen 'change'.
  await tab.evalueer("(() => { const v = document.querySelector('#beeld .bd-adres'); v.focus(); v.select(); return true; })()");
  await tab.cdp('Input.insertText', { text: 'http://192.168.1.20:7702' });
  await tab.toets('Enter', 'Enter', '\r');
  await tab.beeld(); await wacht(100); await tab.beeld();
  const weg = await tab.evalueer(`({ meld: __b.meldingen(), rood: document.querySelector('#beeld .bd-adres').classList.contains('fout'), bewaard: ${opslag('varve.beeld.adres')}, stand: __b.stand(), loopt: window.beeld.loopt })`);
  const wegMeld = weg.meld.filter((m) => m.startsWith('fout: beeld: adres geweigerd'));
  ok(`http-adres + Enter: één melding "${wegMeld[0] ?? '—'}"`, wegMeld.length === 1 && weg.meld.length === m0 + 1
    && wegMeld[0] === 'fout: beeld: adres geweigerd — alleen ws:// of wss://', weg.meld);
  ok('… het veld rood, niet bewaard, de regel zegt waarom, de zender loopt niet', weg.rood && weg.bewaard === null && weg.stand === 'adres geweigerd: alleen ws:// of wss://' && !weg.loopt, weg);
  await tab.evalueer("document.querySelector('#beeld .bd-adres').focus(), true");
  await tab.toets('Enter', 'Enter', '\r');
  ok('nog eens Enter zonder iets te veranderen: geen tweede melding', (await tab.evalueer('__b.meldingen()')).filter((m) => m.includes('adres geweigerd')).length === 1);
  await tab.evalueer("__b.zetVeld('#beeld .bd-adres', 'ws://wie:geheim@192.168.1.20:7702/app')");
  ok('een tweede (andere) poging: een tweede melding', (await tab.evalueer('__b.meldingen()')).filter((m) => m.includes('adres geweigerd')).length === 2);
  await tab.evalueer("document.querySelectorAll('#meldingen .melding-x').forEach((x) => x.click()), true");

  // ---- 5. de stand -----------------------------------------------------------
  console.log('\nde stand: zoekt, verbonden, beeld-status');
  await tab.evalueer("document.querySelector('#beeld .bd-aan').click(), true");
  await tab.beeld();
  ok(`aan met een geweigerd adres: rood lampje, "${await tab.evalueer('__b.stand()')}"`, (await tab.tot("__b.lamp() === 'fout'", 2000)) === true);
  const logVoor = tab.log.length;
  await tab.evalueer(`__b.zetVeld('#beeld .bd-adres', '  ${LEEG_ADRES}  ')`);
  ok(`een geldig adres zonder relay: "zoekt de relay op ${LEEG_ADRES}", oranje lampje`, (await tab.tot(`__b.stand() === 'zoekt de relay op ${LEEG_ADRES}' && __b.lamp() === 'zoekt'`, 3000)) === true,
    await tab.evalueer('[__b.stand(), __b.lamp()]'));
  const leeg = await tab.evalueer(`({ veld: document.querySelector('#beeld .bd-adres').value, rood: document.querySelector('#beeld .bd-adres').classList.contains('fout'), bewaard: ${opslag('varve.beeld.adres')}, aan: ${opslag('varve.beeld.aan')}, ws: window.__ws.length, titel: __b.knop().title })`);
  ok('… getrimd in het veld en bewaard, niet meer rood, aan bewaard, een WebSocket, de knoptitel zegt de stand', leeg.veld === LEEG_ADRES && leeg.bewaard === LEEG_ADRES
    && !leeg.rood && leeg.aan === '1' && leeg.ws >= 1 && leeg.titel.endsWith(`— nu: zoekt de relay op ${LEEG_ADRES}`), leeg);
  await tab.evalueer('__b.rij().scrollIntoView(), true');
  await tab.foto('beeld-rij-zoekt-1440x790.png');

  const verbVoor = relay.verbindingen;
  await tab.evalueer(`__b.zetVeld('#beeld .bd-adres', '${RELAY_ADRES}')`);
  ok('de nep-relay: "verbonden, wacht op de Stroommachine", cyaan ring', (await tab.tot("__b.stand() === 'verbonden, wacht op de Stroommachine' && __b.lamp() === 'verbonden'", 8000)) === true,
    await tab.evalueer('[__b.stand(), __b.lamp()]'));
  await wacht(400);
  let manifest = null;
  try { manifest = JSON.parse(relay.berichten[0]); } catch (_) {}
  ok(`één verbinding met de relay, het manifest als eerste bericht (app ${manifest?.app})`, relay.verbindingen === verbVoor + 1 && manifest?.app === 'varvedj', relay.berichten.slice(0, 2));
  const verbMeld = (await tab.evalueer('__b.meldingen()')).filter((m) => m.includes('verbonden met de relay'));
  ok(`één melding "${verbMeld[0] ?? '—'}"`, verbMeld.length === 1 && verbMeld[0] === `info: beeld: verbonden met de relay (${RELAY_ADRES})`, verbMeld);

  stuurAlle(beeldStatus());
  ok('beeld-status van de Stroommachine: "verbonden · drift · golven · volgt de klok", cyaan lampje',
    (await tab.tot("__b.stand() === 'verbonden · drift · golven · volgt de klok' && __b.lamp() === 'volgt'", 3000)) === true, await tab.evalueer('[__b.stand(), __b.lamp()]'));
  const titelStand = await tab.evalueer("document.querySelector('#beeld .bd-stand').title");
  ok(`… de regel heeft fps en tempo in de title ("${titelStand}")`, titelStand === 'de Stroommachine: 60 fps, 124 bpm, volgt de klok van VARVE');
  await tab.foto('beeld-rij-volgt-1440x790.png');
  stuurAlle(beeldStatus({ volgt: false, bpm: 0, scene: 'stilte' }));
  ok('volgt niet: "… · eigen klok", cyaan ring', (await tab.tot("__b.stand() === 'verbonden · drift · stilte · eigen klok' && __b.lamp() === 'verbonden'", 3000)) === true,
    await tab.evalueer('[__b.stand(), __b.lamp()]'));
  // Controlekamer: een tweede tabblad, alleen lezen (controle.html opent geen MIDI).
  const nieuw = await fetch(`http://127.0.0.1:${DEBUG}/json/new?${encodeURIComponent(`http://localhost:${POORT}/controle.html`)}`, { method: 'PUT' }).then((r) => r.json());
  ktab = new Tab(nieuw.webSocketDebuggerUrl);
  await ktab.verbind();
  await ktab.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  stuurAlle(beeldStatus({ volgt: false, bpm: 0, scene: 'stilte' }));
  const tegelExpr = "(() => { const t = [...document.querySelectorAll('.tegel')].find((x) => x.querySelector('.tegel-naam').textContent.trim() === 'Beeld'); return t ? [t.dataset.licht, t.querySelector('.tegel-waarde').textContent, t.querySelector('.tegel-sub').textContent] : null; })()";
  const tegel = await ktab.tot(`(t => t && t[0] === 'ok' && t)(${tegelExpr})`, 8000);
  ok(`Controlekamer: tegel Beeld ${JSON.stringify(tegel)}`, Array.isArray(tegel) && tegel[1] === 'eigen klok' && tegel[2] === 'drift · stilte', tegel ?? await ktab.evalueer(tegelExpr).catch(() => null));
  const volgorde = await ktab.evalueer("[...document.querySelectorAll('.tegel-naam')].map((x) => x.textContent.trim())");
  ok(`… na de tegel APC40 (${volgorde.join(', ')})`, volgorde.indexOf('Beeld') === volgorde.indexOf('APC40') + 1);
  await ktab.foto('beeld-controlekamer.png');
  ok(`Controlekamer: 0 uitzonderingen en 0 console.error (${ktab.js.length})`, ktab.js.length === 0, ktab.js.slice(0, 3).join(' | '));
  await ktab.cdp('Page.close').catch(() => null);
  try { ktab.ws.close(); } catch (_) {}
  ktab = null;
  await tab.cdp('Page.bringToFront').catch(() => null);

  ok('na 3 s zonder beeld-status: weer "verbonden, wacht op de Stroommachine"', (await tab.tot("__b.stand() === 'verbonden, wacht op de Stroommachine'", 6000)) === true, await tab.evalueer('__b.stand()'));

  // ---- 5b. de knopjes terwijl beeld verbonden is (review 2, punt 6) ----------
  // Midden in een set wisselt één misklik niet: eerst een tweede klik op hetzelfde
  // knopje binnen 3 s. Een echte muisklik (CDP Input). Wisselen naar "deze Mac"
  // gaat door de omleiding (WS_TEL) naar de lege poort, niet naar 127.0.0.1:7702.
  console.log('\nde knopjes terwijl beeld verbonden is: tweede klik binnen 3 s');
  const klik = async (sel) => {
    const r = await tab.evalueer(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await tab.cdp('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await tab.beeld(); await wacht(150); await tab.beeld();
  };
  const MAC = 'ws://127.0.0.1:7702/app';
  // Meldingen met dezelfde tekst stapelen niet (meldingen.js): vóór elke klik de rij leeg.
  const leegMeld = "(document.querySelectorAll('#meldingen .melding').forEach((m) => m.remove()), true)";
  const WISSEL = `({ adres: window.beeld.status().adres, verbonden: window.beeld.status().verbonden, veld: document.querySelector('#beeld .bd-adres').value,
    bewaard: ${opslag('varve.beeld.adres')}, ws: window.__ws.length, vraag: __b.meldingen().filter((m) => m.includes('nog eens op')),
    brandt: [...document.querySelectorAll('#beeld .bd-kies.on')].map((b) => b.dataset.sleutel), laatste: window.__ws.at(-1), echt: window.__wsEcht.at(-1), alleEcht: window.__wsEcht })`;
  const blijft = (w, w0) => w.adres === RELAY_ADRES && w.veld === RELAY_ADRES && w.bewaard === RELAY_ADRES && w.verbonden && w.ws === w0.ws && !w.brandt.length;
  const w0 = await tab.evalueer(WISSEL);
  await tab.evalueer(leegMeld);
  await klik('#beeld .bd-kies[data-sleutel="pc"]');
  const w1 = await tab.evalueer(WISSEL);
  ok('verbonden met de nep-relay, één klik op "pc": niets verandert (adres, veld, opslag, verbinding, geen nieuwe WebSocket), wel één melding',
    blijft(w1, w0) && w1.vraag.length === 1 && w1.vraag[0] === 'info: beeld: klik binnen 3 s nog eens op "pc" om te wisselen naar ws://clayk:7702/app — de Stroommachine die nu meekijkt, verliest dan de klok van VARVE', w1);
  await tab.evalueer(leegMeld);
  await klik('#beeld .bd-kies[data-sleutel="lokaal"]');
  const w2 = await tab.evalueer(WISSEL);
  ok('meteen daarna "deze Mac": een ander knopje telt niet als tweede klik, weer alleen een melding', blijft(w2, w0) && w2.vraag.length === 1 && /nog eens op "deze Mac"/.test(w2.vraag[0]), w2);
  await wacht(3300);
  await tab.evalueer(leegMeld);
  await klik('#beeld .bd-kies[data-sleutel="lokaal"]');
  const w3 = await tab.evalueer(WISSEL);
  ok('na 3,3 s nog eens "deze Mac": te laat, weer alleen een melding', blijft(w3, w0) && w3.vraag.length === 1 && /nog eens op "deze Mac"/.test(w3.vraag[0]), w3);
  await klik('#beeld .bd-kies[data-sleutel="lokaal"]');
  const w4 = await tab.evalueer(WISSEL);
  ok('binnen 3 s nog eens "deze Mac": wisselt (veld, opslag, koppeling), "deze Mac" brandt, een nieuwe verbinding naar dat adres',
    w4.adres === MAC && w4.veld === MAC && w4.bewaard === MAC && w4.brandt.join() === 'lokaal' && w4.ws === w0.ws + 1 && w4.laatste === MAC, w4);
  ok(`… omgeleid naar de lege poort (${w4.echt}): geen enkele WebSocket naar :7702`, w4.echt === LEEG_ADRES && w4.alleEcht.every((u) => !u.includes(':7702')), w4.alleEcht);
  await tab.evalueer(leegMeld);
  await tab.evalueer(`__b.zetVeld('#beeld .bd-adres', '${RELAY_ADRES}')`);
  ok('terug met typen + Enter: meteen (geen tweede klik), weer verbonden met de nep-relay',
    (await tab.tot("__b.stand() === 'verbonden, wacht op de Stroommachine'", 8000)) === true && !(await tab.evalueer('__b.meldingen()')).some((m) => m.includes('nog eens op')),
    await tab.evalueer('[__b.stand(), __b.meldingen()]'));

  // ---- 6. relay weg ----------------------------------------------------------
  console.log('\nrelay weg');
  const mVoor = await tab.evalueer('__b.meldingen()');
  const jsVoor = tab.js.length;
  relayServer.close();
  for (const s of relay.sockets) s.destroy();
  ok('de relay valt weg: "zoekt de relay op …", oranje lampje', (await tab.tot(`__b.stand() === 'zoekt de relay op ${RELAY_ADRES}' && __b.lamp() === 'zoekt'`, 4000)) === true,
    await tab.evalueer('[__b.stand(), __b.lamp()]'));
  for (let i = 0; i < 20; i++) { await tab.beeld(); await wacht(300); }   // 6 s: een paar keer opnieuw proberen (1, 2, 4 s)
  const mNa = await tab.evalueer('__b.meldingen()');
  const mNieuw = mNa.filter((m) => !mVoor.includes(m));
  ok(`6 s zonder relay: geen nieuwe melding (${mNieuw.length})`, mNieuw.length === 0, mNieuw);
  ok(`… en geen fouten van onze code (${tab.js.length - jsVoor})`, tab.js.length === jsVoor, tab.js.slice(jsVoor, jsVoor + 3).join(' | '));
  info(`wat Chrome zelf logde over mislukte verbindingen (Log-domein, sinds het eerste geldige adres): ${tab.log.length - logVoor}`
    + `${tab.log.length > logVoor ? `, bv. "${tab.log[logVoor]}"` : ''}`);

  // ---- 7. uit, en herladen ---------------------------------------------------
  console.log('\nuit en herladen');
  await tab.evalueer("document.querySelector('#beeld .bd-aan').click(), true");
  const uit = await tab.tot("(() => { const s = window.beeld.status(); return !s.aan && !s.loopt && __b.lamp() === null && __b.stand() === 'uit' && __b.knop().title.indexOf('nu:') < 0 && s; })()", 2000);
  ok('uit: de zender stopt, geen lampje, de regel "uit", de knop zijn gewone titel', !!uit, await tab.evalueer('[window.beeld.status(), __b.lamp(), __b.stand()]'));
  await tab.cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  await tab.tot('!!(window.engine && window.beeld && window.meld)', 30000);
  await tab.evalueer(HULP);
  for (let i = 0; i < 6; i++) { await tab.beeld(); await wacht(250); }
  const terug = await tab.evalueer(`({ adres: document.querySelector('#beeld .bd-adres').value, lat: document.querySelector('#beeld .bd-latentie').value,
    open: !__b.rij().classList.contains('hidden'), aan: window.beeld.status().aan, ws: window.__ws.length, lamp: __b.lamp(), stand: __b.stand() })`);
  ok(`na herladen: adres, latentie en de open rij terug, uit blijft uit (${JSON.stringify(terug)})`,
    terug.adres === RELAY_ADRES && terug.lat === '80' && terug.open && !terug.aan && terug.lamp === null && terug.stand === 'uit', terug);
  ok('… en uit maakt geen WebSocket', terug.ws === 0, terug);

  // ---- 7b. de knopjes "deze Mac · pc" (spoor beeld-een-machine) ----------------
  // Beeld staat UIT: een adres kiezen maakt dan geen verbinding, dus er gaat niets
  // naar 127.0.0.1:7702 (Clay's poort) of naar de pc. Een echte muisklik (CDP Input).
  console.log('\nde knopjes deze Mac · pc (beeld uit)');
  const KNOPJES = `({ knoppen: [...document.querySelectorAll('#beeld .bd-keuze .bd-kies')].map((b) => [b.dataset.sleutel, b.textContent, b.classList.contains('on'), __b.heel(b)]),
    veld: document.querySelector('#beeld .bd-adres').value, rood: document.querySelector('#beeld .bd-adres').classList.contains('fout'),
    bewaard: ${opslag('varve.beeld.adres')}, adres: window.beeld.instellingen.adres, aan: window.beeld.status().aan, ws: window.__ws.length })`;
  const k0 = await tab.evalueer(KNOPJES);
  ok('twee knopjes "deze Mac" en "pc" naast het adresveld, heel te zien; geen van beide brandt (het adres is de nep-relay)',
    JSON.stringify(k0.knoppen) === JSON.stringify([['lokaal', 'deze Mac', false, null], ['pc', 'pc', false, null]]), k0);
  const mMac0 = (await tab.evalueer('__b.meldingen()')).length;
  await klik('#beeld .bd-kies[data-sleutel="lokaal"]');
  const kMac = await tab.evalueer(KNOPJES);
  ok('een klik op "deze Mac": ws://127.0.0.1:7702/app in veld, localStorage en koppeling, niet rood, het knopje brandt; beeld blijft uit, 0 WebSockets, geen melding',
    kMac.veld === 'ws://127.0.0.1:7702/app' && kMac.bewaard === kMac.veld && kMac.adres === kMac.veld && !kMac.rood
    && kMac.knoppen[0][2] && !kMac.knoppen[1][2] && !kMac.aan && kMac.ws === 0 && (await tab.evalueer('__b.meldingen()')).length === mMac0, kMac);
  await klik('#beeld .bd-kies[data-sleutel="pc"]');
  const kPc = await tab.evalueer(KNOPJES);
  ok('een klik op "pc": ws://clayk:7702/app, idem; "deze Mac" brandt niet meer',
    kPc.veld === 'ws://clayk:7702/app' && kPc.bewaard === kPc.veld && kPc.adres === kPc.veld && !kPc.rood
    && !kPc.knoppen[0][2] && kPc.knoppen[1][2] && !kPc.aan && kPc.ws === 0, kPc);
  await tab.foto('beeld-rij-knopjes-1440x790.png');
  await tab.cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  await tab.tot('!!(window.engine && window.beeld && window.meld)', 30000);
  await tab.evalueer(HULP);
  for (let i = 0; i < 4; i++) { await tab.beeld(); await wacht(250); }
  const kTerug = await tab.evalueer(KNOPJES);
  ok('na herladen brandt "pc" nog (het adres komt uit localStorage), uit blijft uit, 0 WebSockets',
    kTerug.veld === 'ws://clayk:7702/app' && kTerug.knoppen[1][2] && !kTerug.knoppen[0][2] && !kTerug.aan && kTerug.ws === 0, kTerug);

  // ---- 8. opstarten met een onbereikbaar adres (de pc staat uit) -------------
  // Zoals Clay het op een avond zonder pc tegenkomt: beeld staat nog aan, met
  // het adres van de pc. 40 s lang: hooguit één melding, geen fouten van onze
  // code, en de zender probeert het rustig opnieuw (1, 2, 4, 8, 10 s …).
  console.log('\nopstarten met een onbereikbaar adres');
  await tab.evalueer(`localStorage.setItem('varve.beeld.aan', '1'); localStorage.setItem('varve.beeld.adres', ${JSON.stringify(LEEG_ADRES)}); true`);
  const jsVoor8 = tab.js.length, logVoor8 = tab.log.length;
  await tab.cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  await tab.tot('!!(window.engine && window.beeld && window.meld)', 30000);
  await tab.evalueer(HULP);
  const t8 = Date.now();
  let meld10 = null;   // een info-melding gaat na 5 s weg: kijk na ~10 s (de melding komt na 8 s)
  while (Date.now() - t8 < 40000) {
    await tab.beeld(); await wacht(500);
    if (!meld10 && Date.now() - t8 > 10000) meld10 = (await tab.evalueer('__b.meldingen()')).filter((m) => /beeld/.test(m));
  }
  const st8 = await tab.evalueer(`({ stand: __b.stand(), lamp: __b.lamp(), ws: window.__ws.length, meld: __b.meldingen(), verbonden: window.beeld.status().verbonden })`);
  ok(`start met een onbereikbaar adres: de mixer werkt, de regel zegt "zoekt de relay op …" (${st8.stand})`,
    st8.stand === `zoekt de relay op ${LEEG_ADRES}` && st8.lamp === 'zoekt' && !st8.verbonden);
  ok(`40 s: 0 uitzonderingen en 0 console.error (${tab.js.length - jsVoor8})`, tab.js.length === jsVoor8, tab.js.slice(jsVoor8, jsVoor8 + 3).join(' | '));
  const beeldMeld = st8.meld.filter((m) => /beeld/.test(m));
  ok(`na 10 s: precies één melding, een info ("geen relay … staat de pc uit?"), geen rode (${meld10?.length})`,
    meld10?.length === 1 && /^info/.test(meld10[0]) && /staat de pc uit/.test(meld10[0]), meld10);
  ok(`na 40 s: geen melding meer over (de info ging vanzelf weg, er kwam niets bij) (${beeldMeld.length})`, beeldMeld.length === 0, beeldMeld);
  ok(`40 s: rustig opnieuw proberen, hooguit 9 verbindingen (${st8.ws})`, st8.ws >= 3 && st8.ws <= 9);
  info(`wat Chrome zelf logde in die 40 s (Log-domein, niet te onderdrukken): ${tab.log.length - logVoor8} regels`);
  ok(`de hele run: 0 uitzonderingen en 0 console.error in de mixer (${tab.js.length})`, tab.js.length === 0, tab.js.slice(0, 3).join(' | '));

  // ---- 9. een tweede VARVE-tabblad (zelfde localStorage: ook "aan") ------------
  // Alleen het tabblad met de Web Lock mag zenden: twee tabbladen zouden allebei
  // op elke ping antwoorden. Sluit het eerste, dan neemt het tweede het over.
  console.log('\neen tweede VARVE-tabblad');
  const nieuw2 = await fetch(`http://127.0.0.1:${DEBUG}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const tab2 = new Tab(nieuw2.webSocketDebuggerUrl);
  await tab2.verbind();
  await tab2.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;
    ${WS_TEL}` });
  await tab2.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 790, deviceScaleFactor: 1, mobile: false });
  await tab2.cdp('Page.navigate', { url: `http://localhost:${POORT}/` });
  await tab2.tot('!!(window.engine && window.beeld && window.meld)', 30000);
  await tab2.evalueer(HULP);
  for (let i = 0; i < 12; i++) { await tab2.beeld(); await wacht(500); }
  const t2 = await tab2.evalueer(`({ ws: window.__ws.length, elders: window.beeld.status().elders, loopt: window.beeld.status().loopt, stand: __b.stand(), aan: window.beeld.status().aan })`);
  ok(`tweede tabblad (het eerste heeft de lock): aan, maar 0 WebSockets en "een ander VARVE-tabblad" (${JSON.stringify(t2)})`,
    t2.aan && t2.ws === 0 && t2.elders === true && !t2.loopt && /ander VARVE-tabblad/.test(t2.stand));
  const wsEerste = await tab.evalueer('window.__ws.length');
  ok(`het eerste tabblad zendt intussen gewoon (${wsEerste} pogingen)`, wsEerste >= 1);
  await tab.cdp('Page.close').catch(() => null);
  try { tab.ws.close(); } catch (_) {}
  const overgenomen = await tab2.tot("window.beeld.status().loopt && !window.beeld.status().elders && window.__ws.length > 0", 10000);
  ok('het eerste tabblad dicht: het tweede neemt het over en zoekt de relay', overgenomen === true,
    await tab2.evalueer(`({ ws: window.__ws.length, s: window.beeld.status(), stand: __b.stand() })`));
  ok(`tweede tabblad: 0 uitzonderingen en 0 console.error (${tab2.js.length})`, tab2.js.length === 0, tab2.js.slice(0, 3).join(' | '));
  tab = tab2;
} catch (err) {
  console.error(err);
  uitkomst.push(['uitvoering', false]);
} finally {
  try { ktab?.ws.close(); } catch (_) {}
  try { tab?.ws.close(); } catch (_) {}
  for (const p of processen) { try { p.kill(p === processen[0] ? 'SIGINT' : 'SIGKILL'); } catch (_) {} }
  try { relayServer.close(); } catch (_) {}
  for (const s of relay.sockets) s.destroy();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(`\n${uitkomst.length - rood}/${uitkomst.length} ok${rood ? ` — ${rood} FAIL` : ''}  (foto's in ${UIT})`);
process.exit(rood ? 1 : 0);
