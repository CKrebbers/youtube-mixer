# Integratie S11 in werkruimte/integratie (15 okt 2026)

## Wat samengevoegd is

`origin/werk/S11` (tip 388e152) is samengevoegd in `werkruimte/integratie` (was 4558774). S11 bevatte 4558774 al, dus
de merge was een **fast-forward**, zonder conflicten: 7 commits, 41 bestanden, +4145 −98.

Wat S11 bouwde staat in `docs/LIBRARY-TAGS.md` en `docs/verslagen/2026-10-14/werk-S11.md`:
- categorieën met een volgorde, slimme categorieën en tags met kleur;
- snel-tags 1–8;
- het zoekveld als filter, uitgevoerd op de server;
- export en import (`/api/indeling`);
- de indeling op de bus, de Maschine (het filter in de kop), werk.html en de iPad (vak `library`, bouwsteen `tags`), het
  planvenster (een set uit een categorie of filter) en de kaart-tab (krat → categorie).

Omgeving: een Linux-container met 4 kernen, Node 22 en headless Chromium 1194 (`headless_shell --no-sandbox`,
software-GL).

## Hersteld

Niets. Geen test werd rood door S11, en er was niets op te ruimen.

**Opslag.** S11 schrijft alleen in `library.db`: schema v10 met de tabellen voor tags en categorieën, en de kolommen
`k_*` op `tracks`. Er komt geen bestand naast de database en er is geen nieuwe `VARVE_*`-variabele. `server/indeling.js`
en `server/routes/indeling.js` schrijven niets naar schijf. De backup (VACUUM INTO) neemt de indeling dus vanzelf mee.
Daarom hoefde er niets in `.gitignore` of in de proefservers bij.

**Migratie.** `library.test` rekent met `SCHEMA.length` en kent de v10-kolommen. `indeling.test` migreert een v9-database
met data. Beide zijn groen.

**Na de proeven** is `git status` in de worktree schoon. Er staat geen `racks/eigen.json`, `sets/`, `werkruimtes/`,
`proef/` of `standen/`, en `plannen/auto-plan.json` is ongewijzigd. De enige genegeerde bestanden zijn `test/.duur.json`
en de oude foto's in `tools/headless/uit/` (van 14 okt).

## De suite

`node test/alles.mjs`: 129 bestanden, 11.168 checks, 10 overgeslagen, **2 rood** (248 s: pool 121 s + alleen 127 s).
Beide zijn bekend en ook rood op de basis:

| test | oorzaak |
|---|---|
| `wachtrij.test.mjs`: "yt-dlp en zijn kind zijn allebei weg" (2×) | de procesboom van de container |
| `renderblok.test.mjs`: "keylock met wissels" (83,7 bytes per bericht, 0 GC) | de afvalmeting van de WASM in deze V8 |

De twee checks die hier wisselen, waren deze ronde groen: `instrumenten-fm-schaal` "geen afval per blok" en midi "na één
tik een hap".

De nieuwe tests van S11 zijn groen: `indeling` 96, `indeling-server` 43 en `indeling-ui` 34. Het verslag van S11 noemt 35
voor `indeling-ui`; de run telt er 34, allemaal ok.

De bijgewerkte tests zijn ook groen: `library` 169, `aanhaakpunten` 90 (elf aanhakers), `vrij-paneel` 67 en
`regels-werk` 36.

## Headless

`VARVE_CHROME` is een wrapper met `--no-sandbox`. `TMPDIR` en `VARVE_TMP` staan in de scratchpad. Elke proefserver draait
met `VARVE_TESTSERVER=1` en tijdelijke paden (ook `VARVE_PLANNEN`, `VARVE_PATRONEN`, `VARVE_SETS` en `VARVE_SJABLONEN`).

| proef | uitslag |
|---|---|
| `indeling.mjs` (de tag-proef van S11, 5000 nummers) | **46/46**. De hele rondgang telt 30 handelingen: taggen, een categorie, slepen, filteren, laden, omslepen, een snel-tag, slim, cmd+A en het planvenster (ook "maak set" uit een categorie) |
| `library.mjs` | **56/56** |
| `kaart.mjs` | **65/65** |
| `set-proef.mjs` | **26/26**. De automaat laadt zijn eigen tracks: `{"hoofd":"B","volgende":"A","eigen":["B","A"],"clay":[]}` |
| `werk-scherm.mjs` | **36/36** |
| `inrichten.mjs` | **15/15** |

## Latentie (`latentie.mjs`, één volle ronde)

| scenario | maat | S10 | S11 |
|---|---|---|---|
| fader | tot geluid p50 / p99 | 0,34 / 8,95 ms | **0,31** / 6,6 ms |
| fader | werk per bericht p50 | 0,17 ms | 0,17 ms |
| fader | tot scherm p50 | 11,2 ms | 10,5 ms |
| rust | stijl ms/s · taak ms/s | 21,3 · 336 | **17,9** · 297 |
| shift / mapje | stijl ms/s | 60,6 / 77,5 | 58,7 / 69,2 |
| alle | lange taken | 0 | 0 |

De belasting tijdens de meting was 1,8–2,0. Niets is trager geworden: de kolom en de tagbalk tekenen alleen bij een
wijziging. De verschillen vallen binnen de ruis van eerdere rondes.

## Wat S11 bewust niet bouwde (werk-S11.md "Volgende versie")

- De naam van een snel-tag op de iPad-knoppen. Dat vraagt `naamVan` in `src/ui/aanhakers/schermen.js`, en een
  "gekozen nummer" op de schrijfweg (S11-4).
- De categorieën zelf omslepen. De route bestaat, de UI nog niet.
- Taggen op een filter op de server, voor meer dan 5000 nummers.
- Klikbare filterchips voor wie de zoekregel niet kent.
- Een gekoppelde kaartkrat (S11-2).

Dit is niet getest:
- echt slepen met de muis (nagebootst met DragEvents);
- op de M1;
- op de iPad;
- op de Maschine.

Na het samenvoegen: herstart de server. Schema v10 migreert vanzelf, en elk openen rekent de `k_*` na (~1 s op 20.000
nummers, vóór de server luistert).

## De wachtrij

Rij 5 (S11) staat op "samengevoegd". De wachtrij is leeg (`docs/werkruimte/WACHTRIJ.md`). Het eindoverzicht voor Clay staat
bovenaan `docs/HANDOFF.md`.
