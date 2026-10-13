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
- bpm SORTEERT op het eerste stuk van het grid (`grid_bpm`). De kolom TOONT sinds 13 okt het
  hoofdtempo (`libraryBpm` in grid-strook.js): alleen de zekere stukken, gewogen naar lengte, binnen
  3% één tempo, half/dubbel hetzelfde. "~84.7" = drift (een stuk > 1% van het gemiddelde, live
  gespeeld), "128 / 117" = een tweede tempo dat ≥ 25% van de zekere tijd klinkt, "64.6?" = geen
  zeker stuk. Vroeger stond er "wisselend" bij elke afwijking > 0,5%, ook van een onzeker stuk:
  61 van de 69 nummers. **Grens:** sorteren en tonen kunnen bij een nummer dat met een ander tempo
  begint uit elkaar lopen; sorteren op het hoofdtempo vraagt een kolom op de server.
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

Zo kwam de stems-kolom erbij (3 okt, `docs/STEMS.md`): kolom `stems` tussen grid
en LUFS, 84 px, niet sorteerbaar. De cel (`stemsCelHtml`, puur) zegt `—`, `2`, `4`,
`wacht`, `42%` of `fout` en heeft knoppen 2 · 4 · ×. Het paneel werkt bij elke
peiling van `GET /api/stems` alleen de stems-cellen bij, en niet terwijl je in de
lijst drukt (een knop die tussen indrukken en loslaten vervangen wordt, krijgt in
Chrome geen klik).

## Schema

Eén element achteraan `SCHEMA`: tabel `hotcues`, kolom `titel_sleutel` (gevuld
bij de migratie met `sorteertitel()`, bijgehouden in `bewaarTrack`), en een
index per sorteerkolom. Samengevoegd met het toonsoort-spoor (25 sep): v6 =
`toon_json`, v7 = dit element, v8 = `stems_json` (3 okt, stems). `library.test`
bewaakt die volgorde; verder leunen de tests op `SCHEMA.length`, niet op een
vast versienummer.

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

## Waar media/ staat (11 oktober 2026, VI2)

`media/` (de nummers, `library.db`, `backups/`, `kaart.db`, `nacht.json`, `stems-rij.json`)
hoort buiten iCloud: een uitgeplaatst bestand laat de server bij de eerste lezing hangen tot het
hele bestand binnen is (3,9 GB voor een `stems.wav`; zonder internet nooit), en iCloud is geen
backup (het synchroniseert ook wissen). Stand 11 okt: 32 GB in de Bureaublad-map, niets
uitgeplaatst.

- **Welke map** (`server/media-plek.js`, `kiesMedia`): `VARVE_MEDIA`; anders
  `<projectmap>/media`; is die er niet meer, dan het pad uit `media-VERHUISD.txt` in de projectmap
  (het briefje dat het verhuistool achterlaat; vangnet, een testserver volgt het nooit).
- **De library** staat standaard IN die map (`VARVE_DB` verlegt hem nog steeds). Tot 11 okt was
  dat altijd `<projectmap>/media/library.db`, ook met `VARVE_MEDIA`.
- **Paden in de database zijn relatief** (`media/<id>/audio.wav`, ook video, peaks, onset en
  `stems.bestand`): `alsPad()` schrijft ze zo, `opSchijf()` legt ze op `MEDIA`, en de statische
  route `/media/<id>/…` gaat ook via `opSchijf()`. Verhuizen breekt dus niets. Absoluut in de
  instellingen staat alleen `kaart_pad` (de muziekkaart, buiten `media/`). Het tool telt het na
  op de echte database (alleen lezen) en weigert als er een pad niet met `media/` begint.
- **Bij het starten** logt de server `[media] <map> (waarom); library <pad>`, en een
  waarschuwing als een van beide binnen iCloud ligt (`~/Library/Mobile Documents`, of `~/Desktop`
  / `~/Documents` als "Bureaublad- en Documentenmappen" in iCloud aan staat; dat zie je aan
  `~/Library/Mobile Documents/com~apple~CloudDocs/Desktop`).
- **Testserver** = `VARVE_TESTSERVER=1` (stems en tellen uit tenzij een nep- of echt commando
  gezet is). Tot 11 okt las de server dat af aan `VARVE_MEDIA`; met Clay's map buiten iCloud zou
  zijn eigen server dan geen stems meer maken. Elke testserver in `test/` en `tools/headless/`
  zet de vlag (`test/media-verhuis.test.mjs` bewaakt dat).
