# De Controlekamer (2 oktober 2026)

Clay: "maak 1 plek waar de hele controle room samen komt". Dit is die plek:
`http://localhost:8777/controle` (`controle.html`). Begin een sessie hier, niet in
de mixer.

## Wat erop staat

1. **Stand**, tegels met een lampje:
   - **Server** draait, met het aantal nummers in de library. Is hij herstart door de herstartlus
     (AR9, 16 okt), dan eerst een regel "herstart om 22:14 (viel om, exitcode 137) · 1 keer sinds
     21:30", of "(hing, de wachter zette hem neer)" na een hang (AR18). De tegel is dan 10 minuten
     oranje en daarna weer groen; de regel blijft tot de lus stopt. De lus geeft wat hij weet mee
     aan elke nieuwe server (`VARVE_LUS_*`, `server/lus.js`), en de tegel leest het uit
     `GET /api/leeft`: een herstart van 1 s zie je dus ook als de tegel hem tussen twee peilingen
     miste, en ook na herladen. Een server die met de hand gestart is: "zonder herstartlus".
     Daaronder (6 okt) een regel
     over de secties (`docs/SECTIES.md` §4, `/api/secties`, `src/controle/server-tegel.js`):
     "secties: 12 nog zonder · 3 verouderd", of "secties: alles actueel". *Nog zonder* = er is
     nog geen kaart; *verouderd* = er is er een, maar de server rekent hem opnieuw (een
     nieuwere `SECTIE_VERSIE`, een ander grid, stems erbij). Met de hand of op slot telt als
     actueel. Dat gebeurt vanzelf: bij het laden van dat nummer, of na een herstart van de
     server op de achtergrond; daar hoef je niets voor te doen. Een nieuw binnengehaald nummer
     staat hier dus als "nog zonder" tot je het laadt. Een nummer waarvan het rekenen mislukt
     (audio weg of onleesbaar) blijft staan zoals het was: "nog zonder" zonder kaart,
     "verouderd" met een oude kaart. Een oudere server zonder de route: "secties: onbekend
     (oudere server)"; herstarten lost dat op. Een fout van de server (bv. een library.db met
     de v9 van een andere tak, zonder `secties_json`): "secties: onbekend (fout)". Lege
     library: geen regel.
   - **Opstelling** (10 okt, `docs/STANDEN.md`, `src/controle/stand-tegel.js`): welke stand
     actief is en sinds wanneer, oranje bij een waarschuwing, rood bij een fout; daaronder wat je
     zelf nog doet ("krat proefkrat (kies hem in de kaart) · master Dub-worp: mixer volgt nog niet").
   - **Binnenhalen**: yt-dlp en ffmpeg (`/api/tooling`).
   - **Ingest-rij**: hoeveel er bezig is en wacht (`/api/ingest`).
   - **Stems** (3 okt): wat er gesplitst wordt en wacht, de laatste fout, of de
     splitter (Demucs) er is (`/api/stems`, `stemsTegel` in `src/ui/stems-weergave.js`).
   - **Backup**: wanneer de laatste kopie van `library.db` gemaakt is, hoeveel er
     staan en hoe groot (`/api/backups`, `src/controle/backup-tegel.js`). Rood met de
     reden als de laatste poging mislukte. Een oude datum is geen fout: zonder
     wijziging komt er bewust geen nieuwe kopie. Zie docs/LIBRARY.md, "Backup".
   - **Avondpakket** (10 okt): kan ik met deze tas vertrekken, kan ik hier beginnen
     (`/api/avondpakket`, `src/controle/avondpakket-tegel.js`, docs/AVONDPAKKET.md).
     Meet bij het openen, bij een keuze en bij een klik op de tegel, verder hooguit elke
     5 min; nooit vanzelf als de mixer open is, en de server bevriest zelf zolang er een
     deck speelt ("bevroren: er speelt een deck · HH:MM"). Profiel, fase, de punten en de
     paklijst staan in het uitklapblok onder de tegels.
   - **Mixer**: open of niet, uit de Web Lock `varve-mixer` (`src/ui/tabblad.js`).
     Rood als er een tweede mixer-tabblad wacht.
   - **Audio** en **APC40**: uit wat de mixer zelf meldt (zie hieronder). Bij de
     APC staat de echo-teller (ROADMAP 2: is hij na een sessie 0, dan mag het
     echofilter voor de APC uit).
   - Daaronder: wat er in de mixer staat (track, bpm, toonsoort, MAAT, auto, opname).
