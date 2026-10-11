// De Maschine-kaart (maschine.html) in headless Chromium: eerst los (zonder
// mixer), dan geopend VANUIT de mixer met een nagebootste Maschine-verbinding
// (dezelfde Maschine-klasse als met ?hub=, alleen de poort is nep): de kaart
// volgt de pagina, licht de knop op die je aanraakt, toont de schermen die
// naar het apparaat gingen, en verandert zelf niets aan de Maschine. Plus de
// bovenbalk van de mixer: past in rust op 1440 px, en scrollt tijdens het spelen
// opzij zonder hoger te worden (ui/bovenbalk.js).
// Eigen server, tijdelijke database, MIDI eruit (veilig met de APC aangesloten).
//
// Gebruik:  node tools/headless/maschine-kaart.mjs [uitmap]
// Poorten:  VARVE_KIJK_POORT (8841) en VARVE_KIJK_DEBUG (9441).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), '../..');
const UIT = process.argv[2] || join(WORTEL, 'tools/headless/uit');
mkdirSync(UIT, { recursive: true });
const POORT = Number(process.env.VARVE_KIJK_POORT) || 8841, DEBUG = Number(process.env.VARVE_KIJK_DEBUG) || 9441;
const tmp = mkdtempSync(join(tmpdir(), 'varve-maschine-kaart-'));
const GEEN_MIDI = 'delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess;';
const B = `http://localhost:${POORT}`;

function zoekChrome() {
  if (process.env.VARVE_CHROME) return process.env.VARVE_CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
  const map = join(cache, shell);
  const sub = readdirSync(map).find((d) => existsSync(join(map, d, 'chrome-headless-shell')));
  return join(map, sub, 'chrome-headless-shell');
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(WORTEL, 'server/index.js')], {
  env: { ...process.env, PORT: String(POORT), VARVE_DB: join(tmp, 'lib.db'), VARVE_TESTSERVER: '1', VARVE_MEDIA: join(tmp, 'media'),
    VARVE_OPNAMES: join(tmp, 'opnames'), VARVE_PATRONEN: join(tmp, 'patronen'), VARVE_PLANNEN: join(tmp, 'plannen'), VARVE_PROEF: join(tmp, 'proef'), VARVE_HERANALYSE: 'uit' },
  stdio: 'ignore',
});
const chrome = spawn(zoekChrome(), [
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmp, 'profiel')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900', '--disable-popup-blocking',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

/** Een tabblad via het DevTools-protocol: cdp(), ev(), en de fouten in de console. */
async function verbind(doel, { geenMidi = true } = {}) {
  const ws = new WebSocket(doel.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let volg = 0;
  const wachtend = new Map(), fouten = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wachtend.has(m.id)) { const w = wachtend.get(m.id); wachtend.delete(m.id); m.error ? w.f(new Error(m.error.message)) : w.ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') fouten.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') fouten.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const cdp = (method, params = {}) => { const id = ++volg; ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, f) => wachtend.set(id, { ok, f })); };
  const ev = async (expr, gebaar = false) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: gebaar });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  if (geenMidi) await cdp('Page.addScriptToEvaluateOnNewDocument', { source: GEEN_MIDI });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { ws, cdp, ev, fouten, id: doel.id };
}
async function tot(fn, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await fn().catch(() => false)) return true; await wacht(150); }
  return false;
}
async function foto(t, naam) {
  const { data } = await t.cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(UIT, naam), Buffer.from(data, 'base64'));
}

