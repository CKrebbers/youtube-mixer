# Droogloop 17 okt: wat hier kon, zonder de Mac, de APC of de hub

Tak `studio/droogloop-17okt` (vanaf main fec9833). Clay: "ga je verder met wat je nu zelf kunt uitvoeren".
Gedraaid in een Linux-container (de "pc-kant"): geen geluidskaart, geen APC, geen Maschine, geen AV-app-hub,
geen Stroommachine, geen GPU. Chromium = de headless shell van Playwright (1194) via `VARVE_CHROME`.

## 1. De suite

`node test/alles.mjs` op **Node 26.8.2** (`.node-version`): **groen**. Op de Node van de container (22) zijn
alleen `renderblok` en `instrumenten-fm-schaal` rood: die staan in VERSIEGEVOELIG (gouden hash en afval op één
V8), en `alles.mjs` meldt dat boven en onder. Geen test overgeslagen behalve wat de hub-repo nodig heeft.

## 2. Het avondpakket op de pc

Eén echte fout: op een machine zonder library (de pc) werd het punt **Server** bij aankomst rood ("start VARVE
in het Dock"). Daar draait de Varve-server nooit. Nu grijs: "niet op deze machine — de Varve-server draait op de
Mac" (`server/avondpakket.js`, `backup.geenLibrary`; test in `test/avondpakket.test.mjs`). Op de Mac verandert
niets.

## 3. De headless proeven

66 proeven uit `tools/headless/` gedraaid, elk met een eigen uitmap, 900 s per proef. Eerste ronde: **47
groen, 19 niet**. Niets daarvan was een fout in de mixer of de server. Wat er aan de hand was:

| proef | wat | gedaan |
|---|---|---|
| auto | las de tweede `.au-plan` (de DAARNA-regel van S9) | `.au-plan:not(.au-set)` + een check op DAARNA |
| beeld | aan/adres staan sinds 11 okt op de server, niet in localStorage | `PUT /api/instellingen` vóór stap 8 |
| indeling, instellingen, werk-scherm | lazen vóór het antwoord van de server binnen was | wachten op de stand, niet op een vaste tijd |
| master | de offline render hing (Chromium 1194) zonder de limiter-module vooraf | `addModule` vóór het renderen |
| klankschaal | de maatcheck van vóór het rij-gebied van 6 okt (3 px) | per element in `#rijen`, zoals rijen.mjs |
| sampler-drums | de rij schuift 15 px in de koppelmodus | de knop opnieuw opmeten in die modus |
| sec-controle | de tegel Server heeft sinds AR9 een herstartregel vóór de sectieregel | de regel die met "secties:" begint |
| standen | de tegel Versie staat nu vooraan; 33 sjablonen | Opstelling direct na Server; het aantal uit `racks/sjablonen.json` |
| tekenen | zocht Chrome niet via `VARVE_CHROME` | `zoekChrome` zoals de andere |
| **stems** | **hing**: navigeert van de mixer naar /controle terwijl er iets laadt, en sinds `vertrek.js` (884cda4) vraagt de mixer dan "Site verlaten?"; niemand antwoordde | `Page.javascriptDialogOpening` → accepteren, zoals set-proef |
| sec-toets, sec-sampler | het grid van de oude analyse ligt op dit nummer deels op de offbeat en heet daarna "drift" (zie §4) | het bekende grid op slot zetten en daarna de library-lijst verversen (laden neemt het grid uit de rij van het paneel) |
| sec-auto, vorm-maat, vormen-plaat | belasting: 397 ms stilte, één gemiste klap, Chromium startte niet binnen de tijd | opnieuw, los: groen |
| werk-ipad | twee functionele FAILs in één ronde, daarna niet meer; de tijdmeting (grens ~5 ms) faalt onder belasting (max 5,04 ms, mediaan 1,6) | niets: op de Mac meten (punt werk-ipad in de speellijst) |
| rijen | geen FAIL, maar te traag voor 900 s in deze container (swiftshader tekent op de CPU) | met 3600 s: 565/565 groen in 28 min |

**Regel voor wie een proef schrijft:** verlaat een proef de mixer (navigate, reload) terwijl er iets speelt,
wacht, laadt, opneemt of de auto-DJ aan staat, dan vraagt de mixer eerst (vertrek.js). Beantwoord
`Page.javascriptDialogOpening` met `Page.handleJavaScriptDialog { accept: true }`, anders hangt de proef zonder
melding (de renderer staat stil in de dialoog, ook `Runtime.evaluate` wacht).

Na de reparaties: alles wat hier kan draaien is groen, op de tijdmeting van werk-ipad na.

## 4. Gevonden in de analyse: DL1

Op het synthetische sectienummer (`test/synth-nummer.mjs`, 124 bpm, zeven secties) geeft de **oude** beat-analyse
(`maakGrid`: de server zonder Beat This!, op de Mac de tweede mening en de terugval):

- 0–42,7 s zeker (0,82), maar ~0,45 tel naast: op de **offbeat** (in het intro alleen hats en pad);
- vanaf 46,7 s onzeker (0,60, `twijfel: 'drift'`), terwijl het grid daar maar 25–35 ms vroeg ligt.

Bisect: de tweede komt uit 0158e3b (14 okt, `blokDrift`). De mediaan van de onset-pieken per blok ligt in een
stuk zonder kick (snare, pad, bas) stelselmatig 25–45 ms vóór de tel, ook tegen het echte grid (0,09 tel > de
grens 0,08). Een andere bezetting is geen drift, maar de controle ziet hem zo. **Niet aangepast** vlak vóór de
proefavond; de vraag, het advies en hoe te meten staan in VRAGEN **DL1**. De sectieproeven toetsen nu secties op
het bekende grid, niet de analyse.

## 5. Wat hier niet kon

- Alles met de AV-app-hub (hub, speelapparaten, sec-hub, sec-maschine, werk-maschine, led-vertraging): de hub-repo
  staat niet in deze container.
- beeld-e2e, beeld-lokaal, zaalbeeld: de Stroommachine en een GPU.
- beamer: de volledige Chrome for Testing met `--headless=new` (een verborgen tabblad); hier alleen de shell.
- kaart-echt: een server die al draait met de echte `varve-kaart.json`.
- Alles met geluid uit de luidspreker, de APC zelf, de Mac (osascript, VARVE.app, launchd, iCloud, Tailscale):
  dat is de speellijst van de Controlekamer.

## 6. Daarna nog gedraaid

- **latentie**: groen (knop → geluid p50 0,8–2,2 ms, geen lange taken).
- **werk-alles** (de totaalmeting van de werkruimte, C6): 12 van 13. Wat faalt is het budget "≤ 2 ms per beeld
  extra, gemeten per beeld" zonder mac-2 (3,26 ms). Hier haalt de pagina maar 36 beelden/s (geen GPU), dus elk
  beeld duurt langer; dezelfde meting als Δtaak / 60 is 0,78 ms en slaagt. Geen fout gevonden; op de Mac meten
  (werk-alles in de speellijst).
