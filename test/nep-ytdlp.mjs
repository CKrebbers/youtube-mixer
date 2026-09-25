// Een nep-yt-dlp voor de tests van de wachtrij: GEEN netwerk, wel het gedrag
// waar de ingest op leunt. Geen test zelf (heet niet *.test.mjs).
//
// Gebruik: zet VARVE_YTDLP op een shellscript dat dit bestand start
// (maakNepYtdlp() hieronder). Stuur met omgevingsvariabelen:
//   NEP_LOG    bestand waar elke aanroep een JSON-regel in schrijft
//   NEP_BRON   een echt audiobestand dat de "download" wordt
//   NEP_MS     wachttijd per voortgangsstap (standaard 30 ms)
//   NEP_TRAAG_MS  idem voor een trage link (standaard 200 ms)
// En met de link zelf:
//   ...lijst...  metadata is een playlist (3 nummers)
//   ...kapot...  metadata faalt zoals yt-dlp faalt
//   ...traag...  de download duurt 25 stappen × NEP_TRAAG_MS (tijd om te annuleren)
//   ...kind...   start tijdens de download een kind dat ONZE stdout/stderr erft,
//                zoals yt-dlp ffmpeg als downloader start (livestream, HLS)
//   ...doof...   negeert SIGINT (zoals een yt-dlp die in C-code vastzit)
//   ...nu-live...    een livestream die loopt (is_live, live_status 'is_live');
//                    downloaden duurt dan "eeuwig" (500 stappen), zoals een echte
//   ...straks-live...  een aangekondigde livestream (live_status 'is_upcoming')
//   ...oud-live...   alleen is_live: true, zonder live_status (oudere extractors)
//   ...was-live...   een afgelopen livestream (was_live): gewoon een video
//   watch?v=<id> een YouTube-nummer (extractor Youtube)
// Een videodownload (-f bv/b) faalt altijd: video is bonus, de audio blijft.
//
// Signalen zoals de echte (Python) yt-dlp: SIGINT = KeyboardInterrupt, dan
// ruimt hij zijn kinderen op (ffmpeg krijgt 'q', een nabewerking wordt
// gekild) en stopt met code 1. SIGTERM heeft hij NIET: dan valt hij meteen
// om en laat zijn kinderen achter.
import { appendFileSync, copyFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Schrijft het startscript in `map` en geeft het pad (voor VARVE_YTDLP). */
export function maakNepYtdlp(map) {
  const pad = join(map, 'nep-yt-dlp');
  writeFileSync(pad, `#!/bin/sh\nexec "${process.execPath}" "${fileURLToPath(import.meta.url)}" "$@"\n`);
  chmodSync(pad, 0o755);
  return pad;
}

const alsScript = process.argv[1] === fileURLToPath(import.meta.url);
if (alsScript) await nep(process.argv.slice(2));

async function nep(args) {
  const log = (wat, extra = {}) => {
    if (process.env.NEP_LOG) appendFileSync(process.env.NEP_LOG, JSON.stringify({ wat, pid: process.pid, ...extra }) + '\n');
  };
  const url = args[args.length - 1] || '';
  let kind = null;
  process.on('SIGINT', () => {
    if (url.includes('doof')) { log('doof', { url }); return; }
    kind?.kill('SIGINT');
    log('gestopt', { url });
    process.exit(1);
  });

  if (args.includes('--version')) { console.log('2026.08.19'); return; }

  if (args.includes('--dump-single-json')) {
    log('meta', { url, args });
    if (url.includes('kapot')) { console.error('ERROR: [generic] nep: kapotte link'); process.exit(1); }
    if (url.includes('lijst')) {
      console.log(JSON.stringify({ _type: 'playlist', id: 'lijst1', title: 'Nep-lijst', entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));
      return;
    }
    const u = new URL(url);
    const v = u.searchParams.get('v');
    const id = v || (u.pathname.split('/').pop() || 'x').replace(/\.[^.]*$/, '').replace(/[^\w-]/g, '');
    // Zoals yt-dlp 2026.08.19 het zet: een lopende stream heeft geen duur.
    const live = url.includes('nu-live') ? { is_live: true, was_live: false, live_status: 'is_live', duration: null }
      : url.includes('straks-live') ? { is_live: false, was_live: false, live_status: 'is_upcoming', duration: null }
        : url.includes('oud-live') ? { is_live: true, duration: null }
          : url.includes('was-live') ? { is_live: false, was_live: true, live_status: 'was_live' }
            : { is_live: false, was_live: false, live_status: 'not_live' };
    console.log(JSON.stringify({
      id, extractor_key: v ? 'Youtube' : 'Generic', title: `Nep ${id}`, uploader: 'nep',
      duration: 20, webpage_url: v ? `https://www.youtube.com/watch?v=${v}` : url, ...live,
    }));
    return;
  }

  const o = args[args.indexOf('-o') + 1];
  const f = args[args.indexOf('-f') + 1];
  if (f?.startsWith('bv')) {
    log('video', { url });
    console.error('ERROR: nep: geen beeld');
    process.exit(1);
  }
  log('download', { url });
  const traag = url.includes('traag');
  const stappen = /nu-live|oud-live/.test(url) ? 500 : traag ? 25 : 5;
  const ms = traag ? Number(process.env.NEP_TRAAG_MS) || 200 : Number(process.env.NEP_MS) || 30;
  const i = args.indexOf('--progress-template');
  const sjabloon = i >= 0 ? args[i + 1].replace(/^download:/, '') : null;
  const totaal = 1000000;
  if (url.includes('kind')) {
    kind = spawn('sleep', ['60'], { stdio: ['ignore', 'inherit', 'inherit'] });
    log('kind', { url, kind: kind.pid });
  }
  for (let k = 1; k <= stappen; k++) {
    await new Promise((z) => setTimeout(z, ms));
    const binnen = Math.round((totaal * k) / stappen);
    if (sjabloon) {
      const w = { downloaded_bytes: binnen, total_bytes: totaal, total_bytes_estimate: 'NA' };
      console.log(sjabloon.replace(/%\(progress\.(\w+)\)s/g, (_, k2) => String(w[k2] ?? 'NA')));
    } else {
      console.log(`[download] ${((binnen / totaal) * 100).toFixed(1).padStart(5)}% of 976.56KiB at 1.00MiB/s ETA 00:01`);
    }
  }
  copyFileSync(process.env.NEP_BRON, o.replace('%(ext)s', 'wav'));
  log('klaar', { url });
}
