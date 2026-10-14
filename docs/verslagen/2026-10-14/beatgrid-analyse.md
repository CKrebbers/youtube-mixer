# Het automatische beatgrid: een benchmark, en wat er beter werd (14 okt 2026)

Spoor beatgrid-analyse, tak `afmaken/beatgrid-analyse`, vanaf 7debab6 (toen de kop van `studio/afmaken`;
die staat nu op 849af2d, het verschil zit alleen in server/index.js (VIDEO_KNIP) en raakt de analyse niet,
dus "vóór" = 7debab6 blijft de nulmeting). Alleen de analyse: `src/engine/tellen.js`, `server/detect.js`, `server/analyze.js`, een benchmark en een test.
Niets aan bediening, mapping of controllers. Doc: `docs/BEATGRID.md` §12.

Clay: *"ik wil er altijd zeker van zijn dat het klopt"*. De ergste fout is daarom **vals zeker**: het
grid zegt zeker (sync en beat-loops mogen) en ligt naast de muziek.

## 1. Wat er gemeten werd, en hoe je het herhaalt

Er was geen meting met een bekend antwoord: alles was gemeten op Clay's muziek, waar niemand weet
waar de tel echt ligt. Nu wel: `tools/beatmeting/synth/`.

- **21 synthetische nummers** (`nummers.mjs`, vast zaad), elke tel en "1" exact bekend: vast tempo
  72 · 96 · 124 · 140 · 160 · 178 · 186 · 192 (de laatste twee sinds de tweede review, §11), shuffle 118, een break van 8 maten zonder kick, een intro van 8
  maten zonder kick, een mix 124 → 131 in een andere fase, een band zonder klik (120 ±2%, slagen
  σ 6 ms), een versnelling 122 → 126, een wals 150, reggae one drop 75, jungle 172 (breakbeat),
  half-time 140, ambient zonder puls, een opmaat van drie tellen, een band op 154 zonder klik
  (zoals Ciel).
- **Tellen zoals Beat This! ze geeft** (`nep-beatthis.mjs`), zes soorten: `bt` (σ 6 ms, 3% gemist,
  2% extra, 4% van de downbeats een tel verschoven, en het octaaf dat het netwerk waarschijnlijk kiest:
  86 voor jungle, 77 voor de band op 154, 70 voor half-time), `ruis` (σ 10 ms, 10% gemist, 6% extra,
  15% downbeats fout), `half`, `dubbel`, `wissel` (halverwege ineens het halve tempo), `eenfout`
  (elke "1" een tel te laat). 19 × 6 = 114 gevallen. Na review ronde 1 (§10) twee erbij die het
  halveren laten mislukken: `dubbel-laat` (dubbel, de downbeats op de "en") en `dubbel-kaal` (dubbel
  zonder downbeats, het netwerk begint op de "en"): 152 gevallen; met 186 en 192 (§11) 168.
- **De score** (`scoor.mjs`): dekking (zeker op de duidelijke tellen), tempo (het echte octaaf),
  DJ-tempo, fase (mediaan ms), naast (> 0,1 tel), de "1", en vals zeker: op de tijd over het hele
  nummer (ook in een break, een intro, ambient), VALS = meer dan 2% van de zekere tijd en ≥ 2 s.
- **Beide analyses zoals de server ze draait** (`bench.mjs`): de oude via ffmpeg → `maakOnset` →
  `maakGrid` (analyseerGrid + fijne fase, in de worker); de tellen via `gridUitTellen` +
  `vergelijk` met de oude als tweede mening, precies als `pasTellenToe`.

Herhalen (in de worktree; ~60 s, daarna staat de oude analyse in de cache van de tijdelijke map):

```
git -C <repo> worktree add --detach /tmp/bg-voor 7debab6
node tools/beatmeting/synth/bench.mjs --code /tmp/bg-voor --json /tmp/voor.json
node tools/beatmeting/synth/bench.mjs --json /tmp/na.json
node tools/beatmeting/synth/bench.mjs --vergelijk /tmp/voor.json /tmp/na.json
node test/beatbench.test.mjs        # 59 checks, ~25 s; de meeste falen op 7debab6, 9 op 7092a61 (§10), 14 op c7028b7 (§11)
```

**Beat This! zelf draaide hier niet.** `pip install` van torch faalt (download.pytorch.org: 403 van de
proxy) en het checkpoint staat op cloud.cp.jku.at (ook 403). PyPI werkt, maar zonder checkpoint
geen model. Op Clay's Mac kan het wel, op dezelfde audio:

```
node tools/beatmeting/synth/bench.mjs --wav /tmp/bb
for f in /tmp/bb/*.wav; do ~/.varve/stems-venv/bin/python server/tellen/tellen.py --in "$f" --uit "${f%.wav}.json"; done
node tools/beatmeting/synth/bench.mjs --echt /tmp/bb --varianten bt
```

## 2. Nulmeting en nameting

Samenvatting (`bench.mjs --vergelijk`, vóór = 7debab6, na = deze tak NA de tweede review (§11), op 21
nummers; de cijfers per soort fout met `node tools/beatmeting/synth/groep.mjs voor.json na.json`. De
cijfers van §10 waren op 19 nummers, zonder 186 en 192):

| | vóór | na |
|---|---|---|
| **tellen-route, 168 gevallen (8 soorten fouten): vals zeker** | **1** | **0** (eerste versie van de tak: 20) |
| de 126 gewone gevallen (6 soorten): vals zeker | 1 | 0 |
| … dekking | 91% | 96% |
| … tempo (het echte octaaf) | 58% | 85% |
| … op het DJ-tempo | 52% | 95% |
| … op het DJ-tempo zonder vast-72 en reggae-75 (daar is 144/150 een keuze, §5) | 56% | 94% |
| … > 0,1 tel naast | 5% | 0% |
| … de "1" goed (waar te meten) | 80% | 83% |
| oude analyse, 21 nummers: op het DJ-tempo | 76% | 82% (hij hoort 186/192 als 93/96, vóór en na) |
| oude analyse: zeker-en-naast, live band | 27,5 s van 94,8 s zeker | 5,75 s van 23,3 s |
| oude analyse: zeker-en-naast, band op 154 | 18,5 s van 112 s | 16,5 s van 112 s |
| oude analyse: klik van 8 minuten op 128 | 128,024 bpm, eerste tel 37 ms te laat | 128,0001 bpm, 7 ms vroeg |
| rekentijd gridUitTellen + meetGrid, een uur (7315 tellen), beste van 7 / eerste keer | 35 / 68 ms | 32 / 97 ms |

