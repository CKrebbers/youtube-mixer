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

Wat er NIET mee opgelost is (bestond al, ook zonder tweede kans): segmenteer rijgt
vensters op hetzelfde tempo (±4%) aaneen zonder naar de fase te kijken, en de zekerheid
van een stuk is de stabiliteit van zijn vensters, niet of zijn ene grid past. Twee nummers
op hetzelfde tempo zonder duidelijk gat ertussen worden zo één "zeker" stuk (synthetisch
12-22% van de kicks naast). eenGridPast op elk stuk toepassen zou dat vangen; dat is een
eigen stap met eigen metingen.

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
  was, ½ neemt de dichtstbijzijnde tel (×2 en daarna ½ geeft de oude terug); een
  nieuw stuk neemt de maten mee (op zijn eigen rooster: in de laatste maat vóór een
  stuk op een ander tempo werd tel 3 anders een "1"; hersteld door de controleur).
- Open (controleur, niet gebouwd): ½ laat de tel het dichtst bij de speelkop liggen,
  ook als dat tel 2 of 4 is. Dan liggen de nieuwe tellen op 2 en 4, de "1" moet een
  tel opschuiven, en ½ gevolgd door ×2 geeft de "1" niet terug (op tel 1 en 3 wel).
  Met een maat-anker kan ½ de "1" als tel houden (tellen op 1 en 3, zoals
  DJ-software halveert); dat verandert welke tellen blijven, dus eerst vragen.
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
