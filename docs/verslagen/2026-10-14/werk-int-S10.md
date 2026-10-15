# Integratie S10 in werkruimte/integratie (14 okt 2026)

## Wat samengevoegd is

`origin/werk/S10` (tip 87c2805) in `werkruimte/integratie` (was d2d60cb). S10 bevatte d2d60cb al, dus de merge
was een **fast-forward**, zonder conflicten: 12 commits, 44 bestanden, +6717 −78. Wat S10 bouwde staat in
`docs/EFFECTEN-MEER.md` en `docs/verslagen/2026-10-14/werk-S10.md`:
- 25 nieuwe sjablonen in `racks/sjablonen.json` (33 in totaal);
- zeven nieuwe effecten (kam, klinker, frequentieschuif, band, kanteling, aanslag, duiker; `src/engine/fx-s10.js`);
- modulators (LFO, stappen, volger, toeval; `src/engine/modulatie.js`);
- een knop die een knop of de diepte van een modulator stuurt;
- droog/nat per effect en een eigen kromme;
- kopie/plak, A/B, muteren en "als sjabloon" in de rack-editor;
- eigen sjablonen op de server (`/api/sjablonen`, `racks/eigen.json`, versie + 409, alleen deze Mac);
- de XY-pad van een rack op de bus (`track.N.fx.xy.x/.y`, `master.fx.xy.*`);
- de bouwsteen `sjablonen` (`src/paneel/vrij.js`);
- `tools/headless/effecten-meer.mjs` en `tools/headless/rack-editor.mjs`.

Omgeving: Linux-container met 4 kernen, Node 22, headless Chromium 1194 (`headless_shell --no-sandbox`,
software-GL).

## Hersteld

Geen test werd rood door S10. Wel twee dingen rond de opslag van eigen sjablonen:

1. **VARVE_SJABLONEN in de proefservers.** De server schrijft eigen sjablonen in `VARVE_SJABLONEN`, anders in
   `<wortel>/racks/eigen.json`. Een testserver (`VARVE_TESTSERVER=1`) zonder die variabele schrijft dus in de
   worktree (of de echte projectmap) zodra iemand "als sjabloon" klikt. S10 zette hem in zijn eigen proeven
   (`effecten-meer.mjs`, `rack-editor.mjs`, `sjablonen-server.test`), maar niet in de gedeelde proefservers.
   Nu ook in `harnas()` (werk-scherm.mjs, en daarmee alle werk-*-proeven en inrichten), set-proef.mjs,
   latentie.mjs, sec-plan.mjs en sec-auto.mjs: dezelfde plekken waar bij S9 VARVE_SETS bij kwam.
   `rack-editor.mjs` geeft hem via `extraEnv` en blijft dus zijn eigen map gebruiken.
