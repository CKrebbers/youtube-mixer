# Werkruimte S11: categorieën en tags in de library (14–15 okt 2026)

Tak `werk/S11` (vanaf `werkruimte/integratie` 4558774). Opdracht: `docs/werkruimte/S11.md`. Ontwerp en
wat er gebouwd is: `docs/LIBRARY-TAGS.md`. Clay, 14 okt: *"Voeg daar ook toe dat je categorieën kunt maken
in de library zodat je makkelijk en snel nummers bij elkaar kunt vinden met categorieën maar ook met tags."*

## Kort

- **Categorieën** (eigen bakken met een volgorde; een nummer in veel categorieën), **slimme categorieën**
  (een bewaard filter dat zichzelf bijwerkt), **tags** (vrij, met kleur) en **snel-tags 1–8** (plekken die
  naar een tag wijzen, voor de bus). Plat, geen mappen in mappen (VRAGEN S11-1).
- **Vinden**: het zoekveld is het filter: `#dub -#vocal #a|b @categorie bpm:70-90 toon:8A grid:zeker stems
  energie:hoog` plus vrije tekst. Klikken in de kolom schrijft die tekst; chips met × halen een deel weg.
  Op de server, met dezelfde virtuele lijst en pagina's (≤ 500).
- **Taggen**: kiezen (klik, cmd-klik, shift-klik, cmd+A = alle treffers), het tagveld (Tab vult aan, een
  nieuwe tag vraagt een tweede Enter), alt+T, alt+1…8, slepen naar een categorie, binnen een categorie
  omslepen.
- **Overal**: op de bus `library.category.*`, `library.quicktag/quickfilter.1–8`, `track.N.tag.1–8`; de
  Maschine toont het filter bij BROWSE; werk.html en de iPad hebben een categoriekeuze en de zoekregel in
  het vak `library`, en de bouwsteen `tags` (schrijfweg S8); het planvenster maakt een set uit een
  categorie, een tag of het filter van de library (S9); de kaart-tab neemt een krat over als categorie.
- **Opslag**: schema v10 in `library.db` (backup vanzelf), export/import als JSON (samenvoegen, `?droog=1`),
  geen nieuw bestand, geen nieuwe VARVE_*.
- Geen regel in `mappings/*.json` veranderd. Een voorbeeld voor de Maschine is een stuk
  (`mappings/stukken/indeling-voorbeeld.json`).

## Wat er gebouwd is

| deel | bestand |
|---|---|
| het pure model: filter, zoekregel, namen, plekken, import, de afgeleide kenmerken | `src/library/indeling.js` |
| tags, categorieën, slim, snel-tags, het filter als SQL, kaartkrat, export/import | `server/indeling.js` |
| schema v10, `tracks()`/`aantalTracks()` met filter, `sorteer=plek`, k_* bij elke schrijfactie en bij openen | `server/library.js` |
| `GET /api/library` met de filterparameters | `server/index.js` |
| `/api/indeling/*` (elke POST alleen deze Mac) | `server/routes/indeling.js` (in `SPOREN`) |
| de kolom CATEGORIEËN/TAGS, de tagbalk, taggen, slepen, snel-tags | `src/ui/library-indeling.js`, `src/ui/css/indeling.css` |
| zoekveld = filter, selectie, cmd+A, alt-toetsen, plek-sortering, kolommen | `src/ui/library-panel.js`, `src/ui/library-lijst.js` |
| de bus | `src/ui/aanhakers/indeling.js` (elfde aanhaker), `src/ui/beschrijf/indeling.js` |
| iPad/werk.html | `src/paneel/paneel.js` (vak library), `src/paneel/vrij.js` (bouwsteen `tags`), `src/paneel/protocol.js` |
| set uit een categorie of filter | `src/plan/plan-venster.js`, `plan.html` |
| kaartkrat → categorie | `src/ui/kaart-panel.js`, `src/ui/laden.js`, `index.html` |
| Maschine: het filter in de kop | `src/control/maschine-scherm.js`; voorbeeld `mappings/stukken/indeling-voorbeeld.json` |

Bijvangst: `BOUWSTEEN_NAMEN` in `src/paneel/protocol.js` kende de bouwsteen `sjablonen` van S10 niet, dus
werk.html zei "vak sjablonen ken ik niet". Nu staan `sjablonen` en `tags` erin, en `vrij-paneel.test`
vergelijkt de twee lijsten.

## Gemeten

**Snelheid** (`node tools/bench/indeling.mjs`, in het proces, deze container): één pagina van 100 plus het
totaal, zoals `GET /api/library` hem rekent.

