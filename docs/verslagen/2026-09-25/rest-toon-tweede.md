# Rest toonsoort: de tweede kandidaat — 25 september 2026

Branch `spoor3/toon-tweede` (vanaf `integratie-r1` op e5ca616), worktree
agent-af781025173fec273. Aan het eind `git switch --detach`; branch blijft staan.

## Commits

| commit | wat |
|---|---|
| 31ecc00 | Server: `tweede` per stuk (kaartPerStuk + toonKaart), normaliseerToon laat hem staan en valideert; toon.test; TOONSOORT.md §3/§13 |
| 2d06fb5 | Client: library-tooltip noemt de tweede ook (hoofd().tweede); toonsoort.test naad + weergave; toon-keten.mjs met een twijfelnummer; tools/README.md |

## Wat er veranderd is

**server/toon.js**
- `kaartPerStuk`: `opnieuw()` geeft `tweede: t.kAnder` mee (uit dezelfde `kies()` als
  `k`; de beste met een ANDER Camelot-getal, dus precies de buur waartegen `beslist`
  en daarmee de zekerheid gemeten wordt). In de uitvoer als LAATSTE veld, null bij
  stilte. Geen enkele berekening veranderd: alleen doorgegeven.
- `toonKaart`: elk stuk met een toonsoort krijgt `tweede` in de vaste spelling, na
  `zekerheid` (sleutelvolgorde `van, toonsoort, stemming, zekerheid, tweede` = die van
  `stukNaarJson` in de browser, dus geen valse POST uit de bewaarlus). Stilte: geen.
- Commentaar bij `TOON_VERSIE` en de kop: waarom geen ophoging, en dat de vergelijking
  met het instrument alleen `tweede` weglaat.

