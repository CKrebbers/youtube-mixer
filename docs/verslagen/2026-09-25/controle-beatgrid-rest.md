# Controle ROADMAP 24 (beatgrid-restpunten) — spoor2/beatgrid-rest-c

Branch `spoor2/beatgrid-rest-c` (vanaf `spoor2/beatgrid-rest`, c43a6c7), drie commits erbij:

| commit | wat |
|---|---|
| `d830aa0` | tweede kans plakt geen ander nummer meer vast (`eenGridPast`, detect.js + 2 blokken detect.test) |
| `abbb7ef` | splitsen in de laatste maat vóór een ander stuk houdt de maten (beatgrid.js + test) |
| `12776ba` | BEATGRID.md: controle-alinea's, splits-herstel, ½ op tel 2/4 als open punt |

Niet aangeraakt: CLAUDE.md, HANDOFF, ROADMAP, VRAGEN, mappings/apc40mk2.json. Niets in media/,
server :8777 en Chrome niet aangeraakt. Metingen alleen op fragmenten (onset.bin-plakken, 2-4,5 min).

`nice -n 10 node test/alles.mjs` op `abbb7ef`: **29 bestanden, 1978 checks, alles groen** (geen
rood door belasting).

---

## Bevinding 1 (ERNSTIG, hersteld): de tweede kans maakt valse "zekere" stukken

tweedeKans redt een venster als `faseStabiliteit` op T boven de nul komt. Die maat vraagt
alleen of de fase VASTHOUDT: hij vergeeft een vaste drift (tot ~4 bpm naast, 0,1 periode per
stap van 1,5 s) en ziet een fasesprong maar in een paar stapjes. Hij vraagt niet of de fase op
dezelfde PLEK ligt als bij de buren. Het stuk dat eruit komt krijgt één tempo en één anker, en
de zekerheid (gemiddelde stabiliteit van de vensters) zegt niets over of dát grid past.

Synthetisch (kicks + fills op 107 zoals de test van de bouwer; per zeker stuk het aandeel echte
kicks > 30 ms naast het grid):

| scenario | main (cc527e3) | branch | met herstel |
|---|---|---|---|
| S1 150 schoon, dan 150 een halve tel verschoven, verward | 0-76 zeker, 21% naast | **0-152 zeker, 61% naast (tot 181 ms)** | = main |
| S1b 150 verward (brokje), dan 150 verschoven, lang | 28-200, 19% | **0-200, 30%** | = main |
| S2 150 schoon, dan 154 verward | 0-76, 19% | **0-152, 52%** | = main |
| S3b half-time (75) in een andere fase tussen 150 | 0-72, 2% | **0-124, 33%** | = main |
| S8 150 verward, dan 152,5 lang | 40-380, 17% | 16-380, 18% | = main |
| B (test van de bouwer: 140 → 156 in brokjes → 150) | 156 alleen 104-124 | 68-144 zeker, 0% | = branch |
| S3 half-time in DEZELFDE fase | 0-92 + 92-124 | 0-160 zeker, 0% | = branch |
| S4/S4c stilte ertussen, S5 dubbel tempo, S6 brokje-brokje | gelijk | gelijk | gelijk |

Op Clay's muziek: Sakamoto 0:00-4:30 (niet gemeten door de bouwer): de branch maakte 1:08-1:50 op
109,95 met geredde vensters tot 268 ms (0,49 tel) naast; z 0,48, dus toevallig niet zeker.

Herstel (`eenGridPast` + `faseOpGrid` in detect.js, aangeroepen in analyseerGrid na de bestaande
"geen stuk = terug"-regel): per proef-segment met geredde vensters het grid dat het stuk krijgt
(dezelfde verfijnTempoFase, nu gedeeld via `gridVan`), per venster met duidelijke puls (R ≥ 0,15)
de fase op dat grid, referentie = de fase met de meeste buren (cirkel). Meer dan 10% van ALLE
vensters of van de GEREDDE vensters verder dan 0,15 tel → alle geredde vensters in dat segment
terug naar de eerste meting. Het tweede criterium omdat een kort geplakt stuk achter een lang stuk
onder de 10% blijft (S8). Terugdraaien kan alleen terug naar main, nooit slechter.

Alle winst van de bouwer blijft, bit voor bit dezelfde stukken: album 11:45-13:29 (156,06 z 0,84;
geredde vensters hooguit 41 ms, alle hooguit 47 ms = 0,12 tel), 15:41-16:17, 2:00-2:48,
3:52-4:36, Bay Ledges 153,66, jungle 0,64, en alle andere fragmenten uit fragment.txt. Nieuw
gemeten: album 29:38-30:06 (163,63 z 0,86, nieuw door de tweede kans, past binnen 17 ms), album
5:20-9:50 en zoned out 10:00-14:30 niets, Sakamoto 30:30-35:00 gelijk.

Test (detect.test.mjs): "een grid moet passen: eenGridPast" (5) en "tweede kans plakt geen ander
nummer vast" (4: halve tel verschoven en 154 i.p.v. 150). Gecontroleerd: met de branch-detect.js
falen de e2e-checks (0-152 zeker), met het herstel groen. detect.test duurt ~21 s (was ~15).

## Bevinding 2 (KLEIN, hersteld): splitsen in de laatste maat vóór een ander stuk

