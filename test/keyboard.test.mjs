// Het toetsenbord als data (werkruimte S5, docs/werkruimte/S5.md): mappings/toetsen.json
// tegen de GOUDEN lijst (KEYMAP en SHIFT_TOETS in src/control/keyboard.js), het uitvoeren
// via een Mapping, wat code blijft (typen, Cmd/Ctrl/Alt, schermgebaren), koppelen met een
// toets, en je eigen verschil per apparaat (/api/mapping/toetsen). Geen DOM: window en
// document zijn nep, net als in engine.test en mapping.test.
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond, extra = '') => { if (!cond) fails.push(naam); console.log(`${cond ? '  ok  ' : 'FAIL  '}${naam}${extra ? ` (${extra})` : ''}`); };

const K = await import('../src/control/keyboard.js');
const { KEYMAP, SHIFT_TOETS, toetsActie, toetsSig, codeVanSig, HID, GEBAREN, toetsenStandaard, attachKeyboard, toetsenbord } = K;
const { Mapping, normaliseer, sleutelVan } = await import('../src/control/mapping.js');
const bus = await import('../src/control/actions.js');
const { laadEigen, opzetMappingOpslag, plekVan } = await import('../src/ui/mapping-opslag.js');

const BESTAND = JSON.parse(readFileSync(new URL('../mappings/toetsen.json', import.meta.url), 'utf8'));
// Terug naar de schrijfwijze van de tabel: {focus} = {L}, {tweede} = {R}.
const alsTabel = (id) => id && id.replace(/\{focus\}/g, '{L}').replace(/\{tweede\}/g, '{R}');

console.log('mappings/toetsen.json tegen de gouden lijst (KEYMAP + SHIFT_TOETS)');
{
  const m = new Mapping({ read: () => null, invoke: () => {} });
  const uit = m.load(BESTAND);
  ok('toetsen.json laadt zonder fouten, apparaat "toetsen"', uit.fouten.length === 0 && m.device === 'toetsen', uit.fouten.join(' | '));
  const verschillen = [];
  let getoetst = 0;
  for (const code of Object.keys(KEYMAP)) {
    for (const shift of [false, true]) {
      const regel = m.kies(toetsSig(code), { shift });
      const hier = alsTabel(regel?.action ?? null), gouden = toetsActie(code, shift);
      getoetst++;
      if (hier !== gouden || (regel && regel.mode !== 'trigger')) verschillen.push(`${shift ? 'shift+' : ''}${code}: ${hier} ≠ ${gouden}`);
    }
  }
  ok(`elke toets van KEYMAP, met en zonder shift: dezelfde action (${getoetst} gevallen, 0 verschillen)`, getoetst === 2 * Object.keys(KEYMAP).length && verschillen.length === 0, verschillen.join(', '));
  ok('SHIFT_TOETS (W, E, I, O met shift: secties) zit erin', Object.entries(SHIFT_TOETS).every(([c, id]) => alsTabel(m.kies(toetsSig(c), { shift: true })?.action) === id));
  const zonder = [...m.rules.values()].map((r) => codeVanSig(r.in)).filter((c) => !(c in KEYMAP));
  ok('geen nieuwe toewijzingen: elke regel hoort bij een toets uit KEYMAP', zonder.length === 0, zonder.join(', '));
  ok('geen regel op een schermgebaar (spatie, [ ], /, Esc, B)', GEBAREN.every((c) => ![...m.rules.values()].some((r) => r.in === toetsSig(c))));
  // Een shift-regel alleen waar shift iets anders doet; anders valt shift terug op de gewone regel.
  const nutteloos = [...m.rules.values()].filter((r) => r.shift && m.rules.get(r.in)?.action === r.action);
  ok('geen shift-regel die hetzelfde doet als zonder shift', nutteloos.length === 0);
  const a = normaliseer(BESTAND).doc.rules.map((r) => JSON.stringify([sleutelVan(r), r])).sort();
  const b = normaliseer(toetsenStandaard()).doc.rules.map((r) => JSON.stringify([sleutelVan(r), r])).sort();
  ok('toetsen.json = toetsenStandaard() regel voor regel (de beginstand van keyboard.js tot het bestand binnen is)', a.length === b.length && a.every((x, i) => x === b[i]));
  ok('alle {L}/{R} zijn {focus}/{tweede} geworden', !JSON.stringify(BESTAND.rules).includes('{L}') && !JSON.stringify(BESTAND.rules).includes('{R}'));
}

console.log('\nsignatures: key:0:<HID-gebruikscode>');
{
  const nummers = Object.values(HID);
  ok('elke code een eigen nummer', new Set(nummers).size === nummers.length);
  ok('A = 4, Z = 29, 1 = 30, 0 = 39, ` = 53, § = 100 (USB HID, page 0x07)', HID.KeyA === 4 && HID.KeyZ === 29 && HID.Digit1 === 30 && HID.Digit0 === 39 && HID.Backquote === 53 && HID.IntlBackslash === 100);
  ok('heen en terug: toetsSig/codeVanSig', Object.keys(HID).every((c) => codeVanSig(toetsSig(c)) === c) && toetsSig('Onbekend') === null);
  ok('elke toets van KEYMAP heeft een nummer', Object.keys(KEYMAP).every((c) => toetsSig(c)));
  ok('een toets-signature is geldig voor mapping.js (type:kanaal:nummer)', /^[a-z]+:(\*|\d+):\d+$/.test(toetsSig('KeyQ')));
}