**server/library.js — normaliseerToon**
- `tweede` wordt gelezen met `leesToonsoort` (C# -> Db), onleesbaar/geen tekst = null
  (route 400), zoals `toonsoort`.
- Hij valt weg bij een stuk zonder `zekerheid`, zonder toonsoort, of als hij gelijk is
  aan de toonsoort.
- Interpretatie van "alleen bij bron 'auto'; met de hand gezet = geen tweede": per
  STUK, niet per kaart. `tweede` hoort bij de zekerheid (allebei uit de analyse). In
  een kaart met bron 'hand' houden de stukken die je niet aanraakte hun zekerheid (zo
  was het al, net als bij het grid) en dus ook hun tweede; een stuk dat je met de hand
  zet verliest beide (browser: `_pas`/`zetStuk` wisten ze al samen). Had de server
  `tweede` voor elke hand-kaart weggegooid, dan zou na één kwint-correctie op stuk 2
  een onzeker stuk 1 na herladen zijn tweede kwijt zijn terwijl zijn zekerheid bleef.

**src/engine/toonsoort.js, src/ui/toon-weergave.js**
- De browser las `tweede` al (stukVan, stukAt, hoorbaarBij schuift hem mee met de
  pitch, toonTitel toont hem bij onzeker en `~`). Kolomkop en focus werkten dus zodra
  de server hem gaf; daar hoefde niets te veranderen.
- Ontbrak: de LIBRARY-tooltip (libraryToon) noemde alleen "best passend: E". Nu geeft
  `hoofd()` `tweede` mee (die van het langste stuk in de hoofdtoonsoort) en zegt de
  library "best passend: G, of C" onder 0,15 en "onzeker (zekerheid 0,30), of D"
  daarboven, net als de kolomkop. Kleine uitbreiding buiten de letterlijke opdracht,
  maar §5 geldt voor de tooltip op alle drie de plekken.

## TOON_VERSIE: blijft 1

Gekozen: niet ophogen. Motivering:
1. De toonsoort zelf veranderde niet (bit voor bit gelijk aan het instrument, getest);
   `versie` betekent "versie van de analyse" en is bedoeld voor een BETER algoritme.
2. Er bestaat nog geen library met kaarten. Nagekeken (alleen lezend, `grep -c` op de
   bytes, geen SQLite geopend): `media/library.db` en `library.db-wal` bevatten geen
   `toon_json` en geen `CREATE TABLE hotcues`, dus Clay's database staat vóór de
   toonsoort-migratie. De eerste serverstart na het samenvoegen analyseert alles met
   deze code en elk stuk krijgt een `tweede`.
3. Ophogen kost bij elke bestaande auto-kaart een heranalyse (16–70 s voor Clay's
   library) voor alleen een tooltipregel.
Gevolg: een kaart van een testserver van vóór 31ecc00 mist de tweede in de tooltip
(de browser gaat daar gewoon mee om); ↻ in de library geeft hem.

## Tests

- `test/toon.test.mjs` (51 checks, groen): formaat met `tweede` als laatste sleutel;
  elk stuk met een toonsoort (7) heeft een tweede in de vaste spelling met een ander
  Camelot-getal (C/F Am/A C/F C/F Eb/Bb F#m/F# E/Ebm); stilte zonder; kaartPerStuk
  zonder `tweede` gelijk tot op de laatste bit aan het instrument; `tweede` = kAnder
  van het INSTRUMENT, apart nagerekend op dezelfde frames met dezelfde stemming
  (F F Bb - F#); normaliseren (houden naast zekerheid ook in een hand-kaart, spelling,
  weg zonder zekerheid/zonder toonsoort/gelijk; onleesbaar en geen tekst = ongeldig,
  nu 15 gevallen); de server geeft `tweede` via GET /toon.
- `test/toonsoort.test.mjs` (115, groen): een serverkaart met `tweede` gaat ongeschonden
  door normaliseerToon en de browser schrijft hem teken voor teken terug (geen valse
  POST); na elke bewerking uit menu/kiezer houden de stukken dezelfde tweede als de
  browser; kwint op een stuk -> dat stuk verliest zijn tweede, de rest niet; library
  onder 0,15 / onzeker / album (langste stuk).
- Gericht ook groen: library, regels, server, ingest.
- `tools/headless/toon-keten.mjs` (poorten 8914/9514, echte server): **33/33**. Nieuw
  derde nummer: 40 s kwinten om en om op C en G (geen terts, geen melodie), zaad 5;
  de ingest zegt G, zekerheid 0,11, tweede C. Gecontroleerd: elk stuk van alle drie
  kaarten heeft een tweede; library-tooltip, kolomkop track 3 en focus zeggen
  "geen duidelijke toonsoort (best passend: G, of C)"; met +6% pitch "A♭, of D♭".
  Tegenproef met de serverbestanden van e5ca616: 27/33, precies die zes rood
  ("best passend: G" zonder tweede).
- `tools/headless/toon.mjs` (nep-library): 29/29.
- `nice -n 10 node test/alles.mjs`: 32 bestanden, 2345 checks, 3 rood, alle drie op
  tijd, bij een load van 120–266 op 8 kernen (andere agenten):
  - server.test "Range-antwoorden p95/traagste" (traagste 1163 ms > 500): los opnieuw
    eerst weer rood (994 ms), met de OUDE serverbestanden onder dezelfde belasting ook
    rood (p95 81 > 50), daarna op de nieuwe code groen (p95 8 ms, traagste 19 ms).
  - upload.test: ECONNREFUSED (testserver nog niet op); los groen.
  - vormen-isomorf.test "max < 16 ms per stap" (sn, tv, ep, dw): raakt niets van dit
    spoor; los groen (tv max 15,77 ms: krap onder de drempel bij deze belasting).

## Proefmateriaal (scratchpad/tweede/proef.mjs)

Welk synthetisch materiaal twijfelt voorspelbaar (twee zaden):
| materiaal | uitkomst |
|---|---|
| C-G om en om, melodie uit gemeenschappelijke tonen | G z0,33/0,38 of C |
| C-G om en om, zonder melodie | G z0,46/0,47 of C |
| kwinten op C | C z0,10/0,12 of F |
| kwinten C en G | G z0,10/0,12 of C  (gekozen) |
| C-G-Am-Em | G z0 / Em z0,03 of C |
| C-G-Em | G z0,27/0,25 of C |
| G-C-D (G majeur I-IV-V) | G z0,85 of D |

## Niet getest / open

- Niets in echte Chrome (tooltips zoals Chrome ze toont), niets op de APC, niets
  beluisterd. Clay's database en :8777 niet aangeraakt.
- De stukkenlijst in de library-tooltip (bij een album) noemt de tweede per stuk niet;
  alleen de hoofdregel. Niet gevraagd.
- De serverlog (`toonSamenvatting`) noemt de tweede niet.
- Of `kAnder` de beste "tweede" is voor Clay's repertoire is niet op zijn library
  gemeten: §2 zegt dat de meest gemaakte fout een kwint of de relatieve is; de
  relatieve kan per definitie niet (zelfde Camelot-getal, telt niet als twijfel), dus
  de tooltip toont de sterkste kandidaat BUITEN die plek op de wijzer.
- Voorstel CLAUDE.md (niet gewijzigd, mag niet): onder "Toonsoort": "Elk stuk van een
  automatische kaart heeft `tweede` (kAnder, ander Camelot-getal), hoort bij de
  zekerheid: met de hand gezet = weg. TOON_VERSIE bleef 1 (keuze ongewijzigd, nog
  geen kaarten bij Clay)."
