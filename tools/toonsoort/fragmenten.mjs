// De toonsoort van de SERVER (server/toon.js, dezelfde toonKaart als de
// worker) op fragmenten van Clay's library, naast wat het meetinstrument op
// de hele nummers vond (meting.txt, kaart T05/per-stuk). Alleen lezen:
// ffmpeg -ss/-t op media/<id>/audio.wav, hooguit 2 minuten per nummer (de
// machine is druk; geen hele albums). Schrijft fragmenten.txt hiernaast.
//
//   node tools/toonsoort/fragmenten.mjs
//
// Een fragment ligt BINNEN een stuk van de kaart in meting.txt, met een paar
// seconden marge. Klopt de server, dan geeft hij daar dezelfde toonsoort en
// (binnen een paar cent) dezelfde stemming. Nummers korter dan 2 minuten gaan
// helemaal door de keten: daar moet de uitkomst gelijk zijn aan meting.txt.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { ROOT, mmss } from './lees.mjs';
import { toonKaart, TOON_SR, leesToonsoort, camelot } from '../../server/toon.js';

const S = (m, s = 0) => 60 * m + s;
/*
 * [id, van, duur, verwacht] — verwacht = het stuk uit meting.txt (T05/per-stuk)
 * waar het fragment in valt: toonsoort (vaste spelling), stemming (cent),
 * zekerheid, en welk stuk (van-tot in het hele nummer).
 */
const FRAGMENTEN = [
  ['mOzW9KQKfzA', S(1), 60, { naam: 'Sakamoto', toonsoort: 'G', stemming: 8, zekerheid: 0.86, stuk: '0:00-3:35 (Aqua)' }],
  ['mOzW9KQKfzA', S(3, 40), 50, { naam: 'Sakamoto', toonsoort: 'Ab', stemming: 8, zekerheid: 0.86, stuk: '3:35-4:31 (slot van Aqua)' }],
  ['f3a7DiCsm8k', S(3), 60, { naam: 'ADRIANA', toonsoort: 'D', stemming: 1, zekerheid: 0.52, stuk: '2:56-4:53' }],
  ['f3a7DiCsm8k', S(11, 35), 60, { naam: 'ADRIANA', toonsoort: 'F', stemming: -45, zekerheid: 0.49, stuk: '11:29-13:31' }],
  ['HGv_ySHXtYI', S(0, 30), 120, { naam: 'Ciel', toonsoort: 'D', stemming: 0, zekerheid: 0.77, stuk: '0:00-3:31' }],
  ['1W1-nPXEVKk', S(22, 40), 60, { naam: 'zoned out', toonsoort: 'Bb', stemming: -5, zekerheid: 0.74, stuk: '22:26-25:30' }],
  ['1W1-nPXEVKk', S(5), 60, { naam: 'zoned out', toonsoort: 'G', stemming: -48, zekerheid: 0.39, stuk: '4:53-7:01' }],
  ['tiktok-7031697544472251694', 0, 120, { naam: 'No Surprises', toonsoort: 'D', stemming: -8, zekerheid: 0.18, stuk: 'heel nummer, 1:16', heel: true }],
  ['lokaal-099183d8a81b', 0, 120, { naam: 'set-212203', toonsoort: 'F#', stemming: -17, zekerheid: 0.31, stuk: 'heel nummer, 1:42', heel: true }],
  ['lokaal-34c123f373bc', 0, 120, { naam: 'set-140637', toonsoort: 'G', stemming: 4, zekerheid: 0.09, stuk: 'heel nummer, 1:53', heel: true }],
  ['lokaal-5fd670457996', S(2, 52), 97, { naam: 'set-232817', toonsoort: 'Bb', stemming: -3, zekerheid: 0.74, stuk: '2:50-4:31' }],
];