// ---- het uitvoeren: een nep-window, de echte bus ----------------------------------
const log = [];
const ACTIONS = ['track.1.play', 'track.1.play.quant', 'track.1.cue', 'track.1.hotcue.1', 'track.1.hotcue.1.delete', 'track.2.play', 'track.2.cue',
  'track.1.section.prev', 'track.1.focus', 'track.3.focus', 'track.4.focus', 'track.1.grid.undo', 'track.2.hotcue.1', 'mixer.xfader'];
for (const id of ACTIONS) bus.define(id, id === 'mixer.xfader' ? 'value' : 'trigger', (v) => log.push(`${id}=${v}`));
const win = {}, doc = { visibilityState: 'visible' };
const oudW = globalThis.window, oudD = globalThis.document;
globalThis.window = { addEventListener: (t, f) => { win[t] = f; } };
globalThis.document = { addEventListener: (t, f) => { doc[t] = f; }, get visibilityState() { return doc.visibilityState; } };
const eng = { focus: 'A', xfader: 0.5, emit() {} };
const kb = attachKeyboard(eng, { venster: (v) => (v === 'L' ? 'A' : 'B') });
globalThis.window = oudW; globalThis.document = oudD;
const druk = (code, mods = {}, type = 'keydown') => win[type]?.({ code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false,
  target: { matches: () => false }, preventDefault() {}, ...mods });
const tik = (code, mods = {}) => { druk(code, mods); druk(code, mods, 'keyup'); };

console.log('\nuitvoeren via de Mapping');
{
  ok('attachKeyboard geeft { mapping, learn }, en toetsenbord() dezelfde', kb && kb.mapping instanceof Mapping && toetsenbord() === kb);
  ok('vanaf het eerste moment de standaard (zonder te wachten op het bestand)', kb.mapping.kies(toetsSig('KeyQ'))?.action === 'track.{focus}.play');
  log.length = 0;
  tik('KeyQ');
  ok('Q = play op de track in het linkervenster (1), loslaten naar dezelfde', log.join() === 'track.1.play=true,track.1.play=false');
  log.length = 0;
  tik('KeyP');
  ok('P = play op de rechterhand (2): {tweede}', log.join() === 'track.2.play=true,track.2.play=false');
  log.length = 0;
  druk('KeyA', { shiftKey: true }); druk('KeyA', {}, 'keyup');
  ok('shift+A = hotcue wissen; loslaten (shift al los) naar dezelfde action', log.join() === 'track.1.hotcue.1.delete=true,track.1.hotcue.1.delete=false');
  log.length = 0;
  tik('KeyW', { shiftKey: true });
  ok('shift+W = vorige sectie (SHIFT_TOETS)', log.join() === 'track.1.section.prev=true,track.1.section.prev=false');
  log.length = 0;
  druk('KeyQ'); druk('KeyQ', { repeat: true }); druk('KeyQ');
  ok('geen auto-repeat: één keer indrukken', log.join() === 'track.1.play=true');
  druk('KeyQ', {}, 'keyup');
  log.length = 0;
  druk('KeyQ', { target: { matches: () => true } }); druk('KeyA', { target: { matches: () => true } });
  ok('tijdens typen doet geen toets iets', log.length === 0);
  druk('KeyF', { metaKey: true }); druk('KeyQ', { ctrlKey: true }); druk('KeyA', { altKey: true });
  ok('Cmd+F start geen hotcue; Ctrl/Alt + toets bedient geen deck', log.length === 0);
  druk('KeyF', { metaKey: true }, 'keyup');
  druk('KeyZ', { metaKey: true });
  ok('Cmd+Z blijft code: grid terug van de focus-track', log.join() === 'track.1.grid.undo=true,track.1.grid.undo=false');
  log.length = 0;
  druk('Space');
  ok('spatie blijft code: play op de focus-track', log.join() === 'track.1.play=true');
  log.length = 0;
  druk('KeyQ');
  win.blur();
  ok('blur laat los', log.join() === 'track.1.play=true,track.1.play=false');
  log.length = 0;
  druk('KeyQ'); doc.visibilityState = 'hidden'; doc.visibilitychange(); doc.visibilityState = 'visible';
  ok('een verborgen tabblad laat los', log.join() === 'track.1.play=true,track.1.play=false');
  druk('KeyQ', {}, 'keyup');
}

