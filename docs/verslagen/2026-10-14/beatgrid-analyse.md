# Het automatische beatgrid: een benchmark, en wat er beter werd (14 okt 2026)

Spoor beatgrid-analyse, tak `afmaken/beatgrid-analyse` (vanaf `studio/afmaken` 7debab6). Alleen de
analyse: `src/engine/tellen.js`, `server/detect.js`, `server/analyze.js`, een benchmark en een test.
Niets aan bediening, mapping of controllers. Doc: `docs/BEATGRID.md` §12.

Clay: *"ik wil er altijd zeker van zijn dat het klopt"*. De ergste fout is daarom **vals zeker**: het
grid zegt zeker (sync en beat-loops mogen) en ligt naast de muziek.

## 1. Wat er gemeten werd, en hoe je het herhaalt

Er was geen meting met een bekend antwoord: alles was gemeten op Clay's muziek, waar niemand weet
waar de tel echt ligt. Nu wel: `tools/beatmeting/synth/`.

- **19 synthetische nummers** (`nummers.mjs`, vast zaad), elke tel en "1" exact bekend: vast tempo
  72 · 96 · 124 · 140 · 160 · 178, shuffle 118, een break van 8 maten zonder kick, een intro van 8
  maten zonder kick, een mix 124 → 131 in een andere fase, een band zonder klik (120 ±2%, slagen
  σ 6 ms), een versnelling 122 → 126, een wals 150, reggae one drop 75, jungle 172 (breakbeat),
  half-time 140, ambient zonder puls, een opmaat van drie tellen, een band op 154 zonder klik
  (zoals Ciel).
- **Tellen zoals Beat This! ze geeft** (`nep-beatthis.mjs`), zes soorten: `bt` (σ 6 ms, 3% gemist,
  2% extra, 4% van de downbeats een tel verschoven, en het octaaf dat het netwerk waarschijnlijk kiest:
  86 voor jungle, 77 voor de band op 154, 70 voor half-time), `ruis` (σ 10 ms, 10% gemist, 6% extra,
  15% downbeats fout), `half`, `dubbel`, `wissel` (halverwege ineens het halve tempo), `eenfout`
  (elke "1" een tel te laat). 19 × 6 = 114 gevallen.
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
node test/beatbench.test.mjs        # 37 checks, ~12 s; de meeste falen op 7debab6
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

Samenvatting (`bench.mjs --vergelijk`, vóór = 7debab6):

| | vóór | na |
|---|---|---|
| **tellen-route, 114 gevallen: vals zeker** | **1** | **0** |
| dekking | 93% | 98% |
| op het DJ-tempo | 50% | 98% |
| > 0,1 tel naast | 4% | 0% |
| de "1" goed (waar te meten) | 80% | 83% |
| oude analyse, 19 nummers: op het DJ-tempo | 84% | 91% |
| oude analyse: zeker-en-naast, live band | 27,5 s van 94,8 s zeker | 5,75 s van 23,3 s |
| oude analyse: zeker-en-naast, band op 154 | 18,5 s van 112 s | 16,5 s van 112 s |
| oude analyse: klik van 8 minuten op 128 | 128,024 bpm, eerste tel 37 ms te laat | 128,0001 bpm, 7 ms vroeg |
| rekentijd gridUitTellen + meetGrid, een uur (7428 tellen) | 64 ms | 72 ms |

Per geval (een selectie; de hele tabel komt uit het commando hierboven, 62 van de 133 rijen anders):

| geval | vóór | na | waardoor |
|---|---|---|---|
| jungle-172 / bt | 86 bpm zeker, DJ-tempo 0% | 172, 100% | DJ-tempo |
| halftime-140 / bt, oud | 70 / 70 | 140 / 140 | DJ-tempo (beide routes) |
| indie-154 (Ciel) / bt | 77, 0% | 154, 100% | DJ-tempo |
| house-124 / half, dubbel | 62, 248 | 124, 124 | DJ-tempo + meten als het netwerk fijner telt |
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
| DJ-tempo 88–180: per stuk een macht van twee, dicht bij het tempo van het nummer; ½ alleen met downbeats (of > 300); wals niet ×2 | `dansFactor`, `dansOctaven`, `DANS_MIN/MAX` in tellen.js; ook in `maakGridHier` (alleen ×2) | beatbench: 7 DJ-tempo-checks, 4 rekenchecks |
| tellen tot 500 bpm | `MIN_L` in tellen.js | beatbench: 3 × dubbel |
| beginperiode op het rooster, een losse begintel begint niets | `beginPeriode`, `besteRooster` | beatbench: "geen stuk op een verzonnen tempo" |
| staart van een stuk met een ander tempo eraf | `staartKnip` | beatbench: mix 124 → 131, grens < 1 s |
| meten als het netwerk fijner telt dan het grid | `fijner`, `vouwHalf` in meetGrid en afwijkingBij | beatbench: 248 tegen 124 raak, sprong van een halve tel niet |
| oude analyse: tempo bijstellen op de pieken (fase in het midden houden), anders 'drift' | `blokDrift`, `kantelOpPieken` in detect.js, in `maakGridHier` | beatbench: klik 8 min, live band, 3 rekenchecks; gridauto blijft groen (zijn klik: nu 128,0001 in plaats van 128,024) |
| kaart-VERSIE 1 → 2 | tellen.js | tellen.test: versie = VERSIE |
| test 32 bpm: was 64, nu 128 (het dansbereik) | tellen.test | bewuste gedragswijziging |

**VERSIE 2, wat dat in Clay's library doet**: bij de eerste start rekent de server elk automatisch grid
uit de tellen opnieuw (uit tellen.json, geen GPU, ~70 ms per uur muziek). Grids op slot of met de
hand bewerkt blijven staan (`wilTellenGrid`). Nummers die Beat This! op 70–87 hoorde krijgen het
dubbele tempo; hun sectiekaart wordt bij het volgende laden opnieuw berekend (het grid veranderde).
Grids van de oude analyse met `bron: 'auto'` veranderen pas na ↻ in de library (zoals altijd).

## 5. Wat niet gedaan is, en waarom

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
| 6. Meer nummers in de benchmark | een DJ-mix van een uur (vier nummers met overgangen), een live opname met applaus, een nummer met een tempowissel van 3:2 | per nummer een uur | dekt de grenzen die nu alleen in de tekst staan (golvend tempo, 3:2) |

## 8. Vragen voor Clay

1. **Het dansbereik 88–180**: een nummer dat Beat This! op 70–87 hoort, krijgt nu het dubbele tempo
   (Ciel 77 → 154, zoals jij tikt). Reggae of downtempo die je echt op 75 telt, krijgt dan ook 150.
   Is dat goed, of draai je genoeg van die muziek dat het per krat moet (optie 4)?
2. Mag de server bij de eerste start alle automatische grids uit de tellen opnieuw rekenen (VERSIE 2)?
   Je eigen grids (op slot of met de hand) blijven staan. Zo niet: VERSIE op 1 laten, dan geldt het
   alleen voor nieuwe nummers en na ↻.
3. Wil je één keer het echte Beat This! op de benchmark draaien (drie commando's, §1)? Dan weten we
   of de nep-tellen kloppen.

## 9. Tests

`node test/beatbench.test.mjs`: 37 checks groen (op 7debab6: 19 rood, daarna stopt hij op een
functie die er nog niet was). `tellen`, `tellen-server`, `detect`, `gridauto`, `gridzeker`,
`beatgrid`, `analyze`: groen. `node test/alles.mjs`: zie de samenvatting van de opdracht.
