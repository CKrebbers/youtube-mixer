// De Node van de suite (test/node-versie.mjs, spoor C): .node-version is dezelfde als in de
// workflow, de waarschuwing noemt de bekende versiegevoelige checks, en test/alles.mjs zegt
// het alleen: hij slaat niets over en verandert de uitslag niet.
// Draai met: node test/node-versie.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name); };

const { versieWaarschuwing, verwachteNode, VERSIEGEVOELIG } = await import('./node-versie.mjs');
const WORTEL = fileURLToPath(new URL('..', import.meta.url));

const v = verwachteNode();
ok(`.node-version bestaat en is een exacte versie (${v})`, /^\d+\.\d+\.\d+$/.test(v || ''));
const wf = readFileSync(WORTEL + '.github/workflows/test.yml', 'utf8');
const wfVersie = /node-version:\s*'?([\d.]+)'?/.exec(wf)?.[1];
ok(`dezelfde Node als .github/workflows/test.yml (${wfVersie})`, wfVersie === v);
ok('dezelfde Node als docs/KEYLOCK.md noemt (26.8.2, de Mac)', v === '26.8.2');

ok('dezelfde versie → geen waarschuwing (met en zonder v)', versieWaarschuwing('v26.8.2', '26.8.2') === null && versieWaarschuwing('26.8.2', '26.8.2') === null);
ok('geen .node-version → geen waarschuwing', versieWaarschuwing('v22.22.0', null) === null);
const w = versieWaarschuwing('v22.22.0', '26.8.2');
ok('een andere versie → kop en staart met beide versies', !!w && w.kop.includes('v22.22.0') && w.kop.includes('26.8.2') && w.staart.includes('v22.22.0') && w.staart.includes('26.8.2'));
ok('de kop noemt elke bekende versiegevoelige check, en zegt dat er niets wordt overgeslagen', VERSIEGEVOELIG.every((r) => w.kop.includes(r)) && /niet overgeslagen/.test(w.kop));
ok('de staart noemt de bestanden', ['renderblok.test.mjs', 'instrumenten-fm-schaal.test.mjs', 'analyse.test.mjs en video.test.mjs'].every((f) => w.staart.includes(f)));
const genoemd = VERSIEGEVOELIG.flatMap((r) => r.split(':')[0].split(' en '));
ok(`elk genoemd bestand bestaat in test/ (${genoemd.join(', ')})`, genoemd.every((f) => existsSync(WORTEL + 'test/' + f.trim())));

// alles.mjs: de waarschuwing gaat alleen naar console.log; geen enkel ander gebruik.
const alles = readFileSync(WORTEL + 'test/alles.mjs', 'utf8');
const regels = alles.split('\n').filter((r) => /\bversie\b/.test(r) && !/^\s*\/\//.test(r));
ok(`alles.mjs gebruikt de waarschuwing alleen om te melden (${regels.length} regels)`, regels.length === 4
  && regels.every((r) => /^import \{ versieWaarschuwing \} from '\.\/node-versie\.mjs';$|^const versie = versieWaarschuwing\(\);$|^if \(versie\) console\.log\(/.test(r.trim())));

if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); }
console.log('\nalles groen');
