# Hoek: codebasis en ontwikkelsnelheid (13 okt, tak studio/afmaken @ 339310b)

Niets in de repo gewijzigd. Gemeten op een kopie (`git archive HEAD`) in
`scratchpad/winst/kopie`. De machine had een load van 10–15 op 4 kernen (de andere
workflows liepen ook), dus absolute tijden zijn aan de hoge kant. De verhoudingen kloppen wel.

Bestanden in deze map:
- `alles-serieel.txt`: `node test/alles.mjs` per bestand met de duur
- `alles-parallel4.txt`: dezelfde tests, 4 tegelijk, langste eerst (`scripts/parallel.mjs`)
- `scripts/strikt.mjs`: preload die elke AudioParam uit een testmock net zo streng maakt als die in engine.test
- `scripts/chrome.sh`: twee regels waarmee de headless-proeven in een Linux-container draaien
- `dood.txt`, `structuur.txt`, `genoemd.txt`, `zonderkop.txt`: hulpuitvoer

## Wat ik gemeten heb

| Wat | Getal |
|---|---|
| CLAUDE.md | 1880 regels, 156 960 bytes (~45k tokens). Groeit ~40 regels per dag (1580 op 5 okt, 1880 op 13 okt). Daarvan 360 regels bestandsboom ("Structuur") en 904 regels "Bekende grenzen" |
| CLAUDE.md in git | het vaakst gewijzigde bestand: 81 van de 472 commits (tools/README.md 58, HANDOFF 57, engine.test 50, actions.js 49) |
| Conflicten | in de merges die hun conflicten vastleggen: CLAUDE.md 4×, tools/README 2×, de rest 1× (server/index.js, controle.js, apc-beschrijf.js, VRAGEN, HANDOFF, ROADMAP, .gitignore) |
| Open PR's | 9: #27 #28 #30 #31 (visie/*, 117 commits achter), #32 (integratie → main), #33 #34 #39 #40 (fix/* → integratie) |
| Proefmerges (merge-tree) | #32 in main: conflict in CLAUDE.md, VRAGEN.md, controle.js, VARVE.applescript. visie/backup-kopie: CLAUDE.md. visie/handen: CLAUDE.md, VRAGEN, CONTROLEKAMER, .gitignore. visie/uitwerking: VRAGEN. studio/afmaken in main: **geen conflict** (main is een voorouder) |
| Testsuite serieel | 94 bestanden, 8796 checks, **737 s** (12,3 min onder load). 50 bestanden < 1 s, 61 < 3 s (samen 43 s). De tien traagste zijn samen 470 s: detect 81, uitzend 61, upload 50, stems 46, secties 45, bronnen 38, renderblok 32, wachtrij-server 29, wachtrij 29, vormen-zwaar 25 |
| Testsuite 4 tegelijk | **368 s** (2,0×), op dezelfde machine die al overbelast was. Twee tests werden extra rood door hun tijdsgrens: gridauto (analyse 29 s), kaart (zoeken 231 ms) |
| Rood op Node 22 / Linux | renderblok (keylock 83,7 bytes per bericht), instrumenten-fm-schaal (29 872 bytes afval), wachtrij (yt-dlp-kind "leeft nog", vermoedelijk een zombie in de container). Clay draait Node 26.8.2 (staat in de docs). Er is geen `.node-version`, geen `engines`, geen CI (`.github/` bestaat niet) |
| Web Audio-mocks | 14 testbestanden hebben elk een eigen `globalThis.AudioContext`; alleen engine.test is streng (overlap met een curve gooit, CURVE_BREUK telt). 13 zijn slap (`setValueCurveAtTime` en `cancelAndHold` doen niets, 4 vuren `onended` nooit). Met `strikt.mjs` eroverheen: in alle 13 0 overlap en 0 breuken. **Vandaag verbergen ze niets**, maar de regel "een mock die makkelijker is dan de echte API verbergt bugs" wordt maar in één bestand nageleefd |
| Headless-proeven | 57 scripts; 53 hebben elk een eigen Chrome-start en CDP-verbinding, 50 een eigen `zoekChrome` (4 varianten, de meeste alleen `~/Library/Caches/ms-playwright`). In deze container draait `past-bij.mjs` met `VARVE_CHROME=scripts/chrome.sh` (de puppeteer-Chrome plus `--no-sandbox`) **groen in 11 s** |
| Proefservers | 79 plekken in test/ en tools/ starten `server/index.js` met een eigen set VARVE_*-variabelen; de server kent er 24. Commits als 03275d3, 77a2373, 339310b ("proefserver zet ook VARVE_X apart", "botste met VI2 na de samenvoeging") laten zien dat er telkens een ontbreekt |
| Dode code | 6 exports die nergens gebruikt worden (LICHTEN, faseUitEnvelope, TELLEN_PER_OMWENTELING, metDeling, PAGINA_BYTES, VENSTERS). Geen probleem |
| Verouderd in de docs | CLAUDE.md noemt de standaardmapping 374/387/480 regels; het bestand heeft er 702. HANDOFF.md heeft als kop "7 oktober"; het laatste stuk is van 11 okt; 12–13 okt (de fix-takken, afmaken) staan er niet in |