Per geval (een selectie; de hele tabel komt uit het commando hierboven, 78 van de 189 rijen anders):

| geval | vóór | na | waardoor |
|---|---|---|---|
| jungle-172 / bt | 86 bpm zeker, DJ-tempo 0% | 172, 100% | DJ-tempo |
| halftime-140 / bt, oud | 70 / 70 | 140 / 140 | DJ-tempo (beide routes) |
| indie-154 (Ciel) / bt | 77, 0% | 154, 100% | DJ-tempo |
| house-124 / half, dubbel | 62, 248 | 124, 124 | DJ-tempo; ½ bevestigd door de oude analyse (§11) |
| vast-186, vast-192 / bt, ruis, wissel, eenfout | 186 / 192 zeker | gelijk (de eerste herstelling: 93 / 96 onzeker, §11) | geen halveren onder 300 zonder bevestiging |
| jungle-172, vast-178, indie-154 / dubbel | "geen puls" (geen grid) | zeker, 100% | tellen boven 300 bpm + DJ-tempo |
| wissel-124-131 / ruis | VALS: 4,5 s zeker op 124 na de wissel, grens 4,5 s | 0 vals, grens 0,4 s | staartKnip |
| wissel-124-131 / ruis | een stuk op 247 bpm (2,8 s) na een gat met extra tellen | weg | beginPeriode |
| live-drift / ruis | dekking 83%, 6% naast | 98%, 0% | beginPeriode |
| wissel-varianten (4 nummers) | 48-54% DJ-tempo | 100% | DJ-tempo (het halve stuk terug naar de rest) |
| reggae-75, vast-72 / bt | 75, 72 (= de tellen) | 150, 144 | DJ-tempo (een keuze, zie §5) |
| live-drift / oud | VALS 27,5 s | VALS 5,75 s, gemarkeerd 'drift' | blokDrift |
| klik 8 min / oud | 128,024 | 128,0001 | kantelOpPieken |

Wat erger werd (eerlijk): vijf gevallen kregen 0,25–1 s zeker-en-naast erbij, steeds onder de grens
van 2% en 2 s (wissel-124-131/half 0,75 s, live-drift/half en /dubbel 0,75 s, indie-154/wissel en
/eenfout 0,25 s): randen van stukken. De "1" van indie-154/wissel 100 → 99%. De dekking van de oude
analyse op de live band zakte van 48 naar 12%: dat was de valse zekerheid.

## 3. De oorzaken

