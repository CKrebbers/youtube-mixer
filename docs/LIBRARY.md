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

### Een kolom erbij (toonsoort)

1. Een regel in `KOLOMMEN` (`src/ui/library-lijst.js`): `id`, `kop`, `breedte`,
   `klasse`, `cel(t)`, eventueel `hint(t)`.
2. Sorteerbaar? Dan ook `sorteer: 'toon'`, een sleutel in `SORTERINGEN`
   (library-lijst.js) en in `SORTERING` (server/library.js) met een index in
   het schema. `library-lijst.test` controleert dat die twee gelijk zijn.

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
index per sorteerkolom. Het toonsoort-spoor voegt tegelijk een element toe;
bij samenvoegen is het alleen de volgorde van twee elementen. De tests leunen
op `SCHEMA.length`, niet op een vast versienummer.

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
- Samenvoegen met het toonsoort-spoor: allebei een element achteraan `SCHEMA`.
  Draai GEEN server van één van beide sporen op Clay's echte `library.db`
  vóór het samenvoegen: staat zijn database dan op v6 van het ene spoor en
  wordt de volgorde na het samenvoegen andersom, dan draait de migratie van
  hetzelfde spoor nog eens (fout "bestaat al": de server start niet) en die van
  het andere nooit.
- De pagina-cache vergeet niets zolang de vraag gelijk blijft: wie door alle
  5000 scrolt heeft ze alle 5000 als objecten in het geheugen (~5 MB). De DOM
  blijft klein.
