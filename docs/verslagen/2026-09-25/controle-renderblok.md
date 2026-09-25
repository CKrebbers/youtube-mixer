# Controle ROADMAP 22: renderBlok en worklet zonder afval

Controleur, 25 sep 2026. Branch `spoor2/renderblok-c` (vanaf `spoor2/renderblok`, 7b6904a).
Worktree `.claude/worktrees/agent-ac46534c8d1604554`, aan het eind losgekoppeld
(`git switch --detach`). Niet gemerged, niet gepusht, niets verwijderd.

## Uitkomst

**Geen commits: geen echte fout gevonden.** Het nieuwe audiopad is bit voor bit gelijk
aan het oude (main = de kern van vóór 47412e4), op alles wat ik kon bedenken, en de
afvaltest onderscheidt echt. Wat ik vond is laag en alleen gemeld, niet hersteld
(de opdracht: alleen echte fouten, niet herstructureren; dj-klank bouwt hierop verder).

## Wat ik gedaan heb

1. Hele diff gelezen (stream-kern.js, stream-lezer.js, test, bench, AUDIOPAD.md,
   tools/README). Geen verboden bestanden gewijzigd.
2. **Gouden hash nagemeten op de oude code**: `test/renderblok.test.mjs` met de imports
   omgezet naar main's stream-kern.js + stream-lezer.js (scratchpad `controle/test-oud.mjs`)
   geeft ook 9dfaeb73, en daar 22/25 GC's per venster (rood, zoals het hoort).
3. **Eigen fuzz, oud tegen nieuw** (scratchpad `controle/`):
   - `fuzz-direct.mjs`: renderBlok rechtstreeks, 7 zaden × 18 000–24 000 aanroepen
     (~130 000), **0 verschillen** (bits van L en R, returnwaarde, staat.env, en of hij gooit).
     Randgevallen die de bouwer niet noemde: TWEE decks door elkaar met ELK EIGEN
     paginainhoud (gedeeld `klad`: resten van het ene deck mogen niet in het andere
     lekken), blokgroottes die door elkaar springen (0, 1, 2, 3, 17, 127, 128, 129, 256,
     300, 1000: `klad` groeit en een kleiner blok leest over oude resten heen), pagina's
     met ONEVEN lengte (L er wel, R niet) en afgekapt op 1–9 samples, ctxRate 96 000,
     t0 dat terugloopt, R = 1e-9 / 0 / −0,5 / −1 / 3,7, loops van 0, 1, 2, 3 frames en
     negatief, loops met start < 0, wisselT in de toekomst, `vorig` die weggaat.
     Dekking (zaad 2): 739 einde, 2 797 halve envelop (gat), 5 931 overgangen, 3 718 naden.
   - `fuzz-worklet.mjs` / `fuzz-worklet-k.mjs`: de ECHTE oude en nieuwe stream-lezer naast
     elkaar, 8 decks, willekeurige berichten tussen blokken (segment, pagina, weg, bron
     met een andere sr/duur halverwege). 5 runs, 960 000 blokken, tot 111 782
     segmentwissels (70% kans per blok: overgang óp overgang, sprongen tijdens een
     wissel): **0 verschillen** in uitvoer, staat.env én de teruggestuurde
     'einde'-berichten (met id).
4. **Onderscheidt de afvaltest echt?** Afval ingesmokkeld in één pad tegelijk
   (`controle/injecteer.py`, varianten in `controle/var-*`): per frame in exact / voorbij
   / naad / gat / overgang / cubisch / stil deck, en per BLOK in exact / gat / gewoon
   zonder loop. **Alle tien rood.** Maar zie bevinding 1: vijf ervan alleen in het tweede
   venster.
5. **Wankelt hij?** Zes keer tegelijk gedraaid bij belasting ~35 op 8 kernen: zes keer
   groen, steeds venster 7 (stabiel) en venster 1–2 (berichten). Het is geen tijdmeting;
   de eerste 6 vensters vallen deterministisch af (optimaliseren + einde-meldingen).
6. **Inlining**: `--trace-turbo-inlining` op de test: positieOp → posities → leesSegment
   geïnlined; leesSegment en leesKubisch niet (te groot), en dat mag (alleen objecten en
   hele getallen over die grens).
7. **Bench zelf gedraaid** (`--sec 15 --rondes 3 --ref main`, belasting 4–12): hash gelijk
   (87a01558), CPU 94,2 → 28,9 ms/s (×3,3; bouwer: 194 → 57,5 bij zwaardere belasting),
   afval 12 498 → 9,9 B/blok (leeg harnas 7,6), kleine GC's 272 → 0. Eerlijk: om de beurt
   gemeten, beide warm, thread-CPU (GC-hulpthreads van de oude code tellen NIET mee, dus
   de winst is eerder onderschat).
