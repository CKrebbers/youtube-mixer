# De snelle winst uit WINST.md (14 okt 2026, tak `afmaken/winst-snel`)

Vijf punten uit `docs/WINST.md`, elk met een check in `test/` en een meting vóór en na met
hetzelfde commando. Vóór = `studio/afmaken` op c873445 (een losse worktree, `VARVE_CODE`), na =
deze tak. Gemeten in de container (Linux, 4 kernen, Node 22.22, Chromium headless shell 1194 en
Chrome for Testing 155), niet op de M1: de getallen op de Mac zullen anders zijn, de richting niet.

## Vóór en na

| punt | meting (commando hieronder) | vóór | na |
|---|---|---|---|
| 1 lek | renderer-groei tijdens 300 s opname, deck stil | 26,6 MB/min (165 → 298 MB) | 2,6 MB/min (167 → 180 MB) |
| 1 lek | idem, blijvend na GC | 25,8 MB/min (→ 294 MB) | 0,2 MB/min (→ 168 MB) |
| 2 video | audio wacht vóór verzenden, p90 / max (twee ronden) | 4111 / 8600 · 4373 / 9890 ms | 38 / 179 · 48 / 395 ms |
| 2 video | sprong → pagina binnen, p90 / max | 3721 / ≥ 5000 · 1575 / ≥ 5000 ms | 610 / 900 · 966 / 1285 ms |
| 2 video | gat per deck (spelend zonder pagina), max | 7690 · 6370 ms | 670 · 890 ms |
| 4 draadpool | 3 pagina's na 4 hangende modules | HANGT / HANGT / HANGT | 5 / 4 / 3 ms (UV_THREADPOOL_SIZE=16) |
| 8 tests | de hele suite, wandklok (96 bestanden, 8825 checks) | 533 s (`--serieel`) | 249 s (pool 123 s + alleen 126 s, 4 tegelijk) |

Doel van WINST punt 2 (p90 < 300 ms, geen gat > 1 s): gehaald. De video's bleven spelen en
bufferen vooruit (20–130 s), nu in meer en kleinere verzoeken (69 → 243–277 per ronde).

## Wat er veranderd is

1. **Lek** (5aba864). `leesWeg(res)` in `src/lib/antwoord.js`: leest het antwoord weg met `json()`
   (de nep-fetches van de tests kennen alleen dat) en gooit nooit. Op het succespad van
   `opnemer.js` (audio- en videostuk), `handelingen.js`, `status-zender.js` (elke 900 ms, ook bij een
   fout), en de andere schrijvende fetches in `src/ui/` zonder gelezen antwoord: grid en toon
   (`laden.js`), hotcues, sampler-pads (POST en DELETE), rack actief, mapping, "geladen", toonsoort en
   wissen in de library, een wens weg. `noodstop()` (keepalive bij pagehide) niet: de pagina is dan weg.
   Check: `test/opnemer.test.mjs` telt `json()` per gelukt stuk (4/4 audio, 3/3 video) en dat
   `leesWeg` nooit gooit; faalt op de oude opnemer.
2. **Video verdringt audio** (e4d43e7). `statisch()`: een OPEN Range (`bytes=N-`) op
   `/media/<id>/video.mp4` krijgt hooguit 2 MB (`VIDEO_KNIP`). Gesloten bereik, `bytes=-N`, zonder
   Range, en audio.wav/stems.wav: onveranderd. `priority: 'high'` op de standaard-`haal` van de
   StreamBron (alleen die regel in bron.js). Check: `test/server.test.mjs`, vijf gevallen; faalt op de
   oude server.
3. **Draadpool** (c323376). `export UV_THREADPOOL_SIZE=16` in `startServer()` van
   `VARVE.applescript`, en in de handmatige starts (README, TAILSCALE.md: hand en LaunchAgent). Tool:
   `tools/bench/draadpool.mjs` (de meting uit `winst/meet/draadpool.mjs`, nu in een kopie van de code
   in een tijdelijke map in plaats van FIFO's in de checkout). Check: `test/draadpool.test.mjs` (de
   applescript-regel, en de meting: standaard hangt, 16 niet).
4. **Waarschuwen bij Cmd+R/Cmd+W** (884cda4). `src/ui/vertrek.js`: `waaromBlijven` (puur) en
   `bewaakVertrek` (beforeunload), één keer aangezet in `app.js` met alle decks (`playing`, `wacht`,
   `laadt`), `auto.aan` en de opname. De eigen beforeunload van `opname-knop.js` is weg: één plek.
   Check: `test/vertrek.test.mjs` (regels, handler, de echte getters van Deck, de aanroep in app.js).
   Grens: Chrome toont de vraag alleen na een klik of toets op de pagina (sticky user activation);
   MIDI telt niet. Wie de hele avond alleen de APC aanraakte, krijgt hem mogelijk niet.
