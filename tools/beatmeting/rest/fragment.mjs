// Restpunt 1: analyseerGrid oud (cc527e3) tegen nieuw (tweedeKans) op FRAGMENTEN.
//   node tools/beatmeting/rest/fragment.mjs id:van:duur[:nul] ...
// nul = vaste nulgrens (de nul van een fragment is niet die van het hele nummer;
// voor het album 18/22 = 0.8181818, afgeleid uit de bewaarde zekerheden).
// Per stuk: bpm, zekerheid, en de fase van de puls per 12 s t.o.v. het grid (ms).
import { d, detectOud, envelopeFragment, fmt } from './lib.mjs';

const oud = await detectOud();
for (const item of process.argv.slice(2)) {
  const [id, vanS, duurS, nulS] = item.split(':');
  const { env, envRate, tijdOffset } = envelopeFragment(id, Number(vanS), Number(duurS));
  const opties = nulS ? { nulGrens: Number(nulS) } : {};
  console.log(`=== ${id} ${vanS}+${duurS}${nulS ? ` nul ${Number(nulS).toFixed(3)}` : ''}`);
  const pas = (sk) => {
    const p = 60 / sk.bpm, uit = [];
    for (let v = sk.van; v + 12 <= sk.tot + 1e-9; v += 12) {
      const fA = Math.max(0, Math.floor((v - tijdOffset) * envRate)), fB = Math.min(env.length, Math.floor((v + 12 - tijdOffset) * envRate));
      let re = 0, im = 0, som = 0;
      for (let f = fA; f < fB; f++) {
        const h = 2 * Math.PI * (f / envRate + tijdOffset - sk.anker) / p;
        re += env[f] * Math.cos(h); im += env[f] * Math.sin(h); som += env[f];
      }
      if (som > 0 && Math.hypot(re, im) / som > 0.15) uit.push((Math.atan2(im, re) / (2 * Math.PI) * p * 1000).toFixed(0));
    }
    return uit.join(' ');
  };
  for (const [naam, det] of [['oud', oud], ['nieuw', d]]) {
    const st = det.analyseerGrid(env, envRate, tijdOffset, opties);
    console.log(`${naam}:`);
    for (const sk of st) console.log(`  ${fmt(sk.van)}-${fmt(sk.tot)} ${sk.bpm?.toFixed(2).padStart(6)} z${sk.zekerheid.toFixed(2)}  fase/12 s: ${pas(sk)}`);
  }
}
