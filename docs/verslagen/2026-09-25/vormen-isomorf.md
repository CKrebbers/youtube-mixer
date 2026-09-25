# Vormen 16:9, spoor isomorf (sn, tv, ep, dw)

Branch `spoor2/vormen-isomorf` (vanaf `spoor/vormen-basis`), één commit:
`c5176f3 Isomorfe vormen op 16:9: snaar over de breedte, vel met lucht, kanalen naast de figuur`.
Alleen `src/vormen/systemen-isomorf.js` en `test/vormen-isomorf.test.mjs` gewijzigd.
Worktree staat na afloop op detached HEAD; niets gemerged, niets gepusht.

## Uitkomst in één oogopslag

| | voor (plaat) | na (plaat) | rekentijd oud → nieuw (om en om, zelfde drukte) | geluid |
|---|---|---|---|---|
| sn Trillende snaar | vierkant, midden-x 0,27 | 16:9, midden-x 0,46, 38% rechts | 0,081 → 0,081 ms (× 1,00) | ongewijzigd, sample voor sample getest |
| tv Trommelvlies | vierkant, 0,28 | 16:9, 0,50, 36% rechts | 1,996 → 2,460 ms (× 1,23) | ongewijzigd (vel blijft rond), sample voor sample getest |
| ep Epicykels | vierkant, 0,31 | 16:9, 0,52, 42% rechts | 0,083 → 0,112 ms (× 1,35) | ongewijzigd, golfvormen getest |
| dw Korrelwolk | vierkant, 0,31 | 16:9, 0,56, 50% rechts | 0,041 → 0,042 ms (× 1,02) | code ongewijzigd; zie "wat het geluid merkt" |

Toegestaan was × 1,78 (verhouding van de oppervlaktes, W / H). Alle vier vullen de
hele breedte; geen lege of zwarte strook (zelf bekeken op de PNG's, na 3 s en na
30 s, kwaliteit 1 en 0,25). Het bestand noemt `g.S` en `rooster(g, getal)` niet meer.

## Per systeem

### sn · Trillende snaar

- **Wat ik deed:** de snaar loopt nu van `0,08·H` tot `W − 0,08·H`, dus met
  links en rechts dezelfde rand als boven (`SN.kam(g)`). Hoogtes blijven op `g.H`,
  zoals ze eerst op `S` stonden: snaar op 0,4 H, uitslag 0,2 H, balkjes op 0,72–0,86 H.
  De 24 modusbalkjes staan over dezelfde breedte als de snaar.
- **Klikken** (`pointer`) rekent in pixels op de snaar: `(x·W − x0) / (x1 − x0)`.
- **Wat anders oogt:** de snaar is bijna twee keer zo lang (582 px in plaats van 302
  in 360-maat) bij dezelfde uitslag. Hij ziet er daardoor platter uit: lengte gedeeld
  door uitslag was 4,2, nu ~8. Een snaar is een lijn en geen vlak, dus dat is geen
  uitrekken. De balkjes zijn breder (24 px).
- **Punten op de snaar:** blijft 160 (X). De rekentijd is daardoor gelijk; op de
  langere snaar is dat nog steeds glad (de hoogste modus heeft 13 punten per golf).
- **Geluid:** onveranderd. De toon hangt niet af van de lengte in beeld; pan is nog
  `(pos − 0,5)·0,6`.

### tv · Trommelvlies: de gekozen afweging

- **Keuze: het vel blijft ROND, het geluid blijft gelijk.** Een rechthoekig
  16:9-vel zou andere modi geven (sin·sin in plaats van Bessel), dus een andere
  klank en dambordpatronen in plaats van Bessel-ringen. De ondertitel "Bessel-modi",
  `DRUM`/`besselJ`/`drumCache` en de klank zouden allemaal veranderen. Dat heb ik
  niet gedaan. Het vel is een vierkant rooster van 110 × 110 in `midden(g).vak`
  (140, 0, 360, 360). Buiten de cirkel is het doorzichtig; eerst werd dat gevuld
  met achtergrond.
