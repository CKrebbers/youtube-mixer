# Integratie ronde 1 — 25 september 2026

Branch **`integratie-r1`** (afgetakt van `integratie` e0b9e41), eindcommit
**e5ca616**. Niet gepusht, niet naar main, `integratie` zelf niet verzet. Aan het
eind `git switch --detach`; de branch blijft staan.

## Commits

| commit | wat |
|---|---|
| 0984a3c | merge `spoor2/toonsoort` (afstammeling, geen conflict) |
| 78d214b | merge `spoor2/mapping-verschil` (afstammeling, geen conflict; eerste poging gaf `fatal: stash failed`, tweede ging gewoon) |
| 4dea2a3 | merge `spoor2/library` met de conflictoplossingen hieronder |
| 6aa7313 | naadtests: toon-kolom in library-lijst.test, toon in een PAGINA van /api/library (toon.test) |
| 5533585 | headless: toon.mjs-mock pagineert; toon-keten kijkt naar hotcues in het gat |
| e5ca616 | kiezer schuift in beeld in het lage paneel; library.mjs "toonsoort in de lange lijst" |

## Conflicten (spoor2/library)

- **server/library.js, SCHEMA**: toonsoort als v6 (`ALTER TABLE tracks ADD
  COLUMN toon_json`), library als v7 (tabel `hotcues`, `titel_sleutel` + vullen
  met `sorteertitel()`, vijf indexen). Elk een eigen element. Commentaar zegt
  nu welke versie wat is, en waarom je geen spoor-server op de echte db draait.
