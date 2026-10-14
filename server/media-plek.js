import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

/**
 * Waar media/ staat (VI2, 11 okt): de mediamap mag buiten de projectmap en
 * buiten iCloud staan. Vier kleine dingen, puur genoeg om te testen:
 *
 * - isTestserver: VARVE_TESTSERVER=1 is "dit is een testserver" (tellen en
 *   stems uit tenzij een nep- of echte commando gezet is). Tot 11 okt las de
 *   server dat af aan VARVE_MEDIA; die betekent nu alleen nog "de mediamap".
 * - iCloudReden: ligt een pad binnen iCloud, en waarom (of null).
 * - verhuisdNaar: het pad uit media-VERHUISD.txt, dat tools/media-verhuis.mjs
 *   achterlaat waar media/ stond.
 * - kiesMedia: VARVE_MEDIA, anders <wortel>/media, anders (als die er niet
 *   meer is) het pad uit media-VERHUISD.txt. Zo begint een server die zonder
 *   VARVE_MEDIA start na de verhuizing niet aan een lege library.
 */

export const VERHUISD_BESTAND = 'media-VERHUISD.txt';

/** Een testserver: alleen met VARVE_TESTSERVER=1, nooit afgeleid uit VARVE_MEDIA. */
export const isTestserver = (env = process.env) => env.VARVE_TESTSERVER === '1';

/**
 * Het echte pad (symlinks opgelost), ook als het (nog) niet bestaat: de
 * dichtstbijzijnde map die wel bestaat wordt opgelost, de rest erachter
 * geplakt. Op macOS is /tmp bijv. /private/tmp.
 */
export function echtPad(pad) {
  let p = resolve(pad);
  const rest = [];
  for (;;) {
    try { return join(realpathSync(p), ...rest.reverse()); } catch (_) { /* hoger kijken */ }
    const boven = dirname(p);
    if (boven === p) return resolve(pad);
    rest.push(basename(p));
    p = boven;
  }
}

const binnen = (pad, map) => pad === map || pad.startsWith(map.endsWith(sep) ? map : map + sep);

/**
 * Ligt `pad` binnen iCloud? Een korte reden, of null.
 * - alles onder ~/Library/Mobile Documents (iCloud Drive zelf);
 * - ~/Desktop of ~/Documents als "Bureaublad- en Documentenmappen" in iCloud
 *   aan staat. Dat zie je aan ~/Library/Mobile Documents/com~apple~CloudDocs/
 *   Desktop (resp. Documents): die bestaat dan (op Clay's Mac een symlink
 *   naar ~/Desktop).
 * @param {string} pad
 * @param {{ thuis?: string, bestaat?: (p: string) => boolean }} [o]
 */
export function iCloudReden(pad, { thuis = homedir(), bestaat = existsSync } = {}) {
  const abs = echtPad(pad);
  const mobiel = join(thuis, 'Library', 'Mobile Documents');
  if (binnen(abs, echtPad(mobiel))) return 'iCloud Drive (~/Library/Mobile Documents)';
  for (const naam of ['Desktop', 'Documents']) {
    if (binnen(abs, echtPad(join(thuis, naam))) && bestaat(join(mobiel, 'com~apple~CloudDocs', naam))) {
      return `~/${naam} staat in iCloud ("Bureaublad- en Documentenmappen" in iCloud aan)`;
    }
  }
  return null;
}

/**
 * Het nieuwe pad uit <wortel>/media-VERHUISD.txt (de regel VARVE_MEDIA=…), of
 * null als dat bestand er niet is of geen bruikbaar pad noemt.
 */
export function verhuisdNaar(wortel, { lees = (p) => readFileSync(p, 'utf8') } = {}) {
  let tekst;
  try { tekst = lees(join(wortel, VERHUISD_BESTAND)); } catch (_) { return null; }
  const m = /^\s*(?:export\s+)?VARVE_MEDIA=("?)(\/[^"\n]+)\1\s*$/m.exec(String(tekst));
  return m ? m[2].trim() : null;
}

/** De tekst van media-VERHUISD.txt. */
export function verhuisdTekst({ bron, doel, wanneer = new Date() }) {
  return [
    `media/ is op ${wanneer.toISOString()} verhuisd door tools/media-verhuis.mjs (VI2).`,
    `Van:  ${bron}`,
    `Naar: ${doel}`,
    '',
    'Er is niets gewist: de map is hernoemd (zelfde schijf). De server leest deze',
    'regel als VARVE_MEDIA niet gezet is en media/ hier niet meer bestaat:',
    '',
    `VARVE_MEDIA=${doel}`,
    '',
  ].join('\n');
}

/**
 * Welke mediamap de server gebruikt, en waarom.
 * @param {{ env?: Record<string, string|undefined>, wortel: string, bestaat?: (p: string) => boolean,
 *   lees?: (p: string) => string }} o
 * @returns {{ map: string, bron: 'VARVE_MEDIA'|'standaard'|'media-VERHUISD.txt' }}
 */
export function kiesMedia({ env = process.env, wortel, bestaat = existsSync, lees }) {
  if (env.VARVE_MEDIA) return { map: env.VARVE_MEDIA, bron: 'VARVE_MEDIA' };
  const standaard = join(wortel, 'media');
  // Een testserver volgt het briefje nooit: die mag nooit bij de echte media komen.
  if (!isTestserver(env) && !bestaat(standaard)) {
    const nieuw = verhuisdNaar(wortel, lees ? { lees } : undefined);
    if (nieuw) return { map: nieuw, bron: VERHUISD_BESTAND };
  }
  return { map: standaard, bron: 'standaard' };
}
