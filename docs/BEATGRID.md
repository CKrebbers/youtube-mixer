# Beatgrid: onderzoek en plan (23 september 2026)

Clay: "zo makkelijk en snel mogelijk de beatgrid altijd juist hebben".
Twee onderzoeken: meting op Clay's eigen library (scripts in de scratchpad:
varve-beat/*.mjs) en webonderzoek naar Rekordbox, Traktor, Serato, Mixxx,
Engine DJ, djay en algoritmes.

## Wat er nu is
- Een grid ontstaat ALLEEN via TAP (≥ 4 tikken) + verfijning op de server.
  `tempoUitEnvelope`, `tempoCurve`, `segmenteer` bestaan maar worden nergens gebruikt.
- Eén grid per link: één bpm + één anker. Albums en nummers zonder klik passen daar niet in.

## Gemeten op Clay's library (4 nummers)
| Nummer | Duur | Eén grid past? | Bestaand grid |
|---|---|---|---|
| zoned out | 41:47 | nee — geen puls (2% van de vensters) | geen |
| Bay Ledges – Ciel | 3:33 | nee — tempo zwalkt ±1% (demo zonder klik) | 153 klopt alleen 2:10–2:40 |
| Sakamoto-playlist | 60:22 | nee — losse stukken, rubato | 59,54 houdt nergens fase |
| "I will delete this album" | 30:59 | nee — puls op ~140/156/150/163 per nummer | 61,9 past nergens; anker voorbij het einde |

Waar het faalt:
1. Octaafcheck kent alleen ×2/½, niet 3:2 (Bay Ledges: 102 gevonden, 153 klopt).
2. Eén grid per link past niet bij albums en nummers zonder klik.
3. Zonder puls maakt verfijnen een tap SLECHTER: 13–25 van 40 proeven landen op de offbeat
   (de server gooit de fase van de tap weg).
4. Vier tikken → tempofout p50 2–4%, vaak buiten de marge van 3%.
5. `segmenteer`: telt gaten niet, laat een te kort eerste stuk staan, grenzen ~6 s te vroeg.
6. Grid structureel 10–30 ms te laat bij zachte aanzetten (onsetVertraging geijkt op één tik).
7. De zekerheidsmaat voorspelt slecht (vals hoog op piano, vals laag op ambient-elektronisch);
   de score van `verfijnTempoFase` scheidt beter; fase-stabiliteit per venster het best.

Tap-simulatie (40 proeven × 8 plekken met puls):
| | 4 tikken goed | offbeat | 8 tikken goed | offbeat |
|---|---|---|---|---|
| nu | 53% | 12% | 74% | 8,5% |
| rechte lijn door de tikken + fase ±25% | 72% | 0% | 87% | 0% |

Kosten: onset 0,3 s per minuut audio (worker), tempocurve over 60 min 0,1 s. Automatisch
analyseren bij het binnenhalen kost dus bijna niets.

## Hoe anderen het doen
- Variabel tempo = korte lijst markers {plek, bpm} (Rekordbox Dynamic, Traktor, Engine DJ,
  Mixxx). Corrigeren geldt "vanaf hier"; "opnieuw detecteren vanaf hier" (Mixxx infer right).
- Onzekerheid tonen doet bijna niemand (alleen VirtualDJ: roze strook waar het tempo schommelt).
- Snelste correctie: grid-modus op de controller — tel 1 hier (snapt naar de dichtstbijzijnde
  klap), schuiven, ½/×2, halve tel, tap, lock. Fase of octaaf: 1–2 handelingen.
- Algoritme voor weinig percussie: PLP (predominant local pulse) op de bestaande envelope,
  plain JS. Neuraal (Beat This!, ~9 MB + onnxruntime) alleen als meten aantoont dat het moet.

## Plan (voorgesteld)
A. Tap en verfijning betrouwbaar (geen keuzes): rechte lijn door de tikken, fase van de tap
   als voorwaarde, marge die meeschaalt; weigeren als er geen puls is ("geen puls gevonden",
   tap blijft staan); 3:2 in de octaafkeuze; segmenteer repareren; zekerheid = fase-stabiliteit;
   fase-afwijking ijken.
B. Grid in stukken (tempokaart): lijst {van, bpm, anker} in tracktijd, schema v5. Een tap of
   "tel 1 hier" zet alleen het stuk waar je bent; "nieuw stuk hier" als eigen actie.
C. Automatisch voorstel bij binnenhalen (en voor wat er al staat), met zekerheid per stuk.
   Zeker = meteen gebruiken; onzeker = zichtbaar als strook onder de golfvorm, geen sync of
   beatloops daar. Met de hand bevestigd = op slot, nooit overschreven.
D. Grid-modus op de APC: Shift + Metronome aan/uit. Tap = tikken; Nudge ± = grid ±5 ms
   (shift ±1 ms); cue level = bpm ±0,01; scene 1 = tel 1 hier (snapt ±30 ms naar een klap),
   2 = ×2, 3 = ½, 4 = halve tel verschuiven, 5 = nieuw stuk hier. Controle VISUEEL (knipperen
   op de tel, klappen en gridlijnen in de zoom): een hoorbare klik zou de zaal horen, want
   VARVE heeft geen koptelefoon-uitgang (F1).

## Restpunten (25 september 2026)

### 1. Het 156-bpm-stuk van het album viel weg — gerepareerd (`tweedeKans` in detect.js)
Gemeten op fragmenten van "I will delete this album" (onset.bin, alleen lezend, vensters op
het raster van het hele album; de nul van het hele album afgeleid uit de bewaarde
zekerheden: 18/22 = 0,818).

Oorzaak: niet minSec zelf, maar wat eraan voorafgaat. De tempocurve schat per venster van
12 s een tempo, en midden in het nummer op 156 (11:27-13:39) koos die vaak iets
toevalligs: 148, 131, 112, 107, 98. Daar werd de stabiliteit op het verkeerde tempo
gemeten (9-15 van de 22 stapjes = onder de nul), dus die vensters telden als gat. Over
bleven negen zekere vensters in vier brokjes van 8, 4, 16 en 8 s, gescheiden door 16, 44
en 20 s "gat". segmenteer knipt bij elk gat, en een brokje korter dan minSec tussen twee
gaten gaat weg als ruis: alle vier. Terwijl één grid op 156,000 er van 11:27 tot 13:39 op
past: 19-22 van de 22 stapjes, fase van de puls per 12 s binnen ±30 ms.

Reparatie: een keten (aaneengeregen vensters, `ketens()`) die korter is dan minSec krijgt
een tweede kans. Ligt er binnen 60 s een keten met hetzelfde tempo T, zonder echt stuk
(≥ minSec) van een ander tempo ertussen, dan worden de vensters daartussen ook op T
gemeten; houdt de fase daar vast (boven de nul, niet slechter dan op het eigen tempo), dan
horen ze bij T. Een venster op T/2 gaat mee als de fase op T vasthoudt; een venster op 2T
blijft altijd staan (bij twijfel de tel). Twee ketens die elk lang genoeg zijn worden nooit
verbonden. Een tweede kans die geen stuk oplevert wordt teruggedraaid.

Voor/na (zelfde nul, zelfde vensters):
| fragment | oud | nieuw |
|---|---|---|
| album 10:00-14:30 | niets (146,9 over alles, z 0,12) | 11:45-13:29 op 156,06, z 0,84, grid binnen -48…+1 ms |
| album 14:40-18:40 | niets | 15:41-16:17 op 155,98, z 0,92 (het tweede stuk op 156) |
| album 1:00-5:30 | 150: 2:00-2:24 z 0,62; 140: 3:52-4:24 z 0,50 | 150: 2:00-2:48 z 0,71; 140: 3:52-4:36 z 0,55 |
| album 18:00-22:00, 23:00-26:00 | 150: 19:05-20:01 | gelijk |
| Bay Ledges (heel, 3:34) | 0:44-1:32 op 76,23 (octaaffout), z 0,48 | 0:44-1:32 op 153,66, z 0,30 |
| let it all go (2×), Sakamoto (3×), jungle-mix (3×), 2-4 min elk | | gelijk, op één zekerheid na (jungle 1:28-2:40: 0,61 -> 0,64) |

Tussenversies die het slechter maakten (en waarom de regels zijn zoals ze zijn): vensters
tussen ELKE twee buren met hetzelfde tempo opnieuw meten voegde bij Sakamoto 34:26-37:47
drie stukken samen tot één grid dat 235 ms naast stond (tempo zwalkt 1% over drie
minuten); een venster op 2T omlaag laten gaan maakte het octaaffoute stuk van Bay Ledges
langer en "zeker" (0,48 -> 0,72).

Let op: het album heeft een grid met `bron: 'auto'`; de server heranalyseert dat niet
vanzelf. ↻ in de library (opnieuw analyseren) geeft het nieuwe voorstel.

Controle (25 september 2026, controleur): de tweede kans redt een venster als de fase op T
VASTHOUDT, niet als hij op dezelfde PLEK ligt als bij de buren (stabiliteit vergeeft een
vaste drift tot ~4 bpm en ziet een fasesprong maar in een paar stapjes). Synthetisch
plakte hij zo een volgend nummer aan het stuk ervoor, "zeker": op hetzelfde tempo een
halve tel verschoven (stuk 0-76 s werd 0-152 s, 61% van de kicks tot 181 ms naast), op 154
tegen 150 (52%), een half-time nummer in een andere fase (33%), een kort stuk 2% sneller
achter een lang stuk. Op Sakamoto 1:08-1:50 lagen de geredde vensters tot 268 ms naast
(daar niet zeker, z 0,48). Daarom `eenGridPast`: het grid dat het stuk krijgt naast de
fase van elk venster met een duidelijke puls; ligt meer dan 10% van alle vensters, of van
de geredde, meer dan 0,15 tel naast, dan telt de tweede kans in dat stuk niet (terug naar
wat het was). Alle winst hierboven blijft (op de geredde stukken hooguit 0,12 tel naast:
album 11:45, 47 ms); in elk synthetisch geval is de uitkomst weer die van vóór de tweede
kans. Test: detect.test.mjs, "tweede kans plakt geen ander nummer vast" (faalt zonder).

Wat er NIET mee opgelost was (bestond al, ook zonder tweede kans): segmenteer rijgt
vensters op hetzelfde tempo (±4%) aaneen zonder naar de fase te kijken, en de zekerheid
van een stuk is de stabiliteit van zijn vensters, niet of zijn ene grid past. Twee nummers
op hetzelfde tempo zonder duidelijk gat ertussen worden zo één "zeker" stuk (synthetisch
12-22% van de kicks naast). Opgelost in punt 4 hieronder.

### 2. Na "tel 1 hier" verfijnen met /grid/verfijn — gemeten, NIET gebouwd
Vraag: wordt de tel beter als de browser na "tel 1 hier" (snap ±30 ms naar een klap) de
route /grid/verfijn aanroept met `{ bpm, positie, anker }` (verfijnTap met het anker als
voorwaarde, dan de voorflank op 24 s audio, `fijneFase`) en het anker overneemt als het
minder dan 30 ms verschuift? Metingen en scripts: `tools/beatmeting/rest/tel1*.mjs`,
uitkomst `tel1.txt`.

Synthetisch (de ijkklanken met andere zaden en tempo's, 900 keer drukken ±25 ms naast
de tel, fout t.o.v. de ECHTE tel): duidelijk beter.
| | \|p50\| | \|p90\| | > 10 ms |
|---|---|---|---|
| A snap (zoals nu) | 3,7 ms | 21,0 ms | 18% |
| B + /grid/verfijn | 1,9 ms | 3,5 ms (3,7 bij een grid-tempo 1% naast) | 1% |
| C alleen voorflank op het grid-tempo | 1,9 ms | 3,7 ms, maar bij 1% tempofout niets meer (profiel uitgesmeerd) | 2% / 18% |

Op Clay's muziek (6 fragmenten, alleen lezend) is de echte tel onbekend. Derde mening:
de aanzet op 1 ms-resolutie, mediaan over ±12 s (geijkt: scherpe aanzet 4-8 ms laat).
| fragment | A snap \|p50\|/\|p90\| | B verfijnd | voorflank gemeten |
|---|---|---|---|
| jungle-mix 23:34 (174) | 10,7 / 17,8 | 2,3 / 3,8 | 207 van 207 |
| let it all go 14:49 (170) | 7,1 / 16,5 | 11,7 / 26,1 (gem. -10 ms) | 36 van 108 |
| album 2:00 (150) | 11,5 / 21,2 | 5,7 / 13,1 | 6 van 81 |
| album 11:45 (156) | 12,7 / 22,3 | 13,2 / 22,4 | 0 |
| Sakamoto 28:30 (115) | 9,7 / 19,0 | 10,9 / 23,7 | 0 |
| Bay Ledges 0:00 (157) | 13,4 / 24,7 | 11,8 / 29,8 | 0 |

Oordeel: niet meetbaar beter op het materiaal waar het om gaat. De voorflank lukt maar op
twee van de zes fragmenten; waar hij niet lukt neemt de route de grove fase (envelope van
93 ms, ±20 ms) in plaats van de klap, en dat is niet beter dan snappen. Waar hij wel lukt
is het één keer veel beter (jungle) en één keer ~20 ms te vroeg (let it all go: de
voorflank ligt daar steeds 20 ms vóór de grove fase, waarschijnlijk een ander instrument
vóór de kick). Daarom weggelaten; "tel 1 hier" snapt zoals het deed. Wie het later wil:
alleen overnemen als de voorflank gemeten is (variant D) houdt jungle en laat de rest
staan, maar let it all go blijft dan 20 ms te vroeg — eerst uitzoeken wie daar gelijk
heeft (luisteren of een meting per instrument).

### 3. Maat-anker per stuk — gebouwd (`maat` in elk stuk van de tempokaart)
Vroeger telden de maten door over de hele kaart: tel 0 (het anker van het eerste stuk)
was een "1", en elke vierde tel daarna, over alle stukken heen. Na een tempowissel (een
nieuw nummer op het album) viel de "1" daardoor op een willekeurige tel.

Nu heeft elk stuk `maat`: de tracktijd van een tel 1 op zijn eigen rooster.
- Oude JSON zonder `maat` (en wat de analyse maakt): bij het inlezen krijgt elk stuk er
  een, doorgeteld vanaf het vorige stuk: precies de maten van vroeger (getest: maatbegin
  en barPhase op elke plek gelijk). Vastgelegd als de eerste "1" op of na `van`.
- Daarna houdt elk stuk zijn eigen "1": een ANDER stuk bewerken verschuift hem niet
  meer (vroeger wel: een andere bpm vooraan telde door tot achteraan).
- Tel 1 hier (grid-modus scene 1) zet de tel én de "1". Schuiven, halve tel en
  uitlijnen nemen de "1" mee; een tempo bijstellen (encoder, tap, verfijning) houdt de
  tel bij de plek waar je bent op dezelfde plek in de maat; ×2 houdt de "1" waar hij
  was, ½ houdt de "1" als tel: de tellen op 1 en 3 blijven (26 sep, VRAGEN J26;
  ×2 en ½ geven elkaar in beide volgordes het oude grid terug); een
  nieuw stuk neemt de maten mee (op zijn eigen rooster: in de laatste maat vóór een
  stuk op een ander tempo werd tel 3 anders een "1"; hersteld door de controleur).
- Gebouwd 26 sep (Clay: advies J26): ½ liet de tel het dichtst bij de speelkop
  liggen, ook op tel 2 of 4; dan schoof de "1" een tel op en gaf ×2 hem niet terug.
  Nu begint het nieuwe rooster op de "1" (`_schaal` in beatgrid.js; zonder
  maat-anker de oude regel). Getest in beatgrid.test.mjs, faalt op de oude code.
- Een overgangstel (de laatste tel van het vorige stuk) telt nog in de maat van het
  vorige stuk.
- Wat ermee rekent: `barPhase`, `isDownbeat`, `beatsBetween` (maatbegin, ook ver
  uitgezoomd per stuk uitgelijnd: de golfvorm), en nieuw `telInMaat(t)` (1..4).
- Knipperen op de tel: nieuwe read `track.N.barbeat` (welke tel van de maat je HOORT);
  op de "1" knippert een lampje een halve tel in plaats van een kwart
  (`TEL_VENSTER_EEN` in feedback.js). Nog steeds twee berichten per LED per tel.
  Dit is een keuze (aanname): zo zie je op de APC waar de maat begint.
- Geen schemawijziging: het staat in `grid_json`; `normaliseerGrid` (server) laat `maat`
  staan en voegt er geen toe. Een grid wordt niet bewaard alleen omdat hij geladen werd
  (laden.js vergelijkt met wat de engine ervan maakte), pas bij een echte bewerking.

### 4. Het grid moet passen, op elk stuk — gebouwd (`stukPast` en splitsen in analyseerGrid)
De zekerheid van een stuk zei alleen dat de fase in elk venster VASTHOUDT, niet dat het
ene grid van het stuk er overal op past. Twee nummers op (bijna) hetzelfde tempo zonder
gat werden zo één zeker stuk, en sync en beat-loops vertrouwden een grid dat naast de
muziek lag. Gemeten vóór (12776ba): synthetisch 14 valse zekere stukken (tot 73% van de
kicks meer dan 0,15 tel naast), op Clay's muziek vier zekere stukken met een blok van 12 s
dat meer dan 0,15 tel naast de rest lag: let it all go 14:49-15:45 en 31:18-32:02,
Sakamoto 28:30-29:58 en 35:59-37:47.

Hoe het nu gaat (detect.js, alles achter analyseerGrid):
- **Toets per stuk** (`stukPast`): per venster met een duidelijke puls de fase op het grid
  van het stuk. Past niet als meer dan 10% (één mag altijd) verder dan 0,1 tel van de fase
  met de meeste buren ligt, als drie op een rij naast liggen, of twee op een rij meer dan
  0,25 tel. Een venster waarvan de puls op een tempo tot 4% ernaast twee keer zo duidelijk
  is, telt als naast (`anders`, gezocht in stapjes van 0,25%: de tempocurve zat er bij een
  versnelling 2% naast). 0,1 en niet 0,15 zoals eenGridPast: de fase met de meeste buren
  kiest zijn plek zelf, dus ±0,15 liet een sprong van 0,3 tel toe, en die zat er bij let it
  all go twee keer in (een kwart tel, 100 ms op 170).
- **Past het niet: splitsen.** `faseSprongen` zoekt op de vensters één grens, of twee met
  een rest ertussen (korter dan 20 s: een versnelling waarin de muziek een tel wegloopt en
  daarna weer op het grid valt), met twee modellen per kant: dezelfde fase (zelfde tempo,
  ander nummer) of een fase die gestaag wegloopt (een tempo tot 4% ernaast). De kandidaten
  worden met echte grids getoetst, per kant op hooguit 120 s bij de grens; `verfijnGrens`
  zet de grens daarna op de envelope (cosinus van de fase per frame, met een rest waar
  geen van beide past), beide kanten worden over hun hele lengte opnieuw verfijnd en
  getoetst, en zo verder, hooguit 6 keer diep.
- Een kant korter dan 20 s (minSec) wordt geen stuk maar een **rest**: een gat met het grid
  van de buur en een zekerheid van hooguit 0,5 per venster (`PAST_NIET`), dus onzeker. Een
  rest blijft een gat, ook korter dan een venster (anders schoof de buur er weer overheen).
- Levert splitsen niets op: het grid **bijstellen** op de helling van de fasen
  (`faseHelling`: let it all go 15:06-15:45 liep met 170,27 in 36 s een kwart tel weg, met
  169,72 past het), anders blijft het stuk heel en onzeker (rubato, een tempo dat zwalkt).
  Niet eerder: een sprong of een tempowissel is ook "schuin", en bijgesteld paste die binnen
  de marge op een tempo dat nergens klopte. Alleen als de fasen echt op een rechte lijn
  liggen (elk venster binnen 0,05 tel) mag het meteen.
- Buren uit hetzelfde segment die samen ook passen, worden weer één stuk.
- **Een break is geen ander nummer** (controle, zie onder): liggen de stukken vóór en na
  een tussendeel van hooguit 32 maten op één doorlopend grid, en ligt de puls in het
  tussendeel (per blok van 4 s) overal op de tel of overal precies op de offbeat, dan wordt
  het weer één stuk met het grid door beide kanten (over een segmentgrens: één stuk per
  segment, allebei met dat grid).
- Een stuk dat meteen past, krijgt precies het grid van vroeger.

Gemeten na (scripts en uitkomst: `tools/beatmeting/rest/gridpast*.mjs/.txt`):
- Synthetisch (`gridpast-synth`: de scenario's van de tweede kans plus schone sprongen,
  tempowissels, een staart van 15 s, drie nummers, een versnelling en een mix van 20
  minuten): valse zekere stukken 14 → 0; geen scenario houdt minder goed-zekere tijd over.
- 48 fragmenten van Clay's library (`gridpast`): 41 precies gelijk (o.a. het album op 156
  11:45-13:29 en 15:41, 2:00-2:48, 29:38; alle jungle-stukken; Bay Ledges; de korte
  nummers), 7 anders; zeker met een blok van 12 s > 0,15 tel naast: 4 → 0.

| fragment | vóór | na |
|---|---|---|
| let it all go 14:49 | 14:49-15:45 zeker, blokken 63 -1 -57 -20 ms | 15:06-15:45 zeker op 169,72 (5 -6 25), ervoor onzeker |
| let it all go 31:18 | 31:18-32:02 zeker, 63 52 -33 | 31:18-31:40 en 31:40-32:02 zeker, elk één fase (een sprong van 0,28 tel) |
| Sakamoto 28:30 | 28:30-29:58 zeker, laatste blok -227 ms | 28:30-29:29 op 115,21 en 29:29-29:58 op 116,68, allebei zeker |
| Sakamoto 35:59 | 35:59-37:47 zeker, -114 107 -83 | 35:59-36:33 (119,98), 36:33-36:57 (123,05: de versnelling), 36:57-37:31 (120,43) zeker; daarna onzeker |
| Sakamoto 34:26 | 34:26-35:18 onzeker (0,54) | 34:37-35:18 zeker (0,65, blokken 10 10 -2) |
| Sakamoto 2:28, 33:34, 42:55 | onzeker | anders verdeeld, nog steeds onzeker |

- Rekentijd: gewone fragmenten 1,2-1,8×; een synthetische mix van een uur met 18 nummers
  op één tempo zonder gat: 11,8 s tegen 4,0 s (vóór één vals zeker stuk, 53% naast; na alle
  18, grenzen binnen 7 s). Niet het ergste geval: zie de controle hieronder (tot ~17 s).
  detect.test: 21 → 31 s.
- Test: detect.test.mjs, "elk stuk moet passen" (een sprong van een halve en van een kwart
  tel, 150 → 153 en 128 → 129,5, drie nummers, een staart, een versnelling, twee schone
  stukken; en de onderdelen los). Met de detect.js van vóór falen ze, op de schone na.

Controle (25 sep, `integratie-r5`; verslag in `docs/verslagen/2026-09-25/controle-grid-past.md`,
de proefscripts zijn niet bewaard):
- **Hersteld: een break werd een eigen grid.** 128 met kicks en zachte offbeat-hats, in de
  break alleen hats op de offbeat (ook: een bas op de offbeat, claps op 2 en 4 met hats):
  een break van 60 s werd een eigen ZEKER stuk een halve tel naast (100% van de tellen), een
  van 16-32 s een onzeker gat; vóór de toets was het één zeker stuk met het goede grid. Nu
  weer dat (de break-regel hierboven). Een break van stilte blijft een gat, zoals altijd.
  Test: detect.test "een break van 16/32/60 s" (faalt op de code van de bouwer) en
  "hetzelfde patroon 0,2 tel verschoven" (faalt als de regel elke vaste fase neemt).
- Niet elke vaste fase is een break: let it all go 31:40-32:00 ligt 0,2 tel (70 ms, per blok
  van 4 s) voor het grid eromheen, met precies hetzelfde klappenpatroon (op de tel, ¼ en ½: 42/30/14% van de
  klappen, daar alles 0,2 tel verschoven). Een ander grid, dus splitsen had daar gelijk; een
  eerste versie van de break-regel plakte het weer vast. Daarom alleen op de tel of precies
  op de offbeat, en de fase per blok van 4 s (vensters van 12 s overlappen in een kort
  tussendeel bijna helemaal, en dan leek de versnelling V ook "vast").
- Getoetst en goed bevonden (geen verschil tussen bouwer en herstel): live drums met een
  tempo dat 1-3% wandelt (4 min: vóór één vals zeker stuk, nu twee die passen; een uur: nog
  4 van de 24 zekere stukken naast, vóór alles), swing (ongewijzigd één stuk), een
  DJ-overgang (fase 0,3 of 1,2% tempo: nu gesplitst).
- 48 fragmenten en de synthetische set van de bouwer: precies gelijk aan de bouwer.
- Een synthetisch uur (min van twee rondes; vóór → na): schoon 3,9 → 4,8 s; 18 nummers op
  150 zonder gat 4,1 → 13,5 s; live drums 3,9 → 17 s; rubato 4,2 → 14,5 s; 15 nummers met
  een break 4,0 → 14 s (bouwer 14,4 s, 4 valse zekere stukken; herstel 0). In de worker,
  dus de decks merken het niet; binnenhalen van een uur wacht ~10-13 s langer.

Wat niet opgelost is, of een keuze:
- Hetzelfde patroon precies een halve tel verschoven tussen twee stukken op één grid wordt
  één stuk (de break-regel ziet het verschil met offbeat-hats niet).
- Een tempo dat golft (rubato ±2% met een periode van 30 s): vensters van 12 s middelen
  het weg, en stukken blijven zeker met meer dan 5% van de tellen verder dan 0,15 tel naast
  (synthetisch uur: 13 van 15 zekere stukken; vóór de toets één zeker stuk over alles).
- Een kort stuk op 1-2% ander tempo aan de rand van een lang stuk kan erin blijven hangen
  (synthetisch S8: 20 s op 150 vóór 152,5, 4% van de kicks naast, zoals vroeger). Een regel
  "twee vensters naast aan de rand" ving dat, maar knipte het album op 156 zonder reden in
  tweeën (een trage drift), dus weggelaten.
- Een deel van net onder de 20 s wordt een rest (onzeker), ook als er een grid op past.
- Niet gemeten op hele albums (bewust), niet in de browser, de server niet herstart. Grids
  met `bron: 'auto'` veranderen pas na ↻ in de library.

## 10. Makkelijker gelijkzetten (5 oktober 2026)

Clay: "het is heel lastig om de beatgrid goed te zetten". Wat er misging, gemeten in de
code: een correctie met de hand telde niet (het stuk bleef onzeker, dus sync en beat-loops
weigerden na het corrigeren nog steeds), drift (een tempo een fractie naast) kostte tientallen
encodertikken met heen en weer lopen, een verkeerde tik was niet terug te draaien, en op het
scherm kon je de tel niet aanwijzen.

**Gebouwd:**

| wat | hoe | waar |
|---|---|---|
| een correctie bevestigt | elke bewerking met de hand (‹ ›, 1, ½, ×2, halve tel, stuk, de encoder, tikken) maakt het stuk "met de hand gezet" = zeker: sync en beat-loops mogen meteen | `Beatgrid.bevestig`, `bewerk` in actions.js |
| terug | ↶ (scherm), Cmd+Z: de laatste bewerking van het grid terug, tot 30 stappen; een tikreeks is één stap, een reeks encodertikken ook. Leeg bij een nieuw nummer | `deck.gridVoorBewerking` / `gridTerug`, `track.N.grid.undo` |
| **vastzetten (pin)** | "de tel hier hoort HIER": het tempo van het stuk wordt zo dat er tussen zijn anker (waar je "1" zette, of de vorige pin) en hier precies een geheel aantal tellen ligt; vanaf hier begint een nieuw stuk met dit als anker. Tegen drift: **"1" op een kick aan het begin, verder spelen, een paar minuten later "vast" op een kick**. Een live mix die drijft: om de 16–32 maten vast. Weigert (met waarom) als het grid hier meer dan 0,4 tel naast ligt of het tempo meer dan 4% zou veranderen; vlak bij het anker (< 4 tellen) alleen de fase | `Beatgrid.pin`, `track.N.grid.pin`; scherm "vast"; APC grid-modus Shift + scene 1 |
| de "1" verschuiven | 1→ (shift: terug): de "1" een tel verder, de tellen blijven liggen. De analyse vindt geen downbeat | `Beatgrid.maatSchuif`, `track.N.grid.bar` / `.bar.back` |
| klikken in de golfvorm | in grid-modus (knop **grid** naast TAP, of Shift + Metronome): klik in de ingezoomde golfvorm = tel 1 daar, shift + klik = vast daar; gesnapt naar de klap binnen 30 ms. Ook stilstaand, zonder reactietijd. Buiten grid-modus doet een klik niets (een misklik in een set) behalve uitleggen. Scrollen in de golfvorm = in- en uitzoomen (40–2400 px/s) | vensters.js, `WaveformView.tijdBij`, `track.N.grid.here.op` / `.pin.op` (via de bus: het handelingenlog ziet het) |
| bpm in honderdsten | de focuskop toont de bpm met twee decimalen (een encodertik of pin is 0,01) | renderloop.js |

Gemeten (test/beatgrid.test.mjs): een plaat op 124,3 met een grid op 124,0: één pin op tel 64
geeft 124,30 en elke tel tot tel 400 exact. Een live mix die in 5 minuten van 124 naar 126
bpm drijft, met om de 32 tellen een pin: elke tel binnen 1,6 ms.

**Niet gebouwd (nog):** een klik in de koptelefoon op de tellen (wacht op de
koptelefoonuitgang, het samengestelde apparaat); slepen van het grid in de golfvorm;
"verfijn dit stuk opnieuw" zonder tikken. De tap zet na vier tikken nog steeds het hele grid
op slot (bestaand gedrag).

## 11. Altijd zeker dat het klopt (6 oktober 2026)

Clay: *"ik wil er eigenlijk altijd zeker van zijn dat het klopt"*. Daarom is
"zeker" nu een **meting**, geen schatting, en kun je elk stuk met je oren
controleren.

### Wat er gemeten is (Beat This! op 11 nummers van Clay's library)

Beat This! (CPJKU, MIT-code en -gewichten) is een neuraal netwerk dat tellen
én downbeats hoort, getraind op 16 datasets. Naast het oude grid:

| nummer | oude grid | Beat This! |
|---|---|---|
| Loving arms | 86% van de tellen binnen 50 ms, maar de "1" klopte in 1% | volgt de band (zonder klik: tot 170 ms tempoverschil), "1" 99% |
| Ciel, album, Let it all go | ~154 / 140-156 / 170 bpm | 77 / 75 / 75: een octaaf |
| jungle-mix (met de hand, op slot) | 80% eens | 90% van de mix zeker, 92% raak |
| No Surprises | 17% eens (fase en drift) | 73% zeker, de rest rubato |
| zoned out | grid op 157 | geen puls (94 tellen in 42 minuten): eerlijk |

### Hoe het werkt

1. **De tellen** (`server/tellen/tellen.py`, `server/tellen.js`): na elke
   ingest en op de achtergrond voor wat er al staat (wat je het laatst laadde
   eerst) zoekt Beat This! de tellen en downbeats → `media/<id>/tellen.json`.
   In stukken van 4 minuten (een album van 31 minuten liep in één keer vol op
   MPS), met het zwaartepunt van de piek (frames van 20 ms; mediaan ~7 → ~5
   ms). ~1,5 s per minuut muziek op de GPU; de stems en de tellen gebruiken
   de GPU om de beurt (`GpuSlot`: tegelijk duurde 2,8 minuut muziek 53 s).
2. **Het grid uit de tellen** (`src/engine/tellen.js`, `gridUitTellen`):
   stukken met één tempo die de tellen volgen. Een stuk stopt waar de
   mediaan van 8 tellen meer dan 10 ms van de voorspelling ligt (geknipt waar
   twee rechte lijnen samen het best passen), bij drie losse tellen op rij
   (een sprong) of bij een gat; buren op hetzelfde rooster plakken weer aan
   elkaar (een break is geen nieuw stuk). Korte stukjes samen = rubato. Een
   gat vanaf 4 s = geen puls. De "1" uit de downbeats; drie of vier tellen
   per maat ook.
3. **Zeker = gemeten** (`meetGrid`): per stuk het deel van de gevonden
   tellen binnen 25 ms van een gridlijn (de ruis van de detector), en de
   grootste mediaan van een blok van 16 tellen (systematisch naast: > 12 ms
   = drift). Daarnaast een **tweede mening** (`vergelijk`): de oude analyse.
   Half of dubbel tempo telt als eens (het octaaf staat erbij); oneens is
   alleen een ánder tempo, of een stabiele andere fase (de offbeat).
   Grover is geen tegenspraak: de oude analyse lag op Loving arms 35-60 ms
   naast een band zonder klik.
4. **Waarom het niet zeker is** staat erbij: `geen puls`, `rubato`, `drift`,
   `los` (veel tellen naast het grid), `maat` (de downbeats zijn het
   onderling oneens; sync mag wel), `oneens`.
5. **Met de hand gezet en op slot blijft staan.** De achtergrond meet zulke
   grids alleen (in het logboek: hoeveel raak, slechtste blok, "1"). ↻ in de
   library gebruikt de tellen (over een slot alleen met de tweede klik).

### Op het scherm

- **Naast de bpm** het oordeel over het stuk waar je bent: ✓ zeker (groen),
  🔒 op slot, ? controleer (oranje, de reden in de tooltip), – geen puls, en
  **⚠ N ms** als het grid tijdens het spelen van de tellen wegloopt (de
  mediaan van de laatste 16 tellen vóór de speelkop ligt > 15 ms naast).
  Een met de hand gezet stuk wordt ook gemeten: "met de hand gezet, maar 40%
  van de tellen valt erop".
- **In de zoom** de gevonden tellen als groene streepjes bovenin (de "1"
  langer). Vallen de gridlijnen erop, dan klopt het.
- **Controleren** (klik op het oordeel): een tik op elke gridlijn (hoog = de
  "1"), in de koptelefoon met de cue van dat deck aan (zonder koptelefoon in
  de zaal). Het deck springt naar de eerste **plek** met twijfel vanaf de
  speelkop (stukken die aan elkaar liggen, of met minder dan 8 s ertussen,
  zijn één plek: een live opname gaf 100 losse stukken, als plekken 55).
  **✓ klopt** = klopt tot hier: de plek tot waar je luistert is goedgekeurd
  en je luistert door; is de plek helemaal goed, dan springt hij naar de
  volgende. ◀ ▶ lopen de plekken langs, ✎ (grid) om bij te stellen terwijl
  de tik doorloopt. Is alles goedgekeurd, dan gaat het grid **op slot**. Is er niets te controleren, dan
  loop je alle stukken langs. Een goedgekeurd stuk (`ok`) is zeker, ook waar
  de tellen het oneens zijn (rubato: jouw oor wint); een bewerking daarna
  haalt `ok` weer weg.

### Installeren (één keer)

```
~/.varve/stems-venv/bin/pip install beat-this==1.1.0
curl -L -o ~/.varve/modellen/beat_this-final0.ckpt --create-dirs \
  https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt
```

Het model (81 MB) staat lokaal; de server haalt niets van internet. Ander
pad: `VARVE_TELLEN_MODEL`; andere Python: `VARVE_TELLEN_PY` (anders die van
de stems). Ontbreekt het, dan zegt de server dat bij het opstarten en komt
het grid van de oude analyse, zoals eerst.

## 12. Gelijkzetten op de controller, gemeten (14 oktober 2026)

Clay: *"Alles eerst is het belangrijk dat het op de juiste manier met de controllers werkt
… erg laggy … de beatgrid moet ook beter."* Dit hoofdstuk gaat over de BEDIENING: hoe
snel en zeker je een fout grid rechtzet, op de APC (grid-modus, Shift + Metronome). De
analyse (welk grid er binnenkomt) staat in §11 en is een ander spoor.

### Hoe het gemeten is

`test/grid-bediening.test.mjs` speelt de gewone fouten als **scenario's** af: een plaat op
124,317 bpm (geen veelvoud van 0,01) van 6 minuten, een bekend fout grid, en een
"gebruiker" die op de APC drukt (MIDI-berichten op de standaardmapping, met de echte
lagen, de echte engine op de Web Audio-mock en de echte LED-laag) als hij de klap hoort,
12 ms te laat. Daarna wordt het grid over het HELE nummer nagelopen: elke tel ≤ 2 ms, het
tempo ≤ 0,01%, elke "1" goed, alles zeker. Dezelfde test draait op een oudere checkout:

```
node test/grid-bediening.test.mjs                                  # deze boom (de test)
VARVE_WORTEL=<checkout> VARVE_GRID_UIT=voor.json node test/grid-bediening.test.mjs   # de nulmeting
VARVE_CHROME=<chromium> node tools/headless/grid-bediening.mjs     # echte server en app (bewaren, opnieuw laden)
```

Uitkomsten (drukken inclusief "grid-modus aan"; de cijfers in het verslag van 14 okt):

| fout | route op de APC | vóór 14 okt | nu |
|---|---|---|---|
| octaaf (½ of ×2) | scene 2 / scene 3 | 2, goed | 2, goed |
| de "1" een tel verschoven | tel 1 hier op een echte "1" (snapt) | 2, goed (maar zonder klappen 12 ms naast) | idem |
| | **Device ◀** (← 1), waar dan ook, ook zonder klappen | kon niet op de APC | 2, goed |
| fase 12 ms naast | **Clip/Device View** (tellen hier) op ELKE tel | kon niet op de APC | 2, goed |
| fase 47 ms naast | nudge | 12 drukken | 12, of **4 met vasthouden** |
| tempo 0,1% naast (0,7 tel na 6 min) | vast op 2:30 | 2, goed | 2, goed |
| | vast pas op 5:00 (0,63 tel uit de pas) | **stil fout**: 124,12 bpm, de verkeerde kant op | 2, goed (geteld op de klappen) |
| | encoder (0,01 per tik) | 5 ms naast na 6 min | idem (de resolutie) |
| tempowissel midden in het nummer | nieuw stuk, tel 1 hier, vast | 4, goed | 4, goed |
| geen grid | 8× tap, tel 1 hier, vast | 11, goed | 11, goed |
| op slot maar fout | tel 1 hier, of tellen hier + ← 1 | 2 | 2 of 3 |
| klopt, maar onzeker | Lock, of **Shift + On/Off** (✓) | Lock alleen | beide |

### Wat er veranderd is

- **Acht knoppen in de grid-modus** (`docs/APC40.md` "Grid-modus: gelijkzetten"): de "1"
  verschuiven, tellen hier, ↶, controleren met de tik, ✓ en de plekken langs.
- **Tellen hier** (`track.N.grid.align`, `Beatgrid.lijnUitOp`): de tel die het dichtst bij
  wat je hoort ligt komt op de klap (gesnapt binnen 30 ms), de "1" en het tempo blijven.
  "Tel 1 hier" zet ook de "1", dus daarvoor moest je op de "1" wachten.
- **Vast telt op de klappen** (`Beatgrid.pin(t, { klappen })`): ligt het grid hier meer dan
  een kwart tel uit de pas, dan kan "de tel hier" ook de buurtel zijn. Pin probeert n−1, n en
  n+1 tellen en kiest het aantal waarbij de tellen ertussen op de klappen vallen (≥ 50% raak
  binnen 15 ms, en 25 procentpunt beter dan de rest); anders het oude gedrag, en dan zegt de
  melding "LET OP … controleer met de tik". Gemeten: kicks op elke tel, ook met hi-hats op
  elke zestiende ertussen.
- **↶ zet precies terug**: ook `bron`, `methode`, `zekerheid` en `twijfel`. Vroeger ging
  terug via `gridGewijzigd()` en werd een teruggezet voorstel van de analyse `bron: 'hand'`
  (dan kwam het grid uit de tellen er nooit meer overheen).
- **Nudge vasthouden** herhaalt (`HERHAAL_NA` 350 ms, dan elke `HERHAAL_ELKE` 60 ms, hooguit
  200 stappen); loslaten stopt, een ander grid stopt ook, en het hele vasthouden is één ↶.
  Terugspelen: de herhaling loopt op de timer van NU, dus tijdens het vasthouden kan het grid
  een paar ms afwijken van toen; de `grid`-gebeurtenis van het log na het loslaten zet het
  eindgrid precies goed (docs/HANDELINGENLOG.md, `grid`).
- **Het lampje van "tel 1 hier"**: wit = het stuk dat je hoort klopt, oranje = twijfel. Je
  ziet op de APC zelf of je klaar bent.
- **De controletik** plant meteen opnieuw als het grid verandert (een 'change' van het deck),
  niet pas bij de volgende tik van zijn timer (tot 30 ms tik op het oude grid).
- **Bewaren** (`src/ui/grid-bewaren.js`): 250 ms na de laatste bewerking (tijdens een lange
  reeks toch elke seconde), niet op een timer van 1,5 s. 250 ms is de bovengrens; het vangnet
  van 1,5 s (dat een mislukte POST opnieuw doet) kan er toevallig eerder zijn. Gemeten in
  Chrome tegen de echte server: gemiddeld 707 ms (103–1263) → rond de 250 ms van de druk tot de
  server hem heeft (verslag 14 okt). Elk antwoord wordt gelezen (`leesWeg`, ook bij een fout),
  en een POST die na 5 s (`TIJDSLIMIET_MS`) niets zei wordt afgebroken: er loopt één ronde
  tegelijk, en één hangend verzoek legde anders het bewaren stil (gemeten: 1 POST in 6 s,
  nu 6). `test/grid-bewaren.test.mjs` draait op een nep-klok en een nep-wekker.
- **De library-rij en andere tracks**: na elke geslaagde POST weet de library-rij het nieuwe
  grid (`library.zetGrid`), ook als de track intussen een ander nummer laadde (de rij hoort
  bij het nummer). Een andere track met hetzelfde nummer die zelf niets bewerkte krijgt het
  pas als de REEKS klaar is (250 ms geen bewerking en alles bewaard, `naReeks`), één keer,
  niet elke seconde een tussenstand van een encoder die nog draait. Vroeger kreeg wie het nummer na een bewerking opnieuw laadde het grid van
  VÓÓR de bewerking (gemeten: track 1 248,65 bpm, track 2 kreeg 124,33), en bewerkte hij
  dat, dan overschreef hij de jouwe.
- **De weergave meet minder vaak**: het oordeel naast de bpm (elke frame) en het lampje
  (elke LED-tik) meten het grid tijdens een reeks bewerkingen hooguit eens per 150 ms aan de
  tellen (`deck.gridMetingBij`); wie beslist (controle, ✓) leest `gridMeting`, altijd vers.
  Met de tellen van een uur muziek kost één meting in Chrome ~5,7 ms; draaien aan de bpm
  (30 tikken/s) kostte daardoor 154–310 ms rekenen per seconde, nu rond de 50 (37–70 over vier runs).

### Wat niet veranderd is, en waarom

- MIDI → grid duurt 0,01–0,05 ms (mediaan per knop, p95 < 0,2 ms): de vertraging zit niet
  in de grid-actions. Het lampje volgt bij de volgende tik van de LED-laag (33 ms, het spoor
  van de controller-uitvoer).
- De bpm-encoder blijft 0,01 per tik (shift 0,1): exact komt het tempo pas met **vast**.
- Een ringknop voor de bpm in de grid-modus is niet gebouwd: de device knobs sturen absolute
  waarden (127 stappen per slag) en `grid.bpm` loopt over 40–300 bpm: 2 bpm per tik.
