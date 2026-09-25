# Beatgrid-restpunten (ROADMAP 24) — eindverslag spoor 2

Branch `spoor2/beatgrid-rest` (worktree agent-aea136e7bd99d0817), drie commits op `cc527e3`:

| commit | onderwerp |
|---|---|
| `e5a0c08` | het 156-bpm-stuk valt niet meer weg (tweedeKans in detect.js) |
| `2bbe487` | maat-anker per stuk, en de "1" knippert langer |
| `c43a6c7` | verfijnen na "tel 1 hier" gemeten en NIET gebouwd; meetscripts in tools/beatmeting/rest/ |

Niet aangeraakt: CLAUDE.md, HANDOFF, ROADMAP, VRAGEN, mappings/apc40mk2.json. Geen
schemawijziging, geen dependencies, niets geschreven in media/ of opnames/, server :8777
en Chrome niet aangeraakt. Alle metingen op fragmenten (onset.bin-plakken van 2-4,5 min,
audio met ffmpeg -ss/-t naar de scratchpad/tmp), nooit een heel album.

---

## 1. Het 156-bpm-stuk van het album — gerepareerd

Album = `f3a7DiCsm8k` "I will delete this album on September 22 at 22:22" (30:59). Bewaard
grid (heranalyse 23 sep): 7 stukken 150/140/150, waarvan 264-1145 s één opvulstuk op 139,93
(z 0,05). Het nummer op 156 zit op 11:27-13:39 (en een tweede op ~15:20-17:00).

**Nul van het hele album afgeleid** zonder het hele album te draaien: de stabiliteit per
venster hangt niet van de nul af, dus uit de bewaarde zekerheden van twee stukken
(120-144 s: 0,62; 232-264 s: 0,50) volgt de nulgrens exact: 18/22 = 0,818. Vensters moeten
op het raster van het hele album liggen (stap = 345 frames = 4,0055 s, niet 4 s): met een
ander begin lagen ze tot 7 frames anders en klopte er niets.

### Oorzaak
Niet minSec zelf, maar wat eraan voorafgaat:
1. `tempoCurve` schat per venster van 12 s een tempo met autocorrelatie. Midden in het
   nummer op 156 koos die vaak iets toevalligs: 148, 131, 112, 107, 98.
2. De zekerheid van dat venster wordt gemeten op dat VERKEERDE tempo (9-15 van de 22
   stapjes, onder de nul) → z = 0 → het venster telt als gat.
3. Over bleven negen zekere vensters in vier brokjes van 8, 4, 16 en 8 s, gescheiden door
   16, 44 en 20 s "gat".
4. `segmenteer` knipt bij elk gat, en een keten korter dan minSec zonder buur zonder gat
   "is ruis" → alle vier weg.

Terwijl één grid op 156,000 met één anker er van 11:27 tot 13:39 op past: op 156 houden
alle vensters 19-22/22 vast, en de fase van de puls per 12 s blijft binnen ±30 ms.

### Reparatie (`server/detect.js`)
- `segmenteer` opgesplitst in `ketens()` (aaneenrijgen, ongewijzigd gedrag) + opslokken.
- Nieuw `tweedeKans(curve, zekerOp, opties)`, aangeroepen in `analyseerGrid` vóór
  segmenteer: een keten korter dan minSec die binnen 60 s (`maxBrug`) een keten met
  hetzelfde tempo T heeft, zonder echt stuk (≥ minSec) van een ander tempo ertussen: de
  vensters daartussen worden ook op T gemeten (`faseStabiliteit`, dezelfde nulgrens).
  Houdt de fase vast (≥ minZekerheid en niet slechter dan op het eigen tempo), dan gaat
  het venster naar T.
- Octaven: een venster op T/2 gaat mee als de fase op T vasthoudt (ook als de halve tel
  iets beter scoort); een venster op 2T blijft ALTIJD staan (bij twijfel de tel, net als
  tempoUitEnvelope).
- Twee ketens die elk lang genoeg zijn worden nooit verbonden.
- Een tweede kans die geen stuk oplevert wordt teruggedraaid (anders kleurt hij de
  zekerheid van een gat).
- `analyseerGrid` kreeg optie `nulGrens` (vaste nul, alleen voor metingen op fragmenten).

