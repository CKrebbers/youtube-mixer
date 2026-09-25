# Spoor 2: vormen-meer naar echt 16:9 (ROADMAP 7)

## Stand

- **Branch:** `spoor2/vormen-meer`, afgetakt van `spoor/vormen-basis` (3ca17ea).
- **Commit:** `715d1f7` "Middelzware vormen (ch, jl, ls, dl, lg, wv, if) tekenen echt 16:9".
- **Gewijzigd:** alleen `src/vormen/systemen-meer.js` en `test/vormen-meer.test.mjs`.
- **Worktree:** staat na afloop op detached HEAD.
- **g.S:** `systemen-meer.js` gebruikt hem niet meer, en het verouderde `rooster(g, getal)` ook niet. De test controleert beide in de bron. Hij draait bovendien met een `g` ZONDER `S`: een systeem dat hem toch leest, rekent met NaN en valt op.
- **hulp.js / laag.js / lagen.js:** niets nodig gehad en niets aangeraakt. dl heeft een bezettingskaart die hoger is dan het beeld. Die regel ik lokaal (zie dl) en niet via `blit`.

## Tests

- `nice -n 10 node test/vormen-meer.test.mjs`: alles groen (load ~17).
  - Onder load 31 tot 78 faalden één keer de bestaande tijdchecks "jl/if: max < 16 ms per stap". Bij de volgende run waren ze weer groen. De basis-agent zag hetzelfde op main.
- `nice -n 10 node test/werker.test.mjs`: groen.
- Nieuw in `vormen-meer.test.mjs`:
  - **Opzet:** `maakLaag` bouwt g met `maten(LAAG_BREEDTE, LAAG_HOOGTE)` (640 × 360), zonder g.S.
  - **Nep-canvas:** onthoudt de laatste drawImage-aanroepen en de grenzen van alle moveTo/lineTo/arc-punten.
  - **Bron:** noemt `g.S` en `rooster(g, getal)` niet meer.
  - **ch, jl, dl, lg, wv:**
    - rooster nx × ny met vierkante cellen (nx/ny binnen 1% van 16/9);
    - niet meer cellen dan het oude n²;
    - blit over het hele doek (0, 0, 640, 360).
  - **ch:**
    - de plaat loopt van −0,388 tot 1,388, met het oude 0..1 in het midden;
    - er ligt zand in het linker- en rechtertiende (9,8% en 9,7%).
  - **jl:**
    - 240 × 135 = 180²: hetzelfde stuk complex vlak (9 eenheden²);
    - beeld in het linker- en rechtervijfde (62% en 64%).
  - **wv:**
    - de bronnen staan 27 oude eenheden van het midden (27,7, 27,3 en 26,1);
    - golven in het linker- en rechtervijfde.
  - **lg:** de scanlijn staat bij f = 0,95 op x = 608 van 640 en loopt van 0 tot 360. Het diagram komt tot in het rechtervijfde.
  - **dl:**
    - bodemlijn groeit links én rechts;
    - punt is volgroeid (straal > 0,45 × 201);
    - kaart 201 × 201, beeld rij 44 tot 157, het midden in beeld;
    - rond: uitgroei opzij en op/neer verhouden zich ≥ 0,7, en de figuur groeit boven en onder buiten beeld;
    - bij de bodemlijn is de kaart gelijk aan het beeld.
  - **if:**
    - vierkant rooster 320 × 320, geblit in `midden(g).vak` (140, 0, 360, 360);
    - de varen staat in het midden (zwaartepunt 0,55) en heel in beeld (rij 49 tot 309 van 320).
  - **ls:**
    - alle vijf vormen, met de hoek en iteraties die de keuzelijst zet, passen in 640 × 360, raken 88% van een zijde en staan in het midden;
    - de Koch-vlok is breder dan het oude vierkant;
    - de lijndikte ten opzichte van de vorm is exact 360/512 van die op het oude 512²-vierkant, voor alle vijf vormen.
  - Alle bestaande checks zijn groen gebleven:
    - zaad-determinisme;
    - geen Math.random, performance.now, DOM of Path2D;
    - kwaliteit 0,25 is goedkoper;
    - dl negeert de kwaliteit;
    - wv-tabellen geven 100% hetzelfde beeld.

