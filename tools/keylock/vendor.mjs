#!/usr/bin/env node
// @ts-check
/**
 * Maakt src/engine/vendor/signalsmith-stretch.js uit het npm-pakket
 * signalsmith-stretch@1.3.2 (docs/KEYLOCK.md §1, keylock gebouwd 5 okt).
 *
 * Waarom niet het pakket zelf: importeer je SignalsmithStretch.mjs in een
 * worklet, dan ziet het `registerProcessor`, registreert het ZIJN processor
 * en exporteert `{}`; de WASM-fabriek zit dan onbereikbaar in een closure.
 * Dus: alleen de Emscripten-fabriek eruit knippen (zoals laadFabriek in
 * kern.mjs) en als ES-module exporteren. `process`, `require`, `window` en
 * `document` zijn binnen de fabriek verborgen, zodat Emscripten zich overal
 * gedraagt zoals in een AudioWorkletGlobalScope ("shell": de WASM uit de
 * data-URI), ook in de tests onder Node.
 *
 * Het pakket heeft geen LICENSE-bestand; MIT eist dat de tekst meegaat. Die
 * staat hieronder, uit de bronrepo van de auteur
 * (github.com/Signalsmith-Audio/signalsmith-stretch, LICENSE.txt, 5 okt 2026).
 *
 * Gebruik:  node tools/keylock/vendor.mjs [pad/naar/signalsmith-stretch-1.3.2.tgz]
 * Zonder pad: tools/keylock/pakket/ (eerst `node tools/keylock/proef.mjs haal`).
 * De tarball wordt gecontroleerd tegen de integriteit uit het npm-register.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { controleerTarball, VERSIE, INTEGRITEIT, PAKKET_MAP, HIER } from './kern.mjs';

const LICENTIE = `MIT License

Copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// Hier houdt de Emscripten-fabriek op en begint de schil van Signalsmith (zoals in kern.mjs).
const GRENS = "if (typeof exports === 'object' && typeof module === 'object')";
const UIT = path.join(HIER, '..', '..', 'src', 'engine', 'vendor', 'signalsmith-stretch.js');

const tgz = process.argv[2] || path.join(PAKKET_MAP, `signalsmith-stretch-${VERSIE}.tgz`);
if (!fs.existsSync(tgz)) {
  console.error(`${tgz} ontbreekt. Eerst: node tools/keylock/proef.mjs haal (of geef het pad mee)`);
  process.exit(1);
}
controleerTarball(tgz);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signalsmith-'));
try {
  execFileSync('tar', ['-xzf', tgz, '-C', tmp, 'package/SignalsmithStretch.mjs']);
  const src = fs.readFileSync(path.join(tmp, 'package', 'SignalsmithStretch.mjs'), 'utf8');
  const eind = src.indexOf(GRENS);
  if (eind < 0) throw new Error('onverwachte opbouw van SignalsmithStretch.mjs (grens niet gevonden)');
  const fabriek = src.slice(0, eind).trimEnd();
  if (!/var SignalsmithStretch = /.test(fabriek)) throw new Error('onverwachte opbouw: geen "var SignalsmithStretch"');
  const kop = [
    '/*',
    ` * Signalsmith Stretch ${VERSIE}: alleen de Emscripten-fabriek (WASM + glue) uit het`,
    ` * npm-pakket signalsmith-stretch@${VERSIE} (${INTEGRITEIT}).`,
    ' * Gemaakt met tools/keylock/vendor.mjs: niet met de hand bewerken.',
    ' * Gebruik: `const M = await fabriek()` geeft één stretcher (docs/KEYLOCK.md §1).',
    ' *',
    ...LICENTIE.split('\n').map((r) => (r ? ` * ${r}` : ' *')),
    ' */',
    '// @ts-nocheck',
    '/* eslint-disable */',
    'const fabriek = ((process, require, window, document) => {',
  ].join('\n');
  const uit = `${kop}\n${fabriek}\nreturn SignalsmithStretch;\n})(undefined, undefined, undefined, undefined);\nexport default fabriek;\n`;
  fs.mkdirSync(path.dirname(UIT), { recursive: true });
  fs.writeFileSync(UIT, uit);
  console.log(`${path.relative(process.cwd(), UIT)}: ${(uit.length / 1024).toFixed(1)} KB`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
