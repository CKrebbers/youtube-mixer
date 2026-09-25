# Beatgrid: het grid moet passen per stuk (bevinding 3) — spoor3/grid-past-2

Branch `spoor3/grid-past-2`, vanaf `spoor2/beatgrid-rest-c` (12776ba). Twee commits:

| commit | wat |
|---|---|
| `bfc5070` | detect.js: toets per stuk, splitsen, rest, bijstellen, samenvoegen + detect.test "elk stuk moet passen" |
| `3e72a44` | tools/beatmeting/rest/gridpast(.mjs/.txt), gridpast-synth(.mjs/.txt), lib.mjs `detectVan`, tools/README, BEATGRID.md punt 4 |

Niet aangeraakt: CLAUDE.md, HANDOFF, ROADMAP, VRAGEN, mappings/apc40mk2.json, de oude worktree
(agent-af518b47…; de patch is met `diff` van de bestanden gemaakt, niet met git -C). Niets in
media/ geschreven (library.db één keer read-only gelezen voor de bewaarde grids), geen Chrome,
:8777 niet aangeraakt, geen pkill. Metingen alleen op fragmenten (onset.bin, ≤ 4,5 min).

`nice -n 10 node test/alles.mjs`: **29 bestanden, 2006 checks, alles groen** (detect.test 126 ok, 31 s).

Incident: `server/detect 2.js` (iCloud-conflictkopie, ontstaan door mijn `sed -i` om 14:31)
vergeleken: een tussenversie van mijn eigen detect.js (voorganger + één diag-regel), geheel
achterhaald → verwijderd. Daarna geen `sed -i` meer. Nooit `git add -A` gebruikt.

---

## Wat de voorganger had (283 regels in detect.js, niet gecommit) en wat ik ervan vond

Opzet was goed en is gebleven: `vensterFasen` + `stukPast` (toets per stuk), `faseSprongen`
(kandidaat-grenzen, modellen vast/lijn), kandidaten met echte grids toetsen, `verfijnGrens`,
recursief splitsen, kant < minSec = rest, `PAST_NIET` = 0,5 als plafond per venster.
Gemeten op zijn laatste stand (synthetisch, zijn eigen harnas): nog 4 vals zeker (S2, S7, F4, F5).

Fouten die ik vond en herstelde:
1. **verfijnGrens las de envelope alleen OP elke tel.** Een grid dat 40 ms naast de klap ligt
   (normaal: het anker zit op de klap, het zwaartepunt van de envelope ernaast) las dan naast
   een smalle piek en vond niets; de grens viel willekeurig in het bereik (S7: 60 → 75,6 s, het
   volgende nummer zat 16 s in het zekere stuk). Nu: per frame envelope × cos(fase), en het
   anker van L/R eerst verschoven naar het zwaartepunt (let it all go 31:20 lag 0,2 tel naast).
2. **Na het verschuiven van de grens werden kanten die "pasten" niet opnieuw getoetst** (hun
   fasen hoorden bij de oude grens). Nu altijd beide kanten opnieuw.
3. **Zonder R (rest) telde de rest 0**: bij een tempowissel middelt de cosinus naar nul en won
   het toeval (S2: grens 15 s te laat). Nu krijgt de rest wat het beste grid daar zou halen ×
   cos(0,15 tel).
4. **faseSprongen was n² log n per helling** (modus per grens per helling): 4 s op een segment
   van 20 min, en een mix van een uur ~60 s. Nu histogrammen: n × hellingen × vakken.
5. **Eén grens per stap, en splitsen alleen als een kant meteen past**: drie nummers of meer op
   één tempo werden onzeker (synthetische mix van 20 min: 200-990 s onzeker). Nu: ook splitsen
   als geen kant past maar de grens ≥ 2 vensters uitlegt, tot 6 diep; en twee grenzen met een
   rest ertussen (versnelling).
6. **maxAfwijking 0,15 rond de modus** liet op Clay's muziek een sprong van 0,28 tel binnen één
   zeker stuk toe (let it all go 14:49 en 31:18: de modus ging ertussen liggen). Nu 0,1; op de
   48 fragmenten verandert daardoor geen ander zeker stuk (wijdste: jungle 7:48-10:40, 0,14 tel).
7. `anders` gebruikte het tempo van de tempocurve; die zat bij Sakamoto 36:41 2% naast. Nu
   gezocht (±4% in stapjes van 0,25%), factor 2. Gemeten verhouding in de stukken van 22
   fragmenten: p50 1,01, p95 1,3; in zekere stukken > 1,4 alleen in die versnelling.

Nieuw erbij (elk met een meting die het nodig maakte):
- **Rest in het midden** (faseSprongen en verfijnGrens, rest < 20 s): versnelling waarin de
  muziek in 16 s een tel voorloopt en weer op het grid valt; met één grens zat de helft in
  elk zeker stuk. Een middendeel ≥ 20 s wordt als eigen stuk getoetst (Sakamoto 36:33-36:57 op 123,05).
- **Rest blijft een gat**, ook korter dan een venster (aaneensluiten schoof er anders overheen).
- **Bijstellen op de helling** (`faseHelling`): pas als splitsen niets oplevert, of meteen als
  de fasen echt op een rechte lijn liggen (rest ≤ 0,05 tel). Eerder toegepast maakte het van een
  sprong (let it all go 31:40) of tempowissel (Sakamoto 37:25) één scheef grid "dat paste".