### Meetuitkomsten voor/na (zelfde nul, zelfde vensters; `tools/beatmeting/rest/fragment.txt`)
| fragment | oud | nieuw |
|---|---|---|
| album 10:00-14:30 | niets (146,9 over alles, z 0,12) | **11:45-13:29 op 156,06, z 0,84**, fase per 12 s -48…+1 ms |
| album 14:40-18:40 | niets | **15:41-16:17 op 155,98, z 0,92** (tweede stuk op 156) |
| album 1:00-5:30 | 150: 2:00-2:24 z 0,62 · 140: 3:52-4:24 z 0,50 | 150: 2:00-2:48 z 0,71 · 140: 3:52-4:36 z 0,55 |
| album 18:00-22:00 en 23:00-26:00 | | gelijk |
| Bay Ledges (heel, 3:34) | 0:44-1:32 op **76,23** (octaaffout), z 0,48 | 0:44-1:32 op **153,66**, z 0,30 (fase 13 / 2 ms) |
| let it all go 2×, Sakamoto 3×, jungle-mix 3× | | gelijk, op één zekerheid na (jungle 1:28-2:40: 0,61 → 0,64) |

Tussenversies die ik verworpen heb omdat ze het elders slechter maakten:
- vensters tussen ELKE twee buren met hetzelfde tempo opnieuw meten: Sakamoto 34:26-37:47
  werd één stuk waarvan het grid tot 235 ms naast stond (tempo zwalkt ~1% over 3 min) →
  daarom alleen korte ketens redden;
- 2T omlaag laten gaan: Bay Ledges' octaaffout werd langer (0:44 → 0:32) en "zeker"
  (0,48 → 0,72) → daarom blijft 2T staan;
- zonder octaafregel splitste het stuk op 150 bij 2:00 in een stuk op 75 en een op 150.

### Tests (`test/detect.test.mjs`)
- Curve zoals het album (140 → 156 in brokjes van 8/4/16/8 s met gaten 16/44/20 s → 150):
  zonder tweede kans valt 156 weg; met: één stuk 68-172 op 156; de rand groeit niet;
  140/150 blijven.
- Wachters: een break zonder puls op 156 blijft een gat; brokjes > 60 s uit elkaar geen
  brug; twee lange ketens geen brug; half-time tussen 150 en 150 wordt 150; een venster op
  2T wordt niet gehalveerd.
- Audio end-to-end: 140 → 156 (brokjes van 6 s schone kick, ertussen fills op 107 bpm op
  willekeurige plekken, de kick loopt door) → 150. Nieuw: 68-144 op 156,00 z 0,86, fase
  15,6 ms; oud vond alleen 104-124 (de rest kreeg het grid van 140).

---

## 2. Verfijnen na "tel 1 hier" — gemeten, NIET gebouwd

Gemeten: snap alleen (A, zoals nu) tegen snap + `/grid/verfijn` met anker (B: verfijnTap +
voorflank op 24 s audio, overnemen als < 30 ms), plus varianten C (alleen voorflank op het
grid-tempo) en D (B, maar alleen als de voorflank gemeten is).

