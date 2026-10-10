// Een opstelling (stand) activeren zonder browser (docs/STANDEN.md):
//
//   node tools/standen/activeer.mjs                 de lijst, en welke actief is
//   node tools/standen/activeer.mjs apc             apc activeren, het verslag afdrukken
//   node tools/standen/activeer.mjs --terug         de vorige mapping en nacht-rem terugzetten
//   … --poort 8821                                  een andere server (standaard 8777)
//
// Praat alleen met de server (POST /api/standen/<naam>/activeer); de mixer herlaadt
// nooit vanzelf. Eindigt met code 1 bij een onbekende stand, een fout van de server
// of een fout in het verslag (waarschuwingen alleen: code 0).
const args = process.argv.slice(2);
const i = args.indexOf('--poort');
const poort = i >= 0 ? Number(args[i + 1]) : 8777;
if (i >= 0) args.splice(i, 2);
if (!Number.isInteger(poort) || poort < 1 || poort > 65535) { console.error('--poort is een getal (1..65535)'); process.exit(2); }
const B = `http://localhost:${poort}`;
const naam = args[0];

async function vraag(pad, post = false) {
  let r;
  try {
    r = await fetch(`${B}${pad}`, post ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } : {});
  } catch (err) {
    console.error(`geen server op ${B} (${err.cause?.code ?? err.message}): start hem eerst (VARVE.app of node server/index.js)`);
    process.exit(1);
  }
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

const lijst = (x) => (x?.length ? x.join(', ') : '—');

if (!naam) {
  const { status, d } = await vraag('/api/standen');
  if (status !== 200) { console.error(`GET /api/standen: ${status} ${d.fout ?? ''}`); process.exit(1); }
  for (const s of d.standen) console.log(`${s.naam === d.actief?.naam ? '●' : ' '} ${s.naam.padEnd(16)} ${s.titel}${s.bron === 'eigen' ? '' : '  (voorbeeld)'}${s.fouten ? `  ${s.fouten} fout(en)` : ''}`);
  console.log(d.actief?.naam ? `\nactief: ${d.actief.naam} sinds ${d.actief.sinds}` : d.actief?.teruggezet ? `\nniets actief (vorige teruggezet ${d.actief.teruggezet})` : '\nniets actief');
  process.exit(0);
}

if (naam === '--terug') {
  const { status, d } = await vraag('/api/standen/terug', true);
  if (status !== 200) { console.error(`terugzetten: ${status} ${d.fout ?? ''}`); process.exit(1); }
  console.log(`vorige teruggezet (van ${d.uit}): ${lijst(d.delen)}`);
  for (const f of d.fouten ?? []) console.error(`  fout  ${f.deel}: ${f.fout}`);
  process.exit(d.fouten?.length ? 1 : 0);
}

const { status, d } = await vraag(`/api/standen/${encodeURIComponent(naam)}/activeer`, true);
if (status !== 200) { console.error(`${naam}: ${status} ${d.fout ?? ''}`); for (const f of d.fouten ?? []) console.error(`  ${f.deel ?? 'stand'}: ${f.fout}`); process.exit(1); }
const v = d.verslag;
console.log(`${d.naam} actief sinds ${d.sinds}`);
console.log(`  toegepast:     ${lijst(v.toegepast)}`);
console.log(`  nagekeken:     ${lijst(v.gecontroleerd)}`);
console.log(`  voor de mixer: ${lijst(v.mixer)}${v.mixer?.length ? ' (de mixer volgt nog niet: stap M)' : ''}`);
console.log(`  genoemd:       ${lijst(v.genoemd)}`);
for (const o of v.overgeslagen ?? []) console.log(`  overgeslagen  ${o.deel}: ${o.reden}`);
for (const w of v.waarschuwingen ?? []) console.log(`  let op        ${w}`);
for (const f of v.fouten ?? []) console.error(`  fout          ${f.deel ?? 'stand'}: ${f.fout}`);
process.exit(v.fouten?.length ? 1 : 0);
