# tools/

Hulpmiddelen voor ontwikkelen en meten. Niets hiervan draait in de app.

## beatmeting/
Metingen van het beatgrid op Clay's ECHTE library (docs/BEATGRID.md). Lezen alleen
`media/<id>/onset.bin` en `audio.wav` en de library via de draaiende server
(`http://localhost:8777/api/library`); schrijven niets in media/ of de database.
Draai met `node tools/beatmeting/<script>.mjs` vanuit de projectmap.

| script | wat |
|---|---|
| lib.mjs | gedeeld: library ophalen, onset laden, pasmaten; importeert server/detect.js |
| overzicht.mjs | tempo over de hele track, curve, segmenten, verfijning op 5 plekken |
| gridfit.mjs, fasespoor.mjs `<id> <bpm> <firstBeat>` | klopt een grid, per venster, tegen een nul |
| puls.mjs | is er een puls, en voorspelt de zekerheid dat |
| regio.mjs | verfijnen en fase-spoor in één gebied |
| tap-sim.mjs | tikken simuleren (40 proeven per plek) — de cijfers in BEATGRID.md |
| tijd.mjs | rekentijd en bit-vergelijking met onset.bin |
| offset-synth.mjs, offset-check.mjs | fase-afwijking van de onset-ijking |
| stapA/sim.mjs e.a. | de metingen vóór/na stap A (tap 53% → 91% goed, 0% offbeat) |
De *.txt-bestanden zijn de uitkomsten van 23 september 2026, ter vergelijking.

## git/
- `test-index.sh` — test precies wat er in de git-index staat (niet de werkmap): pakt de
  index uit in een tijdelijke map en draait daar alle tests. Handig bij het splitsen van
  werk in meerdere commits.
- `hunks.py` — `list <bestand>` toont de hunks van een bestand; `stage <bestand> '[0,2]'`
  zet alleen die hunks klaar; `strip <bestand> 'a-b,c-d'` zet de werkversie min die regels klaar.

## bench/
- `vm-bench.cjs [id] [N]` — rekentijd per stap van de Vormmachines in Node (nep-canvas,
  tekenen telt niet mee: een ondergrens). Een kopie van de systemen uit Clay's
  `vormmachines.html`. De cijfers staan in `docs/plugins/02-analyses.md` (risico's).

## headless/
- `kijk.mjs` — de app in een headless Chromium (uit de Playwright-cache, geen npm-pakket;
  het DevTools-protocol over Node's eigen WebSocket). Eigen server op poort 8791 met een
  tijdelijke database. **Veilig met de APC aangesloten:** `navigator.requestMIDIAccess`
  wordt weggehaald vóór de pagina laadt, dus er komt geen tweede MIDI-client. Test de app
  met en zonder `?vormen=1`, stuurt APC-bytes door de mapping (`parseMessage` →
  `mapping.handle`), tekent 60 beelden en zet schermafdrukken in `tools/headless/uit/`
  (niet in git). Let op: in headless rekent WebGL in software (swiftshader); snelheid
  zegt hier niets. Het handelingenlog loopt er helemaal doorheen: knop, bus, server,
  lijst, terugspelen (demo én een klikspoor dat door de ingest gaat), mee met een
  opname, en de tegenproef dat een teruggespeelde track niets in de library bewaart.
  Poorten: `VARVE_KIJK_POORT` en `VARVE_KIJK_DEBUG` (naast een andere sessie).

## keylock/
Proef met Signalsmith Stretch 1.3.2 (keylock en toonsoort verschuiven) op Clay's eigen
nummers. Ontwerp en uitkomst: `docs/KEYLOCK.md`. Leest alleen `media/<id>/audio.wav` en
`media/library.db` (ook vanuit een worktree: de hoofdmap wordt via git gevonden;
`VARVE_MEDIA` wijst een andere map aan). Geen browser nodig.

```
node tools/keylock/proef.mjs haal       # één keer: npm pack naar tools/keylock/pakket/ (niet in git), sha512 gecontroleerd
node tools/keylock/proef.mjs alles      # info + controle + meet + luister (~3 min)
```
Los: `info` (bestanden, licentie, latentie per preset), `controle` (toonhoogte, hoorbare
positie, klankkleur op 1,00, springen, tempowissel), `meet` (CPU per deck, acht decks,
opwarmen), `acht` (alleen de acht decks, gevoelig voor belasting), `luister [nummer] [--van s] [--duur s]` (WAV's naar `tools/keylock/uit/`,
niet in git; met `LUISTER.md` als leeswijzer).

| bestand | wat |
|---|---|
| kern.mjs | de WASM-fabriek los van de schil van Signalsmith (wat in stream-lezer.js zou komen), `Kern` op de ruwe exports, `StretchSpeler` (een deck zoals optie A: segment {T,P,R}, latentie gecompenseerd, geplande sprong, opwarmen, loop uitgerold), en hun eigen AudioWorkletProcessor nagebootst (optie C) |
| proef.mjs | de opdrachten hierboven |
| LUISTER.md | wat er in de luisterbestanden zit en waar je op let (VRAGEN A3) |
| metingen-2026-09-24.txt | de uitkomst van `alles` op 24 september (M1, met wisselende belasting) |

## stems/
- `meet.py` — proef met Demucs (stems splitsen) op Clay's eigen nummers: rekentijd op de M1
  (GPU via MPS of CPU) en het energie-aandeel per stem. Leest `media/<id>/audio.wav`, schrijft
  fragment + vier stems naar `tools/stems/uit/` (niet in git). Draait in een eigen venv met
  `demucs` (geen dependency van de app). Uitkomst 24 sep: zie docs/plugins of HANDOFF.

## toonsoort/
Toonsoort (key) meten op Clay's library (docs/TOONSOORT.md). Leest alleen: `media/<id>/audio.wav`
via ffmpeg en `media/library.db` (readOnly); schrijft niets in media/ of de database. Werkt ook
vanuit een git-worktree (zoekt media/ in de hoofdmap), of zet `VARVE_ROOT`.

| bestand | wat |
|---|---|
| toon.mjs | het rekenwerk, puur: stemming, halve tonen, chroma, zes profielen, nul, kaart, stemming per stuk |
| lees.mjs | audio via ffmpeg (mono 4410 Hz), library alleen-lezen |
| varianten.mjs | welke chroma-varianten en profielen vergeleken worden |
| synth.mjs → synth.txt | synthetisch materiaal met een bekend antwoord: 24 toonsoorten, relatief mineur, 432 Hz, nul-proeven, modulatie, stemming per stuk |
| meet.mjs → meting.txt | alle nummers: per profiel, kaart, grenzen, zekerheid, rekentijd; `--wissel`, `--venster`, `--sr/--N/--hop` voor vergelijkingen (naar uit/) |
| bekend.json | bekende toonsoorten met bron (H bladmuziek, M Spotify-algoritme, X tegenspraak, C eigen chroma) en nummergrenzen |

Draai met `node tools/toonsoort/meet.mjs [id ...]` en `node tools/toonsoort/synth.mjs`. Uitkomst
24 sep: zie docs/TOONSOORT.md. `uit/` staat niet in git.