console.log('\nkoppelen met een toets');
{
  log.length = 0;
  kb.learn.start('track.3.focus');
  druk('Escape');
  ok('Esc tijdens koppelen wordt geen toets (hij blijft code: koppelmodus stopt hem)', kb.learn.busy && !kb.mapping.rules.has('key:0:41'));
  druk('F2');
  ok('F2 indrukken tijdens koppelen: gekoppeld, en de toets deed niets', !kb.learn.busy && kb.mapping.rules.get(toetsSig('F2'))?.action === 'track.3.focus' && log.length === 0);
  druk('F2', {}, 'keyup');
  ok('… zijn loslaten gaat nergens heen', log.length === 0);
  tik('F2');
  ok('F2 doet nu wat je koppelde', log.join() === 'track.3.focus=true,track.3.focus=false');
  log.length = 0;
  kb.learn.start('track.4.focus');
  druk('KeyQ', { shiftKey: true }); druk('KeyQ', {}, 'keyup');
  ok('shift vast tijdens koppelen = een shift-regel (shift+Q), Q zelf blijft play', kb.mapping.rules.get(`${toetsSig('KeyQ')}#shift`)?.action === 'track.4.focus'
    && kb.mapping.rules.get(toetsSig('KeyQ'))?.action === 'track.{focus}.play' && log.length === 0);
  const v = kb.mapping.verschil();
  ok('het verschil met de standaard: precies de twee nieuwe regels', v?.device === 'toetsen' && v.rules.length === 2 && v.removed.length === 0);
  kb.learn.start('track.4.focus');
  druk('KeyQ', { target: { matches: () => true } });
  ok('tijdens typen wordt er ook niet gekoppeld', kb.learn.busy);
  kb.learn.stop();
}

console.log('\njouw toetsen als verschil (/api/mapping/toetsen)');
{
  const db = new Map();
  const antwoord = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
  const vragen = [];
  const haal = async (url, o = {}) => {
    vragen.push(`${o.method || 'GET'} ${url}`);
    const mm = /^\/api\/mapping(?:\/([\w-]+))?$/.exec(url);
    if (mm) {
      const sleutel = !mm[1] || mm[1] === 'apc40mk2' ? 'mapping' : `mapping:${mm[1]}`;
      if ((o.method || 'GET') === 'GET') return antwoord(200, { mapping: db.has(sleutel) ? JSON.parse(db.get(sleutel)) : null });
      const b = JSON.parse(o.body);
      db.set(sleutel, JSON.stringify(b.mapping));
      return antwoord(200, { ok: true });
    }
    const mb = /^mappings\/([\w-]+)\.json$/.exec(url);
    if (mb) { try { return antwoord(200, JSON.parse(readFileSync(new URL(`../mappings/${mb[1]}.json`, import.meta.url), 'utf8'))); } catch { return antwoord(404, {}); } }
    return antwoord(404, {});
  };
  ok('de plek van de toetsen: /api/mapping/toetsen en varve.mapping:toetsen', plekVan('toetsen').url === '/api/mapping/toetsen' && plekVan('toetsen').sleutel === 'varve.mapping:toetsen');
  const o = opzetMappingOpslag({ mapping: kb.mapping, apparaat: 'toetsen', haal, wacht: 0 });
  await o.start();
  ok('opstarten zonder eigen verschil: mappings/toetsen.json staat erop (de geleerde regels van hierboven zijn weg)',
    kb.mapping.rules.size === BESTAND.rules.length && !kb.mapping.rules.has(toetsSig('F2')) && vragen.includes('GET mappings/toetsen.json') && vragen.includes('GET /api/mapping/toetsen'));
  kb.learn.start('track.3.focus');
  druk('F2'); druk('F2', {}, 'keyup');
  await o.klaar();
  const bewaard = JSON.parse(db.get('mapping:toetsen') || 'null');
  ok('koppelen bewaart het verschil onder mapping:toetsen (niet onder de APC-sleutel)', bewaard?.kind === 'diff' && bewaard.rules.length === 1 && !db.has('mapping'));
  // Herladen: een nieuwe Mapping met dezelfde opslag.
  const m2 = new Mapping({ read: () => null, invoke: () => {} });
  const v2 = await laadEigen(m2, { haal, apparaat: 'toetsen' });
  ok('herladen: de standaard + jouw ene regel', v2.bron === 'server' && v2.eigen === 1 && m2.rules.get(toetsSig('F2'))?.action === 'track.3.focus' && m2.rules.size === BESTAND.rules.length + 1);
  // Een eigen regel op een toets die de standaard al heeft, wint.
  kb.learn.start('track.4.focus');
  druk('KeyQ'); druk('KeyQ', {}, 'keyup');
  log.length = 0;
  tik('KeyQ');
  ok('een eigen regel op Q wint van de standaard (play)', log.join() === 'track.4.focus=true,track.4.focus=false');
  await o.herstel();
  log.length = 0;
  tik('KeyQ');
  ok('"standaard herstellen" op de toetsen: Q is weer play, en de APC-sleutel is nooit geraakt', log.join() === 'track.1.play=true,track.1.play=false' && !db.has('mapping'));
}

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
