// VARVE.app start de hub alleen als de opstelling "mixer via de hub" zegt (VRAGEN AR21, 16 okt):
// tools/varve-app/hub-nodig.mjs (dezelfde regel als de knop "mixer openen") en de AppleScript eromheen.
// Draai met: node test/hub-nodig.test.mjs
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hubNodig, vraag } from '../tools/varve-app/hub-nodig.mjs';
import { mixerAdres, MIXER_VIA_HUB } from '../src/controle/stand-tegel.js';

const fails = [];
const ok = (name, cond, extra = '') => { if (!cond) fails.push(name); console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond || !extra ? '' : `\n      ${extra}`)); };
const wortel = fileURLToPath(new URL('..', import.meta.url));
const voorbeeld = (n) => JSON.parse(readFileSync(wortel + `tools/standen/voorbeelden/${n}.json`, 'utf8'));

// ---- de regel: dezelfde als mixerAdres ------------------------------------------------------
ok('geen opstelling actief: nee geen', hubNodig({ naam: null }) === 'nee geen' && hubNodig(null) === 'nee geen');
ok('Avond 1 · APC direct (apc, zonder hub-deel): nee apc', hubNodig({ naam: 'apc', ...voorbeeld('apc').delen }) === 'nee apc');
ok('Avond 2 · Maschine (hub.mixerVia true): ja', hubNodig({ naam: 'maschine', ...voorbeeld('maschine').delen }) === 'ja');
ok('alles (hub.mixerVia true): ja', hubNodig({ naam: 'alles', ...voorbeeld('alles').delen }) === 'ja');
ok('hub-set zonder mixerVia, of mixerVia "ja" (geen boolean): nee',
  hubNodig({ naam: 'x', hub: { set: 'studio' } }) === 'nee x' && hubNodig({ naam: 'x', hub: { mixerVia: 'ja' } }) === 'nee x');
ok('teruggezet (naam null) met nog een hub-deel: nee', hubNodig({ naam: null, teruggezet: true, hub: { mixerVia: true } }) === 'nee geen');
for (const a of [{ naam: 'm', hub: { mixerVia: true } }, { naam: 'm', hub: { mixerVia: false } }, { naam: null, hub: { mixerVia: true } }, {}]) {
  ok(`zelfde uitkomst als de knop mixer openen: ${JSON.stringify(a)}`, (hubNodig(a) === 'ja') === (mixerAdres(a) === MIXER_VIA_HUB));
}

// ---- vragen aan een server (een nep op een eigen poort) -------------------------------------
let antwoord = { code: 200, body: '{"naam":"maschine","hub":{"set":"studio","mixerVia":true}}' };
let paden = [];
const server = createServer((req, res) => {
  paden.push(req.url);
  if (antwoord.hang) return;
  res.writeHead(antwoord.code, { 'Content-Type': 'application/json' });
  res.end(antwoord.body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const poort = server.address().port;
const haal = (url, o) => fetch(url.replace('localhost', '127.0.0.1'), o);

ok('via de hub: ja, en hij vraagt /api/standen/actief', (await vraag({ poort, haal })) === 'ja' && paden.at(-1) === '/api/standen/actief');
antwoord = { code: 200, body: '{"naam":null}' };
ok('niets actief: nee geen', (await vraag({ poort, haal })) === 'nee geen');
antwoord = { code: 200, body: JSON.stringify({ naam: 'apc', ...voorbeeld('apc').delen }) };
ok('apc: nee apc', (await vraag({ poort, haal })) === 'nee apc');
antwoord = { code: 503, body: '{"fout":"niet te lezen"}' };
ok('503 (iCloud, de grens vol): onbekend, met de code', (await vraag({ poort, haal })) === 'onbekend de server gaf 503');
antwoord = { code: 200, body: 'kapot' };
ok('geen JSON: onbekend', (await vraag({ poort, haal })).startsWith('onbekend '));
antwoord = { hang: true };
ok('geen antwoord binnen de tijd: onbekend', (await vraag({ poort, haal, ms: 200 })) === 'onbekend geen antwoord binnen 0.2 s');
server.closeAllConnections?.();
await new Promise((r) => server.close(r));
ok('geen server: onbekend de server antwoordt niet', (await vraag({ poort, haal })) === 'onbekend de server antwoordt niet');

// ---- als programma: één regel, altijd exit 0 (ook met een pad met spaties, zoals op de Mac) ----
const r = spawnSync(process.execPath, [wortel + 'tools/varve-app/hub-nodig.mjs', '--poort', String(poort)], { encoding: 'utf8', timeout: 20000 });
ok('als programma: exit 0 en één regel "onbekend …"', r.status === 0 && /^onbekend .+\n$/.test(r.stdout), `${r.status} ${r.stdout} ${r.stderr}`);

// ---- de AppleScript: vraagt eerst, start pas bij ja, en haalt ?hub= weg zonder hub ------------
const as = readFileSync(wortel + 'tools/varve-app/VARVE.applescript', 'utf8');
const zorg = /on zorgVoorHub\(\)[\s\S]*?end zorgVoorHub/.exec(as)?.[0] ?? '';
const gewenst = /on hubGewenst\(\)[\s\S]*?end hubGewenst/.exec(as)?.[0] ?? '';
const toon = /on toonControlekamer\(hub\)[\s\S]*?end toonControlekamer/.exec(as)?.[0] ?? '';
ok('zorgVoorHub vraagt hubGewenst vóór het starten (npm start), en geeft false zonder "ja"',
  zorg.indexOf('my hubGewenst()') > 0 && zorg.indexOf('my hubGewenst()') < zorg.indexOf('npm start')
  && /if wens is not "ja" then[\s\S]*?return false\s*end if/.test(zorg));
ok('een hub die al draait zonder "via de hub": melding, niet stoppen (geen kill in de app)',
  /De hub draait al, maar de opstelling zegt niet via de hub/.test(zorg) && !/kill/.test(zorg));
ok('hubGewenst draait het script via zsh -l in de projectmap, fout = onbekend',
  /zsh -lc/.test(gewenst) && /node tools\/varve-app\/hub-nodig\.mjs --poort/.test(gewenst) && /return "onbekend /.test(gewenst));
ok('toonControlekamer: een open Controlekamer krijgt ?hub= erbij of eraf, naar wat de opstelling zegt',
  /set heeftHub to [\s\S]*contains "hub="/.test(toon) && /if hub is not heeftHub then set URL of tab i of w to adres/.test(toon));

console.log(fails.length ? `\n${fails.length} FOUT(EN): ${fails.join(', ')}` : '\nAlle checks groen.');
process.exit(fails.length ? 1 : 0);