## Voor en na (plaat)

- **Voor:** `scratchpad/meer/voor/` (plaat.png + per systeem). Alle 7 = "vierkant", midden-x 0,28 (lg 0,45).
- **Na:** `scratchpad/meer/ab-nieuw-2/` (eindcode) of `scratchpad/meer/na180/`. Alle 7 = "16:9":

| id | licht (voor → na) | rechts | midden-x |
|---|---|---|---|
| ch | 10,3 → 18,5% | 39,8% | 0,50 |
| jl | 54,1 → 77,9% | 38,6% | 0,50 |
| ls | 2,8 → 3,0% | 38,7% | 0,55 |
| dl | 5,0 → 13,1% | 33,9% | 0,50 |
| lg | 12,1 → 23,7% | 94,3% | 0,81 |
| wv | 54,1 → 95,9% | 40,8% | 0,50 |
| if | 9,6 → 9,6% | 5,2% | 0,52 |

- **Extra platen:**
  - jl op 800, 1600 en 2400 stappen (een hele draai van c): `t800/ t1600/ t2400/`;
  - dl op verschillende momenten: `e160/ e170/ e1618/`;
  - de eerste dl-poging (een X): `d170/ d1618/`;
  - kwaliteit 0,25: `q25_180/`;
  - dl-bodemlijn als rooster-PNG: `dl-bodem-23.png`.
- Alle PNG's heb ik zelf bekeken.

## Rekentijd

### Node, alleen rekenwerk

Nep-canvas, oud (S = 512) en nieuw om en om, beste van 8–9 rondes:

| systeem | oud | nieuw | factor |
|---|---|---|---|
| ch | 3,23 | 2,92 | ×0,90 |
| jl | 3,10 | 3,34 | ×1,08 |
| jl, hele draai van c | 3,53 | 3,82 | ×1,08 |
| ls | 0,63 | 0,59 | ×0,95 |
| dl | 0,41 | 0,46 | ×1,11 (ruis, zie dl) |
| lg | 0,021 | 0,021 | ×1,00 |
| wv met tabellen | 0,27 | 0,26 | ×0,97 |
| wv draaiend | 3,46 | 3,79 | ×1,09 |
| wv draaiend, 9 bronnen | 9,76 | 9,62 | ×0,99 |
| if | 1,57 | 1,59 | ×1,02 |
| ch q0,25 | 0,92 | 0,90 | |
| jl q0,25 | 0,55 | 0,56 | |
| if q0,25 | 0,85–1,96 | 0,97–1,78 | ruis |

Alle waarden in ms per stap. De machine had load 9 tot 17. Zelfde meting eerder onder load 15: alle factoren tussen 0,92 en 1,09.

### Headless browser, echte canvas

`vormen-plaat.mjs`, oud en nieuw om en om, gemiddelde van 2 rondes:

| systeem | oud | nieuw |
|---|---|---|
| ch | 2,16 | 2,10 |
| jl | 2,56 | 2,69 |
| ls | 0,36 | 0,34 |
| dl | 1,97 | 1,94 |
| lg | 0,71 | 0,74 |
| wv | 0,66 | 0,70 |
| if | 3,87 | 3,73 |

In ms per stap. Dat is inclusief het opschalen naar 640 × 360 in plaats van 360 × 360.

### Conclusie

- De rekentijd is gelijk gebleven. Alleen jl is echt ~8% duurder: het beeld van 4 × 2,25 bevat meer pixels vlak bij de verzameling. De grens was ×1,78.
- Overal evenveel of minder cellen dan het oude n². Het werk per deeltje is onveranderd: ch n korrels, if 60 000 punten, dl 50 000 zwerfstappen.