| vraag | 5.000 nummers | 20.000 nummers (40.000 tagregels) |
|---|---|---|
| geen filter (titel) | 2,6 ms | 2,6 ms |
| `#deep` (1 op 4) | 4,0 ms | 10,6 ms |
| `#deep -#nacht` | 4,1 ms | 14,1 ms |
| `#deep\|nacht\|warm`, op titel | 6,0 ms | 17,9 ms |
| `#dub bpm:70-90 grid:zeker` | 1,9 ms | 7,6 ms |
| `toon:8A,9A energie:hoog` | 3,2 ms | 11,5 ms |
| zoek "nummer 1" (vindt ook tags) | 9,7 ms | 11,5 ms |
| categorie van 2.000, op plek | 6,1 ms | 4,2 ms |
| slim `#deep bpm:120-130` | 4,1 ms | 13,2 ms |
| de stand van de kolom na een wijziging (12 categorieën) | 3,8 ms | 28,8 ms |
| de stand, nog eens (onthouden) | 0,01 ms | 0,02 ms |

Over HTTP in Chrome (headless, 5.003 nummers): een gefilterde pagina mediaan 5,6 ms, traagst 17,6 ms. De
grid-voorwaarde gaat bewust niet via zijn index (`+t.k_grid`): een slimme telling op 20.000 ging zo van
5,5 naar 2,4 ms. Een slimme categorie telt ~2–3 ms op 20.000; de stand telt er hooguit 24.

**Latentie** (`tools/headless/latentie.mjs`, 8 decks spelend; ronde 1 vóór, ronde 2 na de reviews):
fader → geluid p50 0,31 / 0,27 ms (p99 8,8 / 6,0); stijl in rust 20,3 / 18,7 ms/s, opmaak 19,6 / 17,9 ms/s. Binnen de eis (~0,3–0,4 ms, ~21–28 ms/s): de kolom en de
tagbalk tekenen alleen bij een wijziging (`_zet` vergelijkt de html), niet per beeld.

**Handelingen** (`tools/headless/indeling.mjs`, geteld): twee nummers zoeken, kiezen en een nieuwe tag
geven: 6; een categorie maken: 2; filteren en een gefilterd nummer laden: 2. De hele rondgang (taggen,
categorie, slepen, filteren, laden, omslepen, snel-tag, slim, cmd+A, planvenster): 29.

**30 nummers taggen en een filter maken** (telling van reviewer b, nagelopen):

| stap | | handelingen |
|---|---|---|
| 1 | B (library open) | 1 |
| 2 | klik het eerste nummer | 1 |
| 3 | scrollen en shift-klik op het 30e (of: filteren en cmd+A) | 2 |
| 4 | alt+T | 1 |
| 5 | `dub, nacht` + Enter (bestaande tags; nieuwe: nog een Enter) | 1 |
| | **taggen** | **6** |
| 6 | in het zoekveld `#dub bpm:70-90` | 1 |
| 7 | `+ ✦`, naam + Enter | 2 |
| | **een slimme categorie van dat filter** | **3** |

Verspreide nummers: filteren tot ze er staan en cmd+A, in plaats van 29 cmd-klikken.

## Getest

- `test/indeling.test.mjs` (96): model, zoekregel heen en terug, URL, chips, combineer strikt, plekken (60
  keer tussenvoegen, volgorde klopt), k_* = de formules van de lijst, schema v10 en de migratie van v9 met
  data, alle filters in SQL, slim (zichzelf bijwerken, binnen een gewone, nooit ruimer met wat je typt),
  hernoemen/samenvoegen/wissen met de regels en snel-tags, export → lege library (tags per nummer terug),
  import droog/samenvoegen, cascade, k_bpm (hoofdtempo), kapotte stems_json, herstel na een vreemde schrijver.
- `test/indeling-server.test.mjs` (43): de routes op een eigen server met een nep-kaart: 403 van de iPad en
  een andere Origin, 415, 400/404/409, pagina's met een filter, plek, slim, kaartkrat, export/import.
- `test/indeling-ui.test.mjs` (30): de URL (zonder filter precies de oude), de pagina-cache bij een nieuw filter,
  tagveld en aanvullen, chips (ontsnapt), geen `"` in een title, het paneel met een nep-paneel, het
  tag-geheugen, de uitleg van alle 83 nieuwe actions, wat de iPad mag, het voorbeeldstuk tegen het model.
- Bijgewerkt: `library.test` (v10-kolommen), `aanhaakpunten.test` (elf aanhakers), `vrij-paneel.test`,
  `regels-werk.test` (`/api/indeling/stand` als lees-pad; `engine/toonsoort.js` puur in werk.html).
- `node test/alles.mjs`: 129 bestanden, 11.167 checks; rood alleen renderblok en wachtrij (bekende
  omgevingsfouten) en één keer companion-server die midden in de run over middernacht ging (los groen).
