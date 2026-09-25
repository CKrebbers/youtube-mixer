# Vormen 16:9 — de zware systemen (gs, cl, ln, ph, sp)

Branch `spoor2/vormen-zwaar` (vanaf `spoor/vormen-basis`), één commit:
`8b6b1e9 Zware vormen op 16:9: gs, ln, ph, cl en sp vullen het hele doek zonder g.S`.
Gewijzigd: alleen `src/vormen/systemen-zwaar.js` en `test/vormen-zwaar.test.mjs`.
Aan hulp.js, laag.js en lagen.js is niets veranderd en ik miste er niets in; één
kleine hulp (`oneven`) staat lokaal in systemen-zwaar.js. Nieuw export:
`ROOSTER = { gs: 128, ln: 88, ph: 160, cl: 320, sp: 121 }` (de maat per systeem,
de test leest hem).

`g.S` komt in systemen-zwaar.js niet meer voor (de test controleert `g.S` en
`{ S } = g`). Het verouderde `rooster(g, getal)` ook niet meer.

## Per systeem

### gs — Reactie-diffusie
- Rooster `cellen(g, 128, 2)` = **170 × 96** (16 320 cellen, oud 128² = 16 384),
  halve maat **85 × 48**. Cellen vierkant (0,4% verschil), blit over het hele doek.
- De 9-punts Laplace rekent in cellen; de cellen zijn vierkant, dus de diffusie
  klopt zoals vroeger, op beide assen. Op de halve maat blijft `ds = 0,25`
  (nu gekozen op `c === s.vol` i.p.v. `n === 128`).
- `omlaag`/`omhoog` zijn per as (nx, ny); zaaien, pointer en rondlopen per as.
  Straal van een zaadje schaalt op `ny / vol.ny`.
- Uitgang `activiteit` normaliseert op het aantal cellen van het volle rooster
  (was de constante 16384).
- Oogt: zelfde labyrint/koraal over de hele breedte. Vlekken zijn t.o.v. de
  hoogte ~33% groter dan op het oude vierkant, t.o.v. het bijgesneden beeld van
  24 sep ~25% kleiner (de standaard van VORMEN-16x9.md: zelfde rekentijd).
- Halve maat getest: "groeit even hard" 62,0% tegen 65,4% bedekt na 150 stappen.

### ln — Lenia
- Rooster `cellen(g, 88, 2)` = **118 × 66** (7 788 cellen, oud 7 744), halve maat **59 × 33**.
- Kernel in cellen, cellen vierkant → klopt. De rand om het rooster heet nu
  `r0 = ceil(R)` met aparte `Px`/`Py`.
- **Verbetering**: de kernel op de halve maat is nu precies `R / 2`, ook bij een
  oneven R (7 → 3,5; vroeger `Math.round`, dus 4). De test meet de gewogen
  kernelstraal: 3,77 → 1,87, 5,38 → 2,69, 7,00 → 3,50 cel (precies de helft).
  Voor de standaard R = 10 verandert er niets.
- Massagrenzen en uitgangen op de schaal van het volle rooster (was de
  constante 7744); `o.x`/`o.y` per as.
- Oogt: dezelfde wormen/ringen, over de hele breedte, ~33% groter t.o.v. de hoogte.
- Bekend, NIET nieuw: op kwaliteit 0,25 (R = 5 op het grove rooster) wordt
  Lenia een veld van kleine rommelige vlekjes in plaats van wormen. Het oude
  vierkant deed precies hetzelfde (plaat `voor-q25` tegen `na2-q25`).

### ph — Physarum (deeltjes)
- Keuze: **schaal en snelheid t.o.v. de hoogte zoals op het oude vierkant**.
  Een cel is `g.H / 160`: spoorveld **284 × 160**. Een agent loopt één cel per
  stap en de sensorafstand staat in cellen, dus netwerk, dikte van de strengen
  en loopsnelheid zijn t.o.v. de hoogte gelijk aan het oude vierkant.
- **Evenveel agents per cel**: 5000 × 284/160 = **8875** agents (was 5000),
  dan zijn de sporen even fel en even dik. `AGENTS: 5000` betekent nu "per 160²".
- Rekentijd: × 1,69 (A/B hieronder), binnen de verhouding van de oppervlaktes
  (16/9 = 1,78). Dat is precies waar die grens voor bedoeld leek.
