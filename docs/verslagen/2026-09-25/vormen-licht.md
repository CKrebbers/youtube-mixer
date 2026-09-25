# Vormen 16:9, spoor 2: de tien lichte systemen (systemen.js)

Branch `spoor2/vormen-licht` (vanaf `spoor/vormen-basis`, 3ca17ea).
Commit: `e5518eb De tien lichte vormen tekenen echt 16:9`.
Bestanden: `src/vormen/systemen.js`, `test/vormen.test.mjs`. Verder niets
aangeraakt. In hulp.js, laag.js en lagen.js miste ik niets.

## Uitkomst in het kort

- `systemen.js` noemt `g.S` niet meer en gebruikt geen `rooster(g, getal)`
  meer. De test controleert dat.
- De plaat (`vormen-plaat.mjs`, zaad 7, 180 stappen, poorten 8871/9471):
  **vóór 10 × "vierkant"** (midden-x 0,27–0,29), **na 10 × "16:9"**
  (midden-x 0,47–0,50). Alle PNG's heb ik zelf bekeken.
- Twee soorten:
  - **velden** (bd, fl, ec, cc) vullen het hele doek van rand tot rand;
  - **vormen rond een middelpunt** (lz, hg, sf, km, dp, fy) staan heel in het
    midden, geschaald op de korte zijde (recept 1 uit docs/VORMEN-16x9.md).
    **Die zes vullen de breedte NIET.** Links en rechts blijft ruimte over, en
    zonder ontwerpwijziging kan dat niet anders (zie "Wat anders oogt").
- Niets is uitgerekt: cirkels blijven rond. De test meet breedte/hoogte:
  sf 1,02, km 1,00, fy 1,00.
- Rekentijd: alleen bd en fl doen meer werk, ×1,78 tekenaanroepen = de
  verhouding van de oppervlakken (16/9). bd rekent daarbij niet meer
  (buren in vakken), fl rekent ×1,78. De andere acht zijn gelijk.
- Zaad-determinisme: blijft. Geen Math.random, geen performance.now en geen
  DOM; de bestaande check is groen.
- `g.kwaliteit`: de lichte systemen negeerden hem al en doen dat nog steeds
  (zie "Open").

## Per systeem

Tekenaanroepen per stap zijn deterministisch (zaad 7, na 60 stappen). ms =
mediaan per stap in Node met een nep-canvas: rekenen zonder echt tekenen. Oud
en nieuw zijn om en om gemeten in één proces (bench2.mjs), met de beste van 5
rondes. Headless = ms per stap uit de plaat (swiftshader, alleen de JS-kant).
De machine had load 8–13, dus de ms schommelen; de tekenaanroepen niet.

| id | wat ik deed | tekenaanroepen oud → nieuw | Node ms oud → nieuw | headless ms voor → na |
|---|---|---|---|---|
| lz Lorenz | `midden(g)`: sc op `kort`, sx = cx + X·sc, sy = cy − (z − zc)·sc | 113 → 113 | 0,008 → 0,008 | 0,06 → 0,02 |
| hg Harmonograaf | R = kort · 0,42 rond cx, cy | 6019 → 6019 | 1,14 → 1,17 | 0,87 → 0,47 |
| bd Boids | wereld van g.W/g.D × g.H/g.D = 568,9 × 320 eenheden, **302 boids** (170 × 16/9, zelfde dichtheid), rondlopen per as; buren zoeken in vakken ≥ zichtafstand (zie onder) | 681 → 1209 (×1,78) | 0,24 → 0,26 (×1,09) | 0,46 → 0,26 |
| fl Stromingsveld | zelfde wereld, **3911 deeltjes** (2200 × 16/9), opnieuw plaatsen per as; veldschaal en snelheid in eenheden, dus ongewijzigd | 4409 → 7831 (×1,78) | 0,74 → 1,40 (×1,89; herhaald ×1,49–2,16, verwacht ×1,78) | 1,23 → 1,26 |
| sf Superformule | sc = kort · 0,44 · … rond cx, cy | 7603 → 7603 | 1,38 → 1,37 | 1,98 → 1,54 |
| ec Elementaire automaat | `rooster(g, cellen(g, 160))` = **213 × 120** (was 160 × 160); rij van W over de breedte, H rijen die schuiven | 1 → 1 | 0,008 → 0,009 | 0,10 → 0,12 |
| cc Cyclische automaat | `rooster(g, cellen(g, 128))` = **171 × 96** (was 128²), arrays NX·NY, rondlopen per as | 1 → 1 | 0,33 → 0,29 | 0,69 → 0,72 |
| km Kuramoto | ringen r = kort·(0,07 + 0,38·i/(n−1)) rond cx, cy | 363 → 363 | 0,040 → 0,040 | 0,10 → 0,11 |
| dp Dubbele slinger | ophangpunt (cx, cy − 0,08·kort) = 0,42 van de hoogte zoals vroeger, l = kort·0,22 | 271 → 271 | 0,057 → 0,057 | 0,11 → 0,11 |
| fy Fyllotaxis | c = kort·0,46/√n rond cx, cy | 4198 → 4198 | 0,31 → 0,31 | 0,64 → 0,68 |