2. **Openen**: bovenaan de **opstelling** (`docs/STANDEN.md` §5): kiezen, activeren en
   "vorige terugzetten" (twee klikken), wat activeren verandert, en "bewerk" om een opstelling
   zonder JSON in te stellen. Zegt de actieve opstelling `hub.mixerVia`, dan opent "mixer openen"
   de mixer via de hub (`/?hub=ws://localhost:7700/app`). Daaronder:
   de knop "mixer openen" staat uit zolang er al een mixer open is.
   Zo komen er nooit twee tabbladen op de APC (Chrome-MIDI kan daar van crashen).
   Planvenster en los venster open je vanuit de mixer: die hebben de mixer als
   `opener` nodig.
3. **Speellijst**: de punten van een proefsessie (`src/controle/speellijst.js`).
   Per punt ok, fout of overslaan (nog eens klikken = terug naar open) en een
   notitie. "Nieuwe ronde" (twee keer klikken) zet de sessie in
   `proef/archief/<tijd>.json` en begint leeg. Wat erin staat: hieronder.

## De speellijst: de proef in drie avonden (6 okt; volgorde 9 okt; herschikt 16 okt)

Clay probeert alles wat sinds 5 okt gebouwd is voor het eerst op zijn echte hardware
(APC40 mkII, Xboard49, Maschine MK2, de koptelefoon via het samengestelde apparaat,
Chrome), en loopt daarvoor de lijst van boven naar beneden af: elk blok bouwt op het
vorige. De ruggengraat zijn de "Klaar als"-punten van S1–S4 in `docs/STUDIO.md` §5.
De Controlekamer kent geen avonden: de bloktitel groepeert ("Avond 1 · …").

| blok | punten | min | waarover (docs) | vragen (VRAGEN.md) |
|---|---|---|---|---|
| Avond 1 · Opstarten | 3 | 2 | APC, audio, scherm | — |
| Avond 1 · Draaien op de APC | 7 | 15 | sinds 9 okt uit "Eerder werk": laden, op de maat, beatjump, loop, quantize, rem, een overgang mixen | — |
| Avond 1 · Koptelefoon | 6 | 12 | S1: STUDIO §3 en §5, ook zonder samengesteld apparaat | S22, S3 |
| Avond 1 · Keylock en toon | 5 | 8 | KEYLOCK §9: Shift + Tap, Shift + Nudge, ±8%, V/M, Shift + Z/X, sprongen | I4, O2 |
| Avond 1 · Modus klank | 4 | 5 | sinds 9 okt uit "Eerder werk": grid-modus klank, kill, kleuren, knipperen | — |
| Avond 1 · Beatgrid | 9 | 18 | BEATGRID §10–11: oordeel, streepjes, controle (Loving arms, Ciel), jungle-mix vóór en na ↻, klik in de golfvorm, ↶, vastzetten | S21, S20 |
| Avond 1 · Stems | 9 | 14 | STEMS §5: zang weg, grid-modus stems, filter/echo/galm/toon per stem, alleen de bas in de koptelefoon, splitsen tijdens het mixen | N1, N2, N3, S5, S6, S23, S24 |
| Avond 1 · Master en effecten | 6 | 12 | MASTER (mapje master, limiter), EFFECTEN (sjablonen, distortion, vertraging) | S9, S10, S11, S13 |
| Avond 2 · Hub-middag: de F0-proef (zonder Varve) | 6 | 80 | sinds 11 okt (`visie/handen`, docs/HANDEN.md §2): overdag, zonder muziek, vóór de avond; `doctor`, F0-proef, proef speelapparaten, pushen, `check -- studio` in AV-app-hub (draaiboek: hub `docs/HARDWARE-AVOND.md` blok 1, 2, 8, 6) | HA2, HA3 |
| Avond 2 · Opstarten met de hub | 2 | 5 | `npm start -- studio` in AV-app-hub, LPD8 K1 | O1 |
| Avond 2 · Spelen | 15 | 30 | INSTRUMENTEN, MASCHINE, STUDIO S3: FM op de Xboard eerst in de koptelefoon, aanslag, toets → geluid, Maschine (wiel, pads, kleuren, draaiknoppen, schermen), drums, Schaal, mapje inst | S4, S7, S8, S14, S18, S19 |
| Avond 2 · Patronen | 8 | 22 | PATRONEN §7, MASCHINE §5, STUDIO S4: stappen op de Maschine, baslijn van de Xboard, starten vanaf de APC, mixen, sprong, herladen | S15, S16, S17 |
| Eerder werk · … (zeven blokken) | 26 | 45 | wat er vóór 6 okt al in stond: toonsoort, binnenhalen, auto-DJ, plan, klankschaal, beamer, kleine dingen | AU2, AU3, PL3, KS2, KS3 |

