# Library: voorbij 200, sorteren, hotcues per nummer

ROADMAP 21, deel library (VERBETERINGEN ronde 3). Gebouwd op 25 september 2026
op `spoor/library`. De voortgang en wachtrij van de ingest is een ander spoor.

## Waar de grens van 200 zat

In `server/library.js`: `tracks({ zoek, limiet = 200 })` met `LIMIT 200`, en de
route gaf geen totaal mee. Nummer 201 bestond gewoon niet voor het paneel, en
niemand kreeg dat te horen. Ook het opstartbericht van de server telde met die
grens (`lib.tracks().length`). Het paneel zelf had geen grens, maar tekende
elk nummer als DOM-rij met acht laadknoppen.

## Gekozen: pagineren op de server én alleen zichtbare rijen tekenen

Twee mogelijkheden bekeken:

| | alles ophalen, sorteren en filteren in de browser | server pagineert en sorteert (gekozen) |
|---|---|---|
| per zoekletter / sortering | 5000 × ~1 kB = ~5 MB JSON, honderden ms serverwerk | één pagina van 100: ~100 kB, een paar ms |
| server | één lang verzoek blokkeert hem, terwijl hij ook de pagina's van spelende decks levert | elk verzoek begrensd (hooguit 500 rijen) |
| sorteren/zoeken | direct, zonder netwerk | een verzoek per klik (localhost, ms) |
| geheugen browser | alles | wat je gezien hebt |

De doorslag: de server levert ook de audio van spelende decks (streamen), en een
eerdere blokkade van 2,6 s gaf gaten. Dus: begrensd werk per verzoek.

Daarbovenop tekent het paneel alleen wat je ziet (virtuele lijst): een ruimte
zo hoog als de hele lijst (eerlijke scrollbalk), een vaste rijhoogte van 28 px,
en een venster met de zichtbare rijen plus 8 erboven en eronder.

**Aanname:** 5000 nummers is het doel; bij 50.000 werkt het nog (OFFSET op een
index), maar dat is niet gemeten.

## API

`GET /api/library?zoek=&sorteer=&richting=&van=&aantal=` geeft
`{ tracks, totaal, van }`.

- `sorteer`: `titel`, `bpm`, `duur`, `toegevoegd` (standaard), `gespeeld`.
  Onbekend = 400. Alleen EIGEN sleutels (`isSortering`, `Object.hasOwn`):
  `constructor` of `toString` bestaan ook op elk object en gaven eerst een 500.
- `richting`: `op` of `af`. Zonder: de eerste richting van die kolom (titel,
  bpm en duur op; toegevoegd en gespeeld af).
- `van` (een veilig geheel getal vanaf 0; niet met `| 0` afronden, dat is 32 bits)
  en `aantal` (1..500). Zonder `aantal`: ALLES (de meet-tools in
  `tools/beatmeting/` rekenden daarop; die hadden dezelfde stille grens van 200).
- `totaal` is het aantal treffers van de zoekterm, niet van de pagina.
- Zoeken: `%` en `_` zijn nu gewone tekens (`100%` zoekt 100%).

Sorteerregels (`SORTERING` + `volgorde()` in `server/library.js`):

- titel op een vooraf uitgerekende sleutel (`titel_sleutel`, `sorteertitel()`):
  zonder accenten, kleine letters, getallen op waarde (Track 2 vóór Track 10).
  SQLite's NOCASE kent alleen ASCII; "Élan" kwam dan na de z. Vooraf, omdat
  een JS-functie per rij per verzoek tientallen ms kostte bij 5000 nummers.
- bpm = het eerste stuk van het grid (`grid_bpm`), zoals de lijst het toont.
  Een nummer met een wisselend tempo ("wisselend") sorteert op zijn begin.
- gespeeld = `laatst_geladen`, gezet door `POST /api/library/<id>/geladen`:
  het moment dat hij op een track geladen werd. **Aanname:** "laatst gespeeld"
  = laatst geladen. Of hij daarna ook echt speelde, weet de server niet.
- Wat geen waarde heeft (geen grid, nooit geladen) staat ALTIJD achteraan.
- Gelijke waarden: laatst toegevoegd eerst (`toegevoegd`, dan `rowid`);
  omgekeerd sorteren keert ook dat om. Daardoor overlappen pagina's nooit.