Headless zegt bij hg en sf "sneller". Dat is ruis van de drukke machine: de
code en het aantal aanroepen zijn gelijk.

### Boids: buren in vakken

Met 302 boids zou alle paren aflopen ×3,16 kosten (n²), ruim boven 16/9.
Daarom een telsortering in vakken van minstens de zichtafstand (kolommen =
⌊568,9 / zicht⌋, rijen = ⌊320 / zicht⌋). Alle buren zitten dan in de 3 × 3
vakken rond een boid, en een rij van drie vakken ligt aaneen in `orde`.

Hoe het vroeger werkte blijft gelijk:
- de buitenlus gaat nog op indexvolgorde en werkt de snelheden ter plekke bij
  (de boids na i zien de nieuwe snelheid van j < i);
- er wordt NIET over de rand heen gekeken.

Alleen de volgorde van optellen binnen één boid verschilt. De test vergelijkt
120 stappen lang met alle paren aflopen, bij zichtafstand 10, 23,5, 38 en 90:
grootste verschil in snelheid **0** (bit-gelijk). De buffers staan in `init`,
groot genoeg voor zichtafstand 10; per stap wordt niets aangemaakt.

Karakter gemeten over 8 zaden, 60 s (boids-karakter.mjs):
- buren binnen de zichtafstand: oud 11,1–12,9, nieuw 11,3–13,3;
- polarisatie (alle boids één kant op): oud 0,72 / 0,95 / 0,99 na 5 / 10 / 15 s,
  nieuw 0,61 / 0,94 / 0,99.

In een bredere wereld duurt het in de eerste seconden iets langer voor alles
één kant op vliegt; daarna is het gelijk.

## Wat anders oogt dan vroeger (door het ontwerp)