- Headless groen: `indeling.mjs` (nieuw), `library.mjs`, `kaart.mjs`, `set-proef.mjs`, `werk-scherm.mjs`,
  `inrichten.mjs`. `library.mjs` was drie op vier keer rood door een race in de proef zelf (hij keek naar de
  oude rijen van bovenaan vóór het volgende beeld na het scrollen); de check wacht nu op de rijen op de plek.

## Reviews

**Ronde a (veiligheid, correctheid).** Gevonden en gerepareerd: een XSS (een categorienaam in een title met
een letterlijke `"` werd attributen in de knop; namen komen ook uit varve-kaart.json en een import), slim +
wat je typt kon ruimer worden (nu twee blokken voorwaarden), bpm filterde op het eerste stuk in plaats van
het getoonde hoofdtempo (k_bpm), de k_* konden stil oud worden (nu nagerekend bij elk openen),
`json_extract` op kapotte JSON, een kaartkrat van meer dan 5000 en een KaartFout als 500, `track.N.tag.K`
die bij een onbekend nummer de verkeerde kant op wisselde, de prijs van de read van `library.quicktag.K`,
de import zonder savepoint en tijdens het spelen. Ronde 2 van a liep de reparaties na (zie onder).

**Ronde b (acceptatie, bewijs).** Gerepareerd: export/import zonder de nummers per tag, aanvullen dat
rommeltags maakte, het Maschine-voorbeeld dat met `?stukken=` niets deed (het was zelfs ongeldig: de laag
`bladeren` is geen mapje; nu zonder laag, via de werkruimte, met een toets), geen toets voor de set uit een
categorie (nu in de headless proef, ook "maak set"), alle treffers kiezen, alt+1 dat na een nieuw filter de
bovenste rij tagde, ⋯ alleen bij hover, docs die niet klopten. Niet gedaan, met reden: de iPad-knoppen van
`tags` tonen "tag 1–8" en niet de naam (dat vraagt `naamVan` in `src/ui/aanhakers/schermen.js`, van een
ander spoor: VRAGEN S11-4 en hieronder); de volgorde van de categorieën zelf omslepen (de route bestaat,
de UI niet); echt slepen in Chrome is nagebootst met DragEvents.

## Hoe Clay het gebruikt

1. **B** opent de library. Links de kolom CATEGORIEËN/TAGS (☰ indeling = open/dicht).
2. **Taggen**: klik een nummer, shift-klik voor een reeks (of filter en **cmd+A**), **alt+T**, typ
   `dub` en Enter. Een tag die nog niet bestaat: nog een Enter.
3. **Snel-tags**: ⋯ bij een tag → "snel 1". Daarna **alt+1** op wat gekozen is, of `track.N.tag.1` op een
   knop of de iPad.
4. **Een categorie**: `+` in de kolom, naam, Enter. Sleep nummers erheen (of "→ categorie" in de balk).
   Klik de categorie: zijn nummers op zijn volgorde; sleep een rij op een andere om hem ervóór te zetten.
5. **Vinden**: typ in het zoekveld `#dub bpm:70-90 grid:zeker`, of klik tags in de kolom (alt-klik = niet).
   `+ ✦` bewaart het als slimme categorie.
6. **Een set**: plan → "uit…" → de categorie, een tag of "het filter van de library" → maak set.
7. **Een krat van de kaart**: tab kaart, kies de krat, "→ categorie".
8. **Claude**: `GET /api/indeling` geeft alles als JSON; `POST /api/indeling?droog=1` laat zien wat een
   aangepaste versie zou doen, zonder `droog` voegt hij samen.

## Vragen

In `docs/VRAGEN.md` blok S11 (S11-1 … S11-9). Let op: `docs/werkruimte/S11.md` zei "niet
HANDOFF/ROADMAP/VRAGEN", de opdracht van de sessie vroeg VRAGEN blok S11, HANDOFF en een CLAUDE.md-sectie;
ik volgde de opdracht van de sessie (ROADMAP niet aangeraakt). De integrator kan ze verplaatsen.

## Volgende versie

- De naam van een snel-tag op de knoppen van de iPad (`naamVan` in schermen.js), en een "gekozen nummer"
  dat de iPad zelf aanwijst (S11-4).
- De volgorde van de categorieën omslepen in de kolom (de route is er).
- Taggen op een filter op de server (`tags/zet` met `filter` in plaats van `ids`), voor meer dan 5000.
- Klikbare filterchips (grid zeker, stems, bpm rond de focus-track) voor wie de zoekregel niet kent.
- Een gekoppelde kaartkrat (S11-2), als Clay dat wil.