- **Buren uit hetzelfde segment samenvoegen** als ze samen passen (niet over segmenten heen:
  segmenteer houdt jungle 2:40/4:16 bewust apart, 0,73 naast 0,56).
- **Kandidaten lokaal toetsen** (±120 s bij de grens), de gekozen kanten daarna helemaal.
- Uitgeprobeerd en weggelaten: een randregel ("twee vensters naast aan de rand") ving S8, maar
  knipte het album op 156 (11:45-13:29, trage drift) zonder reden in tweeën.

## Metingen voor/na

Synthetisch (`tools/beatmeting/rest/gridpast-synth.txt`, echte kicks bekend; VALS ZEKER = zeker
en > 5% van de kicks > 0,15 tel naast):

| | vóór (12776ba) | na |
|---|---|---|
| vals zekere stukken | 14 (S1, S1b, S2, S2b, S4b, S7, F1, F1q, F2, F2b, F4, F5, V, mix 20 min) | 0 |
| vals zekere tijd | 3960 s | 0 s |
| goed-zekere tijd per scenario | — | nergens minder dan vóór |
| mix van 60 min, 18 nummers op één tempo | 1 stuk, 53% naast, 4,0 s | 18 stukken, grenzen ≤ 7 s, 11,8 s |

Fragmenten (`gridpast.txt`, 48 stuks: fragment.txt, de controle, en 29 andere plekken/korte
nummers; "naast" = een blok van 12 s > 0,15 tel van de fase van de meeste blokken):
41 bit-gelijk (o.a. album 11:45-13:29 op 156, 15:41, 2:00-2:48, 29:38, 19:05; alle jungle-stukken;
Bay Ledges; let it all go elders; de korte nummers). Zeker mét een blok naast: **4 → 0**.

| fragment | vóór | na |
|---|---|---|
| let it all go 14:49 | 14:49-15:45 zeker (63 -1 -57 -20 ms) | 15:06-15:45 zeker op 169,72 (5 -6 25); daarvoor onzeker |
| let it all go 31:18 | 31:18-32:02 zeker (63 52 -33) | 31:18-31:40 + 31:40-32:02 zeker, elk één fase |
| Sakamoto 28:30 | 28:30-29:58 zeker (… -68 -227) | 28:30-29:29 (115,21) + 29:29-29:58 (116,68), zeker |
| Sakamoto 35:59 | 35:59-37:47 zeker (-114 107 -83) | 35:59-36:33, 36:33-36:57 (123,05), 36:57-37:31 zeker; 37:31-38:20 onzeker |
| Sakamoto 34:26 | 34:26-35:18 onzeker (0,54) | 34:37-35:18 zeker (0,65; 10 10 -2) — nieuw zeker, blokken kloppen |
| Sakamoto 2:28 / 33:34 / 42:55 | onzeker | anders verdeeld, onzeker |

Rekentijd: fragmenten 1,2-1,8× (enkele honderden ms); worst case zie tabel; detect.test 21 → 31 s.

## Tests (detect.test.mjs)

"elk stuk moet passen: sprong, tempowissel, schoon" (audio, 14 checks): halve tel verschoven
op 150, kwart tel op 124, 150 → 153, 128 → 129,5 (geen zeker stuk met > 3% kicks > 0,15 tel naast;
beide nummers zeker, eigen tempo, grens ≤ 4 s), drie nummers, staart van 15 s, versnelling,
schoon 128 met hats, 122 met ±15 ms speling, PAST_NIET tussen GEEN_PULS en ZEKER_VANAF.
Met de detect.js van 12776ba: alle rood behalve de twee schone (gecontroleerd met een kopie).
"elk stuk moet passen: de onderdelen" (14 checks): stukPast (incl. de sprong van 0,28 die met
0,15 past en met 0,1 niet), faseSprongen (sprong, tempowissel met lijnmodel, versnelling = rest),
faseHelling, verfijnGrens (grids 30 ms naast de klap, ook zonder R).

## Niet getest
- Hele albums/mixen (bewust); de nul van het fragment ≠ die van het hele nummer (album: vaste 18/22).
- Niets in de browser of met de APC; de server is niet herstart. Grids met `bron: 'auto'`
  veranderen pas na ↻ in de library (of heranalyse als ze leeg/oud zijn).
- Rekentijd op een echte mix van een uur (alleen synthetisch: 11,8 s tegen 4,0 s, in de worker).
- Bekende grens: kort stuk op 1-2% ander tempo aan de rand van een lang stuk (S8) blijft hangen,
  zoals vroeger; een deel van net onder de 20 s wordt een rest ook als er een grid op past.

## Voorstel CLAUDE.md (sectie Beatgrid), niet zelf gedaan
```
- Elk stuk moet op ZIJN grid passen, niet alleen stabiel zijn (stukPast, detect.js): fase per
  venster ±0,1 tel rond de fase met de meeste buren (niet 0,15: dat liet een sprong van 0,3 tel
  toe), reeksen, en vensters met een duidelijker puls op een tempo tot 4% ernaast tellen als
  naast. Past het niet: splitsen (faseSprongen, verfijnGrens; ook twee grenzen met een rest
  ertussen), kant < 20 s = rest = gat, onzeker (PAST_NIET 0,5); niets te splitsen = bijstellen
  op de helling (faseHelling) of onzeker. Een stuk dat meteen past houdt het grid van vroeger.
  Metingen: tools/beatmeting/rest/gridpast*.mjs (vals zeker 14 -> 0 synthetisch, 4 -> 0 op 48
  fragmenten). Na merge: server herstarten, ↻ op de mixen.
```