- **De passende achtergrond: de LUCHT.** Wat de slag uitstraalt, over het hele doek.
  Per modus met m ≤ 2 (9 van de 16: ringen, twee lobben in tegenfase, vier lobben)
  loopt een golf vanaf de rand naar buiten: `a·cos mθ · e^(−dt/τ) · cos(ω·dt − κρ)`
  met gewicht `1/√r`. De tijdsfase is die van het vel; de golfsnelheid
  `LUCHT_C = 0,5` stralen/s is een beeldkeuze. Zo is ook de rest van het beeld
  het geluid, zoals het de ruimte in gaat.
  - Rooster: cellen van 2 velpixels over het hele doek, 98 × 55 (3262 cellen
    buiten het vel), zacht opgeschaald. `luchtCache(nx, ny, W, H)` bewaart de cellen
    op afstand tot de rand gesorteerd, met per cel en modus 4 voorgerekende
    getallen, gedeeld door alle lagen.
  - **Front:** een slag loopt als front naar buiten. Voorbij het front klinkt in de
    lucht nog de slag ervoor; `s.hist` onthoudt 4 slagen terug en is vooraf gemaakt
    (geen allocatie). Rond elk front ligt een band van ±0,04 straal waarin de twee
    overvloeien. Vanaf de rand loopt de lucht aan (`1 − e^(−ρ/0,08)`). Zonder die twee
    zag je trapjes van het rooster, en langs de rand een stippellijn van het vel
    (eerste proef, verworpen).
  - Sterkte: 0,45 van het vel (`LUCHT_FEL`), zodat het vel de hoofdzaak blijft.
    De eerste proef met 0,75 en c = 0,9 was te fel: één grote blauwe halo.
  - Vereenvoudigingen (bewust, beeld en geen akoestiek): de omhulling wordt niet
    per afstand vertraagd (alleen welke slag, via het front), en alleen m ≤ 2 straalt.
- **Klikken** rekent in de korte zijde rond het midden (voorheen `x·2 − 1` over het
  hele doek).
- **Klok terug:** `hist[].t0` schuift mee, net als `hit.t`.
- **Kwaliteit:** het vel is nog 110/78/55; de lucht schaalt mee (98×55, 69×39,
  49×28). Op 0,25 is de lucht zichtbaar grover (blokjes in de ringen), maar de
  beweging is gelijk.
- **Rekentijd:** × 1,23 (kwaliteit 1) en × 1,37 (0,25) tegen de oude code. Op de
  plaat (headless, met tekenen, drukke machine) 1,71 ms voor en 2,0–2,6 ms na.
- **Wat anders oogt:** zachte ringen en lobben die van het vel af lopen, een front
  na elke slag, en daarachter nog de vorige slag. Het vel zelf is hetzelfde, even
  groot als de hoogte.

### ep · Epicykels

- **Figuur:** rond het midden op de korte zijde (`midden(g)`, `sc = kort·0,36`), heel
  in beeld.
- **De breedte:** links kanaal L (= x) en rechts kanaal R (= y) als golfvorm
  (`EP.kanalen`), als een oscilloscoop over één hele omwenteling. Het nieuwste punt
  staat bij de figuur, het oudste aan de rand; het vervaagt in 4 stukken, met een
  vage nullijn. Dat is letterlijk wat de twee oscillatoren spelen.
  - De waarden komen uit de geest (301 punten per omwenteling) met lineaire
    interpolatie: geen tweede Fourier-som, en de golf schuift glad.
  - 96 punten per kant, bij lagere kwaliteit minder (minimaal 24).
  - Rechts begint de golf precies op de hoogte van de punt (getest). Links staat
    de x van de punt verticaal uitgezet: geen meetkundige verbinding, wel het
    L-kanaal. Is er geen ruimte naast de figuur (vierkant doek), dan tekent hij niets.
- **Tekenen** (`pointer`, nu met `g` als zesde argument zoals sn/tv/dw) rekent in de
  halve korte zijde rond het midden. Een cirkel op het scherm blijft een cirkel;
  met `x·2 − 1` was hij op 16:9 een ovaal geworden (getest: grootste coëfficiënt
  0,999, tweede 0,000).
- **Rekentijd:** × 1,35, door ~220 extra lijnstukken per beeld.
- **Wat anders oogt:** twee golflijnen naast de ster. Op de plaat leest het als
  "stereo-scoop"; de figuur is even groot als de hoogte.

### dw · Korrelwolk

- **State:** `s.x` en `s.y` blijven FRACTIES van breedte en hoogte, want dat leest
  het geluid (x = plek in de buffer en panorama, y = toon).
- **Beweging:** in echte eenheden (hoogte = 1, breedte = W / H). Duwtjes, draaikolk,
  veer, demping en snelheid zijn isotroop, dus niets rekt uit (getest: stapjes in
  beeld x:y ≈ 1,0–1,2). Beginnen (0,2–0,8) en verstrooien (0,05–0,95) gaan over
  het hele doek. De achtergrond heeft acht stroken over de breedte (stukken van de
  buffer) en vijftien toonlijnen.
- **Op een vierkant doek bit voor bit de oude beweging.** Getest tegen een
  nagebouwde oude stap, 10 s met draaikolk 0,9 tegen de randen. Daarvoor wordt
  eerst opgeslagen en dan de rand getoetst op de Float32-waarde, zoals vroeger.
