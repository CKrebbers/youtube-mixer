// Voegt de oogst (v2/oogst/*.json) en de telling (v2/telling/nu.json) samen tot
// v2/pagina/kaartjes.json, het enige bestand dat de beslispagina leest.
// Draaien: node v2/bouw-kaartjes.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const oogstMap = join(hier, 'oogst');
const uit = join(hier, 'pagina', 'kaartjes.json');

const VOLGORDE = ['richting', 'audio-kern', 'muziekkennis', 'dj-workflow', 'produceren', 'bediening', 'beeld', 'systeem'];

const onderwerpen = [];
const ids = new Set();
for (const naam of readdirSync(oogstMap).filter((n) => n.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(join(oogstMap, naam), 'utf8'));
  const kaartjes = (d.kaartjes ?? []).map((k) => {
    if (ids.has(k.id)) throw new Error(`dubbel id ${k.id} in ${naam}`);
    ids.add(k.id);
    return {
      id: k.id, titel: k.titel, soort: k.soort, wat: k.wat, waarom: k.waarom ?? '',
      bron: k.bron ?? [], code: k.code ?? [], pijler: k.pijler, gewicht: k.gewicht,
      voorstel: k.voorstel, reden: k.reden ?? '',
    };
  });
  onderwerpen.push({
    onderwerp: d.onderwerp ?? naam.replace(/\.json$/, ''),
    samenvatting: d.samenvatting ?? '',
    tijdlijn: d.tijdlijn ?? [],
    onderdelen: d.onderdelen ?? [],
    kaartjes,
  });
}
onderwerpen.sort((a, b) => {
  const ia = VOLGORDE.indexOf(a.onderwerp), ib = VOLGORDE.indexOf(b.onderwerp);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

// De telling in de vorm van de pagina: conclusies uit nu.md (de genummerde lijst), staven uit nu.json.
const tellingPad = join(hier, 'telling', 'nu.json');
let telling = null;
if (existsSync(tellingPad)) {
  const t = JSON.parse(readFileSync(tellingPad, 'utf8'));
  const md = readFileSync(join(hier, 'telling', 'nu.md'), 'utf8');
  const blok = md.split(/^## Conclusies voor v2\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const conclusies = blok.split(/\n(?=\d+\. )/).map((s) => s.replace(/^\d+\.\s*/, '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  telling = {
    bron: `${t.logs.aantal} handelingenlogs van ${t.logs.eerste} t/m ${t.logs.laatste}, ${t.logs.handelingen.toLocaleString('nl-NL')} handelingen; ${t.register.ruw} actions in het register. Opnieuw tellen op de Mac: v2/telling/LEESMIJ.md.`,
    conclusies,
    groepen: t.groepen.map((g) => ({ naam: g.groep, aantal: g.handelingen })).sort((a, b) => b.aantal - a.aantal),
    top: t.top40.map((r) => ({ naam: r.actie, aantal: r.aantal })),
    grenzen: t.grens,
  };
}

// Clay's eigen woorden (WENSEN.md): elk punt `- **datum** — tekst`, over meer regels.
const wensenPad = join(hier, 'WENSEN.md');
const wensen = existsSync(wensenPad)
  ? readFileSync(wensenPad, 'utf8').split(/\n(?=- \*\*)/).filter((s) => s.startsWith('- **')).map((s) => {
    const m = s.match(/^- \*\*(.+?)\*\*\s*—\s*([\s\S]*)$/);
    return m ? { datum: m[1], tekst: m[2].replace(/\s+/g, ' ').trim() } : null;
  }).filter(Boolean)
  : [];

// Het ontwerp: v2/ontwerp/*.json, één per onderdeel, op volgorde van `nr`.
const ontwerpMap = join(hier, 'ontwerp');
const ontwerp = existsSync(ontwerpMap)
  ? readdirSync(ontwerpMap).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(ontwerpMap, n), 'utf8'))).sort((a, b) => a.nr - b.nr)
  : [];
for (const o of ontwerp) {
  for (const x of [...o.besluiten, ...o.scenarios, ...o.open]) {
    if (ids.has(x.id)) throw new Error(`dubbel id ${x.id} in ontwerp ${o.id}`);
    ids.add(x.id);
  }
}

mkdirSync(dirname(uit), { recursive: true });
writeFileSync(uit, JSON.stringify({ gemaakt: new Date().toISOString(), wensen, ontwerp, onderwerpen, telling }));
console.log(`${onderwerpen.length} onderwerpen, ${ids.size} kaartjes -> ${uit}`);