`splits(t)` zocht de volgende "1" met `timeOf`; ligt die in het volgende stuk (ander tempo), dan
kreeg het nieuwe stuk een maat op een vreemd rooster, afgerond → tel 3 werd een "1"
(120|150-grid, splits(18,7): maatbegin 16 18 20,9 → 16 18 **19** 20,9). Nu de eerste "1" op of na t
op het rooster van het stuk zelf. Test in beatgrid.test (faalt op de branch).

## Bevinding 3 (pre-existing, NIET hersteld): vals zeker zonder tweede kans

Ook main maakt "zekere" stukken waar het grid niet op past (tabel: 12-22% van de kicks naast): segmenteer
rijgt vensters binnen 4% tempo aaneen zonder naar de fase te kijken, en de zekerheid van een stuk
is de stabiliteit van zijn vensters, niet of zijn ene grid past. Twee nummers op (bijna) hetzelfde
tempo zonder duidelijk gat → één zeker stuk. Op Clay's fragmenten staan ook zekere stukken met
fase/12 s ver uit elkaar (Sakamoto 35:59-37:47 z 0,95: -114…+107 ms; jungle 2:40-4:16 z 0,73: 27-96 ms).
Voorstel (eigen stap): eenGridPast op elk stuk (splitsen of zekerheid omlaag), met metingen.

## Zekerheidsdrempel 0,65
Door de tweede kans worden zeker: album 2:00-2:48 (0,62 → 0,71), 11:45-13:29 (0,84), 15:41 (0,92),
29:38 (0,86). Na het herstel passen die grids (hooguit 0,12 tel naast, meestal < 25 ms). Geen
aanwijzing dat de drempel zelf verschoven moet worden; het probleem was de gluing, niet het getal.

## Maat-anker: nagelopen
- Oud grid (ook met een weggevallen stuk korter dan een tel): maatbegin, barPhase en telInMaat
  op elke plek gelijk aan de oude regel. OK.
- Tel 1 hier (ook vlak na `van`), schuif/nudge ±, halve tel, lijnUitOp, bpm-encoder (400 tikken
  heen en terug: "1" op dezelfde tel, maat drijft niet), tap/verfijning (zetStuk, ook 5 min van de
  "1" op een ander tempo), ×2, slot, splits+tel 1 hier+samenvoegen: OK.
- ½ op tel 2 of 4: de tellen landen op 2/4, de "1" schuift een tel (afronden op een gelijke stand),
  ½ → ×2 geeft hem niet terug. Beter dan main (daar werd de tel bij de speelkop altijd de "1"), dus
  geen regressie; als open punt in BEATGRID.md (voorstel: ½ houdt de "1" als tel, eerst vragen).
  Los daarvan (al in main, tellen): ×2 → ½ met de speelkop tussen twee tellen legt het grid een
  halve tel naast; de claim "×2 dan ½ geeft de oude terug" geldt alleen binnen een kwart tel.
- Wie rekent met maten: alleen golfvorm (beatsBetween), feedback (telInMaat via track.N.barbeat)
  en isDownbeat. Sync, beat-loops, gate, sampler rekenen in tellen: niet geraakt.
- normaliseerGrid: null/tekst/Infinity vallen weg. Een absurde maat (1e300) gaat erdoor en maakt
  elke tel een "1" — net als anker is maat niet begrensd; alleen uit rommel-invoer, niet hersteld.
- Laden bewaart niet meer: geen bewaar-moment gemist. Tap en verfijning lopen via gridGewijzigd →
  de 1,5 s-lus POST; auto-analyse en ↻ bewaart de server zelf (onGrid zet gridBewaard op wat de
  engine ervan maakte, dat deed main al). Main POSTte bij laden ook niet (zelfde sleutelvolgorde),
  dus alleen de aangevulde maat wordt niet meer geschreven; die is bij elk laden hetzelfde.
  Pre-existing, niet van dit spoor: het library-paneel houdt `track.grid` in zijn lijst; na een
  bewerking en opnieuw laden uit dezelfde (niet ververste) lijst krijgt het deck het oude grid.

## Wat NIET getest is
- Heel album / hele Sakamoto (bewust); nul van Sakamoto niet afgeleid (fragment-eigen nul).
- Rekentijd van analyseerGrid op een lange track met de extra verfijning per gered segment (klein:
  één verfijnTempoFase per segment met geredde vensters) — niet gemeten op een uur.
- Niets in de browser of op de APC (knipperen op de "1", golfvorm per stuk, laden zonder POST).
- De server is niet herstart; na merge herstarten en ↻ op het album.

## Voorstel CLAUDE.md (sectie Beatgrid), aanvulling op het voorstel van de bouwer
```
- Tweede kans moet één grid opleveren (eenGridPast, detect.js): per venster met duidelijke puls
  de fase op het grid van het stuk; > 10% van alle of van de geredde vensters > 0,15 tel naast =
  de tweede kans telt in dat stuk niet. Stabiliteit alleen plakte een volgend nummer (zelfde
  tempo andere fase, of 1-3% sneller) "zeker" vast. Zekerheid ≠ past het grid: dat gat bestaat
  buiten de tweede kans nog steeds (docs/BEATGRID.md).
```
Scripts van deze controle (niet in de repo): scratchpad/controle/scenario.mjs (synthetisch oud/
nieuw/herstel), frag.mjs (fragmenten, gebruikt tools/beatmeting/rest/lib.mjs), maat.mjs.