- **Verhuizen:** `node tools/media-verhuis.mjs` (droogloop: bron, doel, grootte, iCloud, server,
  paden in de db, backups), dan met de server uit `--doe`: hernoemen naar `~/Varve-media`
  (zelfde schijf, geen kopie, niets gewist), `media-VERHUISD.txt` waar `media/` stond, en de
  regels voor `~/.zprofile` en `~/.varve/media-pad`. VARVE.app leest beide (de login-shell leest
  `.zprofile`; `media-pad` gaat voor). Het plan voor Clay's map: HANDOFF.
- **Backups buiten de laptop:** `VARVE_BACKUPS` naar een externe SSD, die er nog niet is; tot dan
  staan de kopieën van `library.db` naast de library en is er van de media zelf geen tweede kopie.
- **Niet getest:** de verhuizing van de echte map (de rename uit een door iCloud beheerde map),
  VARVE.app opnieuw gebouwd en echt gestart, `find -flags +dataless` op een echt uitgeplaatst
  bestand. Niet verhuisd door het tool: `opnames/` (`VARVE_OPNAMES`), `patronen/`, `proef/`.

## De kaart-tab (10 oktober 2026, tak `studio/kaart-ui`)

De muziekkaart (`~/Projects/muziekkaart`, contract: scratchpad `CONTRACT-KAART.md`)
als ZOEKLAAG in het library-paneel: een tweede tab `library | kaart`. De kaart
kent 18.233 nummers (9.753 YouTube-video's en 8.480 Spotify-nummers zonder video;
het contract zei 18.763) en de playlists als kratten; Varve haalt er niets van
vanzelf binnen. Per nummer of per krat zet je iets op de wenslijst; de
nachtwachtrij van de server (`server/nacht.js`, `docs/KAART.md`) haalt dat
's nachts binnen, alleen audio. De serverkant (`/api/kaart`, `/api/nacht`) is op
`studio/kaart-server` gebouwd; sinds het samenvoegen (`studio/kaart`, 10 okt)
staat alles bij elkaar en is de nep-server alleen nog voor ontwikkeling.

### Wat er is

- `src/ui/kaart-lijst.js`: puur rekenwerk, getest in `test/kaart-lijst.test.mjs`
  (115 checks). Kolommen (artiest, titel, duur, beurten, laatst, bronnen, stand)
  in dezelfde vorm als `KOLOMMEN` van de library, zodat `kopHtml`, `cellenHtml`
  en `kolomSjabloon` van `library-lijst.js` ze ongewijzigd tekenen. Badges
  (♥ eigen like, ⇄ overzet, ≡ playlist, ▶ gekeken, ♫ alleen Spotify), de stand
  van een nummer (`standVan`: binnen → laadknoppen; wens → tekst; kandidaat →
  "haal binnen"; geen video → "zoek") en de knop erbij (`standCelHtml`), de
  filters (`niet binnen` en `binnen` sluiten elkaar uit), de url van een pagina
  (`kaartUrl`), de kratkiezer, de bevestiging boven 20 (aantal × 50 MB), de
  zekere zoekkandidaat (score ≥ 0,9) en het kieslijstje, de teksten en de
  gedeeltelijke POST van de nachtwachtrij. Eigen sleutels in localStorage:
  `varve.library.tab` (welke tab) en `varve.kaart.sortering`.
- `src/ui/kaart-panel.js`: de tab, op dezelfde `PaginaCache` en virtuele lijst
  als de library. `library-lijst.js` is NIET veranderd: `alsPagina` zet het
  antwoord van `/api/kaart/nummers` om in de vorm van `/api/library`, met `id`
  = sleutel. Zoeken (120 ms wachten), kratkiezer, filterknoppen, sorteren op de
  kolomkop, "haal binnen" (`POST /api/kaart/wens` met `meteen: true`, daarna
  de rij opnieuw ophalen), laden van een nummer dat binnen is (via
  `library.laadTrack`, zelfde weg als de ingest-strook, met de tweede klik over
  een spelende track), "zoek" (kandidaten; ≥ 0,9 meteen `kies`, "gekozen: …"
  met "anders"; anders een kieslijstje dat onder zijn rij zweeft, zoals de
  toonsoortkiezer), × bij een wens die wacht (`DELETE`), de krat-knop (haalt de
  sleutels `niet-binnen` op in pagina's van 500, vraagt boven 20 eerst "ja"
  in de statusregel, stuurt dan `bevestig: true`), en het blok Nachtwachtrij
  (aan/uit, per nacht, venster, vandaag niet, laatste run, wenslijst-telling).
