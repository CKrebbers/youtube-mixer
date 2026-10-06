# De Controlekamer (2 oktober 2026)

Clay: "maak 1 plek waar de hele controle room samen komt". Dit is die plek:
`http://localhost:8777/controle` (`controle.html`). Begin een sessie hier, niet in
de mixer.

## Wat erop staat

1. **Stand**, acht tegels met een lampje:
   - **Server** draait, met het aantal nummers in de library. Daaronder (6 okt) een regel
     over de secties (`docs/SECTIES.md` §4, `/api/secties`, `src/controle/server-tegel.js`):
     "secties: 12 nog zonder · 3 verouderd", of "secties: alles actueel". *Nog zonder* = er is
     nog geen kaart; *verouderd* = er is er een, maar de server rekent hem opnieuw (een
     nieuwere `SECTIE_VERSIE`, een ander grid, stems erbij). Met de hand of op slot telt als
     actueel. Dat gebeurt vanzelf: bij het laden van dat nummer, of na een herstart van de
     server op de achtergrond; daar hoef je niets voor te doen. Een nieuw binnengehaald nummer
     staat hier dus als "nog zonder" tot je het laadt. Een nummer waarvan het rekenen mislukt
     (audio weg of onleesbaar) blijft "nog zonder" staan. Een oudere server zonder de route:
     "secties: onbekend (oudere server)"; herstarten lost dat op. Lege library: geen regel.
   - **Binnenhalen**: yt-dlp en ffmpeg (`/api/tooling`).
   - **Ingest-rij**: hoeveel er bezig is en wacht (`/api/ingest`).
   - **Stems** (3 okt): wat er gesplitst wordt en wacht, de laatste fout, of de
     splitter (Demucs) er is (`/api/stems`, `stemsTegel` in `src/ui/stems-weergave.js`).
   - **Backup**: wanneer de laatste kopie van `library.db` gemaakt is, hoeveel er
     staan en hoe groot (`/api/backups`, `src/controle/backup-tegel.js`). Rood met de
     reden als de laatste poging mislukte. Een oude datum is geen fout: zonder
     wijziging komt er bewust geen nieuwe kopie. Zie docs/LIBRARY.md, "Backup".
   - **Mixer**: open of niet, uit de Web Lock `varve-mixer` (`src/ui/tabblad.js`).
     Rood als er een tweede mixer-tabblad wacht.
   - **Audio** en **APC40**: uit wat de mixer zelf meldt (zie hieronder). Bij de
     APC staat de echo-teller (ROADMAP 2: is hij na een sessie 0, dan mag het
     echofilter voor de APC uit).
   - Daaronder: wat er in de mixer staat (track, bpm, toonsoort, MAAT, auto, opname).
2. **Openen**: de knop "mixer openen" staat uit zolang er al een mixer open is.
   Zo komen er nooit twee tabbladen op de APC (Chrome-MIDI kan daar van crashen).
   Planvenster en los venster open je vanuit de mixer: die hebben de mixer als
   `opener` nodig.
3. **Speellijst**: de punten van een proefsessie (`src/controle/speellijst.js`).
   Per punt ok, fout of overslaan (nog eens klikken = terug naar open) en een
   notitie. "Nieuwe ronde" (twee keer klikken) zet de sessie in
   `proef/archief/<tijd>.json` en begint leeg. Wat erin staat: hieronder.

## De speellijst (6 oktober): de proef in twee avonden

Clay probeert alles wat sinds 5 okt gebouwd is voor het eerst op zijn echte hardware
(APC40 mkII, Xboard49, Maschine MK2, de koptelefoon via het samengestelde apparaat,
Chrome), en loopt daarvoor de lijst van boven naar beneden af: elk blok bouwt op het
vorige. De ruggengraat zijn de "Klaar als"-punten van S1–S4 in `docs/STUDIO.md` §5.
De Controlekamer kent geen avonden: de bloktitel groepeert ("Avond 1 · …").

| blok | punten | min | waarover (docs) | vragen (VRAGEN.md) |
|---|---|---|---|---|
| Avond 1 · Opstarten | 3 | 2 | APC, audio, scherm | — |
| Avond 1 · Koptelefoon | 6 | 12 | S1: STUDIO §3 en §5, ook zonder samengesteld apparaat | S22, S3 |
| Avond 1 · Beatgrid | 9 | 18 | BEATGRID §10–11: oordeel, streepjes, controle (Loving arms, Ciel), jungle-mix vóór en na ↻, klik in de golfvorm, ↶, vastzetten | S21, S20 |
| Avond 1 · Keylock en toon | 5 | 8 | KEYLOCK §9: Shift + Tap, Shift + Nudge, ±8%, V/M, Shift + Z/X, sprongen | I4, O2 |
| Avond 1 · Stems | 8 | 12 | STEMS §5: zang weg, grid-modus stems, filter/echo/galm per stem, alleen de bas in de koptelefoon, splitsen tijdens het mixen | N1, N2, N3, S5, S6 |
| Avond 1 · Master en effecten | 6 | 12 | MASTER (mapje master, limiter), EFFECTEN (sjablonen, distortion, vertraging) | S9, S10, S11, S13 |
| Avond 2 · Opstarten met de hub | 2 | 5 | `npm start -- studio` in AV-app-hub, LPD8 K1 | O1 |
| Avond 2 · Spelen | 15 | 30 | INSTRUMENTEN, MASCHINE, STUDIO S3: FM op de Xboard eerst in de koptelefoon, aanslag, toets → geluid, Maschine (wiel, pads, kleuren, draaiknoppen, schermen), drums, Schaal, mapje inst | S4, S7, S8, S14, S18, S19 |
| Avond 2 · Patronen | 8 | 22 | PATRONEN §7, MASCHINE §5, STUDIO S4: stappen op de Maschine, baslijn van de Xboard, starten vanaf de APC, mixen, sprong, herladen | S15, S16, S17 |
| Eerder werk · … (negen blokken) | 37 | 65 | wat er vóór 6 okt al in stond: draaien, klank, toonsoort, binnenhalen, auto-DJ, plan, klankschaal, beamer, kleine dingen | AU2, AU3, PL3, KS2, KS3 |