1. **Octaaf.** `gridUitTellen` nam het tempo van Beat This! zoals het kwam. Het netwerk hoort vaak de
   halve tel (gemeten op Clay's library, §11: 77 waar Clay 153 tikt, 75 op het album); synthetisch
   86 voor jungle en 70 voor half-time. Het grid was dan "zeker" op een tempo waar geen DJ op mixt,
   en sync tussen twee nummers in een ander octaaf ging mis. De oude analyse had hetzelfde bij
   half-time (70) en downtempo (72 en 144 in één nummer).
2. **Boven 300 bpm was alles "geen puls"** (`L0 > 0.2`): telt het netwerk de achtsten, dan verloor
   een nummer zijn hele grid.
3. **Het begin van een stuk** was de mediaan van 8 afstanden; twee extra tellen op een rij gaven 164
   in plaats van 124, en een extra tel als begin gaf een stuk op 46 bpm.
4. **Een tempowissel die het oude rooster kruist**: de nieuwe tellen vielen een paar tellen lang nog
   binnen 0,25 tel van het oude rooster, met een fout die van +0,1 s door nul naar −0,1 s liep. De
   mediaan van de laatste 8 bleef daardoor onder 10 ms en de knip gebeurde niet; het stuk stopte pas
   bij drie losse tellen en hield die verkeerde tellen.
5. **De oude analyse meet stabiliteit, niet of het grid op de klappen ligt**: een tempo dat golft
   (±2%) middelt weg in vensters van 12 s; en een tempo dat 0,02% naast ligt (128,024 op een klik)
   loopt in 8 minuten 0,1 tel weg zonder dat iets het ziet.

## 4. Wat er veranderd is

| wat | waar | check |
|---|---|---|
| DJ-tempo: onder 88 ×2, per stuk een macht van twee dicht bij het tempo van het nummer; ½ alleen boven 300, of tussen 180 en 300 als de oude analyse het bevestigt (§11); wals niet ×2 | `dansFactor`, `dansOctaven`, `DANS_MIN/MAX`, `halveer`/`voerHalverenUit` in tellen.js; ook in `maakGridHier` (alleen ×2) | beatbench: 7 DJ-tempo-checks, 5 rekenchecks, 186/192 (§11) |
| de tweede mening bewaard; grids opnieuw los van de GPU, wachten als er een deck speelt | `leesTweede`/`bewaarTweede` in server/tellen.js, `OUDE_ANALYSE_VERSIE` in analyze.js, `gridsUitTellen` in index.js | tellen-server: 15 checks erbij (§11) |
| tellen tot 500 bpm | `MIN_L` in tellen.js | beatbench: 3 × dubbel |
| beginperiode op het rooster, een losse begintel begint niets | `beginPeriode`, `besteRooster` | beatbench: "geen stuk op een verzonnen tempo" |
| staart van een stuk met een ander tempo eraf | `staartKnip` | beatbench: mix 124 → 131, grens < 1 s |
| meten als het netwerk fijner telt dan het grid | `fijner`, `vouwHalf` in meetGrid en afwijkingBij | beatbench: 248 tegen 124 raak, sprong van een halve tel niet |
| oude analyse: tempo bijstellen op de pieken (fase in het midden houden), anders 'drift' | `blokDrift`, `kantelOpPieken` in detect.js, in `maakGridHier` | beatbench: klik 8 min, live band, 3 rekenchecks; gridauto blijft groen (zijn klik: nu 128,0001 in plaats van 128,024) |
| kaart-VERSIE 1 → 2 | tellen.js | tellen.test: versie = VERSIE |
| test 32 bpm: was 64, nu 128 (het dansbereik) | tellen.test | bewuste gedragswijziging |

**VERSIE 2, wat dat in Clay's library doet**: bij de eerste start rekent de server elk automatisch grid
uit de tellen opnieuw, zonder GPU. Grids op slot of met de hand bewerkt blijven staan (`wilTellenGrid`).
**Wat het kost** (gecorrigeerd in de tweede review, §11): gridUitTellen + vergelijk zijn 30–100 ms per uur
muziek, maar de tweede mening (de oude analyse: maakGrid met ffmpeg, en maakOnset als het onset-bestand
ontbreekt) werd per nummer opnieuw gerekend: **0,7–4 s per nummer van drie minuten** (proefserver, drie
nummers: 3,5 / 3,8 / 8,1 s, samen 15,4 s), in een worker en met ffmpeg op media/. Voor een library van
300 nummers is dat 4–20 minuten. Nu: die rekent de server alleen als hij nog niet bewaard is
(`tweede-mening.json`), los van de GPU, en hij wacht zolang er een deck speelt; daarna kost een volgende
kaartversie 0,1 s voor dezelfde drie. De eerste start na deze tak betaalt het wel één keer (Clay's
library heeft nog geen bewaarde tweede mening). Nummers die Beat This! op 70–87 hoorde krijgen het
dubbele tempo. Wat daarmee meeverandert:
- de sectiekaart: bij het volgende laden opnieuw berekend (het grid veranderde);
- bewaarde sampler-pads: omgerekend (tellen en bpm × 2, `_samplesNaarOctaaf`, §10 punt 3); zonder
  dat speelde een pad van 4 tellen op 77 na de herberekening als 4 tellen op 154, dubbel zo snel. Een
  pad van 8 tellen op 77 wordt 16 op 154 en is daarmee meer dan 8 tellen: een SECTIE voor de sampler
  (start op de "1" van de maatgever in plaats van op de volgende tel, CLAUDE.md "Secties"). Dezelfde
  muziek (4 maten), dus waarschijnlijk goed, maar het gedrag verandert;
- staat het nummer al op een deck terwijl de server opnieuw rekent, dan houdt dat deck het oude grid en
  de oude herinneringen tot het opnieuw geladen wordt; een pad die je dan knipt gaat met de tellen van het
  oude octaaf naar de server (een randgeval, niet nieuw in soort);
- een tabblad op een OUDERE checkout gooit de twijfel `'tel'` weg als onbekend (`TWIJFELS`): per ontwerp;
- NIET omgerekend: lengtes in het setplan in `{ maten }` (in seconden half zo lang na ×2);
- ook automatische grids van de OUDE analyse worden vervangen zodra er een tellen.json is
  (`methode !== 'tellen'`; dat deed wilTellenGrid al vóór deze tak), dus ook die kunnen van octaaf wisselen;
- nummers ZONDER tellen.json houden het grid van de oude analyse (geen versie, niet opnieuw gedaan):
  die kunnen op 70–87 staan terwijl nieuwe ingests op 140–174 komen. Voor de auto-DJ (tempo ≤ 6%)
  en "past bij" liggen die een octaaf uit elkaar tot er tellen zijn of je ↻ drukt (vraag 4).

## 5. Wat niet gedaan is, en waarom

- **Beat This! telt onder 300 het dubbele en niets bevestigt het** (§11): het grid blijft zeker op het
  dubbele tempo, zoals vóór de tak (alle lijnen op een tel, geen vals zeker, maar sync tegen 124 speelt
  op halve snelheid): live-drift/dubbel en oplopend/dubbel (de oude analyse is daar zelf niet zeker).
  Met de downbeats op de "en" (dubbel-laat) staat de "1" dan op de "en", zonder twijfel. Wordt maar een
  deel van de stukken bevestigd, dan wisselt het nummer van octaaf (live-drift/dubbel: 10% op 120).
- **Halveren rust op een aanname**: telt Beat This! dubbel, dan liggen zijn downbeats nog om de 8 van
  zijn tellen (de echte maat). Zo doet nep-beatthis het; op Clay's muziek telde het netwerk nooit
  dubbel (BEATGRID §11). Telt het dubbel met downbeats om de 4, dan halveert niets onder 300.
- **De oude analyse kent de maat niet** (de kleine reviewopmerking over `per` in maakGridHier): hij
  heeft geen downbeats, dus geen wals; `beatsPerBar` is daar altijd 4. Een wals die hij op 75 hoort
  wordt 150, de tellen-route verdubbelt een wals niet. Alleen een notitie `octaaf: 2` in vergelijk.

- **De blinde combinatie** (§10): Beat This! telt dubbel, zijn downbeats liggen op de "en", én de oude
  analyse hoort ook de offbeat. Twee bronnen die het eens zijn in dezelfde fout; de tellen zelf zijn
  symmetrisch. Dan zeker en een halve tel naast. beatbench houdt dat geval apart (19 van de 456).
- **De oude analyse blijft 2 van 19 VALS ZEKER** (live-drift, indie-154), vóór en na: "geen vals zeker"
  geldt voor de tellen-route, het hoofdpad. Bij die twee nummers staan de zekere stukken van de oude
  analyse met minder seconden naast (27,5 → 5,75 s en 18,5 → 16,5 s), niet op nul.

- **Een consequent verkeerde "1" van Beat This!** (`eenfout`: 0% goed). Uit tellen en downbeats alleen
  niet te zien; daar is de audio voor nodig (optie 2 hieronder).
- **De oude analyse kent geen "1"** (wals 26%, reggae 0%, live band 8%) en hoort 178 als 89. Niet
  aangepakt: de tellen-route is het hoofdpad; de oude is de terugval en de tweede mening.
- **Een tempo dat golft blijft deels vals zeker in de oude analyse** (5,75 s en 16,5 s). blokDrift
  kijkt alleen naar pieken binnen 0,2 tel van een lijn; waar het grid verder wegloopt ziet hij het
  niet. Geprobeerd: de fase per blok als de piek van een histogram. Valt af: zonder de sterkte van
  een piek wint de offbeat (hats) even vaak als de tel, dus vals alarm op elk vier-op-de-vloer-nummer.
- **Beat This! en de oude analyse allebei op 89, op een andere tel** (een 178 dat beide halveren):
  "oneens" en onzeker, 0% dekking. Een regel "oneens met precies een halve tel = het dubbele tempo"
  zou het oplossen, maar geldt alleen tussen 88 en 90 bpm en kan een echte offbeat-fout verbergen.
- **Geen downbeats uit de audio, geen nieuw model, geen wijziging aan tellen.py.**
- De fase van de tellen-route (0,1–0,4 ms mediaan) is te mooi: de nep-tellen hebben ruis zonder vaste
  afwijking per instrument. Op echte muziek ligt het netwerk ~5 ms naast (BEATGRID.md §11). De
  benchmark zegt dus iets over tempo, stukken, octaaf en zekerheid, niet over de laatste ms.

## 6. Alleen op Clay's Mac (of met zijn muziek) te bevestigen

- De eerste start na deze tak op Clay's library: hoe lang `gridsUitTellen` duurt (log: `[tellen] N grids
  uit bestaande tellen klaar — X s`; per nummer `— X s, tweede mening uitgerekend`), en dat het wacht
  zolang er een deck speelt (`[tellen] er speelt een deck: de oude analyse (tweede mening) wacht`).
- Telt het echte Beat This! ooit het dubbele, en liggen zijn downbeats dan om de 8 tellen (de aanname
  van het halveren onder 300)? Met `--echt` op de benchmark is dat te zien.

- Het echte Beat This! op de benchmark (`--wav` / `--echt`, commando's in §1): kiest het netwerk echt
  86 voor jungle en 70 voor half-time, en hoe vaak verdubbelt het?
- Wat VERSIE 2 doet met Clay's library: hoeveel grids krijgen het dubbele tempo, en is dat steeds
  wat hij tikt? Ciel (77 → 154) en het album (75 → 150) zouden goed moeten worden; "Let it all go"
  staat in §11 als 170 (oud) tegen 75 (Beat This!): dat is geen octaaf, dus kijken.
- De drempels van blokDrift (0,04 / 0,08 tel) zijn gekozen op synthetische muziek (schoon hooguit
  0,03 tel). Op echte muziek kunnen onset-pieken meer spreiden (±15 ms per klank): kijken of er
  zekere stukken van de oude analyse onterecht 'drift' worden. De 48 fragmenten van
  `tools/beatmeting/rest/gridpast.mjs` op Clay's library zijn de manier (leest alleen).

## 7. Opties voor een volgende versie

| optie | wat | kosten | baten |
|---|---|---|---|
| 1. Het echte model in de benchmark | `--wav`/`--echt` één keer op de Mac draaien, de uitkomst (19 tellen.json, ~1 MB) in `test/fixtures/` zetten, en beatbench ook op de echte tellen laten toetsen | een uur op de Mac | de nep-fouten vervangen door de echte; de octaafkeuze van het netwerk gemeten in plaats van aangenomen |
| 2. De "1" uit de audio als tweede mening | per maatfase de lage-frequentie-energie (kick, bas) en de crash op de tellen van het grid; spreekt die de downbeats van Beat This! consequent tegen, dan `twijfel: 'maat'` | een dag; de envelope per band bestaat al (onsetEnvelope) | vangt de verkeerde "1" (`eenfout` nu 0%), en geeft de oude analyse eindelijk een "1" (nu 8-26% bij wals/reggae/live) |
| 3. Een tempo dat golft volgen in plaats van weigeren | ook in de oude analyse stukken korter laten zijn waar de fase langzaam wegloopt (zoals gridUitTellen al doet: knip waar 8 tellen > 10 ms naast liggen), op de onset-pieken | twee dagen, plus opnieuw de 48 fragmenten meten | een band zonder klik krijgt een grid dat klopt in plaats van "onzeker" (oude analyse: dekking 12% op de live band) |
| 4. Het dansbereik per nummer of per krat | `DANS_MIN/MAX` als instelling, of een voorkeur per krat (reggae/dub 60–120, jungle 160–180) | een halve dag (analyse) + een plek in de UI (spoor bediening) | wie veel reggae of downtempo draait, krijgt zijn eigen tel; nu kost dat ×½ per nummer |
| 5. Zekerheid ijken op de benchmark | de drempels (RAAK, DRIFT, ZEKER_VANAF, blokDrift) als curve: dekking tegen vals zeker over alle 114+19 gevallen, en het punt kiezen | een halve dag | de drempels zijn nu op het oog gekozen; zo zie je wat een milliseconde marge kost |
| 7. De fase van een gehalveerd stuk uit de audio | waar de oude analyse niet zeker is (band zonder klik, versnelling): de onset-envelope in de lage band (kick, bas) op de even tegen de oneven tellen van het netwerk | een dag, plus meten op house met de bas op de offbeat (daar kan het misgaan) | live-drift/dubbel, oplopend/dubbel en indie-154/dubbel (nu 23%, 0% en 35% zeker) worden zeker als de audio het zegt |
| 8. Kiezen bij "oneens" (§10 punt 4) | downbeats en oude analyse oneens over de fase na ½: nu blijft de fase van de downbeats staan (onzeker); de oude analyse (de kicks) heeft vaker gelijk | een uur + een check | het grid ligt goed als Clay het controleert (dubbel-laat: 88% naast, onzeker) |
| 9. Eén octaaf per nummer | wordt een deel van de stukken bevestigd gehalveerd (of niet), dan de rest van hetzelfde nummer meenemen als die op hetzelfde tempo liggen (nu wisselt live-drift/dubbel van octaaf) | een halve dag + checks | sync en beat-loops springen niet van octaaf binnen een nummer |
| 10. De tweede mening voor de oude library 's nachts | nieuwe nummers krijgen hem vanzelf (pasTellenToe bewaart het grid van de ingest of rekent hem); voor wat er al is een nachttaak (zoals de nachtwachtrij: venster, geen deck) die hem één keer rekent, vóór een kaartversie omhoog gaat | een paar uur | ook de eerste start na een kaartversie kost niets meer |
| 6. Meer nummers in de benchmark | een DJ-mix van een uur (vier nummers met overgangen), een live opname met applaus, een nummer met een tempowissel van 3:2 | per nummer een uur | dekt de grenzen die nu alleen in de tekst staan (golvend tempo, 3:2) |

## 8. Vragen voor Clay

1. **Het dansbereik** (de winst op het DJ-tempo zit deels in de constructie: nep-beatthis legt
   het octaaf vast dat het netwerk waarschijnlijk kiest, alleen 77 voor Ciel is op het echte model
   gemeten; daarom is vraag 3 belangrijk): een nummer dat Beat This! op 70–87 hoort, krijgt nu het dubbele tempo
   (Ciel 77 → 154, zoals jij tikt). Reggae of downtempo die je echt op 75 telt, krijgt dan ook 150.
   Is dat goed, of draai je genoeg van die muziek dat het per krat moet (optie 4)? Aan de BOVENKANT
   (tweede review): wat Beat This! op 181–300 telt blijft dat tempo (echte jungle/dnb/hardcore op 186
   blijft 186, zeker). Halveren gebeurt daar alleen als de downbeats om de 8 tellen vallen én de oude
   analyse het halve tempo in die fase hoort. De prijs: telt het netwerk onder 300 toch het dubbele en
   bevestigt niets het, dan blijft het dubbele tempo staan (zeker, alle lijnen op een tel).
2. Mag de server bij de eerste start alle automatische grids uit de tellen opnieuw rekenen (VERSIE 2)?
   **Wat het kost** (gecorrigeerd, §11): per nummer 0,7–4 s van drie minuten de oude analyse opnieuw
   (in een worker, ffmpeg op media/), dus voor 300 nummers 4–20 minuten achtergrondwerk, één keer. Het
   wacht zolang er een deck speelt, en de GPU (stems, nieuwe tellen) wacht er niet meer op. Daarna is
   de tweede mening bewaard en kost een volgende versie milliseconden. Je eigen grids (op slot of met de
   hand) blijven staan; bewaarde sampler-pads worden meegerekend; lengtes in het setplan in maten niet.
   Zo niet: VERSIE op 1 laten, dan geldt het alleen voor nieuwe nummers en na ↻.
3. Wil je één keer het echte Beat This! op de benchmark draaien (drie commando's, §1)? Dan weten we
   of de nep-tellen kloppen.
4. Nummers zonder tellen (Beat This! niet geïnstalleerd toen ze binnenkwamen) houden het grid van de
   oude analyse, ook op 70–87. Moet de oude analyse ook een versie krijgen, zodat ze bij het opstarten
   in het dansbereik komen (een paar seconden per nummer in de worker, op de achtergrond)?
5. Telt Beat This! het dubbele tempo en kan de oude analyse het niet bevestigen (een band zonder klik),
   dan koos de eerste herstelling het DJ-tempo en ONZEKER. Na de tweede review is dat omgedraaid ONDER
   300: dan blijft het tempo van het netwerk (240) en zeker, zoals vóór de tak (alle lijnen liggen op
   een tel, maar sync tegen een nummer op 120 speelt op halve snelheid), omdat halveren zonder
   bevestiging echte 186 kapotmaakte. BOVEN 300 (het netwerk telt de achtsten) blijft het halveren,
   onzeker tot het bevestigd is. Klopt dat met hoe je werkt, of liever een melding "dubbel tempo?" op
   zo'n stuk (een voorstel, geen twijfel)?

## 9. Tests

**Na de tweede review (§11)**: `node test/beatbench.test.mjs` 59 checks groen (14 rood op c7028b7);
`tellen-server` 67 (+15), `tellen` 90, `gridauto`, `gridzeker`, `server`, `library`, `regels`, `analyze`,
`detect`, `beatgrid` groen. `node test/alles.mjs`: 95 bestanden, 8872 checks, 9 overgeslagen, 3 bestanden
rood, alleen de drie die in deze container op main al rood zijn: renderblok "keylock met wissels … bytes
per bericht", instrumenten-fm-schaal "geen afval per blok", wachtrij "yt-dlp en zijn kind zijn allebei
weg" (2×). (Eén kleine wijziging kwam na het starten van die run: het bewaren van het grid dat er stond
als tweede mening; de tests die hem raken zijn daarna los opnieuw gedraaid, allemaal groen.)

Eerder (ronde 0 en 1):
`node test/beatbench.test.mjs`: 46 checks groen (na review ronde 1; eerst 37) (op 7debab6: 19 rood, daarna stopt hij op een
functie die er nog niet was). `tellen`, `tellen-server`, `detect`, `gridauto`, `gridzeker`,
`beatgrid`, `analyze`: groen. `node test/alles.mjs`: 95 bestanden, 8833 checks, 4 rood: de drie die
in deze container op main al rood zijn (renderblok "keylock met wissels … bytes per bericht",
instrumenten-fm-schaal "geen afval per blok", wachtrij "yt-dlp en zijn kind zijn allebei weg" 2×) en
upload "768 MB + 64 MB zonder lengte: 413 onderweg". Die laatste is alleen groen (los gedraaid, op
deze tak én op 7debab6): hij viel om terwijl de benchmark tegelijk draaide (geheugen/timing); deze tak
raakt de upload-route niet.

## 10. Review ronde 1 (14 okt): wat ik met elk punt deed

Vier blokkerende punten van de reviewers, alle vier nagemeten met hun eigen scripts (in de scratchpad:
`rev-bga/halftel2.mjs`, `rev-bga/achtsten.mjs`, `rev1-bga/s/adv.mjs`, `adv2.mjs`, `adv3.mjs`) en
bevestigd op 7092a61. De kern: **halveren naar het DJ-tempo is een gok over welke van de twee tellen de
tel is**, en de eerste versie behandelde die gok als een meting.

Nameting, de hele benchmark met de twee nieuwe soorten fouten erbij (152 gevallen):

```
node tools/beatmeting/synth/bench.mjs --code <7debab6> --json voor.json
node tools/beatmeting/synth/bench.mjs --code <7092a61> --json r0.json
node tools/beatmeting/synth/bench.mjs --json na.json
node tools/beatmeting/synth/groep.mjs voor.json r0.json na.json
```

| soort fout (19 nummers elk) | vóór 7debab6: vals / dekking | eerste versie 7092a61 | na ronde 1 |
|---|---|---|---|
| bt, ruis, half, wissel, eenfout | 1 / 92–100% | 0 / 92–100% | 0 / 92–100% (gelijk aan 7092a61) |
| dubbel | 0 / 72% | 0 / 100% | 0 / 87% |
| dubbel-laat (downbeats op de "en") | 0 / 72% | **16** / 100% | **0** / 12% |
| dubbel-kaal (geen downbeats, begint op de "en") | 0 / 72% | **4** / 100% | **0** / 78% |
| alle 152 | 1 | 20 | **0** |

1. **fijner/vouwHalf maakte een slot-grid dat een halve tel naast ligt "100% raak"** zodra het netwerk
   in een deel van het stuk dubbel telde. Bevestigd: bij 20% en 30% achtsten raak 1,00 en 🔒 (vóór
   0,17 en 0,23, 🔒?). Gedaan wat de reviewer voorstelde: vouwen alleen als de lijnen de meerderheid
   dragen (`opLijn ≥ 0,8 × opHelft`, per stuk in meetGrid, per 16 tellen in afwijkingBij). Na: 15/20/30%
   → 0,13/0,17/0,23 en 🔒? (`halftel2.mjs`); het goede grid met dezelfde achtsten blijft 🔒 en raak.
   Telt het netwerk OVERAL dubbel, dan scoort ook een verkeerd grid raak (dat kan niet anders: de
   tellen zijn symmetrisch); de meting zegt dan `fijn: true` en het oordeel zegt erbij "welke van de
   twee de tel is, zeggen de tellen niet". Checks in beatbench (drie).
2. **Halveren boven 300 bpm zonder downbeats gokte de fase en zei zeker.** Bevestigd: begint het
   netwerk op de "en", dan 172 bpm, zekerheid 1, een halve tel naast. Nu (zie 4) is elk gehalveerd stuk
   onzeker (`twijfel: 'tel'`) tot twee bronnen het eens zijn; zonder downbeats is er maar één (de oude
   analyse), dus het blijft onzeker, maar de oude analyse kiest wel de fase: vast-160, vast-178 en
   jungle-172 met het netwerk op de "en" komen een halve tel op de goede plek (naast 100% → 0%) en staan
   op onzeker (scratchpad `r1/flip.mjs`; beatbench: "boven 300 bpm zonder downbeats …"). `dubbel-kaal` is de variant
   in nep-beatthis.
3. **VERSIE 2 liet bewaarde sampler-pads dubbel zo snel spelen.** Opgelost in de analyse-laag:
   `bewaarAutoGrid` rekent in dezelfde transactie de pads van dat nummer om als het nieuwe grid daar een
   macht van twee van het oude is (`_samplesNaarOctaaf`, tellen en bpm × 2 of ½; een pad zonder grid of
   een ander tempo blijft staan). Check in tellen-server.test: autoA (oude analyse 240 → tellen 120),
   een pad van 8 tellen op 240 wordt 4 op 120, een pad zonder grid niet, en het logboek zegt het. Niet
   omgerekend: lengtes in het setplan in `{ maten }` (genoemd in §4 en vraag 2).
4. **Halveren gaf een grid een halve tel naast en zeker, over het hele nummer, en vergelijk zag het
   niet.** Bevestigd: met de downbeats een netwerktel te laat werden 16 van 19 nummers vals zeker over
   100% van hun tijd, ook met de oude analyse zeker in de goede fase als tweede mening (de tellen vallen
   om en om op 0 en 0,5 van zijn tel en heffen elkaar op). Gedaan: `gridUitTellen` markeert een
   gehalveerd stuk (`halvering`) en zet het op onzeker met `twijfel: 'tel'`; `vergelijk` legt de LIJNEN
   van het stuk in de tel van de oude analyse (grid tegen grid, `bevestigHalvering`; op het halve tempo
   in zijn halve tel; een ander op het dubbele tempo zegt niets). Eens (≤ 0,2 tel) én downbeats = zeker;
   oneens (≥ 0,3 tel) met downbeats = `'oneens'`; zonder downbeats de fase van de ander, onzeker. Na:
   0 van 152 vals zeker met de echte oude analyse; in beatbench 437 van 456 combinaties (nummer × soort ×
   geen/goede/tegendraadse tweede mening) zonder vals zeker, plus de echte oude analyse op house-124 en
   jungle-172 dubbel/dubbel-laat/dubbel-kaal. De 19 die overblijven zijn de blinde combinatie (§5).
   **Prijs**: waar de oude analyse zelf niet zeker is, blijft een gehalveerd stuk onzeker ook als het
   goed ligt: live-drift/dubbel 100 → 23%, oplopend/dubbel 100 → 0%, indie-154/dubbel 100 → 35%
   dekking (vóór de tak: zeker op 240, alle lijnen op een tel, maar sync tegen een nummer op 120 speelt
   dan op halve snelheid; vraag 5). Optie 7 maakt dat terug.

Kleine punten:
- `dansOctaven`: een stuk volgt het octaaf van het nummer alleen als het daar binnen 6% komt (`DANS_BIJ`,
  de tempogrens van de auto-DJ). 95 in een mix op 175 blijft 95 (was 190); 87,5 daar wordt 175. 87 in een
  nummer op 124 blijft 174: dat zegt het bereik zelf (onder 88), en 87 ligt even ver van 124 als 174. Check.
- Wat VERSIE 2 verder raakt (oude-analyse-grids met een tellen.json, een gemengde library zonder tellen,
  de maat bij ×2): §4 en BEATGRID.md §12; vraag 4.
- De samenvattingstabel heeft nu ook "tempo (het echte octaaf)" (57 → 87%) en het DJ-tempo zonder vast-72
  en reggae-75 (54 → 98%).
- "Geen vals zeker meer" geldt voor de tellen-route; de oude analyse blijft 2 van 19 (§5).
- Rekentijd, warm gemeten (`rev1-bga/s/tijd.mjs`, 7315 tellen, beste van 7): 35 ms (7debab6), 35 ms
  (7092a61), 32 ms (nu); de eerste keer 68 / 76 / 97 ms. De machine is luidruchtig; niet merkbaar.
- De regels: geen import in de engine veranderd (regels.test groen), niets aan het audiopad, mapping,
  controllers of terugspelen. `TWIJFELS` in beatgrid.js kreeg `'tel'` (library en Beatgrid bewaren hem).

Tests na ronde 1: beatbench 46 checks groen (9 ervan rood op 7092a61, de meeste ook op 7debab6);
tellen, tellen-server (+2), detect, gridauto, gridzeker, beatgrid, analyze, library, regels groen.
`node test/alles.mjs` na ronde 1: 95 bestanden, 8846 checks, 8 overgeslagen, 3 bestanden rood, alleen
de drie die in deze container op main al rood zijn: renderblok "keylock met wissels … bytes per bericht",
instrumenten-fm-schaal "geen afval per blok", wachtrij "yt-dlp en zijn kind zijn allebei weg" (2×).
De upload-check van de eerste ronde is groen.


## 11. Review ronde 1, tweede lezing (14 okt): halveren onder 300, en wat VERSIE 2 kost

De tweede review vond twee blokkerende fouten (elk door twee reviewers gemeld), beide bevestigd en
opgelost. Om het na te doen: `bench.mjs` op de drie nummers (de reproductie van de reviewer,
`rev2-bga/s/snel2.mjs`, met de ECHTE oude analyse als tweede mening; in de scratchpad ook als
`r1h/snel3.mjs`) en `tools/beatmeting/synth/opstart.mjs` (nieuw: een proefserver, standaard poort 8866).

### A. Een schoon nummer boven 180 werd gehalveerd en onzeker (punten 1 en 3)

**Bevestigd.** Met de code van de eerste herstelling (c7028b7) en de echte oude analyse:

```
for c in <checkout van 7debab6> <checkout van c7028b7> .; do
  node tools/beatmeting/synth/bench.mjs vast-178 vast-186 vast-192 --varianten bt,ruis,eenfout,dubbel --code $c; done
node test/beatbench.test.mjs     # de test van nu op de code van c7028b7 (test + nummers.mjs erin gekopieerd): 14 rood
```

| nummer (Beat This! telt goed) | 7debab6 | c7028b7 (eerste herstelling) | nu |
|---|---|---|---|
| vast-186 / bt (oude analyse: 93) | 186,0 z0,96 | 93,0 z0,60 'oneens' | 186,0 z0,96 |
| vast-192 / bt (oude analyse: 96, niet zeker) | 192,0 z0,97 | 96,0 z0,60 'tel' | 192,0 z0,97 |
| vast-186 / eenfout ("1" een tel te laat) | 186,0 zeker | 93,0 z0,98 (zeker op het halve tempo) | 186,0 zeker |
| vast-186, vast-192 / bt zonder tweede mening | zeker | 93 / 96, 'tel' | 186 / 192, zeker |

**De oorzaak**: `dansOctaven` halveerde alles boven DANS_MAX (180) met downbeats, en `gridUitTellen` zette
elk gehalveerd stuk op onzeker tot de oude analyse het bevestigde. Maar bij echte 186 hoort de oude
analyse 186 (dat is het dubbele van het gehalveerde stuk: geen stem) of 93 in een fase die op een
vier-op-de-vloer willekeurig is (vast-186: een halve tel van de downbeats, dus 'oneens'; met de "1" een
tel te laat toevallig samen, dus 93 en zeker). Het halveren onder 300 rustte alleen op de nep-variant
`dubbel`: op Clay's muziek telde Beat This! nooit het dubbele (BEATGRID §11: 77/75/75).

**Wat ik deed** (`src/engine/tellen.js`):
1. `dansOctaven` halveert alleen nog als het MOET: boven MAX_BPM (300, het netwerk telt de achtsten).
   Tussen 180 en 300 blijft het tempo van het netwerk staan, met zijn eigen zekerheid (zoals vóór de tak).
2. Telt het netwerk daar toch het dubbele, dan een VOORSTEL: `gridUitTellen` zet `halveer: { bpm, anker op
   de "1", raak }` op het stuk, alleen als het stuk zelf in orde is, de downbeats het eens zijn (≥ 4,
   stem ≥ 0,6) EN ze om de 8 (of 6) tellen van het netwerk vallen: twee keer de maat. Bij echte 186
   vallen ze om de 4, dus geen voorstel (dat sluit het eenfout-geval uit).
3. `vergelijk` voert het voorstel alleen uit als de oude analyse ZEKER het halve tempo hoort, het stuk
   op het netwerktempo niet tegenspreekt, en zijn tel op de lijnen van het voorstel ligt (≤ 0,2 tel,
   `voerHalverenUit`): dan het halve tempo met de raak van het gehalveerde grid. Anders blijft het
   netwerktempo met `octaaf: 0.5` erbij, NIET 'oneens' (wie gelijk heeft over het tempo weten we dan niet).
   `halveer` gaat nooit de library in (normaliseerGrid is een witte lijst; check).
4. Boven 300 blijft alles van §10 punt 2 en 4 (`halvering`, 'tel', `bevestigHalvering`).

**Bewijs** (beatbench, 59 checks, 14 daarvan rood op c7028b7): "schoon 186 en 192 met downbeats: zeker op
het echte tempo, met en zonder tweede mening"; "echte oude analyse, vast-186/bt, /ruis, /eenfout en
vast-192/bt, /ruis, /eenfout goed geteld: blijft 186/192, zeker" (zes checks met ffmpeg en maakGrid);
"echte 186: de downbeats om de 4, dus geen voorstel"; "248 met de downbeats om de 8: een voorstel, de kaart
blijft 248"; "onder MAX_BPM ook MET '1' niet halveren: 186, 192, 248 ×1"; "house dubbel geteld zonder
tweede mening: niet gehalveerd; met een die 124 hoort: 124, zeker". De twee nummers staan in
`nummers.mjs` (precies die van de reviewer: vier op de vloer, anker 0,05).

Benchmark, 21 nummers × 8 soorten (`bench.mjs` + `groep.mjs`, vóór / c7028b7 / nu):

| soort fout | 7debab6 vals / dekking / DJ | c7028b7 | nu |
|---|---|---|---|
| bt | 0 / 100% / 75% | 0 / 90% / 90% | 0 / 100% / 100% |
| ruis | 1 / 98% / 75% | 0 / 89% / 90% | 0 / 99% / 100% |
| half | 0 / 88% / 0% | 0 / 88% / 80% | 0 / 88% / 80% |
| dubbel | 0 / 65% / 10% | 0 / 78% / 89% | 0 / 92% / 91% |
| wissel | 0 / 96% / 76% | 0 / 88% / 90% | 0 / 98% / 100% |
| eenfout | 0 / 99% / 75% | 0 / 94% / 90% | 0 / 99% / 100% |
| dubbel-laat | 0 / 65% / 10% | 0 / 11% / 89% | 0 / 70% / 40% |
| dubbel-kaal | 0 / 65% / 10% | 0 / 70% / 40% | 0 / 70% / 40% |
| de 126 gewone | 1 / 91% / 52% | 0 / 88% / 88% | 0 / 96% / 95% |

```
node tools/beatmeting/synth/bench.mjs --code <7debab6> --json voor.json
node tools/beatmeting/synth/bench.mjs --code <c7028b7> --json r1.json
node tools/beatmeting/synth/bench.mjs --json na.json
node tools/beatmeting/synth/groep.mjs voor.json r1.json na.json
node tools/beatmeting/synth/bench.mjs --vergelijk r1.json na.json     # 26 rijen anders
```

**De prijs aan de bovenkant** (staat nu in §5, vraag 1 en 5, BEATGRID §12 punt 9): telt Beat This! onder
300 het dubbele en bevestigt niets het, dan blijft het grid zeker op het dubbele tempo, zoals vóór de tak:
alle lijnen op een tel (geen vals zeker), maar sync tegen 124 speelt op halve snelheid. Dat is
dubbel-laat onder 300 (11 → 70% dekking, maar de "1" op de "en": 0%), live-drift/dubbel (23 → 100%
dekking, 10% op het echte tempo) en oplopend/dubbel (0 → 100%, 0%). "Nergens vals zeker" blijft: 0 van
168 met de echte oude analyse, en in beatbench 483 van 504 combinaties (de 21 die overblijven zijn de
blinde combinatie van §5).

### B. Wat VERSIE 2 bij het opstarten kost: geen milliseconden (punten 2 en 4)

**Bevestigd.** `pasTellenToe` nam voor een grid met methode 'tellen' de tweede mening niet uit het
bewaarde grid maar rekende de oude analyse opnieuw (maakGrid met ffmpeg, maakOnset als het onset-bestand
ontbreekt), na elkaar voor elk nummer, en `gpu.open()` wachtte daarop. Gemeten op een proefserver
(poort 8866, drie nummers met een tellen-grid van versie 1 en een tellen.json, VARVE_HERANALYSE=100):

```
node tools/beatmeting/synth/opstart.mjs [--poort 8866] [namen ...]
```

| | per nummer | drie nummers |
|---|---|---|
| eerste start (nu, zonder bewaarde tweede mening) | house-124 3,8 s, live-drift 8,1 s, jungle-172 3,5 s | 15,4 s (een tweede run, met alles.mjs ernaast: 12,6 s) |
| tweede start (bewaard) | 0,0 s | 0,1 s (0,0 s) |

(De reviewers maten 10,4 s met een onset-bestand dat er al was, en maakGrid alleen 0,7–4,05 s per nummer
van 3 min. In mijn meting ontbrak het onset-bestand en liep de toon- en sectieanalyse van dezelfde start
ernaast.) "30–100 ms per uur" gold alleen voor gridUitTellen + meetGrid; dat stond fout in §4, vraag 2,
BEATGRID §12 en het VERSIE-commentaar.

**Wat ik deed**:
1. De tweede mening wordt bewaard: `media/<id>/tweede-mening.json` `{ versie, uit, grid }`
   (`leesTweede`/`bewaarTweede` in server/tellen.js; eerst .tmp, dan hernoemen; gooit nooit). `versie` =
   `OUDE_ANALYSE_VERSIE` (nieuw in server/analyze.js: omhoog als maakGrid iets anders gaat geven). Ook het
   grid van de oude analyse dat er stond (bij de ingest) wordt bewaard (`uit: 'grid'`), zodat nieuwe
   nummers hem vanzelf hebben. `wisTellen` (nieuwe audio) haalt hem mee weg; ↻ rekent altijd opnieuw.
2. De herberekening loopt in `gridsUitTellen`, LOS van de GPU (die gaat meteen open), de goedkope nummers
   eerst (tweede mening bewaard, of een grid van de oude analyse), en de oude analyse wacht zolang er een
   deck speelt (`speeltDeck`, dezelfde als de nachtwachtrij; één melding per minuut in het log).
3. Elke `[tellen]`-regel zegt nu hoe lang het duurde en waar de tweede mening vandaan kwam; aan het eind
   `[tellen] N grids uit bestaande tellen klaar — X s`.
4. De juiste cijfers staan in §4, vraag 2, BEATGRID §12 en het VERSIE-commentaar.

**Bewijs** (tellen-server.test, 15 checks erbij): bewaren/lezen/versie/vreemd id/onleesbaar/wisTellen;
"een tellen-grid van versie 1 wordt bij het opstarten versie 2", "met een bewaarde tweede mening: geen
oude analyse", "zonder: de oude analyse gerekend, en daarna bewaard", het totaal in het log; "het grid van
de oude analyse dat er stond is als tweede mening bewaard"; en een tweede start met een Range-verzoek op
audio.wav (een deck streamt): "met een bewaarde tweede mening: meteen opnieuw", "zonder: wacht tot er geen
deck meer speelt (en zegt dat)", "en het grid staat er nog van versie 1".

**Wat het voor Clay betekent**: de eerste start na deze tak betaalt het één keer (0,7–4 s per nummer van
drie minuten, voor 300 nummers 4–20 minuten in een worker), maar niet terwijl er gespeeld wordt; daarna is
een kaartversie milliseconden. Optie 10 (§7) haalt ook die ene keer weg.

### Kleine punten

- CLAUDE.md "elk automatisch grid komt in 88–180": klopte niet. Herschreven: onder 88 ×2, ½ alleen boven
  300 of bevestigd; een tempo boven 180 blijft. Ook in BEATGRID §12 punt 1.
- `maakGridHier` zonder `per`: niet veranderd (§5): de oude analyse kent geen maat, dus geen wals.
- `_samplesNaarOctaaf` 8 → 16 tellen = een sectie voor de sampler: staat nu in §4.
- Een deck dat het oude grid houdt terwijl de server opnieuw rekent: §4 (randgeval).
- De naam van het basispunt: verbeterd (7debab6; studio/afmaken staat nu op 849af2d, alleen VIDEO_KNIP anders).
- `'tel'` wordt door oudere code weggegooid: §4 (per ontwerp).
- Gemengde octaven binnen één nummer: met punt A grotendeels weg (stukken onder 300 halveren niet meer
  vanzelf); wat overblijft (live-drift/dubbel: 10% op 120) staat in §5, met optie 9.
- `bench.mjs`: de cache-sleutel van de oude analyse hasht nu ook `src/engine/tellen.js`. De cijfers van
  deze ronde zijn met een verse cache gemeten (`TMPDIR=r1h/tmp`).
- Niets aan het audiopad, de klok, mapping, bus, terugspelen of OVERNEEM; geen import in de engine erbij.