8. **Headless** (`VARVE_KIJK_POORT=8893 VARVE_KIJK_DEBUG=9493 node tools/headless/kijk.mjs`):
   alles groen, de demo speelt via de nieuwe worklet in echte Chromium (bas duwt knop 1,
   bass-kill, 25 klappen). Eerste run viel op het ontbreken van `tools/headless/uit/`
   (niet in git; aangemaakt, genegeerd door .gitignore).
9. Regel 3: positieOp en ctxTijdVan ongewijzigd; de worklet rekent `t0 + i / ctxRate`
   exact zoals voorheen. Geen resultaatobject dat bewaard wordt (renderBlok geeft
   'einde' of null); geen buffer die gelezen wordt terwijl hij overschreven wordt
   (F→l/r, g→gl/gr, yl/yr lokaal per frame volledig gevuld; nu/oud gescheiden).

## Bevindingen

| # | ernst | wat | hersteld |
|---|---|---|---|
| 1 | laag | Het STABIELE venster van de afvaltest dekt minder dan het commentaar zegt. Na het opwarmen met `maakBerichten(0, 4000, 41)` staan de acht decks op maar twee DECK_SEGS: 2× loop 4–4,121 op 0,97 (cubisch + naad), 3× voorbij het einde, 3× stil. Gewoon afspelen zonder loop, het exacte pad (rate 1 op een heel frame: de meest gewone DJ-stand, 0% pitch), de gat-envelop en de overgang komen ALLEEN in het tweede venster (met berichten, drempel 1 kB + 16 B/bericht ≈ 6 kB). Afval per blok in die paden gaf daar 31–178 kB: gezien, marge ~5×. "Acht decks die samen elk pad raken" geldt voor de hash en het opwarmen, niet voor het stabiele venster. Voorstel (niet gedaan, dj-klank werkt in dit bestand): vóór elk stabiel venster de decks terugzetten op DECK_SEGS met berichten die BUITEN het meetvenster verwerkt worden. | nee |
| 2 | laag | De gouden hash hangt af van V8's Math.sin/cos (testmateriaal én de equal-power-fades in de kern). Een Node-versie met een andere trig-implementatie (V8 kent een libm-trig-bouwvlag) maakt hem rood zonder dat er iets aan het geluid veranderde. Dan niet blind de nieuwe hash overnemen maar opnieuw meten op main's kern (zoals `controle/test-oud.mjs`: alleen de import-paden omzetten). | nee |
| 3 | laag | Bench: "GC tijdens de run: … 2 groot" zijn de twee geforceerde `gc()` in `tel()` (de observer start vóór die aanroepen); ook het lege harnas toont 2. Cosmetisch; de docs noemen alleen kleine GC's. | nee |
| 4 | laag | Worklet: `this.blok` houdt vanaf de constructor `this.paginas` en `this.staat` vast. Klopt nu ('bron' doet `paginas.clear()`, staat wordt nooit vervangen), maar wie ooit `this.paginas = new Map()` of `this.staat = { env: 1 }` schrijft, laat renderBlok stil op het oude object werken. Eén regel commentaar of die twee ook per blok zetten zou het dichttimmeren. | nee |
| 5 | laag | AUDIOPAD.md "273–548 kleine GC's per minuut": hangt van de jonge-generatiegrootte af; mijn 15-s-run gaf 272 in 15 s (~1 090/min) op de oude code. Eerder onderschat dan overdreven; in Chrome's worklet-isolaat onbekend. | nee |

Niet gevonden: gedragsverschil in declick/segmentwissel (vorig/wisselT), GAT_FADE,
LOOP_NAAD, staat.env, rondgaande loops, gat = stilte, pagina's die komen/gaan, seek naar
een gat, trackeinde, 0-frame-blokken, heel korte loops, rate 0,5 en 2, sprongen tijdens
een wissel. De heeftPagina-cache is per aanroep gewist vóór gebruik en alleen geldig
binnen één blok (berichten komen tussen blokken): klopt.

## Tests

- `nice -n 10 node test/alles.mjs` (belasting 34–40 op 8 kernen): 30 bestanden, 1928
  checks; 28 groen, ROOD alleen `vormen-isomorf` (tv: max < 16 ms) en `vormen-meer`
  (ch, jl, dl, if: max < 16 ms). Los opnieuw gedraaid bij dezelfde belasting: zelfde
  tijdchecks rood. Dit spoor raakt src/vormen en die tests niet (diff leeg): belasting.
- `renderblok.test.mjs`, `stream.test.mjs` (tegen ffmpeg), `regels.test.mjs`: groen.

## Wat NIET getest is

- Afvalvrijheid in Chrome's eigen audiothread (andere V8, Maglev, pointer compression);
  alleen Node 26.8.2 en headless Chromium (functioneel, niet op afval gemeten).
- Niet gehoord; bit-identiek bewezen tegen de oude code, dus niets anders te horen.
- Tracks > 6,2 uur (framenummer > 2^30) niet op afval gemeten.
- Een scenario met de rem van dj-klank (bestaat nog niet op deze branch).