- **Verworpen variant: een zwakkere veer in x (0,15 / A²)**, zodat de wolk even
  breed zou blijven als het doek. Gesimuleerd (spreiding x/y in hoogte-eenheden):
  met draaikolk 0,35 werd het een draaiende staaf (0,081/0,124 na 30 s, afwisselend)
  en niet breder (0,065/0,061 na 60 s). Isotroop geeft precies de oude cijfers
  (0,043/0,045 na 60 s, gelijk aan het vierkant).
- **Wat anders oogt:** de wolk begint over de hele breedte en trekt, zoals altijd,
  in ~20 s samen tot een bolletje in het midden. Dat bolletje is even groot als
  vroeger ten opzichte van de hoogte, dus op het scherm kleiner dan de bijgesneden
  versie van 24 sep. Stroken en lijnen blijven de breedte vullen.
- **Wat het geluid merkt (aanname, Clay kan anders willen):** de code is gelijk,
  en de afbeelding van fractie van de breedte naar buffer/pan ook (getest: een
  korrel op 25% geeft pan −0,4 en dezelfde plek in de buffer, op 16:9 en op 512²).
  - Omdat de wolk niet mee uitrekt, bestrijkt een samengetrokken wolk een smaller
    deel van de breedte (× 0,56). Daarmee ook een smaller stereobeeld en een
    smaller stuk van de korrelbuffer.
  - Beeld = geluid: het geluid volgt het beeld.
  - Wil Clay de oude breedte in het geluid terug, dan kan x voor het geluid
    uitgerekt worden rond het midden. Dat zou het beeld = geluid-principe
    breken, dus niet gedaan.

## Tests (`test/vormen-isomorf.test.mjs`)

- `maakG` bouwt `g` met `maten(LAAG_BREEDTE, LAAG_HOOGTE)` (640 × 360) en
  ZONDER `g.S`: een vergeten `g.S` wordt NaN en valt op in de bestaande checks.
  Opties: `breedte`, `hoogte`, `opname` (een doek dat elke aanroep met argumenten
  bewaart).
- Nieuwe sectie "16:9", 31 checks:
  - Algemeen:
    - geen `g.S` en geen `rooster(g, getal)` in de bron;
    - elk systeem tekent van ≤ 10% tot ≥ 90% van de breedte en niet ver erbuiten,
      zonder de achtergrond mee te tellen.
  - sn:
    - de eindpunten van de snaar;
    - klikken op 30% = plukplek 0,3.
  - tv:
    - de lucht over het hele doek, en het vel (110 × 110) in het midden-vak;
    - de maten van het luchtrooster en dat het gesorteerd is;
    - m ≤ 2, en de lucht is 0 aan de rand;
    - de cache per doek;
    - het front: 0,5 s na de slag lucht tot ρ = 0,25 en daarachter stil;
      na 2,2 s is de verste hoek bereikt;
    - de geschiedenis: 0,2 s na een tweede slag is de lucht voorbij het front
      precies die van de eerste (2410/2410 cellen); een slag geeft dus geen flits;
    - klok terug;
    - klikken in de korte zijde.
  - ep:
    - de kanalen beginnen bij de punt;
    - ze blijven binnen de hoogte van de figuur;
    - een getekende cirkel blijft een cirkel;
    - op een vierkant doek geen kanalen.
  - dw:
    - isotrope stapjes;
    - hij begint over de hele breedte;
    - de afbeelding naar het geluid is gelijk op 16:9 en op 512²;
    - op een vierkant doek bit voor bit de oude beweging.
  - Geluid:
    - sn en tv: 8 aanslagen sample voor sample gelijk op 16:9 en op 512²;
    - ep: dezelfde PeriodicWaves.
- Nieuwe sectie "rekentijd": mediaan per stap, beste van 3 rondes, op 640 × 360
  tegen 360 × 360 met dezelfde code. Eis: hooguit W / H × 1,15 + 0,01 ms. Gemeten
  × 0,92–1,04 (sn, dw), × 1,16–1,55 (tv, afhankelijk van de drukte), × 1,22–1,48 (ep).
- Zonder test-sectie: los om-en-om gemeten tegen de OUDE code (A/B, beste van 7,
  load ~34), met de cijfers in de tabel bovenaan. Het script staat in
  `scratchpad/isomorf/ab/ab.mjs` en draait de oude versie uit `spoor/vormen-basis`.