const uitkomst = [];
const ok = (naam, cond, extra = '') => { uitkomst.push([naam, !!cond]); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

/** Uit de kaart: label van een control op de plaat, de koptekst van het detail, de knoppen bovenaan die aan staan. */
const LEES = `({
  label: (id) => document.querySelector('#plaat [data-id="' + id + '"] span')?.textContent ?? null,
  gekozen: () => document.querySelector('#plaat .c.gekozen')?.dataset.id ?? null,
  detail: () => document.getElementById('detail').textContent,
  aan: () => [...document.querySelectorAll('.k-kop .aan')].map((e) => e.dataset.pagina || e.dataset.padmodus || e.id),
  live: () => document.getElementById('live').textContent,
  // Hoeveel pixels van een scherm "aan" staan (de lichte LCD-kleur).
  pixels: (nr) => { const c = document.querySelectorAll('#plaat .lcd canvas')[nr]; const d = c.getContext('2d').getImageData(0, 0, 256, 64).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150) n++; return n; },
})`;

let kaart, mixer, los;
try {
  let doelen = null;
  for (let i = 0; i < 50 && !doelen; i++) { await wacht(200); doelen = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()).catch(() => null); }
  for (let i = 0; i < 50; i++) { if (await fetch(`${B}/`).then((r) => r.ok).catch(() => false)) break; await wacht(200); }

  // ---- 1. los: zonder mixer ----------------------------------------------------------------
  console.log('los geopend (zonder mixer)');
  los = await verbind(doelen.find((d) => d.type === 'page'));
  await los.cdp('Page.navigate', { url: `${B}/maschine.html` });
  ok('de pagina laadt en tekent de plaat', await tot(() => los.ev("document.querySelectorAll('#plaat .c').length === 72")));
  const L = (expr) => los.ev(`(${LEES}).${expr}`);
  ok('72 controls: 16 pads, 8 draaiknoppen, het wiel, 47 knoppen', await los.ev("document.querySelectorAll('#plaat .v-pad').length === 16 && document.querySelectorAll('#plaat .v-draai').length === 8"));
  ok('niet live, en dat staat er', /niet live/.test(await L('live()')), await L('live()'));
  ok('beginstand: pagina Instrument, pads spelen', JSON.stringify(await L('aan()')) === '["instrument","spelen"]', JSON.stringify(await L('aan()')));
  ok('pad 1 = C2, groep A = focus 1, PLAY = patroon', (await L("label('pad1')")) === 'C2' && (await L("label('groepA')")) === 'focus 1' && /pat/.test(await L("label('play')")));
  ok('vrije knoppen zijn gedimd (F1, NOTE REPEAT); BROWSE is de library (sinds 8 okt)', await los.ev("document.querySelector('#plaat [data-id=\"f1\"]').classList.contains('s-vrij') && document.querySelector('#plaat [data-id=\"noteRepeat\"]').classList.contains('s-vrij') && document.querySelector('#plaat [data-id=\"browse\"]').classList.contains('s-library')"));
  ok('beide schermen zijn getekend', (await L('pixels(0)')) > 50 && (await L('pixels(1)')) > 50, `${await L('pixels(0)')} / ${await L('pixels(1)')} px aan`);
  await los.ev("document.querySelector('[data-pagina=\"strip\"]').click()");
  ok('Strip: draaiknop 1 = trim, 8 = filter', await tot(async () => (await L("label('k1')")) === 'trim' && (await L("label('k8')")) === 'filter'));
  await los.ev("document.querySelector('#plaat [data-id=\"k2\"]').click()");
  ok('klik op draaiknop 2: de uitleg van de Maschine, en per pagina', await tot(async () => /hoog van track 1/.test(await L('detail()')) && /per pagina/.test(await L('detail()'))), (await L('detail()')).slice(0, 120));
  await los.ev("document.querySelector('[data-padmodus=\"stappen\"]').click()");
  ok('padmodus stappen: pad 1 = stap 1, pad 16 = stap 16', await tot(async () => (await L("label('pad1')")) === 'stap 1' && (await L("label('pad16')")) === 'stap 16'));
  await los.ev("document.querySelector('[data-padmodus=\"plek\"]').click()");
  ok('PATTERN vast: pad 5 = plek 5, pad 6 vrij', await tot(async () => (await L("label('pad5')")) === 'plek 5'
    && await los.ev("document.querySelector('#plaat [data-id=\"pad6\"]').classList.contains('s-vrij')")));
  await los.ev("document.querySelector('#plaat [data-id=\"pad3\"]').click()");
  ok('klik op pad 3: per padmodus, de stand van nu gemarkeerd', await tot(async () => /per padmodus/.test(await L('detail()'))
    && await los.ev("document.querySelector('#detail tr.nu')?.textContent.includes('PATTERN')")));
  await los.ev("document.querySelector('#shift').click()");
  ok('shift: PLAY toont de shift-regel', await tot(async () => (await L("label('play')"))?.endsWith('!')
    && await los.ev("document.querySelector('#plaat [data-id=\"play\"]').classList.contains('shiftregel')")), await L("label('play')"));
  await los.ev("document.querySelector('#shift').click()");
  await los.ev("{ const z = document.getElementById('zoek'); z.value = 'filter'; z.dispatchEvent(new Event('input')); }");
  ok('zoeken op "filter": draaiknop 8 licht op', await tot(() => los.ev("document.querySelector('#plaat [data-id=\"k8\"]').classList.contains('treffer')")));
  await los.ev("{ const z = document.getElementById('zoek'); z.value = ''; z.dispatchEvent(new Event('input')); }");
  await foto(los, 'maschine-kaart-los.png');
  ok('geen fouten in de console (los)', los.fouten.length === 0, los.fouten.join(' | '));

  // ---- 2. live: vanuit de mixer --------------------------------------------------------------
  console.log('\nvanuit de mixer, met een nagebootste Maschine-verbinding');
  mixer = await verbind(await fetch(`http://127.0.0.1:${DEBUG}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()));
  await mixer.cdp('Page.navigate', { url: `${B}/` });
  ok('de mixer laadt', await tot(() => mixer.ev('!!window.engine && !!window.spiegel'), 20000));
  ok('de mixer heeft naast elkaar de kaarten APC en Maschine', await mixer.ev(
    "(() => { const k = document.getElementById('maschine-btn'); return !!k && k.getAttribute('href') === 'maschine.html' && k.previousElementSibling?.id === 'apc-btn' && k.parentElement.classList.contains('kaarten'); })()"));
  // Zoals speelapparaten.js met ?hub=, maar de poort is nep: dezelfde Maschine, dezelfde bus en engine.
  await mixer.ev(`(async () => {
    const { Maschine } = await import('/src/control/maschine.js');
    const { read, invoke } = await import('/src/control/actions.js');
    const { beschrijf } = await import('/src/ui/apc-beschrijf.js');
    const m = new Maschine({ engine: window.engine, noten: window.noten, read, invoke, beschrijf });
    m.laadMapping(await (await fetch('mappings/maschine-mk2.json')).json());
    window.verstuurd = { schermen: 0 };
    m.koppel({ in: { state: 'connected', onmidimessage: null, onstatechange: null }, uit: { state: 'connected', send() {} },
      scherm() { window.verstuurd.schermen++; } });
    setInterval(() => m.tik(), 33);
    window.maschine = m;
    window.druk = (st, nr, w) => { const { parseMessage } = window.__midi; m.ontvang(parseMessage([st, nr, w])); };
    window.__midi = await import('/src/control/midi.js');
  })()`);
  // Een aanraking van VÓÓR de kaart open was: die mag de kaart niet als "nu" tonen (review 7 okt).
  await mixer.ev('druk(0x91, 24, 127); druk(0x81, 24, 0)');
  await mixer.ev("window.__kaart = window.open('maschine.html', 'varve-maschine'), true", true);
  let doel = null;
  for (let i = 0; i < 50 && !doel; i++) {
    await wacht(200);
    doel = (await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json())).find((d) => d.type === 'page' && d.url.endsWith('/maschine.html') && d.id !== los.id);
  }
  ok('de kaart gaat open vanuit de mixer', !!doel);
  kaart = await verbind(doel, { geenMidi: false });
  const K = (expr) => kaart.ev(`(${LEES}).${expr}`);
  ok('de kaart ziet de mixer (window.opener)', await tot(() => kaart.ev('!!window.opener && !!window.opener.maschine')));
  ok('live: hij volgt de Maschine', await tot(async () => /live: volgt/.test(await K('live()'))), await K('live()'));
  await wacht(600);
  ok('een aanraking van vóór het openen wordt niet gekozen', (await K('gekozen()')) === null, await K('gekozen()'));
  // ► links boven op het apparaat: de pagina Strip.
  await mixer.ev('druk(0x91, 13, 127); druk(0x81, 13, 0)');
  ok('► op de Maschine: de kaart springt mee naar Strip', await tot(async () => (await K('aan()')).includes('strip') && (await K("label('k1')")) === 'trim'));
  ok('…en de knop die je aanraakte licht op en is gekozen', await tot(async () => (await K('gekozen()')) === 'browseR'));
  // Draaiknop 3 draaien: gekozen op de kaart, met de uitleg van de Maschine.
  await mixer.ev('druk(0xb0, 18, 1)');
  ok('draaiknop 3 gedraaid: de kaart kiest hem, uitleg "mid"', await tot(async () => (await K('gekozen()')) === 'k3' && /mid van track/.test(await K('detail()'))));
  ok('de schermen tonen wat er naar de Maschine ging', await tot(async () => (await mixer.ev('window.verstuurd.schermen')) > 0 && (await K('pixels(0)')) > 50));
  // STEP op het apparaat: padmodus stappen (geen instrument: de modus wisselt toch).
  await mixer.ev('druk(0x91, 9, 127); druk(0x81, 9, 0)');
  ok('STEP op de Maschine: de kaart toont de stappen', await tot(async () => (await K('aan()')).includes('stappen') && (await K("label('pad1')")) === 'stap 1'));
  // Zelf een andere stand kiezen: het volgen stopt, en de Maschine blijft waar hij was.
  await kaart.ev("document.querySelector('[data-pagina=\"rack\"]').click()");
  ok('Rack kiezen op de kaart: volgen stopt, de knop "volg" verschijnt', await tot(async () => (await K('aan()')).includes('rack')
    && await kaart.ev("document.getElementById('volg').classList.contains('zicht')")));
  ok('…en de Maschine zelf staat nog op Strip (de kaart stuurt niets)', (await mixer.ev('window.maschine.pagina')) === 'strip');
  await mixer.ev('druk(0x91, 12, 127); druk(0x81, 12, 0)');   // ◄: terug naar Instrument op het apparaat
  await wacht(500);
  ok('◄ op de Maschine terwijl de kaart niet volgt: de kaart blijft op Rack', (await K('aan()')).includes('rack'));
  await kaart.ev("document.getElementById('volg').click()");
  ok('volg de Maschine: weer op Instrument', await tot(async () => (await K('aan()')).includes('instrument') && /live: volgt/.test(await K('live()'))));
  // SHIFT op het apparaat: de kaart toont de shift-regels.
  await mixer.ev('druk(0x91, 39, 127)');
  ok('SHIFT vast op de Maschine: de kaart toont shift', await tot(async () => (await K('aan()')).includes('shift')));
  await mixer.ev('druk(0x81, 39, 0)');
  ok('SHIFT los: weer zonder', await tot(async () => !(await K('aan()')).includes('shift')));
  await foto(kaart, 'maschine-kaart-live.png');
  ok('geen fouten in de console (kaart)', kaart.fouten.length === 0, kaart.fouten.join(' | '));
  ok('geen fouten in de console (mixer)', mixer.fouten.length === 0, mixer.fouten.join(' | '));
  // Wat de balk NODIG heeft (scrollWidth wordt nooit kleiner dan het venster): marges, merk en de knoppen rechts.
  const breed = await mixer.ev(`(() => { const t = document.querySelector('.topbar'), cs = getComputedStyle(t), k = document.getElementById('maschine-btn');
    const nodig = () => Math.ceil(parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + (parseFloat(cs.columnGap) || 0)
      + t.querySelector('.brand').getBoundingClientRect().width + t.querySelector('.topbar-right').scrollWidth);
    const met = nodig(); k.style.display = 'none'; const zonder = nodig(); k.style.display = ''; return [met, zonder, Math.round(t.getBoundingClientRect().height)]; })()`);
  ok('de bovenbalk van de mixer past in rust op 1440 px (met de knop Maschine)', breed[0] <= 1440, `nodig ${breed[0]} px, zonder de knop ${breed[1]} px`);
  // In gebruik worden "audio starten" en "○ log" langer (en het log loopt altijd): ter info.
  await mixer.ev("document.getElementById('audio-btn').click()", true);
  await mixer.ev("document.getElementById('log-btn').textContent.includes('◉') || document.getElementById('log-btn').click()", true);
  await wacht(2500);
  // Dan scrollt het rechterdeel opzij (ui/bovenbalk.js, Clay 7 okt): niets valt weg, de balk wordt niet hoger.
  const balk = () => mixer.ev(`(() => { const b = document.querySelector('.topbar-right'), t = document.querySelector('.topbar'), h = document.getElementById('help-btn').getBoundingClientRect();
    return { nodig: b.scrollWidth, ziet: b.clientWidth, links: Math.round(b.scrollLeft), meer: b.classList.contains('meer'), minder: b.classList.contains('minder'),
      pagina: document.documentElement.scrollWidth, hoog: Math.round(t.getBoundingClientRect().height), hulpRechts: Math.round(h.right), balkRechts: Math.round(b.getBoundingClientRect().right) }; })()`);
  let b = await balk();
  ok('tijdens het spelen past hij niet, en dan scrollt het rechterdeel (rechts vervaagd)', b.nodig > b.ziet && await tot(async () => (await balk()).meer), JSON.stringify(b));
  ok('de pagina zelf scrolt niet opzij', b.pagina <= 1440, `${b.pagina} px`);
  ok('de balk is niet hoger geworden', b.hoog === breed[2], `${b.hoog} px, in rust ${breed[2]}`);
  await mixer.ev("document.querySelector('.topbar-right').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })), true");
  ok('het scrollwiel van een muis schuift hem opzij (links vervaagt dan ook)', await tot(async () => { const x = await balk(); return x.links > 0 && x.minder; }));
  await mixer.ev("{ const e = document.querySelector('.topbar-right'); e.scrollLeft = e.scrollWidth; }");
  ok('helemaal opzij: "? toetsen" staat in beeld, rechts niets meer', await tot(async () => { const x = await balk(); return !x.meer && x.hulpRechts <= x.balkRechts; }), JSON.stringify(await balk()));
  const lamp = await mixer.ev(`(() => { const k = document.getElementById('beeld-btn'); k.dataset.lamp = 'volgt';
    return Math.round(k.getBoundingClientRect().top - 3 - document.querySelector('.topbar-right').getBoundingClientRect().top); })()`);
  ok('het lampje op "beeld" (3 px boven de knop) valt binnen de balk, niet afgeknipt', lamp >= 0, `${lamp} px ruimte`);
} catch (err) {
  ok(`script liep door: ${err.message}`, false);
} finally {
  for (const t of [kaart, mixer, los]) { try { t?.ws.close(); } catch (_) {} }
  chrome.kill(); server.kill();
  await wacht(300);
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
}
const rood = uitkomst.filter(([, g]) => !g).length;
console.log(rood ? `\n${rood} FOUT(EN)` : `\nAlles groen. Schermafdrukken in ${UIT}/maschine-kaart-{los,live}.png`);
process.exit(rood ? 1 : 0);