- **server/library.js, `_verrijk`**: de nieuwe rijvorm van library (racks en
  peaks uit de ene `RIJ`-query, `titel_sleutel`/`_rij` eruit) met `toon:
  this._toon(r)` erbij. Alle lijst- en trackroutes gaan door `_verrijk`, dus
  `toon` zit in `/api/library` (hele lijst én pagina's) en in `GET
  /api/library/<id>`.
- **server/index.js**: alleen de import (beide sets namen). Routes van beide
  kwamen automatisch goed samen (`/toon`, `/toon/analyseer`, `/hotcues`).
- **src/ui/library-panel.js**: basis = het nieuwe paneel van library
  (PaginaCache, alleen zichtbare rijen, sorteren op de kop). Daarin van
  toonsoort: `onToon`, `kiezer`, klik op `data-toon`/`data-tk`, `kiesToon`,
  `kiezerHtml`, `zetToon`, en ↻ = grid én toonsoort (tweede klik als een van
  beide op slot staat, `forceer` voor beide). Overal `this._track(id)` (zoekt in
  alle geladen pagina's + `extra`) i.p.v. `this.tracks.find`. Nieuw:
  `_werkBij(track, veld, waarde)`: na een await ook het object bijwerken dat
  intussen in een nieuwe pagina staat (ververs na een ingest).
- **src/ui/library-lijst.js** (geen tekstconflict, wel nodig): kolom `toon`
  tussen bpm en grid, 86 px, niet sorteerbaar; `cel(t, nu, staat)` met
  `staat.kiezer` voor de `open`-markering; libraryToon per kaart-object in een
  WeakMap (zoals gridInfo). `cellenHtml(t, nu, staat = {}, kolommen)`.
- **De kiezer in een lijst die alleen zichtbare rijen tekent**: niet meer
  tussen de rijen (dat brak de vaste rijhoogte: alles eronder versprong zodra
  zijn rij uit het getekende stuk scrollde), maar absoluut onder zijn rij in het
  venster (`top = (i - van + 1) × 28`), over de rijen eronder heen, met eigen
  achtergrond en schaduw. Dicht bij nieuwe zoekterm/sortering. Opent hij onder
  een van de onderste rijen van het lage paneel, dan schuift de lijst zover dat
  hij in beeld staat (`_kiezerInBeeld`, e5ca616).
- **styles.css**: library-kant (kolommen via `--lib-kolommen`), plus
  `.lib-toon-cel` en de zwevende `.lib-toonkiezer`.
- **test/library.test.mjs**: beide migratieblokken behouden. Ze schreven allebei
  naar `v5.db` (het tweede zou op een al gemigreerde db `CREATE TABLE` doen):
  het toonblok heet nu `v5-toon.db`. De v5-met-data-vergelijking laat
  `toon_json` én `titel_sleutel` buiten de vergelijking en eist dat
  `toon_json` overal null is, `hotcues` leeg, en dat elk nummer in
  `teToonAnalyseren()` staat. Nieuwe check: SCHEMA[5] = toon_json, SCHEMA[6] =
  hotcues + titel_sleutel (bewaakt de volgorde).
- **tools/README.md, docs/LIBRARY.md**: beide; LIBRARY.md zegt nu hoe de
  toon-kolom en kiezer in de lijst zitten en dat v6/v7 vastligt.

## Naden (geen tekstconflict)

- **laden.js**: toonsoort zet `deckTrack[deck] = null` zodra `laadStream`
  slaagt; library bewaart hotcues via `hotcue-opslag.js`, dat NIET op
  `deckTrack` leunt maar zelf per deck het nummer bijhoudt ('load' = onbekend,
  `haalHotcues` aan het eind van onLaad = bekend; wat in het gat gezet wordt
  wacht en gaat dan naar het nieuwe nummer). Samen dus goed. Headless bewezen
  (toon-keten, peaks van het tweede nummer 2,5 s vertraagd): hotcue 1 op nummer
  1; nummer 2 over dezelfde track; in het gat hotcue 2 → server: nummer 2 heeft
  `2@12.00`, nummer 1 alleen `1@30.00`; hotcue blijft op het deck; na herladen
  komt hotcue 1 van nummer 1 terug op een andere track, de hotcue uit het gat
  niet. Grid en toonsoort van nummer 1 blijven ook staan.
- **zetToon in de virtuele lijst**: vindt het nummer in alle geladen pagina's,
  ook buiten de DOM (headless: rij 2400 van 5000, na scrollen staat "8B C" met
  slot in zijn rij). Staat het in geen geladen pagina, dan niets (de pagina komt
  later van de server, die de kaart dan al heeft: zetToon wordt pas na een
  geslaagde POST aangeroepen).
- **/api/library in pagina's met toon**: toon.test haalt een pagina
  (`sorteer=titel&van=1&aantal=2`) en vergelijkt de kaarten met de hele lijst.
- **↻ in het nieuwe paneel**: toon-keten klikt ↻ twee keer over een slot in het
  nieuwe paneel; grid en toonsoort weer auto, track toont het meteen.
- **tools/headless/toon.mjs**: de nep-library gaf alleen `{ tracks }`; het nieuwe
  paneel las `totaal` 0 en bleef leeg. Mock pagineert nu (29/29).
- **tools/beatmeting, gridauto.test, upload.test, toon-keten**: vragen
  `/api/library` zonder `aantal` = alles; blijft werken.
- mapping-verschil raakt niets van beide (geen gedeelde bestanden; de
  standaardmapping is door niemand veranderd, dus `base` klopt).

## Tests

- `nice -n 10 node test/alles.mjs` na de merge én op de eindstand: **32
  bestanden, 2357 checks, alles groen** (geen timing-rood). library 149,
  library-lijst 66, toon 46, server 91, engine 410, mapping 209.
- Nieuwe checks: library.test (volgorde v6/v7, toon_json leeg, hotcues leeg na
  migratie v5→v7), library-lijst.test (6 over de toon-kolom), toon.test (pagina).

## Headless (poorten 8881/9481, na elkaar)

- `kijk.mjs`: alles groen.
- `toon-keten.mjs`: 27/27 (was 22; +5 over hotcues in het gat), twee keer.
- `library.mjs` (5002 nummers): alles groen, met het nieuwe blok "toonsoort in
  de lange lijst" (kiezer onder zijn rij, rijen eronder op 28 px, in beeld
  geschoven, mee met scrollen, weg/terug buiten het getekende stuk, ×,
  zetToon buiten beeld, zetToon onbekend, kiezer op de laatste rij).
  Eerste poging van dat blok faalde door de TEST (las de laatste rij voordat de
  rijen van onderaan getekend waren); wachten op de juiste rij, groen.
- Extra `toon.mjs` (nep-library, mock aangepast): 29/29.
- Schermafdrukken bekeken: keten-library (kolom TOON tussen BPM en GRID, "8A Am",
  "5B E♭ +1"), toon-library (album +3, ~, slot in accentkleur, —), toon-kiezer
  (24 knoppen, zwevend onder de rij), library-open (5002 nummers, kolom past op
  1440), library-kiezer (midden in de lijst, in beeld geschoven),
  library-kiezer-onderaan (laatste rij, helemaal zichtbaar).

## Migratie op een kopie van Clay's database

`media/library.db` (4 kB) + `-wal` (1,6 MB; nooit gecheckpoint) met `cp`
gekopieerd naar `scratchpad/r1-db/bron`, sha1 identiek aan het origineel; het
origineel na afloop nog steeds dezelfde sha1. Script `scratchpad/r1-db/migreer-r1.mjs`:

- voor: schema v5, 10 nummers, 10 peaks, 1 rack, 1 pad, 1 instelling (de
  mapping), integrity ok.
- migratie v5 → v7 in 6 ms; integrity_check ok; foreign_key_check leeg; elke
  tabel evenveel rijen; elke rij van elke tabel gelijk (tracks buiten de twee
  nieuwe kolommen); toon_json null in alle 10; titel_sleutel = sorteertitel;
  hotcues bestaat en is leeg; vijf indexen; alle 10 in `teToonAnalyseren()`;
  pagina's van 3 = de hele lijst voor elke sortering en richting; opnieuw
  openen migreert niet.
- testserver op poort 8882 (VARVE_DB = de kopie, VARVE_MEDIA lege map,
  VARVE_HERANALYSE=uit): `/api/library` geeft alle 10 met `toon: null`,
  pagina's van 4 (sorteer titel) samen 10 van 10, GET hotcues `[]`, GET toon
  `null`, opstartregel "library: 10 nummers · schema v7". Server daarna weg.

## Wat NIET getest is

- Niets in Clay's eigen Chrome, niets op de APC, niets beluisterd. :8777 niet
  aangeraakt (draait nog met de oude code; Clay's db staat nog op v5).
- De echte eerste start op Clay's library: de achtergrond gaat daarna alle 10
  nummers langs voor de toonsoort (16–70 s per nummer, in een worker).
- De mapping-omzetting naar verschil op Clay's echte browser (gebeurt bij zijn
  eerste herlaad na de merge; alleen in de controle van dat spoor gemeten).
- De kiezer met een echte muis en een echte scrollbalk in Chrome (headless met
  synthetische klikken en `scrollTop`).
- Een ververs (ingest klaar) die precies tijdens een toon-POST een pagina
  ophaalt: de lijst kan dan tot de volgende verversing de oude kaart tonen
  (zetToon werkt het object bij dat er op dat moment staat).
- Openstaande punten uit de controles blijven open: `tweede` kandidaat alleen
  client-kant, zelfde nummer op twee tracks houdt een oude kaart, kolomkop
  13 px hoger onder 900 px hoogte (toonsoort); lege hotcue indrukken in het gat
  vóór terugzetten overschrijft de bewaarde (library #4/#5); oude code leest
  een verschil als volledige mapping (mapping-verschil #4).
- Voorstellen voor CLAUDE.md staan in de drie controleverslagen; CLAUDE.md is
  niet gewijzigd. Aanvulling voor die tekst: SCHEMA v6 = toon_json, v7 =
  hotcues/titel_sleutel (library.test bewaakt het); de toonsoortkiezer zweeft
  onder zijn rij in de virtuele lijst.