- `werker.test.mjs`: groen.
- **Timing onder belasting (melden):**
  - de BESTAANDE check "max < 16 ms per stap bij kwaliteit 1" viel bij load 30–78
    om de beurt om bij sn, tv of dw. Bijvoorbeeld dw: max 33 ms bij gemiddeld 0,38 ms,
    en sn 16,7 ms bij 0,1 ms: de machine plande de draad niet in, het is geen rekenwerk;
  - alle functionele checks waren elke keer groen;
  - rustige herhaling (load ~12): **alle 118 checks groen**. Gemiddeld per stap:
    sn 0,097 ms, tv 2,365 ms (max 4,4), ep 0,142 ms, dw 0,059 ms;
  - of de pieken van de nieuwe code komen: tv oud en nieuw om en om, 10 rondes van
    180 stappen (`scratchpad/isomorf/ab/ab-max.mjs`). Max 1,9–3,7 ms (oud) tegen
    2,4–4,0 ms (nieuw), in 0 van de 10 rondes boven 16 ms, voor beide. Mediaan
    1,6 → 2,0 ms (× 1,25). De uitschieters van 16–45 ms in de testruns kwamen dus
    van de drukte, niet van de code.
- `vormen.test.mjs` heb ik NIET gedraaid (opdracht: alleen eigen test en werker).
  Hij draait alle 26 systemen door een VormLaag met een NaN-check. Mijn eigen
  VormLaag-check doet hetzelfde voor deze vier en is groen, dus ik verwacht groen.

## Platen (headless, poorten 8874/9474)

In `scratchpad/isomorf/`:
- `voor/` (4× vierkant);
- `na/` (zaad 7, 3 s);
- `na-kw025/` (kwaliteit 0,25);
- `na-30s/` (zaad 3, 30 s);
- `tv75/`, `tv420/` (tv vlak na een slag, en na 7 s);
- `dw1800/`: dw met de verworpen zwakke x-veer (de staaf).

Classificatie na: 4× "16:9", midden-x 0,46 / 0,50 / 0,52 / 0,56, licht rechts van
1,05 H: 38 / 36 / 42 / 50%.

## hulp.js / laag.js / lagen.js

Niets gemist en niets aangepast. Wel lokaal opgelost:
- Het luchtrooster van tv gebruikt niet `cellen()`: de celmaat volgt het vel (2
  velpixels, zodat vel en lucht bij elke kwaliteit bij elkaar passen). `nx`/`ny`
  reken ik zelf uit en geef ik aan `rooster(g, { nx, ny })`.
- Het vel zelf: `rooster(g, { nx: N, ny: N })` plus `blit(gr, g, false, midden(g).vak)`,
  zoals het recept voor een bewust vierkant rooster.

## Niet getest

- Niets in echte Chrome; alleen de headless shell (swiftshader) en Node.
- Niets op de APC. Geen tabblad geopend en :8777 niet aangeraakt.
- Het geluid niet beluisterd; het is in Varve nog nergens aangesloten. Wel bewezen
  dat de samples gelijk zijn aan die op het oude vierkant.
- De werker-modus voor deze vier (werker.test is groen, maar die gebruikt ze niet
  specifiek).
- Rekentijd op de M1 in echte Chrome. Alle cijfers komen van een drukke machine
  (load 17–78).
- Hoe de lucht van tv en de kanalen van ep er op de beamer uitzien, over video
  (de shader trekt #07090c af; de stille lucht is L[128] ≈ #08090c, dus doorzichtig).

## Voorstel voor CLAUDE.md (VORMLAGEN, punt "Isomorf") — niet zelf gewijzigd

> Op 16:9 (ROADMAP 7) is het geluid van de vier niet veranderd. sn: snaar van rand tot
> rand. tv: vel blijft ROND in het midden (zelfde Bessel-modi); naast het vel de
> LUCHT: per modus m ≤ 2 een golf die met LUCHT_C naar buiten loopt, een slag als
> front met 4 slagen geschiedenis en een overvloeiband (luchtCache). ep: figuur op de
> korte zijde, links/rechts de kanalen L (x) en R (y) als scoop uit de geest. dw:
> beweging in echte eenheden (isotroop), x blijft voor het geluid de fractie van de
> breedte; een samengetrokken wolk bestrijkt daardoor × 0,56 van buffer en stereobeeld.
> Rekentijd t.o.v. de oude code: sn/dw × 1,0, tv × 1,23, ep × 1,35.

## Vraag voor Clay

- dw: mag het stereobeeld/bufferbereik van een samengetrokken wolk smaller zijn
  dan vroeger (beeld = geluid, niets uitgerekt)? Of wil je het geluid over de
  oude breedte, en is een iets minder letterlijk isomorf beeld dan goed?
- tv: de lucht is een beeldvondst (op natuurkunde gebaseerd, maar
  vereenvoudigd). Bevalt hij, of liever rustiger (`LUCHT_FEL` lager) of
  helemaal alleen het vel op zwart?