5. **Tests parallel** (68a0623). `test/alles.mjs` draait een pool van `os.availableParallelism()`
   (of `--banen N`), langste eerst uit `test/.duur.json` (in .gitignore, na elke ronde bijgewerkt;
   onbekend telt als 60 s). `// @alleen: <waarom>` in de eerste 40 regels = na de pool, één voor één.
   `--serieel` = het oude gedrag. Hetzelfde overzicht, plus de rode bestanden en de tijden.
   Gemarkeerd (12): afvalmetingen `renderblok`, `instrumenten-fm-schaal`, `effecten`, `klankschaal`,
   `master`; tijdsgrens op de wandklok `gridauto`, `kaart`, `server` (Range p95 < 50 ms tijdens een
   analyse); ms per stap `vormen`, `vormen-zwaar`, `vormen-meer`, `vormen-isomorf`. Vaste poorten:
   geen gevonden; alle servertests nemen een willekeurige poort (20000–39999) of poort 0. `gridauto`
   en `kaart` werden in de proef van WINST (4 tegelijk) rood door de belasting; de rest is voorzorg.
   `.github/workflows/test.yml` staat klaar (macos-14, Node 26.8.2, ffmpeg via brew) maar draait
   alleen met de hand (`workflow_dispatch`): **aanzetten op elke PR is een keuze van Clay**.

## De suite, serieel en parallel

`node test/alles.mjs --serieel` en daarna `node test/alles.mjs` (4 kernen, de tweede met de duur van
de eerste in `test/.duur.json`):

| | wandklok | bestanden | checks | rood |
|---|---|---|---|---|
| serieel | 533 s | 96 | 8825 | 3 |
| pool van 4 | 249 s (pool 123 s, de 12 @alleen 126 s) | 96 | 8825 | 3 |

Per bestand hetzelfde aantal ok en dezelfde uitslag (vergeleken zonder de tijden: identiek). Rood in
beide precies de drie die op main in deze container al rood zijn: renderblok "keylock met wissels"
(89,7 bytes per bericht), instrumenten-fm-schaal "geen afval per blok" (29 272 bytes), wachtrij "yt-dlp
en zijn kind zijn allebei weg" (×2). De helft van de tijd is nu de staart van de twaalf @alleen-tests;
wie die korter wil, moet hun grens robuuster maken (threadtijd zoals de vormen), niet de pool groter.

## Nagelopen, en wat niet lukte

- `tools/headless/kijk.mjs` op deze tak: 77 ok, exit 0 (headless shell). Op de vóór-worktree startte
  hij hier niet (Chrome kwam niet op tijd op), dus geen vergelijking; wel groen na de fix.
- `tools/headless/beamer.mjs` (Chrome for Testing, swiftshader): vóór 34 ok / 13 FOUT, na twee ronden
  33/14 en 34/13. Dezelfde dertien vallen in beide om: 2–4 beelden per seconde op de CPU in deze
  container (de tool wil de GPU). De veertiende ("beamerbeeld loopt door") viel in één ronde na om
  en slaagde in de tweede: ruis bij 2 fps. De testvideo's zijn effen kleuren en kleiner dan 2 MB, dus de
  knip raakt ze nauwelijks. Op de Mac nog eens draaien.
- De drie rode bestanden van main in deze container (renderblok "keylock met wissels",
  instrumenten-fm-schaal "geen afval per blok", wachtrij "yt-dlp en zijn kind" ×2) zijn hier ook rood,
  serieel en parallel; niet van deze tak.
- Niet op de Mac gemeten: het lek (Taakbeheer van Chrome, 10 min opnemen), acht video's met echte
  YouTube-video's, en de duur van de suite op de M1 (WINST schat 1,5–2 min).

## Commando's (exact)

```
# vóór: een losse worktree van studio/afmaken
git -C /home/user/youtube-mixer worktree add --detach <scratch>/wt/voor studio/afmaken

# 1. lek (300 s opname, poorten 8881/8882)
VARVE_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
  VARVE_CODE=<scratch>/wt/voor VARVE_KIJK_POORT=8881 VARVE_KIJK_DEBUG=9381 node tools/headless/lek.mjs
VARVE_CHROME=… VARVE_KIJK_POORT=8882 VARVE_KIJK_DEBUG=9382 node tools/headless/lek.mjs

# 2. acht video's (twee ronden elk, om en om; media uit de proef van WINST: winst/goedkoop/media)
VARVE_CHROME=/root/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome \
  VARVE_ACHT_MEDIA=<scratch>/winst/goedkoop/media VARVE_CODE=<scratch>/wt/voor node tools/headless/acht-video.mjs
VARVE_CHROME=… VARVE_ACHT_MEDIA=… node tools/headless/acht-video.mjs

# 4. draadpool
node tools/bench/draadpool.mjs

# 5. de suite
node test/alles.mjs --serieel
node test/alles.mjs
```
