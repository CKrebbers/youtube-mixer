// "Het grid moet passen per stuk": analyseerGrid vóór (12776ba) tegen nu, op FRAGMENTEN.
//   node tools/beatmeting/rest/gridpast.mjs [id:van:duur[:nul] ...]   (zonder: de vaste lijst)
// Per stuk: bpm, zekerheid (* = zeker), en de fase van de puls per 12 s t.o.v. het grid
// (ms, blokken met R > 0,15). "!" = dat blok ligt meer dan 0,15 tel van de fase waar de
// meeste blokken liggen (een vaste afwijking is een anker-kwestie, geen grid dat niet past);
// ZEKER! = een zeker stuk met zo'n blok: daar vertrouwen sync en beat-loops een grid dat
// naast de muziek ligt. Nul voor het album: 18/22 (zie fragment.mjs).
import { d, detectVan, envelopeFragment, fmt } from './lib.mjs';

const oud = await detectVan('12776ba');
const A = '0.8181818';
const LIJST = [
  // fragment.txt
  `f3a7DiCsm8k:60:270:${A}`, `f3a7DiCsm8k:600:270:${A}`, `f3a7DiCsm8k:880:240:${A}`, `f3a7DiCsm8k:1080:240:${A}`,
  `f3a7DiCsm8k:1380:180:${A}`, 'HGv_ySHXtYI:0:214', 'CVeYI-gmX00:860:120', 'CVeYI-gmX00:1850:140',
  'mOzW9KQKfzA:1600:250', 'mOzW9KQKfzA:2050:250', 'mOzW9KQKfzA:2500:200',
  '_x5K5Ihutbw:60:270', '_x5K5Ihutbw:700:240', '_x5K5Ihutbw:1380:240',
  // de controle van de tweede kans
  `f3a7DiCsm8k:320:270:${A}`, `f3a7DiCsm8k:1680:240:${A}`, 'mOzW9KQKfzA:0:270', 'mOzW9KQKfzA:1830:270', '1W1-nPXEVKk:600:270',
  // andere plekken in de mixen, en de korte nummers
  '_x5K5Ihutbw:1000:240', '_x5K5Ihutbw:2000:240', '_x5K5Ihutbw:2700:240', 'CVeYI-gmX00:300:240', 'CVeYI-gmX00:1200:240',
  'mOzW9KQKfzA:600:240', 'mOzW9KQKfzA:1200:240', 'mOzW9KQKfzA:3000:240', '1W1-nPXEVKk:1800:240', `f3a7DiCsm8k:1500:180:${A}`,
  'lokaal-099183d8a81b:0:104', 'lokaal-34c123f373bc:0:116', 'lokaal-5fd670457996:0:270', 'tiktok-7031697544472251694:0:79',
  '_x5K5Ihutbw:1600:240', '_x5K5Ihutbw:2300:240', '_x5K5Ihutbw:2940:240', '_x5K5Ihutbw:400:240',
  `f3a7DiCsm8k:0:240:${A}`, `f3a7DiCsm8k:1200:240:${A}`, `f3a7DiCsm8k:1800:60:${A}`,
  'CVeYI-gmX00:0:240', 'CVeYI-gmX00:600:240', 'CVeYI-gmX00:1500:240', 'CVeYI-gmX00:1000:200',
  'mOzW9KQKfzA:2800:240', 'mOzW9KQKfzA:3380:240', 'mOzW9KQKfzA:300:240', 'mOzW9KQKfzA:900:240',
];
const items = process.argv.slice(2).length ? process.argv.slice(2) : LIJST;
const ZEKER = 0.65;
const wrap = (x) => x - Math.round(x);
const verdacht = { oud: 0, nieuw: 0 };
let verschil = 0;
for (const item of items) {
  const [id, vanS, duurS, nulS] = item.split(':');
  const { env, envRate, tijdOffset } = envelopeFragment(id, Number(vanS), Number(duurS));
  const pas = (sk) => {
    const p = 60 / sk.bpm, fasen = [];
    for (let v = sk.van; v + 12 <= sk.tot + 1e-9; v += 12) {
      const fA = Math.max(0, Math.floor((v - tijdOffset) * envRate)), fB = Math.min(env.length, Math.floor((v + 12 - tijdOffset) * envRate));
      let re = 0, im = 0, som = 0;
      for (let f = fA; f < fB; f++) {
        const h = 2 * Math.PI * (f / envRate + tijdOffset - sk.anker) / p;
        re += env[f] * Math.cos(h); im += env[f] * Math.sin(h); som += env[f];
      }
      if (som > 0 && Math.hypot(re, im) / som > 0.15) fasen.push(Math.atan2(im, re) / (2 * Math.PI));
    }
    let ref = 0, best = -1;
    for (const f of fasen) { const n = fasen.filter((g) => Math.abs(wrap(g - f)) <= 0.15).length; if (n > best) { best = n; ref = f; } }
    let naast = false;
    const tekst = fasen.map((f) => { const x = Math.abs(wrap(f - ref)) > 0.15; naast ||= x; return `${(f * p * 1000).toFixed(0)}${x ? '!' : ''}`; }).join(' ');
    return { tekst, naast };
  };
  const opties = nulS ? { nulGrens: Number(nulS) } : {};
  const regels = {};
  for (const [naam, det] of [['oud', oud], ['nieuw', d]]) {
    regels[naam] = det.analyseerGrid(env, envRate, tijdOffset, opties).map((sk) => {
      const p = pas(sk), zeker = sk.zekerheid >= ZEKER;
      if (zeker && p.naast) verdacht[naam]++;
      return `  ${fmt(sk.van)}-${fmt(sk.tot)} ${sk.bpm?.toFixed(2).padStart(6)} z${sk.zekerheid.toFixed(2)}${zeker ? '*' : ' '} fase/12 s: ${p.tekst}${zeker && p.naast ? '   ZEKER!' : ''}`;
    });
  }
  const gelijk = regels.oud.join('\n') === regels.nieuw.join('\n');
  if (!gelijk) verschil++;
  console.log(`=== ${id} ${vanS}+${duurS}${nulS ? ` nul ${Number(nulS).toFixed(3)}` : ''}${gelijk ? '   (gelijk)' : ''}`);
  if (!gelijk) console.log(`oud:\n${regels.oud.join('\n')}\nnieuw:`);
  console.log(regels.nieuw.join('\n'));
}
console.log(`\n${items.length} fragmenten, ${verschil} anders. Zeker met een blok > 0,15 tel naast: oud ${verdacht.oud}, nieuw ${verdacht.nieuw}.`);