**Avond 1** (mixen): 37 punten, ~64 min, zonder hub (de mixer opent de APC zelf).
**Avond 2** (spelen en programmeren): 25 punten, ~57 min, met de hub (de Maschine kan
alleen via de hub).

- **Vraagcodes**: een code tussen haakjes in de let-tekst ("(S21)") is de open vraag uit
  `docs/VRAGEN.md` die je bij dat punt beantwoordt; je antwoord gaat in de notitie.
  Bij elk punt alleen de vraag die erbij past. Bij geen enkel punt: N4 en S12 (alleen
  een keuze, niets om te proberen) en KS1, KS4, KS5 (de globale klankschaal).
- **Ids**: de 44 punten van vóór 6 okt hebben hun id en tekst gehouden (kp-mix kreeg
  alleen "Goed zo? (S3)" erachter). Nieuwe ids hebben een voorvoegsel per blok:
  `kp-`, `bg-`, `ky-`, `st-`, `ma-`/`fx-`, `hb-`, `sp-`, `pa-`.
- **Geen "gedaan"-stand.** De server kent per punt alleen open, ok, fout en overslaan;
  er is niets om oude punten vooraf mee af te vinken (en `proef/sessie.json` was leeg).
  Daarom staan de oude blokken achteraan als "Eerder werk": als er tijd over is, of `—`.
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
- **De backup-stand** (`GET /api/backups`, alleen GET, achter dezelfde Host-controle):
  `{ laatste: { naam, tijd, bytes } | null, aantal, gekeken, fout, foutTijd, bezig }`.
  Los opgehaald: een oudere server zonder die route geeft een grijze tegel, geen
  "server weg". De kopieën zelf zijn via HTTP niet te lezen.
- **De secties-telling** (`GET /api/secties`, alleen GET, achter dezelfde Host-controle):
  `{ totaal, zonder, verouderd, versie }` uit `Library.sectieTelling()`: dezelfde regel als
  `moetSecties` (wat de achtergrond en het laden opnieuw zouden rekenen). De Controlekamer
  vraagt het elke 2 s, dus gecachet op de stand van de database: `total_changes()` van de
  serververbinding (zoals de backup) plus `PRAGMA data_version` (een andere verbinding).
  Zonder wijziging twee kleine queries (~3–5 µs); na een wijziging één query over grid,
  stems en kaart en per nummer de vingerafdruk van het grid (gemeten: 2000 nummers
  17–37 ms, waar `teSectieAnalyseren` 137 ms deed). Los opgehaald, zoals de stems: een 404
  is "onbekend", geen "server weg".
- **Claude leest na een sessie** `proef/sessie.json` (fout + notitie = eerst repareren).

## Een punt toevoegen of veranderen

In `src/controle/speellijst.js`. Verander geen bestaande `id`: de stand op de
server hangt eraan. `test/controle.test.mjs` controleert dat ids uniek zijn en
op de server passen, dat de punten van vóór 6 okt er nog zijn, en dat elke
vraagcode in een let-tekst in `docs/VRAGEN.md` staat (één tot drie hoofdletters en een
getal, zoals `S21` of `SVC1`; een lijst als `(I4, O2)`). Een punt is één handeling
met één ding om op te letten; zet er alleen knoppen in die in de mapping, de
actions of `index.html` bestaan.

## Getest

- `test/controle.test.mjs`: opslag (fouten, gelijktijdig, kapot bestand,
  archief), de speellijst (ook: de ids van vóór 6 okt, de vraagcodes), het bericht
  van de mixer.
- `test/server.test.mjs`: de routes, de witte lijst, 415 zonder JSON.
- `test/backup.test.mjs`: de backup-tegel (vandaag, gisteren, langer geleden, fout,
  nog geen, geen server) en `/api/backups` op een echte server.
- `test/sec-controle.test.mjs`: de tegel Server met de regel secties (elke stand, ook 404 en
  een lege library), `Library.sectieTelling` (zonder, oudere versie, ander grid, zonder grid
  gerekend, stems erbij, hand en slot; gelijk aan `teSectieAnalyseren`; de cache, ook bij een
  andere verbinding; 2000 nummers) en `/api/secties` op een echte server.
- `tools/headless/sec-controle.mjs` (6 okt, echte Chrome, poorten 8913/9513): een library
  van zeven nummers met, zonder en met een verouderde kaart geeft "3 nog zonder · 2
  verouderd"; een nummer krijgt een kaart zoals bij het laden (`?maak=1`, de worker met
  ffmpeg) → "2 nog zonder"; een ander grid → een verouderde meer; nummers weg → "alles
  actueel"; een oudere server (404 via de Fetch-laag) → "onbekend"; 390 px breed zonder
  zijwaarts scrollen en de regel niet afgekapt; server weg → geen regel. 16 ok.
- `tools/headless/controle.mjs`: Controlekamer en een echte mixer in twee
  tabbladen van één headless Chromium. Mixer open/dicht, een tweede mixer, de
  knop, de demotrack in "in de mixer", afvinken en notities na herladen, de
  Backup-tegel. Gedraaid op 6 okt met de speellijst van twee avonden (99 punten):
  alles groen, de lijst past op 1440 px en op 390 px breed zonder zijwaarts scrollen.
- NIET getest: met de echte APC (de headless mixer heeft geen MIDI), en op de
  Mac in Clay's Chrome.