Sinds 16 okt (herschikt na de architectuurronde) staat alles erin wat sinds 10 okt gebouwd is, op de volgorde
waarin het moet: 325 punten in 61 blokken.

| deel | blokken | punten | min | wat |
|---|---|---|---|---|
| **Vooraf** (overdag, vóór avond 1) | 2 | 21 | 110 | eerst een kopie buiten de laptop (`tools/backup`, docs/BACKUP.md), dan media buiten iCloud (`tools/media-verhuis.mjs`, server uit), dan VARVE.app opnieuw (ar-app) en de herberekening van alle grids (AR1, ar-herreken: wacht op "[tellen] … grids uit bestaande tellen klaar"); daarna de opstelling (docs/STANDEN.md, eindigt op "Avond 1 · APC direct"), het avondpakket thuis (vertrek, aankomst), de instellingen op de server, de iPhone via Tailscale (co-adres) en de A4 van de handenkaart |
| **Avond 1** (mixen, zonder hub) | 22 | 127 | 330 | de kern (opstarten, luisteren, draaien, koptelefoon, keylock: 27 punten, 50 min), zonder lag, de library (bpm, past bij, de kaart), klank, beatgrid, gelijkzetten, tel 1, stems, master, de secties, naast de mixer (Controlekamer en de companion, AR16), het geheugen, de server weg, slaap en de Scarlett, en "Na afloop en de ochtend erna" (echo's, de nacht aan, ar-na, het setboek, 7a, de proefherstel, de eigen muziek) |
| **Avond 2** (spelen, met de hub) | 15 | 90 | 305 | de hub-middag (2a, overdag), V1 en de schermen, opstarten (eerst de opstelling via de hub: sta-hub, dan start VARVE.app de hub: app-hub; de opname van uitzenden stap 0), zonder lag met de hub, spelen, patronen, de secties met plan, auto-DJ, Maschine, beeld en hub, de Maschine als DJ-bediening, bladeren en sampler, crossover, en "Na afloop" (de opname, Logic, de speeldag) |
| **Avond 3** (beeld) | 6 | 21 | 135 | met de pc: de Stroommachine, het niveau, het avondpakket en de suite op de pc; zonder de pc: het zaalbeeld, beeld op één machine (overdag, geen speeldag), uitzenden stap 1 |
| **Werkruimte** | 9 | 40 | 225 | E0, poort M, A–D, S9–S11 (ongewijzigd, met de W-vragen bij hun punt) |
| **Eerder werk** | 7 | 26 | 45 | als er tijd over is |

**Waarom deze volgorde** (16 okt):
- **De kopie eerst.** Alles erna herschrijft de library (de verhuizing, de herberekening van de grids): eerst een kopie
  buiten de laptop, en launchd pas na de verhuizing (anders kijkt hij naar de oude plek).
- **Media buiten iCloud vóór VARVE.app**: de app leest `~/.varve/media-pad`; de verhuizing kan alleen met de server uit.
- **De herberekening vóór avond 1.** De eerste start na 16 okt rekent elk automatisch grid opnieuw (kaart-VERSIE 3); pas
  daarna kloppen ga-dj en ar-een, en de tegel Server zegt dan of de secties actueel zijn.
- **Avond 1 is zonder hub.** VARVE.app start de hub sinds 16 okt alleen als de actieve opstelling "mixer via de hub"
  zegt (VRAGEN AR21); "Avond 1 · APC direct" zegt dat niet, dus geen hub, en de Controlekamer verliest een oude `?hub=`.
  Draait er toch nog een hub van eerder, dan stopt start-apc hem (met de hub erbij praten de hub en de mixer allebei
  met de APC). ar-weg en ar-val starten de server met de lus zelf, niet met VARVE.app.
- **De nacht.** De opstelling "Avond 1 · APC direct" zet "vannacht niet": nacht-eerste zet dat aan het eind van avond 1
  terug. "Vandaag speeldag" op de companion blokkeert de nacht, dus dat punt staat pas na avond 2.
- **Na afloop**: ar-na, het setboek en 7a lezen kopieën van de avond, dus pas daarna (het setboek leest het log van
  sb-log, het vinkje "log altijd aan" vooraan in het opstarten).
- **Avond 2**: de hub-middag en V1 kunnen niet naast een draaiende hub; daarna eerst de opstelling via de hub
  (sta-hub), want pas dan start VARVE.app de hub (app-hub); de handmatige start is de terugval (hb-start).
- **Avond 3**: eerst wat de pc nodig heeft, dan wat zonder pc kan; beeld op één machine en uitzenden overdag.

`test/controle.test.mjs` eist dit: Vooraf vóór avond 1 vóór avond 2 vóór avond 3 vóór Werkruimte vóór Eerder werk,
de kern als eerste blokken van avond 1, kopie → verhuizing → VARVE.app → herberekening vóór avond 1, de speeldag na de
nacht, het setboek na de avond, sta-hub vóór app-hub vóór hb-start, sta-terug vóór start-apc, en dat start-apc de hub stopt en ar-weg de lus zonder de app start.

- **Citaten** (16 okt): een punt dat een melding of logregel van de app letterlijk aanhaalt, zet die in
  `citeert`. `test/controle.test.mjs` eist dat elk citaat in de doe of de let staat én letterlijk in de code
  (src/, server/, tools/, test/node-versie.mjs, de .html-pagina's): verandert een melding, dan zegt de test dat de
  speellijst mee moet.
- **Vraagcodes**: een code tussen haakjes in de let-tekst ("(S21)") is de open vraag uit
  `docs/VRAGEN.md` die je bij dat punt beantwoordt; je antwoord gaat in de notitie.
  Bij elk punt alleen de vraag die erbij past. Bij geen enkel punt: N4 en S12 (alleen
  een keuze, niets om te proberen) en KS1, KS4, KS5 (de globale klankschaal).
- **Ids**: de 44 punten van vóór 6 okt hebben hun id en tekst gehouden (kp-mix kreeg
  alleen "Goed zo? (S3)" erachter; start-apc zegt sinds 9 okt "Logic en andere
  muziekprogramma's dicht" in plaats van "Ableton dicht"; be-los zegt "knop video in de
  bovenbalk" omdat V nu alleen keylock is; dr-opdemaat zegt "nummerknop (1–8, in het 2×2-blok)"
  in plaats van het dubbelzinnige "track-knop"). Nieuwe ids hebben een
  voorvoegsel per blok: `kp-`, `bg-`, `ky-`, `st-`, `ma-`/`fx-`, `hb-`, `sp-`, `pa-`.
- **Geen "gedaan"-stand.** De server kent per punt alleen open, ok, fout en overslaan;
  er is niets om oude punten vooraf mee af te vinken (en `proef/sessie.json` was leeg).
  Daarom staan de oude blokken achteraan als "Eerder werk": als er tijd over is, of `—`.
  Behalve draaien en klank: die horen sinds 9 okt bij avond 1 (de APC-basis).
- **Wat de lijst aanneemt** (6 okt in de library): Loving arms en Ciel (vier stems, grid
  uit de tellen), de jungle-mix (grid met de hand, op slot), Let it all go (lang, het
  begin ~22 cent hoog); Beat This! en Demucs staan klaar.

## Hoe het werkt

- **De Controlekamer opent GEEN MIDI.** De APC heeft maar één client: de mixer.
- **De mixer meldt zich** (`src/ui/status-zender.js`): elke seconde een bericht
  op het BroadcastChannel `varve-status` met audio, MIDI-status (invoer, echo's,
  verkeerde poort), geladen tracks, focus, maat, auto en opname. Alleen het
  tabblad met de Web Lock meldt. Op de achtergrond knijpt Chrome timers, daarom
  vraagt de Controlekamer elke 2 s `{ vraag: 'status' }`: daar antwoordt de mixer
  meteen op. Ouder dan 5 s = "wacht op melding".
- **De speellijst op de server** (`server/proef.js`):
  - `GET /api/proef` → `{ begonnen, items: { <id>: { status, notitie, tijd } } }`
  - `PUT /api/proef/<id>` `{ status, notitie }` → één punt; `open` zonder notitie haalt het weg
  - `POST /api/proef/nieuw` `{}` → archiveren en leeg (JSON, zoals elke POST)
  - Bestand: `proef/sessie.json` (`VARVE_PROEF` om te verleggen). Niet via de
    witte lijst te lezen, alleen via de API. Per punt opslaan en na elkaar
    schrijven: twee tabbladen overschrijven elkaar niet.
- **Vragen aan de server** (`ververs`, elke 2 s): pas een nieuwe ronde als de vorige klaar
  is, en elk verzoek geeft het na 6 s op (`WACHT_MS`; de tooling-controle 60 s). Bij een
  trage of hangende server (een telefoon via het LAN) stapelden de verzoeken zich anders op.
  De losse routes (`/api/backups`, `/api/stems`, `/api/secties`, en `/api/avondpakket`, dat
  niet elke 2 s gevraagd wordt) worden na een 404 of een fout hooguit eens per minuut opnieuw
  gevraagd (`RUST_MS`, `haalLos`); intussen blijft het laatste antwoord staan, en komt er niet
  elke 2 s een rode regel in de console. De rust geldt per route (het pad zonder vraag):
  `/api/avondpakket?vers=1` omzeilt de rust van `/api/avondpakket` niet.
- **De backup-stand** (`GET /api/backups`, alleen GET, achter dezelfde Host-controle):
  `{ laatste: { naam, tijd, bytes } | null, aantal, gekeken, fout, foutTijd, bezig,
  gewijzigdSinds }`; `gewijzigdSinds` (het avondpakket) = staat er een wijziging in
  `library.db` die nog in geen kopie zit: `false`, `true`, of `null` (niet te zien).
  Los opgehaald: een oudere server zonder die route geeft een grijze tegel, geen
  "server weg". De kopieën zelf zijn via HTTP niet te lezen.
- **De secties-telling** (`GET /api/secties`, alleen GET, achter dezelfde Host-controle):
  `{ totaal, zonder, verouderd, versie }` uit `Library.sectieTelling()`: dezelfde regel als
  `moetSecties` (wat de achtergrond en het laden opnieuw zouden rekenen). De Controlekamer
  vraagt het elke 2 s, dus in twee lagen gecachet:
  - de telling, op de stand van de database: `total_changes()` van de serververbinding
    (zoals de backup) plus `PRAGMA data_version` (een andere verbinding). Zonder wijziging
    twee kleine queries (~3–5 µs). Midden in een transactie gaat er niets in de cache (na
    een ROLLBACK zou hij blijven staan).
  - per nummer de ruwe kolommen (grid, de oude gridkolommen, stems, kaart) en de uitkomst.
    Elke schrijfactie, in welke tabel ook, is een miss; tijdens de achtergrondanalyse
    gebeurt dat bijna elke 2 s. Dan haalt één query de kolommen op, en alleen de nummers
    waarvan er een anders is worden opnieuw geparst.
  - Gemeten (6 okt, op de Mac met andere agenten ernaast, mediaan van 20 missers, een
    kaart van 40 stukken met stems op 2 van de 3 nummers):

    | library | vóór (alles opnieuw) | na (alleen wat veranderde) |
    | --- | --- | --- |
    | 500 nummers, grid van 4 stukken | 10 ms | 1,4 ms |
    | 5000 nummers, grid van 1 stuk | 117 ms | 18 ms |
    | 5000 nummers, grid van 100 stukken | 365 ms | 45 ms |
    | 5000 nummers, grid van 400 stukken (live-opnames) | 1062 ms | 98 ms |

    Wat overblijft is het ophalen en vergelijken van de ruwe tekst. "Hooguit eens per
    10 s" is daarom niet gebouwd.

  Los opgehaald, zoals de stems: een 404 is "onbekend", een 500 "onbekend (fout)", geen
  "server weg".
- **Claude leest na een sessie** `proef/sessie.json` (fout + notitie = eerst repareren).

## Een punt toevoegen of veranderen

In `src/controle/speellijst.js`. Verander geen bestaande `id`: de stand op de
server hangt eraan. `test/controle.test.mjs` controleert dat ids uniek zijn en
op de server passen, dat de punten van vóór 6 okt er nog zijn, dat de blokken op
avondvolgorde staan met de kern van avond 1 vooraan, en dat elke
vraagcode in een let-tekst in `docs/VRAGEN.md` staat (één tot drie hoofdletters en een
getal, zoals `S21` of `SVC1`; een lijst als `(I4, O2)`). Een punt is één handeling
met één ding om op te letten; zet er alleen knoppen in die in de mapping, de
actions of `index.html` bestaan.

## Getest

- `test/controle.test.mjs`: opslag (fouten, gelijktijdig, kapot bestand,
  archief), de speellijst (ook: de ids van vóór 6 okt, de vraagcodes, de
  avondvolgorde), het bericht van de mixer.
- `test/server.test.mjs`: de routes, de witte lijst, 415 zonder JSON.
- `test/herstart.test.mjs` (AR9): `leesLus`, de regel en de tegel (oranje 10 minuten, de hang, het aantal, geen
  NaN), en een echte server met de omgeving van de lus; `test/server-lus.test.mjs`: wat de lus elke server meegeeft.
  In echte Chrome: `tools/headless/herstart.mjs` (kill -9, herladen, SIGSTOP, 1440 en 390 px).
- `test/backup.test.mjs`: de backup-tegel (vandaag, gisteren, langer geleden, fout,
  nog geen, geen server) en `/api/backups` op een echte server.
- `test/sec-controle.test.mjs`: de tegel Server met de regel secties (elke stand, ook 404,
  500, een lege library en een antwoord zonder of met NaN als totaal),
  `Library.sectieTelling` (zonder, oudere versie, ander grid, zonder grid gerekend, alleen
  de oude gridkolommen, stems erbij, `stems_json` kapot, hand en slot; gelijk aan
  `teSectieAnalyseren`; de cache, ook bij een andere verbinding en na een ROLLBACK; een
  miss parst alleen het veranderde nummer, geteld met `JSON.parse`; 2000 nummers) en
  `/api/secties` op een echte server.
- `tools/headless/sec-controle.mjs` (6 okt, echte Chrome, poorten 8913/9513): een library
  van zeven nummers met, zonder en met een verouderde kaart geeft "3 nog zonder · 2
  verouderd"; een nummer krijgt een kaart zoals bij het laden (`?maak=1`, de worker met
  ffmpeg) → "2 nog zonder"; een ander grid → een verouderde meer; nummers weg → "alles
  actueel". Dan, nagebootst met de Fetch-laag: een hangende server → hooguit 2 verzoeken in
  10 s (geen stapel); een 500 → "onbekend (fout)", daarna een minuut niets; een 404 →
  "onbekend (oudere server)"; daarna weer "alles actueel". Ook 390 px breed zonder zijwaarts
  scrollen en de regel niet afgekapt; server weg → geen regel. Fouten in de console: Runtime
  én Log (netwerkfouten), alleen die van de nagebootste storingen. 23 ok, ~2,5 minuut.
- `tools/headless/controle.mjs`: Controlekamer en een echte mixer in twee
  tabbladen van één headless Chromium. Mixer open/dicht, een tweede mixer, de
  knop, de demotrack in "in de mixer", afvinken en notities na herladen, de
  Backup-tegel. Gedraaid op 6 okt met de speellijst van twee avonden (99 punten):
  alles groen, de lijst past op 1440 px en op 390 px breed zonder zijwaarts scrollen.
  Op 9 okt opnieuw met de avondvolgorde (172 punten): alles groen.
- NIET getest: met de echte APC (de headless mixer heeft geen MIDI), en op de
  Mac in Clay's Chrome.
