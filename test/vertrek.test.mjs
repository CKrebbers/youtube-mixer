// Eerst vragen voordat de mixer weggaat (src/ui/vertrek.js, docs/WINST.md punt 6).
// Draai met: node test/vertrek.test.mjs
import { readFileSync } from 'node:fs';
import { waaromBlijven, bewaakVertrek } from '../src/ui/vertrek.js';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

// ---- waaromBlijven: puur ------------------------------------------------------
const stil = { playing: false, wacht: false, laadt: false };
ok('niets aan de hand: mag weg', waaromBlijven({ decks: [stil, stil, null] }) === null);
ok('zonder argumenten: mag weg', waaromBlijven() === null);
ok('een track speelt: blijven', /speelt/.test(waaromBlijven({ decks: [stil, { ...stil, playing: true }] })));
ok('een track wacht op de maat: blijven', /wacht/.test(waaromBlijven({ decks: [{ ...stil, wacht: true }] })));
ok('een track laadt: blijven', /geladen/.test(waaromBlijven({ decks: [{ ...stil, laadt: true }] })));
ok('de auto-DJ staat aan (ook met stille decks): blijven', /auto-DJ/.test(waaromBlijven({ decks: [stil], auto: true })));
ok('er loopt een opname: blijven', /opname/.test(waaromBlijven({ decks: [stil], opname: true })));

// ---- bewaakVertrek: de handler op een nep-window -----------------------------
const doel = { h: {}, addEventListener(t, f) { this.h[t] = f; } };
let stand = { decks: [stil] };
bewaakVertrek(() => stand, doel);
const vuur = () => { const e = { voorkomen: false, returnValue: undefined, preventDefault() { this.voorkomen = true; } }; doel.h.beforeunload(e); return e; };
ok('hangt aan beforeunload', typeof doel.h.beforeunload === 'function');
let e = vuur();
ok('stil: Chrome vraagt niets', !e.voorkomen && e.returnValue === undefined);
stand = { decks: [{ ...stil, playing: true }] };
e = vuur();
ok('speelt: preventDefault en returnValue (Chrome vraagt het)', e.voorkomen && e.returnValue === '');
stand = null;
let gooit = false;
bewaakVertrek(() => { throw new Error('kapot'); }, doel);
try { e = vuur(); } catch (_) { gooit = true; }
ok('een lees() die gooit houdt de pagina niet vast', !gooit && !e.voorkomen);

// ---- de echte namen: Deck heeft playing, wacht en laadt, app.js geeft ze door --
const { Deck } = await import('../src/engine/deck.js');
for (const naam of ['playing', 'wacht', 'laadt']) ok(`Deck heeft een getter ${naam}`, typeof Object.getOwnPropertyDescriptor(Deck.prototype, naam)?.get === 'function');
const app = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
ok('app.js zet bewaakVertrek aan met alle decks, de auto-DJ en de opname',
  /bewaakVertrek\(\(\) => \(\{ decks: DECK_IDS\.map\(\(id\) => engine\.deck\(id\)\), auto: auto\.aan, opname: !!opname\.opnemer\.bezig \}\)\)/.test(app));
const knop = readFileSync(new URL('../src/ui/opname-knop.js', import.meta.url), 'utf8');
ok('één plek: opname-knop.js hangt zelf geen beforeunload meer', !/addEventListener\('beforeunload'/.test(knop));

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
