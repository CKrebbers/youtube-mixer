// De statuszender van de mixer (src/ui/status-zender.js) met een nagebouwd
// BroadcastChannel, een nagebouwde fetch (haalFn) en een nepklok: het kanaal
// naar de Controlekamer zoals altijd, en de POST naar de server voor iPad en
// iPhone (docs/COMPANION.md stap 2) die de mixer nooit mag storen: standaard
// uit, hooguit één per 900 ms, nooit twee tegelijk, rust na een weigering of een
// netwerkfout, en niets wat haalFn doet komt uit stuur().
// Draai met: node test/status-zender.test.mjs
const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const tik = () => new Promise((z) => setTimeout(z, 0));

/** Een BroadcastChannel zoals de echte: postMessage klont (structuredClone), close sluit. */
const kanalen = [];
globalThis.BroadcastChannel = class {
  constructor(naam) { this.naam = naam; this.berichten = []; this.dicht = false; this.onmessage = null; kanalen.push(this); }
  postMessage(m) { if (this.dicht) throw new Error('kanaal dicht'); this.berichten.push(structuredClone(m)); }
  close() { this.dicht = true; }
};

const { startStatusZender, maakStatus, eindUitActions, SERVER_MS, SERVER_RUST_MS, RUST_WEIGER_MS, RUST_FOUT_MS, KANAAL } = await import('../src/ui/status-zender.js');

const snap = { focus: 'A', maat: 'A', decks: { A: { id: 'A', loaded: true, playing: true, title: 'Proef A', bpm: 124, toon: null, position: 600, duration: 3600, rate: 1 } } };
const lees = () => ({ snap, midi: null, audio: 'running', tab: 'tab-proef-1', eind: { zwart: false, bevroren: true, master: 0.8 } });

/** Een nagebouwde fetch. `antwoord` = (aanroep) => Response-achtig | Promise | gooit. Luistert naar de AbortSignal, zoals de echte. */
function nepFetch(antwoord = () => ({ ok: true, status: 200 })) {
  const aanroepen = [];
  const f = (url, init) => {
    aanroepen.push({ url, init });
    const r = antwoord(aanroepen.length, init);
    if (!(r instanceof Promise)) return r;
    return new Promise((ok2, f2) => {
      init.signal?.addEventListener('abort', () => f2(Object.assign(new Error('afgebroken'), { name: 'AbortError' })));
      r.then(ok2, f2);
    });
  };
  f.aanroepen = aanroepen;
  return f;
}

console.log('standaard: alleen het kanaal, zoals altijd');
{
  const haal = nepFetch();
  const z = startStatusZender({ lees, interval: 60_000, haalFn: haal });
  z.stuur(); z.stuur();
  await tik();
  const k = kanalen.at(-1);
  ok(`het kanaal heet ${KANAAL} en kreeg elke stuur() een bericht (${k.berichten.length})`, k.naam === KANAAL && k.berichten.length === 3);
  ok('naarServer staat standaard uit: 0 fetches', haal.aanroepen.length === 0);
  z.stop();
  ok('stop sluit het kanaal', k.dicht);
}

console.log('\nnaarServer: hooguit één POST per 900 ms');
{
  let nu = 1_000_000;
  const haal = nepFetch();
  const z = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: haal, klok: () => nu });
  await tik();   // de eerste (bij het starten) is af
  ok('bij het starten meteen één POST naar /api/mixer', haal.aanroepen.length === 1 && haal.aanroepen[0].url === '/api/mixer'
    && haal.aanroepen[0].init.method === 'POST' && haal.aanroepen[0].init.headers['Content-Type'] === 'application/json'
    && haal.aanroepen[0].init.cache === 'no-store' && !!haal.aanroepen[0].init.signal);
  nu += 300; z.stuur(); await tik();
  nu += 300; z.stuur(); await tik();
  nu += 299; z.stuur(); await tik();
  ok(`drie keer stuur() binnen ${SERVER_MS} ms: nog steeds 1 POST`, haal.aanroepen.length === 1);
  nu += 1; z.stuur(); await tik();
  ok(`na ${SERVER_MS} ms: de tweede`, haal.aanroepen.length === 2);
  const k = kanalen.at(-1);
  ok('het bericht op het kanaal en de body naar de server zijn hetzelfde (in JSON)', JSON.stringify(k.berichten.at(-1)) === haal.aanroepen.at(-1).init.body);
  const body = JSON.parse(haal.aanroepen.at(-1).init.body);
  ok('de body heeft tab, eind en positie/duur/rate', body.tab === 'tab-proef-1' && body.eind.bevroren === true && body.eind.master === 0.8
    && body.tracks[0].positie === 600 && body.tracks[0].duur === 3600 && body.tracks[0].rate === 1);
  z.stop();
}