## Per systeem

### ch · Chladni-figuren

- **Wat ik deed:**
  - `rooster(g, cellen(g, 256))` = 341 × 192 (65 472 cellen, was 65 536).
  - De plaat is 16:9 geworden: y loopt van 0 tot 1, x over A = nx/ny = 1,776 plaatbreedtes, van x0 = −0,388 tot 1,388. Het oude vierkant 0..1 ligt in het midden.
  - Dezelfde formule, dus dezelfde golflengtes. Het veld loopt door naar links en rechts, met terugkaatsen op x0 en x0 + A.
  - Korrels worden in de oude volgorde getrokken (x, dan y).
- **Rekentijd:** zelfde aantal korrels en cellen, dus even helder per cel en even duur.
- **Wat anders oogt:**
  - Het oude patroon staat heel in het midden. Links en rechts lopen de lijnen door; bij n = 3 en m = 5 zijn dat extra ovalen.
  - Per plaatoppervlak liggen er 0,56× zoveel korrels, maar per cel evenveel.
  - Ten opzichte van de hoogte zijn de cellen grover: 1/192 van de hoogte, was 1/256.

### jl · Julia-verzameling

- **Wat ik deed:**
  - `cellen(g, 180)` = 240 × 135, precies 180².
  - `sc = 3 / (sqrt(nx·ny) · zoom)`: een cel is in het complexe vlak even groot als vroeger, en het beeld beslaat evenveel complex vlak (9 eenheden²). Nu is dat 4 × 2,25 in plaats van 3 × 3.
  - `vulBlok` werkt nu met nx × ny.
- **Waarom niet de hele verzameling heel in de hoogte** (5,33 × 3): de kleurformule van het origineel maakt alles met |z| > ~1,8 zwart (NaN → L[0]). Dan zouden er links en rechts zwarte banden van ~30% staan. Met 4 × 2,25 blijft er alleen een smalle donkere rand van ~5% aan de uiterste zijkanten, en alleen bij sommige standen van c.
- **Wat anders oogt:**
  - Een hoge verzameling valt boven en onder iets weg. Uitzoomen kan met de zoomknop, die tot 0,6 gaat.
  - Gezien over een hele draai van c: stof, dendriet en basilica, en de breedte is steeds gevuld.
  - De uitgang `binnen` telt pixels die L[0] zijn. In het origineel zijn dat binnenpunten én vroeg ontsnapte punten. Met meer zijkant telt hij iets meer "buiten-zwart" mee. `auto()` normaliseert, dus het effect is klein.

### ls · L-systeem

- **Wat ik deed:**
  - De figuur past in het hele 16:9-vak: `kk = 0,88 · min(W/b, H/h)`, in het midden.
  - Alle vijf vormen zijn smaller dan 16:9, dus ze worden 88% van de hoogte, net als op het vierkant.
  - De Koch-vlok is breder dan hoog en wordt daardoor 15% groter (366 × 317 px).
- **Lijndikte (bugje):** de formule `clamp(kk · 0,35) · D` telde de doekmaat twee keer, want kk en D schalen allebei mee. Op 360 px werden de lijnen daardoor 30% dunner ten opzichte van de vorm.
  - Nu: `clamp(kk / D · 0,56) · D / 1,4`.
  - Op het oude vierkant (D = 1,6) is dat identiek aan het origineel.
  - Op 640 × 360 is de lijndikte ten opzichte van de vorm exact gelijk; de test bewijst het.
- **Wat anders oogt:** één staande figuur in het midden, heel. Links en rechts is achtergrond: plant 244 px, struik 207 px, draak 261 px, Sierpiński 274 px en Koch 366 px breed, van de 640.

### dl · Diffusie-aggregatie