**Synthetisch** (ijkklanken, andere zaden/tempo's, 900× drukken ±25 ms; echte tel bekend):
A |p50| 3,7 / |p90| 21,0 ms, 18% > 10 ms → B 1,9 / 3,5 ms, 1% (ook met 1% tempofout;
C valt dan terug op A). Duidelijk beter.

**Echte muziek** (6 fragmenten; tel onbekend, derde mening = aanzet op 1 ms-resolutie,
mediaan over ±12 s, geijkt: scherpe aanzet 4-8 ms laat):
| fragment | A |p50|/|p90| | B | voorflank gelukt |
|---|---|---|---|
| jungle-mix 23:34 | 10,7 / 17,8 | 2,3 / 3,8 | 207/207 |
| let it all go 14:49 | 7,1 / 16,5 | 11,7 / 26,1 (≈20 ms te vroeg) | 36/108 |
| album 2:00 | 11,5 / 21,2 | 5,7 / 13,1 | 6/81 |
| album 11:45 | 12,7 / 22,3 | 13,2 / 22,4 | 0 |
| Sakamoto 28:30 | 9,7 / 19,0 | 10,9 / 23,7 | 0 |
| Bay Ledges | 13,4 / 24,7 | 11,8 / 29,8 | 0 |

Oordeel: niet meetbaar beter op Clay's materiaal → weggelaten, "tel 1 hier" snapt zoals
het deed. De voorflank lukt op 2 van 6 fragmenten; elders neemt de route de grove fase
(±20 ms), die niet beter is dan de klap. Waar hij lukt: jungle veel beter, let it all go
~20 ms te vroeg (voorflank steeds 20 ms vóór de grove fase: vermoedelijk een ander
instrument vóór de kick). Als het later toch moet: variant D, maar eerst uitzoeken wie er
bij let it all go gelijk heeft (luisteren of per instrument meten).

---

## 3. Maat-anker per stuk — gebouwd

### Wat
- `src/engine/beatgrid.js`: elk stuk `{ van, bpm, anker, zekerheid?, maat? }`. `maat` =
  tracktijd van een tel 1 op het eigen rooster. `_bouw()` rekent per stuk het telnummer
  van zijn "1" (`_maatB`).
- **Oude JSON zonder `maat`** (en alles van de analyse): bij het inlezen doorgeteld vanaf
  het vorige stuk = precies de maten van vroeger (test: maatbegin en barPhase op elke plek
  gelijk aan de oude formule). Vastgelegd als de eerste "1" op of na `van`. Een bestaande
  `maat` blijft staan waar hij staat (niet "netjes" verplaatsen: na ×2 zijn er twee
  kandidaten, en ½ moet de oude terugvinden). `maat: null` telt als geen maat.
- Daarna houdt elk stuk zijn eigen "1": een ander stuk bewerken verschuift hem niet meer
  (vroeger wel).
- Bewerken: `ankerHier` (tel 1 hier) zet tel én "1"; `schuif`/`schuifTel`/`lijnUitOp`
  nemen de "1" mee; `setBpm` houdt de tel die blijft liggen op dezelfde plek in de maat;
  `zetStuk` (tap, verfijning) idem voor de tel bij de tap-positie; `verdubbel` houdt de
  "1", `halveer` neemt de dichtstbijzijnde tel (×2 dan ½ geeft de oude terug); `splits`
  geeft het nieuwe stuk de eerste "1" op of na t.
- Overgangstel (laatste tel van het vorige stuk) telt in de maat van het vorige stuk.
- Rekenen met maten: `barPhase`, `isDownbeat`, `beatsBetween` (maatbegin; met stap > 1 —
  ver uitgezoomd in de golfvorm — per stuk uitgelijnd), nieuw `telInMaat(t)` (1..4) en
  `isMaatbegin(b)`. `stukken` geeft altijd dezelfde sleutelvolgorde (zoals de server).
- `src/control/actions.js`: read `track.N.barbeat` = welke tel van de maat je HOORT
  (positie min uitgangsvertraging, net als `track.N.phase`).
- `src/control/feedback.js`: op de "1" knippert een lampje een halve tel
  (`TEL_VENSTER_EEN = 0.5`) in plaats van een kwart; nog steeds twee berichten per LED per
  tel (getest). Zonder die read (oude mapping/tests) als vroeger.
- `server/library.js` `normaliseerGrid`: laat `maat` staan, voegt er geen toe, gooit een
  onbruikbare weg (grid blijft geldig). Geen schemawijziging: het zit in `grid_json`.
- `src/ui/laden.js`: `gridBewaard` = wat de engine van het geladen grid maakte, zodat
  laden alleen geen POST geeft (de aangevulde `maat` wordt pas bij een echte bewerking
  bewaard).
- `src/ui/apc-beschrijf.js`: uitleg van tel 1 hier noemt de "1".

### Tests
- `beatgrid.test`: oud grid (3 stukken) zonder maat = oude maten en barPhase overal;
  toJSON heeft een maat per stuk; opslaan/terughalen; `maat: null`; eigen "1" in stuk 2
  (maatbegin, telInMaat, overgangstel, uitgezoomd per stuk uitgelijnd); de hele
  bewerkingsreeks (tel 1 hier, schuiven, halve tel, bpm, ×2, ½, zetStuk); een ander stuk
  bewerken laat de maten staan; splitsen.
- `library.test`: maat gaat mee, geen maat = geen maat, onbruikbare maat valt weg,
  bewaren/teruglezen.
- `feedback.test`: "1" na een kwart tel nog fel, tel 2 gedimd, na een halve tel ook de
  "1" gedimd; verkeer ≤ 8 berichten in 4 tellen met de "1" erin; `track.N.barbeat` op
  een echt Beatgrid met uitgangsvertraging; null als hij stilstaat.
- `engine.test`: grid-modus scene 1 (tel 1 hier, gesnapt) maakt die tel de "1".

`nice -n 10 node test/alles.mjs` (op `c43a6c7`): **29 bestanden, 1967 checks, alles groen**
(beatgrid 123, detect 89, engine 389, feedback 101, library 74). Geen rood door belasting.
Bekende ruis in feedback.test (`read("track.3.filter") struikelde`, tracks 3-8 in de mock)
was er al vóór dit spoor.

---

## Wat NIET getest is
- Het hele album (bewust): de reparatie is op 5 albumfragmenten + 9 andere fragmenten
  gemeten; wat er op het hele album uitkomt (hoeveel stukken, welke zeker) niet. De nul van
  het hele album is afgeleid (0,818), niet opnieuw gemeten.
- Clay's album krijgt het nieuwe voorstel pas na ↻ (opnieuw analyseren) in de library: het
  grid heeft `bron: 'auto'` en wordt bij het opstarten niet opnieuw geanalyseerd.
- De fijne fase per stuk (`fijneFase` in maakGridHier, op de audio) zat niet in de
  fragmentmetingen; die stelt het anker per stuk nog bij (±30 ms).
- Niets in de browser of op de APC (geen Chrome in dit spoor): het langere knipperen op de
  "1", de maatlijnen in de golfvorm per stuk, de laden-wijziging (geen POST bij laden).
- De server met de nieuwe detect.js (niet herstart; draait nog de oude). Na merge:
  server herstarten.

## Aannames (kunnen verkeerd zijn)
- "Tel 1 hier" betekent de "1" van de maat (DJ-betekenis, en zo heet de knop). Eerder zette
  hij alleen een tel.
- Een halve tel fel op de "1" is een UX-keuze van mij; Clay kan hem terugdraaien met één
  constante (`TEL_VENSTER_EEN = TEL_VENSTER`).
- De wachters van tweedeKans (60 s, alleen korte ketens, 2T blijft) zijn gekozen op 14
  fragmenten van 5 nummers: kans op overfitting.
- Stukken die door de tweede kans gered worden, kunnen ZEKER worden (album 156: 0,84;
  150 bij 2:00: 0,71), dus sync en beat-loops mogen daar nu. De drempel 0,65 is op 23 sep
  geijkt toen de albumstukken 0,50-0,62 scoorden. Hun grids passen wel (fase per 12 s
  binnen ±50 ms, meestal ±20), maar dat is een verschuiving van de ijking.
- De "derde mening" voor restpunt 2 is zelf niet neutraal (klankafhankelijk 4-35 ms laat).

## Voorstel voor CLAUDE.md (sectie Beatgrid)
```
- Tweede kans (25 sep, docs/BEATGRID.md restpunt 1): de tempocurve van 12 s kiest midden in
  een nummer vaak een toevallig tempo; dan telt het venster als gat. Een keten korter dan
  minSec met binnen 60 s een keten op hetzelfde tempo T (geen echt stuk ertussen) laat de
  vensters ertussen opnieuw meten op T (`tweedeKans`, detect.js). T/2 gaat mee, 2T blijft
  staan (de tel, niet de maat), twee lange ketens nooit samen (één stuk = één tempo: over
  minuten loopt 0,5% zwalken een tel weg). Het 156-stuk van het album staat er nu in (na ↻).
  Meten op fragmenten: `tools/beatmeting/rest/fragment.mjs` met de nul van het hele nummer
  (album 18/22) en vensters op het raster van het hele nummer (345 frames, niet 4 s).
- Maat-anker (25 sep): elk stuk heeft `maat` (tracktijd van een tel 1, eigen rooster).
  Zonder (oude JSON, analyse) telt hij door vanaf het vorige stuk = de oude maten; daarna
  houdt elk stuk zijn eigen "1". Tel 1 hier zet tel én "1". Rekenen met maten ALTIJD via
  barPhase/telInMaat/isMaatbegin/beatsBetween, nooit met beat % beatsPerBar.
  `track.N.barbeat` = tel van de maat die je hoort; op de "1" knippert een lampje een halve
  tel. Server laat `maat` staan (grid_json, geen schemawijziging).
- Verfijnen na tel 1 hier is gemeten en NIET gebouwd: synthetisch beter, op Clay's muziek
  niet (voorflank lukt op 2 van 6 fragmenten, één daarvan 20 ms te vroeg).
```