- Start: schijf rond het midden, straal 0,32 × de korte zijde (51 cellen,
  zoals vroeger 0,32 × 160), agents naar binnen gericht. Rondlopen per as.
  `o.midden` meet rond (nx/2, ny/2).
- Waarom niet `cellen(g, 160)` (213 × 120, zelfde rekentijd): dan zou alles
  33% groter en sneller zijn t.o.v. de hoogte (en 25% kleiner/trager t.o.v.
  24 sep). De opdracht vroeg bij deeltjes uitdrukkelijk schaal en snelheid.
- Oogt: na 3 s een gloeiende klodder in het midden (zoals vroeger), na 10–30 s
  gebogen strengen die om het doek heen lopen, over de hele breedte.
- **Let op, geen fout van de omzetting**: met de standaardknoppen trekt
  Physarum op den duur samen tot één of twee banden. Oud vierkant na 60 s: één
  rechte band, 8,6% licht. Op 16:9 kan zo'n band ook verticaal lopen (de korte
  ronde, 160 cellen), en dan is het grootste deel van het beeld donker (zaad 11:
  na 10 s een verticale band). Dat is de fysica van dit systeem met deze
  knoppen; ik heb de beginstand (schijf, ellips, overal) en klassieke
  netwerkknoppen (sa 22, ra 45, dec 0,95) gemeten: ze eindigen allemaal in
  banden. Op de plaat (zaad 7, 180 stappen) is ph "16:9", midden-x 0,53; op
  kwaliteit 0,25 staat de streng toevallig links van x = 1,05 H en zegt de plaat
  "vierkant" (midden-x 0,46). Het rooster beslaat wel het hele doek (getest).

### cl — Vreemde attractor (deeltjes)
- De baan is begrensd: |x|, |y| ≤ R, en `sc = 0,47 N / R`, dus alle punten
  vallen binnen 94% van het histogram. Daarom **bewust een vierkant histogram
  van 320²** (`rooster(g, { nx: 320, ny: 320 })`) in `midden(g).vak`
  (140, 0, 360 × 360): recept 1 van VORMEN-16x9.md, schaal op de korte zijde.
- Rekentijd gelijk (× 1,02), vorm en grootte t.o.v. de hoogte gelijk aan het
  oude vierkant, drift en snelheid ongewijzigd. De test controleert dat de
  buitenste 2% van het histogram leeg blijft (heel in beeld) en de vorm 78% van
  de hoogte beslaat.
- Oogt: dezelfde attractor, gecentreerd, met ~140 px achtergrond links en
  rechts (geen harde rand: L[0] is de achtergrondkleur). Dat is geen lege
  strook van een rooster dat ophoudt maar ruimte om een begrensde vorm.
- **Keuze voor Clay (niet gebouwd)**: Clifford is breder dan hoog als |c| > |d|
  (x ≤ 1 + |c|, y ≤ 1 + |d|). Met een histogram over het hele doek en
  `sc = min(0,47·Nx/(1+|c|), 0,47·Ny/(1+|d|))` wordt een brede attractor tot
  ~18% groter (standaardknoppen), nog steeds heel en niet uitgerekt. Kost de
  kleurronde × 1,78. Zelfde vraag als de basis-agent al voor alle vormen rond
  een middelpunt stelde.

### sp — Zandhoop
- Rooster **161 × 91** (`cellen(g, 121)` = 162 × 91, dan naar oneven):
  - oneven → een exact midden → een symmetrische mandala (test: spiegel-
    symmetrisch links-rechts en boven-onder waar hij bijloopt; ook "Vier punten"
    spiegel- en "Diagonaal" puntsymmetrisch);
  - cellen van 3,98 × 3,96 px: de scherpe blokken (blit zonder smoothing) zijn
    bijna allemaal 4 px breed (bij 171 × 97 afwisselend 3 en 4 px);
  - 14 651 cellen, minder dan het oude 129² = 16 641.
