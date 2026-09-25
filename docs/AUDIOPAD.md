# Audiopad zonder afval

Stand: 25 september 2026, ROADMAP 22. Gebouwd in `src/engine/stream-kern.js`
(`renderBlok` en wat eronder hangt) en `src/engine/stream-lezer.js` (de worklet).
Meetinstrument: `tools/bench/renderblok.mjs`. Bewaking: `test/renderblok.test.mjs`.

## Kort

- **Afval: ~12,7 kB per blok → 0.** Acht decks gaven 273–548 kleine GC's per
  minuut, op de audiothread; nu geen enkele.
- **CPU: 194 → 57,5 ms per seconde audio voor acht decks** (19,4% → 5,75% van een
  M1-kern), 15 464 → 52 136 blokken per seconde.
- **Uitvoer bit voor bit gelijk.** Zelfde hash over alle bits van de bench, zelfde
  gouden hash in de test, en 60 000 willekeurige gevallen oud tegen nieuw zonder
  één verschil. De declick (overgang, gat, loop-naad) is dezelfde rekensom.

## Waarom

Een garbage collection draait op de thread die het afval maakte, hier dus de
audiothread. Een kleine GC duurt een fractie van een milliseconde tot een paar
ms; valt hij in een blok met acht decks en een krap budget (2,67 ms per blok van
128 frames op 48 kHz), dan komt het blok te laat: een tik. Hoe minder afval, hoe
zeldzamer; geen afval, dan nooit (door ons).

## Waar het afval zat

V8's heap-profiler op de oude code (47412e4), per blok:

| waar | bytes/blok | wat |
|---|---:|---|
| renderBlok (met leesSegment ingelijfd) | 8 911 | een array `[L, R]` per frame, plus doubles als HeapNumber naar `lees` |
| lees | 3 594 | de returnwaarde: een double uit een functie die V8 niet inlinet (241 bytes bytecode, over het budget) wordt een HeapNumber |
| process (worklet) | 153 | een nieuw object met de argumenten van renderBlok, elk blok |
| sample, leesSegment | 54 | idem, kleiner |

De les: in JS is een double die een functie in of uit gaat een object, zodra de
optimaliserende compiler die functie niet inlinet. Of hij dat doet hangt af van
een budget (hier 920 bytes bytecode per functie) dat per V8-versie verschilt.

## Hoe het nu werkt

Per blok in drie stappen:
1. **posities**: `positieOp(seg, t0 + i / ctxRate)` voor elk frame, naar een
   Float64Array. De enige aanroep van positieOp in het audiopad, in een lus die
   niets anders doet: daar is hij de enige kandidaat voor het inlinebudget en
   wordt hij ingelijfd (gecontroleerd met `--trace-turbo-inlining`).
2. **samples**: per frame de leespositie en de soort (voorbij het einde, gewoon,
   in de loop-naad), dan in één lus lezen (exact of cubisch) naar Float64Arrays;
   in de naad een tweede lezing en de equal-power-menging.
3. **mengen** per frame: gat-envelop (`staat.env`) en de overgang met `vorig`.

De regels erachter (ook in het commentaar boven "samples lezen"):
- Tussenresultaten in vaste Float64Arrays (`klad`, gedeeld door alle decks in de
  worklet; ze renderen na elkaar). Float64 = een JS-getal: niets wordt afgerond.
- Hulpfuncties op het hete pad krijgen alleen objecten en hele getallen mee en
  geven niets of een boolean terug. Dan maakt het niet uit of V8 ze inlinet
  (`leesKubisch` en `leesSegment` worden het niet, en dat mag).
- Wat per blok vastligt (t0, rates, duur) staat als veld op `klad`, niet als
  argument. Doubles in velden schrijft V8 ter plekke over.
- De worklet werkt één argumentobject per deck bij in plaats van er elk blok een
  te maken.

En sneller, als tweede stap (917c890):
- De vier buren van een cubische lezing staan bijna altijd op één pagina: één
  `paginas.get` in plaats van vier (anders frame voor frame, zelfde uitkomst).
- De gat-controle vraagt per frame vier keer `paginas.has`, bijna altijd voor
  dezelfde pagina: de laatste twee antwoorden worden per blok onthouden.
Die twee samen haalden 119 → 58 ms per seconde audio (de afvalvrije versie alleen
deed 190 → 116).

## Cijfers

