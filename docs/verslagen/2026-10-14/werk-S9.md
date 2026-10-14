# Verslag S9: een set klaarzetten, live bijmixen en sets (14 okt 2026)

Tak `werk/S9`, samengevoegd met `werkruimte/integratie` (82cf3ec, met S6, S7 en S8). Het ontwerp en
wat er gebouwd is staan in `docs/PLAN-SET.md`. Clay vroeg, letterlijk: "En bij het plan moet je makkelijk en snel een hele
set klaar kunnen zetten waar je dan zelf nog onderdelen live moet bij kunnen mixen." Daarna ook:
"Voeg ook toe dat ik sets kan opslaan en terugladen." (`docs/werkruimte/S9-aanvulling.md`).

## 1. Wat gebouwd is

1. **Snel klaarzetten** (`src/plan/klaarzetten.js`, puur, in het planvenster):
   - bronnen: de selectie (vinkjes of "alles"), een krat van de kaart of een "past bij"-keten;
   - volgorde: boog, oplopend of zoals gekozen. Eerst op energie, daarna ruilen voor mooiere overgangen;
   - lengte: een duur of een eindtijd; eerst korter, daarna vallen er nummers af;
   - per stap: toetsen 1–4 voor de overgang en G voor GO.
2. **Klaar voor de set**: per nummer G T S § V (`POST /api/set/klaar`). "Maak klaar" zet stems en secties
   in de bestaande rijen. Het weigert op een speeldag en als er een deck speelt.
3. **Live bijmixen** (`src/auto/automaat.js`):
   - **tracks van de automaat** (`plan.tracks`); nooit een track van Clay, ook niet een die hij zelf laadde;
   - **GO per stap**, met een uiterste moment: nooit stilte;
   - **buiten plan** en **terug**;
   - **lagen** op een track van Clay (nummer met of zonder stem, sampler-pad, patroon). Clay neemt ze over
     door de track aan te raken, of slaat ze over.
   - actions `plan.*`.
4. **Live-stand**: NU / VOLGENDE / DAARNA, de volgende laag en de verwachte eindtijd. Te zien in:
   - de AUTO-rij (met een GO-knop);
   - het planvenster;
   - de bouwsteen `plan` op werk.html: mac-2 via opener, de iPad via `GET /api/set/live`.
5. **Sets opslaan en terugladen** (`src/sets/model.js`, `server/sets.js`, `server/routes/sets.js`,
   `src/ui/sets.js`):
   - wat erin zit: plan en patronen als kopie, de werkruimte op naam, en optioneel de mixer als momentopname;
   - opslag: versie, 409, `.versies`, kopiëren en hernoemen, alleen vanaf deze Mac;
   - terugladen: met de tweede druk binnen 3 s over wat speelt, en er start niets;
   - bediening: actions `set.*`, de bouwsteen `sets` en het planvenster.
6. **Voorbeeld**: `mappings/stukken/set-voorbeeld.json`, gemarkeerd als voorbeeld en niet geladen.
   Er is geen mapping veranderd.

## 2. Gemeten

- **Handelingen voor een set van 12 nummers** (`tools/headless/set-proef.mjs`): 3 tot het plan op de server
  staat (alles · maak set · opslaan). Vanuit de mixer zijn het er 5 tot de automaat speelt:
  plan openen · krat · maak set · gebruik dit plan · auto aan. De boog begon rustig (nr01) en had de piek op plek 9 van 12.
- **Opslaan → alles anders → terugladen**: dezelfde stand. Nummers, posities, fader, filter, cue, plan en
  patronen kloppen; er speelt niets en de patronen botsen niet. Over een spelende track vraagt de eerste druk
  en laadt de tweede.
- **latentie.mjs** (`--scenario fader`, headless in deze container), fader → geluid p50:

  | meting | p50 |
  |---|---|
  | basis (`werkruimte/integratie`) | 0,56 ms |
  | S9, eerste ronde (drukke container) | 0,89 ms |
  | S9, tweede ronde | 0,48 ms |

  Geen lange taken.
- **Tests** (alle groen):

  | test | wat |
  |---|---|
  | `test/plan-set` | formaat, oude schrijver, volgorde, lengte, keten, live, VAST_NOOIT |
  | `test/auto-set` | eigen tracks, nooit Clay, GO, buiten/terug, lagen, de reparaties van de review |
  | `test/sets-server` | over HTTP, kruisend hernoemen, klaar en maak klaar, live |
  | `test/sets-mixer` | bewaren, terugladen, tweede druk, auto-DJ, patronen, grid van NU |

  `node test/alles.mjs`: zie §8.

## 3. Wat niet gebouwd is

