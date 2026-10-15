/**
 * De telling van de handelingenlogs (docs/HANDEN.md, docs/HANDELINGENLOG.md):
 * welke actions Clay's handen het vaakst doen. Puur: geen I/O, geen DOM, geen
 * engine. De CLI (tools/handen/handenkaart.mjs) leest de bestanden en geeft de
 * tekst hierheen; het setboek kan dezelfde code later hergebruiken.
 *
 * Herkomst: de normalisatie en de groepen komen letterlijk uit de telling van
 * 10 okt (scratchpad extra-2/klad/telling.mjs, 26 logs, 56.743 handelingen);
 * test/handen.test.mjs vergelijkt beide op een synthetisch log.
 *
 * Het log kent geen bron (MIDI, muis, toets): "op de APC" is altijd een
 * afleiding uit de aard van de actie, geen meting.
 */

/** `track.3.fx.knob.2` → `track.N.fx.knob.K`, `sampler.4.drums` → `sampler.N.drums`. */
export function normaliseer(actie) {
  return String(actie)
    .replace(/^track\.\d+\./, 'track.N.')
    .replace(/^sampler\.\d+\./, 'sampler.N.')
    .replace(/\.(\d+)$/, '.K')
    .replace(/\.knob\.\d+/, '.knob.K')
    .replace(/\.hotcue\.\d+/, '.hotcue.K')
    .replace(/\.section\.\d+/, '.section.K')
    .replace(/\.step\.\d+/, '.step.K')
    .replace(/\.pattern\.\d+/, '.pattern.K')
    .replace(/\.layer\.\d+/, '.layer.K');
}

/** De groep van een genormaliseerde action (de volgorde van de vragen telt: de eerste die past). */
export function groep(a) {
  if (a.startsWith('video.')) return 'video/vormen';
  if (a.startsWith('beeld.')) return 'beeld (Stroommachine)';
  if (a.startsWith('sampler.')) return 'sampler';
  if (a.startsWith('layer.')) return 'mapjes';
  if (a.includes('.fx.') || a.startsWith('fx.') || a.includes('send.')) return 'effecten/sends';
  if (a.includes('.stem.')) return 'stems';
  if (a.includes('.pattern') || a.startsWith('patterns.')) return 'patronen';
  if (a.includes('.inst')) return 'instrument';
  if (a.startsWith('klankschaal.')) return 'klankschaal';
  if (a.startsWith('master.')) return 'master';
  if (a.startsWith('auto.')) return 'auto-dj';
  if (a.startsWith('library.')) return 'library';
  if (a.startsWith('headphone.') || a.includes('.pfl')) return 'koptelefoon';
  if (a.startsWith('track.N.')) return 'track (transport/mixer)';
  return 'overig';
}

/** Een lege telling: `{ logs, regels, acties, per: Map(genormaliseerd → aantal), perLog: [[naam, n]] }`. */
export const legeTelling = () => ({ logs: 0, regels: 0, acties: 0, per: new Map(), perLog: [] });

/**
 * Tel één log (de tekst van een `.acties.jsonl`) erbij. Alleen regels die een
 * array zijn (`[t, action, waarde]`) tellen als handeling; kop- en standregels
 * (objecten) en kapotte regels tellen alleen als regel.
 */
export function telLog(telling, tekst, naam = null) {
  let n = 0;
  for (const regel of String(tekst).split('\n')) {
    if (!regel) continue;
    telling.regels++;
    let r;
    try { r = JSON.parse(regel); } catch { continue; }
    if (!Array.isArray(r)) continue;
    const a = normaliseer(r[1]);
    telling.per.set(a, (telling.per.get(a) || 0) + 1);
    n++;
    telling.acties++;
  }
  telling.logs++;
  telling.perLog.push([naam, n]);
  return telling;
}

/** De top-n, hoogste eerst; bij gelijke aantallen de volgorde waarin ze voor het eerst kwamen. */
export const top = (telling, n = 40) => [...telling.per.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** Per groep opgeteld, hoogste eerst. */
export function perGroep(telling) {
  const g = new Map();
  for (const [a, n] of top(telling, Infinity)) g.set(groep(a), (g.get(groep(a)) || 0) + n);
  return [...g.entries()].sort((a, b) => b[1] - a[1]);
}
