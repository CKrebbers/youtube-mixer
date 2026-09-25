# Controle ROADMAP 21a — library (spoor/library → spoor2/library)

Controleur, 25 september 2026. Branch `spoor2/library` (afgetakt van
`spoor/library`, 5 commits van de bouwer + 7 van de controle). Niet gemerged,
niet gepusht; aan het eind `git switch --detach`.

## Is het af?

Ja. Alles uit de opdracht zit erin en werkt:

1. **Meer dan 200.** De grens zat op de server: `tracks({ limiet = 200 })` met
   `LIMIT 200`, zonder totaal; ook het opstartbericht telde daarmee. Nu
   `GET /api/library?zoek=&sorteer=&richting=&van=&aantal=` → `{ tracks,
   totaal, van }`, pagina's van hooguit 500, zonder `aantal` alles (voor
   tools/beatmeting). Het paneel is een virtuele lijst (vaste rijhoogte 28 px,
   ruimte zo hoog als de lijst, ~20 rijen in de DOM) met een pagina-cache van
   100 per verzoek.
2. **Sorteren** op titel, bpm, duur, toegevoegd, gespeeld: klik op de kop,
   nog eens = omgekeerd, onthouden in localStorage. Titel op een vooraf
   berekende sleutel (accenten weg, getallen op waarde), NULL (geen grid, nooit
   geladen) altijd achteraan, gelijkspel op toegevoegd + rowid (stabiel,
   pagina's overlappen nooit). Gespeeld = `laatst_geladen` van
   `POST /api/library/<id>/geladen`.
3. **Hotcues per nummer**: tabel `hotcues` (CASCADE), GET/POST/DELETE-routes,
   het deck meldt `'hotcue'` alleen bij zetten/wissen (niet bij springen of
   laden), `restoreHotcues()` vult alleen lege plekken, meldt niets en vult de
   StreamBron meteen bij. `src/ui/hotcue-opslag.js` houdt zelf bij welk nummer
   op een track staat, zet wat je tijdens het laden deed alsnog door, en
   stuurt verzoeken één voor één. Losse bestanden en demo: niets bewaard.
   Mislukte laad: hotcues blijven (engine-test). Regel 1 blijft (regels.test).
   Schema: één element achteraan `SCHEMA`; tests op `SCHEMA.length`. Kolom
   erbij (toonsoort): één regel in `KOLOMMEN` (+ sortering op twee plekken, een
   test bewaakt dat ze gelijk zijn).

## Bevindingen

| # | Ernst | Wat | Hersteld |
|---|---|---|---|
| 1 | middel | `PaginaCache.zorgVoor` keek alleen naar de generatie. Scrollen terwijl een nieuwe vraag (klik op kop, zoeken) al vertrokken was: zorgVoor had de generatie van de nieuwe maar de OUDE vraag; kwam de nieuwe eerst terug, dan viel een pagina van de vorige sortering er alsnog in, met zijn totaal (test: 250 i.p.v. 30). | ja, 6c7b607 (test faalt op oude code) |
| 2 | laag-middel | `?sorteer=constructor/toString/__proto__` kwam door de controle (`SORTERING[x]` bestaat via Object) → SQL "ORDER BY undefined" → 500. Geen injectie. Paneel had hetzelfde met `in`: een bewaarde sortering "toString" gaf een lijst die nooit laadde. | ja, d26b6f9 (`isSortering` / `Object.hasOwn`; 3 tests falen op oude code) |
| 3 | laag | `van | 0` rekent in 32 bits: `?van=4294967297` gaf rij 1 e.v., 2^31 gaf rij 0. | ja, b60fd65 (`Math.trunc` + geklemd; route `Number.isSafeInteger`) |
| 4 | laag | Gat tussen 'load' en terugzetten (golfvorm + GET hotcues, tientallen ms): een LEGE hotcue indrukken zet hem en overschrijft de bewaarde op de server. | nee, gedocumenteerd (laden gaat alleen met de muis; krap) |
| 5 | laag | Hotcue indrukken in de laatste ms van `laadStream` (na de WAV-kop, vóór `_naLaden`) zet hem in de hotcue-lijst van het OUDE nummer, met positie ~0, en bewaart hem daar. | nee, gemeld (zeer krap venster) |
| 6 | info | Samenvoegen met toonsoort: beide een element achteraan SCHEMA. Draait een spoor-server vóór het samenvoegen op Clay's echte library.db, en komt de volgorde andersom, dan draait dezelfde migratie twee keer ("bestaat al", server start niet) en de andere nooit. | gedocumenteerd in docs/LIBRARY.md |
| 7 | info (bestaand, niet van dit spoor) | laden.js: mislukt een tweede laad op dezelfde track terwijl de eerste nog op de golfvorm wacht, dan staat de eerste op het deck zonder `deckTrack`/hotcue-nummer (grid gaat naar het vorige nummer). | nee, buiten dit spoor |

Toegevoegde controles zonder bug: migratie vanaf v5 MET data (5038f9b),
StreamBron-vastpinnen na `restoreHotcues` (1779361), headless: tweede klik
over een spelende track en weghalen (26bb7c5).

## Migratie op een kopie van Clay's database

`media/library.db` + `-wal` gekopieerd naar de scratchpad (alleen gelezen),
gemigreerd met de spoorcode: v5 → v6 in 2,6 ms, 10 nummers, 10 peaks, 1 rack,
1 pad; elke rij gelijk op `titel_sleutel` na, sleutel = `sorteertitel(titel)`,
integrity_check ok, foreign_key_check leeg, pagina's (per 7) = de hele lijst
voor elke sortering, opnieuw openen migreert niet.

## Headless (tools/headless/library.mjs, poorten 8863/9463, 5002 nummers)

Alles groen, twee keer. Open 26 ms na klik, 18 rijen in de DOM, scrollbeeld
p95 2,4 ms / traagst 3,3 ms, 50 paginaverzoeken voor de hele lijst, sorteren
op elke kop = API, zoeken, sortering na herladen, hotcues bewaard / gewist /
terug (ook op een andere track), gespeeld, tweede klik over spelende track,
weghalen (vraag, weg met hotcues, midden in de lijst blijf je staan), geen
consolefouten. Schermafdrukken bekeken: kolomkop sluit aan, pijl bij de
actieve kolom, datums, geladen tracks gemarkeerd.

## Tests

`nice -n 10 node test/alles.mjs` op de eindstand: 30 bestanden, 2083 checks,
alles groen (library 126, library-lijst 60, server 80, engine 410, upload 24,
ingest 30, regels 27). Onder load ~26, geen timing-rood. De nieuwe tests van
#1–#3 zijn op de oude code rood gezien (patch eraf, test, patch terug).

## Niet getest

- Niets in Clay's eigen Chrome, niets op de APC, niets beluisterd.
- De race (#1) alleen in de unit-test, niet headless (timing).
- Snelheid op een rustige M1 (alles gemeten onder load ~26).
- 50.000 nummers.
- Samenvoegen met het toonsoort- en ingest-wachtrij-spoor.

## Voorstel CLAUDE.md-tekst

- Library (21a, 25 sep): de lijst is PAGINA'S van de server
  (`GET /api/library?sorteer=&richting=&van=&aantal=` → `{tracks, totaal, van}`,
  hooguit 500; zonder `aantal` alles) en het paneel tekent alleen zichtbare
  rijen (`library-lijst.js`, puur). Sorteren alleen op eigen sleutels van
  `SORTERING` (`isSortering`), NULL altijd achteraan, gelijkspel toegevoegd +
  rowid; titel op `titel_sleutel` (vooraf, `sorteertitel`). Een kolom erbij =
  `KOLOMMEN` + `SORTERINGEN` + `SORTERING` + index.
- Hotcues horen bij het NUMMER (tabel `hotcues`, zoals de pads): het deck meldt
  `'hotcue'` alleen bij zetten/wissen, `restoreHotcues()` vult alleen lege
  plekken, meldt niets en pint meteen; `hotcue-opslag.js` bewaart, één verzoek
  tegelijk; los bestand/demo niets.
