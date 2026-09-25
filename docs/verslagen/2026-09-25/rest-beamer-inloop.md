# Rest spoor 3: beamer-inloop (afgemaakt)

Branch `spoor3/beamer-inloop-2` (van `spoor2/beamer-c`), worktree `agent-a03335440c1bc17b7`.
Na de laatste commit gedetacht. Niet gemerged, niet gepusht. Het werk van de voorganger
(8 bestanden, ~795 regels, niet gecommit in `agent-ae3b8bdb3e9d7f025`) is overgenomen door de
bestanden te kopiëren (git -C naar die worktree mocht niet vanuit deze isolatie; `diff -rq`
toonde precies de 8 bestanden, geen untracked). De oude worktree is niet aangeraakt.
Patch van de voorganger: `scratchpad/voorganger.patch`.

## Commits

| commit | onderwerp |
|---|---|
| `b1d1db6` | Video: seekDuur meet tot seeking weer false is, niet tot een laat seeked-event |
| `0667d07` | Beamer: inloop, het losse venster toont het beeld van het hoofdvenster tot zijn video's in de pas lopen |

`b1d1db6` staat los: op een `git archive` van die commit zijn video.test en regels.test groen.

## Oordeel over het werk van de voorganger

De opzet was goed: de pure inloop-logica in `beamer.js` (`inloopStap`, `meldPas`, `rolLos`,
`hoofdMengde`, `wasVerborgen`), `inDePas` in volg.js en `loopIn` in de mixer. Die heb ik
gehouden. Maar de headless-proef, die nog niet gedraaid was, liet drie problemen zien:

1. **captureStream liep weg.** Het losse venster toonde het hoofdcanvas via captureStream in
   een `<video>` erover. Onder belasting liep dat beeld steeds verder achter, tot 2,9 s, bij
   alle acht tracks evenveel. Er werd nooit overgenomen.
2. **Canvas lezen in de eigen lus gaf niets.** Het alternatief was het hoofdcanvas uploaden
   in de rAF van het losse venster. Dat gaf een leeg beeld: een WebGL-canvas zonder
   preserveDrawingBuffer is leeg zodra het getoond is.
3. **Het eerste eigen beeld na de overname was oud.** `loopIn` stuurde bij zonder te
   uploaden. Het eerste eigen beeld was dan 200–400 ms oud, want een `<video>` die niemand
   uitleest krijgt in Chrome geen vers beeld.