// Hooguit 2 minuten per nummer, bij elkaar opgeteld.
const perNummer = {};
for (const [id, , duur] of FRAGMENTEN) perNummer[id] = (perNummer[id] || 0) + duur;
for (const [id, s] of Object.entries(perNummer)) if (s > 120) throw new Error(`${id}: ${s} s, meer dan 2 minuten`);

/** Mono floats op 4410 Hz, alleen [van, van + duur): zoals analyze.js leest, met -ss/-t ervoor. */
function leesFragment(pad, van, duur) {
  return new Promise((klaar, faal) => {
    const stuk = van > 0 ? ['-ss', String(van), '-t', String(duur)] : ['-t', String(duur)];
    const kind = spawn('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'error', ...stuk, '-i', pad,
      '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', String(TOON_SR), '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const delen = [];
    let fout = '';
    kind.stdout.on('data', (d) => delen.push(d));
    kind.stderr.on('data', (d) => { fout += d; });
    kind.on('error', faal);
    kind.on('close', (code) => {
      if (code !== 0) { faal(new Error(fout.trim() || `ffmpeg gaf ${code}`)); return; }
      const b = Buffer.concat(delen);
      const uit = new Float32Array(b.byteLength / 4);
      new Uint8Array(uit.buffer).set(b.subarray(0, uit.length * 4));
      klaar(uit);
    });
  });
}

const regels = [];
const zeg = (s = '') => { regels.push(s); console.log(s); };
const naam = (t) => (t == null ? '—' : `${t} ${camelot(leesToonsoort(t))}`);
const wrap = (x) => x - 100 * Math.round(x / 100);

zeg(`Toonsoort van de server (server/toon.js) op fragmenten, ${new Date().toISOString().slice(0, 10)}. Library: ${ROOT}/media (alleen lezen).`);
zeg('Verwacht = het stuk van de kaart T05/per-stuk in meting.txt (hele nummers) waar het fragment in valt.');
zeg('Klopt = zelfde toonsoort en stemming binnen 5 cent (op de cirkel). Zekerheid ter informatie: een fragment is een ander stuk audio.');
zeg('');
zeg('fragment                          verwacht (meting.txt)          server op het fragment                    klopt  rekentijd');
let goed = 0, totaal = 0;
for (const [id, van, duur, v] of FRAGMENTEN) {
  const t0 = performance.now();
  const pcm = await leesFragment(`${ROOT}/media/${id}/audio.wav`, van, duur);
  const kaart = toonKaart(pcm, TOON_SR);
  const ms = performance.now() - t0;
  // Het stuk dat het meeste van het fragment beslaat.
  const lengte = pcm.length / TOON_SR;
  const stukken = kaart?.stukken ?? [];
  let hoofd = null, langst = -1;
  stukken.forEach((s, i) => {
    const d = (stukken[i + 1]?.van ?? lengte) - s.van;
    if (d > langst) { langst = d; hoofd = s; }
  });
  const klopt = !!hoofd && hoofd.toonsoort === v.toonsoort && Math.abs(wrap(hoofd.stemming - v.stemming)) <= 5;
  totaal++; if (klopt) goed++;
  const kaartTekst = stukken.map((s) => `${naam(s.toonsoort)} [${Math.round(s.stemming)}] z${s.zekerheid.toFixed(2)}`).join(' | ');
  zeg(`${`${v.naam} ${mmss(van)}+${duur}s`.padEnd(33)} ${`${naam(v.toonsoort)} [${v.stemming}] z${v.zekerheid.toFixed(2)}`.padEnd(30)} `
    + `${kaartTekst.padEnd(41)} ${klopt ? ' ja  ' : ' NEE '}  ${(ms / 1000).toFixed(2)} s`);
  zeg(`${''.padEnd(33)} (stuk ${v.stuk}${v.heel ? `; stemming bovenaan ${kaart?.stemming} ct` : ''})`);
}
zeg('');
zeg(`${goed}/${totaal} fragmenten kloppen met meting.txt.`);
writeFileSync(new URL('./fragmenten.txt', import.meta.url), regels.join('\n') + '\n');