- "Er speelt een deck": `stand(deck)` van het library-paneel (uit laden.js),
  elke seconde nagekeken zolang de tab open is; dan staan "haal binnen" en
  "zoek" uit met de uitleg in de tooltip, en de server zou toch 409 geven.
- Peilen (`/api/nacht` en `/api/kaart/wensen`) elke 5 s, ALLEEN met het paneel
  open én de tab op kaart (`open`). De wensen gaan in de rijen die er zijn en
  alleen de stand-cellen worden bijgewerkt (niet terwijl je in de lijst drukt,
  zoals de stems-cellen). Een wens die klaar werd ververst de lijst.
- Kop en rijen van de kaart bestaan alleen zolang haar tab open staat; bij het
  wisselen naar de library worden ze leeggemaakt. De library (en
  `tools/headless/library.mjs`) zoekt op `.lib-kop`/`.lib-rij` in het hele
  paneel en mag niets van de kaart tegenkomen.
- De stand-kolom is vast 276 px: elke rij is een eigen grid, dus met
  `max-content` lag die kolom per rij ergens anders en de kop er niet boven.
- `index.html`: de tabs in `.lib-head`, en `.kaart-deel` (eigen kop, status,
  lijst, nachtblok) achter `.lib-rijen`. `styles.css`: `.lib-panel.tab-kaart`
  verbergt wat van de library is. Geen APC- of Maschine-knoppen, geen action.

### De nep-server

`tools/headless/kaart-nep.mjs` (geen test zelf): de API uit contract deel 2 in
het geheugen, op een `varve-kaart.json` (`test/fixtures/varve-kaart.klein.json`:
40 verzonnen nummers, 3 kratten, verzonnen namen, geen echte
luistergeschiedenis). Alles buiten `/api/kaart*` en `/api/nacht*` gaat door
naar een echte Varve-server op `doel` (Host en Origin herschreven). "Zoek"
geeft drie verzonnen kandidaten (zeker alleen bij een eigen like), "haal
binnen" laat de wens op `bezig` staan (`rondAf()` maakt hem klaar). Niets van
YouTube, geen yt-dlp. `test/kaart-lijst.test.mjs` toetst de nep tegen het
contract (sorteren, filters, 409 boven 20, 409 met een spelend deck, zoek/kies,
nacht), zodat de UI tegen hetzelfde praat als straks de echte server.

### Headless

`node tools/headless/kaart.mjs [uitmap]`: echte server op 8815 met drie nummers
van de kaart al binnen (id = youtube_id), de nep op 8816 ervoor, Chrome via
CDP. Groen op 10 okt (65 checks): paneel open, tab kaart (rijen na ~20 ms),
tab onthouden, ≤ 30 rijen in de DOM, kop boven de kolommen, kratkiezer met
aantal en binnen, badges, nachtblok; zoeken filtert; krat en filters; sorteren
op titel/laatst/beurten en onthouden; "haal binnen" stuurt precies
`{ sleutels: [die], meteen: true, bevestig: false }`, de rij zegt bezig, na
klaar binnen met laadknoppen; laden op track 1; met een spelend deck staan
haal/zoek uit en vraagt laden eerst; zoek met kieslijstje onder de rij, kies,
de zekere keuze zonder lijstje, "anders"; de krat op de wenslijst met de
bevestiging (36 × 50 MB = 1,8 GB), nee/ja, × van de wenslijst; het nachtblok
stuurt `{ aan }`, `{ perNacht }`, `{ venster }`, `{ vandaagNiet }`; geen
peiling met de tab dicht, wel met de tab open; na herladen opent het paneel op
de kaart. Foto's in de uitmap (`kaart-open.png`, `kaart-kieslijst.png`, …).

### De afspraken met de server (samengevoegd 10 okt, `studio/kaart`)

De punten waar de UI iets anders verwachtte dan het contract zei, zijn bij het
samenvoegen rechtgetrokken; de keuzes en de tests staan in `docs/KAART.md` §3b.
Kort, voor wie aan de UI werkt:

- `POST …/kies` zonder wens maakt er een (`wacht`): de server deed dat al.
- `GET /api/kaart/nummer/<sleutel>` geeft `{ nummer }`: `_vernieuwRij` leest
  `j.nummer ?? j`. De sleutel gaat percent-gecodeerd (`yt%3A…`); de server
  decodeert.
- `GET /api/kaart/wensen[].track` is een object met `id` of null; de UI leest
  het niet (de laadknoppen komen van `binnen` per rij).
- `sorteer=krat`: met een krat gekozen staat vooraan de kolom `krat` (`KRAT_KOLOM`,
  `kolommenVoor`), sorteerbaar, met het rangnummer zolang daarop gesorteerd is
  (`staat.volgnr` per rij uit het paneel). Een krat kiezen met de standaardsortering
  schakelt naar de kratvolgorde (`sorteringBijKrat`); zonder krat valt `krat` terug
  op beurten (`effectieveSortering`), want de server geeft dan 400.
- 409-teksten letterlijk: `meer dan 20`, `er speelt een deck`.
- De krat-knop blijft de sleutels zelf ophalen (`niet-binnen`, pagina's van 500);
  `sp:`-sleutels komen mee en gaan op `wacht`.
- De kratnaam komt uit het bestand ("Proefkrat", "Vertrouwd").
- Het nachtblok toont de speeldagen (`speeldagenTekst`: "10 okt (vandaag)").
- De nep (`kaart-nep.mjs`) geeft dezelfde vormen als de server (redenen,
  `{ nummer }`, `track` als object, `gestart`, 202 op `nacht/nu`, `sorteer=krat`).

Headless tegen de echte routes: `node tools/headless/kaart-echt.mjs [uitmap]` (de
server start je zelf, met een kopie van de library en de nep-yt-dlp; de regels
staan bovenin het script en in `docs/KAART.md` §9). Groen op 10 okt op het echte
bestand (18.233 nummers): 31 checks, tab → rijen 62–80 ms, zoeken 158 ms, "haal
binnen" 2,0 s door de echte wens-route en de nep-ingest zonder video.

### Niet gedaan / niet getest

- Niets in Clay's eigen Chrome, niets op de APC of de Maschine, niets beluisterd.
- Niet met een deck dat echt streamt in Chrome tegen de echte routes (de
  30 s-regel): in de nep-headless komt "er speelt een deck" van de engine-stand,
  in de servertest van een Range-verzoek met curl.
- De tijdvelden van het nachtblok zijn `<input type="time">`: in een Engelse
  Chrome tonen ze "01:00 AM"; de waarde is altijd "01:00".

## Past bij (13 okt)

De knop **past bij** in de balk van de library (naast zoeken) toont in plaats van de lijst welke
nummers goed of bijna goed mixen met het nummer op de **focus-track**. Rekenwerk in
`src/ui/past-bij.js` (puur, `test/past-bij.test.mjs`), met de regels van de auto-DJ
(`kiesOvergang` in `src/auto/planner.js`): beide grids zeker, en de toon vergeleken NA het
gelijkzetten van het tempo (zonder keylock schuift die mee).

- **goed**: tempo ≤ 6% en toon gelijk of één stap op het Camelot-wiel.
- **bijna**: tempo ≤ 6% met toon twee stappen (keylock en ±1 transponeren), tempo 6–10% met toon
  ≤ 1 (ver pitchen, keylock aan), of half/dubbel tempo (≤ 6%) met toon ≤ 1.
- Een gegokte toon (bijna de hele library is "onzeker") telt mee, maar staat erbij ("toon gegokt",
  een ? achter de toon) en zakt onder een zekere. Het tempo telt alleen op een zeker grid.
- Speelt de focus-track, dan telt het tempo en de toon van waar hij NU is; anders van vlak vóór het
  eind van zijn fragment (wat er NA dit nummer komt). Is het grid daar onzeker (een outro zonder
  beat), dan het midden van het langste zekere stuk ("gemeten op het zekere deel").
- De inkomende wordt gemeten aan het begin van zijn fragment (zoals de auto-DJ hem zou starten).
- Zolang de knop aan staat en het paneel open is, kijkt het paneel elke seconde of de focus-track
  of zijn nummer veranderde en rekent dan opnieuw (de hele library, één verzoek). Laden uit de lijst
  gaat zoals in de gewone lijst, met de tweede klik over een spelende track.
- Headless: `tools/headless/past-bij.mjs` (eigen server, eigen library, geen MIDI).

