// De bovenbalk scrollt opzij als hij niet past (src/ui/bovenbalk.js, styles.css .topbar-right):
// tijdens het spelen worden "audio" en het log langer, en op 1440 px vielen rechts knoppen weg.
// In Chromium (in rust, tijdens het spelen, wiel, lampje): tools/headless/maschine-kaart.mjs.
// Draai met: node test/bovenbalk.test.mjs
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (naam, cond) => { if (!cond) fails.push(naam); console.log((cond ? '  ok  ' : 'FAIL  ') + naam); };
const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const { randen } = await import('../src/ui/bovenbalk.js');

console.log('randen: staat er links of rechts nog iets?');
ok('past alles: geen van beide', JSON.stringify(randen({ scrollLeft: 0, clientWidth: 1300, scrollWidth: 1300 })) === '{"minder":false,"meer":false}');
ok('te breed, aan het begin: rechts meer', JSON.stringify(randen({ scrollLeft: 0, clientWidth: 1300, scrollWidth: 1450 })) === '{"minder":false,"meer":true}');
ok('halverwege: beide', JSON.stringify(randen({ scrollLeft: 60, clientWidth: 1300, scrollWidth: 1450 })) === '{"minder":true,"meer":true}');
ok('helemaal rechts: links minder', JSON.stringify(randen({ scrollLeft: 150, clientWidth: 1300, scrollWidth: 1450 })) === '{"minder":true,"meer":false}');
ok('een halve pixel afronding telt niet', JSON.stringify(randen({ scrollLeft: 0.5, clientWidth: 1300, scrollWidth: 1300.5 })) === '{"minder":false,"meer":false}');

console.log('\nde CSS en de opzet');
const css = lees('../styles.css');
const regel = /\.topbar-right\{min-width:0;([^}]*)\}/.exec(css)?.[1] ?? '';
ok('het rechterdeel mag krimpen en scrollt opzij, niet omhoog', /overflow-x:auto/.test(regel) && /overflow-y:hidden/.test(regel));
ok('even veel ruimte erbij als eraf (de balk wordt niet hoger), genoeg voor het lampje (top:-3px)',
  /padding-block:4px/.test(regel) && /margin-block:-4px/.test(regel) && /#beeld-btn\[data-lamp\]::after\{[^}]*top:-3px/.test(css));
ok('geen schuifbalk (die maakt de balk hoger)', /scrollbar-width:none/.test(regel) && /\.topbar-right::-webkit-scrollbar\{display:none\}/.test(css));
ok('vervaging aan de kant waar meer staat', /\.topbar-right\.meer\{mask-image/.test(css) && /\.topbar-right\.minder\{mask-image/.test(css));
ok('de mixer zet hem op (app.js)', /import \{ opzetBovenbalk \} from '\.\/bovenbalk\.js'/.test(lees('../src/ui/app.js')) && /^opzetBovenbalk\(\);$/m.test(lees('../src/ui/app.js')));

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
