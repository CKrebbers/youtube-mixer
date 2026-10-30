# De speeltuin: opnieuw beginnen met lege toestellen

Clay, 30 okt 2026, na de eerste proef op de echte APC + Maschine: "het voelt helemaal verkeerd, ik wil dat je
helemaal opnieuw begint en dat we eigenlijk spelenderwijs gaan kijken wat we allemaal waar willen hebben."
Keuzemenu: wat mis was = **het hele idee** en **de knoppen onlogisch**; aanpak = **lege toestellen**;
hergebruik = **de motor wel, de indeling niet**.

Dus: Hybride, de grondwet, ruimtes, padstanden, processen, de avond en de tocht doen hier niet mee. De motor
(afspelen, effecten, gebaren, korrelwolk, drums, noten, beeld) blijft, als gereedschap. Tak `claude/speeltuin`.

## Openen

    http://localhost:8780/?hub=ws://127.0.0.1:7700/app&indeling=speeltuin

## Spelen

| Doe | Wat er gebeurt |
|---|---|
| Raak een **lege** knop aan (APC of Maschine) | hij krijgt meteen voorstel 1 en doet het al bij die druk |
| **F1–F4** (boven het linker Maschine-scherm) | een ander voorstel uit het rijtje van vier; meteen live |
| **F5 ANDER** / **F7 TERUG** | het volgende / vorige rijtje |
| **F6 LEEG** | de knop weer leeg |
| **F8 GOED** | "dit klopt" (vinkje in het logboek) |
| Raak een **volle** knop aan | hij speelt gewoon; een F-knop daarna verandert hem |
| **SHIFT** vast + knop | de shift-laag van die knop vullen |
| **muziek erin** (paneel rechtsonder) | twee nummers op track 1 en 2, de eerste speelt |

De F-knoppen gaan altijd over de laatst aangeraakte knop. Ze zijn zelf niet te vullen. Het paneel rechtsonder
laat hetzelfde zien als de Maschine-schermen, en is ook aan te klikken.

Voorstellen komen in families met een eigen lampkleur: mix (wit), spelen (groen), gebaar (oranje), klank
(blauw), ritme (geel), noten (cyaan), beeld (magenta). Per soort knop komt eerst wat de hand verwacht (fader:
mix; pad: gebaar), en wat al op een andere knop staat komt achteraan. Een knop in een APC-kolom stuurt die
track; de rest de track met focus. De lijst staat in `app/src/control/speeltuin-kaart.js`.

## Bewaard

- Wat op de knoppen staat: `~/.varve/v2/instellingen/indelingen-eigen.json`, indeling `speeltuin` per apparaat
  (apc, maschine), een halve seconde na elke keuze.
- Wat er geprobeerd, gekozen, goed gevonden en leeggemaakt is: `instellingen/speeltuin-log.json`. Daaruit is
  later af te lezen wat waar hoort.

## Stand (30 okt)

Gebouwd en getest in software (605 tests groen, 10 nieuw in `app/test/speeltuin.test.mjs`) en in headless
Chrome op een aparte proefserver (paneel, kiezen, bewaren, herladen, logboek). **Nog niet op de hardware.**
