// De Node van de suite (spoor C, arch/linux; docs/WINST.md punt 8, stap 2). Geen test zelf:
// test/alles.mjs zegt hiermee bovenaan en onderaan dat de Node afwijkt van .node-version,
// en test/node-versie.test.mjs toetst het.
//
// Clay's Mac (en .github/workflows/test.yml) draait de Node uit .node-version. Een andere
// Node (de Omarchy-pc, een container) heeft een andere V8, en daar vallen afvalmetingen
// anders uit. Alleen ZEGGEN: niets wordt overgeslagen en de uitslag blijft wat hij is.
// Een check waarvan bekend is dat hij op een andere V8 anders uitvalt: zet hem hier.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const VERSIEGEVOELIG = Object.freeze([
  'renderblok.test.mjs: "keylock: afval" (de grens is geijkt op de V8 van Node 26)',
  'instrumenten-fm-schaal.test.mjs: de afvalmeting van de worklets (GCProfiler; wisselt)',
  'analyse.test.mjs en video.test.mjs: afval per beeld via v8 total_allocated_bytes (bestaat niet in elke Node: dan "--")',
]);

/** De versie uit .node-version in de projectmap ("26.8.2"), of null. */
export function verwachteNode(pad = fileURLToPath(new URL('../.node-version', import.meta.url))) {
  try { return readFileSync(pad, 'utf8').trim().replace(/^v/, '') || null; } catch (_) { return null; }
}

/**
 * De waarschuwing als `versie` (process.version) niet `verwacht` is, anders null.
 * @returns {{ kop: string, staart: string } | null}
 */
export function versieWaarschuwing(versie = process.version, verwacht = verwachteNode()) {
  const v = String(versie || '').replace(/^v/, '');
  if (!verwacht || v === verwacht) return null;
  return {
    kop: `LET OP: Node v${v}, .node-version zegt ${verwacht}. Op een andere V8 vallen deze checks anders uit (niet overgeslagen, de uitslag telt):\n${VERSIEGEVOELIG.map((r) => `  - ${r}`).join('\n')}\n`,
    staart: `LET OP: Node v${v} in plaats van ${verwacht} (.node-version): rood in ${VERSIEGEVOELIG.map((r) => r.split(':')[0]).join(', ')} kan van de V8 komen.`,
  };
}