## Kansen, op volgorde van winst per uur

### 1. CLAUDE.md terug naar een kern, de rest per laag (geneste CLAUDE.md)

Probleem. Elke agent en elke subagent laadt 157 KB (~45k tokens) voordat hij iets doet; dat
is ~20–25% van zijn werkgeheugen, en in een workflow met tien agenten tien keer. Claude Code
waarschuwt zelf al vanaf ~40k tekens (dit bestand is bijna 4× zo groot). Hoe meer er staat,
hoe minder een regel opvalt: de drie regels staan op regel 38, de APC-tabbladregel op regel ~1180.
Daarnaast is het het grootste conflictbestand, en de conflicten zitten precies in de handgeschreven
bestandsboom (proefmerge visie/backup-kopie: beide takken voegden een regel toe aan `tools/` en
aan de testlijst). Agenten besteden er nu werk aan om conflicten te vermijden (commits 4a460fe,
1d74698: "doc-regels op rustigere plekken (minder botsingen met de open takken)").

Hoe:
1. De root-CLAUDE.md wordt ~200–250 regels: wat dit is, de gekozen aanpak, de drie regels,
   conventies + git, de APC/tabblad-regel (die geldt overal) en een index "waar staat wat"
   (één regel per laag en per doc).
2. "Bekende grenzen" en de secties per spoor gaan naar geneste bestanden, die Claude Code
   pas laadt als een agent een bestand in die map leest:
   `src/engine/CLAUDE.md` (streamen, audiopad zonder afval, transport, rem, kill, overgangen,
   fx, limiter, keylock, stems, koptelefoon, instrumenten, patronen: bullets 1–19, 36, 39–48),
   `src/control/CLAUDE.md` (APC 0x42, wachtrij, Web Lock, hub, mapjes, mapping-verschil, LED's,
   Maschine), `src/ui/CLAUDE.md` (spiegel, vensters, rack-editor, renderloop),
   `src/video/CLAUDE.md` (video slaaf, beamer, noodknoppen, vormlagen),
   `server/CLAUDE.md` (witte lijst, Host/Origin, upload, ingest-wachtrij, library, backup,
   Tailscale, testserver-variabelen), `test/CLAUDE.md` (mocks, proefservers, gouden hash),
   `tools/headless/CLAUDE.md`.
3. De bestandsboom (360 regels) gaat eruit. In de plaats: `tools/kaart.mjs` dat per bestand
   het eerste commentaarblok toont (268 van 389 bestanden hebben er al een bovenaan; de rest
   na de imports). Een nieuw bestand = een kopcommentaar, geen regel in CLAUDE.md, dus geen
   conflict meer. `regels.test.mjs` kan eisen dat elk bestand in src/ en server/ zo'n kop heeft.
4. Getallen die verlopen (aantal regels in de mapping, aantal checks) eruit, of uit de code laten komen.
5. Controle bij het verhuizen: een script dat elke bullet van de oude CLAUDE.md terugvindt in
   precies één nieuw bestand (tekst-hash per alinea), zodat er niets verdwijnt.