- Een set kiezen in de Controlekamer (VRAGEN S9-7).
- Een begintijd voor "tot 01:30": hij rekent vanaf nu.
- Terugladen vanaf de iPad: `set.terugladen` staat in VAST_NOOIT (VRAGEN S9-4).
- De backup van `sets/` (VRAGEN S9-6).
- Een laag die over meer stappen loopt of op de maat van een andere track uitgaat dan via zijn eigen duur.
- De krat-route is niet headless getest: de proef draait zonder kaart.

## 4. Alleen live te bevestigen

- Een hele set met overnames in de echte browser: headless is alleen de start bewezen (stap 4 van
  set-proef: eigen gestreamde tracks). Een hele set van 12 stappen met twee overnames draaide in
  review ronde 3 op de mock met een getrouwe StreamBron-nabootsing (12/12, 0 tikken stil).

- Een laag die met echte muziek op de maat invalt (sync + op de maat), en of 0,8 en 4 maten goed klinken (S9-2).
- GO op de APC met het voorbeeldstuk.
- Terugladen van een set met acht tracks met stems op de M1: hoe lang het duurt en of de StreamBron
  alle pagina's op tijd heeft.
- De vakken `plan` en `sets` op de echte iPad.
- De energieboog op Clay's eigen library (S9-1).

## 5. Zo zet Clay een set klaar en mixt hij live bij

1. In de mixer: **plan** (het planvenster gaat open).
2. Rechts een **krat** kiezen, of nummers aanvinken. Bij "maak set van" de vorm kiezen (boog) en eventueel
   een duur (90, 1,5u of 01:30). Dan **maak set**.
3. Vul **tracks auto** in, bijvoorbeeld 1,2: de rest is van jou.
4. Kijk naar de **klaar**-tekens. Ontbreken er stems of secties, druk dan op **maak klaar** (niet op een speeldag).
5. Per stap: 1–4 voor de overgang, G als je zelf het moment wilt geven (GO). Lagen voeg je rechts toe:
   kies de stap, vink het nummer aan, vul "op" in met een sectie of m:ss, kies een track van jou en
   eventueel een stem, en druk op **+ laag**.
6. **Gebruik dit plan**, dan **auto**: de automaat speelt op 1 en 2.
7. Live mix je op je eigen tracks wat je wilt. Een laag kun je overnemen (raak de track aan) of
   overslaan (**laag weg**). Een GO-stap wacht op **GO**. Wil je het plan even loslaten: **buiten plan**.
   Ga je terug, dan neemt de automaat over wat het hardst klinkt.
8. Bewaar de voorbereiding als set: geef rechts onder **SETS** een naam, zet desgewenst **met mixer** aan
   en druk op **bewaar**. Een volgende keer gebruik je **laad** (tweede klik als er iets speelt).

## 6. Vragen voor Clay

Zie `docs/VRAGEN.md` blok S9:

| vraag | onderwerp |
|---|---|
| S9-1 | de boog |
| S9-2 | het niveau van een laag |
| S9-3 | 2 minuten of een vaste verdeling |
| S9-4 | GO en terugladen vanaf de iPad |
| S9-5 | de werkruimte als kopie in een set |
| S9-6 | backup van sets |
| S9-7 | de Controlekamer |
| S9-8 | live te bevestigen |

## 7. Opties voor een volgende versie

- Een set kiezen in de Controlekamer, met de klaar-tekens voor vanavond.
- Lagen die eindigen op een sectie (`tot: { sectie }`) in plaats van op een duur, en lagen over meerdere stappen.
- Claude als medeprogrammeur: "maak een set van 2 uur uit krat X met een piek om 01:00". Dat gaat via
  `maakSet` en het plan met `kent: KENT`.
- Een energiecurve uit de secties (alle stukken, niet alleen de luidste) en een golf met twee pieken.
- Een eindtijd die de automaat bewaakt: stukken onderweg korter maken als de set uitloopt.

## 8. Reviews en testuitslag

Twee agenten reviewden in rondes (a: correctheid en regels, b: bruikbaarheid en bewijs); wat ze vonden
en wat er veranderde staat in `docs/PLAN-SET.md` §9. Ronde 1: 2 blokkerend (a), 2 blokkerend (b),
een rij belangrijke en kleine punten, alle verwerkt of als bewuste keuze gedocumenteerd. Ronde 2:
één nieuwe blokkerende fout in een reparatie (de StreamBron, zie §9), verwerkt met een test die op
de oude code faalt en een stap in de headless-proef met echte gestreamde tracks.

`node test/alles.mjs` (na ronde 1): 122 bestanden, 10546 checks — rood alleen de bekende fouten van
deze container: wachtrij "yt-dlp en zijn kind" (2×) en renderblok "keylock met wissels". (Een eerste
run had ook `ingest` rood: yt-dlp was niet geïnstalleerd; na `pip install yt-dlp` groen.)
De laatste run na ronde 2 staat in het eindbericht van deze sessie.