console.log('\nAR16: zonder kijker rustiger (1× per 4 s), met kijker weer 900 ms');
{
  let nu = 1_500_000;
  let kijkt = false;
  const haal = nepFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, kijker: kijkt }) }));
  const z = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: haal, klok: () => nu });
  await tik(); await tik();
  ok('het eerste antwoord zegt kijker: false → de zender weet het', haal.aanroepen.length === 1 && z.kijker === false);
  for (let i = 0; i < 3; i++) { nu += 1000; z.stuur(); await tik(); }
  ok(`drie keer 1 s later: geen tweede POST (onder ${SERVER_RUST_MS} ms)`, haal.aanroepen.length === 1);
  nu += 1000; z.stuur(); await tik(); await tik();
  ok(`na ${SERVER_RUST_MS} ms: de tweede`, haal.aanroepen.length === 2);
  const { VERS_MS } = await import('../src/companion/companion-lijst.js');
  ok(`SERVER_RUST_MS (${SERVER_RUST_MS}) onder VERS_MS van de companion (${VERS_MS}): wie gaat kijken ziet nooit een oude stand`, SERVER_RUST_MS < VERS_MS);
  kijkt = true;
  nu += SERVER_RUST_MS; z.stuur(); await tik(); await tik();
  ok('iemand kijkt: het antwoord zegt het', haal.aanroepen.length === 3 && z.kijker === true);
  nu += SERVER_MS; z.stuur(); await tik();
  ok(`… en meteen weer elke ${SERVER_MS} ms`, haal.aanroepen.length === 4);
  z.stop();
  // Een oudere server zonder `kijker` in het antwoord: zoals altijd.
  let nu2 = 1_700_000;
  const oud = nepFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  const z2 = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: oud, klok: () => nu2 });
  await tik(); await tik();
  nu2 += SERVER_MS; z2.stuur(); await tik();
  ok('een oudere server (antwoord zonder kijker): gewoon elke 900 ms', oud.aanroepen.length === 2 && z2.kijker === true);
  z2.stop();
}

console.log('\nniet het eerste tabblad: niets naar de server');
{
  const haal = nepFetch();
  const z = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: haal, isEerste: () => false, klok: () => 5e6 });
  z.stuur(); await tik();
  ok('isEerste false: 0 fetches en niets op het kanaal', haal.aanroepen.length === 0 && kanalen.at(-1).berichten.length === 0);
  z.stop();
}

console.log('\neen POST die hangt: geen tweede zolang hij onderweg is');
{
  let nu = 2e6;
  const haal = nepFetch(() => new Promise(() => {}));   // antwoordt nooit
  const z = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: haal, klok: () => nu });
  for (let i = 0; i < 5; i++) { nu += 1000; z.stuur(); await tik(); }
  ok('vijf keer stuur() met 1 s ertussen, de eerste hangt: nog steeds 1 POST', haal.aanroepen.length === 1);
  ok('... en het kanaal liep gewoon door (6 berichten)', kanalen.at(-1).berichten.length === 6);
  await new Promise((r) => setTimeout(r, SERVER_MS + 60));   // de eigen time-out breekt hem af
  nu += 1000; z.stuur(); await tik();
  ok('na de time-out (AbortError): meteen weer, zonder extra rust', haal.aanroepen.length === 2);
  z.stop();
}

console.log('\nrust na een 404, een weigering, een 5xx of een netwerkfout');
for (const [naam, antwoord, rust] of [
  ['404 (een oudere server)', () => ({ ok: false, status: 404 }), RUST_WEIGER_MS],
  ['403 (niet vanaf deze Mac)', () => ({ ok: false, status: 403 }), RUST_WEIGER_MS],
  ['500', () => ({ ok: false, status: 500 }), RUST_FOUT_MS],
  ['netwerkfout (afwijzen)', () => Promise.reject(new TypeError('Failed to fetch')), RUST_FOUT_MS],
]) {
  let nu = 3e6;
  let teller = 0;
  const haal = nepFetch((n) => { teller = n; return n === 1 ? antwoord() : { ok: true, status: 200 }; });
  const z = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: haal, klok: () => nu });
  await tik(); await tik();
  nu += rust - 1; z.stuur(); await tik();
  const stil = haal.aanroepen.length === 1;
  nu += 1; z.stuur(); await tik();
  ok(`${naam}: ${rust / 1000} s stil, daarna weer`, stil && haal.aanroepen.length === 2 && teller === 2);
  z.stop();
}

console.log('\neen haalFn die gooit of afwijst komt niet uit stuur()');
{
  let nu = 4e6;
  const gooit = () => { throw new Error('kapot'); };
  const z1 = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: gooit, klok: () => nu });
  let gegooid = false;
  try { nu += 1000; z1.stuur(); nu += 20_000; z1.stuur(); } catch { gegooid = true; }
  await tik();
  ok('haalFn gooit meteen: stuur() gooit niet, het kanaal kreeg alles', !gegooid && kanalen.at(-1).berichten.length === 3);
  z1.stop();
  const onverwacht = [];
  const vang = (e) => onverwacht.push(e);
  process.on('unhandledRejection', vang);
  const z2 = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: () => Promise.reject(new Error('weg')), klok: () => nu });
  await tik(); await tik(); await new Promise((r) => setTimeout(r, 20));
  ok('haalFn wijst af: geen onafgehandelde afwijzing', onverwacht.length === 0);
  process.off('unhandledRejection', vang);
  z2.stop();
  const z3 = startStatusZender({ lees: () => { throw new Error('engine weg'); }, interval: 60_000, naarServer: true, haalFn: nepFetch(), klok: () => nu });
  let gooitLees = false;
  try { z3.stuur(); } catch { gooitLees = true; }
  ok('een lees() die gooit: stuur() gooit niet', !gooitLees);
  z3.stop();
}