- **Gedragswijziging "vol"**: het origineel stopte als de hoop rij 1 of kolom 1
  raakte. Op 16:9 is dat bij de helft van de breedte en bleef het een cirkel in
  het midden met zwart links en rechts. Nu is het "vol" als de hoop de ZIJKANT
  raakt (kolom 1 of nx − 2); boven en onder vallen korrels van de rand, zoals
  aan elke rand van een zandhoop. Daarmee vult hij de breedte (massa 0,71 bij
  vol, het oude vierkant 0,69). Pauze van 2,5 s en opnieuw beginnen zoals altijd.
- Omvallen blijft begrensd op `SP_MAX_OMVAL × kwaliteit` (150 000); abels
  getest tegen het origineel met de onbegrensde lus, nu op 161 × 91.
- Tijd tot vol (gesimuleerd, midden, gpf 600, grens 150 000): oud 129² 2,1 s;
  nieuw 161 × 91 **2,8 s**; 171 × 97 (cellen(g, 129)) 3,4 s; de oude celmaat
  over de hele breedte (229 × 129) 10,3 s. Daarom de grovere 161 × 91.
  "Vier punten" 1,1 s, "Diagonaal" 0,9 s.
- Oogt: bij vol een brede hoop, boven en onder afgekapt, de zijkanten rond.
  Zoals vroeger is het beeld op het moment van "vol" midden in een lawine
  (grens per stap), dus niet de strakke eindmandala; op kwaliteit 0,25 zie je
  hem groeien als nette symmetrische achthoek.
- Rekentijd per stap: dezelfde bovengrens (p99 6,7 → 6,8 ms, de grens van
  150 000 bepaalt hem). Gemiddeld hoger omdat de groei 2,8 s duurt tegen 2,1 s
  (bij dezelfde pauze van 2,5 s): over een hele cyclus ~× 1,15.

## ms per stap

A/B in één proces, om de beurt oud (basis-branch, vierkant) en nieuw,
nep-canvas 640 × 360, 5 rondes × 200 stappen na 40 opwarmstappen, mediaan;
per stap min(wand, cpu). Belasting ~8–13.

| systeem | kwaliteit | oud gem / p99 | nieuw gem / p99 | × |
|---|---|---|---|---|
| gs | 1 | 3,84 / 7,44 | 3,28 / 6,17 | 0,85 |
| gs | 0,25 | 0,73 / 0,94 | 0,71 / 0,76 | 0,97 |
| cl | 1 | 5,18 / 8,49 | 5,29 / 7,79 | 1,02 |
| cl | 0,25 | 3,81 / 5,49 | 4,02 / 5,76 | 1,05 |
| ln | 1 | 7,98 / 9,63 | 7,98 / 9,59 | 1,00 |
| ln | 0,25 | 0,68 / 0,87 | 0,68 / 0,87 | 0,99 |
| ph | 1 | 2,84 / 3,53 | 4,80 / 5,75 | 1,69 |
| ph | 0,25 | 1,24 / 1,63 | 1,97 / 2,60 | 1,59 |
| sp | 1 | 2,47 / 6,67 | 3,63 / 6,80 | 1,47* |
| sp | 0,25 | 1,51 / 2,24 | 1,56 / 2,27 | 1,04 |

\* sp: stappen 40–240 vallen bij nieuw vaker in de groeifase (grens 150 000)
en minder in de pauze; de bovengrens per stap is gelijk.

Test `vormen-zwaar.test.mjs` (eigen meting, max over de beste van drie
pogingen, belasting 13–15): gs max 7,4–9,1 ms, cl 8,6–9,5, ln 6,6–9,7,
ph 3,2–6,0, sp 9,1–9,8. Alle < 16 ms, en kwaliteit 0,25 overal goedkoper.
Basisrun vóór de omzetting: gs 7,3, cl 8,8, ln 8,2, ph 3,1, sp 6,8 ms max.

Plaat (headless, swiftshader, drukke machine; ruis, onderling vergelijken):
voor gs 5,6 · cl 6,9 · ln 7,6 · ph 2,9 · sp 4,1 ms; na gs 7,2 · cl 8,8 ·
ln 8,7 · ph 5,0 · sp 6,2 ms (cl rekent aantoonbaar evenveel: ook de
onveranderde delen liepen trager, dus vooral belasting).

## Plaat (tools/headless/vormen-plaat.mjs, poorten 8872/9472)