Uitvoering: eerst alleen de rowids van de pagina uit een index (smal), dan de
hele rijen van die pagina in één query, met het aantal racks en de peaks er
meteen bij (vroeger twee extra queries per nummer).

## Het paneel

- `src/ui/library-lijst.js`: puur rekenwerk (sortering, welk stuk zichtbaar is,
  pagina-cache, kolommen, cellen). Getest in `test/library-lijst.test.mjs`.
- `src/ui/library-panel.js`: hangt het aan het scherm. De rest van het paneel
  (link, upload, wachtrij, laden) is ongewijzigd, op `this.tracks.find` →
  `this._track(id)` na.
- Klik op een kolomkop sorteert; nog eens = omgekeerd; de keuze staat in
  localStorage (`varve.library.sortering`), alles in try/catch (ook het LEZEN van
  `localStorage` zelf, dat gooit bij geblokkeerde sitedata).
- Zoeken wacht 120 ms na de laatste toets; een laat antwoord op een oudere
  zoekterm valt weg (generatie in `PaginaCache`). Ook een pagina die nog voor
  de VORIGE vraag onderweg was (scrollen vlak na een klik op de kop) valt weg:
  `zorgVoor` kijkt naar de generatie én naar de vraag zelf.
- Verversen (ingest klaar, nummer weg, paneel open) haalt het zichtbare stuk
  opnieuw en ruilt pas als alles binnen is: geen flits van lege rijen. Je blijft
  waar je was; alleen een nieuwe zoekterm of sortering begint bovenaan.
- Laden zet "gespeeld" in de rij meteen, maar sorteert NIET opnieuw: sorteer je
  op gespeeld, dan springt de lijst niet onder je muis weg terwijl je het
  volgende nummer zoekt. De volgende sortering of zoekopdracht klopt weer.
- Nieuwe kolommen: `toegevoegd` en `gespeeld` ("14:05" vandaag, "gisteren",
  "24 sep", "3 jan 25"; de volledige datum in de tooltip).

### Een kolom erbij

1. Een regel in `KOLOMMEN` (`src/ui/library-lijst.js`): `id`, `kop`, `breedte`,
   `klasse`, `cel(t, nu, staat)`, eventueel `hint(t)`. `staat` komt van het
   paneel (nu alleen `kiezer`: de rij waarvan de toonsoortkiezer open staat).
2. Sorteerbaar? Dan ook `sorteer: 'toon'`, een sleutel in `SORTERINGEN`
   (library-lijst.js) en in `SORTERING` (server/library.js) met een index in
   het schema. `library-lijst.test` controleert dat die twee gelijk zijn.

Zo kwam de toonsoort erbij (samenvoegen 25 sep): kolom `toon` tussen bpm en
grid, een knop (`data-toon`) die de kiezer opent. Niet sorteerbaar (niet
gevraagd). De kiezer staat NIET tussen de rijen: de lijst rekent met een vaste
rijhoogte, en een kiezer ertussen liet alles eronder verspringen zodra zijn rij
uit het getekende stuk scrollde. Hij zweeft absoluut onder zijn rij, over de
rijen eronder heen, en gaat dicht bij een nieuwe zoekterm of sortering.
`zetToon` (een kaart die op het deck bewerkt en bewaard is) zoekt het nummer
in ALLE geladen pagina's, niet alleen wat in beeld is; staat het in geen enkele,
dan komt het later van de server, die de kaart dan al heeft.

## Hotcues per nummer

Zoals de sampler-pads (schema v4), maar dan zonder herinnering: bij het laden
staan ze meteen op het deck.

- Tabel `hotcues (track_id, nr, tijd, gemaakt)`, `ON DELETE CASCADE`; `nr` 1..8
  (het deck heeft er nu 4; ruimte als dat ooit meer wordt).
- `GET /api/library/<id>/hotcues` → `{ hotcues: [{ nr, tijd }] }`,
  `POST` `{ nr, tijd }` (tijd = seconden tracktijd, ≥ 0), `DELETE .../hotcues/<nr>`.