- **Beeld:**
  - `cellen(g, 150)` = 201 × 113: precies de celmaat van het beeld van 24 sep (6,4 schermpixels per cel).
  - Zelfde korrel en, bij de ongewijzigde 50 000 zwerfstappen, dezelfde groeisnelheid op het scherm.
  - Eindstraal 0,45 × de BREEDTE = 90 cellen, net als vroeger.
- **Punt:**
  - dl rekent op een bezettingskaart van 201 × 201 (40 401 cellen, was 40 000) en toont de middelste 113 rijen (vanaf rij 44). Pixels schrijft hij alleen binnen beeld.
  - Zo is de figuur rond en steekt hij boven en onder buiten beeld, precies zoals het bijgesneden beeld van 24 sep. Hij vult de breedte.
  - Een cyclus is 28 stappen tot volgroeid, gevolgd door 2 s pauze. Oud was dat ook 28 stappen (gemiddeld over 6 zaden), met 3252 tegen 3220 cellen.
- **Eerste poging (verworpen):** de kaart even hoog als het beeld.
  - Zwervers die boven of onder buiten de kaart kwamen stierven. De armen naar boven en onder kregen dan niets meer, en er groeide een X naar de hoeken.
  - Terugkaatsen en alleen binnen de band starten hielp niet: nog steeds een X.
  - Die poging is niet gecommit. Platen: `d170/`, `d1618/`.
- **Bodemlijn:**
  - Kaart = beeld: 201 breed, groeit tot 8% onder de bovenkant, over de hele breedte.
  - Een cyclus is nu 24 stappen, was 56. Dat komt doordat het front 104 rijen moet klimmen in plaats van 183. Op het scherm is het tempo gelijk aan 24 sep, want de cel is even groot.
- **Kwaliteit:** wordt bewust genegeerd, en de test controleert dat.
- **Wat anders oogt:**
  - Ten opzichte van het hele oude vierkant is de figuur groter en bijgesneden.
  - Ten opzichte van 24 sep is hij hetzelfde, maar scherp: 2× opgeschaald in plaats van 2,5× gerekt.
  - Een volgroeide figuur beslaat ~65–90% van de breedte. De langste arm bepaalt het einde, soms buiten beeld.
- **Wijkt af van het recept:** "vorm heel in beeld" geldt hier niet. Dat is een keuze om de breedte te vullen.

### lg · Logistieke afbeelding

- **Wat ik deed:**
  - `cellen(g, 320)` = 427 × 240.
  - Het is een grafiek: r loopt over de hele breedte (427 kolommen, was 320, dus scherper in r), x over de hoogte (240 rijen).
  - De scanlijn staat op f · W en loopt van 0 tot H. Stippen 2,6 · D, lijn D.
- **Wat anders oogt:**
  - Het diagram is breder. Dat is geen uitrekken van een vorm (r en x zijn verschillende grootheden) en de stippen blijven rond.
  - Per kolom blijven het 260 punten, maar over 240 in plaats van 320 rijen. Een chaotisch stuk is daardoor iets voller of lichter: log(1 + 1,33) tegen log(2).
  - Links is het diagram van nature één dunne lijn (r < 3), met zwart erboven en eronder.

### wv · Golfinterferentie

- **Wat ik deed:**
  - `cellen(g, 150)` = 201 × 113.
  - Golflengte en bronafstand blijven in de oude eenheid (korte zijde / 150): de afstanden in `s.d` worden omgerekend met 150/ny. Daardoor betekent de golflengteknop "3..40" hetzelfde en staat het oude beeld in het midden.
  - Bronnen op straal rad · ny.
- **Rekentijd:** gelijk, want evenveel cellen.
- **Wat anders oogt:**
  - Het oude patroon staat heel in het midden en de golven lopen door tot de randen.
  - Een cel is 1/113 van de hoogte, was 1/150. Bij de kleinste golflengte (3) is dat 2,25 cellen per golf, dus iets meer aliasing dan vroeger (3 cellen per golf). Bij de standaard (12) zijn het er 9.