Winst: ~35–40k tokens minder per agent (de geneste delen komen alleen mee als ze nodig zijn),
de regels die er echt toe doen staan op één scherm, en het grootste conflictbestand verdwijnt
grotendeels. Moeite: een dag (verhuizen is knip-en-plak; de controle maakt het veilig).
Risico: een agent die een engine-regel nodig heeft maar alleen in server/ werkt, ziet hem niet.
Opvangen: wat over lagen heen gaat (regel 3, wat je HOORT, de bus) blijft in de root; per
geneste file een kop "lees ook". Botst met de open PR's die CLAUDE.md raken: pas doen nadat die
samengevoegd zijn (zie kans 3), en in één commit, zodat de volgende takken vanaf daar beginnen.

### 2. De testsuite parallel, een snelle ronde, en CI op elke PR (met de Node van Clay)

Probleem. `test/alles.mjs` draait 94 bestanden na elkaar (spawnSync in een lus). Elke agent
draait hem vóór elke commit: 8,5 min op de Mac, 12 min hier. De tien traagste bestanden zijn
64% van de tijd. Er is geen CI: of een PR groen is, hangt af van wat de agent die hem maakte
draaide, en breuk komt pas bij het samenvoegen boven (339310b "botste met VI2 na de
samenvoeging"; b61d8e3, cd7fb46, 03275d3, 77a2373 zijn allemaal reparaties na integratie).
Op een andere Node is de suite rood zonder dat er iets mis is (renderblok, fm-schaal op Node 22);
een cloud-agent begint dus met "3 ROOD" en moet uitzoeken of dat van hem is.

Hoe:
1. `test/alles.mjs`: een pool van `os.availableParallelism()` processen, langste eerst (duur
   uit de vorige run, bewaard in `test/.duur.json`, buiten git). Mijn proef (`scripts/parallel.mjs`,
   35 regels) haalde 2× op een al overbelaste machine; op Clay's M1 zonder andere workflows
   verwacht ik 8,5 min → ~1,5–2 min (de grens is detect.test, ~80 s). Dat is een aanname tot het
   op de Mac gemeten is.
2. Tests met een tijdsgrens of afvalmeting (renderblok, fm-schaal, gridauto, kaart, vormen-*,
   alles met GCProfiler of een ms-budget) een markering geven (`// @alleen` bovenaan) en ná de
   pool alleen draaien. In de proef werden gridauto en kaart rood door de belasting, niet door een fout.
3. `node test/alles.mjs --snel`: de 61 bestanden onder 3 s (43 s serieel, ~15 s parallel) voor
   tijdens het werk; de volle suite vóór de commit.
4. `.node-version` (26.8.2) en een regel in alles.mjs: andere Node = een waarschuwing bovenaan,
   en de bekende verschillen als "overgeslagen" in plaats van rood.
5. `.github/workflows/test.yml`: `macos-14` (Apple Silicon, zoals Clay), Node 26.8.2, ffmpeg via
   brew, `node test/alles.mjs` op elke PR en elke push naar de integratietak. Geen yt-dlp nodig
   (de tests gebruiken nep-ytdlp). Optioneel later ook de headless-proeven (kans 4).

Winst: elke agentronde minuten sneller (vaak meerdere runs per spoor), en een rode PR is zichtbaar
vóór iemand hem samenvoegt. Moeite: parallel + snel ~3 uur; CI ~2 uur plus één keer kijken wat er
op een schone macOS-runner anders is. Risico: tests die toch iets delen (een vaste map, een poort)
botsen pas in parallel. In mijn proef botste er niets (de servertests kiezen een willekeurige poort
en een eigen tijdelijke map); de twee extra rode waren tijdsgrenzen. CI is een dienst buiten de laptop:
alleen de code, geen media, geen library; dat past bij "persoonlijk instrument".

### 3. Takken opruimen: één integratielijn, en wat er al in zit dicht

Probleem. Er zijn drie lijnen naast elkaar: `main` (wat Clay speelt), `studio/integratie` (waar
de PR's naartoe gaan) en `studio/afmaken` (waar alles echt samenkomt). De werkwijze in CLAUDE.md
noemt er twee. Op 13 okt gingen vier PR's (#35–38) rechtstreeks naar main; daardoor botst #32
(integratie → main) nu in vier bestanden. Tegelijk bevat afmaken #32, #33, #34, #39 en #40 al, en
afmaken gaat zonder conflict in main. Van de negen open PR's zijn er dus vijf in feite al
samengevoegd, en de vier visie-PR's staan 117 commits achter; drie van de vier botsen
(CLAUDE.md, VRAGEN.md, .gitignore, CONTROLEKAMER.md). Hoe langer ze blijven liggen, hoe meer
werk ze kosten; "[na de proefavond]" is een goede rem, maar het samenvoegen loopt intussen wel op.

Hoe:
1. Nu al, zonder main te raken: de vier visie-takken in afmaken samenvoegen (conflicten één keer
   oplossen, vooral CLAUDE.md en VRAGEN.md), de suite groen.
2. Na de proefavond (Clay beslist): één PR afmaken → main. Dan #32, #33, #34, #39, #40 en de
   visie-PR's sluiten met "zit in #N", de takken weg (remote en lokaal), integratie weg of gelijk
   aan main.
3. In CLAUDE.md (Conventies, Git) één regel die klopt met de praktijk: elk spoor takt af van de
   integratietak en gaat daar terug in; naar main alleen de integratietak; geen PR's direct naar
   main, behalve een hotfix die meteen ook in de integratietak gaat.
4. `tools/git/stand.mjs`: welke takken, hoeveel voor/achter, welke PR's al in de integratietak
   zitten, en de proefmerges van de open PR's (`git merge-tree`). Dat is wat ik hier met de hand
   deed; een integrator heeft het in tien seconden.

Winst: minder uren van agenten aan conflicten oplossen, en minder kans dat een fix in de verkeerde
lijn blijft liggen en op de avond ontbreekt. Moeite: stap 1 een paar uur, stap 2–3 een uur, stap 4
een paar uur. Risico: stap 2 zet in één keer veel nieuw werk op main; daarom pas na de proefavond, en
met de volle suite en de avondpakket-controle.

### 4. Gedeeld testgereedschap: één strenge mock, één headless-hulp, één proefserver

Probleem. Hetzelfde gereedschap is tientallen keren gekopieerd, en elke kopie verloopt op zijn eigen
manier:
- 14 eigen AudioContext-mocks, 13 slapper dan de echte API (CLAUDE.md, conventie "Mocks": "een mock
  die makkelijker is dan de echte API verbergt bugs"). Gemeten: vandaag verbergen ze niets
  (`strikt.mjs`: 0 overlap, 0 curve-breuk in alle 13), maar een nieuwe overgang die wél een curve
  gebruikt, wordt alleen in engine.test gevangen.
- 53 headless-scripts met elk een eigen Chrome-start, CDP en `zoekChrome` die alleen op de Mac zoekt.
  Daardoor kan een cloud-agent de browserproeven niet draaien. Met twee regels kan het wel
  (`past-bij.mjs` groen in 11 s hier).
- 79 plekken starten een proefserver met hun eigen lijst VARVE_*-variabelen (24 bestaan er). Elke
  nieuwe datamap betekent alle kopieën langs, anders schrijft of leest een proef in de echte map
  (03275d3, 77a2373, 339310b). Een testserver leest nu nog de echte `varve-kaart.json` van het Bureaublad.

Hoe:
1. `test/nep-webaudio.mjs`: de mock uit engine.test (regels 1–64 en de worklet-node) als module.
   De 13 andere tests importeren hem in plaats van hun eigen te houden. Ook `test/hulp.mjs` met
   `ok/fails` (nu 93 keer gekopieerd).
2. `tools/headless/hulp.mjs`: `zoekChrome()` (VARVE_CHROME, playwright op de Mac, puppeteer op Linux,
   `--no-sandbox` als root), `startChrome`, `cdp`, `evalueer`, `foto`, `wacht`. Per script een paar
   regels weg; nieuwe scripts beginnen er meteen mee. Kan per script, hoeft niet in één keer.
3. `proefServer({ ... })` in een gedeelde module: maakt één tijdelijke map en zet ALLE datamappen
   daarin (media, db, opnames, plannen, patronen, proef, standen, hub-sets, uitzend, kaart, nacht).
   En in de server: met `VARVE_TESTSERVER=1` en een ontbrekende map weigert hij te starten (of kiest
   hij een map onder VARVE_MEDIA), in plaats van terug te vallen op de projectmap.

Winst: minder kans dat een proef Clay's echte data raakt, cloud-agenten kunnen in Chrome controleren
wat nu op de Mac moet wachten, en nieuwe tests zijn sneller te schrijven. Moeite: mock + hulp een
halve dag; de proefserver een halve dag; de headless-hulp een dag als alle 53 meegaan (kan
geleidelijk). Risico: de strenge mock in een test die nu slap draait kan iets rood maken; dat is dan
een echte vondst. Twee tests gebruiken latentie 0 en andere `baseLatency`: als optie meegeven.

### 5. Hervatten in één scherm: een stand die zichzelf bijhoudt

Probleem. Wie verdergaat, leest volgens CLAUDE.md eerst HANDOFF (76 KB), VRAGEN (69 KB), VERBETERINGEN
en APC40 (31 KB), bovenop CLAUDE.md: samen ruim 300 KB. HANDOFF is een logboek dat achterloopt (kop
"7 oktober", laatste stuk 11 okt, 12–13 okt ontbreken), en VRAGEN groeit aan het eind (blok na blok),
zodat twee takken die allebei een blok toevoegen botsen (visie/handen, visie/uitwerking, commit
7928fb5 "blok HA niet meer 'laatste'").

Hoe:
1. HANDOFF.md wordt hooguit één scherm: wat er NU speelt, wat ongecommit of ongetest is, en de
   volgende stap. De rest naar `docs/verslagen/<datum>/` (die map bestaat al).
2. Het feitelijke deel wordt gemaakt in plaats van geschreven: `tools/git/stand.mjs` uit kans 3,
   plus de laatste `alles.mjs`-uitslag.
3. VRAGEN.md: alleen de open vragen bovenaan; beantwoorde vragen naar een archief. Een nieuw blok
   in een eigen bestand (`docs/vragen/<blok>.md`) als takken parallel lopen, dan botst niets.

Winst: een nieuwe sessie zit sneller in het werk en leest minder dat niet meer klopt. Moeite: een
halve dag, plus de afspraak (in de root-CLAUDE.md) dat de overdracht kort blijft. Risico: geschiedenis
die nog nodig is verdwijnt uit het zicht; ze blijft in docs/verslagen en in git.

## Bekeken en niet de moeite (nu)

- **Grote bestanden splitsen** (deck.js 1805, detect.js 1942, server/index.js 1929, actions.js 1512,
  waarvan `bindEngine` alleen al 900 regels). Ze worden vaak gewijzigd (actions.js 49×), maar botsen
  bijna nooit: in de vastgelegde conflicten één keer server/index.js, één keer apc-beschrijf.js.
  Agenten lezen er delen van. Splitsen geeft verschuivingen in elke open tak, dus pas doen als het
  pijn doet. Als het moet: `bindEngine` in modules per domein (grid, toon, transport, fx, stems,
  secties), elk met zijn eigen `define()`-reeks, en daarna pas iets anders.
- **Dode code**: 6 ongebruikte exports. Geen probleem.
- **Dubbele tests**: niet gevonden. De trage tests zijn traag omdat ze ffmpeg, workers, servers
  of echte tijd gebruiken, niet omdat ze hetzelfde doen. detect.test (81 s) rekent echt;
  parallel draaien is de oplossing, niet minder toetsen.

## Samenhang met de andere workflows

- Workflow 1 (lag + beatgrid) maakt worktrees en dus takken: kans 3 (één integratielijn, stand.mjs)
  en kans 2 (CI) gelden ook voor hun werk. detect.test is de traagste test en hoort bij het beatgrid.
- Workflow 2 (werkruimte) gaat de mapping en de UI raken: elke nieuwe controller-tak schrijft in
  CLAUDE.md (structuur + APC-regels). Kans 1 vóór hun bouwfase scheelt hun conflicten.