Vereenvoudigd en hersteld:
- **Het hoofdvenster duwt zijn beeld.** Het zet het direct na zijn `teken()` op het losse
  canvas: `if (w.inloop) los.mixer.toonBeeld(canvasEl)` in video-paneel. Het losse venster
  tekent tijdens de inloop zelf niets. Daarmee zijn weg: `inloopBeeld`/`stopInloopBeeld`,
  de `<video class="inloop">` in video.html (video.html is weer als op `spoor2/beamer-c`), en
  de opname-uitzonderingen (`opnameCanvas(…, {hoofdVerborgen})` en "opname uit los = geen
  inloop"). Op het losse canvas staat altijd het goede beeld.
- **teken() en loopIn() delen één lus** (`_bijwerken`). loopIn uploadt dus ook, maar mengt niet.
- **seekDuur.** Zie hieronder.

src (zonder docs/tests/tool): +~250 regels t.o.v. `spoor2/beamer-c`, waarvan veel commentaar.
Het grootste deel van de diff van `tools/headless/beamer.mjs` is inspringing: het eerste deel
staat in `if (!ALLEEN_INLOOP)`. Met `git diff -w` is het +245.

## De eigenlijke rem: seekDuur (b1d1db6)

Met het beeld opgelost kwamen de eigen video's onder load 100–200 in 15–20 s niet in de pas.
Dan kwam de overname pas door de time-out, en was het oude probleem na 20 s terug. Een spoor
(`VARVE_BEAMER_SPOOR=1`: elke `currentTime`-zet en elk media-event) liet het mechanisme zien:

    712 B ZET 19.522   (nieuwe sprong; seeking was net false)
    712 B seeked       (het event van de VORIGE sprong, pas nu uitgedeeld)

Het `seeked`-event is een taak. Onder belasting komt die pas na het volgende beeld, en in dat
beeld is al opnieuw gesprongen. De seeked-handler rekende dan vanaf de nieuwe seekStart
(≈0 s). seekDuur zakte naar 0,00–0,04 s, terwijl sprongen 0,8–1,7 s duurden. Elke sprong landde
daardoor ~1 s te laat, en de video's bleven springen. Dat verklaart waarschijnlijk ook een deel van de
"sprongen 1–1,6 s" uit bevinding 4.

Herstel: `_volg` meet zelf. Het eerste beeld waarin `seeking` weer false is, sluit de sprong
af. Tijd waarin de mixer niet tekende (gat > 1 s) of waarin de track onzichtbaar was, telt niet
mee (seekStart = 0). Het `seeked`-event wordt niet meer gebruikt. Dit geldt voor beide mixers.
De test in video.test.mjs bootst het na: sprongen van 0,8 s en een `seeked` dat een beeld te
laat komt. Op de code van spoor2 faalt hij (beide checks rood), met de fix is hij groen.

## Metingen (headless, `tools/headless/beamer.mjs`, deel "inloop met acht tracks")

Acht tracks, elk met een blok op een eigen rij, mengvorm licht. Direct na elk beeld op het
losse canvas (hook op `teken`/`toonBeeld`) wordt per track gemeten hoe ver het beeld van het
geluid af zit. De strenge check: vanaf het eerste beeld staan alle acht er, in elk beeld, en
elk beeld zit binnen 150 ms. De oude check was te mild: hij telde pas vanaf het eerste
volledige beeld en was daardoor groen op de oude code.

| run | code | load | ontbrekende track | grootste fout | eigen mengen vanaf |
|---|---|---|---|---|---|
| oud2 | spoor2/beamer-c | ~130 | 359/1090 beelden (eerste ~8,5 s) | 136 ms | meteen |
| oud | spoor2/beamer-c (rAF-meting) | 10–35 | eerste 6,5 s | 202 ms | meteen |
| nieuw1 | voorganger (captureStream) | 25–59 | 0 | 2940 ms (stream liep weg) | nooit |
| nieuw2 | canvas lezen in eigen lus | 175–250 | alles leeg | – | nooit |
| nieuw3 | duwen, zonder upload in loopIn | 140–200 | 0 | 400 ms (overname) | 9,7 s |
| nieuw5 | + upload, zonder seek-fix | 100–140 | 0 tijdens inloop, 259/804 erna | 151 ms | 19 s (time-out) |
| nieuw6 | eind | 40–90 | 0/988 | 127 ms (hapering 100 ms) | 9,4 s |
| vol1 | eind, volledige proef | 14–28 | 0/1045 | 94 ms | 8,0 s |

Maatstaf, het paneel zelf in dezelfde meting: 48–84 ms (30 fps = 33 ms per beeld, plus meting).
Overname in vol1/nieuw6 naadloos: het laatste "hoofd"-beeld -54 ms, het eerste "eigen" -26 ms.

## Tests

- `test/video.test.mjs`: 134 checks groen. Nieuw: inDePas, inloopStap, Beamer-inloop
  (wanneer wel en niet, verborgen, terug van verborgen, opname), loopIn (upload zonder
  mengen), toonBeeld, en de seekDuur-race.
- `nice -n 10 node test/alles.mjs`: 29 bestanden, 2005 checks, alles groen (load was toen ~6–25).
- `tools/headless/beamer.mjs` (8924/9524), volledig: 46 controles groen (vol1).
  Aangepast: "weer zichtbaar" wacht nu op de inloop (0,5 s met één video).
- `tools/headless/kijk.mjs` (8924/9524): 36 ok, alles groen (oriëntatie met en zonder vormlaag).
- Onder zware belasting (load 100–250, andere agenten) liepen de runs zonder seek-fix rood op de
  overname. Met de fix groen bij load 14–90. Bij load > 100 heb ik de eindcode niet apart gedraaid.

## NIET getest

- Clay's echte Chrome, een echte beamer, M1 zonder andere belasting. Hoe lang de inloop daar
  duurt, is niet gemeten (hier 8–9,4 s bij load 14–90, voor acht tracks).
- De kosten van zestien video's tegelijk tijdens de inloop, met echte YouTube-video's.
- Inloop na herladen, en na terughalen van een geminimaliseerd los venster, met acht tracks.
  Met één video is het getest.
- Hoofdtabblad verborgen tijdens de inloop, in headless: alleen in de unit-test. Het losse
  venster neemt dan meteen over, met video's die nog inlopen (gedocumenteerd).
- De seekDuur-fix in het hoofdvenster bij hotcues/loops onder belasting: alleen via de
  unit-test en het paneel in de headless-proef (8 tracks in de pas na 5–6 s).

## Voorstel CLAUDE.md (niet gewijzigd, mag niet)

Bij "Video is SLAAF van de audio", na het voorstel van de controleur over het losse venster:
> Inloop (docs/BEAMER.md): gaat het losse venster open (of komt het terug) terwijl het
> hoofdvenster mengde, dan blijft dat mengen en zet het elk beeld METEEN op het losse canvas
> (`toonBeeld`, zelfde taak: een WebGL-canvas zonder preserveDrawingBuffer is leeg zodra hij
> getoond is; captureStream liep onder belasting tot 2,9 s weg). Het losse venster stuurt en
> uploadt zijn eigen video's (`loopIn`) en neemt over als ze 0,3 s binnen 50 ms lopen, of na 20 s.
> Hoofdtabblad verborgen = meteen zelf mengen. seekDuur wordt gemeten tot `seeking` weer false
> is, NIET met het seeked-event: dat komt onder belasting na de volgende sprong en maakte
> seekDuur ~0 (eindeloos springen).