### if · IFS-varen

- **Wat ik deed:**
  - Bewust een VIERKANT rooster: `rooster(g, { nx: 320, ny: 320 })`, geblit in `midden(g).vak` (het recept voor "een rooster dat bewust vierkant blijft").
  - `clear(g)` in init, zodat de randen naast het vak ook zonder laag.js op de achtergrond staan.
- **Rekentijd:** zelfde cellen, punten en resolutie als vroeger, dus gelijk.
- **Wat anders oogt:** de varen staat heel, even groot ten opzichte van de hoogte, in het midden. Links en rechts ~35% achtergrond aan elke kant.
- **Waarom niet over de hele breedte:** een staande varen in een breed rooster zou alleen lege cellen erbij rekenen (zelfde beeld, duurder, of grover bij hetzelfde aantal cellen).

## Wat NIET aan de eis "hele breedte, geen zwarte strook" voldoet

- **ls en if:** één staande figuur in het midden, met achtergrond links en rechts. Het is geen strook die het systeem laat liggen: het coördinatenstelsel beslaat het hele doek en de figuur staat in het midden van het 16:9-vak.
- **24 sep:** toen vulden ze de breedte ook niet: de plant ~60%, de varen ~40%, en beide boven en onder afgesneden.
- **Wat de breedte wél zou vullen:** een rij planten of varens (een nieuwe compositie, en voor de varen dubbel werk), of flink bijsnijden (voet en top weg). Allebei vond ik geen omzetting meer maar een nieuwe keuze. **Vraag voor Clay:**
  - houden zo (heel, in het midden),
  - of een rij/bosje (per vorm kiezen),
  - of groter en bijgesneden zoals op 24 sep?
- **dl punt:** vult de breedte, maar een volgroeide figuur laat afhankelijk van het zaad ~5–15% aan de zijkanten leeg.
- **jl:** bij sommige standen van c een smalle donkere rand van ~5% helemaal links en rechts. Dat is de halo van het origineel; zie jl.

## Voor docs/VORMEN-16x9.md

Die mag ik niet wijzigen; hier een voorstel. Bewuste uitzonderingen op "vorm heel in beeld" en "rooster nx × ny":

- **if:** vierkant 320² in `midden(g).vak`.
- **dl-punt:** een bezettingskaart van nx × nx, met het beeld als middelste band van nx × ny. De figuur wordt boven en onder bijgesneden.
- **jl:** hetzelfde complexe oppervlak als het oude 3 × 3, dus boven en onder licht bijgesneden.

## Niet getest

- Niets in echte Chrome, niets op de APC, geen tabblad geopend. Alleen Node en de headless shell via `vormen-plaat.mjs` (poorten 8873/9473).
- De werker-modus met deze systemen: alleen `werker.test.mjs`, geen lange sessie in een Worker.
- Hoe het er op de beamer uitziet, onder meer de dunnere 2×-opschaling en de wv-aliasing bij golflengte 3.
- Niet de hele suite gedraaid (afspraak): `vormen.test.mjs` loopt alle 26 systemen via VormLaag en zou deze ook moeten dekken, maar dat heb ik niet gedraaid.

## Hulpbestanden (scratchpad/meer/)

- `bank.mjs`: oud tegen nieuw, ms per stap in Node.
- `browser-ab.sh`: oud tegen nieuw in de headless browser. Zet het oude bestand tijdelijk terug en herstelt het nieuwe; herstel gecontroleerd.
- `dlcyclus.mjs`: dl-cycluslengte, oud tegen nieuw.
- `rooster-png.mjs`: pixelrooster met eigen knoppen naar PNG.
- `platen.sh`: vormen-plaat op de eigen poorten.
- `oud/`: het oude `systemen-meer.js` om te vergelijken.