2. **CLAUDE.md**: `racks/eigen.json` staat nu bij de datamappen in de Git-conventie (en "een server die vanuit
   een worktree draait schrijft … de eigen sjablonen in die worktree"). In `.gitignore` stond `/racks/eigen.json`
   al (S10). De regel bij S10 in CLAUDE.md noemt nu welke proefservers hem zetten.

Na alle proeven staat er geen `racks/eigen.json` in de worktree.

## De suite

`node test/alles.mjs`: 126 bestanden, 10.992 checks, 10 overgeslagen, **2 rood** (253 s). Beide bekend, ook
rood op de basis:

| test | oorzaak |
|---|---|
| `wachtrij.test.mjs`: "yt-dlp en zijn kind zijn allebei weg" (2×) | procesboom van de container |
| `renderblok.test.mjs`: "keylock met wissels" (89,7 bytes per bericht) | afvalmeting van de WASM in deze V8 |

`instrumenten-fm-schaal` "geen afval per blok" was deze keer groen (hij wisselt in deze container). De flaky
midi-test "na één tik een hap" was groen.

De eisen van dit spoor:

| eis | uitslag |
|---|---|
| renderblok: gouden hash ongewijzigd | `9dfaeb73`, stereo én paar 0 van 8 kanalen; S10 raakt stream-kern, stream-lezer en de test niet |
| renderblok: 0 GC | stabiel, segmentwissels, rem, stems, keylock stabiel: 0 GC; alleen "keylock met wissels" (bytes, ook 0 GC) is de bekende uitzondering |
| effecten.test 0 GC | 168 ok, "12 000 blokken toonhoogte + omhullende, 0 GC's" |
| effecten-s10.test 0 GC | 82 ok, "12 000 blokken van alle drie, 0 GC's" |
| master.test, rack.test | 75 ok, 349 ok |

De nieuwe tests van S10 zijn groen: `modulatie` 65, `effecten-s10` 82, `sjablonen-server` 18, `sjablonen-paneel` 15.

## Headless

`VARVE_CHROME` = wrapper met `--no-sandbox`, `VARVE_TMP` en `TMPDIR` in de scratchpad, elke proefserver met
`VARVE_TESTSERVER=1` en tijdelijke paden.

| proef | uitslag |
|---|---|
| `effecten-meer.mjs` (volle run, niet `--snel`) | **86/86** |
| `rack-editor.mjs` | **groen**: een nieuw effect met één knop, open en dicht ingesteld, als sjabloon bewaard in 15 handelingen (+1 om het standaardrack leeg te maken); de editor tekent niet tijdens het slepen |
| `effecten.mjs` | **80/80** |
| `kijk.mjs` | **77/77** |
| `set-proef.mjs` | **26/26** (de automaat laadt zijn eigen tracks: `{"hoofd":"B","volgende":"A","eigen":["B","A"],"clay":[]}`) |
| `werk-scherm.mjs` | **36/36** |
| `inrichten.mjs` | **15/15** |
| `master.mjs` | 9 checks groen, daarna hangt hij op de proef "compressor → worklet midden in een toon" (`ctx.suspend(0.5)` op een OfflineAudioContext). **Ook op d2d60cb** (tijdelijke worktree, daarna weg): de omgeving, niet S10 |

Bij `master.mjs` viel op dat de galmstaart −23,0 dBFS rms gaf op de basis en −25,0 op de tip. Twee keer opnieuw
om en om: basis −23,0 / −23,0, tip −25,0 / −24,4. Het reverb-rack en de standaarden zijn op beide kanten gelijk
(`rackVanEffect('reverb')` vergeleken). Het getal hangt af van wanneer de timers in het offline renderen vallen
(zie CLAUDE.md, "Chrome offline is niet deterministisch"); de eis (> −60 dBFS, eindig, onder het plafond) haalt
het ruim. Geen regressie.

CPU per effect in deze run (acht tegelijk, 10 s offline, beste van drie): kam 1,6%, klinker 2,0%,
frequentieschuif 3,3%, band 5,0%, kanteling 1,4%, aanslag 2,3%, duiker 0,6% van een kern (S10 mat 1,0–6,7%:
dezelfde volgorde, deze container was rustiger).

## Latentie (`latentie.mjs`, één volle ronde)

| scenario | maat | S9 | S10 |
|---|---|---|---|
| fader | tot geluid p50 / p99 | 0,39 / 9,24 ms | **0,34** / 8,95 ms |
| fader | werk per bericht p50 | 0,19 ms | 0,17 ms |
| fader | tot scherm p50 | 10,5 ms | 11,2 ms |
| rust | stijl ms/s · taak ms/s | 28,0 · 412 | **21,3** · 336 |
| shift / mapje | stijl ms/s | 72,5 / 88,3 | 60,6 / 77,5 |
| alle | lange taken | 0 | 0 |

Belasting tijdens de meting 2,0–2,2. Niets is trager geworden; de verschillen zijn binnen de ruis van eerdere
rondes.

## Wat S10 bewust niet bouwde (EFFECTEN-MEER.md §5 en "Grenzen", werk-S10.md)

| niet gebouwd | waarom |
|---|---|
| echte parallelle ketens | droog/nat per effect dekt het meeste; vertakken vraagt een andere bedrading in `bouwKeten` en een andere editor |
| stutter/korrel binnen het rack | zit tegen beat repeat (deckniveau) aan en vraagt de klok in de worklet |
| modulatie op audiosnelheid | modulators zijn een besturing (33 ms, 8 ms voor snelle op de maat; vrij ≤ 8 Hz); voor snel zijn tremolo, autopan, vibrato en chorus er |
| `.versies/` van eigen sjablonen | optie; bewaren gaat wel met versie en 409 |
| bewaren en wissen vanaf de iPad | niet op de bus; de editor is alleen in de mixer |
| vertragingscompensatie bij droog/nat | compressor (6 ms), pitch en band lopen dan iets achter op het droge |
| de stand van een modulator in het handelingenlog | het rack met `mods` staat erin, een vrije LFO heeft bij terugspelen een andere fase |

Bekende grenzen: de kam kan +18 dB geven op zijn grondtoon (de limiter vangt het), modulators staan bijna stil in
een verborgen tabblad (de timer), Master-lijm op een track laat die track 6 ms achterlopen.

Vragen in VRAGEN blok S10:
- S10-1: welke sjablonen blijven, en liggen de knoppen goed;
- S10-2: modulators als besturing genoeg;
- S10-3: de kam die glijdt;
- S10-4: de luidheid van de klinker;
- S10-5: eigen sjablonen vanaf de iPad;
- S10-6: de XY-actions in de bouwsteen;
- S10-7: Master-lijm standaard op de master;
- S10-8: band met één of twee trappen;
- S10-9: de volgende stap.

Alles is gemeten, niets is beluisterd: elk sjabloon en elk nieuw effect moet Clay nog horen.

## Voor S11 (categorieën en tags in de library)

- Begin vanaf `werkruimte/integratie` (deze tip) en voeg eerst `origin/werkruimte/integratie` bij je tak samen.
- **Tags zijn er al op een andere plek.** Een rack heeft `tags: []` (rack.js), en S10 noemt "sjablonen per tag
  kiezen" als volgende versie. Library-tags horen bij een NUMMER, rack-tags bij een rack. Houd ze apart in namen
  (database, actions, docs), of zeg uitdrukkelijk dat ze één begrip worden.
- **Nieuwe routes** gaan als spoor in `SPOREN` (`server/routes/index.js`, nu werkruimtes, mapping-apparaat,
  paneel, sets, sjablonen); een bestand dat niet aan de vorm voldoet laat de server niet starten.
- **Een nieuwe aanhaker** (`src/ui/aanhakers.js`) verandert de vaste volgorde: `aanhaakpunten.test` eist er nu
  tien (S9 set, S10 effecten). Voeg achteraan toe en werk de test bij.
- **Een nieuwe bouwsteen** voor het library-paneel hoort in `BOUWSTENEN` (`src/paneel/vrij.js`), zoals
  `sjablonen`. Wat van de iPad mag, gaat via de schrijfweg van S8 (`mag`); schrijven naar de server (een tag
  wissen, categorieën bewaren) hoort niet op de bus als het van buiten zou kunnen, zoals S10 bewaren/wissen van
  sjablonen buiten de bus hield.
- **Datamappen**: wordt iets een bestand naast de database, zet het dan in `.gitignore`, in de CLAUDE.md-regel
  en achter een `VARVE_*`-variabele, en zet die in `harnas()`, set-proef, latentie, sec-plan en sec-auto. Een
  migratie in `library.db` gaat vanzelf mee in de backup (VACUUM INTO).
- Een set uit een categorie raakt S9 (`leesStand`, `src/sets/`): draai dan `test/sets-mixer` en
  `tools/headless/set-proef.mjs` mee. Set-proef blijft de regressieproef van de werkruimte.
- `tools/headless/master.mjs` hangt in deze container op de suspend-proef (ook op de basis): geen alarm.
- De flaky midi-test "na één tik een hap" is van niemand; rood daar alleen op die check = de omgeving.