1. **De zes vormen rond een middelpunt (lz, hg, sf, km, dp, fy) vullen de
   breedte niet.** Ze zijn even groot t.o.v. de hoogte als op het vierkant van
   360, heel in beeld, midden-x 0,49–0,50. Links en rechts staat zo'n 140 px
   niets.
   - Boven de video is dat geen balk: de achtergrond wordt in de shader
     afgetrokken, je ziet er de video. Alleen de laag zonder video toont een vorm
     midden op zwart.
   - Ten opzichte van 24 sep (vierkant bijgesneden tot de volle breedte) zijn ze
     9/16 zo groot, maar er valt niets meer weg.
   - Dit is dezelfde vraag die de basis-agent al aan Clay stelde.
   - Opties die de breedte WEL gebruiken, allemaal een ontwerpwijziging (niet
     gebouwd):
     - **hg**: de x-slinger 16/9 zo ver laten zwaaien. Vult de breedte op een
       natuurlijke manier (twee losse slingers), maar een cirkel bij a = b wordt
       een ellips.
     - **fy**: de spiraal door laten lopen tot in de hoeken ("ingezoomde
       zonnebloem", zonder rand). Met dezelfde zaadmaat is dat ×2,7
       tekenaanroepen; binnen 16/9 blijft het alleen met ~22% grotere zaden.
     - **lz**: laten rollen om de lange diagonaal in plaats van draaien om z.
       De vlinder blijft dan altijd breed (verhouding 1,4–3), maar beweegt anders.
     - **sf, km, dp**: niets natuurlijks. Het zou een rij vormen of meerdere
       ophangpunten worden, of weer bijsnijden.
2. **ec en cc: cellen t.o.v. de hoogte groter dan op het vierkant van 360, en
   25% kleiner dan op 24 sep.**
   - Standaard uit het recept: `cellen(g, n)` houdt het aantal cellen en dus de
     rekentijd gelijk. ec heeft 120 rijen over de hoogte (was 160), cc 96 (was 128).
   - Patronen zijn in cellen even groot. Op het scherm: ec 6 px per cel op
     1280 × 720 (24 sep: 8 px), cc 7,5 px (24 sep: 10 px).
   - ec schuift nog steeds 2 rijen per stap. Omdat er minder rijen over de
     hoogte gaan, loopt het beeld ~33% sneller over het scherm t.o.v. de hoogte
     (in schermpixels juist 25% trager dan op 24 sep).
   - Even groot als 24 sep kan met `cellen(g, 0,75·n)` en is dan goedkoper; niet
     gekozen, om bij het recept te blijven.
3. **bd en fl**: even dicht, even groot, even snel. Het linkerdeel van fl is
   letterlijk hetzelfde veld als vroeger (zelfde ruis in eenheden); rechts komt
   er veld bij. Er zijn nu 302 boids en 3911 deeltjes.
4. **dp**: kan bij beginhoek ~179° nog steeds ~7 px boven de rand uitzwaaien.
   Dat deed hij vroeger ook (reikwijdte 0,44 vanaf 0,42).

## Tests

- `nice -n 10 node test/vormen.test.mjs`: **groen** (meermaals). Nieuw blok
  "de lichte systemen (systemen.js) tekenen echt 16:9":
  - geen `g.S` en geen `rooster(g, getal)` in systemen.js (op de oude code
    slaat de check aan);
  - alle tien ingedeeld als veld of vorm;
  - velden tekenen van rand tot rand: x ≤ 2% en ≥ 98%, y idem, over 300 stappen
    met een nep-canvas dat het bereik van moveTo/lineTo/arc/drawImage bijhoudt;
  - vormen: midden van het bereik op 0,5 ± 0,03, heel in beeld, niet breder dan
    de korte zijde;
  - sf, km en fy: breedte/hoogte binnen 10%;
  - bd 302 en fl 3911, even dicht als op 320²;
  - ec 213 × 120 en cc 171 × 96, vierkant, evenveel cellen, geen `oud`;
  - vakken = alle paren (vier zichtafstanden, 120 stappen, ook boids aan de rand);
  - tekenaanroepen per stap ≤ 16/9 × het vierkant (tabel `VIERKANT`, gemeten
    op 3ca17ea);
  - elk licht systeem < 4 ms per stap (BUDGET_HOOFD). Het minimum van wandklok
    en processortijd, net als vormen-zwaar, met tot 3 pogingen.
- `werker.test.mjs` en `video.test.mjs`: groen.
- De hele suite heb ik NIET gedraaid (afspraak).
- Timing: nooit rood geweest. Onder load (8–13) kwam fl tot 3,66 ms en sf tot
  3,15 ms toen de nep-canvas nog per aanroep een closure maakte. Daarna heb ik
  een snellere teller en cpu-tijd gebruikt: fl 1,4–2,6 ms, sf 1,5–2,8 ms. Het
  budget is 4 ms: het kan onder zware load krap worden.

## Plaat

- Vóór en na: `scratchpad/licht/voor/` en `scratchpad/licht/na/`, elk met
  `plaat.png`, de PNG's en `plaat.json`.
- Lang (zaad 3, 1200 stappen = 20 s) voor bd, fl, sf, ec, cc en km:
  `scratchpad/licht/na-lang/`. 6 × "16:9".
  - fl, ec en cc vullen ook na 20 s alles.
  - bd is dan één grote zwerm (zoals vroeger) die op dat moment links zit
    (midden-x 0,30) en rondloopt. De Node-test ziet boids van rand tot rand
    over 300 stappen.
  - sf en km staan heel in het midden.
- LET OP: een run van 1200 stappen duurde headless minuten per systeem
  (swiftshader rastert de opgespaarde tekenopdrachten pas bij getImageData).
  De ms in de plaat meten alleen de JS-kant.

## Open / voor Clay of de controleur

- **Vormen rond het midden: breedte vullen of niet?** (zie hierboven). Mijn
  keuze: recept (heel, in het midden), omdat het de vorm en schaal intact laat en
  de rest doorzichtig is boven de video. De opties per systeem staan hierboven.
- **fl kost ×1,78** en schaalt niet met `g.kwaliteit`.
  - Headless is hij ~1,3 ms JS per stap, ver onder 4 ms.
  - Gaat hij op de M1 in echte Chrome toch over budget, dan zet het budget de
    kwaliteit omlaag, maar dat doet bij fl niets. Er volgt een noodrem die ook
    niets oplost.
  - Klein toe te voegen: alleen de eerste n·kwaliteit deeltjes bewegen en
    tekenen. Niet gebouwd (niet gevraagd).
- De tabel `VIERKANT` in de test is een momentopname van de oude code. Wie een
  licht systeem bewust zwaarder maakt, moet die tabel bijwerken.
- Niet getest: echte Chrome, de M1, de werker-modus met deze systemen (alleen
  hoofdthread headless en Node), de beamer.