console.log('\nzonder BroadcastChannel');
{
  const bewaard = globalThis.BroadcastChannel;
  delete globalThis.BroadcastChannel;
  ok('zonder kanaal en zonder naarServer: null (zoals vroeger)', startStatusZender({ lees }) === null);
  const haal = nepFetch();
  const z = startStatusZender({ lees, interval: 60_000, naarServer: true, haalFn: haal, klok: () => 6e6 });
  await tik();
  ok('zonder kanaal maar met naarServer: de POST gaat wel', z !== null && haal.aanroepen.length === 1);
  z.stop();
  globalThis.BroadcastChannel = bewaard;
}

console.log('\nmaakStatus: eind en tab');
{
  const s = maakStatus({ snap, midi: null, nu: 1 });
  ok('zonder eind en tab: allebei null', s.eind === null && s.tab === null);
  ok('master 7 wordt 1, -1 wordt 0, ontbrekend wordt 1', maakStatus({ snap, midi: null, eind: { master: 7 } }).eind.master === 1
    && maakStatus({ snap, midi: null, eind: { master: -1 } }).eind.master === 0 && maakStatus({ snap, midi: null, eind: {} }).eind.master === 1);
  ok('zwart en bevroren worden booleans', JSON.stringify(maakStatus({ snap, midi: null, eind: { zwart: 1, bevroren: 0, master: 0.5 } }).eind) === '{"zwart":true,"bevroren":false,"master":0.5}');
}

// Review ronde 2, fix 6: "beeld" op de companion zegt ZWART aan precies als de zaal zwart is: ook bij de
// drukvariant (video.black.hold, de paniekknop van de hub). Met de echte action-bus en een echt Eindbeeld.
console.log('\neindUitActions: de noodknoppen zoals de zaal ze ziet (echte bus, echt Eindbeeld)');
{
  const { bindVideo, invoke, read } = await import('../src/control/actions.js');
  const { Eindbeeld } = await import('../src/video/eindbeeld.js');
  const { VIDEO_FX, MODI } = await import('../src/video/instellingen.js');
  const eb = new Eindbeeld();
  let klok = 1000;
  bindVideo({
    fx: Object.fromEntries(VIDEO_FX.map((f) => [f.id, f.standaard])), modus: MODI[0], puls: 0, pulsDoel: 'rgb',
    zetFx() {}, volgendeModus() {}, zetPuls() {}, volgendPulsDoel() {}, volgendeFit() {},
    eindbeeld: eb,   // zoals video-mixer.js r.358–363
    zetZwart(a) { eb.zetZwart(a, klok); }, zetZwartVast(a) { eb.zetZwartVast(a, klok); }, zetBevroren(a) { eb.zetBevroren(a, klok); },
    zetMaster(v) { eb.zetMaster(v); }, flits() { eb.flits(klok); }, flitsNu() { return eb.flitsNu(klok); },
  });
  const zaalZwart = () => eb.zwart.naar === 1;   // waar Eindbeeld naartoe gaat (de schakelaar dooft in 250 ms, de drukvariant direct)
  ok('begin: niets zwart, niets bevroren, master 1', JSON.stringify(eindUitActions(read)) === '{"zwart":false,"bevroren":false,"master":1}' && !zaalZwart());
  invoke('video.black.hold', true);
  ok('de drukvariant ingedrukt: de zaal is zwart, en eind.zwart ook', zaalZwart() && eb.zwartNu(klok) === 1 && eindUitActions(read).zwart === true);
  ok('... en zo staat het in de melding', maakStatus({ snap, midi: null, eind: eindUitActions(read) }).eind.zwart === true);
  invoke('video.black.hold', false);
  ok('losgelaten: weer niet zwart', !zaalZwart() && eindUitActions(read).zwart === false);
  invoke('video.black', true); invoke('video.black', false);
  ok('de schakelaar aan: zwart', zaalZwart() && eindUitActions(read).zwart === true);
  invoke('video.black.hold', true); invoke('video.black.hold', false);
  ok('schakelaar aan, drukvariant in- en uitgedrukt: nog steeds zwart (de schakelaar beslist)', zaalZwart() && eindUitActions(read).zwart === true);
  invoke('video.black', true); invoke('video.black', false);
  invoke('video.freeze', true); invoke('video.master', 0.25);
  ok('schakelaar weer uit, bevroren, master 0,25', JSON.stringify(eindUitActions(read)) === '{"zwart":false,"bevroren":true,"master":0.25}' && !zaalZwart());
  ok('een bus zonder video-actions (read geeft null): niets zwart, master 1', JSON.stringify(eindUitActions(() => null)) === '{"zwart":false,"bevroren":false,"master":1}');
}

console.log(`\n${fails.length ? `${fails.length} FAIL` : 'alles ok'}`);
process.exit(fails.length ? 1 : 0);
