/**
 * Zet herhaalde runs van tools/bench/feedback.mjs naast elkaar: per meting de
 * MEDIAAN over de runs, vóór en na. De machine is vaak druk (andere processen):
 * één run zegt over de staart (p99, max) weinig, de mediaan van drie wel iets.
 *
 * Draai met:  node tools/bench/feedback-samen.mjs voor1.json,voor2.json,… na1.json,na2.json,…
 * Geeft een markdown-tabel.
 */
import { readFileSync } from 'node:fs';

const [voorA, naA] = process.argv.slice(2);
if (!voorA || !naA) { console.error('gebruik: feedback-samen.mjs voor1.json,voor2.json na1.json,na2.json'); process.exit(2); }
const lees = (lijst) => lijst.split(',').map((f) => JSON.parse(readFileSync(f, 'utf8')));
const voor = lees(voorA), na = lees(naA);
const mediaan = (xs) => { const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const rij = (naam, pad) => {
  const pak = (r) => pad.reduce((o, k) => (o == null ? o : o[k]), r);
  const v = mediaan(voor.map(pak)), n = mediaan(na.map(pak));
  console.log(`| ${naam} | ${v ?? '–'} | ${n ?? '–'} |`);
};
console.log(`runs: ${voor.length} vóór, ${na.length} na (mediaan per meting)\n`);
console.log('| meting | vóór | na |\n|---|---|---|');
for (let i = 0; i < (voor[0].tick?.length ?? 0); i++) {
  const s = voor[0].tick[i].stand;
  rij(`tik ${s}: p50 µs`, ['tick', i, 'p50_us']);
  rij(`tik ${s}: p99 µs`, ['tick', i, 'p99_us']);
  rij(`tik ${s}: berichten/s`, ['tick', i, 'berichten_per_s']);
}
for (const [deel, naam] of [['direct', 'direct'], ['kaatst', 'direct, APC kaatst ringen terug'], ['hub', 'via de hub']]) {
  rij(`${naam}: druk -> lampje p50 ms`, [deel, 'p50_ms']);
  rij(`${naam}: druk -> lampje p99 ms`, [deel, 'p99_ms']);
  rij(`${naam}: druk -> lampje max ms`, [deel, 'max_ms']);
  rij(`${naam}: ingeslikt (druk of los, van ~${voor[0][deel]?.drukken ?? '?'} knoppen × 2)`, [deel, 'ingeslikt']);
  if (deel !== 'hub') {
    rij(`${naam}: echo's die de mapping bereikten`, [deel, 'echo_door']);
    rij(`${naam}: mapje wisselen, laatste lampje p50 ms`, [deel, 'mapje_p50_ms']);
    rij(`${naam}: mapje wisselen, laatste lampje max ms`, [deel, 'mapje_max_ms']);
    rij(`${naam}: wachtrij MidiHub max tijdens spelen`, [deel, 'wachtrij_max']);
    rij(`${naam}: wachtrij MidiHub max bij een mapje`, [deel, 'wachtrij_max_mapje']);
    rij(`${naam}: berichten/s naar de APC`, [deel, 'berichten_per_s']);
  } else rij(`${naam}: led-bundels/s naar de hub`, [deel, 'led_berichten_per_s']);
}
for (const [k, naam] of [['tik_p50_us', 'Maschine tik p50 µs'], ['tik_p99_us', 'Maschine tik p99 µs'], ['stand_per_s', 'Maschine stand() per s'],
  ['schermen_per_s', 'Maschine schermen per s'], ['pad_lampje_p50_ms', 'Maschine pad -> lampje p50 ms'], ['pad_lampje_p99_ms', 'Maschine pad -> lampje p99 ms'],
  ['knop_scherm_p50_ms', 'Maschine draaien -> scherm p50 ms'], ['knop_scherm_p99_ms', 'Maschine draaien -> scherm p99 ms'], ['rij_max', 'Maschine wachtrij hub.js max'],
  ['stand_json_p50_us', 'Maschine stand()+JSON p50 µs'], ['twee_schermen_p50_us', 'Maschine twee schermen tekenen p50 µs']]) rij(naam, ['maschine', k]);