`nice -n 10 node --expose-gc tools/bench/renderblok.mjs --sec 60 --rondes 3 --ref 47412e4 --profiel`,
Node 26.8.2 (V8 14.6), Apple M1, belasting 28–42 op 8 kernen (andere agenten).
Acht decks × 60 s = 180 000 blokken, 239 segmentwissels, met loops en hun naad,
seeks, hotcues, tempowissels, pauze, een gat en het trackeinde.

| | vóór (47412e4) | na |
|---|---:|---:|
| uitvoer (FNV-1a over alle bits) | a6c215d9 | a6c215d9 |
| CPU per seconde audio, 8 decks (beste van 3) | 194,0 ms | 57,5 ms |
| blokken per seconde CPU | 15 464 | 52 136 |
| per stap (8 decks één blok), p50 | 540 µs | 155 µs |
| afval per blok, hele run incl. opwarmen | 12 687 B | 5,2 B (leeg harnas: 2,5 B) |
| afval in stream-kern/stream-lezer (heap-profiler) | 12 712 B | 0,4 B |
| kleine GC's tijdens de run | 273 | 0 |

De 0,4 B die het profiel nog ziet is opwarmen: de bench maakt per run verse
processors, en tot V8 die paden (opnieuw) geoptimaliseerd heeft maakt de
interpreter van elke double een object. In de stabiele toestand is het nul:
`test/renderblok.test.mjs` meet 256 bytes over 12 000 blokken, en dat is het
object dat `process.memoryUsage()` zelf teruggeeft. De oude code: 22 GC's in
hetzelfde venster. p99 en max per stap zeggen op deze drukke machine niets
(max ~60 ms bij oud én nieuw: dat is de machine die de thread even wegneemt).

Een eerdere meting bij lagere belasting (16–17): vóór 156,7 ms/s, 548 GC's.

## Wat blijft

- **Per bericht, niet per blok.** Een binnenkomend bericht maakt de browser aan
  (deserialiseren), en `{ type: 'einde' }` gaat terug als object (hooguit één per
  segment). De test staat ~16 bytes per bericht toe en meet ~4 (dat zijn de
  einde-meldingen). Echt nul vraagt SharedArrayBuffer voor de segmenten; COOP/COEP
  staan er al voor, maar het is niet nodig.
- **Wat Chrome zelf doet** op de audiothread (de `outputs`-arrays, de berichten)
  zien we niet vanuit JS.
- **Opwarmen.** De eerste honderden blokken na het laden van de worklet draaien in
  de interpreter en maken wel afval; daarna niet meer. Een tik in de eerste
  seconde na het openen van de app is niet uitgesloten.
- **Tracks langer dan 6,2 uur**: framenummers boven 2^30 passen niet meer in een
  "klein geheel getal" van V8, en dan kost elke niet-ingelijfde aanroep met een
  framenummer toch een object. Nu niet aan de orde.

## Meten en bewaken

- `node test/renderblok.test.mjs` (zit in `test/alles.mjs`): de echte worklet in een
  nagebouwde AudioWorkletGlobalScope, acht decks die samen elk pad raken. Eerst
  de gouden hash (9dfaeb73, gemeten op 47412e4) over 3000 blokken met overgangen;
  dan na opwarmen een venster van 12 000 blokken: gc, heap lezen, draaien, heap
  lezen, en `v8.GCProfiler` zegt of er een GC tussen zat. Eis: geen GC en < 1 kB.
  Geen tijdmeting, dus niet wankel onder belasting; is V8 nog niet klaar met
  optimaliseren, dan telt het volgende venster (hooguit 30). Een allocatie per blok
  haalt in geen enkel venster de drempel (proef: één array per blok gaf 40 B/blok,
  rood).
- `tools/bench/renderblok.mjs` voor de cijfers hierboven; `--ref <commit>` meet een
  oudere versie ernaast, `--profiel` zegt per functie waar het afval zit.

## Voor wie hier verder bouwt

- Een REM (versnelling) hoort in `positieOp` en als veld op het segment, nergens
  anders: renderBlok vraagt elke positie aan positieOp. Daarnaast `ctxTijdVan`
  (het omgekeerde, nu lineair) en `vooruit` in renderBlok (|R| als bovengrens:
  klopt zolang het alleen afremt). Zonder rem moet de gouden hash blijven staan.
- Houd positieOp klein en zonder objecten. Draai na elke wijziging aan het
  audiopad `node test/renderblok.test.mjs`; zegt die "GC's in het schoonste
  venster", zoek dan met `--profiel` in de bench waar het zit.
- Keylock (Signalsmith, docs/KEYLOCK.md) komt in dezelfde worklet: ook die hoort
  zijn buffers één keer te maken en daarna te hergebruiken.