- Het deck (regel 1: kent geen library) meldt `'hotcue'` `{ i, tijd }` bij
  zetten en wissen (tijd null), niet bij springen en niet bij laden. En
  `restoreHotcues(tijden)` vult alleen LEGE plekken, meldt niets (anders zou
  terugzetten weer bewaren) en laat de plekken meteen vastpinnen.
- `src/ui/hotcue-opslag.js` doet de rest:
  - welk nummer op een track staat houdt het ZELF bij: `'load'` van het deck =
    onbekend, tot `haalHotcues` (vanuit laden.js) het zegt. `staat.deckTrack`
    wordt pas gezet na de golfvorm; een hotcue in dat gat ging anders naar het
    VORIGE nummer;
  - wat je in die tijd, of tijdens het ophalen, zelf zet of wist wint van de
    server en gaat er alsnog heen;
  - verzoeken gaan één voor één: "zetten en meteen wissen" kwam anders in
    omgekeerde volgorde aan en dan stond de hotcue er de volgende keer weer;
  - een los bestand of de demo: niets bewaard (zoals bij de sampler);
  - mislukt bewaren of ophalen: een foutmelding onderaan (`meld`).
- Een mislukte laad laat de oude track met zijn hotcues staan (zoals al zo
  was); die blijven ook bij het oude nummer horen.

## Schema

Eén element achteraan `SCHEMA`: tabel `hotcues`, kolom `titel_sleutel` (gevuld
bij de migratie met `sorteertitel()`, bijgehouden in `bewaarTrack`), en een
index per sorteerkolom. Samengevoegd met het toonsoort-spoor (25 sep): v6 =
`toon_json`, v7 = dit element. `library.test` bewaakt die volgorde; verder
leunen de tests op `SCHEMA.length`, niet op een vast versienummer.

`sorteertitel` is een SQL-functie die de Library bij het openen registreert
(`db.function`). Hij zit alleen in de migratie, niet in een index of trigger:
een ander programma (sqlite3, de tools die `library.db` alleen lezen) heeft hem
niet nodig.

## Gemeten

Headless (`tools/headless/library.mjs`, 5002 nummers, 1440×900, swiftshader,
machine zwaar belast: load average ~30):

- paneel open tot de rijen er staan: ~20 ms;
- 23 rijen in de DOM bovenaan, 17 onderaan;
- een scrollbeeld tekenen: p95 3,3 ms, traagst 8 ms (121 stappen door de lijst);
- 50 paginaverzoeken voor de hele lijst;
- controle (25 sep, na de herstellingen): tweede klik bij laden over een
  spelende track, weghalen (eerst vragen; midden in de lijst blijf je staan;
  hotcues gaan mee) ook groen.

Server (in Node, zelfde belasting): een pagina van 100 uit 5000 nummers 7–30 ms,
afhankelijk van de sortering (de ruis van de belasting is groter dan het
verschil); het totaal tellen < 0,1 ms; zonder `aantal` (alles) ~0,6 s. Op een
rustige M1 naar verwachting een fractie daarvan: **niet gemeten**.

## Niet gedaan / niet getest

- Niets in Clay's eigen Chrome, niets op de APC, niets beluisterd.
- Geen action of APC-knop voor sorteren of door de library bladeren: niet
  gevraagd, en de APC-indeling kiest Clay.
- Hotcues horen bij het nummer, maar "quantize voor hotcues" (spoor C) niet
  hier. Raakt dat spoor `deck.hotcue()`, dan bij samenvoegen de twee
  `emit('hotcue', …)`-regels meenemen.
- Tussen het laden van een nummer ('load' van het deck) en het terugzetten van
  zijn hotcues zit het ophalen van de golfvorm en de hotcues (lokaal tientallen
  ms). Druk je in dat gat op een LEGE hotcue, dan zet je hem (jouw handeling
  wint) en overschrijft dat de bewaarde op de server. Laden gaat alleen met de
  muis in het paneel, dus in de praktijk krap; niet veranderd.
- Samengevoegd met het toonsoort-spoor (v6 toonsoort, v7 library). Draai GEEN
  server van `spoor2/library` alleen op Clay's echte `library.db`: die zet zijn
  element als v6, en daarna draait de samengevoegde code de toonsoort-migratie
  nooit (en die van de library nog eens: "bestaat al", de server start niet).