Uitmap `/private/tmp/claude-501/-Users-claykrebbers-Desktop-1--Projects-Youtube-mixer/021ab88d-7426-46a5-8e31-95fd0058df22/scratchpad/zwaar/`:
- `voor/`, `voor-600/`, `voor-q25/`, `voor-ph-1800/`, `voor-ph-3600/`: oud, alle vijf "vierkant".
- `na2/` (180 stappen): **5 × 16:9** — gs 0,48 · cl 0,55 · ln 0,50 · ph 0,53 · sp 0,57 (midden-x).
- `na2-600/` (10 s): 5 × 16:9. `na2-ph-1800/`: ph na 30 s, strengen over de hele breedte.
- `na2-q25/` (kwaliteit 0,25, 300 stappen): 4 × 16:9, ph "vierkant" (streng
  toevallig links, zie ph). (`na/` en `na-600/` zijn een tussenversie van ph
  met 213 × 120 en 5000 agents; die gaf verticale banden na 30 s.)
Zelf bekeken (Read op de PNG's): gs, ln, sp vullen het doek tot in de hoeken,
geen lege strook; cl gecentreerd en heel; ph wisselend, zie boven.

## Tests

- `nice -n 10 node test/vormen-zwaar.test.mjs`: alles groen (meerdere runs,
  belasting 8–17). Nieuwe checks:
  - geen `g.S` in de bron;
  - waar elk rooster landt (drawImage opgenomen): gs/ln/ph/sp (0, 0, 640 × 360),
    cl in het middenvak (140, 0, 360 × 360);
  - gs/ln: vierkante cellen, even maten, halve maat vierkant en precies de
    helft, evenveel cellen als het oude n² (±2%);
  - ln: kernel op de halve maat R / 2 voor R = 7, 10, 13 (gewogen straal ±3%);
  - gs: pointer per as;
  - ph: 284 × 160, cel = H / 160, agents per cel gelijk, rekentijd ≤ × W/H,
    start in een schijf rond het midden;
  - cl: histogramrand leeg, vorm ≥ 40% van de hoogte;
  - sp: oneven, ~4 px, < 129² cellen, symmetrisch (alle drie de plekken),
    "vol" pas aan de zijkant met boven- en onderrand bereikt, < 4 s;
  - de zandhoopvergelijking met het origineel (abels) op 161 × 91;
  - `maakG` bouwt g met `maten(LAAG_BREEDTE, LAAG_HOOGTE)` op een 640 × 360-canvas.
- `nice -n 10 node test/werker.test.mjs`: groen.
- NIET gedraaid (opdracht): de hele suite. `vormen.test.mjs` laat alle 26
  systemen 180 stappen in een echte VormLaag lopen; dat dekt mijn test ook,
  maar ik heb hem niet gedraaid.
- Geen rood door timing gezien.

## Aannames en open punten

- Grootte van de patronen (gs, ln): de standaard van VORMEN-16x9.md (zelfde
  rekentijd, vlekken ~33% groter t.o.v. de hoogte). De basis-agent legde Clay
  al de vraag voor of hij liever de maat van 24 sep wil.
- ph: "schaal en snelheid" gelezen als t.o.v. de hoogte (= de zijde van het
  oude vierkant, zoals de vormen rond een middelpunt op `kort` schalen). Leest
  Clay het t.o.v. het bijgesneden beeld van 24 sep, dan is ph nu 44% kleiner
  en trager dan wat hij toen zag.
- sp: "vol" aan de zijkant is een gedragswijziging (vroeger ook aan de
  bovenrand). Zonder die wijziging vult sp de breedte niet.
- cl: breedte gebruiken voor brede Clifford-attractors is een keuze voor Clay.
- ph met standaardknoppen eindigt in banden; op 16:9 soms verticaal met veel
  donker ertussen. Knoppen of een andere start veranderen dat niet (gemeten).
- Niets in echte Chrome, niets op de APC, niets met een Worker (alleen
  werker.test in node en de headless plaat op de hoofdthread).
- Voor CLAUDE.md (VORMLAGEN, bij "g.kwaliteit"): "ph minder agents" blijft
  kloppen; eventueel toevoegen: "ph 284 × 160 met 8875 agents (schaal t.o.v.
  de hoogte), sp 161 × 91 en 'vol' aan de zijkant, cl vierkant in het middenvak".