- De pagina-cache vergeet niets zolang de vraag gelijk blijft: wie door alle
  5000 scrolt heeft ze alle 5000 als objecten in het geheugen (~5 MB). De DOM
  blijft klein.

## Backup (2 oktober 2026, ONTBREEKT A6)

`library.db` bevat handwerk dat nergens anders staat: grids op slot, hotcues,
racks, toonsoorten, sampler-pads en je eigen mapping (tabel `instellingen`).
Er is geen Time Machine, dus de server maakt zelf kopieën (`server/backup.js`,
`server/backup-werker.js`).

### Wat hij doet

- **Hoe:** `VACUUM INTO` op een eigen, alleen-lezen verbinding in een
  `worker_thread`. Dat is één leestransactie: een momentopname die klopt, ook
  met wat nog alleen in `library.db-wal` staat. Het bestand kopiëren mist dat
  (de test laat zien dat zo'n kopie de hotcues kwijt is) of pakt een half
  geschreven pagina. In WAL blokkeert een lezer geen schrijver: de server
  bewaart gewoon door. Daarna `fsync` (VACUUM INTO doet dat niet),
  `PRAGMA quick_check` op de kopie (niet in orde = weg en een fout, want dan is
  de library zelf waarschijnlijk beschadigd), en pas dan hernoemen naar de echte
  naam. Een halve kopie (`.bezig-backup-*.db`) wordt de volgende keer opgeruimd.
- **Wanneer:** bij het opstarten, en daarna elk uur, maar alleen als de
  serververbinding sinds de vorige geslaagde backup iets veranderde
  (`Library.wijzigingen()`, SQLite's `total_changes()`). En dan nog alleen
  bewaard als de inhoud anders is dan de nieuwste kopie: VACUUM INTO geeft voor
  dezelfde inhoud byte voor byte hetzelfde bestand (gemeten), dus een SHA-256
  volstaat. Een herstart zonder wijziging, of een hotcue die je zet en weer
  wist, geeft geen nieuwe kopie. Laden zet `laatst_geladen`, dus tijdens een
  set komt er elk uur wel een.
- **Hoeveel:** de laatste 12 (een sessie van 12 uur met elk uur een wijziging)
  plus de nieuwste van elke dag van de laatste 30 dagen: hooguit 42. Een fout
  die je pas na weken merkt (een grid dat stilletjes verdween) is zo nog terug
  te halen. Grootte: ~1,5 MB per kopie bij 500 nummers (~65 MB in totaal),
  ~14,6 MB bij 5000 (~610 MB). Alleen bestanden met de naam
  `library-JJJJ-MM-DD_UU-MM-SS.db` worden ooit weggegooid; iets anders in de map
  blijft staan.
- **Waar:** standaard `backups/` naast de database, dus `media/backups/` (buiten
  git, want `media/` staat in `.gitignore`). `VARVE_BACKUPS=/Volumes/Schijf/varve`
  zet ze ergens anders, bv. op een externe schijf; de map wordt gemaakt. Namen
  in lokale tijd. Een kopie is één los bestand in gewone journal-modus (geen
  `-wal` ernaast).
- **Mislukt** (schijf vol, schijf weg, map is een bestand, kapotte database):
  een regel `[backup] MISLUKT` in het log, een rode tegel in de Controlekamer,
  en de server draait door. De volgende ronde probeert hij het opnieuw. Duurt
  een backup langer dan 2 minuten, dan geldt hij als mislukt.
- **Niet via HTTP:** de witte lijst laat onder `/media/` alleen
  `<id>/audio.wav|video.mp4|peaks.bin|onset.bin` door. `GET /api/backups` geeft
  alleen de stand: `{ laatste: { naam, tijd, bytes } | null, aantal, gekeken,
  fout, foutTijd, bezig }`, geen pad (behalve in de tekst van een fout).

### Gemeten (2 okt, deze container, 4 kernen, rustig)

| | 500 nummers (1,5 MB) | 5000 nummers (14,6 MB) |
|---|---|---|
| VACUUM INTO zelf | ~7 ms | ~40 ms |
| quick_check + SHA-256 op de kopie | ~3 ms | ~24 ms |
| hoofdthread stil als je het daar zou doen | 15–18 ms | 95–110 ms |
| langste hapering hoofdthread met de worker | 3 ms (zonder backup: 2–4 ms ruis) | 4 ms |
| wandtijd van een backup (vooral de worker starten) | 60–150 ms | 130–220 ms |

Daarom de worker: de server levert ook de pagina's van spelende decks
(zie de opmerking over `analyse-werker.js` in CLAUDE.md). Een backup met
honderden schrijfacties ernaast is gemeten: geldig, de schrijvers wachten niet.
Op de M1 met Clay's echte library: **niet gemeten**.

### Terugzetten

Er is bewust geen knop in de app. Met de hand, in de projectmap:

1. **Stop de server** (Ctrl-C in zijn venster). Sluit ook de mixer: die
   probeert anders te bewaren tegen een server die er niet is.
2. **Zet de huidige database opzij, alle drie de bestanden.** De `-wal` en
   `-shm` moeten mee weg: een oude WAL naast een teruggezette database wordt bij
   het openen toegepast en maakt hem kapot.
   ```
   mkdir -p media/opzij
   mv media/library.db media/library.db-wal media/library.db-shm media/opzij/
   ```
   (Een "No such file" voor `-wal` of `-shm` is goed: dan waren ze er niet.)
3. **Kies een kopie** in `media/backups/` (of in `VARVE_BACKUPS`) en kopieer
   hem, niet verplaatsen, zodat de backup blijft staan:
   ```
   cp media/backups/library-2026-10-02_14-05-33.db media/library.db
   ```
   Twijfel je of hij heel is: `sqlite3 media/library.db "PRAGMA integrity_check"`
   moet `ok` zeggen.
4. **Start de server** (`node server/index.js`). Een kopie van een oudere
   schemaversie wordt gewoon bijgewerkt (migraties). Bij het opstarten maakt hij
   meteen een backup van wat je terugzette; de kopieën van ervóór blijven staan.
5. Klopt het niet, dan zet je `media/opzij/` op dezelfde manier terug.

### Wat er NIET in zit

- De bestanden in `media/<id>/` (audio, video, peaks, onset). Een link kun je
  opnieuw binnenhalen; een EIGEN bestand (`lokaal-…`) bestaat alleen nog als die
  omgezette audio en video: van het origineel is er niets bewaard (zie
  "Eigen bestanden" in CLAUDE.md). Dat is een aparte backup (ONTBREEKT).
- Opnames, handelingenlogs, setplannen (`plannen/` heeft zijn eigen `.versies/`)
  en de speellijst van de Controlekamer.
- De mapping in localStorage van de browser (de server-kopie zit er wel in).
- Geen backup VÓÓR een schemamigratie: de server migreert bij het openen en
  maakt pas daarna zijn eerste kopie. De laatste kopie van de oude versie
  (hooguit een uur oud, als er iets veranderde) is dan de terugweg.

### Getest

`test/backup.test.mjs`: namen en opruimen (puur), een echte library met alles
in de WAL (kopie = dezelfde tabellen, quick_check, schemaversie, journal delete,
terug te zetten als `library.db`), geen kopie zonder wijziging (teller, hash, na
een herstart), wel na een wijziging, een backup naast schrijfacties, 40 dagen
opruimen, een halve kopie opruimen, vier soorten mislukken, de tegel van de
Controlekamer, en een echte server: kopie bij het opstarten in `media/backups`,
geen tweede zonder wijziging, wel na `POST /api/mapping`, acht paden naar de
kopieën die allemaal 404 geven, een vreemde Host 403, herstart zonder nieuwe
kopie, een onbruikbare `VARVE_BACKUPS` (server draait door, levert de library)
en een `VARVE_BACKUPS` die nog niet bestaat. NIET getest: op Clay's Mac, met een
externe schijf die tijdens een backup wegvalt, en de tegel in een echte browser
(`tools/headless/controle.mjs` heeft er een check bij, maar is hier niet gedraaid:
geen Chromium in de container).
